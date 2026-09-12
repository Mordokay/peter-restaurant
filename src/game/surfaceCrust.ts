// The crust: the things that actually stand up out of a surface.
//
// Four of the six materials carry their identity in their STRUCTURE — an oak floor is boards, a quarry
// floor is tiles, a ploughed field is furrows, a wall is courses — and structure reads as colour, which is
// why those four work at twenty-six metres with no geometry at all. Gravel and grass have no structure.
// A gravel bed with no pebbles is mottled grey; a lawn with no blades is green paint. Their whole identity
// is the scatter of little three-dimensional things sitting on them, and that is what this file makes.
//
// The rule the user set, and the one that matters most here: **nothing may feel copy-pasted**. So a crust
// is never one shape repeated. Every site draws its own form from a family, its own size, its own yaw, its
// own tone and its own lean, all from the world position it stands at — which also means it is stable
// (walk away and back and the same pebble is in the same place) and seamless (there is no tile to align).
//
// It is expensive in the way scattered things always are: a pebble breaks the mesher's merging, so a
// square metre of gravel costs far more than a square metre of tile. That is exactly why it is built only
// near the camera and dropped beyond it.
import type { VoxelCell } from "./voxelGeometry.ts";
import { hash2, type SurfaceMaterial } from "./surfaces.ts";

/** A family of standing shapes. Each site picks one, then varies it. */
export type CrustForm =
  /** Blades standing around a common root: grass, weeds, a clump of herbs. `lean` is how wide the clump
   *  spreads in metres, not how far a blade tips — blades stand straight, because a stepped blade is a
   *  staircase of floating cubes and costs four times as much to draw. */
  | { kind: "tuft"; blades: [number, number]; height: [number, number]; lean: number; tones: string[] }
  /** A rounded lump sitting on the ground: a pebble, a clod, a stone. */
  | { kind: "pebble"; radius: [number, number]; height: [number, number]; tones: string[] }
  /** A flat flake lying over the surface: a bark chip, a dry leaf, a wood shaving. */
  | { kind: "chip"; length: [number, number]; width: [number, number]; tones: string[] };

export interface Crust {
  /** Sites per square metre. 20% ground cover is roughly 6–10 tufts a metre, not one. */
  density: number;
  /** The families a site may draw from, and how often — the first listed is the most common. */
  forms: CrustForm[];
  /** Sites thin out and thicken across the ground rather than sitting at one even density.
   *  `scale` is the size of a thick or thin area in metres; density is multiplied by 0..`swing`. */
  drift?: { scale: number; swing: number };
  /** Salt, so gravel and grass on the same square metre do not land in identical places. */
  salt: number;
  /** Cell size for the crust's own geometry, metres. Finer than the carpet, because a stone the size of
   *  a carpet cell is a boulder: the first gravel had 7–32 cm pebbles and read as paving slabs. */
  pitch?: number;
}

/** How many steps a blade's wind weight is quantised to. More is smoother and costs merging. */
const SWAY_STEPS = 2;

const lerp = (range: readonly [number, number], t: number): number => range[0] + (range[1] - range[0]) * t;
const pick = <T>(list: readonly T[], t: number): T => list[Math.min(list.length - 1, Math.floor(t * list.length))]!;

/** Every crust site inside a rect of world metres, as world positions with the form each one drew. */
export function crustSites(crust: Crust, x0: number, z0: number, width: number, depth: number): {
  x: number; z: number; form: CrustForm; seed: number;
}[] {
  // Sites live on a jittered lattice: one cell per site on average, then shoved off centre. A plain
  // random scatter clumps and leaves bald patches; a jittered lattice reads as nature and is stable.
  const spacing = 1 / Math.sqrt(Math.max(0.01, crust.density));
  const sites: { x: number; z: number; form: CrustForm; seed: number }[] = [];
  const iu0 = Math.floor(x0 / spacing), iu1 = Math.ceil((x0 + width) / spacing);
  const iv0 = Math.floor(z0 / spacing), iv1 = Math.ceil((z0 + depth) / spacing);
  for (let iu = iu0; iu <= iu1; iu++) {
    for (let iv = iv0; iv <= iv1; iv++) {
      const seed = hash2(iu, iv, crust.salt);
      // Thin and thicken: a site only exists where the drift field says the ground is well covered.
      if (crust.drift) {
        const drift = hash2(Math.floor((iu * spacing) / crust.drift.scale), Math.floor((iv * spacing) / crust.drift.scale), crust.salt + 3);
        if (seed > drift * crust.drift.swing) continue;
      }
      const x = (iu + 0.15 + 0.7 * hash2(iu, iv, crust.salt + 1)) * spacing;
      const z = (iv + 0.15 + 0.7 * hash2(iu, iv, crust.salt + 2)) * spacing;
      if (x < x0 || x >= x0 + width || z < z0 || z >= z0 + depth) continue;
      sites.push({ x, z, form: pick(crust.forms, hash2(iu, iv, crust.salt + 4)), seed });
    }
  }
  return sites;
}

/** One blade of a tuft: where it stands (in cells), how tall (in cells), and its tone. */
export interface Blade { cx: number; cz: number; height: number; tone: string }

/** Where a tuft's blades stand. Blades stand around a common root, each with its own height and tone,
 *  and each is a STRAIGHT column. Leaning them looked obvious and was wrong twice over: stepping a blade
 *  sideways cell by cell detaches it into a staircase of floating cubes, and it breaks the mesher's
 *  merging — 1,521 triangles a square metre against 350 for the same grass standing up. A clump of
 *  straight blades at different heights reads as grass; the wind is what bends them. */
function tuftBlades(
  form: Extract<CrustForm, { kind: "tuft" }>, cx: number, cz: number, seed: number, pitch: number,
  rnd: (n: number) => number, columns: Set<string>,
): Blade[] {
  const blades = Math.round(lerp(form.blades, seed));
  const spread = Math.max(1, Math.round(form.lean / pitch));   // how wide the clump sits, in cells
  const out: Blade[] = [];
  for (let b = 0; b < blades; b++) {
    const height = Math.max(2, Math.round(lerp(form.height, rnd(b * 4)) / pitch));
    const angle = rnd(b * 4 + 1) * Math.PI * 2;
    const reach = spread * Math.sqrt(rnd(b * 4 + 2));           // even over the clump, not bunched
    const tone = pick(form.tones, rnd(b * 4 + 3));
    const bx = cx + Math.round(Math.cos(angle) * reach);
    const bz = cz + Math.round(Math.sin(angle) * reach);
    // One blade to a column. Two sharing one would interleave their wind weights up the same stack of
    // cells, and the shader would bend the result into a corkscrew.
    const column = `${bx},${bz}`;
    if (columns.has(column)) continue;
    columns.add(column);
    out.push({ cx: bx, cz: bz, height, tone });
  }
  return out;
}

/** One tuft seen from far enough away that its blades have merged into a single smudge. */
export interface Tuft { cx: number; cz: number; height: number; width: number; tone: string }

/** Every tuft over a patch of ground, summarised. At twenty metres a clump of six blades is two pixels
 *  wide, so the distant lawn is drawn as one squat column per tuft instead of six thin ones — a tenth of
 *  the geometry for a silhouette nobody can tell apart. The blades' own spread becomes its width. */
export function crustTufts(
  material: SurfaceMaterial, originX: number, originZ: number, width: number, depth: number,
  columns: Set<string> = new Set(), exclude?: (x: number, z: number) => boolean,
): { tufts: Tuft[]; pitch: number } {
  if (!material.crust) return { tufts: [], pitch: material.pitch ?? 0.05 };
  const pitch = material.crust.pitch ?? material.pitch ?? 0.05;
  const tufts: Tuft[] = [];
  for (const site of crustSites(material.crust, originX, originZ, width, depth)) {
    if (site.form.kind !== "tuft") continue;
    if (exclude?.(site.x, site.z)) continue;
    const cx = Math.round(site.x / pitch), cz = Math.round(site.z / pitch);
    const rnd = (n: number) => hash2(cx, cz, 900 + n);
    const blades = tuftBlades(site.form, cx, cz, site.seed, pitch, rnd, columns);
    if (!blades.length) continue;
    // Tall enough to keep the clump's silhouette, wide enough to cover where its blades stood.
    let tallest = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const blade of blades) {
      tallest = Math.max(tallest, blade.height);
      minX = Math.min(minX, blade.cx); maxX = Math.max(maxX, blade.cx);
      minZ = Math.min(minZ, blade.cz); maxZ = Math.max(maxZ, blade.cz);
    }
    tufts.push({
      cx: Math.round((minX + maxX) / 2), cz: Math.round((minZ + maxZ) / 2),
      height: Math.max(2, Math.round(tallest * 0.8)),
      width: Math.max(1, Math.min(3, Math.round((maxX - minX + maxZ - minZ) / 2) || 1)),
      tone: blades[Math.floor(blades.length / 2)]!.tone,
    });
  }
  return { tufts, pitch };
}

/** Every blade over a patch of ground, as placements rather than cells — what the instancer wants. */
export function crustBlades(
  material: SurfaceMaterial, originX: number, originZ: number, width: number, depth: number,
  columns: Set<string> = new Set(), exclude?: (x: number, z: number) => boolean,
): { blades: Blade[]; pitch: number } {
  if (!material.crust) return { blades: [], pitch: material.pitch ?? 0.05 };
  const pitch = material.crust.pitch ?? material.pitch ?? 0.05;
  const blades: Blade[] = [];
  for (const site of crustSites(material.crust, originX, originZ, width, depth)) {
    if (site.form.kind !== "tuft") continue;
    if (exclude?.(site.x, site.z)) continue;
    // Addressed from the world origin, like the instancer's matrices.
    const cx = Math.round(site.x / pitch), cz = Math.round(site.z / pitch);
    const rnd = (n: number) => hash2(cx, cz, 900 + n);
    blades.push(...tuftBlades(site.form, cx, cz, site.seed, pitch, rnd, columns));
  }
  return { blades, pitch };
}

/** Grow one site into cells, addressed in cells from the patch origin. */
function growSite(
  form: CrustForm, x: number, z: number, seed: number, pitch: number, out: VoxelCell[], originX: number, originZ: number,
  columns: Set<string>,
): void {
  const cx = Math.round((x - originX) / pitch);
  const cz = Math.round((z - originZ) / pitch);
  const rnd = (n: number) => hash2(cx, cz, 900 + n);
  switch (form.kind) {
    case "tuft": {
      for (const blade of tuftBlades(form, cx, cz, seed, pitch, rnd, columns)) {
        // Anchored at the root, free at the tip, in steps rather than continuously. Sway is part of the
        // mesher's merge key, so a distinct value per cell makes every cell of a blade its own quad:
        // measured 1,360 triangles a square metre against 363. Steps merge back into runs and still bend
        // as a curve, because the shader squares the weight before it uses it.
        for (let y = 0; y < blade.height; y++) {
          const along = blade.height < 2 ? 0 : y / (blade.height - 1);
          out.push({ x: blade.cx, y, z: blade.cz, color: blade.tone, sway: Math.round(along * SWAY_STEPS) / SWAY_STEPS });
        }
      }
      return;
    }
    case "pebble": {
      // A squashed dome. Radius and height vary per site, so a bed of them is never a bed of clones.
      const radius = Math.max(1, Math.round(lerp(form.radius, seed) / pitch));
      const height = Math.max(1, Math.round(lerp(form.height, rnd(1)) / pitch));
      const tone = pick(form.tones, rnd(2));
      const squash = 0.75 + 0.5 * rnd(3);          // a little oval, and never on the same axis
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const r = Math.hypot(dx / squash, dz * squash) / radius;
          if (r > 1) continue;
          const top = Math.max(0, Math.round(height * Math.sqrt(Math.max(0, 1 - r * r))) - 1);
          for (let y = 0; y <= top; y++) out.push({ x: cx + dx, y, z: cz + dz, color: tone });
        }
      }
      return;
    }
    default: {
      // A flake lying flat, turned to one of four ways round.
      const length = Math.max(1, Math.round(lerp(form.length, seed) / pitch));
      const width = Math.max(1, Math.round(lerp(form.width, rnd(1)) / pitch));
      const tone = pick(form.tones, rnd(2));
      const turned = rnd(3) > 0.5;
      const [a, b] = turned ? [width, length] : [length, width];
      for (let dx = 0; dx < a; dx++) for (let dz = 0; dz < b; dz++) out.push({ x: cx + dx, y: 0, z: cz + dz, color: tone });
    }
  }
}

/** Every crust cell over a patch of ground, in cells from (originX, originZ). */
export function crustCells(
  material: SurfaceMaterial, originX: number, originZ: number, width: number, depth: number,
  /** Where cell (0,0) sits, if not the corner of the rect. The detail ring addresses every patch from
   *  the world origin so chunks meshed separately still line up cell for cell. */
  address: { x: number; z: number } = { x: originX, z: originZ },
  /** Shared between patches so a blade straddling two of them is not grown twice. */
  columns: Set<string> = new Set(),
  /** Say no to a site — somewhere a higher floor covers this ground, so nothing grows there. */
  exclude?: (x: number, z: number) => boolean,
  /** Only these kinds of form. Blades are instanced elsewhere; stones and chips are meshed here. */
  kinds?: readonly CrustForm["kind"][],
): { cells: VoxelCell[]; pitch: number } {
  if (!material.crust) return { cells: [], pitch: material.pitch ?? 0.05 };
  const pitch = material.crust.pitch ?? material.pitch ?? 0.05;
  const cells: VoxelCell[] = [];
  for (const site of crustSites(material.crust, originX, originZ, width, depth)) {
    if (kinds && !kinds.includes(site.form.kind)) continue;
    if (exclude?.(site.x, site.z)) continue;
    growSite(site.form, site.x, site.z, site.seed, pitch, cells, address.x, address.z, columns);
  }
  return { cells, pitch };
}
