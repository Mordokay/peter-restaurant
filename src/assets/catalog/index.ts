// The authored voxel catalog as the app sees it, version 2: a small index of every
// model (name, folder, tags, size, counts, clip ids, thumbnail) loaded eagerly, and
// the voxel data of each model loaded lazily from ./models/<id>.json the first time
// it is needed. `catalog.models` is the same object for the life of the page and
// fills up as models load, so game code that reads `catalog.models[id]` keeps
// working — it just has to `await ensureModels([...])` first.
//
// Written by scripts/catalog-io.mjs (the lab's dev endpoints, the emitter, the
// rigger). Thumbnails are public/catalog-thumbs/<id>.png, rendered by the lab.
import type { AuthoredVoxelCatalog, AuthoredVoxelModel } from "../../game/voxelModel";
import indexJson from "./index.json";

export interface CatalogIndexEntry {
  name?: string;
  folder?: string;
  tags?: string[];
  /** Width, height, depth in metres. */
  size: [number, number, number];
  voxels: number;
  parts: number;
  states?: number;
  clips?: string[];
  /** Seconds since epoch of the last thumbnail render (doubles as the image cache-buster). */
  thumb?: number | boolean;
}

type IndexFile = { version: number; models: Record<string, CatalogIndexEntry> };
type ModelModule = { default: AuthoredVoxelModel };

const modelFiles = import.meta.glob("./models/*.json") as Record<string, () => Promise<ModelModule>>;

/** Every model the catalog knows, without voxel data. Mutated in place on HMR and by the lab. */
export const catalogIndex: Record<string, CatalogIndexEntry> = (indexJson as unknown as IndexFile).models;

/** Loaded models. Same object forever; entries appear as models load. */
export const catalog: AuthoredVoxelCatalog = { version: 1, models: {} };

const pending = new Map<string, Promise<AuthoredVoxelModel | undefined>>();

export function labelOf(id: string, entry: CatalogIndexEntry | undefined = catalogIndex[id]): string {
  return entry?.name ?? id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isLoaded(id: string): boolean { return id in catalog.models; }

/** Thumbnails are static files under public/catalog-thumbs (served at /catalog-thumbs), not imports:
 *  600 PNGs in the module graph made every new one a full page reload. The index carries a
 *  render timestamp that busts the browser cache after a re-render. */
export function thumbnailUrl(id: string): string | undefined {
  const stamp = catalogIndex[id]?.thumb;
  return stamp ? `/catalog-thumbs/${id}.png?v=${typeof stamp === "number" ? stamp : 1}` : undefined;
}

/** Load one model's voxel data (cached). Resolves undefined for ids the catalog does not know. */
export function loadModel(id: string, options: { force?: boolean } = {}): Promise<AuthoredVoxelModel | undefined> {
  if (!options.force && catalog.models[id]) return Promise.resolve(catalog.models[id]);
  const loader = modelFiles[`./models/${id}.json`];
  if (!loader) return Promise.resolve(undefined);
  let promise = options.force ? undefined : pending.get(id);
  if (!promise) {
    promise = loader().then((module) => {
      const model = module.default;
      (catalog.models as Record<string, AuthoredVoxelModel>)[id] = model;
      pending.delete(id);
      return model;
    }, (error) => { pending.delete(id); throw error; });
    pending.set(id, promise);
  }
  return promise;
}

/** Make sure every id is in `catalog.models` (unknown ids are skipped, not errors). */
export async function ensureModels(ids: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(ids)].map((id) => loadModel(id)));
}

/** Load everything — only for tools that really need every voxel (validation, the whole-catalog tests). */
export async function ensureAllModels(): Promise<void> { await ensureModels(Object.keys(catalogIndex)); }

/** A model the lab just created or imported: make it known without a reload. */
export function registerModel(model: AuthoredVoxelModel, entry: CatalogIndexEntry): void {
  (catalog.models as Record<string, AuthoredVoxelModel>)[model.id] = model;
  catalogIndex[model.id] = entry;
}

export function forgetModel(id: string): void {
  delete (catalog.models as Record<string, AuthoredVoxelModel>)[id];
  delete catalogIndex[id];
}

/** Index entry recomputed from a loaded model (mirrors scripts/catalog-io.mjs indexEntry). */
export function entryFor(model: AuthoredVoxelModel, previous?: CatalogIndexEntry): CatalogIndexEntry {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, voxels = 0, states = 0;
  const grow = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => { minX = Math.min(minX, x0); minY = Math.min(minY, y0); minZ = Math.min(minZ, z0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1); maxZ = Math.max(maxZ, z1); };
  for (const part of model.parts) {
    states += Object.keys(part.states ?? {}).length;
    [part, ...Object.values(part.states ?? {})].forEach((geometry, gi) => {
      for (const [x0, y0, z0, x1, y1, z1] of geometry.boxes ?? []) { grow(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)); if (gi === 0) voxels += (Math.abs(x1 - x0) + 1) * (Math.abs(y1 - y0) + 1) * (Math.abs(z1 - z0) + 1); }
      for (const [y, z, x0, x1] of geometry.runs ?? []) { grow(Math.min(x0, x1), y, z, Math.max(x0, x1), y, z); if (gi === 0) voxels += Math.abs(x1 - x0) + 1; }
      for (const [x, y, z] of geometry.voxels ?? []) { grow(x, y, z, x, y, z); if (gi === 0) voxels += 1; }
    });
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const entry: CatalogIndexEntry = {
    size: Number.isFinite(minX) ? [round((maxX - minX + 1) * model.pitch), round((maxY - minY + 1) * model.pitch), round((maxZ - minZ + 1) * model.pitch)] : [0, 0, 0],
    voxels,
    parts: model.parts.length,
  };
  if (model.name) entry.name = model.name;
  if (model.folder) entry.folder = model.folder;
  if (model.tags?.length) entry.tags = [...model.tags];
  if (states) entry.states = states;
  if (model.clips?.length) entry.clips = model.clips.map((clip) => clip.id);
  if (previous?.thumb) entry.thumb = true;
  return entry;
}

// Self-accepting HMR: a save from the lab rewrites one model file and the index. The
// index is copied into the SAME object every importer holds, and every model that was
// loaded is re-fetched into the same `catalog.models`, so neither the lab nor the game
// reloads — even when both pages share this dev server's module graph.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    // A throwing accept callback makes Vite fall back to a full page reload — which would abort
    // a thumbnail batch or an edit session — so every step is guarded.
    try {
      const fresh = updated as typeof import("./index") | undefined;
      if (!fresh) return;
      for (const id of Object.keys(catalogIndex)) if (!(id in fresh.catalogIndex)) delete catalogIndex[id];
      Object.assign(catalogIndex, fresh.catalogIndex);
      const loaded = Object.keys(catalog.models);
      for (const id of loaded) {
        if (!(id in catalogIndex)) { delete (catalog.models as Record<string, AuthoredVoxelModel>)[id]; continue; }
        fresh.loadModel(id, { force: true }).then((model) => { if (model) (catalog.models as Record<string, AuthoredVoxelModel>)[id] = model; }, (error) => console.warn(`[catalog] reload of ${id} failed`, error));
      }
    } catch (error) {
      console.warn("[catalog] HMR update failed", error);
    }
  });
}
