// Physics for the toys on the bed (the pillow and the school plushes), with cannon-es. Loaded by
// room.ts only when the full-screen room opens, so the page and the panel never pay for it.
// Plain rigid bodies, nothing added: each toy's center of mass is the middle of its collision
// shapes (not its model origin, which is the bottom edge and made them stand back up). The bed is a
// static mattress slab with the headboard behind it and a low lip around the open sides, which
// stops a toy sliding off but is too low to lean on; one that still goes over is put back on the
// bed. A held toy is pulled toward the pointer by its velocity (so it shoves the others) and keeps
// that velocity when let go, which is the throw. Bodies sleep when they settle; `step` reports
// whether anything still moves, so the room only renders while it does.
import { Body, Box, ContactMaterial, Material, Quaternion as CQuat, Sphere, Vec3, World } from 'cannon-es';
import type { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

/** One collision shape in the toy's own frame (three axes): a box (center, full size) or a sphere
 * (center, radius). Spheres along the silhouette hug a plush. */
export type ToyShape = { c: [number, number, number]; s: [number, number, number] } | { c: [number, number, number]; r: number };
export interface Toy {
  obj: Object3D;
  shapes: ToyShape[];
  mass: number;
}
export interface BedSpec {
  /** The bed's world matrix and rotation; the numbers below are in the bed's frame. */
  matrix: Matrix4;
  quaternion: Quaternion;
  /** Mattress top height and the usable top rectangle (x0..x1, z0..z1). */
  top: number;
  area: { x0: number; x1: number; z0: number; z1: number };
}

export function createToyWorld(bed: BedSpec, toys: Toy[], onImpact: (i: number, speed: number, mattress: boolean) => void) {
  const world = new World({ gravity: new Vec3(0, -9.82, 0) });
  world.allowSleep = true;
  const fabric = new Material('fabric');
  // Plush on plush and on the mattress: grippy and barely bouncy.
  world.addContactMaterial(new ContactMaterial(fabric, fabric, { friction: 0.6, restitution: 0.15 }));

  // Static bed, in the bed's frame turned into the world.
  const bq = new CQuat(bed.quaternion.x, bed.quaternion.y, bed.quaternion.z, bed.quaternion.w);
  const toWorld = (x: number, y: number, z: number) => {
    const e = bed.matrix.elements;
    return new Vec3(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
  };
  const { x0, x1, z0, z1 } = bed.area;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  // The area is inset 3 cm from the mattress edge; the lip sits on that edge.
  const T = 0.2, HEAD = 0.21, LIP = 0.02, E = 0.03, W = 0.01;
  const slab = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const b = new Body({ mass: 0, material: fabric, shape: new Box(new Vec3(sx, sy, sz)) });
    b.position.copy(toWorld(x, y, z));
    b.quaternion.copy(bq);
    world.addBody(b);
    return b;
  };
  const mattress = slab(cx, bed.top - T, cz, hx + E, T, hz + E);
  // The headboard (the head end is −z in the bed's frame), up to its real height.
  slab(cx, bed.top + HEAD, z0 - E - T, hx + E + 2 * W, HEAD, T);
  // A 4 cm lip along both sides and the foot.
  slab(x0 - E - W, bed.top + LIP, cz, W, LIP, hz + E);
  slab(x1 + E + W, bed.top + LIP, cz, W, LIP, hz + E);
  slab(cx, bed.top + LIP, z1 + E + W, hx + E + 2 * W, LIP, W);
  const inv = bed.matrix.clone().invert();

  // Each body's origin is the middle of its shapes; `off` is that point in the toy's own frame,
  // so the object (whose origin is its model origin) sits at body − rotation·off.
  const offs = toys.map((t) => {
    const o = new Vec3();
    for (const sh of t.shapes) o.vadd(new Vec3(...sh.c), o);
    return o.scale(1 / Math.max(1, t.shapes.length));
  });
  const bodies = toys.map((t, i) => {
    const b = new Body({ mass: t.mass, material: fabric, linearDamping: 0.1, angularDamping: 0.3, sleepSpeedLimit: 0.1, sleepTimeLimit: 0.5 });
    const off = offs[i];
    for (const sh of t.shapes) {
      const at = new Vec3(...sh.c).vsub(off);
      b.addShape('r' in sh ? new Sphere(sh.r) : new Box(new Vec3(sh.s[0] / 2, sh.s[1] / 2, sh.s[2] / 2)), at);
    }
    const q = t.obj.quaternion;
    b.quaternion.set(q.x, q.y, q.z, q.w);
    const p = b.quaternion.vmult(off).vadd(new Vec3(t.obj.position.x, t.obj.position.y, t.obj.position.z));
    b.position.copy(p);
    b.addEventListener('collide', (e: { body: Body; contact: { getImpactVelocityAlongNormal: () => number } }) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v > 0.4) onImpact(i, v, e.body === mattress);
    });
    world.addBody(b);
    // Start asleep where the scene put them, so opening the room doesn't jolt anything.
    b.sleep();
    return b;
  });

  let held = -1;
  // The held body's goal, and where its center is relative to the object's origin at the grab.
  const goal = new Vec3(), heldOff = new Vec3();
  const clampToBed = (p: Vector3, margin: number) => {
    const local = p.clone().applyMatrix4(inv);
    local.x = Math.min(x1 - margin, Math.max(x0 + margin, local.x));
    local.z = Math.min(z1 - margin, Math.max(z0 + margin, local.z));
    return local.applyMatrix4(bed.matrix);
  };
  const local = (p: Vec3) => {
    const e = inv.elements;
    return { x: e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12], y: e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13], z: e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14] };
  };
  return {
    /** Pick up toy `i`; `at` is where its object (origin) should float (world). */
    grab(i: number, at: Vector3) {
      held = i;
      const o = toys[i].obj.position;
      heldOff.set(bodies[i].position.x - o.x, bodies[i].position.y - o.y, bodies[i].position.z - o.z);
      goal.set(at.x, at.y, at.z).vadd(heldOff, goal);
      bodies[i].wakeUp();
    },
    /** Move the held toy's target (world, for its object), kept over the bed. */
    carry(at: Vector3) {
      const c = clampToBed(at, 0.12);
      goal.set(c.x, at.y, c.z).vadd(heldOff, goal);
    },
    /** Let go: it keeps its velocity (a throw), capped. */
    release() {
      if (held < 0) return;
      const v = bodies[held].velocity;
      if (v.length() > 5) v.scale(5 / v.length(), v);
      held = -1;
    },
    /** Let go over the nearest edge, set down gently. */
    setDown(at: Vector3) {
      if (held < 0) return;
      const b = bodies[held], c = clampToBed(at, 0.15);
      b.velocity.set((c.x - b.position.x) * 2, 0, (c.z - b.position.z) * 2);
      held = -1;
    },
    get held() {
      return held;
    },
    /** Advance by `dt` and copy the bodies to their objects; true while anything moves. */
    step(dt: number) {
      if (held >= 0) {
        const b = bodies[held];
        // Spring the held body toward the goal and keep it calm.
        b.velocity.set((goal.x - b.position.x) * 14, (goal.y - b.position.y) * 14, (goal.z - b.position.z) * 14);
        b.angularVelocity.scale(0.85, b.angularVelocity);
        b.wakeUp();
      }
      if (held < 0 && bodies.every((b) => b.sleepState === Body.SLEEPING)) return false;
      world.step(1 / 60, dt, 4);
      // One that went over the lip anyway is put back on the bed, dropped in from just above.
      for (const b of bodies) {
        const l = local(b.position);
        if (l.y > bed.top - 0.1 && l.x > x0 - 0.3 && l.x < x1 + 0.3 && l.z > z0 - 0.3 && l.z < z1 + 0.3) continue;
        const c = toWorld(Math.min(x1 - 0.15, Math.max(x0 + 0.15, l.x)), bed.top + 0.25, Math.min(z1 - 0.15, Math.max(z0 + 0.15, l.z)));
        b.position.copy(c);
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
      }
      bodies.forEach((b, i) => {
        const o = toys[i].obj, p = b.position.vsub(b.quaternion.vmult(offs[i]));
        o.position.set(p.x, p.y, p.z);
        o.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      });
      return true;
    },
  };
}
