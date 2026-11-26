// Soundtrack: the two tracks in muzik/ play one after the other through a plain <audio> element
// (works from file:// too). The volume stays low and dips whenever a sound effect plays,
// so the effects are always heard. Toggle with the music button or the N key.
'use strict';

const MUSIC = (() => {
  const TRACKS = ['muzik/City Taking Shape.mp3', 'muzik/Foundations of Tomorrow.mp3'];
  const VOLUME = 0.22;   // normal level, well below the effects
  const DUCKED = 0.08;   // level while an effect is playing
  const STORE = 'day26.music';

  let enabled = localStorage.getItem(STORE) !== 'off';
  let track = Math.floor(Math.random() * TRACKS.length);
  let unlocked = false, suspended = false, duckUntil = 0, last = 0;

  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 0;
  audio.src = encodeURI(TRACKS[track]);
  // When a track ends, the other one starts.
  audio.addEventListener('ended', () => {
    track = (track + 1) % TRACKS.length;
    audio.src = encodeURI(TRACKS[track]);
    if (target() > 0) audio.play().catch(() => { });
  });

  function target() {
    if (!enabled || !unlocked || suspended) return 0;
    return performance.now() < duckUntil ? DUCKED : VOLUME;
  }
  // Glide the volume toward its target: quick when ducking, slow when coming back.
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const t = target(), v = audio.volume;
    if (t === 0 && v === 0) { if (!audio.paused) audio.pause(); return; }
    if (t > 0 && audio.paused) audio.play().catch(() => { });
    const speed = t < v ? 0.6 : 0.12; // volume units per second
    audio.volume = t > v ? Math.min(t, v + speed * dt) : Math.max(t, v - speed * dt);
  }
  requestAnimationFrame(tick);

  return {
    // Browsers only allow playback after a user gesture.
    unlock() { if (!unlocked) { unlocked = true; if (enabled) audio.play().catch(() => { }); } },
    // Lower the music for a moment while an effect plays.
    duck(seconds = 1.2) { duckUntil = Math.max(duckUntil, performance.now() + seconds * 1000); },
    // Page hidden: stop at once (background tabs may not run animation frames).
    suspend(on) { suspended = on; if (on) { audio.volume = 0; audio.pause(); } },
    toggle() { enabled = !enabled; localStorage.setItem(STORE, enabled ? 'on' : 'off'); if (enabled && unlocked) audio.play().catch(() => { }); return enabled; },
    get enabled() { return enabled; },
    // For tests: what is playing and how loud.
    get state() { return { track: TRACKS[track], playing: !audio.paused, volume: +audio.volume.toFixed(3) }; }
  };
})();
