// Deterministic hashing for anything that must look varied but reload identically.
//
// Placed fruit sizes, shelf lean, harvest yields: all of them need to differ
// from their neighbours while staying stable across saves. That is a hash, not
// a random number generator, and it has to AVALANCHE — a one-bit change in the
// input must scramble the whole output.
//
// The first version of this did not. It was FNV over the string followed by a
// single multiply and one xor-shift, and across ten consecutive indices it
// returned values spanning 0.203 to 0.246 — a range of four percent. Yields
// computed as `low + floor(r * span)` therefore returned the same number every
// time, and fruit that was supposed to vary between 85% and 115% of its size
// varied by well under one percent. It looked deliberate and was simply broken.
//
// The finaliser below is murmur3's, which is the cheap standard answer.

/** Mix a 32-bit integer so every input bit affects every output bit. */
function avalanche(value: number): number {
  let h = value | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a over a string, then avalanche. */
export function hashString(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return avalanche(h);
}

/** Deterministic 0..1 from a name, an index and an optional channel.
 *  Different `salt` values give independent streams for the same (name, index),
 *  so size and lean can vary without correlating. */
export function hash01(seed: string, index: number, salt = 0): number {
  return avalanche(Math.imul(hashString(seed, salt) ^ index, 16777619)) / 4294967296;
}

/** An integer in [low, high] inclusive, stable for the same inputs. */
export function hashRange(seed: string, index: number, low: number, high: number, salt = 0): number {
  if (high <= low) return low;
  return low + Math.floor(hash01(seed, index, salt) * (high - low + 1));
}
