# A tilled bed: the square of broken ground a plant stands in.
#
#   blender --background --python scripts/authored/props/soil_bed.py -- <out.glb>
#
# Reference: a hoed bed is not a flat brown square. It is a set of parallel
# ridges with a furrow between them, the crumbs sitting proud and loose, the
# edges ragged where the blade stopped. That texture is the whole reason the
# player can see at a glance which plots they have worked — and the rulebook's
# depth rule forbids the flat plane anyway.
#
# One model, several looks: the game recolours its cells for wet and composted
# ground rather than carrying four models, since the shape is identical and only
# the colour of earth changes when you water or feed it.
import sys, os, math, bpy
from mathutils import Vector
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
from botany import *
from botany import _mesh

OUT = sys.argv[sys.argv.index("--") + 1]
new_scene()
EARTH = vcol_material("earth")

W = 1.00          # a plot is 1.2 m apart, so the beds nearly meet with a path between
# The first cut had seven long true ridges and read as decking. Earth is not
# planks: the ridges are shorter, there are more of them, each one wanders along
# its length, and the crumbs on top break the line.
RIDGES = 9
RIDGE_H = 0.030
BASE_H = 0.014
DARK, MID, PALE = hexrgb("#4a3venture") if False else hexrgb("#4a3324"), hexrgb("#6a4b30"), hexrgb("#9c7549")

verts, faces, meta = [], [], []

def quad(a, b, c, d, tone):
    base = len(verts)
    for point in (a, b, c, d):
        verts.append((point.x, point.y, point.z))
        meta.append(tone)
    faces.append((base, base + 1, base + 2, base + 3))

# The bed is built as a strip of ridges running along x, each with its own
# slightly different height and a broken edge, so no two beds read the same.
step = W / RIDGES
for r in range(RIDGES):
    y0 = -W / 2 + r * step
    y1 = y0 + step
    crest = RIDGE_H * (0.72 + hash01(r, 1) * 0.5)
    segments = 18
    for sgm in range(segments):
        x0 = -W / 2 + sgm * (W / segments)
        x1 = x0 + W / segments
        # Clods: the crest wanders along the ridge instead of running true.
        # A ridge that holds its height for a whole metre is a plank. These
        # rise and fall along their length and sometimes break altogether.
        h0 = crest * (0.35 + hash01(r, sgm, 2) * 1.05)
        h1 = crest * (0.35 + hash01(r, sgm + 1, 2) * 1.05)
        # The crest wanders across the ridge as well as along it, so the furrow
        # between two ridges is never a straight dark line.
        mid_y = (y0 + y1) / 2 + (hash01(r, sgm, 4) - 0.5) * step * 0.45
        tone = 0.80 + hash01(r, sgm, 3) * 0.46
        # Two slopes up to the crest line and down again: a ridge, not a box.
        quad(Vector((x0, y0, BASE_H)), Vector((x1, y0, BASE_H)),
             Vector((x1, mid_y, BASE_H + h1)), Vector((x0, mid_y, BASE_H + h0)), tone)
        quad(Vector((x0, mid_y, BASE_H + h0)), Vector((x1, mid_y, BASE_H + h1)),
             Vector((x1, y1, BASE_H)), Vector((x0, y1, BASE_H)), tone * 0.94)

# The body of the bed under the ridges, so it is a bed and not a sheet.
for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
    a = Vector((sx * W / 2 if sx else -W / 2, sy * W / 2 if sy else -W / 2, 0))
    b = Vector((sx * W / 2 if sx else W / 2, sy * W / 2 if sy else -W / 2, 0))
    quad(a, b, Vector((b.x, b.y, BASE_H)), Vector((a.x, a.y, BASE_H)), 0.82)
quad(Vector((-W / 2, -W / 2, 0)), Vector((W / 2, -W / 2, 0)),
     Vector((W / 2, W / 2, 0)), Vector((-W / 2, W / 2, 0)), 0.8)

bed = _mesh("bed", verts, faces, EARTH)
paint(bed, lambda i, co, meta=meta: shade(mix(DARK, PALE, min(1.0, max(0.0, (co.z - BASE_H) / max(1e-4, RIDGE_H)))),
                                          meta[i] if i < len(meta) else 1.0))
finish(OUT, "soil_bed")
