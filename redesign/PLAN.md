# Site plan

Personal academic homepage built with **Astro**, with a clay-style 3D model of my room beside the page. Launched on `main` 2026-10-21; the old al-folio site is kept in the tag `al-folio-final`.

## To do

### 1. Needs new material or bigger work
- [ ] Playground: more pins, ~10 photos / things (me), then pin → pinboard card highlight. The section is back (2026-10-22) with one card: how far the visitor is from Madison, after joshwcomeau.com/about-josh. A MapLibre map (OpenFreeMap tiles, no key) pulls back from the visitor's pin and draws a dotted great-circle line to my avatar pin; the room's pinboard gets a still of it. Location: city-level IP lookup from the browser via get.geojs.io, else the time zone, else "Where I live and work." (`distance: true` in `playground.yaml`, code in `src/scripts/distance-map.ts`). The map (~440 KB gzip with its worker) loads only when the card nears the viewport

### 2. Deferred
- Project models for the shelf (deferred 2026-10-21). Toy-sized figurines that fit a 30 cm tier; the item in view lights up. Rover, robotic arm, vehicle from CAD (STEP/STL → decimate → clay roles; fallback: model from photos); IMU = phone + watch + earbuds; SketchGenie = AR headset; Telegram Chatbot = robot head / speech bubble
- Bed pillows (deferred 2026-10-22): three pillows printed with the school logos (SJTU-UM Joint Institute, UMich, UW-Madison). Mascot plush toys were tried as concept renders and dropped: not feasible within the asset budget
- Travel map: a map poster on the wall → `/travel` (no content yet)
- Blog / notes (no content yet)
- Say hi character: a character (design TBD) standing in the room, e.g. by the door, with the contact camera shot aimed at it. When it exists: add the `contact` shot in `SHOTS`, a `Say hi` label anchored on the character, make the character clickable (it bounces like the other interactive objects), and turn `show.contact` on. Until then the Say hi section is hidden and the door is scenery
- Visitor presence ideas (Spencer Chang's spencer.place); more room detail as new sections appear

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
| Visual language | "Toy Room": clay shapes, Fredoka + Nunito, electric palette in light mode, "lights off" in dark mode (same switch as the room lights), spring motion, full-color photos |
| CV | PDF only, linked in the intro and nav; `/cv/` redirects to it |
| Games | Their own corner in the room; cards say what each game is |
| Name audio | Labeled as an AI voice |

Not wanted: chat-style home page, room-only navigation, heavy real-time scenes.

### Section → object
| Section | Object | Room shows |
|---|---|---|
| Intro | room overview | — |
| Research | desk + two monitors | left: the paper's figure or `teaser` clip (bib field); right: title + venue |
| Projects | bookshelf, left-wall corner by the desk | each project's cover in a frame; the one in view tips forward |
| Games | TV on a stand, console, game cases, round rug, right of the desk | the TV plays the game in view (`clip` in games.yaml); its case lifts |
| Playground | pinboard wall | every pin |
| Contact | door (hidden for now) | — |

Layout B (2026-10-21): single bed with the nightstand beside it, shelf in the left-wall corner clear of both windows, floor lamp on the back wall between shelf and desk, game corner right of the desk, cart by the entry door. No side table, glass table or mirror (a live Reflector mirror is in commit 6c0fef0). Layout A is in `layout-trials/`.

Clips: any resolution; trim to ≤ ~1 MB muted mp4 under `public/assets/video/`.

### Performance budget
- Text first: static HTML, LCP never waits for 3D. three.js loads on idle on desktop, on demand on mobile.
- No physics or post-processing. Real-time light (hemisphere + one shadowed sun/moon + night lamps); per-asset baked AO only. Render on demand; stop when off-screen or the tab is hidden.
- Light only comes in through the windows: walls (also the ones hidden in the dollhouse view), a shadow-only ceiling and closed blinds cast shadows, so sun patches show only with a blind up. The floor lamp, bedside lamp and the two monitor light bars cast shadows too; the light bars follow the theme, no switch (2026-10-22).
- All 3D assets ≤ ~3 MB (now 0.77 MB, meshopt), room JS ≤ 200 KB gzip. Poster image fallback without WebGL or with reduced motion.
- Lighthouse home page: Performance ≥ 90 desktop / ≥ 80 mobile, Accessibility ≥ 95.

## 3D assets

**Blender builds the assets; three.js assembles the scene.** Blender: each asset's shape and materials. Code (`src/scripts/room.config.ts`): room shell (413 × 370 × 270 cm), placement, colors by role, camera shots, labels, lights. Moving, recoloring or adding a section never needs an export.

- Library: a local `bedroom/` folder outside the repo (path in `bin/.room-assets-path`, not committed), with its own README. `room_assets.blend` holds one `asset_<name>` collection per asset; `source/` is the measured model, never edited in place.
- Export: `bin/room-assets` once, or `--watch` to re-export on every save → `public/room/assets/<name>.glb` + `manifest.json`.
- After layout or lighting changes: `bin/room-posters` (needs the preview server on :4321), then rebuild; `bin/room-og.mjs` for `public/og.png`.

### Asset rules
- One collection per asset, `asset_<name>`; repeated items are one asset placed several times.
- Real scale (1 unit = 1 m), origin at the bottom center on the floor (wall-mounted: back-face bottom center), front faces −Y.
- Materials are roles: `frame`, `fabric`, `wood`, `metal`, `screen`, `glass`, `glow`, `accent`. Colors live in the `Color` vertex attribute; the config can recolor a role per placement.
- Surfaces that show page content get a flat plane with 0–1 UVs: `screen` (monitor, TV, 16:9), `cover` (game case), `board` (pinboard).
- Keep it light: no tiny details, bevel instead of subdividing.
- Bed: `bed_single` is placed; the queen `bed` is kept for later.
