// The site plan: what the compound can ever become, and what the player has built so far.
//
// `docs/layout-reference.png` is the end state — the restaurant a dedicated player owns after
// hundreds of hours. The game starts with one plot, a seed and a pot, so the level is stored as a
// PLAN (every room, wall, parcel and outdoor area that will ever exist, each with a cost and its
// prerequisites) plus PROGRESS (the ids the player actually owns). The builder draws the
// intersection, so the same data serves the first hour and the hundredth.
//
// Everything is authored in the build editor and saved to src/assets/scene/level.json through the
// dev endpoint /__lab/save-level, the same way decorate mode saves decor.json.

/** An axis-aligned footprint on the floor plane: x, z of the south-west corner, then width and depth. */
export type Rect = readonly [x: number, z: number, width: number, depth: number];
export type Point2 = readonly [x: number, z: number];

/** How a wall looks. Walls read mostly from above, so the top course carries as much identity as the face. */
export interface WallType {
  id: string;
  name: string;
  /** Main face colour. */
  color: string;
  /** Top course, what the camera sees most of. Defaults to a darker `color`. */
  topColor?: string;
  /** Skirting course at the foot of the wall. */
  baseColor?: string;
  /** Surface treatment; the builder turns it into voxels. */
  pattern?: WallPattern;
  /** Metres. Default 0.2. */
  thickness?: number;
  /** Metres. Default 2.6. */
  height?: number;
}
export const WALL_PATTERNS = ["plain", "plaster", "stone", "plank", "tile"] as const;
export type WallPattern = (typeof WALL_PATTERNS)[number];

/** How a floor or a patch of ground looks. */
export interface FloorType {
  id: string;
  name: string;
  color: string;
  /** Seams, planks, checker squares, tufts. */
  accentColor?: string;
  pattern?: FloorPattern;
  /** Size of one pattern repeat, metres. Default 1. */
  patternScale?: number;
  /** Slab thickness, metres. Default 0.2. */
  thickness?: number;
}
export const FLOOR_PATTERNS = ["plain", "tile", "plank", "soil", "gravel", "grass", "stone"] as const;
export type FloorPattern = (typeof FLOOR_PATTERNS)[number];

/** Anything the player buys carries its price and what must exist first. */
export interface Buildable {
  /** Coins. Absent means it is part of the starting ground. */
  cost?: number;
  /** Ids (of any kind) that must be owned before this can be bought. */
  requires?: readonly string[];
}

/** A piece of land. Rooms and outdoor areas sit on one; buying the parcel comes first. */
export interface Parcel extends Buildable {
  id: string;
  name?: string;
  rect: Rect;
}

/** An enclosed room: a floor, and the walls around it are separate records so they can be bought one by one. */
export interface Room extends Buildable {
  id: string;
  name: string;
  /** Which of the sixteen areas of the art direction this belongs to. */
  zone: string;
  rect: Rect;
  /** FloorType id. */
  floor: string;
  /** Metres; falls back to the wall type's height. */
  wallHeight?: number;
  /** WallType ids used when the editor re-derives this room's walls. */
  exteriorWall?: string;
  interiorWall?: string;
  parcel?: string;
}

/** Ground outside the building: farm plots, the herb garden, paths, the yard. */
export interface Area extends Buildable {
  id: string;
  name: string;
  zone: string;
  rect: Rect;
  /** FloorType id. */
  ground: string;
  parcel?: string;
}

/** A gap in a wall, measured along it from the `from` end.
 *  A doorway is more than a hole: it lets light and people through, and decorate mode can swap the
 *  leaf and frame standing in it, so each one carries a stable id and an optional catalog model. */
export interface Opening {
  /** Stable id so decorate mode can point at this doorway. */
  id?: string;
  /** Catalog model of the leaf and frame standing in the hole. */
  model?: string;
  /** Centre of the gap, metres from `from`. */
  at: number;
  width: number;
  /** Metres; defaults to 2.1 for a door or arch, 1.2 for a window. */
  height?: number;
  /** Height of the bottom edge; defaults to 0 for doors and arches, 1 for windows. */
  sill?: number;
  kind: OpeningKind;
}
export const OPENING_KINDS = ["door", "arch", "window"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];

export interface Wall extends Buildable {
  id: string;
  from: Point2;
  to: Point2;
  /** WallType id. */
  type: string;
  /** Room this wall encloses; its outward normal points away from this room. */
  room?: string;
  /** Room on the other side, when the wall separates two rooms. */
  back?: string;
  height?: number;
  openings?: readonly Opening[];
}

export interface LevelLayout {
  version: 1;
  /** Snap used by the editor, metres. */
  grid: number;
  /** Room edges deliberately left without a wall — an open-plan kitchen looking onto the dining room.
   *  Keyed by geometry (see wallKey in levelEdit.ts) so they survive a re-derive. */
  openEdges?: readonly string[];
  wallTypes: readonly WallType[];
  floorTypes: readonly FloorType[];
  parcels: readonly Parcel[];
  rooms: readonly Room[];
  walls: readonly Wall[];
  areas: readonly Area[];
}

/** What the player owns. Everything absent from these lists is still on the plan, unbuilt. */
export interface LevelProgress {
  version: 1;
  parcels: string[];
  rooms: string[];
  walls: string[];
  areas: string[];
}

export const DEFAULT_WALL_THICKNESS = 0.2;
export const DEFAULT_WALL_HEIGHT = 2.6;
export const DEFAULT_FLOOR_THICKNESS = 0.2;

export function rectContains(rect: Rect, x: number, z: number): boolean {
  return x >= rect[0] && x <= rect[0] + rect[2] && z >= rect[1] && z <= rect[1] + rect[3];
}
export function rectCentre(rect: Rect): Point2 {
  return [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
}
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** The room under a point, or null outside. Rooms do not overlap, so the first hit wins. */
export function roomAt(layout: LevelLayout, x: number, z: number, owned?: ReadonlySet<string>): Room | null {
  for (const room of layout.rooms) {
    if (owned && !owned.has(room.id)) continue;
    if (rectContains(room.rect, x, z)) return room;
  }
  return null;
}

/** Length of a wall, metres. */
export function wallLength(wall: Wall): number {
  return Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
}

/** Unit vector along the wall, from `from` to `to`. */
export function wallDirection(wall: Wall): Point2 {
  const length = wallLength(wall);
  if (length < 1e-6) return [1, 0];
  return [(wall.to[0] - wall.from[0]) / length, (wall.to[1] - wall.from[1]) / length];
}

/** Unit normal pointing AWAY from a room, so the cutaway knows which face the camera sees.
 *  Defaults to the wall's own room; pass `fromRoom` to get the normal as seen from the other side.
 *  With no room it is the left-hand normal, which is stable but arbitrary. */
export function wallNormal(wall: Wall, layout?: LevelLayout, fromRoom?: string): Point2 {
  const [dx, dz] = wallDirection(wall);
  const normal: Point2 = [-dz, dx];
  const roomId = fromRoom ?? wall.room;
  const room = roomId && layout ? layout.rooms.find((candidate) => candidate.id === roomId) : undefined;
  if (!room) return normal;
  const [cx, cz] = rectCentre(room.rect);
  const mid = [(wall.from[0] + wall.to[0]) / 2, (wall.from[1] + wall.to[1]) / 2];
  // Flip it if it points back into the room.
  const towardsRoom = (cx - mid[0]) * normal[0] + (cz - mid[1]) * normal[1];
  return towardsRoom > 0 ? [-normal[0], -normal[1]] : normal;
}

/** Resolve a wall type, filling in the defaults so callers never juggle undefined. */
export function wallTypeOf(layout: LevelLayout, id: string): Required<Pick<WallType, "color" | "topColor" | "baseColor" | "pattern" | "thickness" | "height">> & WallType {
  const found = layout.wallTypes.find((candidate) => candidate.id === id) ?? layout.wallTypes[0];
  const type: WallType = found ?? { id: "missing", name: "Missing", color: "#b9b0a2" };
  return {
    ...type,
    color: type.color,
    topColor: type.topColor ?? shade(type.color, -0.18),
    baseColor: type.baseColor ?? shade(type.color, -0.3),
    pattern: type.pattern ?? "plain",
    thickness: type.thickness ?? DEFAULT_WALL_THICKNESS,
    height: type.height ?? DEFAULT_WALL_HEIGHT,
  };
}

export function floorTypeOf(layout: LevelLayout, id: string): Required<Pick<FloorType, "color" | "accentColor" | "pattern" | "patternScale" | "thickness">> & FloorType {
  const found = layout.floorTypes.find((candidate) => candidate.id === id) ?? layout.floorTypes[0];
  const type: FloorType = found ?? { id: "missing", name: "Missing", color: "#a79b86" };
  return {
    ...type,
    color: type.color,
    accentColor: type.accentColor ?? shade(type.color, -0.12),
    pattern: type.pattern ?? "plain",
    patternScale: type.patternScale ?? 1,
    thickness: type.thickness ?? DEFAULT_FLOOR_THICKNESS,
  };
}

/** Lighten (t > 0) or darken (t < 0) a hex colour. */
export function shade(hex: string, t: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = Number.parseInt(full, 16);
  const channel = (shift: number) => {
    const value = (n >> shift) & 0xff;
    const next = t >= 0 ? value + (255 - value) * t : value * (1 + t);
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return `#${[channel(16), channel(8), channel(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Everything the player owns, as one set — the builder only draws ids in here. */
export function ownedIds(progress: LevelProgress): Set<string> {
  return new Set([...progress.parcels, ...progress.rooms, ...progress.walls, ...progress.areas]);
}

/** Can this be bought now: its parcel is owned and every prerequisite is met. */
export function isAvailable(item: Buildable & { id: string; parcel?: string }, owned: ReadonlySet<string>): boolean {
  if (owned.has(item.id)) return false;
  if (item.parcel && !owned.has(item.parcel)) return false;
  return (item.requires ?? []).every((id) => owned.has(id));
}

const ID_PATTERN = /^[a-z0-9_]{1,64}$/i;

/** Problems that would make the level unbuildable. Empty means good. */
export function validateLevelLayout(layout: LevelLayout): string[] {
  const problems: string[] = [];
  if (layout.version !== 1) problems.push(`unknown level version ${String(layout.version)}`);
  if (!(layout.grid > 0)) problems.push(`grid must be positive, got ${String(layout.grid)}`);

  const seen = new Set<string>();
  const claim = (id: string, what: string): void => {
    if (!ID_PATTERN.test(id)) problems.push(`${what} id "${id}" must be letters, digits or underscores`);
    else if (seen.has(id)) problems.push(`duplicate id "${id}" (${what})`);
    else seen.add(id);
  };
  const wallTypeIds = new Set(layout.wallTypes.map((type) => type.id));
  const floorTypeIds = new Set(layout.floorTypes.map((type) => type.id));
  if (!layout.wallTypes.length) problems.push("no wall types");
  if (!layout.floorTypes.length) problems.push("no floor types");
  for (const type of layout.wallTypes) {
    claim(type.id, "wall type");
    if (type.pattern && !WALL_PATTERNS.includes(type.pattern)) problems.push(`wall type "${type.id}" has unknown pattern "${type.pattern}"`);
    if (type.thickness !== undefined && !(type.thickness > 0)) problems.push(`wall type "${type.id}" needs a positive thickness`);
  }
  for (const type of layout.floorTypes) {
    claim(type.id, "floor type");
    if (type.pattern && !FLOOR_PATTERNS.includes(type.pattern)) problems.push(`floor type "${type.id}" has unknown pattern "${type.pattern}"`);
  }

  const checkRect = (rect: Rect, what: string): void => {
    if (!Array.isArray(rect) || rect.length !== 4 || rect.some((n) => !Number.isFinite(n))) problems.push(`${what} needs a rect of four finite numbers`);
    else if (!(rect[2] > 0) || !(rect[3] > 0)) problems.push(`${what} needs a positive width and depth`);
  };
  const parcelIds = new Set(layout.parcels.map((parcel) => parcel.id));
  for (const parcel of layout.parcels) { claim(parcel.id, "parcel"); checkRect(parcel.rect, `parcel "${parcel.id}"`); }
  for (const room of layout.rooms) {
    claim(room.id, "room");
    checkRect(room.rect, `room "${room.id}"`);
    if (!floorTypeIds.has(room.floor)) problems.push(`room "${room.id}" uses unknown floor type "${room.floor}"`);
    if (room.parcel && !parcelIds.has(room.parcel)) problems.push(`room "${room.id}" sits on unknown parcel "${room.parcel}"`);
  }
  for (const area of layout.areas) {
    claim(area.id, "area");
    checkRect(area.rect, `area "${area.id}"`);
    if (!floorTypeIds.has(area.ground)) problems.push(`area "${area.id}" uses unknown ground type "${area.ground}"`);
    if (area.parcel && !parcelIds.has(area.parcel)) problems.push(`area "${area.id}" sits on unknown parcel "${area.parcel}"`);
  }
  const roomIds = new Set(layout.rooms.map((room) => room.id));
  for (const wall of layout.walls) {
    claim(wall.id, "wall");
    if (!wallTypeIds.has(wall.type)) problems.push(`wall "${wall.id}" uses unknown wall type "${wall.type}"`);
    if (wall.room && !roomIds.has(wall.room)) problems.push(`wall "${wall.id}" encloses unknown room "${wall.room}"`);
    if (wall.back && !roomIds.has(wall.back)) problems.push(`wall "${wall.id}" backs onto unknown room "${wall.back}"`);
    const length = wallLength(wall);
    if (!(length > 0)) problems.push(`wall "${wall.id}" has no length`);
    for (const opening of wall.openings ?? []) {
      if (!OPENING_KINDS.includes(opening.kind)) problems.push(`wall "${wall.id}" has an opening of unknown kind "${opening.kind}"`);
      if (!(opening.width > 0)) problems.push(`wall "${wall.id}" has an opening with no width`);
      if (opening.at - opening.width / 2 < -1e-6 || opening.at + opening.width / 2 > length + 1e-6) {
        problems.push(`wall "${wall.id}" has an opening running off its end (at ${opening.at}, width ${opening.width}, wall ${length.toFixed(2)} m)`);
      }
    }
  }
  // Rooms must not overlap, or `roomAt` and the cutaway become ambiguous.
  for (let i = 0; i < layout.rooms.length; i++) {
    for (let j = i + 1; j < layout.rooms.length; j++) {
      const a = layout.rooms[i]!, b = layout.rooms[j]!;
      if (rectsOverlap(a.rect, b.rect)) problems.push(`rooms "${a.id}" and "${b.id}" overlap`);
    }
  }
  // Every prerequisite must exist, or something could never be bought.
  for (const item of [...layout.parcels, ...layout.rooms, ...layout.areas, ...layout.walls]) {
    for (const id of item.requires ?? []) if (!seen.has(id)) problems.push(`"${item.id}" requires unknown "${id}"`);
  }
  return problems;
}

/** Progress with nothing built, for a brand-new save. */
export function emptyProgress(): LevelProgress {
  return { version: 1, parcels: [], rooms: [], walls: [], areas: [] };
}

/** Progress holding every id on the plan — the full build-out, for dressing and for judging against the concept art. */
export function fullProgress(layout: LevelLayout): LevelProgress {
  return {
    version: 1,
    parcels: layout.parcels.map((item) => item.id),
    rooms: layout.rooms.map((item) => item.id),
    walls: layout.walls.map((item) => item.id),
    areas: layout.areas.map((item) => item.id),
  };
}
