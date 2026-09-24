# Oregano (Origanum vulgare), a flowering stem.
#
# The reference overturns what the first attempt assumed. Oregano is not a leafy
# hanging bunch: it is a SLENDER UPRIGHT REDDISH stem carrying OPPOSITE PAIRS of
# side branches, each tipped with a dense cluster of small pale-pink two-lipped
# flowers sitting over DARK MAROON bracts. The leaves are small, sparse and dark,
# concentrated low down, and are visually secondary to the flowers.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
LEAF = vcol_material("leaf"); WOOD = vcol_material("stem"); FLOWER = vcol_material("flower")

SPEC = dict(tip=1.02, full=0.78, undulate=0.04, serrate=0.03, teeth=7.0, rugose=0.25,
            rib=0.24, veins=5.0, along=13, across=11, droop=0.20)
GREEN = hexrgb("#41632f"); STEM_LO = hexrgb("#a86a58"); STEM_HI = hexrgb("#c98f74")
PETAL = hexrgb("#e8cdd8"); BRACT = hexrgb("#6e3450")

def cluster(at, seed, scale=1.0):
    """A tight corymb: pale corollas crowded over darker bracts."""
    sites = []
    for f in range(13):
        fa = hash01(seed, f, 1) * 6.2832
        rr = (0.004 + hash01(seed, f, 2) * 0.010) * scale
        c = at + Vector((math.cos(fa) * rr, math.sin(fa) * rr,
                         (hash01(seed, f, 3) - 0.35) * 0.010 * scale))
        sites.append((c, (0.0030 + hash01(seed, f, 4) * 0.0020) * scale, False))
        sites.append((c + Vector((0, 0, -0.0042 * scale)), 0.0032 * scale, True))
    return make_florets(f"fl{seed}", sites, FLOWER, seed, petal=PETAL, calyx=BRACT, size=0.004)

for s in range(3):
    parts = []
    a = s * 2.094 + hash01(s, 2) * 0.9
    lean = 0.020 + hash01(s, 3) * 0.028
    top = 0.56 + hash01(s, 4) * 0.12
    main = curve([Vector((0, 0, 0)),
                  Vector((math.cos(a) * lean * .3, math.sin(a) * lean * .3, top * .36)),
                  Vector((math.cos(a) * lean * .8, math.sin(a) * lean * .8, top * .72)),
                  Vector((math.cos(a) * lean, math.sin(a) * lean, top))], 16)
    parts.append(make_tube(f"st_{s}", main, 0.0024, 0.0013, WOOD, s * 9,
                           base=STEM_LO, tip=STEM_HI, square=True, wobble=0.0))

    # Opposite PAIRS of side branches, each ending in a flower cluster.
    for k in range(4):
        t = 0.34 + 0.50 * (k / 3)
        p = main[min(len(main) - 1, int(t * (len(main) - 1)))]
        for n in range(2):
            yaw = math.radians(math.degrees(a) + (k % 2) * 90 + n * 180 + hash01(s, k, n) * 20 - 10)
            reach = (0.070 - 0.022 * t) * (0.8 + hash01(s, k, n, 5) * 0.5)
            rise = reach * (0.55 + hash01(s, k, n, 6) * 0.45)
            end = p + Vector((math.cos(yaw) * reach, math.sin(yaw) * reach, rise))
            br = curve([p, p + (end - p) * 0.45 + Vector((0, 0, 0.004)), end], 7)
            parts.append(make_tube(f"br_{s}_{k}_{n}", br, 0.0015, 0.0009, WOOD, s * 31 + k * 2 + n,
                                   base=STEM_LO, tip=STEM_HI, square=True, wobble=0.0))
            parts.append(cluster(end, s * 53 + k * 2 + n, 0.85 + hash01(s, k, n, 7) * 0.4))
            # A small pair of leaves where the branch leaves the stem.
            for m in range(2):
                ln = 0.020 * (0.8 + hash01(s, k, n, m, 8) * 0.5)
                leaf = make_leaf(f"lf_{s}_{k}_{n}_{m}", SPEC, ln, ln * (0.60 + hash01(s, k, n, m, 9) * 0.14),
                                 LEAF, s * 77 + k * 4 + n * 2 + m, curl=0.16,
                                 twist=(hash01(s, k, n, m, 10) - .5) * 0.6, base=GREEN,
                                 under=1.16, thickness=0.0038)
                leaf.rotation_euler = (math.radians(72 + hash01(s, k, n, m, 11) * 22), 0,
                                       math.degrees(yaw) * 0.0174533 + math.radians(m * 180))
                leaf.rotation_euler = (math.radians(72 + hash01(s, k, n, m, 11) * 22),
                                       math.radians(hash01(s, k, n, m, 12) * 28 - 14),
                                       math.radians(math.degrees(yaw) + m * 180))
                leaf.location = (p.x, p.y, p.z)
                parts.append(leaf)
    # The stem itself ends in the biggest cluster of all.
    parts.append(cluster(main[-1], s * 91, 1.25))
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join(); parts[0].name = f"foliage_{s}"

finish(OUT, "oregano")
