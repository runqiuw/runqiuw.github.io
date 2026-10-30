#!/usr/bin/env node
// The room's travel map, from src/data/travel.yaml:
//  - public/room/prints/travel-map.webp: the poster above the TV, a pastel Miller world map; nearby
//    places share one pin (numbered with how many), standing roughly where they are;
//  - public/room/travel/region-<id>.webp: each region's own map in the same projection (the contiguous
//    US, most of Europe, most of China), with a pin and a name per place;
//  - public/room/travel/<id>-<n>.webp: each place's photos, resized to 640 px with metadata (EXIF/GPS)
//    dropped, or a generated stand-in for `placeholder` entries;
//  - public/room/travel/travel.json: the world pins (and the region each opens), each region's frame
//    on the world map and its places (poster UV of each pin's head, photo lists) for room-travel.ts.
// Rerun after editing travel.yaml:  node bin/room-travel.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { feature, mesh } from 'topojson-client';
import { parse } from 'yaml';

const root = new URL('..', import.meta.url);
const require = createRequire(import.meta.url);
const places = parse(readFileSync(new URL('src/data/travel.yaml', root), 'utf8')) ?? [];
// Each region's zoomed map has a fixed frame (west, east, south, north) covering the whole country or
// continent, widened to the 3:2 poster, so places added later still land on the same map.
const REGIONS = {
  us: { name: 'United States', bounds: [-125, -66.5, 24, 49.5] },
  europe: { name: 'Europe', bounds: [-11, 32, 35.5, 60] },
  china: { name: 'China', bounds: [73, 135, 18, 54] },
};
const atlas110 = require('world-atlas/land-110m.json'), atlas50 = require('world-atlas/countries-50m.json');
const rings = (geo) => (geo.type === 'FeatureCollection' ? geo.features.map((f) => f.geometry) : [geo.geometry ?? geo])
  .flatMap((g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []));
const coarseRings = rings(feature(atlas110, atlas110.objects.land));
const fineRings = rings(feature(atlas50, atlas50.objects.land));
const borderLines = mesh(atlas50, atlas50.objects.countries, (a, b) => a !== b).coordinates;

// 3:2 like the 0.9 × 0.6 m poster. Every map is Miller's projection at one scale both ways, framed by
// its west/east longitudes and top latitude, inside an M-pixel paper margin.
const W = 1536, H = 1024, M = 34;
const r = Math.PI / 180;
const miller = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * Math.max(-89, Math.min(89, lat)) * r));
const unmiller = (y) => (Math.atan(Math.exp(y / 1.25)) - Math.PI / 4) / 0.4 / r;
const view = (west, east, top) => {
  const sx = (W - 2 * M) / (east - west), sy = sx / r, t = miller(top);
  return { sx, xy: ([lng, lat]) => [M + (lng - west) * sx, M + (t - miller(lat)) * sy] };
};
const world = view(-130, 135, 80);

// Rings crossing the antimeridian (Chukotka, Fiji, Antarctica) are unwrapped so they don't streak
// across the map; any ring then reaching past ±180° is drawn again a world away, clipped by the frame.
const unwrap = (pts) => pts.reduce((out, [lng, lat]) => {
  const prev = out.at(-1);
  out.push([prev ? lng + Math.round((prev[0] - lng) / 360) * 360 : lng, lat]);
  return out;
}, []);
const path = (v, lines, close) => lines.map(unwrap).map((pts) => {
  const lngs = pts.map((p) => p[0]);
  return [0, ...(Math.max(...lngs) > 180 ? [-360] : []), ...(Math.min(...lngs) < -180 ? [360] : [])]
    .map((dx) => 'M' + pts.map(([lng, lat]) => v.xy([lng + dx, lat]).map((n) => n.toFixed(1)).join(',')).join('L') + (close ? 'Z' : '')).join('');
}).join('');

const esc = (s) => String(s).replace(/[<&>"]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' })[c]);
const FONT = 'Helvetica, Arial, sans-serif';

// A pin: head radius R centred PIN above its tip. Where pins crowd they are pushed apart while a
// spring holds each near its place; outlines may still touch slightly (overlap).
const spread = (pins, R, PIN, overlap = 0.12) => {
  const RX = 2 * R * (1 - overlap), RY = (PIN + R) * (1 - overlap);
  for (let step = 0; step < 6000; step++) {
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      const a = pins[i].tip, b = pins[j].tip;
      let dx = (b[0] - a[0]) / RX, dy = (b[1] - a[1]) / RY, d = Math.hypot(dx, dy);
      if (d >= 1) continue;
      // Coincident pins separate sideways (heads read best side by side).
      if (d < 1e-6) [dx, dy, d] = [i % 2 ? 1 : -1, 0, 1e-6];
      const push = (1 - d) / 2 / d;
      a[0] -= dx * push * RX; a[1] -= dy * push * RY; b[0] += dx * push * RX; b[1] += dy * push * RY;
    }
    for (const p of pins) {
      p.tip[0] += (p.at[0] - p.tip[0]) * 0.003;
      p.tip[1] += (p.at[1] - p.tip[1]) * 0.003;
      p.tip[0] = Math.min(Math.max(p.tip[0], M + R + 4), W - M - R - 4);
      p.tip[1] = Math.min(Math.max(p.tip[1], M + PIN + R + 4), H - M - 4);
    }
  }
};
// A pin; a shared pin shows in its head how many places it stands for.
const pinSvg = ([x, y], R, PIN, count = 1) => `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <ellipse cx="0" cy="1" rx="${R * 0.55}" ry="${R * 0.2}" fill="#1d2148" opacity=".2"/>
    <path d="M0 0C0 0-${R}-${PIN * 0.6}-${R}-${PIN}a${R} ${R} 0 0 1 ${2 * R} 0C${R}-${PIN * 0.6} 0 0 0 0z" fill="#ff6b5e" stroke="#fff" stroke-width="${R / 5}"/>
    ${count > 1
      ? `<circle cx="0" cy="-${PIN}" r="${R * 0.62}" fill="#fff"/><text x="0" y="-${PIN}" font-family="${FONT}" font-size="${R * 0.82}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#e0483c">${count}</text>`
      : `<circle cx="0" cy="-${PIN}" r="${R * 0.4}" fill="#fff"/>`}</g>`;
// A name beside a pin's head, haloed so it reads over land, sea and borders.
const labelSvg = ({ x, y, anchor, text, size }) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="700" text-anchor="${anchor}" dominant-baseline="middle" fill="#1d2148" stroke="#fffaf0" stroke-width="${size / 4}" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
// Each name sits right of, left of, above or below its pin's head (or diagonally), whichever overlaps least
// with other pins and names and stays on the map. The most crowded pins choose first.
const placeLabels = (pins, R, PIN, size) => {
  const pinBoxes = pins.map((p) => [p.tip[0] - R, p.tip[1] - PIN - R, p.tip[0] + R, p.tip[1]]);
  const area = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const near = (p) => Math.min(...pins.filter((q) => q !== p).map((q) => Math.hypot(q.tip[0] - p.tip[0], q.tip[1] - p.tip[1])), Infinity);
  const placed = [], out = new Map();
  for (const p of [...pins].sort((a, b) => near(a) - near(b))) {
    const w = p.label.length * size * 0.58, h = size, [x, y] = p.tip, head = y - PIN, gap = R + 6;
    const options = [
      { anchor: 'start', x: x + gap, y: head, box: [x + gap, head - h / 2, x + gap + w, head + h / 2] },
      { anchor: 'end', x: x - gap, y: head, box: [x - gap - w, head - h / 2, x - gap, head + h / 2] },
      { anchor: 'middle', x, y: head - R - h * 0.7, box: [x - w / 2, head - R - h * 1.2, x + w / 2, head - R - h * 0.2] },
      { anchor: 'middle', x, y: y + h * 0.8, box: [x - w / 2, y + h * 0.3, x + w / 2, y + h * 1.3] },
      ...[-1, 1].flatMap((dy) => [
        { anchor: 'start', x: x + gap, y: head + dy * h, box: [x + gap, head + dy * h - h / 2, x + gap + w, head + dy * h + h / 2] },
        { anchor: 'end', x: x - gap, y: head + dy * h, box: [x - gap - w, head + dy * h - h / 2, x - gap, head + dy * h + h / 2] },
      ]),
    ];
    const cost = (o) => (o.box[0] < M + 6 || o.box[2] > W - M - 6 || o.box[1] < M + 6 || o.box[3] > H - M - 6 ? 1e9 : 0) +
      [...pinBoxes, ...placed].reduce((s, b) => s + area(o.box, b), 0);
    const best = options.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    placed.push(best.box);
    out.set(p, { x: best.x, y: best.y, anchor: best.anchor, text: p.label, size });
  }
  return pins.map((p) => out.get(p));
};

const poster = (v, land, borders, pins, labels, R, PIN) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#fffaf0"/>
  <clipPath id="sea"><rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" rx="18"/></clipPath>
  <g clip-path="url(#sea)">
    <rect width="${W}" height="${H}" fill="#bfe3f2"/>
    <path d="${path(v, land, true)}" fill="#ffe2b8" stroke="#e7b98a" stroke-width="2" stroke-linejoin="round" fill-rule="evenodd"/>
    ${borders ? `<path d="${path(v, borders, false)}" stroke="#d9ad84" stroke-width="1.5" stroke-dasharray="6 5" fill="none"/>` : ''}
  </g>
  ${[...pins].sort((a, b) => a.tip[1] - b.tip[1]).map((p) => pinSvg(p.tip, R, PIN, p.count)).join('')}
  ${labels.map(labelSvg).join('')}
  <rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" rx="18" fill="none" stroke="#1d2148" stroke-opacity=".12" stroke-width="3"/>
</svg>`;
const webp = async (svg) => sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();

// A clearly marked stand-in photo: a soft landscape in the place's own hue, labelled "placeholder".
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const stand = (label, seed) => {
  const h = hue(label), w = 640, ht = 480, sun = 120 + (seed % 5) * 90;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${ht}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},70%,82%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},75%,90%)"/></linearGradient></defs>
    <rect width="${w}" height="${ht}" fill="url(#s)"/>
    <circle cx="${sun}" cy="150" r="54" fill="#fff7d6"/>
    <path d="M0 330 L130 220 L250 310 L380 190 L520 300 L640 240 V480 H0Z" fill="hsl(${(h + 180) % 360},35%,62%)"/>
    <path d="M0 380 Q160 330 320 380 T640 370 V480 H0Z" fill="hsl(${(h + 200) % 360},40%,48%)"/>
    <rect x="${w / 2 - 190}" y="${ht / 2 - 52}" width="380" height="104" rx="22" fill="#ffffff" opacity=".82"/>
    <text x="${w / 2}" y="${ht / 2 - 6}" font-family="${FONT}" font-size="40" font-weight="700" text-anchor="middle" fill="#1d2148">${esc(label)}</text>
    <text x="${w / 2}" y="${ht / 2 + 32}" font-family="${FONT}" font-size="24" text-anchor="middle" fill="#5c628c">placeholder</text>
  </svg>`);
};

const out = new URL('public/room/travel/', root);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// UV of a pin's head (glTF UVs, v down like the image).
const uvOf = ([x, y], PIN) => [+(x / W).toFixed(4), +((y - PIN) / H).toFixed(4)];

// World pins for groups of nearby places; small named pins for places on each region's map.
const BIG = { R: 19, PIN: 38 }, SMALL = { R: 15, PIN: 30 };
const aspect = (W - 2 * M) / (H - 2 * M);
const regions = [];
for (const [id, { name, bounds: [w, e, s, n] }] of Object.entries(REGIONS)) {
  const members = places.filter((p) => p.region === id);
  // The fixed frame, in longitude and Miller units, widened around its middle to the 3:2 frame.
  let west = w, east = e, yTop = miller(n), yBottom = miller(s);
  if ((east - west) * r / (yTop - yBottom) < aspect) {
    const grow = ((yTop - yBottom) * aspect / r - (east - west)) / 2;
    west -= grow; east += grow;
  } else {
    const grow = ((east - west) * r / aspect - (yTop - yBottom)) / 2;
    yTop += grow; yBottom -= grow;
  }
  const v = view(west, east, unmiller(yTop));
  // Where this region's whole texture (paper margin included) lies on the world texture, as UVs: the
  // close-up zooms the world map into this rectangle, then swaps in the region's sharper map.
  const m = M / v.sx;
  const [u0, v0] = world.xy([west - m, unmiller(yTop + m * r)]);
  const [u1, v1] = world.xy([east + m, unmiller(yBottom - m * r)]);
  const pins = members.map((p) => { const at = v.xy(p.lnglat); return { place: p, at, tip: [...at], label: p.place }; });
  spread(pins, SMALL.R, SMALL.PIN);
  writeFileSync(new URL(`region-${id}.webp`, out), await webp(poster(v, fineRings, borderLines, pins, placeLabels(pins, SMALL.R, SMALL.PIN, 22), SMALL.R, SMALL.PIN)));

  const list = [];
  for (const { place: p, tip } of pins) {
    const photos = [];
    for (const [i, ph] of (p.photos ?? []).entries()) {
      const file = `${p.id}-${i + 1}.webp`;
      const input = ph.placeholder ? stand(ph.placeholder, i) : new URL(ph.src, root).pathname;
      // `rotate()` applies the camera orientation; sharp writes no EXIF/GPS unless asked to.
      const img = sharp(input).rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true });
      const info = await img.webp({ quality: 82 }).toFile(new URL(file, out).pathname);
      const note = ph.placeholder ? 'placeholder' : ph.caption ?? '';
      photos.push({ src: `/room/travel/${file}`, w: info.width, h: info.height, place: p.place, note: [note, p.when].filter(Boolean).join(' · ') });
    }
    list.push({ id: p.id, place: p.place, uv: uvOf(tip, SMALL.PIN), photos });
  }
  const rect = [u0 / W, v0 / H, u1 / W, v1 / H].map((n) => +n.toFixed(5));
  regions.push({ id, name, map: `/room/travel/region-${id}.webp`, rect, places: list });
}

// World pins: places of one region merge while every member of the merged group stays within GROUP
// pixels of every other (complete linkage), so a chain of neighbours (Shanghai → Fuzhou → Shenzhen)
// can't join distant groups. A group's pin stands on its most central place.
const GROUP = 46;
let groups = places.filter((p) => REGIONS[p.region]).map((p) => [p]);
const far = (a, b) => Math.max(...a.flatMap((p) => b.map((q) => Math.hypot(...[0, 1].map((k) => world.xy(p.lnglat)[k] - world.xy(q.lnglat)[k])))));
for (;;) {
  let best = null, bestD = GROUP;
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    if (groups[i][0].region !== groups[j][0].region) continue;
    const d = far(groups[i], groups[j]);
    if (d <= bestD) [best, bestD] = [[i, j], d];
  }
  if (!best) break;
  groups[best[0]] = [...groups[best[0]], ...groups[best[1]]];
  groups.splice(best[1], 1);
}
const worldPins = groups.map((g) => {
  const pts = g.map((p) => world.xy(p.lnglat)), c = [0, 1].map((k) => pts.reduce((s, q) => s + q[k], 0) / pts.length);
  const lead = pts.reduce((b, q, k) => (Math.hypot(q[0] - c[0], q[1] - c[1]) < Math.hypot(pts[b][0] - c[0], pts[b][1] - c[1]) ? k : b), 0);
  return { members: g, region: g[0].region, count: g.length, at: pts[lead], tip: [...pts[lead]] };
});
spread(worldPins, BIG.R, BIG.PIN, 0.08);
writeFileSync(new URL('public/room/prints/travel-map.webp', root), await webp(poster(world, coarseRings, null, worldPins, [], BIG.R, BIG.PIN)));
writeFileSync(new URL('travel.json', out), JSON.stringify({
  pins: worldPins.map(({ region, members, tip }) => ({ region, places: members.map((p) => p.place), uv: uvOf(tip, BIG.PIN) })),
  regions,
}));
for (const p of worldPins) console.log(`${p.region} pin: ${p.members.map((m) => m.place).join(', ')}`);
