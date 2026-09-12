import { Mesh, Scene, ShadowGenerator, TransformNode, Vector3 } from "@babylonjs/core";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";

// Wheat is scan art: a free CC0 "Wheat" plant by Quaternius, voxelized into the
// authored catalog by the external-model pipeline (scripts/voxelize-mesh.py +
// scripts/voxels-to-model.mjs) with height-banded anatomy coloring. Ripe reads
// golden straw with chunky cream heads; young is the same cells remapped to
// greens. Heads carry the recognition, so they sway a little more than stems.

export interface WheatPlantState {
  greenStems: Mesh;
  greenHeads: Mesh;
  goldenStems: Mesh;
  goldenHeads: Mesh;
  baseScale: number;
  /** Vertical stretch multiplier baked into every scaling write, so a scan
   * patch can read as a taller stand of stalks without changing footprint. */
  baseStretchY: number;
  phase: number;
  /** 0..1 growing; >= 1 ripe. Ripening swaps green for golden with a pop. */
  growth: number;
  sparkleIn: number;
  /** Elapsed time when growth last crossed ripe; -1 until then. The pop is a
   * brief overshoot so the golden state lands with energy, not a snap. */
  ripenedAt: number;
}

export interface WheatSources {
  youngStems: Mesh;
  youngHeads: Mesh;
  ripeStems: Mesh;
  ripeHeads: Mesh;
}

// Ripe palette hexes from the scan converter → unripe greens, so growth states
// keep working on external-model art without a second catalog entry.
const YOUNG_COLOR_MAP: Readonly<Record<string, string>> = {
  "#f2e6bc": "#a9d585",
  "#e8cf8e": "#8fc06e",
  "#dfc178": "#7fb35f",
  "#d9b95c": "#6da75a",
  "#c4a24a": "#5e9349",
  "#8a9a4a": "#5e9349",
};

/** Builds the four source meshes from the voxelized external wheat model.
 * Returns null when the catalog lacks the scan (e.g. trimmed builds). */
export function createWheatSourcesFromScan(scene: Scene, catalog: AuthoredVoxelCatalog, modelId = "wheat_scan"): WheatSources | null {
  const model = catalog.models[modelId];
  if (!model) return null;
  const youngen = (cells: readonly VoxelCell[]): VoxelCell[] =>
    cells.map((cell) => ({ ...cell, color: YOUNG_COLOR_MAP[cell.color] ?? cell.color }));
  const build = (name: string, partId: string, young: boolean): Mesh =>
    createVoxelMesh(name, young ? youngen(cellsFromAuthoredModel(model, [partId])) : cellsFromAuthoredModel(model, [partId]), model.pitch, scene);
  const sources: WheatSources = {
    ripeStems: build("wheat scan stems source (ripe)", "stems", false),
    ripeHeads: build("wheat scan heads source (ripe)", "heads", false),
    youngStems: build("wheat scan stems source (young)", "stems", true),
    youngHeads: build("wheat scan heads source (young)", "heads", true),
  };
  for (const mesh of Object.values(sources)) {
    mesh.receiveShadows = true;
    mesh.setEnabled(false);
  }
  return sources;
}

export function createWheatPlant(options: {
  index: number;
  position: Vector3;
  parent: TransformNode;
  sources: WheatSources;
  growth: number;
  spin?: number;
  scale?: number;
  stretchY?: number;
  shadows?: ShadowGenerator;
}): WheatPlantState {
  const { index, position, parent, sources, growth, spin, shadows } = options;
  const holder = new TransformNode(`wheat plant ${index + 1}`, parent.getScene());
  holder.parent = parent;
  holder.position.copyFrom(position);
  holder.rotation.y = spin ?? 0;
  const scale = options.scale ?? 0.9 + (index % 3) * 0.06;
  const stretchY = options.stretchY ?? 1;
  const greenStems = sources.youngStems.clone(`wheat plant ${index + 1} young stems`)!;
  const greenHeads = sources.youngHeads.clone(`wheat plant ${index + 1} young heads`)!;
  const goldenStems = sources.ripeStems.clone(`wheat plant ${index + 1} ripe stems`)!;
  const goldenHeads = sources.ripeHeads.clone(`wheat plant ${index + 1} ripe heads`)!;
  const ripeNow = growth >= 1;
  for (const mesh of [greenStems, greenHeads, goldenStems, goldenHeads]) {
    mesh.parent = holder;
    mesh.scaling.set(scale, scale * stretchY, scale);
    shadows?.addShadowCaster(mesh);
  }
  greenStems.setEnabled(!ripeNow);
  greenHeads.setEnabled(!ripeNow);
  goldenStems.setEnabled(ripeNow);
  goldenHeads.setEnabled(ripeNow);
  return {
    greenStems, greenHeads, goldenStems, goldenHeads,
    baseScale: scale,
    baseStretchY: stretchY,
    // Wind phase keyed to position, not index: the sway travels across the
    // plot as a ripple instead of every cluster bobbing on its own clock.
    phase: position.x * 2.1 + position.z * 1.3,
    growth,
    sparkleIn: 10 + index * 3.1,
    // Born-ripe plants settle instantly; only runtime ripening pops.
    ripenedAt: growth >= 1 ? 0 : -1,
  };
}

/** Restrained field sway: whole clusters lean a little, heads a little more,
 * on a position-staggered phase so wind reads as one wave crossing the plot —
 * quiet enough not to compete with active stations. Ripening lands with a
 * brief pop instead of a hard swap. */
export function animateWheatPlant(plant: WheatPlantState, elapsed: number): void {
  const ripe = plant.growth >= 1;
  const showGreen = !ripe;
  const greenScale = ripe ? 1 : 0.45 + 0.55 * plant.growth;
  const justRipened = ripe && plant.ripenedAt < 0;
  if (plant.greenStems.isEnabled() !== showGreen || justRipened) {
    plant.greenStems.setEnabled(showGreen);
    plant.greenHeads.setEnabled(showGreen);
    plant.goldenStems.setEnabled(ripe);
    plant.goldenHeads.setEnabled(ripe);
    if (justRipened) plant.ripenedAt = elapsed;
  }
  // Pop: a 0.45s overshoot right after the golden state appears.
  const popAge = plant.ripenedAt >= 0 ? elapsed - plant.ripenedAt : Infinity;
  const pop = popAge < 0.45 ? 1 + 0.14 * Math.sin(Math.PI * (popAge / 0.45)) : 1;
  const growEase = ripe
    ? plant.baseScale * pop * (1 + Math.sin(elapsed * 1.6 + plant.phase) * 0.012)
    : plant.baseScale * greenScale;
  const stemSway = Math.sin(elapsed * 0.9 + plant.phase) * 0.02;
  const headSway = Math.sin(elapsed * 0.9 + plant.phase + 0.6) * 0.035;
  plant.greenStems.rotation.z = stemSway;
  plant.greenHeads.rotation.z = headSway;
  plant.goldenStems.rotation.z = stemSway;
  plant.goldenHeads.rotation.z = headSway;
  if (!ripe) {
    plant.greenStems.scaling.set(growEase, growEase * plant.baseStretchY, growEase);
    plant.greenHeads.scaling.set(growEase, growEase * plant.baseStretchY, growEase);
  } else if (pop !== 1) {
    plant.goldenStems.scaling.set(growEase, growEase * plant.baseStretchY, growEase);
    plant.goldenHeads.scaling.set(growEase, growEase * plant.baseStretchY, growEase);
  }
}
