// What the player is holding, and what pressing the key would therefore do.
//
// One key does everything, and what it does is decided by three things: what is
// in hand, what the soil is, and what is growing in it. That is Stardew's
// arrangement and it is the right one — the player never picks a verb from a
// menu, they pick a TOOL and the ground answers.
//
// The one place we deliberately differ: a ripe crop is harvested whatever is in
// hand. Swapping to bare hands to pick a plant you are standing over is a step
// that exists only because of how tools were modelled, and the rulebook's Part 0
// says playability wins.
import { cropById, isReady, isSpent, type PlantedCrop } from "./crops.ts";
import { canSow, isWet, type Soil } from "./soil.ts";

export type ToolId = "hoe" | "can" | "compost" | "mulch";

export interface ToolSlot { kind: "tool"; tool: ToolId }
export interface SeedSlot { kind: "seed"; crop: string }
export type Slot = ToolSlot | SeedSlot;

export type FarmAction = "till" | "water" | "feed" | "sow" | "harvest" | "clear" | "nothing";

export interface ToolDefinition {
  id: ToolId;
  name: string;
  /** What it does to bare ground, for the hotbar's tooltip. */
  verb: string;
  /** Swing, sprinkle or scatter — the shape of the action animation and of the
   *  particle burst that confirms it. */
  motion: "swing" | "pour" | "scatter";
}

export const tools: readonly ToolDefinition[] = [
  { id: "hoe", name: "Hoe", verb: "break the ground", motion: "swing" },
  { id: "can", name: "Watering can", verb: "water it", motion: "pour" },
  { id: "compost", name: "Compost", verb: "feed the soil", motion: "scatter" },
  { id: "mulch", name: "Mulch", verb: "hold the water in", motion: "scatter" },
];

const toolById = new Map(tools.map((tool) => [tool.id, tool]));
export function toolDefinition(id: ToolId): ToolDefinition | undefined { return toolById.get(id); }

/** Tools that are spent when used, and the item each one spends. Compost is
 *  made, not bought: the kitchen's scraps become it, so a bag of it is a real
 *  thing in the player's hands rather than an infinite verb. */
export const TOOL_COSTS: Partial<Record<ToolId, string>> = { compost: "item_compost" };

/** What the action key does on this plot with this slot in hand. `carrying` is
 *  the player's inventory, for the tools that are spent. */
export function actionOf(slot: Slot, soil: Soil, planted: PlantedCrop | null, carrying: readonly string[] = []): FarmAction {
  // A tool with nothing left to spend does nothing, wherever it is pointed.
  if (slot.kind === "tool") {
    const cost = TOOL_COSTS[slot.tool];
    if (cost && !carrying.includes(cost)) return "nothing";
  }
  return actionWithStock(slot, soil, planted);
}

function actionWithStock(slot: Slot, soil: Soil, planted: PlantedCrop | null): FarmAction {
  if (planted) {
    const crop = cropById(planted.crop);
    // Something growing: pick it if it is ready, pull it if it is finished, and
    // otherwise the only thing worth doing to it is tending the soil.
    if (!crop || isSpent(crop, planted)) return "clear";
    if (isReady(crop, planted)) return "harvest";
    if (slot.kind === "tool" && slot.tool === "can") return isWet(soil) ? "nothing" : "water";
    if (slot.kind === "tool" && (slot.tool === "compost" || slot.tool === "mulch")) {
      return soil.fertiliser === slot.tool ? "nothing" : "feed";
    }
    return "nothing";
  }

  if (slot.kind === "seed") return canSow(soil) ? "sow" : "nothing";
  switch (slot.tool) {
    // Tilling already-broken ground does nothing: a hoe is for opening a bed,
    // not for stirring one the player has already prepared.
    case "hoe": return soil.tilled ? "nothing" : "till";
    case "can": return soil.tilled && !isWet(soil) ? "water" : "nothing";
    case "compost":
    case "mulch": return soil.tilled && soil.fertiliser !== slot.tool ? "feed" : "nothing";
  }
}

/** Why the key did nothing, in the player's terms. Only ever shown for the plot
 *  under their hand, so it is guidance rather than a wall of rules. */
export function refusalFor(slot: Slot, soil: Soil, planted: PlantedCrop | null, carrying: readonly string[] = []): string {
  if (slot.kind === "tool") {
    const cost = TOOL_COSTS[slot.tool];
    if (cost && !carrying.includes(cost)) return "no compost — tip scraps into the bin and wait";
  }
  if (planted) {
    if (slot.kind === "seed") return "something is already growing here";
    if (slot.tool === "can") return "already watered";
    return "already fed";
  }
  if (!soil.tilled) return slot.kind === "seed" ? "break the ground first" : "break the ground first";
  if (slot.kind === "tool" && slot.tool === "hoe") return "already broken";
  if (slot.kind === "tool" && slot.tool === "can") return "already watered";
  return "already fed";
}

/** The hotbar: tools first, then a seed for every crop. Stable order, because
 *  the player learns the number keys and must not have them move under them. */
export function hotbar(crops: readonly { id: string }[]): Slot[] {
  return [
    ...tools.map((tool) => ({ kind: "tool", tool: tool.id } as Slot)),
    ...crops.map((crop) => ({ kind: "seed", crop: crop.id } as Slot)),
  ];
}

export function slotName(slot: Slot): string {
  if (slot.kind === "tool") return toolDefinition(slot.tool)?.name ?? slot.tool;
  return cropById(slot.crop)?.name ?? slot.crop;
}
