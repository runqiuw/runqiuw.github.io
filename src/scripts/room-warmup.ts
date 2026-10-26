import { Group, Mesh, Vector4, type DirectionalLight, type SpotLight, type Material, type Object3D, type PerspectiveCamera, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';

/** Serial GPU preparation: one outstanding compile, real draws, and bounded idle turns. */
export function roomWarmup(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, invalidate: () => void) {
  const jobs: { run: () => void | Promise<void>; done: () => void; fail: (e: unknown) => void }[] = [];
  const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
  let scheduled = false, running = false, enabled = false;
  const schedule = () => {
    if (!enabled || scheduled || running || !jobs.length) return;
    scheduled = true;
    if ('requestIdleCallback' in window) requestIdleCallback(turn, { timeout: 120 });
    else setTimeout(() => turn(), 32);
  };
  const turn = async (deadline?: IdleDeadline) => {
    scheduled = false;
    if (document.hidden) { setTimeout(schedule, 200); return; }
    running = true;
    const start = performance.now();
    // The budget limits work BETWEEN jobs; a driver call itself cannot be interrupted.
    for (let n = 0; jobs.length && n < 2; n++) {
      const job = jobs.shift()!;
      try { await job.run(); job.done(); }
      catch (e) { job.fail(e); }
      if (performance.now() - start >= 4 || (deadline && deadline.timeRemaining() < 2)) break;
    }
    running = false;
    schedule();
  };
  const add = (run: () => void | Promise<void>) => new Promise<void>((done, fail) => {
    jobs.push({ run, done, fail }); schedule();
  });
  const upload = (texture: Texture) => add(() => { renderer.initTexture(texture); invalidate(); });
  const prepare = (meshes: Mesh[], target: WebGLRenderTarget | null = null, lights: (DirectionalLight | SpotLight)[] = []) => {
    const byMaterial = new Map<Material | Material[], Mesh[]>();
    const textures = new Set<Texture>();
    for (const o of meshes) {
      const m = (o.userData.ghost ?? o.material) as Material | Material[];
      byMaterial.set(m, [...(byMaterial.get(m) ?? []), o]);
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const value of Object.values(mat)) {
          const t = value as Texture;
          if (t?.isTexture && !t.isRenderTargetTexture && !('isVideoTexture' in t)) textures.add(t);
        }
      }
    }
    const tasks: Promise<void>[] = [];
    const all: Mesh[] = [];
    scene.traverse(o => { if (o instanceof Mesh) all.push(o); });
    const warmCamera = camera.clone();
    const draw = (batch: Mesh[], light?: DirectionalLight | SpotLight) => {
      const masks = all.map(o => o.layers.mask), hidden = new Set<Object3D>();
      const saved = batch.map(o => ({ o, material: o.material, culled: o.frustumCulled, before: o.onBeforeRender }));
      const previous = renderer.getRenderTarget(), shadow = renderer.shadowMap;
      const automatic = shadow.autoUpdate, needed = shadow.needsUpdate;
      const viewport = renderer.getViewport(new Vector4()), scissor = renderer.getScissor(new Vector4()), clipped = renderer.getScissorTest();
      all.forEach(o => o.layers.mask = 0);
      for (const o of batch) {
        for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) hidden.add(p), (p.visible = true);
        o.layers.mask = warmCamera.layers.mask; o.frustumCulled = false;
        o.material = o.userData.ghost ?? o.material;
        if ('isReflector' in o) o.onBeforeRender = () => {};
      }
      try {
        shadow.autoUpdate = false;
        shadow.needsUpdate = !!light;
        if (light?.shadow) light.shadow.needsUpdate = true;
        renderer.setRenderTarget(target);
        renderer.setViewport(0, 0, 1, 1); renderer.setScissor(0, 0, 1, 1); renderer.setScissorTest(true);
        renderer.render(scene, warmCamera);
      } finally {
        renderer.setRenderTarget(previous);
        renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(clipped);
        shadow.autoUpdate = automatic; shadow.needsUpdate = needed;
        all.forEach((o, i) => o.layers.mask = masks[i]);
        saved.forEach(({ o, material, culled, before }) => { o.material = material; o.frustumCulled = culled; o.onBeforeRender = before; });
        hidden.forEach(o => o.visible = false);
      }
    };
    // Every shadow sampler needs a comparison texture, even when its light is off.
    // Allocate/clear one depth map per job, with no geometry, before preparing materials.
    for (const light of lights) tasks.push(add(() => draw([], light)));
    tasks.push(...[...textures].map(upload));
    for (const batch of byMaterial.values()) tasks.push(add(async () => {
      // Isolate compile state from materials the live canvas may use while we await the GPU.
      const copies: Material[] = [];
      try {
        if (parallel) {
          const group = new Group();
          for (const o of batch) {
            const copy = o.clone(false), real = (o.userData.ghost ?? o.material) as Material | Material[];
            const clone = (m: Material) => {
              const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
              copies.push(c); return c;
            };
            copy.material = Array.isArray(real) ? real.map(clone) : clone(real);
            group.add(copy);
          }
          const previous = renderer.getRenderTarget();
          renderer.setRenderTarget(target);
          const compiled = renderer.compileAsync(group, warmCamera, scene);
          renderer.setRenderTarget(previous);
          await compiled;
        }
        draw(batch);
      } finally { copies.forEach(m => m.dispose()); }
    }));
    enabled = true; schedule();
    return Promise.all(tasks);
  };
  return { prepare, upload, enqueue: add };
}
