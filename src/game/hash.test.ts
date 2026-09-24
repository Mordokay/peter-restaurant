import test from "node:test";
import assert from "node:assert/strict";
import { hash01, hashRange, hashString } from "./hash.ts";

test("consecutive indices spread across the whole range", () => {
  // The bug this exists to prevent: the previous hash returned 0.203..0.246
  // across ten indices, so every derived yield and size collapsed to one value.
  const values = Array.from({ length: 64 }, (_, i) => hash01("plot_a", i));
  const min = Math.min(...values), max = Math.max(...values);
  assert.ok(max - min > 0.9, `64 samples spanned only ${(max - min).toFixed(3)} of 0..1`);
  const buckets = new Set(values.map((v) => Math.floor(v * 8)));
  assert.equal(buckets.size, 8, "every eighth of the range should be reachable");
});

test("it is a hash, not a generator: same inputs, same answer", () => {
  assert.equal(hash01("bed_1", 3), hash01("bed_1", 3));
  assert.equal(hashString("bed_1"), hashString("bed_1"));
  assert.notEqual(hash01("bed_1", 3), hash01("bed_2", 3));
  assert.notEqual(hash01("bed_1", 3), hash01("bed_1", 4));
});

test("salts give independent streams, so size and lean do not correlate", () => {
  const size = Array.from({ length: 32 }, (_, i) => hash01("plot", i, 1));
  const lean = Array.from({ length: 32 }, (_, i) => hash01("plot", i, 2));
  assert.notDeepEqual(size, lean);
  // Correlation should be near zero; anything strong means the salt is cosmetic.
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const [ms, ml] = [mean(size), mean(lean)];
  const cov = size.reduce((s, x, i) => s + (x - ms) * (lean[i]! - ml), 0) / size.length;
  const sd = (xs: number[], m: number) => Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
  const r = cov / (sd(size, ms) * sd(lean, ml));
  assert.ok(Math.abs(r) < 0.4, `size and lean correlate at r=${r.toFixed(2)}`);
});

test("a range actually uses its range", () => {
  const rolls = Array.from({ length: 200 }, (_, i) => hashRange("plot_a", i, 3, 10));
  for (const n of rolls) assert.ok(Number.isInteger(n) && n >= 3 && n <= 10);
  assert.equal(new Set(rolls).size, 8, "all eight outcomes of 3..10 should occur");
  assert.equal(hashRange("x", 0, 5, 5), 5, "a degenerate range is its own answer");
  assert.equal(hashRange("x", 0, 7, 2), 7, "an inverted range does not explode");
});
