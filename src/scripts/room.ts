// Live clay room for the left panel. Scroll (the `sectionchange` event) moves the camera to the
// object for that section; the theme switch (`themechange`) turns the lights on or off.
// `enterFull()` turns it into a free-orbit room with labels; picking a label or an object calls
// `onNavigate(section)` so the page can close the room and scroll there.
// Rendering happens only while something moves. Temporary: uses the prototype model and code-defined
// camera shots until the Blender pass provides `cam_*` empties (see redesign/BLENDER_TODO.md).
import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

type Shot = { t: Vector3; dir: Vector3; r: number };

const CLAY: Record<string, string> = {
  wall: '#f4f2ff', wallW: '#ebe8ff', floor: '#ffd2a0', trim: '#ffffff', frame: '#3d5afe', glass: '#bfe4ff', blind: '#e2e4ff',
  bed: '#3d5afe', mattress: '#fffaf3', sheet: '#cddcff', pillow: '#fff0c4', headboard: '#ff9a72', desk: '#2b3170', chair: '#ff6b5e',
  mon: '#2b3170', screen: '#1fbf93', lamp: '#ffc93c', glow: '#fff1c2', cart: '#ffffff', cartF: '#1fbf93', sidetable: '#9a8cff',
  nightstand: '#1fbf93', mirrorF: '#2b3170', mirror: '#d6efff', paper: '#ffffff', laptop: '#c8cdf0', door: '#ffffff', misc: '#cfd3f2',
};

// Material names come from the Blender file (Chinese); map them to clay colors.
function clayKey(group: string, mat: string): string {
  if (/玻璃/.test(mat)) return 'glass';
  if (/镜面/.test(mat)) return 'mirror';
  if (/屏幕|显示屏/.test(mat)) return 'screen';
  if (/灯泡|发光|灯面|乳白灯|乳白罩/.test(mat)) return 'glow';
  if (/卷帘/.test(mat)) return 'blind';
  if (/墙面/.test(mat)) return group === 'wall_W' ? 'wallW' : 'wall';
  if (/地板/.test(mat)) return 'floor';
  if (/门框|踢脚/.test(mat)) return group.startsWith('door') ? 'door' : 'trim';
  if (/床垫/.test(mat)) return 'mattress';
  if (/床单|薄被/.test(mat)) return 'sheet';
  if (/枕套/.test(mat)) return 'pillow';
  if (/床头｜深棕/.test(mat)) return 'headboard';
  if (/纸张/.test(mat)) return 'paper';
  if (/笔记本/.test(mat)) return 'laptop';
  if (/推车/.test(mat)) return 'cart';
  if (/台灯｜白色烤漆/.test(mat)) return 'lamp';
  if (/窗框/.test(mat) && group.startsWith('wall')) return 'frame';
  const byGroup: Record<string, string> = {
    bed: 'bed', desk: 'desk', chair: 'chair', monitor1: 'mon', monitor2: 'mon', lamp: 'lamp', cart: 'cartF', sidetable: 'sidetable',
    nightstand: 'nightstand', mirror: 'mirrorF', details: 'laptop', door: 'trim', door_closet: 'trim',
  };
  return byGroup[group] ?? 'misc';
}

const KEEP = /^(bed|cart|chair|desk|details|door|door_closet|floor|lamp|mirror|monitor1|monitor2|nightstand|sidetable|wall_[NSEW])$/;
const LIGHTS = {
  light: { hemi: 1.9, sun: 2.4, lamp: 0, screen: 0, bed: 0, emis: 0.12 },
  dark: { hemi: 0.5, sun: 0.4, lamp: 4.5, screen: 3, bed: 3, emis: 1.2 },
};

// Which section each clickable object belongs to.
const HOT: Record<string, string> = {
  monitor1: 'research', monitor2: 'research', desk: 'research', cart: 'projects', bed: 'games', sidetable: 'games', board: 'playground',
};
const LABELS: [section: string, object: string, title: string][] = [
  ['research', 'Desk', 'Research'],
  ['projects', 'Cart', 'Projects'],
  ['games', 'Game corner', 'Games'],
  ['playground', 'Pinboard', 'Playground'],
];

export interface RoomOptions {
  section: string;
  theme: 'light' | 'dark';
  reduceMotion: boolean;
  onNavigate: (section: string) => void;
}

export async function mountRoom(frame: HTMLElement, opts: RoomOptions) {
  const canvas = document.createElement('canvas');
  canvas.className = 'room-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  frame.prepend(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(1.75, devicePixelRatio || 1));

  const scene = new Scene();
  const cam = new PerspectiveCamera(30, 1, 0.05, 80);
  const center = new Vector3(2.05, 0.85, -1.85);

  const hemi = new HemisphereLight(0xffffff, 0xd2ccff, LIGHTS.light.hemi);
  const sun = new DirectionalLight(0xffffff, LIGHTS.light.sun);
  sun.position.set(center.x + 3.5, 7, center.z + 5.5);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  const lampL = new PointLight(0xffc06a, 0, 7, 1.4);
  const screenL = new PointLight(0x5effd0, 0, 3.2, 1.8);
  const bedL = new PointLight(0xffa860, 0, 3.2, 1.6);
  scene.add(hemi, sun, sun.target, lampL, screenL, bedL);

  const gltf = await new GLTFLoader().loadAsync('/room/room-clay.glb');
  const root = gltf.scene;
  const groups: Record<string, Object3D> = {};
  const mats: MeshStandardMaterial[] = [];
  root.children.slice().forEach((n) => {
    if (/头枕/.test(n.name)) n.userData.alias = 'chair';
    else if (!KEEP.test(n.name)) n.visible = false;
  });
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    let top: Object3D = o;
    while (top.parent && top.parent !== root) top = top.parent;
    const g: string = top.userData.alias || top.name;
    const key = clayKey(g, (o.material as { name?: string })?.name ?? '');
    const m = new MeshStandardMaterial({ color: new Color(CLAY[key]), roughness: key === 'mirror' || key === 'glass' ? 0.25 : 0.82, metalness: 0 });
    if (key === 'glass') {
      m.transparent = true;
      m.opacity = 0.55;
    }
    m.userData = { key };
    o.userData.group = g;
    o.material = m;
    mats.push(m);
    o.castShadow = !/^wall|floor/.test(g) || key === 'frame';
    o.receiveShadow = true;
  });
  root.children.forEach((n) => (groups[n.userData.alias || n.name] = n));
  scene.add(root);
  root.updateMatrixWorld(true);
  const box = (o: Object3D) => new Box3().setFromObject(o);

  // Temporary pinboard above the desk for the Playground shot.
  const m1 = box(groups.monitor1), m2 = box(groups.monitor2), desk = box(groups.desk);
  const bw = Math.max(1.5, m2.max.x - m1.min.x + 0.1), bh = 0.86;
  const board = new Group();
  const cork = new Mesh(new BoxGeometry(bw, bh, 0.03), new MeshStandardMaterial({ color: new Color('#f0c79a'), roughness: 0.95 }));
  cork.castShadow = cork.receiveShadow = true;
  board.add(cork);
  const frameMat = new MeshStandardMaterial({ color: new Color('#3d5afe'), roughness: 0.8 });
  for (const [x, y, w, h] of [[0, bh / 2 + 0.015, bw + 0.06, 0.03], [0, -bh / 2 - 0.015, bw + 0.06, 0.03], [-bw / 2 - 0.015, 0, 0.03, bh], [bw / 2 + 0.015, 0, 0.03, bh]]) {
    const f = new Mesh(new BoxGeometry(w, h, 0.045), frameMat);
    f.position.set(x, y, 0);
    board.add(f);
  }
  const noteColors = ['#fff1a8', '#c9efe1', '#ffd6cf', '#d9dcff', '#fff1a8', '#c9efe1'];
  noteColors.forEach((c, i) => {
    const s = 0.2;
    const note = new Mesh(new BoxGeometry(s, s, 0.006), new MeshStandardMaterial({ color: new Color(c), roughness: 0.9 }));
    note.position.set(-bw / 2 + (bw / 3) * ((i % 3) + 0.5), bh / 2 - (bh / 2) * (Math.floor(i / 3) + 0.5), 0.02);
    note.rotation.z = [-0.06, 0.05, -0.03, 0.04, -0.05, 0.03][i];
    note.castShadow = true;
    const pin = new Mesh(new SphereGeometry(0.016, 12, 10), new MeshStandardMaterial({ color: new Color(['#ff6b5e', '#3d5afe', '#1fbf93'][i % 3]) }));
    pin.position.set(0, s * 0.4, 0.015);
    note.add(pin);
    board.add(note);
  });
  board.position.set((m1.min.x + m2.max.x) / 2, Math.max(m1.max.y, m2.max.y) + 0.2 + bh / 2, Math.min(desk.min.z, m1.min.z, m2.min.z) - 0.01);
  board.traverse((o) => (o.userData.group = 'board'));
  scene.add(board);

  // Dynamic screen: a simple "terminal" texture on the left monitor.
  const screenTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const x = c.getContext('2d')!;
    x.fillStyle = '#14183a';
    x.fillRect(0, 0, 512, 288);
    x.fillStyle = '#1fbf93';
    x.font = '600 24px sans-serif';
    x.fillText('runqiu@uw ~ % research', 24, 48);
    x.fillStyle = '#e8eaff';
    x.font = '20px sans-serif';
    ['MoiréSkin · MobiCom ’26', 'MoiréLens · SenSys ’26', 'MP-Former · IDETC ’25'].forEach((l, i) => x.fillText('→ ' + l, 24, 100 + i * 38));
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  groups.monitor1.traverse((o) => {
    if (o instanceof Mesh && (o.material as MeshStandardMaterial).userData.key === 'screen') {
      // The exported screens have no UVs, so overlay a plane on the screen's front face instead.
      const b = new Box3().setFromObject(o), s = b.getSize(new Vector3()), c = b.getCenter(new Vector3());
      const p = new Mesh(new BoxGeometry(s.x * 0.96, s.y * 0.94, 0.001), new MeshStandardMaterial({ map: screenTex, emissive: new Color('#ffffff'), emissiveMap: screenTex, emissiveIntensity: 0.6 }));
      p.position.set(c.x, c.y, b.max.z + 0.004);
      scene.add(p);
    }
  });

  // Lights at the lamps.
  const lb = box(groups.lamp);
  lampL.position.set((lb.min.x + lb.max.x) / 2, lb.max.y - 0.12, (lb.min.z + lb.max.z) / 2 + 0.15);
  screenL.position.set((m1.min.x + m2.max.x) / 2, (m1.min.y + m1.max.y) / 2, Math.max(m1.max.z, m2.max.z) + 0.35);
  const nb = box(groups.nightstand);
  bedL.position.set((nb.min.x + nb.max.x) / 2, nb.max.y + 0.35, (nb.min.z + nb.max.z) / 2);

  // Camera shots, derived from object bounds. Rough on purpose; Blender `cam_*` empties replace these.
  const shot = (b: Box3, dir: Vector3, pad = 1.35, lift = 0): Shot => {
    const c = b.getCenter(new Vector3());
    c.y += lift;
    const s = b.getSize(new Vector3());
    return { t: c, dir: dir.normalize(), r: Math.max(s.x, s.y) * 0.5 * pad + 0.15 };
  };
  const shots: Record<string, Shot> = {
    top: { t: center.clone(), dir: new Vector3(1, 0.9, 1).normalize(), r: 3.35 },
    research: shot(m1.clone().union(m2), new Vector3(0.3, 0.38, 1), 1.75, -0.06),
    projects: shot(box(groups.cart), new Vector3(0.35, 0.75, 1), 1.55),
    games: shot(box(groups.bed).union(box(groups.sidetable)), new Vector3(1, 0.95, 0.55), 1.0),
    playground: shot(box(board), new Vector3(0.12, 0.08, 1), 1.25),
    contact: { t: center.clone().add(new Vector3(0.4, 0, 0.3)), dir: new Vector3(1.05, 1.15, 0.55).normalize(), r: 3.5 },
  };

  const anchor = (b: Box3, dy = 0.12) => {
    const c = b.getCenter(new Vector3());
    c.y = b.max.y + dy;
    return c;
  };
  const anchors: Record<string, Vector3> = {
    research: anchor(m2),
    projects: anchor(box(groups.cart)),
    games: anchor(box(groups.bed), 0.25),
    playground: anchor(box(board), 0.08),
  };
  const pins = document.createElement('div');
  pins.className = 'room-pins';
  pins.hidden = true;
  pins.innerHTML = LABELS.map(([k, o, t]) => `<button type="button" class="room-pin" data-go="${k}"><small>${o}</small>${t}</button>`).join('');
  pins.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (b) opts.onNavigate(b.dataset.go!);
  });
  frame.append(pins);

  const walls = { S: [groups.wall_S], N: [groups.wall_N], E: [groups.wall_E, groups.door, groups.door_closet], W: [groups.wall_W] };

  // --- framing, tweening, render on demand ---
  const camT = new Vector3();
  let dirty = true;
  let tween: { t0: number; ms: number; fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3 } | null = null;
  let active = opts.section in shots ? opts.section : 'top';
  const place = (s: Shot) => {
    const v = MathUtils.degToRad(cam.fov) / 2, h = Math.atan(Math.tan(v) * cam.aspect);
    return { t: s.t.clone(), p: s.t.clone().addScaledVector(s.dir, s.r / Math.sin(Math.min(v, h))) };
  };
  const jump = (s: Shot) => {
    const q = place(s);
    camT.copy(q.t);
    cam.position.copy(q.p);
    cam.lookAt(camT);
    dirty = true;
  };
  const go = (id: string) => {
    const s = shots[id];
    if (!s) return;
    active = id;
    if (full) return;
    if (opts.reduceMotion) return jump(s);
    const q = place(s);
    tween = { t0: performance.now(), ms: 1100, fromT: camT.clone(), fromP: cam.position.clone(), toT: q.t, toP: q.p };
  };
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  let cur = { ...LIGHTS[opts.theme] };
  let target = LIGHTS[opts.theme];
  let fading = false;
  const setTheme = (t: 'light' | 'dark') => {
    target = LIGHTS[t];
    fading = true;
    hemi.color.set(t === 'dark' ? 0x7d84ff : 0xffffff);
    sun.color.set(t === 'dark' ? 0x9fb2ff : 0xffffff);
    sun.position.set(t === 'dark' ? center.x - 6 : center.x + 3.5, t === 'dark' ? 4.5 : 7, t === 'dark' ? center.z + 1 : center.z + 5.5);
    if (opts.reduceMotion) {
      cur = { ...target };
      fading = false;
    }
    dirty = true;
  };
  setTheme(opts.theme);
  cur = { ...target };

  // --- full-screen orbit mode ---
  let full = false;
  const controls = new OrbitControls(cam, canvas);
  Object.assign(controls, {
    enabled: false, enablePan: false, enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.55,
    minDistance: 3, maxDistance: 16, minPolarAngle: 0.45, maxPolarAngle: 1.35,
    minAzimuthAngle: -0.4, maxAzimuthAngle: Math.PI / 2 + 0.4,
  });
  controls.addEventListener('change', () => (dirty = true));
  const enterFull = () => {
    full = true;
    tween = null;
    // The bounding-sphere fit is too cautious on tall portrait screens; tighten it there.
    const q = place({ ...shots.top, r: shots.top.r * (cam.aspect < 0.8 ? 0.78 : 1) });
    controls.target.copy(q.t);
    controls.maxDistance = Math.max(16, q.p.distanceTo(q.t) * 1.3);
    cam.position.copy(q.p);
    camT.copy(q.t);
    controls.enabled = true;
    pins.hidden = false;
    canvas.style.cursor = 'grab';
    dirty = true;
  };
  const exitFull = () => {
    full = false;
    controls.enabled = false;
    pins.hidden = true;
    canvas.style.cursor = '';
    camT.copy(controls.target);
    go(active);
  };

  // Click an object in full mode → navigate to its section.
  const ray = new Raycaster(), ndc = new Vector2();
  const shown = (o: Object3D | null) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  const pick = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObjects(scene.children, true).find((h) => shown(h.object));
    return hit ? HOT[hit.object.userData.group] : undefined;
  };
  let down: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!full || !down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    const k = moved < 6 ? pick(e) : undefined;
    if (k) opts.onNavigate(k);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (full && !down) canvas.style.cursor = pick(e) ? 'pointer' : 'grab';
  });

  const resize = () => {
    const w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    if (full) dirty = true;
    else if (!tween) jump(shots[active]);
  };
  new ResizeObserver(resize).observe(frame);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(frame);
  const v = new Vector3();
  // Keep drawing for ~2 s after mount: frames drawn while the canvas is still fading in from
  // opacity 0 may never be presented, which would leave the panel blank until the next move.
  let warmup = 120;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (tween) {
      const x = Math.min(1, (now - tween.t0) / tween.ms), e = ease(x);
      camT.lerpVectors(tween.fromT, tween.toT, e);
      cam.position.lerpVectors(tween.fromP, tween.toP, e);
      cam.lookAt(camT);
      if (x >= 1) tween = null;
      dirty = true;
    }
    if (fading) {
      let done = true;
      for (const k of Object.keys(cur) as (keyof typeof cur)[]) {
        const d = target[k] - cur[k];
        cur[k] += d * 0.08;
        if (Math.abs(d) > 0.005) done = false;
      }
      if (done) {
        cur = { ...target };
        fading = false;
      }
      dirty = true;
    }
    if (full && controls.update()) dirty = true;
    if (warmup > 0) {
      warmup--;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    hemi.intensity = cur.hemi;
    sun.intensity = cur.sun;
    lampL.intensity = cur.lamp;
    screenL.intensity = cur.screen;
    bedL.intensity = cur.bed;
    for (const m of mats) {
      const k = m.userData.key;
      if (k === 'screen') {
        m.emissive.set(CLAY.screen);
        m.emissiveIntensity = cur.emis;
      } else if (k === 'glow') {
        m.emissive.set('#ffd98a');
        m.emissiveIntensity = cur.emis * 1.2;
      }
    }
    // Hide whichever walls face the camera (dollhouse view).
    v.copy(cam.position).sub(full ? controls.target : camT);
    walls.S.forEach((w) => (w.visible = v.z < 0.4));
    walls.N.forEach((w) => (w.visible = v.z > -0.4));
    walls.W.forEach((w) => (w.visible = v.x > -0.4));
    walls.E.forEach((w) => w && (w.visible = v.x < 0.4));
    renderer.render(scene, cam);
    if (full) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      pins.querySelectorAll<HTMLElement>('[data-go]').forEach((p) => {
        const a = v.copy(anchors[p.dataset.go!]).project(cam);
        const half = p.offsetWidth / 2 + 8;
        p.style.left = `${Math.min(w - half, Math.max(half, ((a.x + 1) / 2) * w))}px`;
        p.style.top = `${((1 - a.y) / 2) * h}px`;
        p.style.visibility = a.z < 1 ? '' : 'hidden';
      });
    }
  };
  requestAnimationFrame(loop);

  window.addEventListener('sectionchange', (e) => go((e as CustomEvent<string>).detail));
  window.addEventListener('themechange', (e) => setTheme((e as CustomEvent<'light' | 'dark'>).detail));
  return { canvas, enterFull, exitFull };
}
