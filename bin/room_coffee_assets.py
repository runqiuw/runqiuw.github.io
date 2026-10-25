"""Prepare the user-provided Logitech desk mat and an original ceramic coffee mug.

Blender -b --python bin/room_coffee_assets.py -- --mat <logitechdeskmat.glb> --out <review.blend>
Append/export deskmat and coffee_mug with room_model_assets.py; meshopt afterwards.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument("--mat", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Coffee desk review"
roles = {}


def role(name):
    if name not in roles:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        shader = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Color"
        m.node_tree.links.new(attr.outputs["Color"], shader.inputs["Base Color"])
        shader.inputs["Roughness"].default_value = .7 if name == "fabric" else .4
        roles[name] = m
    return roles[name]


def collection(name, description):
    c = bpy.data.collections.new("asset_" + name)
    scene.collection.children.link(c)
    c.asset_mark()
    c.asset_data.description = description
    c["catalog"], c["mount"], c["elevation"] = "Room/Desk props", "desk", .74
    return c


def colour(mesh, names, colors):
    indices = [p.material_index for p in mesh.polygons]
    mesh.materials.clear()
    for name in names:
        mesh.materials.append(role(name))
    attr = mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    mesh.color_attributes.active_color = attr
    for face, index in zip(mesh.polygons, indices):
        face.material_index = index
        for li in face.loop_indices:
            attr.data[li].color = colors[face.material_index]


mat = collection("deskmat", "Logitech Desk Mat Blue, adapted from PolyDavid (CC BY 4.0); 700 x 300 x 2 mm.")
bpy.ops.import_scene.gltf(filepath=str(args.mat))
ob = next(o for o in scene.objects if o.type == "MESH")
transform = Matrix.Rotation(math.pi / 2, 4, "Z") @ ob.matrix_world
ob.data.transform(transform)
ob.matrix_world = Matrix.Identity(4)
points = [v.co for v in ob.data.vertices]
lo = Vector(tuple(min(v[i] for v in points) for i in range(3)))
hi = Vector(tuple(max(v[i] for v in points) for i in range(3)))
size = (.7, .3, .002)
for v in ob.data.vertices:
    v.co = Vector(tuple((v.co[i] - (lo[i] if i == 2 else (lo[i] + hi[i]) / 2)) * size[i] / (hi[i] - lo[i]) for i in range(3)))
for old in list(ob.users_collection):
    old.objects.unlink(ob)
mat.objects.link(ob)
ob.name = "deskmat"
# The supplied image is restored through PRINTS, with the original UVs.
for p in ob.data.polygons:
    p.material_index = 0 if p.material_index == 0 else 1
colour(ob.data, ["print", "fabric"], [(.43, .49, .74, 1), (.025, .03, .07, 1)])
mat["license"] = "CC-BY-4.0"
mat["credits"] = json.dumps({"author": "PolyDavid", "source": "https://sketchfab.com/3d-models/free-logitech-desk-mat-blue-95d618deea6a4eae826f6eae33bd00d3"})
mat["calibration"] = json.dumps({"body_m": list(size), "reference": "https://www.logitech.com/en-us/shop/p/desk-mat-studio-series"})

mug = collection("coffee_mug", "Original cream ceramic mug with a thick rim, open interior, coffee and a rounded handle; 95 mm high.")
vertices, faces, material_ids = [], [], []


def lathe(profile, material_index, segments=48):
    start = len(vertices)
    for r, z in profile:
        vertices.extend((r * math.cos(2 * math.pi * j / segments), r * math.sin(2 * math.pi * j / segments), z) for j in range(segments))
    for i in range(len(profile) - 1):
        for j in range(segments):
            faces.append((start+i*segments+j, start+i*segments+(j+1)%segments, start+(i+1)*segments+(j+1)%segments, start+(i+1)*segments+j))
            material_ids.append(material_index)


# Closed cross-section, including the interior wall and inner floor.
lathe([(0,.002),(.026,.002),(.031,0),(.035,0),(.036,.004),(.038,.009),(.041,.079),(.042,.089),(.0418,.093),(.0405,.095),(.0385,.095),(.0372,.093),(.037,.089),(.033,.013),(.029,.009),(0,.009)], 0)
# A dark liquid surface below the rim, with a gently raised meniscus.
lathe([(.0366,.0824),(.034,.0815),(0,.0815)], 1)
# Swept C-shaped handle, attached at both ends to the cup wall, facing +X.
base = len(vertices)
steps, sides = 28, 10
for i in range(steps+1):
    a = -math.pi / 2 + math.pi * i / steps
    centre = Vector((.036 + .027 * math.cos(a), 0, .049 + .029 * math.sin(a)))
    normal = Vector((math.cos(a), 0, math.sin(a)))
    for j in range(sides):
        b = 2 * math.pi * j / sides
        v = centre + .006 * (normal * math.cos(b) + Vector((0,math.sin(b),0)))
        vertices.append(tuple(v))
for i in range(steps):
    for j in range(sides):
        faces.append((base+i*sides+j,base+i*sides+(j+1)%sides,base+(i+1)*sides+(j+1)%sides,base+(i+1)*sides+j))
        material_ids.append(0)
mesh = bpy.data.meshes.new("Coffee mug mesh")
mesh.from_pydata(vertices, [], faces)
mesh.update()
for p, material_index in zip(mesh.polygons, material_ids):
    p.material_index = material_index
    p.use_smooth = True
colour(mesh, ["accent", "frame"], [(.82,.74,.61,1), (.028,.009,.003,1)])
obj = bpy.data.objects.new("coffee_mug", mesh)
mug.objects.link(obj)
mug["components"] = json.dumps({"cup": {"diameter": .084, "height": .095}, "coffee": {"height": .0824, "radius": .0366}})
mug["layout"] = json.dumps({"steam_origin": [0,0,.084], "handle": "+X"})
mug.instance_offset = (1,0,0)
obj.location.x = 1
args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
