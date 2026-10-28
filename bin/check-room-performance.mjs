// Performance regression against the built room, without production debug hooks.
// ROOM_MIRROR_PIXELS also compares full/scissored reflection output at 40 poses/themes/sizes, clearing old reflection pixels before every comparison.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

// The baked gun atlas must not inherit the scan's redundant vertex colors: joining
// unpainted stand/box geometry gives those new vertices black Color defaults.
const gunBuffer=readFileSync(new URL('../dist/room/assets/m1917_figure.glb',import.meta.url));
const gunJson=JSON.parse(gunBuffer.subarray(20,20+gunBuffer.readUInt32LE(12)).toString());
assert(gunJson.meshes.every(m=>m.primitives.every(p=>!Object.hasOwn(p.attributes,'COLOR_0'))),'M1917 inherited duplicate/black vertex colors');

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
let rayName;const findRay=n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='setFromCamera'&&n.arguments[1]?.getText(ast)===cameraName)rayName=n.expression.expression.getText(ast);ts.forEachChild(n,findRay);};findRay(ast);assert(rayName);
let drawParent=call.parent;while(drawParent&&!ts.isArrowFunction(drawParent))drawParent=drawParent.parent;
let reset=drawParent.body.statements[0].expression;while(ts.isBinaryExpression(reset)&&reset.operatorToken.kind===ts.SyntaxKind.CommaToken)reset=reset.left;
assert(ts.isIdentifier(reset.left));const dirtyName=reset.left.getText(ast);

let controlsName;const findControls=n=>{if(ts.isVariableDeclaration(n)&&n.initializer&&ts.isNewExpression(n.initializer)&&n.initializer.arguments?.[0]?.getText(ast)===cameraName&&n.initializer.arguments?.length===2)controlsName=n.name.getText(ast);ts.forEachChild(n,findControls);};findControls(ast);assert(controlsName);
let withoutShadowInit=source;
const cropNegations=[];const findCrop=n=>{if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.SlashToken&&ts.isPrefixUnaryExpression(n.left)&&n.left.operator===ts.SyntaxKind.MinusToken&&ts.isPropertyAccessExpression(n.left.operand)&&n.left.operand.name.text==='x'&&ts.isPropertyAccessExpression(n.right)&&n.right.name.text==='w')cropNegations.push(n.left.getStart(ast));ts.forEachChild(n,findCrop);};findCrop(ast);
if(process.env.WRONG_MIRROR_SCISSOR)assert.equal(cropNegations.length,2,'Cannot locate reflection crop coordinates');
let wrongCrop=source;for(const at of cropNegations.sort((a,b)=>b-a))wrongCrop=wrongCrop.slice(0,at)+wrongCrop.slice(at+1);
const omitInit=n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='prepare'&&n.arguments.length===3)withoutShadowInit=source.slice(0,n.arguments[2].getStart(ast))+'[]'+source.slice(n.arguments[2].end);ts.forEachChild(n,omitInit);};omitInit(ast);
const profile = mkdtempSync(join(tmpdir(), 'check-room-performance-'));
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
    if(m.method==='Fetch.requestPaused') {
      if(m.params.request.url.endsWith('/_astro/'+file)) {
        await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/javascript'}],body:Buffer.from(process.env.UNINITIALIZED_SHADOWS?withoutShadowInit:wrongCrop).toString('base64')});return;
      }
      const dark=m.params.request.url.includes('/dark');
      const body=m.params.request.url.includes('geojs')
        ? {latitude:'40.7',longitude:'-74.0',country_code:'US'}
        : {version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':dark?'#25294a':'#dfe3ec'}}]};
      await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'access-control-allow-origin',value:'*'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
      return;
    }
    if (m.method === 'Debugger.paused') {
      try {
        await send('Debugger.evaluateOnCallFrame', { callFrameId: m.params.callFrames[0].callFrameId, expression: `window.__shelf = {scene: ${sceneName}, camera: ${cameraName}, controls: ${controlsName},renderer:${rendererName},rayType:${rayName}.constructor,redraw:()=>{${dirtyName}=true;}};(()=>{const r=${rendererName},render=r.render.bind(r);window.__perf={frames:[],label:'mount'};r.render=(...args)=>{const target=r.getRenderTarget(),t=performance.now(),p=r.info.programs.length;try{return render(...args);}finally{__perf.frames.push({label:__perf.label,target:!!target,ms:performance.now()-t,newPrograms:r.info.programs.length-p,names:r.info.programs.slice(p).map(p=>p.name)});}};})()` });
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
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${label}`);
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Debugger.enable');
  const { breakpointId } = await send('Debugger.setBreakpointByUrl', { url: `${site}/_astro/${file}`, lineNumber: position.line, columnNumber: position.character });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  if (process.env.MIRROR_CPU_RATE) await send('Emulation.setCPUThrottlingRate', { rate:Number(process.env.MIRROR_CPU_RATE) });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('theme', 'light');" });
  if(process.env.NO_PARALLEL)await send('Page.addScriptToEvaluateOnNewDocument',{source:`const get=WebGL2RenderingContext.prototype.getExtension;WebGL2RenderingContext.prototype.getExtension=function(name){return name==='KHR_parallel_shader_compile'?null:get.call(this,name);};`});
  if(process.env.NO_IDLE)await send('Page.addScriptToEvaluateOnNewDocument',{source:'delete window.requestIdleCallback;'});
  await send('Fetch.enable',{patterns:[{urlPattern:'https://tiles.openfreemap.org/styles/*'},{urlPattern:'https://get.geojs.io/*'},...((process.env.UNINITIALIZED_SHADOWS||process.env.WRONG_MIRROR_SCISSOR)?[{urlPattern:`${site}/_astro/${file}`}]:[])]});
  await send('Page.navigate', { url: site });
  await Promise.race([captured, sleep(45000).then(() => { throw new Error('Room render was not captured'); })]);
  await send('Debugger.disable');
  await until("document.querySelector('.frame.live')", 'live room');
  await until("__shelf.scene.getObjectByName('mirror-reflection').visible", 'prepared reflection',Number(process.env.MIRROR_PREPARE_TIMEOUT)||120000);
  await evaluate("document.getElementById('room-enter').click()");
  await until("location.hash==='#room'&&!document.querySelector('.room-pins').hidden", 'full room');
  await sleep(1600);
  const camera = async (p,t) => {
    await evaluate(`(()=>{const{camera:c,controls}=__shelf;controls.enabled=false;c.position.set(${p});c.lookAt(${t});c.updateMatrixWorld();__shelf.redraw();})()`);
    await sleep(1800);
  };
  await camera([5.8,4.6,3],[2.05,.8,-1.85]);
  // Check the untouched cold-day scene BEFORE any test forces shadow generation or changes theme.
  const cold=await evaluate(`(()=>{const r=__shelf.renderer,gl=r.getContext();r.render(__shelf.scene,__shelf.camera);const errors=[];for(let e=gl.getError();e!==gl.NO_ERROR&&errors.length<16;e=gl.getError())errors.push(e);const maps=[];__shelf.scene.traverse(o=>{if(o.isLight&&o.castShadow)maps.push(!!o.shadow.map?.depthTexture?.compareFunction);});const m=__shelf.scene.getObjectByName('mattress_mesh');m.geometry.computeBoundingBox();const b=m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld),v=b.getCenter(__shelf.camera.position.clone());v.y=b.max.y+.005;v.project(__shelf.camera);const rgba=new Uint8Array(4);gl.readPixels(Math.floor((v.x+1)*.5*r.domElement.width),Math.floor((v.y+1)*.5*r.domElement.height),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return {errors,maps,rgba:[...rgba]};})()`);
  assert.deepEqual(cold.errors,[],'Cold daylight produced invalid GPU draw calls');
  assert(cold.maps.length===5&&cold.maps.every(Boolean),'Every shadow sampler needs an initialized comparison texture');
  assert(cold.rgba[3]>250&&cold.rgba.slice(0,3).reduce((a,b)=>a+b)>40,'Cold-day standard-material bed surface did not render');
  console.log('PASS: cold daylight renders the bed, with five valid shadow samplers and no WebGL errors');
  const collectibles=await evaluate(`(()=>{
    const {scene}=__shelf,Box=scene.getObjectByName('mattress_mesh').geometry.boundingBox.constructor;
    scene.updateMatrixWorld(true);
    const props=['bili_pillow','guldan_figure','m1917_figure'].map(n=>{
      const o=scene.getObjectByName(n);if(!o)throw Error('Missing collectible '+n);
      const b=new Box().setFromObject(o,true),meshes=[];o.traverse(m=>{if(m.isMesh)meshes.push(m);});
      return {name:n,min:b.min.toArray(),max:b.max.toArray(),box:b,meshes:meshes.length};
    });
    const obstacles=['tv','tv_remote','xbox_controller','console'].map(n=>({name:n,box:new Box().setFromObject(scene.getObjectByName(n).parent,true)}));
    // Props and existing furniture have separate placement parents. Test their actual meshes.
    for(const p of props)for(const q of [...props,...obstacles]){
      if(p===q)continue;
      if(p.box.intersectsBox(q.box))throw Error(p.name+' overlaps '+q.name);
    }
    return props.map(({box,...p})=>p);
  })()`);
  for(const p of collectibles){
    assert(p.min[0]>=2.265&&p.max[0]<=3.455,`${p.name} overhangs the cabinet sides`);
    assert(p.min[1]>=.4995&&p.min[1]<=.503&&p.max[1]<.69,`${p.name} floats or penetrates the cabinet top`);
    assert(p.min[2]>-3.672&&p.max[2]<-3.282,`${p.name} overhangs the cabinet front/back`);
  }
  const tech=await evaluate(`(()=>{const {scene}=__shelf,Box=scene.getObjectByName('mattress_mesh').geometry.boundingBox.constructor,shelf=scene.getObjectByName('project-transformable-rover').parent,inv=shelf.matrixWorld.clone().invert();scene.updateMatrixWorld(true);return ['android_mascot','rtx3070_fe'].map(n=>{const o=scene.getObjectByName(n);if(!o)throw Error('Missing '+n);const b=new Box().setFromObject(o,true).applyMatrix4(inv);return {name:n,min:b.min.toArray(),max:b.max.toArray()};});})()`);
  for(const p of tech){assert(p.min[0]>0&&p.max[0]<.36,`${p.name} crosses the bottom-right slot sides: ${JSON.stringify(p)}`);assert(p.min[1]>=.075&&p.max[1]<.431,`${p.name} crosses a shelf board`);assert(p.min[2]>-.16&&p.max[2]<.15,`${p.name} crosses the shelf back/front`);}
  assert(tech[0].max[0]<tech[1].min[0],'Android and graphics card intersect');
  console.log('PASS: Android and RTX 3070 fit the bottom-right shelf beside the toy room',tech);
  console.log('PASS: TV collectibles fit the cabinet top and clear the screen body, remote, controller and console',collectibles);
  if(!process.env.ROOM_PROPS_ONLY){
  const drawCalls=await evaluate(`(()=>{const {renderer:r,scene,camera}=__shelf,auto=r.info.autoReset;r.info.autoReset=false;r.info.reset();r.render(scene,camera);const cached=r.info.render.calls;r.info.reset();scene.traverse(o=>{if(o.isLight&&o.castShadow)o.shadow.needsUpdate=true;});r.shadowMap.needsUpdate=true;r.render(scene,camera);const uncached=r.info.render.calls;r.info.autoReset=auto;return {cached,uncached};})()`);
  console.log('MEASURE: settled camera draw calls, cached vs all shadow maps',drawCalls);
  await evaluate(`(()=>{__shelf.shadows=[];__shelf.scene.traverse(o=>{if(o.isLight&&o.castShadow){const sh=o.shadow,update=sh.updateMatrices.bind(sh),s={light:o,n:0};__shelf.shadows.push(s);sh.updateMatrices=(...args)=>{s.n++;return update(...args);};}});})()`);
  const quiet = async () => {
    let good=0;
    for(let i=0;i<30&&good<2;i++){
      await evaluate('__shelf.shadows.forEach(s=>s.n=0)');await sleep(1000);
      good=await evaluate('__shelf.shadows.every(s=>s.n===0)')?good+1:0;
    }
    assert.equal(good,2,'Depth shadows never settle');
  };
  await quiet();
  const lightFlags=await evaluate('__shelf.shadows.map(s=>s.light.castShadow)');
  assert(lightFlags.every(Boolean));assert.equal(lightFlags.length,5);
  await evaluate(`new Promise(resolve=>{let n=0;const step=()=>{__shelf.camera.lookAt(2.05+(n%2)*.03,.8,-1.85);__shelf.redraw();if(++n<20)requestAnimationFrame(step);else resolve();};step();})`);
  assert(await evaluate('__shelf.shadows.every(s=>s.n===0)'),'A camera-only turn regenerated depth maps');
  await evaluate("dispatchEvent(new CustomEvent('sectionchange',{detail:'projects'}));dispatchEvent(new CustomEvent('itemchange',{detail:'transformable-rover'}));");
  await sleep(400);
  assert(await evaluate('__shelf.shadows.some(s=>s.light.intensity>0&&s.n>0)'),'Moving exhibit did not refresh shadows');
  assert(await evaluate('__shelf.shadows.filter(s=>s.light.intensity===0).every(s=>s.n===0)'),'Zero-intensity lights regenerated shadows');
  await evaluate("dispatchEvent(new CustomEvent('sectionchange',{detail:'top'}));dispatchEvent(new CustomEvent('itemchange',{detail:''}));");await quiet();
  console.log('PASS: camera reuses depth maps, exhibit motion invalidates, zero-intensity lights skip, five shadow lights retained');
  // Coalesce many events, and never raycast a hidden/ghosted mesh.
  const synchronousRays=await evaluate(`(()=>{let m;__shelf.scene.traverse(o=>{if(o.type==='Mesh'&&!Object.hasOwn(o,'raycast'))m=o;});const proto=Object.getPrototypeOf(m),cast=proto.raycast;__shelf.rays=0;__shelf.hiddenRays=0;proto.raycast=function(...args){__shelf.rays++;for(let p=this;p;p=p.parent)if(!p.visible||p.userData.ghost){__shelf.hiddenRays++;break;}return cast.apply(this,args);};const c=__shelf.renderer.domElement,r=c.getBoundingClientRect();for(let i=0;i<50;i++)c.dispatchEvent(new PointerEvent('pointermove',{clientX:r.x+r.width*.4,clientY:r.y+r.height*.55,pointerType:'mouse',bubbles:true}));return __shelf.rays;})()`);
  assert.equal(synchronousRays,0,'Hover ran synchronously for every event');await sleep(200);
  const picking=await evaluate('({rays:__shelf.rays,hidden:__shelf.hiddenRays,meshes:__shelf.scene.getObjectsByProperty("isMesh",true).length})');
  assert(picking.rays>0&&picking.rays<=picking.meshes,'Hover performed more than one scene query');assert.equal(picking.hidden,0);
  console.log('PASS: 50 hover events coalesced into one visible-object query',picking);
  // A real screen-space point on the model, checked against the full scene as a reference.
  await evaluate(`window.__visiblePoint=(root)=>{const {scene,camera:c,renderer}=__shelf;const meshes=[];root.traverse(o=>{if(o.isMesh)meshes.push(o);});const v=c.position.clone(),r=renderer.domElement.getBoundingClientRect(),ray=new __shelf.rayType();const shown=o=>{for(let p=o;p;p=p.parent)if(!p.visible||p.userData.ghost)return false;return true;};for(const m of meshes){const a=m.geometry.attributes.position,idx=m.geometry.index,n=idx?idx.count:a.count;for(let i=0;i<n-2;i+=Math.max(3,Math.ceil(n/180)*3)){v.set(0,0,0);for(let j=0;j<3;j++){const k=idx?idx.getX(i+j):i+j;v.x+=a.getX(k)/3;v.y+=a.getY(k)/3;v.z+=a.getZ(k)/3;}v.applyMatrix4(m.matrixWorld).project(c);if(Math.abs(v.x)>.9||Math.abs(v.y)>.9||v.z>1)continue;ray.setFromCamera({x:v.x,y:v.y},c);const h=ray.intersectObjects(scene.children,true).find(h=>shown(h.object));if(!h)continue;for(let p=h.object;p;p=p.parent)if(p===root){return {x:r.x+(v.x+1)*.5*r.width,y:r.y+(1-v.y)*.5*r.height};}}}throw Error('No visible point on '+root?.name);};__shelf.pickPoint=__visiblePoint(__shelf.scene.getObjectByName('project-transformable-rover'));`);
  const point=await evaluate('__shelf.pickPoint');
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(250);
  assert.equal(await evaluate('__shelf.renderer.domElement.style.cursor'),'pointer');
  await evaluate(`(()=>{const {scene,camera:c}=__shelf,m=scene.getObjectByName('mattress_mesh');m.geometry.computeBoundingBox();__shelf.blocker={m,position:m.position.clone(),scale:m.scale.clone()};const ray=new __shelf.rayType(),rect=__shelf.renderer.domElement.getBoundingClientRect(),p=__shelf.pickPoint;ray.setFromCamera({x:(p.x-rect.x)/rect.width*2-1,y:1-(p.y-rect.y)/rect.height*2},c);const at=ray.ray.direction.clone().multiplyScalar(.8).add(c.position).applyMatrix4(m.parent.matrixWorld.clone().invert());m.scale.multiplyScalar(6);const centre=m.geometry.boundingBox.getCenter(c.position.clone()).multiply(m.scale).applyQuaternion(m.quaternion);m.position.copy(at).sub(centre);document.querySelector('.room-pins').hidden=true;__shelf.redraw();})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await sleep(250);
  assert.equal(await evaluate('__shelf.renderer.domElement.style.cursor'),'grab','Picking crossed an opaque mattress');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});await sleep(900);
  assert.equal(await evaluate('location.hash'),'#room','Click crossed an opaque occluder');
  await evaluate(`(()=>{const {m,position,scale}=__shelf.blocker;m.position.copy(position);m.scale.copy(scale);__shelf.renderer.domElement.dispatchEvent(new PointerEvent('pointerleave'));__shelf.redraw();})()`);
  console.log('PASS: visible model hover works; opaque non-interactive geometry blocks hover and clicks');
  // Draggable bed objects must survive the candidate-only picking optimization.
  await camera([2.3,3.1,1.7],[1,.65,-.55]);
  for (const name of ['pillow', 'plush_umich', 'plush_uw', 'plush_sjtu']) {
    const start=await evaluate(`(()=>{const o=__shelf.scene.getObjectByName(${JSON.stringify(name)});if(!o)throw Error('Missing toy '+${JSON.stringify(name)});__shelf.toy=o;return {point:__visiblePoint(o),position:o.getWorldPosition(__shelf.camera.position.clone()).toArray(),camera:__shelf.camera.matrixWorld.elements.slice()};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...start.point,button:'left',buttons:1,clickCount:1});
    await sleep(450);
    assert.equal(await evaluate('__shelf.renderer.domElement.style.cursor'),'grabbing',`${name}: pointer did not grab the toy`);
    const lifted=await evaluate('__shelf.toy.getWorldPosition(__shelf.camera.position.clone()).toArray()');
    assert(lifted[1]>start.position[1]+.12,`${name}: toy did not lift`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.point.x+18,y:start.point.y+10,button:'left',buttons:1});
    await sleep(400);
    const carried=await evaluate('__shelf.toy.getWorldPosition(__shelf.camera.position.clone()).toArray()');
    assert(Math.hypot(carried[0]-lifted[0],carried[2]-lifted[2])>.015,`${name}: toy did not follow the pointer`);
    assert.deepEqual(await evaluate('__shelf.camera.matrixWorld.elements'),start.camera,`${name}: dragging orbited the camera`);
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.point.x+18,y:start.point.y+10,button:'left',buttons:0,clickCount:1});
    await sleep(2200);
    assert.equal(await evaluate('__shelf.renderer.domElement.style.cursor'),'grab',`${name}: pointer remained captured`);
    assert((await evaluate('__shelf.toy.getWorldPosition(__shelf.camera.position.clone()).y'))<carried[1]-.08,`${name}: released toy did not fall`);
    console.log('PASS: bed toy lifts, follows pointer and falls on release without camera movement',name);
  }
  const clickAt=async p=>{await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});};
  await camera([2.6,1.45,-2.55],[2.07,.8,-3.51]);
  await evaluate(`__shelf.clock=__shelf.scene.children.find(o=>o.userData.closeup==='desk'&&o.getObjectByName('digit_0'));__shelf.clockLight=__shelf.clock.children.find(o=>o.isPointLight);void 0;`);
  await clickAt(await evaluate('__visiblePoint(__shelf.clock)'));
  await until("location.hash==='#room/desk'",'clock opens desk');await sleep(1300);
  const deskCamera=await evaluate('__shelf.camera.matrixWorld.elements.slice()');
  await clickAt(await evaluate('__visiblePoint(__shelf.clock)'));await sleep(1400);
  assert((await evaluate('__shelf.clockLight.intensity'))<.004,'Desk clock did not turn off');
  await clickAt(await evaluate('__visiblePoint(__shelf.clock)'));await sleep(1400);
  assert((await evaluate('__shelf.clockLight.intensity'))>.1,'Desk clock did not turn back on');
  assert.equal(await evaluate('location.hash'),'#room/desk');assert.deepEqual(await evaluate('__shelf.camera.matrixWorld.elements'),deskCamera);
  await until("!!__shelf.scene.getObjectByName('tissue-ready')",'lazy tissue interaction');
  const paperPoint=await evaluate("__visiblePoint(__shelf.scene.getObjectByName('tissue-ready'))");
  const paperPrograms=await evaluate('__shelf.renderer.info.programs.length');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...paperPoint,button:'left',buttons:1,clickCount:1});
  await sleep(160);
  assert.equal(await evaluate('__shelf.renderer.domElement.style.cursor'),'grabbing','Exposed tissue cannot be grabbed');
  for(let i=1;i<=8;i++){
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:paperPoint.x+25*i/8,y:paperPoint.y-230*i/8,button:'left',buttons:1});await sleep(35);
  }
  await sleep(300);
  const paper=await evaluate(`(()=>{const s=__shelf.scene,p=s.getObjectByName('tissue-pulled'),r=s.getObjectByName('tissue-ready');return {pulled:!!p,next:!!r,separate:p?.geometry!==r?.geometry,vertices:p?.geometry.attributes.position.count,programs:__shelf.renderer.info.programs.length};})()`);
  assert(paper.pulled&&paper.next&&paper.separate,'Pulling a sheet did not ready the next tissue');
  assert(paper.vertices<=130,'Tissue mesh exceeds the small cloth-grid budget');
  assert.equal(paper.programs,paperPrograms,'Tissue pulling introduced a new shader program');
  assert.deepEqual(await evaluate('__shelf.camera.matrixWorld.elements'),deskCamera,'Tissue drag moved the desk camera');
  if(process.env.ROOM_COLLECTIBLE_SHOTS){mkdirSync(process.env.ROOM_COLLECTIBLE_SHOTS,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(process.env.ROOM_COLLECTIBLE_SHOTS,'tissue-pull.png'),Buffer.from(shot.data,'base64'));}
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:paperPoint.x+25,y:paperPoint.y-230,button:'left',buttons:0,clickCount:1});
  await sleep(4500);
  assert.equal(await evaluate("__shelf.scene.getObjectsByProperty('name','tissue-pulled').length"),0,'Released tissue did not clean itself up');
  // Leaving the view must also release a motionless held sheet.
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...(await evaluate("__visiblePoint(__shelf.scene.getObjectByName('tissue-ready'))")),button:'left',buttons:1,clickCount:1});await sleep(100);
  await evaluate(`document.querySelector('[data-closeup="back"]').click()`);await until("location.hash==='#room'",'back from desk');await sleep(1300);
  assert.equal(await evaluate('__shelf.renderer.domElement.hasPointerCapture(1)'),false,'Leaving the desk retained tissue pointer capture');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...paperPoint,button:'left',buttons:0});
  console.log('PASS: tissue pulls into a soft low-poly sheet, readies its successor, reuses warmed shaders and cleans up on release/exit');
  console.log('PASS: clicking the clock opens desk; repeated clicks switch it without moving the view');
  await evaluate("document.getElementById('theme-switch').click()");
  await camera([1.4,1.4,-1.3],[1.4,1.2,0]);await quiet();
  await evaluate('__perf.frames=[]');await sleep(2100);
  const idle=await evaluate('__perf.frames.filter(f=>!f.target).length');assert(idle<=3,`Off-screen night effects drive redraws: ${idle}`);
  assert.deepEqual(await evaluate('__shelf.shadows.map(s=>s.light.castShadow)'),lightFlags);
  console.log('PASS: unseen night effects settle to clock-only idle',idle,'frames / 2.1 s');
  await until("!!document.querySelector('[data-distance] .map .map-still')",'map released to snapshot',30000);
  assert.equal(await evaluate("document.querySelectorAll('[data-distance] .map canvas').length"),0,'Map kept its WebGL canvas');
  const oldMap=await evaluate("document.querySelector('[data-distance] .map .map-still').src");
  await evaluate("document.getElementById('theme-switch').click()");
  await until(`!!document.querySelector('[data-distance] .map .map-still')&&document.querySelector('[data-distance] .map .map-still').src!==${JSON.stringify(oldMap)}`,'map theme snapshot',30000);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await sleep(400);
  await until("!!document.querySelector('[data-distance] .map .map-still')&&!document.querySelector('[data-distance] .map canvas')",'map resize snapshot',30000);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await sleep(400);
  await until("!!document.querySelector('[data-distance] .map .map-still')&&!document.querySelector('[data-distance] .map canvas')",'map cached snapshot',30000);
  console.log('PASS: map releases WebGL and preserves page/room snapshots across theme and resize');
  if(process.env.ROOM_MIRROR_PIXELS){
    const sharp=(await import('sharp')).default;
    const poses=[
      ['offset',[1.8,1.5,-1.38],[3.98,.8,-.95]],
      ['orbit',[1,3.5,2.5],[2.05,.85,-1.85]],
      ['front',[1.8,1.5,-1.38],[3.98,.8,-1.38]],
      ['left',[2.25,1.35,-.6],[3.98,.8,-1.38]],
      ['right',[2.3,1.2,-2.6],[3.98,.85,-1.38]],
      ['close',[3.6,.9,-1.38],[3.98,.85,-1.38]],
      ['partial',[2.9,1.1,-1.2],[4.2,.8,-.4]],
      ['near',[3.94,1.1,-1.38],[3.98,.9,-1.38]],
      ['back',[4.10,1.1,-1.38],[3.8,.9,-1.38]],
      ['cutaway',[1,3.1,-.2],[3.98,.8,-1.38]],
    ];
    const captureCanvas=async expression=>Buffer.from(await evaluate(expression),'base64');
    for(const size of [[1440,900],[390,844]]){
      await send('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:2,mobile:size[0]<901});await sleep(600);
      for(const theme of ['dark','light']){
        if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.getElementById('theme-switch').click()");await sleep(1600);
        for(const [name,p,t]of poses){
          await camera(p,t);
          // Freeze animation callbacks, then render the IDENTICAL scene with full/scissored targets.
          await evaluate(`(()=>{const raf=requestAnimationFrame,held=[];window.__resumeRaf=()=>{window.requestAnimationFrame=raf;held.forEach(f=>raf(f));};window.requestAnimationFrame=f=>{held.push(f);return held.length;};})()`);await sleep(100);
          const full=await captureCanvas(`(()=>{const {renderer:r,scene,camera}=__shelf,t=scene.getObjectByName('mirror-reflection').getRenderTarget();window.__set=t.scissor.set;t.scissor.set=function(){return __set.call(this,0,0,t.width,t.height);};r.render(scene,camera);return r.domElement.toDataURL('image/png').split(',')[1];})()`);
          const cropped=await captureCanvas(`(()=>{const {renderer:r,scene,camera}=__shelf,t=scene.getObjectByName('mirror-reflection').getRenderTarget(),previous=r.getRenderTarget();t.scissor.set=__set;t.scissorTest=false;r.setRenderTarget(t);r.state.buffers.color.setMask(true);r.state.buffers.depth.setMask(true);r.clear();r.setRenderTarget(previous);r.render(scene,camera);return r.domElement.toDataURL('image/png').split(',')[1];})()`);
          const coverage=await evaluate(`(()=>{const m=__shelf.scene.getObjectByName('mirror-reflection'),t=m.getRenderTarget(),c=__shelf.camera,v=c.position.clone(),n=v.clone().set(0,0,1).transformDirection(m.matrixWorld);if(m.userData.ghost||v.sub(m.getWorldPosition(v.clone())).dot(n)<=0)return null;const b=m.geometry.boundingBox,uv=[];for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])uv.push(v.clone().set(x,y,0).applyMatrix4(m.material.uniforms.textureMatrix.value));const clamp=x=>Math.max(0,Math.min(1,x)),xs=uv.map(p=>clamp(p.x)*t.width),ys=uv.map(p=>clamp(p.y)*t.height),box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)],r=t.scissor;return {box,scissor:r.toArray(),ok:r.x<=box[0]+.01&&r.y<=box[1]+.01&&r.x+r.z>=box[2]-.01&&r.y+r.w>=box[3]-.01};})()`);
          if(coverage&&name==='offset')assert(coverage.ok,`${theme}/${size}/${name}: scissor excludes glass texture coordinates: ${JSON.stringify(coverage)}`);
          const [a,b]=await Promise.all([sharp(full).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(cropped).ensureAlpha().raw().toBuffer()]);
          if(name==='front') {
            const region=await sharp(cropped).extract({left:Math.floor(a.info.width*.41),top:Math.floor(a.info.height*.3),width:Math.floor(a.info.width*.16),height:Math.floor(a.info.height*.5)}).stats();
            assert(region.channels.slice(0,3).some(c=>c.mean>12&&c.stdev>10),'Mirror image is black or blank');
          }
          let changed=0;
          for(let i=0;i<b.length;i+=4)if(Math.max(...[0,1,2,3].map(c=>Math.abs(a.data[i+c]-b[i+c])))>2)changed++;
          const fraction=changed/(a.info.width*a.info.height);
          assert(fraction<.0005,`${theme}/${size}/${name}: cropped reflection differs on ${(fraction*100).toFixed(3)}% of pixels`);
          if(process.env.ROOM_SCREENSHOTS&&name==='front'&&size[0]===1440){mkdirSync(process.env.ROOM_SCREENSHOTS,{recursive:true});writeFileSync(join(process.env.ROOM_SCREENSHOTS,`mirror-${theme}.png`),cropped);}
          await evaluate('__resumeRaf()');
          console.log('PASS: mirror pixels',theme,size.join('x'),name,changed,'pixels > 2/255');
        }
      }
    }
  }
  }
  await camera([2.86,.90,-1.8],[2.86,.59,-3.36]);
  const screenGap=await evaluate(`(()=>{const {scene,camera:c,renderer}=__shelf;scene.updateMatrixWorld(true);const screen=scene.getObjectByName('tv').parent.getObjectByName('screen');if(!screen)throw Error('TV screen missing');const ys=root=>{const values=[],v=c.position.clone();root.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).project(c);values.push(v.y);}});return values;};return (Math.min(...ys(screen))-Math.max(...ys(scene.getObjectByName('m1917_figure'))))*renderer.domElement.getBoundingClientRect().height/2;})()`);
  assert(screenGap>=1,`M1917 overlaps the TV screen in the cabinet front view (${screenGap.toFixed(2)} px gap)`);
  console.log('PASS: M1917 stays below the TV screen in front view',screenGap.toFixed(2),'px gap');
  if(process.env.ROOM_COLLECTIBLE_SHOTS){
    mkdirSync(process.env.ROOM_COLLECTIBLE_SHOTS,{recursive:true});
    for(const theme of ['light','dark']){
      if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.getElementById('theme-switch').click()");
      await sleep(1800);
      const shot=await send('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(process.env.ROOM_COLLECTIBLE_SHOTS,`tv-collectibles-${theme}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  if(process.env.ROOM_COLLECTIBLE_SHOTS){
    await camera([.99,.40,-2.70],[.15,.20,-3.28]);
    for(const theme of ['light','dark']){
      if(await evaluate('document.documentElement.dataset.theme')!==theme)await evaluate("document.getElementById('theme-switch').click()");
      await sleep(1400);const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(process.env.ROOM_COLLECTIBLE_SHOTS,`shelf-tech-${theme}.png`),Buffer.from(shot.data,'base64'));
    }
  }
  assert.deepEqual(errors,[]);console.log(process.env.ROOM_PROPS_ONLY?'PASS: prop placement and day/night render':'PASS: performance behavior and unchanged visual quality');
}finally{socket?.close();chrome.kill();if(chrome.pid&&chrome.exitCode===null&&chrome.signalCode===null)await new Promise(resolve=>chrome.once('exit',resolve));rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
