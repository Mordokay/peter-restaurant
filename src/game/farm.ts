// The farm as data: where a plant can stand, what is standing there, and what
// pressing the action key on it would do.
//
// Pure, like crops.ts, so the whole thing can be reasoned about and tested
// without a scene. The renderer (farmPlots.ts) owns meshes and nothing else.
//
// Plot sites are DERIVED from the level's farm areas rather than authored, so
// buying another parcel adds plots without anybody editing a list, and a plot's
// id stays stable as long as the area does — which is what lets a save name a
// plot and find it again.
import { cropById, growthLeft, harvestsLeft, isReady, isSpent, type CropDefinition, type PlantedCrop } from "./crops.ts";
import { describeSoil, isWet, type Soil } from "./soil.ts";
import type { VersionedSave } from "./persistence.ts";

/** One place a plant can stand. */
export interface PlotSite {
  /** `<areaId>:<col>,<row>` — stable across sessions. */
  id: string;
  area: string;
  x: number;
  z: number;
}

/** The world is a one-metre grid, and a plot is one cell of it.
 *
 *  One metre rather than the old 1.2, and snapped to the WORLD rather than
 *  centred in each parcel: beds now tile edge to edge, across parcel boundaries
 *  as well as within them, which is what lets the player lay a solid field
 *  instead of a polka-dot pattern. Everything placed on the ground shares this
 *  lattice, so a bed, a sprinkler and a plant can never be half a cell out from
 *  each other. */
export const PLOT_SPACING = 1;
/** Bare border kept inside a parcel's edge, so a bed never overhangs the soil. */
export const PLOT_MARGIN = 0.5;

/** The grid cell a world point falls in. */
export function cellOf(x: number, z: number): { gx: number; gz: number } {
  return { gx: Math.floor(x / PLOT_SPACING), gz: Math.floor(z / PLOT_SPACING) };
}

/** The middle of a cell, which is where anything standing in it stands. */
export function cellCentre(gx: number, gz: number): { x: number; z: number } {
  return { x: (gx + 0.5) * PLOT_SPACING, z: (gz + 0.5) * PLOT_SPACING };
}

/** A plot's stable id. Global, because a plot is a place in the WORLD and not a
 *  place in a parcel: re-drawing a parcel must not rename the ground inside it. */
export function plotId(gx: number, gz: number): string {
  return `plot:${gx},${gz}`;
}

export interface AreaRect {
  id: string;
  zone: string;
  /** [x, z, width, depth]. */
  rect: readonly [number, number, number, number];
}

/** Every plot of every farm area, in a stable order. */
export function plotSites(areas: readonly AreaRect[], options: { margin?: number; zone?: string } = {}): PlotSite[] {
  const margin = options.margin ?? PLOT_MARGIN;
  const zone = options.zone ?? "farm";
  const sites: PlotSite[] = [];
  const seen = new Set<string>();
  for (const area of areas) {
    if (area.zone !== zone) continue;
    const [x, z, width, depth] = area.rect;
    const first = cellOf(x + margin, z + margin);
    const last = cellOf(x + width - margin, z + depth - margin);
    for (let gz = first.gz; gz <= last.gz; gz++) {
      for (let gx = first.gx; gx <= last.gx; gx++) {
        const centre = cellCentre(gx, gz);
        // Whole cells only: half a bed hanging over the path is not a plot.
        if (centre.x - PLOT_SPACING / 2 < x || centre.x + PLOT_SPACING / 2 > x + width) continue;
        if (centre.z - PLOT_SPACING / 2 < z || centre.z + PLOT_SPACING / 2 > z + depth) continue;
        const id = plotId(gx, gz);
        // Parcels can abut; a cell belongs to whichever claims it first.
        if (seen.has(id)) continue;
        seen.add(id);
        sites.push({ id, area: area.id, x: centre.x, z: centre.z });
      }
    }
  }
  return sites;
}

/** The plot a player standing at (x, z) is addressing, or null when none is near
 *  enough. Ties go to the closer one; equal distances to the earlier plot, so
 *  the choice never flickers between two plots at the same range. */
export function nearestSite(sites: readonly PlotSite[], x: number, z: number, maxDistance: number): PlotSite | null {
  let best: PlotSite | null = null;
  let bestDistance = maxDistance * maxDistance;
  for (const site of sites) {
    const dx = site.x - x;
    const dz = site.z - z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) { best = site; bestDistance = distance; }
  }
  return best;
}

/** What the action key does on this plot right now. One key does everything the
 *  plot can offer, because a farm where the player has to pick a verb before
 *  touching a plant is a menu with soil under it.
 *
 *  `clear` is deliberately rare: a crop that runs out of harvests is taken with
 *  the last one, so replanting is just sowing again rather than a chore. What is
 *  left for clearing is the leftovers — a plant whose crop no longer exists in
 *  the game, and later anything that dies in the ground. */
export type PlotAction = "till" | "sow" | "harvest" | "clear" | "growing";

export function actionFor(planted: PlantedCrop | null, soil: Soil): PlotAction {
  if (!planted) return soil.tilled ? "sow" : "till";
  const crop = cropById(planted.crop);
  if (!crop) return "clear";
  if (isSpent(crop, planted)) return "clear";
  return isReady(crop, planted) ? "harvest" : "growing";
}

/** Seconds of WATERED growing this plot still needs, or null when it is ready or
 *  empty. In dry ground that is a distance, not a countdown, which is exactly
 *  what the player should feel when they forget the watering can. */
export function growthRemaining(planted: PlantedCrop | null): number | null {
  if (!planted) return null;
  const crop = cropById(planted.crop);
  if (!crop || isSpent(crop, planted) || isReady(crop, planted)) return null;
  return growthLeft(crop, planted);
}

/** How many plants of this crop are in the ground, spent ones included. */
export function countPlanted(plots: Readonly<Record<string, PlantedCrop>>, crop: string): number {
  let count = 0;
  for (const planted of Object.values(plots)) if (planted.crop === crop) count++;
  return count;
}

export const FARM_SAVE_KEY = "farm-save";
export const FARM_SAVE_VERSION = 1;

/** Everything the farm needs to come back exactly as it was left. The clock is
 *  saved with it: growth is measured in game seconds, so a plot sown just before
 *  a reload must not arrive fully grown because the clock restarted at zero. */
export interface FarmSave extends VersionedSave {
  version: typeof FARM_SAVE_VERSION;
  clock: number;
  plots: Record<string, PlantedCrop>;
  /** Ground state per plot: broken, wet, fed. */
  soils?: Record<string, Soil>;
  /** What the player is carrying. */
  inventory: string[];
  /** What has been tipped into the crate at the edge of the farm. */
  crate: string[];
  /** The compost bin: loose scraps, batches rotting, compost ready. */
  heap?: { loose: number; rotting: { left: number }[]; ready: number };
  /** Sprinklers and seeders standing on the farm, by plot. */
  devices?: Record<string, { kind: "sprinkler" | "seeder"; plot: string; crop?: string }>;
  /** What the player last sowed, which is what a seeder copies. */
  lastSown?: string | null;
  /** The prep counter: what is on its board, what is on its plate, what is
   *  half-made. Shaped by prepStation.ts; kept here because one save is easier
   *  to reason about than three. */
  prep?: { ingredients: string[]; dish: string | null; working: { recipe: string; left: number } | null };
}

/** Drop plots whose site no longer exists (a parcel was re-drawn) and plants of
 *  crops that no longer exist, rather than letting either resurrect as a ghost.
 *
 *  Also repairs plants saved by an older build. Growth used to be a pair of
 *  timestamps and is now banked seconds; a record from before that change has no
 *  `grown` at all, and reading one straight through put `NaN` on the HUD. Such a
 *  plant is restarted rather than discarded — losing a plot's progress is a far
 *  smaller betrayal than losing the plot. */
export function restorePlots(saved: Readonly<Record<string, PlantedCrop>>, sites: readonly PlotSite[]): Record<string, PlantedCrop> {
  const known = new Set(sites.map((site) => site.id));
  const restored: Record<string, PlantedCrop> = {};
  const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  for (const [id, planted] of Object.entries(saved)) {
    if (!known.has(id) || !cropById(planted.crop)) continue;
    restored[id] = {
      crop: planted.crop,
      grown: number(planted.grown),
      regrown: number(planted.regrown),
      harvested: number(planted.harvested),
    };
  }
  return restored;
}

/** A one-line reading of a plot for the HUD: what it is and how it is doing. */
export function describePlot(planted: PlantedCrop | null, soil: Soil): string {
  if (!planted) return describeSoil(soil);
  const crop = cropById(planted.crop) as CropDefinition | undefined;
  if (!crop) return "unknown crop";
  const action = actionFor(planted, soil);
  if (action === "clear") return `${crop.name} · spent`;
  if (action === "harvest") {
    // The count is only worth showing where it can go down: a lettuce is cut
    // once and a strawberry is picked forever, and neither has a number to watch.
    const left = harvestsLeft(crop, planted);
    const countable = crop.harvests > 1 && Number.isFinite(crop.harvests);
    return `${crop.name} · ready${countable ? ` (${left} left)` : ""}`;
  }
  // A dry plot says so rather than counting down a clock that is not running.
  const wait = growthRemaining(planted) ?? 0;
  return isWet(soil) ? `${crop.name} · ${Math.ceil(wait)}s` : `${crop.name} · dry, not growing`;
}
