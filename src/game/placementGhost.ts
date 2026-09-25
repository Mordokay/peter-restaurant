// What you are about to put there, shown before you put it there.
//
// Every placement game worth playing shows the thing, not a highlight: a
// translucent bed under the hoe, the actual sprinkler under the sprinkler, the
// seedling you are about to sow. It answers three questions a coloured ring
// cannot — which cell, which way round, and how big — and it makes R (rotate)
// mean something you can see rather than a number you have to remember.
//
// One mesh per preview, built on demand and kept: there are only a handful, and
// they are instanced from the same library everything else uses.
import { Color3, StandardMaterial, TransformNode, type AbstractMesh, type Scene } from "@babylonjs/core";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";

export interface PlacementGhost {
  /** Show `model` at this spot, turned `turn` quarter turns. */
  show(model: string, at: { x: number; z: number }, turn: number): void;
  hide(): void;
  readonly model: string | null;
  dispose(): void;
}

export function createPlacementGhost(options: {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  parent?: TransformNode;
  groundY?: number;
  /** How solid the preview is. Low enough to read as "not yet", high enough to
   *  judge the shape by. */
  alpha?: number;
}): PlacementGhost {
  const { scene, catalog } = options;
  const root = new TransformNode("placement ghost", scene);
  if (options.parent) root.parent = options.parent;
  const groundY = options.groundY ?? 0.02;

  // One material for every ghost: unlit, so a preview never looks like a thing
  // standing in shadow, and tinted cool so it cannot be mistaken for the real
  // object at a glance.
  const material = new StandardMaterial("placement ghost", scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(0.72, 0.88, 0.78);
  material.alpha = options.alpha ?? 0.42;
  material.backFaceCulling = false;

  const built = new Map<string, AbstractMesh>();
  let current: string | null = null;

  const meshFor = (id: string): AbstractMesh | null => {
    const existing = built.get(id);
    if (existing) return existing;
    const model = catalog.models[id];
    if (!model) return null;
    const mesh = createVoxelMesh(`ghost ${id}`, cellsFromAuthoredModel(model), model.pitch, scene, { material });
    mesh.parent = root;
    mesh.isPickable = false;
    // Ghosts never take part in the world's lighting or shadows: they are not
    // there yet.
    mesh.receiveShadows = false;
    mesh.setEnabled(false);
    built.set(id, mesh);
    return mesh;
  };

  return {
    get model() { return current; },
    show(id, at, turn) {
      const mesh = meshFor(id);
      if (!mesh) return;
      if (current && current !== id) built.get(current)?.setEnabled(false);
      current = id;
      mesh.setEnabled(true);
      mesh.position.set(at.x, groundY, at.z);
      mesh.rotation.y = (((turn % 4) + 4) % 4) * (Math.PI / 2);
    },
    hide() {
      if (current) built.get(current)?.setEnabled(false);
      current = null;
    },
    dispose() {
      for (const mesh of built.values()) mesh.dispose(false, false);
      built.clear();
      material.dispose();
      root.dispose();
    },
  };
}
