# The compost bin: where the kitchen's scraps become the farm's soil.
#
#   blender --background --python scripts/authored/props/compost_bin.py -- <out.glb>
#
# A slatted timber bay, open at the front, with the heap inside as its own part
# so the game can scale it with how full the bin is — the bin tells the player
# what it holds by how high it stands, which is the rulebook's rule that state
# is read off the object rather than off a panel.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
WOOD = vcol_material("wood"); HEAP = vcol_material("heap")

W, D, H = 0.96, 0.82, 0.72
POST, SLAT = 0.07, 0.05
PALE, MID, DARK = hexrgb("#a97f4e"), hexrgb("#8a6136"), hexrgb("#6b4a2a")
CRUMB, CRUMB_MID, FLECK = hexrgb("#3d3022"), hexrgb("#52402c"), hexrgb("#6d7a3a")

def plank(name, centre, size, colour, seed, mat=WOOD):
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, mat)
    tone = shade(colour, 0.9 + hash01(seed, 1) * 0.22)
    paint(obj, lambda i, co, tone=tone: shade(tone, 1.0 + 0.05 * math.sin(co.x * 31.0 + seed)))
    return obj

parts = []
for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
    parts.append(plank(f"bin_post_{i}", Vector((sx * (W / 2 - POST / 2), sy * (D / 2 - POST / 2), H / 2)),
                       (POST, POST, H), DARK, i))
# Back and two sides in slats with gaps; the front is left open so the heap shows.
for band in range(4):
    z = 0.09 + band * 0.175
    parts.append(plank(f"bin_back_{band}", Vector((0, D / 2 - 0.02, z)), (W - 0.03, 0.028, SLAT), MID, band * 3))
    for i, sx in enumerate((-1, 1)):
        parts.append(plank(f"bin_side_{band}_{i}", Vector((sx * (W / 2 - 0.02), 0, z)), (0.028, D - 0.03, SLAT), MID, band * 5 + i))
# A low front board: enough to hold the heap in, low enough to see over.
parts.append(plank("bin_front", Vector((0, -D / 2 + 0.02, 0.09)), (W - 0.03, 0.028, SLAT), PALE, 17))

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join(); parts[0].name = "bin"

# The heap: its own object, so the game can scale it with the fill. Built at
# FULL height; a bin with two handfuls in it is this, squashed.
for k in range(60):
    a = k * 2.399 + hash01(k, 2)
    r = (W / 2 - 0.10) * math.sqrt(hash01(k, 3))
    top = 0.46 * (1 - (r / (W / 2 - 0.09)) ** 1.7)
    h = 0.02 + hash01(k, 4) * max(0.02, top)
    colour = CRUMB if hash01(k, 5) < 0.6 else CRUMB_MID
    if hash01(k, 6) < 0.16: colour = FLECK
    size = (0.05 + hash01(k, 7) * 0.05, 0.05 + hash01(k, 8) * 0.05, 0.03 + hash01(k, 9) * 0.04)
    x, y, z = math.cos(a) * r, math.sin(a) * r, h
    verts = [(x + sx * size[0] / 2, y + sy * size[1] / 2, z + sz * size[2] / 2)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(f"heap_{k}", verts, faces, HEAP)
    paint(obj, lambda i, co, colour=colour, k=k: shade(colour, 0.88 + hash01(k, i % 8) * 0.26))

heaps = [o for o in bpy.data.objects if o.name.startswith("heap_")]
bpy.ops.object.select_all(action='DESELECT')
for o in heaps: o.select_set(True)
bpy.context.view_layer.objects.active = heaps[0]
bpy.ops.object.join(); heaps[0].name = "heap"

finish(OUT, "compost_bin")
