// Converts a .vox.json grid (from scripts/voxelize-mesh.py) into the game's
// authored voxel format and patches it into the catalog (src/assets/catalog/*.json).
//
// Version-2 grids (the universal converter) carry a shared palette and object
// PARTS, each with its own voxel scale (fine cells per voxel). Scale-1 parts
// become x-runs; coarser parts become filled boxes on the same fine lattice,
// so a 2x2x2 block is one box entry and renders as one big cube. Coarse parts
// are emitted first because the catalog loader lets later entries repaint
// earlier cells: fine detail wins wherever the two overlap.
//
// Version-1 grids without colors (the wheat .obj path) keep the anatomy
// banding: top band = heads, below = stems, deterministic two-tone shading.
//
// Usage:
//   node scripts/voxels-to-model.mjs input.vox.json <modelId> <worldHeight>
//        [--parts plant] [--keepSourceParts] [--recolor '#from>#to[,#from>#to]']
//        [--recolorTolerance 0.08] [--headFraction 0.34] [--foldFragments 0.01]
//
// --parts ID            name of the single catalog part all voxels go into
//                       (default "plant" for v2 grids, "stems,heads" for v1).
// --foldFragments f     with --keepSourceParts: source pieces smaller than f of
//                       the largest piece (default 1%) are folded into the
//                       part they touch most; floating ones are dropped. Scans
//                       shed hundreds of such flakes. 0 keeps every piece.
// --keepSourceParts     one catalog part per source object part instead
//                       (ids p0, p1, ... in emit order) — for later per-part
//                       animation.
// --recolor a>b,...     ART DIRECTION, explicit and per model: every palette
//                       color within --recolorTolerance (Oklab) of `a` becomes
//                       `b`. This is the only place the pipeline changes a
//                       color the source did not have.
import { readFileSync, writeFileSync } from "node:fs";
import { readCatalog, writeModel } from "./catalog-io.mjs";

const args = process.argv.slice(2);
const input = args[0];
const modelId = args[1];
const worldHeight = Number(args[2]);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const headFraction = Number(option("--headFraction") ?? 0.34);
const partsOption = option("--parts");
const keepSourceParts = args.includes("--keepSourceParts");
const recolorOption = option("--recolor");
const recolorTolerance = Number(option("--recolorTolerance") ?? 0.08);
const foldFragments = option("--foldFragments") === undefined ? 0.01 : Number(option("--foldFragments"));
if (!input || !modelId || !Number.isFinite(worldHeight) || (args.includes("--parts") && !partsOption)) {
  throw new Error("Usage: node scripts/voxels-to-model.mjs input.vox.json <modelId> <worldHeight> [--parts plant] [--keepSourceParts] [--recolor '#from>#to'] [--recolorTolerance 0.08] [--headFraction 0.34]");
}

const grid = JSON.parse(readFileSync(input, "utf8"));
const [sizeX, sizeY, sizeZ] = grid.size;
const halfX = Math.round(sizeX / 2);
const halfZ = Math.round(sizeZ / 2);

// ---------------------------------------------------------------------------
// Color helpers (sRGB hex <-> Oklab) for the explicit --recolor override.
// ---------------------------------------------------------------------------
const hexToRgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToOklab(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const oklabDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function runsFromCells(cells) {
  // cells: [x, y, z, colorKey] at scale 1 -> [y, z, xStart, xEnd, color] runs.
  const rows = new Map();
  for (const [x, y, z, color] of cells) {
    const key = `${y},${z}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push([x, color]);
  }
  const runs = [];
  for (const [key, entries] of rows) {
    const [y, z] = key.split(",").map(Number);
    entries.sort((a, b) => a[0] - b[0]);
    let current = null;
    for (const [x, color] of entries) {
      if (current && x === current[3] + 1 && color === current[4]) current[3] = x;
      else if (!current || x !== current[3] || color !== current[4]) {
        current = [y, z - halfZ, x, x, color];
        runs.push(current);
      }
    }
  }
  for (const run of runs) { run[2] -= halfX; run[3] -= halfX; }
  return runs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
}

let model;
if (grid.version === 2) {
  // Palette: only colors actually used, keys c0..cN in first-use order.
  const paletteKeys = new Map(); // source palette index -> key
  const palette = {};
  const keyFor = (index) => {
    if (!paletteKeys.has(index)) {
      const key = `c${paletteKeys.size}`;
      paletteKeys.set(index, key);
      palette[key] = grid.palette[index];
    }
    return paletteKeys.get(index);
  };

  const singlePartId = partsOption ?? "plant";
  const catalogParts = [];
  const partsById = new Map();
  // Source parts become catalog parts named after their node (sanitized,
  // de-duplicated with #n for multi-piece nodes, p<n> for unnamed ones). When
  // the file has a node hierarchy, the parent node becomes part.parent — the
  // artist's own joints survive; rig-model.mjs only fills in what is missing.
  const slug = (name) => (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  const partIdOf = new Map(); // emit index -> catalog part id
  const usedIds = new Set();
  const nodeParts = new Map(); // node name -> first part id from that node (the parent target)
  // One node in the file (a flat kitbash) -> short p<n> ids; several nodes ->
  // the node's name, so a "Microwave > Door > Knob" tree keeps its words.
  const nodeCount = new Set(grid.parts.map((part) => part.node)).size;
  grid.parts.forEach((part, emitIndex) => {
    let base = keepSourceParts ? (nodeCount > 1 ? (slug(part.node) || `p${emitIndex}`) : `p${emitIndex}`) : singlePartId;
    if (keepSourceParts && nodeCount > 1 && grid.parts.filter((other) => other.node === part.node).length > 1) base = `${base}_${emitIndex}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}_${n}`;
    usedIds.add(id);
    partIdOf.set(emitIndex, id);
    if (part.node && !nodeParts.has(part.node)) nodeParts.set(part.node, id);
  });
  // Catalog parts keep their OWN cells at runtime (overlapping parts both
  // render), so overlaps between source parts are resolved here: finer parts
  // win over coarser ones and, at equal scale, later parts win. A coarse block
  // that is only partly covered is emitted as its uncovered cells.
  const claimed = new Set();
  const ordered = [...grid.parts.entries()].sort((a, b) => (a[1].scale - b[1].scale) || (b[0] - a[0]));
  const pending = new Map();
  for (const [emitIndex, part] of ordered) {
    const partId = partIdOf.get(emitIndex);
    let bucket = pending.get(partId);
    if (!bucket) pending.set(partId, (bucket = { runsCells: [], boxes: [], voxels: [] }));
    if (part.scale === 1) {
      for (const [x, y, z, c] of part.cells) {
        const key = `${x},${y},${z}`;
        if (claimed.has(key)) continue;
        claimed.add(key);
        bucket.runsCells.push([x, y, z, keyFor(c)]);
      }
    } else {
      const s = part.scale;
      for (const [x, y, z, c] of part.cells) {
        const free = [];
        for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) for (let dz = 0; dz < s; dz++) {
          if (!claimed.has(`${x + dx},${y + dy},${z + dz}`)) free.push([x + dx, y + dy, z + dz]);
        }
        if (free.length === s * s * s) bucket.boxes.push([x - halfX, y, z - halfZ, x - halfX + s - 1, y + s - 1, z - halfZ + s - 1, keyFor(c)]);
        else for (const [fx, fy, fz] of free) bucket.voxels.push([fx - halfX, fy, fz - halfZ, keyFor(c)]);
        for (const [fx, fy, fz] of free) claimed.add(`${fx},${fy},${fz}`);
      }
    }
  }
  for (const [emitIndex, part] of grid.parts.entries()) {
    const partId = partIdOf.get(emitIndex);
    if (partsById.has(partId)) continue;
    const entry = { id: partId, pivot: [0, 0, 0] };
    const parentId = keepSourceParts && part.parentNode ? nodeParts.get(part.parentNode) : undefined;
    if (parentId && parentId !== partId) entry.parent = parentId;
    const bucket = pending.get(partId) ?? { runsCells: [], boxes: [], voxels: [] };
    if (bucket.boxes.length) entry.boxes = bucket.boxes;
    if (bucket.runsCells.length) entry.runs = runsFromCells(bucket.runsCells);
    if (bucket.voxels.length) entry.voxels = bucket.voxels;
    partsById.set(partId, entry);
    catalogParts.push(entry);
  }

  // Fold fragments: tiny disconnected pieces join the part they touch most.
  if (keepSourceParts && foldFragments > 0 && catalogParts.length > 1) {
    const cellsOf = (part) => {
      const out = [];
      for (const [y, z, x0, x1] of part.runs ?? []) for (let x = x0; x <= x1; x++) out.push([x, y, z]);
      for (const [x0, y0, z0, x1, y1, z1] of part.boxes ?? []) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z]);
      for (const [x, y, z] of part.voxels ?? []) out.push([x, y, z]);
      return out;
    };
    const cells = new Map(catalogParts.map((part) => [part.id, cellsOf(part)]));
    const largest = Math.max(...[...cells.values()].map((list) => list.length));
    const threshold = Math.max(2, Math.floor(largest * foldFragments));
    const owner = new Map();
    for (const [id, list] of cells) for (const [x, y, z] of list) owner.set(`${x},${y},${z}`, id);
    const byId = new Map(catalogParts.map((part) => [part.id, part]));
    const fragments = catalogParts.filter((part) => cells.get(part.id).length > 0 && cells.get(part.id).length <= threshold).sort((a, b) => cells.get(a.id).length - cells.get(b.id).length);
    const alias = new Map();
    const resolve = (id) => { while (alias.has(id)) id = alias.get(id); return id; };
    const sortRuns = (runs) => runs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
    let mergedParts = 0, mergedCells = 0, dropped = 0, droppedCells = 0;
    for (const fragment of fragments) {
      const touch = new Map();
      for (const [x, y, z] of cells.get(fragment.id)) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const found = owner.get(`${x + dx},${y + dy},${z + dz}`);
          if (!found) continue;
          const resolved = resolve(found);
          if (resolved === fragment.id) continue;
          touch.set(resolved, (touch.get(resolved) ?? 0) + 1);
        }
      }
      let best = null;
      for (const [id, n] of touch) if (!best || n > best.n || (n === best.n && id < best.id)) best = { id, n };
      const newParent = best ? best.id : fragment.parent;
      for (const part of catalogParts) if (part.parent === fragment.id) part.parent = newParent;
      if (best) {
        const target = byId.get(best.id);
        if (target.parent === fragment.id) target.parent = fragment.parent;
        if (fragment.runs?.length) target.runs = sortRuns([...(target.runs ?? []), ...fragment.runs]);
        if (fragment.boxes?.length) target.boxes = [...(target.boxes ?? []), ...fragment.boxes];
        if (fragment.voxels?.length) target.voxels = [...(target.voxels ?? []), ...fragment.voxels];
        alias.set(fragment.id, best.id);
        mergedParts++; mergedCells += cells.get(fragment.id).length;
      } else { dropped++; droppedCells += cells.get(fragment.id).length; }
      catalogParts.splice(catalogParts.indexOf(fragment), 1);
      byId.delete(fragment.id);
    }
    for (const part of catalogParts) if (part.parent && !byId.has(part.parent)) delete part.parent;
    // Pieces that ended up with no voxels of their own (fully covered by finer
    // pieces) and nothing hanging off them are noise too.
    for (const part of [...catalogParts]) {
      if (cells.get(part.id).length === 0 && !catalogParts.some((other) => other.parent === part.id) && catalogParts.length > 1) { catalogParts.splice(catalogParts.indexOf(part), 1); byId.delete(part.id); dropped++; }
    }
    console.log(`  fold: ${mergedParts} fragment part(s) (${mergedCells} voxels) joined the parts they touch, ${dropped} floating (${droppedCells} voxels) dropped — threshold ${threshold} voxels (${Math.round(foldFragments * 1000) / 10}% of the largest part); ${catalogParts.length} part(s) remain`);
  }

  // Explicit art override: remap palette colors near `from` to `to`.
  if (recolorOption) {
    for (const pair of recolorOption.split(",")) {
      const [from, to] = pair.split(">").map((v) => v.trim());
      if (!/^#[0-9a-f]{6}$/i.test(from ?? "") || !/^#[0-9a-f]{6}$/i.test(to ?? "")) throw new Error(`--recolor expects '#from>#to', got '${pair}'`);
      const fromLab = hexToOklab(from);
      const hits = [];
      for (const [key, hex] of Object.entries(palette)) {
        if (oklabDistance(hexToOklab(hex), fromLab) <= recolorTolerance) {
          palette[key] = to.toLowerCase();
          hits.push(hex);
        }
      }
      console.log(`  art: --recolor ${from} -> ${to}: ${hits.length} palette color(s) [${hits.join(", ")}]`);
    }
  }

  // Exact world scale: the source height maps to worldHeight, so models
  // converted at one shared --pitch keep identical proportions in the game
  // even when coarse blocks round their grids up differently.
  const pitch = grid.modelHeight ? grid.finePitch * (worldHeight / grid.modelHeight) : worldHeight / sizeY;
  model = {
    id: modelId,
    pitch: Number(pitch.toFixed(6)),
    palette,
    parts: catalogParts,
  };
} else {
  // Legacy colorless grid: anatomy banding with deterministic two-tone shading.
  const headStart = Math.floor(sizeY * (1 - headFraction));
  const palette = {
    aw: "#f2e6bc", // awn / pale tip
    hd: "#e8cf8e", // ripe head
    hd2: "#dfc178", // ripe head, shaded
    st: "#d9b95c", // straw stem
    st2: "#c4a24a", // straw stem, shaded
    gr: "#8a9a4a", // dried green fleck
  };
  const shade = (x, y, z) => Math.abs(((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) % 100);
  const colorFor = (x, y, z) => {
    const h = shade(x, y, z);
    if (y >= headStart) {
      if (y >= sizeY - 2 || h < 8) return "aw";
      return h < 52 ? "hd" : "hd2";
    }
    if (h < 6) return "gr";
    const baseBias = y < sizeY * 0.3 ? 22 : 0; // stems darken toward the base
    return h < 44 + baseBias ? "st" : "st2";
  };
  const partIds = partsOption ? partsOption.split(",").map((part) => part.trim()) : ["stems", "heads"];
  const cellsByPart = new Map(partIds.map((part) => [part, []]));
  for (const [x, y, z] of grid.indices) {
    const part = partsOption ? partIds[0] : y >= headStart ? partIds[1] : partIds[0];
    cellsByPart.get(part).push([x, y, z, colorFor(x, y, z)]);
  }
  model = {
    id: modelId,
    pitch: Number((worldHeight / sizeY).toFixed(5)),
    palette,
    parts: partIds.map((part) => ({ id: part, pivot: [0, 0, 0], runs: runsFromCells(cellsByPart.get(part)) })),
  };
}

// Re-emitting keeps the model in its folder (and display name) — only the voxels change.
const previous = readCatalog().models[modelId];
if (previous?.folder) model.folder = previous.folder;
if (previous?.name) model.name = previous.name;
writeModel(model);

const runCount = model.parts.reduce((sum, part) => sum + (part.runs?.length ?? 0), 0);
const boxCount = model.parts.reduce((sum, part) => sum + (part.boxes?.length ?? 0), 0);
const voxelCount = model.parts.reduce((sum, part) => sum + (part.voxels?.length ?? 0), 0);
console.log(`${modelId}: ${grid.count} voxels -> ${runCount} runs + ${boxCount} boxes${voxelCount ? ` + ${voxelCount} split cells` : ""} in ${model.parts.length} part(s) [${model.parts.map((p) => p.id).join(", ")}], fine grid ${sizeX}x${sizeY}x${sizeZ}, pitch ${model.pitch}, palette ${Object.keys(model.palette).length} colors`);
