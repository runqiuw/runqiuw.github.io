import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { readFile } from 'node:fs/promises';
import { parseBib, splitAuthors } from './lib/bib';

const projects = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      cover: image(),
      timeline: z.string(),
      tags: z.array(z.string()).default([]),
      category: z.enum(['work', 'fun']).default('work'),
      order: z.number(),
      featured: z.boolean().default(false),
      course: z.string().optional(),
      links: z.object({ github: z.url().optional(), website: z.url().optional() }).optional(),
      /** When set, the card links here and no detail page is built. */
      external: z.url().optional(),
    }),
});

const games = defineCollection({
  loader: file('src/content/games.yaml'),
  schema: ({ image }) =>
    z.object({
      order: z.number(),
      title: z.string(),
      summary: z.string(),
      authors: z.array(z.string()).optional(),
      built_with: z.string().optional(),
      cover: image(),
      play: z.url(),
      trailer: z.url().optional(),
      /** Short muted gameplay clip (mp4/webm under public/) played on the room's TV. */
      clip: z.string().optional(),
    }),
});

const news = defineCollection({
  loader: file('src/content/news.yaml'),
  schema: z.object({ date: z.string(), text: z.string() }),
});

const playground = defineCollection({
  loader: file('src/content/playground.yaml'),
  schema: ({ image }) =>
    z.object({
      order: z.number(),
      type: z.enum(['photo', 'post', 'toy', 'place']),
      title: z.string(),
      caption: z.string().optional(),
      image: image().optional(),
      href: z.string().optional(),
      soon: z.boolean().default(false),
    }),
});

const papers = defineCollection({
  loader: async () => {
    const src = await readFile('src/content/papers.bib', 'utf8');
    return parseBib(src).map(({ id, fields: f }) => ({
      id,
      title: f.title,
      authors: splitAuthors(f.author),
      equal: f.equal ? splitAuthors(f.equal) : [],
      venue: f.booktitle ?? f.journal ?? '',
      series: f.series ?? '',
      year: Number(f.year),
      month: f.month ? Number(f.month) : undefined,
      location: f.location ?? f.address,
      doi: f.doi,
      website: f.website,
      pdf: f.pdf,
      code: f.code,
      video: f.video,
      talk: f.talk,
      appendix: f.appendix,
      preview: f.preview,
      teaser: f.teaser,
      screen: f.screen,
      selected: f.selected === 'true',
    }));
  },
  schema: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    equal: z.array(z.string()),
    venue: z.string(),
    series: z.string(),
    year: z.number(),
    month: z.number().optional(),
    location: z.string().optional(),
    doi: z.string().optional(),
    website: z.string().optional(),
    pdf: z.string().optional(),
    code: z.string().optional(),
    video: z.string().optional(),
    talk: z.string().optional(),
    appendix: z.string().optional(),
    preview: z.string().optional(),
    /** Short muted demo clip (mp4/webm under public/) played on the room's monitor. */
    teaser: z.string().optional(),
    /** Image for the room's monitor when it should differ from `preview` (file in src/assets/img/papers/). */
    screen: z.string().optional(),
    selected: z.boolean(),
  }),
});

export const collections = { projects, games, news, playground, papers };
