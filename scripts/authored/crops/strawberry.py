# Strawberry (Fragaria x ananassa), three growth stages.
#
# The berry reference: a conical glossy red body with the achenes sunk into
# PITS across its surface, and pointed sepals reflexed back against the stalk.
# The plant is low and spreading - TRIFOLIATE leaves (three toothed leaflets on
# one petiole) in a ground-hugging rosette, white five-petal flowers, and
# runners striking out sideways.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import BERRY as BERRY_PROFILE

args = sys.argv[sys.argv.index("--") + 1:]
STAGE, OUT = args[0], args[1]
new_scene()
LEAF = vcol_material("leaf"); STEM = vcol_material("stem")
BERRY = vcol_material("berry"); FLOWER = vcol_material("flower")

LEAFLET = dict(tip=1.00, full=0.76, undulate=0.0, serrate=0.20, teeth=9.0, rugose=0.60,
               rib=0.24, veins=7.0, along=14, across=13, droop=0.22)
GREEN = hexrgb("#35672b"); STEMC = hexrgb("#6d8a3f")
RED = hexrgb("#c8202a"); SEPAL = hexrgb("#4f7a35")

# BERRIES is now the number of fruit SOCKETS, not of modelled berries. The plant
# carries no fruit geometry: the game places between four and eight strawberry
# items at these positions, so one plant model serves every yield.
MAX_VISIBLE = 8
STAGES = {"seedling": (1, 0.026, 0, 0, 0), "growing": (5, 0.052, 0, 4, 1), "ripe": (6, 0.058, MAX_VISIBLE, 2, 2)}
TRIFOLIA, LSIZE, BERRIES, FLOWERS, RUNNERS = STAGES[STAGE]

parts = []
for k in range(TRIFOLIA):
    a = k * 137.508 + hash01(k, 2) * 30
    lift = 46 + hash01(k, 3) * 26
    plen = LSIZE * 1.5
    tipv = Vector((math.cos(math.radians(a)) * plen * 0.55, math.sin(math.radians(a)) * plen * 0.55,
                   plen * 0.72))
    pts = curve([Vector((0, 0, 0.004)), tipv * 0.45, tipv * 0.78, tipv], 7)
    parts.append(make_tube(f"pet_{k}", pts, 0.0017, 0.0011, STEM, k * 3, base=STEMC, wobble=0.12))
    # THREE leaflets on one petiole - the trifoliate that says strawberry.
    for n in range(3):
        spread = (-1, 0, 1)[n] * 46
        ln = LSIZE * (0.92 + hash01(k, n, 4) * 0.26)
        lf = make_leaf(f"lf_{k}_{n}", LEAFLET, ln, ln * (0.78 + hash01(k, n, 5) * 0.14),
                       LEAF, k * 11 + n, curl=0.24 + hash01(k, n, 6) * 0.22,
                       twist=(hash01(k, n, 7) - .5) * 0.6, base=GREEN, under=1.26,
                       thickness=0.0038)
        lf.rotation_euler = (math.radians(lift), math.radians(hash01(k, n, 8) * 22 - 11),
                             math.radians(a + spread))
        lf.location = (tipv.x, tipv.y, tipv.z)
        parts.append(lf)

SOCKET = vcol_material("socket")
for b in range(BERRIES):
    a = b * 6.2832 / max(1, BERRIES) + hash01(b, 12) * 0.7
    reach = 0.052 + hash01(b, 13) * 0.026
    at = Vector((math.cos(a) * reach, math.sin(a) * reach, 0.026 + hash01(b, 14) * 0.012))
    pts = curve([Vector((0, 0, 0.006)), at * 0.5 + Vector((0, 0, 0.016)), at + Vector((0, 0, 0.008))], 6)
    # The pedicel stays on the plant: a picked strawberry leaves its stalk, which
    # is the cue that tells the player this plant was just harvested.
    parts.append(make_tube(f"ped_{b}", pts, 0.0013, 0.0009, STEM, b * 7, base=STEMC, wobble=0.1))
    # The socket marks where the fruit's BASE sits, so an item grounded on its
    # own origin hangs correctly when the game places it here.
    parts.append(socket(f"fruit_{b}", at + Vector((0, 0, -0.016)), SOCKET, 0.005))

if FLOWERS:
    sites = []
    for f in range(FLOWERS):
        a = f * 2.4 + hash01(f, 21)
        at = Vector((math.cos(a) * 0.030, math.sin(a) * 0.030, 0.040 + hash01(f, 22) * 0.012))
        sites.append((at, 0.0065, False))
        sites.append((at + Vector((0, 0, -0.004)), 0.0042, True))
    parts.append(make_florets("flowers", sites, FLOWER, 41,
                              petal=hexrgb("#f4f4ea"), calyx=hexrgb("#d9c84a"), size=0.006))

for r in range(RUNNERS):
    a = r * 2.6 + 0.9
    end = Vector((math.cos(a) * 0.115, math.sin(a) * 0.115, 0.004))
    pts = curve([Vector((0, 0, 0.008)), end * 0.4 + Vector((0, 0, 0.018)), end * 0.75, end], 8)
    parts.append(make_tube(f"run_{r}", pts, 0.0012, 0.0008, STEM, r * 13,
                           base=hexrgb("#9a7a3e"), wobble=0.10))

def join_as(objs, name):
    if not objs: return
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); objs[0].name = name

# Markers must stay their own objects so extract-sockets can find them by name.
join_as([o for o in parts if not o.name.startswith("__sock__")], "plant")
finish(OUT, f"strawberry-{STAGE}")
