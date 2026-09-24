// What the kitchen can make out of what the farm grows.
//
// Pure, like crops.ts and farm.ts. A recipe names catalog ids on both sides —
// real produce in, a real dish out — so a recipe that cannot be shown cannot be
// added by accident: `validateRecipes` checks both ends against the catalog.
//
// The rulebook's limit is two physical transformations from crop to served dish,
// and it is enforced here by there being nowhere else to put one: a recipe takes
// produce and gives a dish. Intermediate "chopped carrot" items are exactly the
// invisible inventory bloat that rule exists to prevent.
import { countItem } from "./inventory.ts";

/** Where the work happens. Stations are physical places in the world, so this
 *  is also which counter the player has to be standing at. */
export type Station = "prep" | "stove";

export interface Recipe {
  id: string;
  name: string;
  station: Station;
  /** Catalog item id → how many. */
  needs: Readonly<Record<string, number>>;
  /** Catalog id of the dish that comes out. */
  yields: string;
  /** How long the work takes, in game seconds. */
  seconds: number;
  /** What it sells for, before reputation and the rest of the economy exist. */
  price: number;
}

export const recipes: readonly Recipe[] = [
  {
    id: "garden_salad", name: "Garden Salad", station: "prep",
    // The first dish the farm can actually supply: one of each of the three
    // crops a starting plot grows fastest.
    needs: { item_lettuce: 1, item_carrot: 1, item_pepper_red: 1 },
    yields: "dish_garden_salad", seconds: 9, price: 14,
  },
];

const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
export function recipeById(id: string): Recipe | undefined { return byId.get(id); }

/** What a pile of items holds, as counts. */
export function stockOf(items: readonly string[]): Record<string, number> {
  const stock: Record<string, number> = {};
  for (const item of items) stock[item] = (stock[item] ?? 0) + 1;
  return stock;
}

/** What is still missing before this recipe can be made — empty when it can. */
export function missingFor(recipe: Recipe, items: readonly string[]): Record<string, number> {
  const missing: Record<string, number> = {};
  for (const [id, needed] of Object.entries(recipe.needs)) {
    const short = needed - countItem(items, id);
    if (short > 0) missing[id] = short;
  }
  return missing;
}

export function canMake(recipe: Recipe, items: readonly string[]): boolean {
  return Object.keys(missingFor(recipe, items)).length === 0;
}

/** The recipe this station could start right now, or null. Ties go to the
 *  earlier recipe, so a station never flickers between two it could make. */
export function readyRecipe(items: readonly string[], station: Station): Recipe | null {
  return recipes.find((recipe) => recipe.station === station && canMake(recipe, items)) ?? null;
}

/** Take a recipe's ingredients out of the pile, in place. Returns what was taken
 *  so a cancelled dish can put them back. */
export function consume(recipe: Recipe, items: string[]): string[] {
  const taken: string[] = [];
  for (const [id, needed] of Object.entries(recipe.needs)) {
    for (let n = 0; n < needed; n++) {
      const at = items.lastIndexOf(id);
      if (at < 0) break;
      items.splice(at, 1);
      taken.push(id);
    }
  }
  return taken;
}

/** Problems with the recipe table, given the ids the catalog actually has. */
export function validateRecipes(catalogIds: Iterable<string>): string[] {
  const known = new Set(catalogIds);
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const recipe of recipes) {
    if (seen.has(recipe.id)) errors.push(`${recipe.id}: duplicate recipe id`);
    seen.add(recipe.id);
    if (!known.has(recipe.yields)) errors.push(`${recipe.id}: dish "${recipe.yields}" is not in the catalog`);
    if (!Object.keys(recipe.needs).length) errors.push(`${recipe.id}: needs no ingredients`);
    for (const [id, count] of Object.entries(recipe.needs)) {
      if (!known.has(id)) errors.push(`${recipe.id}: ingredient "${id}" is not in the catalog`);
      if (!Number.isInteger(count) || count < 1) errors.push(`${recipe.id}: ingredient "${id}" asks for ${count}`);
    }
    if (recipe.seconds <= 0) errors.push(`${recipe.id}: takes no time at all`);
    if (recipe.price <= 0) errors.push(`${recipe.id}: is given away`);
  }
  return errors;
}
