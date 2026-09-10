// Source-mesh cache: meshing a catalog model into its world-renderer source (rig at
// rest, parts merged, coarse LOD twin) costs ~0.3 s per model on the main thread —
// twenty seconds for a sixty-model scene. The result depends only on the model's
// revision and the LOD pitch, so it is kept in IndexedDB as raw vertex buffers and
// restored in a few milliseconds. Warm the cache once (async) before building the
// scene; the world renderer then peeks synchronously.
import { Mesh, MultiMaterial, SubMesh, VertexData, type Scene, type StandardMaterial } from "@babylonjs/core";

const DB_NAME = "voxel-source-cache";
const STORE = "sources";
const VERSION = 1;
/** Bump when the serialized layout or the meshing itself changes. */
export const SOURCE_CACHE_FORMAT = 2;

export interface SerializedMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  /** Sub-mesh ranges and whether each draws with the lit or the glow material. */
  subMeshes: { kind: "lit" | "glow"; verticesStart: number; verticesCount: number; indexStart: number; indexCount: number }[];
}
export interface SerializedSource { full: SerializedMesh; coarse: SerializedMesh | null }

const memory = new Map<string, SerializedSource>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

/** Cache key of a model's source: id, catalog revision, LOD pitch and the format. */
export function sourceCacheKey(modelId: string, rev: number | undefined, lodPitch: number): string {
  return `${modelId}@${rev ?? 0}|lod:${lodPitch}|f${SOURCE_CACHE_FORMAT}`;
}

/** Load the given keys into memory (and drop stale revisions of the same models). Returns the number found. */
export async function warmSourceCache(keys: readonly string[]): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  const wanted = new Set(keys.filter((key) => !memory.has(key)));
  if (!wanted.size) return keys.filter((key) => memory.has(key)).length;
  const prefixes = new Set([...wanted].map((key) => key.slice(0, key.indexOf("@") + 1)));
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const all = store.getAllKeys();
    all.onsuccess = () => {
      for (const existing of all.result as string[]) {
        const prefix = existing.slice(0, existing.indexOf("@") + 1);
        if (prefixes.has(prefix) && !wanted.has(existing) && !memory.has(existing)) store.delete(existing); // an older revision or LOD of a model we are loading
      }
      for (const key of wanted) {
        const get = store.get(key);
        get.onsuccess = () => { if (get.result) memory.set(key, get.result as SerializedSource); };
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  return keys.filter((key) => memory.has(key)).length;
}

export function peekSource(key: string): SerializedSource | undefined { return memory.get(key); }

/** Remember a freshly meshed source (in memory now, on disk soon). */
export function storeSource(key: string, source: SerializedSource): void {
  memory.set(key, source);
  void openDb().then((db) => {
    if (!db) return;
    try { db.transaction(STORE, "readwrite").objectStore(STORE).put(source, key); } catch { /* quota or closed db: the cache is only a speed-up */ }
  });
}

export async function clearSourceCache(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).clear(); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}

/** Raw buffers of a finished mesh; `isGlow` tells the glow material apart. */
export function serializeMesh(mesh: Mesh, isGlow: (material: unknown) => boolean): SerializedMesh {
  const positions = mesh.getVerticesData("position") ?? [];
  const normals = mesh.getVerticesData("normal") ?? [];
  const colors = mesh.getVerticesData("color") ?? [];
  const indices = mesh.getIndices() ?? [];
  const multi = mesh.material instanceof MultiMaterial ? mesh.material : null;
  const subMeshes = mesh.subMeshes.map((sub) => ({
    kind: (isGlow(multi ? multi.subMaterials[sub.materialIndex] : mesh.material) ? "glow" : "lit") as "lit" | "glow",
    verticesStart: sub.verticesStart, verticesCount: sub.verticesCount, indexStart: sub.indexStart, indexCount: sub.indexCount,
  }));
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: Float32Array.from(colors), indices: Uint32Array.from(indices), subMeshes };
}

/** A mesh from cached buffers, drawn with the lit material, the glow material, or both (MultiMaterial). */
export function restoreMesh(name: string, data: SerializedMesh, scene: Scene, material: StandardMaterial, glowMaterial: StandardMaterial): Mesh {
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = data.positions;
  vertexData.normals = data.normals;
  vertexData.colors = data.colors;
  vertexData.indices = data.indices;
  vertexData.applyToMesh(mesh);
  const kinds = new Set(data.subMeshes.map((sub) => sub.kind));
  if (kinds.size <= 1) {
    mesh.material = kinds.has("glow") ? glowMaterial : material;
  } else {
    const multi = new MultiMaterial(`${name} materials`, scene);
    multi.subMaterials = [material, glowMaterial];
    mesh.material = multi;
    mesh.subMeshes = [];
    for (const sub of data.subMeshes) new SubMesh(sub.kind === "glow" ? 1 : 0, sub.verticesStart, sub.verticesCount, sub.indexStart, sub.indexCount, mesh);
  }
  mesh.useVertexColors = true;
  return mesh;
}
