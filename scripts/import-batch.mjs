#!/usr/bin/env node
// Execute an approved import plan (.art-assets/import-plan.json from scripts/import-plan.mjs)
// OUTSIDE the dev server, so the lab never freezes: for every object, voxelize the named
// meshes of its pack at the tier's budget, emit the catalog model (source parts kept), auto-rig,
// then set name, folder and tags. Same conversion rules as the lab's /__lab/import-model.
// Thumbnails are rendered afterwards by the lab (📸 button or window.__labThumbs.generate()).
//
// Usage: node --experimental-strip-types scripts/import-batch.mjs [--plan file] [--only <regex on pack or id>]
//        [--replace] [--dry] [--jobs 3]
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasModel, readModel, writeModel, deleteModel } from "./catalog-io.mjs";
import { DETAIL_TIERS, clampVoxelHeight, initialVoxelHeight, isImportDetail } from "../src/game/importDetail.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const planPath = flag("--plan", join(root, ".art-assets/import-plan.json"));
const only = args.includes("--only") ? new RegExp(flag("--only")) : null;
const replace = args.includes("--replace");
const dry = args.includes("--dry");
const jobs = Number(flag("--jobs", "3"));
const importDir = join(root, ".art-assets", "imports");
mkdirSync(importDir, { recursive: true });

const plan = JSON.parse(readFileSync(planPath, "utf8"));
const work = [];
for (const pack of plan.packs) {
  if (!pack.sourceFile || !existsSync(pack.sourceFile)) { if (pack.objects.length) console.log(`skip ${pack.pack}: source file missing`); continue; }
  const slug = pack.pack.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const localSource = join(importDir, `${slug}.glb`);
  if (!existsSync(localSource) && !dry) copyFileSync(pack.sourceFile, localSource);
  for (const object of pack.objects) {
    if (only && !only.test(pack.pack) && !only.test(object.id)) continue;
    work.push({ pack: pack.pack, source: localSource, ...object });
  }
}
console.log(`${work.length} objects to convert${dry ? " (dry run)" : ""}, ${jobs} at a time`);
if (dry) { for (const w of work) console.log(`  ${w.pack.padEnd(40)} ${w.id.padEnd(32)} ${w.folder.padEnd(28)} h ${w.worldHeight} · ${w.detail} · ${w.nodes.length} mesh`); process.exit(0); }

const run = (command, cmdArgs) => new Promise((resolve, reject) => {
  execFile(command, cmdArgs, { cwd: root, maxBuffer: 256 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(`${command} ${cmdArgs.slice(0, 3).join(" ")}…: ${(stderr || stdout || error.message).split("\n").filter(Boolean).slice(-3).join(" | ")}`));
    else resolve(stdout);
  });
});

async function convert(w) {
  const started = Date.now();
  if (hasModel(w.id) && !replace) return { ...w, status: "exists" };
  const detail = isImportDetail(w.detail) ? w.detail : "fine";
  const { budget, cap } = DETAIL_TIERS[detail];
  const metres = w.worldHeight > 0 ? w.worldHeight : 0.5;
  const grid = join(importDir, `${w.id}.vox.json`);
  const convertAt = async (h) => {
    const cmd = ["scripts/voxelize-mesh.py", w.source, grid, "--height", String(h), "--shadeTolerance", "0.12", "--flatten", "0.35", "--geometry", w.nodes.join(","), "--exact", "1"];
    if (metres > 1.5) cmd.push("--lodLevels", "1");
    await run("python3", cmd);
    const parsed = JSON.parse(readFileSync(grid, "utf8"));
    return parsed.parts.reduce((sum, part) => sum + part.cells.length * (part.scale ?? 1) ** 3, 0);
  };
  let voxelHeight = initialVoxelHeight(metres, detail, w.footprint);
  let voxels = await convertAt(voxelHeight);
  for (let attempt = 0; attempt < 3; attempt++) {
    const ratio = Math.sqrt(budget / Math.max(1, voxels));
    const next = clampVoxelHeight(voxelHeight * (voxels > budget * 1.15 ? ratio : voxels < budget * 0.45 && voxelHeight < cap ? ratio * 0.9 : 1), metres, detail, w.footprint);
    if (next === voxelHeight) break;
    voxelHeight = next;
    voxels = await convertAt(voxelHeight);
  }
  // Catalog writes (emitter, rigger, writeModel) all rewrite index.json: one object at a time.
  await withCatalogLock(async () => {
    if (hasModel(w.id)) deleteModel(w.id);
    try {
      await run("node", ["scripts/voxels-to-model.mjs", grid, w.id, String(metres), "--keepSourceParts", "--foldFragments", "0.01"]);
      await run("node", ["scripts/rig-model.mjs", w.id]);
    } catch (error) {
      try { deleteModel(w.id); } catch { /* nothing written */ }
      throw error;
    }
    const model = readModel(w.id);
    if (w.name) model.name = w.name;
    if (w.folder) model.folder = w.folder; else delete model.folder;
    if (w.tags?.length) model.tags = w.tags;
    writeModel(model);
  });
  return { ...w, status: "ok", voxels, voxelHeight, voxelSize: metres / voxelHeight, seconds: (Date.now() - started) / 1000 };
}

let catalogLock = Promise.resolve();
function withCatalogLock(task) {
  const turn = catalogLock.then(task, task);
  catalogLock = turn.catch(() => {});
  return turn;
}
// Voxelizing (the slow python step) runs in parallel; catalog writes are serialised above.
let next = 0, active = 0;
const results = [];
const log = [];
await new Promise((resolve) => {
  const launch = () => {
    while (active < jobs && next < work.length) {
      const w = work[next++]; active++;
      convert(w).then((r) => {
        results.push(r);
        const line = r.status === "ok" ? `ok   ${r.id.padEnd(32)} ${String(r.voxels).padStart(7)} voxels · ${r.voxelHeight} tall · ${(r.voxelSize * 1000).toFixed(2)} mm · ${r.seconds.toFixed(1)} s` : `skip ${r.id} (${r.status})`;
        console.log(line); log.push(line);
      }, (error) => {
        results.push({ ...w, status: "failed", error: error.message });
        const line = `FAIL ${w.id}: ${error.message}`; console.log(line); log.push(line);
      }).finally(() => { active--; if (results.length === work.length) resolve(); else launch(); });
    }
  };
  if (!work.length) resolve(); else launch();
});
const ok = results.filter((r) => r.status === "ok").length, failed = results.filter((r) => r.status === "failed");
console.log(`\ndone: ${ok} converted, ${results.length - ok - failed.length} skipped, ${failed.length} failed`);
if (failed.length) console.log(failed.map((f) => `  ${f.id}: ${f.error}`).join("\n"));
writeFileSync(join(root, ".art-assets/import-batch.log"), log.join("\n") + "\n");
