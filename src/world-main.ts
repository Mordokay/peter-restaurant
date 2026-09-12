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
import { createCutaway } from "./game/cutaway";
import { fullProgress, roomAt, validateLevelLayout, type LevelProgress } from "./game/levelLayout";
import { attachGlow, createLightPool } from "./game/lighting";
import { createParticleWorld } from "./game/voxelParticles";
import { cellsFromAuthoredModel } from "./game/voxelModel";
import { createVoxelMesh } from "./game/voxelGeometry";
import { collidersOfMeshes, createColliderField } from "./game/gravity";
import { createDayNight } from "./game/dayNight";
import { createBuildMode } from "./buildMode";
import { runStages, type LoadingStage } from "./game/loading";
import { createSurfaceRing } from "./game/surfaceRing";
import { createWindMaterial } from "./game/voxelWind";
import { sourceCacheKey, warmSourceCache } from "./game/sourceCache";

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
    <div class="world-hint">W A S D walk · Q / E turn the camera · wheel zooms · F frames the site</div>
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

const camera = new ArcRotateCamera("world camera", -Math.PI / 4, 0.92, 26, player.position.clone(), scene);
camera.fov = 0.62;
camera.lowerBetaLimit = 0.55;
camera.upperBetaLimit = 1.15;
camera.lowerRadiusLimit = 6;
camera.upperRadiusLimit = 90;
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
  ring?.invalidate();
}

// Grass, pebbles and clods, grown only where the camera is. On the wind material — a pebble carries no
// sway weight, so it stands perfectly still while the blades beside it bend.
const crustMaterial = createWindMaterial("level crust", scene);
const ring = createSurfaceRing(scene, {
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
      name: "Growing grass and gravel",
      weight: 2,
      run() { ring.invalidate(); ring.update(player.position, camera.radius); },
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
      ring.invalidate();
      ring.update(player.position, camera.radius);
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
}
const decor = createDecorScene(scene, catalog, decorLayout, { shadows, lightPool, cacheRev, colliders, particles });

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
});
window.addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());
canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  targetRadius = Math.min(camera.upperRadiusLimit ?? 90, Math.max(camera.lowerRadiusLimit ?? 6, targetRadius * (1 + Math.sign(event.deltaY) * 0.12)));
}, { passive: false });

let targetAlpha = camera.alpha;
let targetRadius = camera.radius;
function turnCamera(direction: number): void { targetAlpha += (direction * Math.PI) / 4; }
function frameSite(): void {
  const site = levelLayout.areas.find((area) => area.id === "site_grounds");
  if (!site) return;
  camera.target.set(site.rect[0] + site.rect[2] / 2, 0, site.rect[1] + site.rect[3] / 2);
  targetRadius = 78;
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
let frames = 0, fpsWindow = performance.now(), fps = 0;
function updateHud(): void {
  const stats = level.stats();
  const ringStats = ring.stats();
  const decorStats = decor.renderer.stats();
  const roomId = cutaway.room();
  const room = roomId ? levelLayout.rooms.find((candidate) => candidate.id === roomId) : null;
  roomEl.textContent = room ? room.name : "outside";
  statsEl.innerHTML = `<b>${fps.toFixed(0)} fps</b> · ${instrumentation.frameTimeCounter.lastSecAverage.toFixed(1)} ms/frame · draw calls ${fmt(instrumentation.drawCallsCounter.current)}`
    + ` · level: ${stats.floors} floors, ${stats.walls} walls, ${fmt(stats.triangles)} triangles, built in ${fmt(stats.buildMs)} ms`
    + (ringStats.meshes ? ` · crust ${fmt(ringStats.triangles)} tris in ${ringStats.meshes}` : "")
    + ` · walls down ${cutaway.down().length}`
    + (decorStats.instances ? ` · props ${fmt(decorStats.instances)}` : "");
  clockEl.textContent = `${dayNight.hour >= 6.5 && dayNight.hour < 20 ? "☀" : "🌙"} ${dayNight.label()}`;
}

let previous = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  walk(dt);
  camera.alpha += (targetAlpha - camera.alpha) * Math.min(1, dt * 8);
  camera.radius += (targetRadius - camera.radius) * Math.min(1, dt * 8);
  if (!framed && !build.active) {
    const wanted = player.position.add(new Vector3(0, 0.8, 0));
    camera.target.addInPlace(wanted.subtract(camera.target).scale(Math.min(1, dt * 8)));
  }
  ring.update(player.position, camera.radius);
  if (cutawayOn) cutaway.update(dt);
  decor.update(dt);
  particles.update(dt);
  dayNight.update(dt);
  scene.render();
  frames++;
  if (now - fpsWindow >= 500) { fps = (frames * 1000) / (now - fpsWindow); frames = 0; fpsWindow = now; updateHud(); }
});
window.addEventListener("resize", () => engine.resize());

Object.assign(window as unknown as Record<string, unknown>, {
  __world: { scene, camera, player, level, cutaway, decor, particles, colliders, dayNight, build, layout: levelLayout, turn: turnCamera,
    catalog, ensureModels, decorLayout, setProgress: (next: LevelProgress) => { progress = next; applyProgress(); } },
});
