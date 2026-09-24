import test from "node:test";
import assert from "node:assert/strict";
import {
  CROP_STAGES, cropById, cropDefinitions, fruitProgress, harvest, harvestsLeft,
  isReady, isSpent, plant, stageOf, validateCrops, yieldOf,
} from "./crops.ts";
import idx from "../assets/catalog/index.json" with { type: "json" };

const lettuce = cropById("lettuce")!;      // whole plant, one harvest
const strawberry = cropById("strawberry")!; // perennial, picked
const pepper = cropById("pepper")!;         // picked, four harvests then spent

test("every stage model a crop names actually exists in the catalog", () => {
  const { errors, gaps } = validateCrops(Object.keys((idx as { models: Record<string, unknown> }).models));
  assert.deepEqual(errors, [], "a crop points at a model that is not there");
  // Every crop now has both forms — the staged plant and the harvested item —
  // which is what the rulebook asks of anything growable, since buying is the
  // expensive alternative to growing and both need something to show.
  assert.deepEqual(gaps, [], "a crop has no produce item authored");
});

test("stages follow the plant, and the boundaries land where they should", () => {
  const sown = plant(lettuce, 1000);
  const at = (t: number) => stageOf(lettuce, sown, 1000 + t * lettuce.growthSeconds);
  assert.equal(at(0), "seedling");
  assert.equal(at(0.29), "seedling");
  assert.equal(at(0.31), "growing");
  assert.equal(at(0.99), "growing");
  assert.equal(at(1), "ripe", "it must be ripe exactly when growth completes, not a tick later");
  assert.equal(at(4), "ripe", "and stay ripe");
});

test("a picked bush is still a full-grown bush", () => {
  // The plant's maturity and the fruit's are different things: harvesting a
  // pepper must not send the model back to a seedling.
  const sown = plant(pepper, 0);
  const ripe = pepper.growthSeconds;
  const after = harvest(pepper, sown, ripe, "plot_a").planted!;
  assert.equal(stageOf(pepper, after, ripe + 1), "ripe");
  assert.ok(fruitProgress(pepper, after, ripe + 1) < 0.05, "but it carries essentially no fruit yet");
  assert.equal(fruitProgress(pepper, after, ripe), 0, "and none at all the instant it was picked");
});

test("fruit regrows over the regrow window, not the growth window", () => {
  const sown = plant(strawberry, 0);
  const ripe = strawberry.growthSeconds;
  assert.equal(fruitProgress(strawberry, sown, ripe), 1);

  const after = harvest(strawberry, sown, ripe, "plot_a").planted!;
  const half = ripe + strawberry.regrowSeconds / 2;
  assert.ok(Math.abs(fruitProgress(strawberry, after, half) - 0.5) < 1e-6,
    "halfway through the REGROW window should read as half, not as a fraction of growthSeconds");
  assert.equal(fruitProgress(strawberry, after, ripe + strawberry.regrowSeconds), 1);
});

test("a whole-plant crop is taken once and leaves bare soil", () => {
  const sown = plant(lettuce, 0);
  const result = harvest(lettuce, sown, lettuce.growthSeconds, "plot_a");
  assert.equal(result.planted, null, "the lettuce came out of the ground");
  assert.equal(result.spent, true);
  assert.equal(result.items, 1);
});

test("a perennial is never used up, however many times it is picked", () => {
  // The trap this guards: harvests remaining used to COUNT DOWN, and a
  // perennial has Infinity of them — `Infinity - 1 === Infinity`, so the
  // counter never moved and the plant looked permanently unpicked.
  let state = plant(strawberry, 0);
  let clock = strawberry.growthSeconds;
  for (let pick = 0; pick < 25; pick++) {
    assert.ok(isReady(strawberry, state, clock), `pick ${pick} should be ready`);
    const result = harvest(strawberry, state, clock, "plot_a");
    assert.ok(result.items >= 4 && result.items <= 8);
    assert.equal(result.spent, false, "a strawberry plant is never spent");
    state = result.planted!;
    assert.equal(state.harvested, pick + 1, "the harvest counter has to actually move");
    clock += strawberry.regrowSeconds;
  }
  assert.equal(harvestsLeft(strawberry, state), Infinity);
  assert.equal(isSpent(strawberry, state), false);
});

test("a bush with a fixed number of flushes runs out and then leaves soil", () => {
  let state = plant(pepper, 0);
  let clock = pepper.growthSeconds;
  for (let pick = 1; pick <= pepper.harvests; pick++) {
    const result = harvest(pepper, state, clock, "plot_b");
    assert.ok(result.items >= 3 && result.items <= 10);
    if (pick < pepper.harvests) {
      assert.equal(result.spent, false, `pick ${pick} of ${pepper.harvests} should leave the bush standing`);
      state = result.planted!;
      clock += pepper.regrowSeconds;
    } else {
      assert.equal(result.spent, true, "the last flush uses the bush up");
      assert.equal(result.planted, null);
    }
  }
});

test("harvesting early gives nothing and changes nothing", () => {
  const sown = plant(pepper, 0);
  const early = harvest(pepper, sown, pepper.growthSeconds - 1, "plot_a");
  assert.equal(early.items, 0);
  assert.equal(early.spent, false);
  assert.deepEqual(early.planted, sown, "an early grab must not consume a harvest");
});

test("yield is stable across reloads but differs between plots", () => {
  // A player must not be able to reload to reroll a poor harvest.
  const a = Array.from({ length: 6 }, (_, i) => yieldOf(pepper, "plot_a", i));
  const again = Array.from({ length: 6 }, (_, i) => yieldOf(pepper, "plot_a", i));
  assert.deepEqual(again, a, "the same plot picked the same number of times must give the same amount");

  const b = Array.from({ length: 6 }, (_, i) => yieldOf(pepper, "plot_b", i));
  assert.notDeepEqual(b, a, "different plots should not march in lockstep");

  for (const n of [...a, ...b]) assert.ok(n >= 3 && n <= 10 && Number.isInteger(n));
  assert.ok(new Set(a).size > 1, "a range of 3..10 that always returns one number is not a range");
});

test("visible fruit sites are never confused with awarded items", () => {
  // These are different numbers on purpose; reading one as the other is the
  // mistake this whole separation exists to prevent.
  for (const crop of cropDefinitions) {
    const [low, high] = crop.yield;
    assert.ok(crop.sites >= 1, `${crop.id} has no fruit sites`);
    assert.ok(low >= 1 && high >= low, `${crop.id} has a broken yield range`);
    if (crop.wholePlant) {
      assert.equal(crop.sites, 1, `${crop.id} is pulled up whole, so it shows one thing`);
    }
  }
  // The pepper is the case that proves they are independent.
  assert.equal(pepper.sites, 10);
  assert.deepEqual([...pepper.yield], [3, 10]);
  assert.notEqual(pepper.sites, pepper.yield[0]);
});

test("the crop table catches its own mistakes", () => {
  const known = new Set(["a_seedling", "a_growing", "a_ripe"]);
  const { errors } = validateCrops(known);
  assert.ok(errors.length > 0, "the real table's models are absent from this fake catalog, so it must complain");
  assert.ok(errors.some((e) => e.includes("is not in the catalog")));
});

test("stage names and the stage map agree", () => {
  for (const crop of cropDefinitions) {
    assert.deepEqual(Object.keys(crop.stages).sort(), [...CROP_STAGES].sort(), `${crop.id} stage map`);
  }
});
