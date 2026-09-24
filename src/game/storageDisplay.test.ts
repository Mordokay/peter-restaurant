import test from "node:test";
import assert from "node:assert/strict";
import { footprintFor, gridsOf, packStock } from "./storageDisplay.ts";

/** Two shelves and one drawer layer, each five across by three deep. */
const names: string[] = [];
for (const grid of ["shelf_a", "shelf_b", "drawer_low"]) {
  for (let row = 1; row <= 3; row++) for (let col = 1; col <= 5; col++) names.push(`${grid}_c${col}r${row}`);
}
const grids = gridsOf(names);

test("socket names read back as grids that know their size and what kind of place they are", () => {
  assert.deepEqual(grids.map((g) => g.id), ["shelf_a", "shelf_b", "drawer_low"]);
  assert.deepEqual(grids.map((g) => g.zone), ["shelf", "shelf", "drawer"]);
  assert.deepEqual(grids.map((g) => [g.cols, g.rows]), [[5, 3], [5, 3], [5, 3]]);
  assert.equal(grids[0]!.slot(3, 2), "shelf_a_c3r2");
  assert.equal(grids[0]!.slot(9, 9), undefined);
  assert.deepEqual(gridsOf(["handle", "vent"]), [], "sockets that are not grid places are left alone");
});

test("stock is shown literally: ten blocks of tofu are ten blocks, one is one", () => {
  const ten = packStock([{ model: "tofu", count: 10 }], grids);
  assert.equal(ten.length, 10);
  assert.equal(new Set(ten.map((p) => p.slots[0])).size, 10, "no two things in one place");
  assert.equal(ten.filter((p) => p.grid === "shelf_a").length, 15 >= 10 ? 10 : 15, "they fill the first shelf");
  assert.deepEqual(packStock([{ model: "tofu", count: 1 }], grids).map((p) => p.slots), [["shelf_a_c1r1"]]);
});

test("a watermelon takes a two-by-two square and the places under it stay occupied", () => {
  const fill = packStock([{ model: "watermelon", count: 2, footprint: [2, 2] }, { model: "plum", count: 4 }], grids);
  const melons = fill.filter((p) => p.model === "watermelon");
  assert.equal(melons.length, 2);
  assert.equal(melons[0]!.slots.length, 4, "four places under one melon");
  assert.deepEqual(melons[0]!.slots, ["shelf_a_c1r1", "shelf_a_c2r1", "shelf_a_c1r2", "shelf_a_c2r2"]);
  assert.deepEqual(melons[1]!.slots[0], "shelf_a_c3r1");
  // The plums take places the melons left, and never one already under a melon.
  const used = new Set(melons.flatMap((p) => p.slots));
  assert.equal(fill.filter((p) => p.model === "plum").length, 4);
  assert.ok(fill.filter((p) => p.model === "plum").every((p) => !used.has(p.slots[0]!)));
});

test("something too big for what is left moves on instead of stranding the space", () => {
  // Five single plums fill row 1; a 2x2 tray cannot start there, so it drops to the rows below.
  const fill = packStock([{ model: "plum", count: 5 }, { model: "tray", count: 1, footprint: [2, 2] }], grids);
  const tray = fill.find((p) => p.model === "tray")!;
  assert.equal(tray.row, 2, "the tray takes the next depth rows down");
  assert.equal(fill.filter((p) => p.model === "plum").length, 5);
});

test("goods can be barred from a place, or prefer one", () => {
  const fill = packStock([
    { model: "ketchup", count: 3, only: "shelf" },
    { model: "cabbage", count: 4, prefer: "drawer" },
  ], grids);
  const where = (model: string) => fill.filter((p) => p.model === model).map((p) => p.grid);
  assert.ok(where("ketchup").every((grid) => grid.startsWith("shelf_")), "ketchup stays on shelves");
  assert.ok(where("cabbage").every((grid) => grid === "drawer_low"), "the cabbages take the drawer");
  assert.equal(fill.length, 7, "and everything is on show");
});

test("a preference gives way rather than hiding stock", () => {
  const fill = packStock([{ model: "cabbage", count: 20, prefer: "drawer" }], grids);
  assert.equal(fill.filter((p) => p.grid === "drawer_low").length, 15, "the drawer fills first");
  assert.equal(fill.length, 20, "the overflow still shows, on the shelves");
});

test("stock barred from every place here is simply not shown, and a full cabinet stops", () => {
  assert.deepEqual(packStock([{ model: "wine", count: 3, only: "cellar" }], grids), []);
  assert.equal(packStock([{ model: "pea", count: 100 }], grids).length, 45, "forty-five places, forty-five bags");
  assert.deepEqual(packStock([], grids), []);
  assert.deepEqual(packStock([{ model: "pea", count: 0 }], grids), []);
});

test("an item's real size becomes the number of places it needs", () => {
  assert.deepEqual(footprintFor(0.1, 0.1, 0.15, 0.17), [1, 1], "a plum takes one");
  assert.deepEqual(footprintFor(0.28, 0.3, 0.15, 0.17), [2, 2], "a watermelon takes two by two");
  assert.deepEqual(footprintFor(0.4, 0.12, 0.15, 0.17), [3, 1], "a long tray is three across and one deep");
  assert.deepEqual(footprintFor(9, 9, 0.15, 0.17), [3, 3], "and nothing swallows more than three");
});

test("an item's footprint is measured against the places it is standing in", () => {
  // Two grids with very different places: a wide board and a single plate. The
  // same dish covers one place on each, and a lettuce that needs two places on
  // a tight shelf needs one on the board. Sizing everything by the first grid
  // was the bug: a 1x1 plate defined the board's places, the board's own
  // spacing was never consulted, and it refused items it had room for.
  const names = ["board_c1r1", "board_c2r1", "board_c3r1", "board_c1r2", "board_c2r2", "board_c3r2", "plate_c1r1"];
  const twoGrids = gridsOf(names);
  const board = twoGrids.find((grid) => grid.id === "board")!;
  const plate = twoGrids.find((grid) => grid.id === "plate")!;
  assert.deepEqual([board.cols, board.rows], [3, 2]);
  assert.deepEqual([plate.cols, plate.rows], [1, 1]);

  const fill = packStock(
    [{ model: "item_carrot", count: 1, only: "board" }, { model: "item_lettuce", count: 1, only: "board" },
     { model: "dish", count: 1, only: "plate" }],
    twoGrids,
    // Wide places on the board, and a plate whose one place holds whatever stands on it.
    { footprintOf: (model, grid) => (grid.id === "plate" ? [1, 1] : model === "item_carrot" ? [1, 1] : [1, 1]) },
  );
  assert.equal(fill.length, 3, "everything gets somewhere to stand");
  assert.deepEqual(fill.filter((p) => p.grid === "board").map((p) => p.model).sort(), ["item_carrot", "item_lettuce"]);
  assert.equal(fill.find((p) => p.grid === "plate")?.model, "dish");
});

test("a place too small for an item costs it more places, and only in that grid", () => {
  const tight = gridsOf(["shelf_c1r1", "shelf_c2r1", "shelf_c3r1"]);
  // Three places, and a thing that needs two of them: one fits, the second cannot.
  const fill = packStock([{ model: "melon", count: 2 }], tight, { footprintOf: () => [2, 1] });
  assert.equal(fill.length, 1, "two melons do not fit in three places when each takes two");
  assert.deepEqual(fill[0]!.slots, ["shelf_c1r1", "shelf_c2r1"]);
});
