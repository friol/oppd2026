'use strict';
// Background soundtrack: one looping track played through a plain <audio>
// element (works from file:// too), with gentle fades in and out.
// Toggle with the "Music" button or the N key; the choice is remembered.

const MUSIC = (function () {
  const FILE = 'muzik/western in 2026.mp3';
  const VOLUME = 0.3;
  const FADE = 1.2;              // seconds for a full fade in or out
  const STORE = 'day25.music';

  let enabled = true;
  try { enabled = localStorage.getItem(STORE) !== 'off'; } catch (e) { }

  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.src = encodeURI(FILE);

  let unlocked = false, suspended = false, target = 0, last = 0, raf = 0;

  // Move the volume toward the target, pausing when fully faded out.
  function fade(now) {
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    const step = VOLUME * dt / FADE;
    const v = audio.volume;
    audio.volume = target > v ? Math.min(target, v + step) : Math.max(target, v - step);
    if (audio.volume === target) {
      raf = 0;
      last = 0;
      if (target === 0) audio.pause();
      return;
    }
    raf = requestAnimationFrame(fade);
  }

  function apply() {
    target = enabled && unlocked && !suspended ? VOLUME : 0;
    if (target > 0 && audio.paused) audio.play().catch(() => { });
    if (!raf) raf = requestAnimationFrame(fade);
  }

  // Browsers only allow playback after a user gesture.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    apply();
  }

  // Paused game (page in the background): fade out, and back in afterwards.
  // Background tabs may not run animation frames, so stop at once when hiding.
  function suspend(on) {
    suspended = on;
    if (on) { cancelAnimationFrame(raf); raf = 0; last = 0; audio.volume = 0; audio.pause(); target = 0; return; }
    apply();
  }

  return {
    audio,  // exposed for tests
    unlock,
    suspend,
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem(STORE, enabled ? 'on' : 'off'); } catch (e) { }
      unlocked = true;
      apply();
      return enabled;
    }
  };
})();
