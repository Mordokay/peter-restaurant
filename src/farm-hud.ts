// The farm's screen furniture: what is in hand, what the ground under the
// player is doing, and what they are carrying.
//
// The bar is a hotbar, tools first and seeds after, because the player learns
// the number keys and they must never move. It says only what the world cannot:
// the name of the thing in hand, the state of the plot being addressed, and a
// tally of the carry. Everything else — whether the soil is wet, how far the
// plant has come, how full the crate is — is read by looking at it.
import { cropDefinitions } from "./game/crops";
import { missingFor, recipes } from "./game/recipes";
import { dominantColor } from "./game/cropPlanting";
import { groupItems } from "./game/inventory";
import { hotbar, slotName, toolDefinition, type FarmAction, type Slot } from "./game/tools";
import { catalog } from "./assets/catalog/index";
import type { PlotReading } from "./game/farmPlots";

export interface PrepReading {
  dish: string | null;
  working: { recipe: { name: string }; left: number } | null;
  board: readonly string[];
}

export interface FarmHud {
  readonly slot: Slot;
  select(index: number): void;
  /** Step through the bar — the mouse wheel and the shoulder buttons both want this. */
  cycle(direction: number): void;
  render(reading: PlotReading | null, inventory: readonly string[], crate: number | null, prep: PrepReading | null): void;
  dispose(): void;
}

/** What the key is about to do, said as an instruction rather than a noun. */
const ACTION_TEXT: Record<FarmAction, string> = {
  till: "space breaks the ground",
  water: "space waters it",
  feed: "space feeds the soil",
  sow: "space sows it",
  harvest: "space picks it",
  clear: "space clears it",
  nothing: "",
};

/** Tools have no models yet, so each gets the colour of the thing it does: turned
 *  earth, water, dark compost, straw mulch. */
const TOOL_COLOUR: Record<string, string> = {
  hoe: "#8a6a44", can: "#5b9fd6", compost: "#4a3a27", mulch: "#c9a765",
};

function colourOf(slot: Slot): string {
  if (slot.kind === "tool") return TOOL_COLOUR[slot.tool] ?? "#9fb3a6";
  const crop = cropDefinitions.find((candidate) => candidate.id === slot.crop);
  const model = crop?.produce ? catalog.models[crop.produce] : undefined;
  return model ? dominantColor(model) : "#7fae3c";
}

function itemColour(id: string): string {
  const model = catalog.models[id];
  return model ? dominantColor(model) : "#7fae3c";
}

export function createFarmHud(mount: HTMLElement): FarmHud {
  const bar = document.createElement("div");
  bar.className = "farm-bar";
  bar.innerHTML = `<div class="farm-seeds"></div><div class="farm-plot">walk onto the farm</div><div class="farm-carry"></div>`;
  mount.append(bar);

  const seeds = bar.querySelector<HTMLElement>(".farm-seeds")!;
  const plotEl = bar.querySelector<HTMLElement>(".farm-plot")!;
  const carryEl = bar.querySelector<HTMLElement>(".farm-carry")!;
  const slots = hotbar(cropDefinitions);
  let selected = 0;

  const buttons = slots.map((slot, index) => {
    const button = document.createElement("button");
    button.className = "farm-seed";
    button.type = "button";
    const tool = slot.kind === "tool" ? toolDefinition(slot.tool) : undefined;
    button.title = tool ? `${tool.name} — ${tool.verb}` : `${slotName(slot)} seed`;
    button.innerHTML = `<span class="key">${index + 1}</span><span class="dot" style="background:${colourOf(slot)}"></span>${slotName(slot)}`;
    button.addEventListener("click", () => hud.select(index));
    seeds.append(button);
    return button;
  });

  const paint = (): void => {
    for (const [index, button] of buttons.entries()) button.classList.toggle("on", index === selected);
  };
  paint();

  const hud: FarmHud = {
    get slot() { return slots[selected]!; },
    select(index) {
      if (index < 0 || index >= slots.length) return;
      selected = index;
      paint();
    },
    cycle(direction) {
      selected = (selected + direction + slots.length) % slots.length;
      paint();
    },
    render(reading, inventory, crate, prep) {
      plotEl.innerHTML = prep
        ? prep.dish
          ? `<b>${catalog.models[prep.dish]?.name ?? "dish"} is up</b> · space to take it`
          : prep.working
            ? `<b>${prep.working.recipe.name}</b> · ${prep.working.left.toFixed(0)}s`
            : `<b>prep counter · ${prep.board.length} on the board</b> · ${missingLine(inventory, prep.board)}`
        : crate !== null
          ? `<b>crate · ${crate} in it</b> · ${inventory.length ? "space to unload" : "nothing to unload"}`
          : reading
            ? `<b>${reading.label}</b> · ${ACTION_TEXT[reading.action] || reading.refusal}`
            : "walk onto the farm";
      const held = groupItems(inventory as string[]);
      const entries = Object.entries(held).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      carryEl.innerHTML = entries.length
        ? entries.map(([id, count]) => `<span title="${catalog.models[id]?.name ?? id}"><i style="background:${itemColour(id)}"></i>${count}</span>`).join("")
        : "";
    },
    dispose() { bar.remove(); },
  };
  return hud;
}

/** What the prep counter is still short of, named in the player's terms. The
 *  counter cannot say this itself — an ingredient that is missing has nothing to
 *  stand on the board — so it is the one thing the bar has to spell out. */
function missingLine(inventory: readonly string[], board: readonly string[]): string {
  const recipe = recipes.find((candidate) => candidate.station === "prep");
  if (!recipe) return "nothing to make here";
  const short = missingFor(recipe, [...inventory, ...board]);
  const names = Object.keys(short).map((id) => catalog.models[id]?.name ?? id);
  if (!names.length) return `space to make the ${recipe.name}`;
  return `${recipe.name} still wants ${names.join(", ")}`;
}
