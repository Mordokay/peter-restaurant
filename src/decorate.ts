import "./decorate.css";
import {
  ArcRotateCamera, ArcRotateCameraPointersInput, Camera, Color3, HighlightLayer, Mesh, PositionGizmo, Quaternion, RotationGizmo, Scene, ScaleGizmo, ShadowGenerator,
  TransformNode, UtilityLayerRenderer, Vector3,
} from "@babylonjs/core";
import type { AuthoredVoxelCatalog, AuthoredVoxelModel } from "./game/voxelModel";
import { applyPropTransform, propRotation, propScale, propVisible, type DecorGroup, type DecorLayout, type DecorProp, type DecorScene } from "./game/decor";
import { createHeadCamera, type HeadCamera } from "./labCamera";

// Decorate mode: edit the game world in the game. A library of every catalog
// object (in its lab folders) on the left, click to hold one, click on a floor
// to place it; click a placed prop to select it and move / turn / scale it with
// gizmos or the fields on the right. Same head camera as the Model Lab. Saves
// go to src/assets/scene/decor.json through the dev server.

export interface DecorateHost {
  scene: Scene;
  canvas: HTMLCanvasElement;
  catalog: AuthoredVoxelCatalog;
  shadows?: ShadowGenerator;
  decor: DecorScene;
  layout: DecorLayout;
  gameCamera: ArcRotateCamera;
  /** Floors and grounds a prop may be dropped on. */
  isSurface: (mesh: Mesh) => boolean;
  /** Called with the decorate camera on enter and null on exit (attach post-processing). */
  onCameraSwap?: (camera: Camera | null) => void;
}

export interface DecorateMode {
  readonly active: boolean;
  toggle(): void;
  update(dt: number): void;
  /** Dev aid for driven browser checks. */
  debug(): Record<string, unknown>;
}

const SNAP = 0.1;
const HISTORY_DEPTH = 100;
const SELECTION_COLOR = "#38d3e0";

const labelFor = (model: AuthoredVoxelModel): string => model.name ?? model.id.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export function createDecorateMode(host: DecorateHost): DecorateMode {
  const { scene, canvas, catalog, decor, layout } = host;
  let active = false;
  let root: HTMLElement | null = null;
  let camera: ArcRotateCamera | null = null;
  let head: HeadCamera | null = null;
  let utility: UtilityLayerRenderer | null = null;
  let positionGizmo: PositionGizmo | null = null;
  let rotationGizmo: RotationGizmo | null = null;
  let scaleGizmo: ScaleGizmo | null = null;
  let highlight: HighlightLayer | null = null;
  let gizmoMode: "none" | "move" | "turn" | "scale" = "move";
  let selected: string | null = null;
  /** Model held for placement and its ghost rig following the pointer. */
  let holding: { model: string; ghost: ReturnType<DecorScene["add"]>; yaw: number } | null = null;
  let snap = true;
  let status = "";
  let dirty = false;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const collapsed = new Set<string>();
  /** Collapsed groups in the Placed list, and the multi-selection used for grouping. */
  const collapsedGroups = new Set<string>();
  const selectedSet = new Set<string>();
  let dragging = false;
  let pressAt: { x: number; y: number } | null = null;
  /** Grab-and-drag of a placed prop's body along its floor plane. */
  let bodyDrag: { id: string; startPoint: Vector3; startPos: [number, number, number]; moved: boolean; others: { id: string; startPos: [number, number, number] }[] } | null = null;
  /** Shared pivot for multi-selection gizmo edits (sits at the centroid of the selected anchors). */
  let groupNode: TransformNode | null = null;
  /** Copied prop records (Ctrl+C); pasted at the pointer or beside the originals. Survives reloads. */
  let clipboard: DecorProp[] = [];
  try { clipboard = JSON.parse(localStorage.getItem("farm-decor-clipboard") ?? "[]") as DecorProp[]; } catch { /* ignore */ }
  let lastPointer: { clientX: number; clientY: number } | null = null;
  let groupDragging = false;
  let contextMenu: HTMLElement | null = null;
  /** A library item is being dragged into the world (release materialises it). */
  let libraryDrag: { model: string; startX: number; startY: number; moved: boolean } | null = null;

  // ------------------------------------------------------------- helpers --
  const snapValue = (value: number) => (snap ? Math.round(value / SNAP) * SNAP : value);
  const round3 = (value: number) => Math.round(value * 1000) / 1000;
  const snapshot = () => JSON.stringify({ props: layout.props, groups: layout.groups ?? [] });
  function pushUndo(): void {
    undoStack.push(snapshot());
    if (undoStack.length > HISTORY_DEPTH) undoStack.shift();
    redoStack.length = 0;
    dirty = true;
  }
  function restore(json: string): void {
    const parsed = JSON.parse(json) as { props: DecorProp[]; groups: DecorGroup[] } | DecorProp[];
    const props = Array.isArray(parsed) ? parsed : parsed.props;
    layout.groups = Array.isArray(parsed) ? layout.groups ?? [] : parsed.groups;
    for (const id of [...decor.placed.keys()]) decor.remove(id);
    layout.props.splice(0, layout.props.length, ...props);
    for (const id of [...selectedSet]) if (!props.some((prop) => prop.id === id)) selectedSet.delete(id);
    for (const prop of layout.props) decor.add(prop);
    if (selected && !decor.placed.has(selected)) selected = null;
    dirty = true;
    syncSelection();
    render();
  }
  function uniqueId(model: string): string {
    let n = 1;
    let id = `${model}_${n}`;
    while (layout.props.some((prop) => prop.id === id)) id = `${model}_${++n}`;
    return id;
  }
  /** Surface under the pointer: the point and the face normal (a wall stands a prop up against it). */
  function pickSurfaceHit(event: { clientX: number; clientY: number }): { point: Vector3; normal: Vector3 } | null {
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    const pick = scene.pick((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), (mesh) => host.isSurface(mesh as Mesh) && !(mesh.metadata as { decorId?: string } | null)?.decorId, false, camera);
    if (!pick?.hit || !pick.pickedPoint) return null;
    return { point: pick.pickedPoint, normal: pick.getNormal(true) ?? Vector3.Up() };
  }
  function pickSurface(event: { clientX: number; clientY: number }): Vector3 | null { return pickSurfaceHit(event)?.point ?? null; }
  /** Rotation (degrees) that stands a prop's up axis along a surface normal; floors keep the given yaw. */
  function rotationForSurface(normal: Vector3, yaw: number): [number, number, number] {
    if (normal.y > 0.7) return [0, yaw, 0];
    const q = Quaternion.FromUnitVectorsToRef(Vector3.Up(), normal.normalizeToNew(), new Quaternion());
    const euler = q.toEulerAngles();
    const deg = (r: number) => Math.round((((r * 180) / Math.PI) % 360 + 360) % 360);
    return [deg(euler.x), deg(euler.y), deg(euler.z)];
  }
  function pickProp(event: PointerEvent): string | null {
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    const pick = scene.pick((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), (mesh) => !!(mesh.metadata as { decorId?: string } | null)?.decorId && mesh.isPickable, false, camera);
    return pick?.hit ? ((pick.pickedMesh?.metadata as { decorId?: string } | null)?.decorId ?? null) : null;
  }
  function selectedProp(): DecorProp | undefined { return layout.props.find((prop) => prop.id === selected); }
  /** Is a gizmo handle under the pointer? Then the gizmo owns the drag, not the body grab. */
  function pointerOnGizmo(event: { clientX: number; clientY: number }): boolean {
    if (!utility || !camera) return false;
    const rect = canvas.getBoundingClientRect();
    const pick = utility.utilityLayerScene.pick((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), (mesh) => mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0, false, camera);
    return !!pick?.hit;
  }
  /** Clips pause while you drag a prop or its gizmo (handles must not sway away), and resume on release. */
  const pausedClips = new Map<string, { clip: string; time: number }>();
  function pausePropClip(id: string): void {
    const placed = decor.placed.get(id);
    if (!placed || pausedClips.has(id) || !placed.player.clip) return;
    pausedClips.set(id, { clip: placed.player.clip.id, time: placed.player.time });
    placed.player.pause();
  }
  function resumePropClip(id: string): void {
    const placed = decor.placed.get(id);
    const paused = pausedClips.get(id);
    pausedClips.delete(id);
    if (!placed || !paused) return;
    placed.player.play(paused.clip, { loop: true, from: paused.time });
  }
  /** Where the pointer ray crosses the horizontal plane at height y. */
  function pointOnPlane(event: { clientX: number; clientY: number }, y: number): Vector3 | null {
    if (!camera) return null;
    const rect = canvas.getBoundingClientRect();
    const ray = scene.createPickingRay((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), null, camera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    return t > 0 ? ray.origin.add(ray.direction.scale(t)) : null;
  }
  function setCameraOrbit(_enabled: boolean): void { /* left-drag never orbits in decorate mode */ }

  // -------------------------------------------------------------- gizmos --
  /** Every selected prop id (the multi-selection, or just the active one). */
  function selectionIds(): string[] {
    const ids = new Set(selectedSet);
    if (selected) ids.add(selected);
    return [...ids].filter((id) => decor.placed.has(id));
  }
  function syncSelection(): void {
    highlight?.removeAllMeshes();
    const ids = selectionIds();
    const members = ids.map((id) => decor.placed.get(id)!);
    let node: TransformNode | null = null;
    if (members.length > 1 && !groupDragging) {
      // Pivot at the centroid of the anchors: gizmos move / turn / scale everyone around it.
      if (!groupNode) groupNode = new TransformNode("decorate selection pivot", scene);
      const centre = members.reduce((acc, placed) => acc.addInPlace(placed.root.position), new Vector3()).scaleInPlace(1 / members.length);
      groupNode.position.copyFrom(centre);
      groupNode.rotation.set(0, 0, 0);
      groupNode.rotationQuaternion = null;
      groupNode.scaling.setAll(1);
      node = groupNode;
    } else if (members.length === 1) node = members[0]!.root;
    else if (groupDragging && groupNode) node = groupNode;
    if (positionGizmo) positionGizmo.attachedNode = gizmoMode === "move" ? node : null;
    if (rotationGizmo) rotationGizmo.attachedNode = gizmoMode === "turn" ? node : null;
    if (scaleGizmo) scaleGizmo.attachedNode = gizmoMode === "scale" ? node : null;
    if (highlight) for (const placed of members) for (const mesh of placed.rig.meshes) highlight.addMesh(mesh, Color3.FromHexString(SELECTION_COLOR));
  }
  /** Group drag start: members ride on the pivot node (world transforms kept). */
  function beginGroupDrag(): void {
    if (!groupNode || selectionIds().length < 2) return;
    groupDragging = true;
    pushUndo();
    for (const id of selectionIds()) { const placed = decor.placed.get(id)!; pausePropClip(id); placed.root.setParent(groupNode); }
  }
  /** Group drag end: bake each member's world transform back into its record. */
  function endGroupDrag(): void {
    if (!groupDragging) return;
    groupDragging = false;
    for (const id of selectionIds()) {
      const placed = decor.placed.get(id)!;
      const prop = layout.props.find((candidate) => candidate.id === id)!;
      placed.root.setParent(null);
      const euler = placed.root.rotationQuaternion ? placed.root.rotationQuaternion.toEulerAngles() : placed.root.rotation.clone();
      placed.root.rotationQuaternion = null;
      const deg = (r: number) => { let v = (r * 180) / Math.PI; if (snap) v = Math.round(v / 15) * 15; return round3(((v % 360) + 360) % 360); };
      prop.position = [round3(snapValue(placed.root.position.x)), round3(placed.root.position.y), round3(snapValue(placed.root.position.z))];
      prop.rotation = [deg(euler.x), deg(euler.y), deg(euler.z)];
      delete prop.rotationY;
      const axis = (value: number) => round3(Math.max(0.05, snap ? Math.round(value * 20) / 20 : value));
      const scale: [number, number, number] = [axis(placed.root.scaling.x), axis(placed.root.scaling.y), axis(placed.root.scaling.z)];
      prop.scale = scale[0] === scale[1] && scale[1] === scale[2] ? scale[0] : scale;
      applyPropTransform(placed);
      resumePropClip(id);
    }
    status = `${selectionIds().length} objects transformed around their centre`;
    syncSelection();
    render();
  }
  function readBackFromNode(): void {
    const prop = selectedProp();
    const placed = selected ? decor.placed.get(selected) : undefined;
    if (!prop || !placed) return;
    pushUndo();
    const p = placed.root.position;
    prop.position = [round3(snapValue(p.x)), round3(p.y), round3(snapValue(p.z))]; // height follows the floor, never the grid
    const degrees = (radians: number) => { let value = (radians * 180) / Math.PI; if (snap) value = Math.round(value / 15) * 15; return round3(((value % 360) + 360) % 360); };
    prop.rotation = [degrees(placed.root.rotation.x), degrees(placed.root.rotation.y), degrees(placed.root.rotation.z)];
    delete prop.rotationY;
    const axis = (value: number) => round3(Math.max(0.05, snap ? Math.round(value * 20) / 20 : value));
    const scale: [number, number, number] = [axis(placed.root.scaling.x), axis(placed.root.scaling.y), axis(placed.root.scaling.z)];
    prop.scale = scale[0] === scale[1] && scale[1] === scale[2] ? scale[0] : scale; // per axis when they differ
    applyPropTransform(placed);
    status = `${prop.id}: (${prop.position.join(", ")}) · rot (${prop.rotation.join(", ")})° · scale ${typeof prop.scale === "number" ? `×${prop.scale}` : `(${prop.scale.join(", ")})`}`;
    render();
  }

  // ------------------------------------------------------------ actions --
  function hold(model: string): void {
    counters.holds++;
    releaseHold();
    const ghost = decor.add({ id: "__ghost", model, position: [0, -100, 0], rotation: [0, 0, 0], scale: 1 });
    if (!ghost) return;
    for (const mesh of ghost.rig.meshes) mesh.isPickable = false;
    holding = { model, ghost, yaw: 0 };
    selected = null;
    syncSelection();
    status = `Holding ${labelFor(catalog.models[model]!)} — click a floor to place, R turns, Esc cancels`;
    render();
  }
  function releaseHold(): void {
    if (!holding) return;
    decor.remove("__ghost");
    layout.props.splice(layout.props.findIndex((prop) => prop.id === "__ghost") >>> 0, layout.props.some((prop) => prop.id === "__ghost") ? 1 : 0);
    holding = null;
  }
  function placeHeld(at: Vector3): void {
    counters.placeCalls++;
    if (!holding) return;
    const ghostProp = holding.ghost!.prop;
    pushUndo();
    const prop: DecorProp = { id: uniqueId(holding.model), model: holding.model, position: [round3(snapValue(at.x)), round3(at.y), round3(snapValue(at.z))], rotation: propRotation(ghostProp), scale: ghostProp.scale ?? 1 };
    const model = holding.model;
    const yaw = propRotation(ghostProp);
    const heldYaw = holding.yaw;
    releaseHold();
    layout.props.push(prop);
    decor.add(prop);
    selected = prop.id;
    status = `Placed ${prop.id} — click another spot to place more, Esc to stop`;
    // Keep holding the same model for quick repeats, with the same yaw.
    const ghost = decor.add({ id: "__ghost", model, position: [at.x, at.y, at.z], rotation: yaw, scale: prop.scale });
    if (ghost) { for (const mesh of ghost.rig.meshes) mesh.isPickable = false; holding = { model, ghost, yaw: heldYaw }; }
    syncSelection();
    render();
  }
  function deleteSelected(): void {
    const ids = selectedSet.size ? [...selectedSet] : selected ? [selected] : [];
    if (!ids.length) return;
    pushUndo();
    for (const id of ids) { const index = layout.props.findIndex((prop) => prop.id === id); if (index >= 0) layout.props.splice(index, 1); decor.remove(id); }
    status = ids.length === 1 ? `Removed ${ids[0]}` : `Removed ${ids.length} objects`;
    selected = null;
    selectedSet.clear();
    syncSelection();
    render();
  }
  function duplicateSelected(): void {
    const ids = selectionIds();
    if (!ids.length) return;
    pushUndo();
    const copies: string[] = [];
    for (const id of ids) {
      const prop = layout.props.find((candidate) => candidate.id === id)!;
      const copy: DecorProp = { ...prop, position: [round3(prop.position[0] + 0.3), prop.position[1], round3(prop.position[2] + 0.3)], id: uniqueId(prop.model) };
      layout.props.push(copy);
      decor.add(copy);
      copies.push(copy.id);
    }
    selectedSet.clear();
    for (const id of copies) if (copies.length > 1) selectedSet.add(id);
    selected = copies[copies.length - 1]!;
    status = copies.length === 1 ? `Duplicated as ${copies[0]}` : `Duplicated ${copies.length} objects`;
    syncSelection();
    render();
  }
  function turnSelected(degrees: number): void {
    const turn = (prop: DecorProp) => { const rotation = propRotation(prop); rotation[1] = ((rotation[1] + degrees) % 360 + 360) % 360; prop.rotation = rotation; delete prop.rotationY; };
    if (holding) { holding.yaw = ((holding.yaw + degrees) % 360 + 360) % 360; const ghost = holding.ghost!; turn(ghost.prop); applyPropTransform(ghost); return; }
    const prop = selectedProp();
    if (!prop) return;
    pushUndo();
    turn(prop);
    decor.refresh(prop.id);
    render();
  }
  function groups(): DecorGroup[] { layout.groups ??= []; return layout.groups; }
  function groupSelection(): void {
    const ids = selectedSet.size ? [...selectedSet] : selected ? [selected] : [];
    if (!ids.length) { status = "Select one or more placed objects first (Ctrl+click adds)"; render(); return; }
    const name = window.prompt("Group name (e.g. wall tools, autumn table):", `group ${groups().length + 1}`)?.trim();
    if (!name) return;
    pushUndo();
    if (!groups().some((group) => group.id === name)) groups().push({ id: name });
    for (const prop of layout.props) if (ids.includes(prop.id)) prop.group = name;
    collapsedGroups.delete(name);
    status = `${ids.length} object(s) grouped as “${name}” — the group's 👁 hides them all`;
    render();
  }
  function ungroup(id: string): void {
    pushUndo();
    for (const prop of layout.props) if (prop.group === id) delete prop.group;
    layout.groups = groups().filter((group) => group.id !== id);
    decor.refreshVisibility();
    status = `Ungrouped “${id}”`;
    render();
  }
  function toggleGroupHidden(id: string): void {
    const group = groups().find((candidate) => candidate.id === id);
    if (!group) return;
    pushUndo();
    if (group.hidden) delete group.hidden; else group.hidden = true;
    decor.refreshVisibility();
    if (selected && !propVisible(layout.props.find((prop) => prop.id === selected)!, layout)) { selected = null; syncSelection(); }
    render();
  }
  function togglePropHidden(id: string): void {
    const prop = layout.props.find((candidate) => candidate.id === id);
    if (!prop) return;
    pushUndo();
    if (prop.hidden) delete prop.hidden; else prop.hidden = true;
    decor.refreshVisibility();
    if (selected === id && prop.hidden) { selected = null; syncSelection(); }
    render();
  }
  function moveToGroup(id: string, group: string | undefined): void {
    const prop = layout.props.find((candidate) => candidate.id === id);
    if (!prop || (prop.group ?? undefined) === group) return;
    pushUndo();
    if (group) prop.group = group; else delete prop.group;
    decor.refreshVisibility();
    render();
  }
  function copySelection(): void {
    const ids = selectionIds();
    if (!ids.length) { status = "Nothing selected to copy"; render(); return; }
    clipboard = ids.map((id) => JSON.parse(JSON.stringify(layout.props.find((prop) => prop.id === id))) as DecorProp);
    try { localStorage.setItem("farm-decor-clipboard", JSON.stringify(clipboard)); } catch { /* ignore */ }
    status = `Copied ${clipboard.length} object${clipboard.length === 1 ? "" : "s"} — Ctrl+V pastes them at the pointer (or beside the originals)`;
    render();
  }
  function pasteClipboard(): void {
    if (!clipboard.length) { status = "Nothing copied yet — select objects and press Ctrl+C"; render(); return; }
    pushUndo();
    // Keep the arrangement: move the copies' centroid to the pointer's floor hit when it is over the view, else nudge them aside.
    const centroid = clipboard.reduce((acc, prop) => [acc[0] + prop.position[0] / clipboard.length, acc[1] + prop.position[1] / clipboard.length, acc[2] + prop.position[2] / clipboard.length], [0, 0, 0]);
    const at = lastPointer && !(document.elementFromPoint(lastPointer.clientX, lastPointer.clientY)?.closest(".decorate")) ? pickSurface(lastPointer) : null;
    const shift: [number, number, number] = at ? [round3(snapValue(at.x) - centroid[0]), round3(at.y - centroid[1]), round3(snapValue(at.z) - centroid[2])] : [0.3, 0, 0.3];
    const pasted: string[] = [];
    for (const source of clipboard) {
      const copy: DecorProp = { ...JSON.parse(JSON.stringify(source)) as DecorProp, id: uniqueId(source.model), position: [round3(source.position[0] + shift[0]), round3(source.position[1] + shift[1]), round3(source.position[2] + shift[2])] };
      if (copy.group && !groups().some((group) => group.id === copy.group)) delete copy.group;
      layout.props.push(copy);
      decor.add(copy);
      pasted.push(copy.id);
    }
    selectedSet.clear();
    if (pasted.length > 1) for (const id of pasted) selectedSet.add(id);
    selected = pasted[pasted.length - 1]!;
    status = `Pasted ${pasted.length} object${pasted.length === 1 ? "" : "s"}${at ? " at the pointer" : ""}`;
    syncSelection();
    render();
  }
  function undo(): void { const json = undoStack.pop(); if (json === undefined) return; redoStack.push(snapshot()); restore(json); status = "Undo"; render(); }
  function redo(): void { const json = redoStack.pop(); if (json === undefined) return; undoStack.push(snapshot()); restore(json); status = "Redo"; render(); }
  async function save(): Promise<void> {
    releaseHold();
    const clean: DecorLayout = { version: 1, props: layout.props.filter((prop) => prop.id !== "__ghost"), groups: groups().filter((group) => layout.props.some((prop) => prop.group === group.id)) };
    try {
      const response = await fetch("/__lab/save-scene", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ layout: clean }) });
      if (!response.ok) throw new Error(await response.text());
      dirty = false;
      status = `Saved ${clean.props.length} prop(s) to src/assets/scene/decor.json`;
    } catch (error) {
      status = `Save failed: ${(error as Error).message}`;
    }
    render();
  }

  // --------------------------------------------------------------- input --
  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest?.(".decorate")) return;
    pressAt = { x: event.clientX, y: event.clientY };
    dragging = false;
    if (holding) return;
    counters.canvasDowns++;
    if (pointerOnGizmo(event)) { counters.gizmoPresses++; pressAt = null; return; } // the gizmo handles this press
    // Grab a prop by its body: it follows the pointer along its floor plane.
    const hit = pickProp(event);
    const prop = hit ? layout.props.find((candidate) => candidate.id === hit) : undefined;
    if (hit && prop) {
      const startPoint = pointOnPlane(event, prop.position[1]);
      if (startPoint) {
        const partners = selectedSet.has(hit) ? selectionIds().filter((id) => id !== hit) : [];
        counters.bodyDrags++;
        bodyDrag = { id: hit, startPoint, startPos: [...prop.position] as [number, number, number], moved: false, others: partners.map((id) => ({ id, startPos: [...layout.props.find((candidate) => candidate.id === id)!.position] as [number, number, number] })) };
        setCameraOrbit(false);
        pausePropClip(hit);
        for (const other of partners) pausePropClip(other);
        // Shift+click adds to the selection (the drag still moves only the grabbed prop).
        if (event.shiftKey) { if (selected) selectedSet.add(selected); selectedSet.add(hit); }
        else if (!selectedSet.has(hit)) selectedSet.clear();
        if (selected !== hit) { selected = hit; syncSelection(); render(); } else render();
      }
    }
  }
  function onPointerMove(event: PointerEvent): void {
    counters.moves++;
    lastPointer = { clientX: event.clientX, clientY: event.clientY };
    if (pressAt && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) > 5) dragging = true;
    if (libraryDrag && !libraryDrag.moved && Math.hypot(event.clientX - libraryDrag.startX, event.clientY - libraryDrag.startY) > 6) {
      // Dragging out of the library: the ghost appears as soon as the pointer is over a floor.
      libraryDrag.moved = true;
      hold(libraryDrag.model);
    }
    if (bodyDrag) {
      const prop = layout.props.find((candidate) => candidate.id === bodyDrag!.id);
      const placed = decor.placed.get(bodyDrag.id);
      const point = pointOnPlane(event, bodyDrag.startPos[1]);
      if (prop && placed && point && dragging) {
        bodyDrag.moved = true;
        const delta = point.subtract(bodyDrag.startPoint);
        prop.position = [round3(snapValue(bodyDrag.startPos[0] + delta.x)), bodyDrag.startPos[1], round3(snapValue(bodyDrag.startPos[2] + delta.z))];
        applyPropTransform(placed);
        for (const other of bodyDrag.others) {
          const otherProp = layout.props.find((candidate) => candidate.id === other.id); const otherPlaced = decor.placed.get(other.id);
          if (otherProp && otherPlaced) { otherProp.position = [round3(snapValue(other.startPos[0] + delta.x)), other.startPos[1], round3(snapValue(other.startPos[2] + delta.z))]; applyPropTransform(otherPlaced); }
        }
        status = `${prop.id}: (${prop.position.join(", ")})`;
        const statusEl = root?.querySelector(".decorate-status");
        if (statusEl) statusEl.textContent = status;
      }
      return;
    }
    if (holding?.ghost) {
      const hit = pickSurfaceHit(event);
      if (hit) {
        const ghost = holding.ghost;
        ghost.prop.position = [snapValue(hit.point.x), hit.point.y, snapValue(hit.point.z)];
        const yaw = holding.yaw;
        ghost.prop.rotation = rotationForSurface(hit.normal, yaw);
        applyPropTransform(ghost);
      }
    }
  }
  function onPointerUp(event: PointerEvent): void {
    counters.ups++;
    if (event.button !== 0) return;
    if (libraryDrag) {
      const drag = libraryDrag;
      libraryDrag = null;
      if (drag.moved) {
        // Released over a floor: the ghost materialises there and the hand is empty again.
        const overPanel = (event.target as HTMLElement | null)?.closest?.(".decorate");
        const at = overPanel ? null : pickSurface(event);
        if (at && holding) { placeHeld(at); releaseHold(); status = `Placed ${selected} — drag it by its body to move, R turns, Del removes`; render(); }
        else { releaseHold(); status = at ? "" : "Dropped outside the floor — nothing placed"; render(); }
        pressAt = null; dragging = false;
        return;
      }
      // No movement: a plain click keeps the model in hand for repeated placing.
      hold(drag.model);
      pressAt = null; dragging = false;
      return;
    }
    if (bodyDrag) {
      const drag = bodyDrag;
      bodyDrag = null;
      setCameraOrbit(true);
      resumePropClip(drag.id);
      for (const other of drag.others) resumePropClip(other.id);
      pressAt = null; dragging = false;
      if (drag.moved) {
        // Undo restores the positions from before the grab.
        const moved = [drag, ...drag.others].map((entry) => ({ prop: layout.props.find((candidate) => candidate.id === entry.id), startPos: entry.startPos }));
        const after = moved.map((entry) => entry.prop ? [...entry.prop.position] as [number, number, number] : null);
        for (const entry of moved) if (entry.prop) entry.prop.position = entry.startPos;
        pushUndo();
        moved.forEach((entry, index) => { if (entry.prop && after[index]) entry.prop.position = after[index]!; });
        syncSelection();
        render();
      }
      return;
    }
    if (!pressAt) return;
    const wasDrag = dragging;
    pressAt = null;
    dragging = false;
    if (wasDrag || (event.target as HTMLElement | null)?.closest?.(".decorate")) return;
    if (holding) { const at = pickSurface(event); if (at) placeHeld(at); return; }
    const hit = pickProp(event);
    counters.selectsOnUp++;
    if (event.shiftKey && hit) { if (selected) selectedSet.add(selected); if (selectedSet.has(hit) && hit !== selected) selectedSet.delete(hit); else selectedSet.add(hit); selected = hit; syncSelection(); render(); return; }
    if (hit !== selected) { selected = hit; selectedSet.clear(); syncSelection(); status = hit ? `${hit} selected — drag its body or the gizmo (W move · R rotate · T scale), Shift+R turns 90°, Del removes, Ctrl+D duplicates` : ""; render(); }
  }
  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    const key = event.key.toLowerCase();
    const meta = event.metaKey || event.ctrlKey;
    if (key === "escape") { if (holding) { releaseHold(); status = ""; render(); } else if (selected) { selected = null; syncSelection(); render(); } else toggle(); event.preventDefault(); return; }
    if (meta && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (meta && key === "y") { event.preventDefault(); redo(); return; }
    if (meta && key === "s") { event.preventDefault(); void save(); return; }
    if (meta && key === "d") { event.preventDefault(); duplicateSelected(); return; }
    if (meta && key === "c") { event.preventDefault(); copySelection(); return; }
    if (meta && key === "v") { event.preventDefault(); pasteClipboard(); return; }
    if (key === "delete" || key === "backspace") { if (selected) { event.preventDefault(); deleteSelected(); } return; }
    // Same gizmo hotkeys as the Model Lab: Q none · W move · R rotate · T scale (Shift+R / Shift+T: turn 90° / -90°).
    if (key === "r" && !meta && event.shiftKey) { event.preventDefault(); turnSelected(90); return; }
    if (key === "t" && !meta && event.shiftKey) { event.preventDefault(); turnSelected(-90); return; }
    if (key === "w" && !meta) { gizmoMode = "move"; syncSelection(); render(); return; }
    if (key === "r" && !meta) { gizmoMode = "turn"; syncSelection(); render(); return; }
    if (key === "t" && !meta) { gizmoMode = "scale"; syncSelection(); render(); return; }
    if (key === "q" && !meta) { gizmoMode = "none"; syncSelection(); render(); return; }
  }

  // ----------------------------------------------------------------- DOM --
  function render(): void {
    if (!root) return;
    // While an item is being dragged out of the library, keep the DOM stable
    // (rebuilding it would pull the pressed button out from under the pointer).
    if (libraryDrag?.moved) { const statusEl = root.querySelector(".decorate-status"); if (statusEl) statusEl.textContent = status; return; }
    const folders = new Map<string, AuthoredVoxelModel[]>();
    for (const model of Object.values(catalog.models)) { const folder = model.folder ?? ""; let list = folders.get(folder); if (!list) folders.set(folder, (list = [])); list.push(model); }
    const folderNames = [...folders.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
    const prop = selectedProp();
    const props = layout.props.filter((candidate) => candidate.id !== "__ghost");
    // The panels are rebuilt from scratch; keep their scroll positions so an edit does not jump you to the top.
    const scrolls = [".decorate-library", ".decorate-props"].map((selector) => root!.querySelector<HTMLElement>(selector)?.scrollTop ?? 0);
    root.innerHTML = `
      <div class="decorate-top">
        <strong>🛠 Decorate mode</strong>
        <span class="decorate-status">${escapeHtml(status)}</span>
        <span class="decorate-grow"></span>
        <label class="decorate-toggle" title="Snap positions to ${SNAP} m, angles to 15°, scale to 0.05"><input type="checkbox" data-act="snap" ${snap ? "checked" : ""} /> snap</label>
        <label class="decorate-speed" title="Keyboard fly speed (W A S D / Q E)"><span>🎮</span><input type="range" data-act="fly-speed" min="0" max="100" step="1" value="${Math.round((Math.log10((head?.speedScale ?? 0.35) / 0.05) / 2) * 100)}" /><output>×${(head?.speedScale ?? 0.35).toFixed(2)}</output></label>
        <button data-act="undo" ${undoStack.length ? "" : "disabled"} title="Undo (Ctrl+Z)">↶</button><button data-act="redo" ${redoStack.length ? "" : "disabled"} title="Redo (Ctrl+Shift+Z)">↷</button>
        <button data-act="save" class="${dirty ? "primary" : ""}" title="Write src/assets/scene/decor.json (Ctrl+S)">💾 Save${dirty ? " *" : ""}</button>
        <button data-act="done" title="Leave decorate mode (Esc)">✅ Done</button>
      </div>
      <aside class="decorate-library">
        <header><strong>📚 Library</strong><small>drag onto any surface — floors, counters, walls (it stands up against them) — or click to hold and place repeatedly</small></header>
        ${folderNames.map((folder) => `<div class="decorate-folder ${collapsed.has(folder) ? "collapsed" : ""}" data-folder="${escapeHtml(folder)}"><span>${collapsed.has(folder) ? "▸" : "▾"}</span> 📁 ${escapeHtml(folder || "Unfiled")} <small>${folders.get(folder)!.length}</small></div>
          ${collapsed.has(folder) ? "" : folders.get(folder)!.map((model) => `<button class="decorate-model ${holding?.model === model.id ? "active" : ""}" data-model="${escapeHtml(model.id)}" title="${escapeHtml(model.id)} · ${model.parts.length} part(s) · ${(model.clips ?? []).length} clip(s)">${escapeHtml(labelFor(model))}</button>`).join("")}`).join("")}
      </aside>
      <aside class="decorate-props">
        <header><strong>📦 Placed</strong><small>${props.length}${selectedSet.size > 1 ? ` · ${selectionIds().length} selected` : ""}</small><button data-act="group" title="Group the selected objects (Ctrl/Shift+click selects several; right-click a row for more) so they hide and show together">⧈ Group</button></header>
        <div class="decorate-list">${(() => {
          const row = (candidate: DecorProp, inGroup: boolean) => `<div class="decorate-prop ${candidate.id === selected ? "active" : ""} ${selectedSet.has(candidate.id) && candidate.id !== selected ? "picked" : ""} ${propVisible(candidate, layout) ? "" : "dim"} ${inGroup ? "in-group" : ""}" data-select="${escapeHtml(candidate.id)}" draggable="true" title="${escapeHtml(candidate.id)} · ${escapeHtml(labelFor(catalog.models[candidate.model]!))} · click: select · Ctrl+click: add to selection · drag onto a group"><span class="decorate-eye" data-prop-eye="${escapeHtml(candidate.id)}" title="${candidate.hidden ? "Show" : "Hide"}">${candidate.hidden ? "🙈" : "👁"}</span><span class="decorate-prop-name">${escapeHtml(candidate.id)}</span><small>${escapeHtml(labelFor(catalog.models[candidate.model]!))}</small></div>`.replace('title="', 'title="Shift+click: select the rows in between · ')  ;
          const grouped = groups().map((group) => {
            const members = props.filter((candidate) => candidate.group === group.id);
            const folded = collapsedGroups.has(group.id);
            return `<div class="decorate-group ${group.hidden ? "dim" : ""}" data-group="${escapeHtml(group.id)}" title="Drop objects here to add them · click the name to collapse"><span class="decorate-caret" data-group-toggle="${escapeHtml(group.id)}">${folded ? "▸" : "▾"}</span><span class="decorate-eye" data-group-eye="${escapeHtml(group.id)}" title="${group.hidden ? "Show group" : "Hide group"}">${group.hidden ? "🙈" : "👁"}</span><span class="decorate-group-name" data-group-toggle="${escapeHtml(group.id)}">⧈ ${escapeHtml(group.id)}</span><small>${members.length}</small><button data-ungroup="${escapeHtml(group.id)}" title="Ungroup (objects stay)">⧉</button></div>${folded ? "" : members.map((candidate) => row(candidate, true)).join("")}`;
          }).join("");
          const loose = props.filter((candidate) => !candidate.group || !groups().some((group) => group.id === candidate.group)).map((candidate) => row(candidate, false)).join("");
          return grouped + loose || `<div class="decorate-hint">Nothing placed yet. Pick something from the library.</div>`;
        })()}</div>
        ${prop ? `<section class="decorate-selected">
          <header><strong>${escapeHtml(prop.id)}</strong><small>${escapeHtml(labelFor(catalog.models[prop.model]!))}</small></header>
          <div class="decorate-row"><span>Gizmo</span>${(["none", "move", "turn", "scale"] as const).map((mode) => `<button data-gizmo="${mode}" class="${gizmoMode === mode ? "active" : ""}" title="${mode === "none" ? "Q" : mode === "move" ? "W" : mode === "turn" ? "R" : "T"}">${mode === "none" ? "⊘ <kbd>Q</kbd>" : mode === "move" ? "✥ Move <kbd>W</kbd>" : mode === "turn" ? "⟳ Rotate <kbd>R</kbd>" : "⤢ Scale <kbd>T</kbd>"}</button>`).join("")}</div>
          <div class="decorate-row"><span>Position</span>${[0, 1, 2].map((i) => `<input type="number" step="${SNAP}" data-pos="${i}" value="${prop.position[i]}" />`).join("")}</div>
          <div class="decorate-row"><span>Rotate °</span>${[0, 1, 2].map((i) => `<input type="number" step="15" data-rot="${i}" value="${propRotation(prop)[i]}" title="${"xyz"[i]}" />`).join("")}<button data-act="turn" title="Shift+R: turn 90° around the vertical axis">+90°</button></div>
          <div class="decorate-row"><span>Scale ×</span>${[0, 1, 2].map((i) => `<input type="number" step="0.05" min="0.05" data-scale="${i}" value="${propScale(prop)[i]}" title="${"xyz"[i]}" />`).join("")}</div>
          <div class="decorate-row"><span>Reacts</span><select data-interact="1" title="Clip played once when the chef interacts with it (Space / Enter next to it), then back to the idle clip"><option value="" ${prop.interactClip ? "" : "selected"}>— none —</option>${(catalog.models[prop.model]!.clips ?? []).map((clip) => `<option value="${escapeHtml(clip.id)}" ${prop.interactClip === clip.id ? "selected" : ""}>${escapeHtml(clip.name ?? clip.id)}</option>`).join("")}</select>${prop.interactClip ? `<button data-act="test" title="Play the interaction clip now">▶ Test</button>` : ""}</div>
          <div class="decorate-row"><span>Clip</span><select data-clip="1"><option value="" ${prop.clip === undefined ? "selected" : ""}>first looping clip</option><option value="__none" ${prop.clip === null ? "selected" : ""}>still</option>${(catalog.models[prop.model]!.clips ?? []).map((clip) => `<option value="${escapeHtml(clip.id)}" ${prop.clip === clip.id ? "selected" : ""}>${escapeHtml(clip.name ?? clip.id)}</option>`).join("")}</select></div>
          <div class="decorate-row"><button data-act="duplicate" title="Ctrl+D">⧉ Duplicate</button><button data-act="delete" title="Del">🗑️ Remove</button></div>
        </section>` : `<div class="decorate-hint">Click a placed object to select it.</div>`}
      </aside>
      <div class="decorate-legend">Drag a library item onto a floor (ghost shows where it lands) · click a placed object to select it, Shift+click adds more · drag it by its body to move it · gizmo: tap <kbd>W</kbd> move · <kbd>R</kbd> rotate · <kbd>T</kbd> scale · <kbd>Q</kbd> none · Shift+R: turn 90° · Del: remove · Ctrl+C / Ctrl+V: copy & paste the selection (at the pointer) · Ctrl+D: duplicate · Ctrl+Z: undo · Camera: right-hold looks, hold <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <kbd>Q</kbd><kbd>E</kbd> to fly (Shift fast), middle-drag pans, wheel zooms, <kbd>F</kbd> frames, middle-click orbits a point · left-drag never turns the camera · B / Esc: leave</div>`;
    [".decorate-library", ".decorate-props"].forEach((selector, index) => { const panel = root!.querySelector<HTMLElement>(selector); if (panel) panel.scrollTop = scrolls[index]!; });
  }
  const counters = { rootDowns: 0, moves: 0, ups: 0, holds: 0, placeCalls: 0, gizmoPresses: 0, bodyDrags: 0, selectsOnUp: 0, canvasDowns: 0 };
  /** When the library last handled a pointer press (a following click is the same gesture). */
  let libraryPointerAt = 0;
  function closeContextMenu(): void { contextMenu?.remove(); contextMenu = null; }
  function openContextMenu(event: MouseEvent, id: string): void {
    event.preventDefault();
    closeContextMenu();
    if (!selectedSet.has(id) && selected !== id) { selectedSet.clear(); selected = id; syncSelection(); render(); }
    const ids = selectionIds();
    const prop = layout.props.find((candidate) => candidate.id === id);
    const items: { label: string; action: string; keys?: string; disabled?: boolean }[] = [
      { label: `⧈ Group ${ids.length > 1 ? `${ids.length} objects` : "object"}…`, action: "group" },
      { label: "⧉ Remove from group", action: "leave-group", disabled: !prop?.group },
      { label: prop?.hidden ? "👁 Show" : "🙈 Hide", action: "toggle-hide" },
      { label: `📋 Copy${ids.length > 1 ? ` ${ids.length}` : ""}`, action: "copy", keys: "Ctrl+C" },
      { label: `📥 Paste${clipboard.length ? ` ${clipboard.length}` : ""}`, action: "paste", keys: "Ctrl+V", disabled: !clipboard.length },
      { label: `⧉ Duplicate${ids.length > 1 ? ` ${ids.length}` : ""}`, action: "duplicate", keys: "Ctrl+D" },
      { label: "🎯 Frame", action: "frame", keys: "F" },
      { label: `🗑️ Remove${ids.length > 1 ? ` ${ids.length}` : ""}`, action: "delete", keys: "Del" },
    ];
    const menu = document.createElement("div");
    menu.className = "decorate-menu";
    menu.innerHTML = items.map((item) => `<button data-menu="${item.action}" ${item.disabled ? "disabled" : ""}><span>${item.label}</span>${item.keys ? `<kbd>${item.keys}</kbd>` : ""}</button>`).join("");
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - items.length * 32 - 16)}px`;
    menu.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>("button[data-menu]");
      if (!button || button.hasAttribute("disabled")) return;
      const action = button.dataset.menu;
      closeContextMenu();
      switch (action) {
        case "group": groupSelection(); break;
        case "leave-group": for (const member of ids) moveToGroup(member, undefined); break;
        case "toggle-hide": { pushUndo(); const hide = !prop?.hidden; for (const member of ids) { const target = layout.props.find((candidate) => candidate.id === member); if (target) { if (hide) target.hidden = true; else delete target.hidden; } } decor.refreshVisibility(); render(); break; }
        case "duplicate": duplicateSelected(); break;
        case "copy": copySelection(); break;
        case "paste": pasteClipboard(); break;
        case "frame": head?.frame(ids.flatMap((member) => decor.placed.get(member)?.rig.meshes ?? [])); break;
        case "delete": deleteSelected(); break;
      }
    });
    document.body.append(menu);
    contextMenu = menu;
    const dismiss = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== "Escape") return; if (e instanceof MouseEvent && menu.contains(e.target as Node)) return; closeContextMenu(); window.removeEventListener("pointerdown", dismiss, true); window.removeEventListener("keydown", dismiss, true); };
    setTimeout(() => { window.addEventListener("pointerdown", dismiss, true); window.addEventListener("keydown", dismiss, true); }, 0);
  }
  function onRootContextMenu(event: MouseEvent): void {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-select]")?.dataset.select;
    if (id) openContextMenu(event, id);
  }
  function onRootPointerDown(event: PointerEvent): void {
    counters.rootDowns++;
    const model = (event.target as HTMLElement).closest<HTMLElement>("[data-model]")?.dataset.model;
    if (!model || event.button !== 0) return;
    event.preventDefault();
    libraryPointerAt = performance.now();
    if (holding?.model === model) { releaseHold(); status = ""; render(); return; }
    libraryDrag = { model, startX: event.clientX, startY: event.clientY, moved: false };
  }
  function onRootClick(event: Event): void {
    const target = event.target as HTMLElement;
    const clickedModel = target.closest<HTMLElement>("[data-model]")?.dataset.model;
    if (clickedModel) {
      // Pointer gestures are handled by pointer down / up; a keyboard or programmatic click still holds the model.
      if (performance.now() - libraryPointerAt > 400) { if (holding?.model === clickedModel) { releaseHold(); status = ""; render(); } else hold(clickedModel); }
      return;
    }
    const folder = target.closest<HTMLElement>("[data-folder]")?.dataset.folder;
    if (folder !== undefined) { if (collapsed.has(folder)) collapsed.delete(folder); else collapsed.add(folder); render(); return; }
    const propEye = target.closest<HTMLElement>("[data-prop-eye]")?.dataset.propEye;
    if (propEye) { togglePropHidden(propEye); return; }
    const groupEye = target.closest<HTMLElement>("[data-group-eye]")?.dataset.groupEye;
    if (groupEye) { toggleGroupHidden(groupEye); return; }
    const groupToggle = target.closest<HTMLElement>("[data-group-toggle]")?.dataset.groupToggle;
    if (groupToggle) { if (collapsedGroups.has(groupToggle)) collapsedGroups.delete(groupToggle); else collapsedGroups.add(groupToggle); render(); return; }
    const ungroupId = target.closest<HTMLElement>("[data-ungroup]")?.dataset.ungroup;
    if (ungroupId) { ungroup(ungroupId); return; }
    const select = target.closest<HTMLElement>("[data-select]")?.dataset.select;
    if (select) {
      releaseHold();
      const mouse = event as MouseEvent;
      if (mouse.ctrlKey || mouse.metaKey) {
        // Ctrl+click toggles a row; removing the active one hands "active" to another selected row.
        if (selected) selectedSet.add(selected);
        if (selectedSet.has(select)) { selectedSet.delete(select); if (selected === select) selected = [...selectedSet][0] ?? null; }
        else { selectedSet.add(select); selected = select; }
        if (selectedSet.size <= 1) selectedSet.clear();
        syncSelection(); render(); return;
      }
      if (mouse.shiftKey && selected) {
        // Shift+click: the block of rows between the last selected row and this one (list order, groups included).
        const order = [...(root?.querySelectorAll<HTMLElement>(".decorate-list [data-select]") ?? [])].map((row) => row.dataset.select!);
        const [a, b] = [order.indexOf(selected), order.indexOf(select)].sort((x, y) => x - y);
        if (a >= 0 && b >= 0) { for (const id of order.slice(a, b + 1)) selectedSet.add(id); }
        selectedSet.add(selected); selectedSet.add(select);
        selected = select; syncSelection(); render(); return;
      }
      selectedSet.clear();
      selected = select; syncSelection();
      const placed = decor.placed.get(select); if (placed && head && !mouse.shiftKey) head.frame(placed.rig.meshes);
      render(); return;
    }
    const gizmo = target.closest<HTMLElement>("[data-gizmo]")?.dataset.gizmo as typeof gizmoMode | undefined;
    if (gizmo) { gizmoMode = gizmo; syncSelection(); render(); return; }
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    switch (act) {
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "save": void save(); break;
      case "done": toggle(); break;
      case "turn": turnSelected(90); break;
      case "duplicate": duplicateSelected(); break;
      case "group": groupSelection(); break;
      case "test": if (selected) { decor.trigger(selected); status = `Playing ${selectedProp()?.interactClip} on ${selected}`; render(); } break;
      case "delete": deleteSelected(); break;
    }
  }
  function onRootInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.dataset.act === "fly-speed" && head) {
      const scale = 0.05 * 100 ** (Number(input.value) / 100);
      head.setSpeedScale(scale);
      try { localStorage.setItem("farm-lab-fly-speed", String(scale)); } catch { /* private mode */ }
      const out = input.parentElement?.querySelector("output"); if (out) out.textContent = `×${scale.toFixed(2)}`;
    }
  }
  function onRootChange(event: Event): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if ((input as HTMLInputElement).dataset.act === "snap") { snap = (input as HTMLInputElement).checked; return; }
    if ((input as HTMLInputElement).dataset.act === "fly-speed") return;
    const prop = selectedProp();
    if (!prop) return;
    const data = input.dataset;
    if (data.interact !== undefined) {
      pushUndo();
      if (input.value) prop.interactClip = input.value; else delete prop.interactClip;
      render();
      return;
    }
    if (data.pos !== undefined || data.rot !== undefined || data.scale !== undefined || data.clip !== undefined) {
      pushUndo();
      if (data.pos !== undefined) prop.position[Number(data.pos)] = Number(input.value) || 0;
      if (data.rot !== undefined) { const rotation = propRotation(prop); rotation[Number(data.rot)] = Number(input.value) || 0; prop.rotation = rotation; delete prop.rotationY; }
      if (data.scale !== undefined) { const scale = propScale(prop); scale[Number(data.scale)] = Math.max(0.05, Number(input.value) || 1); prop.scale = scale[0] === scale[1] && scale[1] === scale[2] ? scale[0] : scale; }
      if (data.clip !== undefined) { if (input.value === "") delete prop.clip; else if (input.value === "__none") prop.clip = null; else prop.clip = input.value; decor.add(prop); }
      else decor.refresh(prop.id);
      syncSelection();
      render();
    }
  }

  // -------------------------------------------------------- enter / exit --
  function enter(): void {
    if (active) return;
    active = true;
    const game = host.gameCamera;
    camera = new ArcRotateCamera("decorate camera", game.alpha, 0.95, 12, game.target.clone(), scene);
    camera.minZ = 0.05;
    camera.maxZ = 200;
    camera.lowerRadiusLimit = 0.3;
    camera.upperRadiusLimit = 60;
    camera.lowerBetaLimit = 0.03;
    camera.upperBetaLimit = Math.PI - 0.03;
    camera.wheelDeltaPercentage = 0.06;
    camera.panningSensibility = 900;
    camera.attachControl(true, false, 1);
    // No left-drag orbit here: there is no natural orbit centre in a room, so a
    // missed click on a gizmo ring must not fling the view. Left = select / drag
    // objects; right-hold looks; WASD flies (always on); middle pans; wheel zooms.
    (camera.inputs.attached.pointers as ArcRotateCameraPointersInput).buttons = [1];
    scene.activeCamera = camera;
    host.onCameraSwap?.(camera);
    head = createHeadCamera(camera, canvas, scene, {
      minRadius: 0.3, maxRadius: 60,
      pickable: () => [...decor.placed.values()].flatMap((placed) => placed.rig.meshes).concat(scene.meshes.filter((mesh) => host.isSurface(mesh as Mesh)) as Mesh[]),
      frameMeshes: () => { const placed = selected ? decor.placed.get(selected) : undefined; return placed ? placed.rig.meshes : [...decor.placed.values()].flatMap((entry) => entry.rig.meshes); },
      onStatus: (text) => { status = text; const out = root?.querySelector<HTMLOutputElement>(".decorate-speed output"); const slider = root?.querySelector<HTMLInputElement>('[data-act="fly-speed"]'); if (head && out && slider) { out.textContent = `×${head.speedScale.toFixed(2)}`; slider.value = String(Math.round((Math.log10(head.speedScale / 0.05) / 2) * 100)); } render(); },
      // W and Q are gizmo hotkeys when tapped and fly keys when held.
      holdDelayKeys: new Set(["w", "q"]),
      onKeyTap: (key) => { if (key === "w") gizmoMode = "move"; else if (key === "q") gizmoMode = "none"; syncSelection(); render(); },
    });
    head.setFlyMode(true);
    try { const stored = Number(localStorage.getItem("farm-lab-fly-speed")); head.setSpeedScale(stored > 0 ? stored : 0.35); } catch { head.setSpeedScale(0.35); }
    utility = new UtilityLayerRenderer(scene);
    utility.utilityLayerScene.activeCamera = camera;
    positionGizmo = new PositionGizmo(utility);
    positionGizmo.planarGizmoEnabled = true;
    rotationGizmo = new RotationGizmo(utility);
    scaleGizmo = new ScaleGizmo(utility);
    // Props scale uniformly: every axis handle (and the centre cube) reads as one factor.
    for (const gizmo of [positionGizmo, rotationGizmo, scaleGizmo]) {
      gizmo.scaleRatio = 1.5;
      gizmo.updateGizmoRotationToMatchAttachedMesh = false;
      gizmo.onDragStartObservable.add(() => { if (selectionIds().length > 1) beginGroupDrag(); else if (selected) pausePropClip(selected); });
      gizmo.onDragEndObservable.add(() => { if (groupDragging) endGroupDrag(); else { readBackFromNode(); if (selected) resumePropClip(selected); } });
    }
    highlight = new HighlightLayer("decorate selection", scene, { blurHorizontalSize: 1.1, blurVerticalSize: 1.1, camera });
    root = document.createElement("div");
    root.className = "decorate";
    root.addEventListener("click", onRootClick);
    root.addEventListener("input", onRootInput);
    root.addEventListener("contextmenu", onRootContextMenu);
    root.addEventListener("pointerdown", onRootPointerDown);
    root.addEventListener("dragstart", (event) => { const id = (event.target as HTMLElement).closest<HTMLElement>("[data-select]")?.dataset.select; if (id) event.dataTransfer?.setData("text/plain", id); });
    root.addEventListener("dragover", (event) => { if ((event.target as HTMLElement).closest("[data-group], .decorate-list")) event.preventDefault(); });
    root.addEventListener("drop", (event) => { const id = event.dataTransfer?.getData("text/plain"); if (!id) return; event.preventDefault(); const group = (event.target as HTMLElement).closest<HTMLElement>("[data-group]")?.dataset.group; moveToGroup(id, group); });
    root.addEventListener("change", onRootChange);
    document.querySelector("#app")!.append(root);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    status = "Pick something from the library, or click a placed object";
    render();
    syncSelection();
  }
  function exit(): void {
    if (!active) return;
    releaseHold();
    bodyDrag = null; libraryDrag = null;
    active = false;
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("keydown", onKeyDown);
    root?.remove();
    root = null;
    highlight?.dispose();
    highlight = null;
    closeContextMenu();
    groupNode?.dispose();
    groupNode = null;
    groupDragging = false;
    positionGizmo?.dispose(); rotationGizmo?.dispose(); scaleGizmo?.dispose();
    positionGizmo = rotationGizmo = scaleGizmo = null;
    utility?.dispose();
    utility = null;
    head?.dispose();
    head = null;
    scene.activeCamera = host.gameCamera;
    host.onCameraSwap?.(null);
    camera?.dispose();
    camera = null;
    selected = null;
  }
  function toggle(): void { if (active) exit(); else enter(); }

  return {
    get active() { return active; },
    toggle,
    update(dt) { head?.update(dt); },
    debug() { return { camera, utility, positionGizmo, rotationGizmo, scaleGizmo, selected, holding: holding?.model ?? null, pickSurface, pickProp, counters, libraryDrag, bodyDrag }; },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
