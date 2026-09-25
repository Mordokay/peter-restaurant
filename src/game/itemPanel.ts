// What is inside a thing, shown above the thing.
//
// A panel pinned to the corner of the screen is a spreadsheet the world happens
// to be behind. This is the other way round: the panel hangs in the air over the
// crate it belongs to, turns to face the camera as the camera turns, and holds
// the ACTUAL items — the same carrot model that grew in the row, standing in a
// slot. The player reads the contents the way they read everything else in this
// game, by looking at it.
//
// The backdrop and its lettering are drawn on one dynamic texture, which is
// temporary: the roadmap has a voxel font, and when it exists this file keeps
// its slots and swaps its sign-writing. The items in the slots are already the
// real thing.
import {
  Color3, DynamicTexture, MeshBuilder, StandardMaterial, TransformNode, Vector3,
  type AbstractMesh, type Scene, type ShadowGenerator,
} from "@babylonjs/core";
import { createVoxelMaterial, createVoxelMesh } from "./voxelGeometry.ts";
import { cellsFromAuthoredModel, type AuthoredVoxelCatalog } from "./voxelModel.ts";
import { createMeshLibrary } from "./meshLibrary.ts";
import { modelBounds } from "./storageDisplay.ts";

/** A row of a container's contents. Named for what it is, not for the panel
 *  that happens to draw it: the crate and the bin describe themselves this way
 *  whether anyone is looking or not. */
export interface PanelRow {
  item: string;
  count: number;
  /** False for things that cannot be taken yet — compost still rotting. */
  takeable?: boolean;
  /** Shown under the count: "rotting", "on the plate". */
  note?: string;
  /** Overrides the catalog name in the panel's writing. */
  label?: string;
}

/** Rendering group the panel draws in: after the world, on a cleared depth
 *  buffer, so nothing can cut through it. */
const PANEL_LAYER = 2;

export interface ItemPanel {
  readonly open: boolean;
  /** Which row a picked mesh belongs to, or null. */
  rowAt(mesh: AbstractMesh | null | undefined): number | null;
  /** `at` is the thing the panel belongs to; `from` is the player, so the board
   *  can stand clear of them rather than through them. */
  show(options: { title: string; at: Vector3; from?: Vector3; rows: readonly PanelRow[] }): void;
  /** Keep it over a thing that has moved, or a player who has. */
  move(at: Vector3, from?: Vector3): void;
  /** Redraw with new contents, keeping it where it is. */
  setRows(rows: readonly PanelRow[]): void;
  /** Per-frame work: turning the items on their slots, and holding the board at
   *  a readable size however far the camera has pulled back. Both cost one
   *  matrix each and not a single extra draw call, because every item in the
   *  panel is already an instance of a mesh the game had anyway. */
  update(dt: number): void;
  hide(): void;
  dispose(): void;
}

const COLUMNS = 4;
/** One slot, in metres and in pixels. Everything else is derived from these two
 *  numbers, which is what keeps the lettering square: the board's proportions
 *  come from its texture rather than being chosen separately and then stretched
 *  to fit — the first cut drew on a square texture and squashed every word. */
const SLOT = 0.34;
const SLOT_PX = 256;
const HEADER_PX = 96;
const PX = SLOT / SLOT_PX;
/** Radians per second an item turns on its slot. Slow: it is a display case,
 *  not a carousel, and the player has to be able to read a shape while it moves. */
const SPIN = 0.55;
/** Distance at which the board is its authored size; nearer it shrinks, further
 *  it grows, so its share of the screen stays about the same. */
const REFERENCE_DISTANCE = 12;
// The clamps only catch the extremes — surveying the whole compound, or a nose
// against the crate. Across the play range (3 m to 34 m) the compensation is
// complete, so the board holds the same share of the screen throughout.
const MIN_SCALE = 0.24;
const MAX_SCALE = 3.2;

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
  // three-quarter angle, so a board that only spins about its vertical axis is
  // still being read at a slant. Billboarding all three axes tips it up to meet
  // the eye, and the items tip with it, which shows their tops rather than
  // their silhouettes.
  root.billboardMode = TransformNode.BILLBOARDMODE_ALL;

  const library = createMeshLibrary();
  // Items in the slots are lit by nothing: the board tips towards the camera,
  // which tips them away from the sun, and a slot full of silhouette is a slot
  // full of nothing. Unlit keeps their own colours exactly as authored, which
  // is what an icon wants anyway.
  //
  // WHITE emissive is what carries the colour. Turning lighting off leaves
  // nothing driving the diffuse term, so the meshes render BLACK — the same
  // mistake lighting.ts documents for glowing voxels, made again here and
  // found the same way: by looking at a panel full of silhouettes.
  const itemMaterial = createVoxelMaterial("item panel items", scene);
  itemMaterial.disableLighting = true;
  itemMaterial.emissiveColor = Color3.White();
  itemMaterial.specularColor = Color3.Black();
  let texture: DynamicTexture | null = null;
  const backdropMaterial = new StandardMaterial("item panel", scene);
  backdropMaterial.disableLighting = true;
  backdropMaterial.backFaceCulling = false;
  const backdrop = MeshBuilder.CreatePlane("item panel backdrop", { width: 1, height: 1 }, scene);
  backdrop.material = backdropMaterial;
  backdrop.parent = root;
  backdrop.isPickable = false;
  // The panel draws after the world with a fresh depth buffer, so it is never
  // half-buried in a wall or sliced through by the farmer standing in front of
  // it. Every game that puts a readable board in world space does this; the
  // alternative is a panel that is sometimes a panel and sometimes a mess.
  backdrop.renderingGroupId = PANEL_LAYER;

  // A stem down to the thing it belongs to. Once the board is lifted clear of
  // the player it needs to say what it is ABOUT, which is exactly what the tail
  // of a speech balloon is for.
  const stemMaterial = new StandardMaterial("item panel stem", scene);
  stemMaterial.disableLighting = true;
  stemMaterial.emissiveColor = Color3.FromHexString("#8fa598");
  stemMaterial.alpha = 0.5;
  const stem = MeshBuilder.CreateCylinder("item panel stem", { height: 1, diameter: 0.025, tessellation: 6 }, scene);
  stem.material = stemMaterial;
  stem.isPickable = false;
  stem.renderingGroupId = PANEL_LAYER;
  if (options.parent) stem.parent = options.parent;

  /** One instance per filled slot, and the row it belongs to. */
  const slots: { mesh: AbstractMesh; row: number }[] = [];
  let rows: readonly PanelRow[] = [];

  const nameOf = (row: PanelRow): string => row.label ?? catalog.models[row.item]?.name ?? row.item;

  /** Draw the board at exactly the size it hangs at, so nothing is stretched. */
  const draw = (title: string, cols: number, lines: number): void => {
    const width = cols * SLOT_PX;
    const height = HEADER_PX + lines * SLOT_PX;
    if (!texture || texture.getSize().width !== width || texture.getSize().height !== height) {
      texture?.dispose();
      texture = new DynamicTexture("item panel", { width, height }, scene, false);
      texture.hasAlpha = true;
      backdropMaterial.diffuseTexture = texture;
      backdropMaterial.opacityTexture = texture;
      backdropMaterial.emissiveTexture = texture;
    }
    const context = texture.getContext() as CanvasRenderingContext2D;
    context.clearRect(0, 0, width, height);

    context.fillStyle = "rgba(20, 30, 26, 0.9)";
    context.beginPath();
    context.roundRect(4, 4, width - 8, height - 8, 22);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.22)";
    context.lineWidth = 3;
    context.stroke();

    context.fillStyle = "#eef3ea";
    context.font = "600 42px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(title, width / 2, HEADER_PX / 2 + 4);

    for (let index = 0; index < cols * lines; index++) {
      const col = index % cols;
      const line = Math.floor(index / cols);
      const x = col * SLOT_PX + 12;
      const y = HEADER_PX + line * SLOT_PX + 8;
      const w = SLOT_PX - 24;
      const h = SLOT_PX - 20;
      context.fillStyle = "rgba(255,255,255,0.05)";
      context.beginPath();
      context.roundRect(x, y, w, h, 18);
      context.fill();
      context.strokeStyle = "rgba(255,255,255,0.16)";
      context.lineWidth = 2;
      context.stroke();

      const row = rows[index];
      if (!row) continue;
      // The count in the corner and the name along the foot, both INSIDE the
      // slot: a number hanging off the bottom of a board is a bug you can see
      // from across the farm.
      context.textAlign = "right";
      context.fillStyle = row.takeable === false ? "#8fa598" : "#d8f0c4";
      context.font = "700 40px system-ui, sans-serif";
      context.fillText(`${row.count}`, x + w - 14, y + 34);
      context.textAlign = "center";
      context.font = "500 24px system-ui, sans-serif";
      context.fillStyle = "rgba(238,243,234,0.76)";
      context.fillText(row.note ?? nameOf(row), x + w / 2, y + h - 22);
    }
    texture.update();
  };

  const clearSlots = (): void => {
    for (const slot of slots) slot.mesh.dispose(false, false);
    slots.length = 0;
  };

  /** Stand the real item in the slot, scaled to fit it. */
  const fillSlots = (cols: number, lines: number): void => {
    clearSlots();
    const planeH = (HEADER_PX + lines * SLOT_PX) * PX;
    for (const [index, row] of rows.entries()) {
      const model = catalog.models[row.item];
      if (!model) continue;
      const source = library.source(`panel:${row.item}`, () => {
        const mesh = createVoxelMesh(`panel ${row.item}`, cellsFromAuthoredModel(model), model.pitch, scene, { material: itemMaterial });
        mesh.isPickable = false;
        // On the SOURCE, not on the instances: an instance's rendering group is
        // its source's, so setting it per instance silently did nothing and the
        // board — which does draw in the panel layer, on a cleared depth
        // buffer — painted straight over every item in it.
        mesh.renderingGroupId = PANEL_LAYER;
        return mesh;
      });
      const instance = source.createInstance(`panel slot ${index}`);
      const bounds = modelBounds(model);
      const size = bounds.max.subtract(bounds.min).scale(model.pitch);
      const scale = (SLOT * 0.46) / Math.max(size.x, size.y, size.z, 1e-3);
      const col = index % cols;
      const line = Math.floor(index / cols);
      instance.parent = root;
      instance.scaling.setAll(scale);
      instance.position.set(
        (col - (cols - 1) / 2) * SLOT,
        // Measured down the board in the same pixels the slots were drawn in,
        // then lifted so the item stands on the slot rather than through it.
        planeH / 2 - (HEADER_PX + (line + 0.5) * SLOT_PX) * PX - size.y * scale * 0.18,
        // In FRONT of the board. A Babylon plane faces +Z, so the first cut put
        // every item behind its own backdrop — they were there all along, seen
        // dimly through a dark sheet, which reads exactly like a lighting bug.
        0.06,
      );
      instance.isPickable = true;
      slots.push({ mesh: instance, row: index });
    }
  };

  const layout = (title: string): void => {
    const lines = Math.max(1, Math.ceil(rows.length / COLUMNS));
    const cols = Math.min(COLUMNS, Math.max(1, rows.length));
    backdrop.scaling.set(cols * SLOT_PX * PX, (HEADER_PX + lines * SLOT_PX) * PX, 1);
    draw(title, cols, lines);
    fillSlots(cols, lines);
  };

  /** Lift the board clear of the object and lean it away from the player, then
   *  run the stem back down to the thing itself.
   *
   *  The overlap this solves is the obvious one once seen: a panel at the height
   *  of a crate is at the height of the farmer standing at the crate, and he is
   *  between it and the camera. Raising it is not enough on its own — a board
   *  floating in the sky belongs to nothing — hence the stem. */
  const LIFT = 1.15;
  const CLEAR = 0.55;
  /** The board's current size, and the thing it is hanging over. */
  let scaleNow = 1;
  let anchor: { at: Vector3; from?: Vector3 } | null = null;
  const place = (at: Vector3, from?: Vector3): void => {
    anchor = { at, from };
    const away = from ? at.subtract(from) : Vector3.Zero();
    away.y = 0;
    // Push it to the far side of the object from the player, so the player is
    // never standing between the camera and the board they just opened.
    if (away.lengthSquared() > 1e-4) away.normalize().scaleInPlace(CLEAR);
    // The lift grows with the board, or a big panel sits on top of its own object.
    const head = at.add(new Vector3(away.x, LIFT * scaleNow, away.z));
    root.position.copyFrom(head);
    const lines = Math.max(1, Math.ceil(rows.length / COLUMNS));
    const boardBottom = head.y - ((HEADER_PX + lines * SLOT_PX) * PX * scaleNow) / 2;
    const drop = Math.max(0.05, boardBottom - at.y);
    stem.position.set(head.x, boardBottom - drop / 2, head.z);
    stem.scaling.y = drop;
  };

  let title = "";
  return {
    get open() { return root.isEnabled(); },
    rowAt(mesh) {
      if (!mesh) return null;
      return slots.find((slot) => slot.mesh === mesh)?.row ?? null;
    },
    show(shown) {
      title = shown.title;
      rows = shown.rows;
      place(shown.at, shown.from);
      layout(title);
      root.setEnabled(true);
      stem.setEnabled(true);
    },
    move(at, from) { if (root.isEnabled()) place(at, from); },
    update(dt) {
      if (!root.isEnabled()) return;
      for (const [index, slot] of slots.entries()) {
        // Each one a little out of step with its neighbours, so a full crate
        // reads as a shelf of objects rather than a clock mechanism.
        slot.mesh.rotation.y += dt * (SPIN + index * 0.06);
      }
      // A board an inch tall is not a board. Apparent size falls off with
      // distance, so the world size rises with it: the panel keeps roughly the
      // same share of the screen from the closest zoom to the furthest, which
      // is what makes it a HUD that happens to live in the world rather than a
      // signpost that shrinks to nothing. Eased, so a zoom does not snap it.
      const camera = scene.activeCamera;
      if (camera && anchor) {
        const distance = Vector3.Distance(camera.position, root.position);
        const wanted = Math.max(MIN_SCALE, Math.min(MAX_SCALE, distance / REFERENCE_DISTANCE));
        scaleNow += (wanted - scaleNow) * Math.min(1, dt * 8);
        root.scaling.setAll(scaleNow);
        place(anchor.at, anchor.from);
      }
    },
    setRows(next) {
      rows = next;
      layout(title);
    },
    hide() {
      anchor = null;
      root.setEnabled(false);
      stem.setEnabled(false);
      clearSlots();
    },
    dispose() {
      clearSlots();
      library.dispose();
      itemMaterial.dispose();
      stem.dispose(false, false);
      stemMaterial.dispose();
      backdrop.dispose(false, false);
      backdropMaterial.dispose();
      texture?.dispose();
      root.dispose();
    },
  };
}
