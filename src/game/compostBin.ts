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
  /** Cells of the heap, sorted by height, so a fill level is a slice of them. */
  let heapCells: ReturnType<typeof cellsFromAuthoredModel> = [];
  let heapTop = 0;
  /** The fill the mesh currently shows, in tenths — remeshing on every gram
   *  would be absurd, and the eye cannot tell 61% from 63% of a bin. */
  let shownStep = -1;

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
    heapCells = cellsFromAuthoredModel(model, ["heap"]);
    heapTop = heapCells.reduce((high, cell) => Math.max(high, cell.y), 0);
  }

  /** Show the heap up to `fill` of its full height: a three-dimensional
   *  progress bar. Scaling the whole heap down — the first attempt — left cubes
   *  hanging in the air with daylight under them, because a heap is not a thing
   *  that gets shorter, it is a thing that has less IN it. */
  const meshHeap = (fill: number): void => {
    if (!model) return;
    const waterline = Math.max(0, Math.min(1, fill)) * (heapTop + 1);
    const cells = heapCells.filter((cell) => cell.y <= waterline);
    heapMesh?.dispose(false, false);
    heapMesh = null;
    if (!cells.length) return;
    heapMesh = createVoxelMesh("compost heap", cells, model.pitch, scene,
      options.material ? { material: options.material } : {});
    heapMesh.parent = root;
    heapMesh.receiveShadows = true;
    heapMesh.isPickable = false;
    options.shadows?.addShadowCaster(heapMesh);
  };

  let heap = emptyHeap();

  const paint = (): void => {
    const step = Math.round(fullness(heap) * 10);
    if (step === shownStep) return;
    shownStep = step;
    meshHeap(step / 10);
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
