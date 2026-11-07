// Page logic: options, turns, the computer player, drawing and erasing marks, score.
'use strict';

(() => {
  const { X, O } = Game;
  const THINK = 380;       // ms the computer waits after the last stroke
  const FIRST_WAIT = 650;  // ...or at the start of a game
  const ERASE_TIME = 450;  // matches the erase animation in style.css
  const STRIKE_WAIT = 120; // pause between the last mark and the winning line
  const RESTART_GUARD = 700; // a click on the board this long after the end starts a new game
  const KEYS = { settings: 'oppd2026.day7.settings', theme: 'oppd2026.day7.theme', score: 'oppd2026.day7.score' };
  const THEMES = ['auto', 'light', 'dark'];
  const LEVEL_HINTS = {
    easy: 'Easy: the computer plays almost at random.',
    medium: 'Medium: it takes its wins and blocks yours, most of the time.',
    hard: 'Hard: minimax, the computer never loses.',
  };

  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const boardEl = $('board'), gridG = $('grid'), hintsG = $('hint-marks'), marksG = $('marks'), cellsEl = $('cells');
  const HINT_WAIT = 150;   // after the computer's stroke, before the hint appears

  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  const opts = Object.assign({ mode: 'classic', opponent: 'cpu', level: 'hard', sound: true, hints: false, earOpen: false, music: true }, load(KEYS.settings, {}));
  let scores = load(KEYS.score, {});
  let themePref = 'auto';
  try { themePref = localStorage.getItem(KEYS.theme) || 'auto'; } catch (e) {}

  let state, starter = X, gen = 0, ended = null, endedAt = 0, seen;
  const markEls = new Array(9).fill(null);
  const center = c => [(c % 3) * 100 + 50, Math.floor(c / 3) * 100 + 50];
  const chalk = () => root.dataset.theme === 'dark';
  const vsCpu = () => opts.opponent === 'cpu';
  const cpuTurn = () => vsCpu() && state.turn === O;
  // The cheat: only in vanish mode against the hard computer.
  const hintsAllowed = () => opts.mode === 'vanish' && vsCpu() && opts.level === 'hard';
  const scoreKey = () => opts.mode + '.' + (vsCpu() ? opts.level : 'friend');

  // Timers belong to one game: a new game (gen++) cancels them.
  function later(fn, ms) {
    const g = gen;
    setTimeout(() => { if (g === gen) fn(); }, ms);
  }

  function sounds(strokes) {
    for (const s of strokes) Sound.stroke(s.delay, s.dur, chalk());
  }

  // ---- Board ------------------------------------------------------------

  const cells = [];
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.addEventListener('click', () => tap(i));
    cellsEl.appendChild(b);
    cells.push(b);
  }

  function erase(el) {
    if (!el) return;
    el.classList.add('erase');
    setTimeout(() => el.remove(), ERASE_TIME);
  }

  function newGame(next) {
    gen++;
    if (next) starter = 3 - starter;  // the first move alternates between games
    let any = false;
    for (const el of marksG.querySelectorAll(':scope > g:not(.erase)')) { erase(el); any = true; }
    if (any) Sound.erase(chalk());
    markEls.fill(null);
    marksG.classList.remove('tied');
    state = Game.create(opts.mode, starter);
    seen = new Map([[Game.key(state), 1]]);
    ended = null;
    update();
    clearHint();
    if (cpuTurn()) later(cpuMove, FIRST_WAIT);
    else later(showHint, HINT_WAIT);
  }

  function place(cell) {
    clearHint();
    const { state: next, removed } = Game.play(state, cell);
    if (removed >= 0) {
      erase(markEls[removed]);
      markEls[removed] = null;
      Sound.erase(chalk());
    }
    const [cx, cy] = center(cell);
    const m = Sketch.mark(marksG, state.turn, cx, cy);
    markEls[cell] = m.el;
    sounds(m.strokes);
    state = next;

    const k = Game.key(state);
    seen.set(k, (seen.get(k) || 0) + 1);
    const w = Game.winner(state.board);
    if (w) finish({ winner: w.player, line: w.line }, m.time);
    else if (Game.full(state)) finish({ draw: 'full' }, m.time);
    else if (seen.get(k) >= Game.REPEATS) finish({ draw: 'repeat' }, m.time);
    else if (cpuTurn()) later(cpuMove, m.time + THINK);
    else later(showHint, m.time + HINT_WAIT);
    update();
  }

  function cpuMove() {
    if (ended || !cpuTurn()) return;
    place(AI.choose(state, opts.level));
  }

  function finish(result, wait) {
    ended = result;
    endedAt = performance.now() + wait;
    const s = scores[scoreKey()] || (scores[scoreKey()] = { x: 0, o: 0, d: 0 });
    if (result.draw) s.d++;
    else if (result.winner === X) s.x++;
    else s.o++;
    save(KEYS.score, scores);
    if (result.line) {
      later(() => {
        for (const c of result.line) markEls[c] && markEls[c].classList.add('won');
        const st = Sketch.strike(marksG, center(result.line[0]), center(result.line[2]));
        sounds(st.strokes);
      }, wait + STRIKE_WAIT);
    } else {
      later(() => marksG.classList.add('tied'), wait + STRIKE_WAIT);
    }
  }

  // ---- Hints (cheat) ----------------------------------------------------

  let advice = null;  // { value, plies, cells, cell } for the current position

  function clearHint() {
    advice = null;
    hintsG.textContent = '';
  }

  function showHint() {
    clearHint();
    if (!opts.hints || !hintsAllowed() || ended || state.turn !== X) { update(); return; }
    if (!Solver.ready) {
      $('hint').textContent = 'Working out the hint…';
      const g = gen;
      setTimeout(() => { Solver.solve(); if (g === gen) showHint(); }, 30);  // ~0.4 s, once
      return;
    }
    const a = Solver.advise(state);
    if (!a || !a.cells.length) { update(); return; }
    advice = Object.assign(a, { cell: a.cells[Math.floor(Math.random() * a.cells.length)] });
    const [cx, cy] = center(advice.cell);
    const m = Sketch.mark(hintsG, X, cx, cy);
    m.el.classList.add('hint');
    update();
  }

  function adviceText() {
    const moves = Math.ceil(advice.plies / 2);
    if (advice.value === Solver.WIN) return `Hint: the highlighted X wins in ${moves} move${moves > 1 ? 's' : ''}.`;
    if (advice.value === Solver.DRAW) return 'Hint: the highlighted X holds the draw.';
    return 'Hint: lost against perfect play; the highlighted X resists longest.';
  }

  function toggleHints() {
    if (!hintsAllowed()) return;
    opts.hints = !opts.hints;
    save(KEYS.settings, opts);
    showHint();
  }

  function tap(cell) {
    Sound.init();
    if (ended) {
      if (performance.now() - endedAt > RESTART_GUARD) newGame(true);
      return;
    }
    if (cpuTurn() || state.board[cell]) return;
    place(cell);
  }

  // ---- Display ----------------------------------------------------------

  const name = p => (p === X ? 'X' : 'O');

  function statusText() {
    if (ended) {
      if (ended.draw) return ended.draw === 'repeat' ? 'Draw: same position three times' : "It's a draw";
      if (vsCpu()) return ended.winner === X ? 'You win!' : 'The computer wins';
      return name(ended.winner) + ' wins!';
    }
    if (vsCpu()) return state.turn === X ? 'Your turn' : 'Thinking…';
    return name(state.turn) + ' to play';
  }

  function hintText() {
    if (ended) return 'Tap the board or press N for a new game.';
    if (advice) return adviceText();
    if (Game.doomed(state) >= 0) {
      return vsCpu() && state.turn === X
        ? 'Your faded mark vanishes when you play.'
        : 'The faded ' + name(state.turn) + ' vanishes with the next move.';
    }
    if (opts.mode === 'vanish') {
      return 'Three marks each: a fourth erases the oldest.';
    }
    return vsCpu() ? LEVEL_HINTS[opts.level] : 'Two players, one board. X and O take turns.';
  }

  function update() {
    const doomed = ended ? -1 : Game.doomed(state);
    markEls.forEach((el, i) => el && el.classList.toggle('doomed', i === doomed));
    boardEl.dataset.turn = name(state.turn).toLowerCase();
    boardEl.classList.toggle('over', !!ended);
    boardEl.classList.toggle('waiting', !ended && cpuTurn());

    cells.forEach((b, i) => {
      const v = state.board[i], r = Math.floor(i / 3) + 1, c = (i % 3) + 1;
      b.setAttribute('aria-label', `Row ${r}, column ${c}: ` + (v ? name(v) : 'empty') + (i === doomed ? ', vanishes next' : ''));
      b.classList.toggle('taken', !!v);
    });

    $('moves').textContent = state.ply;
    $('status').textContent = statusText();
    $('hint').textContent = hintText();

    const s = scores[scoreKey()] || { x: 0, o: 0, d: 0 };
    $('score-x').textContent = s.x;
    $('score-o').textContent = s.o;
    $('score-d').textContent = s.d;
    $('who-x').textContent = vsCpu() ? 'You' : 'Player X';
    $('who-o').textContent = vsCpu() ? 'Computer' : 'Player O';
    $('side-x').classList.toggle('active', !ended && state.turn === X);
    $('side-o').classList.toggle('active', !ended && state.turn === O);

    for (const b of document.querySelectorAll('[data-opt]')) {
      b.setAttribute('aria-pressed', String(opts[b.dataset.opt] === b.dataset.value));
    }
    $('levels').classList.toggle('off', !vsCpu());
    for (const b of $('levels').querySelectorAll('button')) b.disabled = !vsCpu();
    $('hints').hidden = !hintsAllowed();
    $('hint-key').hidden = !hintsAllowed();
    // Icon buttons: crossed out when off.
    for (const [id, on] of [['hints', opts.hints], ['music-btn', opts.music], ['sound', Sound.on]]) {
      $(id).setAttribute('aria-pressed', String(on));
      $(id).classList.toggle('off', !on);
    }
  }

  // ---- Theme ------------------------------------------------------------

  const media = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const dark = themePref === 'auto' ? media.matches : themePref === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    const label = { auto: 'Auto', light: 'Paper', dark: 'Chalk' }[themePref];
    // ︎: text, not emoji
    $('theme').textContent = { auto: '◐', light: '☀︎', dark: '☾︎' }[themePref];
    $('theme').setAttribute('aria-label', 'Theme: ' + label);
  }
  function cycleTheme() {
    themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
    try { localStorage.setItem(KEYS.theme, themePref); } catch (e) {}
    applyTheme();
  }
  media.addEventListener('change', () => { if (themePref === 'auto') applyTheme(); });

  // ---- Paper corner (light theme) -----------------------------------------

  // The corner piece sits at the bottom right of the sheet: its squares are
  // offset by the sheet size minus its own, so they line up when it lies open.
  const sheet = document.querySelector('.sheet'), corner = $('corner');
  function alignCorner() {
    corner.style.setProperty('--ox', (sheet.offsetWidth - corner.offsetWidth) + 'px');
    corner.style.setProperty('--oy', (sheet.offsetHeight - corner.offsetHeight) + 'px');
  }
  new ResizeObserver(alignCorner).observe(sheet);
  corner.classList.toggle('open', !!opts.earOpen);
  corner.addEventListener('click', () => {
    Sound.init();
    opts.earOpen = !opts.earOpen;
    corner.classList.toggle('open', opts.earOpen);
    save(KEYS.settings, opts);
    Sound.erase(false);  // a soft rustle of paper
  });

  // ---- Background music ---------------------------------------------------

  // music/Tabletop Ambience.mp3 in a loop, with fades. Browsers block audio until
  // the first gesture, so it starts on the first click or key if it is enabled.
  const MUSIC_VOLUME = 0.35, MUSIC_FADE = 900;
  const music = $('music');
  let fadeRaf = 0;
  function fadeMusic(target, then) {
    cancelAnimationFrame(fadeRaf);
    const from = music.volume, t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, Math.max(0, (now - t0) / MUSIC_FADE));
      music.volume = from + (target - from) * k;
      if (k < 1) fadeRaf = requestAnimationFrame(step);
      else if (then) then();
    })(t0);
  }
  function startMusic() {
    if (!opts.music) return;
    if (music.paused) {
      music.volume = 0;
      music.play().then(() => { if (opts.music) fadeMusic(MUSIC_VOLUME); }).catch(() => {});
    } else fadeMusic(MUSIC_VOLUME);  // it was fading out
  }
  function toggleMusic() {
    opts.music = !opts.music;
    save(KEYS.settings, opts);
    if (opts.music) startMusic();
    else fadeMusic(0, () => music.pause());
    update();
  }
  window.addEventListener('pointerdown', () => { if (music.paused) startMusic(); });
  window.addEventListener('keydown', e => { if (music.paused && e.key.toLowerCase() !== 'b') startMusic(); });

  // ---- Controls ---------------------------------------------------------

  function setOpt(key, value) {
    if (opts[key] === value) return;
    opts[key] = value;
    save(KEYS.settings, opts);
    newGame(false);
  }

  for (const b of document.querySelectorAll('[data-opt]')) {
    b.addEventListener('click', () => { Sound.init(); setOpt(b.dataset.opt, b.dataset.value); });
  }
  $('new').addEventListener('click', () => { Sound.init(); newGame(true); });
  $('reset').addEventListener('click', () => { delete scores[scoreKey()]; save(KEYS.score, scores); update(); });
  $('theme').addEventListener('click', cycleTheme);
  function toggleSound() {
    Sound.on = !Sound.on;
    opts.sound = Sound.on;
    save(KEYS.settings, opts);
    Sound.init();
    update();
  }
  $('sound').addEventListener('click', toggleSound);
  $('hints').addEventListener('click', toggleHints);
  $('music-btn').addEventListener('click', toggleMusic);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '9') { tap(+k - 1); cells[+k - 1].focus(); }
    else if (k === 'n') { Sound.init(); newGame(true); }
    else if (k === 'l') cycleTheme();
    else if (k === 'm') toggleSound();
    else if (k === 'h') toggleHints();
    else if (k === 'b') toggleMusic();
    else if (k.startsWith('arrow') && document.activeElement.classList.contains('cell')) {
      const i = cells.indexOf(document.activeElement);
      const d = { arrowleft: -1, arrowright: 1, arrowup: -3, arrowdown: 3 }[k];
      const n = i + d;
      if (n >= 0 && n < 9 && (Math.abs(d) === 3 || Math.floor(n / 3) === Math.floor(i / 3))) cells[n].focus();
      e.preventDefault();
    } else return;
  });

  // ---- Start --------------------------------------------------------------

  Sound.on = opts.sound;
  applyTheme();
  sounds(Sketch.grid(gridG).strokes);
  newGame(false);
})();
