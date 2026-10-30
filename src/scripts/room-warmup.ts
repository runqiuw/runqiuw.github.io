import { Group, Mesh, Vector4, type DirectionalLight, type SpotLight, type Material, type Object3D, type PerspectiveCamera, type Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';

/** Queue GPU preparation in bounded idle turns, submitting parallel shader compiles before waiting. */
export function roomWarmup(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, invalidate: () => void) {
  const jobs: { run: () => void | Promise<void>; done: () => void; fail: (e: unknown) => void }[] = [];
  const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
  let scheduled = false, running = false, enabled = false, cost = 0, inFlight = 0;
  const pointers = new Set<number>();
  let lastInput = 0;
  const noteInput = () => { lastInput = performance.now(); };
  window.addEventListener('pointerdown', e => { pointers.add(e.pointerId); noteInput(); }, { passive: true });
  window.addEventListener('pointerup', e => { pointers.delete(e.pointerId); noteInput(); }, { passive: true });
  window.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); noteInput(); }, { passive: true });
  window.addEventListener('pointermove', noteInput, { passive: true });
  window.addEventListener('keydown', noteInput, { passive: true });
  window.addEventListener('blur', () => { pointers.clear(); noteInput(); });
  const canExpand = () => {
    const scheduling = (navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }).scheduling;
    return !!scheduling?.isInputPending && pointers.size === 0 && performance.now() - lastInput > 200 && !scheduling.isInputPending();
  };
  // Idle callbacks starve while the page scrolls: they then only fire on their timeout, with no
  // idle time left. Page scrolling runs on the compositor, so a timed-out turn still uses its
  // budget, and wheel input does not count as input here. After an expensive turn (slow GPUs,
  // software rendering) the timeout grows back to 120 ms to leave the page room in between.
  // Until the room first goes live nothing is drawn but the still, so turns follow each other
  // straight away: an idle callback fires at most once a frame, which alone added ~1.6 s.
  // Each waits on a fence for the GPU to finish the previous turn's work, so a slow GPU never
  // builds a backlog that a later synchronous GL call would have to wait out in one block. A
  // fence slower than 50 ms means a slow GPU: idle pacing from then on, which overlaps its work
  // with the CPU's (software rendering was 4× slower with fences). A turn over 16 ms is still
  // followed by an idle-paced gap.
  let urgent = true, fence: WebGLSync | null = null, fencedAt = 0;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const next = new MessageChannel();
  next.port1.onmessage = () => {
    if (gpuDone()) return void turn();
    if (performance.now() - fencedAt < 50) return void setTimeout(() => next.port2.postMessage(0), 1);
    urgent = false;
    gl.deleteSync(fence);
    fence = null;
    scheduled = false;
    schedule();
  };
  const gpuDone = () => {
    if (fence && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    if (fence) gl.deleteSync(fence);
    fence = null;
    return true;
  };
  const schedule = () => {
    if (!enabled || scheduled || running || !jobs.length) return;
    scheduled = true;
    if (urgent && cost < 16) next.port2.postMessage(0);
    else if ('requestIdleCallback' in window) requestIdleCallback(turn, { timeout: Math.min(120, Math.max(34, cost)) });
    else setTimeout(() => turn(), 32);
  };
  const turn = async (deadline?: IdleDeadline) => {
    scheduled = false;
    if (document.hidden) { setTimeout(schedule, 200); return; }
    running = true;
    const start = performance.now();
    // The budget limits work BETWEEN jobs; a driver call itself cannot be interrupted.
    for (let n = 0; jobs.length && n < (canExpand() ? 4 : 2); n++) {
      const job = jobs.shift()!;
      try { await job.run(); job.done(); }
      catch (e) { job.fail(e); }
      if (performance.now() - start >= (canExpand() ? 12 : 4) || (deadline && !deadline.didTimeout && deadline.timeRemaining() < 2)) break;
    }
    running = false;
    cost = performance.now() - start;
    if (urgent && !fence) { fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); fencedAt = performance.now(); gl.flush(); }
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
    const compiling: Promise<{ ok: true } | { ok: false; error: unknown }>[] = [];
    const copiesByBatch = new Map<Mesh[], Material[]>();
    if (parallel) {
      // Submit every isolated batch before waiting: the extension can compile them concurrently.
      // Each submission remains a separate scheduled job, so input can run between driver calls.
      for (const batch of byMaterial.values()) tasks.push(add(async () => {
        // Bound the compiles in flight: a single-threaded GPU process (software rendering) would
        // otherwise queue them all, and any synchronous GL call would wait for the whole queue.
        while (inFlight >= 4) await new Promise(r => setTimeout(r, 8));
        const copies: Material[] = [];
        try {
          const group = new Group();
          for (const o of batch) {
            const copy = o.clone(false), real = (o.userData.ghost ?? o.material) as Material | Material[];
            const clone = (m: Material) => {
              // Render-target textures cannot be cloned (three warns and drops them); such a
              // material (the mirror's) is only used once prepared, so compile it as it is.
              const uniforms = (m as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
              if (Object.values(uniforms ?? {}).some(u => (u.value as Texture | null)?.isRenderTargetTexture)) return m;
              const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey;
              copies.push(c); return c;
            };
            copy.material = Array.isArray(real) ? real.map(clone) : clone(real);
            group.add(copy);
          }
          const previous = renderer.getRenderTarget();
          try {
            renderer.setRenderTarget(target);
            const compiled = renderer.compileAsync(group, warmCamera, scene);
            // Attach a rejection handler immediately; the queue waits only after all submissions.
            copiesByBatch.set(batch, copies);
            inFlight++;
            compiling.push(compiled.then(() => ({ ok: true as const }), error => ({ ok: false as const, error })).finally(() => inFlight--));
          } finally { renderer.setRenderTarget(previous); }
        } catch (error) { copies.forEach(m => m.dispose()); throw error; }
      }));
      tasks.push(add(async () => {
        const results = await Promise.all(compiling);
        const failure = results.find(result => !result.ok);
        if (failure && !failure.ok) throw failure.error;
      }));
    }
    for (const batch of byMaterial.values()) tasks.push(add(() => {
      try { draw(batch); }
      finally {
        copiesByBatch.get(batch)?.forEach(m => m.dispose());
        copiesByBatch.delete(batch);
      }
    }));
    enabled = true; schedule();
    return Promise.all(tasks);
  };
  /** The room is live: later work waits for idle time again. */
  const relax = () => { urgent = false; };
  return { prepare, upload, enqueue: add, relax };
}
