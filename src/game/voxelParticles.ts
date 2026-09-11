// Voxel particles: little cubes that fly, fall, land and rest — tomato juice off the
// knife, crumbs, steam over a pot, sparks. One SolidParticleSystem per world holds a
// fixed pool of cubes (one mesh, one draw call); emitters are model data
// (model.emitters, authored in the lab) and fire from clip events or code.
import { Color3, Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, ShadowGenerator, SolidParticle, SolidParticleSystem, TransformNode, Vector3 } from "@babylonjs/core";
import type { AuthoredVoxelModel, ClipEvent, ParticleEmitter } from "./voxelModel.ts";
import type { VoxelRig } from "./voxelRig.ts";
import { createVoxelMaterial } from "./voxelGeometry.ts";
import { landBody, stepFall, type ColliderField, type FallingBody } from "./gravity.ts";

/** Sensible starting point for a new emitter in the lab: cubes of about 1 cm whatever the model's pitch. */
export function defaultEmitter(id: string, position: [number, number, number], color: string, part?: string, pitch?: number): ParticleEmitter {
  const size = pitch ? Math.max(1, Math.round(0.012 / pitch)) : 1;
  return { id, ...(part ? { part } : {}), position, colors: [color], size, mode: "burst", count: 24, rate: 12, direction: [0, 1, 0], spread: 35, speed: [1.2, 2.4], life: [0.6, 1.4], gravity: 1, bounce: 0.25, friction: 0.6, stick: true, fade: true, spin: true };
}

/** A launch velocity inside the emitter's cone: `direction` is already in world space. */
export function spawnVelocity(direction: Vector3, spreadDegrees: number, speed: number, random: () => number = Math.random): Vector3 {
  const axis = direction.lengthSquared() > 1e-8 ? direction.normalizeToNew() : new Vector3(0, 1, 0);
  // A uniform point in a spherical cap around the axis.
  const cosMax = Math.cos((Math.min(179, Math.max(0, spreadDegrees)) * Math.PI) / 180);
  const cosTheta = 1 - random() * (1 - cosMax);
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = random() * Math.PI * 2;
  const helper = Math.abs(axis.y) < 0.9 ? Vector3.Up() : Vector3.Right();
  const u = Vector3.Cross(axis, helper).normalize();
  const v = Vector3.Cross(axis, u);
  return axis.scale(cosTheta).addInPlace(u.scale(sinTheta * Math.cos(phi))).addInPlace(v.scale(sinTheta * Math.sin(phi))).scaleInPlace(speed);
}

const lerpRange = (range: readonly [number, number], t: number) => range[0] + (range[1] - range[0]) * t;

interface Live extends FallingBody {
  particle: SolidParticle;
  life: number;
  maxLife: number;
  size: number;
  spec: ParticleEmitter;
  resting: boolean;
  spin: Vector3;
  exclude?: string;
}

/** Something emitters can be attached to: a rig (parts move) or a static placement. */
export interface EmitterHost {
  model: AuthoredVoxelModel;
  /** World matrix of the model's origin (rest pose). */
  world(): Matrix;
  /** World matrix of a part's node, when the host has moving parts. */
  partWorld?(part: string): Matrix | null;
  /** Collider id to ignore when the host's own particles land (a pot's steam must not land on the pot rim). */
  excludeCollider?: string;
}

export interface EmitterHandle {
  /** Fire a burst (count particles) or, for a continuous emitter, emit one second's worth at once. */
  fire(emitterId: string): boolean;
  start(emitterId: string): void;
  stop(emitterId: string): void;
  /** Clip events carrying `emit` fire/start/stop the named emitter. */
  handleEvent(event: ClipEvent): void;
  running(emitterId: string): boolean;
  dispose(): void;
}

export interface ParticleWorld {
  /** Fire an emitter spec at a world position and direction (game code, no model needed). `pitch` sizes the cubes. */
  emitAt(spec: ParticleEmitter, position: Vector3, direction: Vector3, pitch: number, exclude?: string): number;
  /** Follow a rig or a static placement; continuous emitters run until stopped. */
  attach(host: EmitterHost, options?: { autoStart?: boolean }): EmitterHandle;
  attachRig(rig: VoxelRig, options?: { autoStart?: boolean; excludeCollider?: string }): EmitterHandle;
  update(dt: number): void;
  stats(): { alive: number; capacity: number; handles: number };
  readonly mesh: Mesh;
  dispose(): void;
}

export function createParticleWorld(scene: Scene, options: { capacity?: number; colliders?: ColliderField | null; groundY?: number; shadows?: ShadowGenerator; random?: () => number } = {}): ParticleWorld {
  const capacity = options.capacity ?? 3000;
  const random = options.random ?? Math.random;
  const sps = new SolidParticleSystem("voxel particles", scene, { updatable: true, isPickable: false });
  const shape = MeshBuilder.CreateBox("voxel particle shape", { size: 1 }, scene);
  sps.addShape(shape, capacity);
  shape.dispose();
  const mesh = sps.buildMesh();
  mesh.material = createVoxelMaterial("voxel particle material", scene);
  mesh.useVertexColors = true;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true; // cubes fly everywhere; skip per-frame bounds
  mesh.receiveShadows = true;
  options.shadows?.addShadowCaster(mesh, false);
  sps.computeParticleColor = true;
  sps.computeParticleTexture = false;
  const free: SolidParticle[] = [];
  for (let i = sps.nbParticles - 1; i >= 0; i--) { const p = sps.particles[i]!; p.isVisible = false; p.scaling.setAll(0); free.push(p); }
  sps.setParticles();
  const live: Live[] = [];
  const handles = new Set<HandleState>();

  const spawn = (spec: ParticleEmitter, origin: Vector3, direction: Vector3, pitch: number, count: number, exclude?: string): number => {
    let made = 0;
    for (let i = 0; i < count; i++) {
      const particle = free.pop();
      if (!particle) break;
      const hex = spec.colors[Math.floor(random() * spec.colors.length)] ?? "#ffffff";
      const c = Color3.FromHexString(hex);
      particle.color = new Color4(c.r, c.g, c.b, 1);
      const size = Math.max(0.002, spec.size * pitch);
      const velocity = spawnVelocity(direction, spec.spread, lerpRange(spec.speed, random()), random);
      const jitter = size * 0.6;
      const body: Live = {
        particle, size, spec, exclude,
        x: origin.x + (random() - 0.5) * jitter, y: origin.y + (random() - 0.5) * jitter, z: origin.z + (random() - 0.5) * jitter,
        vx: velocity.x, vy: velocity.y, vz: velocity.z,
        life: lerpRange(spec.life, random()), maxLife: 0, resting: false,
        spin: spec.spin ? new Vector3((random() - 0.5) * 12, (random() - 0.5) * 12, (random() - 0.5) * 12) : Vector3.Zero(),
      };
      body.maxLife = body.life;
      particle.position.set(body.x, body.y, body.z);
      particle.scaling.setAll(size);
      particle.rotationQuaternion = null;
      particle.rotation.set(0, 0, 0);
      particle.isVisible = true;
      live.push(body);
      made++;
    }
    return made;
  };
  const recycle = (index: number): void => {
    const body = live[index]!;
    body.particle.isVisible = false;
    body.particle.scaling.setAll(0);
    free.push(body.particle);
    live[index] = live[live.length - 1]!;
    live.pop();
  };

  /** running: emitter id → seconds left (Infinity = until stopped). */
  interface HandleState { host: EmitterHost; running: Map<string, number>; accumulators: Map<string, number>; alive: boolean }
  const emitterFrame = (state: HandleState, spec: ParticleEmitter): { origin: Vector3; direction: Vector3 } => {
    const { model } = state.host;
    const part = spec.part ? model.parts.find((candidate) => candidate.id === spec.part) : undefined;
    const partMatrix = spec.part ? state.host.partWorld?.(spec.part) ?? null : null;
    let local: Vector3;
    let matrix: Matrix;
    if (part && partMatrix) {
      local = new Vector3((spec.position[0] - part.pivot[0]) * model.pitch, (spec.position[1] - part.pivot[1]) * model.pitch, (spec.position[2] - part.pivot[2]) * model.pitch);
      matrix = partMatrix;
    } else {
      local = new Vector3(spec.position[0] * model.pitch, spec.position[1] * model.pitch, spec.position[2] * model.pitch);
      matrix = state.host.world();
    }
    const origin = Vector3.TransformCoordinates(local, matrix);
    const direction = Vector3.TransformNormal(new Vector3(spec.direction[0], spec.direction[1], spec.direction[2]), matrix);
    return { origin, direction };
  };
  const fireSpec = (state: HandleState, spec: ParticleEmitter, count: number): number => {
    const { origin, direction } = emitterFrame(state, spec);
    return spawn(spec, origin, direction, state.host.model.pitch, count, state.host.excludeCollider);
  };
  const attach = (host: EmitterHost, attachOptions: { autoStart?: boolean } = {}): EmitterHandle => {
    const state: HandleState = { host, running: new Map(), accumulators: new Map(), alive: true };
    const specOf = (id: string) => host.model.emitters?.find((candidate) => candidate.id === id);
    /** Run a continuous emitter for its duration (or until stopped when it has none). */
    const start = (id: string): void => { const spec = specOf(id); if (spec) state.running.set(id, spec.duration && spec.duration > 0 ? spec.duration : Infinity); };
    // Continuous emitters with no set duration run for as long as the model is placed (steam over a stove).
    if (attachOptions.autoStart ?? true) for (const spec of host.model.emitters ?? []) if (spec.mode === "continuous" && !(spec.duration && spec.duration > 0)) start(spec.id);
    handles.add(state);
    return {
      fire(id) {
        const spec = specOf(id);
        if (!spec) return false;
        if (spec.mode === "burst") return fireSpec(state, spec, spec.count) > 0;
        state.running.set(id, spec.duration && spec.duration > 0 ? spec.duration : 1); // a timed run, or one second of it
        return true;
      },
      start,
      stop(id) { state.running.delete(id); },
      handleEvent(event) {
        if (!event.emit) return;
        const action = event.emitAction ?? "burst";
        const spec = specOf(event.emit);
        if (!spec) return;
        if (action === "stop") state.running.delete(event.emit);
        else if (action === "start" || spec.mode === "continuous") start(event.emit);
        else fireSpec(state, spec, spec.count);
      },
      running: (id) => state.running.has(id),
      dispose() { state.alive = false; handles.delete(state); },
    };
  };

  return {
    mesh,
    emitAt(spec, position, direction, pitch, exclude) { return spawn(spec, position, direction, pitch, spec.count, exclude); },
    attach,
    attachRig(rig, attachOptions) {
      return attach({
        model: rig.model,
        excludeCollider: attachOptions?.excludeCollider,
        world: () => { rig.root.computeWorldMatrix(true); return rig.root.getWorldMatrix(); },
        partWorld: (part) => { const node: TransformNode | undefined = rig.parts.get(part)?.node; if (!node) return null; node.computeWorldMatrix(true); return node.getWorldMatrix(); },
      }, attachOptions);
    },
    update(dt) {
      if (dt <= 0) return;
      // Continuous emitters: fractional accumulation so low rates still emit evenly.
      for (const state of handles) {
        for (const [id, remaining] of state.running) {
          const spec = state.host.model.emitters?.find((candidate) => candidate.id === id);
          if (!spec) { state.running.delete(id); continue; }
          const slice = Math.min(dt, remaining);
          const rate = spec.mode === "continuous" ? spec.rate ?? spec.count : spec.count;
          const acc = (state.accumulators.get(id) ?? 0) + rate * slice;
          const whole = Math.floor(acc);
          state.accumulators.set(id, acc - whole);
          if (whole > 0) fireSpec(state, spec, whole);
          if (remaining - dt <= 0) state.running.delete(id); else if (remaining !== Infinity) state.running.set(id, remaining - dt);
        }
      }
      for (let index = live.length - 1; index >= 0; index--) {
        const body = live[index]!;
        body.life -= dt;
        if (body.life <= 0) { recycle(index); continue; }
        if (!body.resting) {
          const landed = stepFall(body, dt, options.colliders ?? null, { gravityScale: body.spec.gravity, exclude: body.exclude, groundY: options.groundY, drag: body.spec.drag });
          if (landed !== null) {
            body.y = landed + body.size / 2;
            const rest = landBody(body, body.spec.bounce, body.spec.friction ?? 0.5);
            if (rest) { if (body.spec.stick) { body.resting = true; body.particle.rotation.set(0, 0, 0); } else { recycle(index); continue; } }
          }
          if (!body.resting && body.spec.spin) { body.particle.rotation.x += body.spin.x * dt; body.particle.rotation.y += body.spin.y * dt; body.particle.rotation.z += body.spin.z * dt; }
        }
        body.particle.position.set(body.x, body.y, body.z);
        // Fade: shrink over the last 40% of life so a puddle dries and smoke thins.
        const t = body.life / body.maxLife;
        const scale = body.spec.fade && t < 0.4 ? body.size * Math.max(0.05, t / 0.4) : body.size;
        body.particle.scaling.setAll(scale);
      }
      sps.setParticles();
    },
    stats: () => ({ alive: live.length, capacity, handles: handles.size }),
    dispose() { handles.clear(); live.length = 0; sps.dispose(); },
  };
}

/** Quaternion-free helper for hosts that only know position/yaw (game code). */
export function placementMatrix(position: Vector3, yawDegrees: number, scale = 1): Matrix {
  return Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationYawPitchRoll((yawDegrees * Math.PI) / 180, 0, 0), position);
}
