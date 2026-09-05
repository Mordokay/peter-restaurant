import test from "node:test";
import assert from "node:assert/strict";
import { clockwiseQuadIndices, createTomatoCells, mergedVoxelQuads, visibleVoxelFaceCount, type VoxelCell } from "./voxelGeometry.ts";

test("voxel faces use Babylon's clockwise front-face winding", () => {
  assert.deepEqual(clockwiseQuadIndices(12), [12, 14, 13, 12, 15, 14]);
});

test("the tomato is a detailed lobed block sculpture rather than a red cube", () => {
  const cells = createTomatoCells();
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const colors = new Set(cells.map((cell) => cell.color));
  assert.ok(Math.max(...xs) - Math.min(...xs) + 1 >= 18);
  assert.ok(Math.max(...ys) >= 10);
  assert.ok(cells.length > 1_500);
  assert.ok(colors.size >= 5);
  assert.ok(visibleVoxelFaceCount(cells) < cells.length * 6);
});

test("greedy meshing merges coplanar same-color faces into single quads", () => {
  // A solid 2x2x2 block of one color exposes 24 cell faces but needs only 6 quads.
  const block: VoxelCell[] = [];
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) block.push({ x, y, z, color: "#ff0000" });
  assert.equal(visibleVoxelFaceCount(block), 24);
  const quads = mergedVoxelQuads(block);
  assert.equal(quads.length, 6);
  for (const quad of quads) {
    assert.equal(quad.u1 - quad.u0 + 1, 2);
    assert.equal(quad.v1 - quad.v0 + 1, 2);
  }
  // A different color on one cell splits only the faces that touch it.
  const twoTone = block.map((cell) => (cell.x === 1 && cell.y === 1 && cell.z === 1 ? { ...cell, color: "#00ff00" } : cell));
  const mixed = mergedVoxelQuads(twoTone);
  assert.ok(mixed.length > 6 && mixed.length < 24, `got ${mixed.length} quads`);
  const coveredArea = mixed.reduce((sum, quad) => sum + (quad.u1 - quad.u0 + 1) * (quad.v1 - quad.v0 + 1), 0);
  assert.equal(coveredArea, 24, "merged quads cover exactly the exposed faces");
  // The detailed tomato shrinks a lot without losing any exposed area.
  const tomato = createTomatoCells();
  const tomatoQuads = mergedVoxelQuads(tomato);
  const tomatoArea = tomatoQuads.reduce((sum, quad) => sum + (quad.u1 - quad.u0 + 1) * (quad.v1 - quad.v0 + 1), 0);
  assert.equal(tomatoArea, visibleVoxelFaceCount(tomato));
  assert.ok(tomatoQuads.length < visibleVoxelFaceCount(tomato) * 0.7);
});
