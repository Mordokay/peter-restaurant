// The material library. Six to begin with, spanning the range the rest will be built against: a run of
// boards, a tiled grid, a loose bed, a ploughed field, a living ground and a coursed wall.
//
// Colour rule, from ART_DIRECTION.md: architecture is the QUIET layer. Crops and food are "more saturated
// than architecture", and cyan, fresh green, amber, coral and gold are reserved for game state. So every
// tone here is low-saturation, and the tones within one material sit close together — a floor of boards
// that differ, not a floor of stripes.
//
// Two numbers govern everything, both learned by measuring against the real mesher:
//
//   * **Form comes from `bands`, not from relief.** Realistic relief is sub-cell at every pitch we can
//     afford, so a ploughed ridge whose only ridge is geometric is a flat brown field. Shade across the
//     feature instead and the furrows read from twenty-six metres.
//   * **A scatter's cluster must be several cells across** — at the 5 cm carpet, 0.2 m and up. Below that
//     it is per-cell noise by another name: it defeats the mesher's merging and it reads as pepper, which
//     is the "noisy texture" the art direction forbids. Coverage stays low; the freezer's frost sits at
//     0.10 to 0.26 and that is the busiest anything should get.
import type { SurfaceMaterial } from "./surfaces.ts";

/** Dining oak: wide boards, staggered butts, a dark gap between, the odd knot and a worn walking line. */
export const plankDining: SurfaceMaterial = {
  id: "plank_dining", name: "Dining oak",
  tones: ["#a8764a", "#a06f45", "#b07c4e", "#9c6a41", "#ab7950"],
  lattice: { kind: "rows", width: 0.14, length: 2.1, stagger: 0.37, along: "u" },
  joint: { color: "#6d4a2c", width: 0.014, depth: 0.012 },
  // A board is very slightly crowned, so its long edges sit a shade darker than its middle.
  bands: [{ from: 0.82, color: "#976a42" }],
  scatter: [
    { color: "#7d5432", coverage: 0.012, cluster: 0.16, where: "feature", salt: 23 },  // knots
    { color: "#b3835a", coverage: 0.07, cluster: 1.3, where: "feature", salt: 41 },    // a worn walking line
  ],
};

/** Quarry tile: warm terracotta squares, sanded grout, the odd tile fired darker than its neighbours. */
export const tileQuarry: SurfaceMaterial = {
  id: "tile_quarry", name: "Quarry tile",
  tones: ["#b9744e", "#b06d4a", "#c07d55", "#ab6846"],
  lattice: { kind: "grid", size: 0.3 },
  joint: { color: "#9c8a76", width: 0.022, depth: 0.012 },
  bands: [{ from: 0.88, color: "#a05f40" }],   // the fired edge of a tile
  scatter: [{ color: "#8f5a3d", coverage: 0.05, cluster: 0.3, where: "feature", salt: 17 }],
};

/** Gravel: a compacted bed, raked into broad tonal drifts. The pebbles that stand out of it are crust. */
export const gravelPath: SurfaceMaterial = {
  id: "gravel_path", name: "Gravel",
  tones: ["#a8a396"],
  patch: { scale: 0.8, tones: ["#a8a396", "#a19c8f", "#b0aa9d", "#9b968a"] },
  scatter: [
    { color: "#8d887d", coverage: 0.14, cluster: 0.26, salt: 31 },
    { color: "#bcb6a8", coverage: 0.09, cluster: 0.34, salt: 53 },
  ],
};

/** Tilled soil: corduroy ridges, dry and pale on the crown, dark and damp down in the furrow. */
export const soilTilled: SurfaceMaterial = {
  id: "soil_tilled", name: "Tilled soil",
  tones: ["#6b4a33"],
  lattice: { kind: "corduroy", pitch: 0.34, along: "u" },
  relief: { crown: 0.05 },
  bands: [
    { from: 0, color: "#7a5740" },      // the crown, dried by the sun
    { from: 0.42, color: "#6b4a33" },
    { from: 0.74, color: "#523825" },   // the furrow, still damp
  ],
  scatter: [
    { color: "#835f45", coverage: 0.06, cluster: 0.28, salt: 71 },   // clods drying on the ridges
    { color: "#46301f", coverage: 0.05, cluster: 0.35, salt: 61 },   // a wet patch
  ],
};

/** Lawn: broad drifts of green rather than speckle, worn paler where feet go. */
export const grassLawn: SurfaceMaterial = {
  id: "grass_lawn", name: "Grass",
  tones: ["#7ea563"],
  patch: { scale: 1.4, tones: ["#7ea563", "#779d5d", "#85ab69", "#719757"] },
  scatter: [
    { color: "#8fae6b", coverage: 0.15, cluster: 0.7, salt: 83 },
    { color: "#6b8f52", coverage: 0.11, cluster: 0.55, salt: 97 },
  ],
};

/** Coursed stone: rubble blocks in courses, deep mortar, lichen only in the joints. */
export const stoneCoursed: SurfaceMaterial = {
  id: "stone_coursed", name: "Coursed stone",
  tones: ["#8f8d87", "#89877f", "#97958e", "#838179", "#928f86"],
  lattice: { kind: "rows", width: 0.26, length: 0.62, stagger: 0.5, along: "u" },
  joint: { color: "#6f6d67", width: 0.035, depth: 0.02 },
  bands: [{ from: 0.76, color: "#7e7c75" }],   // blocks are worn round at their edges
  scatter: [
    { color: "#7d8a63", coverage: 0.12, cluster: 0.2, where: "joint", salt: 11 },    // lichen in the mortar
    { color: "#a5a29a", coverage: 0.06, cluster: 0.5, where: "feature", salt: 29 },  // a paler stone
  ],
};

export const surfaceLibrary: SurfaceMaterial[] = [
  plankDining, tileQuarry, gravelPath, soilTilled, grassLawn, stoneCoursed,
];

export const surfaceById = (id: string): SurfaceMaterial | undefined => surfaceLibrary.find((m) => m.id === id);
