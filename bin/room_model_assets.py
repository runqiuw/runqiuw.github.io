"""Append reviewed miniatures to the configured room asset library.

Run Blender with the library open and pass --source <review.blend> --out <assets-dir>
after --. Only the selected asset collections and their GLB/manifest entries change. The normal
bin/room-assets export will retain the collections on future exports.
Use --assets quest3 imu_devices to select multiple collections; the default is rover.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
parser.add_argument("--assets", nargs="+", default=["rover"])
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
scene = bpy.data.scenes["Assets"]
bpy.context.window.scene = scene

for asset_name in args.assets:
    collection_name = "asset_" + asset_name
    old = bpy.data.collections.get(collection_name)
    if old:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(old)
    with bpy.data.libraries.load(str(args.source), link=False) as (source, target):
        if collection_name not in source.collections:
            raise RuntimeError("The source file has no requested asset collection")
        target.collections = [collection_name]
    coll = target.collections[0]
    scene.collection.children.link(coll)
    coll["catalog"] = "Sections/Projects"
    coll["mount"] = "shelf"
    if bpy.data.collections["asset_shelf"].asset_data:
        coll.asset_data.catalog_id = bpy.data.collections["asset_shelf"].asset_data.catalog_id

    offset = coll.instance_offset.copy()
    for part in coll.objects:
        if part.parent is None:
            part.location -= offset
    coll.instance_offset = (0, 0, 0)

    # Join once in Blender, retaining Color data and material roles. This keeps
    # the normal exporter at one primitive per role rather than per mechanical part.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in coll.objects:
        obj.select_set(True)
        for i, mat in enumerate(obj.data.materials):
            role = re.sub(r"\.\d{3}$", "", mat.name)
            canonical = bpy.data.materials.get(role)
            if canonical:
                obj.data.materials[i] = canonical
    bpy.context.view_layer.objects.active = next(iter(coll.objects))
    if len(coll.objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = asset_name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.validate()
    # Clay miniatures use Color rather than bitmap maps. Keep UVs only for page-driven planes.
    if not any(m.name in {"screen", "cover", "board", "print"} for m in obj.data.materials):
        for uv in list(obj.data.uv_layers):
            obj.data.uv_layers.remove(uv)
    bpy.context.view_layer.update()
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector(tuple(min(v[i] for v in points) for i in range(3)))
    hi = Vector(tuple(max(v[i] for v in points) for i in range(3)))

    args.out.mkdir(parents=True, exist_ok=True)
    file = args.out / (asset_name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=str(file), export_format="GLB", use_selection=True, use_active_scene=True,
        export_apply=True, export_vertex_color="ACTIVE", export_cameras=False,
        export_lights=False, export_materials="EXPORT", export_attributes=True,
    )
    manifest_file = args.out / "manifest.json"
    manifest = json.loads(manifest_file.read_text())
    manifest["assets"][asset_name] = {
        "file": file.name, "catalog": coll["catalog"], "mount": coll["mount"],
        "size": [round(v, 4) for v in hi - lo], "elevation": 0,
        "roles": sorted({m.name for m in obj.data.materials}),
        "triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons),
        "bytes": file.stat().st_size, "description": coll.asset_data.description,
    }
    for key in ("components", "calibration", "layout", "license", "credits"):
        if key in coll:
            value = coll[key]
            manifest["assets"][asset_name][key] = json.loads(value) if isinstance(value, str) and value.startswith(("[", "{")) else value
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    # Park it beside the other assets for browsing. instance_offset cancels this on export.
    offset = Vector((max(c.instance_offset.x for c in scene.collection.children) + 1.5, 0, 0))
    coll.instance_offset = offset
    obj.location += offset
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print(asset_name + " added to the library and exported; other assets unchanged.")
