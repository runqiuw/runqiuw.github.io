# Blender assets

**Split (decided 2026-10-08): Blender builds the 3D assets; three.js assembles the scene.**

| Blender (assets) | Code: `src/scripts/room.config.ts` (scene) |
|---|---|
| Shape of each piece of furniture or prop | Room shell (walls, floor, windows, doors) from the measured size 413 × 370 × 270 cm |
| Its materials (clay look) | Where each asset sits, which way it faces, color overrides |
| Optional baked ambient occlusion per asset | Pinboard and its cards (generated from `playground.yaml`) |
| | Camera shot per section, hotspots, labels, lights |

Moving furniture, recoloring, retuning cameras or adding a section only touches the config. Blender is opened only to make or reshape an asset. Saving the `.blend` exports automatically (watch script), so there's no manual export step.

Asset library: a local `bedroom/` folder outside the repo (its `.blend` path goes in `bin/.room-assets-path`, not committed) (registered in Blender as the asset library "Bedroom room"; layout in its `README.md`).
- `room_assets.blend`: all `asset_*` collections, marked as assets with catalogs. Rebuilt from the measured model by `scripts/build_assets.py`; thumbnails by `scripts/render_previews.py`.
- `source/卧室硬装.blend`: the measured 1:1 model, untouched. `source/卧室_web.blend` is a plain copy of it that the build script reads (scene 日照模拟 = photo-matched version).
- Export: `bin/room-assets` (once) or `bin/room-assets --watch` (re-export on every save) → `public/room/assets/<name>.glb` + `manifest.json`.

**Me** = modeling. **Claude** = export/watch script, web import, config.

## 1. Asset rules
- **One collection per asset**, named `asset_<name>`: `asset_bed`, `asset_desk`, `asset_monitor`, `asset_chair`, `asset_lamp`, `asset_cart`, `asset_sidetable`, `asset_nightstand`, `asset_mirror`, `asset_door`, `asset_window`, `asset_pinboard`, `asset_gamecorner`…
- **Real scale** (1 unit = 1 m), as now.
- **Origin at the bottom center** of the asset, sitting on the floor (z = 0).
- **Front faces −Y** (the way the monitors face the room today), so the code can rotate assets consistently.
- **Repeated items are one asset**: one `asset_monitor`, placed twice in the config.
- **Material names describe the role**, not the product: `frame`, `fabric`, `wood`, `metal`, `screen`, `glass`, `glow`, `accent`. The config can recolor a role per placement (for example a blue bed frame, a coral chair).
- **Screens and frames that show page content** (monitor, TV, mirror if used): add a flat plane named `screen` with clean UVs, so the site can put a paper, a game cover or a photo on it.
- Keep it light: no tiny details (screws, outlet holes), bevel instead of subdividing.

## 2. Asset list

Status as of 2026-10-21: §2.1 and §2.2 are done (22 assets in `room_assets.blend`, exported to `public/room/assets/`). The site builds the room from these files via `src/scripts/room.config.ts` (the prototype `room-clay.glb` is gone).

Notes from the build:
- Original colors are kept per vertex (`Color` attribute → glTF `COLOR_0`); the role materials are white × vertex color, so a role recolor in the config replaces the color, and without one the asset looks as modeled.
- Monitors are landscape in the model (screen 59.8 × 33.6, 16:9), not portrait as the 2026-09 photo notes say.
- Chair: headrest removed instead of shortening the backrest (back is now 106 cm tall).
- Extra assets not in the table: `asset_glasstable` (glass shelf at the bed end, estimated size), `asset_desklamp` (one lamp, placed on side table and nightstand), `asset_keyboard`, `asset_paper`. No laptop model exists in the source.
- Window and door: origin at the bottom of the asset; `manifest.json` `elevation` is the height in the measured room (window sill 0.61 m).

Priority: **P0** unblocks the code (config loader, monitors). **P1** gives the Projects and Games sections something to show. **P2** is polish.

### 2.1 Existing furniture → assets (P0)
Source: `卧室硬装.blend` (measured model). Built into `room_assets.blend`, one `asset_*` collection each, origin bottom center, front −Y, scale applied, materials renamed by role.

| Asset | From | Size (cm) | Notes |
|---|---|---|---|
| `asset_monitor` | 27″ monitor 1 | screen 59.8 × 33.6 | **Most important.** Add a plane named `screen` exactly over the display area with UVs filling 0–1 (16:9, no stretch), material `screen`. Papers and clips play on it. One asset, placed twice |
| `asset_desk` | edx 63×24 standing desk | 160 × 61 × 74 | Fixed height. Controller box can stay as a tiny `accent` |
| `asset_chair` | B100 mesh chair | — | It blocks the monitors in close-ups. Lower the backrest a little; the config can also turn it |
| `asset_lamp` | PACOVY floor lamp | ~166 tall | Lamp head material `glow` (lights on at night) |
| `asset_cart` | Brightroom 3-tier cart | 44.8 × 35.9 × 77.5 | Keep even if a shelf becomes the projects object; it can hold small props |
| `asset_sidetable` | black small table | 80 × 50 × 75 | |
| `asset_nightstand` | bedside cabinet | — | Bed-side lamp bulb material `glow` |
| `asset_bed` | Queen bed | ~216 × 159 | Kept but not placed (2026-10-21); the room uses `asset_bed_single` |
| `asset_bed_single` | twin version of the queen bed | 105 × 204 | Done 2026-10-21 (mattress 99 × 190.5, one pillow) |
| `asset_mirror` | EDX mirror 64×21 | 163 × 53 | No longer a hotspot. Low priority; drop if space is needed |
| `asset_window` | left-wall window | 87 wide, sill 64, top 243 | Frame + glass + blind as one asset; placed twice. Glass material `glass` |
| `asset_door` | door + frame | 99 × 210 | Contact section's object. Handle as `accent` |
| `asset_laptop`, `asset_paper` | desk props (`details`) | — | Small; optional |

Not needed: ceiling, ceiling fan, outlets, vent (too small or never seen). The room shell (walls, floor) is built in code from 413 × 370 × 270.

### 2.2 New assets for page sections (P1)
| Asset | Section | Spec |
|---|---|---|
| `asset_shelf` | Projects | Open bookshelf, about 80 × 30 × 150, 4 tiers, ~30 cm clear height per tier. Decision: shelf instead of the cart (open question in PLAN). Each tier's top surface is where the config puts project models |
| `asset_tv` | Games | 43–50″ TV (about 110 × 62). `screen` plane with 0–1 UVs, 16:9. Gameplay clips play here |
| `asset_tvstand` | Games | Low console, about 120 × 40 × 50 |
| `asset_console` | Games | Game console + 2 controllers, chunky toy shapes |
| `asset_beanbag` | Games | Floor seat in front of the TV, makes "game corner" readable at a glance |
| `asset_gamebox` | Games (optional) | One game case/cartridge with a `cover` plane (UVs 0–1). Placed 3×; the code puts each game's cover on it, the one in view lifts |
| `asset_pinboard` | Playground | Cork board + frame, about 150 × 90 × 3. Front face named `board`; the code pins cards from `playground.yaml`. Wall-mounted: origin at bottom center of the back face |

### 2.3 Project models for the shelf (deferred 2026-10-21, decide later)
Toy-sized figurines (fit in a 30 cm tier; real scale doesn't apply, the config scales them).

| Asset | Project | How |
|---|---|---|
| `asset_proj_rover` | Transformable Rover (ME350) | From CAD (Claude converts: STEP/STL → decimate → clay roles). Fallback: model from photos |
| `asset_proj_arm` | Robotic Arm with Flexible Grippers (ME250) | Same |
| `asset_proj_vehicle` | Bluetooth Robotics Vehicle | Same |
| `asset_proj_imu` | IMU On-Body Localization | Prop set: phone + watch + earbuds (the devices in the project figure) |
| `asset_proj_headset` | SketchGenie | AR headset prop |
| `asset_proj_bot` | Telegram Chatbot | Small robot-head / speech-bubble figure (matches the card icon) |

### 2.4 Research desk props (deferred 2026-10-21, decide later)
| Asset | Paper | Spec |
|---|---|---|
| `asset_moireskin` | MoiréSkin | The round gel sensor puck (striped top, clear base), about 8 cm; sits on the desk, lights when the paper is in view |
| `asset_moirelens` | MoiréLens | Small camera on a tripod pointing at a striped card |

### 2.5 Finishing, every asset
- [ ] Bevel modifier (width ~1–2 cm, 2–3 segments, "Harden Normals"): done on the 7 new assets (§2.2); **not** on the 15 assets from the measured model (`build_existing` in `scripts/build_assets.py` only joins parts)
- [x] Materials renamed to roles (`frame`, `fabric`, `wood`, `metal`, `screen`, `glass`, `glow`, `accent`)
- [ ] Clay colors: the new assets use the clay palette; the measured-model assets keep their product colors in the `Color` vertex attribute (black chair, grey desk, black metal frames). Either recolor in Blender or override by role in `room.config.ts`
- [x] Origin bottom center, front −Y, scale applied
- [ ] Optional: per-asset baked AO (Claude writes the bake script)

### 2.6 Claude's side
- [x] Watch script: `bin/room-assets --watch`; save `room_assets.blend` → each `asset_*` exports to `public/room/assets/<name>.glb` + `manifest.json`
- [x] meshopt compression on export (`gltf-transform`, dev dependency): 3.36 MB → 0.77 MB
- [ ] CAD → GLB conversion for the project models (deferred with §2.3)
- [x] `room.config.ts` + loader (PLAN Phase 4)

## 3. Before publishing
- [ ] Privacy: the scene is built in code, so the public site shows only what the config places. Keep it stylized; no address or exact orientation (me)
- [x] Size check against the PLAN.md budget (all assets ≤ ~3 MB): 0.77 MB compressed (2026-10-21) (Claude)
