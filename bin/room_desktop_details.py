"""Original soft tissue packet and an approximately 11-inch black tablet.

Blender -b --python bin/room_desktop_details.py -- --out <review.blend>
Append/export tissue_pack and tablet with room_model_assets.py; meshopt afterwards.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Desktop details review"
roles = {}


def role(name):
    if name not in roles:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        shader = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Color"
        m.node_tree.links.new(attr.outputs["Color"], shader.inputs["Base Color"])
        shader.inputs["Roughness"].default_value = .5
        roles[name] = m
    return roles[name]


def collection(name, description):
    c = bpy.data.collections.new("asset_" + name)
    scene.collection.children.link(c)
    c.asset_mark()
    c.asset_data.description = description
    c["catalog"], c["mount"], c["elevation"] = "Room/Desk props", "desk", .74
    c["license"] = "Original geometry"
    return c


def paint(o, material, color):
    o.data.materials.append(role(material))
    attr = o.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    o.data.color_attributes.active_color = attr
    for entry in attr.data:
        entry.color = color


def box(c, name, size, at, color, material="frame", bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = o.modifiers.new("Rounded edges", "BEVEL")
    mod.width, mod.segments = min(bevel, min(size) * .48), 4
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for old in list(o.users_collection):
        old.objects.unlink(o)
    c.objects.link(o)
    paint(o, material, color)
    return o


tissues = collection("tissue_pack", "Original soft mint-and-cream tissue packet with a folded white tissue; 180 x 100 x 55 mm packet.")
box(tissues, "soft_packet", (.180,.100,.055), (0,0,.0275), (.53,.78,.73,1), bevel=.018)
box(tissues, "cream_top", (.153,.080,.006), (0,0,.053), (.90,.88,.81,1), bevel=.003)
box(tissues, "opening", (.093,.023,.001), (0,0,.0564), (.10,.16,.16,1), bevel=.00048)
# A low central stack covers the opening; the raised sheet is a folded, irregular ribbon.
box(tissues, "folded_stack", (.079,.017,.002), (0,0,.0575), (.97,.96,.92,1), "fabric", bevel=.0009)
vertices, faces = [], []
rows, cols = 6, 10
for j in range(rows + 1):
    v = j / rows
    for i in range(cols + 1):
        u = i / cols
        x = (u - .5) * (.065 + .008 * v)
        y = .002 + v * .008 + math.sin(u*math.pi*4 + v) * (.002 + .002*v)
        z = .058 + v*.043 + math.sin(u*math.pi*3+.5)*.004*v
        vertices.append((x, y, z))
for j in range(rows):
    for i in range(cols):
        a = j*(cols+1)+i
        faces.append((a,a+1,a+cols+2,a+cols+1))
mesh = bpy.data.meshes.new("Folded tissue")
mesh.from_pydata(vertices, [], faces)
mesh.update()
o = bpy.data.objects.new("raised_tissue", mesh)
tissues.objects.link(o)
paint(o, "fabric", (.97,.96,.92,1))
for p in mesh.polygons:
    p.use_smooth = True
tissues["calibration"] = json.dumps({"packet_m": [.18,.10,.055]})

tablet = collection("tablet", "Original black tablet lying flat, approximately 11-inch 4:3 inactive display, 242 x 180 x 6 mm body.")
box(tablet, "tablet_body", (.242,.180,.006), (0,0,.003), (.012,.014,.019,1), "metal", bevel=.0028)
# Screen is a solid dark surface; no image, light or update loop.
box(tablet, "tablet_display", (.22352,.16764,.00035), (0,0,.00605), (.002,.003,.005,1), "screen", bevel=.00016)
box(tablet, "front_camera", (.002,.002,.0003), (0,.086,.0061), (.005,.006,.008,1), bevel=.00014)
box(tablet, "power_button", (.012,.0008,.0015), (.085,.0902,.003), (.025,.028,.033,1), "metal", bevel=.00035)
tablet["calibration"] = json.dumps({"body_m": [.242,.180,.006], "display_m": [.22352,.16764], "diagonal_inches": 11, "screen_off": True})
tablet.instance_offset = (.4,0,0)
for o in tablet.objects:
    o.location.x += .4
args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
