// Interstellar's labyrinth: game states, rendering and input.
(() => {
  // Difficulty levels: maze size in rings, including the central cell (223, 463 and 895 cells)
  const LEVELS = {
    easy: { name: 'Easy', rings: 10 },
    medium: { name: 'Medium', rings: 15 },
    hard: { name: 'Hard', rings: 20 }
  };
  const STORE = 'oppd2026.day4.';
  const TIME_LIMIT = 60;     // seconds to escape
  const REVEAL_TIME = 1.2;   // maze reveal animation, the clock starts after it
  const MOVE_TIME = 0.075;   // sphere animation between two cells
  const REPEAT_DELAY = 0.17; // held key: delay before repeating, then one step every REPEAT_RATE
  const REPEAT_RATE = 0.085;
  const FOLLOW_RATE = 0.06;  // pointer drag: one step every FOLLOW_RATE while catching up with the pointer
  const MAX_REACH = 4;       // pointer drag: farthest cell (along the passages) the sphere walks to
  const TRIES = 24;          // mazes carved per draw, the hardest one is kept
  const MIN_DOT = 0.35;      // how well a passage must match the requested key direction
  const MSG_SIDE = 220;      // free width beside the maze needed to put the end-of-game box there
  const ALARM_TIME = 10;     // last seconds: the maze pulses red, one beat per clock tick
  const OUTSIDE = -1;        // pseudo cell beyond the exit gap
  const TAU = Math.PI * 2;

  // Palette: grey paper, ink, one accent
  const PAPER = '#e4e3df', DISC = '#f1f0ec', INK = '#1e1e20', SIDE = '#86847f', ACCENT = '#c8402f';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const header = document.getElementById('hud');
  const footer = document.getElementById('help');
  const timerEl = document.getElementById('timer');
  const recordEl = document.getElementById('record');
  const msgEl = document.getElementById('message');
  const msgText = document.getElementById('msg-text');
  const msgSub = document.getElementById('msg-sub');
  const againBtn = document.getElementById('again');
  const levelBtn = document.getElementById('change-level');
  const menuEl = document.getElementById('menu');
  const levelBtns = Array.from(document.querySelectorAll('[data-level]'));
  const bgLayer = document.createElement('canvas');
  const mazeLayer = document.createElement('canvas');

  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, unit = 1;
  const load = k => { try { return localStorage.getItem(STORE + k); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(STORE + k, v); } catch (e) { /* storage unavailable */ } };
  let level = LEVELS[load('level')] ? load('level') : 'medium';
  let rings = LEVELS[level].rings;
  let maze = null, state = 'menu', stateTime = 0, startTime = 0, endTime = 0;
  let player = { cell: 0, from: 0, t0: -1 }, trail = [0];
  let showSolution = false, lastTick = 0, nextStep = 0, msgBelow = false;
  const held = new Map(); // key code -> direction vector
  let pointer = null;     // {x, y} while the pointer is pressed on the canvas

  const now = () => performance.now() / 1000;
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  // ---- geometry ----
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    const top = header.offsetHeight + 6;
    const fit = bottom => {
      const avail = Math.min(W - 16, H - top - bottom);
      unit = Math.max(4, (avail / 2 - 10) / (rings + 1.3)); // room for the exit arrow
      cx = W / 2; cy = top + (H - top - bottom) / 2;
    };
    fit(footer.offsetHeight + 6);
    // End-of-game box with no room beside or below the maze: shrink the maze to make room below
    msgBelow = false;
    if (!msgEl.classList.contains('hidden')) {
      const box = msgEl.firstElementChild, R = (rings + 0.9) * unit;
      box.style.width = '';
      const h = box.offsetHeight + 16;
      if (W - (cx + R) < MSG_SIDE && H - footer.offsetHeight - (cy + R) < h) {
        fit(footer.offsetHeight + 6 + h);
        msgBelow = true;
      }
    }
    renderBackground();
    if (maze) renderMaze();
    placeMessage();
  }

  const xy = (r, a) => [cx + Math.cos(a) * r * unit, cy + Math.sin(a) * r * unit];

  function polar(id) {
    if (id === OUTSIDE) return { r: rings + 0.8, a: Maze.center(maze, maze.exit).a };
    return Maze.center(maze, id);
  }

  // Cell under a screen point (OUTSIDE just beyond the exit gap, null elsewhere outside).
  function cellAt(x, y) {
    const rr = Math.hypot(x - cx, y - cy) / unit;
    if (rr < 1) return 0;
    const a = ((Math.atan2(y - cy, x - cx) + Math.PI / 2) % TAU + TAU) % TAU;
    const ring = Math.floor(rr);
    if (ring >= rings) {
      const n = maze.size[rings - 1];
      return ring <= rings + 1 && Math.floor(a / TAU * n) === maze.index[maze.exit] ? OUTSIDE : null;
    }
    const n = maze.size[ring];
    return maze.first[ring] + Math.min(n - 1, Math.floor(a / TAU * n));
  }

  const neighbours = c => c === OUTSIDE ? [] : c === maze.exit ? maze.links[c].concat([OUTSIDE]) : maze.links[c];

  // ---- static layers, rendered once per resize / maze ----

  // Quiet grey paper: fine grain, a few faint concentric ripples around the
  // maze that fade out with distance, and a soft vignette.
  function renderBackground() {
    bgLayer.width = canvas.width; bgLayer.height = canvas.height;
    const g = bgLayer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H);

    // Grain: a small noise tile repeated over the page
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tg = tile.getContext('2d'), img = tg.createImageData(128, 128);
    for (let k = 0; k < img.data.length; k += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = Math.random() * 10;
    }
    tg.putImageData(img, 0, 0);
    g.fillStyle = g.createPattern(tile, 'repeat');
    g.fillRect(0, 0, W, H);

    const R = rings * unit, far = Math.hypot(W, H) / 2;
    g.lineWidth = 1;
    for (let k = 1; R + k * unit * 1.6 < far; k++) {
      const alpha = 0.07 * Math.pow(0.82, k);
      if (alpha < 0.006) break;
      g.strokeStyle = 'rgba(30,30,32,' + alpha.toFixed(4) + ')';
      g.beginPath(); g.arc(cx, cy, R + k * unit * 1.6 * (1 + k * 0.08), 0, TAU); g.stroke();
    }

    const vig = g.createRadialGradient(cx, cy, R, cx, cy, far * 1.1);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.07)');
    g.fillStyle = vig; g.fillRect(0, 0, W, H);
  }

  function traceWalls(g) {
    const m = maze;
    for (let id = 1; id < m.total; id++) {
      const r = m.ring[id], n = m.size[r], i = m.index[id];
      const a0 = Maze.angle(i, n), a1 = Maze.angle(i + 1, n);
      if (!Maze.isOpen(m, id, m.parent[id])) {
        g.moveTo(...xy(r, a0)); g.arc(cx, cy, r * unit, a0, a1);
      }
      if (!Maze.isOpen(m, id, m.cw[id])) {
        g.moveTo(...xy(r, a1)); g.lineTo(...xy(r + 1, a1));
      }
      if (r === rings - 1 && id !== m.exit) {
        g.moveTo(...xy(r + 1, a0)); g.arc(cx, cy, (r + 1) * unit, a0, a1);
      }
    }
  }

  // Disc with a polar chessboard of engraved (hatched) cells, walls in relief on top.
  function renderMaze() {
    mazeLayer.width = canvas.width; mazeLayer.height = canvas.height;
    const g = mazeLayer.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = rings * unit;

    g.save();
    g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = unit * 1.2; g.shadowOffsetY = unit * 0.35;
    g.fillStyle = DISC;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    g.restore();

    g.save();
    g.beginPath();
    for (let id = 1; id < maze.total; id++) {
      const r = maze.ring[id], n = maze.size[r], i = maze.index[id];
      if ((r + i) & 1) continue;
      const a0 = Maze.angle(i, n), a1 = Maze.angle(i + 1, n);
      g.moveTo(...xy(r, a0)); g.arc(cx, cy, r * unit, a0, a1);
      g.arc(cx, cy, (r + 1) * unit, a1, a0, true); g.closePath();
    }
    g.clip();
    g.fillStyle = 'rgba(0,0,0,0.035)'; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    g.strokeStyle = 'rgba(0,0,0,0.11)'; g.lineWidth = 0.7;
    g.beginPath();
    const gap = Math.max(3, unit * 0.2);
    for (let d = -2 * R; d < 2 * R; d += gap) { g.moveTo(cx + d - R, cy + R); g.lineTo(cx + d + R, cy - R); }
    g.stroke();
    g.restore();

    g.lineCap = 'round'; g.lineJoin = 'round';
    const w = Math.max(2, unit * 0.17), depth = Math.max(1.5, unit * 0.13);
    g.beginPath(); traceWalls(g);
    g.save();                              // soft cast shadow
    g.translate(depth * 1.2, depth * 2);
    g.strokeStyle = 'rgba(0,0,0,0.1)'; g.lineWidth = w * 1.6; g.stroke();
    g.restore();
    g.save();                              // extruded side
    g.translate(0, depth);
    g.strokeStyle = SIDE; g.lineWidth = w; g.stroke();
    g.restore();
    g.strokeStyle = INK; g.lineWidth = w; g.stroke(); // top face
  }

  // ---- game states ----
  function newMaze() {
    maze = Maze.generate(rings, TRIES);
    menuEl.classList.add('hidden');
    state = 'reveal'; stateTime = now();
    player = { cell: 0, from: 0, t0: -1 };
    trail = [0];
    showSolution = false; lastTick = 0; nextStep = 0;
    msgEl.classList.add('hidden');
    resize(); // renders the maze, at full size again if the box had shrunk it
    timerEl.classList.remove('low');
    showRecord();
    Sfx.start();
  }

  // Current record of the level under the timer, nothing when there is none yet.
  function showRecord() {
    const best = parseFloat(load('best.' + level));
    recordEl.textContent = isNaN(best) ? '' : 'Record (' + LEVELS[level].name + '): ' + best.toFixed(1) + ' s';
  }

  function showMenu() {
    state = 'menu';
    maze = null;
    held.clear(); pointer = null;
    msgEl.classList.add('hidden');
    for (const b of levelBtns) b.classList.toggle('current', b.dataset.level === level);
    menuEl.classList.remove('hidden');
    recordEl.textContent = '';
    resize();
  }

  function startLevel(name) {
    level = name;
    rings = LEVELS[name].rings;
    save('level', name);
    newMaze();
  }

  function finish(won, t) {
    state = won ? 'win' : 'lose';
    endTime = t;
    if (won) {
      const time = endTime - startTime;
      let best = parseFloat(load('best.' + level));
      if (!(best <= time)) { best = time; save('best.' + level, time.toFixed(1)); }
      msgText.textContent = 'You escaped in ' + time.toFixed(1) + ' s.';
      msgSub.textContent = 'Best time (' + LEVELS[level].name + '): ' + best.toFixed(1) + ' s';
      showRecord();
      Sfx.win();
    } else {
      showSolution = true;
      msgText.textContent = "You didn't exit the labyrinth";
      const pct = Math.floor(100 * progress() / maze.solution.length);
      msgSub.textContent = 'You lose, draw another one.\nYou covered ' + pct + '% of the right path.';
      Sfx.lose();
    }
    msgEl.classList.remove('hidden');
    resize();
  }

  // Put the end-of-game box in free space: beside the maze on wide screens,
  // below it otherwise (resize() makes room there when needed).
  function placeMessage() {
    if (msgEl.classList.contains('hidden')) return;
    const box = msgEl.firstElementChild, gap = 16;
    const R = (rings + 0.9) * unit;
    const side = W - (cx + R);
    box.style.width = '';
    let left, top;
    if (!msgBelow && side >= MSG_SIDE) {
      const w = Math.min(320, side - 2 * gap);
      box.style.width = w + 'px';
      left = cx + R + (side - w) / 2;
      top = cy - box.offsetHeight / 2;
    } else {
      const w = box.offsetWidth, h = box.offsetHeight;
      const below = H - footer.offsetHeight - (cy + R);
      left = (W - w) / 2;
      top = cy + R + Math.max(0, (below - h) / 2);
    }
    msgEl.style.left = Math.round(left) + 'px';
    msgEl.style.top = Math.round(Math.max(gap, top)) + 'px';
  }

  function timeLeft(t) {
    if (state === 'reveal') return TIME_LIMIT;
    const end = state === 'play' ? t : endTime;
    return Math.max(0, TIME_LIMIT - (end - startTime));
  }

  // Steps along the right path covered by the current position: the trail and the
  // solution both start at the centre, the progress is their common prefix. It is
  // what the screen shows (the red trail over the dashed solution), so a stretch
  // of the right path explored and then abandoned does not count. The total is
  // solution.length steps: centre -> exit cell, plus the step out through the gap.
  function progress() {
    let k = 0;
    while (k < trail.length && k < maze.solution.length && trail[k] === maze.solution[k]) k++;
    return k - 1;
  }

  function moveTo(n, t) {
    player = { cell: n, from: player.cell, t0: t };
    // The maze is a tree, so the trail is always the unique path from the centre
    if (trail.length >= 2 && trail[trail.length - 2] === n) trail.pop();
    else trail.push(n);
    if (n === OUTSIDE) { state = 'escaping'; endTime = t; }
    else Sfx.step();
  }

  // Keys: the open neighbour whose direction on screen best matches dir.
  function stepByDir(dir) {
    const p = polar(player.cell), [px, py] = xy(p.r, p.a);
    let best = null, bestDot = MIN_DOT;
    for (const n of neighbours(player.cell)) {
      const q = polar(n), [qx, qy] = xy(q.r, q.a);
      const len = Math.hypot(qx - px, qy - py) || 1;
      const dot = ((qx - px) * dir[0] + (qy - py) * dir[1]) / len;
      if (dot > bestDot) { bestDot = dot; best = n; }
    }
    return best;
  }

  // Pointer: first step along the passages towards the target cell, if it is
  // at most MAX_REACH cells away (so a drag can't cut through walls or solve the maze).
  function stepToward(target) {
    const start = player.cell;
    if (target === null || target === start) return null;
    const prev = new Map([[start, null]]);
    let frontier = [start];
    for (let d = 0; d < MAX_REACH && frontier.length; d++) {
      const next = [];
      for (const c of frontier) {
        for (const n of neighbours(c)) {
          if (prev.has(n)) continue;
          prev.set(n, c);
          if (n === target) {
            let s = n;
            while (prev.get(s) !== start) s = prev.get(s);
            return s;
          }
          next.push(n);
        }
      }
      frontier = next;
    }
    return null;
  }

  function keyDir() {
    let dx = 0, dy = 0;
    for (const v of held.values()) { dx += v[0]; dy += v[1]; }
    const len = Math.hypot(dx, dy);
    return len > 0 ? [dx / len, dy / len] : null;
  }

  function update(t) {
    if (state === 'reveal' && t - stateTime >= REVEAL_TIME) { state = 'play'; startTime = t; }
    if (state === 'play') {
      const left = TIME_LIMIT - (t - startTime);
      if (left <= 0) { finish(false, startTime + TIME_LIMIT); return; }
      const sec = Math.ceil(left);
      if (sec <= ALARM_TIME && sec !== lastTick) { lastTick = sec; Sfx.tick(sec); }
      if (t >= nextStep) {
        if (pointer) {
          const n = stepToward(cellAt(pointer.x, pointer.y));
          if (n !== null) { moveTo(n, t); nextStep = t + FOLLOW_RATE; }
        } else {
          const dir = keyDir(), n = dir && stepByDir(dir);
          if (n !== null && n !== undefined) moveTo(n, t);
          if (dir) nextStep = t + REPEAT_RATE;
        }
      }
    }
    if (state === 'escaping' && t - player.t0 >= MOVE_TIME * 2) finish(true, endTime);
  }

  // ---- drawing ----
  function drawLayers(t) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgLayer, 0, 0);
    if (state === 'reveal') {
      const k = 1 - Math.pow(1 - clamp01((t - stateTime) / REVEAL_TIME), 3);
      ctx.beginPath();
      ctx.arc(cx * dpr, cy * dpr, k * (rings + 1) * unit * dpr, 0, TAU);
      ctx.clip();
    }
    if (maze) ctx.drawImage(mazeLayer, 0, 0);
    ctx.restore();
  }

  // The start: an isometric cube.
  function drawCenter() {
    const s = unit * 0.55, hw = s * Math.sqrt(3) / 2, x = cx, y = cy;
    const faces = [
      [[x, y - s, x + hw, y - s / 2, x, y, x - hw, y - s / 2], '#f7f6f2'],
      [[x - hw, y - s / 2, x, y, x, y + s, x - hw, y + s / 2], '#a9a7a2'],
      [[x + hw, y - s / 2, x, y, x, y + s, x + hw, y + s / 2], '#55534f']
    ];
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(1, unit * 0.05);
    for (const [p, c] of faces) {
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
      ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.stroke();
    }
  }

  // The exit: an accent arrow just beyond the gap in the outer wall.
  function drawExit(t) {
    const a = Maze.center(maze, maze.exit).a;
    const r = rings + 0.35 + 0.12 * (0.5 + 0.5 * Math.sin(t * 4));
    const ux = Math.cos(a), uy = Math.sin(a), s = unit * 0.38;
    const [x, y] = xy(r, a);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(x + ux * s, y + uy * s);
    ctx.lineTo(x - uy * s * 0.8, y + ux * s * 0.8);
    ctx.lineTo(x + uy * s * 0.8, y - ux * s * 0.8);
    ctx.closePath(); ctx.fill();
  }

  // Path through cell centres: arcs along a ring, straight lines between rings.
  function tracePath(ids) {
    ctx.beginPath();
    let p = polar(ids[0]);
    ctx.moveTo(...xy(p.r, p.a));
    for (let k = 1; k < ids.length; k++) {
      const q = polar(ids[k]);
      if (q.r === p.r && p.r > 0) {
        const d = wrap(q.a - p.a);
        ctx.arc(cx, cy, p.r * unit, p.a, p.a + d, d < 0);
      } else {
        ctx.lineTo(...xy(q.r, q.a));
      }
      p = q;
    }
  }

  function drawPaths() {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (showSolution) {
      tracePath(maze.solution.concat([OUTSIDE]));
      ctx.setLineDash([unit * 0.3, unit * 0.3]);
      ctx.strokeStyle = 'rgba(30,30,32,0.75)';
      ctx.lineWidth = Math.max(1.5, unit * 0.1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (trail.length > 1) {
      tracePath(trail);
      ctx.strokeStyle = ACCENT;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(1.5, unit * 0.11);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // The player: a reflecting sphere with its contact shadow.
  function drawPlayer(t) {
    const k = player.t0 < 0 ? 1 : clamp01((t - player.t0) / MOVE_TIME);
    const a = polar(player.from), b = polar(player.cell);
    const from = a.r === 0 ? b.a : a.a;
    const ang = from + wrap(b.a - from) * k;
    const [x, y] = xy(a.r + (b.r - a.r) * k, ang);
    const r = unit * 0.33;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.8, r * 0.9, r * 0.35, 0, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, '#b9b8b4');
    g.addColorStop(0.7, '#3a3a3c');
    g.addColorStop(1, '#0e0e10');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // Time running out: a soft red tint on the disc (multiplied, so the ink stays
  // black) plus a faint halo, beating with the clock and stronger near the end.
  function drawAlarm(t) {
    if (state !== 'play') return;
    const left = timeLeft(t);
    if (left > ALARM_TIME) return;
    const beat = Math.pow(left - Math.floor(left), 2.5); // peak on each tick, then fade
    const a = beat * (0.1 + 0.12 * (1 - left / ALARM_TIME));
    const R = rings * unit;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const tint = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, R);
    tint.addColorStop(0, 'rgba(200,64,47,0)');
    tint.addColorStop(1, 'rgba(200,64,47,' + a.toFixed(3) + ')');
    ctx.fillStyle = tint;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const halo = ctx.createRadialGradient(cx, cy, R, cx, cy, R + unit * 1.2);
    halo.addColorStop(0, 'rgba(200,64,47,' + (a * 0.9).toFixed(3) + ')');
    halo.addColorStop(1, 'rgba(200,64,47,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R + unit * 1.2, 0, TAU); ctx.arc(cx, cy, R, 0, TAU, true); ctx.fill();
    ctx.restore();
  }

  function drawTimer(t) {
    const left = timeLeft(t);
    timerEl.textContent = state === 'menu' ? '' : left.toFixed(1);
    timerEl.classList.toggle('low', left <= ALARM_TIME && state !== 'win');
  }

  function frame() {
    const t = now();
    update(t);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLayers(t);
    drawAlarm(t);
    if (maze) {
      if (state !== 'reveal') {
        drawPaths();
        drawExit(t);
      }
      drawCenter();
      drawPlayer(t);
    }
    drawTimer(t);
    requestAnimationFrame(frame);
  }

  // ---- input ----
  const KEYS = {
    ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
    ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0]
  };

  const LEVEL_KEYS = { Digit1: 'easy', Digit2: 'medium', Digit3: 'hard', Numpad1: 'easy', Numpad2: 'medium', Numpad3: 'hard' };

  window.addEventListener('keydown', e => {
    Sfx.init();
    if (e.target.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space')) return; // the button's click handles it
    if (state === 'menu') {
      if (LEVEL_KEYS[e.code]) startLevel(LEVEL_KEYS[e.code]);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') startLevel(level);
      else if (e.code === 'KeyM') footer.classList.toggle('muted', Sfx.toggle());
      return;
    }
    if (e.code === 'Escape') { showMenu(); return; }
    if (e.shiftKey && e.code === 'KeyS') { if (state !== 'reveal') showSolution = !showSolution; return; }
    if (e.shiftKey && e.code === 'KeyT') {
      if (state === 'play') startTime = Math.min(startTime, now() - (TIME_LIMIT - 5));
      return;
    }
    if (KEYS[e.code]) {
      e.preventDefault();
      if (!e.repeat) {
        held.set(e.code, KEYS[e.code]);
        // Step right away, then repeat after a longer first delay
        const t = now(), n = state === 'play' ? stepByDir(keyDir()) : null;
        if (n !== null) moveTo(n, t);
        nextStep = t + REPEAT_DELAY;
      }
      return;
    }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyN') && !e.repeat) {
      e.preventDefault();
      newMaze();
    } else if (e.code === 'KeyM') {
      footer.classList.toggle('muted', Sfx.toggle());
    }
  });
  window.addEventListener('keyup', e => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); pointer = null; });

  canvas.addEventListener('pointerdown', e => {
    Sfx.init();
    canvas.setPointerCapture(e.pointerId);
    pointer = { x: e.clientX, y: e.clientY };
    nextStep = 0;
  });
  canvas.addEventListener('pointermove', e => { if (pointer) pointer = { x: e.clientX, y: e.clientY }; });
  const release = () => { pointer = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  againBtn.addEventListener('click', () => { Sfx.init(); againBtn.blur(); newMaze(); });
  levelBtn.addEventListener('click', () => { levelBtn.blur(); showMenu(); });
  for (const b of levelBtns) b.addEventListener('click', () => { Sfx.init(); b.blur(); startLevel(b.dataset.level); });
  window.addEventListener('resize', resize);

  showMenu();
  requestAnimationFrame(frame);
})();
