// CPU-only meshing/restoration benchmark. Run: node scripts/benchmark-rig-cache.mjs
import { NullEngine, Scene } from "@babylonjs/core";
import { readCatalog } from "./catalog-io.mjs";
import { createVoxelRig } from "../src/game/voxelRig.ts";
import { clearSourceCache } from "../src/game/sourceCache.ts";

const catalog = readCatalog();
const engine = new NullEngine();
try {
  for (const id of ["savoy_cabbage", "aloe_vera_potted", "freezer_upright"]) {
    await clearSourceCache();
    const scene = new Scene(engine);
    const model = catalog.models[id];
    const measure = (cached) => {
      let hits = 0, misses = 0;
      const start = performance.now();
      const rig = createVoxelRig(model, scene, cached ? { cacheRevision: 1, shareGeometry: true, onCache: (hit) => hit ? hits++ : misses++ } : {});
      const ms = performance.now() - start;
      const vertices = rig.meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
      rig.dispose();
      return { ms, hits, misses, vertices };
    };
    const uncached = measure(false);
    const cold = measure(true);
    const warm = Array.from({ length: 5 }, () => measure(true));
    const sorted = warm.map((row) => row.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ model: id, uncached, cold, warm, warmMedianMs: sorted[2] }));
    scene.dispose();
  }
} finally { engine.dispose(); }
