// Browser regression check for room video playback, idle rendering and the hoops close-up.
// First build and start astro preview; URL defaults to http://localhost:4321.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const site = process.env.URL ?? 'http://localhost:4321';
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'check-room-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1440,900',
  '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];
chrome.on('error', (err) => errors.push(err.message));
let socket;

try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    if (errors.length) throw new Error(errors.join('\n'));
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {}
    if (!port) await sleep(100);
  }
  assert(port, 'Chrome did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      const text = message.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (/WebGLProgram|Shader Error/i.test(text)) errors.push(text);
    }
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const send = async (method, params = {}) => {
    const messageId = ++id;
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(`${method} timed out`)); }, 30000);
      pending.set(messageId, (result) => { clearTimeout(timer); resolve(result); });
    });
    socket.send(JSON.stringify({ id: messageId, method, params }));
    const result = await reply;
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result.result;
  };
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await evaluate(expression)) return;
      await sleep(100);
    }
    throw new Error(`Timed out: ${label}`);
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.setItem('theme', 'light');
    window.__roomCheck = { clears: 0, videos: [] };
    const create = document.createElement.bind(document);
    document.createElement = function(name, ...args) {
      const element = create(name, ...args);
      if (name.toLowerCase() === 'video') window.__roomCheck.videos.push(element);
      return element;
    };
    const clear = WebGL2RenderingContext.prototype.clear;
    WebGL2RenderingContext.prototype.clear = function(...args) {
      // Count frames, not shadow-map passes: only clears of the canvas itself (no framebuffer bound).
      if (this.canvas.classList.contains('room-canvas') && !this.getParameter(this.FRAMEBUFFER_BINDING)) window.__roomCheck.clears++;
      return clear.apply(this, args);
    };
    ${process.env.VIDEO_FALLBACK ? "delete HTMLVideoElement.prototype.requestVideoFrameCallback; delete HTMLVideoElement.prototype.cancelVideoFrameCallback;" : ''}
  ` });
  await send('Page.navigate', { url: site });
  await until("document.querySelector('.frame.live')", 'live room', 30000);
  await sleep(3000);

  const measure = async (label, idle = false) => {
    if (idle) await settle();
    await evaluate('window.__roomCheck.clears = 0');
    await sleep(2000);
    const clears = await evaluate('window.__roomCheck.clears');
    console.log(`${label}: ${clears} room frames / 2 s`);
    // Idle still allows the nixie clock's once-a-second tick.
    assert(idle ? clears <= 3 : clears > 0, `${label}: unexpected redraw count ${clears}`);
  };
  const paused = () => until('window.__roomCheck.videos.every(v => v.paused)', 'paused room videos');
  const playing = () => until('window.__roomCheck.videos.some(v => !v.paused && v.readyState >= 2)', 'playing panel video');
  const settle = async () => {
    // Software rendering may take much longer than two seconds to finish the room's initial
    // 120-frame warmup. Wait for genuine idle (at most the clock's 1 Hz tick), but fail if redraws never stop.
    let quiet = 0;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await evaluate('window.__roomCheck.clears = 0');
      await sleep(1000);
      quiet = (await evaluate('window.__roomCheck.clears')) <= 1 ? quiet + 1 : 0;
      if (quiet === 2) return;
    }
    throw new Error('Room did not settle within 45 s');
  };
  const pickClip = async (section) => {
    await evaluate(`(() => {
      const item = document.querySelector('#${section} [data-screen-video]');
      if (!item) throw new Error('No clip in ${section}');
      item.scrollIntoView({ behavior: 'instant', block: 'center' });
    })()`);
    await sleep(500);
    await evaluate(`(() => {
      const item = document.querySelector('#${section} [data-screen-video]');
      document.documentElement.dataset.section = '${section}';
      document.documentElement.dataset.item = item.dataset.item;
      dispatchEvent(new CustomEvent('sectionchange', { detail: '${section}' }));
      dispatchEvent(new CustomEvent('itemchange', { detail: item.dataset.item }));
    })()`);
    await playing();
    await sleep(2000);
  };
  const clipAdvanced = async (label) => {
    const before = await evaluate('window.__roomCheck.videos.filter(v => !v.paused).map(v => [v.currentTime, v.getVideoPlaybackQuality().totalVideoFrames])');
    await measure(label);
    const after = await evaluate('window.__roomCheck.videos.filter(v => !v.paused).map(v => [v.currentTime, v.getVideoPlaybackQuality().totalVideoFrames])');
    assert(after.some((value, i) => value[0] !== before[i]?.[0] && value[1] > before[i]?.[1]), `${label}: clip did not advance`);
  };
  const openRoom = async () => {
    await evaluate("document.getElementById('room-enter').click()");
    await until("location.hash === '#room' && document.querySelector('.room.full')", 'full room');
    await paused();
    await sleep(2000);
  };
  const closeup = async (id, button) => {
    await evaluate(`document.querySelector('[data-go="${button}"]').click()`);
    await until(`location.hash === '#room/${id}' && !document.querySelector('.closeup').hidden`, `${id} close-up`);
    await paused();
    await sleep(3000);
  };
  const back = async () => {
    await evaluate("document.querySelector('[data-closeup=back]').click()");
    await until("location.hash === '#room' && !document.getElementById('room-exit').hidden", 'back to room');
    await sleep(1000);
  };
  const exit = async () => {
    await evaluate("document.getElementById('room-exit').click()");
    await until("!document.querySelector('.room.full')", 'back to page');
    await playing();
    await sleep(1500);
  };

  // Reloading a room/close-up keeps the browser's old state, while the panel starts on the page.
  // A fresh room visit must close to that page, never pop into and reopen the stale close-up.
  for (const stale of [{ room: 1 }, { room: 2, closeup: 'hoops' }]) {
    await evaluate(`window.__historyReloadPending = true; history.replaceState(${JSON.stringify(stale)}, '', '#room${stale.closeup ? '/hoops' : ''}'); location.reload()`);
    await until("!window.__historyReloadPending && document.querySelector('.frame.live')", 'room after stale history reload', 60000);
    await openRoom();
    for (const section of ['research', 'projects', 'games']) {
      await evaluate(`document.querySelector('[data-go="${section}"]').click()`);
      await until("!document.querySelector('.room.full') && !history.state?.room", `${section} returns to page`);
      await sleep(1500);
      assert.equal(await evaluate("!!document.querySelector('.room.full') || location.hash.startsWith('#room')"), false, `${section} reopened stale room history`);
      if (section !== 'games') await openRoom();
    }
  }
  console.log('PASS: section picks after reloading stale room/hoops history');

  await pickClip('research');
  await clipAdvanced('Research panel');
  await openRoom();
  await measure('Full room with research clip selected', true);
  // A new item event while the page is covered must not restart a video.
  await evaluate("dispatchEvent(new CustomEvent('itemchange', { detail: document.documentElement.dataset.item }))");
  await paused();
  await measure('Full room after item update', true);
  await closeup('board', 'playground');
  await measure('Board close-up', true);
  await back();
  await closeup('hoops', 'hoops');
  await until("document.querySelector('.hoops-turn')?.dataset.phase === 'ready'", 'automatic hoops turn');
  assert.equal(await evaluate("[...document.querySelectorAll('.closeup button')].filter(b => !b.hidden).length"), 1, 'Manual projectile buttons remain');
  await measure('Hoops close-up before a throw', true);
  const projectiles = process.env.VIDEO_FALLBACK ? [] : ['Paper ball', 'Bottle', 'Bouncy ball'];
  const distances = [];
  for (const [i, label] of projectiles.entries()) {
    await until("document.querySelector('.hoops-turn')?.dataset.phase === 'ready'", 'next automatic turn');
    const turn = await evaluate("({ ...document.querySelector('.hoops-turn').dataset })");
    assert.equal(turn.kind, ['paper', 'bottle', 'bouncy'][i]);
    assert.equal(turn.points, Number(turn.distance) > 1.32 ? '3' : '2');
    assert(Number(turn.distance) >= 0.58 && Number(turn.distance) <= 3.6);
    distances.push(turn.distance);
    if (process.env.ROOM_SCREENSHOTS) {
      mkdirSync(process.env.ROOM_SCREENSHOTS, { recursive: true });
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.ROOM_SCREENSHOTS, `hoops-${turn.kind}-${turn.points}pt.png`), Buffer.from(shot.data, 'base64'));
    }
    const rect = await evaluate("(() => { const r = document.querySelector('.room-canvas').getBoundingClientRect(); return { x: r.x + r.width * 0.5, y: r.y + r.height * 0.62, span: Math.min(r.width,r.height) }; })()");
    const pull = rect.span * 0.22 * 0.55;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y + pull, button: 'left', buttons: 1 });
    assert.equal(await evaluate("document.querySelector('.hoops-power').hidden"), false);
    if (process.env.ROOM_SCREENSHOTS) {
      await sleep(300);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(process.env.ROOM_SCREENSHOTS, `guide-${turn.kind}.png`), Buffer.from(shot.data, 'base64'));
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y + pull, button: 'left', buttons: 0, clickCount: 1 });
    assert.equal(await evaluate("document.querySelector('.hoops-power').hidden"), true);
    assert.equal(await evaluate("document.querySelector('.hoops-turn').dataset.phase"), 'flight');
    await measure(`${label} in flight`);
    await until("document.querySelector('.hoops-turn').dataset.phase === 'ready'", 'contact, result and next angle', 20000);
    await sleep(11000);
    await measure(`${label} settled`, true);
  }
  if (projectiles.length) {
    assert.equal(await evaluate("document.querySelector('.hoops-score').dataset.attempts"), '3');
    assert.equal(new Set(distances).size, 3, 'Shot distances did not vary');
  }
  await back();
  await exit();
  await clipAdvanced('Research panel resumed');
  await pickClip('games');
  await clipAdvanced('Game panel');
  await openRoom();
  await measure('Full room with game clip selected', true);
  await exit();
  await clipAdvanced('Game panel resumed');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`PASS: panel playback, paused full/close-up views${projectiles.length ? ', three hoops projectiles' : ''}${process.env.VIDEO_FALLBACK ? ', 30 fps fallback' : ', video-frame callbacks'}`);
} finally {
  socket?.close();
  chrome.kill();
  if (chrome.pid && chrome.exitCode === null && chrome.signalCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
