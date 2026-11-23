// Background music: the tracks in muzik/ played in a shuffled loop through a
// plain <audio> element (works from file:// too), with gentle fades.
// Toggle with the speaker button or the M key; the choice is remembered.
(function () {
  'use strict';

  const TRACKS = [
    { file: 'muzik/ticking.dreams.mp3', title: 'Ticking Dreams' },
    { file: 'muzik/notimeleft.mp3', title: 'No Time Left' },
    { file: 'muzik/done.mp3', title: 'Done' },
  ];
  const VOLUME = 0.35;
  const FADE = 1.2;               // seconds for a full fade in or out
  const STORE = 'day23.music';

  let enabled = true;
  try { enabled = localStorage.getItem(STORE) !== 'off'; } catch (e) { /* default on */ }

  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 0;
  let order = [], idx = 0, loaded = false, target = 0, unlocked = false;

  // A new random order that does not repeat the track just played.
  function shuffle() {
    const last = order[order.length - 1];
    do {
      order = TRACKS.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    } while (order.length > 1 && order[0] === last);
  }

  function load(i) {
    audio.src = encodeURI(TRACKS[order[i]].file);
    loaded = true;
    render();
  }

  audio.addEventListener('ended', () => {
    idx++;
    if (idx >= order.length) { shuffle(); idx = 0; }
    load(idx);
    if (target > 0) audio.play().catch(() => {});
  });

  function play() {
    if (!loaded) { shuffle(); idx = 0; load(0); }
    target = VOLUME;
    audio.play().catch(() => {});   // blocked until the first user gesture
  }
  function stop() { target = 0; }

  // Fades: the volume follows `target`, the track pauses once silent.
  let last = performance.now();
  setInterval(() => {
    const t = performance.now(), dt = (t - last) / 1000;
    last = t;
    const step = VOLUME / FADE * dt;
    const v = audio.volume;
    audio.volume = v < target ? Math.min(target, v + step) : Math.max(target, v - step);
    if (target === 0 && audio.volume === 0 && !audio.paused) audio.pause();
  }, 50);

  // Browsers allow audio only after a user gesture: start on the first one.
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    if (enabled) play();
  }
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock);

  function toggle() {
    enabled = !enabled;
    try { localStorage.setItem(STORE, enabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
    unlocked = true;
    if (enabled) play(); else stop();
    render();
  }

  // ---- UI -----------------------------------------------------------------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'music-toggle';
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor"/>
      <g class="waves" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M15.5 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.8a7.5 7.5 0 0 1 0 10.4"/>
      </g>
      <g class="mute" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M16 9.5l5 5M21 9.5l-5 5"/>
      </g>
    </svg>`;
  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  document.body.appendChild(btn);

  document.addEventListener('keydown', e => {
    if ((e.key === 'm' || e.key === 'M') && e.target.tagName !== 'INPUT') toggle();
  });

  function render() {
    btn.classList.toggle('off', !enabled);
    btn.setAttribute('aria-pressed', String(enabled));
    const title = loaded ? TRACKS[order[idx]].title : '';
    const label = enabled ? 'Music on' + (title ? ' · ' + title : '') : 'Music off';
    btn.title = label + ' (M)';
    btn.setAttribute('aria-label', label);
  }
  render();

  window.MUSIC = { toggle, get enabled() { return enabled; }, audio };
})();
