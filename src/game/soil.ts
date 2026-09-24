// The ground itself: broken or unbroken, wet or dry, fed or plain.
//
// This is the half of farming the crop does not know about. A seed put in
// unbroken ground does nothing; a plant in dry soil does not grow; compost dug
// through the bed makes it grow faster and give more. Those three facts are the
// whole loop Stardew built a game on, and they are worth copying exactly because
// they turn a plot from a timer into somewhere the player keeps coming back.
//
// Pure data and pure functions. Soil holds no clock of its own: the farm ticks
// it, the same way it ticks the plants.
//
// Time is in game seconds, where a day is roughly nine minutes (see crops.ts).

/** What has been dug through the bed. */
export type Fertiliser = "none" | "compost" | "mulch";

export interface Soil {
  /** Broken with the hoe. Nothing can be sown in unbroken ground. */
  tilled: boolean;
  /** Seconds of moisture left. Growth stops at zero. */
  wet: number;
  fertiliser: Fertiliser;
}

/** One watering lasts a bit more than half a day, so a farm wants watering in
 *  the morning and rewards a second pass — but never twice in a row. */
export const WATER_SECONDS = 300;
/** Mulch holds water half again as long, which is its whole reason to exist. */
export const MULCH_WATER_BONUS = 1.5;
/** Compost speeds growth. Kept modest: it should be worth making, not a cheat. */
export const COMPOST_GROWTH = 1.35;
/** And it gives a better picking, as an extra chance at the top of the range. */
export const COMPOST_YIELD_BONUS = 0.5;

export function bareSoil(): Soil {
  return { tilled: false, wet: 0, fertiliser: "none" };
}

export function till(soil: Soil): Soil {
  // Tilling turns the bed over: it does not water it, and it loses whatever was
  // dug in last time. A plot is only ever tilled while it is empty, so nothing
  // growing is ever disturbed by this.
  return { tilled: true, wet: soil.wet, fertiliser: "none" };
}

export function waterSoil(soil: Soil): Soil {
  const capacity = WATER_SECONDS * (soil.fertiliser === "mulch" ? MULCH_WATER_BONUS : 1);
  return { ...soil, wet: capacity };
}

export function fertilise(soil: Soil, kind: Fertiliser): Soil {
  return { ...soil, fertiliser: kind };
}

/** Time passing: soil dries out. Mulch does not slow the drying, it raises how
 *  much water the bed can hold, which is the same thing said honestly. */
export function dry(soil: Soil, dt: number): Soil {
  if (soil.wet <= 0) return soil;
  return { ...soil, wet: Math.max(0, soil.wet - dt) };
}

export function isWet(soil: Soil): boolean { return soil.wet > 0; }

/** How fast a plant in this soil grows: nothing at all when dry. */
export function growthRate(soil: Soil): number {
  if (!isWet(soil)) return 0;
  return soil.fertiliser === "compost" ? COMPOST_GROWTH : 1;
}

/** Extra chance of a better picking — 0 or COMPOST_YIELD_BONUS. */
export function yieldBonus(soil: Soil): number {
  return soil.fertiliser === "compost" ? COMPOST_YIELD_BONUS : 0;
}

export function canSow(soil: Soil): boolean { return soil.tilled; }

/** Which of the soil's looks to show. The renderer keeps one mesh per look and
 *  instances it, so this is deliberately a small closed set. */
export type SoilLook = "bare" | "tilled" | "wet" | "fed" | "fedwet";

export function lookOf(soil: Soil): SoilLook {
  if (!soil.tilled) return "bare";
  const fed = soil.fertiliser !== "none";
  if (isWet(soil)) return fed ? "fedwet" : "wet";
  return fed ? "fed" : "tilled";
}

/** A short line for the HUD — what the ground would tell you if you knelt down. */
export function describeSoil(soil: Soil): string {
  if (!soil.tilled) return "unbroken ground";
  const feed = soil.fertiliser === "compost" ? ", composted" : soil.fertiliser === "mulch" ? ", mulched" : "";
  return isWet(soil) ? `watered${feed}` : `dry${feed}`;
}
