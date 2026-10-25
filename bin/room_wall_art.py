"""Build thin paper posters and a naturally draped printed fabric wall hanging.

Blender -b --python bin/room_wall_art.py -- --out <review.blend>
Append/export the six collections with room_model_assets.py and meshopt the selected GLBs.
Images are separate PRINTS textures; this generator never embeds the supplied artwork.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--out", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Bed wall gallery review"
roles = {}


def role(name):
    if name not in roles:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        shader = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        color = m.node_tree.nodes.new("ShaderNodeVertexColor")
        color.layer_name = "Color"
        m.node_tree.links.new(color.outputs["Color"], shader.inputs["Base Color"])
        shader.inputs["Roughness"].default_value = 1 if name == "fabric" else .9
        roles[name] = m
    return roles[name]


def collection(name, description, dimensions, material):
    c = bpy.data.collections.new("asset_" + name)
    scene.collection.children.link(c)
    c.asset_mark()
    c.asset_data.description = description
    c["catalog"], c["mount"], c["elevation"] = "Room/Wall decor", "wall", 0
    c["calibration"] = json.dumps({"nominal_width_height_m": dimensions, "material": material})
    c["license"] = "Original geometry; artwork supplied by site author, rights remain with respective owners"
    return c


def mesh(c, name, vertices, faces, material, color, uv=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    o = bpy.data.objects.new(name, data)
    c.objects.link(o)
    data.materials.append(role(material))
    attr = data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    data.color_attributes.active_color = attr
    for a in attr.data:
        a.color = color
    if uv:
        layer = data.uv_layers.new(name="UVMap")
        for p in data.polygons:
            for li in p.loop_indices:
                layer.data[li].uv = uv[data.loops[li].vertex_index]
    for p in data.polygons:
        p.use_smooth = True
    return o


def pin(c, x, y, z, radius=.0032):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=radius, location=(x,y,z))
    o = bpy.context.object
    o.name = "small_wall_pin"
    o.scale.y = .45
    for old in list(o.users_collection):
        old.objects.unlink(o)
    c.objects.link(o)
    o.data.materials.append(role("metal"))
    a = o.data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    o.data.color_attributes.active_color = a
    for item in a.data:
        item.color = (.25,.23,.19,1)


def sheet(c, width, height, cols, rows, shape, thickness):
    front, uv, faces = [], [], []
    for j in range(rows + 1):
        for i in range(cols + 1):
            u, v = i / cols, j / rows
            front.append(shape(u,v))
            uv.append((u,v))
    for j in range(rows):
        for i in range(cols):
            a = j*(cols+1)+i
            faces.append((a,a+1,a+cols+2,a+cols+1))
    mesh(c, "print", front, faces, "print", (1,1,1,1), uv)
    back = [(x,y+thickness,z) for x,y,z in front]
    mesh(c, "paper_or_fabric_back", back, [tuple(reversed(f)) for f in faces], "fabric", (.91,.90,.86,1))
    boundary = list(range(cols+1)) + [j*(cols+1)+cols for j in range(1,rows+1)]
    boundary += [rows*(cols+1)+i for i in range(cols-1,-1,-1)] + [j*(cols+1) for j in range(rows-1,0,-1)]
    sides = []
    n = len(front)
    for k, a in enumerate(boundary):
        b = boundary[(k+1)%len(boundary)]
        sides.append((a,a+n,b+n,b))
    mesh(c, "thin_edge", front+back, sides, "fabric", (.88,.87,.82,1))


specs = [("poster_40x50", .40,.50), ("poster_45x30",.45,.30),
         ("poster_30x30",.30,.30), ("poster_24x24",.24,.24), ("poster_a3",.420,.297)]
for index, (name, width, height) in enumerate(specs):
    c = collection(name, "Thin matte paper poster, two small top pins, subtle bottom-edge curl; no frame.", [width,height], "Approximately 200 gsm matte coated paper; 0.25 mm thick")

    def paper(u,v):
        # A slight paper curl, mostly at the free bottom corners (millimetres, not a cloth wave).
        curl = .0015 * (1-v)**7 * abs(2*u-1)**4
        return ((u-.5)*width, -.001-curl, v*height)

    sheet(c,width,height,12,12,paper,.00025)
    for x in [-width*.43,width*.43]:
        pin(c,x,-.0022,height-.008)
    c.instance_offset = (index*.6,0,0)
    for o in c.objects:
        o.location.x += index*.6

width, height = 1.20, 1.20*1025/1823
tapestry = collection("wall_tapestry", "Soft printed fabric tapestry with gravity-shaped folds, top-edge sag, wavy free hem and two corner pins.", [width,height], "Matte woven polyester/cotton-style fabric; sewn 3 mm hems; 0.6 mm thick")


def cloth(u,v):
    # Two fixed top corners. The unsupported middle dips and the free cloth comes away from
    # the wall; folds grow toward the lower edge. The surface is static, not a physics world.
    depth = .003 + .006*math.sin(math.pi*u)**2
    depth += (1-v)*(.014 + .010*math.sin(u*8*math.pi+.35))
    depth += .005*math.sin(math.pi*u)*math.sin(v*math.pi)
    sag = .014*math.sin(math.pi*u)**2 * v**4
    hem = .004*(1+math.sin(u*5*math.pi+.4))*(1-v)**8
    return ((u-.5)*width, -depth, v*height-sag+hem)


sheet(tapestry,width,height,64,36,cloth,.0006)
# Narrow fabric hems follow the same flexible surface rather than straight rigid rails.
for axis, value in [("u",0),("u",1),("v",0),("v",1)]:
    verts, faces = [], []
    for j in range(65):
        t = j/64
        for inside in [False,True]:
            if axis == "u":
                u,v = value + ((.003/width)*(1 if value==0 else -1) if inside else 0),t
            else:
                u,v = t,value + ((.003/height)*(1 if value==0 else -1) if inside else 0)
            x,y,z = cloth(u,v)
            verts.append((x,y-.00035,z))
        if j:
            a = (j-1)*2
            faces.append((a,a+1,a+3,a+2))
    mesh(tapestry,"sewn_hem",verts,faces,"fabric",(.78,.74,.66,1))
for u in [.012,.988]:
    x,y,z = cloth(u,.989)
    pin(tapestry,x,y-.001,z,.004)
tapestry["layout"] = json.dumps({"top_corner_supports":2,"top_sag_m":.014,"hem_width_m":.003,"static_drape":True})
tapestry.instance_offset = (3.2,0,0)
for o in tapestry.objects:
    o.location.x += 3.2
args.out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
