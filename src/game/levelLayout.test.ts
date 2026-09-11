import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fullProgress, isAvailable, ownedIds, roomAt, shade, validateLevelLayout, wallNormal,
  type LevelLayout,
} from "./levelLayout.ts";

const plan = (): LevelLayout => ({
  version: 1,
  grid: 0.25,
  wallTypes: [{ id: "plain", name: "Plain", color: "#cccccc" }],
  floorTypes: [{ id: "tile", name: "Tile", color: "#dddddd" }],
  parcels: [{ id: "p_yard", rect: [0, 0, 20, 20], cost: 0 }],
  rooms: [
    { id: "kitchen", name: "Kitchen", zone: "kitchen", rect: [0, 0, 10, 6], floor: "tile", parcel: "p_yard", cost: 100 },
    { id: "pantry", name: "Pantry", zone: "pantry", rect: [0, 6, 10, 4], floor: "tile", parcel: "p_yard", cost: 50, requires: ["kitchen"] },
  ],
  // The wall between them, with a door in the middle.
  walls: [{ id: "w1", from: [0, 6], to: [10, 6], type: "plain", room: "kitchen", back: "pantry", openings: [{ at: 5, width: 1.2, kind: "door" }] }],
  areas: [{ id: "yard", name: "Yard", zone: "outdoor", rect: [0, 10, 10, 5], ground: "tile", parcel: "p_yard", cost: 0 }],
});

test("a sound plan validates, and the usual mistakes are caught", () => {
  assert.deepEqual(validateLevelLayout(plan()), []);

  const overlapping = plan();
  overlapping.rooms = [...overlapping.rooms, { id: "extra", name: "Extra", zone: "x", rect: [5, 3, 4, 4], floor: "tile" }];
  assert.ok(validateLevelLayout(overlapping).some((p) => p.includes("overlap")), "overlapping rooms are rejected");

  const badFloor = plan();
  badFloor.rooms = [{ ...badFloor.rooms[0]!, floor: "marble" }];
  assert.ok(validateLevelLayout(badFloor).some((p) => p.includes("unknown floor type")));

  const badOpening = plan();
  badOpening.walls = [{ ...badOpening.walls[0]!, openings: [{ at: 9.8, width: 2, kind: "door" }] }];
  assert.ok(validateLevelLayout(badOpening).some((p) => p.includes("running off its end")), "an opening past the end is rejected");

  const badRequire = plan();
  badRequire.rooms = [{ ...badRequire.rooms[0]!, requires: ["nowhere"] }];
  assert.ok(validateLevelLayout(badRequire).some((p) => p.includes("requires unknown")));

  const duplicate = plan();
  duplicate.areas = [...duplicate.areas, { ...duplicate.areas[0]! }];
  assert.ok(validateLevelLayout(duplicate).some((p) => p.includes("duplicate id")));
});

test("roomAt finds the room under a point and respects what is owned", () => {
  const layout = plan();
  assert.equal(roomAt(layout, 5, 3)?.id, "kitchen");
  assert.equal(roomAt(layout, 5, 8)?.id, "pantry");
  assert.equal(roomAt(layout, 5, 30), null, "outside is no room");
  assert.equal(roomAt(layout, 5, 8, new Set(["kitchen"]))?.id ?? null, null, "an unbuilt room is not stood in");
});

test("a shared wall's outward normal flips depending on which room you stand in", () => {
  const layout = plan();
  const wall = layout.walls[0]!;
  const fromKitchen = wallNormal(wall, layout);
  const fromPantry = wallNormal(wall, layout, "pantry");
  assert.deepEqual(fromKitchen.map((n) => Math.round(n) + 0), [0, 1], "away from the kitchen is south");
  assert.deepEqual(fromPantry.map((n) => Math.round(n) + 0), [0, -1], "away from the pantry is north");
});

test("progression: a thing is available once its parcel and prerequisites are owned", () => {
  const layout = plan();
  const owned = ownedIds({ version: 1, parcels: [], rooms: [], walls: [], areas: [] });
  assert.equal(owned.size, 0);
  const kitchen = layout.rooms[0]!, pantry = layout.rooms[1]!;
  assert.equal(isAvailable(kitchen, new Set()), false, "not without the parcel");
  assert.equal(isAvailable(kitchen, new Set(["p_yard"])), true);
  assert.equal(isAvailable(pantry, new Set(["p_yard"])), false, "the kitchen has to come first");
  assert.equal(isAvailable(pantry, new Set(["p_yard", "kitchen"])), true);
  assert.equal(isAvailable(kitchen, new Set(["p_yard", "kitchen"])), false, "already owned is not for sale");

  const everything = fullProgress(layout);
  assert.deepEqual(everything.rooms, ["kitchen", "pantry"]);
  assert.equal(ownedIds(everything).size, 5);
});

test("shade lightens and darkens without leaving the channel range", () => {
  assert.equal(shade("#808080", 0), "#808080");
  assert.equal(shade("#000000", 1), "#ffffff");
  assert.equal(shade("#ffffff", -1), "#000000");
  assert.equal(shade("#abc", 0), "#aabbcc", "short hex expands");
  const darker = shade("#8f8d87", -0.2);
  assert.ok(Number.parseInt(darker.slice(1, 3), 16) < 0x8f);
});

test("the authored compound is a valid plan with rooms, walls and doorways", () => {
  const layout = JSON.parse(readFileSync(new URL("../assets/scene/level.json", import.meta.url), "utf8")) as LevelLayout;
  assert.deepEqual(validateLevelLayout(layout), [], "scripts/seed-level.mjs must emit a valid plan");
  assert.ok(layout.rooms.length >= 16, `expected the sixteen areas of the art direction, got ${layout.rooms.length} rooms`);
  const shared = layout.walls.filter((wall) => wall.back);
  assert.ok(shared.length > 10, "rooms that touch should share one wall, not stack two");
  const openings = layout.walls.reduce((sum, wall) => sum + (wall.openings?.length ?? 0), 0);
  assert.ok(openings >= 20, `every room needs a way in, found ${openings} openings`);
  // Each room of the building should be reachable: it has at least one opening on one of its walls.
  const withOpening = new Set(layout.walls.filter((wall) => wall.openings?.length).flatMap((wall) => [wall.room, wall.back].filter(Boolean) as string[]));
  const unreachable = layout.rooms.filter((room) => !withOpening.has(room.id));
  assert.deepEqual(unreachable.map((room) => room.id), [], "every room needs a door, an arch or a window");
});
