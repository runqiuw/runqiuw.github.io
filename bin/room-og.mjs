// Render public/og.png (1200×630 link-preview image): the full-screen room overview, without
// buttons or labels. Drives headless Chrome over the DevTools protocol in real time (the
// open/close morph doesn't run under --virtual-time-budget). Needs the preview server on :4321.
// Usage: node bin/room-og.mjs   (bin/room-posters runs it too)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE = process.env.URL ?? 'http://localhost:4321';
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = new URL('../public/og.png', import.meta.url);
const PORT = 9335;
const profile = mkdtempSync(join(tmpdir(), 'room-og-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1200,630', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    await sleep(200);
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch {}
  }
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${SITE}/` });
  await sleep(1200);
  await evaluate(`localStorage.setItem('theme', 'light'); location.reload(); 1`);
  await sleep(800);
  await evaluate(`(async () => {
    for (let i = 0; i < 150 && !document.querySelector('.frame.live'); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 600));
    const st = document.createElement('style');
    st.textContent = '.help,.exit,.room-pins{display:none!important}';
    document.head.append(st);
    document.getElementById('room-enter').click();
    await new Promise((r) => setTimeout(r, 3000));
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('og: public/og.png 1200x630');
  ws.close();
} finally {
  chrome.kill();
  rmSync(profile, { recursive: true, force: true });
}
