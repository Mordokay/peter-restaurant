// A bench of the same plant at different yields, to see that one model serves
// them all. Temporary props in their own scene nodes; the saved compound is
// untouched.
import { TransformNode, Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import { catalog, ensureModels } from "./assets/catalog/index";
import { cellsFromAuthoredModel } from "./game/voxelModel";
import { createVoxelMesh } from "./game/voxelGeometry";
import { createCropFruit, type CropFruitDisplay } from "./game/cropFruit";

const PLANTS = [
  { plant: "crop_strawberry_ripe", fruit: "item_strawberry", yields: [4, 5, 6, 8] },
  { plant: "crop_pepper_ripe_red", fruit: "item_pepper_red", yields: [3, 6, 10] },
  { plant: "crop_pepper_ripe_yellow", fruit: "item_pepper_yellow", yields: [4, 8] },
];

export async function mountCropTest(scene: Scene, at: Vector3, shadows?: ShadowGenerator): Promise<{ update(dt: number): void }> {
  const panel = document.createElement("section");
  panel.className = "rig-test-panel";
  panel.innerHTML = `<strong>Crop yield test</strong>
    <p>One plant model per crop; the fruit count is the only thing that differs.</p>
    <p class="rig-test-status" role="status">Loading…</p>
    <div class="rig-test-actions">
      <button data-crop="harvest">Harvest all</button><button data-crop="regrow">Regrow</button>
    </div>`;
  document.body.append(panel);
  const status = panel.querySelector<HTMLElement>(".rig-test-status")!;

  await ensureModels([...new Set(PLANTS.flatMap((p) => [p.plant, p.fruit]))]);
  const root = new TransformNode("crop test", scene);
  root.position.copyFrom(at);
  const displays: CropFruitDisplay[] = [];
  let column = 0;

  for (const spec of PLANTS) {
    const model = catalog.models[spec.plant];
    if (!model) continue;
    const mesh = createVoxelMesh(`crop ${spec.plant}`, cellsFromAuthoredModel(model), model.pitch, scene);
    mesh.isVisible = false;
    for (const [row, count] of spec.yields.entries()) {
      const node = new TransformNode(`${spec.plant}#${count}`, scene);
      node.parent = root;
      node.position.set(column * 0.85, 0, row * 0.85);
      const body = mesh.createInstance(`${spec.plant}.body.${count}`);
      body.parent = node;
      shadows?.addShadowCaster(body);
      const fruit = createCropFruit({ scene, model, node, catalog, fruit: spec.fruit, seed: node.name, shadows });
      fruit.show(count);
      displays.push(fruit);
    }
    column++;
  }

  const total = displays.reduce((sum, d) => sum + d.shown, 0);
  status.textContent = `${displays.length} plants · ${total} fruit placed · capacities ${[...new Set(displays.map((d) => d.capacity))].join("/")}`;

  // Harvest and regrow drive one number; each fruit keeps its own size under it.
  let open = 1, target = 1;
  panel.querySelector('[data-crop="harvest"]')!.addEventListener("click", () => { target = 0; });
  panel.querySelector('[data-crop="regrow"]')!.addEventListener("click", () => { target = 1; });
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  return {
    update(dt) {
      if (Math.abs(target - open) < 1e-4) return;
      open += Math.sign(target - open) * Math.min(Math.abs(target - open), dt * 1.6);
      const eased = ease(Math.max(0, Math.min(1, open)));
      for (const d of displays) d.setOpen(eased);
    },
  };
}
