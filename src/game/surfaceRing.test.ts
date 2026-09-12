import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { createSurfaceRing, type RingSurface } from "./surfaceRing.ts";
import { createVoxelMaterial } from "./voxelGeometry.ts";
import { surfaceById } from "./surfaceLibrary.ts";

/** A lawn with a farm plot laid on top of part of it, which is how the compound is actually stacked. */
const site = (): RingSurface[] => [
  { id: "grounds", rect: [-30, -30, 60, 60], material: surfaceById("grass_lawn")!, topY: 0 },
  { id: "plot", rect: [0, 0, 10, 10], material: surfaceById("soil_tilled")!, topY: 0.02 },
  { id: "yard", rect: [-20, 0, 8, 8], material: surfaceById("gravel_path")!, topY: 0.02 },
];

const withRing = (body: (ring: ReturnType<typeof createSurfaceRing>, scene: Scene) => void, radius = 9): void => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const ring = createSurfaceRing(scene, { surfaces: site, material: createVoxelMaterial("m", scene), radius });
  try { body(ring, scene); } finally { ring.dispose(); scene.dispose(); engine.dispose(); }
};

test("the ring grows crust around the camera and nowhere else", () => {
  withRing((ring, scene) => {
    ring.update(new Vector3(-25, 0, -25), 26);
    const stats = ring.stats();
    assert.ok(stats.cells > 0, "some grass grew");
    assert.ok(stats.meshes >= 1 && stats.meshes <= 2, `chunks are the cache unit, meshes the draw unit: ${stats.meshes} meshes`);
    // Everything it built sits inside the ring, give or take a blade's own width.
    for (const mesh of scene.meshes) {
      if (!/^crust/.test(mesh.name)) continue;
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      assert.ok(box.minimumWorld.x > -25 - 10 && box.maximumWorld.x < -25 + 10, "crust stayed in its ring");
    }
  });
});

test("nothing grows up through a floor laid on top of it", () => {
  withRing((ring) => {
    // Stand in the middle of the farm plot: the lawn runs underneath it, and must not sprout through.
    ring.update(new Vector3(5, 0, 5), 26);
    const onPlot = ring.stats().cells;
    ring.invalidate();
    // The same spot with the plot removed grows a great deal more.
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const bare = createSurfaceRing(scene, {
      surfaces: () => [{ id: "grounds", rect: [-30, -30, 60, 60] as const, material: surfaceById("grass_lawn")!, topY: 0 }],
      material: createVoxelMaterial("m", scene), radius: 9,
    });
    bare.update(new Vector3(5, 0, 5), 26);
    const uncovered = bare.stats().cells;
    bare.dispose(); scene.dispose(); engine.dispose();
    assert.ok(onPlot < uncovered * 0.75, `the plot should suppress most of the grass: ${onPlot} against ${uncovered}`);
  });
});

test("the crust is a function of the world, so walking away and back finds it unchanged", () => {
  withRing((ring) => {
    ring.update(new Vector3(-25, 0, -25), 26);
    const first = ring.stats().cells;
    ring.update(new Vector3(-25, 0, -25), 26);
    assert.equal(ring.stats().cells, first, "standing still must not regrow anything");
    ring.update(new Vector3(5, 0, 5), 26);       // walk off
    ring.update(new Vector3(-25, 0, -25), 26);   // and back
    assert.equal(ring.stats().cells, first, "the same ground grows the same grass");
  });
});

test("zoom out far enough and the crust is not there at all", () => {
  withRing((ring) => {
    ring.update(new Vector3(-25, 0, -25), 26);
    assert.ok(ring.stats().cells > 0);
    ring.update(new Vector3(-25, 0, -25), 90);   // the whole-site view
    assert.equal(ring.stats().cells, 0, "nothing to see at ninety metres, and it is the entire compound");
    assert.equal(ring.stats().meshes, 0);
  });
});
