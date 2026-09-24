// Scraps in, compost out, with time in between.
//
// The loop this closes is the one that makes a farm-to-table restaurant a
// SYSTEM rather than two systems: the kitchen's waste is the farm's fertility,
// so prepping dishes is what pays for the compost that grows the next crop.
// Nothing here is a fertiliser you buy.
//
// Pure, like the rest of the farm's thinking. Batches are a list rather than one
// timer because a bin the player keeps topping up should not keep resetting the
// clock on what is already rotting down — that is the small unfairness every
// "one timer per container" design ends up with.
export const SCRAPS_ITEM = "item_scraps";
export const COMPOST_ITEM = "item_compost";

/** Scraps needed to start one batch, and what that batch becomes. */
export const SCRAPS_PER_BATCH = 4;
export const COMPOST_PER_BATCH = 2;
/** How long a batch takes. About four in-game days: compost is a slow reward
 *  for a habit, not a crafting click. */
export const COMPOST_SECONDS = 2100;
/** How many batches can rot at once. A bin has a size. */
export const BIN_BATCHES = 6;

export interface Batch { left: number }

export interface Heap {
  /** Scraps tipped in but not yet enough to start a batch. */
  loose: number;
  /** Batches rotting down, each with its seconds remaining. */
  rotting: Batch[];
  /** Finished compost waiting to be taken. */
  ready: number;
}

export function emptyHeap(): Heap {
  return { loose: 0, rotting: [], ready: 0 };
}

/** Tip scraps in. Returns the heap and how many were actually taken — a full bin
 *  refuses the rest rather than swallowing them. */
export function addScraps(heap: Heap, scraps: number): { heap: Heap; taken: number } {
  let loose = heap.loose;
  const rotting = [...heap.rotting];
  let taken = 0;
  for (let n = 0; n < Math.max(0, Math.floor(scraps)); n++) {
    if (rotting.length >= BIN_BATCHES && loose + 1 >= SCRAPS_PER_BATCH) break;
    loose++;
    taken++;
    if (loose >= SCRAPS_PER_BATCH) {
      loose -= SCRAPS_PER_BATCH;
      rotting.push({ left: COMPOST_SECONDS });
    }
  }
  return { heap: { ...heap, loose, rotting }, taken };
}

/** Time passing over the bin. */
export function rot(heap: Heap, dt: number): Heap {
  if (!heap.rotting.length) return heap;
  const rotting: Batch[] = [];
  let ready = heap.ready;
  for (const batch of heap.rotting) {
    const left = batch.left - Math.max(0, dt);
    if (left > 0) rotting.push({ left });
    else ready += COMPOST_PER_BATCH;
  }
  return { ...heap, rotting, ready };
}

/** Take what is finished. */
export function takeCompost(heap: Heap, wanted = Infinity): { heap: Heap; taken: number } {
  const taken = Math.max(0, Math.min(heap.ready, Math.floor(wanted)));
  if (!taken) return { heap, taken: 0 };
  return { heap: { ...heap, ready: heap.ready - taken }, taken };
}

/** 0..1 — how full the bin looks, which is what its heap is scaled by. */
export function fullness(heap: Heap): number {
  const inside = heap.loose / SCRAPS_PER_BATCH + heap.rotting.length + heap.ready / COMPOST_PER_BATCH;
  return Math.max(0, Math.min(1, inside / (BIN_BATCHES + 1)));
}

/** Seconds until the next batch is done, or null when nothing is rotting. */
export function nextReadyIn(heap: Heap): number | null {
  if (!heap.rotting.length) return null;
  return Math.min(...heap.rotting.map((batch) => batch.left));
}

/** A line for the HUD when the player is standing at the bin. */
export function describeHeap(heap: Heap): string {
  const parts: string[] = [];
  if (heap.ready) parts.push(`${heap.ready} compost ready`);
  if (heap.rotting.length) {
    const next = nextReadyIn(heap) ?? 0;
    parts.push(`${heap.rotting.length} rotting (next in ${Math.ceil(next)}s)`);
  }
  if (heap.loose) parts.push(`${heap.loose}/${SCRAPS_PER_BATCH} scraps`);
  return parts.length ? parts.join(" · ") : "empty";
}
