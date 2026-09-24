# A harvest crate: the wooden box the farm's produce goes into.
#
#   blender --background --python scripts/authored/props/crate.py -- <out.glb>
#
# Reference: a slatted field crate — four corner posts, horizontal slats with
# gaps you can see the contents through, a slatted floor, and a hand hole in
# each end. Rough sawn softwood, with the end grain paler than the faces.
#
# It carries a STORAGE GRID: sockets named crate_c<col>r<row> on the inside
# floor, which storageDisplay.ts reads as a grid of standing places. That is why
# the crate holds many strawberries where it holds one cabbage — the footprint
# comes from each item's real size, and the crate only says where places are.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
WOOD = vcol_material("wood"); MARK = vcol_material("marker")

# Outside 56 x 38 cm and 26 cm deep: two hands wide, and low enough that what is
# in it reads from the game camera instead of hiding behind a wall of planks.
W, D, H = 0.56, 0.38, 0.26
SLAT, POST, FLOOR = 0.026, 0.030, 0.016
PALE, MID, DARK = hexrgb("#c49a63"), hexrgb("#a67c46"), hexrgb("#7d5a33")

def plank(name, centre, size, colour, seed):
    """A sawn board: a box with its grain, and never quite the same tone twice."""
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, WOOD)
    tone = shade(colour, 0.90 + hash01(seed, 1) * 0.22)
    # Board ends catch the light differently from board faces; that and the
    # per-board tone are what keep a crate from reading as one brown object.
    paint(obj, lambda i, co, tone=tone: shade(tone, 1.10 if abs(co.x) > W / 2 - 0.02 else 1.0))
    return obj

parts = []
# Corner posts, standing a little proud of the top slat the way a real crate's do.
for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
    parts.append(plank(f"post_{i}", Vector((sx * (W / 2 - POST / 2), sy * (D / 2 - POST / 2), H / 2 + 0.006)),
                       (POST, POST, H + 0.012), DARK, i))

# Side and end slats: three bands with gaps between them.
BANDS = [FLOOR + 0.030, FLOOR + 0.030 + SLAT + 0.022, FLOOR + 0.030 + 2 * (SLAT + 0.022)]
for band, z in enumerate(BANDS):
    for i, sy in enumerate((-1, 1)):
        parts.append(plank(f"slat_side_{band}_{i}", Vector((0, sy * (D / 2 - 0.008), z)),
                           (W - 0.004, 0.016, SLAT), MID, band * 7 + i))
    if band == 2:
        # The top band of each end is cut away in the middle: that gap is the hand hole.
        for i, sx in enumerate((-1, 1)):
            for j, sy in enumerate((-1, 1)):
                parts.append(plank(f"slat_grip_{i}_{j}", Vector((sx * (W / 2 - 0.008), sy * (D / 4 + 0.030), z)),
                                   (0.016, D / 2 - 0.060, SLAT), MID, i * 5 + j))
        continue
    for i, sx in enumerate((-1, 1)):
        parts.append(plank(f"slat_end_{band}_{i}", Vector((sx * (W / 2 - 0.008), 0, z)),
                           (0.016, D - 0.004, SLAT), MID, band * 11 + i + 3))

# Floor boards, running the long way with gaps for the dirt to fall through.
for i in range(5):
    y = -D / 2 + 0.030 + i * (D - 0.060) / 4
    parts.append(plank(f"floor_{i}", Vector((0, y, FLOOR / 2)), (W - 0.02, 0.048, FLOOR), PALE, i * 3 + 2))

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join(); parts[0].name = "crate"

# The grid of standing places, on the floor boards and inset from the walls.
COLS, ROWS = 4, 3
inner_w, inner_d = W - 0.08, D - 0.08
for row in range(ROWS):
    for col in range(COLS):
        x = -inner_w / 2 + inner_w * (col / (COLS - 1))
        y = -inner_d / 2 + inner_d * (row / (ROWS - 1))
        socket(f"crate_c{col + 1}r{row + 1}", Vector((x, y, FLOOR + 0.004)), MARK)

finish(OUT, "crate")
