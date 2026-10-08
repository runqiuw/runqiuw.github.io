# Blender room TODO

Source file: the measured model `卧室硬装.blend` (kept locally, outside the repo). Work in a copy (for example `卧室_web.blend`) so the measured 1:1 model stays intact.

**Me** = layout and modeling. **Claude** = export script, checks, web import.

## 1. Layout
- [ ] **Remove the entry partition wall** that blocks the cart in the main view (me)
- [ ] **Bed**: remove it or replace it with something smaller. Its space can hold the game corner (me)
- [ ] **Game corner**: a clearly "games" area, e.g. TV + console + beanbag, an arcade cabinet, or a gaming desk. It needs one flat screen for showing game covers (me)
- [ ] **Projects object**: give the cart props (a robot arm, a rover, a Quest headset…) or swap it for a bookshelf with project items (me)
- [ ] **Pinboard wall** for Playground: a real cork board or pegboard (the prototype one was added in code). Leave room for ~6–9 cards (me)
- [ ] **Spread the hotspots** (desk, projects object, game corner, pinboard, door) around the room so labels don't bunch on one side (me)
- [ ] **Chair**: pull it out or angle it so it doesn't cover the desk in close-ups (me)
- [ ] **Mirror**: no longer a hotspot. Keep as decoration or remove (me)
- [ ] **Front walls**: cut to ~1.2 m high (dollhouse cutaway) or delete. The web view also hides walls facing the camera (me)
- [ ] Remove tiny details that don't read at web scale: outlets, screws, cable details (me)

## 2. Clay look
- [ ] Bevel modifier on furniture (width ~1–2 cm, 2–3 segments, "Harden Normals"). Biggest visual win for the effort (me)
- [ ] Flat clay materials using the site palette (base colors only, roughness ~0.8, no textures). Palette for reference: blue `#3d5afe`, coral `#ff6b5e`, mint `#1fbf93`, yellow `#ffc93c`, navy `#2b3170`, floor `#ffd2a0`, walls `#f4f2ff` (me; Claude can script this)
- [ ] Day lighting (soft sun through the window) and night lighting (desk lamp, monitors, game screen glowing) (me)
- [ ] Bake both lightings into lightmaps (second UV map, 1024–2048 px each) (me + Claude for the bake script)

## 3. Naming conventions (so the web code needs no hand-tuning)
| Prefix | Meaning | Examples |
|---|---|---|
| `hot_<section>` | clickable object; everything under it highlights together | `hot_research`, `hot_projects`, `hot_games`, `hot_playground`, `hot_contact` |
| `cam_<section>` | empty (or camera) placed where the close-up should look from, pointing at the object | `cam_intro`, `cam_research`, `cam_games`… |
| `screen_<name>` | flat plane with UVs whose texture the site replaces at runtime | `screen_monitor_left`, `screen_monitor_right`, `screen_game_tv` |
| `pin_<n>` | pinboard slots (empties or planes) | `pin_1` … `pin_9` |
| `label_<section>` | optional empty marking where the 3D-mode label floats | `label_games` |

Anything else is static decoration.

## 4. Export (Claude)
- [ ] Export script: apply modifiers, **bake parent transforms before removing the parent empties** (the prototype bug that put the mirror at the origin), join meshes per `hot_*` group, keep `cam_*` / `screen_*` / `pin_*` / `label_*` as nodes
- [ ] glTF/GLB with meshopt compression; no UVs except on `screen_*` and the lightmap UV
- [ ] Sanity check after export: every section has `hot_` + `cam_`; screen planes face into the room; nothing sits at the origin by accident
- [ ] Poster renders: day and night, from `cam_intro`, for first paint and the no-WebGL fallback

## 5. Before publishing
- [ ] Privacy pass: the public model shouldn't reveal the address or exact orientation (window direction, door positions are fine to stylize) (me)
- [ ] Size check against the budget in PLAN.md (whole 3D payload ≤ ~3 MB) (Claude)
