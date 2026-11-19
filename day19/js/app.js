'use strict';
// WinterTracker application state, editing operations, file handling and input.

const ROWH = 9;            // pattern row height (logical px)
const CHW = 74;            // channel column width
const GX = 26;             // x of the first channel column
// Pixel offset / width of each editable field inside a channel column:
// 0 note, 1-2 instrument, 3-4 volume, 5 effect command, 6-7 effect parameter
const FIELD_X = [0, 21, 27, 36, 42, 51, 57, 63];
const FIELD_W = [18, 6, 6, 6, 6, 6, 6, 6];

let song = makeInitialSong();
let engine = null;
let audioCtx = null;
let procNode = null;

const state = {
  screen: 'splash', tab: 'pattern',
  ord: 0, row: 0, ch: 0, field: 0, chScroll: 0,
  oct: 4, step: 1, smp: 1, smpScroll: 0,
  zoom: 2, fit: 8,
  browser: null, help: false, toast: null,
  viz: [], pad: null
};

const PIANO = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
  Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28
};

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hex2(v) { return (v < 16 ? '0' : '') + v.toString(16).toUpperCase(); }
function toast(msg, ms) {
  const now = performance.now();
  state.toast = { msg, start: now, until: now + (ms || 2500) };
}

function curPat() { return song.patterns[song.orders[state.ord]] || song.patterns[0]; }
function curSample() { return song.samples[state.smp - 1]; }
function cellIdx() { return state.row * MAX_CH + state.ch; }
function touch(s) { s.rev = (s.rev || 0) + 1; }

// ---- audio ----
function startAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  engine = new Engine(song, audioCtx.sampleRate);
  procNode = audioCtx.createScriptProcessor(2048, 0, 2);
  let failed = false;
  procNode.onaudioprocess = ev => {
    const L = ev.outputBuffer.getChannelData(0), R = ev.outputBuffer.getChannelData(1);
    try { engine.process(L, R, L.length); }
    catch (err) { if (!failed) { console.error(err); failed = true; } L.fill(0); R.fill(0); }
  };
  procNode.connect(audioCtx.destination);
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSong() { engine.play('song', state.ord, 0); }
function playPattern() { engine.play('pattern', state.ord, 0); }
function stopPlay() { engine.stop(); engine.previewStop(); }

function chooseScale() {
  const maxX = Math.max(1, Math.floor(window.innerWidth / 640));
  const maxY = Math.max(1, Math.floor(window.innerHeight / 330));
  return clamp(state.zoom, 1, Math.min(maxX, maxY, 4));
}

function setZoom(d) {
  state.zoom = clamp(state.zoom + d, 1, 4);
  UI.resize(chooseScale());
}

// ---- pattern editing ----
function moveRow(d) {
  const p = curPat();
  state.row = clamp(state.row + d, 0, p.rows - 1);   // stop at first/last row, no wrapping
}

function ensureChVisible() {
  const n = Math.max(1, state.fit);
  if (state.ch < state.chScroll) state.chScroll = state.ch;
  if (state.ch >= state.chScroll + n) state.chScroll = state.ch - n + 1;
  state.chScroll = clamp(state.chScroll, 0, Math.max(0, song.channels - n));
}

function moveField(d) {
  let f = state.field + d, c = state.ch;
  if (f < 0) { if (c > 0) { c--; f = 7; } else f = 0; }
  else if (f > 7) { if (c < song.channels - 1) { c++; f = 0; } else f = 7; }
  state.field = f; state.ch = c; ensureChVisible();
}

function moveChannel(d) {
  state.ch = clamp(state.ch + d, 0, song.channels - 1);
  ensureChVisible();
}

function advanceAfterEntry() {
  if (!engine.playing) moveRow(state.step);
}

function clearCell(p, i) {
  p.note[i] = 0; p.inst[i] = 0; p.vol[i] = 255; p.fxc[i] = 0; p.fxp[i] = 0;
}

function clearField(whole) {
  const p = curPat(), i = cellIdx(), f = state.field;
  if (whole) clearCell(p, i);
  else if (f === 0) { p.note[i] = 0; p.inst[i] = 0; }
  else if (f <= 2) p.inst[i] = 0;
  else if (f <= 4) p.vol[i] = 255;
  else { p.fxc[i] = 0; p.fxp[i] = 0; }
}

// ---- selection / clipboard ----
// Selection = rectangle between the anchor (state.sel) and the cursor, in whole cells.
function selRect() {
  const s = state.sel;
  if (!s) return null;
  return {
    r0: Math.min(s.row, state.row), r1: Math.max(s.row, state.row),
    c0: Math.min(s.ch, state.ch), c1: Math.max(s.ch, state.ch)
  };
}

function clearSelection() {
  const r = selRect(), p = curPat();
  if (!r) return;
  for (let row = r.r0; row <= r.r1; row++) for (let c = r.c0; c <= r.c1; c++) clearCell(p, row * MAX_CH + c);
}

// Copies (or cuts) the selection; without a selection it works on the cursor cell.
function copySel(cut) {
  const r = selRect() || { r0: state.row, r1: state.row, c0: state.ch, c1: state.ch };
  const p = curPat(), rows = r.r1 - r.r0 + 1, chans = r.c1 - r.c0 + 1;
  const clip = { rows, chans, cells: [] };
  for (let rr = 0; rr < rows; rr++) {
    for (let cc = 0; cc < chans; cc++) {
      const i = (r.r0 + rr) * MAX_CH + r.c0 + cc;
      clip.cells.push([p.note[i], p.inst[i], p.vol[i], p.fxc[i], p.fxp[i]]);
      if (cut) clearCell(p, i);
    }
  }
  state.clip = clip;
  state.sel = null;
  toast((cut ? 'CUT ' : 'COPIED ') + rows + 'X' + chans + ' CELLS');
}

// Pastes the clipboard with its top-left corner at the cursor (overwrites, clipped to the pattern).
function pasteClip() {
  const cl = state.clip;
  if (!cl) return toast('CLIPBOARD EMPTY');
  const p = curPat();
  for (let rr = 0; rr < cl.rows; rr++) {
    for (let cc = 0; cc < cl.chans; cc++) {
      const row = state.row + rr, ch = state.ch + cc;
      if (row >= p.rows || ch >= song.channels) continue;
      const v = cl.cells[rr * cl.chans + cc], i = row * MAX_CH + ch;
      p.note[i] = v[0]; p.inst[i] = v[1]; p.vol[i] = v[2]; p.fxc[i] = v[3]; p.fxp[i] = v[4];
    }
  }
  state.sel = null;
  toast('PASTED');
}

function insertCell() {
  const p = curPat(), c = state.ch;
  for (let r = p.rows - 1; r > state.row; r--) copyCell(p, (r - 1) * MAX_CH + c, r * MAX_CH + c);
  clearCell(p, cellIdx());
}

function deleteCellAbove() {
  const p = curPat(), c = state.ch;
  if (state.row === 0) return;
  for (let r = state.row - 1; r < p.rows - 1; r++) copyCell(p, (r + 1) * MAX_CH + c, r * MAX_CH + c);
  clearCell(p, (p.rows - 1) * MAX_CH + c);
  state.row--;
}

function copyCell(p, from, to) {
  p.note[to] = p.note[from]; p.inst[to] = p.inst[from]; p.vol[to] = p.vol[from];
  p.fxc[to] = p.fxc[from]; p.fxp[to] = p.fxp[from];
}

function enterNote(semi) {
  const p = curPat(), i = cellIdx();
  const note = clamp(state.oct * 12 + semi + 1, 1, 96);
  p.note[i] = note;
  if (state.smp > 0) p.inst[i] = state.smp;
  engine.preview(song.samples[(p.inst[i] || state.smp) - 1], note);
  advanceAfterEntry();
}

function typeHex(d) {
  const p = curPat(), i = cellIdx(), f = state.field;
  if (f === 1 || f === 2) {
    const v = p.inst[i];
    p.inst[i] = Math.min(MAX_SMP, f === 1 ? (d << 4) | (v & 15) : (v & 0xF0) | d);
  } else if (f === 3 || f === 4) {
    const v = p.vol[i] === 255 ? 0 : p.vol[i];
    p.vol[i] = Math.min(64, f === 3 ? (d << 4) | (v & 15) : (v & 0xF0) | d);
  } else if (f === 6 || f === 7) {
    if (!p.fxc[i]) p.fxc[i] = 48;
    const v = p.fxp[i];
    p.fxp[i] = f === 6 ? (d << 4) | (v & 15) : (v & 0xF0) | d;
  } else return;
  if (f === 1 || f === 3 || f === 6) state.field = f + 1;
  else { state.field = f - 1; advanceAfterEntry(); }
}

function typeFxCmd(ch) {
  const p = curPat(), i = cellIdx();
  p.fxc[i] = ch.charCodeAt(0);
  state.field = 6;
}

// ---- order / pattern management ----
function setOrder(o) {
  state.ord = clamp(o, 0, song.orders.length - 1);
  state.row = Math.min(state.row, curPat().rows - 1);
  if (engine.playing) engine.jump(state.ord, 0);
}

function addPattern(clone) {
  if (song.patterns.length >= 255 || song.orders.length >= MAX_ORDERS) return toast('LIMIT REACHED');
  song.patterns.push(clone ? clonePattern(curPat()) : newPattern(curPat().rows));
  song.orders.splice(state.ord + 1, 0, song.patterns.length - 1);
  state.ord++;
}

function insertOrder() {
  if (song.orders.length >= MAX_ORDERS) return;
  song.orders.splice(state.ord, 0, song.orders[state.ord]);
}

function deleteOrder() {
  if (song.orders.length <= 1) return;
  song.orders.splice(state.ord, 1);
  state.ord = clamp(state.ord, 0, song.orders.length - 1);
  if (engine.playing && engine.ord >= song.orders.length) engine.jump(0, 0);
}

function clearPattern() {
  const p = curPat();
  p.note.fill(0); p.inst.fill(0); p.vol.fill(255); p.fxc.fill(0); p.fxp.fill(0);
}

// ---- samples ----
function selectSample(n) {
  state.smp = clamp(n, 1, MAX_SMP);
  const vis = state.smpRows || 10;
  if (state.smp - 1 < state.smpScroll) state.smpScroll = state.smp - 1;
  if (state.smp - 1 >= state.smpScroll + vis) state.smpScroll = state.smp - vis;
}

function reverseSample() {
  const s = curSample();
  s.data.reverse();
  if (s.loopType) { const a = s.data.length - s.loopEnd, b = s.data.length - s.loopStart; s.loopStart = a; s.loopEnd = b; }
  touch(s);
}

function normalizeSample() {
  const s = curSample();
  let pk = 0;
  for (let i = 0; i < s.data.length; i++) pk = Math.max(pk, Math.abs(s.data[i]));
  if (pk > 0) { const g = 0.98 / pk; for (let i = 0; i < s.data.length; i++) s.data[i] *= g; }
  touch(s);
}

function clearSample() {
  const slot = state.smp - 1;
  song.samples[slot] = newSample('');
}

function importSample(slot, src) {
  const s = newSample((src.name || 'SAMPLE').slice(0, 22));
  s.data = src.data.slice(); s.rate = src.rate; s.vol = src.vol; s.base = 49; s.fine = 0;
  s.loopType = src.loopType; s.loopStart = src.loopStart; s.loopEnd = src.loopEnd;
  song.samples[slot] = s;
}

// ---- files ----
function pickFile(accept, cb) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept;
  i.onchange = () => { if (i.files[0]) cb(i.files[0]); };
  i.click();
}

async function handleFile(file) {
  try {
    if (/\.(json|wtk)$/i.test(file.name)) { loadSongText(await file.text()); return; }
    const res = await ModLoader.load(file, audioCtx);
    if (!res.samples.length) return toast('NO SAMPLES FOUND IN FILE', 3000);
    if (res.type === 'AUDIO') {
      importSample(state.smp - 1, res.samples[0]);
      toast('LOADED ' + file.name.toUpperCase());
    } else {
      state.browser = { file: file.name, type: res.type, title: res.title, samples: res.samples, sel: 0, scroll: 0 };
      engine.preview(res.samples[0], 49);
    }
  } catch (err) {
    console.error(err);
    toast('LOAD FAILED: ' + String(err.message || err).slice(0, 40).toUpperCase(), 4000);
  }
}

// ---- in-GUI sample file browser (File System Access API) ----
// The user grants access to one folder once; the handle is remembered in IndexedDB and the
// folder tree below it is browsed inside the tracker. Falls back to the OS dialog when the API
// is not available (Firefox, Safari, insecure contexts).
const SAMPLE_EXT = /\.(xm|s3m|it|mod|wav|mp3|ogg|flac|aif|aiff|m4a)$/i;

async function openFileBrowser() {
  if (!window.showDirectoryPicker) {
    toast('FOLDER BROWSER NEEDS CHROME/EDGE ON LOCALHOST OR HTTPS', 4000);
    pickFile('.xm,.s3m,.it,.mod,.wav,.mp3,.ogg,.flac,audio/*', handleFile);
    return;
  }
  // The overlay opens immediately; the OS folder dialog only appears when the user asks for it.
  const f = state.files = { setup: 'choose', path: [], entries: [], sel: 0, scroll: 0, busy: false };
  let root = null;
  try { root = await Store.get('sampleRoot'); } catch (e) { root = null; }
  if (state.files !== f || !root) return;
  let perm = 'prompt';
  try { perm = await root.queryPermission({ mode: 'read' }); } catch (e) { return; }
  if (perm === 'granted') await showFileBrowser(root);
  else { f.setup = 'grant'; f.root = root; }
}

// Re-grants read access to the remembered folder (needs a click).
async function grantFolder() {
  const f = state.files;
  try {
    if ((await f.root.requestPermission({ mode: 'read' })) === 'granted') { await showFileBrowser(f.root); return; }
  } catch (e) { /* fall through */ }
  f.setup = 'choose'; f.root = null;
}

async function pickFolder() {
  const h = await chooseSampleFolder();
  if (h) await showFileBrowser(h);
}

async function chooseSampleFolder() {
  try {
    const h = await window.showDirectoryPicker({ id: 'wintertracker-samples', mode: 'read' });
    Store.put('sampleRoot', h).catch(() => { });
    return h;
  } catch (e) { return null; }   // cancelled
}

async function showFileBrowser(root) {
  state.files = { path: [{ name: root.name || 'ROOT', handle: root }], entries: [], sel: 0, scroll: 0, busy: false };
  await listDir();
}

async function listDir() {
  const f = state.files;
  f.busy = true; f.err = '';
  const dir = f.path[f.path.length - 1].handle, ents = [];
  try {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (h.kind === 'directory') ents.push({ name, kind: 'directory', handle: h });
      else if (SAMPLE_EXT.test(name)) ents.push({ name, kind: 'file', handle: h });
    }
  } catch (e) { f.err = 'CANNOT READ FOLDER'; }
  ents.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (f.path.length > 1) ents.unshift({ name: '..', kind: 'up' });
  f.entries = ents; f.sel = 0; f.scroll = 0; f.busy = false;
}

async function openEntry(e) {
  const f = state.files;
  if (!f || f.busy || !e) return;
  if (e.kind === 'up') { f.path.pop(); await listDir(); }
  else if (e.kind === 'directory') { f.path.push({ name: e.name, handle: e.handle }); await listDir(); }
  else {
    try {
      const file = await e.handle.getFile();
      state.files = null;
      handleFile(file);
    } catch (err) { toast('CANNOT READ FILE'); }
  }
}

// Single click: select (folders open immediately); double click on a file loads it.
function clickEntry(i) {
  const f = state.files, e = f.entries[i];
  if (!e) return;
  const now = performance.now(), dbl = f.lastIdx === i && now - f.lastT < 450;
  f.lastIdx = i; f.lastT = now; f.sel = i;
  if (e.kind !== 'file' || dbl) openEntry(e);
}

function filesKey(e) {
  const f = state.files;
  if (f.setup) {
    if (e.key === 'Escape') state.files = null;
    else if (e.key === 'Enter') { if (f.setup === 'grant') grantFolder(); else pickFolder(); }
    else return;
    e.preventDefault(); return;
  }
  const sel = n => { f.sel = clamp(n, 0, Math.max(0, f.entries.length - 1)); };
  if (e.key === 'ArrowUp') sel(f.sel - 1);
  else if (e.key === 'ArrowDown') sel(f.sel + 1);
  else if (e.key === 'PageUp') sel(f.sel - 10);
  else if (e.key === 'PageDown') sel(f.sel + 10);
  else if (e.key === 'Home') sel(0);
  else if (e.key === 'End') sel(f.entries.length - 1);
  else if (e.key === 'Enter') openEntry(f.entries[f.sel]);
  else if (e.key === 'Backspace') { if (f.path.length > 1 && !f.busy) { f.path.pop(); listDir(); } }
  else if (e.key === 'Escape') state.files = null;
  else return;
  e.preventDefault();
}

function loadSongText(text) {
  const s = songFromJSON(text);
  engine.stop();
  song = s; engine.song = s;
  state.ord = 0; state.row = 0; state.ch = 0; state.field = 0; state.chScroll = 0; state.smp = 1; state.smpScroll = 0;
  toast('SONG LOADED');
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Tiny IndexedDB key/value store (samples can be larger than the localStorage quota).
const Store = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('wintertracker', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
    });
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const q = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      q.onsuccess = () => { db.close(); res(q.result); };
      q.onerror = () => rej(q.error);
    });
  }
};

// Saves the song as a file and remembers it as the "last save", reloaded automatically at startup.
function saveSong() {
  const text = songToJSON(song);
  download(new Blob([text], { type: 'application/json' }), (song.title || 'song').toLowerCase().replace(/\W+/g, '_') + '.wtk.json');
  Store.put('lastSave', text).then(() => toast('SONG SAVED'), () => toast('SAVED FILE ONLY (NO BROWSER STORAGE)', 3500));
}

function restoreLastSave() {
  Store.get('lastSave').then(text => {
    if (!text) return;
    song = songFromJSON(text);
    if (engine) { engine.stop(); engine.song = song; toast('LAST SAVE RESTORED'); }
    else state.restored = true;
  }).catch(err => console.warn('Could not restore last save', err));
}

let exporting = false;
function exportWav() {
  if (exporting) return;
  exporting = true; engine.stop();
  toast('RENDERING WAV...', 600000);
  renderSongToWav(song, audioCtx.sampleRate, (o, n) => toast('RENDERING WAV ' + Math.min(99, Math.floor(o / n * 100)) + '%', 600000)).then(blob => {
    download(blob, (song.title || 'song').toLowerCase().replace(/\W+/g, '_') + '.wav');
    toast('WAV EXPORTED');
    exporting = false;
  });
}

// ---- keyboard ----
function onKey(e) {
  if (e.key === 'Backspace') e.preventDefault();   // never let the browser act on Backspace
  if (state.screen === 'splash') { startApp(); e.preventDefault(); return; }
  if (UI.fieldKey(e)) return;
  if (state.files) return filesKey(e);
  if (state.browser) return browserKey(e);
  if (state.help) { if (e.key === 'Escape' || e.key === 'F1' || e.key === 'Enter') state.help = false; e.preventDefault(); return; }
  const k = e.key;
  if (e.ctrlKey || e.metaKey) {
    if (k === 'ArrowLeft') setOrder(state.ord - 1);
    else if (k === 'ArrowRight') setOrder(state.ord + 1);
    else if (k === 'ArrowUp') { if (e.shiftKey) state.oct = clamp(state.oct + 1, 0, 7); else selectSample(state.smp - 1); }
    else if (k === 'ArrowDown') { if (e.shiftKey) state.oct = clamp(state.oct - 1, 0, 7); else selectSample(state.smp + 1); }
    else if (state.tab === 'pattern' && (k === 'c' || k === 'C')) copySel(false);
    else if (state.tab === 'pattern' && (k === 'x' || k === 'X')) copySel(true);
    else if (state.tab === 'pattern' && (k === 'v' || k === 'V')) pasteClip();
    else return;
    e.preventDefault(); return;
  }
  if (e.code === 'NumpadDivide' || e.code === 'NumpadMultiply') {
    state.oct = clamp(state.oct + (e.code === 'NumpadMultiply' ? 1 : -1), 0, 7);
    e.preventDefault(); return;
  }
  if (state.tab === 'pattern') {
    if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight')) {
      // Shift+cursor extends a rectangular selection of cells
      if (!state.sel) state.sel = { row: state.row, ch: state.ch };
      if (k === 'ArrowUp') moveRow(-1);
      else if (k === 'ArrowDown') moveRow(1);
      else moveChannel(k === 'ArrowLeft' ? -1 : 1);
      e.preventDefault(); return;
    }
    if (k === 'Delete' && state.sel) { clearSelection(); state.sel = null; e.preventDefault(); return; }
    if (k !== 'Shift' && k !== 'Control' && k !== 'Alt' && k !== 'Meta') state.sel = null;
  }
  if (k === 'F2') { state.tab = 'pattern'; e.preventDefault(); return; }
  if (k === 'F3') { state.tab = 'samples'; e.preventDefault(); return; }
  if (state.tab === 'samples') {
    // Samples tab: transport, sample selection and piano preview only.
    let ok = true;
    if (k === ' ') { if (engine.playing) stopPlay(); else playSong(); }
    else if (k === 'Escape' || k === 'F8') stopPlay();
    else if (k === 'F6') playPattern();
    else if (k === 'F1') state.help = true;
    else if (k === 'ArrowUp' || k === '[') selectSample(state.smp - 1);
    else if (k === 'ArrowDown' || k === ']') selectSample(state.smp + 1);
    else if (!e.repeat && PIANO[e.code] !== undefined && !e.shiftKey) {
      engine.preview(curSample(), clamp(state.oct * 12 + PIANO[e.code] + 1, 1, 96));
    } else ok = false;
    if (ok) e.preventDefault();
    return;
  }
  let handled = true;
  switch (k) {
    case 'ArrowUp': moveRow(-1); break;
    case 'ArrowDown': moveRow(1); break;
    case 'ArrowLeft': moveField(-1); break;
    case 'ArrowRight': moveField(1); break;
    case 'Tab': moveChannel(e.shiftKey ? -1 : 1); state.field = 0; break;
    case 'PageUp': moveRow(-16); break;
    case 'PageDown': moveRow(16); break;
    case 'Home': state.row = 0; state.ch = 0; state.field = 0; break;
    case 'End': state.row = curPat().rows - 1; break;
    case ' ': if (engine.playing) stopPlay(); else playSong(); break;
    case 'Enter': if (engine.playing) stopPlay(); else playPattern(); break;
    case 'Escape': stopPlay(); break;
    case 'F6': playPattern(); break;
    case 'F8': stopPlay(); break;
    case 'F1': state.help = true; break;
    case 'Delete': clearField(e.shiftKey); break;
    case 'Backspace': deleteCellAbove(); break;
    case 'Insert': insertCell(); break;
    case '[': selectSample(state.smp - 1); break;
    case ']': selectSample(state.smp + 1); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); ensureChVisible(); return; }
  const f = state.field;
  if (f === 0) {
    if (e.code === 'Digit1') { const p = curPat(); p.note[cellIdx()] = NOTE_OFF; advanceAfterEntry(); e.preventDefault(); return; }
    if (!e.repeat && PIANO[e.code] !== undefined && !e.shiftKey) { enterNote(PIANO[e.code]); e.preventDefault(); }
  } else if (f === 5) {
    const c = k.toUpperCase();
    if (k.length === 1 && /^[0-9A-Z]$/.test(c) && !e.repeat) { typeFxCmd(c); e.preventDefault(); }
  } else if (k.length === 1 && /^[0-9a-fA-F]$/.test(k) && !e.repeat) {
    typeHex(parseInt(k, 16)); e.preventDefault();
  }
}

function browserKey(e) {
  const b = state.browser;
  const sel = n => {
    b.sel = clamp(n, 0, b.samples.length - 1);
    engine.preview(b.samples[b.sel], 49);
  };
  if (e.key === 'ArrowUp') sel(b.sel - 1);
  else if (e.key === 'ArrowDown') sel(b.sel + 1);
  else if (e.key === 'PageUp') sel(b.sel - 8);
  else if (e.key === 'PageDown') sel(b.sel + 8);
  else if (e.key === 'Enter') { importSample(state.smp - 1, b.samples[b.sel]); toast('SAMPLE IMPORTED'); }
  else if (e.key === 'Escape') { state.browser = null; engine.previewStop(); }
  else return;
  e.preventDefault();
}

// ---- boot ----
function startApp() {
  if (state.screen !== 'splash') return;
  startAudio();
  state.screen = 'main';
  UI.resize(chooseScale());
  if (state.restored) toast('LAST SAVE RESTORED');
}

function boot() {
  const canvas = document.getElementById('screen');
  UI.init(canvas);
  restoreLastSave();
  state.zoom = window.innerWidth >= 1100 && window.innerHeight >= 700 ? 2 : 1;
  UI.resize(1);
  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / UI.S), Math.floor((e.clientY - r.top) / UI.S)];
  };
  canvas.addEventListener('mousedown', e => {
    if (state.screen === 'splash') { startApp(); return; }
    const [x, y] = pos(e); UI.mouseDown(x, y, e); e.preventDefault();
  });
  window.addEventListener('mousemove', e => { const [x, y] = pos(e); UI.mouseMove(x, y, e); });
  window.addEventListener('mouseup', e => { const [x, y] = pos(e); UI.mouseUp(x, y, e); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    const [x, y] = pos(e);
    if (!UI.wheel(x, y, e.deltaY, e)) wheelDefault(e);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', e => {
    e.preventDefault();
    if (state.screen === 'main' && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', () => UI.resize(state.screen === 'splash' ? 1 : chooseScale()));
  requestAnimationFrame(frame);
}

function wheelDefault(e) {
  if (state.screen !== 'main' || state.browser || state.help || state.tab !== 'pattern') return;
  if (e.shiftKey) { state.chScroll = clamp(state.chScroll + (e.deltaY > 0 ? 1 : -1), 0, Math.max(0, song.channels - state.fit)); return; }
  moveRow(e.deltaY > 0 ? 3 : -3);
}
