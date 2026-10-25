# Site plan

Personal academic homepage built with **Astro**, with a clay-style 3D model of my room beside the page. Launched on `main` 2026-10-21; the old al-folio site is kept in the tag `al-folio-final`.

## To do

### 1. Needs new material or bigger work
- [ ] Playground: more pins, ~10 photos / things (me), then pin → pinboard card highlight. The distance card also starts when the full-screen room opens, so the board has its map even if the page's Playground was never scrolled to. The section is back (2026-10-22) with one card: how far the visitor is from Madison, after joshwcomeau.com/about-josh. A MapLibre map (OpenFreeMap tiles, no key) pulls back from the visitor's pin and draws a dotted great-circle line to my avatar pin; the room's pinboard gets a still of it. Location: city-level IP lookup from the browser via get.geojs.io, else the time zone, else "Where I live and work." (`distance: true` in `playground.yaml`, code in `src/scripts/distance-map.ts`). The map (~440 KB gzip with its worker) loads only when the card nears the viewport

### 2. Deferred
- Remaining project models for the shelf: robotic arm and vehicle from CAD (STEP/STL → decimate → clay roles; fallback: model from photos)
- Telegram: replace the current robot with the blue figure from [Robot Cartoon Collection](https://sketchfab.com/3d-models/robot-cartoon-collection-1300eb8e684b42868bda89657cac1605) when the user has the source file; the listing currently offers no download.
- Travel map: a map poster on the wall → `/travel` (no content yet)
- Blog / notes (no content yet)
- Say hi character: a character (design TBD) standing in the room, e.g. by the door, with the contact camera shot aimed at it. When it exists: add the `contact` shot in `SHOTS`, a `Say hi` label anchored on the character, make the character clickable (it bounces like the other interactive objects), and turn `show.contact` on. Until then the Say hi section is hidden and the door is scenery
- Visitor map (deferred 2026-10-22): a Playground card with a world map of recent visitors, like many academic GitHub Pages sites. Preferred: a hosted service that runs the backend, pasted in as a `<script>` snippet: **MapMyVisitors** (mapmyvisitors.com; clicking the small map opens a public stats page with a bigger map and recent visitors) or **ClustrMaps** (clustrmaps.com). Caveats: their map style, not the clay look; visitors' IPs go to the third party and the recent-visitor list (city, browser, time) is public; the room's pinboard most likely can't draw their cross-origin image (canvas taint), so it would show a plain "Visitor map" note. Fallbacks if more control is wanted later: GoatCounter (no cookies, country/region only) + a daily GitHub Action that pulls the last 30 days and redraws the dots with the distance card's MapLibre map (check its API exports regions first); or a self-run Cloudflare Worker (city-level, real-time, most work). Live "who else is here now" presence (Spencer Chang's spencer.place) was set aside: with low traffic it nearly always shows only the visitor. To do it: sign up and add runqiuw.github.io (me), then send the snippet
- More room detail as new sections appear

### Not doing
- News section (2026-10-22): the code stays in `Intro.astro` with `SHOW_NEWS` off, but no plan to turn it on
- Course calendar page (old `assets/html/schedule.html`) (2026-10-22)
- Research desk props (2026-10-22): the monitors already play each paper's demo clip
- Room lights following Madison local time: day/night follows the theme switch, otherwise a light page gets a night room
- Mirror as a hotspot, and an About & CV section
- Design-tokens doc and a dev-only placement helper: style and layout are settled (proposed 2026-10-22)

## Decisions

| Topic | Decision |
|---|---|
| Hosting | Astro, GitHub Actions → GitHub Pages, same repo and URL |
| Page ↔ room | **The page says what it is; the room shows the thing itself.** The page is complete on its own (also the whole mobile site); the room never repeats it and shows what the page can't for the item in view. No captions or hints in the room panel |
| Clarity rule | Everything a professor needs (name, position, research, papers, CV, email) is readable without touching the room |
| Home layout | Desktop: room fixed on the left (~40–45%), page scrolls on the right. Mobile: list page plus an "Explore my room in 3D" card |
| Room behavior | Scroll: the section in view picks the object and camera shot, the item in the middle of the viewport picks what it shows. Hover/focus shows that item, never moves the camera. Click or "Enter my room" opens the full-screen room |
| Views (2026-10-22) | Three levels: page (`#`), full-screen room (`#room`), close-up (`#room/<id>`). Forward goes down one level: "Enter my room" or a click on the panel opens the room; in the room, a click on an object or its label opens its close-up, or goes to its page section if it has none yet. Back always goes up one level, and Esc, the Back buttons and the browser's back all do the same thing. A close-up with a page section has "<Section> on the page". Close-ups are config (`CLOSEUPS` in `room.config.ts`): `board` (drag pinboard cards; a click on a card leaves the room for that card on the page) and `hoops` (below). A close-up without a page section has no "on the page" button; its object is still clickable and labeled by the close-up id. `RoomPanel.astro` owns the levels and the history; `room.ts` only flies the camera (`focus`/`unfocus`/`visit`) and runs each close-up's interaction |
| Visual language | "Toy Room": clay shapes, Fredoka + Nunito, electric palette in light mode, "lights off" in dark mode (same switch as the room lights), spring motion, full-color photos |
| CV | PDF only, linked in the intro and nav; `/cv/` redirects to it |
| Games | Their own corner in the room; cards say what each game is |
| Name audio | Labeled as an AI voice |
| Hoops (2026-10-24) | Bin at plan (3, 0.15) m, 1.25 cm from the wall; the backboard target’s lower edge meets the rim. Compact 1.40 × 1.68 m court rug/collider, 1.32 m three-point arc; cart placement hidden. Paper → bottle → bouncy ball rotates automatically. Shuffled deck of 24 real throwing spots, ~0.59–3.55 m: close shots, both baselines, six bed positions, four extra deep threes and five explicit low/near-level cameras. Chair-side release moved clear of the chair. Static colliders include the floor, ceiling, walls, bed, rug, chair and major furniture; an outlined held model must not intersect furniture. The actual release remains at canvas (50%, 62%); shorten the camera dolly along its ray near walls, adapt shoulder offset/height, keep the rim inside portrait frames, and clear furniture with the eye. Held objects have one thin mint silhouette (~1.8 CSS px), expanded in clip space from welded/smoothed selection geometry. A stencil mask excludes the full interior, including transparent glass and cap/label seams; no separately enlarged parts, dark keyline, idle spin or post-processing. Release removes the highlight; resize updates its pixel-width viewport. Backboard tape uses opaque alpha cutout with alpha-to-coverage, and the rim writes depth for correct occlusion. Pull down for power (22% of canvas short side), sideways for direction; 52° elevation normally, 40–42° for the deepest shots to clear the ceiling. Up to 16 fading guide dots use matching cannon-es prediction, show the first 82% before contact, omit impact/bounce solutions. Keep the view during flight. A made basket or any non-backboard contact ends the attempt; floor/furniture/wall hits close scoring, while a rim rattle may still drop in during the result hold. Backboard hits must be within its real bounds, otherwise they are terminal wall hits. After the result, hold 1.4 s (full callout animation), then move for 650 ms and ready the next item. An 8 s flight watchdog handles invalid/stalled states, not normal round timing; old throws cannot score after a new round. Rim entries checked at every 1/120 s substep count once. +2 mint single ring/small burst; +3 gold/pink double ring/larger burst. Four random callout pools (2/3 × direct/bank), no immediate phrase repeat. Last 10 throws stay and sleep, with a 10 s post-launch fidget limit. Respect reduced motion. Lazy `room-hoops.ts` shares cannon-es with bed toys; Blender rug generator `bin/room_court_asset.py` stays in the normal export pipeline |

Not wanted: chat-style home page, room-only navigation, heavy real-time scenes.

Room links: recognize `#room` and configured `#room/<id>` on first load, reload and same-page hash navigation, including a cold mobile load. Replace the incoming entry with the page and rebuild page → room → close-up history; establish the overview camera before focusing. Back and Forward preserve the three levels, and choosing a section cannot pop into and reopen a stale close-up. Unknown close-ups leave the page visible.

### Section → object
| Section | Object | Room shows |
|---|---|---|
| Intro | room overview | — |
| Research | desk + two monitors | left: the paper's figure or `teaser` clip (bib field); right: title + venue |
| Projects | bookshelf, left-wall corner by the desk | Rover miniature, upright Meta Quest 3 headset for SketchGenie, a calibrated phone/watch/closed-case charging set for IMU, and a small robot for Telegram; framed covers for the other projects. Scroll selects a display; card hover/focus temporarily selects another without moving the camera. Two projects per tier in page order: IMU/Quest, vehicle/arm covers, Rover/robot. Quest and IMU keep 1:1 base scale; Quest has no controllers. All displays grow from the bottom with space reserved behind and above; direct room hover uses the same bounded animation |
| Games | TV on a stand, console, game cases, round rug, right of the desk | the TV plays the game in view (`clip` in games.yaml); its case lifts |
| Playground | pinboard wall | every pin |
| Contact | door (hidden for now) | — |

Layout B (2026-10-21): single bed with the nightstand beside it, shelf in the left-wall corner clear of both windows, floor lamp on the back wall between shelf and desk, game corner right of the desk, cart placement hidden to clear hoops (2026-10-24). No side table, glass table or mirror (a live Reflector mirror is in commit 6c0fef0). Layout A is in `layout-trials/`.

Clips: any resolution; trim to ≤ ~1 MB muted mp4 under `public/assets/video/`.

### Performance budget
- Text first: static HTML, LCP never waits for 3D. three.js loads on idle on desktop, on demand on mobile.
- No post-processing. Physics only for the toys on the bed (the pillow and the UMich M / UW W / SJTU gear plushes: pick up, throw, knock into each other) and the hoops game: cannon-es in its own chunk (~24 KB gzip), loaded when the full-screen room first opens, bodies sleep when settled. The hoops game has its own world: static floor, walls, bed and a ring of 14 boxes for the bin, fixed 1/120 s steps, stepping only while a throw is awake. Real-time light (hemisphere + one shadowed sun/moon + night lamps); per-asset baked AO only. Render on demand; stop when off-screen or the tab is hidden.
- Light only comes in through the windows: walls (also the ones hidden in the dollhouse view), a permanent shadow-only ceiling seal and closed blinds cast shadows, so sun patches show only with a blind up. The floor lamp, bedside lamp and the two monitor light bars cast shadows too; the light bars follow the theme, no switch (2026-10-22). The shelf has a warm LED strip under every board: a line light written into the shelf's and walls' shaders (RectAreaLight would cost ~110 KB), so it lights each tier as an even band; on at night like the light bars.
- Wall cutaways apply to the page/outside overview. In a full-screen interior view (eye inside the L-shaped footprint and below the ceiling), keep every wall, corner post and wall-mounted object visible, plus a lit L-shaped ceiling underside at the physical 2.7 m height. Its permanent shadow seal is unchanged; the visible liner does not receive the seal’s self-shadow. The outside overview stays open-topped. Direction-based cutaways can otherwise expose the page background as black vertical bands beside the doors in wide/night views.
- Screen clips play in the page panel, redraw on decoded video frames (30 fps fallback), and pause in the full-screen room and every close-up. They resume on return to the page; hidden/off-screen panels also pause decoding. A paused clip alone must not keep the room rendering.
- All 3D assets ≤ ~3 MB (meshopt), room JS ≤ 200 KB gzip. Poster image fallback without WebGL or with reduced motion.
- Lighthouse home page: Performance ≥ 90 desktop / ≥ 80 mobile, Accessibility ≥ 95.

## 3D assets

**Blender builds the assets; three.js assembles the scene.** Blender: each asset's shape and materials. Code (`src/scripts/room.config.ts`): room shell (413 × 370 × 270 cm), placement, colors by role, camera shots, labels, lights. Moving, recoloring or adding a section never needs an export.

- Library: a local `bedroom/` folder outside the repo (path in `bin/.room-assets-path`, not committed), with its own README. `room_assets.blend` holds one `asset_<name>` collection per asset; `source/` is the measured model, never edited in place.
- Export: `bin/room-assets` once, or `--watch` to re-export on every save → `public/room/assets/<name>.glb` + `manifest.json`.
- Shelf models: `asset_rover` is the simplified `all_2` CAD assembly, kept in the library. `bin/room_model_assets.py --source <review.blend> --out <assets-dir> --assets rover` runs inside Blender to append/update the reviewed collection and export only the requested assets; meshopt-compress its GLB and update manifest bytes afterwards. `PROJECT_MODELS` maps page project ids to shelf assets; missing models fall back to covers. `asset_quest3` contains only the upright headset, without controllers; `asset_imu_devices` uses a CC BY phone plus original simplified watch, closed earphone case and flat 240 × 90 × 10 mm charging pad. Device bodies use Apple dimensions, with measured dimensions and sources in manifest `calibration`; the complete group scales uniformly. IMU and Quest stay at 1:1 in the room (`lifeSize`), in the original two-projects-per-tier layout. Do not rearrange the shelf to fit a model without an explicit request; Quest controllers were removed to fit its existing slot. Quest housing dimension references are stored in its own `calibration`. `asset_chatbot_robot` is a static, shortened, arms-down figurine adapted from the CC BY S-Bot model. Attribution and changes are in `public/room/assets/CREDITS.txt`, linked from the footer. Device envelopes are stored in manifest `components`; Quest pose is recorded in `layout`. Only miniatures fit down to their slots. Life-size devices never shrink to fit: their hover moves forward as they grow, keeping the back edge clear of the backboard. The shelf front is open; overhang into free space is allowed. Regression checks actual triangles against the shelf and nearby scene meshes.
- After layout or lighting changes: `bin/room-posters` (needs the preview server on :4321), then rebuild; `bin/room-og.mjs` for `public/og.png`.

### Asset rules
- One collection per asset, `asset_<name>`; repeated items are one asset placed several times.
- Real scale (1 unit = 1 m), origin at the bottom center on the floor (wall-mounted: back-face bottom center), front faces −Y.
- Materials are roles: `frame`, `fabric`, `wood`, `metal`, `screen`, `glass`, `glow`, `accent`. Colors live in the `Color` vertex attribute; the config can recolor a role per placement.
- Surfaces that show page content get a flat plane with 0–1 UVs: `screen` (monitor, TV, 16:9), `cover` (game case), `board` (pinboard).
- Keep it light: no tiny details, bevel instead of subdividing.
- Bed: `bed_single` is placed; the queen `bed` is kept for later.
