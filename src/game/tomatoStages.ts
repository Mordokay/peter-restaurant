import { Mesh, Scene, ShadowGenerator, TransformNode, Vector3 } from "@babylonjs/core";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { TOMATO_STAGE_SECONDS, stageScales } from "./stageTransition.ts";

// Tomato as staged scan art: three voxelized growth stages (sprout, vine,
// ripe) from the external-model pipeline. Stage changes animate as a
// cross-scale — the old stage shrinks into the ground while the new one grows
// out of it, both eased in-out — so growth reads as one continuous act
// instead of a model swap. Shading is lighting-driven (flat fruit color); the
// scene's directional light does the modeling.

export type TomatoStageName = "sprout" | "vine" | "ripe";

export interface TomatoStageRig {
  root: TransformNode;
  stageMeshes: Mesh[];
  stage: number;
  /** Stage index being left, equal to `stage` when idle. */
  outgoing: number;
  /** Seconds since the current transition started; Infinity when idle. */
  transitionAge: number;
}

const STAGE_MODEL_IDS: readonly TomatoStageName[] = ["sprout", "vine", "ripe"];

export function createTomatoStageRig(options: {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  parent?: TransformNode;
  position?: Vector3;
  spin?: number;
  initialStage?: number;
  shadows?: ShadowGenerator;
}): TomatoStageRig {
  const { scene, catalog, parent, position, spin, initialStage = 2, shadows } = options;
  const root = new TransformNode("tomato stage rig", scene);
  if (parent) root.parent = parent;
  if (position) root.position.copyFrom(position);
  root.rotation.y = spin ?? 0;

  const stageMeshes = STAGE_MODEL_IDS.map((name, index) => {
    const model = catalog.models[`tomato_${name}_scan`];
    if (!model) throw new Error(`tomato_${name}_scan missing from food-models.json`);
    const mesh = createVoxelMesh(`tomato stage ${name}`, cellsFromAuthoredModel(model), model.pitch, scene);
    mesh.parent = root;
    mesh.receiveShadows = true;
    shadows?.addShadowCaster(mesh);
    mesh.setEnabled(index === initialStage);
    mesh.scaling.setAll(index === initialStage ? 1 : 0);
    return mesh;
  });

  return { root, stageMeshes, stage: initialStage, outgoing: initialStage, transitionAge: Infinity };
}

export function requestTomatoStage(rig: TomatoStageRig, stage: number): void {
  if (stage === rig.stage || stage < 0 || stage >= rig.stageMeshes.length) return;
  // Mid-transition requests finish instantly first — the new request starts
  // from a clean, fully-scaled state.
  if (rig.transitionAge < TOMATO_STAGE_SECONDS) {
    for (const [index, mesh] of rig.stageMeshes.entries()) {
      mesh.scaling.setAll(index === rig.stage ? 1 : 0);
      mesh.setEnabled(index === rig.stage);
    }
  }
  rig.outgoing = rig.stage;
  rig.stage = stage;
  rig.transitionAge = 0;
  rig.stageMeshes[stage].setEnabled(true);
}

export function animateTomatoStages(rig: TomatoStageRig, dt: number): void {
  if (rig.transitionAge === Infinity) return;
  rig.transitionAge += dt;
  const { outgoing, incoming } = stageScales(rig.transitionAge / TOMATO_STAGE_SECONDS);
  rig.stageMeshes[rig.outgoing].scaling.setAll(outgoing);
  rig.stageMeshes[rig.stage].scaling.setAll(incoming);
  if (rig.transitionAge >= TOMATO_STAGE_SECONDS) {
    rig.stageMeshes[rig.outgoing].scaling.setAll(0);
    rig.stageMeshes[rig.outgoing].setEnabled(false);
    rig.stageMeshes[rig.stage].scaling.setAll(1);
    rig.outgoing = rig.stage;
    rig.transitionAge = Infinity;
  }
}
