"""Export every asset_* collection of room_assets.blend to public/room/assets/.

Run through bin/room-assets (it starts Blender headless with this script).
Writes <name>.glb per asset plus manifest.json (size, mount, special planes,
shelf tiers...) for room.config.ts.
"""
import bpy, json, re, sys
from pathlib import Path

out_dir = Path(sys.argv[sys.argv.index("--") + 1])
out_dir.mkdir(parents=True, exist_ok=True)
SPECIAL = ("screen", "cover", "board")

def base(name):
    return re.sub(r"\.\d{3}$", "", name)

def dims(objs):
    pts = [o.matrix_world @ v.co for o in objs if o.type == "MESH" for v in o.data.vertices]
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi

def plane_info(o):
    lo, hi = dims([o])
    return {"width": round(hi[0] - lo[0], 4), "height": round(hi[2] - lo[2], 4),
            "aspect": round((hi[0] - lo[0]) / (hi[2] - lo[2]), 4)}

def export(coll):
    name = coll.name[len("asset_"):]
    objs = list(coll.objects)
    offset = coll.instance_offset.copy()
    saved = {o: (o.location.copy(), o.name) for o in objs}
    # move to origin and give nodes clean names (Blender forces .001 on repeats)
    for o in objs:
        if o.parent is None:  # children follow their parent (blind_cloth / blind_bar empties)
            o.location -= offset
        clean = base(o.name)
        clash = bpy.data.objects.get(clean)
        if clash and clash is not o:
            clash.name = clean + "__tmp"
            saved.setdefault(clash, (clash.location.copy(), clean))
        o.name = clean
    bpy.context.view_layer.update()
    lo, hi = dims(objs)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    path = out_dir / f"{name}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                              export_apply=True, export_vertex_color="ACTIVE",
                              export_cameras=False, export_lights=False, export_materials="EXPORT",
                              export_attributes=True)  # writes `_AO` (baked occlusion, 1 = open)
    meshes = [o for o in objs if o.type == "MESH"]
    tris = sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)
    entry = {
        "file": f"{name}.glb",
        "catalog": coll.get("catalog"),
        "mount": coll.get("mount", "floor"),
        "size": [round(hi[i] - lo[i], 4) for i in range(3)],  # x (width), y (depth), z (height), m
        "elevation": coll.get("elevation", 0.0),  # height above floor in the measured room
        "roles": sorted({m.name for o in meshes for m in o.data.materials if m}),
        "triangles": tris,
        "bytes": path.stat().st_size,
        "description": coll.asset_data.description if coll.asset_data else "",
    }
    for o in objs:
        if base(o.name) in SPECIAL:
            entry[base(o.name)] = plane_info(o)
    # every other custom property on the collection (tiers, board_size, pot_rim,
    # chair_top_pivot, blind_cloth_length...); lists are stored as JSON strings
    for key in coll.keys():
        if key in ("catalog", "mount", "elevation", "note") or key in entry:
            continue
        value = coll[key]
        entry[key] = json.loads(value) if isinstance(value, str) and value[:1] in "[{" else value
    for o, (loc, n) in saved.items():
        o.location = loc
    for o, (loc, n) in saved.items():
        o.name = n
    return name, entry

scene = bpy.data.scenes["Assets"]
bpy.context.window.scene = scene if bpy.context.window else scene
manifest = {"source": Path(bpy.data.filepath).name,  # file name only: the manifest is public
            "units": "m", "front": "-Y", "up": "+Z (glTF +Y)", "assets": {}}
for coll in sorted(scene.collection.children, key=lambda c: c.name):
    if coll.name.startswith("asset_"):
        name, entry = export(coll)
        manifest["assets"][name] = entry
        print(f"{name:12s} {entry['triangles']:6d} tris {entry['bytes'] / 1024:7.1f} KB")
(out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
total = sum(e["bytes"] for e in manifest["assets"].values())
print(f"total {total / 1024 / 1024:.2f} MB, {len(manifest['assets'])} assets -> {out_dir}")
