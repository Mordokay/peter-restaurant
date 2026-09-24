import test from "node:test";
import assert from "node:assert/strict";
import { rigStateCacheKey, sourceCacheKey, staleSourceKeys } from "./sourceCache.ts";

test("warming a source preserves rig states and LOD siblings at the same revision", () => {
  const source = sourceCacheKey("plant", 2, 0.02);
  const part = rigStateCacheKey("plant", 2, "leaf", "base");
  const sibling = sourceCacheKey("plant", 2, 0.04);
  const other = rigStateCacheKey("freezer", 1, "door", "open");
  const stale = rigStateCacheKey("plant", 1, "leaf", "base");
  const keys = [source, part, sibling, other, stale, "level-floor", "grass-buffer"];
  assert.deepEqual(staleSourceKeys(keys, [source]), [stale]);
  assert.deepEqual(staleSourceKeys(keys, [part]), [stale]);
  assert.deepEqual(staleSourceKeys(keys, ["level-floor"]), []);
});

test("cache eviction respects all requested revisions and separates part/state names", () => {
  const a = sourceCacheKey("plant", 1, 0.02), b = sourceCacheKey("plant", 2, 0.02);
  assert.deepEqual(staleSourceKeys([a, b], [a, b]), []);
  assert.notEqual(rigStateCacheKey("plant", 1, "a|state:b", "c"), rigStateCacheKey("plant", 1, "a", "b|state:c"));
});
