// Authors src/assets/scene/level.json — the compound at full build-out, read off docs/layout-reference.png.
//
// Rooms are declared as rectangles; the walls between them are DERIVED. Every room edge is cut at the
// boundaries of its neighbours, so a long corridor wall and the shorter kitchen wall facing it become one
// shared segment instead of two overlapping ones. A segment touched by two rooms is an interior wall
// (it records both sides so the cutaway works from either room); a segment touched by one is exterior.
//
// Re-run any time: node scripts/seed-level.mjs [--out path] [--dry]
// The build editor saves the same file, so this is a starting point, not a lock.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// +x east, +z south — the same convention as the game scene, where dining is +z and the farm is -z.
// So on docs/layout-reference.png, "up" (north, the farm) is -z.

const wallTypes = [
  { id: "stone_grey", name: "Grey stone", color: "#8f8d87", topColor: "#63615c", baseColor: "#55534f", pattern: "stone", thickness: 0.3, height: 2.9 },
  { id: "plaster_cream", name: "Cream plaster", color: "#e8ddc8", topColor: "#c2b49a", baseColor: "#a99a80", pattern: "plaster", thickness: 0.2, height: 2.7 },
  { id: "tile_white", name: "White tile", color: "#e2e7e3", topColor: "#b4bdb7", baseColor: "#9aa49d", pattern: "tile", thickness: 0.18, height: 2.7 },
  { id: "plank_barn", name: "Barn plank", color: "#8a6a4a", topColor: "#63482f", baseColor: "#553d28", pattern: "plank", thickness: 0.18, height: 2.5 },
  { id: "cellar_stone", name: "Cellar stone", color: "#7d7468", topColor: "#574f45", baseColor: "#4a433a", pattern: "stone", thickness: 0.38, height: 2.4 },
  { id: "glass_house", name: "Glasshouse frame", color: "#cfe6e2", topColor: "#8fb5ae", baseColor: "#6f8f89", pattern: "plain", thickness: 0.12, height: 3.0 },
];

const floorTypes = [
  { id: "tile_pale", name: "Pale tile", color: "#ded5c0", accentColor: "#c3b89e", pattern: "tile", patternScale: 0.5 },
  { id: "tile_cool", name: "Cool tile", color: "#cfd6d3", accentColor: "#b4beba", pattern: "tile", patternScale: 0.5 },
  { id: "plank_warm", name: "Warm plank", color: "#a8764a", accentColor: "#8f6540", pattern: "plank", patternScale: 0.28 },
  { id: "plank_dining", name: "Dining oak", color: "#b07c4e", accentColor: "#976846", pattern: "plank", patternScale: 0.3 },
  { id: "cellar_floor", name: "Cellar flags", color: "#8a8074", accentColor: "#736a5f", pattern: "stone", patternScale: 0.6 },
  { id: "soil_rich", name: "Rich soil", color: "#6b4a33", accentColor: "#5d4029", pattern: "soil", patternScale: 0.35 },
  { id: "soil_dark", name: "Compost", color: "#4f3726", accentColor: "#453020", pattern: "soil", patternScale: 0.35 },
  { id: "grass", name: "Grass", color: "#7ea563", accentColor: "#71975a", pattern: "grass", patternScale: 0.5 },
  { id: "gravel", name: "Gravel yard", color: "#a8a396", accentColor: "#948f84", pattern: "gravel", patternScale: 0.3 },
  { id: "stone_path", name: "Stone path", color: "#b9b2a4", accentColor: "#a39c8f", pattern: "stone", patternScale: 0.6 },
];

// id, name, zone, rect [x, z, w, d], floor, parcel, exterior wall type, interior wall type, cost
const rooms = [
  // South: the customer half.
  ["dining", "Dining Area", "dining", [-17, 5, 34, 9], "plank_dining", "p_core", "stone_grey", "plaster_cream", 2400],
  ["service_pass", "Service Pass", "pass", [-17, 3.5, 34, 1.5], "tile_pale", "p_core", "stone_grey", "tile_white", 900],
  // Centre: the working half.
  ["kitchen", "Main Kitchen", "kitchen", [-11, -4, 22, 7.5], "tile_pale", "p_kitchen", "stone_grey", "tile_white", 3200],
  ["receiving", "Receiving & Inspection", "receiving", [-17, -4, 6, 4], "tile_pale", "p_west_wing", "stone_grey", "plaster_cream", 900],
  ["trash_recycling", "Trash & Recycling", "waste", [-17, 0, 6, 3.5], "tile_cool", "p_west_wing", "stone_grey", "plaster_cream", 700],
  ["dishwashing", "Dishwashing", "dish", [11, -4, 6, 4], "tile_cool", "p_east_wing", "stone_grey", "tile_white", 1100],
  ["office", "Office", "office", [11, 0, 6, 3.5], "plank_warm", "p_east_wing", "stone_grey", "plaster_cream", 800],
  // The spine.
  ["back_corridor", "Back of House Corridor", "corridor", [-17, -6.5, 34, 2.5], "tile_pale", "p_corridor", "stone_grey", "plaster_cream", 1000],
  // North row.
  ["dry_pantry", "Dry Pantry", "pantry", [-17, -12.5, 6, 6], "tile_pale", "p_north_west", "stone_grey", "plaster_cream", 900],
  ["cold_storage", "Cold Storage", "cold", [-11, -12.5, 6, 6], "tile_cool", "p_north_west", "stone_grey", "tile_white", 1400],
  ["passage_west", "West Garden Passage", "corridor", [-5, -12.5, 2, 6], "tile_pale", "p_north_east", "stone_grey", "plaster_cream", 300],
  ["prep_kitchen", "Prep Kitchen", "prep", [-3, -12.5, 8, 6], "tile_pale", "p_north_east", "stone_grey", "tile_white", 1800],
  ["staff_area", "Staff Area", "staff", [5, -12.5, 4.5, 6], "plank_warm", "p_north_east", "stone_grey", "plaster_cream", 800],
  ["passage_east", "East Garden Passage", "corridor", [9.5, -12.5, 2, 6], "tile_pale", "p_north_east", "stone_grey", "plaster_cream", 300],
  ["staff_restrooms", "Staff Restrooms", "staff", [11.5, -12.5, 3, 6], "tile_cool", "p_north_east", "stone_grey", "tile_white", 700],
  ["cleaning_supplies", "Cleaning Supplies", "cleaning", [14.5, -12.5, 2.5, 6], "tile_cool", "p_north_east", "stone_grey", "plaster_cream", 600],
  // Outbuildings.
  ["fermentation_cellar", "Fermentation Cellar", "cellar", [-27, -22, 10, 8], "cellar_floor", "p_cellar", "cellar_stone", "cellar_stone", 2200],
  ["greenhouse", "Greenhouse", "greenhouse", [15, -28, 9, 10], "soil_rich", "p_greenhouse", "glass_house", "glass_house", 2500],
];

// id, name, zone, rect, ground, parcel, cost
const areas = [
  ["site_grounds", "Grounds", "outdoor", [-34, -38, 68, 64], "grass", null, 0],
  ["entrance_plaza", "Main Entrance", "dining", [-7, 14, 14, 6], "stone_path", "p_plaza", 300],
  ["delivery_yard", "Delivery Yard", "receiving", [-27, -8, 9, 8], "gravel", "p_yard", 700],
  ["herb_garden", "Herb Garden", "herbs", [-14, -16, 28, 3.5], "soil_rich", "p_herb", 500],
  ["compost", "Compost", "waste", [-25, -30, 8, 6], "soil_dark", "p_compost", 600],
];
// The farm is a grid of small plots so it can grow row by row: row A touches the herb garden, row B is beyond.
const farmColumns = [-14, -7, 0, 7];
for (const [index, x] of farmColumns.entries()) {
  areas.push([`farm_a${index + 1}`, `Farm Plot A${index + 1}`, "farm", [x, -23, 7, 7], "soil_rich", `p_farm_a${index + 1}`, index === 1 ? 0 : 400]);
  areas.push([`farm_b${index + 1}`, `Farm Plot B${index + 1}`, "farm", [x, -30, 7, 7], "soil_rich", `p_farm_b${index + 1}`, 800]);
}

// id, name, rect, cost, requires
const parcels = [
  ["p_farm_a2", "Home Plot", [-7, -23, 7, 7], 0, []],
  ["p_farm_a1", "Farm Plot A1", [-14, -23, 7, 7], 400, ["p_farm_a2"]],
  ["p_farm_a3", "Farm Plot A3", [0, -23, 7, 7], 400, ["p_farm_a2"]],
  ["p_farm_a4", "Farm Plot A4", [7, -23, 7, 7], 600, ["p_farm_a3"]],
  ["p_farm_b1", "Farm Plot B1", [-14, -30, 7, 7], 800, ["p_farm_a1"]],
  ["p_farm_b2", "Farm Plot B2", [-7, -30, 7, 7], 800, ["p_farm_a2"]],
  ["p_farm_b3", "Farm Plot B3", [0, -30, 7, 7], 800, ["p_farm_a3"]],
  ["p_farm_b4", "Farm Plot B4", [7, -30, 7, 7], 900, ["p_farm_a4"]],
  ["p_herb", "Herb Garden", [-14, -16, 28, 3.5], 500, ["p_farm_a2"]],
  ["p_core", "Dining & Pass", [-17, 3.5, 34, 10.5], 2000, ["p_herb"]],
  ["p_kitchen", "Kitchen", [-11, -4, 22, 7.5], 2600, ["p_core"]],
  ["p_west_wing", "West Wing", [-17, -4, 6, 7.5], 900, ["p_kitchen"]],
  ["p_east_wing", "East Wing", [11, -4, 6, 7.5], 900, ["p_kitchen"]],
  ["p_corridor", "Back Corridor", [-17, -6.5, 34, 2.5], 800, ["p_kitchen"]],
  ["p_north_west", "North West Stores", [-17, -12.5, 12, 6], 1200, ["p_corridor"]],
  ["p_north_east", "North East Rooms", [-5, -12.5, 22, 6], 1500, ["p_corridor"]],
  ["p_plaza", "Entrance Plaza", [-7, 14, 14, 6], 300, ["p_core"]],
  ["p_yard", "Delivery Yard", [-27, -8, 9, 8], 700, ["p_west_wing"]],
  ["p_compost", "Compost", [-25, -30, 8, 6], 600, ["p_farm_b1"]],
  ["p_cellar", "Fermentation Cellar", [-27, -22, 10, 8], 2200, ["p_corridor"]],
  ["p_greenhouse", "Greenhouse", [15, -28, 9, 10], 2500, ["p_farm_a4"]],
];

// Doors and windows. Between two rooms: ["between", roomA, roomB, width, offsetFromWallCentre, kind].
// On an outside face: ["outside", room, "north"|"south"|"east"|"west", width, offsetFromCentre, kind].
const openings = [
  ["outside", "dining", "south", 3.2, 0, "door"],
  ["outside", "dining", "south", 1.6, -9, "window"],
  ["outside", "dining", "south", 1.6, 9, "window"],
  ["outside", "dining", "east", 1.8, 0, "window"],
  ["outside", "dining", "west", 1.8, 0, "window"],
  ["between", "dining", "service_pass", 4.5, -6, "arch"],
  ["between", "dining", "service_pass", 4.5, 6, "arch"],
  ["between", "service_pass", "kitchen", 6, 0, "arch"],
  ["between", "service_pass", "office", 1.1, 0, "door"],
  ["between", "service_pass", "trash_recycling", 1.1, 0, "door"],
  ["between", "kitchen", "dishwashing", 1.4, 0, "door"],
  ["between", "kitchen", "receiving", 1.4, 0, "door"],
  ["between", "kitchen", "back_corridor", 1.4, -7, "door"],
  ["between", "kitchen", "back_corridor", 1.4, 7, "door"],
  ["between", "receiving", "back_corridor", 1.2, 0, "door"],
  ["between", "receiving", "trash_recycling", 1.1, 0, "door"],
  ["between", "dishwashing", "back_corridor", 1.2, 0, "door"],
  ["between", "back_corridor", "dry_pantry", 1.1, 0, "door"],
  ["between", "back_corridor", "cold_storage", 1.1, 0, "door"],
  ["between", "back_corridor", "prep_kitchen", 1.6, 0, "arch"],
  ["between", "back_corridor", "staff_area", 1.1, 0, "door"],
  ["between", "back_corridor", "staff_restrooms", 1.0, 0, "door"],
  ["between", "back_corridor", "cleaning_supplies", 1.0, 0, "door"],
  // Gates from the corridor out to the herb garden, and the delivery door.
  ["between", "back_corridor", "passage_west", 1.6, 0, "arch"],
  ["between", "back_corridor", "passage_east", 1.6, 0, "arch"],
  ["outside", "passage_west", "north", 1.6, 0, "door"],
  ["outside", "passage_east", "north", 1.6, 0, "door"],
  ["outside", "receiving", "west", 2.4, 0, "door"],
  ["outside", "prep_kitchen", "north", 1.4, 0, "window"],
  ["outside", "staff_area", "north", 1.4, 0, "window"],
  ["outside", "fermentation_cellar", "south", 1.2, 0, "door"],
  ["outside", "fermentation_cellar", "east", 0.9, 0, "window"],
  ["outside", "greenhouse", "west", 1.6, 0, "door"],
];

const round = (n) => Math.round(n * 1000) / 1000;
const key = (a, b) => `${round(a)}|${round(b)}`;

/** Room edges as segments on shared lines, so neighbours can be cut against each other. */
function roomEdges(room) {
  const [x, z, w, d] = room.rect;
  return [
    { axis: "h", line: z, start: x, end: x + w, room: room.id, side: "north" },
    { axis: "h", line: z + d, start: x, end: x + w, room: room.id, side: "south" },
    { axis: "v", line: x, start: z, end: z + d, room: room.id, side: "west" },
    { axis: "v", line: x + w, start: z, end: z + d, room: room.id, side: "east" },
  ];
}

function buildWalls(roomRecords, config) {
  const groups = new Map();
  for (const room of roomRecords) {
    for (const edge of roomEdges(room)) {
      const id = `${edge.axis}${round(edge.line)}`;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(edge);
    }
  }
  const segments = new Map();
  for (const edges of groups.values()) {
    // Cut every edge at each neighbour's boundary, so overlaps become shared pieces.
    const cuts = [...new Set(edges.flatMap((edge) => [round(edge.start), round(edge.end)]))].sort((a, b) => a - b);
    for (const edge of edges) {
      const inside = cuts.filter((c) => c >= round(edge.start) - 1e-6 && c <= round(edge.end) + 1e-6);
      for (let i = 0; i < inside.length - 1; i++) {
        const start = inside[i], end = inside[i + 1];
        if (end - start < 1e-6) continue;
        const id = `${edge.axis}${round(edge.line)}:${key(start, end)}`;
        if (!segments.has(id)) segments.set(id, { axis: edge.axis, line: edge.line, start, end, rooms: [], sides: [] });
        const entry = segments.get(id);
        if (!entry.rooms.includes(edge.room)) { entry.rooms.push(edge.room); entry.sides.push(edge.side); }
      }
    }
  }
  const walls = [];
  let counter = 0;
  for (const entry of [...segments.values()].sort((a, b) => a.axis.localeCompare(b.axis) || a.line - b.line || a.start - b.start)) {
    const [first, second] = entry.rooms;
    const cfg = config.get(first);
    const shared = Boolean(second);
    const wall = {
      id: `w${String(++counter).padStart(3, "0")}`,
      from: entry.axis === "h" ? [round(entry.start), round(entry.line)] : [round(entry.line), round(entry.start)],
      to: entry.axis === "h" ? [round(entry.end), round(entry.line)] : [round(entry.line), round(entry.end)],
      type: shared ? cfg.interior : cfg.exterior,
      room: first,
      ...(second ? { back: second } : {}),
      cost: Math.round((shared ? 40 : 70) * (entry.end - entry.start)),
      requires: [cfg.parcel],
    };
    walls.push(wall);
  }
  return walls;
}

/** Place an opening on the wall that matches a room pair, or an outside face of one room. */
function applyOpenings(walls, roomRecords, specs) {
  const byId = new Map(roomRecords.map((room) => [room.id, room]));
  const problems = [];
  for (const spec of specs) {
    const [kindOfSpec] = spec;
    let candidates;
    let label;
    if (kindOfSpec === "between") {
      const [, a, b, width, offset, kind] = spec;
      label = `${a} <-> ${b}`;
      candidates = walls.filter((wall) => (wall.room === a && wall.back === b) || (wall.room === b && wall.back === a));
      placeOn(candidates, width, offset, kind, label, problems);
    } else {
      const [, roomId, side, width, offset, kind] = spec;
      label = `${roomId} ${side}`;
      const room = byId.get(roomId);
      if (!room) { problems.push(`opening on unknown room ${roomId}`); continue; }
      const [x, z, w, d] = room.rect;
      const line = side === "north" ? z : side === "south" ? z + d : side === "west" ? x : x + w;
      const axis = side === "north" || side === "south" ? "h" : "v";
      candidates = walls.filter((wall) => {
        if (wall.room !== roomId && wall.back !== roomId) return false;
        if (wall.back) return false; // an outside face has no room behind it
        const horizontal = Math.abs(wall.from[1] - wall.to[1]) < 1e-6;
        if ((axis === "h") !== horizontal) return false;
        return Math.abs((horizontal ? wall.from[1] : wall.from[0]) - line) < 1e-6;
      });
      placeOn(candidates, width, offset, kind, label, problems);
    }
  }
  return problems;
}

function placeOn(candidates, width, offset, kind, label, problems) {
  if (!candidates.length) { problems.push(`no wall found for opening ${label}`); return; }
  // Walls are cut into pieces; put the opening on the piece that contains the requested point.
  const spans = candidates.map((wall) => {
    const horizontal = Math.abs(wall.from[1] - wall.to[1]) < 1e-6;
    const startCoord = horizontal ? wall.from[0] : wall.from[1];
    const endCoord = horizontal ? wall.to[0] : wall.to[1];
    return { wall, startCoord, endCoord, length: Math.abs(endCoord - startCoord) };
  });
  const min = Math.min(...spans.map((s) => Math.min(s.startCoord, s.endCoord)));
  const max = Math.max(...spans.map((s) => Math.max(s.startCoord, s.endCoord)));
  const target = (min + max) / 2 + offset;
  const hit = spans.find((s) => target >= Math.min(s.startCoord, s.endCoord) - 1e-6 && target <= Math.max(s.startCoord, s.endCoord) + 1e-6)
    ?? spans.sort((a, b) => b.length - a.length)[0];
  const at = Math.abs(target - hit.startCoord);
  const half = width / 2;
  if (at - half < 0 || at + half > hit.length) {
    // Centre it on the piece instead of letting it run off the end.
    const centred = hit.length / 2;
    if (hit.length < width + 0.2) { problems.push(`opening ${label} (${width} m) does not fit its ${hit.length.toFixed(2)} m wall`); return; }
    (hit.wall.openings ??= []).push({ at: round(centred), width, kind });
    return;
  }
  (hit.wall.openings ??= []).push({ at: round(at), width, kind });
}

const roomRecords = rooms.map(([id, name, zone, rect, floor, parcel, , , cost]) => ({ id, name, zone, rect, floor, parcel, cost }));
const config = new Map(rooms.map(([id, , , , , parcel, exterior, interior]) => [id, { exterior, interior, parcel }]));
const walls = buildWalls(roomRecords, config);
const problems = applyOpenings(walls, roomRecords, openings);

const layout = {
  version: 1,
  grid: 0.25,
  wallTypes,
  floorTypes,
  parcels: parcels.map(([id, name, rect, cost, requires]) => ({ id, name, rect, cost, ...(requires.length ? { requires } : {}) })),
  rooms: roomRecords.map((room) => {
    const cfg = config.get(room.id);
    return { id: room.id, name: room.name, zone: room.zone, rect: room.rect, floor: room.floor, exteriorWall: cfg.exterior, interiorWall: cfg.interior, parcel: room.parcel, cost: room.cost };
  }),
  walls,
  areas: areas.map(([id, name, zone, rect, ground, parcel, cost]) => ({ id, name, zone, rect, ground, ...(parcel ? { parcel } : {}), cost })),
};

const outFlag = process.argv.indexOf("--out");
const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : fileURLToPath(new URL("../src/assets/scene/level.json", import.meta.url));
const json = `${JSON.stringify(layout, null, 2)}\n`;

console.log(`rooms ${layout.rooms.length} · walls ${layout.walls.length} · areas ${layout.areas.length} · parcels ${layout.parcels.length}`);
console.log(`openings placed ${layout.walls.reduce((sum, wall) => sum + (wall.openings?.length ?? 0), 0)}`);
for (const problem of problems) console.warn(`  ! ${problem}`);
if (process.argv.includes("--dry")) { console.log("(dry run, nothing written)"); }
else { writeFileSync(outPath, json); console.log(`wrote ${outPath} (${(json.length / 1024).toFixed(1)} kB)`); }
