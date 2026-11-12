// Mandelbrötchen - main thread.
//
// The view center is an arbitrary-precision fixed-point number (BigInt), so it
// never runs out of digits. Rendering uses perturbation theory: one reference
// orbit is computed at full precision (see worker.js) and every pixel is iterated
// in plain doubles as a small delta from that orbit.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  // Order must match the formula ids used in worker.js.
  // mview / jview: default [centerRe, centerIm, span] of the two planes.
  const FORMULAS = [
    { id: 'mandelbrot', name: 'Mandelbrot  z² + c', mview: [-0.6, 0, 3.2], jview: [0, 0, 3.4], seed: ['-0.8', '0.156'] },
    { id: 'cubic', name: 'Cubic  z³ + c', mview: [0, 0, 3.0], jview: [0, 0, 3.0], seed: ['0.4', '0.1'] },
    { id: 'ship', name: 'Burning Ship', mview: [-0.45, 0.45, 3.6], jview: [0, 0, 3.6], seed: ['-1.3', '0.03'] },
    { id: 'tricorn', name: 'Tricorn  conj(z)² + c', mview: [-0.2, 0, 4.2], jview: [0, 0, 3.6], seed: ['-0.4', '0.6'] },
    { id: 'celtic', name: 'Celtic  |Re z²| + i Im z² + c', mview: [-0.84, 0, 3.5], jview: [0, 0, 3.0], seed: ['-0.1', '0.42'] },
    { id: 'buffalo', name: 'Buffalo  |Re z²| − i |Im z²| + c', mview: [-0.5, 0.6, 2.7], jview: [0, 0, 3.0], seed: ['0.3', '0.26'] },
    { id: 'multibrot', name: 'Multibrot  zⁿ + c', mview: [-0.1, 0, 2.7], jview: [0, 0, 2.3], seed: ['0.6', '0.46'], power: true },
    { id: 'lambda', name: 'Lambda  c·z(1 − z)', mview: [1, 0, 3.9], jview: [0.5, 0, 2.5], seed: ['0.68', '0.74'] },
  ];
  const POWERS = [4, 5, 6, 7, 8];   // Multibrot exponents (z³ is the Cubic entry)

  const JULIA_PRESETS = [
    ['Seahorses', '-0.8', '0.156'],
    ['Douady rabbit', '-0.123', '0.745'],
    ['Dendrite', '0', '1'],
    ['San Marco', '-0.75', '0'],
    ['Spirals', '-0.4', '0.6'],
    ['Galaxies', '0.285', '0.01'],
    ['Lightning', '-0.70176', '-0.3842'],
    ['Dragon', '-0.835', '-0.2321'],
    ['Siegel disk', '-0.391', '-0.587'],
    ['Feathers', '-0.7269', '0.1889'],
  ];

  // Cyclic color stops; the last stop blends back into the first. Each palette
  // rises from a dark tone to a light one and falls back, which gives soft bands.
  // The first one is the default.
  const PALETTES = [
    { id: 'aurora', name: 'Aurora', stops: ['020b1a', '0b3d5c', '00a6a6', '7cf5c9', 'eafff7', 'b49cff', '5b2a86', '1a0b2e'] },
    { id: 'fire', name: 'Fire', stops: ['100000', '7a0000', 'ff3300', 'ffbb00', 'ffffcc', 'ff8800', '500000'] },
    { id: 'ocean', name: 'Ocean', stops: ['001233', '0353a4', '00b4d8', 'caf0f8', '48cae4', '023e8a'] },
    { id: 'synthwave', name: 'Synthwave', stops: ['0d0221', '2b0f54', '7b2cbf', 'ff4fa3', 'ffb38a', 'fff1c9', 'ff6ec7', '3c096c'] },
    { id: 'magma', name: 'Magma', stops: ['000004', '3b0f70', '8c2981', 'de4968', 'fe9f6d', 'fcfdbf', 'fe9f6d', 'b73779', '3b0f70'] },
    { id: 'gold', name: 'Noir & Gold', stops: ['050505', '2a1f0e', '8a6420', 'd9a93f', 'fff3d1', 'e0b45a', '5c4214', '120d06'] },
    { id: 'pearl', name: 'Pearl', stops: ['12101f', '3d3566', '8f86c9', 'e6d9f2', 'fff8f0', 'a8e0d8', '4a8a99', '1c2f40'] },
  ];

  const MIN_SCALE = 1e-250;     // deltas are doubles: stay clear of the subnormal range
  const MAX_SPAN = 16;          // widest view, in complex-plane units
  const MAX_CENTER = 8;
  const MAX_ITER = 2000000;
  const TILE = 64;
  const PASSES = [4, 1];        // coarse preview first, then full resolution
  const LUT_N = 2048;
  const BG = '#05050a';
  const INTERIOR = 0xff000000;

  // ---------------------------------------------------------------------------
  // Fixed-point helpers (BigInt with P fractional bits)
  // ---------------------------------------------------------------------------

  function numToFixed(v, P) {
    if (!v || !isFinite(v)) return 0n;
    const e = Math.floor(Math.log2(Math.abs(v)));
    const mant = BigInt(Math.round(v * 2 ** -e * 4503599627370496)); // * 2^52
    const sh = P + e - 52;
    return sh >= 0 ? mant << BigInt(sh) : mant >> BigInt(-sh);
  }

  // Keeps full relative precision even for values far too small for Number(x) / 2^P.
  function fixedToNum(x, P) {
    if (x === 0n) return 0;
    const neg = x < 0n;
    if (neg) x = -x;
    const bits = x.toString(16).length * 4;
    const sh = bits > 60 ? bits - 60 : 0;
    let v = Number(x >> BigInt(sh));
    let e = sh - P;
    while (e < -1000) { v *= 2 ** -1000; e += 1000; }
    v *= 2 ** e;
    return neg ? -v : v;
  }

  function reprec(x, from, to) {
    return to >= from ? x << BigInt(to - from) : x >> BigInt(from - to);
  }

  function parseDecimal(str, P) {
    const m = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/.exec(String(str).trim());
    if (!m || !(m[2] + m[3])) return null;
    const exp = (m[4] ? parseInt(m[4], 10) : 0) - m[3].length;
    if (Math.abs(exp) > 5000) return null;
    let v = BigInt(m[2] + m[3]) << BigInt(P);
    v = exp >= 0 ? v * 10n ** BigInt(exp) : v / 10n ** BigInt(-exp);
    return m[1] === '-' ? -v : v;
  }

  function fmtFixed(x, P, digits) {
    const neg = x < 0n;
    if (neg) x = -x;
    const s = ((x * 10n ** BigInt(digits) + (1n << BigInt(P - 1))) >> BigInt(P))
      .toString().padStart(digits + 1, '0');
    return (neg ? '-' : '') + s.slice(0, s.length - digits) + '.' + s.slice(s.length - digits);
  }

  // Bits needed to hold a decimal string of this length, rounded up to 64.
  const bitsForDecimal = (str) => Math.ceil((Math.ceil(str.length * 3.33) + 96) / 64) * 64;
  const digitsFor = (scale) => Math.max(6, Math.ceil(-Math.log10(scale)) + 3);

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const canvas = $('view');
  const ctx = canvas.getContext('2d', { alpha: false });

  const state = {
    formula: 0, julia: false, power: 4,
    autoIter: true, maxIter: 400,
    palette: 0, density: 0, cycle: false,
    relief: false, light: 45,      // 3D relief and light direction (degrees, 0 = from the right)
    quality: '1',
  };

  let W = 0, H = 0;
  let views = null;           // { m: view, j: view }; view = { re, im, p, scale }
  let view = null;            // the active one
  let jc = null;              // Julia seed { re, im, p, digits }
  let jcVersion = 0;

  let back = null, backCtx = null;   // last rendered image
  let img = null;                    // view that `back` was rendered for
  let imgData = null, data32 = null; // pixels of `back`
  let iters = null;                  // sqrt(smooth iterations) per pixel; -1 inside, NaN unknown
  let normals = null;                // relief: unit normal per pixel (x, y interleaved); NaN = none

  let lut = new Uint32Array(LUT_N);
  const lutR = new Uint8Array(LUT_N), lutG = new Uint8Array(LUT_N), lutB = new Uint8Array(LUT_N);
  let colorOffset = 0;

  let jobId = 0, job = null, queue = [], qpos = 0, renderTimer = 0;
  let renderDone = false;            // the image on screen is complete for the current view
  let ref = null, refSeq = 0;        // metadata of the reference orbit held by the workers
  let lastHash = '';
  let pickArmed = false;

  // ---------------------------------------------------------------------------
  // Workers
  // ---------------------------------------------------------------------------

  const workerUrl = URL.createObjectURL(
    new Blob(['(' + fractalWorkerMain.toString() + ')();'], { type: 'text/javascript' }));

  const pool = [];
  const poolSize = Math.max(1, Math.min(16, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < poolSize; i++) {
    const slot = { w: new Worker(workerUrl), busy: false };
    slot.w.onmessage = (e) => onTile(slot, e.data);
    slot.w.onerror = (e) => setStatus('Worker error: ' + e.message, 0);
    pool.push(slot);
  }

  // The reference orbit gets its own worker, so a superseded request can be
  // dropped by simply terminating it.
  let orbitWorker = null, orbitBusy = false;

  function requestOrbit(id) {
    if (orbitBusy && orbitWorker) { orbitWorker.terminate(); orbitWorker = null; }
    if (!orbitWorker) {
      orbitWorker = new Worker(workerUrl);
      orbitWorker.onmessage = (e) => onOrbit(e.data);
      orbitWorker.onerror = (e) => setStatus('Worker error: ' + e.message, 0);
    }
    const P = state.julia ? Math.max(view.p, jc.p) : view.p;
    const cre = reprec(view.re, view.p, P), cim = reprec(view.im, view.p, P);
    pendingRef = {
      formula: state.formula, power: state.power, julia: state.julia, jcVersion,
      P, re: cre, im: cim, maxIter: state.maxIter,
    };
    orbitBusy = true;
    setStatus('Reference orbit…', 0);
    orbitWorker.postMessage({
      type: 'orbit', reqId: id, formula: state.formula, power: state.power, julia: state.julia, P,
      maxIter: state.maxIter,
      zre: cre, zim: cim,
      cre: state.julia ? reprec(jc.re, jc.p, P) : cre,
      cim: state.julia ? reprec(jc.im, jc.p, P) : cim,
    });
  }
  let pendingRef = null;

  function onOrbit(m) {
    if (m.reqId !== jobId) {          // superseded
      if (m.type === 'orbit') orbitBusy = false;
      return;
    }
    if (m.type === 'orbitProgress') {
      setStatus('Reference orbit… ' + Math.round(m.frac * 100) + '%', m.frac * 0.1);
      return;
    }
    orbitBusy = false;
    ref = Object.assign(pendingRef, { id: ++refSeq, aEsc: m.aEsc, bEsc: m.bEsc, len: m.alen });
    for (const slot of pool) {
      slot.w.postMessage({
        type: 'ref', id: ref.id,
        ax: m.ax, ay: m.ay, alen: m.alen, bx: m.bx, by: m.by, blen: m.blen,
        cx: m.cx, cy: m.cy, power: m.power,
      });
    }
    beginTiles(m.reqId);
  }

  // ---------------------------------------------------------------------------
  // Render pipeline
  // ---------------------------------------------------------------------------

  function magnification() { return 4 / (view.scale * Math.min(W, H)); }

  function autoIterations() {
    const decades = Math.max(0, Math.ceil(Math.log10(magnification()) - 1e-9));
    return Math.min(MAX_ITER, Math.round(400 + 100 * Math.pow(decades, 1.5)));
  }

  // Grow the fixed-point precision of a view so that it resolves `scale`.
  function ensurePrecision(v, scale) {
    const need = Math.ceil((Math.ceil(-Math.log2(scale)) + 64) / 64) * 64;
    if (need > v.p) {
      v.re = reprec(v.re, v.p, need);
      v.im = reprec(v.im, v.p, need);
      v.p = need;
    }
  }

  // Offset (as doubles) of the view center from the reference point.
  function refOffset() {
    const P = Math.max(view.p, ref.P);
    return [
      fixedToNum(reprec(view.re, view.p, P) - reprec(ref.re, ref.P, P), P),
      fixedToNum(reprec(view.im, view.p, P) - reprec(ref.im, ref.P, P), P),
    ];
  }

  // The reference orbit does not have to sit at the view center: it stays usable
  // while panning nearby, as long as it is precise and long enough.
  function refValid() {
    if (!ref || ref.formula !== state.formula || ref.julia !== state.julia) return false;
    if (ref.power !== state.power) return false;
    if (ref.julia && ref.jcVersion !== jcVersion) return false;
    if (ref.P < Math.ceil(-Math.log2(view.scale)) + 32) return false;
    if (ref.maxIter < state.maxIter && !(ref.aEsc && ref.bEsc)) return false;
    const [ox, oy] = refOffset();
    return Math.hypot(ox, oy) <= 3 * view.scale * Math.max(W, H);
  }

  // Every view change goes through here: show a stretched preview of the last
  // image right away and start the real render once the input settles.
  function requestRender(delay = 120) {
    renderDone = false;
    jobId++;
    job = null;
    queue = [];
    qpos = 0;
    clearTimeout(renderTimer);
    renderTimer = setTimeout(startRender, delay);
    updateHud();
    invalidate();
  }

  function startRender() {
    ensurePrecision(view, view.scale);
    if (state.autoIter) state.maxIter = autoIterations();
    updateHud();
    if (refValid()) beginTiles(jobId);
    else requestOrbit(jobId);
  }

  function beginTiles(id) {
    if (id !== jobId) return;

    // Bake the current preview into the back buffer: it becomes the placeholder
    // that the new tiles progressively replace.
    draw();
    if (img) backCtx.drawImage(canvas, 0, 0);
    else { backCtx.fillStyle = BG; backCtx.fillRect(0, 0, W, H); }
    img = { re: view.re, im: view.im, p: view.p, scale: view.scale };
    imgData = backCtx.getImageData(0, 0, W, H);
    data32 = new Uint32Array(imgData.data.buffer);
    iters.fill(NaN);
    normals.fill(NaN);

    const [offx, offy] = refOffset();
    const params = {
      type: 'tile', jobId: id, refId: ref.id, W, H, scale: view.scale, offx, offy,
      maxIter: state.maxIter, formula: state.formula, julia: state.julia, relief: state.relief,
      // Largest |dc| of any pixel (the BLA tables depend on it). Rounded up to a
      // power of two so that the workers do not rebuild them at every small move.
      cmax: state.julia ? 0
        : 2 ** Math.ceil(Math.log2(Math.hypot(offx, offy) + view.scale * Math.hypot(W, H) / 2)),
    };

    // Tiles ordered from the center outwards.
    const tiles = [];
    for (let y = 0; y < H; y += TILE) {
      for (let x = 0; x < W; x += TILE) {
        const w = Math.min(TILE, W - x), h = Math.min(TILE, H - y);
        tiles.push({ x0: x, y0: y, w, h, d: Math.hypot(x + w / 2 - W / 2, y + h / 2 - H / 2) });
      }
    }
    tiles.sort((a, b) => a.d - b.d);
    queue = [];
    qpos = 0;
    for (const step of PASSES) {
      for (const t of tiles) queue.push(Object.assign({ step }, params, t));
    }
    job = { id, total: queue.length, done: 0, t0: performance.now() };
    setStatus('Rendering…', 0.1);
    pump();
  }

  function pump() {
    for (const slot of pool) {
      if (qpos >= queue.length) return;
      if (slot.busy) continue;
      slot.busy = true;
      slot.w.postMessage(queue[qpos++]);
    }
  }

  function onTile(slot, m) {
    slot.busy = false;
    if (job && m.jobId === job.id) {
      paintTile(m);
      job.done++;
      if (job.done === job.total) {
        const secs = (performance.now() - job.t0) / 1000;
        setStatus('Rendered in ' + secs.toFixed(secs < 10 ? 2 : 1) + ' s', 1);
        job = null;
        renderDone = true;
        if (auto.on) auto.readyAt = performance.now() + AUTO_DWELL_MS;
        writeHash();
      } else {
        const frac = job.done / job.total;
        setStatus('Rendering… ' + Math.round(frac * 100) + '%', 0.1 + 0.9 * frac);
      }
    }
    pump();
  }

  // ---------------------------------------------------------------------------
  // Coloring and drawing
  // ---------------------------------------------------------------------------

  function buildLut() {
    const stops = PALETTES[state.palette].stops.map((h) => {
      const n = parseInt(h, 16);
      return [n >> 16, (n >> 8) & 255, n & 255];
    });
    for (let i = 0; i < LUT_N; i++) {
      const t = (i / LUT_N) * stops.length;
      const k = Math.floor(t), f = t - k;
      const a = stops[k % stops.length], b = stops[(k + 1) % stops.length];
      const r = a[0] + (b[0] - a[0]) * f;
      const g = a[1] + (b[1] - a[1]) * f;
      const bl = a[2] + (b[2] - a[2]) * f;
      lut[i] = (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;
      lutR[i] = r; lutG[i] = g; lutB[i] = bl;
    }
    document.documentElement.style.setProperty('--pal-grad', paletteGradient(stops));
  }

  // CSS gradient for the UI (title, progress bar) in the tones of the palette.
  // Dark stops would vanish on the dark panel, so only the bright ones are used.
  function paletteGradient(stops) {
    const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
    let cols = stops.filter((c) => luma(c) >= 80);
    if (cols.length < 2) {
      // Too few bright stops: lift every stop towards white instead.
      cols = stops.map((c) => {
        const t = Math.max(0, (120 - luma(c)) / (255 - luma(c)));
        return c.map((v) => Math.round(v + (255 - v) * t));
      });
    }
    return 'linear-gradient(90deg, ' + cols.map((c) => 'rgb(' + c.join(',') + ')').join(', ') + ')';
  }

  const densityFactor = () => 0.22 * Math.pow(2, state.density) * LUT_N;

  // Relief lighting (Lambert + a soft specular highlight). The normal tilts the
  // surface; RELIEF_HEIGHT sets how steep it looks (higher = flatter).
  const RELIEF_HEIGHT = 1.2;
  let lightX = 0, lightY = 0;
  function updateLight() {
    // Screen y grows downwards, the normals use the imaginary axis (upwards).
    lightX = Math.cos(state.light * Math.PI / 180);
    lightY = Math.sin(state.light * Math.PI / 180);
  }

  // Color of pixel p from iters / normals into data32.
  function colorPixel(p, k, off) {
    const v = iters[p];
    if (v !== v) return;
    if (v < 0) { data32[p] = INTERIOR; return; }
    const i = (v * k + off) & (LUT_N - 1);
    const nx = state.relief ? normals[2 * p] : NaN;
    if (nx !== nx) { data32[p] = lut[i]; return; }
    let t = (nx * lightX + normals[2 * p + 1] * lightY + RELIEF_HEIGHT) / (1 + RELIEF_HEIGHT);
    if (t < 0) t = 0;
    const dif = 0.22 + 0.88 * t;
    const t2 = t * t, t4 = t2 * t2, t8 = t4 * t4, t16 = t8 * t8;
    const spec = 70 * t16 * t16;   // small, soft highlight
    let r = lutR[i] * dif + spec, g = lutG[i] * dif + spec, b = lutB[i] * dif + spec;
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    data32[p] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
  }

  function paintTile(m) {
    const { x0, y0, w, h, step, cols, out, nrm } = m;
    const k = densityFactor(), off = colorOffset * LUT_N;
    for (let y = 0; y < h; y++) {
      const srcRow = Math.floor(y / step) * cols;
      let p = (y0 + y) * W + x0;
      for (let x = 0; x < w; x++, p++) {
        const s = srcRow + Math.floor(x / step);
        iters[p] = out[s];
        normals[2 * p] = nrm ? nrm[2 * s] : NaN;
        normals[2 * p + 1] = nrm ? nrm[2 * s + 1] : NaN;
        colorPixel(p, k, off);
      }
    }
    backCtx.putImageData(imgData, 0, 0, x0, y0, w, h);
    invalidate();
  }

  // Recolor everything already computed (palette change, color cycling, light).
  function recolorAll() {
    if (!imgData || !img) return;
    const k = densityFactor(), off = colorOffset * LUT_N;
    for (let p = 0, n = iters.length; p < n; p++) colorPixel(p, k, off);
    backCtx.putImageData(imgData, 0, 0);
    invalidate();
  }

  // Draw the back buffer, transformed from the view it was rendered for to the
  // current one. This is what makes zooming and panning feel immediate.
  function draw() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (!img) return;
    const P = Math.max(img.p, view.p);
    const ox = fixedToNum(reprec(img.re, img.p, P) - reprec(view.re, view.p, P), P) / view.scale;
    const oy = fixedToNum(reprec(img.im, img.p, P) - reprec(view.im, view.p, P), P) / view.scale;
    const r = img.scale / view.scale;
    const x = W / 2 + ox - (W / 2) * r, y = H / 2 - oy - (H / 2) * r;
    if (!isFinite(x) || !isFinite(y) || r > 1e5 || r < 1e-5) return;
    if (r === 1) {
      ctx.drawImage(back, Math.round(x), Math.round(y));
    } else {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(back, x, y, W * r, H * r);
    }
  }

  let drawPending = false;
  function invalidate() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => { drawPending = false; draw(); });
  }

  // Color cycling animation.
  let animRunning = false, lastTick = 0;
  function startAnim() {
    if (animRunning) return;
    animRunning = true;
    lastTick = performance.now();
    requestAnimationFrame(animTick);
  }
  function animTick(t) {
    if (!state.cycle) { animRunning = false; return; }
    colorOffset = (colorOffset + Math.min(100, t - lastTick) * 0.00015) % 1;
    lastTick = t;
    recolorAll();
    requestAnimationFrame(animTick);
  }

  // ---------------------------------------------------------------------------
  // View handling
  // ---------------------------------------------------------------------------

  const qualityFactor = () =>
    state.quality === 'dpr' ? (window.devicePixelRatio || 1) : parseFloat(state.quality);

  function resize() {
    const q = qualityFactor();
    const w = Math.max(16, Math.round(canvas.clientWidth * q));
    const h = Math.max(16, Math.round(canvas.clientHeight * q));
    if (w === W && h === H) return false;
    const nb = document.createElement('canvas');
    nb.width = w;
    nb.height = h;
    const nctx = nb.getContext('2d', { willReadFrequently: true, alpha: false });
    nctx.fillStyle = BG;
    nctx.fillRect(0, 0, w, h);
    // Keep the old image centered: same center and scale, so `img` stays valid.
    if (back && img && (w - W) % 2 === 0 && (h - H) % 2 === 0) {
      nctx.drawImage(back, (w - W) / 2, (h - H) / 2);
    } else {
      img = null;
    }
    back = nb;
    backCtx = nctx;
    W = canvas.width = w;
    H = canvas.height = h;
    iters = new Float32Array(w * h).fill(NaN);
    normals = new Float32Array(2 * w * h).fill(NaN);
    imgData = null;
    return true;
  }

  function defaultView(julia) {
    const f = FORMULAS[state.formula];
    const [re, im, span] = julia ? f.jview : f.mview;
    return { re: numToFixed(re, 128), im: numToFixed(im, 128), p: 128, scale: span / Math.min(W, H) };
  }

  function clampCenter() {
    const lim = numToFixed(MAX_CENTER, view.p);
    if (view.re > lim) view.re = lim; else if (view.re < -lim) view.re = -lim;
    if (view.im > lim) view.im = lim; else if (view.im < -lim) view.im = -lim;
  }

  function panBy(dx, dy) {
    view.re -= numToFixed(dx * view.scale, view.p);
    view.im += numToFixed(dy * view.scale, view.p);
    clampCenter();
    requestRender();
  }

  // Scale the view by `factor` (< 1 zooms in) keeping the point under (x, y) fixed.
  function zoomAt(x, y, factor) {
    const maxScale = MAX_SPAN / Math.min(W, H);
    const ns = Math.min(maxScale, Math.max(MIN_SCALE, view.scale * factor));
    if (ns === view.scale) return;
    ensurePrecision(view, ns);
    view.re += numToFixed((x - W / 2) * (view.scale - ns), view.p);
    view.im -= numToFixed((y - H / 2) * (view.scale - ns), view.p);
    view.scale = ns;
    clampCenter();
    requestRender();
  }

  function pointAt(x, y) {
    return {
      re: view.re + numToFixed((x - W / 2) * view.scale, view.p),
      im: view.im - numToFixed((y - H / 2) * view.scale, view.p),
    };
  }

  function setMode(julia) {
    auto.anim = null;   // a glide in progress belongs to the old view
    state.julia = julia;
    view = julia ? views.j : views.m;
    img = null;
    setPickArmed(false);
    syncUi();
    requestRender(0);
  }

  function setFormula(index, keepSeed) {
    auto.anim = null;
    state.formula = index;
    views = { m: defaultView(false), j: defaultView(true) };
    view = state.julia ? views.j : views.m;
    if (!keepSeed) setSeed(FORMULAS[index].seed[0], FORMULAS[index].seed[1]);
    img = null;
    syncUi();
    requestRender(0);
  }

  // Set the Julia seed from decimal strings. Returns false when they do not parse.
  function setSeed(reStr, imStr) {
    const p = Math.max(128, bitsForDecimal(reStr), bitsForDecimal(imStr));
    const re = parseDecimal(reStr, p), im = parseDecimal(imStr, p);
    if (re === null || im === null) return false;
    jc = { re, im, p, reStr: String(reStr).trim(), imStr: String(imStr).trim() };
    jcVersion++;
    return true;
  }

  function pickSeed(x, y) {
    const pt = pointAt(x, y);
    const d = digitsFor(view.scale) + 2;
    jc = { re: pt.re, im: pt.im, p: view.p, reStr: fmtFixed(pt.re, view.p, d), imStr: fmtFixed(pt.im, view.p, d) };
    jcVersion++;
    views.j = defaultView(true);
    $('juliaPreset').value = '';
    setMode(true);
  }

  function setPickArmed(on) {
    pickArmed = on;
    $('pick').classList.toggle('armed', on);
    $('pick').textContent = on ? 'Click a point on the map…' : 'Pick seed on the parameter map';
    canvas.classList.toggle('picking', on);
  }

  // ---------------------------------------------------------------------------
  // HUD, UI and URL hash
  // ---------------------------------------------------------------------------

  function setStatus(text, frac) {
    $('status').textContent = text;
    $('bar').style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
  }

  function fmtZoom(v) {
    if (v < 1e5) return Number(v.toPrecision(3)) + '×';
    const [m, e] = v.toExponential(2).split('e');
    return m + 'e' + e.replace('+', '') + '×';
  }

  function updateHud() {
    const d = digitsFor(view.scale);
    $('cre').textContent = fmtFixed(view.re, view.p, d);
    $('cim').textContent = fmtFixed(view.im, view.p, d);
    $('zoom').textContent = fmtZoom(magnification()) + (view.scale <= MIN_SCALE ? ' (max)' : '');
    $('iterOut').textContent = state.maxIter.toLocaleString('en-US');
    $('bits').textContent = view.p;
    if (state.autoIter) $('iter').value = state.maxIter;
  }

  function syncUi() {
    $('formula').value = state.formula;
    $('power').value = state.power;
    $('powerRow').hidden = !FORMULAS[state.formula].power;
    $('presetRow').hidden = state.formula !== 0;   // the presets are z^2 + c seeds
    $('modeM').classList.toggle('active', !state.julia);
    $('modeJ').classList.toggle('active', state.julia);
    $('jre').value = jc.reStr;
    $('jim').value = jc.imStr;
    $('autoIter').checked = state.autoIter;
    $('iter').disabled = state.autoIter;
    $('iter').value = state.maxIter;
    $('palette').value = state.palette;
    $('density').value = state.density;
    $('cycle').checked = state.cycle;
    $('relief').checked = state.relief;
    $('light').value = state.light;
    $('light').disabled = !state.relief;
    $('quality').value = state.quality;
  }

  function writeHash() {
    const d = digitsFor(view.scale) + 3;
    const p = new URLSearchParams();
    p.set('f', FORMULAS[state.formula].id);
    if (FORMULAS[state.formula].power) p.set('pw', String(state.power));
    p.set('j', state.julia ? '1' : '0');
    p.set('re', fmtFixed(view.re, view.p, d));
    p.set('im', fmtFixed(view.im, view.p, d));
    p.set('span', (view.scale * Math.min(W, H)).toExponential(6));
    p.set('cr', jc.reStr);
    p.set('ci', jc.imStr);
    p.set('it', state.autoIter ? 'auto' : String(state.maxIter));
    p.set('pal', PALETTES[state.palette].id);
    p.set('den', String(state.density));
    if (state.relief) { p.set('rl', '1'); p.set('la', String(state.light)); }
    lastHash = '#' + p.toString();
    try { history.replaceState(null, '', lastHash); } catch (e) { /* not available: ignore */ }
  }

  // Restore a location from the URL hash. Falls back to defaults for anything invalid.
  function applyHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const fi = FORMULAS.findIndex((f) => f.id === p.get('f'));
    state.formula = fi >= 0 ? fi : 0;
    const pw = parseInt(p.get('pw'), 10);
    if (POWERS.includes(pw)) state.power = pw;
    state.julia = p.get('j') === '1';
    const pi = PALETTES.findIndex((x) => x.id === p.get('pal'));
    if (pi >= 0) state.palette = pi;
    const den = parseFloat(p.get('den'));
    if (isFinite(den)) state.density = Math.max(-3, Math.min(3, den));
    state.relief = p.get('rl') === '1';
    const la = parseFloat(p.get('la'));
    if (isFinite(la)) state.light = ((Math.round(la) % 360) + 360) % 360;
    updateLight();
    const it = parseInt(p.get('it'), 10);
    state.autoIter = !(it >= 10);
    if (!state.autoIter) state.maxIter = Math.min(MAX_ITER, it);

    views = { m: defaultView(false), j: defaultView(true) };
    view = state.julia ? views.j : views.m;
    if (!(p.has('cr') && p.has('ci') && setSeed(p.get('cr'), p.get('ci')))) {
      setSeed(FORMULAS[state.formula].seed[0], FORMULAS[state.formula].seed[1]);
    }

    const reStr = p.get('re') || '', imStr = p.get('im') || '';
    const span = parseFloat(p.get('span'));
    const bits = Math.max(128, bitsForDecimal(reStr), bitsForDecimal(imStr));
    const re = parseDecimal(reStr, bits), im = parseDecimal(imStr, bits);
    if (re !== null && im !== null && span > 0 && span <= MAX_SPAN) {
      view.re = re;
      view.im = im;
      view.p = bits;
      view.scale = Math.max(MIN_SCALE, span / Math.min(W, H));
      ensurePrecision(view, view.scale);
      clampCenter();
    }
    img = null;
    buildLut();
    syncUi();
    requestRender(0);
  }

  function initUi() {
    FORMULAS.forEach((f, i) => $('formula').add(new Option(f.name, i)));
    POWERS.forEach((n) => $('power').add(new Option('z' + String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]) + ' + c', n)));
    PALETTES.forEach((p, i) => $('palette').add(new Option(p.name, i)));
    $('juliaPreset').add(new Option('Custom', ''));
    JULIA_PRESETS.forEach((p, i) => $('juliaPreset').add(new Option(p[0], i)));
    $('quality').add(new Option('Draft (half resolution)', '0.5'));
    $('quality').add(new Option('Normal', '1'));
    if ((window.devicePixelRatio || 1) > 1) $('quality').add(new Option('High (device pixels)', 'dpr'));
    // The quality is remembered per browser; it must be known before the first
    // resize(), which sizes the canvas from it. A saved 'dpr' on a screen without
    // extra device pixels has no option, so it falls back to Normal.
    const q = loadPref('day12.quality', '1');
    if ([...$('quality').options].some((o) => o.value === q)) state.quality = q;

    $('formula').onchange = (e) => setFormula(+e.target.value, false);
    // A new power is a different fractal: back to the default views, same seed.
    $('power').onchange = (e) => { state.power = +e.target.value; setFormula(state.formula, true); };
    $('modeM').onclick = () => setMode(false);
    $('modeJ').onclick = () => setMode(true);

    $('juliaPreset').onchange = (e) => {
      if (e.target.value === '') return;
      const p = JULIA_PRESETS[+e.target.value];
      setSeed(p[1], p[2]);
      views.j = defaultView(true);
      setMode(true);
    };
    const seedEdited = () => {
      if (!setSeed($('jre').value, $('jim').value)) { syncUi(); return; }
      $('juliaPreset').value = '';
      if (state.julia) requestRender(0);
    };
    $('jre').onchange = seedEdited;
    $('jim').onchange = seedEdited;
    $('pick').onclick = () => {
      if (pickArmed) { setPickArmed(false); return; }
      if (state.julia) setMode(false);
      setPickArmed(true);
    };

    $('autoIter').onchange = (e) => {
      state.autoIter = e.target.checked;
      syncUi();
      requestRender(0);
    };
    $('iter').onchange = (e) => {
      const n = Math.round(+e.target.value);
      state.maxIter = Math.max(10, Math.min(MAX_ITER, isFinite(n) ? n : 400));
      syncUi();
      requestRender(0);
    };

    $('palette').onchange = (e) => { state.palette = +e.target.value; buildLut(); recolorAll(); writeHash(); };
    $('density').oninput = (e) => { state.density = +e.target.value; recolorAll(); };
    $('density').onchange = writeHash;
    $('cycle').onchange = (e) => {
      state.cycle = e.target.checked;
      if (state.cycle) startAnim();
    };
    $('relief').onchange = (e) => setRelief(e.target.checked);
    $('light').oninput = (e) => { state.light = +e.target.value; updateLight(); recolorAll(); };
    $('light').onchange = writeHash;
    $('autopilot').onclick = () => setAutopilot(!auto.on);
    $('quality').onchange = (e) => {
      const oldW = W;
      state.quality = e.target.value;
      savePref('day12.quality', state.quality);
      if (!resize()) return;
      // Same region of the plane, different number of pixels.
      views.m.scale *= oldW / W;
      views.j.scale *= oldW / W;
      img = null;
      requestRender(0);
    };

    $('reset').onclick = resetView;
    $('copy').onclick = () => {
      writeHash();
      const done = () => { $('copy').textContent = 'Copied!'; setTimeout(() => { $('copy').textContent = 'Copy link'; }, 1200); };
      if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, () => prompt('Link:', location.href));
      else prompt('Link:', location.href);
    };
    $('save').onclick = () => {
      draw();
      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fractal-' + FORMULAS[state.formula].id
          + (FORMULAS[state.formula].power ? state.power : '') + (state.julia ? '-julia' : '') + '.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    };
    $('toggle').onclick = () => $('panel').classList.toggle('hidden');
  }

  function resetView() {
    auto.anim = null;
    const v = defaultView(state.julia);
    if (state.julia) views.j = v; else views.m = v;
    view = v;
    requestRender(0);
  }

  // ---------------------------------------------------------------------------
  // 3D relief
  // ---------------------------------------------------------------------------

  // Turning the relief on needs the normals, so the view is computed again;
  // turning it off only recolors.
  function setRelief(on) {
    state.relief = on;
    syncUi();
    if (on) requestRender(0);
    else { recolorAll(); writeHash(); }
  }

  // ---------------------------------------------------------------------------
  // Autopilot
  // ---------------------------------------------------------------------------
  //
  // Repeats: wait for the render to finish, pick an interesting point of the
  // image, glide towards it while zooming in (the last image is stretched as a
  // preview), render. Any user input on the view stops it.

  const AUTO_ZOOM = 1 / 3;        // scale factor of one hop
  const AUTO_HOP_MS = 2200;
  const AUTO_DWELL_MS = 900;      // pause on each finished image
  const auto = { on: false, anim: null, readyAt: 0 };

  function setAutopilot(on) {
    if (auto.on === on) return;
    auto.on = on;
    $('autopilot').classList.toggle('on', on);
    $('autopilot').innerHTML = on ? '&#9632; Stop' : '&#9654; Auto';
    if (on) {
      setPickArmed(false);
      auto.readyAt = performance.now() + 300;
      requestAnimationFrame(autoTick);
    } else if (auto.anim) {
      auto.anim = null;
      requestRender(0);   // render where the glide stopped
    }
  }

  function autoTick(t) {
    if (!auto.on) return;
    if (auto.anim) autoStep(t);
    else if (renderDone && t >= auto.readyAt) autoHop(t);
    requestAnimationFrame(autoTick);
  }

  // Pick the next target from the finished image. The central area is split in
  // cells, scored by their mean escape count (dense, slow-escaping regions lead to
  // minibrots and spirals) with a bonus for cells that touch the inside of the set
  // (bulb and minibrot edges). Isolated high counts are ignored on purpose: they
  // tend to sit in chaotic "dust", which only gets noisier when zoomed. The
  // target is the slowest-escaping pixel of one of the best cells.
  // Returns null when the area holds no escaping pixel (zoomed into the inside).
  function pickTarget() {
    const cs = Math.max(8, Math.round(Math.min(W, H) / 20));   // cell size
    const s = Math.max(1, Math.round(cs / 8));                 // sampling step
    const x0 = Math.round(W * 0.2), x1 = Math.round(W * 0.8);
    const y0 = Math.round(H * 0.2), y1 = Math.round(H * 0.8);
    const cells = [];
    let vmax = 0;
    for (let cy = y0; cy + cs <= y1; cy += cs) {
      for (let cx = x0; cx + cs <= x1; cx += cs) {
        let sum = 0, esc = 0, ins = 0, best = -1, bx = 0, by = 0;
        for (let y = cy; y < cy + cs; y += s) {
          for (let x = cx; x < cx + cs; x += s) {
            const v = iters[y * W + x];
            if (v < 0) ins++;
            else if (v > 0) {
              sum += v; esc++;
              if (v > best) { best = v; bx = x; by = y; }
            }
          }
        }
        if (esc === 0) continue;
        const mean = sum / esc;
        if (mean > vmax) vmax = mean;
        cells.push({ mean, edge: ins > 0 && esc > 0 && ins < esc, x: bx, y: by });
      }
    }
    if (cells.length === 0) return null;
    for (const c of cells) c.score = c.mean / vmax + (c.edge ? 0.25 : 0) + 0.1 * Math.random();
    cells.sort((a, b) => b.score - a.score);
    const c = cells[Math.floor(Math.random() * Math.min(3, cells.length))];
    return { x: c.x, y: c.y };
  }

  function autoHop(t) {
    // At the end of the zoom range start over from the default view.
    if (view.scale < MIN_SCALE * 1e4) { resetView(); return; }
    const target = pickTarget();
    const tx = target ? target.x : W / 2, ty = target ? target.y : H / 2;
    auto.anim = {
      t0: t, re0: view.re, im0: view.im, p0: view.p, s0: view.scale,
      ox: (tx - W / 2) * view.scale, oy: -(ty - H / 2) * view.scale,
      // No escaping pixel in sight: back out instead.
      f: target ? AUTO_ZOOM : 1 / AUTO_ZOOM,
    };
  }

  function autoStep(t) {
    const a = auto.anim;
    const u = Math.min(1, (t - a.t0) / AUTO_HOP_MS);
    const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);   // ease in-out
    const s = Math.min(MAX_SPAN / Math.min(W, H), a.s0 * Math.pow(a.f, e));
    ensurePrecision(view, s);
    view.re = reprec(a.re0, a.p0, view.p) + numToFixed(a.ox * e, view.p);
    view.im = reprec(a.im0, a.p0, view.p) + numToFixed(a.oy * e, view.p);
    view.scale = s;
    clampCenter();
    if (u < 1) {
      requestRender(1e6);   // preview only: no render while gliding
    } else {
      auto.anim = null;
      requestRender(0);
    }
  }

  // ---------------------------------------------------------------------------
  // Input: mouse, touch, keyboard
  // ---------------------------------------------------------------------------

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }

  // ---------------------------------------------------------------------------
  // Background music
  // ---------------------------------------------------------------------------

  // Browsers block audio until the user interacts with the page, so playback
  // starts on the first click, wheel or key press when music is enabled.
  // On/off and volume are remembered per browser.
  const bgm = $('bgm');

  function loadPref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable: ignore */ }
  }

  function playMusic() {
    if (!$('music').checked || !bgm.paused) return;
    const p = bgm.play();
    if (p) p.catch(() => { /* still blocked: retry on the next interaction */ });
  }

  function setMusic(on) {
    $('music').checked = on;
    $('volume').disabled = !on;
    savePref('day12.music', on ? '1' : '0');
    if (on) playMusic(); else bgm.pause();
  }

  function initMusic() {
    const vol = parseFloat(loadPref('day12.volume', '0.5'));
    bgm.volume = isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.5;
    $('volume').value = bgm.volume;
    $('music').checked = loadPref('day12.music', '1') === '1';
    $('volume').disabled = !$('music').checked;

    $('music').onchange = (e) => setMusic(e.target.checked);
    $('volume').oninput = (e) => { bgm.volume = +e.target.value; };
    $('volume').onchange = (e) => savePref('day12.volume', e.target.value);
    bgm.onerror = () => {
      $('music').checked = false;
      $('music').disabled = $('volume').disabled = true;
      $('music').parentElement.title = 'Music file not found';
    };

    const kick = () => {
      playMusic();
      if (!bgm.paused || !$('music').checked) {
        for (const ev of ['pointerdown', 'wheel', 'keydown']) window.removeEventListener(ev, kick, true);
      }
    };
    for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, kick, true);
  }

  function initInput() {
    const pointers = new Map();
    let travelled = 0;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      setAutopilot(false);
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 33; else if (e.deltaMode === 2) dy *= 400;
      dy = Math.max(-300, Math.min(300, dy));
      const { x, y } = canvasPos(e);
      // ctrlKey marks a trackpad pinch gesture, which sends much smaller deltas.
      zoomAt(x, y, Math.exp(dy * (e.ctrlKey ? 0.012 : 0.0022)));
    }, { passive: false });

    canvas.addEventListener('pointerdown', (e) => {
      setAutopilot(false);
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 0) travelled = 0;
      pointers.set(e.pointerId, canvasPos(e));
      canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = canvasPos(e);
      if (pointers.size === 1) {
        travelled += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        pointers.set(e.pointerId, cur);
        if (cur.x !== prev.x || cur.y !== prev.y) panBy(cur.x - prev.x, cur.y - prev.y);
      } else if (pointers.size === 2) {
        // Pinch: pan by the movement of the midpoint, zoom by the change in distance.
        let other = null;
        for (const [id, p] of pointers) if (id !== e.pointerId) other = p;
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
        const mx = (cur.x + other.x) / 2, my = (cur.y + other.y) / 2;
        travelled += 100;
        pointers.set(e.pointerId, cur);
        panBy((cur.x - prev.x) / 2, (cur.y - prev.y) / 2);
        if (d0 > 0 && d1 > 0) zoomAt(mx, my, d0 / d1);
      }
    });

    const release = (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        canvas.classList.remove('dragging');
        const isClick = e.type === 'pointerup' && travelled < 5;
        if (isClick && !state.julia && (pickArmed || e.shiftKey)) pickSeed(p.x, p.y);
      }
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    canvas.addEventListener('dblclick', (e) => {
      if (e.shiftKey) return;
      const { x, y } = canvasPos(e);
      zoomAt(x, y, 0.25);
    });

    window.addEventListener('keydown', (e) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const step = Math.min(W, H) * 0.12;
      // Keys that move the view take over from the autopilot.
      if (/^(Arrow|\+|=|-|_|r|R)/.test(e.key)) setAutopilot(false);
      switch (e.key) {
        case 'ArrowLeft': panBy(step, 0); break;
        case 'ArrowRight': panBy(-step, 0); break;
        case 'ArrowUp': panBy(0, step); break;
        case 'ArrowDown': panBy(0, -step); break;
        case '+': case '=': zoomAt(W / 2, H / 2, 0.7); break;
        case '-': case '_': zoomAt(W / 2, H / 2, 1 / 0.7); break;
        case 'r': case 'R': resetView(); break;
        case 'h': case 'H': $('panel').classList.toggle('hidden'); break;
        case 'm': case 'M': setMusic(!$('music').checked); break;
        case 'a': case 'A': setAutopilot(!auto.on); break;
        case 'l': case 'L': setRelief(!state.relief); break;
        case 'Escape': setPickArmed(false); break;
        default: return;
      }
      e.preventDefault();
    });

    window.addEventListener('resize', () => { if (resize()) requestRender(); });
    window.addEventListener('hashchange', () => { if (location.hash !== lastHash) applyHash(); });
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  initUi();
  initMusic();
  if (window.innerWidth < 700) $('panel').classList.add('hidden');   // keep small screens clear
  resize();
  applyHash();
  initInput();
})();
