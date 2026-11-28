// Small synthesized sound effects (Web Audio), on/off with SOUND.toggle().
const SOUND = (() => {
  let ac = null;
  let enabled = localStorage.getItem('day28.sound') !== '0';

  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // Short plastic click: filtered noise burst.
  function click(when = 0, vol = 0.25, freq = 2600) {
    const a = enabled && ctx(); if (!a) return;
    const t = a.currentTime + when, len = 0.045;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * len), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.4;
    const g = a.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }

  // A ring turning: one click per 60-degree step.
  function ratchet(steps, dur) {
    for (let i = 0; i < steps; i++) click(dur * (i + 1) / steps - 0.02, 0.22, 2200 + Math.random() * 800);
  }

  // A tile sliding: soft low thump.
  function slide() {
    const a = enabled && ctx(); if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.2);
    click(0.1, 0.12, 1400);
  }

  // Short victory tune: a quick rising phrase, then a held major chord (about 2 s).
  function win() {
    const a = enabled && ctx(); if (!a) return;
    if (typeof MUSIC !== 'undefined') MUSIC.duck(2.6);   // lower the soundtrack under the tune
    const t0 = a.currentTime + 0.05;
    const out = a.createGain(); out.gain.value = 0.9; out.connect(a.destination);
    // soft echo for a bit of space
    const dl = a.createDelay(); dl.delayTime.value = 0.18;
    const fb = a.createGain(); fb.gain.value = 0.25;
    out.connect(dl).connect(fb).connect(dl); fb.connect(a.destination);
    const note = (f, at, len, vol = 0.16, type = 'triangle') => {
      const t = t0 + at, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(out); o.start(t); o.stop(t + len + 0.05);
    };
    // G4 C5 E5 G5 . E5 G5 | C6 (with a C major chord underneath)
    const N = { G4: 392, C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, E4: 329.63, C4: 261.63 };
    [['G4', 0], ['C5', 0.11], ['E5', 0.22], ['G5', 0.33], ['E5', 0.55], ['G5', 0.66]]
      .forEach(([n, at]) => note(N[n], at, 0.22));
    note(N.C6, 0.82, 1.3, 0.18);
    note(N.C6 * 2, 0.82, 0.9, 0.03, 'sine');          // sparkle
    ['C4', 'E4', 'G4', 'C5'].forEach(n => note(N[n], 0.82, 1.4, 0.07, 'sine'));
  }

  function toggle() {
    enabled = !enabled;
    localStorage.setItem('day28.sound', enabled ? '1' : '0');
    if (enabled) click();
    return enabled;
  }

  return { click, ratchet, slide, win, toggle, get enabled() { return enabled; } };
})();
