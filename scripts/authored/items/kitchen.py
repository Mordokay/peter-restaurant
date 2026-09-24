# What the kitchen throws out, and what it becomes.
#
#   blender --background --python scripts/authored/items/kitchen.py -- <kind> <out.glb>
#   kind: scraps | compost
#
# Scraps are the ends and peelings of the vegetables the player grew, so they are
# built from the SAME colours those crops are: carrot orange, lettuce green,
# pepper red, cabbage cream. A generic brown lump would be food waste in the
# abstract; this is waste you can trace back to the row it came from, which is
# the whole point of a farm that feeds its own soil.
#
# Compost is what a season of that turns into: dark crumb with the last flecks
# of what went in still visible.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

KIND, OUT = sys.argv[sys.argv.index("--") + 1:][:2]
new_scene()
MAT = vcol_material("kitchen")

def lump(name, centre, size, colour, seed, jitter=0.16):
    """A rough chunk: a box with its corners knocked about, which is what keeps a
    heap of these from reading as a pile of dice."""
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = []
    for i, (sx, sy, sz) in enumerate([(a, b, c) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]):
        verts.append((centre.x + sx * x * (1 - jitter * hash01(seed, i, 1)),
                      centre.y + sy * y * (1 - jitter * hash01(seed, i, 2)),
                      centre.z + sz * z * (1 - jitter * hash01(seed, i, 3))))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, lambda i, co: shade(colour, 0.9 + hash01(seed, i % 8) * 0.22))
    return obj

if KIND == "scraps":
    CARROT, LEAF, PEPPER, CABBAGE, STALK = (hexrgb("#d9631a"), hexrgb("#7fae3c"), hexrgb("#bf2420"),
                                            hexrgb("#cfd99a"), hexrgb("#9fb36a"))
    COLOURS = [CARROT, LEAF, PEPPER, CABBAGE, STALK, hexrgb("#e0a24a")]
    # A double handful, heaped: eleven pieces, none of them the same size or
    # colour, tumbling off each other the way peelings actually sit.
    for k in range(11):
        a = k * 2.399 + hash01(k, 4)
        r = 0.028 * math.sqrt(hash01(k, 5))
        h = 0.012 + hash01(k, 6) * 0.030
        size = (0.020 + hash01(k, 7) * 0.030, 0.014 + hash01(k, 8) * 0.026, 0.010 + hash01(k, 9) * 0.014)
        piece = lump(f"scrap_{k}", Vector((math.cos(a) * r, math.sin(a) * r, h)), size,
                     COLOURS[k % len(COLOURS)], k * 13 + 1)
        piece.rotation_euler = (math.radians(hash01(k, 10) * 60 - 30), math.radians(hash01(k, 11) * 60 - 30),
                                math.radians(hash01(k, 12) * 360))
elif KIND == "compost":
    DARK, MID, FLECK_A, FLECK_B = hexrgb("#3d3022"), hexrgb("#4f3f2c"), hexrgb("#6d7a3a"), hexrgb("#8a6a3a")
    # A heap of crumb: a low mound of small dark lumps, with a few pale flecks
    # near the top where it has not finished breaking down.
    for k in range(26):
        a = k * 2.399 + hash01(k, 2)
        r = 0.046 * math.sqrt(hash01(k, 3))
        top = 0.052 * (1 - (r / 0.05) ** 1.6)
        h = 0.008 + hash01(k, 4) * max(0.006, top)
        colour = DARK if hash01(k, 5) < 0.62 else MID
        if h > 0.030 and hash01(k, 6) < 0.3:
            colour = FLECK_A if hash01(k, 7) < 0.5 else FLECK_B
        lump(f"crumb_{k}", Vector((math.cos(a) * r, math.sin(a) * r, h)),
             (0.016 + hash01(k, 8) * 0.014, 0.014 + hash01(k, 9) * 0.014, 0.010 + hash01(k, 10) * 0.012),
             colour, k * 7 + 3, jitter=0.3)
else:
    raise SystemExit(f"unknown kitchen item: {KIND}")

finish(OUT, KIND)
