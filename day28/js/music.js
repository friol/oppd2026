// Soundtrack: muzik/Modular Turns.mp3 on a loop through a plain <audio> element (works from file:// too).
// Playback starts at the first click or key press (browser rule) and fades in.
// MUSIC.duck(seconds) lowers it for a while (the victory tune). On/off with the Music button or the B key.
const MUSIC = (() => {
  const SRC = 'muzik/Modular Turns.mp3';
  const VOLUME = 0.35, DUCKED = 0.08;
  const STORE = 'day28.music';

  let enabled = localStorage.getItem(STORE) !== 'off';
  let unlocked = false, last = 0, duckUntil = 0;

  const audio = new Audio();
  audio.preload = 'auto';
  audio.loop = true;
  audio.volume = 0;
  audio.src = encodeURI(SRC);

  const target = () => !(enabled && unlocked) ? 0 : performance.now() < duckUntil ? DUCKED : VOLUME;

  // Glide the volume toward its target, then pause when silent.
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const t = target(), v = audio.volume;
    if (t === 0 && v === 0) { if (!audio.paused) audio.pause(); return; }
    if (t > 0 && audio.paused) audio.play().catch(() => { });
    const speed = t < v ? 0.9 : 0.15;   // volume units per second: quick down, slow up
    audio.volume = t > v ? Math.min(t, v + speed * dt) : Math.max(t, v - speed * dt);
  }
  requestAnimationFrame(tick);

  const unlock = () => { unlocked = true; };
  addEventListener('pointerdown', unlock, { once: true });
  addEventListener('keydown', unlock, { once: true });

  return {
    toggle() {
      enabled = !enabled;
      unlocked = true;
      // Apply at once: animation frames (and so the fades) stop in background tabs.
      if (!enabled) { audio.volume = 0; audio.pause(); }
      localStorage.setItem(STORE, enabled ? 'on' : 'off');
      return enabled;
    },
    duck(seconds) { duckUntil = performance.now() + seconds * 1000; },
    get enabled() { return enabled; },
    // For tests: is it playing and how loud.
    get state() { return { playing: !audio.paused, volume: +audio.volume.toFixed(3), time: +audio.currentTime.toFixed(1) }; },
  };
})();
