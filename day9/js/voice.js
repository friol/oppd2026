// Giulia's voice: the browser's speech synthesis. Quiet, a little bright, and
// never queued: a new line cuts the previous one. Silent in a hidden tab.
'use strict';

const Voice = (() => {
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const VOLUME = 0.7, RATE = 1.05, PITCH = 1.15;
  // Names of female voices on the common platforms, preferred for Giulia.
  const FEMALE = /female|zira|aria|jenny|samantha|susan|hazel|libby|sonia|victoria|karen|tessa|moira|fiona|elsa|isabella|alice|federica|paola|elena|google us english|google uk english female/i;
  let on = true, voices = [];

  function load() { voices = synth.getVoices(); }
  if (synth) {
    load();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', load);
  }

  function pick(lang) {
    const pool = voices.filter(v => (v.lang || '').toLowerCase().startsWith(lang));
    return pool.find(v => FEMALE.test(v.name) && v.localService) || pool.find(v => FEMALE.test(v.name)) ||
      pool.find(v => v.localService) || pool[0] || null;
  }

  // lang: 'en' or 'it' (Italian lines get an Italian voice when there is one).
  function speak(text, lang = 'en') {
    if (!on || !synth || document.hidden) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pick(lang) || pick('en');
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang === 'it' ? 'it-IT' : 'en-US';
    u.volume = VOLUME;
    u.rate = RATE;
    u.pitch = PITCH;
    synth.speak(u);
  }

  function stop() { if (synth) synth.cancel(); }

  return {
    speak, stop,
    get available() { return !!synth; },
    get on() { return on; },
    set on(v) { on = !!v; if (!on) stop(); },
  };
})();
