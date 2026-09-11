import test from "node:test";
import assert from "node:assert/strict";
import { NullEngine, Scene } from "@babylonjs/core";
import { createClipPlayer, createVoxelRig } from "./voxelRig.ts";
import type { AuthoredVoxelModel } from "./voxelModel.ts";

/** A cabinet with one hinged door, opened and closed by two clips. */
const cabinet: AuthoredVoxelModel = {
  id: "cabinet", name: "Cabinet", pitch: 0.02,
  palette: [{ key: "a", color: "#cccccc" }],
  parts: [
    { id: "body", pivot: [0, 0, 0], cells: [{ x: 0, y: 0, z: 0, runs: [{ key: "a", length: 4 }] }] },
    { id: "door", parent: "body", pivot: [0, 0, 4], cells: [{ x: 0, y: 1, z: 4, runs: [{ key: "a", length: 4 }] }] },
  ],
  clips: [
    { id: "open", duration: 1, tracks: [{ part: "door", keys: [{ t: 0, rotation: [0, 0, 0] }, { t: 1, rotation: [0, 90, 0], ease: "linear" }] }] },
    { id: "close", duration: 1, tracks: [{ part: "door", keys: [{ t: 0, rotation: [0, 90, 0] }, { t: 1, rotation: [0, 0, 0], ease: "linear" }] }] },
  ],
};

const yawDegrees = (rig: ReturnType<typeof createVoxelRig>): number => (rig.parts.get("door")!.node.rotation.y * 180) / Math.PI;

const withRig = (body: (rig: ReturnType<typeof createVoxelRig>) => void): void => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const rig = createVoxelRig(cabinet, scene);
  try { body(rig); } finally { rig.dispose(); scene.dispose(); engine.dispose(); }
};

test("interrupting a clip picks up from the pose we are standing in", () => {
  withRig((rig) => {
    const player = createClipPlayer(rig);
    player.play("open");
    player.update(0.4);
    const interrupted = yawDegrees(rig);
    assert.ok(Math.abs(interrupted - 36) < 2, `expected the door about 36° open, got ${interrupted}°`);
    player.play("close");
    assert.ok(Math.abs(yawDegrees(rig) - interrupted) < 1e-6, "the switch itself moves nothing");
    // The close is a mirror of the open, so a door 40% open joins it 60% of the way through.
    assert.ok(Math.abs(player.time - 0.6) < 0.02, `matched at ${player.time}s`);
    // And from there it only ever shuts: no swing back out to the first keyframe.
    let previous = yawDegrees(rig);
    for (let i = 0; i < 40; i++) {
      player.update(0.01);
      const now = yawDegrees(rig);
      assert.ok(now <= previous + 1e-6, `the door swung back out at ${player.time.toFixed(2)}s: ${previous}° → ${now}°`);
      previous = now;
    }
  });
});

test("a cut with nothing to match still eases the step out instead of snapping", () => {
  withRig((rig) => {
    const player = createClipPlayer(rig);
    player.play("open");
    player.update(0.4);
    const interrupted = yawDegrees(rig);
    player.play("close", { from: 0, blend: 0.2 }); // an explicit start time: no matching
    assert.equal(player.time, 0);
    assert.ok(player.blending);
    assert.ok(Math.abs(yawDegrees(rig) - interrupted) < 1e-6, "the first frame is still where we stood");
    player.update(0.1);
    const halfway = yawDegrees(rig);
    assert.ok(halfway > interrupted && halfway < 90, `eased to ${halfway}°, not straight to the keyframe`);
    player.update(0.15);
    assert.equal(player.blending, false, "the blend is spent");
  });
});

test("playing a clip with nothing running starts at the beginning", () => {
  withRig((rig) => {
    const player = createClipPlayer(rig);
    player.play("close");
    assert.equal(player.time, 0);
    assert.equal(player.blending, false);
    assert.ok(Math.abs(yawDegrees(rig) - 90) < 1e-6);
    player.seek(0.5);
    assert.ok(Math.abs(yawDegrees(rig) - 45) < 2);
  });
});
