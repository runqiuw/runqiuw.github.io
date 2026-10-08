# Site redesign plan

Rebuild runqiuw.github.io from the al-folio Jekyll template into a custom **Astro** site. It should read as a clear academic homepage first. Alongside the page sits a clay-style 3D model of my room, which acts as a visual map of the site and as the home for playground content.

Status: Phase 2 done, Phase 3 first pass done on branch `astro-redesign`. Content now lives in `src/content/` and `src/data/` (see README).

## Decisions so far

| Topic | Decision |
|---|---|
| Framework | Astro, deployed with GitHub Actions to the **same** GitHub Pages site (this repo, `runqiuw.github.io`) |
| Visual language | "Toy Room": clay/soft-3D shapes, Fredoka (headings) + Nunito (body), electric palette in light mode, "lights off" night palette in dark mode, bouncy spring motion, full-color photos (never greyed out) |
| Home layout (desktop) | Split view: 3D room fixed on the left (~40–45%), normal academic page scrolling on the right |
| Room behavior | **Scroll** drives the camera: one section maps to one object and one camera shot. **Hover** only highlights the object, and hovering a paper changes what the monitor shows; hover never moves the camera. **Click** on the room (or the "Enter my room" button) opens full-screen 3D navigation |
| Mobile | No split view. Plain list page plus an "Explore my room in 3D" entry that opens the full-screen room |
| Clarity rule | Everything a professor needs (name, position, research, papers, CV, email) is readable without touching the room |
| Dark mode | Same switch as the room lights ("Lights off") |
| Playground | A pinboard wall in the room, generated from content data. Andre Souza-style "things I like pinned to a wall" |
| Games | Their own area in the room (a game corner), so it's obvious at a glance that this part is about games. Cards say what each game is; no "what I did" notes |
| Name audio | The pronunciation button is labeled as an AI voice |
| CV | **PDF only.** No HTML CV page and no CV section: publications, projects and education already appear elsewhere. The CV PDF is a link in the intro and the nav |

Not wanted: chat-style home page, room-only navigation (Maxime-style), heavy real-time scenes (Bruno Simon's car demo was too slow).

### Section → object map (v2)
| Section | Object | Notes |
|---|---|---|
| Intro | room overview | photo (with the hover swap), the old bio (education lives in its text), links incl. CV PDF. News is in the code but hidden (`SHOW_NEWS` in Intro.astro) |
| Research & Publications | desk + monitors | hovering a paper shows it on the screen; the paper title links to its official project page |
| Projects | **TBD**: cart with props, or a bookshelf | the current cart close-up is too empty |
| Games | **new game corner** | e.g. a TV/console or arcade setup; could take the bed's space |
| Playground | pinboard wall | photos, notes, travel map later; pins generated from content |
| Contact | door | |

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
10. Camera shots are hard-coded. Move them into Blender as camera empties.

## Performance budget
- Text first: the page is static HTML. LCP must not wait for 3D.
- three.js + model load after first paint (`client:idle` on desktop) and only on demand on mobile.
- No physics, no post-processing, no real-time shadows in production. Lighting is baked in Blender (day + night), and the switch cross-fades between them.
- Render on demand only: camera tween, hover change, orbit. Stop when the panel is off-screen or the tab is hidden.
- Whole 3D payload (model + lightmaps) ≤ ~3 MB, JS for the room ≤ 200 KB gzip. Run meshopt compression anyway: it's one export flag and usually cuts geometry size by 2–4×.
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

### Phase 1: Blender room
Detailed list in [BLENDER_TODO.md](BLENDER_TODO.md). Layout and modeling by me; export script, naming check and web import by Claude.
- [ ] Layout pass (game corner, projects object, bed, partition wall)
- [ ] Clay look pass (bevels, materials, lighting bake)
- [ ] Export pipeline + poster renders

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
- [ ] Accessibility: keyboard focus, reduced motion, color contrast in both modes (basics in place; needs an audit)
- [x] Mobile nav (menu button + popover under 760 px)
- [ ] Replace the temporary room posters (`src/assets/img/room/`, rendered from the prototype) with Blender renders
- [ ] Pick a license for the repo (the al-folio MIT license was removed with the template)

### Phase 4: Room component
- [x] Temporary live room on desktop (`src/scripts/room.ts`): prototype model, rough code-defined camera shots per section, day/night lights, render on demand. Mobile keeps the list only
- [ ] `room.config.ts`: section → hotspot object → camera empty → label
- [ ] Loader + poster fallback; init on idle (desktop) / on demand (mobile)
- [ ] Scroll sync (IntersectionObserver → camera tween), render on demand
- [ ] Hover links: highlight object; paper → monitor texture; game → game corner (e.g. its screen shows the game); pin → pinboard card
- [x] Full-screen room mode: orbit, labels (Research / Projects / Games / Playground), click label or object → back to that section; Esc, "Back to page" and the back button close it (`#room` in URL). Desktop: "Enter my room" button or click the room; mobile: "Explore my room in 3D" card (3D loads only then)
- [ ] Dynamic textures from content (monitor default screen, pinboard cards)
- [ ] Day/night cross-fade tied to the theme switch
- [ ] Performance pass against the budget; test on my laptop, phone, and Safari

### Phase 5: Launch
- [ ] SEO: titles, descriptions, Open Graph image (room render), Scholar-friendly metadata
- [ ] Content proofread
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
- Projects object: improve the cart, or add a bookshelf?
- Game corner: what goes there (TV + console, arcade cabinet, gaming desk)? Does it replace the bed?
