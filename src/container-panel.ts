// What is inside a thing, and getting it out again.
//
// Every container in the game already SHOWS its contents — the crate stands its
// produce on a grid, the counter stands its ingredients on the board, the bin's
// heap rises with what is in it. This is the other half: a way to take a
// particular thing back out, which the world alone cannot offer once a crate
// holds four kinds of vegetable and you want the carrots.
//
// Deliberately plain HTML for now. The roadmap has the whole UI moving to voxel
// panels in world space; this is built so that swap is a rewrite of the view
// and not of the rules — it takes rows and hands back what the player clicked.
import { catalog } from "./assets/catalog/index";

export interface ContainerRow {
  /** Catalog id, or a free label for something that is not an item. */
  item: string;
  count: number;
  /** False for things that cannot be taken out yet — compost still rotting. */
  takeable?: boolean;
  /** Overrides the catalog name, for rows that are not catalog items. */
  label?: string;
  /** A word about this row: "rotting", "3 left". */
  note?: string;
}

export interface ContainerPanel {
  readonly open: boolean;
  /** Show a container. `onTake(item, count)` is called when the player takes
   *  some; return how many actually came out so the panel can refresh. */
  show(options: {
    title: string;
    rows: readonly ContainerRow[];
    onTake: (item: string, count: number) => number;
    /** Re-read the container after a take, so the panel stays true. */
    refresh: () => readonly ContainerRow[];
  }): void;
  close(): void;
  dispose(): void;
}

export function createContainerPanel(mount: HTMLElement): ContainerPanel {
  const panel = document.createElement("section");
  panel.className = "container-panel";
  panel.style.display = "none";
  panel.innerHTML = `<header><strong></strong><button data-act="close" title="Close (Esc)">✕</button></header><div class="container-rows"></div><footer></footer>`;
  mount.append(panel);

  const titleEl = panel.querySelector("strong")!;
  const rowsEl = panel.querySelector<HTMLElement>(".container-rows")!;
  const footerEl = panel.querySelector("footer")!;
  let current: Parameters<ContainerPanel["show"]>[0] | null = null;

  const nameOf = (row: ContainerRow): string => row.label ?? catalog.models[row.item]?.name ?? row.item;

  const draw = (rows: readonly ContainerRow[]): void => {
    rowsEl.innerHTML = rows.length
      ? rows.map((row, index) => `
        <div class="container-row">
          <span class="container-name">${nameOf(row)}</span>
          <span class="container-count">${row.count}</span>
          ${row.note ? `<span class="container-note">${row.note}</span>` : ""}
          ${row.takeable === false ? "" : `
            <button data-take="${index}" data-amount="1">take 1</button>
            <button data-take="${index}" data-amount="all">take all</button>`}
        </div>`).join("")
      : `<p class="container-empty">empty</p>`;
    const takeable = rows.filter((row) => row.takeable !== false).reduce((sum, row) => sum + row.count, 0);
    footerEl.innerHTML = takeable ? `<button data-take="*" data-amount="all">take everything (${takeable})</button>` : "";
  };

  panel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>("button");
    if (!button || !current) return;
    if (button.dataset.act === "close") { api.close(); return; }
    const rows = current.refresh();
    if (button.dataset.take === "*") {
      for (const row of rows) if (row.takeable !== false) current.onTake(row.item, row.count);
    } else {
      const row = rows[Number(button.dataset.take)];
      if (!row) return;
      current.onTake(row.item, button.dataset.amount === "all" ? row.count : 1);
    }
    draw(current.refresh());
  });

  const api: ContainerPanel = {
    get open() { return panel.style.display !== "none"; },
    show(options) {
      current = options;
      titleEl.textContent = options.title;
      draw(options.rows);
      panel.style.display = "";
    },
    close() {
      current = null;
      panel.style.display = "none";
    },
    dispose() { panel.remove(); },
  };
  return api;
}
