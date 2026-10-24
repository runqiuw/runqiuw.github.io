# runqiuw.github.io

Personal academic homepage of Runqiu Wang, built with [Astro](https://astro.build) and deployed to GitHub Pages.

## Develop

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static site in dist/
npm run check    # type-check .astro / .ts files
```

After building, start `npm run preview` and run `npm run check:room` to check panel video playback,
idle WebGL rendering and the three hoops projectiles in headless Chrome with SwiftShader.
Set `URL` for a different preview port and `CHROME` for a different Chrome executable;
`VIDEO_FALLBACK=1` also checks the 30 fps path used without video-frame callbacks.
`npm run check:hoops` checks actual projectile physics, scoring, automatic rounds and idle behavior
without a browser. Hoops rotates the three projectiles across 24 shuffled close, baseline, bed and distant throwing spots;
the rug's arc separates two- and three-point shots.
The neon-outlined release stays centered in the frame. A basket or non-backboard contact ends the shot;
the result stays for 1.4 s before a 650 ms move to the next angle. Low and near-level views are included.
Pull down to set power (22% of the canvas short side for full power) and left/right to steer. The fading arc uses the same physics as the throw,
ending before the first impact rather than revealing the final landing point.

## Where things live

| What | Where |
|---|---|
| Intro, education, links | `src/data/profile.ts` |
| Publications | `src/content/papers.bib` (extra fields: `website`, `pdf`, `code`, `video`, `talk`, `appendix`, `preview`, `equal`) |
| Projects | `src/content/projects/*.md` (`external:` makes the card link out instead of building a page) |
| Games | `src/content/games.yaml` |
| Playground wall | `src/content/playground.yaml` |
| News | `src/content/news.yaml` |
| Images (optimized at build) | `src/assets/img/` |
| Files served as-is (CV PDF, audio, video, GIFs) | `public/assets/` |
| Redesign plan and notes | `redesign/` |
| Room layout, shots, lights, close-ups | `src/scripts/room.config.ts` |
| Room rendering and video playback | `src/scripts/room.ts` |
| Bed toys / hoops physics | `src/scripts/room-physics.ts`, `src/scripts/room-hoops.ts` |

## CV

`bin/sync-cv` compiles the Overleaf project, writes `public/assets/pdf/cv.pdf`, commits and pushes. The Overleaf project name goes in `.overleaf-cv-project` (git-ignored).
