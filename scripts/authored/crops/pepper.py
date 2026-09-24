# Bell pepper (Capsicum annuum), three growth stages.
#
# The fruit reference: blocky, three or four LOBED swellings with vertical
# creases between them, widest at the shoulder, glossy, with a green calyx and a
# curved green stalk. The plant habit comes from the greenhouse concept art - an
# upright bush of dark ovate leaves with the fruit HANGING beneath the branches,
# and small white star flowers before them.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import BELL, make_cap

args = sys.argv[sys.argv.index("--") + 1:]
STAGE, OUT = args[0], args[1]
new_scene()
LEAF = vcol_material("leaf"); STEM = vcol_material("stem")
FRUIT = vcol_material("fruit"); FLOWER = vcol_material("flower")

BLADE = dict(tip=0.86, full=0.66, undulate=0.04, serrate=0.0, rugose=0.30,
             rib=0.26, veins=8.0, along=20, across=13, droop=0.26)
GREEN = hexrgb("#2f5a2a"); STEMC = hexrgb("#4a6b38")
CALYX = hexrgb("#4f7a35")
# Four varieties, as they appear across the greenhouse beds in the concept art.
VARIETIES = {"green":  (hexrgb("#3f7a26"), hexrgb("#5d9b38")),
             "red":    (hexrgb("#bf2420"), hexrgb("#dc4a36")),
             "yellow": (hexrgb("#e0b019"), hexrgb("#efcb4a")),
             "orange": (hexrgb("#dd7f16"), hexrgb("#ef9f3c"))}

# "ripe" carries a variety suffix: ripe_green, ripe_red, ripe_yellow, ripe_orange.
VARIETY = STAGE.split("_")[1] if "_" in STAGE else "red"
BASE_STAGE = STAGE.split("_")[0]
FRUIT_BASE, FRUIT_PALE = VARIETIES[VARIETY]

# A bell pepper plant stands 50-70 cm and carries 7-9 cm fruit; at 33 cm the
# fruit was half the height of the plant.
# stage -> (height, leaf pairs, leaf size, fruit count, flowers)
# FRUITS is the number of fruit SOCKETS. The bush carries no fruit geometry; the
# game places between three and ten pepper items at these points.
MAX_VISIBLE = 10
STAGES = {"seedling": (0.050, 2, 0.028, 0, 0),
          "growing":  (0.340, 7, 0.070, 0, 5),
          "ripe":     (0.520, 10, 0.078, MAX_VISIBLE, 2)}
H, PAIRS, LSIZE, FRUITS, FLOWERS = STAGES[BASE_STAGE]

parts = []
# Capsicum forks: a short single stem, then a Y, then each arm forks again. A
# single central rod gave a narrow spindle with the fruit stacked up it.
FORK = H * 0.34
main = curve([Vector((0, 0, 0)), Vector((0.003, 0.002, FORK * 0.5)),
              Vector((0.005, -0.002, FORK))], 7)
parts.append(make_tube("stem", main, 0.0052, 0.0034, STEM, 3, base=STEMC, wobble=0.12))

branches = []
ARMS = 2 if BASE_STAGE == "seedling" else 3
for b in range(ARMS):
    a = b * 6.2832 / ARMS + 0.5
    reach = (H - FORK) * (0.34 + hash01(b, 1) * 0.16)
    top = Vector((math.cos(a) * reach, math.sin(a) * reach, H * (0.92 + hash01(b, 2) * 0.10)))
    arm = curve([main[-1], main[-1] + (top - main[-1]) * 0.45 + Vector((0, 0, 0.01)),
                 main[-1] + (top - main[-1]) * 0.78, top], 10)
    parts.append(make_tube(f"arm_{b}", arm, 0.0034, 0.0019, STEM, 7 + b, base=STEMC, wobble=0.12))
    branches.append(arm)

# Leaves and fruit hang off the arms, which is where a real bush carries them.
nodes = []
for b, arm in enumerate(branches):
    for k in range(PAIRS):
        t = 0.10 + 0.84 * (k / max(1, PAIRS - 1))
        nodes.append((b, arm[min(len(arm) - 1, int(t * (len(arm) - 1)))], t))

for k in range(PAIRS):
    t = 0.14 + 0.80 * (k / max(1, PAIRS - 1))
    p = main[min(len(main) - 1, int(t * (len(main) - 1)))]
    for n in range(2):
        yaw = (k % 2) * 90 + n * 180 + hash01(k, n) * 28 - 14
        ln = LSIZE * (1.1 - 0.35 * t) * (0.82 + hash01(k, n, 3) * 0.36)
        lf = make_leaf(f"lf_{k}_{n}", BLADE, ln, ln * (0.46 + hash01(k, n, 4) * 0.12),
                       LEAF, k * 7 + n, curl=0.22 + hash01(k, n, 5) * 0.24,
                       twist=(hash01(k, n, 6) - .5) * 0.8, base=GREEN, under=1.20,
                       thickness=0.0042)
        lf.rotation_euler = (math.radians(64 + hash01(k, n, 7) * 24),
                             math.radians(hash01(k, n, 8) * 30 - 15), math.radians(yaw))
        lf.location = (p.x, p.y, p.z)
        parts.append(lf)

for i, (b, p, t) in enumerate(nodes):
    for n in range(2):
        yaw = (i % 2) * 90 + n * 180 + hash01(i, n, 31) * 30 - 15
        ln = LSIZE * (1.05 - 0.40 * t) * (0.80 + hash01(i, n, 32) * 0.40)
        lf = make_leaf(f"alf_{i}_{n}", BLADE, ln, ln * (0.46 + hash01(i, n, 33) * 0.12),
                       LEAF, i * 5 + n + 400, curl=0.22 + hash01(i, n, 34) * 0.24,
                       twist=(hash01(i, n, 35) - .5) * 0.8, base=GREEN, under=1.20,
                       thickness=0.0042)
        lf.rotation_euler = (math.radians(62 + hash01(i, n, 36) * 26),
                             math.radians(hash01(i, n, 37) * 30 - 15), math.radians(yaw))
        lf.location = (p.x, p.y, p.z)
        parts.append(lf)

SOCKET = vcol_material("socket")
for f in range(FRUITS):
    b, p, _t = nodes[int(hash01(f, 11) * len(nodes)) % len(nodes)]
    a = hash01(f, 12) * 6.2832
    hang = p + Vector((math.cos(a) * 0.020, math.sin(a) * 0.020, -0.016))
    size = 0.030 + hash01(f, 13) * 0.008
    # A short green stalk stays on the bush; the fruit itself is placed by the game.
    stalk = curve([p, (p + hang) * 0.5 + Vector((0, 0, 0.006)), hang + Vector((0, 0, 0.004))], 5)
    parts.append(make_tube(f"fstalk_{f}", stalk, 0.0020, 0.0016, STEM, f * 11,
                           base=CALYX, tip=shade(CALYX, 1.15), wobble=0.08))
    parts.append(socket(f"fruit_{f}", hang + Vector((0, 0, -size * 2.3)), SOCKET, 0.006))

if FLOWERS:
    sites = []
    for f in range(FLOWERS):
        t = 0.44 + 0.48 * hash01(f, 21)
        p = main[min(len(main) - 1, int(t * (len(main) - 1)))]
        a = hash01(f, 22) * 6.2832
        sites.append((p + Vector((math.cos(a) * 0.022, math.sin(a) * 0.022, -0.006)), 0.0055, False))
    parts.append(make_florets("flowers", sites, FLOWER, 31,
                              petal=hexrgb("#eef0e2"), calyx=CALYX, size=0.005))

def join_as(objs, name):
    if not objs: return
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); objs[0].name = name

join_as([o for o in parts if not o.name.startswith("__sock__")], "plant")
finish(OUT, f"pepper-{STAGE}")
