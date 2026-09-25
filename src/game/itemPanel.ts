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
// A drawer fills its cell right up to the separators either side of it. The
// reference the player gave is a chest of small drawers packed edge to edge in
// one frame: the wood between two drawers is a divider, not a margin, and a
// drawer floating in the middle of its cell reads as a tile on a board.
const DRAWER = SLOT * 0.94;
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
const TEXT_CELL = 0.013;
/** Longest label before it is cut short. A shelf edge is not a paragraph — and
 *  a ticket wider than its drawer covers the drawer next door, which is what
 *  "BELL PEPPER" did to the compost beside it. */
const LABEL_LIMIT = 11;
/** What each take button says. A button is only as wide as its own mark, so
 *  "1" does not claim the same slice of the mouth as "ALL" — which is what let
 *  the marks grow by half again without the three of them colliding. */
const MARKS: Record<TakeAmount, string> = { one: "1", half: "1/2", all: "ALL" };
/** Cells of card around a mark, and between two buttons. */
const BUTTON_PAD = 6;
const BUTTON_GAP = 3;
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
  // Darker than the first cut, which was pine-bright and fought the produce for
  // attention. This is oiled oak: the drawers are furniture, the food is the
  // thing being shown.
  frame: ["#4a3320", "#553b26", "#3f2b1a"],
  inside: ["#7a5530", "#6b4a2b", "#835c34"],
  floor: ["#5f4128", "#553b26"],
  seam: "#2b1d12",
  nail: "#9aa2a8",
  rim: "#8a6136",
  cap: "#5a3e26",
};
const BOARD = { dark: "#1d2724", mid: "#243029", light: "#2b3a32", edge: "#3c5145" };
// Wood, because a drawer is a wooden box: a pale sawn back so the produce
// reads against it, darker sides falling away, a worn floor, and a lighter rim
// round the mouth where hands have been. The tiling picks between the two tones
// of each surface, which is what gives it grain rather than paint.
// Supermarket ticket: a pale card with dark ink on it, which is legible against
// dark wood in a way white letters floating on wood never are.
const TICKET = { card: "#efe7cf", cardEdge: "#cdbd96", name: "#2b2119", count: "#8a2f1e", muted: "#6f6252" };
const INK = { title: "#f3ead6" };
const BUTTON = { face: "#d8c9a4", faceEdge: "#8a6136", side: "#a68a5c", mark: "#2b2119", hot: "#4f7a4a" };

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
    /** Cells the walls close in by, per cell of depth. Gentle: enough that
     *  every wall shows, not so much that the drawer reads as a funnel. */
    const TAPER = 0.18;
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

  /** A take button: a raised block of card with a wooden edge and its mark cut
   *  into the face. Twice the size it was, and built with a visible side so it
   *  reads as something that sticks out of the drawer rather than a decal on
   *  it — a button the player cannot see is a button they will not press. */
  const buttonCells = (amount: TakeAmount): number => textWidth(MARKS[amount]) + BUTTON_PAD;
  const AMOUNTS: TakeAmount[] = ["one", "half", "all"];
  /** Cell size that makes the three buttons and their gaps span one drawer
   *  mouth. Derived, not chosen by eye: choosing it by eye is how the first cut
   *  ended up with three buttons printed on top of each other. */
  const buttonCell = (DRAWER * 0.94) / (AMOUNTS.reduce((sum, a) => sum + buttonCells(a), 0) + BUTTON_GAP * 2);
  const buildButton = (amount: TakeAmount): Mesh => {
    const mark = MARKS[amount];
    const cells: VoxelCell[] = [];
    const width = buttonCells(amount);
    const height = 15;
    const thick = 3;
    const midX = Math.floor(width / 2);
    const midY = Math.floor(height / 2);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        for (let z = 0; z < thick; z++) {
          // The face is card, the sides are wood: the two together are what
          // give it a lip you can see from an angle.
          const front = z === thick - 1;
          const colour = front ? (edge ? BUTTON.faceEdge : BUTTON.face) : BUTTON.side;
          cells.push({ x: x - midX, y: y - midY, z: FRONT * z, color: colour });
        }
      }
    }
    for (const cell of textCells(mark, { colour: BUTTON.mark, align: "centre", baseline: 3 - midY })) {
      cells.push({ x: cell.x, y: cell.y, z: FRONT * thick, color: cell.color });
    }
    return voxels(`panel button ${amount}`, cells, buttonCell);
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
  /** One node per drawer, so each box can turn towards the camera on its own. */
  const slotNodes: TransformNode[] = [];
  const hits: { mesh: AbstractMesh; row: number; amount: TakeAmount }[] = [];
  const spinning: TransformNode[] = [];
  let rows: readonly PanelRow[] = [];
  let title = "";
  let scaleNow = 1;
  let anchor: { at: Vector3; from?: Vector3 } | null = null;

  const nameOf = (row: PanelRow): string => row.label ?? catalog.models[row.item]?.name ?? row.item;

  const clear = (): void => {
    for (const part of parts) part.dispose(false, false);
    for (const node of slotNodes) node.dispose();
    parts.length = 0;
    slotNodes.length = 0;
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

    // The carcass is a FRAME, not a wall: uprights at every column edge, rails
    // at every row edge, and nothing behind the drawers but the world. A solid
    // back panel made the cabinet a slab with holes in it; poles make it a
    // piece of furniture the farm shows through.
    const frameCells: VoxelCell[] = [];
    const cols2 = Math.round(width / CELL);
    const rows2 = Math.round(height / CELL);
    const midX = Math.floor(cols2 / 2);
    const midY = Math.floor(rows2 / 2);
    // Dividers between drawers are thin; the outside of the carcass is thick,
    // the way a chest's case is heavier than the partitions inside it.
    const POLE = 4;
    const CASE = 7;
    const tone = (index: number): string => WOOD.frame[Math.floor(hash01(`frame:${index}`, 7) * WOOD.frame.length)] ?? WOOD.frame[0]!;
    const post = (cx: number, thick = POLE): void => {
      for (let x = cx - thick / 2; x < cx + thick / 2; x++) {
        for (let y = 0; y < rows2; y++) {
          const seam = y % 7 === 0;
          for (let z = 0; z < 3; z++) {
            frameCells.push({ x: Math.round(x) - midX, y: y - midY, z: -FRONT * z, color: seam ? WOOD.seam : tone(Math.floor(y / 7)) });
          }
        }
      }
    };
    const rail = (cy: number, thick = POLE): void => {
      for (let y = cy - thick / 2; y < cy + thick / 2; y++) {
        for (let x = 0; x < cols2; x++) {
          const seam = x % 7 === 0;
          for (let z = 0; z < 3; z++) {
            frameCells.push({ x: x - midX, y: Math.round(y) - midY, z: -FRONT * z, color: seam ? WOOD.seam : tone(Math.floor(x / 7)) });
          }
        }
      }
    };
    for (let column = 0; column <= cols; column++) {
      post(Math.round((column * SLOT) / CELL), column === 0 || column === cols ? CASE : POLE);
    }
    // A rail under the title, one under each row of drawers, and one at the foot.
    rail(rows2 - Math.round((SLOT * 0.42) / CELL));
    for (let line = 0; line <= lines; line++) {
      rail(Math.round(((lines - line) * SLOT) / CELL), line === 0 || line === lines ? CASE : POLE);
    }
    // Nails where the rails cross the posts, as a frame is actually fixed.
    for (let column = 0; column <= cols; column++) {
      for (let line = 0; line <= lines; line++) {
        frameCells.push({
          x: Math.round((column * SLOT) / CELL) - midX,
          y: Math.round(((lines - line) * SLOT) / CELL) - midY,
          z: FRONT, color: WOOD.nail,
        });
      }
    }
    // The carcass proper, taken from the apothecary chest the player pointed at:
    // a capped top that overhangs on every side, a solid board closing each end,
    // and feet under the whole thing. The frame alone was a rack; these are what
    // make it furniture standing in the air rather than a trellis.
    const OVERHANG = Math.round(0.055 / CELL);
    /** How far back the case runs: to the back panel, so the cabinet is a box
     *  and not a picture frame with a board floating behind it. */
    const CASE_DEPTH = Math.round(DEPTH / CELL) + 5;
    const CAP = 4;
    const SIDE = 5;
    const capTone = (index: number): string => (index % 3 === 0 ? WOOD.cap : tone(index));
    for (let y = 0; y < CAP; y++) {
      for (let x = -OVERHANG; x < cols2 + OVERHANG; x++) {
        for (let z = -2; z < CASE_DEPTH; z++) {
          const grain = x % 9 === 0;
          frameCells.push({ x: x - midX, y: rows2 + y - midY, z: -FRONT * z,
                            color: grain ? WOOD.seam : capTone(Math.floor(x / 9) + y) });
        }
      }
    }
    for (const edge of [-OVERHANG, cols2 + OVERHANG - SIDE]) {
      for (let x = edge; x < edge + SIDE; x++) {
        for (let y = 0; y < rows2; y++) {
          const grain = y % 8 === 0;
          for (let z = -2; z < CASE_DEPTH; z++) {
            frameCells.push({ x: x - midX, y: y - midY, z: -FRONT * z,
                              color: grain ? WOOD.seam : tone(Math.floor(y / 8) + x) });
          }
        }
      }
    }
    // Feet: short blocks under each end board, set in from the corners.
    for (const edge of [-OVERHANG + 1, cols2 + OVERHANG - SIDE - 1]) {
      for (let x = edge; x < edge + SIDE; x++) {
        for (let y = -4; y < 0; y++) {
          for (let z = -1; z < 4; z++) frameCells.push({ x: x - midX, y: y - midY, z: -FRONT * z, color: WOOD.cap });
        }
      }
    }
    // A back behind every drawer, closing the carcass. Without it the cabinet
    // was a window frame: the farm showed through the empty cells and through
    // the letters of the title, which is not something a chest of drawers does.
    const backAt = Math.round(DEPTH / CELL) + 3;
    for (let x = 0; x < cols2; x++) {
      for (let y = 0; y < rows2; y++) {
        const seam = x % 11 === 0 || y % 9 === 0;
        for (let z = 0; z < 2; z++) {
          frameCells.push({ x: x - midX, y: y - midY, z: -FRONT * (backAt + z),
                            color: seam ? WOOD.seam : tone(Math.floor(x / 11) + Math.floor(y / 9)) });
        }
      }
    }
    board = voxels("panel board", frameCells);
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
        // The mouth of the drawer is FLUSH with the face of the frame, and the
        // box runs back from there into the carcass. Standing clear in front of
        // the frame, a drawer turning to follow the camera swung its whole body
        // across its neighbours and opened a gap you could see the farm
        // through; pivoting on the mouth, only the back moves.
        FRONT * CELL,
      );

      // Every slot is its own node: drawer, glass, ticket, buttons and item all
      // hang off it, so the whole box can turn to face the camera as a unit.
      const slot = new TransformNode(`panel slot ${index}`, scene);
      slot.parent = root;
      slot.position.copyFrom(centre);
      slotNodes.push(slot);

      const box = shell.createInstance(`panel drawer ${index}`);
      box.parent = slot;
      box.position.setAll(0);
      box.isPickable = true;
      parts.push(box);
      // The drawer itself takes one: the commonest thing to want, on the
      // biggest target on the cabinet.
      hits.push({ mesh: box, row: index, amount: "one" });

      const pane = glass.createInstance(`panel glass ${index}`);
      pane.parent = slot;
      pane.position.set(0, 0, FRONT * 0.002);
      parts.push(pane);

      // Three buttons across the top of the drawer, supermarket-style.
      if (row.takeable !== false) {
        // Laid out by their real widths, left to right across the mouth.
        const span = AMOUNTS.reduce((sum, a) => sum + buttonCells(a), 0) + BUTTON_GAP * 2;
        let cursor = -span / 2;
        for (const amount of AMOUNTS) {
          const wide = buttonCells(amount);
          const centreX = (cursor + wide / 2) * buttonCell;
          cursor += wide + BUTTON_GAP;
          const button = buttons[amount].createInstance(`panel button ${index} ${amount}`);
          button.parent = slot;
          // Inside the mouth, along its top edge: on the cabinet's front board
          // they sat over the title and over the drawer above.
          button.position.set(centreX, DRAWER * 0.36, FRONT * (DEPTH * 0.2));
          button.isPickable = true;
          parts.push(button);
          hits.push({ mesh: button, row: index, amount });
        }
      }

      // The label under the drawer, as a supermarket shelf edge: name, and the
      // count in its own colour.
      const full = row.note ?? nameOf(row);
      const label = full.length > LABEL_LIMIT ? `${full.slice(0, LABEL_LIMIT - 1)}.` : full;
      // A supermarket ticket: a pale card with dark ink, which is legible
      // against dark wood in a way white letters floating on wood never are.
      // One line, count first: a supermarket ticket, not a caption. Stacked on
      // two lines the card filled half the mouth and the produce behind it was
      // a coloured dot — the opposite of what a display case is for.
      const count = row.note ? "" : `${row.count}`;
      const countCells = textCells(count, { colour: TICKET.count, align: "left" });
      const gap = count ? textWidth(count) + 3 : 0;
      const nameCells = textCells(label, { colour: TICKET.name, align: "left" })
        .map((cell) => ({ ...cell, x: cell.x + gap }));
      const inkWidth = gap + textWidth(label);
      const cardWidth = inkWidth + 5;
      const cardHeight = 11;
      const cardCells: VoxelCell[] = [];
      for (let x = -2; x < cardWidth - 2; x++) {
        for (let y = -2; y < cardHeight - 2; y++) {
          const edge = x === -2 || x === cardWidth - 3 || y === -2 || y === cardHeight - 3;
          cardCells.push({ x, y, z: 0, color: edge ? TICKET.cardEdge : (row.takeable === false ? TICKET.muted : TICKET.card) });
        }
      }
      // The ticket is scaled to the drawer, not the other way round: whatever
      // the name costs in cells, the card comes out one mouth wide. This is the
      // rule the first cut lacked, and why a pepper's ticket lay across the
      // compost drawer beside it.
      const ticketCell = Math.min(TEXT_CELL, (DRAWER * 0.9) / (cardWidth + 1));
      const shift = -Math.floor(inkWidth / 2);
      const plate = voxels(`panel label ${index}`, [
        ...cardCells.map((cell) => ({ ...cell, x: cell.x + shift })),
        ...countCells.map((cell) => ({ ...cell, x: cell.x + shift, z: FRONT })),
        ...nameCells.map((cell) => ({ ...cell, x: cell.x + shift, z: FRONT })),
      ], ticketCell);
      plate.parent = slot;
      // Along the bottom edge of the mouth, in the drawer's own cell. Hung
      // under the drawer it covered the one below it.
      plate.position.set(0, -DRAWER * 0.5 + cardHeight * ticketCell * 0.6, FRONT * (DEPTH * 0.2));
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
      // Where the model's MIDDLE is, which is not where its origin is: a
      // strawberry authored hanging from a stem has its origin at the stem, so
      // placing the origin in the drawer hangs the fruit up against the
      // buttons. It also has to spin about its middle, or an off-centre origin
      // turns the display case into a fairground ride.
      const middle = bounds.min.add(bounds.max).scale(0.5 * model.pitch);
      // The produce is the reason the cabinet exists, so it gets the middle band
      // of the mouth — everything else was pushed to the edges to give it room.
      const scale = (DRAWER * 0.52) / Math.max(size.x, size.y, size.z, 1e-3);
      // On a pivot inside the slot, not on the root: the item rides with its
      // box when the box turns, and the pivot is what actually spins.
      const spin = new TransformNode(`panel item pivot ${index}`, scene);
      spin.parent = slot;
      item.parent = spin;
      item.scaling.setAll(scale);
      item.position.copyFrom(middle.scale(-scale));
      // In the middle of the box and set back off the glass: an item on the
      // rim of its drawer looks dropped on top of the cabinet.
      // Standing on the floor of its box, halfway back.
      spin.position.set(0, -DRAWER * 0.04, -FRONT * DEPTH * 0.5);
      item.isPickable = true;
      parts.push(item);
      spinning.push(spin);
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
      if (camera) {
        // Every box looks at the camera on its own account. The cabinet as a
        // whole already faces the player; this is the residue — the few degrees
        // each drawer is off, because it sits to one side of the middle. Walking
        // round the cabinet makes the boxes turn one after another, which is the
        // whole effect: a wall of drawers that notices where you are.
        // The root already billboards, so in ITS space the camera is straight
        // ahead: down the front axis at the viewing distance. Taking the camera
        // through the inverse world matrix instead gave an angle measured
        // against the billboard's own turn, which pinned every drawer to the
        // same clamped yaw — the whole cabinet looking off to the right.
        const distance = Vector3.Distance(camera.position, root.position);
        const ahead = FRONT * Math.max(0.5, distance / Math.max(1e-3, scaleNow));
        for (const node of slotNodes) {
          const dx = -node.position.x;
          const dy = -node.position.y;
          const dz = ahead - node.position.z;
          // Aim the drawer's front axis at that point. Clamped, because a
          // drawer that swings right round to follow the camera stops being
          // part of the cabinet.
          const wantedY = Math.max(-0.35, Math.min(0.35, Math.atan2(-dx, -dz)));
          const wantedX = Math.max(-0.28, Math.min(0.28, Math.atan2(dy, Math.hypot(dx, dz))));
          node.rotation.y += (wantedY - node.rotation.y) * Math.min(1, dt * 6);
          node.rotation.x += (wantedX - node.rotation.x) * Math.min(1, dt * 6);
        }
      }
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
