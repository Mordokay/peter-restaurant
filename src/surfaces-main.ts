// The surface lab: where a wall or floor material is judged before it goes into the world.
//
// ART_DIRECTION.md is blunt about this — "validate every asset in the actual camera at normal zoom, not
// in a close-up model viewer". So this page shows a patch at the GAME's camera by default, with the same
// field of view and pitch world.html uses, and lets you walk in to look closer. A material that only
// works at 1.5 m has not passed.
//
// URL: /surfaces.html?material=tile_quarry&pitch=0.05&hour=19.5
import "./surfaces.css";
import {
  ArcRotateCamera, Color3, DirectionalLight, Engine, HemisphericLight, Mesh,
  MeshBuilder, Scene, SceneInstrumentation, ShadowGenerator, StandardMaterial, Vector3,
} from "@babylonjs/core";
import { createVoxelMaterial, createVoxelMesh, type VoxelCell } from "./game/voxelGeometry";
import { reliefFloor, sampleSurface } from "./game/surfaces";
import { surfaceLibrary } from "./game/surfaceLibrary";
import { createDayNight, type DayNight } from "./game/dayNight";

const params = new URLSearchParams(window.location.search);
/** Metres across the patch. Big enough that a 2 m board and a 30 cm tile both read at the game camera. */
const PATCH = 14;

document.querySelector<HTMLElement>("#surfaces")!.innerHTML = `
  <canvas id="surface-canvas"></canvas>
  <div class="sf-bar sf-top">
    <span class="sf-title">🧱 Surfaces <a href="/world.html">compound</a><a href="/model-lab.html">model lab</a></span>
    <span class="sf-group" id="sf-materials"></span>
    <span class="sf-group"><span class="sf-label">Cell</span><span id="sf-pitch"></span></span>
    <span class="sf-group"><span class="sf-label">Light</span><span id="sf-light"></span></span>
    <span class="sf-group"><span class="sf-label">View</span><span id="sf-view"></span></span>
    <button id="sf-relief" title="Show the material's relief as real geometry. Realistic depths are sub-cell at these pitches, so this is how you tell whether a joint can ever read as a recess.">Relief</button>
  </div>
  <div class="sf-bar sf-stats" id="sf-stats">building…</div>
  <div class="sf-bar sf-help">Drag to orbit · wheel to zoom · the View buttons snap to the distances that matter</div>`;

const canvas = document.querySelector<HTMLCanvasElement>("#surface-canvas")!;
const engine = new Engine(canvas, true, { stencil: true });
const scene = new Scene(engine);
const instrumentation = new SceneInstrumentation(scene);
instrumentation.captureFrameTime = true;

// The game's camera, to the number: world.html uses fov 0.62 and sits between 6 and 26 m at beta 0.92.
const camera = new ArcRotateCamera("surface camera", -Math.PI / 4, 0.92, 26, new Vector3(0, 0, 0), scene);
camera.fov = 0.62;
camera.minZ = 0.05;
camera.maxZ = 300;
camera.lowerRadiusLimit = 0.6;
camera.upperRadiusLimit = 60;
camera.wheelDeltaPercentage = 0.05;
camera.attachControl(true);

const sun = new DirectionalLight("sun", new Vector3(-0.6, -1, 0.45), scene);
sun.position.set(12, 22, -12);
sun.intensity = 1.6;
const ambient = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
ambient.intensity = 1;
const shadows = new ShadowGenerator(2048, sun);
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = 16;
const material = createVoxelMaterial("surface material", scene);

// Something of known size to judge against: a post as tall as a person, and a one-metre rule at its foot.
const postMaterial = new StandardMaterial("post", scene);
postMaterial.diffuseColor = Color3.FromHexString("#cfd6d3");
postMaterial.specularColor.set(0.04, 0.04, 0.04);
const post = MeshBuilder.CreateBox("scale post", { width: 0.3, height: 1.8, depth: 0.3 }, scene);
post.material = postMaterial;
post.position.set(-PATCH / 2 + 1.4, 0.9, -PATCH / 2 + 1.4);
shadows.addShadowCaster(post);

let dayNight: DayNight | null = null;
let patch: Mesh | null = null;
let materialId = params.get("material") ?? surfaceLibrary[0]!.id;
let pitch = Number(params.get("pitch")) || 0.05;
let relief = false;
let lightPreset = "day";
let buildMs = 0;
let cellTotal = 0;

/** Build the patch: one column of cells per sample, from the material's deepest cut to its relief. */
function rebuild(): void {
  const started = performance.now();
  patch?.dispose(false, false);
  const spec = surfaceLibrary.find((candidate) => candidate.id === materialId)!;
  const n = Math.round(PATCH / pitch);
  // Cells are addressed from the patch's corner, but the material is asked about WORLD metres, so the
  // pattern is the one the compound would show at this spot — not a fresh tile starting at the corner.
  const origin = -PATCH / 2;
  const low = relief ? Math.floor(reliefFloor(spec) / pitch) : 0;
  const cells: VoxelCell[] = [];
  const top = new Map<string, number>();
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      const sample = sampleSurface(spec, origin + (ix + 0.5) * pitch, origin + (iz + 0.5) * pitch);
      const high = relief ? Math.round(sample.relief / pitch) : 0;
      top.set(`${ix},${iz}`, high);
      for (let y = low; y <= high; y++) cells.push({ x: ix, y, z: iz, color: sample.color });
    }
  }
  patch = createVoxelMesh(`patch ${spec.id}`, cells, pitch, scene, {
    material,
    // Nobody sees the underside of a floor, and it is half of a flat one's faces.
    solid: (x, y, z) => {
      if (y < low) return true;
      const high = top.get(`${x},${z}`);
      return high !== undefined && y <= high;
    },
  });
  patch.position.set(origin + pitch / 2, -pitch / 2, origin + pitch / 2);
  patch.receiveShadows = true;
  cellTotal = cells.length;
  buildMs = performance.now() - started;
  render();
}

const viewpoints: Record<string, { radius: number; beta: number }> = {
  game: { radius: 26, beta: 0.92 },
  near: { radius: 8, beta: 1.0 },
  walk: { radius: 2.4, beta: 1.25 },
  close: { radius: 0.9, beta: 1.4 },
};
let viewpoint = "game";
function setView(name: string): void {
  const view = viewpoints[name];
  if (!view) return;
  viewpoint = name;
  camera.radius = view.radius;
  camera.beta = view.beta;
  camera.target.set(0, 0, 0);
  render();
}

const lights: Record<string, number | null> = { studio: null, day: 12, evening: 19.5, night: 23 };
function setLight(name: string): void {
  lightPreset = name;
  const hour = lights[name];
  if (hour === null || hour === undefined) {
    dayNight = null;
    scene.clearColor.set(0.55, 0.62, 0.56, 1);
    sun.direction.set(-0.6, -1, 0.45);
    sun.diffuse = Color3.White();
    sun.intensity = 1.9;
    ambient.diffuse = Color3.White();
    ambient.groundColor = Color3.FromHexString("#506159");
    ambient.intensity = 1.1;
  } else if (dayNight) dayNight.setHour(hour);
  else dayNight = createDayNight(scene, { sun, ambient }, { hour });
  render();
}

const button = (group: string, id: string, label: string, on: boolean, title = ""): string =>
  `<button data-${group}="${id}" class="${on ? "on" : ""}" title="${title}">${label}</button>`;

function render(): void {
  document.querySelector<HTMLElement>("#sf-materials")!.innerHTML = surfaceLibrary
    .map((spec) => button("material", spec.id, spec.name, spec.id === materialId)).join("");
  document.querySelector<HTMLElement>("#sf-pitch")!.innerHTML = [0.1, 0.05, 0.025]
    .map((value) => button("pitch", String(value), `${value * 100} cm`, Math.abs(value - pitch) < 1e-9)).join("");
  document.querySelector<HTMLElement>("#sf-light")!.innerHTML = Object.keys(lights)
    .map((name) => button("light", name, name === "studio" ? "💡" : name === "day" ? "☀️" : name === "evening" ? "🌇" : "🌙", name === lightPreset)).join("");
  document.querySelector<HTMLElement>("#sf-view")!.innerHTML = Object.entries(viewpoints)
    .map(([name, view]) => button("view", name, name === "game" ? "Game 26 m" : `${view.radius} m`, name === viewpoint,
      name === "game" ? "The compound's own camera. If it does not read here, it does not read." : "")).join("");
  document.querySelector<HTMLElement>("#sf-relief")!.classList.toggle("on", relief);
  const triangles = patch ? patch.getTotalIndices() / 3 : 0;
  document.querySelector<HTMLElement>("#sf-stats")!.textContent =
    `${cellTotal.toLocaleString()} cells · ${triangles.toLocaleString()} triangles · ${(triangles / (PATCH * PATCH)).toFixed(0)} per m² · built in ${buildMs.toFixed(0)} ms`;
}

document.querySelector<HTMLElement>(".sf-top")!.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!target) return;
  if (target.dataset.material) { materialId = target.dataset.material; rebuild(); return; }
  if (target.dataset.pitch) { pitch = Number(target.dataset.pitch); rebuild(); return; }
  if (target.dataset.light) { setLight(target.dataset.light); return; }
  if (target.dataset.view) { setView(target.dataset.view); return; }
  if (target.id === "sf-relief") { relief = !relief; rebuild(); }
});

setLight(params.has("hour") ? "day" : "day");
if (params.has("hour")) { dayNight = createDayNight(scene, { sun, ambient }, { hour: Number(params.get("hour")) }); lightPreset = "custom"; }
rebuild();
setView("game");

let frames = 0;
engine.runRenderLoop(() => {
  scene.render();
  if (++frames % 30 === 0) {
    const stats = document.querySelector<HTMLElement>("#sf-stats")!;
    const triangles = patch ? patch.getTotalIndices() / 3 : 0;
    stats.textContent = `${engine.getFps().toFixed(0)} fps · ${instrumentation.frameTimeCounter.lastSecAverage.toFixed(1)} ms · `
      + `${cellTotal.toLocaleString()} cells · ${triangles.toLocaleString()} triangles · ${(triangles / (PATCH * PATCH)).toFixed(0)} per m² · built in ${buildMs.toFixed(0)} ms`;
  }
});
window.addEventListener("resize", () => engine.resize());
(window as unknown as { __surfaces: unknown }).__surfaces = {
  scene, camera,
  set: (id: string, cell?: number) => { materialId = id; if (cell) pitch = cell; rebuild(); },
  view: setView, light: setLight,
  relief: (on: boolean) => { relief = on; rebuild(); },
  stats: () => ({ material: materialId, pitch, relief, cells: cellTotal, triangles: patch ? patch.getTotalIndices() / 3 : 0, buildMs }),
};
