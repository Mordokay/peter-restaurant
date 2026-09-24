import test from "node:test";
import assert from "node:assert/strict";
import {
  BIN_BATCHES, COMPOST_PER_BATCH, COMPOST_SECONDS, SCRAPS_PER_BATCH,
  addScraps, describeHeap, emptyHeap, fullness, nextReadyIn, rot, takeCompost,
} from "./compost.ts";

test("scraps pile up until there are enough to start a batch rotting", () => {
  let heap = emptyHeap();
  ({ heap } = addScraps(heap, SCRAPS_PER_BATCH - 1));
  assert.equal(heap.loose, SCRAPS_PER_BATCH - 1);
  assert.equal(heap.rotting.length, 0, "a partial batch is not rotting yet");

  ({ heap } = addScraps(heap, 1));
  assert.equal(heap.loose, 0);
  assert.equal(heap.rotting.length, 1);
  assert.equal(nextReadyIn(heap), COMPOST_SECONDS);
});

test("topping the bin up does not restart what is already rotting", () => {
  // The small unfairness of every "one timer per container" design.
  let heap = emptyHeap();
  ({ heap } = addScraps(heap, SCRAPS_PER_BATCH));
  heap = rot(heap, COMPOST_SECONDS * 0.8);
  ({ heap } = addScraps(heap, SCRAPS_PER_BATCH));
  assert.equal(heap.rotting.length, 2);
  assert.ok(Math.abs(nextReadyIn(heap)! - COMPOST_SECONDS * 0.2) < 1e-6,
    "the older batch keeps its remaining time");

  heap = rot(heap, COMPOST_SECONDS * 0.2);
  assert.equal(heap.ready, COMPOST_PER_BATCH, "the first batch finished on its own schedule");
  assert.equal(heap.rotting.length, 1, "and the second is still going");
});

test("a full bin refuses what it cannot hold", () => {
  let heap = emptyHeap();
  const { taken } = addScraps(heap, SCRAPS_PER_BATCH * (BIN_BATCHES + 4));
  heap = addScraps(emptyHeap(), SCRAPS_PER_BATCH * (BIN_BATCHES + 4)).heap;
  assert.equal(heap.rotting.length, BIN_BATCHES);
  assert.ok(taken < SCRAPS_PER_BATCH * (BIN_BATCHES + 4), "it did not swallow the lot");
  assert.equal(fullness(heap) > 0.8, true);
});

test("compost is taken out of the bin, and only what is finished", () => {
  let heap = emptyHeap();
  ({ heap } = addScraps(heap, SCRAPS_PER_BATCH * 2));
  assert.deepEqual(takeCompost(heap).taken, 0, "nothing is ready yet");
  heap = rot(heap, COMPOST_SECONDS);
  assert.equal(heap.ready, COMPOST_PER_BATCH * 2);

  let taken = 0;
  ({ heap, taken } = takeCompost(heap, 3));
  assert.equal(taken, 3);
  assert.equal(heap.ready, COMPOST_PER_BATCH * 2 - 3);
  assert.match(describeHeap(heap), /compost ready/);
  assert.equal(describeHeap(emptyHeap()), "empty");
});
