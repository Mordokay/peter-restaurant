# Harvested vegetables, as standalone catalog items.
#
#   blender --background --python scripts/authored/items/vegetable.py -- <kind> <out.glb>
#   kind: cabbage | carrot | lettuce
#
# These are the whole-plant crops: what the player is holding is the thing that
# was pulled or cut, not fruit picked off a plant that stays standing. So each
# one is built as a TRIMMED plant - the part a kitchen would take - and each
# carries the mark of being harvested, because that is what separates produce in
# a crate from a plant in the soil:
#
#   * carrot  - fronds cut off at the shoulder, leaving pale petiole stubs and a
#               dark cut scar. It LIES DOWN, the way a carrot lies in a crate;
#               nothing stands a carrot on its tip.
#   * cabbage - a pale head with a few dark wrapper leaves still clinging and a
#               flat, pale cut stem where it was taken off the stalk.
#   * lettuce - a butterhead cut at the base: a low skirt of outer leaves and a
#               soft heart that pales towards the middle.
#
# Each sits on z=0 with its origin at its base, so a socket on a plant and a
# slot on a shelf both land it the right way up. Real dimensions matter:
# storageDisplay derives the grid footprint from width and depth, which is why a
# carrot on its side takes a long shallow slot and a cabbage takes a square one.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *

KIND, OUT = sys.argv[sys.argv.index("--") + 1:][:2]
new_scene()
BODY = vcol_material("body"); GREEN = vcol_material("green"); PALE = vcol_material("pale")

if KIND == "carrot":
    # Daucus carota, trimmed: 16 cm, cylindrical for two thirds and then drawn
    # to a tail, faint lenticel rings, a paler shoulder, and at the crown a dark
    # cut scar ringed by the pale stubs of cut petioles.
    L, R = 0.163, 0.0193
    ORANGE, SHOULDER = hexrgb("#d9631a"), hexrgb("#ef9342")
    STUB, SCAR = hexrgb("#b9c77a"), hexrgb("#4c5c2a")
    # taper/tail matter more than they look: a long tail turns the root into a
    # cone with a rat's tail on it. A market carrot stays thick most of its
    # length and gives up its last centimetre quickly.
    parts = [make_root("root", L, R, BODY, 5, base=ORANGE, pale=SHOULDER, rings=12, taper=3.4, tail=0.14)]
    # The cut scar: a shallow dark plate across the shoulder.
    parts.append(make_tube("crown", [Vector((0, 0, -0.001)), Vector((0, 0, 0.004))],
                           R * 0.93, R * 0.86, GREEN, 4, base=SCAR, tip=shade(SCAR, 1.12), sides=11))
    # Five petiole stubs, cut short and at slightly different lengths - a knife
    # does not level them, and identical stubs would read as machined.
    for k in range(5):
        a = k * 6.2832 / 5 + hash01(k, 11) * 0.7
        r = R * (0.30 + hash01(k, 12) * 0.34)
        h = 0.009 + hash01(k, 13) * 0.012
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0.002))
        parts.append(make_tube(f"stem_{k}", curve([base, base + Vector((0, 0, h * 0.6)),
                                                   base + Vector((math.cos(a) * h * 0.25, math.sin(a) * h * 0.25, h))], 5),
                               0.0026, 0.0019, PALE, k * 7, base=STUB, tip=shade(STUB, 1.15), wobble=0.12))
    # Lay it on its side, tail towards +x, resting on its fattest point.
    for o in parts:
        o.rotation_euler = (0, math.radians(-88), math.radians(6))
        o.location = (0, 0, R * 0.96)

elif KIND == "cabbage":
    # Brassica oleracea var. capitata, trimmed for market: a slightly flattened
    # cream-green ball about 14 cm across. Two things make it a cabbage and not a
    # melon, and both are about LEAVES rather than about the ball:
    #   * wrappers HUGGING the head, in a green a shade darker than it, so the
    #     silhouette breaks into overlapping leaf edges instead of a smooth curve;
    #   * two or three loose dark wrappers splaying below the equator, the ones a
    #     grocer leaves on.
    # An earlier attempt had the wrappers the right length for the plant, which
    # buried every one of them inside the head and produced a pale blob.
    R = 0.070
    CREAM, MID, DARK, VEIN = hexrgb("#cfd99a"), hexrgb("#6b8f46"), hexrgb("#3f6340"), hexrgb("#9fc07a")
    sites = [(Vector((0, 0, R * 0.99)), R, 0)]
    for j in range(8):
        a = j * 0.897
        sites.append((Vector((math.cos(a) * R * 0.30, math.sin(a) * R * 0.30,
                              R * (0.92 + hash01(j, 4) * 0.22))),
                      R * (0.78 + hash01(j, 3) * 0.16), 1))
    head = make_blobs("head", sites, BODY, 21, colours=[CREAM, shade(CREAM, 0.93)])
    head.scale = (1.0, 0.97, 0.96)              # barely flattened: a cabbage is nearly as tall as it is wide
    WRAP = dict(tip=1.00, full=0.80, undulate=0.22, serrate=0.07, teeth=11.0, rugose=0.75,
                rib=0.22, veins=6.0, along=18, across=15, droop=0.34)
    # Hugging leaves: long enough to clear the head, curled hard so they wrap it.
    for k in range(6):
        a = k * 6.2832 / 6 + hash01(k, 2) * 0.7
        ln = R * (1.04 + hash01(k, 5) * 0.18)
        lf = make_leaf(f"wrap_{k}", WRAP, ln, ln * (0.82 + hash01(k, 6) * 0.14),
                       GREEN, k * 13 + 1, curl=0.86 + hash01(k, 7) * 0.24,
                       twist=(hash01(k, 8) - .5) * 0.5, base=MID, pale=VEIN,
                       under=1.24, thickness=0.0055)
        lf.rotation_euler = (math.radians(48 + hash01(k, 9) * 14),
                             math.radians(hash01(k, 10) * 24 - 12), math.radians(math.degrees(a)))
        lf.location = (0, 0, R * (0.20 + hash01(k, 11) * 0.14))
    # The loose ones a grocer leaves on: darker, flatter, below the equator.
    for k in range(3):
        a = k * 6.2832 / 3 + 0.9 + hash01(k, 21) * 0.6
        ln = R * (0.96 + hash01(k, 22) * 0.24)
        lf = make_leaf(f"skirt_{k}", WRAP, ln, ln * (0.92 + hash01(k, 23) * 0.16),
                       GREEN, k * 31 + 5, curl=0.30 + hash01(k, 24) * 0.26,
                       twist=(hash01(k, 25) - .5) * 0.8, base=DARK, pale=VEIN,
                       under=1.30, thickness=0.0060)
        lf.rotation_euler = (math.radians(68 + hash01(k, 26) * 26),
                             math.radians(hash01(k, 27) * 30 - 15), math.radians(math.degrees(a)))
        lf.location = (0, 0, R * (0.10 + hash01(k, 28) * 0.14))
    # The cut: a flat pale stem disc it stands on.
    make_tube("stem", [Vector((0, 0, 0.0)), Vector((0, 0, 0.009))], R * 0.26, R * 0.30,
              PALE, 3, base=hexrgb("#dfe4bc"), tip=hexrgb("#c9d1a0"), sides=11)

elif KIND == "lettuce":
    # Lactuca sativa, butterhead, cut at the base: outer leaves splay out low and
    # flat, inner ones cup up into a soft heart that pales towards the middle.
    # Ruffled margins and a pale midrib are what make it lettuce and not cabbage.
    BLADE = dict(tip=1.06, full=0.84, undulate=0.34, serrate=0.10, teeth=15.0, rugose=0.60,
                 rib=0.20, veins=7.0, along=20, across=15, droop=0.26)
    GREENC, PALEC, HEART = hexrgb("#7fae3c"), hexrgb("#c3dc7e"), hexrgb("#e6ec9c")
    SKIRT, INNER, LSIZE = 6, 11, 0.068
    for k in range(SKIRT):
        a = k * 6.2832 / SKIRT + hash01(k, 2) * 0.6
        ln = LSIZE * (0.86 + hash01(k, 3) * 0.24)
        lf = make_leaf(f"skirt_{k}", BLADE, ln, ln * (0.80 + hash01(k, 4) * 0.18),
                       GREEN, k * 17 + 3, curl=0.22 + hash01(k, 5) * 0.20,
                       twist=(hash01(k, 6) - .5) * 0.9, base=GREENC, pale=PALEC,
                       under=1.22, thickness=0.0045)
        # The skirt CUPS: a cut head is a dome, and leaves lying flat on the
        # ground turned the first attempt into a puddle of salad.
        lf.rotation_euler = (math.radians(42 + hash01(k, 7) * 14),
                             math.radians(hash01(k, 8) * 30 - 15), math.radians(math.degrees(a)))
        lf.location = (0, 0, 0.008 + hash01(k, 9) * 0.006)
    for k in range(INNER):
        a = k * 137.508 + hash01(k, 12) * 24       # golden angle, as the rosette grew
        rank = k / max(1, INNER - 1)
        ln = LSIZE * (0.98 - 0.24 * rank) * (0.88 + hash01(k, 13) * 0.28)
        lf = make_leaf(f"leaf_{k}", BLADE, ln, ln * (0.86 + hash01(k, 14) * 0.20),
                       GREEN, k * 23 + 7, curl=0.52 + hash01(k, 15) * 0.34,
                       twist=(hash01(k, 16) - .5) * 0.8,
                       base=mix(GREENC, HEART, rank ** 0.7), pale=mix(PALEC, HEART, rank ** 0.7),
                       under=1.18, thickness=0.0042)
        lf.rotation_euler = (math.radians(70 + rank * 24 + hash01(k, 17) * 12),
                             math.radians(hash01(k, 18) * 30 - 15), math.radians(a))
        lf.location = (0, 0, 0.016 + rank * LSIZE * 0.62)
    make_tube("stem", [Vector((0, 0, 0.0)), Vector((0, 0, 0.012))], 0.013, 0.015,
              PALE, 3, base=hexrgb("#e2e7c2"), tip=hexrgb("#c8d494"), sides=11)

else:
    raise SystemExit(f"unknown vegetable kind: {KIND}")

finish(OUT, KIND)
