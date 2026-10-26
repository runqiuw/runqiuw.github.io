"""Refine the shared door lever and stock the TV console's open centre bay.

Run Blender with the configured room asset library open:
  blender -b <library> --python bin/room_fixture_details.py -- --out public/room/assets
Only asset_door / asset_tvstand and their GLBs/manifest entries change. The measured
source is untouched. Existing detailing is replaced by name on repeated runs.
"""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
bpy.context.window.scene = bpy.data.scenes['Assets']


def remove_named(coll, name):
    old = coll.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)


def paint(obj, role, color):
    mat = bpy.data.materials.get(role)
    if mat is None:
        mat = bpy.data.materials.new(role)
        mat.use_nodes = True
        sh = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        node.layer_name = 'Color'
        mat.node_tree.links.new(node.outputs['Color'], sh.inputs['Base Color'])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    attr = obj.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    obj.data.color_attributes.active_color = attr
    for value in attr.data:
        value.color = (*color, 1)
    ao = obj.data.attributes.new(name='_ao', type='FLOAT', domain='CORNER')
    for value in ao.data:
        value.value = 1


def attach(obj, coll, name, role, color):
    obj.name = name
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    coll.objects.link(obj)
    obj.location += coll.instance_offset
    paint(obj, role, color)
    return obj


def box(coll, name, size, centre, role, color, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft manufactured edges', 'BEVEL')
        mod.width = min(bevel, min(size) * .45)
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return attach(obj, coll, name, role, color)


def cylinder(coll, name, radius, depth, centre, role, color):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth, location=centre,
                                      rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    mod = obj.modifiers.new('Rounded rim', 'BEVEL')
    mod.width = min(.001, depth * .2)
    mod.segments = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in obj.data.polygons:
        poly.use_smooth = abs(poly.normal.z) < .8
    return attach(obj, coll, name, role, color)


def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return obj


# Remove precisely the old solid handle island; keep the measured leaf/frame/panels and AO.
door = bpy.data.collections['asset_door']
remove_named(door, 'door_handle')
body = door.objects['door']
bm = bmesh.new()
bm.from_mesh(body.data)
remaining = set(bm.verts)
removed = 0
while remaining:
    stack = [remaining.pop()]
    part = []
    while stack:
        vertex = stack.pop()
        part.append(vertex)
        for edge in vertex.link_edges:
            other = edge.other_vert(vertex)
            if other in remaining:
                remaining.remove(other)
                stack.append(other)
    points = [body.matrix_world @ v.co - door.instance_offset for v in part]
    lo = Vector(tuple(min(v[i] for v in points) for i in range(3)))
    hi = Vector(tuple(max(v[i] for v in points) for i in range(3)))
    if hi.z < 1.03 and lo.z > .97 and hi.y < 0 and lo.y < -.09:
        bmesh.ops.delete(bm, geom=part, context='VERTS')
        removed += 1
assert removed == 1 or door.get('handle_detail_version') == 1, 'Unexpected source door geometry'
bm.to_mesh(body.data)
bm.free()
body.data.update()

ink = (.018, .022, .030)
parts = [cylinder(door, 'Lever round rose', .025, .006, (-.345, -.030, 1), 'metal', ink),
         cylinder(door, 'Lever spindle collar', .013, .010, (-.345, -.038, 1), 'metal', ink)]
# A rounded L: projects from the door, turns 90 degrees and runs 110 mm toward the leaf centre.
cv = bpy.data.curves.new('Lever sweep', 'CURVE')
cv.dimensions = '3D'
cv.bevel_depth = .008
cv.bevel_resolution = 2
cv.use_fill_caps = True
points = [(-.345, -.039, 1), (-.345, -.063, 1)]
for i in range(1, 9):
    t = math.pi + math.pi / 2 * i / 8
    points.append((-.333 + .012 * math.cos(t), -.063 + .012 * math.sin(t), 1))
points += [(-.235, -.075, 1)]
sp = cv.splines.new('POLY')
sp.points.add(len(points) - 1)
for point, co in zip(sp.points, points):
    point.co = (*co, 1)
obj = bpy.data.objects.new('L lever', cv)
door.objects.link(obj)
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.convert(target='MESH')
obj = bpy.context.object
obj.location += door.instance_offset
paint(obj, 'metal', ink)
for poly in obj.data.polygons:
    poly.use_smooth = True
parts.append(obj)
join(parts, 'door_handle')
door['handle_detail_version'] = 1
door.asset_data.description = '99 x 210 cm panel door with a round rose, spindle and rounded L-shaped dark metal lever; shared by the entry and closet.'

# The centre bay has x ±191 mm, floor z=98 mm, ceiling z=482 mm.
stand = bpy.data.collections['asset_tvstand']
remove_named(stand, 'cubby_stock')
parts = [box(stand, 'Rear half-depth shelf', (.382, .272, .012), (0, .061, .289),
             'wood', (.52, .34, .17), .0015)]
palette = [(.09,.13,.21), (.54,.57,.55), (.19,.33,.29), (.49,.36,.29),
           (.63,.61,.53), (.15,.20,.30), (.28,.37,.41)]
counts = []
for row, floor in enumerate((.104, .296)):
    count = 14
    counts.append(count)
    for i in range(count):
        width = .020 + (i % 3) * .001
        x = (i - (count - 1) / 2) * .024
        height = .162 + ((i * 3 + row) % 4) * .002
        front = -.044 + (i % 3) * .0015
        # Plastic shell, printed spine, a title block and small series stripe. No bitmap textures.
        parts.append(box(stand, 'Upright game case', (width, .130, height),
                         (x, front + .065, floor + height / 2), 'accent', (.025,.032,.045), .0012))
        color = palette[(i + row * 3) % len(palette)]
        parts.append(box(stand, 'Printed spine', (width - .0035, .0007, height - .010),
                         (x, front - .0004, floor + height / 2), 'accent', color))
        for fraction, span in ((.71, .011), (.25, .003)):
            parts.append(box(stand, 'Spine label', (width - .007, .0008, span),
                             (x, front - .0009, floor + height * fraction), 'accent', (.78,.77,.70)))
stock = join(parts, 'cubby_stock')
stand['cubby_stock'] = json.dumps({'rows': counts, 'case_floors_m': [.104,.296],
                                  'shelf_m': {'z': .289, 'thickness': .012, 'front_y': -.075},
                                  'front_featured_cases_y': -.142})
stand.asset_data.description = 'Low TV console 120 x 40 x 50: hollow carcass, two hinged doors and an open centre cubby with two rear rows of upright game cases and a recessed middle shelf.'
# The additions remain within the existing cabinet bounds and clear foreground-case hover.
bpy.context.view_layer.update()
for v in stock.data.vertices:
    p = stock.matrix_world @ v.co - stand.instance_offset
    assert -.19101 <= p.x <= .19101 and -.07501 <= p.y <= .20475
    assert .098 <= p.z <= .482

# Use the normal exporter for node names, roles, UVs, AO and collection metadata.
module_path = Path(__file__).with_name('room_assets_export.py')
spec = importlib.util.spec_from_file_location('room_export', module_path)
exporter = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(exporter)
manifest_file = args.out / 'manifest.json'
manifest = json.loads(manifest_file.read_text())
for coll in (door, stand):
    name, entry = exporter.export(coll, args.out)
    manifest['assets'][name] = entry
    print('EXPORTED', name, entry['triangles'], entry['size'])
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print('Updated door / centre-cubby detail; unrelated library collections preserved.')
