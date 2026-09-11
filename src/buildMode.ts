// Build mode: draw the restaurant.
//
// Rooms are what you draw; walls fall out of them (see deriveWalls in game/levelEdit.ts), which is what
// makes this feel like The Sims rather than like placing fences. Draw a rectangle and you get a floor with
// walls around it, sharing any edge it meets. Then cut doors and windows into those walls, paint wall and
// floor types, and drop outdoor ground for plots and paths.
//
// Everything writes to the same src/assets/scene/level.json the game loads, through /__lab/save-level.
// The plan is edited immutably and then copied over the live layout object, so undo is a stack of plans
// and every holder of the layout sees the same state.
import "./buildMode.css";
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, type ArcRotateCamera } from "@babylonjs/core";
import {
  DEFAULT_WALL_HEIGHT, wallLength, wallTypeOf,
  type Area, type LevelLayout, type Opening, type OpeningKind, type Rect, type Room, type Wall,
} from "./game/levelLayout";
import { ROOM_FLOOR_Y } from "./game/levelBuilder";
import {
  addArea, addOpening, addRoom, edgeAt, itemAt, nextId, overlapsRoom, paintWall, rectFromDrag,
  removeArea, removeOpeningAt, removeRoom, setEdgeOpen, updateArea, updateRoom, wallKey, wallNear,
} from "./game/levelEdit";

export interface BuildModeHost {
  scene: Scene;
  canvas: HTMLCanvasElement;
  /** The live plan. Edits are copied onto this object so every holder sees them. */
  layout: LevelLayout;
  camera: () => ArcRotateCamera;
  /** Rebuild the world after a change. */
  onChanged: () => void;
  /** Where to mount the panel. */
  mount: HTMLElement;
}

export interface BuildMode {
  readonly active: boolean;
  toggle(): void;
  update(dt: number): void;
  dispose(): void;
}

type Tool = "select" | "room" | "area" | "door" | "window" | "paintWall" | "paintFloor" | "erase";
const TOOLS: { id: Tool; icon: string; label: string; key: string; hint: string }[] = [
  { id: "select", icon: "➤", label: "Select", key: "1", hint: "Pick a room or a patch of ground and edit its name, zone and price" },
  { id: "room", icon: "▭", label: "Room", key: "2", hint: "Drag a rectangle: a floor appears with walls around it, shared with any room it touches" },
  { id: "area", icon: "🌱", label: "Ground", key: "3", hint: "Drag a rectangle of outdoor ground — a farm plot, a path, a yard" },
  { id: "door", icon: "🚪", label: "Door", key: "4", hint: "Click a wall to cut a doorway there" },
  { id: "window", icon: "🪟", label: "Window", key: "5", hint: "Click a wall to cut a window there" },
  { id: "paintWall", icon: "🧱", label: "Paint wall", key: "6", hint: "Click a wall to give it the selected wall type, or click a gap between rooms to build a wall there" },
  { id: "paintFloor", icon: "🪵", label: "Paint floor", key: "7", hint: "Click a room or ground to give it the selected floor type" },
  { id: "erase", icon: "🗑", label: "Erase", key: "8", hint: "Click a door or window to fill it in, a wall to knock it through, or a selected room to remove it" },
];

const clone = (layout: LevelLayout): LevelLayout => JSON.parse(JSON.stringify(layout)) as LevelLayout;

export function createBuildMode(host: BuildModeHost): BuildMode {
  const { scene, canvas, layout } = host;
  let active = false;
  let tool: Tool = "select";
  let wallType = layout.wallTypes[0]?.id ?? "";
  let floorType = layout.floorTypes[0]?.id ?? "";
  let selected: { kind: "room" | "area"; id: string } | null = null;
  let status = "Draw a room, or pick something to edit.";
  let dirty = false;
  const undoStack: LevelLayout[] = [];
  const redoStack: LevelLayout[] = [];
  let root: HTMLElement | null = null;

  // Drag state and the ghost rectangle that shows what you are about to make.
  let drag: { x: number; z: number } | null = null;
  let preview: Mesh | null = null;
  const previewMaterial = new StandardMaterial("build preview", scene);
  previewMaterial.diffuseColor = Color3.FromHexString("#72bd63");
  previewMaterial.emissiveColor = Color3.FromHexString("#2d5a26");
  previewMaterial.alpha = 0.45;
  previewMaterial.specularColor.set(0, 0, 0);
  const badMaterial = previewMaterial.clone("build preview bad");
  badMaterial.diffuseColor = Color3.FromHexString("#d0553f");
  badMaterial.emissiveColor = Color3.FromHexString("#5a2018");

  /** Where the pointer meets the floor plane. */
  function groundPoint(event: PointerEvent): { x: number; z: number } | null {
    const rect = canvas.getBoundingClientRect();
    const ray = scene.createPickingRay((event.clientX - rect.left) * (canvas.width / rect.width), (event.clientY - rect.top) * (canvas.height / rect.height), null, host.camera());
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return null;
    const point = ray.origin.add(ray.direction.scale(t));
    return { x: point.x, z: point.z };
  }

  function commit(next: LevelLayout, message: string): void {
    undoStack.push(clone(layout));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
    apply(next);
    dirty = true;
    status = message;
    render();
  }
  /** Copy a plan onto the live object so the renderer and every other holder see it. */
  function apply(next: LevelLayout): void {
    Object.assign(layout, next);
    host.onChanged();
  }
  function undo(): void {
    const previous = undoStack.pop();
    if (!previous) { status = "Nothing to undo"; render(); return; }
    redoStack.push(clone(layout));
    apply(previous);
    dirty = true;
    status = "Undo";
    render();
  }
  function redo(): void {
    const next = redoStack.pop();
    if (!next) { status = "Nothing to redo"; render(); return; }
    undoStack.push(clone(layout));
    apply(next);
    dirty = true;
    status = "Redo";
    render();
  }

  /** The ghost. A floor pad lies flat; a wall or a doorway is shown at full height, so you can see
   *  exactly what a click is about to take rather than guessing from a stripe on the ground. */
  function showPreview(rect: Rect | null, ok: boolean, volume: { base: number; height: number } | null = null): void {
    if (!rect) { preview?.setEnabled(false); return; }
    if (!preview) { preview = MeshBuilder.CreateBox("build preview", { size: 1 }, scene); preview.isPickable = false; }
    preview.material = ok ? previewMaterial : badMaterial;
    const height = volume ? Math.max(0.05, volume.height) : 0.12;
    const base = volume ? volume.base : 0.14;
    preview.scaling.set(Math.max(0.05, rect[2]), height, Math.max(0.05, rect[3]));
    preview.position.set(rect[0] + rect[2] / 2, base + height / 2, rect[1] + rect[3] / 2);
    preview.setEnabled(true);
  }

  /** How tall a wall stands, so its ghost matches it. */
  function heightOf(wall: Wall): number {
    const room = wall.room ? layout.rooms.find((candidate) => candidate.id === wall.room) : undefined;
    return wall.height ?? room?.wallHeight ?? wallTypeOf(layout, wall.type).height ?? DEFAULT_WALL_HEIGHT;
  }
  /** Footprint of a stretch of wall, thick enough to see from any angle. */
  function wallFootprint(wall: Wall, from: number, span: number): Rect {
    const horizontal = Math.abs(wall.from[1] - wall.to[1]) < 1e-6;
    const thickness = Math.max(0.3, wallTypeOf(layout, wall.type).thickness);
    const cx = wall.from[0] + (horizontal ? from + span / 2 : 0);
    const cz = wall.from[1] + (horizontal ? 0 : from + span / 2);
    return horizontal ? [cx - span / 2, cz - thickness / 2, span, thickness] : [cx - thickness / 2, cz - span / 2, thickness, span];
  }
  /** Where an opening sits in its wall, vertically. */
  function openingVolume(opening: Opening): { base: number; height: number } {
    const sill = opening.sill ?? (opening.kind === "window" ? 1 : 0);
    return { base: ROOM_FLOOR_Y + sill, height: opening.height ?? (opening.kind === "window" ? 1.2 : 2.1) };
  }

  function onPointerDown(event: PointerEvent): void {
    if (!active || event.button !== 0) return;
    const point = groundPoint(event);
    if (!point) return;
    if (tool === "room" || tool === "area") { drag = point; event.preventDefault(); return; }
    handleClick(point);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active) return;
    const point = groundPoint(event);
    if (!point) return;
    if (drag && (tool === "room" || tool === "area")) {
      const rect = rectFromDrag(drag.x, drag.z, point.x, point.z, layout.grid);
      showPreview(rect, tool === "area" || !overlapsRoom(layout, rect));
      return;
    }
    // Hovering a wall with a door or paint tool shows where it would land.
    if (tool === "erase") {
      const near = wallNear(layout, point.x, point.z, 0.9);
      if (near) {
        const opening = near.wall.openings?.find((candidate) => Math.abs(candidate.at - near.at) <= candidate.width / 2 + 0.3);
        // An opening ghosts as the hole it is; a wall ghosts as the whole wall, top to bottom.
        if (opening) showPreview(wallFootprint(near.wall, opening.at - opening.width / 2, opening.width), false, openingVolume(opening));
        else showPreview(wallFootprint(near.wall, 0, wallLength(near.wall)), false, { base: ROOM_FLOOR_Y, height: heightOf(near.wall) });
        return;
      }
      const hit = itemAt(layout, point.x, point.z);
      showPreview(hit && hit.item.id !== "site_grounds" ? hit.item.rect : null, false);
      return;
    }
    if (tool === "door" || tool === "window" || tool === "paintWall") {
      const near = wallNear(layout, point.x, point.z, 1);
      if (!near) { showPreview(null, true); return; }
      if (tool === "paintWall") {
        showPreview(wallFootprint(near.wall, 0, wallLength(near.wall)), true, { base: ROOM_FLOOR_Y, height: heightOf(near.wall) });
        return;
      }
      const kind: OpeningKind = tool === "door" ? "door" : "window";
      const width = kind === "door" ? 1.2 : 1;
      const at = Math.min(wallLength(near.wall) - width / 2, Math.max(width / 2, near.at));
      showPreview(wallFootprint(near.wall, at - width / 2, width), true, openingVolume({ at, width, kind }));
      return;
    }
    showPreview(null, true);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!active || !drag) return;
    const point = groundPoint(event) ?? drag;
    const rect = rectFromDrag(drag.x, drag.z, point.x, point.z, layout.grid);
    drag = null;
    showPreview(null, true);
    if (rect[2] < layout.grid * 2 || rect[3] < layout.grid * 2) { status = "Too small — drag out a bigger rectangle"; render(); return; }
    if (tool === "room") {
      const clash = overlapsRoom(layout, rect);
      if (clash) { status = `That would overlap ${clash.name}`; render(); return; }
      const id = nextId(layout, "room");
      const room: Room = { id, name: "New room", zone: "custom", rect, floor: floorType, exteriorWall: wallType, interiorWall: wallType, cost: Math.round(rect[2] * rect[3] * 40) };
      selected = { kind: "room", id };
      commit(addRoom(layout, room), `Room drawn: ${rect[2].toFixed(1)} × ${rect[3].toFixed(1)} m`);
    } else if (tool === "area") {
      const id = nextId(layout, "ground");
      const area: Area = { id, name: "New ground", zone: "outdoor", rect, ground: floorType, cost: Math.round(rect[2] * rect[3] * 8) };
      selected = { kind: "area", id };
      commit(addArea(layout, area), `Ground drawn: ${rect[2].toFixed(1)} × ${rect[3].toFixed(1)} m`);
    }
  }

  function handleClick(point: { x: number; z: number }): void {
    switch (tool) {
      case "select": {
        const hit = itemAt(layout, point.x, point.z);
        selected = hit ? { kind: hit.kind, id: hit.item.id } : null;
        status = hit ? `Selected ${hit.item.name}` : "Nothing there";
        render();
        break;
      }
      case "door":
      case "window": {
        const near = wallNear(layout, point.x, point.z, 1);
        if (!near) { status = "Click closer to a wall"; render(); return; }
        const kind: OpeningKind = tool === "door" ? "door" : "window";
        const width = kind === "door" ? 1.2 : 1;
        if (wallLength(near.wall) < width + 0.2) { status = "That wall is too short for an opening"; render(); return; }
        commit(addOpening(layout, near.wall.id, near.at, { width, kind, id: nextId(layout, kind) }), `${kind === "door" ? "Doorway" : "Window"} cut`);
        break;
      }
      case "paintWall": {
        const type = layout.wallTypes.find((candidate) => candidate.id === wallType);
        const near = wallNear(layout, point.x, point.z, 0.9);
        if (near) { commit(paintWall(layout, near.wall.id, wallType), `Wall painted ${type?.name ?? wallType}`); return; }
        // No wall here, but there is a room edge: the player knocked it through earlier, so build it back.
        const edge = edgeAt(layout, point.x, point.z, 0.9);
        if (edge && (layout.openEdges ?? []).includes(edge.key)) {
          commit(setEdgeOpen(layout, edge.key, false, wallType), `Wall built in ${type?.name ?? wallType}`);
          return;
        }
        status = "Click closer to a wall";
        render();
        break;
      }
      case "paintFloor": {
        const hit = itemAt(layout, point.x, point.z);
        if (!hit) { status = "Nothing to paint there"; render(); return; }
        const type = layout.floorTypes.find((candidate) => candidate.id === floorType);
        commit(hit.kind === "room" ? updateRoom(layout, hit.item.id, { floor: floorType }) : updateArea(layout, hit.item.id, { ground: floorType }),
          `${hit.item.name} floored with ${type?.name ?? floorType}`);
        break;
      }
      case "erase": {
        // Small things first, or a stray click would take the whole room with it: an opening, then the
        // wall it is in, and only then the room — and a room needs a second, deliberate click.
        const near = wallNear(layout, point.x, point.z, 0.9);
        const opening = near?.wall.openings?.find((candidate) => Math.abs(candidate.at - near.at) <= candidate.width / 2 + 0.3);
        if (near && opening) { commit(removeOpeningAt(layout, near.wall.id, opening.at), `${opening.kind === "window" ? "Window" : "Doorway"} filled in`); return; }
        if (near) { commit(setEdgeOpen(layout, wallKey(near.wall.from, near.wall.to), true), "Wall knocked through — paint it back to rebuild"); return; }
        const hit = itemAt(layout, point.x, point.z);
        if (!hit) { status = "Nothing to erase there"; render(); return; }
        if (hit.item.id === "site_grounds") { status = "The grounds stay"; render(); return; }
        if (selected?.id !== hit.item.id) {
          selected = { kind: hit.kind, id: hit.item.id };
          status = `${hit.item.name} selected — click again to remove it`;
          render();
          return;
        }
        selected = null;
        commit(hit.kind === "room" ? removeRoom(layout, hit.item.id) : removeArea(layout, hit.item.id), `Removed ${hit.item.name}`);
        break;
      }
      default:
        break;
    }
  }

  async function save(): Promise<void> {
    status = "Saving…";
    render();
    try {
      const response = await fetch("/__lab/save-level", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(layout) });
      const body = (await response.json()) as { ok?: boolean; error?: string; problems?: string[] };
      if (!response.ok || !body.ok) { status = `Save failed: ${body.error ?? response.statusText}${body.problems?.length ? ` — ${body.problems[0]}` : ""}`; }
      else { dirty = false; status = `Saved ${layout.rooms.length} rooms and ${layout.walls.length} walls`; }
    } catch (error) {
      status = `Save failed: ${(error as Error).message}`;
    }
    render();
  }

  function selectedItem(): Room | Area | null {
    if (!selected) return null;
    return selected.kind === "room"
      ? layout.rooms.find((room) => room.id === selected!.id) ?? null
      : layout.areas.find((area) => area.id === selected!.id) ?? null;
  }

  function render(): void {
    if (!root) return;
    const item = selectedItem();
    const isRoom = selected?.kind === "room";
    const swatch = (id: string, color: string, name: string, on: boolean, kind: "wall" | "floor") =>
      `<button data-${kind}-type="${id}" class="build-swatch ${on ? "on" : ""}" style="background:${color}" title="${name}"></button>`;
    root.innerHTML = `
      <div class="build-head"><strong>🏗 Build</strong><span class="build-grow"></span>
        <button data-act="undo" title="Ctrl+Z">↶</button><button data-act="redo" title="Ctrl+Y">↷</button>
        <button data-act="save" class="${dirty ? "primary" : ""}" title="Write src/assets/scene/level.json (Ctrl+S)">💾 Save${dirty ? " *" : ""}</button>
        <button data-act="close" title="Leave build mode (B)">✅ Done</button></div>
      <div class="build-tools">${TOOLS.map((entry) => `<button data-tool="${entry.id}" class="${tool === entry.id ? "on" : ""}" title="${entry.hint} (${entry.key})"><span>${entry.icon}</span>${entry.label}</button>`).join("")}</div>
      <div class="build-row"><span class="build-label">Walls</span>${layout.wallTypes.map((type) => swatch(type.id, type.color, type.name, type.id === wallType, "wall")).join("")}</div>
      <div class="build-row"><span class="build-label">Floors</span>${layout.floorTypes.map((type) => swatch(type.id, type.color, type.name, type.id === floorType, "floor")).join("")}</div>
      ${item ? `
      <div class="build-panel">
        <div class="build-row"><input type="text" data-field="name" value="${escapeHtml(item.name)}" title="What this room is called" />
          <input type="text" data-field="zone" value="${escapeHtml(item.zone)}" title="Which of the sixteen areas of the art direction this belongs to" class="build-zone" /></div>
        <div class="build-row"><label title="What the player pays to build it">✦ <input type="number" data-field="cost" value="${item.cost ?? 0}" min="0" step="50" /></label>
          <code>${item.rect[2].toFixed(2)} × ${item.rect[3].toFixed(2)} m</code>
          ${isRoom ? `<label title="Wall height in metres">↕ <input type="number" data-field="wallHeight" value="${(item as Room).wallHeight ?? ""}" placeholder="${DEFAULT_WALL_HEIGHT}" min="1" step="0.1" /></label>` : ""}
          <span class="build-grow"></span><button data-act="delete" title="Remove it (Del)">🗑</button></div>
      </div>` : ""}
      <div class="build-status">${escapeHtml(status)}</div>`;
  }

  function onPanelClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const toolButton = target.closest<HTMLElement>("[data-tool]");
    if (toolButton) { tool = toolButton.dataset.tool as Tool; status = TOOLS.find((entry) => entry.id === tool)?.hint ?? ""; render(); return; }
    const wallSwatch = target.closest<HTMLElement>("[data-wall-type]");
    if (wallSwatch) { wallType = wallSwatch.dataset.wallType!; render(); return; }
    const floorSwatch = target.closest<HTMLElement>("[data-floor-type]");
    if (floorSwatch) { floorType = floorSwatch.dataset.floorType!; render(); return; }
    const action = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    switch (action) {
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "save": void save(); break;
      case "close": toggle(); break;
      case "delete": {
        const item = selectedItem();
        if (!item || !selected) return;
        const kind = selected.kind;
        selected = null;
        commit(kind === "room" ? removeRoom(layout, item.id) : removeArea(layout, item.id), `Removed ${item.name}`);
        break;
      }
      default: break;
    }
  }

  function onPanelChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const field = input.dataset.field;
    const item = selectedItem();
    if (!field || !item || !selected) return;
    const patch: Record<string, unknown> = {};
    if (field === "name") patch.name = input.value.trim() || "Unnamed";
    else if (field === "zone") patch.zone = input.value.trim() || "custom";
    else if (field === "cost") patch.cost = Math.max(0, Number(input.value) || 0);
    else if (field === "wallHeight") patch.wallHeight = input.value === "" ? undefined : Math.max(1, Number(input.value) || DEFAULT_WALL_HEIGHT);
    commit(selected.kind === "room" ? updateRoom(layout, item.id, patch) : updateArea(layout, item.id, patch), `${item.name} updated`);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!active) return;
    const typing = (event.target as HTMLElement | null)?.tagName === "INPUT";
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); return; }
    if (meta && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (meta && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
    if (typing) return;
    const byKey = TOOLS.find((entry) => entry.key === event.key);
    if (byKey) { tool = byKey.id; status = byKey.hint; render(); return; }
    // B is handled by the host, which owns the mode; handling it here too would toggle twice.
    if (event.key === "Escape") { if (drag) { drag = null; showPreview(null, true); } else toggle(); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      const item = selectedItem();
      if (!item) return;
      const kind = selected.kind;
      selected = null;
      commit(kind === "room" ? removeRoom(layout, item.id) : removeArea(layout, item.id), `Removed ${item.name}`);
    }
  }

  function toggle(): void {
    active = !active;
    if (active) {
      root = document.createElement("div");
      root.className = "build-root";
      root.addEventListener("click", onPanelClick);
      root.addEventListener("change", onPanelChange);
      host.mount.append(root);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      render();
    } else {
      drag = null;
      showPreview(null, true);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      root?.remove();
      root = null;
    }
  }

  window.addEventListener("keydown", onKeyDown);

  return {
    get active() { return active; },
    toggle,
    update() { /* the preview follows the pointer, nothing per-frame yet */ },
    dispose() {
      if (active) toggle();
      window.removeEventListener("keydown", onKeyDown);
      preview?.dispose();
      previewMaterial.dispose();
      badMaterial.dispose();
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
