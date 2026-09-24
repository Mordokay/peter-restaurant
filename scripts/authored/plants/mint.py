# Mint (Mentha spicata), an upright leafy shoot.
#
# The reference close-up is unambiguous: leaves are held OUT and slightly UP in
# opposite pairs, each pair turned 90 degrees from the last, on a hairy SQUARE
# stem, with new shoots pushing from the leaf axils. The margin is strongly
# SERRATED - real teeth, not a wave - and the surface is deeply puckered between
# the veins. Bright yellow-green, palest at the growing tip.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
LEAF = vcol_material("leaf"); WOOD = vcol_material("stem")

SPEC = dict(tip=0.80, full=0.62, undulate=0.0, serrate=0.16, teeth=14.0, rugose=0.95,
            rib=0.30, veins=10.0, along=24, across=13, droop=0.16)
GREEN = hexrgb("#57913a"); TIPCOL = hexrgb("#8fc25c"); STEMCOL = hexrgb("#6f9a4e")

def shoot(origin, direction, height, radius, depth, seed, parts):
    d = direction.normalized()
    side = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
    pts = curve([origin,
                 origin + d * height * 0.36 + side * (hash01(seed, 1) - .5) * height * 0.10,
                 origin + d * height * 0.72 + side * (hash01(seed, 2) - .5) * height * 0.14,
                 origin + d * height + side * (hash01(seed, 3) - .5) * height * 0.16], 14)
    parts.append(make_tube(f"st{seed}", pts, radius, radius * 0.6, WOOD, seed,
                           base=STEMCOL, square=True, wobble=0.0))
    # Internodes are about 4 cm, so a 40 cm shoot carries nine or ten leaf
    # pairs. The earlier blob was caused by leaf SIZE, not by node count, so the
    # spacing can stay tight now that the leaves are 6 cm as they should be.
    NODES = max(4, int(height / 0.048))
    for k in range(NODES):
        t = 0.12 + 0.84 * (k / max(1, NODES - 1))
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        for n in range(2):
            yaw = (k % 2) * 90 + n * 180 + hash01(seed, k, n) * 20 - 10
            # Biggest low down, shrinking to the tip; palest at the tip.
            # Real dimensions, NOT a fraction of stem height: Mentha spicata is
            # about 6 x 1.5 cm. Deriving it from height gave 9-17 cm leaves that
            # merged into one green mass and cost half a million voxels.
            ln = (0.064 - 0.024 * t) * (0.82 + hash01(seed, k, n, 3) * 0.40)
            leaf = make_leaf(f"lf{seed}_{k}_{n}", SPEC, ln, ln * (0.27 + hash01(seed, k, n, 4) * 0.06),
                             LEAF, seed * 41 + k * 3 + n, curl=0.16 + hash01(seed, k, n, 5) * 0.22,
                             twist=(hash01(seed, k, n, 6) - .5) * 0.7,
                             base=mix(GREEN, TIPCOL, t * 0.55), under=1.22, thickness=0.0044)
            # Held out and a little UP: 66-82 degrees, never drooping.
            leaf.rotation_euler = (math.radians(66 + hash01(seed, k, n, 7) * 18),
                                   math.radians(hash01(seed, k, n, 8) * 30 - 15), math.radians(yaw))
            leaf.location = (p.x, p.y, p.z)
            parts.append(leaf)
            # A shoot pushing from this axil - mint's signature untidiness.
            if depth > 0 and k >= 1 and hash01(seed, k, n, 9) > 0.72:
                out = (d * 2.0 + Vector((math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), 0)) * 0.9).normalized()
                shoot(p, out, height * 0.42, radius * 0.66, depth - 1, seed * 13 + k * 2 + n + 1, parts)

for s in range(4):
    a = s * 1.5708 + hash01(s, 7) * 0.6
    parts = []
    start = Vector((math.cos(a) * 0.026, math.sin(a) * 0.026, 0))
    up = Vector((math.cos(a) * 0.16, math.sin(a) * 0.16, 1.0))
    # A cut mint shoot for the kitchen is 35-45 cm, not seventy.
    shoot(start, up, 0.36 + hash01(s, 8) * 0.10, 0.0036, 1, s * 211 + 3, parts)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join(); parts[0].name = f"foliage_{s}"

finish(OUT, "mint")
