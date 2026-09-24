// Fruit hanging on a growing crop.
//
// A plant model carries no fruit geometry. It carries fruit SOCKETS — `fruit_0`,
// `fruit_1`, … authored at the points where fruit actually hangs — and the game
// places however many the crop yielded. That is what lets ONE plant model serve
// every yield: a strawberry with four berries and one with eight are the same
// asset, and the fruit model is the same one that sits in a crate afterwards.
//
// Two rules are baked in here rather than left to callers:
//
//   * **No two fruit are the same size.** Every placement takes a deterministic
//     scale and turn derived from the plant's id and the socket index, so a
//     plant is identical across saves and reloads but never looks stamped out.
//     This is the prop-level form of the rule that no surface may be flat.
//   * **The socket marks where the fruit's BASE sits**, so an item modelled
//     standing on its own origin hangs correctly here and stands correctly on a
//     shelf, with no per-context fudging.
//
// Harvesting is a scale, not a rebuild: `setOpen` drives every fruit from full
// to nothing and back, so a clip can ease it without touching the scene graph.
import { type AbstractMesh, type Mesh, type Scene, type ShadowGenerator, type StandardMaterial, type TransformNode } from "@babylonjs/core";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog, type AuthoredVoxelModel } from "./voxelModel.ts";
import { createVoxelMaterial, createVoxelMesh } from "./voxelGeometry.ts";
import { modelBounds, placementAttitude } from "./storageDisplay.ts";
import { hash01 } from "./hash.ts";
import type { MeshLibrary } from "./meshLibrary.ts";

/** Socket names this reads. `fruit_12` sorts after `fruit_2`, hence the numeric sort. */
const FRUIT_SOCKET = /^fruit_(\d+)$/;

/** Ceiling on `setOpen`, sized for the regrow settle rather than for a clip
 *  that wants to make fruit the size of the plant. */
const MAX_OPEN = 1.5;

export interface CropFruitOptions {
  scene: Scene;
  /** The plant model carrying the sockets. */
  model: AuthoredVoxelModel;
  /** Node the fruit hangs from — the prop's root, or a rig part node. */
  node: TransformNode;
  catalog: AuthoredVoxelCatalog;
  /** Catalog id of the fruit to hang (`item_strawberry`, `item_pepper_red`, …). */
  fruit: string;
  /** Seeds the per-fruit size and turn. Use the prop's id so it is stable. */
  seed?: string;
  /** Part whose sockets to use; defaults to the first part that has any `fruit_n`. */
  part?: string;
  /** How far size may stray from nominal. 0.15 = 85%..115%. Default 0.15. */
  sizeVariation?: number;
  /** Degrees of lean off vertical. Fruit hangs less tidily than shelved goods,
   *  so this defaults higher than storage's 5. */
  tiltDegrees?: number;
  shadows?: ShadowGenerator;
  material?: StandardMaterial;
  /** Share one meshing of the fruit across every plant carrying it. */
  library?: MeshLibrary;
}

export interface CropFruitDisplay {
  /** How many fruit this plant could ever carry — the socket count. */
  readonly capacity: number;
  /** How many are hanging now. */
  readonly shown: number;
  /** Hang `count` fruit, clamped to capacity. */
  show(count: number): void;
  /** 0 = picked clean, 1 = fully grown. Multiplies each fruit's own size, so a
   *  harvest clip can ease this to 0 and a regrow can ease it back. Values just
   *  above 1 are allowed on purpose: regrowth overshoots and settles, and
   *  clamping at 1 would quietly flatten that pop into a fade. */
  setOpen(fraction: number): void;
  clear(): void;
  dispose(): void;
}

/** The `fruit_n` sockets of a model, in index order. */
export function fruitSocketsOf(model: AuthoredVoxelModel, partId?: string): { name: string; cell: readonly [number, number, number] }[] {
  const part = partId
    ? model.parts.find((candidate) => candidate.id === partId)
    : model.parts.find((candidate) => Object.keys(candidate.sockets ?? {}).some((name) => FRUIT_SOCKET.test(name)));
  const sockets = part?.sockets ?? {};
  return Object.entries(sockets)
    .map(([name, cell]) => ({ name, cell, index: Number(FRUIT_SOCKET.exec(name)?.[1] ?? NaN) }))
    .filter((entry) => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index)
    .map(({ name, cell }) => ({ name, cell }));
}

export function createCropFruit(options: CropFruitOptions): CropFruitDisplay {
  const { scene, model, node, catalog, fruit } = options;
  const seed = options.seed ?? node.name;
  const spread = options.sizeVariation ?? 0.15;
  const material = options.material ?? createVoxelMaterial("crop fruit", scene);
  const sockets = fruitSocketsOf(model, options.part);

  let source: { mesh: Mesh; lift: number; owned: boolean } | null = null;
  const sourceMesh = (): { mesh: Mesh; lift: number } | null => {
    if (source) return source;
    const item = catalog.models[fruit];
    if (!item) return null;
    const cells = cellsFromAuthoredModel(item);
    if (!cells.length) return null;
    const build = (): Mesh => {
      const built = createVoxelMesh(`fruit ${fruit}`, cells, item.pitch, scene, { material });
      built.isVisible = false;
      built.isPickable = false;
      return built;
    };
    const bounds = modelBounds(item);
    // Stand it on its own base, so the socket can mean "where the fruit sits".
    source = options.library
      ? { mesh: options.library.source(`fruit ${fruit}`, build), lift: -(bounds.min.y - 0.5) * item.pitch, owned: false }
      : { mesh: build(), lift: -(bounds.min.y - 0.5) * item.pitch, owned: true };
    return source;
  };

  /** Per-fruit size, before `setOpen` scales the lot. */
  const sizes: number[] = [];
  const hung: AbstractMesh[] = [];
  let open = 1;

  const clear = (): void => {
    for (const mesh of hung) { options.shadows?.removeShadowCaster(mesh); mesh.dispose(false, false); }
    hung.length = 0;
    sizes.length = 0;
  };

  const applyScale = (): void => {
    for (const [index, mesh] of hung.entries()) mesh.scaling.setAll(Math.max(1e-4, sizes[index]! * open));
  };

  return {
    get capacity() { return sockets.length; },
    get shown() { return hung.length; },
    show(count) {
      clear();
      const built = sourceMesh();
      if (!built) return;
      const wanted = Math.max(0, Math.min(sockets.length, Math.floor(count)));
      for (let index = 0; index < wanted; index++) {
        const socket = sockets[index]!;
        const instance = built.mesh.createInstance(`${node.name}.${socket.name}`);
        instance.parent = node;
        instance.position.set(socket.cell[0] * model.pitch,
                              socket.cell[1] * model.pitch + built.lift,
                              socket.cell[2] * model.pitch);
        // No two fruit alike: a size, a turn and a lean, all stable for this
        // plant. Fruit hangs at whatever angle it grew at, never plumb.
        sizes.push(1 - spread + hash01(seed, index, 1) * spread * 2);
        const attitude = placementAttitude(seed, index, options.tiltDegrees ?? 12);
        instance.rotation.set(attitude.x, attitude.y, attitude.z);
        instance.isPickable = false;
        options.shadows?.addShadowCaster(instance);
        hung.push(instance);
      }
      applyScale();
    },
    setOpen(fraction) {
      open = Math.max(0, Math.min(MAX_OPEN, fraction));
      applyScale();
    },
    clear,
    dispose() {
      clear();
      // A library's source belongs to the library; only a private one is ours to throw away.
      if (source?.owned) source.mesh.dispose(false, false);
      source = null;
      if (!options.material) material.dispose();
    },
  };
}
