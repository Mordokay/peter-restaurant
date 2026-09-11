import test from "node:test";
import assert from "node:assert/strict";
import { floorCells, wallCells } from "./levelBuilder.ts";
import { segmentCrossesRect } from "./cutaway.ts";
import type { Rect } from "./levelLayout.ts";

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
