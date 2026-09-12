// Loading and baking: the work that happens before a scene can be played.
//
// A progress bar is only honest if the work yields. One synchronous twelve-second build paints nothing:
// the bar sits at zero, the tab locks, and it jumps to a hundred at the end — which is worse than no bar,
// because it looks broken. So a stage here is asked to do its work in SLICES, handing control back between
// them, and the bar moves because the browser actually gets a chance to draw it.
//
// It is built as a list of weighted stages rather than one task because that is what is coming: meshing
// the level is the first, and navigation meshes, baked light, prop geometry and cached surfaces are the
// same shape of problem. A stage says roughly how expensive it is, reports its own fraction, and the
// loader turns the lot into one number.

/** A unit of loading work. `report` moves this stage's own 0..1; `slice` hands the frame back. */
export interface LoadingStage {
  name: string;
  /** Rough share of the whole, relative to the other stages. Defaults to 1. */
  weight?: number;
  run(context: { report: (fraction: number) => void; slice: () => Promise<void> }): Promise<void> | void;
}

export interface LoadingProgress {
  /** 0..1 across every stage, weighted. */
  fraction: number;
  stage: string;
  /** Which stage of how many, 1-based, for "3 of 5". */
  index: number;
  total: number;
}

/** Hand the frame back so the browser can paint. Two frames, because one only queues the paint. */
export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Run stages in order, reporting one weighted number. Returns how long the whole thing took. */
export async function runStages(stages: readonly LoadingStage[], onProgress: (progress: LoadingProgress) => void): Promise<number> {
  const started = performance.now();
  const total = stages.reduce((sum, stage) => sum + (stage.weight ?? 1), 0) || 1;
  let done = 0;
  for (const [index, stage] of stages.entries()) {
    const weight = stage.weight ?? 1;
    const report = (fraction: number): void => {
      onProgress({
        fraction: Math.min(1, (done + weight * Math.min(1, Math.max(0, fraction))) / total),
        stage: stage.name, index: index + 1, total: stages.length,
      });
    };
    report(0);
    await nextFrame();            // let the stage's name appear before it starts working
    await stage.run({ report, slice: nextFrame });
    done += weight;
    report(1);
  }
  return performance.now() - started;
}

/** Run `items` through `work`, yielding every `budgetMs` so the bar keeps moving. */
export async function sliceWork<T>(
  items: readonly T[], work: (item: T, index: number) => void,
  context: { report: (fraction: number) => void; slice: () => Promise<void> },
  budgetMs = 24,
): Promise<void> {
  let since = performance.now();
  for (const [index, item] of items.entries()) {
    work(item, index);
    // Yield on a time budget rather than a fixed count: level pieces differ enormously in size, and a
    // count would either stall on the big ones or yield pointlessly on the small ones.
    if (performance.now() - since >= budgetMs) {
      context.report((index + 1) / items.length);
      await context.slice();
      since = performance.now();
    }
  }
  context.report(1);
}
