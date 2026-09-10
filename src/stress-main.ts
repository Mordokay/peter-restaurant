// Stress scene: can the browser draw a fully dressed restaurant compound?
// Places thousands of catalog objects on a field, either through the world renderer
// (one merged mesh per model, thin instances per ground cell) or as individual rigs
// (how decorate mode placed props until now), and shows the numbers that matter:
// frames per second, draw calls, triangles drawn, GPU-resident geometry, load time.
//
// URL: /stress.html?n=3000&mode=instanced|rigs&seed=1&models=60&lod=18&cull=140
import "./stress.css";
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, Scene, SceneInstrumentation, ShadowGenerator, StandardMaterial, Vector3 } from "@babylonjs/core";
import { catalog, catalogIndex, ensureModels } from "./assets/catalog/index";
import { createHeadCamera } from "./labCamera";
import { createWorldRenderer, type WorldInstance } from "./game/worldRenderer";
import { createVoxelRig, type VoxelRig } from "./game/voxelRig";
import { attachGlow, createLightPool } from "./game/lighting";
import { sourceCacheKey, warmSourceCache } from "./game/sourceCache";
import { sizeClassOf } from "./game/catalogTags";

const params = new URLSearchParams(window.location.search);
const count = Math.max(1, Math.min(20000, Number(params.get("n")) || 3000));
const mode = params.get("mode") === "rigs" ? "rigs" : "instanced";
const seed = Number(params.get("seed")) || 1;
const distinct = Math.max(1, Math.min(400, Number(params.get("models")) || 60));
const night = params.get("night") === "1";
const useCache = params.get("cache") !== "0";

document.querySelector("#stress")!.innerHTML = `
  <canvas id="stress-canvas"></canvas>
  <div class="stress-hud">
    <div class="stress-title">Stress scene · <span id="stress-mode"></span></div>
    <div id="stress-stats" class="stress-stats">loading…</div>
    <div class="stress-controls">
      ${[500, 1000, 3000, 5000, 10000].map((n) => `<a href="?n=${n}&mode=${mode}&seed=${seed}&models=${distinct}" class="${n === count ? "on" : ""}">${n.toLocaleString()}</a>`).join("")}
      <span class="stress-sep"></span>
      <a href="?n=${count}&mode=instanced&seed=${seed}&models=${distinct}" class="${mode === "instanced" ? "on" : ""}">instanced</a>
      <a href="?n=${Math.min(count, 800)}&mode=rigs&seed=${seed}&models=${distinct}" class="${mode === "rigs" ? "on" : ""}" title="One rig per prop — the old way. Capped at 800 so the tab survives.">individual rigs</a>
      <span class="stress-sep"></span>
      <a href="?n=${count}&mode=${mode}&seed=${seed}&models=${distinct}&night=${night ? 0 : 1}" class="${night ? "on" : ""}" title="Night: dim sun, glowing lamps, pooled point lights">🌙 night</a>
      <a href="?n=${count}&mode=${mode}&seed=${seed}&models=${distinct}&night=${night ? 1 : 0}&cache=${useCache ? 0 : 1}" class="${useCache ? "on" : ""}" title="Source-mesh cache (IndexedDB): meshed sources are restored instead of rebuilt">💾 cache</a>
      <span class="stress-sep"></span>
      <a href="/">← game</a>
    </div>
    <div class="stress-hint">Right-hold: look · W A S D: fly · Q/E: down/up · wheel: zoom · F: frame</div>
  </div>`;
document.querySelector("#stress-mode")!.textContent = `${count.toLocaleString()} props · ${mode}`;

const canvas = document.querySelector<HTMLCanvasElement>("#stress-canvas")!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString("#b7c9b3ff");
const instrumentation = new SceneInstrumentation(scene);
instrumentation.captureFrameTime = true;
scene.skipPointerMovePicking = true;
const camera = new ArcRotateCamera("stress camera", -Math.PI / 4, 1.0, 60, new Vector3(0, 1, 0), scene);
camera.minZ = 0.1; camera.maxZ = 800; camera.lowerRadiusLimit = 1; camera.upperRadiusLimit = 400; camera.wheelDeltaPercentage = 0.05;
camera.attachControl(true, false, 1);
const head = createHeadCamera(camera, canvas, scene, { minRadius: 1, maxRadius: 400, pickable: () => [], frameMeshes: () => [], onStatus: () => {} });
head.setFlyMode(true); head.setSpeedScale(2);
const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.35), scene);
sun.intensity = night ? 0.06 : 1.1; sun.position = new Vector3(60, 120, 60);
const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
fill.intensity = night ? 0.12 : 0.55; fill.groundColor = Color3.FromHexString("#4f6150");
if (night) scene.clearColor = Color4.FromHexString("#151d2aff");
const glowLayer = attachGlow(scene, { intensity: night ? 1.1 : 0.7 });
const lightPool = createLightPool(scene, { max: 6 });
const shadows = new ShadowGenerator(2048, sun);
shadows.usePercentageCloserFiltering = true; shadows.bias = 0.0008;
const groundSize = Math.ceil(Math.sqrt(count) * 3.2) + 20;
const ground = MeshBuilder.CreateGround("ground", { width: groundSize, height: groundSize }, scene);
const groundMaterial = new StandardMaterial("ground", scene);
groundMaterial.diffuseColor = Color3.FromHexString("#8f9b6e"); groundMaterial.specularColor.set(0, 0, 0);
ground.material = groundMaterial; ground.receiveShadows = true;

// Deterministic pick of models: hand-held to floor-sized, spread across zones.
const rand = (() => { let state = seed >>> 0 || 1; return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; }; })();
const candidates = Object.entries(catalogIndex).filter(([id, entry]) => id !== "tomato" && Math.max(...entry.size) <= 3 && Math.max(...entry.size) >= 0.05 && entry.voxels <= 400_000).map(([id]) => id).sort();
const chosen: string[] = [];
while (chosen.length < Math.min(distinct, candidates.length)) { const pick = candidates[Math.floor(rand() * candidates.length)]!; if (!chosen.includes(pick)) chosen.push(pick); }
const lamps = Object.entries(catalogIndex).filter(([, entry]) => entry.lights).map(([id]) => id);
for (const lamp of lamps) if (!chosen.includes(lamp)) chosen.push(lamp);
const instances: WorldInstance[] = [];
const side = Math.ceil(Math.sqrt(count));
for (let i = 0; i < count; i++) {
  // Every twelfth prop is a lamp when the catalog has any, so lighting is visible in the test.
  const model = lamps.length && i % 12 === 0 ? lamps[Math.floor(rand() * lamps.length)]! : chosen[Math.floor(rand() * chosen.length)]!;
  const size = catalogIndex[model]!.size;
  const spacing = sizeClassOf(size) === "large" ? 3.2 : 3.0;
  const gx = (i % side) - side / 2, gz = Math.floor(i / side) - side / 2;
  instances.push({ id: `p${i}`, model, position: [gx * spacing + (rand() - 0.5) * 0.8, 0, gz * spacing + (rand() - 0.5) * 0.8], rotation: [0, Math.floor(rand() * 4) * 90 + (rand() - 0.5) * 20, 0], scale: 1 });
}

const stats = document.querySelector<HTMLElement>("#stress-stats")!;
const t0 = performance.now();
await ensureModels(chosen);
const tLoaded = performance.now();
const lodPitch = 0.02;
const cacheRev = (modelId: string): number | undefined => catalogIndex[modelId]?.rev;
const cacheHits = useCache ? await warmSourceCache(chosen.map((id) => sourceCacheKey(id, cacheRev(id), lodPitch))) : 0;
const tWarmed = performance.now();

let renderer: ReturnType<typeof createWorldRenderer> | null = null;
const rigs: VoxelRig[] = [];
if (mode === "instanced") {
  renderer = createWorldRenderer(scene, { shadows, log: true, lodDistance: Number(params.get("lod") ?? 18), lodPitch, cullDistance: Number(params.get("cull") ?? 140), lightPool, cacheRev: useCache ? cacheRev : undefined });
  console.log(`[stress] models decoded in ${(tLoaded - t0).toFixed(0)} ms; building ${instances.length} instances of ${chosen.length} models`);
  renderer.setInstances(instances, catalog.models);
} else {
  let material: StandardMaterial | undefined;
  for (const instance of instances.slice(0, 800)) {
    const model = catalog.models[instance.model]!;
    const rig = createVoxelRig(model, scene, { name: instance.id, shadows, material });
    material ??= rig.material;
    rig.anchor.position.set(instance.position[0], instance.position[1], instance.position[2]);
    rig.anchor.rotation.set(0, ((instance.rotation?.[1] ?? 0) * Math.PI) / 180, 0);
    rigs.push(rig);
  }
}
const tBuilt = performance.now();
console.log(`[stress] cache warmed in ${(tWarmed - tLoaded).toFixed(0)} ms (${cacheHits}/${chosen.length} hits); scene built in ${(tBuilt - tWarmed).toFixed(0)} ms`);

let frames = 0, fpsWindowStart = performance.now(), fps = 0;
engine.runRenderLoop(() => {
  scene.render();
  frames++;
  const now = performance.now();
  if (now - fpsWindowStart >= 500) { fps = (frames * 1000) / (now - fpsWindowStart); frames = 0; fpsWindowStart = now; }
});
window.addEventListener("resize", () => engine.resize());

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
function updateStats(): void {
  const drawCalls = instrumentation.drawCallsCounter.current;
  const active = scene.getActiveMeshes().length;
  let line = `<b>${fps.toFixed(0)} fps</b> · ${instrumentation.frameTimeCounter.lastSecAverage.toFixed(1)} ms/frame (CPU) · draw calls ${fmt(drawCalls)} · active meshes ${fmt(active)} · triangles drawn ${fmt(scene.getActiveIndices() / 3)} · total meshes ${fmt(scene.meshes.length)}`;
  if (renderer) {
    const s = renderer.stats();
    const lp = lightPool.stats();
    line += `<br>world renderer: ${fmt(s.instances)} instances of ${s.models} models · ${fmt(s.activeInstances)} in view · ~${fmt(s.triangles)} triangles after LOD · resident geometry ${fmt(s.residentTriangles)} triangles · sources meshed in ${fmt(s.buildMs)} ms (${s.cachedSources} from cache, warmed in ${fmt(tWarmed - tLoaded)} ms) · lights ${lp.active}/${lp.registered} real · glow ${glowLayer.isEnabled ? "on" : "off"}`;
  } else line += `<br>individual rigs: ${fmt(rigs.length)} rigs (capped at 800) · ${fmt(rigs.reduce((sum, rig) => sum + rig.meshes.length, 0))} part meshes`;
  line += `<br>models fetched+decoded in ${fmt(tLoaded - t0)} ms · scene built in ${fmt(tBuilt - tWarmed)} ms · ${chosen.length} distinct models · GPU: ${engine.getGlInfo().renderer}`;
  stats.innerHTML = line;
}
setInterval(updateStats, 500);
Object.assign(window as unknown as Record<string, unknown>, { __stress: { scene, engine, renderer, rigs, instances, chosen, stats: () => ({ fps, drawCalls: instrumentation.drawCallsCounter.current, frameMs: instrumentation.frameTimeCounter.lastSecAverage, active: scene.getActiveMeshes().length, triangles: scene.getActiveIndices() / 3, meshes: scene.meshes.length, loadMs: tLoaded - t0, buildMs: tBuilt - tLoaded, renderer: renderer?.stats() }) } });
