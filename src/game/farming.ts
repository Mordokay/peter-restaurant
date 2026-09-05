import type { CatalogItemId } from "./catalog";

export type BaseMaterialId = Extract<CatalogItemId,
  | "sunleaf"
  | "crimson_berry"
  | "violet_bloom"
  | "mooncap"
  | "emberroot"
  | "goldmoss"
  | "frostfern"
  | "azure_cactus"
  | "night_orchid"
  | "ghostreed"
>;

export interface CropDefinition {
  id: BaseMaterialId;
  name: string;
  unlockCost: number;
  seedCost: number;
  growthSeconds: number;
  baseYield: number;
  renewable: boolean;
  color: string;
}

export const cropDefinitions: readonly CropDefinition[] = [
  { id: "sunleaf", name: "Sunleaf", unlockCost: 0, seedCost: 0, growthSeconds: 12, baseYield: 6, renewable: true, color: "#8bd13f" },
  { id: "crimson_berry", name: "Crimson Berry", unlockCost: 80, seedCost: 4, growthSeconds: 16, baseYield: 5, renewable: false, color: "#d7473f" },
  { id: "violet_bloom", name: "Violet Bloom", unlockCost: 180, seedCost: 7, growthSeconds: 20, baseYield: 5, renewable: true, color: "#9b62cf" },
  { id: "mooncap", name: "Mooncap", unlockCost: 350, seedCost: 10, growthSeconds: 24, baseYield: 4, renewable: false, color: "#82c7e8" },
  { id: "emberroot", name: "Emberroot", unlockCost: 650, seedCost: 15, growthSeconds: 30, baseYield: 5, renewable: false, color: "#db6a32" },
  { id: "goldmoss", name: "Goldmoss", unlockCost: 1_000, seedCost: 20, growthSeconds: 36, baseYield: 6, renewable: true, color: "#d9b947" },
  { id: "frostfern", name: "Frostfern", unlockCost: 1_600, seedCost: 28, growthSeconds: 42, baseYield: 5, renewable: true, color: "#64d1d0" },
  { id: "azure_cactus", name: "Azure Cactus", unlockCost: 2_500, seedCost: 36, growthSeconds: 50, baseYield: 4, renewable: false, color: "#3d9fb5" },
  { id: "night_orchid", name: "Night Orchid", unlockCost: 4_200, seedCost: 50, growthSeconds: 60, baseYield: 4, renewable: true, color: "#b63a9b" },
  { id: "ghostreed", name: "Ghostreed", unlockCost: 7_000, seedCost: 70, growthSeconds: 72, baseYield: 5, renewable: true, color: "#d4e5df" },
];

export const farmPlotUnlockCosts = [0, 220, 600, 1_300, 2_600, 4_800, 8_000, 13_000, 21_000, 34_000] as const;

export function cropYield(crop: CropDefinition, geneticsLevel: number): number {
  return crop.baseYield + Math.max(0, geneticsLevel - 1);
}

export function cropGrowthSeconds(crop: CropDefinition, geneticsLevel: number): number {
  return crop.growthSeconds / (1 + Math.max(0, geneticsLevel - 1) * 0.18);
}

export function geneticsUpgradeCost(crop: CropDefinition, geneticsLevel: number): number {
  const base = Math.max(60, crop.unlockCost * 0.45 + crop.seedCost * 8);
  return Math.ceil(base * Math.pow(2.35, Math.max(0, geneticsLevel - 1)) / 5) * 5;
}
