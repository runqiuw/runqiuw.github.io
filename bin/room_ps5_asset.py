"""Original simplified PS5 Slim disc console and compact vertical stand.

Blender -b --python bin/room_ps5_asset.py -- --out <review.blend>
Append/export ps5_slim with room_model_assets.py; meshopt the selected GLB.
"""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy

parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True,type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.name='PS5 Slim cabinet-fit review'
roles={}
WHITE=(.88,.88,.85,1)

def paint(o,role,color):
    if role not in roles:
        m=bpy.data.materials.new(role);m.use_nodes=True
        sh=m.node_tree.nodes.get('Principled BSDF')
        a=m.node_tree.nodes.new('ShaderNodeVertexColor');a.layer_name='Color'
        m.node_tree.links.new(a.outputs['Color'],sh.inputs['Base Color'])
        roles[role]=m
    o.data.materials.append(roles[role])
    a=o.data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    o.data.color_attributes.active_color=a
    for v in a.data:v.color=color

def move(o,c,name,role,color):
    o.name=name
    for old in list(o.users_collection):old.objects.unlink(o)
    c.objects.link(o);paint(o,role,color)
    return o

def asset(name,mount,description):
    c=bpy.data.collections.new('asset_'+name);scene.collection.children.link(c)
    c.asset_mark();c.asset_data.description=description
    c['catalog']='Room/Props';c['mount']=mount;c['license']='Original geometry'
    return c

def box(c,name,size,at,color,role='frame',bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1,location=at)
    o=bpy.context.object;o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Soft edges','BEVEL');mod.width=min(bevel,min(size)*.48);mod.segments=3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
    return move(o,c,name,role,color)

def cylinder(c,name,radius,depth,at,color,role='frame',rotation=None,vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=at)
    o=bpy.context.object
    if rotation:o.rotation_euler=rotation
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return move(o,c,name,role,color)

ps5=asset('ps5_slim','cabinet','Original simplified PS5 Slim disc console, 96 x 216 x 358 mm body, upright on a 155 mm-diameter, 11 mm-high stand. Both use manufacturer external dimensions; detailed styling is approximate.')
base=.011
# Rounded black spine, with a slim front face facing the open cabinet (-Y).
box(ps5,'Black central chassis',(.052,.202,.348),(-.003,.003,base+.174),(.009,.012,.016,1),bevel=.008)
# Two sculpted white shells, each split by the Slim model's characteristic horizontal seam.
# Cross-sections are specified in metres; the complete body envelope is 96 x 216 x 358 mm.
sections=[(0,.031,.100),(.045,.032,.103),(.125,.034,.105),(.212,.037,.106),(.268,.041,.107),(.318,.045,.108),(.358,.048,.108)]
for sign in [-1,1]:
    for a,b in [(0,.213),(.215,.358)]:
        rows=[(z,x,d)for z,x,d in sections if a<=z<=b]
        def section(z):
            for (z0,x0,d0),(z1,x1,d1)in zip(sections,sections[1:]):
                if z0<=z<=z1:
                    t=(z-z0)/(z1-z0);return(z,x0+(x1-x0)*t,d0+(d1-d0)*t)
            return sections[-1]
        rows=sorted(set([section(a),*rows,section(b)]))
        verts=[]
        # Convex side plates, wrapped slightly around front and back. Outer X is bounded by ±48 mm.
        for z,x,d in rows:
            for u in range(9):
                t=u/8;y=(t-.5)*2*d
                bulge=.004*math.sin(math.pi*t)
                outer=min(.048,x+bulge)
                # The front lip flares; the side keeps its broad curved white surface.
                verts.append((sign*outer,y,base+z))
        faces=[]
        for j in range(len(rows)-1):
            for i in range(8):
                k=j*9+i
                face=(k,k+1,k+10,k+9)
                faces.append(face if sign>0 else tuple(reversed(face)))
        me=bpy.data.meshes.new('Curved white PS5 Slim cover');me.from_pydata(verts,[],faces);me.update()
        o=bpy.data.objects.new('White split cover',me);ps5.objects.link(o)
        for f in me.polygons:f.use_smooth=True
        paint(o,'frame',WHITE)
        bpy.context.view_layer.objects.active=o;o.select_set(True)
        mod=o.modifiers.new('Panel thickness','SOLIDIFY');mod.thickness=.0028;mod.offset=-1;bpy.ops.object.modifier_apply(modifier=mod.name)
        mod=o.modifiers.new('Soft panel rim','BEVEL');mod.width=.0007;mod.segments=2;bpy.ops.object.modifier_apply(modifier=mod.name)
        for v in o.data.vertices:
            v.co.x=max(-.048,min(.048,v.co.x));v.co.y=max(-.108,min(.108,v.co.y));v.co.z=max(base,min(base+.358,v.co.z))
# Disc drive bulges on the right lower half, within the calibrated 96 mm-wide body.
box(ps5,'Disc drive white housing',(.024,.160,.133),(.032,-.015,base+.074),WHITE,bevel=.010)
box(ps5,'Front disc slot',(.0015,.0006,.116),(.033,-.0957,base+.078),(.002,.003,.005,1),bevel=.00025)
# Black front bridge and two USB-C ports. A pale blue edge reads as a small status indicator.
box(ps5,'Front black spine',(.026,.002,.307),(-.004,-.1015,base+.164),(.005,.008,.013,1),bevel=.0007)
for z in [.050,.070]:
    box(ps5,'USB C port',(.008,.0005,.003),(-.005,-.1028,base+z),(.001,.002,.003,1),bevel=.0002)
box(ps5,'Power button',(.004,.0005,.002),(-.005,-.1028,base+.028),(.16,.18,.20,1),'metal',.0002)
box(ps5,'Blue status edge',(.0012,.0004,.060),(-.017,-.1028,base+.285),(.10,.36,.70,1),bevel=.00015)
# Vent fins run just inside the flared covers near the crown.
for sign in [-1,1]:
    for i in range(13):
        y=-.078+i*.012
        box(ps5,'Upper vent fin',(.008,.003,.014),(sign*.030,y,base+.339),(.016,.020,.025,1),bevel=.0007)
# Manufacturer stand: conservative full 11 mm lift, rather than hiding its mounting hub in the case.
verts=[];faces=[];segments=64
for z,r in [(0,.0775),(0,.069),(.0035,.0775),(.0035,.069)]:
    verts.extend((r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z)for i in range(segments))
for i in range(segments):
    j=(i+1)%segments
    faces.extend([(i,j,2*segments+j,2*segments+i),(segments+j,segments+i,3*segments+i,3*segments+j),(2*segments+i,2*segments+j,3*segments+j,3*segments+i),(j,i,segments+i,segments+j)])
me=bpy.data.meshes.new('Silver ring stand');me.from_pydata(verts,[],faces);me.update()
o=bpy.data.objects.new('Vertical ring stand',me);ps5.objects.link(o);paint(o,'metal',(.33,.36,.39,1))
cylinder(ps5,'Black mounting hub',.033,.011,(0,0,.0055),(.012,.016,.021,1),vertices=40)
for angle in [0,math.tau/3,math.tau*2/3]:
    o=box(ps5,'Stand support',(.047,.008,.003),(.047*math.cos(angle),.047*math.sin(angle),.0015),(.014,.018,.024,1),bevel=.001)
    o.rotation_euler.z=angle
ps5['calibration']=json.dumps({'manufacturer_body_m':[.096,.216,.358],'manufacturer_stand_m':[.155,.155,.011],'body_source':'https://blog.playstation.com/2023/10/10/new-look-for-ps5-console-this-holiday-season/','stand_source':'https://www.playstation.com/content/dam/global_pdc/en/corporate/support/manuals/accessories/ps5-accessories/vertical-stand-cfi-zvs1/cfi-zvs1-b30/CFI-ZVS1X-B30_Instruction_Manial_Web$en.pdf','scale':1,'detail_geometry':'original simplified styling'})
ps5['layout']=json.dumps({'orientation':'upright','compartment':'left TV cabinet bay, beside Xbox Series X','stand_lift_m':base,'installed_height_m':.369,'cabinet_clear_height_m':.384})
args.out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
