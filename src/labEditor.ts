import {
  ArcRotateCamera, ArcRotateCameraPointersInput, Color3, HighlightLayer, Matrix, Mesh, MeshBuilder, PositionGizmo, RotationGizmo, ScaleGizmo, Scene,
  ShadowGenerator, StandardMaterial, TransformNode, UtilityLayerRenderer, Vector3,
} from "@babylonjs/core";
import {
  brushCoordinates, layerId, planeBrushCoordinates, VoxelEditSession, type TidyPlan,
  type CellKey, type Coordinate, type EditableCell, type PartClipboard, type SerializedHistory,
} from "./game/voxelEditing";
import { createVoxelMesh, type VoxelCell } from "./game/voxelGeometry";
import { glowInfoOf, glowMaterialFor, splitGlowCells, tagGlow } from "./game/lighting";
import { FADE_MODES, STATE_TRANSITIONS, TRANSITION_DIRECTIONS, type AuthoredClip, type AuthoredVoxelModel, type ClipEase, type ClipKey, type FadeMode, type StateTransition, type TransitionDirection } from "./game/voxelModel";
import { applyRig, inferRig } from "./game/rigInference";
import { REST_POSE, sampleClip, type PartPose } from "./game/voxelClips";
import { createClipPlayer, createVoxelRig, poseRig, setRigPartState, type ClipPlayer, type VoxelRig } from "./game/voxelRig";

// Model Lab editor, laid out like a design tool: LAYERS (parts & rig) on the
// left, TOOLS & PROPERTIES on the right, and — in Animate mode — a DOPE SHEET
// along the bottom. Two modes switch in the top bar: 🧊 Model (voxels, parts,
// joints, baked transforms) and 🎬 Animate (clips, keys, events, playback).
// Pure editing logic lives in game/voxelEditing.ts; this file owns Babylon
// picking across the rig's part meshes, previews/highlights, the panels,
// keyboard shortcuts, per-object history persistence, and the save
// round-trip to the dev server (vite.config.ts).

export type EditorTool = "orbit" | "inspect" | "paint" | "add" | "erase" | "bucket" | "eyedropper" | "chunk" | "assign" | "pivot" | "socket";
export type EditorMode = "model" | "animate";
export type GizmoMode = "none" | "move" | "rotate" | "scale";
const GIZMOS: { id: GizmoMode; label: string; icon: string; key: string; hint: string }[] = [
  { id: "none", label: "None", icon: "⊘", key: "Q", hint: "hide the transform gizmo" },
  { id: "move", label: "Move", icon: "✥", key: "W", hint: "arrows: drag along an axis — Model: one voxel per step (five with Shift); Animate: smooth, one voxel with Shift" },
  { id: "rotate", label: "Rotate", icon: "⟳", key: "R", hint: "rings: drag to turn around the joint — smooth; hold Shift for 5° steps. Model mode stores the angle on the part (no re-gridding until you bake)" },
  { id: "scale", label: "Scale", icon: "⤢", key: "T", hint: "cubes: drag to scale about the joint — smooth; hold Shift for 0.1 steps" },
];
const SELECTION_COLOR = "#ff9f1c";

const TOOLS: { id: EditorTool; label: string; icon: string; key: string; hint: string; continuous: boolean }[] = [
  { id: "orbit", label: "Orbit", icon: "🧭", key: "H", hint: "left-drag turns the camera, nothing gets edited. With any other tool: right-drag, or hold Space or Alt while dragging", continuous: false },
  { id: "inspect", label: "Inspect", icon: "🔍", key: "V", hint: "hover to read a voxel; click selects its part", continuous: false },
  { id: "paint", label: "Paint", icon: "🖌️", key: "B", hint: "brush the current color onto existing voxels", continuous: true },
  { id: "add", label: "Add", icon: "🧱", key: "A", hint: "tap to add a brush of voxels on the face (or the ground) you point at, into the active part; press and drag to draw a stroke along that plane", continuous: true },
  { id: "erase", label: "Erase", icon: "🧽", key: "E", hint: "remove voxels under the brush", continuous: true },
  { id: "bucket", label: "Bucket", icon: "🪣", key: "G", hint: "recolor every connected voxel of the same color; hold Shift to cross similar shades", continuous: false },
  { id: "eyedropper", label: "Eyedropper", icon: "💧", key: "I", hint: "pick a voxel's color as the current color", continuous: false },
  { id: "chunk", label: "Remove", icon: "🗑️", key: "X", hint: "remove a whole connected piece (a stray part)", continuous: false },
  { id: "assign", label: "Assign", icon: "🧩", key: "P", hint: "move voxels into the active part: tap = the connected region of similar shades, press-and-drag = brush", continuous: true },
  { id: "pivot", label: "Joint", icon: "📍", key: "J", hint: "click a voxel to place the active part's joint (rotation center) there", continuous: false },
  { id: "socket", label: "Socket", icon: "🔗", key: "K", hint: "click a voxel to add a named attachment point (a knife on a hand) to the active part", continuous: false },
];
const BRUSH_SIZES = [0, 1, 2, 3]; // radius -> 1³, 3³, 5³, 7³
const PREVIEW_COLOR = "#ff4fd8";
const PART_COLOR = "#38d3e0";
const JOINT_COLOR = "#f0c674";
const EASES: ClipEase[] = ["inOut", "linear", "in", "out", "back", "step"];
const CLIPBOARD_KEY = "farm-lab-clipboard";
const KEY_CLIPBOARD_KEY = "farm-lab-key-clipboard";
/** Copied keys, times relative to the earliest one. */
type KeyClipboard = { keys: { part: string; t: number; key: ClipKey }[]; parts: number };

export interface LabEditorHost {
  scene: Scene;
  camera: ArcRotateCamera;
  canvas: HTMLCanvasElement;
  shadows: ShadowGenerator;
  panels: { left: HTMLElement; right: HTMLElement; bottom: HTMLElement; modes: HTMLElement };
  /** Show/hide the editor panels and re-flow the canvas. */
  setLayout(editing: boolean, animating: boolean): void;
  onRigReplaced(rig: VoxelRig): void;
  onStats(text: string): void;
  setAutoRotate(on: boolean): void;
  onSaved(model: AuthoredVoxelModel, isNew: boolean): void;
  reload(): void;
}

export interface LabEditor {
  readonly active: boolean;
  readonly dirty: boolean;
  /** Meshes of the selected layers (all of the model when nothing is selected) — what F frames. */
  selectionMeshes(): Mesh[];
  open(model: AuthoredVoxelModel, rig: VoxelRig): void;
  close(): void;
  update(dt: number): void;
  /** Paste every part of another model into the open one (scaled to this
   * model's voxel size), as new layers prefixed with the source id. With `at`,
   * the donor's root joint lands on that cell (a drop point in the viewport).
   * Returns the number of parts added. */
  mergeModel(source: AuthoredVoxelModel, at?: Coordinate, attachTo?: string): number;
  /** Cell under a viewport point (the free cell in front of the hit face, or
   * the ground), plus the part that was hit, if any. */
  dropCell(clientX: number, clientY: number): { cell: Coordinate; part: string | null } | null;
}

type Hit = { cell: Coordinate; outside: Coordinate; axis: 0 | 1 | 2; part: string; normal: Vector3; point: Vector3; ground?: boolean };
type AddPlane = { axis: 0 | 1 | 2; layer: number; part: string; point: Vector3; normal: Vector3; ground: boolean };

export function createLabEditor(host: LabEditorHost): LabEditor {
  const { scene, camera, canvas, shadows, panels } = host;
  let session: VoxelEditSession | null = null;
  let rig: VoxelRig | null = null;
  let rootY = 0;
  let mode: EditorMode = "model";
  let tool: EditorTool = "paint";
  let brush = 0;
  let color = "#c83d35";
  let selectedPaletteColor: string | null = null;
  let activePart: string | null = null;
  let painting = false;
  let strokeMoved = false;
  let strokeStart: Hit | null = null;
  let pressPoint: { x: number; y: number } | null = null;
  let shiftHeld = false;
  let spaceHeld = false;
  let altHeld = false;
  let addPlane: AddPlane | null = null;
  let lastHit: Hit | null = null;
  let lastStrokeCell: CellKey | null = null;
  let needsRebuild = false;
  let statusText = "";
  let controlsOpen = readFlag("farm-lab-controls-open", false);
  /** Extra palette swatches added with ＋ (kept per model, even while unused). */
  let extraSwatches: string[] = [];
  /** Voxel state the next inserted key should set ("" = leave as is), and how the switch plays. */
  let pendingKeyState = "";
  let pendingTransition: StateTransition = "blend";
  let pendingDirection: TransitionDirection = "random";
  /** Ease used for the next inserted key: the last one chosen, not a fixed default. */
  let lastEase: ClipEase = "inOut";
  /** Drag-box selection in the dope sheet. */
  let marquee: { x0: number; y0: number; x1: number; y1: number; active: boolean; additive: boolean; element: HTMLElement | null } | null = null;
  /** Layers list order: the hierarchy as stored, or siblings by voxel count. */
  let layerSort: "tree" | "size" = "tree";
  /** 🧹 Tidy dialog state while it is open. */
  let tidy: { element: HTMLElement; threshold: number; mode: "touch" | "single" | "delete"; plan: TidyPlan } | null = null;
  let tidyMeshes: Mesh[] = [];
  /** Palette chip being edited through the hidden picker (double-click). */
  let editingPaletteColor: string | null = null;
  const SWATCH_KEY = (id: string) => `farm-lab-swatches:${id}`;
  function loadSwatches(id: string): string[] { try { return JSON.parse(window.localStorage.getItem(SWATCH_KEY(id)) ?? "[]") as string[]; } catch { return []; } }
  function storeSwatches(): void { if (session) try { window.localStorage.setItem(SWATCH_KEY(session.modelId), JSON.stringify(extraSwatches)); } catch { /* ignore */ } }
  let clipboard: PartClipboard | null = readClipboard();
  const collapsed = new Set<string>();
  /** Multi-selected layers (Shift/Ctrl+click); the active part is always included. */
  const selectedParts = new Set<string>();
  /** Last plain-clicked layer: Shift+click selects the range from here. */
  let layerAnchor: string | null = null;
  let contextMenu: HTMLElement | null = null;
  /** Dope-sheet groups folded shut (independent of the Layers carets). */
  const sheetCollapsed = new Set<string>();
  let renaming: string | null = null;

  // ------------------------------------------------------------ animation --
  let player: ClipPlayer | null = null;
  let activeClipId: string | null = null;
  let scrubTime = 0;
  let draftPose: PartPose | null = null;
  /** Drafts for the other selected parts when a gizmo moves several at once. */
  const extraDrafts = new Map<string, PartPose>();
  let keyDrag: { part: string; from: number; to: number; key: ClipKey; group: { part: string; t: number; key: ClipKey }[] } | null = null;
  let scrubbing = false;
  /** Selected keys as "part|t"; click selects, Shift+click adds, Ctrl+A all. */
  const selectedKeys = new Set<string>();
  /** Last plain-clicked key: Shift+click selects the block from here. */
  let keyAnchor: { part: string; t: number } | null = null;
  let keyClipboard: KeyClipboard | null = readKeyClipboard();
  const keyId = (part: string, t: number) => `${part}|${round(t, 4)}`;
  /** Auto-key: a gizmo drag in Animate mode inserts/updates the key at the playhead. */
  let autoKey = readFlag("farm-lab-autokey", true);

  // ---------------------------------------------------------- selection & gizmos --
  // Blender/Unity-style: the active part glows orange in the viewport and a
  // transform gizmo (arrows / rings / cubes) sits on its joint. Dragging it
  // poses the part in Animate mode (auto-key optional) and BAKES into the
  // voxels in Model mode (whole-cell / 15° snapping).
  const highlight = new HighlightLayer("lab editor selection", scene, { blurHorizontalSize: 1.2, blurVerticalSize: 1.2 });
  highlight.innerGlow = false;
  const utility = new UtilityLayerRenderer(scene);
  const positionGizmo = new PositionGizmo(utility);
  const rotationGizmo = new RotationGizmo(utility);
  const scaleGizmo = new ScaleGizmo(utility);
  for (const gizmo of [positionGizmo, rotationGizmo, scaleGizmo]) { gizmo.scaleRatio = 0.75; gizmo.updateGizmoRotationToMatchAttachedMesh = false; }
  /** Snapping: Shift = 5° / 0.1 scale in both modes. Moves in Model mode step
   * by one voxel even without Shift (a bake rounds to cells anyway, so the drag
   * shows what you get) and by five with Shift; Animate moves are smooth
   * unless Shift (one voxel). The Turn ±90 buttons remain the lossless path. */
  function syncGizmoSnap(): void {
    const model = mode === "model";
    const pitch = session?.pitch ?? 0;
    rotationGizmo.snapDistance = shiftHeld ? Math.PI / 36 : 0;
    positionGizmo.snapDistance = model ? (shiftHeld ? 5 * pitch : pitch) : (shiftHeld ? pitch : 0);
    scaleGizmo.snapDistance = shiftHeld ? 0.1 : 0;
  }
  /** Live readout: while dragging, the right panel's fields follow the node. */
  function refreshGizmoReadout(): void {
    if (!session || !gizmoNode) return;
    const pitch = session.pitch;
    const deg = (r: number) => round((r * 180) / Math.PI, 1);
    const node = gizmoNode;
    let rest = Vector3.Zero();
    if (groupNode && node === groupNode && groupCenter) rest = new Vector3(groupCenter.x * pitch, groupCenter.y * pitch, groupCenter.z * pitch);
    else if (activePart) rest = rig?.parts.get(activePart)?.restPosition ?? Vector3.Zero();
    const move = [(node.position.x - rest.x) / pitch, (node.position.y - rest.y) / pitch, (node.position.z - rest.z) / pitch];
    const rotation = [deg(node.rotation.x), deg(node.rotation.y), deg(node.rotation.z)];
    const scaling = [round(node.scaling.x, 3), round(node.scaling.y, 3), round(node.scaling.z, 3)];
    if (mode === "animate") {
      const base = draftPose ?? poseAtScrub();
      const values = { rotation, position: move.map((v) => round(v, 2)), scale: scaling };
      for (const input of panels.right.querySelectorAll<HTMLInputElement>("[data-pose]:not([data-multi])")) {
        const channel = input.dataset.pose as "rotation" | "position" | "scale";
        const index = Number(input.dataset.index);
        const live = channel === "rotation" ? rotation[index]! : channel === "position" ? values.position[index]! : scaling[index]!;
        const isDraggedChannel = (channel === "rotation" && rotationGizmo.attachedNode === node) || (channel === "position" && positionGizmo.attachedNode === node) || (channel === "scale" && scaleGizmo.attachedNode === node);
        input.value = String(isDraggedChannel ? live : round(base[channel][index]!, 3));
      }
    } else if (activePart) {
      const stored = session.partMeta(activePart)!.transform;
      for (let i = 0; i < 3; i++) {
        const rotInput = panels.right.querySelector<HTMLInputElement>(`[data-transform="rotation"][data-index="${i}"]`);
        const moveInput = panels.right.querySelector<HTMLInputElement>(`[data-transform="position"][data-index="${i}"]`);
        const scaleInput = panels.right.querySelector<HTMLInputElement>(`[data-transform="scale"][data-index="${i}"]`);
        if (rotInput && rotationGizmo.attachedNode === node) rotInput.value = String(rotation[i]);
        if (moveInput && positionGizmo.attachedNode === node) moveInput.value = String(stored.position[i] + Math.round(move[i]!));
        if (scaleInput && scaleGizmo.attachedNode === node) scaleInput.value = String(scaling[i]);
      }
    }
    statusText = positionGizmo.attachedNode === node ? `Move ${move.map((v) => round(v, mode === "model" ? 0 : 2)).join(", ")} cells` : rotationGizmo.attachedNode === node ? `Rotate ${rotation.join("°, ")}°` : `Scale ×${scaling.join(", ")}`;
    renderStatus();
  }
  let gizmoMode: GizmoMode = "none";
  let gizmoDragging = false;
  let gizmoNode: TransformNode | null = null;
  /** Helper node at the selection's centre when several parts are selected. */
  let groupNode: TransformNode | null = null;
  let groupCenter: Coordinate | null = null;
  const onGizmoStart = () => {
    gizmoDragging = true;
    player?.pause();
    clearPreview();
    // Several parts: parent their nodes under the helper for the drag so the
    // whole selection visibly moves with the gizmo.
    if (groupNode && rig && gizmoNode === groupNode) {
      for (const part of selectionTops()) {
        const rigPart = rig.parts.get(part);
        if (rigPart) rigPart.node.setParent(groupNode);
      }
    }
  };
  for (const gizmo of [positionGizmo, rotationGizmo, scaleGizmo]) {
    gizmo.onDragStartObservable.add(onGizmoStart);
    gizmo.onDragObservable.add(() => refreshGizmoReadout());
    gizmo.onDragEndObservable.add(() => onGizmoEnd(gizmo === positionGizmo ? "move" : gizmo === rotationGizmo ? "rotate" : "scale"));
  }
  /** Centre of the bounding box of every selected part's cells (with descendants), in cells. */
  function selectionCenter(): Coordinate | null {
    if (!session) return null;
    const tops = selectionTops();
    const family = new Set(tops.flatMap((id) => [id, ...session!.descendantsOf(id)]));
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const cell of session.visibleCells()) {
      if (!session.at(cell.x, cell.y, cell.z).some((c) => family.has(c.part))) continue;
      min = [Math.min(min[0]!, cell.x), Math.min(min[1]!, cell.y), Math.min(min[2]!, cell.z)];
      max = [Math.max(max[0]!, cell.x), Math.max(max[1]!, cell.y), Math.max(max[2]!, cell.z)];
    }
    if (!Number.isFinite(min[0]!)) return null;
    return { x: Math.round((min[0]! + max[0]!) / 2), y: Math.round((min[1]! + max[1]!) / 2), z: Math.round((min[2]! + max[2]!) / 2) };
  }
  function gizmoTarget(): { node: TransformNode; part: string | null } | null {
    if (!rig || !session) return null;
    if (selectionTops().length > 1) {
      // Several parts: the gizmo sits at the selection's centre and moves them together.
      groupCenter = selectionCenter();
      if (groupCenter) {
        groupNode?.dispose();
        groupNode = new TransformNode("lab editor group pivot", scene);
        groupNode.parent = rig.root;
        groupNode.position.set(groupCenter.x * session.pitch, groupCenter.y * session.pitch, groupCenter.z * session.pitch);
        return { node: groupNode, part: null };
      }
    }
    groupCenter = null;
    if (activePart) { const rigPart = rig.parts.get(activePart); return rigPart ? { node: rigPart.node, part: activePart } : null; }
    return mode === "animate" ? { node: rig.root, part: null } : null;
  }
  function syncGizmo(): void {
    if (groupNode && !gizmoDragging) { groupNode.dispose(); groupNode = null; groupCenter = null; }
    const target = gizmoMode === "none" || !session ? null : gizmoTarget();
    gizmoNode = target?.node ?? null;
    syncGizmoSnap();
    positionGizmo.attachedNode = gizmoMode === "move" ? gizmoNode : null;
    rotationGizmo.attachedNode = gizmoMode === "rotate" ? gizmoNode : null;
    scaleGizmo.attachedNode = gizmoMode === "scale" ? gizmoNode : null;
  }
  function syncSelectionGlow(): void {
    highlight.removeAllMeshes();
    if (!rig || !activePart) return;
    for (const mesh of rig.parts.get(activePart)?.meshes ?? []) highlight.addMesh(mesh, Color3.FromHexString(SELECTION_COLOR));
  }
  /** Read the dragged node back into either a pose (Animate) or a baked transform (Model). */
  function onGizmoEnd(kind: Exclude<GizmoMode, "none">): void {
    gizmoDragging = false;
    if (!session || !rig || !gizmoNode) return;
    const pitch = session.pitch;
    const deg = (r: number) => round((r * 180) / Math.PI, 2);
    const node = gizmoNode;
    if (groupNode && node === groupNode && groupCenter) { onGroupGizmoEnd(kind); return; }
    const rigPart = activePart ? rig.parts.get(activePart) : null;
    const rest = rigPart ? rigPart.restPosition : Vector3.Zero();
    if (mode === "animate") {
      const base = draftPose ?? poseAtScrub();
      const pose: PartPose = {
        rotation: kind === "rotate" ? [deg(node.rotation.x), deg(node.rotation.y), deg(node.rotation.z)] : base.rotation,
        position: kind === "move" ? [round((node.position.x - rest.x) / pitch, 2), round((node.position.y - rest.y) / pitch, 2), round((node.position.z - rest.z) / pitch, 2)] : base.position,
        scale: kind === "scale" ? [round(node.scaling.x, 3), round(node.scaling.y, 3), round(node.scaling.z, 3)] : base.scale,
      };
      // The same change goes to every other selected part, relative to its own pose.
      const others = selectionList().filter((part) => part !== activeTrackPart());
      const clip = activeClip();
      if (clip && others.length) {
        const sampled = sampleClip(clip, scrubTime);
        for (const part of others) {
          const own = extraDrafts.get(part) ?? sampled.get(part) ?? REST_POSE;
          extraDrafts.set(part, {
            rotation: kind === "rotate" ? [own.rotation[0] + pose.rotation[0] - base.rotation[0], own.rotation[1] + pose.rotation[1] - base.rotation[1], own.rotation[2] + pose.rotation[2] - base.rotation[2]] : own.rotation,
            position: kind === "move" ? [own.position[0] + pose.position[0] - base.position[0], own.position[1] + pose.position[1] - base.position[1], own.position[2] + pose.position[2] - base.position[2]] : own.position,
            scale: kind === "scale" ? [own.scale[0] * pose.scale[0] / (base.scale[0] || 1), own.scale[1] * pose.scale[1] / (base.scale[1] || 1), own.scale[2] * pose.scale[2] / (base.scale[2] || 1)] : own.scale,
          });
        }
      }
      draftPose = pose;
      if (autoKey && activeClipId) { insertKey(); statusText = `Auto-key: ${activeTrackPart()}${others.length ? ` + ${others.length} selected part(s)` : ""} at ${round(scrubTime, 2)}s`; renderStatus(); }
      else { applyScrubPose(); renderRight(); }
      return;
    }
    if (!activePart) return;
    // Model mode: the drag becomes the part's STORED transform (non-destructive;
    // the node is already there, the rebuild just makes it the rest state).
    const stored = session.partMeta(activePart)!.transform;
    if (kind === "move") {
      const delta = [(node.position.x - rest.x) / pitch, (node.position.y - rest.y) / pitch, (node.position.z - rest.z) / pitch];
      session.setPartTransform(activePart, { position: [stored.position[0] + Math.round(delta[0]!), stored.position[1] + Math.round(delta[1]!), stored.position[2] + Math.round(delta[2]!)] });
    } else if (kind === "rotate") {
      session.setPartTransform(activePart, { rotation: [deg(node.rotation.x), deg(node.rotation.y), deg(node.rotation.z)] });
    } else {
      session.setPartTransform(activePart, { scale: [round(node.scaling.x, 3), round(node.scaling.y, 3), round(node.scaling.z, 3)] });
    }
    const t = session.partMeta(activePart)!.transform;
    statusText = `${activePart}: rotate ${t.rotation.join("°, ")}° · move ${t.position.join(", ")} · scale ×${t.scale.join(", ")} (stored — ⤓ bakes it into voxels)`;
    markChanged();
  }
  // Dev aid for driven-browser checks (the gizmo handles live in a utility scene).
  (window as unknown as { __labGizmos: unknown }).__labGizmos = { positionGizmo, rotationGizmo, scaleGizmo, utility, highlight };
  /** Several parts: the helper node's delta is applied around the selection centre. */
  function onGroupGizmoEnd(kind: Exclude<GizmoMode, "none">): void {
    if (!session || !rig || !groupNode || !groupCenter) return;
    const pitch = session.pitch;
    const deg = (r: number) => round((r * 180) / Math.PI, 2);
    const center = groupCenter;
    const restPosition = new Vector3(center.x * pitch, center.y * pitch, center.z * pitch);
    const translate: [number, number, number] = [(groupNode.position.x - restPosition.x) / pitch, (groupNode.position.y - restPosition.y) / pitch, (groupNode.position.z - restPosition.z) / pitch];
    const rotate: [number, number, number] = [deg(groupNode.rotation.x), deg(groupNode.rotation.y), deg(groupNode.rotation.z)];
    const scale: [number, number, number] = [round(groupNode.scaling.x, 3), round(groupNode.scaling.y, 3), round(groupNode.scaling.z, 3)];
    const resetGroupNode = () => { if (groupNode) { groupNode.position.copyFrom(restPosition); groupNode.rotation.set(0, 0, 0); groupNode.scaling.set(1, 1, 1); } };
    const tops = selectionTops();
    if (mode === "model") {
      // Stored transforms for every selected part, orbiting the selection centre.
      const changed = kind === "move" ? translate.some((v) => Math.round(v) !== 0) : kind === "rotate" ? rotate.some((v) => Math.abs(v) > 0.01) : scale.some((v) => Math.abs(v - 1) > 0.001);
      if (!changed) { resetGroupNode(); renderAll(); return; }
      session.beginStroke();
      for (const part of tops) {
        const own = session.partMeta(part)!.transform;
        const next = orbitPose({ rotation: own.rotation, position: own.position, scale: own.scale }, session.partMeta(part)!.pivot, center, kind, { translate: translate.map(Math.round) as [number, number, number], rotate, scale });
        session.setPartTransform(part, { rotation: next.rotation as [number, number, number], position: next.position.map(Math.round) as [number, number, number], scale: next.scale as [number, number, number] });
      }
      session.endStroke();
      statusText = `${tops.length} parts transformed around their centre (stored on each part)`;
      markChanged();
      return;
    }
    // Animate: hand the parts back to their rig parents (poses re-apply below),
    // then every selected part orbits the centre — its joint offset from the
    // centre is rotated/scaled, and the same rotation/scale goes on its own pose.
    for (const part of tops) {
      const rigPart = rig.parts.get(part);
      const parentId = session.partMeta(part)?.parent;
      if (rigPart) rigPart.node.setParent(parentId && rig.parts.get(parentId) ? rig.parts.get(parentId)!.node : rig.root);
    }
    resetGroupNode();
    const clip = activeClip();
    if (!clip) return;
    const sampled = sampleClip(clip, scrubTime);
    for (const part of tops) {
      const own = extraDrafts.get(part) ?? (part === activeTrackPart() && draftPose ? draftPose : sampled.get(part)) ?? REST_POSE;
      const pose = orbitPose(own, session.partMeta(part)!.pivot, center, kind, { translate, rotate, scale });
      if (part === activeTrackPart()) draftPose = pose; else extraDrafts.set(part, pose);
    }
    if (autoKey && activeClipId) { insertKey(); statusText = `Auto-key: ${tops.length} parts orbiting their centre at ${round(scrubTime, 2)}s`; renderStatus(); }
    else { applyScrubPose(); renderRight(); }
  }
  /** A pose/transform moved as part of a group around `center`: same rotation
   * and scale on itself, and its joint offset from the centre rotated/scaled. */
  function orbitPose(own: PartPose, joint: readonly [number, number, number], center: Coordinate, kind: Exclude<GizmoMode, "none">, delta: { translate: [number, number, number]; rotate: [number, number, number]; scale: [number, number, number] }): PartPose {
    const radians = delta.rotate.map((v) => (v * Math.PI) / 180) as [number, number, number];
    const rotateVector = (v: [number, number, number]): [number, number, number] => {
      let [x, y, z] = v;
      const steps: ["x" | "y" | "z", number][] = [["x", radians[0]], ["y", radians[1]], ["z", radians[2]]];
      for (const [axis, angle] of steps) {
        if (!angle) continue;
        const c = Math.cos(angle), sn = Math.sin(angle);
        if (axis === "x") [y, z] = [y * c - z * sn, y * sn + z * c];
        else if (axis === "y") [x, z] = [x * c + z * sn, -x * sn + z * c];
        else [x, y] = [x * c - y * sn, x * sn + y * c];
      }
      return [x, y, z];
    };
    const offset: [number, number, number] = [joint[0] + own.position[0] - center.x, joint[1] + own.position[1] - center.y, joint[2] + own.position[2] - center.z];
    let pose: PartPose = own;
    if (kind === "move") pose = { ...own, position: [own.position[0] + delta.translate[0], own.position[1] + delta.translate[1], own.position[2] + delta.translate[2]] };
    else if (kind === "rotate") {
      const moved = rotateVector(offset);
      pose = { rotation: [own.rotation[0] + delta.rotate[0], own.rotation[1] + delta.rotate[1], own.rotation[2] + delta.rotate[2]], position: [own.position[0] + moved[0] - offset[0], own.position[1] + moved[1] - offset[1], own.position[2] + moved[2] - offset[2]], scale: own.scale };
    } else {
      pose = { rotation: own.rotation, position: [own.position[0] + offset[0] * (delta.scale[0] - 1), own.position[1] + offset[1] * (delta.scale[1] - 1), own.position[2] + offset[2] * (delta.scale[2] - 1)], scale: [own.scale[0] * delta.scale[0], own.scale[1] * delta.scale[1], own.scale[2] * delta.scale[2]] };
    }
    return { rotation: pose.rotation.map((v) => round(v, 2)) as [number, number, number], position: pose.position.map((v) => round(v, 2)) as [number, number, number], scale: pose.scale.map((v) => round(v, 3)) as [number, number, number] };
  }
  function setGizmoMode(next: GizmoMode): void {
    gizmoMode = next;
    syncGizmo();
    renderRight();
    if (mode === "animate") renderBottom();
  }
  /** True when the pointer is over a gizmo handle (the gizmo owns that drag). */
  function pointerOnGizmo(event: PointerEvent): boolean {
    if (gizmoMode === "none" || !gizmoNode) return false;
    const { x, y } = pointerToCanvas(event);
    const pick = utility.utilityLayerScene.pick(x, y, (mesh) => mesh.isPickable && mesh.isEnabled());
    return !!pick?.hit;
  }

  // ------------------------------------------------------------- overlays --
  const previewMaterial = overlayMaterial("lab editor preview", PREVIEW_COLOR, 0.6);
  const partMaterial = overlayMaterial("lab editor part", PART_COLOR, 0.35);
  const jointMaterial = overlayMaterial("lab editor joint", JOINT_COLOR, 0.9);
  let previewMeshes: Mesh[] = [];
  let previewSignature = "";
  let partHighlight: Mesh[] = [];
  let partHighlightSignature = "";
  const jointMarker = MeshBuilder.CreateBox("lab editor joint marker", { size: 1 }, scene);
  jointMarker.material = jointMaterial;
  jointMarker.isPickable = false;
  jointMarker.setEnabled(false);
  const socketMarkers: Mesh[] = [];
  const regionCache = new Map<string, EditableCell[]>();
  let regionCacheGeneration = -1;

  function overlayMaterial(name: string, hex: string, alpha: number): StandardMaterial {
    const material = new StandardMaterial(name, scene);
    material.emissiveColor = Color3.FromHexString(hex);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    material.disableLighting = true;
    material.zOffset = -2;
    return material;
  }
  function cachedRegion(kind: "chunk" | "same" | "similar", at: Coordinate, part: string): EditableCell[] {
    if (!session) return [];
    if (regionCacheGeneration !== session.generation) { regionCache.clear(); regionCacheGeneration = session.generation; }
    const key = `${kind}|${part}|${at.x},${at.y},${at.z}`;
    let cells = regionCache.get(key);
    if (!cells) {
      cells = kind === "chunk" ? session.connectedChunk(at, part) : kind === "same" ? session.sameColorRegion(at, part) : session.similarColorRegion(at, 0.22, part);
      for (const member of cells) regionCache.set(`${kind}|${part}|${member.x},${member.y},${member.z}`, cells);
      if (cells.length === 0) regionCache.set(key, cells);
    }
    return cells;
  }
  function addTargetPart(hit: Hit): string { return activePart ?? hit.part; }

  function affectedCells(hit: Hit): { cells: Coordinate[]; verb: string } {
    if (!session) return { cells: [], verb: "" };
    // Tools act on the part under the pointer, so overlapping parts are never touched by accident.
    const exists = (c: Coordinate) => { const cell = session!.get(c.x, c.y, c.z, hit.part); return cell !== undefined && session!.isPartVisible(cell.part); };
    switch (tool) {
      case "paint": return { cells: brushCoordinates(hit.cell, brush).filter(exists), verb: `paint ${hit.part}` };
      case "erase": return { cells: brushCoordinates(hit.cell, brush).filter(exists), verb: `erase from ${hit.part}` };
      case "add": return { cells: planeBrushCoordinates(hit.outside, hit.axis, brush).filter((c) => !session!.get(c.x, c.y, c.z, addTargetPart(hit))), verb: `add to ${addTargetPart(hit)}` };
      case "bucket": return { cells: cachedRegion(shiftHeld ? "similar" : "same", hit.cell, hit.part), verb: shiftHeld ? "recolor (similar shades)" : "recolor" };
      case "chunk": return { cells: cachedRegion("chunk", hit.cell, hit.part), verb: "remove" };
      case "assign": {
        const region = painting && strokeMoved ? brushCoordinates(hit.cell, brush).filter(exists) : cachedRegion("similar", hit.cell, hit.part);
        return { cells: region.filter((c) => session!.get(c.x, c.y, c.z, hit.part)?.part !== activePart), verb: `assign to ${activePart ?? "?"}` };
      }
      case "pivot": return { cells: exists(hit.cell) ? [hit.cell] : [], verb: `set joint of ${activePart ?? "?"} at` };
      case "socket": return { cells: exists(hit.cell) ? [hit.cell] : [], verb: `add socket on ${activePart ?? "?"} at` };
      case "eyedropper":
      case "inspect": return { cells: exists(hit.cell) ? [hit.cell] : [], verb: tool === "eyedropper" ? "pick" : "" };
      case "orbit": return { cells: [], verb: "" };
    }
  }
  function buildOverlay(name: string, cells: readonly Coordinate[], material: StandardMaterial, inflate: number, fallbackPart?: string): Mesh[] {
    if (!session || !rig) return [];
    const byPart = new Map<string, VoxelCell[]>();
    for (const c of cells) {
      const part = (fallbackPart && (session.get(c.x, c.y, c.z, fallbackPart) || !session.at(c.x, c.y, c.z).length)) ? fallbackPart : (session.get(c.x, c.y, c.z)?.part ?? fallbackPart ?? session.parts[0] ?? "");
      let list = byPart.get(part);
      if (!list) byPart.set(part, (list = []));
      list.push({ x: c.x, y: c.y, z: c.z, color: PREVIEW_COLOR });
    }
    const out: Mesh[] = [];
    for (const [part, list] of byPart) {
      const rigPart = rig.parts.get(part);
      const meta = session.partMeta(part);
      if (!rigPart || !meta) continue;
      const local = list.map((cell) => ({ ...cell, x: cell.x - meta.pivot[0], y: cell.y - meta.pivot[1], z: cell.z - meta.pivot[2] }));
      const mesh = createVoxelMesh(name, local, session.pitch, scene, { inflate });
      mesh.material?.dispose();
      mesh.material = material;
      mesh.isPickable = false;
      mesh.parent = rigPart.node;
      out.push(mesh);
    }
    return out;
  }
  function updatePreview(hit: Hit | null): void {
    if (!session || !rig || !hit || mode === "animate" || tool === "orbit" || spaceHeld || altHeld) { clearPreview(); return; }
    const target = tool === "add" ? hit.outside : hit.cell;
    const signature = `${tool}|${brush}|${shiftHeld}|${painting && strokeMoved}|${activePart}|${session.generation}|${target.x},${target.y},${target.z}`;
    if (signature === previewSignature) return;
    previewSignature = signature;
    const stale = previewMeshes;
    previewMeshes = [];
    const { cells, verb } = affectedCells(hit);
    const under = session.get(hit.cell.x, hit.cell.y, hit.cell.z, hit.part);
    const others = session.at(hit.cell.x, hit.cell.y, hit.cell.z).filter((cell) => cell.part !== hit.part);
    if (tool === "inspect") statusText = under ? `(${under.x}, ${under.y}, ${under.z}) · ${under.color} · part ${under.part}${others.length ? ` · also here: ${others.map((c) => c.part).join(", ")}` : ""}` : "";
    else if (tool === "eyedropper") statusText = under ? `Click to pick ${under.color} (part ${under.part})` : "";
    else if (tool === "pivot" || tool === "socket") statusText = cells.length ? `Will ${verb} (${target.x}, ${target.y}, ${target.z})` : "";
    else statusText = cells.length ? `Will ${verb} ${cells.length} voxel${cells.length === 1 ? "" : "s"}${hit.ground ? " on the ground" : ""}` : `Nothing to ${verb} here`;
    renderStatus();
    if (cells.length) {
      previewMeshes = buildOverlay("lab editor preview", cells, previewMaterial, 0.06, tool === "add" ? addTargetPart(hit) : hit.part);
      for (const mesh of previewMeshes) mesh.isReady(true);
    }
    for (const mesh of stale) mesh.dispose(false, false);
  }
  function clearPreview(): void {
    for (const mesh of previewMeshes) mesh.dispose(false, false);
    previewMeshes = [];
    previewSignature = "";
  }
  function updatePartHighlight(): void {
    if (!session || !rig) return;
    const signature = `${activePart}|${session.generation}|${mode}|${tool}`;
    if (signature === partHighlightSignature) return;
    partHighlightSignature = signature;
    for (const mesh of partHighlight) mesh.dispose(false, false);
    for (const mesh of socketMarkers) mesh.dispose(false, false);
    partHighlight = [];
    socketMarkers.length = 0;
    jointMarker.setEnabled(false);
    const meta = activePart ? session.partMeta(activePart) : undefined;
    const rigPart = activePart ? rig.parts.get(activePart) : undefined;
    if (!activePart || !meta || !rigPart) return;
    const showCells = mode === "model" && (tool === "assign" || tool === "pivot" || tool === "socket");
    if (showCells) {
      const cells: Coordinate[] = [];
      for (const cell of session.visibleCells()) if (session.get(cell.x, cell.y, cell.z, activePart)?.color === cell.color) cells.push(cell);
      if (cells.length) partHighlight = buildOverlay("lab editor part", cells, partMaterial, 0.02, activePart);
    }
    jointMarker.parent = rigPart.node;
    jointMarker.position.set(0, 0, 0);
    jointMarker.scaling.setAll(session.pitch * 1.6);
    jointMarker.setEnabled(true);
    for (const [name, cell] of Object.entries(meta.sockets)) {
      const marker = MeshBuilder.CreateBox(`lab editor socket ${name}`, { size: 1 }, scene);
      marker.material = partMaterial;
      marker.isPickable = false;
      marker.parent = rigPart.node;
      marker.position.set((cell[0] - meta.pivot[0]) * session.pitch, (cell[1] - meta.pivot[1]) * session.pitch, (cell[2] - meta.pivot[2]) * session.pitch);
      marker.scaling.setAll(session.pitch * 1.3);
      socketMarkers.push(marker);
    }
  }

  // --------------------------------------------------------------- helpers --
  /** Layer rows in rendered order (collapsed branches skipped). */
  function visibleLayerOrder(): string[] {
    if (!session) return [];
    const out: string[] = [];
    const walk = (parent: string | undefined) => { for (const part of session!.childrenOf(parent)) { out.push(part); if (!collapsed.has(part)) walk(part); } };
    walk(undefined);
    for (const part of session.parts) if (!out.includes(part)) out.push(part);
    return out;
  }
  /** Dope-sheet rows in rendered order ("*" first, folded groups skipped). */
  function sheetRowOrder(): string[] {
    if (!session) return ["*"];
    const out = ["*"];
    const walk = (parent: string | undefined) => { for (const part of session!.childrenOf(parent)) { out.push(part); if (!(sheetCollapsed.has(part) && session!.childrenOf(part).length)) walk(part); } };
    walk(undefined);
    return out;
  }
  function activeClip(): AuthoredClip | null { return session?.clips.find((clip) => clip.id === activeClipId) ?? null; }
  function activeTrackPart(): string { return activePart ?? "*"; }
  /** The selected keys as (part, key) pairs, in track order. */
  function selectedKeyRefs(): { part: string; key: ClipKey }[] {
    const clip = activeClip();
    if (!clip) return [];
    const out: { part: string; key: ClipKey }[] = [];
    for (const track of clip.tracks) for (const key of track.keys) if (selectedKeys.has(keyId(track.part, key.t))) out.push({ part: track.part, key });
    return out;
  }
  /** Patch every selected key (ease, mute…) in one undo step. A patch value of `undefined` clears that field. */
  function updateSelectedKeys(patch: Partial<ClipKey>, label: string): void {
    if (!session || !activeClipId) return;
    const refs = selectedKeyRefs();
    if (!refs.length) return;
    session.beginStroke();
    for (const { part, key } of refs) {
      const next: ClipKey = { ...key, ...patch };
      for (const field of Object.keys(patch) as (keyof ClipKey)[]) if (patch[field] === undefined) delete next[field];
      session.removeKey(activeClipId, part, key.t);
      session.setKey(activeClipId, part, next);
    }
    session.endStroke();
    statusText = `${refs.length} keys ${label}`;
    markChanged();
  }
  function keyAtScrub(): ClipKey | undefined {
    return activeClip()?.tracks.find((track) => track.part === activeTrackPart())?.keys.find((key) => Math.abs(key.t - scrubTime) < 1e-6);
  }
  function poseAtScrub(): PartPose {
    const clip = activeClip();
    return clip ? (sampleClip(clip, scrubTime).get(activeTrackPart()) ?? REST_POSE) : REST_POSE;
  }
  function stepsLabel(n: number): string { return `${n} step${n === 1 ? "" : "s"}`; }

  // ---------------------------------------------------------------- render --
  function renderAll(): void {
    if (!session) return;
    renderModes();
    renderLeft();
    renderRight();
    renderBottom();
    updatePartHighlight();
  }
  function renderModes(): void {
    panels.modes.innerHTML = `<button data-mode="model" class="${mode === "model" ? "active" : ""}" title="Voxels, parts, joints, transforms (Tab switches)">🧊 Model</button><button data-mode="animate" class="${mode === "animate" ? "active" : ""}" title="Clips, keys, events, playback (Tab switches)">🎬 Animate</button><button data-action="close" title="Leave the editor (Esc from Inspect)">✅ Done</button>`;
  }
  function renderLeft(): void {
    if (!session) return;
    const parts = session.parts;
    const counts = session.partCounts();
    const rows: string[] = [];
    const walk = (parent: string | undefined, depth: number) => {
      const siblings = session!.childrenOf(parent);
      if (layerSort === "size") siblings.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
      for (const part of siblings) {
        const children = session!.childrenOf(part);
        const hiddenSelf = session!.isPartHidden(part);
        const visible = session!.isPartVisible(part);
        const count = counts.get(part) ?? 0;
        const hasKeys = activeClip()?.tracks.some((track) => track.part === part) ?? false;
        rows.push(`<div class="lab-layer ${part === activePart ? "active" : ""} ${selectedParts.has(part) && part !== activePart ? "selected" : ""} ${visible ? "" : "dim"}" draggable="true" data-part="${escapeHtml(part)}" style="--depth:${depth}" title="${escapeHtml(part)} · ${count} voxels · joint (${session!.partMeta(part)!.pivot.join(", ")}) · click selects, Shift+click selects a range, Ctrl+click toggles · right-click for actions · drag onto another layer to parent it, onto Root to detach">
          <button class="lab-layer-eye" data-part-toggle="${escapeHtml(part)}" title="${hiddenSelf ? "Show" : "Hide"} (children follow)">${hiddenSelf ? "🙈" : visible ? "👁️" : "◌"}</button>
          <button class="lab-layer-caret ${children.length ? "" : "empty"}" data-part-collapse="${escapeHtml(part)}" title="${collapsed.has(part) ? "Expand" : "Collapse"}">${children.length ? (collapsed.has(part) ? "▸" : "▾") : "·"}</button>
          ${renaming === part ? `<input class="lab-layer-rename" data-rename="${escapeHtml(part)}" value="${escapeHtml(part)}" />` : `<span class="lab-layer-name" data-part-select="${escapeHtml(part)}">${escapeHtml(part)}</span>`}
          ${hasKeys ? `<span class="lab-layer-keyed" title="has keys in ${escapeHtml(activeClipId ?? "")}">◆</span>` : ""}
          ${session!.partMeta(part)!.states.length ? `<small class="lab-layer-states" title="${session!.partMeta(part)!.states.length} voxel state(s): ${escapeHtml(session!.partMeta(part)!.states.join(", "))}">🧊${session!.partMeta(part)!.states.length}</small>` : ""}<small>${count}</small>
        </div>`);
        if (!collapsed.has(part)) walk(part, depth + 1);
      }
    };
    walk(undefined, 0);
    for (const part of parts) { const parent = session.partMeta(part)?.parent; if (parent !== undefined && !parts.includes(parent)) rows.push(`<div class="lab-layer" data-part="${escapeHtml(part)}" draggable="true"><span class="lab-layer-name" data-part-select="${escapeHtml(part)}">${escapeHtml(part)} (orphan)</span></div>`); }
    panels.left.innerHTML = `
      <header class="lab-panel-head"><strong>🧩 Layers</strong><small>${parts.length} part${parts.length === 1 ? "" : "s"}</small></header>
      <div class="lab-panel-row">
        <button data-action="part-add" title="New empty part (N). Give it voxels with 🧱 Add or 🧩 Assign, or paste into it">＋ Part</button>
        <button data-action="part-duplicate" ${activePart ? "" : "disabled"} title="Duplicate the active part (Ctrl+D), same parent, one cell aside">⧉</button>
        <button data-action="part-copy" ${activePart ? "" : "disabled"} title="Copy the active part (Ctrl+C) — works across models">📋</button>
        <button data-action="part-paste" ${clipboard ? "" : "disabled"} title="${clipboard ? `Paste "${escapeHtml(clipboard.source)}" as a new part (Ctrl+V), under the active part` : "Nothing copied yet"}">📥</button>
        <button data-action="autorig" ${parts.length > 1 ? "" : "disabled"} title="Infer parents and joints from where parts touch (keeps parents you set)">🦴</button>
        <button data-action="part-extract" ${activePart ? "" : "disabled"} title="Extract the active part (with its children) as its own catalog object — e.g. keep just this leaf design under a new id">📤</button>
        <span class="lab-editor-grow"></span>
        <button data-action="layer-sort" class="${layerSort === "size" ? "active" : ""}" title="${layerSort === "size" ? "Sorted by voxel count (click for file order)" : "Sort siblings by voxel count"}">↕</button>
        <button data-action="tidy-open" ${parts.length > 1 ? "" : "disabled"} title="Tidy fragments: fold tiny pieces (scan flakes) into the parts they touch, or gather / delete them">🧹 Tidy</button>
      </div>
      <div class="lab-layers" id="lab-layers">
        <div class="lab-layer lab-layer-root" data-drop-root="1" title="Drop a layer here to detach it from its parent">▣ Root</div>
        ${rows.join("")}
      </div>
      <div class="lab-panel-hint">Click: select · Shift+click: range · Ctrl+click: toggle · right-click: actions · Ctrl+G: group · double-click: rename · drag: re-parent · 👁️ hides children too${selectedParts.size > 1 ? ` · <b>${selectedParts.size} selected</b>` : ""}</div>`;
    const input = panels.left.querySelector<HTMLInputElement>(".lab-layer-rename");
    if (input) { input.focus(); input.select(); }
  }
  function renderRight(): void {
    if (!session) return;
    const dirty = session.dirty;
    const palette = session.paletteInUse();
    const meta = activePart ? session.partMeta(activePart) : undefined;
    const historyRow = `<div class="lab-panel-row lab-panel-history"><button data-action="undo" ${session.canUndo ? "" : "disabled"} title="Undo (Ctrl+Z) · ${stepsLabel(session.undoDepth)} back">↶</button><button data-action="redo" ${session.canRedo ? "" : "disabled"} title="Redo (Ctrl+Shift+Z) · ${stepsLabel(session.redoDepth)} forward">↷</button><span class="lab-editor-grow"></span>${dirty ? `<button data-action="revert" title="Discard every unsaved edit and reload from the catalog">♻️ Reset</button><button data-action="save" class="primary" title="Write into src/assets/food-models.json (Ctrl+S)">💾 Save</button>` : `<span class="lab-editor-saved">✔ Saved</span>`}<button data-action="saveas" title="Write under a new model id, keeping the original">📄 Copy…</button></div>`;
    const controls = `<details class="lab-editor-controls" ${controlsOpen ? "open" : ""}><summary>🎮 Controls &amp; hotkeys</summary><table>
      <tr><th>🖱️ Left</th><td>${mode === "model" ? "Use the active tool. Add: tap = one brush, drag = stroke along that plane (works on the ground for new parts). Assign: tap = region, drag = brush" : "Click a voxel to select its part; drag orbits"}</td></tr>
      <tr><th>🖱️ Right drag · Middle · <kbd>Ctrl</kbd>+right</th><td>Orbit · pan · pan</td></tr>
      <tr><th><kbd>Space</kbd>/<kbd>Alt</kbd> + drag</th><td>${mode === "model" ? "Orbit with any tool (or 🧭 Orbit)" : "Space = play/pause; Alt+drag orbits"}</td></tr>
      <tr><th>🖱️ Right-hold + move · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> <kbd>Q</kbd><kbd>E</kbd></th><td>Head camera: look around from where you stand; while holding, fly forward/left/back/right and down/up along your view. <kbd>Shift</kbd> fast · <kbd>Alt</kbd> slow · the 🎮 slider sets the speed. Let go and you stay right there: left-drag orbits around what you were looking at</td></tr>
      <tr><th><kbd>C</kbd> · <kbd>F</kbd> · middle-click · middle-drag / <kbd>Shift</kbd>+right-drag</th><td>Fly mode: WASD/QE move without holding the mouse (gizmo keys Q/W wait until you leave) · frame the selected layers · orbit around the voxel under the pointer · pan</td></tr>
      <tr><th><kbd>1</kbd> <kbd>3</kbd> <kbd>7</kbd> (+<kbd>Shift</kbd>) · <kbd>Alt</kbd>+scroll</th><td>Front / right / top view (Shift: back / left / bottom) · field of view</td></tr>
      <tr><th><kbd>Tab</kbd></th><td>Switch 🧊 Model / 🎬 Animate</td></tr>
      <tr><th><kbd>N</kbd> · <kbd>Ctrl</kbd>+<kbd>D</kbd>/<kbd>C</kbd>/<kbd>V</kbd> · 📤</th><td>New part · duplicate / copy / paste part · extract the active part (+children) as its own catalog object · <kbd>Del</kbd> deletes the selected layers</td></tr>
      <tr><th>Layers: <kbd>Shift</kbd>+click · <kbd>Ctrl</kbd>+click · right-click · <kbd>Ctrl</kbd>+<kbd>G</kbd> · <kbd>Shift</kbd>+<kbd>Ctrl</kbd>+<kbd>G</kbd></th><td>Select a range of rows · toggle one · actions menu · group the selection under a new parent joint (deepest common ancestor, like Figma) · ungroup. With several layers selected, Move/Turn/Rotate/Mirror/Scale and the gizmo act on all of them (around the selection's centre — Model: baked as one body; Animate: each part orbits the centre and takes the same turn/scale on its own pose)</td></tr>
      <tr><th>${TOOLS.map((t) => `<kbd>${t.key}</kbd>`).join(" ")}</th><td>${TOOLS.map((t) => `${t.icon} ${t.label}`).join(" · ")} · <kbd>[</kbd> <kbd>]</kbd> brush</td></tr>
      <tr><th><kbd>Q</kbd> <kbd>W</kbd> <kbd>R</kbd> <kbd>T</kbd> · <kbd>Shift</kbd></th><td>Gizmo: none · move arrows · rotate rings · scale cubes. Shift snaps rotation to 5° and scale to 0.1; moves step one voxel in Model mode (five with Shift) and are smooth in Animate (one voxel with Shift). Model mode stores the result on the part (rotation / move / scale fields, non-destructive, saved with the model); ⤓ bakes it into the voxels when you want the grid itself changed</td></tr>
      <tr><th><kbd>Shift</kbd>+🪣 · <kbd>Alt</kbd>+chip</th><td>Fill similar shades · replace a palette color everywhere</td></tr>
      <tr><th>Double-click chip · 🗑 Delete</th><td>Edit a palette color everywhere it is used · erase every voxel of the selected color (undoable)</td></tr>
      <tr><th>Layers: select A, right-click B · 🧹 Tidy · ↕</th><td>“Merge B into A” pours B's voxels into A and removes B (children and sockets follow; A into B also offered; with several selected: merge the others into the clicked one) · fold scan fragments into the parts they touch, gather or delete them, with a live pink preview · sort layers by voxel count</td></tr>
      <tr><th><kbd>I</kbd> · <kbd>←</kbd> <kbd>→</kbd> · <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> · <kbd>Home</kbd></th><td>Animate: insert key · step 0.05 s · previous/next key · start</td></tr>
      <tr><th><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>S</kbd></th><td>Undo / redo (voxels, joints, parents, keys, retimes — kept per object) / save</td></tr>
      <tr><th>◆ at the playhead</th><td>Click the white diamond again to mute that key (◇, ignored when playing); click once more to enable</td></tr>
      <tr><th>Opacity · Fade</th><td>A key's Opacity (0–1) interpolates like rotation; the track's Fade decides the look: <b>fade</b> = translucent (smoke rising and thinning, ghosts), <b>dither</b> = voxels drop out in a fixed order so the part stays crisp and opaque. Smoke = a few puff parts looping position up + scale up + opacity 1→0, phased</td></tr>
      <tr><th>🧊 States · Key “Voxels” · Switch</th><td>A part can keep alternative voxel snapshots (bite1, lights_off, an empty plate item). Model: ＋ copies the shown state, chips switch what you see and edit. Animate: a key's Voxels dropdown picks the state shown from that key on (“keep” leaves it); Switch decides how it plays over the segment before the key — blend (colours crossfade, appearing/vanishing voxels dissolve in a random sprinkle or a wave), pop (scale in/out) or cut (instant); ✏️ Edit jumps to Model on that state</td></tr>
      <tr><th>Drag a box · <kbd>Ctrl</kbd>+<kbd>A</kbd> · ⬚ All</th><td>Select many keys (Shift/Ctrl adds to the selection); the right panel then shows "N keys selected" with Ease, Enable, Mute and Delete for all of them. The ruler scrubs; a click on a lane jumps</td></tr>
      <tr><th>Keys: click · <kbd>Shift</kbd>+click · <kbd>Ctrl</kbd>+click · <kbd>Ctrl</kbd>+<kbd>A</kbd></th><td>Select · select the block between the last click and this key · toggle one · select all (Shift: active track only). Selected keys drag together</td></tr>
      <tr><th>Animate: <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>V</kbd> · <kbd>Del</kbd></th><td>Copy selected keys · paste at the playhead (single-part copies go onto the active track, multi-part keep their parts) · delete selected keys</td></tr>
      <tr><th><kbd>Esc</kbd></th><td>Back to Inspect, then leave the editor</td></tr>
    </table><div class="lab-panel-hint">Pink = voxels the click will change · cyan = active part · yellow cube = its joint · timeline keys drag to retime</div></details>`;
    const status = `<div class="lab-editor-status">${escapeHtml(statusText)}</div>`;
    const gizmoBar = `<div class="lab-panel-row lab-gizmo-bar"><span class="lab-field-label">Gizmo</span>${GIZMOS.map((g) => `<button data-gizmo="${g.id}" class="${gizmoMode === g.id ? "active" : ""}" title="${g.hint} (${g.key})">${g.icon} ${g.label}</button>`).join("")}${mode === "animate" ? `<button data-action="autokey" class="lab-autokey ${autoKey ? "active" : ""}" title="Auto-key: a gizmo drag inserts/updates the key at the playhead">${autoKey ? "🔴" : "⚪"} Auto-key</button>` : ""}</div>`;
    if (mode === "model") {
      const partBox = meta && activePart ? `
        <section class="lab-panel-section"><header class="lab-panel-head"><strong>📦 ${escapeHtml(activePart)}</strong><small>${session.partCellCount(session.layerOf(activePart))} voxels${session.displayedStateOf(activePart) !== "base" ? ` in state ${escapeHtml(session.displayedStateOf(activePart))}` : ""} · ${meta.parent ? `child of ${escapeHtml(meta.parent)}` : "root"}${selectionTops().length > 1 ? ` · <b>${selectionList().length} selected</b>: transforms and the gizmo act on all, around the selection's centre` : ""}</small></header>
          ${gizmoBar}
          <div class="lab-panel-row"><span class="lab-field-label">Joint</span>${[0, 1, 2].map((i) => `<input type="number" data-joint="${i}" value="${meta.pivot[i]}" step="1" title="${"xyz"[i]} in cells" />`).join("")}<button data-action="joint-center" title="Joint at the part's centre">⌖</button><button data-action="joint-base" title="Joint at the centre of the part's bottom row">⏚</button></div>
          <div class="lab-panel-row lab-states"><span class="lab-field-label" title="Voxel states: alternative snapshots of this part's voxels (bites, lights on/off). A clip key switches between them">🧊 States</span>${["base", ...meta.states].map((state) => `<button data-state="${escapeHtml(state)}" class="lab-state-chip ${session!.displayedStateOf(activePart!) === state ? "active" : ""}" title="${state === "base" ? "The part's own voxels" : `Show and edit state “${escapeHtml(state)}”`}">${escapeHtml(state)}</button>`).join("")}<button data-action="state-add" title="New state: a copy of the shown voxels you can then edit (erase a bite, repaint a light…)">＋</button>${session!.displayedStateOf(activePart!) !== "base" ? `<button data-action="state-rename" title="Rename this state">✏️</button><button data-action="state-delete" title="Delete this state (keys pointing at it stop switching)">🗑️</button>` : ""}</div>
          ${session!.displayedStateOf(activePart!) !== "base" ? `<div class="lab-panel-hint lab-state-hint">Editing state <b>${escapeHtml(session!.displayedStateOf(activePart!))}</b> of ${escapeHtml(activePart)}: brushes change only this snapshot. In Animate, a key's “Voxels” picks which state shows from then on.</div>` : ""}
          <header class="lab-panel-head" style="margin-top:4px"><small>Transform — stored on the part, voxels stay on their grid; clips animate on top of it</small></header>
          <div class="lab-panel-row"><span class="lab-field-label">Rotate °</span>${[0, 1, 2].map((i) => `<input type="number" data-transform="rotation" data-index="${i}" value="${meta.transform.rotation[i]}" step="1" title="degrees about ${"xyz"[i]} around the joint" />`).join("")}<button data-tf-rot="x,90" title="+90° about X">X+90</button><button data-tf-rot="y,90" title="+90° about Y">Y+90</button><button data-tf-rot="z,90" title="+90° about Z">Z+90</button></div>
          <div class="lab-panel-row"><span class="lab-field-label">Move ▢</span>${[0, 1, 2].map((i) => `<input type="number" data-transform="position" data-index="${i}" value="${meta.transform.position[i]}" step="1" title="${"xyz"[i]} offset in cells" />`).join("")}</div>
          <div class="lab-panel-row"><span class="lab-field-label">Scale ×</span>${[0, 1, 2].map((i) => `<input type="number" data-transform="scale" data-index="${i}" value="${meta.transform.scale[i]}" step="0.1" min="0.01" title="${"xyz"[i]} factor about the joint" />`).join("")}<button data-tf-scale="2" title="Double all">×2</button><button data-tf-scale="0.5" title="Halve all">÷2</button></div>
          <div class="lab-panel-row"><button data-action="tf-reset" ${isIdentityTransform(meta.transform) ? "disabled" : ""} title="Back to no rotation, no offset, scale 1">↺ Reset</button><button data-action="tf-bake" ${isIdentityTransform(meta.transform) ? "disabled" : ""} title="Write the transform into the voxels (re-grids them; whole-cell moves and 90° turns are exact) and reset it">⤓ Bake into voxels</button><span class="lab-editor-grow"></span><span class="lab-field-label">Mirror</span><button data-tf-mirror="0" title="Mirror the voxels across X (baked, exact)">X</button><button data-tf-mirror="1" title="Mirror the voxels across Y (baked, exact)">Y</button><button data-tf-mirror="2" title="Mirror the voxels across Z (baked, exact)">Z</button></div>
          ${Object.keys(meta.sockets).length ? `<div class="lab-panel-row"><span class="lab-field-label">Sockets</span>${Object.entries(meta.sockets).map(([name, cell]) => `<button data-socket-remove="${escapeHtml(name)}" title="Remove socket ${escapeHtml(name)} at (${cell.join(", ")})">🔗 ${escapeHtml(name)} ✕</button>`).join("")}</div>` : ""}
          <div class="lab-panel-row"><button data-action="part-delete" title="Delete this part and its voxels; children re-attach to its parent (Del)">🗑️ Delete part</button></div>
        </section>` : `<section class="lab-panel-section"><small>Select a layer on the left to see its joint, transforms and sockets.</small></section>`;
      panels.right.innerHTML = `${historyRow}
        <div class="lab-editor-tools">${TOOLS.map((t) => `<button data-tool="${t.id}" class="lab-editor-tile ${tool === t.id ? "active" : ""}" title="${t.hint} (${t.key})"><span class="lab-editor-icon">${t.icon}</span><span class="lab-editor-label">${t.label}</span><kbd>${t.key}</kbd></button>`).join("")}</div>
        <div class="lab-panel-row lab-editor-brushes"><span class="lab-field-label">Brush</span>${BRUSH_SIZES.map((r) => `<button data-brush="${r}" class="${brush === r ? "active" : ""}" title="${2 * r + 1}³ voxels ([ and ])"><i style="width:${5 + r * 3}px;height:${5 + r * 3}px"></i>${2 * r + 1}</button>`).join("")}<span class="lab-editor-grow"></span><label class="lab-editor-swatch" style="background:${color}" title="Current color ${color}"><input type="color" data-action="color" value="${color}" /><span>🎨</span></label></div>
        <section class="lab-panel-section"><header class="lab-panel-head"><strong>🎨 Palette</strong><small>click: select · double-click: edit · Alt+click: replace all · ＋ adds a color</small></header>
          <div class="lab-editor-palette">${palette.map((entry) => `<button data-palette="${entry.color}" class="lab-editor-chip ${selectedPaletteColor === entry.color ? "active" : ""} ${session!.glowOf(entry.color) ? "glow" : ""}" style="background:${entry.color}" title="${entry.color} · ${entry.count} voxels${session!.glowOf(entry.color) ? ` · ✨ glows ×${session!.glowOf(entry.color)}` : ""}"></button>`).join("")}${extraSwatches.filter((hex) => !palette.some((entry) => entry.color === hex)).map((hex) => `<button data-palette="${hex}" data-swatch="1" class="lab-editor-chip extra ${selectedPaletteColor === hex ? "active" : ""}" style="background:${hex}" title="${hex} · added, not used yet · Shift+click removes the swatch"></button>`).join("")}<label class="lab-editor-chip add" title="Add a color to the palette"><input type="color" data-action="swatch-add" value="${color}" />＋</label><input type="color" data-action="palette-edit" class="lab-palette-editor" tabindex="-1" /></div>
          <div class="lab-panel-hint">Double-click a chip to edit that color everywhere it is used.</div>
          ${selectedPaletteColor ? `<div class="lab-panel-row"><span class="lab-editor-mini" style="background:${selectedPaletteColor}"></span><code>${selectedPaletteColor}</code><span class="lab-editor-grow"></span><button data-action="replace">🔁 Replace all → current</button><button data-action="delete-color" title="Remove this color: erases every voxel using it (undoable); an unused swatch is just dropped">🗑 Delete</button><button data-action="glow-toggle" class="${session!.glowOf(selectedPaletteColor) ? "active" : ""}" title="Glow: voxels of this color are drawn unlit and bloom in the world (a lamp shade, an oven window, embers). Toggle on/off">✨ Glow</button>${session!.glowOf(selectedPaletteColor) ? `<input type="range" data-action="glow-intensity" min="0.2" max="3" step="0.1" value="${session!.glowOf(selectedPaletteColor)}" title="Glow strength ×${session!.glowOf(selectedPaletteColor)}" style="width:70px" />` : ""}</div>` : ""}
        </section>
        <section class="lab-panel-section"><header class="lab-panel-head"><strong>💡 Lights</strong><small>point lights the model carries into the world (a few nearest the camera are real, the rest is glow)</small></header>
          ${session!.lights.map((light, index) => `<div class="lab-panel-row lab-light-row"><input type="color" data-light-color="${index}" value="${escapeHtml(light.color ?? "#ffd9a0")}" title="Light color" /><label title="Intensity (1 = a lamp)">✦<input type="number" data-light-intensity="${index}" min="0" step="0.1" value="${light.intensity ?? 1}" /></label><label title="Range in metres: where the light fades to nothing">↔<input type="number" data-light-range="${index}" min="0.5" step="0.5" value="${light.range ?? 7}" /></label><code title="Cell position">${light.position.join(", ")}</code><span class="lab-editor-grow"></span><button data-light-here="${index}" title="Move this light to the centre of the active part (or of the model)">📍</button><button data-light-remove="${index}" title="Remove this light">✕</button></div>`).join("")}
          <div class="lab-panel-row"><button data-action="light-add" title="Add a point light at the centre of the active part (or of the whole model); adjust it in the row above">＋ Add light</button></div>
        </section>
        ${partBox}
        ${status}${controls}`;
    } else {
      const clip = activeClip();
      const pose = draftPose ?? poseAtScrub();
      const existingKey = keyAtScrub();
      const trackPart = activeTrackPart();
      // With several keys selected the fields show the value they all share, or
      // "XXX" where they differ; typing into one writes that component to every
      // selected key and leaves the other components alone.
      const multiRefs = selectedKeys.size > 1 ? selectedKeyRefs() : null;
      const number = (name: string, index: number, value: number, step: number) => {
        if (multiRefs && multiRefs.length > 1) {
          const channel = name as "rotation" | "position" | "scale";
          const values = multiRefs.map((ref) => round((ref.key[channel] ?? REST_POSE[channel])[index]!, 3));
          const same = values.every((v) => v === values[0]);
          return `<input type="number" data-pose="${name}" data-index="${index}" data-multi="1" value="${same ? values[0] : ""}" placeholder="${same ? "" : "XXX"}" step="${step}" title="${same ? `All ${multiRefs.length} selected keys: ${values[0]}` : `Differs between the selected keys (${[...new Set(values)].slice(0, 6).join(", ")}${new Set(values).size > 6 ? ", …" : ""}) — type a value to set it on all of them`}" />`;
        }
        return `<input type="number" data-pose="${name}" data-index="${index}" value="${round(value, 3)}" step="${step}" />`;
      };
      panels.right.innerHTML = `${historyRow}
        <section class="lab-panel-section"><header class="lab-panel-head"><strong>🎬 Clip</strong><small>${session.clips.length} in this model</small></header>
          <div class="lab-panel-row"><select data-action="clip-select" title="Clip to edit and play (shown as name · id)"><option value="">— none —</option>${session.clips.map((c) => `<option value="${escapeHtml(c.id)}" ${c.id === activeClipId ? "selected" : ""}>${escapeHtml(c.name ? `${c.name} · ${c.id}` : c.id)}</option>`).join("")}</select><button data-action="clip-add" title="New clip">＋</button>${clip ? `<button data-action="clip-rename" title="Rename clip">✏️</button><button data-action="clip-delete" title="Delete clip">🗑️</button>` : ""}</div>
          ${clip ? `<div class="lab-panel-row"><label title="Display name; the id (${escapeHtml(clip.id)}) is what code references">Name <input type="text" data-action="clip-name" value="${escapeHtml(clip.name ?? "")}" placeholder="${escapeHtml(clip.id)}" /></label></div>
          <div class="lab-panel-row"><label>Length <input type="number" data-action="clip-duration" value="${clip.duration}" min="0.05" step="0.05" /> s</label><label><input type="checkbox" data-action="clip-loop" ${clip.loop ? "checked" : ""} /> loop</label><small>id: <code>${escapeHtml(clip.id)}</code></small></div>` : ""}
        </section>
        ${clip && selectedKeys.size > 1 ? (() => {
          const refs = selectedKeyRefs();
          const eases = new Set(refs.map((ref) => ref.key.ease ?? "inOut"));
          const common = eases.size === 1 ? [...eases][0]! : "";
          const muted = refs.filter((ref) => ref.key.disabled).length;
          return `<section class="lab-panel-section lab-keys-selected"><header class="lab-panel-head"><strong>◆ ${refs.length} keys selected</strong><small>changes here apply to all of them</small></header>
          <div class="lab-panel-row"><label>Ease in <select data-action="keys-ease" title="Set the ease of every selected key (how the motion arrives at each key)"><option value="" ${common ? "" : "selected"}>${common ? "— set all to… —" : "— mixed —"}</option>${EASES.map((e) => `<option value="${e}" ${common === e ? "selected" : ""}>${e}</option>`).join("")}</select></label><button data-action="keys-enable" ${muted ? "" : "disabled"} title="Enable every selected key">◆ Enable</button><button data-action="keys-mute" ${muted < refs.length ? "" : "disabled"} title="Mute every selected key (kept, ignored when playing)">◇ Mute</button><button data-action="keys-delete" title="Delete the selected keys (Del)">✕ Delete</button></div>
          <div class="lab-panel-hint">${eases.size > 1 ? `Eases are mixed (${[...eases].join(", ")}) — pick one to make the motion even. ` : ""}The pose fields below show what the selected keys share; XXX marks a value that differs — type there to set it on every selected key.</div>
        </section>`;
        })() : ""}
        ${clip ? `
        <section class="lab-panel-section"><header class="lab-panel-head"><strong>🔑 ${multiRefs && multiRefs.length > 1 ? `${multiRefs.length} keys` : "Key"}</strong><small>${multiRefs && multiRefs.length > 1 ? "shared values shown · XXX = differs · typing sets all" : `${escapeHtml(trackPart)} @ ${round(scrubTime, 2)} s${existingKey ? " · on a key" : ""}`}</small></header>
          ${gizmoBar}
          ${trackPart === "*" ? `<div class="lab-panel-hint">Whole model. Select a layer on the left to animate one part.</div>` : ""}
          <div class="lab-editor-pose">
            <div><span>Rotate °</span>${[0, 1, 2].map((i) => number("rotation", i, pose.rotation[i]!, 1)).join("")}</div>
            <div><span>Move ▢</span>${[0, 1, 2].map((i) => number("position", i, pose.position[i]!, 1)).join("")}</div>
            <div><span>Scale ×</span>${[0, 1, 2].map((i) => number("scale", i, pose.scale[i]!, 0.05)).join("")}</div>
            ${trackPart === "*" ? "" : (() => {
              const track = clip.tracks.find((candidate) => candidate.part === trackPart);
              const fade = track?.fade ?? "fade";
              if (multiRefs && multiRefs.length > 1) {
                const values = multiRefs.map((ref) => round(ref.key.opacity ?? 1, 3));
                const same = values.every((v) => v === values[0]);
                return `<div><span title="0 = invisible, 1 = solid; the track's Fade decides how">Opacity</span><input type="number" data-opacity="1" data-multi="1" min="0" max="1" step="0.05" value="${same ? values[0] : ""}" placeholder="${same ? "" : "XXX"}" title="${same ? `All selected keys: ${values[0]}` : "Differs between the selected keys — type a value to set it on all"}" /><select data-action="track-fade" title="How opacity below 1 renders on this part: fade = translucent, dither = voxels drop out, crisp">${FADE_MODES.map((mode) => `<option value="${mode}" ${fade === mode ? "selected" : ""}>${mode}</option>`).join("")}</select></div>`;
              }
              return `<div><span title="0 = invisible, 1 = solid; interpolates like the other channels. Smoke: opacity 1 → 0 while it rises">Opacity</span><input type="number" data-opacity="1" min="0" max="1" step="0.05" value="${round(pose.opacity ?? 1, 3)}" /><select data-action="track-fade" title="How opacity below 1 renders on this part: fade = translucent (smoke, ghosts), dither = voxels drop out in a fixed order, staying crisp">${FADE_MODES.map((mode) => `<option value="${mode}" ${fade === mode ? "selected" : ""}>${mode === "fade" ? "fade (translucent)" : "dither (voxels drop out)"}</option>`).join("")}</select></div>`;
            })()}
            ${multiRefs && multiRefs.length > 1 || trackPart === "*" ? "" : (() => {
              const meta = session!.partMeta(trackPart);
              const chosen = existingKey?.state ?? pendingKeyState;
              const shown = session!.displayedStateOf(trackPart);
              return `<div><span title="Voxel state this key switches the part to (stepwise, from this key on). Keys without one leave the state as it was">Voxels</span><select data-action="key-state" title="Voxel state from this key on"><option value="" ${chosen === "" ? "selected" : ""}>— keep —</option>${["base", ...(meta?.states ?? [])].map((state) => `<option value="${escapeHtml(state)}" ${chosen === state ? "selected" : ""}>${escapeHtml(state)}</option>`).join("")}<option value="__new">＋ new state from shown…</option></select><button data-action="state-edit" title="Edit the voxels of the state shown now (${escapeHtml(shown)}) with the Model tools; Tab brings you back">✏️ Edit ${escapeHtml(shown)}</button></div>${chosen ? (() => {
                const transition = existingKey?.transition ?? pendingTransition;
                const direction = existingKey?.transitionDirection ?? pendingDirection;
                return `<div><span title="How the switch plays over the segment leading into this key">Switch</span><select data-action="key-transition" title="blend: colours crossfade, appearing/vanishing voxels dissolve · pop: they scale in/out · cut: instant">${STATE_TRANSITIONS.map((t) => `<option value="${t}" ${transition === t ? "selected" : ""}>${t === "blend" ? "blend (dissolve)" : t}</option>`).join("")}</select>${transition === "blend" ? `<select data-action="key-direction" title="Dissolve order: random sprinkle or a wave along an axis">${TRANSITION_DIRECTIONS.map((d) => `<option value="${d}" ${direction === d ? "selected" : ""}>${d === "random" ? "random" : `wave ${d}`}</option>`).join("")}</select>` : ""}<small class="lab-panel-hint">plays from the previous key to this one</small></div>`;
              })() : ""}`;
            })()}
            ${multiRefs && multiRefs.length > 1 ? "" : `<div><span>Ease in</span><select data-action="key-ease">${EASES.map((e) => `<option value="${e}" ${(existingKey?.ease ?? lastEase) === e ? "selected" : ""}>${e}</option>`).join("")}</select><button data-action="key-set" class="primary" title="Store these values as the key at t (I)">${existingKey ? "💾 Update" : "🔑 Insert"}</button>${existingKey ? `<button data-action="key-toggle" class="${existingKey.disabled ? "" : "active"}" title="${existingKey.disabled ? "Muted: enable this key" : "Enabled: mute this key (kept, but ignored when playing)"}">${existingKey.disabled ? "◇ Muted" : "◆ On"}</button><button data-action="key-delete" title="Remove this key">✕</button>` : ""}</div>`}
          </div>
          <div class="lab-panel-row"><button data-action="key-rest" title="Type the rest pose into the fields">↺ Rest values</button><button data-action="event-add" title="Add an event marker at t (the game reacts here: consume input, burst, swap model)">🚩 Event at t</button></div>
        </section>` : `<section class="lab-panel-section"><small>Create or pick a clip. Keys store a pose per part at a time: rotation around its joint, movement in cells, scale. The dope sheet below shows every key.</small></section>`}
        ${status}${controls}`;
    }
  }
  function renderBottom(): void {
    if (!session || mode !== "animate") { panels.bottom.innerHTML = ""; return; }
    const clip = activeClip();
    if (!clip) { panels.bottom.innerHTML = `<div class="lab-sheet-empty">No clip selected — create one in the 🎬 Clip panel on the right.</div>`; return; }
    const pct = (t: number) => `${(t / clip.duration) * 100}%`;
    const keysOf = (part: string) => clip.tracks.find((track) => track.part === part)?.keys ?? [];
    // Rows follow the rig hierarchy, like Blender's dope-sheet groups: a
    // folded parent summarises its descendants' keys as hollow diamonds.
    type Row = { part: string; depth: number; children: string[]; folded: boolean; hiddenChildKeys: number[] };
    const rows: Row[] = [{ part: "*", depth: 0, children: [], folded: false, hiddenChildKeys: [] }];
    const walk = (parent: string | undefined, depth: number) => {
      for (const part of session!.childrenOf(parent)) {
        const children = session!.childrenOf(part);
        const folded = sheetCollapsed.has(part) && children.length > 0;
        const hiddenChildKeys = folded ? [...new Set(session!.descendantsOf(part).flatMap((child) => keysOf(child).map((key) => key.t)))].sort((a, b) => a - b) : [];
        rows.push({ part, depth, children, folded, hiddenChildKeys });
        if (!folded) walk(part, depth + 1);
      }
    };
    walk(undefined, 0);
    const tickStep = clip.duration > 4 ? 0.5 : 0.25;
    const ticks: string[] = [];
    for (let t = 0; t <= clip.duration + 1e-9; t = round(t + tickStep, 4)) ticks.push(`<div class="lab-sheet-tick ${Number.isInteger(t * 2) ? "major" : ""}" style="left:${pct(t)}">${Number.isInteger(t * 2) ? `<span>${t}</span>` : ""}</div>`);
    const nameCells = rows.map((row) => {
      const keyCount = keysOf(row.part).length;
      const label = row.part === "*" ? "✦ whole model" : escapeHtml(row.part);
      const caret = row.children.length ? `<button class="lab-sheet-caret" data-sheet-collapse="${escapeHtml(row.part)}" title="${row.folded ? "Expand" : "Collapse"} group">${row.folded ? "▸" : "▾"}</button>` : `<span class="lab-sheet-caret empty">·</span>`;
      return `<div class="lab-sheet-name-cell ${row.part === activeTrackPart() ? "active" : ""} ${keyCount ? "" : "untracked"}" data-track="${escapeHtml(row.part)}" style="--depth:${row.depth}" title="${label}${keyCount ? ` · ${keyCount} key${keyCount === 1 ? "" : "s"}` : " · no keys yet"}${row.folded ? ` · ${row.hiddenChildKeys.length} child key time(s) folded` : ""}">${caret}<span class="lab-sheet-label">${label}</span>${keyCount ? `<small>${keyCount}</small>` : ""}</div>`;
    }).join("");
    const lanes = rows.map((row) => {
      const own = keysOf(row.part).map((key) => {
        const at = Math.abs(key.t - scrubTime) < 1e-6;
        const selected = selectedKeys.has(keyId(row.part, key.t));
        const dragging = keyDrag && keyDrag.group.some((member) => member.part === row.part && Math.abs(member.t - key.t) < 1e-6);
        const shown = dragging ? Math.min(clip.duration, Math.max(0, key.t + (keyDrag!.to - keyDrag!.from))) : key.t;
        return `<button class="lab-sheet-key ${at ? "at" : ""} ${key.disabled ? "muted" : ""} ${selected ? "selected" : ""} ${key.state ? "has-state" : ""}" data-key-part="${escapeHtml(row.part)}" data-key-t="${key.t}" style="left:${pct(shown)}" title="${escapeHtml(row.part)} @ ${key.t}s${key.ease ? ` (${key.ease})` : ""}${key.state ? ` · voxels → ${escapeHtml(key.state)}` : ""}${key.disabled ? " · MUTED (ignored when playing)" : ""} — drag to retime (selected keys move together) · click to jump · Shift+click selects the block from the last click · Ctrl+click toggles · drag a box on empty lane space to select many · click again at the playhead to ${key.disabled ? "enable" : "mute"} it">${key.disabled ? "◇" : "◆"}</button>`;
      }).join("");
      const summary = row.hiddenChildKeys.map((t) => `<button class="lab-sheet-key summary" data-jump-t="${t}" style="left:${pct(t)}" title="keys of folded children @ ${t}s — click to jump">◇</button>`).join("");
      return `<div class="lab-sheet-row ${row.part === activeTrackPart() ? "active" : ""} ${row.depth ? "" : "top"}"><div class="lab-sheet-lane" data-lane="${escapeHtml(row.part)}">${summary}${own}</div></div>`;
    }).join("");
    const events = (clip.events ?? []).map((event) => `<button class="lab-sheet-event" data-event-t="${event.t}" style="left:${pct(event.t)}" title="event ${escapeHtml(event.name)} @ ${event.t}s${event.swapModel ? ` → ${escapeHtml(event.swapModel)}` : ""} (click: jump · Alt+click: remove)">🚩</button>`).join("");
    const groups = session.parts.filter((part) => session!.childrenOf(part).length > 0);
    panels.bottom.innerHTML = `
      <div class="lab-sheet-transport">
        <button data-action="go-start" title="Start (Home)">⏮</button><button data-action="play" class="${player?.playing ? "active" : ""}" title="Play / pause (Space)">${player?.playing ? "⏸" : "▶️"}</button><button data-action="go-end" title="End">⏭</button>
        <button data-action="clip-loop-toggle" class="${clip.loop ? "active" : ""}" title="Loop">🔁</button>
        <span class="lab-sheet-time"><b>${round(scrubTime, 2).toFixed(2)}</b> / ${clip.duration.toFixed(2)} s</span>
        <span class="lab-sheet-sep"></span>
        <button data-action="sheet-compact" ${groups.length ? "" : "disabled"} title="Fold every group to one row (keys of children shown as ◇)">⊟ Compact</button><button data-action="sheet-expand" ${sheetCollapsed.size ? "" : "disabled"} title="Unfold every group">⊞ Expand all</button>
        <span class="lab-sheet-sep"></span>
        <button data-action="keys-copy" ${selectedKeys.size || keyAtScrub() ? "" : "disabled"} title="Copy the selected keys (or the key at the playhead) — Ctrl+C">📋${selectedKeys.size ? ` ${selectedKeys.size}` : ""}</button>
        <button data-action="keys-paste" ${keyClipboard ? "" : "disabled"} title="${keyClipboard ? `Paste ${keyClipboard.keys.length} key(s) from ${keyClipboard.parts} part(s) so the earliest lands at the playhead — Ctrl+V (single-part copies paste onto the active track)` : "No keys copied yet"}">📥</button>
        <button data-action="keys-delete" ${selectedKeys.size ? "" : "disabled"} title="Delete the selected keys — Del">✕</button>
        <button data-action="keys-select-all" title="Select every key of the clip — Ctrl+A (Shift+Ctrl+A: only the active track). Or drag a box across the lanes">⬚ All</button>
        <span class="lab-editor-grow"></span>
        <span class="lab-sheet-clipname">🎬 ${escapeHtml(clip.name ? `${clip.name} · ${clip.id}` : clip.id)} · ${clip.tracks.length} track${clip.tracks.length === 1 ? "" : "s"} · ${(clip.events ?? []).length} event${(clip.events ?? []).length === 1 ? "" : "s"}</span>
        <button data-action="key-set" class="primary" title="Insert / update a key for ${escapeHtml(activeTrackPart())} at t (I)">🔑 Key</button>
      </div>
      <div class="lab-sheet-body">
        <div class="lab-sheet-names"><div class="lab-sheet-ruler-spacer">hierarchy</div>${nameCells}<div class="lab-sheet-name-cell events">🚩 events</div></div>
        <div class="lab-sheet-lanes" id="lab-sheet-lanes">
          <div class="lab-sheet-ruler">${ticks.join("")}</div>
          ${lanes}
          <div class="lab-sheet-row events"><div class="lab-sheet-lane" data-lane="events">${events}</div></div>
          <div class="lab-sheet-playhead" style="left:${pct(scrubTime)}"></div>
        </div>
      </div>`;
  }
  function renderStatus(): void {
    const status = panels.right.querySelector<HTMLElement>(".lab-editor-status");
    if (status) status.textContent = statusText;
  }
  function refreshPlayhead(): void {
    const clip = activeClip();
    if (!clip) return;
    const head = panels.bottom.querySelector<HTMLElement>(".lab-sheet-playhead");
    if (head) head.style.left = `${(scrubTime / clip.duration) * 100}%`;
    const time = panels.bottom.querySelector<HTMLElement>(".lab-sheet-time b");
    if (time) time.textContent = round(scrubTime, 2).toFixed(2);
    const play = panels.bottom.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (play) { play.textContent = player?.playing ? "⏸" : "▶️"; play.classList.toggle("active", !!player?.playing); }
    for (const key of panels.bottom.querySelectorAll<HTMLElement>(".lab-sheet-key")) key.classList.toggle("at", Math.abs(Number(key.dataset.keyT) - scrubTime) < 1e-6);
    const small = panels.right.querySelector<HTMLElement>(".lab-panel-section:nth-of-type(2) .lab-panel-head small");
    if (small) small.textContent = `${activeTrackPart()} @ ${round(scrubTime, 2)} s${keyAtScrub() ? " · on a key" : ""}`;
    if (!draftPose) {
      const pose = poseAtScrub();
      for (const input of panels.right.querySelectorAll<HTMLInputElement>("[data-pose]:not([data-multi])")) input.value = String(round(pose[input.dataset.pose as "rotation" | "position" | "scale"][Number(input.dataset.index)]!, 3));
      for (const input of panels.right.querySelectorAll<HTMLInputElement>("[data-opacity]:not([data-multi])")) input.value = String(round(pose.opacity ?? 1, 3));
    }
  }

  // ------------------------------------------------------------- handlers --
  function onPanelClick(event: MouseEvent): void {
    const element = event.target as HTMLElement;
    if (!session) return;
    const layerName = element.closest<HTMLElement>("[data-part-select]");
    if (layerName && !renaming) {
      const part = layerName.dataset.partSelect!;
      if (event.shiftKey) {
        // Shift: every visible row between the anchor and this one.
        const order = visibleLayerOrder();
        const anchor = layerAnchor && order.includes(layerAnchor) ? layerAnchor : (activePart ?? part);
        const [a, b] = [order.indexOf(anchor), order.indexOf(part)].sort((x, y) => x - y);
        for (const id of order.slice(a, b + 1)) selectedParts.add(id);
        if (!activePart) activePart = part;
        renderLeft(); renderRight();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd: toggle this one; the active part stays selected.
        if (selectedParts.has(part) && part !== activePart) selectedParts.delete(part);
        else { selectedParts.add(part); if (activePart) selectedParts.add(activePart); }
        if (!activePart) activePart = part;
        renderLeft(); renderRight();
        return;
      }
      selectedParts.clear();
      selectedParts.add(part);
      layerAnchor = part;
      setActivePart(part);
      return;
    }
    const button = element.closest<HTMLElement>("button");
    const trackName = element.closest<HTMLElement>("[data-track]");
    if (trackName && !(button && button.dataset.sheetCollapse)) { setActivePart(trackName.dataset.track === "*" ? null : trackName.dataset.track!); return; }
    if (!button) return;
    if (button.dataset.mode) { setMode(button.dataset.mode as EditorMode); return; }
    if (button.dataset.tool) { setTool(button.dataset.tool as EditorTool); return; }
    if (button.dataset.gizmo) { setGizmoMode(button.dataset.gizmo as GizmoMode); return; }
    if (button.dataset.action === "autokey") { autoKey = !autoKey; storeFlag("farm-lab-autokey", autoKey); renderRight(); return; }
    if (button.dataset.brush) { brush = Number(button.dataset.brush); renderRight(); updatePreview(lastHit); return; }
    if (button.dataset.state !== undefined && activePart) {
      session.setDisplayedState(activePart, button.dataset.state);
      applyStates();
      previewSignature = ""; partHighlightSignature = "";
      renderAll();
      updatePreview(lastHit);
      return;
    }
    if (button.dataset.lightRemove !== undefined) { session.beginStroke(); session.removeLight(Number(button.dataset.lightRemove)); session.endStroke(); statusText = "Light removed"; markChanged(); return; }
    if (button.dataset.lightHere !== undefined) { session.beginStroke(); session.updateLight(Number(button.dataset.lightHere), { position: lightAnchorCell() }); session.endStroke(); statusText = "Light moved"; markChanged(); return; }
    if (button.dataset.palette) {
      if (button.dataset.swatch && event.shiftKey) { extraSwatches = extraSwatches.filter((hex) => hex !== button.dataset.palette); storeSwatches(); renderRight(); return; }
      if (event.altKey) { session.beginStroke(); const changed = session.replaceColor(button.dataset.palette, color); session.endStroke(); statusText = `${changed} voxels ${button.dataset.palette} → ${color}`; markChanged(); }
      else { selectedPaletteColor = button.dataset.palette; setColor(button.dataset.palette); }
      return;
    }
    if (button.dataset.partToggle) { session.setPartHidden(button.dataset.partToggle, !session.isPartHidden(button.dataset.partToggle)); markChanged(); return; }
    if (button.dataset.partCollapse) { if (collapsed.has(button.dataset.partCollapse)) collapsed.delete(button.dataset.partCollapse); else collapsed.add(button.dataset.partCollapse); renderLeft(); return; }
    if (button.dataset.sheetCollapse) { if (sheetCollapsed.has(button.dataset.sheetCollapse)) sheetCollapsed.delete(button.dataset.sheetCollapse); else sheetCollapsed.add(button.dataset.sheetCollapse); renderBottom(); return; }
    if (button.dataset.jumpT !== undefined) { player?.pause(); setScrub(Number(button.dataset.jumpT)); return; }
    if (button.dataset.socketRemove !== undefined && activePart) { session.setSocket(activePart, button.dataset.socketRemove, null); markChanged(); return; }
    if (button.dataset.tfRot) { const [axis, deg] = button.dataset.tfRot.split(","); adjustTransforms("rotation", [axis === "x" ? Number(deg) : 0, axis === "y" ? Number(deg) : 0, axis === "z" ? Number(deg) : 0]); return; }
    if (button.dataset.tfMirror) { const i = Number(button.dataset.tfMirror); bake({ mirror: [i === 0, i === 1, i === 2] }); return; }
    if (button.dataset.tfScale) { const f = Number(button.dataset.tfScale); adjustTransforms("scale", [f, f, f]); return; }
    if (button.dataset.keyPart !== undefined) {
      if (keyDrag) return; // a drag just ended
      const part = button.dataset.keyPart;
      setActivePart(part === "*" ? null : part, false);
      setScrub(Number(button.dataset.keyT));
      return;
    }
    if (button.dataset.eventT !== undefined && activeClipId) {
      if (event.altKey) { session.removeEvent(activeClipId, Number(button.dataset.eventT)); markChanged(); }
      else setScrub(Number(button.dataset.eventT));
      return;
    }
    switch (button.dataset.action) {
      case "close": editor.close(); break;
      case "undo": if (session.undo()) { statusText = "Undo"; markChanged(); } break;
      case "redo": if (session.redo()) { statusText = "Redo"; markChanged(); } break;
      case "revert": if (window.confirm("Reset: discard every unsaved edit and reload this model from the catalog?")) { forgetHistory(); host.reload(); } break;
      case "save": void save(session.modelId); break;
      case "saveas": { const id = window.prompt("New model id (lower-case letters, digits, underscores):", `${session.modelId.replace(/_edit\d*$/, "")}_edit`); if (id) void save(id.trim()); break; }
      case "delete-color": if (selectedPaletteColor) {
        const target = selectedPaletteColor;
        if (extraSwatches.includes(target)) { extraSwatches = extraSwatches.filter((hex) => hex !== target); storeSwatches(); }
        session.beginStroke();
        const removed = session.eraseColor(target);
        session.endStroke();
        selectedPaletteColor = null;
        statusText = removed ? `Deleted color ${target}: erased ${removed} voxels (undo restores them)` : `Removed swatch ${target}`;
        markChanged();
      } break;
      case "replace": if (selectedPaletteColor) { session.beginStroke(); const changed = session.replaceColor(selectedPaletteColor, color); session.endStroke(); statusText = `${changed} voxels ${selectedPaletteColor} → ${color}`; selectedPaletteColor = color; markChanged(); } break;
      case "glow-toggle": if (selectedPaletteColor) { session.beginStroke(); session.setGlow(selectedPaletteColor, session.glowOf(selectedPaletteColor) ? 0 : 1); session.endStroke(); statusText = session.glowOf(selectedPaletteColor) ? `${selectedPaletteColor} glows` : `${selectedPaletteColor} no longer glows`; markChanged(); } break;
      case "light-add": { session.beginStroke(); const index = session.addLight({ position: lightAnchorCell(), color: "#ffd9a0", intensity: 1, range: 7 }); session.endStroke(); statusText = `Light ${index + 1} added at the ${activePart ? `centre of ${activePart}` : "model's centre"}`; markChanged(); break; }
      case "part-add": addPart(); break;
      case "layer-sort": layerSort = layerSort === "size" ? "tree" : "size"; renderLeft(); break;
      case "state-add": {
        const part = mode === "animate" ? activeTrackPart() : activePart;
        if (!part || part === "*") break;
        const name = window.prompt(`New voxel state of ${part} (copy of “${session.displayedStateOf(part)}”) — name (letters, digits, underscores):`, `state_${(session.partMeta(part)?.states.length ?? 0) + 1}`);
        if (!name) break;
        if (!session.addState(part, name.trim())) { statusText = `Could not add state “${name}” (taken or invalid)`; renderRight(); break; }
        statusText = `State “${name.trim()}” of ${part}: edit its voxels now (only this snapshot changes)`;
        if (mode === "animate") { pendingKeyState = name.trim(); setMode("model"); } else { applyStates(); markChanged(); }
        break;
      }
      case "state-rename": {
        if (!activePart) break;
        const from = session.displayedStateOf(activePart);
        const to = window.prompt(`Rename state “${from}” of ${activePart}:`, from);
        if (!to || to.trim() === from) break;
        if (!session.renameState(activePart, from, to.trim())) { statusText = `Could not rename to “${to}” (taken or invalid)`; renderRight(); break; }
        markChanged();
        break;
      }
      case "state-delete": {
        if (!activePart) break;
        const state = session.displayedStateOf(activePart);
        if (state === "base" || !window.confirm(`Delete state “${state}” of ${activePart}? Keys that switch to it will stop switching.`)) break;
        session.removeState(activePart, state);
        applyStates();
        markChanged();
        break;
      }
      case "state-edit": {
        const part = activeTrackPart();
        if (part === "*") { statusText = "Select a layer first"; renderRight(); break; }
        const chosen = panels.right.querySelector<HTMLSelectElement>('[data-action="key-state"]')?.value ?? "";
        if (chosen && chosen !== "__new") session.setDisplayedState(part, chosen);
        setActivePart(part, false);
        setMode("model");
        statusText = `Editing state “${session.displayedStateOf(part)}” of ${part} — Tab returns to Animate`;
        renderRight();
        break;
      }
      case "tidy-open": openTidy(); break;
      case "part-duplicate": duplicateActive(); break;
      case "part-copy": copyActive(); break;
      case "part-paste": pasteClipboard(); break;
      case "part-delete": deleteActive(); break;
      case "part-extract": void extractActive(); break;
      case "group": groupSelection(); break;
      case "ungroup": ungroupActive(); break;
      case "part-hide": if (activePart) { session.setPartHidden(activePart, !session.isPartHidden(activePart)); markChanged(); } break;
      case "autorig": {
        const model = session.toAuthoredModel();
        const suggestion = inferRig(model, { keepExisting: true });
        for (const part of applyRig(model, suggestion).parts) { session.setParent(part.id, part.parent); session.setPivot(part.id, { x: part.pivot[0], y: part.pivot[1], z: part.pivot[2] }); }
        statusText = `Auto-rig: root ${suggestion.root}, ${suggestion.parents.size} part(s) attached by contact`;
        markChanged();
        break;
      }
      case "joint-center": case "joint-base": {
        if (!activePart) break;
        const cells = [...session.visibleCells()].filter((c) => session!.get(c.x, c.y, c.z, activePart!) !== undefined);
        if (!cells.length) break;
        const minY = Math.min(...cells.map((c) => c.y));
        const pick = button.dataset.action === "joint-base" ? cells.filter((c) => c.y === minY) : cells;
        const n = pick.length;
        session.setPivot(activePart, { x: Math.round(pick.reduce((s, c) => s + c.x, 0) / n), y: button.dataset.action === "joint-base" ? minY : Math.round(pick.reduce((s, c) => s + c.y, 0) / n), z: Math.round(pick.reduce((s, c) => s + c.z, 0) / n) });
        markChanged();
        break;
      }
      case "tf-reset": for (const part of selectionTops()) session.setPartTransform(part, { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] }); statusText = "Transform reset"; markChanged(); break;
      case "tf-bake": {
        const tops = selectionTops();
        const cells = tops.reduce((sum, part) => sum + session!.partCellCount(part), 0);
        statusText = `Baking the stored transform of ${tops.length} part(s) into ${cells.toLocaleString()} voxels (re-gridding)…`;
        renderStatus();
        setTimeout(() => { if (!session) return; session.beginStroke(); let placed = 0; for (const part of tops) placed += session.bakePartTransform(part); session.endStroke(); statusText = `Baked into the voxels (${placed} cells); transform is back to identity`; markChanged(); }, 0);
        break;
      }
      case "clip-add": {
        const id = window.prompt("Clip id (letters, digits, underscores):", session.clips.length ? `clip${session.clips.length}` : "idle");
        if (!id || !/^[a-z0-9_]{1,40}$/i.test(id.trim())) break;
        const duration = Number(window.prompt("Duration in seconds:", "1") ?? "1");
        session.upsertClip({ id: id.trim(), duration: duration > 0 ? duration : 1, loop: true, tracks: [] });
        setClip(id.trim());
        markChanged();
        break;
      }
      case "clip-rename": {
        const clip = activeClip(); if (!clip) break;
        const id = window.prompt("Clip id:", clip.id);
        if (!id || id.trim() === clip.id || !/^[a-z0-9_]{1,40}$/i.test(id.trim()) || session.clips.some((c) => c.id === id.trim())) break;
        session.removeClip(clip.id); session.upsertClip({ ...clip, id: id.trim() }); setClip(id.trim()); markChanged();
        break;
      }
      case "clip-delete": if (activeClipId && window.confirm(`Delete clip "${activeClipId}"?`)) { session.removeClip(activeClipId); setClip(session.clips[0]?.id ?? null); markChanged(); } break;
      case "clip-loop-toggle": { const clip = activeClip(); if (clip) { session.upsertClip({ ...clip, loop: !clip.loop }); markChanged(); } break; }
      case "play": togglePlay(); break;
      case "sheet-compact": for (const part of session.parts) if (session.childrenOf(part).length) sheetCollapsed.add(part); renderBottom(); break;
      case "sheet-expand": sheetCollapsed.clear(); renderBottom(); break;
      case "go-start": player?.pause(); setScrub(0); break;
      case "go-end": player?.pause(); setScrub(activeClip()?.duration ?? 0); break;
      case "key-set": insertKey(); break;
      case "key-delete": if (activeClipId) { session.removeKey(activeClipId, activeTrackPart(), scrubTime); draftPose = null; markChanged(); } break;
      case "key-toggle": if (activeClipId) { session.toggleKey(activeClipId, activeTrackPart(), scrubTime); draftPose = null; markChanged(); } break;
      case "keys-copy": copyKeys(); break;
      case "keys-paste": pasteKeys(); break;
      case "keys-delete": deleteSelectedKeys(); break;
      case "keys-select-all": selectAllKeys(false); break;
      case "keys-enable": updateSelectedKeys({ disabled: undefined }, "enabled"); break;
      case "keys-mute": updateSelectedKeys({ disabled: true }, "muted"); break;
      case "key-rest": draftPose = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] }; applyScrubPose(); renderRight(); break;
      case "event-add": {
        if (!activeClipId) break;
        const name = window.prompt("Event name (e.g. harvest, chop, serve):", "action");
        if (!name) break;
        const swap = window.prompt("Optional: catalog model id to swap to at this event (leave empty for none):", "") ?? "";
        session.setEvent(activeClipId, { t: round(scrubTime, 4), name: name.trim(), ...(swap.trim() ? { swapModel: swap.trim() } : {}) });
        markChanged();
        break;
      }
    }
  }
  function onPanelDblClick(event: MouseEvent): void {
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-palette]");
    if (chip && session) {
      // Edit this palette color: the picker opens on the chip's color; the
      // change recolors every voxel using it (or updates an unused swatch).
      editingPaletteColor = chip.dataset.palette!;
      const picker = panels.right.querySelector<HTMLInputElement>('[data-action="palette-edit"]');
      if (picker) { picker.value = editingPaletteColor; picker.click(); }
      return;
    }
    const layerName = (event.target as HTMLElement).closest<HTMLElement>("[data-part-select]");
    if (!layerName || !session) return;
    renaming = layerName.dataset.partSelect!;
    renderLeft();
  }
  function commitRename(input: HTMLInputElement): void {
    if (!session || !renaming) return;
    const from = renaming;
    const to = input.value.trim();
    renaming = null;
    if (to && to !== from) {
      if (session.renamePart(from, to)) { if (activePart === from) activePart = to; markChanged(); return; }
      statusText = `Could not rename to "${to}" (taken or invalid: letters, digits, underscores)`;
    }
    renderAll();
  }
  /** Cell at the centre of the active part (or of the whole model): where a new light goes. */
  function lightAnchorCell(): [number, number, number] {
    if (!session) return [0, 0, 0];
    const cells = activePart ? session.cellsOfLayer(activePart) : session.parts.flatMap((part) => session!.cellsOfLayer(part));
    if (!cells.length) return [0, 0, 0];
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const cell of cells) { lo[0] = Math.min(lo[0], cell.x); lo[1] = Math.min(lo[1], cell.y); lo[2] = Math.min(lo[2], cell.z); hi[0] = Math.max(hi[0], cell.x); hi[1] = Math.max(hi[1], cell.y); hi[2] = Math.max(hi[2], cell.z); }
    return [Math.round((lo[0]! + hi[0]!) / 2), Math.round((lo[1]! + hi[1]!) / 2), Math.round((lo[2]! + hi[2]!) / 2)];
  }
  function onPanelInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!session) return;
    if (input.dataset.action === "color") { color = input.value; (input.parentElement as HTMLElement).style.background = color; return; }
    if (input.dataset.action === "glow-intensity" && selectedPaletteColor) { session.beginStroke(); session.setGlow(selectedPaletteColor, Number(input.value) || 1); session.endStroke(); input.title = `Glow strength ×${session.glowOf(selectedPaletteColor)}`; needsRebuild = true; scheduleHistoryPersist(); return; }
    if ((input.dataset.pose || input.dataset.opacity) && input.dataset.multi) return; // committed on change, see onPanelChange
    if (input.dataset.opacity) {
      const base = draftPose ?? poseAtScrub();
      draftPose = { rotation: [...base.rotation] as [number, number, number], position: [...base.position] as [number, number, number], scale: [...base.scale] as [number, number, number], opacity: Math.min(1, Math.max(0, Number(input.value))) , fade: base.fade };
      applyScrubPose();
      return;
    }
    if (input.dataset.pose) {
      const base = draftPose ?? poseAtScrub();
      const pose = { rotation: [...base.rotation] as [number, number, number], position: [...base.position] as [number, number, number], scale: [...base.scale] as [number, number, number] };
      pose[input.dataset.pose as "rotation" | "position" | "scale"][Number(input.dataset.index)] = Number(input.value) || 0;
      draftPose = pose;
      applyScrubPose();
    }
  }
  function onPanelChange(event: Event): void {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (!session) return;
    if (input.dataset.action === "color") { setColor(input.value); return; }
    if (input.dataset.action === "glow-intensity") { renderRight(); return; }
    const lightIndex = input.dataset.lightColor ?? input.dataset.lightIntensity ?? input.dataset.lightRange;
    if (lightIndex !== undefined) {
      const index = Number(lightIndex);
      const patch = input.dataset.lightColor !== undefined ? { color: input.value.toLowerCase() } : input.dataset.lightIntensity !== undefined ? { intensity: Math.max(0, Number(input.value) || 0) } : { range: Math.max(0.5, Number(input.value) || 7) };
      session.beginStroke(); session.updateLight(index, patch); session.endStroke();
      statusText = `Light ${index + 1} updated`;
      markChanged();
      return;
    }
    if (input.dataset.action === "track-fade") {
      const part = activeTrackPart();
      if (activeClipId && part !== "*") { session.setTrackFade(activeClipId, part, (input.value as FadeMode) === "fade" ? undefined : (input.value as FadeMode)); applyScrubPose(); markChanged(); }
      return;
    }
    if (input.dataset.opacity && input.dataset.multi) {
      if (input.value.trim() === "") return;
      const value = Math.min(1, Math.max(0, Number(input.value) || 0));
      updateSelectedKeys({ opacity: value }, `opacity = ${value}`);
      return;
    }
    if (input.dataset.pose && input.dataset.multi) {
      if (input.value.trim() === "") return; // left as XXX: untouched
      const channel = input.dataset.pose as "rotation" | "position" | "scale";
      const index = Number(input.dataset.index);
      const value = Number(input.value) || 0;
      const refs = selectedKeyRefs();
      if (!activeClipId || !refs.length) return;
      session.beginStroke();
      for (const { part, key } of refs) {
        const values = [...(key[channel] ?? REST_POSE[channel])] as [number, number, number];
        values[index] = value;
        session.setKey(activeClipId, part, { ...key, [channel]: values });
      }
      session.endStroke();
      statusText = `${refs.length} keys: ${channel} ${"XYZ"[index]} = ${value}`;
      markChanged();
      return;
    }
    if (input.dataset.action === "key-transition" || input.dataset.action === "key-direction") {
      const part = activeTrackPart();
      if (input.dataset.action === "key-transition") pendingTransition = input.value as StateTransition; else pendingDirection = input.value as TransitionDirection;
      const existing = keyAtScrub();
      if (existing?.state && activeClipId && part !== "*") {
        const patched: ClipKey = { ...existing, transition: input.dataset.action === "key-transition" ? (input.value as StateTransition) : (existing.transition ?? pendingTransition), transitionDirection: input.dataset.action === "key-direction" ? (input.value as TransitionDirection) : (existing.transitionDirection ?? pendingDirection) };
        if (patched.transition !== "blend") delete patched.transitionDirection;
        session.beginStroke();
        session.removeKey(activeClipId, part, existing.t);
        session.setKey(activeClipId, part, patched);
        session.endStroke();
        applyScrubPose();
        markChanged();
      } else renderRight();
      return;
    }
    if (input.dataset.action === "key-state") {
      const select = input as unknown as HTMLSelectElement;
      const part = activeTrackPart();
      if (select.value === "__new") {
        const name = part !== "*" ? window.prompt(`New voxel state of ${part} (copy of “${session.displayedStateOf(part)}”) — name:`, `state_${(session.partMeta(part)?.states.length ?? 0) + 1}`) : null;
        if (!name || !session.addState(part, name.trim())) { renderRight(); return; }
        pendingKeyState = name.trim();
        const existingNew = keyAtScrub();
        if (existingNew && activeClipId) session.setKey(activeClipId, part, { ...existingNew, state: pendingKeyState });
        statusText = `State “${pendingKeyState}” created from the shown voxels — ✏️ Edit to change it; ${existingNew ? "this key now switches to it" : "Insert a key to switch to it"}`;
        markChanged();
        return;
      }
      pendingKeyState = select.value;
      const existing = keyAtScrub();
      if (!existing) { renderRight(); return; }
      if (existing && activeClipId && part !== "*") {
        session.beginStroke();
        session.removeKey(activeClipId, part, existing.t);
        const { state: _old, ...rest } = existing;
        session.setKey(activeClipId, part, pendingKeyState ? { ...rest, state: pendingKeyState } : rest);
        session.endStroke();
        statusText = pendingKeyState ? `Key at ${round(scrubTime, 2)}s now switches ${part} to “${pendingKeyState}”` : `Key at ${round(scrubTime, 2)}s no longer changes the voxel state`;
        applyScrubPose();
        markChanged();
      }
      return;
    }
    if (input.dataset.action === "keys-ease") {
      const ease = input.value as ClipEase | "";
      if (ease) { lastEase = ease; updateSelectedKeys({ ease }, `eased "${ease}"`); }
      return;
    }
    if (input.dataset.action === "key-ease") { lastEase = input.value as ClipEase; return; }
    if (input.dataset.action === "palette-edit") {
      const from = editingPaletteColor;
      const to = input.value.toLowerCase();
      editingPaletteColor = null;
      if (!from || from === to) return;
      if (extraSwatches.includes(from)) { extraSwatches = extraSwatches.map((hex) => (hex === from ? to : hex)); storeSwatches(); }
      session.beginStroke();
      const changed = session.replaceColor(from, to);
      session.endStroke();
      if (selectedPaletteColor === from) selectedPaletteColor = to;
      if (color === from) color = to;
      statusText = changed ? `Edited color ${from} → ${to} on ${changed} voxels` : `Swatch ${from} → ${to}`;
      markChanged();
      return;
    }
    if (input.dataset.action === "swatch-add") {
      const hex = input.value.toLowerCase();
      if (!extraSwatches.includes(hex)) extraSwatches.push(hex);
      storeSwatches();
      selectedPaletteColor = hex;
      statusText = `Added ${hex} to the palette — paint with it and it becomes a used color`;
      setColor(hex);
      return;
    }
    if (input.dataset.transform && activePart) {
      const channel = input.dataset.transform as "rotation" | "position" | "scale";
      const meta = session.partMeta(activePart)!;
      const values = [...meta.transform[channel]] as [number, number, number];
      values[Number(input.dataset.index)] = Number(input.value) || (channel === "scale" ? 1 : 0);
      session.setPartTransform(activePart, { [channel]: values });
      markChanged();
      return;
    }
    if (input.dataset.joint !== undefined && activePart) {
      const meta = session.partMeta(activePart)!;
      const pivot = [...meta.pivot] as [number, number, number];
      pivot[Number(input.dataset.joint)] = Math.round(Number(input.value) || 0);
      session.setPivot(activePart, { x: pivot[0], y: pivot[1], z: pivot[2] });
      markChanged();
      return;
    }
    if (input.dataset.action === "clip-select") { setClip((input as HTMLSelectElement).value || null); return; }
    if (input.dataset.action === "clip-duration" && activeClip()) {
      const duration = Math.max(0.05, Number(input.value) || 1);
      const clip = activeClip()!;
      session.upsertClip({ ...clip, duration, tracks: clip.tracks.map((track) => ({ ...track, keys: track.keys.filter((key) => key.t <= duration) })), events: (clip.events ?? []).filter((e) => e.t <= duration) });
      // The playhead must not stay past the new end, or the next Insert would put a key outside the clip.
      if (scrubTime > duration) scrubTime = duration;
      scrubTime = Math.min(scrubTime, duration);
      markChanged();
      return;
    }
    if (input.dataset.action === "clip-loop" && activeClip()) { session.upsertClip({ ...activeClip()!, loop: (input as HTMLInputElement).checked }); markChanged(); return; }
    if (input.dataset.action === "clip-name" && activeClip()) { const name = input.value.trim(); const clip = { ...activeClip()! }; if (name) clip.name = name; else delete clip.name; session.upsertClip(clip); markChanged(); return; }
  }
  function onPanelKeyDown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (input.dataset?.rename !== undefined) {
      if (event.key === "Enter") commitRename(input);
      if (event.key === "Escape") { renaming = null; renderLeft(); }
      event.stopPropagation();
    }
  }
  function onPanelFocusOut(event: FocusEvent): void {
    const input = event.target as HTMLInputElement;
    if (input.dataset?.rename !== undefined && renaming) commitRename(input);
  }
  function onPanelToggle(event: Event): void {
    const details = event.target as HTMLDetailsElement;
    if (details.classList.contains("lab-editor-controls")) { controlsOpen = details.open; storeFlag("farm-lab-controls-open", controlsOpen); }
  }

  // Layers drag & drop: drop on a layer = become its child; drop on Root = detach.
  // Dragging a selected row carries the whole selection (its top-level parts:
  // a selected child of a selected parent already moves with it).
  let draggedPart: string | null = null;
  let draggedParts: string[] = [];
  function onDragStart(event: DragEvent): void {
    const layer = (event.target as HTMLElement).closest<HTMLElement>(".lab-layer[data-part]");
    if (!layer || !session) return;
    draggedPart = layer.dataset.part!;
    const group = selectedParts.has(draggedPart) ? selectionList() : [draggedPart];
    const chosen = new Set(group);
    draggedParts = group.filter((id) => { let cursor = session!.partMeta(id)?.parent; while (cursor) { if (chosen.has(cursor)) return false; cursor = session!.partMeta(cursor)?.parent; } return true; });
    event.dataTransfer?.setData("text/plain", draggedParts.join(","));
    for (const id of draggedParts) panels.left.querySelector(`.lab-layer[data-part="${cssEscape(id)}"]`)?.classList.add("dragging");
  }
  function onDragOver(event: DragEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>(".lab-layer");
    if (!target || !draggedPart) return;
    const targetPart = target.dataset.part;
    if (targetPart && draggedParts.includes(targetPart)) return;
    event.preventDefault();
    for (const el of panels.left.querySelectorAll(".lab-layer.drop")) el.classList.remove("drop");
    target.classList.add("drop");
  }
  function onDrop(event: DragEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>(".lab-layer");
    if (!target || !draggedPart || !session) return;
    event.preventDefault();
    const moving = draggedParts.length ? draggedParts : [draggedPart];
    draggedPart = null;
    draggedParts = [];
    const label = moving.length === 1 ? moving[0]! : `${moving.length} layers`;
    if (target.dataset.dropRoot) {
      session.beginStroke();
      for (const id of moving) session.setParent(id, undefined);
      session.endStroke();
      statusText = moving.length === 1 ? `${label} is now a root part` : `${label} are now root parts`;
      markChanged();
      return;
    }
    const parent = target.dataset.part;
    if (!parent || moving.includes(parent)) return;
    session.beginStroke();
    const moved = moving.filter((id) => session!.setParent(id, parent));
    session.endStroke();
    if (moved.length) collapsed.delete(parent);
    const refused = moving.filter((id) => !moved.includes(id));
    statusText = `${moved.length === 1 ? moved[0] : `${moved.length} layers`} now move${moved.length === 1 ? "s" : ""} with ${parent}${refused.length ? ` · ${refused.join(", ")} refused (that would make a loop)` : ""}`;
    markChanged();
  }
  function onDragEnd(): void {
    draggedPart = null;
    draggedParts = [];
    for (const el of panels.left.querySelectorAll(".lab-layer.drop, .lab-layer.dragging")) el.classList.remove("drop", "dragging");
  }

  // Dope sheet pointer work: scrub on empty lane/ruler, drag keys to retime.
  function laneTimeFromEvent(event: PointerEvent): number | null {
    const lanes = panels.bottom.querySelector<HTMLElement>("#lab-sheet-lanes");
    const clip = activeClip();
    if (!lanes || !clip) return null;
    const rect = lanes.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return round(Math.round((ratio * clip.duration) / 0.05) * 0.05, 4);
  }
  function onSheetPointerDown(event: PointerEvent): void {
    if (!session || event.button !== 0) return;
    const keyButton = (event.target as HTMLElement).closest<HTMLElement>(".lab-sheet-key");
    if (keyButton) {
      const clip = activeClip();
      const part = keyButton.dataset.keyPart!;
      const t = Number(keyButton.dataset.keyT);
      const key = clip?.tracks.find((track) => track.part === part)?.keys.find((candidate) => Math.abs(candidate.t - t) < 1e-6);
      if (!key || !clip) return;
      if (event.shiftKey) {
        // Shift+click: the block between the anchor key and this one — rows
        // between them in the sheet, times between them — no jump, no drag.
        const anchor = keyAnchor ?? { part, t };
        const rows = sheetRowOrder();
        const [r0, r1] = [rows.indexOf(anchor.part), rows.indexOf(part)].sort((x, y) => x - y);
        const [t0, t1] = [anchor.t, t].sort((x, y) => x - y);
        for (const track of clip.tracks) {
          const rowIndex = rows.indexOf(track.part);
          if (rowIndex < r0 || rowIndex > r1) continue;
          for (const candidate of track.keys) if (candidate.t >= t0 - 1e-6 && candidate.t <= t1 + 1e-6) selectedKeys.add(keyId(track.part, candidate.t));
        }
        renderBottom(); renderRight();
        event.preventDefault();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        // Ctrl/Cmd+click toggles one key.
        const id = keyId(part, t);
        if (selectedKeys.has(id)) selectedKeys.delete(id); else selectedKeys.add(id);
        renderBottom(); renderRight();
        event.preventDefault();
        return;
      }
      keyAnchor = { part, t };
      if (!selectedKeys.has(keyId(part, t))) { selectedKeys.clear(); selectedKeys.add(keyId(part, t)); }
      const group: { part: string; t: number; key: ClipKey }[] = [];
      for (const track of clip.tracks) for (const candidate of track.keys) if (selectedKeys.has(keyId(track.part, candidate.t))) group.push({ part: track.part, t: candidate.t, key: candidate });
      keyDrag = { part, from: t, to: t, key, group };
      renderBottom(); renderRight();
      event.preventDefault();
      return;
    }
    if ((event.target as HTMLElement).closest("#lab-sheet-lanes")) {
      if ((event.target as HTMLElement).closest(".lab-sheet-ruler")) {
        scrubbing = true;
        player?.pause();
        const t = laneTimeFromEvent(event);
        if (t !== null) setScrub(t, false);
      } else {
        // Empty lane space: a click jumps the playhead, a drag draws a selection box.
        marquee = { x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY, active: false, additive: event.shiftKey || event.ctrlKey || event.metaKey, element: null };
      }
      event.preventDefault();
    }
  }
  function marqueeRect(): { left: number; top: number; right: number; bottom: number } | null {
    if (!marquee) return null;
    return { left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), right: Math.max(marquee.x0, marquee.x1), bottom: Math.max(marquee.y0, marquee.y1) };
  }
  function drawMarquee(): void {
    const lanes = panels.bottom.querySelector<HTMLElement>("#lab-sheet-lanes");
    const rect = marqueeRect();
    if (!marquee || !lanes || !rect) return;
    if (!marquee.element) { marquee.element = document.createElement("div"); marquee.element.className = "lab-sheet-marquee"; lanes.append(marquee.element); }
    const host = lanes.getBoundingClientRect();
    Object.assign(marquee.element.style, { left: `${rect.left - host.left}px`, top: `${rect.top - host.top + lanes.scrollTop}px`, width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px` });
  }
  function finishMarquee(event: PointerEvent): void {
    if (!marquee) return;
    const box = marqueeRect()!;
    const { active, additive } = marquee;
    marquee.element?.remove();
    marquee = null;
    if (!active) {
      // Plain click on a lane: jump the playhead there.
      player?.pause();
      const t = laneTimeFromEvent(event);
      if (t !== null) setScrub(t);
      return;
    }
    if (!additive) selectedKeys.clear();
    let hits = 0;
    for (const button of panels.bottom.querySelectorAll<HTMLElement>(".lab-sheet-key[data-key-part]")) {
      const r = button.getBoundingClientRect();
      if (r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) continue;
      selectedKeys.add(keyId(button.dataset.keyPart!, Number(button.dataset.keyT)));
      hits++;
    }
    statusText = `${selectedKeys.size} key${selectedKeys.size === 1 ? "" : "s"} selected${hits ? "" : " (box caught none)"}`;
    renderBottom();
    renderRight();
  }
  function onSheetPointerMove(event: PointerEvent): void {
    if (marquee) {
      marquee.x1 = event.clientX; marquee.y1 = event.clientY;
      if (!marquee.active && Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) > 4) marquee.active = true;
      if (marquee.active) drawMarquee();
      return;
    }
    if (keyDrag) {
      const t = laneTimeFromEvent(event);
      if (t !== null && t !== keyDrag.to) { keyDrag.to = t; renderBottom(); }
      return;
    }
    if (scrubbing) { const t = laneTimeFromEvent(event); if (t !== null) setScrub(t, false); }
  }
  function onSheetPointerUp(event: PointerEvent): void {
    if (marquee) { finishMarquee(event); return; }
    if (keyDrag && session && activeClipId) {
      const { part, from, to, group } = keyDrag;
      const moved = Math.abs(from - to) > 1e-6;
      const clip = activeClip();
      keyDrag = null;
      if (moved && clip) {
        const delta = to - from;
        session.beginStroke();
        for (const member of group) session.removeKey(activeClipId, member.part, member.t);
        selectedKeys.clear();
        for (const member of group) {
          const target = round(Math.min(clip.duration, Math.max(0, member.t + delta)), 4);
          session.setKey(activeClipId, member.part, { ...member.key, t: target });
          selectedKeys.add(keyId(member.part, target));
        }
        session.endStroke();
        statusText = group.length > 1 ? `${group.length} keys moved by ${delta > 0 ? "+" : ""}${round(delta, 2)}s` : `Key of ${part} moved ${from}s → ${to}s`;
        setActivePart(part === "*" ? null : part, false);
        scrubTime = to;
        markChanged();
      } else if (Math.abs(from - scrubTime) < 1e-6 && (part === "*" ? activePart === null : activePart === part)) {
        // Second click on the key under the playhead: mute / unmute it.
        session.toggleKey(activeClipId, part, from);
        const nowMuted = !!activeClip()?.tracks.find((track) => track.part === part)?.keys.find((candidate) => Math.abs(candidate.t - from) < 1e-6)?.disabled;
        statusText = `${part} key at ${from}s ${nowMuted ? "muted — ignored when playing" : "enabled"}`;
        draftPose = null;
        markChanged();
      } else {
        setActivePart(part === "*" ? null : part, false);
        setScrub(from);
      }
      setTimeout(() => { keyDrag = null; }, 0);
    }
    scrubbing = false;
  }

  // ------------------------------------------------------------- actions --
  function setMode(next: EditorMode): void {
    if (mode === next) return;
    mode = next;
    draftPose = null;
    extraDrafts.clear();
    player?.pause();
    if (mode === "animate") { if (!activeClipId) activeClipId = session?.clips[0]?.id ?? null; scrubTime = 0; if (activeClipId && player) { player.play(activeClipId); player.pause(); player.seek(0); } applyScrubPose(); }
    else if (rig) poseRig(rig, new Map(), { stateFor: (part) => session!.displayedStateOf(part) });
    host.setLayout(true, mode === "animate");
    syncCameraButtons();
    syncGizmoSnap();
    clearPreview();
    partHighlightSignature = "";
    syncGizmo();
    renderAll();
  }
  function setTool(next: EditorTool): void {
    tool = next;
    syncCameraButtons();
    partHighlightSignature = "";
    renderRight();
    updatePreview(lastHit);
    updatePartHighlight();
  }
  function setColor(next: string): void { color = next.toLowerCase(); renderRight(); }
  function setActivePart(part: string | null, rerender = true): void {
    activePart = part;
    if (part) layerAnchor = part;
    if (part && !selectedParts.has(part)) { selectedParts.clear(); selectedParts.add(part); }
    if (!part) selectedParts.clear();
    draftPose = null;
    extraDrafts.clear();
    syncSelectionGlow();
    syncGizmo();
    if (rerender) renderAll(); else { renderLeft(); renderBottom(); renderRight(); updatePartHighlight(); }
    updatePreview(lastHit);
  }
  function markChanged(): void {
    needsRebuild = true;
    timed("panels", renderAll);
    scheduleHistoryPersist();
  }
  function addPart(): void {
    if (!session) return;
    const id = window.prompt("New part id (letters, digits, underscores):", nextPartId());
    if (!id) return;
    if (!session.addPart(id.trim(), activePart ?? undefined)) { statusText = `Could not add part "${id}" (taken or invalid)`; renderRight(); return; }
    activePart = id.trim();
    statusText = `Added ${activePart}. Build it with 🧱 Add (on a face or on the ground), 🧩 Assign existing voxels, or 📥 paste into it; drag it in Layers to choose its parent.`;
    if (mode === "model") tool = "add";
    syncCameraButtons();
    markChanged();
  }
  function nextPartId(): string {
    if (!session) return "part";
    let n = session.parts.length;
    while (session.parts.includes(`part${n}`)) n++;
    return `part${n}`;
  }
  function duplicateActive(): void {
    if (!session || !activePart) return;
    let id = `${activePart}_copy`;
    for (let n = 2; session.parts.includes(id); n++) id = `${activePart}_copy${n}`;
    session.beginStroke();
    const ok = session.duplicatePart(activePart, id, { x: 1, y: 0, z: 0 });
    session.endStroke();
    if (ok) { activePart = id; statusText = `Duplicated as ${id} (shifted one cell in x — use Move to place it)`; markChanged(); }
  }
  function copyActive(): void {
    if (!session || !activePart) return;
    clipboard = session.copyPart(activePart);
    try { window.localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard)); } catch { /* ignore */ }
    statusText = `Copied ${activePart} (${clipboard?.cells.length ?? 0} voxels) — paste here or in another model`;
    renderLeft(); renderRight();
  }
  function pasteClipboard(): void {
    if (!session || !clipboard) return;
    let id = clipboard.source;
    for (let n = 2; session.parts.includes(id); n++) id = `${clipboard.source}_${n}`;
    session.beginStroke();
    const ok = session.pastePart(clipboard, id, undefined, activePart ?? undefined);
    session.endStroke();
    if (ok) { activePart = id; statusText = `Pasted ${id} under ${session.partMeta(id)?.parent ?? "root"} — Move it into place`; markChanged(); }
  }
  function deleteSelection(): void {
    if (!session) return;
    const list = selectionList();
    if (list.length <= 1) { deleteActive(); return; }
    if (list.length >= session.parts.length) { statusText = "Keep at least one layer"; renderRight(); return; }
    const voxels = list.reduce((sum, part) => sum + session!.partCellCount(part), 0);
    if (!window.confirm(`Delete ${list.length} layers with ${voxels} voxels? Their children re-attach to the nearest surviving parent.`)) return;
    session.beginStroke();
    for (const part of list) if (session.parts.includes(part) && session.parts.length > 1) session.deletePart(part, true);
    session.endStroke();
    selectedParts.clear();
    activePart = session.parts[0] ?? null;
    statusText = `Deleted ${list.length} layers`;
    markChanged();
  }
  function deleteActive(): void {
    if (!session || !activePart) return;
    const part = activePart;
    if (!window.confirm(`Delete part "${part}" with its ${session.partCellCount(part)} voxels? Its children re-attach to its parent.`)) return;
    session.beginStroke();
    session.deletePart(part, true);
    session.endStroke();
    activePart = session.parts[0] ?? null;
    statusText = `Deleted part ${part}`;
    markChanged();
  }
  function selectionList(): string[] {
    if (!session) return [];
    const list = session.parts.filter((part) => selectedParts.has(part));
    if (activePart && !list.includes(activePart)) list.push(activePart);
    return list;
  }
  /** Selected parts that are not inside another selected part (their subtrees follow). */
  function selectionTops(): string[] {
    const list = selectionList();
    const set = new Set(list);
    return list.filter((id) => { let cursor = session?.partMeta(id)?.parent; while (cursor) { if (set.has(cursor)) return false; cursor = session?.partMeta(cursor)?.parent; } return true; });
  }
  function groupSelection(): void {
    if (!session) return;
    const list = selectionList();
    if (list.length === 0) return;
    let suggested = "group";
    for (let n = 2; session.parts.includes(suggested); n++) suggested = `group${n}`;
    const id = window.prompt(`Group ${list.length} layer(s) under a new parent — its id:`, suggested);
    if (!id) return;
    if (!session.groupParts(list, id.trim())) { statusText = `Could not group into "${id}" (taken or invalid)`; renderRight(); return; }
    selectedParts.clear();
    selectedParts.add(id.trim());
    activePart = id.trim();
    statusText = `Grouped ${list.length} layer(s) under ${id.trim()} (joint at their centre — move it with 📍 Joint)`;
    markChanged();
  }
  function ungroupActive(): void {
    if (!session || !activePart) return;
    const children = session.childrenOf(activePart);
    if (children.length === 0) { statusText = `${activePart} has no children to ungroup`; renderRight(); return; }
    const group = activePart;
    if (!session.ungroupPart(group)) return;
    selectedParts.clear();
    for (const child of children) selectedParts.add(child);
    activePart = children[0] ?? null;
    statusText = `Ungrouped ${group}: ${children.length} layer(s) moved up${session.parts.includes(group) ? " (the group kept its own voxels)" : ""}`;
    markChanged();
  }
  function closeContextMenu(): void { contextMenu?.remove(); contextMenu = null; }
  /** Selection and active part may point at parts that no longer exist. */
  function pruneSelection(): void {
    if (!session) return;
    for (const id of [...selectedParts]) if (!session.parts.includes(id)) selectedParts.delete(id);
    if (activePart && !session.parts.includes(activePart)) activePart = selectedParts.values().next().value ?? (session.parts.length > 1 ? session.parts[0]! : null);
  }
  /** Pour `sources` into `target` (the sources disappear) — one undo step. */
  function mergeInto(sources: readonly string[], target: string): void {
    if (!session) return;
    const list = sources.filter((id) => id !== target && session!.parts.includes(id));
    if (!list.length || !session.parts.includes(target)) return;
    const moved = session.mergeParts(list, target);
    selectedParts.clear();
    selectedParts.add(target);
    activePart = target;
    pruneSelection();
    statusText = `Merged ${list.length === 1 ? list[0] : `${list.length} parts`} into ${target}: ${moved} voxels moved, children and sockets followed (Ctrl+Z undoes)`;
    markChanged();
  }

  // ------------------------------------------------------------- 🧹 tidy --
  // Scan imports shed hundreds of tiny disconnected pieces. The dialog shows
  // how many parts fall under a size threshold (live pink preview in 3D) and
  // folds them into the parts they touch, gathers them, or deletes them.
  const TIDY_BUCKETS: [number, number, string][] = [[1, 5, "1–5"], [6, 20, "6–20"], [21, 50, "21–50"], [51, 200, "51–200"], [201, 1000, "201–1k"], [1001, Infinity, "1k+"]];
  function tidyMaxThreshold(): number { return Math.max(3, Math.floor((tidy?.plan.largest ?? 3) / 2)); }
  function openTidy(): void {
    if (!session || tidy) return;
    const counts = session.partCounts();
    const largest = Math.max(1, ...counts.values());
    const threshold = Math.max(2, Math.round(largest * 0.01));
    const element = document.createElement("div");
    element.className = "lab-dialog lab-tidy";
    document.body.append(element);
    tidy = { element, threshold, mode: "touch", plan: session.tidyPlan(threshold) };
    element.addEventListener("input", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.tidy === "threshold" && tidy && session) {
        const max = tidyMaxThreshold();
        tidy.threshold = Math.max(1, Math.round(Math.exp((Number(input.value) / 100) * Math.log(max))));
        tidy.plan = session.tidyPlan(tidy.threshold);
        renderTidy();
      }
    });
    element.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("[data-tidy]");
      if (!button || !tidy || !session) return;
      const action = button.dataset.tidy;
      if (action === "close") closeTidy();
      else if (action === "mode") { tidy.mode = (button as HTMLInputElement).value as typeof tidy.mode; renderTidy(); }
      else if (action === "apply") {
        const plan = tidy.plan;
        const mode = tidy.mode;
        const result = session.applyTidy(plan, mode);
        closeTidy();
        pruneSelection();
        statusText = mode === "delete" ? `Deleted ${result.deleted} fragment part(s) (Ctrl+Z undoes)` : mode === "single" ? `Gathered ${plan.fragments.length} fragment part(s) (${result.merged} voxels) into one part` : `Folded ${plan.fragments.length - plan.floating.length} fragment part(s) (${result.merged} voxels) into the parts they touch; ${plan.floating.length} floating dropped`;
        markChanged();
      }
    });
    renderTidy();
  }
  function closeTidy(): void {
    tidy?.element.remove();
    tidy = null;
    for (const mesh of tidyMeshes) mesh.dispose(false, false);
    tidyMeshes = [];
  }
  function renderTidy(): void {
    if (!tidy || !session) return;
    const counts = session.partCounts();
    const { plan, element } = tidy;
    const max = tidyMaxThreshold();
    const sliderValue = Math.round((Math.log(Math.max(1, tidy.threshold)) / Math.log(max)) * 100);
    const bars = TIDY_BUCKETS.map(([lo, hi, label]) => {
      const inBucket = [...counts.values()].filter((n) => n >= lo && n <= hi);
      return { label, parts: inBucket.length, voxels: inBucket.reduce((s, n) => s + n, 0), selected: lo <= tidy!.threshold };
    });
    const mostParts = Math.max(1, ...bars.map((bar) => bar.parts));
    const pct = plan.total ? Math.round((plan.voxels / plan.total) * 1000) / 10 : 0;
    const targets = new Set([...plan.merges.values()]).size;
    const barsHtml = bars.map((bar) => `<div class="lab-tidy-bar ${bar.selected ? "selected" : ""}" title="${bar.parts} part(s), ${bar.voxels} voxels"><span class="label">${bar.label}</span><span class="track"><span class="fill" style="width:${Math.round((bar.parts / mostParts) * 100)}%"></span></span><span class="count">${bar.parts}</span></div>`).join("");
    const readoutHtml = `<b>${plan.fragments.length}</b> fragment part(s) · <b>${plan.voxels}</b> voxels (${pct}% of the model) · ${plan.fragments.length - plan.floating.length} touch ${targets} other part(s) · ${plan.floating.length} floating${plan.empty.length ? ` · <b>${plan.empty.length}</b> empty part(s) with no children (removed in every mode)` : ""}`;
    const applyText = `Apply to ${plan.fragments.length + plan.empty.length} part(s)`;
    if (element.childElementCount === 0) {
      // Built once; later calls update in place so a slider drag is never interrupted.
      element.innerHTML = `
      <header><strong>🧹 Tidy fragments</strong><button data-tidy="close" title="Close (Esc)">✕</button></header>
      <p class="lab-panel-hint">Scans leave hundreds of tiny loose pieces. Everything at or under the size below is a <b>fragment</b> (shown pink). The biggest part has ${plan.largest} voxels.</p>
      <label class="lab-tidy-slider">Fragments: parts with ≤ <output>${tidy.threshold}</output> voxels<input type="range" data-tidy="threshold" min="0" max="100" value="${sliderValue}" /></label>
      <div class="lab-tidy-bars">${barsHtml}</div>
      <div class="lab-tidy-readout">${readoutHtml}</div>
      <div class="lab-tidy-modes">
        <label><input type="radio" name="tidy-mode" data-tidy="mode" value="touch" ${tidy.mode === "touch" ? "checked" : ""} /> <b>Fold into what they touch</b> — each fragment joins the part it touches most; floating ones are dropped</label>
        <label><input type="radio" name="tidy-mode" data-tidy="mode" value="single" ${tidy.mode === "single" ? "checked" : ""} /> <b>Gather into one part</b> — all fragments become a single “fragments” layer you can inspect or delete later</label>
        <label><input type="radio" name="tidy-mode" data-tidy="mode" value="delete" ${tidy.mode === "delete" ? "checked" : ""} /> <b>Delete</b> — remove every fragment and its voxels</label>
      </div>
      <footer><button data-tidy="close">Cancel</button><button class="primary" data-tidy="apply" ${plan.fragments.length + plan.empty.length ? "" : "disabled"}>${applyText}</button></footer>`;
    } else {
      element.querySelector<HTMLOutputElement>(".lab-tidy-slider output")!.textContent = String(tidy.threshold);
      element.querySelector<HTMLElement>(".lab-tidy-bars")!.innerHTML = barsHtml;
      element.querySelector<HTMLElement>(".lab-tidy-readout")!.innerHTML = readoutHtml;
      const apply = element.querySelector<HTMLButtonElement>('[data-tidy="apply"]')!;
      apply.textContent = applyText;
      apply.disabled = plan.fragments.length + plan.empty.length === 0;
    }
    for (const mesh of tidyMeshes) mesh.dispose(false, false);
    tidyMeshes = plan.fragments.length ? buildOverlay("lab editor tidy", session.cellsOfParts(plan.fragments), previewMaterial, 0.05) : [];
  }
  function openContextMenu(event: MouseEvent, part: string): void {
    if (!session) return;
    event.preventDefault();
    closeContextMenu();
    // Remember what was selected before this click: "merge B into A" wants A.
    const previousActive = activePart;
    const previousSelection = selectionList();
    const wasSelected = selectedParts.has(part);
    if (!wasSelected) { selectedParts.clear(); selectedParts.add(part); activePart = part; renderLeft(); renderRight(); }
    const count = selectionList().length;
    const isGroup = session.childrenOf(part).length > 0;
    const hidden = session.isPartHidden(part);
    const items: { label: string; action: string; keys?: string; disabled?: boolean }[] = [
      { label: `⧈ Group ${count > 1 ? `${count} layers` : "layer"}`, action: "group", keys: "Ctrl+G" },
      { label: "⧉ Ungroup", action: "ungroup", keys: "Shift+Ctrl+G", disabled: !isGroup },
      { label: "✏️ Rename", action: "ctx-rename", keys: "double-click" },
      { label: hidden ? "👁️ Show" : "🙈 Hide (with children)", action: "part-hide" },
      { label: "⧉ Duplicate", action: "part-duplicate", keys: "Ctrl+D" },
      { label: "📋 Copy", action: "part-copy", keys: "Ctrl+C" },
      { label: "📥 Paste here", action: "part-paste", keys: "Ctrl+V", disabled: !clipboard },
      { label: "📤 Extract as object…", action: "part-extract" },
      { label: "🗑️ Delete", action: "part-delete", keys: "Del" },
    ];
    const mergeLabelFor = (ids: string[]) => (ids.length === 1 ? ids[0]! : `${ids.length} selected`);
    if (!wasSelected && previousActive && previousActive !== part && previousSelection.length && !previousSelection.includes(part)) {
      items.splice(2, 0,
        { label: `⤵ Merge ${part} into ${previousActive}`, action: "ctx-merge-here-into-prev" },
        { label: `⤴ Merge ${mergeLabelFor(previousSelection)} into ${part}`, action: "ctx-merge-prev-into-here" },
      );
    } else if (wasSelected && count > 1) {
      items.splice(2, 0, { label: `⤵ Merge ${count - 1} other selected into ${part}`, action: "ctx-merge-selection-into-here" });
    }
    const menu = document.createElement("div");
    menu.className = "lab-context-menu";
    menu.innerHTML = items.map((item) => `<button data-ctx="${item.action}" ${item.disabled ? "disabled" : ""}><span>${item.label}</span>${item.keys ? `<kbd>${item.keys}</kbd>` : ""}</button>`).join("");
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - 240)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - items.length * 30 - 16)}px`;
    menu.addEventListener("click", (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>("button[data-ctx]");
      if (!button || button.hasAttribute("disabled")) return;
      const action = button.dataset.ctx!;
      closeContextMenu();
      if (action === "ctx-rename") { renaming = part; renderLeft(); return; }
      if (action === "ctx-merge-here-into-prev" && previousActive) { mergeInto([part], previousActive); return; }
      if (action === "ctx-merge-prev-into-here") { mergeInto(previousSelection, part); return; }
      if (action === "ctx-merge-selection-into-here") { mergeInto(selectionList().filter((id) => id !== part), part); return; }
      const proxy = document.createElement("button");
      proxy.dataset.action = action;
      panels.left.append(proxy);
      proxy.click();
      proxy.remove();
    });
    document.body.append(menu);
    contextMenu = menu;
    const dismiss = (e: Event) => { if (e instanceof KeyboardEvent && e.key !== "Escape") return; if (e instanceof MouseEvent && menu.contains(e.target as Node)) return; closeContextMenu(); window.removeEventListener("pointerdown", dismiss, true); window.removeEventListener("keydown", dismiss, true); };
    setTimeout(() => { window.addEventListener("pointerdown", dismiss, true); window.addEventListener("keydown", dismiss, true); }, 0);
  }
  function onPanelContextMenu(event: MouseEvent): void {
    const layer = (event.target as HTMLElement).closest<HTMLElement>(".lab-layer[data-part]");
    if (layer) openContextMenu(event, layer.dataset.part!);
  }

  /** Save the active part and its descendants as a new catalog object. */
  async function extractActive(): Promise<void> {
    if (!session || !activePart) return;
    const family = [activePart, ...session.descendantsOf(activePart)];
    const suggested = `${session.modelId.replace(/_scan$/, "")}_${activePart}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40);
    const name = window.prompt(`Display name for the new object made of ${family.length > 1 ? `${activePart} and its ${family.length - 1} child part(s)` : activePart}:`, activePart);
    if (name === null) return;
    const id = window.prompt("Id (stable reference used by code — lower-case letters, digits, underscores):", suggested);
    if (!id || !/^[a-z0-9_]{1,64}$/.test(id.trim())) { statusText = "Extract cancelled: id must be lower-case letters, digits and underscores"; renderRight(); return; }
    const model = session.extractParts(family, id.trim(), name.trim() || undefined);
    if (!model) { statusText = "Nothing to extract: the part has no voxels"; renderRight(); return; }
    statusText = `Saving ${id.trim()}…`;
    renderRight();
    try {
      const response = await fetch("/__lab/save-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { existed: boolean };
      host.onSaved(model, !result.existed);
      statusText = `Extracted ${family.length} part(s) as "${model.name ?? model.id}" (${model.id})${result.existed ? " — replaced the existing object with that id" : " — it is now in the object list"}`;
    } catch (error) {
      statusText = `Extract failed: ${(error as Error).message}`;
    }
    renderRight();
  }
  function isIdentityTransform(t: { rotation: readonly number[]; position: readonly number[]; scale: readonly number[] }): boolean {
    return t.rotation.every((v) => v === 0) && t.position.every((v) => v === 0) && t.scale.every((v) => v === 1);
  }
  /** Stored-transform edit for every selected top: add rotation / multiply scale. */
  function adjustTransforms(channel: "rotation" | "scale", delta: [number, number, number]): void {
    if (!session) return;
    session.beginStroke();
    for (const part of selectionTops()) {
      const t = session.partMeta(part)!.transform;
      if (channel === "rotation") session.setPartTransform(part, { rotation: [t.rotation[0] + delta[0], t.rotation[1] + delta[1], t.rotation[2] + delta[2]] });
      else session.setPartTransform(part, { scale: [t.scale[0] * delta[0], t.scale[1] * delta[1], t.scale[2] * delta[2]] });
    }
    session.endStroke();
    statusText = channel === "rotation" ? `Rotated ${selectionTops().length} part(s) by ${delta.filter((v) => v)[0] ?? 0}°` : `Scaled ${selectionTops().length} part(s) ×${delta[0]}`;
    markChanged();
  }
  /** Bake into every selected part as one body, pivoting on the active part's joint. */
  function bake(transform: Parameters<VoxelEditSession["transformPart"]>[1]): void {
    if (!session || !activePart) return;
    const tops = selectionTops();
    const center = tops.length > 1 ? selectionCenter() : null;
    session.beginStroke();
    const placed = tops.length > 1 && center ? session.transformParts(tops, transform, center) : session.transformPart(activePart, transform);
    session.endStroke();
    statusText = tops.length > 1 && center ? `Baked into ${tops.length} selected parts as one body around their centre (${center.x}, ${center.y}, ${center.z}) — ${placed} voxels` : `Baked into ${activePart} (${placed} voxels)`;
    markChanged();
  }

  // ------------------------------------------------------------ playback --
  function setClip(id: string | null): void {
    activeClipId = id;
    draftPose = null;
    extraDrafts.clear();
    scrubTime = 0;
    selectedKeys.clear();
    keyAnchor = null;
    if (player) { player.stop(); if (id) { player.play(id); player.pause(); player.seek(0); } }
    if (mode === "animate") applyScrubPose();
    renderAll();
  }
  function setScrub(t: number, rerender = true): void {
    scrubTime = t;
    draftPose = null;
    extraDrafts.clear();
    applyScrubPose();
    if (rerender) { renderRight(); renderBottom(); } else refreshPlayhead();
  }
  function applyScrubPose(): void {
    if (!rig || !session || mode !== "animate") return;
    const clip = activeClip();
    if (!clip) { poseRig(rig, new Map()); return; }
    const poses = sampleClip(clip, scrubTime);
    if (draftPose) poses.set(activeTrackPart(), draftPose);
    for (const [part, pose] of extraDrafts) poses.set(part, pose);
    poseRig(rig, poses);
    syncSessionStates();
  }
  /** Session's displayed states follow what the rig shows (Animate: the playhead). */
  function syncSessionStates(): void {
    if (!rig || !session) return;
    let changed = false;
    for (const part of rig.parts.values()) if (session.parts.includes(part.id) && session.displayedStateOf(part.id) !== part.state && part.state) { session.setDisplayedState(part.id, part.state); changed = true; }
    if (changed) { previewSignature = ""; partHighlightSignature = ""; }
  }
  /** Rig shows each part's displayed state (Model mode / after a rebuild in Animate mode). */
  function applyStates(): void {
    if (!rig || !session) return;
    if (mode === "animate") { applyScrubPose(); return; }
    for (const part of rig.parts.values()) setRigPartState(part, session.displayedStateOf(part.id));
  }
  function togglePlay(): void {
    if (!player || !activeClipId) return;
    if (player.playing) { player.pause(); scrubTime = player.time; }
    else {
      draftPose = null;
      const clip = activeClip();
      player.play(activeClipId, { from: clip && scrubTime >= clip.duration ? 0 : scrubTime });
    }
    refreshPlayhead();
  }
  function insertKey(): void {
    if (!session || !activeClipId) return;
    const pose = draftPose ?? poseAtScrub();
    const ease = (panels.right.querySelector<HTMLSelectElement>('[data-action="key-ease"]')?.value ?? lastEase) as ClipEase;
    lastEase = ease;
    const clipNow = activeClip();
    if (clipNow && scrubTime > clipNow.duration) scrubTime = clipNow.duration;
    session.beginStroke();
    const existing = keyAtScrub();
    const state = pendingKeyState || existing?.state;
    const switchFields = state ? { state, transition: existing?.transition ?? pendingTransition, ...((existing?.transition ?? pendingTransition) === "blend" ? { transitionDirection: existing?.transitionDirection ?? pendingDirection } : {}) } : {};
    // Opacity is always written: a fade from solid needs the solid key to say 1 explicitly.
    const opacityField = { opacity: round(Math.min(1, Math.max(0, pose.opacity ?? 1)), 3) };
    session.setKey(activeClipId, activeTrackPart(), { t: round(scrubTime, 4), rotation: pose.rotation, position: pose.position, scale: pose.scale, ease, ...opacityField, ...switchFields });
    for (const [part, extra] of extraDrafts) session.setKey(activeClipId, part, { t: round(scrubTime, 4), rotation: extra.rotation, position: extra.position, scale: extra.scale, ease });
    session.endStroke();
    const extraCount = extraDrafts.size;
    draftPose = null;
    extraDrafts.clear();
    statusText = `Key for ${activeTrackPart()}${extraCount ? ` and ${extraCount} more selected part(s)` : ""} at ${round(scrubTime, 2)}s`;
    markChanged();
  }
  /** Selected keys, or the key under the playhead on the active track. */
  function selectedKeyList(): { part: string; t: number; key: ClipKey }[] {
    const clip = activeClip();
    if (!clip) return [];
    const list: { part: string; t: number; key: ClipKey }[] = [];
    for (const track of clip.tracks) for (const key of track.keys) if (selectedKeys.has(keyId(track.part, key.t))) list.push({ part: track.part, t: key.t, key });
    if (list.length === 0) { const at = keyAtScrub(); if (at) list.push({ part: activeTrackPart(), t: at.t, key: at }); }
    return list;
  }
  function copyKeys(): void {
    const list = selectedKeyList();
    if (!list.length) return;
    const origin = Math.min(...list.map((entry) => entry.t));
    keyClipboard = { keys: list.map((entry) => ({ part: entry.part, t: round(entry.t - origin, 4), key: { ...entry.key } })), parts: new Set(list.map((entry) => entry.part)).size };
    try { window.localStorage.setItem(KEY_CLIPBOARD_KEY, JSON.stringify(keyClipboard)); } catch { /* ignore */ }
    statusText = `Copied ${list.length} key(s) from ${keyClipboard.parts} part(s) — Ctrl+V pastes them at the playhead`;
    renderBottom(); renderStatus();
  }
  function pasteKeys(): void {
    const clip = activeClip();
    if (!session || !clip || !activeClipId || !keyClipboard?.keys.length) return;
    // Keys copied from one part land on the active track; multi-part copies keep their parts.
    const retarget = keyClipboard.parts === 1;
    session.beginStroke();
    selectedKeys.clear();
    let pasted = 0;
    for (const entry of keyClipboard.keys) {
      const part = retarget ? activeTrackPart() : entry.part;
      if (part !== "*" && !session.parts.includes(part)) continue;
      const t = round(scrubTime + entry.t, 4);
      if (t > clip.duration + 1e-9) continue;
      session.setKey(activeClipId, part, { ...entry.key, t });
      selectedKeys.add(keyId(part, t));
      pasted++;
    }
    session.endStroke();
    statusText = pasted ? `Pasted ${pasted} key(s) at ${round(scrubTime, 2)}s${retarget ? ` onto ${activeTrackPart()}` : ""}` : "Nothing pasted (keys fall past the clip end or their parts are missing)";
    draftPose = null;
    markChanged();
  }
  function deleteSelectedKeys(): void {
    if (!session || !activeClipId) return;
    const list = selectedKeyList();
    if (!list.length) return;
    session.beginStroke();
    for (const entry of list) session.removeKey(activeClipId, entry.part, entry.t);
    session.endStroke();
    selectedKeys.clear();
    statusText = `Deleted ${list.length} key(s)`;
    draftPose = null;
    markChanged();
  }
  function selectAllKeys(onlyActiveTrack: boolean): void {
    const clip = activeClip();
    if (!clip) return;
    selectedKeys.clear();
    for (const track of clip.tracks) if (!onlyActiveTrack || track.part === activeTrackPart()) for (const key of track.keys) selectedKeys.add(keyId(track.part, key.t));
    statusText = `${selectedKeys.size} key(s) selected`;
    renderBottom(); renderRight(); renderStatus();
  }
  function jumpToKey(direction: 1 | -1): void {
    const clip = activeClip();
    if (!clip) return;
    const times = [...new Set(clip.tracks.flatMap((track) => track.keys.map((key) => key.t)))].sort((a, b) => a - b);
    const next = direction > 0 ? times.find((t) => t > scrubTime + 1e-6) : [...times].reverse().find((t) => t < scrubTime - 1e-6);
    if (next !== undefined) { player?.pause(); setScrub(next); }
  }

  // ------------------------------------------------------- history store --
  const HISTORY_KEY = (id: string) => `farm-lab-history:${id}`;
  const HISTORY_BYTES = 3_500_000;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleHistoryPersist(): void { if (persistTimer) clearTimeout(persistTimer); persistTimer = setTimeout(persistHistory, 350); }
  function persistHistory(): void {
    persistTimer = null;
    if (!session) return;
    try {
      const history: SerializedHistory = session.exportHistory();
      let json = JSON.stringify(history);
      while (json.length > HISTORY_BYTES && (history.undo.length || history.redo.length)) {
        if (history.redo.length) history.redo.shift();
        else { history.undo.shift(); history.savedIndex = history.savedIndex > 0 ? history.savedIndex - 1 : -1; }
        json = JSON.stringify(history);
      }
      window.localStorage.setItem(HISTORY_KEY(session.modelId), json);
    } catch { /* storage full or unavailable */ }
  }
  function restoreHistory(): void {
    if (!session) return;
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY(session.modelId));
      if (!raw) return;
      if (session.importHistory(JSON.parse(raw) as SerializedHistory)) {
        if (session.undoDepth || session.redoDepth) { statusText = `Restored ${session.undoDepth} undo / ${session.redoDepth} redo step(s)${session.dirty ? " and your unsaved voxel edits" : ""}.`; needsRebuild = true; }
      } else window.localStorage.removeItem(HISTORY_KEY(session.modelId));
    } catch { /* corrupt entry */ }
  }
  function forgetHistory(): void { if (session) try { window.localStorage.removeItem(HISTORY_KEY(session.modelId)); } catch { /* ignore */ } }

  // -------------------------------------------------------------- picking --
  function pointerToCanvas(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  }
  function pickCell(event: PointerEvent, allowGround = false): Hit | null {
    if (!rig || !session) return null;
    const { x, y } = pointerToCanvas(event);
    const meshes = new Set(rig.meshes);
    const pick = scene.pick(x, y, (candidate) => meshes.has(candidate as Mesh));
    if (pick?.hit && pick.pickedPoint && pick.pickedMesh) {
      const mesh = pick.pickedMesh as Mesh;
      const part = (mesh.metadata as { rigPart?: string } | null)?.rigPart;
      const meta = part ? session.partMeta(part) : undefined;
      if (!part || !meta) return null;
      const localNormal = pick.getNormal(false) ?? new Vector3(0, 1, 0);
      const worldNormal = pick.getNormal(true) ?? new Vector3(0, 1, 0);
      const local = Vector3.TransformCoordinates(pick.pickedPoint, mesh.getWorldMatrix().clone().invert());
      const pitch = session.pitch;
      const inside = local.subtract(localNormal.scale(pitch * 0.25));
      const cell = { x: Math.round(inside.x / pitch) + meta.pivot[0], y: Math.round(inside.y / pitch) + meta.pivot[1], z: Math.round(inside.z / pitch) + meta.pivot[2] };
      const axis: 0 | 1 | 2 = Math.abs(localNormal.x) >= Math.abs(localNormal.y) && Math.abs(localNormal.x) >= Math.abs(localNormal.z) ? 0 : Math.abs(localNormal.y) >= Math.abs(localNormal.z) ? 1 : 2;
      const step = [Math.round(localNormal.x), Math.round(localNormal.y), Math.round(localNormal.z)];
      return { cell, outside: { x: cell.x + step[0]!, y: cell.y + step[1]!, z: cell.z + step[2]! }, axis, part, normal: worldNormal, point: pick.pickedPoint.clone() };
    }
    if (!allowGround) return null;
    // Empty space: the ground plane at the model's lowest row, so a brand-new
    // part can start anywhere (assigned to the active part).
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const groundY = rig.anchor.position.y;
    const t = (groundY - ray.origin.y) / ray.direction.y;
    if (t <= 0) return null;
    const point = ray.origin.add(ray.direction.scale(t));
    const pitch = session.pitch;
    const cells = session.visibleCells();
    const minY = cells.length ? cells.reduce((low, c) => Math.min(low, c.y), Infinity) : 0;
    const cell = { x: Math.round((point.x - rig.anchor.position.x) / pitch), y: minY, z: Math.round((point.z - rig.anchor.position.z) / pitch) };
    const part = activePart ?? session.parts[0]!;
    return { cell, outside: cell, axis: 1, part, normal: new Vector3(0, 1, 0), point, ground: true };
  }
  function projectOnAddPlane(event: PointerEvent, plane: AddPlane): Hit | null {
    if (!rig || !session) return null;
    const { x, y } = pointerToCanvas(event);
    const ray = scene.createPickingRay(x, y, Matrix.Identity(), camera);
    const denominator = Vector3.Dot(ray.direction, plane.normal);
    if (Math.abs(denominator) < 1e-6) return null;
    const t = Vector3.Dot(plane.point.subtract(ray.origin), plane.normal) / denominator;
    if (t <= 0) return null;
    const world = ray.origin.add(ray.direction.scale(t));
    const pitch = session.pitch;
    let cell: Coordinate;
    if (plane.ground) {
      cell = { x: Math.round((world.x - rig.anchor.position.x) / pitch), y: plane.layer, z: Math.round((world.z - rig.anchor.position.z) / pitch) };
    } else {
      const rigPart = rig.parts.get(plane.part);
      const meta = session.partMeta(plane.part);
      if (!rigPart?.mesh || !meta) return null;
      const local = Vector3.TransformCoordinates(world, rigPart.mesh.getWorldMatrix().clone().invert());
      cell = { x: Math.round(local.x / pitch) + meta.pivot[0], y: Math.round(local.y / pitch) + meta.pivot[1], z: Math.round(local.z / pitch) + meta.pivot[2] };
      (cell as unknown as Record<string, number>)[(["x", "y", "z"] as const)[plane.axis]] = plane.layer;
    }
    return { cell, outside: cell, axis: plane.axis, part: plane.part, normal: plane.normal, point: world, ground: plane.ground };
  }

  function applyTool(hit: Hit, first: boolean): void {
    if (!session) return;
    const target = tool === "add" ? hit.outside : hit.cell;
    const key = `${target.x},${target.y},${target.z}`;
    if (!first && key === lastStrokeCell) return;
    lastStrokeCell = key;
    switch (tool) {
      case "paint": session.paint(brushCoordinates(hit.cell, brush), color, hit.part); break;
      case "erase": session.erase(brushCoordinates(hit.cell, brush), hit.part); break;
      case "add": session.add(planeBrushCoordinates(hit.outside, hit.axis, brush), color, addTargetPart(hit)); break;
      case "bucket": { const changed = shiftHeld ? session.floodFillSimilar(hit.cell, color, 0.22, hit.part) : session.floodFill(hit.cell, color, hit.part); statusText = `Bucket: ${changed} voxels of ${hit.part} recolored${shiftHeld ? " (similar shades)" : ""}`; break; }
      case "eyedropper": { const cell = session.get(hit.cell.x, hit.cell.y, hit.cell.z, hit.part); if (cell) { setColor(cell.color); selectedPaletteColor = cell.color; statusText = `Picked ${cell.color} from ${cell.part}`; } break; }
      case "chunk": { const changed = session.deleteChunk(hit.cell, hit.part); statusText = `Removed a piece of ${changed} voxels from ${hit.part}`; break; }
      case "assign": if (!activePart) statusText = "Pick or add a layer first"; else if (!first) session.assign(brushCoordinates(hit.cell, brush), activePart, hit.part); break;
      case "pivot": if (activePart) { session.setPivot(activePart, hit.cell); statusText = `Joint of ${activePart} at (${hit.cell.x}, ${hit.cell.y}, ${hit.cell.z})`; } else statusText = "Pick a layer first"; break;
      case "socket": {
        if (!activePart) { statusText = "Pick a layer first"; break; }
        const name = window.prompt(`Socket name on ${activePart} (e.g. hand, lid, tip):`, "socket");
        if (name) { session.setSocket(activePart, name.trim(), hit.cell); statusText = `Socket ${name.trim()} on ${activePart} at (${hit.cell.x}, ${hit.cell.y}, ${hit.cell.z})`; }
        break;
      }
      case "inspect": { if (first) setActivePart(hit.part); return; }
      case "orbit": return;
    }
    needsRebuild = true;
  }

  function onPointerDown(event: PointerEvent): void {
    if (!session || event.button !== 0) return;
    if (pointerOnGizmo(event)) { pressPoint = null; return; }
    pressPoint = { x: event.clientX, y: event.clientY };
    if (mode === "animate") return; // click-select resolved on pointerup; camera owns the drag
    if (tool === "orbit" || spaceHeld || event.altKey) { clearPreview(); return; }
    const hit = pickCell(event, tool === "add" && !!activePart);
    if (!hit) return;
    event.preventDefault();
    shiftHeld = event.shiftKey;
    painting = TOOLS.find((t) => t.id === tool)!.continuous;
    strokeMoved = false;
    strokeStart = hit;
    addPlane = tool === "add" ? { axis: hit.axis, layer: hit.outside[(["x", "y", "z"] as const)[hit.axis]], part: addTargetPart(hit), point: hit.point.add(hit.normal.scale(session.pitch * 0.5)), normal: hit.normal, ground: !!hit.ground } : null;
    lastStrokeCell = null;
    session.beginStroke();
    applyTool(hit, true);
    if (!painting) { session.endStroke(); renderAll(); scheduleHistoryPersist(); }
    clearPreview();
  }
  function onPointerMove(event: PointerEvent): void {
    if (!session) return;
    shiftHeld = event.shiftKey;
    if (gizmoDragging || (!painting && pointerOnGizmo(event))) { lastHit = null; clearPreview(); return; }
    if (mode === "animate") { lastHit = null; return; }
    const hit = painting && addPlane ? projectOnAddPlane(event, addPlane) : pickCell(event, tool === "add" && !!activePart);
    lastHit = hit;
    if (painting && hit) {
      const moved = strokeStart && (hit.cell.x !== strokeStart.cell.x || hit.cell.y !== strokeStart.cell.y || hit.cell.z !== strokeStart.cell.z);
      if (moved) {
        if (!strokeMoved && tool === "assign" && activePart && strokeStart) session.assign(brushCoordinates(strokeStart.cell, brush), activePart, strokeStart.part);
        strokeMoved = true;
      }
      applyTool(hit, false);
    }
    updatePreview(hit);
  }
  function onPointerUp(event: PointerEvent): void {
    if (!session) return;
    if (mode === "animate") {
      if (pressPoint && Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y) < 4 && event.target === canvas) {
        const hit = pickCell(event);
        if (hit) setActivePart(hit.part);
      }
      pressPoint = null;
      return;
    }
    pressPoint = null;
    if (!painting) return;
    painting = false;
    addPlane = null;
    if (tool === "assign" && !strokeMoved && strokeStart && activePart) {
      const changed = session.assign(session.similarColorRegion(strokeStart.cell, 0.22, strokeStart.part), activePart, strokeStart.part);
      statusText = `Assigned ${changed} voxels to ${activePart}`;
      needsRebuild = true;
    }
    strokeStart = null;
    session.endStroke();
    timed("panels", renderAll);
    scheduleHistoryPersist();
  }
  function onPointerLeave(): void { lastHit = null; updatePreview(null); }

  // ------------------------------------------------------------- rebuild --
  // Only parts whose cells (or visibility / joint) changed get a new mesh; the
  // rest keep their meshes, re-parented onto the fresh nodes, and every mesh
  // shares one material, so an edit never leaves a frame without the model.
  const partSignatures = new Map<string, string>();
  // Dev hook: per-stage timings of the edit loop (window.__labPerf).
  const perf: Record<string, { ms: number; n: number }> = {};
  (window as unknown as { __labPerf: unknown }).__labPerf = perf;
  // Dev hook for driven browser checks (prompts cannot be answered by scripts).
  (window as unknown as { __labDev: unknown }).__labDev = {
    get session() { return session; },
    addState(part: string, name: string) { if (!session?.addState(part, name)) return false; applyStates(); markChanged(); return true; },
    setDisplayedState(part: string, state: string) { if (!session?.setDisplayedState(part, state)) return false; applyStates(); previewSignature = ""; renderAll(); return true; },
    get mode() { return mode; },
  };
  function timed<T>(label: string, fn: () => T): T {
    const t0 = performance.now();
    try { return fn(); } finally { const entry = (perf[label] ??= { ms: 0, n: 0 }); entry.ms += performance.now() - t0; entry.n++; }
  }
  function partSignature(part: string): string {
    if (!session) return "";
    // Per-layer version counters from the session (base + every voxel state): no scan of the cells.
    const meta = session.partMeta(part);
    const hidden = !meta || (() => { let cursor: string | undefined = part; const seen = new Set<string>(); while (cursor && !seen.has(cursor)) { if (session!.isPartHidden(cursor)) return true; seen.add(cursor); cursor = session!.partMeta(cursor)?.parent; } return false; })();
    return `${`${hidden ? 0 : 1}|${session.layersOf(part).map((layer) => `${layer}:${session!.layerVersion(layer)}`).join(",")}|${meta?.pivot.join(",")}`}|g:${session.glowSignature()}`;
  }
  function rebuild(): void { timed("rebuild", rebuildNow); }
  // Big parts are meshed in EDIT_CHUNK³ blocks; a stroke re-meshes only the
  // blocks it touched (plus border neighbours), so painting a 140k-voxel scan
  // costs the same as painting a pebble.
  interface ChunkEntry { meshes: Mesh[]; version: number; pivot: string }
  const chunkCache = new Map<string, Map<string, ChunkEntry>>();
  function buildPartMeshes(partId: string, next: VoxelRig, previousMeshes: Mesh[]): void {
    if (!session) return;
    const rigPart = next.parts.get(partId);
    const meta = session.partMeta(partId);
    if (!rigPart || !meta) return;
    const [px, py, pz] = meta.pivot;
    // Glow is part of the cache key: toggling it re-splits the chunk into lit and glowing meshes.
    const pivotKey = `${meta.pivot.join(",")}|${session.glowSignature()}`;
    const glow = new Map<string, number>();
    for (const entry of session.glowSignature().split(",").filter(Boolean)) { const [hex, value] = entry.split(":"); glow.set(hex!, Number(value)); }
    let cache = chunkCache.get(partId);
    if (!cache) chunkCache.set(partId, (cache = new Map()));
    // Every voxel state of the part gets its own chunk meshes; only the shown
    // state is enabled (applyStates), so a key can switch instantly.
    const seen = new Set<string>();
    const out: Mesh[] = [];
    rigPart.stateMeshes = new Map();
    for (const layer of session.layersOf(partId)) {
      const state = session.stateOf(layer);
      const solid = (x: number, y: number, z: number) => session!.cellOfLayer(layer, x + px, y + py, z + pz) !== undefined;
      const list: Mesh[] = [];
      const chunks = timed("rebuild:chunks", () => session!.chunksOfLayer(layer));
      for (const chunk of chunks) {
        seen.add(chunk.key);
        let entry = cache.get(chunk.key);
        if (entry && (entry.version !== chunk.version || entry.pivot !== pivotKey || entry.meshes.some((mesh) => mesh.isDisposed()))) entry = undefined; // stale: left in the old rig, disposed with it
        if (!entry) {
          const local = Array.from(chunk.cells, (cell) => ({ x: cell.x - px, y: cell.y - py, z: cell.z - pz, color: cell.color }));
          const { lit, glowing } = splitGlowCells(local, glow);
          const meshes: Mesh[] = [];
          if (lit.length || !glowing.length) {
            const mesh = timed("rebuild:chunkmesh", () => createVoxelMesh(`${next.root.name}.${layer} chunk ${chunk.cx},${chunk.cy},${chunk.cz}`, lit, session!.pitch, scene, { material: next.material, solid }));
            mesh.receiveShadows = true;
            timed("rebuild:shadow", () => shadows?.addShadowCaster(mesh));
            mesh.metadata = { rigPart: partId, state };
            meshes.push(mesh);
          }
          if (glowing.length) {
            const glowMesh = createVoxelMesh(`${next.root.name}.${layer} chunk ${chunk.cx},${chunk.cy},${chunk.cz} glow`, glowing, session!.pitch, scene, { material: glowMaterialFor(scene), solid });
            glowMesh.metadata = { rigPart: partId, state };
            tagGlow(glowMesh, glowInfoOf(glowing, glow));
            meshes.push(glowMesh);
          }
          entry = { meshes, version: chunk.version, pivot: pivotKey };
          cache.set(chunk.key, entry);
        } else {
          for (const mesh of entry.meshes) { const index = previousMeshes.indexOf(mesh); if (index >= 0) previousMeshes.splice(index, 1); } // reused: survives the old rig's dispose
        }
        for (const mesh of entry.meshes) { mesh.parent = rigPart.node; list.push(mesh); out.push(mesh); }
      }
      rigPart.stateMeshes.set(state, list);
    }
    for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
    rigPart.meshes = out;
    rigPart.mesh = rigPart.stateMeshes.get("base")?.[0] ?? out[0] ?? null;
    rigPart.state = "";
    next.meshes.push(...out);
  }
  function rebuildNow(): void {
    if (!session || !rig) return;
    const previous = rig;
    const keep = new Map<string, Mesh[]>();
    const nextSignatures = new Map<string, string>();
    for (const id of session.parts) {
      const signature = partSignature(id);
      nextSignatures.set(id, signature);
      const old = previous.parts.get(id)?.meshes ?? [];
      if (old.length && partSignatures.get(id) === signature) keep.set(id, old);
    }
    // The rig is created without any geometry: unchanged parts carry their
    // meshes over, changed visible parts are (re)meshed chunk by chunk.
    const skeleton = timed("rebuild:encode", () => session!.toAuthoredModel(undefined, { cellsFor: () => false }));
    const next = createVoxelRig(skeleton, scene, { name: previous.root.name, shadows, material: previous.material, lights: true, stateCells: (part, state) => session!.cellsOfLayer(layerId(part, state)) });
    for (const [partId, meshes] of keep) {
      const rigPart = next.parts.get(partId)!;
      for (const mesh of meshes) {
        mesh.parent = rigPart.node;
        next.meshes.push(mesh);
        previous.meshes.splice(previous.meshes.indexOf(mesh), 1); // survives the dispose below
      }
      rigPart.meshes = meshes;
      rigPart.mesh = meshes[0] ?? null;
      rigPart.stateMeshes = previous.parts.get(partId)!.stateMeshes;
      rigPart.state = "";
    }
    timed("rebuild:mesh", () => { for (const id of session!.parts) if (!keep.has(id) && session!.isPartVisible(id)) buildPartMeshes(id, next, previous.meshes); });
    next.anchor.position.set(0, rootY, 0);
    const wasPlaying = player?.playing ?? false;
    // Shaders compile asynchronously and Babylon drops a compiled effect once
    // the last mesh using it is disposed. Fetching the new meshes' effects
    // while the old meshes are still alive keeps them cached, so a single-part
    // model never spends a frame invisible mid-stroke.
    for (const mesh of next.meshes) mesh.isReady(true);
    // Overlays (preview, part highlight, joint marker) hang under the old rig's
    // nodes; detach them so the dispose below does not take them (and their
    // shared effect) down before the refreshed overlays are built.
    for (const mesh of [...previewMeshes, ...partHighlight, ...socketMarkers, jointMarker]) if (!mesh.isDisposed()) mesh.parent = null;
    previous.dispose({ keepMaterial: true });
    partSignatures.clear();
    for (const [id, signature] of nextSignatures) partSignatures.set(id, signature);
    rig = next;
    player = createClipPlayer(next, { onEvent: (event) => { statusText = `event "${event.name}" at ${event.t.toFixed(2)}s${event.swapModel ? ` → ${event.swapModel}` : ""}`; renderStatus(); } });
    if (activeClipId && activeClip()) {
      player.play(activeClipId, { from: scrubTime });
      if (!wasPlaying || mode !== "animate") { player.pause(); applyScrubPose(); }
    }
    if (mode !== "animate") poseRig(next, new Map(), { stateFor: (part) => session!.displayedStateOf(part) });
    else applyStates();
    host.onRigReplaced(next);
    host.onStats(`${session.size} cells · ${next.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0)} triangles · ${session.parts.length} part(s) · ${session.clips.length} clip(s) · ${session.dirty ? "unsaved edits" : "matches catalog"} · editing`);
    previewSignature = "";
    partHighlightSignature = "";
    updatePreview(lastHit);
    updatePartHighlight();
    syncSelectionGlow();
    syncGizmo();
  }

  // ---------------------------------------------------------------- save --
  async function save(id: string): Promise<void> {
    if (!session) return;
    if (!/^[a-z0-9_]{1,64}$/.test(id)) { statusText = "Model id must be lower-case letters, digits and underscores"; renderRight(); return; }
    const model = session.toAuthoredModel(id);
    statusText = `Saving ${id}…`;
    renderRight();
    try {
      const response = await fetch("/__lab/save-model", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as { existed: boolean };
      if (id === session.modelId) { session.markSaved(); persistHistory(); }
      statusText = `Saved ${id} to src/assets/food-models.json${result.existed ? "" : " (new model)"}`;
      host.onSaved(model, !result.existed);
      needsRebuild = true;
    } catch (error) {
      statusText = `Save failed: ${(error as Error).message}. Is the Vite dev server running?`;
    }
    renderAll();
  }

  // ------------------------------------------------------------ keyboard --
  function onKeyDown(event: KeyboardEvent): void {
    if (!session) return;
    if (event.key === "Shift" && !shiftHeld) { shiftHeld = true; syncGizmoSnap(); updatePreview(lastHit); return; }
    if (event.key === "Alt" && !altHeld) { altHeld = true; syncCameraButtons(); updatePreview(lastHit); return; }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    const meta = event.metaKey || event.ctrlKey;
    if (event.key === "Tab") { event.preventDefault(); setMode(mode === "model" ? "animate" : "model"); return; }
    if (event.key === "Escape" && tidy) { closeTidy(); return; }
    if (event.key === " " && !spaceHeld) { event.preventDefault(); if (mode === "animate") { togglePlay(); return; } spaceHeld = true; syncCameraButtons(); updatePreview(lastHit); return; }
    if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey ? session.redo() : session.undo()) { statusText = event.shiftKey ? "Redo" : "Undo"; markChanged(); } return; }
    if (meta && event.key.toLowerCase() === "y") { event.preventDefault(); if (session.redo()) { statusText = "Redo"; markChanged(); } return; }
    if (meta && event.key.toLowerCase() === "s") { event.preventDefault(); if (session.dirty) void save(session.modelId); return; }
    if (mode === "animate" && meta && event.key.toLowerCase() === "c") { event.preventDefault(); copyKeys(); return; }
    if (mode === "animate" && meta && event.key.toLowerCase() === "v") { event.preventDefault(); pasteKeys(); return; }
    if (mode === "animate" && meta && event.key.toLowerCase() === "a") { event.preventDefault(); selectAllKeys(event.shiftKey); return; }
    if (meta && event.key.toLowerCase() === "g") { event.preventDefault(); if (event.shiftKey) ungroupActive(); else groupSelection(); return; }
    if (meta && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateActive(); return; }
    if (meta && event.key.toLowerCase() === "c") { event.preventDefault(); copyActive(); return; }
    if (meta && event.key.toLowerCase() === "v") { event.preventDefault(); pasteClipboard(); return; }
    if (meta) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      if (mode === "animate") { if (selectedKeys.size || keyAtScrub()) deleteSelectedKeys(); return; }
      if (!renaming) deleteSelection();
      return;
    }
    if (mode === "animate" && event.key === "Escape" && selectedKeys.size) { selectedKeys.clear(); renderBottom(); renderRight(); return; }
    if (event.key.toLowerCase() === "n") { addPart(); return; }
    const gizmoByKey = GIZMOS.find((g) => g.key.toLowerCase() === event.key.toLowerCase());
    if (gizmoByKey) { setGizmoMode(gizmoByKey.id); return; }
    if (mode === "animate") {
      if (event.key.toLowerCase() === "i") { insertKey(); return; }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        if (event.shiftKey) jumpToKey(event.key === "ArrowRight" ? 1 : -1);
        else { const clip = activeClip(); if (clip) { player?.pause(); setScrub(Math.min(clip.duration, Math.max(0, round(scrubTime + (event.key === "ArrowRight" ? 0.05 : -0.05), 4)))); } }
        return;
      }
      if (event.key === "Home") { player?.pause(); setScrub(0); return; }
      if (event.key === "End") { player?.pause(); setScrub(activeClip()?.duration ?? 0); return; }
      if (event.key === "Escape") { editor.close(); return; }
      return;
    }
    const toolByKey = TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (toolByKey) { setTool(toolByKey.id); return; }
    if (event.key === "[") { brush = Math.max(0, brush - 1); renderRight(); updatePreview(lastHit); }
    if (event.key === "]") { brush = Math.min(BRUSH_SIZES.length - 1, brush + 1); renderRight(); updatePreview(lastHit); }
    if (event.key === "Escape") { if (tool === "inspect") editor.close(); else setTool("inspect"); }
  }
  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Shift" && shiftHeld) { shiftHeld = false; syncGizmoSnap(); updatePreview(lastHit); }
    if (event.key === "Alt" && altHeld) { altHeld = false; syncCameraButtons(); updatePreview(lastHit); }
    if (event.key === " " && spaceHeld) { spaceHeld = false; syncCameraButtons(); updatePreview(lastHit); }
  }
  function onWindowBlur(): void { spaceHeld = false; altHeld = false; shiftHeld = false; syncCameraButtons(); syncGizmoSnap(); }

  // ---------------------------------------------------------------- camera --
  const pointers = camera.inputs.attached.pointers as ArcRotateCameraPointersInput;
  function syncCameraButtons(): void {
    if (!session) return;
    // Right button is never Babylon's: the head camera (labCamera.ts) looks and flies with it.
    pointers.buttons = mode === "animate" || tool === "orbit" || spaceHeld || altHeld ? [0, 1] : [1];
  }
  function claimLeftButton(): void { syncCameraButtons(); camera._panningMouseButton = 1; camera._useCtrlForPanning = true; }
  function releaseLeftButton(): void { pointers.buttons = [0, 1]; camera._panningMouseButton = 1; camera._useCtrlForPanning = false; }

  // Panel event wiring (once).
  for (const panel of [panels.left, panels.right, panels.bottom, panels.modes]) {
    panel.addEventListener("click", onPanelClick);
    panel.addEventListener("dblclick", onPanelDblClick);
    panel.addEventListener("input", onPanelInput);
    panel.addEventListener("change", onPanelChange);
    panel.addEventListener("keydown", onPanelKeyDown);
    panel.addEventListener("focusout", onPanelFocusOut);
    panel.addEventListener("toggle", onPanelToggle, true);
  }
  panels.left.addEventListener("contextmenu", onPanelContextMenu);
  panels.left.addEventListener("dragstart", onDragStart);
  panels.left.addEventListener("dragover", onDragOver);
  panels.left.addEventListener("drop", onDrop);
  panels.left.addEventListener("dragend", onDragEnd);
  panels.bottom.addEventListener("pointerdown", onSheetPointerDown);
  window.addEventListener("pointermove", onSheetPointerMove);
  window.addEventListener("pointerup", onSheetPointerUp);

  const editor: LabEditor = {
    get active() { return session !== null; },
    get dirty() { return session?.dirty ?? false; },
    selectionMeshes() {
      if (!rig) return [];
      const ids = selectedParts.size ? [...selectedParts] : activePart ? [activePart] : [];
      const meshes = ids.flatMap((id) => rig!.parts.get(id)?.meshes ?? []);
      return meshes.length ? meshes : rig.meshes;
    },
    open(model, targetRig) {
      editor.close();
      chunkCache.clear();
      session = new VoxelEditSession(model);
      rig = targetRig;
      rootY = targetRig.anchor.position.y;
      poseRig(targetRig, new Map());
      player = createClipPlayer(targetRig, { onEvent: (event) => { statusText = `event "${event.name}" at ${event.t.toFixed(2)}s`; renderStatus(); } });
      mode = "model";
      tool = "paint";
      spaceHeld = false; altHeld = false; shiftHeld = false; addPlane = null; draftPose = null; renaming = null; collapsed.clear(); selectedParts.clear(); closeContextMenu();
      activePart = session.parts.length > 1 ? session.parts[0]! : null;
      activeClipId = session.clips[0]?.id ?? null;
      scrubTime = 0;
      statusText = `${session.size} voxels · ${session.parts.length} part(s) · ${session.clips.length} clip(s). Pick a tool and point at the model.`;
      const palette = session.paletteInUse();
      if (palette[0]) { color = palette[0].color; selectedPaletteColor = color; }
      extraSwatches = loadSwatches(session.modelId);
      restoreHistory();
      host.setAutoRotate(false);
      host.setLayout(true, false);
      claimLeftButton();
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onWindowBlur);
      gizmoMode = "none";
      // Re-mesh everything in chunks right away (one cost at entry), so the
      // first stroke on a big part is as cheap as every other one.
      partSignatures.clear();
      needsRebuild = true;
      syncSelectionGlow();
      syncGizmo();
      renderAll();
      host.onStats(`${session.size} cells · ${targetRig.meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0)} triangles · ${session.dirty ? "unsaved edits" : "matches catalog"} · editing`);
    },
    close() {
      if (!session) return;
      if (persistTimer) { clearTimeout(persistTimer); persistHistory(); }
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      releaseLeftButton();
      clearPreview();
      closeTidy();
      chunkCache.clear();
      for (const mesh of partHighlight) mesh.dispose(false, false);
      for (const mesh of socketMarkers) mesh.dispose(false, false);
      partHighlight = []; socketMarkers.length = 0; partHighlightSignature = "";
      jointMarker.setEnabled(false);
      jointMarker.parent = null;
      regionCache.clear();
      closeContextMenu();
      selectedParts.clear();
      highlight.removeAllMeshes();
      positionGizmo.attachedNode = null; rotationGizmo.attachedNode = null; scaleGizmo.attachedNode = null; gizmoNode = null; gizmoMode = "none";
      groupNode?.dispose(); groupNode = null; groupCenter = null;
      if (rig) poseRig(rig, new Map());
      panels.left.innerHTML = ""; panels.right.innerHTML = ""; panels.bottom.innerHTML = ""; panels.modes.innerHTML = "";
      host.setLayout(false, false);
      session = null; rig = null; player = null; lastHit = null; painting = false; keyDrag = null; scrubbing = false;
    },
    dropCell(clientX, clientY) {
      if (!session || !rig) return null;
      const fake = { clientX, clientY } as PointerEvent;
      const hit = pickCell(fake, true);
      return hit ? { cell: hit.ground ? hit.cell : hit.outside, part: hit.ground ? null : hit.part } : null;
    },
    mergeModel(source, at, attachTo) {
      if (!session) return 0;
      const donor = new VoxelEditSession(source);
      const ratio = source.pitch / session.pitch;
      // Pre-scale the donor in its own space so it arrives at this model's voxel size.
      const donorRoots = donor.parts.filter((part) => !donor.partMeta(part)?.parent);
      if (Math.abs(ratio - 1) > 1e-6) { donor.beginStroke(); donor.transformParts(donorRoots, { scale: ratio }, { x: 0, y: 0, z: 0 }); donor.endStroke(); }
      const rootPivot = donorRoots[0] ? donor.partMeta(donorRoots[0])!.pivot : [0, 0, 0];
      const offset = at ? { x: at.x - rootPivot[0], y: at.y - rootPivot[1], z: at.z - rootPivot[2] } : { x: 0, y: 0, z: 0 };
      const clips = new Map<string, PartClipboard>();
      for (const part of donor.parts) { const clip = donor.copyPart(part); if (clip && clip.cells.length) clips.set(part, clip); }
      // Parts keep their own cells, so the donor may overlap the model freely.
      const lift = 0;
      const idMap = new Map<string, string>();
      let added = 0;
      session.beginStroke();
      for (const [part, clip] of clips) {
        let id = `${source.id}_${part}`;
        for (let n = 2; session.parts.includes(id); n++) id = `${source.id}_${part}_${n}`;
        if (!session.pastePart(clip, id, { x: clip.pivot[0] + offset.x, y: clip.pivot[1] + offset.y + lift, z: clip.pivot[2] + offset.z })) continue;
        idMap.set(part, id);
        added++;
      }
      // Second pass: the donor's own hierarchy, then its roots hang from the drop target.
      for (const [part, id] of idMap) {
        const parent = donor.partMeta(part)?.parent;
        if (parent && idMap.has(parent)) session.setParent(id, idMap.get(parent)!);
        else if (attachTo && session.parts.includes(attachTo)) session.setParent(id, attachTo);
      }
      session.endStroke();
      const roots = [...idMap.values()].filter((id) => { const parent = session!.partMeta(id)?.parent; return !parent || !idMap.has(parent) && ![...idMap.values()].includes(parent); });
      activePart = roots[0] ?? idMap.values().next().value ?? activePart;
      selectedParts.clear();
      if (activePart) selectedParts.add(activePart);
      statusText = `Merged ${added} part(s) from ${source.id} with their hierarchy${at ? ` at (${at.x}, ${at.y + lift}, ${at.z})` : ""}${attachTo ? `, attached to ${attachTo}` : ""}${Math.abs(ratio - 1) > 1e-6 ? ` (rescaled ×${ratio.toFixed(2)} to this model's voxel size)` : ""}`;
      markChanged();
      return added;
    },
    update(dt) {
      if (needsRebuild && session && rig) { needsRebuild = false; rebuild(); }
      if (player?.playing && mode === "animate") {
        player.update(dt);
        scrubTime = player.time;
        syncSessionStates();
        refreshPlayhead();
        if (!player.playing) renderBottom();
      }
      if (previewMeshes.length) previewMaterial.alpha = 0.42 + 0.3 * (0.5 + 0.5 * Math.sin((performance.now() / 1000) * 7));
    },
  };
  return editor;
}

function cssEscape(value: string): string { return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&"); }
function round(value: number, digits: number): number { const f = 10 ** digits; return Math.round(value * f) / f; }
function readFlag(key: string, fallback: boolean): boolean {
  try { const raw = window.localStorage.getItem(key); return raw === null ? fallback : raw !== "0"; } catch { return fallback; }
}
function storeFlag(key: string, value: boolean): void { try { window.localStorage.setItem(key, value ? "1" : "0"); } catch { /* ignore */ } }
function readKeyClipboard(): KeyClipboard | null {
  try { const raw = window.localStorage.getItem(KEY_CLIPBOARD_KEY); return raw ? (JSON.parse(raw) as KeyClipboard) : null; } catch { return null; }
}
function readClipboard(): PartClipboard | null {
  try { const raw = window.localStorage.getItem(CLIPBOARD_KEY); return raw ? (JSON.parse(raw) as PartClipboard) : null; } catch { return null; }
}
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
