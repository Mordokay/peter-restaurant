import test from "node:test";
import assert from "node:assert/strict";
import idx from "../assets/catalog/index.json" with { type: "json" };
import { canMake, consume, missingFor, readyRecipe, recipeById, recipes, stockOf, surplusOnBoard, takeForBoard, validateRecipes } from "./recipes.ts";

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

test("a counter takes what it is short of, not the first thing in the basket", () => {
  // The bug this exists for: a player who harvested lettuce first arrives with
  // six of them in front of the carrot and the pepper. Taking "anything a
  // recipe uses" filled all six places with lettuce, and the salad could then
  // never be made because there was nowhere to put the other two.
  const carried = ["item_lettuce", "item_lettuce", "item_lettuce", "item_lettuce", "item_lettuce",
                   "item_lettuce", "item_carrot", "item_pepper_red", "item_strawberry"];
  const taken = takeForBoard([], carried, "prep", 6);
  assert.deepEqual(taken, ["item_lettuce", "item_carrot", "item_pepper_red"]);
  assert.ok(canMake(salad, taken), "one trip to the counter is enough to start the dish");

  // Nothing it is not short of: a second armful of the same adds nothing.
  assert.deepEqual(takeForBoard(taken, carried, "prep", 6), []);
  // And nothing it can never use, however much of it you are carrying.
  assert.deepEqual(takeForBoard([], ["item_strawberry", "item_cabbage"], "prep", 6), []);
});

test("a counter takes carry order, and never more than it has places for", () => {
  const carried = ["item_carrot", "item_lettuce", "item_pepper_red"];
  assert.deepEqual(takeForBoard([], carried, "prep", 6), carried, "first picked up, first put down");
  assert.deepEqual(takeForBoard([], carried, "prep", 2), ["item_carrot", "item_lettuce"]);
  assert.deepEqual(takeForBoard(["item_carrot", "item_lettuce"], carried, "prep", 2), [],
    "a full board takes nothing, even something it wants");
});

test("a board full of the wrong thing hands back its surplus, not its whole self", () => {
  // The jam: an older build filled the board with six lettuces, so the carrot
  // and the pepper could never be put down and the dish could never start —
  // while the bar said it was ready to make one.
  const jammed = Array.from({ length: 6 }, () => "item_lettuce");
  const surplus = surplusOnBoard(jammed, "prep");
  assert.equal(surplus.length, 5, "one lettuce is wanted; the other five are in the way");
  assert.deepEqual([...new Set(surplus)], ["item_lettuce"]);

  // A board holding exactly what the recipe wants gives nothing back.
  assert.deepEqual(surplusOnBoard(["item_lettuce", "item_carrot", "item_pepper_red"], "prep"), []);
  // And something this counter can never use is all surplus.
  assert.deepEqual(surplusOnBoard(["item_strawberry", "item_cabbage"], "prep"), ["item_strawberry", "item_cabbage"]);
});
