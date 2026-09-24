# Shared voxel-plant primitives.
#
# What belongs here: how to BUILD a leaf, a stem, a flower cluster, and how to
# paint and export them. What does NOT belong here is any plant's ARCHITECTURE.
#
# That distinction is the lesson of the first attempt. Six herbs were generated
# from one parametric composition and came out anatomically identical - 4-7
# unbranched rods fanning from a tied point - differing only in leaf shape and
# colour. Reference photographs showed how wrong that was: rosemary's needles
# sweep UP its stems, thyme branches into fine fractal twigs, oregano is a
# slender upright stem with opposite branch pairs and terminal flower clusters.
# Primitives generalise. Anatomy does not, and each plant now owns its own.
import bpy, math
from mathutils import Vector

# ------------------------------------------------------------------ colour ---
def hexrgb(h):
    """sRGB fractions. The voxeliser reads glTF baseColorFactor and COLOR_0 back
    as the voxel colour, so these must NOT be converted to linear."""
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

def hash01(*a):
    """Deterministic 0..1 - a plant must be identical on every run."""
    x = 0.0
    for i, v in enumerate(a):
        x += (v + 1.7) * (i * 37.1 + 11.3)
    s = math.sin(x * 127.1) * 43758.5453
    return s - math.floor(s)

def shade(c, f):
    return tuple(min(1.0, max(0.0, x * f)) for x in c)

def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def vcol_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    n = nt.nodes.new("ShaderNodeVertexColor")
    n.layer_name = "Col"
    nt.links.new(n.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    return m

def paint(obj, fn):
    """fn(index, co) -> (r, g, b) written to a POINT-domain COLOR_0."""
    mesh = obj.data
    attr = mesh.color_attributes.get("Col") or mesh.color_attributes.new(
        name="Col", type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(mesh.vertices):
        r, g, b = fn(i, v.co)
        attr.data[i].color = (r, g, b, 1.0)

def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def finish(out, label=""):
    for o in bpy.data.objects:
        for p in o.data.polygons:
            p.use_smooth = False
    # matrix_world is lazily evaluated: setting obj.location does not refresh it.
    # Without this the reported size ignores every object that was positioned by
    # transform rather than by vertex coordinates, which made a 9 cm pepper
    # measure 20 cm - and that number becomes the storage footprint.
    bpy.context.view_layer.update()
    pts = [(o.matrix_world @ Vector(c)) for o in bpy.data.objects for c in o.bound_box]
    h = max(p.z for p in pts) - min(p.z for p in pts)
    w = max(p.x for p in pts) - min(p.x for p in pts)
    d = max(p.y for p in pts) - min(p.y for p in pts)
    print(f"BUILT {label} HEIGHT {h:.4f} WIDTH {w:.4f} DEPTH {d:.4f} OBJECTS {len(bpy.data.objects)}")
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True,
                              export_materials='EXPORT', export_vertex_color='ACTIVE')

def _mesh(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj

# -------------------------------------------------------------------- leaf ---
def make_leaf(name, spec, length, width, mat, seed, *, curl=0.3, twist=0.0,
              base=(0.3, 0.5, 0.2), dark=None, pale=None, under=1.0, thickness=0.004):
    """A leaf as a CLOSED two-sided shell running along +Y from a petiole at the
    origin. Top and bottom are separate vertex rows so each paints on its own -
    rosemary and sage are white-woolly beneath, and that flash as leaves twist is
    most of what reads as 'herb'. A Solidify modifier cannot do it, because the
    back face would inherit the front's colours.

    spec: tip, full (width profile), undulate, serrate, rugose, rib, veins,
          along, across.
    """
    dark = dark or shade(base, 0.72)
    pale = pale or shade(base, 1.25)
    along, across = spec["along"], spec["across"]
    top, meta = [], []
    phase = hash01(seed, 3) * 6.283
    for a in range(along + 1):
        v = a / along
        if v < 0.10:
            halfw = width * 0.10
        else:
            t = (v - 0.10) / 0.90
            halfw = width * (math.sin(math.pi * (t ** spec["tip"])) ** spec["full"])
            if spec.get("undulate"):
                halfw *= 1.0 + spec["undulate"] * math.sin(v * 11.5 * math.pi + phase)
            if spec.get("serrate"):
                saw = (v * spec.get("teeth", 9.0) + phase) % 1.0
                halfw *= 1.0 + spec["serrate"] * (abs(saw * 2.0 - 1.0) - 0.5)
        for c in range(across + 1):
            u = c / across * 2.0 - 1.0
            x, y = u * halfw, v * length
            rib = (1.0 - min(1.0, abs(u) * 1.75)) ** 2.4
            z = rib * width * spec["rib"] * math.sin(math.pi * min(1.0, v * 1.15))
            if spec.get("rugose"):
                z += spec["rugose"] * thickness * 0.9 * math.sin(v * 17.0) * math.cos(u * 5.0)
            z += curl * width * 0.9 * (u * u) * (0.35 + v)
            z -= (v ** 2.4) * length * spec.get("droop", 0.30)
            ang = twist * v
            x, z = x * math.cos(ang) - z * math.sin(ang), x * math.sin(ang) + z * math.cos(ang)
            top.append((x, y, z))
            meta.append((u, v))
    N = len(top)
    verts = top + [(x, y, z - thickness) for (x, y, z) in top]
    idx = lambda a, c: a * (across + 1) + c
    faces = []
    for a in range(along):
        for c in range(across):
            i0, i1, i2, i3 = idx(a, c), idx(a, c + 1), idx(a + 1, c + 1), idx(a + 1, c)
            faces.append((i0, i1, i2, i3))
            faces.append((i3 + N, i2 + N, i1 + N, i0 + N))
        faces.append((idx(a, 0), idx(a + 1, 0), idx(a + 1, 0) + N, idx(a, 0) + N))
        faces.append((idx(a, across) + N, idx(a + 1, across) + N, idx(a + 1, across), idx(a, across)))
    for c in range(across):
        faces.append((idx(0, c) + N, idx(0, c + 1) + N, idx(0, c + 1), idx(0, c)))
        faces.append((idx(along, c), idx(along, c + 1), idx(along, c + 1) + N, idx(along, c) + N))
    obj = _mesh(name, verts, faces, mat)

    veins = spec.get("veins", 0.0)
    def blade(i, co, meta=meta, N=N):
        down = i >= N
        u, v = meta[i % N]
        au = abs(u)
        if v < 0.10:
            return shade(mix(base, dark, 0.7), 0.9 + 0.2 * hash01(seed, v))
        midrib = 1.0 + 0.24 * (1.0 - min(1.0, au * 1.7)) ** 4
        veining = 1.0
        if veins:
            w = 0.5 + 0.5 * math.cos((v * veins - au * 2.1) * 2.0 * math.pi)
            veining = 1.0 + 0.08 * (w ** 3)
        edge = au ** 3
        colour = mix(base, dark, 0.40 * edge + 0.22 * (v ** 2))
        colour = mix(colour, pale, 0.22 * hash01(seed, round(v, 2)))
        mottle = 0.94 + 0.12 * hash01(seed, round(u, 2), round(v, 2))
        f = midrib * veining * (1.0 - 0.14 * edge) * mottle
        return shade(colour, f * (under if down else 1.0))
    paint(obj, blade)
    return obj

# -------------------------------------------------------------------- stem ---
def make_tube(name, path, r0, r1, mat, seed, *, square=False, sides=9,
              base=(0.3, 0.25, 0.15), tip=None, wobble=0.13):
    """A tapered stem through `path`. `square` gives the four-angled stem that is
    the giveaway of the mint family (sage, mint, oregano, thyme, rosemary)."""
    tip = tip or shade(base, 1.2)
    n = len(path)
    ring = 4 if square else sides
    verts, meta, faces = [], [], []
    for i, p in enumerate(path):
        t = i / (n - 1)
        r = r0 + (r1 - r0) * t
        d = path[min(i + 1, n - 1)] - path[max(i - 1, 0)]
        if d.length < 1e-9:
            d = Vector((0, 0, 1))
        d = d.normalized()
        helper = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
        side = d.cross(helper).normalized()
        up = d.cross(side)
        for k in range(ring):
            a = k / ring * 6.283185 + (0.7854 if square else 0.0)
            rr = r * (1.0 + wobble * math.sin(a * 3 + t * 9 + seed))
            if square:
                rr = r * 1.32          # corners of a square section sit further out
            verts.append(tuple(p + side * (math.cos(a) * rr) + up * (math.sin(a) * rr)))
            meta.append(t)
    for i in range(n - 1):
        for k in range(ring):
            a0, a1 = i * ring + k, i * ring + (k + 1) % ring
            faces.append((a0, a1, a1 + ring, a0 + ring))
    obj = _mesh(name, verts, faces, mat)
    paint(obj, lambda i, co, meta=meta: shade(
        mix(base, tip, meta[i]), 0.82 + 0.34 * hash01(seed, round(co.z, 3), round(co.x, 3))))
    return obj

# ------------------------------------------------------------------ flower ---
def make_florets(name, sites, mat, seed, *, petal, calyx, size):
    """A cluster of florets as small rounded blobs, two-toned.

    Voxel scale decides the abstraction: a 5 mm labiate flower is two or three
    voxels across, so modelling petals is wasted. What reads is the CLUSTER - a
    knot of pale corollas over darker calyces, which is exactly how oregano and
    rosemary present at arm's length.
    """
    verts, faces, meta = [], [], []
    for j, (centre, r, is_calyx) in enumerate(sites):
        base_i = len(verts)
        rows, cols = 4, 6
        for a in range(rows + 1):
            pv = a / rows * math.pi
            for b in range(cols):
                pu = b / cols * 6.283185
                rr = r * (1.0 + 0.22 * hash01(seed, j, a, b) - 0.11)
                verts.append((centre.x + rr * math.sin(pv) * math.cos(pu),
                              centre.y + rr * math.sin(pv) * math.sin(pu),
                              centre.z + rr * math.cos(pv) * 1.25))
                meta.append(is_calyx)
        for a in range(rows):
            for b in range(cols):
                i0 = base_i + a * cols + b
                i1 = base_i + a * cols + (b + 1) % cols
                faces.append((i0, i1, i1 + cols, i0 + cols))
    obj = _mesh(name, verts, faces, mat)
    paint(obj, lambda i, co, meta=meta: shade(
        calyx if meta[i] else petal, 0.88 + 0.26 * hash01(seed, i)))
    return obj

def curve(points, steps):
    """Resample a short polyline into `steps` smooth points (Catmull-Rom-ish)."""
    out = []
    n = len(points)
    for i in range(steps + 1):
        t = i / steps * (n - 1)
        k = min(int(t), n - 2)
        f = t - k
        p0 = points[max(0, k - 1)]
        p1, p2 = points[k], points[k + 1]
        p3 = points[min(n - 1, k + 2)]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * f
                          + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f))
    return out

# ------------------------------------------------------------------- crops ---
def make_root(name, length, top_r, mat, seed, *, base, pale=None, rings=9,
              taper=2.2, tail=0.28, sides=11):
    """A taproot: a tapering cone hanging from y=0 down, with the horizontal
    lenticel rings a carrot actually has, a paler shoulder, and a thin tail.
    Built pointing DOWN so a crop script can drop it straight into the soil."""
    pale = pale or shade(base, 1.22)
    verts, meta, faces = [], [], []
    ROWS = 16
    for a in range(ROWS + 1):
        t = a / ROWS
        # Fat at the shoulder, drawn to a point, then a thin tail below it.
        if t < 1.0 - tail:
            u = t / (1.0 - tail)
            r = top_r * (1.0 - u ** taper) ** 0.55
        else:
            u = (t - (1.0 - tail)) / tail
            r = top_r * 0.14 * (1.0 - u) + top_r * 0.02
        r = max(r, top_r * 0.02)
        # Lenticel rings: shallow grooves around the root.
        r *= 1.0 + 0.055 * math.sin(t * rings * 6.283) + 0.03 * (hash01(seed, a) - 0.5)
        z = -length * t
        for k in range(sides):
            ang = k / sides * 6.283185
            verts.append((math.cos(ang) * r, math.sin(ang) * r, z))
            meta.append((t, ang))
    for a in range(ROWS):
        for k in range(sides):
            i0, i1 = a * sides + k, a * sides + (k + 1) % sides
            faces.append((i0, i1, i1 + sides, i0 + sides))
    cap = len(verts)
    verts.append((0, 0, 0.004))
    for k in range(sides):
        faces.append((k, (k + 1) % sides, cap))
    meta.append((0.0, 0.0))
    obj = _mesh(name, verts, faces, mat)
    def skin(i, co, meta=meta):
        t, ang = meta[i]
        # The shoulder is paler where it has seen daylight; rings read as bands.
        shoulder = 1.0 + 0.26 * max(0.0, 1.0 - t * 4.0)
        band = 1.0 - 0.09 * (0.5 + 0.5 * math.cos(t * rings * 6.283))
        mottle = 0.95 + 0.11 * hash01(seed, round(t, 3), round(ang, 2))
        return shade(mix(base, pale, 0.30 * max(0.0, 1.0 - t * 3.0)), shoulder * band * mottle)
    paint(obj, skin)
    return obj

def make_blobs(name, sites, mat, seed, *, colours):
    """Rounded lumps from (centre, radius, colour_index) triples - berries,
    heads, fruit clusters. Voxel scale rewards reading the MASS, not the surface."""
    verts, faces, meta = [], [], []
    for j, (c, r, ci) in enumerate(sites):
        base_i = len(verts)
        rows, cols = 6, 9
        for a in range(rows + 1):
            pv = a / rows * math.pi
            for b in range(cols):
                pu = b / cols * 6.283185
                rr = r * (1.0 + 0.10 * hash01(seed, j, a, b) - 0.05)
                verts.append((c.x + rr * math.sin(pv) * math.cos(pu),
                              c.y + rr * math.sin(pv) * math.sin(pu),
                              c.z + rr * math.cos(pv)))
                meta.append((ci, a / rows))
        for a in range(rows):
            for b in range(cols):
                i0 = base_i + a * cols + b
                i1 = base_i + a * cols + (b + 1) % cols
                faces.append((i0, i1, i1 + cols, i0 + cols))
    obj = _mesh(name, verts, faces, mat)
    paint(obj, lambda i, co, meta=meta: shade(
        colours[meta[i][0]], 0.86 + 0.28 * hash01(seed, i) + 0.10 * (1.0 - meta[i][1])))
    return obj

def profile_at(points, t):
    """Smooth-step through (t, radius_fraction) control points."""
    for i in range(len(points) - 1):
        t0, r0 = points[i]
        t1, r1 = points[i + 1]
        if t <= t1 or i == len(points) - 2:
            f = 0.0 if t1 <= t0 else max(0.0, min(1.0, (t - t0) / (t1 - t0)))
            f = f * f * (3 - 2 * f)
            return r0 + (r1 - r0) * f
    return points[-1][1]

# A bell pepper is BLOCKY: a near-flat shoulder under the calyx, almost straight
# sides, then a rounded lobed base. A plain ovoid profile made flat discs.
BELL = [(0.0, 0.62), (0.10, 0.98), (0.30, 1.00), (0.62, 0.96),
        (0.82, 0.80), (0.94, 0.46), (1.0, 0.16)]
# A strawberry is CONICAL and widest near its shoulder, drawn to a blunt point.
BERRY = [(0.0, 0.52), (0.14, 0.96), (0.28, 1.00), (0.52, 0.86),
         (0.74, 0.60), (0.90, 0.32), (1.0, 0.08)]

def make_fruit(name, length, radius, mat, seed, *, base, pale=None, lobes=0,
              profile=None, dimples=0.0, rows=14, sides=16):
    """A fruit body pointing along -Z from its stalk end. `profile` is a list of
    (t, radius_fraction) control points - see BELL and BERRY."""
    pale = pale or shade(base, 1.18)
    profile = profile or BERRY
    verts, meta, faces = [], [], []
    for a in range(rows + 1):
        t = a / rows
        prof = profile_at(profile, t)
        for k in range(sides):
            ang = k / sides * 6.283185
            r = radius * prof
            if lobes:
                # Swellings with creases between them, deepest toward the base -
                # which is where a bell pepper's bumps actually are.
                r *= 1.0 + 0.13 * math.cos(ang * lobes) * (0.35 + 0.65 * t)
            if dimples:
                r *= 1.0 - dimples * (0.5 + 0.5 * math.sin(ang * 9 + t * 21))
            verts.append((math.cos(ang) * r, math.sin(ang) * r, -length * t))
            meta.append((t, ang))
    for a in range(rows):
        for k in range(sides):
            i0, i1 = a * sides + k, a * sides + (k + 1) % sides
            faces.append((i0, i1, i1 + sides, i0 + sides))
    # Close both ends. The shoulder profile starts at a wide radius, so leaving
    # it open left a hole straight down into the fruit - it read as a cup.
    top_c = len(verts)
    verts.append((0, 0, radius * profile_at(profile, 0.0) * 0.30))
    meta.append((0.0, 0.0))
    for k in range(sides):
        faces.append((top_c, (k + 1) % sides, k))
    bot_c = len(verts)
    verts.append((0, 0, -length - radius * profile_at(profile, 1.0) * 0.45))
    meta.append((1.0, 0.0))
    last = rows * sides
    for k in range(sides):
        faces.append((bot_c, last + k, last + (k + 1) % sides))
    obj = _mesh(name, verts, faces, mat)
    def skin(i, co, meta=meta):
        t, ang = meta[i]
        crease = 1.0 - (0.13 * (0.5 + 0.5 * math.cos(ang * lobes)) if lobes else 0.0)
        sheen = 1.0 + 0.18 * max(0.0, math.cos(ang - 2.2)) * (1.0 - t * 0.6)
        mottle = 0.95 + 0.10 * hash01(seed, round(t, 2), round(ang, 2))
        return shade(mix(base, pale, 0.24 * (1.0 - t)), crease * sheen * mottle)
    paint(obj, skin)
    return obj

def make_calyx(name, at, radius, mat, seed, *, sepals, colour, reflex=34.0, spec=None):
    """The ring of small pointed leaves on a fruit's shoulder - a strawberry's
    reflexed sepals, a pepper's star. Real leaves, not a blob: on a strawberry
    they are as recognisable as the berry."""
    spec = spec or dict(tip=0.82, full=0.46, undulate=0.0, serrate=0.0, rugose=0.0,
                        rib=0.34, veins=0.0, along=6, across=5, droop=0.10)
    made = []
    for k in range(sepals):
        yaw = k * 360.0 / sepals + hash01(seed, k) * 18 - 9
        ln = radius * (1.15 + hash01(seed, k, 1) * 0.45)
        lf = make_leaf(f"{name}_{k}", spec, ln, ln * (0.40 + hash01(seed, k, 2) * 0.14),
                       mat, seed * 7 + k, curl=0.10, twist=(hash01(seed, k, 3) - .5) * 0.4,
                       base=colour, under=1.18, thickness=radius * 0.13)
        # Reflexed: swept back up and away from the fruit.
        lf.rotation_euler = (math.radians(90 + reflex + hash01(seed, k, 4) * 20),
                             math.radians(hash01(seed, k, 5) * 20 - 10), math.radians(yaw))
        lf.location = (at.x, at.y, at.z)
        made.append(lf)
    return made


def make_cap(name, at, radius, mat, seed, *, colour, lobes=5, thickness=None, dish=0.30):
    """The flat green lid on a pepper's shoulder: a shallow lobed disc that sits
    ON the fruit with the stalk rising from its middle. A ring of separate
    reflexed sepals is right for a strawberry and wrong for a pepper - a pepper's
    calyx is a continuous star-shaped plate."""
    thickness = thickness or radius * 0.30
    rows, sides = 3, lobes * 4
    verts, faces, meta = [], [], []
    for layer in (0, 1):
        for a in range(rows + 1):
            t = a / rows
            for k in range(sides):
                ang = k / sides * 6.283185
                # Star lobes, deepest at the rim.
                r = radius * t * (1.0 + 0.24 * math.cos(ang * lobes) * t)
                z = dish * radius * (t * t) * -1.0 + (0.0 if layer else thickness)
                verts.append((at.x + math.cos(ang) * r, at.y + math.sin(ang) * r, at.z + z))
                meta.append(t)
    per = (rows + 1) * sides
    for layer in (0, 1):
        base = layer * per
        for a in range(rows):
            for k in range(sides):
                i0 = base + a * sides + k
                i1 = base + a * sides + (k + 1) % sides
                quad = (i0, i1, i1 + sides, i0 + sides)
                faces.append(quad if layer else quad[::-1])
    for k in range(sides):                      # rim
        i0 = rows * sides + k
        i1 = rows * sides + (k + 1) % sides
        faces.append((i0, i1, i1 + per, i0 + per))
    obj = _mesh(name, verts, faces, mat)
    paint(obj, lambda i, co, meta=meta: shade(
        colour, 0.84 + 0.30 * (1.0 - meta[i]) + 0.12 * hash01(seed, i)))
    return obj

# ----------------------------------------------------------------- sockets ---
SOCKET_PREFIX = "__sock__"

def socket(name, at, mat, size=0.005):
    """A marker cube standing in for a socket.

    Sockets are CELL coordinates on a part, and Blender works in world metres.
    voxels-to-model recentres X and Z around the grid middle and the voxeliser
    never records its grid origin, so converting between them analytically would
    be guesswork. Instead a marker is sent through the IDENTICAL pipeline and its
    centroid read back out afterwards by extract-sockets.mjs, which then deletes
    it. Whatever the transform is, the marker has had it applied.

    `--keepSourceParts` names each catalog part after its source object, so the
    marker is found by NAME - no colour matching, nothing to collide with.
    """
    h = size / 2
    verts = [(at.x + dx * h, at.y + dy * h, at.z + dz * h)
             for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    obj = _mesh(f"{SOCKET_PREFIX}{name}", verts, faces, mat)
    paint(obj, lambda i, co: (1.0, 0.0, 1.0))
    return obj
