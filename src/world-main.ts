// The compound: the whole site plan, built from data and walkable.
//
// This page is deliberately gameplay-free. The shift loop, guests and tickets still live in index.html
// on the old hard-coded slice; here we lay out and dress the real restaurant — rooms, walls, doors,
// ground — and prove it holds up at full size before any of that moves across.
//
// URL: /world.html?progress=start|full&hour=19.5
import "./world.css";
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Matrix,
  Mesh, MeshBuilder, Plane, Scene, SceneInstrumentation, ShadowGenerator, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import { catalog, catalogIndex, ensureModels } from "./assets/catalog/index";
import { decorLayout, levelLayout, levelProgress, onLevelChanged } from "./assets/scene/index";
import { createDecorScene } from "./game/decor";
import { createLevelBuilder, ROOM_FLOOR_Y } from "./game/levelBuilder";
import { createFrameTimer } from "./game/frameTimer";
import { createCutaway } from "./game/cutaway";
import { fullProgress, roomAt, validateLevelLayout, type LevelProgress } from "./game/levelLayout";
import { attachGlow, createLightPool } from "./game/lighting";
import { createParticleWorld } from "./game/voxelParticles";
import { cellsFromAuthoredModel } from "./game/voxelModel";
import { createVoxelMesh } from "./game/voxelGeometry";
import { collidersOfMeshes, createColliderField } from "./game/gravity";
import { createDayNight } from "./game/dayNight";
import { cropDefinitions } from "./game/crops";
import { createFarm } from "./game/farmPlots";
import { createPrepStation, PREP_MODEL } from "./game/prepStation";
import { BED_MODEL } from "./game/soilPatches";
import { createClipPlayer, createVoxelRig, socketNode } from "./game/voxelRig";

/** The player's own model, and the tools he carries. */
const FARMER_MODEL = "farmer";
const TOOL_MODELS_PRELOAD = { hoe: "tool_hoe", can: "tool_can", pouch: "tool_pouch" };
import { recipes } from "./game/recipes";
import { FARM_SAVE_KEY, FARM_SAVE_VERSION, type FarmSave } from "./game/farm";
import { readSave, writeSave } from "./game/persistence";
import { createFarmHud } from "./farm-hud";
import { dominantColor } from "./game/cropPlanting";
import { createBuildMode } from "./buildMode";
import { runStages, type LoadingStage } from "./game/loading";
import { createSurfaceCrustLayer } from "./game/surfaceRing";
import { createGrassInstances } from "./game/grassInstances";
import { createWindMaterial } from "./game/voxelWind";
import { sourceCacheKey, warmSourceCache } from "./game/sourceCache";
import { warmRigCache } from "./game/voxelRig.ts";

const params = new URLSearchParams(window.location.search);
const startingProgress = params.get("progress") === "start";

document.querySelector<HTMLElement>("#world")!.innerHTML = `
  <canvas id="world-canvas"></canvas>
  <div class="world-hud">
    <div class="world-title">🍅 Compound <a href="/">← game</a><a href="/model-lab.html">model lab</a>
      <span class="world-room" id="world-room">outside</span><span class="world-clock" id="world-clock">☀ 07:00</span></div>
    <div class="world-stats" id="world-stats">building…</div>
    <div class="world-controls">
      <button data-act="progress" id="world-progress" title="Switch between the plan at full build-out and what the player owns at the start">🏗 ${startingProgress ? "Starting plot" : "Full build-out"}</button>
      <button data-act="cutaway" class="on" id="world-cutaway" title="Drop the walls standing between the camera and the room you are in">🔪 Cutaway</button>
      <span class="world-sep"></span>
      <button data-act="build" id="world-build" title="Draw rooms, walls, doors and ground (B)">🏗 Build mode</button>
      <button data-act="relief" id="world-relief" title="Lay the floors at each material's own cell size with real relief — board gaps cut a cell deep, every board and tile at its own height — instead of the coarse flat carpet. Measured on the whole compound: 11.7M cells and a 19.5 second build against 1.4M and 1.3 s, at the same 138 draw calls and 120 fps. The runtime is not the cost; the mesher and about 880 MB of transient cells are.">🪵 Floor relief</button>
      <button data-act="night" id="world-night" title="Jump the clock to evening">🌙 Evening</button>
      <button data-act="frame" title="Look at the whole site">🖼 Frame all</button>
    </div>
    <div class="world-hint">W A S D walk · Q / E turn the camera · F frames the site · wheel zooms · 1-9 or shift+wheel picks a tool · click the ground to work it · hold to sow or pick a row</div>
  </div>
  <div class="world-loading" id="world-loading">
    <h1>🍅 Building the compound</h1>
    <div class="world-load-track"><div class="world-load-fill" id="world-load-fill"></div></div>
    <div class="world-load-stage" id="world-load-stage">…</div>
    <div class="world-load-note">meshing the site from its plan — later this is also where light, navigation and surfaces get baked</div>
  </div>`;

const canvas = document.querySelector<HTMLCanvasElement>("#world-canvas")!;
const roomEl = document.querySelector<HTMLElement>("#world-room")!;
const statsEl = document.querySelector<HTMLElement>("#world-stats")!;
const clockEl = document.querySelector<HTMLElement>("#world-clock")!;

const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString("#a9c889ff");
const instrumentation = new SceneInstrumentation(scene);
instrumentation.captureFrameTime = true;
// Babylon's frameTime covers only what happens INSIDE scene.render(); interFrameTime covers the gap
// between renders, which is where every simulation call in the loop below actually lives.
instrumentation.captureInterFrameTime = true;
const frameTimer = createFrameTimer({ renderMs: () => instrumentation.frameTimeCounter.lastSecAverage });

const sun = new DirectionalLight("sun", new Vector3(-0.7, -1, 0.55), scene);
sun.position.set(20, 40, -20);
sun.intensity = 1.6;
const ambient = new HemisphericLight("ambient", new Vector3(0, 1, 0), scene);
ambient.intensity = 1.0;
ambient.diffuse = Color3.FromHexString("#fff2d2");
ambient.groundColor = Color3.FromHexString("#65755c");
const shadows = new ShadowGenerator(2048, sun);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = 16;

const glowLayer = attachGlow(scene, { intensity: 0.8 });
const lightPool = createLightPool(scene, { max: 6 });
const dayNight = createDayNight(scene, { sun, ambient, glow: glowLayer, lightPool }, { hour: 9 });
// URLSearchParams.get returns null when absent and Number(null) is 0, which would freeze the clock at midnight.
const hourParam = params.get("hour");
if (hourParam !== null && hourParam !== "" && Number.isFinite(Number(hourParam))) dayNight.freeze(Number(hourParam));

const colliders = createColliderField({ groundY: 0 });
const particles = createParticleWorld(scene, { colliders, shadows, capacity: 3000 , shapes: (id) => {
  // A particle can be any voxel model you authored in the lab: `shape: "model:<id>"`.
  const source = catalog.models[id];
  return source ? createVoxelMesh(`particle ${id}`, cellsFromAuthoredModel(source), source.pitch, scene) : null;
} });

// The player is a marker, not a character: the cutaway needs to know which room you are standing in.
const player = new TransformNode("player", scene);
player.position.set(0, ROOM_FLOOR_Y, -19.5);
// The farmer stands in for the player: a rigged voxel figure, built below once
// the catalog is loaded. Until then the player is still a node with a position,
// which is all the camera and the cutaway ever needed from it.

// The play range is deliberately tight: close enough to see a plant's fruit,
// and not so far out that the farm becomes a texture. Framing the whole site is
// a separate act (F), and it lifts the ceiling for as long as it lasts.
const PLAY_RADIUS = { min: 3.2, max: 34, start: 16 };
const SURVEY_RADIUS = 78;
const camera = new ArcRotateCamera("world camera", -Math.PI / 4, 0.92, PLAY_RADIUS.start, player.position.clone(), scene);
camera.fov = 0.62;
camera.lowerBetaLimit = 0.55;
camera.upperBetaLimit = 1.15;
camera.lowerRadiusLimit = PLAY_RADIUS.min;
camera.upperRadiusLimit = PLAY_RADIUS.max;
camera.inputs.clear();
scene.activeCamera = camera;

const problems = validateLevelLayout(levelLayout);
if (problems.length) console.warn(`[world] level plan has ${problems.length} problem(s):`, problems);

const level = createLevelBuilder(scene, levelLayout, { shadows });
level.root.parent = null;
let progress: LevelProgress = startingProgress ? levelProgress : fullProgress(levelLayout);
function applyProgress(): void {
  level.setProgress(progress);
  colliders.set("level", collidersOfMeshes(level.meshes()));
  crust?.clear();
  grass?.clear();
}

// Grass, pebbles and clods, grown only where the camera is. On the wind material — a pebble carries no
// sway weight, so it stands perfectly still while the blades beside it bend.
const crustMaterial = createWindMaterial("level crust", scene);
const crust = createSurfaceCrustLayer(scene, {
  surfaces: () => level.surfaces(),
  material: crustMaterial,
  parent: level.root,
});
// Every blade on the site as a GPU instance — full density everywhere, a handful of draw calls.
const grass = createGrassInstances(scene, {
  surfaces: () => level.surfaces(),
  material: crustMaterial,
  parent: level.root,
});

// ── loading and baking ────────────────────────────────────────────────────────
// The first build is the expensive one — 1.3 s flat, 12 s with floor relief — and it is only going to
// grow: navigation meshes, baked light and cached surface geometry are the same shape of work. So it runs
// as weighted stages that hand the frame back between pieces, and the bar actually moves.
const loadingEl = document.querySelector<HTMLElement>("#world-loading")!;
const loadFill = document.querySelector<HTMLElement>("#world-load-fill")!;
const loadStage = document.querySelector<HTMLElement>("#world-load-stage")!;

async function buildEverything(): Promise<void> {
  const stages: LoadingStage[] = [
    {
      name: "Meshing floors and walls",
      weight: 8,
      async run({ report, slice }) {
        let since = performance.now();
        await level.setProgressSliced(progress, async (done, total) => {
          report(done / total);
          // Yield on a time budget: level pieces differ enormously in size, so a fixed count would
          // either stall on the big ones or give the frame away pointlessly on the small ones.
          if (performance.now() - since >= 24) { await slice(); since = performance.now(); }
        });
      },
    },
    {
      name: "Working out what stands on what",
      weight: 1,
      run() { colliders.set("level", collidersOfMeshes(level.meshes())); },
    },
    {
      name: "Scattering stones and chips",
      weight: 2,
      async run({ slice }) { await crust.build(slice); },
    },
    {
      name: "Growing the grass",
      weight: 3,
      async run({ slice }) { await grass.build(slice); grass.update(player.position); },
    },
  ];
  const ms = await runStages(stages, ({ fraction, stage, index, total }) => {
    loadFill.style.width = `${(fraction * 100).toFixed(1)}%`;
    loadStage.textContent = `${stage} · ${index} of ${total}`;
  });
  loadStage.textContent = `ready in ${(ms / 1000).toFixed(1)} s`;
  // Kept in the DOM rather than removed: the relief toggle relays the whole level and wants it back.
  loadingEl.classList.add("gone");
}
void buildEverything();

/** Rebuild the level behind the loading overlay — used when the relief toggle changes every floor. */
async function relayLevel(title: string): Promise<void> {
  loadingEl.classList.remove("gone");
  loadStage.textContent = title;
  loadFill.style.width = "0%";
  await runStages([{
    name: title, weight: 1,
    async run({ report, slice }) {
      let since = performance.now();
      await level.setProgressSliced(progress, async (done, total) => {
        report(done / total);
        if (performance.now() - since >= 24) { await slice(); since = performance.now(); }
      });
      colliders.set("level", collidersOfMeshes(level.meshes()));
      await crust.build(slice);
      await grass.build(slice);
      grass.update(player.position);
    },
  }], ({ fraction }) => { loadFill.style.width = `${(fraction * 100).toFixed(1)}%`; });
  loadingEl.classList.add("gone");
}

const cutaway = createCutaway(scene, levelLayout, level, { target: () => ({ x: player.position.x, z: player.position.z }) });
let cutawayOn = true;

// Hand-placed props live in decor.json exactly as in the game, so decorate mode and the catalog
// browser work here unchanged once we start dressing rooms.
const cacheRev = (modelId: string): number | undefined => catalogIndex[modelId]?.rev;
const decorModels = [...new Set(decorLayout.props.map((prop) => prop.model))];
if (decorModels.length) {
  await warmSourceCache(decorModels.map((id) => sourceCacheKey(id, cacheRev(id), 0.02)));
  await ensureModels(decorModels);
  await warmRigCache(decorModels.map((id) => catalog.models[id]!).filter((model) => model?.clips?.length), scene, cacheRev);
}
const decor = createDecorScene(scene, catalog, decorLayout, { shadows, lightPool, cacheRev, colliders, particles });

// ── the farm ──────────────────────────────────────────────────────────────────
// Plots are derived from the plan's farm parcels, so buying land adds soil to
// sow without anybody editing a list. Every crop's three stages and its produce
// are loaded up front: a plot has to be sowable the moment the player reaches
// it, and a hitch while a model streams in would land exactly on the keypress.
const cropModels = [...new Set([
  ...cropDefinitions.flatMap((crop) => [...Object.values(crop.stages), ...(crop.produce ? [crop.produce] : [])]),
  ...recipes.map((recipe) => recipe.yields),
  "crate_harvest", PREP_MODEL, BED_MODEL, FARMER_MODEL, ...Object.values(TOOL_MODELS_PRELOAD),
])];
await ensureModels(cropModels);
const farmWind = createWindMaterial("farm wind", scene);
const farm = createFarm({
  scene, catalog, areas: levelLayout.areas, material: farmWind,
  shadows, particles, persist: true, parent: level.root,
});
// The kitchen end of the chain: one counter in the prep kitchen, where produce
// becomes a dish. It stands where a prep island would, against the room's south
// wall and a short walk from the farm gate.
const prepRoom = levelLayout.rooms.find((room) => room.id === "prep_kitchen");
const prepStation = prepRoom && catalog.models[PREP_MODEL]
  ? createPrepStation({
      scene, catalog, parent: level.root, shadows,
      position: new Vector3(prepRoom.rect[0] + prepRoom.rect[2] / 2, ROOM_FLOOR_Y, prepRoom.rect[1] + prepRoom.rect[3] / 2 + 1.2),
      spin: Math.PI,
    })
  : null;
// The counter's own state rides in the farm save, so one file holds the day.
prepStation?.restore((readSave<FarmSave>(FARM_SAVE_KEY, FARM_SAVE_VERSION)?.prep) ?? { ingredients: [], dish: null, working: null });
function saveEverything(): void {
  farm.save();
  const saved = readSave<FarmSave>(FARM_SAVE_KEY, FARM_SAVE_VERSION);
  if (saved && prepStation) writeSave<FarmSave>(FARM_SAVE_KEY, { ...saved, prep: prepStation.state() });
}

// ── the farmer ────────────────────────────────────────────────────────────────
// One rig, parented to the player node, with a clip per kind of work. The clips
// all plant their blow at the same fraction of their length, so the game fires
// dirt, water or chaff on one rule rather than six — and the action itself is
// applied to the world at that same moment, which is why a swing feels like it
// did something rather than announcing that something was done.
const farmerModel = catalog.models[FARMER_MODEL];
const farmer = farmerModel ? createVoxelRig(farmerModel, scene, { name: "farmer", shadows, cacheRevision: cacheRev(FARMER_MODEL) }) : null;
if (farmer) farmer.root.parent = player;
/** What the cue and the world change are waiting for: the blow itself. */
let pendingBlow: (() => void) | null = null;
const farmerClips = farmer
  ? createClipPlayer(farmer, {
      onEvent: (event) => {
        if (event.name !== "impact") return;
        const blow = pendingBlow;
        pendingBlow = null;
        blow?.();
      },
    })
  : null;
farmerClips?.play("idle", { loop: true });

// The tool in the hand. One mesh per tool, hung on the hand socket by its own
// grip marker: the pipeline recentres a model and stands it on its base, so
// "the grip is at the origin" stops being true the moment it is voxelised.
const TOOL_MODELS: Record<string, string> = { hoe: "tool_hoe", can: "tool_can", compost: "tool_pouch", mulch: "tool_pouch" };
const handNode = farmer ? socketNode(farmer, "arm_r", "tool") : null;
const heldTools = new Map<string, Mesh>();
function heldToolMesh(id: string): Mesh | null {
  const existing = heldTools.get(id);
  if (existing) return existing;
  const model = catalog.models[id];
  if (!model || !handNode) return null;
  const mesh = createVoxelMesh(`held ${id}`, cellsFromAuthoredModel(model), model.pitch, scene);
  mesh.parent = handNode;
  // Hang it by its grip: the marker's cell, in metres, is where the hand is.
  const grip = model.parts.map((part) => part.sockets?.grip).find(Boolean);
  if (grip) mesh.position.set(-grip[0] * model.pitch, -grip[1] * model.pitch, -grip[2] * model.pitch);
  mesh.isPickable = false;
  shadows.addShadowCaster(mesh);
  heldTools.set(id, mesh);
  return mesh;
}
function showHeldTool(): void {
  if (!handNode) return;
  const slot = farmHud.slot;
  const wanted = slot.kind === "tool" ? TOOL_MODELS[slot.tool] : "tool_pouch";
  for (const [id, mesh] of heldTools) mesh.setEnabled(id === wanted);
  if (wanted) heldToolMesh(wanted)?.setEnabled(true);
}

/** Which clip a piece of work looks like. */
const ACTION_CLIP: Record<string, string> = {
  till: "swing", clear: "swing", water: "pour", feed: "scatter", sow: "scatter", harvest: "pick",
};

const farmHud = createFarmHud(document.querySelector<HTMLElement>("#world")!);
showHeldTool();

// The plot under the player's hand, marked on the ground. A world marker rather
// than a floating label: the rulebook allows labels for selection, and this is
// the selection — the bar only says what the soil cannot.
const plotMarker = MeshBuilder.CreateTorus("plot marker", { diameter: 0.86, thickness: 0.05, tessellation: 20 }, scene);
const plotMarkerMaterial = new StandardMaterial("plot marker", scene);
plotMarkerMaterial.disableLighting = true;
plotMarkerMaterial.emissiveColor = Color3.FromHexString("#9fd78a");
plotMarkerMaterial.alpha = 0.7;
plotMarker.material = plotMarkerMaterial;
plotMarker.isPickable = false;
plotMarker.setEnabled(false);

// The ring takes the colour of the work: earth for tilling, water for watering,
// compost dark for feeding, green for sowing, gold for a ripe plant, grey when
// the key would do nothing here.
const MARKER_COLOURS: Record<string, string> = {
  till: "#c08a58", water: "#5b9fd6", feed: "#7d6b4a", sow: "#9fd78a",
  harvest: "#f3c55a", clear: "#d98b6b", nothing: "#6f8377",
};
/** Out of arm's reach: the plot is still named, but the ring says why not. */
const OUT_OF_REACH = "#b45a4a";

// Where the mouse is over the ground, in metres. The farm is flat, so this is a
// ray against one plane rather than a pick against the whole scene — cheaper,
// exact, and it still finds a plot standing under a plant.
let pointer: { x: number; y: number } | null = null;
const GROUND_PLANE = Plane.FromPositionAndNormal(new Vector3(0, 0.02, 0), Vector3.Up());
function groundUnderPointer(): { x: number; z: number } | null {
  if (!pointer) return null;
  const ray = scene.createPickingRay(pointer.x, pointer.y, Matrix.Identity(), camera);
  const distance = ray.intersectsPlane(GROUND_PLANE);
  if (distance === null || distance < 0) return null;
  const point = ray.origin.add(ray.direction.scale(distance));
  return { x: point.x, z: point.z };
}

let addressed: ReturnType<typeof farm.addressed> = null;
function refreshFarm(): void {
  // The mouse says which plot; the player's position says whether they can work
  // it. Pointing is how a farming game is played — walking up to a tile to
  // address it is how a walking simulator is played.
  const ground = groundUnderPointer();
  addressed = ground
    ? farm.at(ground.x, ground.z, farmHud.slot, player.position)
    : farm.addressed(player.position.x, player.position.z, farmHud.slot);
  const atCrate = Boolean(farm.crate?.inReach(player.position.x, player.position.z));
  const atPrep = prepStation?.inReach(player.position.x, player.position.z) ? prepStation : null;
  farmHud.render(addressed, farm.inventory, atCrate ? farm.crate!.contents.length : null,
    atPrep ? { dish: atPrep.dish, working: atPrep.working, board: atPrep.ingredients } : null);
  plotMarker.setEnabled(Boolean(addressed));
  if (!addressed) return;
  plotMarker.position.set(addressed.site.x, 0.06, addressed.site.z);
  plotMarkerMaterial.emissiveColor = Color3.FromHexString(
    !addressed.inReach ? OUT_OF_REACH : MARKER_COLOURS[addressed.action] ?? "#9fd78a");
}

// ── the feel of the work ──────────────────────────────────────────────────────
// Every action throws something in the air. This is not decoration: a hoe that
// makes no dirt fly reads as a key press, and a watering can that changes only a
// number reads as a menu. The cue is what tells the player the work happened,
// before they have even looked at the ground.
const CUE_SPECS: Record<string, { colours: string[]; count: number; speed: [number, number]; life: [number, number]; spread: number; gravity: number; size: number; up: number }> = {
  till:    { colours: ["#6f4f32", "#5a3f28", "#8a6540"], count: 14, speed: [1.1, 2.3], life: [0.5, 0.9], spread: 62, gravity: 1, size: 0.05, up: 0.10 },
  water:   { colours: ["#7fc4f0", "#a9dbf7", "#5b9fd6"], count: 12, speed: [0.5, 1.2], life: [0.4, 0.8], spread: 48, gravity: 1.4, size: 0.035, up: 0.85 },
  feed:    { colours: ["#4a3a27", "#6d5a3a", "#3c3324"], count: 10, speed: [0.5, 1.3], life: [0.5, 1.0], spread: 70, gravity: 1, size: 0.04, up: 0.55 },
  sow:     { colours: ["#c9b57a", "#e0d2a0"], count: 5, speed: [0.5, 1.0], life: [0.4, 0.7], spread: 55, gravity: 1, size: 0.03, up: 0.35 },
  harvest: { colours: ["#8fbf5a", "#c9dd8a"], count: 8, speed: [0.9, 1.8], life: [0.5, 0.9], spread: 65, gravity: 1, size: 0.045, up: 0.5 },
  clear:   { colours: ["#6f4f32", "#7d8a5a"], count: 8, speed: [0.8, 1.6], life: [0.4, 0.8], spread: 70, gravity: 1, size: 0.045, up: 0.3 },
};

function showFarmCue(result: { action: string; site: { x: number; z: number }; crop: string | null }): void {
  const spec = CUE_SPECS[result.action];
  if (!spec) return;
  // A harvested crop throws its OWN colour, so picking strawberries and picking
  // lettuce do not look like the same event.
  const produce = result.action === "harvest" && result.crop ? catalog.models[result.crop] : undefined;
  const colours = produce ? [dominantColor(produce), ...spec.colours] : spec.colours;
  particles.emitAt({
    id: `farm-${result.action}`, position: [0, 0, 0], colors: colours, size: spec.size,
    mode: "burst", count: spec.count, rate: spec.count, direction: [0, 1, 0], spread: spec.spread,
    speed: spec.speed, life: spec.life, gravity: spec.gravity, bounce: 0.15, friction: 0.6,
    stick: false, fade: true, spin: true,
  }, new Vector3(result.site.x, spec.up, result.site.z), Vector3.Up(), spec.size);
}

/** One key, whatever is under your hand: sow, harvest, clear — or, standing at
 *  the crate, tip in everything you are carrying. */
function actOnPlot(): void {
  if (build.active || busy()) return;
  // One key, whatever you are standing at. The counter comes first because it
  // is indoors and nothing else is ever within reach of it.
  if (prepStation?.inReach(player.position.x, player.position.z)) {
    const lifted = prepStation.take();
    if (lifted) {
      farm.give([lifted]);
    } else {
      const putDown = prepStation.put(farm.inventory);
      farm.remove(putDown);
      // Putting the last ingredient down starts the work in the same press:
      // walking up, setting three things out and then pressing again to begin
      // is a step the player never asked for.
      // Only sweep the board back when what is standing on it is of no use to
      // this counter at all. An earlier version swept whenever the key had
      // nothing else to do, which meant a board waiting for one more ingredient
      // emptied itself into the player's hands the moment they pressed again —
      // and the counter looked like it was refusing everything but the first
      // thing put down.
      const started = prepStation.start();
      if (!putDown.length && !started && prepStation.ingredients.length && prepStation.idle()) {
        farm.give(prepStation.clear());
      }
    }
    saveEverything();
    refreshFarm();
    return;
  }
  if (farm.crate?.inReach(player.position.x, player.position.z) && farm.inventory.length) {
    farm.unload();
    saveEverything();
    refreshFarm();
    return;
  }
  // Work out the plot at the moment of the keypress rather than trusting the
  // one cached for the HUD: that is refreshed a few times a second, and acting
  // the instant after stepping across a row would otherwise hit the plot just
  // left behind.
  refreshFarm();
  if (!addressed) return;
  if (!addressed.inReach) {
    // Stardew swings the tool and fails, which is the lesson: the player has to
    // move. Until there is a character to swing, the bar says it plainly.
    farmHud.flash("too far — walk closer");
    return;
  }
  const site = addressed.site;
  const slot = farmHud.slot;
  const action = addressed.action;
  if (action === "nothing") return;

  // Face the work. A farmer who tills the bed behind them is a farmer nobody
  // believes, and the turn costs one line.
  player.rotation.y = Math.atan2(site.x - player.position.x, site.z - player.position.z);

  const land = (): void => {
    const result = farm.act(site, slot);
    if (!result) return;
    showFarmCue(result);
    if (result.items && result.crop) {
      floatGain(`+${result.items} ${catalog.models[result.crop]?.name ?? "crop"}`, result.site);
    }
    saveEverything();
    refreshFarm();
  };

  const clip = ACTION_CLIP[action];
  if (farmerClips && clip) {
    working = { site, colour: WORK_COLOURS[action] ?? "#9fd78a" };
    // The work lands on the blow, not on the key press: the swing is the event.
    pendingBlow = land;
    // From the beginning, always. The player matches the pose it is leaving by
    // default, which is right for walk-to-idle and wrong for a swing: it started
    // the clip PAST its impact, so the ground broke before the hoe moved.
    farmerClips.play(clip, { loop: false, from: 0, blend: 0.08 });
  } else {
    land();
  }
}

/** A "+3 Strawberry" that rises off the plot and fades. Small, and the reason
 *  picking a field never gets old: every pick pays out visibly. */
function floatGain(text: string, at: { x: number; z: number }): void {
  const screen = Vector3.Project(
    new Vector3(at.x, 0.5, at.z),
    Matrix.Identity(),
    scene.getTransformMatrix(),
    camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
  );
  farmHud.gain(text, screen.x, screen.y);
}

// ── mouse: point at a plot, click to work it ──────────────────────────────────
// Measured against the canvas rather than read from offsetX: offset is relative
// to whatever element the event happened to land on, and it is absent entirely
// on a synthesised event, which made the farm think the mouse was in the corner.
canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
});
canvas.addEventListener("pointerleave", () => { pointer = null; });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

/** Held buttons repeat, so planting a row is a drag rather than forty clicks —
 *  the single biggest quality-of-life difference between an hour of farming and
 *  a chore. The repeat re-reads the plot under the mouse every time, so walking
 *  while holding works the row the player walks along. */
const REPEAT_SECONDS = 0.18;
let heldButton: number | null = null;
let repeatIn = 0;
canvas.addEventListener("pointerdown", (event) => {
  if (build.active || event.button > 2) return;
  heldButton = event.button;
  repeatIn = REPEAT_SECONDS * 1.6;   // the first repeat waits a little longer
  refreshFarm();
  actOnPlot();
});
const releasePointer = (): void => { heldButton = null; };
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointerleave", releasePointer);
window.addEventListener("blur", releasePointer);

function tickHeldPointer(dt: number): void {
  if (heldButton === null || build.active) return;
  repeatIn -= dt;
  if (repeatIn > 0) return;
  repeatIn = REPEAT_SECONDS;
  refreshFarm();
  // A held button only repeats work that is safe to repeat: sowing and picking
  // down a row. Repeating a hoe would turn a slipped click into a ploughed field.
  if (addressed?.inReach && (addressed.action === "sow" || addressed.action === "harvest")) actOnPlot();
}
window.addEventListener("beforeunload", () => saveEverything());

// A level save from the build editor swaps the plan under us; rebuild without reloading the page.
onLevelChanged(() => {
  if (!startingProgress) progress = fullProgress(levelLayout);
  applyProgress();
});

// Build mode edits the plan in place, so a new room appears the moment it is drawn.
const build = createBuildMode({
  scene, canvas, layout: levelLayout, camera: () => camera, mount: document.querySelector<HTMLElement>("#world")!,
  onChanged: () => {
    if (!startingProgress) progress = fullProgress(levelLayout);
    applyProgress();
  },
});

const keys = new Set<string>();
window.addEventListener("keydown", (event) => {
  const typing = (event.target as HTMLElement | null)?.tagName === "INPUT";
  if (typing) return;
  const key = event.key.toLowerCase();
  keys.add(key);
  // Build mode keeps the camera: you often want to paint a wall from two sides.
  if (key === "q") turnCamera(-1);
  if (key === "e") turnCamera(1);
  if (key === "f") frameSite();
  if (key === "b" && !event.repeat) { build.toggle(); keys.clear(); requestAnimationFrame(syncBuildButton); }
  // The farm: one key does the work, the digits pick what goes in the ground.
  if (key === " " && !event.repeat) { event.preventDefault(); actOnPlot(); }
  if (key >= "1" && key <= "9") { farmHud.select(Number(key) - 1); showHeldTool(); }
  if (key === "tab") { event.preventDefault(); farmHud.cycle(event.shiftKey ? -1 : 1); showHeldTool(); }
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  // The wheel zooms. Stardew puts the hotbar on it, and this did too for about
  // an hour, but this game's camera is a thing the player moves constantly and
  // the tool is not: zooming is the gesture that wants the wheel. Shift+wheel
  // picks the tool, and 1-9 and tab do it without leaving the keyboard.
  if (event.shiftKey) { farmHud.cycle(Math.sign(event.deltaY)); showHeldTool(); return; }
  targetRadius = Math.min(camera.upperRadiusLimit ?? PLAY_RADIUS.max, Math.max(camera.lowerRadiusLimit ?? PLAY_RADIUS.min, targetRadius * (1 + Math.sign(event.deltaY) * 0.12)));
  if (targetRadius <= PLAY_RADIUS.max) camera.upperRadiusLimit = PLAY_RADIUS.max;
}, { passive: false });

let targetAlpha = camera.alpha;
let targetRadius = camera.radius;
function turnCamera(direction: number): void { targetAlpha += (direction * Math.PI) / 4; }
function frameSite(): void {
  const site = levelLayout.areas.find((area) => area.id === "site_grounds");
  if (!site) return;
  camera.target.set(site.rect[0] + site.rect[2] / 2, 0, site.rect[1] + site.rect[3] / 2);
  // Surveying needs the whole compound in frame, which is further out than play
  // allows; the ceiling comes back down as soon as the player zooms back in.
  camera.upperRadiusLimit = SURVEY_RADIUS;
  targetRadius = SURVEY_RADIUS;
}
let framed = false;

document.querySelector(".world-controls")!.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-act]");
  if (!button) return;
  switch (button.dataset.act) {
    case "progress": {
      const full = progress.rooms.length > 0;
      progress = full ? levelProgress : fullProgress(levelLayout);
      button.textContent = `🏗 ${full ? "Starting plot" : "Full build-out"}`;
      applyProgress();
      break;
    }
    case "relief": {
      const on = !level.surfaceDetail;
      button.classList.toggle("on", on);
      button.textContent = on ? "🪵 Relief on…" : "🪵 Floor relief";
      level.setSurfaceDetail(on);
      void relayLevel(on ? "Laying floors with relief" : "Laying the flat carpet").then(() => {
        button.textContent = "🪵 Floor relief";
      });
      break;
    }
    case "cutaway":
      cutawayOn = !cutawayOn;
      button.classList.toggle("on", cutawayOn);
      if (!cutawayOn) for (const built of level.walls.values()) { built.mesh.visibility = 1; built.mesh.isVisible = true; }
      break;
    case "build": build.toggle(); requestAnimationFrame(syncBuildButton); break;
    case "night": dayNight.setHour(dayNight.hour > 12 && dayNight.hour < 22 ? 9 : 19.5); break;
    case "frame": frameSite(); framed = true; break;
  }
});

function syncBuildButton(): void {
  document.querySelector<HTMLElement>("#world-build")?.classList.toggle("on", build.active);
  // Leaving build mode hands the camera back to the player.
  if (!build.active) framed = false;
}

const speed = 4.5;
function walk(dt: number): void {
  // Movement follows the view, exactly as in the game scene: W is always up the screen.
  let horizontal = 0, vertical = 0;
  if (keys.has("w") || keys.has("arrowup")) vertical += 1;
  if (keys.has("s") || keys.has("arrowdown")) vertical -= 1;
  if (keys.has("a") || keys.has("arrowleft")) horizontal -= 1;
  if (keys.has("d") || keys.has("arrowright")) horizontal += 1;
  if (horizontal === 0 && vertical === 0) return;
  // A swing is a commitment. Walking out of your own hoe stroke is what makes a
  // farming game feel like a spreadsheet with legs.
  if (busy()) return;
  const forward = camera.getForwardRay().direction;
  forward.y = 0;
  forward.normalize();
  const right = Vector3.Cross(Vector3.Up(), forward).normalize();
  const move = forward.scale(vertical).add(right.scale(horizontal)).normalize().scaleInPlace(speed * dt * (keys.has("shift") ? 2.4 : 1));
  if (build.active) {
    // While building, the same keys slide the view across the site instead of walking the marker.
    camera.target.addInPlace(move.scale(2.2));
    framed = true;
    return;
  }
  player.position.addInPlace(move);
  player.rotation.y = Math.atan2(move.x, move.z);
  walking = true;
  // Step up onto a floor slab, or back down to the ground.
  const room = roomAt(levelLayout, player.position.x, player.position.z);
  player.position.y = room ? ROOM_FLOOR_Y : 0.02;
  framed = false;
}

/** Set by walk() each frame it actually moved the player. */
let walking = false;
/** The plot being worked and what the work looks like, while a clip runs. */
let working: { site: { x: number; z: number }; colour: string } | null = null;

/** Colour of the filling bar, by the work being done. */
const WORK_COLOURS: Record<string, string> = {
  till: "#c08a58", water: "#5b9fd6", feed: "#7d6b4a", sow: "#9fd78a", harvest: "#f3c55a", clear: "#d98b6b",
};

/** True while the farmer is committed to a swing, a pour or a pick. */
function busy(): boolean {
  return Boolean(farmerClips?.playing && farmerClips.clip && farmerClips.clip.loop !== true);
}

/** Idle, walking, or working — the rig's own little state machine. A work clip
 *  owns the body until it finishes, so a step mid-swing does not cut the swing. */
function driveFarmer(dt: number): void {
  if (!farmerClips) return;
  if (working && busy() && farmerClips.clip) {
    const fraction = farmerClips.time / Math.max(1e-3, farmerClips.clip.duration);
    const screen = Vector3.Project(
      new Vector3(working.site.x, 0.85, working.site.z), Matrix.Identity(), scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    farmHud.progress(fraction, working.colour, screen.x, screen.y);
  } else if (working) {
    working = null;
    farmHud.progress(1, "#fff", 0, 0);
  }
  if (!busy()) {
    const wanted = walking ? "walk" : "idle";
    if (farmerClips.clip?.id !== wanted || !farmerClips.playing) farmerClips.play(wanted, { loop: true });
  }
  farmerClips.update(dt);
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
let hudWindow = performance.now();
let farmWindow = performance.now();
let rigTest: Awaited<ReturnType<typeof import("./rig-test.ts").mountRigTest>> | undefined;
let cropTest: Awaited<ReturnType<typeof import("./crop-test.ts").mountCropTest>> | undefined;
function updateHud(): void {
  const stats = level.stats();
  const crustStats = crust.stats();
  const grassStats = grass.stats();
  const decorStats = decor.renderer.stats();
  const roomId = cutaway.room();
  const room = roomId ? levelLayout.rooms.find((candidate) => candidate.id === roomId) : null;
  roomEl.textContent = room ? room.name : "outside";
  const frame = frameTimer.stats();
  // sim and render are shown apart on purpose: for most of this project's life only the second was
  // being measured, and the first is where the props, clips and particles actually cost anything.
  statsEl.innerHTML = `<b>${frame.fps.toFixed(0)} fps</b> · sim ${frame.simMs.toFixed(1)} + render ${frame.renderMs.toFixed(1)} ms`
    + ` · gap min ${frame.minGapMs.toFixed(1)} / p99 ${frame.p99GapMs.toFixed(1)} ms`
    + (frame.longTasks ? ` · <b>${frame.longTasks} long tasks</b> (worst ${frame.longestTaskMs.toFixed(0)} ms)` : "")
    + ` · draw calls ${fmt(instrumentation.drawCallsCounter.current)}`
    + ` · level: ${stats.floors} floors, ${stats.walls} walls, ${fmt(stats.triangles)} triangles, built in ${fmt(stats.buildMs)} ms`
    + (crustStats.meshes ? ` · stones ${fmt(crustStats.triangles)} tris in ${crustStats.meshes}` : "")
    + (grassStats.blades ? ` · grass ${fmt(grassStats.blades)} blades / ${fmt(grassStats.tufts)} tufts, ${fmt(grassStats.triangles)} tris, ${grassStats.near} near + ${grassStats.far} far` : "")
    + ` · walls down ${cutaway.down().length}`
    + (decorStats.instances ? ` · props ${fmt(decorStats.instances)}` : "");
  clockEl.textContent = `${dayNight.hour >= 6.5 && dayNight.hour < 20 ? "☀" : "🌙"} ${dayNight.label()}`;
}

engine.runRenderLoop(() => {
  const dt = frameTimer.begin();
  walking = false;
  walk(dt);
  driveFarmer(dt);
  camera.alpha += (targetAlpha - camera.alpha) * Math.min(1, dt * 8);
  camera.radius += (targetRadius - camera.radius) * Math.min(1, dt * 8);
  if (!framed && !build.active) {
    const wanted = player.position.add(new Vector3(0, 0.8, 0));
    camera.target.addInPlace(wanted.subtract(camera.target).scale(Math.min(1, dt * 8)));
  }
  grass.update(player.position);
  if (cutawayOn) cutaway.update(dt);
  decor.update(dt);
  farm.update(dt, player.position);
  tickHeldPointer(dt);
  prepStation?.update(dt);
  rigTest?.update(dt);
  cropTest?.update(dt);
  particles.update(dt);
  dayNight.update(dt);
  // Everything above this line is the simulation half, and none of it is in Babylon's frameTime.
  frameTimer.simDone();
  scene.render();
  frameTimer.end();
  if (performance.now() - hudWindow >= 500) { hudWindow = performance.now(); updateHud(); }
  if (performance.now() - farmWindow >= 150) { farmWindow = performance.now(); refreshFarm(); }
});
window.addEventListener("resize", () => engine.resize());

Object.assign(window as unknown as Record<string, unknown>, {
  __world: { scene, camera, player, level, cutaway, decor, particles, colliders, dayNight, build, layout: levelLayout, turn: turnCamera,
    farm, prepStation, act: actOnPlot,
    catalog, ensureModels, decorLayout, setProgress: (next: LevelProgress) => { progress = next; applyProgress(); } },
});

if (params.get("cropTest") === "1") {
  void import("./crop-test.ts").then(({ mountCropTest }) =>
    mountCropTest(scene, player.position.add(new Vector3(1.5, 0, 0)), shadows))
    .then((fixture) => { cropTest = fixture; Object.assign(window, { __cropTest: fixture }); })
    .catch((error) => console.error("Crop test failed", error));
}

if (params.get("rigTest") === "1") {
  void import("./rig-test.ts").then(({ mountRigTest }) => mountRigTest(scene, player, { shadows, lightPool, colliders, particles }, () => {
    framed = false;
    targetRadius = 10;
  })).then((fixture) => {
    rigTest = fixture;
    Object.assign(window, { __rigTest: fixture });
  }).catch((error) => console.error("Rig test failed", error));
}
