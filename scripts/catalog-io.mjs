// The authored voxel catalog on disk: one JSON file per top-level folder in
// src/assets/catalog/ (`plants.json`, `kitchen.json`, `_root.json` for models
// without a folder). Every writer — the lab's dev endpoints, the emitter, the
// rigger, tests — goes through here so files stay compact and consistent.
//
// Files are written with arrays inline ("[1, 2, 3]" on one line, one run per
// line) instead of one number per line: the same data is ~6× smaller on disk
// and diffs stay readable.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const catalogDir = fileURLToPath(new URL("../src/assets/catalog/", import.meta.url));

/** File name (without directory) that holds models of this folder path. */
export function fileNameForFolder(folder) {
  const top = String(folder ?? "").split("/")[0].trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${top || "_root"}.json`;
}
export function fileForFolder(folder) { return join(catalogDir, fileNameForFolder(folder)); }

function listFiles() {
  if (!existsSync(catalogDir)) return [];
  return readdirSync(catalogDir).filter((name) => name.endsWith(".json")).sort();
}

function readFile(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.models) throw new Error(`${path} is not a catalog file`);
  return parsed;
}

/** Every model from every file, merged into one { version, models } catalog. */
export function readCatalog() {
  const models = {};
  const fileOf = new Map();
  for (const name of listFiles()) {
    const file = readFile(join(catalogDir, name));
    for (const [id, model] of Object.entries(file.models)) {
      if (models[id]) throw new Error(`model ${id} appears in two catalog files (${fileOf.get(id)} and ${name})`);
      models[id] = model;
      fileOf.set(id, name);
    }
  }
  return { version: 1, models, fileOf };
}

/** Add or replace a model in the file of its folder; removes it from any other file. */
export function writeModel(model) {
  if (!model || typeof model.id !== "string") throw new Error("writeModel needs a model with an id");
  mkdirSync(catalogDir, { recursive: true });
  const target = fileNameForFolder(model.folder);
  for (const name of listFiles()) {
    if (name === target) continue;
    const path = join(catalogDir, name);
    const file = readFile(path);
    if (!(model.id in file.models)) continue;
    delete file.models[model.id];
    if (Object.keys(file.models).length) writeFileSync(path, stringifyCatalog(file)); else unlinkSync(path);
  }
  const path = join(catalogDir, target);
  const file = existsSync(path) ? readFile(path) : { version: 1, models: {} };
  const existed = model.id in file.models;
  file.models[model.id] = model;
  writeFileSync(path, stringifyCatalog(file));
  return { file: target, existed };
}

/** Remove a model from whichever file holds it. */
export function deleteModel(id) {
  for (const name of listFiles()) {
    const path = join(catalogDir, name);
    const file = readFile(path);
    if (!(id in file.models)) continue;
    delete file.models[id];
    if (Object.keys(file.models).length) writeFileSync(path, stringifyCatalog(file)); else unlinkSync(path);
    return name;
  }
  return null;
}

/** Pretty objects, inline arrays: `"pivot": [0, 1, 2]`, one run per line. */
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
