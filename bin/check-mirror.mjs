// Cold-browser mirror regression: real render-target shader variants, early entry,
// first/repeated visibility, state restoration and idle rendering. Build and serve dist first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const site = process.env.URL ?? 'http://localhost:4321';
const dir = new URL('../dist/_astro/', import.meta.url);
const file = readdirSync(dir).find(n => /^room\..*\.js$/.test(n));
assert(file, 'Build the site first');
const source = readFileSync(new URL(file, dir), 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const calls = [];
const visit = n => {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'render' && n.arguments.length === 2 && n.arguments.every(ts.isIdentifier)) calls.push(n);
  ts.forEachChild(n, visit);
};
visit(ast);
const call = calls.at(-1), position = ast.getLineAndCharacterOfPosition(call.getStart(ast));
const [sceneName, cameraName] = call.arguments.map(n => n.getText(ast));
const rendererName=call.expression.expression.getText(ast);
let controlsName;const findControls=n=>{if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isNewExpression(n.initializer)&&n.initializer.arguments?.[0]?.getText(ast)===cameraName&&n.initializer.arguments?.length===2)controlsName=n.name.getText(ast);ts.forEachChild(n,findControls);};findControls(ast);assert(controlsName);
const profile = mkdtempSync(join(tmpdir(), 'check-mirror-'));
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu-shader-disk-cache', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const pending = new Map(), errors = [];
  let serial = 0, capture;
  const captured = new Promise(resolve => { capture = resolve; });
  socket.addEventListener('message', async ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    pending.get(m.id)?.(m); pending.delete(m.id);
    if (m.method === 'Debugger.paused') {
      try {
        await send('Debugger.evaluateOnCallFrame', { callFrameId: m.params.callFrames[0].callFrameId, expression: `window.__shelf = {scene: ${sceneName}, camera: ${cameraName}, controls: ${controlsName},renderer:${rendererName}};(()=>{const r=${rendererName},render=r.render.bind(r);window.__perf={frames:[],label:'mount'};r.render=(...args)=>{const target=r.getRenderTarget(),t=performance.now(),p=r.info.programs.length;try{return render(...args);}finally{__perf.frames.push({label:__perf.label,target:!!target,ms:performance.now()-t,newPrograms:r.info.programs.length-p,names:r.info.programs.slice(p).map(p=>p.name)});}};})()` });
        if (process.env.MIRROR_EARLY) await send('Debugger.evaluateOnCallFrame', {
          callFrameId: m.params.callFrames[0].callFrameId,
          expression: `(() => {const idle=window.requestIdleCallback.bind(window),queue=[];window.requestIdleCallback=f=>{queue.push(f);return queue.length;};window.__releaseIdle=()=>{window.requestIdleCallback=idle;queue.forEach(f=>idle(f));};})()`,
        });
        await send('Debugger.removeBreakpoint', { breakpointId });
        await send('Debugger.resume');
        capture();
      } catch (e) { errors.push(e.message); await send('Debugger.resume'); }
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, m => { clearTimeout(timer); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression, label, timeout = 45000) => {
    const end = Date.now() + timeout;let report=Date.now()+10000;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      if(process.env.MIRROR_PROGRESS&&Date.now()>report){report+=10000;console.log('PREPARATION',await evaluate('({draws:window.__perf?.frames.filter(f=>f.target).length,last:window.__perf?.frames.slice(-2),error:window.__shelf?.renderer.getContext().getError()})'));}
      await sleep(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Debugger.enable');
  const { breakpointId } = await send('Debugger.setBreakpointByUrl', { url: `${site}/_astro/${file}`, lineNumber: position.line, columnNumber: position.character });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (process.env.MIRROR_CPU_RATE) await send('Emulation.setCPUThrottlingRate', { rate:Number(process.env.MIRROR_CPU_RATE) });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('theme', 'light');" });
  await send('Page.navigate', { url: site });
  await Promise.race([captured, sleep(45000).then(() => { throw new Error('Room render was not captured'); })]);
  await send('Debugger.disable');
  await until("document.querySelector('.frame.live')", 'live room');
  const mirror = "__shelf.scene.getObjectByName('mirror-reflection')";
  await until(`!!(${mirror})`, 'mirror frame');
  // Valid lit shaders are substantially slower than discarded draws under SwiftShader.
  // This is a preparation deadline, not a permitted first-visible-frame stall.
  if (!process.env.MIRROR_EARLY) await until(`${mirror}.visible`, 'idle reflection preparation',Number(process.env.MIRROR_PREPARE_TIMEOUT)||120000);
  await evaluate("document.getElementById('room-enter').click()");
  await until("location.hash==='#room'&&!document.querySelector('.room-pins').hidden", 'full room');
  await sleep(1200);
  const turn = async (label, position = [1.8, 1.5, -1.38], target = [3.98, .8, -1.38]) => {
    await evaluate(`(() => {
      __perf.label='${label}';
      const {camera:c,controls}=__shelf;
      controls.enabled=false;
      c.position.set(${position}); c.lookAt(${target}); c.updateMatrixWorld();
      dispatchEvent(new CustomEvent('itemchange',{detail:''}));
    })()`);
    await sleep(1200);
  };
  if (process.env.MIRROR_EARLY) {
    await turn('early');
    assert.equal(await evaluate(`${mirror}.visible`), false, 'Reflection enabled before idle preparation');
    assert.equal(await evaluate("__perf.frames.filter(f=>f.label==='early'&&f.target).length"), 0, 'Early turn triggered a cold reflection pass');
    assert(await evaluate("__perf.frames.some(f=>f.label==='early'&&!f.target)"), 'Early room stopped drawing');
    await evaluate("__perf.label='prepare';__releaseIdle()");
    await until(`${mirror}.visible`, 'reflection after early entry', 45000);
    console.log('PASS: early entry keeps drawing without a cold reflection pass');
  }
  await sleep(1200);
  await turn('first');
  await turn('away', [1.8,1.5,-1.38], [0,1,-2.5]);
  await turn('second');
  const frames = await evaluate('__perf.frames');
  for (const label of ['first','second']) {
    const reflection = frames.filter(f=>f.label===label&&f.target);
    assert(reflection.length, `${label}: mirror did not render`);
    assert.equal(reflection.reduce((s,f)=>s+f.newPrograms,0), 0, `${label}: compiled shaders on first sight`);
    const main = frames.filter(f=>f.label===label&&!f.target);
    const max = Math.max(...main.map(f=>f.ms));
    if (process.env.MIRROR_MAX_FRAME_MS) assert(max<Number(process.env.MIRROR_MAX_FRAME_MS), `${label}: ${max.toFixed(1)} ms frame`);
    console.log(`${label} mirror view: ${max.toFixed(1)} ms max main render; 0 new reflection programs`);
  }
  assert(await evaluate(`(() => {
    const {renderer,scene}=__shelf;
    const target=scene.getObjectByName('mirror-reflection').getRenderTarget();
    let ok=renderer.getRenderTarget()===null&&target.viewport.z===target.width&&target.viewport.w===target.height;
    scene.traverse(o=>{if(o.isMesh&&(o.layers.mask===0||(o.userData.ghost&&o.material.colorWrite)))ok=false;});
    return ok;
  })()`), 'Mirror preparation leaked layers, render target or cutaway materials');
  const shot = async name => {
    if (!process.env.ROOM_SCREENSHOTS) return;
    mkdirSync(process.env.ROOM_SCREENSHOTS,{recursive:true});
    const r=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.ROOM_SCREENSHOTS,name+'.png'),Buffer.from(r.data,'base64'));
  };
  await shot('mirror-day');
  let quiet=0;
  for(let i=0;i<45&&quiet<2;i++) {
    await evaluate('__perf.frames=[]');await sleep(1000);
    quiet=(await evaluate('__perf.frames.filter(f=>!f.target).length'))<=1?quiet+1:0;
  }
  assert.equal(quiet,2,'Visible mirror never settles');
  await evaluate('__perf.frames=[]');await sleep(2100);
  const idleFrames=await evaluate('__perf.frames.filter(f=>!f.target).length');
  assert(idleFrames<=3,`Visible mirror keeps redrawing: ${idleFrames}`);
  console.log(`PASS: visible mirror idle ${idleFrames} frames / 2.1 s (clock only)`);
  await turn('cutaway',[1,3.1,-.2]);
  assert(await evaluate(`(() => {let ghosted=0,ok=true;__shelf.scene.traverse(o=>{if(o.isMesh&&o.userData.ghost){ghosted++;if(o.material.colorWrite)ok=false;}});return ghosted>0&&ok;})()`),'Reflection leaked cutaway walls into the main view');
  await evaluate("document.getElementById('theme-switch').click()");
  await turn('night',[2.25,1.35,-.6]);await sleep(1500);await shot('mirror-night');
  assert.deepEqual(errors,[]);
  console.log('PASS: reflection state restored, day/night views, no runtime errors');
} finally {
  socket?.close(); chrome.kill();
  if(chrome.pid&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(resolve=>chrome.once('exit',resolve));
  rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
