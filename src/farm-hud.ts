// The farm's screen furniture: which seed is in hand, what the plot under the
// player's hand is doing, and what they are carrying.
//
// Kept out of world-main.ts because that file is the compound's wiring, not a
// game UI, and kept small because the rulebook wants the world to carry the
// state: the bar says what the plant cannot (a name, a countdown, a stock
// tally) and nothing the plant already says.
import { cropDefinitions, type CropDefinition } from "./game/crops";
import { dominantColor } from "./game/cropPlanting";
import { groupItems } from "./game/inventory";
import { catalog } from "./assets/catalog/index";
import type { PlotReading } from "./game/farmPlots";

export interface FarmHud {
  readonly selected: CropDefinition;
  select(index: number): void;
  /** `crate` is how much the crate holds when the player is standing at it, and
   *  null when they are not — the one moment the crate has something to say that
   *  looking at it does not already tell you. */
  render(reading: PlotReading | null, inventory: readonly string[], crate: number | null): void;
  dispose(): void;
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
    render(reading, inventory, crate) {
      plotEl.innerHTML = crate !== null
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
