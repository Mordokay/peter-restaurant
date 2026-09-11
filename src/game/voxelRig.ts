import { Color3, Mesh, PointLight, Scene, ShadowGenerator, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import { createBlendVoxelMesh, createVoxelMaterial, createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { emissiveByHex, glowInfoOf, glowMaterialFor, splitGlowCells, tagGlow } from "./lighting.ts";
import type { StandardMaterial } from "@babylonjs/core";
import { cellsOfPartState, partStateNames, type AuthoredClip, type AuthoredVoxelModel, type ClipEvent } from "./voxelModel.ts";
import { applyPoseOffsets, blendWeight, ease, eventsBetween, matchClipTime, poseOffsets, REST_POSE, sampleClip, type PartPose, type PoseOffset, type StateTransitionSample } from "./voxelClips.ts";

// Rigged voxel model at runtime: one rigid mesh per part, each hanging from a
// TransformNode placed at the part's pivot (its joint) and parented to its
// parent part's node. Rotating a node turns the whole subtree around that
// joint — an upper arm carries forearm, hand and knife — while every part
// stays a crisp block. No skinning, no stretched voxels (ART_DIRECTION).

export interface RigPart {
  id: string;
  node: TransformNode;
  mesh: Mesh | null;
  /** Every mesh of the part (all states; the editor splits big parts into chunks); `mesh` is the first. */
  meshes: Mesh[];
  /** Meshes per voxel state ("base" + the part's named snapshots); only the shown state is enabled. */
  stateMeshes: Map<string, Mesh[]>;
  /** State currently shown. */
  state: string;
  /** Lazily built meshes for animated state switches, keyed "from>to|direction". */
  transitions: Map<string, TransitionSet>;
  /** Translucent clone of the rig material while `opacity` < 1 in fade mode. */
  fadeMaterial: StandardMaterial | null;
  /** Current opacity applied (1 = the shared opaque material). */
  opacity: number;
  /** Opacity with no clip playing, from the part's rest transform. */
  restOpacity: number;
  /** Dither meshes per state: voxels drop out in a fixed order as opacity falls. */
  dither: Map<string, { cells: (VoxelCell & { order: number })[]; mesh: Mesh | null; shown: number }>;
  ditherActive: boolean;
  /** Pivot in world-scale units relative to the model root. */
  pivot: Vector3;
  /** Node position at rest (relative to its parent node), including the stored transform's offset. */
  restPosition: Vector3;
  /** Stored rest rotation (radians) and scale; poses compose on top. */
  restRotation: Vector3;
  restScale: Vector3;
}

/** Geometry of one animated switch between two voxel states of a part. */
export interface TransitionSet {
  root: TransformNode;
  /** Voxels in both states: colours crossfade. */
  common: { mesh: Mesh; colorsA: Float32Array; colorsB: Float32Array; buffer: Float32Array } | null;
  appearing: DeltaSet;
  vanishing: DeltaSet;
  pitch: number;
  material: StandardMaterial;
}
interface DeltaSet {
  cells: (VoxelCell & { order: number })[];
  node: TransformNode;
  mesh: Mesh | null;
  /** Cells currently meshed (dissolve rebuilds only when this changes). */
  shown: number;
  solid: (x: number, y: number, z: number) => boolean;
}

export interface VoxelRig {
  model: AuthoredVoxelModel;
  /** Placement node: put the rig somewhere by moving THIS. Clips never touch it. */
  anchor: TransformNode;
  /** Animated root ("*" track); child of `anchor`. */
  root: TransformNode;
  parts: Map<string, RigPart>;
  meshes: Mesh[];
  /** One shared material per rig; pass it to the next createVoxelRig to avoid re-preparing shaders. */
  material: StandardMaterial;
  /** Cells of a part's state in the part's grid (pivot not yet subtracted); transitions are built from these. */
  stateCells: (part: string, state: string) => VoxelCell[];
  /** PointLights created from model.lights when `lights: true` was requested (the lab preview). */
  lights: PointLight[];
  dispose(options?: { keepMaterial?: boolean }): void;
}

export function createVoxelRig(model: AuthoredVoxelModel, scene: Scene, options: { name?: string; shadows?: ShadowGenerator; receiveShadows?: boolean; material?: StandardMaterial; stateCells?: (part: string, state: string) => VoxelCell[]; lights?: boolean } = {}): VoxelRig {
  const name = options.name ?? `rig ${model.id}`;
  // Palette colours that glow: meshed apart, unlit, bloomed by the scene's GlowLayer.
  const glow = emissiveByHex(model);
  const stateCells = options.stateCells ?? ((part: string, state: string) => { const found = model.parts.find((candidate) => candidate.id === part); return found ? cellsOfPartState(model, found, state) : []; });
  const anchor = new TransformNode(`${name} anchor`, scene);
  const root = new TransformNode(name, scene);
  root.parent = anchor;
  const material = options.material ?? createVoxelMaterial(`${name} material`, scene);
  const parts = new Map<string, RigPart>();
  const meshes: Mesh[] = [];
  const byId = new Map(model.parts.map((part) => [part.id, part]));

  // Parents first: walk the hierarchy from roots down so every node's parent exists.
  const pending = [...model.parts];
  while (pending.length) {
    const before = pending.length;
    for (let i = 0; i < pending.length; i++) {
      const part = pending[i]!;
      const parentId = part.parent && byId.has(part.parent) ? part.parent : undefined;
      if (parentId && !parts.has(parentId)) continue;
      const pivot = new Vector3(part.pivot[0], part.pivot[1], part.pivot[2]).scale(model.pitch);
      const node = new TransformNode(`${name}.${part.id}`, scene);
      const parentRig = parentId ? parts.get(parentId)! : null;
      node.parent = parentRig ? parentRig.node : root;
      const stored = part.transform ?? {};
      const offset = new Vector3(...(stored.position ?? [0, 0, 0])).scale(model.pitch);
      const restPosition = (parentRig ? pivot.subtract(parentRig.pivot) : pivot.clone()).add(offset);
      const restRotation = new Vector3(...(stored.rotation ?? [0, 0, 0])).scale(Math.PI / 180);
      const restScale = new Vector3(...(stored.scale ?? [1, 1, 1]));
      const restOpacity = Math.min(1, Math.max(0, stored.opacity ?? 1));
      node.position.copyFrom(restPosition);
      node.rotation.copyFrom(restRotation);
      node.scaling.copyFrom(restScale);
      // One mesh per voxel state; only "base" is enabled until a clip key
      // switches it. Mesh vertices are relative to the pivot so node.rotation
      // turns the part around its joint.
      const stateMeshes = new Map<string, Mesh[]>();
      const own: Mesh[] = [];
      for (const state of partStateNames(part)) {
        const cells = cellsOfPartState(model, part, state);
        if (!cells.length) { stateMeshes.set(state, []); continue; }
        const local = cells.map((cell) => ({ x: cell.x - part.pivot[0], y: cell.y - part.pivot[1], z: cell.z - part.pivot[2], color: cell.color }));
        const { lit, glowing } = splitGlowCells(local, glow);
        const built: Mesh[] = [];
        if (lit.length || !glowing.length) {
          const mesh = createVoxelMesh(`${name}.${part.id}${state === "base" ? "" : `@${state}`} mesh`, lit, model.pitch, scene, { material });
          mesh.parent = node;
          mesh.receiveShadows = options.receiveShadows ?? true;
          options.shadows?.addShadowCaster(mesh);
          mesh.metadata = { rigPart: part.id, state };
          built.push(mesh);
        }
        if (glowing.length) {
          const glowMesh = createVoxelMesh(`${name}.${part.id}${state === "base" ? "" : `@${state}`} glow`, glowing, model.pitch, scene, { material: glowMaterialFor(scene) });
          glowMesh.parent = node;
          glowMesh.receiveShadows = false;
          glowMesh.metadata = { rigPart: part.id, state };
          tagGlow(glowMesh, glowInfoOf(glowing, glow));
          built.push(glowMesh);
        }
        for (const mesh of built) { mesh.setEnabled(state === "base"); own.push(mesh); meshes.push(mesh); }
        stateMeshes.set(state, built);
      }
      parts.set(part.id, { id: part.id, node, mesh: stateMeshes.get("base")?.[0] ?? null, meshes: own, stateMeshes, state: "base", transitions: new Map(), fadeMaterial: null, opacity: 1, restOpacity, dither: new Map(), ditherActive: false, pivot, restPosition, restRotation, restScale });
      pending.splice(i, 1);
      i--;
    }
    if (pending.length === before) {
      // Unknown or cyclic parents: attach the rest straight to the root.
      for (const part of pending) byId.set(part.id, { ...part, parent: undefined });
      pending.forEach((part, index) => { pending[index] = { ...part, parent: undefined }; });
    }
  }

  // A glass door is translucent standing still, so rest opacity applies before any clip runs.
  for (const part of parts.values()) if (part.restOpacity < 1) setRigPartOpacity({ model, anchor, root, parts, meshes, material } as VoxelRig, part, part.restOpacity);

  // Real point lights for a single rig on show (the lab); worlds use a light pool instead.
  const lights: PointLight[] = [];
  if (options.lights) {
    for (const [index, spec] of (model.lights ?? []).entries()) {
      const light = new PointLight(`${name} light ${index}`, new Vector3(spec.position[0] * model.pitch, spec.position[1] * model.pitch, spec.position[2] * model.pitch), scene);
      light.parent = root;
      const colour = Color3.FromHexString(spec.color ?? "#ffd9a0");
      light.diffuse.copyFrom(colour); light.specular.copyFrom(colour).scaleInPlace(0.3);
      light.intensity = spec.intensity ?? 1;
      light.range = spec.range ?? 7;
      light.falloffType = PointLight.FALLOFF_DEFAULT; // linear fade to `range`: a soft pool, not an inverse-square blowout
      // A gated light only burns while its part shows the named state (the freezer lamp and its door).
      if (spec.whenState) light.metadata = { gate: spec.whenState };
      lights.push(light);
    }
  }
  const rig: VoxelRig = {
    model, anchor, root, parts, meshes, material, stateCells, lights,
    dispose(disposeOptions = {}) {
      for (const mesh of meshes) { options.shadows?.removeShadowCaster(mesh); mesh.dispose(false, false); }
      for (const part of parts.values()) part.fadeMaterial?.dispose();
      for (const light of lights) light.dispose();
      root.dispose(false, false);
      anchor.dispose(false, false);
      if (!disposeOptions.keepMaterial) material.dispose();
    },
  };
  syncGatedLights(rig);
  return rig;
}

/** Show one voxel state of a part (unknown names fall back to "base"). */
export function setRigPartState(part: RigPart, state: string): void {
  for (const set of part.transitions.values()) set.root.setEnabled(false);
  const chosen = part.stateMeshes.has(state) ? state : "base";
  if (chosen === part.state) return;
  part.state = chosen;
  for (const [name, list] of part.stateMeshes) for (const mesh of list) mesh.setEnabled(name === chosen && !part.ditherActive);
}

// --------------------------------------------------------------- opacity --
// "fade": the part's meshes swap to a translucent clone of the rig material
// (alpha blend + depth pre-pass so a part's own cubes do not show through
// each other) and back to the shared one at 1. "dither": no blending — the
// part's voxels drop out in a fixed pseudo-random order as opacity falls, so
// half opacity shows half the cubes, all crisp and opaque (voxel-native).
const DITHER_STEPS = 32;

function fadeMaterialFor(rig: VoxelRig, part: RigPart): StandardMaterial {
  if (part.fadeMaterial) return part.fadeMaterial;
  const material = rig.material.clone(`${part.node.name} fade material`);
  material.transparencyMode = 2; // alpha blend
  material.needDepthPrePass = true;
  material.backFaceCulling = true;
  part.fadeMaterial = material;
  return material;
}

/** Every mesh currently rendering the part (state meshes and transition sets). */
function renderMeshes(part: RigPart): Mesh[] {
  const out = [...part.meshes];
  for (const set of part.transitions.values()) {
    if (set.common) out.push(set.common.mesh);
    if (set.appearing.mesh) out.push(set.appearing.mesh);
    if (set.vanishing.mesh) out.push(set.vanishing.mesh);
  }
  for (const entry of part.dither.values()) if (entry.mesh) out.push(entry.mesh);
  return out;
}

function ditherEntry(rig: VoxelRig, part: RigPart, state: string) {
  let entry = part.dither.get(state);
  if (entry) return entry;
  const authored = rig.model.parts.find((candidate) => candidate.id === part.id);
  const pivot = authored?.pivot ?? [0, 0, 0];
  const cells = rig.stateCells(part.id, state).map((cell) => ({ x: cell.x - pivot[0], y: cell.y - pivot[1], z: cell.z - pivot[2], color: cell.color, order: hash01(cell.x, cell.y, cell.z) }));
  entry = { cells, mesh: null, shown: -1 };
  part.dither.set(state, entry);
  return entry;
}

/** Apply a pose's opacity to a part: 1 restores the shared material and full geometry. */
export function setRigPartOpacity(rig: VoxelRig, part: RigPart, opacity: number, mode: "fade" | "dither" = "fade"): void {
  const value = Math.min(1, Math.max(0, opacity));
  const quantized = mode === "dither" ? Math.round(value * DITHER_STEPS) / DITHER_STEPS : value;
  if (quantized === part.opacity && (mode === "dither") === part.ditherActive) return;
  // Leave the previous mode's effects first.
  if (part.ditherActive && (mode !== "dither" || quantized >= 1)) {
    for (const entry of part.dither.values()) entry.mesh?.setEnabled(false);
    part.ditherActive = false;
    for (const [name, list] of part.stateMeshes) for (const mesh of list) mesh.setEnabled(name === part.state);
  }
  if (part.fadeMaterial && (mode !== "fade" || quantized >= 1)) {
    for (const mesh of renderMeshes(part)) if (mesh.material === part.fadeMaterial) mesh.material = rig.material;
  }
  part.opacity = quantized;
  if (quantized >= 1) return;
  if (mode === "fade") {
    const material = fadeMaterialFor(rig, part);
    material.alpha = quantized;
    for (const mesh of renderMeshes(part)) mesh.material = material;
    return;
  }
  // dither: swap the shown state's meshes for a partial mesh
  const state = part.state || "base";
  const entry = ditherEntry(rig, part, state);
  const shownCells = entry.cells.filter((cell) => cell.order < quantized);
  if (shownCells.length !== entry.shown) {
    entry.mesh?.dispose(false, false);
    entry.mesh = null;
    entry.shown = shownCells.length;
    if (shownCells.length) {
      const own = new Set(shownCells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
      const mesh = createVoxelMesh(`${part.node.name} dither ${state}`, shownCells, rig.model.pitch, rig.root.getScene(), { material: rig.material, solid: (x, y, z) => own.has(`${x},${y},${z}`) });
      mesh.parent = part.node;
      mesh.metadata = { rigPart: part.id, state, dither: true };
      entry.mesh = mesh;
    }
  }
  for (const [name, other] of part.dither) if (name !== state) other.mesh?.setEnabled(false);
  entry.mesh?.setEnabled(true);
  for (const list of part.stateMeshes.values()) for (const mesh of list) mesh.setEnabled(false);
  part.ditherActive = true;
}

// ----------------------------------------------------------- transitions --
// A switch between two voxel states is animated instead of cut: voxels both
// states share crossfade their colours; voxels only in the new state appear
// and voxels only in the old one vanish — dissolving in an order (random or a
// wave along an axis) or popping (scaling) in/out. Geometry per (from, to)
// pair is built once per rig part and reused.

const hash01 = (x: number, y: number, z: number): number => {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x79b9, 0xc2b2ae35) ^ Math.imul(z + 0x7f4a, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function orderCells(cells: VoxelCell[], direction: StateTransitionSample["direction"]): (VoxelCell & { order: number })[] {
  if (direction === "random" || cells.length === 0) return cells.map((cell) => ({ ...cell, order: hash01(cell.x, cell.y, cell.z) }));
  const axis = direction[1] as "x" | "y" | "z";
  const sign = direction[0] === "+" ? 1 : -1;
  const values = cells.map((cell) => cell[axis] * sign);
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(1, max - min);
  // A little jitter keeps a wave front from looking like a hard slice.
  return cells.map((cell, index) => ({ ...cell, order: Math.min(0.999, Math.max(0, (values[index]! - min) / span * 0.85 + hash01(cell.x, cell.y, cell.z) * 0.15)) }));
}

function transitionSet(rig: VoxelRig, part: RigPart, sample: StateTransitionSample): TransitionSet {
  const key = `${sample.from}>${sample.to}|${sample.mode === "blend" ? sample.direction : "pop"}`;
  const cached = part.transitions.get(key);
  if (cached) return cached;
  const authored = rig.model.parts.find((candidate) => candidate.id === part.id);
  const pivot = authored?.pivot ?? [0, 0, 0];
  const local = (cell: VoxelCell): VoxelCell => ({ x: cell.x - pivot[0], y: cell.y - pivot[1], z: cell.z - pivot[2], color: cell.color });
  const a = new Map(rig.stateCells(part.id, sample.from).map(local).map((cell) => [`${cell.x},${cell.y},${cell.z}`, cell]));
  const b = new Map(rig.stateCells(part.id, sample.to).map(local).map((cell) => [`${cell.x},${cell.y},${cell.z}`, cell]));
  const commonCells: { x: number; y: number; z: number; colorA: string; colorB: string }[] = [];
  const appearing: VoxelCell[] = [];
  const vanishing: VoxelCell[] = [];
  for (const [k, cell] of a) { const other = b.get(k); if (other) commonCells.push({ x: cell.x, y: cell.y, z: cell.z, colorA: cell.color, colorB: other.color }); else vanishing.push(cell); }
  for (const [k, cell] of b) if (!a.has(k)) appearing.push(cell);
  const commonKeys = new Set(commonCells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  const scene = rig.root.getScene();
  const root = new TransformNode(`${part.node.name} transition ${key}`, scene);
  root.parent = part.node;
  const pitch = rig.model.pitch;
  let common: TransitionSet["common"] = null;
  if (commonCells.length) {
    const built = createBlendVoxelMesh(`${root.name} common`, commonCells, pitch, scene, { material: rig.material, solid: (x, y, z) => commonKeys.has(`${x},${y},${z}`) });
    built.mesh.parent = root;
    built.mesh.metadata = { rigPart: part.id, transition: true };
    common = { ...built, buffer: new Float32Array(built.colorsA) };
  }
  const delta = (cells: VoxelCell[], label: string): DeltaSet => {
    const own = new Set(cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
    const node = new TransformNode(`${root.name} ${label}`, scene);
    node.parent = root;
    // Pop scales around the delta's own centre.
    if (cells.length) {
      const centre = cells.reduce((acc, cell) => acc.addInPlace(new Vector3(cell.x, cell.y, cell.z)), new Vector3()).scaleInPlace(pitch / cells.length);
      node.position.copyFrom(centre);
    }
    return { cells: orderCells(cells, sample.direction), node, mesh: null, shown: -1, solid: (x, y, z) => own.has(`${x},${y},${z}`) || commonKeys.has(`${x},${y},${z}`) };
  };
  const set: TransitionSet = { root, common, appearing: delta(appearing, "appearing"), vanishing: delta(vanishing, "vanishing"), pitch, material: rig.material };
  part.transitions.set(key, set);
  return set;
}

function meshDelta(set: TransitionSet, delta: DeltaSet, cells: VoxelCell[], partId: string): void {
  delta.mesh?.dispose(false, false);
  delta.mesh = null;
  delta.shown = cells.length;
  if (!cells.length) return;
  const scene = set.root.getScene();
  const shifted = cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, color: cell.color }));
  const mesh = createVoxelMesh(`${delta.node.name} mesh`, shifted, set.pitch, scene, { material: set.material, solid: delta.solid });
  // The node sits at the delta's centre so pop scaling happens around it.
  mesh.position.copyFrom(delta.node.position.scale(-1));
  mesh.parent = delta.node;
  mesh.metadata = { rigPart: partId, transition: true };
  delta.mesh = mesh;
}

/** Drive a part's animated state switch at `sample.progress`. */
export function showTransition(rig: VoxelRig, part: RigPart, sample: StateTransitionSample): void {
  const set = transitionSet(rig, part, sample);
  for (const list of part.stateMeshes.values()) for (const mesh of list) mesh.setEnabled(false);
  for (const other of part.transitions.values()) if (other !== set) other.root.setEnabled(false);
  part.state = "";
  set.root.setEnabled(true);
  const p = Math.min(1, Math.max(0, sample.progress));
  if (set.common) {
    const { colorsA, colorsB, buffer, mesh } = set.common;
    for (let i = 0; i < buffer.length; i++) buffer[i] = colorsA[i]! + (colorsB[i]! - colorsA[i]!) * p;
    mesh.updateVerticesData(VertexBuffer.ColorKind, buffer);
  }
  if (sample.mode === "pop") {
    if (set.appearing.shown !== set.appearing.cells.length) meshDelta(set, set.appearing, set.appearing.cells, part.id);
    if (set.vanishing.shown !== set.vanishing.cells.length) meshDelta(set, set.vanishing, set.vanishing.cells, part.id);
    const grow = Math.max(0.001, ease("back", p));
    const shrink = Math.max(0.001, 1 - ease("in", p));
    set.appearing.node.scaling.setAll(grow);
    set.vanishing.node.scaling.setAll(shrink);
    set.appearing.node.setEnabled(p > 0);
    set.vanishing.node.setEnabled(p < 1);
  } else {
    set.appearing.node.scaling.setAll(1);
    set.vanishing.node.scaling.setAll(1);
    set.appearing.node.setEnabled(true);
    set.vanishing.node.setEnabled(true);
    const shownAppearing = set.appearing.cells.filter((cell) => cell.order <= p);
    const shownVanishing = set.vanishing.cells.filter((cell) => cell.order > p);
    if (shownAppearing.length !== set.appearing.shown) meshDelta(set, set.appearing, shownAppearing, part.id);
    if (shownVanishing.length !== set.vanishing.shown) meshDelta(set, set.vanishing, shownVanishing, part.id);
  }
}

/** Apply a sampled pose: parts not mentioned return to rest. "*" drives the
 * root. `stateFor` lets an editor pin a voxel state regardless of the pose. */
export function poseRig(rig: VoxelRig, poses: Map<string, PartPose>, options: { stateFor?: (part: string) => string | undefined } = {}): void {
  const pitch = rig.model.pitch;
  const apply = (node: TransformNode, rest: Vector3, restRotation: Vector3, restScale: Vector3, pose: PartPose) => {
    node.rotation.set(restRotation.x + pose.rotation[0] * Math.PI / 180, restRotation.y + pose.rotation[1] * Math.PI / 180, restRotation.z + pose.rotation[2] * Math.PI / 180);
    node.position.set(rest.x + pose.position[0] * pitch, rest.y + pose.position[1] * pitch, rest.z + pose.position[2] * pitch);
    node.scaling.set(restScale.x * pose.scale[0], restScale.y * pose.scale[1], restScale.z * pose.scale[2]);
  };
  for (const part of rig.parts.values()) {
    const pose = poses.get(part.id) ?? REST_POSE;
    apply(part.node, part.restPosition, part.restRotation, part.restScale, pose);
    const pinned = options.stateFor?.(part.id);
    if (pinned === undefined && pose.transition) showTransition(rig, part, pose.transition);
    else setRigPartState(part, pinned ?? pose.state ?? "base");
    // A clip's opacity multiplies the part's rest opacity, so glass stays glass while a clip fades it.
    setRigPartOpacity(rig, part, part.restOpacity * (pose.opacity ?? 1), pose.fade ?? "fade");
  }
  apply(rig.root, Vector3.Zero(), Vector3.Zero(), Vector3.One(), poses.get("*") ?? REST_POSE);
  syncGatedLights(rig);
}

/** Switch gated lights to match the states their parts are showing. */
export function syncGatedLights(rig: VoxelRig): void {
  for (const light of rig.lights) {
    const gate = (light.metadata as { gate?: { part: string; state: string } } | null)?.gate;
    if (!gate) continue;
    const wanted = rig.parts.get(gate.part)?.state === gate.state;
    if (light.isEnabled() !== wanted) light.setEnabled(wanted);
  }
}

/** A TransformNode sitting on a part's socket cell; attach tools and props to it. */
export function socketNode(rig: VoxelRig, partId: string, socket: string): TransformNode | null {
  const part = rig.model.parts.find((candidate) => candidate.id === partId);
  const rigPart = rig.parts.get(partId);
  const cell = part?.sockets?.[socket];
  if (!part || !rigPart || !cell) return null;
  const node = new TransformNode(`${rig.root.name}.${partId}.${socket}`, rig.root.getScene());
  node.parent = rigPart.node;
  node.position.set((cell[0] - part.pivot[0]) * rig.model.pitch, (cell[1] - part.pivot[1]) * rig.model.pitch, (cell[2] - part.pivot[2]) * rig.model.pitch);
  return node;
}

export interface ClipPlayer {
  readonly clip: AuthoredClip | null;
  readonly time: number;
  readonly playing: boolean;
  readonly finished: boolean;
  /** True while a switch from another clip is still easing out. */
  readonly blending: boolean;
  /** `match`: start at the time in the new clip closest to the pose we are in
   *  (default: on when another clip is playing and no `from` is given).
   *  `blend`: seconds to ease out whatever difference the match left. */
  play(clipId: string, options?: { loop?: boolean; from?: number; match?: boolean; blend?: number }): boolean;
  /** Scrub to a time without advancing (editor timeline). */
  seek(t: number): void;
  pause(): void;
  stop(): void;
  update(dt: number): void;
}

/** Seconds to ease out the leftover difference when one clip interrupts another. */
export const DEFAULT_CLIP_BLEND = 0.14;

export function createClipPlayer(rig: VoxelRig, options: { onEvent?: (event: ClipEvent, clip: AuthoredClip) => void } = {}): ClipPlayer {
  let clip: AuthoredClip | null = null;
  let time = 0;
  let playing = false;
  let finished = false;
  // The step the switch would have shown, decaying to nothing over `blendDuration`.
  let offsets: Map<string, PoseOffset> | null = null;
  let blendDuration = 0;
  let blendElapsed = 0;
  const apply = () => {
    if (!clip) return;
    const poses = sampleClip(clip, time);
    if (!offsets) { poseRig(rig, poses); return; }
    const weight = blendWeight(blendElapsed, blendDuration);
    if (weight <= 1e-4) { offsets = null; poseRig(rig, poses); return; }
    poseRig(rig, applyPoseOffsets(poses, offsets, weight));
  };
  return {
    get clip() { return clip; },
    get time() { return time; },
    get playing() { return playing; },
    get finished() { return finished; },
    get blending() { return offsets !== null; },
    play(clipId, playOptions = {}) {
      const found = rig.model.clips?.find((candidate) => candidate.id === clipId);
      if (!found) return false;
      // Where we are standing right now, before anything changes.
      const standing = clip ? sampleClip(clip, time) : null;
      const interrupting = standing !== null && (clip!.id !== found.id || playing);
      clip = playOptions.loop === undefined ? found : { ...found, loop: playOptions.loop };
      const matching = playOptions.match ?? (interrupting && playOptions.from === undefined);
      time = playOptions.from ?? (matching && standing ? matchClipTime(found, standing) : 0);
      offsets = null;
      blendDuration = playOptions.blend ?? (standing ? DEFAULT_CLIP_BLEND : 0);
      blendElapsed = 0;
      if (standing && blendDuration > 0) {
        const landing = poseOffsets(standing, sampleClip(found, time));
        if (landing.size) offsets = landing;
      }
      playing = true;
      finished = false;
      apply();
      // Events sitting exactly at t=0 belong to the first update window.
      return true;
    },
    seek(t) {
      if (!clip) return;
      time = clip.loop ? t : Math.min(clip.duration, Math.max(0, t));
      offsets = null;
      apply();
    },
    pause() { playing = false; },
    stop() {
      playing = false;
      finished = false;
      clip = null;
      offsets = null;
      poseRig(rig, new Map());
    },
    update(dt) {
      if (!clip || !playing || dt <= 0) return;
      const previous = time;
      time += dt;
      if (offsets) blendElapsed += dt;
      for (const event of eventsBetween(clip, previous, time)) options.onEvent?.(event, clip);
      if (!clip.loop && time >= clip.duration) {
        time = clip.duration;
        playing = false;
        finished = true;
      }
      apply();
    },
  };
}
