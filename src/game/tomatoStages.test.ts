import test from "node:test";
import assert from "node:assert/strict";
import { FRUIT_REGROW_SETTLE, TOMATO_STAGE_SECONDS, growWithOvershoot, stageScales } from "./stageTransition.ts";

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

test("regrowing fruit overshoots by the amount the animation direction asks for", () => {
  assert.equal(growWithOvershoot(0, FRUIT_REGROW_SETTLE), 0);
  assert.equal(growWithOvershoot(1, FRUIT_REGROW_SETTLE), 1);
  let peak = 0;
  let previous = 0;
  let settling = false;
  for (let step = 1; step <= 60; step++) {
    const value = growWithOvershoot(step / 60, FRUIT_REGROW_SETTLE);
    if (value < previous - 1e-9) settling = true;
    else if (settling) assert.fail("the curve must not swing back up after settling");
    peak = Math.max(peak, value);
    previous = value;
  }
  // 10-20%: a visible pop, not a bounce.
  assert.ok(peak > 1.09 && peak <= 1.2, `overshoot ${peak} inside the 10-20% band`);
  assert.ok(settling, "and it settles back onto the target");
});
