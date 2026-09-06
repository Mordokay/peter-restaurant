#!/usr/bin/env python3
"""Contact sheet of every object in a .glb — a quick look at a pack BEFORE converting it,
so anonymous meshes ("Cube.001", "Material2") can be named by eye in the import report.

Each object (meshes grouped by the same label rule as inspect-mesh.py, or one cell per
mesh with --perMesh) is drawn with a tiny software rasteriser: orthographic 3/4 view,
flat shading from the face normal, painter's sort, colour from the material's base
colour factor or the mean of its base-colour texture. Not pretty; enough to tell an
apple from a pear and a chair from a crate.

Usage: python3 scripts/contact-sheet.py file.glb out.png [--cell 160] [--cols 8] [--perMesh]
       [--labels labels.json]   (labels.json: {node_name: label} from inspect-mesh output)
"""
import json
import math
import sys

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
options = {"cell": 160, "cols": 8, "perMesh": False, "labels": None}
positional = []
i = 0
while i < len(args):
    a = args[i]
    if a == "--cell": options["cell"] = int(args[i + 1]); i += 2
    elif a == "--cols": options["cols"] = int(args[i + 1]); i += 2
    elif a == "--perMesh": options["perMesh"] = True; i += 1
    elif a == "--labels": options["labels"] = args[i + 1]; i += 2
    else: positional.append(a); i += 1
path, out = positional[0], positional[1]
labels = json.load(open(options["labels"])) if options["labels"] else {}

scene = trimesh.load(path, force="scene")


def base_colour(geometry):
    material = getattr(getattr(geometry, "visual", None), "material", None)
    try:
        image = getattr(material, "baseColorTexture", None)
        if image is not None:
            small = image.convert("RGB").resize((16, 16))
            arr = np.asarray(small, dtype=np.float32).reshape(-1, 3)
            # ignore near-white/near-black texels (padding) when there is colour elsewhere
            sat = arr.max(axis=1) - arr.min(axis=1)
            keep = arr[sat > 20] if (sat > 20).sum() > 8 else arr
            return tuple(int(v) for v in keep.mean(axis=0))
        factor = getattr(material, "baseColorFactor", None)
        if factor is not None:
            return tuple(int(min(255, max(0, float(v) * (255 if float(max(factor[:3])) <= 1.0 else 1)))) for v in factor[:3])
        main = getattr(material, "main_color", None)
        if main is not None:
            return tuple(int(v) for v in main[:3])
    except Exception:  # noqa: BLE001
        pass
    return (170, 170, 170)


# Collect meshes in world space grouped into objects.
objects = {}
for node_name in scene.graph.nodes_geometry:
    matrix, geometry_name = scene.graph[node_name]
    geometry = scene.geometry.get(geometry_name)
    if not isinstance(geometry, trimesh.Trimesh) or len(geometry.faces) == 0:
        continue
    vertices = trimesh.transform_points(geometry.vertices, matrix)
    key = node_name if options["perMesh"] else labels.get(node_name, node_name)
    objects.setdefault(key, []).append((vertices, geometry.faces, base_colour(geometry), node_name))

# 3/4 view: rotate 35° about Y then tilt 30° down; orthographic.
yaw, pitch = math.radians(35), math.radians(-30)
ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
view = rx @ ry
light = np.array([0.4, 0.8, 0.45]); light /= np.linalg.norm(light)

cell = options["cell"]
cols = max(1, options["cols"])
names = list(objects.keys())
rows = math.ceil(len(names) / cols)
sheet = Image.new("RGB", (cols * cell, rows * (cell + 28)), (30, 36, 34))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 11)
except Exception:  # noqa: BLE001
    font = ImageFont.load_default()

MAX_FACES = 12000
for index, name in enumerate(names):
    parts = objects[name]
    all_v = np.vstack([v for v, _, _, _ in parts])
    centre = (all_v.min(axis=0) + all_v.max(axis=0)) / 2
    extent = float(np.linalg.norm(all_v.max(axis=0) - all_v.min(axis=0))) or 1.0
    tri_list = []
    for vertices, faces, colour, _ in parts:
        if len(faces) > MAX_FACES:
            faces = faces[np.linspace(0, len(faces) - 1, MAX_FACES).astype(int)]
        v = (vertices - centre) @ view.T / extent  # normalised, camera space (z toward viewer)
        tri = v[faces]  # (n,3,3)
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        norm = np.linalg.norm(n, axis=1); norm[norm == 0] = 1
        n = n / norm[:, None]
        shade = np.clip(0.45 + 0.55 * np.abs(n @ light), 0.3, 1.0)
        depth = tri[:, :, 2].mean(axis=1)
        for k in range(len(tri)):
            c = tuple(int(colour[j] * shade[k]) for j in range(3))
            tri_list.append((depth[k], tri[k], c))
    tri_list.sort(key=lambda t: t[0])
    ox, oy = (index % cols) * cell, (index // cols) * (cell + 28)
    scale = cell * 0.42
    img = Image.new("RGB", (cell, cell), (44, 52, 49))
    d = ImageDraw.Draw(img)
    for _, tri, c in tri_list:
        pts = [(cell / 2 + tri[j, 0] * scale, cell / 2 - tri[j, 1] * scale) for j in range(3)]
        d.polygon(pts, fill=c)
    sheet.paste(img, (ox, oy))
    label = name if len(name) <= 24 else name[:23] + "…"
    draw.text((ox + 4, oy + cell + 3), label, fill=(230, 238, 232), font=font)
    height_m = float(all_v[:, 1].max() - all_v[:, 1].min())
    draw.text((ox + 4, oy + cell + 15), f"h {height_m:.3g}  ·  {sum(len(f) for _, f, _, _ in parts)} tri", fill=(150, 170, 158), font=font)

sheet.save(out)
print(f"{out}: {len(names)} objects, {cols}x{rows}")
