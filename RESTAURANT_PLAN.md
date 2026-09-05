# Farm-to-Table Restaurant — Locked Design Plan

## North star

Every system should create the feeling: **“I can almost keep up—what should I improve next?”**

The player should understand every ingredient and recipe at a glance, make meaningful trade-offs under dinner pressure, and recover from mistakes without the simulation solving itself.

## Daily loop

1. **Prep (4 real minutes):** harvest, cook, start fermentation batches, arrange the kitchen, and assign chefs. No ordinary customers arrive.
2. **Choose menu (untimed):** select recipes and planned quantities. The menu starts with one slot and grows to six.
3. **Dinner (4–5 real minutes):** customers request only active-menu dishes. Farming and cooking remain available, creating the central triage decision: serve, restock, or harvest.
4. **Close:** show sales, missed orders, waste, bottlenecks, recipe mastery, and unlock progress. Plated dishes expire; ingredients and prepared components persist. Fermentation advances by one day.

## Content rules

- Seven recognizable crops: tomato, wheat, mushroom, soybean, rice, cabbage, avocado.
- Four kitchen stations: Prep Counter, Stove, Oven & Grill, Culture & Press Station.
- A product may require at most two physical transformations from crop to served dish.
- Pantry staples such as water, oil, salt, spices, starter culture, and nori are abstract and never carried.
- Fermentation is batch planning, not moment-to-moment carrying: tofu is same-day; tempeh and vegan kimchi take 2 days; sauerkraut takes 3; miso takes 4.
- Culture & Press starts with two batch slots. Upgrades add slots, improve yield, then reduce duration by one day (minimum one).

## Restaurant layout

Use an **authored kitchen with expandable modules**, not free placement for major production stations. A restaurant should read immediately as a kitchen, and fixed work zones let customer pacing, chef capacity, animation, and navigation be balanced reliably.

- The Stove, Prep Counter, Oven & Grill, kitchen island, pass, and fermentation cellar occupy predetermined upgrade anchors.
- The starting kitchen is compact. Island upgrades make it physically larger and add a second chef work position before increasing raw speed.
- Counter/pass upgrades add service positions. Dining-terrace upgrades add seats and customer capacity in visible stages.
- Shelves, bins, counters, and small utility furniture remain movable within valid zones. This retains useful layout decisions without allowing impassable station mazes.
- Moving or selling a core station is replaced by upgrading its module. Existing buy/sell/move code remains useful for movable furniture and temporary equipment.

### Fermentation cellar

Multi-day production lives in a small dedicated cellar/warehouse reached from the kitchen. It unlocks with cabbage and begins with two batch positions. Players see labelled jars/crocks and “ready in N days” rather than carrying indistinguishable intermediate items around the restaurant.

Cellar upgrades follow authored stages: add rack space → improve batch yield → reduce duration by one day (minimum one) → add premium ageing space. Batches persist between days and never occupy serving-shelf capacity until collected.

## Tutorial and progression

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

## Economy and staffing

- **Coins:** equipment, layout, seeds, wages, and chef training.
- **Reputation:** level/unlock eligibility; earned by fast, complete service and lost through missed customers.
- **Recipe Points:** unlock recipes. This replaces Astral Cores.
- Chefs specialize as Gardener, Prep Cook, Line Cook, Server, or Head Chef/generalist. Roles improve relevant work; they do not create exclusive permissions.
- Automation should relieve one bottleneck, not run the restaurant. A normal player should serve 80–90% of demand; excellent play can approach 100%.

## Capacity and pacing targets

- Serving shelves: 12 / 24 / 40 slots.
- Healthy station utilization: 85–92% immediately before an upgrade, 70–80% immediately after.
- Customer patience: one full production cycle plus walking time plus roughly 25% decision margin.
- Waste/discard target: below 2% of produced units.
- Upgrade payback targets: minor 3–5 min; station 8–12 min; chef 10–15 min plus wages; crop/recipe 15–25 min; extra counter 30–45 min.
- The restaurant has one authored host/pass counter. Upgrades widen it and add service positions; they do not create independent customer spawners.

## Dining room progression

Dining upgrades replace the old “buy another counter to double arrivals” model. They should increase opportunity and workload in controlled, legible steps:

- **Tables and seats** cap simultaneous parties; reputation and the chosen menu drive arrival demand.
- **Better chairs** add a small patience/comfort bonus, never production speed.
- **Lighting, plants, and tableware** improve tips and reputation quality rather than raw capacity.
- **A wider pass/host counter** adds a service position and reduces handoff congestion.
- **Cleaning capacity** determines how quickly tables become reusable after guests leave.

The starting restaurant should be modest and worn but clean. Cockroaches are not a purchasable “bad starting tier.” They appear only as feedback when hygiene is neglected or dirty tables remain too long, reducing patience, tips, and reputation. This makes cleanliness a recoverable service problem instead of an unpleasant permanent theme.

## Guest standards and awards

Guest tiers unlock through published standards rather than random wealth rolls:

- **Neighbors** have no entry requirements and establish the basic service loop.
- **Food enthusiasts** require a small reputation and at least two consistently mastered recipes.
- **Celebration diners** require a comfortable dining room, strong cleanliness, and reliable service. They order higher-value dishes and tip well.
- **Culinary travellers** require a Garden Guide award plus high menu quality and cleanliness. Their visits are uncommon, valuable, and reputationally risky.
- **Critics and VIP bookings** announce some requirements in advance, creating a preparation objective instead of an unavoidable surprise.

The fictional **Garden Guide** avoids directly reproducing a real commercial award. Its Recommended and one-to-three Garden Star levels judge only cuisine: ingredient quality, recipe mastery, menu harmony, value, and consistency across several services. Cleanliness, comfort, and service do not create stars, but they independently determine whether demanding guests will book.

Inspections become available after meeting visible criteria. The player chooses when to request one, pays a modest application cost, and receives a report even after failure. Awards can be retained only through continued consistency; one poor shift is recoverable and does not immediately remove a star.

## Cleaning and maintenance

Cleaning is a real capacity trade-off but should not become constant clicking:

- Cooking creates station grime; customers create dirty tables; occasional spills create urgent local jobs.
- Each dirty station or table is a visible task. The player can clean it directly, or assign a **Kitchen Steward** to dishes, surfaces, floors, bins, and table turnover.
- Other chefs may clean when idle, but slowly. A steward specializes in cleaning and hauling and is not called a “chef cleaner.”
- Cleaning supplies are one pantry resource measured in uses, not several carried shelf items. They have a recurring operating cost and can be automatically reordered.
- Stainless surfaces, a commercial dishwasher, washable floors, better extraction, larger bins, and pest control reduce grime or cleaning time through authored facility upgrades.
- Closing includes a short cleanup window. Remaining grime persists into the next day, so skipping cleanup buys prep time now at tomorrow’s cost.

Use one 0–100 hygiene score backed by localized tasks. Above 80 is excellent; 60–79 is acceptable; 30–59 blocks demanding guests and inspections; below 30 risks visible pests and serious reputation loss. Stations below a critical cleanliness threshold lose speed and dish quality until cleaned.

## Table service

The full service chain is **kitchen station → pass counter → player/server → dining table → dirty table → steward**. During the opening shifts the player performs every handoff, making the value of the first Server immediately understandable.

- Completed dishes wait in limited pass slots. A full pass blocks plating but does not stop unrelated prep work.
- Servers reserve an order before collecting it so two people never chase the same plate or table.
- A server carries a small tray of compatible table orders and chooses a short sensible route.
- Guests waiting for food lose patience; guests who have received food occupy their table for a short dining period.
- After departure, the table cannot seat another party until cleared by the player, a Server, or a Kitchen Steward. Servers clear tables when no food is waiting; stewards prioritize cleaning.

Tips belong to the restaurant and are calculated from the bill. Fast service, waiter hospitality, chair comfort, décor, cleanliness, and food quality improve the tip; long waits, grime, mistakes, and pests reduce it. A skilled Server therefore earns more through better service, but never creates money simply by standing nearby. Their wage and limited tray capacity keep hiring from being an automatic decision.

Server progression improves three readable attributes: **Pace** (movement), **Tray** (carrying capacity), and **Hospitality** (patience recovery and tip quality). Hospitality has a capped effect so recipe quality remains the primary source of restaurant prestige.

Customer requests are physical picture tickets on the pass counter, not a permanent side-screen list. Dish pictures, quantity pips, matching table markers, patience wedges, served stamps, and reservation tokens communicate the full order state without reading. The rail expands with dining capacity and prevents new seating when full.

## Visual direction

Use a professional open-kitchen silhouette inspired by MasterChef workstations and contemporary restaurant kitchens:

- Brushed stainless-steel counters with softened edges and clear, chunky forms suitable for the isometric camera.
- A central prep/plating island with one worker position per unlocked bay.
- Perimeter hot line: stove and Oven & Grill beneath large extraction hoods.
- Refrigeration, sinks, and organized ingredient shelving along the rear run.
- The front pass/host counter visually frames the kitchen and separates production from dining.
- Broad, unobstructed circulation lanes around the island; station interaction points face those lanes.
- Warm wood, tile, plants, and copper cookware in the architecture keep the room welcoming rather than laboratory-cold. Steel communicates professionalism; warm accents preserve the farm-to-table identity.

The kitchen grows through authored visual stages: compact neighborhood kitchen → expanded central island → longer hot line and pass → polished open restaurant kitchen. Each upgrade changes the model and adds an operational position, so progression is visible without filling the room with unrelated machines.

The entire world follows the block-built visual and animation rules in `ART_DIRECTION.md`. This art foundation is part of the first vertical slice, not a final polish pass.

Production state is world-first: synchronized machine, worker, ingredient, particle, and indicator animations communicate work continuously. Permanent floating station bars are removed from normal play; precise progress appears through proximity, selection, or management mode.

The core game is picture-first and must remain playable without reading. Large lists, filters, tables, and checkbox grids are replaced by direct manipulation of illustrated dish cards, ingredient tokens, chef portraits, seed packets, and physical world objects. Optional focused text provides detail without carrying the interaction.

## Implementation order

1. Establish and validate the restaurant catalogue and progression data.
2. Prove the voxel-styled palette, character, animation, and service-loop vertical slice; then build the authored kitchen/cellar shell and migrate fantasy content.
3. Add reputation, Recipe Points, recipe unlocks, and the guided first-shift tutorial.
4. Add Prep → Menu → Dinner → Close phases and menu-limited customer requests.
5. Add persistent multi-day fermentation batches.
6. Convert workers to chef roles and rebalance automation, shelves, customers, and economy.
7. Use balance telemetry and repeated full-shift playtests to tune pacing.

## Save migration policy

Before switching runtime content, retain the old save reader. On first load, back up the legacy payload, convert old stock by production stage, refund removed station purchases, retain coins/upgrades/play time, and write the new version only after validation succeeds. Unknown items are converted to coins rather than silently deleted.
