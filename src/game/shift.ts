import { dayStructure, menuSlotsAtLevel, restaurantItems, type RestaurantRecipe } from "./restaurant.ts";

// The day cycle as an explicit, Babylon-free state machine: Prep (stock the
// kitchen) → Choose Menu (untimed planning) → Dinner (service under a clock)
// → Close (results). The tutorial guidance and world visuals live in the
// runtime; this module owns phase truth so pacing can be tested without a
// scene.

export type ShiftPhase = "prep" | "choose_menu" | "dinner" | "close";

export interface MenuChoice {
  recipeId: string;
  plannedServings: number;
}

/** One physical ticket on the rail: a guest's request, its table, and how long
 * the guest has waited. The domain owns patience expiry so walkouts are
 * authoritative, not cosmetic. */
export interface TicketRecord {
  id: number;
  recipeId: string;
  tableId: number;
  waitedSeconds: number;
  patienceSeconds: number;
  status: "waiting" | "served" | "missed";
}

/** Upper bound for menu planned quantity at level 1. */
export const maxPlannedServings = 3;

export interface ShiftResults {
  day: number;
  servedByRecipe: Readonly<Record<string, number>>;
  missedGuests: number;
  wastedServings: number;
  coinsEarned: number;
}

/** Plated-serving capacity of the level-1 serving shelf (locked plan guardrail:
 * shelves grow 12 / 24 / 40 with upgrades). */
export const servingShelfCapacity = 12;

export interface ShiftState {
  day: number;
  phase: ShiftPhase;
  /** Counts down during prep and dinner; ignored in untimed phases. */
  phaseSecondsRemaining: number;
  /** Recipe ids chosen for tonight, one entry per open menu slot, in slot order. */
  menu: MenuChoice[];
  menuSlots: number;
  /** Plated servings waiting on the pass shelf, by recipe id. Plated food
   * expires at close, so this lives on the shift, not on the save. */
  shelfServings: Record<string, number>;
  /** Live and historical tickets this dinner. Kept for results (wait times)
   * and save/restore of a mid-dinner state. */
  tickets: TicketRecord[];
  nextTicketId: number;
  /** Wallet coins — persists across days; `coinsEarned` is the day ledger. */
  coins: number;
  servedByRecipe: Record<string, number>;
  missedGuests: number;
  wastedServings: number;
  coinsEarned: number;
}

export function saleValueOfDish(itemId: string): number {
  return restaurantItems.find((item) => item.id === itemId)?.saleValue ?? 0;
}

export function createShift(day = 1, level = 1, coins = 24): ShiftState {
  return {
    day,
    phase: "prep",
    phaseSecondsRemaining: dayStructure.prepSeconds,
    menu: [],
    menuSlots: menuSlotsAtLevel(level),
    shelfServings: {},
    tickets: [],
    nextTicketId: 1,
    coins,
    servedByRecipe: {},
    missedGuests: 0,
    wastedServings: 0,
    coinsEarned: 0,
  };
}

/** Ends prep early — the player's "open the doors" decision. Waiting the full
 * timer also works; opening with less stock is the meaningful trade. */
export function openForDinner(state: ShiftState): ShiftState {
  if (state.phase !== "prep") return state;
  return { ...state, phase: "choose_menu" };
}

/** Fills the next empty menu slot. The menu must be full before dinner starts. */
export function chooseMenuSlot(state: ShiftState, recipeId: string, plannedServings = 2): ShiftState {
  if (state.phase !== "choose_menu") return state;
  if (state.menu.length >= state.menuSlots) return state;
  if (state.menu.some((choice) => choice.recipeId === recipeId)) return state;
  return { ...state, menu: [...state.menu, { recipeId, plannedServings }] };
}

/** Adjusts the planned quantity of an already-chosen menu entry (cycling pips
 * at the board). Clamped to 1..maxPlannedServings. */
export function setPlannedServings(state: ShiftState, recipeId: string, plannedServings: number): ShiftState {
  if (state.phase !== "choose_menu") return state;
  const clamped = Math.min(maxPlannedServings, Math.max(1, Math.round(plannedServings)));
  return {
    ...state,
    menu: state.menu.map((choice) => choice.recipeId === recipeId ? { ...choice, plannedServings: clamped } : choice),
  };
}

/** Menu full → dinner begins. Returns the input untouched otherwise. */
export function startDinner(state: ShiftState): ShiftState {
  if (state.phase !== "choose_menu" || state.menu.length < state.menuSlots) return state;
  return { ...state, phase: "dinner", phaseSecondsRemaining: dayStructure.dinnerSeconds };
}

export function recordServed(state: ShiftState, recipeId: string): ShiftState {
  if (state.phase !== "dinner") return state;
  const served = (state.servedByRecipe[recipeId] ?? 0) + 1;
  return {
    ...state,
    servedByRecipe: { ...state.servedByRecipe, [recipeId]: served },
    coinsEarned: state.coinsEarned + saleValueOfDish(recipeId),
  };
}

/** A seated guest starts waiting: the ticket hangs on the rail. */
export function addTicket(state: ShiftState, recipeId: string, tableId: number, patienceSeconds: number): { state: ShiftState; ticketId: number } {
  if (state.phase !== "dinner") return { state, ticketId: 0 };
  const ticket: TicketRecord = {
    id: state.nextTicketId,
    recipeId,
    tableId,
    waitedSeconds: 0,
    patienceSeconds,
    status: "waiting",
  };
  return { state: { ...state, tickets: [...state.tickets, ticket], nextTicketId: state.nextTicketId + 1 }, ticketId: ticket.id };
}

export function waitingTickets(state: ShiftState): TicketRecord[] {
  return state.tickets.filter((ticket) => ticket.status === "waiting");
}

export function ticketById(state: ShiftState, ticketId: number): TicketRecord | null {
  return state.tickets.find((ticket) => ticket.id === ticketId) ?? null;
}

/** Delivering a plate to its ticket: the wait freezes into the record and the
 * serving pays. Player and Server both land here, so double-service is
 * structurally impossible. */
export function serveTicket(state: ShiftState, ticketId: number): ShiftState {
  const ticket = ticketById(state, ticketId);
  if (!ticket || ticket.status !== "waiting") return state;
  const next = recordServed(state, ticket.recipeId);
  return {
    ...next,
    tickets: next.tickets.map((candidate) => candidate.id === ticketId ? { ...candidate, status: "served" } : candidate),
  };
}

export function recordMissedGuest(state: ShiftState): ShiftState {
  if (state.phase !== "dinner") return state;
  return { ...state, missedGuests: state.missedGuests + 1 };
}

/** Dinner ends by the kitchen's own hand (last guest resolved, closing duties
 * done) rather than by the clock. The runtime decides when service is over;
 * this keeps the transition in the same place as the timer path. */
export function endDinner(state: ShiftState): ShiftState {
  if (state.phase !== "dinner") return state;
  return { ...state, phase: "close", phaseSecondsRemaining: 0 };
}

/** Places cooked servings onto the shelf. Capacity is enforced in the domain
 * (the drying-rack lesson): overflow cannot enqueue and counts as waste. */
export function stockShelf(state: ShiftState, recipeId: string, servings: number): ShiftState {
  if (servings <= 0) return state;
  const current = state.shelfServings[recipeId] ?? 0;
  const shelfTotal = Object.values(state.shelfServings).reduce((sum, count) => sum + count, 0);
  const placed = Math.min(servings, Math.max(0, servingShelfCapacity - shelfTotal));
  const overflow = servings - placed;
  let next: ShiftState = { ...state, shelfServings: { ...state.shelfServings, [recipeId]: current + placed } };
  if (overflow > 0) next = recordWaste(next, overflow);
  return next;
}

/** Takes one plated serving for tray service. The caller checks availability;
 * this stays a no-op rather than a negative count. */
export function takeServing(state: ShiftState, recipeId: string): ShiftState {
  const current = state.shelfServings[recipeId] ?? 0;
  if (current <= 0) return state;
  return { ...state, shelfServings: { ...state.shelfServings, [recipeId]: current - 1 } };
}

/** Plated dishes expire at close (locked daily structure): leftovers leave the
 * shelf and count as waste so the results card can show the cost of over-cooking. */
export function expirePlatedFood(state: ShiftState): ShiftState {
  const leftover = Object.values(state.shelfServings).reduce((sum, count) => sum + count, 0);
  if (leftover === 0) return state;
  return { ...recordWaste(state, leftover), shelfServings: {} };
}

export function recordWaste(state: ShiftState, servings: number): ShiftState {
  if (servings <= 0) return state;
  return { ...state, wastedServings: state.wastedServings + servings };
}

/** Advances timers one tick. Prep and dinner expire into their next phase on
 * their own; choose_menu is untimed; close is terminal until the next day.
 * Waiting tickets accrue wait time; an expired ticket is a walkout (missed),
 * and closing time resolves anything still waiting as missed. */
export function tickShift(state: ShiftState, dtSeconds: number): ShiftState {
  if (state.phase !== "prep" && state.phase !== "dinner") return state;
  const remaining = Math.max(0, state.phaseSecondsRemaining - dtSeconds);
  let next: ShiftState = { ...state, phaseSecondsRemaining: remaining };
  if (state.phase === "dinner") {
    let missed = 0;
    next = {
      ...next,
      tickets: next.tickets.map((ticket) => {
        if (ticket.status !== "waiting") return ticket;
        const waitedSeconds = ticket.waitedSeconds + dtSeconds;
        if (waitedSeconds >= ticket.patienceSeconds) {
          missed++;
          return { ...ticket, waitedSeconds, status: "missed" as const };
        }
        return { ...ticket, waitedSeconds };
      }),
    };
    if (missed > 0) next = { ...next, missedGuests: next.missedGuests + missed };
  }
  if (remaining > 0) return next;
  if (next.phase === "prep") return { ...next, phase: "choose_menu" };
  return closeOutWaitingTickets({ ...next, phase: "close" });
}

/** Dinner's end resolves any still-waiting ticket as missed. */
function closeOutWaitingTickets(state: ShiftState): ShiftState {
  let missed = 0;
  const tickets = state.tickets.map((ticket) => {
    if (ticket.status !== "waiting") return ticket;
    missed++;
    return { ...ticket, status: "missed" as const };
  });
  return missed === 0 ? state : { ...state, tickets, missedGuests: state.missedGuests + missed };
}

export function closeDay(state: ShiftState): ShiftResults {
  return {
    day: state.day,
    servedByRecipe: state.servedByRecipe,
    missedGuests: state.missedGuests,
    wastedServings: state.wastedServings,
    coinsEarned: state.coinsEarned,
  };
}

/** Average wait of served guests — the results card's service-bottleneck
 * number. Null when nothing was served. */
export function averageWaitSeconds(state: ShiftState): number | null {
  const served = state.tickets.filter((ticket) => ticket.status === "served");
  if (served.length === 0) return null;
  return served.reduce((sum, ticket) => sum + ticket.waitedSeconds, 0) / served.length;
}

/** Banks the day's earnings into the wallet (kept separate so the results card
 * can still show the day ledger). */
export function bankDayEarnings(state: ShiftState): ShiftState {
  if (state.coinsEarned === 0) return state;
  return { ...state, coins: state.coins + state.coinsEarned, coinsEarned: 0 };
}

/** Rolls the calendar. Crops and prepared components persist across days by
 * design; plated leftovers do not — the runtime clears those visuals. */
export function nextDay(state: ShiftState, level = 1): ShiftState {
  return createShift(state.day + 1, level, state.coins);
}

/** Convenience for the runtime: the picture on a menu card / results card. */
export function dishPicture(itemId: string): { color: string; name: string } | null {
  const item = restaurantItems.find((candidate) => candidate.id === itemId);
  return item ? { color: item.color, name: item.name } : null;
}

// ── Save/load ────────────────────────────────────────────────────────────────
// Saves capture the between-days state only: day, wallet, tutorial progress,
// and crop growth. Mid-day position (guests walking, pots cooking) is not
// persisted — a reload resumes at the saved day's Prep. Version bumps migrate
// in `migrateShiftSave` and nowhere else.

export interface ShiftSaveV1 {
  version: 1;
  savedAt: number;
  day: number;
  coins: number;
  tutorialStepsDone: string[];
  fruitGrowths: number[];
}

export function buildShiftSave(day: number, coins: number, tutorialStepsDone: string[], fruitGrowths: number[]): ShiftSaveV1 {
  return { version: 1, savedAt: Date.now(), day, coins, tutorialStepsDone, fruitGrowths };
}

/** Single migration boundary: unknown/future versions are discarded rather
 * than guessed at (a fresh shift is cheaper than a corrupt one). */
export function migrateShiftSave(raw: unknown): ShiftSaveV1 | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<ShiftSaveV1>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.day !== "number" || candidate.day < 1) return null;
  if (typeof candidate.coins !== "number" || candidate.coins < 0) return null;
  if (!Array.isArray(candidate.tutorialStepsDone) || !candidate.tutorialStepsDone.every((step) => typeof step === "string")) return null;
  if (!Array.isArray(candidate.fruitGrowths) || !candidate.fruitGrowths.every((growth) => typeof growth === "number")) return null;
  return { version: 1, savedAt: typeof candidate.savedAt === "number" ? candidate.savedAt : 0, day: candidate.day, coins: candidate.coins, tutorialStepsDone: candidate.tutorialStepsDone, fruitGrowths: candidate.fruitGrowths };
}

export function menuEligibleRecipeIds(recipes: readonly RestaurantRecipe[]): string[] {
  return recipes
    .filter((recipe) => {
      const item = restaurantItems.find((candidate) => candidate.id === recipe.output);
      return item !== undefined && "menuEligible" in item && item.menuEligible;
    })
    .map((recipe) => recipe.output);
}
