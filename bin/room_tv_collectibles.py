"""Prepare the TV-console collectibles in a separate review blend.

blender -b --python bin/room_tv_collectibles.py -- --source-dir <downloads> --out <review.blend> \
    --xatlas-python <python with numpy and xatlas>
Then append selected collections with room_model_assets.py, WebP and meshopt their GLBs.
Gul'dan bakes the downloaded sculpt onto a charted display mesh; the M1917 is built here.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--source-dir', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--xatlas-python', default='python3')
parser.add_argument('--assets', nargs='+', default=['bili_pillow', 'guldan_figure', 'm1917_figure'])
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def collection(name, description, preserve=False):
    c = bpy.data.collections.new('asset_'+name)
    scene.collection.children.link(c)
    c.asset_mark()
    c.asset_data.description = description
    c['catalog'] = 'Room/Collectibles'
    c['mount'] = 'desk'
    if preserve:
        c['preserve_materials'] = True
    return c


def material(name, color, roughness=.8, metalness=0, vertex=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    bs = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metalness
    if vertex:
        a = m.node_tree.nodes.new('ShaderNodeVertexColor')
        a.layer_name = 'Color'
        m.node_tree.links.new(a.outputs['Color'], bs.inputs['Base Color'])
    return m


fabric = material('fabric', (1, 1, 1), vertex=True)


def move(o, c):
    for old in list(o.users_collection):
        old.objects.unlink(o)
    c.objects.link(o)
    return o


def paint(o, color, mat=fabric):
    o.data.materials.clear()
    o.data.materials.append(mat)
    old = o.data.color_attributes.get('Color')
    if old:
        o.data.color_attributes.remove(old)
    attr = o.data.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='CORNER')
    o.data.color_attributes.active_color = attr
    rgb = tuple(int(color[i:i+2], 16)/255 for i in (1, 3, 5))
    for v in attr.data:
        v.color_srgb = (*rgb, 1)
    return o


def soft(c, name, at, size, color):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=at)
    o = move(bpy.context.object, c)
    o.name = name
    o.scale = size
    for p in o.data.polygons:
        p.use_smooth = True
    return paint(o, color)


def stroke(c, name, points, color, width=.0014):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = width
    data.bevel_resolution = 1
    spl = data.splines.new('POLY')
    spl.points.add(len(points)-1)
    for p, co in zip(spl.points, points):
        p.co = (*co, 1)
    o = bpy.data.objects.new(name, data)
    c.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    for p in o.data.polygons:
        p.use_smooth = True
    return paint(o, color)


def joined(c, name):
    bpy.ops.object.select_all(action='DESELECT')
    meshes = [o for o in c.objects if o.type == 'MESH']
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes)>1:
        bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o


def imported(path, c):
    before = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    new = set(scene.objects)-before
    meshes = []
    for obj in new:
        if obj.type != 'MESH':
            continue
        cp = bpy.data.objects.new(path.stem+'_'+obj.name, obj.data.copy())
        cp.data.transform(obj.matrix_world)
        c.objects.link(cp)
        meshes.append(cp)
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def bounds(meshes):
    points = [o.matrix_world@v.co for o in meshes for v in o.data.vertices]
    return [Vector(tuple(fn(v[i] for v in points) for i in range(3))) for fn in (min, max)]



def simplify(o, triangles):
    bpy.context.view_layer.objects.active = o
    total = sum(len(p.vertices)-2 for p in o.data.polygons)
    if total>triangles:
        m = o.modifiers.new('Static display mesh', 'DECIMATE')
        m.ratio = triangles/total
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
    for p in o.data.polygons:
        p.use_smooth = True
    print('SIMPLIFIED', o.name, sum(len(p.vertices)-2 for p in o.data.polygons), flush=True)


# Runs in a separate Python with the xatlas package: chart and pack a triangle mesh.
XATLAS = """
import sys, numpy as np, xatlas
d = np.load(sys.argv[1]); a = xatlas.Atlas(); a.add_mesh(d['v'], d['f'])
pack = xatlas.PackOptions(); pack.resolution = int(sys.argv[3]); pack.padding = 4; pack.bilinear = True; pack.blockAlign = True
a.generate(xatlas.ChartOptions(), pack)
vm, ix, uv = a[0]; np.savez(sys.argv[2], vm=vm, ix=ix, uv=uv)
"""

if 'bili_pillow' in args.assets:
    c = collection('bili_pillow', 'Original pink-and-white bilibili TV-inspired plush cushion, 145 mm wide: inflated fabric body, curved pink embroidered screen/face, soft antennae and small feet. No bitmap textures.')
    a, b, h, center = .0725, .035, .051, .066
    def signed(x, exponent=.48):
        return math.copysign(abs(x)**exponent, x)
    vertices = []
    # A rounded superellipsoid gives the face a stuffed, continuous bulge.
    for j in range(25):
        lat = -math.pi/2+math.pi*j/24
        for i in range(48):
            lon = math.tau*i/48
            vertices.append((a*signed(math.cos(lat))*signed(math.cos(lon)),
                             b*signed(math.cos(lat))*signed(math.sin(lon)),
                             center+h*signed(math.sin(lat))))
    faces = [(j*48+i, j*48+(i+1)%48, (j+1)*48+(i+1)%48, (j+1)*48+i) for j in range(24) for i in range(48)]
    mesh = bpy.data.meshes.new('Stuffed cushion')
    mesh.from_pydata(vertices, [], faces)
    o = bpy.data.objects.new('Soft white TV body', mesh)
    c.objects.link(o)
    paint(o, '#fff5f5')
    for p in o.data.polygons:
        p.use_smooth = True
    # Pastel pink backing, softly blended at the stitched side seam.
    attr = mesh.color_attributes['Color']
    for lp in mesh.loops:
        if mesh.vertices[lp.vertex_index].co.y > .008:
            attr.data[lp.index].color_srgb = (.97, .72, .80, 1)
    def face(x, z, lift=.0016):
        power = 2/.48
        y = -b*max(.001, 1-(abs(x)/a)**power-(abs(z)/h)**power)**(1/power)
        return (x, y-lift, center+z)
    # An embroidered rounded-rectangle outline follows the curved fabric surface.
    outline = []
    for x, z, angle in ((.045,.027,0),(-.045,.027,90),(-.045,-.027,180),(.045,-.027,270)):
        for i in range(9):
            t = math.radians(angle+90*i/8)
            outline.append(face(x+.012*math.cos(t), z+.012*math.sin(t)))
    stroke(c, 'Pink embroidered TV screen', outline+[outline[0]], '#e88faa', .0015)
    for sign in (-1, 1):
        stroke(c, 'Slanted embroidered eye', [face(sign*(.019+.012*t/8), .023-.010*t/8, .002) for t in range(9)], '#d8799b', .0023)
        soft(c, 'Blush cheek', face(sign*.036, -.004, .0019), (.007,.0013,.0025), '#f6c1d0')
    mouth = []
    # Two shallow smiling arcs meet in the middle (the mascot's small w-shaped mouth).
    for k in range(25):
        x = -.017+.034*k/24
        z = -.006-.010*abs(math.sin(math.pi*x/.017))
        mouth.append(face(x, z, .002))
    stroke(c, 'Embroidered smile', mouth, '#d8799b', .0016)
    for sign in (-1, 1):
        foot = soft(c, 'Soft white foot', (sign*.042,-.001,.009), (.014,.020,.009), '#fff5f5')
        antenna = soft(c, 'Pink fabric antenna', (sign*.031, .001, .131), (.006,.007,.026), '#ed9bb5')
        antenna.rotation_euler.y = sign*math.radians(25)
    o = joined(c, 'bili_pillow')
    # Weld the coincident pole vertices, leaving a closed smooth cloth surface.
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
    bm.to_mesh(o.data); bm.free()
    c['license'] = 'Original geometry; bilibili mascot design belongs to bilibili.'
    c['calibration'] = json.dumps({'body_width_m': .145, 'static': True})
if 'guldan_figure' in args.assets:
    c = collection('guldan_figure', "Gul'dan collectible adapted from Berczihun's CC BY sculpture: 160 mm tall, 10k-triangle display mesh with the 300k-triangle sculpt baked into 1024px normal and painted-colour maps (green skin, purple robes, ivory bones, iron chains, fel vials, crevice shading).", True)
    meshes = imported(args.source_dir/'guldan.glb', c)
    lo, hi = bounds(meshes)
    transform = Matrix.Scale(.16/(hi.z-lo.z), 4) @ Matrix.Translation(Vector((-(lo.x+hi.x)/2, -(lo.y+hi.y)/2, -lo.z)))
    for o in meshes:
        o.data.transform(transform)
    high = joined(c, 'guldan_sculpt')
    bm = bmesh.new(); bm.from_mesh(high.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0000008)
    bm.to_mesh(high.data); bm.free()
    # The 1.28M-triangle sculpt is reduced only to a bake source; it never ships.
    simplify(high, 300000)
    me = high.data
    bm = bmesh.new(); bm.from_mesh(me); tree = BVHTree.FromBMesh(bm); bm.free()
    # Region paint on the dense sculpt, in normalized millimetres. Thickness (ray to the
    # opposite surface) separates chains, drips and fingers from the robe behind them.
    def staff_x(z): return -27.4-.083*(z-19)
    def ellipse(x, z, cx, cz, rx, rz): return ((x-cx)/rx)**2 + ((z-cz)/rz)**2 < 1
    def region(x, y, z, t, front, nz):
        if z < 12.5 or (z < 22 and math.hypot(x, y) > 44) or (z < 17.5 and nz > .55 and not (-18 < x < -3 and y < -14)): return 'rock'
        if 10 < z < 84 and abs(x-staff_x(z)) < 3.6 and -26 < y < -4: return 'wood'
        if x < -24 and z > 94: return 'bone'
        if -39.5 < x < -25.5 and 83 < z < 94.5 and y < -2: return 'wrap' if x > -29.5 and z < 90 else 'skin'
        if x > 31 and 73 < z < 95 and y < -26: return 'skin'
        if z > 113:
            if 4.5 < x < 18 and z < 119.5: return 'mantle'
            return 'bone' if t < 6 or x > 18 or x < -1 else 'horn'
        if x > 32 and z > 100 and t < 4: return 'horn'
        if y < -11 and (front or t < 3.2):
            if ellipse(x, z, 12, 108.6, 4.6, 5.2): return 'skin'
            if 76 < z <= 104 and abs(x-10.4) < 2.6+3.7*(z-76)/27: return 'beard'
            if (-5.5 < x < .5 or 17.5 < x < 22.8) and 67 < z < 81: return 'gold' if z < 69.5 else 'fel'
            if (-6.5 < x < .5 or 18 < x < 25.5) and 66 < z < 84 and t < 3.5: return 'gold' if z < 77 else 'iron'
            if (-6 < x < -.5 or 19.5 < x < 24) and 84 <= z < 113 and t < 3.2: return 'iron'
            if abs(math.hypot(x-10.2, z-85.5)-11) < 1.6 and z < 86 and t < 3: return 'iron'
            if 8 < x < 12.5 and 64 < z < 75: return 'gold'
            if ellipse(x, z, 13.4, 55.3, 7.2, 10.8) or ellipse(x, z, 12.6, 30.5, 8.6, 15.5): return 'bone'
            if -18 < x < -3 and 12.5 < z < 20.5 and y < -14: return 'skin'
        if t < 2.6 and 45 < z < 90 and (x < -21 or x > 31): return 'fel'
        if z < 26: return 'hem'
        return 'mantle' if z > 79 else 'robe'
    palette = dict(robe='#5a3b70', mantle='#684889', hem='#3f2a52', rock='#77736a', wood='#5e3f2a', bone='#d9cca6',
                   horn='#a8946e', skin='#6f9a3f', beard='#c9c9bd', iron='#3d3c42', gold='#b48a3a', fel='#86d93a', wrap='#6b4a30')
    regions = []
    for v in me.vertices:
        n, p = v.normal, v.co
        hit = tree.ray_cast(p-n*.00003, -n, .008)
        thick = hit[3] if hit[0] else .008
        front = n.y < .2 and tree.ray_cast(p+n*.00003, Vector((0, -1, 0)), .2)[0] is None
        regions.append(region(p.x*1000, p.y*1000, p.z*1000, thick*1000, front, n.z))
    # Write colours only after the loop: each write invalidates the mesh's normal cache.
    attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for out, name in zip(attr.data, regions):
        h = palette[name]
        out.color_srgb = (*[int(h[i:i+2], 16)/255 for i in (1, 3, 5)], 1)
    me.color_attributes.active_color = attr
    # Display mesh, charted by xatlas: Blender's projection shatters the spiky sculpt
    # into thousands of slivers whose mips average unrelated colours.
    o = high.copy(); o.data = high.data.copy(); o.name = 'guldan_figure'; c.objects.link(o)
    simplify(o, 10000)
    o.data.color_attributes.remove(o.data.color_attributes['Color'])
    import numpy as np, subprocess, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        faces = np.array([p.vertices[:] for p in o.data.polygons], dtype=np.uint32)
        np.savez(tmp+'/mesh.npz', v=np.array([v.co[:] for v in o.data.vertices], dtype=np.float32), f=faces)
        subprocess.run([args.xatlas_python, '-I', '-c', XATLAS, tmp+'/mesh.npz', tmp+'/uv.npz', '1024'], check=True)
        result = np.load(tmp+'/uv.npz'); ix, uvs = result['ix'], result['uv']
    assert (result['vm'][ix] == faces).all()
    layer = o.data.uv_layers.new(name='UVMap')
    for p in o.data.polygons:
        for k, li in enumerate(p.loop_indices):
            layer.data[li].uv = uvs[ix[p.index][k]]
    # Bake source: painted colour shaded by short-range AO, emitted so lighting stays out.
    source = bpy.data.materials.new('Guldan bake source'); nt = source.node_tree; nt.nodes.clear()
    emit = nt.nodes.new('ShaderNodeEmission'); vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Color'
    ao = nt.nodes.new('ShaderNodeAmbientOcclusion'); ao.samples = 24; ao.inputs['Distance'].default_value = .004
    shade = nt.nodes.new('ShaderNodeMapRange'); shade.inputs['To Min'].default_value = .5
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    nt.links.new(ao.outputs['AO'], shade.inputs['Value']); nt.links.new(vc.outputs['Color'], mix.inputs[6])
    nt.links.new(shade.outputs['Result'], mix.inputs[7]); nt.links.new(mix.outputs[2], emit.inputs['Color'])
    nt.links.new(emit.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs[0])
    high.data.materials.clear(); high.data.materials.append(source)
    resin = bpy.data.materials.new('Guldan painted resin'); resin.use_backface_culling = True
    nt = resin.node_tree; bs = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bs.inputs['Roughness'].default_value = .72; bs.inputs['Metallic'].default_value = 0
    color = bpy.data.images.new('Guldan painted colour', 1024, 1024, alpha=False)
    normal = bpy.data.images.new('Guldan sculpt normal', 1024, 1024, alpha=False); normal.colorspace_settings.name = 'Non-Color'
    color_node = nt.nodes.new('ShaderNodeTexImage'); color_node.image = color
    nt.links.new(color_node.outputs['Color'], bs.inputs['Base Color'])
    normal_node = nt.nodes.new('ShaderNodeTexImage'); normal_node.image = normal
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(normal_node.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bs.inputs['Normal'])
    o.data.materials.clear(); o.data.materials.append(resin)
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 64
    bake = scene.render.bake
    bake.use_selected_to_active = True; bake.cage_extrusion = .0015; bake.max_ray_distance = .004; bake.margin = 4
    bpy.ops.object.select_all(action='DESELECT'); high.select_set(True); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    nt.nodes.active = color_node; bpy.ops.object.bake(type='EMIT')
    nt.nodes.active = normal_node; bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
    for img in (color, normal):
        # Push-pull fill: empty texels take nearby chart colours, so distant mips never
        # average a chart with the black background.
        n = img.size[0]; px = np.empty(n*n*4, np.float32); img.pixels.foreach_get(px); px = px.reshape(n, n, 4)
        mask = (px[..., :3].sum(-1) > 1e-4).astype(np.float32)
        levels = [(px[..., :3]*mask[..., None], mask)]
        while levels[-1][1].shape[0] > 1:
            col, w = levels[-1]; h = col.shape[0]//2
            levels.append((col.reshape(h, 2, h, 2, 3).sum((1, 3)), w.reshape(h, 2, h, 2).sum((1, 3))))
        up = levels[-1][0]/np.maximum(levels[-1][1], 1e-6)[..., None]
        for col, w in reversed(levels[:-1]):
            up = np.repeat(np.repeat(up, 2, 0), 2, 1)
            k = np.minimum(w, 1)[..., None]
            up = col/np.maximum(w, 1e-6)[..., None]*k + up*(1-k)
        px[..., :3] = np.where(mask[..., None] > 0, px[..., :3], up); px[..., 3] = 1
        img.pixels.foreach_set(px.ravel()); img.pack()
    bpy.data.objects.remove(high, do_unlink=True)
    c['license'] = 'CC-BY-4.0'
    c['credits'] = json.dumps({'author':'Berczihun','source':'https://sketchfab.com/3d-models/wo-w--guldanobj-24fb93047c6d4b668e01abe2021c070b','changes':'Scaled to 160 mm; 10k-triangle display mesh with normal and colour maps baked from a 300k-triangle reduction; original region-painted palette based on Blizzard Guldan references, with baked ambient occlusion.'})
    c['calibration'] = json.dumps({'height_m': .16, 'static': True})

if 'm1917_figure' in args.assets:
    c = collection('m1917_figure', "Ornate M1917 display miniature after the user's Battlefield 1 'An Escalation' references: dark aubergine water jacket with two silver engraved collars and green stones, wide brass bipod band and floral brass muzzle cap with a spoked ring sight and dangling chain; narrow engraved receiver with ember diamond inlay, ring rear sight and wooden rear grip; skull feed plate below; small lacquered skull ammunition box mounted by its short end on the left side, sticking out sideways above the feed plate; brass folding bipod on the charcoal plinth. Original geometry; one 1024px atlas shared by two materials.", True)
    import numpy as np
    # ---------- engraved atlas (1024²): every textured part samples one image ----------
    N=1024
    img=np.zeros((N,N,3),np.float32)   # row 0 = v 0 (bottom), as Blender stores pixels
    rng=np.random.default_rng(1917)
    def hexc(h): return np.array([int(h[i:i+2],16)/255 for i in (1,3,5)],np.float32)**2.2
    def rect(u0,v0,u1,v1): return slice(int(v0*N),int(v1*N)),slice(int(u0*N),int(u1*N))
    def fill(r,col,noise=.06):
        sl=img[r]; sl[:]=col*(1+noise*rng.standard_normal(sl.shape[:2])[...,None]).clip(.7,1.3)
    def stamp(pts,col,radius,r):
        # pts in 0..1 local coords of rect r; discs stamped in pixel space.
        rs,cs=r; h=rs.stop-rs.start; w=cs.stop-cs.start
        rad=int(math.ceil(radius)); oy,ox=np.mgrid[-rad:rad+1,-rad:rad+1]; m=(ox**2+oy**2)<=radius**2
        oy,ox=oy[m],ox[m]
        for u,v in pts:
            py=int(v*(h-1))+oy; px=int(u*(w-1))+ox; k=(py>=0)&(py<h)&(px>=0)&(px<w)
            img[rs.start+py[k],cs.start+px[k]]=col
    def scroll(r,col,periods,amp,radius,curls=True,phase=0):
        pts=[]
        for t in np.linspace(0,1,4000):
            pts.append((t,.5+amp*math.sin(2*math.pi*(periods*t)+phase)))
        if curls:
            for k in range(int(periods*2)):
                t0=(k+.5)/(periods*2); s=1 if k%2 else -1
                for a in np.linspace(0,4.2,260):
                    rr=.035*(1-a/5.2)
                    pts.append((t0+rr*math.cos(a+phase)*.5,.5+s*(amp*.55)+s*rr*math.sin(a)*2.2))
                for a in np.linspace(0,1,40):  # leaf
                    pts.append((t0-.02+.04*a,.5-s*(amp*.15)+s*.12*math.sin(math.pi*a)))
        stamp(pts,col,radius,r)
    def border(r,col,width=3,inset=6):
        rs,cs=r; s=img[r]; h,w=s.shape[:2]
        for d in range(inset,inset+width):
            s[d,d:w-d]=col; s[h-1-d,d:w-d]=col; s[d:h-d,d]=col; s[d:h-d,w-1-d]=col
    def skull(r,cx,cy,sc,bone,dark):
        rs,cs=r; s=img[r]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; x=(xx/w-cx)/sc; y=(yy/h-cy)/sc*h/w
        cran=(x/.5)**2+((y-.12)/.48)**2<1; jaw=(abs(x)<.28)&(y<-.18)&(y>-.5)
        s[cran|jaw]=bone
        eye=((abs(x)-.2)/.15)**2+((y-.02)/.13)**2<1; nose=(abs(x)<.07-(y+.15)*.3)&(y<-.07)&(y>-.2)
        teeth=(y<-.3)&(y>-.48)&(abs(x)<.26)&((np.floor((x+.26)/.087)%2)==0)
        s[eye|nose]=dark; s[teeth]=dark*1.6
    BRASS=hexc('#c99a45'); DBRASS=hexc('#6e4b1f'); JACKET=hexc('#2f1c26'); STEEL=hexc('#272426')
    SILVER=hexc('#b9b2a2'); DSILVER=hexc('#5d5750'); EMBER=hexc('#b65a2c'); GEM=hexc('#2bb08d')
    WOOD=hexc('#8a4523'); BONE=hexc('#e8e2d2')
    def gem(r,cx,cy,rad,col):
        rs,cs=r; s=img[r]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]
        d=np.hypot((xx-cx*w),(yy-cy*h)); s[d<rad+3]=DBRASS; s[d<rad]=col; s[d<rad*.45]=col*1.6
    # A: water jacket (length along u, circumference along v; v .5 faces the viewer, .25 the top).
    # Dark aubergine steel with fine ember engraving, two silver engraved collars set with green
    # stones, as in the reference; the wide brass band at the bipod is its own geometry.
    A=rect(0,0,.5,.5); fill(A,JACKET,.07)
    for v0 in (.06,.31,.56,.81):
        scroll(rect(0,v0*.5,.5,(v0+.13)*.5),EMBER*.55,14,.3,.7,curls=False,phase=v0*9)
    for u0,u1 in ((.06,.2),(.55,.69)):
        col=rect(u0*.5,0,u1*.5,.5); fill(col,SILVER,.05); hc=col[0].stop-col[0].start
        for v0 in np.arange(0,1,.125):
            scroll((slice(col[0].start+int(v0*hc),col[0].start+int((v0+.125)*hc)),col[1]),DSILVER,2.5,.32,1.2,phase=v0*5)
        for k in (3,4,col[1].stop-col[1].start-5,col[1].stop-col[1].start-4):
            img[col[0],col[1].start+k]=BRASS
        for v in (.0,.25,.5,.75): gem(col,.5,v+.02 if v==0 else v,7,GEM)
    # B1: the ammunition box's outer face (box-shaped region): lacquered wood, brass inlay border,
    # an engraved skull; B2: plain grain for the lid, ends, bottom and the rear grip.
    B1=rect(.5,0,.75,.3); fill(B1,WOOD,.05)
    s=img[B1]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]
    s*= (1+.07*np.sin(xx/w*90+np.sin(yy/h*11)*1.5)+.04*np.sin(yy/h*37))[...,None]
    border(B1,BRASS,3,7); border(B1,DBRASS,1,14)
    skull(B1,.5,.52,.42,BONE*.92,hexc('#3a1c0c'))
    B2=rect(.5,.3,1,.5); fill(B2,WOOD,.05); s=img[B2]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; s*=(1+.07*np.sin(xx/w*160+np.sin(yy/h*9)*1.5))[...,None]
    border(B2,DBRASS,2,6)
    # P: the dark feed plate under the receiver, brass-rimmed with a pale skull (lower half shows).
    P=rect(.75,0,1,.25); fill(P,STEEL,.05)
    s=img[P]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; rr=np.hypot(xx/w-.5,yy/h-.5)
    s[abs(rr-.41)<.018]=BRASS; s[abs(rr-.36)<.006]=DBRASS
    skull(P,.5,.27,.2,SILVER,STEEL*.5)
    # C1: brass muzzle cap face, engraved floral ring; C2: brass bands, lightly engraved.
    C1=rect(0,.5,.25,.75); fill(C1,BRASS,.05)
    s=img[C1]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; rr=np.hypot(xx/w-.5,yy/h-.5); an=np.arctan2(yy/h-.5,xx/w-.5)
    s[(abs(rr-.44)<.012)|(abs(rr-.30)<.008)|(abs(rr-.17)<.006)]=DBRASS
    petal=(rr>.31)&(rr<.43)&(np.cos(an*8)>.55+((rr-.37)/.06)**2*.4); s[petal]=DBRASS
    s[(rr<.16)&(np.cos(an*6)>.3)]=DBRASS
    C2=rect(0,.75,.5,1); fill(C2,BRASS,.05); scroll(C2,DBRASS,10,.3,1.2,curls=False)
    # E: plain brass; F: dark steel (sights, rails, legs, plate edges).
    E=rect(.26,.51,.49,.74); fill(E,BRASS,.03)
    F=rect(.5,.5,1,.6); fill(F,hexc('#1f1c1e'),.02)
    # D: engraved receiver steel: silver scrollwork and, mid-side, the ember diamond inlay.
    D=rect(.5,.6,1,1); fill(D,STEEL,.05); border(D,DSILVER,2,6)
    for v0 in (.18,.82):
        sub=(slice(D[0].start+int((v0-.1)*(D[0].stop-D[0].start)),D[0].start+int((v0+.1)*(D[0].stop-D[0].start))),D[1])
        scroll(sub,DSILVER,5,.3,1.1,phase=v0*3)
    s=img[D]; h,w=s.shape[:2]; yy,xx=np.mgrid[0:h,0:w]; dx=abs(xx/w-.62)/.2; dy=abs(yy/h-.5)/.17
    s[dx+dy<1.12]=BRASS; s[dx+dy<1]=EMBER; s[dx+dy<.55]=EMBER*1.35; s[(dx+dy<.22)]=BRASS
    atlas=bpy.data.images.new('M1917 ornate atlas',N,N,alpha=False)
    px=np.ones((N,N,4),np.float32); px[...,:3]=np.clip(img,0,1)**(1/2.2)
    atlas.pixels.foreach_set(px.ravel()); atlas.pack()

    def atlas_material(name,metal,rough):
        m=bpy.data.materials.new(name); m.use_backface_culling=True
        bs=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
        t=m.node_tree.nodes.new('ShaderNodeTexImage'); t.image=atlas
        m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color'])
        return m
    METAL=atlas_material('M1917 ornate gilded steel',.85,.34)
    WOODM=atlas_material('M1917 ornate lacquered wood',0,.42)
    charcoal=bpy.data.materials.new('Miniature stand charcoal'); charcoal.use_backface_culling=True
    bs=next(n for n in charcoal.node_tree.nodes if n.type=='BSDF_PRINCIPLED'); bs.inputs['Base Color'].default_value=(.025,.029,.038,1); bs.inputs['Roughness'].default_value=.62; bs.inputs['Metallic'].default_value=.15

    # ---------- geometry ----------
    def put(o,m):
        for old in list(o.users_collection): old.objects.unlink(o)
        c.objects.link(o); o.data.materials.clear(); o.data.materials.append(m)
        bpy.context.view_layer.objects.active=o; o.select_set(True)
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True); o.select_set(False)
        return o
    def uvmap(o,fn):
        me=o.data; uv=me.uv_layers[0] if me.uv_layers else me.uv_layers.new()
        for p in me.polygons:
            for li in p.loop_indices:
                co=me.vertices[me.loops[li].vertex_index].co; uv.data[li].uv=fn(co,p.normal)
    def in_rect(r,u,v):
        rs,cs=r; return (cs.start+u*(cs.stop-cs.start))/N,(rs.start+v*(rs.stop-rs.start))/N
    def solid(r): return lambda co,n: in_rect(r,.5,.5)
    def cyl_x(r,x0,x1,cy,cz,flat=None):
        def f(co,n):
            if flat is not None and abs(n.x)>.7: return flat(co,n)
            a=(math.atan2(co.z-cz,co.y-cy)/(2*math.pi))%1
            return in_rect(r,(co.x-x0)/(x1-x0),a)
        return f
    def disc(r,cy,cz,R):
        return lambda co,n: in_rect(r,.5+(co.y-cy)/(2*R)*-1,.5+(co.z-cz)/(2*R))
    def tube(name,a,b,r0,r1,m,verts=24,fn=None):
        a,b=Vector(a),Vector(b); d=b-a
        bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=r0,radius2=r1,depth=d.length,location=(a+b)/2)
        o=bpy.context.object; o.name=name; o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
        for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
        put(o,m); uvmap(o,fn or solid(E)); return o
    def box(name,center,size,m,fn,bevel=.0008):
        bpy.ops.mesh.primitive_cube_add(size=1,location=center); o=bpy.context.object; o.name=name; o.scale=size
        put(o,m)
        if bevel:
            md=o.modifiers.new('b','BEVEL'); md.width=bevel; md.segments=2; md.limit_method='ANGLE'
            bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=md.name)
        uvmap(o,fn); return o
    def side_box(r_side,r_rest,center,size):
        cx,cy,cz=center; sx,sy,sz=size
        def f(co,n):
            u=(co.x-(cx-sx/2))/sx; v=(co.z-(cz-sz/2))/sz
            if abs(n.y)>.7: return in_rect(r_side,u if n.y<0 else 1-u,v)
            if abs(n.z)>.7: return in_rect(r_rest,u,(co.y-(cy-sy/2))/sy)
            return in_rect(r_rest,(co.y-(cy-sy/2))/sy,v)
        return f

    Z=.0385   # bore axis height above the plinth base
    JR=.0088 # water jacket radius
    J0,J1=-.060,.018
    jacket=cyl_x(A,J0,J1,0,Z,solid(F))
    # Water jacket, its two raised silver collars (same engraving as painted on the jacket) and brass
    # rings: the muzzle collar, the wide band the bipod clamps to, and the rear ring at the receiver.
    tube('Water jacket',(J0,0,Z),(J1,0,Z),JR,JR,METAL,40,jacket)
    for u0,u1 in ((.06,.2),(.55,.69)):
        tube('Silver jacket collar',(J0+u0*(J1-J0),0,Z),(J0+u1*(J1-J0),0,Z),JR*1.03,JR*1.03,METAL,40,jacket)
    for x0,x1,r in [(-.064,-.0595,JR*1.08),(-.0405,-.0305,JR*1.09),(.0155,.0205,JR*1.08)]:
        tube('Brass jacket band',(x0,0,Z),(x1,0,Z),r,r,METAL,40,cyl_x(C2,x0,x1,0,Z,solid(E)))
    # Brass muzzle cap face and the barrel muzzle protruding through it.
    tube('Muzzle cap',(-.0655,0,Z),(-.064,0,Z),JR*1.06,JR*1.08,METAL,40,disc(C1,0,Z,JR*1.08))
    tube('Muzzle',(-.080,0,Z-.0030),(-.065,0,Z-.0030),.0026,.0026,METAL,20,solid(F))
    tube('Muzzle ring',(-.080,0,Z-.0030),(-.0775,0,Z-.0030),.0030,.0030,METAL,20,solid(F))
    # Spoked ring sight standing on the muzzle collar (the reference's tall wheel sight).
    SX,SR=-.0618,.0046
    SC=Vector((SX,0,Z+JR*1.08+.0018+SR))
    tube('Ring sight post',(SX,0,Z+JR*1.04),(SX,0,SC.z-SR+.0003),.0008,.0008,METAL,8,solid(E))
    bpy.ops.mesh.primitive_torus_add(major_radius=SR,minor_radius=.00045,major_segments=28,minor_segments=6,location=SC,rotation=(0,math.pi/2,0))
    o=bpy.context.object; o.name='Ring sight'; put(o,METAL); uvmap(o,solid(F))
    for k in range(4):
        a=k*math.pi/4; d=Vector((0,math.cos(a),math.sin(a)))*SR
        tube('Ring sight spoke',SC-d,SC+d,.00022,.00022,METAL,6,solid(F))
    tube('Ring sight hub',SC-Vector((.0005,0,0)),SC+Vector((.0005,0,0)),.0009,.0009,METAL,10,solid(E))
    # Short decorative chain hanging under the cap, ending in a small pendant.
    for k in range(5):
        bpy.ops.mesh.primitive_torus_add(major_radius=.0011,minor_radius=.00032,major_segments=10,minor_segments=5,
            location=(-.0668,0,Z-.0098-k*.0019),rotation=(0,math.pi/2*(k%2),0))
        o=bpy.context.object; o.name='Cap chain link'; put(o,METAL); uvmap(o,solid(F))
    tube('Chain pendant',(-.0668,0,Z-.0205),(-.0668,0,Z-.0175),.0002,.0012,METAL,8,solid(E))
    # Long, narrow engraved receiver (ember diamond inlay on its sides), top rails, a brass knob
    # at the front, a small ring rear sight, and the wooden rear grip with its trigger lever.
    RX0,RX1=.0205,.080
    RC=((RX0+RX1)/2,0,Z+.0006); RS=(RX1-RX0,.0125,.0156)
    box('Receiver',RC,RS,METAL,side_box(D,D,RC,RS))
    top=RC[2]+RS[2]/2
    for y in (-.0042,.0042):
        box('Receiver top rail',(.052,y,top+.0006),(.052,.0018,.0012),METAL,solid(F),bevel=.0003)
    tube('Receiver brass knob',(.0255,0,top),(.0255,0,top+.0024),.0023,.0021,METAL,16,solid(E))
    box('Rear sight base',(.064,0,top+.0011),(.006,.0040,.0022),METAL,solid(F),bevel=.0003)
    tube('Rear sight post',(.064,0,top+.0022),(.064,0,top+.0040),.0005,.0005,METAL,8,solid(F))
    bpy.ops.mesh.primitive_torus_add(major_radius=.0019,minor_radius=.00042,major_segments=18,minor_segments=6,location=(.064,0,top+.0059),rotation=(0,math.pi/2,0))
    o=bpy.context.object; o.name='Rear ring sight'; put(o,METAL); uvmap(o,solid(E))
    box('Rear plate',(.0815,0,RC[2]),(.003,.0118,.0150),METAL,solid(F),bevel=.0005)
    tube('Rear grip',(.083,0,Z-.001),(.0905,0,Z-.0125),.0026,.0032,WOODM,12,lambda co,n: in_rect(B2,.5,.5))
    tube('Trigger lever',(.083,0,Z+.004),(.088,0,Z+.001),.0007,.0007,METAL,8,solid(E))
    box('Charging handle',(.074,-.0074,Z-.001),(.006,.0028,.0030),METAL,solid(F),bevel=.0005)
    # Dark feed plate hanging under the receiver front, its upper half inside the receiver.
    DR=.0105; DC=(.031,0,RC[2]-RS[2]/2+.0008)
    tube('Feed plate',(DC[0],-.0016,DC[2]),(DC[0],.0016,DC[2]),DR,DR,METAL,40,
         lambda co,n: in_rect(P,.5+(co.x-DC[0])/(2.4*DR)*(-1 if n.y>0 else 1),.5+(co.z-DC[2])/(2.4*DR)) if abs(n.y)>.7 else in_rect(E,.5,.5))
    # The lacquered ammunition box, mounted by its short end on the receiver's left (viewer) side
    # just behind the jacket and sticking straight out sideways: its long side runs across the gun.
    # The skull face looks toward the muzzle. It sits level with the receiver, above the feed plate,
    # so the plate's lower half shows below it.
    BS=(.012,.021,.020); BX=(.0205+.0075,-(RS[1]/2+BS[1]/2),RC[2]-RS[2]/2+BS[2]/2)
    def box_faces(cx,cy,cz,sx,sy,sz):
        def f(co,n):
            u=(cy+sy/2-co.y)/sy; v=(co.z-(cz-sz/2))/sz
            if n.x<-.7: return in_rect(B1,u,v)
            if abs(n.z)>.7: return in_rect(B2,(co.x-(cx-sx/2))/sx,u)
            if abs(n.y)>.7: return in_rect(B2,(co.x-(cx-sx/2))/sx,v)
            return in_rect(B2,1-u,v)
        return f
    box('Ammunition box',BX,BS,WOODM,box_faces(*BX,*BS),bevel=.0008)
    for x in (BX[0]-BS[0]/2+.0006,BX[0]+BS[0]/2-.0006):
        for y in (BX[1]-BS[1]/2+.0006,BX[1]+BS[1]/2-.0006):
            box('Ammunition box brass corner',(x,y,BX[2]),(.0016,.0016,BS[2]+.0008),METAL,solid(E),bevel=.0004)
    box('Ammunition box lid',(BX[0],BX[1],BX[2]+BS[2]/2+.0005),(BS[0]+.0008,BS[1]+.0008,.0011),WOODM,lambda co,n: in_rect(B2,.5,.5),bevel=.0003)
    lid=BX[2]+BS[2]/2+.0011
    # Strap handle along the box's long side, on lugs near its two ends.
    for y in (BX[1]-.0055,BX[1]+.0055):
        tube('Ammunition box handle lug',(BX[0],y,lid),(BX[0],y,lid+.0024),.0006,.0006,METAL,8,solid(E))
    box('Ammunition box strap',(BX[0],BX[1],lid+.0028),(.0042,.0128,.0009),WOODM,lambda co,n: in_rect(B2,.2,.5),bevel=.0003)
    # Folding bipod clamped under the wide brass band: brass legs, dark lower tubes and claw feet.
    BPX=-.0355
    box('Bipod yoke',(BPX,0,Z-JR-.0018),(.006,.008,.004),METAL,solid(E),bevel=.0005)
    FOOT_Z=.004
    for s in (-1,1):
        top=Vector((BPX,s*.0035,Z-JR-.003)); foot=Vector((BPX-.0095,s*.0235,FOOT_Z+.0012))
        knee=top.lerp(foot,.55)
        tube('Bipod leg upper',top,knee,.0013,.0012,METAL,12,solid(E))
        tube('Bipod leg lower',knee,foot,.0010,.0009,METAL,12,solid(F))
        tube('Bipod knee clamp',knee-(foot-top).normalized()*.0012,knee+(foot-top).normalized()*.0012,.0016,.0016,METAL,12,solid(E))
        tube('Bipod spade',foot+Vector((0,0,-.0012)),foot+Vector((0,0,.0006)),.0026,.0012,METAL,10,solid(F))
        for a in (-1,1):
            tube('Bipod claw',foot+Vector((0,0,.0004)),foot+Vector((a*.0034,s*.0012,-.0012)),.0005,.0003,METAL,6,solid(E))
    # Display plinth and a single rear post under the receiver (front rests on the bipod).
    box('M1917 display plinth',(0,0,.002),(.19,.055,.004),charcoal,solid(F),bevel=.0018)
    tube('Rear display post',(.070,0,.004),(.070,0,RC[2]-RS[2]/2),.0018,.0018,METAL,12,solid(E))
    for p in c.objects:
        for f in p.data.polygons:
            if len(f.vertices)!=4 and p.name.startswith(('Water','Silver jacket','Brass jacket','Muzzle','Feed plate')): f.use_smooth=False
    c['license'] = 'Original geometry and texture.'
    c['calibration'] = json.dumps({'display_base_m':[.19,.055,.004],'bore_height_m':Z,'bipod':True,'rear_post':True,'side_ammunition_box':True,'rear_grip':True,'ring_sights':True,'static':True})

args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
for c in scene.collection.children:
    if c.name.startswith('asset_'):
        lo, hi = bounds([o for o in c.objects if o.type=='MESH'])
        print('ASSET', c.name, 'size', list(hi-lo), flush=True)
