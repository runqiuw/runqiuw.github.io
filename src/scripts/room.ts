// Live clay room for the left panel, assembled from the Blender assets in public/room/assets/
// according to room.config.ts (layout, colors, camera shots).
// Scroll (`sectionchange`) moves the camera to the object for that section; `itemchange` (the page
// item in view) decides what that object shows: the paper on the monitors, the game on the TV, the
// project frame or pinboard card that pops out. The theme switch (`themechange`) turns the lights on
// or off. `enterFull()` turns it into a free-orbit room with labels; picking a label or an object
// calls `onNavigate(section)`. Rendering happens only while something changes.
import {
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  FrontSide,
  Group,
  HemisphereLight,
  MathUtils,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Shape,
  type Side,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VideoTexture,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LABELS, LAMP_AIM, LIGHTS, PLACEMENTS, WINDOWS, type Role, SCREENS, SHELL, SHOTS, type Shot as ShotDef } from './room.config';

type Shot = { t: Vector3; dir: Vector3; r: number };
type Manifest = {
  assets: Record<string, { size: number[]; tiers?: number[]; screen?: { aspect: number }; cover?: { aspect: number } }>;
};

const ASSETS = '/room/assets/';
const INK = '#14183a';
const LEVELS = {
  light: { hemi: 1.9, sun: 2.4, lamp: 0, screen: 0, bed: 0, tv: 0, emis: 0.12 },
  dark: { hemi: 0.62, sun: 0.4, lamp: 9, screen: 1.6, bed: 2.2, tv: 1.8, emis: 1.2 },
};
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
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setPixelRatio(Math.min(1.75, devicePixelRatio || 1));

  const scene = new Scene();
  const cam = new PerspectiveCamera(30, 1, 0.05, 80);
  const center = P(2.05, 1.85, 0.85);

  let dirty = true;
  let active = opts.section in SHOTS ? opts.section : 'top';
  let item = document.documentElement.dataset.item ?? '';

  const hemi = new HemisphereLight(0xffffff, 0xd2ccff, LEVELS.light.hemi);
  const sun = new DirectionalLight(0xffffff, LEVELS.light.sun);
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
  // Night lights are spots, so lamp shades and screens light a cone instead of the whole room.
  const spot = (color: number, angle: number, dist: number) => {
    const l = new SpotLight(color, 0, dist, angle, 0.7, 1.5);
    scene.add(l, l.target);
    return l;
  };
  const lampL = spot(0xffc06a, 0.9, 5);
  const bedL = spot(0xffa860, 0.95, 3);
  const screenL = spot(0xb8d4ff, 1.0, 1.6);
  const tvL = spot(0x8fa0ff, 0.95, 2.6);
  scene.add(hemi, sun, sun.target);

  // Canvas text uses the site fonts; wait for them briefly so the first textures aren't in a fallback.
  const fontsReady = Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const names = [...new Set(PLACEMENTS.map((p) => p.asset))];
  const [manifest, gltfs] = await Promise.all([
    fetch(ASSETS + 'manifest.json').then((r) => r.json() as Promise<Manifest>),
    Promise.all(names.map((n) => loader.loadAsync(`${ASSETS}${n}.glb`))),
    fontsReady,
  ]);
  const source = Object.fromEntries(names.map((n, i) => [n, gltfs[i].scene]));

  // --- materials: one per role + color; parts without an override keep their Blender (vertex) colors
  const glows: MeshStandardMaterial[] = [];
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
  const material = (role: string, color?: string, vertex = false, side: Side = FrontSide, ao = false) => {
    const key = `${role}|${color ?? ''}|${vertex && !color}|${side}|${ao}`;
    let m = matCache.get(key);
    if (m) return m;
    m = new MeshStandardMaterial({
      color: new Color(color ?? '#ffffff'),
      vertexColors: vertex && !color,
      side,
      roughness: role === 'glass' ? 0.2 : role === 'screen' ? 0.4 : 0.82,
      metalness: 0,
    });
    if (role === 'glass') Object.assign(m, { transparent: true, opacity: 0.4, depthWrite: false });
    m.userData.role = role;
    if (ao) withAO(m);
    if (role === 'screen' && !color) m.color.set(INK);
    if (role === 'glow') {
      m.emissive.set('#ffd98a');
      glows.push(m);
    }
    matCache.set(key, m);
    return m;
  };

  // --- room shell: floor slab and walls with window/door openings, built from the measured outline
  const T = SHELL.thickness, H = SHELL.height;
  const floorMat = new MeshStandardMaterial({ color: new Color(SHELL.floor), roughness: 0.9 });
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
    for (const o of holes) {
      if (o.span[0] > u) pieces.push([u, o.span[0], 0, H]);
      if (o.z[0] > 0) pieces.push([o.span[0], o.span[1], 0, o.z[0]]);
      if (o.z[1] < H) pieces.push([o.span[0], o.span[1], o.z[1], H]);
      u = o.span[1];
    }
    if (u < u1) pieces.push([u, u1, 0, H]);
    const mat = new MeshStandardMaterial({ color: new Color(w.side === 'W' ? SHELL.wallW : SHELL.wall), roughness: 0.9 });
    const objs = pieces.map(([a, b, z0, z1]) => {
      const len = b - a, mid = (a + b) / 2, off = line - (alongX ? n.y : n.x) * (T / 2);
      const m = new Mesh(alongX ? new BoxGeometry(len, z1 - z0, T) : new BoxGeometry(T, z1 - z0, len), mat);
      m.position.copy(alongX ? P(mid, off, (z0 + z1) / 2) : P(off, mid, (z0 + z1) / 2));
      m.receiveShadow = true;
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
    scene.add(m);
    posts.push({ a: i, b: j, m });
  });

  // --- furniture
  const placed: Record<string, Object3D> = {};
  for (const p of PLACEMENTS) {
    const g = source[p.asset].clone(true);
    g.position.copy(P(p.at[0], p.at[1], p.z ?? 0));
    g.rotation.y = MathUtils.degToRad(p.yaw ?? 0);
    if (p.scale) g.scale.setScalar(p.scale);
    g.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const role = (o.material as Material).name as Role;
      o.material = material(role, p.colors?.[role], o.geometry.hasAttribute('color'), (o.material as Material).side, p.ao !== false && o.geometry.hasAttribute('_ao'));
      o.castShadow = role !== 'glass';
      o.receiveShadow = true;
    });
    // A section hidden on the page (e.g. Playground) leaves its object as plain decoration.
    g.userData.section = p.section && document.getElementById(p.section) ? p.section : undefined;
    g.userData.name = p.name;
    if (p.wall) onWall.push({ n: inward[p.wall], o: g });
    scene.add(g);
    placed[p.id] = g;
  }
  scene.updateMatrixWorld(true);

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

  // Blinds: in full-screen mode a click on a window rolls its blind up or down. The asset has the
  // cloth (`blind_cloth`, origin on the roller) and the bottom bar (`blind_bar`) as their own nodes;
  // the cloth scales toward the roller and the bar follows its bottom edge.
  type Blind = { win: Object3D; cloth: Object3D; bar?: Object3D; len: number; barY: number; k: number; t: number };
  const blinds: Blind[] = [];
  for (const id of WINDOWS) {
    const win = placed[id];
    const cloth = win?.getObjectByName('blind_cloth');
    if (!win || !cloth) continue;
    const bar = win.getObjectByName('blind_bar') ?? undefined;
    const b = new Box3().setFromObject(cloth);
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
      if (o instanceof Mesh && glows.includes(o.material as MeshStandardMaterial)) glowBox.union(new Box3().setFromObject(o));
    });
    const at = glowBox.isEmpty() ? top(bounds([id]), -0.05) : glowBox.getCenter(new Vector3());
    const [ax, ay, az] = LAMP_AIM[PLACEMENTS.find((p) => p.id === id)!.asset] ?? [0, 0, -1];
    const dir = new Vector3(ax, az, -ay).normalize().applyQuaternion(g.getWorldQuaternion(new Quaternion()));
    l.position.copy(at).addScaledVector(dir, 0.03);
    l.target.position.copy(at).add(dir);
  };
  aimLamp(lampL, LIGHTS.lamp);
  aimLamp(bedL, LIGHTS.bedside);
  // Screens wash the desk (and the floor in front of the TV) from the screen itself, angled down.
  const aimScreen = (l: SpotLight, ids: string[]) => {
    const b = bounds(ids), at = b.getCenter(new Vector3());
    const front = new Vector3(0, 0, 1).applyQuaternion(placed[ids[0]].quaternion);
    l.position.copy(at).addScaledVector(front, 0.08);
    l.target.position.copy(at).addScaledVector(front, 1).add(new Vector3(0, -0.9, 0));
  };
  aimScreen(screenL, LIGHTS.screen);
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

  // --- screens: the `screen` / `cover` planes of the assets (glTF UVs, so textures are not flipped)
  const videos: HTMLVideoElement[] = [];
  // `glowing` screens are unlit (they show their picture as is and reflect nothing); printed
  // surfaces like game covers take the room light.
  const makeScreen = (id: string, node: string, aspect: number, width = 640, glowing = true) => {
    const mesh = placed[id].getObjectByName(node) as Mesh;
    const { c, x, tex } = canvasTex(width, width / aspect, false);
    const mat = glowing ? new MeshBasicMaterial({ map: tex }) : new MeshStandardMaterial({ map: tex, roughness: 0.7 });
    mesh.material = mat;
    let video: HTMLVideoElement | null = null;
    let vtex: VideoTexture | null = null;
    let req = 0;
    const useCanvas = () => {
      video?.pause();
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    };
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
          vtex?.dispose();
          video = Object.assign(document.createElement('video'), { src, muted: true, loop: true, playsInline: true });
          video.dataset.src = src;
          videos.push(video);
          vtex = new VideoTexture(video);
          vtex.colorSpace = SRGBColorSpace;
          vtex.flipY = false;
        }
        mat.map = vtex;
        mat.needsUpdate = true;
        video.play().catch(() => {
          useCanvas();
          fallback();
        });
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

  // Project frames standing on the shelf tiers, one per project, in page order.
  const shelf = placed[SCREENS.shelf];
  const tiers = SCREENS.shelfTiers.map((i) => manifest.assets[PLACEMENTS.find((p) => p.id === SCREENS.shelf)!.asset].tiers?.[i] ?? 0.4 * i).sort((a, b) => b - a);
  const projects = pageItems('projects');
  const perTier = Math.max(1, Math.ceil(projects.length / tiers.length));
  const shelfW = manifest.assets[PLACEMENTS.find((p) => p.id === SCREENS.shelf)!.asset].size[0] - 0.08;
  const fw = Math.min(0.34, shelfW / perTier - 0.04), fh = fw * 0.66;
  const frameMat = new MeshStandardMaterial({ color: new Color('#ffffff'), roughness: 0.8 });
  const frames = projects.map((el, i) => {
    const tier = tiers[Math.floor(i / perTier)] ?? tiers[tiers.length - 1];
    const k = i % perTier, n = Math.min(perTier, projects.length - Math.floor(i / perTier) * perTier);
    const f = new Group();
    const border = new Mesh(new BoxGeometry(fw, fh, 0.018), frameMat);
    border.castShadow = true;
    const { x, tex, c } = canvasTex(384, 384 * ((fh - 0.03) / (fw - 0.03)));
    const pic = new Mesh(new PlaneGeometry(fw - 0.03, fh - 0.03), new MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    pic.position.z = 0.0095;
    f.add(border, pic);
    f.position.set((k - (n - 1) / 2) * (shelfW / n), tier + fh / 2 + 0.005, -0.03);
    f.rotation.x = -0.16;
    f.userData.section = 'projects';
    shelf.add(f);
    if (el.dataset.screenImg)
      loadImg(el.dataset.screenImg).then((img) => {
        fit(x, img, c.width, c.height, 'cover');
        tex.needsUpdate = true;
        dirty = true;
      });
    return { id: el.dataset.item, pop: poppable(f, { p: new Vector3(0, 0.02, 0.07), r: 0.2, s: 0.1 }) };
  });

  // Pinboard cards: a sticky note (or a photo) per playground item, pinned on the `board` plane.
  const boardGroup = placed[SCREENS.pinboard];
  const board = boardGroup.getObjectByName('board')!;
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
    const card = new Mesh(new BoxGeometry(cs, cs, 0.004), [
      ...Array(4).fill(frameMat),
      new MeshStandardMaterial({ map: tex, roughness: 0.9 }),
      frameMat,
    ]);
    card.castShadow = true;
    const pin = new Mesh(new SphereGeometry(0.014, 12, 10), new MeshStandardMaterial({ color: new Color(PIN_COLORS[i % 3]) }));
    pin.position.set(0, cs * 0.4, 0.012);
    card.add(pin);
    const col = i % cols, row = Math.floor(i / cols);
    card.position.set(bc.x + (col - (cols - 1) / 2) * (bw / cols), bc.y - (row - (rows - 1) / 2) * (bh / rows), bc.z + 0.006);
    card.rotation.z = [-0.06, 0.05, -0.03, 0.04, -0.05, 0.03][i % 6];
    card.userData.section = 'playground';
    boardGroup.add(card);
    return { id: el.dataset.item, pop: poppable(card, { p: new Vector3(0, 0, 0.03), s: 0.15 }) };
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
    on(frames, 'projects');
    on(cards, 'playground');
    dirty = true;
  };

  // --- camera shots from the config
  const shot = (d: ShotDef): Shot => {
    if (d.center) return { t: P(...d.center), dir: PD(d.dir), r: d.r ?? 3 };
    const b = bounds(d.frame ?? []);
    const t = b.getCenter(new Vector3());
    t.y += d.lift ?? 0;
    const s = b.getSize(new Vector3());
    return { t, dir: PD(d.dir), r: Math.max(s.x, s.y, s.z) * 0.5 * (d.pad ?? 1.35) + 0.15 };
  };
  const shots = Object.fromEntries(Object.entries(SHOTS).map(([k, d]) => [k, shot(d)])) as Record<string, Shot>;

  const labels = document.createElement('div');
  labels.className = 'room-pins';
  labels.hidden = true;
  const shownLabels = LABELS.filter(([k]) => document.getElementById(k));
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
    if (b) visit(b.dataset.go!);
  });
  frame.append(labels);
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
  };
  let tween: Tween | null = null;
  const tweenTo = (q: { t: Vector3; p: Vector3 }, ms: number, ease: (x: number) => number, id: string, done?: () => void, clock?: Clock) => {
    tween = { t0: performance.now(), ms, fromT: camT.clone(), fromP: cam.position.clone(), toT: q.t, toP: q.p, ease, id, done, clock };
  };
  // Framing depends on the aspect; opening and closing the full-screen room pass the aspect the
  // canvas will have at the end of the morph.
  const place = (s: Shot, aspect = cam.aspect) => {
    const v = MathUtils.degToRad(cam.fov) / 2, h = Math.atan(Math.tan(v) * aspect);
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

  let cur = { ...LEVELS[opts.theme] };
  let target = LEVELS[opts.theme];
  let fading = false;
  const setTheme = (t: 'light' | 'dark') => {
    target = LEVELS[t];
    fading = true;
    hemi.color.set(t === 'dark' ? 0x7d84ff : 0xffffff);
    sun.color.set(t === 'dark' ? 0x9fb2ff : 0xffffff);
    sun.position.copy(t === 'dark' ? center.clone().add(new Vector3(-6, 3.65, 1)) : center.clone().add(new Vector3(3.5, 6.15, 5.5)));
    if (opts.reduceMotion) {
      cur = { ...target };
      fading = false;
    }
    dirty = true;
  };
  setTheme(opts.theme);
  cur = { ...target };

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
    // The bounding-sphere fit is too cautious on tall portrait screens; tighten it there.
    const q = place({ ...shots.top, r: shots.top.r * (aspect < 0.8 ? 0.78 : 1) }, aspect);
    controls.maxDistance = Math.max(16, q.p.distanceTo(q.t) * 1.3);
    const arrive = () => {
      if (!full) return;
      controls.target.copy(q.t);
      controls.enabled = true;
      labels.hidden = false;
      canvas.style.cursor = 'grab';
      dirty = true;
    };
    if (ms && !opts.reduceMotion) tweenTo(q, ms, easeOut, 'full', arrive, clock);
    else {
      tween = null;
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
    hover();
    showTip(null);
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
      cam.position.copy(q.p);
      camT.copy(q.t);
      cam.lookAt(camT);
      dirty = true;
    }
  };

  // Click an object in full mode → navigate to its section.
  const ray = new Raycaster(), ndc = new Vector2();
  const shown = (o: Object3D | null) => {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  const sectionOf = (o: Object3D | null) => {
    for (; o; o = o.parent) if (o.userData.section) return o.userData.section as string;
  };
  const hitAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    return ray.intersectObjects(scene.children, true).find((h) => shown(h.object))?.object;
  };
  const pick = (e: PointerEvent) => sectionOf(hitAt(e) ?? null);

  // Hover bounce: interactive objects (placements with a section) spring up a little under the
  // pointer, with a bit of overshoot, and spring back when it leaves.
  const placedSet = new Set(Object.values(placed));
  const interactiveOf = (o: Object3D | null) => {
    for (; o; o = o.parent) if (placedSet.has(o) && o.userData.section) return o;
  };
  type Spring = { o: Object3D; base: number; s: number; v: number; t: number };
  const springs = new Map<Object3D, Spring>();
  let hovered: Object3D | undefined;
  const hover = (o?: Object3D) => {
    if (o === hovered) return;
    if (hovered) springs.get(hovered)!.t = 1;
    hovered = o;
    if (!o) return;
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
  canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
  canvas.addEventListener('pointerup', (e) => {
    if (!full || !down) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
    down = null;
    if (moved >= 6) return;
    const hit = hitAt(e) ?? null;
    const blind = blindOf(hit);
    if (blind) {
      blind.t = blind.t > 0.5 ? 0.06 : 1;
      dirty = true;
      return;
    }
    const k = sectionOf(hit);
    if (k) visit(k);
  });
  // Name tag next to the pointer: the object's name and where a click takes you.
  const titles = Object.fromEntries(LABELS.map(([k, t]) => [k, t]));
  const tip = document.createElement('div');
  tip.className = 'room-tip';
  tip.hidden = true;
  frame.append(tip);
  const showTip = (e: PointerEvent | null, text?: string) => {
    if (!e || !text) return void (tip.hidden = true);
    tip.textContent = text;
    tip.hidden = false;
    const r = frame.getBoundingClientRect();
    tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8)}px`;
    tip.style.top = `${e.clientY - r.top + 16}px`;
  };
  canvas.addEventListener('pointermove', (e) => {
    if (!full || down || flying) return showTip(null);
    const hit = hitAt(e) ?? null;
    const o = interactiveOf(hit);
    const blind = blindOf(hit);
    hover(o);
    canvas.style.cursor = o || blind ? 'pointer' : 'grab';
    if (o) showTip(e, `${o.userData.name ?? ''} → ${titles[o.userData.section] ?? ''}`.trim());
    else if (blind) showTip(e, `${blind.win.userData.name ?? 'Window'} · click to roll the blind`);
    else showTip(null);
  });
  canvas.addEventListener('pointerleave', () => {
    hover();
    showTip(null);
  });

  // Picking a section in the full-screen room: fly to its shot first, then hand over to the page
  // (which shrinks the room back into the panel and scrolls there).
  let flying = false;
  const visit = (section: string) => {
    if (!full || flying) return;
    const s = shots[section];
    if (!s || opts.reduceMotion) return opts.onNavigate(section);
    flying = true;
    controls.enabled = false;
    labels.hidden = true;
    hover();
    showTip(null);
    canvas.style.cursor = '';
    tweenTo(place(s), 700, easeInOut, section, () => {
      flying = false;
      opts.onNavigate(section);
    });
  };

  // Resizing clears the canvas, and the ResizeObserver runs after this frame's draw, so redraw
  // right away; otherwise the room would vanish while the frame morphs in and out of full screen.
  const resize = () => {
    const w = frame.clientWidth, h = frame.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    if (!full && !tween) jump(shots[active]);
    if (ready) draw();
  };
  let ready = false;
  new ResizeObserver(resize).observe(frame);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(frame);
  const v = new Vector3(), vp = new Vector2();
  // Keep drawing for ~2 s after mount: frames drawn while the canvas is still fading in from
  // opacity 0 may never be presented, which would leave the panel blank until the next move.
  let warmup = 120;
  // Draw one frame: lights, dollhouse walls, the scene, and the label positions.
  const draw = () => {
    dirty = false;
    hemi.intensity = cur.hemi;
    sun.intensity = cur.sun;
    lampL.intensity = cur.lamp;
    screenL.intensity = cur.screen;
    bedL.intensity = cur.bed;
    tvL.intensity = cur.tv;
    for (const m of glows) m.emissiveIntensity = cur.emis * 1.2;
    skyNight.opacity = Math.min(1, cur.lamp / LEVELS.dark.lamp);
    // Hide whichever walls face the camera (dollhouse view).
    v.copy(cam.position).sub(full ? controls.target : camT);
    vp.set(v.x, -v.z);
    const wallOn = wallSets.map((w) => vp.dot(w.n) > -0.4 && (!w.also || vp.dot(w.also) > -0.4));
    wallSets.forEach((w, i) => w.objs.forEach((o) => (o.visible = wallOn[i])));
    posts.forEach((p) => (p.m.visible = wallOn[p.a] && wallOn[p.b]));
    onWall.forEach((w) => (w.o.visible = vp.dot(w.n) > -0.4));
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
  let lastNow = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (tween) {
      const c = tween.clock;
      const x = c ? (c.done() ? 1 : c.progress()) : Math.min(1, (now - tween.t0) / tween.ms);
      const e = c ? x : tween.ease(x);
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
    if (full && !tween && controls.update()) dirty = true;
    if (stepPops()) dirty = true;
    if (stepBlinds()) dirty = true;
    if (stepSprings(Math.min(0.033, (now - (lastNow || now)) / 1000))) dirty = true;
    lastNow = now;
    if (videos.some((vid) => !vid.paused)) dirty = true;
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
  return { canvas, enterFull, exitFull };
}
