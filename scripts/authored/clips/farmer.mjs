// The farmer's movement: idle, walk, and one clip per kind of work.
//
//   node scripts/authored/clips/farmer.mjs
//
// Written as data rather than posed by hand in the lab, because these six clips
// are a system: every action clip plants its blow at the same moment (0.42 of
// its length) so the game can fire dirt, water or chaff on one rule instead of
// six, and every one returns to the same rest pose so they can interrupt each
// other without a snap.
//
// Rotations are degrees about the part's own joint, positions are cells.
// Anticipation before the blow, follow-through after it, and a short settle —
// the rulebook's animation rules, applied to a person rather than a door.
import { readModel, writeModel } from "./../../catalog-io.mjs";

const MODEL = "farmer";
/** Where in every action clip the tool lands. One number, one rule. */
export const IMPACT = 0.42;

const key = (t, rotation, extra = {}) => ({ t, rotation, ease: "inOut", ...extra });

/** A limb swinging between two angles and back, with the blow at IMPACT. */
const strike = (duration, part, rest, wind, blow, follow) => ({
  part,
  keys: [
    key(0, rest),
    key(duration * IMPACT * 0.55, wind, { ease: "out" }),   // anticipation
    key(duration * IMPACT, blow, { ease: "in" }),           // the blow itself
    key(duration * (IMPACT + 0.22), follow, { ease: "out" }),
    key(duration, rest),
  ],
});

const clips = [];

// ── idle: breathing, and a hat that does not sit stock still ────────────────
clips.push({
  id: "idle", name: "Idle", duration: 3.4, loop: true,
  tracks: [
    { part: "torso", keys: [key(0, [0, 0, 0]), key(1.7, [-1.6, 0, 0]), key(3.4, [0, 0, 0])] },
    { part: "head", keys: [key(0, [0, 0, 0]), key(1.1, [1.5, 6, 0]), key(2.3, [0, -5, 0]), key(3.4, [0, 0, 0])] },
    { part: "arm_l", keys: [key(0, [0, 0, 2]), key(1.7, [4, 0, 3.5]), key(3.4, [0, 0, 2])] },
    { part: "arm_r", keys: [key(0, [0, 0, -2]), key(1.7, [-3, 0, -3.5]), key(3.4, [0, 0, -2])] },
  ],
});

// ── walk: legs opposed, arms counter-swinging, a bob on the double ──────────
const stride = 26;
clips.push({
  id: "walk", name: "Walk", duration: 0.68, loop: true,
  tracks: [
    { part: "leg_l", keys: [key(0, [stride, 0, 0]), key(0.34, [-stride, 0, 0]), key(0.68, [stride, 0, 0])] },
    { part: "leg_r", keys: [key(0, [-stride, 0, 0]), key(0.34, [stride, 0, 0]), key(0.68, [-stride, 0, 0])] },
    { part: "arm_l", keys: [key(0, [-stride * 0.7, 0, 3]), key(0.34, [stride * 0.7, 0, 3]), key(0.68, [-stride * 0.7, 0, 3])] },
    { part: "arm_r", keys: [key(0, [stride * 0.7, 0, -3]), key(0.34, [-stride * 0.7, 0, -3]), key(0.68, [stride * 0.7, 0, -3])] },
    // The bob is on the half-beat: a body rises twice per stride, once per step.
    { part: "hips", keys: [
      { t: 0, position: [0, 0, 0], ease: "inOut" },
      { t: 0.17, position: [0, 1, 0], ease: "inOut" },
      { t: 0.34, position: [0, 0, 0], ease: "inOut" },
      { t: 0.51, position: [0, 1, 0], ease: "inOut" },
      { t: 0.68, position: [0, 0, 0], ease: "inOut" },
    ] },
    { part: "torso", keys: [key(0, [2, 3, 0]), key(0.34, [2, -3, 0]), key(0.68, [2, 3, 0])] },
  ],
});

// ── swing: the hoe. Both arms up and over, and the body follows the blow ────
clips.push({
  id: "swing", name: "Swing", duration: 0.62,
  tracks: [
    strike(0.62, "arm_r", [0, 0, -2], [-118, 0, -10], [58, 0, -4], [34, 0, -3]),
    strike(0.62, "arm_l", [0, 0, 2], [-96, 0, 12], [46, 0, 6], [26, 0, 4]),
    // The torso is where the weight is: it rocks back, then drives forward.
    strike(0.62, "torso", [0, 0, 0], [-12, 0, 0], [26, 0, 0], [16, 0, 0]),
    strike(0.62, "head", [0, 0, 0], [-8, 0, 0], [16, 0, 0], [8, 0, 0]),
    { part: "hips", keys: [
      { t: 0, position: [0, 0, 0], ease: "inOut" },
      { t: 0.62 * IMPACT, position: [0, -1, 0], ease: "in" },
      { t: 0.62, position: [0, 0, 0], ease: "out" },
    ] },
  ],
  events: [{ t: 0.62 * IMPACT, name: "impact" }],
});

// ── pour: the can goes out and tips, and stays out while it empties ─────────
clips.push({
  id: "pour", name: "Pour", duration: 1.05,
  tracks: [
    { part: "arm_r", keys: [key(0, [0, 0, -2]), key(0.3, [-74, 0, -14]), key(0.85, [-70, 0, -30]), key(1.05, [0, 0, -2])] },
    { part: "arm_l", keys: [key(0, [0, 0, 2]), key(0.3, [-24, 0, 8]), key(0.85, [-20, 0, 8]), key(1.05, [0, 0, 2])] },
    { part: "torso", keys: [key(0, [0, 0, 0]), key(0.35, [9, -10, 0]), key(0.85, [10, -10, 0]), key(1.05, [0, 0, 0])] },
    { part: "head", keys: [key(0, [0, 0, 0]), key(0.35, [14, 0, 0]), key(0.85, [14, 0, 0]), key(1.05, [0, 0, 0])] },
  ],
  events: [{ t: 1.05 * IMPACT, name: "impact" }],
});

// ── scatter: a handful thrown across the bed ────────────────────────────────
clips.push({
  id: "scatter", name: "Scatter", duration: 0.72,
  tracks: [
    strike(0.72, "arm_r", [0, 0, -2], [-38, -42, -8], [-48, 46, -16], [-20, 24, -8]),
    { part: "arm_l", keys: [key(0, [0, 0, 2]), key(0.3, [-28, 0, 10]), key(0.72, [0, 0, 2])] },
    strike(0.72, "torso", [0, 0, 0], [4, -16, 0], [6, 18, 0], [2, 8, 0]),
    { part: "head", keys: [key(0, [0, 0, 0]), key(0.3, [6, -12, 0]), key(0.5, [8, 14, 0]), key(0.72, [0, 0, 0])] },
  ],
  events: [{ t: 0.72 * IMPACT, name: "impact" }],
});

// ── pick: bend, take it, straighten with it ─────────────────────────────────
clips.push({
  id: "pick", name: "Pick", duration: 0.66,
  tracks: [
    { part: "torso", keys: [key(0, [0, 0, 0]), key(0.28, [44, 0, 0]), key(0.46, [38, 0, 0]), key(0.66, [0, 0, 0])] },
    { part: "arm_r", keys: [key(0, [0, 0, -2]), key(0.28, [40, 0, -12]), key(0.46, [-16, 0, -10]), key(0.66, [0, 0, -2])] },
    { part: "arm_l", keys: [key(0, [0, 0, 2]), key(0.28, [22, 0, 10]), key(0.66, [0, 0, 2])] },
    { part: "head", keys: [key(0, [0, 0, 0]), key(0.28, [22, 0, 0]), key(0.66, [0, 0, 0])] },
    { part: "leg_l", keys: [key(0, [0, 0, 0]), key(0.28, [-14, 0, 0]), key(0.66, [0, 0, 0])] },
    { part: "leg_r", keys: [key(0, [0, 0, 0]), key(0.28, [10, 0, 0]), key(0.66, [0, 0, 0])] },
  ],
  events: [{ t: 0.66 * IMPACT, name: "impact" }],
});

const model = readModel(MODEL);
model.clips = clips;
writeModel(model);
console.log(`${MODEL}: ${clips.length} clips — ${clips.map((clip) => clip.id).join(", ")}`);
