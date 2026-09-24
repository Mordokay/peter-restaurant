import type { Scene, TransformNode } from "@babylonjs/core";
import { catalog, catalogIndex, ensureModels } from "./assets/catalog/index.ts";
import { createDecorScene, type DecorOptions, type DecorScene } from "./game/decor.ts";
import type { DecorLayout } from "./game/decorLayout.ts";
import { warmRigCache } from "./game/voxelRig.ts";
import { sourceCacheKey, warmSourceCache } from "./game/sourceCache.ts";

/** Temporary, opt-in browser fixture. Never added to the editable/saved decor layout. */
export async function mountRigTest(scene: Scene, player: TransformNode, options: DecorOptions, home: () => void): Promise<{ decor: DecorScene; update(dt: number): void }> {
  const panel = document.createElement("section");
  panel.className = "rig-test-panel";
  panel.setAttribute("aria-label", "Rig cache test");
  panel.innerHTML = `<strong>Rig cache test</strong>
    <p>Cabbage · potted aloe · upright freezer. Temporary props; your saved compound is unchanged.</p>
    <p class="rig-test-status" role="status">Loading three models and preparing their geometry… First load can take several seconds.</p>
    <div class="rig-test-actions">
      <button data-test="open" disabled>Open freezer</button><button data-test="close" disabled>Close freezer</button>
      <button data-test="cycle" disabled>Cycle cached rigs</button><button data-test="range" disabled>Simulate leaving range</button>
      <button data-test="home" disabled>Return to props</button>
    </div>
    <p class="rig-test-result">The aloe is static by design. Cabbage and freezer use their existing idle clips.</p>`;
  document.querySelector("#world")!.append(panel);
  const status = panel.querySelector<HTMLElement>(".rig-test-status")!;
  const result = panel.querySelector<HTMLElement>(".rig-test-result")!;
  try {
    const ids = ["savoy_cabbage", "aloe_vera_potted", "freezer_upright"];
    await ensureModels(ids);
    const rev = (id: string) => catalogIndex[id]?.rev;
    await warmSourceCache(ids.map((id) => sourceCacheKey(id, rev(id), 0.02)));
    await warmRigCache(ids.map((id) => catalog.models[id]!), scene, rev);
    const origin = player.position.clone();
    const layout: DecorLayout = { version: 1, props: [
      { id: "rig_test_cabbage", model: ids[0]!, position: [origin.x - 1.3, origin.y, origin.z - 1.5] },
      { id: "rig_test_aloe", model: ids[1]!, position: [origin.x, origin.y, origin.z - 1.5] },
      { id: "rig_test_freezer", model: ids[2]!, position: [origin.x + 1.3, origin.y, origin.z - 1.5], interactClip: "open" },
    ] };
    let away = false;
    const decor = createDecorScene(scene, catalog, layout, { ...options, cacheRev: rev,
      animation: { focus: () => away ? { x: origin.x + 100, z: origin.z } : player.position, maxRigs: 3 },
    });
    // Imported models can have origins below/above their base. Stand each on the same floor.
    for (const prop of layout.props) {
      const mesh = decor.renderer.meshOf(prop.id);
      if (!mesh) continue;
      mesh.computeWorldMatrix(true);
      prop.position[1] += origin.y - mesh.getBoundingInfo().boundingBox.minimumWorld.y;
      decor.refresh(prop.id);
    }
    home();
    for (const button of panel.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
    panel.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-test]");
      if (!button) return;
      if (button.dataset.test === "home") { player.position.copyFrom(origin); home(); return; }
      if (button.dataset.test === "range") {
        away = !away;
        button.textContent = away ? "Return within range" : "Simulate leaving range";
        result.textContent = away ? "Ambient motion stops. An opened freezer must stay open." : "Ambient motion resumes; existing geometry is reused.";
        return;
      }
      const before = decor.stats();
      const started = performance.now();
      if (button.dataset.test === "cycle") {
        for (const prop of layout.props) decor.pin(prop.id, true);
        for (const prop of layout.props) decor.pin(prop.id, false);
      } else {
        decor.placed.get("rig_test_freezer")!.prop.interactClip = button.dataset.test!;
        decor.trigger("rig_test_freezer");
      }
      const duration = performance.now() - started;
      result.textContent = `${button.textContent}: ${duration.toFixed(1)} ms total handler time; ${decor.stats().rigCacheMisses - before.rigCacheMisses} new part/state remeshes. Includes scene/physics work, not just rig creation.`;
    });
    let hudTime = 0;
    return { decor, update(dt) {
      decor.update(dt);
      hudTime += dt;
      if (hudTime < 0.2) return;
      hudTime = 0;
      const stats = decor.stats();
      status.textContent = `${stats.props} props · ${stats.ambientRigs} ambient rigs · ${stats.protectedRigs} protected rigs · ${stats.rigCacheHits} cached part/state restores · ${stats.rigCacheMisses} part/state remeshes`;
    } };
  } catch (error) {
    status.textContent = `Could not load the test: ${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}
