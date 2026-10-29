// Trash-can basketball in the room's `hoops` close-up, with cannon-es. Loaded by room.ts the first
// time that close-up opens, so neither the page nor the room pays for it before.
// Paper, bottle and bouncy ball rotate automatically. Each round moves the throwing spot and its
// camera; shots outside the rug's three-point arc score three, others two. A fading guide uses the
// same collision world and release state as the throw, but omits the last fifth and any bounces.
// Downward entries through the rim count once, even when a lively ball bounces back out. The bin's side is a ring of thin boxes, so throws rattle on
// the rim and go in and out; the walls, the floor and the bed are there to bank off. Only the last
// MAX throws stay, the oldest fades out. Bodies sleep when they settle and `step` reports whether
// anything still moves, so the room only renders while it does.
import { Body, Box, ContactMaterial, Cylinder, Material as CMat, Plane, Quaternion as CQuat, Sphere, Vec3, World } from 'cannon-es';
import {
  Box3,
  BackSide,
  AlwaysStencilFunc,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  InstancedBufferAttribute,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  KeepStencilOp,
  NotEqualStencilFunc,
  type Object3D,
  type Scene,
  SphereGeometry,
  ReplaceStencilOp,
  TorusGeometry,
  Vector3,
  Vector2,
} from 'three';
import { HOOPS, type HoopsSpot, type Role } from './room.config';

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
  paper: { label: 'Paper ball', asset: 'ball_paper', colors: { fabric: '#f4f1e6' }, mass: 0.012, drag: 0.5, bounce: 0.05, friction: 0.9, spin: 3, speed: [1.6, 8.4] },
  // Light with its mass toward the cap: tumbles in the air, skids or kicks sideways when it lands.
  bottle: { label: 'Bottle', asset: 'bottle', colors: { glass: '#d4ecff', accent: '#3d5afe' }, mass: 0.02, drag: 0.12, bounce: 0.35, friction: 0.25, spin: 11, speed: [1.6, 7.4] },
  // Heavier and lively: banks off the wall and bounces off the floor.
  bouncy: { label: 'Bouncy ball', asset: 'ball_bouncy', colors: { accent: '#ff3d6e', frame: '#ffc93c' }, mass: 0.06, drag: 0.02, bounce: 0.82, friction: 0.6, spin: 2, speed: [1.6, 7.4] },
};
const MAX = 10;
const G = 9.82;
/** Launch angle above the horizon; the pull sets the heading and the speed. */
const MAX_YAW = 0.5;
const STEP = 1 / 120;
const CALLS = {
  two: ['NICE TOUCH!', 'COUNT IT!', 'BUCKETS!', 'TOO SMOOTH!', 'THAT’S MONEY!', 'RIGHT ON THE MONEY!'],
  three: ['FROM DOWNTOWN!', 'BANG!', 'FROM WAY OUT!', 'SPLASH!', 'HE’S GOT RANGE!', 'THREE BALL, CORNER POCKET!'],
  bankTwo: ['OFF THE GLASS!', 'BANK IS OPEN!', 'KISSED IT OFF THE GLASS!', 'A LITTLE HELP FROM THE GLASS!'],
  bankThree: ['BANKED IN FROM DEEP!', 'THREE OFF THE GLASS!', 'THE BANK IS OPEN FROM DOWNTOWN!', 'CALLED GLASS!'],
};

/** Keep the actual release point at (50%, 62%) of the canvas, at every angle and aspect. */
export function hoopsView(from: Vector3, target: Vector3, aspect: number, eye?: number, obstacles: Box3[] = []) {
  const away = from.clone().sub(target).setY(0).normalize();
  const distance = Math.hypot(from.x - target.x, from.z - target.z);
  // Shorten the dolly along its own ray before reaching a wall. Clamping x/z independently
  // rotates the view away from the flight plane and can put the rim outside a portrait frame.
  let back = 0.6 + distance * 0.18;
  for (const [at, dir, min, max] of [[from.x, away.x, 0.35, from.z < -1.65 ? 3.25 : 3.88], [from.z, away.z, -3.35, -0.2]]) {
    if (dir > 0) back = Math.min(back, (max - at) / dir);
    else if (dir < 0) back = Math.min(back, (min - at) / dir);
  }
  back = Math.max(0.08, back);
  const p = from.clone().addScaledVector(away, back);
  const side = new Vector3(-away.z, 0, away.x);
  p.addScaledVector(side, (from.x > 2.5 ? -1 : 1) * Math.min(0.2, back * 0.18));
  p.x = Math.max(0.35, Math.min(3.88, p.x));
  p.z = Math.max(-3.35, Math.min(-0.2, p.z));
  // The room narrows behind the closet front; keep the eye clear of its wall thickness.
  if (p.z < -1.65) p.x = Math.min(p.x, 3.25);
  p.y = eye ?? Math.min(2.4, from.y + back * 0.6);
  for (const box of obstacles) {
    if (p.x >= box.min.x - 0.08 && p.x <= box.max.x + 0.08 && p.z >= box.min.z - 0.08 && p.z <= box.max.z + 0.08 && p.y < box.max.y + 0.12)
      p.y = box.max.y + 0.12;
  }
  const fov = eye ? (aspect < 0.8 ? 88 : 80) : Math.min(84, 50 + distance * 10 + (aspect < 0.8 ? 8 : 0));
  const look = from.clone().sub(p).normalize();
  const right = look.clone().cross(new Vector3(0, 1, 0)).normalize();
  const vertical = right.cross(look).normalize();
  const pitch = Math.atan(0.24 * Math.tan(fov * Math.PI / 360));
  const t = p.clone().add(look.multiplyScalar(Math.cos(pitch)).addScaledVector(vertical, Math.sin(pitch)));
  return { p, t, fov };
}

// One silhouette for the whole prop, independent of material splits (cap/body/label). Weld
// positions before recomputing normals so pixel-sized expansion cannot make spikes at hard seams.
function silhouetteGeometry(root: Object3D) {
  root.updateMatrixWorld(true);
  const vertices: number[] = [], triangles: number[] = [], welded = new Map<string, number>();
  const point = new Vector3();
  root.traverse((part) => {
    if (!(part instanceof Mesh)) return;
    const position = part.geometry.getAttribute('position'), index = part.geometry.index;
    const remap: number[] = [];
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld);
      const key = `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${Math.round(point.z * 1e5)}`;
      let id = welded.get(key);
      if (id === undefined) {
        id = vertices.length / 3;
        welded.set(key, id);
        vertices.push(point.x, point.y, point.z);
      }
      remap.push(id);
    }
    const flipped = part.matrixWorld.determinant() < 0;
    for (let i = 0, count = index?.count ?? position.count; i < count; i += 3) {
      const a = remap[index ? index.getX(i) : i], b = remap[index ? index.getX(i + 1) : i + 1], c = remap[index ? index.getX(i + 2) : i + 2];
      triangles.push(a, flipped ? c : b, flipped ? b : c);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  return geometry;
}

export interface HoopsSpec {
  scene: Scene;
  canvas: HTMLCanvasElement;
  frame: HTMLElement;
  /** The close-up's button bar, where the turn label goes. */
  bar: HTMLElement;
  /** The bin's world box (it stands on the floor), and its inner radius at the rim if known. */
  bin: Box3;
  binR?: number;
  backboard?: Box3;
  /** Move the camera behind this round's throwing spot; the game waits for the transition. */
  view: (from: Vector3, target: Vector3, spot: HoopsSpot) => void;
  /** The room's walls: world x and z of each side. */
  room: { x0: number; x1: number; z0: number; z1: number; height?: number };
  /** Furniture to bank off (world boxes). */
  boxes: Box3[];
  /** An asset's model, or null if it isn't exported (a stand-in takes its place). */
  load: (asset: string) => Promise<Object3D | null>;
  /** Give an asset's parts the room's role materials. */
  dress: (o: Object3D, colors?: Partial<Record<Role, string>>) => void;
  reduceMotion: boolean;
  redraw: () => void;
  /** The thrown bodies changed position or shadow-casting state. */
  shadowChanged?: () => void;
  /** Prepare meshes' shader programs in small background jobs (the room's warmup queue). */
  prepare?: (meshes: Mesh[]) => Promise<unknown>;
}

export function createHoops(o: HoopsSpec) {
  const world = new World({ gravity: new Vec3(0, -G, 0) });
  const prediction = new World({ gravity: new Vec3(0, -G, 0) });
  world.allowSleep = true;
  Object.assign(world.defaultContactMaterial, { friction: 0.4, restitution: 0.3 });
  Object.assign(prediction.defaultContactMaterial, { friction: 0.4, restitution: 0.3 });
  const solid = new CMat('room');
  const mats = Object.fromEntries(
    (Object.keys(KINDS) as Kind[]).map((k) => {
      const m = new CMat(k);
      const contact = new ContactMaterial(m, solid, { friction: KINDS[k].friction, restitution: KINDS[k].bounce });
      world.addContactMaterial(contact);
      prediction.addContactMaterial(contact);
      return [k, m];
    }),
  ) as Record<Kind, CMat>;

  // --- static colliders: floor and walls (planes facing into the room), furniture, the bin
  const fixed = (shape: Plane | Box, p: Vec3, q?: CQuat) => {
    const b = new Body({ mass: 0, material: solid, shape });
    b.position.copy(p);
    if (q) b.quaternion.copy(q);
    world.addBody(b);
    // Independent bodies/shapes: aiming must never advance or mutate the live world.
    const twin = new Body({ mass: 0, material: solid, shape: shape instanceof Box ? new Box(shape.halfExtents.clone()) : new Plane() });
    twin.position.copy(b.position);
    twin.quaternion.copy(b.quaternion);
    prediction.addBody(twin);
    return b;
  };
  const { x0, x1, z0, z1 } = o.room;
  let frontWall: Body;
  for (const [n, p] of [
    [[0, 1, 0], [0, 0, 0]],
    [[0, -1, 0], [0, o.room.height ?? 2.7, 0]],
    [[1, 0, 0], [x0, 0, 0]],
    [[-1, 0, 0], [x1, 0, 0]],
    [[0, 0, 1], [0, 0, z0]],
    [[0, 0, -1], [0, 0, z1]],
  ] as [number, number, number][][]) {
    const wall = fixed(new Plane(), new Vec3(...p), new CQuat().setFromVectors(new Vec3(0, 0, 1), new Vec3(...n)));
    if (n[2] === -1) frontWall = wall;
  }
  for (const b of o.boxes) {
    const c = b.getCenter(new Vector3()), s = b.getSize(new Vector3()).multiplyScalar(0.5);
    fixed(new Box(new Vec3(s.x, s.y, s.z)), new Vec3(c.x, c.y, c.z));
  }
  // The bin: tapered, its side a ring of thin boxes whose inner faces lie on its inner surface (the
  // floor is its bottom). Thicker than the real wall, so a fast ball can't pass through in one step.
  const bc = o.bin.getCenter(new Vector3()), bs = o.bin.getSize(new Vector3());
  const rTop = o.binR ?? Math.max(bs.x, bs.z) / 2 - 0.012, rBot = rTop * 0.85, binH = bs.y;
  const N = 14, th = 0.008, tilt = Math.atan((rTop - rBot) / binH);
  const binWalls = new Set<Body>();
  for (let i = 0; i < N; i++) {
    // A few mm inside the surface: the flat segments stick out past the round wall at their ends.
    const a = (i / N) * Math.PI * 2, r = (rTop + rBot) / 2 + th - 0.003;
    const q = new CQuat().setFromAxisAngle(new Vec3(0, 1, 0), Math.PI / 2 - a).mult(new CQuat().setFromAxisAngle(new Vec3(1, 0, 0), tilt));
    binWalls.add(fixed(new Box(new Vec3(rTop * Math.tan(Math.PI / N) * 1.1, binH / 2 / Math.cos(tilt), th)), new Vec3(bc.x + Math.cos(a) * r, o.bin.min.y + binH / 2, bc.z + Math.sin(a) * r), q));
  }

  // --- projectiles: each kind's model centred on its center of mass (the body's origin)
  type Template = { g: Group; size: Vector3; com: number; silhouette: BufferGeometry };
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
    return { g, size, com, silhouette: silhouetteGeometry(g) };
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
  const from = new Vector3(), fwd = new Vector3(), right = new Vector3();

  let kind: Kind = 'paper';
  let on = false, ready = false, made = 0, tries = 0, total = 0, round = 0;
  let readyAt: number | null = null;
  let shotPoints: 2 | 3 = 2, spotId = '', elevation = 52 * Math.PI / 180;
  let pending: Throw | null = null;
  let nextAt = 0;
  let deck: number[] = [];
  // The projectile in hand, waiting at the throwing spot.
  const hand = new Group();
  hand.name = 'hoops-hand';
  hand.visible = false;
  o.scene.add(hand);
  // Mark the complete visible prop, then draw only the thin rim outside it. The stencil keeps
  // the highlight out of transparent glass and internal joins; no screen render target is needed.
  const rect = o.canvas.getBoundingClientRect();
  const outlineViewport = { value: new Vector2(rect.width, rect.height) };
  const outlineMask = new MeshBasicMaterial({ side: DoubleSide, colorWrite: false, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: AlwaysStencilFunc,
    stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: ReplaceStencilOp });
  const outlineNeon = new MeshBasicMaterial({ color: '#43ead5', side: BackSide, toneMapped: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: NotEqualStencilFunc, stencilWriteMask: 0,
    stencilFail: KeepStencilOp, stencilZFail: KeepStencilOp, stencilZPass: KeepStencilOp });
  outlineNeon.onBeforeCompile = (shader) => {
    shader.uniforms.heldViewport = outlineViewport;
    shader.vertexShader = 'uniform vec2 heldViewport;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec2 rimDirection = (normalMatrix * normal).xy;
      rimDirection /= max(length(rimDirection), 0.00001);
      gl_Position.xy += rimDirection * (2.0 * 1.8 / heldViewport) * gl_Position.w;
    `);
  };
  const heldModel = (t: Template) => {
    const g = t.g.clone(true);
    g.traverse((part) => { if (part instanceof Mesh) part.renderOrder = 12; });
    const mask = new Mesh(t.silhouette, outlineMask), rim = new Mesh(t.silhouette, outlineNeon);
    mask.name = 'held-mask';
    rim.name = 'held-outline';
    mask.renderOrder = 10;
    rim.renderOrder = 11;
    mask.raycast = rim.raycast = () => {};
    g.add(mask, rim);
    return g;
  };
  const showHand = () => {
    hand.clear();
    const t = templates[kind];
    if (t) hand.add(heldModel(t));
    hand.position.copy(from);
    // The bottle is held tilted forward, cap first.
    hand.rotation.set(kind === 'bottle' ? 1.1 : 0, 0, 0);
    hand.visible = on && ready && !!t;
    o.redraw();
  };
  for (const k of Object.keys(KINDS) as Kind[])
    o.load(KINDS[k].asset).then((m) => {
      templates[k] = make(k, m);
      warm(heldModel(templates[k]!));
      if (k === kind) showHand();
    });

  // --- UI: automatic turn indicator, score and a brief two-/three-point celebration
  const turn = document.createElement('p');
  turn.className = 'hoops-turn';
  turn.hidden = true;
  turn.setAttribute('aria-live', 'polite');
  o.bar.append(turn);
  const describe = (phase: 'moving' | 'ready' | 'flight' | 'result') => {
    Object.assign(turn.dataset, { kind, points: String(shotPoints), round: String(round), phase, spot: spotId,
      distance: String(Math.hypot(from.x - bc.x, from.z - bc.z)) });
    turn.textContent = `${KINDS[kind].label} · ${shotPoints} PT${phase === 'moving' ? ' · Next shot…' : phase === 'flight' ? ' · In flight' : phase === 'result' ? ' · Next shot soon…' : ' · Drag back, let go'}`;
  };
  const badge = document.createElement('p');
  badge.className = 'hoops-score';
  badge.hidden = true;
  badge.setAttribute('aria-live', 'polite');
  o.frame.append(badge);
  const power = document.createElement('div');
  power.className = 'hoops-power';
  power.hidden = true;
  power.setAttribute('role', 'meter');
  power.setAttribute('aria-label', 'Shot power');
  power.setAttribute('aria-valuemin', '0');
  power.setAttribute('aria-valuemax', '100');
  const powerLabel = document.createElement('span'), powerTrack = document.createElement('span'), powerFill = document.createElement('span');
  powerTrack.className = 'hoops-power-track';
  powerFill.className = 'hoops-power-fill';
  powerTrack.append(powerFill);
  power.append(powerLabel, powerTrack);
  o.frame.append(power);
  const score = () => {
    Object.assign(badge.dataset, { total: String(total), made: String(made), attempts: String(tries) });
    badge.textContent = `${total} PTS · Made ${made} / ${tries}`;
  };
  score();
  const toast = document.createElement('p');
  toast.className = 'hoops-basket';
  toast.hidden = true;
  toast.setAttribute('role', 'status');
  o.frame.append(toast);
  let toastUntil = 0;
  let toastAnimation: Animation | null = null;

  const nextRound = (rotate: boolean) => {
    if (pending) pending.scorable = false;
    pending = null;
    nextAt = 0;
    delete turn.dataset.outcome;
    if (rotate) kind = (['paper', 'bottle', 'bouncy'] as Kind[])[tries % 3];
    round++;
    if (!deck.length) {
      deck = HOOPS.spots.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      // Start a new game close enough to learn the controls; later decks stay fully shuffled.
      if (round === 1) {
        deck.splice(deck.indexOf(0), 1);
        deck.push(0);
      }
    }
    const spot = HOOPS.spots[deck.pop()!];
    spotId = spot.id;
    elevation = (spot.elevation ?? 52) * Math.PI / 180;
    from.set(bc.x + spot.at[0], spot.at[2], bc.z - spot.at[1]);
    fwd.set(bc.x - from.x, 0, bc.z - from.z).normalize();
    right.crossVectors(fwd, up);
    shotPoints = Math.hypot(from.x - bc.x, from.z - bc.z) > HOOPS.threeRadius ? 3 : 2;
    ready = false;
    readyAt = performance.now() + (o.reduceMotion ? 0 : HOOPS.cameraMs);
    describe('moving');
    showHand();
    o.view(from.clone(), new Vector3(bc.x, o.bin.max.y, bc.z), spot);
  };

  const beadGeo = new SphereGeometry(1, 8, 6), ringGeo = new TorusGeometry(1, 0.025, 6, 48);
  type Burst = { group: Group; beads: InstancedMesh; rings: Mesh[]; velocities: Vector3[]; t: number; duration: number };
  const bursts: Burst[] = [];
  let lastCall = '';
  const celebrate = (points: 2 | 3, bank: boolean) => {
    const pool = bank ? points === 3 ? CALLS.bankThree : CALLS.bankTwo : points === 3 ? CALLS.three : CALLS.two;
    const choices = pool.filter((line) => line !== lastCall);
    lastCall = choices[Math.floor(Math.random() * choices.length)];
    toast.textContent = `${lastCall} +${points}`;
    toast.dataset.points = String(points);
    toast.dataset.style = bank ? 'bank' : 'direct';
    toast.hidden = !on;
    toastUntil = performance.now() + HOOPS.resultMs;
    toastAnimation?.cancel();
    if (o.reduceMotion) return;
    toastAnimation = toast.animate([
      { opacity: 0, transform: 'translate(-50%, 16px) scale(0.65)' },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1.1)', offset: 0.2 },
      { opacity: 1, transform: 'translate(-50%, -4px) scale(1)', offset: 0.7 },
      { opacity: 0, transform: 'translate(-50%, -26px) scale(1)' },
    ], { duration: HOOPS.resultMs, easing: 'ease-out', fill: 'forwards' });
    const color = points === 3 ? '#ffbe3d' : '#32c9a3', count = points === 3 ? 28 : 12;
    const group = new Group();
    group.position.set(bc.x, o.bin.max.y + 0.04, bc.z);
    const beads = new InstancedMesh(beadGeo, new MeshBasicMaterial({ color, transparent: true, toneMapped: false }), count);
    beads.frustumCulled = false;
    beads.raycast = () => {};
    group.add(beads);
    const rings = Array.from({ length: points === 3 ? 2 : 1 }, (_, i) => {
      const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: i ? '#ff5a84' : color, transparent: true, toneMapped: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.raycast = () => {};
      group.add(ring);
      return ring;
    });
    const velocities = Array.from({ length: count }, (_, i) => {
      const a = i / count * Math.PI * 2, speed = (points === 3 ? 0.9 : 0.5) * (0.7 + Math.random() * 0.5);
      return new Vector3(Math.cos(a) * speed, 0.8 + Math.random() * (points === 3 ? 1.1 : 0.5), Math.sin(a) * speed);
    });
    bursts.push({ group, beads, rings, velocities, t: performance.now(), duration: points === 3 ? 1.2 : 0.85 });
    o.scene.add(group);
    o.redraw();
  };

  // Both the live projectile and preview start from EXACTLY this state. Spin is deterministic;
  // the changing position/material already supplies variety, without hidden release randomness.
  const projectileBody = (k: Kind, at: Vector3, v: Vector3) => {
    const spec = KINDS[k];
    const body = new Body({ mass: spec.mass, material: mats[k], linearDamping: spec.drag,
      angularDamping: k === 'paper' ? 0.5 : 0.25, sleepSpeedLimit: 0.08, sleepTimeLimit: 0.4 });
    addShapes(body, k, templates[k]!);
    body.position.set(at.x, at.y, at.z);
    body.quaternion.set(hand.quaternion.x, hand.quaternion.y, hand.quaternion.z, hand.quaternion.w);
    body.velocity.set(v.x, v.y, v.z);
    body.angularVelocity.set(right.x * spec.spin, right.y * spec.spin, right.z * spec.spin);
    return body;
  };

  // --- aiming: show enough curvature to judge power, without an exact impact/landing marker
  const DOTS = 16;
  const guideGeo = new SphereGeometry(1, 8, 6);
  const guideAlpha = new InstancedBufferAttribute(new Float32Array(DOTS), 1);
  guideGeo.setAttribute('aimOpacity', guideAlpha);
  const guideMat = new MeshBasicMaterial({ color: '#ff5a4e', toneMapped: false, transparent: true, depthWrite: false });
  guideMat.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aimOpacity; varying float vAimOpacity;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAimOpacity = aimOpacity;');
    shader.fragmentShader = 'varying float vAimOpacity;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAimOpacity;');
  };
  const dots = new InstancedMesh(guideGeo, guideMat, DOTS);
  dots.frustumCulled = false;
  dots.visible = false;
  dots.raycast = () => {};
  o.scene.add(dots);
  // Draw what the first aim, throw and result would otherwise compile on the spot: each held prop
  // with its outline, the guide dots and a celebration, hidden, through the room's warmup queue.
  // The warm-up materials are never disposed, so their programs stay cached for the real ones.
  let effectsWarmed = false;
  const warm = (g: Object3D) => {
    if (!o.prepare) return;
    if (!effectsWarmed) {
      effectsWarmed = true;
      g.add(
        new InstancedMesh(beadGeo, new MeshBasicMaterial({ transparent: true, toneMapped: false }), 1),
        new Mesh(ringGeo, new MeshBasicMaterial({ transparent: true, toneMapped: false })),
      );
    }
    g.visible = false;
    o.scene.add(g);
    const meshes: Mesh[] = [dots];
    g.traverse((x) => { if (x instanceof Mesh) meshes.push(x); });
    void o.prepare(meshes).catch(() => {}).finally(() => o.scene.remove(g));
  };
  const dm = new Matrix4();
  const preview = (p0: Vector3, v0: Vector3) => {
    const ghost = projectileBody(kind, p0, v0), flight = [p0.clone()];
    ghost.allowSleep = false;
    let hit = false;
    ghost.addEventListener('collide', () => (hit = true));
    prediction.addBody(ghost);
    for (let i = 0; i < 240; i++) {
      prediction.step(STEP);
      if (hit) break;
      flight.push(new Vector3(ghost.position.x, ghost.position.y, ghost.position.z));
    }
    prediction.removeBody(ghost);
    const end = (flight.length - 1) * 0.82;
    const count = Math.min(DOTS, Math.floor(end));
    const p = new Vector3();
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / count, at = t * end, j = Math.floor(at), s = 0.011 * (1 - t * 0.45);
      p.lerpVectors(flight[j], flight[Math.min(j + 1, flight.length - 1)], at - j);
      dots.setMatrixAt(i, dm.makeScale(s, s, s).setPosition(p));
      guideAlpha.setX(i, Math.pow(1 - t * 0.94, 1.5));
    }
    dots.count = count;
    guideAlpha.needsUpdate = true;
    dots.instanceMatrix.needsUpdate = true;
    dots.visible = count > 0;
  };
  let aim: { id: number; x: number; y: number; k: number; at: Vector3; v: Vector3 } | null = null;
  // Pull (pointer offset from the press) → power 0–1, heading, start point (the hand pulled back) and velocity.
  const pull = (dx: number, dy: number) => {
    const r = o.canvas.getBoundingClientRect();
    // Separate axes: steering must not secretly add power, nor swing wildly on a short pull.
    const span = Math.min(r.width, r.height);
    const k = Math.max(0, Math.min(1, dy / (span * HOOPS.pullSpan)));
    const yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, -dx / (span * 0.3)));
    const dir = fwd.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(right, Math.sin(yaw));
    const [s0, s1] = KINDS[kind].speed, speed = s0 + (s1 - s0) * k;
    const v = dir.clone().multiplyScalar(Math.cos(elevation) * speed).addScaledVector(up, Math.sin(elevation) * speed);
    const at = from.clone();
    return { k, at, v };
  };

  // --- throws in the air and on the floor
  type Throw = { kind: Kind; body: Body; obj: Group; scored: boolean; scorable: boolean; bank: boolean; ended: boolean; t: number; points: 2 | 3; previous: Vec3 };
  const thrown: Throw[] = [];
  const fading: { obj: Group; mats: Material[]; t: number }[] = [];
  const finish = (s: Throw, made = false, reason: 'contact' | 'timeout' = 'contact') => {
    if (!on || pending !== s || (s.ended && !made)) return;
    s.ended = true;
    turn.dataset.outcome = made ? 'basket' : reason;
    nextAt = performance.now() + HOOPS.resultMs;
    describe('result');
  };
  const basket = (s: Throw) => {
    if (s.scored || !s.scorable) return;
    s.scored = true;
    made++;
    total += s.points;
    score();
    if (on) celebrate(s.points, s.bank);
    finish(s, true);
  };
  // Check every fixed physics step, including a fast rim entry and bounce inside one display frame.
  world.addEventListener('postStep', () => {
    for (const s of thrown) {
      const b = s.body;
      if (s.scorable && !s.scored && s.previous.y >= o.bin.max.y && b.position.y < o.bin.max.y && b.velocity.y < 0) {
        const k = (s.previous.y - o.bin.max.y) / (s.previous.y - b.position.y);
        const x = s.previous.x + (b.position.x - s.previous.x) * k;
        const z = s.previous.z + (b.position.z - s.previous.z) * k;
        if (Math.hypot(x - bc.x, z - bc.z) < rTop - 0.01) basket(s);
      }
      s.previous.copy(b.position);
    }
  });
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
    const t = templates[kind]!, body = projectileBody(kind, at, v);
    const obj = t.g.clone(true);
    obj.position.copy(at);
    obj.quaternion.copy(hand.quaternion);
    o.scene.add(obj);
    const s: Throw = { kind, body, obj, scored: false, scorable: true, bank: false, ended: false, t: performance.now(), points: shotPoints, previous: body.position.clone() };
    body.addEventListener('collide', (e: { body: Body }) => {
      const b = o.backboard, p = body.position;
      if (e.body === frontWall && b && p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y) s.bank = true;
      else {
        // A rim rattle can still drop in during the result hold. A floor/furniture/wall hit
        // closes scoring immediately, so an already-finished miss cannot score a late rebound.
        if (!binWalls.has(e.body)) s.scorable = false;
        finish(s);
      }
    });
    world.addBody(body);
    thrown.push(s);
    if (thrown.length > MAX) retire(thrown[0]);
    tries++;
    score();
    pending = s;
    ready = false;
    readyAt = null;
    hand.visible = false;
    describe('flight');
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
      aim = { id: e.pointerId, x: e.clientX, y: e.clientY, k: 0, at: from.clone(), v: new Vector3() };
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
      preview(aim.at, aim.v);
      power.hidden = false;
      powerLabel.textContent = `Power ${Math.round(aim.k * 100)}%`;
      power.setAttribute('aria-valuenow', String(Math.round(aim.k * 100)));
      powerFill.style.transform = `scaleX(${aim.k})`;
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
    power.hidden = true;
    o.canvas.style.cursor = 'grab';
    // A short pull (or a cancelled one) puts it back in the hand.
    if (e.type === 'pointerup' && a.k > 0.06) throwIt(a.at, a.v);
    else hand.position.copy(from);
    o.redraw();
  };
  o.frame.addEventListener('pointerup', release, { capture: true });
  o.frame.addEventListener('pointercancel', release, { capture: true });

  const show = (v: boolean) => {
    on = v;
    turn.hidden = !v;
    badge.hidden = !v;
    toast.hidden = true;
    power.hidden = true;
    toastAnimation?.cancel();
    toastAnimation = null;
    aim = null;
    dots.visible = false;
    o.canvas.style.cursor = v ? 'grab' : '';
    if (v) nextRound(false);
    else {
      if (pending) pending.scorable = false;
      pending = null;
      nextAt = 0;
      ready = false;
      readyAt = null;
      hand.visible = false;
    }
    o.redraw();
  };
  return {
    resize: (width: number, height: number) => outlineViewport.value.set(Math.max(1, width), Math.max(1, height)),
    /** The close-up has arrived: pick a position, move the camera and prepare the hand. */
    enter: () => show(true),
    /** The close-up is closing; what's been thrown stays where it lies. */
    leave: () => show(false),
    /** Advance by `dt` and move the throws; true while anything moves. */
    step(dt: number) {
      const now = performance.now();
      let moving = fading.length > 0 || bursts.length > 0;
      if (on && nextAt && now >= nextAt) {
        nextRound(true);
        moving = true;
      }
      // Only a fail-safe: normal rounds end on a make or actual non-backboard contact.
      if (pending && !pending.ended && now - pending.t > 8000) finish(pending, false, 'timeout');
      if (on && readyAt !== null && now >= readyAt) {
        readyAt = null;
        ready = true;
        describe('ready');
        showHand();
        moving = true;
      }
      if (toastUntil && now >= toastUntil) {
        toastUntil = 0;
        toast.hidden = true;
        toastAnimation?.cancel();
        toastAnimation = null;
      }
      if (thrown.some((s) => s.body.sleepState !== Body.SLEEPING)) {
        world.step(STEP, dt, 8);
        for (const s of [...thrown]) {
          const b = s.body;
          s.obj.position.set(b.position.x, b.position.y, b.position.z);
          s.obj.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
          // Fallen out of the room: gone. Cap post-launch fidgeting at 10 s; contact wake/sleep
          // cycles on the bed or between old throws must not continually renew that budget.
          if (b.position.y < -0.5) retire(s);
          else if (b.sleepState !== Body.SLEEPING && now - s.t > 10000) {
            b.sleep();
          }
        }
        o.shadowChanged?.();
        moving = true;
      }
      for (const burst of [...bursts]) {
        const t = (now - burst.t) / 1000, k = t / burst.duration;
        if (k >= 1) {
          o.scene.remove(burst.group);
          (burst.beads.material as Material).dispose();
          burst.beads.dispose();
          burst.rings.forEach((r) => (r.material as Material).dispose());
          bursts.splice(bursts.indexOf(burst), 1);
          continue;
        }
        burst.velocities.forEach((v, i) => {
          const size = 0.018 * (1 - k);
          burst.beads.setMatrixAt(i, dm.makeScale(size, size, size).setPosition(v.x * t, v.y * t - 1.8 * t * t, v.z * t));
        });
        burst.beads.instanceMatrix.needsUpdate = true;
        (burst.beads.material as Material).opacity = 1 - k;
        burst.rings.forEach((r, i) => {
          r.scale.setScalar(0.12 + k * (0.55 + i * 0.2));
          r.position.y = 0.04 + k * (0.12 + i * 0.1);
          (r.material as Material).opacity = (1 - k) * 0.8;
        });
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
