// The compost bin, standing in the world.
//
// It shows what it holds by how high the heap stands in it — the heap is its own
// part, authored at full height and squashed to the fill, so a bin with two
// handfuls in it looks like a bin with two handfuls in it. No panel, no number
// over its head; the rulebook's rule that state is read off the object.
import { TransformNode, Vector3, type AbstractMesh, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { SCRAPS_ITEM, addScraps, emptyHeap, fullness, rot, takeCompost, type Heap } from "./compost.ts";

export const BIN_MODEL = "compost_bin";
export const BIN_REACH = 1.5;

export interface CompostBin {
  readonly root: TransformNode;
  readonly heap: Heap;
  inReach(x: number, z: number): boolean;
  /** Tip scraps in; returns how many the bin took. */
  put(scraps: number): number;
  /** Take the finished compost; returns how much came out. */
  take(): number;
  /** Take loose scraps back out — the ones not yet in a batch. Anything already
   *  rotting stays: you cannot un-rot a heap. */
  takeScraps(count: number): string[];
  update(dt: number): void;
  restore(heap: Heap): void;
  dispose(): void;
}

export function createCompostBin(options: {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  position: Vector3;
  parent?: TransformNode;
  spin?: number;
  shadows?: ShadowGenerator;
  material?: StandardMaterial;
}): CompostBin {
  const { scene, catalog } = options;
  const root = new TransformNode("compost bin", scene);
  if (options.parent) root.parent = options.parent;
  root.position.copyFrom(options.position);
  root.rotation.y = options.spin ?? 0;

  const model = catalog.models[BIN_MODEL];
  let heapMesh: AbstractMesh | null = null;
  if (model) {
    const build = (name: string, parts: string[]) => {
      const mesh = createVoxelMesh(name, cellsFromAuthoredModel(model, parts), model.pitch, scene,
        options.material ? { material: options.material } : {});
      mesh.parent = root;
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      options.shadows?.addShadowCaster(mesh);
      return mesh;
    };
    build("compost bin body", ["bin"]);
    heapMesh = build("compost heap", ["heap"]);
  }

  let heap = emptyHeap();

  const paint = (): void => {
    if (!heapMesh) return;
    const fill = fullness(heap);
    // Never quite zero: a hairline of compost left in an "empty" bin is how the
    // player knows the bin is a bin and not a box.
    heapMesh.scaling.y = Math.max(0.001, fill);
    heapMesh.setEnabled(fill > 0.01);
  };
  paint();

  return {
    root,
    get heap() { return heap; },
    inReach(x, z) {
      const dx = root.position.x - x;
      const dz = root.position.z - z;
      return dx * dx + dz * dz <= BIN_REACH * BIN_REACH;
    },
    put(scraps) {
      const result = addScraps(heap, scraps);
      heap = result.heap;
      paint();
      return result.taken;
    },
    take() {
      const result = takeCompost(heap);
      heap = result.heap;
      paint();
      return result.taken;
    },
    takeScraps(count) {
      const taken = Math.max(0, Math.min(heap.loose, Math.floor(count)));
      if (!taken) return [];
      heap = { ...heap, loose: heap.loose - taken };
      paint();
      return Array.from({ length: taken }, () => SCRAPS_ITEM);
    },

    update(dt) {
      const next = rot(heap, dt);
      if (next === heap) return;
      heap = next;
      paint();
    },
    restore(saved) {
      heap = { loose: saved.loose ?? 0, rotting: [...(saved.rotting ?? [])], ready: saved.ready ?? 0 };
      paint();
    },
    dispose() { root.dispose(); },
  };
}
