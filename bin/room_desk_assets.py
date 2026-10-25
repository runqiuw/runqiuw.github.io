"""Prepare the selected, downloaded desk models in a separate review blend.

Blender --background --python bin/room_desk_assets.py -- --sources <directory> --out <review.blend>
Sources: keyboard/source/keyboard.glb, computer_mouse.glb,
speaker/source/flip-6-black-android-ar-asset.glb (Sketchfab; see CREDITS.txt).
Append with room_model_assets.py, then meshopt-compress the three exported GLBs.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument("--sources", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = "Desk model review"
roles = {}


def material(role):
    if role not in roles:
        m = bpy.data.materials.new(role)
        m.use_nodes = True
        p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        p.inputs["Roughness"].default_value = .9 if role == "fabric" else .55
        if role != "print":
            attr = m.node_tree.nodes.new("ShaderNodeVertexColor")
            attr.layer_name = "Color"
            m.node_tree.links.new(attr.outputs["Color"], p.inputs["Base Color"])
        roles[role] = m
    return roles[role]


def bounds(objects):
    pts = [v.co for o in objects for v in o.data.vertices]
    return (Vector(tuple(min(p[i] for p in pts) for i in range(3))),
            Vector(tuple(max(p[i] for p in pts) for i in range(3))))


specs = [
    ("keyboard_v2", "keyboard/source/keyboard.glb", ( .3299, .12325, .04),
     "Keychron V2 Knob Keyboard", "RelaxedImpala", "235cd5b3bfea471eb6bd88ddc2d826d6",
     "https://www.keychron.com/products/keychron-v2-qmk-custom-mechanical-keyboard", 18000),
    ("mouse_superlight", "computer_mouse.glb", (.0635, .125, .04),
     "Computer mouse", "zhe_kan", "6e7940d9e2144efeae3468a906f27e07",
     "https://www.logitechg.com/en-ch/products/gaming-mice/pro-x-superlight-wireless-mouse.910-005942.html", 11000),
    ("jbl_flip6", "speaker/source/flip-6-black-android-ar-asset.glb", (.178, .072, .068),
     "JBL Flip 6", "polyman Studio", "b52362c876b640adaafe233ab0a942a8",
     "https://www.jbl.com/on/demandware.static/-/Sites-masterCatalog_Harman/default/dw0a39b813/pdfs/JBL_Flip_6_SpecSheet_English.pdf", 12000),
]

for index, (name, file, size, title, author, uid, reference, budget) in enumerate(specs):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(args.sources / file))
    imported = set(bpy.data.objects) - before
    objects = [o for o in imported if o.type == "MESH" and not (name == "keyboard_v2" and o.name == "Plane")]
    coll = bpy.data.collections.new("asset_" + name)
    scene.collection.children.link(coll)
    coll.asset_mark()
    coll["catalog"] = "Room/Desk props"
    coll["mount"] = "desk"
    coll["elevation"] = .74
    coll["license"] = "CC-BY-4.0"
    coll["credits"] = json.dumps({"title": title, "author": author,
                                     "source": "https://sketchfab.com/models/" + uid})
    coll.asset_data.description = title + "; calibrated desk prop, adapted from " + author + " (CC BY 4.0)."
    for obj in objects:
        transform = Matrix.Identity(4) if name == "keyboard_v2" else obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        obj.data.transform(transform)
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        coll.objects.link(obj)
    for obj in imported - set(objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    # The Flip's loose carrying loop extends beyond the manufacturer's rigid-body envelope.
    body = [o for o in objects if not (name == "jbl_flip6" and o.name in {"Rope", "Rope Plastic"})]
    lo, hi = bounds(body)
    factor = Vector(tuple(size[i] / (hi[i] - lo[i]) for i in range(3)))
    origin = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects)
    for obj in objects:
        for v in obj.data.vertices:
            v.co = (v.co - origin) * factor
        mesh = obj.data
        src = mesh.materials[0] if mesh.materials else None
        src_name = src.name.lower() if src else ""
        shader = next((n for n in src.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if src and src.use_nodes else None
        color = tuple(shader.inputs["Base Color"].default_value) if shader else (.04, .05, .065, 1)
        role = "frame"
        if name == "mouse_superlight":
            color = (.025, .032, .045, 1)
            if "roll" in src_name:
                role = "metal" if src_name == "roll" else "frame"
                color = (.24, .27, .31, 1) if role == "metal" else (.012, .015, .02, 1)
            elif "slide" in src_name:
                color = (.24, .27, .31, 1)
        elif name == "jbl_flip6":
            if "fabric" in src_name or "rope" in src_name:
                role, color = "fabric", (.035, .042, .052, 1)
            elif "logo" in src_name or "emblem" in src_name or "aluminium" in src_name:
                role = "metal"
        else:
            color = (.028, .032, .04, 1)
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if name != "keyboard_v2":
            if mesh.has_custom_normals:
                bpy.ops.mesh.customdata_custom_splitnormals_clear()
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0000005)
            bm.to_mesh(mesh)
            bm.free()
        triangles = sum(len(p.vertices) - 2 for p in mesh.polygons)
        keep_logo = name == "jbl_flip6" and "Front Logo" in obj.name
        if name != "keyboard_v2" and not keep_logo and triangles > 24:
            mod = obj.modifiers.new("Room detail budget", "DECIMATE")
            mod.ratio = min(1, max(24, budget * triangles / total) / triangles)
            mod.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=mod.name)
        mesh = obj.data
        mesh.materials.clear()
        mesh.materials.append(material(role))
        if name == "keyboard_v2":
            mesh.materials.append(material("print"))
        attr = mesh.color_attributes.get("Color") or mesh.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
        mesh.color_attributes.active_color = attr
        mesh.update()
        for face in mesh.polygons:
            # Retain the selected keyboard's actual key legends on upward-facing surfaces.
            face.material_index = 1 if name == "keyboard_v2" and face.normal.z > .88 else 0
            if name != "keyboard_v2":
                face.use_smooth = True
            for li in face.loop_indices:
                attr.data[li].color = color
                if name == "keyboard_v2":
                    co = mesh.vertices[mesh.loops[li].vertex_index].co
                    mesh.uv_layers.active.data[li].uv = (
                        105 / 1024 + (co.x / size[0] + .5) * 814 / 1024,
                        1 - 333 / 1024 - (co.y / size[1] + .5) * 305 / 1024,
                    )
        if name != "keyboard_v2":
            for uv in list(mesh.uv_layers):
                mesh.uv_layers.remove(uv)
    # Decimation can move an extremal vertex slightly. Recalibrate the finished mesh,
    # including its floor contact, so placement still uses the physical envelope.
    measured_lo, measured_hi = bounds(body)
    correction = Vector(tuple(size[i] / (measured_hi[i] - measured_lo[i]) for i in range(3)))
    centre = Vector(((measured_lo.x + measured_hi.x) / 2, (measured_lo.y + measured_hi.y) / 2, measured_lo.z))
    for obj in objects:
        for v in obj.data.vertices:
            v.co = (v.co - centre) * correction
    measured_lo, measured_hi = bounds(body)
    coll["calibration"] = json.dumps({
        "body_m": list(size), "measured_body_m": [round(x, 6) for x in measured_hi - measured_lo],
        "reference": reference,
        "note": "Official footprint; overall keycap height approximated at 40 mm." if name == "keyboard_v2" else "Manufacturer rigid body dimensions; loose speaker loop excluded.",
    })
    coll["layout"] = json.dumps({"front": "-Y", "origin": "rigid body bottom centre", "horizontal": True})
    if name == "keyboard_v2":
        # Source artwork, reprojected above; the website supplies the print texture.
        p = next(n for n in roles["print"].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        tex = roles["print"].node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(args.sources / "keyboard/textures/4b978116-1dc6-4dfa-82dc-d24b64beac74_0.jpeg"))
        roles["print"].node_tree.links.new(tex.outputs["Color"], p.inputs["Base Color"])
    # Browse as three separate items in the asset library; export cancels these offsets.
    coll.instance_offset = (index * .5, 0, 0)
    for obj in objects:
        obj.location.x += index * .5
    print(name, "body dimensions", list(measured_hi - measured_lo))

args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
