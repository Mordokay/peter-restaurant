import test from "node:test";
import assert from "node:assert/strict";
import { applyRig, inferRig } from "./rigInference.ts";
import { validateAuthoredVoxelCatalog, type AuthoredVoxelModel } from "./voxelModel.ts";

// A stake (tall column), a leaf touching its side, a fruit hanging from the
// leaf's tip, and a pebble floating on its own.
const plant: AuthoredVoxelModel = {
  id: "plant",
  pitch: 0.01,
  palette: { w: "#a05010", g: "#319708", r: "#be3024", s: "#888888" },
  parts: [
    { id: "leaf", pivot: [0, 0, 0], runs: [[6, 0, 2, 6, "g"], [6, 0, 7, 8, "g"]] },
    { id: "stake", pivot: [0, 0, 0], boxes: [[0, 0, 0, 1, 12, 1, "w"]] },
    { id: "fruit", pivot: [0, 0, 0], boxes: [[8, 3, 0, 9, 5, 1, "r"]] },
    { id: "pebble", pivot: [0, 0, 0], voxels: [[20, 0, 20, "s"]] },
  ],
};

test("rig inference roots the biggest part and chains parts by contact", () => {
  const rig = inferRig(plant);
  assert.equal(rig.root, "stake");
  assert.equal(rig.parents.get("leaf"), "stake");
  assert.equal(rig.parents.get("fruit"), "leaf", "the fruit hangs from the leaf, not the stake");
  assert.equal(rig.parents.get("pebble"), "stake", "floating pieces attach to the root");
  const leafPivot = rig.pivots.get("leaf")!;
  assert.equal(leafPivot[0], 2, "leaf joint sits where it meets the stake");
  assert.equal(leafPivot[1], 6);
  assert.deepEqual(rig.pivots.get("stake"), [1, 0, 1], "root pivots at the centre of its base");
  const rigged = applyRig(plant, rig);
  assert.equal(rigged.parts.find((p) => p.id === "stake")!.parent, undefined);
  assert.equal(rigged.parts.find((p) => p.id === "fruit")!.parent, "leaf");
  assert.deepEqual(validateAuthoredVoxelCatalog({ version: 1, models: { plant: rigged } }), []);
});

test("catalog validation rejects broken rigs and clips", () => {
  const broken: AuthoredVoxelModel = {
    ...plant,
    parts: [
      { ...plant.parts[0]!, parent: "fruit" },
      plant.parts[1]!,
      { ...plant.parts[2]!, parent: "leaf" },
      { ...plant.parts[3]!, parent: "ghost" },
    ],
    clips: [{ id: "bad", duration: 0, tracks: [{ part: "nobody", keys: [{ t: 2, rotation: [0, 0, 0] }, { t: 1 }] }], events: [{ t: 0, name: "swap", swapModel: "missing" }] }],
  };
  const errors = validateAuthoredVoxelCatalog({ version: 1, models: { plant: broken } });
  assert.ok(errors.some((e) => e.includes("parent cycle")));
  assert.ok(errors.some((e) => e.includes("unknown parent ghost")));
  assert.ok(errors.some((e) => e.includes("positive duration")));
  assert.ok(errors.some((e) => e.includes("unknown part nobody")));
  assert.ok(errors.some((e) => e.includes("not sorted")));
  assert.ok(errors.some((e) => e.includes("unknown model missing")));
});

test("file-given parents are kept and only the rest is inferred", () => {
  const fromFile: AuthoredVoxelModel = {
    ...plant,
    parts: plant.parts.map((part) => (part.id === "fruit" ? { ...part, parent: "stake" } : part)),
  };
  const rig = inferRig(fromFile, { keepExisting: true });
  assert.equal(rig.parents.get("fruit"), "stake", "the file said the fruit hangs from the stake");
  assert.equal(rig.parents.get("leaf"), "stake", "leaf still inferred by contact");
  assert.deepEqual(rig.pivots.get("fruit"), [9, 4, 1], "no contact with its parent: pivot at its own centre (rounded)");
  assert.equal(inferRig(fromFile).parents.get("fruit"), "leaf", "without keepExisting the contact rule wins");
});
