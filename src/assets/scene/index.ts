// Hand-placed decor for the game world (see src/game/decor.ts). Edited in the
// game's decorate mode, which saves through the dev endpoint /__lab/save-scene.
import type { DecorLayout } from "../../game/decorLayout";
import decorJson from "./decor.json";

export const decorLayout: DecorLayout = decorJson as DecorLayout;

// Self-accepting HMR: a save from decorate mode rewrites decor.json; the live
// scene already holds that state, so the update is absorbed without a reload
// (the game would otherwise restart mid-edit).
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const fresh = (updated as { decorLayout?: DecorLayout } | undefined)?.decorLayout;
    if (fresh) { decorLayout.props.splice(0, decorLayout.props.length, ...fresh.props); }
  });
}
