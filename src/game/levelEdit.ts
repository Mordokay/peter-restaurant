// Editing operations on the site plan. The build editor calls these; each returns a NEW layout, so undo
// is a stack of plans and nothing mutates under the renderer.
//
// The important one is deriveWalls. Rooms are what you draw; walls are what falls out of them. Every room
// edge is cut at its neighbours' boundaries, so two rooms that touch share ONE wall recording both sides
// instead of stacking two. Re-deriving after every room change keeps that true, and existing walls are
// matched by geometry so a wall you painted or cut a door into keeps both.
import {
  rectCentre, wallLength,
  type Area, type LevelLayout, type Opening, type Point2, type Rect, type Room, type Wall,
} from "./levelLayout.ts";

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
/** Geometry key of a segment, direction-independent, so a re-derived wall finds its old self. */
export function wallKey(from: Point2, to: Point2): string {
  const a = `${round3(from[0])},${round3(from[1])}`;
  const b = `${round3(to[0])},${round3(to[1])}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface Edge { axis: "h" | "v"; line: number; start: number; end: number; room: string }

function roomEdges(room: Room): Edge[] {
  const [x, z, w, d] = room.rect;
  return [
    { axis: "h", line: z, start: x, end: x + w, room: room.id },
    { axis: "h", line: z + d, start: x, end: x + w, room: room.id },
    { axis: "v", line: x, start: z, end: z + d, room: room.id },
    { axis: "v", line: x + w, start: z, end: z + d, room: room.id },
  ];
}

export interface DeriveOptions {
  /** Wall type for a room's edge: shared with another room, or facing outside. */
  typeFor?: (room: Room, shared: boolean) => string;
  /** Price a wall by its length. */
  costFor?: (room: Room, shared: boolean, length: number) => number | undefined;
}

/** Rebuild every wall from the rooms, carrying over the type and openings of walls that still exist. */
export function deriveWalls(rooms: readonly Room[], previous: readonly Wall[] = [], options: DeriveOptions = {}): Wall[] {
  const typeFor = options.typeFor ?? ((room, shared) => (shared ? room.interiorWall : room.exteriorWall) ?? room.exteriorWall ?? room.interiorWall ?? "");
  const byKey = new Map(previous.map((wall) => [wallKey(wall.from, wall.to), wall]));

  const groups = new Map<string, Edge[]>();
  for (const room of rooms) {
    for (const edge of roomEdges(room)) {
      const id = `${edge.axis}${round3(edge.line)}`;
      const list = groups.get(id);
      if (list) list.push(edge); else groups.set(id, [edge]);
    }
  }

  interface Piece { axis: "h" | "v"; line: number; start: number; end: number; rooms: string[] }
  const pieces = new Map<string, Piece>();
  for (const edges of groups.values()) {
    // Cut every edge at each neighbour's boundary so overlapping stretches become shared pieces.
    const cuts = [...new Set(edges.flatMap((edge) => [round3(edge.start), round3(edge.end)]))].sort((a, b) => a - b);
    for (const edge of edges) {
      const inside = cuts.filter((c) => c >= round3(edge.start) - 1e-6 && c <= round3(edge.end) + 1e-6);
      for (let i = 0; i < inside.length - 1; i++) {
        const start = inside[i]!, end = inside[i + 1]!;
        if (end - start < 1e-6) continue;
        const id = `${edge.axis}${round3(edge.line)}:${start}:${end}`;
        let piece = pieces.get(id);
        if (!piece) pieces.set(id, (piece = { axis: edge.axis, line: edge.line, start, end, rooms: [] }));
        if (!piece.rooms.includes(edge.room)) piece.rooms.push(edge.room);
      }
    }
  }

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const walls: Wall[] = [];
  let counter = 0;
  const ordered = [...pieces.values()].sort((a, b) => a.axis.localeCompare(b.axis) || a.line - b.line || a.start - b.start);
  for (const piece of ordered) {
    const [first, second] = piece.rooms;
    const room = first ? roomById.get(first) : undefined;
    if (!room) continue;
    const shared = Boolean(second);
    const from: Point2 = piece.axis === "h" ? [round3(piece.start), round3(piece.line)] : [round3(piece.line), round3(piece.start)];
    const to: Point2 = piece.axis === "h" ? [round3(piece.end), round3(piece.line)] : [round3(piece.line), round3(piece.end)];
    const kept = byKey.get(wallKey(from, to));
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const wall: Wall = {
      id: kept?.id ?? `w${String(++counter).padStart(3, "0")}_${round3(piece.line)}`.replace(/[.-]/g, "_"),
      from, to,
      type: kept?.type ?? typeFor(room, shared),
      room: first,
      ...(second ? { back: second } : {}),
    };
    // Openings survive a re-derive only while they still fit the (possibly shorter) wall.
    const openings = (kept?.openings ?? []).filter((opening) => opening.at - opening.width / 2 >= -1e-6 && opening.at + opening.width / 2 <= length + 1e-6);
    if (openings.length) wall.openings = openings;
    const cost = kept?.cost ?? options.costFor?.(room, shared, length);
    if (cost !== undefined) wall.cost = cost;
    if (kept?.requires) wall.requires = kept.requires;
    else if (room.parcel) wall.requires = [room.parcel];
    if (kept?.height !== undefined) wall.height = kept.height;
    walls.push(wall);
  }
  // Ids must stay unique even when a kept wall collides with a freshly numbered one.
  const seen = new Set<string>();
  for (const wall of walls) {
    let id = wall.id;
    let n = 1;
    while (seen.has(id)) id = `${wall.id}_${++n}`;
    wall.id = id;
    seen.add(id);
  }
  return walls;
}

/** A layout with its walls re-derived from the rooms. */
export function withDerivedWalls(layout: LevelLayout, options?: DeriveOptions): LevelLayout {
  return { ...layout, walls: deriveWalls(layout.rooms, layout.walls, options) };
}

/** Next free id with a prefix, e.g. room_3. */
export function nextId(layout: LevelLayout, prefix: string): string {
  const taken = new Set<string>([
    ...layout.rooms.map((item) => item.id), ...layout.areas.map((item) => item.id),
    ...layout.walls.map((item) => item.id), ...layout.parcels.map((item) => item.id),
  ]);
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** Snap a value to the editing grid. */
export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/** A rect from two dragged corners, snapped, never zero-sized. */
export function rectFromDrag(ax: number, az: number, bx: number, bz: number, grid: number): Rect {
  const x0 = snap(Math.min(ax, bx), grid), x1 = snap(Math.max(ax, bx), grid);
  const z0 = snap(Math.min(az, bz), grid), z1 = snap(Math.max(az, bz), grid);
  return [x0, z0, Math.max(grid, round3(x1 - x0)), Math.max(grid, round3(z1 - z0))];
}

export function addRoom(layout: LevelLayout, room: Room): LevelLayout {
  return withDerivedWalls({ ...layout, rooms: [...layout.rooms, room] });
}

export function removeRoom(layout: LevelLayout, id: string): LevelLayout {
  return withDerivedWalls({ ...layout, rooms: layout.rooms.filter((room) => room.id !== id) });
}

export function updateRoom(layout: LevelLayout, id: string, patch: Partial<Room>): LevelLayout {
  const rooms = layout.rooms.map((room) => (room.id === id ? { ...room, ...patch } : room));
  // Only a moved or resized room changes the walls.
  return patch.rect ? withDerivedWalls({ ...layout, rooms }) : { ...layout, rooms };
}

export function addArea(layout: LevelLayout, area: Area): LevelLayout {
  return { ...layout, areas: [...layout.areas, area] };
}

export function removeArea(layout: LevelLayout, id: string): LevelLayout {
  return { ...layout, areas: layout.areas.filter((area) => area.id !== id) };
}

export function updateArea(layout: LevelLayout, id: string, patch: Partial<Area>): LevelLayout {
  return { ...layout, areas: layout.areas.map((area) => (area.id === id ? { ...area, ...patch } : area)) };
}

export function paintWall(layout: LevelLayout, id: string, type: string): LevelLayout {
  return { ...layout, walls: layout.walls.map((wall) => (wall.id === id ? { ...wall, type } : wall)) };
}

/** Put an opening on a wall at a distance along it, keeping it inside the wall. */
export function addOpening(layout: LevelLayout, id: string, at: number, opening: Omit<Opening, "at">): LevelLayout {
  return {
    ...layout,
    walls: layout.walls.map((wall) => {
      if (wall.id !== id) return wall;
      const length = wallLength(wall);
      if (opening.width + 0.2 > length) return wall; // no room for it
      const clamped = Math.min(length - opening.width / 2, Math.max(opening.width / 2, at));
      const kept = (wall.openings ?? []).filter((existing) => Math.abs(existing.at - clamped) > (existing.width + opening.width) / 2);
      return { ...wall, openings: [...kept, { ...opening, at: round3(clamped) }].sort((a, b) => a.at - b.at) };
    }),
  };
}

export function removeOpeningAt(layout: LevelLayout, id: string, at: number): LevelLayout {
  return {
    ...layout,
    walls: layout.walls.map((wall) => {
      if (wall.id !== id) return wall;
      const openings = (wall.openings ?? []).filter((opening) => Math.abs(opening.at - at) > opening.width / 2);
      return openings.length ? { ...wall, openings } : { ...wall, openings: undefined };
    }),
  };
}

/** Distance along a wall of the point on it nearest to (x, z), and how far off the wall that point is. */
export function projectOntoWall(wall: Wall, x: number, z: number): { at: number; distance: number } {
  const dx = wall.to[0] - wall.from[0], dz = wall.to[1] - wall.from[1];
  const length = Math.hypot(dx, dz) || 1;
  const ux = dx / length, uz = dz / length;
  const px = x - wall.from[0], pz = z - wall.from[1];
  const at = Math.min(length, Math.max(0, px * ux + pz * uz));
  const distance = Math.abs(px * -uz + pz * ux);
  return { at, distance };
}

/** The wall nearest a point, within `reach` metres of it. */
export function wallNear(layout: LevelLayout, x: number, z: number, reach = 0.8): { wall: Wall; at: number; distance: number } | null {
  let best: { wall: Wall; at: number; distance: number } | null = null;
  for (const wall of layout.walls) {
    const { at, distance } = projectOntoWall(wall, x, z);
    if (distance > reach) continue;
    if (!best || distance < best.distance) best = { wall, at, distance };
  }
  return best;
}

/** The room or area under a point, innermost first (rooms beat the ground they sit on). */
export function itemAt(layout: LevelLayout, x: number, z: number): { kind: "room"; item: Room } | { kind: "area"; item: Area } | null {
  const inside = (rect: Rect) => x >= rect[0] && x <= rect[0] + rect[2] && z >= rect[1] && z <= rect[1] + rect[3];
  for (const room of layout.rooms) if (inside(room.rect)) return { kind: "room", item: room };
  // Smallest area wins, so a farm plot beats the grounds it sits on.
  const areas = layout.areas.filter((area) => inside(area.rect)).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3]);
  return areas[0] ? { kind: "area", item: areas[0] } : null;
}

/** Would this rect overlap a room other than `ignore`? Rooms may not overlap. */
export function overlapsRoom(layout: LevelLayout, rect: Rect, ignore?: string): Room | null {
  for (const room of layout.rooms) {
    if (room.id === ignore) continue;
    const a = room.rect;
    if (rect[0] < a[0] + a[2] && a[0] < rect[0] + rect[2] && rect[1] < a[1] + a[3] && a[1] < rect[1] + rect[3]) return room;
  }
  return null;
}

/** Centre of a room or area, for labels. */
export function labelPoint(rect: Rect): Point2 { return rectCentre(rect); }
