'use strict';
// WinterTracker drawing code: splash, header, channel meters, pattern grid, sample panel, overlays.

const logoImg = new Image();
logoImg.src = 'img/logo.jpg';

const HDR_H = 62, TAB_Y = 64, TAB_H = 13, CH_Y = 80, CH_H = 34, GRID_Y = 119;
const TABS = [['pattern', 'PATTERN F2'], ['samples', 'SAMPLES F3']];
const BANDS = [60, 120, 240, 480, 960, 1900, 3800, 7600];
const LOOP_NAMES = ['OFF', 'FWD', 'PING'];

function frame() {
  requestAnimationFrame(frame);
  UI.begin();
  if (state.screen === 'splash') drawSplash(); else drawMain();
}

// ---- splash ----
function drawSplash() {
  const W = UI.W, H = UI.H, ctx = UI.ctx;
  UI.rect(0, 0, W, H, COL.bg);
  if (logoImg.complete && logoImg.naturalWidth) {
    const iw = logoImg.naturalWidth, ih = logoImg.naturalHeight;
    const sc = Math.min(W / iw, (H - 60) / ih);
    const w = iw * sc, h = ih * sc;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logoImg, (W - w) / 2, (H - 50 - h) / 2, w, h);
    ctx.imageSmoothingEnabled = false;
  }
  if ((UI.frame >> 5) & 1) UI.text('CLICK OR PRESS ANY KEY TO START', W / 2, H - 38, COL.ice, 2, 'center');
  else UI.text('CLICK OR PRESS ANY KEY TO START', W / 2, H - 38, COL.dim, 2, 'center');
}

// ---- helpers ----
function ledBar(x, yBottom, w, level, segs, segH) {
  const lit = Math.round(level * segs);
  for (let s = 0; s < segs; s++) {
    const y = yBottom - (s + 1) * (segH + 1) + 1;
    UI.rect(x, y, w, segH, s < lit ? (s >= segs - 1 ? COL.barHi : COL.bar) : '#0a2a38');
  }
}

function drawScope(ring, rpos, x, y, w, h, gain, color) {
  const mask = RING - 1, base = (rpos - 1536) & mask;
  let st = 0;
  for (let i = 1; i < 512; i++) if (ring[(base + i - 1) & mask] < 0 && ring[(base + i) & mask] >= 0) { st = i; break; }
  const stride = 480 / w, mid = y + h / 2, amp = h / 2 - 1;
  UI.rect(x, Math.round(mid), w, 1, '#0d3a4a');
  let py = null;
  for (let px = 0; px < w; px++) {
    const s = ring[(base + st + ((px * stride) | 0)) & mask] * gain;
    const yy = Math.round(mid - clamp(s, -1, 1) * amp);
    if (py === null) py = yy;
    const y0 = Math.min(py, yy), y1 = Math.max(py, yy);
    UI.rect(x + px, y0, 1, y1 - y0 + 1, color);
    py = yy;
  }
}

function spectrum(ring, rpos, sr, out) {
  const N = 512, mask = RING - 1, st = (rpos - N) & mask;
  for (let b = 0; b < 8; b++) {
    const co = 2 * Math.cos(2 * Math.PI * BANDS[b] / sr);
    let s1 = 0, s2 = 0;
    for (let n = 0; n < N; n++) { const s0 = ring[(st + n) & mask] + co * s1 - s2; s2 = s1; s1 = s0; }
    const power = s1 * s1 + s2 * s2 - co * s1 * s2;
    const amp = 2 * Math.sqrt(Math.max(0, power)) / N;
    const h = clamp((20 * Math.log10(amp + 1e-5) + 62) / 56, 0, 1);
    out[b] = Math.max(h, out[b] - 0.07);
  }
}

function dbLevel(v) { return clamp((20 * Math.log10(v + 1e-5) + 48) / 48, 0, 1); }

function vizFor(ci) {
  return state.viz[ci] || (state.viz[ci] = { vu: 0, lvl: 0, bars: new Float32Array(8) });
}

// ---- main screen ----
function drawMain() {
  const W = UI.W, H = UI.H;
  UI.rect(0, 0, W, H, COL.bg);
  if (engine.playing) {
    state.ord = Math.min(engine.ord, song.orders.length - 1);
    state.row = engine.row;
  }
  state.ord = clamp(state.ord, 0, song.orders.length - 1);
  const pat = curPat();
  state.row = clamp(state.row, 0, pat.rows - 1);
  state.fit = clamp(Math.floor((W - GX - 14) / CHW), 1, MAX_CH);
  if (song.channels < Math.min(MAX_CH, state.fit)) song.channels = Math.min(MAX_CH, state.fit);
  state.ch = Math.min(state.ch, song.channels - 1);
  ensureChVisible();

  UI.lock = !!(state.browser || state.help || state.files);
  drawHeader();
  drawTabs();
  if (state.tab === 'pattern') {
    drawChannelHeaders();
    drawGrid(GRID_Y, Math.max(ROWH * 3, H - GRID_Y - 6));
  } else {
    const sy = TAB_Y + TAB_H + 2;
    drawSamplePanel(sy, Math.max(100, H - sy - 2));
  }
  UI.lock = false;
  if (state.files) drawFileBrowser();
  if (state.browser) drawBrowser();
  if (state.help) drawHelp();
  drawToast();
}

function drawHeader() {
  const W = UI.W;
  UI.panel(0, 0, W, HDR_H);
  UI.icicles(2, HDR_H - 2, W - 4, 5);
  const ctx = UI.ctx;
  if (logoImg.complete && logoImg.naturalWidth) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(logoImg, 415, 575, 545, 140, 5, 4, 102, 26);
    ctx.imageSmoothingEnabled = false;
  }
  // row A1: transport + files
  let x = 112;
  const hb = (label, fn, opt, y) => {
    const w = label.length * 6 + 8;
    UI.button(x, y || 5, w, 12, label, fn, opt);
    x += w + 3;
  };
  hb('PLAY', () => playSong(), { on: engine.playing && engine.mode === 'song' });
  hb('PAT', () => playPattern(), { on: engine.playing && engine.mode === 'pattern' });
  hb('STOP', () => stopPlay());
  x += 6;
  hb('OPEN', () => pickFile('.json,.wtk', f => handleFile(f)));
  hb('SAVE', () => saveSong());
  hb('WAV', () => exportWav());
  x += 6;
  hb('HELP', () => { state.help = true; });
  // row A2: tempo / edit settings
  x = 112;
  const sp = (label, val, step, vw) => { x += UI.spinner(x, 19, label, val, step, vw) + 6; };
  sp('BPM', String(song.bpm), (d, m) => { song.bpm = clamp(song.bpm + d * m, 32, 255); if (engine.playing) engine.bpm = song.bpm; }, 22);
  sp('SPD', String(song.speed), (d, m) => { song.speed = clamp(song.speed + d * (m > 1 ? 1 : m), 1, 31); if (engine.playing) engine.speed = song.speed; }, 14);
  sp('OCT', String(state.oct), d => { state.oct = clamp(state.oct + d, 0, 7); }, 8);
  sp('STP', String(state.step), d => { state.step = clamp(state.step + d, 0, 16); }, 14);
  sp('VOL', String(Math.round(engine.master * 100)), (d, m) => { engine.master = clamp(engine.master + d * m * 0.05, 0.05, 1.5); }, 22);
  // row B: order / pattern
  x = 6;
  const sb = (label, val, step, vw) => { x += UI.spinner(x, 34, label, val, step, vw) + 6; };
  sb('ORD', hex2(state.ord) + '/' + hex2(song.orders.length - 1), d => setOrder(state.ord + d), 34);
  sb('PAT', hex2(song.orders[state.ord]), d => {
    song.orders[state.ord] = clamp(song.orders[state.ord] + d, 0, song.patterns.length - 1);
    state.row = Math.min(state.row, curPat().rows - 1);
  }, 14);
  sb('LEN', String(pat0().rows), (d, m) => {
    const i = song.orders[state.ord];
    song.patterns[i] = resizePattern(song.patterns[i], clamp(song.patterns[i].rows + d * m, 1, MAX_ROWS));
    state.row = Math.min(state.row, song.patterns[i].rows - 1);
  }, 22);
  UI.text((engine.playing ? 'PLAYING ' : 'STOPPED ') + 'ROW ' + hex2(state.row) + '/' + hex2(pat0().rows - 1), x + 6, 36, engine.playing ? COL.vol : COL.dim);
  // row C: order / pattern buttons + title
  x = 6;
  hb('INS ORD', () => insertOrder(), null, 48);
  hb('DEL ORD', () => deleteOrder(), null, 48);
  hb('NEW PAT', () => addPattern(false), null, 48);
  hb('CLONE', () => addPattern(true), null, 48);
  hb('CLEAR', () => clearPattern(), null, 48);
  UI.text('TITLE', W - 176, 50, COL.dim);
  UI.field('title', W - 142, 47, 136, song.title, 32, v => { song.title = v.toUpperCase(); });
  // master scope + VU
  const mx = W - 122;
  UI.inset(mx, 4, 118, 28);
  const pl = engine.pkL, pr = engine.pkR; engine.pkL = 0; engine.pkR = 0;
  const mv = state.mvu || (state.mvu = [0, 0]);
  mv[0] = Math.max(dbLevel(pl), mv[0] - 0.06); mv[1] = Math.max(dbLevel(pr), mv[1] - 0.06);
  ledBar(mx + 3, 30, 3, mv[0], 7, 2);
  ledBar(mx + 7, 30, 3, mv[1], 7, 2);
  drawScope(engine.mring, engine.mpos, mx + 12, 6, 104, 24, 1.3, COL.note);
}

function pat0() { return curPat(); }

// Tab bar below the header.
function drawTabs() {
  let x = 6;
  for (const [id, label] of TABS) {
    const w = label.length * 6 + 14, on = state.tab === id;
    UI.rect(x, TAB_Y, w, TAB_H, COL.edgeLo);
    UI.rect(x + 1, TAB_Y + 1, w - 2, TAB_H - 1, on ? '#1b8aa6' : (UI.hover(x, TAB_Y, w, TAB_H) ? '#164b60' : COL.panel2));
    UI.rect(x + 1, TAB_Y + 1, w - 2, 1, on ? COL.ice : COL.edgeHi);
    UI.text(label, x + w / 2, TAB_Y + 3, on ? COL.bright : COL.text, 1, 'center');
    UI.hit(x, TAB_Y, w, TAB_H, { onDown: () => { state.tab = id; } });
    x += w + 3;
  }
  // current sample (Ctrl+Up / Ctrl+Down to change)
  x += 10;
  x += UI.spinner(x, TAB_Y + 1, 'SMP', hex2(state.smp), d => selectSample(state.smp + d), 14) + 8;
  const s = curSample();
  UI.text((s.name || '(EMPTY)').slice(0, 22), x, TAB_Y + 3, s.data.length ? COL.bright : COL.dim);
  UI.text('CTRL+UP/DOWN', UI.W - 8, TAB_Y + 3, COL.dim, 1, 'right');
}

function drawChannelHeaders() {
  const vis = Math.min(state.fit, song.channels - state.chScroll);
  for (let i = 0; i < vis; i++) {
    const ci = state.chScroll + i, c = engine.ch[ci];
    const x = GX + i * CHW, y = CH_Y, w = CHW - 3;
    const aud = engine.isAudible(c);
    UI.panel(x, y, w, CH_H, aud ? COL.panel : '#05161f');
    UI.text(String(ci + 1), x + 4, y + 3, aud ? COL.bright : COL.dim);
    if (c.mute) UI.text('MUTE', x + w - 4, y + 3, COL.hot, 1, 'right');
    else if (c.solo) UI.text('SOLO', x + w - 4, y + 3, COL.fx, 1, 'right');
    const v = vizFor(ci);
    const pk = c.peak; c.peak = 0;
    v.vu = Math.max(pk, v.vu * 0.88);
    if (v.vu > 0.003) spectrum(c.ring, c.rpos, engine.sr, v.bars);
    else for (let b = 0; b < 8; b++) v.bars[b] = Math.max(0, v.bars[b] - 0.07);
    v.lvl = Math.max(dbLevel(v.vu), v.lvl - 0.05);
    const by = y + CH_H - 4;
    for (let b = 0; b < 8; b++) ledBar(x + 4 + b * 4, by, 3, v.bars[b], 6, 2);
    ledBar(x + 37, by, 3, v.lvl, 6, 2);
    if (v.vu > 0.003) drawScope(c.ring, c.rpos, x + 43, y + 12, w - 46, 19, 3, COL.note);
    else UI.rect(x + 43, y + 21, w - 46, 1, '#0d3a4a');
    UI.hit(x, y, w, CH_H, {
      onDown: e => {
        if (e.button === 2) c.solo = !c.solo; else c.mute = !c.mute;
        engine.anySolo = engine.ch.some(q => q.solo);
        if (!engine.playing && !engine.isAudible(c)) { c.v.gt = 0; }
      }
    });
  }
}

function fieldStr(p, i, f) {
  switch (f) {
    case 0: return noteName(p.note[i]);
    case 1: return p.inst[i] ? hex2(p.inst[i])[0] : '.';
    case 2: return p.inst[i] ? hex2(p.inst[i])[1] : '.';
    case 3: return p.vol[i] === 255 ? '.' : hex2(p.vol[i])[0];
    case 4: return p.vol[i] === 255 ? '.' : hex2(p.vol[i])[1];
    case 5: return p.fxc[i] ? String.fromCharCode(p.fxc[i]) : '.';
    case 6: return p.fxc[i] ? hex2(p.fxp[i])[0] : '.';
    default: return p.fxc[i] ? hex2(p.fxp[i])[1] : '.';
  }
}

function drawGrid(gy, gh) {
  const W = UI.W, p = curPat();
  UI.inset(2, gy - 2, W - 4, gh + 3);
  const rowsVis = Math.max(1, Math.floor(gh / ROWH)), center = rowsVis >> 1;
  const vis = Math.min(state.fit, song.channels - state.chScroll);
  const cy = gy + center * ROWH;
  UI.rect(3, cy - 1, W - 6, ROWH, COL.play);
  UI.rect(3, cy - 1, W - 6, 1, COL.edgeHi);
  UI.rect(3, cy + ROWH - 2, W - 6, 1, COL.edgeHi);
  const sel = selRect();
  for (let r = 0; r < rowsVis; r++) {
    const pr = state.row - center + r;
    if (pr < 0 || pr >= p.rows) continue;
    const y = gy + r * ROWH, cur = r === center;
    if (sel && pr >= sel.r0 && pr <= sel.r1) {
      for (let i = 0; i < vis; i++) {
        const ci = state.chScroll + i;
        if (ci >= sel.c0 && ci <= sel.c1) UI.rect(GX + i * CHW - 2, y - 1, CHW - 2, ROWH, '#2a6f8f');
      }
    }
    if (!cur && pr % 4 === 0) UI.rect(3, y - 1, W - 6, ROWH, COL.rowBeat);
    UI.text(hex2(pr), 6, y, cur ? COL.bright : (pr % 4 === 0 ? COL.text : COL.dim));
    for (let i = 0; i < vis; i++) {
      const ci = state.chScroll + i, idx = pr * MAX_CH + ci, x = GX + i * CHW;
      const n = p.note[idx], v = p.vol[idx], fc = p.fxc[idx];
      UI.text(noteName(n), x, y, n ? COL.note : COL.dim);
      UI.text(p.inst[idx] ? hex2(p.inst[idx]) : '..', x + 21, y, p.inst[idx] ? COL.inst : COL.dim);
      UI.text(v === 255 ? '..' : hex2(v), x + 36, y, v === 255 ? COL.dim : COL.vol);
      UI.text(fc ? String.fromCharCode(fc) + hex2(p.fxp[idx]) : '...', x + 51, y, fc ? COL.fx : COL.dim);
    }
  }
  for (let i = 0; i < vis; i++) UI.rect(GX + i * CHW - 3, gy - 1, 1, gh, '#0f3a4c');
  // cursor
  if (!engine.playing && state.ch >= state.chScroll && state.ch < state.chScroll + vis) {
    const f = state.field, x = GX + (state.ch - state.chScroll) * CHW + FIELD_X[f];
    if ((UI.frame >> 5) & 1) UI.rect(x - 1, cy - 1, FIELD_W[f] + 1, ROWH, COL.cursor);
    else UI.rect(x - 1, cy - 1, FIELD_W[f] + 1, ROWH, '#1b8aa6');
    UI.text(fieldStr(p, cellIdx(), f), x, cy, COL.bg);
  }
  // mouse: click to place the cursor
  UI.hit(GX, gy, vis * CHW, gh, {
    onDown: (e, rx, ry) => {
      const col = Math.floor(rx / CHW), ci = state.chScroll + col;
      if (ci >= song.channels) return;
      const px = rx - col * CHW;
      let f = 0;
      for (let k = 7; k >= 0; k--) if (FIELD_X[k] <= px) { f = k; break; }
      state.ch = ci; state.field = f;
      if (!engine.playing) state.row = clamp(state.row - center + Math.floor(ry / ROWH), 0, p.rows - 1);
    }
  });
  // vertical scrollbar
  const sx = W - 10;
  UI.inset(sx, gy, 6, gh, '#03101a');
  const th = Math.max(6, Math.floor(gh / Math.max(1, p.rows)));
  const ty = gy + Math.round((gh - th) * state.row / Math.max(1, p.rows - 1));
  UI.rect(sx + 1, ty, 4, th, COL.edgeHi);
  const setRow = (e, rx, ry) => { if (!engine.playing) state.row = clamp(Math.round(ry / gh * (p.rows - 1)), 0, p.rows - 1); };
  UI.hit(sx, gy, 6, gh, { onDown: setRow, onDrag: setRow });
  // horizontal scroll hint when the song has more channels than fit
  if (song.channels > state.fit) {
    UI.text('< > SHIFT+WHEEL: TRACKS ' + (state.chScroll + 1) + '-' + (state.chScroll + vis) + '/' + song.channels, W - 14, gy + gh - 8, COL.dim, 1, 'right');
  }
}

// ---- samples ----
function waveCache(s, w) {
  let c = s._pk;
  if (c && c.w === w && c.data === s.data && c.rev === (s.rev || 0)) return c;
  const len = s.data.length, mins = new Float32Array(w), maxs = new Float32Array(w);
  for (let px = 0; px < w; px++) {
    const i0 = Math.floor(px * len / w), i1 = Math.max(i0 + 1, Math.floor((px + 1) * len / w));
    const st = Math.max(1, ((i1 - i0) / 48) | 0);
    let mn = 1, mx = -1;
    for (let i = i0; i < i1 && i < len; i += st) { const v = s.data[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn > mx) { mn = 0; mx = 0; }
    mins[px] = mn; maxs[px] = mx;
  }
  c = s._pk = { w, data: s.data, rev: s.rev || 0, mins, maxs };
  return c;
}

function drawWave(s, x, y, w, h) {
  UI.inset(x, y, w, h);
  const iw = w - 2, ih = h - 2, ix = x + 1, iy = y + 1, mid = iy + ih / 2;
  UI.rect(ix, Math.round(mid), iw, 1, '#0d3a4a');
  if (!s.data.length) { UI.text('EMPTY', x + w / 2, y + h / 2 - 3, COL.dim, 1, 'center'); return; }
  const c = waveCache(s, iw);
  for (let px = 0; px < iw; px++) {
    const y0 = Math.round(mid - c.maxs[px] * (ih / 2 - 1)), y1 = Math.round(mid - c.mins[px] * (ih / 2 - 1));
    UI.rect(ix + px, y0, 1, Math.max(1, y1 - y0 + 1), COL.bar);
  }
}

function drawSamplePanel(sy, ph) {
  const W = UI.W, H = UI.H, s = curSample();
  UI.panel(2, sy, W - 4, ph);
  UI.icicles(4, sy + 2, W - 8, 21);
  UI.text('SAMPLES', 8, sy + 5, COL.text);
  UI.text('SAMPLE ' + hex2(state.smp), 160, sy + 5, COL.dim);
  // list
  const lx = 6, ly = sy + 14, lw = 150, rows = Math.max(4, Math.floor((ph - 20) / ROWH));
  state.smpRows = rows;
  UI.inset(lx, ly, lw, rows * ROWH + 2);
  for (let r = 0; r < rows; r++) {
    const si = state.smpScroll + r;
    if (si >= MAX_SMP) break;
    const sm = song.samples[si], y = ly + 1 + r * ROWH;
    if (si === state.smp - 1) UI.rect(lx + 1, y - 1, lw - 2, ROWH, COL.play);
    UI.text(hex2(si + 1) + ' ' + (sm.name || '').slice(0, 22), lx + 3, y, sm.data.length ? COL.bright : COL.dim);
  }
  UI.hit(lx, ly, lw, rows * ROWH + 2, {
    onDown: (e, rx, ry) => selectSample(state.smpScroll + clamp(Math.floor((ry - 1) / ROWH), 0, rows - 1) + 1),
    onWheel: dy => { state.smpScroll = clamp(state.smpScroll + (dy > 0 ? 2 : -2), 0, MAX_SMP - rows); }
  });
  // controls (right column)
  const cx = W - 6 - 186;
  const wx = 162, ww = Math.max(60, cx - 6 - wx), wy = sy + 14, wh = ph - 14 - 17;
  drawWave(s, wx, wy, ww, wh);
  const len = s.data.length;
  if (len) {
    const fx = f => wx + 1 + Math.round(f / len * (ww - 2));
    if (s.loopType) {
      const a = fx(s.loopStart), b = fx(s.loopEnd);
      UI.ctx.globalAlpha = 0.18; UI.rect(a, wy + 1, Math.max(1, b - a), wh - 2, COL.fx); UI.ctx.globalAlpha = 1;
      UI.rect(a, wy + 1, 1, wh - 2, COL.fx); UI.rect(b - 1, wy + 1, 1, wh - 2, COL.hot);
      UI.rect(a, wy + 1, 4, 3, COL.fx); UI.rect(b - 4, wy + 1, 4, 3, COL.hot);
    }
    // play heads of every channel currently playing this sample
    for (let i = 0; i <= MAX_CH; i++) {
      const v = engine.ch[i].v;
      if (v.active && v.smp === s) UI.rect(clamp(fx(v.pos), wx + 1, wx + ww - 2), wy + 1, 1, wh - 2, COL.bright);
    }
    const setMark = (e, rx) => {
      const f = clamp(Math.round((rx - 1) / (ww - 2) * len), 0, len);
      if (state.mark === 0) s.loopStart = Math.min(f, Math.max(0, s.loopEnd - 2));
      else s.loopEnd = Math.max(f, Math.min(len, s.loopStart + 2));
    };
    UI.hit(wx, wy, ww, wh, {
      onDown: (e, rx) => {
        if (!s.loopType) { s.loopType = 1; s.loopStart = 0; s.loopEnd = len; }
        const da = Math.abs(rx - (fx(s.loopStart) - wx)), db = Math.abs(rx - (fx(s.loopEnd) - wx));
        state.mark = da <= db ? 0 : 1;
        setMark(e, rx);
      },
      onDrag: setMark
    });
  }
  // buttons under the waveform
  let bx = wx;
  const bt = (label, fn) => { const w = label.length * 6 + 8; UI.button(bx, wy + wh + 3, w, 11, label, fn); bx += w + 3; };
  bt('LOAD', () => openFileBrowser());
  bt('PLAY', () => engine.preview(s, s.base));
  bt('STOP', () => engine.previewStop());
  bt('REV', () => reverseSample());
  bt('NORM', () => normalizeSample());
  bt('CLEAR', () => clearSample());
  UI.text(len + ' FR ' + (len && s.rate ? (len / s.rate).toFixed(2) + 'S' : ''), bx + 3, wy + wh + 5, COL.dim);
  // parameter spinners
  UI.text('NAME', cx, sy + 16, COL.dim);
  UI.field('smpname', cx + 28, sy + 14, 158, s.name, 22, v => { s.name = v.toUpperCase(); });
  const c2 = cx + 93;
  UI.spinner(cx, sy + 28, 'VOL', String(s.vol), (d, m) => { s.vol = clamp(s.vol + d * m, 0, 64); }, 36);
  UI.spinner(c2, sy + 28, 'FINE', String(s.fine), (d, m) => { s.fine = clamp(s.fine + d * m, -128, 127); }, 36);
  UI.spinner(cx, sy + 41, 'BASE', noteName(s.base), (d, m) => { s.base = clamp(s.base + d * (m > 1 ? 12 : 1), 1, 96); }, 36);
  UI.spinner(c2, sy + 41, 'RATE', String(Math.round(s.rate)), (d, m) => { s.rate = clamp(Math.round(s.rate) + d * m * 50, 1000, 96000); }, 36);
  UI.text('LOOP', cx, sy + 56, COL.dim);
  UI.button(cx + 26, sy + 54, 40, 11, LOOP_NAMES[s.loopType], () => {
    s.loopType = (s.loopType + 1) % 3;
    if (s.loopType && s.loopEnd - s.loopStart < 2) { s.loopStart = 0; s.loopEnd = s.data.length; }
  }, { on: s.loopType > 0 });
  const stp = len > 8192 ? len >> 10 : 1;
  UI.spinner(cx, sy + 67, 'LSTA', String(s.loopStart), (d, m) => { s.loopStart = clamp(s.loopStart + d * m * stp, 0, Math.max(0, s.loopEnd - 2)); }, 36);
  UI.spinner(c2, sy + 67, 'LEND', String(s.loopEnd), (d, m) => { s.loopEnd = clamp(s.loopEnd + d * m * stp, Math.min(len, s.loopStart + 2), len); }, 36);
  UI.text('DROP XM/S3M/IT/MOD/WAV FILES', cx, sy + 83, COL.dim);
  UI.text('CLICK WAVE: LOOP MARKERS', cx, sy + 94, COL.dim);
}

// ---- module browser ----
function drawBrowser() {
  const b = state.browser, W = UI.W, H = UI.H, ctx = UI.ctx;
  ctx.globalAlpha = 0.75; UI.rect(0, 0, W, H, '#000'); ctx.globalAlpha = 1;
  const bx = 14, by = 8, bw = W - 28, bh = H - 16;
  UI.panel(bx, by, bw, bh);
  UI.icicles(bx + 2, by + 2, bw - 4, 33);
  UI.text(b.type + ' MODULE: ' + (b.title || '(UNTITLED)'), bx + 8, by + 14, COL.bright);
  UI.text('FILE ' + b.file + ' - ' + b.samples.length + ' SAMPLES - CLICK TO PREVIEW, IMPORT INTO SLOT ' + hex2(state.smp), bx + 8, by + 24, COL.dim);
  const ly = by + 38, wh = 56, wy = by + bh - 20 - wh - 4;
  const rowsVis = Math.max(1, Math.floor((wy - ly - 4) / ROWH));
  if (b.sel < b.scroll) b.scroll = b.sel;
  if (b.sel >= b.scroll + rowsVis) b.scroll = b.sel - rowsVis + 1;
  b.scroll = clamp(b.scroll, 0, Math.max(0, b.samples.length - rowsVis));
  UI.inset(bx + 6, ly - 2, bw - 12, rowsVis * ROWH + 3);
  for (let r = 0; r < rowsVis; r++) {
    const i = b.scroll + r;
    if (i >= b.samples.length) break;
    const s = b.samples[i], y = ly + r * ROWH;
    if (i === b.sel) UI.rect(bx + 7, y - 1, bw - 14, ROWH, COL.play);
    const line = hex2(Math.min(255, s.src || i + 1)) + ' ' + (s.name || '(NO NAME)').padEnd(22).slice(0, 22) + ' ' +
      String(s.data.length).padStart(8) + ' FR ' + String(Math.round(s.rate)).padStart(6) + 'HZ ' + (s.bits || 8) + 'B' +
      (s.loopType ? ' LOOP' : '') + ' V' + hex2(s.vol);
    UI.text(line, bx + 10, y, i === b.sel ? COL.bright : COL.text);
  }
  UI.hit(bx + 6, ly - 2, bw - 12, rowsVis * ROWH + 3, {
    onDown: (e, rx, ry) => {
      const i = b.scroll + clamp(Math.floor((ry - 2) / ROWH), 0, rowsVis - 1);
      if (i < b.samples.length) { b.sel = i; engine.preview(b.samples[i], 49); }
    },
    onWheel: dy => { b.scroll = clamp(b.scroll + (dy > 0 ? 3 : -3), 0, Math.max(0, b.samples.length - rowsVis)); }
  });
  drawWave(b.samples[b.sel], bx + 6, wy, bw - 12, wh);
  let x = bx + 6;
  const by2 = by + bh - 17;
  const bt = (label, fn) => { const w = label.length * 6 + 10; UI.button(x, by2, w, 12, label, fn); x += w + 4; };
  bt('IMPORT', () => { importSample(state.smp - 1, b.samples[b.sel]); toast('IMPORTED TO SLOT ' + hex2(state.smp)); });
  bt('IMPORT ALL', () => {
    let n = 0;
    for (let i = 0; i < b.samples.length && state.smp - 1 + i < MAX_SMP; i++) { importSample(state.smp - 1 + i, b.samples[i]); n++; }
    toast(n + ' SAMPLES IMPORTED');
  });
  bt('PLAY', () => engine.preview(b.samples[b.sel], 49));
  bt('STOP', () => engine.previewStop());
  bt('CLOSE', () => { state.browser = null; engine.previewStop(); });
}

// ---- in-GUI file browser ----
function drawFileBrowser() {
  const f = state.files, W = UI.W, H = UI.H, ctx = UI.ctx;
  ctx.globalAlpha = 0.75; UI.rect(0, 0, W, H, '#000'); ctx.globalAlpha = 1;
  const bx = 14, by = 8, bw = W - 28, bh = H - 16;
  UI.panel(bx, by, bw, bh);
  UI.icicles(bx + 2, by + 2, bw - 4, 41);
  UI.text('SAMPLE BROWSER - LOADS INTO SLOT ' + hex2(state.smp), bx + 8, by + 14, COL.bright);
  if (f.setup) {
    const lines = f.setup === 'grant'
      ? ['THE BROWSER NEEDS PERMISSION TO READ YOUR SAMPLE FOLDER AGAIN:', f.root.name || '', '', 'CLICK ALLOW ACCESS (THE SYSTEM ASKS FOR CONFIRMATION).']
      : ['NO SAMPLE FOLDER CHOSEN YET.', '', 'CHOOSE THE FOLDER WHERE YOUR SAMPLES AND MODULES ARE.',
        'IT IS REMEMBERED AND THEN BROWSED HERE, INSIDE THE TRACKER.'];
    lines.forEach((l, i) => UI.text(l, bx + 12, by + 40 + i * 12, i === 1 && f.setup === 'grant' ? COL.fx : COL.text));
    let sx = bx + 6;
    const sy2 = by + bh - 17;
    const sb = (label, fn) => { const w = label.length * 6 + 10; UI.button(sx, sy2, w, 12, label, fn); sx += w + 4; };
    if (f.setup === 'grant') { sb('ALLOW ACCESS', () => grantFolder()); sb('OTHER FOLDER', () => pickFolder()); }
    else sb('CHOOSE FOLDER', () => pickFolder());
    sb('SYSTEM DIALOG', () => { state.files = null; pickFile('.xm,.s3m,.it,.mod,.wav,.mp3,.ogg,.flac,audio/*', handleFile); });
    sb('CLOSE', () => { state.files = null; });
    return;
  }
  const maxc = Math.floor((bw - 20) / 6);
  let path = f.path.map(p => p.name).join('/');
  if (path.length > maxc) path = '...' + path.slice(path.length - maxc + 3);
  UI.text(path, bx + 8, by + 24, COL.fx);
  const ly = by + 38, rowsVis = Math.max(1, Math.floor((bh - 38 - 24) / ROWH));
  if (f.sel < f.scroll) f.scroll = f.sel;
  if (f.sel >= f.scroll + rowsVis) f.scroll = f.sel - rowsVis + 1;
  f.scroll = clamp(f.scroll, 0, Math.max(0, f.entries.length - rowsVis));
  UI.inset(bx + 6, ly - 2, bw - 12, rowsVis * ROWH + 3);
  for (let r = 0; r < rowsVis; r++) {
    const i = f.scroll + r;
    if (i >= f.entries.length) break;
    const e = f.entries[i], y = ly + r * ROWH;
    if (i === f.sel) UI.rect(bx + 7, y - 1, bw - 14, ROWH, COL.play);
    const label = e.kind === 'file' ? e.name : '[' + e.name + ']';
    UI.text(label.slice(0, Math.floor((bw - 24) / 6)), bx + 10, y, e.kind === 'file' ? COL.bright : COL.fx);
  }
  if (f.busy) UI.text('READING...', bx + 12, ly + 2, COL.dim);
  else if (f.err) UI.text(f.err, bx + 12, ly + 2, COL.hot);
  else if (!f.entries.length) UI.text('NO SUPPORTED FILES HERE', bx + 12, ly + 2, COL.dim);
  UI.hit(bx + 6, ly - 2, bw - 12, rowsVis * ROWH + 3, {
    onDown: (e, rx, ry) => clickEntry(f.scroll + clamp(Math.floor((ry - 2) / ROWH), 0, rowsVis - 1)),
    onWheel: dy => { f.scroll = clamp(f.scroll + (dy > 0 ? 3 : -3), 0, Math.max(0, f.entries.length - rowsVis)); }
  });
  UI.text('DOUBLE CLICK / ENTER: OPEN - BKSP: UP - XM S3M IT MOD WAV MP3 OGG FLAC', bx + 8, by + bh - 36, COL.dim);
  let x = bx + 6;
  const by2 = by + bh - 17;
  const bt = (label, fn) => { const w = label.length * 6 + 10; UI.button(x, by2, w, 12, label, fn); x += w + 4; };
  bt('OPEN', () => openEntry(f.entries[f.sel]));
  bt('UP', () => { if (f.path.length > 1 && !f.busy) { f.path.pop(); listDir(); } });
  bt('CHANGE FOLDER', async () => { const h = await chooseSampleFolder(); if (h) await showFileBrowser(h); });
  bt('SYSTEM DIALOG', () => { state.files = null; pickFile('.xm,.s3m,.it,.mod,.wav,.mp3,.ogg,.flac,audio/*', handleFile); });
  bt('CLOSE', () => { state.files = null; });
}

// ---- help ----
function drawHelp() {
  const W = UI.W, H = UI.H, ctx = UI.ctx;
  ctx.globalAlpha = 0.8; UI.rect(0, 0, W, H, '#000'); ctx.globalAlpha = 1;
  const bx = 14, by = 8, bw = W - 28, bh = H - 16;
  UI.panel(bx, by, bw, bh);
  UI.icicles(bx + 2, by + 2, bw - 4, 9);
  UI.text('WINTERTRACKER HELP - CLICK OR PRESS ESC TO CLOSE', bx + 8, by + 14, COL.bright);
  UI.text('EFFECT COLUMN (COMMAND + 2 HEX DIGITS)', bx + 8, by + 26, COL.fx);
  FX_LIST.forEach((f, i) => {
    const y = by + 38 + i * 8;
    UI.text(f[0] + f[1], bx + 8, y, COL.fx);
    UI.text(f[2], bx + 36, y, COL.text);
  });
  const kx = bx + Math.min(bw / 2, 330);
  UI.text('KEYS', kx, by + 26, COL.fx);
  const keys = [
    ['Z-M / Q-P', 'PIANO KEYS (2 OCTAVES)'], ['1', 'NOTE OFF'], ['ARROWS', 'MOVE CURSOR'],
    ['TAB', 'NEXT TRACK'], ['PGUP PGDN', '16 ROWS'], ['0-9 A-F', 'ENTER HEX VALUES'],
    ['A-Z', 'EFFECT COMMAND (IN FX FIELD)'], ['SPACE', 'PLAY / STOP SONG'], ['ENTER', 'PLAY / STOP PATTERN'],
    ['F6 F8', 'PLAY PATTERN / STOP'], ['DEL', 'CLEAR FIELD (SHIFT: CELL)'],
    ['INS', 'INSERT CELL'], ['BKSP', 'DELETE CELL ABOVE'], ['CTRL+LEFT/RIGHT', 'PREV / NEXT ORDER'],
    ['CTRL+UP/DOWN', 'PREV / NEXT SAMPLE'], ['NUM / NUM *', 'OCTAVE DOWN / UP'], ['[ ]', 'PREV / NEXT SAMPLE'], ['SHIFT+ARROWS', 'SELECT CELLS'], ['CTRL+C X V', 'COPY / CUT / PASTE'], ['F2 F3', 'PATTERN / SAMPLES TAB'], ['CLICK HEADER', 'MUTE TRACK'],
    ['RIGHT CLICK', 'SOLO TRACK'], ['SHIFT+WHEEL', 'SCROLL TRACKS'], ['DROP FILE', 'LOAD SAMPLE / MODULE / SONG']
  ];
  keys.forEach((k, i) => {
    const y = by + 38 + i * 8;
    UI.text(k[0], kx, y, COL.note);
    UI.text(k[1], kx + 96, y, COL.text);
  });
  UI.text('VOLUME COLUMN: 00-40. NOTES OF TONE PORTAMENTO (3XX) DO NOT RETRIGGER.', bx + 8, by + bh - 24, COL.dim);
  UI.text('TRACK EFFECTS (H-O) STAY ACTIVE UNTIL CHANGED OR RESET WITH Z00.', bx + 8, by + bh - 14, COL.dim);
  UI.hit(0, 0, W, H, { onDown: () => { state.help = false; } });
}

function drawToast() {
  const t = state.toast;
  if (!t) return;
  const now = performance.now();
  if (now > t.until) { state.toast = null; return; }
  // short fade-in, longer fade-out
  const alpha = Math.min(1, (now - t.start) / 150, (t.until - now) / 500);
  const w = t.msg.length * 6 + 16, x = (UI.W - w) / 2, y = UI.H - 30;
  UI.ctx.globalAlpha = Math.max(0, alpha);
  UI.panel(x, y, w, 16, COL.panel2);
  UI.text(t.msg, UI.W / 2, y + 5, COL.bright, 1, 'center');
  UI.ctx.globalAlpha = 1;
}

boot();
