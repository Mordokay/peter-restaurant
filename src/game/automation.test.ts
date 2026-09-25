import test from "node:test";
import assert from "node:assert/strict";
import { advance, cropById, harvest, plant } from "./crops.ts";
import { cellOf, plotId, plotSites, type AreaRect } from "./farm.ts";
import { bareSoil, till, waterSoil } from "./soil.ts";
import { blocksSeeder, covered, describeDevice, jobFor, type Device } from "./automation.ts";

const areas: AreaRect[] = [{ id: "farm_a1", zone: "farm", rect: [-14, -23, 7, 7] }];
const sites = plotSites(areas);
/** A plot with neighbours on all four sides, named the way the world names it. */
const middleCell = cellOf(-11.5, -20.5);
const middle = sites.find((site) => site.id === plotId(middleCell.gx, middleCell.gz))!;

test("a device covers the four beds around it, and not the corners", () => {
  const around = covered(middle, sites);
  assert.equal(around.length, 4);
  assert.deepEqual(around.map((site) => site.id).sort(), [
    plotId(middleCell.gx - 1, middleCell.gz), plotId(middleCell.gx + 1, middleCell.gz),
    plotId(middleCell.gx, middleCell.gz - 1), plotId(middleCell.gx, middleCell.gz + 1),
  ].sort());
  assert.ok(!around.some((site) => site.id === middle.id), "and never itself");

  // A device in the corner of a parcel covers only what is there.
  const corner = sites.find((site) => site.x === Math.min(...sites.map((s) => s.x)) && site.z === Math.min(...sites.map((s) => s.z)))!;
  assert.equal(covered(corner, sites).length, 2);
});

test("a sprinkler waters beds, not paths, and not what is already wet", () => {
  const device: Device = { kind: "sprinkler", plot: middle.id };
  assert.equal(jobFor(device, bareSoil(), null), "none", "unbroken ground is a path");
  assert.equal(jobFor(device, till(bareSoil()), null), "water");
  assert.equal(jobFor(device, waterSoil(till(bareSoil())), null), "none");
  // It waters whether or not something is growing there — that is the point.
  assert.equal(jobFor(device, till(bareSoil()), plant(cropById("carrot")!)), "water");
});

test("a seeder fills gaps and never replaces a standing plant", () => {
  const seeder: Device = { kind: "seeder", plot: middle.id, crop: "carrot" };
  const bed = till(bareSoil());
  assert.equal(jobFor(seeder, bed, null), "sow");
  assert.equal(jobFor(seeder, bareSoil(), null), "none", "it does not sow into unbroken ground");
  assert.equal(jobFor(seeder, bed, plant(cropById("carrot")!)), "none");

  // With nothing to sow, it does nothing rather than guessing.
  assert.equal(jobFor({ kind: "seeder", plot: middle.id }, bed, null), "none");
  assert.equal(jobFor({ kind: "seeder", plot: middle.id, crop: "moonfruit" }, bed, null), "none");
  assert.match(describeDevice({ kind: "seeder", plot: middle.id }), /sow something first/);
});

test("a spent bush is the one thing standing in a seeder's way", () => {
  const pepper = cropById("pepper")!;
  let bush = advance(pepper, plant(pepper), pepper.growthSeconds, 1);
  assert.equal(blocksSeeder(bush), false, "a bush with pickings left is not in the way");
  for (let taken = 0; taken < pepper.harvests - 1; taken++) {
    bush = advance(pepper, harvest(pepper, bush, "plot").planted!, pepper.regrowSeconds, 1);
  }
  assert.equal(blocksSeeder(bush), false, "still bearing");
  assert.equal(blocksSeeder(null), false);
});
