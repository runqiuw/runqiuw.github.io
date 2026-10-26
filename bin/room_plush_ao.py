"""Repair baked shading on the SJTU plush without changing geometry or colliders.

Run inside the room asset library:
Blender -b <library.blend> --python bin/room_plush_ao.py -- --out <assets-dir>
Printed alpha planes do not occlude the cloth. Movable toys have no baked floor.
Meshopt the selected GLB and update manifest bytes after this export.
"""
import argparse
import json
import math
import random
import shutil
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

p=argparse.ArgumentParser();p.add_argument('--out',required=True,type=Path)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
scene=bpy.data.scenes['Assets'];bpy.context.window.scene=scene
library=Path(bpy.data.filepath)
backup=library.parent/'backups'/'room_assets-before-sjtu-ao-fix.blend'
backup.parent.mkdir(exist_ok=True)
if not backup.exists():shutil.copy2(library,backup)
coll=bpy.data.collections['asset_plush_sjtu']
objs=[o for o in coll.objects if o.type=='MESH']
def printed(o):return o.name.startswith('print_') or all(m and m.name.split('.')[0]=='print' for m in o.data.materials)
scene.view_layers[0].update()
verts,polys=[],[]
for o in objs:
    if printed(o):continue
    k=len(verts);verts.extend(o.matrix_world@v.co for v in o.data.vertices)
    polys.extend([k+i for i in f.vertices]for f in o.data.polygons)
bvh=BVHTree.FromPolygons(verts,polys)
rays=64;golden=math.pi*(3-math.sqrt(5));directions=[]
for i in range(rays):
    u=(i+.5)/rays;r=math.sqrt(u);phi=i*golden
    directions.append((r*math.cos(phi),r*math.sin(phi),math.sqrt(1-u)))
def openness(point,n,t,b):
    origin=point+n*.0008
    return 1-sum(bvh.ray_cast(origin,t*x+b*y+n*z,.03)[0]is not None for x,y,z in directions)/rays
rng=random.Random(7)
for o in objs:
    me=o.data;old=me.attributes.get('_AO');previous=[v.value for v in old.data]if old else []
    values=[1.0]*len(me.loops)
    if not printed(o):
        mw=o.matrix_world;nm=mw.to_3x3().inverted().transposed();wv=[mw@v.co for v in me.vertices]
        for f in me.polygons:
            n=(nm@f.normal).normalized()
            if n.length<.5:continue
            c=sum((wv[i]for i in f.vertices),Vector())/len(f.vertices)
            t0=n.orthogonal().normalized();a=rng.random()*math.tau
            t=(t0*math.cos(a)+n.cross(t0)*math.sin(a)).normalized();b=n.cross(t)
            for li in f.loop_indices:
                point=wv[me.loops[li].vertex_index].lerp(c,.15)
                ao=openness(point,n,t,b)
                if ao<.9:ao=max(ao,openness(point,-n,-t,b))
                values[li]=ao
        groups={}
        for li,lp in enumerate(me.loops):
            n=me.corner_normals[li].vector
            key=(lp.vertex_index,round(n.x,2),round(n.y,2),round(n.z,2))
            groups.setdefault(key,[]).append(li)
        for lis in groups.values():
            value=round(sum(values[i]for i in lis)/len(lis)*64)/64
            for i in lis:values[i]=value
    if old:me.attributes.remove(old)
    me.attributes.new('_AO','FLOAT','CORNER').data.foreach_set('value',values)
    print(o.name,'dark corners before/after',sum(v<.25 for v in previous),sum(v<.25 for v in values),'AO range',min(values),max(values))
coll['ao_bake']=json.dumps({'alpha_print_planes_occlude':False,'floor_occlusion':False,'radius_m':.03,'samples':rays})
bpy.ops.wm.save_as_mainfile(filepath=str(library))
source=Path(__file__).with_name('room_assets_export.py')
exporter={'__name__':'room_export'}
exec(compile(source.read_text(),str(source),'exec'),exporter)
name,entry=exporter['export'](coll,args.out)
manifest=args.out/'manifest.json';m=json.loads(manifest.read_text());m['assets'][name]=entry
manifest.write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n')
