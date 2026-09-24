# Lettuce (Lactuca sativa), three growth stages.
#
# From the reference field: an OPEN rosette - never a tight head - of broad,
# bright yellow-green leaves with heavily RUFFLED margins and a prominent pale
# midrib, held outward and up so the plants overlap into a loose dome.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

args = sys.argv[sys.argv.index("--") + 1:]
STAGE, OUT = args[0], args[1]
new_scene()
LEAF = vcol_material("leaf")

# The frill is the signature: a big undulate margin on a broad blade.
BLADE = dict(tip=1.06, full=0.82, undulate=0.30, serrate=0.10, teeth=15.0, rugose=0.55,
             rib=0.20, veins=7.0, along=20, across=15, droop=0.24)
GREEN = hexrgb("#7fae3c"); PALE = hexrgb("#c3dc7e")

# A head of lettuce is 25-35 cm across, so the longest leaf is about 10 cm.
STAGES = {"seedling": (3, 0.024), "growing": (9, 0.066), "ripe": (15, 0.098)}
LEAVES, LSIZE = STAGES[STAGE]

parts = []
for k in range(LEAVES):
    a = k * 137.508 + hash01(k, 2) * 26        # golden angle: a true rosette
    rank = k / max(1, LEAVES - 1)
    lift = 22 + rank * 52                       # outer leaves flatter, inner upright
    ln = LSIZE * (1.15 - 0.40 * rank) * (0.85 + hash01(k, 3) * 0.32)
    lf = make_leaf(f"leaf_{k}", BLADE, ln, ln * (0.72 + hash01(k, 4) * 0.20),
                   LEAF, k * 17 + 3, curl=0.30 + hash01(k, 5) * 0.32,
                   twist=(hash01(k, 6) - .5) * 0.9, base=GREEN, pale=PALE,
                   under=1.22, thickness=0.0045)
    lf.rotation_euler = (math.radians(lift), math.radians(hash01(k, 7) * 34 - 17), math.radians(a))
    lf.location = (0, 0, 0.004 + rank * LSIZE * 0.20)
    parts.append(lf)

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join(); parts[0].name = "plant"
finish(OUT, f"lettuce-{STAGE}")
