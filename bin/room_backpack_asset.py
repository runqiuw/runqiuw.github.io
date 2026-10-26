"""Pose the selected Sketchfab backpack while retaining its original UVs and PBR maps.

Blender -b --python bin/room_backpack_asset.py -- --source <backpack.glb> --out <review.blend>
Append/export backpack with room_model_assets.py. Compress textures and meshopt afterwards.
"""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path);p.add_argument('--out',required=True,type=Path)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.name='Original commuter backpack materials review'
bpy.ops.import_scene.gltf(filepath=str(args.source));bpy.context.view_layer.update()
objects=[o for o in scene.objects if o.type=='MESH']
coll=bpy.data.collections.new('asset_backpack');scene.collection.children.link(coll);coll.asset_mark()
coll.asset_data.description='Original black commuter backpack by MadeByYeshe (CC BY 4.0), 430 mm body with a 10 degree bedside lean. Original UVs, base-colour, normal and metallic-roughness maps preserved; no vertex-colour replacement or mesh decimation.'
coll['catalog'],coll['mount'],coll['elevation']='Room/Props','floor',0
coll['license']='CC-BY-4.0';coll['preserve_materials']=True
coll['credits']=json.dumps({'author':'MadeByYeshe','source':'https://sketchfab.com/3d-models/backpack-dd087558c1a24a9ea82d50d764ad4b78'})
transforms={o:o.matrix_world.copy()for o in objects}
for o in objects:
    o.parent=None;o.matrix_world=transforms[o]
    for old in list(o.users_collection):old.objects.unlink(o)
    coll.objects.link(o)
for o in list(scene.objects):
    if o not in objects:bpy.data.objects.remove(o,do_unlink=True)
def bounds(parts):
    points=[o.matrix_world@v.co for o in parts for v in o.data.vertices]
    return Vector(tuple(min(v[i]for v in points)for i in range(3))),Vector(tuple(max(v[i]for v in points)for i in range(3)))
body=[o for o in objects if o.name in {'Object_11','Object_29'}]
if len(body)!=2:raise RuntimeError('Inspect the changed source body before calibrating it.')
lo,hi=bounds(body);factor=.430/(hi.z-lo.z);origin=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
pose=Matrix.Rotation(math.radians(-10),4,'X')@Matrix.Rotation(math.pi/2,4,'Z')
transform=pose@Matrix.Scale(factor,4)@Matrix.Translation(-origin)
for o in objects:o.matrix_world=transform@transforms[o]
bpy.context.view_layer.update();ground=bounds(body)[0].z
# Keep the exact source mesh normals/UV seams. Only the loose strap tips are grounded.
for o in objects:
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    for v in o.data.vertices:
        v.co.z-=ground
        if v.co.z<.0005:
            v.co.y+=max(0,-v.co.z)*.7;v.co.z=.0005
lo,hi=bounds(objects);centre=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
for o in objects:
    for v in o.data.vertices:v.co-=centre
for m in {m for o in objects for m in o.data.materials}:
    m.name='backpack_canvas'if m.name=='BackPack'else'backpack_hardware'
    # Source normal, roughness and colour images remain connected, at their original resolution.
    m['source_material']='MadeByYeshe original PBR'
lo,hi=bounds(objects)
coll['calibration']=json.dumps({'body_height_m':.430,'uniform_source_scale':factor,'posed_bounds_m':list(hi-lo),'basis':'Generic adult commuter size; source has no manufacturer measurements'})
coll['layout']=json.dumps({'front':'-Y','backward_lean_degrees':10,'loose_straps':'resting on floor','base':'bottom centre'})
coll['material_quality']=json.dumps({'uvs':'original','pbr_maps':'original base colour, normal, metallic roughness and hardware specular','geometry_decimation':False,'vertex_colour_baking':False})
args.out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
print('Original PBR backpack',list(hi-lo),'triangles',sum(len(f.vertices)-2 for o in objects for f in o.data.polygons))
