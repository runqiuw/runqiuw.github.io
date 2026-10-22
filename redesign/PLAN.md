# Site redesign plan

Rebuild runqiuw.github.io from the al-folio Jekyll template into a custom **Astro** site. It should read as a clear academic homepage first. Alongside the page sits a clay-style 3D model of my room, which acts as a visual map of the site and as the home for playground content.

Status (2026-10-21): Phases 1–2 done, Phase 3 first pass done, Phase 4 mostly done on branch `astro-redesign`; the room is built from the Blender assets via `src/scripts/room.config.ts`. Content now lives in `src/content/` and `src/data/` (see README).

## Decisions so far

| Topic | Decision |
|---|---|
| Framework | Astro, deployed with GitHub Actions to the **same** GitHub Pages site (this repo, `runqiuw.github.io`) |
| 3D pipeline (decided 2026-10-08) | **Blender builds the 3D assets; three.js assembles the scene.** Blender: the shape and materials of each piece of furniture, exported as separate assets that rarely change. Code (`room.config.ts`): room shell, where every asset sits and faces, color overrides, pinboard, camera shots, hotspots and labels. Moving furniture, changing colors or cameras, and adding sections never needs an export. Changing an asset's shape re-exports automatically (watch script) |
| Visual language | "Toy Room": clay/soft-3D shapes, Fredoka (headings) + Nunito (body), electric palette in light mode, "lights off" night palette in dark mode, bouncy spring motion, full-color photos (never greyed out) |
| Home layout (desktop) | Split view: 3D room fixed on the left (~40–45%), normal academic page scrolling on the right |
| Page ↔ room roles (decided 2026-10-10) | **The page says what it is; the room shows the thing itself.** The right column is complete on its own (text, citations, links; also the whole mobile site). The room never repeats the page: it shows what the page can't, always for the item currently in view: demo clips, physical objects, the full pinboard, live status. No captions or hints in the panel ("Desk · Research" was removed) |
| Room behavior | **Scroll** drives two levels. The section in view picks the object and camera shot; the item (paper, project, game…) in the middle of the viewport picks what that object shows, and the camera stays put while items change. **Hover/focus** on an item shows that item until the pointer leaves; hover never moves the camera. **Click** on the room (or the "Enter my room" button) opens full-screen 3D navigation |
| Mobile | No split view. Plain list page plus an "Explore my room in 3D" entry that opens the full-screen room |
| Clarity rule | Everything a professor needs (name, position, research, papers, CV, email) is readable without touching the room |
| Dark mode | Same switch as the room lights ("Lights off") |
| Playground | A pinboard wall in the room, generated from content data. Andre Souza-style "things I like pinned to a wall" |
| Games | Their own area in the room (a game corner), so it's obvious at a glance that this part is about games. Cards say what each game is; no "what I did" notes |
| Name audio | The pronunciation button is labeled as an AI voice |
| CV | **PDF only.** No HTML CV page and no CV section: publications, projects and education already appear elsewhere. The CV PDF is a link in the intro and the nav |

Not wanted: chat-style home page, room-only navigation (Maxime-style), heavy real-time scenes (Bruno Simon's car demo was too slow).

### Section → object map (v2)
| Section | Object | Page (complete) | Room adds (only here) |
|---|---|---|---|
| Intro | room overview | photo (with the hover swap), the old bio (education lives in its text), links incl. CV PDF. News is in the code but hidden (`SHOW_NEWS` in Intro.astro) | later: lights follow Madison local time; the monitor shows what I'm working on now |
| Research & Publications | desk + monitors | title (links to the official project page), authors, venue, links, small still thumbnail | left monitor: the paper's figure, or its `teaser` clip (bib field); right monitor: title + venue. Later: pinboard notes as research themes, the current paper's note lit |
| Projects | bookshelf on the left wall, where the side table was | cards | now: each project's cover in a frame on the shelf, the one in view tips forward. Later (deferred): hardware projects as small models |
| Games | game corner right of the desk: TV on a stand, console, game cases, round rug | cards with a still cover | the TV shows the game in view (cover now; `clip` field in games.yaml plays gameplay); its case lifts |
| Playground | pinboard wall | a few picks | every pin, on the wall |
| Contact | door (no camera shot for now: the turn to the door was too big a jump; the camera stays on Playground) | email, links | later: "Madison, N miles from you" on the door |

Dropped: the mirror as a hotspot (the photo-in-mirror effect didn't work; the photo lives in the intro) and the About & CV section.

### Prototypes and references
- Room + page prototype (private Claude artifact)
- Design languages v2 (Toy Room / Sticker Book / Soft Pop + layouts + references) (private Claude artifact)
- Style lab (private Claude artifact)
- References: sooahs-room-folio.com (room diorama), my-room-in-3d.vercel.app (baked day/night light mix), henryheffernan.com (zoom into the monitor), andregs.com (pinned wall), joshwcomeau.com (spring motion, "miles away from you" greeting), seanhalpin.xyz (soft 2D UI)

### Lessons from the prototype
1. "Paper on the monitor" is the strongest moment, and the mirror showing my photo works too. Keep page→object links that change object *content*.
2. The cart close-up is empty and low contrast.
3. The chair blocks the desk in close-ups.
4. All hotspots sit on one side of the room, so labels bunch together in 3D mode. Spread the objects out.
5. The entry partition wall blocks part of the cart in the main view. Remove it.
6. The bed takes up a lot of floor. It may be removed or replaced (for example by the game corner).
7. The left panel is portrait while the room is landscape, which leaves empty space in the overview.
8. Close-ups expose the low detail. A Bevel modifier (rounded edges) gives a big clay improvement for little effort.
9. The model is 1.85 MB today, which is fine. It will grow with bevels, new objects and baked lightmaps, so the budget below is for the finished room.
10. Camera shots are hard-coded in `room.ts`. Move them into `room.config.ts` (not Blender: see the 3D pipeline decision).

## Materials still needed
Everything the room needs that isn't in the repo yet. 3D assets are specified in [BLENDER_TODO.md](BLENDER_TODO.md) §2.

| What | For | Status / source | Who |
|---|---|---|---|
| MoiréSkin demo clip | Research monitor | Done: UMI gripper clip from the project page | — |
| MoiréLens demo clip, 5–10 s | Research monitor | Project page has no media files (carousel image is the template placeholder); only the YouTube video. Need the original mp4, or OK to cut from YouTube with `yt-dlp` | me |
| MP-Former animation | Research monitor | None exists; keeps the still figure. Optional | me |
| Bargain Brawl gameplay, 5–10 s | Game corner TV | YouTube trailer only (same question as MoiréLens) | me |
| Zelda + Timebreaker gameplay, 5–10 s each | Game corner TV | itch.io pages have one screenshot each; needs a screen recording | me |
| CAD of rover, robotic arm, vehicle (STEP/STL/SolidWorks) | Projects shelf | Deferred 2026-10-21 (decide later) | me |
| Playground items (~10 photos / things) | Pinboard | Only two "coming soon" notes; the section is hidden (`show.playground` in src/data/profile.ts) until there's real content | me |
| Blender assets | Whole room | BLENDER_TODO.md §2: §2.1–2.2 done; project models (§2.3) and desk props (§2.4) open | me |

Clips: any resolution; Claude trims to ≤ ~1 MB muted mp4 under `public/assets/video/`.

## Performance budget
- Text first: the page is static HTML. LCP must not wait for 3D.
- three.js + model load after first paint (`client:idle` on desktop) and only on demand on mobile.
- No physics, no post-processing. Because the layout lives in code, room-wide light baking is out: lighting is real-time (hemisphere + one shadow-casting sun, plus the night lamps) and only re-rendered on demand. Each asset can carry its own baked ambient occlusion, which stays valid wherever it's placed.
- Render on demand only: camera tween, hover change, orbit. Stop when the panel is off-screen or the tab is hidden.
- Whole 3D payload (all assets) ≤ ~3 MB, JS for the room ≤ 200 KB gzip. Run meshopt compression anyway: it's one export flag and usually cuts geometry size by 2–4×.
- Fallbacks: pre-rendered poster image when WebGL is unavailable, on low-power devices, or with `prefers-reduced-motion`.
- Lighthouse on the home page: Performance ≥ 90 on desktop, ≥ 80 on mobile; Accessibility ≥ 95.

## Phases and TODO

### Phase 0: Content and design sign-off
- [x] Gather all visible content into `redesign/content/` ([CONTENT.md](CONTENT.md))
- [x] Review gathered content: nothing that was invisible goes online; calendar deferred
- [x] MoiréLens and MoiréSkin link to their official project pages from the publication list (no project entries)
- [x] Unblock crawlers: `robots.txt` → `Allow: /` changed in the working tree, intentionally left uncommitted; it ships with the new site
- [x] News items confirmed (MP-Former: "published", not "presented"); intro one-liner = second paragraph of the old bio
- [x] MoiréSkin: MobiCom ’26 is Oct 26–30, 2026 in Austin (not May; May is SenSys). Bib month set to `oct`
- [x] CV: PDF only; education moves into the intro; no CV section or page
- [ ] Freeze design tokens (colors light/dark, type scale, radius, clay shadow, spring curves) in `docs/design-tokens.md`
- [x] Section list v2 (table above): intro / research / projects (object TBD) / games / playground / contact

### Phase 1: Blender assets
Asset rules and checklist in [BLENDER_TODO.md](BLENDER_TODO.md). Modeling by me; export/watch script and web import by Claude.
- [x] Export + watch script: `bin/room-assets [--watch]` exports every asset collection to `public/room/assets/` with `manifest.json`, meshopt-compressed (0.77 MB total)
- [x] First asset set from the existing model: bed, desk, monitor, chair, lamp, cart, side table, nightstand, mirror, door, window (+ glass table, desk lamp, keyboard, paper)
- [x] New assets: pinboard, game corner (tv, tvstand, console, beanbag, gamebox), projects bookshelf
- [ ] Clay look on assets: bevels and clay colors done on the new assets only; the 15 measured-model assets still need both (BLENDER_TODO §2.5); optional per-asset baked AO

### Phase 2: Astro skeleton
- [x] New Astro project on branch `astro-redesign` (worktree `.claude/worktrees/astro-redesign`, uncommitted); remove Jekyll/al-folio files (CONTENT.md §5) in the same branch
- [x] Content collections: `papers` (built from `papers.bib`), `projects`, `games`, `playground` (type: photo | post | toy | place), `news`
- [x] Pages: `/` (split home), `/projects/[slug]`, `/playground`, `404`; keep old URLs working: `/projects/` stays, `/games/` → `/#games`, `/cv/` → `cv.pdf`
- [x] Carry over assets: images → `src/assets/img/` (optimized to WebP at build), PDFs/audio/video/GIFs → `public/assets/` (old URLs unchanged)
- [x] Port `bin/sync-cv` (it only writes `cv.pdf`, so it should work as-is with the new path)
- [x] GitHub Actions deploy workflow for the same Pages site (switch Pages source to "GitHub Actions" at launch); replace all al-folio workflows
- [x] `robots.txt` allowing indexing + sitemap in the Astro build

### Phase 3: Page UI (no 3D yet)
- [x] Layout shell: nav, split grid, mobile single column, light/dark switch
- [x] Components (first pass): intro, news list, paper item (thumb, venue chip, authors with me in bold, equal-contribution mark, links: project page / PDF / code / video / talk), project card, game card, pinboard grid, compact education list (in the intro), contact
- [x] Name-pronunciation button with the existing audio
- [x] Project detail page template (gallery, video, links). SketchGenie and Telegram Chatbot have no detail page: their cards link straight to GitHub (`external:` in front matter)
- [~] Accessibility: keyboard focus, reduced motion, color contrast in both modes (basics in place; full audit skipped for launch, 2026-10-21)
- [x] Mobile nav (menu button + popover under 760 px)
- [x] Replace the temporary room posters (`src/assets/img/room/`) with stills rendered from the three.js scene: `bin/room-posters` (headless Chrome, needs the preview server on :4321). Rerun after layout or lighting changes, then rebuild
- [x] License: MIT for the code, all rights reserved for the content (LICENSE)

### Phase 4: Room component
- [x] Temporary live room on desktop (`src/scripts/room.ts`): prototype model, rough code-defined camera shots per section, day/night lights, render on demand. Mobile keeps the list only
- [x] `room.config.ts`: room shell (outline, walls, openings), asset placements with position / rotation / scale / color overrides, camera shot per section, labels, night lights, which objects show page content
- [x] Generic loader in `room.ts` that builds the scene from `room.config.ts` (prototype GLB removed)
- [ ] Dev-only placement helper: drag an asset or the camera in the browser, copy the numbers back into `room.config.ts`
- [x] Loader + poster fallback; init on idle (desktop) / on demand (mobile)
- [x] Scroll sync (IntersectionObserver → camera tween), render on demand
- [x] Item sync: `[data-item]` elements + `itemchange` event (scroll picks the item in the middle of the viewport; hover/focus overrides)
- [x] Research: monitors show the item in view (figure or `teaser` clip on the left, title + venue on the right); camera shot raised over the chair
- [ ] Teaser clips for papers: short muted mp4/webm (≤ ~1 MB each) in `public/assets/video/papers/`, set `teaser` in `papers.bib`
  - [x] MoiréSkin: UMI gripper + strawberry clip from the project page (`moireskin-gripper.mp4`, 8.7 s, 120 KB)
  - [ ] MoiréLens: the project page has no media files (its carousel image is the template placeholder); the only demo is the YouTube video. Needs the original mp4 or a cut from YouTube
  - [ ] MP-Former: no project page or video; keeps the still figure unless a trajectory animation exists
- [ ] Projects: hardware projects as objects; item in view lights up (shelf exists; project models deferred, BLENDER_TODO §2.3)
- [x] Games: TV shows the game in view (cover, or `clip` when set); game cases carry the covers. Gameplay clips still missing (see Materials)
- [x] Hover bounce on interactive objects in the full-screen room (spring with a little overshoot); hovering a label bounces its object
- [ ] Pin → pinboard card highlight
- [x] Full-screen room mode: orbit, labels (Research / Projects / Games / Playground), click label or object → back to that section; Esc, "Back to page" and the back button close it (`#room` in URL). Desktop: "Enter my room" button or click the room; mobile: "Explore my room in 3D" card (3D loads only then)
- [x] Smooth open/close of the full-screen room: the frame morphs between the panel (mobile: the "Explore my room" card, or the middle of the screen) and the window while the camera moves on the same ease-out curve; 560 ms open, 460 ms close; off with reduced motion
- [x] Dynamic textures from content (monitors, TV, game cases, project frames, pinboard cards from `playground.yaml`)
- [x] Day/night cross-fade tied to the theme switch
- [~] Performance pass against the budget; test on my laptop, phone, and Safari (skipped for launch, 2026-10-21)

### Phase 5: Launch
- [x] SEO: title = name, description = the intro's first line, Open Graph/Twitter cards with a room render (`public/og.png`, made by `bin/room-og.mjs`), Person JSON-LD on the home page
- [x] Content proofread (checked by me, 2026-10-21)
- [ ] Merge, deploy, check every old URL
- [ ] Archive the al-folio version in a tag (`al-folio-final`)

### Later
- [ ] Travel map (a map poster on the wall → `/travel`)
- [ ] "Madison, N miles from you" greeting (needs a client-side geo lookup; consider privacy)
- [ ] Blog / notes
- [ ] More room detail and objects as new sections appear
- [ ] Course calendar page (old `assets/html/schedule.html`), if needed again
- [ ] Visitor presence ideas (Spencer Chang's spencer.place)

## Open questions
- Layout (2026-10-21, layout B): single bed (`bed_single`; the queen `bed` asset is kept for a later idea), nightstand moved next to it, side table removed, bookshelf in the left-wall corner by the desk, clear of both windows (windows at their measured spots); floor lamp moved against the back wall between shelf and desk, game corner right of the desk with a round rug (the beanbag blocked the closet door), glass table removed, cart next to the entry door, mirror removed (a live three.js Reflector version stalled on its first render; it's in commit 6c0fef0). Layout A (game corner on the left wall, shelf right of the desk) is saved in `redesign/layout-trials/` with a comparison image.
