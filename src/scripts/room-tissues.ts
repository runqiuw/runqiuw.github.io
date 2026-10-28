import { BufferAttribute, BufferGeometry, Mesh, Plane, Raycaster, Vector2, Vector3, type Intersection, type Material, type Object3D, type PerspectiveCamera } from 'three';

type Sheet = { mesh: Mesh<BufferGeometry, Material>; tip: Vector3; tail: Vector3; age: number; released: boolean; seed: number };

/** Small analytic cloth grids; loaded on the first desk visit, never simulated while idle. */
export function addTissues(packet: Object3D, canvas: HTMLCanvasElement, camera: PerspectiveCamera,
  enabled: () => boolean, surfaceAt: (e: PointerEvent) => Intersection | undefined, changed: () => void): { leave(): void } | undefined {
  if (packet.userData.tissues) return packet.userData.tissues;
  let source: Mesh | undefined;
  packet.traverse(o => { if (o instanceof Mesh && (o.material as Material).userData.role === 'fabric') source = o; });
  if (!source) return;
  source.visible = false;
  const material = source.material as Material;
  const cols = 8, rows = 12, root = new Vector3(0, .058, 0);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ray = new Raycaster(), ndc = new Vector2(), plane = new Plane(), point = new Vector3();
  const sheets: Sheet[] = [];
  let pointer = -1, active: Sheet | undefined, detached = false, raf = 0, last = 0, serial = 0;
  let ready = makeSheet();
  const offset = new Vector3(), goal = new Vector3();

  function makeSheet(): Sheet {
    const geo = new BufferGeometry(), count = (cols + 1) * (rows + 1);
    geo.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    // Match the existing, prewarmed fabric material's vertex-color format.
    const color = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) color.set([.97, .96, .92, 1], i * 4);
    geo.setAttribute('color', new BufferAttribute(color, 4));
    geo.setAttribute('_ao', new BufferAttribute(new Float32Array(count).fill(1), 1));
    const indices: number[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      indices.push(a, a + 1, a + cols + 2, a, a + cols + 2, a + cols + 1);
    }
    geo.setIndex(indices);
    const mesh = new Mesh(geo, material);
    mesh.name = 'tissue-ready'; mesh.castShadow = true; mesh.receiveShadow = true;
    packet.add(mesh);
    const sheet = { mesh, tip: root.clone().add(new Vector3(0, .043, -.008)), tail: root.clone(), age: 0, released: false, seed: serial++ };
    deform(sheet, false, 0);
    return sheet;
  }
  function deform(s: Sheet, free: boolean, motion: number) {
    const pos = s.mesh.geometry.getAttribute('position');
    const length = s.tip.distanceTo(s.tail), width = free ? .17 : .075;
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      for (let i = 0; i <= cols; i++) {
        const u = i / cols - .5, fold = Math.sin((u + .5) * Math.PI * 4 + v * 2);
        const spread = free ? width : width + Math.min(.095, Math.max(0, length - .045) * .7) * v;
        const flutter = (reduced ? 0 : motion) * Math.sin(v * 7 + s.seed + s.age * 7) * Math.sin(v * Math.PI);
        const x = s.tail.x * (1 - v) + s.tip.x * v + u * spread;
        const droop = free ? Math.pow(Math.abs(u) * 2, 1.3) * .023 * v * (s.released ? Math.max(0, 1 - s.age * 2) : 1) : 0;
        const y = s.tail.y * (1 - v) + s.tip.y * v + Math.sin(u * Math.PI * 2) * .004 * v + flutter * .005 - droop;
        const z = s.tail.z * (1 - v) + s.tip.z * v + fold * .004 + Math.sin(v * Math.PI) * .014;
        pos.setXYZ(j * (cols + 1) + i, x, y, z);
      }
    }
    pos.needsUpdate = true; s.mesh.geometry.computeVertexNormals(); s.mesh.geometry.computeBoundingSphere();
  }
  function cast(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2);
    packet.updateWorldMatrix(true, true); camera.updateMatrixWorld(); ray.setFromCamera(ndc, camera);
  }
  function wake() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); } }
  function remove(s: Sheet) { packet.remove(s.mesh); s.mesh.geometry.dispose(); }
  function consume(e: PointerEvent) { e.preventDefault(); e.stopImmediatePropagation(); }
  function release(e?: PointerEvent) {
    if (pointer < 0 || (e && e.pointerId !== pointer)) return;
    if (e) consume(e);
    const id = pointer; pointer = -1;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (active && detached) { active.released = true; active.age = 0; }
    active = undefined; detached = false; canvas.style.cursor = '';
    wake();
  }
  function reset() {
    release();
    for (const s of sheets.splice(0)) remove(s);
    ready.tip.copy(root).add(new Vector3(0, .043, -.008)); ready.tail.copy(root); deform(ready, false, 0);
    changed();
  }
  function step(now: number) {
    raf = 0;
    if (!enabled() || document.hidden) { reset(); return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    let moving = false;
    if (active) {
      const distance = active.tip.distanceTo(goal);
      active.tip.lerp(goal, 1 - Math.exp(-dt * 30));
      if (detached) {
        const target = active.tip.clone().add(new Vector3(-.015, -.17, .018));
        const lag = active.tail.distanceTo(target);
        active.tail.lerp(target, 1 - Math.exp(-dt * 12));
        moving ||= lag > .0002;
      }
      active.age += dt;
      deform(active, detached, Math.min(1, distance * 30)); moving ||= distance > .0002;
      canvas.style.cursor = 'grabbing';
    } else if (ready.tip.distanceTo(root.clone().add(new Vector3(0, .043, -.008))) > .0002) {
      ready.tip.lerp(root.clone().add(new Vector3(0, .043, -.008)), 1 - Math.exp(-dt * 18));
      deform(ready, false, 0); moving = true;
    }
    for (const s of [...sheets]) {
      if (!s.released) continue;
      s.age += dt;
      if (s.age > 3.8) { remove(s); sheets.splice(sheets.indexOf(s), 1); continue; }
      // Settle softly onto the clear left-front tabletop, above its actual surface.
      const center = s.tip.clone().add(s.tail).multiplyScalar(.5);
      center.x = Math.max(-.065, Math.min(.12, center.x));
      center.z = Math.max(.08, Math.min(.18, center.z));
      const rest = Math.max(-.74 + .743, root.y - Math.min(s.age * .18, .12));
      s.tip.lerp(new Vector3(center.x, rest, center.z - .085), 1 - Math.exp(-dt * 5));
      s.tail.lerp(new Vector3(center.x, rest, center.z + .085), 1 - Math.exp(-dt * 5));
      deform(s, true, Math.max(0, 1 - s.age));
      // Keep folds above the table, including the shrinking cleanup phase.
      const pos = s.mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(.003, pos.getY(i)));
      pos.needsUpdate = true;
      const k = Math.min(1, (3.8 - s.age) / .45);
      s.mesh.scale.setScalar(k); s.mesh.position.copy(center).multiplyScalar(1 - k);
      moving = true;
    }
    changed();
    if (moving) raf = requestAnimationFrame(step);
  }
  canvas.addEventListener('pointerdown', e => {
    if (!enabled() || pointer >= 0 || e.button !== 0) return;
    cast(e);
    const hit = ray.intersectObject(ready.mesh, false)[0]; if (!hit) return;
    const solid = surfaceAt(e);
    if (!solid || solid.distance < hit.distance - .002) return;
    consume(e); pointer = e.pointerId; active = ready; detached = false;
    const worldTip = packet.localToWorld(ready.tip.clone());
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), worldTip);
    if (!ray.ray.intersectPlane(plane, point)) { release(); return; }
    offset.copy(worldTip).sub(point); goal.copy(ready.tip);
    canvas.setPointerCapture(pointer); wake();
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (pointer < 0) {
      if (enabled()) {
        cast(e);
        if (ray.intersectObject(ready.mesh, false).length) requestAnimationFrame(() => { if (pointer < 0 && enabled()) canvas.style.cursor = 'grab'; });
      }
      return;
    }
    if (e.pointerId !== pointer) { consume(e); return; }
    consume(e);
    if (!enabled()) { reset(); return; }
    cast(e);
    if (!ray.ray.intersectPlane(plane, point)) return;
    goal.copy(packet.worldToLocal(point.add(offset)));
    goal.x = Math.max(-.16, Math.min(.3, goal.x)); goal.y = Math.max(root.y + .03, Math.min(.6, goal.y));
    goal.z = Math.max(-.3, Math.min(.4, goal.z));
    if (!detached && goal.distanceTo(root) > .17) {
      detached = true; active!.mesh.name = 'tissue-pulled';
      sheets.push(active!); ready = makeSheet();
      if (sheets.length > 4) remove(sheets.shift()!);
    }
    wake();
  }, true);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(event, release, true);
  // Closing the desk view and hiding the page both release even a motionless hold.
  document.addEventListener('visibilitychange', () => { if (document.hidden && (pointer >= 0 || sheets.length)) reset(); });
  changed();
  return packet.userData.tissues = { leave: reset };
}
