'use strict';
// Déjà Vu: a saloon memory game. The cards are dealt face up, shown for a few
// seconds, then turned face down; the player turns them two at a time and
// must find every pair before running out of chances.

(function () {
  // Tables: grid size, mistakes allowed and how long the cards are shown first.
  const LEVELS = [
    { id: 'Easy', cols: 4, rows: 4, chances: 3, show: 5 },
    { id: 'Medium', cols: 5, rows: 4, chances: 5, show: 7 },
    { id: 'Hard', cols: 6, rows: 5, chances: 7, show: 10 },
    { id: 'Pro', cols: 6, rows: 6, chances: 9, show: 13 }
  ];

  const FLIP_MS = 520;          // flip transition (keep in sync with style.css)
  const MISS_MS = 950;          // how long a wrong pair stays face up

  const $ = id => document.getElementById(id);
  const tableEl = $('table'), gridEl = $('grid'), msgEl = $('message');
  const memoEl = $('memo'), memoText = $('memoText'), memoBar = $('memoBar');
  const dealBtn = $('deal'), levelsEl = $('levels');
  const pairsEl = $('pairs'), chancesEl = $('chances'), scoreEl = $('score'), timeEl = $('time'), bestEl = $('best');
  const overEl = $('over'), overLevelsEl = $('overLevels'), quitBtn = $('quit'), confirmEl = $('confirm');

  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtTime = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  const state = {
    level: Math.max(0, LEVELS.findIndex(l => l.id === load('day25.level', 'Easy'))),
    phase: 'idle',              // idle | dealing | memo | play | over
    cards: [],
    open: [],                   // face-up cards of the current turn (0, 1 or 2)
    lock: false,
    found: 0, mistakes: 0, streak: 0, bestStreak: 0, score: 0,
    t0: 0, elapsed: 0,
    focus: 0,
    game: 0,                    // bumps on every new deal, to cancel stale async steps
    paused: false, pausedAt: 0  // the page is in the background (see setPaused)
  };

  const best = load('day25.best', {});           // best score per table
  const records = load('day25.records', []);     // top 5 games: { level, score, date }
  const stats = load('day25.stats', { wins: 0, games: 0 });

  const L = () => LEVELS[state.level];
  const pairs = () => L().cols * L().rows / 2;

  // ---------- HUD ----------

  function flash(el, up) {
    el.classList.remove('up', 'down');
    void el.offsetWidth;
    el.classList.add(up ? 'up' : 'down');
  }

  function hud() {
    pairsEl.textContent = state.found + '/' + pairs();
    scoreEl.textContent = state.score;
    timeEl.textContent = fmtTime(state.elapsed);
    bestEl.textContent = best[L().id] ? best[L().id] : '—';
    // Chances left, as bullets in a revolver cylinder; spent ones are empty.
    const left = L().chances - state.mistakes;
    let html = '';
    for (let i = 0; i < L().chances; i++) html += '<i class="' + (i < left ? 'live' : 'spent') + '"></i>';
    chancesEl.innerHTML = html;
    chancesEl.title = Math.max(0, left) + ' mistake' + (left === 1 ? '' : 's') + ' left';
    chancesEl.classList.toggle('last', left === 0 && state.phase === 'play');
  }

  function message(text, kind) {
    msgEl.textContent = text;
    msgEl.className = 'message' + (kind ? ' ' + kind : '');
  }

  // ---------- Levels ----------

  // Table buttons beside the felt, and a copy in the end-of-game panel
  // (there a click deals straight away on that table).
  function buildLevels() {
    levelsEl.innerHTML = '';
    overLevelsEl.innerHTML = '';
    LEVELS.forEach((l, i) => {
      for (const parent of [levelsEl, overLevelsEl]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = l.id + '<small>' + l.cols + '×' + l.rows + '</small>';
        b.title = l.cols * l.rows / 2 + ' pairs · ' + l.chances + ' mistakes allowed · cards shown for ' + l.show + ' s';
        if (parent === levelsEl) b.addEventListener('click', () => setLevel(i, true));
        else b.addEventListener('click', () => { overEl.hidden = true; setLevel(i, false); deal(); });
        parent.appendChild(b);
      }
    });
  }

  // Picking a table in the middle of a game first asks to leave it.
  function setLevel(i, talk) {
    if (inGame()) {
      if (i !== state.level) askQuit(() => setLevel(i, talk));
      return;
    }
    const changed = i !== state.level;
    state.level = i;
    save('day25.level', L().id);
    [...levelsEl.children].forEach((b, k) => b.classList.toggle('on', k === i));
    [...overLevelsEl.children].forEach((b, k) => b.classList.toggle('on', k === i));
    if (changed) {
      SOUND.chip();
      if (talk) DEALER.say('level', 0.6);
      layoutPreview();
    }
    hud();
  }

  // ---------- Card sizing ----------

  // Cards are as big as possible while the whole grid fits on the felt.
  function measure() {
    const W = tableEl.clientWidth, H = tableEl.clientHeight;
    const { cols, rows } = L();
    const padX = Math.max(14, W * 0.04), padBot = Math.max(54, H * 0.11);
    const GAP = 0.13, RATIO = 1.38;
    const size = padTop => {
      const byW = (W - 2 * padX) / (cols + GAP * (cols - 1));
      const byH = (H - padTop - padBot) / (rows * RATIO + GAP * (rows - 1));
      return Math.max(24, Math.floor(Math.min(byW, byH, 150)));
    };
    const gridW = cw => cols * cw + (cols - 1) * cw * GAP;
    let padTop = Math.max(14, H * 0.05);
    let cw = size(padTop);

    // The dealer (portrait and speech bubble, top left) must never cover the cards.
    // With enough felt left of the grid, the bubble goes under the portrait in
    // that free column; otherwise the grid starts below a strip kept for both.
    const dealer = tableEl.querySelector('.dealer');
    if (dealer) {
      const portrait = dealer.querySelector('.portrait');
      const left = dealer.offsetLeft, pw = portrait.offsetWidth, ph = portrait.offsetHeight;
      const free = (W - gridW(cw)) / 2 - left - 14;
      const stack = free >= 150;
      dealer.classList.toggle('stack', stack);
      if (stack) dealer.style.setProperty('--bw', Math.min(300, free) + 'px');
      else {
        dealer.style.setProperty('--bw', Math.min(420, W - left * 2 - pw - 16) + 'px');
        padTop = Math.max(padTop, dealer.offsetTop + Math.max(ph, 64) + 10);
        cw = size(padTop);
      }
    }
    gridEl.style.setProperty('--cw', cw + 'px');
    gridEl.style.setProperty('--ch', Math.round(cw * RATIO) + 'px');
    gridEl.style.setProperty('--gap', Math.round(cw * GAP) + 'px');
    gridEl.style.setProperty('--cols', cols);
    gridEl.style.top = padTop + (H - padTop - padBot - (rows * cw * RATIO + (rows - 1) * cw * GAP)) / 2 + 'px';
  }

  // ---------- Cards ----------

  const BACK = '<div class="face back">' + CARDBACK.SVG + '</div>';

  function makeCard(sym, i) {
    const el = document.createElement('div');
    el.className = 'card down';
    el.setAttribute('role', 'gridcell');
    el.tabIndex = -1;
    el.innerHTML = '<div class="inner">' +
      '<div class="face front"><span class="art">' + SYMBOLS.svg(sym) + '</span>' +
      '<span class="corner tl">' + SYMBOLS.svg(sym) + '</span><span class="corner br">' + SYMBOLS.svg(sym) + '</span></div>' +
      BACK + '</div>';
    const card = { el, sym, i, up: false, matched: false };
    el.addEventListener('click', () => turn(card));
    el.addEventListener('focus', () => { state.focus = i; });
    label(card);
    return card;
  }

  function label(card) {
    const c = L().cols;
    const pos = 'row ' + (Math.floor(card.i / c) + 1) + ', column ' + (card.i % c + 1);
    card.el.setAttribute('aria-label', card.up || card.matched ? SYMBOLS.name(card.sym) + ', ' + pos : 'Face-down card, ' + pos);
  }

  // Turn a card face up or down, with a little hop while it spins.
  function flip(card, up, quiet) {
    card.up = up;
    card.el.classList.toggle('down', !up);
    card.el.classList.remove('flipping');
    void card.el.offsetWidth;
    card.el.classList.add('flipping');
    if (!quiet) SOUND.flip();
    label(card);
  }

  // Before the first deal: a grid of face-down cards on the felt.
  function layoutPreview() {
    state.cards = [];
    gridEl.innerHTML = '';
    measure();
    for (let i = 0; i < L().cols * L().rows; i++) {
      const c = makeCard(SYMBOLS.LIST[0].id, i);
      c.el.classList.add('idle');
      gridEl.appendChild(c.el);
      state.cards.push(c);
    }
  }

  // Flip a set of cards in a diagonal wave from the top-left corner.
  async function wave(cards, up, step, game) {
    const c = L().cols;
    let maxD = 0;
    for (const card of cards) {
      const d = Math.floor(card.i / c) + card.i % c;
      maxD = Math.max(maxD, d);
      setTimeout(() => { if (game === state.game) flip(card, up, d % 2 === 1); }, d * step);
    }
    await sleep(maxD * step + FLIP_MS);
  }

  // ---------- Flow ----------

  let tickTimer = 0, waitTimer = 0;

  function stopTimers() {
    clearInterval(tickTimer);
    clearTimeout(waitTimer);
  }

  function armWait() {
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => { if (state.phase === 'play') { DEALER.say('wait'); armWait(); } }, 12000 + Math.random() * 6000);
  }

  async function deal() {
    SOUND.init();
    MUSIC.unlock();
    SOUND.stopCheers();
    stopTimers();
    overEl.hidden = true;
    confirmEl.hidden = true;
    const game = ++state.game;
    Object.assign(state, { phase: 'dealing', open: [], lock: true, found: 0, mistakes: 0, streak: 0, bestStreak: 0, score: 0, elapsed: 0, focus: 0, tries: 0 });
    tableEl.classList.remove('playing', 'won', 'lost');
    memoEl.hidden = true;
    updateButtons();
    hud();

    // A fresh shuffled deck: the first n/2 symbols, twice each.
    const syms = shuffle(SYMBOLS.LIST.slice()).slice(0, pairs()).map(s => s.id);
    const deck = shuffle(syms.concat(syms));

    measure();
    gridEl.innerHTML = '';
    state.cards = deck.map((s, i) => makeCard(s, i));

    // Cards start stacked at the dealer's spot (top centre) and fly to their places.
    const gr = gridEl.getBoundingClientRect(), tr = tableEl.getBoundingClientRect();
    const cw = parseFloat(gridEl.style.getPropertyValue('--cw'));
    state.cards.forEach((c, k) => {
      gridEl.appendChild(c.el);
      const r = c.el.getBoundingClientRect();
      c.el.style.setProperty('--dx', (tr.left + tr.width / 2 - (r.left + r.width / 2)) + 'px');
      c.el.style.setProperty('--dy', (tr.top - cw * 1.2 - (r.top + r.height / 2)) + 'px');
      c.el.style.setProperty('--dr', (Math.random() * 40 - 20).toFixed(1) + 'deg');
      c.el.classList.add('deck');
    });
    void gridEl.offsetWidth;

    message('Dealing…');
    DEALER.say('deal', 0.8);
    const step = Math.max(28, 900 / state.cards.length);
    state.cards.forEach((c, k) => setTimeout(() => {
      if (game !== state.game) return;
      c.el.classList.remove('deck');
      if (k % 2 === 0) SOUND.whoosh(260, 0.6);
    }, k * step));
    await sleep(state.cards.length * step + 450);
    if (game !== state.game) return;
    SOUND.tap();

    // Show them all.
    await wave(state.cards, true, 55, game);
    if (game !== state.game) return;
    await memorize(game);
    if (game !== state.game) return;

    // Hide them and start playing.
    DEALER.say('hide', 0.7);
    await wave(state.cards, false, 45, game);
    if (game !== state.game) return;
    state.phase = 'play';
    state.lock = false;
    state.t0 = performance.now();
    tableEl.classList.add('playing');
    message('Find the pairs!');
    updateButtons();
    hud();
    state.cards[0].el.tabIndex = 0;
    tickTimer = setInterval(() => {
      if (state.paused) return;
      state.elapsed = (performance.now() - state.t0) / 1000;
      timeEl.textContent = fmtTime(state.elapsed);
    }, 250);
    armWait();
  }

  // The memorizing countdown: a shrinking bar and a tick each second.
  async function memorize(game) {
    state.phase = 'memo';
    const total = L().show;
    memoEl.hidden = false;
    message('');
    // The bar is a CSS animation, so it can be paused with the game.
    memoBar.style.animation = 'none';
    void memoBar.offsetWidth;
    memoBar.style.animation = 'memoBar ' + total + 's linear forwards';
    memoBar.style.animationPlayState = state.paused ? 'paused' : 'running';
    for (let s = total; s > 0; s--) {
      if (game !== state.game) return;
      memoText.textContent = 'Memorize! ' + s;
      memoEl.classList.toggle('urgent', s <= 3);
      SOUND.tock(s <= 3);
      // One second of unpaused time.
      for (let t = 0; t < 1000;) {
        await sleep(100);
        if (game !== state.game) return;
        if (!state.paused) t += 100;
      }
    }
    memoEl.hidden = true;
  }

  // The player turns a card.
  function turn(card) {
    if (state.phase !== 'play' || state.lock || card.up || card.matched) return;
    SOUND.init();
    armWait();
    flip(card, true);
    state.open.push(card);
    if (state.open.length < 2) return;

    state.lock = true;
    state.tries++;
    const [a, b] = state.open;
    state.open = [];
    const game = state.game;
    if (a.sym === b.sym) setTimeout(() => game === state.game && match(a, b), FLIP_MS * 0.75);
    else setTimeout(() => game === state.game && miss(a, b), FLIP_MS);
  }

  function match(a, b) {
    a.matched = b.matched = true;
    state.found++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    const gain = 100 + 50 * (state.streak - 1);
    state.score += gain;
    for (const c of [a, b]) {
      c.el.classList.add('matched');
      c.el.tabIndex = -1;
      label(c);
      burst(c.el);
    }
    floatText(a.el, b.el, '+' + gain + (state.streak > 1 ? '  ×' + state.streak : ''));
    SOUND.match(state.streak - 1);
    flash(scoreEl, true);
    if (state.streak >= 3) { DEALER.say('streak', 0.7); SCENE.react('cheer', 1, true); }
    else DEALER.say('match', 0.35);
    message(SYMBOLS.name(a.sym) + '! ' + (state.streak > 1 ? state.streak + ' in a row.' : 'A pair.'), 'good');
    if (state.tries === 1) MEDALS.award('lucky');
    if (state.streak >= 5) MEDALS.award('streak5');
    if (state.streak >= 10) MEDALS.award('streak10');
    hud();
    state.lock = false;
    if (state.found === pairs()) win();
  }

  function miss(a, b) {
    state.mistakes++;
    state.streak = 0;
    const left = L().chances - state.mistakes;
    for (const c of [a, b]) c.el.classList.add('wrong');
    SOUND.lose();
    tableEl.classList.remove('shake');
    void tableEl.offsetWidth;
    tableEl.classList.add('shake');
    hud();
    flash(chancesEl, false);
    if (left < 0) { lose(a, b); return; }
    if (left === 0) { DEALER.say('last'); message('No more mistakes allowed!', 'bad'); }
    else {
      DEALER.say('miss', 0.5);
      if (Math.random() < 0.35) SCENE.react('laugh', 1, true);
      message('No match. ' + left + ' mistake' + (left === 1 ? '' : 's') + ' left.', 'bad');
    }
    const game = state.game;
    setTimeout(() => {
      if (game !== state.game) return;
      for (const c of [a, b]) { c.el.classList.remove('wrong'); flip(c, false, c === b); }
      state.lock = false;
    }, MISS_MS);
  }

  // ---------- End of the game ----------

  function finish() {
    state.phase = 'over';
    state.lock = true;
    stopTimers();
    state.elapsed = (performance.now() - state.t0) / 1000;
    tableEl.classList.remove('playing');
    updateButtons();
  }

  function addRecord(score) {
    records.push({ level: L().id, score, date: new Date().toISOString().slice(0, 10) });
    records.sort((x, y) => y.score - x.score);
    records.length = Math.min(records.length, 5);
    save('day25.records', records);
    return records.findIndex(r => r.score === score && r.level === L().id) + 1;
  }

  // Medals for a cleared table.
  function winMedals(left) {
    const id = L().id;
    MEDALS.award('first');
    if (state.mistakes === 0) MEDALS.award('perfect');
    if (left === 0) MEDALS.award('whisker');
    if (id === 'Easy' && state.elapsed < 20) MEDALS.award('quick');
    if (id === 'Medium') MEDALS.award('medium');
    if (id === 'Hard') MEDALS.award('hard');
    if (id === 'Pro') MEDALS.award('pro');
    if (id === 'Pro' && state.mistakes === 0) MEDALS.award('ghost');
    if (state.score >= 5000) MEDALS.award('score');
    gamesMedal();
  }

  function gamesMedal() {
    if (stats.games >= 10) MEDALS.award('regular');
  }

  async function win() {
    finish();
    const game = state.game;
    const left = L().chances - state.mistakes;
    const chanceBonus = left * 150;
    const timeBonus = Math.max(0, Math.round((pairs() * 6 - state.elapsed) * 10));
    const perfect = state.mistakes === 0 ? 500 : 0;
    state.score += chanceBonus + timeBonus + perfect;
    stats.wins++;
    stats.games++;
    save('day25.stats', stats);
    hud();
    flash(scoreEl, true);

    tableEl.classList.add('won');
    message(perfect ? 'A perfect game!' : 'Table cleared!', 'good');
    DEALER.say(perfect ? 'perfect' : 'win');
    DEALER.tip();
    SCENE.react('cheer', 2);
    coinRain(Math.min(80, 30 + pairs() * 3));
    // The matched cards jump in a wave.
    const c = L().cols;
    state.cards.forEach(card => setTimeout(() => {
      card.el.classList.remove('hooray');
      void card.el.offsetWidth;
      card.el.classList.add('hooray');
    }, (Math.floor(card.i / c) + card.i % c) * 70));

    await sleep(2600);
    if (game !== state.game) return;

    // A perfect game (on any table) is too good to be honest: the sheriff
    // comes in for a duel. Win it for a bounty, lose it (or give up) for a fine.
    let duelLine = '';
    if (perfect) {
      DEALER.say('sheriff');
      await sleep(1800);
      if (game !== state.game) return;
      const bounty = Math.max(250, Math.round(state.score * 0.25));
      const fine = Math.max(100, Math.round(state.score * 0.1));
      const r = await new Promise(res => DUEL.duel({ bounty, fine }, res));
      if (game !== state.game) return;
      if (r.won) {
        state.score += bounty;
        duelLine = '<br>Sheriff’s bounty: +' + bounty + ' (drew in ' + r.ms + ' ms)';
        MEDALS.award('duel');
        if (r.ms < 250) MEDALS.award('lightning');
        coinRain(25);
        DEALER.say('duelWin');
      } else {
        state.score = Math.max(0, state.score - fine);
        duelLine = '<br>Sheriff’s fine: −' + fine + (r.surrendered ? ' (surrendered)' : '');
        DEALER.say('duelLose');
      }
      hud();
      flash(scoreEl, r.won);
      await sleep(900);
      if (game !== state.game) return;
    }

    const isBest = !best[L().id] || state.score > best[L().id];
    if (isBest) { best[L().id] = state.score; save('day25.best', best); }
    const rank = addRecord(state.score);
    winMedals(left);
    hud();
    SCENE.refreshPosters();
    showOver(perfect ? 'Perfect!' : 'Table cleared!',
      'Pairs: ' + pairs() + ' · Mistakes: ' + state.mistakes + '/' + L().chances + ' · Time: ' + fmtTime(state.elapsed) +
      '<br>Best streak: ' + state.bestStreak +
      '<br>Chances bonus: +' + chanceBonus + ' · Time bonus: +' + timeBonus + (perfect ? ' · Perfect: +500' : '') +
      duelLine +
      '<br><b class="big">' + state.score + '</b> points',
      isBest ? 'New best on the ' + L().id + ' table!' : (rank ? 'Hall of fame: #' + rank : ''));
  }


  async function lose(a, b) {
    finish();
    const game = state.game;
    stats.games++;
    save('day25.stats', stats);
    gamesMedal();
    tableEl.classList.add('lost');
    message('Out of chances!', 'bad');
    DEALER.say('lose');
    SCENE.react('boo', 2);
    SOUND.gameOver();
    SCENE.refreshPosters();
    await sleep(900);
    if (game !== state.game) return;
    // Show where everything was.
    const hidden = state.cards.filter(card => !card.up && !card.matched);
    hidden.forEach(card => card.el.classList.add('missed'));
    await wave(hidden, true, 50, game);
    if (game !== state.game) return;
    await sleep(1400);
    if (game !== state.game) return;
    showOver('Out of chances!',
      'Pairs found: ' + state.found + '/' + pairs() + ' · Time: ' + fmtTime(state.elapsed) +
      '<br>Best streak: ' + state.bestStreak + ' · Score: ' + state.score,
      'The house always remembers.');
  }

  function showOver(title, text, rank) {
    $('overTitle').textContent = title;
    $('overText').innerHTML = text;
    $('overRank').textContent = rank || '';
    overEl.hidden = false;
    $('again').focus();
  }

  // ---------- Effects ----------

  // Gold sparkles bursting out of a matched card.
  function burst(el) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = 40 + Math.random() * 40;
      s.style.setProperty('--tx', (Math.cos(a) * d).toFixed(1) + 'px');
      s.style.setProperty('--ty', (Math.sin(a) * d).toFixed(1) + 'px');
      el.appendChild(s);
      setTimeout(() => s.remove(), 800);
    }
  }

  // "+150" rising from between the two cards of a pair.
  function floatText(a, b, text) {
    const tr = tableEl.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'float';
    f.textContent = text;
    f.style.left = ((ra.left + rb.left + ra.width) / 2 - tr.left) + 'px';
    f.style.top = ((ra.top + rb.top) / 2 - tr.top) + 'px';
    tableEl.appendChild(f);
    setTimeout(() => f.remove(), 1300);
  }

  // A shower of gold coins when the table is cleared.
  function coinRain(n) {
    const W = tableEl.clientWidth;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'coinfall';
      c.style.left = (Math.random() * W) + 'px';
      c.style.setProperty('--d', (Math.random() * 1.4).toFixed(2) + 's');
      c.style.setProperty('--t', (1.2 + Math.random() * 1).toFixed(2) + 's');
      c.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      tableEl.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
    SOUND.coins(Math.min(40, n));
  }

  // ---------- Controls ----------

  const inGame = () => state.phase === 'dealing' || state.phase === 'memo' || state.phase === 'play';

  function updateButtons() {
    dealBtn.textContent = inGame() ? 'Redeal' : 'Deal';
    quitBtn.hidden = !inGame();
  }

  // Leaving a game once play has started counts as a game played (and lost).
  function countAbandoned() {
    if (state.phase !== 'play') return;
    stats.games++;
    save('day25.stats', stats);
    if (state.found > 0) MEDALS.award('quitter');
    gamesMedal();
    SCENE.refreshPosters();
  }

  // Abort the current game: back to a face-down preview of the chosen table.
  function quit() {
    countAbandoned();
    state.game++;                 // cancels every pending step of the old game
    stopTimers();
    SOUND.stopCheers();
    memoEl.hidden = true;
    overEl.hidden = true;
    confirmEl.hidden = true;
    tableEl.classList.remove('playing', 'won', 'lost');
    Object.assign(state, { phase: 'idle', open: [], lock: true, found: 0, mistakes: 0, streak: 0, bestStreak: 0, score: 0, elapsed: 0, focus: 0, tries: 0 });
    layoutPreview();
    message('Pick a table and deal the cards.');
    DEALER.say('quit', 0.8);
    updateButtons();
    hud();
    levelsEl.querySelector('.on').focus();
  }

  // Ask before throwing away a game in progress; then run `then` (or just quit).
  // Before the cards are turned down nothing is at stake, so no question.
  let afterQuit = null;
  function askQuit(then) {
    if (state.phase !== 'play') { quit(); if (then) then(); return; }
    afterQuit = then || null;
    confirmEl.hidden = false;
    $('confirmNo').focus();
  }

  function closeConfirm() {
    confirmEl.hidden = true;
    afterQuit = null;
  }

  $('confirmYes').addEventListener('click', () => { const then = afterQuit; quit(); if (then) then(); });
  $('confirmNo').addEventListener('click', closeConfirm);
  confirmEl.addEventListener('click', e => { if (e.target === confirmEl) closeConfirm(); });

  // Redealing in the middle of a game counts as a lost game.
  function onDeal() {
    countAbandoned();
    deal();
  }

  dealBtn.addEventListener('click', onDeal);
  quitBtn.addEventListener('click', () => askQuit());
  $('again').addEventListener('click', () => { overEl.hidden = true; deal(); });
  $('back').addEventListener('click', () => { overEl.hidden = true; levelsEl.querySelector('.on').focus(); });
  overEl.addEventListener('click', e => { if (e.target === overEl) { overEl.hidden = true; } });

  const muteBtn = $('mute'), musicBtn = $('music'), medalsBtn = $('medalsBtn'), medalsEl = $('medals');
  // Each toggle has an icon (alone on narrow phones, crossed out when off) and a label.
  const ICON_MUSIC = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<circle cx="6.5" cy="18" r="2.6" fill="currentColor"/><circle cx="17.5" cy="16" r="2.6" fill="currentColor"/><path class="x" d="M3 3 L21 21" stroke="currentColor" stroke-width="2.2"/></svg>';
  const ICON_SOUND = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>' +
    '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path class="x" d="M3 3 L21 21" stroke="currentColor" stroke-width="2.2"/></svg>';
  const ICON_MEDAL = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h4l2 6H9zM13 2h4l-2 6h-4z" fill="currentColor" opacity=".7"/>' +
    '<circle cx="12" cy="15" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11.5l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" fill="currentColor"/></svg>';
  const syncToggles = () => {
    const on = { music: MUSIC.enabled, sound: !SOUND.muted };
    muteBtn.innerHTML = ICON_SOUND + '<span class="txt">Sound ' + (on.sound ? 'on' : 'off') + '</span>';
    musicBtn.innerHTML = ICON_MUSIC + '<span class="txt">Music ' + (on.music ? 'on' : 'off') + '</span>';
    medalsBtn.innerHTML = ICON_MEDAL + '<span class="txt">Medals ' + MEDALS.count + '/' + MEDALS.list.length + '</span>';
    muteBtn.classList.toggle('off', !on.sound);
    musicBtn.classList.toggle('off', !on.music);
    muteBtn.setAttribute('aria-pressed', on.sound);
    musicBtn.setAttribute('aria-pressed', on.music);
  };
  // ---------- Medals panel ----------

  function openMedals() {
    MEDALS.render($('medalsList'));
    SEASON.render($('seasons'));
    $('medalsCount').textContent = MEDALS.count + ' of ' + MEDALS.list.length + ' earned';
    medalsEl.hidden = false;
    $('medalsClose').focus({ preventScroll: true });
    medalsEl.scrollTop = 0;
  }

  function closeMedals() { medalsEl.hidden = true; }

  medalsBtn.addEventListener('click', openMedals);
  $('medalsClose').addEventListener('click', closeMedals);
  medalsEl.addEventListener('click', e => { if (e.target === medalsEl) closeMedals(); });
  MEDALS.onAward(() => { syncToggles(); SCENE.refreshPosters(); if (!medalsEl.hidden) openMedals(); });

  // Petting the cat (on the bar or on the felt): three pats earn a medal.
  SCENE.hooks.cat = () => {
    const n = MEDALS.bump('cat', 3);
    if (n <= 3) DEALER.say(n < 3 ? 'That cat likes you.' : "Well, I'll be. He never lets ME do that.");
  };

  muteBtn.addEventListener('click', () => { SOUND.init(); SOUND.toggleMute(); syncToggles(); });
  musicBtn.addEventListener('click', () => { MUSIC.toggle(); syncToggles(); });

  // Move the keyboard focus around the grid.
  function moveFocus(dx, dy) {
    const { cols, rows } = L();
    let x = state.focus % cols, y = Math.floor(state.focus / cols);
    x = (x + dx + cols) % cols;
    y = (y + dy + rows) % rows;
    const prev = state.cards[state.focus];
    if (prev) prev.el.tabIndex = -1;
    state.focus = y * cols + x;
    const c = state.cards[state.focus];
    c.el.tabIndex = 0;
    c.el.focus();
  }

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // During the duel Space and Enter draw the gun, and nothing else works.
    if (DUEL.active) {
      if (k === ' ' || k === 'Enter') { e.preventDefault(); DUEL.duelPress(); }
      return;
    }
    SOUND.init();
    MUSIC.unlock();
    if (k === 'Escape') {
      if (!medalsEl.hidden) closeMedals();
      else if (!confirmEl.hidden) closeConfirm();
      else if (!overEl.hidden) overEl.hidden = true;
      else if (inGame()) askQuit();
      return;
    }
    if (!confirmEl.hidden || !medalsEl.hidden) return;      // dialogs have their own buttons
    if (k === 'm' || k === 'M') { SOUND.toggleMute(); syncToggles(); return; }
    if (k === 'n' || k === 'N') { MUSIC.toggle(); syncToggles(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k] && state.phase === 'play') { e.preventDefault(); moveFocus(...arrows[k]); return; }
    if (k === ' ' || k === 'Enter') {
      const onCard = document.activeElement && document.activeElement.classList.contains('card');
      if (state.phase === 'play' && onCard) { e.preventDefault(); turn(state.cards[state.focus]); return; }
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      if (state.phase === 'idle' || state.phase === 'over') { e.preventDefault(); overEl.hidden = true; onDeal(); }
    }
  });

  // ---------- Automatic pause ----------
  // When the tab or the app goes to the background the game pauses: the clock
  // and the memorize countdown stop (the time away is not counted) and the
  // music fades out. Everything resumes when the player comes back.

  function setPaused(p) {
    if (p === state.paused) return;
    state.paused = p;
    const now = performance.now();
    if (p) state.pausedAt = now;
    else if (state.phase === 'play') state.t0 += now - state.pausedAt;   // skip the time away
    memoBar.style.animationPlayState = p ? 'paused' : 'running';
    MUSIC.suspend(p);
    if (!p && (state.phase === 'play' || state.phase === 'memo') && now - state.pausedAt > 1500) {
      DEALER.say('back');
      if (state.phase === 'play') armWait();
    }
  }

  document.addEventListener('visibilitychange', () => setPaused(document.hidden));
  window.addEventListener('pagehide', () => setPaused(true));
  window.addEventListener('pageshow', () => setPaused(document.hidden));

  // First gesture anywhere starts the audio (browser autoplay rules).
  document.addEventListener('pointerdown', () => { SOUND.init(); MUSIC.unlock(); }, { once: true });

  window.addEventListener('resize', () => measure());

  // ---------- Init ----------

  SCENE.hooks.records = () => records;
  SCENE.hooks.stats = () => stats;
  SCENE.hooks.medals = () => ({ got: MEDALS.count, total: MEDALS.list.length });
  CARDBACK.install();
  DEALER.init(tableEl);
  FELTCAT.init(tableEl);
  SCENE.init($('mid'));         // the saloon lives in the margins around table and controls
  SEASON.init();
  buildLevels();
  setLevel(state.level);
  layoutPreview();
  syncToggles();
  updateButtons();
  hud();
  setTimeout(() => DEALER.say('hello'), 700);

  // Hooks for tests.
  window.GAME = { state, LEVELS, deal, turn, setLevel, get cards() { return state.cards; } };
})();
