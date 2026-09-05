import { ArcRotateCamera, Mesh, Ray, Scene, Vector3 } from "@babylonjs/core";

// "Head" camera for the Model Lab, on top of Babylon's ArcRotateCamera so the
// orbit controls everyone knows keep working. Borrowed from game photo modes
// (Horizon, Ghost of Tsushima, Spider-Man) and the Unity/Blender viewports:
//
//   hold right mouse       look around from where you stand (yaw/pitch)
//   + W A S D / Q E        fly forward/left/back/right, down/up along the view
//   Shift / Alt            fast / slow; the 🎮 slider sets the base speed
//   C                      fly mode: WASD/QE work without holding the mouse
//   F                      frame the selection (or the whole model)
//   middle-click a voxel   orbit around it from where you stand
//   middle-drag, Shift+right-drag   pan
//   1 / 3 / 7 (+Shift)     front / right / top (back / left / bottom)
//   Alt + scroll           field of view
//
// Every move keeps the orbit pivot a fixed distance ahead of the eye, so the
// moment you release the button the usual left-drag orbits around whatever you
// were looking at.

export type ViewPreset = "front" | "back" | "left" | "right" | "top" | "bottom";

export interface HeadCameraOptions {
  /** Meshes a middle-click may anchor the orbit on. */
  pickable: () => readonly Mesh[];
  /** Meshes F frames (the selection in the editor, the whole model otherwise). */
  frameMeshes: () => readonly Mesh[];
  /** Keys the host needs for itself right now (typing in a field is skipped automatically). */
  keyBlocked?: (event: KeyboardEvent) => boolean;
  /** Short transient messages (fly speed, field of view). */
  onStatus?: (text: string) => void;
  /** Fly mode toggled: refresh buttons and legends. */
  onChange?: () => void;
  /** Fly keys that double as hotkeys: they only start moving after a short hold;
   * a quick tap is reported through `onKeyTap` instead (decorate: W = move gizmo). */
  holdDelayKeys?: ReadonlySet<string>;
  onKeyTap?: (key: string) => void;
  minRadius: number;
  maxRadius: number;
}

export interface HeadCamera {
  readonly flyMode: boolean;
  /** Right button held or fly mode on: WASD/QE belong to the camera. */
  readonly flying: boolean;
  readonly speedScale: number;
  setFlyMode(on: boolean): void;
  /** Keyboard fly speed multiplier (the toolbar slider). */
  setSpeedScale(scale: number): void;
  frame(meshes?: readonly Mesh[]): void;
  /** Orbit around this world point without moving the eye. */
  anchorAt(point: Vector3): void;
  preset(view: ViewPreset): void;
  resetFov(): void;
  /** One line for the on-screen legend, matching the current state. */
  legend(): string;
  update(dt: number): void;
  dispose(): void;
}

const FLY_KEYS = new Set(["w", "a", "s", "d", "q", "e"]);
/** Hold-delay keys start flying only after this long; shorter presses are taps. */
const HOLD_DELAY_MS = 220;
const LOOK_SENSITIVITY = 0.0042; // radians per pixel
const PAN_SENSITIVITY = 1 / 520; // fraction of the orbit radius per pixel
const DEFAULT_FOV = 0.8;
const GLIDE_SECONDS = 0.28;

function directionOf(alpha: number, beta: number): Vector3 {
  // Unit vector from the target to the eye for these ArcRotateCamera angles.
  return new Vector3(Math.cos(alpha) * Math.sin(beta), Math.cos(beta), Math.sin(alpha) * Math.sin(beta));
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable;
}

export function createHeadCamera(camera: ArcRotateCamera, canvas: HTMLCanvasElement, scene: Scene, options: HeadCameraOptions): HeadCamera {
  const keys = new Set<string>();
  /** When each fly key went down (for hold-delay keys). */
  const pressedAt = new Map<string, number>();
  let rightHeld = false;
  let panning = false;
  let flyMode = false;
  let fast = false;
  let slow = false;
  let speedScale = 1;
  let last = { x: 0, y: 0 };
  let middleDown: { x: number; y: number } | null = null;
  /** Smoothed distance from the eye to the nearest geometry (metres); drives fly and pan speed. */
  let proximity = 1;
  let glide: { from: { alpha: number; beta: number; radius: number; target: Vector3 }; to: { alpha: number; beta: number; radius: number; target: Vector3 }; t: number } | null = null;
  camera.fov = DEFAULT_FOV;

  const clampBeta = (beta: number) => Math.min(Math.PI - 0.03, Math.max(0.03, beta));
  const clampRadius = (radius: number) => Math.min(options.maxRadius, Math.max(options.minRadius, radius));
  const stopInertia = () => { camera.inertialAlphaOffset = 0; camera.inertialBetaOffset = 0; camera.inertialRadiusOffset = 0; camera.inertialPanningX = 0; camera.inertialPanningY = 0; };

  /** How far the eye is from the nearest thing: the orbit pivot, what the view
   * ray hits, or the closest mesh bounding box (chunks in the editor, so a leaf
   * you are hovering over counts). Movement scales with it, so zooming onto one
   * leaf makes every step smaller, however far away the pivot is. */
  function measureProximity(): number {
    const eye = camera.position;
    let nearest = camera.radius;
    const meshes = options.pickable().filter((mesh) => !mesh.isDisposed() && mesh.isEnabled() && mesh.getTotalVertices() > 0);
    if (meshes.length) {
      const set = new Set(meshes);
      const hit = scene.pickWithRay(new Ray(eye, camera.getDirection(Vector3.Forward()), 50), (mesh) => set.has(mesh as Mesh));
      if (hit?.hit && hit.distance > 0) nearest = Math.min(nearest, hit.distance);
      for (const mesh of meshes) {
        const box = mesh.getBoundingInfo().boundingBox;
        const dx = Math.max(box.minimumWorld.x - eye.x, 0, eye.x - box.maximumWorld.x);
        const dy = Math.max(box.minimumWorld.y - eye.y, 0, eye.y - box.maximumWorld.y);
        const dz = Math.max(box.minimumWorld.z - eye.z, 0, eye.z - box.maximumWorld.z);
        nearest = Math.min(nearest, Math.hypot(dx, dy, dz));
      }
    }
    return Math.min(8, Math.max(0.01, nearest));
  }
  /** Re-anchor the orbit pivot on whatever the view ray hits, without moving the eye. */
  function anchorAhead(): void {
    const meshes = options.pickable().filter((mesh) => !mesh.isDisposed() && mesh.isEnabled());
    if (!meshes.length) return;
    const set = new Set(meshes);
    const hit = scene.pickWithRay(new Ray(camera.position, camera.getDirection(Vector3.Forward()), 50), (mesh) => set.has(mesh as Mesh));
    if (hit?.hit && hit.pickedPoint && hit.distance > options.minRadius) anchorAt(hit.pickedPoint);
  }
  /** Turn the eye in place: new angles, target recomputed so the position stays. */
  function look(dx: number, dy: number): void {
    stopInertia();
    const eye = camera.position.clone();
    // Mouse right = turn right (FPS convention): the eye stays, the pivot swings.
    camera.alpha -= dx * LOOK_SENSITIVITY;
    camera.beta = clampBeta(camera.beta - dy * LOOK_SENSITIVITY);
    camera.target.copyFrom(eye.subtract(directionOf(camera.alpha, camera.beta).scale(camera.radius)));
  }
  function pan(dx: number, dy: number): void {
    stopInertia();
    const right = camera.getDirection(Vector3.Right());
    const up = camera.getDirection(Vector3.Up());
    proximity = measureProximity();
    const scale = proximity * PAN_SENSITIVITY;
    camera.target.addInPlace(right.scale(-dx * scale)).addInPlace(up.scale(dy * scale));
  }
  function glideTo(to: { alpha?: number; beta?: number; radius?: number; target?: Vector3 }): void {
    stopInertia();
    glide = {
      from: { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() },
      to: { alpha: to.alpha ?? camera.alpha, beta: to.beta ?? camera.beta, radius: to.radius ?? camera.radius, target: to.target ?? camera.target.clone() },
      t: 0,
    };
  }
  function status(text: string): void { options.onStatus?.(text); }

  function frame(meshes: readonly Mesh[] = options.frameMeshes()): void {
    const live = meshes.filter((mesh) => !mesh.isDisposed() && mesh.getTotalVertices() > 0);
    if (!live.length) return;
    const minimum = new Vector3(Infinity, Infinity, Infinity);
    const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const mesh of live) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      minimum.minimizeInPlace(box.minimumWorld);
      maximum.maximizeInPlace(box.maximumWorld);
    }
    const center = minimum.add(maximum).scale(0.5);
    const size = maximum.subtract(minimum);
    const largest = Math.max(0.02, size.x, size.y, size.z);
    // The selection fills about 60% of the view height.
    const radius = clampRadius((largest / 0.6) / (2 * Math.tan(camera.fov / 2)));
    glideTo({ target: center, radius });
  }
  function anchorAt(point: Vector3): void {
    stopInertia();
    const eye = camera.position.clone();
    const offset = eye.subtract(point);
    const distance = offset.length();
    if (distance < 1e-6) return;
    camera.radius = clampRadius(distance);
    camera.alpha = Math.atan2(offset.z, offset.x);
    camera.beta = clampBeta(Math.acos(Math.min(1, Math.max(-1, offset.y / distance))));
    camera.target.copyFrom(point);
  }
  function preset(view: ViewPreset): void {
    const level = Math.PI / 2;
    const alpha = camera.alpha;
    // Keep the shortest turn from the current alpha for side views.
    const turnTo = (goal: number) => { const twoPi = Math.PI * 2; let delta = ((goal - alpha) % twoPi + twoPi) % twoPi; if (delta > Math.PI) delta -= twoPi; return alpha + delta; };
    switch (view) {
      case "front": glideTo({ alpha: turnTo(-Math.PI / 2), beta: level }); break;
      case "back": glideTo({ alpha: turnTo(Math.PI / 2), beta: level }); break;
      case "right": glideTo({ alpha: turnTo(0), beta: level }); break;
      case "left": glideTo({ alpha: turnTo(Math.PI), beta: level }); break;
      case "top": glideTo({ beta: 0.03 }); break;
      case "bottom": glideTo({ beta: Math.PI - 0.03 }); break;
    }
  }

  // ---------------------------------------------------------------- input --
  function onPointerDown(event: PointerEvent): void {
    if (event.button === 2) {
      event.preventDefault();
      last = { x: event.clientX, y: event.clientY };
      if (event.shiftKey) panning = true; else rightHeld = true;
      options.onChange?.();
    } else if (event.button === 1) {
      middleDown = { x: event.clientX, y: event.clientY };
    }
  }
  function onPointerMove(event: PointerEvent): void {
    if (!rightHeld && !panning) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    if (rightHeld) look(dx, dy); else pan(dx, dy);
  }
  function onPointerUp(event: PointerEvent): void {
    if (event.button === 2) {
      if (rightHeld || panning) {
        const wasLooking = rightHeld;
        rightHeld = false; panning = false;
        if (!flyMode) keys.clear();
        // You stay where you are; the pivot moves onto what you are looking
        // at, so the next left-drag orbits that leaf, not a point behind it.
        if (wasLooking) anchorAhead();
        options.onChange?.();
      }
    } else if (event.button === 1 && middleDown) {
      const moved = Math.hypot(event.clientX - middleDown.x, event.clientY - middleDown.y);
      middleDown = null;
      if (moved < 4) {
        const rect = canvas.getBoundingClientRect();
        const meshes = new Set(options.pickable());
        const pick = scene.pick((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), (mesh) => meshes.has(mesh as Mesh));
        if (pick?.hit && pick.pickedPoint) { anchorAt(pick.pickedPoint); status("Orbiting around the voxel you clicked"); }
      }
    }
  }
  function onContextMenu(event: MouseEvent): void { event.preventDefault(); }
  function onWheel(event: WheelEvent): void {
    const step = Math.sign(event.deltaY);
    if (event.altKey) {
      camera.fov = Math.min(1.6, Math.max(0.25, camera.fov * (1 + step * 0.08)));
      status(`Field of view ${Math.round((camera.fov * 180) / Math.PI)}°`);
    } else return; // plain wheel always zooms (Babylon); fly speed lives on the 🎮 slider
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Shift") fast = true;
    if (event.key === "Alt") slow = true;
    if (isTyping(event.target) || options.keyBlocked?.(event)) return;
    const key = event.key.toLowerCase();
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    if ((rightHeld || flyMode) && FLY_KEYS.has(key) && !event.metaKey && !event.ctrlKey) {
      if (!keys.has(key)) pressedAt.set(key, performance.now());
      keys.add(key);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!plain) return;
    if (key === "f") { frame(); event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (key === "c") { setFlyMode(!flyMode); event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (key === "1" || key === "!") { preset(event.shiftKey ? "back" : "front"); event.preventDefault(); return; }
    if (key === "3" || key === "#") { preset(event.shiftKey ? "left" : "right"); event.preventDefault(); return; }
    if (key === "7" || key === "&") { preset(event.shiftKey ? "bottom" : "top"); event.preventDefault(); return; }
  }
  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Shift") fast = false;
    if (event.key === "Alt") slow = false;
    const key = event.key.toLowerCase();
    const since = pressedAt.get(key);
    pressedAt.delete(key);
    const wasFlying = keys.delete(key);
    // A quick tap of a hold-delay key never moved the camera: it is a hotkey.
    if (wasFlying && since !== undefined && options.holdDelayKeys?.has(key) && performance.now() - since < HOLD_DELAY_MS) options.onKeyTap?.(key);
  }
  function onBlur(): void { keys.clear(); fast = false; slow = false; rightHeld = false; panning = false; options.onChange?.(); }

  function setSpeedScale(scale: number): void {
    speedScale = Math.min(5, Math.max(0.05, scale));
    status(`Fly speed ×${speedScale.toFixed(2)}`);
    options.onChange?.();
  }
  function setFlyMode(on: boolean): void {
    if (flyMode === on) return;
    flyMode = on;
    if (!on) keys.clear();
    status(on ? "Fly mode: W A S D move, Q E down/up, hold right mouse to look · C to leave" : "Fly mode off");
    options.onChange?.();
  }

  function update(dt: number): void {
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / GLIDE_SECONDS);
      const s = glide.t < 0.5 ? 4 * glide.t ** 3 : 1 - (-2 * glide.t + 2) ** 3 / 2;
      camera.alpha = glide.from.alpha + (glide.to.alpha - glide.from.alpha) * s;
      camera.beta = glide.from.beta + (glide.to.beta - glide.from.beta) * s;
      camera.radius = glide.from.radius + (glide.to.radius - glide.from.radius) * s;
      camera.target.copyFrom(Vector3.Lerp(glide.from.target, glide.to.target, s));
      if (glide.t >= 1) glide = null;
    }
    if (!keys.size || !(rightHeld || flyMode)) return;
    const move = new Vector3(0, 0, 0);
    const forward = camera.getDirection(Vector3.Forward());
    const right = camera.getDirection(Vector3.Right());
    const now = performance.now();
    const active = (key: string) => keys.has(key) && (!options.holdDelayKeys?.has(key) || now - (pressedAt.get(key) ?? now) >= HOLD_DELAY_MS);
    if (active("w")) move.addInPlace(forward);
    if (active("s")) move.subtractInPlace(forward);
    if (active("d")) move.addInPlace(right);
    if (active("a")) move.subtractInPlace(right);
    if (active("e")) move.y += 1;
    if (active("q")) move.y -= 1;
    if (move.lengthSquared() < 1e-9) return;
    // Speed follows how close you are to the nearest geometry (smoothed so it
    // never jumps): metres per second ≈ that distance, so a close-up on one
    // leaf creeps voxel by voxel and a wide shot crosses the table.
    const measured = measureProximity();
    proximity += (measured - proximity) * Math.min(1, dt * 10);
    const speed = proximity * speedScale * (fast ? 3.5 : slow ? 0.25 : 1);
    stopInertia();
    camera.target.addInPlace(move.normalize().scale(speed * dt));
  }

  function legend(): string {
    if (rightHeld) return "Looking · W A S D fly · Q E down/up · Shift fast · Alt slow · scroll: zoom";
    if (flyMode) return "🎥 Fly mode (C leaves) · W A S D · Q E down/up · right-hold: look · Shift fast · Alt slow · F: frame · middle-click: orbit here";
    return "Drag: orbit · Right-hold: look + WASD fly · Middle-drag / Shift+right-drag: pan · Scroll: zoom · F: frame · C: fly mode · middle-click: orbit here · 1/3/7: views · Alt+scroll: FOV";
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);

  return {
    get flyMode() { return flyMode; },
    get flying() { return rightHeld || flyMode; },
    get speedScale() { return speedScale; },
    setFlyMode,
    setSpeedScale,
    frame,
    anchorAt,
    preset,
    resetFov() { camera.fov = DEFAULT_FOV; },
    legend,
    update,
    dispose() {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    },
  };
}
