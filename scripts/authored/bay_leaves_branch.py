# A hanging bunch of dried bay laurel, authored as mesh and voxelised.
#
# Botanically: Laurus nobilis leaves are oblong-lanceolate, 5.5-12 cm long and
# 1.8-3.2 cm wide (so roughly 3.5:1), the apex acute to acuminate, the base
# cuneate, the margin finely UNDULATE, and the midrib plus 10-12 arching lateral
# veins raised on both faces. Dried, the leaves curl, the colour drops to olive
# and khaki with browner tips, and the stems split. Bunches are tied by the cut
# stems and hung UPSIDE DOWN, which is why the bare wood is at the top here and
# the foliage falls away below it.
#
# Lessons from plant_potted.py, applied from the start:
#   * paint per vertex - the voxeliser builds its shades from surface colour, so
#     a flat-tinted mesh yields flat voxels;
#   * no occluded geometry - petioles are part of the leaf mesh, not separate
#     parts, so there are no one-voxel phantoms stealing rig slots;
#   * stems are >= 3 voxels thick or they dissolve on the grid.
import bpy, math, sys
from mathutils import Vector

PITCH = 0.0025                      # target voxel size; leaf ~10 voxels across

def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def hash01(*args):
    x = 0.0
    for i, a in enumerate(args):
        x += (a + 1.7) * (i * 37.1 + 11.3)
    s = math.sin(x * 127.1) * 43758.5453
    return s - math.floor(s)

def vcol_material(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    node = nt.nodes.new("ShaderNodeVertexColor"); node.layer_name = "Col"
    nt.links.new(node.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    return m

def paint(obj, fn):
    mesh = obj.data
    attr = mesh.color_attributes.get("Col") or mesh.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(mesh.vertices):
        r, g, b = fn(i, v.co)
        attr.data[i].color = (r, g, b, 1.0)

def shade(rgb, f):
    return tuple(min(1.0, max(0.0, c * f)) for c in rgb)

def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

bpy.ops.wm.read_factory_settings(use_empty=True)
LEAF_MAT = vcol_material("bay_leaf")
WOOD_MAT = vcol_material("bay_wood")

OLIVE  = hexrgb("#88904c")
KHAKI  = hexrgb("#9b9a5c")
BROWN  = hexrgb("#7d6b38")
DARK   = hexrgb("#6a7038")
WOOD   = hexrgb("#4a3a1e")

# ---------------------------------------------------------------- the leaf ---
ALONG, ACROSS = 34, 13

def make_leaf(name, length, width, dryness, curl, twist, seed):
    """One bay leaf, origin at the petiole, blade running along +Y."""
    verts, meta = [], []
    wob_phase = hash01(seed, 3) * 6.283
    for a in range(ALONG + 1):
        v = a / ALONG
        if v < 0.11:                                   # petiole: a bare stalk
            halfw = width * 0.11
        else:
            t = (v - 0.11) / 0.89
            # Oblong-lanceolate: widest near 45%, drawn to an acute point.
            halfw = width * (math.sin(math.pi * (t ** 0.72)) ** 0.62)
            # Finely undulate margin - the signature of a bay leaf.
            halfw *= 1.0 + 0.135 * math.sin(v * 11.5 * math.pi + wob_phase)
        for c in range(ACROSS + 1):
            u = c / ACROSS * 2.0 - 1.0
            x = u * halfw
            y = v * length
            # Raised midrib, strongest through the middle of the blade.
            rib = (1.0 - min(1.0, abs(u) * 1.75)) ** 2.4
            z = rib * width * 0.30 * math.sin(math.pi * min(1.0, v * 1.15))
            # Dried leaves cup along their length and curl at the tip.
            z += curl * width * 0.9 * (u * u) * (0.35 + v)
            z -= (v ** 2.4) * length * 0.30
            # A slow twist, so no two leaves present the same face.
            ang = twist * v
            x, z = x * math.cos(ang) - z * math.sin(ang), x * math.sin(ang) + z * math.cos(ang)
            verts.append((x, y, z)); meta.append((u, v))
    faces = []
    for a in range(ALONG):
        for c in range(ACROSS):
            i0 = a * (ACROSS + 1) + c
            faces.append((i0, i0 + 1, i0 + ACROSS + 2, i0 + ACROSS + 1))
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(LEAF_MAT)

    base = mix(OLIVE, BROWN, dryness)
    def blade(i, co, meta=meta, base=base, seed=seed, dryness=dryness):
        u, v = meta[i]
        au = abs(u)
        if v < 0.11:
            return shade(mix(base, WOOD, 0.55), 0.85 + 0.2 * hash01(seed, v))
        # Pale raised midrib.
        midrib = 1.0 + 0.26 * (1.0 - min(1.0, au * 1.7)) ** 4
        # Lateral veins: 11 pairs arching toward the margin, as pale striping.
        vein = 0.5 + 0.5 * math.cos((v * 11.0 - au * 2.1) * 2.0 * math.pi)
        veining = 1.0 + 0.075 * (vein ** 3)
        # The margin dries first, so it browns and darkens.
        edge = au ** 3
        colour = mix(base, BROWN, 0.45 * edge + 0.30 * (v ** 2))
        colour = mix(colour, KHAKI, 0.25 * hash01(seed, round(v, 2)))
        mottle = 0.94 + 0.12 * hash01(seed, round(u, 2), round(v, 2))
        return shade(colour, midrib * veining * (1.0 - 0.16 * edge) * mottle)
    paint(obj, blade)

    solid = obj.modifiers.new("Solidify", 'SOLIDIFY')
    solid.thickness = PITCH * 2.2        # ~2 voxels: any thinner and it dissolves
    solid.offset = 0.0
    return obj

# --------------------------------------------------------------- the stems ---
def make_stem(name, points, r0, r1, seed):
    """A tapered woody tube through `points` (list of Vector)."""
    RING = 9
    verts, meta, faces = [], [], []
    n = len(points)
    for i, p in enumerate(points):
        t = i / (n - 1)
        r = r0 + (r1 - r0) * t
        nxt = points[min(i + 1, n - 1)] - points[max(i - 1, 0)]
        if nxt.length < 1e-6: nxt = Vector((0, 0, 1))
        nxt.normalize()
        helper = Vector((1, 0, 0)) if abs(nxt.x) < 0.9 else Vector((0, 1, 0))
        side = nxt.cross(helper).normalized()
        up = nxt.cross(side)
        for k in range(RING):
            a = k / RING * 6.283185
            # Bark is not a perfect cylinder; wobble the ring a little.
            rr = r * (1.0 + 0.13 * math.sin(a * 3 + t * 9 + seed))
            verts.append(tuple(p + side * (math.cos(a) * rr) + up * (math.sin(a) * rr)))
            meta.append(t)
    for i in range(n - 1):
        for k in range(RING):
            a0 = i * RING + k
            a1 = i * RING + (k + 1) % RING
            faces.append((a0, a1, a1 + RING, a0 + RING))
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(WOOD_MAT)
    paint(obj, lambda i, co, meta=meta, seed=seed: shade(
        mix(WOOD, BROWN, 0.35 * meta[i]),
        0.80 + 0.40 * hash01(seed, round(co.z, 3), round(co.x, 3))))
    return obj

# ------------------------------------------------------------ the composition ---
# v2: the first pass hung 27 leaves flat against a long bare pole and read as a
# twig, not a bunch. A tied bunch is DENSE and roughly teardrop-shaped - five
# stems fanning out, many more leaves, and each leaf swung away from its stem so
# the mass has depth instead of collapsing into a column.
TOP_Z, BOTTOM_Z = 0.94, 0.11
# phase, lean_x, lean_y, leaf count
STEMS = [
    (0.0,  0.018, -0.005, 13),
    (1.3,  0.056,  0.032, 12),
    (2.7, -0.048,  0.041, 13),
    (4.1, -0.033, -0.052, 11),
    (5.4,  0.026, -0.058, 11),
]

leaf_index = 0
for s, (phase, lean_x, lean_y, count) in enumerate(STEMS):
    pts = []
    STEPS = 16
    for i in range(STEPS + 1):
        t = i / STEPS
        z = TOP_Z - (TOP_Z - BOTTOM_Z) * t
        # Tied at the top, so the stems only separate as they fall.
        spread = t ** 1.6
        x = lean_x * spread * 5.0 + 0.014 * math.sin(t * 2.6 + phase)
        y = lean_y * spread * 5.0 + 0.014 * math.cos(t * 2.2 + phase)
        pts.append(Vector((x, y, z)))
    make_stem(f"stem_{s}", pts, 0.0060, 0.0029, s * 1.7)

    for k in range(count):
        t = 0.24 + 0.74 * (k / (count - 1))
        p = pts[min(STEPS, int(t * STEPS))]
        side = 1 if (k % 2 == 0) else -1
        yaw = phase * 57.3 + side * 74 + hash01(s, k) * 54 - 27
        # Swung well away from the stem: a bunch has volume, it is not a column.
        pitch_deg = -18 - hash01(s, k, 2) * 46
        length = 0.086 + hash01(s, k, 3) * 0.042
        width = length * (0.235 + hash01(s, k, 4) * 0.045)
        leaf = make_leaf(f"leaf_{leaf_index}", length, width,
                         dryness=0.12 + hash01(s, k, 5) * 0.66,
                         curl=0.22 + hash01(s, k, 6) * 0.42,
                         twist=(hash01(s, k, 7) - 0.5) * 1.3,
                         seed=leaf_index * 3 + 1)
        leaf.rotation_euler = (math.radians(90 + pitch_deg), math.radians(hash01(s, k, 8) * 50 - 25), math.radians(yaw))
        leaf.location = (p.x, p.y, p.z)
        leaf_index += 1


for o in bpy.data.objects:
    for poly in o.data.polygons:
        poly.use_smooth = False

zs = [(o.matrix_world @ Vector(c)).z for o in bpy.data.objects for c in o.bound_box]
xs = [(o.matrix_world @ Vector(c)).x for o in bpy.data.objects for c in o.bound_box]
print("HEIGHT", round(max(zs) - min(zs), 4), "WIDTH", round(max(xs) - min(xs), 4), "LEAVES", leaf_index)
out = sys.argv[-1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True,
                          export_materials='EXPORT', export_vertex_color='ACTIVE')
print("EXPORTED", out, "parts:", len(bpy.data.objects))
