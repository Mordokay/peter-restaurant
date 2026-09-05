export type ItemCategory =
  | "base"
  | "prepared"
  | "powder"
  | "essence"
  | "incense"
  | "remedy"
  | "charm";

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  materialFamily: string;
  value: number;
  unlockTier: number;
  color: string;
}

export const items = [
  { id: "sunleaf", name: "Sunleaf", category: "base", materialFamily: "sunleaf", value: 3, unlockTier: 0, color: "#8bd13f" },
  { id: "crimson_berry", name: "Crimson Berry", category: "base", materialFamily: "crimson_berry", value: 4, unlockTier: 0, color: "#d7473f" },
  { id: "violet_bloom", name: "Violet Bloom", category: "base", materialFamily: "violet_bloom", value: 6, unlockTier: 1, color: "#9b62cf" },
  { id: "mooncap", name: "Mooncap", category: "base", materialFamily: "mooncap", value: 7, unlockTier: 1, color: "#82c7e8" },
  { id: "emberroot", name: "Emberroot", category: "base", materialFamily: "emberroot", value: 9, unlockTier: 2, color: "#db6a32" },
  { id: "goldmoss", name: "Goldmoss", category: "base", materialFamily: "goldmoss", value: 10, unlockTier: 2, color: "#d9b947" },
  { id: "frostfern", name: "Frostfern", category: "base", materialFamily: "frostfern", value: 13, unlockTier: 3, color: "#64d1d0" },
  { id: "azure_cactus", name: "Azure Cactus", category: "base", materialFamily: "azure_cactus", value: 14, unlockTier: 3, color: "#3d9fb5" },
  { id: "night_orchid", name: "Night Orchid", category: "base", materialFamily: "night_orchid", value: 18, unlockTier: 4, color: "#b63a9b" },
  { id: "ghostreed", name: "Ghostreed", category: "base", materialFamily: "ghostreed", value: 20, unlockTier: 4, color: "#d4e5df" },

  { id: "dried_sunleaf", name: "Dried Sunleaf", category: "prepared", materialFamily: "sunleaf", value: 7, unlockTier: 0, color: "#b3a25c" },
  { id: "berry_mash", name: "Berry Mash", category: "prepared", materialFamily: "crimson_berry", value: 9, unlockTier: 0, color: "#b6333c" },
  { id: "dried_violet", name: "Dried Violet", category: "prepared", materialFamily: "violet_bloom", value: 12, unlockTier: 1, color: "#8050a8" },
  { id: "sliced_mooncap", name: "Sliced Mooncap", category: "prepared", materialFamily: "mooncap", value: 14, unlockTier: 1, color: "#76b5d3" },
  { id: "chopped_emberroot", name: "Chopped Emberroot", category: "prepared", materialFamily: "emberroot", value: 17, unlockTier: 2, color: "#bd562b" },
  { id: "dried_goldmoss", name: "Dried Goldmoss", category: "prepared", materialFamily: "goldmoss", value: 19, unlockTier: 2, color: "#bfa342" },
  { id: "dried_frostfern", name: "Dried Frostfern", category: "prepared", materialFamily: "frostfern", value: 23, unlockTier: 3, color: "#75bebf" },
  { id: "azure_pulp", name: "Azure Pulp", category: "prepared", materialFamily: "azure_cactus", value: 25, unlockTier: 3, color: "#398da4" },
  { id: "cured_night_orchid", name: "Cured Night Orchid", category: "prepared", materialFamily: "night_orchid", value: 31, unlockTier: 4, color: "#853271" },
  { id: "dried_ghostreed", name: "Dried Ghostreed", category: "prepared", materialFamily: "ghostreed", value: 34, unlockTier: 4, color: "#b9cbc6" },

  { id: "sunleaf_powder", name: "Sunleaf Powder", category: "powder", materialFamily: "sunleaf", value: 16, unlockTier: 0, color: "#b8cf61" },
  { id: "violet_powder", name: "Violet Powder", category: "powder", materialFamily: "violet_bloom", value: 25, unlockTier: 1, color: "#a16bc3" },
  { id: "mooncap_powder", name: "Mooncap Powder", category: "powder", materialFamily: "mooncap", value: 28, unlockTier: 1, color: "#9bd2e5" },
  { id: "goldmoss_powder", name: "Goldmoss Powder", category: "powder", materialFamily: "goldmoss", value: 35, unlockTier: 2, color: "#e1c359" },
  { id: "frostfern_powder", name: "Frostfern Powder", category: "powder", materialFamily: "frostfern", value: 42, unlockTier: 3, color: "#a1e5df" },
  { id: "ghostreed_fibers", name: "Ghostreed Fibers", category: "prepared", materialFamily: "ghostreed", value: 55, unlockTier: 4, color: "#e2efeb" },

  { id: "sunleaf_essence", name: "Sunleaf Essence", category: "essence", materialFamily: "sunleaf", value: 28, unlockTier: 0, color: "#69dd88" },
  { id: "crimson_syrup", name: "Crimson Syrup", category: "essence", materialFamily: "crimson_berry", value: 24, unlockTier: 0, color: "#d3394a" },
  { id: "violet_essence", name: "Violet Essence", category: "essence", materialFamily: "violet_bloom", value: 38, unlockTier: 1, color: "#a35ace" },
  { id: "mooncap_essence", name: "Mooncap Essence", category: "essence", materialFamily: "mooncap", value: 42, unlockTier: 1, color: "#73c9e8" },
  { id: "ember_paste", name: "Ember Paste", category: "prepared", materialFamily: "emberroot", value: 34, unlockTier: 2, color: "#dd6335" },
  { id: "ember_essence", name: "Ember Essence", category: "essence", materialFamily: "emberroot", value: 48, unlockTier: 2, color: "#e57435" },
  { id: "frost_essence", name: "Frost Essence", category: "essence", materialFamily: "frostfern", value: 58, unlockTier: 3, color: "#7ce5df" },
  { id: "azure_sap", name: "Azure Sap", category: "essence", materialFamily: "azure_cactus", value: 61, unlockTier: 3, color: "#45b7ce" },
  { id: "night_essence", name: "Night Essence", category: "essence", materialFamily: "night_orchid", value: 76, unlockTier: 4, color: "#cf52bc" },

  { id: "sunleaf_incense", name: "Sunleaf Incense", category: "incense", materialFamily: "sunleaf", value: 22, unlockTier: 0, color: "#638941" },
  { id: "violet_incense", name: "Violet Incense", category: "incense", materialFamily: "violet_bloom", value: 34, unlockTier: 1, color: "#74468d" },
  { id: "goldmoss_incense", name: "Goldmoss Incense", category: "incense", materialFamily: "goldmoss", value: 51, unlockTier: 2, color: "#cca438" },
  { id: "night_incense", name: "Night Incense", category: "incense", materialFamily: "night_orchid", value: 83, unlockTier: 4, color: "#762a72" },
  { id: "ghostreed_incense", name: "Ghostreed Incense", category: "incense", materialFamily: "ghostreed", value: 88, unlockTier: 4, color: "#c9ded8" },

  { id: "sunward_tonic", name: "Sunward Tonic", category: "remedy", materialFamily: "sunleaf", value: 46, unlockTier: 1, color: "#e1d258" },
  { id: "heartwarm_cordial", name: "Heartwarm Cordial", category: "remedy", materialFamily: "crimson_berry", value: 43, unlockTier: 1, color: "#d44b54" },
  { id: "dreamers_draught", name: "Dreamer's Draught", category: "remedy", materialFamily: "violet_bloom", value: 62, unlockTier: 2, color: "#9866c5" },
  { id: "moonwake_elixir", name: "Moonwake Elixir", category: "remedy", materialFamily: "mooncap", value: 68, unlockTier: 2, color: "#8edbf0" },
  { id: "fireskin_salve", name: "Fireskin Salve", category: "remedy", materialFamily: "emberroot", value: 74, unlockTier: 2, color: "#cf6635" },
  { id: "gilded_incense", name: "Gilded Incense", category: "incense", materialFamily: "goldmoss", value: 79, unlockTier: 3, color: "#e5c45d" },
  { id: "cooling_poultice", name: "Cooling Poultice", category: "remedy", materialFamily: "frostfern", value: 91, unlockTier: 3, color: "#b4ece8" },
  { id: "travelers_balm", name: "Traveler's Balm", category: "remedy", materialFamily: "azure_cactus", value: 95, unlockTier: 3, color: "#4ca8bd" },
  { id: "veil_perfume", name: "Veil Perfume", category: "remedy", materialFamily: "night_orchid", value: 121, unlockTier: 4, color: "#bf4eac" },
  { id: "warding_charm", name: "Warding Charm", category: "charm", materialFamily: "ghostreed", value: 132, unlockTier: 4, color: "#e5f3ef" },
] as const satisfies readonly ItemDefinition[];

export type CatalogItemId = (typeof items)[number]["id"];

export const stationDefinitions = [
  { id: "drying_rack", name: "Drying Rack", capacity: 6, footprint: [2, 1], baseCost: 100, unlockTier: 0 },
  { id: "preparation_table", name: "Preparation Table", capacity: 6, footprint: [2, 1], baseCost: 130, unlockTier: 0 },
  { id: "mortar_mill", name: "Mortar Mill", capacity: 6, footprint: [2, 2], baseCost: 220, unlockTier: 0 },
  { id: "alchemists_still", name: "Alchemist's Still", capacity: 6, footprint: [2, 2], baseCost: 320, unlockTier: 0 },
  { id: "remedy_cauldron", name: "Remedy Cauldron", capacity: 6, footprint: [2, 2], baseCost: 450, unlockTier: 1 },
  { id: "apothecary_table", name: "Apothecary Table", capacity: 6, footprint: [3, 1], baseCost: 520, unlockTier: 1 },
  { id: "enchanters_bench", name: "Enchanter's Bench", capacity: 6, footprint: [2, 2], baseCost: 380, unlockTier: 0 },
] as const;

export type StationId = (typeof stationDefinitions)[number]["id"];

export interface RecipeDefinition {
  input: CatalogItemId;
  station: StationId;
  output: CatalogItemId;
  seconds: number;
}

export const recipes: readonly RecipeDefinition[] = [
  { input: "sunleaf", station: "drying_rack", output: "dried_sunleaf", seconds: 3 },
  { input: "violet_bloom", station: "drying_rack", output: "dried_violet", seconds: 4 },
  { input: "goldmoss", station: "drying_rack", output: "dried_goldmoss", seconds: 5 },
  { input: "frostfern", station: "drying_rack", output: "dried_frostfern", seconds: 6 },
  { input: "night_orchid", station: "drying_rack", output: "cured_night_orchid", seconds: 7 },
  { input: "ghostreed", station: "drying_rack", output: "dried_ghostreed", seconds: 7 },

  { input: "crimson_berry", station: "preparation_table", output: "berry_mash", seconds: 3 },
  { input: "mooncap", station: "preparation_table", output: "sliced_mooncap", seconds: 4 },
  { input: "emberroot", station: "preparation_table", output: "chopped_emberroot", seconds: 5 },
  { input: "azure_cactus", station: "preparation_table", output: "azure_pulp", seconds: 6 },
  { input: "chopped_emberroot", station: "preparation_table", output: "ember_paste", seconds: 6 },
  { input: "dried_ghostreed", station: "preparation_table", output: "ghostreed_fibers", seconds: 7 },

  { input: "dried_sunleaf", station: "mortar_mill", output: "sunleaf_powder", seconds: 4 },
  { input: "dried_violet", station: "mortar_mill", output: "violet_powder", seconds: 5 },
  { input: "sliced_mooncap", station: "mortar_mill", output: "mooncap_powder", seconds: 5 },
  { input: "dried_goldmoss", station: "mortar_mill", output: "goldmoss_powder", seconds: 6 },
  { input: "dried_frostfern", station: "mortar_mill", output: "frostfern_powder", seconds: 7 },
  { input: "dried_ghostreed", station: "mortar_mill", output: "ghostreed_fibers", seconds: 7 },

  { input: "dried_sunleaf", station: "alchemists_still", output: "sunleaf_essence", seconds: 5 },
  { input: "berry_mash", station: "alchemists_still", output: "crimson_syrup", seconds: 5 },
  { input: "dried_violet", station: "alchemists_still", output: "violet_essence", seconds: 6 },
  { input: "sliced_mooncap", station: "alchemists_still", output: "mooncap_essence", seconds: 6 },
  { input: "chopped_emberroot", station: "alchemists_still", output: "ember_essence", seconds: 7 },
  { input: "dried_frostfern", station: "alchemists_still", output: "frost_essence", seconds: 8 },
  { input: "azure_pulp", station: "alchemists_still", output: "azure_sap", seconds: 8 },
  { input: "cured_night_orchid", station: "alchemists_still", output: "night_essence", seconds: 9 },

  { input: "sunleaf_essence", station: "remedy_cauldron", output: "sunward_tonic", seconds: 7 },
  { input: "crimson_syrup", station: "remedy_cauldron", output: "heartwarm_cordial", seconds: 7 },
  { input: "violet_essence", station: "remedy_cauldron", output: "dreamers_draught", seconds: 8 },
  { input: "mooncap_essence", station: "remedy_cauldron", output: "moonwake_elixir", seconds: 8 },
  { input: "ember_essence", station: "remedy_cauldron", output: "fireskin_salve", seconds: 9 },
  { input: "frost_essence", station: "remedy_cauldron", output: "cooling_poultice", seconds: 10 },

  { input: "ember_paste", station: "apothecary_table", output: "fireskin_salve", seconds: 8 },
  { input: "azure_sap", station: "apothecary_table", output: "travelers_balm", seconds: 9 },
  { input: "night_essence", station: "apothecary_table", output: "veil_perfume", seconds: 11 },
  { input: "frostfern_powder", station: "apothecary_table", output: "cooling_poultice", seconds: 9 },
  { input: "crimson_syrup", station: "apothecary_table", output: "heartwarm_cordial", seconds: 7 },
  { input: "sunleaf_powder", station: "apothecary_table", output: "sunward_tonic", seconds: 7 },

  { input: "dried_sunleaf", station: "enchanters_bench", output: "sunleaf_incense", seconds: 5 },
  { input: "dried_violet", station: "enchanters_bench", output: "violet_incense", seconds: 6 },
  { input: "dried_goldmoss", station: "enchanters_bench", output: "goldmoss_incense", seconds: 7 },
  { input: "goldmoss_incense", station: "enchanters_bench", output: "gilded_incense", seconds: 9 },
  { input: "cured_night_orchid", station: "enchanters_bench", output: "night_incense", seconds: 9 },
  { input: "dried_ghostreed", station: "enchanters_bench", output: "ghostreed_incense", seconds: 9 },
  { input: "ghostreed_fibers", station: "enchanters_bench", output: "warding_charm", seconds: 11 },
] as const;

export function validateCatalog(): string[] {
  const errors: string[] = [];
  const itemIds = new Set(items.map((item) => item.id));
  const stationIds = new Set(stationDefinitions.map((station) => station.id));
  for (const recipe of recipes) {
    if (!itemIds.has(recipe.input)) errors.push(`Unknown recipe input: ${recipe.input}`);
    if (!itemIds.has(recipe.output)) errors.push(`Unknown recipe output: ${recipe.output}`);
    if (!stationIds.has(recipe.station)) errors.push(`Unknown recipe station: ${recipe.station}`);
    if (recipe.input === recipe.output) errors.push(`Recipe cannot output its input: ${recipe.input}`);
  }
  const maximumDepth = new Map<string, number>(items.filter((item) => item.category === "base").map((item) => [item.id, 0]));
  for (let pass = 0; pass < items.length; pass++) {
    let changed = false;
    for (const recipe of recipes) {
      const inputDepth = maximumDepth.get(recipe.input);
      if (inputDepth === undefined) continue;
      const outputDepth = inputDepth + 1;
      if (outputDepth > (maximumDepth.get(recipe.output) ?? -1)) {
        maximumDepth.set(recipe.output, outputDepth);
        changed = true;
      }
    }
    if (!changed) break;
    if (pass === items.length - 1) errors.push("Recipe graph contains a processing cycle");
  }
  for (const [item, depth] of maximumDepth) {
    if (depth > 3) errors.push(`${item} requires ${depth} processing stages; maximum is 3`);
  }
  return errors;
}
