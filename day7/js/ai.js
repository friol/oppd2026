// Computer player: negamax with alpha-beta pruning. Hard searches the whole
// classic game (minimax, never loses); the lower levels look ahead less and blunder.
'use strict';

const AI = (() => {
  const G = typeof Game !== 'undefined' ? Game : require('./game.js');
  const WIN = 100;                            // minus the ply: faster wins score higher
  const ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7];  // center, corners, edges: better pruning

  // depth = plies of look-ahead (2 = sees its own wins and the opponent's threats),
  // blunder = chance of a random move instead.
  const LEVELS = {
    easy:   { depth: 1, blunder: 0.35 },
    medium: { depth: 2, blunder: 0.08 },
    hard:   { depth: { classic: 9, vanish: 10 }, blunder: 0 },
  };

  // Best score for the player to move in s. Beyond the horizon a position counts as even.
  function value(s, depth, ply, a, b) {
    if (depth === 0) return 0;
    let best = -Infinity;
    for (const m of ORDER) {
      if (s.board[m]) continue;
      const t = G.play(s, m).state;
      const v = G.winner(t.board) ? WIN - ply : -value(t, depth - 1, ply + 1, -b, -a);
      if (v > best) best = v;
      if (best > a) a = best;
      if (a >= b) break;
    }
    return best === -Infinity ? 0 : best;  // full board: draw
  }

  // Exact score of every legal move (full window for each).
  function rate(s, depth) {
    return G.free(s).map(cell => {
      const t = G.play(s, cell).state;
      const v = G.winner(t.board) ? WIN - 1 : -value(t, depth - 1, 2, -Infinity, Infinity);
      return { cell, v };
    });
  }

  function choose(s, level, rnd = Math.random) {
    const L = LEVELS[level] || LEVELS.hard;
    const moves = G.free(s);
    if (rnd() < L.blunder) return moves[Math.floor(rnd() * moves.length)];
    const depth = typeof L.depth === 'object' ? L.depth[s.mode] : L.depth;
    const rated = rate(s, depth);
    const top = Math.max(...rated.map(r => r.v));
    const best = rated.filter(r => r.v === top);  // ties at random, for variety
    return best[Math.floor(rnd() * best.length)].cell;
  }

  return { LEVELS, WIN, rate, choose };
})();

if (typeof module !== 'undefined') module.exports = AI;
