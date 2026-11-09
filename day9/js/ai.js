// Computer player: negamax with alpha-beta and a transposition table. Forced
// moves cost no depth and captures are always searched to the end, so the
// horizon never cuts an exchange in half. The search knows the portals and
// the trap (Rules.apply), not when they will shift next.
'use strict';

const AI = (() => {
  const R = typeof Rules !== 'undefined' ? Rules : require('./rules.js');
  const WIN = 100000, MAX_PLY = 64;

  // easy: two plies, sloppy picks and frequent random moves.
  // medium: four plies, mostly the best move.
  // hard: iterative deepening for `time` ms, always the best move found.
  const LEVELS = {
    easy: { depth: 2, margin: 60, random: 0.25 },
    medium: { depth: 4, margin: 12, random: 0.04 },
    hard: { time: 900, maxDepth: 40 },
  };

  // Advancement bonus for men by rows travelled, and a small center bonus.
  const ADV = [0, 1, 3, 6, 10, 16, 24, 0];
  const CENTER = [0, 1, 3, 4, 4, 3, 1, 0];
  const MAN_V = 100, KING_V = 300;

  function evaluate(b, side) {
    let s = 0, w = 0, k = 0, wMat = 0, bMat = 0;
    const wk = [], bk = [], wp = [], bp = [];
    for (const i of R.DARK) {
      const p = b[i];
      if (!p) continue;
      const r = i >> 3, c = i & 7;
      if (p === 1) { s += MAN_V + ADV[7 - r] + CENTER[c] + (r === 7 ? 5 : 0); wMat += MAN_V; wp.push(i); }
      else if (p === -1) { s -= MAN_V + ADV[r] + CENTER[c] + (r === 0 ? 5 : 0); bMat += MAN_V; bp.push(i); }
      else if (p === 2) { s += KING_V + 2 * (CENTER[r] + CENTER[c]); wMat += KING_V; wk.push(i); wp.push(i); }
      else { s -= KING_V + 2 * (CENTER[r] + CENTER[c]); bMat += KING_V; bk.push(i); bp.push(i); }
    }
    const total = wp.length + bp.length;
    // When ahead, trade down; in the endgame the leader's kings hunt.
    if (wMat !== bMat) {
      s += (wMat - bMat) * (24 - total) / 60;
      if (total <= 10) {
        const lead = wMat > bMat ? 1 : -1;
        const hunters = lead > 0 ? wk : bk, prey = lead > 0 ? bp : wp;
        for (const h of hunters) {
          let d = 8;
          for (const q of prey) d = Math.min(d, Math.max(Math.abs((h >> 3) - (q >> 3)), Math.abs((h & 7) - (q & 7))));
          s -= lead * 4 * d;
        }
      }
    }
    return s * side;
  }

  // Zobrist hashing: two 32-bit keys (index and check).
  const Z1 = new Int32Array(64 * 5), Z2 = new Int32Array(64 * 5);
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; };
  for (let i = 0; i < Z1.length; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  const TT_BITS = 18, TT_MASK = (1 << TT_BITS) - 1;
  const ttCheck = new Int32Array(1 << TT_BITS), ttDepth = new Int8Array(1 << TT_BITS);
  const ttScore = new Int32Array(1 << TT_BITS), ttFlag = new Int8Array(1 << TT_BITS), ttBest = new Int8Array(1 << TT_BITS);
  const EXACT = 1, LOWER = 2, UPPER = 3;

  let SP = null, deadline = 0, nodes = 0;
  const ABORT = {};
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function negamax(b, side, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && deadline && now() > deadline) throw ABORT;
    const moves = R.moves(b, side);
    if (!moves.length) return -WIN + ply;
    if (ply >= MAX_PLY) return evaluate(b, side);
    if (depth <= 0 && !moves[0].caps.length) return evaluate(b, side);

    let h1 = side > 0 ? 0x5bd1e995 : 0, h2 = side > 0 ? 0x1b873593 : 0;
    for (const i of R.DARK) if (b[i]) { const z = i * 5 + b[i] + 2; h1 ^= Z1[z]; h2 ^= Z2[z]; }
    const slot = h1 & TT_MASK;
    let first = -1;
    if (ttCheck[slot] === h2 && ttFlag[slot]) {
      if (ttDepth[slot] >= depth) {
        const v = ttScore[slot], f = ttFlag[slot];
        if (f === EXACT) return v;
        if (f === LOWER && v >= beta) return v;
        if (f === UPPER && v <= alpha) return v;
      }
      first = ttBest[slot];
    }
    if (first > 0 && first < moves.length) [moves[0], moves[first]] = [moves[first], moves[0]];

    const next = moves.length === 1 ? depth : depth - 1;  // forced moves are free
    const a0 = alpha;
    let best = -Infinity, bestI = 0;
    for (let i = 0; i < moves.length; i++) {
      const v = -negamax(R.apply(b, moves[i], SP), -side, next, -beta, -alpha, ply + 1);
      if (v > best) { best = v; bestI = i; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (first > 0 && first < moves.length) bestI = bestI === 0 ? first : bestI === first ? 0 : bestI;
    ttCheck[slot] = h2;
    ttDepth[slot] = Math.max(-100, Math.min(100, depth));
    ttScore[slot] = best;
    ttFlag[slot] = best <= a0 ? UPPER : best >= beta ? LOWER : EXACT;
    ttBest[slot] = bestI;
    return best;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Scores of every root move with a full window (easy, medium).
  function rate(b, side, sp, depth) {
    SP = sp; deadline = 0; ttFlag.fill(0);
    const moves = R.moves(b, side);
    return moves.map(m => ({ m, v: -negamax(R.apply(b, m, sp), -side, depth - 1, -Infinity, Infinity, 1) }));
  }

  function choose(b, side, sp, levelName) {
    const L = LEVELS[levelName] || LEVELS.medium;
    const moves = shuffle(R.moves(b, side));
    if (moves.length <= 1) return moves[0] || null;
    if (!L.time) {
      if (Math.random() < L.random) return moves[0];
      const rated = rate(b, side, sp, L.depth);
      const top = Math.max(...rated.map(x => x.v));
      const ok = rated.filter(x => x.v >= top - L.margin);
      return ok[Math.floor(Math.random() * ok.length)].m;
    }
    // Hard: iterative deepening, best move of the last finished iteration.
    SP = sp; nodes = 0; ttFlag.fill(0);
    deadline = now() + L.time;
    let order = moves, best = moves[0];
    try {
      for (let d = 1; d <= L.maxDepth; d++) {
        let alpha = -Infinity, bestV = -Infinity, bestM = order[0];
        const scored = [];
        for (const m of order) {
          const v = -negamax(R.apply(b, m, sp), -side, d - 1, -Infinity, -alpha, 1);
          scored.push({ m, v });
          if (v > bestV) { bestV = v; bestM = m; }
          if (v > alpha) alpha = v;
        }
        best = bestM;
        order = [bestM, ...order.filter(m => m !== bestM)];
        if (Math.abs(bestV) > WIN - 1000) break;   // a forced result is known
      }
    } catch (e) {
      if (e !== ABORT) throw e;
    }
    deadline = 0;
    return best;
  }

  return { LEVELS, choose, evaluate, rate, get nodes() { return nodes; } };
})();

if (typeof module !== 'undefined') module.exports = AI;
