// The map on the Playground's distance card, after joshwcomeau.com/about-josh: a pin where the
// visitor is, my avatar in a pin over Madison, and a dotted great-circle line between them. Loaded
// on demand by Pinboard.astro. Tiles come from OpenFreeMap (free, no key). When the animation ends
// it hands a still of the map (pins included) to `onStill`, which the room puts on its pinboard.
import { LngLatBounds, Map as MapLibreMap, Marker, setWorkerUrl, type GeoJSONSource, type LngLatLike } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

type LngLat = [number, number];
const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };
const LINE = '#ff4f8b';

/** Points along the great circle from `a` to `b`, with longitudes unwrapped so the line never jumps across the map. */
const arc = (a: LngLat, b: LngLat, n = 96): LngLat[] => {
  const r = Math.PI / 180;
  const v = ([lng, lat]: LngLat) => [Math.cos(lat * r) * Math.cos(lng * r), Math.cos(lat * r) * Math.sin(lng * r), Math.sin(lat * r)];
  const [p, q] = [v(a), v(b)];
  const w = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]));
  const out: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [s1, s2] = w < 1e-6 ? [1 - t, t] : [Math.sin((1 - t) * w) / Math.sin(w), Math.sin(t * w) / Math.sin(w)];
    const [x, y, z] = [0, 1, 2].map((k) => s1 * p[k] + s2 * q[k]);
    let lng = Math.atan2(y, x) / r;
    const prev = out[i - 1];
    if (prev) lng += Math.round((prev[0] - lng) / 360) * 360;
    out.push([lng, Math.atan2(z, Math.hypot(x, y)) / r]);
  }
  return out;
};

const pinEl = (cls: string, avatar?: string) => {
  const el = document.createElement('div');
  el.className = `map-pin ${cls}`;
  el.innerHTML = `<svg viewBox="0 0 40 52" aria-hidden="true"><path d="M20 51C20 51 3 31.5 3 19.5a17 17 0 0 1 34 0C37 31.5 20 51 20 51z"/></svg>${avatar ? `<img src="${avatar}" alt="">` : '<i></i>'}`;
  return el;
};

type MapOptions = {
  el: HTMLElement;
  home: LngLat;
  visitor?: LngLat;
  avatar: string;
  reduceMotion: boolean;
  onStill: (url: string) => void;
};

function renderDistanceMap(o: MapOptions & { onSnapshot: (page: string, room: string, credits: HTMLElement | null) => void }) {
  const theme = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const path = o.visitor ? arc(o.visitor, o.home) : [o.home];
  const home = path[path.length - 1];
  const map = new MapLibreMap({
    container: o.el,
    style: STYLE[theme()],
    center: (o.visitor ?? o.home) as LngLatLike,
    zoom: o.visitor ? 5 : 4,
    interactive: false,
    attributionControl: { compact: false },
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });

  let animation = 0, removed = false;
  const dispose = () => {
    if (removed) return;
    removed = true; cancelAnimationFrame(animation); map.remove();
  };
  let shown = o.reduceMotion ? path.length : 1;
  const line = () => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: path.slice(0, Math.max(2, shown)) } });
  map.on('style.load', () => {
    map.addSource('trip', { type: 'geojson', data: line() });
    map.addLayer({
      id: 'trip',
      type: 'line',
      source: 'trip',
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: o.visitor ? 'visible' : 'none' },
      paint: { 'line-color': LINE, 'line-width': 3, 'line-dasharray': [0, 2] },
    });
  });

  const homePin = new Marker({ element: pinEl('home', o.avatar), anchor: 'bottom' }).setLngLat(home as LngLatLike);
  const youPin = o.visitor ? new Marker({ element: pinEl('you'), anchor: 'bottom' }).setLngLat(o.visitor as LngLatLike) : null;

  // A still of the map with both pins drawn on it, for the room's pinboard card.
  const avatarImg = new Image();
  avatarImg.src = o.avatar;
  // Screen position on the world copy in view (`project` doesn't wrap longitudes the way markers do).
  const xy = ([lng, lat]: LngLat) => {
    const c = map.getCenter().lng;
    return map.project([lng + Math.round((c - lng) / 360) * 360, lat]);
  };
  const still = () => {
    const src = map.getCanvas();
    const c = document.createElement('canvas');
    [c.width, c.height] = [src.width, src.height];
    const x = c.getContext('2d')!;
    x.drawImage(src, 0, 0);
    const k = src.width / o.el.clientWidth;
    const pin = (at: LngLat, size: number, fill: string, img?: HTMLImageElement) => {
      const p = xy(at);
      const [px, py, s] = [p.x * k, p.y * k, size * k];
      x.fillStyle = fill;
      x.beginPath();
      x.moveTo(px, py);
      x.bezierCurveTo(px - s * 0.25, py - s * 0.45, px - s * 0.5, py - s * 0.6, px - s * 0.5, py - s * 1.05);
      x.arc(px, py - s * 1.05, s * 0.5, Math.PI, 0);
      x.bezierCurveTo(px + s * 0.5, py - s * 0.6, px + s * 0.25, py - s * 0.45, px, py);
      x.fill();
      if (img?.complete) x.drawImage(img, px - s * 0.42, py - s * 1.47, s * 0.84, s * 0.84);
    };
    if (o.visitor) pin(o.visitor, 22, '#7d8597');
    pin(home, 40, '#ffffff', avatarImg);
    // The room's card is nearly square: crop around the middle of the two pins.
    const cw = Math.min(c.width, (c.height * 256) / 208);
    const xs = [home, ...(o.visitor ? [o.visitor] : [])].map((p) => xy(p).x * k);
    const sx = Math.max(0, Math.min(c.width - cw, xs.reduce((a, b) => a + b) / xs.length - cw / 2));
    const out = document.createElement('canvas');
    [out.width, out.height] = [cw, c.height];
    out.getContext('2d')!.drawImage(c, sx, 0, cw, c.height, 0, 0, cw, c.height);
    const page = c.toDataURL('image/png'), room = out.toDataURL('image/jpeg', .85);
    const credits = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-attrib-inner')?.cloneNode(true) as HTMLElement | null;
    dispose();
    o.onSnapshot(page, room, credits);
  };

  const finish = () => {
    homePin.getElement().classList.add('in');
    map.once('idle', still);
  };

  map.once('load', () => {
    youPin?.addTo(map);
    homePin.addTo(map);
    youPin?.getElement().classList.add('in');
    if (!o.visitor) return finish();
    const bounds = path.reduce((b, p) => b.extend(p as LngLatLike), new LngLatBounds(path[0], path[0]));
    // Keep both pins inside the middle of the map, the part the room's card crops (see `still`).
    const side = Math.max(48, (o.el.clientWidth - (o.el.clientHeight * 256) / 208) / 2 + 28);
    const fit = { padding: { top: 64, bottom: 30, left: side, right: side }, maxZoom: 9 };
    if (o.reduceMotion) {
      map.fitBounds(bounds, { ...fit, animate: false });
      return finish();
    }
    // Pull back from the visitor until both ends fit, then draw the line toward Madison.
    map.fitBounds(bounds, { ...fit, duration: 1800, essential: true });
    map.once('moveend', () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 1100);
        shown = Math.ceil(path.length * (1 - (1 - t) ** 3));
        (map.getSource('trip') as GeoJSONSource | undefined)?.setData(line());
        if (t < 1) animation = requestAnimationFrame(step);
        else finish();
      };
      animation = requestAnimationFrame(step);
    });
  });

  return dispose;
}

/** Keep the final page/board images, release WebGL, and regenerate only on theme/size changes. */
export function mountDistanceMap(o: MapOptions) {
  const cache = new Map<string, { page: string; room: string; credits: HTMLElement | null }>();
  let dispose = () => {}, timer = 0, generation = 0, last = '', first = true;
  let roomOpen = !!document.querySelector('.room.full'), deferred = false;
  let idle = 0, idleTimer = 0;
  const display = (snapshot: { page: string; room: string; credits: HTMLElement | null }) => {
    const image = new Image(); image.src = snapshot.page; image.alt = '';
    image.className = 'map-still'; image.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover';
    o.el.replaceChildren(image);
    if (snapshot.credits) {
      const credits = snapshot.credits.cloneNode(true) as HTMLElement;
      credits.style.cssText = 'position:absolute;right:0;bottom:0;padding:2px 4px;background:#ffffffd9;color:#333;font:10px sans-serif';
      o.el.append(credits);
    }
    o.onStill(snapshot.room);
  };
  const refresh = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const width = o.el.clientWidth, height = o.el.clientHeight;
      if (!width || !height) return;
      const key = [document.documentElement.dataset.theme, width, height, devicePixelRatio].join(':');
      if (key === last) return;
      last = key; generation++; const current = generation;
      dispose();
      const snapshot = cache.get(key);
      if (snapshot) { display(snapshot); return; }
      o.el.replaceChildren();
      dispose = renderDistanceMap({ ...o, reduceMotion: o.reduceMotion || !first,
        onSnapshot: (page, room, credits) => {
          if (current !== generation) return;
          // Retain at most the two theme snapshots; old window sizes don't accumulate.
          if (cache.size >= 2) cache.delete(cache.keys().next().value!);
          const snapshot = { page, room, credits }; cache.set(key, snapshot); display(snapshot);
        },
      });
      first = false;
    }, 150);
  };
  const cancelDeferred = () => {
    if (idle) window.cancelIdleCallback(idle);
    clearTimeout(idleTimer);
    idle = idleTimer = 0;
    deferred = false;
  };
  const flushDeferred = () => { if (deferred) { cancelDeferred(); refresh(); } };
  const nearViewport = () => {
    const r = o.el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom >= -300 && r.top <= innerHeight + 300;
  };
  const scheduleFallback = () => window.setTimeout(flushDeferred, 1500);
  const themeChanged = () => {
    cancelDeferred();
    // Invalidate a pending or in-flight snapshot immediately, including rapid theme reversals.
    clearTimeout(timer);
    generation++;
    dispose();
    last = '';
    if (roomOpen || nearViewport()) return refresh();
    deferred = true;
    if ('requestIdleCallback' in window) idle = window.requestIdleCallback(flushDeferred, { timeout: 1500 });
    else idleTimer = scheduleFallback();
  };
  const roomChanged = (e: Event) => {
    roomOpen = (e as CustomEvent<number>).detail > 0;
    if (roomOpen) flushDeferred();
  };
  const visibility = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) flushDeferred();
  }, { rootMargin: '300px 0px' });
  visibility.observe(o.el);
  const observer = new ResizeObserver(refresh);
  observer.observe(o.el);
  window.addEventListener('themechange', themeChanged);
  window.addEventListener('roomlevel', roomChanged);
  window.addEventListener('resize', refresh);
  refresh();
  return () => { generation++; clearTimeout(timer); cancelDeferred(); dispose(); observer.disconnect(); visibility.disconnect(); window.removeEventListener('themechange', themeChanged); window.removeEventListener('roomlevel', roomChanged); window.removeEventListener('resize', refresh); };
}
