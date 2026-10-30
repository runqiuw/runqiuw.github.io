// Deterministic room screenshot fixture. Requires a built site served by Astro preview.
// The capture is intended for matching devices/browsers; inspect its manifest before comparison.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {tmpdir,hostname,release,arch} from 'node:os';
import {join, resolve} from 'node:path';
import sharp from 'sharp';

const site=(process.env.URL??'http://localhost:4321').replace(/\/+$/,''), out=resolve(process.env.CAPTURE_OUT??'/private/tmp/room-baseline');
const mapCache=process.env.CAPTURE_MAP_CACHE?resolve(process.env.CAPTURE_MAP_CACHE):null,recordMap=!!process.env.CAPTURE_MAP_RECORD;
assert(!recordMap||mapCache,'CAPTURE_MAP_RECORD requires CAPTURE_MAP_CACHE');
const mapUsed=new Map(),inflight=new Map();if(mapCache&&recordMap)mkdirSync(mapCache,{recursive:true});
const digest=value=>createHash('sha256').update(value).digest('hex');
const dpr=Number(process.env.DPR??1);
const profile=mkdtempSync(join(tmpdir(),'room-baseline-'));
const chrome=spawn(process.env.CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new',...(process.env.SOFTWARE?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[]),'--remote-debugging-port=0',`--user-data-dir=${profile}`,'--window-size=1440,900','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'
],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let socket;
try{
  let port;for(let i=0;i<100&&!port;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{}if(!port)await sleep(100);}assert(port,'Chrome did not start');
  const tab=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');socket=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok,fail)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',fail,{once:true});});
  let serial=0;const pending=new Map(),errors=[],shadowChecks=[];
  socket.addEventListener('message',async({data})=>{
    const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    pending.get(m.id)?.(m);pending.delete(m.id);
    if(m.method==='Fetch.requestPaused'){
      try {
        const url=m.params.request.url;
        if(mapCache&&!url.includes('geojs')){
          const key=digest(url),path=join(mapCache,`${key}.json`);let entry;
          if(existsSync(path))entry=JSON.parse(readFileSync(path,'utf8'));
          else {
            if(!recordMap)throw Error(`Map fixture cache misses ${url}; record it first`);
            if(!inflight.has(key))inflight.set(key,(async()=>{const response=await fetch(url);if(!response.ok)throw Error(`Map fixture download failed: ${response.status} ${url}`);const body=Buffer.from(await response.arrayBuffer());const data={url,type:response.headers.get('content-type')??'application/octet-stream',body:body.toString('base64')};writeFileSync(path,JSON.stringify(data));return data;})());
            entry=await inflight.get(key);
          }
          if(entry.url!==url)throw Error('Map fixture URL hash mismatch');
          mapUsed.set(key,digest(Buffer.from(entry.body,'base64')));
          await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:entry.type},{name:'access-control-allow-origin',value:'*'}],body:entry.body});
        } else {
          // Fixed city; the quick fixture replaces real tiles with a deterministic background.
          const dark=url.includes('/dark'),body=url.includes('geojs')?{latitude:'40.7',longitude:'-74.0',country_code:'US'}:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':dark?'#25294a':'#dfe3ec'}}]};
          await send('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'access-control-allow-origin',value:'*'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
        }
      } catch(e){errors.push(e.message);await send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'});}
    }
  });
  const send=(method,params={})=>new Promise((ok,fail)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);fail(Error(`${method} timed out`));},30000);pending.set(id,m=>{clearTimeout(timer);m.error?fail(Error(JSON.stringify(m.error))):ok(m.result);});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const until=async(expr,label,timeout=120000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expr))return;await sleep(100);}throw Error(`Timed out: ${label}`);};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:dpr,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    localStorage.setItem('theme','light');window.__roomTestHook=room=>{window.__fixture=room;};
    const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-28T18:34:56Z']));}static now(){return NativeDate.now();}};
    let seed=123456789;window.__fixtureSeed=()=>{seed=123456789;};Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    const nativeNow=performance.now.bind(performance),nativeRaf=requestAnimationFrame.bind(window);let frozen=false,queued=[];
    Object.defineProperty(performance,'now',{value:()=>frozen?1000000:nativeNow()});
    window.requestAnimationFrame=cb=>nativeRaf(t=>{if(frozen)queued.push(cb);else cb(t);});
    window.__fixtureFreeze=()=>{frozen=true;};window.__fixtureThaw=()=>{frozen=false;for(const cb of queued)nativeRaf(cb);queued=[];};
    window.__fixtureVideos=[];const create=document.createElement.bind(document);document.createElement=function(name,...args){const node=create(name,...args);if(name.toLowerCase()==='video')window.__fixtureVideos.push(node);return node;};
    const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){
      if(this.tagName!=='VIDEO')return play.call(this);
      const video=this;video.dataset.fixturePending='yes';
      return play.call(video).then(()=>new Promise(resolve=>{
        let done=false;const finish=()=>{if(done)return;done=true;video.pause();delete video.dataset.fixturePending;resolve();};
        const seek=()=>{const time=Math.min(.5,Number.isFinite(video.duration)?video.duration/2:.5);if(Math.abs(video.currentTime-time)<.005)return finish();video.addEventListener('seeked',finish,{once:true});video.currentTime=time;};
        if(video.readyState>=1)seek();else video.addEventListener('loadedmetadata',seek,{once:true});setTimeout(finish,5000);
      })).catch(e=>{delete video.dataset.fixturePending;throw e;});
    };
  `});
  await send('Fetch.enable',{patterns:[{urlPattern:mapCache?'https://tiles.openfreemap.org/*':'https://tiles.openfreemap.org/styles/*'},{urlPattern:'https://get.geojs.io/*'}]});
  mkdirSync(out,{recursive:true});await send('Page.navigate',{url:site});
  await until('!!window.__fixture','room test hook');
  await until("document.querySelector('.frame.live')",'room live');
  // Assets deferred until after the room is ready (the snack stash) must be shown before any capture.
  await evaluate('__fixture.late');
  await evaluate('document.fonts.ready');await until("!__fixtureVideos.some(v=>v.dataset.fixturePending)",'video seeks');
  const environment=await evaluate(`({fixtureVersion:2,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,browser:navigator.userAgent,renderer:(()=>{const g=__fixture.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):null;})(),viewport:[1440,900],dpr:${dpr},clock:'2026-10-28T18:34:56Z',seed:123456789,videoFrame:'min(0.5 seconds, half duration)',map:${JSON.stringify(mapCache?'recorded OpenFreeMap assets':'fixed background fixture, no map tiles')},capture:'room WebGL canvas',settledSway:'zero',settledPops:'target',hoopsHistory:'settled earlier projectiles hidden'})`);
  Object.assign(environment,{machine:digest(hostname()).slice(0,16),osRelease:release(),architecture:arch()});
  const images=[];
  // Require the camera and representative physical/interactive objects to stop moving.
  // A small shader-spring residue is zeroed only after the position check has settled.
  const settle=async()=>{
    await sleep(2500);let previous='',stable=0;
    for(let i=0;i<300;i++){
      const state=await evaluate(`(()=>{const f=__fixture;f.scene.updateMatrixWorld(true);const values=[...f.camera.matrixWorld.elements,...f.camera.projectionMatrix.elements];for(const name of ['pillow','plush_umich','plush_uw','plush_sjtu','project-transformable-rover','drawer_1','door_R']){const o=f.scene.getObjectByName(name);if(o)values.push(...o.matrixWorld.elements);}for(const o of f.openers)values.push(o.k);let popsReady=true;for(const p of f.pops){values.push(p.c,p.t);if(Math.abs(p.t-p.c)>=.002)popsReady=false;}let sway=0,ripple=0;f.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(!m)continue;const u=f.renderer.properties.get(m).uniforms;if(u?.uSway)sway=Math.max(sway,Math.hypot(u.uSway.value.x,u.uSway.value.y));if(u?.uRipple)ripple=Math.max(ripple,Math.abs(u.uRipple.value));}});values.push(sway,ripple);return {values:values.map(x=>Math.round(x*100000)),sway,ripple,popsReady};})()`);
      const current=JSON.stringify(state.values);stable=current===previous&&state.popsReady&&state.sway<=.0001&&state.ripple<=.0005?stable+1:0;previous=current;if(stable>=3)return;await sleep(300);
    }
    throw Error('Camera, tracked objects or spring uniforms failed to settle');
  };
  // Render the settled, frozen state with the room's own shadow caching, then with every shadow map
  // refreshed. Any difference is a stale shadow that forced fixture renders would otherwise hide.
  const shadowCheck=async name=>{
    const shots=await evaluate(`(()=>{__fixtureFreeze();const f=__fixture,shot=force=>{f.draw(force);return f.renderer.domElement.toDataURL('image/png').split(',')[1];};const r=[shot(false),shot(true)];__fixtureThaw();return r;})()`);
    const [live,forced]=await Promise.all(shots.map(x=>sharp(Buffer.from(x,'base64')).ensureAlpha().raw().toBuffer()));
    let changed=0;for(let i=0;i<live.length;i+=4)if(live[i]!==forced[i]||live[i+1]!==forced[i+1]||live[i+2]!==forced[i+2]||live[i+3]!==forced[i+3])changed++;
    shadowChecks.push({name,changedPixels:changed});if(changed)console.log(`STALE SHADOW ${name}: ${changed} pixels`);
  };
  const snap=async (name,meta={})=>{
    await until("!__fixtureVideos.some(v=>v.dataset.fixturePending)",'video seek');await settle();
    const videos=await evaluate(`(()=>{const found=new Set();__fixture.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m?.map?.isVideoTexture)found.add(m.map.image);});return [...found].map(v=>({src:v.dataset.src??'',ready:v.readyState,paused:v.paused,time:v.currentTime,target:Math.min(.5,Number.isFinite(v.duration)?v.duration/2:.5)}));})()`);
    for(const video of videos)assert(video.ready>=2&&video.paused&&Math.abs(video.time-video.target)<.03,`Video did not settle on its fixed frame: ${JSON.stringify(video)}`);
    await shadowCheck(name);
    const shot=await evaluate(`(()=>{__fixtureFreeze();const {scene,renderer,pops}=__fixture;for(const p of pops){p.c=p.t;p.o.position.copy(p.base.p).addScaledVector(p.d.p,p.c);p.o.rotation.x=p.base.r+p.d.r*p.c;if(p.d.s)p.o.scale.setScalar(p.base.s+p.d.s*p.c);}const steam=scene.getObjectByName('mug-steam');if(steam?.material.uniforms?.uTime)steam.material.uniforms.uTime.value=1000;scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(!m)continue;const u=renderer.properties.get(m).uniforms;if(u?.uSway)u.uSway.value.set(0,0);if(u?.uRipple)u.uRipple.value=0;}});__fixture.draw();return renderer.domElement.toDataURL('image/png').split(',')[1];})()`);
    writeFileSync(join(out,`${name}.png`),Buffer.from(shot,'base64'));
    const scale=await evaluate('__fixture.renderer.domElement.width / __fixture.renderer.domElement.clientWidth');
    await evaluate('__fixtureThaw()');const record={file:`${name}.png`,...meta};if(name.endsWith('-desk'))record.crops=[{name:'keyboard',left:Math.round(650*scale),top:Math.round(570*scale),width:Math.round(260*scale),height:Math.round(120*scale)},{name:'screen-title',left:Math.round(780*scale),top:Math.round(180*scale),width:Math.round(440*scale),height:Math.round(260*scale)}];else if(name.endsWith('-board'))record.crops=[{name:'map-labels',left:Math.round(620*scale),top:Math.round(310*scale),width:Math.round(220*scale),height:Math.round(220*scale)}];else if(name.endsWith('-drawer-open'))record.crops=[{name:'nightstand-products',left:Math.round(400*scale),top:Math.round(70*scale),width:Math.round(640*scale),height:Math.round(300*scale)}];else if(/-(snacks-door-open|graphics-card|graphics-label|m1917|poster)$/.test(name))record.crops=[{name:name.split('-').slice(1).join('-')+'-detail',left:Math.round(300*scale),top:Math.round(120*scale),width:Math.round(840*scale),height:Math.round(600*scale)}];images.push(record);console.log(`Captured ${name}`);
  };
  // Controlled camera sequence checks frame-to-frame cutaway stability without waiting on wall time.
  const turnSequence=async name=>{
    await settle();
    await evaluate(`(()=>{__fixtureFreeze();const f=__fixture;f.controls.enabled=false;f.turnStart=f.camera.position.clone();f.turnTarget=f.controls.target.clone();for(const p of f.pops){p.c=p.t;p.o.position.copy(p.base.p).addScaledVector(p.d.p,p.c);p.o.rotation.x=p.base.r+p.d.r*p.c;if(p.d.s)p.o.scale.setScalar(p.base.s+p.d.s*p.c);}const steam=f.scene.getObjectByName('mug-steam');if(steam?.material.uniforms?.uTime)steam.material.uniforms.uTime.value=1000;f.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(!m)continue;const u=f.renderer.properties.get(m).uniforms;if(u?.uSway)u.uSway.value.set(0,0);if(u?.uRipple)u.uRipple.value=0;}});f.draw();})()`);
    for(let i=0;i<16;i++){
      const angle=-.12+i*.24/15;
      const shot=await evaluate(`(()=>{const f=__fixture,axis=f.camera.position.clone().set(0,1,0);f.camera.position.copy(f.turnStart).sub(f.turnTarget).applyAxisAngle(axis,${angle}).add(f.turnTarget);f.camera.lookAt(f.turnTarget);f.camera.updateMatrixWorld();f.draw(false);return f.renderer.domElement.toDataURL('image/png').split(',')[1];})()`);
      const file=`${name}-${String(i).padStart(2,'0')}.png`;writeFileSync(join(out,file),Buffer.from(shot,'base64'));images.push({file});
    }
    await evaluate(`(()=>{const f=__fixture;f.camera.position.copy(f.turnStart);f.camera.lookAt(f.turnTarget);f.camera.updateMatrixWorld();f.controls.enabled=true;__fixtureThaw();})()`);
    console.log(`Captured ${name}: 16 camera frames`);
  };
  const section=async id=>{await evaluate(`(()=>{const s=document.getElementById(${JSON.stringify(id)});if(!s)throw Error('Missing section');s.scrollIntoView({behavior:'instant',block:'center'});})()`);await sleep(500);await evaluate(`dispatchEvent(new CustomEvent('sectionchange',{detail:${JSON.stringify(id)}}))`);};
  const enter=async()=>{await evaluate("document.getElementById('room-enter').click()");await until("location.hash==='#room' && !document.querySelector('.room-pins').hidden",'full room');};
  // Hiding is the fixture's own scene change, so it refreshes the shadow maps itself.
  const hideOldThrows=()=>evaluate(`(()=>{for(const o of __fixture.scene.children)if(o.name!=='hoops-hand'&&o.type==='Group'&&['ball_paper','bottle','ball_bouncy'].some(n=>o.getObjectByName(n)))o.visible=false;__fixture.draw(true);})()`);
  const focus=async(id,button=id)=>{await evaluate(`document.querySelector('[data-go="${button}"]').click()`);await until(`location.hash==='#room/${id}'`,id);if(id==='hoops')await until("document.querySelector('.hoops-turn')?.dataset.phase==='ready'",'hoops ready');};
  const back=async()=>{await evaluate("document.querySelector('[data-closeup=back]').click()");await until("location.hash==='#room'",'back');};
  const exit=async()=>{await evaluate("document.getElementById('room-exit').click()");await until("!document.querySelector('.room.full')",'exit room');};
  for(const theme of (process.env.CAPTURE_PILLOW_ONLY?[]:process.env.CAPTURE_HOOPS_ONLY?['day']:['day','night'])){
    if(theme==='night'){
      const prior=await evaluate("(window.__priorMap=document.querySelector('.map-still')?.src??'',!!window.__priorMap)");
      await evaluate("document.getElementById('theme-switch').click()");await sleep(3000);
      if(prior)await until("document.querySelector('.map-still')?.src!==window.__priorMap && !!document.querySelector('.map-still') && !document.querySelector('.maplibregl-canvas')",'night map snapshot');
    }
    await snap(`${theme}-top`);
    for(const id of (process.env.CAPTURE_HOOPS_ONLY?[]:process.env.CAPTURE_SMOKE?['research','projects']:['research','projects','games','playground'])){await section(id);if(id==='playground')await until("document.querySelector('.map-still') && !document.querySelector('.maplibregl-canvas')",'completed distance-map snapshot');await snap(`${theme}-${id}`);if(id==='projects'){
      await evaluate(`(()=>{const item=document.querySelector('#projects [data-item="transformable-rover"]');if(!item)throw Error('Missing Rover card');item.scrollIntoView({behavior:'instant',block:'center'});item.dispatchEvent(new PointerEvent('pointerenter'));})()`);
      await until("document.documentElement.dataset.item==='transformable-rover' && __fixture.scene.getObjectByName('project-transformable-rover').scale.x>1.005",'project hover');
      await snap(`${theme}-projects-hover`);await evaluate(`document.querySelector('#projects [data-item="transformable-rover"]').dispatchEvent(new PointerEvent('pointerleave'))`);
    }}
    await enter();await snap(`${theme}-room`);if(!process.env.CAPTURE_SMOKE&&!process.env.CAPTURE_HOOPS_ONLY)await turnSequence(`${theme}-turn`);
    for(const [id,button] of (process.env.CAPTURE_HOOPS_ONLY?[['hoops','hoops']]:process.env.CAPTURE_SMOKE?[['desk','desk']]:[['board','playground'],['desk','desk'],['hoops','hoops']])){
      if(id==='hoops')await evaluate('__fixtureSeed()');await focus(id,button);
      const spot=()=>evaluate("document.querySelector('.hoops-turn')?.dataset.spot");
      if(id==='hoops')await hideOldThrows();
      await snap(`${theme}-${id}`,id==='hoops'?{spot:await spot()}:{});
      if(id==='hoops'&&(!process.env.CAPTURE_SMOKE||process.env.CAPTURE_HOOPS_ONLY)){
        const seen=new Set([await spot()]);
        for(let n=2;n<=3;n++){
          const r=await evaluate("(()=>{const r=document.querySelector('.room-canvas').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.62,span:Math.min(r.width,r.height)};})()"),pull=r.span*.22*.55;
          await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',buttons:1,clickCount:1});
          await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x,y:r.y+pull,button:'left',buttons:1});
          await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x,y:r.y+pull,button:'left',buttons:0,clickCount:1});
          assert.equal(await evaluate("document.querySelector('.hoops-turn')?.dataset.phase"),'flight','Hoops throw did not start');
          await until("document.querySelector('.hoops-turn')?.dataset.phase==='ready'",'next hoops turn',30000);await sleep(11000);
          const next=await spot();assert(!seen.has(next),'Hoops fixture repeated a camera position');seen.add(next);await hideOldThrows();await snap(`${theme}-hoops-${n}`,{spot:next});
        }
      }
      await back();
    }
    if(!process.env.CAPTURE_SMOKE&&!process.env.CAPTURE_HOOPS_ONLY){
      await sleep(2200);
      const view=async(position,target,names)=>{await evaluate(`(()=>{const f=__fixture;f.controls.enabled=false;f.camera.position.set(...${JSON.stringify(position)});f.camera.lookAt(...${JSON.stringify(target)});f.camera.updateMatrixWorld();for(const name of ${JSON.stringify(names)}){const opener=f.openers.find(x=>x.o.name===name);if(!opener)throw Error('Missing opener '+name);opener.t=1;}})()`);await until(`__fixture.openers.filter(x=>${JSON.stringify(names)}.includes(x.o.name)).every(x=>x.k===1)`,'openers settled');};
      await view([3.26,.47,-2.78],[3.26,.27,-3.50],['door_R']);await snap(`${theme}-snacks-door-open`);
      await view([1.2,.9,-1.315],[.188,.45,-1.315],['drawer_1']);await snap(`${theme}-drawer-open`);
      await view([.48,.53,-3.43],[.15,.20,-3.505],[]);await snap(`${theme}-graphics-card`);
      await evaluate(`(()=>{const f=__fixture,o=f.scene.getObjectByName('rtx3070_fe');if(!o)throw Error('Missing RTX asset');f.savedRtx=o.quaternion.clone();o.rotateY(Math.PI);})()`);
      await snap(`${theme}-graphics-label`);await evaluate(`(()=>{const f=__fixture;f.scene.getObjectByName('rtx3070_fe').quaternion.copy(f.savedRtx);})()`);
      await view([2.68,.68,-2.7],[2.68,.55,-3.34],[]);await snap(`${theme}-m1917`);
      await view([2.09,2.0,-.8],[2.09,2.0,-.003],[]);await snap(`${theme}-poster`);
      await view([1.8,1.5,-1.38],[3.98,.8,-1.38],[]);
      await evaluate(`(()=>{const f=__fixture;f.savedTarget=f.controls.target.clone();f.controls.target.set(3.98,.8,-1.38);})()`);
      await snap(`${theme}-mirror-view`);await turnSequence(`${theme}-mirror-turn`);
      await evaluate(`(()=>{const f=__fixture;f.controls.target.copy(f.savedTarget);f.controls.enabled=true;})()`);
    }
    await exit();await evaluate("window.scrollTo({top:0,behavior:'instant'})");await sleep(1000);
  }
  // Physics leaves the pillow in a slightly different place each run, so this state is checked for
  // stale shadows only and is not part of the image comparison.
  if(!process.env.CAPTURE_SMOKE&&!process.env.CAPTURE_HOOPS_ONLY){
    if(process.env.CAPTURE_PILLOW_ONLY){await evaluate("document.getElementById('theme-switch').click()");await sleep(3000);}
    await enter();await settle();
    const where=()=>evaluate(`(()=>{const f=__fixture,o=f.scene.getObjectByName('pillow');f.scene.updateMatrixWorld(true);const w=o.getWorldPosition(f.camera.position.clone()),v=w.clone().project(f.camera),r=f.renderer.domElement.getBoundingClientRect();return {x:r.x+(v.x+1)/2*r.width,y:r.y+(1-v.y)/2*r.height,world:w.toArray()};})()`);
    const from=await where(),mouse=(type,x,y,buttons)=>send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',buttons,clickCount:1});
    await mouse('mouseMoved',from.x,from.y,0);await sleep(100);await mouse('mousePressed',from.x,from.y,1);
    for(let i=1;i<=12;i++){await mouse('mouseMoved',from.x-22*i,from.y+8*i,1);await sleep(32);}
    await mouse('mouseReleased',from.x-264,from.y+96,0);await settle();
    const to=await where();assert(Math.hypot(...to.world.map((v,i)=>v-from.world[i]))>.1,'Pillow drag did not move the pillow');
    await shadowCheck('night-toy-moved');await exit();
  }
  assert.equal(errors.length,0,errors.join('\n'));
  if(mapCache){assert(mapUsed.size,'No OpenFreeMap assets were captured');environment.mapCacheDigest=digest(readdirSync(mapCache).filter(n=>n.endsWith('.json')).sort().map(n=>`${n}:${digest(readFileSync(join(mapCache,n)))}`).join('\n'));}
  writeFileSync(join(out,'manifest.json'),JSON.stringify({environment,images},null,2)+'\n');console.log(`Saved ${join(out,'manifest.json')}`);
  writeFileSync(join(out,'shadow-checks.json'),JSON.stringify(shadowChecks,null,2)+'\n');
  const stale=shadowChecks.filter(c=>c.changedPixels);if(stale.length){console.log(`Stale shadows in ${stale.length} states`);process.exitCode=1;}
}finally{socket?.close();chrome.kill('SIGTERM');await sleep(500);rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
