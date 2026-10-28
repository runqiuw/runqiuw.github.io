"""Prepare a classic Android mascot and exela's RTX 3070 FE for the bottom shelf.

Blender -b --python bin/room_shelf_tech.py -- --gpu <source.glb> --out <review.blend>
Append/export android_mascot and rtx3070_fe with room_model_assets.py afterwards.
"""
import argparse, json, math, sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

p=argparse.ArgumentParser();p.add_argument('--gpu',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene

def coll(name,description):
 c=bpy.data.collections.new('asset_'+name);scene.collection.children.link(c);c.asset_mark();c.asset_data.description=description
 c['catalog']='Room/Collectibles';c['mount']='shelf';c['preserve_materials']=True
 return c

def mat(name,rgb,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*rgb,1);b.inputs['Roughness'].default_value=.5;b.inputs['Metallic'].default_value=metal
 return m

def move(o,c,m):
 for old in list(o.users_collection):old.objects.unlink(o)
 c.objects.link(o);o.data.materials.clear();o.data.materials.append(m)
 for f in o.data.polygons:f.use_smooth=True
 return o

def pill(c,name,start,end,r,m):
 start,end=Vector(start),Vector(end);d=end-start
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=(start+end)/2)
 o=move(bpy.context.object,c,m);o.name=name;o.scale=(r,r,d.length/2+r);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o

c=coll('android_mascot','Classic green Android robot: original 105 mm vinyl-toy geometry with dome head, antennae, rounded limbs and inset charcoal eyes. Static, no textures.')
green=mat('Android green vinyl',(.38,.65,.055));black=mat('Android eyes',(.012,.018,.009))
# A true hemisphere with a flat lower rim, separated slightly from the cylindrical body.
verts=[(.024*math.cos(math.tau*i/32)*math.cos(math.pi*j/16),.024*math.sin(math.tau*i/32)*math.cos(math.pi*j/16),.073+.024*math.sin(math.pi*j/16))for j in range(9)for i in range(32)]
faces=[(j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i)for j in range(8)for i in range(32)];faces.append(tuple(reversed(range(32))))
mesh=bpy.data.meshes.new('Android dome');mesh.from_pydata(verts,[],faces);o=bpy.data.objects.new('Android dome',mesh);c.objects.link(o);move(o,c,green)
bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=.024,depth=.040,location=(0,0,.050));o=move(bpy.context.object,c,green);o.name='Android body'
mod=o.modifiers.new('Soft vinyl edges','BEVEL');mod.width=.0015;mod.segments=2;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
for sign in [-1,1]:
 pill(c,'Android leg',(sign*.012,0,.009),(sign*.012,0,.033),.007,green)
 pill(c,'Android arm',(sign*.033,0,.038),(sign*.033,0,.062),.0065,green)
 pill(c,'Android antenna',(sign*.012,0,.089),(sign*.021,0,.103),.0015,green)
 pill(c,'Android eye',(sign*.009,-.022,.081),(sign*.009,-.022,.081),.0022,black)
c['license']='CC-BY-3.0';c['credits']=json.dumps({'author':'Original geometry; Android robot design by Google','source':'https://developer.android.com/distribute/marketing-tools/brand-guidelines','changes':'Original three-dimensional static vinyl-toy interpretation.'})
c['calibration']=json.dumps({'height_m':.105,'static':True})

c=coll('rtx3070_fe',"NVIDIA RTX 3070 Founders Edition by exela (CC BY-NC 4.0), simplified static display: original dual fans, metal shroud, PCB and labels; calibrated 242 mm body length, upright on a small display foot.")
before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(a.gpu));bpy.context.view_layer.update();new=set(scene.objects)-before
parts=[]
# Source world axes: length Z, card height Y, thickness X; fan face is +X.
# Put length along X, fans toward -Y, height along Z, preserving handedness.
orient=Matrix(((0,0,-1,0),(-1,0,0,0),(0,1,0,0),(0,0,0,1)))
for src in new:
 if src.type!='MESH' or not ('RTX_3070' in src.name or src.name.startswith('Fan_')):continue
 evaluated=src.evaluated_get(bpy.context.evaluated_depsgraph_get());data=bpy.data.meshes.new_from_object(evaluated);o=bpy.data.objects.new('3070 '+src.name,data);o.data.transform(orient@evaluated.matrix_world);c.objects.link(o);parts.append(o)
for o in new:bpy.data.objects.remove(o,do_unlink=True)
# The IO mounting bracket projects beyond the 242 mm main shroud. Calibrate the shroud only.
shroud=next(o for o in parts if 'Air_Panel_Aluminium_0' in o.name)
lo=min(v.co.x for v in shroud.data.vertices);hi=max(v.co.x for v in shroud.data.vertices);scale=.242/(hi-lo)
pts=[v.co for o in parts for v in o.data.vertices];bottom=min(v.z for v in pts);cy=(min(v.y for v in pts)+max(v.y for v in pts))/2
transform=Matrix.Translation((0,0,.009))@Matrix.Scale(scale,4)@Matrix.Translation((-(hi+lo)/2,-cy,-bottom))
metal=mat('3070 brushed metal',(1,1,1),.72);plastic=mat('3070 charcoal',(1,1,1))
for m in [metal,plastic]:
 vc=m.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';m.node_tree.links.new(vc.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
# Keep the common original atlas only on its three label-bearing surfaces, at 2048 px.
label=None
for o in parts:
 o.data.transform(transform);old=o.data.materials[0];b=old.node_tree.nodes.get('Principled BSDF');texture=b.inputs['Base Color'].links[0].from_node if b.inputs['Base Color'].links else None
 tris=sum(len(f.vertices)-2 for f in o.data.polygons)
 budget=2200 if 'Fan_' in o.name and 'Plastic' in o.name else 1800 if 'Air_Panel' in o.name else 1200 if 'Cooling' in o.name else 700
 if tris>budget:
  bpy.context.view_layer.objects.active=o;mod=o.modifiers.new('Shelf-scale detail','DECIMATE');mod.ratio=budget/tris;mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name)
 if texture:
  if label is None:
   img=texture.image
   if max(img.size)>2048:img.scale(2048,2048)
   img.pack()
   label=mat('3070 original label atlas',(1,1,1),.08)
   tex=label.node_tree.nodes.new('ShaderNodeTexImage');tex.image=img
   label.node_tree.links.new(tex.outputs['Color'],label.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
  o.data.materials.clear();o.data.materials.append(label)
 else:
  rgb=list(b.inputs['Base Color'].default_value);rgb[:3]=[max(.022,v)for v in rgb[:3]]
  o.data.materials.clear();o.data.materials.append(metal if b.inputs['Metallic'].default_value>.5 else plastic)
  attr=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');o.data.color_attributes.active_color=attr
  for v in attr.data:v.color=rgb
# Two restrained supports actually meet the lower shroud; the IO bracket sits lower.
vertices=[v.co.copy() for o in parts for v in o.data.vertices]
polys=[];offset=0
for o in parts:
 polys.extend([[offset+i for i in f.vertices]for f in o.data.polygons]);offset+=len(o.data.vertices)
tree=BVHTree.FromPolygons(vertices,polys)
for x in [-.073,.073]:
 hit=tree.ray_cast(Vector((x,.006,.008)),Vector((0,0,1)),.2)[0]
 if hit:
  bpy.ops.mesh.primitive_cube_add(size=1,location=(x,.006,(hit.z+.008)/2));support=move(bpy.context.object,c,plastic);support.dimensions=(.008,.014,hit.z-.008+.001);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  attr=support.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');support.data.color_attributes.active_color=attr
  for v in attr.data:v.color=(.035,.04,.05,1)

 bpy.ops.mesh.primitive_cube_add(size=1,location=(x,0,.004));o=move(bpy.context.object,c,plastic);o.dimensions=(.026,.060,.008);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 attr=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER');o.data.color_attributes.active_color=attr
 for v in attr.data:v.color=(.035,.04,.05,1)
c['license']='CC-BY-NC-4.0';c['credits']=json.dumps({'author':'exela / Alexander Ershov','source':'https://sketchfab.com/3d-models/geforce-rtx-3070-founders-edition-7ca66948de7d4f7daeb93abb7a685e67','changes':'Static pose, simplified hidden detail, consolidated materials, original label atlas at 2048px, real-size shroud and original feet.'})
c['calibration']=json.dumps({'body_length_m':.242,'body_height_m':.112,'static':True})
a.out.parent.mkdir(parents=True,exist_ok=True);bpy.ops.wm.save_as_mainfile(filepath=str(a.out))
