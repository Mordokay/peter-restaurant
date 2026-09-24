# Carrot (Daucus carota), three growth stages for a farm plot.
#
#   blender --background --python scripts/authored/crops/carrot.py -- <stage> <out.glb>
#   stage: seedling | growing | ripe
#
# From the reference: the foliage is TRIPINNATE - fern-like fronds so finely cut
# they read as a green haze, carried on ribbed pale-green petioles radiating from
# a crown. The root is a tapering cone with horizontal lenticel rings, a PALE
# SHOULDER where daylight has reached it, and a thin taproot tail. The tops are
# several times the bulk of the root.
#
# At voxel scale true tripinnate cutting is invisible, so the feathery read is
# bought with MANY SMALL LEAFLETS rather than one finely divided leaf - the same
# trade the thyme bundle makes.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

args = sys.argv[sys.argv.index("--") + 1:]
STAGE, OUT = args[0], args[1]
new_scene()
LEAF = vcol_material("leaf"); STALK = vcol_material("petiole"); ROOT = vcol_material("root")

LEAFLET = dict(tip=0.70, full=0.52, undulate=0.0, serrate=0.22, teeth=5.0, rugose=0.0,
               rib=0.30, veins=0.0, along=7, across=7, droop=0.20)
GREEN   = hexrgb("#4f7d32")
PETIOLE = hexrgb("#7fa14a")
ORANGE  = hexrgb("#d96a1e")
SHOULDER= hexrgb("#e8913f")

# stage -> (frond count, frond length, root length, root radius, leaflets per frond)
STAGES = {
    "seedling": (2,  0.045, 0.000, 0.000, 3),
    "growing":  (6,  0.150, 0.000, 0.000, 8),
    # Eleven fronds of thirteen leaflet PAIRS read as a solid green mass; the
    # feathery quality comes from gaps between leaflets, not from more of them.
    "ripe":     (8,  0.235, 0.145, 0.0195, 10),
}
FRONDS, FLEN, RLEN, RRAD, LEAFLETS = STAGES[STAGE]

# ---- the root, pushed just proud of the soil when mature -------------------
if RLEN > 0:
    root = make_root("root", RLEN, RRAD, ROOT, 7, base=ORANGE, pale=SHOULDER, rings=9)
    # Sits so the shoulder stands a centimetre above ground, as in the concept art.
    root.location = (0, 0, 0.012)

# ---- the fronds ------------------------------------------------------------
parts = []
for f in range(FRONDS):
    a = f * 6.2832 / FRONDS + hash01(f, 3) * 0.9
    lean = (0.10 + hash01(f, 4) * 0.30) * (0.4 if STAGE == "seedling" else 1.0)
    tipv = Vector((math.cos(a) * FLEN * lean, math.sin(a) * FLEN * lean, FLEN))
    pts = curve([Vector((0, 0, 0.004)), tipv * 0.42, tipv * 0.76, tipv], 9)
    parts.append(make_tube(f"pet_{f}", pts, 0.0021, 0.0011, STALK, f * 5,
                           base=PETIOLE, tip=shade(PETIOLE, 1.18), wobble=0.10))
    # Leaflets crowd the upper two thirds, in pairs, finely divided.
    for k in range(LEAFLETS):
        t = 0.30 + 0.68 * (k / max(1, LEAFLETS - 1))
        p = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
        for n in range(2):
            yaw = math.degrees(a) + (k % 2) * 60 + n * 180 + hash01(f, k, n) * 50 - 25
            ln = FLEN * (0.30 - 0.12 * t) * (0.7 + hash01(f, k, n, 5) * 0.7)
            lf = make_leaf(f"lf_{f}_{k}_{n}", LEAFLET, ln, ln * (0.42 + hash01(f, k, n, 6) * 0.16),
                           LEAF, f * 29 + k * 3 + n, curl=0.14 + hash01(f, k, n, 7) * 0.2,
                           twist=(hash01(f, k, n, 8) - .5) * 0.9, base=GREEN,
                           under=1.18, thickness=0.0022)
            lf.rotation_euler = (math.radians(46 + hash01(f, k, n, 9) * 40),
                                 math.radians(hash01(f, k, n, 10) * 44 - 22), math.radians(yaw))
            lf.location = (p.x, p.y, p.z)
            parts.append(lf)

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join(); parts[0].name = "tops"
finish(OUT, f"carrot-{STAGE}")
