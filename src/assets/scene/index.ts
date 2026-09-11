// Hand-placed decor for the game world (see src/game/decor.ts). Edited in the
// game's decorate mode, which saves through the dev endpoint /__lab/save-scene.
import type { DecorLayout } from "../../game/decorLayout";
import type { LevelLayout, LevelProgress } from "../../game/levelLayout";
import decorJson from "./decor.json";
import levelJson from "./level.json";
import progressJson from "./progress.json";

export const decorLayout: DecorLayout = decorJson as DecorLayout;

// The site plan (every room, wall and parcel that can ever exist) and what the player owns so far.
// The build editor rewrites level.json through /__lab/save-level; progress.json is the save layer.
export const levelLayout: LevelLayout = levelJson as unknown as LevelLayout;
export const levelProgress: LevelProgress = progressJson as LevelProgress;

// Self-accepting HMR: a save from decorate mode rewrites decor.json; the live
// scene already holds that state, so the update is absorbed without a reload
// (the game would otherwise restart mid-edit).
if (import.meta.hot) {
  import.meta.hot.accept((updated) => {
    const module = updated as { decorLayout?: DecorLayout; levelLayout?: LevelLayout } | undefined;
    const fresh = module?.decorLayout;
    if (fresh) { decorLayout.props.splice(0, decorLayout.props.length, ...fresh.props); }
    // A level save swaps the whole plan; the world scene listens for this and rebuilds.
    const level = module?.levelLayout;
    if (level) {
      Object.assign(levelLayout, level);
      for (const listener of levelListeners) listener(levelLayout);
    }
  });
}

/** Called after a build-editor save replaces the level plan. */
const levelListeners = new Set<(layout: LevelLayout) => void>();
export function onLevelChanged(listener: (layout: LevelLayout) => void): () => void {
  levelListeners.add(listener);
  return () => levelListeners.delete(listener);
}
