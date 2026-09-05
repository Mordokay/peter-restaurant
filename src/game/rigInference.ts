import { cellsFromAuthoredModel, type AuthoredVoxelModel, type AuthoredVoxelPart } from "./voxelModel.ts";

// Automatic rig from geometry alone, for any multi-part voxel model: the
// part a piece touches most becomes its parent (the biggest part with no
// better anchor is the root), and the joint (pivot) is the centre of the
// cells where the two parts meet. Nothing here knows what the object is; a
// stake with leaves, a chef with arms, or a microwave with a door all rig the
// same way. The editor lets an artist correct any joint afterwards.

export interface RigSuggestion {
  root: string;
  parents: Map<string, string>;
  pivots: Map<string, readonly [number, number, number]>;
}

const NEIGHBOURS: readonly [number, number, number][] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
  if (dx || dy || dz) (NEIGHBOURS as [number, number, number][]).push([dx, dy, dz]);
}

/** `keepExisting`: parents already present on the model (from the source
 * file's node tree or an artist) are kept; only parts without one are
 * inferred from contact. */
export function inferRig(model: AuthoredVoxelModel, options: { root?: string; keepExisting?: boolean } = {}): RigSuggestion {
  // Parts may overlap, so a position can hold several parts.
  const owner = new Map<string, Set<string>>();
  const cellsOf = new Map<string, { x: number; y: number; z: number }[]>();
  for (const part of model.parts) {
    const cells = cellsFromAuthoredModel(model, [part.id]);
    cellsOf.set(part.id, cells);
    for (const cell of cells) {
      const key = `${cell.x},${cell.y},${cell.z}`;
      let set = owner.get(key);
      if (!set) owner.set(key, (set = new Set()));
      set.add(part.id);
    }
  }
  // Contact counts and contact cell sums between every pair of parts.
  const contacts = new Map<string, Map<string, { count: number; sum: [number, number, number] }>>();
  const touch = (a: string, b: string, x: number, y: number, z: number) => {
    let row = contacts.get(a);
    if (!row) contacts.set(a, (row = new Map()));
    let entry = row.get(b);
    if (!entry) row.set(b, (entry = { count: 0, sum: [0, 0, 0] }));
    entry.count++;
    entry.sum[0] += x; entry.sum[1] += y; entry.sum[2] += z;
  };
  for (const part of model.parts) {
    for (const cell of cellsOf.get(part.id)!) {
      // Sharing a position counts as contact too.
      for (const other of owner.get(`${cell.x},${cell.y},${cell.z}`) ?? []) if (other !== part.id) touch(part.id, other, cell.x, cell.y, cell.z);
      for (const [dx, dy, dz] of NEIGHBOURS) {
        for (const other of owner.get(`${cell.x + dx},${cell.y + dy},${cell.z + dz}`) ?? []) if (other !== part.id) touch(part.id, other, cell.x, cell.y, cell.z);
      }
    }
  }
  const size = (id: string) => cellsOf.get(id)!.length;
  const root = options.root ?? [...model.parts].sort((a, b) => size(b.id) - size(a.id) || a.id.localeCompare(b.id))[0]!.id;

  // Grow the tree outward from the root by HOPS: everything touching the root
  // attaches first, then everything touching those, and so on (a shortest-
  // path tree). Within a level, a part picks the parent it touches most.
  // Hops beat raw contact counts: a stem that brushes a fruit cluster over
  // many cells still belongs to the stake it grows from, so popping the fruit
  // never carries the stem and its leaves away with it.
  const parents = new Map<string, string>();
  const pivots = new Map<string, readonly [number, number, number]>();
  const attached = new Set<string>([root]);
  const remaining = new Set(model.parts.map((part) => part.id).filter((id) => id !== root));
  const ids = new Set(model.parts.map((part) => part.id));
  if (options.keepExisting) {
    // File-given parents first (in dependency order), pivot at the contact
    // centre when the two touch, else at the child's own centre.
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const part of model.parts) {
        if (!part.parent || !remaining.has(part.id) || !ids.has(part.parent) || !attached.has(part.parent)) continue;
        const entry = contacts.get(part.id)?.get(part.parent);
        parents.set(part.id, part.parent);
        pivots.set(part.id, entry ? [Math.round(entry.sum[0] / entry.count), Math.round(entry.sum[1] / entry.count), Math.round(entry.sum[2] / entry.count)] : centerOf(cellsOf.get(part.id)!));
        attached.add(part.id);
        remaining.delete(part.id);
        progressed = true;
      }
    }
  }
  // Hops still start at the root: file-fixed parts join the frontier at
  // their own depth (when their parent is expanded), never all at level 0.
  const fixed = new Set(parents.keys());
  let frontier = [root];
  while (remaining.size) {
    const nextFrontier: string[] = [];
    const claims = new Map<string, { parent: string; count: number }>();
    for (const child of remaining) {
      const row = contacts.get(child);
      if (!row) continue;
      for (const candidate of frontier) {
        const entry = row.get(candidate);
        if (!entry) continue;
        const current = claims.get(child);
        if (!current || entry.count > current.count || (entry.count === current.count && candidate < current.parent)) claims.set(child, { parent: candidate, count: entry.count });
      }
    }
    const fixedNext = [...fixed].filter((child) => frontier.includes(parents.get(child)!));
    for (const child of fixedNext) fixed.delete(child);
    if (claims.size === 0 && fixedNext.length) { frontier = fixedNext; continue; }
    if (claims.size === 0) {
      // Nothing touches the tree any more: floating pieces hang off the root, pivot at their own centre.
      for (const child of [...remaining].sort()) {
        parents.set(child, root);
        pivots.set(child, centerOf(cellsOf.get(child)!));
        attached.add(child);
        remaining.delete(child);
      }
      break;
    }
    for (const [child, claim] of [...claims.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const entry = contacts.get(child)!.get(claim.parent)!;
      parents.set(child, claim.parent);
      pivots.set(child, [Math.round(entry.sum[0] / entry.count), Math.round(entry.sum[1] / entry.count), Math.round(entry.sum[2] / entry.count)]);
      attached.add(child);
      remaining.delete(child);
      nextFrontier.push(child);
    }
    frontier = [...nextFrontier, ...fixedNext];
  }
  // The root pivots at the centre of its bottom row, so a whole-model clip
  // (scale from the ground, a lean) reads as growing/leaning from the base.
  const rootCells = cellsOf.get(root)!;
  const minY = Math.min(...rootCells.map((c) => c.y));
  const base = rootCells.filter((c) => c.y === minY);
  pivots.set(root, [Math.round(base.reduce((s, c) => s + c.x, 0) / base.length), minY, Math.round(base.reduce((s, c) => s + c.z, 0) / base.length)]);
  return { root, parents, pivots };
}

function centerOf(cells: { x: number; y: number; z: number }[]): readonly [number, number, number] {
  const n = cells.length || 1;
  return [Math.round(cells.reduce((s, c) => s + c.x, 0) / n), Math.round(cells.reduce((s, c) => s + c.y, 0) / n), Math.round(cells.reduce((s, c) => s + c.z, 0) / n)];
}

/** The model with the suggested hierarchy and joints written into its parts. */
export function applyRig(model: AuthoredVoxelModel, rig: RigSuggestion): AuthoredVoxelModel {
  const parts: AuthoredVoxelPart[] = model.parts.map((part) => {
    const next: AuthoredVoxelPart = { ...part, pivot: rig.pivots.get(part.id) ?? part.pivot };
    const parent = rig.parents.get(part.id);
    if (parent) next.parent = parent; else delete next.parent;
    return next;
  });
  return { ...model, parts };
}
