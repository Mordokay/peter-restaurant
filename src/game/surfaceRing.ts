// The detail ring: the grass, pebbles and clods that only exist near the camera.
//
// A crust is expensive in the way scattered things always are — a blade of grass breaks the mesher's
// merging, so a square metre of lawn costs 581 triangles where a square metre of tiled floor costs 18.
// Growing it over the compound's 4,352 m² of ground would be two and a half million triangles for detail
// that is sub-pixel past about twenty metres. So it is grown in a ring around the camera and nowhere else.
//
// The rule that makes it affordable, learned the expensive way elsewhere in this project: **chunks are the
// CACHE unit, meshes are the DRAW unit.** One mesh per chunk would put fifty extra draws on a budget of a
// hundred and twenty — and each of those costs two, because the glow layer redraws every visible mesh. So
// every chunk's cells are concatenated into one mesh per crust pitch, and the whole ring costs two draws.
//
// It is seamless because the crust is a function of world position: a tuft belongs to the world, not to
// the patch that happened to grow it. Walk away and back and the same blade is in the same place, and a
// chunk boundary is invisible because both sides agree on what stands there.
import { Mesh, Scene, TransformNode, Vector3, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { crustCells } from "./surfaceCrust.ts";
import type { SurfaceMaterial } from "./surfaces.ts";
import type { Rect } from "./levelLayout.ts";

export interface RingSurface {
  id: string;
  rect: Rect;
  material: SurfaceMaterial;
  /** Height of the surface the crust stands on. */
  topY: number;
}

export interface SurfaceRing {
  /** Regrow if the camera has moved into a new chunk, or zoomed far enough out that none of it shows. */
  update(centre: Vector3, cameraRadius: number): void;
  /** Throw the current crust away, so the next update rebuilds it (a repaint, a progress change). */
  invalidate(): void;
  stats(): { patches: number; cells: number; triangles: number; meshes: number; buildMs: number };
  dispose(): void;
}

export function createSurfaceRing(scene: Scene, options: {
  /** What is laid where, asked fresh on every rebuild so a repaint is picked up. */
  surfaces: () => RingSurface[];
  /** Crust goes on the wind material: a pebble simply has no sway weight, so it does not move. */
  material: StandardMaterial;
  parent?: TransformNode;
  /** Metres from the camera target that carry crust. */
  radius?: number;
  /** Rebuild granularity: the crust is regrown when the camera crosses one of these. */
  chunk?: number;
  /** Past this camera distance there is no crust at all — it is invisible, and it is the whole site. */
  maxZoom?: number;
}): SurfaceRing {
  const radius = options.radius ?? 9;
  const chunk = options.chunk ?? 6;
  const maxZoom = options.maxZoom ?? 42;
  const meshes: Mesh[] = [];
  let key = "";
  let patches = 0;
  let cellCount = 0;
  let buildMs = 0;

  const clear = (): void => {
    for (const mesh of meshes) mesh.dispose(false, false);
    meshes.length = 0;
    patches = 0;
    cellCount = 0;
  };

  const rebuild = (cx: number, cz: number): void => {
    const started = performance.now();
    clear();
    // The exact ring, not snapped out to whole chunks. Snapping grew a 15 m radius into a 40 m square —
    // nearly three times the area, and 777,000 triangles of grass. It buys nothing either: the crust is a
    // function of world position, so regrowing a slightly different rect still puts every tuft back in
    // exactly the same place. The chunk decides only WHEN to regrow, never how much.
    const x0 = cx - radius, z0 = cz - radius, x1 = cx + radius, z1 = cz + radius;

    // One bucket per crust pitch: cells of different sizes cannot share a mesh.
    const byPitch = new Map<number, VoxelCell[]>();
    const columns = new Set<string>();
    const laid = options.surfaces();
    // Floors stack: the grounds run under every room and plot on the site. Grass must not grow up through
    // a farm plot laid on top of it, so a site is skipped where a higher floor covers that ground.
    const covering = (surface: RingSurface) => (x: number, z: number): boolean =>
      laid.some((other) => other.topY > surface.topY + 1e-6
        && x >= other.rect[0] && x <= other.rect[0] + other.rect[2]
        && z >= other.rect[1] && z <= other.rect[1] + other.rect[3]);
    for (const surface of laid) {
      if (!surface.material.crust) continue;
      const [rx, rz, rw, rd] = surface.rect;
      const ax = Math.max(rx, x0), az = Math.max(rz, z0);
      const aw = Math.min(rx + rw, x1) - ax, ad = Math.min(rz + rd, z1) - az;
      if (aw <= 0 || ad <= 0) continue;
      // Addressed from the world origin so two patches of the same material line up cell for cell.
      const grown = crustCells(surface.material, ax, az, aw, ad, { x: 0, z: 0 }, columns, covering(surface));
      if (!grown.cells.length) continue;
      // Stand them on their own floor: rooms, yards and the grounds all sit at different heights.
      const lift = Math.round(surface.topY / grown.pitch);
      for (const cell of grown.cells) cell.y += lift;
      const bucket = byPitch.get(grown.pitch);
      if (bucket) bucket.push(...grown.cells); else byPitch.set(grown.pitch, grown.cells);
      patches++;
      cellCount += grown.cells.length;
    }

    for (const [pitch, cells] of byPitch) {
      const mesh = createVoxelMesh(`crust ${pitch}`, cells, pitch, scene, { material: options.material });
      mesh.position.set(pitch / 2, pitch / 2, pitch / 2);
      if (options.parent) mesh.parent = options.parent;
      // Never a shadow caster: it is a third draw per mesh, and swaying geometry casts a still shadow
      // anyway because the shadow map renders with its own shader. Never pickable: the floor beneath is
      // the right answer for a click, and it keeps scene.pick cheap.
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      meshes.push(mesh);
    }
    buildMs = performance.now() - started;
  };

  return {
    update(centre, cameraRadius) {
      if (cameraRadius > maxZoom) {
        if (meshes.length) { clear(); key = "far"; }
        return;
      }
      const cx = Math.floor(centre.x / chunk), cz = Math.floor(centre.z / chunk);
      const next = `${cx},${cz}`;
      if (next === key) return;
      key = next;
      rebuild(centre.x, centre.z);
    },
    invalidate() { key = ""; },
    stats: () => ({ patches, cells: cellCount, triangles: meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), meshes: meshes.length, buildMs }),
    dispose() { clear(); },
  };
}
