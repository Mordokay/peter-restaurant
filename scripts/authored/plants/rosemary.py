# Rosemary (Salvia rosmarinus), a bunch of upright sprigs.
#
# From the reference photograph, three things the first attempt got wrong:
#   * the needles sweep UP and FORWARD along the stem toward its tip, crowded
#     almost to overlapping. The old version hung them downward - bay's habit,
#     borrowed wholesale;
#   * the stems are pale brown and WOODY and stand upright, barely branching;
#   * it flowers - pale blue-violet two-lipped corollas in the upper leaf axils,
#     over grey woolly buds.
# Botanically the needles are 2-4 cm x 2-5 mm, leathery, margins rolled under,
# dark green above and white-woolly beneath. That pale underside is modelled,
# because rosemary's silhouette flickers light and dark as the needles twist.
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_preamble.py")).read()) if False else None
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
import math, bpy
from mathutils import Vector
from botany import *

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
LEAF = vcol_material("needle"); WOOD = vcol_material("wood"); FLOWER = vcol_material("flower")

NEEDLE = dict(tip=0.42, full=0.16, undulate=0.0, serrate=0.0, rugose=0.0,
              rib=0.50, veins=0.0, along=12, across=7, droop=0.06)
GREEN   = hexrgb("#3f5b36")      # dark above
UNDER   = 1.85                    # white-woolly beneath
STEMCOL = hexrgb("#7a6a4e")
PETAL   = hexrgb("#8f9ed6")      # pale blue-violet corolla
CALYX   = hexrgb("#9aa08c")      # grey woolly bud

SPRIGS = 6
for s in range(SPRIGS):
    lean = 0.055 + hash01(s, 1) * 0.045
    ang = s * 6.2832 / SPRIGS + hash01(s, 2) * 0.7
    # Upright: a rosemary sprig stands, it does not fan out and hang.
    pts = curve([Vector((0, 0, 0.0)),
                 Vector((math.cos(ang) * lean * 0.30, math.sin(ang) * lean * 0.30, 0.18)),
                 Vector((math.cos(ang) * lean * 0.75, math.sin(ang) * lean * 0.75, 0.37)),
                 Vector((math.cos(ang) * lean, math.sin(ang) * lean, 0.54))], 18)
    make_tube(f"stem_{s}", pts, 0.0030, 0.0016, WOOD, s * 3.1, base=STEMCOL, wobble=0.16)

    made = []
    COUNT = 34
    for k in range(COUNT):
        t = 0.06 + 0.92 * (k / (COUNT - 1))
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        # Golden angle, so the needles crowd every side of the stem.
        yaw = k * 137.508 + hash01(s, k) * 22
        # THE correction: needles rise toward the tip. 90 deg would be straight
        # out; less than that tilts them upward along the stem.
        lift = 38 + hash01(s, k, 2) * 26
        length = 0.030 + hash01(s, k, 3) * 0.014
        needle = make_leaf(f"leaf_{s}_{k}", NEEDLE, length, length * (0.10 + hash01(s, k, 4) * 0.035),
                           LEAF, s * 97 + k, curl=0.05 + hash01(s, k, 5) * 0.10,
                           twist=(hash01(s, k, 6) - 0.5) * 0.5,
                           base=GREEN, under=UNDER, thickness=0.0026)
        needle.rotation_euler = (math.radians(lift), math.radians(hash01(s, k, 7) * 30 - 15), math.radians(yaw))
        needle.location = (p.x, p.y, p.z)
        made.append(needle)

    # Flowers in the upper axils, over woolly buds.
    sites = []
    for f in range(5):
        t = 0.58 + 0.36 * hash01(s, f, 11)
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        a = hash01(s, f, 12) * 6.2832
        off = Vector((math.cos(a) * 0.009, math.sin(a) * 0.009, 0))
        for b in range(4):
            r = 0.0028 + hash01(s, f, b) * 0.0022
            jitter = Vector(((hash01(s, f, b, 1) - .5) * .010, (hash01(s, f, b, 2) - .5) * .010,
                             (hash01(s, f, b, 3) - .5) * .012))
            sites.append((p + off + jitter, r, b >= 2))
    if sites:
        made.append(make_florets(f"flowers_{s}", sites, FLOWER, s * 13, petal=PETAL, calyx=CALYX, size=0.004))

    bpy.ops.object.select_all(action='DESELECT')
    for o in made: o.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join()
    made[0].name = f"foliage_{s}"

finish(OUT, "rosemary")
