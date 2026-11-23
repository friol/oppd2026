// Colour selector: five atmospheric presets plus free choice of the body,
// hand and light colours. The choice is remembered in localStorage.
(function () {
  'use strict';

  // Surface finishes: material parameters applied on top of a preset.
  const FINISHES = {
    paint: { name: 'Wood', finish: 'paint', metal: 0, rough: 0.88, bump: 0.009, envI: 0.3 },
    satin: { name: 'Lacquer', finish: 'paint', metal: 0, rough: 0.5, bump: 0.005, envI: 0.55 },
    metal: { name: 'Metal', finish: 'metal', metal: 0.85, rough: 0.4, bump: 0.003, envI: 1.0 },
  };

  // Hand materials. Metals bring their own colour (a custom hand colour
  // still wins, giving a tinted metal); 'paint' uses the preset's colour.
  const HAND_FINISHES = {
    paint: { name: 'Matte', handMetal: 0, handRough: 0.6, handEnv: 0.35 },
    steel: { name: 'Steel', color: '#d4d8de', handMetal: 1, handRough: 0.12, handEnv: 1.4 },
    gold: { name: 'Gold', color: '#e8bd62', handMetal: 1, handRough: 0.16, handEnv: 1.4 },
    brass: { name: 'Brass', color: '#c9a36a', handMetal: 1, handRough: 0.3, handEnv: 1.3 },
    copper: { name: 'Copper', color: '#d98a64', handMetal: 1, handRough: 0.18, handEnv: 1.4 },
    black: { name: 'Black', color: '#303136', handMetal: 1, handRough: 0.1, handEnv: 1.6 },
  };

  const PRESETS = [
    {
      id: 'gallery', name: 'Gallery', note: 'Chalk-painted wood, ink hands, warm afternoon light',
      body: '#f6f5f2', hands: '#050505', light: '#fff1e0',
      wall: '#e3dfd8', sky: '#ffffff', ground: '#d9d2c6', fill: '#e6eeff',
      keyI: 1.1, hemiI: 0.42, fillI: 0.22, exposure: 1.15, handSurface: 'paint', surface: 'paint',
    },
    {
      id: 'midnight', name: 'Midnight Ink', note: 'Anodised navy aluminium, polished steel hands, cool moonlight',
      body: '#2a3a6a', hands: '#f2f1ec', light: '#dbe5ff',
      wall: '#cfd2d9', sky: '#eef2ff', ground: '#7f89a6', fill: '#b8c9ff',
      keyI: 1.25, hemiI: 0.45, fillI: 0.3, exposure: 1.1, handSurface: 'steel', surface: 'metal',
    },
    {
      id: 'dusk', name: 'Terracotta Dusk', note: 'Clay-painted wood, brass hands, low amber sun',
      body: '#c47657', hands: '#f4e7d4', light: '#ffb57d',
      wall: '#e6d2c1', sky: '#ffe2c8', ground: '#9c5e46', fill: '#a9b9ff',
      keyI: 1.25, hemiI: 0.38, fillI: 0.25, exposure: 1.05, handSurface: 'brass', surface: 'paint',
    },
    {
      id: 'sage', name: 'Sage Morning', note: 'Sage satin lacquer, charcoal hands, soft daylight',
      body: '#bcc6b0', hands: '#272b26', light: '#fffbea',
      wall: '#e7e9e0', sky: '#f5fff0', ground: '#b2b8a2', fill: '#dde9ff',
      keyI: 1.0, hemiI: 0.45, fillI: 0.22, exposure: 1.15, handSurface: 'paint', surface: 'satin',
    },
    {
      id: 'graphite', name: 'Graphite Night', note: 'Brushed graphite steel, steel hands, blue lamp',
      body: '#3a3a3e', hands: '#d9dade', light: '#d0d9f2',
      wall: '#1c1c1f', sky: '#868b99', ground: '#0f0f11', fill: '#7d8aad',
      keyI: 1.5, hemiI: 0.3, fillI: 0.35, exposure: 1.2, handSurface: 'steel', surface: 'metal',
    },
  ];
  const STORE = 'day23.look';

  // ---- State --------------------------------------------------------------
  const CUSTOM_KEYS = ['body', 'hands', 'light', 'surface', 'handSurface'];
  const blank = () => ({ preset: 'gallery', body: null, hands: null, light: null, surface: null, handSurface: null, sunlight: false, lens: true, ao: true, film: true, leaves: true });
  let state = blank();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && PRESETS.some(p => p.id === saved.preset)) state = Object.assign(state, saved);
    if (state.surface && !FINISHES[state.surface]) state.surface = null;
    if (state.handSurface && !HAND_FINISHES[state.handSurface]) state.handSurface = null;
  } catch (e) { /* storage unavailable: use the default */ }

  const presetOf = id => PRESETS.find(p => p.id === id) || PRESETS[0];
  // The look applied: the preset, with any custom choice on top.
  function current() {
    const base = presetOf(state.preset), p = Object.assign({}, base);
    for (const k of CUSTOM_KEYS) if (state[k]) p[k] = state[k];
    const hf = HAND_FINISHES[p.handSurface];
    if (!state.hands && hf.color) p.hands = hf.color;
    return Object.assign(p, FINISHES[p.surface], {
      handMetal: hf.handMetal, handRough: hf.handRough, handEnv: hf.handEnv,
    });
  }
  const isCustom = () => CUSTOM_KEYS.some(k => state[k]);

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // Page text (credit, selector) follows the brightness of the wall.
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  }
  function applyPageTheme(p) {
    document.documentElement.dataset.tone = luminance(p.wall) < 0.45 ? 'dark' : 'light';
  }

  function apply(instant) {
    const p = current();
    window.CLOCK.setLook(p, instant);
    window.CLOCK.setOptions({
      sun: state.sunlight === true, lens: state.lens !== false,
      ao: state.ao !== false, film: state.film !== false,
      leaves: state.leaves !== false,
    });
    applyPageTheme(p);
    render();
  }

  // ---- UI -----------------------------------------------------------------
  const root = document.createElement('div');
  root.className = 'palette';
  root.innerHTML = `
    <button class="palette-toggle" type="button" aria-expanded="false" aria-label="Colours" title="Colours">
      <span class="dot"></span>
    </button>
    <div class="palette-panel" role="dialog" aria-label="Colours">
      <div class="palette-head">
        <span class="palette-title">Atmosphere</span>
        <span class="palette-name"></span>
      </div>
      <div class="palette-presets"></div>
      <p class="palette-note"></p>
      <div class="palette-label">Body</div>
      <div class="palette-finish" role="radiogroup" aria-label="Body finish"></div>
      <div class="palette-label">Hands <span class="palette-hand-name"></span></div>
      <div class="palette-hands" role="radiogroup" aria-label="Hand material"></div>
      <div class="palette-custom">
        <label><input type="color" data-k="body"><span>Body</span></label>
        <label><input type="color" data-k="hands"><span>Hands</span></label>
        <label><input type="color" data-k="light"><span>Light</span></label>
      </div>
      <div class="palette-switches">
        <label><input type="checkbox" data-opt="sunlight"><span>Light follows time</span></label>
        <label><input type="checkbox" data-opt="lens"><span>Lens blur</span></label>
        <label><input type="checkbox" data-opt="ao"><span>Soft contact shadows</span></label>
        <label><input type="checkbox" data-opt="film"><span>Film grain &amp; vignette</span></label>
        <label><input type="checkbox" data-opt="leaves"><span>Weather (leaves, snow, rain, petals)</span></label>
      </div>
      <button class="palette-reset" type="button">Reset to preset</button>
    </div>`;
  document.body.appendChild(root);

  const toggle = root.querySelector('.palette-toggle');
  const presetsEl = root.querySelector('.palette-presets');
  const nameEl = root.querySelector('.palette-name');
  const noteEl = root.querySelector('.palette-note');
  const resetEl = root.querySelector('.palette-reset');
  const finishEl = root.querySelector('.palette-finish');
  const handsEl = root.querySelector('.palette-hands');
  const handNameEl = root.querySelector('.palette-hand-name');

  // Hand materials: small round chips shaded like the metal they stand for.
  for (const id of Object.keys(HAND_FINISHES)) {
    const f = HAND_FINISHES[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', f.name);
    b.title = f.name;
    b.dataset.id = id;
    b.addEventListener('click', () => {
      state.handSurface = id === presetOf(state.preset).handSurface ? null : id;
      state.hands = null;   // a new material brings its own colour
      save();
      apply(false);
    });
    handsEl.appendChild(b);
  }

  for (const id of Object.keys(FINISHES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.id = id;
    b.textContent = FINISHES[id].name;
    b.addEventListener('click', () => {
      state.surface = id === presetOf(state.preset).surface ? null : id;
      save();
      apply(false);
    });
    finishEl.appendChild(b);
  }
  const inputs = Array.from(root.querySelectorAll('input[type=color]'));

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = p.name;
    b.dataset.id = p.id;
    // A tiny clock face: body colour, two hands, a ring of the light colour.
    b.innerHTML = `<span class="face" style="background:${p.body};box-shadow:0 0 0 2px ${p.wall}, 0 0 0 3px ${p.light}">
      <i style="background:${HAND_FINISHES[p.handSurface].color || p.hands}"></i><i style="background:${HAND_FINISHES[p.handSurface].color || p.hands}"></i></span>`;
    b.addEventListener('click', () => {
      state = Object.assign(blank(), { preset: p.id, sunlight: state.sunlight, lens: state.lens, ao: state.ao, film: state.film, leaves: state.leaves });
      save();
      apply(false);
    });
    presetsEl.appendChild(b);
  }

  for (const inp of inputs) {
    inp.addEventListener('input', () => {
      state[inp.dataset.k] = inp.value;
      save();
      apply(false);
    });
  }

  // Effect switches (kept across presets).
  const switches = Array.from(root.querySelectorAll('input[data-opt]'));
  for (const sw of switches) {
    sw.addEventListener('change', () => {
      state[sw.dataset.opt] = sw.checked;
      save();
      apply(false);
    });
  }

  resetEl.addEventListener('click', () => {
    for (const k of CUSTOM_KEYS) state[k] = null;
    save();
    apply(false);
  });

  function setOpen(open) {
    root.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', e => { e.stopPropagation(); setOpen(!root.classList.contains('open')); });
  document.addEventListener('pointerdown', e => { if (!root.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') setOpen(false);
    // Number keys 1-5 switch preset directly.
    const i = parseInt(e.key, 10) - 1;
    if (i >= 0 && i < PRESETS.length && e.target.tagName !== 'INPUT') presetsEl.children[i].click();
  });

  function render() {
    const p = current(), base = presetOf(state.preset);
    for (const b of presetsEl.children) b.classList.toggle('active', b.dataset.id === state.preset);
    nameEl.textContent = base.name + (isCustom() ? ' · custom' : '');
    noteEl.textContent = base.note;
    for (const inp of inputs) inp.value = p[inp.dataset.k];
    for (const b of finishEl.children) {
      const on = b.dataset.id === p.surface;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    for (const b of handsEl.children) {
      const on = b.dataset.id === p.handSurface, f = HAND_FINISHES[b.dataset.id];
      const c = f.color || (on ? p.hands : base.hands);
      // Metals get a highlight band; the matte chip stays flat.
      b.style.background = f.handMetal
        ? `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9), rgba(255,255,255,0) 42%),
           linear-gradient(140deg, ${c} 35%, rgba(0,0,0,0.45) 100%), ${c}`
        : c;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', String(on));
    }
    handNameEl.textContent = '· ' + HAND_FINISHES[p.handSurface].name;
    for (const sw of switches) sw.checked = sw.dataset.opt === 'sunlight' ? state.sunlight === true : state[sw.dataset.opt] !== false;
    resetEl.hidden = !isCustom();
    toggle.querySelector('.dot').style.background =
      `conic-gradient(${p.hands} 0 25%, ${p.body} 25% 75%, ${p.light} 75%)`;
  }

  apply(true);
})();
