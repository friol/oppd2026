// Synthesized sound of the rockets in flight, with the Doppler effect.
// Every rocket has a voice: a rough sawtooth + square whine, a band of hissing exhaust noise
// and a fast tremolo (the rocket spins). The pitch follows f' = f * c / (c - v), where v is
// the speed at which the rocket and the camera (the listener) approach each other, measured
// from how fast their distance changes: higher while it comes closer, a sharp drop as it
// passes, lower while it flies away. Volume falls with the distance, the sound is panned by
// the side of the screen the rocket is on and gets duller when far away.
// It shares the AudioContext of the engine (see Engine.init).
'use strict';

const RocketSound = (() => {
  const C = 300;           // "speed of sound" (m/s): a bit under the real one for a stronger effect
  const BASE = 360;        // pitch of the whine at rest (Hz)
  const MAX_DIST = 170;    // silent beyond this distance (m)
  const voices = new Map();
  let ac = null, bus = null, noiseBuf = null;
  const _d = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3();

  function setup() {
    const c = Engine.context;
    if (!c) return false;
    if (ac !== c) {
      ac = c;
      voices.clear();
      bus = ac.createGain();
      bus.gain.value = 0.55;
      bus.connect(Engine.world || ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return true;
  }

  function makeVoice() {
    const v = {};
    v.out = ac.createGain(); v.out.gain.value = 0;
    v.pan = ac.createStereoPanner();
    v.lp = ac.createBiquadFilter(); v.lp.type = 'lowpass'; v.lp.frequency.value = 6000;
    v.trem = ac.createGain(); v.trem.gain.value = 0.8;
    v.saw = ac.createOscillator(); v.saw.type = 'sawtooth'; v.saw.frequency.value = BASE;
    v.sq = ac.createOscillator(); v.sq.type = 'square'; v.sq.frequency.value = BASE * 0.503;
    const gs = ac.createGain(); gs.gain.value = 0.2;
    const gq = ac.createGain(); gq.gain.value = 0.12;
    v.noise = ac.createBufferSource(); v.noise.buffer = noiseBuf; v.noise.loop = true;
    v.bp = ac.createBiquadFilter(); v.bp.type = 'bandpass'; v.bp.frequency.value = 1800; v.bp.Q.value = 0.8;
    const gn = ac.createGain(); gn.gain.value = 0.55;
    // tremolo: an LFO moves the gain of v.trem around 0.8
    v.lfo = ac.createOscillator(); v.lfo.frequency.value = 17 + Math.random() * 4;
    const lg = ac.createGain(); lg.gain.value = 0.2;
    v.lfo.connect(lg); lg.connect(v.trem.gain);
    v.saw.connect(gs); gs.connect(v.trem);
    v.sq.connect(gq); gq.connect(v.trem);
    v.noise.connect(v.bp); v.bp.connect(gn); gn.connect(v.trem);
    v.trem.connect(v.lp); v.lp.connect(v.pan); v.pan.connect(v.out); v.out.connect(bus);
    v.saw.start(); v.sq.start(); v.noise.start(0, Math.random()); v.lfo.start();
    v.prevDist = null; v.v = 0; v.dying = 0;
    return v;
  }
  function stopVoice(v) {
    const t = ac.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.02);
    for (const n of [v.saw, v.sq, v.noise, v.lfo]) { try { n.stop(t + 0.15); } catch (e) { } }
    setTimeout(() => { try { v.out.disconnect(); } catch (e) { } }, 300);
  }

  // rockets: [{mesh, ...}] (mesh.position = world position), cam: THREE.Camera, active: false mutes
  function update(rockets, cam, dt, active) {
    if (!setup()) return;
    // rockets that are gone (hit something, ran out, or the race ended): close their voice
    const alive = new Set(rockets);
    for (const [r, v] of voices) if (!alive.has(r)) { stopVoice(v); voices.delete(r); }
    if (!active || dt <= 0) {
      // paused / not racing: everything goes quiet (the voices are kept, they resume later)
      for (const v of voices.values()) v.out.gain.setTargetAtTime(0, ac.currentTime, 0.03);
      return;
    }
    const t = ac.currentTime;
    cam.updateMatrixWorld();
    cam.getWorldDirection(_f);
    _r.crossVectors(_f, cam.up).normalize();
    for (const r of rockets) {
      let v = voices.get(r);
      if (!v) { v = makeVoice(); voices.set(r, v); }
      _d.copy(r.mesh.position).sub(cam.position);
      const dist = _d.length();
      if (v.prevDist !== null) {
        // approach speed (m/s), smoothed: the frame time jitters
        const vc = clamp((v.prevDist - dist) / dt, -C * 0.8, C * 0.8);
        v.v += (vc - v.v) * clamp(dt * 14, 0, 1);
      }
      v.prevDist = dist;
      const ratio = C / (C - v.v);
      v.saw.frequency.setTargetAtTime(BASE * ratio, t, 0.03);
      v.sq.frequency.setTargetAtTime(BASE * 0.503 * ratio, t, 0.03);
      v.bp.frequency.setTargetAtTime(1800 * ratio * ratio, t, 0.03);
      // loudness: 1 / (1 + d / 14)
      const vol = clamp(1 - dist / MAX_DIST, 0, 1) / (1 + dist / 14);
      v.out.gain.setTargetAtTime(vol * 1.6, t, 0.04);
      // air absorbs the highs: a dull sound when far away
      v.lp.frequency.setTargetAtTime(700 + 7000 / (1 + dist / 35), t, 0.05);
      const panT = clamp(_d.dot(_r) / Math.max(8, dist * 0.7), -1, 1);
      v.pan.pan.setTargetAtTime(panT, t, 0.05);
      v.dbg = { v: v.v, ratio, hz: BASE * ratio, gain: vol * 1.6, pan: panT, lp: 700 + 7000 / (1 + dist / 35), dist };
    }
  }
  function clear() { if (!ac) return; for (const v of voices.values()) stopVoice(v); voices.clear(); }

  // for tests: current state of every voice
  function info() { return [...voices.values()].map(v => v.dbg || {}); }
  return { update, clear, info, get voices() { return voices.size; } };
})();
