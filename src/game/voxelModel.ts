import type { VoxelCell } from "./voxelGeometry";

export type VoxelCoordinate = readonly [x: number, y: number, z: number, color: string];
export type VoxelRun = readonly [y: number, z: number, xStart: number, xEnd: number, color: string];
export type VoxelBox = readonly [xStart: number, yStart: number, zStart: number, xEnd: number, yEnd: number, zEnd: number, color: string];

export interface AuthoredVoxelPart {
  id: string;
  /** Rotation center in cell units (the joint), also the origin of child parts. */
  pivot: readonly [number, number, number];
  /** Rig hierarchy: this part moves with its parent. Absent = attached to the root. */
  parent?: string;
  /** Named attachment cells (a knife on a hand, a lid handle), in cell units. */
  sockets?: Readonly<Record<string, readonly [number, number, number]>>;
  /** Stored rest transform around the pivot: rotation in degrees, position in
   * cells, scale factors. Non-destructive — the voxels stay on their grid and
   * clips animate relative to it. */
  transform?: PartRestTransform;
  boxes?: readonly VoxelBox[];
  runs?: readonly VoxelRun[];
  voxels?: readonly VoxelCoordinate[];
  /** Alternative voxel snapshots of this part ("bite1", "lights_off"): a clip
   * key's `state` switches the part to one of them, stepwise. The part's own
   * boxes/runs/voxels are the "base" state. A state may be empty (eaten). */
  states?: Readonly<Record<string, PartGeometry>>;
}

export interface PartGeometry {
  boxes?: readonly VoxelBox[];
  runs?: readonly VoxelRun[];
  voxels?: readonly VoxelCoordinate[];
}

export interface PartRestTransform {
  rotation?: readonly [number, number, number];
  position?: readonly [number, number, number];
  scale?: readonly [number, number, number];
}

export type ClipEase = "linear" | "in" | "out" | "inOut" | "back" | "step";

/** One keyframe for one part. Rotation in degrees, position in cells, scale as factors. */
export interface ClipKey {
  t: number;
  rotation?: readonly [number, number, number];
  position?: readonly [number, number, number];
  scale?: readonly [number, number, number];
  /** 0 = invisible … 1 = solid; interpolated like the other channels (rest 1). How it
   * renders is the track's `fade`: alpha blending or a crisp voxel dither. */
  opacity?: number;
  /** Easing INTO this key from the previous one. */
  ease?: ClipEase;
  /** A muted key stays in the clip but is skipped when sampling. */
  disabled?: boolean;
  /** From this key on the part shows this voxel state ("base" = its own voxels).
   * Keys without it leave the state as it was. */
  state?: string;
  /** How the switch to `state` plays over the segment leading into this key:
   * "blend" (default) crossfades colours of shared voxels and dissolves the
   * voxels that appear/vanish, "pop" scales them in/out, "cut" is instant. */
  transition?: StateTransition;
  /** Dissolve order for "blend": random sprinkle or a wave along an axis. */
  transitionDirection?: TransitionDirection;
}

export type StateTransition = "blend" | "pop" | "cut";
export type TransitionDirection = "random" | "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
export const STATE_TRANSITIONS: readonly StateTransition[] = ["blend", "pop", "cut"];
export const TRANSITION_DIRECTIONS: readonly TransitionDirection[] = ["random", "+y", "-y", "+x", "-x", "+z", "-z"];

export interface ClipTrack {
  /** Part id, or "*" for the whole model (its root). */
  part: string;
  keys: readonly ClipKey[];
  /** How `opacity` below 1 shows: "fade" = translucent (smoke, ghosts), "dither" =
   * voxels drop out in a checkerboard-like order, staying crisp and opaque. */
  fade?: FadeMode;
}

export type FadeMode = "fade" | "dither";
export const FADE_MODES: readonly FadeMode[] = ["fade", "dither"];

/** Timed marker: the game reacts at exactly this moment (consume an input,
 * spawn a burst, swap the model to another catalog entry). */
export interface ClipEvent {
  t: number;
  name: string;
  swapModel?: string;
}

export interface AuthoredClip {
  /** Stable reference used by code and events; rename with care. */
  id: string;
  /** Optional human label shown in the lab. */
  name?: string;
  /** Seconds. */
  duration: number;
  loop?: boolean;
  tracks: readonly ClipTrack[];
  events?: readonly ClipEvent[];
}

export interface AuthoredVoxelModel {
  /** Stable catalog key referenced by code (rigs, stages, plots). */
  id: string;
  /** Optional human label shown in the lab list. */
  name?: string;
  /** Lab folder path ("plants/vegetables"); also decides which catalog file stores the model. */
  folder?: string;
  pitch: number;
  palette: Readonly<Record<string, string>>;
  parts: readonly AuthoredVoxelPart[];
  clips?: readonly AuthoredClip[];
}

export interface AuthoredVoxelCatalog {
  version: number;
  models: Readonly<Record<string, AuthoredVoxelModel>>;
}

function colorFor(model: AuthoredVoxelModel, key: string): string {
  const color = model.palette[key];
  if (!color) throw new Error(`${model.id} references missing palette key ${key}`);
  return color;
}

/** Expands compact, authored coordinate data. Later entries deliberately
 * override earlier ones, allowing artists to paint highlights and leaf veins. */
/** Walk boxes, runs and voxels of a geometry; later entries repaint earlier ones. */
export function expandGeometry(geometry: PartGeometry, put: (x: number, y: number, z: number, colorKey: string) => void): void {
  for (const [x0, y0, z0, x1, y1, z1, color] of geometry.boxes ?? []) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) put(x, y, z, color);
  }
  for (const [y, z, x0, x1, color] of geometry.runs ?? []) {
    for (let x = x0; x <= x1; x++) put(x, y, z, color);
  }
  for (const [x, y, z, color] of geometry.voxels ?? []) put(x, y, z, color);
}

export function cellsFromAuthoredModel(model: AuthoredVoxelModel, partIds?: readonly string[]): VoxelCell[] {
  const selected = partIds ? new Set(partIds) : null;
  const cells = new Map<string, VoxelCell>();
  const put = (x: number, y: number, z: number, colorKey: string): void => {
    cells.set(`${x},${y},${z}`, { x, y, z, color: colorFor(model, colorKey) });
  };
  for (const part of model.parts) {
    if (selected && !selected.has(part.id)) continue;
    expandGeometry(part, put);
  }
  return [...cells.values()];
}

/** Cells of one voxel state of a part ("base" = the part's own geometry). */
export function cellsOfPartState(model: AuthoredVoxelModel, part: AuthoredVoxelPart, state: string): VoxelCell[] {
  const geometry = state === "base" ? part : part.states?.[state];
  if (!geometry) return [];
  const cells = new Map<string, VoxelCell>();
  expandGeometry(geometry, (x, y, z, colorKey) => { cells.set(`${x},${y},${z}`, { x, y, z, color: colorFor(model, colorKey) }); });
  return [...cells.values()];
}

/** State names a part can show: always "base", then its named snapshots. */
export function partStateNames(part: AuthoredVoxelPart): string[] { return ["base", ...Object.keys(part.states ?? {})]; }

/** Each part's own cells, for building one mesh per rig part. Parts may
 * overlap (a fruit resting inside a leaf): every part keeps its cells, so it
 * can animate away without leaving holes. Within one part, later entries
 * still repaint earlier ones. */
export function cellsByPart(model: AuthoredVoxelModel): Map<string, VoxelCell[]> {
  return new Map(model.parts.map((part) => [part.id, cellsFromAuthoredModel(model, [part.id])]));
}

export function validateAuthoredVoxelCatalog(catalog: AuthoredVoxelCatalog): string[] {
  const errors: string[] = [];
  if (catalog.version !== 1) errors.push(`Unsupported authored voxel version ${catalog.version}`);
  for (const [key, model] of Object.entries(catalog.models)) {
    if (model.id !== key) errors.push(`Model key ${key} does not match id ${model.id}`);
    if (!(model.pitch > 0 && model.pitch <= 0.1)) errors.push(`${key} has invalid pitch`);
    if (model.parts.length === 0) errors.push(`${key} has no parts`);
    const ids = new Set<string>();
    for (const part of model.parts) {
      if (ids.has(part.id)) errors.push(`${key} repeats part ${part.id}`);
      ids.add(part.id);
      if (part.pivot.length !== 3) errors.push(`${key}.${part.id} has invalid pivot`);
      for (const [socket, cell] of Object.entries(part.sockets ?? {})) if (cell.length !== 3) errors.push(`${key}.${part.id} socket ${socket} has invalid cell`);
      for (const channel of ["rotation", "position", "scale"] as const) { const value = part.transform?.[channel]; if (value !== undefined && value.length !== 3) errors.push(`${key}.${part.id} transform ${channel} needs 3 numbers`); }
      if (part.transform?.scale?.some((v) => !(v > 0))) errors.push(`${key}.${part.id} transform scale must be positive`);
      for (const run of part.runs ?? []) {
        if (run[2] > run[3]) errors.push(`${key}.${part.id} has reversed run`);
        if (!model.palette[run[4]]) errors.push(`${key}.${part.id} uses missing color ${run[4]}`);
      }
      for (const voxel of part.voxels ?? []) if (!model.palette[voxel[3]]) errors.push(`${key}.${part.id} uses missing color ${voxel[3]}`);
      for (const box of part.boxes ?? []) if (!model.palette[box[6]]) errors.push(`${key}.${part.id} uses missing color ${box[6]}`);
      for (const [state, geometry] of Object.entries(part.states ?? {})) {
        if (state === "base" || !/^[a-z0-9_]{1,40}$/i.test(state)) errors.push(`${key}.${part.id} has an invalid state name "${state}"`);
        for (const run of geometry.runs ?? []) if (!model.palette[run[4]]) errors.push(`${key}.${part.id}@${state} uses missing color ${run[4]}`);
        for (const voxel of geometry.voxels ?? []) if (!model.palette[voxel[3]]) errors.push(`${key}.${part.id}@${state} uses missing color ${voxel[3]}`);
        for (const box of geometry.boxes ?? []) if (!model.palette[box[6]]) errors.push(`${key}.${part.id}@${state} uses missing color ${box[6]}`);
      }
    }
    // Rig hierarchy: parents must exist and never loop back.
    const parentOf = new Map(model.parts.map((part) => [part.id, part.parent]));
    for (const part of model.parts) {
      if (part.parent !== undefined && !ids.has(part.parent)) errors.push(`${key}.${part.id} has unknown parent ${part.parent}`);
      const seen = new Set<string>([part.id]);
      let cursor = part.parent;
      while (cursor !== undefined && ids.has(cursor)) {
        if (seen.has(cursor)) { errors.push(`${key}.${part.id} is in a parent cycle`); break; }
        seen.add(cursor);
        cursor = parentOf.get(cursor);
      }
    }
    const clipIds = new Set<string>();
    for (const clip of model.clips ?? []) {
      if (clipIds.has(clip.id)) errors.push(`${key} repeats clip ${clip.id}`);
      clipIds.add(clip.id);
      if (!(clip.duration > 0)) errors.push(`${key}.${clip.id} needs a positive duration`);
      for (const track of clip.tracks) {
        if (track.part !== "*" && !ids.has(track.part)) errors.push(`${key}.${clip.id} animates unknown part ${track.part}`);
        if (track.fade !== undefined && !FADE_MODES.includes(track.fade)) errors.push(`${key}.${clip.id}.${track.part} has unknown fade mode ${track.fade}`);
        let previous = -Infinity;
        for (const clipKey of track.keys) {
          if (clipKey.opacity !== undefined && !(clipKey.opacity >= 0 && clipKey.opacity <= 1)) errors.push(`${key}.${clip.id}.${track.part} key at ${clipKey.t} opacity must be within 0..1`);
          if (clipKey.transition !== undefined && !STATE_TRANSITIONS.includes(clipKey.transition)) errors.push(`${key}.${clip.id}.${track.part} key at ${clipKey.t} has unknown transition ${clipKey.transition}`);
          if (clipKey.transitionDirection !== undefined && !TRANSITION_DIRECTIONS.includes(clipKey.transitionDirection)) errors.push(`${key}.${clip.id}.${track.part} key at ${clipKey.t} has unknown transition direction ${clipKey.transitionDirection}`);
          if (clipKey.state !== undefined) {
            const owner = model.parts.find((candidate) => candidate.id === track.part);
            if (track.part === "*") errors.push(`${key}.${clip.id} whole-model key at ${clipKey.t} cannot set a voxel state`);
            else if (owner && clipKey.state !== "base" && !owner.states?.[clipKey.state]) errors.push(`${key}.${clip.id}.${track.part} key at ${clipKey.t} uses unknown state ${clipKey.state}`);
          }
          if (!(clipKey.t >= 0 && clipKey.t <= clip.duration)) errors.push(`${key}.${clip.id}.${track.part} has a key outside 0..duration`);
          if (clipKey.t < previous) errors.push(`${key}.${clip.id}.${track.part} keys are not sorted`);
          previous = clipKey.t;
        }
      }
      for (const event of clip.events ?? []) {
        if (!(event.t >= 0 && event.t <= clip.duration)) errors.push(`${key}.${clip.id} event ${event.name} is outside 0..duration`);
        if (event.swapModel !== undefined && !catalog.models[event.swapModel]) errors.push(`${key}.${clip.id} event ${event.name} swaps to unknown model ${event.swapModel}`);
      }
    }
  }
  return errors;
}
