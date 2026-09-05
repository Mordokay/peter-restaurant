// Pure stage-transition math, kept free of Babylon so it is unit-testable in
// Node and reusable by any staged rig (crops, equipment, NPCs).

export const TOMATO_STAGE_SECONDS = 0.5;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Cross-scale for a stage change: the outgoing stage shrinks into the ground
 * (plain ease-in-out), the incoming one grows out of it with a small settle
 * overshoot — growth lands with a touch of energy per the animation
 * direction, while the shrink never draws attention to itself. */
export function stageScales(progress: number): { outgoing: number; incoming: number } {
  const t = Math.max(0, Math.min(1, progress));
  const settle = 0.06;
  const grow = easeInOutCubic(t);
  const incoming = t >= 1 ? 1 : grow * (1 + settle) - settle * Math.max(0, 2 * t - 1) ** 2;
  return { outgoing: 1 - easeInOutCubic(t), incoming: Math.max(0, incoming) };
}
