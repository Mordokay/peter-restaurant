// Tags describe what a catalog object is FOR; folders describe where it came from (the
// pack). The browser filters on tags the way The Sims' build catalog filters by room
// and function, so dressing a kitchen means "kitchen + cooking", not "the third pack".
// Tags are plain strings on the model (`model.tags`) mirrored into the index. Two
// vocabularies below are the filter chips; anything else is a free tag that search finds.
// Size class is not a tag — it is derived from the index entry's size on the fly.

export const ZONE_TAGS = ["farm", "kitchen", "dining", "outdoor"] as const;
export type ZoneTag = (typeof ZONE_TAGS)[number];

export const KIND_TAGS = ["food", "ingredient", "cooking", "prep", "tableware", "appliance", "storage", "seating", "furniture", "plant", "tool", "fence", "decor", "structure"] as const;
export type KindTag = (typeof KIND_TAGS)[number];

export const ZONE_LABELS: Record<ZoneTag, string> = { farm: "🌱 Farm", kitchen: "🍳 Kitchen", dining: "🍽️ Dining", outdoor: "🌳 Outdoors" };
export const KIND_LABELS: Record<KindTag, string> = {
  food: "Food", ingredient: "Ingredients", cooking: "Cooking", prep: "Prep", tableware: "Tableware", appliance: "Appliances", storage: "Storage",
  seating: "Seating", furniture: "Furniture", plant: "Plants", tool: "Tools", fence: "Fences & walls", decor: "Decor", structure: "Structure",
};

export type SizeClass = "handheld" | "tabletop" | "floor" | "large";
export const SIZE_LABELS: Record<SizeClass, string> = { handheld: "Hand-held · < 30 cm", tabletop: "Tabletop · < 70 cm", floor: "Floor · < 2 m", large: "Large · 2 m+" };

/** From the index entry's size in metres: the longest side decides. */
export function sizeClassOf(size: readonly number[]): SizeClass {
  const longest = Math.max(size[0] ?? 0, size[1] ?? 0, size[2] ?? 0);
  return longest < 0.3 ? "handheld" : longest < 0.7 ? "tabletop" : longest < 2 ? "floor" : "large";
}

export const isZoneTag = (tag: string): tag is ZoneTag => (ZONE_TAGS as readonly string[]).includes(tag);
export const isKindTag = (tag: string): tag is KindTag => (KIND_TAGS as readonly string[]).includes(tag);

/** Keyword → tags. Order matters only for readability; every matching rule contributes. */
const RULES: [RegExp, string[]][] = [
  // zones by folder
  [/^farm(\/|$)/, ["farm", "outdoor"]],
  [/^plants?(\/|$)/, ["farm", "plant", "ingredient"]],
  [/^food(\/|$)/, ["kitchen", "food"]],
  [/^kitchen(\/|$)/, ["kitchen"]],
  // kinds by id / name / folder words
  [/\b(knife|fork|spoon|spatula|ladle|whisk|eggbeater|egg_beater|mallet|grater|cheesegrater|brush|peeler|tong|bigspoon)\b/, ["tool", "prep"]],
  [/\b(pan|pot|wok|skillet|frying_pan|sarten|lid|pot_lid|kettle|casserole|cooking_pot)\b/, ["cooking"]],
  [/\b(board|cutting_board|cuttingboard|tray|dish_tray|bowl_mixing)\b/, ["prep"]],
  [/\b(plate|dish|bowl|cup|mug|glass|wineglass|tallglass|teacup|coffee_cup|platter|saucer|drinking_glass|tea)\b/, ["tableware", "dining"]],
  [/\b(stove|oven|microwave|refrigerator|fridge|blender|toaster|coffee_maker|dishwasher|mixer|freezer|hood)\b/, ["appliance", "cooking"]],
  [/\b(box|crate|carton|jar|tin_can|soda_can|beer_can|canned|bottle|basket|barrel|sack|bag|container|shelf|shelves|rack|cabinet|drawer|pack)\b/, ["storage"]],
  [/\b(chair|stool|bench|sofa|booth|seat)\b/, ["seating", "furniture", "dining"]],
  [/\b(table|counter|desk|cart|stand|island)\b/, ["furniture"]],
  [/\b(fence|gate|wall|post|plank|hedge|railing)\b/, ["fence", "structure", "outdoor"]],
  [/\b(grass|flower|bush|tree|shrub|plant|foliage|leaf|leaves|vine|sprout|seedling|herb|fern|cactus|ivy)\b/, ["plant", "decor"]],
  [/\b(hoe|shovel|rake|pitchfork|watering_can|wateringcan|bucket|wheelbarrow|scythe|axe|sickle|trowel)\b/, ["tool", "farm"]],
  [/\b(stone|rock|log|stump|hay|haystack|straw|soil|dirt|path|pebble)\b/, ["outdoor", "decor"]],
  [/\b(towel|soap|detergent|sponge|bleach|dishwashing|glue|matches|pills|cleaning)\b/, ["storage"]],
  [/\b(lamp|light|lantern|candle|frame|painting|rug|carpet|curtain|vase|clock|sign|menu|napkin)\b/, ["decor", "dining"]],
  [/\b(apple|tomato|onion|pepper|chili|mushroom|avocado|orange|pumpkin|watermelon|carrot|potato|lettuce|cabbage|corn|egg|garlic|green_onion|salmon|shrimp|sardine|fish|meat|steak|sausage|sasuage|cheese|bread|wheat|tofu|olive_oil|sunflower_oil|salt|pasta|rice|flour|sugar|milk|butter|yogurt|porridge|cereal|coffee|juice|soda|beer|wine|water)\b/, ["ingredient"]],
  [/\b(burger|sandwich|pizza|pie|cake|cheesecake|cookie|croissant|donut|eclair|macaron|pastry|ice_cream|chips|candies|candy|snack|chocolate|bar|soup|noodles|salad|meal|dish_ready)\b/, ["food", "dining"]],
];

let compiled: [RegExp, string[]][] | null = null;
/** Multi-word keys are written with "_" (frying_pan); the haystack is spaced, so "_" becomes "[_ ]". */
function compiledRules(): [RegExp, string[]][] {
  compiled ??= RULES.map(([pattern, add]) => [pattern.source.startsWith("^") ? pattern : new RegExp(pattern.source.replaceAll("_", "[_ ]"), pattern.flags), add]);
  return compiled;
}

/** Suggested tags for a model from its id, name and folder. Deterministic; a starting point the
 *  artist corrects in the lab. Zone tags are added when a kind implies one and no zone matched. */
export function suggestTags(id: string, name: string | undefined, folder: string | undefined): string[] {
  // Ids are snake_case and "_" is a word character, so `\bknife\b` misses "knife_a": match against
  // both spellings (underscored for multi-word keys like frying_pan, spaced for word boundaries).
  const haystack = `${id} ${name ?? ""} ${(folder ?? "").split("/").pop() ?? ""}`.toLowerCase().replace(/[_\s]+/g, " ");
  const tags = new Set<string>();
  for (const [pattern, add] of compiledRules()) {
    if (pattern.source.startsWith("^") ? pattern.test(folder ?? "") : pattern.test(haystack)) for (const tag of add) tags.add(tag);
  }
  // Every catalog food item is for the kitchen unless a zone already says otherwise.
  const hasZone = [...tags].some(isZoneTag);
  if (!hasZone) {
    if (tags.has("plant") || tags.has("fence")) tags.add("farm");
    else if (tags.has("seating") || tags.has("tableware")) tags.add("dining");
    else tags.add("kitchen");
  }
  return [...ZONE_TAGS.filter((tag) => tags.has(tag)), ...KIND_TAGS.filter((tag) => tags.has(tag)), ...[...tags].filter((tag) => !isZoneTag(tag) && !isKindTag(tag)).sort()];
}
