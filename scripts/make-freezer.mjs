// Authors the upright vegetable freezer straight into the catalog — no mesh, no import, no licence.
//
// This is the test of writing a real prop as voxel data: a hinged glass door that is genuinely
// translucent, an interior light that flickers on as the door swings, wire shelves, labelled produce
// that can be emptied shelf by shelf to show what is actually in stock, and cold vapour that spills out
// of the opening. Everything is parametric, so a second size or a different fill is a few numbers.
//
//   node scripts/make-freezer.mjs [--id freezer_upright] [--dry]
//
// Geometry is written as boxes (inclusive corners) and loose voxels; see src/game/voxelModel.ts.
import { writeModel } from "./catalog-io.mjs";

const PITCH = 0.02;                 // 2 cm cells
const W = 44, H = 94, D = 37;       // 0.90 × 1.90 × 0.76 m
const SHELL = 2;                    // shell thickness in cells (0.06 m with the liner)
const FRONT = 0, BACK = D;          // the door faces -z

const palette = {
  steel: "#c6ccd2",
  steel_dark: "#9aa2aa",
  steel_shadow: "#7b838b",
  seal: "#5f666d",
  liner: "#eef4f7",
  frost: "#d7e8f2",
  glass: "#cfe9f5",
  wire: "#98a1a8",
  glow: "#eaf6ff",
  crate: "#b1874f",
  crate_dark: "#8f6b3c",
  pea: "#6aa84f",
  pea_dark: "#558a3e",
  carrot: "#e07b39",
  carrot_top: "#4f7a3a",
  broccoli: "#4d7c39",
  broccoli_stem: "#86a86a",
  berry: "#b3332f",
  berry_dark: "#8d2622",
  label: "#f2e6cc",
};

/** Deterministic 0..1 noise so the produce looks scattered but is identical on every run. */
function hash(x, y, z, salt = 0) {
  let h = Math.imul(x + 0x9e37 + salt, 0x85ebca6b) ^ Math.imul(y + 0x79b9, 0xc2b2ae35) ^ Math.imul(z + 0x1b87, 0x27d4eb2f);
  h ^= h >>> 13;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const box = (x0, y0, z0, x1, y1, z1, key) => [x0, y0, z0, x1, y1, z1, key];

/** A hollow rectangular shell: six slabs with the front left open for the door. */
function cabinet() {
  const boxes = [];
  boxes.push(box(0, 0, FRONT, W, SHELL + 2, BACK, "steel_dark"));          // plinth
  boxes.push(box(0, H - SHELL, FRONT, W, H, BACK, "steel"));               // top
  boxes.push(box(0, SHELL + 3, FRONT, SHELL, H - SHELL - 1, BACK, "steel"));      // left wall
  boxes.push(box(W - SHELL, SHELL + 3, FRONT, W, H - SHELL - 1, BACK, "steel"));  // right wall
  boxes.push(box(SHELL + 1, SHELL + 3, BACK - SHELL, W - SHELL - 1, H - SHELL - 1, BACK, "steel")); // back
  // Bright liner inside, so the interior reads cold and lit rather than grey.
  boxes.push(box(SHELL + 1, SHELL + 3, FRONT + 1, W - SHELL - 1, SHELL + 4, BACK - SHELL - 1, "liner")); // floor
  boxes.push(box(SHELL + 1, SHELL + 4, BACK - SHELL - 1, W - SHELL - 1, H - SHELL - 2, BACK - SHELL, "liner")); // back
  boxes.push(box(SHELL, SHELL + 4, FRONT + 1, SHELL + 1, H - SHELL - 2, BACK - SHELL - 1, "liner")); // left
  boxes.push(box(W - SHELL - 1, SHELL + 4, FRONT + 1, W - SHELL, H - SHELL - 2, BACK - SHELL - 1, "liner")); // right
  boxes.push(box(SHELL + 1, H - SHELL - 2, FRONT + 1, W - SHELL - 1, H - SHELL - 1, BACK - SHELL - 1, "liner")); // ceiling
  // Door seal around the opening, and a kick strip at the foot.
  boxes.push(box(SHELL, SHELL + 3, FRONT, SHELL + 1, H - SHELL - 1, FRONT + 1, "seal"));
  boxes.push(box(W - SHELL - 1, SHELL + 3, FRONT, W - SHELL, H - SHELL - 1, FRONT + 1, "seal"));
  boxes.push(box(SHELL, SHELL + 3, FRONT, W - SHELL, SHELL + 4, FRONT + 1, "seal"));
  boxes.push(box(SHELL, H - SHELL - 2, FRONT, W - SHELL, H - SHELL - 1, FRONT + 1, "seal"));
  boxes.push(box(2, 2, FRONT - 1, W - 2, 5, FRONT, "steel_shadow"));
  // Frost creeping along the inside corners.
  const voxels = [];
  for (let y = SHELL + 5; y < H - SHELL - 3; y += 1) {
    for (const x of [SHELL + 1, W - SHELL - 2]) {
      if (hash(x, y, 0, 11) > 0.72) voxels.push([x, y, BACK - SHELL - 1, "frost"]);
    }
    if (hash(0, y, 0, 12) > 0.85) voxels.push([SHELL + 1, y, FRONT + 2, "frost"]);
  }
  return { boxes, voxels };
}

/** One wire shelf: a frame with slats, so it reads as a rack rather than a slab. */
function shelf(y) {
  const boxes = [box(SHELL + 1, y, FRONT + 2, W - SHELL - 1, y + 1, BACK - SHELL - 1, "wire")];
  return { boxes };
}

/** The door: an opaque frame with a translucent panel, hinged down its left edge. */
function doorFrame() {
  const x0 = SHELL, x1 = W - SHELL, y0 = SHELL + 3, y1 = H - SHELL - 1;
  const boxes = [
    box(x0, y0, FRONT - 3, x0 + 4, y1, FRONT - 1, "steel_dark"),          // hinge stile
    box(x1 - 4, y0, FRONT - 3, x1, y1, FRONT - 1, "steel_dark"),          // handle stile
    box(x0, y0, FRONT - 3, x1, y0 + 4, FRONT - 1, "steel_dark"),          // bottom rail
    box(x0, y1 - 4, FRONT - 3, x1, y1, FRONT - 1, "steel_dark"),          // top rail
    box(x0 + 3, y0 + 3, FRONT - 2, x1 - 3, y1 - 3, FRONT - 1, "steel_shadow"), // reveal behind the glass
    box(x0 + 1, y0 + 1, FRONT - 1, x1 - 1, y1 - 1, FRONT, "seal"),   // gasket facing the cabinet
  ];
  return { boxes };
}
/** The glass panel. Its own part so it can be translucent while the frame stays solid. */
function doorGlass() {
  return { boxes: [box(SHELL + 4, SHELL + 7, FRONT - 3, W - SHELL - 4, H - SHELL - 5, FRONT - 1, "glass")] };
}
function doorHandle() {
  return {
    boxes: [
      box(W - SHELL - 7, 38, FRONT - 6, W - SHELL - 4, 62, FRONT - 4, "steel_dark"),
      box(W - SHELL - 7, 38, FRONT - 5, W - SHELL - 5, 41, FRONT - 3, "steel_dark"),
      box(W - SHELL - 7, 59, FRONT - 5, W - SHELL - 5, 62, FRONT - 3, "steel_dark"),
    ],
  };
}

/** The light bar under the ceiling. `base` is the dark tube; the `on` state glows. */
function lightBar(key) {
  return { boxes: [box(SHELL + 4, H - SHELL - 4, FRONT + 3, W - SHELL - 4, H - SHELL - 3, BACK - SHELL - 3, key)] };
}

/** A shallow produce crate with a paper label. */
function crate(x0, y0, z0, width, depth) {
  const height = 7;
  const boxes = [
    box(x0, y0, z0, x0 + width, y0 + 1, z0 + depth, "crate_dark"),
    box(x0, y0, z0, x0 + 1, y0 + height, z0 + depth, "crate"),
    box(x0 + width - 1, y0, z0, x0 + width, y0 + height, z0 + depth, "crate"),
    box(x0, y0, z0, x0 + width, y0 + height, z0 + 1, "crate"),
    box(x0, y0, z0 + depth - 1, x0 + width, y0 + height, z0 + depth, "crate"),
    box(x0 + 2, y0 + 2, z0 - 1, x0 + width - 2, y0 + 5, z0, "label"),
  ];
  return { boxes };
}

/** Loose produce heaped in a tray: a scatter of cells that still reads as a pile. */
function heap(x0, y0, z0, width, depth, height, keys, salt) {
  const voxels = [];
  for (let x = x0; x < x0 + width; x++) {
    for (let z = z0; z < z0 + depth; z++) {
      const n = hash(x, 0, z, salt);
      const top = y0 + Math.max(1, Math.round(height * (0.55 + n * 0.45)));
      for (let y = y0; y < top; y++) {
        const pick = hash(x, y, z, salt + 7);
        voxels.push([x, y, z, keys[Math.floor(pick * keys.length) % keys.length]]);
      }
    }
  }
  return { voxels };
}

/** Carrots lying in rows, with a green top on each. */
function carrots(x0, y0, z0, count) {
  const voxels = [];
  for (let i = 0; i < count; i++) {
    const z = z0 + i * 3;
    const length = 9 + Math.round(hash(i, 0, 0, 31) * 5);
    const y = y0 + (i % 2);
    for (let x = x0; x < x0 + length; x++) voxels.push([x, y, z, "carrot"]);
    voxels.push([x0 + length, y, z, "carrot_top"], [x0 + length + 1, y, z, "carrot_top"]);
  }
  return { voxels };
}

/** Broccoli: a pale stem under a rounded dark head. */
function broccoli(x0, y0, z0, count) {
  const voxels = [];
  for (let i = 0; i < count; i++) {
    const x = x0 + i * 7;
    const z = z0 + (i % 2) * 4;
    for (let y = y0; y < y0 + 3; y++) voxels.push([x + 2, y, z + 2, "broccoli_stem"]);
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        for (let dy = 0; dy < 3; dy++) {
          const edge = (dx === 0 || dx === 4) && (dz === 0 || dz === 4);
          if (edge && dy === 2) continue;
          if (hash(x + dx, y0 + dy, z + dz, 41) > 0.9) continue;
          voxels.push([x + dx, y0 + 3 + dy, z + dz, "broccoli"]);
        }
      }
    }
  }
  return { voxels };
}

const merge = (...pieces) => ({
  boxes: pieces.flatMap((piece) => piece.boxes ?? []),
  voxels: pieces.flatMap((piece) => piece.voxels ?? []),
});
const part = (id, geometry, extra = {}) => {
  const entry = { id, pivot: extra.pivot ?? [0, 0, 0], ...extra };
  delete entry.pivot;
  const out = { id, pivot: extra.pivot ?? [0, 0, 0] };
  if (geometry.boxes?.length) out.boxes = geometry.boxes;
  if (geometry.voxels?.length) out.voxels = geometry.voxels;
  for (const [key, value] of Object.entries(extra)) if (key !== "pivot") out[key] = value;
  return out;
};

const SHELF_Y = [26, 48, 70];
const parts = [
  part("body", cabinet()),
  part("shelf_low", shelf(SHELF_Y[0])),
  part("shelf_mid", shelf(SHELF_Y[1])),
  part("shelf_high", shelf(SHELF_Y[2])),
  // The light tube: dark at rest, glowing in its "on" state, switched by the open and close clips.
  part("light_bar", lightBar("steel_shadow"), { parent: "body", states: { on: { boxes: lightBar("glow").boxes } } }),
  // The door swings about its hinge stile; the glass and handle ride with it.
  part("door", doorFrame(), { parent: "body", pivot: [SHELL, SHELF_Y[0], FRONT - 1] }),
  part("door_glass", doorGlass(), { parent: "door", pivot: [SHELL, SHELF_Y[0], FRONT - 1], transform: { opacity: 0.34 } }),
  part("door_handle", doorHandle(), { parent: "door", pivot: [SHELL, SHELF_Y[0], FRONT - 1] }),
  // Produce. Each has an "empty" state, so the game can show what the freezer is actually holding.
  part("veg_peas", merge(crate(SHELL + 3, SHELF_Y[0] + 1, FRONT + 5, 16, 22), heap(SHELL + 5, SHELF_Y[0] + 3, FRONT + 7, 12, 18, 5, ["pea", "pea_dark"], 3)),
    { parent: "body", states: { empty: {} } }),
  part("veg_berries", merge(crate(W - SHELL - 20, SHELF_Y[0] + 1, FRONT + 5, 16, 22), heap(W - SHELL - 18, SHELF_Y[0] + 3, FRONT + 7, 12, 18, 4, ["berry", "berry_dark"], 5)),
    { parent: "body", states: { empty: {} } }),
  part("veg_carrots", carrots(SHELL + 4, SHELF_Y[1] + 1, FRONT + 6, 8), { parent: "body", states: { empty: {} } }),
  part("veg_broccoli", broccoli(SHELL + 4, SHELF_Y[2] + 1, FRONT + 8, 5), { parent: "body", states: { empty: {} } }),
];

const clips = [
  {
    id: "open",
    name: "Open the door",
    duration: 1.1,
    tracks: [
      { part: "door", keys: [
        { t: 0, rotation: [0, 0, 0], ease: "out" },
        { t: 0.12, rotation: [0, -8, 0], ease: "out" },
        { t: 1.1, rotation: [0, -108, 0], ease: "out" },
      ] },
      // The tube stutters before it settles, the way a cold fluorescent does.
      { part: "light_bar", keys: [
        { t: 0, state: "base", ease: "step" },
        { t: 0.14, state: "on", ease: "step" },
        { t: 0.2, state: "base", ease: "step" },
        { t: 0.26, state: "on", ease: "step" },
        { t: 0.34, state: "base", ease: "step" },
        { t: 0.4, state: "on", ease: "step" },
      ] },
    ],
    events: [
      { t: 0.12, name: "freezer_open", emit: "vapour", emitAction: "burst" },
      { t: 0.3, name: "freezer_fog", emit: "vapour_drift", emitAction: "start" },
      { t: 1.05, name: "freezer_open_done" },
    ],
  },
  {
    id: "close",
    name: "Close the door",
    duration: 0.85,
    tracks: [
      { part: "door", keys: [
        { t: 0, rotation: [0, -108, 0], ease: "in" },
        { t: 0.7, rotation: [0, -4, 0], ease: "in" },
        { t: 0.85, rotation: [0, 0, 0], ease: "out" },
      ] },
      { part: "light_bar", keys: [
        { t: 0, state: "on", ease: "step" },
        { t: 0.72, state: "base", ease: "step" },
      ] },
    ],
    events: [
      { t: 0.02, name: "freezer_closing", emit: "vapour_drift", emitAction: "stop" },
      { t: 0.72, name: "freezer_closed" },
    ],
  },
];

const model = {
  id: process.argv.includes("--id") ? process.argv[process.argv.indexOf("--id") + 1] : "freezer_upright",
  name: "Upright Freezer",
  folder: "kitchen/cold",
  tags: ["kitchen", "appliance", "storage", "cold"],
  pitch: PITCH,
  palette,
  parts,
  clips,
  // The tube's "on" geometry is the only thing that glows, so the interior lights up with the state.
  emissive: { glow: 1.5 },
  lights: [{
    position: [Math.round(W / 2), H - SHELL - 6, Math.round(D / 2)],
    color: "#cfe7ff", intensity: 1.1, range: 3.2,
    // Only lit while the tube is on, so a closed freezer is dark.
    whenState: { part: "light_bar", state: "on" },
  }],
  emitters: [
    {
      // The puff that rolls out the moment the door cracks open: fine and wide, not a column of cubes.
      id: "vapour", part: "body", position: [Math.round(W / 2), SHELF_Y[1], FRONT - 3],
      colors: ["#eaf4fa", "#dbeaf4", "#cfe2ef"], size: 2, alpha: 0.34,
      mode: "burst", count: 70, direction: [0, -0.5, -1], spread: 78,
      speed: [0.5, 1.5], life: [1.0, 2.0],
      // Cold air is heavier than the room, so the fog sinks and spreads instead of rising like steam.
      gravity: 0.25, drag: 2.2, bounce: 0, friction: 0.9, fade: true, spin: false,
    },
    {
      // The slow spill over the threshold while the door stands open.
      id: "vapour_drift", part: "body", position: [Math.round(W / 2), SHELF_Y[0] - 10, FRONT - 4],
      colors: ["#eaf4fa", "#dfeef6"], size: 2, alpha: 0.26,
      mode: "continuous", rate: 26, duration: 0, count: 8, direction: [0, -0.8, -1], spread: 66,
      speed: [0.28, 0.75], life: [1.6, 2.8],
      gravity: 0.3, drag: 2.6, bounce: 0, friction: 0.92, fade: true, spin: false,
    },
  ],
};

// Centre the whole model on x and z and stand it on y = 0, so it drops into the world by its base
// centre like every other prop, and the lab frames it properly.
function centreModel(modelParts, lights, emitters) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const see = (x, y, z) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  };
  const walk = (geometry) => {
    for (const b of geometry.boxes ?? []) { see(b[0], b[1], b[2]); see(b[3], b[4], b[5]); }
    for (const v of geometry.voxels ?? []) see(v[0], v[1], v[2]);
  };
  for (const entry of modelParts) { walk(entry); for (const state of Object.values(entry.states ?? {})) walk(state); }
  const dx = -Math.round((minX + maxX) / 2), dy = -minY, dz = -Math.round((minZ + maxZ) / 2);
  const shift = (geometry) => {
    for (const b of geometry.boxes ?? []) { b[0] += dx; b[1] += dy; b[2] += dz; b[3] += dx; b[4] += dy; b[5] += dz; }
    for (const v of geometry.voxels ?? []) { v[0] += dx; v[1] += dy; v[2] += dz; }
  };
  for (const entry of modelParts) {
    shift(entry);
    for (const state of Object.values(entry.states ?? {})) shift(state);
    entry.pivot = [entry.pivot[0] + dx, entry.pivot[1] + dy, entry.pivot[2] + dz];
    for (const socket of Object.values(entry.sockets ?? {})) { socket[0] += dx; socket[1] += dy; socket[2] += dz; }
  }
  for (const light of lights) light.position = [light.position[0] + dx, light.position[1] + dy, light.position[2] + dz];
  for (const emitter of emitters) emitter.position = [emitter.position[0] + dx, emitter.position[1] + dy, emitter.position[2] + dz];
}
centreModel(model.parts, model.lights, model.emitters);

const cells = parts.reduce((sum, entry) => sum + (entry.voxels?.length ?? 0)
  + (entry.boxes ?? []).reduce((s, b) => s + (Math.abs(b[3] - b[0]) + 1) * (Math.abs(b[4] - b[1]) + 1) * (Math.abs(b[5] - b[2]) + 1), 0), 0);
console.log(`${model.id}: ${parts.length} parts, ${clips.length} clips, ~${cells.toLocaleString()} cells, ${(W * PITCH).toFixed(2)} × ${(H * PITCH).toFixed(2)} × ${(D * PITCH).toFixed(2)} m`);
if (process.argv.includes("--dry")) console.log("(dry run, nothing written)");
else { const { file, existed } = writeModel(model); console.log(`${existed ? "replaced" : "wrote"} ${file}`); }
