// What is inside a thing, shown above the thing — and built out of the same
// cubes as everything else.
//
// A panel pinned to the corner of the screen is a spreadsheet the world happens
// to be behind. This is the other way round: a cabinet hangs in the air over the
// crate it belongs to, turns to face the camera, and holds the ACTUAL items —
// the same carrot model that grew in the row, turning slowly in a glass-fronted
// drawer.
//
// Every part of it is voxels: the back board is tiled with relief the way the
// kitchen floor is, the drawers are five-sided boxes with tiled interiors, the
// labels are set in the game's own 5x7 voxel font, and the take buttons are
// blocks with their numbers cut into them. There is no texture and no HTML in
// it anywhere, which is the rulebook's plan for the whole UI arriving early
// because a container needed it first.
import {
  Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3,
  type AbstractMesh, type Scene, type ShadowGenerator,
} from "@babylonjs/core";
import { createVoxelMaterial, createVoxelMesh, type VoxelCell } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createMeshLibrary } from "./meshLibrary.ts";
import { modelBounds } from "./storageDisplay.ts";
import { hash01 } from "./hash.ts";
import { textCells, textWidth } from "./voxelFont.ts";

/** A row of a container's contents. Named for what it is, not for the panel
 *  that happens to draw it: the crate and the bin describe themselves this way
 *  whether anyone is looking or not. */
export interface PanelRow {
  item: string;
  count: number;
  /** False for things that cannot be taken yet — compost still rotting. */
  takeable?: boolean;
  /** Shown instead of the count: "rotting", "on the plate". */
  note?: string;
  /** Overrides the catalog name on the label. */
  label?: string;
}

/** How much of a row a button takes. */
export type TakeAmount = "one" | "half" | "all";

/** Rendering group the panel draws in: after the world, on a cleared depth
 *  buffer, so nothing can cut through it. */
const PANEL_LAYER = 2;

/** The cabinet, in metres. A drawer is a hand's width at arm's length; the rest
 *  follows from it. */
const SLOT = 0.68;
const COLUMNS = 4;
const DRAWER = SLOT * 0.84;
// Shallower than it was, because the whole box now stands PROUD of the board
// rather than being sunk into it: a drawer whose back wall is behind the board
// is a drawer you cannot see into, which is what the first cut built.
const DEPTH = SLOT * 0.3;
/** Cell size of every voxel part of the cabinet: board tiles, drawer walls,
 *  letters and buttons all share one grid, which is what makes them look like
 *  one object instead of four. */
// Finer than furniture elsewhere in the game: this is the thing the player
// looks at closest, and a drawer with a dozen cells to a side reads as a box
// drawn by a child rather than a box.
const CELL = 0.015;
/** Which way the panel's face points. A Babylon plane and this cabinet both
 *  build toward -Z, so everything on the front of the board lives at negative
 *  z — worked out by hiding a drawer and finding its closed back staring at
 *  the camera. */
const FRONT = -1;
/** Letters are cut from a finer grid than the furniture. At the cabinet's own
 *  cell size a five-cell letter is 11 cm wide and "BELL PEPPER (RED)" is two
 *  metres of sign — which is exactly what the first cut looked like. */
const TEXT_CELL = 0.0085;
/** Longest label before it is cut short. A shelf edge is not a paragraph. */
const LABEL_LIMIT = 13;
/** Buttons are cut finer than the furniture as well: three of them have to sit
 *  across the top of one drawer and still be hittable. */
const BUTTON_CELL = 0.008;
/** Radians per second an item turns on its slot. Slow: it is a display case,
 *  not a carousel, and the player has to read a shape while it moves. */
const SPIN = 0.55;
/** Distance at which the cabinet is its authored size; nearer it shrinks,
 *  further it grows, so its share of the screen stays about the same. */
const REFERENCE_DISTANCE = 12;
const MIN_SCALE = 0.24;
const MAX_SCALE = 3.2;

/** The cabinet is a piece of furniture, so it is described in wood: boards, the
 *  seams between them, and the nails holding them together. */
const WOOD = {
  carcass: ["#6b4a2e", "#7a5533", "#5f4128"],
  drawerFront: ["#b1834c", "#a2764a", "#c09055"],
  inside: ["#c9a06a", "#bb9260"],
  floor: ["#8a6136", "#7a5530"],
  seam: "#3f2b1a",
  nail: "#8d949b",
  rim: "#d8b384",
};
const BOARD = { dark: "#1d2724", mid: "#243029", light: "#2b3a32", edge: "#3c5145" };
// Wood, because a drawer is a wooden box: a pale sawn back so the produce
// reads against it, darker sides falling away, a worn floor, and a lighter rim
// round the mouth where hands have been. The tiling picks between the two tones
// of each surface, which is what gives it grain rather than paint.
const INK = { label: "#dfe8d6", count: "#d8f0c4", muted: "#8fa598", title: "#f3ead6" };
const BUTTON = { face: "#33463c", faceHot: "#4f7a4a", mark: "#dfe8d6" };

export interface ItemPanel {
  readonly open: boolean;
  /** Which row and button a picked mesh belongs to. */
  hitAt(mesh: AbstractMesh | null | undefined): { row: number; amount: TakeAmount } | null;
  show(options: { title: string; at: Vector3; from?: Vector3; rows: readonly PanelRow[] }): void;
  setRows(rows: readonly PanelRow[]): void;
  move(at: Vector3, from?: Vector3): void;
  update(dt: number): void;
  hide(): void;
  dispose(): void;
}

export function createItemPanel(options: {
  scene: Scene;
  catalog: AuthoredVoxelCatalog;
  parent?: TransformNode;
  shadows?: ShadowGenerator;
}): ItemPanel {
  const { scene, catalog } = options;
  const root = new TransformNode("item panel", scene);
  if (options.parent) root.parent = options.parent;
  root.setEnabled(false);
  // Facing the camera means FACING it: this camera looks down from a high
  // three-quarter angle, so a cabinet that only spins about its vertical axis is
  // still being read at a slant.
  root.billboardMode = TransformNode.BILLBOARDMODE_ALL;

  const library = createMeshLibrary();

  /** One unlit material for the whole cabinet. White emissive carries the cell
   *  colours; turning lighting off without it renders everything black, which
   *  lighting.ts has a comment about and this file has now learned twice. */
  const flat = createVoxelMaterial("item panel", scene);
  flat.disableLighting = true;
  flat.emissiveColor = Color3.White();
  flat.specularColor = Color3.Black();

  const glassMaterial = new StandardMaterial("item panel glass", scene);
  glassMaterial.disableLighting = true;
  glassMaterial.diffuseColor = Color3.Black();
  glassMaterial.specularColor = Color3.Black();
  glassMaterial.emissiveColor = Color3.FromHexString("#cfe4f0");
  glassMaterial.alpha = 0.13;
  glassMaterial.backFaceCulling = false;

  /** Build a voxel mesh from cells, at a chosen cell size. */
  const voxels = (name: string, cells: VoxelCell[], size = CELL): Mesh => {
    const mesh = createVoxelMesh(name, cells, size, scene, { material: flat });
    mesh.renderingGroupId = PANEL_LAYER;
    mesh.isPickable = false;
    return mesh;
  };

  /** A panel of sawn BOARDS: planks of a few cells each, separated by a seam a
   *  cell deep, every plank a slightly different tone, with nail heads driven
   *  in near the ends. It is what makes the cabinet joinery rather than a box
   *  with a wood colour on it — the seams and the nails are the whole read.
   *
   *  `run` is which way the planks lie. Real carcass work alternates: the back
   *  boards run one way, the sides the other. */
  const plankPanel = (name: string, across: number, up: number, deep: number, palette: readonly string[],
                      seed: string, options: { run?: "across" | "up"; nails?: boolean; cell?: number } = {}): Mesh => {
    const cells: VoxelCell[] = [];
    const midX = Math.floor(across / 2);
    const midY = Math.floor(up / 2);
    const run = options.run ?? "across";
    const PLANK = 7;
    for (let x = 0; x < across; x++) {
      for (let y = 0; y < up; y++) {
        // Which board this cell belongs to, and how far across that board it is.
        const alongBoard = run === "across" ? y : x;
        const board = Math.floor(alongBoard / PLANK);
        const withinBoard = alongBoard % PLANK;
        const seam = withinBoard === 0;
        const tone = palette[Math.floor(hash01(`${seed}:${board}`, 9) * palette.length)] ?? palette[0]!;
        // The seam is a cell shallower, so the boards read as separate pieces
        // rather than as stripes painted on one.
        const thickness = Math.max(1, seam ? deep - 1 : deep);
        for (let z = 0; z < thickness; z++) {
          cells.push({ x: x - midX, y: y - midY, z: -FRONT * z, color: seam ? WOOD.seam : tone });
        }
      }
    }
    if (options.nails !== false) {
      // Two nails per board, near its ends, as a joiner would drive them.
      const boards = Math.ceil((run === "across" ? up : across) / PLANK);
      for (let board = 0; board < boards; board++) {
        const alongBoard = board * PLANK + Math.floor(PLANK / 2);
        for (const position of [2, (run === "across" ? across : up) - 3]) {
          const x = run === "across" ? position : alongBoard;
          const y = run === "across" ? alongBoard : position;
          if (x < 0 || y < 0 || x >= across || y >= up) continue;
          cells.push({ x: x - midX, y: y - midY, z: FRONT, color: WOOD.nail });
        }
      }
    }
    return voxels(name, cells, options.cell);
  };

  // ── the back board ──────────────────────────────────────────────────────────
  let board: Mesh | null = null;

  /** A drawer, built as a shallow FRUSTUM: the mouth is full width and the back
   *  is smaller, so the four inner walls all slope in towards it.
   *
   *  A square box shows the player exactly one wall when they look at it
   *  straight on, which is the one thing a 3D drawer has over a painted square
   *  and the first version threw it away. Tapered, every wall catches a
   *  different amount of light from every angle, and the item inside sits in a
   *  niche rather than against a flat back.
   *
   *  The boards cross at the corners the way a real drawer's do — back boards
   *  one way, side boards the other — and there is a nailed rim around the
   *  mouth, because that is what holds a box like this together. */
  const buildShell = (): Mesh => {
    const size = Math.round(DRAWER / CELL);
    const deep = Math.round(DEPTH / CELL);
    const cells: VoxelCell[] = [];
    const mid = Math.floor(size / 2);
    const PLANK = 6;
    /** Cells the walls close in by, per cell of depth. */
    const TAPER = 0.34;
    const insetAt = (z: number): number => Math.min(Math.floor(size / 2) - 3, Math.round(z * TAPER));
    const tone = (index: number, palette: readonly string[]): string =>
      palette[Math.floor(hash01(`drawer:${index}`, 11) * palette.length)] ?? palette[0]!;

    // The sloping walls: a ring per layer, each one a little smaller.
    for (let z = 0; z < deep; z++) {
      const inset = insetAt(z);
      const low = inset;
      const high = size - 1 - inset;
      const seam = z % PLANK === 0;
      for (let i = low; i <= high; i++) {
        const colour = seam ? WOOD.seam : tone(Math.floor(z / PLANK) + (i % 2), WOOD.floor);
        const side = seam ? WOOD.seam : tone(Math.floor(z / PLANK) + (i % 3), WOOD.inside);
        cells.push({ x: i - mid, y: low - mid, z: -FRONT * z, color: colour });
        cells.push({ x: i - mid, y: high - mid, z: -FRONT * z, color: side });
        cells.push({ x: low - mid, y: i - mid, z: -FRONT * z, color: side });
        cells.push({ x: high - mid, y: i - mid, z: -FRONT * z, color: side });
      }
    }
    // The back, boarded across, at the size the taper leaves it.
    const back = insetAt(deep - 1);
    for (let x = back; x <= size - 1 - back; x++) {
      for (let y = back; y <= size - 1 - back; y++) {
        const seam = y % PLANK === 0;
        cells.push({ x: x - mid, y: y - mid, z: -FRONT * deep,
                     color: seam ? WOOD.seam : tone(Math.floor(y / PLANK), WOOD.inside) });
      }
    }
    // The rim around the mouth, one board proud, with a nail in each corner.
    for (let i = 0; i < size; i++) {
      for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]] as const) {
        cells.push({ x: x - mid, y: y - mid, z: FRONT, color: WOOD.rim });
      }
    }
    for (const [x, y] of [[2, 2], [size - 3, 2], [2, size - 3], [size - 3, size - 3]] as const) {
      cells.push({ x: x - mid, y: y - mid, z: FRONT * 2, color: WOOD.nail });
    }
    return voxels("panel drawer", cells);
  };

  /** A take button: a small block with its mark cut into the face. */
  const buildButton = (amount: TakeAmount): Mesh => {
    const mark = amount === "one" ? "1" : amount === "half" ? "1/2" : "ALL";
    const cells: VoxelCell[] = [];
    const width = Math.max(11, textWidth(mark) + 4);
    const height = 11;
    const midX = Math.floor(width / 2);
    const midY = Math.floor(height / 2);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        cells.push({ x: x - midX, y: y - midY, z: 0, color: edge ? BUTTON.faceHot : BUTTON.face });
      }
    }
    for (const cell of textCells(mark, { colour: BUTTON.mark, align: "centre", baseline: 2 - midY })) {
      cells.push({ x: cell.x, y: cell.y, z: FRONT, color: cell.color });
    }
    return voxels(`panel button ${amount}`, cells, BUTTON_CELL);
  };

  const glassSource = (): Mesh => {
    const pane = MeshBuilder.CreatePlane("panel glass", { width: DRAWER, height: DRAWER }, scene);
    pane.material = glassMaterial;
    pane.isVisible = false;
    pane.isPickable = false;
    pane.renderingGroupId = PANEL_LAYER;
    return pane;
  };

  /** Everything built for the current contents, cleared and rebuilt on change. */
  const parts: AbstractMesh[] = [];
  const hits: { mesh: AbstractMesh; row: number; amount: TakeAmount }[] = [];
  const spinning: AbstractMesh[] = [];
  let rows: readonly PanelRow[] = [];
  let title = "";
  let scaleNow = 1;
  let anchor: { at: Vector3; from?: Vector3 } | null = null;

  const nameOf = (row: PanelRow): string => row.label ?? catalog.models[row.item]?.name ?? row.item;

  const clear = (): void => {
    for (const part of parts) part.dispose(false, false);
    parts.length = 0;
    hits.length = 0;
    spinning.length = 0;
    board?.dispose(false, false);
    board = null;
  };

  /** Lay the cabinet out: board, drawers, buttons, labels, title. */
  const layout = (): void => {
    clear();
    const lines = Math.max(1, Math.ceil(rows.length / COLUMNS));
    const cols = Math.min(COLUMNS, Math.max(1, rows.length));
    const width = cols * SLOT;
    const height = lines * SLOT + SLOT * 0.42;

    // The carcass: boards running across the back of the cabinet, nailed.
    board = plankPanel("panel board", Math.round(width / CELL), Math.round(height / CELL), 2,
      WOOD.carcass, "carcass", { run: "across" });
    board.parent = root;
    board.position.set(0, 0, 0);

    // The tail: a few cubes stepping down off the bottom edge, pointing at the
    // thing the cabinet belongs to. It was a cylinder, which made it the only
    // part of the cabinet that was not made of cubes — and it showed.
    const tailCells: VoxelCell[] = [];
    for (let step = 0; step < 5; step++) {
      const wide = 5 - step;
      for (let x = -wide; x <= wide; x++) {
        for (let z = 0; z < 2; z++) tailCells.push({ x, y: -step, z: -FRONT * z, color: step > 2 ? BOARD.edge : BOARD.mid });
      }
    }
    const tail = voxels("panel tail", tailCells);
    tail.parent = root;
    tail.position.set(0, -height / 2, 0);
    parts.push(tail);

    // The title along the top of the board.
    const titleCells = textCells(title, { colour: INK.title, align: "centre" });
    if (titleCells.length) {
      const sign = voxels("panel title", titleCells.map((cell) => ({ ...cell, z: 0 })), TEXT_CELL * 1.5);
      sign.parent = root;
      sign.position.set(0, height / 2 - SLOT * 0.26, FRONT * CELL * 2);
      parts.push(sign);
    }

    const shell = library.source("panel:shell", buildShell);
    const glass = library.source("panel:glass", glassSource);
    const buttons = { one: library.source("panel:button:one", () => buildButton("one")),
                      half: library.source("panel:button:half", () => buildButton("half")),
                      all: library.source("panel:button:all", () => buildButton("all")) };

    for (const [index, row] of rows.entries()) {
      const col = index % cols;
      const line = Math.floor(index / cols);
      const centre = new Vector3(
        (col - (cols - 1) / 2) * SLOT,
        height / 2 - SLOT * 0.42 - (line + 0.5) * SLOT + SLOT * 0.06,
        // Far enough forward that the back wall of the drawer clears the board.
        FRONT * (DEPTH + CELL * 2),
      );

      const box = shell.createInstance(`panel drawer ${index}`);
      box.parent = root;
      box.position.copyFrom(centre);
      // A shade off square, alternating, so at least one side wall of every
      // drawer catches the light: a cabinet seen dead-on is a grid of flat
      // rectangles, and the whole point of building it in three dimensions is
      // that it should not look like one.
      box.rotation.y = (index % 2 ? -1 : 1) * 0.16;
      box.rotation.x = -0.06;
      box.isPickable = true;
      parts.push(box);
      // The drawer itself takes one: the commonest thing to want, on the
      // biggest target on the cabinet.
      hits.push({ mesh: box, row: index, amount: "one" });

      const pane = glass.createInstance(`panel glass ${index}`);
      pane.parent = root;
      pane.position.set(centre.x, centre.y, centre.z + FRONT * 0.002);
      pane.rotation.y = box.rotation.y;
      pane.rotation.x = box.rotation.x;
      parts.push(pane);

      // Three buttons across the top of the drawer, supermarket-style.
      if (row.takeable !== false) {
        const amounts: TakeAmount[] = ["one", "half", "all"];
        for (const [slot, amount] of amounts.entries()) {
          const button = buttons[amount].createInstance(`panel button ${index} ${amount}`);
          button.parent = root;
          button.position.set(centre.x + (slot - 1) * SLOT * 0.3, centre.y + DRAWER * 0.56, centre.z + FRONT * CELL * 2);
          button.isPickable = true;
          parts.push(button);
          hits.push({ mesh: button, row: index, amount });
        }
      }

      // The label under the drawer, as a supermarket shelf edge: name, and the
      // count in its own colour.
      const full = row.note ?? nameOf(row);
      const label = full.length > LABEL_LIMIT ? `${full.slice(0, LABEL_LIMIT - 1)}.` : full;
      const labelCells = textCells(label, { colour: row.takeable === false ? INK.muted : INK.label, align: "centre" });
      const countCells = textCells(`${row.count}`, { colour: INK.count, align: "centre" })
        .map((cell) => ({ ...cell, y: cell.y + 10 }));
      const plate = voxels(`panel label ${index}`, [...labelCells, ...countCells].map((cell) => ({ ...cell, z: 0 })), TEXT_CELL);
      plate.parent = root;
      // On the drawer's own front board, not on the carcass behind it: the
      // drawers stand proud, so a label on the back board is hidden by the row
      // below it from any angle but dead-on.
      plate.position.set(centre.x, centre.y - DRAWER * 0.52, centre.z + FRONT * CELL * 2);
      parts.push(plate);

      const model = catalog.models[row.item];
      if (!model) continue;
      const source = library.source(`panel:item:${row.item}`, () => {
        const mesh = createVoxelMesh(`panel item ${row.item}`, cellsFromAuthoredModel(model), model.pitch, scene, { material: flat });
        mesh.isPickable = false;
        // On the SOURCE, not on the instances: an instance's rendering group is
        // its source's, so setting it per instance silently does nothing.
        mesh.renderingGroupId = PANEL_LAYER;
        return mesh;
      });
      const item = source.createInstance(`panel item ${index}`);
      const bounds = modelBounds(model);
      const size = bounds.max.subtract(bounds.min).scale(model.pitch);
      const scale = (DRAWER * 0.5) / Math.max(size.x, size.y, size.z, 1e-3);
      item.parent = root;
      item.scaling.setAll(scale);
      // In the middle of the box and set back off the glass: an item on the
      // rim of its drawer looks dropped on top of the cabinet.
      // Standing on the floor of its box, halfway back.
      item.position.set(centre.x, centre.y - DRAWER * 0.3 + size.y * scale * 0.1, centre.z - FRONT * DEPTH * 0.5);
      item.isPickable = true;
      parts.push(item);
      spinning.push(item);
      hits.push({ mesh: item, row: index, amount: "one" });
    }
  };

  /** Lift the cabinet clear of the object and lean it away from the player. The
   *  board carries its own tail — see layout — so nothing here draws a line. */
  const LIFT = 1.25;
  const CLEAR = 0.55;

  const place = (at: Vector3, from?: Vector3): void => {
    anchor = { at, from };
    const away = from ? at.subtract(from) : Vector3.Zero();
    away.y = 0;
    if (away.lengthSquared() > 1e-4) away.normalize().scaleInPlace(CLEAR);
    const head = at.add(new Vector3(away.x, LIFT * scaleNow, away.z));
    root.position.copyFrom(head);
  };

  return {
    get open() { return root.isEnabled(); },
    hitAt(mesh) {
      if (!mesh) return null;
      const hit = hits.find((candidate) => candidate.mesh === mesh);
      return hit ? { row: hit.row, amount: hit.amount } : null;
    },
    show(shown) {
      title = shown.title;
      rows = shown.rows;
      layout();
      place(shown.at, shown.from);
      root.setEnabled(true);
    },
    setRows(next) {
      rows = next;
      layout();
      if (anchor) place(anchor.at, anchor.from);
    },
    move(at, from) { if (root.isEnabled()) place(at, from); },
    update(dt) {
      if (!root.isEnabled()) return;
      for (const [index, item] of spinning.entries()) {
        // Each one a little out of step with its neighbours, so a full cabinet
        // reads as a shelf of objects rather than a clock mechanism.
        item.rotation.y += dt * (SPIN + index * 0.06);
      }
      const camera = scene.activeCamera;
      if (camera && anchor) {
        // Apparent size falls off with distance, so the world size rises with
        // it: the cabinet keeps roughly the same share of the screen from the
        // closest zoom to the furthest.
        const distance = Vector3.Distance(camera.position, root.position);
        const wanted = Math.max(MIN_SCALE, Math.min(MAX_SCALE, distance / REFERENCE_DISTANCE));
        scaleNow += (wanted - scaleNow) * Math.min(1, dt * 8);
        root.scaling.setAll(scaleNow);
        place(anchor.at, anchor.from);
      }
    },
    hide() {
      anchor = null;
      root.setEnabled(false);
      clear();
    },
    dispose() {
      clear();
      library.dispose();
      glassMaterial.dispose();
      flat.dispose();
      root.dispose();
    },
  };
}
