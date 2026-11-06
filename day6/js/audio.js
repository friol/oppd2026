// Tetraphon sounds, synthesized with Web Audio. Started on the first user gesture.
// Several voice sets: each one gives the pads (clockwise from the top) their own sound, with a version for the
// four pads of the Tetraphon and one for the eight of the Octaphon (a whole octave).
const Sound = (() => {
  let ctx = null, out = null, noise = null, enabled = true, current = 'major', pads = 4;

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      out.connect(comp);
      comp.connect(ctx.destination);
      // One second of white noise for the drums
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  // Gain envelope: quick attack, hold for dur, exponential release
  function env(gain, t, dur, release, attack = 0.012) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
    g.connect(out);
    return g;
  }

  function filter(type, freq, q = 0.7) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  function osc(type, freq, t, end, into) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.connect(into);
    o.start(t);
    o.stop(end + 0.02);
    return o;
  }

  function voice(type, freq, gain, t, dur, release, cutoff) {
    const f = filter('lowpass', cutoff);
    f.connect(env(gain, t, dur, release));
    return osc(type, freq, t, t + dur + release, f);
  }

  function hit(gain, t, decay, type, freq, q) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = filter(type, freq, q);
    s.connect(f);
    f.connect(env(gain, t, 0, decay, 0.002));
    s.start(t);
    s.stop(t + decay + 0.05);
  }

  // A sine whose pitch falls from f0 to f1: kick and tom
  function drop(gain, t, f0, f1, decay) {
    const o = osc('sine', f0, t, t + decay, env(gain, t, 0, decay, 0.003));
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + decay * 0.8);
  }

  const DRUMS = {
    kick(t) { drop(0.9, t, 160, 42, 0.42); hit(0.12, t, 0.02, 'lowpass', 3000, 0.7); },
    snare(t) { hit(0.55, t, 0.2, 'bandpass', 1900, 0.8); drop(0.35, t, 230, 170, 0.12); },
    hat(t) { hit(0.45, t, 0.16, 'highpass', 7500, 0.7); },
    cowbell(t) {
      const f = filter('bandpass', 700, 3);
      f.connect(env(0.4, t, 0, 0.3, 0.002));
      osc('square', 540, t, t + 0.3, f);
      osc('square', 800, t, t + 0.3, f);
    },
    lowTom(t) { drop(0.75, t, 130, 85, 0.36); },
    midTom(t) { drop(0.7, t, 190, 125, 0.32); },
    highTom(t) { drop(0.65, t, 270, 180, 0.28); },
    clap(t) { [0, 0.011, 0.023].forEach((d, i) => hit(0.5, t + d, i < 2 ? 0.02 : 0.16, 'bandpass', 1200, 1.2)); }
  };

  // notes: { 4: Tetraphon pads, 8: Octaphon pads }, in Hz (drums: names of the DRUMS)
  const SETS = {
    // Major chord on the Tetraphon (C4 E4 G4 C5), major scale on the Octaphon; triangle with a soft octave
    major: {
      name: 'Major chord', lcd: 'MAJOR',
      notes: { 4: [261.63, 329.63, 392.0, 523.25], 8: [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25] },
      play(f, t, dur) {
        voice('triangle', f, 0.45, t, dur, 0.09, 3200);
        voice('sine', f * 2, 0.12, t, dur, 0.07, 6000);
      }
    },
    // Pentatonic marimba: struck sine that rings out, with a short bright overtone
    pentatonic: {
      name: 'Pentatonic', lcd: 'PENTA',
      notes: { 4: [329.63, 392.0, 440.0, 587.33], 8: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25] },
      play(f, t, dur) {
        voice('sine', f, 0.6, t, 0, 0.25 + dur * 0.8, 8000);
        voice('sine', f * 3.93, 0.12, t, 0, 0.06, 8000);
        voice('triangle', f / 2, 0.1, t, 0, 0.18, 1200);
      }
    },
    // Drum kit, synthesized from noise and falling sines
    drums: {
      name: 'Drum kit', lcd: 'DRUMS',
      notes: { 4: ['kick', 'snare', 'hat', 'cowbell'], 8: ['kick', 'lowTom', 'snare', 'midTom', 'clap', 'highTom', 'hat', 'cowbell'] },
      play(d, t) { DRUMS[d](t); }
    },
    // 8-bit: square wave flickering between the note and its octave, like an old console (minor scale)
    chip: {
      name: '8-bit', lcd: '8-BIT',
      notes: { 4: [261.63, 311.13, 392.0, 466.16], 8: [261.63, 293.66, 311.13, 349.23, 392.0, 415.3, 466.16, 523.25] },
      play(f, t, dur) {
        const o = voice('square', f, 0.2, t, dur, 0.03, 5000);
        for (let s = 0, i = 0; s < dur + 0.03; s += 0.035, i++) o.frequency.setValueAtTime(i % 2 ? f * 2 : f, t + s);
      }
    },
    // Space: a theremin that glides up to its note and wobbles (whole-tone notes, a bit eerie)
    space: {
      name: 'Space', lcd: 'SPACE',
      notes: { 4: [277.18, 349.23, 440.0, 554.37], 8: [261.63, 293.66, 329.63, 369.99, 415.3, 466.16, 523.25, 587.33] },
      play(f, t, dur) {
        const o = voice('sine', f, 0.5, t, dur, 0.25, 4000);
        o.frequency.setValueAtTime(f * 0.6, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
        const lfo = ctx.createOscillator(), depth = ctx.createGain();
        lfo.frequency.value = 7;
        depth.gain.value = f * 0.035;
        lfo.connect(depth);
        depth.connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.3);
        voice('sawtooth', f * 1.505, 0.05, t + 0.05, dur, 0.25, 1500);
      }
    },
    // Glass: inharmonic partials, like tapping wine glasses
    glass: {
      name: 'Glass', lcd: 'GLASS',
      notes: { 4: [659.25, 783.99, 987.77, 1174.66], 8: [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5] },
      play(f, t, dur) {
        [[1, 0.35, 1.2], [2.76, 0.12, 0.6], [5.4, 0.06, 0.3], [8.93, 0.03, 0.15]].forEach(([m, g, d]) =>
          voice('sine', f * m, g, t, 0, d + dur * 0.5, 12000));
      }
    }
  };

  // Pad sound, ms = how long the pad stays lit
  function tone(pad, ms, delay = 0) {
    if (!ctx || !enabled) return;
    const set = SETS[current];
    set.play(set.notes[pads][pad], ctx.currentTime + delay, Math.max(0.05, ms / 1000));
  }

  // Wrong pad or too slow: low detuned buzz, the same for every set
  function error() {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    voice('sawtooth', 82, 0.3, t, 0.55, 0.25, 700);
    voice('sawtooth', 86.5, 0.3, t, 0.55, 0.25, 700);
  }

  function toggle() {
    enabled = !enabled;
    return enabled;
  }

  // Number of pads of the device: 4 or 8
  function setPads(n) {
    pads = n === 8 ? 8 : 4;
  }

  function setVoices(id) {
    if (SETS[id]) current = id;
    return current;
  }

  return {
    unlock, tone, error, toggle, setVoices, setPads,
    sets: Object.keys(SETS).map(id => ({ id, name: SETS[id].name, lcd: SETS[id].lcd })),
    get voices() { return current; },
    get enabled() { return enabled; }
  };
})();
