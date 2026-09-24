import type { AuthoredClip, ClipEase, ClipEvent, ClipKey, FadeMode, StateTransition, TransitionDirection } from "./voxelModel.ts";

// Babylon-free clip sampling for rigged voxel models. A clip is a set of
// tracks (one per part, or "*" for the whole model), each a sorted list of
// keys holding rotation (degrees), position (cells) and scale. Sampling a
// time returns the pose of every animated part; keys ease INTO themselves so
// the same key list reads naturally in the editor's timeline.

export type Triple = readonly [number, number, number];

export interface PartPose {
  rotation: Triple;
  position: Triple;
  scale: Triple;
  /** Voxel state to show (undefined = "base"): the latest key at or before t that names one. */
  state?: string;
  /** While approaching the next state key: how far along the switch is (eased). */
  transition?: StateTransitionSample;
  /** 1 = solid (default); below 1 the part fades or dithers out per `fade`. */
  opacity?: number;
  fade?: FadeMode;
}

export interface StateTransitionSample {
  from: string;
  to: string;
  /** 0 → 1 over the segment from the previous key to the state key. */
  progress: number;
  mode: StateTransition;
  direction: TransitionDirection;
}

/** A state key with no key before it still gets a short run-up. */
const LONE_TRANSITION_SECONDS = 0.25;

export const REST_POSE: PartPose = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1], opacity: 1 };

export function ease(kind: ClipEase | undefined, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case "in": return x * x * x;
    case "out": return 1 - (1 - x) ** 3;
    case "back": {
      // Overshoot a little past the target, then settle: the house style for
      // pops and pose changes (10-20% overshoot from the rulebook).
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
    }
    case "step": return x >= 1 ? 1 : 0;
    case "linear": return x;
    case "inOut":
    default: return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

const lerp3 = (a: Triple, b: Triple, s: number): Triple => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];

/** Time within the clip: wrapped for loops, clamped otherwise. */
export function clipTime(clip: AuthoredClip, t: number): number {
  if (clip.duration <= 0) return 0;
  if (clip.loop) {
    const wrapped = t % clip.duration;
    return wrapped < 0 ? wrapped + clip.duration : wrapped;
  }
  return Math.min(clip.duration, Math.max(0, t));
}

/** Resolve one channel of a key list at time t: missing channels fall back to
 * the rest value, so a key can set only rotation and leave position alone. */
function sampleChannel(keys: readonly ClipKey[], channel: "rotation" | "position" | "scale", t: number): Triple {
  const rest = REST_POSE[channel];
  const relevant = keys.filter((key) => key[channel] !== undefined && !key.disabled);
  if (relevant.length === 0) return rest;
  if (t <= relevant[0]!.t) return relevant[0]![channel]!;
  const last = relevant[relevant.length - 1]!;
  if (t >= last.t) return last[channel]!;
  for (let i = 1; i < relevant.length; i++) {
    const next = relevant[i]!;
    if (t > next.t) continue;
    const previous = relevant[i - 1]!;
    const span = next.t - previous.t;
    const s = span <= 0 ? 1 : ease(next.ease, (t - previous.t) / span);
    return lerp3(previous[channel]!, next[channel]!, s);
  }
  return last[channel]!;
}

/** One number channel (opacity): same rules as the triples, rest value given. */
function sampleScalar(keys: readonly ClipKey[], channel: "opacity", t: number, rest: number): number {
  const relevant = keys.filter((key) => key[channel] !== undefined && !key.disabled);
  if (relevant.length === 0) return rest;
  if (t <= relevant[0]!.t) return relevant[0]![channel]!;
  const last = relevant[relevant.length - 1]!;
  if (t >= last.t) return last[channel]!;
  for (let i = 1; i < relevant.length; i++) {
    const next = relevant[i]!;
    if (t > next.t) continue;
    const previous = relevant[i - 1]!;
    const span = next.t - previous.t;
    const s = span <= 0 ? 1 : ease(next.ease, (t - previous.t) / span);
    return previous[channel]! + (next[channel]! - previous[channel]!) * s;
  }
  return last[channel]!;
}

/** Pose of every animated part at time t (already wrapped/clamped). */
export function sampleClip(clip: AuthoredClip, t: number): Map<string, PartPose> {
  const time = clipTime(clip, t);
  const poses = new Map<string, PartPose>();
  for (const track of clip.tracks) {
    const pose: PartPose = {
      rotation: sampleChannel(track.keys, "rotation", time),
      position: sampleChannel(track.keys, "position", time),
      scale: sampleChannel(track.keys, "scale", time),
      opacity: sampleScalar(track.keys, "opacity", time, 1),
      fade: track.fade,
    };
    const live = track.keys.filter((key) => !key.disabled);
    for (const key of live) if (key.state !== undefined && key.t <= time + 1e-9) pose.state = key.state;
    // Approaching a state key: the switch plays over the segment leading into it.
    const next = live.find((key) => key.state !== undefined && key.t > time + 1e-9);
    if (next && (next.transition ?? "blend") !== "cut") {
      const before = live.filter((key) => key.t < next.t - 1e-9).map((key) => key.t);
      const start = before.length ? Math.max(...before) : Math.max(0, next.t - LONE_TRANSITION_SECONDS);
      const span = next.t - start;
      if (time >= start - 1e-9 && span > 0) {
        const from = pose.state ?? "base";
        if (from !== next.state) pose.transition = { from, to: next.state!, progress: ease(next.ease, (time - start) / span), mode: next.transition ?? "blend", direction: next.transitionDirection ?? "random" };
      }
    }
    poses.set(track.part, pose);
  }
  return poses;
}

/** Events whose time lies in (from, to]; for loops the window may wrap. */
export function eventsBetween(clip: AuthoredClip, from: number, to: number): ClipEvent[] {
  const events = clip.events ?? [];
  if (events.length === 0 || to <= from) return [];
  if (!clip.loop) {
    const a = Math.min(clip.duration, Math.max(0, from));
    const b = Math.min(clip.duration, Math.max(0, to));
    return events.filter((event) => event.t > a && event.t <= b || (from <= 0 && event.t === 0 && to > 0));
  }
  const laps = Math.floor(to / clip.duration) - Math.floor(from / clip.duration);
  const a = clipTime(clip, from);
  const b = clipTime(clip, to);
  if (laps === 0) return events.filter((event) => event.t > a && event.t <= b);
  // Crossed the loop point: everything after `a`, then everything up to `b`.
  const out = events.filter((event) => event.t > a);
  for (let lap = 1; lap < laps; lap++) out.push(...events);
  out.push(...events.filter((event) => event.t <= b));
  return out;
}

/** Insert or replace a key (same part, same time) keeping keys sorted. */
export function withKey(clip: AuthoredClip, part: string, key: ClipKey): AuthoredClip {
  const tracks = clip.tracks.map((track) => ({ ...track, keys: [...track.keys] }));
  let track = tracks.find((candidate) => candidate.part === part);
  if (!track) { track = { part, keys: [] }; tracks.push(track); }
  const existing = track.keys.findIndex((candidate) => Math.abs(candidate.t - key.t) < 1e-6);
  if (existing >= 0) track.keys[existing] = { ...track.keys[existing], ...key };
  else track.keys.push(key);
  track.keys.sort((a, b) => a.t - b.t);
  return { ...clip, tracks };
}

export function withoutKey(clip: AuthoredClip, part: string, t: number): AuthoredClip {
  const tracks = clip.tracks
    .map((track) => (track.part === part ? { ...track, keys: track.keys.filter((key) => Math.abs(key.t - t) >= 1e-6) } : track))
    .filter((track) => track.keys.length > 0);
  return { ...clip, tracks };
}

// ---------------------------------------------------------- transitions --
// Interrupting one clip with another. Cutting to the first frame of the new
// clip snaps the rig — close a half-open door and it jumps wide before it
// swings. Games solve this two ways, and both are worth having:
//
//   * POSE MATCHING — start the new clip at the time whose pose is closest to
//     the one we are standing in. A door caught 40% of the way open starts
//     40% of the way through the close and takes the remaining 60% of the
//     time, which is also what a real door does. (Unreal calls this pose
//     matching; the sync markers that keep a walk from snapping mid-stride
//     are the same idea applied to a loop.)
//   * INERTIALIZATION — whatever difference is left after the match is
//     captured as a pose offset and decays to zero over a short blend, so the
//     switch has no visible step even when no time in the clip matches well.
//     Cheaper than a cross-fade: the outgoing clip is never sampled again.
//
// Matching alone leaves a step whenever the clips are not mirror images;
// blending alone preserves the jump as a fast slide. Together they read as
// one continuous movement.

/** A cell of travel is worth two degrees of turn, a whole unit of scale ninety. */
const POSITION_WEIGHT = 2;
const SCALE_WEIGHT = 90;

export interface PoseOffset { rotation: Triple; position: Triple; scale: Triple }

/** How far apart two poses of one part are, in rough "degrees of difference". */
export function poseDistance(a: PartPose | undefined, b: PartPose | undefined): number {
  const x = a ?? REST_POSE, y = b ?? REST_POSE;
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    sum += Math.abs(x.rotation[i]! - y.rotation[i]!);
    sum += Math.abs(x.position[i]! - y.position[i]!) * POSITION_WEIGHT;
    sum += Math.abs(x.scale[i]! - y.scale[i]!) * SCALE_WEIGHT;
  }
  return sum;
}

/** The time in `clip` whose pose sits closest to `pose`, over the parts the clip drives. */
export function matchClipTime(clip: AuthoredClip, pose: Map<string, PartPose>, options: { samples?: number } = {}): number {
  if (clip.duration <= 0 || clip.tracks.length === 0) return 0;
  const cost = (t: number): number => {
    let sum = 0;
    for (const [part, candidate] of sampleClip(clip, t)) sum += poseDistance(pose.get(part), candidate);
    return sum;
  };
  // A coarse sweep finds the right part of the timeline; the clip may dip and
  // rise again (a door that overshoots), so the whole thing has to be walked.
  const steps = Math.min(240, Math.max(12, Math.round(options.samples ?? clip.duration * 60)));
  let best = 0, bestCost = cost(0);
  for (let i = 1; i <= steps; i++) {
    const t = (clip.duration * i) / steps;
    const c = cost(t);
    if (c < bestCost) { bestCost = c; best = t; }
  }
  // Then refine between the neighbouring samples, where the cost is a simple
  // valley, so the start time is not quantized to the sweep's grid.
  let lo = Math.max(0, best - clip.duration / steps), hi = Math.min(clip.duration, best + clip.duration / steps);
  for (let i = 0; i < 24 && hi - lo > 1e-4; i++) {
    const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
    if (cost(a) <= cost(b)) hi = b; else lo = a;
  }
  const refined = (lo + hi) / 2;
  return cost(refined) <= bestCost ? refined : best;
}

/** The difference `from` - `to`, per part: the step a plain cut would show. */
export function poseOffsets(from: Map<string, PartPose>, to: Map<string, PartPose>): Map<string, PoseOffset> {
  const offsets = new Map<string, PoseOffset>();
  for (const part of new Set([...from.keys(), ...to.keys()])) {
    const a = from.get(part) ?? REST_POSE, b = to.get(part) ?? REST_POSE;
    const offset: PoseOffset = {
      rotation: [a.rotation[0] - b.rotation[0], a.rotation[1] - b.rotation[1], a.rotation[2] - b.rotation[2]],
      position: [a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]],
      scale: [a.scale[0] - b.scale[0], a.scale[1] - b.scale[1], a.scale[2] - b.scale[2]],
    };
    const moved = offset.rotation.some((v) => Math.abs(v) > 1e-6) || offset.position.some((v) => Math.abs(v) > 1e-6) || offset.scale.some((v) => Math.abs(v) > 1e-6);
    if (moved) offsets.set(part, offset);
  }
  return offsets;
}

/** Add a decaying share of the offsets back onto a sampled pose. A part the new
 *  clip does not drive is still returned, so it eases back to rest rather than snapping. */
export function applyPoseOffsets(poses: Map<string, PartPose>, offsets: Map<string, PoseOffset>, weight: number): Map<string, PartPose> {
  if (weight <= 0 || offsets.size === 0) return poses;
  const out = new Map(poses);
  for (const [part, offset] of offsets) {
    const pose = out.get(part) ?? REST_POSE;
    out.set(part, {
      ...pose,
      rotation: [pose.rotation[0] + offset.rotation[0] * weight, pose.rotation[1] + offset.rotation[1] * weight, pose.rotation[2] + offset.rotation[2] * weight],
      position: [pose.position[0] + offset.position[0] * weight, pose.position[1] + offset.position[1] * weight, pose.position[2] + offset.position[2] * weight],
      scale: [pose.scale[0] + offset.scale[0] * weight, pose.scale[1] + offset.scale[1] * weight, pose.scale[2] + offset.scale[2] * weight],
    });
  }
  return out;
}

/** Offset weight over a blend: 1 at the switch, easing to 0 with no kick at the end. */
export function blendWeight(elapsed: number, duration: number): number {
  if (duration <= 0) return 0;
  const x = Math.min(1, Math.max(0, elapsed / duration));
  return (1 - x) ** 3;
}
