import test from "node:test";
import assert from "node:assert/strict";
import { advance, cropById, harvest, isReady, plant, stageOf } from "./crops.ts";
import {
  COMPOST_GROWTH, MULCH_WATER_BONUS, WATER_SECONDS, bareSoil, describeSoil, dry, fertilise,
  growthRate, isWet, lookOf, till, waterSoil, yieldBonus,
} from "./soil.ts";
import { actionOf, hotbar, tools } from "./tools.ts";

const lettuce = cropById("lettuce")!;

test("ground has to be broken, watered, and stays that way for a while", () => {
  let soil = bareSoil();
  assert.equal(soil.tilled, false);
  assert.equal(growthRate(soil), 0);
  assert.equal(describeSoil(soil), "unbroken ground");

  soil = till(soil);
  assert.equal(lookOf(soil), "tilled");
  assert.equal(growthRate(soil), 0, "broken ground is still dry ground");

  soil = waterSoil(soil);
  assert.equal(soil.wet, WATER_SECONDS);
  assert.equal(growthRate(soil), 1);
  assert.equal(lookOf(soil), "wet");

  soil = dry(soil, WATER_SECONDS - 1);
  assert.ok(isWet(soil), "a second of water is still water");
  soil = dry(soil, 5);
  assert.equal(soil.wet, 0);
  assert.equal(growthRate(soil), 0, "and then it stops growing entirely");
});

test("compost speeds growth and improves a picking; mulch holds water", () => {
  const composted = waterSoil(fertilise(till(bareSoil()), "compost"));
  assert.equal(growthRate(composted), COMPOST_GROWTH);
  assert.ok(yieldBonus(composted) > 0);
  assert.equal(lookOf(composted), "fedwet");

  const mulched = waterSoil(fertilise(till(bareSoil()), "mulch"));
  assert.equal(mulched.wet, WATER_SECONDS * MULCH_WATER_BONUS);
  assert.equal(growthRate(mulched), 1, "mulch is about water, not speed");
  assert.equal(yieldBonus(mulched), 0);

  // Tilling a bed over loses what was dug into it.
  assert.equal(till(composted).fertiliser, "none");
});

test("a plant banks watered time only, so a forgotten plot does not grow", () => {
  let crop = plant(lettuce);
  crop = advance(lettuce, crop, 30, 0);                 // dry
  assert.equal(crop.grown, 0);
  assert.equal(stageOf(lettuce, crop), "seedling");

  crop = advance(lettuce, crop, lettuce.growthSeconds, 1);
  assert.ok(isReady(lettuce, crop), "watered all the way through, it is ready");

  // Compost gets there on less real time, and never banks more than the plant
  // can use.
  let fed = plant(lettuce);
  fed = advance(lettuce, fed, lettuce.growthSeconds / COMPOST_GROWTH, COMPOST_GROWTH);
  assert.ok(isReady(lettuce, fed));
  fed = advance(lettuce, fed, 10_000, COMPOST_GROWTH);
  assert.equal(fed.grown, lettuce.growthSeconds, "surplus growth is not banked for the next crop");
});

test("a better picking is a second roll, never a bigger range", () => {
  const pepper = cropById("pepper")!;
  const [low, high] = pepper.yield;
  for (let index = 0; index < 40; index++) {
    const fed = harvest(pepper, { crop: "pepper", grown: pepper.growthSeconds, regrown: pepper.regrowSeconds, harvested: index % 3 }, `plot${index}`, 0.5);
    assert.ok(fed.items >= low && fed.items <= high, `${fed.items} stays inside ${low}..${high}`);
  }
});

test("what the key does depends on the tool, the soil and the plant", () => {
  const hoe = { kind: "tool", tool: "hoe" } as const;
  const can = { kind: "tool", tool: "can" } as const;
  const compost = { kind: "tool", tool: "compost" } as const;
  const seed = { kind: "seed", crop: "lettuce" } as const;
  let soil = bareSoil();

  assert.equal(actionOf(hoe, soil, null), "till");
  assert.equal(actionOf(seed, soil, null), "nothing", "seed needs broken ground");
  assert.equal(actionOf(can, soil, null), "nothing");

  soil = till(soil);
  assert.equal(actionOf(hoe, soil, null), "nothing", "a hoe does not stir a finished bed");
  assert.equal(actionOf(seed, soil, null), "sow");
  assert.equal(actionOf(can, soil, null), "water");
  assert.equal(actionOf(compost, soil, null), "feed");

  soil = waterSoil(soil);
  assert.equal(actionOf(can, soil, null), "nothing", "watering twice does nothing");

  // With something growing: water and feed still work, seeds do not, and a ripe
  // plant is picked whatever is in hand.
  const young = plant(lettuce);
  assert.equal(actionOf(seed, soil, young), "nothing");
  assert.equal(actionOf(can, soil, young), "nothing");
  assert.equal(actionOf(can, dry(soil, 10_000), young), "water");
  assert.equal(actionOf(compost, soil, young), "feed");
  const ripe = advance(lettuce, young, lettuce.growthSeconds, 1);
  for (const slot of [hoe, can, compost, seed]) assert.equal(actionOf(slot, soil, ripe), "harvest");
});

test("the hotbar puts the tools first and never reshuffles", () => {
  const bar = hotbar([{ id: "lettuce" }, { id: "carrot" }]);
  assert.deepEqual(bar.map((slot) => (slot.kind === "tool" ? slot.tool : slot.crop)),
    [...tools.map((tool) => tool.id), "lettuce", "carrot"]);
});
