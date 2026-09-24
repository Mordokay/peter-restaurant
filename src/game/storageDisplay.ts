// What a container is holding, shown as the real thing.
//
// This is the general storage-grid system, not a freezer feature: anything that holds goods — a freezer,
// a pantry shelf, a dining table, a crate, a market stall — carries SOCKETS in its model marking where
// things stand, named as grids (`shelf_a_c3r2` is column 3, depth row 2 of shelf A). Stock is packed into
// those grids the way a person packs a shelf: a watermelon or a serving dish takes a two-by-two square, a
// jar takes one place, ten blocks of tofu are ten blocks, goods can be barred from a place or prefer one,
// and whatever does not fit is simply not on show.
//
// Each distinct item is meshed once and every placement is a hardware instance of it, so a room full of
// stocked shelves costs a handful of draw calls.
import { Mesh, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3, type AbstractMesh } from "@babylonjs/core";
import { hash01 } from "./hash.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog, type AuthoredVoxelModel } from "./voxelModel.ts";
import { createVoxelMaterial, createVoxelMesh } from "./voxelGeometry.ts";

/** One kind of goods and how much of it there is. */
export interface StoredItem {
  /** Catalog model id. */
  model: string;
  /** How many there are. Each one takes its own place, so ten blocks of tofu are ten blocks. */
  count?: number;
  /** Where this may stand, by zone ("shelf", "drawer", "table") or grid id ("shelf_a"). Absent means
   *  anywhere. A bottle of ketchup belongs on a shelf and nowhere else. */
  only?: string | readonly string[];
  /** Where it would rather stand when there is room — cabbages and potatoes go in the drawer with the
   *  other vegetables, but will sit on a shelf rather than not be shown. */
  prefer?: string | readonly string[];
  /** Places it covers, [across, deep]. Worked out from the model's real size when left out. */
  footprint?: readonly [number, number];
}

/** A grid of standing places: one shelf, one layer of a drawer, one table top. */
export interface StorageGrid {
  /** Grid id from the slot names, e.g. "shelf_a". */
  id: string;
  /** The kind of place it is ("shelf", "drawer"), which is what items name in `only` and `prefer`. */
  zone: string;
  cols: number;
  rows: number;
  /** Slot name at a coordinate, 1-based, or undefined where the grid has a hole. */
  slot(col: number, row: number): string | undefined;
}

/** One item standing in one place, with the square of places it covers. */
export interface Placement {
  model: string;
  grid: string;
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** Every slot it covers; the first is its anchor. */
  slots: string[];
}

export interface StorageDisplayOptions {
  scene: Scene;
  /** The model carrying the sockets. */
  model: AuthoredVoxelModel;
  /** Node the goods hang from — a rig's part node, or a prop's root. */
  node: TransformNode;
  catalog: AuthoredVoxelCatalog;
  /** Part whose sockets to use; defaults to the first part that has any. */
  part?: string;
  /** Longest an item may be before it is scaled down, metres. Bigger goods take more places; this only
   *  stops something enormous from swallowing a shelf. Default 0.45. */
  maxSize?: number;
  shadows?: ShadowGenerator;
  material?: StandardMaterial;
}

export interface StorageDisplay {
  /** Show what the container holds. */
  show(items: readonly StoredItem[]): void;
  /** The grids read out of the model's sockets. */
  readonly grids: readonly StorageGrid[];
  /** How many items are standing there now. */
  readonly filled: number;
  clear(): void;
  dispose(): void;
}

const SLOT_PATTERN = /^(.*)_c(\d+)r(\d+)$/;

/** Read grids out of socket names shaped `<grid>_c<col>r<row>`. Other sockets are left alone. */
export function gridsOf(slots: readonly string[]): StorageGrid[] {
  const built = new Map<string, { cells: Map<string, string>; cols: number; rows: number }>();
  for (const name of slots) {
    const match = SLOT_PATTERN.exec(name);
    if (!match) continue;
    const id = match[1]!;
    const col = Number(match[2]), row = Number(match[3]);
    let entry = built.get(id);
    if (!entry) built.set(id, (entry = { cells: new Map(), cols: 0, rows: 0 }));
    entry.cells.set(`${col},${row}`, name);
    entry.cols = Math.max(entry.cols, col);
    entry.rows = Math.max(entry.rows, row);
  }
  return [...built.entries()].map(([id, entry]) => ({
    id,
    zone: id.split("_")[0] ?? id,
    cols: entry.cols,
    rows: entry.rows,
    slot: (col: number, row: number) => entry.cells.get(`${col},${row}`),
  }));
}

/** Pack stock into the grids: preferred places first, then anywhere allowed. */
export function packStock(
  items: readonly StoredItem[],
  grids: readonly StorageGrid[],
  options: { footprintOf?: (model: string) => readonly [number, number] } = {},
): Placement[] {
  const footprintOf = options.footprintOf ?? (() => [1, 1] as const);
  const list = (value: string | readonly string[] | undefined): string[] => (value === undefined ? [] : typeof value === "string" ? [value] : [...value]);
  interface Unit { model: string; only: string[]; prefer: string[]; size: [number, number]; done: boolean }
  const queue: Unit[] = [];
  for (const item of items) {
    const count = Math.max(0, Math.floor(item.count ?? 1));
    const size = item.footprint ?? footprintOf(item.model);
    for (let i = 0; i < count; i++) {
      queue.push({ model: item.model, only: list(item.only), prefer: list(item.prefer), size: [Math.max(1, size[0]), Math.max(1, size[1])], done: false });
    }
  }

  const taken = new Map<string, Set<string>>();
  const free = (grid: StorageGrid, col: number, row: number, cols: number, rows: number): boolean => {
    if (col + cols - 1 > grid.cols || row + rows - 1 > grid.rows) return false;
    const used = taken.get(grid.id);
    for (let c = col; c < col + cols; c++) {
      for (let r = row; r < row + rows; r++) {
        if (!grid.slot(c, r)) return false;
        if (used?.has(`${c},${r}`)) return false;
      }
    }
    return true;
  };
  const occupy = (grid: StorageGrid, col: number, row: number, cols: number, rows: number): string[] => {
    let used = taken.get(grid.id);
    if (!used) taken.set(grid.id, (used = new Set()));
    const names: string[] = [];
    for (let r = row; r < row + rows; r++) {
      for (let c = col; c < col + cols; c++) {
        used.add(`${c},${r}`);
        const name = grid.slot(c, r);
        if (name) names.push(name);
      }
    }
    return names;
  };

  const out: Placement[] = [];
  const allowed = (unit: Unit, grid: StorageGrid) => unit.only.length === 0 || unit.only.includes(grid.zone) || unit.only.includes(grid.id);
  const prefers = (unit: Unit, grid: StorageGrid) => unit.prefer.includes(grid.zone) || unit.prefer.includes(grid.id);

  // Two passes: everything that asked for this kind of place first, then whatever else may stand here.
  // So cabbages fill the drawer, and only spill onto a shelf once the drawer is full.
  for (const pass of [true, false]) {
    for (const grid of grids) {
      for (const unit of queue) {
        if (unit.done || !allowed(unit, grid)) continue;
        if (pass && !prefers(unit, grid)) continue;
        const [cols, rows] = unit.size;
        let placed = false;
        for (let row = 1; row <= grid.rows && !placed; row++) {
          for (let col = 1; col <= grid.cols && !placed; col++) {
            if (!free(grid, col, row, cols, rows)) continue;
            out.push({ model: unit.model, grid: grid.id, col, row, cols, rows, slots: occupy(grid, col, row, cols, rows) });
            unit.done = true;
            placed = true;
          }
        }
      }
    }
  }
  return out;
}

/** Deterministic 0..1 from a name and an index — the same shelf always packs the same way.
 *  Re-exported from hash.ts so existing callers keep working. */
export const placeHash = hash01;

/** A turn and a small lean for something set down by hand.
 *
 *  Nobody puts a jar on a shelf perfectly square. A row of goods all standing
 *  dead upright at the same angle reads as a texture rather than as objects, and
 *  the fix costs nothing: a full random yaw plus a couple of degrees of tilt on
 *  both horizontal axes. `tiltDegrees` stays small — these things are resting on
 *  a surface, not falling off it. */
export function placementAttitude(seed: string, index: number, tiltDegrees = 5): { x: number; y: number; z: number } {
  const lean = (tiltDegrees * Math.PI) / 180;
  return {
    x: (placeHash(seed, index, 3) - 0.5) * 2 * lean,
    y: placeHash(seed, index, 4) * Math.PI * 2,
    z: (placeHash(seed, index, 5) - 0.5) * 2 * lean,
  };
}

/** Bounds of a model in cells, so an item can be sized and stood on its base. */
export function modelBounds(model: AuthoredVoxelModel): { min: Vector3; max: Vector3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const cell of cellsFromAuthoredModel(model)) {
    if (cell.x < minX) minX = cell.x; if (cell.x > maxX) maxX = cell.x;
    if (cell.y < minY) minY = cell.y; if (cell.y > maxY) maxY = cell.y;
    if (cell.z < minZ) minZ = cell.z; if (cell.z > maxZ) maxZ = cell.z;
  }
  if (!Number.isFinite(minX)) return { min: Vector3.Zero(), max: Vector3.Zero() };
  return { min: new Vector3(minX, minY, minZ), max: new Vector3(maxX, maxY, maxZ) };
}

/** How many places across and deep something of this size needs, given the spacing of the grid.
 *  Capped at three, so nothing swallows a whole shelf. */
export function footprintFor(width: number, depth: number, pitchX: number, pitchZ: number): [number, number] {
  const places = (size: number, pitch: number) => Math.max(1, Math.min(3, Math.ceil(size / Math.max(1e-3, pitch) - 0.2)));
  return [places(width, pitchX), places(depth, pitchZ)];
}

export function createStorageDisplay(options: StorageDisplayOptions): StorageDisplay {
  const { scene, model, node, catalog } = options;
  const maxSize = options.maxSize ?? 0.45;
  const holder = model.parts.find((part) => (options.part ? part.id === options.part : Object.keys(part.sockets ?? {}).length > 0));
  const sockets = holder?.sockets ?? {};
  const grids = gridsOf(Object.keys(sockets));
  const material = options.material ?? createVoxelMaterial("storage contents", scene);

  /** Spacing of the first grid, which is how an item's size becomes a number of places. */
  const spacing = ((): { x: number; z: number } => {
    const grid = grids[0];
    const at = (col: number, row: number) => { const name = grid?.slot(col, row); return name ? sockets[name] : undefined; };
    const origin = at(1, 1), across = grid && grid.cols > 1 ? at(2, 1) : undefined, deep = grid && grid.rows > 1 ? at(1, 2) : undefined;
    return {
      x: origin && across ? Math.abs(across[0] - origin[0]) * model.pitch : 0.15,
      z: origin && deep ? Math.abs(deep[2] - origin[2]) * model.pitch : 0.15,
    };
  })();

  const sources = new Map<string, { mesh: Mesh; scale: number; lift: number; footprint: [number, number] }>();
  const placed: AbstractMesh[] = [];

  const sourceFor = (id: string) => {
    const existing = sources.get(id);
    if (existing) return existing;
    const itemModel = catalog.models[id];
    if (!itemModel) return null;
    const cells = cellsFromAuthoredModel(itemModel);
    if (!cells.length) return null;
    const mesh = createVoxelMesh(`storage ${id}`, cells, itemModel.pitch, scene, { material });
    mesh.isVisible = false;
    mesh.isPickable = false;
    const bounds = modelBounds(itemModel);
    const size = bounds.max.subtract(bounds.min).scale(itemModel.pitch);
    const scale = Math.min(1, maxSize / Math.max(size.x, size.y, size.z, 1e-3));
    const entry = {
      mesh, scale,
      // Lift it so the item's underside meets the shelf rather than sinking through it.
      lift: -(bounds.min.y - 0.5) * itemModel.pitch * scale,
      footprint: footprintFor(size.x * scale, size.z * scale, spacing.x, spacing.z),
    };
    sources.set(id, entry);
    return entry;
  };

  const clear = (): void => {
    for (const mesh of placed) { options.shadows?.removeShadowCaster(mesh); mesh.dispose(false, false); }
    placed.length = 0;
  };

  /** Local position of a placement: the centre of the square of places it covers. */
  const positionOf = (placement: Placement): Vector3 | null => {
    const grid = grids.find((candidate) => candidate.id === placement.grid);
    const firstName = grid?.slot(placement.col, placement.row);
    const lastName = grid?.slot(placement.col + placement.cols - 1, placement.row + placement.rows - 1);
    const a = firstName ? sockets[firstName] : undefined;
    const b = lastName ? sockets[lastName] : undefined;
    if (!a || !b) return null;
    return new Vector3(((a[0] + b[0]) / 2) * model.pitch, ((a[1] + b[1]) / 2) * model.pitch, ((a[2] + b[2]) / 2) * model.pitch);
  };

  return {
    grids,
    get filled() { return placed.length; },
    show(items) {
      clear();
      // Mesh every kind up front, so the packer knows how much room each really needs.
      for (const item of items) sourceFor(item.model);
      const fill = packStock(items, grids, { footprintOf: (id) => sources.get(id)?.footprint ?? [1, 1] });
      for (const [index, placement] of fill.entries()) {
        const source = sourceFor(placement.model);
        const centre = positionOf(placement);
        if (!source || !centre) continue;
        const instance = source.mesh.createInstance(`${node.name}.${placement.grid}.c${placement.col}r${placement.row}`);
        instance.parent = node;
        instance.scaling.setAll(source.scale);
        instance.position.set(centre.x, centre.y + source.lift, centre.z);
        // A turn AND a lean each, so a shelf of the same vegetable reads as
        // objects somebody set down rather than as a repeating texture.
        const attitude = placementAttitude(`${node.name}.${placement.grid}`, index);
        instance.rotation.set(attitude.x, attitude.y, attitude.z);
        instance.isPickable = false;
        options.shadows?.addShadowCaster(instance);
        placed.push(instance);
      }
    },
    clear,
    dispose() {
      clear();
      for (const source of sources.values()) source.mesh.dispose(false, false);
      sources.clear();
      if (!options.material) material.dispose();
    },
  };
}
