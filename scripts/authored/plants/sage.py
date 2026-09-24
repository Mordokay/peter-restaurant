# Sage (Salvia officinalis), an upright flowering stem.
#
# The reference shows sage in bloom, and its silhouette is NOT a leafy bunch: a
# tall SQUARE stem carrying widely spaced whorls of pale lilac two-lipped flowers
# over dark purple calyces, with the large leaves sparse and mostly low down.
# Leaves are oblong to 65 x 25 mm, grey-green and RUGOSE above, nearly white
# beneath from dense short hairs - so the underside is painted much paler and the
# surface carries a cross-hatched pucker.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
LEAF = vcol_material("leaf"); WOOD = vcol_material("stem"); FLOWER = vcol_material("flower")

SPEC = dict(tip=0.88, full=0.66, undulate=0.05, serrate=0.035, teeth=13.0, rugose=0.85,
            rib=0.30, veins=8.0, along=26, across=13, droop=0.26)
GREY  = hexrgb("#8d9885"); STEMCOL = hexrgb("#7c8a6e")
PETAL = hexrgb("#c3b2d8"); CALYX = hexrgb("#6b4f73")

for s in range(5):
    a = s * 1.2566 + hash01(s, 4) * 0.8
    lean = 0.060 + hash01(s, 5) * 0.062
    top = 0.60 + hash01(s, 6) * 0.14
    pts = curve([Vector((0, 0, 0)),
                 Vector((math.cos(a) * lean * .3, math.sin(a) * lean * .3, top * .34)),
                 Vector((math.cos(a) * lean * .8, math.sin(a) * lean * .8, top * .70)),
                 Vector((math.cos(a) * lean, math.sin(a) * lean, top))], 18)
    # Square section: the giveaway of the mint family.
    make_tube(f"stem_{s}", pts, 0.0042, 0.0022, WOOD, s * 5, base=STEMCOL, square=True, wobble=0.0)

    made = []
    NODES = 5
    for k in range(NODES):
        t = 0.08 + 0.46 * (k / (NODES - 1))          # leaves keep to the lower half
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        for n in range(2):                            # opposite, decussate
            yaw = math.degrees(a) + (k % 2) * 90 + n * 180 + hash01(s, k, n) * 22 - 11
            ln = (0.062 - 0.020 * t) * (0.80 + hash01(s, k, n, 3) * 0.45)
            leaf = make_leaf(f"lf_{s}_{k}_{n}", SPEC, ln, ln * (0.32 + hash01(s, k, n, 4) * 0.07),
                             LEAF, s * 71 + k * 3 + n, curl=0.26 + hash01(s, k, n, 5) * 0.28,
                             twist=(hash01(s, k, n, 6) - .5) * 0.8, base=GREY,
                             under=1.42, thickness=0.0055)
            # Held OUT, roughly horizontal - sage does not droop.
            leaf.rotation_euler = (math.radians(74 + hash01(s, k, n, 7) * 26),
                                   math.radians(hash01(s, k, n, 8) * 34 - 17), math.radians(yaw))
            leaf.location = (p.x, p.y, p.z)
            made.append(leaf)

    # Flower whorls up the top third, the way the reference presents.
    sites = []
    for w in range(5):
        t = 0.60 + 0.36 * (w / 4)
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        for f in range(6):
            fa = f / 6 * 6.2832 + w * 0.7
            ring = 0.012 + hash01(s, w, f) * 0.008
            centre = p + Vector((math.cos(fa) * ring, math.sin(fa) * ring, hash01(s, w, f, 1) * 0.006))
            sites.append((centre, 0.0042 + hash01(s, w, f, 2) * 0.003, False))
            sites.append((p + Vector((math.cos(fa) * ring * 0.55, math.sin(fa) * ring * 0.55, -0.004)),
                          0.0034, True))
    made.append(make_florets(f"flowers_{s}", sites, FLOWER, s * 17, petal=PETAL, calyx=CALYX, size=0.005))

    bpy.ops.object.select_all(action='DESELECT')
    for o in made: o.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join(); made[0].name = f"foliage_{s}"

finish(OUT, "sage")
