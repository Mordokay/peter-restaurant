// The authored voxel catalog on disk, version 2.1: one deflated VXM binary per model in
// public/catalog-models/<id>.vxm plus a small src/assets/catalog/index.json
// that lists every model (name, folder, tags, size, counts, clip ids, thumbnail)
// so the lab and the game can browse 800 objects without parsing 500 MB of voxels.
// Model files load lazily at runtime (src/assets/catalog/index.ts); thumbnails live
// in public/catalog-thumbs/<id>.png. Every writer — the lab's dev endpoints,
// the emitter, the rigger, tests — goes through here.
//
// Version 1 (one pretty JSON per folder, later sharded at 40 MB) is migrated by
// `migrateCatalogV1()`; `readCatalog()` keeps returning the merged { models } view.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { decodeVxm, encodeVxm, isVxm } from "../src/game/vxmFormat.ts";

export const catalogDir = fileURLToPath(new URL("../src/assets/catalog/", import.meta.url));
// Models are deflated VXM binaries (src/game/vxmFormat.ts) under public/, served at
// /catalog-models/<id>.vxm like the thumbnails — static files, no import graph.
export const modelsDir = fileURLToPath(new URL("../public/catalog-models/", import.meta.url));
export const MODEL_EXT = ".vxm";
// Thumbnails are static files (no import graph, no HMR reloads when 600 of them appear):
// public/catalog-thumbs/<id>.png, served at /catalog-thumbs/<id>.png.
export const thumbsDir = fileURLToPath(new URL("../public/catalog-thumbs/", import.meta.url));
export const indexPath = join(catalogDir, "index.json");

const ID = /^[a-z0-9_]{1,64}$/;
function assertId(id) { if (typeof id !== "string" || !ID.test(id)) throw new Error(`bad model id ${JSON.stringify(id)}`); }
export function modelPath(id) { assertId(id); return join(modelsDir, `${id}${MODEL_EXT}`); }
/** Legacy location of the JSON model files (catalog v2.0), read once by migrateModelsToVxm(). */
export const legacyModelsDir = join(catalogDir, "models");
export function thumbPath(id) { assertId(id); return join(thumbsDir, `${id}.png`); }

// ------------------------------------------------------------------ index --

/** The index entry derived from a model: everything a browser needs without the voxels. */
export function indexEntry(model, previous = {}) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, voxels = 0;
  const grow = (x0, y0, z0, x1, y1, z1) => {
    if (x0 < minX) minX = x0; if (y0 < minY) minY = y0; if (z0 < minZ) minZ = z0;
    if (x1 > maxX) maxX = x1; if (y1 > maxY) maxY = y1; if (z1 > maxZ) maxZ = z1;
  };
  let states = 0;
  for (const part of model.parts ?? []) {
    const geometries = [part, ...Object.values(part.states ?? {})];
    states += Object.keys(part.states ?? {}).length;
    for (const [gi, geometry] of geometries.entries()) {
      for (const [x0, y0, z0, x1, y1, z1] of geometry.boxes ?? []) {
        grow(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
        if (gi === 0) voxels += (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1) * (Math.abs(z1 - z0) + 1);
      }
      for (const [y, z, x0, x1] of geometry.runs ?? []) { grow(Math.min(x0, x1), y, z, Math.max(x0, x1), y, z); if (gi === 0) voxels += Math.abs(x1 - x0) + 1; }
      for (const [x, y, z] of geometry.voxels ?? []) { grow(x, y, z, x, y, z); if (gi === 0) voxels += 1; }
    }
  }
  const pitch = Number(model.pitch) || 0;
  const size = Number.isFinite(minX) ? [(maxX - minX + 1) * pitch, (maxY - minY + 1) * pitch, (maxZ - minZ + 1) * pitch].map((v) => Math.round(v * 1000) / 1000) : [0, 0, 0];
  const entry = {};
  if (model.name) entry.name = model.name;
  if (model.folder) entry.folder = model.folder;
  if (Array.isArray(model.tags) && model.tags.length) entry.tags = [...model.tags];
  entry.size = size;
  entry.voxels = voxels;
  entry.parts = (model.parts ?? []).length;
  if (states) entry.states = states;
  const clips = (model.clips ?? []).map((clip) => clip.id);
  if (clips.length) entry.clips = clips;
  if (model.emissive && Object.keys(model.emissive).length) entry.glow = true;
  if (model.lights && model.lights.length) entry.lights = model.lights.length;
  if (model.emitters && model.emitters.length) entry.emitters = model.emitters.length;
  if (previous.thumb) entry.thumb = previous.thumb;  // seconds since epoch of the last render (cache-buster)
  if (previous.rev) entry.rev = previous.rev;  // seconds since epoch of the last model write (cache-buster)
  return entry;
}

function emptyIndex() { return { version: 2, models: {} }; }

export function readIndex() {
  if (!existsSync(indexPath)) return emptyIndex();
  const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!parsed || parsed.version !== 2 || !parsed.models) throw new Error(`${indexPath} is not a version 2 catalog index`);
  return parsed;
}

/** Index files are written one model per line: diffs stay one line per changed model. */
export function stringifyIndex(index) {
  const ids = Object.keys(index.models).sort();
  return `{\n  "version": 2,\n  "models": {\n${ids.map((id, i) => `    ${JSON.stringify(id)}: ${JSON.stringify(index.models[id])}${i < ids.length - 1 ? "," : ""}`).join("\n")}\n  }\n}\n`;
}

export function writeIndex(index) {
  mkdirSync(catalogDir, { recursive: true });
  writeFileSync(indexPath, stringifyIndex(index));
}

/** Rebuild index.json from every model file (after a hand edit or a migration). */
export function rebuildIndex() {
  const previous = existsSync(indexPath) ? readIndex() : emptyIndex();
  const index = emptyIndex();
  for (const id of listModelIds()) {
    const entry = indexEntry(readModel(id), previous.models[id] ?? {});
    entry.rev = Math.floor(statSync(modelPath(id)).mtimeMs / 1000);
    if (existsSync(thumbPath(id))) entry.thumb = Math.floor(statSync(thumbPath(id)).mtimeMs / 1000); else delete entry.thumb;
    index.models[id] = entry;
  }
  writeIndex(index);
  return index;
}

// ----------------------------------------------------------------- models --

export function listModelIds() {
  if (!existsSync(modelsDir)) return [];
  return readdirSync(modelsDir).filter((name) => name.endsWith(MODEL_EXT)).map((name) => name.slice(0, -MODEL_EXT.length)).filter((id) => ID.test(id)).sort();
}

export function hasModel(id) { return ID.test(String(id)) && existsSync(modelPath(id)); }

export function readModel(id) {
  const raw = readFileSync(modelPath(id));
  const bytes = new Uint8Array(isVxm(raw) ? raw : inflateSync(raw));
  const parsed = decodeVxm(bytes);
  if (!parsed || parsed.id !== id) throw new Error(`${modelPath(id)} does not hold model ${id}`);
  return parsed;
}

/** Every model, merged into one { version, models } catalog (tests, the rigger, validation). */
export function readCatalog() {
  const models = {};
  const fileOf = new Map();
  for (const id of listModelIds()) { models[id] = readModel(id); fileOf.set(id, `catalog-models/${id}${MODEL_EXT}`); }
  return { version: 1, models, fileOf };
}

/** Model files are deflated VXM: 6.5× smaller than compact JSON (525 MB → 80 MB for 589 models). */
export function encodeModelFile(model) { return deflateSync(Buffer.from(encodeVxm(model)), { level: 6 }); }

/** Add or replace a model: its file plus its index line. */
export function writeModel(model) {
  if (!model || typeof model.id !== "string") throw new Error("writeModel needs a model with an id");
  assertId(model.id);
  mkdirSync(modelsDir, { recursive: true });
  const existed = existsSync(modelPath(model.id));
  writeFileSync(modelPath(model.id), encodeModelFile(model));
  const index = readIndex();
  const entry = indexEntry(model, index.models[model.id] ?? {});
  entry.rev = Math.floor(Date.now() / 1000);
  if (existsSync(thumbPath(model.id))) entry.thumb = entry.thumb || Math.floor(statSync(thumbPath(model.id)).mtimeMs / 1000);
  index.models[model.id] = entry;
  writeIndex(index);
  return { file: `catalog-models/${model.id}${MODEL_EXT}`, existed };
}

/** Remove a model: file, thumbnail and index line. Returns the file name or null when absent. */
export function deleteModel(id) {
  assertId(id);
  const index = readIndex();
  const had = existsSync(modelPath(id)) || id in index.models;
  if (existsSync(modelPath(id))) unlinkSync(modelPath(id));
  if (existsSync(thumbPath(id))) unlinkSync(thumbPath(id));
  if (id in index.models) { delete index.models[id]; writeIndex(index); }
  return had ? `catalog-models/${id}${MODEL_EXT}` : null;
}

/** Record that a thumbnail exists (written by the lab through /__lab/save-thumbnail). */
export function writeThumbnail(id, pngBuffer) {
  assertId(id);
  mkdirSync(thumbsDir, { recursive: true });
  writeFileSync(thumbPath(id), pngBuffer);
  const stamp = Math.floor(Date.now() / 1000);
  const index = readIndex();
  if (index.models[id]) { index.models[id].thumb = stamp; writeIndex(index); }
  return stamp;
}

// -------------------------------------------------------------- migration --

/** Version 1 → 2: every `*.json` in the catalog folder (except index.json) that holds
 *  { version: 1, models } is split into models/<id>.json and removed. */
export function migrateCatalogV1() {
  const moved = [];
  for (const name of readdirSync(catalogDir).filter((n) => n.endsWith(".json") && n !== "index.json")) {
    const path = join(catalogDir, name);
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || !parsed.models) continue;
    mkdirSync(modelsDir, { recursive: true });
    for (const model of Object.values(parsed.models)) { writeFileSync(modelPath(model.id), encodeModelFile(model)); moved.push(model.id); }
    unlinkSync(path);
  }
  rebuildIndex();
  return moved;
}

/** Catalog v2.0 → v2.1: JSON model files in src/assets/catalog/models become deflated VXM files
 *  in public/catalog-models. The JSON files are removed after a successful round-trip check. */
export function migrateModelsToVxm() {
  if (!existsSync(legacyModelsDir)) return [];
  mkdirSync(modelsDir, { recursive: true });
  const moved = [];
  for (const name of readdirSync(legacyModelsDir).filter((n) => n.endsWith(".json"))) {
    const model = JSON.parse(readFileSync(join(legacyModelsDir, name), "utf8"));
    const file = encodeModelFile(model);
    const back = decodeVxm(new Uint8Array(inflateSync(file)));
    if (back.id !== model.id || back.parts.length !== model.parts.length) throw new Error(`VXM round-trip failed for ${model.id}`);
    writeFileSync(modelPath(model.id), file);
    unlinkSync(join(legacyModelsDir, name));
    moved.push(model.id);
  }
  rebuildIndex();
  return moved;
}

// ------------------------------------------------------------- utilities --

/** Pretty objects, inline arrays: `"pivot": [0, 1, 2]`, one run per line (decor.json, tests). */
export function stringifyCatalog(value) {
  return `${format(value, "")}\n`;
}

const isPrimitive = (v) => v === null || typeof v !== "object";

function format(value, indent) {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPrimitive)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    const inner = indent + "  ";
    return `[\n${value.map((v) => inner + format(v, inner)).join(",\n")}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const inner = indent + "  ";
  return `{\n${keys.map((key) => `${inner}${JSON.stringify(key)}: ${format(value[key], inner)}`).join(",\n")}\n${indent}}`;
}

/** Size of a model file on disk in bytes (0 when absent). */
export function modelFileSize(id) { return existsSync(modelPath(id)) ? statSync(modelPath(id)).size : 0; }
