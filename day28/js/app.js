// Perfect Twist: game flow, animation queue, input and interface.
(() => {
  const P = PUZZLE;
  const $ = id => document.getElementById(id);
  const DEG = 180 / Math.PI;
  const ease = t => 1 - Math.pow(1 - t, 3);

  const S = {
    grid: P.solved(),
    view: 0,                 // camera angle in degrees (0 = column 0 in front)
    pitch: 24,               // how much the camera looks down, in degrees
    ring: [0, 0, 0],         // live ring offsets in degrees, during drags and animations
    slide: null, hover: null,
    hist: [],                // every move since the solved state (for Rewind)
    undo: [],                // player moves since the last scramble
    status: 'idle',          // idle | scrambling | playing | won | rewinding | solving
    moves: 0, elapsed: 0, startedAt: null,
    queue: [], cur: null,
    viewAnim: null, lastInput: 0,
    glowStart: null, glow: 0,   // glow after a solve
  };
  let best = JSON.parse(localStorage.getItem('day28.best') || 'null');

  // ---------- animation queue ----------
  // Each item: { m: move, kind: play | scramble | undo | rewind | snap, dur, target? }
  const busy = () => !!(S.cur || S.queue.length);
  // the computer is moving the cylinder
  const auto = () => S.status === 'scrambling' || S.status === 'rewinding' || S.status === 'solving';
  const push = item => S.queue.push(item);

  function startItem(it, now) {
    S.cur = it; it.t0 = now;
    if (it.kind !== 'snap') S.glowStart = null;   // any move ends the glow
    const m = it.m;
    if (m.t === 'r') {
      it.from = S.ring[m.row];
      if (it.target === undefined) it.target = m.k * 60;
      const steps = Math.round(Math.abs(it.target - it.from) / 60);
      if (steps) SOUND.ratchet(Math.min(steps, 3), it.dur / 1000);
    } else SOUND.slide();
    if (it.kind === 'play' && S.status === 'playing' && S.startedAt === null) S.startedAt = Date.now() - S.elapsed;
  }

  function step(now) {
    if (!S.cur && S.queue.length) startItem(S.queue.shift(), now);
    const it = S.cur;
    if (!it) return;
    const p = Math.min(1, (now - it.t0) / it.dur), e = ease(p);
    if (it.m.t === 'r') S.ring[it.m.row] = it.from + (it.target - it.from) * e;
    else S.slide = { c: it.m.c, r: it.m.r, to: it.m.to, p: e };
    if (p >= 1) finish(it);
  }

  function finish(it) {
    const m = it.m;
    P.apply(S.grid, m);
    if (m.t === 'r') S.ring[m.row] = 0;
    S.slide = null; S.cur = null;
    switch (it.kind) {
      case 'play':
        S.hist.push(m); S.undo.push(m); S.moves += P.cost(m);
        if (S.status === 'playing' && P.isSolved(S.grid)) win();
        break;
      case 'undo':
        S.hist.pop(); S.moves += P.cost(m);
        break;
      case 'scramble':
        S.hist.push(m);
        if (!S.queue.length) { S.status = 'playing'; S.moves = 0; S.elapsed = 0; S.startedAt = null; S.undo = []; toast('Your turn: make six single-colour columns'); }
        break;
      case 'solve':
        S.hist.push(m);
        if (!S.queue.length) { S.status = 'idle'; S.undo = []; S.hist = []; toast('Solved by the computer'); S.glowStart = performance.now(); SOUND.win(); }
        break;
      case 'rewind':
        S.hist.pop();
        if (!S.queue.length) { S.status = 'idle'; S.undo = []; S.hist = []; toast('Back to the solved cylinder'); }
        break;
    }
    if (it.kind !== 'snap') save();
    ui();
  }

  // ---------- actions ----------
  function play(m, dur) {
    if (busy() || auto()) return false;
    if (S.status === 'won') S.status = 'idle';
    push({ m, kind: 'play', dur: dur || (m.t === 'r' ? 150 + 70 * Math.abs(m.k) : 170) });
    S.lastInput = performance.now();
    return true;
  }

  function turn(row, k) { return play(P.ring(row, k)); }

  function slideAt(r, c) {
    if (!P.canSlide(S.grid, r, c)) return false;
    return play(P.slideMove(S.grid, r, c));
  }

  function scramble() {
    if (busy()) return;
    closeOverlays();
    const list = P.scramble(S.grid, 40);
    S.status = 'scrambling'; S.moves = 0; S.elapsed = 0; S.startedAt = null; S.undo = [];
    list.forEach(m => push({ m, kind: 'scramble', dur: m.t === 'r' ? 70 + 25 * Math.abs(m.k) : 60 }));
    S.lastInput = performance.now();
    ui();
  }

  function undo() {
    if (busy() || !S.undo.length || auto()) return;
    if (S.status === 'won') return;
    const m = S.undo.pop();
    push({ m: P.inverse(m), kind: 'undo', dur: 170 });
    ui();
  }

  // Let the computer solve the cylinder from here (beam search in PUZZLE.solve).
  function solveIt() {
    if (busy() || auto()) return;
    if (P.isSolved(S.grid)) { toast('Already solved'); return; }
    const ms = P.solve(S.grid);
    if (!ms) { toast('No solution found'); return; }
    closeOverlays();
    S.elapsed = elapsed(); S.startedAt = null; S.status = 'solving';
    ms.forEach(m => push({ m, kind: 'solve', dur: m.t === 'r' ? 220 + 80 * Math.abs(m.k) : 240 }));
    toast(`Solving in ${ms.reduce((a, m) => a + P.cost(m), 0)} moves`);
    ui();
  }

  // Hint: play the first step of the computer's solution (a ring turn and/or a slide), as player moves.
  function hint() {
    if (busy() || auto() || S.status === 'won') return;
    if (P.isSolved(S.grid)) { toast('Already solved'); return; }
    const ms = P.solve(S.grid);
    if (!ms) return;
    const n = ms[0].t === 'r' && ms[1] && ms[1].t === 's' ? 2 : 1;
    ms.slice(0, n).forEach((m, i) => {
      if (i === 0) play(m, 420); else push({ m, kind: 'play', dur: 380 });
    });
  }

  // Play every move since the solved state backwards (a way to give up and see it solved).
  function rewind() {
    if (busy() || !S.hist.length) return;
    closeOverlays();
    const n = S.hist.length, dur = Math.max(45, Math.min(200, 6000 / n));
    S.status = 'rewinding'; S.startedAt = null;
    for (let i = n - 1; i >= 0; i--) push({ m: P.inverse(S.hist[i]), kind: 'rewind', dur });
    ui();
  }

  function rotateView(d) {
    const from = S.view;
    S.viewAnim = { from, to: Math.round((from + d) / 60) * 60, t0: performance.now(), dur: 320 };
    S.lastInput = performance.now();
  }

  function win() {
    S.status = 'won'; S.hist = []; S.undo = [];
    S.elapsed = elapsed(); S.startedAt = null;
    const rec = { moves: S.moves, time: S.elapsed };
    const newBest = !best || rec.moves < best.moves || (rec.moves === best.moves && rec.time < best.time);
    const fastest = !best || !best.fastest || rec.time < best.fastest;
    best = { moves: newBest ? rec.moves : best.moves, time: newBest ? rec.time : best.time, fastest: fastest ? rec.time : best.fastest };
    localStorage.setItem('day28.best', JSON.stringify(best));
    VIEW.burst(); SOUND.win(); S.glowStart = performance.now();
    setTimeout(() => {
      $('win-text').textContent = `Solved in ${S.moves} moves and ${fmt(S.elapsed)}.`;
      $('win-best').textContent = newBest ? 'New best!' : (fastest ? 'Fastest solve yet!' : `Best: ${best.moves} moves`);
      $('win').hidden = false;
    }, 900);
  }

  // ---------- persistence ----------
  function save() {
    const st = auto() ? null : {
      grid: S.grid, hist: S.hist, undo: S.undo, status: S.status, moves: S.moves, elapsed: elapsed(), view: S.view,
    };
    if (st) localStorage.setItem('day28.game', JSON.stringify(st));
  }
  function load() {
    try {
      const st = JSON.parse(localStorage.getItem('day28.game') || 'null');
      if (!st || !Array.isArray(st.grid) || st.grid.length !== 3) return false;
      // Check the grid is a real position: replay the history backwards must give the solved cylinder.
      const g = P.clone(st.grid);
      for (let i = st.hist.length - 1; i >= 0; i--) P.apply(g, P.inverse(st.hist[i]));
      if (JSON.stringify(g) !== JSON.stringify(P.solved())) return false;
      Object.assign(S, { grid: st.grid, hist: st.hist, undo: st.undo || [], status: st.status === 'won' ? 'idle' : st.status,
        moves: st.moves || 0, elapsed: st.elapsed || 0, view: st.view || 0 });
      return true;
    } catch (e) { return false; }
  }

  // ---------- interface ----------
  const elapsed = () => S.startedAt !== null ? Date.now() - S.startedAt : S.elapsed;
  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  let toastT = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // Flat map of the whole cylinder (all six columns), rolled so the front column is in the middle.
  const map = $('map');
  function buildMap() {
    map.innerHTML = '<div class="frontband" title="Facing you"></div>';
    ['Top', 'Middle', 'Bottom'].forEach((name, r) => {
      const row = document.createElement('div');
      row.className = 'mrow';
      const l = document.createElement('button');
      l.className = 'rot'; l.textContent = '◀'; l.title = `Turn the ${name.toLowerCase()} ring left (${'QAZ'[r]})`;
      l.onclick = () => turn(r, -1);
      const cells = document.createElement('div');
      cells.className = 'cells';
      for (let i = 0; i < 6; i++) {
        const b = document.createElement('button');
        b.className = 'cell';
        b.onclick = () => { const c = +b.dataset.c; slideAt(r, c); };
        cells.appendChild(b);
      }
      const rt = document.createElement('button');
      rt.className = 'rot'; rt.textContent = '▶'; rt.title = `Turn the ${name.toLowerCase()} ring right (${'WSX'[r]})`;
      rt.onclick = () => turn(r, 1);
      row.append(l, cells, rt);
      map.appendChild(row);
    });
  }
  function drawMap() {
    const front = P.mod(Math.round(S.view / 60));
    const rows = map.querySelectorAll('.mrow');
    rows.forEach((row, r) => {
      row.querySelectorAll('.cell').forEach((b, i) => {
        const c = P.mod(front + i - 2);
        const v = S.grid[r][c];
        b.dataset.c = c;
        b.style.background = v === P.GAP ? '' : P.COLOURS[v].hex;
        b.classList.toggle('gap', v === P.GAP);
        b.classList.toggle('can', P.canSlide(S.grid, r, c));
        b.title = v === P.GAP ? 'Empty slot' : P.COLOURS[v].name + (P.canSlide(S.grid, r, c) ? ' (click to slide)' : '');
      });
    });
  }

  function ui() {
    $('moves').textContent = S.moves;
    $('best').textContent = best ? `${best.moves} · ${fmt(best.fastest || best.time)}` : '–';
    $('undo').disabled = !S.undo.length || S.status !== 'playing' && S.status !== 'idle';
    $('rewind').disabled = !S.hist.length || auto();
    $('scramble').disabled = auto();
    $('solve').disabled = auto() || P.isSolved(S.grid);
    $('hint').disabled = auto() || S.status === 'won' || P.isSolved(S.grid);
    $('sound').textContent = SOUND.enabled ? '♪ Sound on' : '♪ Sound off';
    $('music').textContent = MUSIC.enabled ? '♫ Music on' : '♫ Music off';
    const st = { idle: S.hist.length ? 'Free play' : 'Solved', scrambling: 'Scrambling…', playing: 'Playing', won: 'Solved!', rewinding: 'Rewinding…', solving: 'Solving…' }[S.status];
    $('status').textContent = st;
    drawMap();
  }

  // ---------- pointer input on the cylinder ----------
  const cv = $('cyl');
  let drag = null;
  const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  cv.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const [x, y] = pt(e);
    const h = VIEW.hit(x, y, S);
    drag = { x0: x, y0: y, h, mode: null, view0: S.view, pitch0: S.pitch };
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    S.lastInput = performance.now(); S.viewAnim = null;
  });

  cv.addEventListener('pointermove', e => {
    const [x, y] = pt(e);
    if (!drag) {
      const h = VIEW.hit(x, y, S);
      const can = h && !busy() && P.canSlide(S.grid, h.r, h.c) && !auto();
      S.hover = can ? h : null;
      cv.style.cursor = can ? 'pointer' : h ? 'ew-resize' : 'grab';
      return;
    }
    const dx = x - drag.x0, dy = y - drag.y0;
    if (!drag.mode && Math.hypot(dx, dy) > 7) {
      if (drag.h && !busy() && !auto())
        drag.mode = Math.abs(dx) > Math.abs(dy) ? 'ring' : 'slide';
      else drag.mode = drag.h ? 'none' : 'view';
      S.hover = null;
    }
    if (drag.mode === 'ring') S.ring[drag.h.r] = dx / VIEW.G.R * DEG;
    else if (drag.mode === 'view') {
      S.view = drag.view0 - dx / VIEW.G.R * DEG;
      S.pitch = Math.max(4, Math.min(55, drag.pitch0 + dy * 0.25));
    }
    else if (drag.mode === 'slide' && Math.abs(dy) > 14) {
      const { r, c } = drag.h, g = P.gap(S.grid);
      if (g.c === c && g.r === r + Math.sign(dy)) slideAt(r, c);
      drag.mode = 'none';
    }
  });

  function endDrag() {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'ring') {
      const row = d.h.r, raw = Math.round(S.ring[row] / 60), m = P.ring(row, raw);
      if (S.status === 'won') S.status = 'idle';
      push({ m, target: raw * 60, kind: m.k ? 'play' : 'snap', dur: 160 + 40 * Math.min(3, Math.abs(raw)) });
    } else if (!d.mode && d.h) {
      slideAt(d.h.r, d.h.c);
    }
    S.lastInput = performance.now();
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', () => { if (!drag) S.hover = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); S.view += e.deltaY * 0.15; S.viewAnim = null; S.lastInput = performance.now(); }, { passive: false });

  // ---------- buttons and keys ----------
  $('scramble').onclick = scramble;
  $('undo').onclick = undo;
  $('rewind').onclick = rewind;
  $('solve').onclick = solveIt;
  $('hint').onclick = hint;
  $('vleft').onclick = () => rotateView(60);
  $('vright').onclick = () => rotateView(-60);
  $('sound').onclick = () => { SOUND.toggle(); ui(); };
  $('music').onclick = () => { MUSIC.toggle(); ui(); };
  // light / dark mode (the class is set before the first paint by a script in index.html)
  function toggleTheme() {
    const light = document.documentElement.classList.toggle('light');
    localStorage.setItem('day28.theme', light ? 'light' : 'dark');
    themeIcon();
  }
  function themeIcon() {
    const light = document.documentElement.classList.contains('light');
    $('theme').textContent = light ? '☾' : '☀';
    $('theme').title = light ? 'Dark mode (L)' : 'Light mode (L)';
  }
  $('theme').onclick = toggleTheme;
  themeIcon();
  $('help-btn').onclick = () => { $('help').hidden = !$('help').hidden; };
  $('help-close').onclick = () => { $('help').hidden = true; };
  $('win-again').onclick = () => { $('win').hidden = true; scramble(); };
  $('win-close').onclick = () => { $('win').hidden = true; };
  function closeOverlays() { $('help').hidden = true; $('win').hidden = true; }
  document.querySelectorAll('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.hidden = true; }));

  const ringKeys = { q: [0, -1], w: [0, 1], a: [1, -1], s: [1, 1], z: [2, -1], x: [2, 1] };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { closeOverlays(); return; }
    if (ringKeys[k]) turn(...ringKeys[k]);
    else if (k === 'arrowleft') rotateView(60);
    else if (k === 'arrowright') rotateView(-60);
    else if (k === 'arrowup' || k === 'arrowdown') {
      const g = P.gap(S.grid), r = g.r + (k === 'arrowup' ? 1 : -1);
      if (r >= 0 && r < 3) slideAt(r, g.c);
    }
    else if (k === 'n') scramble();
    else if (k === 'i') hint();
    else if (k === 'u' || k === 'backspace') undo();
    else if (k === 'm') { SOUND.toggle(); ui(); }
    else if (k === 'l') toggleTheme();
    else if (k === 'b') { MUSIC.toggle(); ui(); }
    else if (k === 'h' || k === '?') $('help').hidden = !$('help').hidden;
    else return;
    e.preventDefault();
  });

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(50, now - last); last = now;
    try {
      step(now);
      if (S.viewAnim) {
        const a = S.viewAnim, p = Math.min(1, (now - a.t0) / a.dur);
        S.view = a.from + (a.to - a.from) * ease(p);
        if (p >= 1) S.viewAnim = null;
      } else if (!drag && !busy()) {
        // slow showcase spin when solved and untouched, faster right after a win
        if (S.status === 'won') S.view += dt * 0.05;
        else if (S.status === 'idle' && !S.hist.length && now - S.lastInput > 4000) S.view += dt * 0.012;
      }
      S.view = ((S.view % 360) + 360) % 360;
      $('time').textContent = fmt(elapsed());
      if (Math.round(S.view / 60) !== frame.front) { frame.front = Math.round(S.view / 60); drawMap(); }
      // pulsing glow while the cylinder stays solved after a win or the computer's solve
      if (S.glowStart != null) {
        const t = (now - S.glowStart) / 1000;
        S.glow = Math.min(1, t / 0.8) * (0.6 + 0.4 * Math.sin(t * Math.PI * 0.8));   // one pulse every 2.5 s
      } else S.glow = 0;
      VIEW.draw(S);
    } catch (err) { console.error(err); }
  }

  window.addEventListener('resize', () => VIEW.resize());
  VIEW.init(cv, document.querySelector('.stage'));
  buildMap();
  const resumed = load();
  ui();
  if (resumed && S.status === 'playing') toast('Game resumed');
  else if (!S.hist.length) toast('Press Scramble to start');
  requestAnimationFrame(frame);

  window.APP = { S, scramble, undo, rewind, solve: solveIt, hint, turn, slideAt, rotateView, P };
})();
