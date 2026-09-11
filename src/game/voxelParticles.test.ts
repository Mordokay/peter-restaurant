import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core";
import { defaultEmitter, spawnVelocity } from "./voxelParticles.ts";

test("spawn velocities stay inside the emitter cone at the requested speed", () => {
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const axis = new Vector3(0.3, 1, -0.2).normalize();
  for (let i = 0; i < 500; i++) {
    const v = spawnVelocity(axis, 30, 2, random);
    assert.ok(Math.abs(v.length() - 2) < 1e-6);
    const angle = (Math.acos(Math.min(1, Vector3.Dot(v.normalizeToNew(), axis))) * 180) / Math.PI;
    assert.ok(angle <= 30 + 1e-6, `angle ${angle} exceeds the 30° cone`);
  }
  const straight = spawnVelocity(new Vector3(0, 0, 0), 0, 1, random);
  assert.deepEqual([straight.x, straight.y, straight.z].map((n) => Math.round(n * 1000) / 1000), [0, 1, 0], "no direction means straight up");
});

test("a default emitter is a sticky splashing burst on the given part", () => {
  const emitter = defaultEmitter("juice", [3, 4, 5], "#c0392b", "blade", 0.004);
  assert.equal(emitter.mode, "burst");
  assert.equal(emitter.size, 3, "about a centimetre at a 4 mm pitch");
  assert.equal(emitter.part, "blade");
  assert.deepEqual(emitter.colors, ["#c0392b"]);
  assert.ok(emitter.stick && emitter.fade && emitter.gravity === 1);
});
