// Trash-can basketball in the room's `hoops` close-up, with cannon-es. Loaded by room.ts the first
// time that close-up opens, so neither the page nor the room pays for it before.
// Three things to throw (paper ball, empty bottle, bouncy ball), picked with buttons beside "Back to
// room". Press and pull back like a slingshot: the pull's direction aims left or right, its length
// sets the power, and a dotted line previews the flight (with the projectile's air drag, without
// bounces). A throw is a basket when it comes to rest inside the bin; the badge in the corner counts
// made / attempts until the next reload. The bin's side is a ring of thin boxes, so throws rattle on
// the rim and go in and out; the walls, the floor and the bed are there to bank off. Only the last
// MAX throws stay, the oldest fades out. Bodies sleep when they settle and `step` reports whether
// anything still moves, so the room only renders while it does.
import { Body, Box, ContactMaterial, Cylinder, Material as CMat, Plane, Quaternion as CQuat, Sphere, Vec3, World } from 'cannon-es';
import {
  Box3,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Role } from './room.config';

type Kind = 'paper' | 'bottle' | 'bouncy';
interface KindSpec {
  label: string;
  asset: string;
  colors: Partial<Record<Role, string>>;
  mass: number;
  /** Air drag (cannon's linear damping: the share of speed lost per second). */
  drag: number;
  bounce: number;
  friction: number;
  /** End-over-end spin at release, rad/s. */
  spin: number;
  /** Launch speed at no pull and at a full pull, m/s. */
  speed: [number, number];
}
const KINDS: Record<Kind, KindSpec> = {
  // Light and draggy: slows down fast in the air and lands dead.
  paper: { label: 'Paper ball', asset: 'ball_paper', colors: { fabric: '#f4f1e6' }, mass: 0.012, drag: 0.5, bounce: 0.05, friction: 0.9, spin: 3, speed: [1.6, 7] },
  // Light with its mass toward the cap: tumbles in the air, skids or kicks sideways when it lands.
  bottle: { label: 'Bottle', asset: 'bottle', colors: { glass: '#d4ecff', accent: '#3d5afe' }, mass: 0.02, drag: 0.12, bounce: 0.35, friction: 0.25, spin: 11, speed: [1.6, 6] },
  // Heavier and lively: banks off the wall and bounces off the floor.
  bouncy: { label: 'Bouncy ball', asset: 'ball_bouncy', colors: { accent: '#ff3d6e', frame: '#ffc93c' }, mass: 0.06, drag: 0.02, bounce: 0.82, friction: 0.6, spin: 2, speed: [1.6, 6] },
};
const MAX = 10;
const G = 9.82;
/** Launch angle above the horizon; the pull sets the heading and the speed. */
const ELEV = (52 * Math.PI) / 180;
const MAX_YAW = 0.5;
const STEP = 1 / 120;

export interface HoopsSpec {
  scene: Scene;
  canvas: HTMLCanvasElement;
  frame: HTMLElement;
  /** The close-up's button bar, where the projectile buttons go. */
  bar: HTMLElement;
  /** The bin's world box (it stands on the floor), and its inner radius at the rim if known. */
  bin: Box3;
  binR?: number;
  /** Where a throw leaves the hand (world). */
  from: Vector3;
  /** The room's walls: world x and z of each side. */
  room: { x0: number; x1: number; z0: number; z1: number };
  /** Furniture to bank off (world boxes). */
  boxes: Box3[];
  /** An asset's model, or null if it isn't exported (a stand-in takes its place). */
  load: (asset: string) => Promise<Object3D | null>;
  /** Give an asset's parts the room's role materials. */
  dress: (o: Object3D, colors?: Partial<Record<Role, string>>) => void;
  reduceMotion: boolean;
  redraw: () => void;
}

export function createHoops(o: HoopsSpec) {
  const world = new World({ gravity: new Vec3(0, -G, 0) });
  world.allowSleep = true;
  Object.assign(world.defaultContactMaterial, { friction: 0.4, restitution: 0.3 });
  const solid = new CMat('room');
  const mats = Object.fromEntries(
    (Object.keys(KINDS) as Kind[]).map((k) => {
      const m = new CMat(k);
      world.addContactMaterial(new ContactMaterial(m, solid, { friction: KINDS[k].friction, restitution: KINDS[k].bounce }));
      return [k, m];
    }),
  ) as Record<Kind, CMat>;

  // --- static colliders: floor and walls (planes facing into the room), furniture, the bin
  const fixed = (shape: Plane | Box, p: Vec3, q?: CQuat) => {
    const b = new Body({ mass: 0, material: solid, shape });
    b.position.copy(p);
    if (q) b.quaternion.copy(q);
    world.addBody(b);
  };
  const { x0, x1, z0, z1 } = o.room;
  for (const [n, p] of [
    [[0, 1, 0], [0, 0, 0]],
    [[1, 0, 0], [x0, 0, 0]],
    [[-1, 0, 0], [x1, 0, 0]],
    [[0, 0, 1], [0, 0, z0]],
    [[0, 0, -1], [0, 0, z1]],
  ] as [number, number, number][][])
    fixed(new Plane(), new Vec3(...p), new CQuat().setFromVectors(new Vec3(0, 0, 1), new Vec3(...n)));
  for (const b of o.boxes) {
    const c = b.getCenter(new Vector3()), s = b.getSize(new Vector3()).multiplyScalar(0.5);
    fixed(new Box(new Vec3(s.x, s.y, s.z)), new Vec3(c.x, c.y, c.z));
  }
  // The bin: tapered, its side a ring of thin boxes whose inner faces lie on its inner surface (the
  // floor is its bottom). Thicker than the real wall, so a fast ball can't pass through in one step.
  const bc = o.bin.getCenter(new Vector3()), bs = o.bin.getSize(new Vector3());
  const rTop = o.binR ?? Math.max(bs.x, bs.z) / 2 - 0.012, rBot = rTop * 0.85, binH = bs.y;
  const N = 14, th = 0.008, tilt = Math.atan((rTop - rBot) / binH);
  for (let i = 0; i < N; i++) {
    // A few mm inside the surface: the flat segments stick out past the round wall at their ends.
    const a = (i / N) * Math.PI * 2, r = (rTop + rBot) / 2 + th - 0.003;
    const q = new CQuat().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2 - a).mult(new CQuat().setFromAxisAngle(new Vec3(1, 0, 0), tilt));
    fixed(new Box(new Vec3(rTop * Math.tan(Math.PI / N) * 1.1, binH / 2 / Math.cos(tilt), th)), new Vec3(bc.x + Math.cos(a) * r, o.bin.min.y + binH / 2, bc.z + Math.sin(a) * r), q);
  }
  const inBin = (p: Vec3) => Math.hypot(p.x - bc.x, p.z - bc.z) < rTop && p.y < o.bin.max.y - 0.01;

  // --- projectiles: each kind's model centred on its center of mass (the body's origin)
  type Template = { g: Group; size: Vector3; com: number };
  const templates: Partial<Record<Kind, Template>> = {};
  const make = (k: Kind, model: Object3D | null): Template => {
    // An asset that isn't exported: a plain ball.
    const m = model ?? new Mesh(new SphereGeometry(0.033, 16, 12), new MeshStandardMaterial({ name: 'accent' }));
    o.dress(m, KINDS[k].colors);
    m.updateMatrixWorld(true);
    const b = new Box3().setFromObject(m), size = b.getSize(new Vector3());
    // The bottle's mass sits toward its cap (thick neck and cap), so it tumbles.
    const com = k === 'bottle' ? size.y * 0.13 : 0;
    m.position.sub(b.getCenter(new Vector3())).y -= com;
    const g = new Group();
    g.add(m);
    return { g, size, com };
  };
  const addShapes = (b: Body, k: Kind, { size, com }: Template) => {
    if (k !== 'bottle') return b.addShape(new Sphere((Math.max(size.x, size.y, size.z) / 2) * 0.95));
    // Body, shoulder and neck with cap, bottom to top, along the bottle's axis (y).
    const H = size.y, R = Math.max(size.x, size.z) / 2;
    b.addShape(new Cylinder(R, R, H * 0.68, 10), new Vec3(0, -H * 0.16 - com, 0));
    b.addShape(new Cylinder(R * 0.45, R, H * 0.14, 10), new Vec3(0, H * 0.25 - com, 0));
    b.addShape(new Cylinder(R * 0.5, R * 0.5, H * 0.18, 8), new Vec3(0, H * 0.41 - com, 0));
  };

  // The throw goes from the hand toward the bin; the pull turns it left or right of that.
  const up = new Vector3(0, 1, 0);
  const fwd = new Vector3(bc.x - o.from.x, 0, bc.z - o.from.z).normalize();
  const right = new Vector3().crossVectors(fwd, up);

  let kind: Kind = 'paper';
  let on = false, ready = true, made = 0, tries = 0;
  // The projectile in hand, waiting at the throwing spot.
  const hand = new Group();
  hand.visible = false;
  o.scene.add(hand);
  const showHand = () => {
    hand.clear();
    const t = templates[kind];
    if (t) hand.add(t.g.clone(true));
    hand.position.copy(o.from);
    // The bottle is held tilted forward, cap first.
    hand.rotation.set(kind === 'bottle' ? 1.1 : 0, 0, 0);
    hand.visible = on && ready && !!t;
    o.redraw();
  };
  for (const k of Object.keys(KINDS) as Kind[])
    o.load(KINDS[k].asset).then((m) => {
      templates[k] = make(k, m);
      if (k === kind) showHand();
    });

  // --- UI: projectile buttons in the close-up bar, and the score badge
  const buttons = (Object.keys(KINDS) as Kind[]).map((k) => {
    const b = document.createElement('button');
    Object.assign(b, { type: 'button', className: 'room-pin on', textContent: KINDS[k].label, hidden: true });
    b.setAttribute('aria-pressed', String(k === kind));
    b.addEventListener('click', () => {
      kind = k;
      buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(Object.keys(KINDS)[i] === k)));
      showHand();
    });
    o.bar.append(b);
    return b;
  });
  const badge = document.createElement('p');
  badge.className = 'hoops-score';
  badge.hidden = true;
  badge.setAttribute('aria-live', 'polite');
  o.frame.append(badge);
  const score = () => (badge.textContent = tries ? `Made ${made} / ${tries}` : 'Drag back, let go');
  score();

  // --- aiming: the dotted flight preview
  const DOTS = 26;
  const dots = new InstancedMesh(new SphereGeometry(1, 8, 6), new MeshBasicMaterial({ color: '#ff5a4e', toneMapped: false }), DOTS);
  dots.frustumCulled = false;
  dots.visible = false;
  dots.raycast = () => {};
  o.scene.add(dots);
  const dm = new Matrix4();
  const preview = (p0: Vector3, v0: Vector3, drag: number) => {
    const p = p0.clone(), v = v0.clone(), h = 1 / 60;
    let n = 0;
    for (let i = 1; i <= 120 && n < DOTS; i++) {
      v.y -= G * h;
      v.multiplyScalar(Math.pow(1 - drag, h));
      p.addScaledVector(v, h);
      // Up to the floor, a wall, or into the bin.
      if (p.y < 0.01 || p.z > z1 - 0.01 || p.x < x0 + 0.01 || p.x > x1 - 0.01) break;
      if (inBin(new Vec3(p.x, p.y, p.z))) break;
      if (i % 3) continue;
      const s = 0.011 * (1 - (n / DOTS) * 0.6);
      dots.setMatrixAt(n++, dm.makeScale(s, s, s).setPosition(p));
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
    dots.visible = n > 0;
  };
  let aim: { id: number; x: number; y: number; k: number; at: Vector3; v: Vector3 } | null = null;
  // Pull (pointer offset from the press) → power 0–1, heading, start point (the hand pulled back) and velocity.
  const pull = (dx: number, dy: number) => {
    const r = o.canvas.getBoundingClientRect();
    const k = Math.min(1, Math.hypot(dx, dy) / (Math.min(r.width, r.height) * 0.38));
    const yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, Math.atan2(-dx, Math.max(dy, 1)) * 0.6));
    const dir = fwd.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(right, Math.sin(yaw));
    const [s0, s1] = KINDS[kind].speed, speed = s0 + (s1 - s0) * k;
    const v = dir.clone().multiplyScalar(Math.cos(ELEV) * speed).addScaledVector(up, Math.sin(ELEV) * speed);
    const at = o.from.clone().addScaledVector(dir, -0.1 * k).addScaledVector(up, -0.04 * k);
    return { k, at, v };
  };

  // --- throws in the air and on the floor
  type Throw = { kind: Kind; body: Body; obj: Group; scored: boolean; t: number };
  const thrown: Throw[] = [];
  const fading: { obj: Group; mats: Material[]; t: number }[] = [];
  const settle = (s: Throw) => {
    if (s.scored || !inBin(s.body.position)) return;
    s.scored = true;
    made++;
    score();
    if (!o.reduceMotion) badge.animate([{ scale: 1 }, { scale: 1.18 }, { scale: 1 }], { duration: 420, easing: 'cubic-bezier(0.34, 1.8, 0.5, 1)' });
  };
  const retire = (s: Throw) => {
    world.removeBody(s.body);
    thrown.splice(thrown.indexOf(s), 1);
    if (o.reduceMotion) return void o.scene.remove(s.obj);
    const list: Material[] = [];
    s.obj.traverse((c) => {
      if (!(c instanceof Mesh)) return;
      const m = (c.material as Material).clone();
      m.transparent = true;
      m.userData.opacity = m.opacity;
      c.material = m;
      c.castShadow = false;
      list.push(m);
    });
    fading.push({ obj: s.obj, mats: list, t: performance.now() });
  };
  const throwIt = (at: Vector3, v: Vector3) => {
    const t = templates[kind]!, k = KINDS[kind];
    const body = new Body({ mass: k.mass, material: mats[kind], linearDamping: k.drag, angularDamping: kind === 'paper' ? 0.5 : 0.25, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.4 });
    addShapes(body, kind, t);
    body.position.set(at.x, at.y, at.z);
    body.quaternion.set(hand.quaternion.x, hand.quaternion.y, hand.quaternion.z, hand.quaternion.w);
    body.velocity.set(v.x, v.y, v.z);
    // End over end (about the sideways axis), with a little wobble.
    const w = right.clone().multiplyScalar(k.spin * (0.7 + Math.random() * 0.6));
    w.add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(k.spin * 0.5));
    body.angularVelocity.set(w.x, w.y, w.z);
    const obj = t.g.clone(true);
    obj.position.copy(at);
    obj.quaternion.copy(hand.quaternion);
    o.scene.add(obj);
    const s: Throw = { kind, body, obj, scored: false, t: performance.now() };
    body.addEventListener('sleep', () => settle(s));
    body.addEventListener('wakeup', () => (s.t = performance.now()));
    world.addBody(body);
    thrown.push(s);
    if (thrown.length > MAX) retire(thrown[0]);
    tries++;
    score();
    // The next one comes into the hand a moment later.
    ready = false;
    hand.visible = false;
    setTimeout(() => {
      ready = true;
      showHand();
    }, o.reduceMotion ? 0 : 350);
  };

  // --- pointer: these listen on the frame in the capture phase, so in the close-up they come before
  // the canvas's own handlers (orbit, hover bounce, chair, toys) and keep them out.
  o.frame.addEventListener(
    'pointerdown',
    (e) => {
      if (!on || e.target !== o.canvas) return;
      e.stopPropagation();
      if (aim || !ready || !templates[kind]) return;
      o.canvas.setPointerCapture(e.pointerId);
      aim = { id: e.pointerId, x: e.clientX, y: e.clientY, k: 0, at: o.from.clone(), v: new Vector3() };
      o.canvas.style.cursor = 'grabbing';
    },
    { capture: true },
  );
  o.frame.addEventListener(
    'pointermove',
    (e) => {
      if (!on || e.target !== o.canvas) return;
      e.stopPropagation();
      if (!aim || e.pointerId !== aim.id) return;
      Object.assign(aim, pull(e.clientX - aim.x, e.clientY - aim.y));
      hand.position.copy(aim.at);
      preview(aim.at, aim.v, KINDS[kind].drag);
      o.redraw();
    },
    { capture: true },
  );
  const release = (e: PointerEvent) => {
    if (!on || e.target !== o.canvas) return;
    e.stopPropagation();
    if (!aim || e.pointerId !== aim.id) return;
    const a = aim;
    aim = null;
    dots.visible = false;
    o.canvas.style.cursor = 'grab';
    // A short pull (or a cancelled one) puts it back in the hand.
    if (e.type === 'pointerup' && a.k > 0.06) throwIt(a.at, a.v);
    else hand.position.copy(o.from);
    o.redraw();
  };
  o.frame.addEventListener('pointerup', release, { capture: true });
  o.frame.addEventListener('pointercancel', release, { capture: true });

  const show = (v: boolean) => {
    on = v;
    buttons.forEach((b) => (b.hidden = !v));
    badge.hidden = !v;
    aim = null;
    dots.visible = false;
    o.canvas.style.cursor = v ? 'grab' : '';
    showHand();
  };
  return {
    /** The close-up has arrived: show the hand, the buttons and the score. */
    enter: () => show(true),
    /** The close-up is closing; what's been thrown stays where it lies. */
    leave: () => show(false),
    /** Advance by `dt` and move the throws; true while anything moves. */
    step(dt: number) {
      const now = performance.now();
      let moving = fading.length > 0;
      if (thrown.some((s) => s.body.sleepState !== Body.SLEEPING)) {
        world.step(STEP, dt, 8);
        for (const s of [...thrown]) {
          const b = s.body;
          s.obj.position.set(b.position.x, b.position.y, b.position.z);
          s.obj.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
          // Fallen out of the room: gone. Still rocking 10 s after it last woke: put to rest.
          if (b.position.y < -0.5) retire(s);
          else if (b.sleepState !== Body.SLEEPING && now - s.t > 10000) {
            b.sleep();
            settle(s);
          }
        }
        moving = true;
      }
      for (const f of [...fading]) {
        const k = 1 - (now - f.t) / 500;
        if (k > 0) {
          f.mats.forEach((m) => (m.opacity = m.userData.opacity * k));
          continue;
        }
        o.scene.remove(f.obj);
        f.mats.forEach((m) => m.dispose());
        fading.splice(fading.indexOf(f), 1);
      }
      return moving;
    },
  };
}
