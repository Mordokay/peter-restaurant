import test from "node:test";
import assert from "node:assert/strict";
import { clipTime, ease, eventsBetween, sampleClip, withKey, withoutKey } from "./voxelClips.ts";
import type { AuthoredClip } from "./voxelModel.ts";

const sway: AuthoredClip = {
  id: "sway",
  duration: 2,
  loop: true,
  tracks: [
    { part: "leaf", keys: [{ t: 0, rotation: [0, 0, -4] }, { t: 1, rotation: [0, 0, 4], ease: "inOut" }, { t: 2, rotation: [0, 0, -4], ease: "inOut" }] },
    { part: "*", keys: [{ t: 0, scale: [1, 1, 1] }, { t: 2, scale: [1, 1, 1] }] },
  ],
  events: [{ t: 0.5, name: "rustle" }, { t: 1.5, name: "rustle" }],
};

test("easing curves start at 0, end at 1, and back overshoots", () => {
  for (const kind of ["linear", "in", "out", "inOut", "back", "step"] as const) {
    assert.ok(Math.abs(ease(kind, 0)) < 1e-9, kind);
    assert.ok(Math.abs(ease(kind, 1) - 1) < 1e-9, kind);
  }
  assert.ok(ease("back", 0.7) > 1, "back overshoots past the target before settling");
  assert.equal(ease("step", 0.99), 0);
});

test("sampling interpolates between keys, holds outside them, and wraps loops", () => {
  const mid = sampleClip(sway, 0.5).get("leaf")!;
  assert.ok(mid.rotation[2] > -4 && mid.rotation[2] < 4);
  assert.deepEqual(sampleClip(sway, 1).get("leaf")!.rotation, [0, 0, 4]);
  assert.deepEqual(sampleClip(sway, 3).get("leaf")!.rotation, [0, 0, 4], "loops wrap: t=3 is t=1");
  assert.deepEqual(mid.position, [0, 0, 0], "channels without keys rest");
  assert.deepEqual(mid.scale, [1, 1, 1]);
  assert.equal(clipTime({ ...sway, loop: false }, 5), 2, "non-loop clamps");
  assert.deepEqual(sampleClip({ ...sway, loop: false }, 5).get("leaf")!.rotation, [0, 0, -4]);
});

test("events fire once inside a window, including across the loop point", () => {
  assert.deepEqual(eventsBetween(sway, 0.4, 0.6).map((e) => e.t), [0.5]);
  assert.deepEqual(eventsBetween(sway, 0.6, 1.4).map((e) => e.t), []);
  assert.deepEqual(eventsBetween(sway, 1.9, 2.6).map((e) => e.t), [0.5], "wrapped window catches the event after the loop point");
  assert.deepEqual(eventsBetween(sway, 0, 4.1).length, 4, "two full laps");
  const oneShot: AuthoredClip = { id: "pop", duration: 1, tracks: [], events: [{ t: 0, name: "start" }, { t: 1, name: "end" }] };
  assert.deepEqual(eventsBetween(oneShot, 0, 0.1).map((e) => e.name), ["start"], "an event at t=0 fires when playback starts");
  assert.deepEqual(eventsBetween(oneShot, 0.9, 1.5).map((e) => e.name), ["end"]);
});

test("keys can be set, replaced, and removed while staying sorted", () => {
  let clip = withKey(sway, "fruit", { t: 1, scale: [1.2, 1.2, 1.2], ease: "back" });
  clip = withKey(clip, "fruit", { t: 0.25, scale: [1, 1, 1] });
  assert.deepEqual(clip.tracks.find((t) => t.part === "fruit")!.keys.map((k) => k.t), [0.25, 1]);
  clip = withKey(clip, "fruit", { t: 1, scale: [0, 0, 0] });
  assert.deepEqual(clip.tracks.find((t) => t.part === "fruit")!.keys[1]!.scale, [0, 0, 0], "same time replaces");
  assert.equal(clip.tracks.find((t) => t.part === "fruit")!.keys[1]!.ease, "back", "merge keeps the untouched fields");
  clip = withoutKey(clip, "fruit", 0.25);
  clip = withoutKey(clip, "fruit", 1);
  assert.equal(clip.tracks.some((t) => t.part === "fruit"), false, "empty tracks disappear");
});

test("a state key animates its switch over the segment leading into it", () => {
  const clip: AuthoredClip = {
    id: "eat", duration: 2,
    tracks: [{ part: "fruit", keys: [{ t: 0, rotation: [0, 0, 0] }, { t: 0.5, rotation: [0, 10, 0], ease: "linear" }, { t: 1, state: "bite", ease: "linear", transitionDirection: "-y" }, { t: 1.5, state: "gone", transition: "cut" }] }],
  };
  const at = (t: number) => sampleClip(clip, t).get("fruit")!;
  assert.equal(at(0.25).transition, undefined, "no state key ahead within its segment yet");
  assert.equal(at(0.5).state, undefined);
  const mid = at(0.75);
  assert.deepEqual({ from: mid.transition?.from, to: mid.transition?.to, mode: mid.transition?.mode, direction: mid.transition?.direction }, { from: "base", to: "bite", mode: "blend", direction: "-y" });
  assert.ok(Math.abs((mid.transition?.progress ?? 0) - 0.5) < 1e-9, "linear: halfway through the 0.5→1 segment");
  assert.equal(at(1).state, "bite");
  assert.equal(at(1).transition, undefined, "at the key the switch is complete");
  assert.equal(at(1.25).transition, undefined, "a cut switch has no run-up");
  assert.equal(at(1.5).state, "gone");
});

test("opacity is a key channel with rest 1, eased like the others", () => {
  const clip: AuthoredClip = { id: "smoke", duration: 2, tracks: [{ part: "puff", fade: "dither", keys: [{ t: 0, opacity: 1 }, { t: 1, opacity: 0, ease: "linear" }] }, { part: "other", keys: [{ t: 0, rotation: [0, 0, 0] }] }] };
  const puff = (t: number) => sampleClip(clip, t).get("puff")!;
  assert.equal(puff(0).opacity, 1);
  assert.ok(Math.abs((puff(0.5).opacity ?? 0) - 0.5) < 1e-9);
  assert.equal(puff(1.5).opacity, 0, "holds the last key");
  assert.equal(puff(0.5).fade, "dither");
  assert.equal(sampleClip(clip, 0.5).get("other")?.opacity, 1, "tracks without opacity keys stay solid");
});
