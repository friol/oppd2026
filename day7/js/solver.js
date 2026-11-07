// Exact solution of the vanish mode by retrograde analysis: the game has a
// finite number of positions (146 900), so every one gets its true value with
// perfect play from both sides. Used for the hints. Loads in Node too.
'use strict';

const Solver = (() => {
  const G = typeof Game !== 'undefined' ? Game : require('./game.js');
  const WIN = 1, LOSS = -1, DRAW = 0;  // for the player to move

  let index = null;  // key -> position number
  let states, val, dist, succ, start, moveOf;

  // Visit every position reachable from the two openings, with its moves.
  function enumerate() {
    index = new Map();
    states = [];
    const q = [];
    const add = s => {
      const k = G.key(s);
      let i = index.get(k);
      if (i === undefined) { i = states.length; index.set(k, i); states.push(s); q.push(i); }
      return i;
    };
    add(G.create('vanish', G.X));
    add(G.create('vanish', G.O));
    const lists = [];
    for (let h = 0; h < q.length; h++) {
      const i = q[h], s = states[i], list = [];
      if (!G.winner(s.board)) for (const c of G.free(s)) list.push(c, add(G.play(s, c).state));
      lists[i] = list;
    }
    // Moves in flat arrays: (cell, successor) pairs of position i in [start[i], start[i+1]).
    const n = states.length;
    start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + lists[i].length / 2;
    succ = new Int32Array(start[n]);
    moveOf = new Int8Array(start[n]);
    for (let i = 0; i < n; i++) {
      const l = lists[i];
      for (let m = 0; m < l.length / 2; m++) { moveOf[start[i] + m] = l[2 * m]; succ[start[i] + m] = l[2 * m + 1]; }
    }
  }

  // Rounds of resolution: in round k the positions decided in exactly k plies.
  // A win takes the fastest route, a loss the slowest; what never resolves is a draw.
  function solve() {
    if (val) return;
    enumerate();
    const n = states.length;
    val = new Int8Array(n);
    dist = new Uint8Array(n);
    const done = new Uint8Array(n);
    let open = [];
    for (let i = 0; i < n; i++) {
      if (G.winner(states[i].board)) { val[i] = LOSS; done[i] = 1; }  // the previous move won
      else open.push(i);
    }
    for (let round = 1; open.length; round++) {
      const decided = [], rest = [];
      for (const i of open) {
        let allWin = true, v = 0;
        for (let m = start[i]; m < start[i + 1]; m++) {
          const t = succ[m];
          if (done[t] && val[t] === LOSS) { v = WIN; break; }
          if (!done[t] || val[t] !== WIN) allWin = false;
        }
        if (!v && allWin) v = LOSS;
        if (v) decided.push(i, v); else rest.push(i);
      }
      if (!decided.length) break;
      for (let k = 0; k < decided.length; k += 2) {
        const i = decided[k];
        val[i] = decided[k + 1];
        dist[i] = round;
        done[i] = 1;
      }
      open = rest;
    }
    for (const i of open) val[i] = DRAW;
  }

  // The best moves for the player to move, with the value of the position:
  // { value: 1 | 0 | -1, plies (to the end, for wins and losses), cells: [...] }.
  function advise(s) {
    solve();
    const i = index.get(G.key(s));
    if (i === undefined) return null;
    const v = val[i], cells = [];
    for (let m = start[i]; m < start[i + 1]; m++) {
      const t = succ[m];
      const ok = v === WIN ? val[t] === LOSS && dist[t] === dist[i] - 1
        : v === DRAW ? val[t] === DRAW
        : dist[t] === dist[i] - 1;  // lost anyway: resist as long as possible
      if (ok) cells.push(moveOf[m]);
    }
    return { value: v, plies: dist[i], cells };
  }

  return { WIN, LOSS, DRAW, solve, advise, get ready() { return !!val; } };
})();

if (typeof module !== 'undefined') module.exports = Solver;
