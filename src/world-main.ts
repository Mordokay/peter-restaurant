// The compound: the whole site plan, built from data and walkable.
//
// This page is deliberately gameplay-free. The shift loop, guests and tickets still live in index.html
// on the old hard-coded slice; here we lay out and dress the real restaurant — rooms, walls, doors,
// ground — and prove it holds up at full size before any of that moves across.
//
// URL: /world.html?progress=start|full&hour=19.5
import "./world.css";
import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight,
  MeshBuilder, Scene, SceneInstrumentation, ShadowGenerator, StandardMaterial, TransformNode, Vector3,
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
import { recipes } from "./game/recipes";
import { FARM_SAVE_KEY, FARM_SAVE_VERSION, type FarmSave } from "./game/farm";
import { readSave, writeSave } from "./game/persistence";
import { createFarmHud } from "./farm-hud";
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
    <div class="world-hint">W A S D walk · Q / E turn the camera · wheel zooms · F frames the site · 1-5 pick a seed · space sows and harvests</div>
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
const playerMaterial = new StandardMaterial("player", scene);
playerMaterial.diffuseColor = Color3.FromHexString("#4e7968");
playerMaterial.specularColor.set(0.05, 0.05, 0.05);
const playerBody = MeshBuilder.CreateBox("player body", { width: 0.5, height: 1.1, depth: 0.4 }, scene);
playerBody.material = playerMaterial;
playerBody.parent = player;
playerBody.position.y = 0.55;
shadows.addShadowCaster(playerBody);
const playerHead = MeshBuilder.CreateBox("player head", { width: 0.44, height: 0.42, depth: 0.42 }, scene);
const headMaterial = new StandardMaterial("player head", scene);
headMaterial.diffuseColor = Color3.FromHexString("#d99c6b");
headMaterial.specularColor.set(0.05, 0.05, 0.05);
playerHead.material = headMaterial;
playerHead.parent = player;
playerHead.position.y = 1.32;
shadows.addShadowCaster(playerHead);

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
  "crate_harvest", PREP_MODEL,
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

const farmHud = createFarmHud(document.querySelector<HTMLElement>("#world")!);

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

const MARKER_COLOURS: Record<string, string> = { sow: "#9fd78a", harvest: "#f3c55a", clear: "#d98b6b", growing: "#6f8377" };
let addressed: ReturnType<typeof farm.addressed> = null;
function refreshFarm(): void {
  addressed = farm.addressed(player.position.x, player.position.z);
  const atCrate = Boolean(farm.crate?.inReach(player.position.x, player.position.z));
  const atPrep = prepStation?.inReach(player.position.x, player.position.z) ? prepStation : null;
  farmHud.render(addressed, farm.inventory, atCrate ? farm.crate!.contents.length : null,
    atPrep ? { dish: atPrep.dish, working: atPrep.working, board: atPrep.ingredients } : null);
  plotMarker.setEnabled(Boolean(addressed));
  if (!addressed) return;
  plotMarker.position.set(addressed.site.x, 0.06, addressed.site.z);
  plotMarkerMaterial.emissiveColor = Color3.FromHexString(MARKER_COLOURS[addressed.action] ?? "#9fd78a");
}

/** One key, whatever is under your hand: sow, harvest, clear — or, standing at
 *  the crate, tip in everything you are carrying. */
function actOnPlot(): void {
  if (build.active) return;
  // One key, whatever you are standing at. The counter comes first because it
  // is indoors and nothing else is ever within reach of it.
  if (prepStation?.inReach(player.position.x, player.position.z)) {
    const lifted = prepStation.take();
    if (lifted) farm.give([lifted]);
    else {
      farm.remove(prepStation.put(farm.inventory));
      prepStation.start();
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
  farm.act(addressed.site, farmHud.selected);
  saveEverything();
  refreshFarm();
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
  if (key >= "1" && key <= "9") farmHud.select(Number(key) - 1);
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
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
  // Step up onto a floor slab, or back down to the ground.
  const room = roomAt(levelLayout, player.position.x, player.position.z);
  player.position.y = room ? ROOM_FLOOR_Y : 0.02;
  framed = false;
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
let hudWindow = performance.now();
let farmWindow = performance.now();
let rigTest: Awaited<ReturnType<typeof import("./rig-test.ts").mountRigTest>> | undefined;
let cropTest: Awaited<ReturnType<typeof import("./crop-test.ts").mountCropTest>> | undefined;
let cropPlots: Awaited<ReturnType<typeof import("./crop-plot-test.ts").mountCropPlots>> | undefined;
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
  walk(dt);
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
  prepStation?.update(dt);
  rigTest?.update(dt);
  cropTest?.update(dt);
  cropPlots?.update(dt);
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

if (params.get("cropPlot") === "1") {
  void import("./crop-plot-test.ts").then(({ mountCropPlots }) =>
    mountCropPlots(scene, player.position.add(new Vector3(1.5, 0, 1.5)), { shadows, particles }))
    .then((fixture) => { cropPlots = fixture; Object.assign(window, { __cropPlots: fixture }); })
    .catch((error) => console.error("Crop plots failed", error));
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
