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
//     (height, region), its bounding box refreshed from its instances, and the frustum drops what is behind
//     you. More draw calls, far fewer triangles; nothing about the grass changes.
//   * **LOD is per REGION, and it collapses a tuft rather than thinning it.** Past about eighteen metres a
//     clump of six blades is two pixels wide, so a far region is drawn as one squat column per TUFT instead
//     of six thin ones per tuft. That is roughly a fifth of the instances and a tenth of the triangles for
//     a silhouette you cannot tell apart. Nothing is removed and nothing gets shorter — the near lawn is
//     exactly as dense as it ever was.
import { Matrix, Mesh, Scene, TransformNode, Vector3, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { crustBlades, crustTufts } from "./surfaceCrust.ts";
import type { RingSurface } from "./surfaceRing.ts";

/** How many steps a blade's wind weight is quantised to. The same number the merged crust uses. */
const SWAY_STEPS = 2;

export interface GrassInstances {
  build(slice?: () => Promise<void>): Promise<void>;
  /** Swap each region between its blades and its tufts as the camera moves. Cheap: one distance test per
   *  region, and meshes are only toggled when a region actually changes tier. */
  update(camera: Vector3): void;
  clear(): void;
  stats(): { blades: number; tufts: number; near: number; far: number; prototypes: number; triangles: number; buildMs: number };
  dispose(): void;
}

export function createGrassInstances(scene: Scene, options: {
  surfaces: () => RingSurface[];
  material: StandardMaterial;
  parent?: TransformNode;
  /** Metres from the camera past which a region is drawn as tufts rather than blades. */
  lodDistance?: number;
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
  const lodDistance = options.lodDistance ?? 18;
  /** Cells per prototype key — the SHAPE, not a mesh. Every regional mesh is built fresh from these,
   *  because thin-instance buffers live on the GEOMETRY: sixteen clones sharing one geometry overwrote
   *  each other's instance buffers and the entire lawn rendered nothing, while reporting 47,762 blades,
   *  correct bounding boxes and forty-eight active meshes. A blade is 56 vertices; duplicating it per
   *  region costs nothing next to being invisible. */
  const shapes = new Map<string, VoxelCell[]>();
  /** One instanced mesh per (prototype, region), with which tier it belongs to and where it stands. */
  const regions = new Map<string, { centre: Vector3; near: Mesh[]; far: Mesh[]; showingFar: boolean | null }>();
  let bladeCount = 0;
  let tuftCount = 0;
  let buildMs = 0;

  /** A white column `width` cells square and `height` tall. `stepped` bakes the wind weight up it; a far
   *  tuft does not need it, and one uniform value merges the column into six quads instead of fourteen. */
  const shapeFor = (height: number, width: number, stepped: boolean): VoxelCell[] => {
    const key = `${height}|${width}|${stepped ? "s" : "f"}`;
    const found = shapes.get(key);
    if (found) return found;
    const cells: VoxelCell[] = [];
    for (let y = 0; y < height; y++) {
      const along = height < 2 ? 0 : y / (height - 1);
      const sway = stepped ? Math.round(along * SWAY_STEPS) / SWAY_STEPS : (y === 0 ? 0 : 1);
      for (let x = 0; x < width; x++) for (let z = 0; z < width; z++) cells.push({ x, y, z, color: "#ffffff", sway });
    }
    shapes.set(key, cells);
    return cells;
  };

  const clear = (): void => {
    for (const region of regions.values()) for (const mesh of [...region.near, ...region.far]) mesh.dispose(false, false);
    regions.clear();
    shapes.clear();
    bladeCount = 0;
    tuftCount = 0;
  };

  return {
    async build(slice) {
      const started = performance.now();
      clear();
      const all = options.surfaces();
      const grassy = all.filter((surface) => surface.material?.crust?.forms.some((form) => form.kind === "tuft"));
      const covering = (surface: RingSurface) => (x: number, z: number): boolean =>
        all.some((other) => other.topY > surface.topY + 1e-6
          && x >= other.rect[0] && x <= other.rect[0] + other.rect[2]
          && z >= other.rect[1] && z <= other.rect[1] + other.rect[3]);

      // Gather both tiers at once: blades for near regions, one squat column per tuft for far ones.
      type Bucket = { pitch: number; height: number; width: number; stepped: boolean; region: string; matrices: number[]; colors: number[]; count: number };
      const buckets = new Map<string, Bucket>();
      const centres = new Map<string, { x: number; z: number; n: number }>();
      const tone = new Map<string, [number, number, number]>();
      const rgb = (hex: string): [number, number, number] => {
        let c = tone.get(hex);
        if (!c) { c = [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]; tone.set(hex, c); }
        return c;
      };
      const place = (pitch: number, height: number, width: number, stepped: boolean, cx: number, cz: number, topY: number, hex: string): string => {
        const region = `${Math.floor((cx * pitch) / regionSize)},${Math.floor((cz * pitch) / regionSize)}`;
        const key = `${pitch}|${height}|${width}|${stepped}|${region}`;
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = { pitch, height, width, stepped, region, matrices: [], colors: [], count: 0 }));
        // The prototype's first cell is centred on its origin, so its base sits half a cell below it.
        bucket.matrices.push(...Matrix.Translation(cx * pitch, topY + pitch / 2, cz * pitch).asArray());
        const [r, g, b] = rgb(hex);
        bucket.colors.push(r, g, b, 1);
        bucket.count++;
        const centre = centres.get(region) ?? { x: 0, z: 0, n: 0 };
        centre.x += cx * pitch; centre.z += cz * pitch; centre.n++;
        centres.set(region, centre);
        return region;
      };

      for (const surface of grassy) {
        const [rx, rz, rw, rd] = surface.rect;
        const skip = covering(surface);
        const { blades, pitch } = crustBlades(surface.material!, rx, rz, rw, rd, new Set(), skip);
        for (const blade of blades) place(pitch, blade.height, 1, true, blade.cx, blade.cz, surface.topY, blade.tone);
        bladeCount += blades.length;
        const { tufts } = crustTufts(surface.material!, rx, rz, rw, rd, new Set(), skip);
        for (const tuft of tufts) {
          // Quantise the far tier hard. Its whole purpose is to be cheap, and a prototype per exact
          // height and width put 264 meshes on screen — MORE than the blades it replaced, which left the
          // triangles cut by a third and the draw calls untouched. Three heights and one width instead.
          const height = Math.max(3, Math.round(tuft.height / 4) * 4);
          place(pitch, height, 2, false, tuft.cx, tuft.cz, surface.topY, tuft.tone);
        }
        tuftCount += tufts.length;
        if (slice) await slice();
      }

      for (const bucket of buckets.values()) {
        // Built fresh, so this mesh owns its geometry and therefore its instance buffers.
        const cells = shapeFor(bucket.height, bucket.width, bucket.stepped);
        const name = `grass ${bucket.stepped ? "blade" : "tuft"} ${bucket.height}x${bucket.width}@${bucket.pitch} [${bucket.region}]`;
        const mesh = createVoxelMesh(name, cells, bucket.pitch, scene, { material: options.material });
        if (options.parent) mesh.parent = options.parent;
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        mesh.thinInstanceSetBuffer("matrix", new Float32Array(bucket.matrices), 16, true);
        mesh.thinInstanceSetBuffer("color", new Float32Array(bucket.colors), 4, true);
        // Size the bounding box by where the instances actually stand, so the frustum can judge it.
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.setEnabled(false);
        const centre = centres.get(bucket.region)!;
        let region = regions.get(bucket.region);
        if (!region) regions.set(bucket.region, (region = { centre: new Vector3(centre.x / centre.n, 0, centre.z / centre.n), near: [], far: [], showingFar: null }));
        (bucket.stepped ? region.near : region.far).push(mesh);
      }
      buildMs = performance.now() - started;
    },
    update(camera) {
      const cutoff = lodDistance * lodDistance;
      for (const region of regions.values()) {
        const dx = region.centre.x - camera.x, dz = region.centre.z - camera.z;
        const far = dx * dx + dz * dz > cutoff;
        if (region.showingFar === far) continue;
        region.showingFar = far;
        for (const mesh of region.near) mesh.setEnabled(!far);
        for (const mesh of region.far) mesh.setEnabled(far);
      }
    },
    clear,
    stats: () => {
      let near = 0, far = 0, triangles = 0;
      for (const region of regions.values()) {
        for (const mesh of region.near) if (mesh.isEnabled()) { near++; triangles += (mesh.getTotalIndices() / 3) * mesh.thinInstanceCount; }
        for (const mesh of region.far) if (mesh.isEnabled()) { far++; triangles += (mesh.getTotalIndices() / 3) * mesh.thinInstanceCount; }
      }
      return { blades: bladeCount, tufts: tuftCount, near, far, prototypes: shapes.size, triangles, buildMs };
    },
    dispose() { clear(); },
  };
}
