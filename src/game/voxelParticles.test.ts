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

test("an emitter with a volume seeds anywhere inside that box, not at a point", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const world = createParticleWorld(scene, { capacity: 400, groundY: -100 });
  const model: AuthoredVoxelModel = {
    id: "cabinet", pitch: 0.01, palette: { c0: "#ffffff" }, parts: [{ id: "p0", pivot: [0, 0, 0], runs: [] }],
    emitters: [{
      ...defaultEmitter("fog", [0, 0, 0], "#eaf6fd"),
      volume: [80, 120, 60], mode: "burst", count: 200, gravity: 0, speed: [0, 0], life: [9, 9], alpha: 0.2,
    }],
  };
  const handle = world.attach({ model, world: () => Matrix.Identity() });
  handle.fire("fog");
  world.update(0.001);

  // Read the cubes back: they should be spread across the box, not stacked on one spot.
  const mesh = scene.meshes.find((candidate) => /glass/.test(candidate.name))!;
  const positions = mesh.getVerticesData("position")!;
  const centres: number[][] = [];
  for (let p = 0; p < positions.length / 3; p += 24) {
    let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < 24; v++) { cx += positions[(p + v) * 3]!; cy += positions[(p + v) * 3 + 1]!; cz += positions[(p + v) * 3 + 2]!; }
    if (Math.abs(cx) + Math.abs(cy) + Math.abs(cz) > 1e-6) centres.push([cx / 24, cy / 24, cz / 24]);
  }
  assert.ok(centres.length > 100, `expected a boxful of particles, got ${centres.length}`);
  const spread = (axis: number) => Math.max(...centres.map((c) => c[axis]!)) - Math.min(...centres.map((c) => c[axis]!));
  assert.ok(spread(0) > 0.5, `should fill the 0.8 m width, spread ${spread(0).toFixed(2)}`);
  assert.ok(spread(1) > 0.8, `should fill the 1.2 m height, spread ${spread(1).toFixed(2)}`);
  assert.ok(spread(2) > 0.35, `should fill the 0.6 m depth, spread ${spread(2).toFixed(2)}`);
  assert.ok(spread(0) < 0.9 && spread(1) < 1.3, "and stay inside the box");

  handle.dispose(); world.dispose(); scene.dispose(); engine.dispose();
});
