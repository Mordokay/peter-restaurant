import test from "node:test";
import assert from "node:assert/strict";
import { surfaceById, surfaceLibrary } from "./surfaceLibrary.ts";
import { reliefFloor, sampleSurface } from "./surfaces.ts";
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
