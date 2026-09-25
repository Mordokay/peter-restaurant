// A prop that grows: several catalog models standing in for the same object at
// different ages, cross-scaled from one to the next.
//
// The animation is the point. Swapping a model is instant and reads as a glitch;
// shrinking the old one into the soil while the new one pushes out of it reads as
// growth, even though nothing actually grew. Both stages are built up front and
// kept at scale 0 when idle, so a stage change costs two scale writes per frame
// and never touches the scene graph.
//
// This was written for tomatoes and is now general: the stage models are just a
// list of catalog ids, so lettuce, a compost heap or a sapling all use it.
import { AbstractMesh, Mesh, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog, type AuthoredVoxelModel } from "./voxelModel.ts";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { TOMATO_STAGE_SECONDS, stageScales } from "./stageTransition.ts";
import type { MeshLibrary } from "./meshLibrary.ts";

/** Seconds one stage takes to become the next. */
export const STAGE_SECONDS = TOMATO_STAGE_SECONDS;

export interface StageRig {
  root: TransformNode;
  /** One per stage model, in the order given. `mesh` is an instance when the rig
   *  was given a library, and a mesh of its own when it was not. */
  stages: { id: string; mesh: AbstractMesh; model: AuthoredVoxelModel }[];
  stage: number;
  /** Stage index being left, equal to `stage` when idle. */
  outgoing: number;
  /** Seconds since the current transition started; Infinity when idle. */
  transitionAge: number;
}

export interface StageRigOptions {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  /** Catalog ids, youngest first. */
  models: readonly string[];
  parent?: TransformNode;
  position?: Vector3;
  spin?: number;
  initialStage?: number;
  shadows?: ShadowGenerator;
  /** Usually a wind material, so the plant is alive while it stands there. */
  material?: StandardMaterial;
  /** Wind weight for parts that declare none; graded by height in the mesher. */
  sway?: number;
  /** Metres each stage sits below the rig's origin — how much of it is buried. */
  sink?: (id: string, index: number) => number;
  /** Share one meshing of each stage across every rig that asks — the difference
   *  between a farm that opens and a farm that freezes. Without it each rig
   *  meshes its own copy, which is what the model lab wants. */
  library?: MeshLibrary;
  name?: string;
}

export function createStageRig(options: StageRigOptions): StageRig {
  const { scene, catalog, models, parent, position, spin, initialStage = models.length - 1, shadows } = options;
  const root = new TransformNode(options.name ?? `stage rig ${models[0] ?? ""}`, scene);
  if (parent) root.parent = parent;
  if (position) root.position.copyFrom(position);
  root.rotation.y = spin ?? 0;

  const build = (id: string, model: AuthoredVoxelModel): Mesh => {
    const mesh = createVoxelMesh(
      `stage ${id}`, cellsFromAuthoredModel(model, undefined, { sway: options.sway }), model.pitch, scene,
      options.material ? { material: options.material } : {});
    mesh.receiveShadows = true;
    return mesh;
  };

  const stages = models.map((id, index) => {
    const model = catalog.models[id];
    if (!model) throw new Error(`${id} is not in the catalog`);
    const mesh: AbstractMesh = options.library
      ? options.library.source(`${id}|${options.sway ?? 0}`, () => build(id, model)).createInstance(`${root.name} ${id}`)
      : build(id, model);
    mesh.parent = root;
    mesh.position.y = -(options.sink?.(id, index) ?? 0);
    // An instance inherits its source's shadow settings; setting it on the
    // instance does nothing but warn, so it is set where it means something.
    if (mesh instanceof Mesh) mesh.receiveShadows = true;
    shadows?.addShadowCaster(mesh);
    mesh.setEnabled(index === initialStage);
    mesh.scaling.setAll(index === initialStage ? 1 : 0);
    return { id, mesh, model };
  });

  return { root, stages, stage: initialStage, outgoing: initialStage, transitionAge: Infinity };
}

export function requestStage(rig: StageRig, stage: number): void {
  if (stage === rig.stage || stage < 0 || stage >= rig.stages.length) return;
  // Mid-transition requests finish instantly first — the new request starts
  // from a clean, fully-scaled state.
  if (rig.transitionAge < STAGE_SECONDS) {
    for (const [index, entry] of rig.stages.entries()) {
      entry.mesh.scaling.setAll(index === rig.stage ? 1 : 0);
      entry.mesh.setEnabled(index === rig.stage);
    }
  }
  rig.outgoing = rig.stage;
  rig.stage = stage;
  rig.transitionAge = 0;
  rig.stages[stage]!.mesh.setEnabled(true);
}

export function animateStages(rig: StageRig, dt: number): void {
  if (rig.transitionAge === Infinity) return;
  rig.transitionAge += dt;
  const { outgoing, incoming } = stageScales(rig.transitionAge / STAGE_SECONDS);
  rig.stages[rig.outgoing]!.mesh.scaling.setAll(outgoing);
  rig.stages[rig.stage]!.mesh.scaling.setAll(incoming);
  if (rig.transitionAge >= STAGE_SECONDS) {
    rig.stages[rig.outgoing]!.mesh.scaling.setAll(0);
    rig.stages[rig.outgoing]!.mesh.setEnabled(false);
    rig.stages[rig.stage]!.mesh.scaling.setAll(1);
    rig.outgoing = rig.stage;
    rig.transitionAge = Infinity;
  }
}

export function disposeStageRig(rig: StageRig): void {
  for (const entry of rig.stages) entry.mesh.dispose(false, false);
  rig.stages.length = 0;
  rig.root.dispose();
}
