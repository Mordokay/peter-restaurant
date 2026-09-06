// Auto-rig a multi-part catalog model and (optionally) give it preset clips.
// Universal: parents and joints come from where parts touch (rigInference.ts),
// never from what the object is. The lab editor can refine every joint.
//
// Usage:
//   node scripts/rig-model.mjs <modelId> [--root partId] [--reinfer]
//        (--reinfer ignores parents already on the model; default keeps them)
//        [--sway amplitudeDeg,periodSeconds]     looping "sway": every child part
//                                                 rocks around its joint, phased
//        [--pop partA,partB,...]                  one-shot "harvest": listed parts
//                                                 swell then shrink to zero, with a
//                                                 "harvest" event at the pop
import { hasModel, readModel, writeModel } from "./catalog-io.mjs";
import { applyRig, inferRig } from "../src/game/rigInference.ts";
import { validateAuthoredVoxelCatalog } from "../src/game/voxelModel.ts";

const args = process.argv.slice(2);
const modelId = args[0];
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
if (!modelId) throw new Error("Usage: node scripts/rig-model.mjs <modelId> [--root partId] [--sway deg,seconds] [--pop a,b,c]");

const model = hasModel(modelId) ? readModel(modelId) : undefined;
if (!model) throw new Error(`${modelId} is not in the catalog`);

// Parents that came with the file (or from the editor) are kept unless --reinfer.
const rig = inferRig(model, { root: option("--root"), keepExisting: !args.includes("--reinfer") });
let rigged = applyRig(model, rig);
console.log(`${modelId}: root ${rig.root}; ${rig.parents.size} part(s) attached`);
for (const part of rigged.parts) console.log(`  ${part.id.padEnd(8)} parent ${(part.parent ?? "-").padEnd(8)} pivot ${part.pivot.join(",")}`);

const clips = [...(rigged.clips ?? [])].filter((clip) => clip.id !== "sway" && clip.id !== "harvest");
const sway = option("--sway");
if (sway) {
  const [amplitude, period] = sway.split(",").map(Number);
  const children = rigged.parts.filter((part) => part.parent);
  const tracks = children.map((part, index) => {
    const phase = index * 2.399; // golden-angle spread so no two parts move in lockstep
    const a = [amplitude * Math.sin(phase), 0, amplitude * Math.cos(phase)];
    const b = a.map((v) => -v);
    return { part: part.id, keys: [
      { t: 0, rotation: a },
      { t: period / 2, rotation: b, ease: "inOut" },
      { t: period, rotation: a, ease: "inOut" },
    ] };
  });
  // The whole plant leans a touch, slower than the leaves.
  tracks.push({ part: "*", keys: [{ t: 0, rotation: [0, 0, -0.8] }, { t: period / 2, rotation: [0, 0, 0.8], ease: "inOut" }, { t: period, rotation: [0, 0, -0.8], ease: "inOut" }] });
  clips.push({ id: "sway", duration: period, loop: true, tracks });
  console.log(`  clip sway: ${children.length} part(s), ±${amplitude}°, ${period}s loop`);
}
const pop = option("--pop");
if (pop) {
  const ids = pop.split(",").map((id) => id.trim()).filter(Boolean);
  const missing = ids.filter((id) => !rigged.parts.some((part) => part.id === id));
  if (missing.length) throw new Error(`--pop: unknown part(s) ${missing.join(", ")}`);
  const tracks = ids.map((id) => ({ part: id, keys: [
    { t: 0, scale: [1, 1, 1] },
    { t: 0.18, scale: [1.18, 1.18, 1.18], ease: "out" },   // anticipation: swell
    { t: 0.34, scale: [0, 0, 0], ease: "in" },              // action: pop away
  ] }));
  clips.push({ id: "harvest", duration: 0.6, loop: false, tracks, events: [{ t: 0.34, name: "harvest" }] });
  console.log(`  clip harvest: pops ${ids.join(", ")} at 0.34s`);
}
rigged = { ...rigged, clips };
if (clips.length === 0) delete rigged.clips;

const errors = validateAuthoredVoxelCatalog({ version: 1, models: { [modelId]: rigged } });
if (errors.length) throw new Error(`rig invalid:\n${errors.join("\n")}`);
writeModel(rigged);
console.log(`wrote ${modelId} with ${rigged.parts.length} parts and ${clips.length} clip(s)`);
