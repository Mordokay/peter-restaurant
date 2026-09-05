import test from "node:test";
import assert from "node:assert/strict";
import {
  animationLanguage,
  artScale,
  cropAnimationLanguage,
  firstArtVerticalSlice,
  ingredientSilhouettes,
  interfaceRules,
  physicalOrderRailRules,
  pictureFirstInteractions,
  renderingBudgets,
  worldFeedbackStates,
  worldPalette,
} from "./visual.ts";
import { restaurantItems } from "./restaurant.ts";

test("every crop has a stable palette color and distinct silhouette", () => {
  const cropIds = restaurantItems.filter((item) => item.kind === "crop").map((item) => item.id);
  assert.deepEqual(Object.keys(ingredientSilhouettes), cropIds);
  assert.equal(new Set(Object.values(ingredientSilhouettes)).size, cropIds.length);
  for (const crop of cropIds) assert.match(worldPalette[crop as keyof typeof worldPalette], /^#[0-9a-f]{6}$/i);
});

test("block animation foundation avoids skeleton and ragdoll dependencies", () => {
  assert.equal(animationLanguage.usesRagdolls, false);
  assert.equal(animationLanguage.usesSkeletonsByDefault, false);
  assert.ok(artScale.steppedAnimationFps >= 8 && artScale.steppedAnimationFps <= 12);
  assert.deepEqual(animationLanguage.phases, ["anticipation", "action", "response", "recovery"]);
});

test("living crops expose yield and growth through restrained world animation", () => {
  assert.equal(cropAnimationLanguage.tomatoFruitSitesPerMaturePlant, 6);
  assert.equal(cropAnimationLanguage.independentFruitGrowth, true);
  assert.ok(cropAnimationLanguage.matureIdleScaleAmplitude <= 0.02);
  assert.equal(cropAnimationLanguage.yieldUpgradesChangeVisiblePlantOrFruitCount, true);
});

test("food uses finer adaptive detail than architecture without one mesh per cell", () => {
  assert.ok(artScale.foodDetailMax < artScale.architectureMin);
  assert.ok(artScale.tomatoHeroCellsAcross[0] >= 10);
  assert.equal(renderingBudgets.mergeHiddenVoxelFaces, true);
  assert.equal(renderingBudgets.useVertexColorsForProps, true);
  assert.equal(renderingBudgets.instanceRepeatedProps, true);
});

test("first art slice proves the complete visual service loop", () => {
  assert.ok(firstArtVerticalSlice.includes("tomato_crop"));
  assert.ok(firstArtVerticalSlice.includes("tomato_soup"));
  assert.ok(firstArtVerticalSlice.includes("dirty_table"));
});

test("crafting communicates through the world instead of permanent loading bars", () => {
  assert.equal(worldFeedbackStates.working.requiresMotion, true);
  assert.equal(worldFeedbackStates.working.pattern, "slow_pulse");
  assert.equal(worldFeedbackStates.blocked.pattern, "double_blink");
  assert.equal(worldFeedbackStates.broken.pattern, "rapid_blink");
  assert.notEqual(worldFeedbackStates.working.light, worldFeedbackStates.blocked.light);
  assert.equal(interfaceRules.permanentStationProgressCards, false);
  assert.equal(interfaceRules.verticalSliceMustReadWithoutProgressBars, true);
  assert.equal(interfaceRules.detailedPanelsOpenAtOnce, 1);
});

test("the core loop is picture-first and customer demand lives on the physical pass", () => {
  assert.equal(interfaceRules.coreLoopRequiresReading, false);
  assert.equal(interfaceRules.normalPlayAllowsFilterLists, false);
  assert.equal(interfaceRules.normalPlayAllowsCheckboxGrids, false);
  assert.equal(physicalOrderRailRules.opensDetachedScrollingList, false);
  assert.equal(physicalOrderRailRules.blocksNewSeatingWhenFull, true);
  assert.ok(physicalOrderRailRules.fields.includes("dish_picture"));
  assert.ok(physicalOrderRailRules.fields.includes("table_shape_color"));
  assert.equal(pictureFirstInteractions.menu, "dish_cards_into_slots");
});
