// The ground the player has worked, drawn.
//
// A plot's soil is four lines of data; this is how the player reads it without
// being told. Broken ground is a ridged bed, watering darkens it the way real
// earth darkens, compost flecks it black, and mulch pales it with straw. One
// mesh per look, instanced — a farm of two hundred worked beds is five sources
// and two hundred instances.
//
// The looks are recolourings of ONE authored bed rather than four models: the
// shape of hoed earth does not change when you water it, and four models would
// be four things to keep in step.
import { Color3, TransformNode, type AbstractMesh, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createMeshLibrary } from "./meshLibrary.ts";
import { hash01 } from "./hash.ts";
import type { SoilLook } from "./soil.ts";

export const BED_MODEL = "soil_bed";

export interface SoilPatches {
  /** Show this plot's ground in this state; "bare" takes the bed away. */
  set(id: string, look: SoilLook, at: { x: number; z: number }): void;
  /** Take a plot's bed away entirely. */
  remove(id: string): void;
  readonly shown: number;
  dispose(): void;
}

/** Darken for wet, blacken for compost, pale for mulch. A single multiply would
 *  make wet earth grey; real wet earth keeps its warmth and loses its light, so
 *  the channels move by different amounts. */
function recolour(hex: string, look: SoilLook): string {
  const colour = Color3.FromHexString(hex);
  const apply = (r: number, g: number, b: number): Color3 => new Color3(colour.r * r, colour.g * g, colour.b * b);
  switch (look) {
    // Wet earth is darker AND cooler, not simply darker: a flat multiply makes
    // it read as shadow, and the player has to tell wet ground from a bed that
    // happens to be in shade.
    case "wet": return apply(0.62, 0.64, 0.74).toHexString();
    case "fed": return apply(0.86, 0.88, 0.80).toHexString();
    case "fedwet": return apply(0.56, 0.58, 0.66).toHexString();
    default: return hex;
  }
}

export function createSoilPatches(options: {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  parent?: TransformNode;
  shadows?: ShadowGenerator;
  material?: StandardMaterial;
  /** Ground height the beds lie on. */
  groundY?: number;
}): SoilPatches {
  const { scene, catalog } = options;
  const root = new TransformNode("soil patches", scene);
  if (options.parent) root.parent = options.parent;
  const groundY = options.groundY ?? 0.02;
  const model = catalog.models[BED_MODEL];
  const library = createMeshLibrary();
  const shown = new Map<string, { mesh: AbstractMesh; look: SoilLook; flecks?: AbstractMesh }>();

  /** Compost on top of the bed: flecks of peel, leaf and shell scattered over
   *  the ridges. Fed ground has to be legible at a glance from across the farm,
   *  and a tint alone is not — every farming game that does this well puts
   *  something ON the soil. */
  const FLECKS = ["#3f3226", "#7b8a3a", "#c47a2c", "#d8cfae", "#5d7a3a", "#8a5a2a"];
  const sprinkleSource = () => {
    if (!model) return null;
    return library.source("bed:flecks", () => {
      const cells = cellsFromAuthoredModel(model);
      // The top of each ridge, thinned out: flecks sit where they would land.
      const tops = new Map<string, { x: number; y: number; z: number }>();
      for (const cell of cells) {
        const key = `${cell.x},${cell.z}`;
        const top = tops.get(key);
        if (!top || cell.y > top.y) tops.set(key, cell);
      }
      const flecks = [...tops.values()]
        .filter((cell) => hash01(`${cell.x},${cell.z}`, 7) < 0.16)
        .map((cell) => ({ x: cell.x, y: cell.y + 1, z: cell.z, color: FLECKS[Math.floor(hash01(`${cell.x},${cell.z}`, 9) * FLECKS.length)]! }));
      const mesh = createVoxelMesh("bed flecks", flecks, model.pitch, scene, options.material ? { material: options.material } : {});
      mesh.receiveShadows = true;
      return mesh;
    });
  };

  const sourceFor = (look: SoilLook) => {
    if (!model) return null;
    return library.source(`bed:${look}`, () => {
      const cells = cellsFromAuthoredModel(model).map((cell) => ({ ...cell, color: recolour(cell.color, look) }));
      const mesh = createVoxelMesh(`bed ${look}`, cells, model.pitch, scene, options.material ? { material: options.material } : {});
      mesh.receiveShadows = true;
      return mesh;
    });
  };

  return {
    get shown() { return shown.size; },
    set(id, look, at) {
      const existing = shown.get(id);
      if (existing?.look === look) return;
      if (existing) { existing.flecks?.dispose(false, false); existing.mesh.dispose(false, false); shown.delete(id); }
      if (look === "bare") return;
      const source = sourceFor(look);
      if (!source) return;
      const instance = source.createInstance(`bed ${id}`);
      instance.parent = root;
      // A quarter turn per plot, chosen by the plot's own name: hoed beds do not
      // all run the same way, and a field of identical ridges reads as tiling.
      instance.rotation.y = Math.floor(hash01(id, 0) * 4) * (Math.PI / 2);
      instance.position.set(at.x, groundY, at.z);
      instance.isPickable = false;
      options.shadows?.addShadowCaster(instance);
      shown.set(id, { mesh: instance, look });
      if (look === "fed" || look === "fedwet") {
        const flecks = sprinkleSource()?.createInstance(`bed flecks ${id}`);
        if (flecks) {
          flecks.parent = instance;
          flecks.isPickable = false;
          shown.get(id)!.flecks = flecks;
        }
      }
    },
    remove(id) {
      const existing = shown.get(id);
      if (!existing) return;
      existing.flecks?.dispose(false, false);
      existing.mesh.dispose(false, false);
      shown.delete(id);
    },
    dispose() {
      for (const entry of shown.values()) { entry.flecks?.dispose(false, false); entry.mesh.dispose(false, false); }
      shown.clear();
      library.dispose();
      root.dispose();
    },
  };
}
