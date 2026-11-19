'use strict';
// Song data model: samples, patterns, orders; JSON save/load and a procedural demo song.

const MAX_CH = 32;          // maximum number of tracker channels
const MAX_SMP = 64;         // number of sample slots
const NOTE_OFF = 97;        // note value used for "key off"
const MAX_ROWS = 128;       // maximum rows per pattern
const MAX_ORDERS = 128;

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

// Effect reference (also used by the help screen). [letter, parameter, description]
const FX_LIST = [
  ['0', 'XY', 'ARPEGGIO: NOTE, +X, +Y SEMITONES'],
  ['1', 'XX', 'SWEEP UP (1/64 SEMITONE PER TICK)'],
  ['2', 'XX', 'SWEEP DOWN'],
  ['3', 'XX', 'TONE PORTAMENTO TO NOTE'],
  ['4', 'XY', 'VIBRATO: X SPEED, Y DEPTH'],
  ['7', 'XY', 'TREMOLO: X SPEED, Y DEPTH'],
  ['8', 'XX', 'PANNING 00 LEFT .. FF RIGHT'],
  ['9', 'XX', 'SAMPLE OFFSET (XX*256 FRAMES)'],
  ['A', 'XY', 'VOLUME SLIDE: X UP, Y DOWN'],
  ['B', 'XX', 'JUMP TO ORDER XX'],
  ['C', 'XX', 'SET VOLUME 00-40'],
  ['D', 'XX', 'PATTERN BREAK TO ROW XX'],
  ['E', 'XX', 'NOTE CUT AT TICK XX'],
  ['F', 'XX', 'SPEED (<20) OR BPM (>=20)'],
  ['G', 'XX', 'NOTE DELAY: START XX TICKS LATE (< SPEED)'],
  ['H', 'XY', 'DELAY (ECHO): X LEVEL 1-F, Y TIME*50MS (0=200MS)'],
  ['I', 'XX', 'FILTER CUTOFF (00 = OFF)'],
  ['J', 'XX', 'FILTER RESONANCE'],
  ['K', 'XX', 'FILTER 0 LOW 1 HIGH 2 BAND'],
  ['L', 'XY', 'CHORUS: X DEPTH, Y RATE'],
  ['M', 'XY', 'FLANGER: X DEPTH, Y RATE'],
  ['N', 'XX', 'DISTORTION DRIVE (00 = OFF)'],
  ['O', 'XY', 'BITCRUSH: X BITS LOST, Y RATE DIV'],
  ['R', 'XX', 'RETRIGGER EVERY XX TICKS'],
  ['Z', '00', 'RESET ALL TRACK EFFECTS']
];

function newSample(name) {
  return {
    name: name || '', data: new Float32Array(0), rate: 8363, base: 49, vol: 64, fine: 0,
    loopType: 0, loopStart: 0, loopEnd: 0, rev: 0
  };
}

function newPattern(rows) {
  rows = rows || 64;
  const n = rows * MAX_CH;
  return {
    rows, note: new Uint8Array(n), inst: new Uint8Array(n), vol: new Uint8Array(n).fill(255),
    fxc: new Uint8Array(n), fxp: new Uint8Array(n)
  };
}

function resizePattern(p, rows) {
  const q = newPattern(rows);
  const n = Math.min(rows, p.rows) * MAX_CH;
  for (const k of ['note', 'inst', 'vol', 'fxc', 'fxp']) q[k].set(p[k].subarray(0, n));
  return q;
}

function clonePattern(p) {
  const q = newPattern(p.rows);
  for (const k of ['note', 'inst', 'vol', 'fxc', 'fxp']) q[k].set(p[k]);
  return q;
}

function newSong() {
  const samples = [];
  for (let i = 0; i < MAX_SMP; i++) samples.push(newSample(''));
  return { title: 'UNTITLED', bpm: 125, speed: 6, channels: 8, orders: [0], patterns: [newPattern(64)], samples };
}

// "C-4" style text for a note number (1..96); 97 is key-off.
function noteName(n) {
  if (n === 0) return '...';
  if (n === NOTE_OFF) return '===';
  const k = n - 1;
  return NOTE_NAMES[k % 12] + Math.floor(k / 12);
}

function noteFromName(s) {
  const m = /^([A-G])([#-]?)(\d)$/.exec(s);
  if (!m) return 0;
  const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === '#' ? 1 : 0);
  return Number(m[3]) * 12 + semi + 1;
}

// ---- base64 helpers for JSON persistence ----
function b64enc(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function b64dec(str) {
  const s = atob(str), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

function songToJSON(song) {
  return JSON.stringify({
    format: 'wintertracker', version: 1, title: song.title, bpm: song.bpm, speed: song.speed,
    channels: song.channels, orders: song.orders,
    patterns: song.patterns.map(p => ({
      rows: p.rows, note: b64enc(p.note), inst: b64enc(p.inst), vol: b64enc(p.vol),
      fxc: b64enc(p.fxc), fxp: b64enc(p.fxp)
    })),
    samples: song.samples.map(s => {
      const i16 = new Int16Array(s.data.length);
      for (let i = 0; i < i16.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(s.data[i] * 32767)));
      return {
        name: s.name, rate: s.rate, base: s.base, vol: s.vol, fine: s.fine, loopType: s.loopType,
        loopStart: s.loopStart, loopEnd: s.loopEnd, data: b64enc(new Uint8Array(i16.buffer))
      };
    })
  });
}

function songFromJSON(text) {
  const j = JSON.parse(text);
  if (j.format !== 'wintertracker') throw new Error('Not a WinterTracker song');
  const song = newSong();
  song.title = String(j.title || '').slice(0, 32);
  song.bpm = j.bpm | 0 || 125;
  song.speed = j.speed | 0 || 6;
  song.channels = Math.max(1, Math.min(MAX_CH, j.channels | 0 || 8));
  song.orders = j.orders.slice(0, MAX_ORDERS);
  song.patterns = j.patterns.map(q => {
    const p = newPattern(q.rows);
    for (const k of ['note', 'inst', 'vol', 'fxc', 'fxp']) p[k].set(b64dec(q[k]).subarray(0, p[k].length));
    return p;
  });
  j.samples.slice(0, MAX_SMP).forEach((q, i) => {
    const s = song.samples[i];
    s.name = q.name; s.rate = q.rate; s.base = q.base; s.vol = q.vol; s.fine = q.fine;
    s.loopType = q.loopType; s.loopStart = q.loopStart; s.loopEnd = q.loopEnd;
    const u8 = b64dec(q.data), i16 = new Int16Array(u8.buffer, 0, u8.length >> 1);
    s.data = new Float32Array(i16.length);
    for (let k = 0; k < i16.length; k++) s.data[k] = i16[k] / 32767;
  });
  if (!song.orders.length) song.orders = [0];
  return song;
}

// ---- procedural demo song ----
function makeDemoSamples(song) {
  const R = 22050;
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1; };
  const put = (idx, name, data, rate, loop) => {
    const s = song.samples[idx];
    s.name = name; s.data = data; s.rate = rate; s.base = 49;
    if (loop) { s.loopType = 1; s.loopStart = 0; s.loopEnd = data.length; }
  };
  // 1: kick (sine sweep)
  let n = Math.floor(R * 0.32), d = new Float32Array(n), ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / R, f = 40 + 140 * Math.exp(-t * 22);
    ph += 2 * Math.PI * f / R;
    d[i] = Math.sin(ph) * Math.exp(-t * 7) * 0.95;
  }
  put(0, 'ICE KICK', d, R);
  // 2: snare (noise + tone)
  n = Math.floor(R * 0.25); d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    d[i] = (rnd() * Math.exp(-t * 16) * 0.7 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 28) * 0.5);
  }
  put(1, 'FROST SNARE', d, R);
  // 3: hat (differentiated noise)
  n = Math.floor(R * 0.09); d = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const r = rnd(); d[i] = (r - prev) * 0.5 * Math.exp(-(i / R) * 55); prev = r;
  }
  put(2, 'SNOW HAT', d, R);
  // single-cycle waveforms: 128 frames at rate 128*261.63 so C-4 plays at 261.63 Hz
  const CYC = 128, CR = CYC * 261.63;
  d = new Float32Array(CYC);
  for (let i = 0; i < CYC; i++) { let v = 0; for (let h = 1; h <= 12; h++) v += Math.sin(2 * Math.PI * h * i / CYC) / h; d[i] = v * 0.55; }
  put(3, 'SAW BASS', d, CR, true);
  d = new Float32Array(CYC);
  for (let i = 0; i < CYC; i++) d[i] = (i < CYC * 0.25 ? 1 : -1) * 0.5;
  put(4, 'PULSE LEAD', d, CR, true);
  d = new Float32Array(CYC);
  for (let i = 0; i < CYC; i++) d[i] = (Math.sin(2 * Math.PI * i / CYC) + 0.35 * Math.sin(4 * Math.PI * i / CYC) + 0.2 * Math.sin(6 * Math.PI * i / CYC)) * 0.5;
  put(5, 'SOFT PAD', d, CR, true);
  d = new Float32Array(CYC);
  for (let i = 0; i < CYC; i++) d[i] = (i < CYC / 2 ? i / (CYC / 4) - 1 : 3 - i / (CYC / 4)) * 0.6;
  put(6, 'TRIANGLE', d, CR, true);
}

// Startup song: one empty pattern, only the generated demo samples are loaded.
function makeInitialSong() {
  const song = newSong();
  makeDemoSamples(song);
  return song;
}

function makeDemoSong() {
  const song = newSong();
  song.title = 'FROZEN DEMO';
  song.channels = 8;
  makeDemoSamples(song);
  const set = (p, row, ch, note, inst, vol, fx) => {
    const i = row * MAX_CH + ch;
    if (note) p.note[i] = typeof note === 'string' ? (note === '===' ? NOTE_OFF : noteFromName(note)) : note;
    if (inst) p.inst[i] = inst;
    if (vol !== undefined && vol !== null) p.vol[i] = vol;
    if (fx) { p.fxc[i] = fx.charCodeAt(0); p.fxp[i] = parseInt(fx.slice(1), 16); }
  };
  const roots = ['A-2', 'F-2', 'C-3', 'G-2'];
  const leadN = ['A-4', 'F-4', 'C-5', 'G-4'];
  const leadF = ['037', '047', '047', '047'];
  const padN = ['C-5', 'A-4', 'E-5', 'B-4'];
  const melody = [
    [[0, 'E-5'], [3, 'D-5'], [6, 'C-5'], [8, 'D-5'], [10, 'E-5']],
    [[0, 'F-5'], [3, 'E-5'], [6, 'C-5'], [10, 'A-4']],
    [[0, 'G-5'], [3, 'E-5'], [6, 'C-5'], [8, 'E-5'], [12, 'G-5']],
    [[0, 'D-5'], [3, 'B-4'], [6, 'D-5'], [10, 'G-5'], [14, '===']]
  ];
  const build = variant => {
    const p = newPattern(64);
    for (let bar = 0; bar < 4; bar++) {
      const r0 = bar * 16;
      for (let b = 0; b < 4; b++) set(p, r0 + b * 4, 0, 'C-4', 1, 64);
      set(p, r0 + 4, 1, 'C-4', 2, 60); set(p, r0 + 12, 1, 'C-4', 2, 60);
      for (let r = 0; r < 16; r += 2) set(p, r0 + r, 2, 'C-4', 3, r % 4 === 0 ? 44 : 22);
      for (const [r, off] of [[0, 0], [3, 0], [6, 12], [8, 0], [11, 0], [14, 12]]) {
        const base = noteFromName(roots[bar]);
        set(p, r0 + r, 3, base + off, 4, 56);
      }
      set(p, r0, 4, leadN[bar], 5, 36, '0' + leadF[bar].slice(1));
      for (const r of [4, 8, 12]) set(p, r0 + r, 4, leadN[bar], 5, 36, 'R03');
      set(p, r0, 5, padN[bar], 6, 40, bar % 2 ? 'A04' : 'A00');
      if (bar === 0) set(p, r0 + 8, 5, null, 0, null, '800');
      if (bar === 1) set(p, r0, 5, padN[bar], 6, 40, '8FF');
      for (const [r, n] of melody[bar]) set(p, r0 + r, 6, n, n === '===' ? 0 : 7, 40);
      set(p, r0 + 14, 7, 'C-5', 1, 48, '210');
    }
    // effects: echo, chorus, flanger, filter
    set(p, 0, 6, null, 0, null, 'H64');
    set(p, 0, 5, null, 0, null, 'L74');
    set(p, 0, 4, null, 0, null, 'M42');
    if (variant === 0) {
      set(p, 0, 3, null, 0, null, 'I60');
      set(p, 32, 3, null, 0, null, 'I30');
      set(p, 8, 3, null, 0, null, 'J60');
    } else {
      for (let r = 0; r < 64; r += 4) set(p, r, 3, null, 0, null, 'I' + (0x20 + r * 3).toString(16).toUpperCase().padStart(2, '0'));
      set(p, 0, 3, null, 0, null, 'J90');
      set(p, 16, 6, null, 0, null, 'N30');
      set(p, 32, 2, null, 0, null, 'O43');
      set(p, 48, 2, null, 0, null, 'O00');
    }
    return p;
  };
  song.patterns = [build(0), build(1)];
  song.orders = [0, 1];
  return song;
}
