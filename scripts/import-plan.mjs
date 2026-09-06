#!/usr/bin/env node
// Dry-run import plan for a folder of .glb packs: what each file holds, how it will be split,
// named, scaled, tagged and filed — WITHOUT converting anything. Reads the inspect-mesh.py
// output per file (scripts/inspect-mesh.py, run by scripts/inspect-folder.mjs), merges the
// hand-written decisions in scripts/import-overrides.json (names for anonymous meshes, unit
// scales, parts that belong together, objects to skip), checks ids against the catalog and
// writes:
//   docs/IMPORT_REPORT.md        — for the owner to read and correct
//   .art-assets/import-plan.json — for scripts/import-batch.mjs to execute after approval
//
// Usage: node scripts/import-plan.mjs <inspect-dir> [--source <glb folder>]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readIndex } from "./catalog-io.mjs";
import { suggestTags } from "../src/game/catalogTags.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const inspectDir = args[0];
const sourceDir = args.includes("--source") ? args[args.indexOf("--source") + 1] : "/Users/pedrosaldanha/Downloads/3D";
if (!inspectDir) { console.error("usage: node scripts/import-plan.mjs <inspect-dir> [--source <glb folder>]"); process.exit(1); }

const overrides = JSON.parse(readFileSync(join(root, "scripts/import-overrides.json"), "utf8"));
const index = readIndex();

const idOf = (text) => text.replace(/^sm_/i, "").replace(/^mesh_/i, "").replace(/_?asset.*$/i, "").replace(/_0$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "object";
const title = (id) => id.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
const cm = (m) => (m >= 1 ? `${m.toFixed(2)} m` : `${Math.round(m * 100)} cm`);

const packs = [];
for (const file of readdirSync(inspectDir).filter((f) => f.endsWith(".json") && !f.endsWith(".labels.json")).sort()) {
  const pack = file.replace(/\.json$/, "");
  const inspected = JSON.parse(readFileSync(join(inspectDir, file), "utf8"));
  const o = overrides.packs[pack] ?? {};
  const scale = o.scale ?? 1;
  // Group meshes into objects: by label, then hand merges (label list → one object).
  const groups = new Map();
  for (const node of inspected.nodes) {
    const label = node.label ?? node.node;
    const g = groups.get(label) ?? { label, nodes: [], faces: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], materials: new Set() };
    g.nodes.push(node.node); g.faces += node.faces; g.materials.add(node.material);
    for (let a = 0; a < 3; a++) { g.lo[a] = Math.min(g.lo[a], node.center[a] - node.size[a] / 2); g.hi[a] = Math.max(g.hi[a], node.center[a] + node.size[a] / 2); }
    groups.set(label, g);
  }
  const objects = [];
  const consumed = new Set();
  const mergeGroups = (labels, id) => {
    const merged = { label: id, nodes: [], faces: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], materials: new Set(), merged: labels.length };
    for (const label of labels) {
      const g = groups.get(label);
      if (!g) { merged.missing = [...(merged.missing ?? []), label]; continue; }
      consumed.add(label);
      merged.nodes.push(...g.nodes); merged.faces += g.faces; g.materials.forEach((m) => merged.materials.add(m));
      for (let a = 0; a < 3; a++) { merged.lo[a] = Math.min(merged.lo[a], g.lo[a]); merged.hi[a] = Math.max(merged.hi[a], g.hi[a]); }
    }
    return merged;
  };
  if (o.skipPack) {
    for (const [label, g] of groups) objects.push({ ...g, id: idOf(label), skipped: true, skipReason: "pack skipped" });
  } else if (o.wholeFile) {
    objects.push({ ...mergeGroups([...groups.keys()], o.wholeFile), id: o.wholeFile });
  } else {
    for (const [id, labels] of Object.entries(o.merge ?? {})) objects.push({ ...mergeGroups(labels, id), id });
    for (const [label, g] of groups) {
      if (consumed.has(label)) continue;
      const rename = o.rename?.[label];
      if (rename === null || (o.skip ?? []).includes(label)) { objects.push({ ...g, id: idOf(label), skipped: true, skipReason: o.skipReason?.[label] ?? "not useful / fragment" }); continue; }
      objects.push({ ...g, id: rename ?? idOf(label), autoNamed: !rename });
    }
  }
  const taken = new Set(Object.keys(index.models));
  for (const obj of objects) {
    const size = [0, 1, 2].map((a) => (obj.hi[a] - obj.lo[a]) * scale);
    const explicit = o.height?.[obj.id] ?? o.height?.[obj.label];
    obj.worldHeight = explicit ?? Math.max(0.02, size[1]);
    const factor = explicit ? explicit / Math.max(1e-6, size[1]) : 1;
    obj.footprint = size.map((v) => v * factor);
    obj.folder = o.folderFor?.[obj.id] ?? o.folder ?? `props/${pack}`;
    obj.name = o.names?.[obj.id] ?? title(obj.id);
    // Detail: things the player handles — food, plants, tableware, utensils, small kitchen kit
    // (longest side under 70 cm) — go to ultra; everything else the pack's tier (default fine).
    const handled = /^(food|decor\/plants|decor\/hanging|decor\/plant_shelf|dining\/tableware|kitchen\/utensils|kitchen\/kitchen_assets)/.test(obj.folder) && Math.max(...size) * (explicit ? factor : 1) <= 0.7;
    obj.detail = o.detailFor?.[obj.id] ?? (handled ? "ultra" : (o.detail ?? "fine"));
    if (!obj.skipped) {
      obj.clash = taken.has(obj.id) ? (index.models[obj.id].folder ?? "") : null;
      if (obj.clash !== null) { obj.finalId = `${obj.id}_${o.slug ?? pack.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 60); } else obj.finalId = obj.id;
      taken.add(obj.finalId);
      obj.tags = [...new Set([...(o.tags ?? []), ...(o.tagsFor?.[obj.id] ?? []), ...suggestTags(obj.finalId, obj.name, obj.folder)])];
      obj.tags = [...new Set(obj.tags)];
      obj.flags = [];
      if (obj.worldHeight > 3) obj.flags.push("very tall — check units");
      if (Math.max(...obj.footprint) < 0.05) obj.flags.push("tiny — check units");
      if (obj.autoNamed && /^(cube|cylinder|plane|sphere|material|object|mesh|group)[_ .]?\d*/i.test(obj.label)) obj.flags.push("anonymous mesh — name it");
      if (obj.faces > 150000) obj.flags.push(`${(obj.faces / 1000).toFixed(0)}k triangles — slow to convert`);
      if (obj.missing) obj.flags.push(`merge parts not found: ${obj.missing.join(", ")}`);
    }
  }
  packs.push({ pack, file: `${pack}.glb`, sourceFile: existsSync(join(sourceDir, `${pack}.glb`)) ? join(sourceDir, `${pack}.glb`) : null, note: o.note ?? "", scale, unitGuess: o.units ?? (scale === 1 ? "metres" : `×${scale}`), meshes: inspected.nodes.length, faces: inspected.faces, extent: inspected.size, objects, folder: o.folder ?? `props/${pack}` });
}

// ---------------------------------------------------------------- report --
const lines = [];
const totalImport = packs.reduce((s, p) => s + p.objects.filter((o) => !o.skipped).length, 0);
const totalSkip = packs.reduce((s, p) => s + p.objects.filter((o) => o.skipped).length, 0);
const totalFlags = packs.reduce((s, p) => s + p.objects.filter((o) => !o.skipped && o.flags.length).length, 0);
lines.push(`# Import report — dry run`, ``, `Source: \`${sourceDir}\` · ${packs.length} files · **${totalImport} objects to import**, ${totalSkip} skipped, ${totalFlags} flagged for a look. Nothing has been converted. Edit \`scripts/import-overrides.json\` (names, scales, merges, skips, folders) and re-run \`node scripts/import-plan.mjs\` until this reads right; then \`node scripts/import-batch.mjs\` converts everything in \`.art-assets/import-plan.json\`.`, ``,
  `Columns: **id** is the catalog id (a \`→\` shows the id after a clash rename), **h** the height in the game after unit scaling, **parts** how many meshes make the object, **tri** the source triangles. Tags come from the keyword rules and can be corrected in the lab afterwards.`, ``);
lines.push(`## Packs at a glance`, ``, `| pack | meshes → objects | units | folder | note |`, `|---|---|---|---|---|`);
for (const p of packs) lines.push(`| ${p.pack} | ${p.meshes} → ${p.objects.filter((o) => !o.skipped).length}${p.objects.some((o) => o.skipped) ? ` (+${p.objects.filter((o) => o.skipped).length} skipped)` : ""} | ${p.unitGuess} | \`${p.folder}\` | ${p.note} |`);
lines.push(``);
for (const p of packs) {
  lines.push(`## ${p.pack}`, ``, `\`${p.file}\` · ${p.meshes} meshes · ${p.faces.toLocaleString()} triangles · file extent ${p.extent.map((v) => v.toFixed(2)).join(" × ")} (raw units) · scale ×${p.scale} (${p.unitGuess}) · folder \`${p.folder}\``);
  if (p.note) lines.push(``, `> ${p.note}`);
  lines.push(``, `| id | name | h | parts | tri | tags | notes |`, `|---|---|---|---|---|---|---|`);
  for (const o of p.objects.filter((x) => !x.skipped)) {
    const idText = o.clash !== null ? `\`${o.id}\` → \`${o.finalId}\`` : `\`${o.finalId}\``;
    const notes = [...(o.clash !== null ? [`id taken by \`${o.clash || "(unfiled)"}\``] : []), ...(o.merged ? [`${o.merged} parts merged`] : []), ...(o.folder !== p.folder ? [`→ \`${o.folder}\``] : []), ...(o.detail !== (overrides.packs[p.pack]?.detail ?? "fine") ? [`detail ${o.detail}`] : []), ...o.flags.map((f) => `⚠️ ${f}`)];
    lines.push(`| ${idText} | ${o.name} | ${cm(o.worldHeight)} | ${o.nodes.length} | ${o.faces.toLocaleString()} | ${o.tags.join(", ")} | ${notes.join(" · ")} |`);
  }
  const skipped = p.objects.filter((x) => x.skipped);
  if (skipped.length) lines.push(``, `Skipped: ${skipped.map((o) => `\`${o.label}\` (${o.skipReason})`).join(", ")}`);
  lines.push(``);
}
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs/IMPORT_REPORT.md"), lines.join("\n"));

// ------------------------------------------------------------------ plan --
const plan = { version: 1, generated: new Date().toISOString(), source: sourceDir, packs: packs.map((p) => ({ pack: p.pack, file: p.file, sourceFile: p.sourceFile, scale: p.scale, folder: p.folder, objects: p.objects.filter((o) => !o.skipped).map((o) => ({ id: o.finalId, name: o.name, folder: o.folder, tags: o.tags, nodes: o.nodes, worldHeight: Math.round(o.worldHeight * 1000) / 1000, footprint: o.footprint.map((v) => Math.round(v * 1000) / 1000), detail: o.detail, faces: o.faces, flags: o.flags })) })) };
mkdirSync(join(root, ".art-assets"), { recursive: true });
writeFileSync(join(root, ".art-assets/import-plan.json"), JSON.stringify(plan, null, 1));
console.log(`report: docs/IMPORT_REPORT.md · plan: .art-assets/import-plan.json · ${totalImport} objects to import, ${totalSkip} skipped, ${totalFlags} flagged`);
