# The devices that farm while the player is elsewhere.
#
#   blender --background --python scripts/authored/items/devices.py -- <kind> <out.glb>
#   kind: sprinkler | seeder
#
# Both stand in a bed and have to be read at a glance from across a field, so
# each has one strong shape and one strong colour: the sprinkler is copper with
# a spinning head, the seeder is green with a hopper and a spout. They are
# small — half a plot — because a device that hides the crop it is tending has
# defeated itself.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

KIND, OUT = sys.argv[sys.argv.index("--") + 1:][:2]
new_scene()
MAT = vcol_material("device")

def box(name, centre, size, colour, seed=0):
    x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [(centre.x + sx * x, centre.y + sy * y, centre.z + sz * z)
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, lambda i, co: shade(colour, 0.94 + hash01(seed, i % 7) * 0.14))
    return obj

def drum(name, centre, radius, height, colour, seed=0, sides=11):
    verts, faces = [], []
    for z in (0.0, height):
        for k in range(sides):
            a = k / sides * 6.283185
            verts.append((centre.x + math.cos(a) * radius, centre.y + math.sin(a) * radius, centre.z + z))
    for k in range(sides):
        faces.append((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k))
    for base, flip in ((0, True), (sides, False)):
        c = len(verts)
        verts.append((centre.x, centre.y, centre.z + (0.0 if base == 0 else height)))
        for k in range(sides):
            a, b = base + k, base + (k + 1) % sides
            faces.append((c, b, a) if flip else (c, a, b))
    obj = _mesh(name, verts, faces, MAT)
    paint(obj, lambda i, co: shade(colour, 0.92 + hash01(seed, i % 9) * 0.16))
    return obj

if KIND == "sprinkler":
    COPPER, COPPER_DARK, BRASS = hexrgb("#b87a4a"), hexrgb("#8a5730"), hexrgb("#d9a049")
    drum("base", Vector((0, 0, 0)), 0.075, 0.035, COPPER_DARK, 1)
    drum("stem", Vector((0, 0, 0.030)), 0.028, 0.115, COPPER, 2)
    drum("collar", Vector((0, 0, 0.132)), 0.042, 0.020, BRASS, 3)
    # Four arms, each with a nozzle: the shape that says "this waters things".
    for k in range(4):
        a = k * math.pi / 2
        arm = box(f"arm_{k}", Vector((math.cos(a) * 0.055, math.sin(a) * 0.055, 0.150)), (0.095, 0.022, 0.018), BRASS, 4 + k)
        arm.rotation_euler = (0, 0, a)
        nozzle = box(f"nozzle_{k}", Vector((math.cos(a) * 0.098, math.sin(a) * 0.098, 0.146)), (0.026, 0.026, 0.026), COPPER, 8 + k)
        nozzle.rotation_euler = (0, 0, a)
    drum("cap", Vector((0, 0, 0.160)), 0.030, 0.022, COPPER_DARK, 12)
else:
    GREEN, GREEN_DARK, WOOD, SEED = hexrgb("#4f7a4a"), hexrgb("#3a5c37"), hexrgb("#a97f4e"), hexrgb("#d9c184")
    box("base", Vector((0, 0, 0.018)), (0.17, 0.13, 0.036), GREEN_DARK, 1)
    # A hopper: wide at the top, tapering to a spout. Seeds visible in it.
    box("hopper", Vector((0, 0, 0.115)), (0.15, 0.11, 0.13), GREEN, 2)
    box("hopper_lip", Vector((0, 0, 0.184)), (0.165, 0.125, 0.014), GREEN_DARK, 3)
    box("seeds", Vector((0, 0, 0.176)), (0.12, 0.085, 0.016), SEED, 4)
    box("spout", Vector((0, -0.070, 0.055)), (0.05, 0.05, 0.06), WOOD, 5)
    box("spout_lip", Vector((0, -0.070, 0.026)), (0.062, 0.062, 0.016), GREEN_DARK, 6)
    # A crank on the side, so it reads as a machine rather than a bin.
    drum("crank", Vector((0.085, 0.02, 0.105)), 0.022, 0.016, WOOD, 7)

finish(OUT, KIND)
