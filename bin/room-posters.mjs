// Capture the real, fully prepared room. Virtual-time budgets can finish before GPU compilation
// or image callbacks, leaving blank game covers / prints in otherwise complete screenshots.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const site = process.env.URL ?? 'http://localhost:4321';
const profile = mkdtempSync(join(tmpdir(), 'room-posters-'));
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
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
  if (!port) throw Error('Chrome did not start');
  const tab = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const pending = new Map(), images = new Set();
  let serial = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message); pending.delete(message.id);
    if (message.method === 'Network.requestWillBeSent' && ['Image','Font'].includes(message.params.type)) images.add(message.params.requestId);
    if (['Network.loadingFinished','Network.loadingFailed'].includes(message.method)) images.delete(message.params.requestId);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, 30000);
    pending.set(id, message => { clearTimeout(timer); message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:2, mobile:false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source:"localStorage.setItem('theme','light');window.__posterReady=false;addEventListener('roomready',()=>window.__posterReady=true);" });
  await send('Page.navigate', { url:site });
  const deadline = Date.now() + 150000;
  while (!await evaluate("window.__posterReady&&!!document.querySelector('.frame.live')")) {
    if (Date.now() > deadline) throw Error('Room preparation timed out; posters were not replaced');
    await sleep(200);
  }
  await evaluate(`(()=>{const s=document.createElement('style');s.textContent='.enter,.loading,.help{display:none!important}.frame{border-radius:0!important;box-shadow:none!important}';document.head.append(s);})()`);
  for (const [theme, name] of [['light','day'], ['dark','night']]) {
    if (await evaluate('document.documentElement.dataset.theme') !== theme) await evaluate("document.getElementById('theme-switch').click()");
    while (images.size) {
      if (Date.now() > deadline) throw Error('Image loading timed out; poster was not replaced');
      await sleep(100);
    }
    await sleep(2200); // Finish the real theme/blind transition and present uploaded artwork.
    const frame = await evaluate("(()=>{const r=document.querySelector('.frame').getBoundingClientRect();return {left:Math.round(r.x*2),top:Math.round(r.y*2),width:Math.round(r.width*2),height:Math.round(r.height*2)};})()");
    const png = Buffer.from((await send('Page.captureScreenshot', { format:'png' })).data, 'base64');
    const output = new URL(`../src/assets/img/room/poster-${name}.webp`, import.meta.url);
    const info = await sharp(png).extract(frame).webp({ quality:88 }).toFile(output.pathname);
    console.log(`poster-${name}: ${info.width}x${info.height} ${(info.size/1024).toFixed(0)} KB`);
  }
} finally {
  socket?.close(); chrome.kill();
  if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) await new Promise(resolve => chrome.once('exit', resolve));
  rmSync(profile, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
}
