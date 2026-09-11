import type { AuthoredVoxelCatalog } from "./voxelModel";

// Decor layout data and validation (no Babylon): hand-placed catalog models in
// the game world, saved in src/assets/scene/decor.json by decorate mode.

export interface DecorProp {
  /** Stable id of this placement (not the model id). */
  id: string;
  /** Catalog model id. */
  model: string;
  /** World position of the model's origin (its base centre), metres. */
  position: [number, number, number];
  /** Yaw in degrees (legacy; `rotation` wins when present). */
  rotationY?: number;
  /** Euler rotation in degrees (x, y, z) — a tilted vase, a spoon hanging at an angle. */
  rotation?: [number, number, number];
  /** Scale per axis (a plain number scales uniformly). */
  scale?: number | [number, number, number];
  /** Clip to loop; null = still; undefined = the model's first looping clip. */
  clip?: string | null;
  /** Clip played once when the player interacts with the prop (walks up and presses the action key). */
  interactClip?: string;
  /** Group this prop belongs to (see DecorLayout.groups); hidden groups hide their props. */
  group?: string;
  /** Hidden props are not shown (in the game either) until shown again. */
  hidden?: boolean;
  /** What a container is holding. Goods stand in the model's sockets, so a stocked freezer shows
   *  the real catalog food it contains (see src/game/storageDisplay.ts). */
  stock?: { model: string; count?: number; only?: string | string[]; prefer?: string | string[]; footprint?: [number, number] }[];
}

/** A named set of props that can be hidden and shown together ("autumn table", "wall tools"). */
export interface DecorGroup {
  id: string;
  hidden?: boolean;
}

export interface DecorLayout {
  version: 1;
  props: DecorProp[];
  groups?: DecorGroup[];
}

/** Whether a prop shows, taking its group into account. */
export function propVisible(prop: DecorProp, layout: DecorLayout): boolean {
  if (prop.hidden) return false;
  const group = prop.group ? layout.groups?.find((candidate) => candidate.id === prop.group) : undefined;
  return !group?.hidden;
}

export function validateDecorLayout(layout: DecorLayout, catalog: AuthoredVoxelCatalog): string[] {
  const errors: string[] = [];
  if (layout.version !== 1) errors.push(`unsupported decor version ${layout.version}`);
  const ids = new Set<string>();
  const groupIds = new Set<string>();
  for (const group of layout.groups ?? []) {
    if (!/^[a-z0-9_ \-]{1,64}$/i.test(group.id)) errors.push(`group id "${group.id}" must be letters, digits, spaces, _ or -`);
    if (groupIds.has(group.id)) errors.push(`group id ${group.id} repeats`);
    groupIds.add(group.id);
  }
  for (const prop of layout.props ?? []) {
    if (prop.group !== undefined && !groupIds.has(prop.group)) errors.push(`prop ${prop.id} is in unknown group ${prop.group}`);
    if (!/^[a-z0-9_]{1,64}$/i.test(prop.id)) errors.push(`prop id "${prop.id}" must be letters, digits and underscores`);
    if (ids.has(prop.id)) errors.push(`prop id ${prop.id} repeats`);
    ids.add(prop.id);
    if (!catalog.models[prop.model]) errors.push(`prop ${prop.id} uses unknown model ${prop.model}`);
    if (!Array.isArray(prop.position) || prop.position.length !== 3 || prop.position.some((v) => !Number.isFinite(v))) errors.push(`prop ${prop.id} has an invalid position`);
    const scales = prop.scale === undefined ? [] : typeof prop.scale === "number" ? [prop.scale] : prop.scale;
    if (prop.scale !== undefined && (!Array.isArray(scales) || (Array.isArray(prop.scale) && prop.scale.length !== 3) || scales.some((v) => !(v > 0)))) errors.push(`prop ${prop.id} scale must be positive`);
    if (prop.rotationY !== undefined && !Number.isFinite(prop.rotationY)) errors.push(`prop ${prop.id} rotation must be a number`);
    if (prop.rotation !== undefined && (!Array.isArray(prop.rotation) || prop.rotation.length !== 3 || prop.rotation.some((v) => !Number.isFinite(v)))) errors.push(`prop ${prop.id} rotation needs 3 numbers`);
    if (prop.clip && catalog.models[prop.model] && !catalog.models[prop.model]!.clips?.some((clip) => clip.id === prop.clip)) errors.push(`prop ${prop.id} loops unknown clip ${prop.clip}`);
    if (prop.interactClip && catalog.models[prop.model] && !catalog.models[prop.model]!.clips?.some((clip) => clip.id === prop.interactClip)) errors.push(`prop ${prop.id} reacts with unknown clip ${prop.interactClip}`);
    for (const entry of prop.stock ?? []) {
      if (!catalog.models[entry.model]) errors.push(`prop ${prop.id} is stocked with unknown model ${entry.model}`);
      if (entry.count !== undefined && (!Number.isFinite(entry.count) || entry.count < 0)) errors.push(`prop ${prop.id} has a bad stock count for ${entry.model}`);
    }
  }
  return errors;
}

/** Rotation of a prop as (x, y, z) degrees, honouring the legacy `rotationY`. */
export function propRotation(prop: DecorProp): [number, number, number] {
  return prop.rotation ? [...prop.rotation] as [number, number, number] : [0, prop.rotationY ?? 0, 0];
}
/** Scale of a prop per axis. */
export function propScale(prop: DecorProp): [number, number, number] {
  if (prop.scale === undefined) return [1, 1, 1];
  return typeof prop.scale === "number" ? [prop.scale, prop.scale, prop.scale] : [...prop.scale] as [number, number, number];
}
