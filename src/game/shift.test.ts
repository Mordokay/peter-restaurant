import test from "node:test";
import assert from "node:assert/strict";
import {
  addTicket, averageWaitSeconds, bankDayEarnings, chooseMenuSlot, closeDay, createShift, endDinner,
  expirePlatedFood, buildShiftSave, maxPlannedServings, menuEligibleRecipeIds, migrateShiftSave, nextDay,
  openForDinner, recordMissedGuest, recordServed, recordWaste, serveTicket, servingShelfCapacity,
  setPlannedServings, startDinner, stockShelf, takeServing, tickShift, ticketById, waitingTickets,
} from "./shift.ts";
import { dayStructure, restaurantRecipes } from "./restaurant.ts";

test("a shift starts in timed prep with an empty single-slot menu", () => {
  const shift = createShift();
  assert.equal(shift.phase, "prep");
  assert.equal(shift.phaseSecondsRemaining, dayStructure.prepSeconds);
  assert.equal(shift.menuSlots, 1);
  assert.deepEqual(shift.menu, []);
});

test("prep can end early by opening the doors, or by the timer", () => {
  const opened = openForDinner(createShift());
  assert.equal(opened.phase, "choose_menu");

  let timed = createShift();
  timed = tickShift(timed, dayStructure.prepSeconds - 1);
  assert.equal(timed.phase, "prep");
  timed = tickShift(timed, 1);
  assert.equal(timed.phase, "choose_menu");
  assert.equal(timed.phaseSecondsRemaining, 0);
});

test("dinner cannot start until every menu slot holds a choice", () => {
  let shift = openForDinner(createShift());
  shift = startDinner(shift);
  assert.equal(shift.phase, "choose_menu");
  shift = chooseMenuSlot(shift, "tomato_soup");
  assert.equal(shift.menu.length, 1);
  shift = startDinner(shift);
  assert.equal(shift.phase, "dinner");
  assert.equal(shift.phaseSecondsRemaining, dayStructure.dinnerSeconds);
});

test("menu slots refuse duplicates and overflow", () => {
  let shift = openForDinner(createShift());
  shift = chooseMenuSlot(shift, "tomato_soup");
  shift = chooseMenuSlot(shift, "tomato_soup");
  assert.equal(shift.menu.length, 1);
});

test("served plates pay the catalog sale value; misses count only at dinner", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  const coinsBefore = shift.coinsEarned;
  shift = recordServed(shift, "tomato_soup");
  assert.equal(shift.servedByRecipe.tomato_soup, 1);
  assert.ok(shift.coinsEarned > coinsBefore);

  const notDinner = recordMissedGuest(openForDinner(createShift()));
  assert.equal(notDinner.missedGuests, 0);
  shift = recordMissedGuest(shift);
  assert.equal(shift.missedGuests, 1);
});

test("the dinner clock expires into close and closing snapshots the day", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  shift = recordServed(shift, "tomato_soup");
  shift = tickShift(shift, dayStructure.dinnerSeconds + 5);
  assert.equal(shift.phase, "close");
  const results = closeDay(shift);
  assert.equal(results.day, 1);
  assert.equal(results.servedByRecipe.tomato_soup, 1);
  assert.ok(results.coinsEarned > 0);
});

test("dinner can also close by hand before the clock runs out", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  shift = endDinner(shift);
  assert.equal(shift.phase, "close");
  assert.equal(shift.phaseSecondsRemaining, 0);
  assert.equal(endDinner(shift).phase, "close"); // idempotent, never re-opens
});

test("waste accumulates across phases and never accepts negative servings", () => {
  let shift = recordWaste(createShift(), 2);
  shift = recordWaste(shift, -1);
  assert.equal(shift.wastedServings, 2);
});

test("next day returns to timed prep with a fresh ledger", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  shift = recordServed(shift, "tomato_soup");
  shift = tickShift(shift, dayStructure.dinnerSeconds);
  const dayTwo = nextDay(shift);
  assert.equal(dayTwo.day, 2);
  assert.equal(dayTwo.phase, "prep");
  assert.equal(dayTwo.phaseSecondsRemaining, dayStructure.prepSeconds);
  assert.deepEqual(dayTwo.servedByRecipe, {});
  assert.equal(dayTwo.coinsEarned, 0);
});

test("the shelf stocks, serves, and never goes negative", () => {
  let shift = createShift();
  shift = stockShelf(shift, "tomato_soup", 2);
  assert.equal(shift.shelfServings.tomato_soup, 2);
  shift = takeServing(shift, "tomato_soup");
  assert.equal(shift.shelfServings.tomato_soup, 1);
  shift = takeServing(shift, "tomato_soup");
  shift = takeServing(shift, "tomato_soup");
  assert.equal(shift.shelfServings.tomato_soup, 0);
});

test("shelf capacity is enforced in the domain and overflows to waste", () => {
  let shift = createShift();
  shift = stockShelf(shift, "tomato_soup", servingShelfCapacity + 3);
  assert.equal(shift.shelfServings.tomato_soup, servingShelfCapacity);
  assert.equal(shift.wastedServings, 3);
});

test("plated leftovers expire at close and count as waste", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  shift = stockShelf(shift, "tomato_soup", 2);
  shift = takeServing(shift, "tomato_soup"); // one leaves the shelf on the tray
  shift = recordServed(shift, "tomato_soup"); // ...and reaches the guest
  shift = endDinner(shift);
  shift = expirePlatedFood(shift);
  assert.deepEqual(shift.shelfServings, {});
  assert.equal(shift.wastedServings, 1);
  const results = closeDay(shift);
  assert.equal(results.wastedServings, 1);
});

test("tickets wait, pay on serve, and walk out when patience expires", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  const first = addTicket(shift, "tomato_soup", 1, 45);
  const second = addTicket(first.state, "tomato_soup", 2, 45);
  assert.equal(waitingTickets(second.state).length, 2);

  shift = serveTicket(second.state, first.ticketId);
  assert.equal(ticketById(shift, first.ticketId)?.status, "served");
  assert.equal(waitingTickets(shift).length, 1);
  assert.equal(shift.servedByRecipe.tomato_soup, 1);
  // Double-service of the same ticket is impossible.
  const twice = serveTicket(shift, first.ticketId);
  assert.equal(twice.servedByRecipe.tomato_soup, 1);

  shift = tickShift(shift, 50);
  assert.equal(ticketById(shift, second.ticketId)?.status, "missed");
  assert.equal(shift.missedGuests, 1);
});

test("closing time resolves still-waiting tickets as missed", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  shift = addTicket(shift, "tomato_soup", 1, 45).state;
  shift = tickShift(shift, dayStructure.dinnerSeconds + 1);
  assert.equal(shift.phase, "close");
  assert.equal(shift.missedGuests, 1);
  assert.equal(waitingTickets(shift).length, 0);
});

test("planned servings adjust only in the menu phase and stay clamped", () => {
  const menu = openForDinner(createShift());
  let shift = chooseMenuSlot(menu, "tomato_soup", 2);
  shift = setPlannedServings(shift, "tomato_soup", 3);
  assert.equal(shift.menu[0]?.plannedServings, 3);
  shift = setPlannedServings(shift, "tomato_soup", 99);
  assert.equal(shift.menu[0]?.plannedServings, maxPlannedServings);
  const dinner = startDinner(shift);
  const frozen = setPlannedServings(dinner, "tomato_soup", 1);
  assert.equal(frozen.menu[0]?.plannedServings, 3);
});

test("average wait comes from served tickets only", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  assert.equal(averageWaitSeconds(shift), null);
  const seated = addTicket(shift, "tomato_soup", 1, 45);
  shift = tickShift(seated.state, 20);
  shift = serveTicket(shift, seated.ticketId);
  assert.ok(Math.abs((averageWaitSeconds(shift) ?? 0) - 20) < 0.01);
});

test("day earnings bank into the wallet and persist to the next day", () => {
  let shift = startDinner(chooseMenuSlot(openForDinner(createShift()), "tomato_soup"));
  const seated = addTicket(shift, "tomato_soup", 1, 45);
  shift = serveTicket(seated.state, seated.ticketId);
  const earned = shift.coinsEarned;
  assert.ok(earned > 0);
  shift = endDinner(shift);
  shift = bankDayEarnings(shift);
  assert.equal(shift.coinsEarned, 0);
  assert.equal(shift.coins, 24 + earned);
  const dayTwo = nextDay(shift);
  assert.equal(dayTwo.day, 2);
  assert.equal(dayTwo.coins, 24 + earned);
  assert.equal(dayTwo.coinsEarned, 0);
});

test("saves round-trip through the migration boundary and reject garbage", () => {
  const save = buildShiftSave(3, 77, ["harvest_tomatoes"], [1, 1, -0.4]);
  const restored = migrateShiftSave(JSON.parse(JSON.stringify(save)));
  assert.deepEqual(restored, save);
  assert.equal(migrateShiftSave({ version: 2, day: 3 }), null);
  assert.equal(migrateShiftSave({ version: 1, day: -1, coins: 5, tutorialStepsDone: [], fruitGrowths: [] }), null);
  assert.equal(migrateShiftSave(null), null);
});

test("menu eligibility comes from the catalog's menuEligible dishes", () => {
  const eligible = menuEligibleRecipeIds(restaurantRecipes);
  assert.ok(eligible.includes("tomato_soup"));
  assert.ok(!eligible.includes("dough"));
  assert.ok(eligible.length >= 5);
});
