// Engine sound of the player's car: the physical V8 model of engine_dsp.js (from day10,
// RetroRun) running in an AudioWorklet, loaded from a data: URL so it also works from
// file:// (blob: URLs are refused there); ScriptProcessor fallback.
// 5-speed gearbox: in each gear the rpm is proportional to the speed; upshifts cut the
// torque for a moment and drop the revs, downshifts blip the throttle; every shift has a
// synthesized mechanical clunk (plus an exhaust crack on hard upshifts).
'use strict';

const Engine = (() => {
  // speed fraction (speed / top speed) at which each gear reaches the redline
  // (5th reaches the redline only with a boost)
  const GEAR_TOP = [0.34, 0.6, 0.8, 0.93, 1.12];
  const IDLE = 800, RED = 6400, LIMIT = 7200, LAUNCH = 3800;
  const UP_AT = 0.97, DOWN_AT = 0.8;    // shift points (fraction of the gear's range): hysteresis
  const SHIFT_UP = 0.22, SHIFT_DOWN = 0.22;  // duration of a shift, seconds
  const MIN_UP = 0.65, MIN_DOWN = 0.9;       // minimum time in a gear before the next up / down shift
  const VOL = 0.9;
  let ac = null, out = null, eng = null, noiseBuf = null;
  let gearNow = 1, neutralNow = true, rpmNow = IDLE, shiftT = 0, shiftDir = 0, time = 0, inGear = 0;

  const WORKLET_SRC = EngineDSP.toString() + `
    class KarioEngine extends AudioWorkletProcessor {
      constructor() { super(); this.d = new EngineDSP(sampleRate); this.port.onmessage = e => Object.assign(this.d, e.data); }
      process(inputs, outputs) { const o = outputs[0][0]; if (o) this.d.process(o); return true; }
    }
    registerProcessor('kario-engine', KarioEngine);`;

  // Needs a user gesture: called from the first key press / click
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    out = ac.createGain();
    out.gain.value = 0.5;     // under the nitro / shield samples
    out.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    eng = { mode: 'loading', set: () => { } };
    const fallback = () => {
      const d = new EngineDSP(ac.sampleRate);
      const sp = ac.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = e => d.process(e.outputBuffer.getChannelData(0));
      sp.connect(out);
      eng.set = p => Object.assign(d, p); eng.mode = 'script';
    };
    if (!ac.audioWorklet) { fallback(); return; }
    const url = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(WORKLET_SRC);
    ac.audioWorklet.addModule(url).then(() => {
      const node = new AudioWorkletNode(ac, 'kario-engine', { numberOfInputs: 0, outputChannelCount: [1] });
      node.connect(out);
      eng.set = p => node.port.postMessage(p); eng.mode = 'worklet';
    }).catch(e => { console.warn('Kario Mart: AudioWorklet unavailable, using ScriptProcessor', e && e.message); fallback(); });
  }

  // Short filtered noise burst
  function burst(t, dur, type, freq, q, vol) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.2, dur + 0.02);
  }
  // Gear change: metallic clunk + low knock; hard upshifts also crack the exhaust
  function shiftSound(up, hard) {
    if (!ac || !noiseBuf) return;
    const t = ac.currentTime + 0.005;
    burst(t, 0.045, 'bandpass', up ? 2100 : 1700, 2.5, 0.35);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(up ? 110 : 95, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.07);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.1);
    if (up && hard) burst(t + 0.03, 0.11, 'lowpass', 700, 0.8, 0.55);
  }

  // pct: speed / top speed (above 1 with boost); neutral: revving on the grid;
  // rev: pitch character of the car type (rpm multiplier)
  function set(dt, pct, throttle, on, neutral, rev) {
    if (!eng) return;
    time += dt;
    pct = clamp(pct, 0, 1.4);
    neutralNow = !!neutral || !on;
    // gearbox with hysteresis (one gear at a time, not while a shift is in progress)
    let gear = gearNow;
    inGear += dt;
    if (neutralNow) gear = 1;
    else if (shiftT <= 0) {
      if (gear < GEAR_TOP.length && pct > GEAR_TOP[gear - 1] * UP_AT && inGear > MIN_UP) gear++;
      // (hard braking: shift down anyway when the revs would fall far too low)
      else if (gear > 1 && pct < GEAR_TOP[gear - 2] * DOWN_AT && (inGear > MIN_DOWN || pct < GEAR_TOP[gear - 2] * 0.55)) gear--;
    }
    if (gear !== gearNow && !neutralNow) {
      shiftDir = gear > gearNow ? 1 : -1;
      shiftT = shiftDir > 0 ? SHIFT_UP : SHIFT_DOWN;
      shiftSound(shiftDir > 0, throttle && rpmNow > 5200);
      inGear = 0;
    }
    gearNow = gear;
    shiftT = Math.max(0, shiftT - dt);

    let rpm = RED * pct / GEAR_TOP[gear - 1];
    if (neutral) rpm = throttle ? 5600 : IDLE;
    else {
      if (gear === 1 && throttle) rpm = Math.max(rpm, LAUNCH);   // clutch slip at launch
      if (!throttle) rpm *= 0.95;                                // off the gas the revs sag
      if (shiftT > 0 && shiftDir < 0) rpm += 500;                // rev-matching blip
      rpm = Math.max(IDLE, rpm);
    }
    // keep it alive: slow wander + a little flutter at full throttle
    rpm += Math.sin(time * 0.7) * 110 + Math.sin(time * 1.9 + 1) * 50 + (throttle ? Math.sin(time * 9) * 25 : 0);
    rpm = Math.min(LIMIT, rpm) * (rev || 1);
    if (!on) rpm = IDLE;
    // follow: very quick drop on an upshift, quick otherwise (rates per 60 fps frame)
    const k = 1 - Math.pow(shiftT > 0 ? (shiftDir > 0 ? 0.72 : 0.6) : 0.65, dt * 60);
    rpmNow += (rpm - rpmNow) * k;
    // load: torque cut during an upshift, throttle blip on a downshift
    let load = !on ? 0.1 : throttle ? 1 : 0.05;
    if (on && shiftT > 0) load = shiftDir > 0 ? 0.12 : 0.75;
    const vol = on ? VOL * (throttle ? 1 : 0.7) : 0;
    eng.set({ rpm: rpmNow, load, vol });
  }

  return {
    init, set,
    get mode() { return eng ? eng.mode : null; },
    get rpm() { return rpmNow; },
    get gear() { return gearNow; },
    get gearLabel() { return neutralNow ? 'N' : String(gearNow); },
    get output() { return out; },
    get context() { return ac; }
  };
})();
