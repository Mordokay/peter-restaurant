import type { VoxelCell } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, cellsOfPartState, type AuthoredClip, type AuthoredVoxelModel, type AuthoredVoxelPart, type ClipEvent, type ClipKey, type ModelLight, type ParticleEmitter, type PartRestTransform, type VoxelRun } from "./voxelModel.ts";
import { withKey, withoutKey } from "./voxelClips.ts";

// Babylon-free voxel editing session for the Model Lab. Holds the cells of one
// authored model — EVERY PART KEEPS ITS OWN CELLS, so two parts may occupy the
// same position (a fruit resting inside a leaf, a stake passing through a
// vine) and animate apart without leaving holes. Cells are keyed by part +
// position; a position index answers "what is at (x, y, z)" across parts.
// Applies tool operations (paint, erase, add, flood fill, chunk delete,
// assign, palette replace, part hide/delete, group/ungroup, copy/paste,
// baked transforms), keeps a delta-based undo/redo history per stroke that
// also covers rig and clip metadata, and serializes back into the authored
// format with parts, pivots, sockets, clips and palette keys preserved.

export type CellKey = string;

export interface EditableCell {
  x: number;
  y: number;
  z: number;
  color: string;
  part: string;
}

export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

/** Position key (across parts). */
export const cellKey = (x: number, y: number, z: number): CellKey => `${x},${y},${z}`;
/** Storage key: one cell per part per position. */
export const partCellKey = (part: string, x: number, y: number, z: number): CellKey => `${part}|${x},${y},${z}`;

/** One undo step: the cells a stroke touched, before and after (undefined = absent). */
export interface EditDelta {
  before: Map<CellKey, EditableCell | undefined>;
  after: Map<CellKey, EditableCell | undefined>;
  metaBefore?: string;
  metaAfter?: string;
}
/** JSON-friendly history for persisting across page loads. */
export interface SerializedHistory {
  fingerprint: string;
  baselineFingerprint: string;
  savedIndex: number;
  undo: [CellKey, EditableCell | null][][][];
  redo: [CellKey, EditableCell | null][][][];
  undoMeta?: ([string, string] | null)[];
  redoMeta?: ([string, string] | null)[];
}
export const HISTORY_DEPTH = 100;

export interface PartMeta {
  pivot: readonly [number, number, number];
  parent?: string;
  sockets: Record<string, readonly [number, number, number]>;
  /** Stored, non-destructive rest transform (degrees / cells / factors). */
  transform: { rotation: [number, number, number]; position: [number, number, number]; scale: [number, number, number] };
  /** 0..1. Below 1 the part is translucent standing still — a glass door, a jar, a window pane. */
  opacity: number;
  /** Named voxel snapshots besides "base". Their cells live under the layer id `part@state`. */
  states: string[];
}
export const IDENTITY_TRANSFORM = (): PartMeta["transform"] => ({ rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] });
const isIdentity = (t: PartMeta["transform"]) => t.rotation.every((v) => v === 0) && t.position.every((v) => v === 0) && t.scale.every((v) => v === 1);

export interface PartClipboard {
  source: string;
  pivot: readonly [number, number, number];
  cells: { x: number; y: number; z: number; color: string }[];
  sockets: Record<string, readonly [number, number, number]>;
}

export interface PartTransform {
  translate?: readonly [number, number, number];
  rotate?: readonly [number, number, number];
  scale?: readonly [number, number, number] | number;
  mirror?: readonly [boolean, boolean, boolean];
}

const NEIGHBOURS_6: readonly Coordinate[] = [
  { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
];
const NEIGHBOURS_26: readonly Coordinate[] = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
  if (dx || dy || dz) (NEIGHBOURS_26 as Coordinate[]).push({ x: dx, y: dy, z: dz });
}

export function brushCoordinates(center: Coordinate, radius: number): Coordinate[] {
  const out: Coordinate[] = [];
  for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) for (let dz = -radius; dz <= radius; dz++) {
    out.push({ x: center.x + dx, y: center.y + dy, z: center.z + dz });
  }
  return out;
}

export function planeBrushCoordinates(center: Coordinate, axis: 0 | 1 | 2, radius: number): Coordinate[] {
  const out: Coordinate[] = [];
  for (let du = -radius; du <= radius; du++) for (let dv = -radius; dv <= radius; dv++) {
    const c = { ...center };
    if (axis === 0) { c.y += du; c.z += dv; } else if (axis === 1) { c.x += du; c.z += dv; } else { c.x += du; c.y += dv; }
    out.push(c);
  }
  return out;
}

export class VoxelEditSession {
  readonly modelId: string;
  readonly pitch: number;
  private cells = new Map<CellKey, EditableCell>();
  /** position -> cells of every part there. */
  private atPosition = new Map<CellKey, EditableCell[]>();
  private partOrder: string[];
  private readonly meta = new Map<string, PartMeta>();
  private clipList: AuthoredClip[];
  /** Glowing colours (lower-case hex → intensity) and the model's point lights: meta, so undo covers them. */
  private glowByHex = new Map<string, number>();
  private lightList: ModelLight[];
  private emitterList: ParticleEmitter[];
  private readonly originalPalette: Readonly<Record<string, string>>;
  private readonly hiddenParts = new Set<string>();
  private baseline: string;
  private metaBaseline: string;
  private undoStack: EditDelta[] = [];
  private redoStack: EditDelta[] = [];
  private savedIndex = 0;
  private strokeBefore: Map<CellKey, EditableCell | undefined> | null = null;
  private strokeMetaBefore = "";
  generation = 0;
  /** Order-independent running hash of every cell (part, position, color), kept
   * up to date by putCell/dropCell so `dirty` costs nothing per stroke. */
  private hashA = 0;
  private hashB = 0;
  private partHashes = new Map<string, number>();
  /** Bumped whenever a cell of that part is added, removed or recolored. */
  private partVersions = new Map<string, number>();
  /** Cells grouped in EDIT_CHUNK³ blocks per part, with a version per block
   * (a block also bumps when a neighbouring block's border cell changes, since
   * that can expose or hide its faces). The editor re-meshes only stale blocks. */
  private chunkCells = new Map<string, Set<EditableCell>>();
  private chunkVersions = new Map<string, number>();

  constructor(model: AuthoredVoxelModel) {
    this.modelId = model.id;
    this.pitch = model.pitch;
    this.originalPalette = model.palette;
    this.partOrder = model.parts.map((part) => part.id);
    for (const part of model.parts) {
      this.meta.set(part.id, { pivot: [...part.pivot] as [number, number, number], parent: part.parent, sockets: { ...(part.sockets ?? {}) }, transform: fromRest(part.transform), opacity: part.transform?.opacity ?? 1, states: Object.keys(part.states ?? {}) });
    }
    this.clipList = (model.clips ?? []).map((clip) => structuredClone(clip) as AuthoredClip);
    for (const [key, intensity] of Object.entries(model.emissive ?? {})) { const hex = model.palette[key]; if (hex && intensity > 0) this.glowByHex.set(hex.toLowerCase(), intensity); }
    this.lightList = (model.lights ?? []).map((light) => structuredClone(light) as ModelLight);
    this.emitterList = (model.emitters ?? []).map((emitter) => structuredClone(emitter) as ParticleEmitter);
    // Each part loads its own cells; overlaps between parts are kept.
    for (const part of model.parts) {
      for (const cell of cellsFromAuthoredModel(model, [part.id])) this.putCell({ x: cell.x, y: cell.y, z: cell.z, color: cell.color, part: part.id });
      for (const state of Object.keys(part.states ?? {})) {
        for (const cell of cellsOfPartState(model, part, state)) this.putCell({ x: cell.x, y: cell.y, z: cell.z, color: cell.color, part: layerId(part.id, state) });
      }
    }
    this.baseline = this.fingerprint();
    this.metaBaseline = this.metaJson();
  }

  // --- cell store ------------------------------------------------------------
  private cellHash(cell: EditableCell): number {
    let partHash = this.partHashes.get(cell.part);
    if (partHash === undefined) { partHash = fnv(cell.part); this.partHashes.set(cell.part, partHash); }
    let h = Math.imul(cell.x + 0x9e37, 0x85ebca6b) ^ Math.imul(cell.y + 0x79b9, 0xc2b2ae35) ^ Math.imul(cell.z + 0x7f4a, 0x27d4eb2f) ^ partHash;
    h = Math.imul(h ^ (parseInt(cell.color.slice(1), 16) | 0), 0x165667b1);
    h ^= h >>> 15;
    return h | 0;
  }
  private addHash(cell: EditableCell, sign: 1 | -1): void {
    const h = this.cellHash(cell);
    this.hashA = (this.hashA + sign * h) | 0;
    this.hashB = (this.hashB + sign * Math.imul(h ^ (h >>> 13), 0x2c1b3c6d)) | 0;
    this.partVersions.set(cell.part, (this.partVersions.get(cell.part) ?? 0) + 1);
    const cx = Math.floor(cell.x / EDIT_CHUNK), cy = Math.floor(cell.y / EDIT_CHUNK), cz = Math.floor(cell.z / EDIT_CHUNK);
    const key = chunkKeyOf(cell.part, cx, cy, cz);
    let set = this.chunkCells.get(key);
    if (sign > 0) { if (!set) this.chunkCells.set(key, (set = new Set())); set.add(cell); }
    else if (set) { set.delete(cell); if (set.size === 0) this.chunkCells.delete(key); }
    const bump = (k: string) => this.chunkVersions.set(k, (this.chunkVersions.get(k) ?? 0) + 1);
    bump(key);
    const lx = cell.x - cx * EDIT_CHUNK, ly = cell.y - cy * EDIT_CHUNK, lz = cell.z - cz * EDIT_CHUNK;
    if (lx === 0) bump(chunkKeyOf(cell.part, cx - 1, cy, cz)); else if (lx === EDIT_CHUNK - 1) bump(chunkKeyOf(cell.part, cx + 1, cy, cz));
    if (ly === 0) bump(chunkKeyOf(cell.part, cx, cy - 1, cz)); else if (ly === EDIT_CHUNK - 1) bump(chunkKeyOf(cell.part, cx, cy + 1, cz));
    if (lz === 0) bump(chunkKeyOf(cell.part, cx, cy, cz - 1)); else if (lz === EDIT_CHUNK - 1) bump(chunkKeyOf(cell.part, cx, cy, cz + 1));
  }
  /** The non-empty chunks of a part, each with its cells and current version. */
  chunksOf(part: string): EditChunk[] {
    part = this.resolve(part);
    const out: EditChunk[] = [];
    const prefix = `${part}|`;
    for (const [key, cells] of this.chunkCells) {
      if (!key.startsWith(prefix)) continue;
      const [cx, cy, cz] = key.slice(prefix.length).split(",").map(Number) as [number, number, number];
      out.push({ key, part, cx, cy, cz, version: this.chunkVersions.get(key) ?? 0, cells });
    }
    return out;
  }
  chunkVersion(key: string): number { return this.chunkVersions.get(key) ?? 0; }
  /** Changes whenever a cell of the part is added, removed or recolored. */
  partVersion(part: string): number { return this.partVersions.get(this.resolve(part)) ?? 0; }
  private putCell(cell: EditableCell): void {
    const key = partCellKey(cell.part, cell.x, cell.y, cell.z);
    const existing = this.cells.get(key);
    if (existing) this.addHash(existing, -1);
    this.addHash(cell, 1);
    this.cells.set(key, cell);
    const pos = cellKey(cell.x, cell.y, cell.z);
    const list = this.atPosition.get(pos);
    if (!list) this.atPosition.set(pos, [cell]);
    else if (existing) list[list.indexOf(existing)] = cell;
    else list.push(cell);
  }
  private dropCell(part: string, x: number, y: number, z: number): EditableCell | undefined {
    const key = partCellKey(part, x, y, z);
    const cell = this.cells.get(key);
    if (!cell) return undefined;
    this.addHash(cell, -1);
    this.cells.delete(key);
    const pos = cellKey(x, y, z);
    const list = this.atPosition.get(pos);
    if (list) { const index = list.indexOf(cell); if (index >= 0) list.splice(index, 1); if (list.length === 0) this.atPosition.delete(pos); }
    return cell;
  }
  private touch(key: CellKey): void {
    if (this.strokeBefore && !this.strokeBefore.has(key)) this.strokeBefore.set(key, this.cells.get(key));
  }
  /** Top-most part first (later in the part order = drawn on top). */
  private orderTop(list: readonly EditableCell[]): EditableCell[] {
    return [...list].sort((a, b) => this.partOrder.indexOf(b.part) - this.partOrder.indexOf(a.part));
  }

  // --- queries ---------------------------------------------------------------
  get size(): number { return this.cells.size; }
  get parts(): readonly string[] { return this.partOrder; }

  // --- voxel states ------------------------------------------------------------
  // A part's alternative snapshots are stored as extra LAYERS: cells whose part
  // id is `part@state`. Only the part's DISPLAYED state takes part in hits,
  // brushes and meshing; the editor drives which one that is (playhead in
  // Animate mode, the state chips in Model mode). Every brush works unchanged.
  private displayedStates = new Map<string, string>();
  /** The real part behind a layer id. */
  baseOf(id: string): string { const at = id.indexOf("@"); return at < 0 ? id : id.slice(0, at); }
  stateOf(id: string): string { const at = id.indexOf("@"); return at < 0 ? "base" : id.slice(at + 1); }
  displayedStateOf(part: string): string { return this.displayedStates.get(part) ?? "base"; }
  /** Pick which voxel state of a part is shown and edited (view state, not undoable). */
  setDisplayedState(part: string, state: string): boolean {
    const meta = this.meta.get(part);
    if (!meta || (state !== "base" && !meta.states.includes(state))) return false;
    if (this.displayedStateOf(part) === state) return true;
    if (state === "base") this.displayedStates.delete(part); else this.displayedStates.set(part, state);
    this.generation++;
    return true;
  }
  /** Layer id of the part's displayed state. */
  layerOf(part: string): string { return layerId(part, this.displayedStateOf(part)); }
  /** All layer ids of a part: base first, then its states. */
  layersOf(part: string): string[] { return [part, ...(this.meta.get(part)?.states ?? []).map((state) => layerId(part, state))]; }
  isLayerDisplayed(id: string): boolean { return this.stateOf(id) === this.displayedStateOf(this.baseOf(id)); }
  /** Exact-layer accessors for meshing every state (no displayed-state resolution). */
  cellOfLayer(layer: string, x: number, y: number, z: number): EditableCell | undefined { return this.cells.get(partCellKey(layer, x, y, z)); }
  chunksOfLayer(layer: string): EditChunk[] {
    const out: EditChunk[] = [];
    const prefix = `${layer}|`;
    for (const [key, cells] of this.chunkCells) {
      if (!key.startsWith(prefix)) continue;
      const [cx, cy, cz] = key.slice(prefix.length).split(",").map(Number) as [number, number, number];
      out.push({ key, part: layer, cx, cy, cz, version: this.chunkVersions.get(key) ?? 0, cells });
    }
    return out;
  }
  layerVersion(layer: string): number { return this.partVersions.get(layer) ?? 0; }
  cellsOfLayer(layer: string): VoxelCell[] {
    const out: VoxelCell[] = [];
    for (const cell of this.cells.values()) if (cell.part === layer) out.push({ x: cell.x, y: cell.y, z: cell.z, color: cell.color });
    return out;
  }
  /** A real part id resolves to its displayed layer; layer ids pass through. */
  private resolve(id: string): string { return this.meta.has(id) ? this.layerOf(id) : id; }
  /** Every displayed cell at a position (one per part). */
  at(x: number, y: number, z: number): EditableCell[] { return this.orderTop((this.atPosition.get(cellKey(x, y, z)) ?? []).filter((cell) => this.isLayerDisplayed(cell.part))); }
  /** A specific part's (displayed state's) cell — or an explicit layer's — or the top-most cell of any part. */
  get(x: number, y: number, z: number, part?: string): EditableCell | undefined {
    if (part !== undefined) return this.cells.get(partCellKey(this.resolve(part), x, y, z));
    return this.at(x, y, z)[0];
  }
  /** Create a state as a copy of another (default: the displayed one) and show it. */
  addState(part: string, name: string, from?: string): boolean {
    const meta = this.meta.get(part);
    if (!meta || name === "base" || meta.states.includes(name) || !/^[a-z0-9_]{1,40}$/i.test(name)) return false;
    return this.autoStroke(() => {
      const source = from === undefined ? this.layerOf(part) : layerId(part, from);
      const target = layerId(part, name);
      meta.states.push(name);
      for (const cell of [...this.cells.values()]) {
        if (cell.part !== source) continue;
        this.touch(partCellKey(target, cell.x, cell.y, cell.z));
        this.putCell({ ...cell, part: target });
      }
      this.generation++;
      this.setDisplayedState(part, name);
      return true;
    });
  }
  /** Remove a state: its cells go, keys pointing at it stop switching. */
  removeState(part: string, name: string): boolean {
    const meta = this.meta.get(part);
    if (!meta || !meta.states.includes(name)) return false;
    return this.autoStroke(() => {
      const layer = layerId(part, name);
      for (const cell of [...this.cells.values()]) {
        if (cell.part !== layer) continue;
        this.touch(partCellKey(layer, cell.x, cell.y, cell.z));
        this.dropCell(layer, cell.x, cell.y, cell.z);
      }
      meta.states = meta.states.filter((state) => state !== name);
      this.clipList = this.clipList.map((clip) => ({ ...clip, tracks: clip.tracks.map((track) => (track.part === part ? { ...track, keys: track.keys.map((key) => (key.state === name ? stripState(key) : key)) } : track)) }));
      if (this.displayedStateOf(part) === name) this.displayedStates.delete(part);
      this.generation++;
      return true;
    });
  }
  renameState(part: string, from: string, to: string): boolean {
    const meta = this.meta.get(part);
    if (!meta || !meta.states.includes(from) || meta.states.includes(to) || to === "base" || !/^[a-z0-9_]{1,40}$/i.test(to)) return false;
    return this.autoStroke(() => {
      const source = layerId(part, from), target = layerId(part, to);
      for (const cell of [...this.cells.values()]) {
        if (cell.part !== source) continue;
        this.touch(partCellKey(source, cell.x, cell.y, cell.z));
        this.touch(partCellKey(target, cell.x, cell.y, cell.z));
        this.dropCell(source, cell.x, cell.y, cell.z);
        this.putCell({ ...cell, part: target });
      }
      meta.states = meta.states.map((state) => (state === from ? to : state));
      this.clipList = this.clipList.map((clip) => ({ ...clip, tracks: clip.tracks.map((track) => (track.part === part ? { ...track, keys: track.keys.map((key) => (key.state === from ? { ...key, state: to } : key)) } : track)) }));
      if (this.displayedStateOf(part) === from) this.displayedStates.set(part, to);
      this.generation++;
      return true;
    });
  }
  isPartHidden(part: string): boolean { return this.hiddenParts.has(part); }
  partCellCount(part: string): number {
    let count = 0;
    for (const cell of this.cells.values()) if (cell.part === part) count++;
    return count;
  }
  /** Voxel count of every part in one pass (the layers list needs them all). */
  partCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const id of this.partOrder) counts.set(id, 0);
    for (const cell of this.cells.values()) { if (!this.isLayerDisplayed(cell.part)) continue; const base = this.baseOf(cell.part); counts.set(base, (counts.get(base) ?? 0) + 1); }
    return counts;
  }
  /** Cells of these parts (one pass), for overlays. */
  cellsOfParts(ids: readonly string[]): VoxelCell[] {
    const wanted = new Set(ids.map((id) => this.resolve(id)));
    const out: VoxelCell[] = [];
    for (const cell of this.cells.values()) if (wanted.has(cell.part)) out.push({ x: cell.x, y: cell.y, z: cell.z, color: cell.color });
    return out;
  }
  paletteInUse(): { color: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const cell of this.cells.values()) counts.set(cell.color, (counts.get(cell.color) ?? 0) + 1);
    return [...counts.entries()].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
  }
  /** Cells to render (positions may repeat across parts). Hidden parts left out. */
  visibleCells(): VoxelCell[] {
    const out: VoxelCell[] = [];
    const visible = new Map<string, boolean>();
    const shown = (part: string) => { let v = visible.get(part); if (v === undefined) { v = this.isPartVisible(part); visible.set(part, v); } return v; };
    for (const cell of this.cells.values()) if (shown(cell.part)) out.push({ x: cell.x, y: cell.y, z: cell.z, color: cell.color });
    return out;
  }
  get dirty(): boolean { return this.fingerprint() !== this.baseline || this.metaDirty; }
  markSaved(): void { this.baseline = this.fingerprint(); this.savedIndex = this.undoStack.length; this.metaBaseline = this.metaJson(); }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoDepth(): number { return this.undoStack.length; }
  get redoDepth(): number { return this.redoStack.length; }

  /** Cells 26-connected to the start THROUGH ITS OWN PART (a piece of one part). */
  connectedChunk(start: Coordinate, part?: string): EditableCell[] {
    const first = this.get(start.x, start.y, start.z, part);
    if (!first) return [];
    return this.flood(first, () => true);
  }
  /** Same-color region within the start cell's part. */
  sameColorRegion(start: Coordinate, part?: string): EditableCell[] {
    const first = this.get(start.x, start.y, start.z, part);
    if (!first) return [];
    return this.flood(first, (cell) => cell.color === first.color);
  }
  /** Similar-color region (normalized RGB distance <= tolerance) within the part. */
  similarColorRegion(start: Coordinate, tolerance: number, part?: string): EditableCell[] {
    const first = this.get(start.x, start.y, start.z, part);
    if (!first) return [];
    const reference = hexToRgb(first.color);
    const close = new Map<string, boolean>();
    const isClose = (hex: string): boolean => {
      let verdict = close.get(hex);
      if (verdict === undefined) { const [r, g, b] = hexToRgb(hex); verdict = Math.hypot(r - reference[0], g - reference[1], b - reference[2]) / 255 <= tolerance; close.set(hex, verdict); }
      return verdict;
    };
    return this.flood(first, (cell) => isClose(cell.color));
  }
  private flood(first: EditableCell, accept: (cell: EditableCell) => boolean): EditableCell[] {
    const seen = new Set<CellKey>([partCellKey(first.part, first.x, first.y, first.z)]);
    const queue: EditableCell[] = [first];
    const out: EditableCell[] = [];
    while (queue.length) {
      const cell = queue.pop()!;
      out.push(cell);
      for (const d of NEIGHBOURS_26) {
        const key = partCellKey(first.part, cell.x + d.x, cell.y + d.y, cell.z + d.z);
        if (seen.has(key)) continue;
        const next = this.cells.get(key);
        if (!next || !accept(next)) continue;
        seen.add(key);
        queue.push(next);
      }
    }
    return out;
  }
  partForNewCell(at: Coordinate): string {
    for (const d of NEIGHBOURS_6) { const list = this.at(at.x + d.x, at.y + d.y, at.z + d.z); if (list.length) return list[0]!.part; }
    for (const d of NEIGHBOURS_26) { const list = this.at(at.x + d.x, at.y + d.y, at.z + d.z); if (list.length) return list[0]!.part; }
    return this.partOrder[0] ?? "plant";
  }

  // --- rig metadata ----------------------------------------------------------
  partMeta(part: string): PartMeta | undefined { return this.meta.get(part); }
  get clips(): readonly AuthoredClip[] { return this.clipList; }
  private metaJson(): string { return JSON.stringify({ order: this.partOrder, meta: [...this.meta.entries()], clips: this.clipList, glow: [...this.glowByHex.entries()], lights: this.lightList, emitters: this.emitterList }); }
  // --- particle emitters ---------------------------------------------------------
  get emitters(): readonly ParticleEmitter[] { return this.emitterList; }
  emitter(id: string): ParticleEmitter | undefined { return this.emitterList.find((candidate) => candidate.id === id); }
  /** Add an emitter (its id is made unique). Returns the id used. */
  addEmitter(spec: ParticleEmitter): string {
    let id = spec.id.trim() || "fx";
    let n = 1;
    while (this.emitterList.some((candidate) => candidate.id === id)) id = `${spec.id.trim() || "fx"}${++n}`;
    this.emitterList.push({ ...(structuredClone(spec) as ParticleEmitter), id });
    this.generation++;
    return id;
  }
  updateEmitter(id: string, patch: Partial<ParticleEmitter>): void {
    const index = this.emitterList.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    const next = { ...this.emitterList[index]!, ...patch };
    // An explicit `undefined` clears an optional field: no part, no emission volume, no life curve.
    for (const key of Object.keys(patch) as (keyof ParticleEmitter)[]) if (patch[key] === undefined) delete (next as Record<string, unknown>)[key];
    // Renaming: clip events keep pointing at the emitter.
    if (patch.id && patch.id !== id) {
      if (this.emitterList.some((candidate) => candidate.id === patch.id)) return;
      this.clipList = this.clipList.map((clip) => ({ ...clip, events: clip.events?.map((event) => (event.emit === id ? { ...event, emit: patch.id! } : event)) }));
    }
    this.emitterList[index] = next;
    this.generation++;
  }
  removeEmitter(id: string): void {
    const index = this.emitterList.findIndex((candidate) => candidate.id === id);
    if (index < 0) return;
    this.emitterList.splice(index, 1);
    this.generation++;
  }
  // --- glow & lights -----------------------------------------------------------
  /** Glow intensity of a colour (0 = lit normally). */
  glowOf(hex: string): number { return this.glowByHex.get(hex.toLowerCase()) ?? 0; }
  /** Mark a colour as glowing (intensity ≤ 0 clears it). Call inside a stroke to make it undoable. */
  setGlow(hex: string, intensity: number): void {
    const lower = hex.toLowerCase();
    if (intensity > 0) this.glowByHex.set(lower, Math.round(intensity * 100) / 100); else this.glowByHex.delete(lower);
    this.generation++;
  }
  /** Changes whenever a glow assignment changes: part of the editor's remesh signatures. */
  glowSignature(): string { return [...this.glowByHex.entries()].sort().map(([hex, value]) => `${hex}:${value}`).join(","); }
  get lights(): readonly ModelLight[] { return this.lightList; }
  addLight(light: ModelLight): number { this.lightList.push(structuredClone(light) as ModelLight); this.generation++; return this.lightList.length - 1; }
  updateLight(index: number, patch: Partial<ModelLight>): void {
    const current = this.lightList[index];
    if (!current) return;
    this.lightList[index] = { ...current, ...patch };
    this.generation++;
  }
  removeLight(index: number): void { if (index >= 0 && index < this.lightList.length) { this.lightList.splice(index, 1); this.generation++; } }
  get metaDirty(): boolean { return this.metaJson() !== this.metaBaseline; }
  childrenOf(part: string | undefined): string[] { return this.partOrder.filter((id) => this.meta.get(id)?.parent === part); }
  descendantsOf(part: string): string[] {
    const out: string[] = [];
    const walk = (id: string) => { for (const child of this.childrenOf(id)) { out.push(child); walk(child); } };
    walk(part);
    return out;
  }
  isPartVisible(part: string): boolean {
    if (!this.isLayerDisplayed(part)) return false;
    let cursor: string | undefined = this.baseOf(part);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) { if (this.hiddenParts.has(cursor)) return false; seen.add(cursor); cursor = this.meta.get(cursor)?.parent; }
    return true;
  }
  depthOf(part: string): number {
    let depth = 0;
    let cursor = this.meta.get(part)?.parent;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) { depth++; seen.add(cursor); cursor = this.meta.get(cursor)?.parent; }
    return depth;
  }
  commonAncestor(partIds: readonly string[]): string | undefined {
    const chains = partIds.map((id) => {
      const chain: string[] = [];
      let cursor = this.meta.get(id)?.parent;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) { chain.unshift(cursor); seen.add(cursor); cursor = this.meta.get(cursor)?.parent; }
      return chain;
    });
    if (chains.length === 0) return undefined;
    let common: string | undefined;
    for (let depth = 0; ; depth++) {
      const candidate = chains[0]![depth];
      if (candidate === undefined || chains.some((chain) => chain[depth] !== candidate)) break;
      common = candidate;
    }
    return common;
  }
  addPart(id: string, parent?: string): boolean {
    if (!/^[a-z0-9_]{1,40}$/i.test(id) || this.meta.has(id)) return false;
    return this.autoStroke(() => {
      const anchor = parent ? this.meta.get(parent) : undefined;
      this.partOrder.push(id);
      this.meta.set(id, { pivot: anchor ? [...anchor.pivot] as [number, number, number] : [0, 0, 0], parent: parent && this.meta.has(parent) ? parent : undefined, sockets: {}, transform: IDENTITY_TRANSFORM(), opacity: 1, states: [] });
      this.generation++;
      return true;
    });
  }
  /** Set the stored rest transform (any channel may be omitted to keep it). */
  setPartTransform(part: string, transform: Partial<PartMeta["transform"]>): void {
    const entry = this.meta.get(part);
    if (!entry) return;
    this.autoStroke(() => {
      entry.transform = {
        rotation: (transform.rotation ?? entry.transform.rotation).map((v) => round4(v)) as [number, number, number],
        position: (transform.position ?? entry.transform.position).map((v) => round4(v)) as [number, number, number],
        scale: (transform.scale ?? entry.transform.scale).map((v) => Math.max(0.01, round4(v))) as [number, number, number],
      };
      this.generation++;
    });
  }
  /** How see-through a part is at rest (1 = solid). */
  partOpacity(part: string): number { return this.meta.get(part)?.opacity ?? 1; }
  setPartOpacity(part: string, opacity: number): void {
    const entry = this.meta.get(part);
    if (!entry) return;
    entry.opacity = Math.min(1, Math.max(0.05, Math.round(opacity * 100) / 100));
    this.generation++;
  }

  /** Write the stored transform into the voxels (re-gridding) and reset it. */
  bakePartTransform(part: string): number {
    const entry = this.meta.get(part);
    if (!entry || isIdentity(entry.transform)) return 0;
    return this.autoStroke(() => {
      const { rotation, position, scale } = entry.transform;
      const placed = this.transformPart(part, { rotate: rotation, translate: position, scale });
      // transformPart moved the pivot along with the cells; the rest transform is now identity.
      for (const id of [part, ...this.descendantsOf(part)]) { const meta = this.meta.get(id)!; if (id === part) meta.transform = IDENTITY_TRANSFORM(); }
      return placed;
    });
  }
  renamePart(from: string, to: string): boolean {
    if (from === to || !this.meta.has(from) || this.meta.has(to) || !/^[a-z0-9_]{1,40}$/i.test(to)) return false;
    return this.autoStroke(() => {
      this.partOrder = this.partOrder.map((id) => (id === from ? to : id));
      this.meta.set(to, this.meta.get(from)!);
      this.meta.delete(from);
      for (const entry of this.meta.values()) if (entry.parent === from) entry.parent = to;
      for (const cell of [...this.cells.values()]) {
        if (this.baseOf(cell.part) !== from) continue;
        const target = layerId(to, this.stateOf(cell.part));
        this.touch(partCellKey(cell.part, cell.x, cell.y, cell.z));
        this.touch(partCellKey(target, cell.x, cell.y, cell.z));
        this.dropCell(cell.part, cell.x, cell.y, cell.z);
        this.putCell({ ...cell, part: target });
      }
      if (this.hiddenParts.delete(from)) this.hiddenParts.add(to);
      const shown = this.displayedStates.get(from);
      if (shown !== undefined) { this.displayedStates.delete(from); this.displayedStates.set(to, shown); }
      this.clipList = this.clipList.map((clip) => ({ ...clip, tracks: clip.tracks.map((track) => (track.part === from ? { ...track, part: to } : track)) }));
      this.generation++;
      return true;
    });
  }
  /** Move the cells at these positions (of `fromPart`, or the top-most part) into `part`. */
  assign(coordinates: readonly Coordinate[], part: string, fromPart?: string): number {
    if (!this.meta.has(this.baseOf(part))) return 0;
    part = this.resolve(part);
    let changed = 0;
    for (const c of coordinates) {
      const cell = this.get(c.x, c.y, c.z, fromPart);
      if (!cell || cell.part === this.resolve(part) || this.hiddenParts.has(this.baseOf(cell.part))) continue;
      this.touch(partCellKey(cell.part, c.x, c.y, c.z));
      this.touch(partCellKey(part, c.x, c.y, c.z));
      this.dropCell(cell.part, c.x, c.y, c.z);
      this.putCell({ ...cell, part });
      changed++;
    }
    if (changed) this.generation++;
    return changed;
  }
  setPivot(part: string, cell: Coordinate): void {
    const entry = this.meta.get(part);
    if (!entry || (entry.pivot[0] === cell.x && entry.pivot[1] === cell.y && entry.pivot[2] === cell.z)) return;
    this.autoStroke(() => { entry.pivot = [cell.x, cell.y, cell.z]; this.generation++; });
  }
  setParent(part: string, parent: string | undefined): boolean {
    const entry = this.meta.get(part);
    if (!entry) return false;
    if (parent !== undefined) {
      if (parent === part || !this.meta.has(parent)) return false;
      let cursor: string | undefined = parent;
      while (cursor) { if (cursor === part) return false; cursor = this.meta.get(cursor)?.parent; }
    }
    if (entry.parent === parent) return true;
    this.autoStroke(() => { entry.parent = parent; this.generation++; });
    return true;
  }
  setSocket(part: string, name: string, cell: Coordinate | null): void {
    const entry = this.meta.get(part);
    if (!entry || !/^[a-z0-9_]{1,40}$/i.test(name)) return;
    this.autoStroke(() => { if (cell) entry.sockets[name] = [cell.x, cell.y, cell.z]; else delete entry.sockets[name]; this.generation++; });
  }
  groupParts(partIds: readonly string[], groupId: string): boolean {
    const chosen = [...new Set(partIds.filter((id) => this.meta.has(id)))];
    if (chosen.length === 0 || !/^[a-z0-9_]{1,40}$/i.test(groupId) || this.meta.has(groupId)) return false;
    const chosenSet = new Set(chosen);
    const tops = chosen.filter((id) => { let cursor = this.meta.get(id)?.parent; while (cursor) { if (chosenSet.has(cursor)) return false; cursor = this.meta.get(cursor)?.parent; } return true; });
    const parent = this.commonAncestor(tops);
    return this.autoStroke(() => {
      const pivots = tops.map((id) => this.meta.get(id)!.pivot);
      const n = pivots.length;
      const center: [number, number, number] = [Math.round(pivots.reduce((sum, p) => sum + p[0], 0) / n), Math.round(pivots.reduce((sum, p) => sum + p[1], 0) / n), Math.round(pivots.reduce((sum, p) => sum + p[2], 0) / n)];
      const firstIndex = Math.min(...tops.map((id) => this.partOrder.indexOf(id)));
      this.partOrder.splice(firstIndex, 0, groupId);
      this.meta.set(groupId, { pivot: center, parent, sockets: {}, transform: IDENTITY_TRANSFORM(), opacity: 1, states: [] });
      for (const id of tops) this.meta.get(id)!.parent = groupId;
      this.generation++;
      return true;
    });
  }
  ungroupPart(groupId: string): boolean {
    const meta = this.meta.get(groupId);
    if (!meta) return false;
    const children = this.childrenOf(groupId);
    if (children.length === 0) return false;
    return this.autoStroke(() => {
      for (const child of children) this.meta.get(child)!.parent = meta.parent;
      if (this.partCellCount(groupId) === 0 && this.partOrder.length > 1) {
        this.meta.delete(groupId);
        this.partOrder = this.partOrder.filter((id) => id !== groupId);
        this.hiddenParts.delete(groupId);
        this.clipList = this.clipList.map((clip) => ({ ...clip, tracks: clip.tracks.filter((track) => track.part !== groupId) }));
      }
      this.generation++;
      return true;
    });
  }

  // --- copy / paste / duplicate / transform ------------------------------------
  copyPart(part: string): PartClipboard | null {
    const meta = this.meta.get(part);
    if (!meta) return null;
    const cells: PartClipboard["cells"] = [];
    for (const cell of this.cells.values()) if (cell.part === part) cells.push({ x: cell.x - meta.pivot[0], y: cell.y - meta.pivot[1], z: cell.z - meta.pivot[2], color: cell.color });
    return { source: part, pivot: [...meta.pivot] as [number, number, number], cells, sockets: structuredClone(meta.sockets) };
  }
  /** New part from a clipboard with its pivot at `at`. Other parts are never
   * touched: the pasted part simply overlaps them where they coincide. */
  pastePart(clip: PartClipboard, id: string, at?: Coordinate, parent?: string): boolean {
    if (!this.addPart(id, parent)) return false;
    const pivot = at ?? { x: clip.pivot[0], y: clip.pivot[1], z: clip.pivot[2] };
    const meta = this.meta.get(id)!;
    meta.pivot = [pivot.x, pivot.y, pivot.z];
    for (const [name, cell] of Object.entries(clip.sockets)) meta.sockets[name] = [cell[0] - clip.pivot[0] + pivot.x, cell[1] - clip.pivot[1] + pivot.y, cell[2] - clip.pivot[2] + pivot.z];
    for (const cell of clip.cells) {
      const x = cell.x + pivot.x, y = cell.y + pivot.y, z = cell.z + pivot.z;
      this.touch(partCellKey(id, x, y, z));
      this.putCell({ x, y, z, color: cell.color, part: id });
    }
    this.generation++;
    return true;
  }
  /** Positions where a paste would coincide with existing cells of other parts (informational). */
  pasteCollisions(clip: PartClipboard, at: Coordinate): number {
    let collisions = 0;
    for (const cell of clip.cells) if (this.atPosition.has(cellKey(cell.x + at.x, cell.y + at.y, cell.z + at.z))) collisions++;
    return collisions;
  }
  duplicatePart(part: string, id: string, offset: Coordinate = { x: 0, y: 0, z: 0 }): boolean {
    const clip = this.copyPart(part);
    const meta = this.meta.get(part);
    if (!clip || !meta) return false;
    return this.pastePart(clip, id, { x: meta.pivot[0] + offset.x, y: meta.pivot[1] + offset.y, z: meta.pivot[2] + offset.z }, meta.parent);
  }
  transformPart(part: string, transform: PartTransform): number { return this.transformParts([part], transform); }
  /** Bake a transform into the voxels of these parts and their descendants,
   * nearest-neighbour resampled around the shared pivot. Other parts are never
   * affected — overlapping is allowed. Returns the number of cells placed. */
  transformParts(partIds: readonly string[], transform: PartTransform, pivotOverride?: Coordinate): number {
    const roots = partIds.filter((id) => this.meta.has(id));
    if (roots.length === 0) return 0;
    const meta = this.meta.get(roots[0]!)!;
    const family = [...new Set(roots.flatMap((id) => [id, ...this.descendantsOf(id)]))];
    const familySet = new Set(family);
    const source = [...this.cells.values()].filter((cell) => familySet.has(this.baseOf(cell.part)));
    if (source.length === 0 && !transform.translate) return 0;
    const pivot: readonly [number, number, number] = pivotOverride ? [pivotOverride.x, pivotOverride.y, pivotOverride.z] : meta.pivot;
    const scale = typeof transform.scale === "number" ? [transform.scale, transform.scale, transform.scale] : (transform.scale ?? [1, 1, 1]);
    const mirror = transform.mirror ?? [false, false, false];
    const rotate = (transform.rotate ?? [0, 0, 0]).map((deg) => (deg * Math.PI) / 180);
    const translate = transform.translate ?? [0, 0, 0];
    const forward = (x: number, y: number, z: number): [number, number, number] => {
      let vx = (x - pivot[0]) * (mirror[0] ? -1 : 1) * scale[0]!;
      let vy = (y - pivot[1]) * (mirror[1] ? -1 : 1) * scale[1]!;
      let vz = (z - pivot[2]) * (mirror[2] ? -1 : 1) * scale[2]!;
      [vx, vy, vz] = rotateXYZ(vx, vy, vz, rotate as [number, number, number]);
      return [vx + pivot[0] + translate[0], vy + pivot[1] + translate[1], vz + pivot[2] + translate[2]];
    };
    const inverse = (x: number, y: number, z: number): [number, number, number] => {
      let vx = x - pivot[0] - translate[0], vy = y - pivot[1] - translate[1], vz = z - pivot[2] - translate[2];
      [vx, vy, vz] = rotateXYZ(vx, vy, vz, rotate.map((r) => -r).reverse() as [number, number, number], true);
      return [vx / scale[0]! * (mirror[0] ? -1 : 1) + pivot[0], vy / scale[1]! * (mirror[1] ? -1 : 1) + pivot[1], vz / scale[2]! * (mirror[2] ? -1 : 1) + pivot[2]];
    };
    // One position -> the family cells there (usually one), so the resample
    // loop does a single lookup per target cell instead of one per part.
    const sourceByPos = new Map<CellKey, EditableCell[]>();
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const cell of source) {
      const posKey = cellKey(cell.x, cell.y, cell.z);
      const list = sourceByPos.get(posKey);
      if (list) list.push(cell); else sourceByPos.set(posKey, [cell]);
      for (const corner of [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, -0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, 0.5]]) {
        const f = forward(cell.x + corner[0]!, cell.y + corner[1]!, cell.z + corner[2]!);
        min = min.map((v, i) => Math.min(v, f[i]!)); max = max.map((v, i) => Math.max(v, f[i]!));
      }
    }
    for (const cell of source) { this.touch(partCellKey(cell.part, cell.x, cell.y, cell.z)); this.dropCell(cell.part, cell.x, cell.y, cell.z); }
    let placed = 0;
    if (source.length) {
      const pureTranslate = !transform.rotate?.some((v) => v) && !transform.mirror?.some((v) => v) && scale.every((v) => v === 1);
      if (pureTranslate) {
        // Exact shift: no resampling, just offset every source cell.
        for (const cell of source) {
          const x = cell.x + translate[0], y = cell.y + translate[1], z = cell.z + translate[2];
          this.touch(partCellKey(cell.part, x, y, z));
          this.putCell({ x, y, z, color: cell.color, part: cell.part });
          placed++;
        }
      } else {
        for (let x = Math.floor(min[0]!); x <= Math.ceil(max[0]!); x++) for (let y = Math.floor(min[1]!); y <= Math.ceil(max[1]!); y++) for (let z = Math.floor(min[2]!); z <= Math.ceil(max[2]!); z++) {
          const [sx, sy, sz] = inverse(x, y, z);
          const origins = sourceByPos.get(cellKey(Math.round(sx), Math.round(sy), Math.round(sz)));
          if (!origins) continue;
          for (const origin of origins) {
            this.touch(partCellKey(origin.part, x, y, z));
            this.putCell({ x, y, z, color: origin.color, part: origin.part });
            placed++;
          }
        }
      }
    }
    for (const id of family) {
      const entry = this.meta.get(id)!;
      const p = forward(entry.pivot[0], entry.pivot[1], entry.pivot[2]);
      entry.pivot = [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];
      for (const [name, cell] of Object.entries(entry.sockets)) {
        const q = forward(cell[0], cell[1], cell[2]);
        entry.sockets[name] = [Math.round(q[0]), Math.round(q[1]), Math.round(q[2])];
      }
    }
    this.generation++;
    return placed;
  }

  // --- clips -----------------------------------------------------------------
  upsertClip(clip: AuthoredClip): void {
    this.autoStroke(() => {
      const index = this.clipList.findIndex((candidate) => candidate.id === clip.id);
      if (index >= 0) this.clipList[index] = clip; else this.clipList.push(clip);
      this.generation++;
    });
  }
  removeClip(id: string): void { this.autoStroke(() => { this.clipList = this.clipList.filter((clip) => clip.id !== id); this.generation++; }); }
  toggleKey(clipId: string, part: string, t: number, disabled?: boolean): void {
    const clip = this.clipList.find((candidate) => candidate.id === clipId);
    const key = clip?.tracks.find((track) => track.part === part)?.keys.find((candidate) => Math.abs(candidate.t - t) < 1e-6);
    if (!clip || !key) return;
    this.upsertClip(withKey(clip, part, { ...key, disabled: disabled ?? !key.disabled }));
  }
  /** How a track's opacity renders (translucent fade or crisp voxel dither). */
  setTrackFade(clipId: string, part: string, fade: "fade" | "dither" | undefined): void {
    const clip = this.clipList.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const tracks = clip.tracks.some((track) => track.part === part) ? clip.tracks.map((track) => (track.part === part ? { ...track, fade } : track)) : [...clip.tracks, { part, keys: [], fade }];
    const cleaned = tracks.map((track) => { if (track.fade === undefined) { const { fade: _fade, ...rest } = track; return rest; } return track; });
    this.upsertClip({ ...clip, tracks: cleaned });
  }
  setKey(clipId: string, part: string, key: ClipKey): void {
    const clip = this.clipList.find((candidate) => candidate.id === clipId);
    if (clip) this.upsertClip(withKey(clip, part, key));
  }
  removeKey(clipId: string, part: string, t: number): void {
    const clip = this.clipList.find((candidate) => candidate.id === clipId);
    if (clip) this.upsertClip(withoutKey(clip, part, t));
  }
  setEvent(clipId: string, event: ClipEvent, replaceAt?: number): void {
    const clip = this.clipList.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    const events = (clip.events ?? []).filter((candidate) => replaceAt === undefined || Math.abs(candidate.t - replaceAt) >= 1e-6);
    events.push(event);
    events.sort((a, b) => a.t - b.t);
    this.upsertClip({ ...clip, events });
  }
  removeEvent(clipId: string, t: number): void {
    const clip = this.clipList.find((candidate) => candidate.id === clipId);
    if (!clip) return;
    this.upsertClip({ ...clip, events: (clip.events ?? []).filter((candidate) => Math.abs(candidate.t - t) >= 1e-6) });
  }

  // --- strokes / history -----------------------------------------------------
  beginStroke(): void {
    if (this.strokeBefore) return;
    this.strokeBefore = new Map();
    this.strokeMetaBefore = this.metaJson();
  }
  endStroke(): void {
    if (!this.strokeBefore) return;
    const before = this.strokeBefore;
    this.strokeBefore = null;
    const after = new Map<CellKey, EditableCell | undefined>();
    for (const [key, previous] of before) {
      const current = this.cells.get(key);
      if (sameCell(previous, current)) before.delete(key);
      else after.set(key, current);
    }
    const metaAfter = this.metaJson();
    const metaChanged = metaAfter !== this.strokeMetaBefore;
    if (before.size === 0 && !metaChanged) return;
    const delta: EditDelta = { before, after };
    if (metaChanged) { delta.metaBefore = this.strokeMetaBefore; delta.metaAfter = metaAfter; }
    this.undoStack.push(delta);
    if (this.undoStack.length > HISTORY_DEPTH) { this.undoStack.shift(); this.savedIndex = this.savedIndex > 0 ? this.savedIndex - 1 : -1; }
    this.redoStack = [];
  }
  undo(): boolean {
    const delta = this.undoStack.pop();
    if (!delta) return false;
    this.applyDelta(delta.before);
    if (delta.metaBefore !== undefined) this.applyMetaJson(delta.metaBefore);
    this.redoStack.push(delta);
    return true;
  }
  redo(): boolean {
    const delta = this.redoStack.pop();
    if (!delta) return false;
    this.applyDelta(delta.after);
    if (delta.metaAfter !== undefined) this.applyMetaJson(delta.metaAfter);
    this.undoStack.push(delta);
    return true;
  }
  private autoStroke<T>(edit: () => T): T {
    if (this.strokeBefore) return edit();
    this.beginStroke();
    try { return edit(); } finally { this.endStroke(); }
  }
  private applyMetaJson(json: string): void {
    const parsed = JSON.parse(json) as { order: string[]; meta: [string, PartMeta][]; clips: AuthoredClip[]; glow?: [string, number][]; lights?: ModelLight[]; emitters?: ParticleEmitter[] };
    this.partOrder = parsed.order;
    this.meta.clear();
    for (const [id, entry] of parsed.meta) this.meta.set(id, entry);
    this.clipList = parsed.clips;
    this.glowByHex = new Map(parsed.glow ?? []);
    this.lightList = parsed.lights ?? [];
    this.emitterList = parsed.emitters ?? [];
    this.generation++;
  }
  exportHistory(): SerializedHistory {
    const pack = (stack: EditDelta[]) => stack.map((delta) => [
      [...delta.before.entries()].map(([key, cell]) => [key, cell ?? null] as [CellKey, EditableCell | null]),
      [...delta.after.entries()].map(([key, cell]) => [key, cell ?? null] as [CellKey, EditableCell | null]),
    ]);
    const packMeta = (stack: EditDelta[]) => stack.map((delta) => (delta.metaBefore !== undefined && delta.metaAfter !== undefined ? [delta.metaBefore, delta.metaAfter] as [string, string] : null));
    return { fingerprint: this.fingerprint(), baselineFingerprint: this.baseline, savedIndex: this.savedIndex, undo: pack(this.undoStack), redo: pack(this.redoStack), undoMeta: packMeta(this.undoStack), redoMeta: packMeta(this.redoStack) };
  }
  importHistory(history: SerializedHistory): boolean {
    if (!history || !Array.isArray(history.undo) || !Array.isArray(history.redo)) return false;
    const current = this.fingerprint();
    const unpack = (stack: SerializedHistory["undo"], metas?: ([string, string] | null)[]) => stack.map(([before, after], index) => {
      const delta: EditDelta = {
        before: new Map(before!.map(([key, cell]) => [key, cell ?? undefined])),
        after: new Map(after!.map(([key, cell]) => [key, cell ?? undefined])),
      };
      const meta = metas?.[index];
      if (meta) { delta.metaBefore = meta[0]; delta.metaAfter = meta[1]; }
      return delta;
    });
    if (history.fingerprint === current) {
      this.undoStack = unpack(history.undo, history.undoMeta).slice(-HISTORY_DEPTH);
      this.redoStack = unpack(history.redo, history.redoMeta).slice(-HISTORY_DEPTH);
      this.baseline = current;
      this.savedIndex = this.undoStack.length;
      return true;
    }
    if (history.baselineFingerprint !== current || !(history.savedIndex >= 0)) return false;
    const undo = unpack(history.undo, history.undoMeta);
    const redo = unpack(history.redo, history.redoMeta);
    const applyForward = (delta: EditDelta) => { this.applyDelta(delta.after); if (delta.metaAfter !== undefined) this.applyMetaJson(delta.metaAfter); };
    const applyBackward = (delta: EditDelta) => { this.applyDelta(delta.before); if (delta.metaBefore !== undefined) this.applyMetaJson(delta.metaBefore); };
    if (undo.length >= history.savedIndex) for (const delta of undo.slice(history.savedIndex)) applyForward(delta);
    else {
      const undone = history.savedIndex - undo.length;
      if (undone > redo.length) return false;
      for (const delta of redo.slice(-undone)) applyBackward(delta);
    }
    if (this.fingerprint() !== history.fingerprint) {
      if (undo.length >= history.savedIndex) for (const delta of undo.slice(history.savedIndex).reverse()) applyBackward(delta);
      else for (const delta of redo.slice(-(history.savedIndex - undo.length)).reverse()) applyForward(delta);
      return false;
    }
    this.undoStack = undo;
    this.redoStack = redo;
    this.baseline = history.baselineFingerprint;
    this.savedIndex = history.savedIndex;
    return true;
  }
  private applyDelta(values: Map<CellKey, EditableCell | undefined>): void {
    for (const [key, cell] of values) {
      if (cell) this.putCell(cell);
      else {
        const [part, pos] = key.split("|");
        const [x, y, z] = pos!.split(",").map(Number);
        this.dropCell(part!, x!, y!, z!);
      }
    }
    this.generation++;
  }

  // --- edits -----------------------------------------------------------------
  /** Paint cells at these positions; `part` limits it to one part (the one
   * under the pointer), otherwise every visible part's cell there is painted. */
  paint(coordinates: readonly Coordinate[], color: string, part?: string): number {
    let changed = 0;
    for (const c of coordinates) {
      const targets = part !== undefined ? [this.get(c.x, c.y, c.z, part)].filter(Boolean) as EditableCell[] : this.at(c.x, c.y, c.z);
      for (const cell of targets) {
        if (cell.color === color || this.hiddenParts.has(this.baseOf(cell.part))) continue;
        this.touch(partCellKey(cell.part, c.x, c.y, c.z));
        this.putCell({ ...cell, color });
        changed++;
      }
    }
    if (changed) this.generation++;
    return changed;
  }
  erase(coordinates: readonly Coordinate[], part?: string): number {
    let changed = 0;
    for (const c of coordinates) {
      const targets = part !== undefined ? [this.get(c.x, c.y, c.z, part)].filter(Boolean) as EditableCell[] : this.at(c.x, c.y, c.z);
      for (const cell of targets) {
        if (this.hiddenParts.has(this.baseOf(cell.part))) continue;
        this.touch(partCellKey(cell.part, c.x, c.y, c.z));
        this.dropCell(cell.part, c.x, c.y, c.z);
        changed++;
      }
    }
    if (changed) this.generation++;
    return changed;
  }
  /** Add cells to a part; other parts at the same position are left alone. */
  add(coordinates: readonly Coordinate[], color: string, part?: string): number {
    let changed = 0;
    for (const c of coordinates) {
      const target = this.resolve(part ?? this.partForNewCell(c));
      if (!this.meta.has(this.baseOf(target)) || this.cells.has(partCellKey(target, c.x, c.y, c.z))) continue;
      this.touch(partCellKey(target, c.x, c.y, c.z));
      this.putCell({ x: c.x, y: c.y, z: c.z, color, part: target });
      changed++;
    }
    if (changed) this.generation++;
    return changed;
  }
  floodFill(start: Coordinate, color: string, part?: string): number {
    const region = this.sameColorRegion(start, part);
    if (region.length === 0 || region[0]!.color === color) return 0;
    return this.paint(region, color, region[0]!.part);
  }
  floodFillSimilar(start: Coordinate, color: string, tolerance = 0.22, part?: string): number {
    const region = this.similarColorRegion(start, tolerance, part);
    return region.length ? this.paint(region, color, region[0]!.part) : 0;
  }
  deleteChunk(start: Coordinate, part?: string): number {
    const chunk = this.connectedChunk(start, part);
    return chunk.length ? this.erase(chunk, chunk[0]!.part) : 0;
  }
  replaceColor(from: string, to: string): number {
    if (from === to) return 0;
    // A recoloured glowing colour keeps glowing.
    const glow = this.glowByHex.get(from.toLowerCase());
    if (glow !== undefined) { this.glowByHex.delete(from.toLowerCase()); this.glowByHex.set(to.toLowerCase(), glow); }
    let changed = 0;
    for (const cell of [...this.cells.values()]) {
      if (cell.color !== from) continue;
      this.touch(partCellKey(cell.part, cell.x, cell.y, cell.z));
      this.putCell({ ...cell, color: to });
      changed++;
    }
    if (changed) this.generation++;
    return changed;
  }
  /** Pour every voxel of `sources` into `target`; the sources vanish and their
   * children, sockets and clip-free hierarchy move over — one undo step.
   * Stored transforms are baked first so nothing shifts on screen; where both
   * parts have a voxel at the same position the target keeps its own. */
  mergeParts(sources: readonly string[], target: string): number {
    const targetMeta = this.meta.get(target);
    const list = [...new Set(sources)].filter((id) => id !== target && this.meta.has(id));
    if (!targetMeta || list.length === 0) return 0;
    return this.autoStroke(() => {
      if (!isIdentity(targetMeta.transform)) this.bakePartTransform(target);
      for (const source of list) if (!isIdentity(this.meta.get(source)!.transform)) this.bakePartTransform(source);
      const wanted = new Set(list);
      const cells = [...this.cells.values()].filter((cell) => wanted.has(this.baseOf(cell.part)));
      let moved = 0;
      for (const cell of cells) {
        const state = this.stateOf(cell.part);
        const targetLayer = layerId(target, state);
        if (state !== "base" && !targetMeta.states.includes(state)) targetMeta.states.push(state);
        this.touch(partCellKey(cell.part, cell.x, cell.y, cell.z));
        this.dropCell(cell.part, cell.x, cell.y, cell.z);
        if (this.cells.has(partCellKey(targetLayer, cell.x, cell.y, cell.z))) continue;
        this.touch(partCellKey(targetLayer, cell.x, cell.y, cell.z));
        this.putCell({ ...cell, part: targetLayer });
        moved++;
      }
      for (const source of list) {
        const meta = this.meta.get(source)!;
        for (const [name, cell] of Object.entries(meta.sockets)) if (!(name in targetMeta.sockets)) targetMeta.sockets[name] = cell;
        // Merging a parent into its child: the child steps into the parent's place.
        if (targetMeta.parent === source) targetMeta.parent = meta.parent;
        for (const entry of this.meta.values()) if (entry.parent === source) entry.parent = target;
        this.meta.delete(source);
        this.partOrder = this.partOrder.filter((id) => id !== source);
        this.hiddenParts.delete(source);
        this.clipList = this.clipList.map((clip) => ({ ...clip, tracks: clip.tracks.filter((track) => track.part !== source) }));
      }
      this.generation++;
      return moved;
    });
  }
  /** Which small parts ("fragments": at most `threshold` voxels, ignoring
   * empty joint parts) would fold into the part they touch most. Fragments are
   * taken smallest first and a fragment already folded counts as its target,
   * so a flake that only touches another flake still ends up on the leaf. */
  tidyPlan(threshold: number): TidyPlan {
    const counts = this.partCounts();
    const largest = Math.max(0, ...counts.values());
    const fragments = this.partOrder.filter((id) => (counts.get(id) ?? 0) > 0 && (counts.get(id) ?? 0) <= threshold).sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0) || a.localeCompare(b));
    const wanted = new Set(fragments);
    const byPart = new Map<string, EditableCell[]>();
    for (const cell of this.cells.values()) { if (!wanted.has(cell.part)) continue; let list = byPart.get(cell.part); if (!list) byPart.set(cell.part, (list = [])); list.push(cell); }
    const alias = new Map<string, string>();
    const resolve = (id: string) => { let guard = 0; while (alias.has(id) && guard++ < 100000) id = alias.get(id)!; return id; };
    const merges = new Map<string, string>();
    const floating: string[] = [];
    let voxels = 0;
    for (const id of fragments) {
      const cells = byPart.get(id) ?? [];
      voxels += cells.length;
      const touch = new Map<string, number>();
      for (const cell of cells) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          for (const other of this.at(cell.x + dx, cell.y + dy, cell.z + dz)) {
            const owner = resolve(other.part);
            if (owner === id) continue;
            touch.set(owner, (touch.get(owner) ?? 0) + 1);
          }
        }
      }
      let best: { id: string; n: number } | null = null;
      for (const [owner, n] of touch) if (!best || n > best.n || (n === best.n && owner < best.id)) best = { id: owner, n };
      if (best) { merges.set(id, best.id); alias.set(id, best.id); } else floating.push(id);
    }
    const empty = this.partOrder.filter((id) => (counts.get(id) ?? 0) === 0 && this.childrenOf(id).length === 0 && this.partOrder.length > 1);
    return { threshold, largest, fragments, merges, floating, empty, voxels, total: this.cells.size };
  }
  /** Carry out a tidy plan in one undo step. `touch`: every fragment joins the
   * part it touches (floating ones are dropped); `single`: all fragments become
   * one new part; `delete`: all fragments are removed. */
  applyTidy(plan: TidyPlan, mode: "touch" | "single" | "delete", singleId = "fragments"): { merged: number; deleted: number } {
    return this.autoStroke(() => {
      const all = plan.fragments.filter((id) => this.meta.has(id));
      let merged = 0, deleted = 0;
      for (const id of plan.empty) if (this.meta.has(id) && this.childrenOf(id).length === 0 && this.partOrder.length > 1) { this.deletePart(id, true); deleted++; }
      if (mode === "delete") { for (const id of all) { this.deletePart(id, true); deleted++; } return { merged, deleted }; }
      if (mode === "single") {
        let id = singleId;
        for (let n = 2; this.meta.has(id); n++) id = `${singleId}_${n}`;
        const largestPart = [...this.partCounts().entries()].filter(([part]) => !all.includes(part)).sort((a, b) => b[1] - a[1])[0]?.[0];
        this.addPart(id, largestPart);
        merged = this.mergeParts(all, id);
        return { merged, deleted };
      }
      const resolve = (id: string) => { let guard = 0; while (plan.merges.has(id) && guard++ < 100000) id = plan.merges.get(id)!; return id; };
      const groups = new Map<string, string[]>();
      for (const source of plan.merges.keys()) {
        const target = resolve(source);
        if (target === source || !this.meta.has(target)) continue;
        let list = groups.get(target);
        if (!list) groups.set(target, (list = []));
        list.push(source);
      }
      for (const [target, sources] of groups) merged += this.mergeParts(sources, target);
      for (const id of plan.floating) if (this.meta.has(id)) { this.deletePart(id, true); deleted++; }
      return { merged, deleted };
    });
  }
  /** Remove every voxel of a color, in all visible parts (undoable). */
  eraseColor(color: string): number {
    let changed = 0;
    for (const cell of [...this.cells.values()]) {
      if (cell.color !== color || this.hiddenParts.has(this.baseOf(cell.part))) continue;
      this.touch(partCellKey(cell.part, cell.x, cell.y, cell.z));
      this.dropCell(cell.part, cell.x, cell.y, cell.z);
      changed++;
    }
    if (changed) this.generation++;
    return changed;
  }
  deletePart(part: string, removePart = false): number {
    let changed = 0;
    for (const cell of [...this.cells.values()]) {
      if (this.baseOf(cell.part) !== part) continue;
      this.touch(partCellKey(cell.part, cell.x, cell.y, cell.z));
      this.dropCell(cell.part, cell.x, cell.y, cell.z);
      changed++;
    }
    if (removePart && this.meta.has(part) && this.partOrder.length > 1) {
      this.displayedStates.delete(part);
      const grandparent = this.meta.get(part)!.parent;
      for (const entry of this.meta.values()) if (entry.parent === part) entry.parent = grandparent;
      this.meta.delete(part);
      this.partOrder = this.partOrder.filter((id) => id !== part);
      this.hiddenParts.delete(part);
      this.clipList = this.clipList.map((clip) => ({ ...clip, tracks: clip.tracks.filter((track) => track.part !== part) }));
      changed++;
    }
    if (changed) this.generation++;
    return changed;
  }
  setPartHidden(part: string, hidden: boolean): void {
    if (hidden) this.hiddenParts.add(part); else this.hiddenParts.delete(part);
    this.generation++;
  }

  // --- serialization ---------------------------------------------------------
  /** `cellsFor` limits run encoding to some parts (the rest come out with no
   * runs) — the editor rebuilds only the parts whose voxels changed. */
  toAuthoredModel(id: string = this.modelId, options: { cellsFor?: (part: string) => boolean } = {}): AuthoredVoxelModel {
    const keyByColor = new Map<string, string>();
    for (const [key, hex] of Object.entries(this.originalPalette)) if (!keyByColor.has(hex.toLowerCase())) keyByColor.set(hex.toLowerCase(), key);
    const palette: Record<string, string> = {};
    let nextNew = 0;
    const keyFor = (color: string): string => {
      const lower = color.toLowerCase();
      let key = keyByColor.get(lower);
      if (!key) { do key = `e${nextNew++}`; while (this.originalPalette[key]); keyByColor.set(lower, key); }
      palette[key] = lower;
      return key;
    };
    const parts: AuthoredVoxelPart[] = [];
    for (const partId of this.partOrder) {
      const meta = this.meta.get(partId);
      const part: AuthoredVoxelPart = { id: partId, pivot: meta?.pivot ?? [0, 0, 0], runs: options.cellsFor && !options.cellsFor(partId) ? [] : this.runsOf(partId, keyFor, { x: 0, y: 0, z: 0 }) };
      if (meta?.parent && this.meta.has(meta.parent)) part.parent = meta.parent;
      if (meta && Object.keys(meta.sockets).length) part.sockets = { ...meta.sockets };
      if (meta && !isIdentity(meta.transform)) part.transform = toRest(meta.transform);
      if (meta && meta.opacity < 1) part.transform = { ...(part.transform ?? {}), opacity: meta.opacity };
      if (meta && meta.states.length) {
        const states: Record<string, { runs: VoxelRun[] }> = {};
        for (const state of meta.states) states[state] = { runs: options.cellsFor && !options.cellsFor(partId) ? [] : this.runsOf(layerId(partId, state), keyFor, { x: 0, y: 0, z: 0 }) };
        part.states = states;
      }
      parts.push(part);
    }
    if (parts.length === 0) parts.push({ id: "plant", pivot: [0, 0, 0], runs: [] });
    const model: AuthoredVoxelModel = { id, pitch: this.pitch, palette, parts };
    if (this.clipList.length) model.clips = this.clipList.map((clip) => structuredClone(clip) as AuthoredClip);
    const emissive: Record<string, number> = {};
    for (const [key, hex] of Object.entries(palette)) { const glow = this.glowByHex.get(hex); if (glow) emissive[key] = glow; }
    if (Object.keys(emissive).length) model.emissive = emissive;
    if (this.lightList.length) model.lights = this.lightList.map((light) => structuredClone(light) as ModelLight);
    if (this.emitterList.length) model.emitters = this.emitterList.map((emitter) => structuredClone(emitter) as ParticleEmitter);
    return model;
  }
  private runsOf(partId: string, keyFor: (color: string) => string, shift: Coordinate): VoxelRun[] {
    const rows = new Map<string, EditableCell[]>();
    for (const cell of this.cells.values()) {
      if (cell.part !== partId) continue;
      const rowKey = `${cell.y},${cell.z}`;
      let row = rows.get(rowKey);
      if (!row) rows.set(rowKey, (row = []));
      row.push(cell);
    }
    const runs: VoxelRun[] = [];
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      let current: [number, number, number, number, string] | null = null;
      for (const cell of row) {
        const key = keyFor(cell.color);
        const x = cell.x - shift.x;
        if (current && x === current[3] + 1 && key === current[4]) current[3] = x;
        else { current = [cell.y - shift.y, cell.z - shift.z, x, x, key]; runs.push(current); }
      }
    }
    return runs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
  }
  extractParts(partIds: readonly string[], id: string, name?: string): AuthoredVoxelModel | null {
    const chosen = new Set(partIds.filter((part) => this.meta.has(part)));
    if (chosen.size === 0) return null;
    const cells = [...this.cells.values()].filter((cell) => chosen.has(cell.part));
    if (cells.length === 0) return null;
    let minY = Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of cells) { if (c.y < minY) minY = c.y; if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x; if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z; }
    const centerX = Math.round((minX + maxX) / 2);
    const centerZ = Math.round((minZ + maxZ) / 2);
    const shift = { x: centerX, y: minY, z: centerZ };
    const shifted = (p: readonly [number, number, number]): [number, number, number] => [p[0] - centerX, p[1] - minY, p[2] - centerZ];
    const palette: Record<string, string> = {};
    const keyByColor = new Map<string, string>();
    const keyFor = (color: string) => { let key = keyByColor.get(color); if (!key) { key = `c${keyByColor.size}`; keyByColor.set(color, key); palette[key] = color; } return key; };
    const parts: AuthoredVoxelPart[] = [];
    for (const partId of this.partOrder) {
      if (!chosen.has(partId)) continue;
      const meta = this.meta.get(partId)!;
      const part: AuthoredVoxelPart = { id: partId, pivot: shifted(meta.pivot), runs: this.runsOf(partId, keyFor, shift) };
      if (meta.parent && chosen.has(meta.parent)) part.parent = meta.parent;
      if (Object.keys(meta.sockets).length) part.sockets = Object.fromEntries(Object.entries(meta.sockets).map(([socket, cell]) => [socket, shifted(cell)]));
      if (!isIdentity(meta.transform)) part.transform = toRest(meta.transform);
      parts.push(part);
    }
    const clips: AuthoredClip[] = [];
    for (const clip of this.clipList) {
      const tracks = clip.tracks.filter((track) => chosen.has(track.part));
      if (tracks.length) clips.push({ ...structuredClone(clip) as AuthoredClip, tracks: structuredClone(tracks) as AuthoredClip["tracks"] });
    }
    const model: AuthoredVoxelModel = { id, pitch: this.pitch, palette, parts };
    if (name) model.name = name;
    if (clips.length) model.clips = clips;
    return model;
  }

  // --- internals -------------------------------------------------------------
  /** O(1): the incremental content hash (v2 format; v1 sorted-string histories are simply not restored). */
  private fingerprint(): string {
    return `v2:${this.cells.size}|${(this.hashA >>> 0).toString(16)}${(this.hashB >>> 0).toString(16)}`;
  }
}

function round4(v: number): number { return Math.round(v * 10000) / 10000; }
function fromRest(rest: PartRestTransform | undefined): PartMeta["transform"] {
  return { rotation: [...(rest?.rotation ?? [0, 0, 0])] as [number, number, number], position: [...(rest?.position ?? [0, 0, 0])] as [number, number, number], scale: [...(rest?.scale ?? [1, 1, 1])] as [number, number, number] };
}
function toRest(transform: PartMeta["transform"]): PartRestTransform {
  const out: { rotation?: [number, number, number]; position?: [number, number, number]; scale?: [number, number, number] } = {};
  if (transform.rotation.some((v) => v !== 0)) out.rotation = [...transform.rotation];
  if (transform.position.some((v) => v !== 0)) out.position = [...transform.position];
  if (transform.scale.some((v) => v !== 1)) out.scale = [...transform.scale];
  return out;
}
function sameCell(a: EditableCell | undefined, b: EditableCell | undefined): boolean {
  if (!a || !b) return a === b;
  return a.color === b.color && a.part === b.part;
}
function rotateXYZ(x: number, y: number, z: number, angles: [number, number, number], reversed = false): [number, number, number] {
  const steps: ["x" | "y" | "z", number][] = reversed ? [["z", angles[0]], ["y", angles[1]], ["x", angles[2]]] : [["x", angles[0]], ["y", angles[1]], ["z", angles[2]]];
  for (const [axis, angle] of steps) {
    if (!angle) continue;
    const c = Math.cos(angle), s = Math.sin(angle);
    if (axis === "x") [y, z] = [y * c - z * s, y * s + z * c];
    else if (axis === "y") [x, z] = [x * c + z * s, -x * s + z * c];
    else [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}
function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
/** Edge length (cells) of the blocks the editor meshes independently. */
export const EDIT_CHUNK = 16;
/** Layer id for a part's voxel state ("base" is the part itself). */
export function layerId(part: string, state: string): string { return state === "base" ? part : `${part}@${state}`; }
function stripState(key: ClipKey): ClipKey { const { state: _state, ...rest } = key; return rest; }
export interface TidyPlan {
  threshold: number;
  /** Voxel count of the biggest part. */
  largest: number;
  /** Parts at or under the threshold, smallest first. */
  fragments: string[];
  /** fragment -> the part it touches most (possibly another fragment; resolve the chain). */
  merges: Map<string, string>;
  /** Fragments touching nothing. */
  floating: string[];
  /** Parts with no voxels and no children (leftovers of overlap resolution); removed in every mode. */
  empty: string[];
  /** Voxels in all fragments. */
  voxels: number;
  total: number;
}
export interface EditChunk { key: string; part: string; cx: number; cy: number; cz: number; version: number; /** Live view; copy before mutating the session. */ cells: ReadonlySet<VoxelCell> }
function chunkKeyOf(part: string, cx: number, cy: number, cz: number): string { return `${part}|${cx},${cy},${cz}`; }
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h | 0;
}
