// Tetraphon / Octaphon: game flow, input, HUD and the animation loop.
(() => {
  const STORE = 'oppd2026.day6.';
  const PRESS_TIME = 230;     // ms a pad stays lit when pressed by the player
  const START_DELAY = 1000;   // ms from start to the first sequence
  const JINGLE_STEP = 110;    // ms between the pads of the start run
  const REPLAY_DELAY = 300;   // ms from the Replay press to the first note
  const ROUND_DELAY = 850;    // ms between a correct answer and the next sequence
  const INPUT_DELAY = 150;    // ms between the end of the sequence and the player's turn
  const DECAY = 0.07;         // s, fade of a pad light after it turns off
  const DRAG_SPEED = 0.006;   // radians per pixel when turning the device
  const YAW_MAX = 0.6, PITCH_MIN = 0.45, PITCH_MAX = 1.35, PITCH_DEFAULT = 0.95;
  const KEYS = {             // Tetraphon pads
    ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3,
    Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3
  };
  const OCTA_KEYS = {};       // Octaphon pads: 1–8, clockwise from the top
  for (let i = 0; i < 8; i++) OCTA_KEYS['Digit' + (i + 1)] = OCTA_KEYS['Numpad' + (i + 1)] = i;
  const TAGS = { tetra: 'Four voices. One memory.', octa: 'Eight voices. A whole octave.' };
  const MODES = { classic: 'Forward', reverse: 'Reverse' };
  const VOICES_SHOWN = 1500;  // ms the hub shows the name of a newly chosen voice set
  const LCD_COLOR = '#7fe3ff', LCD_TURN = '#a6e83a', LCD_OVER = '#ff6464'; // lit dots of the hub display

  const canvas = document.getElementById('view');
  const $ = id => document.getElementById(id);
  const ui = {
    start: $('start'), round: $('round'), best: $('best'), tempo: $('tempo'), status: $('status'),
    sound: $('sound'), replay: $('replay'), ach: $('ach-btn'), theme: $('theme'), voices: $('voices'),
    brand: $('brand'), tag: $('tag'), modes: [...document.querySelectorAll('[data-mode]')],
    variants: [...document.querySelectorAll('[data-variant]')]
  };

  const load = (k, d) => { try { return localStorage.getItem(STORE + k) ?? d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(STORE + k, v); } catch (e) { /* private mode */ } };

  const device = Device.create(canvas);
  if (!device) {
    ui.status.textContent = 'This browser cannot show WebGL: Tetraphon needs it.';
    return;
  }
  const VARIANTS = Device.VARIANTS;
  let variant = VARIANTS[load('variant')] ? load('variant') : 'tetra';
  let PADS = VARIANTS[variant].pads;
  const matrix = DotMatrix.create();
  let scene = { top: '', center: '' };

  let mode = MODES[load('mode')] ? load('mode') : 'classic';
  Sound.setVoices(load('voices', 'major'));
  let theme = load('theme') === 'light' ? 'light' : 'dark';
  let state = 'idle';         // idle → wait → show → input → wait … → over (⇄ replay)
  let seq = [], k = 0, gen = 0, inputTimer = 0, score = 0, newBest = false, overText = '';
  let voicesUntil = 0;        // the hub shows the voice set name until then
  const lit = Array.from({ length: 8 }, () => ({ until: 0, light: 0 }));

  // Records per variant and mode: best.classic (Tetraphon), best.octa.classic (Octaphon), …
  const slot = m => (variant === 'octa' ? 'octa.' : '') + m;
  const best = m => Number(load('best.' + slot(m), 0)) || 0;
  const ended = () => state === 'idle' || state === 'over' || state === 'replay';

  // Timer that dies when a new game starts or the game ends
  function later(ms, fn) {
    const g = gen;
    return setTimeout(() => { if (g === gen) fn(); }, ms);
  }

  function flash(p, ms, sound = true) {
    lit[p].until = performance.now() + ms;
    if (sound) Sound.tone(p, ms);
  }

  function start() {
    Sound.unlock();
    gen++;
    clearTimeout(inputTimer);
    seq = [];
    score = 0;
    newBest = false;
    state = 'wait';
    // Start run: the four pads light up clockwise with their notes
    PADS.forEach((_, p) => later(p * JINGLE_STEP, () => flash(p, JINGLE_STEP * 0.8)));
    setStatus('Get ready…');
    later(START_DELAY, nextRound);
    update();
  }

  function stop() {
    gen++;
    clearTimeout(inputTimer);
    state = 'idle';
    seq = [];
    setStatus('Press Start, or tap the centre of the device.');
    update();
  }

  function nextRound() {
    seq.push(Game.nextPad(seq, Math.random, PADS.length));
    state = 'show';
    const step = Game.stepTime(seq.length);
    seq.forEach((p, i) => later(i * step, () => flash(p, step * Game.ON_RATIO)));
    later((seq.length - 1) * step + step * Game.ON_RATIO + INPUT_DELAY, beginInput);
    setStatus(`Watch and listen: ${seq.length} ${seq.length === 1 ? 'note' : 'notes'}.`);
    update();
  }

  function beginInput() {
    state = 'input';
    k = 0;
    armTimeout();
    setStatus(mode === 'reverse' ? 'Your turn: play it backwards, from the last note to the first.' : 'Your turn: play it back.');
    update();
  }

  function armTimeout() {
    clearTimeout(inputTimer);
    inputTimer = later(Game.TIMEOUT, () => { if (state === 'input') fail(null); });
  }

  function press(p) {
    Sound.unlock();
    if (state === 'show' || state === 'wait' || state === 'replay') return;
    if (state !== 'input') { flash(p, PRESS_TIME); return; } // free play when no game is running
    const want = Game.expected(seq, mode, k);
    if (p !== want) { flash(p, PRESS_TIME, false); fail(p); return; }
    flash(p, PRESS_TIME);
    k++;
    if (k < seq.length) { armTimeout(); update(); return; }
    clearTimeout(inputTimer);
    score = seq.length;
    if (score > best(mode)) { save('best.' + slot(mode), score); newBest = true; }
    state = 'wait';
    Achievements.reach(variant, mode, score); // silent toast, the game goes on as usual
    setStatus(`Correct! ${score} ${score === 1 ? 'note' : 'notes'}.`);
    later(ROUND_DELAY, nextRound);
    update();
  }

  // Wrong pad (p) or too slow (null): the right pad blinks three times
  function fail(p) {
    clearTimeout(inputTimer);
    const want = Game.expected(seq, mode, k);
    gen++;
    state = 'over';
    Sound.error();
    for (let i = 0; i < 3; i++) later(550 + i * 380, () => flash(want, 220, false));
    const why = p === null ? 'Too slow!' : 'Wrong pad!';
    const tail = newBest ? ` New best for ${VARIANTS[variant].name} ${MODES[mode]}!` : '';
    const next = Game.nextAchievement(best(mode));
    const goal = next ? ` Next achievement: ${next.title}, ${next.len} notes.` : '';
    overText = `${why} It was ${PADS[want].name}. Score: ${score}.${tail}${goal} Start to play again, Replay to hear the sequence.`;
    setStatus(overText);
    update();
  }

  // After a game over: play the last sequence again as it was shown, just to listen (no score)
  function replay() {
    if (state !== 'over' || !seq.length) return;
    Sound.unlock();
    gen++; // drops the blinking of the right pad
    state = 'replay';
    const step = Game.stepTime(seq.length);
    seq.forEach((p, i) => later(REPLAY_DELAY + i * step, () => flash(p, step * Game.ON_RATIO)));
    later(REPLAY_DELAY + (seq.length - 1) * step + step * Game.ON_RATIO + 200, () => {
      state = 'over';
      setStatus(overText);
      update();
    });
    setStatus(mode === 'reverse'
      ? 'The last sequence as it was shown. In Reverse it had to be played from the last note to the first.'
      : 'The last sequence as it was shown.');
    update();
  }

  function setMode(m) {
    if (!MODES[m] || state === 'show' || state === 'input' || state === 'wait') return;
    mode = m;
    save('mode', m);
    update();
  }

  // Tetraphon (4 pads) or Octaphon (8 pads), outside a game; a game over is cleared
  function setVariant(id) {
    if (!VARIANTS[id] || !ended() || state === 'replay' || id === variant) return;
    variant = id;
    save('variant', id);
    applyVariant();
    stop();
  }

  function applyVariant() {
    PADS = VARIANTS[variant].pads;
    device.setVariant(variant);
    Sound.setPads(PADS.length);
    lit.forEach(l => { l.until = 0; l.light = 0; });
    ui.brand.textContent = VARIANTS[variant].name;
    ui.tag.textContent = TAGS[variant];
    document.title = VARIANTS[variant].name;
  }

  // Sound set of the pads, outside a game: the four pads play it once as a preview
  function setVoices(id) {
    if (!ended() || state === 'replay') return;
    Sound.unlock();
    save('voices', Sound.setVoices(id));
    PADS.forEach((_, p) => later(p * JINGLE_STEP * 2, () => flash(p, JINGLE_STEP * 1.6)));
    voicesUntil = performance.now() + VOICES_SHOWN;
    setTimeout(update, VOICES_SHOWN + 20);
    update();
  }

  // Dark (default) or light page and model
  function setTheme(t) {
    theme = t;
    save('theme', t);
    document.documentElement.dataset.theme = t;
    device.setTheme(t);
    ui.theme.textContent = t === 'light' ? '☾' : '☀';
    ui.theme.title = t === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    ui.theme.setAttribute('aria-label', ui.theme.title);
  }

  function setStatus(text) {
    ui.status.textContent = text;
  }

  // HUD and LCD follow the state
  function update() {
    const playing = state === 'show' || state === 'input' || state === 'wait';
    ui.start.textContent = playing ? 'Restart' : 'Start';
    ui.replay.hidden = state !== 'over' && state !== 'replay';
    ui.replay.disabled = state === 'replay';
    ui.ach.textContent = `Achievements ${Achievements.count(variant)}/${Achievements.total()}`;
    ui.ach.disabled = playing;
    ui.variants.forEach(b => {
      b.classList.toggle('on', b.dataset.variant === variant);
      b.setAttribute('aria-checked', b.dataset.variant === variant);
      b.disabled = !ended() || state === 'replay';
    });
    ui.modes.forEach(b => {
      b.classList.toggle('on', b.dataset.mode === mode);
      b.setAttribute('aria-checked', b.dataset.mode === mode);
      b.disabled = playing;
    });
    ui.voices.value = Sound.voices;
    ui.voices.disabled = !ended() || state === 'replay';
    ui.round.textContent = seq.length ? String(seq.length) : '–';
    ui.best.textContent = String(best(mode));
    const step = Game.stepTime(Math.max(1, seq.length));
    ui.tempo.textContent = (1000 / step).toFixed(1) + '/s';
    ui.sound.textContent = Sound.enabled ? 'Sound on' : 'Sound off';
    // Dot-matrix hub: static label on top, round (or score) in the middle, mode below
    const two = n => String(n).padStart(2, '0');
    const sc = { color: LCD_COLOR, progress: null, center: two(seq.length), bottom: MODES[mode] };
    if (state === 'idle') Object.assign(sc, { top: VARIANTS[variant].name, center: 'GO' });
    else if (state === 'replay') Object.assign(sc, { top: 'REPLAY' });
    else if (state === 'over') Object.assign(sc, { top: 'GAME OVER', center: two(score), bottom: 'BEST ' + best(mode), color: LCD_OVER });
    else if (state === 'input') {
      Object.assign(sc, { top: mode === 'reverse' ? 'BACKWARDS' : 'YOUR TURN', progress: k / seq.length, color: LCD_TURN });
    } else if (state === 'show') Object.assign(sc, { top: 'WATCH' });
    else if (seq.length) Object.assign(sc, { top: 'CORRECT' });
    else Object.assign(sc, { top: 'GET READY', center: '--' });
    if (performance.now() < voicesUntil && ended()) sc.bottom = Sound.sets.find(v => v.id === Sound.voices).lcd;
    scene = sc;
  }

  // Input: pads, hub and turning the device by dragging around it
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    const hit = device.pick(e.offsetX, e.offsetY);
    if (typeof hit === 'number') { press(hit); return; }
    if (hit === 'hub') {
      if (ended()) start();
      return;
    }
    drag = { x: e.clientX, y: e.clientY, yaw: device.view.yaw, pitch: device.view.pitch };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('turning');
  });
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      device.view.yaw = Math.max(-YAW_MAX, Math.min(YAW_MAX, drag.yaw - (e.clientX - drag.x) * DRAG_SPEED));
      device.view.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, drag.pitch + (e.clientY - drag.y) * DRAG_SPEED));
      return;
    }
    const hit = device.pick(e.offsetX, e.offsetY);
    canvas.style.cursor = typeof hit === 'number' || (hit === 'hub' && ended()) ? 'pointer' : '';
  });
  const endDrag = () => { drag = null; canvas.classList.remove('turning'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', () => { device.view.yaw = 0; device.view.pitch = PITCH_DEFAULT; });

  ui.start.addEventListener('click', () => { start(); ui.start.blur(); });
  ui.modes.forEach(b => b.addEventListener('click', () => { setMode(b.dataset.mode); b.blur(); }));
  ui.variants.forEach(b => b.addEventListener('click', () => { setVariant(b.dataset.variant); b.blur(); }));
  ui.theme.addEventListener('click', () => { setTheme(theme === 'light' ? 'dark' : 'light'); ui.theme.blur(); });
  ui.ach.addEventListener('click', () => { if (ended()) Achievements.open(variant); });
  Sound.sets.forEach(v => ui.voices.add(new Option(v.name, v.id)));
  ui.voices.addEventListener('change', () => { setVoices(ui.voices.value); ui.voices.blur(); });
  ui.replay.addEventListener('click', () => { replay(); ui.replay.blur(); });
  ui.sound.addEventListener('click', () => { Sound.toggle(); update(); ui.sound.blur(); });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || Achievements.isOpen()) return;
    const keys = variant === 'octa' ? OCTA_KEYS : KEYS;
    if (e.code in keys) {
      e.preventDefault();
      if (!e.repeat) press(keys[e.code]);
    } else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (ended() || e.code === 'Enter') start();
    } else if (e.code === 'KeyR') {
      setMode(mode === 'classic' ? 'reverse' : 'classic');
    } else if (e.code === 'KeyL') {
      setTheme(theme === 'light' ? 'dark' : 'light');
    } else if (e.code === 'KeyH') {
      if (ended()) Achievements.open(variant);
    } else if (e.code === 'KeyP') {
      replay();
    } else if (e.code === 'KeyO') {
      setVariant(variant === 'tetra' ? 'octa' : 'tetra');
    } else if (e.code === 'KeyV') {
      const i = Sound.sets.findIndex(v => v.id === Sound.voices);
      setVoices(Sound.sets[(i + 1) % Sound.sets.length].id);
    } else if (e.code === 'KeyM') {
      Sound.toggle();
      update();
    } else if (e.code === 'Escape') {
      stop();
    }
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); // rAF time can precede the first performance.now()
    last = now;
    const lights = lit.map(l => {
      l.light = now < l.until ? 1 : l.light * Math.exp(-dt / DECAY);
      return l.light;
    });
    device.setMatrix(matrix.render(scene, dt), matrix.N, scene.color);
    device.draw(lights);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => device.resize());
  setTheme(theme);
  applyVariant();
  stop();
  requestAnimationFrame(frame);
})();
