// Full-screen behaviour: when the app fills the screen (Fullscreen API or the
// browser's own F11 mode) the mouse pointer and the small controls fade away
// after a moment of stillness, and come back as soon as the mouse moves.
// F toggles full screen.
(function () {
  'use strict';

  const IDLE_MS = 1800;
  const root = document.documentElement;
  let timer = 0;

  function isFullScreen() {
    if (document.fullscreenElement) return true;
    if (window.matchMedia && matchMedia('(display-mode: fullscreen)').matches) return true;
    // F11 in browsers that do not report it: the viewport covers the screen.
    return Math.abs(window.innerWidth - screen.width) < 2 && Math.abs(window.innerHeight - screen.height) < 2;
  }

  function goIdle() {
    // Keep everything visible while the colour panel is open.
    if (isFullScreen() && !document.querySelector('.palette.open')) root.classList.add('idle');
  }

  function wake() {
    root.classList.remove('idle');
    clearTimeout(timer);
    timer = setTimeout(goIdle, IDLE_MS);
  }

  window.addEventListener('pointermove', wake);
  window.addEventListener('pointerdown', wake);
  window.addEventListener('resize', wake);
  document.addEventListener('fullscreenchange', wake);

  document.addEventListener('keydown', e => {
    if ((e.key === 'f' || e.key === 'F') && e.target.tagName !== 'INPUT') {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
    }
  });
  // Double click anywhere on the clock also toggles full screen.
  window.addEventListener('dblclick', e => {
    if (e.target.closest('.palette, .music-toggle, .credit')) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
  });

  wake();
})();
