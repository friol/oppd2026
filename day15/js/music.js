// Background music: loops the audible part of the track, fading in at the start and out at the end.
// The player can switch it off with the header button; the choice is remembered.
(function () {
  'use strict';

  const SRC = 'muzic/crosswords.mp3';
  const START = 6.68;   // the file begins with silence up to here
  const END = 104.83;   // the music stops abruptly here; the rest of the file is silence
  const FADE_IN = 2.5;  // seconds, at every (re)start of the loop
  const FADE_OUT = 4;   // seconds, before END
  const SWITCH = 0.6;   // seconds of fade when the player turns the music on or off
  const VOLUME = 0.55;  // background level
  const KEY = 'xw15:music';

  const btn = document.getElementById('music');
  let on = true;
  try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* ignore */ }

  let audio = null;
  let master = 0;  // on/off fade, 0..1
  let target = 0;
  let timer = 0;
  let last = 0;
  let duck = 1;        // music level while the celebration plays, 0..1
  let duckUntil = 0;   // performance.now() until which the music stays ducked
  const DUCK = 0.3, DUCK_FADE = 0.3;
  let ctx = null;      // Web Audio context for the celebration sound

  // Volume envelope of the loop at time t.
  function envelope(t) {
    return Math.max(0, Math.min(1, (t - START) / FADE_IN, (END - t) / FADE_OUT));
  }

  function step() {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    master = target > master ? Math.min(target, master + dt / SWITCH) : Math.max(target, master - dt / SWITCH);
    const want = now < duckUntil ? DUCK : 1;
    duck = want > duck ? Math.min(want, duck + dt / DUCK_FADE) : Math.max(want, duck - dt / DUCK_FADE);
    if (audio.currentTime < START - 0.05 || audio.currentTime >= END || audio.ended) {
      audio.currentTime = START;
      if (audio.paused && target) audio.play().catch(() => {});
    }
    audio.volume = VOLUME * master * duck * envelope(audio.currentTime);
    if (!target && !master) {
      audio.pause();
      clearInterval(timer);
      timer = 0;
    }
  }

  function play() {
    if (!audio) {
      audio = new Audio(SRC);
      audio.preload = 'auto';
      audio.volume = 0;
      // Timers may be throttled while the tab is in the background: the media events keep the loop
      // and the fades going anyway.
      audio.addEventListener('timeupdate', () => { if (timer) step(); });
      audio.addEventListener('ended', () => { if (timer) step(); });
    }
    target = 1;
    audio.play().catch(() => {});
    if (!timer) { last = performance.now(); timer = setInterval(step, 40); }
  }

  function stop() {
    target = 0;
  }

  function render() {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'Turn the music off' : 'Turn the music on';
  }

  btn.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ }
    render();
    if (on) play(); else stop();
  });

  // Browsers allow audio only after a user gesture: start on the first one.
  function kick(ev) {
    if (ev.target === btn) return; // the button handles its own click
    removeEventListener('pointerdown', kick, true);
    removeEventListener('keydown', kick, true);
    if (on) play();
  }
  addEventListener('pointerdown', kick, true);
  addEventListener('keydown', kick, true);

  // Short synthesized fanfare for a solved puzzle: a rising arpeggio, a held chord and a few high
  // sparkles. The music is lowered while it plays. Silent when the music is switched off.
  function celebrate() {
    if (!on) return;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {
      return;
    }
    const t0 = ctx.currentTime + 0.05;
    const out = ctx.createGain();
    out.gain.value = 0.22;
    out.connect(ctx.destination);
    const note = (freq, at, len, type, level) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(level, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
    };
    const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
    [C5, E5, G5, C6].forEach((f, k) => note(f, k * 0.11, 0.35, 'triangle', 0.8));
    for (const f of [C5, E5, G5, C6]) note(f, 0.48, 1.6, 'triangle', 0.45);
    note(C5 / 2, 0.48, 1.6, 'sine', 0.5);
    [1318.5, 1568, 2093].forEach((f, k) => note(f, 0.62 + k * 0.14, 0.4, 'sine', 0.3));
    duckUntil = performance.now() + 2300;
  }

  window.Sound = { celebrate };

  render();
})();
