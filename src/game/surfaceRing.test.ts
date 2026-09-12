import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene } from "@babylonjs/core";
import { createSurfaceCrustLayer, type RingSurface } from "./surfaceRing.ts";
import { createVoxelMaterial } from "./voxelGeometry.ts";
import { surfaceById } from "./surfaceLibrary.ts";

/** A gravel court with a farm plot and a lawn laid over parts of it. The merged layer carries stones and
 *  chips; blades are GPU instances and have their own tests, so the ground here is gravel. */
const site = (): RingSurface[] => [
  { id: "court", rect: [-30, -30, 60, 60], material: surfaceById("gravel_path")!, topY: 0 },
  { id: "plot", rect: [0, 0, 12, 12], material: surfaceById("soil_tilled")!, topY: 0.02 },
  { id: "lawn", rect: [-20, 0, 8, 8], material: surfaceById("grass_lawn")!, topY: 0.02 },
];

const withLayer = async (body: (layer: ReturnType<typeof createSurfaceCrustLayer>, scene: Scene) => Promise<void> | void,
  surfaces: () => RingSurface[] = site): Promise<void> => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const layer = createSurfaceCrustLayer(scene, { surfaces, material: createVoxelMaterial("m", scene), tile: 18 });
  try { await body(layer, scene); } finally { layer.dispose(); scene.dispose(); engine.dispose(); }
};

test("stones cover the whole site, not a ring around the camera", async () => {
  await withLayer(async (layer, scene) => {
    await layer.build();
    const stats = layer.stats();
    assert.ok(stats.cells > 0, "some stones were laid");
    assert.ok(stats.tiles >= 4, `the site should span several tiles, saw ${stats.tiles}`);
    // Grass exists in far-apart corners at once — the thing a camera-following ring could never do.
    const crust = scene.meshes.filter((mesh) => /^crust/.test(mesh.name));
    const centres = crust.map((mesh) => { mesh.computeWorldMatrix(true); return mesh.getBoundingInfo().boundingBox.centerWorld; });
    const spread = Math.max(...centres.map((c) => c.x)) - Math.min(...centres.map((c) => c.x));
    assert.ok(spread > 30, `crust should be spread across the site, spans ${spread.toFixed(0)} m`);
  });
});

test("it is split into tiles so the frustum can drop what is behind you", async () => {
  await withLayer(async (layer) => {
    await layer.build();
    const stats = layer.stats();
    assert.ok(stats.meshes >= stats.tiles, "at least one mesh per occupied tile");
    assert.ok(stats.meshes < 40, `but not a mesh per patch: ${stats.meshes} would be ${stats.meshes} draw calls`);
  });
});

test("nothing grows up through a floor laid on top of it", async () => {
  let covered = 0;
  await withLayer(async (layer) => { await layer.build(); covered = layer.stats().cells; });
  let bare = 0;
  await withLayer(async (layer) => { await layer.build(); bare = layer.stats().cells; },
    () => [{ id: "court", rect: [-30, -30, 60, 60], material: surfaceById("gravel_path")!, topY: 0 }]);
  assert.ok(covered < bare, `the plot and lawn should suppress stones beneath them: ${covered} against ${bare}`);
});

test("building twice lays exactly the same stones", async () => {
  await withLayer(async (layer) => {
    await layer.build();
    const first = layer.stats().cells;
    await layer.build();
    assert.equal(layer.stats().cells, first, "the crust is a function of the world, so it is stable");
  });
});

test("clearing takes every mesh with it", async () => {
  await withLayer(async (layer, scene) => {
    await layer.build();
    assert.ok(scene.meshes.some((mesh) => /^crust/.test(mesh.name)));
    layer.clear();
    assert.equal(layer.stats().meshes, 0);
    assert.equal(scene.meshes.filter((mesh) => /^crust/.test(mesh.name)).length, 0, "meshes leaked");
  });
});
