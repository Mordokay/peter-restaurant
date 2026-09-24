// VXM — the binary on-disk form of an authored voxel model.
//
// Why: the JSON form of 589 models is 525 MB; three thousand models would be over
// two gigabytes, which no clone or browser tab tolerates. VXM stores the geometry
// arrays (boxes, runs, voxels — ~99 % of the bytes) as packed 16-bit integers with a
// palette index, keeps everything else (id, pitch, palette, name, folder, tags, clips,
// part metadata) as a small JSON header, and the whole file is deflated by the writer.
// Decoding yields exactly the AuthoredVoxelModel object the rest of the code uses.
//
// Layout (before compression):
//   "VXM1"            4 bytes magic
//   u32 metaLength    little-endian
//   meta              UTF-8 JSON: { model without geometry, partsMeta, paletteKeys }
//   geometry          for every part in order, base then each state in order:
//                       u32 nBoxes,  nBoxes  × (6 × i16 + u8 colour)
//                       u32 nRuns,   nRuns   × (4 × i16 + u8 colour)
//                       u32 nVoxels, nVoxels × (3 × i16 + u8 colour)
//
// Pure functions over Uint8Array: shared by the browser (fetch + DecompressionStream)
// and by Node tooling (scripts/catalog-io.mjs via zlib). Compression is the caller's job.
import type { AuthoredVoxelModel, AuthoredVoxelPart, PartGeometry, VoxelBox, VoxelCoordinate, VoxelRun } from "./voxelModel.ts";

export const VXM_MAGIC = "VXM1";

interface PartMeta {
  id: string;
  pivot: readonly [number, number, number];
  parent?: string;
  sockets?: AuthoredVoxelPart["sockets"];
  sway?: number;
  transform?: AuthoredVoxelPart["transform"];
  /** State names in the order their geometry follows the base geometry. */
  states?: string[];
}

interface VxmMeta {
  model: Omit<AuthoredVoxelModel, "parts">;
  parts: PartMeta[];
  paletteKeys: string[];
}

const BOX_BYTES = 6 * 2 + 1;
const RUN_BYTES = 4 * 2 + 1;
const VOXEL_BYTES = 3 * 2 + 1;

function geometryBytes(geometry: PartGeometry): number {
  return 12 + (geometry.boxes?.length ?? 0) * BOX_BYTES + (geometry.runs?.length ?? 0) * RUN_BYTES + (geometry.voxels?.length ?? 0) * VOXEL_BYTES;
}

function checkInt16(value: number, what: string): number {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) throw new Error(`VXM: ${what} ${value} does not fit int16`);
  return value;
}

export function encodeVxm(model: AuthoredVoxelModel): Uint8Array {
  const paletteKeys = Object.keys(model.palette);
  if (paletteKeys.length > 255) throw new Error(`VXM: palette of ${model.id} has ${paletteKeys.length} colours; the format holds 255`);
  const colourIndex = new Map(paletteKeys.map((key, index) => [key, index]));
  const { parts, ...rest } = model;
  const meta: VxmMeta = {
    model: rest,
    parts: parts.map((part) => {
      const entry: PartMeta = { id: part.id, pivot: part.pivot };
      if (part.parent !== undefined) entry.parent = part.parent;
      if (part.sockets) entry.sockets = part.sockets;
      if (part.sway !== undefined) entry.sway = part.sway;
      if (part.transform) entry.transform = part.transform;
      if (part.states && Object.keys(part.states).length) entry.states = Object.keys(part.states);
      return entry;
    }),
    paletteKeys,
  };
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  let geometrySize = 0;
  for (const part of parts) {
    geometrySize += geometryBytes(part);
    for (const state of Object.values(part.states ?? {})) geometrySize += geometryBytes(state);
  }
  const out = new Uint8Array(4 + 4 + metaBytes.length + geometrySize);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(VXM_MAGIC), 0);
  view.setUint32(4, metaBytes.length, true);
  out.set(metaBytes, 8);
  let offset = 8 + metaBytes.length;
  const colour = (key: string) => { const index = colourIndex.get(key); if (index === undefined) throw new Error(`VXM: ${model.id} uses colour ${key} missing from its palette`); return index; };
  const writeGeometry = (geometry: PartGeometry) => {
    const boxes = geometry.boxes ?? [], runs = geometry.runs ?? [], voxels = geometry.voxels ?? [];
    view.setUint32(offset, boxes.length, true); offset += 4;
    for (const box of boxes) { for (let i = 0; i < 6; i++) { view.setInt16(offset, checkInt16(box[i] as number, "box coordinate"), true); offset += 2; } out[offset++] = colour(box[6]); }
    view.setUint32(offset, runs.length, true); offset += 4;
    for (const run of runs) { for (let i = 0; i < 4; i++) { view.setInt16(offset, checkInt16(run[i] as number, "run coordinate"), true); offset += 2; } out[offset++] = colour(run[4]); }
    view.setUint32(offset, voxels.length, true); offset += 4;
    for (const voxel of voxels) { for (let i = 0; i < 3; i++) { view.setInt16(offset, checkInt16(voxel[i] as number, "voxel coordinate"), true); offset += 2; } out[offset++] = colour(voxel[3]); }
  };
  for (const part of parts) {
    writeGeometry(part);
    for (const name of Object.keys(part.states ?? {})) writeGeometry(part.states![name]!);
  }
  if (offset !== out.length) throw new Error(`VXM: size mismatch encoding ${model.id} (${offset} vs ${out.length})`);
  return out;
}

export function isVxm(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 0x56 && bytes[1] === 0x58 && bytes[2] === 0x4d && bytes[3] === 0x31;
}

export function decodeVxm(bytes: Uint8Array): AuthoredVoxelModel {
  if (!isVxm(bytes)) throw new Error("VXM: bad magic (not a VXM1 file, or still compressed)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLength = view.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + metaLength))) as VxmMeta;
  let offset = 8 + metaLength;
  const keys = meta.paletteKeys;
  const readGeometry = (): PartGeometry => {
    const geometry: { boxes?: VoxelBox[]; runs?: VoxelRun[]; voxels?: VoxelCoordinate[] } = {};
    const nBoxes = view.getUint32(offset, true); offset += 4;
    if (nBoxes) {
      const boxes: VoxelBox[] = new Array(nBoxes);
      for (let n = 0; n < nBoxes; n++) {
        boxes[n] = [view.getInt16(offset, true), view.getInt16(offset + 2, true), view.getInt16(offset + 4, true), view.getInt16(offset + 6, true), view.getInt16(offset + 8, true), view.getInt16(offset + 10, true), keys[bytes[offset + 12]!]!];
        offset += BOX_BYTES;
      }
      geometry.boxes = boxes;
    }
    const nRuns = view.getUint32(offset, true); offset += 4;
    if (nRuns) {
      const runs: VoxelRun[] = new Array(nRuns);
      for (let n = 0; n < nRuns; n++) {
        runs[n] = [view.getInt16(offset, true), view.getInt16(offset + 2, true), view.getInt16(offset + 4, true), view.getInt16(offset + 6, true), keys[bytes[offset + 8]!]!];
        offset += RUN_BYTES;
      }
      geometry.runs = runs;
    }
    const nVoxels = view.getUint32(offset, true); offset += 4;
    if (nVoxels) {
      const voxels: VoxelCoordinate[] = new Array(nVoxels);
      for (let n = 0; n < nVoxels; n++) {
        voxels[n] = [view.getInt16(offset, true), view.getInt16(offset + 2, true), view.getInt16(offset + 4, true), keys[bytes[offset + 6]!]!];
        offset += VOXEL_BYTES;
      }
      geometry.voxels = voxels;
    }
    return geometry;
  };
  const parts: AuthoredVoxelPart[] = meta.parts.map((partMeta) => {
    const base = readGeometry();
    const part: AuthoredVoxelPart & { states?: Record<string, PartGeometry> } = { id: partMeta.id, pivot: partMeta.pivot, ...base };
    if (partMeta.parent !== undefined) part.parent = partMeta.parent;
    if (partMeta.sockets) part.sockets = partMeta.sockets;
    if (partMeta.sway !== undefined) part.sway = partMeta.sway;
    if (partMeta.transform) part.transform = partMeta.transform;
    if (partMeta.states?.length) {
      const states: Record<string, PartGeometry> = {};
      for (const name of partMeta.states) states[name] = readGeometry();
      part.states = states;
    }
    return part;
  });
  if (offset !== bytes.length) throw new Error(`VXM: trailing bytes decoding ${meta.model.id} (${bytes.length - offset})`);
  return { ...meta.model, parts } as AuthoredVoxelModel;
}

/** Browser-side: fetch a deflated VXM file and decode it. */
export async function fetchVxm(url: string): Promise<AuthoredVoxelModel> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`VXM: ${url} → ${response.status}`);
  const inflated = response.body.pipeThrough(new DecompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(inflated).arrayBuffer());
  return decodeVxm(bytes);
}
