import test from "node:test";
import assert from "node:assert/strict";
import { createColliderField, landBody, stepFall } from "./gravity.ts";

test("the collider field finds the table before the floor and ignores excluded ids", () => {
  const field = createColliderField({ cellSize: 0.5, groundY: 0 });
  field.set("table", [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, top: 0.9, bottom: 0.1 }]);
  field.set("shelf", [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, top: 1.8, bottom: 1.7 }]);
  assert.equal(field.surfaceBelow(0, 2.5, 0), 1.8, "the shelf is the highest surface under 2.5 m");
  assert.equal(field.surfaceBelow(0, 1.2, 0), 0.9, "between shelf and table the table is next");
  assert.equal(field.surfaceBelow(0, 1.2, 0, "table"), 0, "excluding the table leaves the ground");
  assert.equal(field.surfaceBelow(3, 1.2, 0), 0, "off the table there is only ground");
  assert.equal(field.topBetween(0, 0, 0.95, 1.2), null);
  field.remove("shelf");
  assert.equal(field.surfaceBelow(0, 2.5, 0), 0.9);
  assert.deepEqual(field.stats(), { ids: 1, boxes: 1 });
});

test("a falling body lands on the table top, bounces once and then rests", () => {
  const field = createColliderField();
  field.set("table", [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, top: 0.9, bottom: 0.1 }]);
  const body = { x: 0, y: 1.5, z: 0, vx: 0.4, vy: 0, vz: 0 };
  let landed: number | null = null;
  let steps = 0;
  while (landed === null && steps++ < 200) landed = stepFall(body, 1 / 60, field);
  assert.equal(landed, 0.9, "landed on the table, not the floor");
  assert.ok(body.vy < -2, "arrived with downward speed");
  const rest = landBody(body, 0.3, 0.5);
  assert.equal(rest, false, "a fast landing bounces");
  assert.ok(body.vy > 0 && body.vx === 0.2);
  body.vy = -0.1;
  assert.equal(landBody(body, 0.3, 0.5), true, "a slow landing comes to rest");
  assert.deepEqual([body.vx, body.vy, body.vz], [0, 0, 0]);
});

test("negative gravity rises and never lands", () => {
  const body = { x: 0, y: 1, z: 0, vx: 0, vy: 0.2, vz: 0 };
  for (let i = 0; i < 60; i++) assert.equal(stepFall(body, 1 / 60, null, { gravityScale: -0.2, drag: 0.5 }), null);
  assert.ok(body.y > 1.1);
});
