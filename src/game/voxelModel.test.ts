import test from "node:test";
import assert from "node:assert/strict";
import { readCatalog } from "../../scripts/catalog-io.mjs";
import { cellsFromAuthoredModel, validateAuthoredVoxelCatalog, type AuthoredVoxelCatalog } from "./voxelModel.ts";

const catalog = readCatalog() as unknown as AuthoredVoxelCatalog;

test("authored food model catalogue is internally valid", () => {
  assert.deepEqual(validateAuthoredVoxelCatalog(catalog), []);
  // Models the game code depends on; imports from the lab may add more.
  for (const id of ["cabbage", "tofu_block", "tomato", "tomato_ripe_scan", "tomato_sprout_scan", "tomato_vine_scan", "wheat_scan"]) {
    assert.ok(id in catalog.models, `${id} is in the catalog`);
  }
});

test("tomato scan stages form a growth arc with texture-derived colors", () => {
  const stages = ["tomato_sprout_scan", "tomato_vine_scan", "tomato_ripe_scan"];
  // World heights (cells x pitch): stages may sit on different lattices when
  // the adaptive-detail converter gives one stage a finer level than another.
  const heights = stages.map((id) => {
    const model = catalog.models[id];
    const cells = cellsFromAuthoredModel(model);
    assert.ok(model.parts.length >= 1, `${id} has parts`);
    return cells.reduce((top, cell) => Math.max(top, cell.y), 0) * model.pitch;
  });
  // The ripe stage is the rigged, animated test asset: its source parts are
  // kept, joints hang off one root, and it carries a looping sway plus a
  // one-shot harvest clip with an event.
  const ripe = catalog.models.tomato_ripe_scan;
  assert.ok(ripe.parts.length > 5, "ripe keeps its source parts");
  const roots = ripe.parts.filter((part) => !part.parent);
  assert.equal(roots.length, 1, "one root part");
  const clipIds = (ripe.clips ?? []).map((clip) => clip.id).sort();
  assert.deepEqual(clipIds, ["harvest", "sway"]);
  const harvest = ripe.clips!.find((clip) => clip.id === "harvest")!;
  assert.equal(harvest.loop ?? false, false);
  assert.ok(harvest.events?.some((event) => event.name === "harvest"));
  assert.ok(heights[0] < heights[1] && heights[1] <= heights[2] + 0.01, `sprout is shortest, ripe is tallest (${heights.map((h) => h.toFixed(3)).join(" < ")})`);
  // The ripe stage must carry red fruit voxels from the baked texture.
  const ripeCells = cellsFromAuthoredModel(catalog.models.tomato_ripe_scan);
  const redCells = ripeCells.filter((cell) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(cell.color.slice(i, i + 2), 16));
    return r > 140 && g < 100 && b < 100;
  });
  assert.ok(redCells.length > 50, `ripe stage has red fruit voxels (got ${redCells.length})`);
});

test("wheat scan comes from the external-model voxelizer pipeline", () => {
  const model = catalog.models.wheat_scan!;
  const cells = cellsFromAuthoredModel(model);
  assert.deepEqual(model.parts.map((part) => part.id), ["stems", "heads"], "keeps swappable parts");
  assert.ok(cells.length > 1_000, "densely sampled");
  const heights = cells.map((cell) => cell.y);
  assert.ok(Math.max(...heights) > 30, "is a tall stand");
  const headCells = cellsFromAuthoredModel(model, ["heads"]);
  assert.ok(headCells.length > 300, "has a substantial head band");
});

test("authored tomato is detailed, multicolored, and split into animatable parts", () => {
  const tomato = catalog.models.tomato!;
  const cells = cellsFromAuthoredModel(tomato);
  assert.ok(cells.length > 1_500);
  assert.ok(new Set(cells.map((cell) => cell.color)).size >= 5);
  assert.deepEqual(tomato.parts.map((part) => part.id), ["fruit", "crown"]);
});

test("tofu and cabbage have distinct authored silhouettes", () => {
  const tofu = cellsFromAuthoredModel(catalog.models.tofu_block!);
  const cabbage = cellsFromAuthoredModel(catalog.models.cabbage!);
  const dimensions = (cells: typeof tofu) => [
    Math.max(...cells.map((cell) => cell.x)) - Math.min(...cells.map((cell) => cell.x)),
    Math.max(...cells.map((cell) => cell.y)) - Math.min(...cells.map((cell) => cell.y)),
    Math.max(...cells.map((cell) => cell.z)) - Math.min(...cells.map((cell) => cell.z)),
  ];
  assert.notDeepEqual(dimensions(tofu), dimensions(cabbage));
});

test("cabbage uses fine voxels and independently animatable leaf layers", () => {
  const cabbage = catalog.models.cabbage!;
  const cells = cellsFromAuthoredModel(cabbage);
  assert.ok(cabbage.pitch <= 0.02);
  assert.ok(cells.length > 5_000);
  assert.deepEqual(cabbage.parts.map((part) => part.id), [
    "head", "stem", "front_leaf", "back_leaf", "left_leaf", "right_leaf", "top_leaf", "top_cross_leaf", "heart_leaf",
  ]);
});

test("clip validation checks opacity range and fade mode", () => {
  const model = { id: "m", pitch: 0.01, palette: { r: "#ff0000" }, parts: [{ id: "p", pivot: [0, 0, 0] as [number, number, number], voxels: [[0, 0, 0, "r"] as [number, number, number, string]] }], clips: [{ id: "c", duration: 1, tracks: [{ part: "p", fade: "blur" as never, keys: [{ t: 0, opacity: 1.5 }] }] }] };
  const errors = validateAuthoredVoxelCatalog({ version: 1, models: { m: model } });
  assert.ok(errors.some((e) => e.includes("opacity must be within 0..1")));
  assert.ok(errors.some((e) => e.includes("unknown fade mode blur")));
});
