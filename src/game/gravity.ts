// Gravity for the voxel world: a shared constant, a spatial field of surface boxes
// (counters, tables, floors, placed props) and a small integrator so anything that
// falls — particles, a dropped prop — lands on the highest surface beneath it: the
// table before the floor.
import { Matrix, Vector3, type AbstractMesh } from "@babylonjs/core";
import { cellsFromAuthoredModel, type AuthoredVoxelModel } from "./voxelModel.ts";

/** m/s², downwards. */
export const GRAVITY = 9.81;

/** An axis-aligned box things can land on (its `top` is what matters). */
export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number; top: number; bottom: number }

export interface ColliderField {
  /** Replace the boxes registered under an id (props re-register when they move). */
  set(id: string, boxes: readonly Collider[]): void;
  remove(id: string): void;
  /** Highest surface at (x, z) whose top is at or below `y` (plus a little slack), the ground included; `exclude` skips one id. */
  surfaceBelow(x: number, y: number, z: number, exclude?: string): number;
  /** Highest surface at (x, z) strictly below `y` and above `floor` (no ground fallback), or null. */
  topBetween(x: number, z: number, floor: number, y: number, exclude?: string): number | null;
  stats(): { ids: number; boxes: number };
}

/** A field of surfaces hashed on an XZ grid; `groundY` is the plane everything eventually reaches. */
export function createColliderField(options: { cellSize?: number; groundY?: number } = {}): ColliderField {
  const cellSize = options.cellSize ?? 0.5;
  const groundY = options.groundY ?? 0;
  const byId = new Map<string, Collider[]>();
  const cells = new Map<string, Set<string>>(); // cell key → ids with a box overlapping the cell
  const keyOf = (cx: number, cz: number) => `${cx},${cz}`;
  const cellsOf = (box: Collider, visit: (key: string) => void) => {
    const x0 = Math.floor(box.minX / cellSize), x1 = Math.floor(box.maxX / cellSize);
    const z0 = Math.floor(box.minZ / cellSize), z1 = Math.floor(box.maxZ / cellSize);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) visit(keyOf(cx, cz));
  };
  const remove = (id: string): void => {
    const boxes = byId.get(id);
    if (!boxes) return;
    for (const box of boxes) cellsOf(box, (key) => { const set = cells.get(key); if (set) { set.delete(id); if (!set.size) cells.delete(key); } });
    byId.delete(id);
  };
  const candidates = (x: number, z: number): Iterable<string> => cells.get(keyOf(Math.floor(x / cellSize), Math.floor(z / cellSize))) ?? [];
  return {
    set(id, boxes) {
      remove(id);
      const copy = boxes.map((box) => ({ ...box }));
      byId.set(id, copy);
      for (const box of copy) cellsOf(box, (key) => { let set = cells.get(key); if (!set) cells.set(key, (set = new Set())); set.add(id); });
    },
    remove,
    surfaceBelow(x, y, z, exclude) {
      let best = groundY;
      for (const id of candidates(x, z)) {
        if (id === exclude) continue;
        for (const box of byId.get(id) ?? []) {
          if (box.top > best && box.top <= y + 1e-4 && x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) best = box.top;
        }
      }
      return best;
    },
    topBetween(x, z, floor, y, exclude) {
      let best: number | null = null;
      for (const id of candidates(x, z)) {
        if (id === exclude) continue;
        for (const box of byId.get(id) ?? []) {
          if (box.top > floor && box.top <= y && (best === null || box.top > best) && x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ) best = box.top;
        }
      }
      return best;
    },
    stats: () => ({ ids: byId.size, boxes: [...byId.values()].reduce((sum, list) => sum + list.length, 0) }),
  };
}

/** World-space box of a mesh (its bounding box after the current world matrix). */
export function colliderOfMesh(mesh: AbstractMesh): Collider {
  mesh.computeWorldMatrix(true);
  const box = mesh.getBoundingInfo().boundingBox;
  return { minX: box.minimumWorld.x, maxX: box.maximumWorld.x, minZ: box.minimumWorld.z, maxZ: box.maximumWorld.z, top: box.maximumWorld.y, bottom: box.minimumWorld.y };
}

export function collidersOfMeshes(meshes: Iterable<AbstractMesh>): Collider[] {
  const out: Collider[] = [];
  for (const mesh of meshes) if (!mesh.isDisposed() && mesh.isEnabled() && mesh.getTotalVertices() > 0) out.push(colliderOfMesh(mesh));
  return out;
}

const partBoxCache = new Map<string, { min: [number, number, number]; max: [number, number, number] }[]>();
/** One box per part of a model (rest pose, model space, metres), cached per model id + revision-free geometry hash of its part count. */
export function modelPartBoxes(model: AuthoredVoxelModel): { min: [number, number, number]; max: [number, number, number] }[] {
  const key = `${model.id}|${model.parts.length}|${model.pitch}`;
  let boxes = partBoxCache.get(key);
  if (!boxes) {
    boxes = [];
    for (const part of model.parts) {
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const cell of cellsFromAuthoredModel(model, [part.id])) {
        if (cell.x < minX) minX = cell.x; if (cell.x > maxX) maxX = cell.x;
        if (cell.y < minY) minY = cell.y; if (cell.y > maxY) maxY = cell.y;
        if (cell.z < minZ) minZ = cell.z; if (cell.z > maxZ) maxZ = cell.z;
      }
      if (!Number.isFinite(minX)) continue;
      const p = model.pitch;
      boxes.push({ min: [(minX - 0.5) * p, (minY - 0.5) * p, (minZ - 0.5) * p], max: [(maxX + 0.5) * p, (maxY + 0.5) * p, (maxZ + 0.5) * p] });
    }
    partBoxCache.set(key, boxes);
  }
  return boxes;
}

/** Per-part world boxes of a placed model (rest pose): what a placed prop offers to land on. */
export function modelColliders(model: AuthoredVoxelModel, world: Matrix): Collider[] {
  const out: Collider[] = [];
  for (const box of modelPartBoxes(model)) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, top = -Infinity, bottom = Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const local = new Vector3(corner & 1 ? box.max[0] : box.min[0], corner & 2 ? box.max[1] : box.min[1], corner & 4 ? box.max[2] : box.min[2]);
      const w = Vector3.TransformCoordinates(local, world);
      if (w.x < minX) minX = w.x; if (w.x > maxX) maxX = w.x; if (w.z < minZ) minZ = w.z; if (w.z > maxZ) maxZ = w.z; if (w.y > top) top = w.y; if (w.y < bottom) bottom = w.y;
    }
    out.push({ minX, maxX, minZ, maxZ, top, bottom });
  }
  return out;
}

export interface FallingBody { x: number; y: number; z: number; vx: number; vy: number; vz: number }

/** One step of free fall onto the field. Returns the surface height it landed on this step, or null.
 *  `gravityScale` lets particles float (0) or rise (negative). */
export function stepFall(body: FallingBody, dt: number, field: ColliderField | null, options: { gravityScale?: number; exclude?: string; groundY?: number; drag?: number } = {}): number | null {
  const g = GRAVITY * (options.gravityScale ?? 1);
  body.vy -= g * dt;
  if (options.drag) { const keep = Math.max(0, 1 - options.drag * dt); body.vx *= keep; body.vy *= keep; body.vz *= keep; }
  const y0 = body.y;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.z += body.vz * dt;
  if (body.vy >= 0) return null;
  const floor = field ? field.surfaceBelow(body.x, y0, body.z, options.exclude) : (options.groundY ?? 0);
  if (body.y <= floor) { body.y = floor; return floor; }
  return null;
}

/** Response to a landing: bounce back up (scaled), keep some horizontal speed, or stop. Returns true when the body came to rest. */
export function landBody(body: FallingBody, bounce: number, friction: number, restSpeed = 0.35): boolean {
  if (bounce > 0 && -body.vy > restSpeed) {
    body.vy = -body.vy * bounce;
    body.vx *= friction;
    body.vz *= friction;
    return false;
  }
  body.vx = 0; body.vy = 0; body.vz = 0;
  return true;
}
