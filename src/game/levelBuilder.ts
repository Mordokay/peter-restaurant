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
import { reliefFloor, sampleSurface, type SurfaceMaterial } from "./surfaces.ts";
import { surfaceById } from "./surfaceLibrary.ts";
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
/** The coarsest a material may be laid across a whole room or field. Finer than this only happens inside
 *  the detail ring, where the camera can actually see the difference. */
const CARPET_PITCH = 0.05;
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

/** A floor built from a material rather than a pattern rule: one column of cells per sample, running from
 *  the deepest the material cuts to however high that spot stands. The material is asked about WORLD
 *  metres, so coursing runs unbroken from one room into the next and two rooms sharing a floor share its
 *  grain — which the old local-rect sampling could never do. */
export function surfaceFloorCells(
  material: SurfaceMaterial, originX: number, originZ: number, width: number, depth: number,
  options: { pitch?: number; relief?: boolean } = {},
): { cells: VoxelCell[]; nx: number; nz: number; pitch: number; low: number; top: Map<string, number> } {
  const pitch = options.pitch ?? material.pitch ?? 0.05;
  const withRelief = options.relief ?? true;
  const nx = Math.max(1, Math.round(width / pitch));
  const nz = Math.max(1, Math.round(depth / pitch));
  const low = withRelief ? Math.floor(reliefFloor(material) / pitch) : 0;
  const cells: VoxelCell[] = [];
  const top = new Map<string, number>();
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const sample = sampleSurface(material, originX + (ix + 0.5) * pitch, originZ + (iz + 0.5) * pitch);
      const high = withRelief ? Math.round(sample.relief / pitch) : 0;
      top.set(`${ix},${iz}`, high);
      for (let y = low; y <= high; y++) cells.push({ x: ix, y, z: iz, color: sample.color });
    }
  }
  return { cells, nx, nz, pitch, low, top };
}

/** A wall built from a material. Relief cuts INTO both faces for a joint and stands proud of both for a
 *  block, so a rubble wall has real mortar grooves on either side; the core is never breached. */
export function surfaceWallCells(
  material: SurfaceMaterial, length: number, height: number, thickness: number,
  openings: readonly Opening[] = [], options: { pitch?: number; relief?: boolean } = {},
): { cells: VoxelCell[]; thicknessCells: number; pitch: number; solid: (x: number, y: number, z: number) => boolean } {
  const pitch = options.pitch ?? material.pitch ?? 0.05;
  const withRelief = options.relief ?? true;
  const nu = Math.max(1, Math.round(length / pitch));
  const nv = Math.max(1, Math.round(height / pitch));
  const nw = Math.max(1, Math.round(thickness / pitch));
  // A wall is a SHELL. Nobody has ever seen the middle of one, and extruding it whole was costing 18,447
  // cells a square metre — 8 million for the compound's walls, two thirds of the entire level. Only the
  // cells within `SHELL` of either face are built; the core is reported solid so no inner faces appear.
  const SHELL = 2;
  const cells: VoxelCell[] = [];
  const faces = new Map<string, number>();
  for (let iu = 0; iu < nu; iu++) {
    const along = (iu + 0.5) * pitch;
    for (let iv = 0; iv < nv; iv++) {
      const up = (iv + 0.5) * pitch;
      if (inOpening(openings, along, up)) continue;
      const sample = sampleSurface(material, along, up);
      // Keep at least one cell of core, or a deep joint would cut a slot clean through the wall.
      const step = withRelief ? Math.max(-Math.floor((nw - 1) / 2), Math.round(sample.relief / pitch)) : 0;
      faces.set(`${iu},${iv}`, step);
      const from = -step, to = nw + step - 1;
      for (let iw = from; iw <= to; iw++) {
        if (iw >= from + SHELL && iw <= to - SHELL) continue;   // the hidden core
        cells.push({ x: iu, y: iv, z: iw, color: sample.color });
      }
    }
  }
  const solid = (x: number, y: number, z: number): boolean => {
    const step = faces.get(`${x},${y}`);
    if (step === undefined) return false;
    return z >= -step && z <= nw + step - 1;
  };
  return { cells, thicknessCells: nw, pitch, solid };
}

export function createLevelBuilder(scene: Scene, layout: LevelLayout, options: { shadows?: ShadowGenerator; name?: string; material?: StandardMaterial } = {}): BuiltLevel {
  const name = options.name ?? "level";
  const root = new TransformNode(`${name} root`, scene);
  const voxelMaterial = options.material ?? createVoxelMaterial(`${name} material`, scene);
  const floors = new Map<string, Mesh>();
  const walls = new Map<string, BuiltWall>();
  /** Cells per piece, so the total survives a rebuild that only touches some of them. */
  const cellCounts = new Map<string, number>();
  /** What each built piece was built FROM. A piece whose signature still matches is left alone. */
  const signatures = new Map<string, string>();
  let buildMs = 0;

  const tagSurface = (mesh: Mesh, extra: Record<string, unknown>): void => {
    mesh.metadata = { ...((mesh.metadata as Record<string, unknown> | null) ?? {}), surface: true, ...extra };
  };

  const buildFloor = (item: Room | Area, floorTypeId: string, topY: number, covers: readonly Rect[] = []): void => {
    const type = floorTypeOf(layout, floorTypeId);
    const [x, z, width, depth] = item.rect;
    // A material, if this type names one; otherwise the old pattern rule. Big outdoor grounds stay coarse
    // whatever they are made of — a 4,352 m² lawn at 2.5 cm cells is seven million of them.
    const huge = width * depth > 900;
    const material = huge ? undefined : surfaceById(type.surface ?? "");
    // The CARPET is coarse and flat. A material's own pitch is what the near-camera ring will mesh it at;
    // laying 1,600 m² of 2.5 cm cells with relief measured 11.7 million cells and a 19.5 second build,
    // against 138 draw calls and 120 fps — the runtime was never the problem, the mesher was.
    const pitch = material ? Math.max(material.pitch ?? 0.05, CARPET_PITCH) : huge ? 0.5 : FLOOR_PITCH;
    // Cell (0,0) starts here in the world; the material is asked about world metres from this corner.
    const originX = x + (width - Math.max(1, Math.round(width / pitch)) * pitch) / 2;
    const originZ = z + (depth - Math.max(1, Math.round(depth / pitch)) * pitch) / 2;
    const built = material
      ? surfaceFloorCells(material, originX, originZ, width, depth, { pitch, relief: false })
      : { ...floorCells(width, depth, pitch, type.patternScale, type.color, type.accentColor, type.pattern), low: 0, top: null };
    const { cells, nx, nz } = built;
    const low = built.low;
    const relief = built.top;
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
    const inSlab = (cx: number, cz: number): boolean =>
      present ? present.has(`${cx},${cz}`) : cx >= 0 && cx < nx && cz >= 0 && cz < nz;
    const mesh = createVoxelMesh(`${name} floor ${item.id}`, kept, pitch, scene, {
      material: voxelMaterial,
      // Everything below the slab counts as solid, so the underside — exactly half of a flat floor's
      // faces, 2,923 of 6,038 quads on one farm plot — is never built. Nobody has ever seen it.
      solid: (cx, cy, cz) => {
        if (cy < low) return true;
        if (!inSlab(cx, cz)) return false;
        if (!relief) return cy === 0;
        const high = relief.get(`${cx},${cz}`);
        return high !== undefined && cy <= high;
      },
    });
    // Cell (0,0,0) sits at the mesh origin, so line its corner up with the rect and drop the top to topY.
    mesh.position.set(x + pitch / 2 + (width - nx * pitch) / 2, topY - pitch / 2, z + pitch / 2 + (depth - nz * pitch) / 2);
    mesh.parent = root;
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    tagSurface(mesh, { levelFloor: item.id });
    floors.set(item.id, mesh);
    cellCounts.set(`floor:${item.id}`, kept.length);
  };

  const buildWall = (wall: Wall): void => {
    const type = wallTypeOf(layout, wall.type);
    const room = wall.room ? layout.rooms.find((candidate) => candidate.id === wall.room) : undefined;
    const height = wall.height ?? room?.wallHeight ?? type.height;
    const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const material = surfaceById(type.surface ?? "");
    const built = material
      ? surfaceWallCells(material, length, height, type.thickness, wall.openings ?? [], { pitch: Math.max(material.pitch ?? 0.05, CARPET_PITCH), relief: true })
      : { ...wallCells(length, height, type.thickness, type, type.pattern, wall.openings ?? []), pitch: WALL_PITCH, solid: undefined };
    const { cells, thicknessCells, pitch } = built;
    if (!cells.length) return;
    const mesh = createVoxelMesh(`${name} wall ${wall.id}`, cells, pitch, scene, { material: voxelMaterial, solid: built.solid });
    const [dx, dz] = wallDirection(wall);
    const normal = wallNormal(wall, layout);
    // Rotate so local +x runs along the wall, then centre the thickness on the wall line.
    mesh.rotation.y = Math.atan2(-dz, dx);
    const across = (thicknessCells - 1) * pitch / 2;
    const leftNormal: Point2 = [-dz, dx];
    mesh.position.set(
      wall.from[0] + dx * (pitch / 2) - leftNormal[0] * across,
      ROOM_FLOOR_Y + pitch / 2,
      wall.from[1] + dz * (pitch / 2) - leftNormal[1] * across,
    );
    mesh.parent = root;
    mesh.receiveShadows = true;
    options.shadows?.addShadowCaster(mesh);
    tagSurface(mesh, { levelWall: wall.id, wall: true });
    walls.set(wall.id, { wall, mesh, normal, height });
    cellCounts.set(`wall:${wall.id}`, cells.length);
  };

  const dropFloor = (id: string): void => {
    floors.get(id)?.dispose(false, false);
    floors.delete(id);
    cellCounts.delete(`floor:${id}`);
    signatures.delete(`floor:${id}`);
  };
  const dropWall = (id: string): void => {
    const built = walls.get(id);
    if (built) { options.shadows?.removeShadowCaster(built.mesh); built.mesh.dispose(false, false); }
    walls.delete(id);
    cellCounts.delete(`wall:${id}`);
    signatures.delete(`wall:${id}`);
  };
  const clear = (): void => {
    for (const id of [...floors.keys()]) dropFloor(id);
    for (const id of [...walls.keys()]) dropWall(id);
  };

  /** Everything a piece's geometry depends on. Equal signature, identical mesh — so leave it standing. */
  const rectsOverlap = (a: Rect, b: Rect): boolean =>
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const floorSignature = (item: Room | Area, floorTypeId: string, topY: number, covers: readonly Rect[]): string => {
    const type = floorTypeOf(layout, floorTypeId);
    return JSON.stringify([item.rect, type.color, type.accentColor, type.pattern, type.patternScale, type.surface, topY, covers]);
  };
  const wallSignature = (wall: Wall): string => {
    const type = wallTypeOf(layout, wall.type);
    const room = wall.room ? layout.rooms.find((candidate) => candidate.id === wall.room) : undefined;
    return JSON.stringify([wall.from, wall.to, type.color, type.topColor, type.baseColor, type.pattern, type.surface, type.thickness,
      wall.height ?? room?.wallHeight ?? type.height, wall.openings ?? []]);
  };

  const setProgress = (progress: LevelProgress): void => {
    const started = performance.now();
    const owned = new Set([...progress.parcels, ...progress.rooms, ...progress.walls, ...progress.areas]);
    // Floors stack rather than tile: the grounds lie under the yards and the yards under the rooms.
    // Each slab is told which owned slabs sit above it so it can skip the cells they hide — only the
    // ones that actually overlap it, or painting a far room would invalidate every floor on the site.
    const slabs = [
      ...layout.areas.filter((area) => owned.has(area.id)).map((area) => ({ rect: area.rect, topY: area.id === "site_grounds" ? GROUND_Y : OUTDOOR_FLOOR_Y })),
      ...layout.rooms.filter((room) => owned.has(room.id)).map((room) => ({ rect: room.rect, topY: ROOM_FLOOR_Y })),
    ];
    const above = (topY: number, rect: Rect): Rect[] =>
      slabs.filter((slab) => slab.topY > topY + 1e-6 && rectsOverlap(slab.rect, rect)).map((slab) => slab.rect);

    // What the level should be made of, and what each piece would be built from.
    type WantedFloor = { item: Room | Area; floorType: string; topY: number; covers: Rect[]; signature: string };
    const wantedFloors = new Map<string, WantedFloor>();
    const wantFloor = (item: Room | Area, floorType: string, topY: number): void => {
      const covers = above(topY, item.rect);
      wantedFloors.set(item.id, { item, floorType, topY, covers, signature: floorSignature(item, floorType, topY, covers) });
    };
    for (const area of layout.areas) if (owned.has(area.id)) wantFloor(area, area.ground, area.id === "site_grounds" ? GROUND_Y : OUTDOOR_FLOOR_Y);
    for (const room of layout.rooms) if (owned.has(room.id)) wantFloor(room, room.floor, ROOM_FLOOR_Y);
    const wantedWalls = new Map<string, { wall: Wall; signature: string }>();
    for (const wall of layout.walls) {
      if (!owned.has(wall.id)) continue;
      // A wall needs at least one of its rooms to exist, or it fences off nothing.
      if (wall.room && !owned.has(wall.room) && !(wall.back && owned.has(wall.back))) continue;
      wantedWalls.set(wall.id, { wall, signature: wallSignature(wall) });
    }

    // Take down only what left or changed. Painting one floor used to re-mesh all 87 pieces.
    for (const id of [...floors.keys()]) if (signatures.get(`floor:${id}`) !== wantedFloors.get(id)?.signature) dropFloor(id);
    for (const id of [...walls.keys()]) if (signatures.get(`wall:${id}`) !== wantedWalls.get(id)?.signature) dropWall(id);
    for (const [id, want] of wantedFloors) {
      if (floors.has(id)) continue;
      buildFloor(want.item, want.floorType, want.topY, want.covers);
      signatures.set(`floor:${id}`, want.signature);
    }
    for (const [id, want] of wantedWalls) {
      if (walls.has(id)) continue;
      buildWall(want.wall);
      signatures.set(`wall:${id}`, want.signature);
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
      let cells = 0;
      for (const count of cellCounts.values()) cells += count;
      return { floors: floors.size, walls: walls.size, cells, triangles, buildMs };
    },
    dispose() { clear(); root.dispose(false, false); },
  };
}

/** World position at the centre of a rect, on its floor. */
export function centreOf(rect: readonly [number, number, number, number], y = ROOM_FLOOR_Y): Vector3 {
  return new Vector3(rect[0] + rect[2] / 2, y, rect[1] + rect[3] / 2);
}
