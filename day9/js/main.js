// Options, turns, input and drawing.
'use strict';

(() => {
  const { WHITE, BLACK } = Rules;
  const KEY = 'oppd2026.day9.';
  const STEP = 230;         // ms per step of a moving piece (matches --step plus a pause)
  const THINK = 420;        // pause before the computer moves
  const FIRST_WAIT = 700;   // before the computer opens a game
  const RESULT_WAIT = 500;

  const $ = id => document.getElementById(id);
  const squaresEl = $('squares'), piecesEl = $('pieces'), previewEl = $('preview'), beamsEl = $('beams');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // The computer player: the girl from the start screen, with a few lines.
  const CPU_NAME = 'Giulia';
  const SAY_TIME = 2800;
  const LINES = {
    hello: ['Ciao! Ready?', 'Mind the trap, okay?', 'Let\'s play!', 'I know where the portals go…'],
    myTake: ['Gotcha!', 'Mine!', 'Grazie!', 'Too easy.'],
    yourTake: ['Ouch!', 'Hey!', 'Lucky…', 'I saw that coming. Mostly.'],
    myCombo: ['What a combo!', 'Double trouble!', 'Bellissimo!'],
    yourCombo: ['Mamma mia!', 'No no no!', 'Okay, that hurt.'],
    myWarp: ['Whoosh!', 'Teleport time!', 'See you over there!'],
    yourWarp: ['Nice warp!', 'Show-off.', 'Where did that come from?'],
    myTrap: ['Noooo!', 'Who put that there?!', 'I meant to do that.'],
    yourTrap: ['Watch your step!', 'Hehe, gone!', 'The trap says thanks.'],
    myCrown: ['My crown!', 'Not the crown!'],
    yourCrown: ['No crown for you!', 'Bye-bye, crown!'],
    myKing: ['Long live the queen!', 'Crowned!', 'Now I fly… one square.'],
    yourKing: ['Not bad…', 'A king? Hmm.', 'Okay, okay.'],
    win: ['Grazie e arrivederci!', 'Better luck next time!', 'That was fun!'],
    lose: ['Well played!', 'Rematch? Please?', 'You got me!'],
    draw: ['A draw? Fine.', 'Nobody wins. Boring!'],
  };
  // Lines entirely in Italian, spoken with an Italian voice when there is one.
  const ITALIAN = new Set(['Grazie!', 'Bellissimo!', 'Mamma mia!', 'Grazie e arrivederci!']);
  let sayTimer = 0;

  function say(lines, mood, time = SAY_TIME) {
    if (opts.opponent !== 'computer') return;
    const bubble = $('say'), face = $('avatar');
    if (!bubble || !face) return;
    const line = pick(lines);
    bubble.textContent = line;
    Voice.speak(line, ITALIAN.has(line) ? 'it' : 'en');
    bubble.classList.remove('show');
    face.className = 'avatar';
    void bubble.offsetWidth;
    bubble.classList.add('show');
    face.classList.add(mood || 'happy');
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { bubble.classList.remove('show'); face.className = 'avatar'; }, time);
  }

  // Giulia comments the most striking thing that happened in a move.
  function react(m, ev, side) {
    const me = !isHuman(side);
    if (ev.trap === 'lost') say(me ? LINES.myTrap : LINES.yourTrap, me ? 'sad' : 'happy');
    else if (ev.trap === 'demoted') say(me ? LINES.myCrown : LINES.yourCrown, me ? 'sad' : 'happy');
    else if (ev.warp) say(me ? LINES.myWarp : LINES.yourWarp, me ? 'happy' : 'wow');
    else if (ev.promoted) say(me ? LINES.myKing : LINES.yourKing, me ? 'happy' : 'wow');
    else if (m.caps.length >= 2) say(me ? LINES.myCombo : LINES.yourCombo, me ? 'happy' : 'sad');
    else if (m.caps.length && Math.random() < 0.6) say(me ? LINES.myTake : LINES.yourTake, me ? 'happy' : 'sad');
  }

  // The trap snaps: the board shakes and embers (or crown gold) fly out.
  function quake(i, lost) {
    const frame = document.querySelector('.frame');
    frame.classList.remove('quake', 'quake-soft');
    void frame.offsetWidth;
    frame.classList.add(lost ? 'quake' : 'quake-soft');
    setTimeout(() => frame.classList.remove('quake', 'quake-soft'), 700);
    const sq = sqEls[i];
    sq.classList.remove('snap');
    void sq.offsetWidth;
    sq.classList.add('snap');
    setTimeout(() => sq.classList.remove('snap'), 700);

    const fx = $('fx'), cell = fx.clientWidth / 8, d = view(i);
    const colors = lost ? ['#ff5b36', '#ff8a3d', '#ffd23f', '#ffb08a', '#7a4a26', '#9b6a42'] : ['#ffd23f', '#e6b84f', '#fff2b0', '#c8932e'];
    const n = lost ? 22 : 14;
    for (let k = 0; k < n; k++) {
      const s = document.createElement('div');
      const a = Math.random() * Math.PI * 2, r = cell * (0.5 + Math.random() * (lost ? 1.1 : 0.8));
      s.className = 'spark';
      s.style.left = ((d & 7) + 0.5) * 12.5 + '%';
      s.style.top = ((d >> 3) + 0.5) * 12.5 + '%';
      s.style.setProperty('--dx', (Math.cos(a) * r).toFixed(1) + 'px');
      s.style.setProperty('--dy', (Math.sin(a) * r - cell * 0.3).toFixed(1) + 'px');
      s.style.setProperty('--sz', Math.round(cell * (0.06 + Math.random() * 0.07)) + 'px');
      s.style.background = pick(colors);
      s.style.animationDelay = Math.round(Math.random() * 80) + 'ms';
      fx.appendChild(s);
      setTimeout(() => s.remove(), 900);
    }
  }

  function load(k, d) {
    try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function save(k, v) {
    try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) {}
  }

  const opts = Object.assign(
    { opponent: 'computer', level: 'medium', side: 'white', magic: 'fixed', sound: true, voice: true },
    load('settings', {}));
  const score = load('score', {});
  Sound.on = opts.sound;
  Voice.on = opts.voice;

  let g;                  // { board, turn, specials, ply, quiet, reps, last, over, moves }
  let history = [];
  let gen = 0;            // bumped by a new game or an undo: cancels timers and animations
  let busy = false;       // a move is being animated
  let sel = null;         // { from, path } while the player builds a move
  let hover = -1;
  let pieceEls = new Map();

  const humanSide = () => (opts.side === 'white' ? WHITE : BLACK);
  const isHuman = side => opts.opponent === 'friend' || side === humanSide();
  const flipped = () => opts.opponent === 'computer' && opts.side === 'black';
  const view = i => (flipped() ? 63 - i : i);
  const sideName = s => (s === WHITE ? 'White' : 'Black');
  function who(s) {
    if (opts.opponent === 'friend') return sideName(s);
    return isHuman(s) ? 'You' : CPU_NAME;
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);

  function later(fn, ms) {
    const my = gen;
    setTimeout(() => { if (my === gen) fn(); }, ms);
  }

  // ---------- board construction ----------

  const SPIKES = (() => {
    let d = '';
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, w = Math.PI / n * 0.62;
      const p = (ang, r) => `${(50 + r * Math.cos(ang)).toFixed(1)},${(50 + r * Math.sin(ang)).toFixed(1)}`;
      d += `M${p(a - w, 47)}L${p(a, 27)}L${p(a + w, 47)}Z`;
    }
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${d}"/></svg>`;
  })();
  const CROWN = '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z"/></svg>';

  let sqEls = [];         // board index -> square element

  function buildBoard() {
    squaresEl.innerHTML = '';
    sqEls = new Array(64);
    for (let d = 0; d < 64; d++) {
      const i = flipped() ? 63 - d : d;
      const dark = ((Rules.row(i) + Rules.col(i)) & 1) === 0;
      const el = document.createElement(dark ? 'button' : 'div');
      el.className = 'sq ' + (dark ? 'dark' : 'light');
      el.style.setProperty('--c', d & 7);    // slice of the board-wide marble texture
      el.style.setProperty('--r', d >> 3);
      if (dark) {
        el.type = 'button';
        el.dataset.sq = i;
        el.innerHTML = '<span class="mark"></span>';
      }
      squaresEl.appendChild(el);
      sqEls[i] = el;
    }
    const files = 'abcdefgh'.split(''), ranks = '87654321'.split('');
    if (flipped()) { files.reverse(); ranks.reverse(); }
    const spans = a => a.map(t => `<span>${t}</span>`).join('');
    $('files-top').innerHTML = $('files-bottom').innerHTML = spans(files);
    $('ranks-left').innerHTML = $('ranks-right').innerHTML = spans(ranks);
  }

  function makePiece(p) {
    const el = document.createElement('div');
    el.className = 'piece ' + (p > 0 ? 'w' : 'b') + (Math.abs(p) === 2 ? ' king' : '');
    el.innerHTML = `<div class="body"><div class="under"></div><div class="disc">${CROWN}</div></div>`;
    return el;
  }

  function setPos(el, i) {
    const d = view(i);
    el.style.setProperty('--x', d & 7);
    el.style.setProperty('--y', d >> 3);
  }

  // ---------- portal beams ----------

  // A curved beam of light between two squares, in board units (viewBox 8×8).
  // kind: 'hint' (dashed, while choosing a move) or 'warp' (a comet, while warping).
  let beamId = 0;
  function drawBeam(a, b, kind) {
    const pa = view(a), pb = view(b);
    const x1 = (pa & 7) + 0.5, y1 = (pa >> 3) + 0.5, x2 = (pb & 7) + 0.5, y2 = (pb >> 3) + 0.5;
    const cx = (x1 + x2) / 2 - (y2 - y1) * 0.24, cy = (y1 + y2) / 2 + (x2 - x1) * 0.24;
    const d = `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
    const id = 'beam-grad-' + ++beamId;
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'beam ' + kind);
    g.innerHTML =
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
      '<stop offset="0" stop-color="#b98cff"/><stop offset="0.5" stop-color="#7b5cff"/><stop offset="1" stop-color="#3fd0ff"/></linearGradient>' +
      `<path class="glow" d="${d}" pathLength="1" stroke="url(#${id})" filter="url(#beam-blur)"/>` +
      `<path class="core" d="${d}" pathLength="1" stroke="url(#${id})"/>` +
      (kind === 'warp' ? `<path class="comet" d="${d}" pathLength="1"/>` : '');
    beamsEl.appendChild(g);
    return g;
  }
  const clearBeams = kind => beamsEl.querySelectorAll('.beam' + (kind ? '.' + kind : '')).forEach(n => n.remove());

  // ---------- move preview: where a portal sends the piece, what the trap does ----------

  const SKULL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c-4.7 0-8 3.2-8 7.6 0 2.6 1.2 4.4 2.8 5.5v2.6c0 .9.7 1.6 1.6 1.6h.8v1.7h1.6v-1.7h2.4v1.7h1.6v-1.7h.8c.9 0 1.6-.7 1.6-1.6v-2.6c1.6-1.1 2.8-2.9 2.8-5.5 0-4.4-3.3-7.6-8-7.6zM8.6 9.2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6.8 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 13.6l1.3 2.2h-2.6z"/></svg>';
  const UNCROWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z"/><path class="slash" d="M4 20L20 4"/></svg>';

  function renderPreview() {
    previewEl.innerHTML = '';
    clearBeams('hint');
    if (!sel || !playerTurn()) return;
    const k = sel.path.length, done = new Set();
    for (const m of candidates()) {
      if (m.path.length !== k + 1 || done.has(m.to)) continue;   // only moves the next click ends
      done.add(m.to);
      const ev = {};
      Rules.apply(g.board, m, g.specials, ev);
      const hot = hover === m.to;
      if (ev.warp) {
        const p = g.board[m.from];
        const ghost = makePiece(ev.promoted ? 2 * Math.sign(p) : p);
        ghost.classList.add('ghost');
        ghost.classList.toggle('hot', hot);
        setPos(ghost, ev.warp.to);
        previewEl.appendChild(ghost);
        drawBeam(m.to, ev.warp.to, 'hint').classList.toggle('hot', hot);
      }
      if (ev.trap) {
        const b = document.createElement('div');
        b.className = 'badge ' + (ev.trap === 'lost' ? 'lost' : 'uncrown') + (hot ? ' hot' : '');
        b.title = ev.trap === 'lost' ? 'This man would be lost' : 'This king would become a man';
        b.innerHTML = ev.trap === 'lost' ? SKULL : UNCROWN;
        setPos(b, m.to);
        previewEl.appendChild(b);
      }
    }
  }

  // ---------- rendering ----------

  function renderPieces() {
    piecesEl.innerHTML = '';
    pieceEls = new Map();
    for (const i of Rules.DARK) {
      const p = g.board[i];
      if (!p) continue;
      const el = makePiece(p);
      setPos(el, i);
      piecesEl.appendChild(el);
      pieceEls.set(i, el);
    }
    decoratePieces();
  }

  // Candidate moves that match the path built so far.
  function candidates() {
    if (!sel) return [];
    return g.moves.filter(m => m.from === sel.from && sel.path.every((s, k) => m.path[k] === s));
  }

  function playerTurn() { return g && !g.over && !busy && isHuman(g.turn); }

  function decoratePieces() {
    const mine = playerTurn() ? g.moves : [];
    const must = mine.length && mine[0].caps.length;
    const doomed = new Set();
    if (sel && hover >= 0) {
      const k = sel.path.length;
      for (const m of candidates()) if (m.path[k] === hover) m.caps.slice(0, k + 1).forEach(c => doomed.add(c));
    }
    for (const [i, el] of pieceEls) {
      el.classList.toggle('must', !!must && !sel && mine.some(m => m.from === i));
      el.classList.toggle('lift', !!sel && sel.from === i);
      el.classList.toggle('doomed', doomed.has(i));
    }
    renderPreview();
  }

  function renderSquares() {
    const sp = g.specials, turn = playerTurn();
    const cand = candidates();
    const next = new Set(cand.map(m => m.path[sel.path.length]));
    const movable = new Set(turn ? g.moves.map(m => m.from) : []);
    const last = g.last ? [g.last.m.from, g.last.ev.at] : [];
    for (const i of Rules.DARK) {
      const el = sqEls[i];
      const portal = sp.portals.includes(i), trap = sp.trap === i;
      const kind = portal ? 'portal' : trap ? 'trap' : '';
      if (el.dataset.kind !== kind) {
        el.dataset.kind = kind;
        el.querySelector('.mark').innerHTML = trap ? SPIKES : '';
      }
      el.classList.toggle('portal', portal);
      el.classList.toggle('trap', trap);
      el.classList.toggle('blocked', portal && g.board[sp.portals[1 - sp.portals.indexOf(i)]] !== 0);
      el.classList.toggle('last', !sel && last.includes(i));
      el.classList.toggle('sel', !!sel && sel.from === i);
      el.classList.toggle('path', !!sel && sel.path.includes(i));
      el.classList.toggle('target', next.has(i));
      el.classList.toggle('can', movable.has(i) || next.has(i));
      const p = g.board[i];
      let label = Rules.square(i) + ', ' + (p ? sideName(Math.sign(p)) + (Math.abs(p) === 2 ? ' king' : ' man') : 'empty');
      if (portal) label += ', portal';
      if (trap) label += ', trap';
      if (next.has(i)) label += ', move here';
      el.setAttribute('aria-label', label);
      el.title = portal ? 'Portal: a piece that stops here jumps to the other portal'
        : trap ? 'Trap: a man that stops here is lost, a king becomes a man' : '';
    }
    decoratePieces();
  }

  function renderBars() {
    const n = Rules.count(g.board);
    const topSide = flipped() ? WHITE : BLACK;
    for (const [id, s] of [['bar-top', topSide], ['bar-bottom', -topSide]]) {
      const men = s === WHITE ? n.wm : n.bm, kings = s === WHITE ? n.wk : n.bk;
      const cpu = opts.opponent === 'computer' && !isHuman(s);
      const name = opts.opponent === 'friend' ? sideName(s)
        : cpu ? `${CPU_NAME} · ${cap(opts.level)}` : `You · ${sideName(s)}`;
      const el = $(id);
      // Built once per layout, so the speech bubble survives re-renders.
      const layout = s + (cpu ? 'cpu' : '');
      if (el.dataset.layout !== layout) {
        el.dataset.layout = layout;
        el.innerHTML = (cpu ? `<span class="avatar" id="avatar" title="${CPU_NAME}"></span>` : '') + '<span class="chip"></span>' +
          '<span class="who"></span>' +
          (cpu ? '<span class="say" id="say" aria-live="polite"></span>' : '') +
          '<span class="count"></span>';
      }
      el.querySelector('.chip').className = 'chip ' + (s === WHITE ? 'w' : 'b');
      el.querySelector('.who').textContent = name;
      el.querySelector('.count').innerHTML = `<b>${men}</b> ${men === 1 ? 'man' : 'men'}` +
        (kings ? ` · <b>${kings}</b> ${kings === 1 ? 'king' : 'kings'}` : '');
      el.classList.toggle('turn', !g.over && g.turn === s);
    }
  }

  function renderScore() {
    const el = $('score');
    if (opts.opponent === 'friend') {
      const s = score.friend || { w: 0, b: 0, d: 0 };
      el.innerHTML = `White <b>${s.w}</b> · Draws <b>${s.d}</b> · Black <b>${s.b}</b>`;
    } else {
      const s = score[opts.level] || { w: 0, l: 0, d: 0 };
      el.innerHTML = `${cap(opts.level)}: You <b>${s.w}</b> · Draws <b>${s.d}</b> · ${CPU_NAME} <b>${s.l}</b>`;
    }
  }

  function renderWander() {
    const el = $('wander');
    el.hidden = opts.magic !== 'wander';
    const left = Rules.WANDER - (g.ply % Rules.WANDER);
    el.textContent = `The magic squares move in ${left} ${left === 1 ? 'move' : 'moves'}.`;
  }

  function renderOptions() {
    document.querySelectorAll('[data-opt]').forEach(b => {
      b.setAttribute('aria-pressed', String(opts[b.dataset.opt] === b.dataset.value));
    });
    const friend = opts.opponent === 'friend';
    document.querySelector('[aria-label="Level"]').classList.toggle('disabled', friend);
    document.querySelector('[aria-label="Your side"]').classList.toggle('disabled', friend);
    $('sound').classList.toggle('off', !opts.sound);
    $('voice').classList.toggle('off', !opts.voice);
  }

  function renderAll() {
    renderPieces();
    renderSquares();
    renderBars();
    renderScore();
    renderWander();
    $('undo').disabled = !history.length || !!g.over;
  }

  const setStatus = t => { $('status').textContent = t; };
  const setEvent = h => { $('event').innerHTML = h; };

  // ---------- game flow ----------

  function newGame() {
    gen++;
    busy = false;
    sel = null;
    hover = -1;
    history = [];
    g = Rules.newGame(Math.random);
    g.reps = new Map([[Rules.key(g.board, g.turn), 1]]);
    g.last = null;
    g.over = null;
    $('result').hidden = true;
    Confetti.stop();
    Voice.stop();
    clearBeams();
    previewEl.innerHTML = '';
    buildBoard();
    setEvent('Find the portals and the trap before you move.');
    checkTurn(true);
    say(LINES.hello, 'happy');
  }

  function snapshot() {
    return {
      board: g.board.slice(), turn: g.turn, specials: { portals: g.specials.portals.slice(), trap: g.specials.trap },
      ply: g.ply, quiet: g.quiet, reps: new Map(g.reps), last: g.last,
    };
  }

  function checkTurn(first) {
    g.moves = Rules.moves(g.board, g.turn);
    if (!g.moves.length) return finish(-g.turn);
    if (g.quiet >= Rules.DRAW_QUIET) return finish(0, 'forty moves each without progress');
    if ((g.reps.get(Rules.key(g.board, g.turn)) || 0) >= Rules.REPEATS) return finish(0, 'the same position three times');

    // A single movable piece is picked up for the player.
    if (isHuman(g.turn) && new Set(g.moves.map(m => m.from)).size === 1) sel = { from: g.moves[0].from, path: [] };
    renderAll();
    const capture = g.moves[0].caps.length > 0;
    if (isHuman(g.turn)) {
      const lead = opts.opponent === 'friend' ? `${sideName(g.turn)} to move` : 'Your move';
      setStatus(capture ? `${lead}: you must capture` : lead);
    } else {
      setStatus(`${CPU_NAME} is thinking…`);
      later(cpuMove, first ? FIRST_WAIT : THINK);
    }
  }

  function cpuMove() {
    const m = AI.choose(g.board, g.turn, g.specials, opts.level);
    if (m) play(m);
  }

  async function play(m) {
    const my = gen;
    history.push(snapshot());
    sel = null;
    hover = -1;
    busy = true;
    const side = g.turn, piece = g.board[m.from];
    const ev = {};
    const nb = Rules.apply(g.board, m, g.specials, ev);
    renderSquares();
    $('undo').disabled = true;
    await animate(m, ev, my);
    if (my !== gen) return;

    g.board = nb;
    g.turn = -side;
    g.ply++;
    g.quiet = (m.caps.length || Math.abs(piece) === 1 || ev.trap || ev.promoted) ? 0 : g.quiet + 1;
    g.last = { m, ev, side };
    describe(m, ev, side);
    if (opts.opponent === 'computer') react(m, ev, side);

    if (opts.magic === 'wander' && g.ply % Rules.WANDER === 0) {
      const sp = Rules.placeSpecials(g.board, Math.random, 1, 6, true);
      if (sp) {
        g.specials = sp;
        g.reps = new Map();
        Sound.shift();
        renderSquares();
        for (const i of [...sp.portals, sp.trap]) {
          const el = sqEls[i];
          el.classList.remove('appear');
          void el.offsetWidth;
          el.classList.add('appear');
        }
        $('event').innerHTML += ' · <span class="hot">The magic squares moved!</span>';
      }
    }
    const k = Rules.key(g.board, g.turn);
    g.reps.set(k, (g.reps.get(k) || 0) + 1);
    busy = false;
    checkTurn();
  }

  async function animate(m, ev, my) {
    const el = pieceEls.get(m.from);
    if (!el) return;
    el.classList.remove('lift', 'must');
    el.classList.add('moving');
    for (let k = 0; k < m.path.length; k++) {
      setPos(el, m.path[k]);
      await wait(STEP);
      if (my !== gen) return;
      if (m.caps.length) {
        const c = pieceEls.get(m.caps[k]);
        if (c) c.classList.add('taken');
        Sound.capture();
      } else Sound.place();
    }
    if (ev.promoted) {
      el.classList.add('king', 'crowned');
      Sound.crown();
      await wait(480);
    }
    if (ev.trap === 'lost') {
      el.classList.add('fall');
      Sound.trap();
      quake(m.to, true);
      await wait(640);
    } else if (ev.trap === 'demoted') {
      el.classList.remove('king');
      el.classList.add('demote');
      Sound.trap();
      quake(m.to, false);
      Sound.demote();
      await wait(540);
    } else if (ev.warp) {
      el.classList.add('warp-out');
      Sound.warp();
      const beam = drawBeam(ev.warp.from, ev.warp.to, 'warp');
      setTimeout(() => beam.remove(), 1300);
      await wait(600);              // the comet reaches the other portal
      if (my !== gen) return;
      el.classList.add('jump');
      setPos(el, ev.warp.to);
      void el.offsetWidth;
      el.classList.remove('jump', 'warp-out');
      el.classList.add('warp-in');
      await wait(440);
    } else if (m.caps.length) {
      await wait(120);
    }
  }

  function describe(m, ev, side) {
    let t = `${who(side)}: ${Rules.notation(m)}`;
    if (m.caps.length) t += ` (took ${m.caps.length})`;
    if (ev.promoted) t += ' · <span class="hot">Crowned!</span>';
    if (ev.warp) t += ` · <span class="hot">Warped to ${Rules.square(ev.warp.to)}!</span>`;
    else if (ev.blocked !== undefined) t += ' · the other portal is occupied';
    if (ev.trap === 'lost') t += ' · <span class="hot">Lost in the trap!</span>';
    if (ev.trap === 'demoted') t += ' · <span class="hot">The king fell back to a man!</span>';
    setEvent(t);
  }

  function finish(winner, why) {
    g.over = { winner };
    sel = null;
    let title, sub, win = null;
    const loser = -winner;
    const reason = why ? `Draw: ${why}.`
      : Rules.count(g.board)[loser === WHITE ? 'wm' : 'bm'] + Rules.count(g.board)[loser === WHITE ? 'wk' : 'bk']
        ? `${sideName(loser)} has no legal move.` : `${sideName(loser)} has no pieces left.`;
    if (opts.opponent === 'friend') {
      const s = score.friend || (score.friend = { w: 0, b: 0, d: 0 });
      if (!winner) { s.d++; title = 'Draw'; } else { s[winner === WHITE ? 'w' : 'b']++; title = `${sideName(winner)} wins`; win = true; }
    } else {
      const s = score[opts.level] || (score[opts.level] = { w: 0, l: 0, d: 0 });
      if (!winner) { s.d++; title = 'Draw'; }
      else if (winner === humanSide()) { s.w++; title = 'You win!'; win = true; }
      else { s.l++; title = `${CPU_NAME} wins`; win = false; }
    }
    save('score', score);
    sub = `${reason} ${g.ply} moves played.`;
    renderAll();
    setStatus(title);
    if (opts.opponent === 'computer') say(win ? LINES.lose : win === false ? LINES.win : LINES.draw, win ? 'sad' : 'happy', 6000);
    $('result-title').textContent = title;
    $('result-sub').textContent = sub;
    later(() => {
      $('result').hidden = false;
      Sound.end(win);
      if (win) Confetti.burst();
      $('again').focus({ preventScroll: true });
    }, RESULT_WAIT);
  }

  function undo() {
    if (!history.length || g.over) return;
    let s = history.pop();
    while (history.length && !isHuman(s.turn)) s = history.pop();
    gen++;
    busy = false;
    sel = null;
    Object.assign(g, s, { over: null });
    $('result').hidden = true;
    setEvent('Move taken back.');
    if (!isHuman(g.turn)) history = [];
    checkTurn();
  }

  // ---------- input ----------

  function onSquare(i) {
    if (!playerTurn()) return;
    const moves = g.moves;
    if (sel) {
      const cand = candidates();
      const next = cand.filter(m => m.path[sel.path.length] === i);
      if (next.length) {
        const path = [...sel.path, i];
        if (next[0].path.length === path.length) return play(next[0]);
        sel.path = path;
        Sound.select();
        renderSquares();
        return;
      }
      // A click on the final square of a longer capture plays it, if unique.
      const fin = cand.filter(m => m.to === i && m.path.length > sel.path.length);
      if (fin.length === 1) return play(fin[0]);
    }
    if (g.board[i] * g.turn > 0) {
      if (moves.some(m => m.from === i)) {
        sel = sel && sel.from === i && !sel.path.length && new Set(moves.map(m => m.from)).size > 1 ? null : { from: i, path: [] };
        Sound.select();
      } else {
        sel = null;
        setEvent(moves[0].caps.length ? 'Capturing is mandatory: one of the glowing pieces must take.' : 'That piece cannot move.');
      }
    } else if (!sel || !sel.path.length) {
      sel = null;
    }
    renderSquares();
  }

  squaresEl.addEventListener('click', e => {
    Sound.init();
    const b = e.target.closest('.sq.dark');
    if (b) onSquare(+b.dataset.sq);
  });
  squaresEl.addEventListener('pointerover', e => {
    const b = e.target.closest('.sq.dark');
    const i = b ? +b.dataset.sq : -1;
    if (i !== hover) { hover = i; if (g) decoratePieces(); }
  });
  squaresEl.addEventListener('pointerleave', () => { hover = -1; if (g) decoratePieces(); });

  document.querySelectorAll('[data-opt]').forEach(b => {
    b.addEventListener('click', () => {
      Sound.init();
      const k = b.dataset.opt;
      if (opts[k] === b.dataset.value) return;
      opts[k] = b.dataset.value;
      save('settings', opts);
      renderOptions();
      newGame();
    });
  });

  $('new').addEventListener('click', () => { Sound.init(); newGame(); });
  $('again').addEventListener('click', () => { Sound.init(); newGame(); });
  $('undo').addEventListener('click', () => { Sound.init(); undo(); });

  $('sound').addEventListener('click', toggleSound);
  function toggleSound() {
    opts.sound = !opts.sound;
    Sound.on = opts.sound;
    Sound.init();
    save('settings', opts);
    renderOptions();
  }

  // Giulia's voice (browser speech synthesis), independent from the sound effects.
  $('voice').addEventListener('click', toggleVoice);
  $('voice').hidden = !Voice.available;
  document.addEventListener('visibilitychange', () => { if (document.hidden) Voice.stop(); });
  function toggleVoice() {
    opts.voice = !opts.voice;
    Voice.on = opts.voice;
    save('settings', opts);
    renderOptions();
  }

  // Theme: auto (system), light (day), dark (night) or rome (Rome at night).
  const THEMES = ['auto', 'light', 'dark', 'rome'];
  const GLYPH = { auto: '◐︎', light: '☀︎', dark: '☾︎' };
  const COLUMN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5L12 2l8 3.5v1.5H4zM6 8.5h12V10H6zM8 11h2.2v7H8zM10.9 11h2.2v7h-2.2zM13.8 11H16v7h-2.2zM5.5 19h13v2.5h-13z"/></svg>';
  const THEME_NAME = { auto: 'auto', light: 'day', dark: 'night', rome: 'Rome at night' };
  const media = matchMedia('(prefers-color-scheme: dark)');
  let theme = 'auto';
  try { theme = localStorage.getItem(KEY + 'theme') || 'auto'; } catch (e) {}
  if (!THEMES.includes(theme)) theme = 'auto';
  function applyTheme() {
    const dark = theme === 'auto' ? media.matches : theme === 'dark';
    document.documentElement.dataset.theme = theme === 'rome' ? 'rome' : dark ? 'dark' : 'light';
    const btn = $('theme');
    if (theme === 'rome') btn.innerHTML = COLUMN;
    else btn.textContent = GLYPH[theme];
    btn.setAttribute('aria-label', `Theme: ${THEME_NAME[theme]}`);
  }
  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(KEY + 'theme', theme); } catch (e) {}
    applyTheme();
  }
  $('theme').addEventListener('click', cycleTheme);
  media.addEventListener('change', applyTheme);

  // Start screen: any click or key closes it, unlocks audio and starts the game.
  const splash = $('splash');
  let started = false;
  function start() {
    if (started) return;
    started = true;
    Sound.init();
    splash.classList.add('gone');
    splash.setAttribute('aria-hidden', 'true');
    newGame();
  }
  splash.addEventListener('click', start);
  splash.focus();

  document.addEventListener('keydown', e => {
    if (!started) {
      if (e.key !== 'Tab') { e.preventDefault(); start(); }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { Sound.init(); newGame(); }
    else if (k === 'u') { Sound.init(); undo(); }
    else if (k === 'l') cycleTheme();
    else if (k === 'm') toggleSound();
    else if (k === 'v' && Voice.available) toggleVoice();
    else if (k === 'escape' && sel && playerTurn()) { sel = null; renderSquares(); }
    else return;
    e.preventDefault();
  });

  applyTheme();
  renderOptions();
})();
