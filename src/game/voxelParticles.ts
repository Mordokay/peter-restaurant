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
  pool: { free: SolidParticle[]; alive: number };
  /** Base transparency, so the life curve can be applied against it each frame. */
  alpha: number;
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
  /** Stop every running continuous emitter (playback stopped, prop removed, editor closed). */
  stopAll(): void;
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
  stats(): { alive: number; capacity: number; handles: number; pools: number };
  readonly mesh: Mesh;
  dispose(): void;
}

export function createParticleWorld(scene: Scene, options: {
  capacity?: number;
  colliders?: ColliderField | null;
  groundY?: number;
  shadows?: ShadowGenerator;
  random?: () => number;
  /** Geometry for `shape: "model:<id>"`: hand back a mesh for that catalog model and the world
   *  normalises it. Lets a snowflake authored in the lab be the particle. */
  shapes?: (id: string) => Mesh | null;
} = {}): ParticleWorld {
  const capacity = options.capacity ?? 3000;
  const random = options.random ?? Math.random;
  /** Opaque cubes and translucent ones cannot share a mesh, so there are two pools. The translucent
   *  one blends per particle through its vertex alpha, which lets each emitter pick its own. */
  interface Pool { sps: SolidParticleSystem; mesh: Mesh; free: SolidParticle[]; alive: number }
  /** One particle's geometry, normalised into a unit cube so `size` means the same for every shape. */
  const buildShape = (shape: string): Mesh => {
    if (shape.startsWith("model:")) {
      const custom = options.shapes?.(shape.slice(6));
      if (custom) {
        // Fit it into a unit cube and bake that in, so `size` still reads as metres.
        custom.computeWorldMatrix(true);
        const extent = custom.getBoundingInfo().boundingBox.extendSize;
        const longest = Math.max(extent.x, extent.y, extent.z, 1e-4) * 2;
        custom.scaling.setAll(1 / longest);
        custom.bakeCurrentTransformIntoVertices();
        return custom;
      }
    }
    switch (shape) {
      case "flake": return MeshBuilder.CreateBox("particle flake", { width: 1, height: 0.22, depth: 1 }, scene);
      case "shard": return MeshBuilder.CreateBox("particle shard", { width: 0.34, height: 1, depth: 0.34 }, scene);
      case "drop": return MeshBuilder.CreateBox("particle drop", { width: 0.6, height: 1, depth: 0.6 }, scene);
      default: return MeshBuilder.CreateBox("particle cube", { size: 1 }, scene);
    }
  };
  const makePool = (name: string, translucent: boolean, size: number, shapeName: string): Pool => {
    const sps = new SolidParticleSystem(name, scene, { updatable: true, isPickable: false });
    const shape = buildShape(shapeName);
    sps.addShape(shape, size);
    shape.dispose();
    const mesh = sps.buildMesh();
    const material = createVoxelMaterial(`${name} material`, scene);
    mesh.material = material;
    mesh.useVertexColors = true;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true; // cubes fly everywhere; skip per-frame bounds
    mesh.receiveShadows = !translucent;
    if (translucent) {
      // Vertex alpha, so one pool serves vapour at 0.3 and spray at 0.6 alike.
      mesh.hasVertexAlpha = true;
      material.backFaceCulling = false;
      material.separateCullingPass = true;
    } else {
      options.shadows?.addShadowCaster(mesh, false);
    }
    sps.computeParticleColor = true;
    sps.computeParticleTexture = false;
    const free: SolidParticle[] = [];
    for (let i = sps.nbParticles - 1; i >= 0; i--) { const p = sps.particles[i]!; p.isVisible = false; p.scaling.setAll(0); free.push(p); }
    sps.setParticles();
    return { sps, mesh, free, alive: 0 };
  };
  // A pool per (shape, translucency): they cannot share a mesh, and most worlds use only one or two.
  const pools = new Map<string, Pool>();
  const poolFor = (shapeName: string, translucent: boolean): Pool => {
    const key = `${shapeName}|${translucent ? "glass" : "solid"}`;
    let pool = pools.get(key);
    if (!pool) {
      const first = pools.size === 0;
      pool = makePool(`voxel particles ${key}`, translucent, first ? capacity : Math.max(200, Math.round(capacity / 2)), shapeName);
      pools.set(key, pool);
    }
    return pool;
  };
  // The plain cube pool always exists, so `mesh` and the stats have something to point at.
  const opaquePool = poolFor("cube", false);
  const live: Live[] = [];
  const handles = new Set<HandleState>();

  const spawn = (spec: ParticleEmitter, origin: Vector3, direction: Vector3, pitch: number, count: number, exclude?: string, frame?: Matrix): number => {
    let made = 0;
    const alpha = Math.min(1, Math.max(0, spec.alpha ?? 1));
    // Anything that changes transparency has to be drawn translucent, even if it starts solid.
    const pool = poolFor(spec.shape ?? "cube", Boolean(spec.alphaOverLife) || alpha < 0.999);
    for (let i = 0; i < count; i++) {
      const particle = pool.free.pop();
      if (!particle) break;
      const hex = spec.colors[Math.floor(random() * spec.colors.length)] ?? "#ffffff";
      const c = Color3.FromHexString(hex);
      particle.color = new Color4(c.r, c.g, c.b, alpha * (spec.alphaOverLife?.[0] ?? 1));
      const size = Math.max(0.002, spec.size * pitch);
      const velocity = spawnVelocity(direction, spec.spread, lerpRange(spec.speed, random()), random);
      // An emitter with a volume seeds anywhere inside that box, turned to match the model it sits on,
      // so cold air can fill a whole cabinet rather than pour from one point.
      let offsetX = 0, offsetY = 0, offsetZ = 0;
      if (spec.volume) {
        const local = new Vector3((random() - 0.5) * spec.volume[0] * pitch, (random() - 0.5) * spec.volume[1] * pitch, (random() - 0.5) * spec.volume[2] * pitch);
        const world = frame ? Vector3.TransformNormal(local, frame) : local;
        offsetX = world.x; offsetY = world.y; offsetZ = world.z;
      } else {
        const jitter = size * 0.6;
        offsetX = (random() - 0.5) * jitter; offsetY = (random() - 0.5) * jitter; offsetZ = (random() - 0.5) * jitter;
      }
      const body: Live = {
        particle, size, spec, exclude, pool, alpha,
        x: origin.x + offsetX, y: origin.y + offsetY, z: origin.z + offsetZ,
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
      pool.alive++;
      live.push(body);
      made++;
    }
    return made;
  };
  const recycle = (index: number): void => {
    const body = live[index]!;
    body.particle.isVisible = false;
    body.particle.scaling.setAll(0);
    body.pool.free.push(body.particle);
    body.pool.alive--;
    live[index] = live[live.length - 1]!;
    live.pop();
  };

  /** running: emitter id → seconds left (Infinity = until stopped). */
  interface HandleState { host: EmitterHost; running: Map<string, number>; accumulators: Map<string, number>; alive: boolean }
  const emitterFrame = (state: HandleState, spec: ParticleEmitter): { origin: Vector3; direction: Vector3; matrix: Matrix } => {
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
    return { origin, direction, matrix };
  };
  const fireSpec = (state: HandleState, spec: ParticleEmitter, count: number): number => {
    const { origin, direction, matrix } = emitterFrame(state, spec);
    return spawn(spec, origin, direction, state.host.model.pitch, count, state.host.excludeCollider, matrix);
  };
  const attach = (host: EmitterHost, attachOptions: { autoStart?: boolean } = {}): EmitterHandle => {
    const state: HandleState = { host, running: new Map(), accumulators: new Map(), alive: true };
    const specOf = (id: string) => host.model.emitters?.find((candidate) => candidate.id === id);
    /** Run a continuous emitter for its duration (or until stopped when it has none).
     *  A burst emitter has nothing to run, so "start" on one simply fires it once. */
    const start = (id: string): void => {
      const spec = specOf(id);
      if (!spec) return;
      if (spec.mode !== "continuous") { fireSpec(state, spec, spec.count); return; }
      state.running.set(id, spec.duration && spec.duration > 0 ? spec.duration : Infinity);
    };
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
      stopAll() { state.running.clear(); state.accumulators.clear(); },
      handleEvent(event) {
        if (!event.emit) return;
        const action = event.emitAction ?? "burst";
        const spec = specOf(event.emit);
        if (!spec) return;
        if (action === "stop") state.running.delete(event.emit);
        else if (action === "start" || spec.mode === "continuous") start(event.emit);
        else fireSpec(state, spec, spec.count); // a plain burst
      },
      running: (id) => state.running.has(id),
      dispose() { state.alive = false; handles.delete(state); },
    };
  };

  return {
    mesh: opaquePool.mesh,
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
        // `age` runs from 0 at birth to 1 at death, which is what the life curves are written against.
        const remaining = body.life / body.maxLife;
        const age = 1 - remaining;
        const grow = body.spec.scaleOverLife;
        const scale = grow
          ? body.size * (grow[0] + (grow[1] - grow[0]) * age)
          : body.spec.fade && remaining < 0.4 ? body.size * Math.max(0.05, remaining / 0.4) : body.size;
        body.particle.scaling.setAll(Math.max(0.0005, scale));
        const alphaCurve = body.spec.alphaOverLife;
        if (alphaCurve && body.particle.color) {
          body.particle.color.a = Math.max(0, body.alpha * (alphaCurve[0] + (alphaCurve[1] - alphaCurve[0]) * age));
        }
      }
      for (const pool of pools.values()) pool.sps.setParticles();
    },
    stats: () => ({ alive: live.length, capacity, handles: handles.size, pools: pools.size }),
    dispose() { handles.clear(); live.length = 0; for (const pool of pools.values()) pool.sps.dispose(); pools.clear(); },
  };
}

/** Quaternion-free helper for hosts that only know position/yaw (game code). */
export function placementMatrix(position: Vector3, yawDegrees: number, scale = 1): Matrix {
  return Matrix.Compose(new Vector3(scale, scale, scale), Quaternion.RotationYawPitchRoll((yawDegrees * Math.PI) / 180, 0, 0), position);
}
