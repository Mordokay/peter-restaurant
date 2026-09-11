import test from "node:test";
import assert from "node:assert/strict";
import { hourForShift, lightingAt, sunDirectionAt } from "./dayNight.ts";

test("noon is bright, night is dark and lamp-lit, and the look interpolates smoothly", () => {
  const noon = lightingAt(12), night = lightingAt(2), dusk = lightingAt(20);
  assert.ok(noon.sunIntensity > 1.5 && night.sunIntensity < 0.2);
  assert.ok(noon.lamps < 0.3 && night.lamps === 1, "lamps matter at night, barely at noon");
  assert.ok(night.glow > noon.glow);
  assert.ok(dusk.sunIntensity < noon.sunIntensity && dusk.sunIntensity > night.sunIntensity);
  assert.equal(lightingAt(8).sky, "#a9c889", "8:00 keeps the game's original sky");
  let previous = lightingAt(5).sunIntensity;
  for (let h = 5; h <= 12; h += 0.25) { const next = lightingAt(h).sunIntensity; assert.ok(next >= previous - 1e-9, `sun should not dim while rising (${h})`); previous = next; }
  assert.deepEqual(lightingAt(25), lightingAt(1), "hours wrap");
});

test("the sun rises in the east, stands high at noon and never drops below the horizon", () => {
  for (const h of [0, 6, 9, 12, 15, 18, 21]) { const d = sunDirectionAt(h); assert.ok(d.y < -0.2, `light points down at ${h}`); assert.ok(Math.abs(d.length() - 1) < 1e-6); }
  assert.ok(sunDirectionAt(12).y < sunDirectionAt(7).y, "steeper at noon than in the morning");
  assert.ok(Math.sign(sunDirectionAt(7).x) !== Math.sign(sunDirectionAt(17).x), "morning and afternoon light come from opposite sides");
});

test("the shift maps onto the clock", () => {
  assert.equal(hourForShift("prep", 0, 0), 7);
  assert.equal(hourForShift("prep", 1, 240), 10);
  assert.equal(hourForShift("choose_menu", 0, 0), 10);
  assert.equal(hourForShift("choose_menu", 0, 900), 11);
  assert.equal(hourForShift("dinner", 0, 0), 17.5);
  assert.equal(hourForShift("dinner", 1, 270), 22);
  assert.equal(hourForShift("close", 0, 600), 23.5);
});
