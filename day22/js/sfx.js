'use strict';
// Synthesized sound effects (Web Audio, no files). The context starts on the first click or key,
// as required by the browsers' autoplay policy.

const SFX = {
  ctx: null, master: null, noiseBuf: null,
  gainK: 1,   // volume multiplier for the next sounds (the title demo plays them quieter)
  init() {
    if (SFX.ctx) { if (SFX.ctx.state === 'suspended') SFX.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    SFX.ctx = new AC();
    SFX.master = SFX.ctx.createGain();
    SFX.master.gain.value = 0.5;
    SFX.master.connect(SFX.ctx.destination);
    // one second of white noise, reused by the noisy sounds
    const n = SFX.ctx.sampleRate;
    SFX.noiseBuf = SFX.ctx.createBuffer(1, n, n);
    const d = SFX.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  },
  ok() { return SFX.ctx && SFX.ctx.state === 'running'; },

  // oscillator with a pitch curve [[time, freq], ...] and an attack/decay envelope
  tone(type, freqs, dur, vol, delay) {
    if (!SFX.ok()) return;
    const c = SFX.ctx, t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freqs[0][1], t0);
    for (let i = 1; i < freqs.length; i++) o.frequency.exponentialRampToValueAtTime(freqs[i][1], t0 + freqs[i][0]);
    g.gain.setValueAtTime(0.0001, t0);
    vol *= SFX.gainK;
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(SFX.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  // filtered noise burst, band-pass centre sweeping from f0 to f1
  noise(dur, vol, f0, f1, q, delay) {
    if (!SFX.ok()) return;
    const c = SFX.ctx, t0 = c.currentTime + (delay || 0);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = SFX.noiseBuf;
    f.type = 'bandpass'; f.Q.value = q || 2;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol * SFX.gainK, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(SFX.master);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  },

  // ---- recorded samples (soundfx/*.wav) ----
  // Played with <audio> elements (a small pool per file, so overlapping plays do not cut each other),
  // because Web Audio cannot decode local files when the page is opened from file://.
  samples: {},
  loadSamples() {
    for (const n of ['shoot', 'warp']) {
      const pool = [];
      for (let i = 0; i < 4; i++) { const a = new Audio('soundfx/' + n + '.wav'); a.preload = 'auto'; pool.push(a); }
      SFX.samples[n] = { pool, next: 0 };
    }
  },
  sample(name, vol, rate) {
    const s = SFX.samples[name];
    if (!s || !SFX.ok()) return;
    const a = s.pool[s.next++ % s.pool.length];
    try {
      a.pause(); a.currentTime = 0;
      a.volume = Math.max(0, Math.min(1, vol * SFX.gainK));
      a.preservesPitch = false; a.playbackRate = rate || 1;
      const pr = a.play(); if (pr && pr.catch) pr.catch(() => { });
    } catch (e) { }
  },

  // ---- game ----
  lastCoin: 0,
  coin() {
    // classic two-note chime; rapid pickups go up a little in pitch
    const now = performance.now();
    const k = now - SFX.lastCoin < 250 ? 1.06 : 1;
    SFX.lastCoin = now;
    SFX.tone('square', [[0, 988 * k]], 0.07, 0.09);
    SFX.tone('square', [[0, 1319 * k]], 0.32, 0.09, 0.07);
  },
  jump() {
    SFX.tone('square', [[0, 220], [0.16, 640]], 0.18, 0.07);
    SFX.tone('triangle', [[0, 440], [0.16, 1280]], 0.16, 0.05);
  },
  // portal gun shot: soundfx/shoot.wav; the orange portal is played a little lower
  portal(color) { SFX.sample('shoot', 0.3, color ? 0.88 : 1); },


  // stomping a monster: soft thump + squashy falling "boing"; a kill adds a little pop on top
  stomp(kill) {
    SFX.tone('sine', [[0, 160], [0.12, 45]], 0.14, 0.22);
    SFX.noise(0.08, 0.18, 900, 200, 1.2);
    SFX.tone('square', [[0, 520], [0.11, 170]], 0.12, 0.06);
    if (kill) SFX.tone('triangle', [[0, 880], [0.06, 1320]], 0.09, 0.05, 0.07);
  },

  // player hit (loses a heart): short crunchy hit with a falling tone
  hurt() {
    SFX.tone('square', [[0, 420], [0.18, 110]], 0.2, 0.08);
    SFX.noise(0.12, 0.2, 2500, 400, 1.5);
  },
  // fatal hit, while the hero turns red: harsh descending buzz with a fast wobble
  dying() {
    MUSIC.duck(0.4, 2.0);
    SFX.tone('sawtooth', [[0, 620], [0.3, 70]], 0.32, 0.09);
    SFX.tone('square', [[0, 660], [0.3, 75]], 0.3, 0.05);
    SFX.noise(0.16, 0.22, 3000, 300, 1.2);
  },
  // the hero bursts into pixels: low boom, noisy blast and a shower of tiny bleeps
  explode() {
    MUSIC.duck(0.4, 1.6);
    SFX.tone('sine', [[0, 120], [0.5, 30]], 0.55, 0.35);
    SFX.noise(0.6, 0.35, 1800, 120, 0.8);
    SFX.noise(0.25, 0.15, 6000, 2000, 1);
    for (let i = 0; i < 9; i++) {
      const f = 900 + Math.random() * 1800;
      SFX.tone('square', [[0, f], [0.06, f * 0.6]], 0.07, 0.025, 0.05 + i * 0.045 + Math.random() * 0.02);
    }
  },

  // level exit: a short triumphant fanfare (three quick notes, a long one, a rising answer, a
  // final chord with a shimmer on top)
  victory() {
    MUSIC.duck(0.3, 2.4);
    const n = (f, d, len, v) => {
      SFX.tone('square', [[0, f]], len, (v || 0.07), d);
      SFX.tone('triangle', [[0, f * 2]], len, 0.05, d);
      SFX.tone('triangle', [[0, f / 2]], len, 0.07, d);
    };
    n(523, 0, 0.11); n(523, 0.13, 0.11); n(523, 0.26, 0.11); n(523, 0.39, 0.3);
    n(415, 0.72, 0.11); n(466, 0.86, 0.11); n(523, 1.0, 0.16);
    for (const f of [523, 659, 784, 1047]) {
      SFX.tone('square', [[0, f], [0.9, f * 1.008]], 0.95, 0.04, 1.16);
      SFX.tone('triangle', [[0, f / 2]], 0.95, 0.05, 1.16);
    }
    for (let i = 0; i < 7; i++) SFX.tone('sine', [[0, 2093 + i * 330]], 0.1, 0.022, 1.2 + i * 0.07);
  },
  // the final victory screen: a longer, fuller fanfare (rising brass-like phrase, big final chord,
  // sparkling bells and a soft cymbal wash)
  triumph() {
    MUSIC.duck(0.15, 5.0);
    const n = (f, d, len, v) => {
      SFX.tone('square', [[0, f]], len, v || 0.06, d);
      SFX.tone('sawtooth', [[0, f * 1.003]], len, (v || 0.06) * 0.5, d);
      SFX.tone('triangle', [[0, f / 2]], len, 0.07, d);
    };
    [[392, 0], [523, 0.16], [659, 0.32], [784, 0.48]].forEach(([f, d]) => n(f, d, 0.18));   // G C E G
    n(1047, 0.7, 0.55, 0.07);                                                              // high C
    n(988, 1.3, 0.16); n(1047, 1.46, 0.16); n(1175, 1.62, 0.16);
    for (const f of [523, 659, 784, 1047, 1319]) {                                          // final chord
      SFX.tone('square', [[0, f], [1.8, f * 1.006]], 2.1, 0.035, 1.85);
      SFX.tone('triangle', [[0, f / 2]], 2.1, 0.05, 1.85);
    }
    SFX.tone('sine', [[0, 98], [2, 90]], 2.2, 0.2, 1.85);
    SFX.noise(1.8, 0.07, 6500, 4200, 0.8, 1.85);
    for (let i = 0; i < 14; i++) SFX.tone('sine', [[0, 2093 + Math.random() * 2200]], 0.14, 0.022, 1.9 + i * 0.11);
  },
  // door: wooden creak when it opens, soft thud when it closes
  doorOpen() {
    SFX.noise(0.4, 0.11, 260, 720, 7);
    SFX.tone('sawtooth', [[0, 110], [0.35, 190]], 0.38, 0.03);
  },
  doorClose() {
    SFX.tone('sine', [[0, 110], [0.14, 38]], 0.2, 0.3);
    SFX.noise(0.1, 0.18, 700, 150, 1);
  },

  // a monster sinks in the water and dies: splash, then a few gurgling bubbles that rise in pitch
  splash() {
    SFX.noise(0.28, 0.2, 2600, 500, 1.2);
    SFX.tone('sine', [[0, 260], [0.08, 90]], 0.14, 0.18);
    [[0.12, 420], [0.24, 520], [0.35, 640], [0.44, 760]].forEach(([d, f]) => SFX.tone('sine', [[0, f], [0.07, f * 1.7]], 0.09, 0.07, d));
  },

  // plasma gun shot: a buzzy electric zap, lower and meatier than the portal gun
  plasmaShot() {
    SFX.tone('sawtooth', [[0, 980], [0.14, 210]], 0.16, 0.09);
    SFX.tone('square', [[0, 1470], [0.1, 420]], 0.12, 0.05);
    SFX.tone('sine', [[0, 150], [0.12, 70]], 0.14, 0.16);
    SFX.noise(0.12, 0.1, 3600, 1100, 2);
  },
  // plasma hitting a monster: wet sizzling zap and a pop / hitting a wall: crackle and a spark
  plasmaHit(how) {
    if (how === 'enemy') {
      SFX.tone('sawtooth', [[0, 700], [0.18, 90]], 0.2, 0.1);
      SFX.noise(0.22, 0.2, 3200, 400, 1.2);
      SFX.tone('sine', [[0, 220], [0.1, 60]], 0.12, 0.2, 0.02);
      for (let i = 0; i < 3; i++) SFX.tone('square', [[0, 1400 + Math.random() * 900], [0.04, 500]], 0.05, 0.035, 0.05 + i * 0.05);
    } else {
      SFX.noise(0.16, 0.16, 5200, 900, 1.5);
      SFX.tone('square', [[0, 2200], [0.07, 600]], 0.08, 0.05);
      SFX.tone('sine', [[0, 120], [0.09, 55]], 0.1, 0.12);
    }
  },

  // rough "vocal" sound: detuned saws through a resonant low-pass, with a fast tremolo for the growl
  growl(f0, f1, dur, vol, delay) {
    if (!SFX.ok()) return;
    const c = SFX.ctx, t0 = c.currentTime + (delay || 0), v = vol * SFX.gainK;
    const lp = c.createBiquadFilter(), g = c.createGain(), trem = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(260, t0); lp.frequency.linearRampToValueAtTime(520, t0 + dur * 0.35); lp.frequency.linearRampToValueAtTime(220, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    trem.gain.value = 0.6; lfo.frequency.value = 26; lg.gain.value = 0.4;
    lfo.connect(lg); lg.connect(trem.gain);
    lp.connect(trem); trem.connect(g); g.connect(SFX.master);
    for (const [type, det] of [['sawtooth', 0], ['sawtooth', 14], ['square', -9]]) {
      const o = c.createOscillator();
      o.type = type; o.detune.value = det;
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      o.connect(lp); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  },
  // final boss: a heavy grunt when he starts to move, a thud with each step
  bossGrunt() { SFX.growl(95, 55, 0.55, 0.22); SFX.noise(0.3, 0.05, 500, 200, 1.5, 0.05); },
  bossStep() { SFX.tone('sine', [[0, 85], [0.12, 38]], 0.16, 0.24); SFX.noise(0.07, 0.07, 400, 140, 1); },
  // jump: an effort roar rising into a whoosh
  bossJump() {
    SFX.growl(70, 120, 0.4, 0.2);
    SFX.noise(0.45, 0.1, 300, 1400, 1.2, 0.04);
    SFX.tone('sine', [[0, 90], [0.4, 180]], 0.4, 0.1);
  },
  // landing: a huge boom with a long rumble, and a crackle of debris
  bossLand() {
    SFX.tone('sine', [[0, 85], [0.5, 24]], 0.7, 0.45);
    SFX.noise(0.7, 0.35, 700, 70, 0.7);
    SFX.noise(0.25, 0.12, 2400, 600, 1.2, 0.04);
    SFX.tone('sawtooth', [[0, 55], [0.45, 30]], 0.5, 0.12);
  },

  // checkpoint: a short triumphant fanfare (rising major arpeggio, bright chord, shimmer)
  checkpoint() {
    MUSIC.duck(0.45, 1.3);
    [[523, 0], [659, 0.08], [784, 0.16]].forEach(([f, d]) => {
      SFX.tone('square', [[0, f]], 0.12, 0.05, d);
      SFX.tone('triangle', [[0, f * 2]], 0.1, 0.04, d);
    });
    for (const f of [1047, 1319, 1568]) {
      SFX.tone('square', [[0, f], [0.45, f * 1.01]], 0.5, 0.035, 0.26);
      SFX.tone('triangle', [[0, f / 2]], 0.55, 0.05, 0.26);
    }
    for (let i = 0; i < 6; i++) SFX.tone('sine', [[0, 2093 + i * 260]], 0.08, 0.02, 0.32 + i * 0.05);
    SFX.noise(0.35, 0.05, 6000, 9000, 1.5, 0.26);
  },

  // a portal opens where the shot landed: a rising swell that swirls open (whoosh + shimmer),
  // then a soft low "thum" as it settles. Blue is higher, orange lower, like the shots.
  portalOpen(color) {
    const k = color ? 0.8 : 1;
    SFX.tone('sine', [[0, 240 * k], [0.24, 780 * k]], 0.3, 0.1);
    SFX.tone('triangle', [[0, 480 * k], [0.22, 1560 * k]], 0.26, 0.045);
    SFX.noise(0.3, 0.11, 450 * k, 3400 * k, 2.2);
    SFX.tone('sine', [[0, 110 * k], [0.14, 55 * k]], 0.18, 0.16, 0.2);
    [1760, 2349, 2960].forEach((f, i) => SFX.tone('sine', [[0, f * k]], 0.12, 0.03, 0.22 + i * 0.05));
  },

  // the hero goes through a portal: soundfx/warp.wav
  // vol: 1 for the hero; monsters use a lower volume that depends on their distance (see GAME.onEvent)
  lastWarp: 0, lastWarpOther: 0,
  warp(vol, other) {
    const now = performance.now();
    if (now - (other ? SFX.lastWarpOther : SFX.lastWarp) < (other ? 200 : 120)) return;
    if (other) SFX.lastWarpOther = now; else SFX.lastWarp = now;
    SFX.sample('warp', 0.85 * (vol === undefined ? 1 : vol), other ? 1.12 : 1);
  },

  // a power-up pops out of a "P" block: a bubbly rising "bwoop"; the plasma core adds an electric
  // crackle and a buzzing zap so it is recognisable before you even pick it up
  powerSpawn(kind) {
    SFX.tone('sine', [[0, 300], [0.14, 640], [0.3, 1180]], 0.34, 0.1);
    SFX.tone('triangle', [[0, 600], [0.3, 2300]], 0.3, 0.04);
    for (let i = 0; i < 4; i++) SFX.tone('sine', [[0, 700 + i * 260], [0.05, 1000 + i * 320]], 0.06, 0.025, 0.1 + i * 0.06);
    if (kind === 'plasma') {
      SFX.noise(0.3, 0.1, 2400, 5200, 2.5, 0.05);
      SFX.tone('sawtooth', [[0, 110], [0.3, 360]], 0.34, 0.05);
      for (let i = 0; i < 5; i++) SFX.tone('square', [[0, 1800 + Math.random() * 1600], [0.03, 700]], 0.04, 0.03, 0.08 + i * 0.05);
    }
  },
  // picking a power-up up: the plasma core is an electric "charge-up" with a power chord and
  // sparkles; the others (heart, shield, medkit...) get a bright rising chime
  powerGet(kind) {
    if (kind === 'plasma') {
      SFX.tone('sawtooth', [[0, 180], [0.28, 1500]], 0.32, 0.09);
      SFX.tone('square', [[0, 360], [0.28, 3000]], 0.28, 0.04);
      SFX.noise(0.3, 0.14, 800, 6000, 1.6);
      [392, 523, 659, 784].forEach((f, i) => { SFX.tone('square', [[0, f]], 0.28, 0.045, 0.3 + i * 0.02); SFX.tone('triangle', [[0, f / 2]], 0.3, 0.06, 0.3); });
      for (let i = 0; i < 6; i++) SFX.tone('sine', [[0, 2200 + i * 340]], 0.08, 0.025, 0.34 + i * 0.05);
    } else {
      [659, 784, 988, 1319].forEach((f, i) => { SFX.tone('square', [[0, f]], 0.12, 0.05, i * 0.06); SFX.tone('triangle', [[0, f * 2]], 0.1, 0.03, i * 0.06); });
      SFX.tone('sine', [[0, 1976]], 0.3, 0.04, 0.24);
    }
  },

  // enemy shots: a fireball spat by plants, turrets and the boss (a muffled "fwoomp" with a hiss) and
  // the eye's bolt (a thin high "zip"); `big` is the boss's heavier fireball
  enemyShot(kind, big) {
    if (kind === 'bolt') {
      SFX.tone('square', [[0, 1500], [0.12, 520]], 0.13, 0.05);
      SFX.tone('triangle', [[0, 2200], [0.1, 900]], 0.1, 0.03);
      SFX.noise(0.08, 0.05, 4500, 1500, 2);
    } else {
      SFX.noise(0.26, big ? 0.22 : 0.15, 500, 1900, 1.1);
      SFX.tone('sawtooth', [[0, 260], [0.2, 120]], 0.22, big ? 0.07 : 0.045);
      SFX.tone('sine', [[0, big ? 110 : 160], [0.16, 60]], 0.18, big ? 0.2 : 0.12);
    }
  },
  // enemy shot hitting a wall: fire bursts with a dull thud and crackle, the bolt with an electric fizz
  enemyHit(kind) {
    if (kind === 'bolt') {
      SFX.noise(0.14, 0.1, 4800, 1200, 2);
      SFX.tone('square', [[0, 1900], [0.07, 500]], 0.08, 0.04);
    } else {
      SFX.tone('sine', [[0, 140], [0.12, 50]], 0.16, 0.2);
      SFX.noise(0.2, 0.14, 1600, 250, 0.9);
      for (let i = 0; i < 3; i++) SFX.tone('square', [[0, 800 + Math.random() * 700], [0.03, 300]], 0.04, 0.02, 0.03 + i * 0.04);
    }
  },

  // sad melody when the hero dies: a short, soft three-note phrase in A minor (E D, then a long A
  // with a little vibrato), played after the explosion; melody only, no bass
  sadTune() {
    MUSIC.duck(0.4, 2.2);
    if (!SFX.ok()) return;
    const c = SFX.ctx, t0 = c.currentTime;
    const note = (f, d, len, v) => {
      const o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = f;
      lp.type = 'lowpass'; lp.frequency.value = 2400;
      const s = t0 + d, v1 = v * SFX.gainK;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(v1, s + 0.03);
      g.gain.exponentialRampToValueAtTime(v1 * 0.55, s + len * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, s + len);
      if (len > 0.5) {   // slow vibrato on the long last note
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 5.5; lg.gain.value = f * 0.012;
        lfo.connect(lg); lg.connect(o.frequency); lfo.start(s + 0.2); lfo.stop(s + len + 0.05);
      }
      o.connect(lp); lp.connect(g); g.connect(SFX.master);
      o.start(s); o.stop(s + len + 0.05);
    };
    note(659.3, 0.4, 0.24, 0.14);    // E5
    note(587.3, 0.62, 0.24, 0.13);   // D5
    note(440.0, 0.84, 0.75, 0.15);   // A4 (long)
  },

  // the final boss is on fire: a swelling roar of flames with crackling pops that get denser (dur s)
  bossBurn(dur) {
    MUSIC.duck(0.5, 2.8);
    if (!SFX.ok()) return;
    SFX.noise(dur, 0.12, 380, 900, 0.8);
    SFX.noise(dur * 0.8, 0.05, 1500, 3200, 1.2, dur * 0.2);
    let t = 0;
    while (t < dur) {
      const k = t / dur;
      const f = 1500 + Math.random() * 4800;
      SFX.noise(0.02 + Math.random() * 0.05, 0.1 + 0.12 * k, f, f * 0.5, 3, t);
      if (Math.random() < 0.35) SFX.tone('square', [[0, f * 0.6], [0.02, f * 0.25]], 0.03, 0.02 + 0.02 * k, t);
      if (Math.random() < 0.12) SFX.tone('sine', [[0, 120 + Math.random() * 60], [0.08, 55]], 0.1, 0.12, t);   // a deeper "pop"
      t += (0.11 - 0.085 * k) * (0.4 + Math.random() * 1.2);
    }
  },
  // the final boss bursts: huge boom, a long noisy blast, a rumbling tail and a rain of debris
  bossExplode() {
    MUSIC.duck(0.25, 3.0);
    SFX.tone('sine', [[0, 95], [1.3, 22]], 1.5, 0.5);
    SFX.tone('sawtooth', [[0, 70], [1.0, 28]], 1.1, 0.14);
    SFX.noise(1.3, 0.42, 1600, 60, 0.7);
    SFX.noise(0.5, 0.22, 4200, 500, 1);
    SFX.noise(1.6, 0.14, 260, 40, 0.8, 0.15);
    for (let i = 0; i < 26; i++) {
      const f = 700 + Math.random() * 3600;
      SFX.tone('square', [[0, f], [0.05, f * 0.4]], 0.05, 0.03, 0.15 + Math.random() * 1.1);
    }
  },

  // spike ball hanging from the ceiling, trembling: a nervous metallic rattle of chain links
  // that gets faster; then it snaps off (a sharp "tink" and a short falling whistle); then it hits the
  // ground (heavy thud, clang of metal and a crackle of debris)
  spikeShake(dur) {
    let t = 0;
    while (t < (dur || 0.55)) {
      const k = t / (dur || 0.55), f = 1800 + Math.random() * 2600;
      SFX.noise(0.03, 0.09 + 0.06 * k, f, f * 0.6, 4, t);
      SFX.tone('square', [[0, f * 0.5], [0.025, f * 0.3]], 0.03, 0.025 + 0.02 * k, t);
      t += 0.075 - 0.045 * k + Math.random() * 0.02;
    }
  },
  spikeDrop() {
    SFX.tone('triangle', [[0, 2600], [0.05, 1800]], 0.09, 0.09);
    SFX.noise(0.06, 0.12, 5200, 2200, 3);
    SFX.tone('sine', [[0, 900], [0.35, 220]], 0.36, 0.05, 0.04);
  },
  spikeLand() {
    SFX.tone('sine', [[0, 120], [0.18, 45]], 0.24, 0.35);
    SFX.noise(0.18, 0.22, 1400, 200, 1);
    [[520, 0.5], [770, 0.35], [1310, 0.25]].forEach(([f, v]) => SFX.tone('triangle', [[0, f], [0.3, f * 0.985]], 0.34, 0.07 * v, 0.01));
    for (let i = 0; i < 4; i++) SFX.tone('square', [[0, 1500 + Math.random() * 2200], [0.04, 600]], 0.05, 0.025, 0.06 + i * 0.05);
  },

  // ---- title-screen drone: low detuned saws through a slowly sweeping resonant low-pass,
  // a fifth above, and a slow "heartbeat" swell, to build tension ----
  drone: null,
  droneOn() {
    if (!SFX.ok() || SFX.drone) return;
    const c = SFX.ctx, t = c.currentTime, nodes = [];
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.32, t + 4);
    out.connect(SFX.master);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 170; f.Q.value = 7;
    f.connect(out);
    const lfo = (freq, depth, target) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = freq; g.gain.value = depth;
      o.connect(g); g.connect(target); o.start(t); nodes.push(o);
    };
    lfo(0.06, 120, f.frequency);              // slow filter sweep
    const pulse = c.createGain();
    pulse.gain.value = 0.75;
    pulse.connect(f);
    lfo(0.45, 0.25, pulse.gain);              // heartbeat swell
    for (const [type, freq, vol, det] of [['sawtooth', 41.2, 0.5, 0], ['sawtooth', 41.2, 0.5, 9], ['sine', 82.4, 0.35, 0], ['triangle', 61.7, 0.18, -6]]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = det; g.gain.value = vol;
      o.connect(g); g.connect(pulse); o.start(t); nodes.push(o);
    }
    // a faint, very slowly rising high tone on top
    const hi = c.createOscillator(), hg = c.createGain();
    hi.type = 'sine'; hi.frequency.setValueAtTime(329.6, t); hi.frequency.linearRampToValueAtTime(349.2, t + 40);
    hg.gain.value = 0.025; hi.connect(hg); hg.connect(out); hi.start(t); nodes.push(hi);
    SFX.drone = { out, nodes };
  },
  droneOff() {
    const d = SFX.drone;
    if (!d) return;
    const t = SFX.ctx.currentTime;
    d.out.gain.cancelScheduledValues(t);
    d.out.gain.setValueAtTime(Math.max(0.0001, d.out.gain.value), t);
    d.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    d.nodes.forEach(o => o.stop(t + 0.9));
    SFX.drone = null;
  },

  // plays sounds at a reduced volume (background sounds of the title demo)
  quiet(k, fn) { SFX.gainK = k; try { fn(); } finally { SFX.gainK = 1; } },

  // pause: the world "winds down" - two soft falling notes and a short low-passed whoosh that closes
  pause() {
    SFX.tone('triangle', [[0, 880], [0.16, 520]], 0.2, 0.08);
    SFX.tone('sine', [[0, 660], [0.2, 330]], 0.24, 0.07, 0.07);
    SFX.noise(0.22, 0.07, 3000, 300, 1.2);
    SFX.tone('sine', [[0, 120], [0.18, 70]], 0.2, 0.1, 0.05);
  },
  // resume: the opposite - the world "powers back up": a rising swish and two bright notes
  resume() {
    SFX.noise(0.2, 0.07, 300, 3200, 1.2);
    SFX.tone('sine', [[0, 330], [0.18, 700]], 0.22, 0.07);
    SFX.tone('triangle', [[0, 523], [0.1, 523]], 0.1, 0.08, 0.1);
    SFX.tone('triangle', [[0, 784], [0.14, 784]], 0.16, 0.08, 0.17);
    SFX.tone('sine', [[0, 1568]], 0.2, 0.025, 0.2);
  },

  // ---- menu ----
  move() { SFX.tone('sine', [[0, 740]], 0.05, 0.06); SFX.tone('triangle', [[0, 1480]], 0.03, 0.025); },
  tick() { SFX.tone('square', [[0, 1175]], 0.04, 0.035); },
  select() {
    [523, 659, 784, 1047].forEach((f, i) => SFX.tone('triangle', [[0, f]], 0.16, 0.08, i * 0.055));
    SFX.tone('sine', [[0, 2093]], 0.25, 0.03, 0.22);
  },
  back() { SFX.tone('triangle', [[0, 659]], 0.09, 0.07); SFX.tone('triangle', [[0, 440]], 0.14, 0.07, 0.07); }
};

// Background music: muzik/Ombre tra le Piattaforme.mp3 in a loop, through an <audio> element (it also
// works from file://). It is kept quiet (MUSIC.base) and ducks automatically under loud effects
// (fanfares, explosions...) so it never covers the sound effects. M or the menus switch it on/off; the
// choice is remembered. The browser only lets sound start after the first click or key.
const MUSIC = {
  base: 0.2,                 // normal volume (0..1), well under the effects
  enabled: true, el: null, started: false,
  fadeK: 1, duckK: 1, duckLevel: 1, duckUntil: 0,
  init() {
    try { this.enabled = localStorage.getItem('spg.music') !== '0'; } catch (e) { }
    this.el = new Audio('muzik/Ombre tra le Piattaforme.mp3');
    this.el.loop = true; this.el.preload = 'auto'; this.el.volume = 0;
  },
  // never on the title screen: it already has its own drone
  suppressed() { return typeof GAME !== 'undefined' && GAME.state === 'title'; },
  start() {
    if (this.started || !this.el || !this.enabled || this.suppressed()) return;
    const p = this.el.play();
    this.started = true;
    if (p && p.catch) p.catch(() => { this.started = false; });
  },
  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('spg.music', this.enabled ? '1' : '0'); } catch (e) { }
    if (this.enabled) { this.started = false; this.start(); }
    return this.enabled;
  },
  // lower the music to `level` (0..1) for `sec` seconds, then bring it back
  duck(level, sec) {
    const now = performance.now();
    this.duckLevel = now < this.duckUntil ? Math.min(this.duckLevel, level) : level;
    this.duckUntil = Math.max(this.duckUntil, now + sec * 1000);
  },
  update(dt) {
    if (!this.el) return;
    const now = performance.now(), ducking = now < this.duckUntil;
    const toward = (v, t, rate) => v < t ? Math.min(t, v + rate * dt) : Math.max(t, v - rate * dt);
    this.duckK = toward(this.duckK, ducking ? this.duckLevel : 1, ducking ? 6 : 0.5);
    const want = this.enabled && !this.suppressed();
    this.fadeK = toward(this.fadeK, want ? 1 : 0, 1.6);
    // leaving the title screen: the music starts (or resumes) with a fade in
    if (want && this.el.paused && !this.starting) {
      this.starting = true;
      const pr = this.el.play();
      const done = () => { this.starting = false; };
      if (pr && pr.then) pr.then(() => { this.started = true; done(); }, done); else done();
    }
    const quiet = (typeof GAME !== 'undefined' && (GAME.state === 'pause' || GAME.state === 'victory')) ? 0.6 : 1;
    this.el.volume = Math.max(0, Math.min(1, this.base * this.duckK * this.fadeK * quiet));
    if (!want && this.fadeK <= 0 && !this.el.paused) this.el.pause();
  }
};
MUSIC.init();

SFX.loadSamples();
addEventListener('pointerdown', () => MUSIC.start(), true);
addEventListener('keydown', () => MUSIC.start(), true);
addEventListener('pointerdown', SFX.init, true);
addEventListener('keydown', SFX.init, true);
