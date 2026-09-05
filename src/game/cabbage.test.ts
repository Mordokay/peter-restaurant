import test from "node:test";
import assert from "node:assert/strict";
import { cabbageLeafMotion } from "./cabbage.ts";

test("cabbage outer leaves visibly open and flap more than its heart", () => {
  assert.ok(cabbageLeafMotion.outerOpeningRadians >= 0.4);
  assert.ok(cabbageLeafMotion.outerFlapRadians >= 0.07);
  assert.ok(Math.abs(cabbageLeafMotion.middleOpeningRadians - Math.PI / 6) < 0.25);
  assert.equal(cabbageLeafMotion.middleLayerYawRadians, Math.PI / 4);
  assert.ok(cabbageLeafMotion.middleLayerScale < 0.9);
  assert.ok(cabbageLeafMotion.innerLayerScale < cabbageLeafMotion.middleLayerScale);
  assert.ok(cabbageLeafMotion.outerOpeningRadians > cabbageLeafMotion.middleOpeningRadians);
  assert.ok(cabbageLeafMotion.outerFlapRadians > cabbageLeafMotion.middleFlapRadians);
  assert.ok(cabbageLeafMotion.outerFlapRadians > cabbageLeafMotion.innerFlapRadians * 2);
  assert.ok(cabbageLeafMotion.cyclesPerSecond < 0.2);
});
