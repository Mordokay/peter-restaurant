import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene } from "@babylonjs/core";
import { createLevelBuilder, floorCells, wallCells } from "./levelBuilder.ts";
import { segmentCrossesRect } from "./cutaway.ts";
import type { LevelLayout, LevelProgress, Rect } from "./levelLayout.ts";

const colors = { color: "#c0c0c0", topColor: "#808080", baseColor: "#606060" };

test("a floor is one layer of cells covering its rect, with joints a single cell wide", () => {
  const { cells, nx, nz } = floorCells(4, 2, 0.1, 0.5, "#ded5c0", "#c3b89e", "tile");
  assert.equal(nx, 40);
  assert.equal(nz, 20);
  assert.equal(cells.length, 40 * 20);
  assert.ok(cells.every((cell) => cell.y === 0), "floors are flat");
  // Grout runs both ways every 0.5 m. Along a row that is not itself a grout line, only every fifth cell is.
  const row = cells.filter((cell) => cell.z === 2).sort((a, b) => a.x - b.x);
  const groutX = row.filter((cell) => cell.color === "#c3b89e").map((cell) => cell.x);
  assert.deepEqual(groutX.slice(0, 4), [0, 5, 10, 15]);
  assert.ok(cells.some((cell) => cell.z === 5 && cell.color === "#c3b89e"), "and the crosswise joints are there too");
  const accentShare = cells.filter((cell) => cell.color === "#c3b89e").length / cells.length;
  assert.ok(accentShare < 0.4, `grout should be a minority of the floor, got ${(accentShare * 100).toFixed(0)}%`);
});

test("a plain wall is a solid slab with a base course and a top course", () => {
  const { cells, thicknessCells } = wallCells(2, 2.5, 0.2, colors, "plain", [], 0.1);
  assert.equal(thicknessCells, 2);
  assert.equal(cells.length, 20 * 25 * 2);
  const tops = cells.filter((cell) => cell.color === colors.topColor);
  const bases = cells.filter((cell) => cell.color === colors.baseColor);
  assert.ok(tops.length > 0 && bases.length > 0, "the top and base courses carry the wall's identity from above");
  assert.ok(Math.min(...tops.map((cell) => cell.y)) > Math.max(...bases.map((cell) => cell.y)), "the top course sits above the base course");
});

test("a doorway is a real hole: empty at head height, still walled above the lintel", () => {
  const solid = wallCells(4, 2.6, 0.2, colors, "plain", [], 0.1).cells.length;
  const { cells } = wallCells(4, 2.6, 0.2, colors, "plain", [{ at: 2, width: 1, kind: "door" }], 0.1);
  assert.ok(cells.length < solid, "the door removes cells");

  const atDoor = (y: number) => cells.filter((cell) => cell.x === 20 && cell.y === y).length;
  assert.equal(atDoor(5), 0, "nothing at knee height in the doorway");
  assert.equal(atDoor(15), 0, "nothing at head height either");
  assert.ok(atDoor(24) > 0, "but the lintel above the door is still there");
  assert.ok(cells.filter((cell) => cell.x === 5 && cell.y === 5).length > 0, "and the wall beside the door is untouched");
});

test("a window leaves a sill below it and wall above", () => {
  const { cells } = wallCells(3, 2.6, 0.2, colors, "plain", [{ at: 1.5, width: 1, kind: "window" }], 0.1);
  const column = (y: number) => cells.filter((cell) => cell.x === 15 && cell.y === y).length;
  assert.ok(column(4) > 0, "wall below the sill");
  assert.equal(column(15), 0, "opening at window height");
  assert.ok(column(24) > 0, "wall above the window");
});

test("the cutaway's crossing test finds rooms the view passes through", () => {
  const rect: Rect = [0, 0, 10, 10];
  assert.equal(segmentCrossesRect(rect, 5, 5, 20, 20), true, "starting inside counts");
  assert.equal(segmentCrossesRect(rect, -5, 5, 20, 5), true, "straight through");
  assert.equal(segmentCrossesRect(rect, -5, -5, -1, -1), false, "entirely outside");
  assert.equal(segmentCrossesRect(rect, -5, 15, 15, 15), false, "passing alongside but never entering");
  assert.equal(segmentCrossesRect(rect, -5, -5, 15, 15), true, "diagonally across the corner");
});

/** A tiny site: grass under two rooms, one wall. Enough to exercise the rebuild diff. */
const plan = (): LevelLayout => JSON.parse(JSON.stringify({
  version: 1, grid: 0.25,
  wallTypes: [{ id: "stone", name: "Stone", color: "#8f8d87", pattern: "stone" }, { id: "plaster", name: "Plaster", color: "#e8ddc8", pattern: "plaster" }],
  floorTypes: [{ id: "grass", name: "Grass", color: "#7ea563", pattern: "grass" }, { id: "tile", name: "Tile", color: "#ded5c0", pattern: "tile" }, { id: "plank", name: "Plank", color: "#a8764a", pattern: "plank" }],
  parcels: [], areas: [{ id: "site_grounds", name: "Grounds", rect: [0, 0, 12, 12], ground: "grass" }],
  rooms: [
    { id: "kitchen", name: "Kitchen", zone: "kitchen", rect: [1, 1, 4, 4], floor: "tile", parcel: "p" },
    { id: "dining", name: "Dining", zone: "dining", rect: [6, 1, 4, 4], floor: "plank", parcel: "p" },
  ],
  walls: [{ id: "w1", from: [1, 1], to: [5, 1], type: "stone", room: "kitchen" }],
}));
const everything = (layout: LevelLayout): LevelProgress =>
  ({ parcels: [], rooms: layout.rooms.map((r) => r.id), walls: layout.walls.map((w) => w.id), areas: layout.areas.map((a) => a.id) });

test("rebuilding only re-meshes the pieces that actually changed", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const layout = plan();
  const level = createLevelBuilder(scene, layout, { name: "t" });
  try {
    level.setProgress(everything(layout));
    assert.equal(level.stats().floors, 3);
    assert.equal(level.stats().walls, 1);
    const kitchen = level.floors.get("kitchen")!;
    const dining = level.floors.get("dining")!;
    const wall = level.walls.get("w1")!.mesh;

    // Nothing changed: every mesh is the same object, not a rebuilt twin.
    level.setProgress(everything(layout));
    assert.equal(level.floors.get("kitchen"), kitchen, "an untouched floor is left standing");
    assert.equal(level.floors.get("dining"), dining);
    assert.equal(level.walls.get("w1")!.mesh, wall);

    // Paint the kitchen: only the kitchen is re-meshed.
    layout.rooms[0]!.floor = "plank";
    level.setProgress(everything(layout));
    assert.notEqual(level.floors.get("kitchen"), kitchen, "the painted floor is rebuilt");
    assert.equal(level.floors.get("dining"), dining, "and its neighbour is not");
    assert.equal(level.walls.get("w1")!.mesh, wall, "nor is the wall");
    assert.ok(kitchen.isDisposed(), "the old mesh is disposed, not leaked");
  } finally { level.dispose(); scene.dispose(); engine.dispose(); }
});

test("a floor is rebuilt when a slab above it appears or goes", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const layout = plan();
  const level = createLevelBuilder(scene, layout, { name: "t" });
  try {
    level.setProgress(everything(layout));
    const grounds = level.floors.get("site_grounds")!;
    const covered = grounds.getTotalIndices();

    // Drop the kitchen: the grass that was hidden underneath has to come back.
    level.setProgress({ parcels: [], rooms: ["dining"], walls: [], areas: ["site_grounds"] });
    const exposed = level.floors.get("site_grounds")!;
    assert.notEqual(exposed, grounds, "the grounds are re-meshed when what covers them changes");
    assert.ok(exposed.getTotalIndices() > covered, `the buried grass is back: ${covered} -> ${exposed.getTotalIndices()} indices`);
    assert.equal(level.floors.has("kitchen"), false);
    assert.equal(level.walls.has("w1"), false, "a wall whose room went is gone too");
  } finally { level.dispose(); scene.dispose(); engine.dispose(); }
});
