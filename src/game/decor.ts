import type { Scene, ShadowGenerator, TransformNode } from "@babylonjs/core";
import type { AuthoredVoxelCatalog } from "./voxelModel";
import { createClipPlayer, createVoxelRig, type ClipPlayer, type VoxelRig } from "./voxelRig";
import { propRotation, propScale, propVisible, type DecorLayout, type DecorProp } from "./decorLayout";
export { validateDecorLayout, propRotation, propScale, propVisible, type DecorGroup, type DecorLayout, type DecorProp } from "./decorLayout";

// Decor: catalog models placed in the game world by hand (vases, spoons, crates,
// a mural prop) — the human-crafted layer on top of the coded scene. The layout
// is data (src/assets/scene/decor.json), edited in the game's decorate mode and
// loaded here at startup. Every prop is a normal voxel rig, so its clips play
// and one catalog fix updates every copy.

export interface PlacedProp {
  prop: DecorProp;
  rig: VoxelRig;
  player: ClipPlayer;
  root: TransformNode;
  /** Looping clip to return to after an interaction (undefined = still). */
  idleClip?: string;
  /** An interaction clip is playing; when it ends the idle clip resumes. */
  reacting: boolean;
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
  /** Play the prop's interaction clip once (returns false when it has none). */
  trigger(id: string): boolean;
  /** Closest prop with an interaction clip within `reach` metres of a point, or null. */
  nearestInteractive(position: { x: number; z: number }, reach: number): PlacedProp | null;
  update(dt: number): void;
  dispose(): void;
}

/** Position, yaw and scale from the record onto the rig root. */
export function applyPropTransform(placed: PlacedProp): void {
  const { prop, root } = placed;
  root.position.set(prop.position[0], prop.position[1], prop.position[2]);
  const [rx, ry, rz] = propRotation(prop);
  root.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180);
  const [sx, sy, sz] = propScale(prop);
  root.scaling.set(sx, sy, sz);
}

export function createDecorScene(scene: Scene, catalog: AuthoredVoxelCatalog, layout: DecorLayout, options: { shadows?: ShadowGenerator } = {}): DecorScene {
  const placed = new Map<string, PlacedProp>();
  const place = (prop: DecorProp): PlacedProp | null => {
    const model = catalog.models[prop.model];
    if (!model) return null;
    placed.get(prop.id)?.rig.dispose();
    const rig = createVoxelRig(model, scene, { name: `decor ${prop.id}`, shadows: options.shadows });
    for (const mesh of rig.meshes) mesh.metadata = { ...(mesh.metadata as Record<string, unknown> | null ?? {}), decorId: prop.id };
    const player = createClipPlayer(rig);
    const clipId = prop.clip === undefined ? model.clips?.find((clip) => clip.loop)?.id : prop.clip;
    // The anchor carries the placement; the clip player animates the root beneath it.
    const entry: PlacedProp = { prop, rig, player, root: rig.anchor, idleClip: clipId ?? undefined, reacting: false };
    applyPropTransform(entry);
    rig.anchor.setEnabled(propVisible(prop, layout));
    if (clipId) player.play(clipId, { loop: true });
    placed.set(prop.id, entry);
    return entry;
  };
  for (const prop of layout.props) place(prop);
  return {
    placed,
    add: place,
    remove(id) { const entry = placed.get(id); if (!entry) return; entry.rig.dispose(); placed.delete(id); },
    refresh(id) { const entry = placed.get(id); if (entry) applyPropTransform(entry); },
    refreshVisibility() { for (const entry of placed.values()) entry.root.setEnabled(propVisible(entry.prop, layout)); },
    trigger(id) {
      const entry = placed.get(id);
      if (!entry?.prop.interactClip || !entry.player.play(entry.prop.interactClip, { loop: false })) return false;
      entry.reacting = true;
      return true;
    },
    nearestInteractive(position, reach) {
      let best: PlacedProp | null = null;
      let bestDistance = reach * reach;
      for (const entry of placed.values()) {
        if (!entry.prop.interactClip || !propVisible(entry.prop, layout)) continue;
        const dx = entry.root.position.x - position.x, dz = entry.root.position.z - position.z;
        const d = dx * dx + dz * dz;
        if (d <= bestDistance) { best = entry; bestDistance = d; }
      }
      return best;
    },
    update(dt) {
      for (const entry of placed.values()) {
        entry.player.update(dt);
        if (entry.reacting && entry.player.finished) {
          entry.reacting = false;
          if (entry.idleClip) entry.player.play(entry.idleClip, { loop: true }); else entry.player.stop();
        }
      }
    },
    dispose() { for (const entry of placed.values()) entry.rig.dispose(); placed.clear(); },
  };
}
