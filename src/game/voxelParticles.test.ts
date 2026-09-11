import test from "node:test";
import assert from "node:assert/strict";
import { Matrix, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { createParticleWorld, defaultEmitter, spawnVelocity } from "./voxelParticles.ts";
import type { AuthoredVoxelModel } from "./voxelModel.ts";

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

test("emitter handles: burst fires once, continuous runs for its duration, stopAll silences it", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const world = createParticleWorld(scene, { capacity: 200, groundY: -100 });
  const model: AuthoredVoxelModel = {
    id: "pot", pitch: 0.01, palette: { c0: "#ffffff" }, parts: [{ id: "p0", pivot: [0, 0, 0], runs: [] }],
    emitters: [
      { ...defaultEmitter("splash", [0, 0, 0], "#c0392b"), mode: "burst", count: 5, life: [9, 9], gravity: 0 },
      { ...defaultEmitter("steam", [0, 0, 0], "#eeeeee"), mode: "continuous", rate: 10, duration: 2, life: [9, 9], gravity: 0 },
    ],
  };
  const handle = world.attach({ model, world: () => Matrix.Identity() });
  assert.equal(world.stats().alive, 0, "a duration-bound emitter does not auto-start");

  handle.fire("splash");
  assert.equal(world.stats().alive, 5, "a burst fires its count");

  // "start" on a burst emitter must fire it once, never run it forever.
  handle.handleEvent({ t: 0, name: "x", emit: "splash", emitAction: "start" });
  assert.equal(world.stats().alive, 10, "start on a burst emitter fires it once…");
  world.update(1);
  assert.equal(world.stats().alive, 10, "…and leaves nothing running");

  handle.start("steam");
  world.update(1);
  assert.equal(world.stats().alive, 20, "ten a second for one second");
  world.update(1);
  assert.equal(world.stats().alive, 30, "the second second completes its two-second duration");
  world.update(1);
  assert.equal(world.stats().alive, 30, "the duration expired, so nothing more is emitted");

  handle.start("steam");
  world.update(0.5);
  assert.equal(world.stats().alive, 35, "restarted");
  handle.stopAll();
  world.update(1);
  assert.equal(world.stats().alive, 35, "stopAll silences a running emitter");

  handle.dispose();
  world.dispose();
  scene.dispose();
  engine.dispose();
});
