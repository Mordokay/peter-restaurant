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

export type ToolId = "hoe" | "can" | "compost" | "mulch" | "sprinkler" | "seeder" | "remove";

export interface ToolSlot { kind: "tool"; tool: ToolId }
export interface SeedSlot { kind: "seed"; crop: string }
/** Nothing in your hands. Pressing a tool's key again puts it away, and bare
 *  hands still pick what is ripe — the one job that never needed a tool. */
export interface HandSlot { kind: "hand" }
export type Slot = ToolSlot | SeedSlot | HandSlot;

export const EMPTY_HANDS: HandSlot = { kind: "hand" };

export type FarmAction = "till" | "water" | "feed" | "sow" | "harvest" | "clear" | "place" | "lift" | "remove" | "nothing";

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
  // The late-game answer to the replanting grind: put these down and the boring
  // half of the work happens while the player is somewhere else.
  { id: "sprinkler", name: "Sprinkler", verb: "water the beds around it", motion: "scatter" },
  { id: "seeder", name: "Seeder", verb: "re-sow the beds around it", motion: "scatter" },
  // The undo of the whole farm: whatever was put here, this takes it back.
  { id: "remove", name: "Remove", verb: "take back whatever is here", motion: "swing" },
];

/** Tools that are a device the player puts down rather than swings. */
export const DEVICE_TOOLS: readonly ToolId[] = ["sprinkler", "seeder"];
export function isDeviceTool(tool: ToolId): boolean { return DEVICE_TOOLS.includes(tool); }

const toolById = new Map(tools.map((tool) => [tool.id, tool]));
export function toolDefinition(id: ToolId): ToolDefinition | undefined { return toolById.get(id); }

/** Tools that are spent when used, and the item each one spends. Compost is
 *  made, not bought: the kitchen's scraps become it, so a bag of it is a real
 *  thing in the player's hands rather than an infinite verb. */
export const TOOL_COSTS: Partial<Record<ToolId, string>> = { compost: "item_compost" };

/** What the action key does on this plot with this slot in hand. `carrying` is
 *  the player's inventory, for the tools that are spent. */
export function actionOf(slot: Slot, soil: Soil, planted: PlantedCrop | null, carrying: readonly string[] = [], hasDevice = false): FarmAction {
  // A device on the plot is the only thing there is to do with that plot, in
  // hand or not: you pick it up, or you leave it alone. Bare hands lift it too,
  // since picking something up is what hands are for.
  if (hasDevice) return slot.kind === "hand" || (slot.kind === "tool" && (isDeviceTool(slot.tool) || slot.tool === "remove")) ? "lift" : "nothing";
  // The remover works down the stack: a plant first, then the bed under it, so
  // one tool undoes a plot without the player choosing which half to undo.
  if (slot.kind === "tool" && slot.tool === "remove") return planted || soil.tilled ? "remove" : "nothing";
  if (slot.kind === "hand") return actionWithStock(slot, soil, planted);
  if (slot.kind === "tool" && isDeviceTool(slot.tool)) {
    // A device stands in a bed, not on a path, and not on top of a plant.
    return soil.tilled && !planted ? "place" : "nothing";
  }
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

  if (slot.kind === "hand") return "nothing";
  if (slot.kind === "seed") return canSow(soil) ? "sow" : "nothing";
  switch (slot.tool) {
    // Tilling already-broken ground does nothing: a hoe is for opening a bed,
    // not for stirring one the player has already prepared.
    case "hoe": return soil.tilled ? "nothing" : "till";
    case "can": return soil.tilled && !isWet(soil) ? "water" : "nothing";
    case "compost":
    case "mulch": return soil.tilled && soil.fertiliser !== slot.tool ? "feed" : "nothing";
    default: return "nothing";   // devices are handled before this point
  }
}

/** Why the key did nothing, in the player's terms. Only ever shown for the plot
 *  under their hand, so it is guidance rather than a wall of rules. */
export function refusalFor(slot: Slot, soil: Soil, planted: PlantedCrop | null, carrying: readonly string[] = [], hasDevice = false): string {
  if (hasDevice) return "a device is standing here";
  if (slot.kind === "hand") return planted ? "not ready yet" : "nothing in your hands";
  if (slot.kind === "tool" && isDeviceTool(slot.tool)) {
    return planted ? "something is growing here" : "break the ground first";
  }
  if (slot.kind === "tool" && slot.tool === "remove") return "nothing here to take back";
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
  if (slot.kind === "hand") return "Bare hands";
  if (slot.kind === "tool") return toolDefinition(slot.tool)?.name ?? slot.tool;
  return cropById(slot.crop)?.name ?? slot.crop;
}
