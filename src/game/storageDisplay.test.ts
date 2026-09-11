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
