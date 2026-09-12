// Instanced grass: every blade on the site, as GPU instances of a few prototype columns.
//
// The lawn at full density is about 90,000 blades. Meshed as unique geometry that was two million
// triangles and could only exist in a ring around the player, and the ring's edge was the first thing
// anyone saw. Drawn as instances it is a handful of draw calls: one prototype per blade HEIGHT, meshed
// once, and one 4x4 matrix plus one colour per blade. The GPU does not care how many there are.
//
// This is the demonstration the standalone-versus-browser question was waiting for. The grass was never
// a platform limit; it was the absence of this file.
//
// Two details make it work with what already exists:
//
//   * The prototypes are WHITE, with the wind weight baked into their vertex alpha exactly as the merged
//     crust bakes it. Babylon multiplies instance colour into vertex colour (vertexColorMixing.fx), so each
//     blade takes its tone from its instance and its sway from the prototype, and the wind plugin — which
//     reads `colorUpdated.a` before that mixing happens — bends every instance in place.
//   * A blade is a column of cells whose only variation is the sway step, so the mesher merges it into a
//     few runs: about fourteen quads. Ninety thousand of those is roughly 2.5 million triangles, all drawn
//     every frame because a thin-instanced mesh is culled as one object. That is fine — GPUs are rich in
//     triangles and poor in draw calls, which is the whole reason instancing exists.
import { Matrix, Mesh, Scene, TransformNode, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { crustBlades } from "./surfaceCrust.ts";
import type { RingSurface } from "./surfaceRing.ts";

/** How many steps a blade's wind weight is quantised to. The same number the merged crust uses. */
const SWAY_STEPS = 2;

export interface GrassInstances {
  build(slice?: () => Promise<void>): Promise<void>;
  clear(): void;
  stats(): { blades: number; prototypes: number; triangles: number; buildMs: number };
  dispose(): void;
}

export function createGrassInstances(scene: Scene, options: {
  surfaces: () => RingSurface[];
  material: StandardMaterial;
  parent?: TransformNode;
}): GrassInstances {
  /** One mesh per (pitch, height): a white column with sway baked up it. */
  const prototypes = new Map<string, Mesh>();
  let bladeCount = 0;
  let buildMs = 0;

  const prototypeFor = (pitch: number, height: number): Mesh => {
    const key = `${pitch}|${height}`;
    const found = prototypes.get(key);
    if (found) return found;
    const cells: VoxelCell[] = [];
    for (let y = 0; y < height; y++) {
      const along = height < 2 ? 0 : y / (height - 1);
      cells.push({ x: 0, y, z: 0, color: "#ffffff", sway: Math.round(along * SWAY_STEPS) / SWAY_STEPS });
    }
    const mesh = createVoxelMesh(`grass blade ${height}@${pitch}`, cells, pitch, scene, { material: options.material });
    if (options.parent) mesh.parent = options.parent;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    // Instances stand all over the site; the frustum must never cull the prototype by its own tiny box.
    mesh.alwaysSelectAsActiveMesh = true;
    prototypes.set(key, mesh);
    return mesh;
  };

  const clear = (): void => {
    for (const mesh of prototypes.values()) mesh.dispose(false, false);
    prototypes.clear();
    bladeCount = 0;
  };

  return {
    async build(slice) {
      const started = performance.now();
      clear();
      const all = options.surfaces();
      const grassy = all.filter((surface) => surface.material.crust?.forms.some((form) => form.kind === "tuft"));
      const covering = (surface: RingSurface) => (x: number, z: number): boolean =>
        all.some((other) => other.topY > surface.topY + 1e-6
          && x >= other.rect[0] && x <= other.rect[0] + other.rect[2]
          && z >= other.rect[1] && z <= other.rect[1] + other.rect[3]);

      // Gather every blade, bucketed by the prototype it will instance.
      const buckets = new Map<string, { pitch: number; height: number; matrices: number[]; colors: number[]; count: number }>();
      const columns = new Set<string>();
      const tone = new Map<string, [number, number, number]>();
      const rgb = (hex: string): [number, number, number] => {
        let c = tone.get(hex);
        if (!c) { c = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]; tone.set(hex, c); }
        return c;
      };
      for (const surface of grassy) {
        const [rx, rz, rw, rd] = surface.rect;
        const { blades, pitch } = crustBlades(surface.material, rx, rz, rw, rd, columns, covering(surface));
        for (const blade of blades) {
          const key = `${pitch}|${blade.height}`;
          let bucket = buckets.get(key);
          if (!bucket) buckets.set(key, (bucket = { pitch, height: blade.height, matrices: [], colors: [], count: 0 }));
          // The prototype's first cell is centred on its origin, so its base sits half a cell below it.
          const m = Matrix.Translation(blade.cx * pitch, surface.topY + pitch / 2, blade.cz * pitch);
          bucket.matrices.push(...m.asArray());
          const [r, g, b] = rgb(blade.tone);
          bucket.colors.push(r, g, b, 1);
          bucket.count++;
        }
        if (slice) await slice();
      }

      for (const bucket of buckets.values()) {
        const mesh = prototypeFor(bucket.pitch, bucket.height);
        mesh.thinInstanceSetBuffer("matrix", new Float32Array(bucket.matrices), 16, true);
        mesh.thinInstanceSetBuffer("color", new Float32Array(bucket.colors), 4, true);
        bladeCount += bucket.count;
      }
      buildMs = performance.now() - started;
    },
    clear,
    stats: () => ({
      blades: bladeCount,
      prototypes: prototypes.size,
      triangles: [...prototypes.values()].reduce((sum, mesh) => sum + (mesh.getTotalIndices() / 3) * mesh.thinInstanceCount, 0),
      buildMs,
    }),
    dispose() { clear(); },
  };
}
