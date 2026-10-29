import { CanvasTexture, Matrix4, Mesh, PlaneGeometry, Raycaster, SRGBColorSpace, Vector2, Vector3, type Material, type MeshStandardMaterial, type Object3D, type PerspectiveCamera } from 'three';

// The travel map's close-up (`map`): clicking a pin printed on the poster fans that place's photos
// out over the map as little prints; clicking a print enlarges it, clicking anywhere else folds them
// back into the pin. Data and photos come from bin/room-travel.mjs. Loaded on the first visit; it
// runs its own animation frames only while prints move, and draws nothing extra when idle.
type Photo = { src: string; w: number; h: number; place: string; note: string };
type Place = { id: string; place: string; uv: [number, number]; photos: Photo[] };
type Card = { mesh: Mesh; tex: CanvasTexture; ctx: CanvasRenderingContext2D; slot: [number, number]; size: number; rot: number; k: number; kv: number; z: number; zv: number; delay: number };

const CARD_W = 512, CARD_H = 604, PHOTO = { x: 24, y: 24, w: 464, h: 348 };
// Card width as a share of the poster's: at most SIZE, smaller when a pin has many photos; an
// enlarged card is ZOOMED wide. STEP staggers the cards (s) as they fan out.
const SIZE = 0.17, ZOOMED = 0.44, STEP = 0.04;

export function addTravel(poster: Object3D, canvas: HTMLCanvasElement, camera: PerspectiveCamera,
  enabled: () => boolean, changed: () => void, back: () => void): { leave(): void } | undefined {
  if (poster.userData.travel) return poster.userData.travel;
  let print: Mesh | undefined;
  poster.traverse((o) => { if (o instanceof Mesh && (o.material as Material).userData.role === 'print') print = o; });
  if (!print) return;
  const map = print;

  // The print plane's UVs map linearly onto it: position = origin + u·A + v·B (least squares over its
  // vertices), so a UV on the picture (a pin) gives a point on the poster in the plane's own space.
  const pos = map.geometry.getAttribute('position'), uvs = map.geometry.getAttribute('uv');
  const sums = [0, 0, 0, 0, 0, 0], rhs = [new Vector3(), new Vector3(), new Vector3()], p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = uvs.getX(i), v = uvs.getY(i);
    p.fromBufferAttribute(pos, i);
    sums[0] += 1; sums[1] += u; sums[2] += v; sums[3] += u * u; sums[4] += u * v; sums[5] += v * v;
    rhs[0].add(p); rhs[1].addScaledVector(p, u); rhs[2].addScaledVector(p, v);
  }
  const e = new Matrix4().set(sums[0], sums[1], sums[2], 0, sums[1], sums[3], sums[4], 0, sums[2], sums[4], sums[5], 0, 0, 0, 0, 1).invert().elements; // column-major
  const solve = (r: number) => new Vector3().addScaledVector(rhs[0], e[r]).addScaledVector(rhs[1], e[r + 4]).addScaledVector(rhs[2], e[r + 8]);
  const origin = solve(0), A = solve(1), B = solve(2);
  const right = A.clone().normalize(), up = B.clone().negate().normalize();
  const front = right.clone().cross(up);
  // Face the viewer whichever way the plane was modelled.
  const world = map.localToWorld(front.clone().add(origin)).sub(map.localToWorld(origin.clone()));
  if (world.dot(camera.position.clone().sub(map.getWorldPosition(new Vector3()))) < 0) front.negate();
  const at = (u: number, v: number) => origin.clone().addScaledVector(A, u).addScaledVector(B, v);
  const width = A.length(), aspect = width / B.length();
  const tall = (CARD_H / CARD_W) * aspect; // a card's height in V per unit of width in U

  // Prints reuse the poster's own (already compiled) print material, each with its own picture.
  const base = map.material as MeshStandardMaterial;
  const plane = new PlaneGeometry(1, 1);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ray = new Raycaster(), ndc = new Vector2();
  let places: Place[] = [];
  fetch('/room/travel/travel.json').then((r) => r.json()).then((d) => {
    places = d.places;
  }).catch(() => {});

  let open: Place | null = null, cards: Card[] = [], zoomed = -1, raf = 0, last = 0, down: [number, number] | null = null;

  const font = '"Fredoka Variable", "Nunito Variable", system-ui, sans-serif';
  // Drawn at CARD_W × CARD_H units; small cards (many photos) get a smaller canvas.
  const drawCard = (c: Card, ph: Photo, img?: HTMLImageElement) => {
    const x = c.ctx;
    x.setTransform(c.ctx.canvas.width / CARD_W, 0, 0, c.ctx.canvas.width / CARD_W, 0, 0);
    x.fillStyle = '#fffdf7';
    x.fillRect(0, 0, CARD_W, CARD_H);
    x.fillStyle = '#e9e6f4';
    x.fillRect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
    if (img) {
      // Cover-crop into the 4:3 window.
      const s = Math.max(PHOTO.w / img.width, PHOTO.h / img.height), w = PHOTO.w / s, h = PHOTO.h / s;
      x.drawImage(img, (img.width - w) / 2, (img.height - h) / 2, w, h, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
    }
    x.fillStyle = '#1d2148';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `600 38px ${font}`;
    x.fillText(ph.place, CARD_W / 2, PHOTO.y + PHOTO.h + 72, CARD_W - 40);
    x.fillStyle = '#5c628c';
    x.font = `400 28px ${font}`;
    if (ph.note) x.fillText(ph.note, CARD_W / 2, PHOTO.y + PHOTO.h + 124, CARD_W - 40);
    c.tex.needsUpdate = true;
  };

  // A grid beside the pin: the column count that gives the largest cards that still fit on the
  // poster, placed below the pin in the top half of the map and above it otherwise, kept on the poster.
  const layout = (pl: Place) => {
    const n = pl.photos.length, margin = 0.035, room = 1 - 2 * margin;
    let size = 0, cols = 1;
    for (let c = 1; c <= n; c++) {
      const rows = Math.ceil(n / c);
      const s = Math.min(SIZE, room / (1 + (c - 1) * 0.96), room / (tall * (1 + (rows - 1) * 0.92)));
      if (s > size + 1e-6) [size, cols] = [s, c];
    }
    const rows = Math.ceil(n / cols), h = size * tall, stepU = size * 0.96, stepV = h * 0.92;
    const blockW = size + (cols - 1) * stepU, blockH = h + (rows - 1) * stepV;
    const below = pl.uv[1] < 0.5;
    const top0 = below ? pl.uv[1] + 0.06 : pl.uv[1] - 0.06 - blockH;
    const left = Math.min(Math.max(pl.uv[0] - blockW / 2, margin), 1 - margin - blockW);
    const top = Math.min(Math.max(top0, margin), 1 - margin - blockH);
    return pl.photos.map((_, i) => {
      const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols), col = i - row * cols;
      // A short last row is centred under the others.
      const u = left + size / 2 + (col + (cols - inRow) / 2) * stepU, v = top + h / 2 + row * stepV;
      return { slot: [u, v] as [number, number], size, rot: ((col - (inRow - 1) / 2) * 0.07 + Math.sin(i * 2.3) * 0.035) * Math.min(1, size / SIZE) };
    });
  };

  const place = (c: Card, i: number) => {
    const pin = open!.uv, k = Math.max(0, Math.min(1.08, c.k)), z = c.z;
    const u = pin[0] + (c.slot[0] - pin[0]) * k, v = pin[1] + (c.slot[1] - pin[1]) * k;
    const pt = at(u + (0.5 - u) * z, v + (0.5 - v) * z);
    const lift = width * (0.012 + i * 0.0012 + z * 0.05);
    c.mesh.position.copy(pt).addScaledVector(front, lift);
    const s = width * c.size * (0.12 + 0.88 * Math.min(1, k)) * (1 + (ZOOMED / c.size - 1) * z);
    c.mesh.scale.set(s, s * (CARD_H / CARD_W), 1);
    const angle = c.rot * Math.min(1, k) * (1 - z);
    const x = right.clone().applyAxisAngle(front, angle), y = up.clone().applyAxisAngle(front, angle);
    c.mesh.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, front));
    c.mesh.visible = k > 0.01;
  };

  const spring = (c: Card, target: number, zoomTarget: number, dt: number) => {
    if (reduced) {
      c.k = target; c.kv = 0; c.z = zoomTarget; c.zv = 0;
      return false;
    }
    if (c.delay > 0) { c.delay -= dt; return true; }
    c.kv += (260 * (target - c.k) - 20 * c.kv) * dt;
    c.k += c.kv * dt;
    c.zv += (300 * (zoomTarget - c.z) - 26 * c.zv) * dt;
    c.z += c.zv * dt;
    return Math.abs(target - c.k) > 1e-3 || Math.abs(c.kv) > 1e-3 || Math.abs(zoomTarget - c.z) > 1e-3 || Math.abs(c.zv) > 1e-3;
  };

  let folding = false;
  const tick = (now: number) => {
    const dt = Math.min(0.033, (now - (last || now)) / 1000);
    last = now;
    let moving = false;
    cards.forEach((c, i) => {
      moving = spring(c, folding ? 0 : 1, !folding && i === zoomed ? 1 : 0, dt) || moving;
      place(c, i === zoomed ? cards.length : i);
    });
    changed();
    if (moving) raf = requestAnimationFrame(tick);
    else {
      raf = 0; last = 0;
      if (folding) clear();
    }
  };
  const animate = () => { if (!raf) raf = requestAnimationFrame(tick); };

  const clear = () => {
    for (const c of cards) {
      map.remove(c.mesh);
      c.tex.dispose();
      (c.mesh.material as Material).dispose();
    }
    cards = []; open = null; zoomed = -1; folding = false;
    changed();
  };

  const show = (pl: Place) => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0; last = 0;
    clear();
    open = pl;
    const slots = layout(pl);
    cards = pl.photos.map((ph, i) => {
      const c2 = document.createElement('canvas'), res = slots[i].size >= 0.12 ? 1 : 0.625;
      c2.width = CARD_W * res; c2.height = CARD_H * res;
      const tex = new CanvasTexture(c2);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = base.map?.anisotropy ?? 1;
      const mat = base.clone();
      mat.map = tex;
      mat.transparent = false;
      const mesh = new Mesh(plane, mat);
      mesh.name = `travel-photo-${pl.id}-${i + 1}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      map.add(mesh);
      const c: Card = { mesh, tex, ctx: c2.getContext('2d')!, slot: slots[i].slot, size: slots[i].size, rot: slots[i].rot, k: 0, kv: 0, z: 0, zv: 0, delay: Math.min(i * STEP, 0.4) };
      drawCard(c, ph);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (open === pl && cards[i] === c) { drawCard(c, ph, img); changed(); } };
      img.src = ph.src;
      place(c, i);
      return c;
    });
    animate();
  };
  const fold = () => {
    if (!open || folding) return;
    folding = true;
    zoomed = -1;
    cards.forEach((c, i) => (c.delay = (cards.length - 1 - i) * STEP * 0.5));
    animate();
  };

  // --- picking: prints first (front-most), then the pins printed on the poster.
  const pointAt = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const cardAt = () => {
    const hits = ray.intersectObjects(cards.filter((c) => c.mesh.visible).map((c) => c.mesh), false);
    return hits.length ? cards.findIndex((c) => c.mesh === hits[0].object) : -1;
  };
  const mapHit = () => ray.intersectObject(map, false)[0];
  // A pin is hit within a fixed distance on screen (the printed heads are small on a phone).
  const screen = new Vector3();
  const pinAt = (ev: PointerEvent) => {
    const r = canvas.getBoundingClientRect(), reach = 24;
    let best: Place | null = null, bestD = reach;
    for (const pl of places) {
      map.localToWorld(screen.copy(at(pl.uv[0], pl.uv[1]))).project(camera);
      const d = Math.hypot((screen.x + 1) / 2 * r.width + r.left - ev.clientX, (1 - screen.y) / 2 * r.height + r.top - ev.clientY);
      if (d < bestD) { best = pl; bestD = d; }
    }
    return best;
  };

  const onDown = (ev: PointerEvent) => { if (enabled()) down = [ev.clientX, ev.clientY]; };
  const onUp = (ev: PointerEvent) => {
    const d = down;
    down = null;
    if (!enabled() || !d || Math.hypot(ev.clientX - d[0], ev.clientY - d[1]) >= 6) return;
    pointAt(ev);
    const i = cardAt();
    if (i >= 0 && !folding) {
      zoomed = zoomed === i ? -1 : i;
      return animate();
    }
    const hit = mapHit(), pl = pinAt(ev);
    if (pl) {
      if (open !== pl || folding) show(pl);
      return;
    }
    if (open) return fold();
    if (!hit) back();
  };
  const onMove = (ev: PointerEvent) => {
    if (!enabled() || down) return;
    pointAt(ev);
    canvas.style.cursor = cardAt() >= 0 || pinAt(ev) ? 'pointer' : '';
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => (down = null));
  canvas.addEventListener('pointermove', onMove);

  const api = {
    leave() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0; down = null;
      clear();
      canvas.style.cursor = '';
    },
  };
  poster.userData.travel = api;
  return api;
}
