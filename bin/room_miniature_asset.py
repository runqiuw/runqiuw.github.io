"""Build a texture-free 1:20 toy-room asset in the configured Blender library.

Run with the library open: blender -b <library> --python this_script -- <output-dir>
Only asset_room_miniature and its GLB/manifest entry change. Meshopt afterwards.
The room outline and furniture poses come from room.config.ts; tiny props and all
runtime behavior are deliberately omitted. Four material groups, no extra lights.
"""
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector

root = Path(__file__).resolve().parent.parent
config = (root / "src/scripts/room.config.ts").read_text()
out = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
scene = bpy.data.scenes["Assets"]
bpy.context.window.scene = scene
name = "room_miniature"
old = bpy.data.collections.get("asset_" + name)
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(old)
coll = bpy.data.collections.new("asset_" + name)
scene.collection.children.link(coll)
coll.asset_mark()
coll.asset_data.description = "Texture-free 1:20 cutaway toy room: measured L floor, window wall, bed, desk, TV corner and shelf. Four merged material groups; theme-driven window/screen/lamp surfaces, no lights or live reflection."
coll["catalog"] = "Sections/Projects"
coll["mount"] = "shelf"
shelf = bpy.data.collections.get("asset_shelf")
if shelf and shelf.asset_data:
    coll.asset_data.catalog_id = shelf.asset_data.catalog_id

materials = {}
for role in ("mini_body", "mini_window", "mini_lamp", "mini_screen"):
    mat = bpy.data.materials.get(role) or bpy.data.materials.new(role)
    mat.use_nodes = True
    mat.use_backface_culling = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    attr = next((n for n in mat.node_tree.nodes if n.type == "VERTEX_COLOR"), None)
    if not attr:
        attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Color"
    mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.8
    materials[role] = mat

def finish(obj, label, color, role="mini_body", bevel=0):
    obj.name = label
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new("Toy edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2 if bevel >= 0.05 else 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.clear()
    obj.data.materials.append(materials[role])
    attr = obj.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    rgba = tuple(int(color[i:i+2], 16) / 255 for i in (1, 3, 5)) + (1,)
    for v in attr.data:
        v.color_srgb = rgba
    obj.data.color_attributes.active_color = attr
    obj.select_set(False)
    return obj

def box(label, at, size, color, role="mini_body", bevel=0.025, yaw=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.object
    obj.dimensions = size
    obj.rotation_euler.z = math.radians(yaw)
    return finish(obj, label, color, role, min(bevel, min(size) * 0.24))

def cylinder(label, at, radius, depth, color, role="mini_body", vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=at)
    return finish(bpy.context.object, label, color, role)

def pose(key):
    line = re.search(r"\{ id: '" + re.escape(key) + r"',[^\n]+", config).group()
    xy = json.loads(re.search(r"at: (\[[^]]+\])", line).group(1))
    yaw = re.search(r"yaw: (-?[\d.]+)", line)
    return xy, float(yaw.group(1)) if yaw else 0

def part(key, label, xyz, size, color, role="mini_body", bevel=0.025):
    xy, yaw = pose(key)
    a = math.radians(yaw)
    x, y, z = xyz
    return box(label, (xy[0]+x*math.cos(a)-y*math.sin(a), xy[1]+x*math.sin(a)+y*math.cos(a), z), size, color, role, bevel, yaw)

navy, blue, orange = "#2b3170", "#3d5afe", "#ffb36b"
mint, bedding, paper = "#1fbf93", "#9aa5c8", "#f4f2ff"
# Full-size construction coordinates; the final transform uniformly scales to 1:20.
box("Display plinth", (2.065, 1.85, -0.06), (4.48, 4.04, 0.12), "#dfc4a4", bevel=0.09)
outline = json.loads(re.search(r"outline: (\[\[.*?\]\]) as Plan", config).group(1))
verts = [(x, y, z) for z in (0, 0.055) for x, y in outline]
n = len(outline)
faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
data = bpy.data.meshes.new("Measured L floor")
data.from_pydata(verts, [], faces)
obj = bpy.data.objects.new("Measured L floor", data)
coll.objects.link(obj)
finish(obj, "Measured L floor", "#ffd2a0")
box("Desk wall", (1.73, 3.72, 1.35), (3.56, 0.10, 2.7), paper)
# Window openings: keep actual jambs and mullions rather than solid blue rectangles.
for a, b in ((0, .8), (1.67, 1.95), (2.82, 3.7)):
    box("West wall pier", (-.025, (a+b)/2, 1.35), (.10, b-a, 2.7), "#ebe8ff")
for cy in (1.235, 2.385):
    box("Window wall below", (-.025, cy, .31), (.10, .87, .62), "#ebe8ff")
    box("Window wall above", (-.025, cy, 2.56), (.10, .87, .28), "#ebe8ff")
    box("Window sky", (-.065, cy, 1.52), (.025, .84, 1.8), "#a6d8f5", "mini_window", 0)
    for y in (cy-.45, cy+.45, cy):
        box("Blue window upright", (.025, y, 1.52), (.10, .045, 1.89), blue, bevel=.008)
    for z in (.59, 1.20, 1.82, 2.45):
        box("Blue window rail", (.025, cy, z), (.10, .94, .045), blue, bevel=.008)
# Low cut edges describe the rest of the outline without obscuring the dollhouse.
box("Entry cut edge", (4.13, .9, .12), (.08, 1.8, .24), paper)
box("Closet return", (3.8, 1.8, .20), (.67, .08, .40), paper)
box("Closet cut edge", (3.46, 2.75, .12), (.08, 1.9, .24), paper)

part("bed", "Bed base", (0, 0, .25), (1.054, 2.036, .40), blue)
part("bed", "Mattress", (0, -.035, .51), (.98, 1.92, .18), bedding, bevel=.08)
part("bed", "Headboard", (0, .96, .66), (1.054, .10, .75), blue)
part("bed", "Headboard insert", (0, .90, .78), (.87, .025, .30), "#ff9a72", bevel=0)
part("bed", "Pillow", (0, .57, .65), (.72, .40, .13), "#b9c2dc", bevel=.055)
part("bed", "Folded duvet", (0, -.30, .63), (.99, 1.23, .09), bedding)
for x, y, col in ((-.22, -.05, "#ffcb05"), (.22, -.25, "#b32836"), (-.20, -.55, "#d92336")):
    part("bed", "School cushion", (x, y, .73), (.25, .25, .13), col, bevel=.045)
part("nightstand", "Mint bedside cabinet", (0, 0, .40), (.409, .316, .64), mint)
for z in (.20, .38, .56):
    part("nightstand", "Drawer handle", (0, -.17, z), (.13, .028, .025), "#16886e", bevel=.005)
part("desk", "Desktop", (0, 0, .71), (1.60, .63, .06), navy)
for x in (-.67, .67):
    for y in (-.24, .24):
        part("desk", "Desk leg", (x, y, .37), (.07, .07, .69), navy)
for key in ("monitorL", "monitorR"):
    part(key, "Monitor foot", (0, 0, .765), (.23, .19, .035), navy)
    part(key, "Monitor stem", (0, .025, .93), (.055, .06, .30), navy)
    part(key, "Monitor bezel", (0, 0, 1.12), (.54, .06, .32), "#15172a")
    part(key, "Monitor picture", (0, -.033, 1.12), (.48, .012, .26), "#5285c4", "mini_screen", .005)
part("desk", "Blue desk mat", (0, -.10, .752), (.95, .32, .015), "#6288ad", bevel=.008)
part("desk", "Keyboard", (0, -.14, .778), (.34, .12, .035), "#d2d9e5", bevel=.012)
part("pc", "PC tower", (0, 0, .91), (.18, .28, .34), "#93adb0")
part("chair", "Chair seat", (0, 0, .49), (.48, .46, .10), "#ff6b5e", bevel=.045)
part("chair", "Chair back", (0, .20, .78), (.47, .08, .49), "#ff6b5e", bevel=.04)
xy, _ = pose("chair")
cylinder("Chair pedestal", (*xy, .29), .045, .33, navy)
cylinder("Chair star foot", (*xy, .10), .29, .045, navy, vertices=5)
part("officeRug", "Office rug", (0, 0, .075), (1.65, 1.35, .035), "#8cb9ba", bevel=.014)
part("rug", "TV rug", (0, 0, .075), (1.05, .85, .035), "#a2b8c0", bevel=.014)

part("tvstand", "TV cabinet", (0, 0, .28), (1.20, .445, .44), orange)
for x in (-.40, .40):
    part("tvstand", "Cabinet doors", (x, -.229, .28), (.365, .025, .36), "#ee9c66", bevel=.008)
part("tvstand", "Open games bay", (0, -.230, .28), (.35, .025, .32), navy, bevel=0)
for x, color in ((-.10, "#ffba3d"), (0, "#e7e9ed"), (.10, "#52c59e")):
    part("tvstand", "Game spine", (x, -.25, .26), (.07, .035, .20), color, bevel=.005)
part("tv", "TV bezel", (0, 0, .97), (1.02, .065, .61), "#15172a")
part("tv", "TV picture", (0, -.037, .97), (.94, .012, .53), "#397aa3", "mini_screen", .005)
part("tv", "TV stand", (0, 0, .57), (.38, .22, .09), navy)
part("pinboard", "Corkboard", (0, -.01, 1.84), (1.5, .055, .85), "#c4925e")
for x, z, col in ((-.46, 1.98, "#f5e5a7"), (0, 1.90, "#a3caba"), (.45, 1.78, "#f0e9dd")):
    part("pinboard", "Pinned note", (x, -.044, z), (.32, .014, .30), col, bevel=.003)
# Empty miniature shelf: no recursively nested model or copied project runtime.
for x in (-.38, .38):
    part("shelf", "Shelf side", (x, 0, .78), (.04, .30, 1.5), orange)
for z in (.075, .4313, .7875, 1.1438, 1.5):
    part("shelf", "Shelf board", (0, 0, z), (.8, .30, .035), orange, bevel=.006)
for i, z in enumerate((.50, .86, 1.22)):
    for x in (-.19, .19):
        part("shelf", "Simplified exhibit", (x, 0, z), (.21, .18, .13), ("#e8edf2", "#ff9a42", "#94b8bf")[i])
for key, z in (("lamp", 1.72), ("bedLamp", .93)):
    xy, _ = pose(key)
    base_z = 0 if key == "lamp" else .72
    cylinder("Lamp base", (*xy, base_z+.025), .13 if key == "lamp" else .10, .05, "#ffc93c")
    cylinder("Lamp stem", (*xy, (z+base_z)/2), .018, z-base_z, "#e9b939", vertices=8)
    cylinder("Lamp shade", (*xy, z), .13 if key == "lamp" else .10, .12, "#ffe2a0", "mini_lamp")
xy, _ = pose("plant")
cylinder("Terracotta pot", (*xy, .22), .16, .32, "#b8794f")
cylinder("Plant stem", (*xy, .61), .027, .55, "#4f8152", vertices=8)
for x, y, z, rot in ((-.13, 0, .62, -30), (.12, .02, .76, 25), (-.10, .04, .91, -20), (.08, 0, 1.04, 30)):
    box("Broad leaf", (xy[0]+x, xy[1]+y, z), (.22, .10, .055), "#58a167", bevel=.022, yaw=rot)

# Merge into one object, four primitives by material. All colors stay in the vertices.
bpy.ops.object.select_all(action="DESELECT")
for obj in coll.objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = next(iter(coll.objects))
bpy.ops.object.join()
obj = bpy.context.object
obj.name = name
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in obj.data.vertices:
    v.co = Vector(((v.co.x-2.065)/20, (v.co.y-1.85)/20, (v.co.z+.12)/20))
for uv in list(obj.data.uv_layers):
    obj.data.uv_layers.remove(uv)
obj.data.validate()
lo = Vector(tuple(min(v.co[i] for v in obj.data.vertices) for i in range(3)))
hi = Vector(tuple(max(v.co[i] for v in obj.data.vertices) for i in range(3)))
out.mkdir(parents=True, exist_ok=True)
file = out / (name + ".glb")
bpy.ops.export_scene.gltf(filepath=str(file), export_format="GLB", use_selection=True,
    export_apply=True, export_vertex_color="ACTIVE", export_cameras=False,
    export_lights=False, export_materials="EXPORT", export_attributes=True)
manifest_file = out / "manifest.json"
manifest = json.loads(manifest_file.read_text())
manifest["assets"][name] = {
    "file": file.name, "catalog": coll["catalog"], "mount": "shelf",
    "size": [round(v, 5) for v in hi-lo], "elevation": 0,
    "roles": list(materials), "triangles": sum(len(p.vertices)-2 for p in obj.data.polygons),
    "bytes": file.stat().st_size, "description": coll.asset_data.description,
}
manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")
# Store it away from existing assets; the standard exporter removes this offset.
offset = Vector((max(c.instance_offset.x for c in scene.collection.children)+1.5, 0, 0))
coll.instance_offset = offset
obj.location += offset
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("Toy room exported:", manifest["assets"][name])
