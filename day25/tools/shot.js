// Headless Chrome test via the DevTools protocol (no dependencies, Node >= 22).
// Usage: node tools/shot.js out.png [waitSeconds] [js to eval before the shot] [width] [height]
// Prints the page console and errors, then saves a screenshot.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const out = process.argv[2] || 'shot.png';
const wait = parseFloat(process.argv[3] || '20');
let evalJs = process.argv[4] || '';
if (evalJs.startsWith('@')) evalJs = fs.readFileSync(evalJs.slice(1), 'utf8');
const width = parseInt(process.argv[5] || '1280'), height = parseInt(process.argv[6] || '720');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.env.SHOT_URL || ('file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/'));
const port = 9333 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'chr'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--window-size=' + width + ',' + height,
  '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', 'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let ws;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
      const page = list.find(p => p.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { }
    await sleep(200);
  }
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  const send = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const seen = new Set();
  const log = (...a) => { const k = a.join(' '); if (seen.has(k) || seen.size > 60) return; seen.add(k); console.log(k); };
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d.result || d.error); delete pend[d.id]; }
    if (d.method === 'Runtime.consoleAPICalled') log('[console.' + d.params.type + ']', d.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ').slice(0, 2000));
    if (d.method === 'Runtime.exceptionThrown') log('[exception]', JSON.stringify(d.params.exceptionDetails).slice(0, 2000));
    if (d.method === 'Log.entryAdded') log('[log]', d.params.entry.text.slice(0, 500));
  };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  // SHOT_MOBILE=1 emulates a phone or tablet: mobile viewport and touch events.
  const mobile = !!process.env.SHOT_MOBILE;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url });
  const t0 = Date.now();
  await sleep(wait * 1000);
  if (evalJs) { const r = await send('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true }); console.log('[eval]', JSON.stringify(r).slice(0, 3000)); await sleep(1500); }
  console.log('[info] after', (Date.now() - t0) / 1000, 's');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  ws.close(); proc.kill();
  process.exit(0);
})().catch(e => { console.error(e); proc.kill(); process.exit(1); });
