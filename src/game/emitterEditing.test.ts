import test from "node:test";
import assert from "node:assert/strict";
import { VoxelEditSession } from "./voxelEditing.ts";
import type { AuthoredVoxelModel } from "./voxelModel.ts";
import { defaultEmitter } from "./voxelParticles.ts";

const model = (): AuthoredVoxelModel => ({
  id: "tomato", pitch: 0.01, palette: { c0: "#c0392b" },
  parts: [{ id: "flesh", pivot: [0, 0, 0], runs: [[0, 0, 0, 4, "c0"]] }],
  clips: [{ id: "chop", duration: 1, tracks: [], events: [{ t: 0.3, name: "chop", emit: "juice" }] }],
});

test("adding an emitter is undoable and redoable", () => {
  const session = new VoxelEditSession(model());
  assert.equal(session.emitters.length, 0);
  session.beginStroke();
  const id = session.addEmitter(defaultEmitter("juice", [1, 2, 3], "#c0392b", "flesh", session.pitch));
  session.endStroke();
  assert.equal(id, "juice");
  assert.equal(session.emitters.length, 1);
  assert.equal(session.undo(), true);
  assert.equal(session.emitters.length, 0, "undo takes the emitter back out");
  assert.equal(session.redo(), true);
  assert.equal(session.emitters.length, 1, "redo puts it back");
});

test("emitter ids stay unique and renaming one follows the clip events that fire it", () => {
  const session = new VoxelEditSession(model());
  const first = session.addEmitter(defaultEmitter("juice", [0, 0, 0], "#c0392b"));
  const second = session.addEmitter(defaultEmitter("juice", [0, 0, 0], "#c0392b"));
  assert.equal(first, "juice");
  assert.equal(second, "juice2", "a clashing id is made unique");
  session.updateEmitter("juice", { id: "splash" });
  assert.equal(session.emitter("splash")?.position.length, 3);
  assert.equal(session.clips[0]!.events![0]!.emit, "splash", "the chop event follows the rename");
});

test("emitters and their firing events are written into the saved model", () => {
  const session = new VoxelEditSession(model());
  session.addEmitter(defaultEmitter("juice", [1, 2, 3], "#c0392b", "flesh", 0.01));
  const saved = session.toAuthoredModel();
  assert.equal(saved.emitters?.length, 1);
  assert.equal(saved.emitters?.[0]?.part, "flesh");
  assert.equal(saved.clips?.[0]?.events?.[0]?.emit, "juice");
  const empty = new VoxelEditSession(model()).toAuthoredModel();
  assert.equal(empty.emitters, undefined, "a model with no emitters stays clean");
});
