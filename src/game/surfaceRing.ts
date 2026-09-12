// The crust layer: the grass, pebbles and clods that stand up out of the ground.
//
// This was a ring that followed the camera, and that was the wrong shape for the job. Two things gave it
// away. Growing a new patch cost a hitch every few metres of walking, because a rebuild is a hundred-odd
// milliseconds of meshing on the main thread. And grass is GROUND COVER — its absence is what you notice,
// so a lawn with blades near the player and none thirty metres away read as broken rather than as detail.
//
// So it is static now: built once, over everything at once. The compromise that buys it is real — far
// fewer blades. The ring ran at 5 tufts a square metre and 408 triangles; this runs at 2 and 73, a fifth
// of the density for a sixth of the cost. Up close it is a thinner lawn. Everywhere else it is a lawn at
// all, which it was not before.
//
// Two things make that affordable. Crust is skipped where a higher floor covers the ground, so nothing is
// grown under the buildings — about a third of the site. And it is split into large tiles, one mesh each,
// so Babylon's frustum culling drops the ones behind you instead of drawing the whole compound's grass
// every frame.
import { Mesh, Scene, TransformNode, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { crustCells } from "./surfaceCrust.ts";
import type { SurfaceMaterial } from "./surfaces.ts";
import type { Rect } from "./levelLayout.ts";

export interface RingSurface {
  id: string;
  rect: Rect;
  /** Absent while a floor type is still on the old pattern path. Such a floor grows nothing, but it does
   *  COVER the ground beneath it, which is why it is in the list at all. */
  material?: SurfaceMaterial;
  /** Height of the surface the crust stands on. */
  topY: number;
}

export interface SurfaceCrustLayer {
  /** Grow everything. `slice` hands the frame back between tiles so a loading bar can move. */
  build(slice?: () => Promise<void>): Promise<void>;
  /** Throw it away; the next build regrows it (a repaint, a progress change). */
  clear(): void;
  stats(): { tiles: number; cells: number; triangles: number; meshes: number; buildMs: number };
  dispose(): void;
}

export function createSurfaceCrustLayer(scene: Scene, options: {
  /** What is laid where, asked fresh on every build so a repaint is picked up. */
  surfaces: () => RingSurface[];
  /** Crust goes on the wind material: a pebble carries no sway weight, so it stands still. */
  material: StandardMaterial;
  parent?: TransformNode;
  /** Metres across one tile. One mesh per tile per crust pitch, so the frustum can drop them. */
  tile?: number;
}): SurfaceCrustLayer {
  const tileSize = options.tile ?? 18;
  const meshes: Mesh[] = [];
  let cellCount = 0;
  let tiles = 0;
  let buildMs = 0;

  const clear = (): void => {
    for (const mesh of meshes) mesh.dispose(false, false);
    meshes.length = 0;
    cellCount = 0;
    tiles = 0;
  };

  return {
    async build(slice) {
      const started = performance.now();
      clear();
      const all = options.surfaces();
      const laid = all.filter((surface) => surface.material?.crust);
      if (!laid.length) { buildMs = performance.now() - started; return; }
      // Floors stack: the grounds run under every room and plot on the site, and grass must not sprout
      // up through a farm plot laid on top of them.
      const covering = (surface: RingSurface) => (x: number, z: number): boolean =>
        all.some((other) => other.topY > surface.topY + 1e-6
          && x >= other.rect[0] && x <= other.rect[0] + other.rect[2]
          && z >= other.rect[1] && z <= other.rect[1] + other.rect[3]);

      const minX = Math.min(...laid.map((surface) => surface.rect[0]));
      const minZ = Math.min(...laid.map((surface) => surface.rect[1]));
      const maxX = Math.max(...laid.map((surface) => surface.rect[0] + surface.rect[2]));
      const maxZ = Math.max(...laid.map((surface) => surface.rect[1] + surface.rect[3]));
      const columns = new Set<string>();
      for (let tx = Math.floor(minX / tileSize) * tileSize; tx < maxX; tx += tileSize) {
        for (let tz = Math.floor(minZ / tileSize) * tileSize; tz < maxZ; tz += tileSize) {
          const byPitch = new Map<number, VoxelCell[]>();
          for (const surface of laid) {
            const [rx, rz, rw, rd] = surface.rect;
            const ax = Math.max(rx, tx), az = Math.max(rz, tz);
            const aw = Math.min(rx + rw, tx + tileSize) - ax, ad = Math.min(rz + rd, tz + tileSize) - az;
            if (aw <= 0 || ad <= 0) continue;
            // Addressed from the world origin, so two tiles of the same material line up cell for cell,
            // and a tuft straddling their border is grown once by whichever tile reaches it first.
            // Stones and chips only: blades are GPU instances (grassInstances.ts), not merged geometry.
            const grown = crustCells(surface.material!, ax, az, aw, ad, { x: 0, z: 0 }, columns, covering(surface), ["pebble", "chip"]);
            if (!grown.cells.length) continue;
            const lift = Math.round(surface.topY / grown.pitch);
            for (const cell of grown.cells) cell.y += lift;
            const bucket = byPitch.get(grown.pitch);
            if (bucket) bucket.push(...grown.cells); else byPitch.set(grown.pitch, grown.cells);
            cellCount += grown.cells.length;
          }
          for (const [pitch, cells] of byPitch) {
            const mesh = createVoxelMesh(`crust ${tx},${tz}@${pitch}`, cells, pitch, scene, { material: options.material });
            mesh.position.set(pitch / 2, pitch / 2, pitch / 2);
            if (options.parent) mesh.parent = options.parent;
            // Never a shadow caster — a third draw per mesh, and swaying geometry casts a still shadow
            // anyway. Never pickable — the floor beneath is the right answer for a click.
            mesh.receiveShadows = true;
            mesh.isPickable = false;
            meshes.push(mesh);
          }
          if (byPitch.size) tiles++;
          if (slice) await slice();
        }
      }
      buildMs = performance.now() - started;
    },
    clear,
    stats: () => ({ tiles, cells: cellCount, triangles: meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), meshes: meshes.length, buildMs }),
    dispose() { clear(); },
  };
}
