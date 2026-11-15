// UI: puzzle setup, grid rendering, keyboard input, solving tools and saved progress.
(function () {
  'use strict';

  const C = window.Crossword;
  // Word list for a language and level ('e' easy, 'h' hard). Only Italian has a hard list: it goes
  // first, so its clues win and its extra words join the base ones. Same composition in worker.js.
  function lines(lang, level) {
    if (lang === 'en') return window.DICT_EN;
    return level === 'h' ? window.DICT_IT_HARD.concat(window.DICT_IT) : window.DICT_IT;
  }
  const LEVEL_NAMES = { e: 'Easy', h: 'Hard' };
  const LABELS = {
    it: { across: 'Orizzontali', down: 'Verticali', name: 'Italiano', portrait: 'Il personaggio nella foto', painting: "L'autore del dipinto" },
    en: { across: 'Across', down: 'Down', name: 'English', portrait: 'The person in the picture', painting: 'The artist of the painting' }
  };

  // Large grids show a portrait in the top-left square; the seed picks it, so a link always
  // reopens the same person. The answer is the person's name, clued as "the person in the picture".
  const PORTRAITS = window.PORTRAITS || [];
  // The candidates start at the one the seed picks and go on in list order: the generator uses the
  // first whose name fits a grid.
  function portraitsFor(opts) {
    if (opts.size !== 'l') return [];
    const n = PORTRAITS.length;
    return PORTRAITS.map((_, k) => PORTRAITS[(opts.seed + k) % n]).slice(0, 8)
      .map(p => ({ id: p.id, word: p[opts.lang], clue: LABELS[opts.lang][p.kind === 'painting' ? 'painting' : 'portrait'] }));
  }
  function portraitData() {
    return P && P.portrait ? PORTRAITS.find(p => p.id === P.portrait.id) || null : null;
  }

  // Picture credits in the info dialog. The name and the file link would give the answer away,
  // so they appear only once the puzzle is solved.
  function renderPicInfo() {
    const box = el('picInfo');
    const p = portraitData();
    box.hidden = !p;
    if (!p) return;
    box.textContent = '';
    const h = document.createElement('h3');
    h.textContent = 'Picture';
    const t = document.createElement('p');
    if (solved) {
      t.append((p.kind === 'painting' ? p.work + ' — ' + p.name : p.name + ' — ' + p.artist) + (p.date ? ', ' + p.date : '') + '. ' + p.license + ', ');
      const a = document.createElement('a');
      a.href = p.source;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Wikimedia Commons';
      t.append(a, '.');
    } else {
      t.textContent = 'Public-domain ' + (p.kind === 'painting' ? 'painting' : 'portrait') + ' from Wikimedia Commons. The ' + (p.kind === 'painting' ? 'title and the artist' : 'name') + ' and the credits appear here once the puzzle is solved.';
    }
    box.append(h, t);
    const img = gridEl.querySelector('.portrait img');
    if (img) img.title = solved ? (p.kind === 'painting' ? p.work + ' — ' + p.name : p.name) : '';
  }
  const SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Large' };

  const el = id => document.getElementById(id);
  const gridEl = el('grid'), kb = el('kb'), wrap = el('gridWrap');

  const parsed = {};
  function dict(lang, level) {
    const k = lang + level;
    if (!parsed[k]) {
      parsed[k] = C.parseDictionary(lines(lang, level));
      if (parsed[k].bad.length) console.warn('Skipped dictionary lines:', parsed[k].bad);
    }
    return parsed[k].map;
  }

  // Generation runs in a worker when possible (not available from file://), else on this thread.
  // The worker gets the same version query as this script (index.html: "?v=…"), and passes it on to
  // the scripts it imports, so a new version never runs with a stale cached generator.
  const VERSION = (document.currentScript && new URL(document.currentScript.src).search) || '';
  let worker = null, reqId = 0, pending = null;
  try {
    worker = new Worker('js/worker.js' + VERSION);
    worker.onmessage = e => {
      if (pending && e.data.id === pending.id) { const cb = pending.cb; pending = null; cb(e.data.res); }
    };
    worker.onerror = () => {
      worker = null;
      if (pending) { const p = pending; pending = null; runLocal(p.opts, p.cb); }
    };
  } catch (e) {
    worker = null;
  }

  function runLocal(opts, cb) {
    setTimeout(() => cb(C.generate({ dict: dict(opts.lang, opts.level), lang: opts.lang, size: opts.size, seed: opts.seed, portraits: portraitsFor(opts) })), 30);
  }

  function runGenerate(opts, cb) {
    if (!worker) { runLocal(opts, cb); return; }
    const want = portraitsFor(opts).length > 0;
    // A worker running an older generator would ignore the portrait: build the puzzle here then.
    pending = { id: ++reqId, opts, cb: res => (want && res.ok && !res.puzzle.portrait ? runLocal(opts, cb) : cb(res)) };
    worker.postMessage({ id: pending.id, lang: opts.lang, level: opts.level, size: opts.size, seed: opts.seed, portraits: portraitsFor(opts) });
  }

  let P = null;          // current puzzle
  let key = '';          // "lang-size-seed", or "lang-size-h-seed" for the hard level
  let level = 'e';       // level of the current puzzle
  let sol = [];          // solution letter per cell ('' for blocks)
  let cells = [];        // cell elements (null for blocks)
  let cellEntries = [];  // per cell: { across, down }
  let order = [];        // entries in clue order
  let clueEls = new Map();
  let user = [], wrong = new Set(), revealed = new Set();
  let cur = 0, dir = 'across';
  let elapsed = 0, solved = false;
  // For the best times only the first solution of a puzzle counts, and only if no letter was ever
  // revealed in it: both flags survive Clear, which resets the timer.
  let helped = false, solvedOnce = false;
  // Undo history for typed and deleted letters (this session only). Revealing letters or clearing
  // the grid empties it, so neither can be undone (it would let a revealed or cleared grid count
  // for the best times).
  let undoStack = [], redoStack = [];
  const UNDO_MAX = 500;
  const SCORES = 'xw15:scores';
  const SCORES_MAX = 10;

  // ---- storage (optional: the app works without it) ----
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  // Fingerprint of the solution: saved progress is reused only for the very same grid (a change to
  // the dictionaries or to the generator can turn the same link into a different puzzle).
  function fingerprint() {
    let h = 2166136261;
    const s = P.solution.join('/');
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  function saveProgress() {
    if (!P) return;
    store('xw15:p:' + key, { sol: fingerprint(), user: user.join(','), revealed: [...revealed], elapsed, solved, helped, solvedOnce });
  }

  function parseKey(s) {
    const m = /^(it|en)-(s|m|l)-(?:(h)-)?(\d{1,9})$/.exec(s || '');
    return m ? { lang: m[1], size: m[2], level: m[3] && m[1] === 'it' ? 'h' : 'e', seed: +m[4] } : null;
  }

  // Category of the best-time tables: "lang-size", plus "-h" for the hard level.
  function category(lang, size, lvl) { return lang + '-' + size + (lvl === 'h' ? '-h' : ''); }

  // The hard level exists only for Italian.
  function syncLevel() {
    const it = el('lang').value === 'it';
    el('level').disabled = !it;
    el('level').title = it ? '' : 'The hard level is available only in Italian';
    if (!it) el('level').value = 'e';
  }

  function status(text, cls) {
    const s = el('status');
    s.textContent = text || '';
    s.className = 'status' + (cls ? ' ' + cls : '');
  }

  // ---- puzzle creation ----
  function start(opts) {
    saveProgress();
    el('busy').hidden = false;
    el('new').disabled = true;
    runGenerate(opts, res => {
      el('busy').hidden = true;
      el('new').disabled = false;
      if (!res.ok) {
        status('Could not build a verified puzzle: ' + res.rejected.join('; '), 'bad');
        return;
      }
      level = opts.level;
      key = category(opts.lang, opts.size, level) + '-' + opts.seed;
      history.replaceState(null, '', '#' + key);
      store('xw15:last', key);
      el('lang').value = opts.lang;
      el('size').value = opts.size;
      syncLevel();
      el('level').value = level;
      setup(res.puzzle, res.report);
    });
  }

  function newPuzzle() {
    syncLevel();
    start({ lang: el('lang').value, size: el('size').value, level: el('level').value, seed: 1 + Math.floor(Math.random() * 999999999) });
  }

  function setup(puzzle, report) {
    if (el('done').open) el('done').close();
    P = puzzle;
    const n = P.rows * P.cols;
    sol = [];
    for (let r = 0; r < P.rows; r++) for (let c = 0; c < P.cols; c++) sol.push(P.solution[r][c] === '#' ? '' : P.solution[r][c]);
    cellEntries = Array.from({ length: n }, () => ({}));
    for (const e of P.entries) {
      e.cells = [];
      for (let i = 0; i < e.answer.length; i++) {
        const idx = e.dir === 'across' ? e.row * P.cols + e.col + i : (e.row + i) * P.cols + e.col;
        e.cells.push(idx);
        cellEntries[idx][e.dir] = e;
      }
    }
    order = P.entries.slice();

    user = new Array(n).fill('');
    wrong = new Set();
    revealed = new Set();
    elapsed = 0;
    solved = false;
    helped = false;
    solvedOnce = false;
    undoStack = [];
    redoStack = [];
    const saved = load('xw15:p:' + key);
    if (saved && typeof saved.user === 'string' && saved.sol === fingerprint()) {
      const u = saved.user.split(',');
      if (u.length === n) {
        user = u.map((ch, i) => (sol[i] && /^[A-Z]$/.test(ch) ? ch : ''));
        revealed = new Set((saved.revealed || []).filter(i => sol[i]));
        elapsed = saved.elapsed | 0;
        solved = !!saved.solved;
        helped = !!saved.helped || revealed.size > 0;
        solvedOnce = !!saved.solvedOnce || solved;
      }
    }

    const L = LABELS[P.lang];
    el('hAcross').textContent = L.across;
    el('hDown').textContent = L.down;
    document.documentElement.lang = P.lang;
    el('meta').textContent = 'Puzzle #' + P.seed + ' · ' + L.name + ' · ' + SIZE_NAMES[P.size] + (level === 'h' ? ' · Hard' : '') + ' · ' + P.cols + '×' + P.rows + ' · ' + P.entries.length + ' words';

    buildGrid();
    buildClues();
    renderReport(report);
    renderPicInfo();

    const first = order[0];
    dir = first.dir;
    cur = first.cells[0];
    fit();
    status(solved ? 'Already solved.' : '', solved ? 'good' : '');
    tick(true);
    update();
  }

  function renderReport(r) {
    const d = el('verify');
    const s = r.stats;
    const sum = d.querySelector('.verify-title');
    sum.textContent = '✓ Verified before publishing: ' + s.words + ' words, ' + s.numbered + ' numbers, ' + s.letters + ' letters';
    const cells = s.letters + s.blacks;
    const items = [
      s.words + ' words read directly from the solution grid, each one with exactly one clue',
      'Every clue number matches the number printed in the start cell of its word (' + s.numbered + ' numbered cells)',
      'Every answer equals the letters the grid spells at that position and direction',
      'Every clue is the dictionary definition of its answer, and no answer and no clue is repeated',
      'Every letter belongs to at least one clued word; ' + Math.round(100 * s.crossed / s.letters) + '% of the letters are crossed both ways',
      s.blacks + ' black cells (' + Math.round(100 * s.blacks / cells) + '% of the grid' + (s.picture ? ' outside the picture' : '') + ')',
      ...(s.picture ? ['The picture covers ' + s.picture + ' cells, and the person in it is one of the answers'] : []),
      r.patterns + ' black-cell patterns tried in ' + r.ms + ' ms' + (r.rejected.length ? ', ' + r.rejected.length + ' candidate(s) rejected' : '')
    ];
    const ul = d.querySelector('ul');
    ul.textContent = '';
    for (const t of items) {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    }
  }

  function buildGrid() {
    gridEl.textContent = '';
    gridEl.style.gridTemplateColumns = 'repeat(' + P.cols + ', var(--cell))';
    gridEl.setAttribute('aria-rowcount', P.rows);
    gridEl.setAttribute('aria-colcount', P.cols);
    cells = [];
    const pic = P.portrait;
    if (pic) {
      // One element over the whole square: the other cells flow around it in the CSS grid.
      const box = document.createElement('div');
      box.className = 'portrait';
      box.style.gridArea = '1 / 1 / span ' + pic.block + ' / span ' + pic.block;
      const img = document.createElement('img');
      const pd = portraitData();
      img.src = pd.file;
      img.alt = LABELS[P.lang][pd.kind === 'painting' ? 'painting' : 'portrait']; // never the name: it is an answer
      if (pd.kind === 'painting') img.className = 'contain'; // show the whole painting, not a square crop
      img.draggable = false;
      box.appendChild(img);
      gridEl.appendChild(box);
    }
    const inPic = i => pic && Math.floor(i / P.cols) < pic.block && i % P.cols < pic.block;
    for (let i = 0; i < sol.length; i++) {
      if (inPic(i)) { cells.push(null); continue; }
      const d = document.createElement('div');
      if (!sol[i]) {
        d.className = 'cell block';
        cells.push(null);
      } else {
        d.className = 'cell';
        d.dataset.i = i;
        if (P.numbers[i]) {
          const s = document.createElement('span');
          s.className = 'num';
          s.textContent = P.numbers[i];
          d.appendChild(s);
        }
        const l = document.createElement('span');
        l.className = 'letter';
        d.appendChild(l);
        cells.push(d);
      }
      gridEl.appendChild(d);
    }
  }

  function buildClues() {
    clueEls = new Map();
    for (const d of ['across', 'down']) {
      const ol = el(d);
      ol.textContent = '';
      for (const e of order) {
        if (e.dir !== d) continue;
        const li = document.createElement('li');
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = e.num;
        const t = document.createElement('span');
        t.className = 't';
        t.textContent = e.clue + ' ';
        const len = document.createElement('span');
        len.className = 'len';
        len.textContent = '(' + e.answer.length + ')';
        t.appendChild(len);
        li.append(n, t);
        li.addEventListener('click', () => {
          dir = e.dir;
          cur = e.cells.find(i => !user[i]) ?? e.cells[0];
          update();
          focusKb();
        });
        ol.appendChild(li);
        clueEls.set(e, li);
      }
    }
  }

  // Cell size: fit the grid in the board column (and in the window height on wide screens).
  function fit() {
    if (!P) return;
    const w = wrap.clientWidth - 4;
    let size = Math.floor((w - (P.cols - 1)) / P.cols);
    if (window.innerWidth >= 900) size = Math.min(size, Math.floor((window.innerHeight - 260 - (P.rows - 1)) / P.rows));
    size = Math.max(18, Math.min(44, size));
    document.documentElement.style.setProperty('--cell', size + 'px');
  }

  // ---- view ----
  function entryAt(i, d) { return cellEntries[i] ? cellEntries[i][d] : null; }
  function current() { return entryAt(cur, dir); }

  function update() {
    if (!P) return;
    if (!current()) dir = dir === 'across' ? 'down' : 'across';
    const e = current();
    const other = entryAt(cur, dir === 'across' ? 'down' : 'across');
    const inWord = new Set(e ? e.cells : []);
    for (let i = 0; i < cells.length; i++) {
      const d = cells[i];
      if (!d) continue;
      d.classList.toggle('in-word', inWord.has(i));
      d.classList.toggle('cursor', i === cur);
      d.classList.toggle('wrong', wrong.has(i));
      d.classList.toggle('revealed', revealed.has(i));
      d.lastChild.textContent = user[i];
    }
    gridEl.classList.toggle('solved', solved);
    el('undo').disabled = solved || !undoStack.length;

    for (const [entry, li] of clueEls) {
      li.classList.toggle('active', entry === e);
      li.classList.toggle('crossing', entry === other);
      li.classList.toggle('done', entry.cells.every(i => user[i]));
    }
    if (e) {
      el('clueBar').querySelector('.cb-num').textContent = e.num + ' ' + LABELS[P.lang][e.dir];
      el('clueBar').querySelector('.cb-text').textContent = e.clue + ' (' + e.answer.length + ')';
      if (window.innerWidth >= 900) clueEls.get(e).scrollIntoView({ block: 'nearest' });
    }

    // Keep the hidden input on the cursor so mobile browsers don't scroll away.
    const c = cells[cur];
    if (c) {
      kb.style.left = c.offsetLeft + 'px';
      kb.style.top = c.offsetTop + 'px';
    }
  }

  function focusKb() { kb.focus({ preventScroll: true }); }

  // ---- editing ----
  function afterChange() {
    const complete = sol.every((ch, i) => !ch || user[i]);
    if (!solved && complete) {
      if (sol.every((ch, i) => !ch || user[i] === ch)) {
        solved = true;
        const t = fmt(elapsed);
        status('Solved in ' + t + '!', 'good');
        const pd = portraitData();
        el('doneText').textContent = 'You completed puzzle #' + P.seed + ' in ' + t + (revealed.size ? ' (' + revealed.size + ' letters revealed).' : '.') +
          (pd ? (pd.kind === 'painting' ? ' The painting is "' + pd.work + '" by ' + pd.name + '.' : ' The person in the picture is ' + pd.name + '.') : '');
        renderPicInfo();
        const cat = category(P.lang, P.size, level);
        let rank, mine = 0;
        if (helped) rank = 'Letters were revealed in this puzzle: the time does not count for the best times.';
        else if (solvedOnce) rank = 'Only the first solution of a puzzle counts for the best times.';
        else {
          const r = addScore(cat, { t: elapsed, seed: P.seed, date: Date.now() });
          if (r) mine = P.seed;
          rank = r === 1 ? 'New record!' : r ? 'Number ' + r + ' in the best times.' : 'Not in the top ' + SCORES_MAX + ' this time.';
        }
        solvedOnce = true;
        el('doneRank').textContent = rank;
        renderScores(el('doneScores'), [cat], mine);
        if (window.Sound) window.Sound.celebrate();
        const dlg = el('done');
        if (dlg.showModal) dlg.showModal();
      } else {
        status('The grid is full, but some letters are wrong. Try Check.', 'bad');
      }
    } else if (!complete) {
      status('');
    }
    saveProgress();
    update();
  }

  // Writes a letter ('' deletes) in cell i as one undoable step, then moves the cursor to `next`.
  function setLetter(i, ch, next) {
    if (user[i] !== ch) {
      undoStack.push({ i, before: user[i], after: ch, cur, dir, next });
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack = [];
      user[i] = ch;
    }
    wrong.delete(i);
    cur = next;
  }

  function type(ch) {
    if (solved || !sol[cur]) return;
    const e = current();
    let next = cur;
    if (e) {
      const k = e.cells.indexOf(cur);
      if (k < e.cells.length - 1) next = e.cells[k + 1];
    }
    setLetter(cur, ch, next);
    afterChange();
  }

  function backspace() {
    if (solved) return;
    if (user[cur]) {
      setLetter(cur, '', cur);
    } else {
      const e = current();
      const k = e ? e.cells.indexOf(cur) : 0;
      if (k > 0) setLetter(e.cells[k - 1], '', e.cells[k - 1]);
    }
    afterChange();
  }

  function undo() {
    if (solved || !undoStack.length) return;
    const s = undoStack.pop();
    redoStack.push(s);
    user[s.i] = s.before;
    wrong.delete(s.i);
    cur = s.cur;
    dir = s.dir;
    afterChange();
  }

  function redo() {
    if (solved || !redoStack.length) return;
    const s = redoStack.pop();
    undoStack.push(s);
    user[s.i] = s.after;
    wrong.delete(s.i);
    cur = s.next;
    dir = s.dir;
    afterChange();
  }

  // ---- best times (per language and size, one entry per puzzle: its best time) ----
  function loadScores() {
    const all = load(SCORES);
    const out = {};
    if (all && typeof all === 'object') {
      for (const cat in all) {
        if (!/^(it|en)-(s|m|l)(-h)?$/.test(cat) || !Array.isArray(all[cat])) continue;
        out[cat] = all[cat].filter(x => x && x.t > 0 && Number.isInteger(x.seed) && x.date > 0);
      }
    }
    return out;
  }

  // Adds a time to its table; returns its rank (1-based), 0 if it is not in the top SCORES_MAX.
  function addScore(cat, entry) {
    const all = loadScores();
    const list = (all[cat] || []).filter(x => x.seed !== entry.seed);
    list.push(entry);
    list.sort((a, b) => a.t - b.t || a.date - b.date);
    all[cat] = list.slice(0, SCORES_MAX);
    store(SCORES, all);
    return all[cat].indexOf(entry) + 1;
  }

  function catName(cat) {
    const [lang, size, h] = cat.split('-');
    return LABELS[lang].name + ' · ' + SIZE_NAMES[size] + (h ? ' · ' + LEVEL_NAMES.h : '');
  }

  // Fills `box` with one table per category; the row of puzzle `mine` is highlighted.
  function renderScores(box, cats, mine) {
    const all = loadScores();
    box.textContent = '';
    for (const cat of cats) {
      const list = all[cat] || [];
      if (!list.length && cats.length > 1) continue;
      const h = document.createElement('h3');
      h.textContent = catName(cat);
      box.appendChild(h);
      const table = document.createElement('table');
      const head = table.insertRow();
      for (const t of ['#', 'Time', 'Puzzle', 'Date']) {
        const th = document.createElement('th');
        th.textContent = t;
        head.appendChild(th);
      }
      list.forEach((x, k) => {
        const tr = table.insertRow();
        if (x.seed === mine && cat === category(P.lang, P.size, level)) tr.className = 'me';
        tr.insertCell().textContent = k + 1;
        tr.insertCell().textContent = fmt(x.t);
        const a = document.createElement('a');
        a.href = '#' + cat + '-' + x.seed;
        a.textContent = '#' + x.seed;
        tr.insertCell().appendChild(a);
        tr.insertCell().textContent = new Date(x.date).toLocaleDateString();
      });
      box.appendChild(table);
    }
    if (!box.firstChild) {
      const p = document.createElement('p');
      p.textContent = 'No times yet: solve a puzzle without revealing letters.';
      box.appendChild(p);
    }
  }

  function showScores() {
    const first = P ? P.lang : el('lang').value;
    const cats = [];
    for (const lang of [first, first === 'it' ? 'en' : 'it']) {
      for (const lvl of lang === 'it' ? ['e', 'h'] : ['e']) for (const size of ['s', 'm', 'l']) cats.push(category(lang, size, lvl));
    }
    renderScores(el('scoresBody'), cats, 0);
    const dlg = el('scoresDlg');
    if (dlg.showModal) dlg.showModal();
  }

  function arrow(dr, dc) {
    const want = dc ? 'across' : 'down';
    if (dir !== want && entryAt(cur, want)) { dir = want; update(); return; }
    let r = Math.floor(cur / P.cols) + dr, c = (cur % P.cols) + dc;
    while (r >= 0 && c >= 0 && r < P.rows && c < P.cols) {
      const i = r * P.cols + c;
      if (sol[i]) { cur = i; break; }
      r += dr; c += dc;
    }
    update();
  }

  function jump(step) {
    const e = current();
    const k = order.indexOf(e);
    const next = order[(k + step + order.length) % order.length];
    dir = next.dir;
    cur = next.cells.find(i => !user[i]) ?? next.cells[0];
    update();
  }

  function toggleDir() {
    const other = dir === 'across' ? 'down' : 'across';
    if (entryAt(cur, other)) dir = other;
    update();
  }

  // ---- tools ----
  function reveal(list) {
    if (solved) return;
    undoStack = [];
    redoStack = [];
    for (const i of list) {
      if (user[i] !== sol[i]) { user[i] = sol[i]; revealed.add(i); helped = true; }
      wrong.delete(i);
    }
    afterChange();
  }

  function check() {
    if (!P || solved) return;
    let bad = 0, empty = 0;
    for (let i = 0; i < sol.length; i++) {
      if (!sol[i]) continue;
      if (!user[i]) empty++;
      else if (user[i] !== sol[i]) { wrong.add(i); bad++; }
    }
    status(bad ? bad + ' wrong letter' + (bad > 1 ? 's' : '') + ' marked.' : 'No mistakes so far' + (empty ? ' (' + empty + ' empty cells).' : '.'), bad ? 'bad' : 'good');
    update();
    focusKb();
  }

  function clearAll() {
    if (!P || !confirm('Clear the whole grid and reset the timer?')) return;
    user.fill('');
    wrong.clear();
    revealed.clear();
    undoStack = [];
    redoStack = [];
    solved = false;
    elapsed = 0;
    tick(true);
    afterChange();
  }

  function fmt(s) {
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  function tick(onlyShow) {
    if (!onlyShow && P && !solved && !document.hidden) {
      elapsed++;
      if (elapsed % 10 === 0) saveProgress();
    }
    el('timer').textContent = fmt(elapsed);
  }

  // ---- events ----
  gridEl.addEventListener('pointerdown', ev => {
    // A click on the picture selects the entry of the person in it (first empty cell, as for a clue click).
    if (P && P.portrait && ev.target.closest('.portrait')) {
      const e = P.entries.find(x => x.answer === P.portrait.word && x.clue === P.portrait.clue);
      if (e) {
        ev.preventDefault();
        dir = e.dir;
        cur = e.cells.find(i => !user[i]) ?? e.cells[0];
        update();
        focusKb();
      }
      return;
    }
    const d = ev.target.closest('.cell');
    if (!d || d.classList.contains('block')) return;
    ev.preventDefault();
    const i = +d.dataset.i;
    if (i === cur) toggleDir();
    else {
      cur = i;
      if (!entryAt(cur, dir)) dir = dir === 'across' ? 'down' : 'across';
      update();
    }
    focusKb();
  });

  kb.addEventListener('keydown', ev => {
    if (!P || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    let handled = true;
    if (k === 'ArrowLeft') arrow(0, -1);
    else if (k === 'ArrowRight') arrow(0, 1);
    else if (k === 'ArrowUp') arrow(-1, 0);
    else if (k === 'ArrowDown') arrow(1, 0);
    else if (k === 'Backspace') backspace();
    else if (k === 'Delete') { if (!solved) { setLetter(cur, '', cur); afterChange(); } }
    else if (k === 'Tab') jump(ev.shiftKey ? -1 : 1);
    else if (k === 'Enter') jump(ev.shiftKey ? -1 : 1);
    else if (k === ' ') toggleDir();
    else handled = false;
    if (handled) ev.preventDefault();
  });

  // Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes (Cmd on macOS), wherever the focus is except
  // in the selects.
  document.addEventListener('keydown', ev => {
    if (!P || !(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.target.tagName === 'SELECT') return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) redo();
    else return;
    ev.preventDefault();
  });

  // Letters arrive through the input event, which also works with mobile keyboards.
  kb.addEventListener('input', () => {
    const v = kb.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
    kb.value = '';
    if (v) type(v[v.length - 1]);
  });

  el('new').addEventListener('click', newPuzzle);
  el('lang').addEventListener('change', newPuzzle);
  el('size').addEventListener('change', newPuzzle);
  el('level').addEventListener('change', newPuzzle);
  el('check').addEventListener('click', check);
  el('revealLetter').addEventListener('click', () => { reveal([cur]); focusKb(); });
  el('revealWord').addEventListener('click', () => { const e = current(); if (e) reveal(e.cells); focusKb(); });
  el('revealAll').addEventListener('click', () => {
    if (P && !solved && confirm('Reveal the whole solution?')) reveal(sol.map((ch, i) => (ch ? i : -1)).filter(i => i >= 0));
  });
  el('clear').addEventListener('click', clearAll);
  el('undo').addEventListener('click', () => { undo(); focusKb(); });
  el('best').addEventListener('click', showScores);
  el('scoresClose').addEventListener('click', () => el('scoresDlg').close());
  el('info').addEventListener('click', () => { const d = el('infoDlg'); if (d.showModal) d.showModal(); });
  el('infoClose').addEventListener('click', () => el('infoDlg').close());
  // A puzzle link in a score table opens that puzzle (through hashchange): close the dialog.
  for (const id of ['scoresDlg', 'done']) {
    el(id).addEventListener('click', ev => { if (ev.target.closest('a')) el(id).close(); });
  }
  el('doneClose').addEventListener('click', () => el('done').close());
  el('doneNew').addEventListener('click', () => { el('done').close(); newPuzzle(); });

  window.addEventListener('resize', () => { fit(); update(); });
  window.addEventListener('hashchange', () => {
    const k = parseKey(location.hash.slice(1));
    if (k && location.hash.slice(1) !== key) start(k);
  });
  window.addEventListener('beforeunload', saveProgress);
  setInterval(tick, 1000);

  // Start from the link, then from the last puzzle, else a fresh one in the browser language.
  const initial = parseKey(location.hash.slice(1)) || parseKey(load('xw15:last'));
  if (initial) start(initial);
  else {
    el('lang').value = /^it\b/i.test(navigator.language || '') ? 'it' : 'en';
    el('size').value = 'm';
    newPuzzle();
  }
})();
