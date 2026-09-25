# Farm to Table — Rulebook

> The single source of truth for what this game is, how it behaves, how it looks, and how its assets are
> made. If something here is wrong, fix it here — do not work around it in code, and do not leave a
> correction living only in a conversation.

**How to use this.** Read Part 0 first; it arbitrates everything else. Then read the part you need.
History lives in `docs/CHANGELOG.md`, measurements in `docs/PERF_LEDGER.md`, and the concept art in
`docs/concept/*.png`. Those are references, not rules.

**When two ideas conflict**, use this order:

1. The user's newest explicit direction.
2. Part 0 of this rulebook — gameplay over realism.
3. The rest of this rulebook.
4. The active modules and their tests.

Do not treat old working code as a design requirement. A large fantasy farming/shop game was removed from
this repository; anything that smells of it is not a specification.

---

## Part 0 — The tie-breaker: gameplay over realism

> "Gameplay is the focus and we should be able to sacrifice a good amount of realism so that the game
> plays well. This is a game made for players who love farming, harvesting, cooking, serving, managing
> business."

Research and real biology stay. Getting a plant's anatomy right is what makes it *recognisable*, and
recognition is itself a gameplay property — it is the first item in the recognition order in Part 4. But
when accuracy and playability pull apart, **playability wins, and say so out loud rather than quietly
splitting the difference.**

What this licenses:

- **Size.** Produce and crops are authored larger than life so they read across a plot. A botanically
  perfect pepper six pixels wide at the game camera is a defect, not an achievement.
- **Count.** A model may show fewer fruit than the plant yields. Visible fruit sites and awarded item
  count are deliberately separate numbers; twelve visible tomatoes may award forty.
- **Time.** Growth and regrow are tuned to a play session, not to a season.
- **Legibility.** A harvestable plant must read as harvestable from across the plot. If accuracy hides
  that, accuracy gives way.

What it does **not** license: cutting detail, voxel density or draw distance to gain frame rate. That is
forbidden separately and for different reasons — see *Performance is not paid for with quality* in
Part 4. This rule is about size, count and timing, never fidelity.

---

## Part 1 — The game

### North star

Every system should create the feeling: **“I can almost keep up—what should I improve next?”**

The player should understand every ingredient and recipe at a glance, make meaningful trade-offs under dinner pressure, and recover from mistakes without the simulation solving itself.

### Daily loop

1. **Prep (4 real minutes):** harvest, cook, start fermentation batches, arrange the kitchen, and assign chefs. No ordinary customers arrive.
2. **Choose menu (untimed):** select recipes and planned quantities. The menu starts with one slot and grows to six.
3. **Dinner (4–5 real minutes):** customers request only active-menu dishes. Farming and cooking remain available, creating the central triage decision: serve, restock, or harvest.
4. **Close:** show sales, missed orders, waste, bottlenecks, recipe mastery, and unlock progress. Plated dishes expire; ingredients and prepared components persist. Fermentation advances by one day.

### Content rules

- Seven recognizable crops: tomato, wheat, mushroom, soybean, rice, cabbage, avocado.
- Four kitchen stations: Prep Counter, Stove, Oven & Grill, Culture & Press Station.
- A product may require at most two physical transformations from crop to served dish.
- Pantry staples such as water, oil, salt, spices, starter culture, and nori are abstract and never carried.
- Fermentation is batch planning, not moment-to-moment carrying: tofu is same-day; tempeh and vegan kimchi take 2 days; sauerkraut takes 3; miso takes 4.
- Culture & Press starts with two batch slots. Upgrades add slots, improve yield, then reduce duration by one day (minimum one).

### Restaurant layout

Use an **authored kitchen with expandable modules**, not free placement for major production stations. A restaurant should read immediately as a kitchen, and fixed work zones let customer pacing, chef capacity, animation, and navigation be balanced reliably.

- The Stove, Prep Counter, Oven & Grill, kitchen island, pass, and fermentation cellar occupy predetermined upgrade anchors.
- The starting kitchen is compact. Island upgrades make it physically larger and add a second chef work position before increasing raw speed.
- Counter/pass upgrades add service positions. Dining-terrace upgrades add seats and customer capacity in visible stages.
- Shelves, bins, counters, and small utility furniture remain movable within valid zones. This retains useful layout decisions without allowing impassable station mazes.
- Moving or selling a core station is replaced by upgrading its module. Existing buy/sell/move code remains useful for movable furniture and temporary equipment.

#### Fermentation cellar

Multi-day production lives in a small dedicated cellar/warehouse reached from the kitchen. It unlocks with cabbage and begins with two batch positions. Players see labelled jars/crocks and “ready in N days” rather than carrying indistinguishable intermediate items around the restaurant.

Cellar upgrades follow authored stages: add rack space → improve batch yield → reduce duration by one day (minimum one) → add premium ageing space. Batches persist between days and never occupy serving-shelf capacity until collected.

### Tutorial and progression

| Reputation level | Unlock |
| --- | --- |
| 1 | One tomato plot, Stove, small serving shelf, counter, Tomato Soup, one menu slot, no chefs |
| 2 | Wheat, Bread, Tomato Pasta, second menu slot |
| 3 | Mushroom and its soup/pasta recipes |
| 4 | Soybean, tofu, first chef applicant, third menu slot |
| 6 | Rice, bowls, and mushroom sushi |
| 9 | Cabbage, Culture & Press, vegan kimchi and sauerkraut, fourth menu slot |
| 12 | Tempeh and miso batches |
| 14 | Avocado, sushi and toast, fifth menu slot |
| 20 | Premium recipes and sixth menu slot |

The opening tutorial is a real first shift, not a disconnected checklist: harvest tomatoes → cook Tomato Soup → place servings on the shelf → choose it as the one-item menu → serve the first customer → close the day → spend the reward toward wheat.

### Economy and staffing

- **Coins:** equipment, layout, seeds, wages, and chef training.
- **Reputation:** level/unlock eligibility; earned by fast, complete service and lost through missed customers.
- **Recipe Points:** unlock recipes. This replaces Astral Cores.
- Chefs specialize as Gardener, Prep Cook, Line Cook, Server, or Head Chef/generalist. Roles improve relevant work; they do not create exclusive permissions.
- Automation should relieve one bottleneck, not run the restaurant. A normal player should serve 80–90% of demand; excellent play can approach 100%.

### Capacity and pacing targets

- Serving shelves: 12 / 24 / 40 slots.
- Healthy station utilization: 85–92% immediately before an upgrade, 70–80% immediately after.
- Customer patience: one full production cycle plus walking time plus roughly 25% decision margin.
- Waste/discard target: below 2% of produced units.
- Upgrade payback targets: minor 3–5 min; station 8–12 min; chef 10–15 min plus wages; crop/recipe 15–25 min; extra counter 30–45 min.
- The restaurant has one authored host/pass counter. Upgrades widen it and add service positions; they do not create independent customer spawners.

### Dining room progression

Dining upgrades replace the old “buy another counter to double arrivals” model. They should increase opportunity and workload in controlled, legible steps:

- **Tables and seats** cap simultaneous parties; reputation and the chosen menu drive arrival demand.
- **Better chairs** add a small patience/comfort bonus, never production speed.
- **Lighting, plants, and tableware** improve tips and reputation quality rather than raw capacity.
- **A wider pass/host counter** adds a service position and reduces handoff congestion.
- **Cleaning capacity** determines how quickly tables become reusable after guests leave.

The starting restaurant should be modest and worn but clean. Cockroaches are not a purchasable “bad starting tier.” They appear only as feedback when hygiene is neglected or dirty tables remain too long, reducing patience, tips, and reputation. This makes cleanliness a recoverable service problem instead of an unpleasant permanent theme.

### Guest standards and awards

Guest tiers unlock through published standards rather than random wealth rolls:

- **Neighbors** have no entry requirements and establish the basic service loop.
- **Food enthusiasts** require a small reputation and at least two consistently mastered recipes.
- **Celebration diners** require a comfortable dining room, strong cleanliness, and reliable service. They order higher-value dishes and tip well.
- **Culinary travellers** require a Garden Guide award plus high menu quality and cleanliness. Their visits are uncommon, valuable, and reputationally risky.
- **Critics and VIP bookings** announce some requirements in advance, creating a preparation objective instead of an unavoidable surprise.

The fictional **Garden Guide** avoids directly reproducing a real commercial award. Its Recommended and one-to-three Garden Star levels judge only cuisine: ingredient quality, recipe mastery, menu harmony, value, and consistency across several services. Cleanliness, comfort, and service do not create stars, but they independently determine whether demanding guests will book.

Inspections become available after meeting visible criteria. The player chooses when to request one, pays a modest application cost, and receives a report even after failure. Awards can be retained only through continued consistency; one poor shift is recoverable and does not immediately remove a star.

### Cleaning and maintenance

Cleaning is a real capacity trade-off but should not become constant clicking:

- Cooking creates station grime; customers create dirty tables; occasional spills create urgent local jobs.
- Each dirty station or table is a visible task. The player can clean it directly, or assign a **Kitchen Steward** to dishes, surfaces, floors, bins, and table turnover.
- Other chefs may clean when idle, but slowly. A steward specializes in cleaning and hauling and is not called a “chef cleaner.”
- Cleaning supplies are one pantry resource measured in uses, not several carried shelf items. They have a recurring operating cost and can be automatically reordered.
- Stainless surfaces, a commercial dishwasher, washable floors, better extraction, larger bins, and pest control reduce grime or cleaning time through authored facility upgrades.
- Closing includes a short cleanup window. Remaining grime persists into the next day, so skipping cleanup buys prep time now at tomorrow’s cost.

Use one 0–100 hygiene score backed by localized tasks. Above 80 is excellent; 60–79 is acceptable; 30–59 blocks demanding guests and inspections; below 30 risks visible pests and serious reputation loss. Stations below a critical cleanliness threshold lose speed and dish quality until cleaned.

### Table service

The full service chain is **kitchen station → pass counter → player/server → dining table → dirty table → steward**. During the opening shifts the player performs every handoff, making the value of the first Server immediately understandable.

- Completed dishes wait in limited pass slots. A full pass blocks plating but does not stop unrelated prep work.
- Servers reserve an order before collecting it so two people never chase the same plate or table.
- A server carries a small tray of compatible table orders and chooses a short sensible route.
- Guests waiting for food lose patience; guests who have received food occupy their table for a short dining period.
- After departure, the table cannot seat another party until cleared by the player, a Server, or a Kitchen Steward. Servers clear tables when no food is waiting; stewards prioritize cleaning.

Tips belong to the restaurant and are calculated from the bill. Fast service, waiter hospitality, chair comfort, décor, cleanliness, and food quality improve the tip; long waits, grime, mistakes, and pests reduce it. A skilled Server therefore earns more through better service, but never creates money simply by standing nearby. Their wage and limited tray capacity keep hiring from being an automatic decision.

Server progression improves three readable attributes: **Pace** (movement), **Tray** (carrying capacity), and **Hospitality** (patience recovery and tip quality). Hospitality has a capped effect so recipe quality remains the primary source of restaurant prestige.

Customer requests are physical picture tickets on the pass counter, not a permanent side-screen list. Dish pictures, quantity pips, matching table markers, patience wedges, served stamps, and reservation tokens communicate the full order state without reading. The rail expands with dining capacity and prevents new seating when full.

### Visual direction

Use a professional open-kitchen silhouette inspired by MasterChef workstations and contemporary restaurant kitchens:

- Brushed stainless-steel counters with softened edges and clear, chunky forms suitable for the isometric camera.
- A central prep/plating island with one worker position per unlocked bay.
- Perimeter hot line: stove and Oven & Grill beneath large extraction hoods.
- Refrigeration, sinks, and organized ingredient shelving along the rear run.
- The front pass/host counter visually frames the kitchen and separates production from dining.
- Broad, unobstructed circulation lanes around the island; station interaction points face those lanes.
- Warm wood, tile, plants, and copper cookware in the architecture keep the room welcoming rather than laboratory-cold. Steel communicates professionalism; warm accents preserve the farm-to-table identity.

The kitchen grows through authored visual stages: compact neighborhood kitchen → expanded central island → longer hot line and pass → polished open restaurant kitchen. Each upgrade changes the model and adds an operational position, so progression is visible without filling the room with unrelated machines.

The entire world follows the block-built visual and animation rules in Part 4. This art foundation is part of the first vertical slice, not a final polish pass.

Production state is world-first: synchronized machine, worker, ingredient, particle, and indicator animations communicate work continuously. Permanent floating station bars are removed from normal play; precise progress appears through proximity, selection, or management mode.

The core game is picture-first and must remain playable without reading. Large lists, filters, tables, and checkbox grids are replaced by direct manipulation of illustrated dish cards, ingredient tokens, chef portraits, seed packets, and physical world objects. Optional focused text provides detail without carrying the interaction.

### Implementation order

1. Establish and validate the restaurant catalogue and progression data.
2. Prove the voxel-styled palette, character, animation, and service-loop vertical slice; then build the authored kitchen/cellar shell and migrate fantasy content.
3. Add reputation, Recipe Points, recipe unlocks, and the guided first-shift tutorial.
4. Add Prep → Menu → Dinner → Close phases and menu-limited customer requests.
5. Add persistent multi-day fermentation batches.
6. Convert workers to chef roles and rebalance automation, shelves, customers, and economy.
7. Use balance telemetry and repeated full-shift playtests to tune pacing.

### Save migration policy

Before switching runtime content, retain the old save reader. On first load, back up the legacy payload, convert old stock by production stage, refund removed station purchases, retain coins/upgrades/play time, and write the new version only after validation succeeds. Unknown items are converted to coins rather than silently deleted.

---

## Part 2 — Content limits and the recipe catalogue

### Locked content limits

#### Crops

The original plan capped this at seven (tomato, wheat, mushroom, soybean, rice, cabbage, avocado).
**That cap is lifted.** The restaurant is vegan, and breadth of plant ingredients is the point — a vegan
kitchen cooks with pulses, grains, brassicas, roots, alliums, squashes, mushrooms, nuts, seeds, soy and
leafy greens, and the catalogue should reflect that.

Those seven remain the *core* progression crops. Grow the roster deliberately rather than ad hoc: every
crop must earn its place by appearing on the menu, and every growable crop needs **both** forms — the
staged growing plant for the plots and the produce item for crates, shelves and storage sockets, because
buying is the expensive alternative to growing.

What is **not** lifted: the transformation limit and the four station families below. Breadth comes from
ingredients, not from machines.

Pantry staples such as water, oil, salt, spices, culture, and nori are abstract. They are never physical inventory that the player must carry.

#### Station families

Only four major production families:

1. Prep Counter
2. Stove
3. Oven & Grill
4. Culture & Press Station

Do not grow the station count merely to give each recipe a bespoke machine. Distinction should come from work positions, visible ingredients, tools, mechanisms, and animation.

#### Transformation limit

A crop may undergo no more than two physical transformations before it becomes a served dish. The catalog validator enforces this. Multi-day fermentation is batch planning, not an excuse to add invisible intermediate items.

#### Implemented recipe catalog

The following values exist in `src/game/restaurant.ts`; they are an initial balance hypothesis, not proven final balance:

| Output | Inputs | Station | Duration | Yield | Unlock |
| --- | --- | --- | --- | ---: | ---: |
| Tomato Soup | 2 Tomato | Stove | 18 s | 2 | 1 |
| Dough | 2 Wheat | Prep Counter | 12 s | 2 | 2 |
| Fresh Bread | 1 Dough | Oven & Grill | 20 s | 2 | 2 |
| Tomato Pasta | 1 Tomato + 1 Wheat | Stove | 22 s | 2 | 2 |
| Mushroom Soup | 2 Mushroom | Stove | 20 s | 2 | 3 |
| Mushroom Pasta | 1 Mushroom + 1 Wheat | Stove | 24 s | 2 | 3 |
| Tofu | 2 Soybean | Culture & Press | 25 s | 4 | 4 |
| Crispy Tofu Rice Bowl | 1 Tofu + 1 Rice | Oven & Grill | 26 s | 2 | 6 |
| Mushroom Sushi | 1 Mushroom + 1 Rice | Prep Counter | 21 s | 2 | 6 |
| Vegan Kimchi | 3 Cabbage | Culture & Press | 2 days | 8 | 9 |
| Sauerkraut | 3 Cabbage | Culture & Press | 3 days | 10 | 9 |
| Tempeh | 3 Soybean | Culture & Press | 2 days | 6 | 12 |
| Miso | 3 Soybean + 1 Rice | Culture & Press | 4 days | 12 | 12 |
| Tempeh Rice Bowl | 1 Tempeh + 1 Rice | Oven & Grill | 28 s | 2 | 12 |
| Miso Mushroom Soup | 1 Miso + 1 Mushroom | Stove | 24 s | 3 | 12 |
| Avocado Sushi | 1 Avocado + 1 Rice | Prep Counter | 22 s | 2 | 14 |
| Avocado Toast | 1 Avocado + 1 Wheat | Prep Counter | 20 s | 2 | 14 |

Fermentation must feel like deliberate batching across days. The dedicated cellar/warehouse begins with two batch positions when cabbage unlocks. Crocks/jars visibly show contents and days remaining. Cellar upgrades add slots, improve yield, reduce duration by at most one day with a one-day minimum, and later add premium ageing space.

---

## Part 3 — The world and its areas

Set by the owner on 2026-09-06. Every scene, prop import, thumbnail and level layout is judged against this document and against `docs/layout-reference.png` (the top-down master plan of the whole restaurant compound).

The game: a cozy farm-to-table, plant-based restaurant management and farming simulation. The player is the head chef, later leading a brigade of AI chefs, and owns the whole chain:

**FARM → HARVEST → PREPARATION → COOKING → SERVICE → TABLE**

### Concept-art prompt (used for every area image)

Create a highly detailed environment concept-art image for a cozy farm-to-table plant-based restaurant management and farming simulation game.

**Art style.** The entire game is rendered in an exceptionally detailed, colorful VOXEL ART style. Use small, fine-grained voxels with a very high level of environmental detail. This should NOT resemble basic Minecraft graphics or large cubic blocks. Think of an intricate handcrafted voxel diorama where hundreds of small voxel elements create furniture, plants, food, kitchen equipment, architecture and environmental decoration. Objects should have recognizable silhouettes and surprisingly intricate details despite being constructed entirely from voxels. The visual quality should feel like a premium modern voxel game with sophisticated lighting, rich animation potential and extremely dense environments.

**Camera.** A high 3/4 isometric gameplay camera, appropriate for controlling a character walking through the environment. Not a straight top-down view, not an eye-level cinematic camera, not a collage. One continuous playable environment.

**Visual identity.** Cozy, rustic, colorful, inviting. Reclaimed wood, warm stone, aged plaster, black iron, terracotta, handmade ceramics, colorful fabrics, abundant plants, baskets, wooden crates, glass jars, warm practical lighting. Entirely plant-based; grows many of its own ingredients.

**Color.** Rich, lively palette. Vegetables, herbs, sauces, dishes, flowers, ceramics and decorations provide strong splashes of color against warm natural architecture. No washed-out beige. Greens lush and varied. Food colorful and readable from the elevated camera.

**Lighting.** Sophisticated voxel lighting: warm indirect illumination, soft shadows, glowing practical lights, subtle atmosphere. Interiors warm golden; exteriors natural sunlight. Lamps, ovens, candles and windows make local pools of light.

**Gameplay readability.** Designed as a playable level: clear walking paths, recognizable station silhouettes, dense decoration that never confuses navigation. The player immediately understands where to walk, cook, harvest, interact or place objects.

**Animation potential.** Leaves and crops moving, steam from cooking equipment, bubbling pots, glowing ovens, flickering candles, hanging herbs swaying, water from sinks, rotating fans, fridge doors opening, cloth moving, irrigation sprinklers, butterflies and insects around crops, dust in sunlight, smoke, plants responding to harvest, lamps swinging, equipment operating. Objects should lend themselves to this without exaggeration in stills.

**Food.** Extremely important visually: vegetables, mushrooms, tofu, grains, legumes, herbs, potatoes, sauces, breads, colorful plant-based meals. Charming and appetizing, not photorealistic.

**Scale.** Consistent voxel scale throughout. Doors, counters, chairs, equipment and paths designed around small stylized characters. Slightly miniature, like a detailed living diorama, still a believable restaurant.

**Detail.** Tiny visual storytelling everywhere: stacked plates, baskets of vegetables, jars, utensils, folded towels, hanging pans, potted herbs, crates, watering cans, cookbooks, chopping boards, ingredient containers, wall decorations. Readability preserved.

**Never:** characters, UI, labels or text, multi-panel rooms, blueprints, painted or realistic concept art. Every visible object follows the same voxel aesthetic. The image should look like a screenshot from an extraordinarily polished voxel restaurant/farming game.

### The 15 areas (each a gameplay location)

1. **Dining room** — the customer heart. 8–10 mismatched handmade tables, 30–40 seats, clear waiter routes, host/reception near the entrance, waiter service stations, water station, plates and cutlery, a prominent pass toward the kitchen. Wooden floors, beams, stone/plaster, hanging lamps, plants, herbs, pottery, botanical art, farm references. Large windows onto greenery. Room to expand seating.
2. **Main kitchen** — the most important active area; the player cooks here beside AI chefs. Stovetops, ovens, grills/griddles, fryers, boiling stations, sinks, plating counters, stainless prep surfaces. Plant-based ingredients on show. Efficient workflow and clear movement. The ORDER PASS with a long counter and an overhead ticket rail is the key feature. Obvious empty spots for upgraded stations. Busy, capable, professional, still rustic.
3. **Prep kitchen** — before-service mise en place. Chopping stations, boards, knives, washing sinks, processors, blenders, mixers, scales, mandolines, containers, ingredient bins, sauce equipment, shelves of prepared components (chopped potatoes, sliced mushrooms, diced vegetables, washed herbs, tofu, grains, sauces, dressings, stocks, pickles, garnishes) in text-free containers. A large central island for several chefs.
4. **Walk-in fridge / cold storage** — beautiful, believable. Shelving and crates of harvested produce, mushrooms, herbs, tofu, sauces, mise en place. Transparent containers show quantities. Several refrigeration units, clear categories, fresh-from-the-farm produce. Inventory as gameplay: limited shelf capacity, physical space, unlockable racks.
5. **Dry pantry** — shelf-stable bulk goods. Wooden and metal shelving with jars, sacks, baskets, boxes: rice, flour, grains, beans, lentils, pasta, spices, nuts, seeds, oils, vinegars. Bulk low, frequent at working height. Weighing/inventory station. Empty slots show capacity.
6. **Farm** — the main playable farming area behind the restaurant. Rectangular plots with paths: potatoes, tomatoes, greens, carrots, onions, garlic, beans, zucchini, peppers, herbs, strawberries. Irrigation, watering points, tool storage, compost baskets, harvest crates, wheelbarrows. Mixed growth stages. Distinct, walkable, interactable plots. Unused edge land for expansion. Restaurant visible behind.
7. **Greenhouse** — a mid-game unlock. Glass and wood, organized beds, trellises, irrigation, seedling tables, hanging plants; tomatoes, peppers, herbs, delicate greens, premium ingredients; propagation trays, tools, substrate bags, baskets. Warmer, greener, slightly more technical, still rustic. Clear paths, interactable beds.
8. **Receiving + inventory** — rear service entrance. Delivery door, loading area, hand trucks, pallets, reusable crates, boxes, shelving, inspection/weighing table. Goods flow from here to dry storage, refrigeration and other rooms. A defined inventory-checking workstation. Functional, slightly utilitarian, still warm.
9. **Office / management** — the management hub visited at the start and end of each day. Wooden desk, computer, notebooks, calculator, filing cabinets, shelves, paperwork. A wall planning board (menu, staff, finances, ingredients, performance) with no readable text and exactly SIX menu-card slots (six dishes per day). Farm maps, recipe books, ingredient charts, pinned notes.
10. **Cleaning / janitor room** — compact: mop sink, utility sink, brooms, mops, buckets, reusable cloths, brushes, eco cleaners, spare bags, maintenance supplies, wall organisation. Sustainable identity. An inventory location.
11. **Dishwashing / dish pit** — between dining and kitchen, a real workstation. Dirty drop-off racks, scraping station, commercial dishwasher, deep sinks, drying racks, clean plate storage, glass racks, cutlery, waste sorting. One-direction flow: dirty → scraped → washed → dried → clean toward service. Room for a dishwasher NPC while staff pass. Functional, a little chaotic.
12. **Waste + recycling + compost** — rear. Separate recycling, general waste, glass, cardboard, used oil, and a substantial multi-stage compost system connected visually to the farm (scraps become compost become ingredients).
13. **Staff room** — lockers (enough for a big team), benches, hooks, storage, break table, kitchenette, coffee/tea, fridge, notice board, bathroom entrance. Lived-in, organised, personal touches.
14. **Herb / kitchen garden** — dense raised beds just outside the kitchen's back door: basil, parsley, coriander, mint, rosemary, thyme, sage, chives, edible flowers; scissors, small baskets, watering cans, a washing point. For herbs needed constantly during service. Exceptionally lush, every bed interactable.
15. **Service pass / waiter hub** — the nerve centre between kitchen and dining. Long wood-and-metal pass with heat lamps, plating surfaces, garnish containers, finished-dish spaces; a very prominent ORDER TICKET RAIL above; waiter pickup, dirty-item return, water, cutlery, napkins, spare plates. Several chefs on one side and several waiters on the other without blocking. Increasingly chaotic as customers arrive.

16. **Fermentation cellar** — a cool rustic production room where fermented and preserved plant-based ingredients are made over multiple days; a real playable area (start batches, inspect progress, harvest, manage limited capacity). Older and cooler architecture: thick warm-stone walls, aged beams, stone floor, wooden shelving, small high windows, warm lanterns — a traditional European cellar adapted into a fermentation workshop. Several clearly identifiable stations with walking space: large ceramic crocks, glass jars with colorful vegetables, wooden barrels, fermentation weights, cloth-covered vessels, temperature-controlled cabinets, prep tables, scales, funnels, ladles, strainers, shelves of clean empty jars. Products in parallel, each with its own silhouette: kimchi-style vegetables, sauerkraut, fermented carrots/radishes/cucumbers, tempeh incubation trays on temperature-controlled shelving (its own section), miso in large traditional crocks (long duration, its own section), kombucha vessels, sourdough starters, fermented hot sauces, preserved lemons and vegetables. A wall of glass jars at different stages (vibrant fresh → mature). A central wooden worktable with cabbage, vegetables, salt, spices, boards, scales, clean jars. The room communicates TIME: physical tags, hanging markers, vessel designs and shelving imply each batch's state (one day, several days, premium projects longer) — no UI or readable text. Capacity matters: few vessels early, racks/barrels/crocks/equipment through upgrades, believable empty spots. A small washing and sanitation station. Farm crates (cabbage, radishes, cucumbers, soybeans, peppers, herbs) arriving; finished products shelved before moving to kitchen and pantry. Atmosphere quiet and slightly magical — ingredients transform while the restaurant sleeps. Details: bubbles in jars, cloth covers, wooden lids, ceramic textures, stacked jars, handwritten-looking tags, dried peppers, garlic braids, tools, small plants at the windows. Animation: bubbling, kombucha liquid, swaying hanging ingredients, indicator lights on incubators, steam from sanitation, flickering lanterns. Same camera, style, scale and lighting as the rest.

### Where things are on the master plan (v4, 2026-09-06)

`docs/layout-reference.png` is the current plan (v4); `-v1` … `-v3.png` are earlier drafts. v4: compost moved to the north-west between the delivery yard and the fermentation cellar (three bays, wheelbarrow, rainwater tank); the north-east corner became farm plots and flowers; extra doors between the kitchen and the corridor. v3: receiving & inspection moved indoors to the west end of the back-of-house corridor (delivery yard outside), staff restrooms moved east between the staff area and cleaning supplies, two gates from the corridor to the herb garden. South: main entrance, dining room (host station west, service station east), the SERVICE PASS along the kitchen's south wall. Centre: kitchen with a large central island. A BACK OF HOUSE CORRIDOR runs east–west behind the kitchen and serves the north row (west→east): dry pantry, cold storage, prep kitchen, staff area, cleaning supplies. North of that row: the HERB GARDEN strip (beds along the building, gates to the farm), then the farm plots, the greenhouse (north-east) and compost (far north-east). Far north-west: the fermentation cellar. West wing: delivery & receiving (truck outside), staff restrooms, trash & recycling. East wing: dishwashing (kitchen's east wall) and the office. Trees, hedges, flower beds and lamps ring the compound; stone paths.

### Concept images (2026-09-06)

One 3/4-view image per area, generated from the prompt above, kept in `docs/concept/`: `01-dining-room`, `02-main-kitchen`, `03-prep-kitchen`, `04-cold-storage`, `05-dry-pantry`, `06-farm`, `07-greenhouse`, `08-receiving`, `09-office`, `10-cleaning-room`, `11-dish-pit`, `12-waste-compost`, `13-staff-room`, `14-herb-garden`, `15-service-pass`, `16-fermentation-cellar` (all `.png`, ~3 MB each, 48 MB total). They are references for dressing rooms and for judging renders, not assets. Review notes: camera pitch varies (office and cleaning room near top-down, dining and pass more oblique) — the game camera is one fixed pitch, so take composition, palette and prop density from them, not the angle; voxel density is highest in the pantry, cellar and pass; the dish pit and cleaning room read as the "utilitarian but warm" register the briefs asked for; the pass image (15) is the strongest single reference for the brigade mechanic (ticket rail, plating rhythm, waiter side).

---

## Part 4 — Look, animation and how assets are made

### Visual promise

Build a charming, highly readable block world inspired by the clarity of Crossy Road. The world is **voxel-styled**, not a voxel simulation: authored objects are assembled from modular cuboids and a few deliberately blocky wedges/cylinders. There is no destructible voxel terrain or runtime voxel meshing.

At normal gameplay zoom, a player must identify an ingredient, station state, staff role, or urgent problem in under one second.

### Recognition order

Every gameplay object communicates in this order:

1. **Silhouette:** recognizable in grayscale and at gameplay camera distance.
2. **Stable color family:** the same ingredient and status colors everywhere in the world and UI.
3. **Pose or motion:** animation communicates action and urgency.
4. **Icon/text:** labels confirm meaning; they do not rescue unclear world art.

Do not distinguish two items using only hue. Tomato is a round cluster with a green crown; wheat is a tall gold bundle; mushroom has a wide cap; soybean uses curved pod blocks; rice uses pale grain clusters; cabbage is a layered green head; avocado uses a dark pear silhouette and visible pit.

### Geometry rules

- Voxel styling does **not** impose one global cube resolution. Placement grid: 1 world unit.
  Architectural module: 0.25–0.5 units. Character detail pitch: 0.04–0.08 units.
- **Game scale: produce ×1.8, crop plants ×2.2, everything built ×1.0.** Models are authored at life
  size and scaled on the way into the catalog, because life size does not play. At the survey camera a
  real 7.9 cm bell pepper is **six pixels** wide and a 3.3 cm strawberry is three — the player cannot see
  ripeness, count, or that there is fruit at all. Scaled, they are 14.2 cm and 6.0 cm: large but plausible
  beside an unscaled 1.88 m freezer, and legible from across a plot. Plants went up again, from ×1.5 to
  ×2.2, after walking the finished farm: a row of crops at ×1.5 read as ground cover rather than as
  plants you tend. A ripe pepper bush is now 1.25 m and a cabbage 72 cm across, against a 1.2 m plot
  spacing — a farm you walk between rather than over.

  Scaling is applied by handing `voxels-to-model.mjs` a larger world height, so pitch grows with the
  object and the **voxel count is unchanged** — the model keeps exactly as many voxels across its width
  and therefore looks exactly as detailed, only bigger. `scripts/authored/build-crops.mjs` owns the
  multipliers; do not scale at runtime, and do not scale architecture, or the readability being bought is
  immediately given back.

- **Food and hero props: 1.5–5 mm.** This supersedes the original 25–50 mm band. That band produced the
  project's early `cabbage` (18 mm, 11,910 voxels) and `tomato` (26 mm, 1,588 voxels); crops authored at
  1.5–2.5 mm carry roughly twenty times the voxels and are what the fine detail — leaf veins, pale
  midribs, achene pits, colour banding within a single leaf — actually costs. The finer pitch is the
  standard now. Spend it on food and hero props only; architecture and characters keep their coarser
  modules, and the contrast between them is part of the look.
- A gameplay tomato is approximately 0.34–0.4 world units wide. Its hero/carry model should be 10–14 detail cells across, with a lobed body, flattened base, green crown and stem, and at least three red values. It must never be represented by one red cube.
- Characters use roughly 8–14 rigid pieces: head, hair/hat, torso, apron, two upper arms, two hands, two legs/feet, and optional tool/tray.
- Props use the fewest blocks that preserve their silhouette. Avoid invisible surface detail.
- Edges are crisp, with restrained bevels only on hero counters and stainless worktops where highlights improve readability.
- Major architecture follows the authored kitchen plan. Visual footprints and collision footprints must agree.
- No authored texture maps for ordinary world objects. Use shared flat materials, vertex/instance colors, lighting, shadows, and limited ambient occlusion.

#### Adaptive detail and mesh construction

Use three asset representations where repetition warrants it:

1. **Hero/action model:** highest block resolution for carried food, chopping, plating, selected stations, and close camera moments.
2. **Gameplay model:** medium resolution for crops, pass dishes, and nearby shelf stock.
3. **Crowd/stock model:** simplified silhouette for distant crops and large repeated shelf quantities.

Detail cells are an authoring language, not separate scene objects. At build time, remove hidden internal faces and combine exposed faces into one mesh using vertex colors. Repeated complete objects use instances. Only the few chunks participating in an animation become independent rigid meshes, then return to a pool.

A 0.02-unit pitch is reserved for small hero details where the normal gameplay camera can actually show the difference. Increasing geometric density everywhere would add memory and animation overhead without improving readability.

#### Authored voxel source format

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

#### Reference-to-model acceptance loop

No recognizable real-world asset is approved from memory or after a single modeling pass.

1. Gather several clear real-life references showing the object from the top, side, and three-quarter views. Identify its recognition anatomy before authoring: overall volume, major layers, attachment points, characteristic edges, and light-to-dark color structure.
2. Author those traits as deterministic named voxel parts. Spend detail on silhouette, overlap, veins/seams, and animation pivots—not uniformly across hidden volume.
3. Open the asset directly in Model Lab and inspect it from multiple angles, both close up and near gameplay size. Compare it beside the references rather than judging it in isolation.
4. Write a critical pass: what reads correctly, what reads as another object, what looks algorithmic, which parts intersect or float, and which details disappear at gameplay distance.
5. Revise and repeat the render/critique cycle until the object is immediately recognizable, structurally coherent from every useful angle, and expressive in motion. More voxels alone do not constitute improvement.
6. Validate the accepted asset in the actual game lighting, camera, animation, and crowded scene before calling it production-ready.

The author—not the player—is responsible for completing these iterations. Model Lab supports the process; it is not evidence by itself that an asset has passed.

#### The farming loop

Copied deliberately from Stardew Valley, because it is the best-solved version of
this loop and the player already knows it:

- **Break, water, sow, tend, pick.** Unbroken ground takes nothing. A sown plot in dry soil does not
  grow at all — growth is banked watered time, not elapsed time, so a plot nobody waters is a plot that
  has not moved. Watering lasts about half a day and the bed visibly dries out.
- **One key, and the tool decides.** The player picks a tool, not a verb, and the ground answers. The one
  deliberate difference from Stardew: a ripe crop is picked whatever is in hand, because swapping to bare
  hands to pick a plant you are standing over is a step that exists only because of how tools were
  modelled.
- **Every action throws something in the air.** A hoe that makes no dirt fly reads as a key press; a
  watering can that changes only a number reads as a menu. Each verb has its own burst, and a harvest
  throws the crop's own colour.
- **Fed soil looks fed.** Compost flecks the bed dark and speeds growth by a third; mulch pales it with
  straw and makes a watering last half again as long. Both are read off the ground, never off a panel.
- **An action is a commitment.** The work lands on the blow of the animation, not on the key press, and
  the farmer cannot walk out of his own swing. A bar fills over the plot for as long as the action lasts —
  the one kind of bar the rulebook allows, because it belongs to a focused interaction and disappears
  with it.
- **The tool is in the hand.** Each tool is modelled around its grip and hung on the farmer's hand
  socket, so the swing is a hoe swinging and not an arm waving.

- **Compost is made, not bought.** Every dish leaves trimmings; the trimmings rot in a bin; the bin feeds
  the soil that grows the next crop. That loop is what makes a farm-to-table restaurant one system rather
  than two, and it is why the compost tool spends a real item out of the player's hands.

- **The world is a one-metre grid and everything placed shares it.** Beds tile edge to edge across parcel
  boundaries, so a player can lay a solid field; a plot's id is its cell in the WORLD, so re-drawing a
  parcel never renames the ground inside it. R turns whatever is about to be placed and a translucent
  ghost of the thing itself — the bed, the sprinkler, the seedling — stands in the cell before the click.
  A preview answers which cell, which way round and how big; a coloured ring answers none of them.
- **The farmer looks at the THING, not at the floor under the cursor.** The camera is tilted, so the
  cursor's ground ray lands metres past whatever is being pointed at. He looks at the middle of the plot,
  at the board when he is working at it, at the bin he is tipping into — and at his own eye level in the
  cursor's direction when there is nothing in particular. His head is a separate joint from his body: the
  body says where he is working, the head says what he is watching while he works.
- **Anything placed can be taken back.** One tool undoes a plot: the plant first, then the bed under it.
  Two presses to undo what took two to make, which is exactly enough to make a mis-click cheap.

- **Late game must not be a click grind.** The replanting phase is where farming sims break down — the
  answer is automation, not faster clicking. The first of it: a sprinkler waters the four beds around it
  and a seeder re-sows them, both on their own clock, both working whether or not the player is watching.
  Automation removes the REPETITION and leaves the decisions — where to plant, what to plant, when to
  expand — because those are the parts anyone would miss. A device never does something the player could
  not, and never takes a plant the player has not finished with.

#### Living crop rule

Crop silhouettes follow the recognizable structure of the real plant, simplified for the camera. A tomato plot uses upright vines, alternating branches and leaves, fruit stems, and distinct fruit sites; it is not a row of red objects placed directly on soil.

- Each visible fruit owns its maturity state. Harvesting removes only the chosen ripe fruit.
- A growing fruit scales from zero at its persistent attachment point with a small overshoot before settling.
- Mature fruit uses no more than roughly 2% breathing/bounce, and the complete plant sways more slowly and less strongly.
- Ripening earns one short 3–5 cube confirmation burst. Mature crops may emit at most one ambient glint at long irregular intervals.
- Yield upgrades must visibly add plant bodies, branches, fruit sites, or fruit density. A numerical yield upgrade with no crop-model response is not acceptable.
- Plant motion is deliberately quieter than harvesting, cooking, ready stations, and urgent service states.
- **Idle life is the wind shader, never a looping clip.** A clip makes `decor.ts` promote the prop to an
  uncached rig at roughly 305 ms per placement, so a forty-plot farm would pay twelve seconds of load to
  get something the vertex shader does for nothing. A plant's sway weight is authored per part (or
  defaulted per plant) and graded by height in the mesher, so the tips stream and the base stays in the
  soil. Clips are for the things that ACT: harvesting, doors, machines.
- Picking is a scale to nothing over about 0.45 s and regrowth is the same scale coming back with a
  10–20% overshoot. Neither rebuilds geometry: one number drives every fruit on the plant.
- **One meshing per model, however many are standing.** A ripe cabbage is 277,000 voxels and costs a few
  hundred milliseconds to mesh; twenty-five plots that each meshed their own plants froze the page for
  nine seconds. Plants, fruit and stored goods all draw as hardware instances of one hidden source
  (`meshLibrary.ts`). Nothing is cheapened to pay for it — a plot does not need its OWN cabbage, it needs
  a cabbage.
- **The play camera is 3.2–34 m; surveying the site is a separate act.** Close enough to read a fruit,
  never so far out that the farm becomes a texture. `F` lifts the ceiling to frame the whole compound and
  zooming back in puts it down again.

- **A plant far from the player is data, not meshes.** Plots keep growing on the clock wherever they are;
  they are built when the player comes within about 26 m and taken down past 32 m, a couple per frame.

### Palette

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

### Professional kitchen style

- Central stainless prep/plating island with clearly separated chef bays.
- Perimeter hot line beneath oversized block-built extraction hoods.
- Rear sinks, refrigeration, shelves, and labelled ingredient bins.
- Warm tile, timber, plants, and copper cookware prevent the steel kitchen from becoming visually cold.
- Clean steel has a bright cool top and dark edge band; dirty steel adds sparse brown block clusters and reduced shine, never a noisy texture.

### Animation language

Animations are short, exaggerated, and pose-driven. The simulation remains smooth; visible limbs and props may use stepped 8–12 fps poses for charm.

#### Exaggerated motion rule

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

### World-first feedback rule

Every active gameplay object must communicate its state in the 3D world. A progress bar is supporting detail, never the only evidence that work is happening.

Use the strongest physically believable feedback available:

1. **Mechanical motion:** press descends, mixer turns, oven door opens, knife chops, dishwasher rack slides.
2. **Visible contents:** tomatoes become chopped pieces, soup level/color changes, fermentation jars bubble, plated components assemble.
3. **Worker action:** the assigned character aligns with a work position and performs the matching task animation.
4. **Particles/environment:** steam, crumbs, droplets, heat shimmer blocks, bubbles, cleaning foam, or grime removal.
5. **Indicator light:** for enclosed or mostly static appliances.
6. **Audio cue:** short loops and completion sounds reinforce, but never replace, visual feedback.

If a machine has an animatable mechanism, shipping it with only a timer or loading bar is not acceptable. Worker animations and station animations share event markers so hands, tools, ingredients, consumption, and output appear synchronized.

#### Universal state language

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

### Interface restraint

Normal gameplay has no permanent progress cards floating above every station, shelf, worker, crop, and customer.

- Hovering or approaching an object shows a compact one-line summary.
- Selecting/interacting opens a focused panel with recipe, exact inputs/outputs, queue, cleanliness, and remaining time.
- Urgent conditions may show one small world icon: blocked, dirty, broken, expiring order, or ready output that has waited too long.
- Management/inspection mode may deliberately reveal progress and capacity overlays for all relevant objects; leaving that mode hides them.
- Storage fill is communicated by visible stock first. Exact counts and bars live in the shelf interaction panel.
- **How many places an item takes is a property of the PLACES, not of the item.** The same cabbage covers
  one place on a wide prep board and four in a tight drawer, so a footprint is measured against the grid
  it is standing in. Measuring every grid by the first grid's spacing let a one-place plate define a
  six-place board, and the board silently refused a carrot it had ample room for while still counting it
  as held. A container that says it holds something must show it.
- Crops communicate growth through their model. Exact yield/progress appears on proximity or in Farm mode.
- Worker names and current tasks appear on hover, selection, or Staff mode. Debug balloons are not part of the normal presentation.

Panels should be anchored to screen edges where practical rather than overlapping the world object. Only one detailed object panel may be open at a time. Important dinner information—active orders, shift time, coins, reputation, and Recipe Points—remains persistently visible but compact.

### Picture-first interaction rule

The complete core loop must be understandable by a child who cannot read. Text may provide optional precision, accessibility, settings, and flavor, but it cannot be required to harvest, cook, plate, serve, clean, upgrade, or respond to an urgent problem.

- Teach interactions with animation, ghosted demonstrations, object highlights, arrows, and direct cause/effect.
- Use pictures of the actual voxel object, not abstract icons where a recognizable object exists.
- Never rely on color alone. Pair colors with silhouettes, pulse patterns, fill shapes, or position.
- Use repeated item pictures or large pips for small quantities. Numerals are an optional compact fallback.
- Use clock wedges, shrinking ticket borders, facial poses, and sound cadence instead of written seconds.
- Confirm actions through world response: an item moves, a machine reacts, a ticket stamps, or an upgrade visibly assembles.
- Core controls use direct manipulation: drag a chef portrait to a pictured station, place a dish card into a menu slot, and point at pictured pantry bins instead of configuring tables of checkboxes.
- Search fields, filter lists, and checkbox grids are not permitted in the normal play loop. Advanced management may expose optional detail, but it must not be necessary for competent play.

#### Physical order rail

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

#### Replacing management forms

- Menu: illustrated dish cards placed into one to six physical/menu-board slots.
- Recipes: ingredient pictures → station picture → dish picture.
- Storage: pictured bins or shelf zones; automatic stocking is selected by placing category/item tokens, with one visible “everything” basket token.
- Chef assignment: portrait tokens placed beside pictured work zones, with ordered priority tokens if needed.
- Farming: seed packets with crop pictures placed onto plot cards or directly onto plots.
- Upgrades: before/after model silhouettes plus coin cost; focused optional text explains exact statistics.

Use short names only as optional labels on focus. Localization should improve flavor and accessibility, not determine whether the game is playable.

### Particles and effects

Voxel particles are functional punctuation, not continuous decoration:

- Food fragments: 3–8 cubes.
- Pour streams: at most 10 visible cubes per stream.
- Steam: 2–5 pale translucent block puffs per cycle.
- Dirt/cleaning: persistent grime blocks plus brief cleaning sparkles.
- Upgrade: compact gold/green block burst.
- Never obscure interaction points, carried items, table orders, or worker silhouettes.

Reuse pooled particles and shared source meshes. Static repeated details such as floor tiles, chairs, crops, dishes, and shelf stock use hardware instances or thin instances where interaction is unnecessary.

### UI relationship

The 2D UI can remain smooth and typographic, but it shares the world palette and uses small voxel item portraits. Status bars and icons use both color and shape. World labels appear only for selection, urgency, or debugging; normal state should be readable from the model.

### Production constraints

- Establish the camera, palette, character proportions, and six core task animations before producing the full asset set.
- Validate every asset in the actual camera at normal zoom, not in a close-up model viewer.
- Target one shared material per palette color and aggressively reuse geometry.
- Prefer one vertex-colored mesh per finished prop over one mesh per detail cell. Draw-call count is a stricter budget than raw triangle count.
- Prefer TransformNode hierarchies and procedural clips over skeletons. Skeletons remain permitted only if a later hero animation demonstrably needs deformation.
- No ragdolls. Failures use authored block poses and particles.
- Performance budgets will be measured on a representative low-end mobile/browser scene before content production expands.
- Initial budgets: under 120 active draw calls during dinner, under 80k visible triangles at normal zoom, no more than 16 independently animated food fragments per task, and a stable 60 fps target on the representative browser test machine.

### First vertical slice

Build one polished shift containing the player, one Server, tomato crop, Stove, pass, one dining table, Tomato Soup, serving, dirty-table cleanup, and shift-end results. It must prove readability, animation timing, and pacing before the remaining restaurant assets are converted.

The slice must be understandable with station progress bars disabled. Bars may then be added to focused interaction panels for precision.

### External-model voxelization pipeline

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

---

## Part 5 — How the code is arranged

### Current architecture

| Path | Current responsibility | Status |
| --- | --- | --- |
| `index.html` | Vite game page; still contains legacy markup, but loads the new restaurant entry | Active shell with legacy residue |
| `src/restaurant-main.ts` | New farm-to-table art/gameplay proof | Active runtime |
| `src/restaurant-style.css` | Styling for new slice | Active |
| `model-lab.html` | Separate asset-inspection page | Active tool |
| `src/model-lab.ts` | Search/select/orbit/pan/zoom/auto-rotate inspection scene | Active tool |
| `src/model-lab.css` | Model Lab UI | Active tool |
| `src/game/restaurant.ts` | New restaurant catalog, progression, hygiene, staff, service, and pacing data | Active foundation; many systems not wired into runtime yet |
| `src/game/shift.ts` | Day-cycle state machine: Prep/Choose Menu/Dinner/Close phases, timers, menu slots, served/missed/waste/coins ledger | Active foundation; consumed by the runtime |
| `src/game/visual.ts` | Palette and visual contracts | Active foundation |
| `src/game/voxelModel.ts` | Authored JSON voxel expansion and validation | Active foundation |
| `src/game/voxelGeometry.ts` | Visible-face voxel mesher and winding | Active foundation |
| `src/game/tomatoPlant.ts` | Shared tomato foliage/fruit rig | Active proof asset |
| `src/game/cabbage.ts` | Shared layered cabbage animation rig | Active proof asset |
| `src/game/wheatPlant.ts` | Shared wheat cluster rig: stalk/leaf/head voxel construction, young/golden states, field sway | Active proof asset (level-2 crop; harvest gameplay pending) |
| `src/assets/food-models.json` | Authored tomato, tofu, cabbage model data | Active data; catalog incomplete |
| `src/game/*.test.ts` | Structural/catalog/visual contracts | Active tests |
| `src/game/inventory.ts` | Generic inventory primitives | Reusable foundation |
| `src/game/persistence.ts` | Small versioned localStorage helpers | Reusable foundation |
| `scripts/capture-model.mjs` | Headless deterministic Model Lab screenshot helper | Active developer tool |
| `world.html` / `src/world-main.ts` | The 3D compound: voxel level, decor, grass, wind, day/night, cutaway, rig cache | Active runtime |
| `src/game/levelBuilder.ts`, `levelLayout.ts` | Rooms, areas, walls and floors as voxel geometry | Active foundation |
| `src/game/surfaces.ts`, `surfaceLibrary.ts`, `surfaceCrust.ts` | Wall/floor materials as functions of world position | Active foundation |
| `src/game/grassInstances.ts`, `voxelWind.ts` | Instanced grass and the wind vertex shader | Active foundation |
| `src/game/decor.ts`, `worldRenderer.ts`, `sourceCache.ts` | Prop placement, instancing/LOD, IndexedDB geometry cache | Active foundation |
| `src/game/cropFruit.ts` | Places N fruit at a plant's `fruit_*` sockets, with per-instance size and lean | Active foundation |
| `src/game/crops.ts`, `hash.ts` | What grows, how long, what a harvest awards; deterministic yields | Active foundation |
| `src/game/cropPlanting.ts` | A plot: stage changes, fruit, picking, regrowth, ripening burst | Active foundation |
| `src/game/farm.ts` | Plot sites from the plan, what the action key does, the farm save | Active foundation |
| `src/game/farmPlots.ts`, `harvestCrate.ts` | The playable farm: sowing, harvesting, carrying, unloading | Active foundation |
| `src/game/recipes.ts` | What the kitchen can make, what it needs, what it is worth | Active foundation |
| `src/game/soil.ts`, `tools.ts` | Tilling, watering, fertiliser, and what the held tool does | Active foundation |
| `src/game/compost.ts`, `compostBin.ts` | Kitchen scraps rotting down into the farm's fertility | Active foundation |
| `src/game/automation.ts` | Sprinklers and seeders: the boring half of farming, done elsewhere | Active foundation |
| `src/game/placementGhost.ts`, `rangeHighlight.ts` | What you are about to place, and what a device reaches | Active foundation |
| `src/container-panel.ts` | Looking inside a crate, a bin or a counter, and taking things out | Active UI |
| `src/game/soilPatches.ts` | Worked ground drawn: one bed model, recoloured per state | Active foundation |
| `scripts/authored/props/farmer.py`, `clips/farmer.mjs` | The player: a rigged voxel farmer and his six clips | Active asset pipeline |
| `src/game/prepStation.ts` | The prep counter: a board, a plate, and a dish being made | Active foundation |
| `src/game/meshLibrary.ts` | One meshing per model, instances for the rest | Active foundation |
| `src/game/stageRig.ts`, `stageTransition.ts` | Cross-scale between a prop's age stages, and its easing | Active foundation |
| `src/game/storageDisplay.ts` | Socket grids, footprint packing, `placementAttitude` | Active foundation |
| `src/game/frameTimer.ts` | Honest sim/render split, gap distribution, long tasks | Active tooling |
| `scripts/authored/` | Blender authoring: `lib/botany.py`, per-plant scripts, socket extraction, part merging | Active asset pipeline |

**Removed.** A large fantasy farming/shop game once lived here — `src/main.ts` (5,994 lines),
`src/game/catalog.ts`, `src/game/farming.ts`, `src/style.css` and their tests, about 6,600 lines in all.
It was orphaned (not a Vite input, imported by nothing) and implemented a different product. If a search
turns up a reference to any of it, that reference is stale.

#### Important entry-point trap

`index.html` still carries a large body of legacy markup, but its script is `/src/restaurant-main.ts`,
which immediately replaces the contents of `#app`. Controls visible in that HTML are **not** the active
game UI. The markup should be cleaned out when something real replaces it.

There are two runtimes. `index.html` → `restaurant-main.ts` is the restaurant slice; `world.html` →
`world-main.ts` is the 3D compound where the level, decor, grass, wind and crop systems live. New world
and crop work belongs in the latter. Whether they converge, and in which direction, is not yet decided —
do not assume either answer.

### Model Lab

The Model Lab was requested so models can be judged independently from the game camera.

Implemented features:

- left-hand asset list;
- search;
- direct model URL such as `model-lab.html?model=cabbage`;
- orbit by drag;
- right-drag pan;
- scroll zoom;
- reset view;
- auto rotate;
- mesh/voxel/triangle/part statistics;
- playback for tomato and cabbage rigs;
- production geometry, materials, and rig functions rather than hand-made lab substitutes.

It is a diagnostic aid. A beautiful close-up is insufficient if the asset is unreadable in gameplay.

### Commands

From the workspace root:

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

Model capture:

```bash
# Start Vite and note its actual port, for example 5175.
npm run dev -- --host 127.0.0.1

# In another terminal:
npm run capture:model -- cabbage 5175 /private/tmp/model-lab-cabbage.png
npm run capture:model -- tomato_plant 5175 /private/tmp/model-lab-tomato-plant.png
npm run capture:model -- tofu 5175 /private/tmp/model-lab-tofu.png
```

The npm capture wrapper exists specifically to avoid repeated broad Chrome-execution approvals. Prefer it to handwritten raw Chrome commands.

Regression routine (canonical framings — keep them stable across builds so runs stay comparable):

```bash
npm run capture:regression -- 5173
# Writes .art-captures/regression/<timestamp>/ with:
#   cabbage-hero.png, cabbage-top.png, tomato-plant-lab.png,
#   tomato-fruit.png, tofu.png,
#   scene-overview.png, scene-plot-mature.png, scene-plot-sparse.png,
#   scene-dinner.png, scene-close.png
```

The gameplay scene accepts startup-only capture params (they never affect interactive play):

- `camAlpha`, `camRadius`, `playerX`, `playerZ` — camera/player framing;
- `proofStage=1` — replays the stage-0 harvest exactly as `interact()` does (two ripe sites picked, `carriedTomatoes = 2`, `stage = 1`);
- `proofPhase=choose_menu|dinner|close` — jumps the day cycle through the real transition functions (menu phase, dinner with one guest seated per table so tickets and markers are real, or the results card: 1 served / 1 missed / 1 wasted);
- `growth=<0..1>` — pins the scale of every not-yet-ripe fruit (mid-regrow states);
- `freeze` — pauses fruit regrowth so virtual-time screenshots hold the requested state.

Frames are near-deterministic (fixed params, virtual-time budget, frozen growth) except `Math.random()` sparkle particles — compare silhouettes and layout, not pixels. Note `URLSearchParams.get` returns `null` when a param is absent and `Number(null)` is `0`; the param parsing uses a guarded helper so an omitted param can never silently override an authored default (this exact bug used to force `camera.alpha = 0` on every normal load — invisible only because 0 happens to sit on the Q/E grid).

Balance sims (P2):

```bash
npm run sim:shift -- 5173 .art-captures/sim/run.jsonl 3 20
# 3 days at 20x time acceleration via a CDP-driven headless Chrome; prints a
# per-day table (seated/served/missed, fulfillment, avg wait, waste, coins,
# server serves) and writes the full JSONL. Autopilot params on the game URL:
#   autopilot=1 days=N simSpeed=N noRender=1 [mistake=S]  -- mistake freezes
#   the bot S seconds when the day's first guest seats (recovery testing).
# The sim never reads or writes the player's localStorage save.
```

Tuned values as of 2026-09-03 (constants in `src/restaurant-main.ts`): guest interval 8-11 s, up to 24 guests/dinner, patience 40 s, server rest 8-12 s; bot-measured 87-91% fulfillment, 10-15 s avg wait, 0 waste; with `mistake=25`: 82% then 95% recovery.

Useful discovery commands:

```bash
rg --files
rg -n "restaurantRecipes|menuSlotMilestones|dayStructure" src/game/restaurant.ts
rg -n "stage|rotateCamera|runRenderLoop" src/restaurant-main.ts
rg -n "createCabbageRig|cabbageLeafMotion" src/game/cabbage.ts
rg -n "createTomatoPlantRig|tomatoFruitSites" src/game/tomatoPlant.ts
```

### Verification checklist

For logic changes:

- [ ] Relevant test added or updated.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Catalog still has no cycles, missing ids, or >2-transform dishes.
- [ ] State transitions are authoritative and do not depend on stale UI proximity.
- [ ] Capacity cannot exceed its declared limit during enqueue, processing, restore, or collection.
- [ ] Automation preserves player agency.

For model changes:

- [ ] Multiple real reference images were used.
- [ ] Silhouette reads at gameplay scale.
- [ ] Front/back/side/top/low angles inspected.
- [ ] No missing front faces, visible interiors, accidental doubles, or z-fighting.
- [ ] Named parts and pivots correspond to real attachment/anatomy.
- [ ] Layers neither float apart nor swallow each other.
- [ ] Palette and highlights support form.
- [ ] Animation is visible at gameplay distance.
- [ ] Animation has anticipation/overshoot/stagger where appropriate.
- [ ] Idle movement remains quiet.
- [ ] Model tested in the actual scene after Model Lab approval.
- [ ] Draw calls/triangles remain plausible for repeated use.

For UI/interaction changes:

- [ ] Core action works without reading.
- [ ] Item pictures match the actual voxel objects.
- [ ] Color has a shape/motion redundancy.
- [ ] No permanent floating bar/list was introduced when world feedback can carry the state.
- [ ] Exact text/counts remain available on focus or accessibility mode.
- [ ] Ticket/table mapping is spatially clear.
- [ ] Camera rotation does not invert perceived WASD.

For balance changes:

- [ ] Tested across a complete shift, not a few seconds.
- [ ] Fulfillment, wait, waste, inventory growth, utilization, and player/staff action share recorded.
- [ ] Storage does not trend toward infinite surplus.
- [ ] One helper relieves a bottleneck without completing the game.
- [ ] The next useful upgrade is visible but not compulsory every minute.
- [ ] The experience still matches “I can almost keep up—what should I improve next?”

### Definition of done for the first vertical slice

The first slice is done only when all of the following are true in the same build:

- The player can complete one real Prep/Menu/Dinner/Close shift.
- The loop includes tomato harvesting, Tomato Soup cooking, shelf/pass handling, a guest, table service, dirty-table cleanup, and results.
- One Server is present and visibly useful but bounded.
- The menu is selected through a one-slot picture interaction.
- Orders are readable from the physical pass and matching table markers.
- A non-reading player can infer the complete loop from pictures, motion, and world response.
- Cooking and cleaning remain understandable with progress bars disabled.
- Camera and movement feel correct from every fixed 45-degree view.
- Simulation and animation event frames agree.
- Basic balance telemetry shows the target pressure instead of infinite surplus or passive play.
- Save/load does not corrupt queues, capacity, menu, or phase.
- The representative scene meets a credible performance budget.
- Tests and build pass.
- The user has visually reviewed the representative models and animation at gameplay scale.

---

## Part 6 — Lessons that must not be relearned

### The voxel face bug that must stay fixed

An earlier Model Lab screenshot showed the front faces missing while the inside of back faces was visible. The cause was triangle winding, not inverted voxel normal vectors.

Babylon’s default left-handed scene treats clockwise triangles as front-facing. `src/game/voxelGeometry.ts` now uses:

```ts
export function clockwiseQuadIndices(vertexStart: number): number[] {
  return [
    vertexStart,
    vertexStart + 2,
    vertexStart + 1,
    vertexStart,
    vertexStart + 3,
    vertexStart + 2,
  ];
}
```

A regression test protects it. Do not “fix” the appearance by disabling back-face culling or making materials double-sided, as that would conceal invalid topology and increase rendering cost.

### Camera and movement decisions

The user tried free camera rotation and disliked it. The old feel was better:

- follow the player;
- rotate around the player in fixed 45-degree increments;
- animate the transition;
- make WASD camera-relative;
- W moves visually toward the top of the screen;
- S moves visually toward the bottom.

The active slice implements Q/E rotation and scroll zoom. Preserve this unless the user explicitly changes direction. Any mobile/touch equivalent should respect the same discrete camera logic.

### Historical bugs and lessons

These occurred in the legacy implementation. Some will disappear through replacement, but the lessons remain useful.

#### Worker oscillation/pathfinding

A farm worker visibly moved back and forth dozens of times per second. Structured logs showed `approach_point_selected` recalculated nearly every frame after a one-node route emptied. Candidate positions alternated, for example between approximately `[-3.648,-7.15]` and `[-4,-7.08]`, while the worker x-position alternated around `-3.7/-3.8`. Recovery repeatedly selected the same unstable one-node route.

The issue was endpoint/approach-point thrashing, not simply an impassable A* map. General prevention rules:

- latch a chosen interaction approach while the target/task remains valid;
- use hysteresis before switching equally valid approach points;
- treat arrival tolerance separately from navigation node tolerance;
- do not clear and repick a one-node endpoint every render frame;
- base stuck detection on net progress toward a stable objective;
- recovery must choose a materially different route or settle the action;
- log target identity, latched approach, distance, route index, collision response, and switch reason.

Farming also needs navigation when obstacles constrain approach, but not endless A* recomputation for a nearby reachable crop.

#### Drying rack state corruption

Two legacy drying racks stopped: one showed 8/8 Violet Bloom without output; another showed 8/6 input. This exposed missing capacity invariants and possible mismatches between enqueue, processing, display, save restore, and collection. In the new game, every queue/batch invariant must be enforced in its domain layer and repaired/migrated on load.

#### Plant-button stale proximity

The legacy Plant button sometimes did nothing until the player moved away and came back. This suggests stale selected-plot/proximity UI state or event logic that refreshed only on enter/exit. New interactions should resolve their target and validate the action at press time; visuals may cache, authoritative interaction may not.

#### “Owned” counts

The user requested `(Owned: XXX)` beside legacy customer item requests to reveal whether a requested product existed. In the new picture-first design, preserve the underlying need without relying on a sentence: show owned servings through matching dish thumbnails/pips at the pass/menu, with exact text/count available on focus/accessibility.

#### Interaction geometry

Legacy lessons included:

- use physical collider distance, not center distance or oversized interaction circles;
- interaction range was expected to be about 0.5 beyond the collider;
- circular objects should use appropriate footprints/colliders;
- visually similar stations must have distinct silhouettes and animation;
- hide empty shelf rows rather than showing x0 clutter;
- stations must accept all eligible recipe materials, not a single arbitrary input.

Apply the intent when building restaurant systems, not the obsolete fantasy-specific names.

---

## Part 7 — Rules added since the original plan

These were established in later sessions and were not written down anywhere durable. They are rules, not
preferences.

### Reference images before modelling — always

Fetch real reference images and **look at them** before authoring any model. `curl` the image to a
scratch directory and open it with the file reader; Wikipedia's REST summary endpoint
(`/api/rest_v1/page/summary/<Page>`) gives a usable lead image, and Wikimedia Commons is CC-licensed and
fine for reference.

This exists because six herb bunches were once generated from a single parametric generator and came out
anatomically identical — the same four-to-seven unbranched stems fanning from a tied point, differing only
in leaf shape and colour. The references showed what guessing had missed: rosemary's needles sweep **up**
its stems and it carries pale blue flowers; thyme **branches** into fine fractal twigs, and that
twigginess is its whole identity; oregano is a slender reddish stem with opposite branch pairs and
terminal flower clusters, not a leafy hanging fan.

Botanical prose is not enough. It gives correct leaf *dimensions* but never says which way the leaves
point or how the stems branch — the things that make a plant recognisable.

**Shared primitives generalise. Anatomy does not.** A leaf function, a tube, a paint helper: reusable.
A plant's skeleton: written per species, never inherited from a sibling.

### Nothing is stamped out

Every placed instance varies in **size and attitude**, deterministically from its seed and index so a
plant is identical across saves but never looks repeated.

- Harvested items scale roughly 0.85–1.15×, non-uniform where it suits the object.
- Nothing stands plumb. Shelved goods lean about 5 degrees — they are resting on a surface, not falling
  off it. Fruit on a plant leans about 12, because it hangs at whatever angle it grew at.
- `placementAttitude()` in `src/game/storageDisplay.ts` is the shared implementation; use it rather than
  rolling another.

The same principle applies to surfaces: never a flat plane. Added 3D elements or varied element heights,
always with randomness within a surface.

### Performance is not paid for with quality

Never fewer voxels, shorter draw distance or thinner detail to gain frame rate. The answers available are
instancing, LOD that collapses rather than thins, baking, caching, typed arrays and workers. This game is
a voxel game and should run on any machine without looking like less of one.

This does not conflict with Part 0. Part 0 governs size, count and timing; this governs fidelity.

### Emissive voxels carry their own colour

A lit part's voxels must be coloured as lit. The bloom is only a halo — it dies with distance and in
daylight, so a part that relies on the glow layer for its colour reads black at range and washed out at
noon.

### Storage is grid-based on real size

Containers pack by footprint derived from an item's true width and depth (`footprintFor` in
`storageDisplay.ts`), so sixteen strawberries and one melon occupy correctly different areas with nobody
hand-tuning a number. An item's authored dimensions are therefore load-bearing, not decorative.

### Crops carry sockets, not fruit

A plant model holds `fruit_0`…`fruit_n` sockets at the points where fruit actually hangs, and the game
places however many the crop yielded. One plant model serves every yield count, and the fruit model is
the same one that sits in a crate afterwards. Harvesting is a **scale**, not a rebuild.

Idle motion is the wind shader, never a looping clip: a clip promotes every planted crop into an
individually meshed rig, which is the difference between free and a load-time stall.

### Verification is visual

Automated tests validate structure. They cannot approve beauty or recognition. Render the thing, look at
it, and compare it with the reference rather than with the previous bad version. Never assert how
something looks from data.

---

## Part 8 — Working preferences

### User collaboration preferences

The user is highly engaged, visually observant, and comfortable iterating. Useful working assumptions:

- They prefer a decisive recommendation with concrete reasoning over vague option dumping.
- They welcome grounded research into successful games and real-world source material.
- They do not want novelty for novelty’s sake; tested, recognizable formulas are preferred.
- They care deeply about pacing and whether the game remains fun after an hour.
- They notice spatial, animation, silhouette, and layer-overlap problems quickly.
- They expect the model author to inspect its own work critically and iterate through several passes.
- They approve early art foundations when those foundations affect later production cost and readability.
- They do not expect every model to be “final” before the game loop exists; they do expect production-direction quality for representative proof assets.
- They prefer concise status updates during work and clear implemented/planned distinctions at handoff.
- Avoid repeatedly asking for authorization for the same safe visual-capture workflow. Use the approved npm script.

Do not flatter or agree reflexively. If an idea conflicts with the north star, point to the concrete pacing/readability consequence and suggest the smallest coherent alternative.
