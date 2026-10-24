"""Add/update asset_court in the configured Blender library and export only that asset.

Run Blender in background with the library open:
  blender -b <library.blend> --python bin/room_court_asset.py -- public/room/assets
Then meshopt-compress court.glb and update its manifest bytes. Later bin/room-assets
exports it normally. Court measurements match HOOPS in src/scripts/room.config.ts.
"""
import bpy
import json
import math
import sys
from pathlib import Path

out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes["Assets"]
bpy.context.window.scene = scene
old = bpy.data.collections.get("asset_court")
if old:
    for obj in list(old.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(old)
coll = bpy.data.collections.new("asset_court")
scene.collection.children.link(coll)
coll.asset_mark()
coll.asset_data.description = "Compact seafoam basketball rug with cream court lines, free-throw lane and 1.32 m three-point arc. 140 x 168 cm, clear of the bed and cart."
coll["catalog"] = "Room/Furniture"
coll["mount"] = "floor"
coll["three_radius"] = 1.32
fabric = bpy.data.materials.get("fabric") or bpy.data.materials.new("fabric")

def mesh(name, vertices, faces, color):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    coll.objects.link(obj)
    data.materials.append(fabric)
    attr = data.color_attributes.new(name="Color", type="FLOAT_COLOR", domain="CORNER")
    rgb = tuple(int(color[i:i+2], 16) / 255 for i in (1, 3, 5)) + (1,)
    for value in attr.data:
        value.color_srgb = rgb
    data.color_attributes.active_color = attr
    return obj

# A thin, rounded fabric slab, origin at its bottom center, front toward -Y.
w, depth, radius = 1.4, 1.68, 0.07
outline = []
for cx, cy, start in [(w/2-radius, depth/2-radius, 0), (-w/2+radius, depth/2-radius, 90),
                      (-w/2+radius, -depth/2+radius, 180), (w/2-radius, -depth/2+radius, 270)]:
    for i in range(9):
        a = math.radians(start + i * 90 / 8)
        outline.append((cx + radius * math.cos(a), cy + radius * math.sin(a)))
n = len(outline)
vertices = [(x, y, z) for z in (0, 0.012) for x, y in outline]
faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
mesh("court_fabric", vertices, faces, "#83b9aa")

bin_y, free_y, three = -0.7, 0.18, 1.32
edge_x, edge_y = w/2-0.06, depth/2-0.06
mesh("court_key", [(-0.32, -edge_y, 0.013), (0.32, -edge_y, 0.013),
                   (0.32, free_y, 0.013), (-0.32, free_y, 0.013)], [(0, 1, 2, 3)], "#b7d5bb")
line_verts, line_faces = [], []
def path(points, width=0.013, z=0.014):
    for a, b in zip(points, points[1:]):
        dx, dy = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dy)
        if length < 1e-6:
            continue
        nx, ny = -dy/length*width/2, dx/length*width/2
        offset = len(line_verts)
        line_verts.extend([(a[0]+nx, a[1]+ny, z), (a[0]-nx, a[1]-ny, z),
                           (b[0]-nx, b[1]-ny, z), (b[0]+nx, b[1]+ny, z)])
        line_faces.append(tuple(offset+i for i in range(4)))
def arc(cx, cy, r, a0, a1, steps=64):
    return [(cx+r*math.cos(a0+(a1-a0)*i/steps), cy+r*math.sin(a0+(a1-a0)*i/steps)) for i in range(steps+1)]
path([(-edge_x, -edge_y), (edge_x, -edge_y), (edge_x, edge_y), (-edge_x, edge_y), (-edge_x, -edge_y)])
path([(-0.32, -edge_y), (-0.32, free_y), (0.32, free_y), (0.32, -edge_y)])
path(arc(0, free_y, 0.29, 0, math.pi))
for i in range(8):
    path(arc(0, free_y, 0.29, math.pi+i*math.pi/8, math.pi+(i+0.5)*math.pi/8, 4), 0.009)
a = math.acos(edge_x/three)
path(arc(0, bin_y, three, a, math.pi-a))
y = bin_y+math.sqrt(three**2-edge_x**2)
path([(-edge_x, -edge_y), (-edge_x, y)])
path([(edge_x, -edge_y), (edge_x, y)])
path(arc(0, bin_y, 0.22, 0, math.pi), 0.01)
for side in (-1, 1):
    for y in (-0.45, -0.25, -0.05):
        path([(side*0.32, y), (side*0.38, y)], 0.009)
mesh("court_lines", line_verts, line_faces, "#fff4dc")

# Save the new collection so the normal asset watcher/exporter retains it.
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
bpy.ops.object.select_all(action="DESELECT")
for obj in coll.objects:
    obj.select_set(True)
file = out / "court.glb"
bpy.ops.export_scene.gltf(filepath=str(file), export_format="GLB", use_selection=True,
                          export_apply=True, export_vertex_color="ACTIVE", export_cameras=False,
                          export_lights=False, export_materials="EXPORT", export_attributes=True)
manifest_file = out / "manifest.json"
manifest = json.loads(manifest_file.read_text())
manifest["assets"]["court"] = {
    "file": "court.glb", "catalog": "Room/Furniture", "mount": "floor",
    "size": [w, depth, 0.014], "elevation": 0, "roles": ["fabric"],
    "triangles": sum(len(p.vertices)-2 for o in coll.objects for p in o.data.polygons),
    "bytes": file.stat().st_size, "description": coll.asset_data.description, "three_radius": three,
}
manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")
print("Court rug exported; other assets unchanged.")
