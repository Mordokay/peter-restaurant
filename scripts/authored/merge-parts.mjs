// Merge a model's parts back together by a shared name prefix.
//
// voxelize-mesh.py splits every node into its DISCONNECTED COMPONENTS, so a
// bunch of rosemary joined into one mesh per stem in Blender still arrives as
// 167 separate parts - one per needle. That matters because a part is a
// TransformNode, a mesh and a clip track whether or not anyone animates it, and
// nobody sways a single 3 mm thyme leaf.
//
// Runs are absolute on the shared fine lattice and every part here has a zero
// pivot, so merging is a concatenation - no re-basing needed.
//
//   node scripts/authored/merge-parts.mjs <modelId> <regex-with-one-capture-group>
//
// Parts whose id matches keep only the captured text as their new id; parts that
// do not match are left alone.
import { readModel, writeModel } from "./../catalog-io.mjs";

const [modelId, pattern] = process.argv.slice(2);
if (!modelId || !pattern) throw new Error("Usage: merge-parts.mjs <modelId> <regex>");
const re = new RegExp(pattern);

const model = readModel(modelId);
const merged = new Map();
const kept = [];
for (const part of model.parts) {
  const match = re.exec(part.id);
  if (!match) { kept.push(part); continue; }
  const id = match[1] ?? match[0];
  const target = merged.get(id);
  if (target) {
    if (part.pivot?.some((v, i) => v !== (target.pivot?.[i] ?? 0))) {
      throw new Error(`${part.id} has a different pivot from ${id}; refusing to merge`);
    }
    target.runs.push(...(part.runs ?? []));
    if (part.boxes?.length) (target.boxes ??= []).push(...part.boxes);
  } else {
    merged.set(id, { ...part, id, runs: [...(part.runs ?? [])], ...(part.boxes ? { boxes: [...part.boxes] } : {}) });
  }
}
const before = model.parts.length;
model.parts = [...kept, ...merged.values()];
writeModel(model);
const runs = model.parts.reduce((sum, p) => sum + (p.runs?.length ?? 0), 0);
console.log(`${modelId}: ${before} -> ${model.parts.length} parts (${merged.size} merged groups, ${runs} runs kept)`);
