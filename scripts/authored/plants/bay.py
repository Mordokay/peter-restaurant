# Bay (Laurus nobilis), a tied bunch hung to dry.
#
# Unlike the others this one IS a hanging bunch, because that is how bay reaches
# a kitchen. Woody stems tied at the top, bare for their upper third, then large
# leaves alternating down them and falling away.
# Leaves: oblong-lanceolate, 5.5-12 cm x 1.8-3.2 cm, acute apex, cuneate base,
# the margin finely UNDULATE, midrib and 10-12 arching veins raised. Dried, they
# curl, brown at the margins and tips, and the colour drops to olive and khaki.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
LEAF = vcol_material("leaf"); WOOD = vcol_material("wood")

SPEC = dict(tip=0.72, full=0.62, undulate=0.135, serrate=0.0, rugose=0.0,
            rib=0.30, veins=11.0, along=32, across=13, droop=0.32)
OLIVE = hexrgb("#88904c"); DRY = hexrgb("#7d6b38"); KHAKI = hexrgb("#9b9a5c")
WOODC = hexrgb("#4a3a1e")

TOP, BOTTOM = 0.92, 0.12
for s in range(5):
    a = s * 6.2832 / 5 + hash01(s, 91) * 0.6
    reach = 0.032 + hash01(s, 5) * 0.040
    pts = curve([Vector((0, 0, TOP)),
                 Vector((math.cos(a) * reach * .22, math.sin(a) * reach * .22, TOP - (TOP - BOTTOM) * .34)),
                 Vector((math.cos(a) * reach * .68, math.sin(a) * reach * .68, TOP - (TOP - BOTTOM) * .70)),
                 Vector((math.cos(a) * reach * 1.9, math.sin(a) * reach * 1.9, BOTTOM))], 16)
    made = []
    made.append(make_tube(f"stem_{s}", pts, 0.0060, 0.0029, WOOD, s * 1.7, base=WOODC, wobble=0.15))
    COUNT = 12
    for k in range(COUNT):
        t = 0.26 + 0.70 * (k / (COUNT - 1))
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        # Bay is ALTERNATE, not paired - one leaf a node, swapping sides.
        yaw = math.degrees(a) + (1 if k % 2 == 0 else -1) * 74 + hash01(s, k) * 44 - 22
        taper = 1.0 - 0.34 * (t ** 1.9)
        ln = 0.100 * taper * (0.68 + hash01(s, k, 3) * 0.74)
        leaf = make_leaf(f"lf_{s}_{k}", SPEC, ln, ln * (0.225 + hash01(s, k, 4) * 0.070),
                         LEAF, s * 67 + k, curl=0.22 + hash01(s, k, 6) * 0.40,
                         twist=(hash01(s, k, 7) - .5) * 1.3,
                         base=mix(OLIVE, DRY, 0.10 + hash01(s, k, 5) * 0.70),
                         pale=KHAKI, under=0.88, thickness=0.0055)
        # Hung upside down: every leaf falls below its node.
        leaf.rotation_euler = (math.radians(90 + (-18 - hash01(s, k, 2) * 46)),
                               math.radians(hash01(s, k, 8) * 50 - 25), math.radians(yaw))
        leaf.location = (p.x, p.y, p.z)
        made.append(leaf)
    bpy.ops.object.select_all(action='DESELECT')
    for o in made: o.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join(); made[0].name = f"foliage_{s}"

finish(OUT, "bay")
