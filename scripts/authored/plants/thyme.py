# Thyme (Thymus vulgaris), a tied bundle of sprigs.
#
# The reference photograph of a bundled bunch settles the architecture: thyme
# BRANCHES. Every stem throws side-shoots, and those throw their own, so the
# bundle is a fine fractal thicket rather than a handful of rods. That twigginess
# IS thyme - the first attempt used seven straight stems and could never look
# like it, however small the leaves were.
# Leaves are 6-13 mm, linear to ovate with a pointed tip, entire and revolute,
# dark greyish-green, in opposite pairs crowding every twig.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
LEAF = vcol_material("leaf"); WOOD = vcol_material("wood")

SPEC = dict(tip=0.72, full=0.58, undulate=0.0, serrate=0.0, rugose=0.0,
            rib=0.34, veins=0.0, along=8, across=7, droop=0.22)
GREEN = hexrgb("#6f7f57"); STEMCOL = hexrgb("#6b553a")
parts = []

def sprig(origin, direction, length, radius, depth, seed):
    """One twig, which recursively throws two or three of its own."""
    d = direction.normalized()
    side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
    pts = curve([origin,
                 origin + d * (length * 0.34) + side * (hash01(seed, 1) - 0.5) * length * 0.16,
                 origin + d * (length * 0.70) + side * (hash01(seed, 2) - 0.5) * length * 0.22,
                 origin + d * length + side * (hash01(seed, 3) - 0.5) * length * 0.26], 9)
    parts.append(make_tube(f"tw{seed}", pts, radius, radius * 0.55, WOOD, seed,
                           base=STEMCOL, wobble=0.18))
    # Opposite pairs of tiny leaves the whole way up.
    nodes = max(3, int(length / 0.011))
    for k in range(nodes):
        t = 0.10 + 0.88 * (k / max(1, nodes - 1))
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        for n in range(2):
            yaw = (k % 2) * 90 + n * 180 + hash01(seed, k, n) * 28 - 14
            ln = 0.0075 + hash01(seed, k, n, 4) * 0.005
            leaf = make_leaf(f"lf{seed}_{k}_{n}", SPEC, ln, ln * (0.30 + hash01(seed, k, n, 5) * 0.10),
                             LEAF, seed * 31 + k * 3 + n, curl=0.18 + hash01(seed, k, n, 6) * 0.2,
                             twist=(hash01(seed, k, n, 7) - .5) * 0.7, base=GREEN,
                             under=1.30, thickness=0.0022)
            leaf.rotation_euler = (math.radians(52 + hash01(seed, k, n, 8) * 34),
                                   math.radians(hash01(seed, k, n, 9) * 40 - 20), math.radians(yaw))
            leaf.location = (p.x, p.y, p.z)
            parts.append(leaf)
    if depth <= 0:
        return
    for b in range(2 if depth == 1 else 3):
        t = 0.34 + 0.52 * hash01(seed, b, 21)
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        a = hash01(seed, b, 22) * 6.2832
        # Side-shoots follow the parent more than they splay, or the bundle
        # flattens into a disc instead of hanging.
        out = (d * 2.1 + Vector((math.cos(a), math.sin(a), 0)) * 0.70).normalized()
        sprig(p, out, length * (0.52 + hash01(seed, b, 23) * 0.16),
              radius * 0.62, depth - 1, seed * 7 + b + 1)

# Tied at the top, sprigs falling and splaying: a hung bundle.
for s in range(9):
    a = s * 6.2832 / 9 + hash01(s, 90) * 0.5
    start = Vector((math.cos(a) * 0.008, math.sin(a) * 0.008, 0.44))
    down = Vector((math.cos(a) * 0.17, math.sin(a) * 0.17, -1.0))
    sprig(start, down, 0.32, 0.0016, 2, s * 101 + 5)

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
parts[0].name = "foliage_0"
finish(OUT, "thyme")
