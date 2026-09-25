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
import { TransformNode, Vector3, type AbstractMesh, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import { advance, cropById, type CropDefinition, type PlantedCrop } from "./crops.ts";
import { createCropPlot, type CropPlot } from "./cropPlanting.ts";
import {
  FARM_SAVE_KEY, FARM_SAVE_VERSION, describePlot, nearestSite, plotSites, restorePlots,
  type AreaRect, type FarmSave, type PlotSite,
} from "./farm.ts";
import { bareSoil, dry, fertilise, growthRate, till, waterSoil, yieldBonus, lookOf, type Soil, type SoilLook } from "./soil.ts";
import { actionOf, refusalFor, type FarmAction, type Slot } from "./tools.ts";
import { DEVICE_MODELS, DEVICE_PERIOD, covered, jobFor, type Device, type DeviceKind } from "./automation.ts";
import { addItems } from "./inventory.ts";
import { createMeshLibrary } from "./meshLibrary.ts";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel } from "./voxelModel.ts";
import { createHarvestCrate, type HarvestCrate } from "./harvestCrate.ts";
import { createSoilPatches } from "./soilPatches.ts";
import { createCompostBin, type CompostBin } from "./compostBin.ts";
import { describeDevice } from "./automation.ts";
import { COMPOST_ITEM, SCRAPS_ITEM, SCRAPS_PER_PULLED_PLANT, SCRAPS_PER_SPENT_PLANT } from "./compost.ts";
import { readSave, writeSave } from "./persistence.ts";
import type { AuthoredVoxelCatalog } from "./voxelModel.ts";
import type { ParticleWorld } from "./voxelParticles.ts";

/** How far the player can reach, in metres — two plots, as Stardew allows. The
 *  limit is what makes the farm a place you walk through rather than a board you
 *  click at, so it is generous but real: work happens where the player is. */
export const REACH = 2.5;
/** How close the mouse has to be to a plot's middle for that plot to be the one
 *  being pointed at. Half the spacing, so every point on the farm belongs to
 *  exactly one plot and there is no dead ground between them. */
export const POINT_RADIUS = 0.62;

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
  soil: Soil;
  /** What the held slot would do here. */
  action: FarmAction;
  /** One line for the HUD: the plant, or the state of the ground. */
  label: string;
  /** Why the key would do nothing, when it would. */
  refusal: string;
  /** Whether the player is standing close enough to work this plot. */
  inReach: boolean;
  /** A sprinkler or seeder standing on this plot. */
  device: Device | null;
}

/** What actually happened, so the world can throw the right dirt in the air. */
export interface ActResult {
  action: FarmAction;
  site: PlotSite;
  /** Items handed over by a harvest. */
  items: number;
  /** Catalog id of what was harvested, where anything was. */
  crop: string | null;
  /** How the ground looks now, for the soil renderer. */
  look: SoilLook;
}

export interface Farm {
  readonly sites: readonly PlotSite[];
  /** The crate at the edge of the farm, if its model was in the catalog. */
  readonly crate: HarvestCrate | null;
  /** The compost bin beside it. */
  readonly bin: CompostBin | null;
  /** Tip carried scraps in and take out whatever compost is ready. Returns what
   *  moved in each direction. */
  workBin(): { tipped: number; taken: number };
  /** Tip everything carried into the crate. Returns how many went in. */
  unload(): number;
  /** Put something in the player's hands — a dish lifted off the plate, a
   *  delivery, anything the world hands over. Returns how many fitted. */
  give(items: readonly string[]): number;
  /** Take specific items back out, by id, one per entry. */
  remove(items: readonly string[]): void;
  readonly inventory: readonly string[];
  /** Game seconds since this farm started, across sessions. */
  readonly clock: number;
  /** The plot at a point, read with whatever is in hand. `from` is the player:
   *  a plot further than REACH from them is returned with `inReach` false rather
   *  than not at all, so the game can say "too far" instead of going quiet. */
  at(x: number, z: number, slot: Slot, from?: { x: number; z: number }): PlotReading | null;
  /** The nearest plot to the player, for the keyboard fallback. */
  addressed(x: number, z: number, slot: Slot): PlotReading | null;
  /** Use what is in hand on that plot, laid at `turn` quarter turns. */
  act(site: PlotSite, slot: Slot, turn?: number): ActResult | null;
  /** The ground's state at a plot, for the soil renderer. */
  soilAt(id: string): Soil;
  /** Lift or drop the whole farm — floor relief changes what "ground" means. */
  setGroundY(y: number): void;
  /** Devices standing on the farm. */
  readonly devices: Readonly<Record<string, Device>>;
  /** The plots a device on this plot would work — for showing its reach. */
  covering(site: PlotSite): PlotSite[];
  /** Plots a device pass worked since the last frame — for the water and the
   *  seed to be thrown about where it happened. */
  takeDeviceWork(): { site: PlotSite; job: "water" | "sow" }[];
  update(dt: number, focus?: { x: number; z: number }): void;
  save(): void;
  dispose(): void;
}

export function createFarm(options: FarmOptions): Farm {
  const { scene, catalog, particles } = options;
  const root = new TransformNode("farm", scene);
  if (options.parent) root.parent = options.parent;
  // The ground height lives on the farm's ROOT, not in every placement. Floor
  // relief raises the soil by a few centimetres and the farm has to come with
  // it — otherwise beds and plants sink into the ridges and vanish. One node to
  // move, and everything standing on the farm moves with it.
  root.position.y = options.groundY ?? 0.02;
  const groundY = 0;

  const sites = plotSites(options.areas);
  const byId = new Map(sites.map((site) => [site.id, site]));
  const plots: Record<string, PlantedCrop> = {};
  /** Ground state per plot. Only plots that have been worked appear here; the
   *  rest are bare, which costs nothing to represent. */
  const soils: Record<string, Soil> = {};
  /** Sprinklers and seeders, by the plot they stand on. */
  const devices: Record<string, Device> = {};
  /** Device meshes, built and taken down with the rest of the farm's scenery. */
  const deviceMeshes = new Map<string, AbstractMesh>();
  /** What the player last put in the ground, which is what a seeder copies. */
  let lastSown: string | null = null;
  /** Seconds until the devices take their next pass. */
  let devicesIn = DEVICE_PERIOD;
  /** What the last pass did, waiting to be shown. */
  let deviceWork: { site: PlotSite; job: "water" | "sow" }[] = [];
  const rendered = new Map<string, CropPlot>();
  // One meshing of each crop stage and each fruit for the whole farm; every
  // plant standing in the soil is an instance of it.
  const library = createMeshLibrary();
  // Worked ground, drawn near the player the same way the plants are.
  const patches = createSoilPatches({ scene, catalog, parent: root, shadows: options.shadows, material: options.material, groundY });
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
  // The bin stands beside the crate: waste comes back from the kitchen to the
  // same corner the produce leaves from.
  const bin = firstArea && catalog.models["compost_bin"]
    ? createCompostBin({
        scene, catalog, parent: root, shadows: options.shadows, material: options.material,
        position: new Vector3(firstArea.rect[0] + firstArea.rect[2] / 2 + 1.5, groundY, firstArea.rect[1] + firstArea.rect[3] + 0.7),
        spin: -Math.PI / 14,
      })
    : null;

  if (options.persist) {
    const saved = readSave<FarmSave>(FARM_SAVE_KEY, FARM_SAVE_VERSION);
    if (saved) {
      clock = Math.max(0, saved.clock);
      Object.assign(plots, restorePlots(saved.plots, sites));
      for (const [id, soil] of Object.entries(saved.soils ?? {})) if (byId.has(id)) soils[id] = { ...soil };
      for (const [id, device] of Object.entries(saved.devices ?? {})) if (byId.has(id)) devices[id] = { ...device };
      lastSown = saved.lastSown ?? null;
      inventory.push(...saved.inventory);
      crate?.set(saved.crate ?? []);
      if (saved.heap) bin?.restore(saved.heap);
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

  /** A device's mesh, instanced from the shared library like everything else. */
  const showDevice = (site: PlotSite): void => {
    const device = devices[site.id];
    if (!device || deviceMeshes.has(site.id)) return;
    const model = catalog.models[DEVICE_MODELS[device.kind]];
    if (!model) return;
    const source = library.source(`device:${device.kind}`, () => {
      const mesh = createVoxelMesh(`device ${device.kind}`, cellsFromAuthoredModel(model), model.pitch, scene,
        options.material ? { material: options.material } : {});
      mesh.receiveShadows = true;
      return mesh;
    });
    const instance = source.createInstance(`device ${site.id}`);
    instance.parent = root;
    instance.position.set(site.x, groundY, site.z);
    instance.rotation.y = (device.turn ?? 0) * (Math.PI / 2);
    instance.isPickable = false;
    options.shadows?.addShadowCaster(instance);
    deviceMeshes.set(site.id, instance);
  };

  /** One pass of every device: water what is dry, sow what is bare. Returns the
   *  plots that were worked, so the world can throw water about over them. */
  const runDevices = (): { site: PlotSite; job: "water" | "sow" }[] => {
    const worked: { site: PlotSite; job: "water" | "sow" }[] = [];
    for (const device of Object.values(devices)) {
      const here = byId.get(device.plot);
      if (!here) continue;
      // A seeder copies whatever the player last sowed, so it stays useful when
      // they change their mind about the crop.
      if (device.kind === "seeder" && lastSown && device.crop !== lastSown) device.crop = lastSown;
      for (const site of covered(here, sites)) {
        if (devices[site.id]) continue;      // devices do not work each other's plots
        const soil = soils[site.id] ?? bareSoil();
        const job = jobFor(device, soil, plots[site.id] ?? null);
        if (job === "water") {
          soils[site.id] = waterSoil(soil);
          patches.set(site.id, lookOf(soils[site.id]!), site, soils[site.id]!.turn);
          worked.push({ site, job });
        } else if (job === "sow" && device.crop) {
          const crop = cropById(device.crop);
          if (!crop) continue;
          const plot = rendererFor(site, crop);
          plot.sow();
          plots[site.id] = plot.state!;
          worked.push({ site, job });
        }
      }
    }
    return worked;
  };

  /** Build the plants and beds near the player and take down the ones that are not. */
  const admit = (focus: { x: number; z: number }): void => {
    let budget = BUILDS_PER_FRAME;
    for (const [id, soil] of Object.entries(soils)) {
      const site = byId.get(id);
      if (!site) continue;
      if (near(site, focus, RENDER_DISTANCE)) patches.set(id, lookOf(soil), site, soil.turn);
      else if (!near(site, focus, RETIRE_DISTANCE)) patches.remove(id);
    }
    for (const id of Object.keys(devices)) {
      const site = byId.get(id);
      if (!site) continue;
      if (near(site, focus, RENDER_DISTANCE)) showDevice(site);
      else if (!near(site, focus, RETIRE_DISTANCE)) {
        deviceMeshes.get(id)?.dispose(false, false);
        deviceMeshes.delete(id);
      }
    }
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

  /** One plot, read with what is in hand and from where the player stands. */
  const read = (site: PlotSite, slot: Slot, from?: { x: number; z: number }): PlotReading => {
    const planted = plots[site.id] ?? null;
    const soil = soils[site.id] ?? bareSoil();
    const device = devices[site.id] ?? null;
    const dx = (from?.x ?? site.x) - site.x;
    const dz = (from?.z ?? site.z) - site.z;
    return {
      site, planted, soil,
      action: actionOf(slot, soil, planted, inventory, Boolean(device)),
      label: device ? describeDevice(device) : describePlot(planted, soil),
      refusal: refusalFor(slot, soil, planted, inventory, Boolean(device)),
      inReach: dx * dx + dz * dz <= REACH * REACH,
      device,
    };
  };

  const farm: Farm = {
    get sites() { return sites; },
    get inventory() { return inventory; },
    get clock() { return clock; },

    get crate() { return crate; },
    get bin() { return bin; },

    workBin() {
      if (!bin) return { tipped: 0, taken: 0 };
      // One press does both jobs at the bin: tip in what you carried, take out
      // what is done. Two keys for two halves of the same errand is a menu.
      const scraps = inventory.filter((item) => item === SCRAPS_ITEM).length;
      const tipped = scraps ? bin.put(scraps) : 0;
      if (tipped) for (let n = 0; n < tipped; n++) inventory.splice(inventory.lastIndexOf(SCRAPS_ITEM), 1);
      const taken = bin.take();
      for (let n = 0; n < taken; n++) addItems(inventory, COMPOST_ITEM, 1, CARRY_CAPACITY);
      return { tipped, taken };
    },

    unload() {
      if (!crate || !inventory.length) return 0;
      const moved = crate.put(inventory);
      inventory.length = 0;
      return moved;
    },

    give(items) {
      let added = 0;
      for (const item of items) added += addItems(inventory, item, 1, CARRY_CAPACITY);
      return added;
    },

    remove(items) {
      for (const item of items) {
        const at = inventory.lastIndexOf(item);
        if (at >= 0) inventory.splice(at, 1);
      }
    },

    soilAt(id) { return soils[id] ?? bareSoil(); },
    setGroundY(y) { root.position.y = y; },
    get devices() { return devices; },
    covering(site) { return covered(site, sites); },
    takeDeviceWork() {
      const worked = deviceWork;
      deviceWork = [];
      return worked;
    },

    at(x, z, slot, from) {
      const site = nearestSite(sites, x, z, POINT_RADIUS);
      if (!site) return null;
      return read(site, slot, from);
    },

    addressed(x, z, slot) {
      const site = nearestSite(sites, x, z, REACH);
      if (!site) return null;
      return read(site, slot, { x, z });
    },

    act(site, slot, turn = 0) {
      if (!byId.has(site.id)) return null;
      const planted = plots[site.id] ?? null;
      const soil = soils[site.id] ?? bareSoil();
      const action = actionOf(slot, soil, planted, inventory, Boolean(devices[site.id]));
      const done = (items = 0, crop: string | null = null): ActResult => {
        const soilNow = soils[site.id] ?? bareSoil();
        const look = lookOf(soilNow);
        patches.set(site.id, look, site, soilNow.turn);
        return { action, site, items, crop, look };
      };

      switch (action) {
        case "till":
          soils[site.id] = till(soil, turn);
          return done();
        case "water":
          soils[site.id] = waterSoil(soil);
          return done();
        case "feed": {
          const kind = slot.kind === "tool" && slot.tool === "mulch" ? "mulch" : "compost";
          // Compost is spent from the player's own stock; mulch is straw off the
          // farm and costs nothing.
          if (kind === "compost") {
            const at = inventory.lastIndexOf(COMPOST_ITEM);
            if (at < 0) return done();
            inventory.splice(at, 1);
          }
          soils[site.id] = fertilise(soil, kind);
          return done();
        }
        case "place": {
          if (slot.kind !== "tool") return done();
          devices[site.id] = { kind: slot.tool as DeviceKind, plot: site.id, turn,
                               ...(slot.tool === "seeder" && lastSown ? { crop: lastSown } : {}) };
          showDevice(site);
          return done();
        }
        case "lift": {
          delete devices[site.id];
          deviceMeshes.get(site.id)?.dispose(false, false);
          deviceMeshes.delete(site.id);
          return done();
        }
        case "sow": {
          if (slot.kind !== "seed") return done();
          lastSown = slot.crop;
          const crop = cropById(slot.crop);
          if (!crop) return done();
          retiring.delete(site.id);
          const plot = rendererFor(site, crop);
          plot.sow();
          plots[site.id] = plot.state!;
          return done(0, crop.id);
        }
        case "remove": {
          // A plant comes out first and leaves its trimmings; a bare bed is
          // simply turned back into ground. Two presses to undo a planted plot,
          // which is one more than it takes to make one and exactly enough to
          // make a mis-click cheap.
          if (planted) {
            const pulled = planted.crop;
            drop(site.id);
            retiring.delete(site.id);
            addItems(inventory, SCRAPS_ITEM, SCRAPS_PER_SPENT_PLANT, CARRY_CAPACITY);
            return done(0, pulled);
          }
          delete soils[site.id];
          patches.remove(site.id);
          return done();
        }
        case "clear": {
          const cleared = planted?.crop ?? null;
          drop(site.id);
          retiring.delete(site.id);
          // A pulled-up plant is compost waiting to happen. The farm feeds its
          // own soil; the kitchen only adds to it.
          if (cleared) addItems(inventory, SCRAPS_ITEM, SCRAPS_PER_SPENT_PLANT, CARRY_CAPACITY);
          return done(0, cleared);
        }
        case "harvest": {
          if (!planted) return done();
          const grown = cropById(planted.crop)!;
          const plot = rendererFor(site, grown);
          // The ground's own contribution: composted soil gets a second roll at
          // the top of the crop's range.
          const result = plot.harvest(yieldBonus(soil));
          if (result.items && grown.produce) addItems(inventory, grown.produce, result.items, CARRY_CAPACITY);
          // Pulling a whole plant leaves tops, roots and trimmings behind.
          if (result.spent && grown.wholePlant) addItems(inventory, SCRAPS_ITEM, SCRAPS_PER_PULLED_PLANT, CARRY_CAPACITY);
          if (result.planted) {
            plots[site.id] = result.planted;
          } else {
            // Pulled up: the plot is empty from this instant, but the plant is
            // still shrinking into the soil, so its renderer is retired rather
            // than deleted out from under the animation.
            delete plots[site.id];
            retiring.set(site.id, RETIRE_SECONDS);
          }
          return done(result.items, grown.produce);
        }
        default:
          return done();
      }
    },

    update(dt, focus) {
      clock += dt;
      if (focus) admit(focus);

      // The whole farm ages, not just the part the player can see: soil dries
      // and plants bank growth wherever they are. Only the MESHES are near.
      for (const id of Object.keys(soils)) {
        const before = soils[id]!;
        const dried = dry(before, dt);
        if (dried.wet === 0 && !dried.tilled && dried.fertiliser === "none") { delete soils[id]; patches.remove(id); continue; }
        soils[id] = dried;
        // Ground drying out is a visible event, not a number: the bed lightens
        // the moment the last of the water goes.
        const site = byId.get(id);
        if (site && lookOf(before) !== lookOf(dried)) patches.set(id, lookOf(dried), site, dried.turn);
      }
      for (const [id, planted] of Object.entries(plots)) {
        const rate = growthRate(soils[id] ?? bareSoil());
        const plot = rendered.get(id);
        if (!plot) {
          const crop = cropById(planted.crop);
          if (crop) plots[id] = advance(crop, planted, dt, rate);
          continue;
        }
        plot.update(dt, rate);
        // The renderer is the authority while it exists; the farm keeps the
        // snapshot in step so the save and the distant plots agree with it.
        if (plot.state) plots[id] = plot.state;
      }
      for (const [id, plot] of rendered) if (!plots[id] && plot.state) plots[id] = plot.state;
      bin?.update(dt);

      // The devices take their pass on their own clock, wherever the player is:
      // a farm that only runs while it is being watched is not automated.
      devicesIn -= dt;
      if (devicesIn <= 0) {
        devicesIn = DEVICE_PERIOD;
        if (Object.keys(devices).length) deviceWork = deviceWork.concat(runDevices());
      }

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
        plots: { ...plots }, soils: { ...soils }, inventory: [...inventory], crate: [...(crate?.contents ?? [])],
        heap: bin ? { ...bin.heap, rotting: bin.heap.rotting.map((batch) => ({ ...batch })) } : undefined,
        devices: { ...devices }, lastSown,
      });
    },

    dispose() {
      crate?.dispose();
      bin?.dispose();
      patches.dispose();
      for (const mesh of deviceMeshes.values()) mesh.dispose(false, false);
      deviceMeshes.clear();
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
