// Perfect Twist: puzzle state and rules. No DOM, so it also loads in Node for tests.
// The cylinder is a grid of 3 rings (rows, top to bottom) x 6 columns.
// Each cell holds a colour index (0-5) or GAP. There are 17 tiles: three of each
// colour except white, which has two, so exactly one cell is empty.
const PUZZLE = (() => {
  const ROWS = 3, COLS = 6, GAP = -1;
  const COLOURS = [
    { name: 'Red', hex: '#d8262b' },
    { name: 'Orange', hex: '#ff6b1c' },
    { name: 'Yellow', hex: '#f8d824' },
    { name: 'Green', hex: '#1fbf4a' },
    { name: 'Blue', hex: '#2ba3e6' },
    { name: 'White', hex: '#f1ede2' },
  ];
  const WHITE = 5;
  const mod = (n, m = COLS) => ((n % m) + m) % m;
  // Ring steps normalised to -2..3 (a half turn counts as 3 steps).
  const norm = k => { k = mod(k); return k > 3 ? k - 6 : k; };

  // Solved cylinder: column c is colour c, the white column has its gap at the top.
  function solved() {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      g.push([]);
      for (let c = 0; c < COLS; c++) g[r].push(c);
    }
    g[0][WHITE] = GAP;
    return g;
  }

  const clone = g => g.map(row => row.slice());

  function gap(g) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (g[r][c] === GAP) return { r, c };
    return null;
  }

  // A tile can slide if the gap is right above or below it in the same column.
  function canSlide(g, r, c) {
    if (g[r][c] === GAP) return false;
    const h = gap(g);
    return h.c === c && Math.abs(h.r - r) === 1;
  }

  // Moves: { t: 'r', row, k } turns a ring by k * 60 degrees (tile in column c goes to c + k);
  //        { t: 's', c, r, to } slides the tile at (r, c) into the gap at (to, c).
  const ring = (row, k) => ({ t: 'r', row, k: norm(k) });
  function slideMove(g, r, c) { return { t: 's', c, r, to: gap(g).r }; }

  function apply(g, m) {
    if (m.t === 'r') {
      const old = g[m.row].slice();
      for (let c = 0; c < COLS; c++) g[m.row][mod(c + m.k)] = old[c];
    } else {
      g[m.to][m.c] = g[m.r][m.c];
      g[m.r][m.c] = GAP;
    }
    return g;
  }

  const inverse = m => m.t === 'r' ? ring(m.row, -m.k) : { t: 's', c: m.c, r: m.to, to: m.r };

  // Move count: every 60-degree step of a ring is one move, every slide is one move.
  const cost = m => m.t === 'r' ? Math.abs(m.k) : 1;

  // Solved when every column holds a single colour (rings may be at any angle).
  function isSolved(g) {
    for (let c = 0; c < COLS; c++) {
      let col = null;
      for (let r = 0; r < ROWS; r++) {
        const v = g[r][c];
        if (v === GAP) continue;
        if (col === null) col = v; else if (v !== col) return false;
      }
    }
    return true;
  }

  // How many tiles already sit in a column with two or more tiles of their colour (for scramble quality).
  function order(g) {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      const cnt = {};
      for (let r = 0; r < ROWS; r++) if (g[r][c] !== GAP) cnt[g[r][c]] = (cnt[g[r][c]] || 0) + 1;
      for (const k in cnt) if (cnt[k] > 1) n += cnt[k];
    }
    return n;
  }

  // Random legal moves from grid g (not changed). Never undoes the previous move,
  // never turns the same ring twice in a row. Retries until the result looks well mixed.
  function scramble(g, n = 40, rand = Math.random) {
    for (let tries = 0; tries < 50; tries++) {
      const s = clone(g), list = [];
      let prev = null;
      while (list.length < n) {
        let m;
        if (rand() < 0.55) {
          const row = Math.floor(rand() * ROWS);
          if (prev && prev.t === 'r' && prev.row === row) continue;
          m = ring(row, [-2, -1, 1, 2, 3][Math.floor(rand() * 5)]);
        } else {
          const h = gap(s), opts = [h.r - 1, h.r + 1].filter(r => r >= 0 && r < ROWS);
          const r = opts[Math.floor(rand() * opts.length)];
          if (prev && prev.t === 's' && prev.r === h.r && prev.to === r) continue;
          m = slideMove(s, r, h.c);
        }
        apply(s, m); list.push(m); prev = m;
      }
      if (!isSolved(s) && order(s) <= 4) return list;
    }
    return [ring(0, 1), ring(1, 2)];
  }

  // ---------- solver ----------
  // Distance from solved, ignoring how the rings are turned: try every relative turn of
  // rings 1 and 2 against ring 0 and score each column (3 = one colour, 2 = a pair, 1 = mixed).
  // The gap counts as white. Returns 0 when solved.
  function unsolved(s) {
    let best = 0;
    for (let o1 = 0; o1 < 6; o1++) for (let o2 = 0; o2 < 6; o2++) {
      let sc = 0;
      for (let c = 0; c < 6; c++) {
        let a = s[c], b = s[6 + (c + o1) % 6], d = s[12 + (c + o2) % 6];
        if (a < 0) a = WHITE; if (b < 0) b = WHITE; if (d < 0) d = WHITE;
        sc += (a === b && b === d) ? 3 : (a === b || a === d || b === d) ? 2 : 1;
      }
      if (sc > best) { best = sc; if (sc === 18) return 0; }
    }
    return 18 - best;
  }

  // Beam search. One step = turn a ring next to the gap (0-5 notches) and slide the tile
  // now beside the gap into it. States that differ only by turning the whole cylinder are merged.
  function beam(grid, width, maxSteps = 60) {
    const s0 = grid.flat();
    if (!unsolved(s0)) return { s: s0, p: null };
    const key = (s, g) => { let k = ''; for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) k += String.fromCharCode(66 + s[r * 6 + (c + g) % 6]); return k; };
    const seen = new Set();
    let front = [{ s: s0, p: null }];
    for (let d = 0; d < maxSteps && front.length; d++) {
      const next = [];
      for (const n of front) {
        const gi = n.s.indexOf(GAP), gr = (gi / 6) | 0, gc = gi % 6;
        for (const ar of [gr - 1, gr + 1]) {
          if (ar < 0 || ar >= ROWS) continue;
          for (let k = 0; k < 6; k++) {
            const s = n.s.slice();
            for (let c = 0; c < 6; c++) s[ar * 6 + (c + k) % 6] = n.s[ar * 6 + c];
            s[gr * 6 + gc] = s[ar * 6 + gc]; s[ar * 6 + gc] = GAP;
            const kk = key(s, gc);
            if (seen.has(kk)) continue;
            seen.add(kk);
            const node = { s, p: n, step: { row: ar, k, c: gc, to: gr }, h: unsolved(s) };
            if (!node.h) return node;
            next.push(node);
          }
        }
      }
      next.sort((a, b) => a.h - b.h);
      front = next.slice(0, width);
    }
    return null;
  }

  // Moves that solve grid g (not changed), ending with the rings aligned; null if not found.
  function solve(g) {
    let end = null;
    for (const w of [400, 2000, 8000]) if ((end = beam(g, w))) break;
    if (!end) return null;
    const steps = [];
    for (let n = end; n.p; n = n.p) steps.unshift(n.step);
    const moves = [];
    for (const st of steps) {
      if (st.k) moves.push(ring(st.row, st.k));
      moves.push({ t: 's', c: st.c, r: st.row, to: st.to });
    }
    // Align rings 1 and 2 with ring 0.
    const s = end.s;
    for (let o1 = 0; o1 < 6; o1++) for (let o2 = 0; o2 < 6; o2++) {
      const t = s.slice(0, 6);
      for (let c = 0; c < 6; c++) t.push(s[6 + (c + o1) % 6]);
      for (let c = 0; c < 6; c++) t.push(s[12 + (c + o2) % 6]);
      if (isSolved([t.slice(0, 6), t.slice(6, 12), t.slice(12)])) {
        if (o1) moves.push(ring(1, -o1));
        if (o2) moves.push(ring(2, -o2));
        return moves;
      }
    }
    return moves;
  }

  return { ROWS, COLS, GAP, COLOURS, WHITE, mod, norm, solved, clone, gap, canSlide, ring, slideMove, apply, inverse, cost, isSolved, order, scramble, solve };
})();

if (typeof module !== 'undefined') module.exports = PUZZLE;
