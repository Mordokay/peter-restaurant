# Handoff — engineering wins and the double-density stress test

Written 2026-09-14, at commit `e654ea8`. Phase 0 of the plan is done, committed and measured. This
document is everything the next session needs to continue without re-deriving it.

The full plan lives at `~/.claude/plans/reactive-baking-pond.md`. The measurements live at
`docs/PERF_LEDGER.md`. Read both; this is the orientation layer over them.

---

## 1. What the project is

**FarmingUnlimited** — a Babylon.js voxel farm-to-table restaurant management sim. Plain TypeScript +
Vite, no framework, own engine. Five pages:

| page | what it is |
|---|---|
| `/` (`index.html`) | the game |
| `/world.html` | the compound: level, grass, crust, cutaway, day/night, decor, particles |
| `/model-lab.html` | voxel model editor (parts, rigs, clips, emitters, lights) |
| `/surfaces.html` | surface/material lab |
| `/stress.html` | prop-density microbenchmark |

Commands: `npm run dev`, `npm test` (`node --test src/game/*.test.ts`), `npm run build`
(`tsc --noEmit && vite build`). 178 tests currently pass.

### The standing rule, from the user, verbatim in spirit

> There will be no limits on quality or decreases in voxels for the sake of the game running more
> smoothly. This game is a voxel game and should be able to run on any type of machine.

**Never propose fewer voxels, fewer blades, shorter draw distance or lower detail as a fix.** The
answers available are instancing, LOD that collapses rather than thins, baking, caching, typed arrays
and workers. This rule has been reaffirmed by the user more than once; treat it as binding.

---

## 2. The task

Dress the compound at **double the concept art's density** (~2,900 props → ~5,800) with real animation
clips and real particle systems running, find out what breaks, and fix it. `src/assets/scene/decor.json`
is **empty** today — every performance number this project has ever recorded was measured on an
undressed site.

The level has 18 rooms and 13 areas (`src/assets/scene/level.json`), ~1,765 m² of room/area floor plus a
4,352 m² `site_grounds`.

---

## 3. What Phase 0 established (done, committed)

### The instruments were lying, and that mattered more than any optimisation

`SceneInstrumentation.frameTimeCounter` starts on `onBeforeAnimationsObservable` and ends on
`onAfterRenderObservable` — **both inside `scene.render()`**. Every simulation call in `world-main.ts`'s
loop runs *before* `scene.render()`. So the "~1 ms CPU/frame" this project quoted for the compound
measured the render half only, and the whole point of the stress test — animation and particle cost —
was outside the bracket.

Fixed by `src/game/frameTimer.ts` (new). Use it:

```ts
const frameTimer = createFrameTimer({ renderMs: () => instrumentation.frameTimeCounter.lastSecAverage });
engine.runRenderLoop(() => {
  const dt = frameTimer.begin();   // returns clamped dt in seconds
  ...simulation...
  frameTimer.simDone();            // before scene.render()
  scene.render();
  frameTimer.end();
});
```

`stats()` gives `fps, gapMs, minGapMs, p99GapMs, simMs, renderMs, longTasks, longestTaskMs, heapMb, frames`.

### Three fixes that were confounding every measurement

1. **Glow include list** (`lighting.ts`). A `GlowLayer` with no include list falls back to every active
   mesh — it redraws and blurs the entire visible scene. `tagGlow` now calls `addIncludedOnlyMesh`.
   Verified live at 3,000 props: glow pass covers **4 meshes instead of 1,469**.
2. **Light pool** (`lighting.ts`). `assign()` allocated one object per registered light and full-sorted
   them **every frame**. Now bounded insertion into the six real slots, no allocation, colour parsed once
   at `register()`, ranking skipped unless the camera moved >25 cm or the light set changed. Verified at
   380 registered lamps: **1 re-rank for the whole session**, 0.7 ms. This mattered because the cost
   scaled with prop count and would have been read as "props are expensive".
3. **Counters that hid failures** — particle pools swallowed over-capacity spawns silently;
   `worldRenderer.stats()` re-derived the LOD tier from the instance origin (Babylon uses the bounding
   sphere centre) and charged full triangles to culled instances; `decor.stats()` did not exist.

### API shapes that changed — check your call sites

- `lightPool.stats()` → `{ registered, active, assignMs, ranks }`
- `particles.stats()` → `{ alive, capacity, handles, dropped, pools: [{ key, capacity, alive, dropped }] }`
  (`pools` was a **count**, is now an **array**)
- `worldRenderer.stats()` gains `coarseInstances`
- `decor.stats()` → `{ props, rigs, instances, tracksSampled, rigBuildMs, rigBuilds }` (new)
- Eight `src/game` modules were given explicit `.ts` import extensions so `node --test` can load them
  (`decor.ts`, `worldRenderer.ts`, `decorLayout.ts`, `farming.ts`, `tomatoStages.ts`, `voxelEditing.ts`,
  `wheatPlant.ts`, `vxmFormat.ts`). Vite is fine with this and the rest of the codebase already did it.
  **Keep new imports extensioned.**

---

## 4. The finding that drives everything next

`decor.ts`'s `wantsRig` is true whenever a prop has an `idleClip`, and `place()` picks the idleClip as
**any looping clip the model carries**. So giving a plant a `sway` clip silently converts every placement
of it from a shared world-renderer instance into an individually meshed `VoxelRig` — at placement time,
on the main thread, **uncached**. `sourceCache` serves the world renderer only.

Measured by placing *n* copies of one model (`NullEngine`, `node --test`):

| model | as instances (n=1/2/4) | as rigs (n=1/2/4) |
|---|---|---|
| `savoy_cabbage` (7 parts, 170k voxels) | 389 / 340 / 330 ms | **351 / 554 / 1,218 ms** |
| `aloe_vera_potted` (24 parts, 808k voxels) | 2,892 / 2,922 ms (n=1/2) | — |
| `freezer_upright` (13 parts, 4 states) | — | **781 ms** (n=1) |

**The shape is the finding.** Instances are flat as *n* grows — cost is per *model*, amortised, cacheable.
Rigs are **linear at ~305 ms per placement**, never amortised, never cached.

Consequences:
- 300 animated plants ≈ **91 seconds** of frozen tab on load.
- `trigger()` takes the same path, so pressing the action key on the freezer stalls **781 ms** in direct
  response to input. That is the only player-visible stall on the list.
- `aloe_vera_potted` at ~2.9 s per model would be catastrophic as a rig.

Pinned by a test in `src/game/decor.test.ts`.

> ### Sequencing consequence — do not skip this
> **The rig-promotion gate must land BEFORE any plant is given a sway clip.** The plan lists authoring
> (Phase 1) before the fixes (Phase 4); that ordering is wrong and I would not follow it. Authoring
> first arms the bomb and makes the compound unloadable.

---

## 5. Measured baseline to beat

Apple M5 (ANGLE Metal), 1920×848, scaling 1, Chrome against the dev server on port 5199.

**Stress grid, 3,000 props of 60 models:**

| | cold cache | warm cache |
|---|---|---|
| source build | 22,288 ms | 393 ms |
| longest single task | 22,427 ms | 392 ms |
| JS heap | 2,099 MB | 455 MB |
| render ms | 4.81 | 4.68 |
| draw calls | 74 | 74 |

The existing IndexedDB source cache is already worth **57×**. That is the strongest argument for
extending the same trick to rigs and to the level.

**Compound, empty:** `sim 0.2 + render 0.9 ms`, 196 draw calls. Level 31 floors + 56 walls,
1,402,338 cells → 205,148 triangles, built in 1,200 ms. Crust 9,660 triangles in 1 mesh. Grass 44,928
blades / 9,154 tufts → 353,820 triangles over 24 near + 42 far regions.

Display here is **60 Hz** (`minGapMs` 14.6) and render costs ~4.5 ms of a 16.7 ms budget, so fps reads
"fine" across an enormous range. **Read `minGapMs`, `p99GapMs` and `renderMs`. Never fps.**

---

## 6. Recommended order for the next session

The plan's Phase 4 ordering was derived from arithmetic, not from the sweep — the sweep measures frame
time and three of these are load-time costs, so it cannot rank them. I would go:

1. **Rig-promotion gate + cache** (`decor.ts`, `sourceCache.ts`, `voxelRig.ts`). Route `createVoxelRig`
   through `sourceCache` so a promotion is a buffer restore; gate promotion by distance and a concurrent
   cap; demote on exit. **Highest value on the list and a prerequisite for everything in Phase 1.**
   - ⚠️ **Fix the GC hazard first.** `warmSourceCache` derives a delete-prefix as
     `key.slice(0, key.indexOf("@") + 1)`. `indexOf` returns `-1` when absent → `slice(0,0)` → `""`,
     which matches and **deletes every other `@`-less key in the store**. Either harden with
     `const at = existing.indexOf("@"); if (at < 0) continue;` or guarantee every new key carries the
     `<id>@<rev>` prefix. Write a test that two different key namespaces never evict each other.
   - `SerializedMesh` carries no transform and no material, which is exactly right for a rig part (the
     transform lives on the part's `TransformNode`). No format change needed, only a key namespace.
2. **Typed arrays through the mesher** (`voxelGeometry.ts`). Full design is in the plan file under
   "Item 2 in detail". Key trick: one `Int32Array` grid holding `(swayIndex << 24) | colorIndex`, so the
   merge test becomes a single integer compare and the colour needs no second lookup. Predicted 6-10×;
   honest caveat that if V8 hashes short strings better than assumed it is ~4×. **The memory win is
   certain regardless**, and that is what makes floor relief shippable.
   - ⚠️ Premise correction: **callers do not know the extents.** `createVoxelMesh` has no extents
     parameter, `levelBuilder.ts` passes a *filtered subset*, and coordinates can be negative. Derive the
     AABB in one O(N) pass (~1.5 ms for the compound).
   - Keep `mergedVoxelQuads` exported with its current signature as a thin adapter so
     `voxelGeometry.test.ts` passes unchanged.
3. **`sampleClip` allocation** (`voxelClips.ts`). Allocates a `Map` entry, a `PartPose`, three `Triple`s,
   a `filter` array and a `find` **per track per frame**.
4. **`setParticles()` is O(capacity), not O(alive)** (`voxelParticles.ts`) — per pool, per frame, even at
   zero alive. Track a high-water index and pass a range.
5. **Bake the level/crust/grass into IndexedDB** (`levelBuilder.ts`). `floorSignature`/`wallSignature` are
   already complete deterministic descriptions *and already decide what to rebuild*; `planProgress`
   already yields a list of independent jobs — that list is the cache seam. **Must come after step 2**
   or you cache the output of a mesher you are about to change.
6. **Then** Phase 1 authoring (sway clips, emitters), Phase 2 (the `?props=N` generator on `world.html`),
   Phase 3 (the sweep ladder).
7. **Workers — deferred, not cut.** `setProgressSliced` already yields per piece on a 24 ms budget, so
   the main thread is already responsive; the payoff is smoothness, not speed. The Babylon-free split it
   requires is *exactly the refactor step 2 performs anyway*.
   - Blocker: `surfaceRing.ts` shares one `columns: Set<string>` across tiles, so order decides who owns
     a straddling tuft. Note `grassInstances.ts` passes a **fresh** Set per surface — **the grass is
     already shardable; only the crust is not.** Fix by making ownership positional.

### Phase 1 notes when you get there

Sway models should **span** the cost curve, not top it: `rig-model.mjs --sway` emits **one track per child
part**, so `grass_patch_dry` (4,059 parts) would be ~24,000 allocations per prop per frame. Suggested six:
`climbing_vine_3` (45), `monstera` (43), `peace_lily` (26), `hanging_plant_trailing` (26),
`aloe_vera_potted` (24, heaviest voxels — the control proving parts ≠ voxels), `ficus_elastica` (24).
Leave `grass_patch_*` and `dried_bay_leaves_branch` (387) static — grass already sways for **zero CPU**
through the wind material's sway-alpha channel, and the test should show that contrast.

One-line art fix worth doing at the same time: every placement of a model plays its clip from t=0, so 500
props pulse in lockstep and read as a wave. `player.play(clip, { loop: true, from: hash(prop.id) * clip.duration })`.

---

## 7. Traps — how this measurement can lie

- **Software GL.** `scripts/sim-shift.mjs` and `scripts/capture-scene.mjs` both force
  `--use-angle=swiftshader`. Any sweep harness copied from them measures a software rasteriser. Assert
  `engine.getGlInfo().renderer` contains no "SwiftShader" before recording anything.
- **fps is a pass/fail bit.** 3,000 and 10,000 props both read 118-120 on a 120 Hz display: saturated.
- **`getActiveIndices()` overcounts.** It sums the main pass, the shadow map *and* the glow pass, and the
  multiplier changes between configurations. Label it "submitted", not "drawn".
- **A warm IndexedDB makes a cold load look fast** — 22.3 s vs 0.4 s. Record the flag; `clearSourceCache()`
  before cold rows.
- **Culling flatters a flat grid.** If `activeInstances / instances` < ~0.5 the row is measuring
  `cullDistance`, not density. The grid also under-represents clustering: 240 props in one 8×6 m kitchen
  is far worse than 5,800 spread over a 230 m square.
- **The emitter axis will look flat** because `setParticles()` is O(capacity) — 0 and 3,000 alive cost
  nearly the same. The control row must **dispose** the particle world, not idle it.
- **Particle pools are asymmetric and backwards for this game.** The first pool created gets full
  capacity, every later one gets half — and the first is always the opaque cube pool. So steam and fog
  get the smaller share. Measured: capacity 1000 → opaque 1000, translucent 500.
- **Determinism.** `createParticleWorld` defaults `random` to `Math.random`, so "the same" config
  diverges between runs. Pass a seeded RNG via its `random` option.
- **Resolution is not recorded by default** and flips the bottleneck; capture `getRenderWidth/Height()`
  and `getHardwareScalingLevel()`.
- **Benchmark the mesher under `node --test`, not in a browser.** It is pure.

---

## 8. Operating constraints (from the user, and from experience)

- **Ports.** The user owns **5173** (their VS Code dev server and their own browser tab). Automated work
  uses **5199**. One may already be running — check `lsof -ti:5199` before starting another. On macOS
  `localhost` and `127.0.0.1` can bind separately for the "same" port; if `127.0.0.1` gives 000, try
  `localhost`.
- **Never drive the user's browser tab.** `chrome-devtools` attaches to their real Chrome. Open pages with
  `isolatedContext` set and `background: true`, and **close your tabs when done**. There is usually a
  `world.html` tab open that belongs to them — leave it alone.
- **Verify art with real image analysis.** Never assert how something looks from data heuristics — render
  it, screenshot it, actually look.
- **Commits.** Commit only when asked. Git identity is `Mordokay <papajorgioster@gmail.com>`, branch
  `main`, remote `github.com/Mordokay/peter-restaurant` over HTTPS via `gh`. This folder *is* the repo.
- **End each phase iteration with a localhost test link** so the user can look at it.

---

## 9. File map for this work

| file | why it matters |
|---|---|
| `src/game/frameTimer.ts` | **new** — honest sim/render split, gap distribution, long tasks, heap |
| `src/game/decor.ts` | `wantsRig`/`asRig` — the promotion bomb; `stats()` |
| `src/game/sourceCache.ts` | IndexedDB buffers; the `@` GC hazard; `SerializedMesh` shape |
| `src/game/voxelGeometry.ts` | `mergedVoxelQuads` + `createVoxelMesh` — the typed-array target |
| `src/game/levelBuilder.ts` | `floorSignature`/`wallSignature`, `planProgress` job list — the bake seam |
| `src/game/voxelClips.ts` | `sampleClip` per-track-per-frame allocation |
| `src/game/voxelParticles.ts` | pools, `setParticles()` O(capacity), dropped counters |
| `src/game/lighting.ts` | glow include list, light pool (both fixed) |
| `src/game/worldRenderer.ts` | instancing, LOD, `_currentLOD` in stats |
| `src/game/surfaceRing.ts` | shared `columns` Set — the worker sharding blocker |
| `src/world-main.ts` | the compound; already has the update loop, particles, colliders |
| `src/stress-main.ts` | the grid microbenchmark; `?lights=N` added |
| `scripts/rig-model.mjs` | `--sway deg,seconds` clip authoring |
| `scripts/make-freezer.mjs` | the emitter-authoring template (`emitters:` block) |
| `docs/PERF_LEDGER.md` | every measurement with its method |
| `~/.claude/plans/reactive-baking-pond.md` | the full plan |

---

## 10. Honest open questions

- The 6-10× typed-array estimate is a prediction, not a measurement. Lower bound ~4×. Measure it.
- The rig-promotion gate needs a policy decision the plan does not make: what distance, what concurrent
  cap, and whether a prop mid-animation may be demoted. Worth asking the user.
- Nobody has yet run the compound with props on it. Every number in section 5 is from an **undressed**
  site plus a synthetic grid. The first honest density number does not exist yet.
- `decor.json` is empty and should stay hand-authored; the stress layout should be generated **in memory**
  behind `?props=N`, not written over it.
