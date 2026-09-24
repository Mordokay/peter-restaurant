// Pure stage-transition math, kept free of Babylon so it is unit-testable in
// Node and reusable by any staged rig (crops, equipment, NPCs).

export const TOMATO_STAGE_SECONDS = 0.5;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Growth with a settle overshoot: the scale passes its target, then falls back
 *  onto it, so something arriving looks like it arrived rather than like it was
 *  faded in. Used for a new stage pushing out of the soil and for fruit
 *  regrowing on a picked plant — the animation direction asks for the same beat
 *  in both places, so it is one function.
 *
 *  `settle` sizes the bump added over the second half of the curve. The visible
 *  overshoot is a little under it, because the bump peaks slightly before the
 *  ease does; measure the peak rather than reading `settle` as a percentage. */
export function growWithOvershoot(progress: number, settle: number): number {
  const t = Math.max(0, Math.min(1, progress));
  if (t >= 1) return 1;
  const late = Math.max(0, 2 * t - 1);
  return Math.max(0, easeInOutCubic(t) + settle * 4 * late * (1 - late));
}

/** Fruit coming back after a pick, overshooting by about 11% — a visible pop at
 *  the game camera, short of looking like it bounced. */
export const FRUIT_REGROW_SETTLE = 0.18;

/** Cross-scale for a stage change: the outgoing stage shrinks into the ground
 * (plain ease-in-out), the incoming one grows out of it with a small settle
 * overshoot — growth lands with a touch of energy per the animation
 * direction, while the shrink never draws attention to itself. */
export function stageScales(progress: number): { outgoing: number; incoming: number } {
  const t = Math.max(0, Math.min(1, progress));
  return { outgoing: 1 - easeInOutCubic(t), incoming: growWithOvershoot(t, 0.045) };
}
