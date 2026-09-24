// The farm you can walk into: plot sites from the level plan, plants standing in
// them, and one action key that sows, harvests or clears whatever you are
// standing next to.
//
// Two decisions shape this file:
//
//   * **A plot costs nothing until something is sown in it.** There are two
//     hundred sites across the eight parcels; building a renderer for each would
//     pay for two hundred plants to watch bare soil. A CropPlot is made on
//     sowing and disposed when the plot goes empty.
//   * **The clock is the farm's own.** It is saved with the plots, so a plant
//     sown ten seconds before a reload is ten seconds old when the page comes
//     back — not fully grown because the session clock restarted at zero.
//
// Harvested items go into a plain array through inventory.ts, which is the form
// the storage grids already expect, so the crate that shows them is a renderer
// over the same data rather than a second source of truth.
import { TransformNode, Vector3, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import { cropById, type CropDefinition, type PlantedCrop } from "./crops.ts";
import { createCropPlot, type CropPlot } from "./cropPlanting.ts";
import {
  FARM_SAVE_KEY, FARM_SAVE_VERSION, actionFor, describePlot, nearestSite, plotSites, restorePlots,
  type AreaRect, type FarmSave, type PlotAction, type PlotSite,
} from "./farm.ts";
import { addItems } from "./inventory.ts";
import { createMeshLibrary } from "./meshLibrary.ts";
import { createHarvestCrate, type HarvestCrate } from "./harvestCrate.ts";
import { readSave, writeSave } from "./persistence.ts";
import type { AuthoredVoxelCatalog } from "./voxelModel.ts";
import type { ParticleWorld } from "./voxelParticles.ts";

/** How far the player can reach a plot from, metres. Generous: the plants are
 *  knee-high and the camera is overhead, so precision is not the fun part. */
export const REACH = 1.6;

/** Items the player can carry before a harvest starts falling on the floor. */
export const CARRY_CAPACITY = 120;

/** How far from the player a planted plot is actually built, and how far it has
 *  to get before it is taken down again. A plot beyond this is still growing —
 *  it is data and a clock — it simply has no meshes standing in it. */
export const RENDER_DISTANCE = 26;
export const RETIRE_DISTANCE = 32;
/** Plots built per frame. Instances are cheap, but the first of each crop still
 *  meshes a plant, and that belongs on its own frame. */
const BUILDS_PER_FRAME = 2;

export interface FarmOptions {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  areas: readonly AreaRect[];
  parent?: TransformNode;
  shadows?: ShadowGenerator;
  /** The wind material, so every plant on the farm sways on the same weather. */
  material?: StandardMaterial;
  particles?: ParticleWorld;
  /** Ground height the plants stand on. */
  groundY?: number;
  /** Off by default in tests; the world passes true. */
  persist?: boolean;
}

export interface PlotReading {
  site: PlotSite;
  planted: PlantedCrop | null;
  action: PlotAction;
  /** One line for the HUD. */
  label: string;
}

export interface Farm {
  readonly sites: readonly PlotSite[];
  /** The crate at the edge of the farm, if its model was in the catalog. */
  readonly crate: HarvestCrate | null;
  /** Tip everything carried into the crate. Returns how many went in. */
  unload(): number;
  readonly inventory: readonly string[];
  /** Game seconds since this farm started, across sessions. */
  readonly clock: number;
  /** The plot the player is addressing, with what the action key would do. */
  addressed(x: number, z: number): PlotReading | null;
  /** Sow, harvest or clear that plot. Returns what happened. */
  act(site: PlotSite, crop: CropDefinition): { action: PlotAction; items: number; crop: string | null };
  /** `focus` is the player: plots near them are built, far ones are taken down. */
  update(dt: number, focus?: { x: number; z: number }): void;
  save(): void;
  dispose(): void;
}

export function createFarm(options: FarmOptions): Farm {
  const { scene, catalog, particles } = options;
  const root = new TransformNode("farm", scene);
  if (options.parent) root.parent = options.parent;
  const groundY = options.groundY ?? 0.02;

  const sites = plotSites(options.areas);
  const byId = new Map(sites.map((site) => [site.id, site]));
  const plots: Record<string, PlantedCrop> = {};
  const rendered = new Map<string, CropPlot>();
  // One meshing of each crop stage and each fruit for the whole farm; every
  // plant standing in the soil is an instance of it.
  const library = createMeshLibrary();
  const inventory: string[] = [];
  let clock = 0;

  // One crate, standing at the near corner of the first parcel: close enough to
  // the rows to walk an armful over, off the grid so it never eats a plot.
  const firstArea = options.areas.find((area) => area.zone === "farm");
  const crate = firstArea && catalog.models["crate_harvest"]
    ? createHarvestCrate({
        scene, catalog, parent: root, shadows: options.shadows, material: options.material,
        position: new Vector3(firstArea.rect[0] + firstArea.rect[2] / 2, groundY, firstArea.rect[1] + firstArea.rect[3] + 0.6),
        spin: Math.PI / 12,
      })
    : null;

  if (options.persist) {
    const saved = readSave<FarmSave>(FARM_SAVE_KEY, FARM_SAVE_VERSION);
    if (saved) {
      clock = Math.max(0, saved.clock);
      Object.assign(plots, restorePlots(saved.plots, sites));
      inventory.push(...saved.inventory);
      crate?.set(saved.crate ?? []);
    }
  }

  /** The renderer for a plot, built on demand. Its seed is the plot id, so the
   *  same plot always grows the same sizes and leans — a farm the player learns
   *  the shape of rather than one that reshuffles itself every reload. */
  const rendererFor = (site: PlotSite, crop: CropDefinition): CropPlot => {
    const existing = rendered.get(site.id);
    if (existing && existing.crop.id === crop.id) return existing;
    existing?.dispose();
    const plot = createCropPlot({
      scene, catalog, crop, parent: root,
      position: new Vector3(site.x, groundY, site.z),
      // A row of plants all facing the same way reads as wallpaper.
      spin: (Math.abs(Math.round(site.x * 7 + site.z * 13)) % 8) * (Math.PI / 4),
      seed: site.id, material: options.material, shadows: options.shadows, particles,
      name: `plot ${site.id}`, library,
    });
    rendered.set(site.id, plot);
    return plot;
  };

  /** Seconds a pulled-up plant keeps its renderer, so the shrink can play out. */
  const RETIRE_SECONDS = 1;
  /** Plot id -> seconds of animation left before its renderer is thrown away. */
  const retiring = new Map<string, number>();

  const drop = (id: string): void => {
    rendered.get(id)?.dispose();
    rendered.delete(id);
    delete plots[id];
  };

  const near = (site: PlotSite, focus: { x: number; z: number }, range: number): boolean => {
    const dx = site.x - focus.x;
    const dz = site.z - focus.z;
    return dx * dx + dz * dz <= range * range;
  };

  /** Build the plants near the player and take down the ones that are not. */
  const admit = (focus: { x: number; z: number }): void => {
    let budget = BUILDS_PER_FRAME;
    for (const [id, planted] of Object.entries(plots)) {
      const site = byId.get(id);
      if (!site) continue;
      const built = rendered.has(id);
      if (!built && budget > 0 && near(site, focus, RENDER_DISTANCE)) {
        const crop = cropById(planted.crop);
        if (!crop) continue;
        rendererFor(site, crop).restore(planted);
        budget--;
      } else if (built && !retiring.has(id) && !near(site, focus, RETIRE_DISTANCE)) {
        rendered.get(id)?.dispose();
        rendered.delete(id);       // the plant keeps growing; only its meshes go
      }
    }
  };

  const farm: Farm = {
    get sites() { return sites; },
    get inventory() { return inventory; },
    get clock() { return clock; },

    addressed(x, z) {
      const site = nearestSite(sites, x, z, REACH);
      if (!site) return null;
      const planted = plots[site.id] ?? null;
      return { site, planted, action: actionFor(planted, clock), label: describePlot(planted, clock) };
    },

    act(site, crop) {
      if (!byId.has(site.id)) return { action: "growing", items: 0, crop: null };
      const planted = plots[site.id] ?? null;
      const action = actionFor(planted, clock);

      if (action === "sow") {
        retiring.delete(site.id);
        const plot = rendererFor(site, crop);
        plot.sow(clock);
        plots[site.id] = plot.state!;
        return { action, items: 0, crop: crop.id };
      }
      if (action === "clear") {
        const cleared = planted?.crop ?? null;
        drop(site.id);
        retiring.delete(site.id);
        return { action, items: 0, crop: cleared };
      }
      if (action === "harvest" && planted) {
        const grown = cropById(planted.crop)!;
        const plot = rendererFor(site, grown);
        const result = plot.harvest(clock);
        if (result.items && grown.produce) addItems(inventory, grown.produce, result.items, CARRY_CAPACITY);
        if (result.planted) {
          plots[site.id] = result.planted;
        } else {
          // Pulled up: the plot is empty from this instant, but the plant is
          // still shrinking into the soil, so its renderer is retired rather
          // than deleted out from under the animation.
          delete plots[site.id];
          retiring.set(site.id, RETIRE_SECONDS);
        }
        return { action, items: result.items, crop: grown.produce };
      }
      return { action, items: 0, crop: planted?.crop ?? null };
    },

    get crate() { return crate; },

    unload() {
      if (!crate || !inventory.length) return 0;
      const moved = crate.put(inventory);
      inventory.length = 0;
      return moved;
    },

    update(dt, focus) {
      clock += dt;
      if (focus) admit(focus);
      for (const plot of rendered.values()) plot.update(clock, dt);
      for (const [id, left] of retiring) {
        const remaining = left - dt;
        if (remaining > 0) { retiring.set(id, remaining); continue; }
        retiring.delete(id);
        // Only if nothing has been sown here since: a plot re-used inside the
        // retirement window keeps its new plant.
        if (!plots[id]) drop(id);
      }
    },

    save() {
      if (!options.persist) return;
      writeSave<FarmSave>(FARM_SAVE_KEY, {
        version: FARM_SAVE_VERSION, savedAt: Date.now(), clock,
        plots: { ...plots }, inventory: [...inventory], crate: [...(crate?.contents ?? [])],
      });
    },

    dispose() {
      crate?.dispose();
      for (const plot of rendered.values()) plot.dispose();
      rendered.clear();
      library.dispose();
      root.dispose();
    },
  };

  // Plants that were in the ground when the page closed keep growing from the
  // moment they were left at; their meshes are built by the first update, and
  // only for the plots the player is actually near.
  return farm;
}
