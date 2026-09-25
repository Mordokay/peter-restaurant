// Crops: what grows, how long it takes, and what you get for picking it.
//
// Pure data and pure functions — no Babylon import, so this runs under
// `node --test` like levelLayout.ts and surfaces.ts. Rendering lives in
// cropPlanting.ts; this module never knows a mesh exists.
//
// The separation that matters most here is **visible fruit versus awarded
// items**. They are different numbers on purpose. A cherry tomato plant might
// show twelve tomatoes and award forty: placing forty would be unreadable at
// the game camera and would cost forty instances to say something one glance
// already said. The rulebook's Part 0 licenses exactly this — the model may lie
// about the count when the truth would not read.
//
//   sites  — how many fruit sockets the ripe model carries, so how many hang.
//   yield  — how many items a harvest puts in the player's hands.
//
// Timings are tuned to a play session, not to a season. A day is roughly nine
// real minutes (four of prep, four to five of dinner), so a crop that cannot be
// sown and picked inside that window is a crop the player never sees finish.

import { hash01, hashRange } from "./hash.ts";

/** Which model a plant is currently showing. */
export type CropStage = "seedling" | "growing" | "ripe";

export const CROP_STAGES: readonly CropStage[] = ["seedling", "growing", "ripe"];

export interface CropDefinition {
  id: string;
  name: string;
  /** Catalog model ids, one per stage. */
  stages: Readonly<Record<CropStage, string>>;
  /** Catalog id of the item a harvest produces, or null where that model is not
   *  authored yet. A whole-plant crop's produce IS the thing you pulled up — a
   *  trimmed carrot, a cut cabbage — so it is authored separately from the plant
   *  rather than reusing the model that was standing in the soil. */
  produce: string | null;
  /** Fruit sockets on the ripe model — what the player SEES. */
  sites: number;
  /** Items awarded per harvest, inclusive range — what the player GETS. */
  yield: readonly [number, number];
  /** Sowing to first harvest. */
  growthSeconds: number;
  /** Harvest to the next one, for crops that are picked rather than pulled. */
  regrowSeconds: number;
  /** Harvests before the plant is spent. `Infinity` for a perennial. */
  harvests: number;
  /** True where harvesting takes the plant itself (a cabbage, a carrot) rather
   *  than picking fruit off it (a pepper, a strawberry). */
  wholePlant: boolean;
  /** Metres each stage sits INTO the soil.
   *
   *  A root crop is modelled whole — a carrot is mostly carrot below ground —
   *  and the pipeline stands every model on its own base, so planted straight
   *  onto the soil the entire root is above it and the thing looks dropped
   *  rather than grown. The sink is how much of the model is underground, and
   *  it is a property of the PLANT, not of the renderer: only the crop knows
   *  how much of itself should be buried. */
  sink?: Readonly<Partial<Record<CropStage, number>>>;
}

/** Fraction of `growthSeconds` spent as a seedling before the plant bulks up. */
const SEEDLING_UNTIL = 0.3;

export const cropDefinitions: readonly CropDefinition[] = [
  {
    id: "lettuce", name: "Lettuce",
    stages: { seedling: "crop_lettuce_seedling", growing: "crop_lettuce_growing", ripe: "crop_lettuce_ripe" },
    produce: "item_lettuce",
    sink: { growing: 0.02, ripe: 0.03 },
    // A lettuce is one head, cut once. Fast and forgiving: the first crop a
    // player plants should finish inside a single prep phase.
    sites: 1, yield: [1, 1], growthSeconds: 45, regrowSeconds: 0, harvests: 1, wholePlant: true,
  },
  {
    id: "carrot", name: "Carrot",
    stages: { seedling: "crop_carrot_seedling", growing: "crop_carrot_growing", ripe: "crop_carrot_ripe" },
    produce: "item_carrot",
    // One root shows, but pulling a carrot gives a small handful — the plot is
    // read as a row, not as a single plant.
    sites: 1, yield: [1, 3], growthSeconds: 70, regrowSeconds: 0, harvests: 1, wholePlant: true,
    // The ripe root is 32 cm of carrot; all but its shoulder belongs in the
    // ground. The younger stages have no root to bury.
    sink: { ripe: 0.28 },
  },
  {
    id: "cabbage", name: "Cabbage",
    stages: { seedling: "crop_cabbage_seedling", growing: "crop_cabbage_growing", ripe: "crop_cabbage_ripe" },
    produce: "item_cabbage",
    // Bedded in just far enough that the lowest wrapper leaves touch soil
    // rather than hovering over it.
    sink: { growing: 0.02, ripe: 0.04 },
    sites: 1, yield: [1, 1], growthSeconds: 120, regrowSeconds: 0, harvests: 1, wholePlant: true,
  },
  {
    id: "strawberry", name: "Strawberry",
    stages: { seedling: "crop_strawberry_seedling", growing: "crop_strawberry_growing", ripe: "crop_strawberry_ripe" },
    produce: "item_strawberry",
    // Perennial: picked over and over, never replanted. The eight sockets are
    // the plant's capacity; a harvest awards four to eight.
    sites: 8, yield: [4, 8], growthSeconds: 90, regrowSeconds: 50, harvests: Infinity, wholePlant: false,
  },
  {
    id: "pepper", name: "Bell Pepper",
    stages: { seedling: "crop_pepper_seedling", growing: "crop_pepper_growing", ripe: "crop_pepper_ripe_red" },
    produce: "item_pepper_red",
    // A pepper bush bears several flushes and is then done, so it teaches the
    // replanting rhythm without the finality of a whole-plant crop.
    sites: 10, yield: [3, 10], growthSeconds: 150, regrowSeconds: 70, harvests: 4, wholePlant: false,
  },
];

const byId = new Map(cropDefinitions.map((crop) => [crop.id, crop]));

export function cropById(id: string): CropDefinition | undefined {
  return byId.get(id);
}

/** A plant in the ground.
 *
 *  Growth is BANKED TIME, not a date. A plant records how many seconds of
 *  growing it has actually had, and the farm adds to that only while the soil
 *  under it is wet — so a plot nobody waters is a plot that does not move, and
 *  compost makes the same real second worth more. A `readyAt` timestamp could
 *  not express either without lying about when the plant was sown. */
export interface PlantedCrop {
  crop: string;
  /** Seconds of effective growth banked since sowing. */
  grown: number;
  /** Seconds of effective regrowth banked since the last picking. */
  regrown: number;
  /** Harvests taken so far.
   *
   *  This counts UP rather than storing "harvests remaining", because a
   *  perennial has `Infinity` harvests and `Infinity - 1 === Infinity`. A
   *  decrementing counter therefore never moves for a strawberry, which would
   *  have left it permanently looking like it had never been picked. */
  harvested: number;
}

export function plant(crop: CropDefinition): PlantedCrop {
  return { crop: crop.id, grown: 0, regrown: 0, harvested: 0 };
}

/** Time passing over this plant, at whatever rate the soil allows. A rate of
 *  zero — dry ground — leaves it exactly as it was. */
export function advance(crop: CropDefinition, planted: PlantedCrop, dt: number, rate: number): PlantedCrop {
  const banked = Math.max(0, dt) * Math.max(0, rate);
  if (!banked) return planted;
  // Growth is capped at what the plant can use: banking a week of surplus would
  // make the next regrow finish the instant it was picked.
  return {
    ...planted,
    grown: Math.min(crop.growthSeconds, planted.grown + banked),
    regrown: Math.min(Math.max(crop.regrowSeconds, 1), planted.regrown + banked),
  };
}

/** Harvests still available. `Infinity` for a perennial. */
export function harvestsLeft(crop: CropDefinition, planted: PlantedCrop): number {
  return crop.harvests - planted.harvested;
}

/** Which model to show. Note this is the PLANT's maturity, not the fruit's: a
 *  picked pepper bush is still "ripe" — a full-grown bush with nothing on it. */
export function stageOf(crop: CropDefinition, planted: PlantedCrop): CropStage {
  const grown = planted.grown / Math.max(1e-6, crop.growthSeconds);
  if (grown >= 1) return "ripe";
  return grown < SEEDLING_UNTIL ? "seedling" : "growing";
}

export function stageModel(crop: CropDefinition, planted: PlantedCrop): string {
  return crop.stages[stageOf(crop, planted)];
}

/** How far along the current fruit set is, 0..1. Drives the regrow animation;
 *  the renderer eases it and adds the overshoot. */
export function fruitProgress(crop: CropDefinition, planted: PlantedCrop): number {
  if (harvestsLeft(crop, planted) <= 0) return 0;
  // Before the first harvest the fruit comes on with the plant; afterwards it is
  // the regrow window that matters.
  if (planted.harvested === 0) return Math.max(0, Math.min(1, planted.grown / Math.max(1e-6, crop.growthSeconds)));
  return Math.max(0, Math.min(1, planted.regrown / Math.max(1e-6, crop.regrowSeconds)));
}

/** Ripe, fruit grown, and something left to give. */
export function isReady(crop: CropDefinition, planted: PlantedCrop): boolean {
  return harvestsLeft(crop, planted) > 0 && stageOf(crop, planted) === "ripe" && fruitProgress(crop, planted) >= 1;
}

/** Whether the plant is finished and the soil should be turned over. */
export function isSpent(crop: CropDefinition, planted: PlantedCrop): boolean {
  return harvestsLeft(crop, planted) <= 0;
}

/** Seconds of WATERED growing still to come, which is not the same as seconds
 *  on the clock: a dry plot never gets there at all. */
export function growthLeft(crop: CropDefinition, planted: PlantedCrop): number {
  if (harvestsLeft(crop, planted) <= 0) return 0;
  if (planted.harvested === 0) return Math.max(0, crop.growthSeconds - planted.grown);
  return Math.max(0, crop.regrowSeconds - planted.regrown);
}

/** How many items this particular harvest gives. Stable across saves: the same
 *  plot picked the same number of times always yields the same amount, so a
 *  reload cannot be used to reroll a poor harvest. */
export function yieldOf(crop: CropDefinition, seed: string, harvestIndex: number, bonus = 0): number {
  const [low, high] = crop.yield;
  const picked = hashRange(`${crop.id}:${seed}`, harvestIndex, low, high);
  // A soil bonus is a second, better roll — composted ground gives more without
  // ever giving a different crop or breaking the range the model can show.
  if (bonus <= 0) return picked;
  const again = hashRange(`${crop.id}:${seed}:fed`, harvestIndex, low, high);
  return Math.min(high, hash01(`${crop.id}:${seed}:luck`, harvestIndex) < bonus ? Math.max(picked, again) : picked);
}

export interface HarvestResult {
  /** The plant afterwards, or null where the soil is now empty. */
  planted: PlantedCrop | null;
  /** Items handed to the player. Zero when it was not ready. */
  items: number;
  /** True where this harvest used the plant up. */
  spent: boolean;
}

/** Pick it. Returns the next state rather than mutating, so callers can preview. */
export function harvest(crop: CropDefinition, planted: PlantedCrop, seed: string, bonus = 0): HarvestResult {
  if (!isReady(crop, planted)) return { planted, items: 0, spent: false };

  const items = yieldOf(crop, seed, planted.harvested, bonus);
  const taken = { ...planted, harvested: planted.harvested + 1, regrown: 0 };

  // A whole-plant crop leaves bare soil; a picked one keeps standing and regrows.
  if (crop.wholePlant || harvestsLeft(crop, taken) <= 0) return { planted: null, items, spent: true };
  return { planted: taken, items, spent: false };
}

/** Problems with the crop table, given the model ids the catalog actually has.
 *  Missing produce is reported separately from a broken stage: a stage id that
 *  does not resolve is a bug, whereas a null produce is simply a model nobody
 *  has authored yet. */
export function validateCrops(catalogIds: Iterable<string>): { errors: string[]; gaps: string[] } {
  const known = new Set(catalogIds);
  const errors: string[] = [];
  const gaps: string[] = [];
  const seen = new Set<string>();
  for (const crop of cropDefinitions) {
    if (seen.has(crop.id)) errors.push(`${crop.id}: duplicate crop id`);
    seen.add(crop.id);
    for (const stage of CROP_STAGES) {
      const id = crop.stages[stage];
      if (!known.has(id)) errors.push(`${crop.id}: ${stage} model "${id}" is not in the catalog`);
    }
    if (crop.produce === null) gaps.push(`${crop.id}: no produce item authored yet`);
    else if (!known.has(crop.produce)) errors.push(`${crop.id}: produce "${crop.produce}" is not in the catalog`);
    const [low, high] = crop.yield;
    if (low < 1 || high < low) errors.push(`${crop.id}: yield ${low}..${high} is not a sane range`);
    if (crop.sites < 1) errors.push(`${crop.id}: needs at least one fruit site`);
    if (!crop.wholePlant && crop.regrowSeconds <= 0 && crop.harvests > 1) {
      errors.push(`${crop.id}: picked crops with several harvests need a regrow time`);
    }
    if (crop.wholePlant && crop.harvests !== 1) {
      errors.push(`${crop.id}: a whole-plant crop can only be harvested once`);
    }
  }
  return { errors, gaps };
}
