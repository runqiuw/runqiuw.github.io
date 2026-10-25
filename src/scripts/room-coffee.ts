import { Mesh, PlaneGeometry, ShaderMaterial, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { COFFEE } from './room.config';

/** A single transparent, depth-tested ribbon; no particles, textures or post-processing. */
export function createCoffeeSteam(mug: Object3D | undefined, camera: PerspectiveCamera, reduceMotion: boolean) {
  if (!mug) return { step: (_now: number, _enabled: boolean, _height: number) => false };
  const time = { value: 2.4 };
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: time },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      float wisp(float x, float centre, float width) {
        float d = (x - centre) / width;
        return exp(-d * d);
      }
      void main() {
        float y = vUv.y;
        float x = vUv.x * 2.0 - 1.0;
        float curl = sin(y * 10.0 - uTime * 0.8) * (0.04 + y * 0.16);
        curl += sin(y * 19.0 - uTime * 1.3) * y * 0.07;
        float width = mix(0.065, 0.18, y);
        float a = wisp(x, curl - 0.23, width);
        a += wisp(x, -curl * 0.8 + 0.24, width * 0.8) * 0.8;
        a += wisp(x, curl * 0.5, width * 1.4) * 0.35;
        float rising = 0.65 + 0.35 * sin(y * 17.0 - uTime * 2.0);
        float fade = smoothstep(0.0, 0.10, y) * (1.0 - smoothstep(0.45, 1.0, y));
        float alpha = a * fade * rising * 0.30;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(vec3(1.0), alpha);
        #include <colorspace_fragment>
      }`,
  });
  const steam = new Mesh(new PlaneGeometry(COFFEE.width, COFFEE.height), material);
  steam.name = 'mug-steam';
  steam.position.y = COFFEE.mouth + COFFEE.height / 2;
  steam.raycast = () => {};
  mug.add(steam);
  const world = new Vector3(), clip = new Vector3(), tip = new Vector3();
  let last = -Infinity;
  return {
    step(now: number, enabled: boolean, viewportHeight: number) {
      steam.getWorldPosition(world);
      clip.copy(world).project(camera);
      tip.copy(world);
      tip.y += COFFEE.height / 2;
      tip.project(camera);
      const pixels = Math.abs(tip.y - clip.y) * viewportHeight;
      const show = enabled && clip.z > -1 && clip.z < 1 && Math.abs(clip.x) < 1.05 && Math.abs(clip.y) < 1.1 && pixels >= COFFEE.minPixels;
      let changed = show !== steam.visible;
      steam.visible = show;
      if (!show) return changed;
      // Keep the steam upright even when looking down into the cup.
      const yaw = Math.atan2(camera.position.x - world.x, camera.position.z - world.z);
      if (Math.abs(yaw - steam.rotation.y) > 0.0001) changed = true;
      steam.rotation.y = yaw;
      if (!reduceMotion && now - last >= 1000 / COFFEE.fps) {
        time.value = now / 1000;
        last = now;
        changed = true;
      }
      return changed;
    },
  };
}
