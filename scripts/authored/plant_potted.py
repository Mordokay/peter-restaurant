# A potted leafy houseplant, authored as mesh and voxelised.
#
# v5, after comparing v4 against the imported aloe_vera_potted in the lab. The
# authored plant read as flat plastic next to it, and the reason was not the
# pitch - it was that every leaf was ONE colour. voxelize-mesh.py builds its
# shades from the surface colour it samples (baseColorFactor x COLOR_0 x
# baseColorTexture, bilinear); the aloe's source carried textures, so real
# gradients and mottling survived into the voxels. A uniformly tinted mesh gives
# --maxShades nothing to find.
#
# So leaves here are built geometry, not scaled spheres, and they are PAINTED
# per vertex: darker at the base, lighter toward the tip, a pale midrib, and a
# little deterministic mottle. That is what the voxeliser turns into shade bands.
import bpy, math, sys
from mathutils import Vector

# ---------------------------------------------------------------- helpers ---
def hexrgb(h):
    # The voxeliser reads baseColorFactor straight back, so these stay sRGB.
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))

def hash01(*args):
    """Deterministic 0..1 - the plant must be identical on every run."""
    x = 0.0
    for i, a in enumerate(args):
        x += (a + 1.7) * (i * 37.1 + 11.3)
    s = math.sin(x * 127.1) * 43758.5453
    return s - math.floor(s)

def vcol_material(name):
    """A material whose base colour comes from the mesh's COLOR_0 attribute."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    node = nt.nodes.new("ShaderNodeVertexColor")
    node.layer_name = "Col"
    nt.links.new(node.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    return m

def flat_material(name, hexstr):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*hexrgb(hexstr), 1.0)
    bsdf.inputs["Roughness"].default_value = 0.9
    return m

def paint(obj, fn):
    """fn(vertex_index, co) -> (r,g,b). Writes a POINT-domain COLOR_0."""
    mesh = obj.data
    attr = mesh.color_attributes.get("Col") or mesh.color_attributes.new(name="Col", type='FLOAT_COLOR', domain='POINT')
    for i, v in enumerate(mesh.vertices):
        r, g, b = fn(i, v.co)
        attr.data[i].color = (r, g, b, 1.0)

def shade(rgb, factor):
    return tuple(min(1.0, max(0.0, c * factor)) for c in rgb)

# ------------------------------------------------------------------ build ---
bpy.ops.wm.read_factory_settings(use_empty=True)

LEAF_MAT = vcol_material("leaf")
POT_MAT  = vcol_material("pot")
SOIL_MAT = flat_material("soil", "#3a2b21")
STEM_MAT = vcol_material("stem")

ALONG, ACROSS = 24, 11          # leaf tessellation
POT_R_BOT, POT_R_TOP, POT_H = 0.094, 0.128, 0.195

# ---- pot: painted with speckle so the terracotta is not a flat slab ---------
bpy.ops.mesh.primitive_cone_add(vertices=36, radius1=POT_R_BOT, radius2=POT_R_TOP, depth=POT_H, location=(0, 0, POT_H / 2))
pot = bpy.context.active_object; pot.name = "pot"
pot.data.materials.append(POT_MAT)
BASE_CLAY = hexrgb("#b0603a")
def clay(i, co):
    band = 1.0 + 0.10 * math.sin(co.z * 78.0)              # faint throwing rings
    mottle = 0.90 + 0.20 * hash01(round(co.x, 3), round(co.y, 3), round(co.z, 3))
    lift = 0.88 + 0.24 * (co.z / POT_H)                     # lighter toward the rim
    return shade(BASE_CLAY, band * mottle * lift)
paint(pot, clay)

bpy.ops.mesh.primitive_cylinder_add(vertices=36, radius=0.138, depth=0.032, location=(0, 0, 0.186))
rim = bpy.context.active_object; rim.name = "rim"
rim.data.materials.append(POT_MAT)
bpy.ops.object.modifier_add(type='BEVEL')
rim.modifiers["Bevel"].width = 0.009; rim.modifiers["Bevel"].segments = 2
paint(rim, lambda i, co: shade(hexrgb("#c9794b"), 0.92 + 0.22 * hash01(round(co.x, 3), round(co.y, 3))))

bpy.ops.mesh.primitive_cylinder_add(vertices=30, radius=0.120, depth=0.022, location=(0, 0, 0.193))
soil = bpy.context.active_object; soil.name = "soil"
soil.data.materials.append(SOIL_MAT)

# ---- leaves ----------------------------------------------------------------
# yaw, lift(deg), length, width, stalk_z, droop, tone
LEAVES = [
    (  8, 70, 0.215, 0.052, 0.206, 0.34, "#4f8f3f"),
    ( 34, 52, 0.245, 0.058, 0.200, 0.46, "#3f7233"),
    ( 68, 74, 0.190, 0.046, 0.212, 0.28, "#62a44a"),
    ( 96, 44, 0.255, 0.060, 0.198, 0.52, "#3f7233"),
    (126, 66, 0.205, 0.050, 0.207, 0.36, "#4f8f3f"),
    (152, 80, 0.170, 0.042, 0.218, 0.22, "#62a44a"),
    (186, 56, 0.235, 0.056, 0.201, 0.44, "#3f7233"),
    (214, 72, 0.198, 0.048, 0.209, 0.31, "#4f8f3f"),
    (246, 48, 0.250, 0.059, 0.199, 0.49, "#3f7233"),
    (272, 78, 0.178, 0.044, 0.215, 0.25, "#62a44a"),
    (300, 62, 0.222, 0.053, 0.204, 0.39, "#4f8f3f"),
    (330, 84, 0.158, 0.039, 0.222, 0.19, "#62a44a"),
    (352, 58, 0.228, 0.055, 0.203, 0.42, "#3f7233"),
    (118, 88, 0.132, 0.034, 0.228, 0.14, "#6cae55"),
]

for index, (yaw, lift, length, width, stalk_z, droop, tone) in enumerate(LEAVES):
    verts, faces, meta = [], [], []
    for a in range(ALONG + 1):
        v = a / ALONG                                   # 0 stalk .. 1 tip
        # Rounded base, widest around 40%, drawn to a point at the tip.
        halfw = width * (math.sin(math.pi * (v ** 0.78)) ** 0.72)
        for c in range(ACROSS + 1):
            u = c / ACROSS * 2.0 - 1.0                  # -1 .. +1 across
            x = u * halfw
            y = v * length
            rib = (1.0 - min(1.0, abs(u) * 1.9)) ** 2   # central ridge
            z = rib * width * 0.42 * math.sin(math.pi * v)
            z -= droop * length * (v ** 1.9)            # the blade falls away
            verts.append((x, y, z))
            meta.append((u, v))
    for a in range(ALONG):
        for c in range(ACROSS):
            i0 = a * (ACROSS + 1) + c
            faces.append((i0, i0 + 1, i0 + ACROSS + 2, i0 + ACROSS + 1))
    mesh = bpy.data.meshes.new(f"leaf_{index}")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    leaf = bpy.data.objects.new(f"leaf_{index}", mesh)
    bpy.context.collection.objects.link(leaf)
    leaf.data.materials.append(LEAF_MAT)

    base = hexrgb(tone)
    def blade(i, co, meta=meta, base=base, seed=index):
        u, v = meta[i]
        tip = 0.80 + 0.42 * v                            # dark at the base, bright at the tip
        midrib = 1.0 + 0.20 * (1.0 - min(1.0, abs(u) * 1.6)) ** 3
        edge = 1.0 - 0.13 * (abs(u) ** 3)                # edges roll into shadow
        mottle = 0.95 + 0.11 * hash01(seed, round(u, 2), round(v, 2))
        return shade(base, tip * midrib * edge * mottle)
    paint(leaf, blade)

    # Thickness: at a 4 mm pitch a blade needs ~2 voxels or it disappears.
    solid = leaf.modifiers.new("Solidify", 'SOLIDIFY')
    solid.thickness = 0.0085
    solid.offset = 0.0

    leaf.rotation_euler = (math.radians(lift), 0, math.radians(yaw))
    leaf.location = (0, 0, stalk_z)

# ---- stems: deliberately NOT modelled -------------------------------------
# v5 had fourteen of them and every one was a phantom. Two reasons, and both
# are worth remembering when authoring for this pipeline:
#   * they sat inside the soil disc and the leaf bases, so nothing of them was
#     ever visible - a rosette hides its own stems;
#   * voxels-to-model emits parts in order and LATER entries repaint earlier
#     cells, so the leaves (emitted last) stole almost every cell the stems had.
# The result was 14 of 31 rig parts holding 0.74% of the model, one of them a
# single voxel. Occluded geometry is not detail, it is rig overhead: a part is a
# TransformNode, a mesh and a clip track whether or not anyone can see it.
# A plant whose stems SHOW (a bay branch) needs them >= 3 voxels thick and
# clear of the foliage - not this one.

for o in bpy.data.objects:
    for p in o.data.polygons:
        p.use_smooth = False

zs = [(o.matrix_world @ Vector(c)).z for o in bpy.data.objects for c in o.bound_box]
print("HEIGHT", round(max(zs) - min(zs), 4))
out = sys.argv[-1]
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True,
                          export_materials='EXPORT', export_vertex_color='ACTIVE')
print("EXPORTED", out, "parts:", len(bpy.data.objects))
