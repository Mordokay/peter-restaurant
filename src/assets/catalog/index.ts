// The authored voxel catalog as the app sees it: every `*.json` in this folder
// (one file per top-level model folder, written by scripts/catalog-io.mjs)
// merged into a single { version, models } object. Vite's eager glob keeps HMR
// working: saving a model from the lab rewrites one file and importers that
// accept this module get the merged result.
import type { AuthoredVoxelCatalog, AuthoredVoxelModel } from "../../game/voxelModel";

type CatalogFile = { version: number; models: Record<string, AuthoredVoxelModel> };

const files = import.meta.glob("./*.json", { eager: true }) as Record<string, { default: CatalogFile }>;

export function mergeCatalogFiles(sources: Record<string, { default: CatalogFile }>): AuthoredVoxelCatalog {
  const models: Record<string, AuthoredVoxelModel> = {};
  for (const path of Object.keys(sources).sort()) {
    for (const [id, model] of Object.entries(sources[path]!.default.models)) models[id] = model;
  }
  return { version: 1, models };
}

export const catalog: AuthoredVoxelCatalog = mergeCatalogFiles(files);

// Self-accepting HMR: when a catalog file is rewritten (a save from the lab),
// the merged models are copied into the SAME object every importer holds, so
// neither the lab nor the game reloads — even when both pages share this dev
// server's module graph.
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const fresh = (updated as { catalog?: AuthoredVoxelCatalog } | undefined)?.catalog;
    if (!fresh) return;
    const models = catalog.models as Record<string, AuthoredVoxelModel>;
    for (const id of Object.keys(models)) if (!(id in fresh.models)) delete models[id];
    Object.assign(models, fresh.models);
  });
}
