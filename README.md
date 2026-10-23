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
