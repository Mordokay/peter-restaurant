// Tomato as staged scan art: three voxelized growth stages (sprout, vine, ripe)
// from the external-model pipeline, shown through the generic stage rig. It is
// kept as its own module because the model lab's tomato bench names these three
// ids; everything it once implemented now lives in stageRig.ts.
import { AbstractMesh, Scene, ShadowGenerator, TransformNode, Vector3 } from "@babylonjs/core";
import type { AuthoredVoxelCatalog } from "./voxelModel.ts";
import { animateStages, createStageRig, requestStage, type StageRig } from "./stageRig.ts";

export type TomatoStageName = "sprout" | "vine" | "ripe";

export interface TomatoStageRig extends StageRig {
  /** The stage meshes alone, which is what the lab bench pokes at. */
  stageMeshes: AbstractMesh[];
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
  const rig = createStageRig({ ...options, name: "tomato stage rig", models: STAGE_MODEL_IDS.map((name) => `tomato_${name}_scan`) });
  return Object.assign(rig, { stageMeshes: rig.stages.map((entry) => entry.mesh) });
}

export function requestTomatoStage(rig: TomatoStageRig, stage: number): void { requestStage(rig, stage); }
export function animateTomatoStages(rig: TomatoStageRig, dt: number): void { animateStages(rig, dt); }
