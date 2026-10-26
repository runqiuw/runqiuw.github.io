"""Pack the right TV-console bay with selected CC0 Snackies / Poly Pizza models.

Blender -b --python bin/room_snack_assets.py -- --source-dir <download-folder> --out <review.blend>
Append/export snack_stash using room_model_assets.py. Keep original UVs / package artwork.
"""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.name = 'Right cabinet snack stash review'
templates = {}


def bounds(parts):
    points = [o.matrix_world @ v.co for o in parts for v in o.data.vertices]
    return Vector(tuple(min(p[i] for p in points) for i in range(3))), Vector(tuple(max(p[i] for p in points) for i in range(3)))


def template(name, parts):
    # Canonical local mesh axes for Snackies; world axes for glTF imported below.
    lo, hi = bounds(parts)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for obj in parts:
        obj.data.transform(Matrix.Translation(-centre))
    templates[name] = (parts, hi - lo)


wanted = ['Chips_A', 'Chips_B', 'Chips_C', 'Chips_D', 'Cookies_A', 'Cookies_B', 'Cookies_C',
          'Cookies_D', 'Cookies_E', 'Cereal_A', 'Cereal_C', 'Juice_A']
with bpy.data.libraries.load(str(args.source_dir / 'snackies' / 'SnackiesPrev.blend'), link=False) as (source, target):
    assert set(wanted) <= set(source.objects)
    target.objects = wanted
for source in target.objects:
    obj = bpy.data.objects.new('source_' + source.name, source.data.copy())
    template(source.name, [obj])
for name in ['snack-bar', 'candy-wrapper', 'chocolate-wrapper']:
    bpy.ops.import_scene.gltf(filepath=str(args.source_dir / (name + '.glb')))
    bpy.context.view_layer.update()
    imported = list(scene.objects)
    parts = []
    for original in imported:
        if original.type != 'MESH':
            continue
        obj = bpy.data.objects.new('source_' + name + '_' + original.name, original.data.copy())
        obj.data.transform(original.matrix_world)
        parts.append(obj)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    template(name, parts)

# Dry snack packages stay opaque and retain the supplied base colour and UV mapping.
materials = {m for parts, size in templates.values() for o in parts for m in o.data.materials}
for i, mat in enumerate(materials):
    mat.name = 'snack_' + mat.name
    if mat.node_tree:
        sh = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if sh:
            for link in list(sh.inputs['Alpha'].links):
                mat.node_tree.links.remove(link)
            sh.inputs['Alpha'].default_value = 1
            sh.inputs['Roughness'].default_value = max(.45, sh.inputs['Roughness'].default_value)

coll = bpy.data.collections.new('asset_snack_stash')
scene.collection.children.link(coll)
coll.asset_mark()
coll.asset_data.description = 'A densely packed right-hand TV-console cupboard: original Snackies package artwork, Snack Bar by accidentallyc, and candy/chocolate wrappers by Kenney. CC0 sources, generic small retail-package scale, no texture downsampling.'
coll['catalog'] = 'Sections/Games'
coll['mount'] = 'cabinet'
coll['license'] = 'CC0-1.0'
coll['preserve_materials'] = True
components = []


def add(name, size, axis, at, rotation=(0, 0, 0)):
    originals, original_size = templates[name]
    factor = size / original_size[axis]
    rx, ry, rz = [math.radians(x) for x in rotation]
    pose = Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Scale(factor, 4)
    copies = []
    for source in originals:
        obj = bpy.data.objects.new(name + '_' + str(len(components)), source.data.copy())
        obj.data.transform(pose)
        coll.objects.link(obj)
        copies.append(obj)
    lo, hi = bounds(copies)
    shift = Vector(at) - Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for obj in copies:
        obj.location = shift
    bpy.context.view_layer.update()
    lo, hi = bounds(copies)
    assert lo.x >= -.1865 and hi.x <= .1865, (name, 'side clearance', list(lo), list(hi))
    assert lo.y >= -.157 and hi.y <= .1815, (name, 'door/back clearance', list(lo), list(hi))
    assert lo.z >= -.00001 and hi.z <= .382, (name, 'vertical clearance', list(lo), list(hi))
    components.append({'source': name, 'min': list(lo), 'max': list(hi), 'rotation_degrees': rotation, 'scale': factor})
    return hi.z


# Tall back row, with wrapped bars lying on top of the boxes.
add('Cereal_A', .300, 2, (-.090, .125, 0))
add('Cereal_C', .275, 2, (.091, .150, 0))
z = .302
for angle in [-3, 2, -1]:
    z = add('snack-bar', .140, 0, (-.090, .125, z), (0, 0, angle)) + .001
z = .277
for angle in [-2, 1]:
    z = add('chocolate-wrapper', .130, 0, (.091, .128, z), (0, 0, angle)) + .001

# Larger pouches in the middle, smaller box/pouch resting above them.
add('Chips_A', .205, 2, (-.092, .005, 0))
add('Chips_B', .205, 2, (.085, .020, 0))
add('Chips_D', .132, 2, (-.092, .005, .207), (0, 0, -3))
add('Cookies_B', .130, 2, (.085, .020, .207))
add('Juice_A', .120, 2, (.085, .090, 0))
for x in [-.135, -.095, -.055, -.015]:
    add('Cookies_E', .130, 0, (x, .071, 0), (0, -90, 0))

# Accessible front row. Upper packs are supported by the packages below them.
add('Chips_C', .160, 2, (-.090, -.112, 0))
add('Cookies_B', .140, 2, (.080, -.112, 0))
z = .142
for angle in [-2, 1, -1, 3]:
    z = add('snack-bar', .140, 0, (.080, -.105, z), (0, 0, angle)) + .001
z = add('Cookies_C', .170, 2, (-.090, -.112, .162), (0, 90, 0)) + .001
for angle in [0, -3]:
    z = add('candy-wrapper', .120, 0, (-.090, -.112, z), (0, 0, angle)) + .001
add('Cookies_B', .080, 2, (-.090, -.112, z))
for x in [-.135, -.045, .045, .135]:
    add('Cookies_D', .120, 0, (x, -.058, 0), (0, -90, 0))

# Asset origin is the true footprint centre; preserve the intended cabinet-local placement.
lo, hi = bounds(list(coll.objects))
origin = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
for obj in coll.objects:
    obj.location -= origin
for item in components:
    item['min'] = [round(v, 5) for v in Vector(item['min']) - origin]
    item['max'] = [round(v, 5) for v in Vector(item['max']) - origin]
coll['components'] = json.dumps(components)
coll['layout'] = json.dumps({'compartment': 'right TV-console bay', 'count': len(components),
                            'inner_size_m': [.373, .362, .384],
                            'placement': {'at': [3.26 + origin.x, 3.50 + origin.y], 'z': .098 + origin.z},
                            'front_clearance_m': .020, 'generic_packages': True})
coll['credits'] = json.dumps([
    {'author': 'loafbrr_1', 'source': 'https://opengameart.org/content/snackies'},
    {'author': 'accidentallyc', 'source': 'https://poly.pizza/m/U13zn2LA0w'},
    {'author': 'Kenney', 'source': 'https://poly.pizza/m/ZeJW3KyeTH'},
    {'author': 'Kenney', 'source': 'https://poly.pizza/m/7IPEo5wlOx'},
])
coll['material_quality'] = json.dumps({'original_uvs': True, 'original_texture_size': [2048, 2048],
                                       'vertex_colour_baking': False, 'source_text_meshes': 'retained'})
# Pack the original atlas, not a render or vertex-colour approximation.
for image in bpy.data.images:
    if image.size[0] and image.source == 'FILE' and not image.packed_file:
        image.pack()
args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
print('SNACK_STASH', len(components), 'pieces', 'bounds', list(hi - lo), 'placement', coll['layout'])
