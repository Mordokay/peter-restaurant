import "./style.css";
import {
  items as catalogItems,
  recipes as catalogRecipes,
  stationDefinitions,
  validateCatalog,
  type CatalogItemId,
  type RecipeDefinition,
  type StationId,
} from "./game/catalog";
import { readSave, writeSave } from "./game/persistence";
import { addItems, countItem, groupItems, removeItems } from "./game/inventory";
import {
  cropDefinitions,
  cropGrowthSeconds,
  cropYield,
  farmPlotUnlockCosts,
  geneticsUpgradeCost,
  type BaseMaterialId,
  type CropDefinition,
} from "./game/farming";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
  Viewport,
} from "@babylonjs/core";

type ItemId = CatalogItemId;

const catalogErrors = validateCatalog();
if (catalogErrors.length > 0) throw new Error(`Invalid game catalog:\n${catalogErrors.join("\n")}`);
const catalogById = new Map(catalogItems.map((item) => [item.id, item]));
const stationById = new Map(stationDefinitions.map((station) => [station.id, station]));

interface Inventory {
  items: ItemId[];
  capacity: number;
}

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const mainMenuEl = document.querySelector<HTMLElement>("#main-menu")!;
const mainMenuRootEl = document.querySelector<HTMLElement>("#main-menu-root")!;
const newGameSlotsEl = document.querySelector<HTMLElement>("#new-game-slots")!;
const loadGameSlotsEl = document.querySelector<HTMLElement>("#load-game-slots")!;
const savingToastEl = document.querySelector<HTMLElement>("#saving-toast")!;
const coinsEl = document.querySelector<HTMLElement>("#coins")!;
const astralCountEl = document.querySelector<HTMLElement>("#astral-count")!;
const carryingEl = document.querySelector<HTMLElement>("#carrying")!;
const carryingCountEl = document.querySelector<HTMLElement>("#carrying-count")!;
const questEl = document.querySelector<HTMLElement>("#quest")!;
const questDetailEl = document.querySelector<HTMLElement>("#quest-detail")!;
const hintEl = document.querySelector<HTMLElement>("#hint")!;
const orderListEl = document.querySelector<HTMLElement>("#order-list")!;
const customerCountEl = document.querySelector<HTMLElement>("#customer-count")!;
const orderDrawerEl = document.querySelector<HTMLDetailsElement>("#order-drawer")!;
const shelfMenuEl = document.querySelector<HTMLElement>("#shelf-menu")!;
const shelfFilterSearchEl = document.querySelector<HTMLInputElement>("#shelf-filter-search")!;
const shelfFilterAllEl = document.querySelector<HTMLInputElement>("#shelf-filter-all")!;
const shelfFilterTabsEl = document.querySelector<HTMLElement>("#shelf-filter-tabs")!;
const shelfFilterListEl = document.querySelector<HTMLElement>("#shelf-filter-list")!;
const shelfItemsEl = document.querySelector<HTMLElement>("#shelf-items")!;
const shelfCapacityEl = document.querySelector<HTMLElement>("#shelf-capacity")!;
const staminaFillEl = document.querySelector<HTMLElement>("#stamina-fill")!;
const staminaValueEl = document.querySelector<HTMLElement>("#stamina-value")!;
const stationStatusesEl = document.querySelector<HTMLElement>("#station-statuses")!;
const hireWorkerEl = document.querySelector<HTMLButtonElement>("#hire-worker")!;
const workerSelectorEl = document.querySelector<HTMLSelectElement>("#worker-selector")!;
const unlockWorkerSlotEl = document.querySelector<HTMLButtonElement>("#unlock-worker-slot")!;
const workerNameEl = document.querySelector<HTMLElement>("#worker-name")!;
const workerRosterEl = document.querySelector<HTMLElement>("#worker-roster")!;
const workerTooltipEl = document.querySelector<HTMLElement>("#worker-tooltip")!;
document.body.append(workerTooltipEl);
const cropGridEl = document.querySelector<HTMLElement>("#crop-grid")!;
const farmPlotGridEl = document.querySelector<HTMLElement>("#farm-plot-grid")!;
const farmContextEl = document.querySelector<HTMLElement>("#farm-context")!;
const farmContextSlotEl = document.querySelector<HTMLElement>("#farm-context-slot")!;
const farmContextNameEl = document.querySelector<HTMLElement>("#farm-context-name")!;
const farmContextStatusEl = document.querySelector<HTMLElement>("#farm-context-status")!;
const farmContextProgressEl = document.querySelector<HTMLElement>("#farm-context-progress")!;
const farmContextCropEl = document.querySelector<HTMLSelectElement>("#farm-context-crop")!;
const farmContextAutoEl = document.querySelector<HTMLInputElement>("#farm-context-auto")!;
const farmContextPlantEl = document.querySelector<HTMLButtonElement>("#farm-context-plant")!;
const farmContextUpgradeEl = document.querySelector<HTMLButtonElement>("#farm-context-upgrade")!;
const farmContextRemoveEl = document.querySelector<HTMLButtonElement>("#farm-context-remove")!;

function showWorkerTooltip(target: HTMLElement): void {
  const text = target.dataset.tooltip ?? target.getAttribute("title");
  if (!text) return;
  workerTooltipEl.textContent = text;
  workerTooltipEl.classList.remove("worker-tooltip--hidden");
  const rect = target.getBoundingClientRect();
  const tooltipRect = workerTooltipEl.getBoundingClientRect();
  const margin = 8;
  const centeredLeft = rect.left + rect.width / 2 - tooltipRect.width / 2;
  const left = Math.min(window.innerWidth - tooltipRect.width - margin, Math.max(margin, centeredLeft));
  const above = rect.top - tooltipRect.height - margin;
  const top = above >= margin ? above : Math.min(window.innerHeight - tooltipRect.height - margin, rect.bottom + margin);
  workerTooltipEl.style.left = `${left}px`;
  workerTooltipEl.style.top = `${top}px`;
}

workerRosterEl.addEventListener("pointerover", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-tooltip], [title]");
  if (target) showWorkerTooltip(target);
});
workerRosterEl.addEventListener("pointerout", (event) => {
  const next = event.relatedTarget as HTMLElement | null;
  if (!next?.closest?.("[data-tooltip], [title]")) workerTooltipEl.classList.add("worker-tooltip--hidden");
});
const workerOptionsEl = document.querySelector<HTMLElement>("#worker-options")!;
const workerProductionEl = document.querySelector<HTMLInputElement>("#worker-production")!;
const workerStockingEl = document.querySelector<HTMLInputElement>("#worker-stocking")!;
const workerSalesEl = document.querySelector<HTMLInputElement>("#worker-sales")!;
const workerRouteEl = document.querySelector<HTMLSelectElement>("#worker-route")!;
const workerStatusEl = document.querySelector<HTMLElement>("#worker-status")!;
const upgradeWorkerSpeedEl = document.querySelector<HTMLButtonElement>("#upgrade-worker-speed")!;
const upgradeWorkerCapacityEl = document.querySelector<HTMLButtonElement>("#upgrade-worker-capacity")!;
const upgradePlayerCarryEl = document.querySelector<HTMLButtonElement>("#upgrade-player-carry")!;
const upgradePlayerStaminaEl = document.querySelector<HTMLButtonElement>("#upgrade-player-stamina")!;
const upgradePlayerRegenEl = document.querySelector<HTMLButtonElement>("#upgrade-player-regen")!;
const buildToggleEl = document.querySelector<HTMLButtonElement>("#build-toggle")!;
const moveModeToggleEl = document.querySelector<HTMLButtonElement>("#move-mode-toggle")!;
const rotateSelectedEl = document.querySelector<HTMLButtonElement>("#rotate-selected")!;
const buildStatusEl = document.querySelector<HTMLElement>("#build-status")!;
const rotateBuildingEl = document.querySelector<HTMLButtonElement>("#rotate-building")!;
const buildChoiceEls = [...document.querySelectorAll<HTMLButtonElement>("button[data-build]")];
const managementPanelEl = document.querySelector<HTMLElement>("#management-panel")!;
const closeManagementEl = document.querySelector<HTMLButtonElement>("#close-management")!;
const managementTabEls = [...document.querySelectorAll<HTMLButtonElement>("button[data-panel]")];
const managementPageEls = [...document.querySelectorAll<HTMLElement>(".management-page")];
const speedControlEls = [...document.querySelectorAll<HTMLButtonElement>("button[data-speed]")];
const keybindListEl = document.querySelector<HTMLElement>("#keybind-list")!;
const resetKeybindsEl = document.querySelector<HTMLButtonElement>("#reset-keybinds")!;
const saveSlotEl = document.querySelector<HTMLSelectElement>("#save-slot")!;
const autosaveIntervalEl = document.querySelector<HTMLSelectElement>("#autosave-interval")!;
const newGameEl = document.querySelector<HTMLButtonElement>("#new-game")!;
const saveNowEl = document.querySelector<HTMLButtonElement>("#save-now")!;
const downloadWorkerDebugEl = document.querySelector<HTMLButtonElement>("#download-worker-debug")!;
const clearWorkerDebugEl = document.querySelector<HTMLButtonElement>("#clear-worker-debug")!;
const workerDebugStatusEl = document.querySelector<HTMLElement>("#worker-debug-status")!;
const downloadBalanceDebugEl = document.querySelector<HTMLButtonElement>("#download-balance-debug")!;
const clearBalanceDebugEl = document.querySelector<HTMLButtonElement>("#clear-balance-debug")!;
const balanceDebugStatusEl = document.querySelector<HTMLElement>("#balance-debug-status")!;
const buildingActionsEl = document.querySelector<HTMLElement>("#building-actions")!;
const selectedBuildingNameEl = document.querySelector<HTMLElement>("#selected-building-name")!;
const upgradeBuildingEl = document.querySelector<HTMLButtonElement>("#upgrade-building")!;
const sellBuildingEl = document.querySelector<HTMLButtonElement>("#sell-building")!;

const GAME_SETTINGS_KEY = "farming-unlimited-settings-v1";
interface StoredGameSettings { activeSlot: number; autosaveMinutes: number }
let storedGameSettings: StoredGameSettings = { activeSlot: 1, autosaveMinutes: 2 };
try {
  const stored = localStorage.getItem(GAME_SETTINGS_KEY);
  if (stored) storedGameSettings = { ...storedGameSettings, ...JSON.parse(stored) };
} catch { /* retain defaults */ }
storedGameSettings.activeSlot = Math.max(1, Math.min(3, Number(storedGameSettings.activeSlot) || 1));
storedGameSettings.autosaveMinutes = [0, 1, 2, 5, 10].includes(Number(storedGameSettings.autosaveMinutes)) ? Number(storedGameSettings.autosaveMinutes) : 2;
saveSlotEl.value = String(storedGameSettings.activeSlot);
autosaveIntervalEl.value = String(storedGameSettings.autosaveMinutes);
let menuActive = true;
let savingToastTimer = 0;
let playTimeSeconds = 0;

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.72, 0.82, 0.57, 1);
scene.ambientColor = new Color3(0.28, 0.28, 0.22);

const colors = {
  floor: new Color3(0.76, 0.64, 0.43),
  grass: new Color3(0.49, 0.65, 0.27),
  timber: new Color3(0.32, 0.19, 0.12),
  plaster: new Color3(0.81, 0.75, 0.61),
  sunleaf: new Color3(0.55, 0.82, 0.25),
  gold: new Color3(1, 0.72, 0.2),
  cream: new Color3(0.94, 0.88, 0.7),
};

function material(name: string, color: Color3, emissive?: Color3): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.12, 0.12, 0.1);
  if (emissive) mat.emissiveColor = emissive;
  return mat;
}

const mats = {
  floor: material("warm stone floor", colors.floor),
  grass: material("meadow grass", colors.grass),
  darkGrass: material("dark grass", new Color3(0.35, 0.52, 0.2)),
  timber: material("old timber", colors.timber),
  plaster: material("cottage plaster", colors.plaster),
  leaf: material("sunleaf", colors.sunleaf, new Color3(0.08, 0.14, 0.01)),
  leafDark: material("sunleaf shadow", new Color3(0.28, 0.58, 0.16)),
  gold: material("sunleaf gold", colors.gold, new Color3(0.14, 0.08, 0)),
  player: material("herbalist tunic", new Color3(0.35, 0.16, 0.48)),
  playerTrim: material("herbalist trim", new Color3(0.74, 0.54, 0.83)),
  skin: material("skin", new Color3(0.76, 0.56, 0.4)),
  hair: material("hair", new Color3(0.18, 0.1, 0.07)),
  station: material("drying wood", new Color3(0.45, 0.26, 0.13)),
  cloth: material("drying cloth", new Color3(0.82, 0.71, 0.48)),
  glow: material("interaction glow", new Color3(0.45, 0.7, 0.2), new Color3(0.18, 0.34, 0.04)),
  target: material("move target", new Color3(0.86, 0.95, 0.53), new Color3(0.25, 0.36, 0.08)),
  powder: material("sunleaf powder", new Color3(0.72, 0.82, 0.38)),
  essence: material("sunleaf essence", new Color3(0.42, 0.9, 0.55), new Color3(0.04, 0.18, 0.08)),
  incense: material("sunleaf incense", new Color3(0.48, 0.25, 0.12)),
  metal: material("old bronze", new Color3(0.48, 0.35, 0.2)),
  glass: material("bottle glass", new Color3(0.48, 0.76, 0.61), new Color3(0.02, 0.08, 0.04)),
  discard: material("discard zone", new Color3(0.66, 0.18, 0.12), new Color3(0.24, 0.025, 0.01)),
};

const hemi = new HemisphericLight("soft sky", new Vector3(-0.4, 1, -0.2), scene);
hemi.intensity = 1.3;
hemi.diffuse = new Color3(1, 0.88, 0.69);
hemi.groundColor = new Color3(0.32, 0.43, 0.22);
const sun = new DirectionalLight("afternoon sun", new Vector3(-0.65, -1, 0.45), scene);
sun.position = new Vector3(12, 18, -12);
sun.intensity = 1.7;
const shadows = new ShadowGenerator(2048, sun);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = 16;

const ground = MeshBuilder.CreateGround("walkable ground", { width: 30, height: 30 }, scene);
ground.material = mats.grass;
ground.receiveShadows = true;
ground.isPickable = true;

const SHOP_BACK_Z = -6.7;
const SHOP_FRONT_Z = 9.8;
const SHOP_DEPTH = SHOP_FRONT_Z - SHOP_BACK_Z;
const SHOP_CENTER_Z = (SHOP_FRONT_Z + SHOP_BACK_Z) / 2;
const floor = MeshBuilder.CreateBox("cottage floor", { width: 14, height: 0.32, depth: SHOP_DEPTH }, scene);
floor.position.set(1.5, 0.14, SHOP_CENTER_Z);
floor.material = mats.floor;
floor.receiveShadows = true;
floor.isPickable = true;

function box(name: string, size: Vector3, position: Vector3, mat: StandardMaterial): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene);
  mesh.position.copyFrom(position);
  mesh.material = mat;
  mesh.receiveShadows = true;
  shadows.addShadowCaster(mesh);
  return mesh;
}

// The workshop is completely open toward the farm so both areas read as one
// continuous space. A low side wall still suggests the cottage footprint.
box("left cutaway wall", new Vector3(0.35, 0.72, SHOP_DEPTH), new Vector3(-5.65, 0.52, SHOP_CENTER_Z), mats.plaster);
for (let z = -5.2; z <= 9.3; z += 3.1) box("low side beam", new Vector3(0.42, 0.86, 0.22), new Vector3(-5.48, 0.57, z), mats.timber);

function createHerbalist(): TransformNode {
  const root = new TransformNode("player", scene);
  const body = MeshBuilder.CreateCapsule("body", { height: 1.25, radius: 0.38, tessellation: 10 }, scene);
  body.parent = root;
  body.position.y = 0.88;
  body.material = mats.player;
  const head = MeshBuilder.CreateSphere("head", { diameter: 0.72, segments: 12 }, scene);
  head.parent = root;
  head.position.y = 1.72;
  head.material = mats.skin;
  const hair = MeshBuilder.CreateSphere("hair", { diameter: 0.76, segments: 10, slice: 0.56 }, scene);
  hair.parent = root;
  hair.position.y = 1.85;
  hair.rotation.x = Math.PI;
  hair.material = mats.hair;
  const belt = MeshBuilder.CreateTorus("belt", { diameter: 0.69, thickness: 0.09, tessellation: 14 }, scene);
  belt.parent = root;
  belt.position.y = 0.83;
  belt.rotation.x = Math.PI / 2;
  belt.material = mats.playerTrim;
  for (const mesh of [body, head, hair, belt]) shadows.addShadowCaster(mesh);
  root.position.set(0, 0.33, 2.2);
  return root;
}

const player = createHerbalist();
const carryAnchor = new TransformNode("carried items", scene);
carryAnchor.parent = player;
carryAnchor.position.set(0, 1.25, -0.42);
const playerStats = {
  carryCapacity: 6,
  maxStamina: 100,
  staminaRegenPerSecond: 20,
  staminaDrainPerSecond: 13,
  carryLevel: 1,
  staminaLevel: 1,
  regenLevel: 1,
};
const inventory: Inventory = { items: [], capacity: playerStats.carryCapacity };

function rebuildCarryStack(): void {
  carryAnchor.getChildMeshes().forEach((mesh) => mesh.dispose());
  for (let i = 0; i < inventory.items.length; i++) {
    const item = inventory.items[i]!;
    const bundle = item === "sunleaf" || item === "dried_sunleaf"
      ? MeshBuilder.CreateCylinder(`carried ${item}`, { height: 0.18, diameter: 0.5, tessellation: 8 }, scene)
      : createProductMesh(item, Vector3.Zero(), `carried ${item}`);
    bundle.parent = carryAnchor;
    bundle.position.set((i % 2) * 0.18 - 0.09, i * 0.17, 0);
    if (item === "sunleaf" || item === "dried_sunleaf") {
      bundle.rotation.z = Math.PI / 2;
      bundle.material = item === "sunleaf" ? mats.leaf : mats.cloth;
    }
    shadows.addShadowCaster(bundle);
  }
}

const cropById = new Map<BaseMaterialId, CropDefinition>(cropDefinitions.map((crop) => [crop.id, crop]));
const cropMaterials = new Map<BaseMaterialId, StandardMaterial>();
const unlockedCrops = new Set<BaseMaterialId>(["sunleaf"]);
const cropGenetics = Object.fromEntries(cropDefinitions.map((crop) => [crop.id, 1])) as Record<BaseMaterialId, number>;

function materialForCrop(cropId: BaseMaterialId): StandardMaterial {
  let cropMaterial = cropMaterials.get(cropId);
  if (!cropMaterial) {
    const crop = cropById.get(cropId)!;
    const color = Color3.FromHexString(crop.color);
    cropMaterial = material(`${crop.name} crop`, color, color.scale(0.08));
    cropMaterials.set(cropId, cropMaterial);
  }
  return cropMaterial;
}

interface ResourcePatch {
  slot: number;
  root: TransformNode;
  stock: number;
  respawn: number;
  remainingYield: number;
  ring: Mesh;
  cropAnchor: TransformNode;
  cropMeshes: Mesh[];
  lockMesh: Mesh;
  unlocked: boolean;
  cropId: BaseMaterialId | null;
  planted: boolean;
  autoReplant: boolean;
}
const patches: ResourcePatch[] = [];

function farmPlotCapacity(patch: ResourcePatch): number {
  if (!patch.cropId) return 0;
  return cropYield(cropById.get(patch.cropId)!, cropGenetics[patch.cropId]);
}

function farmUnitGrowthSeconds(patch: ResourcePatch): number {
  if (!patch.cropId) return 1;
  const crop = cropById.get(patch.cropId)!;
  return cropGrowthSeconds(crop, cropGenetics[crop.id]) / Math.max(1, farmPlotCapacity(patch));
}

function farmNextUnitProgress(patch: ResourcePatch): number {
  const capacity = farmPlotCapacity(patch);
  if (!patch.planted || !patch.cropId || capacity === 0) return 0;
  if (patch.stock >= capacity) return 1;
  if (patch.remainingYield <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - patch.respawn / farmUnitGrowthSeconds(patch)));
}

function rebuildFarmPlotCrop(patch: ResourcePatch): void {
  patch.cropMeshes.forEach((mesh) => mesh.dispose());
  patch.cropMeshes = [];
  if (!patch.cropId || !patch.planted) return;
  const crop = cropById.get(patch.cropId)!;
  const cropIndex = cropDefinitions.findIndex((candidate) => candidate.id === crop.id);
  const cropMaterial = materialForCrop(crop.id);
  for (let index = 0; index < 7; index++) {
    const angle = index * 2.4;
    const x = Math.cos(angle) * 0.58;
    const z = Math.sin(angle) * 0.48;
    let plant: Mesh;
    if (crop.id === "mooncap") {
      plant = MeshBuilder.CreateSphere(`${crop.name} cap`, { diameter: 0.48, segments: 8, slice: 0.58 }, scene);
      plant.scaling.set(1, 0.55, 1);
    } else if (crop.id === "emberroot") {
      plant = MeshBuilder.CreateCylinder(`${crop.name} root`, { height: 0.52, diameterTop: 0.18, diameterBottom: 0.38, tessellation: 7 }, scene);
    } else if (crop.id === "azure_cactus") {
      plant = MeshBuilder.CreateCylinder(`${crop.name} cactus`, { height: 0.68, diameter: 0.3, tessellation: 8 }, scene);
    } else if (crop.id === "ghostreed") {
      plant = MeshBuilder.CreateCylinder(`${crop.name} reed`, { height: 0.82, diameterTop: 0.08, diameterBottom: 0.16, tessellation: 7 }, scene);
    } else if (crop.id === "crimson_berry") {
      plant = MeshBuilder.CreateSphere(`${crop.name} berry`, { diameter: 0.38, segments: 8 }, scene);
    } else if (crop.id === "night_orchid") {
      plant = MeshBuilder.CreatePolyhedron(`${crop.name} flower`, { type: 2, size: 0.3 }, scene);
      plant.scaling.y = 1.35;
    } else {
      plant = MeshBuilder.CreateSphere(`${crop.name} plant`, { diameter: 0.46, segments: 8 }, scene);
      plant.scaling.set(1, 0.35 + (cropIndex % 3) * 0.12, 0.65);
    }
    plant.parent = patch.cropAnchor;
    plant.position.set(x, 0.34 + (index % 2) * 0.08, z);
    plant.rotation.y = angle;
    plant.material = cropMaterial;
    shadows.addShadowCaster(plant);
    patch.cropMeshes.push(plant);
  }
}

function refreshFarmPlotVisual(patch: ResourcePatch): void {
  patch.lockMesh.setEnabled(!patch.unlocked);
  patch.ring.isVisible = patch.unlocked && patch.stock > 0;
  if (!patch.unlocked || !patch.cropId || !patch.planted) {
    patch.cropAnchor.setEnabled(false);
    return;
  }
  patch.cropAnchor.setEnabled(true);
  const capacity = farmPlotCapacity(patch);
  const progress = Math.max(0.08, Math.min(1, (patch.stock + farmNextUnitProgress(patch)) / Math.max(1, capacity)));
  patch.cropAnchor.scaling.set(0.45 + progress * 0.55, Math.max(0.1, progress), 0.45 + progress * 0.55);
}

function createFarmPlot(slot: number, position: Vector3): ResourcePatch {
  const root = new TransformNode(`Farm plot ${slot + 1}`, scene);
  root.position.copyFrom(position);
  const soil = MeshBuilder.CreateBox(`Farm plot ${slot + 1} soil`, { width: 2.35, height: 0.16, depth: 1.72 }, scene);
  soil.parent = root;
  soil.position.y = 0.02;
  soil.material = material(`Farm soil ${slot + 1}`, slot === 0 ? new Color3(0.38, 0.24, 0.12) : new Color3(0.25, 0.23, 0.19));
  soil.receiveShadows = true;
  const cropAnchor = new TransformNode(`Farm plot ${slot + 1} crop`, scene);
  cropAnchor.parent = root;
  const ring = MeshBuilder.CreateTorus("harvest zone", { diameter: 2.15, thickness: 0.07, tessellation: 32 }, scene);
  ring.parent = root;
  ring.position.y = 0.12;
  ring.material = mats.glow;
  const lockMesh = MeshBuilder.CreatePolyhedron(`Locked farm plot ${slot + 1}`, { type: 1, size: 0.48 }, scene);
  lockMesh.parent = root;
  lockMesh.position.y = 0.62;
  lockMesh.material = mats.metal;
  const unlocked = slot === 0;
  const patch: ResourcePatch = {
    slot,
    root,
    stock: unlocked ? cropYield(cropById.get("sunleaf")!, 1) : 0,
    respawn: 0,
    remainingYield: 0,
    ring,
    cropAnchor,
    cropMeshes: [],
    lockMesh,
    unlocked,
    cropId: unlocked ? "sunleaf" : null,
    planted: unlocked,
    autoReplant: false,
  };
  rebuildFarmPlotCrop(patch);
  refreshFarmPlotVisual(patch);
  return patch;
}

for (let slot = 0; slot < 10; slot++) {
  const column = slot % 5;
  const row = Math.floor(slot / 5);
  patches.push(createFarmPlot(slot, new Vector3(-4 + column * 3, 0.1, -8 - row * 2.25)));
}

interface Dryer {
  instanceId: number;
  position: Vector3;
  root: TransformNode;
  input: number;
  output: number;
  inputQueue: ItemId[];
  outputItems: ItemId[];
  progress: number;
  capacity: number;
  ring: Mesh;
  inputMeshes: Mesh[];
  outputMeshes: Mesh[];
  staticMeshes: Mesh[];
  rotation: number;
  level: 1 | 2 | 3 | 4;
  duration: number;
  baseDuration: number;
  upgradeMeshes: Mesh[];
  activeRecipe: RecipeDefinition;
}

let nextDryerInstanceId = 1;
function createDryer(position = new Vector3(2.7, 0.33, -2.8)): Dryer {
  const root = new TransformNode("Drying Rack", scene);
  const staticMeshes = [
    ...[-1, 1].map((x) => box("dryer post", new Vector3(0.18, 1.75, 0.18), position.add(new Vector3(x, 0.79, 0)), mats.station)),
    box("dryer top", new Vector3(2.25, 0.18, 0.22), position.add(new Vector3(0, 1.62, 0)), mats.station),
    box("dryer shelf", new Vector3(2.15, 0.13, 0.85), position.add(new Vector3(0, 0.44, 0)), mats.station),
    box("dryer canopy", new Vector3(2.1, 0.08, 0.8), position.add(new Vector3(0, 1.37, 0)), mats.cloth),
  ];
  const ring = MeshBuilder.CreateTorus("dryer deposit zone", { diameter: 2.25, thickness: 0.08, tessellation: 32 }, scene);
  ring.position.set(position.x, 0.39, position.z + 1.35);
  ring.material = mats.glow;
  ring.isVisible = false;
  const capacity = stationById.get("drying_rack")?.capacity ?? 6;
  const activeRecipe = catalogRecipes.find((recipe) => recipe.input === "sunleaf" && recipe.station === "drying_rack")!;
  const duration = activeRecipe.seconds;
  const dryer: Dryer = { instanceId: nextDryerInstanceId++, position: position.clone(), root, input: 0, output: 0, inputQueue: [], outputItems: [], progress: 0, capacity, ring, inputMeshes: [], outputMeshes: [], staticMeshes, rotation: 0, level: 1, duration, baseDuration: duration, upgradeMeshes: [], activeRecipe };
  staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "drying_rack", buildingId: dryer.instanceId }; });
  return dryer;
}

const dryers = [createDryer()];

function refreshDryerOutput(dryer: Dryer): void {
  dryer.outputMeshes.forEach((mesh) => mesh.dispose());
  dryer.outputMeshes = [];
  dryer.output = dryer.outputItems.length;
  dryer.outputItems.forEach((output, i) => {
    const item = createProductMesh(output, new Vector3(dryer.position.x - 0.55 + (i % 3) * 0.52, 0.91 + Math.floor(i / 3) * 0.14, dryer.position.z), `Dryer output ${output}`);
    item.scaling.scaleInPlace(0.8);
    dryer.outputMeshes.push(item);
  });
}

function refreshDryerInput(dryer: Dryer): void {
  dryer.inputMeshes.forEach((mesh) => mesh.dispose());
  dryer.inputMeshes = [];
  dryer.input = dryer.inputQueue.length;
  dryer.inputQueue.forEach((input, i) => {
    const item = createProductMesh(input, new Vector3(dryer.position.x + 0.4 + (i % 2) * 0.48, 0.9 + Math.floor(i / 2) * 0.15, dryer.position.z), `Dryer input ${input}`);
    item.scaling.scaleInPlace(0.8);
    dryer.inputMeshes.push(item);
  });
}

function dryerRecipeForInput(item: ItemId): RecipeDefinition | undefined {
  return catalogRecipes.find((recipe) => recipe.station === "drying_rack" && recipe.input === item
    && unlockedCrops.has(catalogById.get(recipe.output)!.materialFamily as BaseMaterialId));
}

function configureDryerRecipe(dryer: Dryer, recipe: RecipeDefinition): boolean {
  if (dryer.activeRecipe === recipe) return true;
  // Mixed queues and legacy saves can put a different ingredient at the head
  // of the queue. Restart the partial cycle with the correct recipe instead
  // of leaving the rack permanently deadlocked.
  if (dryer.progress > 0) dryer.progress = 0;
  dryer.activeRecipe = recipe;
  dryer.baseDuration = recipe.seconds;
  const durationMultiplier = [1, 1, 0.8, 0.6, 0.35][dryer.level]!;
  dryer.duration = recipe.seconds * durationMultiplier;
  return true;
}

interface Processor {
  instanceId: number;
  name: string;
  stationId: Exclude<StationId, "drying_rack">;
  activeRecipe: RecipeDefinition;
  output: ItemId;
  position: Vector3;
  input: number;
  outputAmount: number;
  inputQueue: ItemId[];
  outputItems: ItemId[];
  progress: number;
  duration: number;
  capacity: number;
  ring: Mesh;
  inputMeshes: Mesh[];
  outputMeshes: Mesh[];
  staticMeshes: Mesh[];
  rotation: number;
  level: 1 | 2 | 3 | 4;
  baseDuration: number;
  upgradeMeshes: Mesh[];
}

let nextProcessorInstanceId = 1;

type ProcessorStationId = Exclude<StationId, "drying_rack">;

function defaultRecipeForStation(stationId: ProcessorStationId): RecipeDefinition {
  const recipe = catalogRecipes.find((candidate) => candidate.station === stationId);
  if (!recipe) throw new Error(`No recipe configured for ${stationId}`);
  return recipe;
}

function createProcessor(stationId: ProcessorStationId, position: Vector3, initialOutput?: ItemId): Processor {
  const definition = stationById.get(stationId)!;
  const name = definition.name;
  const recipe = catalogRecipes.find((candidate) => candidate.station === stationId && candidate.output === initialOutput)
    ?? defaultRecipeForStation(stationId);
  const output = recipe.output;
  const accent = material(`${name} recipe accent`, Color3.FromHexString(catalogById.get(output)!.color));
  const staticMeshes: Mesh[] = [];
  const stationCylinder = (part: string, height: number, diameter: number, offset: Vector3, partMaterial: StandardMaterial): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(`${name} ${part}`, { height, diameter, tessellation: 16 }, scene);
    mesh.position.copyFrom(position.add(offset));
    mesh.material = partMaterial;
    shadows.addShadowCaster(mesh);
    staticMeshes.push(mesh);
    return mesh;
  };

  if (stationId === "mortar_mill") {
    stationCylinder("round stone base", 0.58, 1.72, new Vector3(0, 0.62, 0), mats.station);
    stationCylinder("grinding plate", 0.16, 1.95, new Vector3(0, 0.98, 0), accent);
    const bowl = MeshBuilder.CreateCylinder(`${name} bowl`, { height: 0.34, diameterTop: 0.9, diameterBottom: 0.58, tessellation: 16 }, scene);
    bowl.position.copyFrom(position.add(new Vector3(-0.18, 1.22, 0)));
    bowl.material = mats.metal;
    shadows.addShadowCaster(bowl);
    staticMeshes.push(bowl);
    const pestle = stationCylinder("pestle", 1.05, 0.18, new Vector3(0.35, 1.48, 0), mats.timber);
    pestle.rotation.z = -0.62;
  } else if (stationId === "alchemists_still") {
    staticMeshes.push(box(`${name} foundation`, new Vector3(2.8, 0.2, 2.2), position.add(new Vector3(0, 0.45, 0)), mats.timber));
    staticMeshes.push(box(`${name} furnace`, new Vector3(1.7, 1.05, 1.8), position.add(new Vector3(-0.55, 0.88, 0)), mats.station));
    const vessel = MeshBuilder.CreateSphere(`${name} vessel`, { diameter: 1.25, segments: 14 }, scene);
    vessel.position.copyFrom(position.add(new Vector3(-0.55, 1.7, 0)));
    vessel.scaling.y = 1.25;
    vessel.material = mats.glass;
    shadows.addShadowCaster(vessel);
    staticMeshes.push(vessel);
    stationCylinder("condenser tower", 2.15, 0.72, new Vector3(0.9, 1.48, 0), mats.metal);
    stationCylinder("collection vat", 0.62, 0.9, new Vector3(0.9, 0.78, 0.62), mats.glass);
    staticMeshes.push(box(`${name} copper pipe`, new Vector3(1.55, 0.18, 0.18), position.add(new Vector3(0.18, 2.13, 0)), accent));
  } else if (stationId === "remedy_cauldron") {
    stationCylinder("cauldron bowl", 0.9, 1.8, new Vector3(0, 1.0, 0), mats.metal);
    stationCylinder("hearth", 0.5, 1.45, new Vector3(0, 0.52, 0), mats.station);
    for (const x of [-0.72, 0.72]) staticMeshes.push(box(`${name} handle`, new Vector3(0.18, 1.15, 0.18), position.add(new Vector3(x, 1.42, 0)), mats.timber));
  } else if (stationId === "preparation_table") {
    staticMeshes.push(box(`${name} butcher block`, new Vector3(2.4, 0.32, 1.25), position.add(new Vector3(0, 1.02, 0)), mats.station));
    for (const x of [-0.88, 0.88]) staticMeshes.push(box(`${name} trestle`, new Vector3(0.24, 0.9, 0.86), position.add(new Vector3(x, 0.58, 0)), mats.timber));
    staticMeshes.push(box(`${name} lower brace`, new Vector3(1.8, 0.16, 0.2), position.add(new Vector3(0, 0.45, 0)), mats.timber));
    staticMeshes.push(box(`${name} cutting slab`, new Vector3(1.15, 0.09, 0.76), position.add(new Vector3(-0.25, 1.23, 0)), accent));
    const knife = box(`${name} knife`, new Vector3(0.82, 0.07, 0.12), position.add(new Vector3(0.45, 1.31, 0.12)), mats.metal);
    knife.rotation.y = -0.48;
    staticMeshes.push(knife);
  } else if (stationId === "apothecary_table") {
    staticMeshes.push(box(`${name} cabinet`, new Vector3(3.2, 0.82, 1.15), position.add(new Vector3(0, 0.7, 0)), mats.timber));
    staticMeshes.push(box(`${name} marble worktop`, new Vector3(3.35, 0.18, 1.28), position.add(new Vector3(0, 1.18, 0)), mats.station));
    staticMeshes.push(box(`${name} backboard`, new Vector3(3.2, 1.15, 0.16), position.add(new Vector3(0, 1.73, 0.5)), mats.timber));
    staticMeshes.push(box(`${name} bottle shelf`, new Vector3(2.9, 0.14, 0.42), position.add(new Vector3(0, 1.72, 0.31)), mats.station));
    for (const x of [-1.05, -0.5, 0.05, 0.6, 1.12]) {
      stationCylinder("remedy bottle", 0.42 + (Math.abs(x) % 0.2), 0.24, new Vector3(x, 2.0, 0.3), accent);
    }
    stationCylinder("mixing basin", 0.13, 0.9, new Vector3(0.42, 1.34, -0.08), mats.metal);
  } else {
    staticMeshes.push(box(`${name} long worktop`, new Vector3(2.9, 0.2, 1.15), position.add(new Vector3(0, 1.12, 0)), mats.station));
    for (const x of [-1.15, 1.15]) {
      for (const z of [-0.4, 0.4]) staticMeshes.push(box(`${name} carved leg`, new Vector3(0.2, 0.82, 0.2), position.add(new Vector3(x, 0.68, z)), mats.timber));
    }
    stationCylinder("rune plate", 0.1, 1.12, new Vector3(0, 1.28, 0), accent);
    for (const x of [-0.82, 0, 0.82]) {
      const crystal = MeshBuilder.CreatePolyhedron(`${name} focus crystal`, { type: 1, size: 0.3 }, scene);
      crystal.position.copyFrom(position.add(new Vector3(x, 1.58 + (x === 0 ? 0.16 : 0), 0)));
      crystal.scaling.y = 1.7;
      crystal.material = mats.incense;
      shadows.addShadowCaster(crystal);
      staticMeshes.push(crystal);
    }
  }

  const ring = MeshBuilder.CreateTorus(`${name} interaction zone`, { diameter: 1.8, thickness: 0.07, tessellation: 28 }, scene);
  ring.position.copyFrom(position.add(new Vector3(0, 0.38, 1.18)));
  ring.material = mats.glow;
  ring.isVisible = false;
  const capacity = definition.capacity;
  const baseDuration = recipe.seconds;
  const processor: Processor = {
    instanceId: nextProcessorInstanceId++,
    name,
    stationId,
    activeRecipe: recipe,
    output,
    position,
    input: 0,
    outputAmount: 0,
    inputQueue: [],
    outputItems: [],
    progress: 0,
    duration: baseDuration,
    capacity,
    ring,
    inputMeshes: [],
    outputMeshes: [],
    staticMeshes,
    rotation: 0,
    level: 1,
    baseDuration,
    upgradeMeshes: [],
  };
  staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: stationId, buildingId: processor.instanceId }; });
  return processor;
}

function processorRecipeForInput(processor: Processor, item: ItemId): RecipeDefinition | undefined {
  return catalogRecipes.find((recipe) => recipe.station === processor.stationId && recipe.input === item
    && unlockedCrops.has(catalogById.get(recipe.output)!.materialFamily as BaseMaterialId));
}

function configureProcessorRecipe(processor: Processor, recipe: RecipeDefinition): boolean {
  if (processor.activeRecipe === recipe) return true;
  if (processor.progress > 0) processor.progress = 0;
  processor.activeRecipe = recipe;
  processor.output = recipe.output;
  processor.baseDuration = recipe.seconds;
  const durationMultiplier = [1, 1, 0.8, 0.6, 0.35][processor.level]!;
  processor.duration = recipe.seconds * durationMultiplier;
  return true;
}

function createProductMesh(item: ItemId, position: Vector3, name: string = item): Mesh {
  let mesh: Mesh;
  const crop = cropById.get(item as BaseMaterialId);
  if (crop) {
    const cropIndex = cropDefinitions.findIndex((candidate) => candidate.id === crop.id);
    if (crop.id === "mooncap" || crop.id === "crimson_berry") {
      mesh = MeshBuilder.CreateSphere(name, { diameter: 0.4, segments: 8 }, scene);
    } else if (crop.id === "emberroot" || crop.id === "azure_cactus" || crop.id === "ghostreed") {
      mesh = MeshBuilder.CreateCylinder(name, { height: 0.46, diameter: 0.3, tessellation: 8 }, scene);
    } else if (crop.id === "night_orchid") {
      mesh = MeshBuilder.CreatePolyhedron(name, { type: 2, size: 0.28 }, scene);
    } else {
      mesh = MeshBuilder.CreateSphere(name, { diameter: 0.4, segments: 8 }, scene);
      mesh.scaling.set(1, 0.45 + (cropIndex % 3) * 0.1, 0.72);
    }
    mesh.material = materialForCrop(crop.id);
  } else if (catalogById.get(item)?.category === "essence" || catalogById.get(item)?.category === "remedy") {
    mesh = MeshBuilder.CreateCylinder(name, { height: 0.52, diameter: 0.3, tessellation: 12 }, scene);
    const color = Color3.FromHexString(catalogById.get(item)!.color);
    mesh.material = material(`${item} display`, color, color.scale(0.08));
  } else if (catalogById.get(item)?.category === "powder") {
    mesh = MeshBuilder.CreateCylinder(name, { height: 0.34, diameter: 0.42, tessellation: 12 }, scene);
    mesh.material = material(`${item} display`, Color3.FromHexString(catalogById.get(item)!.color));
  } else if (catalogById.get(item)?.category === "incense" || catalogById.get(item)?.category === "charm") {
    mesh = MeshBuilder.CreateBox(name, { width: 0.54, height: 0.18, depth: 0.25 }, scene);
    mesh.material = material(`${item} display`, Color3.FromHexString(catalogById.get(item)!.color));
  } else {
    mesh = MeshBuilder.CreateBox(name, { size: 0.38 }, scene);
    mesh.material = material(`${item} display`, Color3.FromHexString(catalogById.get(item)?.color ?? "#8bd13f"));
  }
  mesh.position.copyFrom(position);
  shadows.addShadowCaster(mesh);
  return mesh;
}

function refreshProcessorOutput(processor: Processor): void {
  processor.outputMeshes.forEach((mesh) => mesh.dispose());
  processor.outputMeshes = [];
  processor.outputAmount = processor.outputItems.length;
  processor.outputItems.forEach((output, i) => {
    const offset = new Vector3(-0.5 + (i % 3) * 0.5, 1.35 + Math.floor(i / 3) * 0.38, -0.15);
    processor.outputMeshes.push(createProductMesh(output, processor.position.add(offset)));
  });
}

function refreshProcessorInput(processor: Processor): void {
  processor.inputMeshes.forEach((mesh) => mesh.dispose());
  processor.inputMeshes = [];
  processor.input = processor.inputQueue.length;
  processor.inputQueue.forEach((input, i) => {
    const item = createProductMesh(input, processor.position.add(new Vector3(0.55 - (i % 2) * 0.45, 1.32 + Math.floor(i / 2) * 0.13, 0.15)), `${processor.name} input`);
    item.scaling.scaleInPlace(0.8);
    shadows.addShadowCaster(item);
    processor.inputMeshes.push(item);
  });
}

const processors: Processor[] = [
  createProcessor("mortar_mill", new Vector3(-3.8, 0.33, -4.15), "sunleaf_powder"),
  createProcessor("alchemists_still", new Vector3(0.1, 0.33, -4.25), "sunleaf_essence"),
  createProcessor("enchanters_bench", new Vector3(-3.5, 0.33, 0.15), "sunleaf_incense"),
];
processors.forEach((processor) => { processor.ring.isVisible = false; });

interface StationStatus {
  name: string;
  position: Vector3;
  input: () => number;
  output: () => number;
  capacity: number;
  progress: () => number;
  paused: () => boolean;
  element: HTMLElement;
  counts: HTMLElement;
  bar: HTMLElement;
}

function createStationStatus(
  name: string,
  position: Vector3,
  input: () => number,
  output: () => number,
  capacity: number,
  progress: () => number,
  paused: () => boolean,
): StationStatus {
  const element = document.createElement("div");
  element.className = "station-status";
  const title = document.createElement("strong");
  title.textContent = name;
  const counts = document.createElement("span");
  const track = document.createElement("div");
  const bar = document.createElement("i");
  track.append(bar);
  element.append(title, counts, track);
  stationStatusesEl.append(element);
  return { name, position, input, output, capacity, progress, paused, element, counts, bar };
}

const stationStatuses: StationStatus[] = [
  ...dryers.map((dryer) => createStationStatus(
    "Drying Rack",
    dryer.position.add(new Vector3(0, 2.45, 0)),
    () => dryer.input,
    () => dryer.output,
    dryer.capacity,
    () => dryer.input > 0 ? dryer.progress / dryer.duration : 0,
    () => dryer.output >= dryer.capacity && dryer.input > 0,
  )),
  ...processors.map((processor) => createStationStatus(
    processor.name,
    processor.position.add(new Vector3(0, 2.45, 0)),
    () => processor.input,
    () => processor.outputAmount,
    processor.capacity,
    () => processor.input > 0 ? processor.progress / processor.duration : 0,
    () => processor.outputAmount >= processor.capacity && processor.input > 0,
  )),
];

function updateStationStatuses(): void {
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  for (const status of stationStatuses) {
    const projected = Vector3.Project(status.position, Matrix.Identity(), scene.getTransformMatrix(), viewport);
    status.element.style.left = `${projected.x}px`;
    status.element.style.top = `${projected.y}px`;
    status.element.style.display = projected.z < 0 || projected.z > 1 ? "none" : "block";
    const dryer = dryers.find((candidate) => Vector3.DistanceSquared(status.position, candidate.position.add(new Vector3(0, 2.45, 0))) < 0.1);
    const processor = processors.find((candidate) => Vector3.DistanceSquared(status.position, candidate.position.add(new Vector3(0, 2.45, 0))) < 0.1);
    const recipeText = dryer
      ? `${itemLabel(dryer.activeRecipe.input)} → ${itemLabel(dryer.activeRecipe.output)}`
      : processor ? `${itemLabel(processor.activeRecipe.input)} → ${itemLabel(processor.output)}` : "";
    const countsText = status.paused()
      ? `Output full ${status.output()}/${status.capacity} · PAUSED`
      : `In ${status.input()}/${status.capacity} · Out ${status.output()}/${status.capacity}`;
    status.counts.textContent = recipeText ? `${recipeText} · ${countsText}` : countsText;
    status.bar.style.width = `${Math.min(100, status.progress() * 100)}%`;
  }
  updateShelfStatuses(viewport);
  updateFarmPlotStatuses(viewport);
  updateWorkerWorldStatuses(viewport);
}

interface WorkerWorldStatus {
  element: HTMLElement;
  name: HTMLElement;
  activity: HTMLElement;
}

const workerWorldStatuses = new Map<number, WorkerWorldStatus>();

function workerActivity(worker: Worker): { text: string; state: "idle" | "working" | "routing" } {
  if (worker.unpaid) return { text: "Waiting for wages", state: "idle" };
  if (worker.task === "idle" || !worker.target) return { text: "Idling", state: "idle" };
  if (worker.status === "Stepping around an obstruction" || worker.status === "Waiting for a clear route" || worker.status === "Taking another route") {
    return { text: worker.status, state: "routing" };
  }
  return { text: worker.status || "Working", state: "working" };
}

function updateWorkerWorldStatuses(viewport: Viewport): void {
  const activeIds = new Set(workers.filter((worker) => worker.hired).map((worker) => worker.id));
  for (const [id, status] of workerWorldStatuses) {
    if (activeIds.has(id)) continue;
    status.element.remove();
    workerWorldStatuses.delete(id);
  }
  for (const worker of workers) {
    if (!worker.hired) continue;
    let status = workerWorldStatuses.get(worker.id);
    if (!status) {
      const element = document.createElement("div");
      element.className = "worker-world-status";
      const name = document.createElement("strong");
      const activity = document.createElement("span");
      element.append(name, activity);
      stationStatusesEl.append(element);
      status = { element, name, activity };
      workerWorldStatuses.set(worker.id, status);
    }
    const projected = Vector3.Project(worker.root.position.add(new Vector3(0, 2.15, 0)), Matrix.Identity(), scene.getTransformMatrix(), viewport);
    status.element.style.left = `${projected.x}px`;
    status.element.style.top = `${projected.y}px`;
    status.element.style.display = projected.z < 0 || projected.z > 1 ? "none" : "block";
    status.name.textContent = worker.name;
    const currentActivity = workerActivity(worker);
    status.activity.textContent = currentActivity.text;
    status.element.classList.toggle("worker-world-status--idle", currentActivity.state === "idle");
    status.element.classList.toggle("worker-world-status--routing", currentActivity.state === "routing");
  }
}

interface FarmPlotStatus {
  element: HTMLElement;
  title: HTMLElement;
  bar: HTMLElement;
  count: HTMLElement;
}

const farmPlotStatuses = new Map<number, FarmPlotStatus>();

function updateFarmPlotStatuses(viewport: Viewport): void {
  for (const patch of patches) {
    let status = farmPlotStatuses.get(patch.slot);
    if (!status) {
      const element = document.createElement("div");
      element.className = "farm-plot-world-status";
      const title = document.createElement("strong");
      const row = document.createElement("div");
      const track = document.createElement("span");
      const bar = document.createElement("i");
      const count = document.createElement("b");
      track.append(bar);
      row.append(track, count);
      element.append(title, row);
      stationStatusesEl.append(element);
      status = { element, title, bar, count };
      farmPlotStatuses.set(patch.slot, status);
    }
    if (!patch.unlocked) {
      status.element.style.display = "none";
      continue;
    }
    const projected = Vector3.Project(
      patch.root.position.add(new Vector3(0, 1.75, 0)),
      Matrix.Identity(),
      scene.getTransformMatrix(),
      viewport,
    );
    status.element.style.left = `${projected.x}px`;
    status.element.style.top = `${projected.y}px`;
    status.element.style.display = projected.z < 0 || projected.z > 1 ? "none" : "block";
    const crop = patch.cropId ? cropById.get(patch.cropId) : null;
    const capacity = farmPlotCapacity(patch);
    status.title.textContent = crop?.name ?? "Empty plot";
    status.count.textContent = crop ? `${patch.stock}/${capacity}` : "—";
    status.bar.style.width = `${farmNextUnitProgress(patch) * 100}%`;
    status.bar.style.backgroundColor = patch.stock >= capacity && capacity > 0 ? "#e4c96f" : crop?.color ?? "#879080";
    status.element.classList.toggle("farm-plot-world-status--full", capacity > 0 && patch.stock >= capacity);
  }
}

interface ShelfCapacityStatus {
  element: HTMLElement;
  bar: HTMLElement;
  count: HTMLElement;
}

const shelfCapacityStatuses = new Map<number, ShelfCapacityStatus>();

function updateShelfStatuses(viewport: Viewport): void {
  const activeIds = new Set(shelves.map((shelf) => shelf.instanceId));
  for (const [id, status] of shelfCapacityStatuses) {
    if (activeIds.has(id)) continue;
    status.element.remove();
    shelfCapacityStatuses.delete(id);
  }
  for (const shelf of shelves) {
    let status = shelfCapacityStatuses.get(shelf.instanceId);
    if (!status) {
      const element = document.createElement("div");
      element.className = "shelf-capacity-status";
      const title = document.createElement("strong");
      title.textContent = `${shelf.size[0]!.toUpperCase()}${shelf.size.slice(1)} Shelf`;
      const row = document.createElement("div");
      const track = document.createElement("span");
      const bar = document.createElement("i");
      const count = document.createElement("b");
      track.append(bar);
      row.append(track, count);
      element.append(title, row);
      stationStatusesEl.append(element);
      status = { element, bar, count };
      shelfCapacityStatuses.set(shelf.instanceId, status);
    }
    const height = shelf.size === "small" ? 2.75 : shelf.size === "medium" ? 3.9 : 4.6;
    const projected = Vector3.Project(shelf.position.add(new Vector3(0, height, 0)), Matrix.Identity(), scene.getTransformMatrix(), viewport);
    status.element.style.left = `${projected.x}px`;
    status.element.style.top = `${projected.y}px`;
    status.element.style.display = projected.z < 0 || projected.z > 1 ? "none" : "block";
    const stored = shelfItemCount(shelf);
    const ratio = Math.min(1, stored / shelf.capacity);
    status.bar.style.width = `${ratio * 100}%`;
    status.bar.style.backgroundColor = `hsl(${Math.round(120 * (1 - ratio))} 68% 52%)`;
    status.count.textContent = `${stored}/${shelf.capacity}`;
    status.count.style.color = ratio >= 0.9 ? "#ff8d86" : ratio >= 0.65 ? "#f0d16d" : "#cfe8b1";
  }
}

function updateBuildingActions(): void {
  if (!selectedBuilding || (!buildMode && !moveMode) || relocatingBuilding) return;
  const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
  const worldPosition = buildingPosition(selectedBuilding).add(new Vector3(0, 2.65, 0));
  const projected = Vector3.Project(worldPosition, Matrix.Identity(), scene.getTransformMatrix(), viewport);
  buildingActionsEl.style.left = `${projected.x}px`;
  buildingActionsEl.style.top = `${projected.y}px`;
  buildingActionsEl.classList.toggle("building-actions--hidden", projected.z < 0 || projected.z > 1);
}

interface StorageShelf {
  instanceId: number;
  position: Vector3;
  ring: Mesh;
  items: Partial<Record<ItemId, number>>;
  meshes: Mesh[];
  acceptedItems: Set<ItemId>;
  staticMeshes: Mesh[];
  rotation: number;
  size: "small" | "medium" | "large";
  capacity: number;
}

let nextShelfInstanceId = 1;
const shelfCapacities = { small: 12, medium: 24, large: 40 } as const;
function createStorageShelf(position = new Vector3(1.25, 0.33, 2.25), size: StorageShelf["size"] = "small"): StorageShelf {
  const width = size === "small" ? 2.1 : size === "medium" ? 3.4 : 4.5;
  const levels = size === "small" ? 3 : size === "medium" ? 4 : 5;
  const height = size === "small" ? 2.35 : size === "medium" ? 3.5 : 4.2;
  const staticMeshes = [
    ...[-width / 2 + 0.08, width / 2 - 0.08].map((x) => box("shelf post", new Vector3(0.16, height, 0.22), position.add(new Vector3(x, height / 2, 0)), mats.timber)),
    ...Array.from({ length: levels }, (_, index) => 0.42 + index * ((height - 0.65) / Math.max(1, levels - 1)))
      .map((y) => box("shelf board", new Vector3(width, 0.15, 0.9), position.add(new Vector3(0, y, 0)), mats.timber)),
  ];
  const ring = MeshBuilder.CreateTorus("storage interaction zone", { diameter: 2.05, thickness: 0.08, tessellation: 30 }, scene);
  ring.position.copyFrom(position.add(new Vector3(0, 0.38, 1.05)));
  ring.material = mats.glow;
  ring.isVisible = false;
  const shelf: StorageShelf = {
    instanceId: nextShelfInstanceId++,
    position,
    ring,
    items: {},
    meshes: [],
    acceptedItems: new Set<ItemId>(catalogItems.map((item) => item.id)),
    staticMeshes,
    rotation: 0,
    size,
    capacity: shelfCapacities[size],
  };
  staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "storage_shelf", buildingId: shelf.instanceId }; });
  return shelf;
}

let storage = createStorageShelf();
const shelves = [storage];

interface DiscardBin {
  instanceId: number;
  position: Vector3;
  ring: Mesh;
  staticMeshes: Mesh[];
  rotation: number;
}

let nextDiscardBinInstanceId = 1;

function createDiscardBin(position = new Vector3(1.5, 0.33, 8.5)): DiscardBin {
  const bin = MeshBuilder.CreateCylinder("Discard Bin", {
    height: 0.9,
    diameterTop: 0.82,
    diameterBottom: 0.62,
    tessellation: 12,
  }, scene);
  bin.position.copyFrom(position.add(new Vector3(0, 0.46, 0)));
  bin.material = mats.metal;
  shadows.addShadowCaster(bin);

  const rim = MeshBuilder.CreateTorus("discard bin rim", { diameter: 0.84, thickness: 0.1, tessellation: 20 }, scene);
  rim.position.copyFrom(position.add(new Vector3(0, 0.93, 0)));
  rim.material = mats.discard;
  shadows.addShadowCaster(rim);

  const ring = MeshBuilder.CreateTorus("discard interaction zone", { diameter: 1.65, thickness: 0.08, tessellation: 28 }, scene);
  ring.position.copyFrom(position.add(new Vector3(0, 0.38, 1.05)));
  ring.material = mats.discard;
  const discardBin: DiscardBin = {
    instanceId: nextDiscardBinInstanceId++,
    position,
    ring,
    staticMeshes: [bin, rim],
    rotation: 0,
  };
  discardBin.staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "discard_bin", buildingId: discardBin.instanceId }; });
  return discardBin;
}

const discardBins = [createDiscardBin()];

function nearestDiscardBin(position: Vector3): { bin: DiscardBin; index: number } | null {
  let nearest: { bin: DiscardBin; index: number } | null = null;
  let nearestDistance = Infinity;
  discardBins.forEach((bin, index) => {
    const distance = Vector3.DistanceSquared(position, bin.ring.position);
    if (distance >= nearestDistance) return;
    nearest = { bin, index };
    nearestDistance = distance;
  });
  return nearest;
}

interface CustomerOrder {
  id: number;
  slot: number;
  counterId?: number;
  customer: string;
  exactItem: ItemId | null;
  amount: number;
  delivered: number;
  accepted: boolean;
  acceptedAt: number | null;
  baseReward: number;
  rewardMultiplier: number;
  isBonus: boolean;
  patience: number;
  maxPatience: number;
  temperament: "Patient" | "Regular" | "Impatient" | "Golden";
}

const finishedProducts: ItemId[] = catalogItems
  .filter((item) => !["base", "prepared"].includes(item.category))
  .map((item) => item.id);
const productValues: Partial<Record<ItemId, number>> = Object.fromEntries(catalogItems.map((item) => [item.id, item.value]));

function availableFinishedProducts(): ItemId[] {
  const builtStations = new Set<StationId>([
    ...(dryers.length > 0 ? ["drying_rack" as const] : []),
    ...processors.map((processor) => processor.stationId),
  ]);
  const reachable = new Set<ItemId>(unlockedCrops);
  for (let pass = 0; pass < 3; pass++) {
    for (const recipe of catalogRecipes) {
      if (builtStations.has(recipe.station) && reachable.has(recipe.input)) reachable.add(recipe.output);
    }
  }
  return finishedProducts.filter((item) => reachable.has(item));
}
let coins = 24;
let astralCores = 0;
let lifetimeRevenue = 0;
let completedOrders = 0;
let purchasedUpgrades = 0;
const GOD_MODE_CORE_COST = 4;

function updateAstralCoreHud(): void {
  astralCountEl.textContent = `◆ ${astralCores}`;
  astralCountEl.setAttribute("aria-label", `${astralCores} Recipe Point${astralCores === 1 ? "" : "s"}`);
}

function rollGoldenCustomerCore(order: CustomerOrder): boolean {
  if (!order.isBonus || Math.random() >= 0.25) return false;
  const before = astralCores;
  astralCores++;
  recordBalanceEvent("currency", { currency: "astral_core", delta: 1, before, after: astralCores, cause: "golden_customer", orderId: order.id });
  updateAstralCoreHud();
  return true;
}
const customerOrders: CustomerOrder[] = [];
let nextOrderId = 1;
let orderUiTimer = 0;
const customerNames = [
  "Traveling Healer",
  "Village Scholar",
  "Young Adventurer",
  "Town Guard",
  "Wandering Priest",
  "Hedge Mage",
  "Royal Courier",
  "Mountain Merchant",
  "Noble Envoy",
  "Hooded Stranger",
];

function randomTriangular(minimum: number, maximum: number): number {
  // Averaging two rolls clusters arrivals naturally around the middle while
  // retaining occasional short and long gaps.
  return minimum + ((Math.random() + Math.random()) * 0.5) * (maximum - minimum);
}

function calculateNextArrivalDelay(counter: CustomerCounter): number {
  const counterOrders = customerOrders.filter((order) => counterForOrder(order) === counter);
  const customerCount = counterOrders.length;
  // A 0.50–0.67 interval multiplier produces arrivals roughly 1.5–2× as
  // frequently as the original pacing while preserving queue pressure.
  const fasterArrivalMultiplier = randomTriangular(0.5, 0.67);
  if (customerCount === 0) return randomTriangular(6, 13) * fasterArrivalMultiplier;
  const outstandingDemand = counterOrders.reduce((pressure, order) => {
    const remaining = Math.max(0, order.amount - order.delivered);
    return pressure + Math.max(0, remaining - 1) * 2.5 + (order.exactItem ? 1 : 0) + (order.isBonus ? 6 : 0);
  }, 0);
  let baseDelay: number;
  if (customerCount === 1) baseDelay = randomTriangular(20, 40);
  else if (customerCount === 2) baseDelay = randomTriangular(30, 50);
  else if (customerCount === 3) baseDelay = randomTriangular(40, 65);
  else {
    const minimum = Math.min(85, 48 + (customerCount - 4) * 8);
    const maximum = Math.min(125, 75 + (customerCount - 4) * 10);
    baseDelay = randomTriangular(minimum, maximum);
  }
  return Math.min(140, baseDelay + outstandingDemand) * fasterArrivalMultiplier;
}

function rescheduleAfterDeparture(counter: CustomerCounter): void {
  // A newly empty shop should recover quickly instead of honoring a long
  // delay previously calculated for a crowded queue.
  const recalculated = calculateNextArrivalDelay(counter);
  counter.arrivalTimer = Math.min(counter.arrivalTimer, recalculated);
}

function ownedFinishedProductCount(requestedItem?: ItemId): number {
  const matches = (item: ItemId) => finishedProducts.includes(item) && (!requestedItem || item === requestedItem);
  const shelfStock = shelves.reduce((total, shelf) => total
    + (Object.entries(shelf.items) as [ItemId, number][])
      .reduce((shelfTotal, [item, amount]) => shelfTotal + (matches(item) ? amount : 0), 0), 0);
  const stationStock = processors.reduce((total, processor) => total
    + processor.outputItems.filter(matches).length, 0);
  const playerStock = inventory.items.filter(matches).length;
  const workerStock = workers.reduce((total, rosterWorker) => total + rosterWorker.items.filter(matches).length, 0);
  return shelfStock + stationStock + playerStock + workerStock;
}

function finishedStockCount(): number {
  return ownedFinishedProductCount();
}

function progressionTier(): number {
  const revenueScore = Math.min(6, lifetimeRevenue / 140);
  const orderScore = Math.min(8, completedOrders * 0.8);
  const upgradeScore = Math.min(5, purchasedUpgrades * 0.8);
  const automationScore = workers.filter((rosterWorker) => rosterWorker.hired).length * 2;
  const score = revenueScore + orderScore + upgradeScore + automationScore;
  if (score < 3) return 0;
  if (score < 7) return 1;
  if (score < 13) return 2;
  if (score < 20) return 3;
  return 4;
}

function calculateOrderAmount(isBonus: boolean): number {
  const ranges: Array<[number, number]> = [
    [1, 2],
    [1, 3],
    [2, 4],
    [2, 5],
    [3, 6],
  ];
  const tier = progressionTier();
  let [minimum, maximum] = ranges[tier] ?? ranges[0]!;
  const stock = finishedStockCount();
  const outstanding = customerOrders.reduce((total, order) => total + Math.max(0, order.amount - order.delivered), 0);

  // Surplus stock invites bulk demand; a strained workshop receives relief.
  if (stock >= 12) maximum++;
  if (stock >= 22) minimum++;
  if (stock <= 2 && outstanding >= 5) maximum--;
  if (outstanding >= 14) maximum--;

  if (isBonus) {
    minimum += 1;
    maximum += 2;
  }
  minimum = Math.max(1, minimum);
  maximum = Math.max(minimum, Math.min(8, maximum));
  return Math.round(randomTriangular(minimum, maximum));
}

interface CustomerCounter {
  instanceId: number;
  position: Vector3;
  ring: Mesh;
  customers: TransformNode[];
  staticMeshes: Mesh[];
  rotation: number;
  arrivalTimer: number;
  purchaseCost: number;
}

let nextCustomerCounterInstanceId = 1;

function createCustomerCounter(position = new Vector3(5.2, 0.33, 9.6), purchaseCost = 0): CustomerCounter {
  const staticMeshes = [
    box("customer counter", new Vector3(5.1, 1.05, 0.75), position.add(new Vector3(0, 0.55, 0)), mats.timber),
    box("counter top", new Vector3(5.35, 0.18, 0.95), position.add(new Vector3(0, 1.12, 0)), mats.cloth),
  ];

  const ring = MeshBuilder.CreateTorus("customer delivery zone", { diameter: 1.8, thickness: 0.08, tessellation: 28 }, scene);
  ring.position.copyFrom(position.add(new Vector3(0, 0.38, -1.12)));
  ring.material = mats.gold;

  const customerColors = [
    new Color3(0.22, 0.42, 0.2), new Color3(0.24, 0.29, 0.52), new Color3(0.55, 0.25, 0.16),
    new Color3(0.35, 0.38, 0.43), new Color3(0.48, 0.4, 0.18), new Color3(0.34, 0.18, 0.46),
    new Color3(0.18, 0.42, 0.48), new Color3(0.48, 0.3, 0.15), new Color3(0.5, 0.16, 0.28),
    new Color3(0.12, 0.14, 0.13),
  ];
  const customers: TransformNode[] = [];
  for (let i = 0; i < 10; i++) {
    const customer = new TransformNode(`customer ${i + 1}`, scene);
    const row = Math.floor(i / 5);
    const column = i % 5;
    customer.position.copyFrom(position.add(new Vector3(-1.8 + column * 0.9, 0, 1.1 + row * 0.9)));
    const clothing = material(`customer clothing ${nextCustomerCounterInstanceId}-${i}`, customerColors[i] ?? colors.timber);
    const body = MeshBuilder.CreateCapsule(`customer body ${i}`, { height: 1.15, radius: 0.34, tessellation: 10 }, scene);
    body.parent = customer;
    body.position.y = 0.85;
    body.material = clothing;
    const head = MeshBuilder.CreateSphere(`customer head ${i}`, { diameter: 0.64, segments: 10 }, scene);
    head.parent = customer;
    head.position.y = 1.62;
    head.material = mats.skin;
    const hood = MeshBuilder.CreateSphere(`customer hood ${i}`, { diameter: 0.71, segments: 10, slice: 0.62 }, scene);
    hood.parent = customer;
    hood.position.y = 1.73;
    hood.rotation.x = Math.PI;
    hood.material = clothing;
    for (const mesh of [body, head, hood]) shadows.addShadowCaster(mesh);
    customer.setEnabled(false);
    customers.push(customer);
  }
  const counter: CustomerCounter = {
    instanceId: nextCustomerCounterInstanceId++,
    position,
    ring,
    customers,
    staticMeshes,
    rotation: 0,
    arrivalTimer: 1.5 + Math.random() * 3.5,
    purchaseCost,
  };
  staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "customer_counter", buildingId: counter.instanceId }; });
  return counter;
}

const customerCounters = [createCustomerCounter()];
customerCounters[0]!.ring.isVisible = false;

function counterForOrder(order: CustomerOrder): CustomerCounter {
  return customerCounters.find((counter) => counter.instanceId === order.counterId) ?? customerCounters[0]!;
}

function customerForOrder(order: CustomerOrder): TransformNode | undefined {
  return counterForOrder(order).customers[order.slot];
}

function refreshCustomerCounterRings(): void {
  for (const counter of customerCounters) {
    counter.ring.isVisible = customerOrders.some((order) => order.accepted && counterForOrder(order) === counter);
  }
}

function itemLabel(item: ItemId): string {
  return catalogById.get(item)?.name ?? item.split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}

function itemSummary(items: readonly ItemId[]): string {
  const counts = new Map<ItemId, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .map(([item, amount]) => `${itemLabel(item)}${amount > 1 ? ` ×${amount}` : ""}`)
    .join(", ");
}

function updateOrderCards(): void {
  orderListEl.replaceChildren();
  customerCountEl.textContent = String(customerOrders.length);
  const availableProducts = availableFinishedProducts();
  const minimum = Math.min(...availableProducts.map((item) => productValues[item] ?? 0));
  const maximum = Math.max(...availableProducts.map((item) => productValues[item] ?? 0));
  for (const order of customerOrders) {
    const patiencePercent = Math.max(0, order.patience / order.maxPatience) * 100;
    const patienceColor = patiencePercent > 55 ? "#9ed06e" : patiencePercent > 25 ? "#e3bf5d" : "#df654f";
    const card = document.createElement("aside");
    card.className = `order-card${order.isBonus ? " order-card--bonus" : ""}`;
    const ownedAmount = ownedFinishedProductCount(order.exactItem ?? undefined);
    card.innerHTML = `<span class="order-card__customer">${order.isBonus ? "✦ GOLDEN CUSTOMER · " : ""}${order.customer.toUpperCase()}</span>
      <strong class="order-card__request"><span>${order.exactItem ? itemLabel(order.exactItem) : "Any Finished Product"} × ${order.amount}</span><small>(Owned: ${ownedAmount})</small></strong>
      <span>Reward: ${order.exactItem
        ? Math.round((productValues[order.exactItem] ?? 0) * order.amount * order.rewardMultiplier) + order.baseReward
        : `${Math.round(minimum * order.amount * order.rewardMultiplier) + order.baseReward}–${Math.round(maximum * order.amount * order.rewardMultiplier) + order.baseReward}`} coins</span>
      <span class="order-card__status">Delivered ${order.delivered}/${order.amount}</span>
      <div class="order-card__actions"><button data-action="refuse" data-id="${order.id}">Refuse order</button></div>
      <span class="order-card__status">${order.temperament} · ${Math.ceil(order.patience)}s</span>
      <div class="order-card__patience"><i style="width:${patiencePercent}%;background:${patienceColor}"></i></div>`;
    orderListEl.append(card);
  }
}

orderDrawerEl.addEventListener("toggle", () => {
  if (orderDrawerEl.open) managementPanelEl.classList.add("management-panel--hidden");
});

function spawnCustomer(counter: CustomerCounter): void {
  const counterOrders = customerOrders.filter((order) => counterForOrder(order) === counter);
  if (counterOrders.length >= 10) return;
  const occupiedSlots = new Set(counterOrders.map((order) => order.slot));
  const slot = Array.from({ length: 10 }, (_, index) => index).find((index) => !occupiedSlots.has(index));
  if (slot === undefined) return;
  const exact = Math.random() < 0.62;
  const isBonus = Math.random() < 0.08;
  const orderAmount = calculateOrderAmount(isBonus);
  const temperamentRoll = Math.random();
  const temperament: CustomerOrder["temperament"] = isBonus
    ? "Golden"
    : temperamentRoll < 0.2 ? "Impatient" : temperamentRoll < 0.48 ? "Patient" : "Regular";
  const patienceRange: Record<CustomerOrder["temperament"], [number, number]> = {
    Impatient: [42, 62],
    Regular: [72, 102],
    Patient: [105, 145],
    Golden: [120, 165],
  };
  const [minimumPatience, maximumPatience] = patienceRange[temperament];
  const quantityPatienceBonus = Math.max(0, orderAmount - 2) * 8;
  const patience = randomTriangular(minimumPatience, maximumPatience) + quantityPatienceBonus;
  const availableProducts = availableFinishedProducts();
  const requested = availableProducts[Math.floor(Math.random() * availableProducts.length)] ?? "sunleaf_powder";
  const activeNames = new Set(customerOrders.map((order) => order.customer));
  const availableNames = customerNames.filter((name) => !activeNames.has(name));
  const customer = availableNames[Math.floor(Math.random() * availableNames.length)] ?? `Traveler ${nextOrderId}`;
  customerOrders.push({
    id: nextOrderId++,
    slot,
    counterId: counter.instanceId,
    customer,
    exactItem: exact ? requested : null,
    amount: orderAmount,
    delivered: 0,
    accepted: true,
    acceptedAt: performance.now(),
    baseReward: isBonus ? 55 : 8,
    rewardMultiplier: isBonus ? 2.5 : 1,
    isBonus,
    patience,
    maxPatience: patience,
    temperament,
  });
  recordBalanceEvent("customer_arrived", {
    orderId: nextOrderId - 1,
    counterId: counter.instanceId,
    item: exact ? requested : null,
    amount: orderAmount,
    baseReward: isBonus ? 55 : 8,
    rewardMultiplier: isBonus ? 2.5 : 1,
    temperament,
    patience: roundedBalanceValue(patience),
  });
  counter.customers[slot]?.setEnabled(true);
  counter.ring.isVisible = true;
  updateOrderCards();
  hintEl.textContent = "A customer has arrived with a request";
}

function updateCustomerPatience(dt: number): void {
  let someoneLeft = false;
  const departedCounters = new Set<CustomerCounter>();
  for (let index = customerOrders.length - 1; index >= 0; index--) {
    const order = customerOrders[index]!;
    order.patience = Math.max(0, order.patience - dt);
    if (order.patience <= 0) {
      recordBalanceEvent("order_expired", { orderId: order.id, item: order.exactItem, amount: order.amount, delivered: order.delivered, temperament: order.temperament });
      departedCounters.add(counterForOrder(order));
      customerForOrder(order)?.setEnabled(false);
      customerOrders.splice(index, 1);
      hintEl.textContent = `${order.customer} lost patience and left`;
      someoneLeft = true;
    }
  }
  if (someoneLeft) {
    refreshCustomerCounterRings();
    departedCounters.forEach((counter) => rescheduleAfterDeparture(counter));
  }
  orderUiTimer -= dt;
  if (someoneLeft || orderUiTimer <= 0) {
    orderUiTimer = 0.25;
    updateOrderCards();
  }
}

orderListEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;
  const id = Number(button.dataset.id);
  const order = customerOrders.find((candidate) => candidate.id === id);
  if (!order) return;
  const counter = counterForOrder(order);
  recordBalanceEvent("order_refused", { orderId: order.id, item: order.exactItem, amount: order.amount, delivered: order.delivered, temperament: order.temperament });
  customerForOrder(order)?.setEnabled(false);
  customerOrders.splice(customerOrders.indexOf(order), 1);
  rescheduleAfterDeparture(counter);
  hintEl.textContent = `${order.customer}'s request refused`;
  refreshCustomerCounterRings();
  updateOrderCards();
});

type WorkerTask =
  | "idle"
  | "harvest"
  | "plant"
  | "tend"
  | "supply_dryer"
  | "collect_dryer"
  | "supply_processor"
  | "collect_processor"
  | "stock_shelf"
  | "collect_sale"
  | "deliver_sale"
  | "discard_items";

interface Worker {
  id: number;
  name: string;
  root: TransformNode;
  carryAnchor: TransformNode;
  hired: boolean;
  items: ItemId[];
  capacity: number;
  task: WorkerTask;
  target: Vector3 | null;
  targetIndex: number;
  orderId: number | null;
  cooldown: number;
  speed: number;
  speedLevel: number;
  capacityLevel: number;
  production: boolean;
  stocking: boolean;
  sales: boolean;
  route: string;
  status: string;
  suitability: { alchemy: number; hauling: number; farming: number; trading: number };
  allowedFacilities: string[];
  positiveTrait: string;
  negativeTrait: string;
  wagePerMinute: number;
  unpaid: boolean;
  navigationPath: Vector3[];
  stationMemory: Record<string, number>;
  stuckTime: number;
  progressAnchor: Vector3;
  noProgressTime: number;
  role: "generalist" | "alchemist" | "hauler" | "farmer" | "merchant";
  priorities: { production: number; stocking: number; sales: number; farming: number };
}

const WORKER_BASE_SPEED = 2.1;
const WORKER_SPEED_PER_LEVEL = 0.25;
const WORKER_MAX_SPEED_LEVEL = 6;
const WORKER_BASE_CAPACITY = 2;
const WORKER_MAX_CAPACITY = 5;

function workerSpeedForLevel(level: number): number {
  return WORKER_BASE_SPEED + (Math.max(1, level) - 1) * WORKER_SPEED_PER_LEVEL;
}

function workerCapacityForLevel(level: number): number {
  return Math.min(WORKER_MAX_CAPACITY, WORKER_BASE_CAPACITY + Math.max(0, level - 1));
}

interface WorkerDebugEntry {
  at: string;
  session: string;
  event: string;
  worker?: { id: number; name: string; task: WorkerTask; status: string; position: [number, number]; target: [number, number] | null; targetIndex: number; pathNodes: number };
  details?: Record<string, unknown>;
}

const WORKER_DEBUG_KEY = "farming-unlimited-worker-debug-v1";
const WORKER_DEBUG_MEMORY_LIMIT = 10_000;
const WORKER_DEBUG_PERSIST_LIMIT = 1_000;
const workerDebugSession = Date.now().toString(36);
let workerDebugEntries: WorkerDebugEntry[] = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKER_DEBUG_KEY) ?? "[]") as WorkerDebugEntry[];
    return Array.isArray(stored) ? stored.slice(-WORKER_DEBUG_PERSIST_LIMIT) : [];
  } catch { return []; }
})();
let workerDebugPersistTimer = 0;
workerDebugStatusEl.textContent = `${workerDebugEntries.length} navigation events ready to download`;

function roundedXZ(point: Vector3): [number, number] {
  return [Number(point.x.toFixed(3)), Number(point.z.toFixed(3))];
}

function recordWorkerDebug(event: string, rosterWorker?: Worker, details?: Record<string, unknown>): void {
  workerDebugEntries.push({
    at: new Date().toISOString(),
    session: workerDebugSession,
    event,
    worker: rosterWorker ? {
      id: rosterWorker.id,
      name: rosterWorker.name,
      task: rosterWorker.task,
      status: rosterWorker.status,
      position: roundedXZ(rosterWorker.root.position),
      target: rosterWorker.target ? roundedXZ(rosterWorker.target) : null,
      targetIndex: rosterWorker.targetIndex,
      pathNodes: rosterWorker.navigationPath.length,
    } : undefined,
    details,
  });
  if (workerDebugEntries.length > WORKER_DEBUG_MEMORY_LIMIT) {
    workerDebugEntries.splice(0, workerDebugEntries.length - WORKER_DEBUG_MEMORY_LIMIT);
  }
  window.clearTimeout(workerDebugPersistTimer);
  workerDebugPersistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(WORKER_DEBUG_KEY, JSON.stringify(workerDebugEntries.slice(-WORKER_DEBUG_PERSIST_LIMIT)));
    } catch {
      // The downloadable in-memory log remains available if browser storage
      // is full or disabled.
    }
    workerDebugStatusEl.textContent = `${workerDebugEntries.length} navigation events ready to download`;
  }, 400);
}

function workerDebugText(): string {
  const sessions = [...new Set(workerDebugEntries.map((entry) => entry.session))];
  const eventNames = [...new Set(workerDebugEntries.map((entry) => entry.event))];
  const taskNames = [...new Set(workerDebugEntries.flatMap((entry) => entry.worker ? [entry.worker.task] : []))];
  const statuses = [...new Set(workerDebugEntries.flatMap((entry) => entry.worker ? [entry.worker.status] : []))];
  const workerKeys = [...new Set(workerDebugEntries.flatMap((entry) => entry.worker ? [`${entry.session}:${entry.worker.id}`] : []))];
  const workerDefinitions = workerKeys.map((key) => {
    const entry = workerDebugEntries.find((candidate) => candidate.worker && `${candidate.session}:${candidate.worker.id}` === key)!;
    return [sessions.indexOf(entry.session), entry.worker!.id, entry.worker!.name] as const;
  });
  const header = {
    r: "h",
    fmt: "fu-wdbg",
    v: 2,
    at: Date.now(),
    count: workerDebugEntries.length,
    cols: ["record", "timeMs", "session", "event", "worker", "task", "status", "positionXZ", "targetXZ", "targetIndex", "pathNodes", "details"],
    dict: { sessions, events: eventNames, tasks: taskNames, statuses, workers: workerDefinitions },
  };
  return [
    JSON.stringify(header),
    ...workerDebugEntries.map((entry) => {
      const rosterWorker = entry.worker;
      const workerKey = rosterWorker ? `${entry.session}:${rosterWorker.id}` : "";
      return JSON.stringify([
        "e",
        Date.parse(entry.at),
        sessions.indexOf(entry.session),
        eventNames.indexOf(entry.event),
        rosterWorker ? workerKeys.indexOf(workerKey) : -1,
        rosterWorker ? taskNames.indexOf(rosterWorker.task) : -1,
        rosterWorker ? statuses.indexOf(rosterWorker.status) : -1,
        rosterWorker?.position ?? null,
        rosterWorker?.target ?? null,
        rosterWorker?.targetIndex ?? -1,
        rosterWorker?.pathNodes ?? 0,
        entry.details ?? null,
      ]);
    }),
  ].join("\n") + "\n";
}

downloadWorkerDebugEl.addEventListener("click", () => {
  if (workerDebugEntries.length === 0) {
    workerDebugStatusEl.textContent = "The diagnostic log is empty";
    return;
  }
  const blob = new Blob([workerDebugText()], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `farming-unlimited-worker-debug-${timestamp}.jsonl`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  workerDebugStatusEl.textContent = `Downloaded ${workerDebugEntries.length} structured events`;
});

clearWorkerDebugEl.addEventListener("click", () => {
  workerDebugEntries = [];
  window.clearTimeout(workerDebugPersistTimer);
  localStorage.removeItem(WORKER_DEBUG_KEY);
  workerDebugStatusEl.textContent = "Diagnostic log cleared";
});

interface BalanceDebugEntry {
  at: number;
  session: string;
  gameTime: number;
  kind: "event" | "snapshot";
  name: string;
  data: Record<string, unknown>;
}

const BALANCE_DEBUG_KEY = "farming-unlimited-balance-debug-v1";
const BALANCE_DEBUG_MEMORY_LIMIT = 25_000;
const BALANCE_DEBUG_PERSIST_LIMIT = 250;
const BALANCE_SNAPSHOT_INTERVAL = 60;
const balanceDebugSession = Date.now().toString(36);
let balanceSnapshotTimer = BALANCE_SNAPSHOT_INTERVAL;
let balanceDebugPersistTimer = 0;
let balanceDebugEntries: BalanceDebugEntry[] = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(BALANCE_DEBUG_KEY) ?? "[]") as BalanceDebugEntry[];
    return Array.isArray(stored) ? stored.slice(-BALANCE_DEBUG_PERSIST_LIMIT) : [];
  } catch { return []; }
})();
balanceDebugStatusEl.textContent = `${balanceDebugEntries.length} balance records ready to download`;

function roundedBalanceValue(value: number): number {
  return Number(value.toFixed(3));
}

function balanceItemCounts(items: readonly ItemId[]): Partial<Record<ItemId, number>> {
  return Object.fromEntries(Object.entries(groupItems(items)).filter(([, amount]) => amount > 0));
}

function balanceStateSnapshot(): Record<string, unknown> {
  return {
    economy: {
      coins,
      astralCores,
      lifetimeRevenue,
      completedOrders,
      purchasedUpgrades,
      progressionTier: progressionTier(),
      payrollDueIn: roundedBalanceValue(payrollTimer),
      wagesPerMinute: workers.filter((candidate) => candidate.hired).reduce((total, candidate) => total + candidate.wagePerMinute, 0),
    },
    progression: {
      saveSlot: storedGameSettings.activeSlot,
      questStage,
      unlockedCrops: [...unlockedCrops],
      cropGenetics: { ...cropGenetics },
      unlockedPlots: patches.filter((patch) => patch.unlocked).length,
      workerSlots: workerSlotCount,
      playTimeSeconds: roundedBalanceValue(playTimeSeconds),
      timeScale,
    },
    player: {
      inventory: balanceItemCounts(inventory.items),
      carried: inventory.items.length,
      capacity: inventory.capacity,
      stamina: roundedBalanceValue(stamina),
      stats: { ...playerStats },
    },
    farm: patches.map((patch) => ({
      slot: patch.slot + 1,
      unlocked: patch.unlocked,
      crop: patch.cropId,
      planted: patch.planted,
      stock: patch.stock,
      capacity: farmPlotCapacity(patch),
      remainingYield: patch.remainingYield,
      nextIn: roundedBalanceValue(Math.max(0, patch.respawn)),
      autoReplant: patch.autoReplant,
    })),
    dryers: dryers.map((dryer) => ({
      id: dryer.instanceId,
      level: dryer.level,
      capacity: dryer.capacity,
      input: balanceItemCounts(dryer.inputQueue),
      output: balanceItemCounts(dryer.outputItems),
      recipe: dryer.activeRecipe.output,
      progress: roundedBalanceValue(dryer.duration > 0 ? dryer.progress / dryer.duration : 0),
    })),
    processors: processors.map((processor) => ({
      id: processor.instanceId,
      station: processor.stationId,
      level: processor.level,
      capacity: processor.capacity,
      input: balanceItemCounts(processor.inputQueue),
      output: balanceItemCounts(processor.outputItems),
      recipe: processor.activeRecipe.output,
      progress: roundedBalanceValue(processor.duration > 0 ? processor.progress / processor.duration : 0),
    })),
    shelves: shelves.map((shelf) => ({
      id: shelf.instanceId,
      size: shelf.size,
      used: shelfItemCount(shelf),
      capacity: shelf.capacity,
      items: Object.fromEntries((Object.entries(shelf.items) as [ItemId, number][]).filter(([, amount]) => amount > 0)),
    })),
    sales: {
      counters: customerCounters.map((counter) => ({
        id: counter.instanceId,
        nextArrivalIn: roundedBalanceValue(Math.max(0, counter.arrivalTimer)),
        customers: customerOrders.filter((order) => counterForOrder(order) === counter).length,
      })),
      orders: customerOrders.map((order) => ({
        id: order.id,
        counterId: counterForOrder(order).instanceId,
        item: order.exactItem,
        amount: order.amount,
        delivered: order.delivered,
        rewardMultiplier: order.rewardMultiplier,
        baseReward: order.baseReward,
        temperament: order.temperament,
        patience: roundedBalanceValue(order.patience),
        maxPatience: roundedBalanceValue(order.maxPatience),
      })),
    },
    workers: workers.filter((candidate) => candidate.hired).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      role: candidate.role,
      traits: [candidate.positiveTrait, candidate.negativeTrait],
      suitability: candidate.suitability,
      priorities: candidate.priorities,
      wage: candidate.wagePerMinute,
      unpaid: candidate.unpaid,
      capacity: candidate.capacity,
      speed: roundedBalanceValue(candidate.speed),
      task: candidate.task,
      carried: balanceItemCounts(candidate.items),
      facilities: candidate.allowedFacilities,
    })),
    buildings: {
      discardBins: discardBins.length,
      counters: customerCounters.length,
      shelves: shelves.length,
      dryers: dryers.length,
      processors: processors.length,
    },
  };
}

function persistBalanceDebugSoon(): void {
  window.clearTimeout(balanceDebugPersistTimer);
  balanceDebugPersistTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(BALANCE_DEBUG_KEY, JSON.stringify(balanceDebugEntries.slice(-BALANCE_DEBUG_PERSIST_LIMIT)));
    } catch {
      // The complete current-session history remains downloadable from memory.
    }
    balanceDebugStatusEl.textContent = `${balanceDebugEntries.length} balance records ready to download`;
  }, 500);
}

function appendBalanceDebug(entry: BalanceDebugEntry): void {
  balanceDebugEntries.push(entry);
  if (balanceDebugEntries.length > BALANCE_DEBUG_MEMORY_LIMIT) {
    balanceDebugEntries.splice(0, balanceDebugEntries.length - BALANCE_DEBUG_MEMORY_LIMIT);
  }
  persistBalanceDebugSoon();
}

function recordBalanceEvent(name: string, data: Record<string, unknown> = {}): void {
  appendBalanceDebug({ at: Date.now(), session: balanceDebugSession, gameTime: roundedBalanceValue(playTimeSeconds), kind: "event", name, data });
}

function recordBalanceSnapshot(reason: string): void {
  appendBalanceDebug({ at: Date.now(), session: balanceDebugSession, gameTime: roundedBalanceValue(playTimeSeconds), kind: "snapshot", name: reason, data: balanceStateSnapshot() });
}

function balanceDebugText(): string {
  const exportEntries = [
    ...balanceDebugEntries,
    { at: Date.now(), session: balanceDebugSession, gameTime: roundedBalanceValue(playTimeSeconds), kind: "snapshot" as const, name: "export", data: balanceStateSnapshot() },
  ];
  const sessions = [...new Set(exportEntries.map((entry) => entry.session))];
  const names = [...new Set(exportEntries.map((entry) => entry.name))];
  const header = {
    r: "h",
    fmt: "fu-bal",
    v: 1,
    at: Date.now(),
    count: exportEntries.length,
    cols: {
      e: ["record", "timeMs", "gameTimeSeconds", "session", "event", "data"],
      s: ["record", "timeMs", "gameTimeSeconds", "session", "reason", "state"],
    },
    dict: { sessions, names },
  };
  return [
    JSON.stringify(header),
    ...exportEntries.map((entry) => JSON.stringify([
      entry.kind === "event" ? "e" : "s",
      entry.at,
      entry.gameTime,
      sessions.indexOf(entry.session),
      names.indexOf(entry.name),
      entry.data,
    ])),
  ].join("\n") + "\n";
}

downloadBalanceDebugEl.addEventListener("click", () => {
  const blob = new Blob([balanceDebugText()], { type: "application/x-ndjson;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = url;
  link.download = `farming-unlimited-balance-debug-${timestamp}.jsonl`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  balanceDebugStatusEl.textContent = `Downloaded ${balanceDebugEntries.length} records plus current state`;
});

clearBalanceDebugEl.addEventListener("click", () => {
  balanceDebugEntries = [];
  balanceSnapshotTimer = BALANCE_SNAPSHOT_INTERVAL;
  window.clearTimeout(balanceDebugPersistTimer);
  localStorage.removeItem(BALANCE_DEBUG_KEY);
  balanceDebugStatusEl.textContent = "Balance log cleared";
});

function updateBalanceDiagnostics(dt: number): void {
  balanceSnapshotTimer -= dt;
  if (balanceSnapshotTimer > 0) return;
  balanceSnapshotTimer += BALANCE_SNAPSHOT_INTERVAL;
  recordBalanceSnapshot("periodic");
}

const workerFirstNames = ["Alda", "Ansel", "Beren", "Brina", "Cassian", "Cora", "Darian", "Delia", "Edric", "Elara", "Fenric", "Fiora", "Galen", "Greta", "Hadrian", "Hester", "Isolde", "Jorin", "Kael", "Liora", "Maren", "Nessa", "Orin", "Petra", "Quill", "Rowan", "Selene", "Tobin", "Vera", "Wulfric"];
const positiveWorkerTraits = [
  { trait: "Green Thumb", surname: "Greenhand", suitability: "farming" as const },
  { trait: "Fleet-footed", surname: "Quickstep", suitability: "hauling" as const },
  { trait: "Silver Tongue", surname: "Coinfriend", suitability: "trading" as const },
  { trait: "Arcane Focus", surname: "Brightflask", suitability: "alchemy" as const },
  { trait: "Strong Back", surname: "Broadshoulder", suitability: "hauling" as const },
  { trait: "Patient Hands", surname: "Steadyhand", suitability: "alchemy" as const },
];
const negativeWorkerTraits = [
  { trait: "Drowsy", epithet: "the Drowsy" }, { trait: "Clumsy", epithet: "Tanglefoot" },
  { trait: "Wasteful", epithet: "the Lavish" }, { trait: "Slow Learner", epithet: "Softwit" },
  { trait: "Shy", epithet: "the Quiet" }, { trait: "Restless", epithet: "Wanderfoot" },
];
const workerTraitDescriptions: Record<string, string> = {
  "Green Thumb": "Farming suitability +2. Crops grow and harvest more efficiently.",
  "Fleet-footed": "Hauling suitability +2. Moves goods between stations faster.",
  "Silver Tongue": "Trading suitability +2. Earns 15% more coins from customer orders.",
  "Arcane Focus": "Alchemy suitability +2. Works production stations more efficiently.",
  "Strong Back": "Hauling suitability +2. Carries and transports goods efficiently.",
  "Patient Hands": "Alchemy suitability +2. Handles long crafting tasks reliably.",
  Drowsy: "Moves more slowly while working.",
  Clumsy: "Moves slightly less efficiently between tasks.",
  Wasteful: "Has a higher ongoing wage.",
  "Slow Learner": "Worker upgrade costs are increased.",
  Shy: "Customer service tasks are slower.",
  Restless: "Will eventually prefer changing tasks instead of repeating one.",
};
const workerSuitabilityDescriptions: Record<string, string> = {
  "⚗": "Alchemy: crafting and processing stations",
  "📦": "Hauling: carrying goods and stocking shelves",
  "🌿": "Farming: planting and harvesting crops",
  "🪙": "Trading: serving and delivering customer orders",
};
const MAX_WORKER_SLOTS = 8;
const MAX_APPLICATIONS_PER_SLOT = 5;

interface WorkerApplication {
  id: number;
  name: string;
  positiveTrait: string;
  negativeTrait: string;
  suitability: Worker["suitability"];
  hireCost: number;
  wagePerMinute: number;
}

const workerApplications = new Map<number, WorkerApplication[]>();
const applicationRefillTimers = new Map<number, number>();
let nextApplicationId = 1;

function randomWorkerProfile(id: number): { name: string; positiveTrait: string; negativeTrait: string; suitability: Worker["suitability"] } {
  const positive = positiveWorkerTraits[Math.floor(Math.random() * positiveWorkerTraits.length)]!;
  const negative = negativeWorkerTraits[Math.floor(Math.random() * negativeWorkerTraits.length)]!;
  const first = workerFirstNames[Math.floor(Math.random() * workerFirstNames.length)]!;
  const suitability = { alchemy: 1, hauling: 1, farming: 1, trading: 1 };
  suitability[positive.suitability] = 3;
  const secondary = (["alchemy", "hauling", "farming", "trading"] as const)[id % 4]!;
  suitability[secondary] = Math.max(suitability[secondary], 2);
  return { name: `${first} ${positive.surname} ${negative.epithet}`, positiveTrait: positive.trait, negativeTrait: negative.trait, suitability };
}

function createWorkerApplication(slot: number): WorkerApplication {
  const profile = randomWorkerProfile(slot + nextApplicationId);
  const aptitude = Math.max(...Object.values(profile.suitability));
  const wagePerMinute = 5 + slot * 2 + aptitude * 2 + (profile.negativeTrait === "Wasteful" ? 3 : 0);
  return { id: nextApplicationId++, ...profile, hireCost: 20 + (slot - 1) * 80 + (aptitude - 1) * 25, wagePerMinute };
}

function ensureWorkerApplications(slot: number, fill = false): WorkerApplication[] {
  const applications = workerApplications.get(slot) ?? [];
  workerApplications.set(slot, applications);
  if (fill) while (applications.length < MAX_APPLICATIONS_PER_SLOT) applications.push(createWorkerApplication(slot));
  return applications;
}

function createWorker(id = 1, savedName?: string): Worker {
  const profile = randomWorkerProfile(id);
  const name = savedName ?? profile.name;
  const root = new TransformNode(name, scene);
  root.position.set(-0.2 + (id - 1) * 0.7, 0.33, 3.4);
  const body = MeshBuilder.CreateCapsule(`${name} body`, { height: 1.16, radius: 0.34, tessellation: 10 }, scene);
  body.parent = root;
  body.position.y = 0.84;
  body.material = mats.playerTrim;
  const head = MeshBuilder.CreateSphere("Mira head", { diameter: 0.64, segments: 10 }, scene);
  head.parent = root;
  head.position.y = 1.61;
  head.material = mats.skin;
  const cap = MeshBuilder.CreateSphere("Mira cap", { diameter: 0.7, segments: 10, slice: 0.55 }, scene);
  cap.parent = root;
  cap.position.y = 1.74;
  cap.rotation.x = Math.PI;
  cap.material = mats.player;
  for (const mesh of [body, head, cap]) shadows.addShadowCaster(mesh);
  const carryAnchor = new TransformNode("Mira carried items", scene);
  carryAnchor.parent = root;
  carryAnchor.position.set(0, 1.15, -0.38);
  root.setEnabled(false);
  return {
    id,
    name,
    root,
    carryAnchor,
    hired: false,
    items: [],
    capacity: workerCapacityForLevel(1),
    task: "idle",
    target: null,
    targetIndex: -1,
    orderId: null,
    cooldown: 0,
    speed: workerSpeedForLevel(1),
    speedLevel: 1,
    capacityLevel: 1,
    production: true,
    stocking: true,
    sales: true,
    route: "sunleaf_powder",
    status: "Waiting for work",
    suitability: profile.suitability,
    allowedFacilities: ["farm", "drying_rack", "preparation_table", "mortar_mill", "alchemists_still", "remedy_cauldron", "apothecary_table", "enchanters_bench"],
    positiveTrait: profile.positiveTrait,
    negativeTrait: profile.negativeTrait,
    wagePerMinute: 7 + id * 2,
    unpaid: false,
    navigationPath: [],
    stationMemory: {},
    stuckTime: 0,
    progressAnchor: root.position.clone(),
    noProgressTime: 0,
    role: "generalist",
    priorities: { production: 2, stocking: 2, sales: 2, farming: 2 },
  };
}

let worker = createWorker();
const workers: Worker[] = [worker];
let workerSlotCount = 1;
let selectedWorkerId = 1;
const workerNames = Array.from({ length: MAX_WORKER_SLOTS }, (_, index) => randomWorkerProfile(index + 1).name);

function selectedWorker(): Worker {
  return workers.find((candidate) => candidate.id === selectedWorkerId) ?? workers[0]!;
}

function stationMemoryKeysForFacility(facilityId: string): string[] {
  if (facilityId === "farm") return patches.filter((patch) => patch.unlocked).map((patch) => `patch:${patch.slot}`);
  if (facilityId === "drying_rack") return dryers.map((dryer) => `dryer:${dryer.instanceId}`);
  return processors.filter((processor) => processor.stationId === facilityId).map((processor) => `processor:${processor.instanceId}`);
}

function normalizeWorkerFacilities(facilities: string[] | undefined, legacyRoute: string): string[] {
  const legacyStations: Record<string, ProcessorStationId> = {
    sunleaf_powder: "mortar_mill",
    sunleaf_essence: "alchemists_still",
    sunleaf_incense: "enchanters_bench",
  };
  const source = facilities ?? ["farm", "drying_rack", legacyRoute];
  return [...new Set(source.map((facility) => legacyStations[facility] ?? facility))];
}

function recalculateWorkerStationPriorities(rosterWorker: Worker, facilityId: string, enabled: boolean): void {
  const keys = stationMemoryKeysForFacility(facilityId);
  if (!enabled) {
    for (const key of keys) delete rosterWorker.stationMemory[key];
    return;
  }
  // A newly enabled station starts at the current average workload. Existing
  // stations keep their relative history instead of being reset.
  const existingScores = Object.values(rosterWorker.stationMemory);
  const average = existingScores.length > 0 ? existingScores.reduce((total, score) => total + score, 0) / existingScores.length : 0;
  for (const key of keys) if (rosterWorker.stationMemory[key] === undefined) rosterWorker.stationMemory[key] = average;
}

function syncWorkerControls(): void {
  const selected = selectedWorker();
  const rosterEl = document.querySelector<HTMLElement>("#worker-roster")!;
  rosterEl.replaceChildren();
  for (let slot = 1; slot <= workerNames.length; slot++) {
    const rosterWorker = workers.find((candidate) => candidate.id === slot);
    const card = document.createElement("article");
    card.className = `worker-card${slot === selectedWorkerId ? " worker-card--selected" : ""}${slot > workerSlotCount ? " worker-card--locked" : ""}`;
    if (slot > workerSlotCount) {
      const unlockCost = 300 * (slot - 1) * (slot - 1);
      card.innerHTML = `<div class="worker-card__portrait">🔒</div><strong>Worker slot ${slot}</strong><span class="worker-card__unlock-price">${unlockCost} coins</span>`;
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.textContent = slot === workerSlotCount + 1 ? "Unlock slot" : "Unlock previous slot first";
      unlock.disabled = slot !== workerSlotCount + 1;
      unlock.addEventListener("click", () => unlockWorkerSlotEl.click());
      card.append(unlock);
    } else if (rosterWorker && !rosterWorker.hired) {
      card.classList.add("worker-card--applications");
      card.innerHTML = `<strong class="worker-card__name">Job applications · Slot ${slot}</strong><small class="worker-card__status">Choose one applicant</small>`;
      const list = document.createElement("div");
      list.className = "worker-applications";
      const applications = ensureWorkerApplications(slot, true);
      for (const application of applications) {
        const row = document.createElement("div");
        row.className = "worker-application";
        row.innerHTML = `<div><strong>${application.name}</strong><small data-tooltip="${workerTraitDescriptions[application.positiveTrait] ?? application.positiveTrait}">+ ${application.positiveTrait}</small><small data-tooltip="${workerTraitDescriptions[application.negativeTrait] ?? application.negativeTrait}">− ${application.negativeTrait}</small><span data-tooltip="Alchemy · Hauling · Farming · Trading">⚗${application.suitability.alchemy} 📦${application.suitability.hauling} 🌿${application.suitability.farming} 🪙${application.suitability.trading} · ${application.wagePerMinute}🪙/min</span></div>`;
        const ratingSpan = row.querySelector("span");
        if (ratingSpan) {
          ratingSpan.innerHTML = [
            ["⚗", application.suitability.alchemy], ["📦", application.suitability.hauling],
            ["🌿", application.suitability.farming], ["🪙", application.suitability.trading],
          ].map(([icon, rating]) => `<i data-tooltip="${workerSuitabilityDescriptions[String(icon)]}">${icon}${rating}</i>`).join(" ") + ` · ${application.wagePerMinute}🪙/min`;
        }
        const controls = document.createElement("div");
        const hire = document.createElement("button");
        hire.type = "button";
        hire.textContent = `Hire · ${application.hireCost}`;
        hire.addEventListener("click", () => hireWorkerApplication(slot, application.id));
        const discard = document.createElement("button");
        discard.type = "button";
        discard.className = "worker-application__discard";
        discard.textContent = "×";
        discard.addEventListener("click", () => discardWorkerApplication(slot, application.id));
        controls.append(hire, discard);
        row.append(controls);
        list.append(row);
      }
      if (applications.length < MAX_APPLICATIONS_PER_SLOT) {
        const waiting = document.createElement("small");
        waiting.className = "worker-application__waiting";
        waiting.textContent = "A new application is expected soon…";
        list.append(waiting);
      }
      card.append(list);
    } else if (rosterWorker) {
      const portrait = document.createElement("div");
      portrait.className = "worker-card__portrait";
      portrait.textContent = ["🧙", "🧔", "🧝", "🧑‍🌾", "🧑‍🔬", "🧙‍♂️", "🧕", "🧝‍♂️"][slot - 1] ?? "🧙";
      const name = document.createElement("strong");
      name.className = "worker-card__name";
      name.textContent = rosterWorker.name;
      const status = document.createElement("small");
      status.className = "worker-card__status";
      status.dataset.workerStatus = String(rosterWorker.id);
      status.textContent = rosterWorker.status;
      const traits = document.createElement("small");
      traits.className = "worker-card__traits";
      traits.textContent = `+ ${rosterWorker.positiveTrait} · − ${rosterWorker.negativeTrait}`;
      const stats = document.createElement("div");
      stats.className = "worker-card__stats";
      stats.innerHTML = `<span>Speed Lv.${rosterWorker.speedLevel}</span><span>Carry ${rosterWorker.capacity}</span><span>Wage ${rosterWorker.wagePerMinute}/min</span><span>${rosterWorker.unpaid ? "UNPAID" : "Paid"}</span>`;
      const suitability = document.createElement("div");
      suitability.className = "worker-card__suitability";
      suitability.innerHTML = `<span data-tooltip="Alchemy suitability">⚗ ${rosterWorker.suitability.alchemy}</span><span data-tooltip="Hauling suitability">📦 ${rosterWorker.suitability.hauling}</span><span data-tooltip="Farming suitability">🌿 ${rosterWorker.suitability.farming}</span><span data-tooltip="Trading suitability">🪙 ${rosterWorker.suitability.trading}</span>`;
      const tasks = document.createElement("div");
      tasks.className = "worker-card__tasks";
      const role = document.createElement("select");
      role.dataset.tooltip = "Role presets task priorities";
      for (const [value, label] of [["generalist", "Generalist"], ["alchemist", "Alchemist"], ["hauler", "Hauler"], ["farmer", "Farmer"], ["merchant", "Merchant"]]) {
        const option = document.createElement("option"); option.value = value; option.textContent = label; role.append(option);
      }
      role.value = rosterWorker.role;
      role.addEventListener("change", () => {
        const previousRole = rosterWorker.role;
        rosterWorker.role = role.value as Worker["role"];
        const presets: Record<Worker["role"], Worker["priorities"]> = {
          generalist: { production: 2, stocking: 2, sales: 2, farming: 2 },
          alchemist: { production: 1, stocking: 3, sales: 4, farming: 4 },
          hauler: { production: 3, stocking: 1, sales: 2, farming: 4 },
          farmer: { production: 3, stocking: 4, sales: 4, farming: 1 },
          merchant: { production: 4, stocking: 2, sales: 1, farming: 4 },
        };
        rosterWorker.priorities = { ...presets[rosterWorker.role] };
        recordBalanceEvent("worker_configuration", { workerId: rosterWorker.id, change: "role", previous: previousRole, value: rosterWorker.role, priorities: rosterWorker.priorities });
        syncWorkerControls();
      });
      tasks.append(role);
      const taskOptions: Array<[keyof Pick<Worker, "production" | "stocking" | "sales">, string]> = [["production", "Production"], ["stocking", "Shelf stocking"], ["sales", "Customer sales"]];
      for (const [key, labelText] of taskOptions) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = rosterWorker[key];
        input.addEventListener("change", () => {
          rosterWorker[key] = input.checked;
          recordBalanceEvent("worker_configuration", { workerId: rosterWorker.id, change: key, value: input.checked });
        });
        label.append(input, labelText);
        tasks.append(label);
      }
      const priority = document.createElement("small");
      priority.className = "worker-card__priority";
      priority.dataset.tooltip = "Lower number means higher priority: Production · Stocking · Trading · Farming";
      priority.textContent = `Priority P${rosterWorker.priorities.production} · S${rosterWorker.priorities.stocking} · T${rosterWorker.priorities.sales} · F${rosterWorker.priorities.farming}`;
      const actions = document.createElement("div");
      actions.className = "worker-card__actions";
      const speed = document.createElement("button");
      speed.type = "button";
      speed.disabled = rosterWorker.speedLevel >= WORKER_MAX_SPEED_LEVEL;
      speed.textContent = speed.disabled ? "Speed maximum" : `Speed → Lv.${rosterWorker.speedLevel + 1} · ${55 + (rosterWorker.speedLevel - 1) * 45}`;
      speed.addEventListener("click", () => { selectedWorkerId = slot; upgradeWorkerSpeedEl.click(); });
      const capacity = document.createElement("button");
      capacity.type = "button";
      capacity.disabled = rosterWorker.capacity >= WORKER_MAX_CAPACITY;
      capacity.textContent = capacity.disabled ? `Carry maximum · ${WORKER_MAX_CAPACITY}` : `Carry ${rosterWorker.capacity} → ${rosterWorker.capacity + 1} · ${70 + (rosterWorker.capacityLevel - 1) * 55}`;
      capacity.addEventListener("click", () => { selectedWorkerId = slot; upgradeWorkerCapacityEl.click(); });
      actions.append(speed, capacity);
      card.append(portrait, name, traits, status, stats, suitability, priority, tasks, actions);
    }
    rosterEl.append(card);
  }
  renderWorkerAssignmentBoard();
  workerSelectorEl.replaceChildren();
  for (let slot = 1; slot <= workerSlotCount; slot++) {
    const option = document.createElement("option");
    const rosterWorker = workers.find((candidate) => candidate.id === slot);
    option.value = String(slot);
    option.textContent = rosterWorker?.hired ? rosterWorker.name : `Empty slot ${slot}`;
    workerSelectorEl.append(option);
  }
  workerSelectorEl.value = String(selected.id);
  workerNameEl.textContent = selected.name;
  hireWorkerEl.style.display = selected.hired ? "none" : "block";
  hireWorkerEl.textContent = `Hire for ${20 + (selected.id - 1) * 80} coins`;
  workerOptionsEl.classList.toggle("worker-options--hidden", !selected.hired);
  workerProductionEl.checked = selected.production;
  workerStockingEl.checked = selected.stocking;
  workerSalesEl.checked = selected.sales;
  workerRouteEl.value = selected.route;
  const speedCost = 55 + (selected.speedLevel - 1) * 45;
  const capacityCost = 70 + (selected.capacityLevel - 1) * 55;
  upgradeWorkerSpeedEl.disabled = selected.speedLevel >= WORKER_MAX_SPEED_LEVEL;
  upgradeWorkerSpeedEl.textContent = upgradeWorkerSpeedEl.disabled ? "Speed maximum" : `Speed Lv.${selected.speedLevel} → Lv.${selected.speedLevel + 1} · ${speedCost} coins`;
  upgradeWorkerCapacityEl.disabled = selected.capacity >= WORKER_MAX_CAPACITY;
  upgradeWorkerCapacityEl.textContent = upgradeWorkerCapacityEl.disabled ? `Capacity maximum · ${WORKER_MAX_CAPACITY}` : `Capacity ${selected.capacity} → ${selected.capacity + 1} · ${capacityCost} coins`;
  unlockWorkerSlotEl.style.display = workerSlotCount >= workerNames.length ? "none" : "block";
  unlockWorkerSlotEl.textContent = `Unlock worker slot ${workerSlotCount + 1} · ${300 * workerSlotCount * workerSlotCount} coins`;
}

function hireWorkerApplication(slot: number, applicationId: number): void {
  const rosterWorker = workers.find((candidate) => candidate.id === slot);
  const application = ensureWorkerApplications(slot).find((candidate) => candidate.id === applicationId);
  if (!rosterWorker || !application || rosterWorker.hired) return;
  if (!spendCoins(application.hireCost, `You need ${application.hireCost} coins to hire ${application.name}`, "worker_hire", { workerId: rosterWorker.id, worker: application.name })) return;
  rosterWorker.name = application.name;
  rosterWorker.root.name = application.name;
  rosterWorker.positiveTrait = application.positiveTrait;
  rosterWorker.negativeTrait = application.negativeTrait;
  rosterWorker.suitability = { ...application.suitability };
  rosterWorker.wagePerMinute = application.wagePerMinute;
  rosterWorker.unpaid = false;
  rosterWorker.hired = true;
  rosterWorker.root.setEnabled(true);
  recordBalanceEvent("worker_hired", { workerId: rosterWorker.id, worker: application.name, wage: application.wagePerMinute, traits: [application.positiveTrait, application.negativeTrait], suitability: application.suitability });
  workerApplications.delete(slot);
  applicationRefillTimers.delete(slot);
  selectedWorkerId = slot;
  syncWorkerControls();
  hintEl.textContent = `${application.name} joined the workshop`;
}

function discardWorkerApplication(slot: number, applicationId: number): void {
  const applications = ensureWorkerApplications(slot);
  const index = applications.findIndex((candidate) => candidate.id === applicationId);
  if (index < 0) return;
  const [discarded] = applications.splice(index, 1);
  recordBalanceEvent("application_discarded", { slot, applicationId, worker: discarded?.name, traits: discarded ? [discarded.positiveTrait, discarded.negativeTrait] : undefined });
  if (!applicationRefillTimers.has(slot)) applicationRefillTimers.set(slot, 20);
  syncWorkerControls();
  hintEl.textContent = "Application discarded · a replacement will arrive soon";
}

function renderWorkerAssignmentBoard(): void {
  const board = document.querySelector<HTMLElement>("#worker-assignment-board")!;
  const facilities = [
    { id: "farm", icon: "🌿", name: "Farm Plots", suitability: "Farming", count: patches.filter((patch) => patch.unlocked).length },
    { id: "drying_rack", icon: "☀", name: "Drying Rack", suitability: "Alchemy", count: dryers.length },
    ...stationDefinitions.filter((station) => station.id !== "drying_rack").map((station) => ({
      id: station.id,
      icon: station.id === "mortar_mill" ? "⚙" : station.id === "alchemists_still" ? "⚗" : station.id === "enchanters_bench" ? "✦" : "◆",
      name: station.name,
      suitability: "Alchemy",
      count: processors.filter((processor) => processor.stationId === station.id).length,
    })),
  ];
  const table = document.createElement("table");
  table.className = "worker-assignment-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  const facilityHeading = document.createElement("th");
  facilityHeading.textContent = "Base facilities";
  headRow.append(facilityHeading);
  for (let slot = 1; slot <= workerNames.length; slot++) {
    const heading = document.createElement("th");
    const rosterWorker = workers.find((candidate) => candidate.id === slot);
    heading.textContent = rosterWorker?.hired ? rosterWorker.name.split(" ")[0]! : `Slot ${slot}`;
    headRow.append(heading);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const facility of facilities) {
    const row = document.createElement("tr");
    const label = document.createElement("td");
    label.innerHTML = `<div class="worker-facility-name"><span>${facility.icon}</span><div>${facility.name}<small>Required: ${facility.suitability} · Built: ${facility.count}</small></div></div>`;
    row.append(label);
    for (let slot = 1; slot <= workerNames.length; slot++) {
      const cell = document.createElement("td");
      const rosterWorker = workers.find((candidate) => candidate.id === slot);
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.disabled = !rosterWorker?.hired || facility.count === 0;
      checkbox.checked = rosterWorker?.allowedFacilities.includes(facility.id) ?? false;
      checkbox.setAttribute("aria-label", `Assign ${rosterWorker?.name ?? `slot ${slot}`} to ${facility.name}`);
      checkbox.addEventListener("change", () => {
        if (!rosterWorker) return;
        rosterWorker.allowedFacilities = checkbox.checked
          ? [...new Set([...rosterWorker.allowedFacilities, facility.id])]
          : rosterWorker.allowedFacilities.filter((id) => id !== facility.id);
        recalculateWorkerStationPriorities(rosterWorker, facility.id, checkbox.checked);
        recordBalanceEvent("worker_configuration", { workerId: rosterWorker.id, change: "facility", facility: facility.id, assigned: checkbox.checked });
      });
      cell.append(checkbox);
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  board.replaceChildren(table);
}

function rebuildWorkerCarry(): void {
  worker.carryAnchor.getChildMeshes().forEach((mesh) => mesh.dispose());
  worker.items.forEach((item, index) => {
    const mesh = item === "sunleaf" || item === "dried_sunleaf"
      ? MeshBuilder.CreateCylinder(`Mira carried ${item}`, { height: 0.15, diameter: 0.4, tessellation: 8 }, scene)
      : createProductMesh(item, Vector3.Zero(), `Mira carried ${item}`);
    mesh.parent = worker.carryAnchor;
    mesh.position.set((index % 2) * 0.14 - 0.07, index * 0.15, 0);
    if (item === "sunleaf" || item === "dried_sunleaf") {
      mesh.rotation.z = Math.PI / 2;
      mesh.material = item === "sunleaf" ? mats.leaf : mats.cloth;
    }
  });
}

function workerItemCount(item: ItemId): number {
  return countItem(worker.items, item);
}

function workerArrivalDistance(rosterWorker: Worker): number {
  let arrivalDistance = rosterWorker.task === "deliver_sale" ? 1.05
    : rosterWorker.task === "harvest" || rosterWorker.task === "plant" || rosterWorker.task === "tend" || rosterWorker.task === "discard_items" ? 1.0
      : 1.65;
  if (rosterWorker.task === "supply_dryer" || rosterWorker.task === "collect_dryer") {
    const footprint = buildingFootprint("drying_rack", dryers[rosterWorker.targetIndex]?.rotation ?? 0);
    arrivalDistance = Math.max(arrivalDistance, Math.hypot(footprint.width / 2, footprint.depth / 2) + 0.15);
  } else if (rosterWorker.task === "supply_processor" || rosterWorker.task === "collect_processor") {
    const processor = processors[rosterWorker.targetIndex];
    if (processor) {
      const footprint = buildingFootprint(processor.stationId, processor.rotation);
      const reach = footprint.shape === "circle"
        ? (footprint.radius ?? footprint.width / 2) + 0.15
        : Math.hypot(footprint.width / 2, footprint.depth / 2) + 0.15;
      arrivalDistance = Math.max(arrivalDistance, reach);
    }
  } else if (rosterWorker.task === "stock_shelf" || rosterWorker.task === "collect_sale") {
    const shelf = shelves[rosterWorker.targetIndex];
    if (shelf) {
      const footprint = buildingFootprint(shelf.size === "large" ? "storage_shelf_large" : shelf.size === "medium" ? "storage_shelf_medium" : "storage_shelf", shelf.rotation);
      arrivalDistance = Math.max(arrivalDistance, Math.hypot(footprint.width / 2, footprint.depth / 2) + 0.15);
    }
  }
  return arrivalDistance;
}

function isWorkerRouteSegmentClear(from: Vector3, to: Vector3): boolean {
  const delta = to.subtract(from);
  delta.y = 0;
  const distance = delta.length();
  if (distance <= 0.001) return true;
  const steps = Math.max(1, Math.ceil(distance / (NAV_CELL * 0.25)));
  for (let step = 1; step <= steps; step++) {
    const candidate = Vector3.Lerp(from, to, step / steps);
    if (isNavigationBlocked(candidate, WORKER_PATH_RADIUS, WORKER_NAV_BOUNDS)) return false;
  }
  return true;
}

function findWorkerTaskPath(rosterWorker: Worker): Vector3[] {
  if (!rosterWorker.target) return [];
  const target = rosterWorker.target;
  const arrivalDistance = workerArrivalDistance(rosterWorker);
  const candidates: Vector3[] = [target.clone()];
  // A station centre or its nearest grid cell can be isolated by adjacent
  // furniture. Sample the complete interaction perimeter so workers can use
  // whichever side is actually reachable.
  for (const radiusScale of [0.92, 0.72]) {
    const radius = arrivalDistance * radiusScale;
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2;
      candidates.push(new Vector3(
        target.x + Math.cos(angle) * radius,
        rosterWorker.root.position.y,
        target.z + Math.sin(angle) * radius,
      ));
    }
  }
  candidates.sort((a, b) => Vector3.DistanceSquared(rosterWorker.root.position, a)
    - Vector3.DistanceSquared(rosterWorker.root.position, b));
  let blockedCandidates = 0;
  let attemptedRoutes = 0;
  for (const candidate of candidates) {
    if (isNavigationBlocked(candidate, WORKER_PATH_RADIUS, WORKER_NAV_BOUNDS)) {
      blockedCandidates++;
      continue;
    }
    attemptedRoutes++;
    const path = findNavigationPath(rosterWorker.root.position, candidate, WORKER_PATH_RADIUS, WORKER_NAV_BOUNDS);
    if (path.length > 0) {
      // A* nodes sit on the 0.5-unit navigation grid. Keep the exact sampled
      // interaction point as a short final leg; otherwise grid rounding can
      // leave the final node just outside a task's arrival radius (notably at
      // the farm plots) and cause a replan on every frame.
      const routeEnd = path[path.length - 1]!;
      if (Vector3.DistanceSquared(routeEnd, candidate) > WORKER_WAYPOINT_REACHED_SQUARED) {
        if (!isWorkerRouteSegmentClear(routeEnd, candidate)) continue;
        path.push(candidate.clone());
      }
      recordWorkerDebug("approach_point_selected", rosterWorker, {
        candidate: roundedXZ(candidate),
        pathNodes: path.length,
        attemptedRoutes,
        blockedCandidates,
      });
      return path;
    }
  }
  recordWorkerDebug("no_approach_point_reachable", rosterWorker, { attemptedRoutes, blockedCandidates, candidates: candidates.length });
  return [];
}

function setWorkerTask(task: WorkerTask, target: Vector3 | null, status: string, targetIndex = -1): void {
  worker.task = task;
  worker.target = target?.clone() ?? null;
  if (worker.target) worker.target.y = worker.root.position.y;
  worker.targetIndex = targetIndex;
  const stationKey = task.includes("processor") ? `processor:${processors[targetIndex]?.instanceId ?? targetIndex}`
    : task.includes("dryer") ? `dryer:${dryers[targetIndex]?.instanceId ?? targetIndex}`
      : task.includes("shelf") || task.includes("sale") ? `shelf:${shelves[targetIndex]?.instanceId ?? targetIndex}`
        : task === "harvest" || task === "plant" || task === "tend" ? `patch:${targetIndex}` : "";
  if (stationKey) {
    const repetitionWeight = worker.negativeTrait === "Restless" ? 2.5 : 1;
    worker.stationMemory[stationKey] = (worker.stationMemory[stationKey] ?? 0) + repetitionWeight;
  }
  worker.navigationPath = findWorkerTaskPath(worker);
  worker.progressAnchor.copyFrom(worker.root.position);
  worker.noProgressTime = 0;
  worker.status = status;
  recordWorkerDebug("task_assigned", worker, {
    requestedStatus: status,
    arrivalDistance: Number(workerArrivalDistance(worker).toFixed(3)),
    routeEnd: worker.navigationPath.length > 0 ? roundedXZ(worker.navigationPath[worker.navigationPath.length - 1]!) : null,
  });
  document.querySelector<HTMLElement>(`[data-worker-status="${worker.id}"]`)?.replaceChildren(status);
  workerStatusEl.textContent = status;
}

function workshopItemCount(item: ItemId): number {
  const shelfStock = shelves.reduce((total, shelf) => total + (shelf.items[item] ?? 0), 0);
  const playerStock = countItem(inventory.items, item);
  const workerStock = workers.reduce((total, candidate) => total + countItem(candidate.items, item), 0);
  const dryerStock = dryers.reduce((total, dryer) => total
    + countItem(dryer.inputQueue, item) + countItem(dryer.outputItems, item), 0);
  const processorStock = processors.reduce((total, processor) => total
    + countItem(processor.inputQueue, item) + countItem(processor.outputItems, item), 0);
  const farmStock = catalogById.get(item)?.category === "base"
    ? patches.reduce((total, patch) => total + (patch.cropId === item ? patch.stock : 0), 0)
    : 0;
  return shelfStock + playerStock + workerStock + dryerStock + processorStock + farmStock;
}

function automationStockTarget(item: ItemId): number {
  const category = catalogById.get(item)?.category;
  if (category === "base") return 8;
  if (category === "prepared") return 5;
  const exactDemand = customerOrders.reduce((total, order) => total
    + (order.exactItem === item ? Math.max(0, order.amount - order.delivered) : 0), 0);
  const flexibleDemand = customerOrders.reduce((total, order) => total
    + (order.exactItem === null ? Math.max(0, order.amount - order.delivered) : 0), 0);
  // Keep a modest display reserve, then make specifically requested products
  // above that reserve. Flexible orders add only a small shared cushion rather
  // than multiplying their full demand across every possible product.
  return 2 + exactDemand + Math.min(2, flexibleDemand);
}

function automationNeedsItem(item: ItemId): boolean {
  return workshopItemCount(item) < automationStockTarget(item);
}

function selectedWorkerProcessor(item?: ItemId): Processor | undefined {
  return processors
    .filter((processor, index) => worker.allowedFacilities.includes(processor.stationId)
      && processor.input < processor.capacity
      && (!item || (() => {
        const recipe = processorRecipeForInput(processor, item);
        return Boolean(recipe && automationNeedsItem(recipe.output));
      })())
      && !workerTaskClaimed("supply_processor", index))
    .sort((a, b) => {
      const score = (processor: Processor) => processor.input + processor.outputAmount + (worker.stationMemory[`processor:${processor.instanceId}`] ?? 0) * 1.5;
      return score(a) - score(b);
    })[0];
}

function workerTaskClaimed(task: WorkerTask, targetIndex: number): boolean {
  return workers.some((candidate) => candidate !== worker && candidate.hired
    && candidate.task === task && candidate.targetIndex === targetIndex);
}

function workerOrderClaimed(orderId: number): boolean {
  return workers.some((candidate) => candidate !== worker && candidate.hired
    && candidate.orderId === orderId
    && (candidate.task === "collect_sale" || candidate.task === "deliver_sale"));
}

function tryWorkerSalesTask(): boolean {
  if (!worker.sales) return false;
  const acceptedOrders = customerOrders
    .filter((order) => order.accepted && !workerOrderClaimed(order.id))
    .sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0));
  const saleOrder = acceptedOrders.find((order) => shelves.some((shelf) => finishedProducts.some((item) => {
    const compatible = order.exactItem ? item === order.exactItem : true;
    return compatible && (shelf.items[item] ?? 0) > 0;
  })));
  if (!saleOrder) return false;
  const shelfIndex = shelves.findIndex((shelf) => finishedProducts.some((item) => {
    const compatible = saleOrder.exactItem ? item === saleOrder.exactItem : true;
    return compatible && (shelf.items[item] ?? 0) > 0;
  }));
  if (shelfIndex < 0) return false;
  worker.orderId = saleOrder.id;
  setWorkerTask("collect_sale", shelves[shelfIndex]!.ring.position, `Collecting ${saleOrder.customer}'s order`, shelfIndex);
  return true;
}

function tryWorkerStockingTask(): boolean {
  if (!worker.stocking) return false;
  const processorIndex = processors
    .map((processor, index) => ({ processor, index }))
    .filter(({ processor, index }) => processor.outputItems.length > 0
      && !workerTaskClaimed("collect_processor", index)
      && shelves.some((shelf) => processor.outputItems.some((item) => shelfAccepts(item, shelf)) && shelfItemCount(shelf) < shelf.capacity))
    .sort((a, b) => (worker.stationMemory[`processor:${a.processor.instanceId}`] ?? 0)
      - (worker.stationMemory[`processor:${b.processor.instanceId}`] ?? 0))[0]?.index ?? -1;
  if (processorIndex < 0) return false;
  const processor = processors[processorIndex]!;
  setWorkerTask("collect_processor", processor.position, `Collecting from ${processor.name}`, processorIndex);
  return true;
}

function tryWorkerProductionTask(): boolean {
  if (!worker.production) return false;
  const dryerIndex = worker.allowedFacilities.includes("drying_rack")
    ? dryers.map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate, index }) => candidate.outputItems.some((item) => Boolean(selectedWorkerProcessor(item)))
        && !workerTaskClaimed("collect_dryer", index))
      .sort((a, b) => (a.candidate.output + (worker.stationMemory[`dryer:${a.candidate.instanceId}`] ?? 0) * 1.5)
        - (b.candidate.output + (worker.stationMemory[`dryer:${b.candidate.instanceId}`] ?? 0) * 1.5))[0]?.index ?? -1
    : -1;
  if (dryerIndex >= 0) {
    setWorkerTask("collect_dryer", dryers[dryerIndex]!.position, "Collecting dried materials", dryerIndex);
    return true;
  }
  const upstreamIndex = processors.findIndex((candidate, index) => candidate.outputItems.some((item) => Boolean(selectedWorkerProcessor(item)))
    && !workerTaskClaimed("collect_processor", index));
  if (upstreamIndex < 0) return false;
  setWorkerTask("collect_processor", processors[upstreamIndex]!.position, `Collecting from ${processors[upstreamIndex]!.name}`, upstreamIndex);
  return true;
}

function tryWorkerFarmingTask(): boolean {
  if (!worker.production || !worker.allowedFacilities.includes("farm")) return false;
  const canStoreCrop = (cropId: BaseMaterialId): boolean => {
    if (!automationNeedsItem(cropId)) return false;
    if (dryerRecipeForInput(cropId) && dryers.some((dryer) => dryer.input < dryer.capacity)) return true;
    if (processors.some((processor) => worker.allowedFacilities.includes(processor.stationId)
      && processorRecipeForInput(processor, cropId) && processor.input < processor.capacity)) return true;
    return worker.stocking && shelves.some((shelf) => shelfAccepts(cropId, shelf) && shelfItemCount(shelf) < shelf.capacity);
  };
  const patchIndex = patches.findIndex((patch, index) => patch.stock > 0 && patch.cropId
    && canStoreCrop(patch.cropId) && !workerTaskClaimed("harvest", index));
  if (patchIndex >= 0) {
    const patch = patches[patchIndex]!;
    setWorkerTask("harvest", patch.root.position, `Harvesting ${patch.cropId ? itemLabel(patch.cropId) : "crop"}`, patchIndex);
    return true;
  }
  const replantIndex = patches.findIndex((patch, index) => patch.unlocked && patch.cropId && !patch.planted
    && patch.autoReplant && !workerTaskClaimed("plant", index)
    && automationNeedsItem(patch.cropId)
    && coins >= (cropById.get(patch.cropId)?.seedCost ?? Infinity));
  if (replantIndex >= 0) {
    const patch = patches[replantIndex]!;
    setWorkerTask("plant", patch.root.position, `Planting ${itemLabel(patch.cropId!)}`, replantIndex);
    return true;
  }
  const tendingIndex = patches.findIndex((patch, index) => patch.unlocked && patch.planted
    && patch.stock < farmPlotCapacity(patch) && patch.remainingYield > 0
    && patch.cropId && automationNeedsItem(patch.cropId)
    && !workerTaskClaimed("tend", index));
  if (tendingIndex < 0) return false;
  const patch = patches[tendingIndex]!;
  setWorkerTask("tend", patch.root.position, `Tending ${itemLabel(patch.cropId!)}`, tendingIndex);
  return true;
}

function sendWorkerToDiscard(message: string): void {
  const destination = nearestDiscardBin(worker.root.position);
  if (!destination) {
    worker.status = "Needs a garbage bin to clear carried items";
    worker.cooldown = 1;
    return;
  }
  setWorkerTask("discard_items", destination.bin.ring.position, message, destination.index);
}

function chooseWorkerTask(): void {
  if (!worker.hired || worker.cooldown > 0 || worker.task !== "idle") return;
  const carried = worker.items[0];
  if (carried) {
    if (worker.production) {
      const processor = selectedWorkerProcessor(carried);
      if (processor) {
        setWorkerTask("supply_processor", processor.position, `Supplying ${processor.name}`, processors.indexOf(processor));
        return;
      }
    }
    if (finishedProducts.includes(carried)) {
      const saleOrder = worker.orderId === null ? undefined : customerOrders.find((order) => order.id === worker.orderId && order.accepted);
      if (saleOrder && worker.sales) {
        setWorkerTask("deliver_sale", counterForOrder(saleOrder).ring.position, `Delivering to ${saleOrder.customer}`);
        return;
      }
      const directOrder = worker.sales ? customerOrders.find((order) => order.accepted
        && order.delivered < order.amount
        && !workerOrderClaimed(order.id)
        && (order.exactItem ? order.exactItem === carried : finishedProducts.includes(carried))) : undefined;
      if (directOrder) {
        worker.orderId = directOrder.id;
        setWorkerTask("deliver_sale", counterForOrder(directOrder).ring.position, `Taking carried goods to ${directOrder.customer}`);
        return;
      }
      if (worker.stocking) {
        const shelfIndex = shelves.findIndex((shelf) => shelfAccepts(carried, shelf) && shelfItemCount(shelf) < shelf.capacity);
        if (shelfIndex >= 0) {
          worker.orderId = null;
          setWorkerTask("stock_shelf", shelves[shelfIndex]!.ring.position, "Stocking finished products", shelfIndex);
          return;
        }
      }
      sendWorkerToDiscard("Discarding surplus goods to keep working");
      return;
    }
    const dryingRecipe = dryerRecipeForInput(carried);
    const dryerIndex = worker.allowedFacilities.includes("drying_rack") && dryingRecipe
      && automationNeedsItem(dryingRecipe.output)
      ? dryers.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => candidate.input < candidate.capacity)
        .sort((a, b) => (a.candidate.input + (worker.stationMemory[`dryer:${a.candidate.instanceId}`] ?? 0) * 1.5) - (b.candidate.input + (worker.stationMemory[`dryer:${b.candidate.instanceId}`] ?? 0) * 1.5))[0]?.index ?? -1
      : -1;
    if (dryingRecipe && worker.production && dryerIndex >= 0) {
      setWorkerTask("supply_dryer", dryers[dryerIndex]!.position, `Supplying ${itemLabel(carried)} to Drying Rack`, dryerIndex);
      return;
    }
    if (worker.stocking) {
      const shelfIndex = shelves.findIndex((shelf) => shelfAccepts(carried, shelf) && shelfItemCount(shelf) < shelf.capacity);
      if (shelfIndex >= 0) {
        setWorkerTask("stock_shelf", shelves[shelfIndex]!.ring.position, `Storing ${itemLabel(carried)}`, shelfIndex);
        return;
      }
    }
    sendWorkerToDiscard("Clearing blocked carried items");
    return;
  }

  const taskAttempts: Array<{ priority: number; tieBreak: number; attempt: () => boolean }> = [
    { priority: worker.priorities.sales, tieBreak: 0, attempt: tryWorkerSalesTask },
    { priority: worker.priorities.stocking, tieBreak: 1, attempt: tryWorkerStockingTask },
    { priority: worker.priorities.production, tieBreak: 2, attempt: tryWorkerProductionTask },
    { priority: worker.priorities.farming, tieBreak: 3, attempt: tryWorkerFarmingTask },
  ];
  taskAttempts.sort((a, b) => a.priority - b.priority || a.tieBreak - b.tieBreak);
  for (const candidate of taskAttempts) if (candidate.attempt()) return;
  workerStatusEl.textContent = "Waiting for work";
  worker.cooldown = 0.5;
}

function completeWorkerTask(): void {
  recordWorkerDebug("task_completed", worker);
  if (worker.task === "harvest") {
    const patch = patches[worker.targetIndex];
    const harvested = patch ? harvestFarmPlot(patch, worker.capacity - worker.items.length, "worker") : null;
    if (harvested) {
      for (let index = 0; index < harvested.amount; index++) worker.items.push(harvested.item);
    }
  } else if (worker.task === "plant") {
    const patch = patches[worker.targetIndex];
    if (patch?.cropId && !patch.planted) beginCropGrowth(patch, patch.cropId, true);
  } else if (worker.task === "tend") {
    // Remaining close to a growing plot activates patchRegrowthSpeed. The
    // short cooldown keeps the worker nearby while still allowing higher
    // priority work to interrupt between tending checks.
    worker.cooldown = 0.8;
  } else if (worker.task === "supply_dryer") {
    const dryer = dryers[worker.targetIndex];
    if (!dryer) return;
    const carried = worker.items[0];
    const recipe = carried ? dryerRecipeForInput(carried) : undefined;
    if (!carried || !recipe) return;
    const amount = Math.min(workerItemCount(carried), dryer.capacity - dryer.input);
    removeItems(worker.items, carried, amount);
    for (let index = 0; index < amount; index++) dryer.inputQueue.push(carried);
    refreshDryerInput(dryer);
  } else if (worker.task === "collect_dryer") {
    const dryer = dryers[worker.targetIndex];
    if (!dryer) return;
    const amount = Math.min(worker.capacity - worker.items.length, dryer.outputItems.length);
    worker.items.push(...dryer.outputItems.splice(0, amount));
    refreshDryerOutput(dryer);
  } else if (worker.task === "supply_processor") {
    const processor = processors[worker.targetIndex];
    if (processor) {
      const carried = worker.items[0];
      const recipe = carried ? processorRecipeForInput(processor, carried) : undefined;
      if (!carried || !recipe) return;
      const amount = Math.min(workerItemCount(carried), processor.capacity - processor.input);
      removeItems(worker.items, carried, amount);
      for (let index = 0; index < amount; index++) processor.inputQueue.push(carried);
      refreshProcessorInput(processor);
    }
  } else if (worker.task === "collect_processor") {
    const processor = processors[worker.targetIndex];
    if (processor) {
      const amount = Math.min(worker.capacity - worker.items.length, processor.outputItems.length);
      worker.items.push(...processor.outputItems.splice(0, amount));
      refreshProcessorOutput(processor);
    }
  } else if (worker.task === "stock_shelf") {
    const shelf = shelves[worker.targetIndex];
    if (!shelf) return;
    const amount = Math.min(worker.items.filter((item) => shelfAccepts(item, shelf)).length, shelf.capacity - shelfItemCount(shelf));
    const deposited: ItemId[] = [];
    for (let index = worker.items.length - 1; index >= 0 && deposited.length < amount; index--) {
      const item = worker.items[index]!;
      if (shelfAccepts(item, shelf)) deposited.push(...worker.items.splice(index, 1));
    }
    for (const item of deposited) shelf.items[item] = (shelf.items[item] ?? 0) + 1;
    refreshStorage();
  } else if (worker.task === "discard_items") {
    const blockingItem = worker.items[0];
    const discarded = blockingItem ? workerItemCount(blockingItem) : 0;
    if (blockingItem) removeItems(worker.items, blockingItem, discarded);
    if (blockingItem) recordBalanceEvent("items_discarded", { by: "worker", workerId: worker.id, item: blockingItem, amount: discarded });
    worker.status = blockingItem ? `Discarded surplus ${itemLabel(blockingItem)}` : "Nothing to discard";
  } else if (worker.task === "collect_sale") {
    const shelf = shelves[worker.targetIndex];
    if (!shelf) return;
    const order = customerOrders.find((candidate) => candidate.id === worker.orderId && candidate.accepted);
    if (order) {
      const selectedItem = finishedProducts
        .filter((item) => (order.exactItem ? item === order.exactItem : true) && (shelf.items[item] ?? 0) > 0)
        .sort((a, b) => (productValues[b] ?? 0) - (productValues[a] ?? 0))[0];
      if (selectedItem) {
        const amount = Math.min(worker.capacity, order.amount - order.delivered, shelf.items[selectedItem] ?? 0);
        shelf.items[selectedItem] = (shelf.items[selectedItem] ?? 0) - amount;
        for (let i = 0; i < amount; i++) worker.items.push(selectedItem);
        refreshStorage();
      }
    }
  } else if (worker.task === "deliver_sale") {
    const order = customerOrders.find((candidate) => candidate.id === worker.orderId && candidate.accepted);
    const item = worker.items[0];
    if (order && item) {
      const amount = Math.min(workerItemCount(item), order.amount - order.delivered);
      removeItems(worker.items, item, amount);
      order.delivered += amount;
      const salesBonus = worker.positiveTrait === "Silver Tongue" ? 1.15 : 1;
      const payment = Math.round(amount * (productValues[item] ?? 0) * order.rewardMultiplier * salesBonus);
      const coinsBeforeDelivery = coins;
      coins += payment;
      lifetimeRevenue += payment;
      recordBalanceEvent("sale_delivery", { by: "worker", workerId: worker.id, orderId: order.id, item, amount, payment, multiplier: order.rewardMultiplier * salesBonus });
      recordBalanceEvent("currency", { currency: "coins", delta: payment, before: coinsBeforeDelivery, after: coins, cause: "sale_delivery", orderId: order.id });
      if (order.delivered >= order.amount) {
        const completedAtCounter = counterForOrder(order);
        const salesBonus = worker.positiveTrait === "Silver Tongue" ? 1.15 : 1;
        const orderReward = Math.round(order.baseReward * salesBonus);
        const coinsBeforeReward = coins;
        coins += orderReward;
        lifetimeRevenue += orderReward;
        completedOrders++;
        const foundCore = rollGoldenCustomerCore(order);
        recordBalanceEvent("currency", { currency: "coins", delta: orderReward, before: coinsBeforeReward, after: coins, cause: "order_reward", orderId: order.id });
        recordBalanceEvent("order_completed", { by: "worker", workerId: worker.id, orderId: order.id, item: order.exactItem, amount: order.amount, baseReward: orderReward, coreAwarded: foundCore, elapsed: order.acceptedAt === null ? null : roundedBalanceValue((performance.now() - order.acceptedAt) / 1000) });
        hintEl.textContent = foundCore
          ? `${order.customer}'s order complete · Astral Core found! ${astralCores}/${GOD_MODE_CORE_COST}`
          : `${order.customer}'s order complete`;
        customerForOrder(order)?.setEnabled(false);
        customerOrders.splice(customerOrders.indexOf(order), 1);
        rescheduleAfterDeparture(completedAtCounter);
      }
      coinsEl.textContent = String(coins);
      refreshCustomerCounterRings();
      updateOrderCards();
    }
    worker.orderId = null;
  }
  rebuildWorkerCarry();
  const completedTask = worker.task;
  worker.task = "idle";
  worker.target = null;
  worker.navigationPath = [];
  worker.targetIndex = -1;
  worker.cooldown = completedTask === "tend" ? 0.8 : 0.25;
}

function nearbyBlockerDebugSnapshot(position: Vector3): Array<Record<string, unknown>> {
  return navigationBlockers()
    .filter((blocker) => Vector3.DistanceSquared(position, blocker.position) <= 16)
    .map((blocker) => ({
      position: roundedXZ(blocker.position),
      width: blocker.footprint.width,
      depth: blocker.footprint.depth,
      shape: blocker.footprint.shape ?? "rectangle",
      radius: blocker.footprint.radius,
    }));
}

function queueWorkerRecoveryPath(): void {
  recordWorkerDebug("recovery_started", worker, {
    blockedForSeconds: Number(Math.max(worker.stuckTime, worker.noProgressTime).toFixed(3)),
    nearbyBlockers: nearbyBlockerDebugSnapshot(worker.root.position),
  });
  worker.root.position.copyFrom(resolveNavigationPenetration(worker.root.position, 0.12, WORKER_NAV_BOUNDS));
  worker.navigationPath = findWorkerTaskPath(worker);
  worker.progressAnchor.copyFrom(worker.root.position);
  worker.noProgressTime = -0.5;
  if (worker.navigationPath.length > 0) {
    worker.status = "Taking another route";
    recordWorkerDebug("recovery_route_found", worker, { routeEnd: roundedXZ(worker.navigationPath[worker.navigationPath.length - 1]!) });
  } else {
    worker.task = "idle";
    worker.target = null;
    worker.targetIndex = -1;
    worker.status = "Idling · route unavailable";
    worker.cooldown = 1.5;
    recordWorkerDebug("task_abandoned_no_route", worker);
  }
  document.querySelector<HTMLElement>(`[data-worker-status="${worker.id}"]`)?.replaceChildren(worker.status);
}

const workerPenetrationLogTimes = new Map<number, number>();

function updateActiveWorker(dt: number): void {
  if (!worker.hired || worker.unpaid) return;
  const positionBeforeResolution = worker.root.position.clone();
  worker.root.position.copyFrom(resolveNavigationPenetration(worker.root.position, 0.12, WORKER_NAV_BOUNDS));
  const penetrationCorrection = Vector3.DistanceSquared(positionBeforeResolution, worker.root.position);
  const now = performance.now();
  if (penetrationCorrection > 0.0004 && now - (workerPenetrationLogTimes.get(worker.id) ?? -Infinity) >= 250) {
    workerPenetrationLogTimes.set(worker.id, now);
    recordWorkerDebug("penetration_corrected", worker, {
      from: roundedXZ(positionBeforeResolution),
      distance: Number(Math.sqrt(penetrationCorrection).toFixed(3)),
    });
  }
  for (const key of Object.keys(worker.stationMemory)) worker.stationMemory[key] = Math.max(0, worker.stationMemory[key]! - dt * 0.03);
  worker.cooldown = Math.max(0, worker.cooldown - dt);
  chooseWorkerTask();
  if (!worker.target) {
    worker.stuckTime = 0;
    worker.progressAnchor.copyFrom(worker.root.position);
    worker.noProgressTime = 0;
    return;
  }
  const distanceToTask = Vector3.Distance(worker.root.position, worker.target);
  const arrivalDistance = workerArrivalDistance(worker);
  if (distanceToTask <= arrivalDistance) {
    completeWorkerTask();
    return;
  }
  while (
    worker.navigationPath.length > 0
    && Vector3.DistanceSquared(worker.root.position, worker.navigationPath[0]!) <= WORKER_WAYPOINT_REACHED_SQUARED
  ) {
    worker.navigationPath.shift();
  }
  if (worker.navigationPath.length === 0) worker.navigationPath = findWorkerTaskPath(worker);
  if (worker.navigationPath.length === 0) {
    // A missing route is not permission to walk directly through the target
    // building. Wait for a new route or let the stuck recovery choose an
    // escape cell instead.
    worker.stuckTime += dt;
    if (worker.stuckTime >= 0.75) {
      recordWorkerDebug("pathfinder_returned_no_route", worker);
      queueWorkerRecoveryPath();
      worker.stuckTime = 0;
    }
    return;
  }
  const delta = worker.navigationPath[0]!.subtract(worker.root.position);
  delta.y = 0;
  if (delta.lengthSquared() < 0.001) return;
  const direction = delta.normalize();
  const suitabilityLevel = worker.task === "harvest"
    ? worker.suitability.farming
    : worker.task === "collect_sale" || worker.task === "deliver_sale"
      ? worker.suitability.trading
      : worker.task === "stock_shelf" || worker.task.startsWith("collect_")
        ? worker.suitability.hauling
        : worker.suitability.alchemy;
  const suitabilitySpeed = 1 + (suitabilityLevel - 1) * 0.08;
  const traitSpeed = worker.negativeTrait === "Drowsy" ? 0.85
    : worker.negativeTrait === "Clumsy" ? 0.92
      : worker.negativeTrait === "Shy" && (worker.task === "collect_sale" || worker.task === "deliver_sale") ? 0.8
        : 1;
  // Clamp the final step to the waypoint. Without this, a short last segment
  // can be overshot on alternating sides every frame, especially at 2x/3x.
  const movementDistance = Math.min(delta.length(), worker.speed * suitabilitySpeed * traitSpeed * dt);
  const previousPosition = worker.root.position.clone();
  worker.root.position.copyFrom(moveWithNavigationCollision(
    worker.root.position,
    direction.scale(movementDistance),
    0.12,
    WORKER_NAV_BOUNDS,
  ));
  if (Vector3.DistanceSquared(worker.root.position, worker.progressAnchor) >= 0.04) {
    worker.progressAnchor.copyFrom(worker.root.position);
    worker.noProgressTime = 0;
  } else {
    worker.noProgressTime += dt;
    if (worker.noProgressTime >= 1) {
      recordWorkerDebug("net_progress_stalled", worker, { anchor: roundedXZ(worker.progressAnchor) });
      worker.navigationPath = [];
      queueWorkerRecoveryPath();
    }
  }
  if (Vector3.DistanceSquared(previousPosition, worker.root.position) < 0.00001) {
    worker.stuckTime += dt;
    if (worker.stuckTime >= 0.75) {
      recordWorkerDebug("waypoint_blocked", worker, { waypoint: worker.navigationPath[0] ? roundedXZ(worker.navigationPath[0]) : null });
      worker.navigationPath = [];
      queueWorkerRecoveryPath();
      worker.stuckTime = 0;
    }
  } else {
    worker.stuckTime = 0;
  }
  const yaw = Math.atan2(direction.x, direction.z);
  worker.root.rotationQuaternion = Quaternion.Slerp(
    worker.root.rotationQuaternion ?? Quaternion.FromEulerAngles(0, yaw, 0),
    Quaternion.FromEulerAngles(0, yaw, 0),
    Math.min(1, dt * 10),
  );
  worker.root.position.y = 0.33 + Math.abs(Math.sin(performance.now() * 0.01)) * 0.025;
}

function updateWorker(rosterWorker: Worker, dt: number): void {
  // Most worker-task helpers still share the selected-worker UI model. Keep
  // that legacy coupling contained to one synchronous scope and always restore
  // it, so a worker update cannot leak into saves or management controls.
  const previouslySelectedWorker = worker;
  worker = rosterWorker;
  try {
    updateActiveWorker(dt);
  } finally {
    worker = previouslySelectedWorker;
  }
}

let payrollTimer = 60;

function updatePayroll(dt: number): void {
  payrollTimer -= dt;
  if (payrollTimer > 0) return;
  payrollTimer += 60;
  let paid = 0;
  let unpaid = 0;
  const coinsBeforePayroll = coins;
  const unpaidWorkerIds: number[] = [];
  for (const rosterWorker of workers.filter((candidate) => candidate.hired)) {
    if (coins >= rosterWorker.wagePerMinute) {
      coins -= rosterWorker.wagePerMinute;
      rosterWorker.unpaid = false;
      paid += rosterWorker.wagePerMinute;
    } else {
      rosterWorker.unpaid = true;
      rosterWorker.status = "Waiting for unpaid wages";
      unpaid++;
      unpaidWorkerIds.push(rosterWorker.id);
    }
  }
  coinsEl.textContent = String(coins);
  if (paid > 0) recordBalanceEvent("currency", { currency: "coins", delta: -paid, before: coinsBeforePayroll, after: coins, cause: "payroll" });
  recordBalanceEvent("payroll", { paid, unpaid, unpaidWorkerIds, coinsBefore: coinsBeforePayroll, coinsAfter: coins });
  if (unpaid > 0) hintEl.textContent = `${unpaid} worker${unpaid === 1 ? " is" : "s are"} waiting for wages`;
  else if (paid > 0) hintEl.textContent = `Payroll paid · ${paid} coins`;
  if (!managementPanelEl.classList.contains("management-panel--hidden") && !document.querySelector("#worker-panel.management-page--hidden")) syncWorkerControls();
}

function updateWorkerApplications(dt: number): void {
  for (const [slot, remaining] of applicationRefillTimers) {
    const next = remaining - dt;
    if (next > 0) {
      applicationRefillTimers.set(slot, next);
      continue;
    }
    const applications = ensureWorkerApplications(slot);
    if (applications.length < MAX_APPLICATIONS_PER_SLOT) applications.push(createWorkerApplication(slot));
    if (applications.length < MAX_APPLICATIONS_PER_SLOT) applicationRefillTimers.set(slot, 20);
    else applicationRefillTimers.delete(slot);
    if (!managementPanelEl.classList.contains("management-panel--hidden") && !document.querySelector("#worker-panel.management-page--hidden")) syncWorkerControls();
  }
}

hireWorkerEl.addEventListener("click", () => {
  const selected = selectedWorker();
  if (selected.hired) return;
  const cost = 20 + (selected.id - 1) * 80;
  if (coins < cost) {
    recordBalanceEvent("purchase_blocked", { currency: "coins", cost, available: coins, cause: "worker_hire", workerId: selected.id });
    hintEl.textContent = `You need ${cost} coins to hire ${selected.name}`;
    return;
  }
  const coinsBeforeHire = coins;
  coins -= cost;
  recordBalanceEvent("currency", { currency: "coins", delta: -cost, before: coinsBeforeHire, after: coins, cause: "worker_hire", workerId: selected.id });
  coinsEl.textContent = String(coins);
  selected.hired = true;
  selected.root.setEnabled(true);
  recordBalanceEvent("worker_hired", { workerId: selected.id, worker: selected.name, wage: selected.wagePerMinute, traits: [selected.positiveTrait, selected.negativeTrait], suitability: selected.suitability });
  syncWorkerControls();
  hintEl.textContent = `${selected.name} joined the workshop`;
});

workerSelectorEl.addEventListener("change", () => {
  selectedWorkerId = Number(workerSelectorEl.value);
  syncWorkerControls();
});

unlockWorkerSlotEl.addEventListener("click", () => {
  if (workerSlotCount >= workerNames.length) return;
  const cost = 300 * workerSlotCount * workerSlotCount;
  if (!spendCoins(cost, `You need ${cost} coins for another worker slot`, "worker_slot", { slot: workerSlotCount + 1 })) return;
  workerSlotCount++;
  const newWorker = createWorker(workerSlotCount, workerNames[workerSlotCount - 1]!);
  workers.push(newWorker);
  recordBalanceEvent("worker_slot_unlocked", { slot: workerSlotCount, cost });
  selectedWorkerId = newWorker.id;
  syncWorkerControls();
  hintEl.textContent = `Worker slot ${workerSlotCount} unlocked`;
});

workerProductionEl.addEventListener("change", () => {
  const selected = selectedWorker(); selected.production = workerProductionEl.checked;
  recordBalanceEvent("worker_configuration", { workerId: selected.id, change: "production", value: selected.production });
});
workerStockingEl.addEventListener("change", () => {
  const selected = selectedWorker(); selected.stocking = workerStockingEl.checked;
  recordBalanceEvent("worker_configuration", { workerId: selected.id, change: "stocking", value: selected.stocking });
});
workerSalesEl.addEventListener("change", () => {
  const selected = selectedWorker(); selected.sales = workerSalesEl.checked;
  recordBalanceEvent("worker_configuration", { workerId: selected.id, change: "sales", value: selected.sales });
});
workerRouteEl.addEventListener("change", () => {
  const selected = selectedWorker(); selected.route = workerRouteEl.value;
  recordBalanceEvent("worker_configuration", { workerId: selected.id, change: "route", value: selected.route });
});

function spendCoins(cost: number, failureMessage: string, cause = "purchase", data: Record<string, unknown> = {}): boolean {
  if (coins < cost) {
    recordBalanceEvent("purchase_blocked", { currency: "coins", cost, available: coins, cause, ...data });
    hintEl.textContent = failureMessage;
    return false;
  }
  const before = coins;
  coins -= cost;
  recordBalanceEvent("currency", { currency: "coins", delta: -cost, before, after: coins, cause, ...data });
  coinsEl.textContent = String(coins);
  return true;
}

function beginCropGrowth(patch: ResourcePatch, cropId: BaseMaterialId, chargeSeed: boolean): boolean {
  if (!patch.unlocked) {
    hintEl.textContent = `Farm plot ${patch.slot + 1} is still locked`;
    return false;
  }
  if (!unlockedCrops.has(cropId)) {
    hintEl.textContent = `${itemLabel(cropId)} cultivation has not been unlocked`;
    return false;
  }
  const crop = cropById.get(cropId)!;
  if (chargeSeed && crop.seedCost > 0 && !spendCoins(crop.seedCost, `You need ${crop.seedCost} coins for ${crop.name} seeds`, "seeds", { crop: cropId, plot: patch.slot + 1 })) return false;
  const previousCrop = patch.cropId;
  patch.cropId = cropId;
  patch.planted = true;
  patch.stock = 0;
  patch.remainingYield = cropYield(crop, cropGenetics[cropId]);
  patch.respawn = farmUnitGrowthSeconds(patch);
  rebuildFarmPlotCrop(patch);
  refreshFarmPlotVisual(patch);
  recordBalanceEvent("crop_planted", { crop: cropId, plot: patch.slot + 1, seedCost: chargeSeed ? crop.seedCost : 0, replaced: previousCrop });
  return true;
}

function harvestFarmPlot(patch: ResourcePatch, maximumAmount: number, source: "player" | "worker"): { item: BaseMaterialId; amount: number } | null {
  if (!patch.cropId || patch.stock <= 0 || maximumAmount <= 0) return null;
  const crop = cropById.get(patch.cropId)!;
  const amount = Math.min(maximumAmount, patch.stock);
  patch.stock -= amount;
  if (crop.renewable) {
    patch.remainingYield += amount;
    if (patch.respawn <= 0 && patch.stock < farmPlotCapacity(patch)) patch.respawn = farmUnitGrowthSeconds(patch);
  } else if (patch.stock === 0 && patch.remainingYield === 0) {
    patch.planted = false;
    patch.respawn = 0;
  }
  refreshFarmPlotVisual(patch);
  recordBalanceEvent("crop_harvested", { crop: crop.id, plot: patch.slot + 1, amount, remainingStock: patch.stock, by: source });
  return { item: crop.id, amount };
}

function upgradeCropGenetics(crop: CropDefinition): boolean {
  const currentLevel = cropGenetics[crop.id];
  if (currentLevel >= 5) return false;
  const cost = geneticsUpgradeCost(crop, currentLevel);
  if (!spendCoins(cost, `You need ${cost} coins to improve ${crop.name} genetics`, "crop_genetics", { crop: crop.id, level: currentLevel + 1 })) return false;
  const previousDuration = cropGrowthSeconds(crop, currentLevel);
  const previousCapacity = cropYield(crop, currentLevel);
  cropGenetics[crop.id]++;
  const improvedDuration = cropGrowthSeconds(crop, cropGenetics[crop.id]);
  const improvedCapacity = cropYield(crop, cropGenetics[crop.id]);
  for (const patch of patches.filter((candidate) => candidate.cropId === crop.id && candidate.planted)) {
    const previousUnitDuration = previousDuration / Math.max(1, previousCapacity);
    const improvedUnitDuration = improvedDuration / Math.max(1, improvedCapacity);
    const progress = patch.remainingYield > 0 ? Math.max(0, Math.min(1, 1 - patch.respawn / previousUnitDuration)) : 0;
    patch.remainingYield += improvedCapacity - previousCapacity;
    if (patch.remainingYield > 0 && patch.stock < improvedCapacity) patch.respawn = improvedUnitDuration * (1 - progress);
    refreshFarmPlotVisual(patch);
  }
  purchasedUpgrades++;
  recordBalanceEvent("upgrade", { kind: "crop_genetics", crop: crop.id, level: cropGenetics[crop.id], cost, yield: improvedCapacity, growthSeconds: roundedBalanceValue(improvedDuration) });
  hintEl.textContent = `${crop.name} genetics improved to level ${cropGenetics[crop.id]}`;
  return true;
}

function renderFarmPanel(): void {
  cropGridEl.replaceChildren();
  for (const crop of cropDefinitions) {
    const unlocked = unlockedCrops.has(crop.id);
    const genetics = cropGenetics[crop.id];
    const card = document.createElement("article");
    card.className = `crop-card${unlocked ? "" : " crop-card--locked"}`;
    const swatch = document.createElement("span");
    swatch.className = "crop-card__swatch";
    swatch.style.background = crop.color;
    const name = document.createElement("strong");
    name.textContent = crop.name;
    const details = document.createElement("small");
    details.textContent = unlocked
      ? `Genetics Lv.${genetics} · Yield ${cropYield(crop, genetics)} · ${cropGrowthSeconds(crop, genetics).toFixed(1)}s · ${crop.renewable ? "Renewable" : `${crop.seedCost} coin seeds`}`
      : `${crop.renewable ? "Renewable" : "Requires replanting"} · Unlock ${crop.unlockCost} coins`;
    const action = document.createElement("button");
    action.type = "button";
    if (!unlocked) {
      action.textContent = crop.unlockCost === 0 ? "Unlocked" : `Unlock · ${crop.unlockCost}`;
      action.disabled = crop.unlockCost === 0;
      action.addEventListener("click", () => {
        if (!spendCoins(crop.unlockCost, `You need ${crop.unlockCost} coins to discover ${crop.name}`, "crop_unlock", { crop: crop.id })) return;
        unlockedCrops.add(crop.id);
        recordBalanceEvent("crop_unlocked", { crop: crop.id, cost: crop.unlockCost });
        renderFarmPanel();
        hintEl.textContent = `${crop.name} cultivation unlocked`;
      });
    } else if (genetics >= 5) {
      action.textContent = "Maximum genetics";
      action.disabled = true;
    } else {
      const cost = geneticsUpgradeCost(crop, genetics);
      action.textContent = `Genetics ${genetics} → ${genetics + 1} · ${cost}`;
      action.addEventListener("click", () => {
        if (!upgradeCropGenetics(crop)) return;
        renderFarmPanel();
      });
    }
    card.append(swatch, name, details, action);
    cropGridEl.append(card);
  }

  farmPlotGridEl.replaceChildren();
  for (const patch of patches) {
    const card = document.createElement("article");
    card.className = `farm-plot-card${patch.unlocked ? "" : " farm-plot-card--locked"}`;
    card.dataset.farmSlot = String(patch.slot);
    const title = document.createElement("strong");
    title.textContent = `Plot ${patch.slot + 1}`;
    if (!patch.unlocked) {
      const unlockCost = farmPlotUnlockCosts[patch.slot] ?? 0;
      const unlock = document.createElement("button");
      unlock.type = "button";
      unlock.textContent = patch.slot === patches.findIndex((candidate) => !candidate.unlocked) ? `Unlock · ${unlockCost}` : "Unlock previous plot first";
      unlock.disabled = patch.slot !== patches.findIndex((candidate) => !candidate.unlocked);
      unlock.addEventListener("click", () => {
        if (!spendCoins(unlockCost, `You need ${unlockCost} coins to unlock farm plot ${patch.slot + 1}`, "farm_plot", { plot: patch.slot + 1 })) return;
        patch.unlocked = true;
        recordBalanceEvent("farm_plot_unlocked", { plot: patch.slot + 1, cost: unlockCost });
        refreshFarmPlotVisual(patch);
        renderFarmPanel();
        hintEl.textContent = `Farm plot ${patch.slot + 1} unlocked`;
      });
      card.append(title, unlock);
      farmPlotGridEl.append(card);
      continue;
    }
    const selector = document.createElement("select");
    for (const crop of cropDefinitions.filter((candidate) => unlockedCrops.has(candidate.id))) {
      const option = document.createElement("option");
      option.value = crop.id;
      option.textContent = crop.name;
      selector.append(option);
    }
    selector.value = patch.cropId ?? "sunleaf";
    const crop = patch.cropId ? cropById.get(patch.cropId) : null;
    const status = document.createElement("small");
    status.className = "farm-plot-status";
    if (!crop || !patch.planted) status.textContent = "Empty · choose a crop to plant";
    else if (patch.stock > 0) status.textContent = `${crop.name} ready · ${patch.stock} available`;
    else status.textContent = `${crop.name} growing · ${Math.max(0, patch.respawn).toFixed(1)}s`;
    const progress = document.createElement("div");
    progress.className = "farm-progress";
    const fill = document.createElement("i");
    const duration = crop ? cropGrowthSeconds(crop, cropGenetics[crop.id]) : 1;
    fill.style.width = `${patch.stock > 0 ? 100 : patch.planted ? Math.max(0, 1 - patch.respawn / duration) * 100 : 0}%`;
    progress.append(fill);
    const autoLabel = document.createElement("label");
    const auto = document.createElement("input");
    auto.type = "checkbox";
    auto.checked = patch.autoReplant;
    auto.addEventListener("change", () => { patch.autoReplant = auto.checked; });
    autoLabel.append(auto, "Auto-replant by workers");
    const plant = document.createElement("button");
    plant.type = "button";
    const selectedCrop = () => cropById.get(selector.value as BaseMaterialId)!;
    plant.textContent = patch.planted ? "Replace crop" : `Plant · ${selectedCrop().seedCost}`;
    selector.addEventListener("change", () => {
      plant.textContent = patch.planted ? "Replace crop" : `Plant · ${selectedCrop().seedCost}`;
    });
    plant.addEventListener("click", () => {
      const nextCrop = selectedCrop();
      if (patch.planted && !window.confirm(`Replace the current crop in plot ${patch.slot + 1} with ${nextCrop.name}?`)) return;
      if (!beginCropGrowth(patch, nextCrop.id, true)) return;
      renderFarmPanel();
      hintEl.textContent = `${nextCrop.name} planted in plot ${patch.slot + 1}`;
    });
    card.append(title, selector, status, progress, autoLabel, plant);
    farmPlotGridEl.append(card);
  }
}

function updateFarmPanelProgress(): void {
  for (const patch of patches) {
    const card = farmPlotGridEl.querySelector<HTMLElement>(`[data-farm-slot="${patch.slot}"]`);
    if (!card || !patch.unlocked) continue;
    const crop = patch.cropId ? cropById.get(patch.cropId) : null;
    const status = card.querySelector<HTMLElement>(".farm-plot-status");
    if (status) {
      if (!crop || !patch.planted) status.textContent = "Empty · choose a crop to plant";
      else if (patch.stock >= farmPlotCapacity(patch)) status.textContent = `${crop.name} full · ${patch.stock}/${farmPlotCapacity(patch)}`;
      else if (patch.remainingYield > 0) status.textContent = `${crop.name} · ${patch.stock}/${farmPlotCapacity(patch)} · next in ${Math.max(0, patch.respawn).toFixed(1)}s`;
      else status.textContent = `${crop.name} depleted · ${patch.stock}/${farmPlotCapacity(patch)}`;
    }
    const fill = card.querySelector<HTMLElement>(".farm-progress i");
    if (fill) {
      fill.style.width = `${farmNextUnitProgress(patch) * 100}%`;
    }
  }
}

// This is the plot represented by the visible contextual panel. Keep it
// stable while a pointer press is in flight; proximity is recalculated every
// frame and previously could clear the target between pointer-down and click.
let nearbyFarmPatch: ResourcePatch | null = null;

function refreshFarmContextControls(patch: ResourcePatch): void {
  farmContextCropEl.replaceChildren();
  for (const crop of cropDefinitions.filter((candidate) => unlockedCrops.has(candidate.id))) {
    const option = document.createElement("option");
    option.value = crop.id;
    option.textContent = crop.name;
    farmContextCropEl.append(option);
  }
  farmContextCropEl.value = patch.cropId ?? "sunleaf";
  farmContextAutoEl.checked = patch.autoReplant;
}

function updateFarmContext(patch: ResourcePatch, rebuildControls = false): void {
  if (rebuildControls || nearbyFarmPatch !== patch
    || farmContextCropEl.options.length !== unlockedCrops.size) refreshFarmContextControls(patch);
  nearbyFarmPatch = patch;
  farmContextEl.dataset.plotSlot = String(patch.slot);
  farmContextSlotEl.textContent = String(patch.slot + 1);
  const crop = patch.cropId ? cropById.get(patch.cropId) : null;
  farmContextNameEl.textContent = crop?.name ?? "Empty plot";
  if (!crop || !patch.planted) farmContextStatusEl.textContent = "Choose an unlocked crop to plant";
  else if (patch.stock >= farmPlotCapacity(patch)) farmContextStatusEl.textContent = `Full · ${patch.stock}/${farmPlotCapacity(patch)} available`;
  else if (patch.remainingYield > 0) farmContextStatusEl.textContent = `${patch.stock}/${farmPlotCapacity(patch)} · next in ${Math.max(0, patch.respawn).toFixed(1)} seconds`;
  else farmContextStatusEl.textContent = `Harvest remaining crop · ${patch.stock}/${farmPlotCapacity(patch)}`;
  farmContextProgressEl.style.width = `${farmNextUnitProgress(patch) * 100}%`;
  const selectedCrop = cropById.get(farmContextCropEl.value as BaseMaterialId) ?? cropById.get("sunleaf")!;
  farmContextPlantEl.textContent = patch.planted ? "Replace crop" : `Plant · ${selectedCrop.seedCost}`;
  farmContextRemoveEl.disabled = !patch.cropId && !patch.planted;
  if (!crop) {
    farmContextUpgradeEl.textContent = "Upgrade genetics";
    farmContextUpgradeEl.disabled = true;
  } else if (cropGenetics[crop.id] >= 5) {
    farmContextUpgradeEl.textContent = "Genetics maximum";
    farmContextUpgradeEl.disabled = true;
  } else {
    farmContextUpgradeEl.textContent = `Genetics ${cropGenetics[crop.id]} → ${cropGenetics[crop.id] + 1} · ${geneticsUpgradeCost(crop, cropGenetics[crop.id])}`;
    farmContextUpgradeEl.disabled = false;
  }
  farmContextEl.classList.remove("farm-context--hidden");
}

function hideFarmContext(): void {
  farmContextEl.classList.add("farm-context--hidden");
}

// Keep world click-to-move and build picking from consuming UI presses. This
// is especially important for the contextual Plant button, which sits above a
// selectable farm plot.
for (const eventName of ["pointerdown", "pointerup", "click"]) {
  farmContextEl.addEventListener(eventName, (event) => event.stopPropagation());
  shelfMenuEl.addEventListener(eventName, (event) => event.stopPropagation());
}

farmContextCropEl.addEventListener("change", () => {
  if (nearbyFarmPatch) updateFarmContext(nearbyFarmPatch);
});
farmContextAutoEl.addEventListener("change", () => {
  if (nearbyFarmPatch) nearbyFarmPatch.autoReplant = farmContextAutoEl.checked;
});
function activateFarmContextPlant(): void {
  const displayedSlot = Number(farmContextEl.dataset.plotSlot);
  const patch = Number.isInteger(displayedSlot) ? patches[displayedSlot] : nearbyFarmPatch;
  if (!patch) return;
  const crop = cropById.get(farmContextCropEl.value as BaseMaterialId);
  if (!crop) return;
  recordBalanceEvent("plant_pressed", { plot: patch.slot + 1, crop: crop.id, planted: patch.planted, coins });
  if (patch.planted && !window.confirm(`Replace the current crop in plot ${patch.slot + 1} with ${crop.name}?`)) return;
  if (!beginCropGrowth(patch, crop.id, true)) return;
  interactionCooldown = Math.max(interactionCooldown, 0.35);
  renderFarmPanel();
  updateFarmContext(patch, true);
  hintEl.textContent = `${crop.name} planted in plot ${patch.slot + 1}`;
}

// Execute pointer input at press time. This prevents the continuously updated
// proximity panel or Babylon's canvas pointer handling from invalidating the
// selected plot between pointer-down and the later synthetic click.
farmContextPlantEl.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  event.stopPropagation();
  activateFarmContextPlant();
});
farmContextPlantEl.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  // Keyboard-generated clicks have detail 0 and do not emit pointerdown.
  if (event.detail === 0) activateFarmContextPlant();
});
farmContextRemoveEl.addEventListener("click", () => {
  const patch = nearbyFarmPatch;
  if (!patch || (!patch.cropId && !patch.planted)) return;
  if (!window.confirm(`Remove the crop from plot ${patch.slot + 1}? Any unharvested yield will be lost.`)) return;
  const removedCrop = patch.cropId;
  const lostStock = patch.stock;
  const lostYield = patch.remainingYield;
  patch.cropId = null;
  patch.planted = false;
  patch.stock = 0;
  patch.respawn = 0;
  patch.remainingYield = 0;
  patch.autoReplant = false;
  recordBalanceEvent("crop_removed", { crop: removedCrop, plot: patch.slot + 1, lostStock, lostYield });
  rebuildFarmPlotCrop(patch);
  refreshFarmPlotVisual(patch);
  renderFarmPanel();
  updateFarmContext(patch, true);
  hintEl.textContent = `Farm plot ${patch.slot + 1} cleared`;
});
farmContextUpgradeEl.addEventListener("click", () => {
  const patch = nearbyFarmPatch;
  const crop = patch?.cropId ? cropById.get(patch.cropId) : null;
  if (!patch || !crop || !upgradeCropGenetics(crop)) return;
  renderFarmPanel();
  updateFarmContext(patch, true);
});

upgradePlayerCarryEl.addEventListener("click", () => {
  const cost = 60 + (playerStats.carryLevel - 1) * 45;
  if (!spendCoins(cost, `You need ${cost} coins for carrying capacity`, "player_upgrade", { stat: "carry", level: playerStats.carryLevel + 1 })) return;
  playerStats.carryLevel++;
  purchasedUpgrades++;
  playerStats.carryCapacity += 2;
  inventory.capacity = playerStats.carryCapacity;
  recordBalanceEvent("upgrade", { kind: "player_carry", level: playerStats.carryLevel, value: playerStats.carryCapacity, cost });
  const nextCost = 60 + (playerStats.carryLevel - 1) * 45;
  upgradePlayerCarryEl.textContent = `Capacity ${inventory.capacity} → ${inventory.capacity + 2} · ${nextCost} coins`;
  hintEl.textContent = `Carrying capacity increased to ${inventory.capacity}`;
  updateHud();
});

upgradePlayerStaminaEl.addEventListener("click", () => {
  const cost = 50 + (playerStats.staminaLevel - 1) * 40;
  if (!spendCoins(cost, `You need ${cost} coins for maximum stamina`, "player_upgrade", { stat: "stamina", level: playerStats.staminaLevel + 1 })) return;
  playerStats.staminaLevel++;
  purchasedUpgrades++;
  playerStats.maxStamina += 25;
  stamina = playerStats.maxStamina;
  recordBalanceEvent("upgrade", { kind: "player_stamina", level: playerStats.staminaLevel, value: playerStats.maxStamina, cost });
  const nextCost = 50 + (playerStats.staminaLevel - 1) * 40;
  upgradePlayerStaminaEl.textContent = `Stamina ${playerStats.maxStamina} → ${playerStats.maxStamina + 25} · ${nextCost} coins`;
  hintEl.textContent = `Maximum stamina increased to ${playerStats.maxStamina}`;
});

upgradePlayerRegenEl.addEventListener("click", () => {
  const cost = 45 + (playerStats.regenLevel - 1) * 35;
  if (!spendCoins(cost, `You need ${cost} coins for stamina regeneration`, "player_upgrade", { stat: "regen", level: playerStats.regenLevel + 1 })) return;
  playerStats.regenLevel++;
  purchasedUpgrades++;
  playerStats.staminaRegenPerSecond += 5;
  recordBalanceEvent("upgrade", { kind: "player_regen", level: playerStats.regenLevel, value: playerStats.staminaRegenPerSecond, cost });
  const nextCost = 45 + (playerStats.regenLevel - 1) * 35;
  upgradePlayerRegenEl.textContent = `Regen Lv.${playerStats.regenLevel} → Lv.${playerStats.regenLevel + 1} · ${nextCost} coins`;
  hintEl.textContent = "Stamina regeneration improved";
});

upgradeWorkerSpeedEl.addEventListener("click", () => {
  const selected = selectedWorker();
  if (selected.speedLevel >= WORKER_MAX_SPEED_LEVEL) return;
  const cost = Math.round((55 + (selected.speedLevel - 1) * 45) * (selected.negativeTrait === "Slow Learner" ? 1.2 : 1));
  if (!spendCoins(cost, `You need ${cost} coins for worker speed`, "worker_upgrade", { workerId: selected.id, stat: "speed", level: selected.speedLevel + 1 })) return;
  selected.speedLevel++;
  purchasedUpgrades++;
  selected.speed = workerSpeedForLevel(selected.speedLevel);
  recordBalanceEvent("upgrade", { kind: "worker_speed", workerId: selected.id, level: selected.speedLevel, value: roundedBalanceValue(selected.speed), cost });
  syncWorkerControls();
  hintEl.textContent = `${selected.name} moves faster`;
});

upgradeWorkerCapacityEl.addEventListener("click", () => {
  const selected = selectedWorker();
  if (selected.capacity >= WORKER_MAX_CAPACITY) return;
  const cost = Math.round((70 + (selected.capacityLevel - 1) * 55) * (selected.negativeTrait === "Slow Learner" ? 1.2 : 1));
  if (!spendCoins(cost, `You need ${cost} coins for worker capacity`, "worker_upgrade", { workerId: selected.id, stat: "capacity", level: selected.capacityLevel + 1 })) return;
  selected.capacityLevel++;
  purchasedUpgrades++;
  selected.capacity = workerCapacityForLevel(selected.capacityLevel);
  recordBalanceEvent("upgrade", { kind: "worker_capacity", workerId: selected.id, level: selected.capacityLevel, value: selected.capacity, cost });
  syncWorkerControls();
  hintEl.textContent = `${selected.name} can carry ${selected.capacity} items`;
});

function shelfItemCount(shelf: StorageShelf): number {
  return Object.values(shelf.items).reduce<number>((total, amount) => total + (amount ?? 0), 0);
}

function rotatedShelfOffset(offset: Vector3, rotation: number): Vector3 {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return new Vector3(offset.x * cosine - offset.z * sine, offset.y, offset.x * sine + offset.z * cosine);
}

function refreshStorage(): void {
  for (const shelf of shelves) {
    shelf.meshes.forEach((mesh) => mesh.dispose());
    shelf.meshes = [];
    const entries = Object.entries(shelf.items) as [ItemId, number][];
    const columns = shelf.size === "small" ? 4 : shelf.size === "medium" ? 6 : 8;
    const levels = shelf.size === "small" ? 3 : shelf.size === "medium" ? 4 : 5;
    const depthLayers = shelf.size === "small" ? 2 : 3;
    const width = shelf.size === "small" ? 2.1 : shelf.size === "medium" ? 3.4 : 4.5;
    const height = shelf.size === "small" ? 2.35 : shelf.size === "medium" ? 3.5 : 4.2;
    let index = 0;
    for (const [item, amount] of entries) {
      for (let i = 0; i < amount && index < shelf.capacity; i++) {
        const layerSize = columns * levels;
        const depthLayer = Math.floor(index / layerSize);
        const withinLayer = index % layerSize;
        const column = withinLayer % columns;
        const row = Math.floor(withinLayer / columns);
        const x = -width / 2 + 0.28 + column * ((width - 0.56) / Math.max(1, columns - 1));
        const y = 0.64 + row * ((height - 0.85) / Math.max(1, levels - 1));
        const z = depthLayers === 2 ? (depthLayer === 0 ? -0.22 : 0.22) : -0.38 + depthLayer * 0.38;
        const position = shelf.position.add(rotatedShelfOffset(new Vector3(x, y, z), shelf.rotation));
        const storedMesh = createProductMesh(item, position, `Stored ${item}`);
        storedMesh.scaling.scaleInPlace(0.55);
        shelf.meshes.push(storedMesh);
        index++;
      }
    }
  }
  updateShelfMenu();
}

function shelfAccepts(item: ItemId, shelf: StorageShelf = storage): boolean {
  return shelf.acceptedItems.has(item);
}

function migrateLegacyShelfFilters(shelf: StorageShelf): void {
  // Before intermediate storage existed, the untouched default selected every
  // finished product and nothing else. Preserve custom filters, but upgrade
  // that recognizable default so old saves can immediately store every item.
  const legacyDefaultItems = catalogItems
    .filter((item) => !["base", "prepared"].includes(item.category))
    .map((item) => item.id as ItemId);
  if (shelf.acceptedItems.size === legacyDefaultItems.length
    && legacyDefaultItems.every((item) => shelf.acceptedItems.has(item))) {
    shelf.acceptedItems = new Set(catalogItems.map((item) => item.id as ItemId));
  }
}

function updateShelfMenu(): void {
  shelfItemsEl.replaceChildren();
  shelfCapacityEl.textContent = `${shelfItemCount(storage)}/${storage.capacity} SLOTS USED`;
  const storedEntries = catalogItems
    .map((definition) => [definition.id as ItemId, storage.items[definition.id as ItemId] ?? 0] as const)
    .filter(([, amount]) => amount > 0);
  if (storedEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "shelf-menu__empty";
    empty.textContent = "This shelf is empty";
    shelfItemsEl.append(empty);
    return;
  }
  for (const [item, amount] of storedEntries) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.item = item;
    button.disabled = amount === 0 || inventory.items.length >= inventory.capacity;
    const name = document.createElement("span");
    name.textContent = itemLabel(item);
    const count = document.createElement("strong");
    count.textContent = `× ${amount}`;
    button.append(name, count);
    shelfItemsEl.append(button);
  }
}

type ShelfFamilyFilter = "all" | BaseMaterialId;
let activeShelfFamily: ShelfFamilyFilter = "all";

function visibleShelfFilterItems(): ItemId[] {
  const query = shelfFilterSearchEl.value.trim().toLocaleLowerCase();
  return catalogItems
    .filter((item) => activeShelfFamily === "all" || item.materialFamily === activeShelfFamily)
    .filter((item) => !query || item.name.toLocaleLowerCase().includes(query) || item.category.includes(query))
    .map((item) => item.id as ItemId);
}

function syncShelfSelectAll(): void {
  const allItems = catalogItems.map((item) => item.id as ItemId);
  const selectedCount = allItems.filter((item) => storage.acceptedItems.has(item)).length;
  shelfFilterAllEl.checked = selectedCount === allItems.length;
  shelfFilterAllEl.indeterminate = selectedCount > 0 && selectedCount < allItems.length;
  shelfFilterAllEl.disabled = false;
}

function renderShelfFilterItems(): void {
  shelfFilterListEl.replaceChildren();
  const visibleItems = visibleShelfFilterItems();
  for (const item of visibleItems) {
    const definition = catalogById.get(item)!;
    const label = document.createElement("label");
    label.className = "shelf-check";
    label.title = `${definition.name} · ${definition.category}`;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = item;
    input.checked = storage.acceptedItems.has(item);
    const name = document.createElement("span");
    name.textContent = definition.name;
    label.append(input, name);
    shelfFilterListEl.append(label);
  }
  if (visibleItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "shelf-menu__empty";
    empty.textContent = "No matching items";
    shelfFilterListEl.append(empty);
  }
  syncShelfSelectAll();
}

function rebuildShelfFilterControls(): void {
  shelfFilterTabsEl.replaceChildren();
  const families: ShelfFamilyFilter[] = ["all", ...cropDefinitions.map((crop) => crop.id)];
  for (const family of families) {
    const crop = family === "all" ? null : cropById.get(family)!;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `shelf-family-tab${activeShelfFamily === family ? " shelf-family-tab--active" : ""}`;
    button.dataset.family = family;
    button.title = crop?.name ?? "All material families";
    button.style.setProperty("--family-color", family === "all" ? "#b8d87c" : catalogById.get(family)!.color);
    if (crop) {
      const dot = document.createElement("i");
      button.append(dot, crop.name.split(" ")[0]!.slice(0, 3));
    } else button.textContent = "All";
    shelfFilterTabsEl.append(button);
  }
  renderShelfFilterItems();
}

rebuildShelfFilterControls();
shelfFilterTabsEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-family]");
  if (!button) return;
  activeShelfFamily = button.dataset.family as ShelfFamilyFilter;
  rebuildShelfFilterControls();
});
shelfFilterSearchEl.addEventListener("input", renderShelfFilterItems);
shelfFilterListEl.addEventListener("change", (event) => {
  const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>("input[type=checkbox]");
  if (!checkbox) return;
  const item = checkbox.value as ItemId;
  if (checkbox.checked) storage.acceptedItems.add(item);
  else storage.acceptedItems.delete(item);
  syncShelfSelectAll();
  hintEl.textContent = storage.acceptedItems.size === 0 ? "Shelf deposits disabled" : "Shelf filters updated";
});
shelfFilterAllEl.addEventListener("change", () => {
  const allItems = catalogItems.map((item) => item.id as ItemId);
  for (const item of allItems) {
    if (shelfFilterAllEl.checked) storage.acceptedItems.add(item);
    else storage.acceptedItems.delete(item);
  }
  renderShelfFilterItems();
  hintEl.textContent = shelfFilterAllEl.checked ? "Shelf accepts every item" : "All automatic shelf deposits disabled";
});

shelfItemsEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-item]");
  if (!button || button.disabled) return;
  const item = button.dataset.item as ItemId;
  const available = storage.items[item] ?? 0;
  const space = inventory.capacity - inventory.items.length;
  if (available <= 0 || space <= 0) return;
  const amount = Math.min(available, space);
  storage.items[item] = available - amount;
  collect(item, amount);
  shelfDepositArmed = false;
  interactionCooldown = 0.5;
  hintEl.textContent = `Took ${amount} ${itemLabel(item)} from storage`;
  refreshStorage();
});

const camera = new ArcRotateCamera("three-quarter camera", -Math.PI / 4, 0.88, 19, new Vector3(0, 0.5, 0), scene);
camera.fov = 0.62;
camera.lowerRadiusLimit = 15;
camera.upperRadiusLimit = 22;
camera.lowerBetaLimit = 0.84;
camera.upperBetaLimit = 0.92;
camera.inputs.clear();
let cameraTargetAlpha = camera.alpha;
let cameraTargetRadius = camera.radius;
let cameraRotationStartAlpha = camera.alpha;
let cameraRotationElapsed = 0.3;
const cameraRotationDuration = 0.3;

function rotateCamera(direction: -1 | 1): void {
  cameraRotationStartAlpha = camera.alpha;
  cameraTargetAlpha += direction * Math.PI / 4;
  cameraRotationElapsed = 0;
  hintEl.textContent = direction < 0 ? "Camera rotated left" : "Camera rotated right";
}

canvas.addEventListener("wheel", (event) => {
  if (menuActive) return;
  event.preventDefault();
  const minimum = camera.lowerRadiusLimit ?? 15;
  const maximum = camera.upperRadiusLimit ?? 22;
  const direction = Math.sign(event.deltaY);
  cameraTargetRadius = Math.max(minimum, Math.min(maximum, cameraTargetRadius + direction * 1.25));
}, { passive: false });

const targetMarker = MeshBuilder.CreateTorus("movement target", { diameter: 0.8, thickness: 0.08, tessellation: 28 }, scene);
targetMarker.rotation.x = 0;
targetMarker.material = mats.target;
targetMarker.isVisible = false;
targetMarker.isPickable = false;

type BuildKind = ProcessorStationId | "drying_rack" | "storage_shelf" | "storage_shelf_medium" | "storage_shelf_large" | "discard_bin" | "customer_counter";
let buildMode = false;
let moveMode = false;
let selectedBuildOutput: BuildKind | null = null;
let buildingRotation = 0;
let previewValid = false;

// Placement follows the visible cottage floor, including the rear half-grid
// row that became usable when the back wall was removed.
const BUILD_MIN_X = -5.5;
const BUILD_MAX_X = 8.5;
const BUILD_MIN_Z = SHOP_BACK_Z;
const BUILD_MAX_Z = SHOP_FRONT_Z;
const BUILD_GRID_MIN_Z = -6.5;
const BUILD_GRID_MAX_Z = 9.5;
const gridSegments: Vector3[][] = [];
for (let x = BUILD_MIN_X; x <= BUILD_MAX_X; x += 0.5) gridSegments.push([new Vector3(x, 0.37, BUILD_GRID_MIN_Z), new Vector3(x, 0.37, BUILD_GRID_MAX_Z)]);
for (let z = BUILD_GRID_MIN_Z; z <= BUILD_GRID_MAX_Z; z += 0.5) gridSegments.push([new Vector3(BUILD_MIN_X, 0.37, z), new Vector3(BUILD_MAX_X, 0.37, z)]);
const buildingGrid = MeshBuilder.CreateLineSystem("building grid", { lines: gridSegments }, scene);
buildingGrid.color = new Color3(0.87, 0.81, 0.54);
buildingGrid.alpha = 0.34;
buildingGrid.isPickable = false;
buildingGrid.isVisible = false;

const previewMaterial = material("building preview", new Color3(0.35, 0.8, 0.32), new Color3(0.05, 0.12, 0.03));
previewMaterial.alpha = 0.48;
const buildingPreview = new TransformNode("building preview", scene);
buildingPreview.position.y = 0.5;
const buildingFootprintPreview = MeshBuilder.CreateBox("building footprint preview", { width: 2, height: 0.12, depth: 2 }, scene);
buildingFootprintPreview.parent = buildingPreview;
buildingFootprintPreview.material = previewMaterial;
buildingFootprintPreview.isPickable = false;
buildingPreview.setEnabled(false);
let ghostMeshes: Mesh[] = [];

type SelectedBuilding = { kind: "dryer"; building: Dryer }
  | { kind: "processor"; building: Processor }
  | { kind: "shelf"; building: StorageShelf }
  | { kind: "discard_bin"; building: DiscardBin }
  | { kind: "customer_counter"; building: CustomerCounter };
let selectedBuilding: SelectedBuilding | null = null;
let relocatingBuilding: SelectedBuilding | null = null;

function rebuildBuildingGhost(kind: BuildKind): void {
  ghostMeshes.forEach((mesh) => mesh.dispose());
  ghostMeshes = [];
  const ghostBox = (name: string, size: Vector3, position: Vector3): Mesh => {
    const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene);
    mesh.parent = buildingPreview;
    mesh.position.copyFrom(position);
    mesh.material = previewMaterial;
    mesh.isPickable = false;
    ghostMeshes.push(mesh);
    return mesh;
  };
  const ghostCylinder = (name: string, height: number, diameter: number, position: Vector3): Mesh => {
    const mesh = MeshBuilder.CreateCylinder(name, { height, diameter, tessellation: 14 }, scene);
    mesh.parent = buildingPreview;
    mesh.position.copyFrom(position);
    mesh.material = previewMaterial;
    mesh.isPickable = false;
    ghostMeshes.push(mesh);
    return mesh;
  };
  if (kind === "discard_bin") {
    ghostCylinder("ghost garbage bin", 0.9, 0.82, new Vector3(0, 0.3, 0));
    const rim = MeshBuilder.CreateTorus("ghost garbage rim", { diameter: 0.84, thickness: 0.1, tessellation: 20 }, scene);
    rim.parent = buildingPreview; rim.position.set(0, 0.76, 0); rim.material = previewMaterial; rim.isPickable = false; ghostMeshes.push(rim);
  } else if (kind === "customer_counter") {
    ghostBox("ghost sales counter", new Vector3(5.1, 1.05, 0.75), new Vector3(0, 0.38, 0));
    ghostBox("ghost counter top", new Vector3(5.35, 0.18, 0.95), new Vector3(0, 0.95, 0));
  } else if (kind === "drying_rack") {
    for (const x of [-1, 1]) ghostBox("ghost dryer post", new Vector3(0.18, 1.75, 0.18), new Vector3(x, 0.63, 0));
    ghostBox("ghost dryer top", new Vector3(2.25, 0.18, 0.22), new Vector3(0, 1.46, 0));
    ghostBox("ghost dryer shelf", new Vector3(2.15, 0.13, 0.85), new Vector3(0, 0.28, 0));
    ghostBox("ghost dryer canopy", new Vector3(2.1, 0.08, 0.8), new Vector3(0, 1.21, 0));
  } else if (kind.startsWith("storage_shelf")) {
    const size = kind === "storage_shelf_large" ? "large" : kind === "storage_shelf_medium" ? "medium" : "small";
    const width = size === "small" ? 2.1 : size === "medium" ? 3.4 : 4.5;
    const levels = size === "small" ? 3 : size === "medium" ? 4 : 5;
    const height = size === "small" ? 2.35 : size === "medium" ? 3.5 : 4.2;
    for (const x of [-width / 2 + 0.08, width / 2 - 0.08]) ghostBox("ghost shelf post", new Vector3(0.16, height, 0.22), new Vector3(x, height / 2 - 0.16, 0));
    for (let index = 0; index < levels; index++) {
      const y = 0.42 + index * ((height - 0.65) / Math.max(1, levels - 1));
      ghostBox("ghost shelf board", new Vector3(width, 0.15, 0.9), new Vector3(0, y - 0.16, 0));
    }
  } else if (kind === "mortar_mill") {
    ghostCylinder("ghost mill base", 0.58, 1.72, new Vector3(0, 0.46, 0));
    ghostCylinder("ghost grinding plate", 0.16, 1.95, new Vector3(0, 0.82, 0));
    const bowl = ghostCylinder("ghost mortar bowl", 0.34, 0.9, new Vector3(-0.18, 1.06, 0));
    bowl.scaling.x = 1.1;
    const pestle = ghostCylinder("ghost pestle", 1.05, 0.18, new Vector3(0.35, 1.32, 0));
    pestle.rotation.z = -0.62;
  } else if (kind === "alchemists_still") {
      ghostBox("ghost still foundation", new Vector3(2.8, 0.2, 2.2), new Vector3(0, 0.29, 0));
      ghostBox("ghost still furnace", new Vector3(1.7, 1.05, 1.8), new Vector3(-0.55, 0.72, 0));
      const vessel = MeshBuilder.CreateSphere("ghost still vessel", { diameter: 1.25, segments: 12 }, scene);
      vessel.parent = buildingPreview; vessel.position.set(-0.55, 1.54, 0); vessel.scaling.y = 1.25; vessel.material = previewMaterial; vessel.isPickable = false; ghostMeshes.push(vessel);
      ghostCylinder("ghost condenser", 2.15, 0.72, new Vector3(0.9, 1.32, 0));
      ghostCylinder("ghost collection vat", 0.62, 0.9, new Vector3(0.9, 0.62, 0.62));
      ghostBox("ghost copper pipe", new Vector3(1.55, 0.18, 0.18), new Vector3(0.18, 1.97, 0));
  } else if (kind === "remedy_cauldron") {
    ghostCylinder("ghost cauldron bowl", 0.9, 1.8, new Vector3(0, 0.84, 0));
    ghostCylinder("ghost cauldron hearth", 0.5, 1.45, new Vector3(0, 0.36, 0));
    ghostBox("ghost cauldron handle left", new Vector3(0.18, 1.15, 0.18), new Vector3(-0.72, 1.26, 0));
    ghostBox("ghost cauldron handle right", new Vector3(0.18, 1.15, 0.18), new Vector3(0.72, 1.26, 0));
  } else if (kind === "preparation_table") {
    ghostBox("ghost butcher block", new Vector3(2.4, 0.32, 1.25), new Vector3(0, 0.86, 0));
    for (const x of [-0.88, 0.88]) ghostBox("ghost trestle", new Vector3(0.24, 0.9, 0.86), new Vector3(x, 0.42, 0));
    ghostBox("ghost lower brace", new Vector3(1.8, 0.16, 0.2), new Vector3(0, 0.29, 0));
    ghostBox("ghost cutting slab", new Vector3(1.15, 0.09, 0.76), new Vector3(-0.25, 1.07, 0));
  } else if (kind === "apothecary_table") {
    ghostBox("ghost cabinet", new Vector3(3.2, 0.82, 1.15), new Vector3(0, 0.54, 0));
    ghostBox("ghost marble worktop", new Vector3(3.35, 0.18, 1.28), new Vector3(0, 1.02, 0));
    ghostBox("ghost backboard", new Vector3(3.2, 1.15, 0.16), new Vector3(0, 1.57, 0.5));
    ghostBox("ghost bottle shelf", new Vector3(2.9, 0.14, 0.42), new Vector3(0, 1.56, 0.31));
    for (const x of [-1.05, -0.5, 0.05, 0.6, 1.12]) ghostCylinder("ghost remedy bottle", 0.42, 0.24, new Vector3(x, 1.84, 0.3));
    ghostCylinder("ghost mixing basin", 0.13, 0.9, new Vector3(0.42, 1.18, -0.08));
  } else {
    ghostBox("ghost enchanter top", new Vector3(2.9, 0.2, 1.15), new Vector3(0, 0.96, 0));
    for (const x of [-1.15, 1.15]) for (const z of [-0.4, 0.4]) ghostBox("ghost carved leg", new Vector3(0.2, 0.82, 0.2), new Vector3(x, 0.52, z));
    ghostCylinder("ghost rune plate", 0.1, 1.12, new Vector3(0, 1.12, 0));
    for (const x of [-0.82, 0, 0.82]) {
      const crystal = MeshBuilder.CreatePolyhedron("ghost focus crystal", { type: 1, size: 0.3 }, scene);
      crystal.parent = buildingPreview; crystal.position.set(x, 1.42 + (x === 0 ? 0.16 : 0), 0); crystal.scaling.y = 1.7; crystal.material = previewMaterial; crystal.isPickable = false; ghostMeshes.push(crystal);
    }
  }
}

function snappedBuildPoint(point: Vector3): Vector3 {
  return new Vector3(Math.round(point.x * 2) / 2, 0.33, Math.round(point.z * 2) / 2);
}

interface BuildingFootprint { width: number; depth: number; shape?: "rectangle" | "circle"; radius?: number }

function buildingFootprint(kind: BuildKind, rotation: number): BuildingFootprint {
  const base = kind === "discard_bin" ? { width: 1, depth: 1 }
    : kind === "customer_counter" ? { width: 5.5, depth: 1.2 }
    : kind === "drying_rack" ? { width: 2.5, depth: 1 }
    : kind === "storage_shelf" ? { width: 2, depth: 1 }
      : kind === "storage_shelf_medium" ? { width: 3.5, depth: 1 }
        : kind === "storage_shelf_large" ? { width: 4.5, depth: 1 }
    : kind === "mortar_mill" ? { width: 2, depth: 2 }
      : kind === "alchemists_still" ? { width: 3, depth: 2.5 }
        : kind === "remedy_cauldron" ? { width: 2, depth: 2, shape: "circle" as const, radius: 0.9 }
        : kind === "apothecary_table" ? { width: 3.5, depth: 1.5 }
          : kind === "preparation_table" ? { width: 2.5, depth: 1.5 }
            : { width: 3, depth: 1.5 };
  const quarterTurn = Math.round(rotation / (Math.PI / 2)) % 2 !== 0;
  return quarterTurn ? { ...base, width: base.depth, depth: base.width } : base;
}

function footprintsOverlap(aPosition: Vector3, a: BuildingFootprint, bPosition: Vector3, b: BuildingFootprint): boolean {
  const padding = 0.12;
  if (a.shape === "circle" && b.shape === "circle") {
    const combinedRadius = (a.radius ?? a.width / 2) + (b.radius ?? b.width / 2) + padding;
    return Vector3.DistanceSquared(aPosition, bPosition) < combinedRadius * combinedRadius;
  }
  if (a.shape === "circle" || b.shape === "circle") {
    const circlePosition = a.shape === "circle" ? aPosition : bPosition;
    const circle = a.shape === "circle" ? a : b;
    const rectanglePosition = a.shape === "circle" ? bPosition : aPosition;
    const rectangle = a.shape === "circle" ? b : a;
    const dx = Math.max(0, Math.abs(circlePosition.x - rectanglePosition.x) - rectangle.width / 2);
    const dz = Math.max(0, Math.abs(circlePosition.z - rectanglePosition.z) - rectangle.depth / 2);
    const radius = (circle.radius ?? circle.width / 2) + padding;
    return dx * dx + dz * dz < radius * radius;
  }
  return Math.abs(aPosition.x - bPosition.x) < (a.width + b.width) / 2 + padding
    && Math.abs(aPosition.z - bPosition.z) < (a.depth + b.depth) / 2 + padding;
}

function isWithinBuildingInteractionRadius(point: Vector3, buildingPosition: Vector3, footprint: BuildingFootprint, margin = 0.5): boolean {
  // Distance to the nearest point on the rectangular footprint. This gives
  // the full margin on every side, including corners, instead of a circle
  // around an offset interaction ring.
  if (footprint.shape === "circle") {
    const dx = point.x - buildingPosition.x;
    const dz = point.z - buildingPosition.z;
    const interactionRadius = (footprint.radius ?? footprint.width / 2) + margin;
    return dx * dx + dz * dz <= interactionRadius * interactionRadius;
  }
  const horizontalDistance = Math.max(0, Math.abs(point.x - buildingPosition.x) - footprint.width / 2);
  const verticalDistance = Math.max(0, Math.abs(point.z - buildingPosition.z) - footprint.depth / 2);
  return horizontalDistance * horizontalDistance + verticalDistance * verticalDistance <= margin * margin;
}

const NAV_CELL = 0.5;
// Plan with more clearance than the worker's small physical collider. This
// prevents A* from choosing brittle one-cell gaps while remaining less strict
// than the player's 0.3-radius navigation.
const WORKER_PATH_RADIUS = 0.18;
// A waypoint must be genuinely reached before it is removed. The previous
// squared-distance threshold of 0.12 represented a much larger 0.346 radius,
// which made workers discard and regenerate their final waypoint every frame.
const WORKER_WAYPOINT_REACHED_SQUARED = 0.01;
const NAV_MIN_X = -13.5;
const NAV_MAX_X = 13.5;
const NAV_MIN_Z = -11.5;
const NAV_MAX_Z = 14.5;

interface NavigationBounds { minX: number; maxX: number; minZ: number; maxZ: number }
const WORLD_NAV_BOUNDS: NavigationBounds = { minX: NAV_MIN_X, maxX: NAV_MAX_X, minZ: NAV_MIN_Z, maxZ: NAV_MAX_Z };

// Workers operate inside the playable shop-and-garden zone. Keep a small inset
// from the outer boundary so a recovery step or diagonal route cannot send a
// worker beyond the visible play area. The garden patches live just beyond the
// shop's back wall, so the Z range intentionally includes them.
// Keep workers inside the visible workshop grounds, while leaving a walking
// lane around the station-placement boundary. The previous bounds sat inside
// the build edge, so a dense row of furniture could partition the entire nav
// area even though the player could simply walk around it.
const WORKSHOP_MIN_X = -6.5;
const WORKSHOP_MAX_X = 9.5;
const WORKSHOP_MIN_Z = -11.5;
const WORKSHOP_MAX_Z = 14.5;
const WORKER_NAV_BOUNDS: NavigationBounds = {
  minX: WORKSHOP_MIN_X,
  maxX: WORKSHOP_MAX_X,
  minZ: WORKSHOP_MIN_Z,
  maxZ: WORKSHOP_MAX_Z,
};

function navigationBlockers(): Array<{ position: Vector3; footprint: BuildingFootprint }> {
  return [
    ...processors.map((processor) => ({ position: processor.position, footprint: buildingFootprint(processor.stationId, processor.rotation) })),
    ...dryers.map((dryer) => ({ position: dryer.position, footprint: buildingFootprint("drying_rack", dryer.rotation) })),
    ...shelves.map((shelf) => ({ position: shelf.position, footprint: buildingFootprint(shelf.size === "large" ? "storage_shelf_large" : shelf.size === "medium" ? "storage_shelf_medium" : "storage_shelf", shelf.rotation) })),
    ...customerCounters.map((counter) => ({ position: counter.position, footprint: buildingFootprint("customer_counter", counter.rotation) })),
    ...discardBins.map((bin) => ({ position: bin.position, footprint: buildingFootprint("discard_bin", bin.rotation) })),
  ];
}

function isNavigationBlocked(position: Vector3, radius = 0.27, bounds = WORLD_NAV_BOUNDS): boolean {
  if (position.x < bounds.minX + radius || position.x > bounds.maxX - radius
    || position.z < bounds.minZ + radius || position.z > bounds.maxZ - radius) return true;
  return navigationBlockers().some((blocker) => {
    if (blocker.footprint.shape === "circle") {
      const colliderRadius = Math.max(0.12, (blocker.footprint.radius ?? blocker.footprint.width / 2) - 0.08) + radius;
      const dx = position.x - blocker.position.x;
      const dz = position.z - blocker.position.z;
      return dx * dx + dz * dz < colliderRadius * colliderRadius;
    }
    // Slightly inset collision volumes let characters visually touch furniture.
    const halfWidth = Math.max(0.12, blocker.footprint.width / 2 - 0.16) + radius;
    const halfDepth = Math.max(0.12, blocker.footprint.depth / 2 - 0.16) + radius;
    return Math.abs(position.x - blocker.position.x) < halfWidth && Math.abs(position.z - blocker.position.z) < halfDepth;
  });
}

function moveWithNavigationCollision(position: Vector3, movement: Vector3, radius: number, bounds = WORLD_NAV_BOUNDS): Vector3 {
  const result = position.clone();
  const xMove = new Vector3(position.x + movement.x, position.y, position.z);
  if (!isNavigationBlocked(xMove, radius, bounds)) result.x = xMove.x;
  const zMove = new Vector3(result.x, position.y, position.z + movement.z);
  if (!isNavigationBlocked(zMove, radius, bounds)) result.z = zMove.z;
  if (Vector3.DistanceSquared(result, position) < 0.000001 && movement.lengthSquared() > 0) {
    // If an obstacle face blocks both axes, slide around it instead of
    // repeatedly pressing into the collider. This is especially useful when
    // a worker is routing past the side of a large still or shelf.
    const length = movement.length();
    const direction = movement.scale(1 / length);
    const sidesteps = [
      new Vector3(-direction.z, 0, direction.x).scale(length),
      new Vector3(direction.z, 0, -direction.x).scale(length),
    ];
    for (const sidestep of sidesteps) {
      const candidate = new Vector3(position.x + sidestep.x, position.y, position.z + sidestep.z);
      if (!isNavigationBlocked(candidate, radius, bounds)) {
        result.copyFrom(candidate);
        break;
      }
    }
  }
  return result;
}

function resolveNavigationPenetration(position: Vector3, radius: number, bounds = WORLD_NAV_BOUNDS): Vector3 {
  const result = position.clone();
  for (let pass = 0; pass < 4; pass++) {
    let corrected = false;
    for (const blocker of navigationBlockers()) {
      if (blocker.footprint.shape === "circle") {
        const colliderRadius = Math.max(0.12, (blocker.footprint.radius ?? blocker.footprint.width / 2) - 0.08) + radius;
        const dx = result.x - blocker.position.x;
        const dz = result.z - blocker.position.z;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared >= colliderRadius * colliderRadius) continue;
        const distance = Math.sqrt(distanceSquared);
        if (distance > 0.0001) {
          result.x = blocker.position.x + dx / distance * colliderRadius;
          result.z = blocker.position.z + dz / distance * colliderRadius;
        } else {
          result.x = blocker.position.x + colliderRadius;
        }
        corrected = true;
        continue;
      }
      const halfWidth = Math.max(0.12, blocker.footprint.width / 2 - 0.16) + radius;
      const halfDepth = Math.max(0.12, blocker.footprint.depth / 2 - 0.16) + radius;
      const dx = result.x - blocker.position.x;
      const dz = result.z - blocker.position.z;
      if (Math.abs(dx) >= halfWidth || Math.abs(dz) >= halfDepth) continue;
      const pushX = halfWidth - Math.abs(dx);
      const pushZ = halfDepth - Math.abs(dz);
      if (pushX <= pushZ) result.x += (dx < 0 ? -pushX : pushX);
      else result.z += (dz < 0 ? -pushZ : pushZ);
      corrected = true;
    }
    if (!corrected) break;
  }
  result.x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, result.x));
  result.z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, result.z));
  if (isNavigationBlocked(result, radius, bounds)) {
    // Overlapping nearby colliders can otherwise push the character back and
    // forth forever. Resolve to a genuinely free neighboring point once.
    for (let ring = 1; ring <= 8; ring++) {
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const candidate = position.add(new Vector3(dx * 0.25, 0, dz * 0.25));
        candidate.x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, candidate.x));
        candidate.z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, candidate.z));
        if (!isNavigationBlocked(candidate, radius, bounds)) return candidate;
      }
    }
  }
  return result;
}

function findNavigationPath(start: Vector3, destination: Vector3, radius = 0.27, bounds = WORLD_NAV_BOUNDS): Vector3[] {
  const toCell = (value: number, minimum: number) => Math.round((value - minimum) / NAV_CELL);
  const toWorld = (x: number, z: number) => new Vector3(NAV_MIN_X + x * NAV_CELL, start.y, NAV_MIN_Z + z * NAV_CELL);
  const width = Math.round((NAV_MAX_X - NAV_MIN_X) / NAV_CELL) + 1;
  const height = Math.round((NAV_MAX_Z - NAV_MIN_Z) / NAV_CELL) + 1;
  const clampCell = (value: number, maximum: number) => Math.max(0, Math.min(maximum - 1, value));
  const startX = clampCell(toCell(start.x, NAV_MIN_X), width);
  const startZ = clampCell(toCell(start.z, NAV_MIN_Z), height);
  let goalX = clampCell(toCell(destination.x, NAV_MIN_X), width);
  let goalZ = clampCell(toCell(destination.z, NAV_MIN_Z), height);
  const key = (x: number, z: number) => z * width + x;
  const goalCells: Array<{ x: number; z: number }> = [];
  if (!isNavigationBlocked(toWorld(goalX, goalZ), radius, bounds)) {
    goalCells.push({ x: goalX, z: goalZ });
  } else {
    // Buildings are intentionally selected by their centre, which is blocked.
    // Treat every nearby free perimeter cell as a valid goal so A* can choose
    // the reachable side instead of committing to the first cell it scans.
    for (let searchRing = 1; searchRing <= 6; searchRing++) {
      const candidatesBeforeRing = goalCells.length;
      for (let dz = -searchRing; dz <= searchRing; dz++) for (let dx = -searchRing; dx <= searchRing; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== searchRing) continue;
        const x = goalX + dx; const z = goalZ + dz;
        if (x < 0 || z < 0 || x >= width || z >= height) continue;
        if (!isNavigationBlocked(toWorld(x, z), radius, bounds)) goalCells.push({ x, z });
      }
      // Only the nearest free perimeter is a valid interaction destination.
      // More distant rings could make A* stop several metres from a station.
      if (goalCells.length > candidatesBeforeRing) break;
    }
  }
  if (goalCells.length === 0) return [];
  const goalKeys = new Set(goalCells.map((cell) => key(cell.x, cell.z)));
  const heuristic = (x: number, z: number): number => goalCells.reduce((best, goal) => {
    const distanceX = Math.abs(goal.x - x);
    const distanceZ = Math.abs(goal.z - z);
    return Math.min(best, Math.max(distanceX, distanceZ) + 0.4 * Math.min(distanceX, distanceZ));
  }, Infinity);
  const open: Array<{ x: number; z: number; score: number }> = [{ x: startX, z: startZ, score: 0 }];
  const cameFrom = new Map<number, number>();
  const cost = new Map<number, number>([[key(startX, startZ), 0]]);
  let iterations = 0;
  while (open.length > 0 && iterations++ < 5000) {
    open.sort((a, b) => a.score - b.score);
    const current = open.shift()!;
    const currentKey = key(current.x, current.z);
    if (goalKeys.has(currentKey)) {
      const cells: number[] = [currentKey];
      while (cameFrom.has(cells[0]!)) cells.unshift(cameFrom.get(cells[0]!)!);
      return cells.slice(1).map((cell) => toWorld(cell % width, Math.floor(cell / width)));
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = current.x + dx; const z = current.z + dz;
      if (x < 0 || z < 0 || x >= width || z >= height) continue;
      const world = toWorld(x, z);
      if (isNavigationBlocked(world, radius, bounds) && !(x === startX && z === startZ)) continue;
      if (dx !== 0 && dz !== 0) {
        // Do not cut diagonally through the corner of two colliders.
        if (isNavigationBlocked(toWorld(current.x + dx, current.z), radius, bounds)
          || isNavigationBlocked(toWorld(current.x, current.z + dz), radius, bounds)) continue;
      }
      const nextKey = key(x, z);
      const nextCost = (cost.get(currentKey) ?? 0) + (dx !== 0 && dz !== 0 ? 1.4 : 1);
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost);
      cameFrom.set(nextKey, currentKey);
      open.push({ x, z, score: nextCost + heuristic(x, z) });
    }
  }
  return [];
}

function isBuildPositionValid(position: Vector3): boolean {
  if (!selectedBuildOutput) return false;
  const footprint = buildingFootprint(selectedBuildOutput, buildingRotation);
  if (position.x - footprint.width / 2 < BUILD_MIN_X || position.x + footprint.width / 2 > BUILD_MAX_X
    || position.z - footprint.depth / 2 < BUILD_MIN_Z || position.z + footprint.depth / 2 > BUILD_MAX_Z) return false;
  const blockers: Array<{ position: Vector3; footprint: BuildingFootprint }> = [
    ...processors.filter((processor) => relocatingBuilding?.building !== processor)
      .map((processor) => ({ position: processor.position, footprint: buildingFootprint(processor.stationId, processor.rotation) })),
    ...dryers.filter((dryer) => relocatingBuilding?.building !== dryer)
      .map((dryer) => ({ position: dryer.position, footprint: buildingFootprint("drying_rack", dryer.rotation) })),
    ...shelves.filter((shelf) => relocatingBuilding?.building !== shelf)
      .map((shelf) => ({ position: shelf.position, footprint: buildingFootprint(shelf.size === "large" ? "storage_shelf_large" : shelf.size === "medium" ? "storage_shelf_medium" : "storage_shelf", shelf.rotation) })),
    ...customerCounters.filter((counter) => relocatingBuilding?.building !== counter)
      .map((counter) => ({ position: counter.position, footprint: buildingFootprint("customer_counter", counter.rotation) })),
    ...discardBins.filter((bin) => relocatingBuilding?.building !== bin)
      .map((bin) => ({ position: bin.position, footprint: buildingFootprint("discard_bin", bin.rotation) })),
  ];
  return blockers.every((blocker) => !footprintsOverlap(position, footprint, blocker.position, blocker.footprint));
}

function updateBuildingPreview(): void {
  if ((!buildMode && !moveMode) || !selectedBuildOutput) {
    buildingPreview.setEnabled(false);
    return;
  }
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh === floor, false, camera);
  if (!pick?.hit || !pick.pickedPoint) {
    buildingPreview.setEnabled(false);
    return;
  }
  buildingPreview.position.copyFrom(snappedBuildPoint(pick.pickedPoint));
  buildingPreview.position.y = 0.5;
  buildingPreview.rotation.y = buildingRotation;
  const unrotatedFootprint = buildingFootprint(selectedBuildOutput, 0);
  buildingFootprintPreview.scaling.x = unrotatedFootprint.width / 2;
  buildingFootprintPreview.scaling.z = unrotatedFootprint.depth / 2;
  previewValid = isBuildPositionValid(buildingPreview.position);
  previewMaterial.diffuseColor = previewValid ? new Color3(0.35, 0.8, 0.32) : new Color3(0.85, 0.2, 0.14);
  previewMaterial.emissiveColor = previewValid ? new Color3(0.05, 0.12, 0.03) : new Color3(0.18, 0.02, 0.01);
  buildingPreview.setEnabled(true);
}

function nextCustomerCounterCost(): number {
  return 5_000 * 4 ** Math.max(0, customerCounters.length - 1);
}

function refreshDynamicBuildCosts(): void {
  const counterChoice = buildChoiceEls.find((button) => button.dataset.build === "customer_counter");
  const price = counterChoice?.querySelector("span");
  if (price) price.textContent = String(nextCustomerCounterCost());
}

function buildSelectionDetails(output: BuildKind): { name: string; cost: number; accent: StandardMaterial } {
  if (output === "discard_bin") return { name: "Garbage Bin", cost: 45, accent: mats.discard };
  if (output === "customer_counter") return { name: "Sales Counter", cost: nextCustomerCounterCost(), accent: mats.cloth };
  if (output === "drying_rack") return { name: "Drying Rack", cost: 100, accent: mats.cloth };
  if (output === "storage_shelf") return { name: "Storage Shelf", cost: 140, accent: mats.timber };
  if (output === "storage_shelf_medium") return { name: "Medium Storage Shelf", cost: 320, accent: mats.timber };
  if (output === "storage_shelf_large") return { name: "Large Storage Shelf", cost: 620, accent: mats.timber };
  const station = stationById.get(output as StationId);
  if (station) {
    const accent = output === "mortar_mill" ? mats.powder : output === "alchemists_still" ? mats.essence : mats.incense;
    return { name: station.name, cost: station.baseCost, accent };
  }
  return { name: "Enchanter's Bench", cost: 380, accent: mats.incense };
}

function selectedKind(selection: SelectedBuilding): BuildKind {
  if (selection.kind === "dryer") return "drying_rack";
  if (selection.kind === "shelf") return selection.building.size === "large" ? "storage_shelf_large" : selection.building.size === "medium" ? "storage_shelf_medium" : "storage_shelf";
  if (selection.kind === "discard_bin") return "discard_bin";
  if (selection.kind === "customer_counter") return "customer_counter";
  return selection.building.stationId;
}

function buildingRefund(selection: SelectedBuilding): number {
  const originalCost = selection.kind === "customer_counter"
    ? selection.building.purchaseCost
    : buildSelectionDetails(selectedKind(selection)).cost;
  return Math.floor(originalCost / 2);
}

function buildingPosition(selection: SelectedBuilding): Vector3 {
  return selection.building.position;
}

function stationLevelName(level: number): string {
  return level === 4 ? "GOD MODE" : `Lv.${level}`;
}

function stationUpgradeCoinCost(baseCost: number, targetLevel: 2 | 3 | 4): number {
  const multiplier = targetLevel === 2 ? 1.5 : targetLevel === 3 ? 15 : 75;
  return Math.ceil(baseCost * multiplier);
}

function applyStationLevel(selection: Extract<SelectedBuilding, { kind: "dryer" | "processor" }>, level: 1 | 2 | 3 | 4): void {
  const station = selection.building;
  station.level = level;
  const durationMultiplier = [1, 1, 0.8, 0.6, 0.35][level]!;
  const capacityByLevel = [0, 6, 8, 12, 20][level]!;
  station.duration = station.baseDuration * durationMultiplier;
  station.capacity = capacityByLevel;
  const status = stationStatuses.find((candidate) => Vector3.DistanceSquared(candidate.position, station.position.add(new Vector3(0, 2.45, 0))) < 0.1);
  if (status) status.capacity = station.capacity;
  station.upgradeMeshes.forEach((mesh) => mesh.dispose());
  station.upgradeMeshes = [];
  const markerCount = level === 4 ? 4 : level - 1;
  for (let index = 0; index < markerCount; index++) {
    const marker = MeshBuilder.CreatePolyhedron(`${stationLevelName(level)} station marker`, { type: 1, size: level === 4 ? 0.28 : 0.2 }, scene);
    const localOffset = new Vector3((index - (markerCount - 1) / 2) * 0.38, 2.05 + (level === 4 ? 0.18 : 0), -0.35);
    marker.position.copyFrom(station.position.add(rotatedShelfOffset(localOffset, station.rotation)));
    marker.material = level === 4 ? mats.incense : mats.gold;
    marker.metadata = { buildingKind: selectedKind(selection), buildingId: station.instanceId };
    shadows.addShadowCaster(marker);
    station.upgradeMeshes.push(marker);
  }
}

function refreshSelectedBuildingActions(): void {
  if (!selectedBuilding) return;
  const details = buildSelectionDetails(selectedKind(selectedBuilding));
  if (selectedBuilding.kind === "shelf" || selectedBuilding.kind === "discard_bin" || selectedBuilding.kind === "customer_counter") {
    selectedBuildingNameEl.textContent = selectedBuilding.kind === "shelf"
      ? `${details.name} · ${selectedBuilding.building.capacity} slots`
      : selectedBuilding.kind === "customer_counter" ? `${details.name} · 10 customer spaces` : details.name;
    upgradeBuildingEl.style.display = "none";
    return;
  }
  const level = selectedBuilding.building.level;
  selectedBuildingNameEl.textContent = `${details.name} · ${stationLevelName(level)}`;
  upgradeBuildingEl.style.display = "block";
  if (level === 4) {
    upgradeBuildingEl.textContent = "God Mode active";
    upgradeBuildingEl.disabled = true;
  } else {
    const nextLevel = level + 1;
    const coinCost = stationUpgradeCoinCost(details.cost, nextLevel as 2 | 3 | 4);
    upgradeBuildingEl.textContent = nextLevel === 4
      ? `God Mode · ${coinCost} coins + ${GOD_MODE_CORE_COST} ◆`
      : `Upgrade to Lv.${nextLevel} · ${coinCost} coins`;
    upgradeBuildingEl.disabled = false;
  }
}

function allBuildingMeshes(selection: SelectedBuilding): Mesh[] {
  if (selection.kind === "shelf") return [...selection.building.staticMeshes, ...selection.building.meshes, selection.building.ring];
  if (selection.kind === "discard_bin" || selection.kind === "customer_counter") return [...selection.building.staticMeshes, selection.building.ring];
  return [...selection.building.staticMeshes, ...selection.building.inputMeshes, ...selection.building.outputMeshes, ...selection.building.upgradeMeshes, selection.building.ring];
}

function moveMeshAround(mesh: Mesh, oldPosition: Vector3, newPosition: Vector3, angle: number): void {
  const relative = mesh.position.subtract(oldPosition);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  mesh.position.set(
    newPosition.x + relative.x * cosine - relative.z * sine,
    mesh.position.y + newPosition.y - oldPosition.y,
    newPosition.z + relative.x * sine + relative.z * cosine,
  );
  mesh.rotation.y += angle;
}

function moveNodeAround(node: TransformNode, oldPosition: Vector3, newPosition: Vector3, angle: number): void {
  const relative = node.position.subtract(oldPosition);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  node.position.set(
    newPosition.x + relative.x * cosine - relative.z * sine,
    node.position.y + newPosition.y - oldPosition.y,
    newPosition.z + relative.x * sine + relative.z * cosine,
  );
  node.rotation.y += angle;
}

function relocateSelectedBuilding(position: Vector3): void {
  if (!relocatingBuilding) return;
  const building = relocatingBuilding.building;
  const oldPosition = building.position.clone();
  const angle = buildingRotation - building.rotation;
  allBuildingMeshes(relocatingBuilding).forEach((mesh) => moveMeshAround(mesh, oldPosition, position, angle));
  if (relocatingBuilding.kind === "customer_counter") {
    relocatingBuilding.building.customers.forEach((customer) => moveNodeAround(customer, oldPosition, position, angle));
  }
  building.position.copyFrom(position);
  building.rotation = buildingRotation;
  const status = stationStatuses.find((candidate) => Vector3.DistanceSquared(candidate.position, oldPosition.add(new Vector3(0, 2.45, 0))) < 0.1);
  status?.position.copyFrom(position.add(new Vector3(0, 2.45, 0)));
  buildStatusEl.textContent = `${buildSelectionDetails(selectedKind(relocatingBuilding)).name} moved`;
  relocatingBuilding = null;
  selectedBuilding = null;
  selectedBuildOutput = null;
  buildingActionsEl.classList.add("building-actions--hidden");
  buildingPreview.setEnabled(false);
}

function placeSelectedBuilding(): void {
  if (!selectedBuildOutput || !previewValid) {
    buildStatusEl.textContent = "That floor space is blocked";
    return;
  }
  if (relocatingBuilding) {
    relocateSelectedBuilding(new Vector3(buildingPreview.position.x, 0.33, buildingPreview.position.z));
    return;
  }
  const details = buildSelectionDetails(selectedBuildOutput);
  if (!spendCoins(details.cost, `You need ${details.cost} coins to build ${details.name}`, "building", { building: selectedBuildOutput })) return;
  const position = new Vector3(buildingPreview.position.x, 0.33, buildingPreview.position.z);
  recordBalanceEvent("building_constructed", { building: selectedBuildOutput, cost: details.cost, position: roundedXZ(position) });
  if (selectedBuildOutput === "discard_bin") {
    const bin = createDiscardBin(position);
    [...bin.staticMeshes, bin.ring].forEach((mesh) => moveMeshAround(mesh, position, position, buildingRotation));
    bin.rotation = buildingRotation;
    discardBins.push(bin);
    buildStatusEl.textContent = `${details.name} constructed`;
    updateBuildingPreview();
    return;
  }
  if (selectedBuildOutput === "customer_counter") {
    const counter = createCustomerCounter(position, details.cost);
    [...counter.staticMeshes, counter.ring].forEach((mesh) => moveMeshAround(mesh, position, position, buildingRotation));
    counter.customers.forEach((customer) => moveNodeAround(customer, position, position, buildingRotation));
    counter.rotation = buildingRotation;
    counter.ring.isVisible = false;
    customerCounters.push(counter);
    refreshDynamicBuildCosts();
    buildStatusEl.textContent = `${details.name} constructed · customer capacity ${customerCounters.length * 10}`;
    updateBuildingPreview();
    return;
  }
  if (selectedBuildOutput.startsWith("storage_shelf")) {
    const size = selectedBuildOutput === "storage_shelf_large" ? "large" : selectedBuildOutput === "storage_shelf_medium" ? "medium" : "small";
    const shelf = createStorageShelf(position, size);
    [...shelf.staticMeshes, shelf.ring].forEach((mesh) => moveMeshAround(mesh, position, position, buildingRotation));
    shelf.rotation = buildingRotation;
    shelves.push(shelf);
    buildStatusEl.textContent = `${details.name} constructed`;
    updateBuildingPreview();
    return;
  }
  if (selectedBuildOutput === "drying_rack") {
    const dryer = createDryer(position);
    [...dryer.staticMeshes, dryer.ring].forEach((mesh) => moveMeshAround(mesh, position, position, buildingRotation));
    dryer.rotation = buildingRotation;
    dryer.ring.isVisible = false;
    dryers.push(dryer);
    stationStatuses.push(createStationStatus(
      dryer.root.name,
      dryer.position.add(new Vector3(0, 2.45, 0)),
      () => dryer.input,
      () => dryer.output,
      dryer.capacity,
      () => dryer.input > 0 ? dryer.progress / dryer.duration : 0,
      () => dryer.output >= dryer.capacity && dryer.input > 0,
    ));
    buildStatusEl.textContent = `${details.name} constructed`;
    updateBuildingPreview();
    return;
  }
  const processor = createProcessor(selectedBuildOutput as ProcessorStationId, position);
  [...processor.staticMeshes, processor.ring].forEach((mesh) => moveMeshAround(mesh, position, position, buildingRotation));
  processor.rotation = buildingRotation;
  processors.push(processor);
  stationStatuses.push(createStationStatus(
    processor.name,
    processor.position.add(new Vector3(0, 2.45, 0)),
    () => processor.input,
    () => processor.outputAmount,
    processor.capacity,
    () => processor.input > 0 ? processor.progress / processor.duration : 0,
    () => processor.outputAmount >= processor.capacity && processor.input > 0,
  ));
  buildStatusEl.textContent = `${details.name} constructed`;
  updateBuildingPreview();
}

function setBuildMode(enabled: boolean): void {
  buildMode = enabled;
  if (enabled) refreshDynamicBuildCosts();
  if (enabled) setMoveMode(false);
  buildingGrid.isVisible = buildMode || moveMode;
  buildToggleEl.classList.toggle("tab-active", buildMode);
  buildToggleEl.textContent = buildMode ? "Finish" : "Build";
  if (!buildMode) {
    selectedBuildOutput = null;
    selectedBuilding = null;
    relocatingBuilding = null;
    buildingActionsEl.classList.add("building-actions--hidden");
  }
  targetMarker.isVisible = false;
  moveTarget = null;
  updateBuildingPreview();
}

function setMoveMode(enabled: boolean): void {
  moveMode = enabled;
  if (enabled) {
    buildMode = false;
    buildToggleEl.classList.remove("tab-active");
    buildToggleEl.textContent = "Build";
    managementPanelEl.classList.add("management-panel--hidden");
    managementTabEls.forEach((tab) => tab.classList.remove("tab-active"));
  }
  moveModeToggleEl.classList.toggle("tab-active", moveMode);
  moveModeToggleEl.textContent = moveMode ? "Finish Edit" : "Edit";
  rotateSelectedEl.classList.toggle("management-control-hidden", !moveMode);
  buildingGrid.isVisible = buildMode || moveMode;
  selectedBuildOutput = null;
  selectedBuilding = null;
  relocatingBuilding = null;
  dragCandidate = null;
  buildingPreview.setEnabled(false);
  buildingActionsEl.classList.add("building-actions--hidden");
  targetMarker.isVisible = false;
  moveTarget = null;
  if (moveMode) hintEl.textContent = "Drag buildings to move them · Click one to sell";
}

moveModeToggleEl.addEventListener("click", () => setMoveMode(!moveMode));

function openManagementPage(pageId: string): void {
  if (moveMode) setMoveMode(false);
  if (pageId === "worker-panel") syncWorkerControls();
  if (pageId === "farm-panel") renderFarmPanel();
  managementPageEls.forEach((page) => page.classList.toggle("management-page--hidden", page.id !== pageId));
  managementTabEls.forEach((tab) => tab.classList.toggle("tab-active", tab.dataset.panel === pageId));
  managementPanelEl.classList.remove("management-panel--hidden");
  orderDrawerEl.open = false;
  setBuildMode(pageId === "build-menu");
}

for (const tab of managementTabEls) {
  tab.addEventListener("click", () => {
    const pageId = tab.dataset.panel!;
    if (pageId === "build-menu" && buildMode && managementPanelEl.classList.contains("management-panel--hidden")) {
      setBuildMode(false);
      return;
    }
    openManagementPage(pageId);
  });
}

function closeManagementPanel(): void {
  managementPanelEl.classList.add("management-panel--hidden");
  managementTabEls.forEach((tab) => tab.classList.remove("tab-active"));
  if (buildMode && !selectedBuildOutput) hintEl.textContent = "Click a station to move or sell it · Build button exits";
}
closeManagementEl.addEventListener("click", closeManagementPanel);

for (const button of buildChoiceEls) {
  button.addEventListener("click", () => {
    selectedBuildOutput = button.dataset.build as BuildKind;
    relocatingBuilding = null;
    selectedBuilding = null;
    rebuildBuildingGhost(selectedBuildOutput);
    buildChoiceEls.forEach((choice) => choice.classList.toggle("build-selected", choice === button));
    buildStatusEl.textContent = "Move over the floor and click to place";
    managementPanelEl.classList.add("management-panel--hidden");
    updateBuildingPreview();
  });
}
function rotateBuilding(): void {
  buildingRotation = (buildingRotation + Math.PI / 2) % (Math.PI * 2);
  buildingPreview.rotation.y = buildingRotation;
  buildStatusEl.textContent = `Rotation ${Math.round(buildingRotation * 180 / Math.PI)}°`;
  updateBuildingPreview();
}
rotateBuildingEl.addEventListener("click", rotateBuilding);

function rotateSelectedBuilding(): void {
  if (!moveMode || !selectedBuilding) {
    hintEl.textContent = "Select a station first";
    return;
  }
  relocatingBuilding = selectedBuilding;
  selectedBuildOutput = selectedKind(selectedBuilding);
  buildingRotation = (selectedBuilding.building.rotation + Math.PI / 2) % (Math.PI * 2);
  const position = selectedBuilding.building.position.clone();
  previewValid = isBuildPositionValid(position);
  if (previewValid) {
    relocateSelectedBuilding(position);
    hintEl.textContent = "Station rotated";
  } else {
    relocatingBuilding = null;
    selectedBuildOutput = null;
    hintEl.textContent = "There is not enough room to rotate this station";
  }
}
rotateSelectedEl.addEventListener("click", rotateSelectedBuilding);

function cancelBuildingAction(): void {
  dragCandidate = null;
  relocatingBuilding = null;
  selectedBuildOutput = null;
  selectedBuilding = null;
  previewValid = false;
  buildingPreview.setEnabled(false);
  buildingActionsEl.classList.add("building-actions--hidden");
  buildChoiceEls.forEach((choice) => choice.classList.remove("build-selected"));
  hintEl.textContent = moveMode ? "Building move cancelled" : "Building placement cancelled";
}

type InputAction = "moveUp" | "moveDown" | "moveLeft" | "moveRight" | "sprint" | "cameraLeft" | "cameraRight" | "build" | "farm" | "player" | "workers" | "settings" | "pause" | "speed1" | "speed2" | "speed3" | "rotate";
const defaultKeybinds: Record<InputAction, string> = {
  moveUp: "w", moveDown: "s", moveLeft: "a", moveRight: "d", sprint: "shift",
  cameraLeft: "q", cameraRight: "e",
  build: "b", farm: "f", player: "p", workers: "v", settings: "escape", pause: " ",
  speed1: "1", speed2: "2", speed3: "3", rotate: "r",
};
const actionLabels: Record<InputAction, string> = {
  moveUp: "Move up", moveDown: "Move down", moveLeft: "Move left", moveRight: "Move right", sprint: "Sprint",
  cameraLeft: "Rotate camera left", cameraRight: "Rotate camera right",
  build: "Open Build", farm: "Open Farm", player: "Open Player", workers: "Open Workers", settings: "Open Settings", pause: "Pause / play",
  speed1: "Speed 1×", speed2: "Speed 2×", speed3: "Speed 3×", rotate: "Rotate building",
};
const storedKeybinds = localStorage.getItem("farming-unlimited-keybinds");
let keybinds: Record<InputAction, string> = { ...defaultKeybinds };
try { if (storedKeybinds) keybinds = { ...keybinds, ...JSON.parse(storedKeybinds) }; } catch { /* retain defaults */ }
let bindingAction: InputAction | null = null;

function displayKey(key: string): string {
  if (key === " ") return "Space";
  if (key === "shift") return "Shift";
  if (key === "escape") return "Escape";
  return key.length === 1 ? key.toUpperCase() : key;
}

function renderKeybinds(): void {
  keybindListEl.replaceChildren();
  for (const action of Object.keys(actionLabels) as InputAction[]) {
    const label = document.createElement("span");
    label.textContent = actionLabels[action];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = bindingAction === action ? "Press key…" : displayKey(keybinds[action]);
    button.classList.toggle("listening", bindingAction === action);
    button.addEventListener("click", () => { bindingAction = action; renderKeybinds(); });
    keybindListEl.append(label, button);
  }
}
resetKeybindsEl.addEventListener("click", () => {
  keybinds = { ...defaultKeybinds };
  localStorage.removeItem("farming-unlimited-keybinds");
  bindingAction = null;
  renderKeybinds();
});
renderKeybinds();

let timeScale = 1;
let lastRunningTimeScale = 1;
function setTimeScale(nextScale: number): void {
  if (nextScale > 0) lastRunningTimeScale = nextScale;
  timeScale = nextScale;
  speedControlEls.forEach((candidate) => candidate.classList.toggle("speed-active", Number(candidate.dataset.speed) === timeScale));
  hintEl.textContent = timeScale === 0 ? "Game paused" : `Game speed ${timeScale}×`;
}
for (const control of speedControlEls) control.addEventListener("click", () => setTimeScale(Number(control.dataset.speed)));

const keys = new Set<string>();
let moveTarget: Vector3 | null = null;
let playerNavigationPath: Vector3[] = [];
let playerEjectionStart: Vector3 | null = null;
let playerEjectionTarget: Vector3 | null = null;
let playerEjectionElapsed = 0;
let interactionCooldown = 0;
let farmUiRefreshTimer = 0;
let questStage = 0;
function advanceQuestStage(stage: number): void {
  if (stage <= questStage) return;
  const previous = questStage;
  questStage = stage;
  recordBalanceEvent("progression_milestone", { kind: "quest_stage", previous, stage });
}
let shelfDepositArmed = true;
let wasAtStorage = false;
let stamina = playerStats.maxStamina;
let idleTime = 0;

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (bindingAction) {
    event.preventDefault();
    if (key === "escape") bindingAction = null;
    else {
      const conflictingAction = (Object.keys(keybinds) as InputAction[]).find((action) => action !== bindingAction && keybinds[action] === key);
      if (conflictingAction) keybinds[conflictingAction] = keybinds[bindingAction];
      keybinds[bindingAction] = key;
      localStorage.setItem("farming-unlimited-keybinds", JSON.stringify(keybinds));
      bindingAction = null;
    }
    renderKeybinds();
    return;
  }
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement;
  if (!editing && !event.repeat) {
    if (key === "escape" && ((buildMode && selectedBuildOutput) || (moveMode && (relocatingBuilding || dragCandidate)))) {
      cancelBuildingAction();
      event.preventDefault();
      keys.delete(key);
      return;
    }
    if (key === "escape" && !managementPanelEl.classList.contains("management-panel--hidden")) {
      closeManagementPanel();
      event.preventDefault();
      keys.delete(key);
      return;
    }
    if (key === keybinds.rotate && moveMode && selectedBuilding && !relocatingBuilding) rotateSelectedBuilding();
    else if (key === keybinds.rotate && (buildMode || moveMode) && selectedBuildOutput) rotateBuilding();
    else if (key === keybinds.cameraLeft) rotateCamera(-1);
    else if (key === keybinds.cameraRight) rotateCamera(1);
    else if (key === keybinds.build) openManagementPage("build-menu");
    else if (key === keybinds.farm) openManagementPage("farm-panel");
    else if (key === keybinds.player) openManagementPage("player-upgrades");
    else if (key === keybinds.workers) openManagementPage("worker-panel");
    else if (key === keybinds.settings || key === "escape") openManagementPage("settings-panel");
    else if (key === keybinds.pause) setTimeScale(timeScale === 0 ? lastRunningTimeScale : 0);
    else if (key === keybinds.speed1) setTimeScale(1);
    else if (key === keybinds.speed2) setTimeScale(2);
    else if (key === keybinds.speed3) setTimeScale(3);
  }
  if (key === keybinds.pause) event.preventDefault();
  keys.add(key);
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

function setMovementTargetFromPointer(): void {
  // Pick only walkable surfaces. This deliberately looks through plants,
  // furniture and interaction rings so clicking near an object still moves.
  const pick = scene.pick(
    scene.pointerX,
    scene.pointerY,
    (mesh) => mesh === ground || mesh === floor,
    false,
    camera,
  );
  if (!pick?.hit || !pick.pickedPoint) return;

  moveTarget = pick.pickedPoint.clone();
  moveTarget.y = player.position.y;
  playerNavigationPath = findNavigationPath(player.position, moveTarget);
  const reachableTarget = playerNavigationPath[playerNavigationPath.length - 1] ?? moveTarget;
  moveTarget.copyFrom(reachableTarget);
  targetMarker.position.set(reachableTarget.x, 0.37, reachableTarget.z);
  targetMarker.isVisible = true;
  hintEl.textContent = "Moving to destination · WASD cancels";
}

function selectBuildingFromPointer(): void {
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => Boolean(mesh.metadata?.buildingKind), false, camera);
  const metadata = pick?.pickedMesh?.metadata as { buildingKind?: BuildKind; buildingId?: number } | undefined;
  if (!pick?.hit || !metadata?.buildingKind || metadata.buildingId === undefined) {
    selectedBuilding = null;
    buildingActionsEl.classList.add("building-actions--hidden");
    return;
  }
  if (metadata.buildingKind === "drying_rack") {
    const building = dryers.find((dryer) => dryer.instanceId === metadata.buildingId);
    selectedBuilding = building ? { kind: "dryer", building } : null;
  } else if (metadata.buildingKind === "storage_shelf") {
    const building = shelves.find((shelf) => shelf.instanceId === metadata.buildingId);
    selectedBuilding = building ? { kind: "shelf", building } : null;
  } else if (metadata.buildingKind === "discard_bin") {
    const building = discardBins.find((bin) => bin.instanceId === metadata.buildingId);
    selectedBuilding = building ? { kind: "discard_bin", building } : null;
  } else if (metadata.buildingKind === "customer_counter") {
    const building = customerCounters.find((counter) => counter.instanceId === metadata.buildingId);
    selectedBuilding = building ? { kind: "customer_counter", building } : null;
  } else {
    const building = processors.find((processor) => processor.instanceId === metadata.buildingId);
    selectedBuilding = building ? { kind: "processor", building } : null;
  }
  if (!selectedBuilding) return;
  refreshSelectedBuildingActions();
  const refund = buildingRefund(selectedBuilding);
  sellBuildingEl.textContent = `Sell +${refund}`;
  buildingActionsEl.classList.remove("building-actions--hidden");
}

upgradeBuildingEl.addEventListener("click", () => {
  if (!selectedBuilding || (selectedBuilding.kind !== "dryer" && selectedBuilding.kind !== "processor")) return;
  const station = selectedBuilding.building;
  if (station.level >= 4) return;
  const details = buildSelectionDetails(selectedKind(selectedBuilding));
  const nextLevel = (station.level + 1) as 2 | 3 | 4;
  const coinCost = stationUpgradeCoinCost(details.cost, nextLevel);
  if (coins < coinCost) {
    recordBalanceEvent("purchase_blocked", { currency: "coins", cost: coinCost, available: coins, cause: "station_upgrade", station: selectedKind(selectedBuilding), level: nextLevel });
    hintEl.textContent = `You need ${coinCost} coins for this upgrade`;
    return;
  }
  if (nextLevel === 4 && astralCores < GOD_MODE_CORE_COST) {
    recordBalanceEvent("purchase_blocked", { currency: "astral_core", cost: GOD_MODE_CORE_COST, available: astralCores, cause: "station_upgrade", station: selectedKind(selectedBuilding), level: nextLevel });
    hintEl.textContent = `God Mode requires ${GOD_MODE_CORE_COST} Astral Cores · You have ${astralCores}`;
    return;
  }
  const coinsBeforeUpgrade = coins;
  const coresBeforeUpgrade = astralCores;
  coins -= coinCost;
  if (nextLevel === 4) astralCores -= GOD_MODE_CORE_COST;
  recordBalanceEvent("currency", { currency: "coins", delta: -coinCost, before: coinsBeforeUpgrade, after: coins, cause: "station_upgrade", station: selectedKind(selectedBuilding), level: nextLevel });
  if (nextLevel === 4) recordBalanceEvent("currency", { currency: "astral_core", delta: -GOD_MODE_CORE_COST, before: coresBeforeUpgrade, after: astralCores, cause: "station_upgrade", station: selectedKind(selectedBuilding), level: nextLevel });
  coinsEl.textContent = String(coins);
  updateAstralCoreHud();
  applyStationLevel(selectedBuilding, nextLevel);
  recordBalanceEvent("upgrade", { kind: "station", station: selectedKind(selectedBuilding), instanceId: station.instanceId, level: nextLevel, coinCost, coreCost: nextLevel === 4 ? GOD_MODE_CORE_COST : 0 });
  refreshSelectedBuildingActions();
  hintEl.textContent = nextLevel === 4 ? `${details.name} entered God Mode` : `${details.name} upgraded to Level ${nextLevel}`;
});

sellBuildingEl.addEventListener("click", () => {
  if (!selectedBuilding) return;
  const selection = selectedBuilding;
  if (selection.kind === "shelf" && shelves.length === 1) {
    hintEl.textContent = "The workshop must keep at least one storage shelf";
    return;
  }
  if (selection.kind === "discard_bin" && discardBins.length === 1) {
    hintEl.textContent = "The workshop must keep at least one garbage bin";
    return;
  }
  if (selection.kind === "customer_counter" && customerCounters.length === 1) {
    hintEl.textContent = "The shop must keep at least one sales counter";
    return;
  }
  if (selection.kind === "customer_counter" && customerOrders.some((order) => counterForOrder(order) === selection.building)) {
    hintEl.textContent = "Serve or refuse this counter's customers before selling it";
    return;
  }
  const building = selection.building;
  const buildingKind = selectedKind(selection);
  const refund = buildingRefund(selection);
  allBuildingMeshes(selection).forEach((mesh) => mesh.dispose());
  if (selection.kind === "dryer") {
    selection.building.root.dispose();
    dryers.splice(dryers.indexOf(selection.building), 1);
  }
  else if (selection.kind === "shelf") {
    shelves.splice(shelves.indexOf(selection.building), 1);
    if (storage === selection.building) storage = shelves[0]!;
  } else if (selection.kind === "discard_bin") {
    discardBins.splice(discardBins.indexOf(selection.building), 1);
  } else if (selection.kind === "customer_counter") {
    selection.building.customers.forEach((customer) => customer.dispose());
    customerCounters.splice(customerCounters.indexOf(selection.building), 1);
    refreshDynamicBuildCosts();
  } else processors.splice(processors.indexOf(selection.building), 1);
  const statusIndex = stationStatuses.findIndex((status) => Vector3.DistanceSquared(status.position, building.position.add(new Vector3(0, 2.45, 0))) < 0.1);
  if (statusIndex >= 0) stationStatuses.splice(statusIndex, 1)[0]?.element.remove();
  const coinsBeforeSale = coins;
  coins += refund;
  recordBalanceEvent("currency", { currency: "coins", delta: refund, before: coinsBeforeSale, after: coins, cause: "building_sale", building: buildingKind });
  recordBalanceEvent("building_sold", { building: buildingKind, instanceId: building.instanceId, refund });
  coinsEl.textContent = String(coins);
  hintEl.textContent = `${buildSelectionDetails(selectedKind(selection)).name} sold for ${refund} coins`;
  selectedBuilding = null;
  buildingActionsEl.classList.add("building-actions--hidden");
});

let dragCandidate: SelectedBuilding | null = null;
let dragStartX = 0;
let dragStartY = 0;

function beginBuildingDrag(): void {
  if (!dragCandidate || relocatingBuilding) return;
  selectedBuilding = dragCandidate;
  relocatingBuilding = dragCandidate;
  selectedBuildOutput = selectedKind(dragCandidate);
  buildingRotation = dragCandidate.building.rotation;
  rebuildBuildingGhost(selectedBuildOutput);
  buildingActionsEl.classList.add("building-actions--hidden");
  updateBuildingPreview();
}

scene.onPointerDown = (event) => {
  if (event.button !== 0) return;
  if (moveMode) {
    selectBuildingFromPointer();
    dragCandidate = selectedBuilding;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    return;
  }
  if (buildMode) {
    if (selectedBuildOutput) placeSelectedBuilding();
    return;
  }
  setMovementTargetFromPointer();
};
scene.onPointerMove = (event) => {
  if (moveMode && dragCandidate && !relocatingBuilding
    && Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY) >= 6) beginBuildingDrag();
  updateBuildingPreview();
};
scene.onPointerUp = () => {
  if (!moveMode) return;
  dragCandidate = null;
  if (!relocatingBuilding) return;
  if (previewValid && buildingPreview.isEnabled()) {
    relocateSelectedBuilding(new Vector3(buildingPreview.position.x, 0.33, buildingPreview.position.z));
    hintEl.textContent = "Building moved · Drag another building or click one to sell";
  } else {
    relocatingBuilding = null;
    selectedBuildOutput = null;
    buildingPreview.setEnabled(false);
    buildingActionsEl.classList.remove("building-actions--hidden");
    hintEl.textContent = "That position is blocked";
  }
};

function getKeyboardDirection(): Vector3 {
  let horizontal = 0;
  let vertical = 0;
  if (keys.has(keybinds.moveUp) || keys.has("arrowup")) vertical += 1;
  if (keys.has(keybinds.moveDown) || keys.has("arrowdown")) vertical -= 1;
  if (keys.has(keybinds.moveLeft) || keys.has("arrowleft")) horizontal -= 1;
  if (keys.has(keybinds.moveRight) || keys.has("arrowright")) horizontal += 1;
  if (horizontal === 0 && vertical === 0) return Vector3.Zero();

  const screenForward = camera.target.subtract(camera.position);
  screenForward.y = 0;
  screenForward.normalize();
  const screenRight = Vector3.Cross(Vector3.Up(), screenForward).normalize();
  return screenForward.scale(vertical).add(screenRight.scale(horizontal)).normalize();
}

function updateHud(): void {
  const counts = groupItems(inventory.items);
  const summary = (Object.entries(counts) as [ItemId, number][])
    .map(([item, amount]) => `${itemLabel(item)} ×${amount}`)
    .join(" · ");
  carryingEl.textContent = summary || "Nothing";
  carryingCountEl.textContent = `${inventory.items.length}/${inventory.capacity}`;
  if (questStage === 0) {
    questEl.textContent = "Gather Sunleaf";
    questDetailEl.textContent = "Walk through the glowing plants";
  } else if (questStage === 1) {
    questEl.textContent = "Use the Drying Rack";
    questDetailEl.textContent = "Approach it while carrying Sunleaf";
  } else if (questStage === 2) {
    questEl.textContent = "Collect Dried Sunleaf";
    questDetailEl.textContent = "Wait for the rack, then collect its output";
  } else if (questStage === 3) {
    questEl.textContent = "Choose a Product";
    questDetailEl.textContent = "Take Dried Sunleaf to one of three stations";
  } else if (questStage === 4) {
    questEl.textContent = "Stock the Shelf";
    questDetailEl.textContent = "Carry your finished product to storage";
  } else {
    questEl.textContent = "Three Paths, One Herb";
    questDetailEl.textContent = "The branching production loop is complete";
  }
}

function collect(item: ItemId, amount: number): number {
  const taken = addItems(inventory.items, item, amount, inventory.capacity);
  if (taken <= 0) return 0;
  rebuildCarryStack();
  updateHud();
  return taken;
}

function countCarried(item: ItemId): number {
  return countItem(inventory.items, item);
}

function removeCarried(item: ItemId, amount: number): number {
  return removeItems(inventory.items, item, amount);
}

function stationWorkSpeed(position: Vector3, facilityId: string): number {
  let multiplier = 1;
  for (const rosterWorker of workers) {
    if (!rosterWorker.hired || rosterWorker.unpaid || !rosterWorker.production || !rosterWorker.allowedFacilities.includes(facilityId)) continue;
    if (Vector3.DistanceSquared(rosterWorker.root.position, position) > 12.25) continue;
    const aptitude = rosterWorker.suitability.alchemy;
    const roleBonus = rosterWorker.role === "alchemist" ? 0.08 : rosterWorker.role === "generalist" ? 0.02 : 0;
    multiplier += 0.025 * aptitude + roleBonus;
  }
  return Math.min(1.35, multiplier);
}

function patchRegrowthSpeed(position: Vector3): number {
  let multiplier = 1;
  for (const rosterWorker of workers) {
    if (!rosterWorker.hired || rosterWorker.unpaid || !rosterWorker.production) continue;
    if (Vector3.DistanceSquared(rosterWorker.root.position, position) > 12.25) continue;
    const roleBonus = rosterWorker.role === "farmer" ? 0.1 : rosterWorker.role === "generalist" ? 0.02 : 0;
    multiplier += 0.025 * rosterWorker.suitability.farming + roleBonus;
  }
  return Math.min(1.35, multiplier);
}

function updateInteractions(dt: number): void {
  interactionCooldown = Math.max(0, interactionCooldown - dt);
  farmUiRefreshTimer -= dt;
  if (farmUiRefreshTimer <= 0 && !document.querySelector("#farm-panel.management-page--hidden")) {
    farmUiRefreshTimer = 0.5;
    updateFarmPanelProgress();
  }
  updateCustomerPatience(dt);
  let closestFarmPatch: ResourcePatch | null = null;
  let closestFarmDistance = Infinity;
  for (const patch of patches) {
    const capacity = farmPlotCapacity(patch);
    if (patch.unlocked && patch.planted && patch.stock < capacity && patch.remainingYield > 0) {
      patch.respawn -= dt * patchRegrowthSpeed(patch.root.position);
      if (patch.respawn <= 0 && patch.cropId) {
        const crop = cropById.get(patch.cropId)!;
        patch.stock++;
        patch.remainingYield--;
        recordBalanceEvent("crop_grown", { crop: patch.cropId, plot: patch.slot + 1, stock: patch.stock, capacity, remainingYield: patch.remainingYield });
        patch.respawn = patch.stock < capacity && patch.remainingYield > 0 ? farmUnitGrowthSeconds(patch) : 0;
        if (patch.stock >= capacity) hintEl.textContent = `${crop.name} plot is full`;
      }
    }
    refreshFarmPlotVisual(patch);
    const distanceToPlot = Vector3.DistanceSquared(player.position, patch.root.position);
    const near = patch.unlocked && isWithinBuildingInteractionRadius(
      player.position,
      patch.root.position,
      { width: 2.35, depth: 1.72 },
      0.5,
    );
    if (near && distanceToPlot < closestFarmDistance) {
      closestFarmPatch = patch;
      closestFarmDistance = distanceToPlot;
    }
    patch.ring.scaling.setAll(1 + Math.sin(performance.now() * 0.004) * 0.05);
    if (near && patch.stock > 0 && inventory.items.length < inventory.capacity && interactionCooldown <= 0) {
      const harvested = harvestFarmPlot(patch, 1, "player");
      if (harvested) {
        collect(harvested.item, harvested.amount);
        interactionCooldown = 0.22;
        hintEl.textContent = `Collected ${itemLabel(harvested.item)} · ${patch.stock} remaining`;
        if (harvested.item === "sunleaf" && questStage === 0) advanceQuestStage(1);
        updateHud();
      }
    }
  }
  if (closestFarmPatch && managementPanelEl.classList.contains("management-panel--hidden")) updateFarmContext(closestFarmPatch);
  else hideFarmContext();

  for (const dryer of dryers) {
    const dryerZone = dryer.position.clone();
    dryerZone.y = player.position.y;
    const atDryer = isWithinBuildingInteractionRadius(player.position, dryer.position, buildingFootprint("drying_rack", dryer.rotation));
    dryer.ring.scaling.setAll(1 + Math.sin(performance.now() * 0.0035 + dryer.position.x) * 0.05);
    if (atDryer && interactionCooldown <= 0) {
      const compatibleCarried = inventory.items.find((item) => dryerRecipeForInput(item));
      const compatibleRecipe = compatibleCarried ? dryerRecipeForInput(compatibleCarried) : undefined;
      if (compatibleCarried && compatibleRecipe && dryer.inputQueue.length < dryer.capacity) {
        removeCarried(compatibleCarried, 1);
        dryer.inputQueue.push(compatibleCarried);
        refreshDryerInput(dryer);
        interactionCooldown = 0.18;
        advanceQuestStage(2);
        hintEl.textContent = `${itemLabel(compatibleCarried)} queued at the Drying Rack → ${itemLabel(compatibleRecipe.output)}`;
        rebuildCarryStack();
        updateHud();
      } else if (dryer.outputItems.length > 0 && inventory.items.length < inventory.capacity) {
        const availableSpace = inventory.capacity - inventory.items.length;
        const collectedItems = dryer.outputItems.splice(0, availableSpace);
        for (const item of collectedItems) collect(item, 1);
        const taken = collectedItems.length;
        interactionCooldown = 0.25;
        if (taken > 0) {
          advanceQuestStage(3);
          hintEl.textContent = `Collected ${itemSummary(collectedItems)} from the Drying Rack`;
        }
        refreshDryerOutput(dryer);
        updateHud();
      }
    }

    if (dryer.inputQueue.length > 0 && dryer.outputItems.length < dryer.capacity) {
      const nextRecipe = dryerRecipeForInput(dryer.inputQueue[0]!);
      if (!nextRecipe || !configureDryerRecipe(dryer, nextRecipe)) continue;
      dryer.progress += dt * stationWorkSpeed(dryer.position, "drying_rack");
      const activeInput = dryer.inputMeshes[dryer.inputMeshes.length - 1];
      if (activeInput) activeInput.scaling.y = Math.max(0.08, 1 - dryer.progress / dryer.duration);
      if (dryer.progress >= dryer.duration) {
        dryer.progress = 0;
        dryer.inputQueue.shift();
        dryer.outputItems.push(nextRecipe.output);
        recordBalanceEvent("item_produced", { station: "drying_rack", instanceId: dryer.instanceId, level: dryer.level, input: nextRecipe.input, output: nextRecipe.output, duration: roundedBalanceValue(dryer.duration) });
        refreshDryerInput(dryer);
        refreshDryerOutput(dryer);
        hintEl.textContent = "A Drying Rack finished a bundle";
      }
    }
  }

  for (const processor of processors) {
    processor.ring.scaling.setAll(1 + Math.sin(performance.now() * 0.0035 + processor.position.x) * 0.05);
    const zone = processor.position.clone();
    zone.y = player.position.y;
    const near = isWithinBuildingInteractionRadius(player.position, processor.position, buildingFootprint(processor.stationId, processor.rotation));
    if (near && interactionCooldown <= 0) {
      const compatibleCarried = inventory.items.find((item) => processorRecipeForInput(processor, item));
      const compatibleRecipe = compatibleCarried ? processorRecipeForInput(processor, compatibleCarried) : undefined;
      if (compatibleCarried && compatibleRecipe && processor.inputQueue.length < processor.capacity) {
        removeCarried(compatibleCarried, 1);
        processor.inputQueue.push(compatibleCarried);
        refreshProcessorInput(processor);
        interactionCooldown = 0.2;
        hintEl.textContent = `${itemLabel(compatibleCarried)} queued at ${processor.name} → ${itemLabel(compatibleRecipe.output)}`;
        rebuildCarryStack();
        updateHud();
      } else if (processor.outputItems.length > 0 && inventory.items.length < inventory.capacity) {
        const availableSpace = inventory.capacity - inventory.items.length;
        const collectedItems = processor.outputItems.splice(0, availableSpace);
        for (const item of collectedItems) collect(item, 1);
        const taken = collectedItems.length;
        interactionCooldown = 0.25;
        if (taken > 0) {
          advanceQuestStage(4);
          hintEl.textContent = `Collected ${itemSummary(collectedItems)} · Take it to a shelf`;
        }
        refreshProcessorOutput(processor);
        updateHud();
      }
    }
    if (processor.inputQueue.length > 0 && processor.outputItems.length < processor.capacity) {
      const nextRecipe = processorRecipeForInput(processor, processor.inputQueue[0]!);
      if (!nextRecipe || !configureProcessorRecipe(processor, nextRecipe)) continue;
      processor.progress += dt * stationWorkSpeed(processor.position, processor.stationId);
      const activeInput = processor.inputMeshes[processor.inputMeshes.length - 1];
      if (activeInput) activeInput.scaling.y = Math.max(0.08, 1 - processor.progress / processor.duration);
      if (processor.progress >= processor.duration) {
        processor.progress = 0;
        processor.inputQueue.shift();
        processor.outputItems.push(nextRecipe.output);
        recordBalanceEvent("item_produced", { station: processor.stationId, instanceId: processor.instanceId, level: processor.level, input: nextRecipe.input, output: nextRecipe.output, duration: roundedBalanceValue(processor.duration) });
        refreshProcessorInput(processor);
        refreshProcessorOutput(processor);
        hintEl.textContent = `${processor.name} finished a product`;
      }
    }
  }

  const nearestShelf = shelves.reduce((nearest, shelf) =>
    Vector3.DistanceSquared(player.position, shelf.position) < Vector3.DistanceSquared(player.position, nearest.position) ? shelf : nearest, shelves[0]!);
  storage = nearestShelf;
  const storageZone = storage.ring.position.clone();
  storageZone.y = player.position.y;
  const atStorage = isWithinBuildingInteractionRadius(player.position, storage.position, buildingFootprint(storage.size === "large" ? "storage_shelf_large" : storage.size === "medium" ? "storage_shelf_medium" : "storage_shelf", storage.rotation));
  shelfMenuEl.classList.toggle("shelf-menu--hidden", !atStorage);
  if (atStorage && !wasAtStorage) {
    renderShelfFilterItems();
    updateShelfMenu();
  }
  if (!atStorage) shelfDepositArmed = true;
  if (atStorage && shelfDepositArmed) {
    // Depositing is edge-triggered. Goods taken from the shelf remain in the
    // player's hands until they leave this radius and deliberately return.
    const freeShelfSlots = storage.capacity - shelfItemCount(storage);
    const acceptedItems = inventory.items.filter((item) => shelfAccepts(item)).slice(0, freeShelfSlots);
    if (acceptedItems.length > 0) {
      for (const item of acceptedItems) storage.items[item] = (storage.items[item] ?? 0) + 1;
      for (const item of acceptedItems) {
        const carriedIndex = inventory.items.indexOf(item);
        if (carriedIndex >= 0) inventory.items.splice(carriedIndex, 1);
      }
      interactionCooldown = 0.4;
      advanceQuestStage(5);
      shelfDepositArmed = false;
      hintEl.textContent = `Stored ${itemSummary(acceptedItems)}`;
      refreshStorage();
      rebuildCarryStack();
      updateHud();
    } else if (inventory.items.length > 0) {
      hintEl.textContent = freeShelfSlots <= 0 ? "This shelf is full" : "This shelf's filter does not accept the carried item";
    }
  }
  wasAtStorage = atStorage;

  for (const counter of customerCounters) {
    const counterCustomerCount = customerOrders.filter((order) => counterForOrder(order) === counter).length;
    if (counterCustomerCount >= 10) continue;
    counter.arrivalTimer -= dt;
    if (counter.arrivalTimer <= 0) {
      spawnCustomer(counter);
      counter.arrivalTimer = calculateNextArrivalDelay(counter);
    }
  }

  for (const counter of customerCounters) {
    counter.ring.scaling.setAll(1 + Math.sin(performance.now() * 0.004 + counter.instanceId) * 0.05);
    const atCounter = isWithinBuildingInteractionRadius(player.position, counter.position, buildingFootprint("customer_counter", counter.rotation));
    if (!atCounter || inventory.items.length === 0 || interactionCooldown > 0) continue;
    const acceptedOrders = customerOrders
      .filter((order) => order.accepted && counterForOrder(order) === counter)
      .sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0));
    const deliverable = acceptedOrders
      .map((order) => ({
        order,
        item: inventory.items
          .filter((item) => order.exactItem ? item === order.exactItem : finishedProducts.includes(item))
          .sort((a, b) => (productValues[b] ?? 0) - (productValues[a] ?? 0))[0],
      }))
      .find((candidate) => candidate.item !== undefined);
    if (deliverable?.item) {
      const { order, item: deliveryItem } = deliverable;
      const delivered = Math.min(countCarried(deliveryItem), order.amount - order.delivered);
      const payment = Math.round(delivered * (productValues[deliveryItem] ?? 0) * order.rewardMultiplier);
      removeCarried(deliveryItem, delivered);
      order.delivered += delivered;
      const coinsBeforeDelivery = coins;
      coins += payment;
      lifetimeRevenue += payment;
      recordBalanceEvent("sale_delivery", { by: "player", orderId: order.id, item: deliveryItem, amount: delivered, payment, multiplier: order.rewardMultiplier });
      recordBalanceEvent("currency", { currency: "coins", delta: payment, before: coinsBeforeDelivery, after: coins, cause: "sale_delivery", orderId: order.id });
      coinsEl.textContent = String(coins);
      rebuildCarryStack();
      interactionCooldown = 0.6;
      if (order.delivered >= order.amount) {
        const completedAtCounter = counterForOrder(order);
        const coinsBeforeReward = coins;
        coins += order.baseReward;
        lifetimeRevenue += order.baseReward;
        completedOrders++;
        const foundCore = rollGoldenCustomerCore(order);
        recordBalanceEvent("currency", { currency: "coins", delta: order.baseReward, before: coinsBeforeReward, after: coins, cause: "order_reward", orderId: order.id });
        recordBalanceEvent("order_completed", { by: "player", orderId: order.id, item: order.exactItem, amount: order.amount, baseReward: order.baseReward, coreAwarded: foundCore, elapsed: order.acceptedAt === null ? null : roundedBalanceValue((performance.now() - order.acceptedAt) / 1000) });
        coinsEl.textContent = String(coins);
        hintEl.textContent = foundCore
          ? `${order.customer}'s order complete · Astral Core found! ${astralCores}/${GOD_MODE_CORE_COST}`
          : `${order.customer}'s order complete · Earned ${payment + order.baseReward} coins`;
        customerForOrder(order)?.setEnabled(false);
        customerOrders.splice(customerOrders.indexOf(order), 1);
        rescheduleAfterDeparture(completedAtCounter);
      } else {
        hintEl.textContent = `Delivered ${delivered} to ${order.customer} · More needed`;
      }
      refreshCustomerCounterRings();
      updateOrderCards();
      updateHud();
    }
  }

  for (const bin of discardBins) {
    bin.ring.scaling.setAll(1 + Math.sin(performance.now() * 0.004 + bin.instanceId) * 0.05);
    const atDiscardBin = isWithinBuildingInteractionRadius(player.position, bin.position, buildingFootprint("discard_bin", bin.rotation));
    if (atDiscardBin && inventory.items.length > 0 && interactionCooldown <= 0) {
      const discardedAmount = inventory.items.length;
      const discardedTypes = new Set(inventory.items).size;
      const discardedItems = balanceItemCounts(inventory.items);
      inventory.items = [];
      recordBalanceEvent("items_discarded", { by: "player", binId: bin.instanceId, amount: discardedAmount, items: discardedItems });
      interactionCooldown = 0.8;
      hintEl.textContent = `Discarded ${discardedAmount} item${discardedAmount === 1 ? "" : "s"} (${discardedTypes} type${discardedTypes === 1 ? "" : "s"})`;
      rebuildCarryStack();
      updateHud();
    }
  }
}

function updatePlayer(dt: number): void {
  if (playerEjectionTarget && playerEjectionStart) {
    playerEjectionElapsed = Math.min(0.18, playerEjectionElapsed + dt);
    const progress = playerEjectionElapsed / 0.18;
    const eased = progress * progress * (3 - 2 * progress);
    player.position.copyFrom(Vector3.Lerp(playerEjectionStart, playerEjectionTarget, eased));
    if (progress >= 1) {
      playerEjectionStart = null;
      playerEjectionTarget = null;
      playerEjectionElapsed = 0;
    } else {
      camera.target.set(player.position.x, player.position.y + 0.65, player.position.z);
      return;
    }
  }
  const resolvedPosition = resolveNavigationPenetration(player.position, 0.3);
  if (Vector3.DistanceSquared(resolvedPosition, player.position) > 0.0001) {
    playerEjectionStart = player.position.clone();
    playerEjectionTarget = resolvedPosition;
    playerEjectionElapsed = 0;
    camera.target.set(player.position.x, player.position.y + 0.65, player.position.z);
    return;
  }
  let direction = getKeyboardDirection();
  if (direction.lengthSquared() > 0) {
    moveTarget = null;
    playerNavigationPath = [];
    targetMarker.isVisible = false;
  } else if (moveTarget) {
    while (playerNavigationPath.length > 0 && Vector3.DistanceSquared(player.position, playerNavigationPath[0]!) < 0.1) playerNavigationPath.shift();
    const delta = (playerNavigationPath[0] ?? moveTarget).subtract(player.position);
    delta.y = 0;
    if (delta.length() < 0.14) {
      moveTarget = null;
      playerNavigationPath = [];
      targetMarker.isVisible = false;
    } else {
      direction = delta.normalize();
    }
  }
  if (direction.lengthSquared() > 0) {
    const sprintRequested = keys.has(keybinds.sprint);
    const sprinting = sprintRequested && stamina > 0;
    if (sprinting) {
      idleTime = 0;
      stamina = Math.max(0, stamina - playerStats.staminaDrainPerSecond * dt);
    } else {
      idleTime += dt;
      if (idleTime >= 0.75) stamina = Math.min(playerStats.maxStamina, stamina + playerStats.staminaRegenPerSecond * dt);
    }
    const movementSpeed = sprinting ? 5.6 : 3.65;
    const next = player.position.add(direction.scale(movementSpeed * dt));
    next.x = Math.max(-13.7, Math.min(13.7, next.x));
    next.z = Math.max(-10.7, Math.min(10.7, next.z));
    player.position.copyFrom(moveWithNavigationCollision(player.position, next.subtract(player.position), 0.3));
    const yaw = Math.atan2(direction.x, direction.z);
    player.rotationQuaternion = Quaternion.Slerp(
      player.rotationQuaternion ?? Quaternion.FromEulerAngles(0, yaw, 0),
      Quaternion.FromEulerAngles(0, yaw, 0),
      Math.min(1, dt * 12),
    );
    player.position.y = 0.33 + Math.abs(Math.sin(performance.now() * 0.012)) * 0.035;
  } else {
    idleTime += dt;
    if (idleTime >= 0.75) stamina = Math.min(playerStats.maxStamina, stamina + playerStats.staminaRegenPerSecond * dt);
  }
  staminaFillEl.style.width = `${(stamina / playerStats.maxStamina) * 100}%`;
  staminaValueEl.textContent = String(Math.round(stamina));
  camera.target.set(player.position.x, player.position.y + 0.65, player.position.z);
}

const slotSaveKey = (slot: number): string => `farming-unlimited-save-v1-slot-${slot}`;
let SAVE_KEY = slotSaveKey(storedGameSettings.activeSlot);
const legacySave = localStorage.getItem("farming-unlimited-save-v1");
if (storedGameSettings.activeSlot === 1 && !localStorage.getItem(SAVE_KEY) && legacySave) {
  localStorage.setItem(SAVE_KEY, legacySave);
  localStorage.removeItem("farming-unlimited-save-v1");
}
saveSlotEl.addEventListener("change", () => {
  if (!menuActive) saveGame();
  storedGameSettings.activeSlot = Number(saveSlotEl.value);
  localStorage.setItem(GAME_SETTINGS_KEY, JSON.stringify(storedGameSettings));
  SAVE_KEY = slotSaveKey(storedGameSettings.activeSlot);
  window.location.reload();
});

saveNowEl.addEventListener("click", () => {
  if (menuActive) {
    hintEl.textContent = "Start or load a workshop before saving";
    return;
  }
  saveGame();
  hintEl.textContent = `Workshop ${storedGameSettings.activeSlot} saved`;
});

autosaveIntervalEl.addEventListener("change", () => {
  storedGameSettings.autosaveMinutes = Number(autosaveIntervalEl.value);
  localStorage.setItem(GAME_SETTINGS_KEY, JSON.stringify(storedGameSettings));
  hintEl.textContent = storedGameSettings.autosaveMinutes === 0
    ? "Background saves disabled"
    : `Background save set to every ${storedGameSettings.autosaveMinutes} minute${storedGameSettings.autosaveMinutes === 1 ? "" : "s"}`;
});

newGameEl.addEventListener("click", () => {
  if (!window.confirm(`Start a new game in Workshop ${storedGameSettings.activeSlot}? The current save in this slot will be erased.`)) return;
  localStorage.removeItem(SAVE_KEY);
  window.location.reload();
});

interface SaveDataV1 {
  version: 1;
  savedAt: number;
  meta?: { playTimeSeconds: number; stationCount: number; workerHired: boolean };
  economy: { coins: number; lifetimeRevenue: number; completedOrders: number; purchasedUpgrades: number; astralCores?: number };
  player: {
    position: [number, number, number];
    inventory: ItemId[];
    stamina: number;
    stats: typeof playerStats;
    questStage: number;
  };
  dryer?: { input: number; output: number; progress: number };
  dryers?: Array<{ instanceId?: number; position?: [number, number, number]; rotation?: number; level?: 1 | 2 | 3 | 4; recipeOutput?: ItemId; input: number; output: number; inputQueue?: ItemId[]; outputItems?: ItemId[]; progress: number }>;
  processors: Array<{
    instanceId?: number;
    stationId?: ProcessorStationId;
    output: ItemId;
    position?: [number, number, number];
    rotation?: number;
    level?: 1 | 2 | 3 | 4;
    input: number;
    outputAmount: number;
    inputQueue?: ItemId[];
    outputItems?: ItemId[];
    progress: number;
  }>;
  storage: { items: Partial<Record<ItemId, number>>; acceptedItems: ItemId[] };
  shelves?: Array<{
    instanceId?: number;
    position: [number, number, number];
    rotation?: number;
    size?: StorageShelf["size"];
    items: Partial<Record<ItemId, number>>;
    acceptedItems: ItemId[];
  }>;
  discardBins?: Array<{ instanceId?: number; position: [number, number, number]; rotation?: number }>;
  customerCounters?: Array<{ instanceId?: number; position: [number, number, number]; rotation?: number; arrivalTimer?: number; purchaseCost?: number }>;
  farming?: { unlockedCrops: BaseMaterialId[]; genetics: Partial<Record<BaseMaterialId, number>> };
  patches: Array<{
    stock: number;
    respawn: number;
    remainingYield?: number;
    unlocked?: boolean;
    cropId?: BaseMaterialId | null;
    planted?: boolean;
    autoReplant?: boolean;
  }>;
  customers: CustomerOrder[];
  nextOrderId: number;
  nextCustomerTimer?: number;
  worker: {
    hired: boolean;
    position: [number, number, number];
    items: ItemId[];
    capacity: number;
    speed: number;
    speedLevel: number;
    capacityLevel: number;
    production: boolean;
    stocking: boolean;
    sales: boolean;
    route: string;
    allowedFacilities?: string[];
    wagePerMinute?: number;
    unpaid?: boolean;
    stationMemory?: Record<string, number>;
    role?: Worker["role"];
    priorities?: Worker["priorities"];
  };
  workerSlotCount?: number;
  workers?: Array<{
    id: number;
    name: string;
    hired: boolean;
    position: [number, number, number];
    items: ItemId[];
    capacity: number;
    speed: number;
    speedLevel: number;
    capacityLevel: number;
    production: boolean;
    stocking: boolean;
    sales: boolean;
    route: string;
    allowedFacilities?: string[];
    positiveTrait?: string;
    negativeTrait?: string;
    suitability?: Worker["suitability"];
    wagePerMinute?: number;
    unpaid?: boolean;
    stationMemory?: Record<string, number>;
    role?: Worker["role"];
    priorities?: Worker["priorities"];
  }>;
  workerApplications?: Array<[number, WorkerApplication[]]>;
  applicationRefillTimers?: Array<[number, number]>;
  nextApplicationId?: number;
  payrollTimer?: number;
}

function refreshUpgradeLabels(): void {
  worker = selectedWorker();
  const carryCost = 60 + (playerStats.carryLevel - 1) * 45;
  const staminaCost = 50 + (playerStats.staminaLevel - 1) * 40;
  const regenCost = 45 + (playerStats.regenLevel - 1) * 35;
  const workerSpeedCost = 55 + (worker.speedLevel - 1) * 45;
  const workerCapacityCost = 70 + (worker.capacityLevel - 1) * 55;
  upgradePlayerCarryEl.textContent = `Capacity ${inventory.capacity} → ${inventory.capacity + 2} · ${carryCost} coins`;
  upgradePlayerStaminaEl.textContent = `Stamina ${playerStats.maxStamina} → ${playerStats.maxStamina + 25} · ${staminaCost} coins`;
  upgradePlayerRegenEl.textContent = `Regen Lv.${playerStats.regenLevel} → Lv.${playerStats.regenLevel + 1} · ${regenCost} coins`;
  upgradeWorkerSpeedEl.textContent = `Speed Lv.${worker.speedLevel} → Lv.${worker.speedLevel + 1} · ${workerSpeedCost} coins`;
  upgradeWorkerCapacityEl.textContent = `Capacity ${worker.capacity} → ${worker.capacity + 1} · ${workerCapacityCost} coins`;
}

function saveGame(): void {
  savingToastEl.classList.remove("saving-toast--hidden");
  window.clearTimeout(savingToastTimer);
  savingToastTimer = window.setTimeout(() => savingToastEl.classList.add("saving-toast--hidden"), 1600);
  const data: SaveDataV1 = {
    version: 1,
    savedAt: Date.now(),
    meta: { playTimeSeconds, stationCount: dryers.length + processors.length + shelves.length + discardBins.length + customerCounters.length, workerHired: workers.some((rosterWorker) => rosterWorker.hired) },
    economy: { coins, lifetimeRevenue, completedOrders, purchasedUpgrades, astralCores },
    player: {
      position: [player.position.x, player.position.y, player.position.z],
      inventory: [...inventory.items],
      stamina,
      stats: { ...playerStats },
      questStage,
    },
    dryers: dryers.map((dryer) => ({
      instanceId: dryer.instanceId,
      position: [dryer.position.x, dryer.position.y, dryer.position.z],
      rotation: dryer.rotation,
      level: dryer.level,
      recipeOutput: dryer.activeRecipe.output,
      input: dryer.input,
      output: dryer.output,
      inputQueue: [...dryer.inputQueue],
      outputItems: [...dryer.outputItems],
      progress: dryer.progress,
    })),
    processors: processors.map((processor) => ({
      instanceId: processor.instanceId,
      stationId: processor.stationId,
      output: processor.output,
      position: [processor.position.x, processor.position.y, processor.position.z],
      rotation: processor.rotation,
      level: processor.level,
      input: processor.input,
      outputAmount: processor.outputAmount,
      inputQueue: [...processor.inputQueue],
      outputItems: [...processor.outputItems],
      progress: processor.progress,
    })),
    storage: { items: { ...storage.items }, acceptedItems: [...storage.acceptedItems] },
    shelves: shelves.map((shelf) => ({
      instanceId: shelf.instanceId,
      position: [shelf.position.x, shelf.position.y, shelf.position.z],
      rotation: shelf.rotation,
      size: shelf.size,
      items: { ...shelf.items },
      acceptedItems: [...shelf.acceptedItems],
    })),
    discardBins: discardBins.map((bin) => ({
      instanceId: bin.instanceId,
      position: [bin.position.x, bin.position.y, bin.position.z],
      rotation: bin.rotation,
    })),
    customerCounters: customerCounters.map((counter) => ({
      instanceId: counter.instanceId,
      position: [counter.position.x, counter.position.y, counter.position.z],
      rotation: counter.rotation,
      arrivalTimer: counter.arrivalTimer,
      purchaseCost: counter.purchaseCost,
    })),
    farming: { unlockedCrops: [...unlockedCrops], genetics: { ...cropGenetics } },
    patches: patches.map((patch) => ({
      stock: patch.stock,
      respawn: patch.respawn,
      remainingYield: patch.remainingYield,
      unlocked: patch.unlocked,
      cropId: patch.cropId,
      planted: patch.planted,
      autoReplant: patch.autoReplant,
    })),
    customers: customerOrders.map((order) => ({ ...order })),
    nextOrderId,
    worker: {
      hired: worker.hired,
      position: [worker.root.position.x, worker.root.position.y, worker.root.position.z],
      items: [...worker.items],
      capacity: worker.capacity,
      speed: worker.speed,
      speedLevel: worker.speedLevel,
      capacityLevel: worker.capacityLevel,
      production: workerProductionEl.checked,
      stocking: workerStockingEl.checked,
      sales: workerSalesEl.checked,
      route: workerRouteEl.value,
    },
    workerSlotCount,
    workers: workers.map((rosterWorker) => ({
      id: rosterWorker.id,
      name: rosterWorker.name,
      hired: rosterWorker.hired,
      position: [rosterWorker.root.position.x, rosterWorker.root.position.y, rosterWorker.root.position.z],
      items: [...rosterWorker.items],
      capacity: rosterWorker.capacity,
      speed: rosterWorker.speed,
      speedLevel: rosterWorker.speedLevel,
      capacityLevel: rosterWorker.capacityLevel,
      production: rosterWorker.production,
      stocking: rosterWorker.stocking,
      sales: rosterWorker.sales,
      route: rosterWorker.route,
      allowedFacilities: [...rosterWorker.allowedFacilities],
      positiveTrait: rosterWorker.positiveTrait,
      negativeTrait: rosterWorker.negativeTrait,
      suitability: { ...rosterWorker.suitability },
      wagePerMinute: rosterWorker.wagePerMinute,
      unpaid: rosterWorker.unpaid,
      stationMemory: { ...rosterWorker.stationMemory },
      role: rosterWorker.role,
      priorities: { ...rosterWorker.priorities },
    })),
    workerApplications: [...workerApplications.entries()].map(([slot, applications]) => [slot, applications.map((application) => ({ ...application, suitability: { ...application.suitability } }))]),
    applicationRefillTimers: [...applicationRefillTimers.entries()],
    nextApplicationId,
    payrollTimer,
  };
  if (!writeSave(SAVE_KEY, data)) {
    hintEl.textContent = "The browser could not save the workshop";
  }
}

function loadGame(): boolean {
  try {
    const data = readSave<SaveDataV1>(SAVE_KEY, 1);
    if (!data) return false;

    coins = data.economy.coins;
    lifetimeRevenue = data.economy.lifetimeRevenue;
    completedOrders = data.economy.completedOrders;
    purchasedUpgrades = data.economy.purchasedUpgrades;
    astralCores = data.economy.astralCores ?? 0;
    updateAstralCoreHud();
    playTimeSeconds = data.meta?.playTimeSeconds ?? 0;
    Object.assign(playerStats, data.player.stats);
    inventory.capacity = playerStats.carryCapacity;
    inventory.items = [...data.player.inventory];
    stamina = Math.min(data.player.stamina, playerStats.maxStamina);
    questStage = data.player.questStage;
    player.position.set(...data.player.position);

    const savedDryers = data.dryers ?? (data.dryer ? [{ ...data.dryer, instanceId: 1, position: [2.7, 0.33, -2.8] as [number, number, number] }] : []);
    const loadedDryerIds = new Set<number>();
    for (const savedDryer of savedDryers) {
      let dryer = savedDryer.instanceId === undefined
        ? dryers[0]
        : dryers.find((candidate) => candidate.instanceId === savedDryer.instanceId);
      if (!dryer && savedDryer.position) {
        dryer = createDryer(new Vector3(...savedDryer.position));
        if (savedDryer.instanceId !== undefined) dryer.instanceId = savedDryer.instanceId;
        dryer.ring.isVisible = false;
        dryers.push(dryer);
        stationStatuses.push(createStationStatus(
          dryer.root.name,
          dryer.position.add(new Vector3(0, 2.45, 0)),
          () => dryer!.input,
          () => dryer!.output,
          dryer.capacity,
          () => dryer!.input > 0 ? dryer!.progress / dryer!.duration : 0,
          () => dryer!.output >= dryer!.capacity && dryer!.input > 0,
        ));
      }
      if (dryer) {
        const savedRecipe = savedDryer.recipeOutput
          ? catalogRecipes.find((recipe) => recipe.station === "drying_rack" && recipe.output === savedDryer.recipeOutput)
          : undefined;
        if (savedRecipe) configureDryerRecipe(dryer, savedRecipe);
        const previousPosition = dryer.position.clone();
        const targetPosition = savedDryer.position ? new Vector3(...savedDryer.position) : dryer.position.clone();
        const targetRotation = savedDryer.rotation ?? 0;
        [...dryer.staticMeshes, dryer.ring].forEach((mesh) => moveMeshAround(mesh, dryer.position, targetPosition, targetRotation - dryer.rotation));
        dryer.position.copyFrom(targetPosition);
        dryer.rotation = targetRotation;
        applyStationLevel({ kind: "dryer", building: dryer }, savedDryer.level ?? 1);
        const dryerStatus = stationStatuses.find((status) => Vector3.DistanceSquared(status.position, previousPosition.add(new Vector3(0, 2.45, 0))) < 0.1);
        if (dryerStatus) {
          dryerStatus.position.copyFrom(targetPosition.add(new Vector3(0, 2.45, 0)));
          dryerStatus.capacity = dryer.capacity;
        }
        dryer.staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "drying_rack", buildingId: dryer!.instanceId }; });
        dryer.inputQueue = savedDryer.inputQueue?.filter((item) => Boolean(dryerRecipeForInput(item)))
          ?? Array.from({ length: savedDryer.input }, () => dryer!.activeRecipe.input as ItemId);
        dryer.outputItems = savedDryer.outputItems?.filter((item) => catalogById.has(item))
          ?? Array.from({ length: savedDryer.output }, () => dryer!.activeRecipe.output as ItemId);
        dryer.progress = savedDryer.progress;
        refreshDryerInput(dryer);
        refreshDryerOutput(dryer);
        loadedDryerIds.add(dryer.instanceId);
      }
    }
    for (let index = dryers.length - 1; index >= 0; index--) {
      const dryer = dryers[index]!;
      if (loadedDryerIds.has(dryer.instanceId)) continue;
      allBuildingMeshes({ kind: "dryer", building: dryer }).forEach((mesh) => mesh.dispose());
      dryer.root.dispose();
      const statusIndex = stationStatuses.findIndex((status) => Vector3.DistanceSquared(status.position, dryer.position.add(new Vector3(0, 2.45, 0))) < 0.1);
      if (statusIndex >= 0) stationStatuses.splice(statusIndex, 1)[0]?.element.remove();
      dryers.splice(index, 1);
    }
    nextDryerInstanceId = Math.max(nextDryerInstanceId, ...dryers.map((candidate) => candidate.instanceId + 1));
    const loadedProcessorIds = new Set<number>();
    for (const savedProcessor of data.processors) {
      const savedStationId = savedProcessor.stationId
        ?? catalogRecipes.find((recipe) => recipe.output === savedProcessor.output && recipe.station !== "drying_rack")?.station as ProcessorStationId | undefined;
      if (!savedStationId) continue;
      let processor = savedProcessor.instanceId === undefined
        ? processors.find((candidate) => candidate.stationId === savedStationId && !loadedProcessorIds.has(candidate.instanceId))
        : processors.find((candidate) => candidate.instanceId === savedProcessor.instanceId);
      if (!processor && savedProcessor.position) {
        processor = createProcessor(savedStationId, new Vector3(...savedProcessor.position), savedProcessor.output);
        if (savedProcessor.instanceId !== undefined) processor.instanceId = savedProcessor.instanceId;
        processors.push(processor);
        stationStatuses.push(createStationStatus(
          processor.name,
          processor.position.add(new Vector3(0, 2.45, 0)),
          () => processor!.input,
          () => processor!.outputAmount,
          processor.capacity,
          () => processor!.input > 0 ? processor!.progress / processor!.duration : 0,
          () => processor!.outputAmount >= processor!.capacity && processor!.input > 0,
        ));
      }
      if (processor) {
        const savedRecipe = catalogRecipes.find((recipe) => recipe.station === savedStationId && recipe.output === savedProcessor.output);
        if (savedRecipe) configureProcessorRecipe(processor, savedRecipe);
        const previousPosition = processor.position.clone();
        const targetPosition = savedProcessor.position ? new Vector3(...savedProcessor.position) : processor.position.clone();
        const targetRotation = savedProcessor.rotation ?? 0;
        [...processor.staticMeshes, processor.ring].forEach((mesh) => moveMeshAround(mesh, processor.position, targetPosition, targetRotation - processor.rotation));
        processor.position.copyFrom(targetPosition);
        processor.rotation = targetRotation;
        applyStationLevel({ kind: "processor", building: processor }, savedProcessor.level ?? 1);
        const processorStatus = stationStatuses.find((status) => Vector3.DistanceSquared(status.position, previousPosition.add(new Vector3(0, 2.45, 0))) < 0.1);
        if (processorStatus) {
          processorStatus.position.copyFrom(targetPosition.add(new Vector3(0, 2.45, 0)));
          processorStatus.capacity = processor.capacity;
        }
        processor.staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: processor!.stationId, buildingId: processor!.instanceId }; });
        processor.inputQueue = savedProcessor.inputQueue?.filter((item) => Boolean(processorRecipeForInput(processor!, item)))
          ?? Array.from({ length: savedProcessor.input }, () => processor!.activeRecipe.input as ItemId);
        processor.outputItems = savedProcessor.outputItems?.filter((item) => catalogById.has(item))
          ?? Array.from({ length: savedProcessor.outputAmount }, () => processor!.output);
        processor.progress = savedProcessor.progress;
        refreshProcessorInput(processor);
        refreshProcessorOutput(processor);
        loadedProcessorIds.add(processor.instanceId);
      }
    }
    for (let index = processors.length - 1; index >= 0; index--) {
      const processor = processors[index]!;
      if (loadedProcessorIds.has(processor.instanceId)) continue;
      allBuildingMeshes({ kind: "processor", building: processor }).forEach((mesh) => mesh.dispose());
      const statusIndex = stationStatuses.findIndex((status) => Vector3.DistanceSquared(status.position, processor.position.add(new Vector3(0, 2.45, 0))) < 0.1);
      if (statusIndex >= 0) stationStatuses.splice(statusIndex, 1)[0]?.element.remove();
      processors.splice(index, 1);
    }
    nextProcessorInstanceId = Math.max(nextProcessorInstanceId, ...processors.map((processor) => processor.instanceId + 1));
    if (data.shelves) {
      for (const shelf of shelves) allBuildingMeshes({ kind: "shelf", building: shelf }).forEach((mesh) => mesh.dispose());
      shelves.splice(0, shelves.length);
      for (const savedShelf of data.shelves) {
        const shelf = createStorageShelf(new Vector3(...savedShelf.position), savedShelf.size ?? "small");
        if (savedShelf.instanceId !== undefined) shelf.instanceId = savedShelf.instanceId;
        shelf.staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "storage_shelf", buildingId: shelf.instanceId }; });
        const rotation = savedShelf.rotation ?? 0;
        [...shelf.staticMeshes, shelf.ring].forEach((mesh) => moveMeshAround(mesh, shelf.position, shelf.position, rotation));
        shelf.rotation = rotation;
        shelf.items = { ...savedShelf.items };
        shelf.acceptedItems = new Set(savedShelf.acceptedItems);
        migrateLegacyShelfFilters(shelf);
        shelves.push(shelf);
      }
      storage = shelves[0] ?? createStorageShelf();
      if (shelves.length === 0) shelves.push(storage);
      nextShelfInstanceId = Math.max(nextShelfInstanceId, ...shelves.map((shelf) => shelf.instanceId + 1));
    } else {
      storage = shelves[0]!;
      storage.items = { ...data.storage.items };
      storage.acceptedItems = new Set(data.storage.acceptedItems);
      migrateLegacyShelfFilters(storage);
    }
    if (data.discardBins) {
      for (const bin of discardBins) allBuildingMeshes({ kind: "discard_bin", building: bin }).forEach((mesh) => mesh.dispose());
      discardBins.splice(0, discardBins.length);
      for (const savedBin of data.discardBins) {
        const bin = createDiscardBin(new Vector3(...savedBin.position));
        if (savedBin.instanceId !== undefined) bin.instanceId = savedBin.instanceId;
        bin.staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "discard_bin", buildingId: bin.instanceId }; });
        const rotation = savedBin.rotation ?? 0;
        [...bin.staticMeshes, bin.ring].forEach((mesh) => moveMeshAround(mesh, bin.position, bin.position, rotation));
        bin.rotation = rotation;
        discardBins.push(bin);
      }
      if (discardBins.length === 0) discardBins.push(createDiscardBin());
      nextDiscardBinInstanceId = Math.max(nextDiscardBinInstanceId, ...discardBins.map((bin) => bin.instanceId + 1));
    }
    if (data.customerCounters) {
      for (const counter of customerCounters) {
        allBuildingMeshes({ kind: "customer_counter", building: counter }).forEach((mesh) => mesh.dispose());
        counter.customers.forEach((customer) => customer.dispose());
      }
      customerCounters.splice(0, customerCounters.length);
      for (const savedCounter of data.customerCounters) {
        const counter = createCustomerCounter(new Vector3(...savedCounter.position), savedCounter.purchaseCost ?? 600);
        if (savedCounter.instanceId !== undefined) counter.instanceId = savedCounter.instanceId;
        counter.staticMeshes.forEach((mesh) => { mesh.metadata = { buildingKind: "customer_counter", buildingId: counter.instanceId }; });
        const rotation = savedCounter.rotation ?? 0;
        [...counter.staticMeshes, counter.ring].forEach((mesh) => moveMeshAround(mesh, counter.position, counter.position, rotation));
        counter.customers.forEach((customer) => moveNodeAround(customer, counter.position, counter.position, rotation));
        counter.rotation = rotation;
        counter.arrivalTimer = Math.max(0, savedCounter.arrivalTimer ?? 1.5 + Math.random() * 3.5);
        counter.ring.isVisible = false;
        customerCounters.push(counter);
      }
      if (customerCounters.length === 0) customerCounters.push(createCustomerCounter());
      nextCustomerCounterInstanceId = Math.max(nextCustomerCounterInstanceId, ...customerCounters.map((counter) => counter.instanceId + 1));
      refreshDynamicBuildCosts();
    }
    renderShelfFilterItems();
    unlockedCrops.clear();
    for (const cropId of data.farming?.unlockedCrops ?? ["sunleaf"]) {
      if (cropById.has(cropId)) unlockedCrops.add(cropId);
    }
    unlockedCrops.add("sunleaf");
    for (const crop of cropDefinitions) cropGenetics[crop.id] = Math.max(1, Math.min(5, data.farming?.genetics[crop.id] ?? 1));
    data.patches.forEach((savedPatch, index) => {
      const patch = patches[index];
      if (!patch) return;
      patch.unlocked = savedPatch.unlocked ?? index === 0;
      patch.cropId = savedPatch.cropId ?? (patch.unlocked ? "sunleaf" : null);
      patch.planted = savedPatch.planted ?? Boolean(patch.cropId);
      patch.autoReplant = savedPatch.autoReplant ?? false;
      patch.stock = patch.unlocked ? savedPatch.stock : 0;
      patch.respawn = patch.unlocked ? savedPatch.respawn : 0;
      const capacity = farmPlotCapacity(patch);
      const crop = patch.cropId ? cropById.get(patch.cropId) : null;
      patch.remainingYield = patch.unlocked
        ? savedPatch.remainingYield ?? (patch.planted && crop
          ? patch.stock === 0 ? capacity : crop.renewable ? Math.max(0, capacity - patch.stock) : 0
          : 0)
        : 0;
      if (patch.planted && patch.remainingYield > 0 && patch.stock < capacity && patch.respawn <= 0) {
        patch.respawn = farmUnitGrowthSeconds(patch);
      }
      rebuildFarmPlotCrop(patch);
      refreshFarmPlotVisual(patch);
    });
    renderFarmPanel();

    customerOrders.splice(0, customerOrders.length, ...data.customers.map((order) => ({
      ...order,
      counterId: order.counterId ?? customerCounters[0]!.instanceId,
      accepted: true,
      acceptedAt: order.acceptedAt ?? performance.now(),
    })));
    nextOrderId = data.nextOrderId;
    if (data.nextCustomerTimer !== undefined && !data.customerCounters) {
      customerCounters[0]!.arrivalTimer = Math.max(0, data.nextCustomerTimer);
    }
    customerCounters.forEach((counter) => counter.customers.forEach((customer) => customer.setEnabled(false)));
    for (const order of customerOrders) customerForOrder(order)?.setEnabled(true);
    refreshCustomerCounterRings();

    const savedWorkers = data.workers ?? [{ id: 1, name: "Mira the Apprentice", ...data.worker }];
    while (workers.length > savedWorkers.length) workers.pop()?.root.dispose();
    while (workers.length < savedWorkers.length) {
      const saved = savedWorkers[workers.length]!;
      workers.push(createWorker(saved.id, saved.name));
    }
    workerSlotCount = Math.max(data.workerSlotCount ?? savedWorkers.length, savedWorkers.length);
    for (let index = 0; index < savedWorkers.length; index++) {
      const saved = savedWorkers[index]!;
      const rosterWorker = workers[index]!;
      rosterWorker.id = saved.id;
      rosterWorker.name = saved.name;
      rosterWorker.hired = saved.hired;
      rosterWorker.root.position.set(...saved.position);
      rosterWorker.items = [...saved.items];
      rosterWorker.speedLevel = Math.max(1, Math.min(WORKER_MAX_SPEED_LEVEL, saved.speedLevel));
      rosterWorker.capacityLevel = Math.max(1, saved.capacityLevel);
      // Recalculate derived worker stats so older high-throughput saves adopt
      // the current balance instead of preserving obsolete raw values.
      rosterWorker.capacity = workerCapacityForLevel(rosterWorker.capacityLevel);
      rosterWorker.speed = workerSpeedForLevel(rosterWorker.speedLevel);
      rosterWorker.production = saved.production;
      rosterWorker.stocking = saved.stocking;
      rosterWorker.sales = saved.sales;
      rosterWorker.route = saved.route;
      rosterWorker.allowedFacilities = normalizeWorkerFacilities(saved.allowedFacilities, saved.route);
      if (!data.farming && !rosterWorker.allowedFacilities.includes("farm")) rosterWorker.allowedFacilities.push("farm");
      rosterWorker.positiveTrait = saved.positiveTrait ?? rosterWorker.positiveTrait;
      rosterWorker.negativeTrait = saved.negativeTrait ?? rosterWorker.negativeTrait;
      rosterWorker.suitability = saved.suitability ?? rosterWorker.suitability;
      rosterWorker.wagePerMinute = saved.wagePerMinute ?? (7 + rosterWorker.id * 2);
      rosterWorker.unpaid = saved.unpaid ?? false;
      rosterWorker.stationMemory = saved.stationMemory ?? {};
      rosterWorker.role = saved.role ?? "generalist";
      rosterWorker.priorities = saved.priorities ?? { production: 2, stocking: 2, sales: 2, farming: 2 };
      rosterWorker.task = "idle";
      rosterWorker.target = null;
      rosterWorker.orderId = null;
      rosterWorker.root.setEnabled(rosterWorker.hired);
    }
    selectedWorkerId = workers[0]!.id;
    worker = selectedWorker();
    workerApplications.clear();
    for (const [slot, applications] of data.workerApplications ?? []) workerApplications.set(slot, applications.map((application) => ({ ...application, wagePerMinute: application.wagePerMinute ?? (7 + slot * 2), suitability: { ...application.suitability } })));
    applicationRefillTimers.clear();
    for (const [slot, remaining] of data.applicationRefillTimers ?? []) applicationRefillTimers.set(slot, remaining);
    nextApplicationId = Math.max(data.nextApplicationId ?? 1, ...[...workerApplications.values()].flat().map((application) => application.id + 1), 1);
    payrollTimer = Math.max(1, data.payrollTimer ?? 60);
    syncWorkerControls();

    coinsEl.textContent = String(coins);
    dryers.forEach((dryer) => {
      refreshDryerInput(dryer);
      refreshDryerOutput(dryer);
    });
    processors.forEach((processor) => {
      refreshProcessorInput(processor);
      refreshProcessorOutput(processor);
    });
    refreshStorage();
    rebuildCarryStack();
    for (const rosterWorker of workers) {
      worker = rosterWorker;
      rebuildWorkerCarry();
    }
    worker = selectedWorker();
    updateOrderCards();
    refreshUpgradeLabels();
    updateHud();
    recordBalanceSnapshot("game_loaded");
    balanceSnapshotTimer = BALANCE_SNAPSHOT_INTERVAL;
    hintEl.textContent = "Workshop restored from your last visit";
    return true;
  } catch {
    return false;
  }
}

function formatPlayTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function slotSnapshot(slot: number): SaveDataV1 | null {
  try {
    const raw = localStorage.getItem(slotSaveKey(slot));
    return raw ? JSON.parse(raw) as SaveDataV1 : null;
  } catch { return null; }
}

function showMenuRoot(): void {
  refreshMainMenuAvailability();
  mainMenuRootEl.classList.remove("main-menu__hidden");
  newGameSlotsEl.classList.add("main-menu__hidden");
  loadGameSlotsEl.classList.add("main-menu__hidden");
}

function hasSavedSlots(): boolean {
  return [1, 2, 3].some((slot) => slotSnapshot(slot) !== null);
}

function refreshMainMenuAvailability(): void {
  const loadButton = mainMenuRootEl.querySelector<HTMLButtonElement>('button[data-menu-action="load"]');
  if (loadButton) loadButton.hidden = !hasSavedSlots();
}

function renderSlotChoices(container: HTMLElement, mode: "new" | "load"): void {
  container.replaceChildren();
  for (let slot = 1; slot <= 3; slot++) {
    const snapshot = slotSnapshot(slot);
    const row = document.createElement("div");
    row.className = "slot-row";
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = mode === "load" && !snapshot;
    const title = document.createElement("span");
    title.textContent = `Workshop ${slot}`;
    const details = document.createElement("small");
    if (!snapshot) details.textContent = "Empty slot";
    else {
      const played = formatPlayTime(snapshot.meta?.playTimeSeconds ?? 0);
      const stations = snapshot.meta?.stationCount ?? ((snapshot.dryers?.length ?? (snapshot.dryer ? 1 : 0)) + snapshot.processors.length);
      const workerSummary = snapshot.meta?.workerHired ?? snapshot.worker.hired ? "Mira hired" : "No worker";
      const coreSummary = snapshot.economy.astralCores ? ` · ${snapshot.economy.astralCores} Astral Core${snapshot.economy.astralCores === 1 ? "" : "s"}` : "";
      details.textContent = `${played} played · ${snapshot.economy.coins} coins${coreSummary} · ${snapshot.economy.completedOrders} orders · ${stations} stations · ${workerSummary} · Saved ${new Date(snapshot.savedAt).toLocaleString()}`;
    }
    button.append(title, details);
    button.addEventListener("click", () => {
      if (mode === "new" && snapshot && !window.confirm(`Overwrite Workshop ${slot} with a new game?`)) return;
      storedGameSettings.activeSlot = slot;
      localStorage.setItem(GAME_SETTINGS_KEY, JSON.stringify(storedGameSettings));
      SAVE_KEY = slotSaveKey(slot);
      saveSlotEl.value = String(slot);
      if (mode === "new") localStorage.removeItem(SAVE_KEY);
      else if (!loadGame()) return;
      menuActive = false;
      recordBalanceEvent("game_started", { mode, saveSlot: slot });
      if (mode === "new") recordBalanceSnapshot("new_game");
      mainMenuEl.classList.add("main-menu--hidden");
      hintEl.textContent = mode === "new" ? `New Workshop ${slot} started` : `Workshop ${slot} loaded`;
    });
    row.append(button);
    if (snapshot) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "slot-delete";
      deleteButton.textContent = "🗑";
      deleteButton.title = `Delete Workshop ${slot}`;
      deleteButton.setAttribute("aria-label", `Delete Workshop ${slot}`);
      deleteButton.addEventListener("click", () => {
        if (!window.confirm(`Delete Workshop ${slot}? This saved game cannot be recovered.`)) return;
        localStorage.removeItem(slotSaveKey(slot));
        if (slot === 1) localStorage.removeItem("farming-unlimited-save-v1");
        if (mode === "load" && !hasSavedSlots()) showMenuRoot();
        else renderSlotChoices(container, mode);
        refreshMainMenuAvailability();
      });
      row.append(deleteButton);
    }
    container.append(row);
  }
  const back = document.createElement("button");
  back.type = "button";
  back.className = "menu-back";
  back.textContent = "Back";
  back.addEventListener("click", showMenuRoot);
  container.append(back);
}

mainMenuRootEl.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-menu-action]")?.dataset.menuAction;
  if (action === "new" || action === "load") {
    mainMenuRootEl.classList.add("main-menu__hidden");
    const container = action === "new" ? newGameSlotsEl : loadGameSlotsEl;
    renderSlotChoices(container, action);
    container.classList.remove("main-menu__hidden");
  } else if (action === "settings") {
    openManagementPage("settings-panel");
  } else if (action === "exit") {
    window.close();
    const message = mainMenuEl.querySelector<HTMLParagraphElement>("p");
    if (message) message.textContent = "Your browser may require you to close this tab manually.";
  }
});

let autosaveTimer = 0;
refreshMainMenuAvailability();
syncWorkerControls();
renderFarmPanel();
updateHud();
engine.runRenderLoop(() => {
  const realDt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  const dt = realDt * timeScale;
  if (cameraRotationElapsed < cameraRotationDuration) {
    cameraRotationElapsed = Math.min(cameraRotationDuration, cameraRotationElapsed + realDt);
    const progress = cameraRotationElapsed / cameraRotationDuration;
    const eased = progress * progress * (3 - 2 * progress);
    camera.alpha = cameraRotationStartAlpha + (cameraTargetAlpha - cameraRotationStartAlpha) * eased;
  } else {
    camera.alpha = cameraTargetAlpha;
  }
  const zoomDifference = cameraTargetRadius - camera.radius;
  if (Math.abs(zoomDifference) < 0.005) camera.radius = cameraTargetRadius;
  else camera.radius += zoomDifference * Math.min(1, realDt * 14);
  if (!menuActive && timeScale > 0) {
    playTimeSeconds += realDt;
    updatePlayer(dt);
    updateInteractions(dt);
    for (const rosterWorker of workers) updateWorker(rosterWorker, dt);
    updateWorkerApplications(dt);
    updatePayroll(dt);
    updateBalanceDiagnostics(dt);
  }
  updateStationStatuses();
  updateBuildingActions();
  if (!menuActive) autosaveTimer += realDt;
  if (!menuActive && storedGameSettings.autosaveMinutes > 0 && autosaveTimer >= storedGameSettings.autosaveMinutes * 60) {
    autosaveTimer = 0;
    saveGame();
  }
  scene.render();
});

window.addEventListener("resize", () => engine.resize());
window.addEventListener("beforeunload", () => { if (!menuActive) saveGame(); });
