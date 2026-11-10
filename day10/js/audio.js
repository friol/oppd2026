'use strict';
// Music: the three MP3 "radio stations" in muzic/ (played with an <audio> element, which also
// works from file://). Engine: physical V8 model (js/engine_dsp.js) in an AudioWorklet.
// Sound effects: WebAudio synth.
const Sound = (() => {
  let ac = null, master, sfxBus, noiseBuf;
  let eng = null;
  let musicOn = true, curTrack = 0, playing = false, playToken = 0;

  const TRACKS = [
    { name: 'SUNSET DRIVE', file: 'muzic/sunset.drive.mp3' },
    { name: 'NEON PULSE', file: 'muzic/neon.pulse.mp3' },
    { name: 'PALM BREEZE', file: 'muzic/palm.breeze.mp3' }
  ];
  const MUSIC_VOL = 0.55;
  const player = new Audio();
  player.loop = true;
  player.preload = 'auto';
  player.volume = MUSIC_VOL;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
    sfxBus = ac.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master);

    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // o: { type, vol, a (attack), sus (sustain until end), cut, cutEnd, q, detune, slide, dest: [nodes] }
  function voice(f, t, dur, o) {
    const osc = ac.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const gn = ac.createGain();
    const a = o.a || 0.004;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(o.vol, t + a);
    if (o.sus) {
      gn.gain.setValueAtTime(o.vol, t + Math.max(a, dur * 0.8));
      gn.gain.linearRampToValueAtTime(0.0001, t + dur);
    } else {
      gn.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + 0.01, dur));
    }
    let node = osc;
    if (o.cut) {
      const fl = ac.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(o.cut, t);
      if (o.cutEnd) fl.frequency.exponentialRampToValueAtTime(o.cutEnd, t + dur);
      fl.Q.value = o.q || 0.7;
      osc.connect(fl); node = fl;
    }
    node.connect(gn);
    for (const dst of (o.dest || [sfxBus])) gn.connect(dst);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function noise(t, dur, o) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ac.createBiquadFilter();
    fl.type = o.ftype || 'highpass'; fl.frequency.value = o.freq || 1000;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(o.vol, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(gn);
    for (const dst of (o.dest || [sfxBus])) gn.connect(dst);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- music
  function playMusic(i) {
    if (i !== undefined) curTrack = i;
    if (!ac) return;                 // wait for the first user gesture (autoplay policy)
    stopMusic();
    if (!musicOn) return;
    const file = TRACKS[curTrack].file;
    if (!player.src.endsWith(file)) player.src = file;   // reload only when the station changes
    player.currentTime = 0;
    playing = true;
    const token = ++playToken;
    player.play().catch(e => { if (token === playToken && e.name !== 'AbortError') playing = false; });
  }
  function stopMusic() { playing = false; player.pause(); }
  function toggleMusic() { musicOn = !musicOn; if (musicOn) playMusic(); else stopMusic(); return musicOn; }

  // ---------------------------------------------------------------- engine
  // Physical V8 model (js/engine_dsp.js) running sample by sample in an AudioWorklet, loaded
  // from a data: URL so it also works from file://; ScriptProcessor fallback. A 2-speed gearbox maps
  // speed to rpm: the revs climb, glide down after the shift and wander a little at full throttle.
  const GEARS = [0, 0.42, 1.0]; // speed fraction where each gear ends: LOW and HIGH, arcade style
  const IDLE = 800, LOW = 3000, RED = 6200;
  const ENGINE_VOL = 0.9;
  let gearNow = 0, rpmNow = IDLE, shiftT = 0;

  const WORKLET_SRC = EngineDSP.toString() + `
    class RetroRunEngine extends AudioWorkletProcessor {
      constructor() { super(); this.d = new EngineDSP(sampleRate); this.port.onmessage = e => Object.assign(this.d, e.data); }
      process(inputs, outputs) { const o = outputs[0][0]; if (o) this.d.process(o); return true; }
    }
    registerProcessor('retrorun-engine', RetroRunEngine);`;

  function engineStart() {
    if (!ac || eng) return;
    const bus = ac.createGain(); bus.gain.value = 0.55; bus.connect(sfxBus); // engine sits under the music
    const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;      // off-road rumble
    const nf = ac.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 500;
    const ng = ac.createGain(); ng.gain.value = 0;
    n.connect(nf); nf.connect(ng); ng.connect(bus); n.start();
    eng = { ng, mode: 'loading', set: () => {} };
    const fallback = () => {
      const d = new EngineDSP(ac.sampleRate);
      const sp = ac.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = e => d.process(e.outputBuffer.getChannelData(0));
      sp.connect(bus);
      eng.set = p => Object.assign(d, p); eng.mode = 'script';
    };
    if (!ac.audioWorklet) { fallback(); return; }
    // a data: URL (blob: URLs are refused for worklets when the page is opened from file://)
    const url = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(WORKLET_SRC);
    ac.audioWorklet.addModule(url).then(() => {
      const node = new AudioWorkletNode(ac, 'retrorun-engine', { numberOfInputs: 0, outputChannelCount: [1] });
      node.connect(bus);
      eng.set = p => node.port.postMessage(p); eng.mode = 'worklet';
    }).catch(e => { console.warn('RetroRun: AudioWorklet unavailable, using ScriptProcessor', e && e.message); fallback(); });
  }

  function engineSet(pct, throttle, on, rough) {
    if (!eng) return;
    const t = ac.currentTime;
    pct = Math.max(0, Math.min(1, pct));
    let gear = 0;
    while (gear < GEARS.length - 2 && pct > GEARS[gear + 1]) gear++;
    const local = (pct - GEARS[gear]) / (GEARS[gear + 1] - GEARS[gear]);
    let rpm = gear === 0 ? IDLE + local * (RED - IDLE) : LOW + local * (RED - LOW);
    if (!throttle) rpm *= 0.93;                         // off the gas the revs sag
    // keep it alive at full chat: slow wander + a little flutter near the top of each gear
    rpm += Math.sin(t * 0.7) * 140 + Math.sin(t * 1.9 + 1) * 70 + (throttle ? Math.sin(t * 9) * 25 * local : 0);
    if (!on) rpm = IDLE;
    if (gear !== gearNow) shiftT = 0.4;
    gearNow = gear;
    shiftT = Math.max(0, shiftT - 1 / 60);
    // revs glide down over ~0.4 s after a shift (follow rate 0.06 per frame), quick otherwise
    rpmNow += (rpm - rpmNow) * (shiftT > 0 ? 0.06 : 0.35);
    eng.ng.gain.setTargetAtTime(on && rough ? 0.18 * Math.min(1, pct * 3) : 0, t, 0.05);
    // during the first moments of a shift the load drops (gentle torque dip)
    const load = !on ? 0.1 : throttle ? (shiftT > 0.28 ? 0.45 : 1) : 0.05;
    const vol = on ? ENGINE_VOL * (throttle ? 1 : 0.7) : 0;
    eng.set({ rpm: rpmNow, load, vol });
  }

  // ---------------------------------------------------------------- sfx
  const now = () => ac.currentTime + 0.01;
  const sfx = {
    coin() { if (!ac) return; const t = now(); voice(988, t, 0.07, { type: 'square', vol: 0.16 }); voice(1319, t + 0.06, 0.14, { type: 'square', vol: 0.16 }); },
    wrench() { if (!ac) return; const t = now(); [523, 659, 784, 1047].forEach((f, i) => voice(f, t + i * 0.06, 0.14, { type: 'triangle', vol: 0.3 })); },
    bump() { if (!ac) return; const t = now(); noise(t, 0.25, { ftype: 'lowpass', freq: 900, vol: 0.6 }); voice(90, t, 0.2, { type: 'square', vol: 0.3, slide: 45, cut: 500 }); },
    crash() { if (!ac) return; const t = now(); noise(t, 0.7, { ftype: 'lowpass', freq: 1400, vol: 0.8 }); voice(120, t, 0.5, { type: 'square', vol: 0.35, slide: 35, cut: 700 }); },
    scrape() { if (!ac) return; noise(now(), 0.08, { ftype: 'highpass', freq: 3000, vol: 0.15 }); },
    checkpoint() { if (!ac) return; const t = now(); [784, 988, 1175, 1568].forEach((f, i) => voice(f, t + i * 0.09, 0.18, { type: 'square', vol: 0.18 })); },
    fork() { if (!ac) return; const t = now(); voice(660, t, 0.08, { type: 'square', vol: 0.15 }); voice(880, t + 0.08, 0.12, { type: 'square', vol: 0.15 }); },
    beep(hi) { if (!ac) return; voice(hi ? 1760 : 880, now(), hi ? 0.4 : 0.18, { type: 'square', vol: 0.2 }); },
    alarm() { if (!ac) return; voice(660, now(), 0.1, { type: 'square', vol: 0.1 }); },
    select() { if (!ac) return; voice(1320, now(), 0.05, { type: 'square', vol: 0.12 }); },
    gameOver() { if (!ac) return; const t = now(); [523, 440, 349, 262].forEach((f, i) => voice(f, t + i * 0.22, 0.3, { type: 'triangle', vol: 0.35 })); },
    // camera shutter: click, short film wind
    shutter() { if (!ac) return; const t = now(); noise(t, 0.03, { freq: 2500, vol: 0.5 }); noise(t + 0.07, 0.04, { freq: 1800, vol: 0.35 }); sweepNoise(t + 0.12, 0.25, 'bandpass', 1200, 2600, 0.12, 3); },
    // landing after a jump, k 0..1
    land(k) { if (!ac) return; const t = now(); voice(80, t, 0.22, { type: 'square', vol: 0.12 + 0.25 * k, slide: 38, cut: 380 }); noise(t, 0.18, { ftype: 'lowpass', freq: 700, vol: 0.25 + 0.4 * k }); },
    // overtaking streak milestone
    streak(big) { if (!ac) return; const t = now(); (big ? [659, 880, 1109, 1319, 1760] : [880, 1109, 1319]).forEach((f, i) => voice(f, t + i * 0.05, 0.1, { type: 'square', vol: 0.13 })); },
    // radio tuning noise when the DJ tag appears
    tune() { if (!ac) return; sweepNoise(now(), 0.3, 'bandpass', 900, 3200, 0.1, 4); },
    // distant firework: soft thump, then crackle (delay: sound travels slower than light)
    firework() { if (!ac) return; const t = now() + 0.25 + Math.random() * 0.3; noise(t, 0.35, { ftype: 'lowpass', freq: 380, vol: 0.22 }); for (let i = 0; i < 6; i++) noise(t + 0.25 + Math.random() * 0.5, 0.03, { freq: 3500, vol: 0.05 }); },
    // far-away freight train horn: two low detuned chords
    trainHorn() { if (!ac) return; const t = now(); for (const [d, l] of [[0, 0.9], [1.1, 1.6]]) for (const f of [233, 277, 349]) voice(f, t + d, l, { type: 'sawtooth', vol: 0.025, a: 0.08, sus: true, cut: 700 }); },
    goal() {
      if (!ac) return; const t = now();
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.6], [1047, 0.72]].forEach(([f, d]) => voice(f, t + d, 0.25, { type: 'square', vol: 0.18 }));
    }
  };

  // ---------------------------------------------------------------- horn, siren, weather
  // filtered-noise one-shot with a frequency sweep
  function sweepNoise(t, dur, type, f0, f1, vol, q = 1) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl); fl.connect(g); g.connect(sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  function horn() {           // two-tone car horn (G4 + B4), slightly detuned squares
    if (!ac) return;
    const t = now();
    for (const f of [392, 494]) voice(f, t, 0.42, { type: 'square', vol: 0.11, a: 0.01, sus: true, cut: 1800, detune: f === 392 ? -6 : 6 });
  }
  // overdrive horn: the opening of "La Cucaracha" (traditional folk tune) on the two-tone horn
  function hornTune() {
    if (!ac) return;
    const t = now();
    [[392, 0, 0.11], [392, 0.13, 0.11], [392, 0.26, 0.11], [523, 0.39, 0.3], [659, 0.72, 0.42]].forEach(([f, d, l]) => {
      voice(f, t + d, l, { type: 'square', vol: 0.1, a: 0.01, sus: true, cut: 1900, detune: -5 });
      voice(f * 1.26, t + d, l, { type: 'square', vol: 0.06, a: 0.01, sus: true, cut: 1900, detune: 5 });   // a third above
    });
  }
  function whoosh() { if (ac) sweepNoise(now(), 0.4, 'bandpass', 2400, 350, 0.5, 1.2); }
  function thunder() {        // crack, then a long low rumble
    if (!ac) return;
    const t = now();
    sweepNoise(t, 0.35, 'highpass', 3000, 900, 0.35);
    sweepNoise(t + 0.05, 2.8, 'lowpass', 420, 60, 0.9, 0.7);
  }

  // continuous layers created on first use: police siren, rain, desert wind
  let amb = null;
  function ambInit() {
    if (amb || !ac) return;
    const loop = (type, freq, q) => {
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(fl); fl.connect(g); g.connect(sfxBus); src.start(0, Math.random());
      return { fl, g };
    };
    const rain = loop('highpass', 1400, 0.5), wind = loop('bandpass', 380, 0.8);
    // wind howl: the band moves slowly
    const wl = ac.createOscillator(); wl.frequency.value = 0.23;
    const wd = ac.createGain(); wd.gain.value = 160; wl.connect(wd); wd.connect(wind.fl.frequency); wl.start();
    // US-style wail siren: sawtooth swept by a slow triangle
    const so = ac.createOscillator(); so.type = 'sawtooth'; so.frequency.value = 950;
    const sl = ac.createOscillator(); sl.type = 'triangle'; sl.frequency.value = 0.55;
    const sd = ac.createGain(); sd.gain.value = 380; sl.connect(sd); sd.connect(so.frequency);
    const sf = ac.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2200;
    const sg = ac.createGain(); sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(sfxBus); so.start(); sl.start();
    amb = { rain, wind, siren: sg };
  }
  // levels 0..1
  function ambient(rain, wind, siren) {
    if (!ac) return;
    ambInit();
    const t = ac.currentTime;
    amb.rain.g.gain.setTargetAtTime(rain * 0.16, t, 0.3);
    amb.wind.g.gain.setTargetAtTime(wind * 0.22, t, 0.3);
    amb.siren.gain.setTargetAtTime(siren * 0.05, t, 0.15);
  }

  // ---------------------------------------------------------------- tunnel echo
  // two feedback delays (slap-back off the walls) fed by everything on the sfx bus
  // (engine included); the music is an <audio> element, so in the tunnel it is only turned down
  let echo = null;
  function echoInit() {
    if (echo || !ac) return;
    const send = ac.createGain(), wet = ac.createGain(); wet.gain.value = 0;
    for (const [dt, fb] of [[0.071, 0.45], [0.127, 0.38]]) {
      const d = ac.createDelay(1); d.delayTime.value = dt;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
      const g = ac.createGain(); g.gain.value = fb;
      send.connect(d); d.connect(f); f.connect(g); g.connect(d); f.connect(wet);
    }
    sfxBus.connect(send); wet.connect(master);
    echo = { wet, k: 0 };
  }
  // k: 0 (open air) .. 1 (deep in the tunnel)
  function tunnel(k) {
    if (!ac) return;
    echoInit();
    if (k === echo.k) return;
    echo.k = k;
    echo.wet.gain.setTargetAtTime(k * 0.75, ac.currentTime, 0.08);
    player.volume = MUSIC_VOL * (1 - 0.45 * k);
  }

  function suspend() { if (ac && ac.state === 'running') ac.suspend(); if (playing) player.pause(); }
  function resume() { if (ac && ac.state === 'suspended') ac.resume(); if (playing) player.play().catch(() => {}); }

  // getters must live on the returned object itself (Object.assign would copy their current value)
  return Object.assign({
    init, playMusic, stopMusic, toggleMusic, engineStart, engineSet, suspend, resume,
    horn, hornTune, whoosh, thunder, ambient, tunnel,
    tracks: TRACKS.map(t => t.name),
    get musicOn() { return musicOn; },
    get nowPlaying() { return playing && !player.paused ? TRACKS[curTrack].name : null; },
    get engineMode() { return eng ? eng.mode : null; },
    get ready() { return !!ac; }
  }, sfx);
})();
