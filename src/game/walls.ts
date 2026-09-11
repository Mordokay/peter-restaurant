// Walls and seeing past them. A wall is a plain box tagged `metadata.wall`; the
// occluder fader watches the line from the camera to the player (and a little
// around them) and turns whatever wall stands in the way almost transparent, then
// solid again once the view is clear. Decor props tagged as structure join in
// through `resolve` (a placed fence or wall model is promoted to a rig so its
// meshes can fade; instances share one material and cannot).
import { MeshBuilder, Ray, Vector3, type AbstractMesh, type Material, type Mesh, type Scene, type ShadowGenerator } from "@babylonjs/core";

export interface WallSpec {
  /** Ends of the wall on the floor plane (x, z). */
  from: [number, number];
  to: [number, number];
  height: number;
  thickness?: number;
  baseY?: number;
  material: Material;
  name?: string;
  shadows?: ShadowGenerator;
}

/** A straight wall between two floor points; its top is a surface and it is an occluder. */
export function createWall(scene: Scene, spec: WallSpec): Mesh {
  const dx = spec.to[0] - spec.from[0], dz = spec.to[1] - spec.from[1];
  const length = Math.hypot(dx, dz);
  const thickness = spec.thickness ?? 0.12;
  const wall = MeshBuilder.CreateBox(spec.name ?? "wall", { width: length, height: spec.height, depth: thickness }, scene);
  wall.position.set((spec.from[0] + spec.to[0]) / 2, (spec.baseY ?? 0) + spec.height / 2, (spec.from[1] + spec.to[1]) / 2);
  wall.rotation.y = Math.atan2(-dz, dx);
  wall.material = spec.material;
  wall.receiveShadows = true;
  spec.shadows?.addShadowCaster(wall);
  wall.metadata = { ...((wall.metadata as Record<string, unknown> | null) ?? {}), wall: true, surface: true };
  return wall;
}

export interface OccluderFaderOptions {
  /** Where the player is (feet). Probe points are taken around and above it. */
  target: () => Vector3;
  /** Meshes that may stand between camera and player. */
  occluders: () => Iterable<AbstractMesh>;
  /** Group key of a hit mesh (a decor prop's id, say) — meshes of one key fade together. Default: the mesh itself. */
  keyOf?: (mesh: AbstractMesh) => string;
  /** Meshes to fade for a key (after promoting a prop to a rig, for instance). Default: the hit mesh. */
  resolve?: (key: string, hit: AbstractMesh) => AbstractMesh[];
  /** A key's meshes are solid again (undo a promotion). */
  onClear?: (key: string) => void;
  /** Opacity of a wall in the way. Default 0.12. */
  minVisibility?: number;
  /** Fade speed, per second. Default 6. */
  speed?: number;
  /** Probe offsets from the target (metres). Default: head to feet along the body, plus a ring around it. */
  probes?: readonly Vector3[];
}

export interface OccluderFader {
  update(dt: number): void;
  /** Keys currently faded. */
  faded(): string[];
  dispose(): void;
}

// Head, chest, knees and feet along the body, plus a ring around it at two heights: with a high
// camera a wall hides the legs long before it reaches the chest, so the low probes matter most.
const DEFAULT_PROBES = [
  new Vector3(0, 1.9, 0), new Vector3(0, 1.3, 0), new Vector3(0, 0.7, 0), new Vector3(0, 0.15, 0),
  new Vector3(0.6, 1.0, 0), new Vector3(-0.6, 1.0, 0), new Vector3(0, 1.0, 0.6), new Vector3(0, 1.0, -0.6),
  new Vector3(0.6, 0.2, 0), new Vector3(-0.6, 0.2, 0), new Vector3(0, 0.2, 0.6), new Vector3(0, 0.2, -0.6),
];

export function createOccluderFader(scene: Scene, options: OccluderFaderOptions): OccluderFader {
  const minVisibility = options.minVisibility ?? 0.12;
  const speed = options.speed ?? 6;
  const probes = options.probes ?? DEFAULT_PROBES;
  const keyOf = options.keyOf ?? ((mesh: AbstractMesh) => `mesh:${mesh.uniqueId}`);
  interface Group { meshes: AbstractMesh[]; visibility: number; hit: AbstractMesh }
  const groups = new Map<string, Group>();
  const ray = new Ray(Vector3.Zero(), Vector3.Up(), 1);
  return {
    update(dt) {
      const camera = scene.activeCamera;
      if (!camera) return;
      const eye = camera.globalPosition;
      const target = options.target();
      const occluded = new Map<string, AbstractMesh>();
      const occluders = [...options.occluders()].filter((mesh) => !mesh.isDisposed() && mesh.isEnabled() && mesh.isVisible);
      for (const probe of probes) {
        const point = target.add(probe);
        const direction = point.subtract(eye);
        const distance = direction.length();
        if (distance < 1e-3) continue;
        ray.origin.copyFrom(eye);
        ray.direction.copyFrom(direction.scaleInPlace(1 / distance));
        ray.length = distance - 0.05;
        for (const mesh of occluders) {
          // Cheap reject on the world-space box first (intersectsBox would test the local box).
          const box = mesh.getBoundingInfo().boundingBox;
          if (!ray.intersectsBoxMinMax(box.minimumWorld, box.maximumWorld)) continue;
          const pick = ray.intersectsMesh(mesh, false);
          if (pick.hit && pick.distance < ray.length) occluded.set(keyOf(mesh), mesh);
        }
      }
      for (const [key, hit] of occluded) {
        let group = groups.get(key);
        if (!group) { group = { meshes: [], visibility: 1, hit }; groups.set(key, group); }
        group.hit = hit;
        group.meshes = options.resolve ? options.resolve(key, hit) : [hit];
      }
      const step = Math.min(1, speed * dt);
      for (const [key, group] of groups) {
        const wanted = occluded.has(key) ? minVisibility : 1;
        group.visibility += (wanted - group.visibility) * step;
        if (wanted === 1 && group.visibility > 0.995) {
          for (const mesh of group.meshes) mesh.visibility = 1;
          groups.delete(key);
          options.onClear?.(key);
          continue;
        }
        for (const mesh of group.meshes) mesh.visibility = group.visibility;
      }
    },
    faded: () => [...groups.keys()],
    dispose() { for (const group of groups.values()) for (const mesh of group.meshes) mesh.visibility = 1; groups.clear(); },
  };
}
