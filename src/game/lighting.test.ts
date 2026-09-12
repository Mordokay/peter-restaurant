import test from "node:test";
import assert from "node:assert/strict";
import { ArcRotateCamera, MeshBuilder, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { attachGlow, createLightPool, tagGlow } from "./lighting.ts";
import type { ModelLight } from "./voxelModel.ts";

const lamp = (color = "#ffd9a0"): ModelLight => ({ position: [0, 0, 0], color, intensity: 1, range: 7 });

/** A scene with a camera whose target we can move, which is what the pool ranks against. */
function stage(): { scene: Scene; camera: ArcRotateCamera; frame: () => void; dispose: () => void } {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("camera", 0, 1, 10, Vector3.Zero(), scene);
  return {
    scene, camera,
    // The pool works off onBeforeRenderObservable, so a "frame" is that observable firing.
    frame: () => scene.onBeforeRenderObservable.notifyObservers(scene),
    dispose: () => { scene.dispose(); engine.dispose(); },
  };
}

test("the pool lights the nearest registered positions, and only that many", () => {
  const { scene, camera, frame, dispose } = stage();
  const pool = createLightPool(scene, { max: 3 });
  // Ten lamps in a line running away from the camera target at the origin.
  for (let i = 0; i < 10; i++) pool.register(`lamp${i}`, new Vector3(i * 2, 0, 0), lamp());
  camera.target.set(0, 0, 0);
  frame();
  assert.equal(pool.stats().registered, 10);
  assert.equal(pool.stats().active, 3, "only the pool's own lights are ever real");
  // The three real lights stand at the three nearest positions, nearest first.
  const real = scene.lights.filter((light) => light.isEnabled() && light.name.startsWith("pool light"));
  assert.deepEqual(real.map((light) => (light as unknown as { position: Vector3 }).position.x), [0, 2, 4]);
  dispose();
});

test("a still camera does not re-rank, and a moved one does", () => {
  const { scene, camera, frame, dispose } = stage();
  const pool = createLightPool(scene, { max: 2 });
  for (let i = 0; i < 200; i++) pool.register(`lamp${i}`, new Vector3(i, 0, 0), lamp());
  camera.target.set(0, 0, 0);
  frame();
  assert.equal(pool.stats().ranks, 1, "the first frame ranks");

  // The ranking is reused while nothing moves: this is the whole point, because it used to allocate
  // one object per registered light and sort them all, sixty times a second, forever.
  for (let i = 0; i < 5; i++) frame();
  assert.equal(pool.stats().ranks, 1, "a still camera re-ranked anyway");

  // A nudge smaller than the epsilon is still not worth re-ranking.
  camera.target.set(0.1, 0, 0);
  frame();
  assert.equal(pool.stats().ranks, 1, "a 10 cm drift forced a re-rank");

  // A real move does re-rank, and picks up the lights that are now nearest.
  camera.target.set(100, 0, 0);
  frame();
  assert.equal(pool.stats().ranks, 2, "a real move should re-rank exactly once");
  const real = scene.lights.filter((light) => light.isEnabled() && light.name.startsWith("pool light"));
  assert.deepEqual(real.map((light) => (light as unknown as { position: Vector3 }).position.x).sort((a, b) => a - b), [99, 100]);
  dispose();
});

test("a light appearing or going out re-ranks even though the camera never moved", () => {
  const { scene, camera, frame, dispose } = stage();
  const pool = createLightPool(scene, { max: 1 });
  pool.register("far", new Vector3(50, 0, 0), lamp());
  camera.target.set(0, 0, 0);
  frame();
  const positionOf = () => (scene.lights.find((light) => light.isEnabled() && light.name.startsWith("pool light")) as unknown as { position: Vector3 } | undefined)?.position.x;
  assert.equal(positionOf(), 50);

  // Registering a nearer lamp must take the slot, or a lamp placed in front of a standing player
  // would simply never light.
  pool.register("near", new Vector3(1, 0, 0), lamp());
  frame();
  assert.equal(positionOf(), 1, "a newly registered nearer light did not take the slot");

  pool.unregister("near");
  frame();
  assert.equal(positionOf(), 50, "the slot did not fall back when the near light went away");
  dispose();
});

test("dimming for nightfall reaches the lights that are already lit", () => {
  const { scene, camera, frame, dispose } = stage();
  const pool = createLightPool(scene, { max: 1 });
  pool.register("lamp", new Vector3(0, 0, 0), { ...lamp(), intensity: 2 });
  camera.target.set(0, 0, 0);
  frame();
  const light = scene.lights.find((l) => l.name.startsWith("pool light"))!;
  assert.equal(light.intensity, 2);
  // Nothing has moved, so this only works because setIntensityScale invalidates the ranking.
  pool.setIntensityScale(0.25);
  frame();
  assert.equal(light.intensity, 0.5, "the day/night dim never reached the pooled light");
  dispose();
});

test("the glow layer blooms only what asked to, never the whole scene", () => {
  const { scene, dispose } = stage();
  const layer = attachGlow(scene);
  // Nothing glows yet, so the layer is off — a GlowLayer with no include list redraws every active
  // mesh into its texture, which measured 83 draw calls and 333,000 triangles on the compound.
  assert.equal(layer.isEnabled, false);

  const plain = MeshBuilder.CreateBox("plain", { size: 1 }, scene);
  const glowing = MeshBuilder.CreateBox("glowing", { size: 1 }, scene);
  tagGlow(glowing, { r: 1, g: 0.8, b: 0.4, intensity: 1 });

  assert.equal(layer.isEnabled, true, "tagging something should switch the layer on");
  // The include list is the part that matters: without it, one lamp costs a full extra scene pass
  // over every mesh in the compound.
  const included = (layer as unknown as { _thinEffectLayer: { _includedOnlyMeshes: number[] } })._thinEffectLayer._includedOnlyMeshes;
  assert.deepEqual(included, [glowing.uniqueId], "the glow pass was not confined to the glowing mesh");
  assert.ok(!included.includes(plain.uniqueId));

  // And it lets go again, so a disposed lamp does not keep the pass alive.
  glowing.dispose();
  assert.deepEqual(included, []);
  assert.equal(layer.isEnabled, false, "the layer should switch off when the last glowing mesh goes");
  dispose();
});
