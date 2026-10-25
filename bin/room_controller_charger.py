"""Prepare a shared Xbox controller, a phone charging stand, and the console without old pads.

Blender -b --python bin/room_controller_charger.py -- --controller <source.glb>
  --phone <iphone.glb> --library <room_assets.blend> --out <review.blend> --texture <atlas.png>
Append/export xbox_controller, phone_charger and console with room_model_assets.py; meshopt afterwards.
Source attribution is in public/room/assets/CREDITS.txt.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
for name in ("controller", "phone", "library", "out", "texture"):
    parser.add_argument("--" + name, required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Controller and charging stand review"
materials = {}


def role(name):
    if name not in materials:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        shader = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        color = m.node_tree.nodes.new("ShaderNodeVertexColor")
        color.layer_name = "Color"
        m.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
        shader.inputs["Roughness"].default_value = .48
        materials[name] = m
    return materials[name]


def collection(name, description):
    c = bpy.data.collections.new("asset_" + name)
    scene.collection.children.link(c)
    c.asset_mark()
    c.asset_data.description = description
    c["catalog"], c["mount"], c["elevation"] = "Room/Desk props", "desk", .74
    return c


def import_meshes(file, coll):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(file))
    bpy.context.view_layer.update()
    imported = set(bpy.data.objects) - before
    meshes = [o for o in imported if o.type == "MESH"]
    transforms = {o: o.matrix_world.copy() for o in meshes}
    for o in meshes:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(transforms[o])
        for old in list(o.users_collection):
            old.objects.unlink(o)
        coll.objects.link(o)
    for o in imported - set(meshes):
        bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def bounds(objects):
    points = [v.co for o in objects for v in o.data.vertices]
    return (Vector(tuple(min(p[i] for p in points) for i in range(3))),
            Vector(tuple(max(p[i] for p in points) for i in range(3))))


def paint(obj, name, color):
    obj.data.materials.clear()
    obj.data.materials.append(role(name))
    attr = obj.data.color_attributes.get("Color") or obj.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    obj.data.color_attributes.active_color = attr
    for p in obj.data.polygons:
        p.material_index = 0
        for i in p.loop_indices:
            attr.data[i].color = color


def simplify(obj, target):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mesh = obj.data
    if mesh.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0000005)
    bm.to_mesh(mesh)
    bm.free()
    tri = sum(len(p.vertices) - 2 for p in mesh.polygons)
    if tri > target:
        mod = obj.modifiers.new("Room detail budget", "DECIMATE")
        mod.ratio = target / tri
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True


xbox = collection("xbox_controller", "Black Xbox wireless controller; Chistodrako._. (CC BY 4.0), simplified, resting face up.")
objects = import_meshes(args.controller, xbox)
obj = objects[0]
shader = next(n for n in obj.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
image = next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
image.filepath_raw = str(args.texture)
image.file_format = "PNG"
image.save()
# Remove the source's standing presentation pose. Choose its thinnest face-up resting angle.
points = np.array([v.co for o in objects for v in o.data.vertices])
angles = np.linspace(-150, -30, 241)
angle = min(angles, key=lambda a: np.ptp(points[:, 1] * math.sin(math.radians(a)) + points[:, 2] * math.cos(math.radians(a))))
turn = Matrix.Rotation(math.radians(angle), 4, "X")
for o in objects:
    o.data.transform(turn)
lo, hi = bounds(objects)
factor = .153 / (hi.x - lo.x)
centre = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
for o in objects:
    for v in o.data.vertices:
        v.co = (v.co - centre) * factor
    simplify(o, 11000)
    paint(o, "frame", (.014, .017, .024, 1))
    o.data.materials.append(role("print"))
    o.data.update()
    for p in o.data.polygons:
        if p.normal.z > .25:
            p.material_index = 1
lo, hi = bounds(objects)
for o in objects:
    for v in o.data.vertices:
        v.co.z -= lo.z
xbox["license"] = "CC-BY-4.0"
xbox["credits"] = json.dumps({"author": "Chistodrako._.", "source": "https://sketchfab.com/3d-models/xbox-inalambric-controller-black-29cc9624894a4f2cae7d2a675044db45", "mirror": "https://sceneview.github.io/credits.html"})
xbox["calibration"] = json.dumps({"width_m": .153, "resting_angle_degrees": float(angle), "measured_m": [round(v,6) for v in hi-lo]})
print("Xbox resting angle", angle, "size", list(hi-lo))

charger = collection("phone_charger", "Original upright wireless charging stand with a calibrated iPhone 13 Pro Max (DatSketch, CC BY 4.0), tilted back 15 degrees.")
phones = import_meshes(args.phone, charger)
for o in list(phones):
    if "Logo" in o.name or "Screen Glass" in o.name:
        phones.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
frame = next(o for o in phones if o.name.startswith("Frame_Frame_"))
lo, hi = bounds([frame])
factor = Vector((.0781/(hi.x-lo.x), .00765/(hi.y-lo.y), .1608/(hi.z-lo.z)))
centre = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
tilt = Matrix.Rotation(math.radians(-15), 4, "X")
turn = tilt @ Matrix.Rotation(math.pi, 4, "Z")
bottom = Vector((0,-.012,.018))
for o in phones:
    for v in o.data.vertices:
        v.co = turn @ ((v.co - centre) * factor) + bottom
    tri = sum(len(p.vertices)-2 for p in o.data.polygons)
    simplify(o, max(24, int(tri*.22)))
    name = o.name.lower()
    if "wallpaper" in name:
        paint(o, "screen", (.002,.003,.005,1))
    elif "frame" in name or name == "body_body_0":
        paint(o, "metal", (.17,.28,.39,1))
    else:
        paint(o, "frame", (.012,.022,.038,1))
    if "wallpaper" not in name:
        for uv in list(o.data.uv_layers):
            o.data.uv_layers.remove(uv)
phone_lo, phone_hi = bounds(phones)
for o in phones:
    for v in o.data.vertices:
        v.co.z += .018 - phone_lo.z


def box(name, size, centre, color, material="frame", rotation=None, bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    if rotation:
        o.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = o.modifiers.new("Soft edges", "BEVEL")
    mod.width, mod.segments = min(bevel,min(size)*.48), 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for old in list(o.users_collection):
        old.objects.unlink(o)
    charger.objects.link(o)
    paint(o, material, color)
    return o


white = (.88,.89,.91,1)
box("charging_base", (.090,.105,.008), (0,0,.004), white, bevel=.004)
support = bottom + tilt @ Vector((0,.011,.063))
box("charging_back", (.071,.012,.100), support, white, rotation=(math.radians(-15),0,0), bevel=.005)
box("charging_upright", (.047,.025,.065), (0,.024,.0405), white, bevel=.004)
box("phone_cradle", (.068,.024,.010), (0,-.013,.013), white)
box("charge_indicator", (.010,.0006,.0016), (0,-.0528,.0047), (.2,.85,.55,1), "accent", bevel=.0003)
charger["license"] = "Phone: CC-BY-4.0; stand: original geometry"
charger["credits"] = json.dumps({"phone_author": "DatSketch", "phone_source": "https://sketchfab.com/3d-models/apple-iphone-13-pro-max-4328dea00e47497dbeac73c556121bc9"})
charger["calibration"] = json.dumps({"phone_body_m": [.0781,.00765,.1608], "base_m": [.09,.105,.008], "tilt_degrees": 15})
charger.instance_offset = (.4,0,0)
for o in charger.objects:
    o.location.x += .4

# Keep the original console unit and remove its two old, stylised controllers.
with bpy.data.libraries.load(str(args.library), link=False) as (source, target):
    target.collections = ["asset_console"]
console = target.collections[0]
scene.collection.children.link(console)
bpy.context.view_layer.update()
for o in console.objects:
    if o.parent is None:
        o.location -= console.instance_offset
console.instance_offset = (0,0,0)
bpy.context.view_layer.update()
for o in console.objects:
    if o.type != "MESH":
        continue
    bm = bmesh.new()
    bm.from_mesh(o.data)
    remove = [v for v in bm.verts if abs((o.matrix_world @ v.co).x) > .2]
    bmesh.ops.delete(bm, geom=remove, context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
console.asset_data.description = "Compact game console unit; controllers are separate Xbox assets."
console.instance_offset = (.8,0,0)
for o in console.objects:
    if o.parent is None:
        o.location.x += .8
args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
