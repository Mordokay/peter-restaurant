# The player: a voxel farmer built in parts that a rig can move.
#
#   blender --background --python scripts/authored/props/farmer.py -- <out.glb>
#
# Every part is its own object, because that is what survives the pipeline as a
# separate catalog part and therefore as a separate node the rig can rotate:
# hips, torso, head, two arms, two legs, and a hat. The joint each one turns
# about is worked out after voxelisation from its own bounds (see rig-parts.mjs)
# — a shoulder is the top of an arm, a hip is the top of a leg — so the pivots
# cannot drift away from the geometry when the model is re-authored.
#
# Proportions are game proportions, not human ones: a big head and hands and
# short legs read at the game camera, where a correctly proportioned figure
# reads as a stick. The rulebook's Part 0 covers this — a 1.75 m realistic
# farmer whose hands you cannot see is not a farmer you can watch work.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
MAT = vcol_material("farmer")

SKIN, SKIN_DARK = hexrgb("#d99c6b"), hexrgb("#b67a4e")
HAIR = hexrgb("#4a3324")
SHIRT, SHIRT_DARK = hexrgb("#6e9f86"), hexrgb("#517a66")
APRON = hexrgb("#c8b48a")
DENIM, DENIM_DARK = hexrgb("#4a5f7a"), hexrgb("#3a4c62")
BOOT = hexrgb("#5b3f2a")
STRAW, STRAW_DARK = hexrgb("#d9bd72"), hexrgb("#b99a52")

def box(name, centre, size, colour, *, seed=0, shade_fn=None, join=None):
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, shade_fn or (lambda i, co: shade(colour, 0.97 + hash01(seed, i % 7) * 0.08)))
    return obj

def merge(name, parts):
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = name
    return parts[0]

# ---- legs: boot, turn-up, trouser ------------------------------------------
LEG_H, LEG_W = 0.34, 0.13
for side, sx in (("l", -1), ("r", 1)):
    x = sx * 0.095
    pieces = [
        box(f"boot_{side}", Vector((x, 0.012, 0.045)), (LEG_W + 0.01, 0.20, 0.09), BOOT, seed=1),
        box(f"trouser_{side}", Vector((x, 0, 0.22)), (LEG_W, 0.145, 0.27), DENIM, seed=2),
        # A turn-up at the ankle: one band of a darker blue is the difference
        # between trousers and a painted cylinder.
        box(f"cuff_{side}", Vector((x, 0, 0.100)), (LEG_W + 0.006, 0.152, 0.035), DENIM_DARK, seed=3),
    ]
    merge(f"leg_{side}", pieces)

# ---- hips -------------------------------------------------------------------
merge("hips", [
    box("belt", Vector((0, 0, 0.375)), (0.30, 0.17, 0.05), hexrgb("#6b4a2e"), seed=4),
    box("seat", Vector((0, 0, 0.345)), (0.29, 0.165, 0.04), DENIM, seed=5),
])

# ---- torso: shirt, apron, collar --------------------------------------------
merge("torso", [
    box("shirt", Vector((0, 0, 0.545)), (0.30, 0.185, 0.29), SHIRT, seed=6),
    # The apron is what says "kitchen" rather than "adventurer", and it is the
    # one flat area big enough to read at the game camera.
    box("apron", Vector((0, -0.10, 0.515)), (0.22, 0.02, 0.23), APRON, seed=7),
    box("apron_bib", Vector((0, -0.10, 0.645)), (0.14, 0.018, 0.10), APRON, seed=8),
    box("collar", Vector((0, 0, 0.690)), (0.22, 0.19, 0.03), SHIRT_DARK, seed=9),
    box("shoulder_l", Vector((-0.175, 0, 0.665)), (0.06, 0.18, 0.05), SHIRT, seed=10),
    box("shoulder_r", Vector((0.175, 0, 0.665)), (0.06, 0.18, 0.05), SHIRT, seed=11),
])

# ---- arms: sleeve, forearm, hand -------------------------------------------
for side, sx in (("l", -1), ("r", 1)):
    x = sx * 0.205
    merge(f"arm_{side}", [
        box(f"sleeve_{side}", Vector((x, 0, 0.605)), (0.085, 0.10, 0.15), SHIRT, seed=12),
        box(f"forearm_{side}", Vector((x, 0, 0.495)), (0.075, 0.09, 0.09), SKIN, seed=13),
        box(f"hand_{side}", Vector((x, 0, 0.435)), (0.085, 0.10, 0.055), SKIN_DARK, seed=14),
    ])

# ---- head: face, hair, brim -------------------------------------------------
merge("head", [
    box("face", Vector((0, 0, 0.805)), (0.20, 0.185, 0.19), SKIN, seed=15),
    box("hair", Vector((0, 0.012, 0.885)), (0.212, 0.20, 0.05), HAIR, seed=16),
    box("fringe", Vector((0, -0.085, 0.862)), (0.20, 0.03, 0.035), HAIR, seed=17),
    box("ear_l", Vector((-0.105, 0.01, 0.800)), (0.02, 0.05, 0.05), SKIN_DARK, seed=18),
    box("ear_r", Vector((0.105, 0.01, 0.800)), (0.02, 0.05, 0.05), SKIN_DARK, seed=19),
    # Features have to be at least a voxel proud of the face or the mesher
    # swallows them: the first pass gave the farmer a blank tan block for a head
    # because the eyes stood 7 mm out of a 20 mm grid.
    box("eye_l", Vector((-0.050, -0.084, 0.824)), (0.032, 0.034, 0.032), hexrgb("#2b2119"), seed=20),
    box("eye_r", Vector((0.050, -0.084, 0.824)), (0.032, 0.034, 0.032), hexrgb("#2b2119"), seed=21),
    box("brow_l", Vector((-0.050, -0.086, 0.856)), (0.040, 0.030, 0.016), HAIR, seed=26),
    box("brow_r", Vector((0.050, -0.086, 0.856)), (0.040, 0.030, 0.016), HAIR, seed=27),
    box("mouth", Vector((0, -0.086, 0.762)), (0.048, 0.028, 0.016), SKIN_DARK, seed=28),
])

# ---- hat: a straw brim, worn slightly back ---------------------------------
merge("hat", [
    box("brim", Vector((0, 0.004, 0.916)), (0.30, 0.29, 0.024), STRAW, seed=22),
    box("brim_edge", Vector((0, 0.004, 0.932)), (0.26, 0.25, 0.016), STRAW_DARK, seed=23),
    box("crown", Vector((0, 0.010, 0.958)), (0.20, 0.19, 0.06), STRAW, seed=24),
    box("band", Vector((0, 0.010, 0.936)), (0.206, 0.196, 0.018), hexrgb("#8a6a44"), seed=25),
])

# A socket where a tool would sit, for when there are tool models to hold.
socket("tool", Vector((0.205, -0.02, 0.430)), vcol_material("marker"))

finish(OUT, "farmer")
