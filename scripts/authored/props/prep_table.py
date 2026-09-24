# The prep counter: where produce becomes a dish.
#
#   blender --background --python scripts/authored/props/prep_table.py -- <out.glb>
#
# A scrubbed softwood work table with a board let into the left half and a clear
# right half for plating. It carries TWO storage grids:
#
#   board_c1..3 r1..2 — six places for the ingredients waiting to be prepped
#   plate_c1r1        — the one place the finished dish stands
#
# Two grids rather than one because they mean different things to the player:
# the board is the queue and the plate is the result, and storageDisplay's
# `only` lets each item say which it belongs to. The board is a shade darker and
# scored, so it reads as a board and not as a lighter patch of table.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
WOOD = vcol_material("wood"); MARK = vcol_material("marker")

W, D, H = 1.30, 0.74, 0.90
TOP, LEG, APRON = 0.045, 0.072, 0.075
PALE, MID, DARK = hexrgb("#d8b384"), hexrgb("#b48a5c"), hexrgb("#7b5c3a")
BOARD, BOARD_DARK = hexrgb("#c99a63"), hexrgb("#a87c4a")

def box(name, centre, size, colour, seed, grain=0.0):
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, WOOD)
    tone = shade(colour, 0.94 + hash01(seed, 1) * 0.14)
    # Boards are sawn from different planks and scrubbed unevenly; a single flat
    # brown is what makes voxel furniture look like a prop rather than a table.
    paint(obj, lambda i, co, tone=tone: shade(tone, 1.0 + grain * math.sin(co.x * 41.0 + seed)))
    return obj

box("top", Vector((0, 0, H - TOP / 2)), (W, D, TOP), PALE, 3, grain=0.05)
for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
    box(f"leg_{i}", Vector((sx * (W / 2 - LEG / 2 - 0.02), sy * (D / 2 - LEG / 2 - 0.02), (H - TOP) / 2)),
        (LEG, LEG, H - TOP), DARK, 7 + i)
for i, sy in enumerate((-1, 1)):
    box(f"apron_{i}", Vector((0, sy * (D / 2 - 0.03), H - TOP - APRON / 2)), (W - 0.14, 0.024, APRON), MID, 11 + i)
for i, sx in enumerate((-1, 1)):
    box(f"apron_end_{i}", Vector((sx * (W / 2 - 0.03), 0, H - TOP - APRON / 2)), (0.024, D - 0.14, APRON), MID, 17 + i)
# An under-shelf: crates go there in a real kitchen, and it keeps the legs from
# reading as four sticks.
box("shelf", Vector((0, 0, 0.22)), (W - 0.16, D - 0.16, 0.026), MID, 23)

# The board, let into the left half and scored across the grain.
BOARD_W, BOARD_D, BOARD_T = 0.62, 0.44, 0.026
BOARD_X = -W / 4 + 0.02
board = box("board", Vector((BOARD_X, 0, H + BOARD_T / 2)), (BOARD_W, BOARD_D, BOARD_T), BOARD, 29, grain=0.03)
paint(board, lambda i, co: shade(BOARD if co.z < H + BOARD_T * 0.9 else BOARD_DARK,
                                 1.0 + 0.05 * math.sin(co.y * 120.0)))

# Six places on the board, and one on the clear half for the plate.
for row in range(2):
    for col in range(3):
        socket(f"board_c{col + 1}r{row + 1}",
               Vector((BOARD_X - BOARD_W / 2 + 0.10 + col * (BOARD_W - 0.20) / 2,
                       -BOARD_D / 2 + 0.11 + row * (BOARD_D - 0.22),
                       H + BOARD_T + 0.004)), MARK)
socket("plate_c1r1", Vector((W / 4 + 0.02, 0, H + 0.004)), MARK)

finish(OUT, "prep_table")
