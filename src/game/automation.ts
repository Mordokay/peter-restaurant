// Devices that do the boring half of farming.
//
// The problem this exists for, in the brief's own words: a late-game player with
// a thousand crops spends half the day holding a button and walking. Stardew's
// own answer is sprinklers; Coral Island's is seed attachments and a tractor.
// The principle either way is that automation removes the REPETITION and leaves
// the decisions — where to plant, what to plant, when to expand — because those
// are the parts anyone would miss.
//
// So a sprinkler waters its four neighbours on a timer, and a seeder re-sows
// them. Neither does anything the player could not do; both do it while the
// player is somewhere else.
//
// Pure: which plots a device covers, and what it would do to each.
import { isSpent, cropById, type PlantedCrop } from "./crops.ts";
import { PLOT_SPACING, type PlotSite } from "./farm.ts";
import { canSow, isWet, type Soil } from "./soil.ts";

export type DeviceKind = "sprinkler" | "seeder";

export interface Device {
  kind: DeviceKind;
  /** Plot the device stands on. */
  plot: string;
  /** For a seeder: what it puts in the ground. */
  crop?: string;
  /** Quarter turns it was set down at. */
  turn?: number;
}

/** Seconds between passes. Slower than a player would be, on purpose: a device
 *  should be worth having and never worth watching. */
export const DEVICE_PERIOD = 45;

/** Catalog models, which are also what the player carries. */
export const DEVICE_MODELS: Record<DeviceKind, string> = { sprinkler: "item_sprinkler", seeder: "item_seeder" };

/** The four plots around this one. A cross rather than a square: the square is
 *  the upgrade a later tier can be, and starting there would leave nothing to
 *  give the player later. */
export function covered(site: PlotSite, sites: readonly PlotSite[]): PlotSite[] {
  const reach = PLOT_SPACING * 1.15;
  return sites.filter((candidate) => {
    if (candidate.id === site.id) return false;
    const dx = Math.abs(candidate.x - site.x);
    const dz = Math.abs(candidate.z - site.z);
    // Axis-aligned neighbours only, which is what makes the cross a cross.
    return (dx < 0.05 && dz < reach) || (dz < 0.05 && dx < reach);
  });
}

export type DeviceJob = "water" | "sow" | "none";

/** What a device would do to one plot it covers. */
export function jobFor(device: Device, soil: Soil, planted: PlantedCrop | null): DeviceJob {
  if (device.kind === "sprinkler") {
    // Watering unbroken ground is watering a path. A sprinkler serves a bed.
    if (!soil.tilled || isWet(soil)) return "none";
    return "water";
  }
  // A seeder fills gaps: broken, empty ground, and only where it has a crop to
  // put in. It never replaces something growing, even a spent plant — pulling
  // up a bush the player has not finished with is not automation, it is theft.
  if (planted) return "none";
  if (!canSow(soil) || !device.crop || !cropById(device.crop)) return "none";
  return "sow";
}

/** Whether this plant is finished and standing in a seeder's way. Kept separate
 *  from `jobFor` so the caller decides whether clearing is allowed. */
export function blocksSeeder(planted: PlantedCrop | null): boolean {
  if (!planted) return false;
  const crop = cropById(planted.crop);
  return Boolean(crop && isSpent(crop, planted));
}

/** A line for the HUD when the player points at a device. */
export function describeDevice(device: Device): string {
  if (device.kind === "sprinkler") return "sprinkler · waters the four beds around it";
  const crop = device.crop ? cropById(device.crop)?.name : undefined;
  return crop ? `seeder · sows ${crop}` : "seeder · sow something first and it will copy you";
}
