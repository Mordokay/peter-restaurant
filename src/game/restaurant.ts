export type RestaurantItemKind = "crop" | "prepared" | "dish";
export type KitchenStationId = "prep_counter" | "stove" | "oven_grill" | "culture_press";

export interface RestaurantItem {
  id: string;
  name: string;
  kind: RestaurantItemKind;
  color: string;
  saleValue: number;
  menuEligible?: boolean;
}

export interface RestaurantRecipe {
  id: string;
  name: string;
  station: KitchenStationId;
  ingredients: Readonly<Partial<Record<RestaurantItemId, number>>>;
  output: RestaurantItemId;
  outputAmount: number;
  seconds?: number;
  days?: number;
  unlockLevel: number;
  recipePointCost: number;
}

export const restaurantItems = [
  { id: "tomato", name: "Tomato", kind: "crop", color: "#dc4c3f", saleValue: 2 },
  { id: "wheat", name: "Wheat", kind: "crop", color: "#d9b95c", saleValue: 2 },
  { id: "mushroom", name: "Mushroom", kind: "crop", color: "#b59b7b", saleValue: 3 },
  { id: "soybean", name: "Soybean", kind: "crop", color: "#8dae55", saleValue: 3 },
  { id: "rice", name: "Rice", kind: "crop", color: "#eee0b5", saleValue: 3 },
  { id: "cabbage", name: "Cabbage", kind: "crop", color: "#7dbd68", saleValue: 4 },
  { id: "avocado", name: "Avocado", kind: "crop", color: "#75a844", saleValue: 5 },

  { id: "dough", name: "Dough", kind: "prepared", color: "#e8cf9a", saleValue: 4 },
  { id: "tofu", name: "Tofu", kind: "prepared", color: "#f4edcf", saleValue: 6 },
  { id: "tempeh", name: "Tempeh", kind: "prepared", color: "#c99b61", saleValue: 9 },
  { id: "miso", name: "Miso", kind: "prepared", color: "#a96f43", saleValue: 11 },

  { id: "tomato_soup", name: "Tomato Soup", kind: "dish", color: "#c94235", saleValue: 10, menuEligible: true },
  { id: "bread", name: "Fresh Bread", kind: "dish", color: "#c98b46", saleValue: 11, menuEligible: true },
  { id: "tomato_pasta", name: "Tomato Pasta", kind: "dish", color: "#d7693f", saleValue: 15, menuEligible: true },
  { id: "mushroom_soup", name: "Mushroom Soup", kind: "dish", color: "#987760", saleValue: 14, menuEligible: true },
  { id: "mushroom_pasta", name: "Mushroom Pasta", kind: "dish", color: "#aa8964", saleValue: 18, menuEligible: true },
  { id: "crispy_tofu_bowl", name: "Crispy Tofu Rice Bowl", kind: "dish", color: "#d3b76c", saleValue: 22, menuEligible: true },
  { id: "mushroom_sushi", name: "Mushroom Sushi", kind: "dish", color: "#74906b", saleValue: 21, menuEligible: true },
  { id: "vegan_kimchi", name: "Vegan Kimchi", kind: "dish", color: "#df613d", saleValue: 24, menuEligible: true },
  { id: "sauerkraut", name: "Sauerkraut", kind: "dish", color: "#d6cf86", saleValue: 23, menuEligible: true },
  { id: "tempeh_bowl", name: "Tempeh Rice Bowl", kind: "dish", color: "#b88450", saleValue: 30, menuEligible: true },
  { id: "miso_mushroom_soup", name: "Miso Mushroom Soup", kind: "dish", color: "#96684c", saleValue: 32, menuEligible: true },
  { id: "avocado_sushi", name: "Avocado Sushi", kind: "dish", color: "#7cab55", saleValue: 29, menuEligible: true },
  { id: "avocado_toast", name: "Avocado Toast", kind: "dish", color: "#91ad58", saleValue: 31, menuEligible: true },
] as const satisfies readonly RestaurantItem[];

export type RestaurantItemId = (typeof restaurantItems)[number]["id"];

export const kitchenStations = [
  { id: "prep_counter", name: "Prep Counter", capacity: 4, footprint: [2, 1], baseCost: 90, unlockLevel: 1 },
  { id: "stove", name: "Stove", capacity: 4, footprint: [2, 1], baseCost: 140, unlockLevel: 1 },
  { id: "oven_grill", name: "Oven & Grill", capacity: 4, footprint: [2, 2], baseCost: 420, unlockLevel: 2 },
  { id: "culture_press", name: "Culture & Press Station", capacity: 2, footprint: [2, 2], baseCost: 950, unlockLevel: 4 },
] as const;

export const restaurantRecipes: readonly RestaurantRecipe[] = [
  { id: "tomato_soup", name: "Tomato Soup", station: "stove", ingredients: { tomato: 2 }, output: "tomato_soup", outputAmount: 2, seconds: 18, unlockLevel: 1, recipePointCost: 0 },
  { id: "make_dough", name: "Make Dough", station: "prep_counter", ingredients: { wheat: 2 }, output: "dough", outputAmount: 2, seconds: 12, unlockLevel: 2, recipePointCost: 0 },
  { id: "bread", name: "Fresh Bread", station: "oven_grill", ingredients: { dough: 1 }, output: "bread", outputAmount: 2, seconds: 20, unlockLevel: 2, recipePointCost: 1 },
  { id: "tomato_pasta", name: "Tomato Pasta", station: "stove", ingredients: { tomato: 1, wheat: 1 }, output: "tomato_pasta", outputAmount: 2, seconds: 22, unlockLevel: 2, recipePointCost: 1 },
  { id: "mushroom_soup", name: "Mushroom Soup", station: "stove", ingredients: { mushroom: 2 }, output: "mushroom_soup", outputAmount: 2, seconds: 20, unlockLevel: 3, recipePointCost: 1 },
  { id: "mushroom_pasta", name: "Mushroom Pasta", station: "stove", ingredients: { mushroom: 1, wheat: 1 }, output: "mushroom_pasta", outputAmount: 2, seconds: 24, unlockLevel: 3, recipePointCost: 2 },
  { id: "tofu", name: "Press Tofu", station: "culture_press", ingredients: { soybean: 2 }, output: "tofu", outputAmount: 4, seconds: 25, unlockLevel: 4, recipePointCost: 0 },
  { id: "crispy_tofu_bowl", name: "Crispy Tofu Rice Bowl", station: "oven_grill", ingredients: { tofu: 1, rice: 1 }, output: "crispy_tofu_bowl", outputAmount: 2, seconds: 26, unlockLevel: 6, recipePointCost: 2 },
  { id: "mushroom_sushi", name: "Mushroom Sushi", station: "prep_counter", ingredients: { mushroom: 1, rice: 1 }, output: "mushroom_sushi", outputAmount: 2, seconds: 21, unlockLevel: 6, recipePointCost: 2 },
  { id: "vegan_kimchi", name: "Vegan Kimchi", station: "culture_press", ingredients: { cabbage: 3 }, output: "vegan_kimchi", outputAmount: 8, days: 2, unlockLevel: 9, recipePointCost: 3 },
  { id: "sauerkraut", name: "Sauerkraut", station: "culture_press", ingredients: { cabbage: 3 }, output: "sauerkraut", outputAmount: 10, days: 3, unlockLevel: 9, recipePointCost: 3 },
  { id: "tempeh", name: "Culture Tempeh", station: "culture_press", ingredients: { soybean: 3 }, output: "tempeh", outputAmount: 6, days: 2, unlockLevel: 12, recipePointCost: 4 },
  { id: "miso", name: "Ferment Miso", station: "culture_press", ingredients: { soybean: 3, rice: 1 }, output: "miso", outputAmount: 12, days: 4, unlockLevel: 12, recipePointCost: 5 },
  { id: "tempeh_bowl", name: "Tempeh Rice Bowl", station: "oven_grill", ingredients: { tempeh: 1, rice: 1 }, output: "tempeh_bowl", outputAmount: 2, seconds: 28, unlockLevel: 12, recipePointCost: 4 },
  { id: "miso_mushroom_soup", name: "Miso Mushroom Soup", station: "stove", ingredients: { miso: 1, mushroom: 1 }, output: "miso_mushroom_soup", outputAmount: 3, seconds: 24, unlockLevel: 12, recipePointCost: 4 },
  { id: "avocado_sushi", name: "Avocado Sushi", station: "prep_counter", ingredients: { avocado: 1, rice: 1 }, output: "avocado_sushi", outputAmount: 2, seconds: 22, unlockLevel: 14, recipePointCost: 4 },
  { id: "avocado_toast", name: "Avocado Toast", station: "prep_counter", ingredients: { avocado: 1, wheat: 1 }, output: "avocado_toast", outputAmount: 2, seconds: 20, unlockLevel: 14, recipePointCost: 4 },
];

export const restaurantExpansionStages = [
  { level: 1, kitchenIslandPositions: 1, servicePositions: 1, diningSeats: 4, cellarBatchSlots: 0, chairComfort: 0, decorQuality: 0 },
  { level: 4, kitchenIslandPositions: 2, servicePositions: 1, diningSeats: 6, cellarBatchSlots: 0, chairComfort: 0, decorQuality: 1 },
  { level: 9, kitchenIslandPositions: 2, servicePositions: 2, diningSeats: 8, cellarBatchSlots: 2, chairComfort: 1, decorQuality: 1 },
  { level: 14, kitchenIslandPositions: 3, servicePositions: 2, diningSeats: 10, cellarBatchSlots: 3, chairComfort: 2, decorQuality: 2 },
  { level: 20, kitchenIslandPositions: 4, servicePositions: 3, diningSeats: 12, cellarBatchSlots: 4, chairComfort: 3, decorQuality: 3 },
] as const;

export const hygieneRules = {
  startingHygiene: 100,
  pestsAppearBelow: 30,
  demandingGuestsRequire: 80,
  inspectionsRequire: 85,
  stationPenaltyBelow: 45,
  dirtyTablePatiencePenalty: 0.15,
  pestTipPenalty: 0.25,
  pestReputationPenaltyPerShift: 1,
  closingCleanupSeconds: 60,
  cleaningSupplyUsesPerPack: 20,
} as const;

export const guestTiers = [
  { id: "neighbor", name: "Neighbors", reputationLevel: 1, minimumHygiene: 0, minimumComfort: 0, minimumAward: 0, minimumMasteredRecipes: 0, tipMultiplier: 1 },
  { id: "enthusiast", name: "Food Enthusiasts", reputationLevel: 4, minimumHygiene: 60, minimumComfort: 0, minimumAward: 0, minimumMasteredRecipes: 2, tipMultiplier: 1.15 },
  { id: "celebration", name: "Celebration Diners", reputationLevel: 9, minimumHygiene: 80, minimumComfort: 1, minimumAward: 0, minimumMasteredRecipes: 3, tipMultiplier: 1.4 },
  { id: "traveller", name: "Culinary Travellers", reputationLevel: 14, minimumHygiene: 85, minimumComfort: 2, minimumAward: 2, minimumMasteredRecipes: 5, tipMultiplier: 1.75 },
  { id: "vip", name: "Critics & VIP Bookings", reputationLevel: 20, minimumHygiene: 90, minimumComfort: 3, minimumAward: 3, minimumMasteredRecipes: 6, tipMultiplier: 2.25 },
] as const;

export const gardenGuideAwards = [
  { level: 0, name: "Unlisted", minimumIngredientQuality: 0, minimumMastery: 0, minimumHarmony: 0, minimumValue: 0, consistentShifts: 0 },
  { level: 1, name: "Garden Guide Recommended", minimumIngredientQuality: 1, minimumMastery: 1, minimumHarmony: 1, minimumValue: 1, consistentShifts: 3 },
  { level: 2, name: "One Garden Star", minimumIngredientQuality: 2, minimumMastery: 2, minimumHarmony: 2, minimumValue: 2, consistentShifts: 5 },
  { level: 3, name: "Two Garden Stars", minimumIngredientQuality: 3, minimumMastery: 3, minimumHarmony: 3, minimumValue: 2, consistentShifts: 7 },
  { level: 4, name: "Three Garden Stars", minimumIngredientQuality: 4, minimumMastery: 4, minimumHarmony: 4, minimumValue: 3, consistentShifts: 10 },
] as const;

export const maintenanceUpgrades = [
  { id: "stainless_surfaces", name: "Stainless Surfaces", effect: "Stations accumulate 15% less grime" },
  { id: "commercial_dishwasher", name: "Commercial Dishwasher", effect: "Dish and table cleanup is 30% faster" },
  { id: "washable_floor", name: "Washable Floor", effect: "Spill cleanup is 35% faster" },
  { id: "improved_extraction", name: "Improved Extraction", effect: "Hot-line grime accumulates 20% slower" },
  { id: "pest_control", name: "Pest-Control Contract", effect: "Pests require critically low hygiene for two consecutive shifts" },
] as const;

export const staffRoles = [
  { id: "gardener", name: "Gardener", strengths: ["harvesting", "planting"] },
  { id: "prep_cook", name: "Prep Cook", strengths: ["preparation", "restocking"] },
  { id: "line_cook", name: "Line Cook", strengths: ["stove", "oven_grill"] },
  { id: "server", name: "Server", strengths: ["serving", "table_turnover"] },
  { id: "kitchen_steward", name: "Kitchen Steward", strengths: ["cleaning", "dishes", "hauling"] },
  { id: "head_chef", name: "Head Chef", strengths: ["coordination", "quality"] },
] as const;

export const tableServiceRules = {
  startingPassSlots: 2,
  maximumPassSlots: 6,
  playerTrayCapacity: 1,
  startingServerTrayCapacity: 2,
  maximumServerTrayCapacity: 4,
  baseTipRate: 0.08,
  maximumTipRate: 0.25,
  excellentServiceSeconds: 18,
  longWaitSeconds: 55,
  hospitalityTipBonusPerLevel: 0.015,
  maximumHospitalityTipBonus: 0.06,
  hospitalityPatienceRecoveryPerLevel: 0.04,
  maximumHospitalityPatienceRecovery: 0.12,
  diningSeconds: [24, 42],
} as const;

export const menuSlotMilestones = [
  { level: 1, slots: 1 },
  { level: 2, slots: 2 },
  { level: 4, slots: 3 },
  { level: 9, slots: 4 },
  { level: 14, slots: 5 },
  { level: 20, slots: 6 },
] as const;

export const tutorialSteps = [
  { id: "harvest_tomatoes", title: "Harvest Tomatoes", detail: "Walk through the ripe tomato plot." },
  { id: "cook_soup", title: "Cook Tomato Soup", detail: "Bring two tomatoes to the Stove." },
  { id: "stock_servings", title: "Stock the Serving Shelf", detail: "Collect the soup and place it on the shelf." },
  { id: "choose_menu", title: "Set Tonight's Menu", detail: "Choose Tomato Soup in your single menu slot." },
  { id: "serve_customer", title: "Serve Your First Guest", detail: "Balance cooking and service before patience runs out." },
  { id: "close_day", title: "Close the Restaurant", detail: "Review the shift and work toward unlocking wheat." },
] as const;

export const dayStructure = {
  prepSeconds: 240,
  dinnerSeconds: 270,
  platedFoodExpiresAtClose: true,
  fermentationAdvancesAtClose: true,
} as const;

export const tomatoPlotUpgradeTiers = [
  { level: 1, plants: 1, fruitSitesPerPlant: 3, regrowSeconds: 48, upgradeCost: 0 },
  { level: 2, plants: 2, fruitSitesPerPlant: 3, regrowSeconds: 44, upgradeCost: 90 },
  { level: 3, plants: 2, fruitSitesPerPlant: 4, regrowSeconds: 39, upgradeCost: 220 },
  { level: 4, plants: 3, fruitSitesPerPlant: 5, regrowSeconds: 34, upgradeCost: 480 },
  { level: 5, plants: 3, fruitSitesPerPlant: 6, regrowSeconds: 30, upgradeCost: 900 },
] as const;

export function menuSlotsAtLevel(level: number): number {
  return menuSlotMilestones.reduce((slots, milestone) => level >= milestone.level ? milestone.slots : slots, 1);
}

export function validateRestaurantCatalog(): string[] {
  const errors: string[] = [];
  const itemIds = new Set<string>(restaurantItems.map((item) => item.id));
  const stationIds = new Set<string>(kitchenStations.map((station) => station.id));
  const recipeIds = new Set<string>();
  const producerByOutput = new Map<string, RestaurantRecipe>();

  for (const recipe of restaurantRecipes) {
    if (recipeIds.has(recipe.id)) errors.push(`Duplicate recipe id: ${recipe.id}`);
    recipeIds.add(recipe.id);
    if (!stationIds.has(recipe.station)) errors.push(`Unknown station: ${recipe.station}`);
    if (!itemIds.has(recipe.output)) errors.push(`Unknown output: ${recipe.output}`);
    if (producerByOutput.has(recipe.output)) errors.push(`Multiple recipes produce ${recipe.output}`);
    producerByOutput.set(recipe.output, recipe);
    for (const [ingredient, amount] of Object.entries(recipe.ingredients)) {
      if (!itemIds.has(ingredient)) errors.push(`Unknown ingredient: ${ingredient}`);
      if (!Number.isInteger(amount) || (amount ?? 0) <= 0) errors.push(`Invalid amount for ${ingredient} in ${recipe.id}`);
    }
    const hasSeconds = typeof recipe.seconds === "number";
    const hasDays = typeof recipe.days === "number";
    if (hasSeconds === hasDays) errors.push(`${recipe.id} must use either seconds or days`);
    if (hasDays && recipe.station !== "culture_press") errors.push(`${recipe.id} is multi-day but does not use Culture & Press`);
  }

  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (item: string): number => {
    if (depthMemo.has(item)) return depthMemo.get(item)!;
    const recipe = producerByOutput.get(item);
    if (!recipe) return 0;
    if (visiting.has(item)) {
      errors.push(`Recipe cycle reaches ${item}`);
      return 99;
    }
    visiting.add(item);
    const depth = 1 + Math.max(0, ...Object.keys(recipe.ingredients).map(depthOf));
    visiting.delete(item);
    depthMemo.set(item, depth);
    return depth;
  };
  for (const item of restaurantItems) {
    const depth = depthOf(item.id);
    if (depth > 2 && depth < 99) errors.push(`${item.id} requires ${depth} physical transformations; maximum is 2`);
  }
  return errors;
}
