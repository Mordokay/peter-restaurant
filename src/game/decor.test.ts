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

test("looping props start as instances and promote within a distance, concurrency and per-frame budget", () => {
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
  const focus = { x: 0, z: 0 };
  const decor = createDecorScene(scene, catalog, layout, { cacheRev: () => 1, animation: { focus: () => focus, maxRigs: 1, distance: 5, exitDistance: 6 } });
  const stats = decor.stats();

  assert.equal(stats.props, 3);
  assert.equal(stats.rigs, 0, "loading a looping model does not eagerly promote every placement");
  assert.equal(stats.instances, 3);
  assert.equal(stats.rigBuilds, 0);
  assert.ok(stats.rigBuildMs >= 0);

  decor.update(1 / 60);
  assert.equal(decor.stats().rigs, 1);
  assert.ok(decor.placed.get("swaying_1")!.rig, "nearest eligible plant wins the budget");
  assert.equal(decor.stats().rigCacheMisses, 0, "static source build already cached the part buffers");
  assert.ok(decor.stats().rigCacheHits > 0);
  assert.ok(decor.stats().tracksSampled > 0, "a promoted prop samples its clip every frame");

  focus.x = 30;
  decor.update(1 / 60);
  assert.equal(decor.stats().rigs, 0, "leaving the radius demotes idle rigs");
  assert.equal(decor.stats().tracksSampled, 0);
  focus.x = 4;
  decor.update(1 / 60);
  assert.ok(decor.placed.get("swaying_2")!.rig);
  decor.pin("swaying_1", true);
  assert.equal(decor.stats().protectedRigs, 1, "editor selection is protected from the ambient cap");
  focus.x = 30;
  decor.update(1 / 60);
  assert.equal(decor.stats().rigs, 1, "only the pinned rig survives leaving the radius");
  decor.pin("swaying_1", false);
  assert.equal(decor.stats().rigs, 0);

  decor.dispose(); scene.dispose(); engine.dispose();
});

test("interactions finish outside the ambient radius and keep open doors until closed", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const model = {
    id: "test_door", name: "Door", pitch: 0.02, palette: { a: "#cccccc" },
    parts: [{ id: "door", pivot: [0, 0, 0] as [number, number, number], boxes: [[0, 0, 0, 1, 1, 0, "a"] as const] }],
    clips: [
      { id: "idle", loop: true, partial: true, duration: 2, tracks: [] },
      { id: "open", duration: 1, tracks: [{ part: "door", keys: [{ t: 0, rotation: [0, 0, 0] as [number, number, number] }, { t: 1, rotation: [0, 90, 0] as [number, number, number] }] }] },
      { id: "close", duration: 1, tracks: [{ part: "door", keys: [{ t: 0, rotation: [0, 90, 0] as [number, number, number] }, { t: 1, rotation: [0, 0, 0] as [number, number, number] }] }] },
    ],
  };
  const layout: DecorLayout = { version: 1, props: [{ id: "door", model: model.id, position: [100, 0, 0], interactClip: "open" }] };
  const decor = createDecorScene(scene, { version: 1, models: { [model.id]: model } }, layout, { cacheRev: () => 1, animation: { focus: () => ({ x: 0, z: 0 }), maxRigs: 0 } });
  assert.equal(decor.trigger("door"), true);
  decor.update(0.5);
  assert.equal(decor.stats().protectedRigs, 1);
  decor.update(0.6);
  const entry = decor.placed.get("door")!;
  assert.equal(entry.reacting, false);
  assert.ok(entry.heldPose);
  assert.ok(Math.abs(entry.rig!.parts.get("door")!.node.rotation.y - Math.PI / 2) < 1e-5);
  decor.update(1);
  assert.equal(decor.stats().protectedRigs, 1);
  entry.prop.interactClip = "close";
  decor.trigger("door");
  decor.update(1.1);
  decor.update(0.1);
  assert.equal(decor.stats().rigs, 0, "returning to rest permits demotion");
  decor.dispose(); scene.dispose(); engine.dispose();
});

test("the promotion queue respects its per-frame budget and hidden props do not sample clips", () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const model = { id: "budget_fixture", name: "Plant", pitch: 0.1, palette: { a: "#88bb33" },
    parts: [{ id: "leaf", pivot: [0, 0, 0] as const, voxels: [[0, 0, 0, "a"] as const] }],
    clips: [{ id: "sway", loop: true, duration: 2, tracks: [{ part: "leaf", keys: [{ t: 0, rotation: [0, 0, -5] as const }, { t: 1, rotation: [0, 0, 5] as const }, { t: 2, rotation: [0, 0, -5] as const }] }] }],
  };
  const layout: DecorLayout = { version: 1, props: Array.from({ length: 10 }, (_, i) => ({ id: `plant-${i}`, model: model.id, position: [i / 10, 0, 0] })) };
  const decor = createDecorScene(scene, { version: 1, models: { [model.id]: model } }, layout, { cacheRev: () => 1, animation: { focus: () => ({ x: 0, z: 0 }), maxRigs: 4, promotionsPerFrame: 2 } });
  decor.update(0.1);
  assert.equal(decor.stats().ambientRigs, 2);
  decor.update(0.1);
  assert.equal(decor.stats().ambientRigs, 4);
  assert.notEqual(decor.placed.get("plant-0")!.player!.time, decor.placed.get("plant-1")!.player!.time, "placements have deterministic phase offsets");
  for (const prop of layout.props) prop.hidden = true;
  decor.refreshVisibility();
  decor.update(0.1);
  assert.equal(decor.stats().ambientRigs, 0);
  assert.equal(decor.stats().tracksSampled, 0);
  decor.dispose(); scene.dispose(); engine.dispose();
});
