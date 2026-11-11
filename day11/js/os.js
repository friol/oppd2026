// OPPD-1 OS: the little operating system on the display, driven by the 4 knobs and the 3 navigation buttons
'use strict';

const C = { bg: '#141716', ink: '#e9eee9', dim: '#6f7a74', faint: '#3a423e', line: '#2f3532', hi: '#232a26', cell: '#1a1e1c', accent: '#b8e62e', rec: '#ff5a36' };
const KC = ['#8fb0c9', '#e3c06a', '#9cc19f', '#ee8a69'];
const MONO = "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace";
const SANS = "'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
const HOME_ITEMS = ['DRUM', 'SYNTH A', 'SYNTH B', 'SYNTH C', 'SONG', 'PROJECT'];
const SCREENS = { 4: 'song', 5: 'project' };
const poke = () => { BOT.lastInput = performance.now(); };
const ROW_COLORS = ['#7f9bb2', '#e08364', '#dcb965', '#8fae92', '#ad9bc2'];
const DISPLAY_FX = { glow: 0, glowColor: 'transparent' };   // phosphor glow of the display (set by the skin)

const UI = { ph: [null, null, null, null], row: 0, act: [0, 0, 0, 0] };

// ---------- knob factories ----------
function kNorm(label, get, set, fmt) {
  return { label, norm: get, value: () => fmt(get()), turn: d => set(clamp(get() + d * 0.005, 0, 1)) };
}
function kStep(label, get, set, n, fmt) {
  return { label, steps: n, norm: get, value: () => fmt(get()), turn: d => set(clamp(Math.round(get() * (n - 1)) + d, 0, n - 1) / (n - 1)) };
}
function kInt(label, get, set, min, max, fmt, sens) {
  return {
    label, steps: max - min + 1, sens, norm: () => max > min ? (get() - min) / (max - min) : 0,
    value: () => fmt ? fmt(get()) : String(get()), turn: d => set(clamp(get() + d, min, max))
  };
}
const kNone = () => ({ label: '', value: () => '', norm: null, turn() { } });
function kParam(pi, d) {
  const get = () => PRJ.parts[pi].params[d.id], set = v => setParam(pi, d.id, v);
  return d.steps > 1 ? kStep(d.name, get, set, d.steps, d.fmt) : kNorm(d.name, get, set, d.fmt);
}
const fmtPan = v => Math.abs(v - 0.5) < 0.01 ? 'C' : (v < 0.5 ? 'L' : 'R') + Math.round(Math.abs(v - 0.5) * 200);

// ---------- the OS ----------
const OS = {
  cv: null, g: null, k: 0,
  screen: 'boot', bootT: 0,
  homeSel: 1, part: 1, focus: 1,
  page: [0, 0, 0, 0], songCur: { row: 0, col: 0 }, presetSel: [0, 0, 0, 0],
  menu: null, toastMsg: '', toastT: 0,
  touched: [0, 0, 0, 0], acc: [0, 0, 0, 0], spin: [0, 0, 0, 0],

  init(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.bootT = performance.now();
  },
  toast(msg) { this.toastMsg = msg; this.toastT = performance.now(); },
  focusPart() {
    if (this.screen === 'step') return 0;
    if (this.screen === 'part') return this.part;
    if (this.screen === 'home' && this.homeSel < 4) return this.homeSel;
    return this.focus;
  },

  // ----- screens & pages -----
  current() {
    if (this.screen === 'home') return homePage();
    if (this.screen === 'song') return songPage();
    if (this.screen === 'project') return projectPage();
    if (this.screen === 'step') return stepPage();
    const pages = partPages(this.part);
    this.page[this.part] = clamp(this.page[this.part], 0, pages.length - 1);
    const pg = pages[this.page[this.part]];
    pg.tabs = pages.map(p => p.name); pg.tab = this.page[this.part];
    return pg;
  },
  knobs() { return this.menu ? [kNone(), kNone(), kNone(), kNone()] : this.current().knobs; },

  enter(sel) {
    if (sel < 4) {
      this.screen = 'part'; this.part = sel; this.focus = sel;
      if (PRJ.parts[sel].kind === 'synth') {
        const i = allPresets().findIndex(p => p.name === PRJ.parts[sel].preset);
        if (i >= 0) this.presetSel[sel] = i;
      } else {
        const i = KITS.findIndex(k => k.name === PRJ.parts[sel].kit);
        if (i >= 0) this.presetSel[sel] = i;
      }
    } else this.screen = SCREENS[sel];
  },
  back() {
    poke();
    if (this.menu) { this.menu = null; return; }
    if (this.screen === 'boot') { this.screen = 'home'; return; }
    if (this.screen === 'step') { this.closeStep(); return; }
    if (this.screen === 'part') this.homeSel = this.part;
    else if (this.screen === 'song') this.homeSel = 4;
    else if (this.screen === 'project') this.homeSel = 5;
    this.screen = 'home';
  },
  nav(d) {
    poke();
    if (this.screen === 'boot') { this.screen = 'home'; return; }
    if (this.menu) { this.menu.sel = (this.menu.sel + d + this.menu.items.length) % this.menu.items.length; return; }
    if (this.screen === 'step') { const se = this.stepEdit; se.r = (se.r + d + 5) % 5; PRJ.parts[0].rowSel = se.r; return; }
    if (this.screen === 'home') { const n = HOME_ITEMS.length; this.homeSel = (this.homeSel + d + n) % n; if (this.homeSel < 4) this.focus = this.homeSel; }
    else if (this.screen === 'part') { const n = partPages(this.part).length; this.page[this.part] = (this.page[this.part] + d + n) % n; }
    else if (this.screen === 'song') this.songCur.row = clamp(this.songCur.row + d, 0, PRJ.song.length - 1);
  },
  select() {
    poke();
    if (this.screen === 'boot') { this.screen = 'home'; return; }
    if (this.menu) { const it = this.menu.items[this.menu.sel]; this.menu = null; if (it.fn) it.fn(); return; }
    if (this.screen === 'home') { this.enter(this.homeSel); return; }
    const pg = this.current();
    if (pg.select) pg.select();
  },
  // STEP EDIT: opened by holding a drum step; returns to the screen it was opened from
  openStep(r, s) {
    poke();
    if (this.screen !== 'step') this.stepFrom = this.screen === 'boot' ? 'home' : this.screen;
    this.menu = null;
    this.screen = 'step';
    this.stepEdit = { r, s };
    PRJ.parts[0].rowSel = r;
  },
  closeStep() { this.screen = this.stepFrom || 'home'; this.stepEdit = null; },
  openMenu(title, items) { this.menu = { title, items, sel: 0 }; },
  turn(i, units, wheel) {
    poke();
    if (this.screen === 'boot') { this.screen = 'home'; return; }
    const k = this.knobs()[i];
    if (!k || !k.label) return;
    this.touched[i] = performance.now();
    this.spin[i] += units * 2;
    if (k.steps > 1) {
      if (wheel) { k.turn(units > 0 ? 1 : -1); return; }
      const sens = k.sens || 10;
      this.acc[i] += units;
      while (this.acc[i] >= sens) { k.turn(1); this.acc[i] -= sens; }
      while (this.acc[i] <= -sens) { k.turn(-1); this.acc[i] += sens; }
    } else k.turn(units);
  },
  press(i) {
    poke();
    if (this.screen === 'boot') { this.screen = 'home'; return; }
    const k = this.knobs()[i];
    if (k && k.press) { this.touched[i] = performance.now(); k.press(); }
  },

  // ----- rendering -----
  draw() {
    const g = this.g, cv = this.cv;
    const scale = cv.getBoundingClientRect().width / 400 || 1;
    const k = Math.min(4, Math.max(1, scale * (window.devicePixelRatio || 1)));
    if (Math.abs(k - this.k) > 0.05) { this.k = k; cv.width = Math.round(400 * k); cv.height = Math.round(160 * k); }
    g.setTransform(cv.width / 400, 0, 0, cv.height / 160, 0, 0);
    g.shadowBlur = 0;
    g.fillStyle = C.bg; g.fillRect(0, 0, 400, 160);
    g.shadowBlur = DISPLAY_FX.glow; g.shadowColor = DISPLAY_FX.glowColor;
    if (this.screen === 'boot') { drawBoot(g, this); return; }
    const pg = this.current();
    drawHeader(g, pg.title || '');
    if (pg.tabs) drawTabs(g, pg.tabs, pg.tab);
    pg.draw(g);
    if (pg.hint && !this.menu) T(g, pg.hint, 390, 111, 8, C.dim, 'right');
    drawKnobCells(g, pg.knobs, this);
    if (this.menu) drawMenu(g, this.menu);
    const ta = performance.now() - this.toastT;
    if (this.toastMsg && ta < 1400) drawToast(g, this.toastMsg, ta);
  }
};

// ---------- page builders ----------
function homePage() {
  return {
    title: 'OPPD-1 · ' + (PRJ.name || 'PROJECT'),
    knobs: [0, 1, 2, 3].map(pi => {
      const kk = kNorm(['DRUM', 'SYN A', 'SYN B', 'SYN C'][pi], () => PRJ.parts[pi].level, v => { PRJ.parts[pi].level = v; applyMix(pi); }, v => PRJ.parts[pi].mute ? 'MUTE' : pct(v));
      kk.press = () => { PRJ.parts[pi].mute = !PRJ.parts[pi].mute; applyMix(pi); OS.toast(PART_NAMES[pi] + (PRJ.parts[pi].mute ? ' MUTED' : ' ON')); };
      return kk;
    }),
    hint: 'SELECT = OPEN · KNOB PRESS = MUTE',
    draw: drawHome
  };
}

function songPage() {
  const sc = OS.songCur;
  sc.row = clamp(sc.row, 0, PRJ.song.length - 1);
  const row = () => PRJ.song[sc.row];
  return {
    title: 'SONG · ' + PRJ.song.length + ' ROWS',
    knobs: [
      kInt('ROW', () => sc.row, v => { sc.row = v; }, 0, PRJ.song.length - 1, v => (v + 1) + '/' + PRJ.song.length, 6),
      kInt('PART', () => sc.col, v => { sc.col = v; }, 0, 3, v => ['DRM', 'SY.A', 'SY.B', 'SY.C'][v]),
      kInt('PATTERN', () => row().p[sc.col], v => { row().p[sc.col] = v; }, -1, 3, v => v < 0 ? '---' : PAT_NAMES[v]),
      kInt('REPEAT', () => row().rep, v => { row().rep = v; }, 1, 16, v => 'x' + v)
    ],
    hint: 'SELECT = ROW MENU · LOOP = SONG/LOOP',
    select() {
      OS.openMenu('ROW ' + (sc.row + 1), [
        { name: 'PLAY FROM HERE', fn: () => { PRJ.songMode = true; if (SEQ.playing) seqStop(); SEQ.row = sc.row; SEQ.step = 0; seqPlay(); } },
        { name: 'INSERT ROW', fn: () => { PRJ.song.splice(sc.row + 1, 0, { p: [0, 0, 0, 0], rep: 1 }); sc.row++; } },
        { name: 'DUPLICATE ROW', fn: () => { PRJ.song.splice(sc.row + 1, 0, clone(row())); sc.row++; } },
        { name: 'DELETE ROW', fn: () => { if (PRJ.song.length > 1) { PRJ.song.splice(sc.row, 1); sc.row = Math.min(sc.row, PRJ.song.length - 1); if (SEQ.row >= PRJ.song.length) SEQ.row = 0; } else OS.toast('LAST ROW'); } },
        { name: 'CANCEL' }
      ]);
    },
    draw: drawSong
  };
}

function projectPage() {
  return {
    title: 'PROJECT · ' + (PRJ.name || ''),
    knobs: [
      kInt('BPM', () => PRJ.bpm, v => { PRJ.bpm = v; for (let i = 0; i < 4; i++) { applyFx(i, 0); applyFx(i, 1); } }, 40, 240, v => v + '', 4),
      kNorm('SWING', () => PRJ.swing, v => { PRJ.swing = v; }, pct),
      kNorm('MASTER', () => PRJ.master, v => { PRJ.master = v; applyMaster(); }, pct),
      kInt('CLICK', () => PRJ.click ? 1 : 0, v => { PRJ.click = !!v; }, 0, 1, v => v ? 'ON' : 'OFF')
    ],
    hint: 'SELECT = MENU',
    select() {
      OS.openMenu('PROJECT', [
        { name: 'SAVE SONG', fn: () => APP.saveSong(false) },
        { name: 'SAVE SONG AS...', fn: () => APP.saveSong(true) },
        { name: 'LOAD SONG', fn: () => APP.loadSong() },
        { name: 'CLEAR PATTERNS', fn: () => OS.openMenu('CLEAR ALL PATTERNS?', [{ name: 'NO' }, { name: 'YES, CLEAR', fn: () => { clearAllPatterns(); OS.toast('PATTERNS CLEARED'); } }]) },
        { name: 'NEW PROJECT', fn: () => APP.newProject() },
        { name: 'LOAD DEMO', fn: () => APP.loadDemo() },
        { name: 'MIDI INPUT', fn: () => APP.enableMidi() },
        { name: 'CANCEL' }
      ]);
    },
    draw: drawProject
  };
}

function fxPage(pi, k) {
  const cfg = () => PRJ.parts[pi].fx[k];
  const def = () => FX_DEFS[cfg().type];
  const up = () => applyFx(pi, k);
  return {
    name: 'FX' + (k + 1),
    knobs: [
      kInt('TYPE', () => FX_TYPES.indexOf(cfg().type), v => { cfg().type = FX_TYPES[v]; up(); }, 0, FX_TYPES.length - 1, v => FX_TYPES[v]),
      { label: def().p[0], norm: () => cfg().p1, value: () => def().fmt[0](cfg().p1), turn: d => { cfg().p1 = clamp(cfg().p1 + d * 0.005, 0, 1); up(); } },
      { label: def().p[1], norm: () => cfg().p2, value: () => def().fmt[1](cfg().p2), turn: d => { cfg().p2 = clamp(cfg().p2 + d * 0.005, 0, 1); up(); } },
      kNorm('MIX', () => cfg().mix, v => { cfg().mix = v; up(); }, pct)
    ],
    draw: g => drawFx(g, pi, k)
  };
}

function patternMenu(pi) {
  const part = PRJ.parts[pi];
  OS.openMenu('PATTERN ' + PAT_NAMES[part.cur], [
    { name: 'CLEAR PATTERN', fn: () => { const p = part.patterns[part.cur]; if (part.kind === 'drum') { p.steps = p.steps.map(r => r.map(() => 0)); resetStepMeta(p); } else p.notes = []; OS.toast('CLEARED'); } },
    { name: 'COPY TO NEXT', fn: () => { const nx = (part.cur + 1) % 4; part.patterns[nx] = clone(part.patterns[part.cur]); part.cur = nx; OS.toast('COPIED TO ' + PAT_NAMES[nx]); } },
    { name: 'CANCEL' }
  ]);
}

function setPatLen(part, len) {
  const pat = part.patterns[part.cur], old = pat.len;
  if (len > old && !pat.notes.some(n => n.s >= old)) {
    // growing an empty tail repeats what is already there
    const add = [];
    for (let o = old; o < len; o += old) pat.notes.forEach(n => { if (n.s < old && n.s + o < len) add.push({ s: n.s + o, n: n.n, l: n.l }); });
    pat.notes = pat.notes.concat(add);
  }
  pat.len = len;
}

function partPages(pi) {
  const part = PRJ.parts[pi];
  const pages = part.kind === 'drum' ? drumPages(pi, part) : synthPages(pi, part);
  const title = partTitle(pi);
  pages.forEach(p => { p.title = title; });
  return pages;
}

function synthPages(pi, part) {
  const E = ENGINES[part.engine], rt = RT[pi], c = CURSOR[pi];
  const pat = () => part.patterns[part.cur];
  const presets = allPresets();
  return [
    {
      name: 'SOUND', hint: E.hint,
      knobs: E.params.slice(0, 4).map(d => { const k = kParam(pi, d); if (E.press && E.press[d.id]) k.press = () => E.press[d.id](pi); return k; }),
      draw: g => drawSound(g, pi)
    },
    { name: 'SHAPE', knobs: E.params.slice(4, 8).map(d => kParam(pi, d)), draw: g => drawShape(g, pi) },
    {
      name: 'ARP',
      knobs: [
        kInt('MODE', () => part.arp.mode, v => setArpMode(pi, v), 0, ARP_MODES.length - 1, v => ARP_MODES[v]),
        kInt('RATE', () => part.arp.rate, v => { part.arp.rate = v; }, 0, ARP_RATES.length - 1, v => ARP_RATES[v][0]),
        kInt('OCTAVES', () => part.arp.oct, v => { part.arp.oct = v; }, 1, 4),
        kNorm('GATE', () => (part.arp.gate - 0.05) / 0.95, v => { part.arp.gate = 0.05 + v * 0.95; }, v => pct(0.05 + v * 0.95))
      ],
      hint: 'SELECT = HOLD ' + (part.arp.hold ? 'OFF' : 'ON'),
      select() { setArpHold(pi, !part.arp.hold); OS.toast('HOLD ' + (part.arp.hold ? 'ON' : 'OFF')); },
      draw: g => drawArp(g, pi)
    },
    fxPage(pi, 0), fxPage(pi, 1),
    {
      name: 'MIX',
      knobs: [
        kNorm('LEVEL', () => part.level, v => { part.level = v; applyMix(pi); }, pct),
        kNorm('PAN', () => part.pan, v => { part.pan = v; applyMix(pi); }, fmtPan),
        kInt('OCTAVE', () => part.octave, v => { part.octave = v; }, -3, 3, v => (v > 0 ? '+' : '') + v),
        kInt('PAT LEN', () => PAT_LENS.indexOf(pat().len), v => setPatLen(part, PAT_LENS[v]), 0, PAT_LENS.length - 1, v => PAT_LENS[v] + ' st')
      ],
      draw: g => drawMix(g, pi)
    },
    {
      name: 'NOTES',
      knobs: [
        kInt('STEP', () => c.step, v => { c.step = v; }, 0, pat().len - 1, v => (v + 1) + '/' + pat().len, 5),
        kInt('PITCH', () => c.pitch, v => { c.pitch = v; }, 0, 127, noteName, 5),
        kInt('LENGTH', () => c.len, v => { c.len = v; const n = pat().notes.find(x => x.s === c.step && x.n === c.pitch); if (n) n.l = v; }, 1, 64, v => v + ' st', 6),
        Object.assign(kInt('PATTERN', () => part.cur, v => { part.cur = v; c.step = Math.min(c.step, part.patterns[v].len - 1); }, 0, 3, v => PAT_NAMES[v]), { press: () => patternMenu(pi) })
      ],
      hint: 'SELECT = ADD/DEL · K4 PRESS = MENU',
      select() {
        const p = pat(), i = p.notes.findIndex(n => n.s === c.step && n.n === c.pitch);
        if (i >= 0) p.notes.splice(i, 1);
        else {
          p.notes.push({ s: c.step, n: c.pitch, l: c.len });
          if (!SEQ.playing) { const v = voiceOn(pi, c.pitch, 0.9, AC.currentTime); voiceOff(v, AC.currentTime + 0.25); }
        }
      },
      draw: g => drawNotes(g, pi)
    },
    {
      name: 'PRESET',
      knobs: [
        kInt('PRESET', () => OS.presetSel[pi], v => { OS.presetSel[pi] = v; }, 0, presets.length - 1, v => presets[v].name, 6),
        kInt('ENGINE', () => ENGINE_LIST.indexOf(part.engine), v => { changeEngine(pi, ENGINE_LIST[v]); }, 0, ENGINE_LIST.length - 1, v => ENGINES[ENGINE_LIST[v]].name, 14),
        kNone(),
        { label: 'SAVE', value: () => 'PRESS', norm: null, turn() { }, press: () => { OS.toast('SAVED ' + saveUserPreset(part)); } }
      ],
      hint: 'SELECT = LOAD',
      select() {
        const pr = presets[OS.presetSel[pi]];
        if (pr) { loadPreset(pi, pr.name); OS.toast(pr.name); }
      },
      draw: g => drawPresets(g, pi, presets.map(p => [p.name, ENGINES[p.engine].name]), part.preset)
    }
  ];
}

function drumPages(pi, part) {
  const rs = () => part.rows[part.rowSel];
  const rowK = kInt('ROW', () => part.rowSel, v => { part.rowSel = v; }, 0, 4, v => (v + 1) + ' ' + part.rows[v].sound);
  rowK.press = () => drumHit(pi, part.rowSel, 1, AC.currentTime);
  const rp = (label, id, fmt, apply) => kNorm(label, () => rs()[id], v => { rs()[id] = v; if (apply) DRUM.applyRow(RT[pi], rs(), part.rowSel); }, fmt);
  const audition = () => drumHit(pi, part.rowSel, 1, AC.currentTime);
  return [
    {
      name: 'KIT',
      knobs: [rowK,
        kInt('SOUND', () => DRUM_SOUNDS.indexOf(rs().sound), v => { rs().sound = DRUM_SOUNDS[v]; audition(); }, 0, DRUM_SOUNDS.length - 1, v => DRUM_SOUNDS[v]),
        rp('TUNE', 'tune', v => { const s = (v - 0.5) * 24; return (s > 0 ? '+' : '') + s.toFixed(1); }),
        rp('DECAY', 'decay', pct)],
      hint: 'SELECT = PLAY ROW',
      select: audition,
      draw: g => drawKit(g, pi)
    },
    {
      name: 'VOICE',
      knobs: [rowK, rp('TONE', 'tone', pct), rp('LEVEL', 'level', pct, true), rp('PAN', 'pan', fmtPan, true)],
      hint: 'SELECT = PLAY ROW',
      select: audition,
      draw: g => drawKit(g, pi)
    },
    fxPage(pi, 0), fxPage(pi, 1),
    {
      name: 'MIX',
      knobs: [
        kNorm('LEVEL', () => part.level, v => { part.level = v; applyMix(pi); }, pct),
        kNorm('PAN', () => part.pan, v => { part.pan = v; applyMix(pi); }, fmtPan),
        kNorm('SWING', () => PRJ.swing, v => { PRJ.swing = v; }, pct),
        Object.assign(kInt('PATTERN', () => part.cur, v => { part.cur = v; }, 0, 3, v => PAT_NAMES[v]), { press: () => patternMenu(pi) })
      ],
      hint: 'K4 PRESS = PATTERN MENU',
      draw: g => drawMix(g, pi)
    },
    {
      name: 'PRESET',
      knobs: [kInt('KIT', () => OS.presetSel[pi], v => { OS.presetSel[pi] = v; }, 0, KITS.length - 1, v => KITS[v].name, 8), kNone(), kNone(), kNone()],
      hint: 'SELECT = LOAD KIT',
      select() { const k = KITS[OS.presetSel[pi]]; loadKit(pi, k.name); OS.toast(k.name); },
      draw: g => drawPresets(g, pi, KITS.map(k => [k.name, 'KIT']), part.kit)
    }
  ];
}

function partTitle(pi) {
  const p = PRJ.parts[pi];
  return (pi + 1) + ' ' + PART_NAMES[pi] + ' · ' + (p.kind === 'drum' ? p.kit : ENGINES[p.engine].name + ' · ' + p.preset);
}

// ---------- drawing ----------
function T(g, s, x, y, size, col, align, weight, fam) {
  g.font = (weight || 400) + ' ' + size + 'px ' + (fam || MONO);
  g.fillStyle = col; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

function drawBoot(g, os) {
  const t = (performance.now() - os.bootT) / 1000;
  T(g, 'OPPD-1', 200, 74, 34, C.ink, 'center', 700, SANS);
  const wave = { bob: Math.sin(t * 6) * 0.8, lean: 0, armL: 2.6, armR: -0.4 - Math.abs(Math.sin(t * 7)) * 0.7, legL: 0, legR: 0, eyes: t % 1.7 < 0.1 ? 'closed' : 'happy', look: 0, mouth: 'smile', antenna: Math.sin(t * 5) * 0.3 };
  drawBot(g, 336, 118, 0.9, wave);
  T(g, 'the Oil inc. · OS 1.0', 200, 92, 10, C.dim, 'center');
  g.fillStyle = C.line; g.fillRect(120, 104, 160, 4);
  g.fillStyle = C.accent; g.fillRect(120, 104, 160 * Math.min(1, t / 1.4), 4);
  if (t > 1.6) os.screen = 'home';
}

function drawHeader(g, title) {
  g.font = '400 10px ' + MONO;
  let x = 390;
  T(g, PRJ.bpm + ' BPM', x, 14, 10, C.accent, 'right');
  x -= g.measureText(PRJ.bpm + ' BPM').width + 10;
  T(g, PRJ.songMode ? 'SONG' : 'LOOP', x, 14, 10, C.dim, 'right');
  x -= g.measureText('SONG').width + 10;
  // transport icon
  g.fillStyle = SEQ.playing ? C.accent : C.dim;
  if (SEQ.playing) { g.beginPath(); g.moveTo(x - 7, 6); g.lineTo(x, 10); g.lineTo(x - 7, 14); g.fill(); }
  else g.fillRect(x - 7, 6, 7, 7);
  x -= 12;
  if (SEQ.rec) { g.fillStyle = (performance.now() % 1000 < 600) ? C.rec : '#6b2a1c'; g.beginPath(); g.arc(x - 4, 10, 4, 0, Math.PI * 2); g.fill(); x -= 12; }
  g.save(); g.beginPath(); g.rect(0, 0, x - 6, 20); g.clip();
  T(g, title, 10, 14, 10, C.ink);
  g.restore();
}

function drawTabs(g, tabs, cur) {
  let x = 10;
  g.font = '400 8px ' + MONO;
  tabs.forEach((n, i) => {
    const w = g.measureText(n).width;
    T(g, n, x, 30, 8, i === cur ? C.accent : C.dim);
    if (i === cur) { g.fillStyle = C.accent; g.fillRect(x, 33, w, 1.5); }
    x += w + 11;
  });
}

function drawKnobCells(g, knobs, os) {
  const now = performance.now();
  for (let i = 0; i < 4; i++) {
    const k = knobs[i], x = 8 + i * 96, y = 117, w = 92;
    g.fillStyle = now - os.touched[i] < 700 ? C.hi : C.cell;
    rrect(g, x, y, w, 38, 5); g.fill();
    if (!k || !k.label) continue;
    T(g, k.label, x + 6, y + 11, 8.5, KC[i]);
    let v = k.value();
    g.font = '600 12px ' + MONO;
    while (v.length > 3 && g.measureText(v).width > w - 12) v = v.slice(0, -1);
    T(g, v, x + 6, y + 26, 12, C.ink, 'left', 600);
    if (k.norm) {
      g.fillStyle = C.line; g.fillRect(x + 6, y + 31, w - 12, 3);
      g.fillStyle = KC[i]; g.fillRect(x + 6, y + 31, (w - 12) * clamp(k.norm(), 0, 1), 3);
    }
  }
}

function drawMenu(g, m) {
  // the box grows with its longest line (title or item)
  g.font = '400 8.5px ' + MONO;
  let tw = g.measureText(m.title).width;
  g.font = '600 9px ' + MONO;
  m.items.forEach(it => { tw = Math.max(tw, g.measureText(it.name).width); });
  const h = m.items.length * 12 + 22, y = clamp(80 - h / 2, 18, 156 - h), w = clamp(tw + 24, 184, 384), x = 200 - w / 2;
  g.fillStyle = 'rgba(10,12,11,0.92)'; g.fillRect(0, 0, 400, 160);
  g.fillStyle = '#0e100f'; rrect(g, x, y, w, h, 6); g.fill();
  g.strokeStyle = C.accent; g.lineWidth = 1; rrect(g, x + 0.5, y + 0.5, w - 1, h - 1, 6); g.stroke();
  T(g, m.title, x + 10, y + 13, 8.5, C.dim);
  m.items.forEach((it, i) => {
    const yy = y + 18 + i * 12;
    if (i === m.sel) { g.fillStyle = C.accent; g.fillRect(x + 4, yy, w - 8, 11); }
    T(g, it.name, x + 10, yy + 8.5, 9, i === m.sel ? '#141716' : C.ink, 'left', i === m.sel ? 600 : 400);
  });
}

function drawToast(g, msg, age) {
  const a = age > 1100 ? 1 - (age - 1100) / 300 : 1;
  g.globalAlpha = a;
  g.font = '600 10px ' + MONO;
  const w = g.measureText(msg).width + 20;
  g.fillStyle = C.accent; rrect(g, 200 - w / 2, 92, w, 17, 4); g.fill();
  T(g, msg, 200, 104, 10, '#141716', 'center', 600);
  g.globalAlpha = 1;
}

function drawScope(g, an, x, y, w, h, col) {
  if (!an._buf) an._buf = new Float32Array(an.fftSize);
  const b = an._buf;
  an.getFloatTimeDomainData(b);
  const cy = y + h / 2;
  g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
  let st = 0;
  const half = b.length >> 1;
  for (let i = 1; i < half; i++) if (b[i - 1] < 0 && b[i] >= 0) { st = i; break; }
  const n = Math.min(half, b.length - st);
  g.strokeStyle = col || C.accent; g.lineWidth = 1.6; g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < w; i++) {
    const v = b[st + Math.floor(i / w * n)] || 0;
    const yy = cy - clamp(v * 2.2, -1, 1) * h / 2;
    if (i) g.lineTo(x + i, yy); else g.moveTo(x, yy);
  }
  g.stroke();
}

function drawMeterBar(g, x, y, w, h, v, col) {
  g.fillStyle = C.line; g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x, y, w * clamp(v, 0, 1), h);
}

function drawHome(g) {
  HOME_ITEMS.forEach((name, i) => {
    const y = 37 + i * 12, sel = OS.homeSel === i;
    if (sel) { g.fillStyle = C.hi; g.fillRect(6, y, 232, 11); g.fillStyle = C.accent; g.fillRect(6, y, 2, 11); }
    T(g, name, 14, y + 8, 9, sel ? C.accent : C.ink, 'left', sel ? 600 : 400);
    let sub = '';
    if (i < 4) {
      const p = PRJ.parts[i];
      sub = p.kind === 'drum' ? p.kit : p.preset;
      drawMeterBar(g, 196, y + 3.5, 36, 4, UI.act[i], p.mute ? C.faint : (i === 0 ? ROW_COLORS[0] : KC[i]));
      if (p.mute) T(g, 'M', 186, y + 8, 8, C.rec, 'left', 600);
    } else if (i === 4) sub = PRJ.song.length + ' ROWS · ' + (PRJ.songMode ? 'SONG' : 'LOOP');
    else sub = PRJ.bpm + ' BPM';
    T(g, sub, 72, y + 8, 8, C.dim);
  });
  g.strokeStyle = C.line; g.lineWidth = 1;
  rrect(g, 246.5, 38.5, 144, 62, 4); g.stroke();
  g.save(); g.beginPath(); g.rect(247, 39, 143, 61); g.clip();
  g.globalAlpha = 0.3; drawScope(g, AU.analyser, 250, 41, 136, 56, C.accent); g.globalAlpha = 1;
  const now = performance.now(), dt = Math.min(0.1, (now - (OS.lastHome || now)) / 1000);
  OS.lastHome = now;
  drawBotNotes(g, 318, 96, dt);
  drawBot(g, 318, 96, 1, botPose());
  g.restore();
}

function drawSong(g) {
  const cols = [['#', 14], ['DRM', 48], ['SY.A', 92], ['SY.B', 136], ['SY.C', 180], ['REP', 226], ['BARS', 266]];
  cols.forEach(([n, x]) => T(g, n, x, 44, 8, C.dim));
  const sc = OS.songCur;
  const first = clamp(sc.row - 2, 0, Math.max(0, PRJ.song.length - 5));
  for (let j = 0; j < 5; j++) {
    const ri = first + j;
    if (ri >= PRJ.song.length) break;
    const r = PRJ.song[ri], y = 47 + j * 11.5, cur = ri === sc.row;
    if (cur) { g.fillStyle = C.hi; g.fillRect(6, y, 290, 11.5); }
    if (SEQ.playing && PRJ.songMode && UI.row === ri) {
      g.fillStyle = C.accent; g.beginPath(); g.moveTo(5, y + 2); g.lineTo(10, y + 5.75); g.lineTo(5, y + 9.5); g.fill();
    }
    T(g, String(ri + 1), 14, y + 9, 9, cur ? C.accent : C.ink);
    r.p.forEach((pv, pi) => {
      const x = cols[pi + 1][1];
      if (cur && sc.col === pi) { g.fillStyle = KC[2]; g.fillRect(x - 3, y + 0.5, 30, 10.5); }
      T(g, pv < 0 ? '---' : PAT_NAMES[pv], x, y + 9, 9, cur && sc.col === pi ? '#141716' : (pv < 0 ? C.dim : C.ink), 'left', 600);
    });
    T(g, 'x' + r.rep, 226, y + 9, 9, C.ink);
    T(g, String(rowSteps(r) * r.rep / 16), 266, y + 9, 9, C.dim);
  }
  T(g, PRJ.songMode ? 'SONG' : 'LOOP', 390, 60, 16, PRJ.songMode ? C.accent : C.ink, 'right', 700, SANS);
  T(g, 'MODE', 390, 72, 8, C.dim, 'right');
  const total = PRJ.song.reduce((a, r) => a + rowSteps(r) * r.rep / 16, 0);
  T(g, total + ' BARS', 390, 86, 8.5, C.dim, 'right');
}

function drawProject(g) {
  T(g, String(PRJ.bpm), 12, 78, 40, C.ink, 'left', 700, SANS);
  T(g, 'BPM', 12, 92, 9, C.dim);
  const lines = [['PROJECT', PRJ.name || '-'], ['SWING', pct(PRJ.swing)], ['MASTER', pct(PRJ.master)], ['CLICK', PRJ.click ? 'ON' : 'OFF'], ['SONG', PRJ.song.length + ' ROWS']];
  lines.forEach(([a, b], i) => { T(g, a, 170, 48 + i * 12, 9, C.dim); T(g, b, 240, 48 + i * 12, 9, C.ink); });
}

function drawSound(g, pi) {
  const p = PRJ.parts[pi];
  T(g, ENGINES[p.engine].name, 12, 58, 20, C.ink, 'left', 700, SANS);
  T(g, p.preset, 12, 72, 9, C.dim);
  const tags = [];
  if (arpOn(p)) tags.push('ARP ' + ARP_MODES[p.arp.mode]);
  p.fx.forEach(f => { if (f.type !== 'OFF') tags.push(f.type); });
  tags.slice(0, 3).forEach((s, i) => T(g, s, 12, 86 + i * 10, 8, C.accent));
  if (p.engine === 'grain') drawGrainView(g, pi, 150, 40, 238, 62);
  else if (p.engine === 'fold') drawFoldView(g, pi, 150, 40, 238, 66);
  else if (ENGINES[p.engine].view) ENGINES[p.engine].view(g, pi, 150, 40, 238, 66);
  else drawScope(g, RT[pi].an, 150, 40, 238, 66, C.accent);
}

function drawShape(g, pi) {
  const p = PRJ.parts[pi], e = ENGINES[p.engine].env(p.params);
  const hold = Math.max(0.15, (e.a + e.d + e.r) * 0.25);
  const total = e.a + e.d + hold + e.r;
  const x0 = 14, w = 372, y0 = 106, h = 62;
  const X = s => x0 + s / total * w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(X(e.a), y0 - h);
  for (let i = 1; i <= 20; i++) { const tt = e.d * i / 20; g.lineTo(X(e.a + tt), y0 - h * (e.s + (1 - e.s) * Math.exp(-tt / Math.max(0.001, e.d / 3)))); }
  const sx = X(e.a + e.d + hold);
  g.lineTo(sx, y0 - h * e.s);
  for (let i = 1; i <= 20; i++) { const tt = e.r * i / 20; g.lineTo(X(e.a + e.d + hold + tt), y0 - h * e.s * Math.exp(-tt / Math.max(0.001, e.r / 4))); }
  g.lineTo(x0 + w, y0);
  g.globalAlpha = 0.12; g.fillStyle = C.accent; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = C.accent; g.lineWidth = 1.6; g.stroke();
  g.strokeStyle = C.line; g.beginPath(); g.moveTo(x0, y0 + 0.5); g.lineTo(x0 + w, y0 + 0.5); g.stroke();
  T(g, 'A ' + fmtSec(e.a) + '  D ' + fmtSec(e.d) + '  S ' + pct(e.s) + '  R ' + fmtSec(e.r), 386, 46, 8, C.dim, 'right');
}

function drawArp(g, pi) {
  const p = PRJ.parts[pi], rt = RT[pi];
  T(g, ARP_MODES[p.arp.mode], 12, 60, 20, p.arp.mode ? C.accent : C.dim, 'left', 700, SANS);
  T(g, ARP_RATES[p.arp.rate][0] + ' · ' + p.arp.oct + ' OCT · GATE ' + pct(p.arp.gate), 12, 74, 9, C.dim);
  T(g, 'HOLD ' + (p.arp.hold ? 'ON' : 'OFF'), 12, 88, 9, p.arp.hold ? C.accent : C.dim, 'left', 600);
  const { out } = arpSeq(rt, p);
  const names = [];
  rt.held.forEach(h => { const s = noteName(h.n); if (!names.includes(s)) names.push(s); });
  T(g, names.length ? names.slice(0, 8).join(' ') : 'PLAY SOME NOTES', 388, 50, 9, names.length ? C.ink : C.dim, 'right');
  const n = Math.min(16, out.length);
  const cur = out.length ? ((rt.arpI - 1) % out.length + out.length) % out.length : -1;
  for (let i = 0; i < 16; i++) {
    const x = 160 + i * 14, on = i < n;
    const lit = on && i === cur && AC.currentTime - (rt.arpLast || 0) < 0.25;
    g.fillStyle = lit ? C.accent : on ? C.faint : C.cell;
    const hh = on ? 10 + ((out[i] - out[0]) % 36) * 0.8 : 4;
    g.fillRect(x, 100 - hh, 10, hh);
  }
}

function drawFx(g, pi, k) {
  const cfg = PRJ.parts[pi].fx[k];
  T(g, 'FX' + (k + 1), 12, 46, 8.5, C.dim);
  T(g, cfg.type, 12, 66, 20, cfg.type === 'OFF' ? C.dim : C.ink, 'left', 700, SANS);
  if (cfg.type !== 'OFF') {
    const d = FX_DEFS[cfg.type];
    T(g, d.p[0] + ' ' + d.fmt[0](cfg.p1), 12, 82, 8.5, C.dim);
    T(g, d.p[1] + ' ' + d.fmt[1](cfg.p2), 12, 93, 8.5, C.dim);
    T(g, 'MIX ' + pct(cfg.mix), 12, 104, 8.5, C.dim);
  }
  drawFxGraphic(g, cfg, 160, 40, 228, 64);
  drawFxExtras(g, cfg, 160, 40, 228, 64);
}

function drawFxGraphic(g, cfg, x, y, w, h) {
  const t = performance.now() / 1000, cy = y + h / 2, p1 = cfg.p1, p2 = cfg.p2;
  g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
  g.strokeStyle = C.accent; g.fillStyle = C.accent; g.lineWidth = 1.6;
  const wave = (fn) => { g.beginPath(); for (let i = 0; i <= w; i += 2) { const yy = cy - clamp(fn(i / w), -1, 1) * h * 0.45; if (i) g.lineTo(x + i, yy); else g.moveTo(x, yy); } g.stroke(); };
  switch (cfg.type) {
    case 'OFF': break;
    case 'DELAY': {
      const sp = 12 + p1 * 46;
      let a = 1;
      for (let i = 0; x + 4 + i * sp < x + w && a > 0.03; i++) { const hh = a * h * 0.9; g.fillRect(x + 4 + i * sp, cy - hh / 2, 3, hh); a *= i === 0 ? 0.9 : p2 * 0.95; }
      break;
    }
    case 'REVERB': {
      const len = w * (0.25 + p1 * 0.75);
      g.globalAlpha = 1 - p2 * 0.5;
      for (let i = 0; i < len; i += 2) { const r = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1; const hh = Math.pow(1 - i / len, 2) * (0.3 + 0.7 * r) * h * 0.9; g.fillRect(x + i, cy - hh / 2, 1.2, hh); }
      g.globalAlpha = 1;
      break;
    }
    case 'CHORUS': case 'FLANGER': case 'PHASER': {
      const r = expmap(p1, 0.1, 6);
      g.globalAlpha = 0.45; wave(u => Math.sin(u * 18 + t * 2 + Math.sin(t * r) * p2 * 3) * 0.8); g.globalAlpha = 1;
      wave(u => Math.sin(u * 18 + t * 2) * 0.8);
      break;
    }
    case 'DISTORT': { const kk = 1 + p1 * p1 * 40; wave(u => Math.tanh(kk * Math.sin(u * 14 + t * 2)) / Math.tanh(kk)); break; }
    case 'BITCRUSH': {
      const lv = clamp(Math.round(Math.pow(2, (16 - p1 * 14) / 2.6)), 2, 64), hw = 2 + p2 * p2 * 24;
      wave(u => { const uu = Math.floor(u * w / hw) * hw / w; return Math.round(Math.sin(uu * 14 + t * 2) * lv) / lv; });
      break;
    }
    case 'FILTER': {
      const mod = p2 < 0.02 ? 1 : Math.pow(2, 2 * Math.sin(t * expmap(p2, 0.1, 12) * Math.PI * 2));
      const fc = expmap(p1, 80, 14000) * mod;
      g.beginPath();
      for (let i = 0; i <= w; i += 2) {
        const f = expmap(i / w, 20, 20000), r = f / fc;
        const mag = 1 / Math.sqrt((1 - r * r) * (1 - r * r) + (r / 7) * (r / 7));
        const db = clamp(20 * Math.log10(mag), -36, 18);
        const yy = cy - db / 36 * h * 0.6 + 6;
        if (i) g.lineTo(x + i, yy); else g.moveTo(x, yy);
      }
      g.stroke();
      break;
    }
    case 'TREMOLO': { const r = expmap(p1, 0.5, 16); wave(u => Math.sin(u * 40) * (1 - p2 * (0.5 + 0.5 * Math.sin(u * r * 2 + t * r)))); break; }
  }
}

function drawMix(g, pi) {
  const p = PRJ.parts[pi];
  const lv = UI.act[pi];
  g.fillStyle = C.line; g.fillRect(14, 42, 8, 64);
  g.fillStyle = p.mute ? C.faint : C.accent; g.fillRect(14, 106 - 64 * lv, 8, 64 * lv);
  T(g, 'LEVEL ' + pct(p.level) + (p.mute ? ' · MUTE' : ''), 34, 52, 9, C.ink);
  g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(34, 70); g.lineTo(190, 70); g.stroke();
  g.fillStyle = KC[1]; g.fillRect(34 + p.pan * 152, 65, 4, 10);
  T(g, 'L', 34, 86, 8, C.dim); T(g, 'R', 190, 86, 8, C.dim, 'right');
  const pat = p.patterns[p.cur];
  const lines = p.kind === 'drum'
    ? ['PATTERN ' + PAT_NAMES[p.cur], '16 STEPS', 'SWING ' + pct(PRJ.swing)]
    : ['PATTERN ' + PAT_NAMES[p.cur], pat.len + ' STEPS · ' + pat.notes.length + ' NOTES', 'OCTAVE ' + (p.octave > 0 ? '+' : '') + p.octave];
  lines.forEach((s, i) => T(g, s, 388, 52 + i * 12, 9, i ? C.dim : C.ink, 'right'));
  drawScope(g, RT[pi].an, 210, 84, 178, 24, C.accent);
}

function drawNotes(g, pi) {
  // the whole pattern on one screen: the step width shrinks with the pattern length (16..64 steps)
  const p = PRJ.parts[pi], c = CURSOR[pi], pat = p.patterns[p.cur], len = pat.len;
  const x0 = 26, w = 362, y0 = 38, rows = 12, rh = 6, cw = w / len, gap = cw > 12 ? 1 : 0.5;
  const top = c.pitch + 6;
  for (let r = 0; r < rows; r++) {
    const n = top - r;
    const black = [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);
    g.fillStyle = black ? C.bg : C.cell;
    g.fillRect(x0, y0 + r * rh, w, rh - 0.5);
    if (n % 12 === 0) T(g, noteName(n), 4, y0 + r * rh + 5.5, 6.5, C.dim);
  }
  // beat lines every 4 steps, stronger bar lines every 16
  for (let s = 0; s <= len; s += 4) {
    g.fillStyle = C.line; g.globalAlpha = s % 16 ? 0.45 : 1;
    g.fillRect(x0 + s * cw, y0, s % 16 ? 1 : 1.5, rows * rh);
  }
  g.globalAlpha = 1;
  const ph = UI.ph[pi];
  if (SEQ.playing && ph && ph.pat === p.cur && ph.step < len) {
    g.fillStyle = 'rgba(233,238,233,0.12)'; g.fillRect(x0 + ph.step * cw, y0, cw, rows * rh);
  }
  pat.notes.forEach(n => {
    const r = top - n.n;
    if (r < 0 || r >= rows || n.s >= len) return;
    const s1 = Math.min(n.s + n.l, len);
    g.fillStyle = n.s === c.step && n.n === c.pitch ? '#ffffff' : C.accent;
    g.fillRect(x0 + n.s * cw + gap, y0 + r * rh, Math.max(1, (s1 - n.s) * cw - gap * 2), rh - 1);
  });
  // notes above / below the visible pitch range
  if (pat.notes.some(n => n.n > top && n.s < len)) T(g, '▲', 22, 44, 6, C.accent, 'right');
  if (pat.notes.some(n => n.n <= top - rows && n.s < len)) T(g, '▼', 22, 110, 6, C.accent, 'right');
  g.strokeStyle = '#ffffff'; g.lineWidth = 1;
  g.strokeRect(x0 + c.step * cw + 0.5, y0 + (top - c.pitch) * rh + 0.5, Math.max(1, cw - 1), rh - 1);
  T(g, 'PAT ' + PAT_NAMES[p.cur] + ' · ' + len + ' STEPS · BAR ' + (Math.floor(c.step / 16) + 1) + '/' + Math.ceil(len / 16), 26, 112, 8, C.dim);
}

function drawPresets(g, pi, list, curName) {
  const sel = OS.presetSel[pi];
  const first = clamp(sel - 2, 0, Math.max(0, list.length - 5));
  for (let j = 0; j < 5; j++) {
    const i = first + j;
    if (i >= list.length) break;
    const y = 40 + j * 13, on = i === sel;
    if (on) { g.fillStyle = C.hi; g.fillRect(6, y, 388, 12); g.fillStyle = C.accent; g.fillRect(6, y, 2, 12); }
    T(g, list[i][0], 16, y + 9, 9.5, on ? C.accent : C.ink, 'left', on ? 600 : 400);
    T(g, list[i][1], 340, y + 9, 8, C.dim, 'right');
    if (list[i][0] === curName) T(g, '●', 384, y + 9, 8, C.accent, 'right');
  }
  T(g, (sel + 1) + '/' + list.length, 12, 111, 8, C.dim);
}

function drawKit(g, pi) {
  const p = PRJ.parts[pi];
  p.rows.forEach((r, i) => {
    const y = 38 + i * 14.5, on = i === p.rowSel;
    if (on) { g.fillStyle = C.hi; g.fillRect(6, y, 144, 13); }
    g.fillStyle = ROW_COLORS[i]; g.fillRect(10, y + 3.5, 6, 6);
    T(g, '0' + (i + 1), 22, y + 9.5, 9, C.dim);
    T(g, r.sound, 42, y + 9.5, 9.5, on ? C.accent : C.ink, 'left', on ? 600 : 400);
  });
  const r = p.rows[p.rowSel];
  T(g, r.sound, 160, 52, 16, C.ink, 'left', 700, SANS);
  T(g, 'TUNE ' + ((r.tune - 0.5) * 24).toFixed(1) + '  DEC ' + pct(r.decay) + '  TONE ' + pct(r.tone), 160, 64, 8, C.dim);
  drawScope(g, RT[pi].an, 160, 70, 228, 38, ROW_COLORS[p.rowSel]);
}

// GRAIN: the source waveform, the read position with its spray, and the grains as they play
function drawGrainView(g, pi, x, y, w, h) {
  const part = PRJ.parts[pi], p = part.params, rt = RT[pi], buf = grainBuffer(rt, part);
  const name = GRAIN_SOURCES[idxOf(p.source, GRAIN_SOURCES.length)];
  T(g, name + (name === 'RESAMPLE' && !part.sample ? ' (EMPTY: CHOIR)' : ''), x + w, y + 7, 7.5, C.dim, 'right');
  if (!buf) { T(g, 'RENDERING...', x + w / 2, y + h / 2, 9, C.dim, 'center'); return; }
  if (!buf._pk || buf._pk.length !== w) {
    const d = buf.getChannelData(0), pk = new Float32Array(w), n = Math.floor(d.length / w);
    for (let i = 0; i < w; i++) { let m = 0; for (let j = i * n; j < (i + 1) * n; j += 4) m = Math.max(m, Math.abs(d[j])); pk[i] = m; }
    buf._pk = pk;
  }
  const cy = y + 10 + (h - 10) / 2, hh = (h - 12) / 2;
  // spray region around the read position
  const sp = p.spray * p.spray * 0.5;
  g.globalAlpha = 0.08; g.fillStyle = C.accent;
  g.fillRect(x + (p.position - sp) * w, y + 10, sp * 2 * w, h - 10);
  g.globalAlpha = 1;
  g.fillStyle = C.faint;
  for (let i = 0; i < w; i++) { const v = buf._pk[i] * hh; g.fillRect(x + i, cy - v, 1, v * 2 || 0.5); }
  const now = AC.currentTime;
  (rt.eng.recent || []).forEach(r => {
    const age = now - r.t;
    if (age < 0 || age > 0.35) return;
    g.globalAlpha = 1 - age / 0.35;
    g.fillStyle = C.accent;
    g.fillRect(x + r.f * w, y + 12, Math.max(1.5, r.w * w), h - 14);
  });
  g.globalAlpha = 1;
  g.fillStyle = C.ink; g.fillRect(x + p.position * w - 0.5, y + 10, 1.5, h - 10);
}

// FOLD: one cycle of the folded wave at rest (dim) and at the envelope peak (bright), with a small live scope
function drawFoldView(g, pi, x, y, w, h) {
  const p = PRJ.parts[pi].params, cy = y + h * 0.4, hh = h * 0.36;
  g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x, cy); g.lineTo(x + w, cy); g.stroke();
  [[true, C.faint, 1.2], [false, C.accent, 1.8]].forEach(([env, col, lw]) => {
    if (env && p.foldenv < 0.01) return;
    g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= w; i++) { const yy = cy - foldShape(p, env, i / w) * hh; if (i) g.lineTo(x + i, yy); else g.moveTo(x, yy); }
    g.stroke();
  });
  T(g, 'PEAK', x + w, y + 6, 7, C.dim, 'right');
  drawScope(g, RT[pi].an, x, y + h - 14, w, 14, KC[3]);
}

// ---------- STEP EDIT (drum step velocity / chance / ratchet) ----------
let stepAuditionT = 0;
function stepAudition(r, v) {
  if (SEQ.playing || performance.now() - stepAuditionT < 140) return;
  stepAuditionT = performance.now();
  drumHit(0, r, v, AC.currentTime);
}
function stepPage() {
  const part = PRJ.parts[0], se = OS.stepEdit, pat = () => stepMeta(part.patterns[part.cur]);
  const stepK = kInt('STEP', () => se.r * 16 + se.s, v => { se.r = Math.floor(v / 16); se.s = v % 16; part.rowSel = se.r; }, 0, 79,
    v => 'R' + (Math.floor(v / 16) + 1) + '·' + String(v % 16 + 1).padStart(2, '0'), 6);
  stepK.press = () => { const p = pat(); p.steps[se.r][se.s] = p.steps[se.r][se.s] ? 0 : 1; if (p.steps[se.r][se.s]) stepAudition(se.r, p.vel[se.r][se.s]); };
  const chanceIdx = () => { const p = pat().prob[se.r][se.s]; let bi = 0; STEP_CHANCE.forEach((c, i) => { if (Math.abs(c - p) < Math.abs(STEP_CHANCE[bi] - p)) bi = i; }); return bi; };
  return {
    title: 'STEP EDIT · ' + (se.r + 1) + ' ' + part.rows[se.r].sound + ' · PAT ' + PAT_NAMES[part.cur],
    knobs: [
      stepK,
      kNorm('VELOCITY', () => pat().vel[se.r][se.s], v => { pat().vel[se.r][se.s] = Math.max(0.05, v); stepAudition(se.r, Math.max(0.05, v)); }, pct),
      kInt('CHANCE', chanceIdx, v => { pat().prob[se.r][se.s] = STEP_CHANCE[v]; }, 0, STEP_CHANCE.length - 1, v => pct(STEP_CHANCE[v])),
      kInt('RATCHET', () => pat().rat[se.r][se.s], v => { pat().rat[se.r][se.s] = v; stepAudition(se.r, pat().vel[se.r][se.s]); }, 1, 4, v => 'x' + v)
    ],
    hint: 'SELECT = CLOSE · K1 PRESS = ON/OFF · UP/DOWN = ROW',
    select() { OS.closeStep(); },
    draw: drawStepEdit
  };
}
function drawStepEdit(g) {
  const part = PRJ.parts[0], se = OS.stepEdit, pat = stepMeta(part.patterns[part.cur]);
  const col = ROW_COLORS[se.r], x0 = 12, w = 376, cw = w / 16, y0 = 40, H = 52;
  const ph = UI.ph[0], phStep = SEQ.playing && ph && ph.pat === part.cur ? ph.step : -1;
  for (let s = 0; s < 16; s++) {
    const x = x0 + s * cw + 2, bw = cw - 4, on = pat.steps[se.r][s];
    g.fillStyle = Math.floor(s / 4) % 2 ? C.hi : C.cell;
    g.fillRect(x, y0, bw, H);
    if (on) {
      const v = pat.vel[se.r][s], pr = pat.prob[se.r][s], n = pat.rat[se.r][s];
      const bh = Math.max(3, v * (H - 4)), seg = (bh - (n - 1) * 2) / n;
      g.globalAlpha = 0.35 + 0.65 * pr;          // fainter = less likely
      g.fillStyle = col;
      for (let k = 0; k < n; k++) g.fillRect(x + 2, y0 + H - 2 - (k + 1) * seg - k * 2, bw - 4, seg);
      g.globalAlpha = 1;
      if (pr < 1) { g.fillStyle = C.ink; g.beginPath(); g.arc(x + bw - 4, y0 + 4, 1.8, 0, Math.PI * 2); g.fill(); }
    }
    if (s === phStep) { g.fillStyle = 'rgba(233,238,233,0.15)'; g.fillRect(x, y0, bw, H); }
    if (s === se.s) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.strokeRect(x - 0.5, y0 - 0.5, bw + 1, H + 1); }
  }
  const on = pat.steps[se.r][se.s];
  T(g, 'STEP ' + String(se.s + 1).padStart(2, '0') + ' · ' + (on ? 'ON' : 'OFF') + (on ? ' · VEL ' + pct(pat.vel[se.r][se.s]) + ' · CHANCE ' + pct(pat.prob[se.r][se.s]) + ' · x' + pat.rat[se.r][se.s] : ''),
    12, 103, 8.5, on ? C.ink : C.dim);
}
