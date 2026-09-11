import "./model-lab.css";
import { DETAIL_ORDER, DETAIL_TIERS, estimateImport, isImportDetail, type ImportDetail } from "./game/importDetail";
import {
  ArcRotateCamera, ArcRotateCameraPointersInput, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Mesh, MeshBuilder,
  Scene, ShadowGenerator, StandardMaterial, Tools, TransformNode, Vector3,
} from "@babylonjs/core";
import { catalog as catalogData, catalogIndex, ensureModels, entryFor, forgetModel, isLoaded, labelOf, registerModel, thumbnailUrl } from "./assets/catalog/index";
import { createCatalogBrowser } from "./catalogBrowser";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog, type AuthoredVoxelModel } from "./game/voxelModel";
import { createVoxelMesh, visibleVoxelFaceCount } from "./game/voxelGeometry";

import { animateCabbageRig, createCabbageRig, type CabbageRig } from "./game/cabbage";
import { animateTomatoStages, createTomatoStageRig, requestTomatoStage, type TomatoStageRig } from "./game/tomatoStages";
import { TOMATO_STAGE_SECONDS } from "./game/stageTransition";
import { createLabEditor } from "./labEditor";
import { createHeadCamera } from "./labCamera";
import { createClipPlayer, createVoxelRig, type ClipPlayer, type VoxelRig } from "./game/voxelRig";
import { attachGlow } from "./game/lighting";
import { createParticleWorld, type EmitterHandle } from "./game/voxelParticles";
import { collidersOfMeshes, createColliderField } from "./game/gravity";

const host = document.querySelector<HTMLElement>("#model-lab")!;
host.innerHTML = `<div class="lab" id="lab-root">
  <aside class="lab-sidebar" id="lab-sidebar"><div class="lab-resize-handle" id="lab-resize" title="Drag to resize this panel"></div><div class="lab-objects" id="lab-objects"><a class="lab-back" href="/">← Back to game</a><h1>Model Lab</h1><p>Every registered production asset appears here. Inspect silhouettes at any angle before approving them.</p><div class="lab-browser" id="lab-browser"></div><div class="lab-objects-actions"><button id="lab-import" title="Import a .glb/.gltf/.obj: it is voxelized, its parts kept and auto-rigged, and it lands in this list ready to edit and animate">📥 Import 3D object…</button><input type="file" id="lab-import-file" accept=".glb,.gltf,.obj" hidden /><button id="lab-thumbs" title="Render the missing thumbnails (pictures in the browser and the decorate library). Shift+click re-renders every thumbnail.">📸</button></div><div class="lab-panel-hint">Click a tile to open it · right-click for rename, duplicate, merge, remove · drag a tile onto another (or onto the 3D view) to bring its parts in · drag onto a folder in the 📁 rail to move it · ★ favourites · arrows move around the grid.</div></div><div class="lab-left-panel" id="lab-left" hidden></div></aside>
  <section class="lab-view"><canvas id="lab-canvas"></canvas><div class="lab-toolbar"><span id="lab-modes" class="lab-modes"></span><span id="lab-clips" class="lab-clips"></span><button id="lab-edit" title="Edit this voxel model: brushes, bucket, eyedropper, chunk delete, parts, rig, animation, save to the catalog">Edit</button><button id="lab-reset" title="Back to the framed view (also resets the field of view)">Reset view</button><button id="lab-fly" title="Fly mode (C): W A S D move, Q E down/up, hold the right mouse button to look. Off: the same works while holding the right button.">🎥 Fly <kbd>C</kbd></button><label class="lab-speed" title="Keyboard fly speed (W A S D / Q E)"><span>🎮</span><input type="range" id="lab-fly-speed" min="0" max="100" step="1" /><output id="lab-fly-speed-value"></output></label><button id="lab-spin">Auto rotate</button></div><div class="lab-help" id="lab-help"></div><div class="lab-stats" id="lab-stats"></div></section>
  <aside class="lab-right-panel" id="lab-right" hidden></aside>
  <footer class="lab-bottom-panel" id="lab-bottom" hidden></footer>
  <div class="lab-resize-right" id="lab-resize-right" title="Drag to resize the properties panel"></div>
  <div class="lab-resize-bottom" id="lab-resize-bottom" title="Drag to resize the timeline"></div>
</div>`;

const canvas = document.querySelector<HTMLCanvasElement>("#lab-canvas")!;
const stats = document.querySelector<HTMLElement>("#lab-stats")!;
const spinButton = document.querySelector<HTMLButtonElement>("#lab-spin")!;
const editButton = document.querySelector<HTMLButtonElement>("#lab-edit")!;
const clipBar = document.querySelector<HTMLElement>("#lab-clips")!;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString("#aebdafff");
const camera = new ArcRotateCamera("model inspection camera", -Math.PI / 4, 1.05, 4, new Vector3(0, 0.8, 0), scene);
// Single-voxel work needs a real close-up: Babylon's default near plane is
// 1 m, which sliced the front off any object the camera came within a metre
// of. A 5 mm near plane and a 3 cm minimum orbit radius let a 4 mm voxel fill
// the view; wheel zoom is a percentage of the distance so it stays usable at
// every scale.
const CLOSEST_RADIUS = 0.03;
camera.minZ = 0.005;
camera.maxZ = 60;
camera.lowerRadiusLimit = CLOSEST_RADIUS;
camera.upperRadiusLimit = 14;
// Full range: straight down onto the top of a leaf, or up at its underside
// from below the table (the ground plane is back-face culled from there).
camera.lowerBetaLimit = 0.03;
camera.upperBetaLimit = Math.PI - 0.03;
camera.panningSensibility = 900;
camera.wheelDeltaPercentage = 0.06;
camera.pinchDeltaPercentage = 0.02;
// Left orbits, middle pans; the right button belongs to the head camera (look + WASD fly).
camera.attachControl(true, false, 1);
(camera.inputs.attached.pointers as ArcRotateCameraPointersInput).buttons = [0, 1];
canvas.addEventListener("pointerdown", () => {
  if (!autoRotate) return;
  autoRotate = false;
  spinButton.classList.remove("active");
});
const key = new DirectionalLight("lab key", new Vector3(-0.6, -1, 0.45), scene);
key.position.set(5, 8, -5);
key.intensity = 2.1;
const fill = new HemisphericLight("lab fill", new Vector3(0, 1, 0), scene);
fill.intensity = 1.15;
fill.groundColor = Color3.FromHexString("#506159");
const shadows = new ShadowGenerator(2048, key);
attachGlow(scene, { intensity: 0.8 });
// Particle preview: cubes land on the ground plane and on the displayed model itself.
const colliders = createColliderField({ groundY: 0 });
const particles = createParticleWorld(scene, { colliders, shadows, capacity: 4000 , shapes: (id) => {
  // A particle can be any voxel model you authored in the lab: `shape: "model:<id>"`.
  const source = catalogData.models[id];
  return source ? createVoxelMesh(`particle ${id}`, cellsFromAuthoredModel(source), source.pitch, scene) : null;
} });
let emitterHandle: EmitterHandle | null = null;
function attachParticles(rig: VoxelRig | null): void {
  emitterHandle?.dispose();
  emitterHandle = null;
  if (!rig) { colliders.remove("model"); return; }
  // The model's own particles fall past it to the ground; other things (a dropped cube, say) land on its parts.
  emitterHandle = particles.attachRig(rig, { excludeCollider: "model" });
  colliders.set("model", collidersOfMeshes(rig.meshes));
}
shadows.useBlurExponentialShadowMap = true;
shadows.blurKernel = 18;
const groundMaterial = new StandardMaterial("lab ground", scene);
groundMaterial.diffuseColor = Color3.FromHexString("#d8d3c1");
groundMaterial.specularColor.set(0.05, 0.05, 0.05);
const ground = MeshBuilder.CreateGround("inspection ground", { width: 18, height: 18 }, scene);
ground.material = groundMaterial;
ground.receiveShadows = true;

const catalog: AuthoredVoxelCatalog = catalogData;

// Catalog models the game still needs but that are not worth a lab entry: the
// legacy authored tomato fruit only feeds the old plot rig (the scanned growth
// stages replace it visually).
const HIDDEN_FROM_LAB = new Set(["tomato"]);
type LabEntry = { id: string; label: string; kind: "staged" | "model"; folder?: string };
const labelFor = (model: AuthoredVoxelModel): string => model.name ?? model.id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const entries: LabEntry[] = [
  { id: "tomato_stages", label: "Tomato · growth stages", kind: "staged" },
  ...Object.keys(catalogIndex).filter((id) => !HIDDEN_FROM_LAB.has(id)).sort().map((id) => ({ id, label: labelOf(id), kind: "model" as const, folder: catalogIndex[id]!.folder })),
];
const requestedModel = new URLSearchParams(window.location.search).get("model");
let selected = entries.some((entry) => entry.id === requestedModel) ? requestedModel! : entries[0]!.id;
let displayed: TransformNode | Mesh | null = null;
let displayedCabbage: CabbageRig | null = null;
let displayedStages: TomatoStageRig | null = null;
// The catalog model currently shown as a rig (editable), if any, and its clip player.
let editableModel: AuthoredVoxelModel | null = null;
let displayedRig: VoxelRig | null = null;
let clipPlayer: ClipPlayer | null = null;
/** ⏹ was pressed: keep the rest pose instead of re-arming the looping clip. */
let restRequested = false;
// Auto-rotate is ON by default so every object arrives already moving; taking
// the camera (drag or pan) hands control back to the viewer.
let autoRotate = true;
spinButton.classList.add("active");
let initialView = { alpha: -Math.PI / 4, beta: 1.05, radius: 4, target: new Vector3(0, 0.8, 0) };
// Deterministic multi-angle captures: ?alpha=&beta=&radius= override the
// framing so the same asset can be screenshotted from every useful angle.
// An absent parameter must read as NaN, not 0: Number(null) is 0, which used
// to pass the isFinite checks and start every view at beta 0 / radius 0.65 —
// a degenerate camera sitting inside the object.
const requestedView = new URLSearchParams(window.location.search);
const viewParameter = (name: string): number => {
  const raw = requestedView.get(name);
  return raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
};
const requestedAlpha = viewParameter("alpha");
const requestedBeta = viewParameter("beta");
const requestedRadius = viewParameter("radius");

function frameMeshes(meshes: Mesh[]): void {
  meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  let minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const mesh of meshes) {
    const box = mesh.getBoundingInfo().boundingBox;
    minimum = Vector3.Minimize(minimum, box.minimumWorld);
    maximum = Vector3.Maximize(maximum, box.maximumWorld);
  }
  frameBounds(minimum, maximum);
}

/** World-space extents of an authored model standing on the ground, computed
 * from its cells so framing never depends on a mesh's current scale (staged
 * rigs start with stages scaled to zero). */
function modelBounds(model: AuthoredVoxelModel): { minimum: Vector3; maximum: Vector3 } {
  const cells = cellsFromAuthoredModel(model);
  const minimum = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const maximum = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const cell of cells) {
    minimum.minimizeInPlaceFromFloats(cell.x, cell.y, cell.z);
    maximum.maximizeInPlaceFromFloats(cell.x, cell.y, cell.z);
  }
  const offsetY = minimum.y;
  return {
    minimum: new Vector3((minimum.x - 0.5) * model.pitch, (minimum.y - offsetY) * model.pitch, (minimum.z - 0.5) * model.pitch),
    maximum: new Vector3((maximum.x + 0.5) * model.pitch, (maximum.y + 1 - offsetY) * model.pitch, (maximum.z + 0.5) * model.pitch),
  };
}

function frameBounds(minimum: Vector3, maximum: Vector3): void {
  const center = minimum.add(maximum).scale(0.5);
  const size = maximum.subtract(minimum);
  // Distance at which the object's largest dimension fills about 45% of the
  // view height: the whole silhouette is visible with air around it, so
  // switching objects never needs a zoom-out first.
  const largest = Math.max(0.3, size.x, size.y, size.z);
  const fitDistance = (largest / 0.45) / (2 * Math.tan(camera.fov / 2));
  initialView = {
    alpha: Number.isFinite(requestedAlpha) ? requestedAlpha : -Math.PI / 4,
    beta: Number.isFinite(requestedBeta) ? requestedBeta : 1.05,
    radius: Number.isFinite(requestedRadius)
      ? Math.min(14, Math.max(CLOSEST_RADIUS, requestedRadius))
      : Math.min(12, Math.max(1.6, fitDistance)),
    target: new Vector3(center.x, Math.max(0.2, center.y), center.z),
  };
  resetView();
}

function resetView(): void {
  headCamera.resetFov();
  camera.alpha = initialView.alpha;
  camera.beta = initialView.beta;
  camera.radius = initialView.radius;
  camera.target.copyFrom(initialView.target);
}

function loadEntry(entry: LabEntry, options: { skipDirtyCheck?: boolean } = {}): void {
  if (editor.active && editor.dirty && !options.skipDirtyCheck && !window.confirm("Discard unsaved voxel edits?")) return;
  // Voxel data loads lazily: fetch this entry's model(s) first, then come back here.
  const needed = entry.kind === "staged" ? ["tomato", "tomato_sprout_scan", "tomato_vine_scan", "tomato_ripe_scan"] : [entry.id];
  if (!needed.every(isLoaded)) {
    stats.textContent = `Loading ${entry.label}…`;
    void ensureModels(needed).then(() => { if (needed.every(isLoaded)) loadEntry(entry, { skipDirtyCheck: true }); else stats.textContent = `${entry.id} is not in the catalog`; });
    return;
  }
  editor.close();
  editableModel = null;
  clipPlayer = null;
  clipBar.replaceChildren();
  if (displayedRig) { attachParticles(null); displayedRig.dispose(); displayedRig = null; displayed = null; }
  // Clones share production geometry/materials with their hidden sources.
  // Dispose the selected hierarchy without destroying those shared assets.
  displayed?.dispose(false, false);
  displayed = null;
  displayedCabbage = null;
  displayedStages = null;
  if (entry.kind === "staged") {
    const rig = createTomatoStageRig({ scene, catalog, shadows, initialStage: 0 });
    displayed = rig.root;
    displayedStages = rig;
    // Frame on the ripe stage — the tallest — so growth never leaves the view.
    const ripeBounds = modelBounds(catalog.models.tomato_ripe_scan!);
    frameBounds(ripeBounds.minimum, ripeBounds.maximum);
    const stageIds = ["tomato_sprout_scan", "tomato_vine_scan", "tomato_ripe_scan"];
    const totalCells = stageIds.reduce((sum, id) => sum + cellsFromAuthoredModel(catalog.models[id]!).length, 0);
    const triangles = rig.stageMeshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
    stats.textContent = `3 growth stages · ${totalCells} cells · ${triangles} triangles · ${TOMATO_STAGE_SECONDS}s cross-scale · press G to grow`;
  } else if (entry.id === "cabbage") {
    const model = catalog.models.cabbage!;
    const cabbage = createCabbageRig({ name: "inspected cabbage", model, scene, shadows });
    displayed = cabbage.root;
    displayedCabbage = cabbage;
    const meshes = cabbage.root.getChildMeshes() as Mesh[];
    meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    const minimumY = Math.min(...meshes.map((mesh) => mesh.getBoundingInfo().boundingBox.minimumWorld.y));
    cabbage.root.position.y = -minimumY;
    frameMeshes(meshes);
    const cells = cellsFromAuthoredModel(model);
    stats.textContent = `${cells.length} authored voxels · ${cabbage.leaves.length} animated leaves · ${model.pitch} m detail`;
  } else {
    const model = catalog.models[entry.id]!;
    showRig(model);
    editableModel = model;
  }
  selected = entry.id;
  editButton.disabled = editableModel === null;
  editButton.title = editableModel ? "Edit this voxel model: brushes, bucket, eyedropper, chunk delete, parts, save to the catalog" : "Only plain catalog voxel models can be edited here";
  window.history.replaceState(null, "", `${window.location.pathname}?model=${encodeURIComponent(entry.id)}`);
  renderList();
}

/** Display a catalog model as a rig (one mesh per part, joints honoured) and
 * offer its clips in the toolbar; a looping clip plays on its own. */
function showRig(model: AuthoredVoxelModel): VoxelRig {
  if (displayedRig) { attachParticles(null); displayedRig.dispose(); displayedRig = null; }
  const rig = createVoxelRig(model, scene, { name: `inspected ${model.id}`, shadows, lights: true });
  const cells = cellsFromAuthoredModel(model);
  const minY = cells.reduce((low, cell) => Math.min(low, cell.y), Infinity);
  rig.anchor.position.y = -(minY - 0.5) * model.pitch;
  displayed = rig.anchor;
  displayedRig = rig;
  rig.anchor.computeWorldMatrix(true);
  attachParticles(rig);
  clipPlayer = createClipPlayer(rig, { onEvent: (event) => { emitterHandle?.handleEvent(event); stats.textContent = `event "${event.name}" at ${event.t.toFixed(2)}s${event.swapModel ? ` → ${event.swapModel}` : ""}`; } });
  frameMeshes(rig.meshes);
  const triangles = rig.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0);
  stats.textContent = `${cells.length} cells · ${triangles} triangles (${visibleVoxelFaceCount(cells) * 2} before face merging) · ${model.parts.length} part${model.parts.length === 1 ? "" : "s"} · ${model.clips?.length ?? 0} clip${(model.clips?.length ?? 0) === 1 ? "" : "s"} · ${model.pitch} m cell`;
  clipBar.replaceChildren();
  for (const clip of model.clips ?? []) {
    const button = document.createElement("button");
    button.textContent = `${clip.loop ? "🔁" : "▶️"} ${clip.name ?? clip.id}`;
    button.title = `${clip.loop ? "Loop" : "Play once"}: ${clip.duration}s, ${clip.tracks.length} track(s)${clip.events?.length ? `, ${clip.events.length} event(s)` : ""}`;
    button.addEventListener("click", () => { if (!editor.active) { restRequested = false; clipPlayer?.play(clip.id); } });
    clipBar.append(button);
  }
  if (model.clips?.length) {
    const rest = document.createElement("button");
    rest.textContent = "⏹";
    rest.title = "Rest pose";
    rest.addEventListener("click", () => { if (!editor.active) { restRequested = true; clipPlayer?.stop(); emitterHandle?.stopAll(); } });
    clipBar.append(rest);
  }
  restRequested = false;
  const autoplay = model.clips?.find((clip) => clip.loop) ?? null;
  if (autoplay) clipPlayer.play(autoplay.id);
  return rig;
}

// ---------------------------------------------------------------- editor --
const labRoot = document.querySelector<HTMLElement>("#lab-root")!;
// Resizable left panel: drag the handle on its right edge; width is remembered.
const resizeHandle = document.querySelector<HTMLElement>("#lab-resize")!;
const LEFT_WIDTH_KEY = "farm-lab-left-width";
const applyLeftWidth = (width: number) => {
  const clamped = Math.min(Math.max(width, 200), Math.max(240, window.innerWidth * 0.5));
  labRoot.style.setProperty("--left-width", `${Math.round(clamped)}px`);
  try { window.localStorage.setItem(LEFT_WIDTH_KEY, String(Math.round(clamped))); } catch { /* ignore */ }
};
try { const stored = Number(window.localStorage.getItem(LEFT_WIDTH_KEY)); if (stored > 0) applyLeftWidth(stored); } catch { /* ignore */ }
resizeHandle.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  resizeHandle.classList.add("active");
  const move = (e: PointerEvent) => applyLeftWidth(e.clientX);
  const stop = () => { resizeHandle.classList.remove("active"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
});
// Right (properties) and bottom (timeline) panels resize the same way; sizes are remembered.
function panelResizer(handleId: string, variable: string, key: string, fallback: number, bounds: () => [number, number], measure: (event: PointerEvent) => number): void {
  const handle = document.querySelector<HTMLElement>(`#${handleId}`)!;
  const apply = (size: number) => {
    const [minimum, maximum] = bounds();
    const clamped = Math.round(Math.min(Math.max(size, minimum), Math.max(minimum, maximum)));
    labRoot.style.setProperty(variable, `${clamped}px`);
    try { window.localStorage.setItem(key, String(clamped)); } catch { /* ignore */ }
  };
  try { const stored = Number(window.localStorage.getItem(key)); apply(stored > 0 ? stored : fallback); } catch { apply(fallback); }
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handle.classList.add("active");
    const move = (e: PointerEvent) => apply(measure(e));
    const stop = () => { handle.classList.remove("active"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  });
}
panelResizer("lab-resize-right", "--right-width", "farm-lab-right-width", 330, () => [260, window.innerWidth * 0.5], (e) => window.innerWidth - e.clientX);
panelResizer("lab-resize-bottom", "--bottom-height", "farm-lab-bottom-height", 232, () => [140, window.innerHeight * 0.7], (e) => window.innerHeight - e.clientY);
const objectsPanel = document.querySelector<HTMLElement>("#lab-objects")!;
const editor = createLabEditor({
  scene, camera, canvas, shadows,
  panels: {
    left: document.querySelector<HTMLElement>("#lab-left")!,
    right: document.querySelector<HTMLElement>("#lab-right")!,
    bottom: document.querySelector<HTMLElement>("#lab-bottom")!,
    modes: document.querySelector<HTMLElement>("#lab-modes")!,
  },
  setLayout(editing, animating) {
    labRoot.classList.toggle("editing", editing);
    labRoot.classList.toggle("animating", animating);
    objectsPanel.hidden = editing;
    document.querySelector<HTMLElement>("#lab-left")!.hidden = !editing;
    document.querySelector<HTMLElement>("#lab-right")!.hidden = !editing;
    document.querySelector<HTMLElement>("#lab-bottom")!.hidden = !(editing && animating);
    clipBar.hidden = editing;
    requestAnimationFrame(() => { engine.resize(); scene.render(); });
  },
  onRigReplaced(rig) {
    displayed = rig.anchor;
    displayedRig = rig;
    attachParticles(rig);
    // The view's player must drive the new rig, and resume the looping clip once editing ends.
    clipPlayer = createClipPlayer(rig, { onEvent: (event) => { emitterHandle?.handleEvent(event); stats.textContent = `event "${event.name}" at ${event.t.toFixed(2)}s${event.swapModel ? ` → ${event.swapModel}` : ""}`; } });
  },
  particles: { fire: (id) => { emitterHandle?.fire(id); }, handleEvent: (event) => { emitterHandle?.handleEvent(event); }, stopAll: () => emitterHandle?.stopAll() },
  onStats(text) { stats.textContent = text; },
  setAutoRotate(on) { autoRotate = on; spinButton.classList.toggle("active", on); },
  onSaved(model, isNew) {
    registerModel(model, entryFor(model, catalogIndex[model.id]));
    const known = entries.find((entry) => entry.id === model.id);
    if (known) { known.label = labelFor(model); known.folder = model.folder; }
    if (isNew && !known) {
      entries.push({ id: model.id, label: labelFor(model), kind: "model", folder: model.folder });
      renderList();
    }
    if (model.id === selected) editableModel = model;
    // The saved model is the one on display once the editor closes; refresh its picture then.
    if (model.id === selected) setTimeout(() => { if (!editor.active) void captureThumbnail(model.id); }, 400);
  },
  reload() {
    const entry = entries.find((candidate) => candidate.id === selected);
    if (!entry) return;
    loadEntry(entry, { skipDirtyCheck: true });
    openEditor();
  },
});
function openEditor(): void {
  if (!editableModel || !displayedRig) return;
  clipPlayer?.stop();
  editor.open(editableModel, displayedRig);
  editButton.classList.add("active");
}
editButton.addEventListener("click", () => {
  if (editor.active) { if (!editor.dirty || window.confirm("Discard unsaved voxel edits?")) { editor.close(); editButton.classList.remove("active"); } }
  else openEditor();
});
// Saving rewrites one file in src/assets/catalog/; that module hot-swaps its
// models in place (see catalog/index.ts), so the lab keeps its state.

// Folders: a model's `folder` path groups it in the list (and decides which
// catalog file stores it). Collapsed folders are remembered per browser.
const UNFILED = "";
/** Folder of the selected model — where imports and pasted copies land. */
function currentFolder(): string | undefined { return entries.find((entry) => entry.id === selected)?.folder; }
function folderLabel(folder: string): string { return folder === UNFILED ? "Unfiled" : folder; }
async function moveModelToFolder(id: string, folder: string): Promise<void> {
  const info = catalogIndex[id];
  const entry = entries.find((candidate) => candidate.id === id);
  if (!info || !entry || (entry.folder ?? UNFILED) === folder) return;
  try {
    const response = await fetch("/__lab/rename-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: id, folder }) });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as { folder: string | null };
    const mutable = (catalog.models[id] ?? {}) as { folder?: string };
    if (result.folder) { mutable.folder = result.folder; info.folder = result.folder; } else { delete mutable.folder; delete info.folder; }
    entry.folder = info.folder;
    renderList();
    stats.textContent = `${entry.label} moved to ${folderLabel(folder)}`;
  } catch (error) {
    window.alert(`Could not move: ${(error as Error).message}`);
  }
}

// ------------------------------------------------------------------ browser --
// The object list is the shared catalog browser (src/catalogBrowser.ts): thumbnails in a
// grid, search, zone/kind/size filters, a folder rail, favourites and recents.
const browserRoot = document.querySelector<HTMLElement>("#lab-browser")!;
let draggedEntryId: string | null = null;
const browser = createCatalogBrowser({
  root: browserRoot,
  index: catalogIndex,
  labelOf,
  thumbnailUrl,
  storageKey: "farm-lab",
  hidden: HIDDEN_FROM_LAB,
  extras: [{ id: "tomato_stages", label: "Tomato · growth stages", icon: "🍅", hint: "Coded growth stages: sprout → vine → ripe (press G to grow)" }],
  idAttribute: "data-entry-id",
  onOpen(id) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    loadEntry(entry);
    browser.noteUsed(id);
  },
  onContext(id, event) { openTileMenu(id, event); },
  onDragStart(id) { draggedEntryId = id; },
  onRendered(grid) {
    // Tiles are drop targets: dropping one object onto another brings its parts in (mergeModels).
    for (const tile of grid.querySelectorAll<HTMLElement>(".cb-tile[data-entry-id]")) {
      const id = tile.dataset.entryId!;
      tile.addEventListener("dragover", (event) => { if (draggedEntryId && draggedEntryId !== id && entries.find((entry) => entry.id === id)?.kind === "model") { event.preventDefault(); tile.classList.add("drop"); } });
      tile.addEventListener("dragleave", () => tile.classList.remove("drop"));
      tile.addEventListener("drop", (event) => { event.preventDefault(); tile.classList.remove("drop"); const source = event.dataTransfer?.getData("text/plain") || draggedEntryId; const target = entries.find((entry) => entry.id === id); if (source && target && source !== id) void mergeModels(source, target); });
    }
  },
});
browserRoot.addEventListener("dragend", () => { draggedEntryId = null; });
// Folder rail buttons take drops too: move the object into that folder ("" = Unfiled).
browserRoot.addEventListener("dragover", (event) => { const folder = (event.target as HTMLElement).closest<HTMLElement>("[data-cb-folder]"); if (folder && draggedEntryId) { event.preventDefault(); folder.classList.add("drop"); } });
browserRoot.addEventListener("dragleave", (event) => { (event.target as HTMLElement).closest?.("[data-cb-folder]")?.classList.remove("drop"); });
browserRoot.addEventListener("drop", (event) => { const folder = (event.target as HTMLElement).closest<HTMLElement>("[data-cb-folder]"); if (!folder) return; event.preventDefault(); folder.classList.remove("drop"); const source = event.dataTransfer?.getData("text/plain") || draggedEntryId; if (source) void moveModelToFolder(source, folder.dataset.cbFolder ?? ""); });
function renderList(): void {
  const grid = browserRoot.querySelector<HTMLElement>(".cb-grid");
  const keepFocus = Boolean(grid && document.activeElement && grid.contains(document.activeElement));
  browser.setSelected(selected);
  browser.render();
  if (keepFocus) browser.focusSelected();
}
// Arrow keys step through the grid when nothing else owns them (focus on the page body).
// Inside the browser its own handler runs; inputs, editor panels and dialogs keep their keys.
document.addEventListener("keydown", (event) => {
  const step = event.key === "ArrowDown" ? { dy: 1 } : event.key === "ArrowUp" ? { dy: -1 } : event.key === "ArrowRight" ? { dx: 1 } : event.key === "ArrowLeft" ? { dx: -1 } : event.key === "Home" ? { to: "home" as const } : event.key === "End" ? { to: "end" as const } : null;
  if (!step || event.altKey || event.metaKey || event.ctrlKey) return;
  const target = (document.activeElement ?? document.body) as HTMLElement;
  if (target !== document.body || document.querySelector(".lab-dialog") || editor.active) return;
  const id = browser.move(step);
  if (!id) { event.preventDefault(); return; }
  event.preventDefault();
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry) { loadEntry(entry); browser.noteUsed(id); browser.focusSelected(); }
});
// Right-click menu on a tile.
let tileMenu: HTMLElement | null = null;
function closeTileMenu(): void { tileMenu?.remove(); tileMenu = null; }
function openTileMenu(id: string, event: MouseEvent): void {
  closeTileMenu();
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) return;
  const current = entries.find((candidate) => candidate.id === selected);
  const menu = document.createElement("div");
  menu.className = "lab-menu";
  const items: { label: string; action: () => void; disabled?: boolean }[] = [
    { label: "Open", action: () => { loadEntry(entry); browser.noteUsed(id); } },
    ...(entry.kind === "model" ? [
      { label: "✏️ Rename / move…", action: () => { void renameModel(entry); } },
      { label: "📄 Duplicate here", action: () => { copiedModelId = id; void pasteModelCopy(); } },
      { label: `⤵ Merge into ${current && current.kind === "model" && current.id !== id ? current.label : "the open object"}`, action: () => { if (current) void mergeModels(id, current); }, disabled: !current || current.kind !== "model" || current.id === id },
      { label: "📸 Re-render thumbnail", action: () => { void generateThumbnails([id]); } },
      { label: "🗑️ Remove…", action: () => { void deleteModel(entry); } },
    ] : []),
  ];
  for (const item of items) {
    const button = document.createElement("button");
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", () => { closeTileMenu(); item.action(); });
    menu.append(button);
  }
  document.body.append(menu);
  const width = menu.offsetWidth, height = menu.offsetHeight;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - height - 8)}px`;
  tileMenu = menu;
  const dismiss = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== "Escape") return; if (e instanceof MouseEvent && menu.contains(e.target as Node)) return; closeTileMenu(); window.removeEventListener("pointerdown", dismiss, true); window.removeEventListener("keydown", dismiss, true); };
  setTimeout(() => { window.addEventListener("pointerdown", dismiss, true); window.addEventListener("keydown", dismiss, true); }, 0);
}

// Copy / paste objects like files: Ctrl+C on the selected object, Ctrl+V makes
// "<name> copy" in the folder you are looking at (ids: <id>_copy, <id>_copy_2…).
let copiedModelId: string | null = null;
async function pasteModelCopy(): Promise<void> {
  if (copiedModelId) await ensureModels([copiedModelId]);
  const source = copiedModelId ? catalog.models[copiedModelId] : undefined;
  if (!source) { stats.textContent = "Nothing copied — select an object and press Ctrl+C first"; return; }
  const folder = currentFolder() ?? source.folder;
  let id = `${source.id}_copy`;
  for (let n = 2; catalogIndex[id]; n++) id = `${source.id}_copy_${n}`;
  const baseName = labelFor(source).replace(/ copy( \d+)?$/, "");
  const taken = new Set(Object.keys(catalogIndex).map((known) => labelOf(known)));
  let name = `${baseName} copy`;
  for (let n = 2; taken.has(name); n++) name = `${baseName} copy ${n}`;
  const copy = structuredClone(source) as AuthoredVoxelModel & { folder?: string; name?: string };
  copy.id = id;
  copy.name = name;
  if (folder) copy.folder = folder; else delete copy.folder;
  try {
    const response = await fetch("/__lab/save-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: copy }) });
    if (!response.ok) throw new Error(await response.text());
    registerModel(copy, entryFor(copy));
    const entry: LabEntry = { id, label: labelFor(copy), kind: "model", folder: copy.folder };
    entries.push(entry);
    loadEntry(entry, { skipDirtyCheck: true });
    stats.textContent = `Pasted ${name} (${id}) into ${folderLabel(folder ?? UNFILED)}`;
  } catch (error) {
    window.alert(`Could not paste: ${(error as Error).message}`);
  }
}
window.addEventListener("keydown", (event) => {
  if (editor.active || !(event.metaKey || event.ctrlKey)) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
  const key = event.key.toLowerCase();
  if (key === "c") {
    const entry = entries.find((candidate) => candidate.id === selected);
    if (entry?.kind === "model") { copiedModelId = entry.id; stats.textContent = `Copied ${entry.label} — Ctrl+V pastes a copy into the folder you are in`; event.preventDefault(); }
  } else if (key === "v") { event.preventDefault(); void pasteModelCopy(); }
});


async function deleteModel(entry: LabEntry): Promise<void> {
  if (editor.active) { window.alert("Finish editing (Done) before removing a model."); return; }
  if (!window.confirm(`Remove "${entry.label}" (${entry.id}) from the catalog? This cannot be undone from the lab.`)) return;
  const attempt = async (force: boolean) => fetch("/__lab/delete-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: entry.id, force }) });
  try {
    let response = await attempt(false);
    if (response.status === 409) {
      const { references } = (await response.json()) as { references: string[] };
      if (!window.confirm(`⚠️ The game still references "${entry.id}" in:\n\n${references.join("\n")}\n\nRemoving it will break those. Remove anyway?`)) return;
      response = await attempt(true);
    }
    if (!response.ok) throw new Error(await response.text());
    forgetModel(entry.id);
    entries.splice(entries.indexOf(entry), 1);
    if (selected === entry.id) loadEntry(entries.find((candidate) => candidate.kind === "model") ?? entries[0]!, { skipDirtyCheck: true });
    else renderList();
    stats.textContent = `Removed ${entry.id} from the catalog.`;
  } catch (error) {
    window.alert(`Remove failed: ${(error as Error).message}`);
  }
}

/** Drop one object onto another: the source's parts are pasted into the
 * target (scaled to the target's voxel size) as new parts, prefixed with the
 * source id, and the target opens in the editor for placement. A drop on the
 * 3D view also passes the point under the cursor, so the donor lands there. */
async function mergeModels(sourceId: string, target: LabEntry, dropPoint?: { clientX: number; clientY: number }): Promise<void> {
  await ensureModels([sourceId, target.id]);
  const source = catalog.models[sourceId];
  const model = catalog.models[target.id];
  if (!source || !model || target.kind !== "model") return;
  // Merging keeps real-world size: a coarse donor rescaled to a fine target
  // can explode into hundreds of thousands of cells. Say so before doing it.
  const ratio = source.pitch / model.pitch;
  const donorCells = cellsFromAuthoredModel(source).length;
  const estimate = Math.round(donorCells * ratio ** 3);
  const sizeNote = ratio > 1.05 || ratio < 0.95 ? `\n\nIt keeps its real-world size: ${donorCells} voxels become about ${estimate.toLocaleString()} cells at this model's finer/coarser pitch (×${ratio.toFixed(2)}).${estimate > 200_000 ? " That is heavy to edit — consider scaling the donor down afterwards with the part box, or importing it at a coarser pitch." : ""}` : "";
  if (!window.confirm(`Bring the parts of "${sourceId}" into "${target.id}" as new layers${dropPoint ? " at the drop point" : ""}? You can then delete the old parts and move the new ones into place.${sizeNote}`)) return;
  if (selected !== target.id || !editor.active) { loadEntry(target, { skipDirtyCheck: false }); if (!editor.active) openEditor(); }
  if (!editor.active) return;
  const drop = dropPoint ? editor.dropCell(dropPoint.clientX, dropPoint.clientY) : null;
  const added = editor.mergeModel(source, drop?.cell, drop?.part ?? undefined);
  stats.textContent = `Merged ${added} part(s) from ${sourceId} into ${target.id} with their hierarchy${drop ? ` at (${drop.cell.x}, ${drop.cell.y}, ${drop.cell.z})${drop.part ? `, attached to ${drop.part}` : ""}` : ""} (layers prefixed "${sourceId}_"). Existing voxels were left untouched. Move them into place, delete what they replace, then Save.`;
}

// The 3D view accepts object rows too: the donor lands where it is dropped.
canvas.addEventListener("dragover", (event) => {
  if (!draggedEntryId || !editableModel || draggedEntryId === editableModel.id) return;
  event.preventDefault();
  canvas.classList.add("drop-target");
});
canvas.addEventListener("dragleave", () => canvas.classList.remove("drop-target"));
canvas.addEventListener("drop", (event) => {
  canvas.classList.remove("drop-target");
  const source = event.dataTransfer?.getData("text/plain") || draggedEntryId;
  if (!source || !editableModel || source === editableModel.id) return;
  event.preventDefault();
  const target = entries.find((entry) => entry.id === editableModel!.id);
  if (target) void mergeModels(source, target, { clientX: event.clientX, clientY: event.clientY });
});

const importButton = document.querySelector<HTMLButtonElement>("#lab-import")!;
const importFile = document.querySelector<HTMLInputElement>("#lab-import-file")!;
importButton.addEventListener("click", () => importFile.click());
/** Node name → catalog id: "SM_Beer_Can_01_Asset_0" → "beer_can_01". */
function idFromNodeName(node: string): string {
  return node.replace(/^sm_/i, "").replace(/_?asset.*$/i, "").replace(/_0$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "object";
}
function slugOf(text: string): string {
  return text.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}
function titleOf(id: string): string { return id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const formatCm = (metres: number): string => (metres >= 1 ? `${metres.toFixed(2)} m` : `${(metres * 100).toFixed(metres < 0.1 ? 1 : 0)} cm`);
const formatMm = (metres: number): string => (metres >= 0.01 ? `${(metres * 100).toFixed(1)} cm` : `${(metres * 1000).toFixed(metres < 0.002 ? 2 : 1)} mm`);

type InspectedNode = { node: string; geometry: string; label?: string; material?: string; faces: number; size: [number, number, number]; center: [number, number, number] };
/** Files exported in centimetres or millimetres arrive as 250 m kitchens; a scale is applied to
 *  every size we show and send (the geometry itself is untouched — the height sets the game size). */
const UNIT_SCALES: { value: number; label: string; hint: string }[] = [
  { value: 1, label: "metres", hint: "sizes are used as they are" },
  { value: 0.01, label: "centimetres", hint: "sizes ÷ 100" },
  { value: 0.001, label: "millimetres", hint: "sizes ÷ 1000" },
  { value: 0.0254, label: "inches", hint: "sizes × 0.0254" },
];
function guessUnitScale(size: readonly number[]): number {
  const extent = Math.max(...size);
  return extent > 400 ? 0.001 : extent > 12 ? 0.01 : 1;
}
const scaled = (size: readonly number[], scale: number): [number, number, number] => [size[0]! * scale, size[1]! * scale, size[2]! * scale];
/** Meshes that share a meaningful name (a plant in a tin can: can + foliage + string under "Tin_Can_B")
 *  import as one object with one part per mesh. The inspector supplies the label. */
type ImportGroup = { key: string; id: string; nodes: InspectedNode[]; size: [number, number, number]; faces: number };
function groupInspectedNodes(nodes: InspectedNode[]): ImportGroup[] {
  const groups = new Map<string, ImportGroup>();
  for (const node of nodes) {
    const key = node.label ?? node.node;
    const group = groups.get(key) ?? { key, id: idFromNodeName(key), nodes: [], size: [0, 0, 0], faces: 0 };
    group.nodes.push(node);
    group.faces += node.faces;
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (const node of group.nodes) for (let axis = 0; axis < 3; axis++) { low[axis] = Math.min(low[axis]!, node.center[axis]! - node.size[axis]! / 2); high[axis] = Math.max(high[axis]!, node.center[axis]! + node.size[axis]! / 2); }
    group.size = [high[0]! - low[0]!, high[1]! - low[1]!, high[2]! - low[2]!];
  }
  return [...groups.values()];
}
type InspectedFile = { sourceFile: string; nodes: InspectedNode[]; size: [number, number, number]; faces?: number };
type ImportPlan =
  | { mode: "one"; id: string; name: string; worldHeight: number; detail: ImportDetail; folder: string; replace: boolean }
  | { mode: "split"; items: { group: ImportGroup; detail: ImportDetail }[]; detail: ImportDetail; folder: string; replace: boolean; unitScale: number };

/** One panel instead of a chain of browser prompts: every question, its explanation and a live
 *  estimate of the voxel size, filled in before anything is converted. Resolves null on cancel. */
function openImportPanel(file: File, inspected: InspectedFile): Promise<ImportPlan | null> {
  return new Promise((resolve) => {
    const many = inspected.nodes.length > 1;
    const fileSlug = slugOf(file.name) || "imported";
    const folders = [...new Set(entries.map((entry) => entry.folder).filter((folder): folder is string => Boolean(folder)))].sort();
    const defaultFolder = currentFolder() ?? "imports";
    const [w, h, d] = inspected.size;
    const totalFaces = inspected.faces ?? inspected.nodes.reduce((sum, node) => sum + node.faces, 0);
    const groups = groupInspectedNodes(inspected.nodes);
    let unitScale = guessUnitScale(inspected.size);
    const heights = () => groups.map((group) => group.size[1] * unitScale);
    let mode: "one" | "split" = many ? "split" : "one";
    let idTouched = false;
    let lastDetail: ImportDetail = "normal";
    try { const saved = localStorage.getItem("farm-lab-import-detail"); if (isImportDetail(saved)) lastDetail = saved; } catch { /* private mode */ }

    const element = document.createElement("div");
    element.className = "lab-dialog lab-import";
    const detailOptions = (checked: ImportDetail) => DETAIL_ORDER.map((key) => `<label class="lab-import-tier"><input type="radio" name="detail" value="${key}" ${key === checked ? "checked" : ""} /><span><b>${DETAIL_TIERS[key].label}</b> <small>${escapeHtml(DETAIL_TIERS[key].hint)}</small></span></label>`).join("");
    element.innerHTML = `
      <header><strong>📥 Import 3D object</strong><button type="button" data-import="close" title="Cancel (Esc)">✕</button></header>
      <p class="lab-import-file"><b>${escapeHtml(file.name)}</b> · ${many ? `${inspected.nodes.length} meshes${groups.length !== inspected.nodes.length ? ` in ${groups.length} named objects` : ""}` : "1 mesh"} · <span data-import="file-size"></span> · ${totalFaces.toLocaleString()} triangles</p>
      <label class="lab-import-field"><span class="lab-import-label">Units</span><span class="lab-import-inline"><select name="units">${UNIT_SCALES.map((unit) => `<option value="${unit.value}" ${unit.value === unitScale ? "selected" : ""}>${unit.label} (${unit.hint})</option>`).join("")}</select></span><small data-import="units-note"></small></label>
      ${many ? `<div class="lab-import-modes">
        <label><input type="radio" name="mode" value="split" checked /><span><b>Split into ${groups.length} objects</b><small>One catalog object per ${groups.length !== inspected.nodes.length ? "named object (meshes that share a name become parts of one object)" : "mesh"}, each at the size it has in the file (a tray of foods becomes ${groups.length} foods). <span data-import="split-range"></span></small></span></label>
        <label><input type="radio" name="mode" value="one" /><span><b>One object</b><small>The whole file becomes a single model with one part per mesh — right for a chair or a kitchen counter that was modelled in pieces.</small></span></label>
      </div>` : ""}
      <div class="lab-import-fields" data-mode="one">
        <label class="lab-import-field"><span class="lab-import-label">Name</span><input type="text" name="name" value="${escapeHtml(file.name.replace(/\.[^.]+$/, ""))}" autocomplete="off" /><small>Shown in the lab list and in the decorate library. Any text.</small></label>
        <label class="lab-import-field"><span class="lab-import-label">Id</span><input type="text" name="id" value="${fileSlug}" autocomplete="off" spellcheck="false" /><small>Stable reference for code and saved scenes: lower-case letters, digits and underscores. Follows the name until you edit it. <span data-import="id-note"></span></small></label>
        <label class="lab-import-field"><span class="lab-import-label">Height</span><span class="lab-import-inline"><input type="number" name="height" value="${(Math.min(5, Math.max(0.02, h * unitScale)) || 0.5).toFixed(2)}" min="0.01" step="0.05" /> m <span class="lab-import-presets">${[["vase", 0.3], ["plant", 0.6], ["chair", 0.9], ["person", 1.8], ["room", 2.5]].map(([label, value]) => `<button type="button" data-import="preset" data-value="${value}">${label} ${value}</button>`).join("")}</span></span><small>How tall it stands in the game, in metres. Width and depth keep the proportions of the file.</small></label>
      </div>
      <div class="lab-import-fields" data-mode="split">
        <div class="lab-import-field"><span class="lab-import-label">Objects</span><div class="lab-import-nodes">${groups.map((group, index) => `<label><input type="checkbox" name="node" value="${index}" checked /><span class="node-id">${escapeHtml(group.id)}${group.nodes.length > 1 ? ` <em>${group.nodes.length} parts</em>` : ""}</span><span class="node-size" data-index="${index}"></span><span class="node-faces">${group.faces.toLocaleString()} tri</span><select name="node-detail" data-index="${index}" title="Detail for this object only"><option value="">default</option>${DETAIL_ORDER.map((key) => `<option value="${key}">${DETAIL_TIERS[key].label}</option>`).join("")}</select></label>`).join("")}</div><small><button type="button" data-import="nodes-all">All</button> <button type="button" data-import="nodes-none">None</button> Untick anything that is not an object — a tray, a floor plane, a placeholder. Each object keeps the size it has in the file; ids come from the mesh names (or the named parent when meshes are just "Object_12"). The dropdown on a row gives that one object its own detail level; <i>default</i> follows the Detail chosen below.</small></div>
      </div>
      <div class="lab-import-field"><span class="lab-import-label">Detail</span><div class="lab-import-tiers">${detailOptions(lastDetail)}</div><small data-import="estimate"></small></div>
      <label class="lab-import-field"><span class="lab-import-label">Folder</span><input type="text" name="folder" list="lab-import-folders" value="${escapeHtml(defaultFolder)}" autocomplete="off" spellcheck="false" /><datalist id="lab-import-folders">${folders.map((folder) => `<option value="${escapeHtml(folder)}"></option>`).join("")}</datalist><small data-import="folder-note">Where it appears in the list. Use / for subfolders (kitchen/tools); leave empty for Unfiled.</small></label>
      <label class="lab-import-replace"><input type="checkbox" name="replace" /><span>Replace objects that already have the same id <small>(only within the same folder — a re-import of this pack; an id taken by another pack's object gets this collection's name added instead)</small></span></label>
      <footer><button type="button" data-import="close">Cancel</button><button type="button" class="primary" data-import="go">Import</button></footer>`;
    document.body.append(element);

    const field = <T extends HTMLElement>(selector: string) => element.querySelector<T>(selector)!;
    const nameInput = field<HTMLInputElement>("input[name=name]");
    const idInput = field<HTMLInputElement>("input[name=id]");
    const heightInput = field<HTMLInputElement>("input[name=height]");
    const folderInput = field<HTMLInputElement>("input[name=folder]");
    const replaceInput = field<HTMLInputElement>("input[name=replace]");
    const estimate = field<HTMLElement>("[data-import=estimate]");
    const idNote = field<HTMLElement>("[data-import=id-note]");
    const folderNote = field<HTMLElement>("[data-import=folder-note]");
    const goButton = field<HTMLButtonElement>("[data-import=go]");
    const unitsSelect = field<HTMLSelectElement>("select[name=units]");
    const renderSizes = () => {
      field<HTMLElement>("[data-import=file-size]").textContent = `${formatCm(w * unitScale)} × ${formatCm(h * unitScale)} × ${formatCm(d * unitScale)} in the file`;
      field<HTMLElement>("[data-import=units-note]").textContent = unitScale === 1 && Math.max(w, h, d) <= 12 ? "Sizes in the file look like metres. Change this if a knife shows as 16 m long." : unitScale === 1 ? "⚠️ The file is very large for metres — a 250 m kitchen is usually a centimetre export." : `The file is ${formatCm(Math.max(w, h, d))} across if read as metres, so it was probably exported in ${UNIT_SCALES.find((unit) => unit.value === unitScale)?.label}. Sizes below are converted.`;
      for (const cell of element.querySelectorAll<HTMLElement>(".node-size[data-index]")) { const group = groups[Number(cell.dataset.index)]!; const size = scaled(group.size, unitScale); cell.textContent = `${formatCm(size[0])} × ${formatCm(size[1])} × ${formatCm(size[2])}`; }
      const range = element.querySelector<HTMLElement>("[data-import=split-range]");
      if (range) { const hs = heights(); range.textContent = `Tallest ${formatCm(Math.max(...hs))}, smallest ${formatCm(Math.min(...hs))}.`; }
    };
    const detailValue = (): ImportDetail => { const checked = element.querySelector<HTMLInputElement>("input[name=detail]:checked")?.value; return isImportDetail(checked) ? checked : "normal"; };
    const chosenGroups = () => [...element.querySelectorAll<HTMLInputElement>("input[name=node]:checked")].map((input) => groups[Number(input.value)]!);
    const nodeDetail = (index: number, fallback: ImportDetail): ImportDetail => { const value = element.querySelector<HTMLSelectElement>(`select[name=node-detail][data-index="${index}"]`)?.value; return isImportDetail(value) ? value : fallback; };
    const chosenItems = (fallback: ImportDetail) => [...element.querySelectorAll<HTMLInputElement>("input[name=node]:checked")].map((input) => ({ group: groups[Number(input.value)]!, detail: nodeDetail(Number(input.value), fallback) }));
    const idValid = () => /^[a-z0-9_]{1,64}$/.test(idInput.value);

    const render = () => {
      for (const block of element.querySelectorAll<HTMLElement>(".lab-import-fields")) block.hidden = block.dataset.mode !== mode;
      const detail = detailValue();
      const tier = DETAIL_TIERS[detail];
      if (mode === "one") {
        const metres = Math.max(0.01, Number(heightInput.value) || 0.5);
        const plan = estimateImport(metres, detail);
        estimate.innerHTML = `At ${formatCm(metres)} tall: cubes of about <b>${formatMm(plan.voxelSize)}</b> (fine details ${formatMm(plan.fineSize)}), up to ${plan.voxelHeight} voxels high, aiming for ~${(tier.budget / 1000).toFixed(0)}k voxels. The grid is coarsened automatically if the model has more surface than that.`;
        const exists = Boolean(catalogIndex[idInput.value]);
        idNote.textContent = !idInput.value ? "" : !idValid() ? "⚠️ Only a–z, 0–9 and _ are allowed." : exists ? (replaceInput.checked ? "Replaces the existing object." : "⚠️ Already exists — tick replace below or pick another id.") : "";
        idNote.classList.toggle("warn", Boolean(idInput.value) && (!idValid() || (exists && !replaceInput.checked)));
        folderNote.textContent = "Where it appears in the list. Use / for subfolders (kitchen/tools); leave empty for Unfiled.";
        goButton.disabled = !idValid() || (exists && !replaceInput.checked);
        goButton.textContent = exists && replaceInput.checked ? "Replace" : "Import";
      } else {
        const chosen = chosenGroups();
        const sizes = chosen.map((group) => Math.max(0.02, group.size[1] * unitScale));
        const smallest = sizes.length ? Math.min(...sizes) : 0.1, tallest = sizes.length ? Math.max(...sizes) : 0.1;
        const fine = estimateImport(smallest, detail), coarse = estimateImport(tallest, detail);
        const overrides = chosenItems(detail).filter((item) => item.detail !== detail).length;
        estimate.innerHTML = `Each object gets its own grid from its real size: cubes of about <b>${formatMm(fine.voxelSize)}</b> for the ${formatCm(smallest)} ones up to <b>${formatMm(coarse.voxelSize)}</b> for the ${formatCm(tallest)} ones, each aiming for ~${(tier.budget / 1000).toFixed(0)}k voxels.${overrides ? ` <b>${overrides}</b> object${overrides === 1 ? " has its" : "s have their"} own level from the list above.` : ""}`;
        const existing = chosen.filter((group) => catalogIndex[group.id]).length;
        folderNote.textContent = "The whole collection lands here; use / for subfolders. Each collection gets its own subfolder by default.";
        goButton.disabled = chosen.length === 0;
        goButton.textContent = chosen.length ? `Import ${chosen.length} object${chosen.length === 1 ? "" : "s"}${existing ? replaceInput.checked ? ` (${existing} replaced)` : ` (${existing} renamed with the collection name)` : ""}` : "Nothing selected";
      }
    };
    const setMode = (next: "one" | "split") => {
      mode = next;
      if (!folderInput.dataset.touched) folderInput.value = next === "split" ? `${defaultFolder}/${fileSlug}` : defaultFolder;
      render();
    };
    element.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      if (target.name === "mode") setMode(target.value as "one" | "split");
      if (target.name === "name" && !idTouched) idInput.value = slugOf(target.value) || fileSlug;
      if (target.name === "id") { idTouched = true; idInput.value = idInput.value.toLowerCase(); }
      if (target.name === "folder") folderInput.dataset.touched = "1";
      if (target.name === "units") { unitScale = Number(unitsSelect.value) || 1; renderSizes(); if (mode === "one" && !heightInput.dataset.touched) heightInput.value = (Math.min(5, Math.max(0.02, h * unitScale)) || 0.5).toFixed(2); }
      if (target.name === "height") heightInput.dataset.touched = "1";
      if (target.name === "detail") { try { localStorage.setItem("farm-lab-import-detail", target.value); } catch { /* private mode */ } }
      render();
    });
    element.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-import]");
      if (!button) return;
      const action = button.dataset.import;
      if (action === "close") finish(null);
      else if (action === "preset") { heightInput.value = button.dataset.value!; render(); }
      else if (action === "nodes-all" || action === "nodes-none") { for (const input of element.querySelectorAll<HTMLInputElement>("input[name=node]")) input.checked = action === "nodes-all"; render(); }
      else if (action === "go" && !goButton.disabled) {
        const detail = detailValue(), folder = folderInput.value.trim(), replace = replaceInput.checked;
        finish(mode === "one"
          ? { mode: "one", id: idInput.value.trim(), name: nameInput.value.trim() || titleOf(idInput.value), worldHeight: Math.max(0.01, Number(heightInput.value) || 0.5), detail, folder, replace }
          : { mode: "split", items: chosenItems(detail), detail, folder, replace, unitScale });
      }
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); finish(null); }
      else if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT" && (event.target as HTMLInputElement).type !== "checkbox") { event.preventDefault(); goButton.click(); }
    };
    element.addEventListener("keydown", onKey);
    const finish = (plan: ImportPlan | null) => { element.remove(); resolve(plan); };
    renderSizes();
    setMode(mode);
    (mode === "one" ? nameInput : folderInput).focus({ preventScroll: true });
    element.scrollTop = 0;
    if (mode === "one") nameInput.select();
  });
}

// ------------------------------------------------------------- thumbnails --
// A 256² PNG of each model for the browser tiles, rendered here (the only place with a
// renderer) and stored by the dev server in src/assets/catalog/thumbs/<id>.png.
const thumbsButton = document.querySelector<HTMLButtonElement>("#lab-thumbs")!;
let thumbsRunning = false;
function missingThumbnails(): string[] { return entries.filter((entry) => entry.kind === "model" && !catalogIndex[entry.id]?.thumb).map((entry) => entry.id); }
function updateThumbsButton(): void {
  const missing = missingThumbnails().length;
  thumbsButton.textContent = thumbsRunning ? "⏳" : missing ? `📸 ${missing}` : "📸";
  thumbsButton.title = thumbsRunning ? "Rendering thumbnails…" : missing ? `Render the ${missing} missing thumbnail${missing === 1 ? "" : "s"} (pictures for the browser tiles). Shift+click re-renders every thumbnail.` : "Every object has a thumbnail. Shift+click re-renders them all.";
}
const nextFrame = () => new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
/** Capture the model currently on display as its thumbnail (transparent background, no ground). */
async function captureThumbnail(id: string): Promise<boolean> {
  if (selected !== id || !(displayedRig || displayed) || editor.active) return false;
  const clear = scene.clearColor.clone();
  const groundVisible = ground.isVisible;
  scene.clearColor = new Color4(0, 0, 0, 0);
  ground.isVisible = false;
  // Frame for a SQUARE picture: the bounding sphere of what is on display, filling the frame.
  // (The viewport framing is for the wide canvas and leaves air on the sides.)
  const radius = camera.radius, target = camera.target.clone();
  const meshes = (displayedRig?.meshes ?? (displayed?.getChildMeshes() as Mesh[]) ?? []).filter((mesh) => mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0);
  if (meshes.length) {
    meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
    let minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of meshes) { const box = mesh.getBoundingInfo().boundingBox; minimum = Vector3.Minimize(minimum, box.minimumWorld); maximum = Vector3.Maximize(maximum, box.maximumWorld); }
    const centre = minimum.add(maximum).scale(0.5);
    const sphere = maximum.subtract(minimum).length() / 2;
    camera.target = centre;
    camera.radius = Math.max(0.05, (sphere / Math.sin(camera.fov / 2)) * 0.92);
  }
  try {
    await nextFrame();
    const data = await Tools.CreateScreenshotUsingRenderTargetAsync(engine, camera, { width: 256, height: 256 }, "image/png", 4, true);
    const response = await fetch("/__lab/save-thumbnail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, data }) });
    if (!response.ok) throw new Error(await response.text());
    const saved = (await response.json()) as { thumb?: number };
    const info = catalogIndex[id];
    if (info) info.thumb = saved.thumb ?? Math.floor(Date.now() / 1000);
    return true;
  } catch (error) {
    console.warn(`thumbnail for ${id} failed: ${(error as Error).message}`);
    return false;
  } finally {
    scene.clearColor = clear;
    ground.isVisible = groundVisible;
    camera.radius = radius;
    camera.target = target;
    updateThumbsButton();
  }
}
/** Show each model in turn and capture it. Returns how many were written. */
async function generateThumbnails(ids: string[] = missingThumbnails()): Promise<number> {
  if (thumbsRunning || editor.active) return 0;
  thumbsRunning = true;
  updateThumbsButton();
  let written = 0;
  const previous = selected;
  try {
    for (const [index, id] of ids.entries()) {
      const entry = entries.find((candidate) => candidate.id === id && candidate.kind === "model");
      if (!entry) continue;
      stats.textContent = `Thumbnail ${index + 1}/${ids.length}: ${entry.label}…`;
      loadEntry(entry, { skipDirtyCheck: true });
      for (let tries = 0; tries < 200 && !(selected === id && displayedRig && isLoaded(id)); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
      if (await captureThumbnail(id)) written++;
    }
  } finally {
    thumbsRunning = false;
    updateThumbsButton();
    const back = entries.find((candidate) => candidate.id === previous);
    if (back && selected !== previous) loadEntry(back, { skipDirtyCheck: true });
    stats.textContent = `Rendered ${written} thumbnail${written === 1 ? "" : "s"}.`;
  }
  return written;
}
thumbsButton.addEventListener("click", (event) => { void generateThumbnails(event.shiftKey ? entries.filter((entry) => entry.kind === "model").map((entry) => entry.id) : undefined); });
updateThumbsButton();
Object.assign(window as unknown as Record<string, unknown>, { __labThumbs: { generate: generateThumbnails, capture: captureThumbnail, missing: missingThumbnails } });

function setImportBusy(text: string | null): void {
  importButton.disabled = text !== null;
  importButton.textContent = text ?? "📥 Import 3D object…";
}
function addImportedModel(model: AuthoredVoxelModel): LabEntry {
  registerModel(model, entryFor(model, catalogIndex[model.id]));
  let entry = entries.find((candidate) => candidate.id === model.id);
  if (entry) { entry.label = labelFor(model); entry.folder = model.folder; }
  else { entry = { id: model.id, label: labelFor(model), kind: "model", folder: model.folder }; entries.push(entry); }
  return entry;
}

async function importSplit(sourceFile: string, fileName: string, plan: Extract<ImportPlan, { mode: "split" }>): Promise<void> {
  const { items, folder, replace, unitScale } = plan;
  const nodes = items.map((item) => item.group);
  const sourceName = slugOf(fileName) || "collection";
  const levels = [...new Set(items.map((item) => DETAIL_TIERS[item.detail].label.toLowerCase()))].join("/");
  const taken = new Set(Object.keys(catalogIndex));
  const done: string[] = []; const failed: string[] = [];
  let index = 0;
  for (const { group, detail } of items) {
    index++;
    // Same id in another folder = a different object from another pack: it gets the collection's name added.
    const clash = catalogIndex[group.id];
    let id = group.id;
    if (clash && (!replace || (clash.folder ?? "") !== folder.replace(/^\/+|\/+$/g, ""))) id = `${group.id}_${sourceName}`;
    for (let n = 2; taken.has(id); n++) id = `${group.id}_${sourceName}_${n}`;
    taken.add(id);
    const name = titleOf(id);
    setImportBusy(`⏳ ${index}/${nodes.length} ${name}…`);
    const size = scaled(group.size, unitScale);
    stats.textContent = `Importing ${index}/${nodes.length}: ${name} (${formatCm(size[1])} tall, ${DETAIL_TIERS[detail].label.toLowerCase()} detail)…`;
    try {
      const response = await fetch("/__lab/import-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, name, fileName, sourceFile, sourceName, replace, worldHeight: Math.max(0.02, size[1]), footprint: size, geometry: group.nodes.map((node) => node.node).join(","), exact: true, foldFragments: 0.01, folder, detail }) });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { id: string; model: AuthoredVoxelModel };
      addImportedModel(result.model);
      done.push(result.id);
      renderList();
    } catch (error) {
      failed.push(`${group.key}: ${(error as Error).message.split("\n")[0]}`);
    }
  }
  setImportBusy(null);
  if (done.length) loadEntry(entries.find((entry) => entry.id === done[0])!, { skipDirtyCheck: true });
  if (done.length) void generateThumbnails(done);
  stats.textContent = `Imported ${done.length} of ${nodes.length} objects into ${folder || "Unfiled"} at ${levels} detail${failed.length ? ` · ${failed.length} failed (see console)` : ""}.`;
  if (failed.length) console.warn("Split import failures:\n" + failed.join("\n"));
}

async function importOne(sourceFile: string, fileName: string, footprint: [number, number, number], plan: Extract<ImportPlan, { mode: "one" }>): Promise<void> {
  const { id, name, worldHeight, detail, folder, replace } = plan;
  const geometry = ""; // advanced: node filter (run scripts/voxelize-mesh.py --geometry by hand)
  const foldFragments = 0.01; // tiny loose flakes join the part they touch; 🧹 Tidy in the lab can do more
  setImportBusy("⏳ Converting…");
  stats.textContent = `Importing ${fileName} as ${id}: voxelizing at ${DETAIL_TIERS[detail].label.toLowerCase()} detail, emitting parts, auto-rigging…`;
  try {
    const response = await fetch("/__lab/import-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, name, fileName, sourceFile, replace, worldHeight, footprint, geometry, foldFragments, folder, detail }) });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as { id: string; model: AuthoredVoxelModel; log: string; voxelHeight?: number; voxels?: number; voxelSize?: number };
    const entry = addImportedModel(result.model);
    loadEntry(entry, { skipDirtyCheck: true });
    void nextFrame().then(() => captureThumbnail(result.id));
    console.info(result.log);
    stats.textContent = `Imported ${result.id}: ${result.voxels?.toLocaleString() ?? "?"} voxels at ${result.voxelSize ? formatMm(result.voxelSize) : "?"}, ${result.model.parts.length} part(s), auto-rigged. Edit → polish, assign, animate.`;
  } catch (error) {
    window.alert(`Import failed:\n${(error as Error).message}`);
    stats.textContent = "Import failed — see the alert.";
  } finally { setImportBusy(null); }
}

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  // Upload once and look inside; the panel then asks everything in one go.
  setImportBusy("⏳ Reading file…");
  let inspected: InspectedFile | null = null;
  try {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
    const response = await fetch("/__lab/inspect-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileName: file.name, data }) });
    if (!response.ok) throw new Error(await response.text());
    inspected = (await response.json()) as InspectedFile;
  } catch (error) {
    window.alert(`Could not read the file:\n${(error as Error).message}`);
    return;
  } finally { setImportBusy(null); }
  if (!inspected) return;
  const plan = await openImportPanel(file, inspected);
  if (!plan) return;
  if (plan.mode === "split") await importSplit(inspected.sourceFile, file.name, plan);
  else await importOne(inspected.sourceFile, file.name, inspected.size, plan);
});
Object.assign(window as unknown as Record<string, unknown>, { __labImport: { openImportPanel, importSplit, importOne } });

async function renameModel(entry: LabEntry): Promise<void> {
  if (editor.active) { window.alert("Finish editing (Done) before renaming a model."); return; }
  await ensureModels([entry.id]);
  const model = catalog.models[entry.id];
  if (!model) return;
  const name = window.prompt("Display name (shown in the lab; leave empty to show the id):", model.name ?? "");
  if (name === null) return;
  const id = window.prompt("Id (stable reference used by code — lower-case letters, digits, underscores):", entry.id);
  if (id === null) return;
  const folder = window.prompt("Folder (path like plants/vegetables; empty = unfiled):", model.folder ?? "");
  if (folder === null) return;
  try {
    const response = await fetch("/__lab/rename-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: entry.id, to: id.trim() || entry.id, name, folder }) });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as { id: string; name: string | null; folder: string | null; references: string[] };
    const moved = { ...model, id: result.id } as AuthoredVoxelModel;
    if (result.name) moved.name = result.name; else delete moved.name;
    if (result.folder) moved.folder = result.folder; else delete moved.folder;
    entry.folder = moved.folder;
    const previous = catalogIndex[entry.id];
    forgetModel(entry.id);
    registerModel(moved, entryFor(moved, previous));
    entry.id = result.id;
    entry.label = labelFor(moved);
    if (selected !== result.id) { selected = result.id; loadEntry(entry, { skipDirtyCheck: true }); } else renderList();
    stats.textContent = result.references.length
      ? `Renamed to ${result.id}. Code still references the old id in: ${result.references.join(", ")} — update those by hand.`
      : `Renamed to ${result.id}${result.name ? ` ("${result.name}")` : ""}.`;
  } catch (error) {
    window.alert(`Rename failed: ${(error as Error).message}`);
  }
}

document.querySelector<HTMLButtonElement>("#lab-reset")!.addEventListener("click", resetView);
const flyButton = document.querySelector<HTMLButtonElement>("#lab-fly")!;
const speedSlider = document.querySelector<HTMLInputElement>("#lab-fly-speed")!;
const speedValue = document.querySelector<HTMLOutputElement>("#lab-fly-speed-value")!;
const helpText = document.querySelector<HTMLElement>("#lab-help")!;
let helpTimer: ReturnType<typeof setTimeout> | null = null;
const headCamera = createHeadCamera(camera, canvas, scene, {
  minRadius: CLOSEST_RADIUS,
  maxRadius: 14,
  pickable: () => displayedRig?.meshes ?? scene.meshes.filter((mesh) => mesh !== ground) as Mesh[],
  frameMeshes: () => (editor.active ? editor.selectionMeshes() : displayedRig?.meshes ?? []),
  onStatus: (text) => {
    helpText.textContent = text;
    if (helpTimer) clearTimeout(helpTimer);
    helpTimer = setTimeout(() => { helpText.textContent = headCamera.legend(); helpTimer = null; }, 1600);
  },
  onChange: () => {
    flyButton.classList.toggle("active", headCamera.flyMode);
    syncSpeedSlider();
    if (!helpTimer) helpText.textContent = headCamera.legend();
  },
});
flyButton.addEventListener("click", () => headCamera.setFlyMode(!headCamera.flyMode));
// Fly speed slider: logarithmic 0.05×…5× (50 = 0.5×), remembered across visits.
const sliderToScale = (value: number) => 0.05 * 100 ** (value / 100);
const scaleToSlider = (scale: number) => Math.round((Math.log10(scale / 0.05) / 2) * 100);
function syncSpeedSlider(): void {
  speedSlider.value = String(scaleToSlider(headCamera.speedScale));
  speedValue.textContent = `×${headCamera.speedScale.toFixed(2)}`;
}
speedSlider.addEventListener("input", () => { headCamera.setSpeedScale(sliderToScale(Number(speedSlider.value))); try { localStorage.setItem("farm-lab-fly-speed", String(headCamera.speedScale)); } catch { /* private mode */ } });
{
  let stored = 0.35;
  try { const raw = Number(localStorage.getItem("farm-lab-fly-speed")); if (raw > 0) stored = raw; } catch { /* private mode */ }
  headCamera.setSpeedScale(stored);
}
syncSpeedSlider();
helpText.textContent = headCamera.legend();
spinButton.addEventListener("click", () => { autoRotate = !autoRotate; spinButton.classList.toggle("active", autoRotate); });
let stageAutoIn = 2.4;
window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "g" || !displayedStages) return;
  requestTomatoStage(displayedStages, (displayedStages.stage + 1) % 3);
  stageAutoIn = 2.4;
});
let elapsed = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  elapsed += dt;
  if (autoRotate) camera.alpha += dt * 0.35;
  particles.update(dt);
  if (clipPlayer && !editor.active) {
    if (!clipPlayer.clip && !restRequested && displayedRig) { const loop = displayedRig.model.clips?.find((clip) => clip.loop); if (loop) clipPlayer.play(loop.id); }
    clipPlayer.update(dt);
  }
  // Pan distance per pixel shrinks with the orbit radius, so a close-up pans
  // by voxels instead of leaping across the whole object.
  camera.panningSensibility = 2100 / Math.max(CLOSEST_RADIUS, camera.radius);
  headCamera.update(dt);
  editor.update(dt);
  if (!editor.active) editButton.classList.remove("active");
  if (displayedCabbage) animateCabbageRig(displayedCabbage, elapsed);
  if (displayedStages) {
    animateTomatoStages(displayedStages, dt);
    stageAutoIn -= dt;
    if (stageAutoIn <= 0 && displayedStages.transitionAge === Infinity) {
      requestTomatoStage(displayedStages, (displayedStages.stage + 1) % 3);
      stageAutoIn = 2.4;
    }
  }

  scene.render();
});
// Resizing the canvas clears its backing store; rendering right away keeps
// panel drags from flashing black between frames.
const resizeAndRender = () => { engine.resize(); scene.render(); };
window.addEventListener("resize", resizeAndRender);
new ResizeObserver(resizeAndRender).observe(canvas);
// Dev aid for driven browser sessions (captures, editor smoke tests).
(window as unknown as { __lab: unknown }).__lab = { camera, scene };
renderList();
loadEntry(entries.find((entry) => entry.id === selected)!);
if (requestedView.get("edit") === "1") openEditor();
