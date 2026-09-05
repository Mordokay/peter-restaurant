import assert from "node:assert/strict";
import test from "node:test";
import { items, recipes, stationDefinitions, validateCatalog } from "./catalog.ts";
import { cropDefinitions, cropGrowthSeconds, cropYield, farmPlotUnlockCosts, geneticsUpgradeCost } from "./farming.ts";
import { addItems, countItem, groupItems, removeItems } from "./inventory.ts";

test("inventory capacity is shared by every item type", () => {
  const inventory = ["sunleaf", "dried_sunleaf"];
  assert.equal(addItems(inventory, "sunleaf", 4, 4), 2);
  assert.deepEqual(inventory, ["sunleaf", "dried_sunleaf", "sunleaf", "sunleaf"]);
});

test("removing one item type preserves the rest of the carried stack", () => {
  const inventory = ["sunleaf", "dried_sunleaf", "sunleaf", "sunleaf_incense"];
  assert.equal(removeItems(inventory, "sunleaf", 2), 2);
  assert.deepEqual(inventory, ["dried_sunleaf", "sunleaf_incense"]);
  assert.equal(countItem(inventory, "dried_sunleaf"), 1);
  assert.deepEqual(groupItems(inventory), { dried_sunleaf: 1, sunleaf_incense: 1 });
});

test("the content catalog contains no broken recipe references", () => {
  assert.deepEqual(validateCatalog(), []);
});

test("one prepared material can branch into several single-input products", () => {
  const sunleafBranches = recipes
    .filter((recipe) => recipe.input === "dried_sunleaf")
    .map((recipe) => recipe.output);
  assert.deepEqual(new Set(sunleafBranches), new Set(["sunleaf_powder", "sunleaf_essence", "sunleaf_incense"]));
});

test("every farm material has a reachable finished product through the station catalog", () => {
  const stationIds = new Set(stationDefinitions.map((station) => station.id));
  const finished = new Set(items.filter((item) => !["base", "prepared"].includes(item.category)).map((item) => item.id));
  for (const crop of cropDefinitions) {
    const reachable = new Set<string>([crop.id]);
    for (let pass = 0; pass < 3; pass++) {
      for (const recipe of recipes) {
        if (stationIds.has(recipe.station) && reachable.has(recipe.input)) reachable.add(recipe.output);
      }
    }
    assert.ok([...reachable].some((item) => finished.has(item)), `${crop.name} has no finished-product route`);
  }
});

test("farming progression contains ten increasingly expensive crops and plots", () => {
  assert.equal(cropDefinitions.length, 10);
  assert.equal(farmPlotUnlockCosts.length, 10);
  assert.equal(cropDefinitions[0]?.unlockCost, 0);
  for (let index = 1; index < cropDefinitions.length; index++) {
    assert.ok(cropDefinitions[index]!.unlockCost > cropDefinitions[index - 1]!.unlockCost);
    assert.ok(farmPlotUnlockCosts[index]! > farmPlotUnlockCosts[index - 1]!);
  }
});

test("genetics increase yield, reduce growth time, and become progressively expensive", () => {
  const crop = cropDefinitions[4]!;
  assert.ok(cropYield(crop, 3) > cropYield(crop, 1));
  assert.ok(cropGrowthSeconds(crop, 3) < cropGrowthSeconds(crop, 1));
  assert.ok(geneticsUpgradeCost(crop, 3) > geneticsUpgradeCost(crop, 2));
});
