export const artScale = {
  placementGrid: 1,
  architectureMin: 0.25,
  architectureMax: 0.5,
  characterDetailMin: 0.04,
  characterDetailMax: 0.08,
  foodDetailMin: 0.025,
  foodDetailMax: 0.05,
  tomatoDiameterMin: 0.34,
  tomatoDiameterMax: 0.4,
  tomatoHeroCellsAcross: [16, 20],
  steppedAnimationFps: 10,
} as const;

export const renderingBudgets = {
  activeDrawCalls: 120,
  visibleTriangles: 80_000,
  animatedFoodFragmentsPerTask: 16,
  targetFramesPerSecond: 60,
  mergeHiddenVoxelFaces: true,
  useVertexColorsForProps: true,
  instanceRepeatedProps: true,
} as const;

export const worldPalette = {
  steelLight: "#d9e0de",
  steelMid: "#9da9a8",
  steelShadow: "#586463",
  creamTile: "#eee3ca",
  walnut: "#654532",
  charcoal: "#26302e",
  mutedGreen: "#68815b",
  tomato: "#d94b3d",
  wheat: "#d5ad50",
  mushroom: "#a88970",
  soybean: "#83a94f",
  rice: "#eee1bb",
  cabbage: "#69a95d",
  avocado: "#6f963f",
  interaction: "#4cc9d8",
  ready: "#72bd63",
  warning: "#e0a744",
  blocked: "#d85b4c",
  grime: "#76523a",
  reward: "#e6bc54",
} as const;

export const ingredientSilhouettes = {
  tomato: "round_cluster_green_crown",
  wheat: "tall_stalk_bundle",
  mushroom: "wide_cap_short_stem",
  soybean: "curved_pod_cluster",
  rice: "pale_grain_cluster",
  cabbage: "layered_round_head",
  avocado: "dark_pear_visible_pit",
} as const;

export const animationLanguage = {
  phases: ["anticipation", "action", "response", "recovery"],
  coreClips: ["walk", "sprint", "harvest", "chop", "stir", "pour", "plate", "serve", "clean", "sidestep"],
  foodFragmentRange: [3, 8],
  maximumPourCubes: 10,
  steamCubeRange: [2, 5],
  usesRagdolls: false,
  usesSkeletonsByDefault: false,
} as const;

export const cropAnimationLanguage = {
  tomatoFruitSitesPerMaturePlant: 6,
  independentFruitGrowth: true,
  growthScaleRange: [0, 1],
  matureIdleScaleAmplitude: 0.018,
  matureIdleVerticalAmplitude: 0.012,
  plantSwayRadians: 0.018,
  completionParticleRange: [3, 5],
  ambientParticleRange: [0, 1],
  yieldUpgradesChangeVisiblePlantOrFruitCount: true,
} as const;

export const worldFeedbackStates = {
  idle: { light: "none", pattern: "none", requiresMotion: false, urgency: 0 },
  working: { light: "warning", pattern: "slow_pulse", requiresMotion: true, urgency: 0 },
  ready: { light: "ready", pattern: "double_pulse_once", requiresMotion: false, urgency: 1 },
  missingInput: { light: "warning", pattern: "single_pulse_once", requiresMotion: false, urgency: 0 },
  blocked: { light: "blocked", pattern: "double_blink", requiresMotion: false, urgency: 2 },
  dirty: { light: "grime", pattern: "visible_grime", requiresMotion: false, urgency: 1 },
  broken: { light: "blocked", pattern: "rapid_blink", requiresMotion: false, urgency: 3 },
  selected: { light: "interaction", pattern: "steady_edge", requiresMotion: false, urgency: 0 },
} as const;

export const interfaceRules = {
  permanentStationProgressCards: false,
  detailedPanelsOpenAtOnce: 1,
  showExactProgressOn: ["proximity", "selection", "management_mode"],
  allowedWorldUrgencyIcons: ["blocked", "dirty", "broken", "expiring_order", "ready_waiting"],
  debugWorkerBalloonsInNormalPlay: false,
  verticalSliceMustReadWithoutProgressBars: true,
  coreLoopRequiresReading: false,
  normalPlayAllowsFilterLists: false,
  normalPlayAllowsCheckboxGrids: false,
  directManipulationFirst: true,
} as const;

export const physicalOrderRailRules = {
  startingSlots: 4,
  maximumSlots: 12,
  oldestTicketPosition: "left",
  patienceVisualStages: 4,
  fields: ["dish_picture", "quantity_pips", "table_shape_color", "patience_wedge", "served_stamps", "reservation_token"],
  customerSpeechBubbleUsesDishPicture: true,
  focusEnlargesPhysicalRail: true,
  opensDetachedScrollingList: false,
  blocksNewSeatingWhenFull: true,
  removeLegacyOrderListOnlyAfterRailIsPlayable: true,
} as const;

export const pictureFirstInteractions = {
  menu: "dish_cards_into_slots",
  recipes: "ingredient_to_station_to_dish",
  storage: "item_tokens_into_shelf_zones",
  chefAssignment: "portrait_tokens_to_work_zones",
  farming: "seed_packets_to_plots",
  upgrades: "before_after_model_silhouettes",
} as const;

export const firstArtVerticalSlice = [
  "player",
  "server",
  "tomato_crop",
  "stove",
  "pass",
  "dining_table",
  "tomato_soup",
  "dirty_table",
] as const;
