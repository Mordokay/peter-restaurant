import test from "node:test";
import assert from "node:assert/strict";
import { advance, cropById, harvest, plant, type PlantedCrop } from "./crops.ts";
import { bareSoil, till, waterSoil } from "./soil.ts";
import {
  PLOT_SPACING, actionFor, countPlanted, describePlot, growthRemaining, nearestSite, plotSites, restorePlots,
  type AreaRect,
} from "./farm.ts";

const areas: AreaRect[] = [
  { id: "farm_a1", zone: "farm", rect: [-14, -23, 7, 7] },
  { id: "farm_b1", zone: "farm", rect: [-14, -30, 7, 7] },
  { id: "herb_garden", zone: "herbs", rect: [-14, -16, 28, 3.5] },
  { id: "tiny", zone: "farm", rect: [0, 0, 1, 1] },
];

test("plots are whole cells of one world grid, so beds tile edge to edge", () => {
  const sites = plotSites(areas);
  assert.deepEqual([...new Set(sites.map((site) => site.area))], ["farm_a1", "farm_b1", "tiny"],
    "only farm-zone areas grow crops; the herb garden is its own thing");

  const parcel = sites.filter((site) => site.area === "farm_a1");
  assert.equal(parcel.length, 49, "a 7 m parcel holds seven rows of seven whole metre cells");
  for (const site of parcel) {
    assert.ok(site.x >= -14 && site.x <= -7 && site.z >= -23 && site.z <= -16, `${site.id} is inside its parcel`);
    // Every plot sits in the middle of a whole metre cell of the world grid.
    assert.ok(Math.abs((site.x - 0.5) - Math.round(site.x - 0.5)) < 1e-9, `${site.id} is on the grid in x`);
    assert.ok(Math.abs((site.z - 0.5) - Math.round(site.z - 0.5)) < 1e-9, `${site.id} is on the grid in z`);
  }

  // Columns are exactly one spacing apart, which is what "touching" means.
  const columns = [...new Set(parcel.map((site) => site.x))].sort((a, b) => a - b);
  assert.ok(Math.abs(columns[1]! - columns[0]! - PLOT_SPACING) < 1e-9);

  // The two parcels are stacked; their plots continue the same lattice rather
  // than each being centred in its own rectangle.
  const all = [...new Set(sites.map((site) => site.z))].sort((a, b) => a - b);
  for (let index = 1; index < all.length; index++) {
    const gap = all[index]! - all[index - 1]!;
    assert.ok(Math.abs(gap - PLOT_SPACING) < 1e-9 || gap > PLOT_SPACING,
      "rows step by exactly one cell, or skip a border");
  }

  // A one-metre parcel holds exactly one bed, which is now the honest answer:
  // a bed is a metre, and a metre fits.
  assert.equal(sites.filter((site) => site.area === "tiny").length, 1);
  // Ids are global and unique: a plot is a place in the world.
  assert.equal(new Set(sites.map((site) => site.id)).size, sites.length);
  assert.match(sites[0]!.id, /^plot:-?\d+,-?\d+$/);
});

test("the plot you address is the nearest one in reach, and nothing when out of reach", () => {
  const sites = plotSites(areas);
  const target = sites[7]!;
  assert.equal(nearestSite(sites, target.x + 0.2, target.z - 0.1, 1.6)?.id, target.id);
  assert.equal(nearestSite(sites, 60, 60, 1.6), null, "standing on the other side of the site addresses nothing");
  // Half the spacing away, the nearer plot wins — the choice must not flicker.
  const neighbour = sites.find((site) => site.area === target.area && Math.abs(site.x - target.x - PLOT_SPACING) < 1e-9 && site.z === target.z)!;
  assert.equal(nearestSite(sites, target.x + PLOT_SPACING * 0.4, target.z, 1.6)?.id, target.id);
  assert.equal(nearestSite(sites, target.x + PLOT_SPACING * 0.6, target.z, 1.6)?.id, neighbour.id);
});

test("one action key covers the whole life of a plot", () => {
  const lettuce = cropById("lettuce")!;
  const wet = waterSoil(till(bareSoil()));
  // Unbroken ground is not sowable: the hoe comes first.
  assert.equal(actionFor(null, bareSoil()), "till");
  assert.equal(actionFor(null, wet), "sow");

  const sown = plant(lettuce);
  assert.equal(actionFor(sown, wet), "growing");
  assert.equal(actionFor(advance(lettuce, sown, lettuce.growthSeconds, 1), wet), "harvest");

  // A pepper gives four flushes; the fourth takes the bush with it, so the plot
  // goes back to bare soil rather than standing there asking to be tidied up.
  const pepper = cropById("pepper")!;
  let bush: PlantedCrop | null = advance(pepper, plant(pepper), pepper.growthSeconds, 1);
  for (let taken = 0; taken < pepper.harvests; taken++) {
    assert.equal(actionFor(bush, wet), "harvest", `harvest ${taken + 1} is available`);
    const next = harvest(pepper, bush!, "plot").planted;
    bush = next && advance(pepper, next, pepper.regrowSeconds, 1);
  }
  assert.equal(bush, null, "the last harvest empties the plot");
  assert.equal(actionFor(bush, wet), "sow", "and the bed it leaves is still broken ground");

  // A plant whose crop was removed from the game is cleared, not crashed on.
  assert.equal(actionFor({ crop: "moonfruit", grown: 0, regrown: 0, harvested: 0 }, wet), "clear");
});

test("a save only brings back plants that still have a plot and a crop", () => {
  const sites = plotSites(areas);
  const saved: Record<string, PlantedCrop> = {
    [sites[0]!.id]: plant(cropById("carrot")!),
    "farm_gone:2,2": plant(cropById("carrot")!),
    [sites[1]!.id]: { crop: "moonfruit", grown: 0, regrown: 0, harvested: 0 },
  };
  const restored = restorePlots(saved, sites);
  assert.deepEqual(Object.keys(restored), [sites[0]!.id]);
  assert.equal(countPlanted(restored, "carrot"), 1);

  // A plant saved by an older build — growth was a pair of timestamps then —
  // comes back restarted rather than as NaN on the HUD or as a lost plot.
  const legacy = { [sites[2]!.id]: { crop: "carrot", plantedAt: 10, readyAt: 80, harvested: 1 } as unknown as PlantedCrop };
  const repaired = restorePlots(legacy, sites)[sites[2]!.id]!;
  assert.deepEqual(repaired, { crop: "carrot", grown: 0, regrown: 0, harvested: 1 });
});

test("a plot describes itself without the player having to open anything", () => {
  const carrot = cropById("carrot")!;
  const wet = waterSoil(till(bareSoil()));
  const sown = plant(carrot);
  assert.equal(describePlot(null, bareSoil()), "unbroken ground");
  assert.equal(describePlot(null, till(bareSoil())), "dry");
  assert.equal(describePlot(null, wet), "watered");

  const going = advance(carrot, sown, 10, 1);
  assert.match(describePlot(going, wet), /^Carrot · \d+s$/);
  assert.equal(growthRemaining(going), carrot.growthSeconds - 10);
  // Dry ground says so instead of counting down a clock that is not running.
  assert.equal(describePlot(going, till(bareSoil())), "Carrot · dry, not growing");

  const ready = advance(carrot, sown, carrot.growthSeconds, 1);
  assert.equal(describePlot(ready, wet), "Carrot · ready");
  assert.equal(growthRemaining(ready), null);
});
