// Soundtrack: the three tracks in muzik/ play in rotation through a plain
// <audio> element (works from file:// too), starting from a random one.
// Playback starts at the first click or key press (browser rule) and fades in.
// It keeps playing when the tab is hidden or the browser is in the background
// (the 'ended' event still moves to the next track there).
// Toggle with the Music button or the M key.
const MUSIC = (() => {
  const TRACKS = ['muzik/Generative Drift.mp3', 'muzik/Liminal Bloom.mp3', 'muzik/Endless Side-scrolling.mp3'];
  const VOLUME = 0.45;
  const STORE = 'day27.music';

  let enabled = localStorage.getItem(STORE) !== 'off';
  let track = Math.floor(Math.random() * TRACKS.length);
  let unlocked = false, last = 0;

  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 0;
  audio.src = encodeURI(TRACKS[track]);
  // When a track ends, the next one in the rotation starts.
  audio.addEventListener('ended', () => {
    track = (track + 1) % TRACKS.length;
    audio.src = encodeURI(TRACKS[track]);
    if (target() > 0) audio.play().catch(() => { });
  });

  const target = () => (enabled && unlocked ? VOLUME : 0);

  // Glide the volume toward its target, then pause when silent.
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    const t = target(), v = audio.volume;
    if (t === 0 && v === 0) { if (!audio.paused) audio.pause(); return; }
    if (t > 0 && audio.paused) audio.play().catch(() => { });
    const speed = t < v ? 0.8 : 0.15; // volume units per second
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
    get enabled() { return enabled; },
    // For tests: what is playing and how loud.
    get state() { return { track: TRACKS[track], playing: !audio.paused, volume: +audio.volume.toFixed(3) }; },
  };
})();
