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
  id: "plank_dining", name: "Dining oak", pitch: 0.025,
  tones: ["#a8764a", "#a06f45", "#b07c4e", "#9c6a41", "#ab7950"],
  lattice: { kind: "rows", width: 0.14, length: 2.1, stagger: 0.37, along: "u" },
  joint: { color: "#6d4a2c", width: 0.016, depth: 0.025 },   // one cell deep: a groove you can see
  relief: { jitter: 0.018 },                                 // reclaimed boards do not lie perfectly flush
  // A board is very slightly crowned, so its long edges sit a shade darker than its middle.
  bands: [{ from: 0.82, color: "#976a42" }],
  scatter: [
    { color: "#7d5432", coverage: 0.012, cluster: 0.16, where: "feature", salt: 23 },  // knots
    { color: "#b3835a", coverage: 0.07, cluster: 1.3, where: "feature", salt: 41 },    // a worn walking line
  ],
};

/** Quarry tile: warm terracotta squares, sanded grout, the odd tile fired darker than its neighbours. */
export const tileQuarry: SurfaceMaterial = {
  id: "tile_quarry", name: "Quarry tile", pitch: 0.025,
  tones: ["#b9744e", "#b06d4a", "#c07d55", "#ab6846"],
  lattice: { kind: "grid", size: 0.3 },
  joint: { color: "#9c8a76", width: 0.022, depth: 0.025 },
  relief: { jitter: 0.014 },   // a hand-laid floor is never dead level
  bands: [{ from: 0.88, color: "#a05f40" }],   // the fired edge of a tile
  scatter: [{ color: "#8f5a3d", coverage: 0.05, cluster: 0.3, where: "feature", salt: 17 }],
};

/** Gravel: a raked bed in broad tonal drifts, with the stones themselves standing on it as crust.
 *
 *  The stones were tried as a Voronoi carpet first and measured 1,200 triangles a square metre against
 *  18 for a tiled floor. The reason generalises: triangles track the number of FEATURES per square metre,
 *  and an irregular cell costs roughly thirteen times a square one, because a rectangle-greedy mesher
 *  covers a tile with one quad and a Voronoi cell with a dozen. So stones live in the crust, where the
 *  detail radius bounds how many exist at once. */
export const gravelPath: SurfaceMaterial = {
  id: "gravel_path", name: "Gravel", pitch: 0.05,
  tones: ["#a8a396"],
  patch: { scale: 0.8, tones: ["#a8a396", "#a19c8f", "#b0aa9d", "#9b968a"] },
  scatter: [
    { color: "#8d887d", coverage: 0.14, cluster: 0.26, salt: 31 },
    { color: "#bcb6a8", coverage: 0.09, cluster: 0.34, salt: 53 },
  ],
  // Stones on the bed. Measured: a lean of 0.22 and 2 cm cells cost 1,036 triangles a square metre;
  // these cost 129, because a pebble three cells across still merges and one cell across never can.
  crust: {
    density: 14, salt: 5, pitch: 0.03, drift: { scale: 1.2, swing: 1.5 },
    forms: [
      { kind: "pebble", radius: [0.02, 0.035], height: [0.014, 0.024], tones: ["#9d988c", "#8c877c", "#b3ada0"] },
      { kind: "pebble", radius: [0.028, 0.045], height: [0.018, 0.032], tones: ["#a8a396", "#7f7a70", "#c0b9ab"] },
      { kind: "pebble", radius: [0.022, 0.05], height: [0.015, 0.036], tones: ["#918c81", "#aaa497", "#6f6b62"] },
    ],
  },
};

/** Tilled soil: corduroy ridges, dry and pale on the crown, dark and damp down in the furrow. */
export const soilTilled: SurfaceMaterial = {
  id: "soil_tilled", name: "Tilled soil", pitch: 0.05,
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
  id: "grass_lawn", name: "Grass", pitch: 0.05,
  tones: ["#7ea563"],
  patch: { scale: 1.4, tones: ["#7ea563", "#779d5d", "#85ab69", "#719757"] },
  scatter: [
    { color: "#8fae6b", coverage: 0.15, cluster: 0.7, salt: 83 },
    { color: "#6b8f52", coverage: 0.11, cluster: 0.55, salt: 97 },
  ],
  // Six silhouettes at three heights, thinning and thickening across the ground: a lawn that has been
  // walked on, not a carpet. These are the blades that will take the wind.
  // Six silhouettes over four families, thinning and thickening across the ground: a lawn that has been
  // walked on, not a carpet. A blade that leans a long way is a staircase of isolated cells and costs
  // three times one that leans a little — 1,521 triangles a square metre against 427 — so they lean less
  // than they might, and the wind will do the rest of the work later.
  // Full density, everywhere. Blades are GPU instances of a few prototype columns (grassInstances.ts), so
  // ninety thousand of them are a handful of draw calls and the density is no longer a budget question.
  // Six silhouettes over four families so no two clumps share one.
  crust: {
    density: 5, salt: 9, pitch: 0.02, drift: { scale: 1.8, swing: 1.7 },
    forms: [
      { kind: "tuft", blades: [3, 6], height: [0.05, 0.1], lean: 0.05, tones: ["#87ae66", "#7aa25c", "#93b972"] },
      { kind: "tuft", blades: [4, 8], height: [0.08, 0.16], lean: 0.07, tones: ["#7ea563", "#719757", "#8cb36c"] },
      { kind: "tuft", blades: [3, 5], height: [0.13, 0.26], lean: 0.06, tones: ["#9db978", "#88a866", "#6f9455"] },
      { kind: "tuft", blades: [5, 9], height: [0.04, 0.08], lean: 0.09, tones: ["#6d9053", "#7fa361"] },
    ],
  },
};

/** Coursed stone: rubble blocks in courses, deep mortar, lichen only in the joints. */
export const stoneCoursed: SurfaceMaterial = {
  id: "stone_coursed", name: "Coursed stone", pitch: 0.025,
  tones: ["#8f8d87", "#89877f", "#97958e", "#838179", "#928f86"],
  lattice: { kind: "rows", width: 0.26, length: 0.62, stagger: 0.5, along: "u" },
  joint: { color: "#6f6d67", width: 0.035, depth: 0.05 },    // two cells: rubble mortar is deep
  relief: { jitter: 0.02 },                                  // and no two stones sit at the same depth
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
