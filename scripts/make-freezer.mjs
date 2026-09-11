// Authors the upright vegetable freezer straight into the catalog — no mesh, no import, no licence.
//
// Everything is written cell by cell at a 1 cm pitch, so the cabinet can have rounded front corners, a
// control panel with a seven-segment readout, blinking lamps and proud buttons, a vent grille, hinges, a bar handle on
// standoffs, shelf rails, a fan grille and frost. The door is a translucent double-glazed panel that
// swings OUT on its hinge, the interior tube stutters on as it opens, and cold fog pours over the
// threshold and falls to the floor.
//
// What sits on the shelves is NOT painted in: the model carries sockets, and the game drops real
// catalog food models into them (see src/game/storageDisplay.ts), so a freezer shows what it holds.
//
//   node scripts/make-freezer.mjs [--id freezer_upright] [--dry]
import { writeModel } from "./catalog-io.mjs";

const PITCH = 0.01;                       // 1 cm cells
const W = 88, H = 188, D = 74;            // 0.88 × 1.88 × 0.74 m
const WALL = 4;                           // shell thickness
const RADIUS = 7;                         // rounding of the front corners
const PLINTH = 11;                        // kick space at the foot
const FRONT = 0, BACK = D;                // the door faces -z
const SHELF_Y = [52, 92, 132];
// Standing places are a grid, not a line: five across by three deep on every shelf, and the drawer
// holds two of those grids stacked. The middle depth row is shifted half a place so things sit
// diagonally to one another instead of in rank and file. 75 places in all.
const SLOT_COLS = 5, SLOT_ROWS = 3;
const SLOT_PITCH = 15;          // cells between places across the shelf
const SLOT_DEPTH = 17;          // cells between depth rows
const SLOT_X0 = 12;
const DRAWER_LAYER = 16;        // cells between the drawer's two layers

const palette = {
  steel: "#c7cdd3", steel_lit: "#dbe1e6", steel_dark: "#98a0a8", steel_shadow: "#767e86",
  trim: "#5f666d", seal: "#4c5359", hinge: "#6d757d",
  liner: "#eef4f7", liner_shade: "#dde7ec", frost: "#d5e7f2", frost_bright: "#f2fbff",
  glass: "#cfe9f5", glass_edge: "#a9cede",
  wire: "#9aa3aa", wire_dark: "#7c848b",
  panel: "#3a4046", display: "#0b1512", display_back: "#1a4a39", display_off: "#123a2c", display_glow: "#5ef5a0",
  button: "#b9c0c6", button_cap: "#d9dfe4", button_hot: "#c04a40", button_hot_cap: "#e8695c",
  lamp_off: "#262c32", lamp_white: "#f4f9ff", lamp_ice: "#c3e4ff", lamp_red: "#ff5646",
  glow: "#eaf6ff",
  drawer: "#b6bdc3", drawer_face: "#cbd2d8",
};
/** Palette keys that light up. */
// A readout is seen twice: from a metre away, where the digits are the point, and from the game's
// camera twenty-six metres out, where one segment is a single pixel and the number is gone. So the
// whole window is backlit rather than dark: at distance the panel averages to a green glow that says
// "this thing is running", and the digits are there for whoever comes close. Lamps burn hot for the
// same reason — the bloom around a 3 cm lens is all that survives the distance.
// The bloom mask is one colour PER MESH, so a dim backlight and bright digits cannot share a part —
// put them together and the whole window blooms at the digits' strength and the number disappears into
// a slab of light. The lit field is therefore its own part, blooming softly on its own terms.
const emissive = { glow: 1.5, display_glow: 1.4, display_back: 0.3, lamp_white: 2.4, lamp_ice: 2.4, lamp_red: 2.4 };


// The control panel across the top front, and the three indicator lenses standing proud of it.
const PANEL_Y = H - WALL - 19;      // 165 .. 179
const LAMP_X = [51, 60, 69];
// The readout window, in cells: the well the backlight fills and the digits stand in front of.
const READ_X0 = 13, READ_X1 = 46, READ_Y0 = PANEL_Y + 2, READ_Y1 = PANEL_Y + 12;

/** The lit field behind the readout: its own part so its bloom stays a soft wash. */
function displayField() {
  const p = piece();
  p.box(READ_X0, READ_Y0, 1, READ_X1, READ_Y1, 1, "display_back");
  return p;
}

/** Seven-segment glyphs: which of a (top), b, c (right), d (bottom), e, f (left), g (middle) burn. */
const SEGMENTS = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };

/** One digit of the readout: 7 x 11 cells with two-cell strokes. Segments that are NOT lit are drawn
 *  in a dead dark green rather than left out, so it reads as a real LED panel showing a number. */
function segmentDigit(p, glyph, x0, y0, z, lit, dim) {
  const on = new Set(SEGMENTS[glyph] ?? "");
  const bar = (name, x1, y1, x2, y2) => p.box(x1, y1, z, x2, y2, z, on.has(name) ? lit : dim);
  bar("d", x0 + 2, y0, x0 + 4, y0 + 1);
  bar("e", x0, y0 + 2, x0 + 1, y0 + 4);
  bar("c", x0 + 5, y0 + 2, x0 + 6, y0 + 4);
  bar("g", x0 + 2, y0 + 5, x0 + 4, y0 + 6);
  bar("f", x0, y0 + 7, x0 + 1, y0 + 8);
  bar("b", x0 + 5, y0 + 7, x0 + 6, y0 + 8);
  bar("a", x0 + 2, y0 + 9, x0 + 4, y0 + 10);
}

/** One indicator lens: three by three cells standing a centimetre proud of its bezel. */
function lampLens(index, colour) {
  const p = piece();
  p.box(LAMP_X[index] + 1, PANEL_Y + 9, -1, LAMP_X[index] + 3, PANEL_Y + 11, -1, colour);
  return p;
}

/** Deterministic 0..1 noise: frost looks scattered but is identical on every run. */
function hash(x, y, z, salt = 0) {
  let h = Math.imul(x + 0x9e37 + salt, 0x85ebca6b) ^ Math.imul(y + 0x79b9, 0xc2b2ae35) ^ Math.imul(z + 0x1b87, 0x27d4eb2f);
  h ^= h >>> 13; h = Math.imul(h, 0x165667b1); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A part under construction: cells in a map, emitted as x-runs so the file stays small. */
function piece() {
  const cells = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const api = {
    set(x, y, z, colour) { cells.set(key(x, y, z), [x, y, z, colour]); return api; },
    clear(x, y, z) { cells.delete(key(x, y, z)); return api; },
    box(x0, y0, z0, x1, y1, z1, colour) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
          for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) api.set(x, y, z, colour);
      return api;
    },
    get size() { return cells.size; },
    /** Pack into runs: one entry per contiguous x-span at a given (y, z) and colour. */
    runs() {
      const byLine = new Map();
      for (const [x, y, z, colour] of cells.values()) {
        const line = `${y},${z}`;
        let list = byLine.get(line);
        if (!list) byLine.set(line, (list = []));
        list.push([x, colour]);
      }
      const out = [];
      for (const [line, list] of byLine) {
        const [y, z] = line.split(",").map(Number);
        list.sort((a, b) => a[0] - b[0]);
        let start = null, previous = null, colour = null;
        for (const [x, c] of list) {
          if (start === null) { start = previous = x; colour = c; continue; }
          if (x === previous + 1 && c === colour) { previous = x; continue; }
          out.push([y, z, start, previous, colour]);
          start = previous = x; colour = c;
        }
        if (start !== null) out.push([y, z, start, previous, colour]);
      }
      return out;
    },
  };
  return api;
}

/** Is (x, z) inside the cabinet's footprint, inset by `inset` cells? Only the front corners are rounded. */
function inFootprint(x, z, inset = 0) {
  const x0 = inset, x1 = W - 1 - inset, z0 = inset, z1 = D - 1 - inset;
  if (x < x0 || x > x1 || z < z0 || z > z1) return false;
  const r = Math.max(0, RADIUS - inset);
  for (const cx of [x0 + r, x1 - r]) {
    const nearX = cx === x0 + r ? x < cx : x > cx;
    if (nearX && z < z0 + r && Math.hypot(cx - x, z0 + r - z) > r) return false;
  }
  return true;
}

// ── the cabinet ───────────────────────────────────────────────────────────────
function cabinet(sockets) {
  const p = piece();
  const openX0 = WALL, openX1 = W - 1 - WALL;
  const openY0 = PLINTH + WALL, openY1 = H - 1 - WALL - 22;   // the control panel takes the top strip
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        if (!inFootprint(x, z)) continue;
        if (x >= openX0 && x <= openX1 && y >= openY0 && y <= openY1 && z < WALL) continue;   // the doorway
        const shell = !inFootprint(x, z, WALL) || y < PLINTH + WALL || y >= H - WALL;
        if (!shell) continue;                                                                 // hollow inside
        let colour = "steel";
        if (y >= H - 2) colour = "steel_lit";
        else if (y < PLINTH) colour = "steel_shadow";
        else if (z < 2) colour = "steel_dark";                                                // front rim
        p.set(x, y, z, colour);
      }
    }
  }
  // Vent grille in the plinth, and four feet.
  for (let x = 10; x < W - 10; x += 5) p.box(x, 3, 0, x + 2, PLINTH - 3, 1, "trim");
  for (const fx of [6, W - 12]) for (const fz of [6, D - 12]) p.box(fx, 0, fz, fx + 5, 2, fz + 5, "trim");
  // Bright liner one cell inside the shell.
  for (let y = PLINTH + WALL; y < H - WALL; y++) {
    for (let x = WALL; x <= W - 1 - WALL; x++) {
      for (let z = WALL; z <= D - 1 - WALL; z++) {
        const edge = x === WALL || x === W - 1 - WALL || z === D - 1 - WALL || y === PLINTH + WALL || y === H - WALL - 1;
        if (edge) p.set(x, y, z, y === PLINTH + WALL ? "liner_shade" : "liner");
      }
    }
  }
  // Shelf rails down both side walls, so the shelves look carried.
  for (const y of SHELF_Y) for (const x of [WALL, W - 1 - WALL]) p.box(x, y - 1, WALL + 2, x, y + 1, D - 8, "wire_dark");
  // Fan grille high on the back wall.
  for (let i = 0; i < 5; i++) p.box(Math.round(W / 2) - 12, H - 30 - i * 3, D - 1 - WALL, Math.round(W / 2) + 12, H - 30 - i * 3, D - 1 - WALL, "wire_dark");
  // Frost in the corners, along the back and on the floor.
  for (let y = PLINTH + WALL + 2; y < H - WALL - 3; y++) {
    for (const x of [WALL + 1, W - 2 - WALL]) if (hash(x, y, 0, 11) > 0.74) p.set(x, y, D - 2 - WALL, "frost");
    if (hash(0, y, 0, 12) > 0.88) p.set(WALL + 1, y, WALL + 2, "frost_bright");
  }
  for (let x = WALL + 1; x < W - 1 - WALL; x++) for (let z = WALL + 1; z < D - 1 - WALL; z++) {
    if (hash(x, 0, z, 13) > 0.9) p.set(x, PLINTH + WALL, z, "frost");
  }
  // ── the control panel ───────────────────────────────────────────────────────────────────────
  // Recessed across the top front, and the busiest 30 cm of the model: a green LED readout of the
  // cabinet temperature on the left, three indicator lamps and three buttons that stand proud of the
  // face on the right. This is where the eye goes on an appliance, so it gets the cells.
  const panelY = PANEL_Y;
  p.box(12, panelY, 0, W - 13, panelY + 14, 1, "panel");
  // The readout is a well two cells deep: the `display_field` part lights the back of it, and the
  // segments stand in front, so at a metre you read a number and at twenty-six you see a lit panel.
  for (let x = READ_X0; x <= READ_X1; x++) for (let y = READ_Y0; y <= READ_Y1; y++) { p.clear(x, y, 0); p.clear(x, y, 1); }
  const readY = READ_Y0;
  p.box(15, readY + 5, 0, 20, readY + 6, 0, "display_glow");   // the minus sign of -18
  segmentDigit(p, "1", 23, readY, 0, "display_glow", "display_off");
  segmentDigit(p, "8", 32, readY, 0, "display_glow", "display_off");
  p.box(41, readY + 8, 0, 43, readY + 10, 0, "display_glow");  // the degree ring, hollow so the field shows through
  // Three push buttons: a collar sunk into the panel, the button a centimetre out, a smaller cap
  // beyond that. Stepped like this they catch the light and read as something you can press.
  // A lamp sits over its button, so the panel reads as three controls rather than two rows of things.
  for (const [i, bx] of LAMP_X.entries()) {
    const hot = i === 2;
    p.box(bx, panelY + 1, 0, bx + 4, panelY + 6, 0, "trim");
    p.box(bx, panelY + 1, -1, bx + 4, panelY + 6, -1, hot ? "button_hot" : "button");
    p.box(bx + 1, panelY + 2, -2, bx + 3, panelY + 5, -2, hot ? "button_hot_cap" : "button_cap");
  }
  // Bezels for the indicator lamps; the lenses themselves are separate parts, so a clip can blink them.
  for (const lx of LAMP_X) {
    p.box(lx, panelY + 8, 0, lx + 4, panelY + 12, 0, "trim");
    p.box(lx + 1, panelY + 9, 0, lx + 3, panelY + 11, 0, "display");
  }
  // Where the game stands real food: a grid per shelf, named so the packer can read the layout back.
  const grid = (id, y, depthCentre) => {
    for (let row = 0; row < SLOT_ROWS; row++) {
      // Shift the middle row half a place, so neighbours sit diagonally rather than squarely.
      const shift = row === 1 ? Math.round(SLOT_PITCH / 2) : 0;
      for (let col = 0; col < SLOT_COLS; col++) {
        sockets[`${id}_c${col + 1}r${row + 1}`] = [
          SLOT_X0 + col * SLOT_PITCH + shift,
          y,
          depthCentre + (row - 1) * SLOT_DEPTH,
        ];
      }
    }
  };
  for (const [index, y] of SHELF_Y.entries()) grid(`shelf_${"abc"[index]}`, y + 2, Math.round(D / 2));
  grid("drawer_low", PLINTH + WALL + 4, Math.round(D / 2) - 2);
  grid("drawer_high", PLINTH + WALL + 4 + DRAWER_LAYER, Math.round(D / 2) - 2);
  return p;
}

/** A wire shelf: slats with a raised front lip. */
function shelf(y) {
  const p = piece();
  const x0 = WALL + 1, x1 = W - 2 - WALL, z0 = WALL + 2, z1 = D - 7;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if ((z - z0) % 4 === 0 || x === x0 || x === x1 || z === z0 || z === z1) p.set(x, y, z, "wire");
    }
  }
  for (let x = x0; x <= x1; x++) p.box(x, y, z0, x, y + 2, z0, "wire_dark");
  return p;
}

/** A drawer at the bottom for loose frozen goods. */
function drawer() {
  const p = piece();
  const x0 = WALL + 2, x1 = W - 3 - WALL, y0 = PLINTH + WALL + 1, z0 = WALL + 2, z1 = D - 9;
  const top = y0 + 26;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) p.set(x, y0, z, "drawer");
  for (let y = y0; y <= top; y++) {
    for (let x = x0; x <= x1; x++) { p.set(x, y, z0, y > top - 4 ? "drawer_face" : "drawer"); p.set(x, y, z1, "drawer"); }
    for (let z = z0; z <= z1; z++) { p.set(x0, y, z, "drawer"); p.set(x1, y, z, "drawer"); }
  }
  p.box(Math.round(W / 2) - 10, top - 7, z0 - 1, Math.round(W / 2) + 10, top - 4, z0 - 1, "steel_dark");
  return p;
}

/** The tube under the ceiling; the `on` state swaps it for a glowing one. */
function lightBar(colour) {
  const p = piece();
  p.box(WALL + 6, H - WALL - 6, WALL + 4, W - 7 - WALL, H - WALL - 4, D - 10, colour);
  return p;
}

// ── the door ──────────────────────────────────────────────────────────────────
const DOOR_X0 = 1, DOOR_X1 = W - 2, DOOR_Y0 = PLINTH, DOOR_Y1 = H - WALL - 21;
const DOOR_Z0 = -7, DOOR_Z1 = -1;
const STILE = 9;

/** Frame, gasket and hinges. The glass is a separate part so it can be translucent. */
function doorFrame() {
  const p = piece();
  for (let x = DOOR_X0; x <= DOOR_X1; x++) {
    for (let y = DOOR_Y0; y <= DOOR_Y1; y++) {
      const inFrame = x < DOOR_X0 + STILE || x > DOOR_X1 - STILE || y < DOOR_Y0 + STILE || y > DOOR_Y1 - STILE;
      if (!inFrame) continue;
      // Round the outer corners so the door matches the cabinet.
      const cx = x < W / 2 ? DOOR_X0 + RADIUS : DOOR_X1 - RADIUS;
      const cy = y < H / 2 ? DOOR_Y0 + RADIUS : DOOR_Y1 - RADIUS;
      if ((x < DOOR_X0 + RADIUS || x > DOOR_X1 - RADIUS) && (y < DOOR_Y0 + RADIUS || y > DOOR_Y1 - RADIUS)
        && Math.hypot(cx - x, cy - y) > RADIUS) continue;
      for (let z = DOOR_Z0; z <= DOOR_Z1; z++) p.set(x, y, z, z >= DOOR_Z1 - 1 ? "seal" : z <= DOOR_Z0 + 1 ? "steel_lit" : "steel");
    }
  }
  // Gasket round the inner edge.
  for (let x = DOOR_X0 + STILE - 2; x <= DOOR_X1 - STILE + 2; x++) { p.set(x, DOOR_Y0 + STILE - 2, DOOR_Z1, "seal"); p.set(x, DOOR_Y1 - STILE + 2, DOOR_Z1, "seal"); }
  for (let y = DOOR_Y0 + STILE - 2; y <= DOOR_Y1 - STILE + 2; y++) { p.set(DOOR_X0 + STILE - 2, y, DOOR_Z1, "seal"); p.set(DOOR_X1 - STILE + 2, y, DOOR_Z1, "seal"); }
  // Hinges on the left edge.
  for (const y of [DOOR_Y0 + 16, DOOR_Y1 - 16]) p.box(DOOR_X0, y - 5, DOOR_Z1 - 1, DOOR_X0 + 4, y + 5, DOOR_Z1 + 1, "hinge");
  return p;
}
/** Two panes with a gap between them: freezer glazing rather than a single sheet. */
function doorGlass() {
  const p = piece();
  for (let x = DOOR_X0 + STILE; x <= DOOR_X1 - STILE; x++) {
    for (let y = DOOR_Y0 + STILE; y <= DOOR_Y1 - STILE; y++) {
      const edge = x <= DOOR_X0 + STILE + 1 || x >= DOOR_X1 - STILE - 1 || y <= DOOR_Y0 + STILE + 1 || y >= DOOR_Y1 - STILE - 1;
      p.set(x, y, DOOR_Z0 + 2, edge ? "glass_edge" : "glass");
      p.set(x, y, DOOR_Z1 - 2, edge ? "glass_edge" : "glass");
    }
  }
  return p;
}
/** A long bar handle standing off the door on two brackets. */
function doorHandle() {
  const p = piece();
  const x = DOOR_X1 - 15;
  p.box(x, DOOR_Y0 + 34, DOOR_Z0 - 6, x + 4, DOOR_Y1 - 34, DOOR_Z0 - 3, "steel_dark");
  for (const y of [DOOR_Y0 + 34, DOOR_Y1 - 38]) p.box(x, y, DOOR_Z0 - 3, x + 4, y + 4, DOOR_Z0, "steel_shadow");
  return p;
}

// ── assembly ──────────────────────────────────────────────────────────────────
const part = (id, built, extra = {}) => ({ id, pivot: extra.pivot ?? [0, 0, 0], runs: built.runs(), ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "pivot")) });

const sockets = {};
const parts = [
  part("body", cabinet(sockets), { sockets }),
  part("shelf_a", shelf(SHELF_Y[0]), { parent: "body" }),
  part("shelf_b", shelf(SHELF_Y[1]), { parent: "body" }),
  part("shelf_c", shelf(SHELF_Y[2]), { parent: "body" }),
  part("drawer", drawer(), { parent: "body" }),
  part("light_bar", lightBar("steel_shadow"), { parent: "body", states: { on: { runs: lightBar("glow").runs() } } }),
  // Panel lamps. Each is two cells of lens with a dark and a lit state, so the idle clip can blink them.
  part("display_field", displayField(), { parent: "body" }),
  part("lamp_run", lampLens(0, "lamp_off"), { parent: "body", states: { on: { runs: lampLens(0, "lamp_white").runs() } } }),
  part("lamp_cool", lampLens(1, "lamp_off"), { parent: "body", states: { on: { runs: lampLens(1, "lamp_ice").runs() } } }),
  part("lamp_alarm", lampLens(2, "lamp_off"), { parent: "body", states: { on: { runs: lampLens(2, "lamp_red").runs() } } }),
  // The door swings out about its hinge stile; the glass and handle ride with it.
  part("door", doorFrame(), { parent: "body", pivot: [DOOR_X0, SHELF_Y[0], DOOR_Z1] }),
  part("door_glass", doorGlass(), { parent: "door", pivot: [DOOR_X0, SHELF_Y[0], DOOR_Z1], transform: { opacity: 0.3 } }),
  part("door_handle", doorHandle(), { parent: "door", pivot: [DOOR_X0, SHELF_Y[0], DOOR_Z1] }),
];

// Positive yaw about the hinge on the left swings the door AWAY from the cabinet.
const OPEN_YAW = 112;
/** A lamp track: `spans` are the seconds it burns, everything else is dark. State keys cut. */
const lampTrack = (part, spans) => ({
  part,
  keys: [
    { t: 0, state: spans.some(([from, to]) => from <= 0 && to > 0) ? "on" : "base", ease: "step", transition: "cut" },
    ...spans.flatMap(([from, to]) => (from <= 0 ? [] : [{ t: from, state: "on", ease: "step", transition: "cut" }]).concat([{ t: to, state: "base", ease: "step", transition: "cut" }])),
  ],
});

const clips = [
  {
    // Standing by: the compressor lamp holds through its cycle, the run lamp ticks every two seconds
    // and the red one double-blinks once a lap. `partial` keeps it to the lamps — it can blink over a
    // door somebody left open without hauling it shut.
    id: "idle", name: "Standing by", duration: 6, loop: true, partial: true,
    tracks: [
      lampTrack("lamp_cool", [[0, 3.4]]),
      lampTrack("lamp_run", [[0, 0.4], [2, 2.4], [4, 4.4]]),
      lampTrack("lamp_alarm", [[5.1, 5.28], [5.5, 5.68]]),
    ],
  },
  {
    // `partial` again: opening the door must not put the blinking lamps back to dark.
    id: "open", name: "Open the door", duration: 1.1, partial: true,
    tracks: [
      { part: "door", keys: [
        { t: 0, rotation: [0, 0, 0], ease: "out" },
        { t: 0.14, rotation: [0, 9, 0], ease: "out" },
        { t: 1.1, rotation: [0, OPEN_YAW, 0], ease: "out" },
      ] },
      // A cold tube stutters before it settles. "cut" matters: a light switches, it does not dissolve,
      // and a blend would leave the part mid-transition for the whole run-up to the next key.
      { part: "light_bar", keys: [
        { t: 0, state: "base", ease: "step", transition: "cut" }, { t: 0.15, state: "on", ease: "step", transition: "cut" },
        { t: 0.21, state: "base", ease: "step", transition: "cut" }, { t: 0.27, state: "on", ease: "step", transition: "cut" },
        { t: 0.35, state: "base", ease: "step", transition: "cut" }, { t: 0.41, state: "on", ease: "step", transition: "cut" },
      ] },
    ],
    events: [
      { t: 0.1, name: "freezer_open", emit: "vapour_spill", emitAction: "start" },
      { t: 0.12, name: "freezer_fog", emit: "cold_air", emitAction: "start" },
      { t: 1.05, name: "freezer_open_done" },
    ],
  },
  {
    id: "close", name: "Close the door", duration: 0.85, partial: true,
    tracks: [
      { part: "door", keys: [
        { t: 0, rotation: [0, OPEN_YAW, 0], ease: "in" },
        { t: 0.7, rotation: [0, 5, 0], ease: "in" },
        { t: 0.85, rotation: [0, 0, 0], ease: "out" },
      ] },
      // The light stays on the whole way: it goes out as the door meets the seal, not before.
      { part: "light_bar", keys: [{ t: 0, state: "on", ease: "step", transition: "cut" }, { t: 0.85, state: "base", ease: "step", transition: "cut" }] },
    ],
    events: [
      // And the cold air keeps spilling until the door is actually shut.
      { t: 0.85, name: "freezer_closed", emit: "cold_air", emitAction: "stop" },
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
  emissive,
  lights: [{
    position: [Math.round(W / 2), H - WALL - 10, Math.round(D / 2)],
    color: "#d3ebff", intensity: 1.2, range: 3.4,
    whenState: { part: "light_bar", state: "on" },
  }],
  emitters: [
    {
      // Cold air hanging in the cabinet. It seeds anywhere inside the interior VOLUME rather than at a
      // point, drifts almost imperceptibly in every direction, tumbles, and is barely there — closer to
      // a breath of frost than to smoke. Ice blue among the whites.
      id: "cold_air", part: "body",
      position: [Math.round(W / 2), Math.round((PLINTH + H) / 2) - 8, Math.round(D / 2)],
      volume: [W - 2 * WALL - 6, H - PLINTH - 2 * WALL - 26, D - 2 * WALL - 8],
      colors: ["#eaf6fd", "#d3e9f7", "#b9dcf2", "#a8d3ee"], size: 4, alpha: 0.16,
      shape: "flake",
      mode: "continuous", rate: 26, duration: 0, count: 26, direction: [0, -0.2, 0], spread: 180,
      speed: [0.04, 0.16], life: [2.6, 5.0],
      // It comes in small and sharp, swells as it warms, and thins away to nothing.
      scaleOverLife: [0.45, 1.7], alphaOverLife: [1, 0],
      gravity: 0.05, drag: 0.9, bounce: 0, friction: 0.9, spin: true,
    },
    {
      // The breath that rolls over the threshold when the door swings, filling the doorway itself.
      id: "vapour_spill", part: "body",
      position: [Math.round(W / 2), Math.round((PLINTH + DOOR_Y1) / 2), -6],
      volume: [W - 2 * WALL - 10, DOOR_Y1 - PLINTH - 20, 10],
      colors: ["#eef8fd", "#d8ecf8", "#bfdff3"], size: 5, alpha: 0.18,
      shape: "flake",
      // Continuous, not a burst: it builds from nothing at its own rate over the second the door is
      // swinging, so the doorway breathes instead of coughing seventy flakes in one frame.
      mode: "continuous", rate: 34, duration: 0.9, count: 34, direction: [0, -0.6, -1], spread: 150,
      speed: [0.1, 0.35], life: [2.2, 4.2],
      scaleOverLife: [0.6, 2.0], alphaOverLife: [1, 0],
      gravity: 0.18, drag: 1.1, bounce: 0, friction: 0.85, spin: true,
    },
  ],
};

/** Centre on x and z and stand on y = 0, so it drops into the world by its base like every prop. */
function centreModel(modelParts, lights, emitters) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const see = (x, y, z) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; };
  const walk = (geometry) => { for (const r of geometry.runs ?? []) { see(r[2], r[0], r[1]); see(r[3], r[0], r[1]); } };
  for (const entry of modelParts) { walk(entry); for (const state of Object.values(entry.states ?? {})) walk(state); }
  const dx = -Math.round((minX + maxX) / 2), dy = -minY, dz = -Math.round((minZ + maxZ) / 2);
  const shift = (geometry) => { for (const r of geometry.runs ?? []) { r[0] += dy; r[1] += dz; r[2] += dx; r[3] += dx; } };
  for (const entry of modelParts) {
    shift(entry);
    for (const state of Object.values(entry.states ?? {})) shift(state);
    entry.pivot = [entry.pivot[0] + dx, entry.pivot[1] + dy, entry.pivot[2] + dz];
    for (const [name, cell] of Object.entries(entry.sockets ?? {})) entry.sockets[name] = [cell[0] + dx, cell[1] + dy, cell[2] + dz];
  }
  for (const light of lights) light.position = [light.position[0] + dx, light.position[1] + dy, light.position[2] + dz];
  for (const emitter of emitters) emitter.position = [emitter.position[0] + dx, emitter.position[1] + dy, emitter.position[2] + dz];
}
centreModel(model.parts, model.lights, model.emitters);

const cells = parts.reduce((sum, entry) => sum + entry.runs.reduce((s, r) => s + (r[3] - r[2] + 1), 0), 0);
console.log(`${model.id}: ${parts.length} parts, ${clips.length} clips, ${cells.toLocaleString()} cells, ${Object.keys(sockets).length} sockets, ${(W * PITCH).toFixed(2)} × ${(H * PITCH).toFixed(2)} × ${(D * PITCH).toFixed(2)} m`);
if (process.argv.includes("--dry")) console.log("(dry run, nothing written)");
else { const { file, existed } = writeModel(model); console.log(`${existed ? "replaced" : "wrote"} ${file}`); }
