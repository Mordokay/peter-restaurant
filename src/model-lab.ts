import "./model-lab.css";
import {
  ArcRotateCamera, ArcRotateCameraPointersInput, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Mesh, MeshBuilder,
  Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3,
} from "@babylonjs/core";
import { catalog as catalogData } from "./assets/catalog/index";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog, type AuthoredVoxelModel } from "./game/voxelModel";
import { visibleVoxelFaceCount } from "./game/voxelGeometry";

import { animateCabbageRig, createCabbageRig, type CabbageRig } from "./game/cabbage";
import { animateTomatoStages, createTomatoStageRig, requestTomatoStage, type TomatoStageRig } from "./game/tomatoStages";
import { TOMATO_STAGE_SECONDS } from "./game/stageTransition";
import { createLabEditor } from "./labEditor";
import { createHeadCamera } from "./labCamera";
import { createClipPlayer, createVoxelRig, type ClipPlayer, type VoxelRig } from "./game/voxelRig";

const host = document.querySelector<HTMLElement>("#model-lab")!;
host.innerHTML = `<div class="lab" id="lab-root">
  <aside class="lab-sidebar" id="lab-sidebar"><div class="lab-resize-handle" id="lab-resize" title="Drag to resize this panel"></div><div class="lab-objects" id="lab-objects"><a class="lab-back" href="/">← Back to game</a><h1>Model Lab</h1><p>Every registered production asset appears here. Inspect silhouettes at any angle before approving them.</p><input class="lab-search" id="lab-search" placeholder="Search objects" /><div class="lab-list" id="lab-list"></div><div class="lab-objects-actions"><button id="lab-import" title="Import a .glb/.gltf/.obj: it is voxelized, its parts kept and auto-rigged, and it lands in this list ready to edit and animate">📥 Import 3D object…</button><input type="file" id="lab-import-file" accept=".glb,.gltf,.obj" hidden /></div><div class="lab-panel-hint">Drag one object onto another — or onto the 3D view, where it lands at the drop point — to bring its parts in (e.g. a better tomato onto the plant). Drop onto a 📁 folder to move it there. ✏️ renames (name · id · folder) · 🗑️ removes · Ctrl+C / Ctrl+V duplicates an object into the folder you are in.</div></div><div class="lab-left-panel" id="lab-left" hidden></div></aside>
  <section class="lab-view"><canvas id="lab-canvas"></canvas><div class="lab-toolbar"><span id="lab-modes" class="lab-modes"></span><span id="lab-clips" class="lab-clips"></span><button id="lab-edit" title="Edit this voxel model: brushes, bucket, eyedropper, chunk delete, parts, rig, animation, save to the catalog">Edit</button><button id="lab-reset" title="Back to the framed view (also resets the field of view)">Reset view</button><button id="lab-fly" title="Fly mode (C): W A S D move, Q E down/up, hold the right mouse button to look. Off: the same works while holding the right button.">🎥 Fly <kbd>C</kbd></button><label class="lab-speed" title="Keyboard fly speed (W A S D / Q E)"><span>🎮</span><input type="range" id="lab-fly-speed" min="0" max="100" step="1" /><output id="lab-fly-speed-value"></output></label><button id="lab-spin">Auto rotate</button></div><div class="lab-help" id="lab-help"></div><div class="lab-stats" id="lab-stats"></div></section>
  <aside class="lab-right-panel" id="lab-right" hidden></aside>
  <footer class="lab-bottom-panel" id="lab-bottom" hidden></footer>
  <div class="lab-resize-right" id="lab-resize-right" title="Drag to resize the properties panel"></div>
  <div class="lab-resize-bottom" id="lab-resize-bottom" title="Drag to resize the timeline"></div>
</div>`;

const canvas = document.querySelector<HTMLCanvasElement>("#lab-canvas")!;
const list = document.querySelector<HTMLElement>("#lab-list")!;
const search = document.querySelector<HTMLInputElement>("#lab-search")!;
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
  ...Object.keys(catalog.models).filter((id) => !HIDDEN_FROM_LAB.has(id)).map((id) => ({ id, label: labelFor(catalog.models[id]!), kind: "model" as const, folder: catalog.models[id]!.folder })),
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
  // The folder of the object you open is never left collapsed.
  if (entry.folder !== undefined && collapsedFolders.has(entry.folder)) { collapsedFolders.delete(entry.folder); storeFolders(); }
  if (editor.active && editor.dirty && !options.skipDirtyCheck && !window.confirm("Discard unsaved voxel edits?")) return;
  editor.close();
  editableModel = null;
  clipPlayer = null;
  clipBar.replaceChildren();
  if (displayedRig) { displayedRig.dispose(); displayedRig = null; displayed = null; }
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
  if (displayedRig) { displayedRig.dispose(); displayedRig = null; }
  const rig = createVoxelRig(model, scene, { name: `inspected ${model.id}`, shadows });
  const cells = cellsFromAuthoredModel(model);
  const minY = cells.reduce((low, cell) => Math.min(low, cell.y), Infinity);
  rig.anchor.position.y = -(minY - 0.5) * model.pitch;
  displayed = rig.anchor;
  displayedRig = rig;
  clipPlayer = createClipPlayer(rig, { onEvent: (event) => { stats.textContent = `event "${event.name}" at ${event.t.toFixed(2)}s${event.swapModel ? ` → ${event.swapModel}` : ""}`; } });
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
    rest.addEventListener("click", () => { if (!editor.active) { restRequested = true; clipPlayer?.stop(); } });
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
    // The view's player must drive the new rig, and resume the looping clip once editing ends.
    clipPlayer = createClipPlayer(rig, { onEvent: (event) => { stats.textContent = `event "${event.name}" at ${event.t.toFixed(2)}s${event.swapModel ? ` → ${event.swapModel}` : ""}`; } });
  },
  onStats(text) { stats.textContent = text; },
  setAutoRotate(on) { autoRotate = on; spinButton.classList.toggle("active", on); },
  onSaved(model, isNew) {
    (catalog.models as Record<string, AuthoredVoxelModel>)[model.id] = model;
    if (isNew && !entries.some((entry) => entry.id === model.id)) {
      entries.push({ id: model.id, label: labelFor(model), kind: "model", folder: model.folder });
      renderList();
    }
    if (model.id === selected) editableModel = model;
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
const FOLDERS_KEY = "farm-lab-folders-collapsed";
const collapsedFolders = new Set<string>();
try { for (const folder of JSON.parse(window.localStorage.getItem(FOLDERS_KEY) ?? "[]") as string[]) collapsedFolders.add(folder); } catch { /* ignore */ }
const storeFolders = () => { try { window.localStorage.setItem(FOLDERS_KEY, JSON.stringify([...collapsedFolders])); } catch { /* ignore */ } };
const UNFILED = "";
/** Folder of the selected model — where imports and pasted copies land. */
function currentFolder(): string | undefined { return entries.find((entry) => entry.id === selected)?.folder; }
function folderLabel(folder: string): string { return folder === UNFILED ? "Unfiled" : folder; }
async function moveModelToFolder(id: string, folder: string): Promise<void> {
  const model = catalog.models[id];
  const entry = entries.find((candidate) => candidate.id === id);
  if (!model || !entry || (entry.folder ?? UNFILED) === folder) return;
  try {
    const response = await fetch("/__lab/rename-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: id, folder }) });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as { folder: string | null };
    const mutable = model as { folder?: string };
    if (result.folder) mutable.folder = result.folder; else delete mutable.folder;
    entry.folder = mutable.folder;
    collapsedFolders.delete(folder);
    storeFolders();
    renderList();
    stats.textContent = `${entry.label} moved to ${folderLabel(folder)}`;
  } catch (error) {
    window.alert(`Could not move: ${(error as Error).message}`);
  }
}
function itemButton(entry: LabEntry, inFolder: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = `lab-item${entry.id === selected ? " active" : ""}${inFolder ? " in-folder" : ""}`;
  const text = document.createElement("span");
  text.className = "lab-item-text";
  const name = document.createElement("span");
  name.className = "lab-item-name";
  name.textContent = entry.label;
  name.title = entry.kind === "model" ? `id: ${entry.id}` : entry.label;
  text.append(name);
  if (entry.kind === "model") { const id = document.createElement("span"); id.className = "lab-item-id"; id.textContent = entry.id; text.append(id); }
  button.append(text);
  if (entry.kind === "model") {
    const rename = document.createElement("span");
    rename.className = "lab-item-rename";
    rename.textContent = "✏️";
    rename.title = "Rename: display name, id (what code references) and folder";
    rename.addEventListener("click", (event) => { event.stopPropagation(); void renameModel(entry); });
    button.append(rename);
    const remove = document.createElement("span");
    remove.className = "lab-item-rename";
    remove.textContent = "🗑️";
    remove.title = "Remove this object from the catalog (refused while game code references it)";
    remove.addEventListener("click", (event) => { event.stopPropagation(); void deleteModel(entry); });
    button.append(remove);
    button.draggable = true;
    button.addEventListener("dragstart", (event) => { event.dataTransfer?.setData("text/plain", entry.id); button.classList.add("dragging"); });
    button.addEventListener("dragend", () => button.classList.remove("dragging"));
    button.addEventListener("dragover", (event) => { if (draggedEntryId && draggedEntryId !== entry.id) { event.preventDefault(); button.classList.add("drop"); } });
    button.addEventListener("dragleave", () => button.classList.remove("drop"));
    button.addEventListener("drop", (event) => { event.preventDefault(); button.classList.remove("drop"); const source = event.dataTransfer?.getData("text/plain"); if (source && source !== entry.id) void mergeModels(source, entry); });
  }
  button.addEventListener("click", () => loadEntry(entry));
  return button;
}
function renderList(): void {
  const query = search.value.trim().toLowerCase();
  list.replaceChildren();
  const visible = entries.filter((candidate) => candidate.label.toLowerCase().includes(query) || candidate.id.toLowerCase().includes(query) || (candidate.folder ?? "").toLowerCase().includes(query));
  for (const entry of visible.filter((candidate) => candidate.kind === "staged")) list.append(itemButton(entry, false));
  const byFolder = new Map<string, LabEntry[]>();
  for (const entry of visible.filter((candidate) => candidate.kind === "model")) {
    const folder = entry.folder ?? UNFILED;
    let bucket = byFolder.get(folder);
    if (!bucket) byFolder.set(folder, (bucket = []));
    bucket.push(entry);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)));
  for (const folder of folders) {
    const members = byFolder.get(folder)!;
    const collapsed = collapsedFolders.has(folder) && !query;
    const header = document.createElement("div");
    header.className = `lab-folder${collapsed ? " collapsed" : ""}`;
    header.title = `${folderLabel(folder)} · ${members.length} object${members.length === 1 ? "" : "s"} · click to ${collapsed ? "expand" : "collapse"} · drop an object here to move it into this folder`;
    header.innerHTML = `<span class="lab-folder-caret">${collapsed ? "▸" : "▾"}</span><span class="lab-folder-name">📁 ${folderLabel(folder).replaceAll("/", " / ")}</span><small>${members.length}</small>`;
    header.addEventListener("click", () => { if (collapsedFolders.has(folder)) collapsedFolders.delete(folder); else collapsedFolders.add(folder); storeFolders(); renderList(); });
    header.addEventListener("dragover", (event) => { if (draggedEntryId) { event.preventDefault(); header.classList.add("drop"); } });
    header.addEventListener("dragleave", () => header.classList.remove("drop"));
    header.addEventListener("drop", (event) => { event.preventDefault(); header.classList.remove("drop"); const source = event.dataTransfer?.getData("text/plain"); if (source) void moveModelToFolder(source, folder); });
    list.append(header);
    if (collapsed) continue;
    for (const entry of members) list.append(itemButton(entry, true));
  }
}

// Copy / paste objects like files: Ctrl+C on the selected object, Ctrl+V makes
// "<name> copy" in the folder you are looking at (ids: <id>_copy, <id>_copy_2…).
let copiedModelId: string | null = null;
async function pasteModelCopy(): Promise<void> {
  const source = copiedModelId ? catalog.models[copiedModelId] : undefined;
  if (!source) { stats.textContent = "Nothing copied — select an object and press Ctrl+C first"; return; }
  const folder = currentFolder() ?? source.folder;
  let id = `${source.id}_copy`;
  for (let n = 2; catalog.models[id]; n++) id = `${source.id}_copy_${n}`;
  const baseName = labelFor(source).replace(/ copy( \d+)?$/, "");
  const taken = new Set(Object.values(catalog.models).map((model) => labelFor(model)));
  let name = `${baseName} copy`;
  for (let n = 2; taken.has(name); n++) name = `${baseName} copy ${n}`;
  const copy = structuredClone(source) as AuthoredVoxelModel & { folder?: string; name?: string };
  copy.id = id;
  copy.name = name;
  if (folder) copy.folder = folder; else delete copy.folder;
  try {
    const response = await fetch("/__lab/save-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: copy }) });
    if (!response.ok) throw new Error(await response.text());
    (catalog.models as Record<string, AuthoredVoxelModel>)[id] = copy;
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

let draggedEntryId: string | null = null;
list.addEventListener("dragstart", (event) => { draggedEntryId = (event.target as HTMLElement).closest<HTMLElement>(".lab-item")?.querySelector(".lab-item-id")?.textContent ?? null; const id = event.dataTransfer?.getData("text/plain"); if (id) draggedEntryId = id; });
list.addEventListener("dragend", () => { draggedEntryId = null; });

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
    delete (catalog.models as Record<string, AuthoredVoxelModel>)[entry.id];
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
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  const suggestedId = file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "imported";
  const name = window.prompt("Display name for this object:", file.name.replace(/\.[^.]+$/, ""));
  if (name === null) return;
  const id = window.prompt("Id (stable reference used by code — lower-case letters, digits, underscores):", suggestedId);
  if (!id) return;
  const height = Number(window.prompt("Detail: height of the object in voxels (48 = chunky prop, 140 = hero plant):", "64") ?? "64");
  const worldHeight = Number(window.prompt("Size in the game: height in metres:", "0.5") ?? "0.5");
  const geometry = window.prompt("Optional: only convert nodes whose name contains… (leave empty for the whole file):", "") ?? "";
  const foldPercent = Number(window.prompt("Fold fragments: pieces smaller than this % of the largest piece join the part they touch (scans shed hundreds of flakes; 0 keeps every piece):", "1") ?? "1");
  const foldFragments = Number.isFinite(foldPercent) && foldPercent >= 0 ? foldPercent / 100 : 0.01;
  const folder = (window.prompt("Folder in the lab list (e.g. plants or kitchen/tools; empty = unfiled):", currentFolder() ?? "imports") ?? "").trim();
  importButton.disabled = true;
  importButton.textContent = "⏳ Converting…";
  stats.textContent = `Importing ${file.name} as ${id}: voxelizing, emitting parts, auto-rigging…`;
  try {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
    const response = await fetch("/__lab/import-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: id.trim(), name, fileName: file.name, data, height, worldHeight, geometry, foldFragments, folder }) });
    if (!response.ok) throw new Error(await response.text());
    const result = (await response.json()) as { id: string; model: AuthoredVoxelModel; log: string };
    (catalog.models as Record<string, AuthoredVoxelModel>)[result.id] = result.model;
    const entry: LabEntry = { id: result.id, label: labelFor(result.model), kind: "model", folder: result.model.folder };
    entries.push(entry);
    loadEntry(entry, { skipDirtyCheck: true });
    console.info(result.log);
    stats.textContent = `Imported ${result.id}: ${result.model.parts.length} part(s), auto-rigged. Edit → polish, assign, animate.`;
  } catch (error) {
    window.alert(`Import failed:\n${(error as Error).message}`);
    stats.textContent = "Import failed — see the alert.";
  } finally {
    importButton.disabled = false;
    importButton.textContent = "📥 Import 3D object…";
  }
});

async function renameModel(entry: LabEntry): Promise<void> {
  if (editor.active) { window.alert("Finish editing (Done) before renaming a model."); return; }
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
    const models = catalog.models as Record<string, AuthoredVoxelModel>;
    const moved = { ...model, id: result.id } as AuthoredVoxelModel;
    if (result.name) moved.name = result.name; else delete moved.name;
    if (result.folder) moved.folder = result.folder; else delete moved.folder;
    entry.folder = moved.folder;
    delete models[entry.id];
    models[result.id] = moved;
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

search.addEventListener("input", renderList);
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
