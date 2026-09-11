// Turns the site plan into geometry: floors, outdoor ground and walls, drawn as voxels so the
// building matches the props standing in it.
//
// Only what the player owns is built (see LevelProgress), so the same plan renders the first plot and
// the finished compound. Floors are one cell layer whose colours carry the pattern — tile seams, plank
// runs, soil clods. Walls are three cells thick with a base course and a top course, because from this
// camera the top of a wall is most of what you see, and openings are real gaps in the cells rather
// than a texture. Every piece is its own mesh so the cutaway can hide one wall without touching the rest.
import { Mesh, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { createVoxelMaterial, createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import {
  floorTypeOf, shade, wallDirection, wallNormal, wallTypeOf,
  type Area, type LevelLayout, type LevelProgress, type Opening, type Point2, type Rect, type Room, type Wall,
} from "./levelLayout.ts";

/** Height of a room floor's top surface, metres. Outdoor ground sits lower so thresholds read. */
export const ROOM_FLOOR_Y = 0.08;
export const OUTDOOR_FLOOR_Y = 0.02;
export const GROUND_Y = 0;
/** Cell size of wall and floor voxels, metres. Pattern features are measured in cells, so a grout line
 *  is one cell wide however big the tiles are. */
const WALL_PITCH = 0.1;
const FLOOR_PITCH = 0.1;

export interface BuiltWall {
  wall: Wall;
  mesh: Mesh;
  /** Outward normal from `wall.room`. */
  normal: Point2;
  height: number;
}

export interface BuiltLevel {
  root: TransformNode;
  /** Room and area floors by id. */
  floors: Map<string, Mesh>;
  walls: Map<string, BuiltWall>;
  /** Rebuild for a different progress (a purchase, or the full build-out toggle). */
  setProgress(progress: LevelProgress): void;
  /** Every mesh, for colliders and picking. */
  meshes(): Mesh[];
  stats(): { floors: number; walls: number; cells: number; triangles: number; buildMs: number };
  dispose(): void;
}

/** Deterministic 0..1 noise so plaster and soil vary without looking random between runs. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x79b9, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Cells of one floor slab: a single layer, coloured by the pattern.
 *  `scale` is the size of one tile or board in metres; the joint between them is always one cell. */
export function floorCells(width: number, depth: number, pitch: number, scale: number, color: string, accent: string, pattern: string): { cells: VoxelCell[]; nx: number; nz: number } {
  const nx = Math.max(1, Math.round(width / pitch));
  const nz = Math.max(1, Math.round(depth / pitch));
  const unit = Math.max(2, Math.round(scale / pitch));
  // The joint carries the pattern; the faces vary by a whisper, or a floor reads as a chessboard.
  const subtle = shade(color, -0.03);
  const lighter = shade(color, 0.03);
  const cells: VoxelCell[] = [];
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      let colour = color;
      switch (pattern) {
        case "tile": {
          // Square tiles with a single-cell grout line, and alternate tiles a shade apart.
          const grout = ix % unit === 0 || iz % unit === 0;
          colour = grout ? accent : (Math.floor(ix / unit) + Math.floor(iz / unit)) % 2 === 0 ? subtle : color;
          break;
        }
        case "plank": {
          // Boards run east–west; their butt joints stagger from board to board.
          const board = Math.floor(iz / unit);
          const joint = iz % unit === 0 || (ix + board * 5) % (unit * 6) === 0;
          colour = joint ? accent : board % 2 === 0 ? subtle : hash2(ix, board) > 0.8 ? lighter : color;
          break;
        }
        case "stone": {
          // Flagstones: courses of unequal length.
          const course = Math.floor(iz / unit);
          colour = iz % unit === 0 || (ix + course * Math.round(unit / 2)) % (unit + 1) === 0 ? accent
            : hash2(Math.floor(ix / unit), course) > 0.7 ? subtle : color;
          break;
        }
        case "soil":
        case "gravel":
        case "grass": {
          const n = hash2(ix, iz);
          colour = n > 0.9 ? accent : n > 0.62 ? subtle : n < 0.14 ? lighter : color;
          break;
        }
        default:
          break;
      }
      cells.push({ x: ix, y: 0, z: iz, color: colour });
    }
  }
  return { cells, nx, nz };
}

/** Is this point inside one of the wall's openings? */
function inOpening(openings: readonly Opening[], along: number, height: number): boolean {
  for (const opening of openings) {
    const half = opening.width / 2;
    if (along < opening.at - half || along > opening.at + half) continue;
    const sill = opening.sill ?? (opening.kind === "window" ? 1 : 0);
    const top = sill + (opening.height ?? (opening.kind === "window" ? 1.2 : 2.1));
    if (height >= sill && height <= top) return true;
  }
  return false;
}

/** Cells of one wall, in its own frame: x along the wall, y up, z across the thickness (centred). */
export function wallCells(length: number, height: number, thickness: number, colors: { color: string; topColor: string; baseColor: string }, pattern: string, openings: readonly Opening[] = [], pitch = WALL_PITCH): { cells: VoxelCell[]; thicknessCells: number } {
  const nu = Math.max(1, Math.round(length / pitch));
  const nv = Math.max(1, Math.round(height / pitch));
  const nw = Math.max(1, Math.round(thickness / pitch));
  const topCourse = Math.max(1, Math.round(0.18 / pitch));
  const baseCourse = Math.max(1, Math.round(0.22 / pitch));
  // Surface detail sits close to the wall colour; the base and top courses carry the contrast.
  const joint = shade(colors.color, -0.05);
  const highlight = shade(colors.color, 0.04);
  const cells: VoxelCell[] = [];
  for (let iu = 0; iu < nu; iu++) {
    const along = (iu + 0.5) * pitch;
    for (let iv = 0; iv < nv; iv++) {
      const up = (iv + 0.5) * pitch;
      if (inOpening(openings, along, up)) continue;
      let colour = colors.color;
      if (iv >= nv - topCourse) colour = colors.topColor;
      else if (iv < baseCourse) colour = colors.baseColor;
      else {
        switch (pattern) {
          case "stone": {
            // Courses of blocks with staggered vertical joints.
            const course = Math.floor(iv / 4);
            if (iv % 4 === 0 || (iu + course * 3) % 7 === 0) colour = joint;
            else if (hash2(iu, course) > 0.82) colour = highlight;
            break;
          }
          case "plank":
            colour = iu % 5 === 0 ? joint : Math.floor(iu / 5) % 2 === 0 ? highlight : colour;
            break;
          case "tile":
            // Big tiles, thin grout, nothing like graph paper.
            if (iu % 5 === 0 || iv % 5 === 0) colour = joint;
            break;
          case "plaster":
            colour = hash2(iu, iv) > 0.93 ? highlight : hash2(iv, iu) > 0.95 ? joint : colour;
            break;
          default:
            break;
        }
      }
      for (let iw = 0; iw < nw; iw++) cells.push({ x: iu, y: iv, z: iw, color: colour });
    }
  }
  return { cells, thicknessCells: nw };
}

export function createLevelBuilder(scene: Scene, layout: LevelLayout, options: { shadows?: ShadowGenerator; name?: string; material?: StandardMaterial } = {}): BuiltLevel {
  const name = options.name ?? "level";
  const root = new TransformNode(`${name} root`, scene);
  const material = options.material ?? createVoxelMaterial(`${name} material`, scene);
  const floors = new Map<string, Mesh>();
  const walls = new Map<string, BuiltWall>();
  let cellCount = 0;
  let buildMs = 0;

  const tagSurface = (mesh: Mesh, extra: Record<string, unknown>): void => {
    mesh.metadata = { ...((mesh.metadata as Record<string, unknown> | null) ?? {}), surface: true, ...extra };
  };

  const buildFloor = (item: Room | Area, floorTypeId: string, topY: number, covers: readonly Rect[] = []): void => {
    const type = floorTypeOf(layout, floorTypeId);
    // Big outdoor grounds do not need centimetre cells; keep their mesh cheap.
    const [x, z, width, depth] = item.rect;
    const pitch = width * depth > 900 ? 0.5 : FLOOR_PITCH;
    const { cells, nx, nz } = floorCells(width, depth, pitch, type.patternScale, type.color, type.accentColor, type.pattern);
    // Where cell (0,0) starts in the world, so a cell can be tested against the slabs above it.
    const originX = x + (width - nx * pitch) / 2;
    const originZ = z + (depth - nz * pitch) / 2;
    // The site grounds run under every room and yard on the compound, and those cells are never seen.
    // Only cells whose WHOLE footprint sits inside a higher slab go, so no gap can open along an edge.
    const buried = (ix: number, iz: number): boolean => {
      const x0 = originX + ix * pitch, z0 = originZ + iz * pitch;
      for (const rect of covers) {
        if (x0 >= rect[0] && x0 + pitch <= rect[0] + rect[2] && z0 >= rect[1] && z0 + pitch <= rect[1] + rect[3]) return true;
      }
      return false;
    };
    const kept = covers.length ? cells.filter((cell) => !buried(cell.x, cell.z)) : cells;
    if (!kept.length) return;
    const present = kept.length === cells.length ? null : new Set(kept.map((cell) => `${cell.x},${cell.z}`));
    const mesh = createVoxelMesh(`${name} floor ${item.id}`, kept, pitch, scene, {
      material,
      // Everything below the slab counts as solid, so the underside — exactly half of a flat floor's
      // faces, 2,923 of 6,038 quads on one farm plot — is never built. Nobody has ever seen it.
      solid: (cx, cy, cz) => cy < 0 || (cy === 0 && (present ? present.has(`${cx},${cz}`) : cx >= 0 && cx < nx && cz >= 0 && cz < nz)),
    });
    // Cell (0,0,0) sits at the mesh origin, so line its corner up with the rect and drop the top to topY.
    mesh.position.set(x + pitch / 2 + (width - nx * pitch) / 2, topY - pitch / 2, z + pitch / 2 + (depth - nz * pitch) / 2);
    mesh.parent = root;
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    tagSurface(mesh, { levelFloor: item.id });
    floors.set(item.id, mesh);
    cellCount += kept.length;
  };

  const buildWall = (wall: Wall): void => {
    const type = wallTypeOf(layout, wall.type);
    const room = wall.room ? layout.rooms.find((candidate) => candidate.id === wall.room) : undefined;
    const height = wall.height ?? room?.wallHeight ?? type.height;
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const { cells, thicknessCells } = wallCells(length, height, type.thickness, type, type.pattern, wall.openings ?? []);
    if (!cells.length) return;
    const mesh = createVoxelMesh(`${name} wall ${wall.id}`, cells, WALL_PITCH, scene, { material });
    const [dx, dz] = wallDirection(wall);
    const normal = wallNormal(wall, layout);
    // Rotate so local +x runs along the wall, then centre the thickness on the wall line.
    mesh.rotation.y = Math.atan2(-dz, dx);
    const across = (thicknessCells - 1) * WALL_PITCH / 2;
    const leftNormal: Point2 = [-dz, dx];
    mesh.position.set(
      wall.from[0] + dx * (WALL_PITCH / 2) - leftNormal[0] * across,
      ROOM_FLOOR_Y + WALL_PITCH / 2,
      wall.from[1] + dz * (WALL_PITCH / 2) - leftNormal[1] * across,
    );
    mesh.parent = root;
    mesh.receiveShadows = true;
    options.shadows?.addShadowCaster(mesh);
    tagSurface(mesh, { levelWall: wall.id, wall: true });
    walls.set(wall.id, { wall, mesh, normal, height });
    cellCount += cells.length;
  };

  const clear = (): void => {
    for (const mesh of floors.values()) mesh.dispose(false, false);
    for (const built of walls.values()) { options.shadows?.removeShadowCaster(built.mesh); built.mesh.dispose(false, false); }
    floors.clear();
    walls.clear();
    cellCount = 0;
  };

  const setProgress = (progress: LevelProgress): void => {
    const started = performance.now();
    clear();
    const owned = new Set([...progress.parcels, ...progress.rooms, ...progress.walls, ...progress.areas]);
    // Floors stack rather than tile: the grounds lie under the yards and the yards under the rooms.
    // Each slab is told which owned slabs sit above it so it can skip the cells they hide.
    const slabs = [
      ...layout.areas.filter((area) => owned.has(area.id)).map((area) => ({ rect: area.rect, topY: area.id === "site_grounds" ? GROUND_Y : OUTDOOR_FLOOR_Y })),
      ...layout.rooms.filter((room) => owned.has(room.id)).map((room) => ({ rect: room.rect, topY: ROOM_FLOOR_Y })),
    ];
    const above = (topY: number): Rect[] => slabs.filter((slab) => slab.topY > topY + 1e-6).map((slab) => slab.rect);
    for (const area of layout.areas) {
      if (!owned.has(area.id)) continue;
      const topY = area.id === "site_grounds" ? GROUND_Y : OUTDOOR_FLOOR_Y;
      buildFloor(area, area.ground, topY, above(topY));
    }
    for (const room of layout.rooms) if (owned.has(room.id)) buildFloor(room, room.floor, ROOM_FLOOR_Y, above(ROOM_FLOOR_Y));
    for (const wall of layout.walls) {
      if (!owned.has(wall.id)) continue;
      // A wall needs at least one of its rooms to exist, or it fences off nothing.
      if (wall.room && !owned.has(wall.room) && !(wall.back && owned.has(wall.back))) continue;
      buildWall(wall);
    }
    buildMs = performance.now() - started;
  };

  return {
    root,
    floors,
    walls,
    setProgress,
    meshes() { return [...floors.values(), ...[...walls.values()].map((built) => built.mesh)]; },
    stats() {
      let triangles = 0;
      for (const mesh of floors.values()) triangles += mesh.getTotalIndices() / 3;
      for (const built of walls.values()) triangles += built.mesh.getTotalIndices() / 3;
      return { floors: floors.size, walls: walls.size, cells: cellCount, triangles, buildMs };
    },
    dispose() { clear(); root.dispose(false, false); },
  };
}

/** World position at the centre of a rect, on its floor. */
export function centreOf(rect: readonly [number, number, number, number], y = ROOM_FLOOR_Y): Vector3 {
  return new Vector3(rect[0] + rect[2] / 2, y, rect[1] + rect[3] / 2);
}
