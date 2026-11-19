'use strict';
// WinterTracker playback engine: sequencer, sample mixer and per-channel effect chain.
// The engine renders in segments (one segment = up to one tick) channel by channel.

const VOICE_GAIN = 0.5;
const RAMP = 64;                // declick ramp length in frames
const RING = 2048;              // scope ring buffer size

// Fast tanh approximation (soft clipper).
function ftanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function newVoice() {
  return { active: false, smp: null, pos: 0, step: 0, dir: 1, g: 0, gt: 0 };
}

// Mixes one voice into out[0..n) (additive). Handles looping and a linear gain ramp.
function renderVoice(v, out, n) {
  const s = v.smp;
  if (!s || !v.active) return;
  const d = s.data, len = d.length;
  const lt = s.loopType, ls = s.loopStart, le = Math.min(s.loopEnd, len);
  const loop = lt > 0 && le - ls >= 2;
  const ping = lt === 2;
  let pos = v.pos, step = v.step, dir = v.dir, g = v.g;
  const gt = v.gt;
  let dg = (gt - g) / RAMP;
  for (let i = 0; i < n; i++) {
    const ip = pos | 0, f = pos - ip, a = d[ip];
    let b;
    if (loop) {
      if (dir > 0) b = (ip + 1 >= le) ? (ping ? a : d[ls]) : d[ip + 1];
      else b = ip + 1 < len ? d[ip + 1] : a;
    } else b = ip + 1 < len ? d[ip + 1] : 0;
    if (dg !== 0) {
      g += dg;
      if ((dg > 0 && g >= gt) || (dg < 0 && g <= gt)) { g = gt; dg = 0; }
    }
    out[i] += (a + (b - a) * f) * g;
    pos += step * dir;
    if (loop) {
      if (dir > 0) {
        if (pos >= le) {
          if (ping) { pos = 2 * le - pos; dir = -1; if (pos < ls) pos = ls; }
          else pos = ls + (pos - ls) % (le - ls);
        }
      } else if (pos < ls) {
        pos = 2 * ls - pos; dir = 1;
        if (pos >= le) pos = le - 0.001;
      }
    } else if (pos >= len) { v.active = false; break; }
  }
  v.pos = pos; v.dir = dir; v.g = g;
  if (gt === 0 && g <= 0) v.active = false;
}

class Channel {
  constructor(sr, idx) {
    this.sr = sr; this.idx = idx;
    this.mute = false; this.solo = false;
    this.v = newVoice(); this.ghost = newVoice();
    this.ring = new Float32Array(RING); this.rpos = 0;
    this.peak = 0;
    this.gl = 0; this.gr = 0; this.tl = 0; this.tr = 0;
    // lazily allocated effect buffers
    this.dBuf = null; this.cBuf = null; this.fBuf = null;
    this.reset();
  }

  reset() {
    this.smp = null; this.pitch = 49; this.target = 49; this.note = 49;
    this.vol = 64; this.pan = (this.idx & 3) === 0 || (this.idx & 3) === 3 ? 0x50 : 0xB0;
    this.released = false;
    this.cmd = 0; this.par = 0;
    this.arpOff = 0; this.vibOff = 0; this.tremOff = 0;
    this.slideMem = 0; this.portaMem = 0; this.volMem = 0;
    this.vibSpd = 0; this.vibDep = 0; this.vibPos = 0;
    this.tremSpd = 0; this.tremDep = 0; this.tremPos = 0;
    this.cutTick = -1; this.delayTick = -1; this.pending = 0; this.retMem = 0;
    this.v.active = false; this.ghost.active = false;
    this.resetFx();
  }

  resetFx() {
    this.fOn = false; this.fMode = 0; this.fTgt = 0; this.fCur = 0; this.fRes = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0;
    this.dlyX = 0; this.dlyY = 0; this.dlyOn = false; this.dw = 0; this.dIn = 0;
    this.chD = 0; this.chR = 0; this.chPh = 0;
    this.flD = 0; this.flR = 0; this.flPh = 0;
    this.dist = 0; this.crBits = 0; this.crDiv = 0; this.crHold = 0; this.crCnt = 0;
    if (this.dBuf) this.dBuf.fill(0);
    if (this.cBuf) this.cBuf.fill(0);
    if (this.fBuf) this.fBuf.fill(0);
    this.dPos = 0; this.cPos = 0; this.fPos = 0;
  }

  // Recompute biquad coefficients from the (smoothed) cutoff parameter.
  updateFilter() {
    this.fCur += (this.fTgt - this.fCur) * 0.5;
    const c = Math.max(1, this.fCur);
    const f = Math.min(this.sr * 0.45, 40 * Math.pow(2, (c / 255) * 9));
    const q = 0.6 + Math.pow(this.fRes / 255, 2) * 11;
    const w0 = 2 * Math.PI * f / this.sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * q);
    let b0, b1, b2;
    if (this.fMode === 0) { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (this.fMode === 1) { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
  }

  // Runs the effect chain in place over buf[0..n).
  runFx(buf, n) {
    const sr = this.sr;
    // bitcrusher
    if (this.crBits || this.crDiv) {
      const lv = this.crBits ? Math.pow(2, Math.max(1, 16 - this.crBits) - 1) : 0;
      const div = 1 + this.crDiv;
      let hold = this.crHold, cnt = this.crCnt;
      for (let i = 0; i < n; i++) {
        if (cnt <= 0) { hold = lv ? Math.round(buf[i] * lv) / lv : buf[i]; cnt = div; }
        cnt--; buf[i] = hold;
      }
      this.crHold = hold; this.crCnt = cnt;
    }
    // distortion
    if (this.dist) {
      const g = 1 + this.dist * 0.12, comp = 0.8 / (1 + this.dist / 255 * 0.8);
      for (let i = 0; i < n; i++) buf[i] = ftanh(buf[i] * g) * comp;
    }
    // resonant filter
    if (this.fOn) {
      const b0 = this.b0, b1 = this.b1, b2 = this.b2, a1 = this.a1, a2 = this.a2;
      let z1 = this.z1, z2 = this.z2;
      for (let i = 0; i < n; i++) {
        const x = buf[i], y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2; z2 = b2 * x - a2 * y;
        buf[i] = y;
      }
      if (!(Math.abs(z1) < 1e6)) { z1 = 0; z2 = 0; }   // guard against blow-ups
      this.z1 = z1; this.z2 = z2;
    }
    // chorus (two modulated taps)
    if (this.chD > 0) {
      if (!this.cBuf) this.cBuf = new Float32Array(4096);
      const cb = this.cBuf, mask = 4095;
      const depth = this.chD / 15 * 0.006 * sr, base = 0.014 * sr;
      const inc = (0.15 + this.chR * 0.35) / sr;
      let ph = this.chPh, w = this.cPos;
      for (let i = 0; i < n; i++) {
        const x = buf[i];
        cb[w & mask] = x;
        const d1 = base + depth * Math.sin(6.2831853 * ph), d2 = base + depth * Math.sin(6.2831853 * (ph + 0.5));
        let r1 = w - d1, r2 = w - d2;
        let i1 = Math.floor(r1), i2 = Math.floor(r2);
        const f1 = r1 - i1, f2 = r2 - i2;
        const t1 = cb[i1 & mask] * (1 - f1) + cb[(i1 + 1) & mask] * f1;
        const t2 = cb[i2 & mask] * (1 - f2) + cb[(i2 + 1) & mask] * f2;
        buf[i] = x * 0.55 + (t1 + t2) * 0.4;
        w++; ph += inc; if (ph >= 1) ph -= 1;
      }
      this.chPh = ph; this.cPos = w & mask;
    }
    // flanger
    if (this.flD > 0) {
      if (!this.fBuf) this.fBuf = new Float32Array(2048);
      const fb = this.fBuf, mask = 2047;
      const depth = this.flD / 15 * 0.004 * sr, base = 0.0008 * sr;
      const inc = (0.1 + this.flR * 0.25) / sr;
      let ph = this.flPh, w = this.fPos;
      for (let i = 0; i < n; i++) {
        const x = buf[i];
        const d = base + depth * (0.5 + 0.5 * Math.sin(6.2831853 * ph));
        const r = w - d, ri = Math.floor(r), f = r - ri;
        const t = fb[ri & mask] * (1 - f) + fb[(ri + 1) & mask] * f;
        fb[w & mask] = x + t * 0.55;
        buf[i] = (x + t) * 0.6;
        w++; ph += inc; if (ph >= 1) ph -= 1;
      }
      this.flPh = ph; this.fPos = w & mask;
    }
    // echo / delay
    if (this.dlyOn) {
      const size = Math.floor(sr * 1.0) + 8;
      if (!this.dBuf || this.dBuf.length !== size) this.dBuf = new Float32Array(size);
      const db = this.dBuf;
      const t = Math.max(1, Math.min(size - 2, Math.floor(this.dlyY * 0.05 * sr)));
      const wet = this.dw, fbk = 0.15 + wet * 0.45, din = this.dIn;
      let w = this.dPos;
      for (let i = 0; i < n; i++) {
        let r = w - t; if (r < 0) r += size;
        const e = db[r], x = buf[i];
        db[w] = x * din + e * fbk;
        buf[i] = x + e * wet;
        if (++w >= size) w = 0;
      }
      this.dPos = w;
    }
  }
}

class Engine {
  constructor(song, sr) {
    this.song = song; this.sr = sr;
    this.playing = false; this.mode = 'song';
    this.ord = 0; this.row = 0; this.tick = 0;
    this.bpm = song.bpm; this.speed = song.speed;
    this.tickLeft = 0; this.loops = 0;
    this.jumpOrd = -1; this.breakRow = -1;
    this.master = 0.8;
    this.ch = [];
    for (let i = 0; i <= MAX_CH; i++) this.ch.push(new Channel(sr, i));   // last one = preview voice
    this.pv = this.ch[MAX_CH];
    this.tmp = new Float32Array(16384);
    this.mring = new Float32Array(RING); this.mpos = 0;
    this.pkL = 0; this.pkR = 0;
    this.anySolo = false;
  }

  // ---- transport ----
  play(mode, ord, row) {
    const sg = this.song;
    // silence everything that was sounding: tracker voices, fade-outs, effect tails and the preview voice
    for (let i = 0; i <= MAX_CH; i++) { const c = this.ch[i]; c.reset(); c.gl = 0; c.gr = 0; }
    this.mode = mode;
    this.ord = Math.min(ord, sg.orders.length - 1);
    this.row = row || 0;
    this.tick = 0; this.bpm = sg.bpm; this.speed = sg.speed;
    this.tickLeft = 0; this.loops = 0;
    this.jumpOrd = -1; this.breakRow = -1;
    this.playing = true;
  }

  stop() {
    this.playing = false;
    for (let i = 0; i < MAX_CH; i++) { const c = this.ch[i]; c.v.gt = 0; c.released = true; }
  }

  // Jump while playing (used by the order controls).
  jump(ord, row) {
    this.ord = ord; this.row = row; this.tick = 0; this.tickLeft = 0;
  }

  // Plays a sample on the dedicated preview voice.
  preview(s, note) {
    if (!s || !s.data.length) return;
    const c = this.pv;
    if (c.v.active) { const t = c.ghost; c.ghost = c.v; c.v = t; c.ghost.gt = 0; }
    const v = c.v;
    v.active = true; v.smp = s; v.pos = 0; v.dir = 1; v.g = 0;
    v.step = s.rate / this.sr * Math.pow(2, (note - s.base + s.fine / 128) / 12);
    v.gt = s.vol / 64;
    c.tl = c.tr = VOICE_GAIN * 0.707;
    c.previewStarted = true;
  }

  previewStop() { this.pv.v.gt = 0; }

  isAudible(c) {
    return this.anySolo ? c.solo : !c.mute;
  }

  // ---- sequencer ----
  pattern() {
    return this.song.patterns[this.song.orders[this.ord]];
  }

  doTick() {
    const sg = this.song;
    const nch = Math.min(sg.channels, MAX_CH);
    this.anySolo = false;
    for (let i = 0; i < MAX_CH; i++) if (this.ch[i].solo) this.anySolo = true;
    if (this.tick === 0) this.processRow(nch);
    else for (let i = 0; i < nch; i++) this.tickFx(this.ch[i]);
    for (let i = 0; i < MAX_CH; i++) this.updateCh(this.ch[i]);
    this.tick++;
    if (this.tick >= this.speed) { this.tick = 0; this.advance(); }
  }

  advance() {
    const sg = this.song;
    let ord = this.ord, row = this.row + 1;
    const jump = this.jumpOrd, brk = this.breakRow;
    this.jumpOrd = -1; this.breakRow = -1;
    const pat = this.pattern() || sg.patterns[0];
    if (this.mode === 'pattern') {
      if (brk >= 0) row = brk;
      else if (row >= pat.rows) row = 0;
    } else if (jump >= 0) { ord = jump; row = brk >= 0 ? brk : 0; }
    else if (brk >= 0) { ord++; row = brk; }
    else if (row >= pat.rows) { row = 0; ord++; }
    if (ord >= sg.orders.length) { ord = 0; this.loops++; }
    const np = sg.patterns[sg.orders[ord]];
    if (!np) { ord = 0; row = 0; }
    else if (row >= np.rows) row = 0;
    this.ord = ord; this.row = row;
  }

  processRow(nch) {
    const sg = this.song, pat = this.pattern();
    if (!pat) return;
    const base = this.row * MAX_CH;
    for (let c = 0; c < nch; c++) {
      const i = base + c;
      this.rowCh(this.ch[c], pat.note[i], pat.inst[i], pat.vol[i], pat.fxc[i], pat.fxp[i]);
    }
  }

  trigger(c, note, offset) {
    const s = c.smp;
    if (!s || !s.data.length) return;
    if (c.v.active) { const t = c.ghost; c.ghost = c.v; c.v = t; c.ghost.gt = 0; }
    const v = c.v;
    v.active = true; v.smp = s; v.pos = Math.min(offset || 0, s.data.length - 1); v.dir = 1; v.g = 0;
    c.pitch = note; c.target = note; c.note = note; c.released = false;
    c.vibPos = 0; c.tremPos = 0;
  }

  rowCh(c, note, inst, vol, fxc, fxp) {
    const sg = this.song;
    c.cmd = fxc; c.par = fxp;
    c.arpOff = 0; c.vibOff = 0; c.tremOff = 0;
    c.cutTick = -1; c.delayTick = -1;
    const has = note > 0 && note < NOTE_OFF;
    if (inst > 0 && inst <= MAX_SMP) {
      c.smp = sg.samples[inst - 1];
      c.vol = c.smp.vol;
    }
    if (note === NOTE_OFF) { c.v.gt = 0; c.released = true; }
    if (has) {
      if (fxc === 51) {                                   // tone portamento
        c.target = note;
        if (!c.v.active) this.trigger(c, note, 0);
      } else if (fxc === 71 && fxp > 0) {                 // note delay
        c.pending = note; c.delayTick = fxp;
      } else this.trigger(c, note, fxc === 57 ? fxp * 256 : 0);
    }
    if (vol !== 255) c.vol = Math.min(64, vol);
    const x = fxp >> 4, y = fxp & 15;
    switch (fxc) {
      case 49: if (fxp) c.slideMem = fxp; break;          // 1
      case 50: if (fxp) c.slideMem = fxp; break;          // 2
      case 51: if (fxp) c.portaMem = fxp; break;          // 3
      case 52: if (x) c.vibSpd = x; if (y) c.vibDep = y; break;
      case 55: if (x) c.tremSpd = x; if (y) c.tremDep = y; break;
      case 56: c.pan = fxp; break;                        // 8
      case 65: if (fxp) c.volMem = fxp; break;            // A
      case 66: this.jumpOrd = fxp; break;                 // B
      case 67: c.vol = Math.min(64, fxp); break;          // C
      case 68: this.breakRow = fxp; break;                // D
      case 69: if (fxp === 0) { c.v.gt = 0; c.released = true; } else c.cutTick = fxp; break; // E
      case 70:                                            // F
        if (fxp > 0) { if (fxp < 0x20) this.speed = fxp; else this.bpm = Math.min(255, fxp); }
        break;
      case 72:                                            // H echo
        c.dlyX = x; c.dlyY = y || 4;                      // time 0 falls back to 200 ms
        if (x > 0) { c.dlyOn = true; c.dw = 0.9 * Math.sqrt(x / 15); c.dIn = 1; }
        else c.dIn = 0;
        break;
      case 73:                                            // I cutoff
        if (fxp === 0) c.fOn = false;
        else { if (!c.fOn) c.fCur = fxp; c.fOn = true; c.fTgt = fxp; }
        break;
      case 74: c.fRes = fxp; break;                       // J
      case 75: c.fMode = fxp % 3; break;                  // K
      case 76: c.chD = x; c.chR = y; break;               // L
      case 77: c.flD = x; c.flR = y; break;               // M
      case 78: c.dist = fxp; break;                       // N
      case 79: c.crBits = x; c.crDiv = y; break;          // O
      case 82: if (fxp) c.retMem = fxp; break;            // R
      case 90: c.resetFx(); break;                        // Z
    }
  }

  tickFx(c) {
    const t = this.tick, par = c.par, x = par >> 4, y = par & 15;
    switch (c.cmd) {
      case 48: if (par) c.arpOff = t % 3 === 0 ? 0 : (t % 3 === 1 ? x : y); break;
      case 49: c.pitch = Math.min(119, c.pitch + c.slideMem / 64); break;
      case 50: c.pitch = Math.max(0, c.pitch - c.slideMem / 64); break;
      case 51: {
        const d = c.portaMem / 64;
        if (c.pitch < c.target) c.pitch = Math.min(c.target, c.pitch + d);
        else if (c.pitch > c.target) c.pitch = Math.max(c.target, c.pitch - d);
        break;
      }
      case 52:
        c.vibPos = (c.vibPos + c.vibSpd) & 63;
        c.vibOff = Math.sin(c.vibPos / 64 * 6.2831853) * c.vibDep * 0.06;
        break;
      case 55:
        c.tremPos = (c.tremPos + c.tremSpd) & 63;
        c.tremOff = Math.sin(c.tremPos / 64 * 6.2831853) * c.tremDep * 4;
        break;
      case 65: {
        const m = c.volMem, ux = m >> 4, uy = m & 15;
        c.vol = Math.max(0, Math.min(64, c.vol + (ux ? ux : -uy)));
        break;
      }
      case 69: if (t === c.cutTick) { c.v.gt = 0; c.released = true; } break;
      case 71: if (t === c.delayTick && c.pending) { this.trigger(c, c.pending, 0); c.pending = 0; } break;
      case 82: {
        const n = c.retMem || par;
        if (n > 0 && t % n === 0 && c.note) this.trigger(c, c.note, 0);
        break;
      }
    }
  }

  // Recompute per-tick voice parameters (pitch, gain, pan, filter).
  updateCh(c) {
    const aud = this.isAudible(c);
    const v = c.v;
    if (v.active && v.smp) {
      const s = v.smp, eff = c.pitch + c.arpOff + c.vibOff;
      v.step = s.rate / this.sr * Math.pow(2, (eff - s.base + s.fine / 128) / 12);
      const vol = Math.max(0, Math.min(64, c.vol + c.tremOff));
      v.gt = (aud && !c.released) ? vol / 64 : 0;
    }
    const p = c.pan / 255 * Math.PI / 2, m = aud ? VOICE_GAIN : 0;
    c.tl = m * Math.cos(p); c.tr = m * Math.sin(p);
    if (c.fOn) c.updateFilter();
  }

  // ---- rendering ----
  renderSeg(L, R, off, n) {
    const tmp = this.tmp;
    for (let ci = 0; ci <= MAX_CH; ci++) {
      const c = this.ch[ci];
      const fxActive = c.fOn || c.chD > 0 || c.flD > 0 || c.dlyOn || c.dist || c.crBits || c.crDiv;
      if (!c.v.active && !c.ghost.active && !fxActive) {
        c.gl = c.tl; c.gr = c.tr;
        continue;
      }
      tmp.fill(0, 0, n);
      renderVoice(c.v, tmp, n);
      renderVoice(c.ghost, tmp, n);
      if (fxActive && ci < MAX_CH) c.runFx(tmp, n);
      // scope ring + peak
      const ring = c.ring; let rp = c.rpos, pk = 0;
      for (let i = 0; i < n; i++) {
        const x = tmp[i]; ring[rp] = x; rp = (rp + 1) & (RING - 1);
        const a = x < 0 ? -x : x; if (a > pk) pk = a;
      }
      c.rpos = rp; if (pk > c.peak) c.peak = pk;
      // pan/volume mix with a gain ramp
      let gl = c.gl, gr = c.gr;
      const dl = (c.tl - gl) / n, dr = (c.tr - gr) / n;
      for (let i = 0; i < n; i++) {
        gl += dl; gr += dr;
        L[off + i] += tmp[i] * gl; R[off + i] += tmp[i] * gr;
      }
      c.gl = c.tl; c.gr = c.tr;
    }
  }

  process(L, R, n) {
    let off = 0;
    L.fill(0, 0, n); R.fill(0, 0, n);
    while (off < n) {
      let seg = n - off;
      if (this.playing) {
        if (this.tickLeft <= 0) {
          this.doTick();
          this.tickLeft += this.sr * 2.5 / Math.max(32, this.bpm);
        }
        seg = Math.min(seg, Math.max(1, Math.ceil(this.tickLeft)), 16384);
        this.tickLeft -= seg;
      } else seg = Math.min(seg, 16384);
      this.renderSeg(L, R, off, seg);
      off += seg;
    }
    const m = this.master, mr = this.mring;
    let mp = this.mpos, pl = 0, pr = 0;
    for (let i = 0; i < n; i++) {
      const l = ftanh(L[i] * m), r = ftanh(R[i] * m);
      L[i] = l; R[i] = r;
      mr[mp] = (l + r) * 0.5; mp = (mp + 1) & (RING - 1);
      const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
      if (al > pl) pl = al; if (ar > pr) pr = ar;
    }
    this.mpos = mp;
    if (pl > this.pkL) this.pkL = pl;
    if (pr > this.pkR) this.pkR = pr;
  }
}

// Renders the whole song once to a 16-bit stereo WAV (chunked, async so the UI stays alive).
function renderSongToWav(song, sr, onProgress) {
  return new Promise(resolve => {
    const eng = new Engine(song, sr);
    eng.play('song', 0, 0);
    const chunks = []; let total = 0, tail = -1;
    const L = new Float32Array(4096), R = new Float32Array(4096);
    const maxFrames = sr * 60 * 12;
    const step = () => {
      const t0 = performance.now();
      while (performance.now() - t0 < 40) {
        eng.process(L, R, 4096);
        const i16 = new Int16Array(8192);
        for (let i = 0; i < 4096; i++) {
          i16[2 * i] = Math.round(L[i] * 32767); i16[2 * i + 1] = Math.round(R[i] * 32767);
        }
        chunks.push(i16); total += 4096;
        if (eng.loops > 0 && tail < 0) { tail = 0; eng.playing = false; }
        if (tail >= 0) tail += 4096;
        if ((tail >= 0 && tail > sr * 2) || total > maxFrames) {
          const data = new Int16Array(total * 2); let o = 0;
          for (const ch of chunks) { data.set(ch, o); o += ch.length; }
          const hdr = new DataView(new ArrayBuffer(44));
          const w = (o, s) => { for (let i = 0; i < s.length; i++) hdr.setUint8(o + i, s.charCodeAt(i)); };
          w(0, 'RIFF'); hdr.setUint32(4, 36 + data.length * 2, true); w(8, 'WAVEfmt ');
          hdr.setUint32(16, 16, true); hdr.setUint16(20, 1, true); hdr.setUint16(22, 2, true);
          hdr.setUint32(24, sr, true); hdr.setUint32(28, sr * 4, true); hdr.setUint16(32, 4, true);
          hdr.setUint16(34, 16, true); w(36, 'data'); hdr.setUint32(40, data.length * 2, true);
          resolve(new Blob([hdr, data], { type: 'audio/wav' }));
          return;
        }
      }
      if (onProgress) onProgress(eng.ord, song.orders.length);
      setTimeout(step, 0);
    };
    step();
  });
}

if (typeof module !== 'undefined') module.exports = { Engine, renderSongToWav };
