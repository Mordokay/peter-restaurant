// The reach of a thing, drawn on the ground.
//
// A sprinkler that says "waters the four beds around it" in a line of text is a
// manual. A sprinkler that lights up the four beds it waters when you point at
// it is a game. The squares pulse, because a still overlay reads as part of the
// world and this is a thing the player is being TOLD, for as long as they ask.
//
// One thin quad per cell, instanced from a single source and driven by one
// material — the whole highlight is one draw call however many cells it covers.
import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, type InstancedMesh, type Scene } from "@babylonjs/core";

export interface RangeHighlight {
  /** Light these cells up. Passing none puts the highlight away. */
  show(cells: readonly { x: number; z: number }[], colour?: string): void;
  hide(): void;
  /** Call each frame: the pulse is time-based, not frame-based. */
  update(dt: number): void;
  dispose(): void;
}

export function createRangeHighlight(options: {
  scene: Scene;
  parent?: TransformNode;
  /** Cell size, so the squares match the grid exactly. */
  size?: number;
  groundY?: number;
}): RangeHighlight {
  const { scene } = options;
  const size = options.size ?? 1;
  const root = new TransformNode("range highlight", scene);
  if (options.parent) root.parent = options.parent;

  const material = new StandardMaterial("range highlight", scene);
  material.disableLighting = true;
  material.emissiveColor = Color3.FromHexString("#5b9fd6");
  material.alpha = 0.3;
  material.backFaceCulling = false;

  // A square a hair inside the cell, so neighbouring squares read as separate
  // tiles rather than one continuous sheet.
  const source = MeshBuilder.CreateGround("range cell", { width: size * 0.92, height: size * 0.92 }, scene);
  source.material = material;
  source.isVisible = false;
  source.isPickable = false;
  source.parent = root;

  const cells: InstancedMesh[] = [];
  let shown = 0;
  let time = 0;

  const ensure = (count: number): void => {
    while (cells.length < count) {
      const instance = (source as Mesh).createInstance(`range cell ${cells.length}`);
      instance.parent = root;
      instance.isPickable = false;
      cells.push(instance);
    }
  };

  return {
    show(wanted, colour) {
      if (colour) material.emissiveColor = Color3.FromHexString(colour);
      ensure(wanted.length);
      for (const [index, cell] of wanted.entries()) {
        const instance = cells[index]!;
        instance.position.set(cell.x, options.groundY ?? 0.05, cell.z);
        instance.setEnabled(true);
      }
      for (let index = wanted.length; index < cells.length; index++) cells[index]!.setEnabled(false);
      shown = wanted.length;
    },
    hide() {
      for (const instance of cells) instance.setEnabled(false);
      shown = 0;
    },
    update(dt) {
      if (!shown) return;
      time += dt;
      // Slow, shallow: a heartbeat rather than a strobe.
      material.alpha = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(time * 3.4));
    },
    dispose() {
      for (const instance of cells) instance.dispose(false, false);
      cells.length = 0;
      source.dispose(false, false);
      material.dispose();
      root.dispose();
    },
  };
}
