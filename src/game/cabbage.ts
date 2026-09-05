import { Mesh, Scene, ShadowGenerator, TransformNode, Vector3 } from "@babylonjs/core";
import { cellsFromAuthoredModel, type AuthoredVoxelModel } from "./voxelModel.ts";
import { createVoxelMesh } from "./voxelGeometry.ts";

export interface CabbageLeafRig {
  mesh: Mesh;
  phase: number;
  swayAxis: Vector3;
  baseRotation: Vector3;
  flapAmplitude: number;
}

export interface CabbageRig {
  root: TransformNode;
  leaves: CabbageLeafRig[];
}

export const cabbageLeafMotion = {
  outerOpeningRadians: 0.44,
  outerFlapRadians: 0.075,
  middleOpeningRadians: 0.3,
  middleFlapRadians: 0.06,
  middleLayerYawRadians: Math.PI / 4,
  middleLayerScale: 0.88,
  innerLayerScale: 0.79,
  innerLayerLiftInVoxels: 1.7,
  innerFlapRadians: 0.024,
  cyclesPerSecond: 0.11,
} as const;

/** Keeps the authored leaf layers separate so their curled edges can breathe
 * independently without introducing a skeleton. */
export function createCabbageRig(options: {
  name: string;
  model: AuthoredVoxelModel;
  scene: Scene;
  shadows?: ShadowGenerator;
}): CabbageRig {
  const { name, model, scene, shadows } = options;
  const root = new TransformNode(name, scene);
  const innerLayer = new TransformNode(`${name} compact inner head`, scene);
  innerLayer.parent = root;
  innerLayer.scaling.setAll(cabbageLeafMotion.innerLayerScale);
  innerLayer.position.y = model.pitch * cabbageLeafMotion.innerLayerLiftInVoxels;
  const leaves: CabbageLeafRig[] = [];
  const outerSources: Array<{ id: string; mesh: Mesh; swayAxis: Vector3; phase: number; pivot: Vector3 }> = [];
  const swayAxes: Record<string, Vector3> = {
    front_leaf: new Vector3(-1, 0, 0),
    back_leaf: new Vector3(1, 0, 0),
    left_leaf: new Vector3(0, 0, 1),
    right_leaf: new Vector3(0, 0, -1),
    top_leaf: new Vector3(0.35, 0, 0.2),
    top_cross_leaf: new Vector3(-0.18, 0, 0.32),
    heart_leaf: new Vector3(0.12, 0, -0.16),
  };
  const authoredYaw: Record<string, number> = {
    front_leaf: -0.035,
    back_leaf: 0.045,
    left_leaf: 0.025,
    right_leaf: -0.055,
    top_leaf: -0.28,
    top_cross_leaf: 0.75,
    heart_leaf: -0.62,
  };

  for (const [index, part] of model.parts.entries()) {
    const isOuterLeaf = part.id.endsWith("_leaf") && !part.id.startsWith("top") && part.id !== "heart_leaf";
    // The stalk anchors the whole plant and must sit under the wrap unscaled.
    const isRootPart = part.id === "stem";
    const mesh = createVoxelMesh(`${name} ${part.id}`, cellsFromAuthoredModel(model, [part.id]), model.pitch, scene);
    mesh.parent = isOuterLeaf || isRootPart ? root : innerLayer;
    mesh.setPivotPoint(new Vector3(...part.pivot).scale(model.pitch));
    const swayAxis = swayAxes[part.id];
    const baseRotation = swayAxis
      ? swayAxis.scale(isOuterLeaf ? cabbageLeafMotion.outerOpeningRadians : 0)
      : Vector3.Zero();
    baseRotation.y = authoredYaw[part.id] ?? 0;
    mesh.rotation.copyFrom(baseRotation);
    shadows?.addShadowCaster(mesh);
    if (swayAxis) leaves.push({
      mesh,
      phase: index * 1.37,
      swayAxis,
      baseRotation,
      flapAmplitude: isOuterLeaf ? cabbageLeafMotion.outerFlapRadians : cabbageLeafMotion.innerFlapRadians,
    });
    if (swayAxis && isOuterLeaf) {
      outerSources.push({ id: part.id, mesh, swayAxis, phase: index * 1.37, pivot: new Vector3(...part.pivot).scale(model.pitch) });
    }
  }

  // Cabbages alternate leaf direction from one wrap to the next. Reuse the
  // authored outer silhouettes as a smaller middle whorl, rotated by 45°.
  const middleLayer = new TransformNode(`${name} middle leaf whorl`, scene);
  middleLayer.parent = root;
  middleLayer.rotation.y = cabbageLeafMotion.middleLayerYawRadians;
  middleLayer.scaling.setAll(cabbageLeafMotion.middleLayerScale);
  middleLayer.position.y = model.pitch * 2.2;
  for (const [index, source] of outerSources.entries()) {
    const mesh = source.mesh.clone(`${name} middle ${source.id}`)!;
    mesh.parent = middleLayer;
    mesh.setPivotPoint(source.pivot);
    const baseRotation = source.swayAxis.scale(cabbageLeafMotion.middleOpeningRadians);
    baseRotation.y = (authoredYaw[source.id] ?? 0) * -0.65;
    mesh.rotation.copyFrom(baseRotation);
    shadows?.addShadowCaster(mesh);
    leaves.push({
      mesh,
      phase: source.phase + 0.83 + index * 0.21,
      swayAxis: source.swayAxis,
      baseRotation,
      flapAmplitude: cabbageLeafMotion.middleFlapRadians,
    });
  }
  return { root, leaves };
}

export function animateCabbageRig(rig: CabbageRig, elapsed: number): void {
  for (const leaf of rig.leaves) {
    const cycle = elapsed * Math.PI * 2 * cabbageLeafMotion.cyclesPerSecond + leaf.phase;
    const wave = Math.sin(cycle);
    const heldPose = Math.sign(wave) * Math.pow(Math.abs(wave), 0.72);
    const flap = heldPose * leaf.flapAmplitude + Math.sin(cycle * 0.43 + leaf.phase) * leaf.flapAmplitude * 0.2;
    leaf.mesh.rotation.x = leaf.baseRotation.x + leaf.swayAxis.x * flap;
    leaf.mesh.rotation.y = leaf.baseRotation.y + Math.sin(cycle * 0.37) * 0.008;
    leaf.mesh.rotation.z = leaf.baseRotation.z + leaf.swayAxis.z * flap;
  }
  rig.root.rotation.y = Math.sin(elapsed * 0.31) * 0.006;
}
