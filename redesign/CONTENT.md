# Content inventory

What the live site (runqiuw.github.io, checked 2026-10-07) actually shows, where each piece comes from, and what the new site keeps. Text is gathered into [`content/`](content/); binary assets stay where they are until the Astro migration copies them (see the asset list below).

## 1. Visible content (keep)

### Home `/`
| Item | Source | Gathered into |
|---|---|---|
| Name, "CS@UW–Madison" subtitle, location, email | `_config.yml`, `_pages/about.md` | `content/profile.yaml` |
| Name-pronunciation button (plays audio) | `_layouts/about.liquid`, `assets/audio/runqiuw.m4a` | `profile.yaml → name.pronunciation_audio` |
| Portrait + hover swap to the "fun" photo | `assets/img/profile/runqiu.JPEG`, `fun.jpg` | `profile.yaml → photos` |
| Bio (3 paragraphs) | `_pages/about.md` | `profile.yaml → bio` (verbatim) |
| Publications (3, all `selected`) | `_bibliography/papers.bib` | `content/papers.bib` (updated with official project pages, see below) |
| Featured projects (first 3 by importance: IMU, SketchGenie, Robotics Vehicle) | `_projects/` | `featured: true` in `content/projects/*.md` |
| Social icons: email, GitHub, Google Scholar | `_data/socials.yml` | `profile.yaml → links` |

### Publications
Both Moiré papers now have official lab pages, which become the main link on each entry:

| Paper | Venue | Links gathered |
|---|---|---|
| MoiréLens (co-first author) | SenSys ’26 | [project page](https://ambient-intelligence-lab-umich-eecs.github.io/MoireLens-Page/), ACM paper, appendix PDF, code ([MoireLens-Code](https://github.com/Ambient-Intelligence-Lab-UMich-EECS/MoireLens-Code)), video |
| MoiréSkin | MobiCom ’26, Austin TX | [project page](https://ambient-intelligence-lab-umich-eecs.github.io/MoireSkin-Page/), paper PDF, DOI 10.1145/3795866.3844463 (new), interactive talk; code "forthcoming" |
| MP-Former | IDETC-CIE 2025, Anaheim | PDF (local), DOI |

The MoiréSkin page also lists my ORCID (0009-0007-6650-9423), added to `profile.yaml → links.orcid`.

### Projects `/projects/` (6 listed)
| Project | Category | Detail page | Gathered into |
|---|---|---|---|
| IMU On-Body Localization | work | yes | `projects/imu-localization.md` |
| SketchGenie | work | card links to GitHub | `projects/sketchgenie.md` |
| Bluetooth-Controlled Robotics Vehicle | work | yes | `projects/robotics-vehicle.md` |
| Robotic Arm with Flexible Grippers (ME250) | work | yes | `projects/robotic-arm.md` |
| Transformable Rover (ME350) | work | yes (GIFs + 2 videos) | `projects/transformable-rover.md` |
| Telegram Chatbot with Message Summarization | fun | card links to GitHub | `projects/telegram-chatbot.md` |

Project bodies were converted from Liquid/Bootstrap markup to plain Markdown (images as `![title](/path)`, videos as `<video>`). The text is unchanged.

### Games `/games/` (3)
Bargain Brawl (with YouTube trailer), The Legend of Zelda (Unity Remaster), Timebreaker → `content/games.yaml`. One grammar fix: "players take turns to checked out" became "to check out".

### CV `/cv/`
- HTML CV rendered from `assets/json/resume.json`. Despite the file name, `_data/cv.yml` (Einstein sample) is **not** used. → `content/cv.json` (cleaned; location updated from Ann Arbor to Madison). **The new site drops the HTML CV** (decided 2026-10-07); `cv.json` is kept only as the source for the education lines in the intro.
- PDF `assets/pdf/cv.pdf`, kept up to date by `bin/sync-cv` (Overleaf → commit → push). **Keep this workflow.**

## 2. Not carried over (decided 2026-10-07)

Nothing that was invisible on the old site goes online.

| Item | Decision |
|---|---|
| Course calendar `assets/html/schedule.html` | Not part of this redesign; it stays in the old repo history and may come back later |
| Old MoiréLens project page (`published: false`) | Dropped. MoiréLens is a **publication** with its own official page (see §1 Publications) |
| DreamMotion, This Emoji Does Not Exist (Yet), Network Simulation, Data-Driven Optimization (`published: false` / `hidden`) | Not going online |
| `resume.json` commented-out sections (volunteer, interests) | Not carried over |

## 3. New content drafted for the redesign (confirm)
- `content/news.yaml`: 5 news items built from facts already on the site (the old news section was disabled sample text).
- `profile.yaml → one_liner_draft`: short tagline used in the prototypes.

## 4. Assets to carry over

| Path | Used by |
|---|---|
| `assets/img/profile/runqiu.JPEG`, `fun.jpg`, `icon.jpg` | home, favicon |
| `assets/audio/runqiuw.m4a` | name pronunciation |
| `assets/img/publication_preview/moirelens-logo.png`, `MoireSkin.png`, `mp-logo.png` | publication thumbnails |
| `assets/pdf/cv.pdf`, `MP_former_DETC2025-169215.pdf`, `emoji-generation-poster.pdf` | CV, paper PDF, emoji poster |
| `assets/img/projects/*` (all 18 files) | project covers and galleries |
| `assets/video/350-explosive.mp4`, `demo-climb.mp4` | Transformable Rover |
| `assets/portforlio/*.png` (3) | game covers (fix the folder name typo when moving: `portfolio`) |
| `assets/img/logos/*` (UW, UMich, SJTU, AMI) | HTML CV |
| Blender room: `卧室硬装.blend` (local, outside the repo) | 3D room (not in repo) |

## 5. Template junk (drop with the Jekyll site)

Everything else in the repo comes from al-folio and is not carried over, including:
- The old MoiréLens project page `_projects/0_moirelens.md` and the other unlisted projects (§2).
- Sample pages: `_pages/{about_einstein, blog, books, dropdown, misc, news, profiles, publications, repositories, teaching}.md` (only `publications` rendered anything, and it was empty and unlinked).
- 31 sample posts in `_posts/`, 3 sample `_news/`, `_books/`, `_data/{cv.yml, coauthors.yml, repositories.yml, venues.yml}`.
- Sample assets: `assets/img/gallery/*`, `book_covers/`, `posts/`, `profile/prof_pic*.{jpg,png}`, `publication_preview/{brownian-motion,wave-mechanics}.gif`, `assets/html/relativity.html`, `assets/json/table_data.json`, `assets/pdf/example_pdf.pdf`, `assets/audio/epicaly-short-113909.mp3`, `assets/video/{pexels-*,tutorial_al_folio}.mp4` (25 MB), `assets/jupyter`, `assets/plotly`, `assets/bibliography`.
- Theme and tooling: `_layouts`, `_includes`, `_sass`, `_plugins`, `_scripts`, `Gemfile*`, `Dockerfile`, `docker-compose*`, `purgecss.config.js`, `lighthouse_results`, `readme_preview`, `CONTRIBUTING.md`, `CUSTOMIZE.md`, `FAQ.md`, `INSTALL.md`, and the al-folio GitHub workflows (keep only a new deploy workflow).

## 6. Problems found on the live site
- **`robots.txt` disallowed all crawlers**, so Google couldn't index the site. Changed to `Allow: /` in the working tree, intentionally uncommitted; it ships with the new site.
- MoiréLens project text said "under review". The page is dropped (see §2).
- HTML CV location still says Ann Arbor (fixed in `cv.json`).
- MobiCom ’26 shows "May 2026" on the old site, but neither the old bib nor the official BibTeX has a month. Confirm the date for the news item.
- Footer still says "Photos from Unsplash".
