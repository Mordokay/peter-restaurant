// The catalog browser: a Sims-style build catalog for the voxel library, shared by the
// Model Lab (pick what to inspect/edit) and the game's decorate mode (pick what to place).
// Tiles with thumbnails in a grid, a search box, and filters that combine — zone, kind,
// size class, folder — plus favourites and a recent strip. Everything reads from the
// small catalog index (src/assets/catalog/index.ts), never from voxel data, so 800
// objects browse as fast as 30. Filters, favourites and recents persist per host in
// localStorage. Tags suggest and narrow; they never hide (an object with no tags is
// still found by search and by "All").
import "./catalogBrowser.css";
import type { CatalogIndexEntry } from "./assets/catalog/index";
import { KIND_LABELS, KIND_TAGS, SIZE_LABELS, ZONE_LABELS, ZONE_TAGS, sizeClassOf, type KindTag, type SizeClass, type ZoneTag } from "./game/catalogTags";

export interface BrowserExtraTile {
  id: string;
  label: string;
  /** Emoji shown instead of a thumbnail. */
  icon: string;
  hint?: string;
}

export interface CatalogBrowserOptions {
  root: HTMLElement;
  /** Live index — the browser re-reads it on every render(). */
  index: Record<string, CatalogIndexEntry>;
  labelOf(id: string): string;
  thumbnailUrl(id: string): string | undefined;
  /** localStorage prefix: favourites, recents, filters and layout are kept per host. */
  storageKey: string;
  /** Ids never shown (e.g. the game's internal tomato source). */
  hidden?: ReadonlySet<string>;
  /** Tiles that are not catalog models (the lab's staged tomato). Always listed first. */
  extras?: readonly BrowserExtraTile[];
  /** Attribute name set on every tile with the model id (hosts wire their own drag/pointer code to it). */
  idAttribute?: string;
  onOpen(id: string): void;
  onContext?(id: string, event: MouseEvent): void;
  onDragStart?(id: string, event: DragEvent): void;
  /** Called after every render so hosts can decorate tiles (drop targets, badges). */
  onRendered?(grid: HTMLElement): void;
  /** Explanation under the search box; optional. */
  hint?: string;
}

export interface CatalogBrowser {
  readonly root: HTMLElement;
  render(): void;
  /** Mark the current selection (highlighted tile). */
  setSelected(id: string | null): void;
  /** Remember an id as recently used (moves it to the front of the recent strip). */
  noteUsed(id: string): void;
  /** Move the selection across the grid: dx ±1 (left/right), dy ±1 (up/down), or "home"/"end". */
  move(step: { dx?: number; dy?: number; to?: "home" | "end" }): string | null;
  /** Ids currently listed, in grid order. */
  visibleIds(): string[];
  focusSearch(): void;
  focusSelected(): void;
  dispose(): void;
}

type SortKey = "name" | "size" | "voxels" | "recent";
interface BrowserState {
  query: string;
  zones: ZoneTag[];
  kinds: KindTag[];
  sizes: SizeClass[];
  folder: string | null;
  favouritesOnly: boolean;
  sort: SortKey;
  foldersOpen: boolean;
  tile: "s" | "m" | "l";
}
interface Persisted extends BrowserState { favourites: string[]; recents: string[] }

const DEFAULT_STATE: BrowserState = { query: "", zones: [], kinds: [], sizes: [], folder: null, favouritesOnly: false, sort: "name", foldersOpen: false, tile: "m" };
const RECENTS_MAX = 24;
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const formatSize = (metres: number): string => (metres >= 1 ? `${metres.toFixed(metres < 10 ? 1 : 0)} m` : `${Math.round(metres * 100)} cm`);

export function createCatalogBrowser(options: CatalogBrowserOptions): CatalogBrowser {
  const { root, index, labelOf, thumbnailUrl, storageKey } = options;
  const idAttribute = options.idAttribute ?? "data-id";
  let state: BrowserState = { ...DEFAULT_STATE };
  let favourites = new Set<string>();
  let recents: string[] = [];
  let selected: string | null = null;
  let grid: HTMLElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let gridScroll = 0;

  try {
    const saved = JSON.parse(localStorage.getItem(`${storageKey}:browser`) ?? "null") as Partial<Persisted> | null;
    if (saved) {
      state = { ...DEFAULT_STATE, ...saved, zones: (saved.zones ?? []).filter((z) => (ZONE_TAGS as readonly string[]).includes(z)) as ZoneTag[], kinds: (saved.kinds ?? []).filter((k) => (KIND_TAGS as readonly string[]).includes(k)) as KindTag[] };
      favourites = new Set(saved.favourites ?? []);
      recents = saved.recents ?? [];
    }
  } catch { /* private mode or corrupt: defaults */ }
  const persist = () => { try { localStorage.setItem(`${storageKey}:browser`, JSON.stringify({ ...state, favourites: [...favourites], recents } satisfies Persisted)); } catch { /* ignore */ } };

  root.classList.add("cb");
  root.innerHTML = `
    <div class="cb-search"><input type="search" placeholder="Search objects" autocomplete="off" spellcheck="false" /><button class="cb-clear" title="Clear search and filters (Esc)">✕</button></div>
    ${options.hint ? `<p class="cb-hint">${escapeHtml(options.hint)}</p>` : ""}
    <div class="cb-chips cb-zones"></div>
    <div class="cb-chips cb-kinds"></div>
    <div class="cb-bar">
      <span class="cb-count"></span>
      <span class="cb-grow"></span>
      <select class="cb-sizes" title="Size class: by the longest side"><option value="">any size</option>${(Object.keys(SIZE_LABELS) as SizeClass[]).map((size) => `<option value="${size}">${SIZE_LABELS[size]}</option>`).join("")}</select>
      <select class="cb-sort" title="Order"><option value="name">A → Z</option><option value="recent">recent first</option><option value="size">biggest first</option><option value="voxels">most detail first</option></select>
      <button class="cb-fav ${state.favouritesOnly ? "on" : ""}" title="Only favourites (★ on a tile toggles it)">★</button>
      <button class="cb-folders-toggle ${state.foldersOpen ? "on" : ""}" title="Folder rail: browse by pack">📁</button>
      <button class="cb-tilesize" title="Tile size">▦</button>
    </div>
    <div class="cb-body">
      <aside class="cb-folders" ${state.foldersOpen ? "" : "hidden"}></aside>
      <div class="cb-grid" tabindex="0" role="listbox"></div>
    </div>`;
  searchInput = root.querySelector<HTMLInputElement>(".cb-search input")!;
  searchInput.value = state.query;
  grid = root.querySelector<HTMLElement>(".cb-grid")!;
  root.dataset.tile = state.tile;

  // ------------------------------------------------------------------ data --
  interface Row { id: string; label: string; entry: CatalogIndexEntry | null; extra?: BrowserExtraTile }
  const rows = (): Row[] => {
    const out: Row[] = [];
    for (const extra of options.extras ?? []) out.push({ id: extra.id, label: extra.label, entry: null, extra });
    for (const [id, entry] of Object.entries(index)) if (!options.hidden?.has(id)) out.push({ id, label: labelOf(id), entry });
    return out;
  };
  const matchesQuery = (row: Row, terms: string[]): boolean => {
    if (!terms.length) return true;
    const haystack = `${row.id} ${row.label} ${row.entry?.folder ?? ""} ${(row.entry?.tags ?? []).join(" ")}`.toLowerCase().replaceAll("_", " ");
    return terms.every((term) => haystack.includes(term));
  };
  const passes = (row: Row): boolean => {
    if (row.extra) return !state.zones.length && !state.kinds.length && !state.sizes.length && !state.folder && !state.favouritesOnly;
    const entry = row.entry!;
    const tags = entry.tags ?? [];
    if (state.zones.length && !state.zones.some((zone) => tags.includes(zone))) return false;
    if (state.kinds.length && !state.kinds.some((kind) => tags.includes(kind))) return false;
    if (state.sizes.length && !state.sizes.includes(sizeClassOf(entry.size))) return false;
    if (state.folder !== null && !((entry.folder ?? "") === state.folder || (entry.folder ?? "").startsWith(`${state.folder}/`))) return false;
    if (state.favouritesOnly && !favourites.has(row.id)) return false;
    return true;
  };
  const sortRows = (list: Row[]): Row[] => {
    const rank = (row: Row) => (row.extra ? -1 : recents.indexOf(row.id) === -1 ? Number.MAX_SAFE_INTEGER : recents.indexOf(row.id));
    const longest = (row: Row) => Math.max(...(row.entry?.size ?? [0]));
    return [...list].sort((a, b) => {
      if (a.extra !== b.extra) return a.extra ? -1 : 1;
      switch (state.sort) {
        case "recent": return rank(a) - rank(b) || a.label.localeCompare(b.label);
        case "size": return longest(b) - longest(a) || a.label.localeCompare(b.label);
        case "voxels": return (b.entry?.voxels ?? 0) - (a.entry?.voxels ?? 0) || a.label.localeCompare(b.label);
        default: return a.label.localeCompare(b.label);
      }
    });
  };
  let listed: Row[] = [];
  const compute = (): Row[] => {
    const terms = state.query.trim().toLowerCase().replaceAll("_", " ").split(/\s+/).filter(Boolean);
    listed = sortRows(rows().filter((row) => matchesQuery(row, terms) && passes(row)));
    return listed;
  };

  // ------------------------------------------------------------ rendering --
  const tileHtml = (row: Row, isRecent = false): string => {
    const thumb = row.extra ? undefined : thumbnailUrl(row.id);
    const size = row.entry ? `↕ ${formatSize(row.entry.size[1])}` : "";
    const picture = row.extra ? `<span class="cb-icon">${row.extra.icon}</span>` : thumb ? `<img src="${thumb}" alt="" loading="lazy" decoding="async" />` : `<span class="cb-icon cb-placeholder">${escapeHtml(row.label.slice(0, 1).toUpperCase())}</span>`;
    const title = row.extra ? row.extra.hint ?? row.label : `${row.label} · ${row.id}${row.entry?.folder ? ` · ${row.entry.folder}` : ""}${row.entry ? ` · ${formatSize(row.entry.size[0])} × ${formatSize(row.entry.size[1])} × ${formatSize(row.entry.size[2])} · ${row.entry.voxels.toLocaleString()} voxels · ${row.entry.parts} part${row.entry.parts === 1 ? "" : "s"}${row.entry.clips?.length ? ` · ${row.entry.clips.length} clip${row.entry.clips.length === 1 ? "" : "s"}` : ""}` : ""}${(row.entry?.tags?.length) ? `\n${row.entry.tags.join(" · ")}` : ""}`;
    return `<div class="cb-tile ${row.id === selected ? "selected" : ""} ${favourites.has(row.id) ? "fav" : ""} ${isRecent ? "recent" : ""}" role="option" aria-selected="${row.id === selected}" ${idAttribute}="${escapeHtml(row.id)}" data-cb-id="${escapeHtml(row.id)}" title="${escapeHtml(title)}" draggable="${row.extra ? "false" : "true"}" tabindex="-1">
      <span class="cb-picture">${picture}${row.entry?.clips?.length ? `<span class="cb-badge" title="animated">▶</span>` : ""}</span>
      <span class="cb-name">${escapeHtml(row.label)}</span>
      <span class="cb-meta">${size}</span>
      ${row.extra ? "" : `<button class="cb-star" data-cb-star="${escapeHtml(row.id)}" title="${favourites.has(row.id) ? "Remove from favourites" : "Add to favourites"}" tabindex="-1">${favourites.has(row.id) ? "★" : "☆"}</button>`}
    </div>`;
  };
  const chipCounts = (group: "zones" | "kinds"): Map<string, number> => {
    // Counts with every filter applied except this group's own — what you would get by picking it.
    const saved = state[group];
    (state as unknown as Record<string, unknown>)[group] = [];
    const base = rows().filter((row) => !row.extra && matchesQuery(row, state.query.trim().toLowerCase().replaceAll("_", " ").split(/\s+/).filter(Boolean)) && passes(row));
    (state as unknown as Record<string, unknown>)[group] = saved;
    const counts = new Map<string, number>();
    for (const row of base) for (const tag of row.entry?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return counts;
  };
  const renderChips = () => {
    const zoneCounts = chipCounts("zones");
    const kindCounts = chipCounts("kinds");
    root.querySelector(".cb-zones")!.innerHTML = `<button class="cb-chip ${!state.zones.length ? "on" : ""}" data-cb-zone="">All</button>` + ZONE_TAGS.map((zone) => `<button class="cb-chip ${state.zones.includes(zone) ? "on" : ""}" data-cb-zone="${zone}" ${zoneCounts.get(zone) ? "" : 'data-empty="1"'}>${ZONE_LABELS[zone]} <small>${zoneCounts.get(zone) ?? 0}</small></button>`).join("");
    root.querySelector(".cb-kinds")!.innerHTML = KIND_TAGS.filter((kind) => (kindCounts.get(kind) ?? 0) > 0 || state.kinds.includes(kind)).map((kind) => `<button class="cb-chip small ${state.kinds.includes(kind) ? "on" : ""}" data-cb-kind="${kind}">${KIND_LABELS[kind]} <small>${kindCounts.get(kind) ?? 0}</small></button>`).join("");
  };
  const renderFolders = () => {
    const rail = root.querySelector<HTMLElement>(".cb-folders")!;
    rail.hidden = !state.foldersOpen;
    if (!state.foldersOpen) return;
    const counts = new Map<string, number>();
    for (const [id, entry] of Object.entries(index)) {
      if (options.hidden?.has(id)) continue;
      const parts = (entry.folder ?? "").split("/").filter(Boolean);
      for (let depth = 0; depth <= parts.length; depth++) { const path = parts.slice(0, depth).join("/"); counts.set(path, (counts.get(path) ?? 0) + 1); }
    }
    const paths = [...counts.keys()].filter(Boolean).sort();
    rail.innerHTML = `<button class="cb-folder ${state.folder === null ? "on" : ""}" data-cb-folder="" style="--depth:0">📚 Everything <small>${counts.get("") ?? 0}</small></button>` +
      paths.map((path) => `<button class="cb-folder ${state.folder === path ? "on" : ""}" data-cb-folder="${escapeHtml(path)}" style="--depth:${path.split("/").length}">📁 ${escapeHtml(path.split("/").pop()!)} <small>${counts.get(path)}</small></button>`).join("");
  };
  const render = () => {
    if (!grid) return;
    const list = compute();
    renderChips();
    renderFolders();
    const filtering = state.query.trim() || state.zones.length || state.kinds.length || state.sizes.length || state.folder !== null || state.favouritesOnly;
    const recentRows = !filtering && state.sort !== "recent" ? recents.map((id) => list.find((row) => row.id === id)).filter((row): row is Row => Boolean(row)).slice(0, 8) : [];
    root.querySelector(".cb-count")!.textContent = `${list.length} object${list.length === 1 ? "" : "s"}${state.folder !== null ? ` in ${state.folder || "Unfiled"}` : ""}`;
    root.querySelector<HTMLButtonElement>(".cb-fav")!.classList.toggle("on", state.favouritesOnly);
    root.querySelector<HTMLButtonElement>(".cb-folders-toggle")!.classList.toggle("on", state.foldersOpen);
    root.querySelector<HTMLSelectElement>(".cb-sizes")!.value = state.sizes[0] ?? "";
    root.querySelector<HTMLSelectElement>(".cb-sort")!.value = state.sort;
    root.querySelector<HTMLButtonElement>(".cb-clear")!.hidden = !filtering;
    gridScroll = grid.scrollTop;
    grid.innerHTML = (recentRows.length ? `<div class="cb-section">Recent</div><div class="cb-strip">${recentRows.map((row) => tileHtml(row, true)).join("")}</div><div class="cb-section">All</div>` : "") +
      (list.length ? list.map((row) => tileHtml(row)).join("") : `<div class="cb-empty">Nothing matches.${state.query ? ` Try fewer words` : ""}${filtering ? ` or clear the filters (Esc).` : "."}</div>`);
    grid.scrollTop = gridScroll;
    options.onRendered?.(grid);
  };

  // --------------------------------------------------------------- events --
  const setState = (patch: Partial<BrowserState>) => { state = { ...state, ...patch }; persist(); render(); };
  root.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (target === searchInput) { state.query = searchInput!.value; persist(); render(); }
    else if (target.classList.contains("cb-sizes")) setState({ sizes: (target as HTMLSelectElement).value ? [(target as HTMLSelectElement).value as SizeClass] : [] });
    else if (target.classList.contains("cb-sort")) setState({ sort: (target as HTMLSelectElement).value as SortKey });
  });
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const star = target.closest<HTMLElement>("[data-cb-star]");
    if (star) { event.stopPropagation(); const id = star.dataset.cbStar!; if (favourites.has(id)) favourites.delete(id); else favourites.add(id); persist(); render(); return; }
    const zone = target.closest<HTMLElement>("[data-cb-zone]");
    if (zone) { const value = zone.dataset.cbZone as ZoneTag | ""; setState({ zones: value === "" ? [] : state.zones.includes(value) ? state.zones.filter((z) => z !== value) : [...state.zones, value] }); return; }
    const kind = target.closest<HTMLElement>("[data-cb-kind]");
    if (kind) { const value = kind.dataset.cbKind as KindTag; setState({ kinds: state.kinds.includes(value) ? state.kinds.filter((k) => k !== value) : [...state.kinds, value] }); return; }
    const folder = target.closest<HTMLElement>("[data-cb-folder]");
    if (folder) { const value = folder.dataset.cbFolder!; setState({ folder: value === "" ? null : state.folder === value ? null : value }); return; }
    if (target.closest(".cb-clear")) { searchInput!.value = ""; setState({ query: "", zones: [], kinds: [], sizes: [], folder: null, favouritesOnly: false }); return; }
    if (target.closest(".cb-fav")) { setState({ favouritesOnly: !state.favouritesOnly }); return; }
    if (target.closest(".cb-folders-toggle")) { setState({ foldersOpen: !state.foldersOpen }); return; }
    if (target.closest(".cb-tilesize")) { const next = state.tile === "s" ? "m" : state.tile === "m" ? "l" : "s"; root.dataset.tile = next; setState({ tile: next }); return; }
    const tile = target.closest<HTMLElement>("[data-cb-id]");
    if (tile) { const id = tile.dataset.cbId!; selected = id; options.onOpen(id); }
  });
  root.addEventListener("contextmenu", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-cb-id]");
    if (tile && options.onContext) { event.preventDefault(); options.onContext(tile.dataset.cbId!, event); }
  });
  root.addEventListener("dragstart", (event) => {
    const tile = (event.target as HTMLElement).closest<HTMLElement>("[data-cb-id]");
    if (!tile) return;
    event.dataTransfer?.setData("text/plain", tile.dataset.cbId!);
    tile.classList.add("dragging");
    options.onDragStart?.(tile.dataset.cbId!, event);
  });
  root.addEventListener("dragend", (event) => { (event.target as HTMLElement).closest?.(".cb-tile")?.classList.remove("dragging"); });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (state.query || state.zones.length || state.kinds.length || state.sizes.length || state.folder !== null || state.favouritesOnly)) { event.preventDefault(); searchInput!.value = ""; setState({ query: "", zones: [], kinds: [], sizes: [], folder: null, favouritesOnly: false }); return; }
    if (event.target === searchInput && event.key === "Enter") { const first = listed[0]; if (first) { event.preventDefault(); selected = first.id; options.onOpen(first.id); } return; }
    if (event.target === searchInput && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const step = event.key === "ArrowRight" ? { dx: 1 } : event.key === "ArrowLeft" ? { dx: -1 } : event.key === "ArrowDown" ? { dy: 1 } : event.key === "ArrowUp" ? { dy: -1 } : event.key === "Home" ? { to: "home" as const } : event.key === "End" ? { to: "end" as const } : null;
    if (step) { event.preventDefault(); const id = move(step); if (id) options.onOpen(id); return; }
    if (event.key === "Enter" && selected) { event.preventDefault(); options.onOpen(selected); }
  });

  // ------------------------------------------------------------ selection --
  const gridTiles = (): HTMLElement[] => grid ? [...grid.querySelectorAll<HTMLElement>(".cb-tile:not(.recent)")] : [];
  const columns = (): number => {
    const tiles = gridTiles();
    if (tiles.length < 2) return 1;
    const top = tiles[0]!.offsetTop;
    let count = 1;
    while (count < tiles.length && tiles[count]!.offsetTop === top) count++;
    return count;
  };
  function move(step: { dx?: number; dy?: number; to?: "home" | "end" }): string | null {
    const ids = gridTiles().map((tile) => tile.dataset.cbId!);
    if (!ids.length) return null;
    const current = selected ? ids.indexOf(selected) : -1;
    let next: number;
    if (step.to === "home") next = 0;
    else if (step.to === "end") next = ids.length - 1;
    else if (current < 0) next = (step.dx ?? 0) < 0 || (step.dy ?? 0) < 0 ? ids.length - 1 : 0;
    else next = Math.max(0, Math.min(ids.length - 1, current + (step.dx ?? 0) + (step.dy ?? 0) * columns()));
    if (next === current) return null;
    selected = ids[next]!;
    highlight();
    return selected;
  }
  const highlight = () => {
    if (!grid) return;
    for (const tile of grid.querySelectorAll<HTMLElement>(".cb-tile")) { const on = tile.dataset.cbId === selected; tile.classList.toggle("selected", on); tile.setAttribute("aria-selected", String(on)); }
    const target = grid.querySelector<HTMLElement>(`.cb-tile.selected:not(.recent)`) ?? grid.querySelector<HTMLElement>(".cb-tile.selected");
    target?.scrollIntoView({ block: "nearest" });
  };

  render();
  return {
    root,
    render,
    setSelected(id) { selected = id; highlight(); },
    noteUsed(id) { recents = [id, ...recents.filter((other) => other !== id)].slice(0, RECENTS_MAX); persist(); },
    move,
    visibleIds: () => listed.map((row) => row.id),
    focusSearch() { searchInput?.focus(); searchInput?.select(); },
    focusSelected() { (grid?.querySelector<HTMLElement>(".cb-tile.selected:not(.recent)") ?? grid)?.focus({ preventScroll: true }); },
    dispose() { root.innerHTML = ""; root.classList.remove("cb"); },
  };
}
