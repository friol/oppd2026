// OPPD-1 panel: builds the keyboard and step grid, wires knobs, buttons and computer keys, saves the project
'use strict';

const $ = id => document.getElementById(id);
const KB = { oct: 0, keys: [], down: new Map() };   // down: id -> { pi, note }
const KEYMAP = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
const STORE = { auto: 'oppd1.project' };

// ---------- songs as files on the user's computer ----------
// Chrome / Edge: File System Access API (real Save / Open dialogs, SAVE SONG rewrites the same file);
// other browsers: a download and the file chooser.
const SONG_EXT = '.oppd1';
const SONG_TYPES = [{ description: 'OPPD-1 song', accept: { 'application/json': [SONG_EXT, '.json'] } }];
const songNameFromFile = fn => fn.replace(/\.(oppd1|json)$/i, '').toUpperCase().slice(0, 24);
const fileNameFor = name => (name && name !== 'NEW' ? name : 'song').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + SONG_EXT;

function readSong(text, fileName) {
  let o;
  try { o = JSON.parse(text); } catch (e) { OS.toast('NOT AN OPPD-1 FILE'); return false; }
  if (!validProject(o)) { OS.toast('NOT AN OPPD-1 FILE'); return false; }
  o.name = songNameFromFile(fileName);
  loadProject(o);
  OS.toast('LOADED ' + fileName);
  return true;
}

const APP = {
  lastSaved: '',
  file: null,            // handle of the file this song was loaded from / saved to (File System Access API)
  newProject() { loadProject(newProject()); this.file = null; OS.toast('NEW PROJECT'); },
  loadDemo() { loadProject(demoProject()); this.file = null; OS.toast('DEMO LOADED'); },
  async saveSong(saveAs) {
    if (window.showSaveFilePicker) {
      try {
        let h = !saveAs && this.file;
        if (!h) h = await window.showSaveFilePicker({ suggestedName: fileNameFor(PRJ.name), types: SONG_TYPES });
        PRJ.name = songNameFromFile(h.name);
        const w = await h.createWritable();
        await w.write(JSON.stringify(PRJ, null, 1));
        await w.close();
        this.file = h;
        OS.toast('SAVED ' + h.name);
      } catch (e) {
        OS.toast(e && e.name === 'AbortError' ? 'NOT SAVED' : 'SAVE FAILED');
      }
      return;
    }
    // fallback: download the file (it lands in the browser's download folder)
    const fn = fileNameFor(PRJ.name);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(PRJ, null, 1)], { type: 'application/json' }));
    a.download = fn;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    OS.toast('DOWNLOADED ' + fn);
  },
  async loadSong() {
    if (window.showOpenFilePicker) {
      try {
        const [h] = await window.showOpenFilePicker({ types: SONG_TYPES, multiple: false });
        const f = await h.getFile();
        if (readSong(await f.text(), f.name)) this.file = h;
      } catch (e) {
        if (!e || e.name !== 'AbortError') OS.toast('LOAD FAILED');
      }
      return;
    }
    $('importFile').value = '';
    $('importFile').click();
  },
  enableMidi() {
    if (!navigator.requestMIDIAccess) { OS.toast('NO WEB MIDI'); return; }
    navigator.requestMIDIAccess().then(m => {
      const hook = () => m.inputs.forEach(inp => { inp.onmidimessage = onMidi; });
      hook(); m.onstatechange = hook;
      OS.toast('MIDI: ' + m.inputs.size + ' INPUT' + (m.inputs.size === 1 ? '' : 'S'));
    }).catch(() => OS.toast('MIDI REFUSED'));
  },
  autosave() {
    const s = JSON.stringify(PRJ);
    if (s === this.lastSaved) return;
    this.lastSaved = s;
    try { localStorage.setItem(STORE.auto, s); } catch (e) { /* storage unavailable */ }
  }
};
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { if (readSong(r.result, f.name)) APP.file = null; };
  r.readAsText(f);
});

function onMidi(e) {
  const [st, d1, d2] = e.data, cmd = st & 0xf0;
  const pi = OS.focusPart(), id = 'midi' + d1;
  if (cmd === 0x90 && d2 > 0) noteDown(id, d1 - 12 * KB.oct, pi);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteUp(id);
}

// ---------- notes from keyboard / computer keys / MIDI ----------
function baseNote() { return 48 + 12 * KB.oct; }
function noteDown(id, note, pi) {
  if (KB.down.has(id)) return;
  BOT.lastInput = performance.now();
  if (pi == null) pi = OS.focusPart();
  KB.down.set(id, { pi, note });
  liveDown(pi, note);
}
function noteUp(id) {
  const e = KB.down.get(id);
  if (!e) return;
  KB.down.delete(id);
  liveUp(e.pi, e.note);
}
function setOct(d) {
  KB.oct = clamp(KB.oct + d, -3, 3);
  OS.toast('KEYS OCTAVE ' + (KB.oct > 0 ? '+' : '') + KB.oct);
  labelKeys();
}

// ---------- build: keyboard ----------
function buildKeyboard() {
  const whites = $('whites'), kb = $('keyboard');
  const WHITE = [0, 2, 4, 5, 7, 9, 11], BLACK_AFTER = { 0: 1, 1: 3, 3: 6, 4: 8, 5: 10 };
  for (let o = 0; o < 2; o++) {
    WHITE.forEach((semi, wi) => {
      const b = document.createElement('button');
      b.className = 'wk';
      b.dataset.semi = o * 12 + semi;
      whites.appendChild(b);
      KB.keys.push(b);
      if (BLACK_AFTER[wi] != null) {
        const k = document.createElement('button');
        k.className = 'bk';
        k.dataset.semi = o * 12 + BLACK_AFTER[wi];
        k.dataset.after = o * 7 + wi + 1;
        kb.appendChild(k);
        KB.keys.push(k);
      }
    });
  }
  const place = KB.place = () => {
    const W = whites.clientWidth, w = (W - 13 * 4) / 14;
    kb.querySelectorAll('.bk').forEach(k => { k.style.left = (6 + k.dataset.after * (w + 4) - 2 - 17) + 'px'; });
  };
  place();
  labelKeys();

  let dragging = false;
  const keyDown = (k, pid) => { k.classList.add('down'); noteDown('p' + pid + ':' + k.dataset.semi, baseNote() + +k.dataset.semi); k._pid = pid; };
  const keyUp = k => { k.classList.remove('down'); noteUp('p' + k._pid + ':' + k.dataset.semi); };
  KB.keys.forEach(k => {
    k.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (k.hasPointerCapture(e.pointerId)) k.releasePointerCapture(e.pointerId);
      dragging = true; keyDown(k, e.pointerId);
    });
    k.addEventListener('pointerenter', e => { if (dragging && e.buttons) keyDown(k, e.pointerId); });
    k.addEventListener('pointerleave', () => { if (k.classList.contains('down')) keyUp(k); });
    k.addEventListener('pointerup', () => { if (k.classList.contains('down')) keyUp(k); });
    k.tabIndex = -1;
  });
  window.addEventListener('pointerup', () => { dragging = false; });
}
function labelKeys() {
  KB.keys.forEach(k => {
    const n = baseNote() + +k.dataset.semi;
    k.setAttribute('aria-label', noteName(n));
    if (k.classList.contains('wk')) k.textContent = n % 12 === 0 ? noteName(n) : '';
  });
}
function highlightKeys() {
  const pi = OS.focusPart(), base = baseNote();
  const held = new Set();
  KB.down.forEach(e => { if (e.pi === pi) held.add(e.note - base); });
  KB.keys.forEach(k => {
    if (k._pid != null && k.classList.contains('down')) return;   // pointer-held keys keep their state
    k.classList.toggle('down', held.has(+k.dataset.semi));
  });
}

// ---------- build: step grid ----------
const GRID = { rows: [], cells: [], leds: [], names: [], state: [], boxes: [], layout: '' };
function buildGrid() {
  const root = $('seqRows');
  let paint = null, holdT = 0;
  for (let r = 0; r < 5; r++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.setProperty('--rc', ROW_COLORS[r]);
    const rb = document.createElement('button');
    rb.className = 'row-btn';
    rb.innerHTML = '<span class="led"></span><span class="slot">0' + (r + 1) + '</span><span class="nm"></span>';
    rb.addEventListener('click', () => {
      AC.resume();
      PRJ.parts[0].rowSel = r;
      drumHit(0, r, 1, AC.currentTime);
    });
    row.appendChild(rb);
    const cells = document.createElement('div');
    cells.className = 'cells';
    const rc = [];
    for (let s = 0; s < DRUM_MAX; s++) {
      const c = document.createElement('button');
      c.className = 'cell';
      c.setAttribute('aria-label', 'Row ' + (r + 1) + ' step ' + (s + 1));
      c.addEventListener('pointerdown', e => {
        e.preventDefault();
        if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
        const pat = PRJ.parts[0].patterns[PRJ.parts[0].cur];
        paint = pat.steps[r][s] ? 0 : 1;
        pat.steps[r][s] = paint;
        if (paint && !SEQ.playing) { AC.resume(); drumHit(0, r, stepVel(pat, r, s), AC.currentTime); }
        if (OS.screen === 'step') { OS.stepEdit.r = r; OS.stepEdit.s = s; PRJ.parts[0].rowSel = r; }
        // holding the step opens STEP EDIT (and leaves the step on)
        clearTimeout(holdT);
        holdT = setTimeout(() => { pat.steps[r][s] = 1; paint = null; OS.openStep(r, s); }, 450);
      });
      c.addEventListener('pointerenter', e => {
        if (paint == null || !e.buttons) return;
        clearTimeout(holdT);
        PRJ.parts[0].patterns[PRJ.parts[0].cur].steps[r][s] = paint;
      });
      c.addEventListener('pointerup', () => clearTimeout(holdT));
      c.addEventListener('pointerleave', () => clearTimeout(holdT));
      c.addEventListener('keydown', e => {
        if (e.code !== 'Enter' && e.code !== 'Space') return;
        e.preventDefault(); e.stopPropagation();
        const pat = PRJ.parts[0].patterns[PRJ.parts[0].cur];
        pat.steps[r][s] = pat.steps[r][s] ? 0 : 1;
      });
      cells.appendChild(c);
      rc.push(c);
    }
    row.appendChild(cells);
    root.appendChild(row);
    GRID.rows.push(rb); GRID.cells.push(rc); GRID.leds.push(rb.querySelector('.led')); GRID.names.push(rb.querySelector('.nm'));
    GRID.state.push(new Array(DRUM_MAX).fill(''));
    GRID.boxes.push(cells);
  }
  window.addEventListener('pointerup', () => { paint = null; });
  document.querySelectorAll('.pat').forEach(b => b.addEventListener('click', () => {
    PRJ.parts[0].cur = +b.dataset.p;
  }));
}
function renderGrid() {
  const part = PRJ.parts[0], pat = part.patterns[part.cur], ph = UI.ph[0];
  const phStep = SEQ.playing && ph && ph.pat === part.cur ? ph.step : -1, len = pat.len;
  // as many cells as the pattern has steps, shaded by the beats of the time signature
  const layout = len + '|' + (PRJ.sig || 0);
  if (GRID.layout !== layout) {
    GRID.layout = layout;
    GRID.boxes.forEach((box, r) => {
      box.style.gridTemplateColumns = 'repeat(' + len + ', minmax(0, 1fr))';
      box.style.gap = len > 24 ? '3px' : len > 16 ? '4px' : '';
      GRID.cells[r].forEach((c, s) => { c.hidden = s >= len; });
    });
    GRID.state.forEach(st => st.fill(''));
  }
  for (let r = 0; r < 5; r++) {
    for (let s = 0; s < len; s++) {
      const on = pat.steps[r][s], v = stepVel(pat, r, s), pr = stepProb(pat, r, s), n = stepRat(pat, r, s);
      const edit = OS.screen === 'step' && OS.stepEdit && OS.stepEdit.r === r && OS.stepEdit.s === s;
      const cls = 'cell' + (beatIndex(s) % 2 ? ' alt' : '') + (on ? ' on' : '') + (s === phStep ? ' ph' : '') +
        (on && pr < 1 ? ' pr' : '') + (edit ? ' edit' : '');
      const key = cls + '|' + v + '|' + n;
      if (GRID.state[r][s] !== key) {
        GRID.state[r][s] = key;
        const c = GRID.cells[r][s];
        c.className = cls;
        c.style.setProperty('--v', (0.3 + 0.7 * v).toFixed(2));
        c.textContent = on && n > 1 ? 'x' + n : '';
      }
    }
    const nm = part.rows[r].sound;
    if (GRID.names[r].textContent !== nm) { GRID.names[r].textContent = nm; GRID.rows[r].setAttribute('aria-label', 'Track ' + (r + 1) + ': ' + nm); }
    GRID.rows[r].classList.toggle('sel', part.rowSel === r);
  }
  const info = 'PATTERN ' + PAT_NAMES[part.cur] + ' · ' + len + ' STEPS · ' + sig().name + (PRJ.songMode ? ' · SONG ROW ' + (UI.row + 1) : '') + (SEQ.rec ? ' · REC' : '');
  if ($('seqInfo').textContent !== info) $('seqInfo').textContent = info;
  document.querySelectorAll('.pat').forEach(b => {
    b.classList.toggle('on', +b.dataset.p === part.cur);
    b.classList.toggle('playing', SEQ.playing && ph && ph.pat === +b.dataset.p);
  });
}

// ---------- knobs ----------
function buildKnobs() {
  document.querySelectorAll('.knob').forEach(kn => {
    const i = +kn.dataset.k;
    let last = null, moved = 0, frac = 0;
    kn.addEventListener('pointerdown', e => {
      e.preventDefault(); AC.resume();
      kn.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY }; moved = 0; frac = 0;
      kn.classList.add('down');
    });
    kn.addEventListener('pointermove', e => {
      if (!last) return;
      const d = (last.y - e.clientY) + (e.clientX - last.x);
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(d);
      frac += d * (e.shiftKey ? 0.25 : 1);
      const u = Math.trunc(frac);
      if (u && moved > 3) { frac -= u; OS.turn(i, u, false); }
    });
    const end = () => {
      if (!last) return;
      if (moved <= 3) OS.press(i);
      last = null;
      kn.classList.remove('down');
    };
    kn.addEventListener('pointerup', end);
    kn.addEventListener('pointercancel', end);
    kn.addEventListener('wheel', e => { e.preventDefault(); OS.turn(i, e.deltaY < 0 ? 8 : -8, true); }, { passive: false });
    kn.addEventListener('keydown', e => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.code];
      if (d) { e.preventDefault(); e.stopPropagation(); OS.turn(i, d * 8, true); }
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); OS.press(i); }
    });
  });
}
const KNOB_ROT = document.querySelectorAll('.knob-rot');
const KNOB_LAB = [...document.querySelectorAll('.knob-lab')].map(el => ({ n: el.querySelector('.kn'), v: el.querySelector('.kv'), last: '' }));
function renderKnobs() {
  const ks = OS.screen === 'boot' ? [] : OS.knobs();
  for (let i = 0; i < 4; i++) {
    const k = ks[i];
    const deg = k && k.norm ? -135 + 270 * clamp(k.norm(), 0, 1) : OS.spin[i];
    KNOB_ROT[i].style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
    // the parameter under each knob, mirrored from the display
    const name = k && k.label ? k.label : '', val = name ? k.value() : '';
    const key = name + '|' + val, L = KNOB_LAB[i];
    if (L.last !== key) { L.last = key; L.n.textContent = name; L.v.textContent = val; }
  }
}

// ---------- navigation buttons (hold SELECT = home) ----------
const SELECT = { t: 0, timer: 0, long: false };
function selectDown() {
  if (SELECT.t) return;
  SELECT.t = performance.now(); SELECT.long = false;
  $('navSel').classList.add('down');
  SELECT.timer = setTimeout(() => { SELECT.long = true; OS.back(); }, 450);
}
function selectUp() {
  if (!SELECT.t) return;
  clearTimeout(SELECT.timer);
  if (!SELECT.long) OS.select();
  SELECT.t = 0;
  $('navSel').classList.remove('down');
}
function buildNav() {
  $('navUp').addEventListener('click', () => OS.nav(-1));
  $('navDown').addEventListener('click', () => OS.nav(1));
  const s = $('navSel');
  s.addEventListener('pointerdown', e => { e.preventDefault(); AC.resume(); selectDown(); });
  s.addEventListener('pointerup', selectUp);
  s.addEventListener('pointerleave', () => { if (SELECT.t) selectUp(); });
  s.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) selectDown(); } });
  s.addEventListener('keyup', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); selectUp(); } });
}

// ---------- transport ----------
function toggleRec() { SEQ.rec = !SEQ.rec; OS.toast(SEQ.rec ? (SEQ.playing ? 'REC' : 'STEP REC') : 'REC OFF'); }
function toggleLoop() { PRJ.songMode = !PRJ.songMode; if (PRJ.songMode && SEQ.row >= PRJ.song.length) SEQ.row = 0; OS.toast(PRJ.songMode ? 'SONG MODE' : 'LOOP MODE'); }
function buildTransport() {
  $('btnRec').addEventListener('click', toggleRec);
  $('btnPlay').addEventListener('click', () => { AC.resume(); seqPlay(); });
  // STOP: click = stop (twice = back to the start); hold = clear the focused part's current pattern
  const stop = $('btnStop');
  let hold = 0, held = false;
  stop.addEventListener('pointerdown', () => {
    held = false;
    clearTimeout(hold);
    hold = setTimeout(() => { held = true; stop.classList.add('down'); OS.toast(clearPattern(OS.focusPart())); }, 550);
  });
  const release = () => { clearTimeout(hold); stop.classList.remove('down'); };
  stop.addEventListener('pointerup', release);
  stop.addEventListener('pointerleave', release);
  stop.addEventListener('click', () => { if (held) { held = false; return; } seqStop(); });
  $('btnLoop').addEventListener('click', toggleLoop);
  $('btnOctDown').addEventListener('click', () => setOct(-1));
  $('btnOctUp').addEventListener('click', () => setOct(1));
}
function renderTransport() {
  $('btnRec').classList.toggle('on', SEQ.rec);
  $('btnPlay').classList.toggle('on', SEQ.playing);
  $('btnLoop').classList.toggle('on', !PRJ.songMode);
  const fp = OS.screen === 'boot' ? -1 : OS.focusPart();
  PART_BTNS.forEach((b, i) => b.classList.toggle('on', i === fp));
}

// ---------- part buttons (jump straight to an instrument) and the SKIN switch ----------
const PART_BTNS = [...document.querySelectorAll('.part')];
function buildPanelExtras() {
  PART_BTNS.forEach(b => b.addEventListener('click', () => {
    AC.resume();
    poke();
    OS.menu = null;
    OS.enter(+b.dataset.pi);
  }));
  const sw = $('skinSw');
  sw.addEventListener('click', e => {
    // clicking a detent picks it, clicking the knob (or Enter / Space) moves to the next skin
    const r = sw.getBoundingClientRect();
    const at = e.clientX ? Math.floor((e.clientX - r.left) / r.width * SKINS.length) : -1;
    applySkin(at >= 0 && at < SKINS.length && at !== SKIN ? at : SKIN + 1);
    OS.toast('SKIN ' + SKINS[SKIN].name);
  });
}

// ---------- computer keyboard ----------
let kbKnob = 0;
function buildKeys() {
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); OS.toast(undoClear() || 'NOTHING TO UNDO'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    AC.resume();
    const ki = KEYMAP.indexOf(e.code);
    if (ki >= 0) { e.preventDefault(); if (!e.repeat) noteDown('k' + e.code, baseNote() + ki); return; }
    if (e.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); seqToggle(); break;
      case 'KeyR': toggleRec(); break;
      case 'KeyZ': case 'NumpadDivide': e.preventDefault(); setOct(-1); break;
      case 'KeyX': case 'NumpadMultiply': e.preventDefault(); setOct(1); break;
      case 'KeyQ': toggleLoop(); break;
      case 'ArrowUp': e.preventDefault(); OS.nav(-1); break;
      case 'ArrowDown': e.preventDefault(); OS.nav(1); break;
      case 'ArrowLeft': e.preventDefault(); OS.turn(kbKnob, e.shiftKey ? -1 : -8, !e.shiftKey); break;
      case 'ArrowRight': e.preventDefault(); OS.turn(kbKnob, e.shiftKey ? 1 : 8, !e.shiftKey); break;
      case 'Enter': e.preventDefault(); selectDown(); break;
      case 'Escape': case 'Backspace': e.preventDefault(); OS.back(); break;
      case 'Delete': e.preventDefault(); OS.toast(clearPattern(OS.focusPart())); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': kbKnob = +e.code.slice(5) - 1; OS.touched[kbKnob] = performance.now(); break;
      case 'Digit5': OS.press(kbKnob); break;
    }
  });
  window.addEventListener('keyup', e => {
    const ki = KEYMAP.indexOf(e.code);
    if (ki >= 0) { noteUp('k' + e.code); return; }
    if (e.code === 'Enter') selectUp();
  });
  window.addEventListener('blur', () => { [...KB.down.keys()].forEach(noteUp); });
}

// ---------- speaker dots (light up with the output level) ----------
const DOTS = [];
const DOT_ORDER = [8, 9, 14, 15, 2, 3, 7, 10, 13, 16, 1, 4, 6, 11, 12, 17, 0, 5];
function buildSpeaker() {
  for (let i = 0; i < 18; i++) { const d = document.createElement('i'); $('speaker').appendChild(d); DOTS.push(d); }
}
function renderSpeaker(level) {
  const n = Math.round(clamp(level * 3.2, 0, 1) * 18);
  DOT_ORDER.forEach((di, j) => {
    const cls = j < n ? (j < 6 ? 'hot' : 'on') : '';
    if (DOTS[di].className !== cls) DOTS[di].className = cls;
  });
}

// ---------- scaling ----------
function fit() {
  const s = Math.min(window.innerWidth / 1320, (window.innerHeight - 10) / 880);
  $('wrap').style.transform = 'translate(-50%, -50%) scale(' + s.toFixed(4) + ')';
}

// ---------- frame loop ----------
const ledT = [0, 0, 0, 0, 0];
function frame() {
  const now = AC.currentTime;
  // timed UI events from the sequencer
  if (SEQ.vis.length) {
    let i = 0;
    for (; i < SEQ.vis.length; i++) {
      const v = SEQ.vis[i];
      if (v.t > now) break;
      if (v.k === 'step') {
        UI.ph[v.pi] = { step: v.step, pat: v.pat };
        // in song mode the grid and the NOTES page follow the pattern that is playing
        if (PRJ.songMode && v.pat >= 0) PRJ.parts[v.pi].cur = v.pat;
      }
      else if (v.k === 'hit') { ledT[v.r] = performance.now(); if (v.r === 0) BOT.kickT = ledT[0]; botEmit(0); }
      else if (v.k === 'note') botEmit(v.pi);
      else if (v.k === 'beat') { UI.beatT = v.t; UI.beatN = v.n; }
      else if (v.k === 'row') UI.row = v.row;
    }
    if (i) SEQ.vis.splice(0, i);
    if (SEQ.vis.length > 2000) SEQ.vis.splice(0, SEQ.vis.length - 2000);
  }
  for (let pi = 0; pi < 4; pi++) {
    const l = Math.min(1, anLevel(RT[pi].an) * 4);
    UI.act[pi] = Math.max(l, UI.act[pi] * 0.9);
    RT[pi].voices = RT[pi].voices.filter(v => !v.done);
  }
  const pnow = performance.now();
  GRID.leds.forEach((l, r) => l.classList.toggle('hit', pnow - ledT[r] < 90));
  OS.draw();
  renderKnobs();
  renderGrid();
  renderTransport();
  highlightKeys();
  renderSpeaker(anLevel(AU.analyser));
  requestAnimationFrame(frame);
}

// ---------- boot ----------
(function boot() {
  let prj = null;
  try { prj = JSON.parse(localStorage.getItem(STORE.auto) || 'null'); } catch (e) { prj = null; }
  loadProject(validProject(prj) ? prj : newProject());
  APP.lastSaved = JSON.stringify(PRJ);
  OS.init($('screen'));
  buildKeyboard(); buildGrid(); buildKnobs(); buildNav(); buildTransport(); buildKeys(); buildSpeaker(); buildPanelExtras();
  applySkin(savedSkin());
  fit();
  window.addEventListener('resize', fit);
  const wake = () => { if (AC.state !== 'running') AC.resume(); };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
  setInterval(() => APP.autosave(), 2000);
  if (location.search.includes('debug')) window.oppdDebug = { PRJ: () => PRJ, SEQ, RT, OS, liveDown, liveUp, seqPlay, seqStop, AC };
  requestAnimationFrame(frame);
})();
