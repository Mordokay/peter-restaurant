// The prep counter: where the farm's produce becomes something a customer would
// order, and the far end of the chain the crops were built for.
//
// The counter is deliberately physical. Ingredients stand on its board, the dish
// stands on its plate, and both are the same models that grew in the soil and
// went into the crate — so the player can read the state of the kitchen by
// looking at it, which is the rulebook's picture-first rule applied to a
// station rather than to a menu.
//
// It holds no rules of its own: recipes.ts decides what can be made and what it
// costs, and this decides only where things stand and how long the knife takes.
import { TransformNode, Vector3, type Scene, type ShadowGenerator, type StandardMaterial } from "@babylonjs/core";
import { createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createStorageDisplay, type StorageDisplay } from "./storageDisplay.ts";
import { consume, readyRecipe, recipeById, stockOf, takeForBoard, type Recipe } from "./recipes.ts";

export const PREP_MODEL = "prep_table";
/** How close the player has to stand to work at it, metres. */
export const PREP_REACH = 1.7;
/** Places on the board — what the counter can hold waiting to be prepped. */
export const BOARD_PLACES = 6;

export interface PrepStationOptions {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  position: Vector3;
  parent?: TransformNode;
  spin?: number;
  shadows?: ShadowGenerator;
  material?: StandardMaterial;
}

export interface PrepState {
  ingredients: string[];
  dish: string | null;
  /** Recipe id and seconds left, when something is being made. */
  working: { recipe: string; left: number } | null;
}

export interface PrepStation {
  readonly root: TransformNode;
  readonly ingredients: readonly string[];
  readonly dish: string | null;
  readonly working: { recipe: Recipe; left: number } | null;
  inReach(x: number, z: number): boolean;
  /** Take what the counter can use out of an armful. Returns what it took, so
   *  the caller can remove exactly those from the player. */
  put(items: readonly string[]): string[];
  /** Begin the recipe the board can supply, if any. Returns it. */
  start(): Recipe | null;
  /** Sweep the board back into the player's hands. */
  clear(): string[];
  /** True when nothing on the board is any use here — the only state worth
   *  sweeping. A board short of one ingredient is working, not stuck. */
  idle(): boolean;
  /** Lift the finished dish off the plate. */
  take(): string | null;
  update(dt: number): void;
  state(): PrepState;
  restore(state: PrepState): void;
  dispose(): void;
}

export function createPrepStation(options: PrepStationOptions): PrepStation {
  const { scene, catalog } = options;
  const root = new TransformNode("prep station", scene);
  if (options.parent) root.parent = options.parent;
  root.position.copyFrom(options.position);
  root.rotation.y = options.spin ?? 0;

  const model = catalog.models[PREP_MODEL];
  let display: StorageDisplay | null = null;
  if (model) {
    const mesh = createVoxelMesh("prep table", cellsFromAuthoredModel(model), model.pitch, scene,
      options.material ? { material: options.material } : {});
    mesh.parent = root;
    mesh.receiveShadows = true;
    options.shadows?.addShadowCaster(mesh);
    display = createStorageDisplay({ scene, model, node: root, catalog, shadows: options.shadows, maxSize: 0.34 });
  }

  const ingredients: string[] = [];
  let dish: string | null = null;
  let working: { recipe: Recipe; left: number } | null = null;

  const paint = (): void => {
    if (!display) return;
    const stock = stockOf(ingredients);
    display.show([
      // Ingredients keep to the board and the dish to the plate: a salad bowl
      // standing among the vegetables would read as another ingredient.
      ...Object.entries(stock).map(([id, count]) => ({ model: id, count, only: "board" })),
      ...(dish ? [{ model: dish, count: 1, only: "plate" }] : []),
    ]);
  };
  paint();

  return {
    root,
    get ingredients() { return ingredients; },
    get dish() { return dish; },
    get working() { return working; },

    inReach(x, z) {
      const dx = root.position.x - x;
      const dz = root.position.z - z;
      return dx * dx + dz * dz <= PREP_REACH * PREP_REACH;
    },

    put(items) {
      // Only what a recipe here is still SHORT of — see takeForBoard. Taking
      // anything a recipe uses let six lettuces fill the board and lock the
      // carrot and the pepper out of it.
      const taken = takeForBoard(ingredients, items, "prep", BOARD_PLACES);
      ingredients.push(...taken);
      if (taken.length) paint();
      return taken;
    },

    idle() {
      return ingredients.length > 0 && takeForBoard([], ingredients, "prep", ingredients.length).length === 0;
    },

    clear() {
      if (!ingredients.length) return [];
      const returned = [...ingredients];
      ingredients.length = 0;
      paint();
      return returned;
    },

    start() {
      if (working || dish) return null;
      const recipe = readyRecipe(ingredients, "prep");
      if (!recipe) return null;
      consume(recipe, ingredients);
      working = { recipe, left: recipe.seconds };
      paint();
      return recipe;
    },

    take() {
      if (!dish) return null;
      const taken = dish;
      dish = null;
      paint();
      return taken;
    },

    update(dt) {
      if (!working) return;
      working.left -= dt;
      if (working.left > 0) return;
      dish = working.recipe.yields;
      working = null;
      paint();
    },

    state() {
      return {
        ingredients: [...ingredients], dish,
        working: working ? { recipe: working.recipe.id, left: working.left } : null,
      };
    },

    restore(saved) {
      ingredients.length = 0;
      ingredients.push(...saved.ingredients);
      dish = saved.dish;
      const recipe = saved.working ? recipeById(saved.working.recipe) : undefined;
      // A dish left half-made carries on from where it was, rather than
      // restarting or quietly finishing itself while the page was closed.
      working = recipe && saved.working ? { recipe, left: Math.max(0, saved.working.left) } : null;
      paint();
    },

    dispose() {
      display?.dispose();
      root.dispose();
    },
  };
}
