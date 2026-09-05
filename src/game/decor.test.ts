import test from "node:test";
import assert from "node:assert/strict";
import { validateDecorLayout, type DecorLayout } from "./decorLayout.ts";
import type { AuthoredVoxelCatalog } from "./voxelModel.ts";
import { readCatalog } from "../../scripts/catalog-io.mjs";
import { readFileSync } from "node:fs";

const catalog = readCatalog() as unknown as AuthoredVoxelCatalog;

test("the saved decor layout only places catalog models at valid spots", () => {
  const layout = JSON.parse(readFileSync(new URL("../assets/scene/decor.json", import.meta.url), "utf8")) as DecorLayout;
  assert.deepEqual(validateDecorLayout(layout, catalog), []);
});

test("decor validation catches unknown models, repeated ids and bad transforms", () => {
  const layout: DecorLayout = {
    version: 1,
    props: [
      { id: "vase_1", model: "tomato_ripe_scan", position: [1, 0.22, -2], rotationY: 90, scale: 0.5 },
      { id: "vase_3", model: "tomato_ripe_scan", position: [1, 0.22, -2], rotation: [15, 90, 0], scale: [1, 2, 1] },
      { id: "vase_4", model: "tomato_ripe_scan", position: [1, 0.22, -2], rotation: [15, 90] as never, scale: [1, 0, 1] },
      { id: "vase_1", model: "nope", position: [0, 0], scale: 0 } as never,
      { id: "plant_2", model: "tomato_ripe_scan", position: [0, 0, 0], clip: "harvest", interactClip: "nope" },
    ],
  };
  const errors = validateDecorLayout(layout, catalog);
  assert.ok(errors.some((e) => e.includes("repeats")));
  assert.ok(errors.some((e) => e.includes("unknown model nope")));
  assert.ok(errors.some((e) => e.includes("invalid position")));
  assert.ok(errors.some((e) => e.includes("scale must be positive")));
  assert.ok(errors.some((e) => e.includes("reacts with unknown clip nope")));
  assert.ok(errors.some((e) => e.includes("vase_4 rotation needs 3 numbers")));
  assert.ok(errors.some((e) => e.includes("vase_4 scale must be positive")));
  assert.ok(!errors.some((e) => e.includes("vase_3")), "three-axis rotation and per-axis scale are valid");
  assert.ok(!errors.some((e) => e.includes("loops unknown clip harvest")), "a real clip is accepted as the idle loop");
});
