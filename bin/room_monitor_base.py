"""Centre the monitor's base plate below its upright, preserving panel/screen nodes.

Run with the configured room_assets.blend open in background Blender:
  --python bin/room_monitor_base.py -- --out public/room/assets
Only asset_monitor and its GLB/manifest entry change. Meshopt-compress afterwards.
"""
import argparse
import json
import runpy
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
scene = bpy.data.scenes["Assets"]
bpy.context.window.scene = scene
coll = bpy.data.collections["asset_monitor"]
bpy.context.view_layer.update()
obj = next(o for o in coll.objects if o.name == "monitor")
mesh = obj.data
adj = {v.index: [] for v in mesh.vertices}
for edge in mesh.edges:
    a, b = edge.vertices
    adj[a].append(b)
    adj[b].append(a)
seen, components = set(), []
for vertex in mesh.vertices:
    if vertex.index in seen:
        continue
    todo, ids = [vertex.index], []
    seen.add(vertex.index)
    while todo:
        i = todo.pop()
        ids.append(i)
        for j in adj[i]:
            if j not in seen:
                seen.add(j)
                todo.append(j)
    points = [obj.matrix_world @ mesh.vertices[i].co - coll.instance_offset for i in ids]
    lo = Vector(tuple(min(p[j] for p in points) for j in range(3)))
    hi = Vector(tuple(max(p[j] for p in points) for j in range(3)))
    components.append((ids, lo, hi))
base = next(c for c in components if c[1].z < .001 and c[2].z < .03)
upright = next(c for c in components if c[1].z < .03 and c[2].z > .20)
shift = (upright[1].y + upright[2].y - base[1].y - base[2].y) / 2
delta = obj.matrix_world.inverted().to_3x3() @ Vector((0, shift, 0))
for i in base[0]:
    mesh.vertices[i].co += delta
mesh.update()
layout = json.loads(coll.get("layout", "{}"))
layout.update({"base_centre_y": round((upright[1].y + upright[2].y) / 2, 6),
               "base_alignment": "centred below upright; panel and screen unchanged"})
coll["layout"] = json.dumps(layout)
coll.asset_data.description = '27" monitor; base plate centred below upright. Screen plane for paper demos.'

# Reuse the standard collection export without re-exporting the other room assets.
scope = runpy.run_path(str(Path(__file__).with_name("room_assets_export.py")))
name, entry = scope["export"](coll, args.out)
manifest_path = args.out / "manifest.json"
manifest = json.loads(manifest_path.read_text())
manifest["assets"][name] = entry
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("Monitor base moved back", round(shift * 100, 3), "cm; screen and upright unchanged.")
