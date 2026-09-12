import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { createGrassInstances } from "./grassInstances.ts";
import { crustBlades } from "./surfaceCrust.ts";
import { createVoxelMaterial } from "./voxelGeometry.ts";
import { surfaceById } from "./surfaceLibrary.ts";
import type { RingSurface } from "./surfaceRing.ts";

const site = (): RingSurface[] => [
  { id: "grounds", rect: [-30, -30, 60, 60], material: surfaceById("grass_lawn")!, topY: 0 },
  { id: "plot", rect: [0, 0, 12, 12], material: surfaceById("soil_tilled")!, topY: 0.02 },
];

const withGrass = async (body: (grass: ReturnType<typeof createGrassInstances>, scene: Scene) => Promise<void> | void,
  surfaces: () => RingSurface[] = site): Promise<void> => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const grass = createGrassInstances(scene, { surfaces, material: createVoxelMaterial("m", scene) });
  try { await body(grass, scene); } finally { grass.dispose(); scene.dispose(); engine.dispose(); }
};

test("the whole lawn is blades, and they cost a handful of draw calls", async () => {
  await withGrass(async (grass) => {
    await grass.build();
    const stats = grass.stats();
    // 3,456 m² uncovered at 5 tufts a square metre and 3-9 blades each: tens of thousands of blades.
    assert.ok(stats.blades > 30000, `expected a lawn's worth of blades, got ${stats.blades}`);
    assert.ok(stats.tufts > 5000, `and the tufts they belong to, for the far tier: ${stats.tufts}`);
    assert.ok(stats.blades > stats.tufts * 2, "a tuft is several blades, which is the whole point of the swap");
    grass.update(new Vector3(0, 0, 0));
    assert.ok(stats.blades > 0);
  });
});

test("no blade stands where a higher floor covers the ground", async () => {
  const { blades: onPlot } = crustBlades(surfaceById("grass_lawn")!, 0, 0, 12, 12, new Set(),
    (x, z) => x >= 0 && x <= 12 && z >= 0 && z <= 12);
  assert.equal(onPlot.length, 0, "the plot covers all of it, so nothing grows");
  const { blades: bare } = crustBlades(surfaceById("grass_lawn")!, 0, 0, 12, 12);
  assert.ok(bare.length > 500, `uncovered, the same ground grows plenty: ${bare.length}`);
});

test("a prototype is white with the wind baked up it, so instances supply the tone and keep the sway", async () => {
  await withGrass(async (grass, scene) => {
    await grass.build();
    const prototype = scene.meshes.find((mesh) => /^grass blade/.test(mesh.name))!;
    assert.ok(prototype, "a blade mesh exists");
    const colors = prototype.getVerticesData("color")!;
    let anchored = 0, free = 0;
    for (let i = 0; i < colors.length; i += 4) {
      assert.ok(colors[i]! > 0.99 && colors[i + 1]! > 0.99 && colors[i + 2]! > 0.99, "prototype vertices are white");
      if (colors[i + 3]! > 0.99) anchored++; else if (colors[i + 3]! < 0.01) free++;
    }
    assert.ok(anchored > 0 && free > 0, "the root is anchored and the tip is free");
    const regional = scene.meshes.filter((mesh) => /^grass blade.*\[/.test(mesh.name));
    assert.ok(regional.length > 1, "one mesh per height per region");
    assert.ok(regional.some((mesh) => mesh.thinInstanceCount > 100), "and they are instanced many times over");
    // Each clone's bounding box is sized by its instances, which is what lets the frustum cull a region.
    const wide = regional.filter((mesh) => mesh.getBoundingInfo().boundingBox.extendSizeWorld.x > 1);
    assert.ok(wide.length > 0, "a region's box spans its instances, not one two-centimetre blade");
  });
});

test("a far region is drawn as tufts and a near one as blades", async () => {
  await withGrass(async (grass) => {
    await grass.build();
    // Standing on the lawn: the region underfoot shows blades, the far corners show tufts.
    grass.update(new Vector3(-28, 0, -28));
    const here = grass.stats();
    assert.ok(here.near > 0, "the region you are standing in is blades");
    assert.ok(here.far > 0, "and the far side of the site is tufts");
    // Backing off to the whole-site view puts everything on the cheap tier.
    grass.update(new Vector3(200, 0, 200));
    assert.equal(grass.stats().near, 0, "nothing near, so nothing drawn as blades");
  });
});

test("the far tier is a fraction of the near one, or the swap is not worth its complexity", async () => {
  await withGrass(async (grass, scene) => {
    await grass.build();
    // Compare the two representations of the WHOLE lawn, not whatever happens to be enabled.
    const tier = (pattern: RegExp): number => scene.meshes
      .filter((mesh) => pattern.test(mesh.name) && /\[/.test(mesh.name))
      .reduce((sum, mesh) => sum + (mesh.getTotalIndices() / 3) * mesh.thinInstanceCount, 0);
    const blades = tier(/^grass blade/), tufts = tier(/^grass tuft/);
    assert.ok(blades > 0 && tufts > 0, "both tiers exist");
    assert.ok(tufts * 4 < blades, `tufts ${tufts} against blades ${blades} — only ${(blades / tufts).toFixed(1)}x`);
  });
});

test("no two instanced meshes share a geometry", async () => {
  // Thin-instance buffers live on the GEOMETRY. Sixteen clones of one prototype shared one geometry and
  // overwrote each other's instance buffers: the whole lawn rendered nothing while reporting 47,762
  // blades, correct bounding boxes and forty-eight active meshes. Nothing in the numbers gave it away.
  await withGrass(async (grass, scene) => {
    await grass.build();
    const instanced = scene.meshes.filter((mesh) => mesh.thinInstanceCount > 0);
    assert.ok(instanced.length > 4, "there are several instanced meshes");
    const geometries = new Set(instanced.map((mesh) => mesh.geometry?.uniqueId));
    assert.equal(geometries.size, instanced.length,
      `${instanced.length} instanced meshes but only ${geometries.size} geometries — they will overwrite each other`);
  });
});

test("every blade stands on its own floor", async () => {
  await withGrass(async (grass, scene) => {
    await grass.build();
    // Read the instance matrices back: every translation's y is half a cell above the ground it stands on.
    grass.update(new Vector3(0, 0, 0));
    for (const mesh of scene.meshes) {
      if (!/^grass blade/.test(mesh.name) || !/\[/.test(mesh.name)) continue;
      const matrices = mesh.thinInstanceGetWorldMatrices();
      for (const m of matrices.slice(0, 50)) {
        const y = m.getTranslation().y;
        assert.ok(Math.abs(y - 0.01) < 1e-6 || Math.abs(y - 0.03) < 1e-6, `a blade floats at y=${y}`);
      }
    }
  });
});
