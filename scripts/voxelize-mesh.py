#!/usr/bin/env python3
"""Universal mesh -> voxel converter (any trimesh-loadable model: .glb/.gltf/.obj).

Writes a `.vox.json` (format version 2) that `scripts/voxels-to-model.mjs`
turns into an authored catalog model. The converter is OBJECT-AGNOSTIC: it
knows nothing about what the model is. Everything it emits comes from the
source file itself:

  * OBJECT PARTS  - every scene node -> primitive -> connected component (by
                    vertex POSITION, so UV seams never split an object) is one
                    part. Kitbashed packs (a stake, each leaf, each fruit) fall
                    apart into their real pieces automatically.
  * COLOR         - deterministic surface sampling (a barycentric lattice per
                    triangle, no RNG), bilinear texture lookup in the glTF
                    convention (trimesh flips V to bottom-left on load, so the
                    atlas row is (1 - v) * H), sampler wrap mode honoured,
                    baseColorFactor and COLOR_0 multiplied in, alpha cut-outs
                    dropped. Each voxel keeps the LINEAR-light mean of the
                    samples that landed in it; each part then reduces its voxel
                    colors to a few SHADES (farthest-point k-means in Oklab, a
                    perceptual space) so material differences inside a part
                    survive while texture noise does not. All shades share one
                    deduplicated palette.
  * DETAIL (LOD)  - every part gets its own voxel pitch from its VERTEX DENSITY
                    (vertices per surface area, relative to the whole model):
                    a knob area with many small triangles is voxelized finer
                    than the plain box body next to it. Legibility guards keep
                    small parts from vanishing at a coarse pitch. All pitches
                    are power-of-two multiples of one fine lattice, so coarse
                    voxels are exact blocks of fine cells.

Art direction (recoloring, game palettes) is NOT done here — it belongs to
explicit flags on voxels-to-model.mjs, visible on the command line.

Usage:
  python3 scripts/voxelize-mesh.py <model.glb|.gltf|.obj> <out.vox.json> [options]

Options:
  --geometry NAME[,NAME..]  only nodes/geometries whose name contains NAME
                            (case-insensitive). Default: every geometry node.
  --height N                model height in BASE-pitch voxels (default 48).
  --pitch F                 base pitch in model units (overrides --height; use
                            it so several models share one voxel size).
  --lod auto|off            per-part adaptive pitch (default auto).
  --lodLevels a,b,c         pitch multipliers relative to base, coarse..fine
                            (default 2,1,0.5). Must be powers of two.
  --lodThreshold F          log2 vertex-density ratio (part vs whole model)
                            beyond which a part leaves the base level: >= +F
                            goes finest, <= -F goes coarsest (default 1.5).
  --minPartVoxels N         a part must span at least N voxels along its
                            longest axis; coarser levels that break this are
                            skipped (default 6).
  --shadeTolerance F        Oklab distance below which two voxel colors are the
                            same shade (default 0.07; ~0.02 is barely visible).
  --maxShades N             max shades per part (default 4; 1 = flat parts).
  --flatten F               0..1, pull each part's shade lightness toward the
                            part mean (0 = faithful, 1 = one lightness).
  --paletteTolerance F      Oklab distance for merging shades across parts into
                            one palette entry (default 0.025).
  --denoise N               majority-filter passes per part: a voxel adopts the
                            shade that clearly dominates its 26 neighbours
                            (default 1; 0 keeps raw per-voxel shades).
"""
import json
import math
import re
import struct
import sys

import numpy
import trimesh

# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------
if len(sys.argv) < 3:
    raise SystemExit(__doc__)
input_path, out_path = sys.argv[1], sys.argv[2]
options = {
    "geometry": None, "height": 48, "pitch": None, "lod": "auto", "lodLevels": "2,1,0.5", "lodThreshold": 1.5, "minPartVoxels": 6,
    "shadeTolerance": 0.07, "maxShades": 4, "flatten": 0.0, "paletteTolerance": 0.025, "denoise": 1,
}
args = sys.argv[3:]
i = 0
while i < len(args):
    arg = args[i]
    if arg.startswith("--"):
        key = arg[2:]
        if key not in options:
            raise SystemExit(f"unknown option {arg}\n{__doc__}")
        if i + 1 >= len(args):
            raise SystemExit(f"{arg} needs a value")
        options[key] = args[i + 1]
        i += 2
    elif arg.isdigit():  # legacy positional height
        options["height"] = arg
        i += 1
    else:
        raise SystemExit(f"unexpected argument {arg}")
target_height = int(options["height"])
lod_levels = sorted({float(v) for v in str(options["lodLevels"]).split(",")}, reverse=True)
if options["lod"] == "off":
    lod_levels = [1.0]
for level in lod_levels:
    if not math.log2(level).is_integer():
        raise SystemExit(f"--lodLevels must be powers of two, got {level}")
fine_level = min(lod_levels)
min_part_voxels = int(options["minPartVoxels"])
lod_threshold = float(options["lodThreshold"])
shade_tolerance = float(options["shadeTolerance"])
max_shades = max(1, int(options["maxShades"]))
flatten = min(1.0, max(0.0, float(options["flatten"])))
palette_tolerance = float(options["paletteTolerance"])
denoise_passes = max(0, int(options["denoise"]))
name_filters = [f.strip().lower() for f in str(options["geometry"]).split(",") if f.strip()] if options["geometry"] else []

# ----------------------------------------------------------------------------
# Color math: sRGB <-> linear, linear -> Oklab (perceptual) and back.
# ----------------------------------------------------------------------------
def srgb_to_linear(c):
    c = numpy.asarray(c, dtype=numpy.float64)
    return numpy.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = numpy.clip(numpy.asarray(c, dtype=numpy.float64), 0, 1)
    return numpy.where(c <= 0.0031308, c * 12.92, 1.055 * numpy.power(c, 1 / 2.4) - 0.055)


def linear_to_oklab(rgb):
    rgb = numpy.asarray(rgb, dtype=numpy.float64)
    l = 0.4122214708 * rgb[..., 0] + 0.5363325363 * rgb[..., 1] + 0.0514459929 * rgb[..., 2]
    m = 0.2119034982 * rgb[..., 0] + 0.6806995451 * rgb[..., 1] + 0.1073969566 * rgb[..., 2]
    s = 0.0883024619 * rgb[..., 0] + 0.2817188376 * rgb[..., 1] + 0.6299787005 * rgb[..., 2]
    l, m, s = numpy.cbrt(l), numpy.cbrt(m), numpy.cbrt(s)
    return numpy.stack([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ], axis=-1)


def oklab_to_linear(lab):
    lab = numpy.asarray(lab, dtype=numpy.float64)
    l = lab[..., 0] + 0.3963377774 * lab[..., 1] + 0.2158037573 * lab[..., 2]
    m = lab[..., 0] - 0.1055613458 * lab[..., 1] - 0.0638541728 * lab[..., 2]
    s = lab[..., 0] - 0.0894841775 * lab[..., 1] - 1.2914855480 * lab[..., 2]
    l, m, s = l ** 3, m ** 3, s ** 3
    return numpy.stack([
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ], axis=-1)


def to_hex(linear_rgb):
    srgb = numpy.round(linear_to_srgb(linear_rgb) * 255).astype(int)
    return "#" + "".join(f"{int(v):02x}" for v in srgb)


# ----------------------------------------------------------------------------
# Load the scene. glTF sampler wrap modes are not exposed by trimesh, so read
# them straight from the file's JSON chunk (best effort; default REPEAT).
# ----------------------------------------------------------------------------
REPEAT, CLAMP, MIRROR = 10497, 33071, 33648


def read_gltf_json(path):
    try:
        if path.lower().endswith(".glb"):
            data = open(path, "rb").read()
            json_length = struct.unpack_from("<I", data, 12)[0]
            return json.loads(data[20:20 + json_length])
        if path.lower().endswith(".gltf"):
            return json.load(open(path))
    except Exception:  # noqa: BLE001 - metadata only, never fatal
        return None
    return None


gltf_json = read_gltf_json(input_path)


def wrap_modes_for_material(material_name):
    if not gltf_json:
        return REPEAT, REPEAT
    for material in gltf_json.get("materials", []):
        if material.get("name") != material_name:
            continue
        texture_info = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
        if not texture_info:
            return REPEAT, REPEAT
        texture = gltf_json.get("textures", [])[texture_info["index"]]
        sampler_index = texture.get("sampler")
        if sampler_index is None:
            return REPEAT, REPEAT
        sampler = gltf_json.get("samplers", [])[sampler_index]
        return sampler.get("wrapS", REPEAT), sampler.get("wrapT", REPEAT)
    return REPEAT, REPEAT


loaded = trimesh.load(input_path, process=False)
if isinstance(loaded, trimesh.Trimesh):
    scene = trimesh.Scene(loaded)
else:
    scene = loaded

# Node hierarchy from the file: nearest ANCESTOR that carries geometry, so a
# "Microwave > Door > Knob" tree survives into parts (empty group nodes are
# skipped over). Carried through as part.parentNode for the emitter.
node_parent = {}
try:
    node_parent = dict(scene.graph.transforms.parents)
except Exception:  # noqa: BLE001 - older trimesh without a parents map
    node_parent = {}
geometry_nodes = set(scene.graph.nodes_geometry)


def geometry_ancestor(node_name):
    cursor = node_parent.get(node_name)
    while cursor is not None:
        if cursor in geometry_nodes:
            return cursor
        cursor = node_parent.get(cursor)
    return None


# Every geometry node instance, with its WORLD transform applied.
instances = []  # (node_name, geometry_name, Trimesh with world-space vertices)
for node_name in scene.graph.nodes_geometry:
    matrix, geometry_name = scene.graph[node_name]
    geometry = scene.geometry[geometry_name]
    if not isinstance(geometry, trimesh.Trimesh) or len(geometry.faces) == 0:
        continue
    haystack = f"{node_name} {geometry_name}".lower()
    if name_filters and not any(f in haystack for f in name_filters):
        continue
    mesh = geometry.copy()
    mesh.apply_transform(matrix)
    instances.append((node_name, geometry_name, mesh))
if not instances:
    raise SystemExit(f"{input_path}: no geometry matched {name_filters or 'anything'}. Nodes: {list(scene.graph.nodes_geometry)}")

# ----------------------------------------------------------------------------
# Material -> a sampler callable: (uv, barycentric vertex colors) -> linear RGBA
# ----------------------------------------------------------------------------
def make_color_source(mesh, material_name_hint):
    visual = mesh.visual
    material = getattr(visual, "material", None)
    factor = numpy.array([1.0, 1.0, 1.0, 1.0])
    texture = None
    alpha_mode, alpha_cutoff = "OPAQUE", 0.5
    if material is not None:
        base_factor = getattr(material, "baseColorFactor", None)
        if base_factor is None and hasattr(material, "diffuse"):  # SimpleMaterial (.obj)
            base_factor = material.diffuse
        if base_factor is not None:
            base_factor = numpy.asarray(base_factor, dtype=numpy.float64)
            if base_factor.max() > 1.0:
                base_factor = base_factor / 255.0
            if len(base_factor) == 3:
                base_factor = numpy.append(base_factor, 1.0)
            factor = numpy.concatenate([srgb_to_linear(base_factor[:3]), base_factor[3:4]])
        image = getattr(material, "baseColorTexture", None)
        if image is None and hasattr(material, "image"):
            image = material.image
        if image is not None:
            texture = numpy.asarray(image.convert("RGBA"), dtype=numpy.float64) / 255.0
            texture = numpy.concatenate([srgb_to_linear(texture[..., :3]), texture[..., 3:4]], axis=-1)
        alpha_mode = getattr(material, "alphaMode", None) or "OPAQUE"
        alpha_cutoff = getattr(material, "alphaCutoff", None) or 0.5
    wrap_s, wrap_t = wrap_modes_for_material(getattr(material, "name", material_name_hint))
    uv = numpy.asarray(visual.uv) if getattr(visual, "uv", None) is not None and texture is not None else None
    if uv is not None and len(uv) != len(mesh.vertices):
        uv = None
    vertex_colors = None
    if getattr(visual, "kind", None) == "vertex":
        vertex_colors = numpy.asarray(visual.vertex_colors, dtype=numpy.float64) / 255.0
    else:
        attribute = getattr(visual, "vertex_attributes", {}).get("color") if hasattr(visual, "vertex_attributes") else None
        if attribute is not None and len(attribute) == len(mesh.vertices):
            vertex_colors = numpy.asarray(attribute, dtype=numpy.float64)
            if vertex_colors.max() > 1.0:
                vertex_colors = vertex_colors / 255.0
    if vertex_colors is not None:
        if vertex_colors.shape[1] == 3:
            vertex_colors = numpy.concatenate([vertex_colors, numpy.ones((len(vertex_colors), 1))], axis=1)
        vertex_colors = numpy.concatenate([srgb_to_linear(vertex_colors[:, :3]), vertex_colors[:, 3:4]], axis=1)

    def wrap(coord, size, mode):
        if mode == CLAMP:
            return numpy.clip(coord, 0, size - 1)
        if mode == MIRROR:
            period = 2 * size
            coord = numpy.mod(coord, period)
            return numpy.where(coord >= size, period - 1 - coord, coord)
        return numpy.mod(coord, size)

    def sample(faces, bary):
        """faces: (n,3) vertex ids; bary: (n,3). Returns (n,4) linear RGBA."""
        count = len(faces)
        rgba = numpy.tile(factor, (count, 1))
        if texture is not None and uv is not None:
            sample_uv = (uv[faces[:, 0]] * bary[:, 0:1] + uv[faces[:, 1]] * bary[:, 1:2] + uv[faces[:, 2]] * bary[:, 2:3])
            height, width = texture.shape[:2]
            # trimesh stores V bottom-up; the atlas is stored top-down.
            fx = sample_uv[:, 0] * width - 0.5
            fy = (1.0 - sample_uv[:, 1]) * height - 0.5
            x0 = numpy.floor(fx).astype(numpy.int64)
            y0 = numpy.floor(fy).astype(numpy.int64)
            tx = (fx - x0)[:, None]
            ty = (fy - y0)[:, None]
            xa, xb = wrap(x0, width, wrap_s), wrap(x0 + 1, width, wrap_s)
            ya, yb = wrap(y0, height, wrap_t), wrap(y0 + 1, height, wrap_t)
            texel = (texture[ya, xa] * (1 - tx) * (1 - ty) + texture[ya, xb] * tx * (1 - ty)
                     + texture[yb, xa] * (1 - tx) * ty + texture[yb, xb] * tx * ty)
            rgba = rgba * texel
        if vertex_colors is not None:
            rgba = rgba * (vertex_colors[faces[:, 0]] * bary[:, 0:1] + vertex_colors[faces[:, 1]] * bary[:, 1:2]
                           + vertex_colors[faces[:, 2]] * bary[:, 2:3])
        return rgba

    return sample, alpha_mode, alpha_cutoff, texture is not None


# ----------------------------------------------------------------------------
# Parts: connected components by vertex POSITION within each node instance.
# ----------------------------------------------------------------------------
parts = []  # dicts: name, mesh (shared), face_ids, sampler, alpha, vertices, area, extents
all_vertices = numpy.concatenate([mesh.vertices for _, _, mesh in instances])
model_extent = float(numpy.max(all_vertices.max(axis=0) - all_vertices.min(axis=0)))
weld_digits = max(3, int(-math.log10(max(model_extent, 1e-9) * 1e-6)))
for node_name, geometry_name, mesh in instances:
    sampler, alpha_mode, alpha_cutoff, textured = make_color_source(mesh, geometry_name)
    faces = numpy.asarray(mesh.faces)
    _, inverse = trimesh.grouping.unique_rows(numpy.round(mesh.vertices, weld_digits))
    welded = inverse[faces]
    edges = numpy.concatenate([welded[:, [0, 1]], welded[:, [1, 2]], welded[:, [2, 0]]])
    components = trimesh.graph.connected_components(edges, nodes=numpy.arange(int(inverse.max()) + 1), min_len=1)
    vertex_component = numpy.full(int(inverse.max()) + 1, -1, dtype=numpy.int64)
    for component_id, members in enumerate(components):
        vertex_component[members] = component_id
    face_component = vertex_component[welded[:, 0]]
    face_area = numpy.asarray(mesh.area_faces)
    for component_id in range(len(components)):
        face_ids = numpy.nonzero((face_component == component_id) & (face_area > 0))[0]
        if len(face_ids) == 0:
            continue
        vertex_ids = numpy.unique(welded[face_ids])
        points = mesh.vertices[numpy.unique(faces[face_ids])]
        # Principal extents (PCA) so a tilted leaf's thickness is measured
        # across the leaf, not across its world-axis bounding box.
        centered = points - points.mean(axis=0)
        if len(points) >= 3:
            _, _, axes = numpy.linalg.svd(centered, full_matrices=False)
            projected = centered @ axes.T
            extents = numpy.sort(projected.max(axis=0) - projected.min(axis=0))[::-1]
        else:
            extents = numpy.sort(points.max(axis=0) - points.min(axis=0))[::-1]
        parts.append({
            "name": f"{node_name}#{component_id}" if len(components) > 1 else node_name,
            "node": node_name, "parent_node": geometry_ancestor(node_name),
            "mesh": mesh, "face_ids": face_ids, "sampler": sampler, "alpha_mode": alpha_mode,
            "alpha_cutoff": alpha_cutoff, "textured": textured,
            "vertices": int(len(vertex_ids)), "area": float(face_area[face_ids].sum()), "extents": extents,
        })
if not parts:
    raise SystemExit("no non-degenerate parts found")

# ----------------------------------------------------------------------------
# Lattice geometry: base pitch from the model height, fine lattice shared by all.
# ----------------------------------------------------------------------------
bounds_min = all_vertices.min(axis=0)
bounds_max = all_vertices.max(axis=0)
model_height = float(bounds_max[1] - bounds_min[1])
base_pitch = float(options["pitch"]) if options["pitch"] is not None else model_height / target_height
fine_pitch = base_pitch * fine_level
origin = bounds_min.copy()

# ----------------------------------------------------------------------------
# LOD: vertex density relative to the whole model picks each part's level.
# ----------------------------------------------------------------------------
total_area = sum(p["area"] for p in parts)
total_vertices = sum(p["vertices"] for p in parts)
model_density = total_vertices / max(total_area, 1e-12)
for part in parts:
    density = part["vertices"] / max(part["area"], 1e-12)
    ratio = math.log2(max(density, 1e-12) / max(model_density, 1e-12))
    part["density_ratio"] = ratio
    if len(lod_levels) == 1:
        wanted = lod_levels[0]
    else:
        # Much denser than the model -> finest level; much sparser ->
        # coarsest; in between -> the middle of the ladder (base pitch).
        if ratio >= lod_threshold:
            wanted = lod_levels[-1]
        elif ratio <= -lod_threshold:
            wanted = lod_levels[0]
        else:
            wanted = lod_levels[len(lod_levels) // 2]
    # Legibility guard: never a level so coarse that the part's longest
    # axis spans fewer than --minPartVoxels voxels.
    level = wanted
    while level > fine_level and part["extents"][0] / (base_pitch * level) < min_part_voxels:
        finer = [l for l in lod_levels if l < level]
        level = max(finer)
    part["level"] = level
    part["pitch"] = base_pitch * level
    # Surface voxelization touches ~1.4 voxels per pitch^2 of area on average.
    part["estimated_voxels"] = int(round(part["area"] / (part["pitch"] ** 2) * 1.4))

# The shared fine lattice is the finest level actually USED, so an unused fine
# level never doubles every coordinate (and every coarse block's cell count).
fine_level = min(part["level"] for part in parts)
fine_pitch = base_pitch * fine_level
for part in parts:
    part["scale"] = int(round(part["level"] / fine_level))  # fine cells per voxel

# ----------------------------------------------------------------------------
# Deterministic surface sampling. Each triangle gets a barycentric lattice with
# spacing <= pitch/2 along its longest edge, so every voxel it crosses gets
# several samples. No random numbers anywhere: same input, same output.
# ----------------------------------------------------------------------------
MAX_SAMPLES_PER_BATCH = 3_000_000
lattice_cache = {}


def lattice(n):
    if n not in lattice_cache:
        ii, jj = numpy.meshgrid(numpy.arange(n + 1), numpy.arange(n + 1), indexing="ij")
        keep = ii + jj <= n
        a = ii[keep] / n
        b = jj[keep] / n
        lattice_cache[n] = numpy.stack([1 - a - b, a, b], axis=1)
    return lattice_cache[n]


def sample_part(part):
    mesh = part["mesh"]
    faces = numpy.asarray(mesh.faces)[part["face_ids"]]
    triangles = mesh.vertices[faces]  # (m,3,3)
    edge_lengths = numpy.stack([
        numpy.linalg.norm(triangles[:, 0] - triangles[:, 1], axis=1),
        numpy.linalg.norm(triangles[:, 1] - triangles[:, 2], axis=1),
        numpy.linalg.norm(triangles[:, 2] - triangles[:, 0], axis=1),
    ], axis=1).max(axis=1)
    n_per_edge = numpy.clip(numpy.ceil(edge_lengths / (part["pitch"] * 0.5)).astype(numpy.int64), 1, 1500)
    scale = part["scale"]
    voxel_pitch = part["pitch"]
    sums = {}
    for n in numpy.unique(n_per_edge):
        bary = lattice(int(n))  # (k,3)
        indices = numpy.nonzero(n_per_edge == n)[0]
        per_triangle = len(bary)
        batch = max(1, MAX_SAMPLES_PER_BATCH // per_triangle)
        for start in range(0, len(indices), batch):
            chosen = indices[start:start + batch]
            tri = triangles[chosen]  # (m,3,3)
            points = numpy.einsum("kj,mjd->mkd", bary, tri).reshape(-1, 3)
            face_rows = numpy.repeat(faces[chosen], per_triangle, axis=0)
            bary_rows = numpy.tile(bary, (len(chosen), 1))
            rgba = part["sampler"](face_rows, bary_rows)
            if part["alpha_mode"] in ("MASK", "BLEND"):
                keep = rgba[:, 3] >= (part["alpha_cutoff"] if part["alpha_mode"] == "MASK" else 0.5)
                points, rgba = points[keep], rgba[keep]
            if len(points) == 0:
                continue
            cell = numpy.floor((points - origin) / voxel_pitch).astype(numpy.int64)
            cell = numpy.maximum(cell, 0) * scale  # origin of the block in fine cells
            key = (cell[:, 0].astype(numpy.int64) << 42) | (cell[:, 1].astype(numpy.int64) << 21) | cell[:, 2].astype(numpy.int64)
            unique, inverse = numpy.unique(key, return_inverse=True)
            color_sum = numpy.zeros((len(unique), 3))
            numpy.add.at(color_sum, inverse, rgba[:, :3])
            count = numpy.bincount(inverse, minlength=len(unique)).astype(numpy.float64)
            for k, c, w in zip(unique.tolist(), color_sum, count):
                entry = sums.get(k)
                if entry is None:
                    sums[k] = [c, w]
                else:
                    entry[0] = entry[0] + c
                    entry[1] += w
    keys = numpy.array(sorted(sums.keys()), dtype=numpy.int64)
    if len(keys) == 0:
        return numpy.zeros((0, 3), dtype=numpy.int64), numpy.zeros((0, 3)), numpy.zeros(0)
    colors = numpy.array([sums[k][0] / sums[k][1] for k in keys.tolist()])
    weights = numpy.array([sums[k][1] for k in keys.tolist()])
    cells = numpy.stack([keys >> 42, (keys >> 21) & ((1 << 21) - 1), keys & ((1 << 21) - 1)], axis=1)
    return cells, colors, weights


# ----------------------------------------------------------------------------
# Shades per part: farthest-point k-means in Oklab, capped at --maxShades and
# stopping once every voxel is within --shadeTolerance of its shade.
# ----------------------------------------------------------------------------
def cluster_shades(lab, weights, tolerance, max_count):
    total = weights.sum()
    centers = [numpy.average(lab, axis=0, weights=weights)]
    assignment = numpy.zeros(len(lab), dtype=numpy.int64)
    for _ in range(max_count):
        distances = numpy.linalg.norm(lab - numpy.array(centers)[assignment], axis=1)
        farthest = int(numpy.argmax(distances * (weights > 0)))
        if distances[farthest] <= tolerance or len(centers) >= max_count:
            break
        centers.append(lab[farthest].copy())
        for _ in range(8):  # Lloyd iterations
            center_array = numpy.array(centers)
            assignment = numpy.argmin(((lab[:, None, :] - center_array[None, :, :]) ** 2).sum(axis=2), axis=1)
            for c in range(len(centers)):
                mask = assignment == c
                if mask.any():
                    centers[c] = numpy.average(lab[mask], axis=0, weights=weights[mask])
    center_array = numpy.array(centers)
    assignment = numpy.argmin(((lab[:, None, :] - center_array[None, :, :]) ** 2).sum(axis=2), axis=1)
    # Drop empty shades (can happen after the final reassignment).
    used = numpy.unique(assignment)
    remap = {old: new for new, old in enumerate(used.tolist())}
    center_array = center_array[used]
    assignment = numpy.array([remap[a] for a in assignment.tolist()])
    shade_weights = numpy.array([weights[assignment == c].sum() for c in range(len(center_array))])
    if flatten > 0 and len(center_array) > 1:
        mean_l = numpy.average(center_array[:, 0], weights=shade_weights)
        center_array[:, 0] = mean_l + (center_array[:, 0] - mean_l) * (1 - flatten)
    return center_array, assignment, shade_weights, total


# ----------------------------------------------------------------------------
# Denoise: within one part, a voxel whose shade is clearly outvoted by its 26
# neighbours takes the winning shade. Texture gradients quantized to a few
# shades leave a dithered speckle right at the threshold; this removes it
# while contiguous regions (a lighter petal, a calyx) keep their shade.
# ----------------------------------------------------------------------------
NEIGHBOURS = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]


def denoise(lattice_cells, assignment, passes):
    if passes <= 0 or len(assignment) < 8:
        return assignment
    index = {tuple(c): i for i, c in enumerate(lattice_cells.tolist())}
    cells_list = lattice_cells.tolist()
    for _ in range(passes):
        updated = assignment.copy()
        for i, (x, y, z) in enumerate(cells_list):
            counts = {}
            for dx, dy, dz in NEIGHBOURS:
                j = index.get((x + dx, y + dy, z + dz))
                if j is not None:
                    counts[assignment[j]] = counts.get(assignment[j], 0) + 1
            own = assignment[i]
            own_votes = counts.get(own, 0) + 1
            best_shade, best_votes = own, own_votes
            for shade, votes in sorted(counts.items()):
                if votes > best_votes:
                    best_shade, best_votes = shade, votes
            updated[i] = best_shade
        assignment = updated
    return assignment


# ----------------------------------------------------------------------------
# Run it.
# ----------------------------------------------------------------------------
palette_lab = []      # merged palette centers (Oklab)
palette_weight = []
part_outputs = []
grid_max = numpy.zeros(3, dtype=numpy.int64)
total_voxels = 0
print(f"{input_path}: {len(instances)} node(s), {len(parts)} part(s); height {model_height:.4f} -> base pitch {base_pitch:.5f}, fine pitch {fine_pitch:.5f}, levels {lod_levels}")
print(f"{'part':<44} {'verts':>6} {'area':>9} {'dens':>6} {'lvl':>4} {'est':>7} {'voxels':>7} shades")
for part_index, part in enumerate(parts):
    cells, colors, weights = sample_part(part)
    if len(cells) == 0:
        continue
    lab = linear_to_oklab(colors)
    shade_lab, assignment, shade_weights, _ = cluster_shades(lab, weights, shade_tolerance, max_shades)
    assignment = denoise(cells // part["scale"], assignment, denoise_passes)
    shade_weights = numpy.array([weights[assignment == c].sum() for c in range(len(shade_lab))])
    # Merge each shade into the shared palette (heaviest first for stability).
    shade_to_palette = {}
    for shade_index in numpy.argsort(-shade_weights, kind="stable").tolist():
        center = shade_lab[shade_index]
        best, best_distance = -1, palette_tolerance
        for palette_index, existing in enumerate(palette_lab):
            distance = float(numpy.linalg.norm(existing - center))
            if distance <= best_distance:
                best, best_distance = palette_index, distance
        if best < 0:
            palette_lab.append(center.copy())
            palette_weight.append(float(shade_weights[shade_index]))
            best = len(palette_lab) - 1
        else:
            # Weighted pull toward the newcomer keeps the entry representative.
            w_old, w_new = palette_weight[best], float(shade_weights[shade_index])
            palette_lab[best] = (palette_lab[best] * w_old + center * w_new) / max(w_old + w_new, 1e-12)
            palette_weight[best] = w_old + w_new
        shade_to_palette[shade_index] = best
    palette_index = numpy.array([shade_to_palette[a] for a in assignment.tolist()], dtype=numpy.int64)
    grid_max = numpy.maximum(grid_max, cells.max(axis=0) + part["scale"] - 1)
    total_voxels += len(cells)
    part_outputs.append({
        "id": part_index,
        "name": part["name"],
        "node": part["node"],
        "parentNode": part["parent_node"],
        "scale": part["scale"],
        "pitch": part["pitch"],
        "vertices": part["vertices"],
        "area": part["area"],
        "densityRatio": round(part["density_ratio"], 3),
        "cells": numpy.concatenate([cells, palette_index[:, None]], axis=1).tolist(),
    })
    shades = ", ".join(to_hex(oklab_to_linear(s)) for s in shade_lab)
    print(f"{part['name'][:44]:<44} {part['vertices']:>6} {part['area']:>9.5f} {part['density_ratio']:>+6.2f} {part['level']:>4g} {part['estimated_voxels']:>7} {len(cells):>7} {shades}")

# Coarse parts first: the catalog loader lets later entries repaint earlier
# cells, so fine detail wins wherever a coarse block and fine cells overlap.
part_outputs.sort(key=lambda p: (-p["scale"], p["id"]))
palette_hex = [to_hex(oklab_to_linear(lab)) for lab in palette_lab]

data = {
    "version": 2,
    "source": input_path + (f"#{options['geometry']}" if options["geometry"] else ""),
    "basePitch": base_pitch,
    "finePitch": fine_pitch,
    "modelHeight": model_height,
    "worldPitch": fine_pitch,
    "size": [int(v) for v in grid_max + 1],
    "count": int(total_voxels),
    "palette": palette_hex,
    "options": {k: options[k] for k in options},
    "parts": part_outputs,
}
with open(out_path, "w") as handle:
    json.dump(data, handle)
hierarchy_links = sum(1 for p in part_outputs if p["parentNode"])
print(f"-> {out_path}: {total_voxels} voxels over {len(part_outputs)} parts, fine grid {data['size']}, palette {len(palette_hex)} colors"
      + (f", {hierarchy_links} part(s) carry a parent node from the file" if hierarchy_links else ", flat node tree (no hierarchy in the file)"))
