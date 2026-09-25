// Build the authored props — the things that are neither plants nor produce.
//
//   node scripts/authored/build-props.mjs [name ...]
//
// Same road as the crops (Blender -> GLB -> voxelise -> catalog -> merge parts
// -> extract sockets), with one difference: props are NOT scaled. A crate is
// furniture, and furniture keeps its real size, or the produce readability the
// crops were scaled for is immediately given back.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { readModel, writeModel } from "./../catalog-io.mjs";

const SCRATCH = process.env.CROP_BUILD_DIR
  ?? "/private/tmp/claude-501/-Users-pedrosaldanha-Desktop-FarmingUnlimited/crop-build";
mkdirSync(SCRATCH, { recursive: true });

const PROPS = [
  { id: "crate_harvest", script: "crate", pitch: 0.008, label: "Harvest crate",
    tags: ["farm", "storage"], folder: "authored/props", holder: "crate",
    merge: "^(post|slat|floor|crate)" },
  // The farmer is authored at about a metre for convenience and stood up to
  // 1.68 m on the way in, so the pitch works out at a round 2 cm.
  { id: "farmer", script: "farmer", pitch: 0.0118, height: 1.68, label: "Farmer",
    tags: ["character"], folder: "authored/characters", holder: "arm_r", merge: "^(hips|torso|head|hat|arm_l|arm_r|leg_l|leg_r)",
    rig: true },
  { id: "tool_hoe", script: "tools", variant: "hoe", pitch: 0.005, label: "Hoe",
    tags: ["tool"], folder: "authored/tools", holder: "handle", merge: "^(handle|head|can|spout|pouch|strap)" },
  { id: "tool_can", script: "tools", variant: "can", pitch: 0.005, label: "Watering can",
    tags: ["tool"], folder: "authored/tools", holder: "can", merge: "^(handle|head|can|spout|pouch|strap)" },
  { id: "tool_seeds", script: "tools", variant: "seeds", pitch: 0.005, label: "Bag of seed",
    tags: ["tool"], folder: "authored/tools", holder: "pouch", merge: "^(handle|head|can|spout|pouch|strap)" },
  { id: "tool_compost", script: "tools", variant: "compost", pitch: 0.005, label: "Bag of compost",
    tags: ["tool"], folder: "authored/tools", holder: "pouch", merge: "^(handle|head|can|spout|pouch|strap)" },
  { id: "tool_mulch", script: "tools", variant: "mulch", pitch: 0.005, label: "Bag of mulch",
    tags: ["tool"], folder: "authored/tools", holder: "pouch", merge: "^(handle|head|can|spout|pouch|strap)" },
  { id: "compost_bin", script: "compost_bin", pitch: 0.011, label: "Compost bin",
    tags: ["farm", "storage"], folder: "authored/props", holder: "bin", merge: "^(bin|heap)" },
  { id: "soil_bed", script: "soil_bed", pitch: 0.009, label: "Tilled bed",
    tags: ["farm", "ground"], folder: "authored/props", holder: "bed", merge: "^(bed)" },
  { id: "prep_table", script: "prep_table", pitch: 0.010, label: "Prep counter",
    tags: ["kitchen", "station"], folder: "authored/props", holder: "top",
    merge: "^(top|leg|apron|apron_end|shelf|board)" },
];

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const only = process.argv.slice(2);
const rows = [];

for (const spec of PROPS) {
  if (only.length && !only.includes(spec.id)) continue;
  const glb = `${SCRATCH}/${spec.id}.glb`;
  const vox = `${SCRATCH}/${spec.id}.vox.json`;
  run("blender", ["--background", "--python", `scripts/authored/props/${spec.script}.py`, "--",
                  ...(spec.variant ? [spec.variant] : []), glb]);
  run("python3", ["scripts/voxelize-mesh.py", glb, vox, "--pitch", String(spec.pitch),
                  "--lod", "off", "--maxShades", "6", "--shadeTolerance", "0.04"]);
  const grid = JSON.parse(readFileSync(vox, "utf8"));
  const height = spec.height ?? grid.size[1] * grid.worldPitch;
  run("node", ["scripts/voxels-to-model.mjs", vox, spec.id, height.toFixed(5),
               "--keepSourceParts", "--foldFragments", "0"]);
  run("node", ["scripts/authored/merge-parts.mjs", spec.id, spec.merge]);
  try { run("node", ["scripts/authored/extract-sockets.mjs", spec.id, spec.holder]); }
  catch { /* a prop with no sockets is fine; not every prop holds things */ }
  if (spec.rig) run("node", ["scripts/authored/rig-parts.mjs", spec.id]);
  const model = readModel(spec.id);
  model.name = spec.label;
  model.folder = spec.folder;
  model.tags = spec.tags;
  writeModel(model);
  rows.push({ id: spec.id, pitch: model.pitch, parts: model.parts.length,
              sockets: model.parts.reduce((n, part) => n + Object.keys(part.sockets ?? {}).length, 0) });
}

const index = JSON.parse(readFileSync("src/assets/catalog/index.json", "utf8")).models;
console.log("\n" + "model".padEnd(22) + "pitch".padStart(8) + "parts".padStart(7) + "sockets".padStart(9) + "  size (cm)");
for (const row of rows) {
  const size = index[row.id].size.map((n) => (n * 100).toFixed(1)).join(" x ");
  console.log(row.id.padEnd(22) + `${(row.pitch * 1000).toFixed(2)}mm`.padStart(8)
    + String(row.parts).padStart(7) + String(row.sockets).padStart(9) + "  " + size);
}
