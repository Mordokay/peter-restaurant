import test from "node:test";
import assert from "node:assert/strict";
import {
  addOpening, addRoom, deriveWalls, itemAt, overlapsRoom, projectOntoWall, rectFromDrag,
  removeRoom, snap, wallNear, wallKey,
} from "./levelEdit.ts";
import { validateLevelLayout, wallLength, type LevelLayout, type Room } from "./levelLayout.ts";

const room = (id: string, rect: [number, number, number, number]): Room =>
  ({ id, name: id, zone: "test", rect, floor: "tile", exteriorWall: "stone", interiorWall: "plaster" });

const layout = (rooms: Room[]): LevelLayout => ({
  version: 1, grid: 0.25,
  wallTypes: [{ id: "stone", name: "Stone", color: "#888888" }, { id: "plaster", name: "Plaster", color: "#eeeeee" }],
  floorTypes: [{ id: "tile", name: "Tile", color: "#dddddd" }],
  parcels: [], rooms, walls: deriveWalls(rooms), areas: [],
});

test("two rooms sharing an edge get one wall between them, not two", () => {
  const plan = layout([room("kitchen", [0, 0, 10, 6]), room("pantry", [0, 6, 10, 4])]);
  const between = plan.walls.filter((wall) => (wall.room === "kitchen" && wall.back === "pantry") || (wall.room === "pantry" && wall.back === "kitchen"));
  assert.equal(between.length, 1, "the shared edge is one wall recording both rooms");
  assert.equal(between[0]!.type, "plaster", "a shared wall uses the interior type");
  const outside = plan.walls.filter((wall) => !wall.back);
  assert.ok(outside.every((wall) => wall.type === "stone"), "walls facing outside use the exterior type");
  assert.equal(plan.walls.length, 7, "four edges each, minus the one they share");
  assert.deepEqual(validateLevelLayout(plan), []);
});

test("a wall is cut where a neighbour only covers part of it", () => {
  // A long corridor with a short room against the middle of its north side.
  const plan = layout([room("corridor", [0, 10, 20, 3]), room("store", [8, 6, 4, 4])]);
  const alongTheJoin = plan.walls.filter((wall) => Math.abs(wall.from[1] - 10) < 1e-6 && Math.abs(wall.to[1] - 10) < 1e-6);
  assert.equal(alongTheJoin.length, 3, "the corridor's north wall splits into before, shared and after");
  const shared = alongTheJoin.filter((wall) => wall.back);
  assert.equal(shared.length, 1);
  assert.equal(wallLength(shared[0]!), 4, "the shared piece is exactly as wide as the store");
});

test("re-deriving keeps a wall's type and the openings that still fit", () => {
  let plan = layout([room("kitchen", [0, 0, 10, 6])]);
  const south = plan.walls.find((wall) => Math.abs(wall.from[1] - 6) < 1e-6)!;
  plan = addOpening(plan, south.id, 5, { width: 1.2, kind: "door" });
  plan = { ...plan, walls: plan.walls.map((wall) => (wall.id === south.id ? { ...wall, type: "plaster" } : wall)) };

  // Adding a neighbour re-derives the walls; the door and the paint should survive.
  const next = addRoom(plan, room("pantry", [0, 6, 10, 4]));
  const rebuilt = next.walls.find((wall) => wallKey(wall.from, wall.to) === wallKey(south.from, south.to))!;
  assert.equal(rebuilt.type, "plaster", "the paint survives");
  assert.equal(rebuilt.openings?.length, 1, "the doorway survives");
  assert.equal(rebuilt.back, "pantry", "and it now knows the room behind it");

  // A door that no longer fits the shortened wall is dropped rather than left hanging off the end.
  let wide = layout([room("hall", [0, 0, 12, 4])]);
  const horizontalAtZero = (wall: { from: readonly [number, number]; to: readonly [number, number] }) => Math.abs(wall.from[1]) < 1e-6 && Math.abs(wall.to[1]) < 1e-6;
  const north = wide.walls.find(horizontalAtZero)!;
  wide = addOpening(wide, north.id, 11, { width: 1.5, kind: "door" });
  const cut = addRoom(wide, room("annexe", [0, -4, 6, 4]));
  const pieces = cut.walls.filter(horizontalAtZero);
  assert.equal(pieces.length, 2, "the hall's north wall is cut in two");
  assert.deepEqual(validateLevelLayout(cut), [], "and no opening is left running off an end");
});

test("removing a room takes its walls with it", () => {
  const plan = layout([room("kitchen", [0, 0, 10, 6]), room("pantry", [0, 6, 10, 4])]);
  const after = removeRoom(plan, "pantry");
  assert.equal(after.rooms.length, 1);
  assert.equal(after.walls.length, 4, "only the kitchen's own four walls remain");
  assert.ok(after.walls.every((wall) => !wall.back), "and none of them backs onto anything now");
});

test("openings never run off the end of a wall", () => {
  let plan = layout([room("kitchen", [0, 0, 4, 4])]);
  const wall = plan.walls[0]!;
  plan = addOpening(plan, wall.id, 3.9, { width: 1.2, kind: "door" });
  const opening = plan.walls.find((candidate) => candidate.id === wall.id)!.openings![0]!;
  assert.ok(opening.at + opening.width / 2 <= wallLength(wall) + 1e-6, "it is pulled back inside the wall");
  assert.deepEqual(validateLevelLayout(plan), []);

  const tooShort = addOpening(layout([room("cupboard", [0, 0, 1, 1])]), deriveWalls([room("cupboard", [0, 0, 1, 1])])[0]!.id, 0.5, { width: 2, kind: "door" });
  assert.equal(tooShort.walls[0]!.openings, undefined, "a door wider than the wall is refused");
});

test("pointer helpers: snapping, dragging a rect, and finding what is under the cursor", () => {
  assert.equal(snap(1.13, 0.25), 1.25);
  assert.equal(snap(-1.13, 0.25), -1.25);
  assert.deepEqual(rectFromDrag(3.1, 2.1, 0.1, 0.1, 0.25), [0, 0, 3, 2], "a drag is snapped and normalised whichever way it goes");
  assert.deepEqual(rectFromDrag(1, 1, 1.01, 1.01, 0.25), [1, 1, 0.25, 0.25], "never zero-sized");

  const plan = layout([room("kitchen", [0, 0, 10, 6])]);
  assert.equal(itemAt(plan, 5, 3)?.item.id, "kitchen");
  assert.equal(itemAt(plan, 50, 3), null);
  assert.equal(overlapsRoom(plan, [5, 3, 4, 4])?.id, "kitchen");
  assert.equal(overlapsRoom(plan, [20, 20, 4, 4]), null);
  assert.equal(overlapsRoom(plan, [5, 3, 4, 4], "kitchen"), null, "a room never clashes with itself");

  const wall = plan.walls.find((candidate) => Math.abs(candidate.from[1] - 6) < 1e-6)!;
  const projected = projectOntoWall(wall, 5, 6.3);
  assert.ok(Math.abs(projected.at - 5) < 1e-6 && Math.abs(projected.distance - 0.3) < 1e-6);
  assert.equal(wallNear(plan, 5, 6.3, 0.8)?.wall.id, wall.id);
  assert.equal(wallNear(plan, 5, 3, 0.8), null, "the middle of the room is near no wall");
});
