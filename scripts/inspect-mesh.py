#!/usr/bin/env python3
"""Describe a .glb/.gltf/.obj for the lab's import dialog: overall bounds and
every geometry node with its world-space size, so a collection file (a tray of
41 foods) can be imported as separate catalog objects at their real sizes.

Usage: python3 scripts/inspect-mesh.py file.glb   -> JSON on stdout
"""
import json
import sys

import re
import struct

import numpy as np
import trimesh

path = sys.argv[1]
scene = trimesh.load(path, force="scene")

# Sketchfab (and some Blender) exports call every mesh node "Object_12" and keep the
# real name ("Ladle_A_0") on the parent; Sketchfab also appends "_<index>" to it.
# "label" is the nearest ancestor with a meaningful name, so a collection can be
# split into objects named after what they are — several meshes under one named
# parent (a plant in a tin can: can + foliage + string) share a label and import as
# one object with one part per mesh.
GENERIC = re.compile(r"^(object|mesh|node|geometry|geom|group|empty|cube|cylinder|plane|sphere|text|material|defaultmaterial|lambert|color|polysurface|component|instance)?[_ .-]*\d*(_\d+)?$|^(gltf_scenerootnode|root|world|scene|sketchfab_model|rootnode|armature|collada visual scene group|.*\.fbx)$", re.I)
sketchfab = False
if path.lower().endswith(".glb"):
    try:
        with open(path, "rb") as handle:
            header = handle.read(20)
            length = struct.unpack_from("<I", header, 12)[0]
            generator = json.loads(handle.read(length)).get("asset", {}).get("generator", "")
            sketchfab = "sketchfab" in generator.lower()
    except Exception:  # noqa: BLE001 - a label is a nicety, never a reason to fail
        sketchfab = False
parents = scene.graph.transforms.parents


def label_for(node_name):
    cursor = node_name
    while cursor is not None:
        if not GENERIC.match(cursor):
            return re.sub(r"_\d+$", "", cursor) if sketchfab and cursor != node_name else cursor
        cursor = parents.get(cursor)
    return node_name


def informative(name):
    return bool(name) and not GENERIC.match(name) and not re.match(r"^(material|mat|default|lambert|blinn|phong|standard|color|colour)[_ .-]*\w*\d*$", name, re.I)


def material_name(geometry):
    material = getattr(getattr(geometry, "visual", None), "material", None)
    return str(getattr(material, "name", "") or "")


def strip_material(label, material):
    """Sketchfab names nodes "<object>_<material>_<n>": drop the material tail."""
    if material:
        # trimesh turns "Farm objects material" into "Farm_objects_material"; match either spelling.
        loose = r"[\s_]+".join(re.escape(part) for part in re.split(r"[\s_]+", material) if part)
        stripped = re.sub(r"_" + loose + r"(_\d+)?$", "", label, flags=re.I)
        if stripped:
            return stripped
    return label


# A material name can stand in for an anonymous mesh's name ("Cube.001_Chair_0" with material
# "Chair") — but only when that material is used by ONE mesh, or distinct objects sharing a
# material ("Wall" on four fence pieces) would collapse into one.
material_uses = {}
for node_name in scene.graph.nodes_geometry:
    _, geometry_name = scene.graph[node_name]
    geometry = scene.geometry.get(geometry_name)
    if isinstance(geometry, trimesh.Trimesh) and len(geometry.faces):
        m = material_name(geometry)
        material_uses[m] = material_uses.get(m, 0) + 1

nodes = []
for node_name in scene.graph.nodes_geometry:
    matrix, geometry_name = scene.graph[node_name]
    geometry = scene.geometry.get(geometry_name)
    if not isinstance(geometry, trimesh.Trimesh) or len(geometry.faces) == 0:
        continue
    vertices = trimesh.transform_points(geometry.vertices, matrix)
    low, high = vertices.min(axis=0), vertices.max(axis=0)
    material = material_name(geometry)
    label = strip_material(label_for(node_name), material)
    # Stripping the material tail from "Cube.001_Chair_0" leaves a generic stem: keep the full
    # node name instead (the tail is the only thing that tells the meshes apart).
    if not informative(label):
        label = node_name if informative(material) else label
    if not informative(label) and informative(material) and material_uses.get(material, 0) == 1:
        label = material
    nodes.append({
        "node": node_name,
        "geometry": geometry_name,
        "label": label,
        "material": material,
        "faces": int(len(geometry.faces)),
        "size": [round(float(v), 4) for v in (high - low)],
        "center": [round(float(v), 4) for v in ((low + high) / 2)],
    })

# Blender duplicates ("Cup.001") that differ from the original only by material
# ("Dishes_Dirty" vs "Dishes") take the material's extra words instead of the
# number: Cup.001 -> Cup_Dirty. A duplicate with the same material keeps its number.
by_label = {n["label"]: n for n in nodes}
for n in nodes:
    match = re.match(r"^(.*)\.(\d{3})$", n["label"])
    if not match:
        continue
    base, number = match.groups()
    sibling = by_label.get(base)
    if sibling is not None:
        extra = [t for t in n["material"].split("_") if t and t.lower() not in {t2.lower() for t2 in sibling["material"].split("_")}]
        n["label"] = f"{base}_{'_'.join(extra)}" if extra else f"{base}_{number}"
    else:
        n["label"] = f"{base}_{number}"
nodes.sort(key=lambda n: n["node"].lower())
bounds = scene.bounds
size = bounds[1] - bounds[0]
print(json.dumps({
    "nodes": nodes,
    "size": [round(float(v), 4) for v in size],
    "faces": int(sum(n["faces"] for n in nodes)),
}))
