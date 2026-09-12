import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene } from "@babylonjs/core";
import { createDecorScene } from "./decor.ts";
import { validateDecorLayout, type DecorLayout } from "./decorLayout.ts";
import type { AuthoredVoxelCatalog } from "./voxelModel.ts";
import { readCatalog } from "../../scripts/catalog-io.mjs";
import { readFileSync } from "node:fs";

const catalog = readCatalog() as unknown as AuthoredVoxelCatalog;

test("the saved decor layout only places catalog models at valid spots", () => {
  const layout = JSON.parse(readFileSync(new URL("../assets/scene/decor.json", import.meta.url), "utf8")) as DecorLayout;
  assert.deepEqual(validateDecorLayout(layout, catalog), []);
});

test("decor validation catches unknown models, repeated ids and bad transforms", () => {
  const layout: DecorLayout = {
    version: 1,
    props: [
      { id: "vase_1", model: "tomato_ripe_scan", position: [1, 0.22, -2], rotationY: 90, scale: 0.5 },
      { id: "vase_3", model: "tomato_ripe_scan", position: [1, 0.22, -2], rotation: [15, 90, 0], scale: [1, 2, 1] },
      { id: "vase_4", model: "tomato_ripe_scan", position: [1, 0.22, -2], rotation: [15, 90] as never, scale: [1, 0, 1] },
      { id: "vase_1", model: "nope", position: [0, 0], scale: 0 } as never,
      { id: "plant_2", model: "tomato_ripe_scan", position: [0, 0, 0], clip: "harvest", interactClip: "nope" },
    ],
  };
  const errors = validateDecorLayout(layout, catalog);
  assert.ok(errors.some((e) => e.includes("repeats")));
  assert.ok(errors.some((e) => e.includes("unknown model nope")));
  assert.ok(errors.some((e) => e.includes("invalid position")));
  assert.ok(errors.some((e) => e.includes("scale must be positive")));
  assert.ok(errors.some((e) => e.includes("reacts with unknown clip nope")));
  assert.ok(errors.some((e) => e.includes("vase_4 rotation needs 3 numbers")));
  assert.ok(errors.some((e) => e.includes("vase_4 scale must be positive")));
  assert.ok(!errors.some((e) => e.includes("vase_3")), "three-axis rotation and per-axis scale are valid");
  assert.ok(!errors.some((e) => e.includes("loops unknown clip harvest")), "a real clip is accepted as the idle loop");
});

test("a model with a looping clip turns every placement of it into a rig, uncached", () => {
  // This is the load-time bomb behind the whole stress plan, pinned so it cannot change silently.
  //
  // `wantsRig` is true whenever a prop has an `idleClip`, and `place` picks the idleClip as ANY looping
  // clip the model happens to carry. So authoring a `sway` clip onto a plant does not just make that
  // plant sway — it converts every single placement of it from a shared world-renderer instance into an
  // individually meshed VoxelRig, at placement time, on the main thread, with no cache. The source cache
  // serves the world renderer only.
  //
  // The consequence is that the cost of dressing a room scales with how many of its models happen to be
  // animated, not with how many are on screen. That is what the promotion gate in the plan has to fix.
  const engine = new NullEngine();
  const scene = new Scene(engine);
  // savoy_cabbage carries a looping "idle" clip; a barrel carries none.
  const animated = catalog.models["savoy_cabbage"];
  assert.ok(animated?.clips?.some((clip) => clip.loop), "savoy_cabbage should still have a looping clip");

  const layout: DecorLayout = {
    version: 1,
    props: [
      { id: "still", model: "tomato_ripe_scan", position: [0, 0, 0], clip: null },
      { id: "swaying_1", model: "savoy_cabbage", position: [2, 0, 0] },
      { id: "swaying_2", model: "savoy_cabbage", position: [4, 0, 0] },
    ],
  };
  const decor = createDecorScene(scene, catalog, layout);
  const stats = decor.stats();

  assert.equal(stats.props, 3);
  assert.equal(stats.rigs, 2, "both cabbages were promoted just for carrying a looping clip");
  assert.equal(stats.instances, 1, "only the prop with clip:null stayed an instance");
  assert.equal(stats.rigBuilds, 2, "each promotion is its own remesh — nothing is shared or cached");
  assert.ok(stats.rigBuildMs >= 0);

  // And each rigged prop samples its whole clip every frame, whether or not anything can see it.
  decor.update(1 / 60);
  assert.ok(decor.stats().tracksSampled > 0, "a promoted prop samples its clip every frame");

  decor.dispose(); scene.dispose(); engine.dispose();
});
