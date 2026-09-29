import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.env.APP_URL || 'http://127.0.0.1:4173/';
const output = process.argv[2] || path.join(process.cwd(), 'tests', 'screenshots');
const port = 9327;
const profile = path.join(os.tmpdir(), `shunci-smoke-${process.pid}`);
await mkdir(output, { recursive: true });

const browser = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
let requestId = 0;
const pending = new Map();

async function target() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(item => item.type === 'page');
      if (page) return page;
    } catch { /* Chrome is still starting. */ }
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not start');
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.result.value;
}

async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(path.join(output, name), Buffer.from(result.result.data, 'base64'));
}

try {
  const page = await target();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const task = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message);
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: baseUrl });
  await delay(700);

  const editorMetrics = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.title})`);
  if (editorMetrics.scrollWidth > editorMetrics.width) throw new Error(`Editor overflows: ${JSON.stringify(editorMetrics)}`);
  await screenshot('editor-412x915.png');

  await evaluate(`document.querySelector('#sampleButton').click(); document.querySelector('#countdownToggle').click(); document.querySelector('#startButton').click(); true`);
  await delay(500);
  const promptMetrics = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,playing:document.querySelector('#promptScreen').dataset.playing})`);
  if (promptMetrics.scrollWidth > promptMetrics.width || promptMetrics.playing !== 'true') throw new Error(`Prompt smoke failed: ${JSON.stringify(promptMetrics)}`);
  const seekMetrics = await evaluate(`(() => {
    const slider = document.querySelector('#progressSlider');
    const zone = document.querySelector('#readingZone');
    slider.dispatchEvent(new PointerEvent('pointerdown', {pointerId:7,isPrimary:true,bubbles:true}));
    slider.value = '700';
    slider.dispatchEvent(new Event('input', {bubbles:true}));
    slider.dispatchEvent(new PointerEvent('pointerup', {pointerId:7,isPrimary:true,bubbles:true}));
    const afterSlider = Number(slider.value);
    zone.dispatchEvent(new PointerEvent('pointerdown', {pointerId:8,isPrimary:true,clientY:180,bubbles:true}));
    zone.dispatchEvent(new PointerEvent('pointermove', {pointerId:8,isPrimary:true,clientY:330,bubbles:true,cancelable:true}));
    zone.dispatchEvent(new PointerEvent('pointerup', {pointerId:8,isPrimary:true,clientY:330,bubbles:true}));
    return {afterSlider, afterDrag:Number(slider.value), playing:document.querySelector('#promptScreen').dataset.playing};
  })()`);
  if (seekMetrics.afterSlider !== 700 || seekMetrics.afterDrag >= seekMetrics.afterSlider || seekMetrics.playing !== 'true') throw new Error(`Seek controls failed: ${JSON.stringify(seekMetrics)}`);
  await screenshot('prompt-412x915.png');

  await evaluate(`document.querySelector('#backButton').click(); true`);
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
  await delay(250);
  const compactMetrics = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`);
  if (compactMetrics.scrollWidth > compactMetrics.width) throw new Error(`Compact editor overflows: ${JSON.stringify(compactMetrics)}`);
  await screenshot('editor-360x800.png');

  await send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await evaluate(`document.querySelector('#landscapeToggle').click(); document.querySelector('#startButton').click(); true`);
  await delay(450);
  await evaluate(`document.querySelector('#toast').classList.remove('visible'); true`);
  await delay(300);
  const landscapeMetrics = await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,playing:document.querySelector('#promptScreen').dataset.playing,landscape:matchMedia('(orientation: landscape)').matches})`);
  if (landscapeMetrics.scrollWidth > landscapeMetrics.width || !landscapeMetrics.landscape || landscapeMetrics.playing !== 'true') throw new Error(`Landscape mode failed: ${JSON.stringify(landscapeMetrics)}`);
  await screenshot('prompt-915x412.png');
  await evaluate(`document.querySelector('#backButton').click(); true`);
  await delay(200);

  const serviceWorker = await evaluate(`(async () => { const registration = await navigator.serviceWorker.ready; await new Promise(resolve => setTimeout(resolve, 200)); return { active: registration.active?.state, controlled: Boolean(navigator.serviceWorker.controller) }; })()`);
  if (serviceWorker.active !== 'activated' || !serviceWorker.controlled) throw new Error(`Service worker not ready: ${JSON.stringify(serviceWorker)}`);
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.reload');
  await delay(500);
  const offline = await evaluate(`({title:document.title,textLength:document.querySelector('#scriptInput')?.value.length || 0})`);
  if (offline.title !== '顺词 · 手机提词器' || offline.textLength < 10) throw new Error(`Offline reload failed: ${JSON.stringify(offline)}`);
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log(JSON.stringify({ editorMetrics, promptMetrics, seekMetrics, compactMetrics, landscapeMetrics, serviceWorker, offline, screenshots: output }, null, 2));
} finally {
  socket?.close();
  browser.kill();
  await delay(150);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
