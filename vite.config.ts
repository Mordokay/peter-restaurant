import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error plain ESM helper shared with the node scripts
import { hasModel, readModel, writeModel, writeThumbnail, deleteModel as removeModel, stringifyCatalog } from "./scripts/catalog-io.mjs";
import { DETAIL_TIERS, clampVoxelHeight, initialVoxelHeight, isImportDetail, type ImportDetail } from "./src/game/importDetail";
import { validateLevelLayout, type LevelLayout } from "./src/game/levelLayout";

type CatalogModel = { id: string; name?: string; folder?: string; pitch: number; palette: Record<string, string>; parts: unknown[] };
type CatalogOnDisk = { version: number; models: Record<string, CatalogModel> };
// A lazy view of the catalog on disk: `models[id]` reads one file, `id in models` checks one
// path. The endpoints only ever look at a model or two, and reading all 346 files per request
// (176 MB) made every save and import wait seconds.
const loadCatalog = (): CatalogOnDisk => ({
  version: 1,
  models: new Proxy({} as Record<string, CatalogModel>, {
    get: (_, id) => (typeof id === "string" && hasModel(id) ? (readModel(id) as CatalogModel) : undefined),
    has: (_, id) => typeof id === "string" && hasModel(id),
  }),
});

/** Dev-only endpoint the Model Lab editor uses to make edits permanent:
 * POST /__lab/save-model with { model } replaces (or adds) that model in the
 * catalog file of its folder (src/assets/catalog/*.json). Only catalog files
 * can be written, the id is validated, and the change goes through Vite's
 * normal HMR like a hand edit. */
function labCatalogSaver(): Plugin {
  return {
    name: "farm-to-table-lab-catalog-saver",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__lab/save-model", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("POST only");
          return;
        }
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          try {
            const { model } = JSON.parse(body) as { model: CatalogModel };
            if (!model || typeof model.id !== "string" || !/^[a-z0-9_]{1,64}$/.test(model.id)) throw new Error("model.id must be lower-case letters, digits and underscores");
            if (!(model.pitch > 0 && model.pitch <= 0.1) || !Array.isArray(model.parts) || model.parts.length === 0) throw new Error("model needs a valid pitch and at least one part");
            const catalog = loadCatalog();
            const existed = model.id in catalog.models;
            // A save without a folder keeps the model where it lives.
            if (model.folder === undefined && catalog.models[model.id]?.folder) model.folder = catalog.models[model.id]!.folder;
            writeModel(model);
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ok: true, id: model.id, existed }));
          } catch (error) {
            response.statusCode = 400;
            response.end(String((error as Error).message ?? error));
          }
        });
      });
    },
  };
}

/** Dev-only: POST /__lab/rename-model { from, to?, name?, folder? } moves a
 * catalog entry to a new id, display name and/or folder (folder = which file
 * stores it). Code that references the old id is NOT rewritten — the response
 * lists source files that mention it. */
function labCatalogRenamer(): Plugin {
  return {
    name: "farm-to-table-lab-catalog-renamer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__lab/rename-model", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        let body = "";
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          try {
            const { from, to, name, folder } = JSON.parse(body) as { from: string; to?: string; name?: string; folder?: string };
            const catalog = loadCatalog();
            const model = catalog.models[from];
            if (!model) throw new Error(`${from} is not in the catalog`);
            const target = (to ?? from).trim();
            if (!/^[a-z0-9_]{1,64}$/.test(target)) throw new Error("id must be lower-case letters, digits and underscores");
            if (target !== from && catalog.models[target]) throw new Error(`${target} already exists`);
            if (name !== undefined) { if (name.trim()) model.name = name.trim(); else delete model.name; }
            if (folder !== undefined) {
              const clean = folder.trim().replace(/^\/+|\/+$/g, "");
              if (clean && !/^[a-z0-9_\- ]+(\/[a-z0-9_\- ]+)*$/i.test(clean)) throw new Error("folder must be letters, digits, spaces, _ or -, with / between levels");
              if (clean) model.folder = clean; else delete model.folder;
            }
            if (target !== from) { removeModel(from); model.id = target; }
            writeModel(model);
            // Warn about code references to the old id (tests, rigs, stages).
            const references = target !== from ? referencesTo(from) : [];
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ok: true, id: target, name: model.name ?? null, folder: model.folder ?? null, references }));
          } catch (error) {
            response.statusCode = 400;
            response.end(String((error as Error).message ?? error));
          }
        });
      });
    },
  };
}

/** Files under src/ and scripts/ that mention a model id (excluding the catalog itself). */
function referencesTo(id: string): string[] {
  const references: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "assets") walk(full); }
      else if (/\.(ts|mjs|js)$/.test(entry.name) && readFileSync(full, "utf8").includes(id)) references.push(relative(process.cwd(), full));
    }
  };
  walk(fileURLToPath(new URL("./src", import.meta.url)));
  walk(fileURLToPath(new URL("./scripts", import.meta.url)));
  return references;
}

function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    request.on("error", reject);
  });
}

/** Dev-only: POST /__lab/delete-model { id, force? } removes a catalog entry.
 * Refused (409 with the file list) when game code references the id, unless
 * force is set. POST /__lab/import-model { id, name?, fileName, data(base64),
 * height, worldHeight, geometry? } saves the .glb under .art-assets/imports and
 * runs the converter → emitter (source parts kept) → auto-rig, returning the log. */
function labCatalogManager(): Plugin {
  return {
    name: "farm-to-table-lab-catalog-manager",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__lab/delete-model", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const { id, force } = raw as { id: string; force?: boolean };
          const catalog = loadCatalog();
          if (!catalog.models[id]) throw new Error(`${id} is not in the catalog`);
          const references = referencesTo(id);
          response.setHeader("content-type", "application/json");
          if (references.length && !force) { response.statusCode = 409; response.end(JSON.stringify({ ok: false, references })); return; }
          removeModel(id);
          response.end(JSON.stringify({ ok: true, id, references }));
        }).catch((error: Error) => { response.statusCode = 400; response.end(String(error.message ?? error)); });
      });
      // Decorate mode writes the hand-placed props of the game world.
      server.middlewares.use("/__lab/save-scene", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const { layout } = raw as { layout: { version: number; props: { id: string; model: string; position: number[] }[] } };
          if (!layout || layout.version !== 1 || !Array.isArray(layout.props)) throw new Error("layout needs version 1 and a props array");
          const catalog = loadCatalog();
          const seen = new Set<string>();
          for (const prop of layout.props) {
            if (!/^[a-z0-9_]{1,64}$/i.test(prop.id) || seen.has(prop.id)) throw new Error(`bad or repeated prop id ${prop.id}`);
            seen.add(prop.id);
            if (!catalog.models[prop.model]) throw new Error(`prop ${prop.id} uses unknown model ${prop.model}`);
            if (!Array.isArray(prop.position) || prop.position.length !== 3 || prop.position.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error(`prop ${prop.id} has an invalid position`);
          }
          const scenePath = fileURLToPath(new URL("./src/assets/scene/decor.json", import.meta.url));
          writeFileSync(scenePath, stringifyCatalog(layout));
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, props: layout.props.length }));
        }).catch((error: Error) => { response.statusCode = 400; response.end(String(error.message ?? error)); });
      });
      // Describe an uploaded file (saved under .art-assets/imports) so the lab can offer a split import.
      // Build mode writes the site plan: rooms, walls, doors, ground and what each costs.
      server.middlewares.use("/__lab/save-level", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const layout = raw as unknown as LevelLayout;
          const problems = validateLevelLayout(layout);
          if (problems.length) throw new Error(`invalid level plan: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`);
          const levelPath = fileURLToPath(new URL("./src/assets/scene/level.json", import.meta.url));
          writeFileSync(levelPath, `${JSON.stringify(layout, null, 2)}\n`);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, rooms: layout.rooms.length, walls: layout.walls.length }));
        }).catch((error: Error) => {
          response.statusCode = 400;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: false, error: String(error.message ?? error) }));
        });
      });
      server.middlewares.use("/__lab/inspect-model", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const { fileName, data } = raw as { fileName: string; data: string };
          if (!/\.(glb|gltf|obj)$/i.test(fileName ?? "")) throw new Error("pick a .glb, .gltf or .obj file");
          const root = fileURLToPath(new URL("./", import.meta.url));
          const importDir = join(root, ".art-assets", "imports");
          mkdirSync(importDir, { recursive: true });
          const sourceFile = `upload_${Date.now()}${fileName.slice(fileName.lastIndexOf(".")).toLowerCase()}`;
          writeFileSync(join(importDir, sourceFile), Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"));
          const info = JSON.parse(execFileSync("python3", ["scripts/inspect-mesh.py", join(importDir, sourceFile)], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 })) as Record<string, unknown>;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, sourceFile, ...info }));
        }).catch((error: Error & { stderr?: string }) => { response.statusCode = 400; response.end(`${error.message ?? error}${error.stderr ? `\n${error.stderr}` : ""}`); });
      });
      // The lab renders a thumbnail after an import or a save and posts it here (PNG, base64).
      server.middlewares.use("/__lab/save-thumbnail", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const { id, data } = raw as { id: string; data: string };
          if (!/^[a-z0-9_]{1,64}$/.test(id) || !hasModel(id)) throw new Error(`${id} is not in the catalog`);
          const png = Buffer.from(String(data).replace(/^data:[^,]*,/, ""), "base64");
          if (png.length < 100 || png.length > 2_000_000) throw new Error("thumbnail must be a PNG between 100 B and 2 MB");
          const thumb = writeThumbnail(id, png);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, id, bytes: png.length, thumb }));
        }).catch((error: Error) => { response.statusCode = 400; response.end(String(error.message ?? error)); });
      });
      server.middlewares.use("/__lab/import-model", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const { id, name, fileName, data, sourceFile, sourceName, replace, height, worldHeight, geometry, exact, foldFragments, folder, footprint } = raw as { id: string; name?: string; fileName: string; data?: string; sourceFile?: string; sourceName?: string; replace?: boolean; height?: number; worldHeight?: number; geometry?: string; exact?: boolean; foldFragments?: number; folder?: string; detail?: string; footprint?: [number, number, number] };
          const detail: ImportDetail = isImportDetail((raw as { detail?: string }).detail) ? (raw as { detail: ImportDetail }).detail : "normal";
          if (!/^[a-z0-9_]{1,64}$/.test(id)) throw new Error("id must be lower-case letters, digits and underscores");
          if (!/\.(glb|gltf|obj)$/i.test(fileName ?? "")) throw new Error("pick a .glb, .gltf or .obj file");
          if (!data && !sourceFile) throw new Error("send the file data or the sourceFile of a previous inspect");
          const existing = loadCatalog().models[id];
          const requestedFolder = (folder ?? "").trim().replace(/^\/+|\/+$/g, "");
          if (existing && !replace) throw new Error(`${id} already exists — pick another id, or tick "replace"`);
          // Replace only re-imports a model in its own folder. The same id in another folder is a
          // different object from another pack (two packs both have "knife_01"); the client renames.
          if (existing && replace && folder !== undefined && (existing.folder ?? "") !== requestedFolder) {
            response.statusCode = 409;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ok: false, conflict: true, id, folder: existing.folder ?? "" }));
            return;
          }
          const root = fileURLToPath(new URL("./", import.meta.url));
          const importDir = join(root, ".art-assets", "imports");
          mkdirSync(importDir, { recursive: true });
          const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
          // A collection file is kept once under its own name (sourceName) and shared by every object
          // split out of it; a single object keeps its source under its id.
          if (sourceName !== undefined && !/^[a-z0-9_]{1,64}$/.test(sourceName)) throw new Error("sourceName must be lower-case letters, digits and underscores");
          const source = join(importDir, `${sourceName ?? id}${extension}`);
          const grid = join(importDir, `${id}.vox.json`);
          if (data) writeFileSync(source, Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"));
          else if (sourceFile && /^upload_\d+\.(glb|gltf|obj)$/.test(sourceFile)) { if (!sourceName || !existsSync(source)) copyFileSync(join(importDir, sourceFile), source); }
          else throw new Error("unknown sourceFile");
          const log: string[] = [];
          const run = (command: string, args: string[]) => {
            log.push(`$ ${command} ${args.join(" ")}`);
            log.push(execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }));
          };
          // Voxel size is chosen automatically: convert, count the voxels the game would carry, and
          // re-run with a coarser or finer grid until the model lands near its budget. The budget is
          // the only knob the artist sees (chunky / normal / fine). Room-sized pieces (taller than
          // 1.5 m in the game) skip the finer LOD lattice — a 5 m kitchen at "256" once made a 63M-cell grid.
          const metres = worldHeight && worldHeight > 0 ? worldHeight : 0.5;
          const { budget, cap } = DETAIL_TIERS[detail];
          // Tiers (src/game/importDetail.ts) set the budget and the smallest voxel allowed; a wide, flat
          // footprint (a tray of foods) starts coarser so the first pass stays sane.
          let voxelHeight = height && height > 0 ? clampVoxelHeight(height, metres, detail, footprint) : initialVoxelHeight(metres, detail, footprint);
          const convertAt = (h: number) => {
            const convert = ["scripts/voxelize-mesh.py", source, grid, "--height", String(h), "--shadeTolerance", "0.12", "--flatten", "0.35"];
            if (metres > 1.5) convert.push("--lodLevels", "1");
            if (geometry && geometry.trim()) { convert.push("--geometry", geometry.trim()); if (exact) convert.push("--exact", "1"); }
            run("python3", convert);
            const parsed = JSON.parse(readFileSync(grid, "utf8")) as { parts: { cells: unknown[]; scale?: number }[] };
            return parsed.parts.reduce((sum, part) => sum + part.cells.length * (part.scale ?? 1) ** 3, 0);
          };
          let voxels = convertAt(voxelHeight);
          for (let attempt = 0; attempt < 3; attempt++) {
            // Surface voxel count grows with the square of the grid height.
            const ratio = Math.sqrt(budget / Math.max(1, voxels));
            const next = clampVoxelHeight(voxelHeight * (voxels > budget * 1.15 ? ratio : voxels < budget * 0.45 && voxelHeight < cap ? ratio * 0.9 : 1), metres, detail, footprint);
            if (next === voxelHeight) break;
            voxelHeight = next;
            voxels = convertAt(voxelHeight);
          }
          log.push(`auto detail: ${voxelHeight} voxels tall (~${(metres / voxelHeight * 100).toFixed(1)} cm voxels), ${voxels.toLocaleString()} voxels for a ${detail} budget of ${budget.toLocaleString()}`);
          const fold = typeof foldFragments === "number" && Number.isFinite(foldFragments) && foldFragments >= 0 ? Math.min(0.5, foldFragments) : 0.01;
          // Replacing: the old model goes only now that the conversion itself succeeded.
          if (existing) { log.push(`replacing ${id}`); removeModel(id); }
          try {
            run("node", ["scripts/voxels-to-model.mjs", grid, id, String(worldHeight && worldHeight > 0 ? worldHeight : 0.5), "--keepSourceParts", "--foldFragments", String(fold)]);
            run("node", ["scripts/rig-model.mjs", id]);
          } catch (error) {
            // A half-written model must not linger in the catalog.
            try { removeModel(id); } catch { /* nothing written */ }
            throw error;
          }
          const imported = loadCatalog().models[id]!;
          if (name && name.trim()) imported.name = name.trim();
          const cleanFolder = (folder ?? existing?.folder ?? "").trim().replace(/^\/+|\/+$/g, "");
          if (cleanFolder) imported.folder = cleanFolder;
          writeModel(imported);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, id, model: imported, log: log.join("\n"), voxelHeight, voxels, voxelSize: metres / voxelHeight }));
        }).catch((error: Error & { stderr?: string; stdout?: string }) => {
          response.statusCode = 400;
          response.end(`${error.message ?? error}${error.stderr ? `\n${error.stderr}` : ""}${error.stdout ? `\n${error.stdout}` : ""}`);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [labCatalogSaver(), labCatalogRenamer(), labCatalogManager()],
  build: {
    rollupOptions: {
      input: {
        game: "index.html",
        modelLab: "model-lab.html",
        stress: "stress.html",
        world: "world.html",
      },
    },
  },
});
