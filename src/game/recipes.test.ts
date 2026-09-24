import test from "node:test";
import assert from "node:assert/strict";
import idx from "../assets/catalog/index.json" with { type: "json" };
import { canMake, consume, missingFor, readyRecipe, recipeById, recipes, stockOf, validateRecipes } from "./recipes.ts";

const salad = recipeById("garden_salad")!;

test("every recipe names produce and a dish the catalog actually has", () => {
  assert.deepEqual(validateRecipes(Object.keys((idx as { models: Record<string, unknown> }).models)), []);
});

test("a recipe knows exactly what it is still short of", () => {
  assert.deepEqual(missingFor(salad, []), { item_lettuce: 1, item_carrot: 1, item_pepper_red: 1 });
  assert.deepEqual(missingFor(salad, ["item_lettuce", "item_carrot"]), { item_pepper_red: 1 });
  assert.deepEqual(missingFor(salad, ["item_lettuce", "item_carrot", "item_pepper_red"]), {});
  assert.ok(canMake(salad, ["item_lettuce", "item_carrot", "item_pepper_red", "item_strawberry"]));
  assert.ok(!canMake(salad, ["item_lettuce", "item_lettuce", "item_lettuce"]),
    "three lettuces are not a salad; the recipe wants one of each");
});

test("a station only offers what it can make, at its own counter", () => {
  const full = ["item_lettuce", "item_carrot", "item_pepper_red"];
  assert.equal(readyRecipe(full, "prep")?.id, "garden_salad");
  assert.equal(readyRecipe(full, "stove"), null, "the salad is prep work, not cooking");
  assert.equal(readyRecipe(["item_lettuce"], "prep"), null);
});

test("making a dish takes only its ingredients, and leaves the rest alone", () => {
  const basket = ["item_strawberry", "item_lettuce", "item_carrot", "item_carrot", "item_pepper_red", "item_strawberry"];
  const taken = consume(salad, basket);
  assert.deepEqual(taken.sort(), ["item_carrot", "item_lettuce", "item_pepper_red"]);
  assert.deepEqual(stockOf(basket), { item_strawberry: 2, item_carrot: 1 });
});

test("the recipe table stays inside the rulebook's limits", () => {
  for (const recipe of recipes) {
    // Two physical transformations from crop to served dish: a recipe turns
    // produce straight into a dish, and there is nowhere to hide a third step.
    for (const id of Object.keys(recipe.needs)) {
      assert.ok(id.startsWith("item_"), `${recipe.id} takes produce, not a half-made thing (${id})`);
    }
    assert.ok(recipe.yields.startsWith("dish_"), `${recipe.id} makes a dish`);
    assert.ok(recipe.seconds <= 30, `${recipe.id} fits inside a dinner service`);
  }
});
