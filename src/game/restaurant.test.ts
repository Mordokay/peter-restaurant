import test from "node:test";
import assert from "node:assert/strict";
import {
  dayStructure,
  hygieneRules,
  gardenGuideAwards,
  guestTiers,
  maintenanceUpgrades,
  kitchenStations,
  menuSlotsAtLevel,
  restaurantItems,
  restaurantRecipes,
  restaurantExpansionStages,
  tableServiceRules,
  tomatoPlotUpgradeTiers,
  tutorialSteps,
  validateRestaurantCatalog,
} from "./restaurant.ts";

test("restaurant catalogue is internally valid and limited to two transformations", () => {
  assert.deepEqual(validateRestaurantCatalog(), []);
  assert.equal(restaurantItems.filter((item) => item.kind === "crop").length, 7);
  assert.equal(kitchenStations.length, 4);
});

test("menu slots unlock gradually and cap at six", () => {
  assert.equal(menuSlotsAtLevel(1), 1);
  assert.equal(menuSlotsAtLevel(2), 2);
  assert.equal(menuSlotsAtLevel(4), 3);
  assert.equal(menuSlotsAtLevel(20), 6);
  assert.equal(menuSlotsAtLevel(100), 6);
});

test("the first shift teaches the complete service loop", () => {
  assert.deepEqual(tutorialSteps.map((step) => step.id), [
    "harvest_tomatoes",
    "cook_soup",
    "stock_servings",
    "choose_menu",
    "serve_customer",
    "close_day",
  ]);
  assert.equal(restaurantRecipes[0]?.output, "tomato_soup");
  assert.equal(restaurantRecipes[0]?.recipePointCost, 0);
  assert.equal(dayStructure.platedFoodExpiresAtClose, true);
});

test("recognizable fermented foods use persistent day durations", () => {
  const days = Object.fromEntries(restaurantRecipes.filter((recipe) => recipe.days).map((recipe) => [recipe.output, recipe.days]));
  assert.deepEqual(days, { vegan_kimchi: 2, sauerkraut: 3, tempeh: 2, miso: 4 });
});

test("authored restaurant expansions add working space rather than only speed", () => {
  assert.deepEqual(restaurantExpansionStages.map((stage) => stage.kitchenIslandPositions), [1, 2, 2, 3, 4]);
  assert.equal(restaurantExpansionStages.find((stage) => stage.level === 9)?.cellarBatchSlots, 2);
  assert.equal(restaurantExpansionStages.at(-1)?.diningSeats, 12);
  assert.equal(restaurantExpansionStages.at(-1)?.servicePositions, 3);
});

test("the restaurant starts clean and pests only communicate neglected hygiene", () => {
  assert.ok(hygieneRules.startingHygiene > hygieneRules.pestsAppearBelow);
  assert.ok(hygieneRules.pestTipPenalty > 0);
  assert.ok(hygieneRules.inspectionsRequire >= hygieneRules.demandingGuestsRequire);
  assert.ok(maintenanceUpgrades.some((upgrade) => upgrade.id === "pest_control"));
});

test("demanding guests require whole-restaurant standards while awards judge cooking", () => {
  for (let index = 1; index < guestTiers.length; index++) {
    assert.ok(guestTiers[index]!.reputationLevel > guestTiers[index - 1]!.reputationLevel);
    assert.ok(guestTiers[index]!.minimumHygiene >= guestTiers[index - 1]!.minimumHygiene);
  }
  assert.deepEqual(Object.keys(gardenGuideAwards[1]!).sort(), [
    "consistentShifts",
    "level",
    "minimumHarmony",
    "minimumIngredientQuality",
    "minimumMastery",
    "minimumValue",
    "name",
  ]);
});

test("servers improve service without becoming passive money generators", () => {
  assert.equal(tableServiceRules.playerTrayCapacity, 1);
  assert.ok(tableServiceRules.startingServerTrayCapacity > tableServiceRules.playerTrayCapacity);
  assert.ok(tableServiceRules.maximumTipRate < 0.5);
  assert.ok(tableServiceRules.maximumHospitalityTipBonus < tableServiceRules.maximumTipRate);
  assert.ok(tableServiceRules.startingPassSlots < tableServiceRules.maximumPassSlots);
});

test("tomato yield upgrades become visible on the plant", () => {
  assert.equal(tomatoPlotUpgradeTiers[0]?.plants, 1);
  assert.equal(tomatoPlotUpgradeTiers.at(-1)?.fruitSitesPerPlant, 6);
  for (let index = 1; index < tomatoPlotUpgradeTiers.length; index++) {
    const previous = tomatoPlotUpgradeTiers[index - 1]!;
    const current = tomatoPlotUpgradeTiers[index]!;
    assert.ok(current.plants * current.fruitSitesPerPlant > previous.plants * previous.fruitSitesPerPlant);
    assert.ok(current.regrowSeconds <= previous.regrowSeconds);
    assert.ok(current.upgradeCost > previous.upgradeCost);
  }
});
