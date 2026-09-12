# Performance ledger

Every claim here is a measurement with the method beside it. Predictions are labelled as predictions.

Machine: darwin 27.0.0. Meshing figures are from `NullEngine` under `node --test`, which has no GPU and
so measures the CPU cost honestly; frame figures come from a real GPU in Chrome (never swiftshader — see
"How not to measure this" below).

---

## Phase 0 — instrument corrections

### The CPU number we were quoting did not include the game

`SceneInstrumentation.frameTimeCounter` starts on `onBeforeAnimationsObservable` and ends on
`onAfterRenderObservable` (`sceneInstrumentation.js:410,442`) — both **inside** `scene.render()`. Every
simulation call in `world-main.ts`'s loop (`walk`, `grass.update`, `cutaway.update`, `decor.update`,
`particles.update`, `dayNight.update`) runs **before** `scene.render()`, so none of it was counted.

The previously reported "~1 ms CPU/frame" for the compound therefore measured the render half only.
`createFrameTimer` (`src/game/frameTimer.ts`) now brackets the simulation half by hand and reports
**sim ms and render ms separately**, plus the wall-clock gap distribution (min / p99), long tasks and heap.

| what | before | after |
|---|---|---|
| simulation cost | invisible | measured, reported separately |
| stutter | hidden in a mean | p99 gap + `longtask` count |
| headroom on a vsync-capped display | unreadable from fps | `minGapMs` |

### One lamp cost a full extra scene pass

`attachGlow` keeps the GlowLayer disabled because a layer with **no include list falls back to every
active mesh** — measured previously on the compound at **83 draw calls and 333,000 triangles a frame**.
But `tagGlow` switched the layer on for the whole scene the moment anything bloomed, and never set an
include list. `stress-main.ts` makes every twelfth prop a lamp, so the stress page has been paying this
the entire time.

Fixed: `tagGlow` now calls `addIncludedOnlyMesh`, confining the pass to meshes that actually glow, and
`removeIncludedOnlyMesh` on dispose. Locked by `lighting.test.ts`.

### The light pool re-sorted every registered lamp, every frame

`createLightPool.assign` allocated one object per registered light and **full-sorted** them on every
frame, plus a `Color3.FromHexString` per pool light. The cost scaled with prop count, so a density sweep
would have read one bad line as "props are expensive".

Fixed: bounded insertion for the nearest `max` (6) with no allocation, colour parsed once at `register()`,
and the whole ranking skipped unless the camera moved past 25 cm or the light set changed. `stats()` now
reports `assignMs` and a `ranks` counter — `ranks` stays flat while the camera is still, however many
lamps are registered. Locked by `lighting.test.ts`.

### Particle pools were dropping spawns silently, and unevenly

`spawn()` popped from a free list and, when it came back empty, simply stopped — so a saturated scene
measured as *cheap* because it emitted less than it was asked for, and nothing said so.

Worse, the split is asymmetric and backwards for this game. **Measured** (`voxelParticles.test.ts`): with
`capacity: 1000`, the first pool created gets **1000** and every later one gets **500**. The first pool is
always the opaque cube pool, so translucent effects — steam over a pot, cold air off a freezer, the things
a kitchen actually has — draw on the *smaller* share.

Fixed: per-pool `capacity` and `dropped` counters; `stats()` returns the breakdown, and its single
`capacity` figure is documented as a sum no individual emitter can reach.

### Renderer stats re-derived the LOD tier instead of reading it

`worldRenderer.stats()` computed distance from `getAbsolutePosition()` — the instance **origin** — while
Babylon's `InstancedMesh.getLOD` decides from the bounding **sphere centre**, misclassifying a shell of
props either side of the boundary. It also charged full triangles to instances past `cullDistance`, which
draw nothing, and allocated two `Vector3` per active mesh per call (~48,000/s at 12,000 props, purely to
draw a line of HUD text).

Fixed: reads `_currentLOD` — ground truth — handles the culled (`null`) case, adds `coarseInstances`, and
allocates nothing.

---

## Phase 0 baseline — measured on the real GPU

Apple M5 (ANGLE Metal), 1920×848 at scaling 1, Chrome in an isolated context against the dev server on
port 5199. `gl` asserted to contain no "SwiftShader".

### Stress grid, 3,000 props of 60 models

| | cold cache | warm cache |
|---|---|---|
| source build | **22,288 ms** | **393 ms** |
| longest single task | **22,427 ms** | 392 ms |
| JS heap | **2,099 MB** | 455 MB |
| cached sources | 0 / 62 | 62 / 62 |
| render ms | 4.81 | 4.68 |
| draw calls | 74 | 74 |

The source cache is worth **57×** on this scene and it already exists. The 22.4 s cold build shows up as a
single `longtask`, which is exactly the kind of stall a mean frame time cannot see — and the reason the
`longtask` observer is now wired in.

Display is 60 Hz here (`minGapMs` 14.6), and render costs 4.4-4.8 ms of a 16.7 ms budget, so fps alone
would report "fine" across an enormous range. Read `minGapMs` and `renderMs`, never fps.

### The glow fix, verified on the page

Read directly off the live layer at 3,000 props:

| | value |
|---|---|
| active meshes in the scene | **1,469** |
| meshes in the glow include list | **4** |

Before the fix the layer had no include list, so the glow pass covered every active mesh — the whole
visible scene, redrawn and blurred, for four meshes' worth of bloom.

### The light pool fix, verified on the page

| | value |
|---|---|
| registered lamps | **380** |
| real pooled lights | 6 |
| re-ranks over the whole session | **1** |
| cost of that one re-rank | 0.7 ms |

Previously this was a 380-entry allocate-and-sort on **every frame**. It now happens once and then only
when the camera actually moves.

### The compound, empty

`sim 0.2 + render 0.9 ms` — the first time the simulation half has ever been reported. On an empty site
the split barely matters; the point is that it is now visible before 5,800 props are added to it.

Level: 31 floors, 56 walls, **1,402,338 cells → 205,148 triangles, built in 1,200 ms**. Crust 9,660
triangles in 1 mesh. Grass 44,928 blades / 9,154 tufts → 353,820 triangles across 24 near + 42 far regions.
196 draw calls.

`decor.stats()` reads `props: 0` — the compound is undressed, which is the whole reason for what follows.
`particles.stats()` reads one pool at capacity 3,000 with nothing alive: the fixed `setParticles()` tax is
already being paid on an empty scene.

---

## The rig-promotion bomb — measured, not estimated

`decor.ts`'s `wantsRig` is true whenever a prop has an `idleClip`, and `place()` picks the idleClip as
**any looping clip the model carries**. So authoring a `sway` clip onto a plant silently converts every
placement of it from a shared world-renderer instance into an individually meshed `VoxelRig` — at
placement time, on the main thread, with **no cache**. `sourceCache` serves the world renderer only.

Measured with `createDecorScene` under `NullEngine`, placing *n* copies of one model:

| model | parts | voxels | as instances | as rigs |
|---|---|---|---|---|
| `savoy_cabbage` | 7 | 170k | 389 / 340 / 330 ms for n=1/2/4 | **351 / 554 / 1,218 ms** for n=1/2/4 |
| `aloe_vera_potted` | 24 | 808k | 2,892 / 2,922 ms for n=1/2 | not measured (see below) |
| `freezer_upright` | 13 (4 states) | 400k | — | **781 ms** for one |
| `tomato_ripe_scan` | 17 | 37k | — | 79 ms for one |

**The shape is the finding.** As instances the total is flat as *n* grows — the cost is per *model*,
amortised across every placement, and cacheable. As rigs it is **linear at ~305 ms per placement**, never
amortised and never cached.

Two consequences:

1. **Load.** 300 animated plants ≈ **91 seconds** of frozen tab. At `aloe_vera_potted`'s ~2.9 s a model
   it would be far worse — which is why the promotion gate must land *before* that model is swayed.
2. **Input latency.** The same path fires on `trigger()` (`decor.ts`), so pressing the action key on the
   freezer stalls the game for **781 ms** in direct response to input. That is the only player-visible
   stall on the list, and nothing else on it comes close.

Pinned by a test in `decor.test.ts` so it cannot change silently. (Making that test possible meant giving
eight `src/game` modules explicit `.ts` import extensions, matching the rest of the codebase — `decor.ts`
and `worldRenderer.ts` had never been loadable under `node --test`, which is why this path was untested.)

---

## How not to measure this

- **Software GL.** `sim-shift.mjs` and `capture-scene.mjs` both force `--use-angle=swiftshader`. Any sweep
  harness copied from them measures a software rasteriser. Assert on `engine.getGlInfo().renderer`.
- **fps is a pass/fail bit, not a metric.** 3,000 and 10,000 props both read 118-120 on a 120 Hz display:
  saturated. A regression is invisible until it crosses 8.3 ms. Read `minGapMs` and p99.
- **`getActiveIndices()` overcounts.** It sums the main pass, the shadow map *and* the glow pass, and the
  multiplier changes between configurations. Labelled "triangles submitted", not "drawn".
- **A warm IndexedDB makes a cold load look fast** — 23.1 s vs 0.2 s for 61 sources. Record the flag.
- **Culling flatters a flat grid.** If `activeInstances / instances` is below ~0.5, the row is measuring
  `cullDistance`, not density.
- **The emitter axis will look flat** because `setParticles()` is O(capacity), not O(alive) — 0 and 3,000
  alive cost nearly the same. The control row must dispose the particle world, not idle it.
