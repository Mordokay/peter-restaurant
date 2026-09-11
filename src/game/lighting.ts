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

/** A GlowLayer that blooms only meshes tagged with metadata.glow (or drawn with the glow material). */
export function attachGlow(scene: Scene, options: { intensity?: number; kernel?: number } = {}): GlowLayer {
  const layer = new GlowLayer("voxel glow", scene, { blurKernelSize: options.kernel ?? 48, mainTextureSamples: 1 });
  layer.intensity = options.intensity ?? 0.9;
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
  /** Number of registered lights and how many are currently real. */
  stats(): { registered: number; active: number };
  /** Scale every pooled light's intensity (day/night: lamps barely matter at noon). */
  setIntensityScale(scale: number): void;
  dispose(): void;
}

/** Keep `max` PointLights and park them at the registered positions nearest the camera. */
export function createLightPool(scene: Scene, options: { max?: number; camera?: () => Camera | null } = {}): LightPool {
  const max = options.max ?? 6;
  const entries = new Map<string, { position: Vector3; spec: ModelLight }>();
  const pool: PointLight[] = [];
  for (let i = 0; i < max; i++) {
    const light = new PointLight(`pool light ${i}`, Vector3.Zero(), scene);
    light.setEnabled(false);
    light.falloffType = PointLight.FALLOFF_DEFAULT; // linear fade to `range`: a soft pool, not an inverse-square blowout
    pool.push(light);
  }
  let active = 0;
  let intensityScale = 1;
  const assign = () => {
    const camera = options.camera?.() ?? scene.activeCamera;
    if (!camera) return;
    const focus = (camera as unknown as { target?: Vector3 }).target ?? camera.globalPosition;
    const ranked = [...entries.values()].map((entry) => ({ entry, d: Vector3.DistanceSquared(entry.position, focus) })).sort((a, b) => a.d - b.d).slice(0, max);
    active = ranked.length;
    pool.forEach((light, index) => {
      const hit = ranked[index];
      if (!hit) { if (light.isEnabled()) light.setEnabled(false); return; }
      light.position.copyFrom(hit.entry.position);
      const colour = Color3.FromHexString(hit.entry.spec.color ?? "#ffd9a0");
      light.diffuse.copyFrom(colour); light.specular.copyFrom(colour).scaleInPlace(0.3);
      light.intensity = (hit.entry.spec.intensity ?? 1) * intensityScale;
      light.range = hit.entry.spec.range ?? 7;
      if (!light.isEnabled()) light.setEnabled(true);
    });
  };
  const observer = scene.onBeforeRenderObservable.add(assign);
  return {
    register(id, position, spec) { entries.set(id, { position: position.clone(), spec }); },
    unregister(id) { entries.delete(id); },
    stats: () => ({ registered: entries.size, active }),
    setIntensityScale(scale) { intensityScale = Math.max(0, scale); },
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
}
