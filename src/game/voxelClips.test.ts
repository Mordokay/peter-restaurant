import test from "node:test";
import assert from "node:assert/strict";
import { applyPoseOffsets, blendWeight, clipTime, ease, eventsBetween, matchClipTime, poseDistance, poseOffsets, sampleClip, withKey, withoutKey } from "./voxelClips.ts";
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

const openDoor: AuthoredClip = {
  id: "open", duration: 1.1,
  tracks: [{ part: "door", keys: [{ t: 0, rotation: [0, 0, 0], ease: "out" }, { t: 1.1, rotation: [0, 112, 0], ease: "out" }] }],
};
const closeDoor: AuthoredClip = {
  id: "close", duration: 0.85,
  tracks: [{ part: "door", keys: [{ t: 0, rotation: [0, 112, 0], ease: "in" }, { t: 0.85, rotation: [0, 0, 0], ease: "out" }] }],
};

test("matching finds the moment in a clip that stands closest to a pose", () => {
  const standing = sampleClip(openDoor, 0.4); // part-way open
  const yaw = standing.get("door")!.rotation[1];
  const matched = matchClipTime(closeDoor, standing);
  assert.ok(matched > 0 && matched < closeDoor.duration, `matched ${matched} should be inside the close`);
  const landing = sampleClip(closeDoor, matched).get("door")!.rotation[1];
  assert.ok(Math.abs(landing - yaw) < 0.5, `close at ${matched}s stands at ${landing}°, not the ${yaw}° we are in`);
  // A door barely ajar is nearly shut, so the close it joins is nearly over.
  assert.ok(matchClipTime(closeDoor, sampleClip(openDoor, 0.02)) > matched, "less to close means starting later");
  assert.equal(matchClipTime(closeDoor, sampleClip(openDoor, openDoor.duration)), 0, "fully open joins the close at its start");
});

test("an unmatched difference is captured as an offset that decays to nothing", () => {
  const standing = sampleClip(openDoor, 0.4);
  const offsets = poseOffsets(standing, sampleClip(closeDoor, 0));
  assert.ok(Math.abs(offsets.get("door")!.rotation[1]) > 1, "cutting to the open close leaves a real step");
  const full = applyPoseOffsets(sampleClip(closeDoor, 0), offsets, 1).get("door")!;
  assert.ok(Math.abs(full.rotation[1] - standing.get("door")!.rotation[1]) < 1e-9, "at full weight the pose is exactly where we stood");
  const none = applyPoseOffsets(sampleClip(closeDoor, 0), offsets, 0).get("door")!;
  assert.equal(none.rotation[1], 112, "at zero weight the clip is left alone");
  assert.equal(poseOffsets(standing, standing).size, 0, "no step, no offset");
  assert.equal(blendWeight(0, 0.2), 1);
  assert.equal(blendWeight(0.2, 0.2), 0);
  assert.ok(blendWeight(0.1, 0.2) < 0.5, "the ease is front-loaded, so the step is mostly gone by halfway");
  assert.ok(blendWeight(0.19, 0.2) < 0.001, "and it lands on zero rather than stopping short");
});

test("a part the new clip ignores still eases back instead of snapping", () => {
  const waving: AuthoredClip = { id: "wave", duration: 1, tracks: [{ part: "arm", keys: [{ t: 0, rotation: [0, 0, 0] }, { t: 1, rotation: [30, 0, 0] }] }] };
  const offsets = poseOffsets(sampleClip(waving, 1), sampleClip(closeDoor, 0));
  const blended = applyPoseOffsets(sampleClip(closeDoor, 0), offsets, 0.5);
  assert.ok(blended.has("arm"), "the arm is still posed by the blend");
  assert.equal(blended.get("arm")!.rotation[0], 15);
});
