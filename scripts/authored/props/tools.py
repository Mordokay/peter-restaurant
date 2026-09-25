# What the farmer holds: a hoe, a watering can, and a labelled bag.
#
#   blender --background --python scripts/authored/props/tools.py -- <kind> <out.glb>
#   kind: hoe | can | compost | mulch
#
# Each is modelled around its GRIP at the origin, pointing down -z, because the
# hand socket on the farmer's arm is a point and a direction: whatever hangs
# there has to be built as if the hand were at (0,0,0) holding it.
#
# These are held at arm's length in front of the camera, which is the closest
# the player ever gets to any model in this game, so they are authored at a
# finer pitch than a prop and carry the details you would see in a hand: the
# ferrule on the hoe, the rivets and the rose on the can, the stitched seam and
# the printed label on the bags. The first pass was four boxes each and looked
# like four boxes each.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

args = sys.argv[sys.argv.index("--") + 1:]
KIND, OUT = args[0], args[1]
new_scene()
MAT = vcol_material("tool")

WOOD, WOOD_DARK, WOOD_PALE = hexrgb("#b1834c"), hexrgb("#8a6136"), hexrgb("#c9a06a")
IRON, IRON_LIGHT, IRON_DARK = hexrgb("#6b7076"), hexrgb("#98a0a8"), hexrgb("#4a4f55")
TIN, TIN_LIGHT, TIN_DARK = hexrgb("#8fa8b8"), hexrgb("#b3c6d2"), hexrgb("#61798a")
SACK, SACK_DARK, SEAM = hexrgb("#c2ab7e"), hexrgb("#a68f64"), hexrgb("#8a7450")

def box(name, centre, size, colour, seed=0, shade_fn=None):
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, shade_fn or (lambda i, co: shade(colour, 0.95 + hash01(seed, i % 6) * 0.12)))
    return obj

def tube(name, a, b, r0, r1, colour, seed=0, sides=9):
    """A round shaft between two points — handles, spouts, hoops."""
    axis = (b - a)
    length = axis.length
    if length < 1e-5: return None
    up = Vector((0, 0, 1)) if abs(axis.normalized().z) < 0.9 else Vector((1, 0, 0))
    side = axis.cross(up).normalized()
    other = axis.cross(side).normalized()
    verts, faces = [], []
    for step, (point, r) in enumerate(((a, r0), (b, r1))):
        for k in range(sides):
            ang = k / sides * 6.283185
            verts.append(tuple(point + side * (math.cos(ang) * r) + other * (math.sin(ang) * r)))
    for k in range(sides):
        faces.append((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k))
    for base, flip in ((0, True), (sides, False)):
        c = len(verts)
        verts.append(tuple(a if base == 0 else b))
        for k in range(sides):
            i, j = base + k, base + (k + 1) % sides
            faces.append((c, j, i) if flip else (c, i, j))
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, lambda i, co: shade(colour, 0.94 + hash01(seed, i % 7) * 0.14))
    return obj

if KIND == "hoe":
    # An ash shaft with a worn grip, a brass ferrule, a swan neck and a blade
    # that is thinner at its edge than at its socket — the shape you would
    # recognise across a field.
    tube("handle_shaft", Vector((0, 0, 0.06)), Vector((0, 0, -0.66)), 0.017, 0.015, WOOD, 1)
    tube("handle_grip", Vector((0, 0, 0.075)), Vector((0, 0, -0.06)), 0.020, 0.019, WOOD_DARK, 2)
    box("handle_cap", Vector((0, 0, 0.085)), (0.042, 0.042, 0.022), WOOD_PALE, 3)
    # Ferrule: the metal collar where the head is socketed on.
    tube("head_ferrule", Vector((0, 0, -0.64)), Vector((0, 0, -0.70)), 0.021, 0.019, IRON_LIGHT, 4)
    # Swan neck: two short segments, so the blade stands out ahead of the shaft
    # the way a draw hoe's does.
    tube("head_neck", Vector((0, 0, -0.69)), Vector((0, -0.05, -0.745)), 0.016, 0.014, IRON, 5)
    tube("head_socket", Vector((0, -0.05, -0.745)), Vector((0, -0.085, -0.775)), 0.015, 0.013, IRON, 6)
    box("head_blade", Vector((0, -0.105, -0.787)), (0.155, 0.075, 0.020), IRON, 7,
        shade_fn=lambda i, co: shade(IRON_LIGHT if co.y < -0.125 else IRON, 0.95 + hash01(7, i % 5) * 0.12))
    box("head_edge", Vector((0, -0.140, -0.790)), (0.150, 0.012, 0.012), IRON_LIGHT, 8)
elif KIND == "can":
    # A tin can: tapered body, riveted band, arched carrying handle and a rose on
    # the end of the spout with its holes punched through as darker cells.
    tube("can_body", Vector((0, 0, -0.245)), Vector((0, 0, -0.065)), 0.088, 0.076, TIN, 9)
    tube("can_base", Vector((0, 0, -0.255)), Vector((0, 0, -0.238)), 0.092, 0.090, TIN_DARK, 10)
    tube("can_band", Vector((0, 0, -0.165)), Vector((0, 0, -0.145)), 0.090, 0.090, TIN_DARK, 11)
    tube("can_rim", Vector((0, 0, -0.072)), Vector((0, 0, -0.052)), 0.079, 0.083, TIN_LIGHT, 12)
    for k in range(6):
        a = k * 6.283185 / 6
        box(f"can_rivet_{k}", Vector((math.cos(a) * 0.090, math.sin(a) * 0.090, -0.155)), (0.014, 0.014, 0.014), TIN_LIGHT, 13 + k)
    # The handle the hand actually holds, arching over the top.
    tube("handle_post_l", Vector((-0.070, 0, -0.070)), Vector((-0.050, 0, 0.035)), 0.012, 0.011, TIN_DARK, 20)
    tube("handle_post_r", Vector((0.070, 0, -0.070)), Vector((0.050, 0, 0.035)), 0.012, 0.011, TIN_DARK, 21)
    tube("handle_bar", Vector((-0.050, 0, 0.035)), Vector((0.050, 0, 0.035)), 0.013, 0.013, WOOD_DARK, 22)
    # Spout: up and out, ending in a rose.
    tube("spout_arm", Vector((0, -0.060, -0.190)), Vector((0, -0.190, -0.120)), 0.026, 0.020, TIN_DARK, 23)
    tube("spout_neck", Vector((0, -0.190, -0.120)), Vector((0, -0.235, -0.105)), 0.021, 0.028, TIN, 24)
    rose = box("spout_rose", Vector((0, -0.248, -0.100)), (0.078, 0.026, 0.078), TIN_LIGHT, 25)
    # The holes: a grid of darker cells on the face of the rose, which at this
    # pitch is exactly what a rose looks like.
    for k in range(9):
        cx = (k % 3 - 1) * 0.022
        cz = (k // 3 - 1) * 0.022
        box(f"spout_hole_{k}", Vector((cx, -0.262, -0.100 + cz)), (0.012, 0.010, 0.012), TIN_DARK, 30 + k)
else:
    # A bag of soil improver, held by its gathered neck. What makes it read is
    # the LABEL: a paper panel stitched to the sack with a mark on it that says
    # which bag this is without a word of text.
    MARKS = {"compost": hexrgb("#4f7a35"), "mulch": hexrgb("#c9a049"), "seeds": hexrgb("#8a5a2a")}
    FILLS = {"compost": hexrgb("#4a3a27"), "mulch": hexrgb("#c9a765"), "seeds": hexrgb("#d9c184")}
    LABEL, MARK, FILL = hexrgb("#e8e0c8"), MARKS[KIND], FILLS[KIND]
    box("pouch_body", Vector((0, 0, -0.175)), (0.165, 0.125, 0.185), SACK, 40,
        shade_fn=lambda i, co: shade(SACK if abs(co.x) < 0.080 else SACK_DARK, 0.94 + hash01(40, i % 6) * 0.13))
    box("pouch_base", Vector((0, 0, -0.262)), (0.150, 0.115, 0.020), SACK_DARK, 41)
    # The seam up the side, and the gathered neck under the hand.
    box("pouch_seam", Vector((0, -0.064, -0.175)), (0.016, 0.010, 0.185), SEAM, 42)
    box("pouch_neck", Vector((0, 0, -0.062)), (0.085, 0.070, 0.055), SACK_DARK, 43)
    tube("strap_cord", Vector((-0.045, 0, -0.050)), Vector((0.045, 0, -0.050)), 0.009, 0.009, hexrgb("#8a6a44"), 44)
    box("pouch_open", Vector((0, 0, -0.030)), (0.070, 0.058, 0.020), FILL, 45)
    # The label and its mark: a leaf for compost, straw lines for mulch.
    box("pouch_label", Vector((0, -0.070, -0.170)), (0.105, 0.012, 0.105), LABEL, 46)
    if KIND == "seeds":
        # Three seeds and a sprout: the mark a seed bag has had since bags had marks.
        for k in range(3):
            box(f"pouch_mark_seed_{k}", Vector((-0.028 + k * 0.028, -0.078, -0.192)), (0.018, 0.010, 0.022), MARK, 47 + k)
        box("pouch_mark_shoot", Vector((0, -0.078, -0.160)), (0.010, 0.010, 0.040), hexrgb("#4f7a35"), 51)
        box("pouch_mark_leaf", Vector((0.022, -0.078, -0.146)), (0.036, 0.010, 0.020), hexrgb("#4f7a35"), 52)
    elif KIND == "compost":
        box("pouch_mark_stem", Vector((0, -0.078, -0.196)), (0.012, 0.010, 0.042), MARK, 47)
        box("pouch_mark_leaf_a", Vector((-0.026, -0.078, -0.156)), (0.040, 0.010, 0.026), MARK, 48)
        box("pouch_mark_leaf_b", Vector((0.026, -0.078, -0.176)), (0.040, 0.010, 0.026), MARK, 49)
    else:
        for k in range(3):
            bar = box(f"pouch_mark_{k}", Vector((0, -0.078, -0.140 - k * 0.026)), (0.072, 0.010, 0.012), MARK, 50 + k)
            bar.rotation_euler = (0, math.radians(12 - k * 12), 0)

socket("grip", Vector((0, 0, 0)), vcol_material("marker"))
finish(OUT, KIND)
