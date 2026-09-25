// How big the game's own UI draws, as one number every piece of it reads.
//
// The cabinet, the cues and everything else built out of voxels live in the
// world rather than on the screen, so "bigger UI" cannot be a CSS rule. It is a
// multiplier on the size those things take, held here and saved, because the
// player sets it once and expects it back tomorrow — and because a setting that
// lives in one module is a setting the options screen can show without any
// piece of UI knowing the options screen exists.
import { readSave, writeSave, type VersionedSave } from "./persistence.ts";

export const UI_SCALE_KEY = "ui-scale";
const UI_SCALE_VERSION = 1;

/** Half again as small as normal is as far as it is worth going: past that the
 *  voxel font stops resolving and the UI is a smudge. */
export const UI_SCALE_MIN = 0.6;
export const UI_SCALE_MAX = 2.5;
/** Bigger than life size out of the box. Measured against the cabinet at the
 *  default zoom, 1.0 read as small on a large screen. */
export const UI_SCALE_DEFAULT = 1.35;

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, value));
}

interface UiScaleSave extends VersionedSave {
  version: typeof UI_SCALE_VERSION;
  scale: number;
}

let current = ((): number => {
  const saved = readSave<UiScaleSave>(UI_SCALE_KEY, UI_SCALE_VERSION);
  return saved ? clampUiScale(saved.scale) : UI_SCALE_DEFAULT;
})();

const listeners = new Set<(scale: number) => void>();

/** What everything drawing UI multiplies its size by. */
export function uiScale(): number {
  return current;
}

/** Set it, save it, and tell whoever is drawing. Returns what it actually
 *  became, which is the clamped value. */
export function setUiScale(value: number): number {
  const next = clampUiScale(value);
  if (next === current) return current;
  current = next;
  writeSave<UiScaleSave>(UI_SCALE_KEY, { version: UI_SCALE_VERSION, savedAt: Date.now(), scale: next });
  for (const listener of listeners) listener(next);
  return current;
}

/** Listen for changes. Returns the function that stops listening. */
export function onUiScale(listener: (scale: number) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
