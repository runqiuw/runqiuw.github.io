# runqiuw.github.io

Personal academic homepage of Runqiu Wang, built with [Astro](https://astro.build) and deployed to GitHub Pages.

## Develop

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static site in dist/
npm run check    # type-check .astro / .ts files
```

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

## CV

`bin/sync-cv` compiles the Overleaf project, writes `public/assets/pdf/cv.pdf`, commits and pushes. The Overleaf project name goes in `.overleaf-cv-project` (git-ignored).
