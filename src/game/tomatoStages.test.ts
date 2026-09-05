import test from "node:test";
import assert from "node:assert/strict";
import { TOMATO_STAGE_SECONDS, stageScales } from "./stageTransition.ts";

test("tomato stage transitions cross-scale with ease-in-out and a bounded settle", () => {
  assert.equal(TOMATO_STAGE_SECONDS, 0.5);
  assert.deepEqual(stageScales(0), { outgoing: 1, incoming: 0 });
  assert.deepEqual(stageScales(1), { outgoing: 0, incoming: 1 });

  let previousOut = 1;
  let previousIn = 0;
  let maxIncoming = 0;
  let peakSeen = false;
  for (let step = 1; step <= 40; step++) {
    const t = step / 40;
    const { outgoing, incoming } = stageScales(t);
    assert.ok(outgoing <= previousOut + 1e-9, "outgoing scale only shrinks");
    // The incoming scale grows, overshoots slightly, then settles back to 1 —
    // a decrease is only the settle, never a large drop.
    if (incoming < previousIn - 1e-9) {
      peakSeen = true;
      assert.ok(incoming >= 0.99, "settle recovers smoothly, no dip below the final scale");
    } else if (peakSeen) {
      assert.fail("scale re-grows after the settle began");
    }
    maxIncoming = Math.max(maxIncoming, incoming);
    previousOut = outgoing;
    previousIn = incoming;
  }
  // The settle overshoot stays small — a touch of life, not a cartoon squash.
  assert.ok(maxIncoming > 1 && maxIncoming <= 1.03, `overshoot ${maxIncoming} within bounds`);
  assert.ok(peakSeen, "curve visibly overshoots before settling");
});
