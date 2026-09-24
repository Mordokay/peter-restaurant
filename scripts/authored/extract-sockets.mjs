// Turn marker parts into sockets, then delete them.
//
// Sockets are cell coordinates on a part; the authoring scripts only know world
// metres. Rather than reconstruct the voxeliser's transform (it never records
// its grid origin, and voxels-to-model recentres X and Z), each socket is
// authored as a small marker cube that rides through the same pipeline. Here we
// read each marker's centroid in CELL space, record it as a socket on the
// holder part, and remove the marker geometry and its palette entry.
//
//   node scripts/authored/extract-sockets.mjs <modelId> [holderPartId]
import { readModel, writeModel } from "./../catalog-io.mjs";

// catalog-io sanitises part ids, so the authored "__sock__fruit_3" arrives as
// "sock_fruit_3". Match either spelling rather than the one Blender used.
// Only "#N" is a component-split suffix (voxels-to-model de-duplicates that
// way). "_7" is part of the socket's own name - stripping it collapsed all
// eight fruit markers into a single socket called "fruit".
const MARKER = /^_*sock_+(.+?)(?:#\d+)?$/;
const isMarker = (id) => MARKER.test(id);
const [modelId, holderId] = process.argv.slice(2);
if (!modelId) throw new Error("Usage: extract-sockets.mjs <modelId> [holderPartId]");

const model = readModel(modelId);
const markers = model.parts.filter((p) => isMarker(p.id));
if (!markers.length) { console.log(`${modelId}: no sock_* markers`); process.exit(0); }

/** Every cell of a part, as [x,y,z].
 *
 *  The formats are the ones expandGeometry() walks in voxelModel.ts, and they
 *  are NOT what they look like: a run is [y, z, x0, x1, colour] - a span along
 *  X at a fixed (y, z) - and a box is [x0, y0, z0, x1, y1, z1, colour]. Reading
 *  a run as [x, y, z, length] produced centroids below the ground plane and
 *  silently lost half the sockets. */
const cellsOf = (part) => {
  const out = [];
  for (const [y, z, x0, x1] of part.runs ?? []) for (let x = x0; x <= x1; x++) out.push([x, y, z]);
  for (const [x0, y0, z0, x1, y1, z1] of part.boxes ?? []) {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z]);
  }
  for (const [x, y, z] of part.voxels ?? []) out.push([x, y, z]);
  return out;
};

const holder = holderId ? model.parts.find((p) => p.id === holderId)
                        : model.parts.find((p) => !isMarker(p.id));
if (!holder) throw new Error(`${modelId}: no holder part to hang sockets on`);

// A marker may arrive split into several components; group them by socket name.
const byName = new Map();
for (const part of markers) {
  const name = MARKER.exec(part.id)[1];
  (byName.get(name) ?? byName.set(name, []).get(name)).push(...cellsOf(part));
}

const sockets = { ...(holder.sockets ?? {}) };
for (const [name, cells] of byName) {
  if (!cells.length) continue;
  const mid = (i) => Math.round(cells.reduce((s, c) => s + c[i], 0) / cells.length);
  sockets[name] = [mid(0), mid(1), mid(2)];
}
holder.sockets = sockets;

model.parts = model.parts.filter((p) => !isMarker(p.id));
// The marker magenta is now unused; drop it so it cannot leak into the palette.
const used = new Set(model.parts.flatMap((p) => [
  ...(p.runs ?? []).map((r) => r[4]),
  ...(p.boxes ?? []).map((b) => b[6]),
  ...(p.voxels ?? []).map((v) => v[3]),
]));
for (const key of Object.keys(model.palette)) if (!used.has(key)) delete model.palette[key];

writeModel(model);
console.log(`${modelId}: ${byName.size} socket(s) on "${holder.id}" -> ${[...byName.keys()].sort().join(", ")}; ${markers.length} marker part(s) removed`);
