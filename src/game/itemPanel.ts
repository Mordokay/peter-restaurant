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
  DynamicTexture, MeshBuilder, StandardMaterial, TransformNode, Vector3,
  type AbstractMesh, type Scene, type ShadowGenerator,
} from "@babylonjs/core";
import { createVoxelMesh } from "./voxelGeometry.ts";
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

export interface ItemPanel {
  readonly open: boolean;
  /** Which row a picked mesh belongs to, or null. */
  rowAt(mesh: AbstractMesh | null | undefined): number | null;
  show(options: { title: string; at: Vector3; rows: readonly PanelRow[] }): void;
  /** Redraw with new contents, keeping it where it is. */
  update(rows: readonly PanelRow[]): void;
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
  // Y-only, so the panel turns to face the camera while its items stay upright
  // rather than tipping over as the camera rises.
  root.billboardMode = TransformNode.BILLBOARDMODE_Y;

  const library = createMeshLibrary();
  let texture: DynamicTexture | null = null;
  const backdropMaterial = new StandardMaterial("item panel", scene);
  backdropMaterial.disableLighting = true;
  backdropMaterial.backFaceCulling = false;
  const backdrop = MeshBuilder.CreatePlane("item panel backdrop", { width: 1, height: 1 }, scene);
  backdrop.material = backdropMaterial;
  backdrop.parent = root;
  backdrop.isPickable = false;

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
        const mesh = createVoxelMesh(`panel ${row.item}`, cellsFromAuthoredModel(model), model.pitch, scene);
        mesh.isPickable = false;
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
        -0.05,
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
      root.position.copyFrom(shown.at);
      layout(title);
      root.setEnabled(true);
    },
    update(next) {
      rows = next;
      layout(title);
    },
    hide() {
      root.setEnabled(false);
      clearSlots();
    },
    dispose() {
      clearSlots();
      library.dispose();
      backdrop.dispose(false, false);
      backdropMaterial.dispose();
      texture?.dispose();
      root.dispose();
    },
  };
}
