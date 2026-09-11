// Time of day for the game scene. The hour drives the sun (direction, colour,
// strength), the sky and ambient light, how much the glowing voxels bloom and how
// bright the pooled lamp lights are — so a dinner service slides from late
// afternoon through sunset into a lamp-lit night. The hour itself follows the shift:
// prep is the morning, the menu pause late morning, dinner the evening, close the night.
import { Color3, Color4, Vector3, type DirectionalLight, type GlowLayer, type HemisphericLight, type Scene } from "@babylonjs/core";
import type { LightPool } from "./lighting.ts";

export interface Lighting {
  /** Sky (clear colour). */
  sky: string;
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  groundColor: string;
  /** GlowLayer intensity for emissive voxels. */
  glow: number;
  /** Multiplier for pooled lamp lights. */
  lamps: number;
}

/** Keyframes by hour; between them everything interpolates. The 8:00 sky is the game's original clear colour. */
const KEYS: { hour: number; look: Lighting }[] = [
  { hour: 0, look: { sky: "#1a2233", sunColor: "#8fa3d8", sunIntensity: 0.08, ambientColor: "#8f9fc8", ambientIntensity: 0.38, groundColor: "#2b3140", glow: 1.15, lamps: 1 } },
  { hour: 5, look: { sky: "#1a2233", sunColor: "#8fa3d8", sunIntensity: 0.08, ambientColor: "#8f9fc8", ambientIntensity: 0.38, groundColor: "#2b3140", glow: 1.15, lamps: 1 } },
  { hour: 6.5, look: { sky: "#d9a27a", sunColor: "#ffb27a", sunIntensity: 0.8, ambientColor: "#ffd9b8", ambientIntensity: 0.72, groundColor: "#4d4a48", glow: 0.8, lamps: 0.8 } },
  { hour: 8, look: { sky: "#a9c889", sunColor: "#fff1dc", sunIntensity: 1.6, ambientColor: "#fff2d2", ambientIntensity: 1.0, groundColor: "#65755c", glow: 0.45, lamps: 0.35 } },
  { hour: 12, look: { sky: "#b3d0a0", sunColor: "#fff8ee", sunIntensity: 1.8, ambientColor: "#fff6e6", ambientIntensity: 1.05, groundColor: "#6b7a60", glow: 0.3, lamps: 0.15 } },
  { hour: 17.5, look: { sky: "#b9c98a", sunColor: "#ffe2b0", sunIntensity: 1.4, ambientColor: "#ffe9cc", ambientIntensity: 0.95, groundColor: "#66705a", glow: 0.45, lamps: 0.35 } },
  { hour: 19.5, look: { sky: "#e08a5a", sunColor: "#ff9a5a", sunIntensity: 0.65, ambientColor: "#ffcfae", ambientIntensity: 0.7, groundColor: "#5a4a44", glow: 0.85, lamps: 0.75 } },
  { hour: 21, look: { sky: "#3a4468", sunColor: "#9fb0f0", sunIntensity: 0.14, ambientColor: "#a8b6d8", ambientIntensity: 0.46, groundColor: "#333a4c", glow: 1.1, lamps: 1 } },
  { hour: 23, look: { sky: "#1a2233", sunColor: "#8fa3d8", sunIntensity: 0.08, ambientColor: "#8f9fc8", ambientIntensity: 0.38, groundColor: "#2b3140", glow: 1.15, lamps: 1 } },
  { hour: 24, look: { sky: "#1a2233", sunColor: "#8fa3d8", sunIntensity: 0.08, ambientColor: "#8f9fc8", ambientIntensity: 0.38, groundColor: "#2b3140", glow: 1.15, lamps: 1 } },
];

const mixHex = (a: string, b: string, t: number): string => Color3.Lerp(Color3.FromHexString(a), Color3.FromHexString(b), t).toHexString().toLowerCase();
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The look at an hour of the day (0–24, wraps). */
export function lightingAt(hourOfDay: number): Lighting {
  const hour = ((hourOfDay % 24) + 24) % 24;
  let index = 0;
  while (index < KEYS.length - 2 && KEYS[index + 1]!.hour <= hour) index++;
  const a = KEYS[index]!, b = KEYS[index + 1]!;
  const t = Math.min(1, Math.max(0, (hour - a.hour) / (b.hour - a.hour)));
  const s = t * t * (3 - 2 * t); // smoothstep: no kinks at the keyframes
  return {
    sky: mixHex(a.look.sky, b.look.sky, s), sunColor: mixHex(a.look.sunColor, b.look.sunColor, s), sunIntensity: mix(a.look.sunIntensity, b.look.sunIntensity, s),
    ambientColor: mixHex(a.look.ambientColor, b.look.ambientColor, s), ambientIntensity: mix(a.look.ambientIntensity, b.look.ambientIntensity, s), groundColor: mixHex(a.look.groundColor, b.look.groundColor, s),
    glow: mix(a.look.glow, b.look.glow, s), lamps: mix(a.look.lamps, b.look.lamps, s),
  };
}

/** Direction the sun light shines in (unit vector) — east at 6:00, overhead at noon, west at 18:00; never below ~15° so shadows keep their shape at night. */
export function sunDirectionAt(hourOfDay: number): Vector3 {
  const hour = ((hourOfDay % 24) + 24) % 24;
  const azimuth = (Math.PI * (hour - 6)) / 12; // 0 = east, π = west
  const elevation = Math.max(0.26, Math.sin(Math.max(0, Math.min(Math.PI, azimuth))) * 1.1);
  const toSun = new Vector3(-Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), 0.55 * Math.cos(elevation));
  return toSun.normalize().scaleInPlace(-1);
}

/** The shift maps onto the clock: prep is the morning, the menu pause late morning, dinner the evening, close the night. */
export function hourForShift(phase: string, progress: number, secondsInPhase: number): number {
  const p = Math.min(1, Math.max(0, progress));
  switch (phase) {
    case "prep": return 7 + 3 * p;                                  // 07:00 → 10:00
    case "choose_menu": return 10 + Math.min(1, secondsInPhase / 90); // 10:00 → 11:00 then holds
    case "dinner": return 17.5 + 4.5 * p;                           // 17:30 → 22:00, sunset on the way
    case "close": return 22 + Math.min(1.5, secondsInPhase / 60);   // 22:00 → 23:30 then holds
    default: return 12;
  }
}

export interface DayNight {
  /** Current hour of day (smoothed). */
  readonly hour: number;
  /** Hour the scene is heading to (jumps between phases sweep in over a few seconds). */
  setTarget(hour: number): void;
  /** Jump straight to an hour (captures, debugging). */
  setHour(hour: number): void;
  /** Hold the clock at a fixed hour (an `?hour=` capture); null resumes the shift clock. */
  freeze(hour: number | null): void;
  readonly frozen: boolean;
  update(dt: number): void;
  /** "07:24" style label. */
  label(): string;
}

export function createDayNight(scene: Scene, targets: { sun: DirectionalLight; ambient: HemisphericLight; glow?: GlowLayer; lightPool?: LightPool }, options: { hour?: number; sweepHoursPerSecond?: number } = {}): DayNight {
  let hour = options.hour ?? 7;
  let target = hour;
  let frozenAt: number | null = null;
  const sweep = options.sweepHoursPerSecond ?? 2;
  const apply = (): void => {
    const look = lightingAt(hour);
    scene.clearColor = Color4.FromHexString(`${look.sky}ff`);
    targets.sun.direction.copyFrom(sunDirectionAt(hour));
    targets.sun.diffuse = Color3.FromHexString(look.sunColor);
    targets.sun.intensity = look.sunIntensity;
    targets.ambient.diffuse = Color3.FromHexString(look.ambientColor);
    targets.ambient.groundColor = Color3.FromHexString(look.groundColor);
    targets.ambient.intensity = look.ambientIntensity;
    if (targets.glow) targets.glow.intensity = look.glow;
    targets.lightPool?.setIntensityScale(look.lamps);
  };
  apply();
  return {
    get hour() { return hour; },
    get frozen() { return frozenAt !== null; },
    setTarget(h) { if (frozenAt === null) target = h; },
    setHour(h) { hour = h; target = h; apply(); },
    freeze(h) { frozenAt = h; if (h !== null) { hour = h; target = h; apply(); } },
    update(dt) {
      if (frozenAt !== null) return;
      if (Math.abs(target - hour) < 1e-4) return;
      const step = Math.min(Math.abs(target - hour), sweep * dt);
      hour += Math.sign(target - hour) * step;
      apply();
    },
    label() {
      const h = ((hour % 24) + 24) % 24;
      const whole = Math.floor(h), minutes = Math.floor((h - whole) * 60);
      return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    },
  };
}
