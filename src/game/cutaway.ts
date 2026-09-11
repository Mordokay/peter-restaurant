// Seeing into a building from a fixed overhead camera.
//
// The per-ray occluder fader in walls.ts works for a fence or a lone wall, but a compound of eighteen
// rooms needs the Sims answer: the walls standing between the camera and the room you care about come
// down as a whole, rather than flickering piecemeal wherever a probe ray happens to clip one.
//
// A wall comes down when it faces the camera (its outward normal points back toward the eye) and the
// room it encloses is one the view has to cross to reach the player. That is the player's own room plus
// any room the line from the camera to the player passes through, so looking across the kitchen into the
// pantry opens both. Everything else stays standing, which keeps the building readable as a building.
import type { Scene } from "@babylonjs/core";
import type { BuiltLevel } from "./levelBuilder.ts";
import { rectContains, type LevelLayout, type Point2, type Rect } from "./levelLayout.ts";

export interface CutawayOptions {
  /** Where the player is standing (world space). */
  target: () => { x: number; z: number };
  /** Opacity of a wall that is down. 0 hides it completely. Default 0. */
  downVisibility?: number;
  /** Fade speed, per second. Default 8. */
  speed?: number;
  /** Also open rooms standing just in front of the player, not only the room they are in. Default true. */
  openRoomsInTheWay?: boolean;
  /** How far in front of the player to look for those rooms, metres. The camera can sit eighty metres
   *  back, so probing all the way to the eye would open half the site. Default 14. */
  probeLength?: number;
  /** Walls no taller than this stay up: a service counter or a balcony never blocks the view, and
   *  dropping it would hide the very thing the open kitchen is for. Metres, default 1.4. */
  keepBelow?: number;
}

export interface Cutaway {
  update(dt: number): void;
  /** Ids of the walls currently down. */
  down(): string[];
  /** The room the player is in, or null. */
  room(): string | null;
  dispose(): void;
}

/** Does the segment a→b touch the rectangle? Slab test on the floor plane. */
export function segmentCrossesRect(rect: Rect, ax: number, az: number, bx: number, bz: number): boolean {
  if (rectContains(rect, ax, az) || rectContains(rect, bx, bz)) return true;
  const minX = rect[0], maxX = rect[0] + rect[2], minZ = rect[1], maxZ = rect[1] + rect[3];
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - minX], [dx, maxX - ax], [-dz, az - minZ], [dz, maxZ - az]] as const) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

export function createCutaway(scene: Scene, layout: LevelLayout, level: BuiltLevel, options: CutawayOptions): Cutaway {
  const downVisibility = options.downVisibility ?? 0;
  const speed = options.speed ?? 8;
  const openInTheWay = options.openRoomsInTheWay ?? true;
  const probeLength = options.probeLength ?? 14;
  const keepBelow = options.keepBelow ?? 1.4;
  /** Current opacity per wall id, so a wall eases down and back rather than blinking. */
  const visibility = new Map<string, number>();
  let currentRoom: string | null = null;
  let downNow: string[] = [];

  return {
    update(dt) {
      const camera = scene.activeCamera;
      if (!camera) return;
      const eye = camera.globalPosition;
      const player = options.target();
      // The room you are standing in, plus the rooms immediately between you and the camera — a short
      // probe toward the eye, not the whole way, or a distant camera would open the entire compound.
      const toEye = { x: eye.x - player.x, z: eye.z - player.z };
      const distance = Math.hypot(toEye.x, toEye.z) || 1;
      const reach = Math.min(probeLength, distance);
      const probeX = player.x + (toEye.x / distance) * reach;
      const probeZ = player.z + (toEye.z / distance) * reach;
      const open = new Set<string>();
      currentRoom = null;
      for (const room of layout.rooms) {
        if (rectContains(room.rect, player.x, player.z)) { open.add(room.id); currentRoom = room.id; }
        else if (openInTheWay && segmentCrossesRect(room.rect, probeX, probeZ, player.x, player.z)) open.add(room.id);
      }

      downNow = [];
      for (const [id, built] of level.walls) {
        const { wall, mesh, normal } = built;
        let facing = false;
        if (built.height > keepBelow) {
          // A wall can enclose two rooms; its outward normal flips depending on which side we stand.
          for (const [roomId, sign] of [[wall.room, 1], [wall.back, -1]] as const) {
            if (!roomId || !open.has(roomId)) continue;
            const mid: Point2 = [(wall.from[0] + wall.to[0]) / 2, (wall.from[1] + wall.to[1]) / 2];
            const outward: Point2 = [normal[0] * sign, normal[1] * sign];
            // Outward face turned toward the eye means the wall stands between the camera and that room.
            if (outward[0] * (eye.x - mid[0]) + outward[1] * (eye.z - mid[1]) > 0) { facing = true; break; }
          }
        }
        const wanted = facing ? downVisibility : 1;
        const now = visibility.get(id) ?? 1;
        const next = now + (wanted - now) * Math.min(1, speed * dt);
        visibility.set(id, next);
        mesh.visibility = next;
        // Fully transparent meshes still cost a draw call and can catch a pick, so switch them off.
        const visible = next > 0.02;
        if (mesh.isVisible !== visible) mesh.isVisible = visible;
        if (facing) downNow.push(id);
      }
    },
    down: () => [...downNow],
    room: () => currentRoom,
    dispose() {
      for (const [id, built] of level.walls) { built.mesh.visibility = 1; built.mesh.isVisible = true; visibility.delete(id); }
    },
  };
}
