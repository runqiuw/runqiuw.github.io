// Profile the built room in a disposable Chrome session. See redesign/PERFORMANCE.md.
// URL, CHROME, PROFILE_OUT, DPR, CPU_RATE and SOFTWARE are optional environment variables.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const site = (process.env.URL ?? 'http://localhost:4321').replace(/\/+$/, '');
const out = resolve(process.env.PROFILE_OUT ?? '/private/tmp/room-profile');
// PROFILE_THEME=dark opens in the dark theme; PROFILE_EARLY_SWITCH switches theme as soon as the room is ready.
const theme = process.env.PROFILE_THEME === 'dark' ? 'dark' : 'light', other = theme === 'dark' ? 'day' : 'night';
const profile = mkdtempSync(join(tmpdir(), 'room-profile-chrome-'));
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', ...(process.env.SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : []),
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    if (!port) await sleep(100);
  }
  assert(port, 'Chrome did not start');
  const tab = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let serial = 0; const pending = new Map(), errors = [];
  let traceComplete;
  const traceDone = new Promise(resolve => {traceComplete=resolve;});
  socket.addEventListener('message', async ({data}) => {
    const m = JSON.parse(data);
    if (m.method === 'Tracing.tracingComplete') traceComplete(m.params);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    pending.get(m.id)?.(m); pending.delete(m.id);
  });
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); fail(Error(`${method} timed out`)); }, 30000);
    pending.set(id, m => { clearTimeout(timer); m.error ? fail(Error(JSON.stringify(m.error))) : ok(m.result); });
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expr, label, timeout = 120000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expr)) return; await sleep(100); }
    throw Error(`Timed out: ${label}`);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Performance.enable');
  await send('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:Number(process.env.DPR ?? 1),mobile:false});
  if (process.env.CPU_RATE) await send('Emulation.setCPUThrottlingRate', {rate:Number(process.env.CPU_RATE)});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:readFileSync(new URL('./room-gl-memory.js',import.meta.url),'utf8')});
  if(process.env.PROFILE_TRACE)await send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,v8,gpu'+(process.env.PROFILE_TRACE_LIGHT?'':',toplevel'),transferMode:'ReturnAsStream'});
  // Instrument WebGL without querying the GPU on each frame.
  await send('Page.addScriptToEvaluateOnNewDocument', {source:`
    localStorage.setItem('theme','${theme}');
    window.__roomTestHook=room=>{const r=room.renderer,scene=room.scene,known=new WeakMap();window.__profileAccess={renderer:r,scene,camera:room.camera};window.__profileTargets=[];const render=r.render;let depth=0;r.render=function(...args){const root=depth===0&&!r.getRenderTarget(),before=root?{...__profile.draw}:null;depth++;try{return render.apply(this,args);}finally{depth--;if(root)__profile.frameDraws.push(Object.fromEntries(Object.keys(before).map(k=>[k,__profile.draw[k]-before[k]])));}};window.__profileTarget=()=>{const target=r.getRenderTarget();if(!target)return 'canvas';let kind=known.get(target);if(kind)return kind;const mirror=scene.getObjectByName('mirror-reflection');if(mirror?.getRenderTarget()===target)kind='mirror';else{let shadow=false;scene.traverse(o=>{if(o.isLight&&o.shadow?.map===target)shadow=true;});kind=shadow?'shadow':'other';}window.__profileTargets.push({kind,width:target.width,height:target.height,name:target.texture?.name??'',samples:target.samples,depthName:target.depthTexture?.name??null});known.set(target,kind);return kind;};};
    window.__profile={draw:{canvas:0,shadow:0,mirror:0,other:0},frameDraws:[],frames:0,links:0,uploads:0,long:[],ready:null};
    addEventListener('roomready',()=>__profile.ready=performance.now(),{once:true});
    new PerformanceObserver(list=>__profile.long.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    const glp=WebGL2RenderingContext.prototype, bindings=new WeakMap(), bind=glp.bindFramebuffer;
    glp.bindFramebuffer=function(target,fb){if(target===this.FRAMEBUFFER||target===this.DRAW_FRAMEBUFFER)bindings.set(this,fb);return bind.call(this,target,fb);};
    // Inspect the actual Three.js render target, including its multisampled framebuffer.
    // Until the main-render breakpoint exposes the renderer, offscreen draws remain unclassified.
    const category=gl=>{if(!gl.canvas.classList.contains('room-canvas'))return null;return window.__profileTarget?.() ?? (bindings.get(gl)?'other':'canvas');};
    for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=glp[name];glp[name]=function(...args){const c=category(this);if(c)__profile.draw[c]++;return original.apply(this,args);};}
    const clear=glp.clear;glp.clear=function(...args){if(category(this)==='canvas')__profile.frames++;return clear.apply(this,args);};
    const link=glp.linkProgram;glp.linkProgram=function(...args){if(this.canvas.classList.contains('room-canvas'))__profile.links++;return link.apply(this,args);};
    for(const name of ['texImage2D','texSubImage2D','texImage3D','texSubImage3D','compressedTexImage2D','compressedTexSubImage2D','compressedTexImage3D','compressedTexSubImage3D']){const original=glp[name];glp[name]=function(...args){if(this.canvas.classList.contains('room-canvas'))__profile.uploads++;return original.apply(this,args);};}
  `});
  mkdirSync(out, {recursive:true});
  await send('Page.navigate',{url:site});
  const steps=[]; let last={draw:{canvas:0,shadow:0,mirror:0,other:0},frames:0,links:0,uploads:0,long:[]};
  const memory = () => {
    // RSS is per process and includes browser/compositor overhead, not GPU allocation.
    try {
      const lines=execFileSync('ps',['-axo','pid=,ppid=,rss=,command='],{encoding:'utf8'}).trim().split('\n');
      const rows=lines.map(line=>{const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);return m?{pid:+m[1],ppid:+m[2],rssBytes:+m[3]*1024,command:m[4]}:null;}).filter(Boolean);
      const children=new Set([chrome.pid]);let changed=true;while(changed){changed=false;for(const row of rows)if(children.has(row.ppid)&&!children.has(row.pid)){children.add(row.pid);changed=true;}}
      return rows.filter(r=>children.has(r.pid)).map(({pid,rssBytes,command})=>{
        const type=command.match(/--type=([^ ]+)/)?.[1]??'browser',entry={pid,rssBytes,type};
        if(process.env.PROFILE_FOOTPRINT && (type==='renderer'||type==='gpu-process')){
          try{
            const result=execFileSync('footprint',['--noCategories','--format','bytes','-p',String(pid)],{encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']});
            entry.footprintBytes=Number(result.match(/Footprint:\s*(\d+)\s*B/)?.[1])||null;
            entry.physicalFootprintBytes=Number(result.match(/phys_footprint:\s*(\d+)\s*B/)?.[1])||null;
          }catch{entry.footprintBytes=null;entry.physicalFootprintBytes=null;}
        }
        return entry;
      });
    } catch { return null; }
  };
  const sample = async name => {
    const now=await evaluate(`(performance.mark(${JSON.stringify('room-profile:'+name)}),({...__profile, long:__profile.long.slice(),draw:{...__profile.draw},frameDraws:__profile.frameDraws.splice(0),time:performance.now(), heap:performance.memory?.usedJSHeapSize??null,gpu:__roomMemory()}))`);
    const glErrors=await evaluate(`(()=>{const g=__profileAccess.renderer.getContext(),e=[];for(let i=0;i<10;i++){const x=g.getError();if(!x)break;e.push(x);}return e;})()`);
    const metric=Object.fromEntries((await send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
    const delta=Object.fromEntries(Object.keys(now.draw).map(k=>[k,now.draw[k]-last.draw[k]]));
    const median = values => {if(!values.length)return null;values.sort((a,b)=>a-b);const mid=Math.floor(values.length/2);return values.length%2?values[mid]:(values[mid-1]+values[mid])/2;};
    const perFrame=Object.fromEntries(Object.keys(now.draw).map(k=>[k,median(now.frameDraws.map(frame=>frame[k]))]));
    const row={name,glErrors,renderFrames:now.frameDraws.length,drawMedianPerFrame:perFrame,timeMs:now.time,elapsedMs:now.time-(last.time??0),frames:now.frames-last.frames,draw:delta,links:now.links-last.links,uploads:now.uploads-last.uploads,longTasks:now.long.slice(last.long.length),jsHeapBytes:metric.JSHeapUsedSize??now.heap,gpuAllocations:now.gpu,processes:memory()};
    steps.push(row);last=now;console.log(JSON.stringify(row));
  };
  await until("document.querySelector('.frame.live')",'live room');
  await until('__profile.ready !== null','roomready');
  assert(await evaluate("typeof __profileTarget==='function'"),'Renderer instrumentation missing');
  if(process.env.PROFILE_EARLY_SWITCH){await sample('initial load / warmup');await evaluate("document.getElementById('theme-switch').click()");await sleep(4000);await sample(`early switch to ${other}`);}
  else await sample('initial load / warmup');
  await sleep(3000);await sample('page top');
  if(!process.env.PROFILE_QUICK){
  for(const section of ['research','projects','games','playground']) {
    await evaluate(`document.getElementById(${JSON.stringify(section)})?.scrollIntoView({block:'center',behavior:'instant'})`);
    await sleep(500);
    if(section==='research'||section==='games')await evaluate(`(()=>{const item=document.querySelector('#${section} [data-screen-video]');if(!item)throw Error('No screen video in ${section}');item.scrollIntoView({behavior:'instant',block:'center'});document.documentElement.dataset.section='${section}';document.documentElement.dataset.item=item.dataset.item;dispatchEvent(new CustomEvent('sectionchange',{detail:'${section}'}));dispatchEvent(new CustomEvent('itemchange',{detail:item.dataset.item}));})()`);
    await sleep(3000);await sample(`page ${section}`);
  }
  await evaluate("document.getElementById('room-enter').click()");
  await until("location.hash==='#room' && !document.querySelector('.room-pins').hidden",'full room');
  await sleep(3000);await sample('full room');
  const drag=async()=>{for(const [type,x,y,buttons] of [['mouseMoved',500,450,0],['mousePressed',500,450,1],['mouseMoved',650,470,1],['mouseMoved',740,485,1],['mouseReleased',740,485,0]]){await send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});await sleep(200);}await sleep(5000);};
  await drag();await sample(`${await evaluate("document.documentElement.dataset.theme")==='dark'?'night':'day'} drag and spring`);
  for(const id of ['board']) {
    await evaluate(`document.querySelector('[data-go="playground"]').click()`);await until(`location.hash==='#room/${id}'`,id);await sleep(3000);await sample(id);
    await evaluate("document.querySelector('[data-closeup=back]').click()");await until("location.hash==='#room'",'back');await sleep(2000);
  }
  await evaluate("document.getElementById('theme-switch').click()");await sleep(4000);await sample(process.env.PROFILE_EARLY_SWITCH?`switch back from ${other}`:`switch to ${other}`);
  await drag();await sample(`${await evaluate("document.documentElement.dataset.theme")==='dark'?'night':'day'} drag and spring`);
  for(const id of ['hoops','desk']) {
    await evaluate(`document.querySelector('[data-go="${id}"]').click()`);await until(`location.hash==='#room/${id}'`,id);await sleep(3500);await sample(id);
    if(id==='hoops'){
      await until("document.querySelector('.hoops-turn')?.dataset.phase==='ready'",'hoops ready');
      const r=await evaluate("(()=>{const r=document.querySelector('.room-canvas').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.62,span:Math.min(r.width,r.height)};})()"),pull=r.span*.22*.55;
      await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',buttons:1,clickCount:1});
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y+pull,button:'left',buttons:1});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x,y:r.y+pull,button:'left',buttons:0,clickCount:1});
      assert.equal(await evaluate("document.querySelector('.hoops-turn')?.dataset.phase"),'flight','Hoops throw did not start');
      await sleep(1000);await sample('hoops throw');await until("document.querySelector('.hoops-turn')?.dataset.phase==='ready'",'next hoops turn',30000);await sample('hoops result and next turn');
    }
    await evaluate("document.querySelector('[data-closeup=back]').click()");await until("location.hash==='#room'",'back');await sleep(2000);
  }
  await evaluate("document.getElementById('room-exit').click()");await until("!document.querySelector('.room.full')",'exit');await sleep(3000);await sample('exit to page');
  }
  if(process.env.PROFILE_CALIBRATE){
    await until("__profileAccess.scene.getObjectByName('mirror-reflection')?.visible",'prepared mirror');
    const calibration=await evaluate(`(()=>{const {scene,camera,renderer:r}=__profileAccess;const lights=[];scene.traverse(o=>{if(o.isLight&&o.castShadow)lights.push(o);});const draw=forced=>{for(const o of lights)o.shadow.needsUpdate=forced;r.shadowMap.needsUpdate=forced;const before={...__profile.draw};r.render(scene,camera);return Object.fromEntries(Object.keys(before).map(k=>[k,__profile.draw[k]-before[k]]));};return {cached:draw(false),forced:draw(true),targets:__profileTargets};})()`);
    console.log('Calibration:',JSON.stringify(calibration));
    assert.equal(calibration.cached.shadow,0,'Cached render unexpectedly counted shadow draws');
    assert(calibration.forced.shadow>0,'Forced shadow render was not classified as shadow');
  }
  if(process.env.PROFILE_TRACE){
    await send('Tracing.end');
    const {stream}=await Promise.race([traceDone,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Trace did not finish')),30000);timer.unref();})]);
    assert(stream,'Chrome returned no trace stream');
    const path=join(out,'trace.json');writeFileSync(path,'');
    for(;;){const part=await send('IO.read',{handle:stream,size:1024*1024});appendFileSync(path,part.base64Encoded?Buffer.from(part.data,'base64'):part.data);if(part.eof)break;}
    await send('IO.close',{handle:stream});console.log(`Saved ${path}`);
  }
  if(errors.length) throw Error(errors.join('\n'));
  const info=await evaluate(`({targets:window.__profileTargets,userAgent:navigator.userAgent,renderer:(()=>{const gl=document.querySelector('.room-canvas')?.getContext('webgl2');const ext=gl?.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null;})(),readyMs:__profile.ready})`);
  writeFileSync(join(out,'profile.json'),JSON.stringify({site,info,dpr:Number(process.env.DPR??1),cpuRate:Number(process.env.CPU_RATE??1),steps,notes:['Draw totals cover each step; per-frame medians instrument top-level renderer.render calls after the first main-render breakpoint, including later warmup calls.','Offscreen targets are identified by Three.js target identity after the first main render; earlier draws are unclassified.','RSS and optional physical footprint include Chrome process overhead; the WebGL ledger estimates logical allocations, excludes driver padding and reports unknown formats; default framebuffer MSAA is a documented formula estimate.','Instrumentation adds JavaScript overhead; compare only matching configurations.']},null,2)+'\n');
  console.log(`Saved ${join(out,'profile.json')}`);
} finally {
  socket?.close();chrome.kill('SIGTERM');await sleep(500);rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
