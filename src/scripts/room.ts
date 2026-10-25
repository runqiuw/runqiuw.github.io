// Live clay room for the left panel, assembled from the Blender assets in public/room/assets/
// according to room.config.ts (layout, colors, camera shots).
// Scroll (`sectionchange`) moves the camera to the object for that section; `itemchange` (the page
// item in view) decides what that object shows: the paper on the monitors, the game on the TV, the
// project frame or pinboard card that pops out. The theme switch (`themechange`) turns the lights on
// or off. `enterFull()` turns it into a free-orbit room with labels; picking a label or an object
// asks the panel for its close-up (`onFocus`, then `focus()`), or calls `onNavigate(section)` when it
// has none. There a click also switches a lamp, the TV ambilight or the nixie clock, and dragging the
// chair spins its top; in the pinboard's close-up its cards can be dragged around. Rendering happens
// only while something changes (visible coffee steam, the breathing ambilight and the night clock
// keep their own capped redraw schedules).
import {
  AdditiveBlending,
  Box2,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  FrontSide,
  Group,
  HemisphereLight,
  MathUtils,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NoColorSpace,
  PMREMGenerator,
  BackSide,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  Shape,
  ShapeGeometry,
  type Side,
  SphereGeometry,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { createToyWorld, Toy, ToyShape } from './room-physics';
import type { createHoops } from './room-hoops';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createCoffeeSteam } from './room-coffee';
import { CLOSEUPS, COFFEE, DECOR, FABRIC_PRINTS, HOOPS, LABELS, LAMP_AIM, LIGHTS, PLACEMENTS, PRINTS, PROJECT_MODELS, WINDOWS, type Role, SCREENS, SHELL, SHOTS, type Shot as ShotDef } from './room.config';

type Shot = { t: Vector3; dir: Vector3; r: number; far?: number; fitWidth?: boolean };
type Manifest = {
  assets: Record<string, { size: number[]; mount?: string; tiers?: number[]; tier_clear?: number; screen?: { aspect: number }; cover?: { aspect: number } }>;
};

const ASSETS = '/room/assets/';
const ROOM_FOV = 30;
const INK = '#14183a';
const LEVELS = {
  light: { hemi: 0.65, env: 0.6, sun: 2.6, screen: 0, tv: 0, shelf: 0, emis: 0.12, night: 0 },
  dark: { hemi: 0.5, env: 1, sun: 0.4, screen: 3.2, tv: 1.8, shelf: 1.8, emis: 1.2, night: 1 },
};
/** Lights you can click on and off in the full-screen room, and each one's level when on. They all
 * come on with the dark theme and go off with the light one; a click flips one until the next switch. */
const SWITCH_ON = { lamp: 9, bed: 2.2, amb: 1, clock: 1 };
type Switch = keyof typeof SWITCH_ON;
/** TV ambilight: one breath every `AMB_MS`, a new color at the bottom of each breath. */
const AMB_MS = 4000;
const AMB_COLORS = ['#ff3d6e', '#3d5afe', '#1fbf93', '#ffc93c', '#b45cff', '#00c2ff'];
/** Surface finish per material role: fabric is matte, wood and paint have a soft sheen, screens and
 * metal are glossy enough to catch the window in the environment light. */
const ROUGH: Record<string, number> = { fabric: 0.95, leaf: 0.7, wood: 0.55, frame: 0.5, accent: 0.5, metal: 0.38, screen: 0.22, glass: 0.06, glow: 0.6, digit: 0.6 };
const NOTE_COLORS = ['#fff1a8', '#c9efe1', '#ffd6cf', '#d9dcff'];
const PIN_COLORS = ['#ff6b5e', '#3d5afe', '#1fbf93'];

// Plan coordinates (x right, y up the floor plan, z height) → three.js (y up, plan y = −z).
const P = (x: number, y: number, z = 0) => new Vector3(x, z, -y);
const PD = ([x, y, up]: [number, number, number]) => new Vector3(x, up, -y).normalize();

/** An animation the camera can follow frame by frame (the panel's open/close morph): `progress`
 * is its eased progress 0–1, `done` turns true when it ends or is cancelled. */
export interface Clock {
  progress: () => number;
  done: () => boolean;
}

export interface RoomOptions {
  section: string;
  theme: 'light' | 'dark';
  reduceMotion: boolean;
  /** Leave the room for `section` on the page (and, if given, that item in it). */
  onNavigate: (section: string, item?: string) => void;
  /** A click asks for a close-up (CLOSEUPS); the panel opens it with `focus`, so it can keep the history. */
  onFocus: (id: string) => void;
  /** A click asks to go up one level (e.g. beside the board in its close-up). */
  onBack: () => void;
}

export async function mountRoom(frame: HTMLElement, opts: RoomOptions) {
  const canvas = document.createElement('canvas');
  canvas.className = 'room-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  frame.prepend(canvas);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // Neutral (Khronos PBR Neutral) keeps the toy palette's hues and only rolls off the highlights.
  renderer.toneMapping = NeutralToneMapping;
  renderer.setPixelRatio(Math.min(1.75, devicePixelRatio || 1));

  const scene = new Scene();
  const cam = new PerspectiveCamera(ROOM_FOV, 1, 0.05, 80);
  const setFov = (fov: number) => {
    if (cam.fov === fov) return;
    cam.fov = fov;
    cam.updateProjectionMatrix();
  };
  const center = P(2.05, 1.85, 0.85);

  let dirty = true;
  let active = opts.section in SHOTS ? opts.section : 'top';
  let item = document.documentElement.dataset.item ?? '';

  // Walls that face the camera (and what hangs on them) aren't hidden: they swap to this material,
  // which draws nothing but still casts shadows, so they keep blocking light. The ceiling's
  // sealing box also uses it. Daylight and moonlight then only come in through the windows.
  const ghostMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  ghostMat.shadowSide = DoubleSide;
  const ghost = (o: Object3D, on: boolean) =>
    o.traverse((c) => {
      if (!(c instanceof Mesh) || !!c.userData.ghost === on) return;
      if (on) [c.userData.ghost, c.material] = [c.material, ghostMat];
      else [c.material, c.userData.ghost] = [c.userData.ghost, undefined];
    });
  const hemi = new HemisphereLight(0xffffff, 0xd2ccff, LEVELS.light.hemi);
  const sun = new DirectionalLight(0xffffff, LEVELS.light.sun);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  // Night lights are spots, so lamp shades and screens light a cone instead of the whole room.
  // `shadow` makes furniture block them (the bed for the bedside lamp, the desk for the floor lamp).
  const spot = (color: number, angle: number, dist: number, shadow = false, penumbra = 0.7) => {
    const l = new SpotLight(color, 0, dist, angle, penumbra, 1.5);
    if (shadow) {
      l.castShadow = true;
      // 1024 and a soft edge: at 512 the board's shadow on the wall beside it read as stair steps.
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.radius = 4;
      l.shadow.bias = -0.002;
      l.shadow.normalBias = 0.02;
      l.shadow.camera.near = 0.05;
    }
    scene.add(l, l.target);
    return l;
  };
  // Wide and soft: a tighter cone cut a hard diagonal across the pinboard next to it.
  const lampL = spot(0xffc06a, 1.15, 5, true, 1);
  const bedL = spot(0xffa860, 0.95, 3, true);
  // One per monitor light bar (LIGHTS.screen).
  const screenLs = LIGHTS.screen.map(() => spot(0xfff1dc, 0.65, 1.6, true));
  const tvL = spot(0x8fa0ff, 0.95, 2.6);
  // The ambilight's wash on the wall and stand behind the TV.
  const ambL = new PointLight(0xffffff, 0, 1.6, 1.5);
  scene.add(hemi, sun, sun.target, ambL);

  // Environment light: a tiny stand-in room in the room's own colors (warm floor, lavender walls, the
  // bright window wall to the west), blurred into an environment map. It gives the soft bounce light
  // and window reflections a flat sky light can't: warm from below, brighter on the window side.
  const pmrem = new PMREMGenerator(renderer);
  const envMap = (night: boolean) => {
    const c = (hex: string, k = 1) => new MeshBasicMaterial({ color: new Color(hex).multiplyScalar(k), side: BackSide });
    const faces = night
      ? [c('#2a2d5c'), c('#4a5aa8', 1.1), c('#15173a'), c('#3a3550', 0.9), c('#262a58'), c('#2a2d5c')]
      : [c('#e9e6fb'), c('#ffffff', 1.7), c('#ffffff', 1.15), c(SHELL.floor, 0.6), c('#efecff'), c('#e9e6fb')];
    const env = new Scene();
    env.add(new Mesh(new BoxGeometry(8, 3, 8), faces)); // faces: +x, -x (west windows), up, down, +z, -z
    const t = pmrem.fromScene(env, 0.06).texture;
    faces.forEach((m) => m.dispose());
    return t;
  };
  const envs = { light: envMap(false), dark: envMap(true) };
  pmrem.dispose();

  // Canvas text uses the site fonts; wait for them briefly so the first textures aren't in a fallback.
  const fontsReady = Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const names = [...new Set([...PLACEMENTS.map((p) => p.asset), ...Object.values(PROJECT_MODELS).map((p) => p.asset)])];
  const [manifest, gltfs] = await Promise.all([
    fetch(ASSETS + 'manifest.json').then((r) => r.json() as Promise<Manifest>),
    // An asset that isn't exported yet is left out instead of failing the whole room.
    Promise.all(names.map((n) => loader.loadAsync(`${ASSETS}${n}.glb`).catch(() => null))),
    fontsReady,
  ]);
  const source = Object.fromEntries(names.map((n, i) => [n, gltfs[i]?.scene]));

  // --- materials: one per role + color; parts without an override keep their Blender (vertex) colors
  const glows: MeshStandardMaterial[] = [];
  // Lamps that switch on their own get their own glow material (`own` = the placement id).
  const ownGlows: Record<string, MeshStandardMaterial> = {};
  const matCache = new Map<string, MeshStandardMaterial>();
  // `side` comes from the exported material: Blender exports double-sided materials, and thin
  // single-layer parts (the chair's mesh back, the blind, planes) vanish from behind without it.
  // Baked ambient occlusion: assets carry a per-vertex `_AO` (three: `_ao`, 1 = open). It darkens
  // the ambient light (60%) and a little of the direct light, so gaps and corners settle without greying
  // sunlit faces. Only geometry that has the attribute gets the patched material.
  const AO_INDIRECT = 0.6, AO_DIRECT = 0.2;
  const withAO = (m: MeshStandardMaterial) => {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float _ao;\nvarying float vAo;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAo = _ao;');
      sh.fragmentShader = 'varying float vAo;\n' + sh.fragmentShader.replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mix(1.0, vAo, ${AO_INDIRECT.toFixed(2)});
  reflectedLight.directDiffuse *= mix(1.0, vAo, ${AO_DIRECT.toFixed(2)});`,
      );
    };
    m.customProgramCacheKey = () => 'baked-ao';
  };
  const material = (role: string, color?: string, vertex = false, side: Side = FrontSide, ao = false, own = '') => {
    const key = `${role}|${color ?? ''}|${vertex && !color}|${side}|${ao}|${own}`;
    let m = matCache.get(key);
    if (m) return m;
    m = new MeshStandardMaterial({
      color: new Color(color ?? '#ffffff'),
      vertexColors: vertex && !color,
      side,
      roughness: ROUGH[role] ?? 0.8,
      metalness: role === 'metal' ? 0.25 : 0,
    });
    if (role === 'glass') Object.assign(m, { transparent: true, opacity: 0.4, depthWrite: false });
    m.userData.role = role;
    if (ao) withAO(m);
    if (role === 'screen' && !color) m.color.set(INK);
    if (role === 'glow') {
      m.emissive.set('#ffd98a');
      if (own) ownGlows[own] = m;
      else glows.push(m);
    }
    matCache.set(key, m);
    return m;
  };
  // Every part of an asset gets the material of its role, in `colors` where it gives one. `lamp` is
  // the placement id of a lamp: its glow switches on its own, and its head casts no shadow.
  const dress = (g: Object3D, colors?: Partial<Record<Role, string>>, ao = true, lamp = '') =>
    g.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const role = (o.material as Material).name as Role;
      o.material = material(role, colors?.[role], o.geometry.hasAttribute('color'), (o.material as Material).side, ao && o.geometry.hasAttribute('_ao'), role === 'glow' ? lamp : '');
      // A lamp's own head would shade its light with a hard edge right beside it (the pinboard).
      o.castShadow = role !== 'glass' && !lamp;
      o.receiveShadow = true;
    });

  // --- room shell: floor slab and walls with window/door openings, built from the measured outline
  const T = SHELL.thickness, H = SHELL.height;
  // The shelf's display lights also reach the wall behind it (see stripLit).
  const wallMats: MeshStandardMaterial[] = [];
  const floorMat = new MeshStandardMaterial({ color: new Color(SHELL.floor), roughness: 0.6 });
  const floor = new Mesh(
    new ExtrudeGeometry(new Shape(SHELL.outline.map(([x, y]) => new Vector2(x, y))), { depth: 0.08, bevelEnabled: false }),
    floorMat,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  const inward = { N: new Vector2(0, -1), S: new Vector2(0, 1), E: new Vector2(-1, 0), W: new Vector2(1, 0) };
  const wallSets: { n: Vector2; also?: Vector2; objs: Object3D[] }[] = [];
  const onWall: { n: Vector2; o: Object3D }[] = [];
  // The outline runs counter-clockwise, so a right turn at a wall's end is a concave (inner) corner.
  // There both walls' thickness would fill the same square outside the room (overlapping faces
  // flicker), so the next wall starts T later and that corner gets no post.
  const concave = (i: number) => {
    const a = SHELL.walls[i], b = SHELL.walls[(i + 1) % SHELL.walls.length];
    const d1 = [a.to[0] - a.from[0], a.to[1] - a.from[1]], d2 = [b.to[0] - b.from[0], b.to[1] - b.from[1]];
    return d1[0] * d2[1] - d1[1] * d2[0] < 0;
  };
  SHELL.walls.forEach((w, wi) => {
    const n = inward[w.side];
    const alongX = w.side === 'N' || w.side === 'S';
    let [u0, u1] = alongX ? [w.from[0], w.to[0]].sort((a, b) => a - b) : [w.from[1], w.to[1]].sort((a, b) => a - b);
    if (concave((wi + SHELL.walls.length - 1) % SHELL.walls.length)) {
      if ((alongX ? w.from[0] : w.from[1]) === u0) u0 += T;
      else u1 -= T;
    }
    const line = alongX ? w.from[1] : w.from[0];
    const holes = (w.openings ?? []).slice().sort((a, b) => a.span[0] - b.span[0]);
    const pieces: [number, number, number, number][] = [];
    let u = u0;
    // The pieces under and over an opening reach 1 cm into their neighbours: shadows leak through
    // seams where boxes only touch (thin lines of sun on the floor).
    for (const o of holes) {
      if (o.span[0] > u) pieces.push([u, o.span[0], 0, H]);
      if (o.z[0] > 0) pieces.push([o.span[0] - 0.01, o.span[1] + 0.01, 0, o.z[0]]);
      if (o.z[1] < H) pieces.push([o.span[0] - 0.01, o.span[1] + 0.01, o.z[1], H]);
      u = o.span[1];
    }
    if (u < u1) pieces.push([u, u1, 0, H]);
    const mat = new MeshStandardMaterial({ color: new Color(w.side === 'W' ? SHELL.wallW : SHELL.wall), roughness: 0.9 });
    wallMats.push(mat);
    const objs = pieces.map(([a, b, z0, z1]) => {
      const len = b - a, mid = (a + b) / 2, off = line - (alongX ? n.y : n.x) * (T / 2);
      const m = new Mesh(alongX ? new BoxGeometry(len, z1 - z0, T) : new BoxGeometry(T, z1 - z0, len), mat);
      m.position.copy(alongX ? P(mid, off, (z0 + z1) / 2) : P(off, mid, (z0 + z1) / 2));
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      return m;
    });
    wallSets.push({ n, also: w.hideWith && inward[w.hideWith], objs });
  });
  // Corner posts close the gaps where two walls meet; each shows only when both walls do.
  const posts: { a: number; b: number; m: Mesh }[] = [];
  SHELL.walls.forEach((w, i) => {
    if (concave(i)) return;
    const j = (i + 1) % SHELL.walls.length;
    const out = inward[w.side].clone().add(inward[SHELL.walls[j].side]).multiplyScalar(-T / 2);
    const m = new Mesh(new BoxGeometry(T, H, T), (wallSets[i].objs[0] as Mesh).material);
    m.position.copy(P(w.to[0] + out.x, w.to[1] + out.y, H / 2));
    m.castShadow = true;
    scene.add(m);
    posts.push({ a: i, b: j, m });
    // The post only touches its walls, and sun leaks through those seams; a slightly bigger
    // shadow-only column seals them.
    const seal = new Mesh(new BoxGeometry(T + 0.04, H, T + 0.04), ghostMat);
    seal.position.copy(m.position);
    seal.castShadow = true;
    seal.raycast = () => {};
    scene.add(seal);
  });
  // A ceiling seal that only casts shadows. It sinks 10 cm into the
  // wall tops: where boxes only touch, light leaks through the seam.
  const ceilBox = SHELL.outline.reduce((b, [x, y]) => b.expandByPoint(new Vector2(x, y)), new Box2()).expandByScalar(T);
  const ceiling = new Mesh(new BoxGeometry(ceilBox.max.x - ceilBox.min.x, 0.15, ceilBox.max.y - ceilBox.min.y), ghostMat);
  ceiling.position.copy(P((ceilBox.min.x + ceilBox.max.x) / 2, (ceilBox.min.y + ceilBox.max.y) / 2, H - 0.025));
  ceiling.castShadow = true;
  ceiling.raycast = () => {};
  scene.add(ceiling);
  // The real underside is at the same height as the physics ceiling. Preserve the existing shadow
  // seal for the room's lighting; this liner receives room/ambient light without
  // receiving the seal's self-shadow, and only appears when the eye is inside the room.
  const ceilingSurface = new Mesh(
    new ShapeGeometry(new Shape(SHELL.outline.map(([x, y]) => new Vector2(x, y)))),
    new MeshStandardMaterial({ color: new Color(SHELL.wall), roughness: 0.9, side: BackSide }),
  );
  ceilingSurface.rotation.x = -Math.PI / 2;
  ceilingSurface.position.y = H;
  ceilingSurface.visible = false;
  ceilingSurface.raycast = () => {};
  scene.add(ceilingSurface);

  // --- furniture
  const placed: Record<string, Object3D> = {};
  const lampIds = new Set([LIGHTS.lamp, LIGHTS.bedside]);
  for (const p of PLACEMENTS) {
    const src = source[p.asset];
    if (!src) continue;
    const g = src.clone(true);
    g.position.copy(P(p.at[0], p.at[1], p.z ?? 0));
    g.rotation.y = MathUtils.degToRad(p.yaw ?? 0);
    if (p.tilt) g.rotateZ(MathUtils.degToRad(p.tilt));
    if (p.scale) g.scale.setScalar(p.scale);
    // Lying on its back (logo face up): tipped over, then turned by `yaw`, its middle at `at` and
    // its underside at `z`.
    if (p.lie) {
      g.rotation.set(-Math.PI / 2, MathUtils.degToRad(p.yaw ?? 0), 0, 'YXZ');
      g.updateMatrixWorld(true);
      const b = new Box3().setFromObject(g), c = b.getCenter(new Vector3()), want = P(p.at[0], p.at[1], p.z ?? 0);
      g.position.add(new Vector3(want.x - c.x, want.y - b.min.y, want.z - c.z));
    }
    dress(g, p.colors, p.ao !== false, lampIds.has(p.id) ? p.id : '');
    g.userData.closeup = Object.keys(CLOSEUPS).find(k => {
      const c = CLOSEUPS[k];
      return (!c.section || document.getElementById(c.section)) && (c.object === p.id || c.targets?.includes(p.id));
    });
    // A dedicated close-up label (Desk/Hoops) takes priority over the page section's label.
    // Otherwise hidden page sections leave their objects as decoration.
    const closeLabel = LABELS.find(([key]) => key === g.userData.closeup)?.[0];
    g.userData.section = closeLabel ?? (p.section && document.getElementById(p.section) ? p.section : undefined);
    g.userData.bounce = p.bounce !== false;
    if (p.wall) onWall.push({ n: inward[p.wall], o: g });
    scene.add(g);
    placed[p.id] = g;
  }
  scene.updateMatrixWorld(true);
  for (const p of PLACEMENTS) if (p.on && placed[p.id] && placed[p.on]) placed[p.on].attach(placed[p.id]);
  const coffeeSteam = createCoffeeSteam(placed[COFFEE.object], cam, opts.reduceMotion);


  // Sky outside the windows: a day and a night painting on planes behind each window, cross-faded
  // with the lights. They hang on the window, so they hide with its wall.
  const skyCanvas = (night: boolean) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, night ? '#0a0f2e' : '#7fbfff');
    g.addColorStop(1, night ? '#2a3270' : '#e6f4ff');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 512);
    let seed = night ? 7 : 3;
    const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    if (night) {
      for (let i = 0; i < 70; i++) {
        x.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.6})`;
        x.beginPath();
        x.arc(rnd() * 256, rnd() * 360, rnd() * 1.6 + 0.4, 0, Math.PI * 2);
        x.fill();
      }
      // A crescent moon.
      x.fillStyle = '#fff6d6';
      x.beginPath();
      x.arc(180, 90, 22, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = '#0d1336';
      x.beginPath();
      x.arc(190, 84, 20, 0, Math.PI * 2);
      x.fill();
    } else {
      x.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [cx, cy, r] of [[70, 110, 26], [100, 100, 34], [132, 112, 24], [180, 250, 20], [205, 242, 27], [228, 252, 18]]) {
        x.beginPath();
        x.arc(cx, cy, r, 0, Math.PI * 2);
        x.fill();
      }
    }
    // A soft line of trees at the bottom.
    x.fillStyle = night ? '#121a3f' : '#8fcf9f';
    x.beginPath();
    x.moveTo(0, 512);
    for (let i = 0; i <= 16; i++) x.lineTo(i * 16, 440 - Math.abs(Math.sin(i * 1.7)) * 34 - (i % 3) * 8);
    x.lineTo(256, 512);
    x.fill();
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  const skyDay = new MeshBasicMaterial({ map: skyCanvas(false) });
  const skyNight = new MeshBasicMaterial({ map: skyCanvas(true), transparent: true, opacity: 0, depthWrite: false });
  for (const id of WINDOWS) {
    const w = placed[id];
    if (!w) continue;
    const size = new Box3().setFromObject(w).getSize(new Vector3());
    // Window-local: the front (+z) faces the room. The sky sits just behind the glass (which is at
    // the wall's outer face) and is no bigger than the window, so it's only seen through the
    // opening; a bigger or farther plane shows beside the wall when the room is turned.
    const geo = new PlaneGeometry(Math.max(size.x, size.z) - 0.04, size.y - 0.02);
    for (const [mat, dz] of [[skyDay, -0.1], [skyNight, -0.098]] as const) {
      const p = new Mesh(geo, mat);
      p.position.set(0, size.y / 2, dz);
      w.add(p);
    }
  }

  // Blinds: up by day, down at night (they follow the theme switch); in full-screen mode a click on a
  // window rolls its blind up or down until the next switch. The asset has the
  // cloth (`blind_cloth`, origin on the roller) and the bottom bar (`blind_bar`) as their own nodes;
  // the cloth scales toward the roller and the bar follows its bottom edge.
  type Blind = { win: Object3D; cloth: Object3D; bar?: Object3D; len: number; barY: number; k: number; t: number };
  const blinds: Blind[] = [];
  for (const id of WINDOWS) {
    const win = placed[id];
    const cloth = win?.getObjectByName('blind_cloth');
    if (!win || !cloth) continue;
    const bar = win.getObjectByName('blind_bar') ?? undefined;
    // The cloth stops short of the frame (sides and bottom), so a closed blind leaks thin lines of
    // sun. A shadow-only panel a little bigger than the cloth rolls with it and seals the window.
    const b = new Box3().setFromObject(cloth);
    const lb = new Box3();
    cloth.children.forEach((c) => {
      if (!(c instanceof Mesh)) return;
      c.geometry.computeBoundingBox();
      lb.union(c.geometry.boundingBox!.clone().applyMatrix4(c.matrix));
    });
    if (!lb.isEmpty()) {
      const size = lb.getSize(new Vector3()).add(new Vector3(0.08, 0.1, 0.08));
      const seal = new Mesh(new BoxGeometry(size.x, size.y, size.z), ghostMat);
      seal.position.copy(lb.getCenter(new Vector3())).add(new Vector3(0, -0.05, 0));
      seal.castShadow = true;
      seal.raycast = () => {};
      cloth.add(seal);
    }
    blinds.push({ win, cloth, bar, len: (b.max.y - b.min.y) / win.scale.y, barY: bar?.position.y ?? 0, k: 1, t: 1 });
  }
  const blindOf = (o: Object3D | null) => {
    for (; o; o = o.parent) {
      const b = blinds.find((x) => x.win === o);
      if (b) return b;
    }
  };
  const stepBlinds = () => {
    let moving = false;
    for (const b of blinds) {
      if (Math.abs(b.t - b.k) < 0.001) continue;
      b.k = opts.reduceMotion ? b.t : b.k + (b.t - b.k) * 0.14;
      b.cloth.scale.y = b.k;
      if (b.bar) b.bar.position.y = b.barY + (1 - b.k) * b.len;
      moving = true;
    }
    return moving;
  };

  const bounds = (ids: string[]) => ids.reduce((b, id) => b.union(new Box3().setFromObject(placed[id])), new Box3());
  const top = (b: Box3, dy = 0) => new Vector3((b.min.x + b.max.x) / 2, b.max.y + dy, (b.min.z + b.max.z) / 2);

  // Aim the lamp spots out of the lamp head: from the `glow` part along the asset's LAMP_AIM
  // (Blender axes → three: x, z, −y), turned with the placement.
  const aimLamp = (l: SpotLight, id: string) => {
    const g = placed[id];
    const glowBox = new Box3();
    g.traverse((o) => {
      if (o instanceof Mesh && (o.material as Material).userData.role === 'glow') glowBox.union(new Box3().setFromObject(o));
    });
    const at = glowBox.isEmpty() ? top(bounds([id]), -0.05) : glowBox.getCenter(new Vector3());
    const [ax, ay, az] = LAMP_AIM[PLACEMENTS.find((p) => p.id === id)!.asset] ?? [0, 0, -1];
    const dir = new Vector3(ax, az, -ay).normalize().applyQuaternion(g.getWorldQuaternion(new Quaternion()));
    l.position.copy(at).addScaledVector(dir, 0.03);
    l.target.position.copy(at).add(dir);
  };
  aimLamp(lampL, LIGHTS.lamp);
  aimLamp(bedL, LIGHTS.bedside);
  LIGHTS.screen.forEach((id, i) => aimLamp(screenLs[i], id));
  // The TV washes the floor in front of it from the screen itself, angled down.
  const aimScreen = (l: SpotLight, ids: string[]) => {
    const b = bounds(ids), at = b.getCenter(new Vector3());
    const front = new Vector3(0, 0, 1).applyQuaternion(placed[ids[0]].quaternion);
    l.position.copy(at).addScaledVector(front, 0.08);
    l.target.position.copy(at).addScaledVector(front, 1).add(new Vector3(0, -0.9, 0));
  };
  aimScreen(tvL, [LIGHTS.tv]);

  // --- small animations: objects that pop out when their page item is in view
  type Pop = { o: Object3D; base: { p: Vector3; r: number; s: number }; d: { p: Vector3; r: number; s: number }; t: number; c: number };
  const pops: Pop[] = [];
  const poppable = (o: Object3D, d: { p?: Vector3; r?: number; s?: number }) => {
    const p: Pop = { o, base: { p: o.position.clone(), r: o.rotation.x, s: o.scale.x }, d: { p: d.p ?? new Vector3(), r: d.r ?? 0, s: d.s ?? 0 }, t: 0, c: 0 };
    pops.push(p);
    return p;
  };
  const stepPops = () => {
    let moving = false;
    for (const p of pops) {
      if (Math.abs(p.t - p.c) < 0.002) continue;
      p.c = opts.reduceMotion ? p.t : p.c + (p.t - p.c) * 0.18;
      p.o.position.copy(p.base.p).addScaledVector(p.d.p, p.c);
      p.o.rotation.x = p.base.r + p.d.r * p.c;
      if (p.d.s) p.o.scale.setScalar(p.base.s + p.d.s * p.c);
      moving = true;
    }
    return moving;
  };

  // --- drawing helpers
  const FONT = (w: number, px: number) => `${w} ${px}px 'Fredoka Variable', 'Nunito Variable', system-ui, sans-serif`;
  const wrap = (x: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) => {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (x.measureText(t).width <= maxW || !line) line = t;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines.length = maxLines;
      lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…');
    }
    return lines;
  };
  const fit = (x: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, mode: 'contain' | 'cover', bg = '#ffffff') => {
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    const k = mode === 'cover' ? Math.max(w / img.naturalWidth, h / img.naturalHeight) : Math.min((w * 0.92) / img.naturalWidth, (h * 0.9) / img.naturalHeight);
    const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
    x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
  };
  const images = new Map<string, Promise<HTMLImageElement>>();
  const loadImg = (src: string) => {
    if (!images.has(src))
      images.set(
        src,
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        }),
      );
    return images.get(src)!;
  };
  const canvasTex = (w: number, h: number, flipY = true) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(h);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = flipY;
    return { c, x: c.getContext('2d')!, tex };
  };

  // Contact shadows: a soft dark patch where each floor or desk object meets its surface, sized to the
  // footprint of its lowest 6 cm (legs, base, wheels). Real-time shadows are too sharp and too faint
  // right at the contact; this gives things weight. Painted once, so it costs nothing per frame.
  {
    const { c, x, tex } = canvasTex(128, 128);
    x.shadowColor = 'rgba(30, 22, 40, 0.75)';
    x.shadowBlur = 22;
    x.shadowOffsetX = c.width;
    x.fillRect(34 - c.width, 34, 60, 60);
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const v = new Vector3();
    for (const p of PLACEMENTS) {
      const mount = manifest.assets[p.asset]?.mount;
      // Not the toys on the bed: they get thrown around, and a painted patch would stay behind.
      if ((mount !== 'floor' && mount !== 'desk') || ['rug', 'court'].includes(p.asset) || DECOR.toys.includes(p.id) || !placed[p.id]) continue;
      const g = placed[p.id], base = new Box3().setFromObject(g).min.y, foot = new Box3();
      g.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = o.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v.y < base + 0.06) foot.expandByPoint(v);
        }
      });
      if (foot.isEmpty()) continue;
      const fs = foot.getSize(new Vector3()), fc = foot.getCenter(new Vector3());
      // The texture's dark core fills its middle 47%; pad so the blur reaches past the footprint.
      const patch = new Mesh(new PlaneGeometry((fs.x + 0.08) / 0.62, (fs.z + 0.08) / 0.62), mat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(fc.x, base + 0.002, fc.z);
      patch.raycast = () => {};
      scene.add(patch);
    }
  }

  // --- TV ambilight: no LED strip, just its glow. A soft halo on the wall behind the TV (additive,
  // so black adds nothing) and a point light that tints the wall and stand; both breathe in `draw`.
  const tvBox = bounds([LIGHTS.ambilight]);
  const tvC = tvBox.getCenter(new Vector3()), tvS = tvBox.getSize(new Vector3());
  const haloW = tvS.x + 0.8, haloH = tvS.y + 0.7;
  const haloTex = (() => {
    const { x, tex } = canvasTex(256, 256);
    // A blurred white rectangle the size of the TV: drawn off canvas, only its shadow lands on it.
    const iw = (tvS.x / haloW) * 256, ih = (tvS.y / haloH) * 256;
    Object.assign(x, { shadowColor: '#ffffff', shadowBlur: 34, shadowOffsetX: 1000 });
    x.fillStyle = '#ffffff';
    x.fillRect((256 - iw) / 2 - 1000, (256 - ih) / 2, iw, ih);
    return tex;
  })();
  const haloMat = new MeshBasicMaterial({ map: haloTex, color: new Color(0), transparent: true, blending: AdditiveBlending, depthWrite: false });
  const halo = new Mesh(new PlaneGeometry(haloW, haloH), haloMat);
  // On the desk wall (plan y = 3.70) just in front of its face, so it hides with that wall.
  halo.position.set(tvC.x, tvC.y, -3.7 + 0.004);
  scene.add(halo);
  onWall.push({ n: inward.N, o: halo });
  ambL.position.set(tvC.x, tvC.y, tvBox.min.z - 0.01);
  const ambColor = new Color();
  const breathe = (now: number) => {
    if (opts.reduceMotion) return { b: 0.8, c: AMB_COLORS[1] };
    const ph = now / AMB_MS;
    return { b: 0.15 + 0.85 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)), c: AMB_COLORS[Math.floor(ph) % AMB_COLORS.length] };
  };

  // --- desk chair: the top (`chair_top`, pivot on the gas column) spins when dragged, with a
  // little momentum after letting go.
  const chairTop = placed.chair?.getObjectByName('chair_top') ?? null;
  let chairV = 0;
  const stepChair = (dt: number) => {
    if (!chairTop || spin || Math.abs(chairV) < 0.02) return false;
    chairTop.rotation.y += chairV * dt;
    chairV *= Math.exp(-3.5 * dt);
    return true;
  };

  // --- plant: the leaves sway when the view turns. A 2D spring (world x/z offset at the top of the
  // leaves) gets a kick sideways to the camera's turn; the vertex shader bends the leaves by it,
  // more the higher a vertex sits above the pot rim.
  const plant = placed[DECOR.plant] ?? null;
  const swayU = { value: new Vector2() };
  const sway = { s: new Vector2(), v: new Vector2(), az: NaN };
  if (plant) {
    const info = manifest.assets[PLACEMENTS.find((p) => p.id === DECOR.plant)!.asset] as { size: number[]; pot_rim?: number };
    const rim = plant.position.y + (info.pot_rim ?? info.size[2] * 0.35);
    const h = Math.max(0.1, plant.position.y + info.size[2] - rim);
    plant.traverse((o) => {
      if (!(o instanceof Mesh) || (o.material as Material).userData.role !== 'leaf') return;
      const m = (o.material as MeshStandardMaterial).clone();
      const ao = (o.material as MeshStandardMaterial).customProgramCacheKey() === 'baked-ao';
      if (ao) withAO(m);
      const base = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        if (ao) base.call(m, sh, r);
        Object.assign(sh.uniforms, { uSway: swayU, uRim: { value: rim }, uH: { value: h } });
        sh.vertexShader = 'uniform vec2 uSway;\nuniform float uRim;\nuniform float uH;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  float swayK = clamp(((modelMatrix * vec4(transformed, 1.0)).y - uRim) / uH, 0.0, 1.0);
  transformed += inverse(mat3(modelMatrix)) * vec3(uSway.x, 0.0, uSway.y) * swayK * swayK;`,
        );
      };
      m.customProgramCacheKey = () => `sway-${ao}`;
      o.material = m;
    });
  }
  const plantAt = plant ? plant.getWorldPosition(new Vector3()) : null;
  const stepSway = (dt: number) => {
    if (!plantAt || opts.reduceMotion) return false;
    const az = Math.atan2(cam.position.x - plantAt.x, cam.position.z - plantAt.z);
    // The court camera faces away from the plant. Random shot changes must not keep drawing
    // an off-camera spring (especially slowly under software rendering).
    if (focused === 'hoops') {
      sway.az = az;
      sway.s.set(0, 0);
      sway.v.set(0, 0);
      swayU.value.set(0, 0);
      return false;
    }
    let d = Number.isNaN(sway.az) ? 0 : az - sway.az;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    sway.az = az;
    // Kick along the camera's sideways direction, against the turn (the leaves lag behind).
    if (d) sway.v.add(new Vector2(Math.cos(az), -Math.sin(az)).multiplyScalar(-d * 1.6));
    if (sway.s.lengthSq() < 1e-8 && sway.v.lengthSq() < 1e-6) return false;
    sway.v.addScaledVector(sway.s, -55 * dt).multiplyScalar(Math.exp(-2.2 * dt));
    sway.s.addScaledVector(sway.v, dt);
    if (sway.s.length() > 0.12) sway.s.setLength(0.12);
    swayU.value.copy(sway.s);
    return true;
  };

  // --- nixie clock on the desk: six tubes (`digit_0`…`digit_5`) show Madison time, HH MM SS.
  // No post-processing, so the glow is layered: inside each tube a back grid, the stacked cathodes and
  // a front grid sit a few millimeters apart (the lit numeral at its own depth), so they shift
  // against each other as the view turns; an additive sprite blooms past the tube; the glass gets a
  // Fresnel rim and highlights and is lit orange from inside; a small light warms the base and desk.
  const clockObj = placed[LIGHTS.clock] ?? null;
  const tubes = clockObj ? [0, 1, 2, 3, 4, 5].map((i) => clockObj.getObjectByName(`digit_${i}`) as Mesh | undefined).filter((m): m is Mesh => !!m) : [];
  // Nixie numerals are single bent wires: one stroke path per digit in a unit box (y down).
  const NUMERALS: ((p: Path2D) => void)[] = [
    (p) => p.ellipse(0.5, 0.5, 0.38, 0.46, 0, 0, Math.PI * 2),
    (p) => (p.moveTo(0.3, 0.2), p.lineTo(0.52, 0.04), p.lineTo(0.52, 0.96)),
    (p) => (p.moveTo(0.14, 0.28), p.bezierCurveTo(0.16, 0.02, 0.86, 0, 0.86, 0.3), p.bezierCurveTo(0.86, 0.52, 0.4, 0.7, 0.12, 0.96), p.lineTo(0.9, 0.96)),
    (p) => (p.moveTo(0.16, 0.18), p.bezierCurveTo(0.3, 0, 0.84, 0.02, 0.82, 0.26), p.bezierCurveTo(0.8, 0.44, 0.6, 0.48, 0.42, 0.48), p.bezierCurveTo(0.7, 0.48, 0.9, 0.6, 0.88, 0.74), p.bezierCurveTo(0.86, 1, 0.28, 1.02, 0.12, 0.82)),
    (p) => (p.moveTo(0.7, 0.96), p.lineTo(0.7, 0.04), p.lineTo(0.1, 0.68), p.lineTo(0.92, 0.68)),
    (p) => (p.moveTo(0.84, 0.04), p.lineTo(0.26, 0.04), p.lineTo(0.2, 0.44), p.bezierCurveTo(0.4, 0.34, 0.9, 0.36, 0.88, 0.68), p.bezierCurveTo(0.86, 1, 0.3, 1.02, 0.12, 0.84)),
    (p) => (p.moveTo(0.78, 0.1), p.bezierCurveTo(0.6, -0.02, 0.14, 0.04, 0.14, 0.56), p.bezierCurveTo(0.14, 1, 0.86, 1.02, 0.86, 0.66), p.bezierCurveTo(0.86, 0.36, 0.3, 0.32, 0.15, 0.58)),
    (p) => (p.moveTo(0.1, 0.04), p.lineTo(0.9, 0.04), p.lineTo(0.38, 0.96)),
    (p) => (p.ellipse(0.5, 0.27, 0.3, 0.23, 0, 0, Math.PI * 2), p.moveTo(0.86, 0.72), p.ellipse(0.5, 0.72, 0.36, 0.25, 0, 0, Math.PI * 2)),
    (p) => (p.moveTo(0.22, 0.9), p.bezierCurveTo(0.4, 1.02, 0.86, 0.96, 0.86, 0.44), p.bezierCurveTo(0.86, 0, 0.14, -0.02, 0.14, 0.34), p.bezierCurveTo(0.14, 0.64, 0.7, 0.68, 0.85, 0.42)),
  ];
  const nixie = (() => {
    if (!clockObj || !tubes.length) return null;
    // Bigger numerals than the modeled plane, nearly filling the tube like the real thing.
    for (const t of tubes) {
      const c0 = new Box3().setFromObject(t).getCenter(new Vector3());
      t.scale.x *= 1.45;
      t.scale.y *= 1.6;
      t.updateMatrixWorld(true);
      t.position.add(clockObj.worldToLocal(c0.clone()).sub(clockObj.worldToLocal(new Box3().setFromObject(t).getCenter(new Vector3()))));
      t.updateMatrixWorld(true);
    }
    const s = new Box3().setFromObject(tubes[0]).getSize(new Vector3());
    const aspect = Math.max(s.x, s.z) / s.y || 0.55;
    const W = 160, H = Math.round(W / aspect);
    // The numeral's box inside the plane, in pixels.
    const bx = W * 0.2, by = H * 0.12, bw = W * 0.6, bh = H * 0.76;
    const numeral = (d: number) => {
      const p = new Path2D(), m = new Path2D();
      NUMERALS[d](p);
      m.addPath(p, new DOMMatrix([bw, 0, 0, bh, bx, by]));
      return m;
    };
    const honeycomb = (x: CanvasRenderingContext2D, style: string, lw: number) => {
      x.strokeStyle = style;
      x.lineWidth = lw;
      const r = W * 0.045;
      for (let row = 0, y = 0; y < H + r; row++, y += r * 1.5)
        for (let cx = row % 2 ? r * 0.87 : 0; cx < W + r; cx += r * 1.74) {
          x.beginPath();
          for (let k = 0; k < 6; k++) x.lineTo(cx + r * Math.cos((k * Math.PI) / 3 + Math.PI / 6), y + r * Math.sin((k * Math.PI) / 3 + Math.PI / 6));
          x.closePath();
          x.stroke();
        }
    };
    const layer = (paint: (x: CanvasRenderingContext2D) => void, soft = false) => {
      const { x, tex } = canvasTex(W, H, false);
      x.lineCap = 'round';
      x.lineJoin = 'round';
      paint(x);
      if (soft) {
        // Fade the grids out toward the edges, so they read as a curved mesh, not a rectangle.
        x.globalCompositeOperation = 'destination-in';
        x.setTransform(1, 0, 0, H / W, 0, 0);
        const g = x.createRadialGradient(W / 2, W / 2, W * 0.2, W / 2, W / 2, W * 0.52);
        g.addColorStop(0, '#000');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, W, W);
      }
      return tex;
    };
    // Inside a tube, back to front: a dark back plate with the rear grid; the ten cathodes stacked a
    // little apart in depth (unlit ones grey, the lit one glowing at its own depth); the front grid.
    const backTex = layer((x) => {
      const g = x.createRadialGradient(W / 2, H / 2, W * 0.15, W / 2, H / 2, W * 0.62);
      g.addColorStop(0, 'rgba(18,8,4,0.92)');
      g.addColorStop(1, 'rgba(18,8,4,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      honeycomb(x, 'rgba(150,110,90,0.18)', 1);
    }, true);
    const ghostTex = layer((x) => {
      x.strokeStyle = 'rgba(150,128,115,0.3)';
      x.lineWidth = W * 0.018;
      for (let d = 0; d < 10; d++) x.stroke(numeral(d));
    });
    // Additive: the transparent background adds nothing, the wire adds light.
    const litTex = Array.from({ length: 10 }, (_, d) =>
      layer((x) => {
        const n = numeral(d);
        for (const [lw, blur, color] of [[W * 0.16, W * 0.3, 'rgba(255,70,0,0.45)'], [W * 0.085, W * 0.12, '#ff6a14'], [W * 0.05, W * 0.05, '#ff9a3c'], [W * 0.022, 0, '#ffe6c4']] as const) {
          x.shadowColor = '#ff4800';
          x.shadowBlur = blur;
          x.strokeStyle = color;
          x.lineWidth = lw;
          x.stroke(n);
        }
      }),
    );
    const frontTex = layer((x) => honeycomb(x, 'rgba(40,18,8,0.55)', 1.4), true);
    // Stacking order of the cathodes, front to back, as in an IN-14 tube.
    const STACK = [1, 6, 2, 7, 5, 0, 4, 9, 8, 3];
    const depthOf = (d: number) => (4.5 - STACK.indexOf(d)) * 0.0005;
    const plane = (t: Mesh, mat: Material, dz: number, order: number) => {
      const m = new Mesh(t.geometry, mat);
      m.position.copy(t.position);
      m.quaternion.copy(t.quaternion);
      m.scale.copy(t.scale);
      m.position.z += dz;
      m.renderOrder = order;
      t.parent!.add(m);
      return m;
    };
    const flat = (map: CanvasTexture, extra = {}) => new MeshBasicMaterial({ map, transparent: true, depthWrite: false, ...extra });
    const backMat = flat(backTex), ghostMat = flat(ghostTex), frontMat = flat(frontTex);
    const lits = tubes.map((t) => {
      t.material = backMat;
      t.position.z -= 0.0042;
      t.renderOrder = 1;
      plane(t, ghostMat, 0.0042, 2);
      plane(t, frontMat, 0.0042 + 0.0046, 4);
      const lit = plane(t, flat(litTex[0], { blending: AdditiveBlending }), 0.0042, 3);
      lit.userData.z = lit.position.z;
      return lit;
    });
    // Bloom: a camera-facing orange glow per tube, a bit bigger than the tube, added on top.
    const bloomTex = (() => {
      const { c, x, tex } = canvasTex(128, 128);
      const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,140,60,0.9)');
      g.addColorStop(0.35, 'rgba(255,90,20,0.35)');
      g.addColorStop(1, 'rgba(255,60,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, c.width, c.height);
      return tex;
    })();
    const bloomMat = new SpriteMaterial({ map: bloomTex, color: new Color('#ff7a2a'), blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
    for (const t of lits) {
      const b = new Sprite(bloomMat);
      b.position.copy(clockObj.worldToLocal(new Box3().setFromObject(t).getCenter(new Vector3())));
      b.position.z += 0.006; // in front of the numerals
      b.scale.set(s.y * 1.5, s.y * 1.9, 1);
      b.renderOrder = 6; // after the glass, so the glass doesn't dim it
      clockObj.add(b);
    }
    // The glass: clear in the middle, more opaque and brighter toward the silhouette (Fresnel), with
    // a vertical highlight down one side and a spot on the cap, as if catching a light behind the
    // viewer. Both follow the view, like real reflections. `uGlow` tints it orange from inside.
    const glowU = { value: 0 };
    const glass = new MeshStandardMaterial({ color: new Color('#ffffff'), roughness: 0.1, metalness: 0, transparent: true, opacity: 0.06, depthWrite: false });
    glass.emissive.set('#ff5a1a');
    glass.userData.role = 'glass';
    glass.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = glowU;
      sh.fragmentShader = 'uniform float uGlow;\n' + sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
  vec3 vn = normalize(normal);
  float fres = pow(1.0 - clamp(abs(dot(vn, normalize(vViewPosition))), 0.0, 1.0), 2.5);
  float streak = smoothstep(0.1, 0.0, abs(vn.x + 0.55)) * smoothstep(0.75, 0.3, vn.y);
  float cap = smoothstep(0.18, 0.0, length(vn.xy - vec2(-0.3, 0.75)));
  float spec = streak * 0.85 + cap * 0.9;
  gl_FragColor.rgb += vec3(1.0, 0.97, 0.93) * (fres * 0.35 + spec) + vec3(1.0, 0.42, 0.12) * uGlow * (0.25 + fres);
  gl_FragColor.a = clamp(gl_FragColor.a + fres * 0.5 + spec * 0.8 + uGlow * 0.12, 0.0, 1.0);`,
      );
    };
    glass.customProgramCacheKey = () => 'nixie-glass';
    clockObj.traverse((o) => {
      if (o instanceof Mesh && (o.material as Material).userData.role === 'glass') {
        o.material = glass;
        o.renderOrder = 5;
      }
    });
    const warm = new PointLight(0xff6a20, 0, 0.7, 2);
    const cb = new Box3().setFromObject(clockObj);
    warm.position.copy(clockObj.worldToLocal(cb.getCenter(new Vector3()))).add(new Vector3(0, 0.06, 0.06));
    clockObj.add(warm);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let shown = '';
    return {
      /** Show the current time at `level` (0 = off) with a faint flicker. */
      update(level: number, now: number) {
        const lit = level > 0.02;
        const t = lit ? fmt.format(new Date()).replace(/\D/g, '') : '';
        if (t !== shown) {
          shown = t;
          lits.forEach((m, i) => {
            m.visible = lit;
            if (!lit) return;
            const d = +t[i] || 0;
            (m.material as MeshBasicMaterial).map = litTex[d];
            m.position.z = m.userData.z + depthOf(d);
          });
        }
        // The tubes flicker a little at night; by day they hold steady, so the room redraws only on each tick.
        const k = level * (opts.reduceMotion || theme !== 'dark' ? 1 : 0.96 + 0.04 * Math.sin(now * 0.031) * Math.sin(now * 0.017));
        lits.forEach((m) => (m.material as MeshBasicMaterial).color.setScalar(k));
        bloomMat.opacity = 0.75 * k;
        glowU.value = k;
        warm.intensity = 0.16 * k;
      },
    };
  })();

  // Clicking a light in the full-screen room flips it.
  const switchOf = (o: Object3D | null): Switch | undefined => {
    for (; o; o = o.parent) {
      if (o === placed[LIGHTS.lamp]) return 'lamp';
      if (o === placed[LIGHTS.bedside]) return 'bed';
      if (o === halo) return 'amb';
      if (clockObj && o === clockObj) return 'clock';
    }
  };
  const isIn = (o: Object3D | null, parent: Object3D) => {
    for (; o; o = o.parent) if (o === parent) return true;
    return false;
  };

  // --- prints: a picture on an asset's `print` planes (glTF UVs, not flipped); transparent outside it.
  // One picture for all of an asset's prints, or one per plane, keyed by the start of its node name.
  for (const [id, spec] of Object.entries(PRINTS)) {
    const groups = new Map<string, Mesh[]>();
    placed[id]?.traverse((o) => {
      if (!(o instanceof Mesh) || (o.material as Material).userData.role !== 'print') return;
      const src = typeof spec === 'string' ? spec : Object.entries(spec).find(([k]) => o.name.startsWith(k))?.[1];
      if (src) groups.set(src, [...(groups.get(src) ?? []), o]);
    });
    for (const [src, planes] of groups) {
      const { c, x, tex } = canvasTex(512, 512, false);
      const mat = new MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, roughness: 0.9, side: (planes[0].material as Material).side });
      if (FABRIC_PRINTS.includes(id)) {
        // Tiny repeating height map: the actual drape/folds are Blender geometry. No animation
        // or additional draw loop is needed for the printed cloth's woven surface.
        const weave = document.createElement('canvas');
        weave.width = weave.height = 8;
        const ctx = weave.getContext('2d')!;
        const pixels = ctx.createImageData(8, 8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const k = (y * 8 + x) * 4;
          const h = 128 + Math.round(30 * Math.cos(x * Math.PI / 2) + 30 * Math.cos(y * Math.PI / 2));
          pixels.data.set([h, h, h, 255], k);
        }
        ctx.putImageData(pixels, 0, 0);
        const bump = new CanvasTexture(weave);
        bump.colorSpace = NoColorSpace;
        bump.wrapS = bump.wrapT = RepeatWrapping;
        bump.repeat.set(180, 100);
        mat.bumpMap = bump;
        mat.bumpScale = 0.00035;
        mat.roughness = 1;
      }
      for (const m of planes) {
        m.material = mat;
        m.castShadow = false;
      }
      loadImg(src).then((img) => {
        // The placeholder may already have GPU storage. Recreate it before changing size.
        if (c.width !== img.naturalWidth || c.height !== img.naturalHeight) tex.dispose();
        Object.assign(c, { width: img.naturalWidth, height: img.naturalHeight });
        x.drawImage(img, 0, 0);
        tex.needsUpdate = true;
        dirty = true;
      }, () => {});
    }
  }

  // --- screens: the `screen` / `cover` planes of the assets (glTF UVs, so textures are not flipped)
  const videos = new Set<HTMLVideoElement>();
  const videoPlayback: (() => void)[] = [];
  let videosPlaying = false;
  // `glowing` screens are unlit (they show their picture as is and reflect nothing); printed
  // surfaces like game covers take the room light.
  const makeScreen = (id: string, node: string, aspect: number, width = 640, glowing = true) => {
    const mesh = placed[id].getObjectByName(node) as Mesh;
    const { c, x, tex } = canvasTex(width, width / aspect, false);
    const mat = glowing ? new MeshBasicMaterial({ map: tex, toneMapped: false }) : new MeshStandardMaterial({ map: tex, roughness: 0.7 });
    mesh.material = mat;
    let video: HTMLVideoElement | null = null;
    let vtex: VideoTexture | null = null;
    let videoFallback = () => {};
    let req = 0;
    const useCanvas = () => {
      video?.pause();
      if (video) videos.delete(video);
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    };
    const syncPlayback = () => {
      if (!video || mat.map !== vtex) return;
      if (!videosPlaying) return video.pause();
      const current = video, r = req;
      current.play().catch((err) => {
        // Pausing during a view change can abort a pending play(). An older request must not
        // replace the new item (or its paused video) with a fallback.
        if (err.name === 'AbortError' || !videosPlaying || current !== video || r !== req || mat.map !== vtex) return;
        useCanvas();
        videoFallback();
      });
    };
    videoPlayback.push(syncPlayback);
    return {
      mesh,
      draw(fn: (x: CanvasRenderingContext2D, w: number, h: number) => void) {
        req++;
        useCanvas();
        fn(x, c.width, c.height);
        tex.needsUpdate = true;
        dirty = true;
      },
      image(src: string, mode: 'contain' | 'cover', fallback: (x: CanvasRenderingContext2D, w: number, h: number) => void) {
        const r = ++req;
        loadImg(src).then(
          (img) => r === req && this.draw((x, w, h) => fit(x, img, w, h, mode)),
          () => r === req && this.draw(fallback),
        );
      },
      video(src: string, fallback: () => void) {
        req++;
        if (!video || video.dataset.src !== src) {
          video?.pause();
          if (video) videos.delete(video);
          vtex?.dispose();
          video = Object.assign(document.createElement('video'), { src, muted: true, loop: true, playsInline: true });
          video.dataset.src = src;
          vtex = new VideoTexture(video);
          vtex.colorSpace = SRGBColorSpace;
          vtex.flipY = false;
          if (typeof video.requestVideoFrameCallback === 'function') {
            const current = video;
            const nextFrame = () => {
              if (current !== video) return;
              if (videosPlaying && mat.map === vtex && !current.paused) dirty = true;
              current.requestVideoFrameCallback(nextFrame);
            };
            current.requestVideoFrameCallback(nextFrame);
          }
        }
        if (video) videos.add(video);
        mat.map = vtex;
        mat.needsUpdate = true;
        videoFallback = fallback;
        syncPlayback();
        dirty = true;
      },
    };
  };
  const aspectOf = (id: string, key: 'screen' | 'cover') => manifest.assets[PLACEMENTS.find((p) => p.id === id)!.asset]?.[key]?.aspect ?? 16 / 9;
  const scrPaper = makeScreen(SCREENS.paper, 'screen', aspectOf(SCREENS.paper, 'screen'));
  const scrInfo = makeScreen(SCREENS.paperInfo, 'screen', aspectOf(SCREENS.paperInfo, 'screen'));
  const scrTv = makeScreen(SCREENS.tv, 'screen', aspectOf(SCREENS.tv, 'screen'));

  const pageItems = (section: string) => [...document.querySelectorAll<HTMLElement>(`#${section} [data-item]`)];
  const terminal = (x: CanvasRenderingContext2D, w: number, h: number) => {
    x.fillStyle = INK;
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#1fbf93';
    x.font = '600 30px ui-monospace, Menlo, monospace';
    x.fillText('runqiu@uw ~ % research', 30, 60);
    x.fillStyle = '#e8eaff';
    x.font = '26px ui-monospace, Menlo, monospace';
    pageItems('research').forEach((el, i) => x.fillText(`→ ${el.dataset.screenTitle!.split(':')[0]} · ${el.dataset.screenVenue}`, 30, 125 + i * 46));
  };
  const plain = (x: CanvasRenderingContext2D, w: number, h: number) => {
    x.fillStyle = INK;
    x.fillRect(0, 0, w, h);
  };
  const info = (title: string, venue: string) => (x: CanvasRenderingContext2D, w: number, h: number) => {
    plain(x, w, h);
    x.font = FONT(600, 30);
    const vw = x.measureText(venue).width + 36;
    x.fillStyle = '#3d5afe';
    x.beginPath();
    x.roundRect(36, 34, vw, 48, 24);
    x.fill();
    x.fillStyle = '#ffffff';
    x.fillText(venue, 54, 69);
    // Largest size (44 → 24 px) at which the whole title fits under the venue chip.
    let px = 44, lines: string[] = [];
    for (; px >= 24; px -= 2) {
      x.font = FONT(600, px);
      const max = Math.floor((h - 112) / (px * 1.22));
      lines = wrap(x, title, w - 72, 99);
      if (lines.length <= max) break;
    }
    lines = wrap(x, title, w - 72, Math.floor((h - 112) / (px * 1.22)));
    lines.forEach((l, i) => x.fillText(l, 36, 112 + px + i * px * 1.22));
  };
  const pressStart = (x: CanvasRenderingContext2D, w: number, h: number) => {
    plain(x, w, h);
    x.textAlign = 'center';
    x.fillStyle = '#ffc93c';
    x.font = FONT(600, 54);
    x.fillText('PRESS START', w / 2, h / 2 + 4);
    x.fillStyle = '#9aa3e8';
    x.font = FONT(500, 26);
    x.fillText(`${pageItems('games').length} games inside`, w / 2, h / 2 + 52);
    x.textAlign = 'start';
  };

  // Game cases: one per game, cover from the page, the one in view lifts.
  const games = pageItems('games');
  const boxes = SCREENS.gameBoxes.map((id, i) => {
    const el = games[i];
    const s = makeScreen(id, 'cover', aspectOf(id, 'cover'), 256, false);
    if (el?.dataset.screenImg) s.image(el.dataset.screenImg, 'cover', plain);
    else placed[id].visible = !!el;
    return { id: el?.dataset.item, pop: poppable(placed[id], { p: new Vector3(0, 0.06, 0) }) };
  });

  // Preserve page order and two displays per tier. Calibrated devices stay life-size;
  // the open front lets hover grow towards the room, clear of the solid backboard.
  const shelf = placed[SCREENS.shelf];
  const shelfAsset = manifest.assets[PLACEMENTS.find((p) => p.id === SCREENS.shelf)!.asset];
  const tiers = SCREENS.shelfTiers.map((i) => shelfAsset.tiers?.[i] ?? 0.4 * i).sort((a, b) => b - a);
  const projects = pageItems('projects');
  const perTier = Math.max(1, Math.ceil(projects.length / tiers.length));
  const shelfW = shelfAsset.size[0] - 0.08;
  const fw = Math.min(0.34, shelfW / perTier - 0.04), fh = fw * 0.66;
  const frameMat = new MeshStandardMaterial({ color: new Color('#ffffff'), roughness: 0.8 });
  // Hover grows a display up to 22%; miniatures reserve only 10% so they fill their slot, and grow
  // as far as the slot allows. Growth moves forward, so depth needs no reserve, and miniatures may
  // overhang the open shelf front a little.
  const grow = 0.22, minGrow = 0.1, overhang = 0.04, advance = 0.012, gap = 0.016;
  const miniatureModels = projects.map((el, i) => {
    const spec = PROJECT_MODELS[el.dataset.item ?? ''];
    const src = spec && source[spec.asset];
    if (!src) return;
    const model = src.clone(true);
    model.rotation.y = MathUtils.degToRad(spec.yaw ?? 0);
    const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
    const n = Math.min(perTier, projects.length - Math.floor(i / perTier) * perTier);
    const maxSize = new Vector3(shelfW / n - 2 * gap, (shelfAsset.tier_clear ?? 0.33) - 2 * gap, shelfAsset.size[1] - 2 * gap - advance + overhang);
    const room = Math.min(maxSize.x / size.x, maxSize.y / size.y);
    const fit = Math.min(1, room / (1 + minGrow), maxSize.z / size.z);
    const s = spec.lifeSize ? grow : Math.min(grow, room / fit - 1);
    return { model, bounds, fit, s, lifeSize: spec.lifeSize };
  });
  const projectDisplays = projects.map((el, i) => {
    const tier = tiers[Math.floor(i / perTier)] ?? tiers[tiers.length - 1];
    const k = i % perTier, n = Math.min(perTier, projects.length - Math.floor(i / perTier) * perTier);
    const f = new Group();
    f.name = `project-${el.dataset.item}`;
    f.userData.section = 'projects';
    f.userData.item = el.dataset.item;
    shelf.add(f);
    const slotX = (k - (n - 1) / 2) * (shelfW / n);
    const miniature = miniatureModels[i];
    if (miniature) {
      const { model, bounds: b, fit, s, lifeSize } = miniature;
      const center = b.getCenter(new Vector3());
      const scale = lifeSize ? 1 : fit;
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -b.min.y * scale, -center.z * scale);
      dress(model);
      f.add(model);
      const halfDepth = (b.max.z - b.min.z) * scale / 2;
      const backClearance = -shelfAsset.size[1] / 2 + 0.012 + gap;
      f.position.set(slotX, tier + 0.003, Math.max(-advance / 2, backClearance + halfDepth));
      return { id: el.dataset.item, pop: poppable(f, { p: new Vector3(0, 0, advance + halfDepth * s), s }) };
    }
    const border = new Mesh(new BoxGeometry(fw, fh, 0.018), frameMat);
    border.castShadow = true;
    const { x, tex, c } = canvasTex(384, 384 * ((fh - 0.03) / (fw - 0.03)));
    const pic = new Mesh(new PlaneGeometry(fw - 0.03, fh - 0.03), new MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    pic.position.z = 0.0095;
    f.add(border, pic);
    f.position.set(slotX, tier + fh / 2 + 0.005, -0.03);
    f.rotation.x = -0.16;
    if (el.dataset.screenImg)
      loadImg(el.dataset.screenImg).then((img) => {
        fit(x, img, c.width, c.height, 'cover');
        tex.needsUpdate = true;
        dirty = true;
      });
    return { id: el.dataset.item, pop: poppable(f, { p: new Vector3(0, 0.02, 0.07), r: 0.2, s: 0.1 }) };
  });
  let hoveredProject: string | undefined;
  const updateProjectPops = () => projectDisplays.forEach(({ id, pop }) => {
    pop.t = (hoveredProject ? id === hoveredProject : active === 'projects' && id === item) ? 1 : 0;
  });
  // Display lights: an LED strip under the front edge of every board, lighting the tier below it.
  // A strip is a line of light, so instead of a spot (a round pool) each one is a line light added in
  // the shader of the shelf's own materials: even along its length, fading with distance, shining
  // down and back, and only inside its own tier (the boards would block it). Three's RectAreaLight
  // would do this too, but its lookup tables cost ~110 KB. Like the monitor light bars, the strips
  // follow the theme (on at night).
  const clear = shelfAsset.tier_clear ?? 0.33, depth = shelfAsset.size[1];
  const allTiers = (shelfAsset.tiers ?? []).slice().sort((a, b) => a - b);
  const shelfGlow = new MeshStandardMaterial({ color: new Color('#fff4e0'), emissive: new Color('#ffd9a0'), emissiveIntensity: 0 });
  const stripLight = { value: 0 };
  const stripA: Vector3[] = [], stripB: Vector3[] = [], stripY: Vector2[] = [];
  shelf.updateWorldMatrix(true, true);
  for (const tier of allTiers) {
    const y = tier + clear - 0.004, z = depth / 2 - 0.035, half = (shelfW - 0.04) / 2;
    const strip = new Mesh(new BoxGeometry(half * 2, 0.006, 0.012), shelfGlow);
    strip.position.set(0, y, z);
    strip.raycast = () => {};
    shelf.add(strip);
    stripA.push(shelf.localToWorld(new Vector3(-half, y, z)));
    stripB.push(shelf.localToWorld(new Vector3(half, y, z)));
    stripY.push(new Vector2(shelf.localToWorld(new Vector3(0, tier, 0)).y - 0.01, shelf.localToWorld(new Vector3(0, y, 0)).y + 0.01));
  }
  // The direction the strips shine: down and towards the back panel.
  const stripDir = new Vector3(0, -1, -0.8).normalize().transformDirection(shelf.matrixWorld);
  const N_STRIPS = stripA.length;
  // How far past each end of a strip (as a fraction of its length) the side panels' inner faces are.
  const stripEnd = ((shelfAsset.size[0] / 2 - 0.02 - (shelfW - 0.04) / 2) / (shelfW - 0.04)) + 0.005;
  const stripLit = (m: MeshStandardMaterial) => {
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey();
    m.onBeforeCompile = (sh, r) => {
      prev.call(m, sh, r);
      Object.assign(sh.uniforms, {
        uStripLight: stripLight,
        uStripA: { value: stripA },
        uStripB: { value: stripB },
        uStripY: { value: stripY },
        uStripDir: { value: stripDir },
        uStripEnd: { value: stripEnd },
      });
      sh.vertexShader = 'varying vec3 vStripW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vStripW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader =
        `varying vec3 vStripW;
uniform float uStripLight;
uniform vec3 uStripA[${N_STRIPS}];
uniform vec3 uStripB[${N_STRIPS}];
uniform vec2 uStripY[${N_STRIPS}];
uniform vec3 uStripDir;
uniform float uStripEnd;
` +
        sh.fragmentShader.replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
  if (uStripLight > 0.0) {
    vec3 nW = inverseTransformDirection(normal, viewMatrix);
    float sum = 0.0;
    for (int i = 0; i < ${N_STRIPS}; i++) {
      if (vStripW.y < uStripY[i].x || vStripW.y > uStripY[i].y) continue;
      vec3 ab = uStripB[i] - uStripA[i];
      // Along the strip: nothing past the side panels' inner faces, so the walls beside the shelf stay dark.
      float t = dot(vStripW - uStripA[i], ab) / dot(ab, ab);
      if (t < -uStripEnd || t > 1.0 + uStripEnd) continue;
      vec3 q = uStripA[i] + ab * clamp(t, 0.0, 1.0);
      vec3 d = q - vStripW;
      float r = length(d);
      vec3 l = d / max(r, 1e-4);
      sum += max(dot(nW, l), 0.0) * max(dot(-l, uStripDir), 0.0) / (1.0 + r * r / 0.05);
    }
    reflectedLight.directDiffuse += vec3(1.0, 0.86, 0.66) * diffuseColor.rgb * sum * uStripLight;
  }`,
        );
    };
    m.customProgramCacheKey = () => `${prevKey}|strip`;
    return m;
  };
  // The shelf's meshes (and the frames on it) get their own copies of the patched materials.
  const stripMats = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  const withStrip = (m: MeshStandardMaterial) => {
    if (!stripMats.has(m)) {
      const c = m.clone();
      if (m.customProgramCacheKey() === 'baked-ao') withAO(c);
      stripMats.set(m, stripLit(c));
    }
    return stripMats.get(m)!;
  };
  wallMats.forEach(stripLit);
  shelf.traverse((o) => {
    if (!(o instanceof Mesh) || o.material === shelfGlow) return;
    o.material = Array.isArray(o.material)
      ? o.material.map((m) => (m instanceof MeshStandardMaterial ? withStrip(m) : m))
      : o.material instanceof MeshStandardMaterial
        ? withStrip(o.material)
        : o.material;
  });

  // Pinboard cards: a sticky note (or a photo) per playground item, pinned on the `board` plane.
  const boardGroup = placed[SCREENS.pinboard];
  const board = boardGroup.getObjectByName('board')!;
  // The board and its cards cast no real-time shadows (at the close-up they came out blocky and
  // noisy); a soft shadow painted on the wall behind the board stands in for them.
  boardGroup.traverse((o) => (o.castShadow = false));
  {
    const fb = new Box3().setFromObject(boardGroup), fs = fb.getSize(new Vector3()), m = 0.16;
    const W = Math.max(fs.x, fs.z) + 2 * m, Hs = fs.y + 2 * m;
    const { c, x, tex } = canvasTex(512, (512 * Hs) / W);
    const k = c.width / W;
    // Only the blurred shadow of a rect drawn off the canvas lands on it.
    x.shadowColor = 'rgba(20, 16, 40, 0.5)';
    x.shadowBlur = 0.07 * k;
    x.shadowOffsetX = c.width;
    x.shadowOffsetY = 0.025 * k;
    x.fillRect(m * k - c.width, m * k, c.width - 2 * m * k, c.height - 2 * m * k);
    const wallShadow = new Mesh(new PlaneGeometry(W, Hs), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    const fc = fb.getCenter(new Vector3());
    wallShadow.position.set(fc.x, fc.y, fb.min.z + 0.002);
    wallShadow.raycast = () => {};
    scene.add(wallShadow);
    onWall.push({ n: inward.N, o: wallShadow });
  }
  const bb = new Box3().setFromObject(board);
  const bc = boardGroup.worldToLocal(bb.getCenter(new Vector3()));
  const bsize = bb.getSize(new Vector3());
  const bw = Math.max(bsize.x, bsize.z), bh = bsize.y;
  const pins = pageItems('playground');
  const cols = Math.min(4, Math.max(1, pins.length)), rows = Math.ceil(pins.length / cols);
  const cs = Math.min(0.26, bw / cols - 0.08, bh / rows - 0.08);
  const cards = pins.map((el, i) => {
    const { x, tex } = canvasTex(256, 256);
    const color = NOTE_COLORS[i % NOTE_COLORS.length];
    const note = (img?: HTMLImageElement) => {
      x.fillStyle = img ? '#ffffff' : color;
      x.fillRect(0, 0, 256, 256);
      if (img) {
        x.save();
        x.beginPath();
        x.rect(16, 16, 224, 176);
        x.clip();
        fit(x, img, 256, 208, 'cover');
        x.restore();
      } else {
        x.fillStyle = '#6b6f99';
        x.font = FONT(600, 20);
        x.fillText((el.dataset.screenType ?? '').toUpperCase(), 22, 44);
      }
      x.fillStyle = INK;
      x.font = FONT(600, img ? 26 : 34);
      wrap(x, el.dataset.screenTitle ?? '', 212, 2).forEach((l, j) => x.fillText(l, 22, (img ? 228 : 140) + j * 38));
      if (!img && el.dataset.screenCaption) {
        x.fillStyle = '#4a4e7a';
        x.font = FONT(500, 21);
        wrap(x, el.dataset.screenCaption, 212, 2).forEach((l, j) => x.fillText(l, 22, 196 + j * 26));
      }
      tex.needsUpdate = true;
      dirty = true;
    };
    note();
    if (el.dataset.screenImg) loadImg(el.dataset.screenImg).then(note, () => {});
    // The distance card fills in its caption, then a still of its map, once the page has located the
    // visitor (Pinboard.astro).
    window.addEventListener('pinchange', (e) => {
      if ((e as CustomEvent<string>).detail !== el.dataset.item) return;
      if (el.dataset.screenImg) loadImg(el.dataset.screenImg).then(note, () => {});
      else note();
    });
    const card = new Mesh(new BoxGeometry(cs, cs, 0.004), [
      ...Array(4).fill(frameMat),
      new MeshStandardMaterial({ map: tex, roughness: 0.9 }),
      frameMat,
    ]);
    const pin = new Mesh(new SphereGeometry(0.014, 12, 10), new MeshStandardMaterial({ color: new Color(PIN_COLORS[i % 3]) }));
    pin.position.set(0, cs * 0.4, 0.012);
    card.add(pin);
    // The card sits in a slot, which the board view drags around, so the pop-out keeps its own transform.
    const slot = new Group();
    const col = i % cols, row = Math.floor(i / cols);
    slot.position.set(bc.x + (col - (cols - 1) / 2) * (bw / cols), bc.y - (row - (rows - 1) / 2) * (bh / rows), bc.z + 0.006);
    card.rotation.z = [-0.06, 0.05, -0.03, 0.04, -0.05, 0.03][i % 6];
    card.userData.section = 'playground';
    slot.add(card);
    boardGroup.add(slot);
    return { id: el.dataset.item, slot, pin, pop: poppable(card, { p: new Vector3(0, 0, 0.03), s: 0.15 }) };
  });

  const updateScreens = () => {
    const inView = (section: string) => (active === section && item ? document.querySelector<HTMLElement>(`#${section} [data-item="${CSS.escape(item)}"]`) : null);

    const paper = inView('research');
    if (!paper) {
      scrPaper.draw(terminal);
      scrInfo.draw(plain);
    } else {
      const { screenTitle = '', screenVenue = '', screenImg, screenVideo } = paper.dataset;
      scrInfo.draw(info(screenTitle, screenVenue));
      if (screenVideo && !opts.reduceMotion) scrPaper.video(screenVideo, () => scrPaper.draw(terminal));
      else if (screenImg) scrPaper.image(screenImg, 'contain', terminal);
      else scrPaper.draw(terminal);
    }

    const game = inView('games');
    if (!game) scrTv.draw(pressStart);
    else if (game.dataset.screenVideo && !opts.reduceMotion) scrTv.video(game.dataset.screenVideo, () => scrTv.draw(pressStart));
    else if (game.dataset.screenImg) scrTv.image(game.dataset.screenImg, 'cover', pressStart);
    else scrTv.draw(pressStart);

    const on = (list: { id?: string; pop: Pop }[], section: string) => list.forEach((b) => (b.pop.t = active === section && b.id === item ? 1 : 0));
    on(boxes, 'games');
    updateProjectPops();
    on(cards, 'playground');
    dirty = true;
  };

  // --- camera shots from the config
  const shot = (d: ShotDef): Shot => {
    if (d.center) return { t: P(...d.center), dir: PD(d.dir), r: d.r ?? 3, far: d.far, fitWidth: d.fitWidth };
    const b = bounds(d.frame ?? []);
    const t = b.getCenter(new Vector3());
    t.y += d.lift ?? 0;
    const s = b.getSize(new Vector3());
    return { t, dir: PD(d.dir), r: Math.max(s.x, s.y, s.z) * 0.5 * (d.pad ?? 1.35) + 0.15, far: d.far };
  };
  const shots = Object.fromEntries(Object.entries(SHOTS).map(([k, d]) => [k, shot(d)])) as Record<string, Shot>;
  const closeShots = Object.fromEntries(Object.entries(CLOSEUPS).map(([k, c]) => [k, shot(c.shot)])) as Record<string, Shot>;

  const labels = document.createElement('div');
  labels.className = 'room-pins';
  labels.hidden = true;
  const shownLabels = LABELS.filter(([k]) => document.getElementById(k) || (CLOSEUPS[k] && placed[CLOSEUPS[k].object]));
  labels.innerHTML = shownLabels.map(([k, t]) => `<button type="button" class="room-pin" data-go="${k}">${t}</button>`).join('');
  labels.addEventListener('pointerover', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (b) hover(anchorObj[b.dataset.go!]);
  });
  labels.addEventListener('pointerout', (e) => {
    if ((e.target as HTMLElement).closest('[data-go]')) hover();
  });
  labels.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (b) pick(anchorObj[b.dataset.go!], b.dataset.go!, false);
  });
  frame.append(labels);
  // Labels show for 2 s when the room opens, then fade; hovering an object (or the label itself)
  // brings its label back, and it fades 2 s after the pointer leaves.
  const labelTimers = new Map<string, number>();
  const labelBtn = (k: string) => labels.querySelector<HTMLElement>(`[data-go="${k}"]`);
  const showLabel = (k: string) => {
    clearTimeout(labelTimers.get(k));
    labelBtn(k)?.classList.add('on');
  };
  const hideLabel = (k: string, ms = 2000) => {
    clearTimeout(labelTimers.get(k));
    labelTimers.set(k, window.setTimeout(() => labelBtn(k)?.classList.remove('on'), ms));
  };
  const anchors = Object.fromEntries(LABELS.map(([k, , a]) => [k, top(bounds([a]), 0.12)]));
  const anchorObj = Object.fromEntries(LABELS.map(([k, , a]) => [k, placed[a]]));

  // --- framing, tweening, render on demand
  const camT = new Vector3();
  type Tween = {
    t0: number; ms: number; fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3;
    ease: (x: number) => number;
    /** Shot this tween heads to, so a repeated `go` to it doesn't restart it. */
    id: string;
    done?: () => void;
    /** Follow another animation's eased progress instead of the clock (see `Clock`). */
    clock?: Clock;
    fromFov: number;
    toFov: number;
  };
  let tween: Tween | null = null;
  const tweenTo = (q: { t: Vector3; p: Vector3; fov?: number }, ms: number, ease: (x: number) => number, id: string, done?: () => void, clock?: Clock) => {
    tween = { t0: performance.now(), ms, fromT: camT.clone(), fromP: cam.position.clone(), toT: q.t, toP: q.p, ease, id, done, clock,
      fromFov: cam.fov, toFov: q.fov ?? ROOM_FOV };
  };
  // Framing depends on the aspect; opening and closing the full-screen room pass the aspect the
  // canvas will have at the end of the morph.
  const place = (s: Shot, aspect = cam.aspect) => {
    const v = MathUtils.degToRad(ROOM_FOV) / 2, h = Math.atan(Math.tan(v) * aspect);
    const distance = Math.min(s.far ?? Infinity, s.r / Math.sin(s.fitWidth ? h : Math.min(v, h)));
    const fov = s.fitWidth ? Math.max(ROOM_FOV, MathUtils.radToDeg(2 * Math.atan(Math.tan(Math.asin(s.r / distance)) / aspect))) : ROOM_FOV;
    return { t: s.t.clone(), p: s.t.clone().addScaledVector(s.dir, distance), fov };
  };
  const jump = (s: Shot) => {
    const q = place(s);
    camT.copy(q.t);
    cam.position.copy(q.p);
    setFov(q.fov);
    cam.lookAt(camT);
    dirty = true;
  };
  const go = (id: string) => {
    const s = shots[id];
    if (!s) return;
    if (id !== active) {
      active = id;
      updateScreens();
    }
    if (full || tween?.id === id) return;
    if (opts.reduceMotion) return jump(s);
    tweenTo(place(s), 1100, easeInOut, id);
  };
  const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  // cubic-bezier(0.22, 1, 0.36, 1), the same ease-out as the frame morph in RoomPanel.astro.
  const easeOut = (() => {
    const [x1, y1, x2, y2] = [0.22, 1, 0.36, 1];
    const at = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (x: number) => {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const d = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t;
        if (Math.abs(d) < 1e-6) break;
        t = Math.min(1, Math.max(0, t - (at(t, x1, x2) - x) / d));
      }
      return at(t, y1, y2);
    };
  })();

  let theme = opts.theme;
  // Lights come on with the dark theme; the nixie clock is on in both (it's a clock, not a lamp).
  const onFor = (k: Switch, t: 'light' | 'dark') => k === 'clock' || t === 'dark';
  const sw = Object.fromEntries(Object.keys(SWITCH_ON).map((k) => [k, onFor(k as Switch, theme)])) as Record<Switch, boolean>;
  const levels = () => ({
    ...LEVELS[theme],
    ...(Object.fromEntries(Object.entries(SWITCH_ON).map(([k, v]) => [k, sw[k as Switch] ? v : 0])) as Record<Switch, number>),
  });
  let cur = levels();
  let target = levels();
  let fading = false;
  const flip = (k: Switch) => {
    sw[k] = !sw[k];
    target = levels();
    fading = true;
    if (opts.reduceMotion) cur = { ...target };
    dirty = true;
  };
  const setTheme = (t: 'light' | 'dark') => {
    theme = t;
    for (const k of Object.keys(sw) as Switch[]) sw[k] = onFor(k, t);
    for (const b of blinds) b.t = t === 'dark' ? 1 : 0.06;
    target = levels();
    fading = true;
    hemi.color.set(t === 'dark' ? 0x7d84ff : 0xffffff);
    scene.environment = envs[t];
    sun.color.set(t === 'dark' ? 0x9fb2ff : 0xffffff);
    // Both come in through the west windows (the only way in); the sun a little higher than the moon.
    sun.position.copy(center.clone().add(t === 'dark' ? new Vector3(-6, 3.65, 1) : new Vector3(-5.5, 4.2, 2)));
    if (opts.reduceMotion) {
      cur = { ...target };
      fading = false;
    }
    dirty = true;
  };
  setTheme(opts.theme);
  cur = { ...target };
  // The first theme sets the blinds where they are, without rolling them on load.
  for (const b of blinds) {
    b.k = b.t;
    b.cloth.scale.y = b.k;
    if (b.bar) b.bar.position.y = b.barY + (1 - b.k) * b.len;
  }

  // --- full-screen orbit mode
  let full = false;
  const controls = new OrbitControls(cam, canvas);
  Object.assign(controls, {
    enabled: false, enablePan: false, enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.55,
    minDistance: 3, maxDistance: 16, minPolarAngle: 0.45, maxPolarAngle: 1.35,
    minAzimuthAngle: -0.4, maxAzimuthAngle: Math.PI / 2 + 0.4,
  });
  controls.addEventListener('change', () => (dirty = true));
  // Opening: the camera pulls back from the section shot to the room overview in `ms` (the frame
  // grows at the same time); orbiting and labels start once it has arrived.
  const enterFull = (ms = 0, aspect = cam.aspect, clock?: Clock) => {
    full = true;
    loadPhysics();
    // The bounding-sphere fit is too cautious on tall portrait screens; tighten it there.
    const q = place({ ...shots.top, r: shots.top.r * (aspect < 0.8 ? 0.78 : 1) }, aspect);
    controls.maxDistance = Math.max(16, q.p.distanceTo(q.t) * 1.3);
    const arrive = () => {
      if (!full) return;
      controls.target.copy(q.t);
      controls.enabled = true;
      labels.hidden = false;
      for (const [k] of shownLabels) {
        showLabel(k);
        hideLabel(k);
      }
      canvas.style.cursor = 'grab';
      dirty = true;
    };
    if (ms && !opts.reduceMotion) tweenTo(q, ms, easeOut, 'full', arrive, clock);
    else {
      tween = null;
      setFov(ROOM_FOV);
      cam.position.copy(q.p);
      camT.copy(q.t);
      cam.lookAt(camT);
      arrive();
    }
  };
  // Closing: back to the shot of `section` (the one picked in the room) or of the current section.
  const exitFull = (ms = 0, section?: string, aspect = cam.aspect, clock?: Clock) => {
    full = false;
    flying = false;
    if (focused) closeupHooks[focused]?.leave?.();
    focused = null;
    hover();
    for (const [k] of shownLabels) {
      clearTimeout(labelTimers.get(k));
      labelBtn(k)?.classList.remove('on');
    }
    if (controls.enabled) camT.copy(controls.target); // otherwise the opening tween was still running
    controls.enabled = false;
    labels.hidden = true;
    canvas.style.cursor = '';
    if (section && section in shots && section !== active) {
      active = section;
      updateScreens();
    }
    const q = place(shots[active], aspect);
    if (ms && !opts.reduceMotion) tweenTo(q, ms, easeOut, active, undefined, clock);
    else {
      tween = null;
      setFov(ROOM_FOV);
      cam.position.copy(q.p);
      camT.copy(q.t);
      cam.lookAt(camT);
      dirty = true;
    }
  };

  // Click an object in full mode → navigate to its section.
  const ray = new Raycaster(), ndc = new Vector2();
  const shown = (o: Object3D | null) => {
    for (; o; o = o.parent) if (!o.visible || o.userData.ghost) return false;
    return true;
  };
  const hitAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    return ray.intersectObjects(scene.children, true).find((h) => shown(h.object))?.object;
  };

  // Hover bounce: interactive objects (placements with a section) spring up a little under the
  // pointer, with a bit of overshoot, and spring back when it leaves.
  // Riders (a light bar on its monitor) count as part of what they ride on.
  const placedSet = new Set(PLACEMENTS.filter((p) => !p.on && placed[p.id]).map((p) => placed[p.id]));
  const projectSet = new Set(projectDisplays.map((p) => p.pop.o));
  // Close-up targets can be clicked without bouncing the furniture and everything on it.
  const interactiveOf = (o: Object3D | null) => {
    for (; o; o = o.parent) {
      if (projectSet.has(o)) return o;
      if (placedSet.has(o)) return o.userData.closeup || (o.userData.section && o.userData.bounce) ? o : undefined;
    }
  };
  type Spring = { o: Object3D; base: number; s: number; v: number; t: number };
  const springs = new Map<Object3D, Spring>();
  let hovered: Object3D | undefined;
  const hover = (o?: Object3D) => {
    if (o === hovered) return;
    // Objects that don't bounce have no spring, so only spring back the ones that do.
    const prev = hovered && springs.get(hovered);
    if (prev) prev.t = 1;
    const prevSection = hovered?.userData.section as string | undefined;
    if (prevSection && prevSection !== o?.userData.section) hideLabel(prevSection);
    if (o?.userData.section) showLabel(o.userData.section);
    hovered = o;
    hoveredProject = o && projectSet.has(o) ? o.userData.item : undefined;
    updateProjectPops();
    dirty = true;
    if (!o) return;
    // Displays already have a safe pop. Keep the bookcase itself fixed against the wall, and
    // never add the free object's overshooting spring to a miniature or its parent shelf.
    if (projectSet.has(o) || o === shelf || o.userData.closeup === 'desk' || !o.userData.bounce) return;
    const sp = springs.get(o) ?? { o, base: o.scale.x, s: 1, v: 0, t: 1 };
    sp.t = 1.06;
    if (opts.reduceMotion) sp.s = sp.t;
    springs.set(o, sp);
    dirty = true;
  };
  const stepSprings = (dt: number) => {
    let moving = false;
    for (const sp of springs.values()) {
      if (Math.abs(sp.t - sp.s) < 1e-4 && Math.abs(sp.v) < 1e-3) continue;
      // Stiff, lightly damped spring: quick, with a small overshoot (the "Q-bounce").
      const a = 520 * (sp.t - sp.s) - 18 * sp.v;
      sp.v += a * dt;
      sp.s += sp.v * dt;
      sp.o.scale.setScalar(sp.base * sp.s);
      moving = true;
    }
    return moving;
  };
  let down: [number, number] | null = null;
  // Dragging the chair spins its top instead of orbiting the room. This runs in the capture phase,
  // ahead of OrbitControls' own listener on the canvas, so it can keep the orbit from starting.
  let spin: { id: number; x: number; t: number; v: number } | null = null;
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!full || focused || flying || !chairTop || !isIn(hitAt(e) ?? null, chairTop)) return;
      e.stopImmediatePropagation();
      canvas.setPointerCapture(e.pointerId);
      spin = { id: e.pointerId, x: e.clientX, t: performance.now(), v: 0 };
      chairV = 0;
      canvas.style.cursor = 'grabbing';
    },
    { capture: true },
  );
  const endSpin = (e: PointerEvent) => {
    if (!spin || e.pointerId !== spin.id) return false;
    // Only keep the momentum if the pointer was still moving when it let go.
    chairV = performance.now() - spin.t < 80 ? spin.v : 0;
    spin = null;
    canvas.style.cursor = 'ew-resize';
    dirty = true;
    return true;
  };
  canvas.addEventListener('pointercancel', endSpin);
  canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener('pointercancel', () => (down = null));
  canvas.addEventListener('pointerup', (e) => {
    if (endSpin(e) || !down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (!full || flying || (focused && focused !== 'desk') || moved >= 6) return;
    const hit = hitAt(e) ?? null;
    const o = interactiveOf(hit);
    // First click explores the desk; once inside, its actual switches take precedence.
    if (!focused && o?.userData.closeup === 'desk') return pick(o);
    const light = switchOf(hit);
    if (light) return flip(light);
    const blind = blindOf(hit);
    if (blind) {
      blind.t = blind.t > 0.5 ? 0.06 : 1;
      dirty = true;
      return;
    }
    if (!focused && o) pick(o, o.userData.section);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (spin && e.pointerId === spin.id) {
      const now = performance.now(), d = (e.clientX - spin.x) * 0.012;
      chairTop!.rotation.y += d;
      spin.v = d / Math.max(0.008, (now - spin.t) / 1000);
      Object.assign(spin, { x: e.clientX, t: now });
      dirty = true;
      return;
    }
    if (!full || down || flying || (focused && focused !== 'desk')) return;
    const hit = hitAt(e) ?? null;
    if (focused) {
      if (focused === 'desk') canvas.style.cursor = switchOf(hit) || blindOf(hit) ? 'pointer' : '';
      return;
    }
    const o = interactiveOf(hit);
    hover(o);
    canvas.style.cursor = o || blindOf(hit) || switchOf(hit) ? 'pointer' : chairTop && isIn(hit, chairTop) ? 'ew-resize' : 'grab';
  });
  canvas.addEventListener('pointerleave', () => hover());

  // --- toys on the bed: the pillow and the school plushes (DECOR.toys). In the room they can be
  // picked up, carried over the bed and thrown; cannon-es (room-physics.ts, loaded the first time the
  // room opens) lets them tumble and knock into each other. Thrown, they stay on the bed (it has
  // invisible walls); carried past its edge, the toy is set down there. A landing squashes the toy
  // and makes the mattress dip. Colliders come from the manifest (Blender axes x, y, z → x, z, −y).
  const bedObj = placed[DECOR.bed] ?? null;
  const mattressObj = bedObj?.getObjectByName('mattress') ?? null;
  type Collider = number[][];
  const assetInfo = (id: string) =>
    manifest.assets[PLACEMENTS.find((p) => p.id === id)!.asset] as {
      size: number[]; collider?: Collider; collider_spheres?: Collider; pillow_size?: number[]; pillow_pivot?: number[];
      pillow_collider_spheres?: Collider; mattress_top?: number; mattress_area?: number[][];
    };
  // Spheres if the asset has them (they hug the outline and let a plush topple), else boxes, else
  // one box the size of the asset. `at` is the toy's pivot in the same (Blender) coordinates.
  const shapesOf = (info: { spheres?: Collider; boxes?: Collider }, size: number[], at = [0, 0, 0]): ToyShape[] =>
    info.spheres?.length
      ? info.spheres.map(([cx, cy, cz, r]) => ({ c: [cx - at[0], cz - at[2], -(cy - at[1])], r }))
      : info.boxes?.length
        ? info.boxes.map(([cx, cy, cz, sx, sy, sz]) => ({ c: [cx - at[0], cz - at[2], -(cy - at[1])], s: [sx, sz, sy] }))
        : [{ c: [0, size[2] / 2, 0], s: [size[0], size[2], size[1]] }];
  const toys: Toy[] = [];
  if (bedObj) {
    const pillowObj = bedObj.getObjectByName('pillow');
    // The pillow leaves the bed's hierarchy for the scene, so physics can move it in world space.
    if (pillowObj) {
      scene.attach(pillowObj);
      const b = assetInfo(DECOR.bed);
      toys.push({ obj: pillowObj, shapes: shapesOf({ spheres: b.pillow_collider_spheres }, b.pillow_size ?? [0.6, 0.52, 0.12], b.pillow_pivot), mass: 0.5 });
    }
    for (const id of DECOR.toys) {
      const a = placed[id] && assetInfo(id);
      if (a) toys.push({ obj: placed[id], shapes: shapesOf({ spheres: a.collider_spheres, boxes: a.collider }, a.size), mass: 0.3 });
    }
  }
  const bedTop = bedObj ? assetInfo(DECOR.bed).mattress_top ?? 0.63 : 0;
  const [[ax0, ay0], [ax1, ay1]] = bedObj ? assetInfo(DECOR.bed).mattress_area ?? [[-0.465, -0.931], [0.465, 0.914]] : [[0, 0], [0, 0]];
  const bedArea = { x0: ax0, x1: ax1, z0: -ay1, z1: -ay0 };
  const TOY_LIFT = 0.28;
  const dip = { s: 0, v: 0 };
  const squash = toys.map(() => ({ s: 0, v: 0 }));
  const toyScale = toys.map((t) => t.obj.scale.clone());
  let phys: ReturnType<typeof createToyWorld> | null = null;
  let physLoading = false;
  const loadPhysics = () => {
    if (phys || physLoading || !bedObj || !toys.length) return;
    physLoading = true;
    import('./room-physics')
      .then(({ createToyWorld }) => {
        bedObj.updateMatrixWorld(true);
        phys = createToyWorld(
          { matrix: bedObj.matrixWorld.clone(), quaternion: bedObj.getWorldQuaternion(new Quaternion()), top: bedTop, area: bedArea },
          toys,
          (i, speed, onMattress) => {
            if (opts.reduceMotion) return;
            squash[i].v += Math.min(speed, 4) * 1.4;
            if (onMattress) dip.v += Math.min(speed, 4) * 0.25;
            dirty = true;
          },
        );
      })
      .catch((err) => console.warn('Toy physics failed to load; the toys stay put.', err));
  };
  const toyAt = (hit: Object3D | null) => toys.findIndex((t) => isIn(hit, t.obj));
  const topPlane = new Plane(), topHit = new Vector3();
  // Where the pointer ray (set by `hitAt`) meets the mattress top (world), or null.
  const onTop = () => {
    const h = bedObj!.localToWorld(new Vector3(0, bedTop, 0)).y;
    topPlane.set(new Vector3(0, 1, 0), -h);
    return ray.ray.intersectPlane(topPlane, topHit);
  };
  // Whether a world point is over the mattress (with a little slack past its edge).
  const overBed = (p: Vector3) => {
    const l = bedObj!.worldToLocal(p.clone()), m = 0.1;
    return l.x >= bedArea.x0 - m && l.x <= bedArea.x1 + m && l.z >= bedArea.z0 - m && l.z <= bedArea.z1 + m;
  };
  let toyGrab: { id: number; off: Vector3; y: number } | null = null;
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!phys || !full || focused || flying) return;
      const i = toyAt(hitAt(e) ?? null);
      if (i < 0 || !onTop()) return;
      e.stopImmediatePropagation();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
      const p = toys[i].obj.position;
      toyGrab = { id: e.pointerId, off: new Vector3(p.x - topHit.x, 0, p.z - topHit.z), y: topHit.y + TOY_LIFT };
      phys.grab(i, new Vector3(p.x, toyGrab.y, p.z));
      canvas.style.cursor = 'grabbing';
      dirty = true;
    },
    { capture: true },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!toyGrab || e.pointerId !== toyGrab.id) return;
      e.stopImmediatePropagation();
      hitAt(e);
      if (!onTop()) return;
      // Carried past the edge: set it down at the nearest edge.
      if (!overBed(topHit)) {
        phys!.setDown(topHit);
        toyGrab = null;
        canvas.style.cursor = 'grab';
        return;
      }
      phys!.carry(topHit.add(toyGrab.off).setY(toyGrab.y));
      dirty = true;
    },
    { capture: true },
  );
  const endToyGrab = (e: PointerEvent) => {
    if (!toyGrab || e.pointerId !== toyGrab.id) return;
    e.stopImmediatePropagation();
    toyGrab = null;
    phys!.release();
    canvas.style.cursor = 'grab';
    dirty = true;
  };
  canvas.addEventListener('pointerup', endToyGrab, { capture: true });
  canvas.addEventListener('pointercancel', endToyGrab, { capture: true });

  // A spring that returns to 0; `k` stiffness, `c` damping.
  const stepSpring = (sp: { s: number; v: number }, dt: number, k: number, c: number) => {
    if (Math.abs(sp.s) < 1e-4 && Math.abs(sp.v) < 1e-3) return (sp.s = sp.v = 0), false;
    sp.v += (-k * sp.s - c * sp.v) * dt;
    sp.s += sp.v * dt;
    return true;
  };
  const stepToys = (dt: number) => {
    if (!toys.length || !dt) return false;
    let moving = !!phys?.step(dt);
    squash.forEach((sq, i) => {
      if (!stepSpring(sq, dt, 260, 14)) return;
      sq.s = MathUtils.clamp(sq.s, -0.25, 0.35);
      const b = toyScale[i];
      toys[i].obj.scale.set(b.x * (1 + sq.s * 0.35), b.y * (1 - sq.s), b.z * (1 + sq.s * 0.35));
      moving = true;
    });
    if (stepSpring(dip, dt, 180, 9)) {
      dip.s = MathUtils.clamp(dip.s, -0.04, 0.08);
      if (mattressObj) mattressObj.scale.y = 1 - dip.s;
      moving = true;
    }
    return moving;
  };

  // --- trash-can basketball (the `hoops` close-up): a bin past the foot of the bed and a backboard
  // taped on the wall above it. The game (room-hoops.ts: projectiles, aiming, physics, score) loads
  // the first time the close-up opens.
  const binObj = placed[HOOPS.bin] ?? null;
  let backboardBox: Box3 | undefined;
  if (binObj) {
    const b = new Box3().setFromObject(binObj), W = 0.84, Hb = 0.54;
    const { c, x, tex } = canvasTex(512, (512 * Hb) / W);
    const k = c.width / W, tw = 0.024 * k;
    // A strip of tape from (x0, y0) to (x1, y1) in meters on the board, its ends running a little
    // past the corners and laid slightly crooked, like by hand.
    let seed = 5;
    const strip = (x0: number, y0: number, x1: number, y1: number) => {
      seed = (seed * 9301 + 49297) % 233280;
      const a = Math.atan2(y1 - y0, x1 - x0) + (seed / 233280 - 0.5) * 0.012, len = Math.hypot(x1 - x0, y1 - y0) * k + tw * 1.4;
      x.save();
      x.translate(((x0 + x1) / 2) * k, c.height - ((y0 + y1) / 2) * k);
      x.rotate(-a);
      x.fillRect(-len / 2, -tw / 2, len, tw);
      x.restore();
    };
    x.fillStyle = '#1d1e2b';
    const m = 0.03, sq = [0.34, 0.24], sy = 0.07;
    strip(m, m, W - m, m);
    strip(m, Hb - m, W - m, Hb - m);
    strip(m, m, m, Hb - m);
    strip(W - m, m, W - m, Hb - m);
    // The small square over the rim.
    const sx = (W - sq[0]) / 2;
    strip(sx, sy, sx + sq[0], sy);
    strip(sx, sy + sq[1], sx + sq[0], sy + sq[1]);
    strip(sx, sy, sx, sy + sq[1]);
    strip(sx + sq[0], sy, sx + sq[0], sy + sq[1]);
    const tape = new Mesh(
      new PlaneGeometry(W, Hb),
      // Solid tape with cut-out empty pixels belongs in the opaque pass. Alpha blending rendered
      // these lines after the held outline and let the background draw across its silhouette.
      new MeshStandardMaterial({ map: tex, alphaTest: 0.5, alphaToCoverage: true, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    // Like a backboard: the LOWER EDGE of its target rectangle meets the rim's top plane.
    // The old whole-board-above-rim placement left the target floating ~12 cm too high.
    tape.position.set((b.min.x + b.max.x) / 2, b.max.y + tw / k / 2 + Hb / 2 - sy, -0.002);
    tape.rotation.y = Math.PI;
    tape.receiveShadow = true;
    tape.raycast = () => {};
    scene.add(tape);
    tape.updateMatrixWorld(true);
    backboardBox = new Box3().setFromObject(tape);
    onWall.push({ n: inward.S, o: tape });
  }
  let hoops: ReturnType<typeof createHoops> | null = null;
  let hoopsPose: (() => { p: Vector3; t: Vector3; fov: number }) | null = null;
  let hoopsLoading = false;
  const enterHoops = () => {
    if (hoops) return hoops.enter();
    if (hoopsLoading || !binObj) return;
    hoopsLoading = true;
    const ys = SHELL.outline.map(([, y]) => y), xs = SHELL.outline.map(([x]) => x);
    const bedBox = bedObj ? new Box3().setFromObject(bedObj) : null;
    if (bedBox) bedBox.max.y = bedObj!.localToWorld(new Vector3(0, bedTop, 0)).y;
    const courtBox = placed.court ? new Box3().setFromObject(placed.court) : null;
    const furnitureBoxes = HOOPS.obstacles.flatMap((id) => placed[id] ? [new Box3().setFromObject(placed[id])] : []);
    import('./room-hoops')
      .then(({ createHoops, hoopsView }) => {
        hoops = createHoops({
          scene, canvas, frame,
          bar: frame.querySelector<HTMLElement>('.closeup') ?? frame,
          bin: new Box3().setFromObject(binObj),
          binR: (manifest.assets[PLACEMENTS.find((p) => p.id === HOOPS.bin)!.asset] as { opening?: { r_inner: number } }).opening?.r_inner,
          backboard: backboardBox,
          view: (from, target, spot) => {
            if (focused !== 'hoops') return;
            hoopsPose = () => hoopsView(from, target, cam.aspect, spot.eye, furnitureBoxes);
            const { p, t, fov } = hoopsPose();
            if (opts.reduceMotion) {
              setFov(fov);
              cam.position.copy(p);
              camT.copy(t);
              cam.lookAt(t);
              dirty = true;
            } else tweenTo({ p, t, fov }, HOOPS.cameraMs, easeInOut, 'hoops-round');
          },
          // The room's walls (world x and z) and the furniture a throw can hit.
          room: { x0: Math.min(...xs), x1: Math.max(...xs), z0: -Math.max(...ys), z1: -Math.min(...ys), height: SHELL.height },
          boxes: [bedBox, courtBox, ...furnitureBoxes].filter((box): box is Box3 => !!box),
          load: (name) => loader.loadAsync(`${ASSETS}${name}.glb`).then((g) => g.scene, () => null),
          dress,
          reduceMotion: opts.reduceMotion,
          redraw: () => (dirty = true),
        });
        if (focused === 'hoops') hoops.enter();
      })
      .catch((err) => console.warn('Hoops failed to load.', err))
      .finally(() => (hoopsLoading = false));
  };

  // Picking a section in the full-screen room: fly to its shot first, then hand over to the page
  // (which shrinks the room back into the panel and scrolls there).
  let flying = false;
  const visit = (section: string, item?: string) => {
    if (!full || flying) return;
    const s = shots[section];
    if (!s || opts.reduceMotion) return opts.onNavigate(section, item);
    flying = true;
    controls.enabled = false;
    labels.hidden = true;
    hover();
    canvas.style.cursor = '';
    tweenTo(place(s), 700, easeInOut, section, () => {
      flying = false;
      opts.onNavigate(section, item);
    });
  };

  // A click on an object (or its label) in the room: its close-up if it has one, else its section.
  const pick = (o: Object3D | undefined, section?: string, aliases = true) => {
    // Section labels keep their page-navigation meaning; actual prop clicks accept aliases too.
    const id = aliases && o?.userData.closeup || Object.keys(CLOSEUPS).find((k) => o && placed[CLOSEUPS[k].object] === o);
    if (id) opts.onFocus(id);
    else if (section) visit(section, o?.userData.item);
  };

  // Close-ups (CLOSEUPS): the panel decides when to open or leave one, since it keeps the views and
  // the history; here the camera flies there and back, and each close-up's own interaction turns on
  // and off. Orbit, labels and hover are off while one is open.
  let focused: string | null = null;
  let beforeFocus = { t: new Vector3(), p: new Vector3() };
  const closeupHooks: Record<string, { enter?: () => void; leave?: () => void }> = {
    board: { leave: () => closeBoard() },
    hoops: { enter: () => enterHoops(), leave: () => hoops?.leave() },
  };
  const flyTo = (q: { t: Vector3; p: Vector3; fov?: number }, id: string) =>
    new Promise<void>((done) => {
      if (opts.reduceMotion) {
        tween = null;
        setFov(q.fov ?? ROOM_FOV);
        cam.position.copy(q.p);
        camT.copy(q.t);
        cam.lookAt(camT);
        dirty = true;
        return done();
      }
      flying = true;
      tweenTo(q, 700, easeInOut, id, () => {
        flying = false;
        done();
      });
    });
  const focus = async (id: string) => {
    if (!full || focused === id || !closeShots[id]) return;
    if (focused) closeupHooks[focused]?.leave?.();
    else {
      beforeFocus = { t: controls.target.clone(), p: cam.position.clone() };
      camT.copy(controls.target);
    }
    focused = id;
    controls.enabled = false;
    labels.hidden = true;
    hover();
    canvas.style.cursor = '';
    await flyTo(place(closeShots[id]), `closeup:${id}`);
    if (focused === id) closeupHooks[id]?.enter?.();
    dirty = true;
  };
  const unfocus = async () => {
    if (!focused) return;
    closeupHooks[focused]?.leave?.();
    focused = null;
    await flyTo(beforeFocus, 'full');
    if (!full || focused) return;
    controls.enabled = true;
    labels.hidden = false;
    canvas.style.cursor = 'grab';
    dirty = true;
  };

  // The board's close-up: its cards can be moved (until the next reload). Pressing a card pulls it
  // off the board together with its pin; it follows the pointer over the board and gets pinned back
  // in, with a bounce, where it's let go. A click beside the board goes back to the room.
  const closeBoard = () => {
    drop();
    hoverCard(-1);
  };

  // Each card's lift off the board (0–1) and scale, as springs; z is its height in the pile.
  const lifts = cards.map((c) => ({ l: 0, v: 0, t: 0, s: 1, sv: 0, st: 1, z: c.slot.position.z }));
  const pile = cards.map((_, i) => i);
  const LIFT = 0.045;
  const mx = bw / 2 - cs * 0.55, my = bh / 2 - cs * 0.55;
  const boardPlane = new Plane(), hitP = new Vector3();
  // Where the pointer ray (set by `hitAt`) meets the board, in the board's own coordinates.
  const onBoard = () => {
    boardPlane.setFromNormalAndCoplanarPoint(new Vector3(0, 0, 1).transformDirection(boardGroup.matrixWorld), boardGroup.localToWorld(bc.clone()));
    return ray.ray.intersectPlane(boardPlane, hitP) && boardGroup.worldToLocal(hitP);
  };
  const cardAt = (e: PointerEvent) => cards.findIndex((c) => isIn(hitAt(e) ?? null, c.slot));
  let drag: { i: number; id: number; dx: number; dy: number } | null = null;
  let press: [number, number] | null = null;
  let hoveredCard = -1;
  const hoverCard = (i: number) => {
    if (i === hoveredCard) return;
    if (hoveredCard >= 0) lifts[hoveredCard].st = 1;
    if (i >= 0 && !opts.reduceMotion) lifts[i].st = 1.04;
    hoveredCard = i;
    dirty = true;
  };
  const drop = () => {
    if (!drag) return;
    const { i } = drag;
    drag = null;
    lifts[i].t = 0;
    // The dropped card goes on top of the pile.
    pile.splice(pile.indexOf(i), 1);
    pile.push(i);
    pile.forEach((j, k) => {
      lifts[j].z = bc.z + 0.006 + k * 0.0015;
      cards[j].slot.position.z = lifts[j].z + lifts[j].l * LIFT;
    });
    canvas.style.cursor = 'grab';
    dirty = true;
  };
  // These listen on the frame in the capture phase, so in the board view they come before the
  // canvas's own handlers (orbit, hover bounce, chair) and keep them out.
  frame.addEventListener(
    'pointerdown',
    (e) => {
      if (focused !== 'board' || e.target !== canvas) return;
      e.stopPropagation();
      press = [e.clientX, e.clientY];
      const i = flying || drag ? -1 : cardAt(e);
      if (i < 0 || !onBoard()) return;
      canvas.setPointerCapture(e.pointerId);
      const p = cards[i].slot.position;
      drag = { i, id: e.pointerId, dx: p.x - hitP.x, dy: p.y - hitP.y };
      if (!opts.reduceMotion) lifts[i].t = 1;
      canvas.style.cursor = 'grabbing';
      dirty = true;
    },
    { capture: true },
  );
  frame.addEventListener(
    'pointermove',
    (e) => {
      if (focused !== 'board' || e.target !== canvas) return;
      e.stopPropagation();
      if (flying) return;
      if (!drag) {
        const i = cardAt(e);
        hoverCard(i);
        canvas.style.cursor = i >= 0 ? 'grab' : '';
        return;
      }
      if (e.pointerId !== drag.id) return;
      hitAt(e);
      if (!onBoard()) return;
      const p = cards[drag.i].slot.position;
      p.x = MathUtils.clamp(hitP.x + drag.dx, bc.x - mx, bc.x + mx);
      p.y = MathUtils.clamp(hitP.y + drag.dy, bc.y - my, bc.y + my);
      dirty = true;
    },
    { capture: true },
  );
  const release = (e: PointerEvent) => {
    if (focused !== 'board' || e.target !== canvas) return;
    e.stopPropagation();
    const p = press;
    press = null;
    const still = e.type === 'pointerup' && p && !flying && Math.hypot(e.clientX - p[0], e.clientY - p[1]) < 6;
    if (drag) {
      if (e.pointerId !== drag.id) return;
      const { i } = drag;
      drop();
      // A click (no drag) on a card goes to that card on the page.
      if (still) visit(CLOSEUPS.board.section!, cards[i].id);
      return;
    }
    // A click beside the board goes back to the room.
    if (still && !isIn(hitAt(e) ?? null, boardGroup)) opts.onBack();
  };
  frame.addEventListener('pointerup', release, { capture: true });
  frame.addEventListener('pointercancel', release, { capture: true });
  const stepCards = (dt: number) => {
    let moving = false;
    lifts.forEach((k, i) => {
      if (Math.abs(k.t - k.l) < 1e-4 && Math.abs(k.v) < 1e-3 && Math.abs(k.st - k.s) < 1e-4 && Math.abs(k.sv) < 1e-3) return;
      if (opts.reduceMotion) Object.assign(k, { l: k.t, v: 0, s: k.st, sv: 0 });
      else {
        k.v += (300 * (k.t - k.l) - 12 * k.v) * dt;
        k.l += k.v * dt;
        // Back on the board: the pin goes in, the card bounces off once and squishes a little.
        if (k.l < 0 && k.v < 0) {
          k.sv += k.v * 0.3;
          k.v *= -0.45;
          k.l = 0;
        }
        k.sv += (520 * (k.st - k.s) - 18 * k.sv) * dt;
        k.s += k.sv * dt;
      }
      const { slot, pin } = cards[i];
      slot.position.z = k.z + k.l * LIFT;
      slot.rotation.x = k.l * 0.15;
      slot.scale.setScalar(k.s);
      pin.position.z = 0.012 + k.l * 0.01;
      moving = true;
    });
    return moving;
  };

  // Resizing clears the canvas, and the ResizeObserver runs after this frame's draw, so redraw
  // right away; otherwise the room would vanish while the frame morphs in and out of full screen.
  const resize = () => {
    const w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    hoops?.resize(w, h);
    cam.aspect = w / h;
    if (!tween) {
      if (focused === 'hoops' && hoopsPose) {
        const { p, t, fov } = hoopsPose();
        setFov(fov);
        cam.position.copy(p);
        camT.copy(t);
        cam.lookAt(t);
      } else if (focused) jump(closeShots[focused]);
      else setFov(ROOM_FOV);
    }
    cam.updateProjectionMatrix();
    if (!full && !tween) jump(shots[active]);
    if (ready) draw();
  };
  let ready = false;
  new ResizeObserver(resize).observe(frame);
  resize();

  let visible = true;
  // The page panel plays clips; the free room and its close-ups keep the last video frame.
  // Pause decoding as well as redraws, and resume only the current screen content on return.
  const syncVideos = () => {
    const playing = !full && visible && !document.hidden;
    if (playing === videosPlaying) return;
    videosPlaying = playing;
    videoPlayback.forEach((sync) => sync());
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    syncVideos();
  }).observe(frame);
  document.addEventListener('visibilitychange', syncVideos);
  syncVideos();
  const v = new Vector3(), vp = new Vector2();
  // Keep drawing for ~2 s after mount: frames drawn while the canvas is still fading in from
  // opacity 0 may never be presented, which would leave the panel blank until the next move.
  let warmup = 120;
  const cameraInsideRoom = () => {
    if (!full || cam.position.y <= 0 || cam.position.y >= H) return false;
    const x = cam.position.x, y = -cam.position.z, outline = SHELL.outline;
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, yi] = outline[i], [xj, yj] = outline[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  // Draw one frame: lights, dollhouse walls, the scene, and the label positions.
  const draw = () => {
    dirty = false;
    hemi.intensity = cur.hemi;
    scene.environmentIntensity = cur.env;
    sun.intensity = cur.sun;
    lampL.intensity = cur.lamp;
    screenLs.forEach((l) => (l.intensity = cur.screen));
    stripLight.value = cur.shelf;
    shelfGlow.emissiveIntensity = cur.shelf * 1.2;
    bedL.intensity = cur.bed;
    tvL.intensity = cur.tv;
    for (const m of glows) m.emissiveIntensity = cur.emis * 1.2;
    if (ownGlows[LIGHTS.lamp]) ownGlows[LIGHTS.lamp].emissiveIntensity = Math.max(0.1, (cur.lamp / SWITCH_ON.lamp) * 1.44);
    if (ownGlows[LIGHTS.bedside]) ownGlows[LIGHTS.bedside].emissiveIntensity = Math.max(0.1, (cur.bed / SWITCH_ON.bed) * 1.44);
    const { b, c } = breathe(performance.now());
    ambColor.set(c);
    haloMat.color.copy(ambColor).multiplyScalar(cur.amb * b);
    ambL.color.copy(ambColor);
    ambL.intensity = cur.amb * b * 2.4;
    nixie?.update(cur.clock, performance.now());
    skyNight.opacity = cur.night;
    // Cut away near walls only in the dollhouse view. From inside, even a side wall can be
    // visible at the edge of a wide lens; hiding it exposes the page background as a dark band.
    const interior = cameraInsideRoom();
    ceilingSurface.visible = interior;
    v.copy(cam.position).sub(full && controls.enabled ? controls.target : camT);
    vp.set(v.x, -v.z);
    const wallOn = wallSets.map((w) => interior || (vp.dot(w.n) > -0.4 && (!w.also || vp.dot(w.also) > -0.4)));
    wallSets.forEach((w, i) => w.objs.forEach((o) => ghost(o, !wallOn[i])));
    posts.forEach((p) => ghost(p.m, !(wallOn[p.a] && wallOn[p.b])));
    onWall.forEach((w) => ghost(w.o, !interior && vp.dot(w.n) <= -0.4));
    renderer.render(scene, cam);
    if (full) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      labels.querySelectorAll<HTMLElement>('[data-go]').forEach((p) => {
        const a = v.copy(anchors[p.dataset.go!]).project(cam);
        const half = p.offsetWidth / 2 + 8;
        p.style.left = `${Math.min(w - half, Math.max(half, ((a.x + 1) / 2) * w))}px`;
        p.style.top = `${((1 - a.y) / 2) * h}px`;
        p.style.visibility = a.z < 1 && anchorObj[p.dataset.go!].visible ? '' : 'hidden';
      });
    }
  };
  let lastNow = 0, lastAmbient = 0, lastVideo = 0, lastTick = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    syncVideos();
    if (!visible || document.hidden) return;
    if (tween) {
      const c = tween.clock;
      const x = c ? (c.done() ? 1 : c.progress()) : Math.min(1, (now - tween.t0) / tween.ms);
      const e = c ? x : tween.ease(x);
      setFov(MathUtils.lerp(tween.fromFov, tween.toFov, e));
      camT.lerpVectors(tween.fromT, tween.toT, e);
      cam.position.lerpVectors(tween.fromP, tween.toP, e);
      cam.lookAt(camT);
      if (x >= 1) {
        const done = tween.done;
        tween = null;
        done?.();
      }
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
    // Not while disabled: right after the fly to a section ends, `full` is still set for this
    // frame, and an update would turn the camera to the orbit target for one frame.
    if (full && controls.enabled && !tween && controls.update()) dirty = true;
    if (stepPops()) dirty = true;
    if (stepBlinds()) dirty = true;
    const dt = Math.min(0.033, (now - (lastNow || now)) / 1000);
    if (stepSprings(dt)) dirty = true;
    if (stepChair(dt)) dirty = true;
    if (stepToys(dt)) dirty = true;
    if (stepSway(dt)) dirty = true;
    if (stepCards(dt)) dirty = true;
    if (hoops?.step(dt)) dirty = true;
    if (coffeeSteam.step(now, !focused || focused === 'desk', frame.clientHeight)) dirty = true;
    lastNow = now;
    // The ambilight breathes and the night clock flickers: redraw at ~30 fps while they're on. By day
    // the clock only needs a redraw when its seconds change.
    const sec = Math.floor(Date.now() / 1000);
    if (cur.clock > 0.02 && sec !== lastTick) {
      lastTick = sec;
      dirty = true;
    }
    if ((cur.amb > 0.002 && !opts.reduceMotion) || (cur.clock > 0.02 && theme === 'dark' && !opts.reduceMotion)) {
      if (now - lastAmbient > 33) {
        lastAmbient = now;
        dirty = true;
      }
    }
    // Modern browsers mark dirty only when a new video frame arrives. Older ones get a 30 fps
    // fallback, never a redraw on every display refresh merely because a clip is playing.
    if (videosPlaying && now - lastVideo >= 1000 / 30) {
      lastVideo = now;
      if ([...videos].some((vid) => !vid.paused && typeof vid.requestVideoFrameCallback !== 'function')) dirty = true;
    }
    if (warmup > 0) {
      warmup--;
      dirty = true;
    }
    if (dirty) draw();
  };
  ready = true;
  requestAnimationFrame(loop);

  updateScreens();
  window.addEventListener('sectionchange', (e) => go((e as CustomEvent<string>).detail));
  window.addEventListener('itemchange', (e) => {
    item = (e as CustomEvent<string>).detail;
    updateScreens();
  });
  window.addEventListener('themechange', (e) => setTheme((e as CustomEvent<'light' | 'dark'>).detail));
  return { canvas, enterFull, exitFull, focus, unfocus, visit };
}
