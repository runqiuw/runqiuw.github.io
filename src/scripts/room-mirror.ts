import { Color, Matrix4, Mesh, PlaneGeometry, Vector3, Vector4, type Material, type Object3D, type Scene } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

/** A planar mirror fitted to the leaning glass, including the room's cut-away walls. */
export function addRoomMirror(frame: Object3D, scene: Scene, ceiling: Object3D) {
  const glass: Mesh[] = [];
  frame.traverse(o => {
    if (o instanceof Mesh && (o.material as Material).userData.role === 'glass') glass.push(o);
  });
  frame.updateWorldMatrix(true, true);
  const points: Vector3[] = [];
  for (const m of glass) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) points.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
  }
  if (!points.length) return;
  const center = points.reduce((a, p) => a.add(p), new Vector3()).divideScalar(points.length);
  const across = new Vector3(1, 0, 0).transformDirection(frame.matrixWorld);
  const front = new Vector3(0, 0, 1).transformDirection(frame.matrixWorld);
  const vertical = new Vector3(0, 1, 0);
  // Principal direction in the glass's height/depth plane captures its baked-in lean.
  let yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const d = p.clone().sub(center), y = d.dot(vertical), z = d.dot(front);
    yy += y * y; yz += y * z; zz += z * z;
  }
  const angle = Math.atan2(2 * yz, yy - zz) / 2;
  const up = vertical.multiplyScalar(Math.cos(angle)).addScaledVector(front, Math.sin(angle)).normalize();
  const normal = new Vector3().crossVectors(across, up).normalize();
  if (normal.dot(front) < 0) normal.negate();
  const span = (axis: Vector3) => {
    const values = points.map(p => p.clone().sub(center).dot(axis));
    return [Math.min(...values), Math.max(...values)];
  };
  const [x0, x1] = span(across), [y0, y1] = span(up), [, depth] = span(normal);
  const mirror = new Reflector(new PlaneGeometry(x1 - x0 - .005, y1 - y0 - .006), {
    textureWidth: 1024, textureHeight: 1024, multisample: 2,
    // Overlay at linear 0.5 leaves reflected colours unchanged.
    color: new Color(.5, .5, .5), clipBias: .001,
  });
  mirror.name = 'mirror-reflection';
  // The frame can appear immediately; don't enter the reflection pass until its programs
  // have been drawn in small idle batches. The main canvas uses different shader variants.
  mirror.visible = false;
  mirror.getRenderTarget().stencilBuffer = true;
  mirror.position.copy(center).addScaledVector(across, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2).addScaledVector(normal, depth + .0008);
  mirror.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(new Vector3().crossVectors(up, normal), up, normal));
  mirror.raycast = () => {};
  // Deliberately removed glass must not be made visible again by off-screen shader warmup.
  glass.forEach(m => m.removeFromParent());
  frame.attach(mirror);
  mirror.geometry.computeBoundingBox();
  const box = mirror.geometry.boundingBox!, clip = new Vector4();
  const reflect = mirror.onBeforeRender.bind(mirror);
  mirror.onBeforeRender = (...args: Parameters<typeof reflect>) => {
    if (mirror.userData.ghost) return;
    // Projective reflections sample a small part of a full camera image. Match the canvas
    // rather than the mirror's aspect ratio, otherwise a tall mirror magnifies coarse pixels.
    const canvas = args[0].domElement, target = mirror.getRenderTarget();
    const width = Math.min(2048, Math.max(512, canvas.width));
    const height = Math.min(2048, Math.max(512, canvas.height));
    if (target.width !== width || target.height !== height) target.setSize(width, height);
    // Reflection reverses the camera's horizontal axis on the glass plane.
    // Keep its full texel density, but shade only the portion the glass actually samples.
    let left = 1, right = -1, bottom = 1, top = -1, crop = true;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
      clip.set(x, y, 0, 1).applyMatrix4(mirror.matrixWorld).applyMatrix4(args[2].matrixWorldInverse).applyMatrix4(args[2].projectionMatrix);
      // Near-plane crossings need polygon clipping; conservatively use the full target.
      if (clip.w <= 0 || clip.z < -clip.w) crop = false;
      left = Math.min(left, -clip.x / clip.w); right = Math.max(right, -clip.x / clip.w);
      bottom = Math.min(bottom, clip.y / clip.w); top = Math.max(top, clip.y / clip.w);
    }
    const x = Math.max(0, Math.floor((left * .5 + .5) * width) - 3), y = Math.max(0, Math.floor((bottom * .5 + .5) * height) - 3);
    target.scissor.set(x, y, Math.max(1, Math.min(width, Math.ceil((right * .5 + .5) * width) + 3) - x), Math.max(1, Math.min(height, Math.ceil((top * .5 + .5) * height) + 3) - y));
    if (!crop) target.scissor.set(0, 0, width, height);
    target.scissorTest = crop;
    const swapped: [Mesh, Material | Material[]][] = [];
    const own = frame.children.filter(o => o !== mirror && o.visible);
    const ceilingWasVisible = ceiling.visible;
    const needed = args[0].shadowMap.needsUpdate;
    args[0].shadowMap.needsUpdate = false;
    // A mirror looks in the opposite direction to the main camera. Restore ghosted room
    // surfaces for this pass so it cannot reflect the cutaway, missing doors or open roof.
    scene.traverse(o => {
      if (o instanceof Mesh && o.userData.ghost) {
        swapped.push([o, o.material]);
        o.material = o.userData.ghost;
      }
    });
    own.forEach(o => o.visible = false);
    ceiling.visible = true;
    try { reflect(...args); }
    finally {
      target.scissorTest = false;
      args[0].shadowMap.needsUpdate = needed;
      ceiling.visible = ceilingWasVisible;
      own.forEach(o => o.visible = true);
      swapped.forEach(([o, m]) => o.material = m);
    }
  };
  return mirror;
}
