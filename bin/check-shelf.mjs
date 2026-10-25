// Check the real built room: observe its scene with a temporary CDP breakpoint, without
// production debug hooks. First build and start preview. URL selects the preview server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { Box3, Matrix4, Ray, Vector3 } from 'three';

const site = process.env.URL ?? 'http://localhost:4321';
const manifest = JSON.parse(readFileSync(new URL('../public/room/assets/manifest.json', import.meta.url)));
const modelIds = ['imu-localization', 'sketchgenie', 'robotics-vehicle', 'robotic-arm', 'transformable-rover', 'telegram-chatbot'];
// Hover grows a model 10–22%: miniatures that fill their slot grow only as far as it allows.
const minPop = 1.099;
const slots = {
  'imu-localization': {tier:3,left:-.36,right:0}, sketchgenie:{tier:3,left:0,right:.36},
  'transformable-rover':{tier:1,left:-.36,right:0}, 'telegram-chatbot':{tier:1,left:0,right:.36},
  'robotics-vehicle':{tier:2,left:-.36,right:0}, 'robotic-arm':{tier:2,left:0,right:.36},
};
// Test actual rendered triangles against nearby scene surfaces. An open shelf front is not
// a collision plane: the backboard, side boards and furniture geometry are what matter.
const triangles = meshes => meshes.flatMap(m => {
  const matrix=new Matrix4().fromArray(m.matrix), vertices=[];
  for(let i=0;i<m.positions.length;i+=3) vertices.push(new Vector3().fromArray(m.positions,i).applyMatrix4(matrix));
  const result=[], indices=m.indices ?? vertices.map((_,i)=>i);
  for(let i=0;i<indices.length;i+=3){
    const v=indices.slice(i,i+3).map(j=>vertices[j]);
    result.push({v,box:new Box3().setFromPoints(v)});
  }
  return result;
});
const intersects = (a,b) => {
  const hit=new Vector3();
  for(const [edges,target]of [[a,b],[b,a]]) for(let i=0;i<3;i++){
    const start=edges.v[i], direction=edges.v[(i+1)%3].clone().sub(start),length=direction.length();
    if(length<1e-9)continue;
    const ray=new Ray(start,direction.divideScalar(length));
    if(ray.intersectTriangle(...target.v,false,hit) && hit.distanceTo(start)<=length+1e-6)return true;
  }
  return false;
};
const checkSurfaces = snapshot => {
  const box = values => new Box3(new Vector3().fromArray(values),new Vector3().fromArray(values,3));
  const solids=snapshot.solids.map(m=>({...m,triangles:triangles([m])}));
  for(const display of snapshot.displays) for(const solid of solids){
    if(!box(display.box).intersectsBox(box(solid.box)))continue;
    for(const a of triangles(display.meshes)) for(const b of solid.triangles){
      if(a.box.intersectsBox(b.box))assert(!intersects(a,b),`${display.name} penetrates scene mesh ${solid.name}`);
    }
  }
};
assert.equal(Object.keys(manifest.assets.imu_devices.components).length,3,'IMU must contain phone, watch and AirPods case');
const calibrated = manifest.assets.imu_devices.calibration;
for (const [name, expected] of Object.entries({phone_body:[.0781,.1608,.00765],watch_case:[.038,.045,.0107],airpods_case:[.0606,.0452,.0217]})) {
  calibrated.measured[name].forEach((v,i)=>assert(Math.abs(v-expected[i])<.00002, `${name} dimension ${i} must match the physical body`));
}
assert.equal(calibrated.closed_case,true);
assert.equal(calibrated.exposed_earbuds,0);
const questLayout = manifest.assets.quest3.layout;
assert.equal(manifest.assets.quest3.calibration.rigid_front_width, .160, 'Quest must use its rigid housing width, not the open strap width');
assert(questLayout.headset.dark_front_mean_z < (questLayout.headset.min[2]+questLayout.headset.max[2])/2,'Quest sensor capsules must be below the front centre');
assert.deepEqual(questLayout.controllers,{},'Quest shelf model must contain no controllers');
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
const profile = mkdtempSync(join(tmpdir(), 'check-shelf-'));
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
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
        await send('Debugger.evaluateOnCallFrame', { callFrameId: m.params.callFrames[0].callFrameId, expression: `window.__shelf = {scene: ${sceneName}, camera: ${cameraName}}` });
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
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${label}`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Debugger.enable');
  const { breakpointId } = await send('Debugger.setBreakpointByUrl', { url: `${site}/_astro/${file}`, lineNumber: position.line, columnNumber: position.character });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('theme', 'light');" });
  await send('Page.navigate', { url: site });
  await Promise.race([captured, sleep(45000).then(() => { throw new Error('Room render was not captured'); })]);
  await send('Debugger.disable');
  await until("document.querySelector('.frame.live')", 'live room');
  await evaluate(`(() => {
    const {scene,camera}=window.__shelf;
    const rover=scene.getObjectByName('project-transformable-rover');
    if(!rover)throw new Error('Rover display missing');
    const shelf=rover.parent;
    const first=rover.getObjectByProperty('type','Mesh');
    const Box=first.geometry.boundingBox.constructor;
    window.__shelf.sample=()=>{
      scene.updateMatrixWorld(true);
      const inverse=shelf.matrixWorld.clone().invert();
      const displays=shelf.children.filter(o=>o.name.startsWith('project-'));
      return {camera:camera.position.toArray(),rotation:camera.quaternion.toArray(),displays:displays.map(o=>{
        const b=new Box().setFromObject(o,true).applyMatrix4(inverse);
        return {name:o.name,scale:o.scale.x,modelScale:o.children[0].scale.toArray(),min:b.min.toArray(),max:b.max.toArray()};
      })};
    };
    window.__shelf.surfaces=()=>{
      scene.updateMatrixWorld(true);
      const displays=shelf.children.filter(o=>o.name.startsWith('project-'));
      const box=o=>new Box().setFromObject(o,true);
      const pack=o=>{
        const a=o.geometry.attributes.position,positions=[];
        for(let i=0;i<a.count;i++)positions.push(a.getX(i),a.getY(i),a.getZ(i));
        const b=box(o);return {name:o.name,matrix:o.matrixWorld.toArray(),positions,indices:o.geometry.index?Array.from(o.geometry.index.array):null,box:b.min.toArray().concat(b.max.toArray())};
      };
      const bounds=displays.map(box),solids=[];
      scene.traverse(o=>{
        if(!o.isMesh||!o.geometry.attributes.position)return;
        for(let p=o;p;p=p.parent)if(displays.includes(p)||!p.visible)return;
        if(bounds.some(b=>b.intersectsBox(box(o))))solids.push(pack(o));
      });
      return {solids,displays:displays.map(o=>{
        const meshes=[];o.traverse(m=>{if(m.isMesh)meshes.push(pack(m));});
        const b=box(o);return {name:o.name,meshes,box:b.min.toArray().concat(b.max.toArray())};
      })};
    };
    document.querySelector('#projects [data-item="transformable-rover"]').scrollIntoView({behavior:'instant',block:'center'});
  })()`);
  await until("document.documentElement.dataset.section === 'projects'", 'project section');
  await sleep(3000);
  const before = await evaluate('__shelf.sample()');
  const check = s => {
    const imu=s.displays.find(d=>d.name==='project-imu-localization');
    const quest=s.displays.find(d=>d.name==='project-sketchgenie');
    assert.deepEqual(imu.modelScale,[1,1,1],'IMU must remain life-size');
    assert.deepEqual(quest.modelScale,[1,1,1],'Quest must remain life-size');
    for(const [id,slot]of Object.entries(slots)){
      const model=s.displays.find(d=>d.name===`project-${id}`),tier=manifest.assets.shelf.tiers[slot.tier];
      assert(model.scale >= 1 - 1e-6 && model.scale <= (modelIds.includes(id)?1.22:1.1) + 1e-6, `${id} scale overshot`);
      assert(model.min[0] >= slot.left && model.max[0] <= slot.right, `${id} left its horizontal slot`);
      assert(model.min[1] >= tier && model.max[1] < tier+manifest.assets.shelf.tier_clear, `${id} crossed a shelf board`);
      assert(model.min[2] > -.138, `${id} penetrates the shelf backboard`);
      for(const d of s.displays.filter(d=>d!==model)){
        assert(!model.min.every((v,i)=>v<d.max[i]&&model.max[i]>d.min[i]),`${id} intersects ${d.name}`);
      }
    }
  };
  checkSurfaces(await evaluate('__shelf.surfaces()'));
  const moveTo = async id => {
    const p = await evaluate(`(() => {const r=document.querySelector('#projects [data-item="${id}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+30};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
  };
  for (const id of ['imu-localization','sketchgenie','robotics-vehicle','robotic-arm','transformable-rover','telegram-chatbot','transformable-rover']) {
    await evaluate(`document.querySelector('#projects [data-item="${id}"]').scrollIntoView({behavior:'instant',block:'center'})`);
    await sleep(500);
    await moveTo(id);
    await until(`document.documentElement.dataset.item === '${id}'`, `hover ${id}`);
    for (let i = 0; i < 30; i++) { check(await evaluate('__shelf.sample()')); await sleep(25); }
    const selected=modelIds.includes(id)?id:'transformable-rover';
    await until(`(() => { const s=__shelf.sample().displays.find(d=>d.name==='project-${selected}').scale; return ${modelIds.includes(id) ? 's>minPop' : 's<1.001'}; })()`.replace('minPop', minPop), 'settled display scale');
    await sleep(1500);
    const s = await evaluate('__shelf.sample()');
    assert.deepEqual(s.camera, before.camera, 'Card hover moved the camera');
    assert.deepEqual(s.rotation, before.rotation, 'Card hover turned the camera');
    const scale=s.displays.find(d=>d.name===`project-${selected}`).scale;
    assert(modelIds.includes(id) ? scale>minPop : scale<1.01, `Wrong display highlighted: ${id} scale=${scale}`);
    checkSurfaces(await evaluate('__shelf.surfaces()'));
  }
  // An observer update during hover must not replace the user's hovered item.
  await evaluate('scrollBy(0,15)'); await sleep(500);
  assert.equal(await evaluate('document.documentElement.dataset.item'), 'transformable-rover');
  await send('Input.dispatchMouseEvent', { type:'mouseMoved',x:700,y:8 });
  await evaluate("document.querySelector('#projects [data-item=\"telegram-chatbot\"] h3 a').focus({preventScroll:true})");
  await until("document.documentElement.dataset.item === 'telegram-chatbot'", 'keyboard focus');
  await sleep(800); check(await evaluate('__shelf.sample()'));
  const shot = async name => {
    if (!process.env.ROOM_SCREENSHOTS) return;
    mkdirSync(process.env.ROOM_SCREENSHOTS,{recursive:true});
    const r=await send('Page.captureScreenshot',{format:'png'});
    writeFileSync(join(process.env.ROOM_SCREENSHOTS,`${name}.png`),Buffer.from(r.data,'base64'));
  };
  await moveTo('transformable-rover'); await sleep(1000); await shot('shelf-day');
  await evaluate("document.getElementById('theme-switch').click()"); await sleep(2000); await shot('shelf-night');
  await evaluate("document.querySelector('#room-enter').click()");
  await sleep(2200);
  await send('Input.dispatchMouseEvent', {type:'mouseMoved',x:1400,y:20});
  await evaluate("dispatchEvent(new CustomEvent('itemchange',{detail:'telegram-chatbot'}))");
  await until("__shelf.sample().displays.find(d=>d.name==='project-transformable-rover').scale<1.001", 'neutral room miniature');
  // Project real surface points into the overview, then point at one that is visible. This
  // exercises the room's raycaster and confirms it uses the same constrained pop, not a spring.
  const points=await evaluate(`(() => {
    const {scene,camera}=__shelf,display=scene.getObjectByName('project-transformable-rover');
    const r=document.querySelector('.room-canvas').getBoundingClientRect(),points=[];
    display.traverse(o=>{
      if(!o.isMesh)return;
      const a=o.geometry.getAttribute('position'),index=o.geometry.index;
      for(let i=0;i<index.count-2;i+=300){
        const p=camera.position.clone().set(0,0,0);
        for(let k=0;k<3;k++)p.add(camera.position.clone().fromBufferAttribute(a,index.getX(i+k)));
        p.multiplyScalar(1/3).applyMatrix4(o.matrixWorld).project(camera);
        if(Math.abs(p.x)<1&&Math.abs(p.y)<1)points.push({x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2,z:p.z});
      }
    });
    return points.sort((a,b)=>a.z-b.z).filter((p,i,a)=>!a.slice(0,i).some(q=>Math.hypot(q.x-p.x,q.y-p.y)<3)).slice(0,15);
  })()`);
  let hit=false;
  for(const {x,y}of points){
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
    await sleep(350);
    if(await evaluate("__shelf.sample().displays.find(d=>d.name==='project-transformable-rover').scale>1.005")){hit=true;break;}
  }
  assert(hit,'Could not hover the Rover in the actual room overview');
  for(let i=0;i<15;i++){check(await evaluate('__shelf.sample()'));await sleep(30);}
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:385,y:8});
  await sleep(2000);check(await evaluate('__shelf.sample()'));await shot('shelf-mobile-room');
  // Item selection remains safe after changing viewport and entering the full room.
  await evaluate("dispatchEvent(new CustomEvent('itemchange',{detail:'transformable-rover'}));dispatchEvent(new CustomEvent('sectionchange',{detail:'projects'}))");
  await sleep(800);check(await evaluate('__shelf.sample()'));
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('PASS: life-size Quest and IMU, actual triangle checks against shelf and nearby scene meshes, 165 animation samples without shelf/neighbour intersections, card hover/focus, direct 3D hover, fixed camera and mobile room');
} finally {
  socket?.close();chrome.kill();
  if(chrome.pid&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(resolve=>chrome.once('exit',resolve));
  rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
