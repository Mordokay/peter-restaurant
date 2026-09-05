import test from "node:test";
import assert from "node:assert/strict";
import { HISTORY_DEPTH, VoxelEditSession, brushCoordinates, planeBrushCoordinates } from "./voxelEditing.ts";
import { sampleClip } from "./voxelClips.ts";
import { cellsFromAuthoredModel, validateAuthoredVoxelCatalog, type AuthoredVoxelModel } from "./voxelModel.ts";

// Two parts: a 3x1x3 red slab ("base") and a 1x2x1 green stem ("stem") on top.
const fixture: AuthoredVoxelModel = {
  id: "fixture",
  pitch: 0.02,
  palette: { r: "#c83d35", g: "#4f863d" },
  parts: [
    { id: "base", pivot: [0, 0, 0], boxes: [[-1, 0, -1, 1, 0, 1, "r"]] },
    { id: "stem", pivot: [0, 1, 0], runs: [[1, 0, 0, 0, "g"], [2, 0, 0, 0, "g"]] },
  ],
};

test("session loads cells with their owning parts and round-trips unchanged", () => {
  const session = new VoxelEditSession(fixture);
  assert.equal(session.size, 11);
  assert.equal(session.get(0, 0, 0)?.part, "base");
  assert.equal(session.get(0, 2, 0)?.part, "stem");
  assert.equal(session.dirty, false);
  const out = session.toAuthoredModel();
  assert.deepEqual(out.parts.map((p) => p.id), ["base", "stem"]);
  assert.deepEqual(out.parts[1]!.pivot, [0, 1, 0]);
  assert.deepEqual(out.palette, { r: "#c83d35", g: "#4f863d" });
  const cells = cellsFromAuthoredModel(out).map((c) => `${c.x},${c.y},${c.z}:${c.color}`).sort();
  const original = cellsFromAuthoredModel(fixture).map((c) => `${c.x},${c.y},${c.z}:${c.color}`).sort();
  assert.deepEqual(cells, original);
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { fixture: out } }), []);
});

test("paint, erase, add and eyedropper-style reads mark the session dirty and undo restores", () => {
  const session = new VoxelEditSession(fixture);
  session.beginStroke();
  assert.equal(session.paint(brushCoordinates({ x: 0, y: 0, z: 0 }, 0), "#ffffff"), 1);
  session.endStroke();
  assert.equal(session.get(0, 0, 0)?.color, "#ffffff");
  assert.equal(session.dirty, true);
  session.beginStroke();
  assert.equal(session.add([{ x: 0, y: 3, z: 0 }], "#4f863d"), 1);
  session.endStroke();
  assert.equal(session.get(0, 3, 0)?.part, "stem", "new voxel joins the part it touches");
  session.beginStroke();
  assert.equal(session.erase([{ x: 1, y: 0, z: 1 }]), 1);
  session.endStroke();
  assert.equal(session.size, 11);
  assert.ok(session.undo()); // erase
  assert.ok(session.undo()); // add
  assert.ok(session.undo()); // paint
  assert.equal(session.get(0, 0, 0)?.color, "#c83d35");
  assert.equal(session.dirty, false);
  assert.ok(session.redo());
  assert.equal(session.get(0, 0, 0)?.color, "#ffffff");
  // A stroke that changes nothing does not consume an undo step.
  const before = session.canUndo;
  session.beginStroke();
  session.paint([{ x: 50, y: 50, z: 50 }], "#000000");
  session.endStroke();
  assert.equal(session.canUndo, before);
  assert.ok(session.undo());
  assert.equal(session.get(0, 0, 0)?.color, "#c83d35");
});

test("bucket fill recolors the connected same-color region only", () => {
  const session = new VoxelEditSession(fixture);
  session.beginStroke();
  assert.equal(session.floodFill({ x: 1, y: 0, z: 1 }, "#123456"), 9, "whole red slab");
  session.endStroke();
  assert.equal(session.get(0, 1, 0)?.color, "#4f863d", "stem untouched");
  // A one-voxel island of a different color stays separate.
  session.beginStroke();
  session.paint([{ x: -1, y: 0, z: -1 }], "#ff0000");
  session.endStroke();
  session.beginStroke();
  assert.equal(session.floodFill({ x: 0, y: 0, z: 0 }, "#00ff00"), 8);
  session.endStroke();
  assert.equal(session.get(-1, 0, -1)?.color, "#ff0000");
});

test("chunk delete removes a 26-connected piece and palette replace swaps every voxel of a color", () => {
  const detached: AuthoredVoxelModel = {
    ...fixture,
    parts: [...fixture.parts, { id: "debris", pivot: [0, 0, 0], voxels: [[5, 5, 5, "r"], [6, 6, 6, "r"]] }],
  };
  const session = new VoxelEditSession(detached);
  assert.equal(session.connectedChunk({ x: 5, y: 5, z: 5 }).length, 2, "diagonal neighbour counts as connected");
  session.beginStroke();
  assert.equal(session.deleteChunk({ x: 6, y: 6, z: 6 }), 2);
  session.endStroke();
  assert.equal(session.size, 11);
  session.beginStroke();
  assert.equal(session.replaceColor("#c83d35", "#aa1111"), 9);
  session.endStroke();
  session.beginStroke();
  assert.equal(session.eraseColor("#aa1111"), 9, "delete color erases every voxel using it");
  session.endStroke();
  assert.equal(session.size, 2);
  assert.ok(session.undo(), "and it is one undo step");
  assert.equal(session.size, 11);
  const out = session.toAuthoredModel("edited");
  assert.equal(out.id, "edited");
  assert.deepEqual(out.parts.map((p) => p.id), ["base", "stem", "debris"], "an emptied part stays as a joint");
  assert.deepEqual(out.parts[2]!.runs, []);
  assert.deepEqual(Object.keys(out.palette).sort(), ["e0", "g"], "new color gets an editor key, existing key reused");
  assert.equal(out.palette.e0, "#aa1111");
});

test("hidden parts are excluded from rendering but kept in the saved model", () => {
  const session = new VoxelEditSession(fixture);
  session.setPartHidden("stem", true);
  assert.equal(session.visibleCells().length, 9);
  assert.equal(session.toAuthoredModel().parts.length, 2);
  assert.equal(session.paint([{ x: 0, y: 1, z: 0 }], "#000000"), 0, "hidden voxels are protected from brushes");
  session.setPartHidden("stem", false);
  session.beginStroke();
  assert.equal(session.deletePart("stem", true), 3, "two voxels plus the part itself");
  session.endStroke();
  assert.equal(session.toAuthoredModel().parts.map((p) => p.id).join(), "base");
});

test("rig metadata: parts, parents, pivots, sockets and clips round-trip and flag dirty", () => {
  const session = new VoxelEditSession(fixture);
  assert.equal(session.dirty, false);
  assert.ok(session.addPart("leaf", "stem"));
  assert.equal(session.addPart("leaf"), false, "no duplicates");
  assert.equal(session.dirty, true, "metadata changes count as unsaved");
  session.beginStroke();
  assert.equal(session.assign([{ x: 1, y: 0, z: 1 }, { x: -1, y: 0, z: -1 }], "leaf"), 2);
  session.endStroke();
  assert.equal(session.partCellCount("leaf"), 2);
  session.setPivot("leaf", { x: 1, y: 0, z: 1 });
  assert.equal(session.setParent("stem", "leaf"), false, "cycle refused");
  assert.equal(session.setParent("leaf", "base"), true);
  session.setSocket("stem", "tip", { x: 0, y: 2, z: 0 });
  session.upsertClip({ id: "sway", duration: 1, loop: true, tracks: [] });
  session.setKey("sway", "leaf", { t: 0, rotation: [0, 0, -5] });
  session.setKey("sway", "leaf", { t: 1, rotation: [0, 0, 5], ease: "inOut" });
  session.setEvent("sway", { t: 0.5, name: "rustle" });
  const out = session.toAuthoredModel();
  const leaf = out.parts.find((p) => p.id === "leaf")!;
  assert.deepEqual(leaf.pivot, [1, 0, 1]);
  assert.equal(leaf.parent, "base");
  assert.deepEqual(out.parts.find((p) => p.id === "stem")!.sockets, { tip: [0, 2, 0] });
  assert.equal(out.clips!.length, 1);
  assert.equal(out.clips![0]!.tracks[0]!.keys.length, 2);
  assert.equal(out.clips![0]!.events![0]!.name, "rustle");
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { fixture: out } }), []);
  // Reload the saved model: nothing dirty, everything preserved, undo still reverts voxel moves.
  const reopened = new VoxelEditSession(out);
  assert.equal(reopened.dirty, false);
  assert.equal(reopened.clips.length, 1);
  assert.ok(reopened.renamePart("leaf", "leaflet"));
  assert.equal(reopened.clips[0]!.tracks[0]!.part, "leaflet", "clips follow renames");
  assert.equal(reopened.partMeta("leaflet")?.parent, "base");
  let steps = 0;
  while (session.partCellCount("leaf") > 0 && steps < 12 && session.undo()) steps++;
  assert.equal(session.partCellCount("leaf"), 0, "assignment is undoable (after undoing the later rig/clip steps)");
});

test("shift bucket fills through similar shades but stops at a different material", () => {
  // A stake in two wood shades touching a green leaf.
  const twoTone: AuthoredVoxelModel = {
    id: "stake", pitch: 0.02, palette: { w1: "#b76a25", w2: "#c78a2d", g: "#319708" },
    parts: [{ id: "plant", pivot: [0, 0, 0], voxels: [[0, 0, 0, "w1"], [0, 1, 0, "w2"], [0, 2, 0, "w1"], [0, 3, 0, "w2"], [1, 2, 0, "g"], [2, 2, 0, "g"]] }],
  };
  const session = new VoxelEditSession(twoTone);
  assert.equal(session.sameColorRegion({ x: 0, y: 0, z: 0 }).length, 1, "plain bucket: one shade, and the next same-shade voxel is not adjacent");
  assert.equal(session.similarColorRegion({ x: 0, y: 0, z: 0 }, 0.22).length, 4, "shift bucket: both wood shades");
  session.beginStroke();
  assert.equal(session.floodFillSimilar({ x: 0, y: 0, z: 0 }, "#8a5a2b"), 4);
  session.endStroke();
  assert.equal(session.get(1, 2, 0)?.color, "#319708", "leaf untouched");
});

test("history is delta-based, capped, and survives export/import only for the same cells", () => {
  const session = new VoxelEditSession(fixture);
  for (let step = 0; step < HISTORY_DEPTH + 5; step++) {
    session.beginStroke();
    session.paint([{ x: 0, y: 0, z: 0 }], `#${(step % 2 ? "111111" : "222222")}`);
    session.endStroke();
  }
  assert.equal(session.undoDepth, HISTORY_DEPTH, "oldest steps fall off");
  const exported = session.exportHistory();
  assert.equal(exported.undo[0]![0]!.length, 1, "a delta stores only the touched voxel");
  const twin = new VoxelEditSession(fixture);
  assert.equal(twin.importHistory(exported), false, "history recorded against edited cells does not apply to the pristine model");
  // Rebuild the twin to the same state, then the history applies.
  const restored = new VoxelEditSession(session.toAuthoredModel());
  assert.equal(restored.importHistory(exported), true);
  assert.equal(restored.undoDepth, HISTORY_DEPTH);
  assert.ok(restored.undo());
  assert.equal(restored.get(0, 0, 0)?.color, "#111111");
  assert.ok(restored.redo());
  assert.equal(restored.get(0, 0, 0)?.color, "#222222");
});

test("unsaved edits and their history come back on top of the catalog model, and survive a save", () => {
  const session = new VoxelEditSession(fixture);
  session.beginStroke(); session.paint([{ x: 0, y: 0, z: 0 }], "#111111"); session.endStroke();
  session.beginStroke(); session.erase([{ x: 1, y: 0, z: 1 }]); session.endStroke();
  session.undo(); // erase undone -> one unsaved step applied, one on the redo stack
  const exported = session.exportHistory();
  // "Page reload": a fresh session from the untouched catalog model.
  const reopened = new VoxelEditSession(fixture);
  assert.equal(reopened.importHistory(exported), true);
  assert.equal(reopened.get(0, 0, 0)?.color, "#111111", "unsaved paint replayed");
  assert.equal(reopened.size, 11, "undone erase stays undone");
  assert.equal(reopened.dirty, true);
  assert.equal(reopened.undoDepth, 1);
  assert.equal(reopened.redoDepth, 1);
  assert.ok(reopened.redo());
  assert.equal(reopened.size, 10);
  // Save, then reopen from the saved model: the trail is still there.
  reopened.markSaved();
  const saved = reopened.toAuthoredModel();
  const afterSave = new VoxelEditSession(saved);
  assert.equal(afterSave.importHistory(reopened.exportHistory()), true);
  assert.equal(afterSave.dirty, false);
  assert.equal(afterSave.undoDepth, 2);
  assert.ok(afterSave.undo());
  assert.equal(afterSave.size, 11, "undo reaches back past the save point");
  assert.equal(afterSave.dirty, true);
  // A model changed by something else refuses the stale history.
  const changed = new VoxelEditSession({ ...fixture, palette: { r: "#000000", g: "#4f863d" } });
  assert.equal(changed.importHistory(exported), false);
  assert.equal(changed.dirty, false);
});

test("plane brush lays a flat square in the face plane", () => {
  const square = planeBrushCoordinates({ x: 2, y: 5, z: -1 }, 1, 1);
  assert.equal(square.length, 9);
  assert.ok(square.every((c) => c.y === 5), "stays in the y layer");
  assert.equal(new Set(square.map((c) => `${c.x},${c.z}`)).size, 9);
  assert.equal(planeBrushCoordinates({ x: 0, y: 0, z: 0 }, 0, 0).length, 1);
});

test("hiding cascades to children; copy, paste, duplicate and baked transforms move voxels and joints together", () => {
  const session = new VoxelEditSession(fixture);
  session.setParent("stem", "base");
  session.setPartHidden("base", true);
  assert.equal(session.isPartVisible("stem"), false, "child of a hidden part is hidden");
  assert.equal(session.visibleCells().length, 0);
  session.setPartHidden("base", false);
  // Duplicate the stem two cells to the right: same voxels, same parent, shifted joint.
  session.beginStroke();
  assert.ok(session.duplicatePart("stem", "stem2", { x: 2, y: 0, z: 0 }));
  session.endStroke();
  assert.equal(session.partCellCount("stem2"), 2);
  assert.equal(session.get(2, 1, 0)?.part, "stem2");
  assert.deepEqual(session.partMeta("stem2")?.pivot, [2, 1, 0]);
  assert.equal(session.partMeta("stem2")?.parent, "base");
  // Copy to a clipboard and paste into another model at a chosen spot.
  const clip = session.copyPart("stem")!;
  const other = new VoxelEditSession(fixture);
  other.beginStroke();
  assert.ok(other.pastePart(clip, "pasted", { x: 5, y: 5, z: 5 }));
  other.endStroke();
  assert.equal(other.get(5, 5, 5)?.part, "pasted");
  assert.equal(other.get(5, 6, 5)?.color, "#4f863d");
  // Bake: move the stem up by one and rotate it 90° about Z around its joint.
  session.beginStroke();
  session.transformPart("stem", { translate: [0, 1, 0] });
  session.endStroke();
  assert.equal(session.get(0, 3, 0)?.part, "stem", "translated up");
  assert.equal(session.get(0, 1, 0), undefined);
  assert.deepEqual(session.partMeta("stem")?.pivot, [0, 2, 0], "joint moved with it");
  session.beginStroke();
  session.transformPart("stem", { rotate: [0, 0, 90] });
  session.endStroke();
  // Cells were (0,2,0),(0,3,0) around pivot (0,2,0): 90° about Z sends +y to -x.
  assert.equal(session.get(0, 2, 0)?.part, "stem");
  assert.equal(session.get(-1, 2, 0)?.part, "stem", "rotated 90° around the joint");
  session.beginStroke();
  assert.equal(session.transformPart("stem", { scale: 2 }), 16, "integer scale fills exactly: 2 cells x 2³");
  session.endStroke();
  assert.ok(session.undo());
  assert.equal(session.partCellCount("stem"), 2, "bakes are undoable");
  // Mirror across X around the joint.
  session.beginStroke();
  session.transformPart("stem", { mirror: [true, false, false] });
  session.endStroke();
  assert.equal(session.get(1, 2, 0)?.part, "stem");
});

test("rig and clip edits are undoable steps, and muted keys are skipped when sampling", () => {
  const session = new VoxelEditSession(fixture);
  session.upsertClip({ id: "wave", duration: 1, loop: false, tracks: [] });
  session.setKey("wave", "stem", { t: 0, rotation: [0, 0, 0] });
  session.setKey("wave", "stem", { t: 1, rotation: [0, 0, 30] });
  assert.equal(session.undoDepth, 3, "clip creation and each key are steps");
  session.setPivot("stem", { x: 0, y: 2, z: 0 });
  assert.equal(session.undoDepth, 4);
  assert.ok(session.undo());
  assert.deepEqual(session.partMeta("stem")?.pivot, [0, 1, 0], "joint change undone");
  assert.ok(session.undo());
  assert.equal(session.clips[0]!.tracks[0]!.keys.length, 1, "second key undone");
  assert.ok(session.redo());
  assert.equal(session.clips[0]!.tracks[0]!.keys.length, 2, "and redone");
  // Retiming as one step: remove + set inside one stroke.
  session.beginStroke();
  session.removeKey("wave", "stem", 1);
  session.setKey("wave", "stem", { t: 0.5, rotation: [0, 0, 30] });
  session.endStroke();
  assert.deepEqual(session.clips[0]!.tracks[0]!.keys.map((k) => k.t), [0, 0.5]);
  assert.ok(session.undo());
  assert.deepEqual(session.clips[0]!.tracks[0]!.keys.map((k) => k.t), [0, 1], "retime undone in one step");
  // Mute the second key: sampling holds the first key's value; unmute restores.
  session.toggleKey("wave", "stem", 1);
  assert.equal(session.clips[0]!.tracks[0]!.keys[1]!.disabled, true);
  assert.deepEqual(sampleClip(session.clips[0]!, 1).get("stem").rotation, [0, 0, 0], "muted key ignored");
  session.toggleKey("wave", "stem", 1);
  assert.equal(!!session.clips[0]!.tracks[0]!.keys[1]!.disabled, false, "un-muted");
  assert.deepEqual(sampleClip(session.clips[0]!, 1).get("stem").rotation, [0, 0, 30]);
  // History with metadata survives export/import.
  const twin = new VoxelEditSession(session.toAuthoredModel());
  assert.ok(twin.importHistory(session.exportHistory()));
  assert.ok(twin.undo());
  assert.equal(twin.clips[0]!.tracks[0]!.keys[1]!.disabled, true, "metadata undo restored from persisted history");
});

test("extracting a part and its children yields a standalone, grounded, rigged model", () => {
  const session = new VoxelEditSession(fixture);
  session.setParent("stem", "base");
  session.addPart("tip", "stem");
  session.beginStroke(); session.add([{ x: 0, y: 3, z: 0 }], "#ffee00", "tip"); session.endStroke();
  session.upsertClip({ id: "wave", duration: 1, tracks: [{ part: "stem", keys: [{ t: 0, rotation: [0, 0, 0] }] }, { part: "base", keys: [{ t: 0, scale: [1, 1, 1] }] }] });
  const out = session.extractParts(["stem", "tip"], "stem_only", "Stem")!;
  assert.equal(out.id, "stem_only");
  assert.equal(out.name, "Stem");
  assert.deepEqual(out.parts.map((p) => p.id), ["stem", "tip"]);
  assert.equal(out.parts[0]!.parent, undefined, "the top part becomes the root");
  assert.equal(out.parts[1]!.parent, "stem");
  const cells = cellsFromAuthoredModel(out);
  assert.equal(cells.length, 3);
  assert.equal(Math.min(...cells.map((c) => c.y)), 0, "re-based onto the ground");
  assert.deepEqual(out.parts[0]!.pivot, [0, 0, 0], "joint shifted with the cells");
  assert.equal(out.clips!.length, 1);
  assert.deepEqual(out.clips![0]!.tracks.map((t) => t.part), ["stem"], "only tracks of extracted parts");
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { stem_only: out } }), []);
});

test("grouping wraps selected parts in a new joint at their common ancestor; ungrouping lifts them back", () => {
  const model: AuthoredVoxelModel = {
    id: "tree", pitch: 0.02, palette: { g: "#4f863d" },
    parts: [
      { id: "trunk", pivot: [0, 0, 0], boxes: [[0, 0, 0, 0, 5, 0, "g"]] },
      { id: "branch", pivot: [0, 3, 0], parent: "trunk", voxels: [[1, 3, 0, "g"]] },
      { id: "leaf_a", pivot: [2, 3, 0], parent: "branch", voxels: [[2, 3, 0, "g"]] },
      { id: "leaf_b", pivot: [0, 5, 0], parent: "trunk", voxels: [[0, 6, 0, "g"]] },
    ],
  };
  const session = new VoxelEditSession(model);
  assert.equal(session.commonAncestor(["leaf_a", "leaf_b"]), "trunk");
  assert.equal(session.commonAncestor(["leaf_a", "branch"]), "trunk");
  assert.equal(session.commonAncestor(["trunk", "leaf_b"]), undefined, "root is the only thing above the trunk");
  assert.ok(session.groupParts(["leaf_a", "leaf_b"], "leaves"));
  assert.equal(session.partMeta("leaves")?.parent, "trunk", "group sits at the deepest common ancestor");
  assert.equal(session.partMeta("leaf_a")?.parent, "leaves");
  assert.equal(session.partMeta("leaf_b")?.parent, "leaves");
  assert.deepEqual(session.partMeta("leaves")?.pivot, [1, 4, 0], "joint at the centre of the grouped joints");
  assert.ok(session.parts.indexOf("leaves") < session.parts.indexOf("leaf_a"), "group listed before its members");
  assert.equal(session.undoDepth, 1, "one undo step");
  // Selecting a part and its own descendant groups only the top one; the descendant follows.
  assert.ok(session.groupParts(["trunk", "branch"], "everything"));
  assert.equal(session.partMeta("trunk")?.parent, "everything");
  assert.equal(session.partMeta("everything")?.parent, undefined, "grouping a root part makes the group the new root");
  assert.equal(session.partMeta("branch")?.parent, "trunk", "already inside the selection, left alone");
  assert.ok(session.ungroupPart("leaves"));
  assert.equal(session.partMeta("leaf_b")?.parent, "trunk");
  assert.equal(session.parts.includes("leaves"), false, "empty group removed");
  assert.equal(session.groupParts(["leaf_a"], "trunk"), false, "id taken");
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { tree: session.toAuthoredModel() } }), []);
});

test("parts keep their own cells: pasting and baked transforms overlap other parts without eating them", () => {
  const session = new VoxelEditSession(fixture);
  const clip = session.copyPart("stem")!; // two green cells stacked
  assert.equal(session.pasteCollisions(clip, { x: 1, y: 0, z: 1 }), 1, "one position is already occupied by the slab");
  session.beginStroke();
  session.pastePart(clip, "twig", { x: 1, y: 0, z: 1 });
  session.endStroke();
  assert.equal(session.get(1, 0, 1, "base")?.part, "base", "the slab cell survived");
  assert.equal(session.get(1, 0, 1, "twig")?.part, "twig", "and the twig cell sits in the same position");
  assert.equal(session.at(1, 0, 1).length, 2);
  assert.equal(session.get(1, 0, 1)?.part, "twig", "the later part is on top");
  // Moving the stem down into the slab just overlaps it; the slab is untouched.
  session.beginStroke();
  assert.equal(session.transformPart("stem", { translate: [0, -1, 0] }), 2);
  session.endStroke();
  assert.equal(session.get(0, 0, 0, "stem")?.part, "stem");
  assert.equal(session.get(0, 0, 0, "base")?.part, "base");
  // Painting through the pointer's part only touches that part.
  session.beginStroke();
  assert.equal(session.paint([{ x: 0, y: 0, z: 0 }], "#123456", "stem"), 1);
  session.endStroke();
  assert.equal(session.get(0, 0, 0, "base")?.color, "#c83d35");
  assert.equal(session.get(0, 0, 0, "stem")?.color, "#123456");
  // Erasing without a part clears every part at that position.
  session.beginStroke();
  assert.equal(session.erase([{ x: 0, y: 0, z: 0 }]), 2);
  session.endStroke();
  assert.equal(session.at(0, 0, 0).length, 0);
  assert.ok(session.undo());
  assert.equal(session.at(0, 0, 0).length, 2, "undo restores both parts' cells");
});

test("several root parts transform as one body about a shared pivot", () => {
  const two: AuthoredVoxelModel = {
    id: "two", pitch: 0.02, palette: { a: "#ff0000", b: "#00ff00" },
    parts: [{ id: "low", pivot: [0, 0, 0], voxels: [[0, 0, 0, "a"]] }, { id: "high", pivot: [0, 1, 0], voxels: [[0, 1, 0, "b"]] }],
  };
  const session = new VoxelEditSession(two);
  // Scaling both together about the origin keeps them apart and each 27 cells.
  assert.equal(session.transformParts(["low", "high"], { scale: 3 }, { x: 0, y: 0, z: 0 }), 54);
  assert.equal(session.partCellCount("low"), 27);
  assert.equal(session.partCellCount("high"), 27);
  assert.deepEqual(session.partMeta("high")?.pivot, [0, 3, 0], "joints scale with the body");
});

test("parts store a non-destructive rest transform that round-trips, undoes, and can be baked", () => {
  const session = new VoxelEditSession(fixture);
  session.setPartTransform("stem", { rotation: [12, 0, 0], scale: [1, 1.6, 1] });
  session.setPartTransform("stem", { position: [0, 0, 12.3] });
  assert.deepEqual(session.partMeta("stem")?.transform, { rotation: [12, 0, 0], position: [0, 0, 12.3], scale: [1, 1.6, 1] });
  assert.equal(session.partCellCount("stem"), 2, "voxels untouched");
  assert.equal(session.dirty, true);
  const out = session.toAuthoredModel();
  assert.deepEqual(out.parts.find((p) => p.id === "stem")!.transform, { rotation: [12, 0, 0], position: [0, 0, 12.3], scale: [1, 1.6, 1] });
  assert.equal(out.parts.find((p) => p.id === "base")!.transform, undefined, "identity is omitted");
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { fixture: out } }), []);
  const reopened = new VoxelEditSession(out);
  assert.deepEqual(reopened.partMeta("stem")?.transform.position, [0, 0, 12.3]);
  assert.ok(session.undo());
  assert.deepEqual(session.partMeta("stem")?.transform.position, [0, 0, 0], "each transform change is an undo step");
  // Baking writes the transform into the voxels and clears it.
  session.setPartTransform("stem", { rotation: [0, 0, 0], position: [0, 2, 0], scale: [1, 1, 1] });
  assert.equal(session.bakePartTransform("stem"), 2);
  assert.deepEqual(session.partMeta("stem")?.transform, { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] });
  assert.equal(session.get(0, 3, 0, "stem")?.part, "stem", "cells moved up by two");
  assert.deepEqual(session.partMeta("stem")?.pivot, [0, 3, 0], "joint moved with them");
});

test("cells are indexed in 16³ chunks whose versions bump on edits and border changes", () => {
  const session = new VoxelEditSession({
    id: "chunky", pitch: 0.01, palette: { r: "#c83d35" },
    parts: [{ id: "body", pivot: [0, 0, 0], boxes: [[0, 0, 0, 31, 0, 0, "r"]] }],
  });
  const chunks = session.chunksOf("body").sort((a, b) => a.cx - b.cx);
  assert.deepEqual(chunks.map((c) => [c.cx, c.cells.size]), [[0, 16], [1, 16]]);
  const v0 = chunks[0]!.version, v1 = chunks[1]!.version;
  session.beginStroke();
  session.paint([{ x: 3, y: 0, z: 0 }], "#000000", "body");
  session.endStroke();
  assert.ok(session.chunkVersion(chunks[0]!.key) > v0, "the edited chunk bumps");
  assert.equal(session.chunkVersion(chunks[1]!.key), v1, "a far chunk does not");
  const w0 = session.chunkVersion(chunks[0]!.key), w1 = session.chunkVersion(chunks[1]!.key);
  session.beginStroke();
  session.erase([{ x: 16, y: 0, z: 0 }], "body");
  session.endStroke();
  assert.ok(session.chunkVersion(chunks[0]!.key) > w0, "a border cell change bumps the neighbour too (its faces may be exposed)");
  assert.ok(session.chunkVersion(chunks[1]!.key) > w1);
  assert.equal(session.chunksOf("body").find((c) => c.cx === 1)!.cells.size, 15);
});

test("merge pours one part into another and tidy folds fragments into what they touch", () => {
  // slab (9) + stem (2) + a 1-voxel flake against the slab + a floating flake far away
  const model: AuthoredVoxelModel = {
    ...fixture,
    parts: [
      ...fixture.parts,
      { id: "flake", pivot: [0, 0, 0], voxels: [[2, 0, 0, "g"]] },
      { id: "dust", pivot: [0, 0, 0], voxels: [[20, 0, 20, "r"]] },
      { id: "ghost", pivot: [0, 0, 0], runs: [] },
    ],
  };
  const session = new VoxelEditSession(model);
  assert.deepEqual(session.tidyPlan(1).empty, ["ghost"], "an empty part with no children is a leftover");
  assert.equal(session.mergeParts(["stem"], "base"), 2, "stem's two voxels move into base");
  assert.deepEqual(session.parts, ["base", "flake", "dust", "ghost"]);
  assert.equal(session.get(0, 2, 0)?.part, "base");
  assert.ok(session.undo());
  assert.deepEqual(session.parts, ["base", "stem", "flake", "dust", "ghost"], "merge is one undo step");
  assert.equal(session.get(0, 2, 0)?.part, "stem");
  const plan = session.tidyPlan(1);
  assert.deepEqual(plan.fragments, ["dust", "flake"]);
  assert.equal(plan.merges.get("flake"), "base", "the flake touches the slab");
  assert.deepEqual(plan.floating, ["dust"]);
  const result = session.applyTidy(plan, "touch");
  assert.deepEqual(result, { merged: 1, deleted: 2 }, "floating dust and the empty ghost both go");
  assert.deepEqual(session.parts, ["base", "stem"]);
  assert.equal(session.get(2, 0, 0)?.part, "base");
  assert.equal(session.get(20, 0, 20), undefined, "floating dust is dropped");
  assert.ok(session.undo());
  assert.deepEqual(session.parts, ["base", "stem", "flake", "dust", "ghost"], "tidy is one undo step too");
  const gathered = session.applyTidy(session.tidyPlan(1), "single");
  assert.equal(gathered.merged, 2);
  assert.deepEqual(session.parts, ["base", "stem", "fragments"]);
  assert.equal(session.partMeta("fragments")?.parent, "base", "the gathered layer hangs off the biggest part");
});

test("voxel states are extra layers: displayed state drives hits, brushes and export; keys switch them", () => {
  const session = new VoxelEditSession(fixture);
  assert.equal(session.addState("stem", "bitten"), true, "a state copies the shown voxels");
  assert.equal(session.displayedStateOf("stem"), "bitten", "and becomes the shown one");
  assert.equal(session.size, 13, "two extra cells for the copy");
  session.beginStroke();
  assert.equal(session.erase([{ x: 0, y: 2, z: 0 }], "stem"), 1, "brushes addressed to the part hit its shown state");
  session.endStroke();
  assert.equal(session.get(0, 2, 0, "stem"), undefined, "the bitten state lost its tip");
  assert.equal(session.cellOfLayer("stem", 0, 2, 0)?.color, "#4f863d", "the base state still has it");
  assert.deepEqual(session.at(0, 2, 0), [], "hidden states do not take part in position lookups");
  session.setDisplayedState("stem", "base");
  assert.equal(session.get(0, 2, 0, "stem")?.part, "stem");
  assert.equal(session.at(0, 2, 0).length, 1);
  const out = session.toAuthoredModel();
  const stem = out.parts.find((p) => p.id === "stem")!;
  assert.deepEqual(Object.keys(stem.states ?? {}), ["bitten"]);
  assert.equal(cellsFromAuthoredModel(out, ["stem"]).length, 2, "base geometry untouched");
  assert.deepEqual(stem.states!.bitten!.runs, [[1, 0, 0, 0, "g"]], "the state kept only the lower cell");
  // a clip key switches the state from its time on; keys without one leave it alone
  session.upsertClip({ id: "eat", duration: 1, tracks: [{ part: "stem", keys: [{ t: 0, rotation: [0, 0, 0] }, { t: 0.5, state: "bitten" }, { t: 0.8, rotation: [0, 10, 0] }] }] });
  const clip = session.clips.find((c) => c.id === "eat")!;
  assert.equal(sampleClip(clip, 0.2).get("stem")?.state, undefined);
  assert.equal(sampleClip(clip, 0.5).get("stem")?.state, "bitten");
  assert.equal(sampleClip(clip, 0.9).get("stem")?.state, "bitten", "later keys without a state keep it");
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { fixture: session.toAuthoredModel("fixture") } }), []);
  // round trip: a fresh session loads the state layer
  const again = new VoxelEditSession(session.toAuthoredModel("fixture"));
  assert.deepEqual(again.partMeta("stem")?.states, ["bitten"]);
  assert.equal(again.cellOfLayer("stem@bitten", 0, 1, 0)?.color, "#4f863d");
  // undo removes the whole state creation in one step
  assert.ok(session.undo() && session.undo() && session.undo(), "clip, erase, state");
  assert.deepEqual(session.partMeta("stem")?.states, []);
  assert.equal(session.size, 11);
  // removing a state strips it from keys
  session.addState("stem", "x");
  session.upsertClip({ id: "c2", duration: 1, tracks: [{ part: "stem", keys: [{ t: 0, state: "x" }] }] });
  session.removeState("stem", "x");
  assert.equal(session.clips.find((c) => c.id === "c2")!.tracks[0]!.keys[0]!.state, undefined);
});
