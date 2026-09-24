# What the farmer holds: a hoe, a watering can, a seed pouch.
#
#   blender --background --python scripts/authored/props/tools.py -- <kind> <out.glb>
#   kind: hoe | can | pouch
#
# Each is modelled around its GRIP at the origin, pointing down -z, because the
# hand socket on the farmer's arm is a point and a direction: whatever hangs
# there has to be built as if the hand were at (0,0,0) holding it. Get that
# wrong and the tool floats beside the farmer instead of in his fist.
#
# They are small and simple on purpose. At the game camera a hoe is fifteen
# voxels of handle and a blade; what sells it is the SWING, and the tool only
# has to be unmistakable in silhouette at the top of the arc.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

args = sys.argv[sys.argv.index("--") + 1:]
KIND, OUT = args[0], args[1]
new_scene()
MAT = vcol_material("tool")

WOOD, WOOD_DARK = hexrgb("#b1834c"), hexrgb("#8a6136")
IRON, IRON_LIGHT = hexrgb("#6b7076"), hexrgb("#8d949b")
TIN, TIN_DARK = hexrgb("#8fa8b8"), hexrgb("#6b8496")
CANVAS, CORD = hexrgb("#c2ab7e"), hexrgb("#8a6a44")

def box(name, centre, size, colour, seed=0):
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, lambda i, co: shade(colour, 0.95 + hash01(seed, i % 6) * 0.12))
    return obj

if KIND == "hoe":
    # A metre of ash with a blade across the end. The handle runs DOWN from the
    # grip so the blade is at the far end of the arc, where the work happens.
    box("handle", Vector((0, 0, -0.34)), (0.035, 0.035, 0.80), WOOD, 1)
    box("handle_grip", Vector((0, 0, 0.02)), (0.042, 0.042, 0.13), WOOD_DARK, 2)
    box("head_neck", Vector((0, -0.028, -0.735)), (0.03, 0.06, 0.06), IRON, 3)
    box("head_blade", Vector((0, -0.075, -0.745)), (0.15, 0.10, 0.026), IRON_LIGHT, 4)
elif KIND == "can":
    # A tin can with a spout and a handle over the top: the spout is what tells
    # it apart from a bucket at twenty metres.
    box("can_body", Vector((0, 0, -0.14)), (0.16, 0.15, 0.18), TIN, 5)
    box("can_base", Vector((0, 0, -0.232)), (0.17, 0.16, 0.02), TIN_DARK, 6)
    box("can_rim", Vector((0, 0, -0.045)), (0.17, 0.16, 0.022), TIN_DARK, 7)
    box("handle", Vector((0, 0, 0.01)), (0.035, 0.035, 0.12), WOOD_DARK, 8)
    box("spout_arm", Vector((0, -0.145, -0.145)), (0.045, 0.14, 0.045), TIN_DARK, 9)
    box("spout_rose", Vector((0, -0.225, -0.135)), (0.075, 0.05, 0.075), TIN, 10)
else:
    # A canvas pouch on a cord — seeds, compost, anything scattered by hand.
    box("pouch_body", Vector((0, 0, -0.14)), (0.15, 0.12, 0.16), CANVAS, 11)
    box("pouch_fold", Vector((0, 0, -0.055)), (0.16, 0.13, 0.03), hexrgb("#a98f62"), 12)
    box("strap", Vector((0, 0, 0.005)), (0.03, 0.03, 0.10), CORD, 13)
    box("pouch_seed_a", Vector((-0.04, -0.062, -0.10)), (0.03, 0.02, 0.03), hexrgb("#d9c184"), 14)
    box("pouch_seed_b", Vector((0.035, -0.062, -0.14)), (0.026, 0.02, 0.026), hexrgb("#c2a86a"), 15)

# Where the hand holds it. The pipeline recentres a model and stands it on its
# base, so "the grip is at the origin" stops being true the moment it is
# voxelised — the marker survives that and the game hangs the tool by it.
socket("grip", Vector((0, 0, 0)), vcol_material("marker"))

finish(OUT, KIND)
