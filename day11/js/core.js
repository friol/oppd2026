// OPPD-1 core: project data, per-part audio runtime, sequencer clock, song chain, arpeggiator, live input and recording
'use strict';

const PART_NAMES = ['DRUM', 'SYNTH A', 'SYNTH B', 'SYNTH C'];
const ARP_MODES = ['OFF', 'UP', 'DOWN', 'UP/DN', 'RANDOM', 'ORDER', 'CHORD'];
const ARP_RATES = [['1/4', 24], ['1/8', 12], ['1/8T', 8], ['1/16', 6], ['1/16T', 4], ['1/32', 3]];
const PAT_LENS = [16, 32, 64];
const PPQ = 24, TPS = 6;           // clock ticks per quarter note, ticks per 16th step
const PAT_NAMES = 'ABCD';

let PRJ = null;
const RT = [new PartRT(), new PartRT(), new PartRT(), new PartRT()];
// note-entry cursor per part (shared by the NOTES page and step recording)
const CURSOR = [0, 1, 2, 3].map(() => ({ step: 0, pitch: 60, len: 1, held: 0 }));

const clone = o => JSON.parse(JSON.stringify(o));

// per-step drum data (velocity, chance, ratchet) lives beside the on/off grid, created on first edit
const STEP_CHANCE = [1, 0.9, 0.75, 0.66, 0.5, 0.33, 0.25, 0.1];
const grid5 = v => [0, 1, 2, 3, 4].map(() => new Array(16).fill(v));
function stepMeta(pat) {
  if (!pat.vel) { pat.vel = grid5(1); pat.prob = grid5(1); pat.rat = grid5(1); }
  return pat;
}
const stepVel = (pat, r, s) => pat.vel ? pat.vel[r][s] : 1;
const stepProb = (pat, r, s) => pat.prob ? pat.prob[r][s] : 1;
const stepRat = (pat, r, s) => pat.rat ? pat.rat[r][s] : 1;
function resetStepMeta(pat) { delete pat.vel; delete pat.prob; delete pat.rat; }
const defaultFx = () => ({ type: 'OFF', p1: 0.5, p2: 0.4, mix: 0.35 });

// ---------- project model ----------
function newDrumPart() {
  const p = {
    kind: 'drum', kit: '', rows: [], level: 0.8, pan: 0.5, mute: false, fx: [defaultFx(), defaultFx()], rowSel: 0, cur: 0,
    patterns: [0, 1, 2, 3].map(() => ({ len: 16, steps: [0, 1, 2, 3, 4].map(() => new Array(16).fill(0)) }))
  };
  applyKit(p, KITS[0].name);
  return p;
}
function newSynthPart(preset) {
  const p = {
    kind: 'synth', engine: 'pad', preset: '', params: {}, level: 0.7, pan: 0.5, octave: 0, mute: false,
    fx: [defaultFx(), defaultFx()], arp: { mode: 0, rate: 3, oct: 1, gate: 0.6, hold: false }, cur: 0,
    patterns: [0, 1, 2, 3].map(() => ({ len: 16, notes: [] }))
  };
  setPreset(p, preset);
  return p;
}
function newProject() {
  return {
    v: 1, name: 'NEW', bpm: 120, swing: 0, master: 0.8, click: false, songMode: false,
    song: [{ p: [0, 0, 0, 0], rep: 1 }],
    parts: [newDrumPart(), newSynthPart('FUNK BASS'), newSynthPart('GLASS PAD'), newSynthPart('SAW LEAD')]
  };
}
function findPreset(name) { return allPresets().find(p => p.name === name) || SYNTH_PRESETS[0]; }
function allPresets() { return SYNTH_PRESETS.concat(USER_PRESETS); }

// presets carry the sound, the effects and the arpeggiator
function setPreset(part, name) {
  const pr = findPreset(name);
  part.engine = pr.engine; part.preset = pr.name;
  part.params = Object.assign(engineDefaults(pr.engine), pr.params);
  part.fx = [0, 1].map(i => pr.fx && pr.fx[i] ? clone(pr.fx[i]) : defaultFx());
  part.arp = pr.arp ? clone(pr.arp) : { mode: 0, rate: 3, oct: 1, gate: 0.6, hold: false };
}
function applyKit(part, name) {
  const k = KITS.find(x => x.name === name) || KITS[0];
  part.kit = k.name;
  part.rows = clone(k.rows);
  part.fx = [0, 1].map(i => k.fx && k.fx[i] ? clone(k.fx[i]) : defaultFx());
}

// user presets live in their own storage key so they survive project changes
let USER_PRESETS = [];
try { USER_PRESETS = JSON.parse(localStorage.getItem('oppd1.user') || '[]'); } catch (e) { USER_PRESETS = []; }
USER_PRESETS = USER_PRESETS.filter(p => ENGINES[p.engine]);   // drop presets of removed engines
function saveUserPreset(part) {
  const name = 'USER ' + (USER_PRESETS.length + 1);
  USER_PRESETS.push({ name, engine: part.engine, params: clone(part.params), fx: clone(part.fx), arp: clone(part.arp), user: true });
  try { localStorage.setItem('oppd1.user', JSON.stringify(USER_PRESETS)); } catch (e) { /* storage unavailable */ }
  part.preset = name;
  return name;
}

// ---------- audio application ----------
function setupEngine(pi) {
  const rt = RT[pi], part = PRJ.parts[pi];
  rt.voices.forEach(v => { if (!v.done) v.kill(AC.currentTime); });
  rt.voices = []; rt.live = {}; rt.held = [];
  if (rt.eng.nodes) rt.eng.nodes.forEach(n => { try { n.stop(); } catch (e) { /* not started */ } });
  try { rt.engIn.disconnect(); } catch (e) { /* not connected */ }
  rt.eng = { nodes: [] };
  if (part.kind === 'drum') DRUM.setup(rt);
  else {
    const E = ENGINES[part.engine];
    if (E.setup) E.setup(rt, part); else rt.engIn.connect(rt.input);
  }
}
function applyFx(pi, k) { RT[pi].fx[k].apply(PRJ.parts[pi].fx[k], PRJ.bpm); }
function applyMix(pi) {
  const part = PRJ.parts[pi], rt = RT[pi];
  tset(rt.level.gain, part.mute ? 0 : part.level * part.level * 1.2);
  tset(rt.pan.pan, part.pan * 2 - 1);
}
function applyPart(pi) {
  const part = PRJ.parts[pi];
  setupEngine(pi);
  applyFx(pi, 0); applyFx(pi, 1); applyMix(pi);
  if (part.kind === 'drum') part.rows.forEach((r, i) => DRUM.applyRow(RT[pi], r, i));
}
function applyMaster() { tset(AU.out.gain, PRJ.master * PRJ.master * 1.25); }
function applyAll() { for (let i = 0; i < 4; i++) applyPart(i); applyMaster(); }

function setParam(pi, id, v) {
  const part = PRJ.parts[pi], E = ENGINES[part.engine], rt = RT[pi];
  part.params[id] = v;
  if (E.live) E.live(rt, part, id);
  rt.voices.forEach(vo => { if (!vo.done && vo.live) vo.live(id); });
}
function changeEngine(pi, name) {
  const part = PRJ.parts[pi];
  part.engine = name; part.preset = 'INIT ' + ENGINES[name].name;
  part.params = engineDefaults(name);
  setupEngine(pi);
}
function loadPreset(pi, name) {
  setPreset(PRJ.parts[pi], name);
  applyPart(pi);
}
function loadKit(pi, name) {
  applyKit(PRJ.parts[pi], name);
  applyPart(pi);
}

// ---------- voices ----------
function voiceOn(pi, note, vel, t) {
  const part = PRJ.parts[pi], rt = RT[pi], E = ENGINES[part.engine];
  rt.voices = rt.voices.filter(v => !v.done);
  if (!E.mono) {
    const act = rt.voices.filter(v => v.heldAt(t));
    if (act.length >= E.poly) act[0].kill(t);
  }
  const v = E.play(rt, part, clamp(note + 12 * part.octave, 0, 127), vel, t);
  rt.voices.push(v);
  return v;
}
// release a voice at t; also brings forward a release booked for later (e.g. STOP during a long pattern note)
function voiceOff(v, t) { if (v && v.relAt > Math.max(t, AC.currentTime)) v.stop(t); }

function drumHit(pi, r, vel, t) {
  const part = PRJ.parts[pi];
  DRUM.hit(RT[pi], part.rows[r], vel, t, r);
  SEQ.vis.push({ t, k: 'hit', pi, r });
}

// ---------- sequencer ----------
const SEQ = {
  playing: false, rec: false, tick: 0, next: 0, step: 0, row: 0,
  last: null,       // last processed step: { s, t, pidx[] }
  vis: [],          // timed events for the UI (playheads, hits)
  pending: []       // timed callbacks (arp note releases from patterns)
};
const tickDur = () => 60 / PRJ.bpm / PPQ;
const stepDur = () => tickDur() * TPS;

function rowSteps(r) {
  let m = 0;
  r.p.forEach((pidx, pi) => { if (pidx >= 0) m = Math.max(m, PRJ.parts[pi].patterns[pidx].len); });
  return m || 16;
}
function partPattern(pi) {
  // pattern index a part plays right now (-1 = silent in this song row)
  if (PRJ.songMode && PRJ.song.length) return PRJ.song[Math.min(SEQ.row, PRJ.song.length - 1)].p[pi];
  return PRJ.parts[pi].cur;
}

function seqPlay() {
  if (SEQ.playing) return;
  AC.resume();
  SEQ.playing = true;
  SEQ.tick = 0; SEQ.step = 0;
  SEQ.next = AC.currentTime + 0.06;
  if (SEQ.row >= PRJ.song.length) SEQ.row = 0;
  RT.forEach(rt => { rt.arpI = 0; });
}
function seqStop() {
  if (!SEQ.playing) { SEQ.row = 0; SEQ.step = 0; return; }
  SEQ.playing = false; SEQ.step = 0;
  const now = AC.currentTime;
  SEQ.pending = []; SEQ.vis = [];
  RT.forEach(rt => {
    const liveV = Object.values(rt.live).map(e => e.v);
    rt.voices.forEach(v => { if (!liveV.includes(v)) voiceOff(v, now); });
    rt.held = rt.held.filter(h => h.src === 'l');
  });
}
function seqToggle() { if (SEQ.playing) seqStop(); else seqPlay(); }

function schedule() {
  if (!PRJ) return;
  const now = AC.currentTime;
  if (SEQ.next < now - 0.25) SEQ.next = now + 0.03;   // the tab was asleep: skip ahead
  const ahead = now + 0.12;
  while (SEQ.next < ahead) {
    processTick(SEQ.tick, SEQ.next);
    SEQ.next += tickDur();
    SEQ.tick++;
  }
  PUMPS.forEach(f => f());
}
setInterval(schedule, 20);

function processTick(tick, t) {
  if (SEQ.pending.length) {
    const due = SEQ.pending.filter(p => p.t <= t + 1e-4);
    if (due.length) { SEQ.pending = SEQ.pending.filter(p => p.t > t + 1e-4); due.forEach(p => p.fn()); }
  }
  if (SEQ.playing) {
    if (tick % TPS === 0) stepEvent(t);
    if (tick % PPQ === 0) {
      SEQ.vis.push({ t, k: 'beat', n: tick / PPQ });
      if (PRJ.click) clickSound(t, (tick / PPQ) % 4 === 0);
    }
  }
  for (let pi = 1; pi < 4; pi++) arpTick(pi, tick, t);
}

function stepEvent(t) {
  const sd = stepDur(), s = SEQ.step;
  const tt = t + (s % 2 === 1 ? PRJ.swing * 0.5 * sd : 0);
  if (PRJ.songMode && SEQ.row >= PRJ.song.length) SEQ.row = 0;
  const rowDef = PRJ.songMode ? PRJ.song[SEQ.row] : null;
  const pidxs = [];
  for (let pi = 0; pi < 4; pi++) {
    const part = PRJ.parts[pi];
    const pidx = rowDef ? rowDef.p[pi] : part.cur;
    pidxs.push(pidx);
    if (pidx < 0) { SEQ.vis.push({ t: tt, k: 'step', pi, step: -1, pat: -1 }); continue; }
    const pat = part.patterns[pidx], ps = s % pat.len;
    SEQ.vis.push({ t: tt, k: 'step', pi, step: ps, pat: pidx });
    if (part.kind === 'drum') {
      for (let r = 0; r < 5; r++) {
        if (!pat.steps[r][ps]) continue;
        if (Math.random() >= stepProb(pat, r, ps)) continue;          // chance
        const v = stepVel(pat, r, ps), n = stepRat(pat, r, ps);
        for (let k = 0; k < n; k++) drumHit(pi, r, v * (k ? 0.8 : 1), tt + k * sd / n);   // ratchet
      }
    } else {
      for (const n of pat.notes) {
        if (n.s !== ps) continue;
        if (n.skip) { delete n.skip; continue; }
        partNote(pi, n.n, tt, n.l * sd * 0.95);
      }
    }
  }
  SEQ.last = { s, t, pidx: pidxs };
  SEQ.vis.push({ t, k: 'row', row: SEQ.row });
  SEQ.step++;
  if (rowDef && SEQ.step >= rowSteps(rowDef) * Math.max(1, rowDef.rep)) {
    SEQ.step = 0;
    SEQ.row = (SEQ.row + 1) % PRJ.song.length;
  }
}

function clickSound(t, accent) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.frequency.value = accent ? 1900 : 1250;
  g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  o.connect(g); g.connect(AU.bus); o.start(t); o.stop(t + 0.05);
}

// ---------- arpeggiator ----------
const arpOn = part => part.kind === 'synth' && part.arp.mode > 0;

function partNote(pi, n, t, dur) {
  const part = PRJ.parts[pi], rt = RT[pi];
  if (arpOn(part)) {
    heldAdd(rt, n, 'p');
    SEQ.pending.push({ t: t + dur, fn: () => heldRemove(rt, n, 'p') });
  } else {
    voiceOff(voiceOn(pi, n, 0.9, t), t + dur);
  }
  SEQ.vis.push({ t, k: 'note', pi });
}
function heldAdd(rt, n, src) {
  if (!rt.held.length) { rt.arpI = 0; rt.arpStart = SEQ.tick; }
  rt.held.push({ n, src });
}
function heldRemove(rt, n, src) {
  const i = rt.held.findIndex(h => h.n === n && h.src === src);
  if (i >= 0) rt.held.splice(i, 1);
}
function arpSeq(rt, part) {
  const mode = part.arp.mode;
  let base = [];
  rt.held.forEach(h => { if (!base.includes(h.n)) base.push(h.n); });
  if (mode !== 5) base.sort((a, b) => a - b);
  let out = [];
  for (let o = 0; o < part.arp.oct; o++) base.forEach(n => out.push(n + 12 * o));
  if (mode === 2) out.reverse();
  if (mode === 3 && out.length > 2) out = out.concat(out.slice(1, -1).reverse());
  return { out, base };
}
function arpTick(pi, tick, t) {
  const part = PRJ.parts[pi];
  if (!arpOn(part)) return;
  const rt = RT[pi];
  if (!rt.held.length) return;
  const rate = ARP_RATES[part.arp.rate][1];
  const phase = SEQ.playing ? 0 : rt.arpStart;
  if ((((tick - phase) % rate) + rate) % rate !== 0) return;
  const { out, base } = arpSeq(rt, part);
  if (!out.length) return;
  const dur = rate * tickDur() * part.arp.gate;
  if (part.arp.mode === 6) {
    const o = (rt.arpI % part.arp.oct) * 12;
    base.forEach(n => voiceOff(voiceOn(pi, n + o, 0.8, t), t + dur));
  } else {
    const n = part.arp.mode === 4 ? out[Math.floor(Math.random() * out.length)] : out[rt.arpI % out.length];
    voiceOff(voiceOn(pi, n, 0.85, t), t + dur);
  }
  rt.arpI++;
  rt.arpLast = t;
  SEQ.vis.push({ t, k: 'note', pi });
}
function setArpHold(pi, on) {
  const part = PRJ.parts[pi], rt = RT[pi];
  part.arp.hold = on;
  if (!on) rt.held = rt.held.filter(h => h.src !== 'l' || rt.live[h.n]);
}
function setArpMode(pi, m) {
  const part = PRJ.parts[pi], rt = RT[pi];
  const was = arpOn(part);
  part.arp.mode = m;
  if (was && !arpOn(part)) rt.held = [];
}

// ---------- live input + recording ----------
const DRUM_KEYS = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 0, 11: 1 };   // white keys C D E F G (A B repeat) -> rows

function recPos(pi, now) {
  // quantize `now` to the nearest step of the pattern this part is playing
  const L = SEQ.last;
  if (!SEQ.playing || !L) return null;
  const k = Math.round((now - L.t) / stepDur());
  const part = PRJ.parts[pi];
  const pidx = L.pidx[pi] >= 0 ? L.pidx[pi] : part.cur;
  const pat = part.patterns[pidx];
  const s = L.s + k;
  return { pat, ps: ((s % pat.len) + pat.len) % pat.len, future: k > 0 };
}

function liveDown(pi, note) {
  AC.resume();
  const part = PRJ.parts[pi], rt = RT[pi], now = AC.currentTime;
  if (part.kind === 'drum') {
    const r = DRUM_KEYS[((note % 12) + 12) % 12];
    if (r == null) return;
    part.rowSel = r;
    drumHit(pi, r, 1, now);
    if (SEQ.rec && SEQ.playing) { const p = recPos(pi, now); if (p) p.pat.steps[r][p.ps] = 1; }
    return;
  }
  if (rt.live[note]) liveUp(pi, note);
  let rec = null;
  if (SEQ.rec) {
    if (SEQ.playing) rec = { t: now, pos: recPos(pi, now) };
    else stepEnter(pi, note);
  }
  if (arpOn(part)) {
    if (part.arp.hold && !Object.keys(rt.live).length) rt.held = rt.held.filter(h => h.src !== 'l');
    heldAdd(rt, note, 'l');
    rt.live[note] = { rec };
  } else {
    rt.live[note] = { v: voiceOn(pi, note, 0.9, now), rec };
  }
  SEQ.vis.push({ t: now, k: 'note', pi });
}
function liveUp(pi, note) {
  const part = PRJ.parts[pi], rt = RT[pi];
  if (part.kind === 'drum') return;
  const e = rt.live[note];
  if (!e) return;
  delete rt.live[note];
  const now = AC.currentTime;
  if (e.v) voiceOff(e.v, now);
  if (!part.arp.hold || !arpOn(part)) heldRemove(rt, note, 'l');
  if (e.rec && e.rec.pos) {
    const { pat, ps, future } = e.rec.pos;
    const len = clamp(Math.round((now - e.rec.t) / stepDur()), 1, pat.len);
    pat.notes = pat.notes.filter(n => !(n.s === ps && n.n === note));
    const nn = { s: ps, n: note, l: len };
    if (future) nn.skip = true;   // the step was not scheduled yet: don't play it twice
    pat.notes.push(nn);
  }
  if (CURSOR[pi].held > 0) {
    CURSOR[pi].held--;
    if (!CURSOR[pi].held) {
      const c = CURSOR[pi], len = part.patterns[part.cur].len;
      c.step = (c.step + c.len) % len;
    }
  }
}
// step recording (REC on, transport stopped): notes land on the cursor, chords stay on the same step
function stepEnter(pi, note) {
  const part = PRJ.parts[pi], c = CURSOR[pi], pat = part.patterns[part.cur];
  pat.notes = pat.notes.filter(n => !(n.s === c.step && n.n === note));
  pat.notes.push({ s: c.step, n: note, l: c.len });
  c.pitch = note;
  c.held++;
}
// empty the current pattern of one part; keeps one level of undo
let CLEAR_UNDO = null;
function clearPattern(pi) {
  const part = PRJ.parts[pi], pat = part.patterns[part.cur];
  CLEAR_UNDO = { pi, pidx: part.cur, pat: clone(pat) };
  if (part.kind === 'drum') { pat.steps = pat.steps.map(r => r.map(() => 0)); resetStepMeta(pat); }
  else { pat.notes = []; RT[pi].held = RT[pi].held.filter(h => h.src !== 'p'); }
  return PART_NAMES[pi] + ' · PATTERN ' + PAT_NAMES[part.cur] + ' CLEARED';
}
function undoClear() {
  const u = CLEAR_UNDO;
  if (!u) return null;
  PRJ.parts[u.pi].patterns[u.pidx] = u.pat;
  CLEAR_UNDO = null;
  return PART_NAMES[u.pi] + ' · PATTERN ' + PAT_NAMES[u.pidx] + ' RESTORED';
}
// empty every pattern of every part (sounds, effects and song rows stay as they are)
function clearAllPatterns() {
  seqStop(); seqStop();
  CLEAR_UNDO = null;
  PRJ.parts.forEach((part, pi) => {
    part.patterns.forEach(p => {
      if (part.kind === 'drum') { p.steps = p.steps.map(r => r.map(() => 0)); resetStepMeta(p); }
      else { p.notes = []; p.len = 16; }
    });
    part.cur = 0;
    RT[pi].held = RT[pi].held.filter(h => h.src === 'l');
    CURSOR[pi].step = 0;
  });
}
function allLiveOff() {
  for (let pi = 1; pi < 4; pi++) Object.keys(RT[pi].live).forEach(n => liveUp(pi, +n));
}

// ---------- project load ----------
function validProject(o) {
  return o && o.v === 1 && Array.isArray(o.parts) && o.parts.length === 4 && o.parts[0].kind === 'drum' && Array.isArray(o.song);
}
function loadProject(o) {
  if (SEQ.playing) seqStop();
  SEQ.row = 0; SEQ.step = 0;
  PRJ = o;
  // fill in anything missing from older saves
  PRJ.parts.forEach((p, i) => {
    if (p.kind === 'synth') {
      if (!ENGINES[p.engine]) setPreset(p, SYNTH_PRESETS[0].name);   // engine no longer available (e.g. FM, ORGAN)
      else p.params = Object.assign(engineDefaults(p.engine), p.params);
    }
    p.fx = p.fx || [defaultFx(), defaultFx()];
    CURSOR[i].step = 0;
  });
  if (!PRJ.song.length) PRJ.song.push({ p: [0, 0, 0, 0], rep: 1 });
  delete PRJ.gen;   // left over from saves made with the removed INSPIRE generator
  applyAll();
}
