// The farm's screen furniture: which seed is in hand, what the plot under the
// player's hand is doing, and what they are carrying.
//
// Kept out of world-main.ts because that file is the compound's wiring, not a
// game UI, and kept small because the rulebook wants the world to carry the
// state: the bar says what the plant cannot (a name, a countdown, a stock
// tally) and nothing the plant already says.
import { cropDefinitions, type CropDefinition } from "./game/crops";
import { missingFor, recipes } from "./game/recipes";
import { dominantColor } from "./game/cropPlanting";
import { groupItems } from "./game/inventory";
import { catalog } from "./assets/catalog/index";
import type { PlotReading } from "./game/farmPlots";

/** What the prep counter is doing, when the player is standing at it. */
export interface PrepReading {
  dish: string | null;
  working: { recipe: { name: string }; left: number } | null;
  /** What is standing on the board right now. */
  board: readonly string[];
}

export interface FarmHud {
  readonly selected: CropDefinition;
  select(index: number): void;
  /** `crate` is how much the crate holds when the player is standing at it, and
   *  null when they are not — the one moment the crate has something to say that
   *  looking at it does not already tell you. */
  render(reading: PlotReading | null, inventory: readonly string[], crate: number | null, prep: PrepReading | null): void;
  dispose(): void;
}

/** What the counter is still short of, named in the player's terms. The counter
 *  cannot say this itself — an ingredient that is missing has nothing to stand
 *  on the board — so it is the one thing the bar has to spell out. */
function missingLine(inventory: readonly string[], board: readonly string[]): string {
  const recipe = recipes.find((candidate) => candidate.station === "prep");
  if (!recipe) return "nothing to make here";
  // What is on the board counts as much as what is in hand: the player has
  // already carried it here, and asking for it twice would be a lie.
  const short = missingFor(recipe, [...inventory, ...board]);
  const names = Object.keys(short).map((id) => catalog.models[id]?.name ?? id);
  if (!names.length) return `space to make the ${recipe.name}`;
  return `${recipe.name} still wants ${names.join(", ")}`;
}

const ACTION_TEXT: Record<string, string> = {
  sow: "space to sow",
  harvest: "space to harvest",
  clear: "space to clear",
  growing: "growing",
};

/** A crop's colour, taken from its produce model so the chip and the thing in
 *  the ground are the same green. Falls back to a herb green while the model is
 *  still loading. */
function colourOf(id: string | null): string {
  const model = id ? catalog.models[id] : undefined;
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
  let selected = 0;

  const buttons = cropDefinitions.map((crop, index) => {
    const button = document.createElement("button");
    button.className = "farm-seed";
    button.type = "button";
    button.title = `${crop.name} — ${crop.growthSeconds}s to grow`;
    button.innerHTML = `<span class="key">${index + 1}</span><span class="dot"></span>${crop.name}`;
    button.addEventListener("click", () => hud.select(index));
    seeds.append(button);
    return button;
  });

  const paint = (): void => {
    for (const [index, button] of buttons.entries()) {
      button.classList.toggle("on", index === selected);
      button.querySelector<HTMLElement>(".dot")!.style.background = colourOf(cropDefinitions[index]!.produce);
    }
  };
  paint();

  const hud: FarmHud = {
    get selected() { return cropDefinitions[selected]!; },
    select(index) {
      if (index < 0 || index >= cropDefinitions.length) return;
      selected = index;
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
            ? `<b>${reading.label}</b> · ${ACTION_TEXT[reading.action] ?? reading.action}`
            : "walk onto the farm";
      const held = groupItems(inventory as string[]);
      const entries = Object.entries(held).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
      carryEl.innerHTML = entries.length
        ? entries.map(([id, count]) => `<span title="${catalog.models[id]?.name ?? id}"><i style="background:${colourOf(id)}"></i>${count}</span>`).join("")
        : "";
    },
    dispose() { bar.remove(); },
  };
  return hud;
}
