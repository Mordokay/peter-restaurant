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
//     few runs: about fourteen quads. Ninety thousand of those is roughly 1.3 million triangles.
//   * A thin-instanced mesh is culled as ONE object, so a single mesh per height meant the whole lawn was
//     drawn every frame whichever way the camera faced — 1.7 million triangles a frame, and the GPU was
//     the floor at ~90 fps. So the instances are bucketed by REGION as well as height: one mesh per
//     (height, region), its bounding box refreshed from its instances, and the frustum drops the two thirds
//     of the lawn that is behind you. More draw calls, far fewer triangles; nothing about the grass changes.
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
  /** Metres across one culling region. Measured on the compound, both at 120 fps on this machine:
   *  22 m — 192 meshes, 309 draw calls, 1.36M triangles a frame (30% culled).
   *  32 m — 144 meshes, 237 draw calls, 1.71M triangles a frame (almost nothing culled: the game camera
   *  sees most of the site at once, so regions that big rarely leave the frustum).
   *  Culling is the only reason regions exist, so 22 m. The lever that cuts BOTH numbers without touching a
   *  blade is per-instance LOD — a two-quad prototype for blades beyond ~15 m, where a blade is two pixels
   *  — and that is the next optimisation, not fewer or shorter blades. */
  region?: number;
}): GrassInstances {
  const regionSize = options.region ?? 22;
  /** The shared geometry per (pitch, height): a white column with sway baked up it. */
  const prototypes = new Map<string, Mesh>();
  /** One instanced mesh per (pitch, height, region); they share the prototype's geometry. */
  const meshes: Mesh[] = [];
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
    // The prototype itself draws nothing; its regional clones carry the instances.
    mesh.setEnabled(false);
    prototypes.set(key, mesh);
    return mesh;
  };

  const clear = (): void => {
    for (const mesh of meshes) mesh.dispose(false, false);
    meshes.length = 0;
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

      // Gather every blade, bucketed by the prototype it will instance AND the region it stands in.
      const buckets = new Map<string, { pitch: number; height: number; region: string; matrices: number[]; colors: number[]; count: number }>();
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
          const region = `${Math.floor((blade.cx * pitch) / regionSize)},${Math.floor((blade.cz * pitch) / regionSize)}`;
          const key = `${pitch}|${blade.height}|${region}`;
          let bucket = buckets.get(key);
          if (!bucket) buckets.set(key, (bucket = { pitch, height: blade.height, region, matrices: [], colors: [], count: 0 }));
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
        const prototype = prototypeFor(bucket.pitch, bucket.height);
        // A clone shares the prototype's geometry; only the instance buffers are its own.
        const mesh = prototype.clone(`${prototype.name} [${bucket.region}]`, options.parent ?? null);
        mesh.setEnabled(true);
        mesh.isPickable = false;
        mesh.thinInstanceSetBuffer("matrix", new Float32Array(bucket.matrices), 16, true);
        mesh.thinInstanceSetBuffer("color", new Float32Array(bucket.colors), 4, true);
        // Size the bounding box by where the instances actually stand, so the frustum can judge it.
        mesh.thinInstanceRefreshBoundingInfo(false);
        meshes.push(mesh);
        bladeCount += bucket.count;
      }
      buildMs = performance.now() - started;
    },
    clear,
    stats: () => ({
      blades: bladeCount,
      prototypes: meshes.length,
      triangles: meshes.reduce((sum, mesh) => sum + (mesh.getTotalIndices() / 3) * mesh.thinInstanceCount, 0),
      buildMs,
    }),
    dispose() { clear(); },
  };
}
