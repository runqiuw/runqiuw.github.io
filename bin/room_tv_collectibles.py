"""Prepare the TV-console collectibles in a separate review blend.

blender -b --python bin/room_tv_collectibles.py -- --source-dir <downloads> --out <review.blend>
Then append selected collections with room_model_assets.py and meshopt their GLBs.
Downloaded meshes are static decorative miniatures, without rigs or animation.
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


def keep_main_island(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00004)
    seen, islands = set(), []
    for v in bm.verts:
        if v in seen:
            continue
        stack, island = [v], []
        seen.add(v)
        while stack:
            x = stack.pop(); island.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y not in seen:
                    seen.add(y); stack.append(y)
        islands.append(island)
    islands.sort(key=len, reverse=True)
    bmesh.ops.delete(bm, geom=[v for a in islands[1:] for v in a], context='VERTS')
    bm.to_mesh(o.data); bm.free()


def atlas(o):
    """Repack only the retained gun's diffuse color, without cart texture baggage."""
    source_uv = o.data.uv_layers.active
    source_uv.name = 'SourceUV'
    target = bpy.data.images.new('M1917 retained gun color', width=1024, height=1024, alpha=False)
    for m in o.data.materials:
        if not m or not m.use_nodes:
            continue
        nodes = m.node_tree.nodes
        uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'SourceUV'
        for n in list(nodes):
            if n.type == 'TEX_IMAGE' and n.image:
                m.node_tree.links.new(uv.outputs['UV'], n.inputs['Vector'])
        bake = nodes.new('ShaderNodeTexImage'); bake.image = target
        nodes.active = bake
    uv = o.data.uv_layers.new(name='AtlasUV')
    o.data.uv_layers.active = uv
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=8)
    # Recover the scan's dark midtones without flattening its worn surface detail.
    import numpy as np
    pixels = np.empty(len(target.pixels), dtype=np.float32)
    target.pixels.foreach_get(pixels)
    pixels = pixels.reshape((-1, 4))
    pixels[:, :3] = .43 + .51 * np.clip(pixels[:, :3], 0, 1)**.60
    target.pixels.foreach_set(pixels.ravel())
    target.update()
    target.pack()
    m = material('M1917 original scanned finish', (.4,.4,.4), .54, .12)
    bs = next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    tex = m.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = target
    m.node_tree.links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    o.data.materials.clear(); o.data.materials.append(m)
    for p in o.data.polygons:
        p.material_index = 0
    for name in [layer.name for layer in o.data.uv_layers if layer.name != 'AtlasUV']:
        o.data.uv_layers.remove(o.data.uv_layers[name])
    o.data.uv_layers.active = o.data.uv_layers['AtlasUV']


def stand_box(c, name, at, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    o = move(bpy.context.object, c); o.name = name; o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = o.modifiers.new('Display base edges', 'BEVEL'); mod.width = .0018; mod.segments = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(mat)
    return o


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
    c = collection('guldan_figure', "Gul'dan collectible adapted from Berczihun's CC BY sculpture: 160 mm tall, simplified static sculpt, hand-painted green skin, purple robes, ivory bones and vertex-baked crevice shading. No bitmap textures.", True)
    meshes = imported(args.source_dir/'guldan.glb', c)
    lo, hi = bounds(meshes)
    transform = Matrix.Scale(.16/(hi.z-lo.z), 4) @ Matrix.Translation(Vector((-(lo.x+hi.x)/2, -(lo.y+hi.y)/2, -lo.z)))
    for o in meshes:
        o.data.transform(transform)
    o = joined(c, 'guldan_figure')
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.0000008)
    bm.to_mesh(o.data); bm.free()
    simplify(o, 18000)
    resin = material('Guldan painted resin', (1,1,1), .74, .02, True)
    paint(o, '#60436f', resin)
    # Shading is baked into colors so the static collectible needs no AO shader/texture.
    bm = bmesh.new(); bm.from_mesh(o.data)
    tree = BVHTree.FromBMesh(bm); bm.free()
    openness = []
    for v in o.data.vertices:
        n = v.normal.normalized()
        tangent = n.orthogonal().normalized()
        bitangent = n.cross(tangent)
        hits = 0
        for k in range(24):
            r = math.sqrt((k+.5)/24); angle = k*2.39996323
            ray = tangent*(r*math.cos(angle))+bitangent*(r*math.sin(angle))+n*math.sqrt(1-r*r)
            hits += tree.ray_cast(v.co+n*.000025, ray, .008)[0] is not None
        openness.append(.60+.40*(1-hits/24))
    attr = o.data.color_attributes['Color']
    # The source is a joined untextured sculpt. Paint anatomical regions in its
    # normalized coordinates, preserving the sculpt and one texture-free draw group.
    def pigment(p):
        x, y, z = p
        color = '#60436f' if y < .006 else '#51395e'
        if z < .014 or (z < .025 and abs(x) > .045): return '#777b70'
        if abs(x - (-.025-.10*z)) < .0048 and z < .132: color = '#65442f'
        if z > .119 and x < -.025: color = '#d2c5a0'
        if z > .115 and (x > .022 or (-.016 < x < -.004 and y > -.008)):
            color = '#cec29f'
        if ((x-.008)/.010)**2 + ((z-.104)/.010)**2 < 1 and y < -.018:
            color = '#648b3c'
        if (((x-.042)/.011)**2 + ((z-.082)/.010)**2 < 1 and y < -.018) or \
           (((x+.033)/.008)**2 + ((z-.092)/.009)**2 < 1 and y < -.012):
            color = '#719644'
        if ((x-.009)/.007)**2 + ((z-.085)/.019)**2 < 1 and y < -.023:
            color = '#b8b9ac'
        if ((x-.012)/.013)**2 + ((z-.040)/.029)**2 < 1 and y < -.017:
            color = '#c5b991'
        if ((x-.013)/.0035)**2 + ((z-.061)/.0035)**2 < 1 and y < -.023:
            color = '#91c844'
        if z < .024 and y < -.014 and .012 < abs(x) < .027: color = '#698743'
        return color
    for lp in o.data.loops:
        color = pigment(o.data.vertices[lp.vertex_index].co)
        attr.data[lp.index].color_srgb = (*[int(color[i:i+2],16)/255 for i in (1,3,5)], 1)
        col = attr.data[lp.index].color[:]
        attr.data[lp.index].color = (*[v*openness[lp.vertex_index] for v in col[:3]], 1)
    for uv in list(o.data.uv_layers):
        o.data.uv_layers.remove(uv)
    c['license'] = 'CC-BY-4.0'
    c['credits'] = json.dumps({'author':'Berczihun','source':'https://sketchfab.com/3d-models/wo-w--guldanobj-24fb93047c6d4b668e01abe2021c070b','changes':'Scaled to 160 mm, merged/simplified static mesh, original region-painted resin palette based on Blizzard Guldan references and vertex crevice shading.'})
    c['calibration'] = json.dumps({'height_m': .16, 'static': True})

if 'm1917_figure' in args.assets:
    c = collection('m1917_figure', "M1917A1 miniature adapted from Anticipateants' CC BY museum scan: full upper gun with its curved cradle, sights and rear grip retained; low circular mount block, cart and wheels removed. Restored two-post exhibition base and side ammunition box; one readable 1024px source-color atlas.", True)
    meshes = imported(args.source_dir/'m1917_machine_gun_idaho_military_history_museum.glb', c)
    # Retain the complete upper assembly, including the arc-shaped cradle the user marked.
    # This scan's coordinates are arbitrary, not real-world manufacture measurements.
    for o in meshes:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z<10.8], context='VERTS')
        bm.to_mesh(o.data); bm.free()
        if not o.data.polygons:
            bpy.data.objects.remove(o, do_unlink=True)
    o = joined(c, 'm1917_figure')
    keep_main_island(o)
    o.data.transform(Matrix.Rotation(-math.pi/2, 4, 'Z'))
    lo, hi = bounds([o])
    o.data.transform(Matrix.Translation((0,0,.040)) @ Matrix.Scale(.18/(hi.x-lo.x),4) @ Matrix.Translation((-(lo.x+hi.x)/2,-(lo.y+hi.y)/2,-lo.z)))
    # Remove only the low circular mounting shoe/stub marked in the latest reference.
    # The curved cradle above it stays; do not repeat the old whole-cradle cut.
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < .052], context='VERTS')
    bm.to_mesh(o.data); bm.free()
    keep_main_island(o)
    simplify(o, 18000)
    atlas(o)
    steel = material('M1917 accessory painted steel', (.12,.14,.115), .60, .28)
    brass = material('M1917 aged brass fittings', (.35,.25,.12), .50, .48)
    wood = material('M1917 ammunition box warm wood', (.32,.18,.075), .80, 0)
    lid = material('M1917 ammunition box end grain', (.24,.125,.045), .80, 0)

    def rod(name, start, end, r0, r1, mat):
        start, end = Vector(start), Vector(end)
        d = end-start
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=r0, radius2=r1, depth=d.length, location=(start+end)/2)
        obj = move(bpy.context.object, c); obj.name = name
        obj.rotation_euler = d.to_track_quat('Z','Y').to_euler()
        obj.data.materials.append(mat)
        for face in obj.data.polygons:
            face.use_smooth = len(face.vertices)==4
        return obj

    # The reference's side-mounted rectangular ammunition box, with restrained lid/handle detail.
    stand_box(c, 'Side ammunition box', (.031,-.025,.078), (.040,.020,.027), wood)
    stand_box(c, 'Ammunition box lid', (.031,-.025,.092), (.041,.021,.002), lid)
    stand_box(c, 'Ammunition box mounting bracket', (.031,-.014,.084), (.023,.003,.010), steel)
    for x in (.017,.045):
        stand_box(c, 'Ammunition box hinge', (x,-.024,.0933), (.003,.005,.0009), brass)
    # Small raised handle, kept within the cabinet-front clearance envelope.
    rod('Ammo handle left lug', (.026,-.026,.0934), (.026,-.026,.096), .0007,.0007,steel)
    rod('Ammo handle right lug', (.036,-.026,.0934), (.036,-.026,.096), .0007,.0007,steel)
    rod('Ammo box carrying handle', (.026,-.026,.096), (.036,-.026,.096), .0008,.0008,steel)
    # Restore the earlier rectangular display plinth and two upright support rods.
    # Level the scan's upward muzzle pitch, then lower the retained cradle just above
    # a thinner plinth. The gun is rotated uniformly, never scaled to clear the screen.
    pitch = Matrix.Rotation(math.radians(-6.5),4,'Y')
    for part in c.objects:
        part.matrix_world = pitch @ part.matrix_world
    bpy.context.view_layer.update()
    lo, hi = bounds([o])
    lift = .005-lo.z
    center_x = (lo.x+hi.x)/2
    for part in c.objects:
        part.location += Vector((-center_x,.011,lift))
    bpy.context.view_layer.update()
    charcoal = material('Miniature stand charcoal', (.025,.029,.038), .62, .15)
    stand_box(c, 'M1917 display plinth', (0,0,.002), (.19,.055,.004), charcoal)
    tree = BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons])
    for x in (-.052,.048):
        hit = tree.ray_cast(Vector((x,.011,.004)), Vector((0,0,1)), .15)[0]
        height = hit.z if hit else .025
        stand_box(c, 'M1917 support post', (x,.011,(height+.004)/2), (.0035,.006,height-.004), brass)
    for part in c.objects:
        # The atlas already includes the scan's color. Exporting Color again both
        # darkens it twice and gives newly joined stand/box vertices black defaults.
        for attr in list(part.data.color_attributes):
            part.data.color_attributes.remove(attr)
        if part != o:
            for uv in list(part.data.uv_layers):
                part.data.uv_layers.remove(uv)
    c['license'] = 'CC-BY-4.0'
    c['credits'] = json.dumps({'author':'Anticipateants','source':'https://sketchfab.com/3d-models/m1917-machine-gun-idaho-military-history-museum-323b8d115e6b4016b40ca667d700761d','changes':'Retained complete upper gun, curved cradle, sights and grip; removed cart and wheels. Static simplification and repacked 1024px source atlas with lifted midtones. Removed the low circular mounting shoe/stub while retaining the curved cradle. Levelled the muzzle pitch and lowered the gun onto shortened posts above a thinner rectangular exhibition plinth; side wooden ammunition box retained. No tripod.'})
    c['calibration'] = json.dumps({'gun_length_m':.18,'tripod':False,'display_base_m':[.19,.055,.004],'display_support':'short_two_posts','lower_mount_block':False,'cradle_plinth_clearance_m':.001,'display_pitch_degrees':-6.5,'curved_cradle':True,'side_ammunition_box':True,'cart':False,'wheels':False,'static':True})

args.out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(args.out))
for c in scene.collection.children:
    if c.name.startswith('asset_'):
        lo, hi = bounds([o for o in c.objects if o.type=='MESH'])
        print('ASSET', c.name, 'size', list(hi-lo), flush=True)
