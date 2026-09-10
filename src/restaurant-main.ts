import "./restaurant-style.css";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { catalog as foodModelsCatalog, ensureModels, catalogIndex } from "./assets/catalog/index";
import { decorLayout } from "./assets/scene/index";
import { createDecorScene } from "./game/decor";
import { createDecorateMode } from "./decorate";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./game/voxelModel";
import { attachGlow, createLightPool } from "./game/lighting";
import { sourceCacheKey, warmSourceCache } from "./game/sourceCache";
import { createVoxelMesh } from "./game/voxelGeometry";
import { restaurantRecipes, tomatoPlotUpgradeTiers, tutorialSteps } from "./game/restaurant";
import {
  addTicket, averageWaitSeconds, bankDayEarnings, chooseMenuSlot, closeDay, createShift, endDinner,
  expirePlatedFood, maxPlannedServings, migrateShiftSave, buildShiftSave, nextDay, openForDinner,
  serveTicket, setPlannedServings, startDinner, stockShelf, takeServing,
  tickShift, waitingTickets, type ShiftSaveV1, type TicketRecord,
} from "./game/shift";
import { readSave, writeSave } from "./game/persistence";
import { TelemetryLog } from "./game/telemetry";
import { createTomatoFoliageSource, createTomatoPlantRig, type TomatoFruitRig, type TomatoPlantRig } from "./game/tomatoPlant";
import { animateWheatPlant, createWheatPlant, createWheatSourcesFromScan, type WheatPlantState } from "./game/wheatPlant";
import { animateCabbageRig, createCabbageRig, type CabbageRig } from "./game/cabbage";
import { worldPalette } from "./game/visual";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <canvas id="game" aria-label="Farm to Table first shift"></canvas>
  <section class="slice-hud">
    <div class="slice-brand"><span class="slice-brand__leaf">◆</span><strong>FARM TO TABLE</strong></div>
    <a class="slice-lab-link" href="/model-lab.html">MODEL LAB</a>
    <div class="slice-wallet"><b id="slice-day">DAY 1</b><b id="slice-coins">✦ 24</b><b>◆ 0</b></div>
    <div class="slice-phase" id="slice-phase"><i class="slice-phase__lamp" id="slice-phase-lamp"></i><span id="slice-phase-name">PREP</span><b id="slice-phase-clock">4:00</b></div>
    <div class="slice-objective" id="slice-objective" aria-label="First shift progress"></div>
    <div class="slice-action" id="slice-action">↯</div>
    <div class="slice-carry" id="slice-carry"></div>
    <div class="slice-help"><kbd>WASD</kbd><kbd>SPACE</kbd><kbd>Q / E ↻</kbd><kbd>SCROLL ±</kbd></div>
    <div class="slice-renderwarn" id="slice-renderwarn" hidden>⚠ 3D not rendering — WebGL context issue. Try a hard refresh (Cmd+Shift+R) or check chrome://gpu</div>
  </section>
  <section class="slice-results" id="slice-results" hidden aria-label="Shift results">
    <div class="slice-results__card">
      <div class="slice-results__title" id="slice-results-title"></div>
      <div class="slice-results__row" id="slice-results-served"></div>
      <div class="slice-results__missed" id="slice-results-missed"></div>
      <div class="slice-results__waste" id="slice-results-waste"></div>
      <div class="slice-results__wait" id="slice-results-wait"></div>
      <div class="slice-results__coins" id="slice-results-coins"></div>
      <button class="slice-results__next" id="slice-next-day" type="button">NEXT DAY ▸</button>
    </div>
  </section>`;

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const actionEl = document.querySelector<HTMLElement>("#slice-action")!;
const carryEl = document.querySelector<HTMLElement>("#slice-carry")!;
const objectiveEl = document.querySelector<HTMLElement>("#slice-objective")!;
const dayEl = document.querySelector<HTMLElement>("#slice-day")!;
const phaseLampEl = document.querySelector<HTMLElement>("#slice-phase-lamp")!;
const phaseNameEl = document.querySelector<HTMLElement>("#slice-phase-name")!;
const phaseClockEl = document.querySelector<HTMLElement>("#slice-phase-clock")!;
const resultsEl = document.querySelector<HTMLElement>("#slice-results")!;
const resultsTitleEl = document.querySelector<HTMLElement>("#slice-results-title")!;
const resultsServedEl = document.querySelector<HTMLElement>("#slice-results-served")!;
const resultsMissedEl = document.querySelector<HTMLElement>("#slice-results-missed")!;
const resultsWasteEl = document.querySelector<HTMLElement>("#slice-results-waste")!;
const resultsWaitEl = document.querySelector<HTMLElement>("#slice-results-wait")!;
const coinsEl = document.querySelector<HTMLElement>("#slice-coins")!;
const resultsCoinsEl = document.querySelector<HTMLElement>("#slice-results-coins")!;
document.querySelector<HTMLElement>("#slice-next-day")!.addEventListener("click", startNextDay);
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString("#a9c889ff");
scene.ambientColor = new Color3(0.24, 0.27, 0.23);

const materials = new Map<string, StandardMaterial>();
function mat(name: string, hex: string, emissive = false): StandardMaterial {
  const key = `${hex}:${emissive}`;
  const existing = materials.get(key);
  if (existing) return existing;
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = Color3.FromHexString(hex);
  material.specularColor = emissive ? new Color3(0.05, 0.05, 0.05) : new Color3(0.16, 0.16, 0.16);
  if (emissive) material.emissiveColor = Color3.FromHexString(hex).scale(0.5);
  materials.set(key, material);
  return material;
}

const shadowLight = new DirectionalLight("window light", new Vector3(-0.7, -1, 0.55), scene);
shadowLight.position.set(10, 18, -12);
shadowLight.intensity = 1.8;
const shadows = new ShadowGenerator(1024, shadowLight);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = 14;
const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
ambient.intensity = 1.05;
ambient.diffuse = Color3.FromHexString("#fff2d2");
ambient.groundColor = Color3.FromHexString("#65755c");

function block(name: string, size: Vector3, position: Vector3, material: StandardMaterial, parent?: TransformNode): Mesh {
  const mesh = MeshBuilder.CreateBox(name, { width: size.x, height: size.y, depth: size.z }, scene);
  mesh.position.copyFrom(position);
  mesh.material = material;
  mesh.parent = parent ?? null;
  mesh.receiveShadows = true;
  shadows.addShadowCaster(mesh);
  // Static scenery: decorate mode may drop props onto it (people are excluded there).
  mesh.metadata = { ...((mesh.metadata as Record<string, unknown> | null) ?? {}), surface: true };
  return mesh;
}

const palette = {
  steelLight: mat("steel light", worldPalette.steelLight),
  steelMid: mat("steel mid", worldPalette.steelMid),
  steelShadow: mat("steel shadow", worldPalette.steelShadow),
  tile: mat("cream tile", worldPalette.creamTile),
  walnut: mat("walnut", worldPalette.walnut),
  charcoal: mat("charcoal", worldPalette.charcoal),
  green: mat("garden green", worldPalette.mutedGreen),
  soil: mat("soil", "#76513a"),
  tomato: mat("tomato", worldPalette.tomato),
  soup: mat("tomato soup", "#c94334"),
  cream: mat("ticket", "#fff3d7"),
  skin: mat("skin", "#d99c6b"),
  white: mat("apron", "#f3ead6"),
  uniform: mat("uniform", "#4e7968"),
  hair: mat("hair", "#4b3229"),
  amber: mat("working light", worldPalette.warning, true),
  ready: mat("ready light", worldPalette.ready, true),
  blocked: mat("blocked light", worldPalette.blocked, true),
  interaction: mat("interaction", worldPalette.interaction, true),
  grime: mat("grime", worldPalette.grime),
  floor: mat("dining floor", "#d7bd91"),
};

const ground = MeshBuilder.CreateGround("grounds", { width: 20, height: 22 }, scene);
ground.material = mat("grass", "#7ea563");
ground.receiveShadows = true;

block("kitchen floor", new Vector3(12, 0.22, 8), new Vector3(0, 0.11, 0), palette.tile);
block("dining floor", new Vector3(12, 0.2, 5), new Vector3(0, 0.1, 6.5), palette.floor);
block("farm soil", new Vector3(12, 0.18, 4), new Vector3(0, 0.09, -6.4), palette.soil);
for (let x = -5.5; x <= 5.5; x += 1) {
  block("tile seam", new Vector3(0.025, 0.006, 8), new Vector3(x, 0.225, 0), palette.steelMid);
}
for (let z = -3.5; z <= 3.5; z += 1) {
  block("tile seam", new Vector3(12, 0.006, 0.025), new Vector3(0, 0.225, z), palette.steelMid);
}

// Rear professional hot line and extraction hood.
block("rear steel run", new Vector3(10.5, 1.05, 0.85), new Vector3(0, 0.64, -3.3), palette.steelMid);
block("rear steel top", new Vector3(10.7, 0.12, 1.0), new Vector3(0, 1.18, -3.3), palette.steelLight);
block("extract hood", new Vector3(5.2, 0.75, 1.2), new Vector3(-2.2, 3.15, -3.35), palette.steelShadow);
block("hood lip", new Vector3(5.45, 0.16, 1.42), new Vector3(-2.2, 2.72, -3.35), palette.steelLight);
block("rear splash", new Vector3(10.8, 1.5, 0.12), new Vector3(0, 1.95, -3.75), palette.steelMid);

// Central island deliberately leaves a broad circulation loop.
block("island cabinet", new Vector3(3.7, 0.86, 1.55), new Vector3(0.6, 0.64, -0.15), palette.steelMid);
block("island top", new Vector3(4.05, 0.14, 1.82), new Vector3(0.6, 1.14, -0.15), palette.steelLight);
block("cutting board", new Vector3(1.25, 0.08, 0.78), new Vector3(-0.25, 1.25, -0.12), palette.walnut);
block("sink", new Vector3(0.95, 0.08, 0.72), new Vector3(1.7, 1.25, -0.12), palette.steelShadow);

interface BlockRig {
  root: TransformNode;
  torso: Mesh;
  head: Mesh;
  leftArm: TransformNode;
  rightArm: TransformNode;
  leftLeg: TransformNode;
  rightLeg: TransformNode;
}

function createPerson(name: string, uniform: StandardMaterial, position: Vector3): BlockRig {
  const root = new TransformNode(name, scene);
  root.position.copyFrom(position);
  const torso = block(`${name} torso`, new Vector3(0.66, 0.8, 0.42), new Vector3(0, 1.0, 0), uniform, root);
  block(`${name} apron`, new Vector3(0.52, 0.64, 0.06), new Vector3(0, 0.96, -0.24), palette.white, root);
  const head = block(`${name} head`, new Vector3(0.54, 0.52, 0.5), new Vector3(0, 1.72, 0), palette.skin, root);
  block(`${name} hair`, new Vector3(0.58, 0.18, 0.54), new Vector3(0, 2.03, 0.01), palette.hair, root);
  block(`${name} hat`, new Vector3(0.64, 0.2, 0.58), new Vector3(0, 2.18, 0), palette.white, root);
  const leftArm = new TransformNode(`${name} left arm pivot`, scene);
  leftArm.parent = root;
  leftArm.position.set(-0.43, 1.31, 0);
  block(`${name} left arm`, new Vector3(0.2, 0.62, 0.22), new Vector3(0, -0.27, 0), uniform, leftArm);
  const rightArm = new TransformNode(`${name} right arm pivot`, scene);
  rightArm.parent = root;
  rightArm.position.set(0.43, 1.31, 0);
  block(`${name} right arm`, new Vector3(0.2, 0.62, 0.22), new Vector3(0, -0.27, 0), uniform, rightArm);
  const leftLeg = new TransformNode(`${name} left leg pivot`, scene);
  leftLeg.parent = root;
  leftLeg.position.set(-0.2, 0.62, 0);
  block(`${name} left leg`, new Vector3(0.24, 0.58, 0.28), new Vector3(0, -0.27, 0), palette.charcoal, leftLeg);
  const rightLeg = new TransformNode(`${name} right leg pivot`, scene);
  rightLeg.parent = root;
  rightLeg.position.set(0.2, 0.62, 0);
  block(`${name} right leg`, new Vector3(0.24, 0.58, 0.28), new Vector3(0, -0.27, 0), palette.charcoal, rightLeg);
  return { root, torso, head, leftArm, rightArm, leftLeg, rightLeg };
}

const player = createPerson("player chef", palette.uniform, new Vector3(0, 0.22, 2.2));
// Guest coat colors rotate for readable variety; coats carry no meaning alone.
const guestCoatMaterials = [
  mat("guest coat a", "#637cb2"),
  mat("guest coat b", "#8d6fae"),
  mat("guest coat c", "#b2685f"),
  mat("guest coat d", "#5f8aa3"),
];

// Voxel data loads lazily (src/assets/catalog/index.ts): fetch what the coded scene and the
// saved decor need before anything reads `foodModels.models[...]`.
await ensureModels(["tomato", "cabbage", "wheat_scan", "tomato_sprout_scan", "tomato_vine_scan", "tomato_ripe_scan", ...decorLayout.props.map((prop) => prop.model)]);
const foodModels: AuthoredVoxelCatalog = foodModelsCatalog;
// Hand-placed decor (vases, tools, props) from src/assets/scene/decor.json.
// Lamps: glowing voxels bloom; a pool of six real point lights follows the camera between placed lamps.
attachGlow(scene, { intensity: 0.8 });
const lightPool = createLightPool(scene, { max: 6 });
// Static props are world-renderer instances; their meshed sources come from the IndexedDB cache when the model revision matches.
const cacheRev = (modelId: string): number | undefined => catalogIndex[modelId]?.rev;
await warmSourceCache([...new Set(decorLayout.props.map((prop) => prop.model))].map((modelId) => sourceCacheKey(modelId, cacheRev(modelId), 0.02)));
const decor = createDecorScene(scene, foodModels, decorLayout, { shadows, lightPool, cacheRev });
const authoredTomato = foodModels.models.tomato!;
const tomatoSource = createVoxelMesh("authored tomato source", cellsFromAuthoredModel(authoredTomato), authoredTomato.pitch, scene);
tomatoSource.setEnabled(false);
function tomato(name: string, position: Vector3, scale = 1): Mesh {
  const mesh = tomatoSource.clone(name)!;
  mesh.setEnabled(true);
  mesh.position.copyFrom(position);
  mesh.scaling.setAll(scale);
  shadows.addShadowCaster(mesh);
  return mesh;
}

const plotRoot = new TransformNode("tomato plot", scene);
plotRoot.position.set(-3.3, 0.2, -6.4);
const tomatoPlants: TomatoPlantRig[] = [];
const tomatoFruits: TomatoFruitRig[] = [];
const tomatoArtProofTier = tomatoPlotUpgradeTiers.at(-1)!;
const tomatoFoliageSource = createTomatoFoliageSource(scene, palette.green);

const plantPositions = [new Vector3(-0.95, 0, 0.05), new Vector3(0, 0, -0.08), new Vector3(0.95, 0, 0.08)];
for (let index = 0; index < tomatoArtProofTier.plants; index++) {
  const position = plantPositions[index]!;
  const plant = createTomatoPlantRig({ index, position, parent: plotRoot, foliageSource: tomatoFoliageSource, fruitSource: tomatoSource, fruitCount: tomatoArtProofTier.fruitSitesPerPlant, shadows });
  tomatoPlants.push(plant);
  tomatoFruits.push(...plant.fruits);
}

// Wheat in the open middle of the soil bed — level-2 crop as art proof. The
// plot is the external-model pipeline's showcase: a free CC0 wheat plant by
// Quaternius, voxelized into the catalog (scripts/voxelize-mesh.py), tiled as
// a dense wall-to-wall grid so it reads as a continuous field band per the
// user's reference.
const wheatRoot = new TransformNode("wheat plot", scene);
wheatRoot.position.set(0, 0.2, -6.4);
const wheatSources = createWheatSourcesFromScan(scene, foodModels, "wheat_scan");
if (!wheatSources) throw new Error("wheat_scan missing from food-models.json");
const wheatPlants: WheatPlantState[] = [];
// Dense 6x4 grid of scan clusters — the chunky-headed single-plant scan the
// user preferred in the lab — wall-to-wall so the bed reads as one field band,
// with two young greens for state readability.
const wheatSpots: Array<{ x: number; z: number; growth: number }> = [];
for (const z of [-0.78, -0.26, 0.26, 0.78]) {
  for (const x of [-1.0, -0.6, -0.2, 0.2, 0.6, 1.0]) {
    wheatSpots.push({ x, z, growth: 1 });
  }
}
wheatSpots[9] = { ...wheatSpots[9], growth: 0.5 };   // (-0.6,  0.26) young
wheatSpots[14] = { ...wheatSpots[14], growth: 0.78 }; // ( 0.6, -0.26) nearly ripe
for (const [index, spot] of wheatSpots.entries()) {
  wheatPlants.push(createWheatPlant({
    index,
    position: new Vector3(spot.x, 0, spot.z),
    parent: wheatRoot,
    sources: wheatSources,
    growth: spot.growth,
    spin: (index % 4) * (Math.PI / 2),
    scale: 1.0 + (index % 3) * 0.05,
    stretchY: 1.12,
    shadows,
  }));
}

// Cabbage row sharing the tomato soil bed, mirroring the plot on the +x half.
// Art-proof placement: spacing, size falloff, and shadowing follow the tomato
// tier language so the model can be judged at true gameplay scale.
const authoredCabbage = foodModels.models.cabbage!;
const cabbagePlot = new TransformNode("cabbage patch", scene);
cabbagePlot.position.set(3.2, 0, -6.4);
const cabbageHeads: Array<{ rig: CabbageRig; swayOffset: number }> = [];
const cabbageSpots = [
  { x: -0.72, z: 0.06, yaw: 0.4, scale: 1 },
  { x: 0.02, z: -0.12, yaw: 2.2, scale: 0.93 },
  { x: 0.76, z: 0.09, yaw: 4.3, scale: 0.87 },
];
for (const [index, spot] of cabbageSpots.entries()) {
  const holder = new TransformNode(`cabbage head ${index + 1}`, scene);
  holder.parent = cabbagePlot;
  // The authored stem reaches 10 voxels below the head origin, so resting it
  // 2cm into the soil keeps every scale variant visibly planted.
  holder.position.set(spot.x, authoredCabbage.pitch * 10 * spot.scale + 0.16, spot.z);
  holder.rotation.y = spot.yaw;
  const rig = createCabbageRig({ name: `cabbage head ${index + 1}`, model: authoredCabbage, scene, shadows });
  rig.root.parent = holder;
  rig.root.scaling.setAll(spot.scale);
  cabbageHeads.push({ rig, swayOffset: index * 2.6 });
}

// Stove: an animated pot, spoon, heat blocks, and semantic indicator.
const stoveRoot = new TransformNode("stove", scene);
stoveRoot.position.set(-3.15, 0.22, -1.75);
block("stove cabinet", new Vector3(1.65, 0.9, 1.25), new Vector3(0, 0.48, 0), palette.steelMid, stoveRoot);
block("stove top", new Vector3(1.82, 0.14, 1.38), new Vector3(0, 0.98, 0), palette.steelLight, stoveRoot);
for (const x of [-0.43, 0.43]) for (const z of [-0.34, 0.34]) block("burner", new Vector3(0.48, 0.07, 0.38), new Vector3(x, 1.09, z), palette.charcoal, stoveRoot);
const potRoot = new TransformNode("soup pot", scene);
potRoot.parent = stoveRoot;
potRoot.position.set(0, 1.14, 0);
block("pot body", new Vector3(0.9, 0.48, 0.78), new Vector3(0, 0.25, 0), palette.steelShadow, potRoot);
const soupSurface = block("soup surface", new Vector3(0.76, 0.06, 0.64), new Vector3(0, 0.51, 0), palette.soup, potRoot);
soupSurface.setEnabled(false);
const spoonPivot = new TransformNode("spoon pivot", scene);
spoonPivot.parent = potRoot;
spoonPivot.position.set(0, 0.55, 0);
block("spoon", new Vector3(0.08, 0.8, 0.08), new Vector3(0.28, 0.28, 0), palette.walnut, spoonPivot);
const stoveLight = block("stove indicator", new Vector3(0.2, 0.16, 0.08), new Vector3(0.55, 0.62, -0.67), palette.amber, stoveRoot);
stoveLight.setEnabled(false);

// Pass counter, physical ticket rail, and illustrated order ticket.
const passRoot = new TransformNode("kitchen pass", scene);
passRoot.position.set(0, 0.22, 3.45);
block("pass cabinet", new Vector3(5.4, 0.92, 0.9), new Vector3(0, 0.5, 0), palette.walnut, passRoot);
block("pass steel top", new Vector3(5.65, 0.14, 1.08), new Vector3(0, 1.03, 0), palette.steelLight, passRoot);
block("ticket rail", new Vector3(4.7, 0.1, 0.1), new Vector3(0, 1.83, -0.38), palette.steelShadow, passRoot);
// Tickets hang on the rail as physical meshes built per waiting order — see
// the ticket view system near the guest simulation.
// Serving shelf: plated servings wait on the pass surface in visible slots.
// Five physical positions for now; the domain cap is higher (12 at level 1) and
// the guided loop never exceeds these five.
const shelfSlotAnchors: TransformNode[] = [];
for (const [index, x] of [-1.0, -0.15, 0.7, 1.55, 2.4].entries()) {
  const anchor = new TransformNode(`shelf slot ${index + 1}`, scene);
  anchor.parent = passRoot;
  anchor.position.set(x, 1.17, -0.05);
  shelfSlotAnchors.push(anchor);
}
const shelfDishes: TransformNode[] = [];
function syncShelfDishes(): void {
  for (const dish of shelfDishes) dish.dispose(false, false);
  shelfDishes.length = 0;
  const total = Object.values(shift.shelfServings).reduce((sum, count) => sum + count, 0);
  for (let index = 0; index < Math.min(total, shelfSlotAnchors.length); index++) {
    shelfDishes.push(createSoupDish(`shelf tomato soup serving ${index + 1}`, shelfSlotAnchors[index]!));
  }
}

// Standing menu board at the pass: the menu choice lives in the world as a
// slotted picture card, not a list. One slot for level 1; the empty state
// shows a pale outline so "something goes here" reads without text.
const menuBoard = new TransformNode("menu board", scene);
menuBoard.parent = passRoot;
menuBoard.position.set(-2.25, 1.1, -0.32);
block("menu board back", new Vector3(0.72, 0.84, 0.06), new Vector3(0, 0.42, 0), palette.walnut, menuBoard);
const menuSlotOutline = new TransformNode("menu slot outline", scene);
menuSlotOutline.parent = menuBoard;
for (const [w, h, x, y] of [[0.5, 0.045, 0, 0.62], [0.5, 0.045, 0, 0.18], [0.045, 0.44, -0.23, 0.4], [0.045, 0.44, 0.23, 0.4]] as const) {
  block("menu slot edge", new Vector3(w, h, 0.05), new Vector3(x, y, -0.02), palette.steelShadow, menuSlotOutline);
}
const menuCard = new TransformNode("slotted menu card", scene);
menuCard.parent = menuBoard;
block("menu card paper", new Vector3(0.46, 0.44, 0.035), new Vector3(0, 0.4, -0.035), palette.cream, menuCard);
block("menu card bowl", new Vector3(0.26, 0.15, 0.05), new Vector3(0, 0.38, -0.07), palette.steelLight, menuCard);
block("menu card soup", new Vector3(0.22, 0.045, 0.05), new Vector3(0, 0.465, -0.07), palette.soup, menuCard);
block("menu card plate", new Vector3(0.36, 0.05, 0.05), new Vector3(0, 0.3, -0.07), palette.cream, menuCard);
const menuCardGarnish = tomato("menu card garnish", new Vector3(0.055, 0.5, -0.07), 0.16);
menuCardGarnish.parent = menuCard;
// Planned-quantity pips — the menu card states tonight's target the same way
// a ticket states quantity. SPACE at the board cycles 1..maxPlannedServings.
const menuPips: Mesh[] = [];
for (const x of [-0.12, 0, 0.12]) {
  menuPips.push(block("menu planned pip", new Vector3(0.07, 0.07, 0.04), new Vector3(x, 0.22, -0.06), palette.charcoal, menuCard));
}
function syncMenuPips(): void {
  const planned = shift.menu[0]?.plannedServings ?? 0;
  menuPips.forEach((pip, index) => pip.setEnabled(index < planned));
}
const menuCardLamp = block("menu card lamp", new Vector3(0.5, 0.48, 0.025), new Vector3(0, 0.4, 0.005), palette.ready, menuBoard);
menuCardLamp.setEnabled(false);
menuCard.setEnabled(false);


// Dining tables: two tables × two seats (four seats at level 1). Each table's
// marker shape AND color is matched by its hanging tickets, so pass-to-table
// mapping stays spatial instead of textual.
interface TableSeat {
  position: Vector3;
  guest: GuestRig | null;
}
interface DiningTable {
  id: number;
  root: TransformNode;
  dishAnchor: TransformNode;
  markerMaterial: StandardMaterial;
  markerShape: "diamond" | "cross";
  seats: TableSeat[];
  grime: Mesh[];
  dirty: boolean;
}

/** Builds the shared table-marker shape so tables and tickets agree exactly. */
function markerBlocks(name: string, parent: TransformNode, material: StandardMaterial, shape: "diamond" | "cross", scale = 1): void {
  if (shape === "diamond") {
    const diamond = block(`${name} marker diamond`, new Vector3(0.26 * scale, 0.09 * scale, 0.26 * scale), Vector3.Zero(), material, parent);
    diamond.rotation.y = Math.PI / 4;
  } else {
    for (const rotation of [Math.PI / 4, -Math.PI / 4]) {
      const bar = block(`${name} marker bar`, new Vector3(0.4 * scale, 0.09 * scale, 0.13 * scale), Vector3.Zero(), material, parent);
      bar.rotation.y = rotation;
    }
  }
}

function createDiningTable(id: number, x: number, markerMaterial: StandardMaterial, markerShape: "diamond" | "cross"): DiningTable {
  const root = new TransformNode(`table ${id}`, scene);
  root.position.set(x, 0.22, 6.15);
  block(`table ${id} top`, new Vector3(2.0, 0.18, 1.45), new Vector3(0, 1.05, 0), palette.walnut, root);
  for (const sx of [-0.72, 0.72]) for (const sz of [-0.45, 0.45]) block(`table ${id} leg`, new Vector3(0.18, 0.92, 0.18), new Vector3(sx, 0.54, sz), palette.walnut, root);
  const markerHolder = new TransformNode(`table ${id} marker`, scene);
  markerHolder.parent = root;
  markerHolder.position.set(0, 1.19, -0.46);
  markerBlocks(`table ${id}`, markerHolder, markerMaterial, markerShape);
  const dishAnchor = new TransformNode(`table ${id} served dish`, scene);
  dishAnchor.parent = root;
  dishAnchor.position.set(0, 1.18, 0.08);
  const grime = [
    block(`table ${id} crumb`, new Vector3(0.16, 0.07, 0.1), new Vector3(-0.28, 1.19, 0.12), palette.grime, root),
    block(`table ${id} crumb`, new Vector3(0.1, 0.06, 0.12), new Vector3(0.32, 1.19, -0.1), palette.grime, root),
    block(`table ${id} spill`, new Vector3(0.38, 0.04, 0.24), new Vector3(0.05, 1.19, 0.25), palette.grime, root),
  ];
  grime.forEach((mesh) => mesh.setEnabled(false));
  return {
    id, root, dishAnchor, markerMaterial, markerShape, grime, dirty: false,
    seats: [0.55, -0.55].map((offset) => ({ position: new Vector3(x + offset, 0.22, 7.35), guest: null })),
  };
}

const tables = [
  createDiningTable(1, 2.75, palette.interaction, "diamond"),
  createDiningTable(2, -2.0, palette.amber, "cross"),
];

// Entry door on the dining-room edge: guests arrive from here, and opening the
// restaurant is a physical act at the door during menu planning.
const doorRoot = new TransformNode("entry door", scene);
doorRoot.position.set(-0.4, 0.22, 8.2);
for (const dx of [-0.75, 0.75]) block("door post", new Vector3(0.22, 2.5, 0.22), new Vector3(dx, 1.25, 0), palette.walnut, doorRoot);
block("door lintel", new Vector3(1.72, 0.24, 0.22), new Vector3(0, 2.55, 0), palette.walnut, doorRoot);
block("door mat", new Vector3(1.5, 0.04, 0.9), new Vector3(0, 0.02, 0.45), palette.charcoal, doorRoot);
const doorOpenLamp = block("door open lamp", new Vector3(0.3, 0.14, 0.1), new Vector3(0, 2.2, -0.02), palette.blocked, doorRoot);
const guestSpawnPoint = new Vector3(-0.4, 0.22, 9.4);

// One interaction cue: it moves to whatever SPACE would do right now, sized to
// the target's footprint, instead of one pad per scripted stage.
const actionCue = block("action cue", new Vector3(2.4, 0.05, 2.4), new Vector3(0, 0.34, 0), palette.interaction);
actionCue.setEnabled(false);

function createSoupDish(name: string, parent: TransformNode): TransformNode {
  const root = new TransformNode(name, scene);
  root.parent = parent;
  block(`${name} plate`, new Vector3(0.78, 0.09, 0.62), new Vector3(0, 0.02, 0), palette.cream, root);
  block(`${name} bowl`, new Vector3(0.58, 0.22, 0.48), new Vector3(0, 0.14, 0), palette.steelLight, root);
  block(`${name} soup`, new Vector3(0.5, 0.05, 0.4), new Vector3(0, 0.28, 0), palette.soup, root);
  tomato(`${name} garnish`, new Vector3(0.14, 0.35, 0), 0.24).parent = root;
  return root;
}

let carriedTomatoes = 0;
// Two carry kinds stay distinct: 🍲 pot yield in transit to the shelf (bounded
// by recipe yield) and 🥣 plated service on the tray (bounded at 1 — "player
// tray starts at 1 dish" in the locked plan).
let carriedYieldServings = 0;
let carriedPlatedServings = 0;
const tomatoSoupRecipe = restaurantRecipes.find((recipe) => recipe.id === "tomato_soup")!;
const menuRecipeId = tomatoSoupRecipe.output;
// Catalog pacing: the stove really takes the recipe's seconds, and fruit
// regrowth follows the plot tier rather than art-proof speeds.
const cookSeconds = tomatoSoupRecipe.seconds ?? 18;
const regrowSeconds = tomatoArtProofTier.regrowSeconds;
const guestPatienceSeconds = 40;
const guestsPerDinner = 24;

let stoveCooking = false;
let stoveReady = false;
let cooking = 0;
let actionAnimation = 0;
// Day-cycle truth lives in the domain module. dinnerElapsed drives guest
// patience inside the phase; the tutorial layer only tracks first-time steps.
let shift = createShift();
let dinnerElapsed = 0;
let nextGuestIn = 0;
let guestsSpawnedThisDinner = 0;
const tutorialStepsDone = new Set<string>();
const saveKey = "farm-to-table-shift";
const keys = new Set<string>();

interface BurstCube { mesh: Mesh; velocity: Vector3; life: number }
const burstCubes: BurstCube[] = [];
function burst(position: Vector3, material: StandardMaterial, count: number): void {
  for (let index = 0; index < count; index++) {
    const mesh = block("action fragment", new Vector3(0.09, 0.09, 0.09), position.clone(), material);
    burstCubes.push({
      mesh,
      velocity: new Vector3((Math.random() - 0.5) * 1.5, 1.2 + Math.random(), (Math.random() - 0.5) * 1.5),
      life: 0.65 + Math.random() * 0.35,
    });
  }
}

// ── Guests ───────────────────────────────────────────────────────────────────
interface GuestRig {
  person: BlockRig;
  state: "arriving" | "waiting" | "eating" | "leaving";
  seat: { table: DiningTable; index: number } | null;
  ticketId: number;
  bubble: TransformNode;
  stateTimer: number;
  tableDish: TransformNode | null;
}
const guests: GuestRig[] = [];

function createGuestBubble(name: string, coatParent: TransformNode): TransformNode {
  const bubble = new TransformNode(`${name} order bubble`, scene);
  bubble.parent = coatParent;
  bubble.position.set(0, 2.85, -0.15);
  block(`${name} bubble card`, new Vector3(0.5, 0.42, 0.05), Vector3.Zero(), palette.cream, bubble);
  block(`${name} bubble bowl`, new Vector3(0.24, 0.13, 0.06), new Vector3(0, -0.02, -0.04), palette.steelLight, bubble);
  block(`${name} bubble soup`, new Vector3(0.2, 0.045, 0.06), new Vector3(0, 0.06, -0.04), palette.soup, bubble);
  bubble.setEnabled(false);
  return bubble;
}

/** Seats a guest directly (captures) or spawns one walking in from the door. */
function spawnGuest(atDoor: boolean, table: DiningTable, seatIndex: number): GuestRig | null {
  if (shift.phase !== "dinner") return null;
  const seat = table.seats[seatIndex]!;
  const coat = guestCoatMaterials[guests.length % guestCoatMaterials.length]!;
  const spawnPosition = atDoor ? guestSpawnPoint : seat.position;
  const person = createPerson(`guest ${guests.length + 1}`, coat, spawnPosition);
  const guest: GuestRig = {
    person,
    state: atDoor ? "arriving" : "waiting",
    seat: { table, index: seatIndex },
    ticketId: 0,
    bubble: createGuestBubble(`guest ${guests.length + 1}`, person.root),
    stateTimer: 0,
    tableDish: null,
  };
  seat.guest = guest;
  guests.push(guest);
  if (!atDoor) {
    seatGuestAtTable(guest);
  }
  return guest;
}

/** A walking guest becomes a waiting one: seat, bubble, and only now does the
 * ticket hang on the rail (the plan's "ticket slides on when seated"). */
function seatGuestAtTable(guest: GuestRig): void {
  if (!guest.seat) return;
  const seated = addTicket(shift, menuRecipeId, guest.seat.table.id, guestPatienceSeconds);
  if (seated.ticketId === 0) return;
  shift = seated.state;
  guest.ticketId = seated.ticketId;
  guest.state = "waiting";
  guest.person.root.rotation.y = Math.PI;
  guest.bubble.setEnabled(true);
  syncTicketViews();
  telemetry.record(shift.day, "guest_seated", { ticketId: guest.ticketId, tableId: guest.seat.table.id });
}

/** Shared deliver path for player and Server: domain resolves the ticket, the
 * world shows the dish and starts the meal. */
function serveAtTable(ticketId: number, servedBy: "player" | "server" = "player"): void {
  const guest = guests.find((candidate) => candidate.ticketId === ticketId && candidate.state === "waiting");
  if (!guest || !guest.seat) return;
  const waitSeconds = waitingTickets(shift).find((ticket) => ticket.id === ticketId)?.waitedSeconds ?? 0;
  shift = serveTicket(shift, ticketId);
  telemetry.record(shift.day, "served", { ticketId, waitSeconds: Number(waitSeconds.toFixed(1)), by: servedBy });
  guest.state = "eating";
  guest.stateTimer = 0;
  guest.bubble.setEnabled(false);
  guest.tableDish = createSoupDish(`served soup ticket ${ticketId}`, guest.seat.table.dishAnchor);
  completeTutorial("serve_customer");
  burst(guest.seat.table.root.position.add(new Vector3(0, 1.3, 0)), palette.ready, 6);
  syncTicketViews();
}

function cleanTable(table: DiningTable): void {
  table.grime.forEach((mesh) => mesh.setEnabled(false));
  table.dirty = false;
}

function guestLeaves(guest: GuestRig): void {
  if (guest.seat) {
    guest.seat.table.seats[guest.seat.index]!.guest = null;
    guest.seat = null;
  }
  guest.state = "leaving";
  guest.bubble.setEnabled(false);
  guest.tableDish?.dispose(false, false);
  guest.tableDish = null;
}

function disposeGuest(guest: GuestRig): void {
  if (guest.seat) {
    guest.seat.table.seats[guest.seat.index]!.guest = null;
    guest.seat = null;
  }
  guest.person.root.dispose(false, false);
  guests.splice(guests.indexOf(guest), 1);
}

// ── Server ───────────────────────────────────────────────────────────────────
// One bounded helper: slow, one delivery at a time, shelf-to-table only. It
// relieves the running around but never cooks, cleans, or seats anyone.
interface ServerRig {
  person: BlockRig;
  mode: "idle" | "toShelf" | "toTable" | "home";
  ticketId: number | null;
  target: Vector3;
  carrying: TransformNode | null;
}
const serverHome = new Vector3(2.3, 0.22, 2.5);
const serverShelfApproach = new Vector3(1.6, 0.22, 3.1);
const server = { person: createPerson("server", mat("server coat", "#7a5c3e"), serverHome.clone()), mode: "idle" as const, ticketId: null, target: serverHome.clone(), carrying: null } as ServerRig;
// Tray reset between runs: without it the server doubles total delivery
// capacity and the dinner stops being a juggle (proven by the first sim).
let serverRestSeconds = 0;

// ── Physical ticket rail ─────────────────────────────────────────────────────
// One hanging ticket per waiting order: dish picture, table marker that
// matches the table's shape and color, and a patience wedge.
interface TicketView {
  root: TransformNode;
  wedge: Mesh;
}
const ticketViews = new Map<number, TicketView>();

function createTicketView(ticket: TicketRecord): TicketView {
  const root = new TransformNode(`ticket ${ticket.id}`, scene);
  root.parent = passRoot;
  block(`ticket ${ticket.id} paper`, new Vector3(0.72, 0.78, 0.07), Vector3.Zero(), palette.cream, root);
  for (const x of [-0.13, 0.13]) block(`ticket ${ticket.id} dish picture`, new Vector3(0.18, 0.18, 0.08), new Vector3(x, 0.18, -0.075), palette.tomato, root);
  const token = new TransformNode(`ticket ${ticket.id} token`, scene);
  token.parent = root;
  token.position.set(0, 0.38, -0.08);
  const table = tables.find((candidate) => candidate.id === ticket.tableId)!;
  markerBlocks(`ticket ${ticket.id}`, token, table.markerMaterial, table.markerShape, 0.8);
  const wedge = block(`ticket ${ticket.id} patience`, new Vector3(0.62, 0.08, 0.09), new Vector3(0, -0.34, -0.08), palette.ready, root);
  return { root, wedge };
}

function syncTicketViews(): void {
  const waiting = waitingTickets(shift);
  for (const [id, view] of ticketViews) {
    if (!waiting.some((ticket) => ticket.id === id)) {
      view.root.dispose(false, false);
      ticketViews.delete(id);
    }
  }
  for (const [index, ticket] of waiting.entries()) {
    let view = ticketViews.get(ticket.id);
    if (!view) {
      view = createTicketView(ticket);
      ticketViews.set(ticket.id, view);
      view.root.position.set(-1.65 + index * 0.9, 1.48, -0.44);
    }
  }
}

function updateTicketWedges(): void {
  for (const ticket of waitingTickets(shift)) {
    const view = ticketViews.get(ticket.id);
    if (!view) continue;
    const patience = Math.max(0, 1 - ticket.waitedSeconds / ticket.patienceSeconds);
    view.wedge.scaling.x = Math.max(0.02, patience);
    view.wedge.position.x = -(1 - patience) * 0.31;
    view.wedge.material = patience > 0.55 ? palette.ready : patience > 0.25 ? palette.amber : palette.blocked;
  }
}

// ── Player actions ───────────────────────────────────────────────────────────
type PlayerAction =
  | { kind: "harvest" | "cook" | "collect" | "stock" | "take_serving" | "menu_quantity" | "open_doors"; position: Vector3 }
  | { kind: "deliver"; position: Vector3; ticketId: number }
  | { kind: "clean"; position: Vector3; table: DiningTable };

function shelfServingsTotal(): number {
  return Object.values(shift.shelfServings).reduce((sum, count) => sum + count, 0);
}

function ripeFruitCount(): number {
  return tomatoFruits.filter((fruit) => fruit.growth >= 1).length;
}

/** Resolves what SPACE does right now: nearest meaningful interaction wins,
 * actions validate their own preconditions at press time (no stale proximity). */
function bestPlayerAction(): PlayerAction | null {
  const near = (position: Vector3, distance = 2.1) =>
    Vector3.DistanceSquared(player.root.position, position) <= distance * distance;
  if (shift.phase === "close") return null;
  if (shift.phase === "choose_menu") {
    if (near(doorRoot.position, 2.6)) return { kind: "open_doors", position: doorRoot.position };
    if (near(passRoot.position, 2.6)) return { kind: "menu_quantity", position: passRoot.position };
    return null;
  }
  for (const table of tables) {
    if (!near(table.root.position)) continue;
    const waitingGuest = table.seats.find((seat) => seat.guest?.state === "waiting");
    if (waitingGuest && carriedPlatedServings > 0) {
      return { kind: "deliver", position: table.root.position, ticketId: waitingGuest.guest!.ticketId };
    }
    if (table.dirty && table.seats.every((seat) => seat.guest === null)) {
      return { kind: "clean", position: table.root.position, table };
    }
  }
  if (near(passRoot.position)) {
    if (carriedYieldServings > 0) return { kind: "stock", position: passRoot.position };
    if (shelfServingsTotal() > 0 && carriedPlatedServings < 1) return { kind: "take_serving", position: passRoot.position };
  }
  if (near(stoveRoot.position)) {
    if (stoveReady) return { kind: "collect", position: stoveRoot.position };
    if (!stoveCooking && carriedTomatoes >= 2) return { kind: "cook", position: stoveRoot.position };
  }
  if (near(plotRoot.position) && carriedTomatoes <= 2 && ripeFruitCount() > 0) {
    return { kind: "harvest", position: plotRoot.position };
  }
  return null;
}

function interact(): void {
  if (actionAnimation > 0) return;
  if (shift.phase === "close") {
    startNextDay();
    return;
  }
  const action = bestPlayerAction();
  if (!action) {
    // Nothing to do here: poke a decoration if one reacts (its interaction clip plays once).
    const prop = decor.nearestInteractive(player.root.position, 1.6);
    if (prop) decor.trigger(prop.prop.id);
    return;
  }
  switch (action.kind) {
    case "harvest": {
      const pickedFruit = tomatoFruits.filter((fruit) => fruit.growth >= 1).slice(0, 2);
      pickedFruit.forEach((fruit, index) => { fruit.growth = -0.45 - index * 0.55; });
      carriedTomatoes += pickedFruit.length;
      actionAnimation = 0.55;
      completeTutorial("harvest_tomatoes");
      burst(plotRoot.position.add(new Vector3(0, 0.8, 0)), palette.tomato, 8);
      break;
    }
    case "cook": {
      carriedTomatoes -= 2;
      stoveCooking = true;
      stoveReady = false;
      cooking = 0;
      actionAnimation = 1.1;
      soupSurface.setEnabled(true);
      completeTutorial("cook_soup");
      burst(stoveRoot.position.add(new Vector3(0, 1.5, 0)), palette.tomato, 10);
      break;
    }
    case "collect": {
      stoveCooking = false;
      stoveReady = false;
      carriedYieldServings += tomatoSoupRecipe.outputAmount;
      actionAnimation = 0.45;
      soupSurface.setEnabled(false);
      break;
    }
    case "stock": {
      telemetry.record(shift.day, "stock", { servings: carriedYieldServings });
      shift = stockShelf(shift, menuRecipeId, carriedYieldServings);
      carriedYieldServings = 0;
      syncShelfDishes();
      actionAnimation = 0.35;
      completeTutorial("stock_servings");
      if (shift.phase === "prep") enterMenuPhase();
      break;
    }
    case "take_serving": {
      shift = takeServing(shift, menuRecipeId);
      carriedPlatedServings = 1;
      syncShelfDishes();
      actionAnimation = 0.35;
      break;
    }
    case "deliver": {
      carriedPlatedServings = 0;
      serveAtTable(action.ticketId);
      actionAnimation = 0.45;
      break;
    }
    case "clean": {
      cleanTable(action.table);
      actionAnimation = 1.0;
      burst(action.table.root.position.add(new Vector3(0, 1.35, 0)), palette.ready, 8);
      break;
    }
    case "menu_quantity": {
      const current = shift.menu[0]?.plannedServings ?? 1;
      shift = setPlannedServings(shift, menuRecipeId, current % maxPlannedServings + 1);
      syncMenuPips();
      actionAnimation = 0.3;
      break;
    }
    case "open_doors": {
      openDoors();
      break;
    }
  }
  updateHud();
}

// ── Phase transitions with world side effects ────────────────────────────────
function enterMenuPhase(): void {
  const fromPhase = shift.phase;
  shift = openForDinner(shift);
  telemetry.record(shift.day, "phase", { from: fromPhase, to: shift.phase });
  if (shift.phase !== "choose_menu" || shift.menu.length > 0) return;
  // Level 1 has exactly one eligible dish, so the card slots itself; the
  // player's real choice is the planned quantity, cycled at the board.
  shift = chooseMenuSlot(shift, menuRecipeId, Math.min(maxPlannedServings, tomatoSoupRecipe.outputAmount));
  menuCard.setEnabled(true);
  menuCardLamp.setEnabled(true);
  menuSlotOutline.setEnabled(false);
  syncMenuPips();
}

function openDoors(): void {
  const fromPhase = shift.phase;
  shift = startDinner(shift);
  telemetry.record(shift.day, "phase", { from: fromPhase, to: shift.phase });
  if (shift.phase !== "dinner") return;
  doorOpenLamp.material = palette.ready;
  dinnerElapsed = 0;
  nextGuestIn = 1.5;
  guestsSpawnedThisDinner = 0;
  actionAnimation = 0.5;
  completeTutorial("choose_menu");
  burst(doorRoot.position.add(new Vector3(0, 1.4, 0)), palette.ready, 10);
}

let closeResultsShown = false;

function enterClose(): void {
  // Called both from hand-closing (phase still "dinner") and from the dinner
  // timer's tick (phase already "close") — the shown-flag, not the phase,
  // decides whether the results card still needs rendering.
  if (closeResultsShown) return;
  closeResultsShown = true;
  shift = endDinner(shift);
  const shelfServingsAtClose = Object.values(shift.shelfServings).reduce((sum, count) => sum + count, 0);
  // Plated dishes expire at close: whatever is still on the shelf is waste.
  shift = expirePlatedFood(shift);
  syncShelfDishes();
  const servedTotal = Object.values(shift.servedByRecipe).reduce((sum, count) => sum + count, 0);
  const fulfillment = servedTotal + shift.missedGuests === 0 ? null : servedTotal / (servedTotal + shift.missedGuests);
  telemetry.snapshot({
    ev: "shift_close", day: shift.day, phase: "close", served: servedTotal,
    missed: shift.missedGuests, wastedServings: shift.wastedServings, coinsEarned: shift.coinsEarned,
    avgWaitSeconds: averageWaitSeconds(shift), fulfillment, shelfServingsAtClose,
  });
  for (const guest of [...guests]) disposeGuest(guest);
  ticketViews.forEach((view) => view.root.dispose(false, false));
  ticketViews.clear();
  const results = closeDay(shift);
  shift = bankDayEarnings(shift);
  resultsTitleEl.textContent = `DAY ${results.day} CLOSED`;
  resultsServedEl.replaceChildren();
  for (let index = 0; index < Math.max(1, servedTotal); index++) {
    const plate = document.createElement("span");
    plate.textContent = index < servedTotal ? "🥣" : "·";
    resultsServedEl.append(plate);
  }
  resultsMissedEl.replaceChildren();
  for (let index = 0; index < results.missedGuests; index++) {
    const missed = document.createElement("span");
    missed.textContent = "🚶";
    resultsMissedEl.append(missed);
  }
  resultsWasteEl.replaceChildren();
  for (let index = 0; index < results.wastedServings; index++) {
    const wasted = document.createElement("span");
    wasted.textContent = "🗑";
    resultsWasteEl.append(wasted);
  }
  const averageWait = averageWaitSeconds(shift);
  resultsWaitEl.textContent = averageWait === null ? "" : `⏱ ${Math.floor(averageWait / 60)}:${String(Math.round(averageWait % 60)).padStart(2, "0")} average wait`;
  resultsCoinsEl.textContent = `✦ ${results.coinsEarned}`;
  resultsEl.hidden = false;
  completeTutorial("close_day");
  persistState(shift.day + 1);
  publishTelemetry();
  updateHud();
}

function startNextDay(): void {
  resultsEl.hidden = true;
  closeResultsShown = false;
  shift = nextDay(shift);
  dinnerElapsed = 0;
  nextGuestIn = 0;
  guestsSpawnedThisDinner = 0;
  carriedTomatoes = 0;
  carriedYieldServings = 0;
  carriedPlatedServings = 0;
  stoveCooking = false;
  stoveReady = false;
  cooking = 0;
  soupSurface.setEnabled(false);
  syncShelfDishes();
  for (const table of tables) cleanTable(table);
  menuCard.setEnabled(false);
  menuCardLamp.setEnabled(false);
  menuSlotOutline.setEnabled(true);
  doorOpenLamp.material = palette.blocked;
  // Crops persist across days by design: whatever was ripe stays ripe and
  // picked sites keep regrowing on their own, so no forced reset here.
  persistState(shift.day);
  updateHud();
}

// ── Tutorial + persistence ───────────────────────────────────────────────────
function completeTutorial(stepId: string): void {
  tutorialStepsDone.add(stepId);
}

function fruitGrowths(): number[] {
  return tomatoFruits.map((fruit) => Number(fruit.growth.toFixed(3)));
}

function persistState(day: number): void {
  if (autopilotEnabled) return; // sims never touch the player's save
  writeSave(saveKey, buildShiftSave(day, shift.coins, [...tutorialStepsDone], fruitGrowths()));
}

function publishTelemetry(): void {
  (window as unknown as { __farmTelemetry?: () => string }).__farmTelemetry = () => telemetry.jsonl();
  document.getElementById("farm-telemetry")?.remove();
  const holder = document.createElement("script");
  holder.id = "farm-telemetry";
  holder.type = "application/json";
  holder.textContent = telemetry.jsonl();
  document.body.append(holder);
}

function restoreFromSave(): void {
  const raw = readSave<ShiftSaveV1>(saveKey, 1);
  const save = raw ? migrateShiftSave(raw) : null;
  if (!save) return;
  shift = createShift(save.day, 1, save.coins);
  for (const step of save.tutorialStepsDone) tutorialStepsDone.add(step);
  if (save.fruitGrowths.length === tomatoFruits.length) {
    tomatoFruits.forEach((fruit, index) => { fruit.growth = save.fruitGrowths[index]!; });
  }
}

// ── HUD ──────────────────────────────────────────────────────────────────────
const phaseLabels = { prep: "PREP", choose_menu: "MENU", dinner: "DINNER", close: "CLOSE" } as const;
const phaseLampColors = { prep: "#e0a744", choose_menu: "#8bd6dc", dinner: "#dc4c3f", close: "#f3ead6" } as const;

function updateHud(): void {
  objectiveEl.replaceChildren();
  const activeStep = tutorialSteps.findIndex((step) => !tutorialStepsDone.has(step.id));
  for (let index = 0; index < tutorialSteps.length; index++) {
    const dot = document.createElement("i");
    dot.className = activeStep === -1 || index < activeStep ? "done" : index === activeStep ? "active" : "";
    objectiveEl.append(dot);
  }
  carryEl.replaceChildren();
  for (let index = 0; index < carriedTomatoes; index++) {
    const icon = document.createElement("span");
    icon.textContent = "🍅";
    carryEl.append(icon);
  }
  for (let index = 0; index < carriedYieldServings; index++) {
    const icon = document.createElement("span");
    icon.textContent = "🍲";
    carryEl.append(icon);
  }
  for (let index = 0; index < carriedPlatedServings; index++) {
    const icon = document.createElement("span");
    icon.textContent = "🥣";
    carryEl.append(icon);
  }
  if (carryEl.childElementCount === 0) {
    const empty = document.createElement("span");
    empty.textContent = "·";
    carryEl.append(empty);
  }
  dayEl.textContent = `DAY ${shift.day}`;
  coinsEl.textContent = `✦ ${shift.coins}`;
  phaseNameEl.textContent = phaseLabels[shift.phase];
  phaseLampEl.style.background = phaseLampColors[shift.phase];
  updatePhaseClock();
  actionEl.classList.toggle("show", bestPlayerAction() !== null || shift.phase === "close");
}

function updatePhaseClock(): void {
  if (shift.phase === "prep" || shift.phase === "dinner") {
    const seconds = Math.ceil(shift.phaseSecondsRemaining);
    phaseClockEl.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  } else {
    phaseClockEl.textContent = "—";
  }
}

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const typing = (event.target as HTMLElement | null)?.tagName === "INPUT" || (event.target as HTMLElement | null)?.tagName === "TEXTAREA";
  if (!typing && key === "b" && !event.repeat && !event.metaKey && !event.ctrlKey) { decorate.toggle(); keys.clear(); decorateLaunch.classList.toggle("active", decorate.active); return; }
  if (decorate.active) return; // decorate mode owns the keyboard
  keys.add(key);
  if (key === " " || key === "enter") {
    event.preventDefault();
    interact();
  }
  if (!event.repeat && key === "q") rotateCamera(-1);
  if (!event.repeat && key === "e") rotateCamera(1);
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));

const camera = new ArcRotateCamera("isometric camera", -Math.PI / 4, 0.92, 21, new Vector3(0, 0.7, 0.5), scene);
camera.fov = 0.58;
camera.lowerBetaLimit = 0.88;
camera.upperBetaLimit = 0.92;
// Wheel zoom range while playing: close enough to read a plate, far enough to see the whole kitchen and farm.
camera.lowerRadiusLimit = 5;
camera.upperRadiusLimit = 40;
camera.inputs.clear();

scene.imageProcessingConfiguration.contrast = 1.08;
scene.imageProcessingConfiguration.exposure = 1.02;
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = 1;
const finishingPipeline = new DefaultRenderingPipeline("restaurant finishing", true, scene, [camera]);
finishingPipeline.fxaaEnabled = true;
finishingPipeline.bloomEnabled = true;
finishingPipeline.bloomThreshold = 0.91;
finishingPipeline.bloomWeight = 0.12;
finishingPipeline.bloomKernel = 32;
if (SSAO2RenderingPipeline.IsSupported) {
  const ambientOcclusion = new SSAO2RenderingPipeline("contact ambient occlusion", scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [camera]);
  ambientOcclusion.samples = 8;
  ambientOcclusion.radius = 1.25;
  ambientOcclusion.totalStrength = 0.72;
  ambientOcclusion.base = 0.08;
  ambientOcclusion.expensiveBlur = false;
}
// Decorate mode (B): edit the world's props in place with the lab's camera and gizmos.
const decorate = createDecorateMode({
  scene, canvas, catalog: foodModels, shadows, decor, layout: decorLayout, gameCamera: camera,
  // Any static block — floors, counters, walls, shelves — can hold a prop; people and props cannot.
  isSurface: (mesh) => {
    if (mesh.name === "grounds") return true;
    if ((mesh.metadata as { surface?: boolean; decorId?: string } | null)?.surface !== true) return false;
    for (let node = mesh.parent; node; node = node.parent) if (/chef|guest|server/i.test(node.name)) return false;
    return true;
  },
  onCameraSwap: (swapped) => { if (swapped) finishingPipeline.addCamera(swapped); else for (const other of finishingPipeline.cameras.filter((c) => c !== camera)) finishingPipeline.removeCamera(other); },
});
const decorateLaunch = document.createElement("button");
decorateLaunch.className = "decorate-launch";
decorateLaunch.textContent = "🛠 Decorate (B)";
decorateLaunch.title = "Decorate mode: place, move and turn catalog objects in the world; saves to src/assets/scene/decor.json";
decorateLaunch.addEventListener("click", () => decorate.toggle());
app.append(decorateLaunch);
// Dev aid for driven browser sessions (decorate-mode checks), like the lab's __lab.
(window as unknown as { __game: unknown }).__game = { scene, camera, decor, decorate, layout: decorLayout };

let cameraTargetAlpha = camera.alpha;
let cameraTargetRadius = camera.radius;
let cameraRotationStartAlpha = camera.alpha;
let cameraRotationElapsed = 0.28;
const cameraRotationDuration = 0.28;

// Deterministic gameplay-scene captures (?camAlpha=&camRadius=&playerX=&playerZ=
// &proofStage=&growth=&freeze=). Startup-only overrides; they never affect
// interactive play.
const captureParams = new URLSearchParams(window.location.search);
// Balance telemetry follows the project's diagnostics spec: JSONL, capped,
// schema header, game-time seconds. Published to the DOM so headless
// --dump-dom runs can harvest it.
const telemetry = new TelemetryLog();
// Autopilot: an ordinary-player bot that plays whole days through the real
// interact() path for balance sims. It never touches the player's save.
const autopilotEnabled = captureParams.has("autopilot");
const autopilotDays = Math.min(7, Math.max(1, Math.round(captureNumber("days") || 1)));
let autopilotDaysDone = 0;
let autopilotWait = 1.0;
let autopilotFinished = false;
const autopilotMistakeSeconds = Math.max(0, captureNumber("mistake") || 0);
let mistakeTakenThisDay = 0;

// A fresh sim must not inherit (or overwrite) the player's real save.
if (!autopilotEnabled) restoreFromSave();
// URLSearchParams.get returns null when absent and Number(null) is 0, so guard
// here — an omitted parameter must never silently override the authored default.
function captureNumber(name: string): number {
  const raw = captureParams.get(name);
  return raw === null || raw === "" ? Number.NaN : Number(raw);
}
const captureAlpha = captureNumber("camAlpha");
const captureRadius = captureNumber("camRadius");
const capturePlayerX = captureNumber("playerX");
const capturePlayerZ = captureNumber("playerZ");
if (Number.isFinite(captureAlpha)) {
  camera.alpha = captureAlpha;
  cameraTargetAlpha = captureAlpha;
  cameraRotationStartAlpha = captureAlpha;
}
if (Number.isFinite(captureRadius)) {
  camera.radius = captureRadius;
  cameraTargetRadius = captureRadius;
}
if (Number.isFinite(capturePlayerX)) player.root.position.x = capturePlayerX;
if (Number.isFinite(capturePlayerZ)) player.root.position.z = capturePlayerZ;

// Fixed plot states for tomato growth-state validation: proofStage=1 replays a
// harvest exactly as interact() does (two ripe sites picked into hand), growth=
// pins the scale of every not-yet-ripe fruit, and freeze= pauses regrowth so
// virtual-time screenshots stay on the requested state.
const captureProofStage = captureNumber("proofStage");
const captureGrowth = captureNumber("growth");
const freezeGrowth = captureParams.has("freeze");
if (Number.isFinite(captureProofStage) && captureProofStage >= 1) {
  tomatoFruits.filter((fruit) => fruit.growth >= 1).slice(0, 2)
    .forEach((fruit, index) => { fruit.growth = -0.45 - index * 0.55; });
  carriedTomatoes = 2;
}
if (Number.isFinite(captureGrowth)) {
  const fixedGrowth = Math.min(1, Math.max(0, captureGrowth));
  for (const fruit of tomatoFruits) {
    if (fruit.growth < 1) fruit.growth = fixedGrowth;
  }
}
// proofPhase= jumps the day cycle to a phase for capture validation, reusing
// the exact transition functions interactive play uses. dinner/close seat one
// waiting guest per table so tickets, markers, and the results card are real.
const captureProofPhase = captureParams.get("proofPhase");
if (captureProofPhase === "choose_menu" || captureProofPhase === "dinner" || captureProofPhase === "close") {
  // Prep stocked the shelf before the doors opened, exactly as play does.
  shift = stockShelf(shift, menuRecipeId, tomatoSoupRecipe.outputAmount);
  syncShelfDishes();
  enterMenuPhase();
  if (captureProofPhase === "choose_menu") {
    updateHud();
  } else {
    openDoors();
    spawnGuest(false, tables[0]!, 0);
    spawnGuest(false, tables[1]!, 0);
    if (captureProofPhase === "close") {
      const firstTicket = waitingTickets(shift)[0];
      if (firstTicket) {
        shift = takeServing(shift, menuRecipeId);
        serveAtTable(firstTicket.id);
      }
      enterClose();
    } else {
      updateHud();
    }
  }
}

function rotateCamera(direction: -1 | 1): void {
  cameraRotationStartAlpha = camera.alpha;
  cameraTargetAlpha += direction * Math.PI / 4;
  cameraRotationElapsed = 0;
}

canvas.addEventListener("wheel", (event) => {
  if (decorate.active) return; // decorate mode's own camera owns the wheel
  event.preventDefault();
  const minimum = camera.lowerRadiusLimit ?? 5;
  const maximum = camera.upperRadiusLimit ?? 40;
  // Proportional steps: the same wheel notch feels alike close up and far away.
  cameraTargetRadius = Math.max(minimum, Math.min(maximum, cameraTargetRadius * (event.deltaY > 0 ? 1.12 : 1 / 1.12)));
}, { passive: false });

// A short click remains an alternative to the keyboard action.
let pointerDown: { id: number; x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (event) => {
  if (decorate.active) return;
  if (event.button === 0) pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerDown || pointerDown.id !== event.pointerId) return;
  const travelled = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (travelled < 6) interact();
});
canvas.addEventListener("pointercancel", () => { pointerDown = null; });

// The chef always faces the mouse pointer (twin-stick readability): aim is the
// pointer unprojected onto the floor, clamped to the play bounds.
let pointerAim: Vector3 | null = null;
canvas.addEventListener("pointermove", (event) => {
  const scaleX = engine.getRenderWidth() / Math.max(1, canvas.clientWidth);
  const scaleY = engine.getRenderHeight() / Math.max(1, canvas.clientHeight);
  const ray = scene.createPickingRay(event.offsetX * scaleX, event.offsetY * scaleY, Matrix.Identity(), camera);
  const distance = (0.22 - ray.origin.y) / ray.direction.y;
  if (Number.isFinite(distance) && distance > 0) {
    const point = ray.origin.add(ray.direction.scale(distance));
    point.x = Math.max(-5.5, Math.min(5.5, point.x));
    point.z = Math.max(-7.4, Math.min(8.1, point.z));
    pointerAim = point;
  }
});

function turnTowards(currentYaw: number, targetYaw: number, t: number): number {
  let delta = (targetYaw - currentYaw) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return currentYaw + delta * t;
}

// ── Autopilot (balance sims) ─────────────────────────────────────────────────
// An ordinary player, not an optimal one: heuristic priorities, human reaction
// pauses, and every action goes through the real interact() path. Used by
// `npm run sim:shift` to measure whole days without a human at the keys.
function autopilotGoal(): PlayerAction | null {
  if (shift.phase === "choose_menu") return { kind: "open_doors", position: doorRoot.position };
  const pipeline = carriedYieldServings + (stoveCooking || stoveReady ? tomatoSoupRecipe.outputAmount : 0);
  // Prep: collect two batches before the single stock that ends the phase.
  if (shift.phase === "prep" && pipeline < tomatoSoupRecipe.outputAmount * 2) {
    if (stoveReady) return { kind: "collect", position: stoveRoot.position };
    if (!stoveCooking && carriedTomatoes >= 2) return { kind: "cook", position: stoveRoot.position };
    if (carriedTomatoes < 2 && ripeFruitCount() > 0) return { kind: "harvest", position: plotRoot.position };
  }
  if (carriedYieldServings > 0) return { kind: "stock", position: passRoot.position };
  const waitingTables = tables.filter((table) => table.seats.some((seat) => seat.guest?.state === "waiting"));
  if (waitingTables.length > 0) {
    if (carriedPlatedServings > 0) {
      const target = waitingTables
        .slice()
        .sort((a, b) => Vector3.DistanceSquared(player.root.position, a.root.position) - Vector3.DistanceSquared(player.root.position, b.root.position))[0]!;
      const waitingSeat = target.seats.find((seat) => seat.guest?.state === "waiting")!;
      return { kind: "deliver", position: target.root.position, ticketId: waitingSeat.guest!.ticketId };
    }
    if (shelfServingsTotal() > 0) return { kind: "take_serving", position: passRoot.position };
  }
  if (stoveReady) return { kind: "collect", position: stoveRoot.position };
  const needSupply = waitingTables.length + 1;
  if (!stoveCooking && carriedTomatoes >= 2 && shelfServingsTotal() + pipeline < needSupply) {
    return { kind: "cook", position: stoveRoot.position };
  }
  if (carriedTomatoes < 2 && ripeFruitCount() > 0 && shelfServingsTotal() + pipeline < needSupply) {
    return { kind: "harvest", position: plotRoot.position };
  }
  const dirtyTable = tables.find((table) => table.dirty && table.seats.every((seat) => seat.guest === null));
  if (dirtyTable) return { kind: "clean", position: dirtyTable.root.position, table: dirtyTable };
  return null;
}

function autopilotWalk(target: Vector3, dt: number): boolean {
  const difference = target.subtract(player.root.position);
  difference.y = 0;
  const distance = difference.length();
  if (distance < 1.3) return true;
  const direction = difference.normalize();
  player.root.position.addInPlace(direction.scale(Math.min(distance - 1.1, dt * 3.25)));
  player.root.position.x = Math.max(-5.5, Math.min(5.5, player.root.position.x));
  player.root.position.z = Math.max(-7.4, Math.min(8.1, player.root.position.z));
  player.root.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;
  animateWalk(player, true);
  return false;
}

function updateAutopilot(dt: number): void {
  if (!autopilotEnabled || autopilotFinished) return;
  if (autopilotMistakeSeconds > 0 && shift.day !== mistakeTakenThisDay
      && guests.some((guest) => guest.state === "waiting")) {
    mistakeTakenThisDay = shift.day;
    autopilotWait = Math.max(autopilotWait, autopilotMistakeSeconds);
    telemetry.record(shift.day, "bot_mistake", { seconds: autopilotMistakeSeconds });
    return;
  }
  autopilotWait -= dt;
  if (shift.phase === "close") {
    if (autopilotWait <= 0) {
      interact(); // SPACE on the results card rolls the day
      autopilotDaysDone++;
      if (autopilotDaysDone >= autopilotDays) {
        autopilotFinished = true;
        telemetry.record(shift.day, "sim_end", { days: autopilotDaysDone });
        publishTelemetry();
        (window as unknown as { __simDone?: boolean }).__simDone = true;
      } else {
        autopilotWait = 1.2;
      }
    }
    return;
  }
  if (autopilotWait > 0) return; // human pause between actions
  const goal = autopilotGoal();
  if (!goal) return;
  if (autopilotWalk(goal.position, dt)) {
    interact();
    autopilotWait = 0.35 + Math.random() * 0.45;
  }
}

// ── Shared movement helpers ───────────────────────────────────────────────────
/** Straight-line walk with facing; collision-free like the rest of the proof.
 * Returns true once inside the arrival tolerance. */
function walkTowards(root: TransformNode, target: Vector3, dt: number, speed: number): boolean {
  const difference = target.subtract(root.position);
  difference.y = 0;
  const distance = difference.length();
  if (distance < 0.09) return true;
  const direction = difference.normalize();
  root.position.addInPlace(direction.scale(Math.min(distance, dt * speed)));
  root.rotation.y = Math.atan2(direction.x, direction.z) + Math.PI;
  return false;
}

function animateWalk(person: BlockRig, moving: boolean): void {
  const stride = moving ? Math.sin(elapsed * 9) * 0.45 : 0;
  person.leftLeg.rotation.x = stride;
  person.rightLeg.rotation.x = -stride;
  person.leftArm.rotation.x = -stride * 0.6;
  person.rightArm.rotation.x = stride * 0.6;
}

// The Server relieves exactly one bottleneck: carrying plates to tables. It
// never cooks, harvests, cleans, or seats anyone, walks slower than the player,
// and handles one ticket per round trip home.
function updateServer(dt: number): void {
  if (server.mode === "idle") {
    server.person.torso.position.y = 1 + Math.sin(elapsed * 1.6) * 0.012;
    if (serverRestSeconds > 0) {
      // A queue building up cuts the tray reset short.
      if (waitingTickets(shift).length >= 2) serverRestSeconds = 0;
      else {
        serverRestSeconds -= dt;
        return;
      }
    }
    const candidates = shift.phase === "dinner"
      ? waitingTickets(shift).filter((ticket) => (shift.shelfServings[ticket.recipeId] ?? 0) > 0)
      : [];
    if (candidates.length === 0) return;
    server.ticketId = candidates[0]!.id;
    server.mode = "toShelf";
    server.target = serverShelfApproach;
    return;
  }
  // Walking home is interruptible: a deliverable ticket redirects the server
  // immediately instead of making guests wait out the ceremony.
  if (server.mode === "home" && shift.phase === "dinner") {
    const urgent = waitingTickets(shift).find((ticket) => (shift.shelfServings[ticket.recipeId] ?? 0) > 0);
    if (urgent) {
      server.ticketId = urgent.id;
      server.mode = "toShelf";
      server.target = serverShelfApproach;
      return;
    }
  }
  const arrived = walkTowards(server.person.root, server.target, dt, 2.0);
  animateWalk(server.person, !arrived);
  if (!arrived) return;
  if (server.mode === "toShelf") {
    if ((shift.shelfServings[menuRecipeId] ?? 0) <= 0) {
      // The player emptied the shelf first: give up the round gracefully.
      server.ticketId = null;
      server.mode = "home";
      server.target = serverHome;
      return;
    }
    shift = takeServing(shift, menuRecipeId);
    syncShelfDishes();
    const ticket = waitingTickets(shift).find((entry) => entry.id === server.ticketId);
    if (!ticket) {
      // The guest walked out mid-trip: the plate goes back on the shelf.
      shift = stockShelf(shift, menuRecipeId, 1);
      syncShelfDishes();
      server.ticketId = null;
      server.mode = "home";
      server.target = serverHome;
      return;
    }
    server.carrying = createSoupDish("server tray dish", server.person.root);
    server.carrying.position.set(0.45, 1.12, 0.12);
    server.target = tables.find((table) => table.id === ticket.tableId)!.root.position;
    server.mode = "toTable";
  } else if (server.mode === "toTable") {
    const ticket = shift.tickets.find((entry) => entry.id === server.ticketId);
    if (ticket?.status === "waiting") serveAtTable(ticket.id, "server");
    else {
      shift = stockShelf(shift, menuRecipeId, 1);
      syncShelfDishes();
    }
    server.carrying?.dispose(false, false);
    server.carrying = null;
    server.ticketId = null;
    server.mode = "home";
    server.target = serverHome;
  } else {
    server.mode = "idle";
    serverRestSeconds = 4 + Math.random() * 2;
  }
}

let previous = performance.now();
let elapsed = 0;
function updateWorld(dt: number): void {
  elapsed += dt;

  if (cameraRotationElapsed < cameraRotationDuration) {
    cameraRotationElapsed = Math.min(cameraRotationDuration, cameraRotationElapsed + dt);
    const progress = cameraRotationElapsed / cameraRotationDuration;
    const eased = progress * progress * (3 - 2 * progress);
    camera.alpha = cameraRotationStartAlpha + (cameraTargetAlpha - cameraRotationStartAlpha) * eased;
  } else {
    camera.alpha = cameraTargetAlpha;
  }
  const zoomDifference = cameraTargetRadius - camera.radius;
  if (Math.abs(zoomDifference) < 0.005) camera.radius = cameraTargetRadius;
  else camera.radius += zoomDifference * Math.min(1, dt * 14);

  // Keyboard movement yields to the autopilot — it owns the player rig in sims.
  let horizontal = 0;
  let vertical = 0;
  if (!autopilotEnabled) {
    if (keys.has("w") || keys.has("arrowup")) vertical += 1;
    if (keys.has("s") || keys.has("arrowdown")) vertical -= 1;
    if (keys.has("a") || keys.has("arrowleft")) horizontal -= 1;
    if (keys.has("d") || keys.has("arrowright")) horizontal += 1;
  }
  const moving = horizontal !== 0 || vertical !== 0;
  if (moving) {
    // Movement follows the current view: W is always visually upward.
    const forward = camera.getForwardRay().direction;
    forward.y = 0;
    forward.normalize();
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const direction = forward.scale(vertical).add(right.scale(horizontal)).normalize();
    player.root.position.addInPlace(direction.scale(dt * 3.25));
    player.root.position.x = Math.max(-5.5, Math.min(5.5, player.root.position.x));
    player.root.position.z = Math.max(-7.4, Math.min(8.1, player.root.position.z));
  }

  if (!autopilotEnabled && pointerAim) {
    const aim = pointerAim.subtract(player.root.position);
    if (aim.lengthSquared() > 0.04) {
      player.root.rotation.y = turnTowards(player.root.rotation.y, Math.atan2(aim.x, aim.z) + Math.PI, Math.min(1, dt * 14));
    }
  }

  const desiredCameraTarget = player.root.position.add(new Vector3(0, 0.7, 0));
  camera.target.copyFrom(Vector3.Lerp(camera.target, desiredCameraTarget, Math.min(1, dt * 8)));

  const stride = moving ? Math.sin(elapsed * 11) * 0.55 : 0;
  player.leftLeg.rotation.x = stride;
  player.rightLeg.rotation.x = -stride;
  player.leftArm.rotation.x = -stride * 0.7;
  player.rightArm.rotation.x = stride * 0.7;
  player.torso.position.y = 1 + (moving ? Math.abs(Math.sin(elapsed * 11)) * 0.05 : Math.sin(elapsed * 2) * 0.012);
  player.head.position.y = 1.72 + (moving ? Math.abs(Math.sin(elapsed * 11)) * 0.035 : 0);
  if (actionAnimation > 0) {
    actionAnimation = Math.max(0, actionAnimation - dt);
    const strike = Math.sin((1 - actionAnimation) * Math.PI * 8);
    player.rightArm.rotation.x = -1.2 + strike * 0.55;
    player.torso.rotation.z = strike * 0.04;
  } else {
    player.torso.rotation.z = 0;
  }

  // Plants stay calm enough not to compete with active stations. Each fruit
  // carries its own phase and growth state, so harvesting and ripening remain
  // legible events rather than one animation applied to the whole plot.
  for (const plant of tomatoPlants) {
    plant.root.rotation.z = Math.sin(elapsed * 0.85 + plant.phase) * 0.018;
    plant.root.rotation.x = Math.cos(elapsed * 0.7 + plant.phase) * 0.012;
  }
  for (const { rig, swayOffset } of cabbageHeads) {
    animateCabbageRig(rig, elapsed + swayOffset);
  }
  for (const plant of wheatPlants) {
    animateWheatPlant(plant, elapsed);
  }
  for (const fruit of tomatoFruits) {
    const previousGrowth = fruit.growth;
    if (!freezeGrowth) {
      if (fruit.growth < 0) fruit.growth = Math.min(0, fruit.growth + dt);
      else if (fruit.growth < 1) fruit.growth = Math.min(1, fruit.growth + dt / regrowSeconds);
    }
    const visibleGrowth = Math.max(0.001, fruit.growth);
    const growthEase = visibleGrowth < 1
      ? 1 - Math.pow(1 - visibleGrowth, 3) + Math.sin(visibleGrowth * Math.PI) * 0.09
      : 1;
    const bounce = fruit.growth >= 1 ? 1 + Math.sin(elapsed * 1.75 + fruit.phase) * 0.018 : 1;
    fruit.mesh.scaling.setAll(fruit.baseScale * growthEase * bounce);
    fruit.mesh.position.copyFrom(fruit.basePosition);
    fruit.mesh.position.y += fruit.growth >= 1 ? Math.sin(elapsed * 1.75 + fruit.phase) * 0.012 : 0;
    if (previousGrowth < 1 && fruit.growth >= 1) {
      burst(fruit.mesh.getAbsolutePosition().add(new Vector3(0, 0.08, 0)), palette.ready, 5);
      fruit.sparkleIn = 12 + Math.random() * 14;
    }
    if (fruit.growth >= 1) {
      fruit.sparkleIn -= dt;
      if (fruit.sparkleIn <= 0) {
        burst(fruit.mesh.getAbsolutePosition().add(new Vector3(0, 0.08, 0)), palette.tomato, 1);
        fruit.sparkleIn = 14 + Math.random() * 18;
      }
    }
  }

  // Stove: free-form cooking at real catalog pacing. Amber while working,
  // green pulse when the pot is ready to collect.
  if (stoveCooking) {
    cooking += dt;
    stoveLight.setEnabled(true);
    stoveLight.material = palette.amber;
    stoveLight.scaling.setAll(0.85 + Math.sin(elapsed * 4) * 0.15);
    spoonPivot.rotation.y += dt * 5;
    potRoot.scaling.y = 1 + Math.sin(elapsed * 6) * 0.025;
    if (Math.floor(elapsed * 5) % 5 === 0 && burstCubes.length < 12) {
      burst(stoveRoot.position.add(new Vector3((Math.random() - 0.5) * 0.3, 1.85, (Math.random() - 0.5) * 0.2)), palette.cream, 1);
    }
    if (cooking >= cookSeconds) {
      stoveCooking = false;
      stoveReady = true;
      stoveLight.material = palette.ready;
      telemetry.record(shift.day, "cook_done", {});
      burst(stoveRoot.position.add(new Vector3(0, 1.8, 0)), palette.ready, 6);
    }
  } else if (stoveReady) {
    stoveLight.setEnabled(true);
    stoveLight.material = palette.ready;
    stoveLight.scaling.setAll(0.9 + Math.max(0, Math.sin(elapsed * 7)) * 0.25);
  } else {
    stoveLight.setEnabled(false);
  }

  // Day-cycle timers. Transitions surface in the HUD the moment they happen;
  // a dinner clock that runs out closes the day even mid-bite.
  const waitingBefore = new Set(waitingTickets(shift).map((ticket) => ticket.id));
  const previousPhase = shift.phase;
  shift = tickShift(shift, dt);
  if (shift.phase !== previousPhase) telemetry.record(shift.day, "phase", { from: previousPhase, to: shift.phase });
  if (shift.phase === "choose_menu" && previousPhase === "prep") enterMenuPhase();
  if (shift.phase === "close" && previousPhase !== "close") enterClose();
  telemetry.tick(dt);
  if (shift.phase === "prep" || shift.phase === "dinner") updatePhaseClock();
  if (shift.phase === "dinner") dinnerElapsed += dt;
  if (menuCardLamp.isEnabled()) menuCardLamp.scaling.setAll(1 + Math.sin(elapsed * 5) * 0.06);

  // Walkouts: tickets the domain just missed send their guests home.
  for (const ticket of shift.tickets) {
    if (ticket.status === "missed" && waitingBefore.has(ticket.id)) {
      const guest = guests.find((candidate) => candidate.ticketId === ticket.id);
      if (guest) guestLeaves(guest);
      telemetry.record(shift.day, "walkout", { ticketId: ticket.id, waitSeconds: Number(ticket.waitedSeconds.toFixed(1)) });
      burst(passRoot.position.add(new Vector3(0, 1.7, -0.44)), palette.blocked, 5);
    }
  }
  syncTicketViews();
  updateTicketWedges();

  // Guests arrive through the door to free, clean seats on a pacing interval;
  // the evening's demand is finite so "almost keep up" stays honest.
  if (shift.phase === "dinner") {
    nextGuestIn -= dt;
    if (nextGuestIn <= 0 && guestsSpawnedThisDinner < guestsPerDinner) {
      const openSeats = tables
        .filter((table) => !table.dirty)
        .flatMap((table) => table.seats.map((seat, index) => ({ table, index, seat })))
        .filter((entry) => entry.seat.guest === null);
      if (openSeats.length > 0) {
        const chosen = openSeats[Math.floor(Math.random() * openSeats.length)]!;
        if (spawnGuest(true, chosen.table, chosen.index)) guestsSpawnedThisDinner++;
      }
      nextGuestIn = 8 + Math.random() * 3;
    }
  }

  // Guest behavior: walk in, wait (patience lives in the domain), eat, leave.
  for (const guest of [...guests]) {
    if (guest.state === "arriving" && guest.seat) {
      const seatPosition = guest.seat.table.seats[guest.seat.index]!.position;
      const arrived = walkTowards(guest.person.root, seatPosition, dt, 2.6);
      animateWalk(guest.person, !arrived);
      if (arrived) seatGuestAtTable(guest);
    } else if (guest.state === "waiting") {
      // Quiet idle bob: alive without competing with urgent objects.
      guest.person.torso.position.y = 1 + Math.sin(elapsed * 2 + guest.ticketId) * 0.015;
    }
    if (guest.bubble.isEnabled()) {
      // The bubble is semantic, not physical: it always presents its dish
      // picture to the camera however the player rotates.
      const guestPosition = guest.person.root.position;
      guest.bubble.rotation.y = Math.atan2(guestPosition.x - camera.position.x, guestPosition.z - camera.position.z);
    } else if (guest.state === "eating") {
      guest.stateTimer += dt;
      guest.person.rightArm.rotation.x = -0.8 + Math.sin(elapsed * 6) * 0.35;
      if (guest.stateTimer >= 4.5) {
        guest.tableDish?.dispose(false, false);
        guest.tableDish = null;
        guest.seat!.table.grime.forEach((mesh) => mesh.setEnabled(true));
        guest.seat!.table.dirty = true;
        guestLeaves(guest);
      }
    } else if (guest.state === "leaving") {
      const gone = walkTowards(guest.person.root, guestSpawnPoint, dt, 2.2);
      animateWalk(guest.person, !gone);
      if (gone) disposeGuest(guest);
    }
  }

  updateServer(dt);

  // The interaction cue follows the resolved action, not a fixed stage target.
  const action = bestPlayerAction();
  actionCue.setEnabled(action !== null);
  if (action) {
    actionCue.position.copyFrom(action.position);
    actionCue.position.y = 0.34;
    const footprint = action.kind === "stock" || action.kind === "take_serving" || action.kind === "menu_quantity" ? 4.8
      : action.kind === "harvest" ? 3.6
      : 2.4;
    actionCue.scaling.set(footprint / 2.4, 0.85 + Math.sin(elapsed * 4) * 0.15, footprint / 2.4);
  }

  for (let index = burstCubes.length - 1; index >= 0; index--) {
    const particle = burstCubes[index]!;
    particle.life -= dt;
    particle.velocity.y -= dt * 3.8;
    particle.mesh.position.addInPlace(particle.velocity.scale(dt));
    particle.mesh.rotation.x += dt * 5;
    particle.mesh.rotation.z += dt * 4;
    particle.mesh.scaling.setAll(Math.max(0.01, Math.min(1, particle.life * 2)));
    if (particle.life <= 0) {
      particle.mesh.dispose();
      burstCubes.splice(index, 1);
    }
  }

  updateAutopilot(dt);
  actionEl.classList.toggle("show", bestPlayerAction() !== null || shift.phase === "close");
}

const simSpeed = Math.max(1, Math.round(captureNumber("simSpeed") || 1));
const noRender = captureParams.has("noRender");
let framesRendered = 0;
let contextLost = false;
engine.onContextLostObservable.add(() => { contextLost = true; });
engine.runRenderLoop(() => {
  framesRendered++;
  const now = performance.now();
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  for (let step = 0; step < simSpeed; step++) updateWorld(dt);
  decor.update(dt);
  decorate.update(dt);
  decorateLaunch.classList.toggle("active", decorate.active);
  if (!noRender) scene.render();
});

window.addEventListener("resize", () => engine.resize());
updateHud();

// Render watchdog: if nothing has drawn within 2.5 s (WebGL blocked, context
// lost, GPU blocklisted), say so on screen instead of failing silently.
if (!noRender) {
  window.setTimeout(() => {
    if (framesRendered === 0 || contextLost) {
      const warn = document.querySelector<HTMLElement>("#slice-renderwarn")!;
      warn.hidden = false;
      warn.textContent = contextLost
        ? "⚠ 3D not rendering — WebGL context lost. Hard refresh (Cmd+Shift+R); if it repeats, check chrome://gpu"
        : `⚠ 3D not rendering — no frames drawn (${framesRendered}). Hard refresh (Cmd+Shift+R); if it repeats, check chrome://gpu`;
    }
  }, 2500);
}
