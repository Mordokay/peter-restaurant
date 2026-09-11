import test from "node:test";
import assert from "node:assert/strict";
import { hash2, latticeAt, reliefCeiling, reliefFloor, sampleSurface, type SurfaceMaterial } from "./surfaces.ts";

const tile: SurfaceMaterial = {
  id: "tile", name: "Tile",
  tones: ["#ded5c0", "#d8cfba", "#e2d9c4"],
  lattice: { kind: "grid", size: 0.3 },
  joint: { color: "#b9ad92", width: 0.02, depth: 0.01 },
  relief: { height: 0.01 },
};

const plank: SurfaceMaterial = {
  id: "plank", name: "Plank",
  tones: ["#a8764a", "#a06f45", "#b07c4e"],
  lattice: { kind: "rows", width: 0.12, length: 1.8, stagger: 0.37, along: "u" },
  joint: { color: "#6d4a2c", width: 0.012, depth: 0.012 },
};

test("the same world point always answers the same, on any run", () => {
  for (const [u, v] of [[0, 0], [3.7, -2.15], [-19.02, 41.9]] as const) {
    assert.deepEqual(sampleSurface(tile, u, v), sampleSurface(tile, u, v));
  }
  assert.equal(hash2(3, 7, 1), hash2(3, 7, 1));
  assert.notEqual(hash2(3, 7, 1), hash2(3, 7, 2), "a different salt is a different scatter");
  for (let i = 0; i < 400; i++) {
    const h = hash2(i, i * 7, 3);
    assert.ok(h >= 0 && h < 1, `hash out of range: ${h}`);
  }
});

test("a material is continuous across any boundary you care to draw", () => {
  // Two rooms meeting at x = 4.2: sampled from their own corners, they must agree cell for cell.
  const pitch = 0.05;
  for (let i = 0; i < 60; i++) {
    const u = 4.2 - 1.5 + i * pitch, v = -3.3 + i * pitch;
    const fromLeft = sampleSurface(plank, u, v);
    const fromRight = sampleSurface(plank, u, v);
    assert.deepEqual(fromLeft, fromRight);
  }
  // And there is no repeat to find a seam in: two points a whole number of features apart differ,
  // because the tone is drawn from the feature's address, not from its offset inside a tile.
  const a = sampleSurface(tile, 0.15, 0.15);
  const shifted = Array.from({ length: 40 }, (_, i) => sampleSurface(tile, 0.15 + (i + 1) * 0.3, 0.15).color);
  assert.ok(new Set(shifted).size > 1, "forty tiles in a row are not all the same colour");
  assert.ok(shifted.some((color) => color !== a.color), "and they are not all the first one either");
});

test("a feature is one colour, which is what keeps the mesher's merging alive", () => {
  // Walk the inside of a single tile at 1 cm and count the colours. One, plus nothing else.
  const inside = new Set<string>();
  for (let u = 0.33; u < 0.57; u += 0.01) {
    for (let v = 0.33; v < 0.57; v += 0.01) inside.add(sampleSurface(tile, u, v).color);
  }
  assert.equal(inside.size, 1, `a tile should be one colour, got ${[...inside].join(", ")}`);
  // Neighbouring tiles are drawn from their own addresses, so the floor is not one flat colour either.
  const across = new Set(Array.from({ length: 30 }, (_, i) => sampleSurface(tile, 0.45 + i * 0.3, 0.45).color));
  assert.ok(across.size > 1, "but the tiles differ from one another");
});

test("joints are a thin recessed line, not a third of the floor", () => {
  const pitch = 0.01;
  let joint = 0, total = 0;
  for (let u = 0; u < 1.2; u += pitch) {
    for (let v = 0; v < 1.2; v += pitch) {
      total++;
      if (sampleSurface(tile, u, v).color === "#b9ad92") joint++;
    }
  }
  const share = joint / total;
  // A 2 cm joint on a 30 cm tile: about 13% of the surface, nothing like the old 20% grout.
  assert.ok(share > 0.08 && share < 0.16, `joint share ${(share * 100).toFixed(1)}%`);
  const onJoint = sampleSurface(tile, 0.3, 0.45);
  assert.equal(onJoint.color, "#b9ad92");
  assert.equal(onJoint.relief, -0.01, "and it is cut into the surface");
  assert.equal(sampleSurface(tile, 0.45, 0.45).relief, 0.01, "while the tile stands proud");
  assert.equal(reliefFloor(tile), -0.01);
  assert.equal(reliefCeiling(tile), 0.01);
});

test("rows stagger, so butt joints never line up between courses", () => {
  const hit = (u: number, v: number) => latticeAt(plank.lattice!, u, v);
  // Two boards in the same row are the same row, different columns.
  assert.equal(hit(0.5, 0.05).fv, hit(2.9, 0.05).fv);
  assert.notEqual(hit(0.5, 0.05).fu, hit(2.9, 0.05).fu);
  // The row above is a different row.
  assert.notEqual(hit(0.5, 0.05).fv, hit(0.5, 0.17).fv);
  // Find where a butt joint falls in one row, and check the row above is not jointed there.
  let seams = 0, aligned = 0;
  for (let u = 0; u < 20; u += 0.01) {
    const here = sampleSurface(plank, u, 0.06).color === "#6d4a2c";
    const above = sampleSurface(plank, u, 0.18).color === "#6d4a2c";
    if (here) { seams++; if (above) aligned++; }
  }
  assert.ok(seams > 0, "there are butt joints");
  assert.equal(aligned, 0, "and none of them line up with the course above");
});

test("a ridge crowns toward its middle and falls away at the furrow", () => {
  const soil: SurfaceMaterial = {
    id: "soil", name: "Tilled soil",
    tones: ["#6b4a33"],
    lattice: { kind: "corduroy", pitch: 0.3, along: "u" },
    relief: { crown: 0.04 },
  };
  const crest = sampleSurface(soil, 5, 0.15).relief;
  const trough = sampleSurface(soil, 5, 0.0).relief;
  assert.ok(Math.abs(crest - 0.04) < 1e-9, `crest ${crest}`);
  assert.ok(Math.abs(trough) < 1e-9, `trough ${trough}`);
  assert.ok(sampleSurface(soil, 5, 0.08).relief > trough, "and it climbs on the way up");
  // Furrows run along u, so walking along a ridge never leaves it.
  const along = new Set(Array.from({ length: 50 }, (_, i) => sampleSurface(soil, i * 0.37, 0.15).relief));
  assert.equal(along.size, 1, "a ridge holds its height for its whole length");
});

test("scatter clusters, lands where it is told, and stays sparse", () => {
  const stone: SurfaceMaterial = {
    id: "stone", name: "Coursed stone",
    tones: ["#8f8d87"],
    lattice: { kind: "rows", width: 0.25, length: 0.6, stagger: 0.5 },
    joint: { color: "#6f6d68", width: 0.03, depth: 0.02 },
    scatter: [{ color: "#7d8a63", coverage: 0.18, cluster: 0.12, where: "joint", salt: 11 }],
  };
  let moss = 0, mossOnStone = 0, cells = 0;
  for (let u = 0; u < 6; u += 0.01) {
    for (let v = 0; v < 3; v += 0.01) {
      cells++;
      const sample = sampleSurface(stone, u, v);
      if (sample.color !== "#7d8a63") continue;
      moss++;
      // Moss is confined to the joints: it may only appear where the joint's recess is.
      if (sample.relief !== -0.02) mossOnStone++;
    }
  }
  assert.ok(moss > 0, "some moss grew");
  assert.equal(mossOnStone, 0, "and none of it on the face of a block");
  assert.ok(moss / cells < 0.06, `moss covers ${((moss / cells) * 100).toFixed(1)}% of the wall, which is too much`);
});
