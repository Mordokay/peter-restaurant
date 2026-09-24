import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import { createCropFruit, fruitSocketsOf } from "./cropFruit.ts";
import { readCatalog } from "../../scripts/catalog-io.mjs";
import type { AuthoredVoxelCatalog } from "./voxelModel.ts";

const catalog = readCatalog() as unknown as AuthoredVoxelCatalog;

const stage = () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  return { engine, scene, node: new TransformNode("plant", scene) };
};

test("fruit sockets are read in index order, not string order", () => {
  // `fruit_10` sorts before `fruit_2` as text, which would hang fruit in the
  // wrong places once a crop carries more than nine.
  const model = catalog.models["crop_pepper_ripe_red"]!;
  const sockets = fruitSocketsOf(model);
  assert.equal(sockets.length, 10, "the pepper should carry ten fruit sockets");
  assert.deepEqual(sockets.map((s) => s.name),
    Array.from({ length: 10 }, (_, i) => `fruit_${i}`));
});

test("one plant model serves every yield count", () => {
  const { scene, node, engine } = stage();
  const model = catalog.models["crop_strawberry_ripe"]!;
  const fruit = createCropFruit({ scene, model, node, catalog, fruit: "item_strawberry", seed: "bed_1" });

  assert.equal(fruit.capacity, 8, "the strawberry carries eight sockets");
  for (const count of [4, 8, 6, 0]) {
    fruit.show(count);
    assert.equal(fruit.shown, count, `asked for ${count}`);
  }
  // Asking for more than the plant can hold is clamped, never an error.
  fruit.show(99);
  assert.equal(fruit.shown, 8);

  fruit.dispose(); scene.dispose(); engine.dispose();
});

test("no two fruit are the same size, and the same plant grows the same fruit twice", () => {
  const { scene, node, engine } = stage();
  const model = catalog.models["crop_strawberry_ripe"]!;
  const make = (seed: string) => {
    const display = createCropFruit({ scene, model, node, catalog, fruit: "item_strawberry", seed });
    display.show(8);
    const sizes = scene.meshes.filter((m) => m.name.includes(".fruit_")).map((m) => m.scaling.x);
    return { display, sizes };
  };

  const first = make("bed_1");
  assert.equal(first.sizes.length, 8);
  assert.ok(new Set(first.sizes.map((s) => s.toFixed(4))).size >= 7, "a plant of identical clones reads as a printed motif");
  for (const s of first.sizes) assert.ok(s > 0.8 && s < 1.2, `size ${s} strayed outside the band`);
  first.display.dispose();

  // Deterministic: reload the save, get the same plant.
  const again = make("bed_1");
  assert.deepEqual(again.sizes.map((s) => s.toFixed(6)), first.sizes.map((s) => s.toFixed(6)));
  again.display.dispose();

  // A different plant is a different plant.
  const other = make("bed_2");
  assert.notDeepEqual(other.sizes.map((s) => s.toFixed(6)), first.sizes.map((s) => s.toFixed(6)));
  other.display.dispose();

  scene.dispose(); engine.dispose();
});

test("harvesting is a scale, so a clip can ease it without rebuilding anything", () => {
  const { scene, node, engine } = stage();
  const model = catalog.models["crop_strawberry_ripe"]!;
  const fruit = createCropFruit({ scene, model, node, catalog, fruit: "item_strawberry", seed: "bed_1" });
  fruit.show(5);
  const of = () => scene.meshes.filter((m) => m.name.includes(".fruit_")).map((m) => m.scaling.x);
  const full = of();

  fruit.setOpen(0);
  assert.ok(of().every((s) => s < 1e-3), "picked clean should leave nothing visible");
  assert.equal(fruit.shown, 5, "the instances stay put; only their scale moved");

  fruit.setOpen(0.5);
  for (const [i, s] of of().entries()) assert.ok(Math.abs(s - full[i]! * 0.5) < 1e-6, "half-grown is half of each fruit's OWN size");

  fruit.setOpen(1);
  assert.deepEqual(of().map((s) => s.toFixed(6)), full.map((s) => s.toFixed(6)), "regrown to exactly what it was");

  fruit.dispose(); scene.dispose(); engine.dispose();
});

test("a plant with no fruit sockets is harmless, not a crash", () => {
  const { scene, node, engine } = stage();
  const model = catalog.models["crop_strawberry_seedling"]!;
  const fruit = createCropFruit({ scene, model, node, catalog, fruit: "item_strawberry" });
  assert.equal(fruit.capacity, 0);
  fruit.show(4);
  assert.equal(fruit.shown, 0);
  fruit.dispose(); scene.dispose(); engine.dispose();
});

test("nothing hangs plumb, and the lean is stable across reloads", () => {
  // A row of dead-upright clones reads as a texture rather than as objects.
  const { scene, node, engine } = stage();
  const model = catalog.models["crop_pepper_ripe_red"]!;
  const make = () => {
    const d = createCropFruit({ scene, model, node, catalog, fruit: "item_pepper_red", seed: "plot_a" });
    d.show(10);
    const rots = scene.meshes.filter((m) => m.name.includes(".fruit_")).map((m) => [m.rotation.x, m.rotation.y, m.rotation.z] as const);
    return { d, rots };
  };
  const first = make();
  assert.equal(first.rots.length, 10);
  for (const [x, , z] of first.rots) {
    assert.ok(Math.abs(x) > 1e-6 || Math.abs(z) > 1e-6, "a fruit hanging perfectly plumb");
    assert.ok(Math.abs(x) < 0.35 && Math.abs(z) < 0.35, "leaning far enough to look broken");
  }
  assert.ok(new Set(first.rots.map((r) => r[1].toFixed(4))).size >= 9, "every fruit turned the same way");
  first.d.dispose();

  const again = make();
  assert.deepEqual(again.rots.map((r) => r.map((v) => v.toFixed(6))), first.rots.map((r) => r.map((v) => v.toFixed(6))));
  again.d.dispose();
  scene.dispose(); engine.dispose();
});
