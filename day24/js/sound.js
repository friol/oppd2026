'use strict';
// Minimal synthesized sound effects (Web Audio, no audio files).

const SOUND = (function () {
  let ctx = null, master = null, noise = null;
  let muted = false;
  try { muted = localStorage.getItem('day24.mute') === '1'; } catch (e) { }

  // The audio context can only start after a user gesture.
  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
    // One second of white noise, reused by every noise-based effect.
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const ready = () => ctx && !muted && ctx.state === 'running';

  // Recorded crowd cheer (soundfx/cheers.wav). A plain <audio> element is used
  // because decoding local files with Web Audio is blocked on file://.
  const CHEER_VOL = 0.8;
  const cheerAudio = new Audio('soundfx/cheers.wav');
  cheerAudio.preload = 'auto';
  let cheerFade = 0;

  // Recorded cat meow (soundfx/cat.ogg), played at a slightly random pitch.
  const catAudio = new Audio('soundfx/cat.ogg');
  catAudio.preload = 'auto';
  catAudio.preservesPitch = false;

  function stopCheers() {
    clearInterval(cheerFade);
    if (cheerAudio.paused) return;
    // Quick fade out so a new round does not cut the sample abruptly.
    cheerFade = setInterval(() => {
      cheerAudio.volume = Math.max(0, cheerAudio.volume - 0.1);
      if (cheerAudio.volume <= 0) { clearInterval(cheerFade); cheerAudio.pause(); }
    }, 40);
  }

  // Filtered noise burst with a short attack and exponential decay.
  function hiss(o) {
    const t = ctx.currentTime + (o.at || 0);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.05);
  }

  // Simple oscillator note with an optional pitch glide.
  function tone(o) {
    const t = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.2, t + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  return {
    init,

    get muted() { return muted; },

    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('day24.mute', muted ? '1' : '0'); } catch (e) { }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.02);
      if (muted) { clearInterval(cheerFade); cheerAudio.pause(); catAudio.pause(); }
      return muted;
    },

    // Cat meow: the recording (or the synthesized one if it cannot play).
    meow() {
      if (muted || !ctx) return;
      catAudio.currentTime = 0;
      catAudio.volume = 0.4;
      catAudio.playbackRate = 0.9 + Math.random() * 0.25;
      catAudio.play().catch(() => this.meowSynth());
    },

    // The crowd cheers: the recorded sample, or synthesized clapping if it cannot play.
    cheers() {
      if (muted || !ctx) return;
      clearInterval(cheerFade);
      cheerAudio.currentTime = 0;
      cheerAudio.volume = CHEER_VOL;
      cheerAudio.play().catch(() => this.applause(1.8));
    },

    stopCheers,

    // Card turned over: a short papery "fft".
    flip() {
      if (!ready()) return;
      hiss({ freq: 3200, q: 0.9, gain: 0.35, dur: 0.06 });
      hiss({ freq: 1600, q: 1.2, gain: 0.18, dur: 0.05, at: 0.03 });
    },

    // Card sliding across the felt; louder and brighter for longer moves.
    whoosh(ms, reach) {
      if (!ready()) return;
      const dur = Math.max(0.08, ms / 1000);
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.4;
      f.frequency.setValueAtTime(450, t);
      f.frequency.exponentialRampToValueAtTime(1300 + 700 * (reach || 1), t + dur * 0.5);
      f.frequency.exponentialRampToValueAtTime(600, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09 + 0.05 * (reach || 1), t + dur * 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(master);
      src.start(t, Math.random() * 0.4);
      src.stop(t + dur + 0.05);
    },

    // Card landing on the felt: soft low thud.
    tap() {
      if (!ready()) return;
      tone({ freq: 150, freqEnd: 90, gain: 0.12, dur: 0.07 });
      hiss({ type: 'lowpass', freq: 900, gain: 0.12, dur: 0.035 });
    },

    // Clay chip click.
    chip() {
      if (!ready()) return;
      hiss({ freq: 4200, q: 6, gain: 0.3, dur: 0.035 });
      hiss({ freq: 3000, q: 6, gain: 0.2, dur: 0.04, at: 0.045 });
    },

    // Found the Joker: rising arpeggio.
    win() {
      if (!ready()) return;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', gain: 0.16, dur: 0.4, at: i * 0.08 }));
    },

    // Wrong card: two falling notes.
    lose() {
      if (!ready()) return;
      tone({ freq: 233, freqEnd: 220, type: 'triangle', gain: 0.2, dur: 0.22 });
      tone({ freq: 175, freqEnd: 150, type: 'triangle', gain: 0.2, dur: 0.45, at: 0.2 });
    },

    // Dealer talking: a quick murmur of low, muffled syllables.
    mumble(words) {
      if (!ready()) return;
      const n = Math.min(9, 2 + Math.round(words * 0.8));
      const t0 = ctx.currentTime;
      for (let i = 0; i < n; i++) {
        const t = t0 + i * 0.075 + Math.random() * 0.02;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(110 + Math.random() * 70, t);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 500 + Math.random() * 500;
        f.Q.value = 3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
        osc.connect(f).connect(g).connect(master);
        osc.start(t);
        osc.stop(t + 0.08);
      }
    },

    // Coin bouncing on the table.
    clink() {
      if (!ready()) return;
      tone({ freq: 2400, type: 'triangle', gain: 0.12, dur: 0.25 });
      tone({ freq: 3570, type: 'sine', gain: 0.07, dur: 0.18 });
      tone({ freq: 2400, type: 'triangle', gain: 0.06, dur: 0.15, at: 0.11 });
    },

    // Crowd clapping: lots of tiny noise claps that thin out toward the end.
    applause(sec) {
      if (!ready()) return;
      for (let i = 0, n = Math.round(30 * sec); i < n; i++) {
        const at = Math.pow(Math.random(), 0.8) * sec;
        hiss({
          freq: 1500 + Math.random() * 2500, q: 0.8, attack: 0.002, at,
          gain: (0.05 + Math.random() * 0.05) * (1 - 0.6 * at / sec), dur: 0.025 + Math.random() * 0.02
        });
      }
    },

    // Crowd "ooh" (or a disappointed "aww" when `down`): a few swelling voices.
    ooh(down) {
      if (!ready()) return;
      [[247, 0.07], [330, 0.05], [392, 0.03]].forEach(([f, g], i) =>
        tone({
          freq: f * (down ? 1.15 : 0.9), freqEnd: f * (down ? 0.82 : 1.12),
          gain: g, dur: 0.9, attack: 0.2, at: i * 0.03
        }));
    },

    // Two guys laughing: five descending "ha"s each.
    laugh() {
      if (!ready()) return;
      for (const base of [215, 255]) {
        const v = Math.random() * 0.08;
        for (let i = 0; i < 5; i++) {
          const t = ctx.currentTime + v + i * 0.13;
          const f0 = base - i * 10;
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(f0, t);
          osc.frequency.exponentialRampToValueAtTime(f0 - 25, t + 0.1);
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 850;
          f.Q.value = 2.5;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.1 * (1 - i * 0.12), t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
          osc.connect(f).connect(g).connect(master);
          osc.start(t);
          osc.stop(t + 0.12);
        }
      }
    },

    // Cat: a synthesized rising and falling "meow" (fallback for meow()).
    meowSynth() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(900, t + 0.16);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.5);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 3;
      f.frequency.setValueAtTime(1000, t);
      f.frequency.exponentialRampToValueAtTime(2200, t + 0.16);
      f.frequency.exponentialRampToValueAtTime(1100, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1, t + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(f).connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.55);
    },

    // Batwing doors: a dry, wobbling creak.
    creak() {
      if (!ready()) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(230, t + 0.25);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.8);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      osc.connect(f).connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.95);
      hiss({ type: 'highpass', freq: 3000, gain: 0.025, dur: 0.6, attack: 0.1 });
    },

    // New table unlocked: a bright little fanfare.
    unlock() {
      if (!ready()) return;
      [659.25, 783.99, 987.77, 1318.5].forEach((f, i) =>
        tone({ freq: f, type: 'square', gain: 0.05, dur: 0.25, at: i * 0.06 }));
    },

    // Bank empty: slow descending phrase.
    gameOver() {
      if (!ready()) return;
      [392, 330, 262, 196].forEach((f, i) =>
        tone({ freq: f, type: 'triangle', gain: 0.18, dur: 0.5, at: i * 0.22 }));
    }
  };
})();
