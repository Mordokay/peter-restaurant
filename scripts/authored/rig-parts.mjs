// Give an authored character its joints.
//
//   node scripts/authored/rig-parts.mjs <modelId>
//
// The voxeliser hands back parts with no hierarchy and a zero pivot, which
// rotates every limb about the model's origin — an arm that swings from the
// floor. A rig needs a parent and a joint per part, and both are derivable from
// the geometry itself rather than typed in by hand:
//
//   * a shoulder is the TOP of an arm, a hip the TOP of a leg;
//   * a neck is the BOTTOM of a head, a waist the BOTTOM of a torso;
//   * a hat turns with the head, about the head's own top.
//
// Deriving them means the rig cannot drift away from the model when the model is
// re-authored — the one failure mode of hand-typed pivots.
import { readModel, writeModel } from "./../catalog-io.mjs";

const [modelId] = process.argv.slice(2);
if (!modelId) throw new Error("Usage: rig-parts.mjs <modelId>");

/** parent, and where in its own bounds the joint sits. */
const SKELETON = {
  hips:  { parent: undefined, at: "centre" },
  torso: { parent: "hips",    at: "bottom" },
  head:  { parent: "torso",   at: "bottom" },
  hat:   { parent: "head",    at: "bottom" },
  arm_l: { parent: "torso",   at: "top" },
  arm_r: { parent: "torso",   at: "top" },
  leg_l: { parent: "hips",    at: "top" },
  leg_r: { parent: "hips",    at: "top" },
};

const model = readModel(modelId);

/** Every cell of a part. Runs are [y, z, x0, x1, colour]; boxes are corners. */
const boundsOf = (part) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const see = (x, y, z) => {
    lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z);
    hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z);
  };
  for (const [y, z, x0, x1] of part.runs ?? []) { see(x0, y, z); see(x1, y, z); }
  for (const [x0, y0, z0, x1, y1, z1] of part.boxes ?? []) { see(x0, y0, z0); see(x1, y1, z1); }
  for (const [x, y, z] of part.voxels ?? []) see(x, y, z);
  return { lo, hi };
};

let rigged = 0;
for (const part of model.parts) {
  const spec = SKELETON[part.id];
  if (!spec) continue;
  const { lo, hi } = boundsOf(part);
  if (!Number.isFinite(lo[0])) continue;
  const mid = (axis) => Math.round((lo[axis] + hi[axis]) / 2);
  const y = spec.at === "top" ? hi[1] : spec.at === "bottom" ? lo[1] : mid(1);
  part.pivot = [mid(0), y, mid(2)];
  if (spec.parent) part.parent = spec.parent;
  else delete part.parent;
  rigged++;
}

writeModel(model);
console.log(`${modelId}: ${rigged} parts jointed`);
