# Farm to Table — Visual and Animation Bible

## Visual promise

Build a charming, highly readable block world inspired by the clarity of Crossy Road. The world is **voxel-styled**, not a voxel simulation: authored objects are assembled from modular cuboids and a few deliberately blocky wedges/cylinders. There is no destructible voxel terrain or runtime voxel meshing.

At normal gameplay zoom, a player must identify an ingredient, station state, staff role, or urgent problem in under one second.

## Recognition order

Every gameplay object communicates in this order:

1. **Silhouette:** recognizable in grayscale and at gameplay camera distance.
2. **Stable color family:** the same ingredient and status colors everywhere in the world and UI.
3. **Pose or motion:** animation communicates action and urgency.
4. **Icon/text:** labels confirm meaning; they do not rescue unclear world art.

Do not distinguish two items using only hue. Tomato is a round cluster with a green crown; wheat is a tall gold bundle; mushroom has a wide cap; soybean uses curved pod blocks; rice uses pale grain clusters; cabbage is a layered green head; avocado uses a dark pear silhouette and visible pit.

## Geometry rules

- Voxel styling does **not** impose one global cube resolution. Placement grid: 1 world unit. Architectural module: 0.25–0.5 units. Character detail pitch: 0.04–0.08 units. Food/hero-prop detail pitch: 0.025–0.05 units.
- A gameplay tomato is approximately 0.34–0.4 world units wide. Its hero/carry model should be 10–14 detail cells across, with a lobed body, flattened base, green crown and stem, and at least three red values. It must never be represented by one red cube.
- Characters use roughly 8–14 rigid pieces: head, hair/hat, torso, apron, two upper arms, two hands, two legs/feet, and optional tool/tray.
- Props use the fewest blocks that preserve their silhouette. Avoid invisible surface detail.
- Edges are crisp, with restrained bevels only on hero counters and stainless worktops where highlights improve readability.
- Major architecture follows the authored kitchen plan. Visual footprints and collision footprints must agree.
- No authored texture maps for ordinary world objects. Use shared flat materials, vertex/instance colors, lighting, shadows, and limited ambient occlusion.

### Adaptive detail and mesh construction

Use three asset representations where repetition warrants it:

1. **Hero/action model:** highest block resolution for carried food, chopping, plating, selected stations, and close camera moments.
2. **Gameplay model:** medium resolution for crops, pass dishes, and nearby shelf stock.
3. **Crowd/stock model:** simplified silhouette for distant crops and large repeated shelf quantities.

Detail cells are an authoring language, not separate scene objects. At build time, remove hidden internal faces and combine exposed faces into one mesh using vertex colors. Repeated complete objects use instances. Only the few chunks participating in an animation become independent rigid meshes, then return to a pool.

A 0.02-unit pitch is reserved for small hero details where the normal gameplay camera can actually show the difference. Increasing geometric density everywhere would add memory and animation overhead without improving readability.

### Authored voxel source format

Recognizable food, crops, characters, furniture, and machines use deterministic authored model data. The source of truth stores a compact palette plus named parts, pivots, individual voxel coordinates, coordinate runs, and filled coordinate bounds. Shape equations and runtime random generation are prototype tools, not shippable identity assets.

- Individual coordinates make silhouette and color corrections explicit.
- Coordinate runs efficiently describe organic cross-sections such as tomato and cabbage layers.
- Filled bounds describe dense manufactured forms such as pressed tofu without listing invisible internal cells.
- Later entries may repaint earlier cells for highlights, veins, pores, bruising, or cut surfaces.
- Named parts and pivots must survive loading so leaves, stems, lids, blades, handles, and food portions can animate independently.
- Loading removes hidden faces and produces a merged vertex-colored mesh per rigid part. Repeated fruit and stock reuse geometry.

Parts may carry a `parent` (rig hierarchy) and named `sockets` (attachment cells), and a model may carry `clips`: keyframed rotation (around the part's pivot), movement and scale per part, with easing and timed events. Animation is rigid-part motion, never stretched voxels: a rotated upper arm carries forearm, hand and the knife on its socket. Scans arrive pre-rigged from the file's own node hierarchy where it has one, and from contact inference (`scripts/rig-model.mjs`) where it does not; the Model Lab editor refines joints, parents and clips.

Model data is reviewed in the gameplay camera. A model-editor close-up may help authoring, but it is not the acceptance view.

The Model Lab doubles as that editor for plain catalog models (Edit button): paint, add, erase (brushes 1–7 voxels wide), bucket (connected same-color region, Shift to cross similar shades), eyedropper, remove piece, palette swaps, part hide/delete, a 100-step per-object undo history that survives saves and page reloads, and a Save that appears only when the model differs from the catalog and writes straight back into `src/assets/food-models.json` through the dev server. Every tool previews the voxels it will change as a pulsing template-pink overlay before the click. Use it to strip unwanted pieces from a scan or to move its colors onto the game palette; parts, pivots and palette keys survive the round trip.

### Reference-to-model acceptance loop

No recognizable real-world asset is approved from memory or after a single modeling pass.

1. Gather several clear real-life references showing the object from the top, side, and three-quarter views. Identify its recognition anatomy before authoring: overall volume, major layers, attachment points, characteristic edges, and light-to-dark color structure.
2. Author those traits as deterministic named voxel parts. Spend detail on silhouette, overlap, veins/seams, and animation pivots—not uniformly across hidden volume.
3. Open the asset directly in Model Lab and inspect it from multiple angles, both close up and near gameplay size. Compare it beside the references rather than judging it in isolation.
4. Write a critical pass: what reads correctly, what reads as another object, what looks algorithmic, which parts intersect or float, and which details disappear at gameplay distance.
5. Revise and repeat the render/critique cycle until the object is immediately recognizable, structurally coherent from every useful angle, and expressive in motion. More voxels alone do not constitute improvement.
6. Validate the accepted asset in the actual game lighting, camera, animation, and crowded scene before calling it production-ready.

The author—not the player—is responsible for completing these iterations. Model Lab supports the process; it is not evidence by itself that an asset has passed.

### Living crop rule

Crop silhouettes follow the recognizable structure of the real plant, simplified for the camera. A tomato plot uses upright vines, alternating branches and leaves, fruit stems, and distinct fruit sites; it is not a row of red objects placed directly on soil.

- Each visible fruit owns its maturity state. Harvesting removes only the chosen ripe fruit.
- A growing fruit scales from zero at its persistent attachment point with a small overshoot before settling.
- Mature fruit uses no more than roughly 2% breathing/bounce, and the complete plant sways more slowly and less strongly.
- Ripening earns one short 3–5 cube confirmation burst. Mature crops may emit at most one ambient glint at long irregular intervals.
- Yield upgrades must visibly add plant bodies, branches, fruit sites, or fruit density. A numerical yield upgrade with no crop-model response is not acceptable.
- Plant motion is deliberately quieter than harvesting, cooking, ready stations, and urgent service states.

## Palette

Use a compact warm-neutral palette with functional accents:

- Stainless steel: cool light, mid, and shadow greys.
- Architecture: warm cream tile, walnut, charcoal, and muted green.
- Crops/food: more saturated than architecture and permanently associated with their ingredient families.
- Interaction: cyan.
- Ready/success: fresh green.
- Waiting/warning: amber.
- Blocked/dirty/failure: coral red and brown.
- Recipe Points/awards: warm gold.

World lighting may shift by day phase, but semantic colors must remain stable. Check key states with a color-blindness simulator and in grayscale.

## Professional kitchen style

- Central stainless prep/plating island with clearly separated chef bays.
- Perimeter hot line beneath oversized block-built extraction hoods.
- Rear sinks, refrigeration, shelves, and labelled ingredient bins.
- Warm tile, timber, plants, and copper cookware prevent the steel kitchen from becoming visually cold.
- Clean steel has a bright cool top and dark edge band; dirty steel adds sparse brown block clusters and reduced shine, never a noisy texture.

## Animation language

Animations are short, exaggerated, and pose-driven. The simulation remains smooth; visible limbs and props may use stepped 8–12 fps poses for charm.

### Exaggerated motion rule

Voxel animation is deliberately cartoonish. Real motion supplies the logic, but exaggeration supplies readability and charm.

- Every important action must create a clear silhouette change at the normal gameplay camera. If movement is only visible in Model Lab close-up, it is too small.
- Use strong key poses, asymmetrical timing, and readable holds. Avoid mechanically perfect sine-wave motion except for subtle machinery.
- Actions use anticipation, then travel slightly beyond the physically neutral pose before settling. Tools, leaves, clothing blocks, ingredients, and particles follow the main action with staggered secondary motion.
- Active character and machine actions may use roughly 10–20% positional/rotational overshoot and 5–12% squash or stretch where volume still reads consistently.
- Completion, failure, impact, and urgency receive the largest accents. Ambient idle motion remains quiet so it does not compete with gameplay.
- Exaggeration must never move an interaction point, collision boundary, ingredient-consumption frame, or output-creation frame away from the underlying simulation truth.
- Review animations both at full speed and frame-by-frame in Model Lab. Reject motion that is technically present but imperceptible, uniformly synchronized, floaty, or lacking a decisive key pose.

Every task uses **anticipation → action → response → recovery**:

- Walk: alternating block feet, small torso lean, hat/head counter-bob.
- Sprint: stronger lean, longer step, two dust cubes at direction changes.
- Chop: raise knife, squash tomato, decisive strike, 3–6 ingredient cubes scatter into a container.
- Stir soup: arm/tool orbit, pot squash, colored cubes circulate, two steam puffs.
- Pour: container tilts, a short chain of colored cubes travels to the target, receiving vessel reacts.
- Plate: ingredient blocks snap into a recognizable dish silhouette with a small success pulse.
- Serve: tray stays level while body bobs; table/order marker resolves on handoff.
- Clean: broad wipe arc, grime blocks shrink/pop, two pale sparkle cubes confirm completion.
- Harvest: plant stretches, ingredient blocks pop upward, character catches them, soil rebounds.
- Collision/recovery: squash and sidestep; never ragdoll or teleport.

Animation timing carries gameplay information. A station only consumes inputs at the action frame and only creates output at the response frame. If interrupted before consumption, nothing is lost.

## World-first feedback rule

Every active gameplay object must communicate its state in the 3D world. A progress bar is supporting detail, never the only evidence that work is happening.

Use the strongest physically believable feedback available:

1. **Mechanical motion:** press descends, mixer turns, oven door opens, knife chops, dishwasher rack slides.
2. **Visible contents:** tomatoes become chopped pieces, soup level/color changes, fermentation jars bubble, plated components assemble.
3. **Worker action:** the assigned character aligns with a work position and performs the matching task animation.
4. **Particles/environment:** steam, crumbs, droplets, heat shimmer blocks, bubbles, cleaning foam, or grime removal.
5. **Indicator light:** for enclosed or mostly static appliances.
6. **Audio cue:** short loops and completion sounds reinforce, but never replace, visual feedback.

If a machine has an animatable mechanism, shipping it with only a timer or loading bar is not acceptable. Worker animations and station animations share event markers so hands, tools, ingredients, consumption, and output appear synchronized.

### Universal state language

- **Idle:** still silhouette, no status light, ingredients absent or waiting visibly.
- **Working:** repeated task motion plus a slow amber pulse; particles only when appropriate.
- **Ready:** motion stops in a readable finished pose, output becomes visible, green double-pulse and one completion effect.
- **Blocked:** mechanism pauses, output remains visible, red double-blink and a small blocked symbol.
- **Missing input:** empty receiving area plus a brief amber single-pulse; no constant alarm.
- **Dirty:** localized grime blocks and reduced clean-steel highlight.
- **Broken/unsafe:** red rapid blink, stopped mechanism, fault pose and sparing smoke/spark blocks.
- **Selected:** cyan edge/base highlight that does not replace the operational state.

Color is redundant with motion pattern and shape: working is a slow pulse, ready is a double-pulse, blocked is a red double-blink, and broken is a rapid blink. This keeps states readable for color-blind players.

Do not animate everything continuously. Idle scenery remains calm; active and urgent objects earn attention. This produces a readable visual rhythm during a busy service.

## Interface restraint

Normal gameplay has no permanent progress cards floating above every station, shelf, worker, crop, and customer.

- Hovering or approaching an object shows a compact one-line summary.
- Selecting/interacting opens a focused panel with recipe, exact inputs/outputs, queue, cleanliness, and remaining time.
- Urgent conditions may show one small world icon: blocked, dirty, broken, expiring order, or ready output that has waited too long.
- Management/inspection mode may deliberately reveal progress and capacity overlays for all relevant objects; leaving that mode hides them.
- Storage fill is communicated by visible stock first. Exact counts and bars live in the shelf interaction panel.
- Crops communicate growth through their model. Exact yield/progress appears on proximity or in Farm mode.
- Worker names and current tasks appear on hover, selection, or Staff mode. Debug balloons are not part of the normal presentation.

Panels should be anchored to screen edges where practical rather than overlapping the world object. Only one detailed object panel may be open at a time. Important dinner information—active orders, shift time, coins, reputation, and Recipe Points—remains persistently visible but compact.

## Picture-first interaction rule

The complete core loop must be understandable by a child who cannot read. Text may provide optional precision, accessibility, settings, and flavor, but it cannot be required to harvest, cook, plate, serve, clean, upgrade, or respond to an urgent problem.

- Teach interactions with animation, ghosted demonstrations, object highlights, arrows, and direct cause/effect.
- Use pictures of the actual voxel object, not abstract icons where a recognizable object exists.
- Never rely on color alone. Pair colors with silhouettes, pulse patterns, fill shapes, or position.
- Use repeated item pictures or large pips for small quantities. Numerals are an optional compact fallback.
- Use clock wedges, shrinking ticket borders, facial poses, and sound cadence instead of written seconds.
- Confirm actions through world response: an item moves, a machine reacts, a ticket stamps, or an upgrade visibly assembles.
- Core controls use direct manipulation: drag a chef portrait to a pictured station, place a dish card into a menu slot, and point at pictured pantry bins instead of configuring tables of checkboxes.
- Search fields, filter lists, and checkbox grids are not permitted in the normal play loop. Advanced management may expose optional detail, but it must not be necessary for competent play.

### Physical order rail

Remove the permanent right-side customer-order list when its physical replacement is active. Orders live on a ticket rail attached to the kitchen pass:

- When seated, a guest briefly displays a speech bubble containing the requested dish picture and quantity pips.
- A ticket slides onto the rail. It shows the same dish picture, quantity pips, and a table marker that matches a shape/color marker physically present on the table.
- Tickets sort oldest to newest from left to right. A shrinking border/clock wedge and four increasingly urgent poses communicate patience without seconds or text.
- When a plate is ready, its matching ticket and pass slot pulse together.
- A player or Server reserves a ticket by clipping their portrait/token to it. This prevents duplicate collection and visually explains ownership.
- Served quantities receive large stamp marks. The ticket flips or slides away after the complete order reaches the table.
- Approaching/selecting the pass smoothly focuses and enlarges the physical ticket rail. It does not open a disconnected scrolling list.
- Urgent ticket audio is sparse and positional. The oldest near-expiry order gets attention; every ticket does not beep at once.

The ticket rail has one readable physical slot per active table, and expands with the dining room/pass. If the rail is full, no additional party is seated. This connects dining capacity to visible service capacity and prevents off-screen hidden demand.

The old list must not be removed before the rail, table markers, speech bubbles, focus interaction, and accessibility fallback are all functional in the same build.

### Replacing management forms

- Menu: illustrated dish cards placed into one to six physical/menu-board slots.
- Recipes: ingredient pictures → station picture → dish picture.
- Storage: pictured bins or shelf zones; automatic stocking is selected by placing category/item tokens, with one visible “everything” basket token.
- Chef assignment: portrait tokens placed beside pictured work zones, with ordered priority tokens if needed.
- Farming: seed packets with crop pictures placed onto plot cards or directly onto plots.
- Upgrades: before/after model silhouettes plus coin cost; focused optional text explains exact statistics.

Use short names only as optional labels on focus. Localization should improve flavor and accessibility, not determine whether the game is playable.

## Particles and effects

Voxel particles are functional punctuation, not continuous decoration:

- Food fragments: 3–8 cubes.
- Pour streams: at most 10 visible cubes per stream.
- Steam: 2–5 pale translucent block puffs per cycle.
- Dirt/cleaning: persistent grime blocks plus brief cleaning sparkles.
- Upgrade: compact gold/green block burst.
- Never obscure interaction points, carried items, table orders, or worker silhouettes.

Reuse pooled particles and shared source meshes. Static repeated details such as floor tiles, chairs, crops, dishes, and shelf stock use hardware instances or thin instances where interaction is unnecessary.

## UI relationship

The 2D UI can remain smooth and typographic, but it shares the world palette and uses small voxel item portraits. Status bars and icons use both color and shape. World labels appear only for selection, urgency, or debugging; normal state should be readable from the model.

## Production constraints

- Establish the camera, palette, character proportions, and six core task animations before producing the full asset set.
- Validate every asset in the actual camera at normal zoom, not in a close-up model viewer.
- Target one shared material per palette color and aggressively reuse geometry.
- Prefer one vertex-colored mesh per finished prop over one mesh per detail cell. Draw-call count is a stricter budget than raw triangle count.
- Prefer TransformNode hierarchies and procedural clips over skeletons. Skeletons remain permitted only if a later hero animation demonstrably needs deformation.
- No ragdolls. Failures use authored block poses and particles.
- Performance budgets will be measured on a representative low-end mobile/browser scene before content production expands.
- Initial budgets: under 120 active draw calls during dinner, under 80k visible triangles at normal zoom, no more than 16 independently animated food fragments per task, and a stable 60 fps target on the representative browser test machine.

## First vertical slice

Build one polished shift containing the player, one Server, tomato crop, Stove, pass, one dining table, Tomato Soup, serving, dirty-table cleanup, and shift-end results. It must prove readability, animation timing, and pacing before the remaining restaurant assets are converted.

The slice must be understandable with station progress bars disabled. Bars may then be added to focused interaction panels for precision.

## External-model voxelization pipeline

Free external meshes enter the game as voxel art through two scripts:

1. `scripts/voxelize-mesh.py <model.glb|.gltf|.obj> <out.vox.json> [--geometry NAME] [--pitch F | --height N] ...`
   — the universal converter. It is object-agnostic by rule: nothing in it
   knows what the model is. Parts are the source's own objects (scene node →
   primitive → connected component by vertex position); color is sampled from
   the source texture with a deterministic lattice (glTF V is flipped by
   trimesh on load, so the atlas row is `(1 - v) * H`; wrap mode, base color
   factor, vertex colors and alpha cut-outs are honoured); each voxel keeps the
   linear-light mean of its samples, each part reduces its voxels to a few
   perceptual shades (Oklab, `--shadeTolerance`, `--maxShades`, `--flatten`),
   a majority `--denoise` pass removes threshold speckle, and all shades share
   one deduplicated palette. Detail is adaptive per part: vertex density
   relative to the whole model picks a pitch from `--lodLevels` (default
   2,1,0.5 × base), guarded by `--minPartVoxels`; the table it prints shows
   vertices, area, density, level, estimated and actual voxels per part.
2. `scripts/voxels-to-model.mjs <out.vox.json> <modelId> <worldHeight> [--parts plant] [--keepSourceParts] [--recolor '#from>#to']`
   — writes the catalog entry into `src/assets/food-models.json`: fine parts
   as runs, coarse parts as boxes on the same lattice (coarse first, so fine
   detail wins on overlap). `--recolor` is the only art-direction hook and it
   is explicit per model. The legacy colorless `.obj` grid path (wheat) keeps
   its height-banded straw coloring; `scripts/glb-to-obj.mjs` remains only for
   that path.

The renderer merges coplanar same-color faces (greedy meshing in
`createVoxelMesh`), so coarse blocks and flat surfaces cost a few quads, not
one quad per cell — the ripe tomato plant halves from 153k to ~71k triangles
without a visible change.

License policy for scans: prefer CC0 sources; CC-BY is acceptable with a credit
here (a voxelization is a derivative of the source mesh, so the license
travels). Current sources:

- `wheat_scan` — "Wheat" by Quaternius (CC0, via poly.pizza). Drives the game plot.
- `tomato_sprout_scan`, `tomato_vine_scan`, `tomato_ripe_scan` — "Free Pack - Stylized
  Tomato" by DuNguyn Studio (CC-BY-4.0, via Sketchfab; user-provided file). Three
  growth stages converted at one shared pitch (0.00344 model units) with
  `--shadeTolerance 0.12 --flatten 0.35`; the stake lands on the coarse level
  by its own vertex density, fruit reds and yellow flowers come straight from
  the texture with no recolor flags.
