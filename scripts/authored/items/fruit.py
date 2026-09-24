# Harvested fruit, as standalone catalog items.
#
#   blender --background --python scripts/authored/items/fruit.py -- <kind> <out.glb>
#   kind: strawberry | pepper_green | pepper_red | pepper_yellow | pepper_orange
#
# One model per fruit, used in TWO places: hanging on the plant (the game places
# N of them at the plant's fruit sockets) and sitting in a crate or on a shelf.
# That is what lets one plant model serve every yield count, and it is also why
# these carry their REAL dimensions - storageDisplay derives a grid footprint
# from width and depth, so sixteen strawberries and one melon pack correctly
# without anyone hand-tuning a number.
#
# Each sits on z=0 with its origin at its BASE, so placing it at a socket or on
# a shelf slot lands it the right way up either way.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import BELL, BERRY as BERRY_PROFILE, make_cap

KIND, OUT = sys.argv[sys.argv.index("--") + 1:][:2]
new_scene()
BODY = vcol_material("body"); GREEN = vcol_material("green")

if KIND == "strawberry":
    # Fragaria: 2.5-4 cm, conical, achenes sunk in pits, sepals reflexed.
    H, R = 0.034, 0.016
    body = make_fruit("berry", H, R, BODY, 3, base=hexrgb("#c8202a"),
                      pale=hexrgb("#e8584e"), profile=BERRY_PROFILE, dimples=0.075)
    body.location = (0, 0, H)                       # point down onto z=0
    caps = make_calyx("sep", Vector((0, 0, H)), R * 0.95, GREEN, 5,
                      sepals=6, colour=hexrgb("#4f7a35"), reflex=40)
    stalk = curve([Vector((0, 0, H)), Vector((0.002, 0.001, H + 0.010)),
                   Vector((0.004, -0.001, H + 0.018))], 5)
    make_tube("stalk", stalk, 0.0016, 0.0012, GREEN, 9, base=hexrgb("#6d8a3f"), wobble=0.1)
elif KIND.startswith("pepper_"):
    # Capsicum: 7-9 cm tall, blocky, four lobes, a star-shaped calyx plate.
    COLOURS = {"green":  (hexrgb("#3f7a26"), hexrgb("#5d9b38")),
               "red":    (hexrgb("#bf2420"), hexrgb("#dc4a36")),
               "yellow": (hexrgb("#e0b019"), hexrgb("#efcb4a")),
               "orange": (hexrgb("#dd7f16"), hexrgb("#ef9f3c"))}
    base, pale = COLOURS[KIND.split("_")[1]]
    H, R = 0.082, 0.036
    body = make_fruit("pepper", H, R, BODY, 3, base=base, pale=pale, lobes=4, profile=BELL)
    body.location = (0, 0, H)
    make_cap("calyx", Vector((0, 0, H + R * 0.30)), R * 0.74, GREEN, 9,
             colour=hexrgb("#4f7a35"), lobes=5, dish=0.34)
    stalk = curve([Vector((0, 0, H + R * 0.32)), Vector((0.003, 0.001, H + R * 0.32 + 0.012)),
                   Vector((0.006, -0.002, H + R * 0.32 + 0.022))], 5)
    make_tube("stalk", stalk, 0.0026, 0.0019, GREEN, 11, base=hexrgb("#4f7a35"), wobble=0.08)
else:
    raise SystemExit(f"unknown fruit kind: {KIND}")

finish(OUT, KIND)
