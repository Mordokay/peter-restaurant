import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error plain ESM helper shared with the node scripts
import { readCatalog, writeModel, deleteModel as removeModel, stringifyCatalog } from "./scripts/catalog-io.mjs";

type CatalogModel = { id: string; name?: string; folder?: string; pitch: number; palette: Record<string, string>; parts: unknown[] };
type CatalogOnDisk = { version: number; models: Record<string, CatalogModel>; fileOf: Map<string, string> };
const loadCatalog = (): CatalogOnDisk => readCatalog() as CatalogOnDisk;

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
      server.middlewares.use("/__lab/import-model", (request, response) => {
        if (request.method !== "POST") { response.statusCode = 405; response.end("POST only"); return; }
        void readJsonBody(request).then((raw) => {
          const { id, name, fileName, data, height, worldHeight, geometry, foldFragments, folder } = raw as { id: string; name?: string; fileName: string; data: string; height?: number; worldHeight?: number; geometry?: string; foldFragments?: number; folder?: string };
          if (!/^[a-z0-9_]{1,64}$/.test(id)) throw new Error("id must be lower-case letters, digits and underscores");
          if (!/\.(glb|gltf|obj)$/i.test(fileName ?? "")) throw new Error("pick a .glb, .gltf or .obj file");
          if (loadCatalog().models[id]) throw new Error(`${id} already exists — pick another id or delete it first`);
          const root = fileURLToPath(new URL("./", import.meta.url));
          const importDir = join(root, ".art-assets", "imports");
          mkdirSync(importDir, { recursive: true });
          const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
          const source = join(importDir, `${id}${extension}`);
          const grid = join(importDir, `${id}.vox.json`);
          writeFileSync(source, Buffer.from(data.replace(/^data:[^,]*,/, ""), "base64"));
          const log: string[] = [];
          const run = (command: string, args: string[]) => {
            log.push(`$ ${command} ${args.join(" ")}`);
            log.push(execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }));
          };
          const convert = ["scripts/voxelize-mesh.py", source, grid, "--height", String(Math.max(8, Math.min(400, Math.round(height ?? 64)))), "--shadeTolerance", "0.12", "--flatten", "0.35"];
          if (geometry && geometry.trim()) convert.push("--geometry", geometry.trim());
          run("python3", convert);
          const fold = typeof foldFragments === "number" && Number.isFinite(foldFragments) && foldFragments >= 0 ? Math.min(0.5, foldFragments) : 0.01;
          run("node", ["scripts/voxels-to-model.mjs", grid, id, String(worldHeight && worldHeight > 0 ? worldHeight : 0.5), "--keepSourceParts", "--foldFragments", String(fold)]);
          run("node", ["scripts/rig-model.mjs", id]);
          const imported = loadCatalog().models[id]!;
          if (name && name.trim()) imported.name = name.trim();
          const cleanFolder = (folder ?? "").trim().replace(/^\/+|\/+$/g, "");
          if (cleanFolder) imported.folder = cleanFolder;
          writeModel(imported);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ ok: true, id, model: imported, log: log.join("\n") }));
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
      },
    },
  },
});
