// Practical lighting for a voxel world: glowing voxels and a budgeted pool of point lights.
//
// Glow. A model can mark palette colours as emissive (`model.emissive[colourKey] = intensity`).
// Those cells are meshed separately with an unlit material so they read as light sources, and
// the scene's GlowLayer blooms them using the mesh's mean glow colour (metadata.glow).
//
// Lights. A model can carry point lights (`model.lights`, positions in cell units). Placing a
// hundred lamps must not create a hundred Babylon lights — StandardMaterial shades each mesh
// with at most `maxSimultaneousLights`, so a scene-wide pool keeps a few real PointLights and,
// every frame, moves them to the light positions nearest the camera target. The rest of the
// room is carried by glow, the sun and the hemispheric fill.
import { Color3, GlowLayer, Matrix, Mesh, PointLight, Scene, StandardMaterial, Vector3, type Camera } from "@babylonjs/core";
import type { AuthoredVoxelModel, ModelLight } from "./voxelModel.ts";
import type { VoxelCell } from "./voxelGeometry.ts";

export interface GlowInfo { r: number; g: number; b: number; intensity: number }

/** Hex colour → glow intensity for a model, resolved from palette keys. Empty when nothing glows. */
export function emissiveByHex(model: AuthoredVoxelModel): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, intensity] of Object.entries(model.emissive ?? {})) {
    const hex = model.palette[key];
    if (hex && intensity > 0) out.set(hex.toLowerCase(), intensity);
  }
  return out;
}

/** Split cells into lit and glowing groups. */
export function splitGlowCells(cells: readonly VoxelCell[], glow: Map<string, number>): { lit: VoxelCell[]; glowing: VoxelCell[] } {
  if (!glow.size) return { lit: [...cells], glowing: [] };
  const lit: VoxelCell[] = [], glowing: VoxelCell[] = [];
  for (const cell of cells) (glow.has(cell.color.toLowerCase()) ? glowing : lit).push(cell);
  return { lit, glowing };
}

/** Mean colour of glowing cells weighted by intensity → what the GlowLayer blooms. */
export function glowInfoOf(cells: readonly VoxelCell[], glow: Map<string, number>): GlowInfo {
  let r = 0, g = 0, b = 0, weight = 0, intensity = 0;
  for (const cell of cells) {
    const w = glow.get(cell.color.toLowerCase()) ?? 1;
    const c = Color3.FromHexString(cell.color);
    r += c.r * w; g += c.g * w; b += c.b * w; weight += w; intensity = Math.max(intensity, w);
  }
  return weight ? { r: r / weight, g: g / weight, b: b / weight, intensity } : { r: 1, g: 1, b: 1, intensity: 1 };
}

const glowMaterials = new WeakMap<Scene, StandardMaterial>();
/** The one unlit material every glowing mesh in a scene shares: vertex colours straight to the screen. */
export function glowMaterialFor(scene: Scene): StandardMaterial {
  let material = glowMaterials.get(scene);
  if (!material) {
    material = new StandardMaterial("voxel glow material", scene);
    material.disableLighting = true;
    material.diffuseColor.set(1, 1, 1);
    // White emissive is what actually carries the colour. Turning lighting off leaves nothing driving
    // the diffuse term, so these meshes rendered BLACK and were visible only through the GlowLayer's
    // bloom — which is why a lit display or a lamp faded out in daylight and at any distance. The
    // emissive term is added regardless of lights, and the cell's own colour multiplies it.
    material.emissiveColor.set(1, 1, 1);
    material.specularColor.set(0, 0, 0);
    material.metadata = { glow: true };
    glowMaterials.set(scene, material);
  }
  return material;
}

/** The glow layer of a scene, and the meshes that actually asked to bloom. */
const glowLayers = new WeakMap<Scene, { layer: GlowLayer; meshes: Set<Mesh> }>();

/** A GlowLayer that blooms only meshes tagged with metadata.glow (or drawn with the glow material). */
export function attachGlow(scene: Scene, options: { intensity?: number; kernel?: number } = {}): GlowLayer {
  const layer = new GlowLayer("voxel glow", scene, { blurKernelSize: options.kernel ?? 48, mainTextureSamples: 1 });
  layer.intensity = options.intensity ?? 0.9;
  // A GlowLayer with no include list falls back to every active mesh, so it draws the WHOLE visible
  // scene a second time into its texture — painted black, because the selector below returns nothing
  // for anything untagged — and then blurs and merges that. Measured on the compound: 83 draw calls
  // and 333,000 triangles a frame, for pixels that never change.
  //
  // Two things keep that from happening, and both are needed. The layer stays off until something is
  // actually tagged to bloom, and switches off again when the last of them goes — but "off" was never
  // enough on its own, because one lamp anywhere in the scene turned it on for EVERYTHING. So every
  // tagged mesh is also added to the include list (`tagGlow`), which is what confines the second pass
  // to the handful of meshes that actually glow. Without it, placing a single pendant lamp in a dressed
  // compound costs a full extra scene pass.
  layer.isEnabled = false;
  glowLayers.set(scene, { layer, meshes: new Set() });
  layer.customEmissiveColorSelector = (mesh, _subMesh, material, result) => {
    const info = (mesh.metadata as { glow?: GlowInfo } | null)?.glow;
    if (info && (material as StandardMaterial).metadata?.glow) result.set(info.r * info.intensity, info.g * info.intensity, info.b * info.intensity, 1);
    else result.set(0, 0, 0, 0);
  };
  return layer;
}

export interface LightPool {
  /** Register a light position in world space (id must be unique; re-registering moves it). */
  register(id: string, position: Vector3, spec: ModelLight): void;
  unregister(id: string): void;
  /** Registered lights, how many are currently real, how long the LAST re-rank took, and how many
   *  re-ranks have happened at all. `ranks` is the one to watch: it should stay flat while the camera
   *  is still, however many lamps are registered. */
  stats(): { registered: number; active: number; assignMs: number; ranks: number };
  /** Scale every pooled light's intensity (day/night: lamps barely matter at noon). */
  setIntensityScale(scale: number): void;
  dispose(): void;
}

/** Keep `max` PointLights and park them at the registered positions nearest the camera. */
export function createLightPool(scene: Scene, options: { max?: number; camera?: () => Camera | null } = {}): LightPool {
  const max = options.max ?? 6;
  /** The parsed colour is cached on the entry: it never changes, and parsing it per light per frame
   *  was allocating a Color3 sixty times a second for a value that was already known at register(). */
  interface Entry { position: Vector3; spec: ModelLight; colour: Color3 }
  const entries = new Map<string, Entry>();
  const pool: PointLight[] = [];
  for (let i = 0; i < max; i++) {
    const light = new PointLight(`pool light ${i}`, Vector3.Zero(), scene);
    light.setEnabled(false);
    light.falloffType = PointLight.FALLOFF_DEFAULT; // linear fade to `range`: a soft pool, not an inverse-square blowout
    pool.push(light);
  }
  let active = 0;
  let intensityScale = 1;
  let assignMs = 0;
  let ranks = 0;

  // Ranking state. This used to be `[...entries.values()].map(...).sort(...).slice(0, max)` on EVERY
  // frame — one throwaway object per registered light plus a full sort, for a ranking that only changes
  // when the camera moves. A dressed compound registers hundreds of lamps, so the cost grew with prop
  // density and would have been read off a stress sweep as "props are expensive". Two changes fix it:
  // we pick the nearest `max` by bounded insertion (O(N) with no allocation, and `max` is 6), and we
  // only re-pick when the camera has actually moved or the set of lights has changed.
  const nearest: (Entry | undefined)[] = new Array(max).fill(undefined);
  const nearestDistance = new Float64Array(max);
  const lastFocus = new Vector3(NaN, NaN, NaN);
  /** Bumped by register/unregister so a light appearing or moving re-ranks even from a still camera. */
  let revision = 0;
  let rankedRevision = -1;
  /** Metres the focus may drift before the ranking is recomputed. Well under a light's range, so the
   *  swap always happens long before it could be visible. */
  const FOCUS_EPSILON_SQUARED = 0.25 * 0.25;

  const assign = () => {
    const camera = options.camera?.() ?? scene.activeCamera;
    if (!camera) return;
    const focus = (camera as unknown as { target?: Vector3 }).target ?? camera.globalPosition;
    if (revision === rankedRevision && Vector3.DistanceSquared(focus, lastFocus) <= FOCUS_EPSILON_SQUARED) return;
    const started = performance.now();
    ranks++;
    lastFocus.copyFrom(focus);
    rankedRevision = revision;

    // Bounded insertion: keep the `max` nearest seen so far, in order, without touching the heap.
    let found = 0;
    for (const entry of entries.values()) {
      const d = Vector3.DistanceSquared(entry.position, focus);
      if (found === max && d >= nearestDistance[max - 1]!) continue;
      let slot = Math.min(found, max - 1);
      while (slot > 0 && nearestDistance[slot - 1]! > d) {
        nearestDistance[slot] = nearestDistance[slot - 1]!;
        nearest[slot] = nearest[slot - 1];
        slot--;
      }
      nearestDistance[slot] = d;
      nearest[slot] = entry;
      if (found < max) found++;
    }
    active = found;

    for (let index = 0; index < max; index++) {
      const light = pool[index]!;
      const hit = index < found ? nearest[index] : undefined;
      if (!hit) { nearest[index] = undefined; if (light.isEnabled()) light.setEnabled(false); continue; }
      light.position.copyFrom(hit.position);
      light.diffuse.copyFrom(hit.colour);
      light.specular.copyFrom(hit.colour).scaleInPlace(0.3);
      light.intensity = (hit.spec.intensity ?? 1) * intensityScale;
      light.range = hit.spec.range ?? 7;
      if (!light.isEnabled()) light.setEnabled(true);
    }
    assignMs = performance.now() - started;
  };
  const observer = scene.onBeforeRenderObservable.add(assign);
  return {
    register(id, position, spec) {
      entries.set(id, { position: position.clone(), spec, colour: Color3.FromHexString(spec.color ?? "#ffd9a0") });
      revision++;
    },
    unregister(id) { if (entries.delete(id)) revision++; },
    stats: () => ({ registered: entries.size, active, assignMs, ranks }),
    setIntensityScale(scale) {
      intensityScale = Math.max(0, scale);
      revision++; // day/night dims every pooled light, so the pool must be rewritten even if nothing moved
    },
    dispose() { scene.onBeforeRenderObservable.remove(observer); for (const light of pool) light.dispose(); entries.clear(); },
  };
}

/** World-space positions of a model's lights for one placement. Positions are in cell units. */
export function modelLightPositions(model: AuthoredVoxelModel, world: Matrix): { position: Vector3; spec: ModelLight }[] {
  return (model.lights ?? []).map((spec) => ({ position: Vector3.TransformCoordinates(new Vector3(spec.position[0] * model.pitch, spec.position[1] * model.pitch, spec.position[2] * model.pitch), world), spec }));
}

/** Tag a mesh so the GlowLayer blooms it. */
export function tagGlow(mesh: Mesh, info: GlowInfo): void {
  mesh.metadata = { ...((mesh.metadata as Record<string, unknown> | null) ?? {}), glow: info };
  const entry = glowLayers.get(mesh.getScene());
  if (!entry) return;
  entry.meshes.add(mesh);
  // The include list is what stops the glow pass from redrawing the whole scene; see attachGlow.
  entry.layer.addIncludedOnlyMesh(mesh);
  entry.layer.isEnabled = true;
  mesh.onDisposeObservable.addOnce(() => {
    entry.meshes.delete(mesh);
    entry.layer.removeIncludedOnlyMesh(mesh);
    if (!entry.meshes.size) entry.layer.isEnabled = false;
  });
}
