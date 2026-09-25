// A plot with something growing in it: the bridge between crops.ts, which knows
// only numbers and a clock, and the scene, which knows only meshes.
//
// Nothing here decides anything about the game. The plot asks crops.ts what
// stage it should be showing, whether it is ready, and how far along the fruit
// is, then spends that on three effects:
//
//   * **Stage** — the cross-scale of stageRig.ts, old plant shrinking into the
//     soil as the new one pushes out.
//   * **Fruit** — createCropFruit hangs one item per socket on the ripe model.
//     Picking is a scale to nothing, regrowing is a scale back with a settle
//     overshoot; neither rebuilds anything.
//   * **Idle** — the wind shader, via a sway weight graded by height. This is a
//     deliberate refusal of the obvious alternative: a looping clip would make
//     decor.ts promote every planted crop into an uncached rig at ~305 ms each,
//     so a forty-plot farm would cost twelve seconds of load to do worse than a
//     shader that costs nothing per plant.
//
// Ripening gets one short particle burst, because a plant that becomes pickable
// while the player is looking somewhere else has to be able to say so.
import { TransformNode, Vector3, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import {
  advance, cropById, fruitProgress, harvest as harvestCrop, isReady, isSpent, plant as plantCrop, stageOf,
  CROP_STAGES, type CropDefinition, type HarvestResult, type PlantedCrop,
} from "./crops.ts";
import { createCropFruit, type CropFruitDisplay } from "./cropFruit.ts";
import { animateStages, createStageRig, disposeStageRig, requestStage, type StageRig } from "./stageRig.ts";
import { FRUIT_REGROW_SETTLE, easeInOutCubic, growWithOvershoot } from "./stageTransition.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog, type AuthoredVoxelModel, type ParticleEmitter } from "./voxelModel.ts";
import type { ParticleWorld } from "./voxelParticles.ts";
import type { MeshLibrary } from "./meshLibrary.ts";

/** Seconds the picking animation takes — long enough to see the fruit go, short
 *  enough that a player working down a row is never waiting for it. */
export const HARVEST_SECONDS = 0.45;

/** How much of a plant moves in the wind, at the top. Leaves stream, the stem
 *  bends a little, the soil does not move at all. */
export const PLANT_SWAY = 0.55;

export interface CropPlotOptions {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  crop: CropDefinition;
  parent?: TransformNode;
  position?: Vector3;
  /** Turns the plant so a row is not a row of clones. */
  spin?: number;
  /** Seeds fruit size and lean; defaults to the plot's name. */
  seed?: string;
  shadows?: ShadowGenerator;
  /** A wind material, or the plant stands stock still. */
  material?: StandardMaterial;
  /** Fires the ripening burst when given. */
  particles?: ParticleWorld;
  sway?: number;
  name?: string;
  /** Shared meshing for the stages and the fruit; see meshLibrary.ts. */
  library?: MeshLibrary;
}

export interface CropPlot {
  readonly crop: CropDefinition;
  /** What is in the ground, or null for bare soil. */
  readonly state: PlantedCrop | null;
  readonly root: TransformNode;
  /** Fruit hanging right now — what the player can see, not what a pick awards. */
  readonly shown: number;
  ready(): boolean;
  /** Sow (or re-sow) this plot. */
  sow(crop?: CropDefinition): void;
  /** Adopt a plant that already exists — a save coming back, or a plot handed
   *  over. The state is taken as given, including its age, rather than restarted. */
  restore(planted: PlantedCrop): void;
  /** Pick it. Returns what crops.ts decided; the animation follows.
   *  `bonus` is the soil's extra chance at a better picking. */
  harvest(bonus?: number): HarvestResult;
  /** `rate` is how fast this soil lets the plant grow: 0 in dry ground. */
  update(dt: number, rate?: number): void;
  dispose(): void;
}

/** The colour most of a model is made of — what a burst from it should look like. */
export function dominantColor(model: AuthoredVoxelModel): string {
  const counts = new Map<string, number>();
  for (const cell of cellsFromAuthoredModel(model)) counts.set(cell.color, (counts.get(cell.color) ?? 0) + 1);
  let best = "#ffffff";
  let most = 0;
  for (const [color, count] of counts) if (count > most) { best = color; most = count; }
  return best;
}

/** Three to five cubes, thrown up and gone. A confirmation, not a firework. */
function ripeningBurst(color: string, pitch: number): ParticleEmitter {
  return {
    id: "ripening", position: [0, 0, 0], colors: [color], size: pitch * 3,
    mode: "burst", count: 4, rate: 4, direction: [0, 1, 0], spread: 55,
    speed: [0.8, 1.5], life: [0.5, 0.9], gravity: 1, bounce: 0, friction: 0.7,
    stick: false, fade: true, spin: true,
  };
}

export function createCropPlot(options: CropPlotOptions): CropPlot {
  const { scene, catalog, particles } = options;
  let crop = options.crop;
  const root = new TransformNode(options.name ?? `plot ${crop.id}`, scene);
  if (options.parent) root.parent = options.parent;
  if (options.position) root.position.copyFrom(options.position);
  const seed = options.seed ?? root.name;

  let rig: StageRig | null = null;
  let fruit: CropFruitDisplay | null = null;
  let state: PlantedCrop | null = null;
  /** Fruit scale as shown, which lags the crop's own progress while a pick plays. */
  let open = 0;
  /** Seconds into the picking animation; Infinity when none is playing. */
  let picking = Infinity;
  /** Scale of the whole plant, which only moves when a whole-plant crop is pulled. */
  let pulled = Infinity;
  let wasReady = false;

  const build = (): void => {
    if (rig) { fruit?.dispose(); disposeStageRig(rig); }
    fruit = null;
    rig = createStageRig({
      scene, catalog, models: CROP_STAGES.map((stage) => crop.stages[stage]),
      parent: root, spin: options.spin, initialStage: 0, shadows: options.shadows,
      material: options.material, sway: options.sway ?? PLANT_SWAY, name: `${crop.id} plant`,
      library: options.library,
      // How much of each stage is underground: a root crop is mostly root.
      sink: (_id, index) => crop.sink?.[CROP_STAGES[index]!] ?? 0,
    });
    const ripe = rig.stages[rig.stages.length - 1]!;
    // Whole-plant crops carry no fruit: the plant IS the produce, and pulling it
    // takes the lot. Picked crops hang their produce on the ripe model's sockets.
    if (!crop.wholePlant && crop.produce) {
      fruit = createCropFruit({
        scene, model: ripe.model, node: ripe.mesh, catalog, fruit: crop.produce,
        seed, shadows: options.shadows, material: options.material, library: options.library,
      });
    }
  };

  /** Back to a clean, visible, empty plot. */
  const reset = (): void => {
    open = 0;
    picking = Infinity;
    pulled = Infinity;
    wasReady = false;
    root.setEnabled(true);
    root.scaling.setAll(1);
    fruit?.clear();
  };

  const show = (count: number): void => {
    fruit?.show(Math.min(count, fruit.capacity));
    fruit?.setOpen(open);
  };

  const burst = (): void => {
    if (!particles || !rig) return;
    const ripe = rig.stages[rig.stages.length - 1]!;
    const model = (crop.produce ? catalog.models[crop.produce] : null) ?? ripe.model;
    const top = ripe.mesh.getBoundingInfo().boundingBox.maximumWorld;
    particles.emitAt(ripeningBurst(dominantColor(model), model.pitch), new Vector3(top.x, top.y, top.z), Vector3.Up(), model.pitch);
  };

  return {
    get crop() { return crop; },
    get state() { return state; },
    root,
    get shown() { return fruit?.shown ?? 0; },
    ready() { return state !== null && isReady(crop, state); },

    sow(next) {
      const wanted = next ?? crop;
      if (!rig || wanted.id !== crop.id) { crop = wanted; build(); }
      reset();
      state = plantCrop(crop);
      requestStage(rig!, 0);
    },

    restore(planted) {
      const wanted = cropById(planted.crop) ?? crop;
      if (!rig || wanted.id !== crop.id) { crop = wanted; build(); }
      reset();
      state = planted;
      // No stage request here: the next update reads the plant's age and asks
      // for the stage it has actually reached, so a grown plant comes back grown
      // instead of sprouting again in front of the player.
    },

    harvest(bonus = 0) {
      if (!state) return { planted: null, items: 0, spent: false };
      const result = harvestCrop(crop, state, seed, bonus);
      if (!result.items) return result;
      // The plant is pulled or the fruit is picked; either way the model reacts
      // now and crops.ts has already decided what the player got.
      if (crop.wholePlant || result.planted === null) pulled = 0;
      else picking = 0;
      state = result.planted;
      wasReady = false;
      return result;
    },

    update(dt, rate = 1) {
      if (!rig) return;
      animateStages(rig, dt);

      if (pulled !== Infinity) {
        pulled += dt;
        const t = Math.min(1, pulled / HARVEST_SECONDS);
        root.scaling.setAll(1 - easeInOutCubic(t));
        if (t >= 1) { pulled = Infinity; root.setEnabled(false); fruit?.clear(); }
        return;
      }
      if (!state) return;
      // The plant only ages as fast as the ground lets it.
      state = advance(crop, state, dt, rate);

      const stage = stageOf(crop, state);
      requestStage(rig, CROP_STAGES.indexOf(stage));
      const ripe = stage === "ripe" && !isSpent(crop, state);
      if (picking !== Infinity) {
        picking += dt;
        const t = Math.min(1, picking / HARVEST_SECONDS);
        open = 1 - easeInOutCubic(t);
        if (t >= 1) { picking = Infinity; open = 0; fruit?.clear(); }
      } else {
        open = ripe ? growWithOvershoot(fruitProgress(crop, state), FRUIT_REGROW_SETTLE) : 0;
      }

      // Hanging fruit is capacity, not yield: the model shows a plausible plant,
      // and crops.ts awards the real number when it is picked.
      const wanted = ripe && open > 0 ? crop.sites : 0;
      if (fruit && fruit.shown !== Math.min(wanted, fruit.capacity)) show(wanted);
      else fruit?.setOpen(open);

      const readyNow = isReady(crop, state);
      if (readyNow && !wasReady) burst();
      wasReady = readyNow;
    },

    dispose() {
      fruit?.dispose();
      if (rig) disposeStageRig(rig);
      rig = null;
      root.dispose();
    },
  };
}

/** Convenience for fixtures and save loading: a plot for a crop id. */
export function createCropPlotById(options: Omit<CropPlotOptions, "crop"> & { crop: string }): CropPlot {
  const crop = cropById(options.crop);
  if (!crop) throw new Error(`Unknown crop ${options.crop}`);
  return createCropPlot({ ...options, crop });
}
