// Honest frame timing.
//
// The number this project has been quoting — `SceneInstrumentation.frameTimeCounter` — does not measure
// the game. Babylon starts that counter on `onBeforeAnimationsObservable` and stops it on
// `onAfterRenderObservable`, and BOTH of those fire inside `scene.render()`. Every simulation call in
// world-main's loop — walking, grass LOD, cutaway, decor clips, particles, day/night — runs BEFORE
// `scene.render()`, so none of it is counted. We could put five hundred swaying plants on the compound,
// watch "ms/frame" sit at 1.0, and conclude that animation is free.
//
// The asymmetry is worse than a simple undercount: the light pool IS inside the bracket (it rides
// `onBeforeRenderObservable`), so the two costs we most want to weigh against each other sit on opposite
// sides of the fence.
//
// So: bracket the simulation half by hand, read Babylon's counter for the render half, and report them
// separately. And report the WALL-CLOCK GAP between frames as well, because that is the only number that
// includes everything — garbage collection, browser work, a rig being meshed mid-frame — and it is what
// the player actually feels. A 400 ms stall is invisible in a mean over a thousand frames, so the gap is
// kept as a distribution (min and p99), not an average.

/** Everything a stress row needs, and everything the HUD shows. */
export interface FrameStats {
  fps: number;
  /** Wall-clock ms between consecutive frames: the honest total, including GC and browser work. */
  gapMs: number;
  /** The best frame in the window. On a vsync-capped display this is the headroom indicator: a 6.8 ms
   *  minimum gap with 1.1 ms of CPU means the cap is the display, not us. */
  minGapMs: number;
  /** The 99th-percentile gap — the stutter. This is the number that catches a rig being built mid-frame. */
  p99GapMs: number;
  /** CPU ms spent in the simulation half of the loop, outside `scene.render()`. */
  simMs: number;
  /** CPU ms inside `scene.render()`, from Babylon's own counter. */
  renderMs: number;
  /** Tasks over 50 ms observed in the window, and the worst of them. Zero on browsers without the API. */
  longTasks: number;
  longestTaskMs: number;
  /** JS heap in MB where the browser will say (Chrome only), else 0. */
  heapMb: number;
  frames: number;
}

export interface FrameTimer {
  /** Top of the render loop. Returns dt in seconds, clamped, so callers need no clock of their own. */
  begin(): number;
  /** Immediately before `scene.render()`. */
  simDone(): void;
  /** Immediately after `scene.render()`. */
  end(): void;
  stats(): FrameStats;
  /** Start a fresh window — between sweep rows, or after a load finishes. */
  reset(): void;
  dispose(): void;
}

/** Gaps are kept in a ring so p99 costs one sort of a bounded array, not a growing one. */
const WINDOW = 600;

export function createFrameTimer(options: {
  /** Babylon's in-render counter. Pass `() => instrumentation.frameTimeCounter.lastSecAverage`. */
  renderMs?: () => number;
  /** Longest dt the game will accept, in seconds. Guards against a tab that was backgrounded. */
  maxDelta?: number;
} = {}): FrameTimer {
  const maxDelta = options.maxDelta ?? 0.05;
  const gaps = new Float64Array(WINDOW);
  const sorted = new Float64Array(WINDOW);
  let gapCount = 0;
  let gapNext = 0;

  let previous = performance.now();
  let simStarted = 0;
  let simTotal = 0;
  let simFrames = 0;
  let simAverage = 0;
  let frames = 0;
  let windowStart = performance.now();
  let fps = 0;
  let lastGap = 0;

  let longTasks = 0;
  let longestTaskMs = 0;
  let observer: PerformanceObserver | null = null;
  // `longtask` is Chrome-only and throws where it is unsupported, which is fine — the counter simply
  // stays at zero rather than the page failing to start.
  try {
    if (typeof PerformanceObserver !== "undefined") {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks++;
          longestTaskMs = Math.max(longestTaskMs, entry.duration);
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    }
  } catch { observer = null; }

  const percentile = (fraction: number): number => {
    if (!gapCount) return 0;
    sorted.set(gaps.subarray(0, gapCount));
    const slice = sorted.subarray(0, gapCount);
    slice.sort();
    return slice[Math.min(gapCount - 1, Math.floor(fraction * gapCount))]!;
  };

  const reset = (): void => {
    gapCount = 0; gapNext = 0;
    simTotal = 0; simFrames = 0; simAverage = 0;
    frames = 0; windowStart = performance.now(); fps = 0; lastGap = 0;
    longTasks = 0; longestTaskMs = 0;
    previous = performance.now();
  };

  return {
    begin() {
      const now = performance.now();
      lastGap = now - previous;
      // The first frame after a load is a gap of seconds and would own the p99 for ever, so anything
      // longer than a second is treated as a discontinuity rather than a frame.
      if (lastGap < 1000) {
        gaps[gapNext] = lastGap;
        gapNext = (gapNext + 1) % WINDOW;
        gapCount = Math.min(gapCount + 1, WINDOW);
      }
      previous = now;
      simStarted = now;
      frames++;
      if (now - windowStart >= 500) {
        fps = (frames * 1000) / (now - windowStart);
        simAverage = simFrames ? simTotal / simFrames : 0;
        frames = 0; windowStart = now; simTotal = 0; simFrames = 0;
      }
      return Math.min(maxDelta, lastGap / 1000);
    },
    simDone() {
      simTotal += performance.now() - simStarted;
      simFrames++;
    },
    end() { /* render time comes from Babylon's own counter; this marks the shape of the loop */ },
    stats() {
      let min = Infinity;
      for (let i = 0; i < gapCount; i++) min = Math.min(min, gaps[i]!);
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return {
        fps,
        gapMs: lastGap,
        minGapMs: gapCount ? min : 0,
        p99GapMs: percentile(0.99),
        simMs: simAverage,
        renderMs: options.renderMs?.() ?? 0,
        longTasks,
        longestTaskMs,
        heapMb: memory ? memory.usedJSHeapSize / (1024 * 1024) : 0,
        frames: gapCount,
      };
    },
    reset,
    dispose() { observer?.disconnect(); observer = null; },
  };
}
