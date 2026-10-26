"""Build real-scale toiletries and selected models for the nightstand open shelf.

Run Blender with --source-dir containing band.glb, headphones.glb and tube.glb,
then append and export the resulting collection with room_model_assets.py.
"""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
p=argparse.ArgumentParser();p.add_argument('--source-dir',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
coll=bpy.data.collections.new('asset_nightstand_essentials');scene.collection.children.link(coll)
coll.asset_mark();coll.asset_data.description='Real-scale bedside toiletries, fitness band and bone-conduction headphones.'
coll['mount']='cabinet';coll['catalog']='Room/Details';coll['preserve_materials']=True

def mat(name,color,rough=.6):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough
 return m
cream=mat('hand cream ivory',(.88,.84,.75)); white=mat('eye drops white',(.95,.95,.93)); blue=mat('eye drops blue',(.035,.23,.68)); ink=mat('label ink',(.14,.29,.30)); label=mat('label paper',(.98,.97,.91))
def move(obj):
 for c in list(obj.users_collection):c.objects.unlink(obj)
 coll.objects.link(obj)
 return obj
def box(name,location,size,material,bevel):
 bpy.ops.mesh.primitive_cube_add(size=1,location=location);o=move(bpy.context.object);o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('Rounded edges','BEVEL');mod.width=bevel;mod.segments=3
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 o.data.materials.append(material);return o
def cyl(name,location,radius,depth,material,vertices=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=location);o=move(bpy.context.object);o.name=name;o.data.materials.append(material);bpy.ops.object.shade_smooth();return o
# Blender coordinates: shelf x width, y depth (negative is front), z height from shelf.
box('hand cream bottle',(-.125,.045,.052),(.040,.030,.104),cream,.010)
cyl('hand cream neck',(-.125,.045,.108),.010,.012,cream)
cyl('hand cream cap',(-.125,.045,.118),.012,.012,white)
box('hand cream label',(-.125,.0297,.055),(.025,.0008,.034),label,.001)
# tiny ink bars give the label legible graphic character at room scale
for z,w in [( .064,.016),(.059,.012),(.051,.015),(.047,.010)]:box('hand cream label mark',(-.125,.0291,z),(w,.0005,.001),ink,.0003)
# 60 mm closed dropper, subtle shoulder and cap ridges.
box('eye drop bottle',(-.005,-.070,.023),(.025,.022,.046),white,.008)
cyl('dropper neck',(-.005,-.070,.048),.007,.010,white)
cyl('blue closed screw cap',(-.005,-.070,.056),.009,.014,blue)
for z in [.052,.055,.058,.061]:cyl('cap rim',(-.005,-.070,z),.0094,.0007,blue)
box('eye drop label',(-.005,-.0813,.025),(.017,.0006,.016),label,.001)
box('eye drop label stripe',(-.005,-.0818,.028),(.013,.0005,.002),blue,.0003)
# selected downloaded models are imported below; preserve source UVs and material maps.
def imported(path, position, factor, rotation, select=lambda o:True):
 existing=set(scene.objects)
 bpy.ops.import_scene.gltf(filepath=str(path));bpy.context.view_layer.update()
 new=set(scene.objects)-existing
 meshes=[o for o in new if o.type=='MESH' and select(o)]
 assert meshes, path
 points=[o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
 centre=Vector(tuple((min(v[i] for v in points)+max(v[i] for v in points))/2 for i in range(3)))
 rot=Matrix.Rotation(math.radians(rotation[2]),4,'Z') @ Matrix.Rotation(math.radians(rotation[1]),4,'Y') @ Matrix.Rotation(math.radians(rotation[0]),4,'X')
 copies=[]
 for obj in meshes:
  cp=bpy.data.objects.new(path.stem+'_'+obj.name,obj.data.copy());coll.objects.link(cp)
  cp.data.transform(rot @ Matrix.Scale(factor,4) @ Matrix.Translation(-centre) @ obj.matrix_world);copies.append(cp)
 for obj in new:bpy.data.objects.remove(obj,do_unlink=True)
 bpy.context.view_layer.update()
 points=[o.matrix_world @ v.co for o in copies for v in o.data.vertices]
 lo=Vector(tuple(min(v[i] for v in points) for i in range(3)));hi=Vector(tuple(max(v[i] for v in points) for i in range(3)))
 shift=Vector((position[0]-(lo.x+hi.x)/2,position[1]-(lo.y+hi.y)/2,position[2]-lo.z))
 for obj in copies:obj.location=shift
 print('PLACED',path.name,'size',tuple(round(x,4) for x in hi-lo),'at',position)
 return copies
# The source contains two identical wristbands; keep only the positive-X copy.
imported(a.source_dir/'band.glb',(-.105,-.060,0),.00212,(0,90,0),lambda o:o.matrix_world.translation.x>0)
# Keep the source tube's original UVs and 1024-pixel PBR packaging textures.
imported(a.source_dir/'tube.glb',(-.045,.052,0),.0079,(0,0,0))
# Import the reviewed llb model. Orientation and uniform scale are calibrated
# from the source geometry during visual review, without deforming the model.
headphones=imported(a.source_dir/'headphones.glb',(.090,.025,0),.105,(0,0,90))
headphones_black=mat('bone conduction charcoal',(.025,.027,.030),.75)
for obj in headphones:
 obj.data.materials.clear();obj.data.materials.append(headphones_black)
# Verify every mesh stays inside the measured cabinet opening (m).
bpy.context.view_layer.update()
points=[o.matrix_world @ v.co for o in coll.objects if o.type=='MESH' for v in o.data.vertices]
lo=[min(v[i] for v in points) for i in range(3)];hi=[max(v[i] for v in points) for i in range(3)]
print('COLLECTION BOUNDS',lo,hi)
assert lo[0]>=-.184 and hi[0]<=.184 and lo[1]>=-.142 and hi[1]<=.114 and lo[2]>=-.0001 and hi[2]<=.153
coll['license']='CC-BY-4.0';coll['credits']='Mi Band 2 by Ferran Romero bone-conduction headphones by llb and Cream tube by OlegCoder, CC BY 4.0; hand cream and eye drops original.'
coll['components']=json.dumps(['hand cream bottle','face cream tube','eye drops','Mi Band 2','bone conduction headphones'])
coll['calibration']='Mi Band capsule about 40 mm long; headphones and cream tube uniformly scaled to adult size; other toiletries approximate everyday dimensions.'
coll['layout']='Grouped on the open shelf; metres in the nightstand local frame.'
bpy.ops.wm.save_as_mainfile(filepath=str(a.out))
