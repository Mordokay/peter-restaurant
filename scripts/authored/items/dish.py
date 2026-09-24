# Plated dishes: what the kitchen hands to the pass.
#
#   blender --background --python scripts/authored/items/dish.py -- <kind> <out.glb>
#   kind: garden_salad
#
# A dish has to be readable as FOOD at the game camera and as a PARTICULAR food
# at arm's length, which is the same demand a crop makes. The bowl gives it the
# silhouette; the ingredients on top have to stay recognisable as the things the
# player grew — torn lettuce, carrot coins, pepper rings — because the whole
# point of the chain is watching your own produce arrive on a plate.
#
# The bowl is an open shell, not a solid: the voxeliser walks surfaces, so a bowl
# built with an inside keeps its inside, and the salad sits down in it.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

KIND, OUT = sys.argv[sys.argv.index("--") + 1:][:2]
new_scene()
WARE = vcol_material("ware"); FOOD = vcol_material("food")

def bowl(name, profile, mat, colour, sides=26, thickness=0.006):
    """A bowl turned from a profile of (radius, height) points: an outside, an
    inside a little narrower, a rim joining them and a foot to stand on."""
    verts, faces, meta = [], [], []
    rows = len(profile)
    for shell, sign in ((0, 1.0), (1, -1.0)):
        for i, (r, z) in enumerate(profile):
            rr = max(0.0015, r + sign * thickness * 0.5)
            zz = z + (thickness * 0.5 if shell else 0.0)
            for k in range(sides):
                a = k / sides * 6.283185
                verts.append((math.cos(a) * rr, math.sin(a) * rr, zz))
                # The inside of a bowl sits in its own shade; that is most of
                # what tells a voxel bowl from a voxel lump.
                meta.append(0.86 if shell else 1.0)
    per = rows * sides
    for shell in (0, 1):
        base = shell * per
        for i in range(rows - 1):
            for k in range(sides):
                a0 = base + i * sides + k
                a1 = base + i * sides + (k + 1) % sides
                faces.append((a0, a1, a1 + sides, a0 + sides) if shell == 0 else (a0, a0 + sides, a1 + sides, a1))
    # Rim: join the two shells at the top.
    top_out, top_in = (rows - 1) * sides, per + (rows - 1) * sides
    for k in range(sides):
        faces.append((top_out + k, top_in + k, top_in + (k + 1) % sides, top_out + (k + 1) % sides))
    # Foot: close the bottom so it stands on something.
    floor = len(verts)
    verts.append((0, 0, profile[0][1]))
    meta.append(0.92)
    for k in range(sides):
        faces.append((floor, k, (k + 1) % sides, (k + 1) % sides))
    obj = _mesh(name, verts, faces, mat)
    paint(obj, lambda i, co, meta=meta, colour=colour: shade(colour, meta[i] if i < len(meta) else 1.0))
    return obj

def disc(name, centre, radius, height, mat, colour, edge, sides=13):
    """A slice: a short cylinder with a paler core, the way a cut root looks."""
    verts, faces, meta = [], [], []
    for z in (0.0, height):
        for k in range(sides):
            a = k / sides * 6.283185
            verts.append((centre.x + math.cos(a) * radius, centre.y + math.sin(a) * radius, centre.z + z))
            meta.append(z > 0)
    for k in range(sides):
        faces.append((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k))
    for base, flip in ((0, True), (sides, False)):
        centre_i = len(verts)
        verts.append((centre.x, centre.y, centre.z + (0.0 if base == 0 else height)))
        meta.append(base != 0)
        for k in range(sides):
            a, b = base + k, base + (k + 1) % sides
            faces.append((centre_i, b, a) if flip else (centre_i, a, b))
    obj = _mesh(name, verts, faces, mat)
    # The cut face is paler than the skin: that ring is what says "slice".
    paint(obj, lambda i, co, centre=centre: colour if (co - centre).length > radius * 0.82 else edge)
    return obj

if KIND == "garden_salad":
    CREAM, SHADOW = hexrgb("#e8e2d2"), hexrgb("#cfc7b4")
    LEAF, LEAF_PALE = hexrgb("#7fae3c"), hexrgb("#c3dc7e")
    CARROT, CARROT_CORE = hexrgb("#d9631a"), hexrgb("#ef9c52")
    PEPPER, PEPPER_CORE = hexrgb("#bf2420"), hexrgb("#dc5a4a")

    # An 18 cm bowl, 7 cm deep. The first cut was 21 cm across and 6 deep, which
    # from the game camera read as a plate with salad falling off it: the wall
    # has to be steep enough to SEE as a wall.
    profile = [(0.026, 0.000), (0.044, 0.016), (0.062, 0.036), (0.080, 0.058), (0.088, 0.070)]
    bowl("bowl", profile, WARE, CREAM)

    SPEC = dict(tip=1.04, full=0.86, undulate=0.36, serrate=0.12, teeth=14.0, rugose=0.55,
                rib=0.18, veins=6.0, along=14, across=11, droop=0.30)
    # Torn leaves, heaped so the salad mounds above the rim — a bowl filled level
    # with its rim reads as empty from above.
    for k in range(15):
        a = k * 137.508 + hash01(k, 2) * 30
        reach = 0.012 + hash01(k, 3) * 0.032
        ln = 0.030 + hash01(k, 4) * 0.020
        lf = make_leaf(f"leaf_{k}", SPEC, ln, ln * (0.78 + hash01(k, 5) * 0.26), FOOD, k * 13 + 1,
                       curl=0.42 + hash01(k, 6) * 0.42, twist=(hash01(k, 7) - .5) * 1.2,
                       base=LEAF, pale=LEAF_PALE, under=1.22, thickness=0.004)
        lf.rotation_euler = (math.radians(58 + hash01(k, 8) * 44), math.radians(hash01(k, 9) * 50 - 25), math.radians(a))
        lf.location = (math.cos(math.radians(a)) * reach, math.sin(math.radians(a)) * reach,
                       0.040 + hash01(k, 10) * 0.016)

    for k in range(5):
        a = k * 2.399 + hash01(k, 11)
        r = 0.014 + hash01(k, 12) * 0.028
        d = disc(f"carrot_{k}", Vector((math.cos(a) * r, math.sin(a) * r, 0.070 + hash01(k, 13) * 0.016)),
                 0.016 + hash01(k, 14) * 0.005, 0.006, FOOD, CARROT, CARROT_CORE)
        d.rotation_euler = (math.radians(hash01(k, 15) * 46 - 23), math.radians(hash01(k, 16) * 46 - 23), 0)

    for k in range(4):
        a = k * 1.732 + 0.6 + hash01(k, 17)
        r = 0.018 + hash01(k, 18) * 0.024
        centre = Vector((math.cos(a) * r, math.sin(a) * r, 0.074 + hash01(k, 19) * 0.014))
        ring = [centre + Vector((math.cos(t / 12 * 6.283185) * 0.020, math.sin(t / 12 * 6.283185) * 0.020, 0)) for t in range(13)]
        tube = make_tube(f"pepper_{k}", ring, 0.0045, 0.0045, FOOD, k * 7, base=PEPPER, tip=PEPPER_CORE, sides=7)
        tube.rotation_euler = (math.radians(hash01(k, 20) * 40 - 20), math.radians(hash01(k, 21) * 40 - 20), 0)
else:
    raise SystemExit(f"unknown dish: {KIND}")

finish(OUT, KIND)
