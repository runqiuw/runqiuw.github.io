// Identity, intro copy and links. Gathered from the old about page and CV (see redesign/CONTENT.md).
import runqiu from '../assets/img/profile/runqiu.jpg';
import fun from '../assets/img/profile/fun.jpg';
import uw from '../assets/img/logos/uw-logo.png';
import umich from '../assets/img/logos/umich-logo.png';
import sjtu from '../assets/img/logos/sjtu-logo.png';

export const profile = {
  name: 'Runqiu Wang',
  firstName: 'Runqiu',
  pronunciation: 'Roon-chio',
  pronunciationAudio: '/assets/audio/runqiuw.m4a',
  role: 'PhD student · Computer Sciences · UW–Madison',
  location: 'Madison, Wisconsin',
  email: 'rwang837@wisc.edu',
  // Page description for search and link previews: the opening line of the intro.
  description: 'I’m Runqiu Wang, a first-year Ph.D. student in Computer Sciences at the University of Wisconsin–Madison.',
  photos: { main: runqiu, fun },
  links: {
    cv: '/assets/pdf/cv.pdf',
    scholar: 'https://scholar.google.com/citations?user=7S8WhZsAAAAJ',
    github: 'https://github.com/runqiuw',
    orcid: 'https://orcid.org/0009-0007-6650-9423',
    itch: 'https://runqiu.itch.io',
  },
  education: [
    { degree: 'Ph.D., Computer Sciences', school: 'University of Wisconsin–Madison', years: '2026 – now', logo: uw, url: 'https://www.cs.wisc.edu/' },
    { degree: 'B.S.E., Computer Science', school: 'University of Michigan', years: '2024 – 2026', logo: umich, url: 'https://cse.engin.umich.edu/' },
    { degree: 'B.S., Mechanical Engineering', school: 'Shanghai Jiao Tong University', years: '2022 – 2026', logo: sjtu, url: 'https://gc.sjtu.edu.cn/' },
  ],
};

/** Sections that can be switched off while they have no real content (page, nav, room and sitemap follow). */
export const show = {
  /** Playground: only two "coming soon" notes so far. Also update the sitemap filter in astro.config.mjs. */
  playground: false,
  /** Say hi: hidden for now (the email is in the intro links); the room's door is scenery. */
  contact: false,
};
