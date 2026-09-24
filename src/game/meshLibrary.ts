// One source mesh per thing, however many of it are standing in the world.
//
// Meshing a crop is expensive — a ripe cabbage is 277,000 voxels, and turning
// that into geometry costs a few hundred milliseconds. Twenty-five plots that
// each mesh their own plants cost nine seconds of frozen page, which is exactly
// what happened the first time the farm restored a sown parcel from a save.
//
// Nothing about the plants needed to be cheapened to fix it: a plot does not
// need its OWN cabbage, it needs A cabbage. The library meshes each model once,
// keeps it hidden, and hands out hardware instances, so the fiftieth lettuce
// costs one instance and no meshing at all. This is the same bargain the decor
// renderer already makes, in the smallest form that crops need.
import type { Mesh } from "@babylonjs/core";

export interface MeshLibrary {
  /** The hidden source for `id`, meshed on first ask and kept for the rest. */
  source(id: string, build: () => Mesh): Mesh;
  /** How many sources have been built — what the freeze was made of. */
  readonly size: number;
  dispose(): void;
}

export function createMeshLibrary(): MeshLibrary {
  const sources = new Map<string, Mesh>();
  return {
    source(id, build) {
      const existing = sources.get(id);
      if (existing) return existing;
      const mesh = build();
      // A source is never drawn itself; only its instances are.
      mesh.isVisible = false;
      mesh.isPickable = false;
      sources.set(id, mesh);
      return mesh;
    },
    get size() { return sources.size; },
    dispose() {
      for (const mesh of sources.values()) mesh.dispose(false, false);
      sources.clear();
    },
  };
}
