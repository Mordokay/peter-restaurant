// The crate at the edge of the farm: where a full armful goes.
//
// It is the first place the produce models are used for what they are FOR —
// standing in a container at their real size, so a crate that swallows forty
// strawberries takes four cabbages and looks like it. The storage grid does all
// of that: the crate says where the twelve places are and storageDisplay works
// out how many places each item covers from its own measurements.
//
// What the crate shows is what fits; what it HOLDS is the whole tally. That is a
// deliberate split rather than an oversight — the display is a window onto the
// stock, and a crate piled over its brim would hide the plants behind it.
import { TransformNode, Vector3, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createStorageDisplay, type StorageDisplay } from "./storageDisplay.ts";
import { groupItems } from "./inventory.ts";

export const CRATE_MODEL = "crate_harvest";
/** How close the player has to be to unload, metres. */
export const CRATE_REACH = 1.4;

export interface HarvestCrateOptions {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  position: Vector3;
  parent?: TransformNode;
  spin?: number;
  shadows?: ShadowGenerator;
  material?: StandardMaterial;
}

export interface HarvestCrate {
  readonly root: TransformNode;
  readonly position: Vector3;
  /** Everything in it, as a flat list of catalog ids — the same shape the
   *  player's own inventory uses, so moving goods between them is a splice. */
  readonly contents: readonly string[];
  /** How many of the contents are actually standing in the crate. */
  readonly shown: number;
  /** Is the player close enough to unload into it? */
  inReach(x: number, z: number): boolean;
  /** Tip an armful in. Returns how many were taken. */
  put(items: readonly string[]): number;
  /** Put back a saved tally. */
  set(items: readonly string[]): void;
  /** Take a particular thing out, for the container panel. */
  takeItems(item: string, count: number): string[];
  dispose(): void;
}

export function createHarvestCrate(options: HarvestCrateOptions): HarvestCrate {
  const { scene, catalog } = options;
  const root = new TransformNode("harvest crate", scene);
  if (options.parent) root.parent = options.parent;
  root.position.copyFrom(options.position);
  root.rotation.y = options.spin ?? 0;

  const model = catalog.models[CRATE_MODEL];
  let display: StorageDisplay | null = null;
  if (model) {
    const mesh = createVoxelMesh("harvest crate", cellsFromAuthoredModel(model), model.pitch, scene,
      options.material ? { material: options.material } : {});
    mesh.parent = root;
    mesh.receiveShadows = true;
    options.shadows?.addShadowCaster(mesh);
    display = createStorageDisplay({ scene, model, node: root, catalog, shadows: options.shadows });
  }

  const contents: string[] = [];

  /** Places in the crate, so a mixed haul can be shown as a mixed crate. */
  const places = (): number => display?.grids.reduce((sum, grid) => sum + grid.cols * grid.rows, 0) ?? 0;

  const paint = (): void => {
    if (!display) return;
    // Grouped rather than one entry per item: the packer wants "eleven
    // strawberries", not eleven requests for one strawberry each. Each kind is
    // then capped at its fair share of the places, because a crate holding four
    // kinds that shows only carrots is a lie told by the packer's ordering —
    // the first kind in the list would otherwise fill every place.
    const held = groupItems(contents);
    const kinds = Object.entries(held).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    const share = Math.max(1, Math.floor(places() / Math.max(1, kinds.length)));
    display.show(kinds.map(([id, count]) => ({ model: id, count: Math.min(count ?? 0, share) })));
  };

  return {
    root,
    get position() { return root.position; },
    get contents() { return contents; },
    get shown() { return display?.filled ?? 0; },
    inReach(x, z) {
      const dx = root.position.x - x;
      const dz = root.position.z - z;
      return dx * dx + dz * dz <= CRATE_REACH * CRATE_REACH;
    },
    put(items) {
      if (!items.length) return 0;
      contents.push(...items);
      paint();
      return items.length;
    },
    takeItems(item, count) {
      const taken: string[] = [];
      for (let n = 0; n < Math.max(0, Math.floor(count)); n++) {
        const at = contents.lastIndexOf(item);
        if (at < 0) break;
        contents.splice(at, 1);
        taken.push(item);
      }
      if (taken.length) paint();
      return taken;
    },

    set(items) {
      contents.length = 0;
      contents.push(...items);
      paint();
    },
    dispose() {
      display?.dispose();
      root.dispose();
    },
  };
}
