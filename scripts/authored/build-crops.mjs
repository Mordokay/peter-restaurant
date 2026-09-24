// Build every authored crop and produce item, end to end and repeatably.
//
//   node scripts/authored/build-crops.mjs [name ...]
//
// Blender -> GLB -> voxelise -> catalog model -> merge parts -> extract sockets
// -> name and file it. Running it with no arguments rebuilds everything.
//
// ## Game scale
//
// Models are authored at life size in Blender and scaled on the way into the
// catalog, because life size does not play. At the default camera a real 7.9 cm
// bell pepper is SIX PIXELS wide and a 3.3 cm strawberry is three: the player
// cannot see ripeness, count, or that there is fruit at all. That is a gameplay
// defect, and the rulebook's Part 0 is explicit that playability wins.
//
// Scaling happens by handing voxels-to-model a larger world height. Pitch grows
// with it, so the voxel COUNT is unchanged and the object keeps exactly the same
// number of voxels across its width — it looks just as detailed, only bigger.
// The resulting pitches stay inside the rulebook's 1.5-5 mm food band.
//
// Architecture, appliances and furniture are NOT scaled. A 14 cm pepper beside a
// 1.88 m freezer is a large but plausible pepper; scaling the freezer too would
// simply undo the readability we are buying.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { readModel, writeModel } from "./../catalog-io.mjs";

// Plants went up another 45% on 2026-09-24 after walking the farm: at x1.5 a row
// of crops read as ground cover rather than as plants you tend. Produce keeps
// its own multiplier, which also brings the fruit hanging on a bush back to a
// believable size against the bush.
const SCALE = { produce: 1.8, plant: 2.2 };

const SCRATCH = process.env.CROP_BUILD_DIR
  ?? "/private/tmp/claude-501/-Users-pedrosaldanha-Desktop-FarmingUnlimited/crop-build";
mkdirSync(SCRATCH, { recursive: true });

/** pitch: the voxel size the model is AUTHORED at, before game scaling. */
const CROPS = [
  { crop: "carrot",     stages: ["seedling", "growing", "ripe"], pitch: 0.0022, tags: ["farm", "vegetable"], label: "Carrot" },
  { crop: "cabbage",    stages: ["seedling", "growing", "ripe"], pitch: 0.0020, tags: ["farm", "vegetable"], label: "Cabbage" },
  { crop: "lettuce",    stages: ["seedling", "growing", "ripe"], pitch: 0.0021, tags: ["farm", "vegetable"], label: "Lettuce" },
  { crop: "strawberry", stages: ["seedling", "growing", "ripe"], pitch: 0.0018, tags: ["farm", "fruit"],     label: "Strawberry" },
  { crop: "pepper", pitch: 0.0022, tags: ["farm", "vegetable"], label: "Bell Pepper",
    stages: ["seedling", "growing", "ripe_green", "ripe_red", "ripe_yellow", "ripe_orange"] },
];

// `script` picks the Blender file: fruit.py for things picked off a standing
// plant, vegetable.py for the whole-plant crops, which arrive trimmed and cut.
const ITEMS = [
  { kind: "cabbage",       pitch: 0.0022, tags: ["food", "ingredient"], label: "Cabbage",   script: "vegetable" },
  { kind: "carrot",        pitch: 0.0018, tags: ["food", "ingredient"], label: "Carrot",    script: "vegetable" },
  { kind: "lettuce",       pitch: 0.0022, tags: ["food", "ingredient"], label: "Lettuce",   script: "vegetable" },
  { kind: "strawberry",    pitch: 0.0015, tags: ["food", "ingredient"], label: "Strawberry" },
  { kind: "pepper_green",  pitch: 0.0020, tags: ["food", "ingredient"], label: "Bell Pepper (green)" },
  { kind: "pepper_red",    pitch: 0.0020, tags: ["food", "ingredient"], label: "Bell Pepper (red)" },
  { kind: "pepper_yellow", pitch: 0.0020, tags: ["food", "ingredient"], label: "Bell Pepper (yellow)" },
  { kind: "pepper_orange", pitch: 0.0020, tags: ["food", "ingredient"], label: "Bell Pepper (orange)" },
];

// Dishes: the other end of the chain, and scaled like produce because that is
// what they are — food in the player's hands.
const DISHES = [
  { kind: "garden_salad", pitch: 0.0022, tags: ["food", "dish"], label: "Garden Salad" },
];

const STAGE_LABEL = { seedling: "seedling", growing: "growing", ripe: "ready",
  ripe_green: "ready (green)", ripe_red: "ready (red)", ripe_yellow: "ready (yellow)", ripe_orange: "ready (orange)" };

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();

/** Voxelise a GLB and fold it into the catalog at `scale` times life size. */
function toCatalog(glb, vox, id, pitch, scale) {
  run("python3", ["scripts/voxelize-mesh.py", glb, vox, "--pitch", String(pitch),
                  "--lod", "off", "--maxShades", "6", "--shadeTolerance", "0.04"]);
  const grid = JSON.parse(readFileSync(vox, "utf8"));
  const lifeHeight = grid.size[1] * grid.worldPitch;
  run("node", ["scripts/voxels-to-model.mjs", vox, id, (lifeHeight * scale).toFixed(5),
               "--keepSourceParts", "--foldFragments", "0"]);
}

function finish(id, label, folder, tags) {
  const model = readModel(id);
  model.name = label;
  model.folder = folder;
  model.tags = tags;
  writeModel(model);
  return model;
}

const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);
const rows = [];

for (const spec of CROPS) {
  if (!wanted(spec.crop)) continue;
  for (const stage of spec.stages) {
    const glb = `${SCRATCH}/${spec.crop}_${stage}.glb`;
    const vox = `${SCRATCH}/${spec.crop}_${stage}.vox.json`;
    const id = `crop_${spec.crop}_${stage}`;
    run("blender", ["--background", "--python", `scripts/authored/crops/${spec.crop}.py`, "--", stage, glb]);
    toCatalog(glb, vox, id, spec.pitch, SCALE.plant);
    run("node", ["scripts/authored/merge-parts.mjs", id, "^(plant|tops|root)"]);
    try { run("node", ["scripts/authored/extract-sockets.mjs", id, "plant"]); } catch { /* no sockets on this stage */ }
    const model = finish(id, `${spec.label} · ${STAGE_LABEL[stage]}`, "authored/crops", spec.tags);
    const sockets = model.parts.reduce((n, p) => n + Object.keys(p.sockets ?? {}).length, 0);
    rows.push({ id, pitch: model.pitch, parts: model.parts.length, sockets });
  }
}

for (const spec of ITEMS) {
  if (!wanted(spec.kind)) continue;
  const glb = `${SCRATCH}/item_${spec.kind}.glb`;
  const vox = `${SCRATCH}/item_${spec.kind}.vox.json`;
  const id = `item_${spec.kind}`;
  run("blender", ["--background", "--python", `scripts/authored/items/${spec.script ?? "fruit"}.py`, "--", spec.kind, glb]);
  toCatalog(glb, vox, id, spec.pitch, SCALE.produce);
  run("node", ["scripts/authored/merge-parts.mjs", id, "^(berry|pepper|sep|calyx|stalk|root|crown|stem|head|wrap|skirt|leaf)"]);
  const model = finish(id, spec.label, "authored/produce", spec.tags);
  rows.push({ id, pitch: model.pitch, parts: model.parts.length, sockets: 0 });
}

for (const spec of DISHES) {
  if (!wanted(spec.kind)) continue;
  const glb = `${SCRATCH}/dish_${spec.kind}.glb`;
  const vox = `${SCRATCH}/dish_${spec.kind}.vox.json`;
  const id = `dish_${spec.kind}`;
  run("blender", ["--background", "--python", "scripts/authored/items/dish.py", "--", spec.kind, glb]);
  toCatalog(glb, vox, id, spec.pitch, SCALE.produce);
  run("node", ["scripts/authored/merge-parts.mjs", id, "^(bowl|leaf|carrot|pepper)"]);
  const model = finish(id, spec.label, "authored/dishes", spec.tags);
  rows.push({ id, pitch: model.pitch, parts: model.parts.length, sockets: 0 });
}

const index = JSON.parse(readFileSync("src/assets/catalog/index.json", "utf8")).models;
console.log("\n" + "model".padEnd(28) + "pitch".padStart(8) + "parts".padStart(7) + "sockets".padStart(9) + "  size (cm)");
for (const row of rows) {
  const size = index[row.id].size.map((n) => (n * 100).toFixed(1)).join(" x ");
  console.log(row.id.padEnd(28) + `${(row.pitch * 1000).toFixed(2)}mm`.padStart(8)
    + String(row.parts).padStart(7) + String(row.sockets || "-").padStart(9) + "  " + size);
}
console.log(`\nscaled: produce x${SCALE.produce}, plants x${SCALE.plant}; architecture unscaled`);
