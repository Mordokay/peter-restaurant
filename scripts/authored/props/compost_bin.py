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

# The heap: its own object, and built SOLID to the brim rather than as a mound
# of separate lumps. The game fills the bin by showing the part of it below a
# waterline — a three-dimensional progress bar — so what matters is that every
# height has something at it. Scaling a sparse mound down, which is what this
# was, left cubes hanging in the air with daylight under them.
#
# What is in it is rubbish, and should look like rubbish: dark crumb with peel,
# leaf and eggshell through it, in the colours of the crops that were trimmed.
PEEL, LEAF, SHELL, CORE = hexrgb("#c47a2c"), hexrgb("#6d8a3a"), hexrgb("#d8cfae"), hexrgb("#8a3b2a")
INNER_W, INNER_D, FULL_H = W - 0.14, D - 0.14, 0.52
LAYERS = 13
COLS, ROWS = 4, 3
for layer in range(LAYERS):
    z0 = 0.02 + layer * (FULL_H / LAYERS)
    # The pile narrows as it rises, so a full bin is a heap standing proud of
    # the boards rather than a block cut off flat.
    shrink = 1.0 - 0.5 * (layer / (LAYERS - 1)) ** 1.8
    across = INNER_W * shrink
    deep = INNER_D * shrink
    # A JITTERED GRID rather than scattered lumps: scattering left holes, and a
    # bin you can see the floor of through its own rubbish reads as a few blocks
    # lying in a box rather than as a heap filling up.
    cols = COLS if layer < LAYERS - 3 else max(2, COLS - 2)
    rows = ROWS if layer < LAYERS - 3 else max(2, ROWS - 1)
    for cx in range(cols):
        for cy in range(rows):
            jitter = 0.34
            x = (-0.5 + (cx + 0.5) / cols) * across + (hash01(layer, cx, cy, 1) - 0.5) * (across / cols) * jitter
            y = (-0.5 + (cy + 0.5) / rows) * deep + (hash01(layer, cx, cy, 2) - 0.5) * (deep / rows) * jitter
            # Overlapping on purpose: neighbours share a little of each other.
            size = ((across / cols) * (1.18 + hash01(layer, cx, cy, 3) * 0.3),
                    (deep / rows) * (1.18 + hash01(layer, cx, cy, 4) * 0.3),
                    (FULL_H / LAYERS) * (1.5 + hash01(layer, cx, cy, 5) * 0.6))
            roll = hash01(layer, cx, cy, 6)
            colour = (CRUMB if roll < 0.46 else CRUMB_MID if roll < 0.66
                      else PEEL if roll < 0.78 else LEAF if roll < 0.9 else SHELL if roll < 0.96 else CORE)
            verts = [(x + sx * size[0] / 2, y + sy * size[1] / 2, z0 + sz * size[2] / 2)
                     for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
            faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
            obj = _mesh(f"heap_{layer}_{cx}_{cy}", verts, faces, HEAP)
            paint(obj, lambda i, co, colour=colour, seed=layer * 31 + cx * 7 + cy: shade(colour, 0.86 + hash01(seed, i % 8) * 0.3))

heaps = [o for o in bpy.data.objects if o.name.startswith("heap_")]
bpy.ops.object.select_all(action='DESELECT')
for o in heaps: o.select_set(True)
bpy.context.view_layer.objects.active = heaps[0]
bpy.ops.object.join(); heaps[0].name = "heap"

finish(OUT, "compost_bin")
