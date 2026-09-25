# Roadmap

What is built, what is next, and why in that order. The rulebook (`docs/RULEBOOK.md`) says what the game
IS; this says what is left to make it. Written 2026-09-25, and meant to be edited rather than admired.

---

## Where the game actually is

Playable today, end to end: **break ground → water → feed → sow → tend → pick → carry → unload →
prep → plate**. A rigged farmer does the work with a tool in his hand and the work lands on the blow.
Soil holds water and fertility, plants bank only watered time, compost is made from the kitchen's own
scraps, and sprinklers and seeders do the boring half while the player is elsewhere.

Not built: money, customers, days, staff, inventory beyond an armful, audio, weather, and a UI that is
anything but HTML over the top of the world.

**The honest summary: the farm is a game and the restaurant is a diorama.** One dish exists, nobody eats
it, and nothing is worth anything. That gap is what decides the order below.

---

## The order, and the argument for it

### 1. Close the loop before widening it — service, money, and a day

Nothing in the game currently answers "why". A dish goes into the player's hands and stays there. Until a
customer eats it and pays for it, every system added is a system with no consequence, and every balance
decision is a guess.

- A pass, a table, a customer who orders, eats, pays and leaves.
- Money, prices from `recipes.ts`, and a day that ends with a reckoning.
- Reputation as the slow variable: better dishes, happier customers, more customers tomorrow.

**This unblocks quality.** The fertiliser-grade idea only means something once a better tomato is worth
more money to a happier customer — the chain has to be closed before it can be graded. It also gives
every later system a scoreboard, which is the only honest way to balance one.

### 2. Player inventory, and the item as a first-class thing

Today the player carries a flat array and the world pretends. Before staff, shops or quality grades,
items need: a stack, a place to put them (bag, chest, fridge), a way to move them between places, and a
grade on each one.

This is also where **quality** lands: `{ item, grade }` rather than `item`. Fertiliser grade → crop grade
→ dish grade → price and reputation. Doing it at the same time as the inventory rewrite is one migration
instead of two.

### 3. The voxel UI

Everything on screen is HTML today. The plan is voxel fonts, voxel menus, and world-space highlights that
pulse instead of a flat ring. This is a big, self-contained piece of work with a clear boundary, and it
should happen **after** the systems above so it is built once against a known set of screens rather than
three times against a moving one.

Sequence within it: world-space selection and highlights first (they are gameplay, not chrome), then the
HUD, then menus. A voxel font is a real asset: one 5×7 glyph set, instanced, with a fallback to HTML for
long text until it is proven legible at the game camera.

### 4. Staff, and then AI staff

The NPC chef system is the biggest idea in the pile and the most dangerous. Split it:

- **Staff as machines.** Hire a chef, assign them a station, they work it. Traits and proficiency as
  plain numbers. This is a scheduling game and it can be very good on its own.
- **Staff as characters.** Only once the above works: an AI model driving intent, chatter between chefs,
  the player asking for things in words.

The failure mode to design against, loudly: **an AI chef that does the wrong thing is worse than a dumb
chef that does the right thing.** Every AI-driven action should be expressible as something the player
could have ordered explicitly, and the player must always be able to see WHY a chef did something. The
model chooses among the game's verbs; it does not invent new ones.

### 5. Polish passes, continuous rather than at the end

- **Animation and particles** everywhere, not just the farm: the kitchen, service, doors, weather.
- **Weather**: rain that waters every plot (and makes the watering can a morning chore rather than a
  daily one), fog that closes the view distance, thunder. Storms as events with consequences, not
  wallpaper.
- **Audio last**, as agreed — but reserve the hooks now: every action already fires an event at its
  impact, which is exactly where a sound goes.

---

## The pipeline, carried forward

Things already promised and still owed:

- **Crop roster**: brassicas, roots, alliums, squashes, pulses, grains, mushrooms, soy. Each needs both
  forms — staged plant and produce item.
- **Recipes**: one dish exists. The rulebook's two-transformation limit and the station families are
  waiting on the kitchen being playable.
- **Fermentation cellar**: the sixteenth area, and the only one that makes multi-day time matter.
- **Performance ledger**: typed-array mesher, level bake cache, `sampleClip` allocation, workers. Nothing
  is slow yet; revisit when a full compound with staff is running.
- **Thumbnails** for the authored catalog, so the hotbar and menus can be picture-first rather than
  coloured chips.

---

## Suggestions of my own

Offered because they are cheap relative to what they add, not because the game is short of ideas.

1. **A day that ends.** The single highest-value addition after service. A day gives watering a rhythm,
   makes sprinklers a real saving, gives compost a schedule, and turns "grow, cook, serve" into a loop
   with a beginning and an end. Everything else balances against it.
2. **Rain, early.** It is the cheapest system in the list and it changes farming more than any tool:
   watering becomes a decision about the forecast rather than a chore. It also sells the world.
3. **Seed as an item, not a verb.** Seeds are free today. Making them a real item makes the seeder
   meaningful (it consumes stock), makes a shop necessary, and makes crop choice a commitment.
4. **A ledger the player can read.** Where the money went, what sold, what spoiled. This game is a
   management game; the spreadsheet is the fun, as long as it is expressed in pictures.
5. **Let the farm be legible from the air.** A survey view that shows water, fertility and ripeness as
   colour over the plots. Stardew players build this in their heads; showing it is kinder and is a natural
   fit for the voxel-highlight work.
6. **One animal, eventually.** Not a menagerie — chickens or bees. Bees are the better fit for a vegan
   restaurant argument-free: pollination bonus, a hive prop, honey-free. It gives the farm a second
   rhythm without a second economy.
7. **Spoilage.** Produce that sits in a crate for days should not be as good as produce picked this
   morning. It gives cold storage a job, makes the walk-in worth building, and makes "harvest on the day
   you cook" a real strategy rather than a flavour text.

---

## What I would NOT do yet

- **Multiplayer.** It doubles the cost of every system above.
- **Procedural anything.** The game's charm is authored; generated content would dilute exactly the thing
  that makes it worth looking at.
- **A skill tree.** Upgrades belong on objects the player can see — a better hoe, a bigger sprinkler, a
  second oven — not on an abstract menu. The rulebook's picture-first rule points the same way.
