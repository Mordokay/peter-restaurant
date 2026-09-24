import test from "node:test";
import assert from "node:assert/strict";
import { cropById, harvest, plant, type PlantedCrop } from "./crops.ts";
import {
  PLOT_SPACING, actionFor, countPlanted, describePlot, nearestSite, plotSites, restorePlots, secondsUntilReady,
  type AreaRect,
} from "./farm.ts";

const areas: AreaRect[] = [
  { id: "farm_a1", zone: "farm", rect: [-14, -23, 7, 7] },
  { id: "farm_b1", zone: "farm", rect: [-14, -30, 7, 7] },
  { id: "herb_garden", zone: "herbs", rect: [-14, -16, 28, 3.5] },
  { id: "tiny", zone: "farm", rect: [0, 0, 1, 1] },
];

test("plots are derived from the farm parcels, centred, and never outside them", () => {
  const sites = plotSites(areas);
  assert.deepEqual([...new Set(sites.map((site) => site.area))], ["farm_a1", "farm_b1"],
    "only farm-zone areas grow crops; the herb garden is its own thing");

  const parcel = sites.filter((site) => site.area === "farm_a1");
  assert.equal(parcel.length, 25, "a 7 m parcel holds a 5x5 grid at 1.2 m spacing");
  for (const site of parcel) {
    assert.ok(site.x >= -14 && site.x <= -7 && site.z >= -23 && site.z <= -16, `${site.id} is inside its parcel`);
  }
  // Centred: the border is the same on both sides.
  const xs = parcel.map((site) => site.x);
  assert.ok(Math.abs((Math.min(...xs) - -14) - (-7 - Math.max(...xs))) < 1e-9, "the grid sits centred in the parcel");
  const columns = [...new Set(xs)].sort((a, b) => a - b);
  assert.equal(columns.length, 5);
  assert.ok(Math.abs(columns[1]! - columns[0]! - PLOT_SPACING) < 1e-9, "columns stand one spacing apart");

  // A parcel narrower than its own borders contributes nothing, rather than a
  // plot hanging over the edge of the soil.
  assert.equal(sites.filter((site) => site.area === "tiny").length, 0);

  // Ids are stable and unique, because a save names plots by them.
  assert.equal(new Set(sites.map((site) => site.id)).size, sites.length);
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
  assert.equal(actionFor(null, 0), "sow");

  const sown = plant(lettuce, 100);
  assert.equal(actionFor(sown, 100), "growing");
  assert.equal(actionFor(sown, 100 + lettuce.growthSeconds), "harvest");

  // A pepper gives four flushes; the fourth takes the bush with it, so the plot
  // goes back to bare soil rather than standing there asking to be tidied up.
  const pepper = cropById("pepper")!;
  let bush: PlantedCrop | null = plant(pepper, 0);
  for (let taken = 0; taken < pepper.harvests; taken++) {
    const at = bush!.readyAt;
    assert.equal(actionFor(bush, at), "harvest", `harvest ${taken + 1} is available`);
    bush = harvest(pepper, bush!, at, "plot").planted;
  }
  assert.equal(bush, null, "the last harvest empties the plot");
  assert.equal(actionFor(bush, 10_000), "sow");

  // A plant whose crop was removed from the game is cleared, not crashed on.
  assert.equal(actionFor({ crop: "moonfruit", plantedAt: 0, readyAt: 0, harvested: 0 }, 10), "clear");
});

test("a save only brings back plants that still have a plot and a crop", () => {
  const sites = plotSites(areas);
  const saved: Record<string, PlantedCrop> = {
    [sites[0]!.id]: plant(cropById("carrot")!, 5),
    "farm_gone:2,2": plant(cropById("carrot")!, 5),
    [sites[1]!.id]: { crop: "moonfruit", plantedAt: 0, readyAt: 10, harvested: 0 },
  };
  const restored = restorePlots(saved, sites);
  assert.deepEqual(Object.keys(restored), [sites[0]!.id]);
  assert.equal(countPlanted(restored, "carrot"), 1);
});

test("a plot describes itself without the player having to open anything", () => {
  const carrot = cropById("carrot")!;
  const sown = plant(carrot, 0);
  assert.equal(describePlot(null, 0), "bare soil");
  assert.match(describePlot(sown, 10), /^Carrot · \d+s$/);
  assert.equal(secondsUntilReady(sown, 10), carrot.growthSeconds - 10);
  assert.equal(describePlot(sown, carrot.growthSeconds), "Carrot · ready");
  assert.equal(secondsUntilReady(sown, carrot.growthSeconds), null);

  // A perennial says how many pickings are left; an annual has nothing to say.
  const berry = plant(cropById("strawberry")!, 0);
  assert.equal(describePlot(berry, cropById("strawberry")!.growthSeconds), "Strawberry · ready");
});
