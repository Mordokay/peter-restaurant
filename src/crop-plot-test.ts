// A row of plots, one per crop, running on a clock the panel can wind forward.
//
// It exists to be looked at: growth, ripening, picking and regrowth all take
// game minutes, and nobody can judge an animation they have to wait two minutes
// to see. The speed control is a debugging instrument, not a game feature.
import { TransformNode, Vector3, type Scene, type ShadowGenerator } from "@babylonjs/core";
import { catalog, ensureModels } from "./assets/catalog/index";
import { cropDefinitions, harvestsLeft, isSpent, stageOf } from "./game/crops";
import { createCropPlot, type CropPlot } from "./game/cropPlanting";
import { createWindMaterial } from "./game/voxelWind";
import type { ParticleWorld } from "./game/voxelParticles";

const SPACING = 1.1;

export async function mountCropPlots(scene: Scene, at: Vector3, options: { shadows?: ShadowGenerator; particles?: ParticleWorld } = {}): Promise<{ update(dt: number): void }> {
  const panel = document.createElement("section");
  panel.className = "rig-test-panel";
  panel.innerHTML = `<strong>Crop plots</strong>
    <p>One plot per crop on a shared clock. Sow, wait, pick, watch it come back.</p>
    <p class="rig-test-status" role="status">Loading…</p>
    <div class="rig-test-actions">
      <button data-plot="sow">Sow all</button>
      <button data-plot="harvest">Harvest ready</button>
      <button data-plot="speed">Speed ×8</button>
    </div>`;
  document.body.append(panel);
  const status = panel.querySelector<HTMLElement>(".rig-test-status")!;

  await ensureModels(cropDefinitions.flatMap((crop) => [
    ...Object.values(crop.stages), ...(crop.produce ? [crop.produce] : []),
  ]));

  const root = new TransformNode("crop plots", scene);
  root.position.copyFrom(at);
  const material = createWindMaterial("crop wind", scene);
  let now = 0;
  let speed = 8;
  let basket = 0;

  const plots: CropPlot[] = cropDefinitions.map((crop, index) => {
    const plot = createCropPlot({
      scene, catalog, crop, parent: root, position: new Vector3(index * SPACING, 0, 0),
      spin: (index % 4) * 0.7, seed: `plot:${crop.id}`, material,
      shadows: options.shadows, particles: options.particles, name: `plot ${crop.id}`,
    });
    plot.sow(now);
    return plot;
  });

  const sowAll = (): void => { for (const plot of plots) plot.sow(now); basket = 0; };
  const harvestReady = (): void => {
    for (const plot of plots) if (plot.ready(now)) basket += plot.harvest(now).items;
  };
  panel.querySelector('[data-plot="sow"]')!.addEventListener("click", sowAll);
  panel.querySelector('[data-plot="harvest"]')!.addEventListener("click", harvestReady);
  const speedButton = panel.querySelector<HTMLButtonElement>('[data-plot="speed"]')!;
  speedButton.addEventListener("click", () => {
    speed = speed >= 32 ? 1 : speed * 2;
    speedButton.textContent = `Speed ×${speed}`;
  });

  let sinceReport = 0;
  return {
    update(dt) {
      now += dt * speed;
      for (const plot of plots) plot.update(now, dt);
      sinceReport += dt;
      if (sinceReport < 0.25) return;
      sinceReport = 0;
      const lines = plots.map((plot) => {
        if (!plot.state) return `${plot.crop.name}: bare soil`;
        const left = harvestsLeft(plot.crop, plot.state);
        const stage = stageOf(plot.crop, plot.state, now);
        const mark = isSpent(plot.crop, plot.state) ? "spent" : plot.ready(now) ? "READY" : stage;
        return `${plot.crop.name}: ${mark}${plot.shown ? ` ${plot.shown}×` : ""}${Number.isFinite(left) ? ` (${left} left)` : ""}`;
      });
      status.innerHTML = `t=${now.toFixed(0)}s · basket ${basket}<br>${lines.join("<br>")}`;
    },
  };
}
