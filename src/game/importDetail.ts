// Import detail tiers, shared by the lab's import panel (live estimate) and the
// dev server's import endpoint (the actual conversion). One knob for the artist:
// how many voxels the finished model may carry. The converter then picks the grid
// height that lands near that budget, never finer than the tier's voxel floor.
//
// Why a floor at all: a 12 cm beer can at "normal" would otherwise become a
// 160-voxel-tall model with sub-millimetre cubes — beautiful, and far too heavy
// to keep forty of on one shelf. Fine and Ultra lower the floor for small items
// that deserve it (the pantry collection); Chunky raises it for background props.

export type ImportDetail = "chunky" | "normal" | "fine" | "ultra";

export interface DetailTier {
  /** Voxels the finished model should land near (surface cells, fine-LOD weighted). */
  budget: number;
  /** Smallest base voxel in metres; fine details go to half of this. */
  minVoxel: number;
  /** Hard ceiling on grid height in voxels. Only thin, tall things (a 2.4 m pitchfork, a fence
   *  post) ever reach it — anything with real surface is coarsened by the budget long before.
   *  Grids are sparse, so a 400-tall grid costs nothing more than its voxels. */
  cap: number;
  label: string;
  hint: string;
}

export const DETAIL_TIERS: Record<ImportDetail, DetailTier> = {
  chunky: { budget: 60_000, minVoxel: 0.006, cap: 160, label: "Chunky", hint: "Background props and distant scenery. ~60k voxels, no cube smaller than 6 mm." },
  normal: { budget: 160_000, minVoxel: 0.003, cap: 256, label: "Normal", hint: "Furniture, plants, anything hand-sized or bigger. ~160k voxels, cubes down to 3 mm." },
  fine: { budget: 320_000, minVoxel: 0.0015, cap: 400, label: "Fine", hint: "Small items you look at closely (bottles, cans, cutlery). ~320k voxels, cubes down to 1.5 mm." },
  ultra: { budget: 900_000, minVoxel: 0.00075, cap: 640, label: "Ultra", hint: "Hero pieces only — four times the resolution of Normal. ~900k voxels, cubes down to 0.75 mm. Heavy in the game; do not use for a whole shelf." },
};

export const DETAIL_ORDER: ImportDetail[] = ["chunky", "normal", "fine", "ultra"];

export function isImportDetail(value: unknown): value is ImportDetail {
  return typeof value === "string" && value in DETAIL_TIERS;
}

/** A wide, flat footprint (a tray of foods) starts coarser — voxel count scales with the
 *  footprint, not just the height — so the first conversion pass stays sane. */
export function footprintFactor(footprint?: readonly number[]): number {
  if (!footprint || footprint.length < 3 || !(footprint[1]! > 0)) return 1;
  return Math.max(1, Math.sqrt((footprint[0]! * footprint[2]!) / (footprint[1]! * footprint[1]!)) / 2);
}

/** Fewest voxels tall a model may be. 16 for anything upright; flat, wide things (a cutting board
 *  1 cm thick and 60 cm wide, a plate, a knife lying down) may go down to 6, because forcing 16
 *  voxels across 1 cm makes 0.6 mm cubes over the whole 60 cm footprint — 800k voxels for a board. */
export function minVoxelHeight(metres: number, footprint?: readonly number[]): number {
  if (!footprint || footprint.length < 3) return 16;
  const widest = Math.max(footprint[0]!, footprint[2]!, metres);
  return Math.max(6, Math.min(16, Math.round((16 * 3 * metres) / widest)));
}

/** Clamp a grid height to what the tier allows for an object `metres` tall. */
export function clampVoxelHeight(height: number, metres: number, detail: ImportDetail, footprint?: readonly number[]): number {
  const tier = DETAIL_TIERS[detail];
  return Math.max(minVoxelHeight(metres, footprint), Math.min(tier.cap, Math.floor(metres / tier.minVoxel), Math.round(height)));
}

/** The grid height the converter tries first (before the budget loop refines it). */
export function initialVoxelHeight(metres: number, detail: ImportDetail, footprint?: readonly number[]): number {
  const guessPitch = metres > 1.5 ? 0.04 : metres > 0.8 ? 0.012 : 0.006;
  return clampVoxelHeight(metres / guessPitch / footprintFactor(footprint), metres, detail, footprint);
}

/** What the panel shows before converting: the finest grid the tier permits for this
 *  height. The budget loop may coarsen it if the object has a lot of surface. */
export function estimateImport(metres: number, detail: ImportDetail, footprint?: readonly number[]): { voxelHeight: number; voxelSize: number; fineSize: number; budget: number } {
  const tier = DETAIL_TIERS[detail];
  const voxelHeight = Math.max(minVoxelHeight(metres, footprint), Math.min(tier.cap, Math.floor(metres / tier.minVoxel)));
  return { voxelHeight, voxelSize: metres / voxelHeight, fineSize: metres / voxelHeight / 2, budget: tier.budget };
}
