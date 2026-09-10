import { TransformNode, type AbstractMesh, type Scene, type ShadowGenerator } from "@babylonjs/core";
import type { AuthoredVoxelCatalog, AuthoredVoxelModel } from "./voxelModel";
import { createClipPlayer, createVoxelRig, type ClipPlayer, type VoxelRig } from "./voxelRig";
import { modelLightPositions, type LightPool } from "./lighting";
import { createWorldRenderer, type WorldInstance, type WorldRenderer } from "./worldRenderer";
import { propRotation, propScale, propVisible, type DecorLayout, type DecorProp } from "./decorLayout";
export { validateDecorLayout, propRotation, propScale, propVisible, type DecorGroup, type DecorLayout, type DecorProp } from "./decorLayout";

// Decor: catalog models placed in the game world by hand (vases, spoons, crates,
// a mural prop) — the human-crafted layer on top of the coded scene. The layout
// is data (src/assets/scene/decor.json), edited in the game's decorate mode and
// loaded here at startup.
//
// Two ways to draw a prop. Most props never move: they are *instances* of the
// world renderer (one merged mesh per model, hardware instancing, LOD, culling),
// which is what lets a compound hold thousands of them. A prop becomes a real
// voxel *rig* only while it needs to be one: it plays a looping clip, it is
// reacting to the player, or decorate mode has it pinned (selected, dragged, or
// the ghost being placed). It drops back to an instance when that ends.

export interface PlacedProp {
  prop: DecorProp;
  /** The rig while the prop is animated, reacting or pinned; null for a world-renderer instance. */
  rig: VoxelRig | null;
  player: ClipPlayer | null;
  /** Ids this prop's lights hold in the scene's light pool (rig mode; instances register through the renderer). */
  lightIds?: string[];
  /** Placement node: the rig's anchor, or a plain node mirroring the record for an instance. */
  root: TransformNode;
  /** Looping clip to return to after an interaction (undefined = still). */
  idleClip?: string;
  /** An interaction clip is playing; when it ends the idle clip resumes. */
  reacting: boolean;
  /** Decorate mode holds this prop as a rig (gizmos, highlight, drag). */
  pinned: boolean;
  /** Meshes drawing this prop right now: the rig's part meshes or the single instance. */
  meshes(): AbstractMesh[];
}

export interface DecorScene {
  readonly placed: Map<string, PlacedProp>;
  /** Place a prop (or replace the one with the same id). */
  add(prop: DecorProp): PlacedProp | null;
  remove(id: string): void;
  /** Re-read position/rotation/scale from the prop record. */
  refresh(id: string): void;
  /** Re-apply hidden flags of props and groups. */
  refreshVisibility(): void;
  /** Keep a prop as a rig (true) or let it fall back to an instance when idle (false). */
  pin(id: string, pinned: boolean): void;
  /** Meshes of one prop (empty when unknown). */
  meshesOf(id: string): AbstractMesh[];
  /** Every prop mesh a ray may hit. */
  pickables(): AbstractMesh[];
  /** Play the prop's interaction clip once (returns false when it has none). */
  trigger(id: string): boolean;
  /** Closest prop with an interaction clip within `reach` metres of a point, or null. */
  nearestInteractive(position: { x: number; z: number }, reach: number): PlacedProp | null;
  update(dt: number): void;
  /** The world renderer behind the static props (stats, tuning). */
  readonly renderer: WorldRenderer;
  dispose(): void;
}

/** Position, yaw and scale from the record onto the placement node. */
export function applyPropTransform(placed: PlacedProp): void {
  const { prop, root } = placed;
  root.position.set(prop.position[0], prop.position[1], prop.position[2]);
  const [rx, ry, rz] = propRotation(prop);
  root.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180);
  const [sx, sy, sz] = propScale(prop);
  root.scaling.set(sx, sy, sz);
}

/** The record as a world-renderer placement. */
function toInstance(prop: DecorProp): WorldInstance {
  const [sx, sy, sz] = propScale(prop);
  return { id: prop.id, model: prop.model, position: prop.position, rotation: propRotation(prop), scale: sx === sy && sy === sz ? sx : [sx, sy, sz] };
}

export function createDecorScene(scene: Scene, catalog: AuthoredVoxelCatalog, layout: DecorLayout, options: { shadows?: ShadowGenerator; lightPool?: LightPool; cacheRev?: (modelId: string) => number | undefined } = {}): DecorScene {
  const placed = new Map<string, PlacedProp>();
  const renderer = createWorldRenderer(scene, { name: "decor", shadows: options.shadows, lightPool: options.lightPool, receiveShadows: true, cacheRev: options.cacheRev });

  /** A prop needs a rig while it animates, reacts, is pinned, or is the editor's ghost. */
  const wantsRig = (entry: PlacedProp): boolean => entry.pinned || entry.reacting || entry.idleClip !== undefined || entry.prop.id.startsWith("__");

  /** (Re)register a rig prop's point lights at its current world position. */
  const syncLights = (entry: PlacedProp): void => {
    const pool = options.lightPool;
    if (!pool) return;
    for (const id of entry.lightIds ?? []) pool.unregister(id);
    entry.lightIds = [];
    if (!entry.rig?.model.lights?.length || !entry.root.isEnabled()) return;
    entry.root.computeWorldMatrix(true);
    modelLightPositions(entry.rig.model, entry.root.getWorldMatrix()).forEach((light, index) => { const id = `${entry.prop.id}#${index}`; pool.register(id, light.position, light.spec); entry.lightIds!.push(id); });
  };
  const dropLights = (entry: PlacedProp | undefined): void => { if (!entry) return; for (const id of entry.lightIds ?? []) options.lightPool?.unregister(id); entry.lightIds = []; };

  /** Draw the prop as a world-renderer instance (disposing a rig it may have). */
  const asInstance = (entry: PlacedProp, model: AuthoredVoxelModel): void => {
    if (entry.rig) {
      dropLights(entry);
      entry.rig.dispose();
      entry.rig = null;
      entry.player = null;
      entry.root = new TransformNode(`decor ${entry.prop.id} anchor`, scene);
    }
    applyPropTransform(entry);
    if (!propVisible(entry.prop, layout)) { renderer.remove(entry.prop.id); return; }
    renderer.upsert(toInstance(entry.prop), model);
    const mesh = renderer.meshOf(entry.prop.id);
    if (mesh) mesh.metadata = { ...((mesh.metadata as Record<string, unknown> | null) ?? {}), decorId: entry.prop.id };
  };
  /** Draw the prop as a rig (its clips can play, gizmos can grab its anchor). */
  const asRig = (entry: PlacedProp, model: AuthoredVoxelModel): void => {
    renderer.remove(entry.prop.id);
    if (!entry.rig) {
      entry.root.dispose();
      const rig = createVoxelRig(model, scene, { name: `decor ${entry.prop.id}`, shadows: options.shadows });
      for (const mesh of rig.meshes) mesh.metadata = { ...((mesh.metadata as Record<string, unknown> | null) ?? {}), decorId: entry.prop.id };
      entry.rig = rig;
      entry.player = createClipPlayer(rig);
      entry.root = rig.anchor;
      if (entry.idleClip && !entry.reacting) entry.player.play(entry.idleClip, { loop: true });
    }
    applyPropTransform(entry);
    entry.root.setEnabled(propVisible(entry.prop, layout));
    syncLights(entry);
  };
  /** Put the prop in whichever form it needs right now. */
  const sync = (entry: PlacedProp): void => {
    const model = catalog.models[entry.prop.model];
    if (!model) return;
    if (wantsRig(entry)) asRig(entry, model); else asInstance(entry, model);
  };

  const place = (prop: DecorProp): PlacedProp | null => {
    const model = catalog.models[prop.model];
    if (!model) return null;
    const previous = placed.get(prop.id);
    if (previous) { dropLights(previous); previous.rig?.dispose(); previous.root.dispose(); renderer.remove(prop.id); }
    const clipId = prop.clip === undefined ? model.clips?.find((clip) => clip.loop)?.id : prop.clip;
    const entry: PlacedProp = {
      prop, rig: null, player: null, root: new TransformNode(`decor ${prop.id} anchor`, scene), idleClip: clipId ?? undefined, reacting: false, pinned: previous?.pinned ?? false,
      meshes() { if (this.rig) return this.rig.meshes; const mesh = renderer.meshOf(this.prop.id); return mesh ? [mesh] : []; },
    };
    placed.set(prop.id, entry);
    sync(entry);
    return entry;
  };
  for (const prop of layout.props) place(prop);
  return {
    placed,
    renderer,
    add: place,
    remove(id) { const entry = placed.get(id); if (!entry) return; dropLights(entry); entry.rig?.dispose(); entry.root.dispose(); renderer.remove(id); placed.delete(id); },
    refresh(id) {
      const entry = placed.get(id);
      if (!entry) return;
      applyPropTransform(entry);
      if (entry.rig) syncLights(entry); else sync(entry);
    },
    refreshVisibility() { for (const entry of placed.values()) { if (entry.rig) { entry.root.setEnabled(propVisible(entry.prop, layout)); syncLights(entry); } else sync(entry); } },
    pin(id, pinned) { const entry = placed.get(id); if (entry && entry.pinned !== pinned) { entry.pinned = pinned; sync(entry); } },
    meshesOf(id) { return placed.get(id)?.meshes() ?? []; },
    pickables() { return [...placed.values()].flatMap((entry) => entry.meshes()); },
    trigger(id) {
      const entry = placed.get(id);
      if (!entry?.prop.interactClip) return false;
      entry.reacting = true;
      sync(entry); // a rig now, if it was an instance
      if (!entry.player?.play(entry.prop.interactClip, { loop: false })) { entry.reacting = false; sync(entry); return false; }
      return true;
    },
    nearestInteractive(position, reach) {
      let best: PlacedProp | null = null;
      let bestDistance = reach * reach;
      for (const entry of placed.values()) {
        if (!entry.prop.interactClip || !propVisible(entry.prop, layout)) continue;
        const dx = entry.prop.position[0] - position.x, dz = entry.prop.position[2] - position.z;
        const d = dx * dx + dz * dz;
        if (d <= bestDistance) { best = entry; bestDistance = d; }
      }
      return best;
    },
    update(dt) {
      for (const entry of placed.values()) {
        if (!entry.player) continue;
        entry.player.update(dt);
        if (entry.reacting && entry.player.finished) {
          entry.reacting = false;
          if (entry.idleClip) entry.player.play(entry.idleClip, { loop: true });
          else { entry.player.stop(); sync(entry); } // back to an instance unless pinned
        }
      }
    },
    dispose() { for (const entry of placed.values()) { dropLights(entry); entry.rig?.dispose(); entry.root.dispose(); } placed.clear(); renderer.dispose(); },
  };
}
