"""Original office rug, remote, white phone, hanging headphones and life-size Series X.

Blender -b --python bin/room_office_props.py -- --out <review.blend>
Append/export these collections with room_model_assets.py; meshopt the selected GLBs.
"""
import argparse
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True,type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.name='Office accessories review'
roles={}
BLACK=(.012,.015,.020,1)
RUBBER=(.009,.011,.014,1)
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

def tube(c,name,points,radius,color,role='frame'):
    cv=bpy.data.curves.new(name,'CURVE');cv.dimensions='3D';cv.bevel_depth=radius;cv.bevel_resolution=2
    sp=cv.splines.new('POLY');sp.points.add(len(points)-1)
    for p,co in zip(sp.points,points):p.co=(*co,1)
    o=bpy.data.objects.new(name,cv);c.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    bpy.ops.object.convert(target='MESH');o=bpy.context.object
    for p in o.data.polygons:p.use_smooth=True
    paint(o,role,color);return o

def rounded_outline(w,d,r,z,steps=10):
    return [(cx+r*math.cos(t),cy+r*math.sin(t),z)
            for cx,cy,start in [(w/2-r,d/2-r,0),(-w/2+r,d/2-r,90),(-w/2+r,-d/2+r,180),(w/2-r,-d/2+r,270)]
            for t in [math.radians(start+i*90/steps) for i in range(steps+1)]]

rug=asset('office_rug','rug','Low-pile woven office chair rug, 1400 x 1400 x 4 mm, rounded corners and stitched border.')
# Make the corner radius independently of the 4 mm thickness.
outline=rounded_outline(1.4,1.4,.075,0)
verts=outline+[(x,y,.004) for x,y,z in outline];n=len(outline)
faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
me=bpy.data.meshes.new('Woven office rug');me.from_pydata(verts,[],faces);me.update()
o=bpy.data.objects.new('office_rug',me);rug.objects.link(o);paint(o,'fabric',(.34,.36,.38,1))
border=rounded_outline(1.37,1.37,.063,.0041)
tube(rug,'Bound woven edge',border+[border[0]],.0011,(.23,.25,.28,1),'fabric')
# Subtle paired woven strands around the perimeter, no runtime texture or animation.
for side in [-1,1]:
    tube(rug,'Woven border',[(side*.665,-.58,.0043),(side*.665,.58,.0043)],.0006,(.43,.44,.44,1),'fabric')
rug['calibration']=json.dumps({'footprint_m':[1.4,1.4],'pile_m':.004})

remote=asset('tv_remote','desk','Original slim charcoal TV remote, 145 x 42 x 14 mm with a directional pad and rubber keys.')
box(remote,'Remote body',(.042,.145,.012),(0,0,.006),BLACK,bevel=.005)
box(remote,'IR window',(.025,.001,.005),(0,.0725,.006),(.002,.003,.005,1),'screen',.0004)
cylinder(remote,'Red power key',.004,.0015,(-.012,.054,.0126),(.5,.025,.025,1),vertices=20)
for x in [-.010,0,.010]:
    box(remote,'Shortcut key',(.006,.005,.0013),(x,.035,.0125),(.055,.06,.068,1),bevel=.0006)
cylinder(remote,'Directional ring',.013,.0014,(0,.011,.0126),(.07,.08,.095,1),vertices=32)
cylinder(remote,'OK button',.006,.0016,(0,.011,.0129),(.028,.032,.04,1),vertices=24)
for j in range(4):
    for i in range(3):
        box(remote,'Rubber keypad',(.007,.005,.0014),((i-1)*.012,-.016-j*.012,.0128),(.055,.061,.07,1),'fabric',.00065)
remote['calibration']=json.dumps({'body_m':[.042,.145,.012]})

phone=asset('white_phone','desk','White smartphone with vivo X200 Ultra-inspired circular camera styling: silver rim, dark four-aperture disc, three lenses and a blue centre badge; face down.')
box(phone,'White phone frame',(.074,.151,.0085),(0,0,.00425),(.66,.69,.72,1),'metal',.004)
box(phone,'White ceramic back',(.071,.148,.0005),(0,0,.0085),WHITE,bevel=.00024)
# Silver/white ribbed lower panel, kept subtle and built as clean geometry.
for i in range(27):
    box(phone,'Fine back rib',(.00035,.104,.00012),((i-13)*.00245,-.020,.0088),(.76,.78,.77,1),bevel=0)
cy=.037
cylinder(phone,'Silver circular camera rim',.0295,.0048,(0,cy,.0109),(.53,.56,.60,1),'metal',vertices=64)
cylinder(phone,'Dark camera disc',.0278,.00065,(0,cy,.01345),(.006,.008,.012,1),'screen',vertices=64)
for x,y in [(-.0107,.0107),(-.0107,-.0107),(.0107,-.0107)]:
    cylinder(phone,'Lens surround',.0074,.00035,(x,cy+y,.0139),(.024,.028,.035,1),'metal',vertices=32)
    cylinder(phone,'Lens glass',.0057,.00025,(x,cy+y,.01415),(.003,.007,.012,1),'screen',vertices=32)
    cylinder(phone,'Optical element',.0029,.00015,(x,cy+y,.01435),(.012,.04,.055,1),'screen',vertices=24)
    cylinder(phone,'Lens reflection',.00075,.00012,(x-.001,cy+y+.001,.01448),(.17,.27,.30,1),'screen',vertices=12)
# The fourth disc is the characteristic dark upper-right aperture, not a fourth camera.
cylinder(phone,'Upper dark aperture',.0074,.00025,(.0107,cy+.0107,.0139),(.013,.016,.021,1),'screen',vertices=32)
cylinder(phone,'Upper aperture centre',.0024,.00015,(.0107,cy+.0107,.0141),(.026,.031,.037,1),'screen',vertices=20)
box(phone,'Blue centre badge',(.0052,.0052,.00015),(0,cy,.01405),(.015,.07,.55,1),bevel=0)
bpy.ops.object.text_add(location=(0,cy,.01416))
o=bpy.context.object;o.data.body='ZEISS';o.data.size=.00135;o.data.align_x='CENTER';o.data.align_y='CENTER'
bpy.ops.object.convert(target='MESH');move(bpy.context.object,phone,'Camera badge lettering','frame',(.95,.96,.97,1))
box(phone,'Dual tone flash',(.0027,.007,.0005),(-.029,.063,.0091),(.95,.91,.72,1),bevel=.0002)
box(phone,'Side key',(.001,.016,.002),(.0372,.023,.0045),(.65,.68,.7,1),'metal',.0004)
phone['calibration']=json.dumps({'body_m':[.074,.151,.0085],'pose':'face down','camera_style':'vivo X200 Ultra-inspired, approximate geometry','reference':'https://m.vivo.com.cn/vivo/x200ultra'})

headphones=asset('headphones_black','hanging','Original compact black over-ear wireless headphones with padded headband, articulated yokes and cushioned cups; approximately 175 x 76 x 210 mm.')
# X-Z plane headband; after placement it hangs outside the right side of the desk.
for r,rad,color,role in [(.080,.008,BLACK,'frame'),(.069,.005,RUBBER,'fabric')]:
    pts=[(r*math.cos(t),0,.125+r*math.sin(t)) for t in [i*math.pi/40 for i in range(41)]]
    tube(headphones,'Padded headband',pts,rad,color,role)
for sign in [-1,1]:
    tube(headphones,'Adjustable yoke',[(sign*.079,0,.133),(sign*.085,0,.094),(sign*.079,0,.070)],.004,(.06,.065,.075,1),'metal')
    o=box(headphones,'Oval earcup',(.032,.076,.092),(sign*.075,0,.049),BLACK,bevel=.015)
    o.rotation_euler.y=sign*-.10
    box(headphones,'Soft ear cushion',(.016,.065,.080),(sign*.052,0,.047),(.021,.024,.03,1),'fabric',.007)
    box(headphones,'Recessed ear opening',(.001,.042,.052),(sign*.043,0,.047),(.003,.004,.006,1),'fabric',.0004)
    cylinder(headphones,'Swivel cap',.009,.002,(sign*.092,0,.063),(.08,.085,.10,1),'metal',rotation=(0,math.pi/2,0))
box(headphones,'Power key',(.001,.010,.003),(.092,-.021,.045),(.13,.14,.15,1),'metal',.0004)
# A compact 175 mm-wide fit; the cups clear both the desk leg and the neighbouring cabinet.
for o in headphones.objects:
    o.location.x *= .93
    o.scale.x *= .93
# Inside of the padded arch rests on the measured upper surface of the existing hook.
headphones['layout']=json.dumps({'hook_anchor_m':[0,0,.189],'front':'-Y'})
headphones['calibration']=json.dumps({'approximate_headphone_width_m':.175,'type':'generic compact over-ear, no brand'})

# A compact casual canvas daypack: broad zip pocket, simple webbing, no photographic colours.
bag=asset('backpack_small','hanging','Original low-poly casual mini daypack, charcoal canvas with two shoulder straps, a front zip pocket and a small woven label; 280 mm body.')
cloth=(.035,.043,.052,1);pocket=(.050,.059,.069,1);seam=(.085,.096,.108,1)
box(bag,'Rounded canvas body',(.218,.100,.280),(0,0,.140),cloth,'fabric',.033)
box(bag,'Front zip pocket',(.170,.028,.090),(0,-.059,.085),pocket,'fabric',.012)
box(bag,'Woven front label',(.023,.0015,.017),(0,-.0737,.091),(.63,.59,.47,1),'fabric',.0007)
box(bag,'Label stitch',(.017,.0005,.0015),(0,-.0747,.092),(.30,.31,.30,1),'fabric',.0002)
# Light seams and narrow zipper tapes keep the silhouette legible in both themes.
tube(bag,'Pocket zipper',[(-.066,-.073,.120),(0,-.074,.124),(.066,-.073,.120)],.0013,seam,'fabric')
box(bag,'Pocket zipper pull',(.004,.002,.010),(.059,-.075,.115),(.23,.25,.27,1),'metal',.0008)
tube(bag,'Main zipper',[(-.070,-.051,.236),(0,-.051,.242),(.070,-.051,.236)],.0015,seam,'fabric')
box(bag,'Main zipper pull',(.004,.003,.014),(.064,-.054,.232),(.23,.25,.27,1),'metal',.0008)
for sign in [-1,1]:
    # Flat ribbon webbing rather than cylindrical rope straps.
    path=[(sign*.060,.046,.248),(sign*.065,.072,.222),(sign*.066,.083,.168),(sign*.063,.080,.105),(sign*.057,.049,.040)]
    verts=[(x+dx,y,z) for x,y,z in path for dx in [-.009,.009]]
    faces=[(2*i,2*i+1,2*i+3,2*i+2)for i in range(len(path)-1)]
    me=bpy.data.meshes.new('Canvas shoulder strap');me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new('Shoulder strap',me);bag.objects.link(o);paint(o,'fabric',(.022,.028,.035,1))
    bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Webbing thickness','SOLIDIFY');mod.thickness=.003;bpy.ops.object.modifier_apply(modifier=mod.name)
    box(bag,'Strap adjuster',(.022,.006,.012),(sign*.060,.079,.102),(.13,.15,.17,1),'frame',.002)
# A flexible webbing tab straddles the existing 12 mm-wide hook.
back=.058
points=[(0,back-.018,.250),(0,back-.018,.316),(0,back-.016,.322),(0,back-.012,.324),(0,back+.012,.324),(0,back+.016,.322),(0,back+.018,.316),(0,back+.018,.250),(0,back-.018,.247)]
tube(bag,'Carry and hanging tab',points,.0025,(.022,.028,.035,1),'fabric')
bag['calibration']=json.dumps({'body_m':[.218,.100,.280],'style':'original casual low-poly mini double-strap daypack','photographic_textures':False})
bag['layout']=json.dumps({'front':'-Y','hook_anchor_m':[0,back,.3215],'base':'bottom centre'})

xbox=asset('xbox_series_x','cabinet','Original simplified Xbox Series X disc console, life-size 151 x 151 x 301 mm, upright inside the left TV cabinet compartment.')
box(xbox,'Series X chassis',(.151,.151,.3004),(0,0,.1502),(.012,.014,.015,1),bevel=.0012)
# The shallow dark endcap supports a grid of recessed green-lined exhaust apertures.
box(xbox,'Top exhaust inset',(.143,.143,.0005),(0,0,.3005),(.004,.007,.004,1),bevel=.0002)
for row in range(9):
    for col in range(9):
        x,y=(col-4)*.015,(row-4)*.015
        cylinder(xbox,'Green vent recess',.0044,.0002,(x,y,.3008),(.055,.16,.020,1),vertices=10)
        cylinder(xbox,'Dark exhaust aperture',.0038,.0002,(x,y,.3009),(.003,.007,.003,1),vertices=10)
# Front (-Y), the disc slot is vertical on an upright console.
box(xbox,'Disc slot',(.0017,.0005,.117),(-.051,-.0757,.110),(.001,.002,.003,1),bevel=.0002)
cylinder(xbox,'Power emblem',.0048,.0006,(.051,-.0759,.268),(.72,.74,.70,1),rotation=(math.pi/2,0,0),vertices=24)
for a in [-.64,.64]:
    o=box(xbox,'X emblem stroke',(.001,.0003,.008),(.051,-.0763,.268),(.012,.014,.015,1),bevel=.0001);o.rotation_euler.y=a
box(xbox,'USB socket',(.009,.0005,.004),(.050,-.0759,.028),(.001,.002,.003,1),bevel=.0002)
xbox['calibration']=json.dumps({'manufacturer_body_m':[.151,.151,.301],'source':'https://www.xbox.com/en-gb/consoles/xbox-series-x','scale':1})
xbox['layout']=json.dumps({'orientation':'upright','compartment':'left closed TV cabinet bay','inner_space_m':[.373,.362,.384],'floor_z_m':.098})

# Space the review assets while preserving export origins.
for i,c in enumerate(list(scene.collection.children)):
    c.instance_offset=(i*1.6,0,0)
    for o in c.objects:o.location.x+=i*1.6
args.out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
