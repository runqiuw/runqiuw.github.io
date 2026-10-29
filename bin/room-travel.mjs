#!/usr/bin/env node
// The room's travel map, from src/data/travel.yaml:
//  - public/room/prints/travel-map.webp: the poster above the TV, a pastel Miller world map with one pin per place;
//  - public/room/travel/<id>-<n>.webp: each place's photos, resized to 640 px with metadata (EXIF/GPS) dropped,
//    or a generated stand-in for `placeholder` entries;
//  - public/room/travel/travel.json: pins (poster UV of each pin's head) and photo lists for room-travel.ts.
// Rerun after editing travel.yaml:  node bin/room-travel.mjs
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { feature } from 'topojson-client';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);
const places = parse(readFileSync(new URL('src/data/travel.yaml', root), 'utf8')) ?? [];
const land = feature(require('world-atlas/land-110m.json'), 'land');

// 3:2 like the 0.9 × 0.6 m poster it covers. Miller's projection fills that frame with the whole world.
const W = 1536, H = 1024, M = 34;
// A pin: head radius R centred PIN above its tip. Pins whose outlines (2R+gap wide, tip to head top
// tall) would touch are merged into one, so no two printed pins overlap.
const R = 15, PIN = 30, GAP = 4;
const r = Math.PI / 180;
const miller = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * Math.max(-89, Math.min(89, lat)) * r));
const top = miller(84), bottom = miller(-62);
const sx = (W - 2 * M) / 360, sy = (H - 2 * M) / (top - bottom);
const xy = ([lng, lat]) => [M + (lng + 180) * sx, M + (top - miller(lat)) * sy];

// Rings crossing the antimeridian (Chukotka, Fiji, Antarctica) are unwrapped so they don't streak
// across the map; any ring then reaching past ±180° is drawn again a world away, clipped by the frame.
const unwrap = (pts) => pts.reduce((out, [lng, lat]) => {
  const prev = out.at(-1);
  out.push([prev ? lng + Math.round((prev[0] - lng) / 360) * 360 : lng, lat]);
  return out;
}, []);
const ring = (pts, dx = 0) => 'M' + pts.map(([lng, lat]) => xy([lng + dx, lat]).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
const rings = land.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)).flat().map(unwrap);
const landPath = rings.map((pts) => {
  const lngs = pts.map((p) => p[0]);
  return [0, ...(Math.max(...lngs) > 180 ? [-360] : []), ...(Math.min(...lngs) < -180 ? [360] : [])].map((dx) => ring(pts, dx)).join('');
}).join('');

const grid = [];
for (let lng = -150; lng <= 150; lng += 30) grid.push(`M${xy([lng, 84]).join(',')}L${xy([lng, -62]).join(',')}`);
for (let lat = -60; lat <= 80; lat += 20) grid.push(`M${xy([-180, lat]).join(',')}L${xy([180, lat]).join(',')}`);

// Merge the closest overlapping pair until none overlap. A merged pin stands on its most central
// place (not an average position in the sea), and is checked again from there.
const clusters = places.map((p) => ({ members: [p], at: xy(p.lnglat) }));
const overlap = (a, b) => Math.abs(a.at[0] - b.at[0]) < 2 * R + GAP && Math.abs(a.at[1] - b.at[1]) < PIN + R + GAP;
for (;;) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
    const a = clusters[i], b = clusters[j], d = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
    if (overlap(a, b) && d < bestD) [best, bestD] = [[i, j], d];
  }
  if (!best) break;
  const [i, j] = best, members = [...clusters[i].members, ...clusters[j].members];
  const pts = members.map((m) => xy(m.lnglat)), c = [0, 1].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
  const centre = pts.reduce((b, p, k) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(pts[b][0] - c[0], pts[b][1] - c[1]) ? k : b), 0);
  // The most central place leads the list (it names the pin); the rest keep their file order.
  const lead = members[centre];
  clusters.splice(j, 1);
  clusters[i] = { members: [lead, ...members.filter((m) => m !== lead)], at: pts[centre] };
}

const pin = ({ at: [x, y] }) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <ellipse cx="0" cy="1" rx="8" ry="3" fill="#1d2148" opacity=".2"/>
    <path d="M0 0C0 0-${R}-${PIN * 0.6}-${R}-${PIN}a${R} ${R} 0 0 1 ${2 * R} 0C${R}-${PIN * 0.6} 0 0 0 0z" fill="#ff6b5e" stroke="#fff" stroke-width="3"/>
    <circle cx="0" cy="-${PIN}" r="${R * 0.4}" fill="#fff"/></g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#fffaf0"/>
  <clipPath id="sea"><rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" rx="18"/></clipPath>
  <g clip-path="url(#sea)">
    <rect width="${W}" height="${H}" fill="#bfe3f2"/>
    <path d="${grid.join('')}" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.5" fill="none"/>
    <path d="${landPath}" fill="#ffe2b8" stroke="#e7b98a" stroke-width="2" stroke-linejoin="round" fill-rule="evenodd"/>
  </g>
  ${clusters.map(pin).join('')}
  <rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" rx="18" fill="none" stroke="#1d2148" stroke-opacity=".12" stroke-width="3"/>
</svg>`;
writeFileSync(new URL('public/room/prints/travel-map.webp', root), await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer());

// A clearly marked stand-in photo: a soft landscape in the place's own hue, labelled "placeholder".
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const stand = (label, seed) => {
  const h = hue(label), w = 640, ht = 480, sun = 120 + (seed % 5) * 90;
  const esc = label.replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c]);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},70%,82%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},75%,90%)"/></linearGradient></defs>
    <rect width="${w}" height="${ht}" fill="url(#s)"/>
    <circle cx="${sun}" cy="150" r="54" fill="#fff7d6"/>
    <path d="M0 330 L130 220 L250 310 L380 190 L520 300 L640 240 V480 H0Z" fill="hsl(${(h + 180) % 360},35%,62%)"/>
    <path d="M0 380 Q160 330 320 380 T640 370 V480 H0Z" fill="hsl(${(h + 200) % 360},40%,48%)"/>
    <rect x="${w / 2 - 190}" y="${ht / 2 - 52}" width="380" height="104" rx="22" fill="#ffffff" opacity=".82"/>
    <text x="${w / 2}" y="${ht / 2 - 6}" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" text-anchor="middle" fill="#1d2148">${esc}</text>
    <text x="${w / 2}" y="${ht / 2 + 32}" font-family="Helvetica, Arial, sans-serif" font-size="24" text-anchor="middle" fill="#5c628c">placeholder</text>
  </svg>`);
};

const out = new URL('public/room/travel/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const pins = [];
for (const { members, at: [x, y] } of clusters) {
  const photos = [];
  for (const p of members) {
    for (const [i, ph] of (p.photos ?? []).entries()) {
      const name = `${p.id}-${i + 1}.webp`;
      const input = ph.placeholder ? stand(ph.placeholder, i) : new URL(ph.src, root).pathname;
      // `rotate()` applies the camera orientation; sharp writes no EXIF/GPS unless asked to.
      const img = sharp(input).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true });
      const info = await img.webp({ quality: 82 }).toFile(new URL(name, out).pathname);
      const note = ph.placeholder ? 'placeholder' : ph.caption ?? '';
      photos.push({ src: `/room/travel/${name}`, w: info.width, h: info.height, place: p.place, note: [note, p.when].filter(Boolean).join(' · ') });
    }
  }
  const names = members.map((m) => m.place);
  const place = names.length <= 3 ? names.join(' · ') : `${names[0]} and ${names.length - 1} more`;
  // UV of the pin's head (glTF UVs, v down like the image).
  pins.push({ id: members[0].id, place, uv: [+(x / W).toFixed(4), +((y - PIN) / H).toFixed(4)], photos });
}
writeFileSync(new URL('travel.json', out), JSON.stringify({ places: pins }));
const files = readdirSync(out).length;
console.log(`travel map: ${places.length} places on ${pins.length} pins, ${files - 1} photos`);
for (const p of pins) console.log(`  ${p.place}: ${p.photos.map((ph) => ph.place).join(', ')}`);
