// World renderer: draws thousands of placed catalog objects cheaply.
//
// Every placed prop used to be its own rig — one Babylon mesh per part, its own vertex
// buffers, its own draw calls. Sixty fence sections meant 1,440 meshes. Here a model is
// meshed ONCE (all parts at rest pose, merged into a single hidden source mesh) and every
// placement is a Babylon InstancedMesh of that source: no geometry of its own, culled on
// its own bounding box, drawn together with every other visible instance of the same
// model in one hardware-instanced draw call. Static props freeze their world matrix so a
// frame costs culling only.
//
// Detail is the other half of the problem: an Ultra bowl is 400k triangles, and a table of
// them would sink any GPU. Each source therefore carries a coarse LOD mesh, rebuilt from
// the model's cells at a coarser pitch, that Babylon swaps in beyond `lodDistance`.
//
// Static props only: anything animated, selected or reacting is promoted to a real rig by
// the caller (decor.ts) and skipped here. Picking returns the instance id.
import { AbstractMesh, Mesh, Scene, ShadowGenerator, StandardMaterial } from "@babylonjs/core";
import type { AuthoredVoxelModel } from "./voxelModel.ts";
import { cellsFromAuthoredModel } from "./voxelModel.ts";
import { createVoxelMaterial, createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { createVoxelRig } from "./voxelRig.ts";
import { emissiveByHex, glowInfoOf, glowMaterialFor, modelLightPositions, splitGlowCells, tagGlow, type GlowInfo, type LightPool } from "./lighting.ts";
import { peekSource, restoreMesh, serializeMesh, sourceCacheKey, storeSource } from "./sourceCache.ts";

export interface WorldInstance {
  id: string;
  model: string;
  position: readonly [number, number, number];
  /** Degrees, same convention as decor props (Babylon Euler, YXZ). */
  rotation?: readonly [number, number, number];
  scale?: number | readonly [number, number, number];
}

export interface WorldRendererStats {
  models: number;
  instances: number;
  /** Instances Babylon found in view last frame. */
  activeInstances: number;
  /** Triangles drawn last frame (LOD-aware estimate). */
  triangles: number;
  /** Unique geometry resident on the GPU, in triangles (full + coarse copies). */
  residentTriangles: number;
  /** Time spent meshing sources, in ms. */
  buildMs: number;
  /** Sources restored from the cache instead of meshed. */
  cachedSources: number;
}

export interface WorldRenderer {
  /** Replace the whole set (missing models are skipped; call ensureModels first). */
  setInstances(instances: readonly WorldInstance[], models: Readonly<Record<string, AuthoredVoxelModel>>): void;
  /** Add or update one instance. */
  upsert(instance: WorldInstance, model: AuthoredVoxelModel): void;
  remove(id: string): void;
  /** Instance id of a picked mesh, or null when it is not one of ours. */
  instanceAt(mesh: AbstractMesh | null | undefined): string | null;
  /** The mesh drawing an instance, or null. Replaced whenever the instance changes model. */
  meshOf(id: string): AbstractMesh | null;
  /** Every mesh a ray may hit (for pickers and the fly camera). */
  pickables(): AbstractMesh[];
  stats(): WorldRendererStats;
  dispose(): void;
}

export interface WorldRendererOptions {
  shadows?: ShadowGenerator;
  receiveShadows?: boolean;
  name?: string;
  log?: boolean;
  /** Distance (m) beyond which the coarse mesh is drawn; 0 disables LOD. Default 18. */
  lodDistance?: number;
  /** Target voxel size (m) of the coarse mesh. Default 0.02 (2 cm). */
  lodPitch?: number;
  /** Distance (m) beyond which the model is not drawn at all; 0 disables. Default 140. */
  cullDistance?: number;
  /** Where placed lamps register their point lights (see createLightPool). */
  lightPool?: LightPool;
  /** Catalog revision of a model: enables the IndexedDB source cache (see sourceCache.ts; warm it first). */
  cacheRev?: (modelId: string) => number | undefined;
}

interface Source { model: AuthoredVoxelModel; mesh: Mesh; coarse: Mesh | null; triangles: number; coarseTriangles: number; glow: GlowInfo | null }
interface Placed { instance: WorldInstance; mesh: AbstractMesh; modelId: string; lightIds: string[] }

/** Downsample cells to a coarser grid: every block of factor³ cells becomes one cell in its
 *  most frequent colour. Enough for a prop twenty metres away. */
export function downsampleCells(cells: readonly VoxelCell[], factor: number): VoxelCell[] {
  if (factor <= 1) return [...cells];
  const blocks = new Map<string, { x: number; y: number; z: number; colours: Map<string, number> }>();
  for (const cell of cells) {
    const x = Math.floor(cell.x / factor), y = Math.floor(cell.y / factor), z = Math.floor(cell.z / factor);
    const key = `${x},${y},${z}`;
    let block = blocks.get(key);
    if (!block) blocks.set(key, (block = { x, y, z, colours: new Map() }));
    block.colours.set(cell.color, (block.colours.get(cell.color) ?? 0) + 1);
  }
  const out: VoxelCell[] = [];
  for (const block of blocks.values()) {
    let best = "", bestCount = 0;
    for (const [colour, count] of block.colours) if (count > bestCount) { best = colour; bestCount = count; }
    out.push({ x: block.x, y: block.y, z: block.z, color: best });
  }
  return out;
}

export function createWorldRenderer(scene: Scene, options: WorldRendererOptions = {}): WorldRenderer {
  const name = options.name ?? "world";
  const lodDistance = options.lodDistance ?? 18;
  const lodPitch = options.lodPitch ?? 0.02;
  const cullDistance = options.cullDistance ?? 140;
  const material: StandardMaterial = createVoxelMaterial(`${name} material`, scene);
  const sources = new Map<string, Source>();
  const placed = new Map<string, Placed>();
  const idOfMesh = new Map<AbstractMesh, string>();
  let buildMs = 0;
  let cachedSources = 0;
  const isGlowMaterial = (candidate: unknown): boolean => Boolean((candidate as { metadata?: { glow?: boolean } } | null)?.metadata?.glow);

  /** Mesh a model once: rig at the origin, rest pose, all parts merged into one hidden mesh. */
  const sourceFor = (model: AuthoredVoxelModel): Source | null => {
    const existing = sources.get(model.id);
    if (existing) return existing;
    const started = performance.now();
    const cacheKey = options.cacheRev ? sourceCacheKey(model.id, options.cacheRev(model.id), lodPitch) : null;
    const cached = cacheKey ? peekSource(cacheKey) : undefined;
    const glowMap = emissiveByHex(model);
    let merged: Mesh | null = null;
    let coarse: Mesh | null = null;
    let glowInfo: GlowInfo | null = null;
    const factor = Math.min(16, Math.max(1, Math.round(lodPitch / model.pitch)));
    if (cached) {
      merged = restoreMesh(`${name} source ${model.id}`, cached.full, scene, material, glowMaterialFor(scene));
      coarse = cached.coarse ? restoreMesh(`${name} lod ${model.id}`, cached.coarse, scene, material, glowMaterialFor(scene)) : null;
      if (glowMap.size) glowInfo = glowInfoOf(splitGlowCells(cellsFromAuthoredModel(model), glowMap).glowing, glowMap);
      cachedSources++;
    } else {
      const built = buildSource(model, glowMap, factor);
      if (!built) return null;
      ({ merged, coarse, glowInfo } = built);
      if (cacheKey) storeSource(cacheKey, { full: serializeMesh(merged, isGlowMaterial), coarse: coarse ? serializeMesh(coarse, isGlowMaterial) : null });
    }
    if (glowInfo) { tagGlow(merged, glowInfo); if (coarse) tagGlow(coarse, glowInfo); }
    merged.useVertexColors = true;
    merged.isVisible = false;
    merged.isPickable = false;
    merged.receiveShadows = options.receiveShadows ?? true;
    merged.alwaysSelectAsActiveMesh = false;
    if (coarse) {
      coarse.useVertexColors = true;
      coarse.isPickable = false;
      coarse.receiveShadows = options.receiveShadows ?? true;
      merged.addLODLevel(lodDistance, coarse);
    }
    if (cullDistance > 0) merged.addLODLevel(cullDistance, null);
    options.shadows?.addShadowCaster(merged, false);
    const source: Source = { model, mesh: merged, coarse, triangles: merged.getTotalIndices() / 3, coarseTriangles: coarse ? coarse.getTotalIndices() / 3 : 0, glow: glowInfo };
    sources.set(model.id, source);
    const took = performance.now() - started;
    buildMs += took;
    if (options.log) console.log(`[world] source ${model.id}${cached ? " (cached)" : ""}: ${source.triangles} triangles (coarse ×${factor}: ${source.coarseTriangles}) in ${took.toFixed(0)} ms`);
    return source;
  };

  /** Mesh from scratch: rig at rest, parts merged (glow parts as a second sub-material), coarse twin. */
  const buildSource = (model: AuthoredVoxelModel, glowMap: Map<string, number>, factor: number): { merged: Mesh; coarse: Mesh | null; glowInfo: GlowInfo | null } | null => {
    const rig = createVoxelRig(model, scene, { name: `${name} source ${model.id}`, material, receiveShadows: false });
    rig.anchor.computeWorldMatrix(true);
    for (const mesh of rig.meshes) mesh.computeWorldMatrix(true);
    const meshes = rig.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
    const glowInfo = (meshes.find((mesh) => (mesh.metadata as { glow?: GlowInfo } | null)?.glow)?.metadata as { glow?: GlowInfo } | null)?.glow ?? null;
    let merged: Mesh | null = null;
    if (meshes.length === 1) {
      const single = meshes[0]!;
      single.bakeCurrentTransformIntoVertices();
      single.parent = null;
      merged = single;
    } else if (meshes.length > 1) {
      // Glowing parts keep their unlit material: merge into one mesh with two sub-materials.
      merged = Mesh.MergeMeshes(meshes, true, true, undefined, Boolean(glowInfo), Boolean(glowInfo));
    }
    rig.root.dispose(false, false);
    rig.anchor.dispose(false, false);
    if (!merged) return null;
    merged.name = `${name} source ${model.id}`;
    if (!glowInfo) merged.material = material;
    // Coarse twin for distance: cells at ≥ lodPitch, whatever the model's own pitch.
    let coarse: Mesh | null = null;
    if (lodDistance > 0 && factor > 1) {
      const coarseCells = downsampleCells(cellsFromAuthoredModel(model), factor);
      const { lit, glowing } = splitGlowCells(coarseCells, glowMap);
      const pieces: Mesh[] = [];
      if (lit.length) pieces.push(createVoxelMesh(`${name} lod ${model.id}`, lit, model.pitch * factor, scene, { material }));
      if (glowing.length) { const glowMesh = createVoxelMesh(`${name} lod ${model.id} glow`, glowing, model.pitch * factor, scene, { material: glowMaterialFor(scene) }); tagGlow(glowMesh, glowInfoOf(glowing, glowMap)); pieces.push(glowMesh); }
      coarse = pieces.length === 1 ? pieces[0]! : pieces.length ? Mesh.MergeMeshes(pieces, true, true, undefined, true, true) : null;
      if (coarse) coarse.name = `${name} lod ${model.id}`;
    }
    return { merged, coarse, glowInfo };
  };

  const applyTransform = (mesh: AbstractMesh, instance: WorldInstance): void => {
    const [rx, ry, rz] = instance.rotation ?? [0, 0, 0];
    const scale = typeof instance.scale === "number" ? [instance.scale, instance.scale, instance.scale] : (instance.scale ?? [1, 1, 1]);
    mesh.unfreezeWorldMatrix();
    mesh.position.set(instance.position[0], instance.position[1], instance.position[2]);
    mesh.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180);
    mesh.scaling.set(scale[0]!, scale[1]!, scale[2]!);
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  };

  const place = (instance: WorldInstance, model: AuthoredVoxelModel): void => {
    const source = sourceFor(model);
    if (!source) return;
    const current = placed.get(instance.id);
    if (current && current.modelId === model.id) {
      // Same model: move the existing instance and its lights.
      current.instance = instance;
      applyTransform(current.mesh, instance);
      for (const lightId of current.lightIds) options.lightPool?.unregister(lightId);
      current.lightIds = [];
      if (options.lightPool && model.lights?.length) modelLightPositions(model, current.mesh.getWorldMatrix()).forEach((light, index) => { const id = `${instance.id}#${index}`; options.lightPool!.register(id, light.position, light.spec); current.lightIds.push(id); });
      return;
    }
    if (current) removeOne(instance.id);
    const mesh = source.mesh.createInstance(instance.id);
    mesh.isPickable = true;
    mesh.metadata = { worldInstance: instance.id, ...(source.glow ? { glow: source.glow } : {}) };
    applyTransform(mesh, instance);
    // A lamp's point lights go into the shared pool at their placed positions.
    const lightIds: string[] = [];
    if (options.lightPool && model.lights?.length) {
      modelLightPositions(model, mesh.getWorldMatrix()).forEach((light, index) => { const id = `${instance.id}#${index}`; options.lightPool!.register(id, light.position, light.spec); lightIds.push(id); });
    }
    placed.set(instance.id, { instance, mesh, modelId: model.id, lightIds });
    idOfMesh.set(mesh, instance.id);
  };
  const removeOne = (id: string): void => {
    const current = placed.get(id);
    if (!current) return;
    for (const lightId of current.lightIds) options.lightPool?.unregister(lightId);
    idOfMesh.delete(current.mesh);
    current.mesh.dispose(false, false);
    placed.delete(id);
  };

  return {
    setInstances(list, models) {
      for (const id of [...placed.keys()]) removeOne(id);
      for (const instance of list) { const model = models[instance.model]; if (model) place(instance, model); }
    },
    upsert(instance, model) { place(instance, model); },
    remove(id) { removeOne(id); },
    instanceAt(mesh) { return mesh ? idOfMesh.get(mesh) ?? null : null; },
    meshOf(id) { return placed.get(id)?.mesh ?? null; },
    pickables() { return [...placed.values()].map((entry) => entry.mesh); },
    stats() {
      // This used to re-derive the LOD tier from `getAbsolutePosition()` — the instance ORIGIN — and
      // compare it against lodDistance. Babylon does not decide that way: `InstancedMesh.getLOD` uses
      // the bounding SPHERE's centre. For a two-metre lamp that is about a metre out, which misclassifies
      // a whole shell of props either side of the boundary. So read what Babylon actually chose.
      // (It also allocated two Vector3 per active mesh per call — at twelve thousand props on a
      // half-second HUD interval that is forty-eight thousand allocations a second to draw a line of
      // text: the instrument perturbing the experiment.)
      let activeInstances = 0, triangles = 0, coarseInstances = 0;
      const active = scene.getActiveMeshes();
      for (let i = 0; i < active.length; i++) {
        const mesh = active.data[i]!;
        const id = idOfMesh.get(mesh);
        if (!id) continue;
        activeInstances++;
        const source = sources.get(placed.get(id)!.modelId)!;
        const chosen = (mesh as unknown as { _currentLOD?: unknown })._currentLOD;
        // Three outcomes: the coarse twin, the full mesh, or null — `addLODLevel(cullDistance, null)`
        // means nothing is drawn past the cull distance, and the old code still charged full triangles
        // for those.
        if (chosen === null || chosen === undefined) continue;
        if (source.coarse && chosen === source.coarse) { triangles += source.coarseTriangles; coarseInstances++; }
        else triangles += source.triangles;
      }
      return { models: sources.size, instances: placed.size, activeInstances, coarseInstances, triangles, residentTriangles: [...sources.values()].reduce((sum, source) => sum + source.triangles + source.coarseTriangles, 0), buildMs, cachedSources };
    },
    dispose() {
      for (const id of [...placed.keys()]) removeOne(id);
      for (const source of sources.values()) { options.shadows?.removeShadowCaster(source.mesh); source.coarse?.dispose(false, false); source.mesh.dispose(false, false); }
      sources.clear();
      material.dispose();
    },
  };
}
