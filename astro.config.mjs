// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://runqiuw.github.io',
  trailingSlash: 'ignore',
  // /playground is hidden for now (`show.playground` in src/data/profile.ts).
  integrations: [sitemap({ filter: (page) => !page.includes('/playground') })],
  // Keep links to the old al-folio site working.
  redirects: {
    '/games': '/#games',
    '/cv': '/assets/pdf/cv.pdf',
    '/publications': '/#research',
    '/projects/10_imu_localization': '/projects/imu-localization/',
    '/projects/5_robotics_vehicle': '/projects/robotics-vehicle/',
    '/projects/7_me250_robotic_arm': '/projects/robotic-arm/',
    '/projects/8_me350_transformable_rover': '/projects/transformable-rover/',
    '/projects/4_sketchgenie': 'https://github.com/runqiuw/SketchGenie',
    '/projects/6_telegram_chatbot': 'https://github.com/runqiuw/context_chatbot_telegram',
  },
});
