# Cabbage (Brassica oleracea var. capitata), three growth stages.
#
# From the reference: a tight PALE head of wrapped leaves cradled in large
# spreading wrapper leaves that are much DARKER blue-green, heavily crinkled at
# the margin, and carry a prominent PALE VEIN NETWORK. The colour jump between
# the cream head and the dark wrappers is the whole read.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

args = sys.argv[sys.argv.index("--") + 1:]
STAGE, OUT = args[0], args[1]
new_scene()
LEAF = vcol_material("leaf"); HEAD = vcol_material("head")

WRAP = dict(tip=1.00, full=0.80, undulate=0.20, serrate=0.07, teeth=11.0, rugose=0.75,
            rib=0.22, veins=6.0, along=18, across=15, droop=0.30)
DARK = hexrgb("#3f6340"); VEIN = hexrgb("#9fc07a"); CREAM = hexrgb("#cfd99a")

# A cabbage plant including its wrapper leaves spans about 45 cm, not 60.
STAGES = {"seedling": (4, 0.028, 0.0), "growing": (9, 0.094, 0.0), "ripe": (11, 0.128, 0.094)}
LEAVES, LSIZE, HEAD_R = STAGES[STAGE]

parts = []
for k in range(LEAVES):
    a = k * 6.2832 / LEAVES + hash01(k, 2) * 0.8
    # Outer leaves lie flatter and are larger; inner ones stand up around the head.
    rank = k / max(1, LEAVES - 1)
    lift = 24 + rank * 30
    ln = LSIZE * (1.18 - 0.42 * rank) * (0.85 + hash01(k, 3) * 0.3)
    lf = make_leaf(f"wrap_{k}", WRAP, ln, ln * (0.82 + hash01(k, 4) * 0.16),
                   LEAF, k * 13 + 1, curl=0.34 + hash01(k, 5) * 0.34,
                   twist=(hash01(k, 6) - .5) * 0.6, base=DARK, pale=VEIN,
                   under=1.30, thickness=0.0055)
    lf.rotation_euler = (math.radians(lift), math.radians(hash01(k, 7) * 30 - 15), math.radians(math.degrees(a)))
    lf.location = (0, 0, 0.004 + rank * HEAD_R * 0.5)
    parts.append(lf)

if HEAD_R > 0:
    # The head: a slightly flattened ball of cream leaves, sitting in the wrappers.
    sites = [(Vector((0, 0, HEAD_R * 1.05)), HEAD_R, 0)]
    for j in range(7):                       # a few overlapping wraps for silhouette
        a = j * 0.897
        sites.append((Vector((math.cos(a) * HEAD_R * 0.34, math.sin(a) * HEAD_R * 0.34,
                              HEAD_R * (0.94 + hash01(j, 9) * 0.20))),
                      HEAD_R * (0.80 + hash01(j, 8) * 0.14), 1))
    parts.append(make_blobs("head", sites, HEAD, 21, colours=[CREAM, shade(CREAM, 0.92)]))

bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join(); parts[0].name = "plant"
finish(OUT, f"cabbage-{STAGE}")
