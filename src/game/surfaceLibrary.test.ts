import test from "node:test";
import assert from "node:assert/strict";
import { surfaceById, surfaceLibrary } from "./surfaceLibrary.ts";
import { reliefFloor, sampleSurface } from "./surfaces.ts";
import { crustCells, crustSites } from "./surfaceCrust.ts";
import { mergedVoxelQuads } from "./voxelGeometry.ts";
import type { VoxelCell } from "./voxelGeometry.ts";

/** The pitch the carpet is meshed at. Every rule below is stated against it. */
const CARPET = 0.05;

const colorsOf = (material: (typeof surfaceLibrary)[number]): string[] => [
  ...material.tones,
  ...(material.patch?.tones ?? []),
  ...(material.bands ?? []).map((band) => band.color),
  ...(material.scatter ?? []).map((layer) => layer.color),
  ...(material.joint ? [material.joint.color] : []),
];

test("every colour in the library is a real hex colour", () => {
  // Written after `#976displaced` went in as a board tone and rendered as black.
  for (const material of surfaceLibrary) {
    for (const color of colorsOf(material)) {
      assert.match(color, /^#[0-9a-f]{6}$/i, `${material.id} has a malformed colour: ${color}`);
    }
  }
});

test("ids and names are unique, and every material can be found by id", () => {
  const ids = surfaceLibrary.map((material) => material.id);
  assert.equal(new Set(ids).size, ids.length, "two materials share an id");
  const names = surfaceLibrary.map((material) => material.name);
  assert.equal(new Set(names).size, names.length, "two materials share a name");
  for (const id of ids) assert.equal(surfaceById(id)?.id, id);
  assert.equal(surfaceById("no_such_material"), undefined);
});

test("no scatter is fine enough to read as pepper", () => {
  // A blotch smaller than a few cells is per-cell noise by another name: it defeats the mesher's
  // merging and it reads as static, which ART_DIRECTION forbids. Tilled soil cost 196 triangles a
  // square metre with 7 cm clusters and 17 with 28 cm ones, for a better-looking field.
  for (const material of surfaceLibrary) {
    for (const layer of material.scatter ?? []) {
      const cluster = layer.cluster ?? 0.1;
      assert.ok(cluster >= CARPET * 3, `${material.id}: a ${cluster * 100} cm cluster is pepper at ${CARPET * 100} cm cells`);
      assert.ok(layer.coverage <= 0.26, `${material.id}: ${layer.color} covers ${layer.coverage}, busier than the freezer's frost`);
    }
  }
});

test("every material stays inside its triangle budget, measured with the real mesher", () => {
  // The ledger the plan asks for. The old per-cell noise floors cost about 246 triangles a square
  // metre and were 70% of the compound's geometry; nothing here may go near that again.
  const side = 6;
  const budget: Record<string, number> = {
    plank_dining: 40, tile_quarry: 30, gravel_path: 30, soil_tilled: 30, grass_lawn: 15, stone_coursed: 90,
  };
  for (const material of surfaceLibrary) {
    const n = Math.round(side / CARPET);
    const cells: VoxelCell[] = [];
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        cells.push({ x: ix, y: 0, z: iz, color: sampleSurface(material, (ix + 0.5) * CARPET, (iz + 0.5) * CARPET).color });
      }
    }
    const solid = (x: number, y: number, z: number) => y < 0 || (y === 0 && x >= 0 && x < n && z >= 0 && z < n);
    const perSquareMetre = (mergedVoxelQuads(cells, solid).length * 2) / (side * side);
    const allowed = budget[material.id];
    assert.ok(allowed !== undefined, `${material.id} has no triangle budget — add one`);
    assert.ok(perSquareMetre <= allowed, `${material.id}: ${perSquareMetre.toFixed(0)} triangles/m², budget ${allowed}`);
  }
});

test("tilled soil reads as furrows without any geometry at all", () => {
  // The lesson that produced `bands`: relief is sub-cell at every pitch we can afford, so a ploughed
  // field whose ridges are only geometric is a flat brown field.
  const soil = surfaceById("soil_tilled")!;
  assert.ok(soil.bands && soil.bands.length >= 3, "the ridge is shaded, not just raised");
  const across = new Set<string>();
  for (let v = 0; v < 0.34; v += 0.01) across.add(sampleSurface(soil, 3, v).color);
  assert.ok(across.size >= 3, `crossing one ridge should pass through several tones, saw ${across.size}`);
  // Along a ridge the tone holds, so the furrows read as lines rather than as blotches.
  const along = new Set(Array.from({ length: 40 }, (_, i) => sampleSurface(soil, i * 0.31, 0.17).color));
  assert.ok(along.size <= 3, `a ridge should hold its tone along its length, saw ${along.size}`);
});

test("a floor slab is only as deep as the material cuts into it", () => {
  for (const material of surfaceLibrary) {
    const floor = reliefFloor(material);
    assert.ok(floor <= 0, `${material.id} cuts upward?`);
    assert.ok(floor > -0.1, `${material.id} cuts ${floor} m deep, which is a trench`);
  }
});

test("the crust stays inside its budget, and blades stand up", () => {
  // Bounded by the detail radius, but not unbounded within it. Two measurements drove these numbers:
  // 7 cm pebbles on a 1.5 cm crust cost 1,036 triangles a square metre where 3 cm ones cost 129, and
  // blades that lean cell-by-cell cost 1,521 where straight ones cost 294 — and looked worse, because a
  // stepped blade is a staircase of detached cubes rather than a blade.
  const side = 8;
  // Grass is dearer than it looks because the wind weight is part of the merge key: a blade splits
  // into one run per sway step. Three steps cost 924 triangles a square metre, two cost 770, one 566,
  // against 363 for a blade that cannot move at all. Two is the bargain that was struck.
  const budget: Record<string, number> = { gravel_path: 220, grass_lawn: 650 };
  for (const material of surfaceLibrary) {
    if (!material.crust) continue;
    const { cells, pitch } = crustCells(material, 0, 0, side, side);
    assert.ok(cells.length > 0, `${material.id} grew no crust`);
    const perSquareMetre = (mergedVoxelQuads(cells).length * 2) / (side * side);
    assert.ok(perSquareMetre <= budget[material.id]!, `${material.id} crust: ${perSquareMetre.toFixed(0)} triangles/m², budget ${budget[material.id]}`);
    // The crust is meshed finer than the carpet, or a stone is the size of a paving slab.
    assert.ok(pitch <= (material.pitch ?? 0.05), `${material.id}: crust cells should not be coarser than its carpet`);
  }
});

test("no two crust sites are the same, and they stay put", () => {
  const grass = surfaceById("grass_lawn")!;
  const sites = crustSites(grass.crust!, 0, 0, 12, 12);
  assert.ok(sites.length > 60, `a 12 m square should carry plenty of tufts, got ${sites.length}`);
  // Forms vary — nothing is copy-pasted.
  assert.ok(new Set(sites.map((site) => site.form)).size > 1, "every tuft drew the same form");
  assert.ok(new Set(sites.map((site) => site.seed.toFixed(4))).size > sites.length * 0.9, "tufts share seeds");
  // And they are a function of world position: ask again, or ask over a bigger area, and the tufts that
  // fall in the overlap are in exactly the same places. That is what makes the detail ring seamless.
  const wider = crustSites(grass.crust!, -6, -6, 24, 24);
  const inside = wider.filter((site) => site.x >= 0 && site.x < 12 && site.z >= 0 && site.z < 12);
  assert.equal(inside.length, sites.length, "a wider view finds the same tufts in the overlap");
  for (const [index, site] of inside.entries()) {
    assert.ok(Math.abs(site.x - sites[index]!.x) < 1e-9 && Math.abs(site.z - sites[index]!.z) < 1e-9, "a tuft moved");
  }
});

test("a blade is anchored at its root and free at its tip", () => {
  const grass = surfaceById("grass_lawn")!;
  const { cells } = crustCells(grass, 0, 0, 6, 6);
  // Group a column by its x,z: every blade is a straight run, which is what lets the shader bend it.
  const columns = new Map<string, { y: number; sway: number }[]>();
  for (const cell of cells) {
    const key = `${cell.x},${cell.z}`;
    (columns.get(key) ?? columns.set(key, []).get(key)!).push({ y: cell.y, sway: cell.sway ?? 0 });
  }
  let checked = 0;
  for (const column of columns.values()) {
    if (column.length < 3) continue;
    column.sort((a, b) => a.y - b.y);
    assert.equal(column[0]!.sway, 0, "the root of a blade must not move, or the grass walks away");
    assert.equal(column[column.length - 1]!.sway, 1, "and the tip must be free");
    for (let i = 1; i < column.length; i++) {
      assert.ok(column[i]!.sway >= column[i - 1]!.sway, "sway rises monotonically up a blade");
    }
    checked++;
  }
  assert.ok(checked > 20, `expected plenty of blades to check, saw ${checked}`);
});

test("pebbles never move, whatever the wind is doing", () => {
  const gravel = surfaceById("gravel_path")!;
  const { cells } = crustCells(gravel, 0, 0, 6, 6);
  assert.ok(cells.length > 100);
  assert.ok(cells.every((cell) => (cell.sway ?? 0) === 0), "a stone that sways is a stone rolling downhill");
});

test("no relief is too shallow to exist", () => {
  // The mistake this guards: relief is rounded to whole cells, so a 1.2 cm joint on 2.5 cm cells rounds
  // to zero and the groove silently does not happen. Six materials shipped flat that way, on the
  // reasoning that a realistic grout recess is a millimetre or two — which is true, and the wrong target.
  // In a voxel game the right depth is exactly one cell, whatever the cell happens to be.
  for (const material of surfaceLibrary) {
    const pitch = material.pitch ?? 0.05;
    const values: [string, number | undefined][] = [
      ["joint depth", material.joint?.depth],
      ["relief height", material.relief?.height],
      ["crown", material.relief?.crown],
      ["jitter", material.relief?.jitter],
    ];
    for (const [what, value] of values) {
      if (!value) continue;
      assert.ok(value >= pitch * 0.5,
        `${material.id}: a ${(value * 100).toFixed(1)} cm ${what} rounds to nothing at ${pitch * 100} cm cells`);
    }
  }
});

test("the materials that are boards and slabs actually have depth", () => {
  // What the user asked for in as many words: these are boards with fissures between them, so the
  // fissures should be at a different height, and no two boards should sit at exactly the same level.
  for (const id of ["plank_dining", "tile_quarry", "stone_coursed"]) {
    const material = surfaceById(id)!;
    const pitch = material.pitch ?? 0.05;
    assert.ok(material.joint?.depth, `${id} has no recessed joint`);
    assert.ok(material.relief?.jitter, `${id} lays every feature at exactly the same height`);
    // Walking across features finds more than one height, and a joint lower than the faces beside it.
    const heights = new Set<number>();
    for (let u = 0; u < 8; u += 0.02) heights.add(Math.round(sampleSurface(material, u, 1.37).relief / pitch));
    assert.ok(heights.size >= 3, `${id}: crossing a floor should meet several heights, saw ${heights.size}`);
    assert.ok(Math.min(...heights) < 0, `${id}: nothing is cut below the surface`);
  }
});
