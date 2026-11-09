// Italian draughts rules plus two twists: a pair of portal squares and a trap.
// No DOM: this file also loads in Node (require).
'use strict';

const Rules = (() => {
  const WHITE = 1, BLACK = -1, MAN = 1, KING = 2;
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const DRAW_QUIET = 80;   // plies without a capture, a man move or a special event
  const REPEATS = 3;       // same position, same side to move
  const WANDER = 10;       // plies between two shifts of the special squares

  // Board: Int8Array(64), index = row * 8 + col, row 0 at the top (Black's
  // back row). Pieces: +1 white man, +2 white king, -1 black man, -2 black king.
  // Play is on the dark squares, (row + col) even: the bottom-right corner is
  // dark, as in Italian draughts.
  const row = i => i >> 3, col = i => i & 7;
  const DARK = [];
  for (let i = 0; i < 64; i++) if (((row(i) + col(i)) & 1) === 0) DARK.push(i);

  const promoRow = side => (side === WHITE ? 0 : 7);
  const ahead = side => (side === WHITE ? -1 : 1);

  function initialBoard() {
    const b = new Int8Array(64);
    for (const i of DARK) {
      if (row(i) < 3) b[i] = -MAN;
      else if (row(i) > 4) b[i] = MAN;
    }
    return b;
  }

  // Captures, depth first. Captured pieces stay on the board until the end of
  // the move (they block and cannot be jumped twice); the starting square is free.
  function captures(b, side) {
    const out = [];
    for (const i of DARK) {
      const p = b[i];
      if (p * side <= 0) continue;
      const king = p * side === KING;
      b[i] = 0;
      jump(b, side, king, i, i, [], [], [], out);
      b[i] = p;
    }
    return out;
  }

  function jump(b, side, king, from, at, path, caps, kinds, out) {
    const r = row(at), c = col(at), fwd = ahead(side);
    let more = false;
    for (const [dr, dc] of DIRS) {
      if (!king && dr !== fwd) continue;           // men capture forward only
      const r2 = r + 2 * dr, c2 = c + 2 * dc;
      if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
      const over = (r + dr) * 8 + c + dc, land = r2 * 8 + c2, v = b[over];
      if (v * side >= 0 || b[land] !== 0 || caps.includes(over)) continue;
      if (!king && v * -side === KING) continue;   // a man cannot capture a king
      more = true;
      path.push(land); caps.push(over); kinds.push(v * -side === KING ? 1 : 0);
      jump(b, side, king, from, land, path, caps, kinds, out);
      path.pop(); caps.pop(); kinds.pop();
    }
    if (!more && caps.length) {
      out.push({ from, to: at, path: path.slice(), caps: caps.slice(), kinds: kinds.slice(), king });
    }
  }

  // Italian precedence: most pieces; then with a king; then most kings
  // captured; then the king met first. Any remaining choice is free.
  function precedence(list) {
    const max = Math.max(...list.map(m => m.caps.length));
    list = list.filter(m => m.caps.length === max);
    if (list.some(m => m.king)) list = list.filter(m => m.king);
    const kings = m => m.kinds.reduce((a, k) => a + k, 0);
    const maxK = Math.max(...list.map(kings));
    list = list.filter(m => kings(m) === maxK);
    if (maxK > 0) {
      const first = m => m.kinds.indexOf(1);
      const best = Math.min(...list.map(first));
      list = list.filter(m => first(m) === best);
    }
    return list;
  }

  function steps(b, side) {
    const out = [];
    for (const i of DARK) {
      const p = b[i];
      if (p * side <= 0) continue;
      const king = p * side === KING, r = row(i), c = col(i);
      for (const [dr, dc] of DIRS) {
        if (!king && dr !== ahead(side)) continue;
        const r1 = r + dr, c1 = c + dc;
        if (r1 < 0 || r1 > 7 || c1 < 0 || c1 > 7) continue;
        const to = r1 * 8 + c1;
        if (b[to] === 0) out.push({ from: i, to, path: [to], caps: [], kinds: [], king });
      }
    }
    return out;
  }

  // Legal moves for `side`: captures are mandatory.
  function moves(b, side) {
    const caps = captures(b, side);
    return caps.length ? precedence(caps) : steps(b, side);
  }

  // Plays a move and returns the new board. The twists act where the piece
  // comes to rest: on the trap a man is lost and a king becomes a man; on a
  // portal the piece jumps to the other portal, if that one is empty.
  // `ev` (optional) receives what happened.
  function apply(b, m, sp, ev) {
    const nb = b.slice();
    let p = nb[m.from];
    const side = Math.sign(p);
    nb[m.from] = 0;
    for (const c of m.caps) nb[c] = 0;
    let at = m.to;
    if (p * side === MAN && row(at) === promoRow(side)) {
      p = KING * side;
      if (ev) ev.promoted = true;
    }
    if (sp) {
      if (at === sp.trap) {
        if (p * side === MAN) { p = 0; if (ev) ev.trap = 'lost'; }
        else { p = side; if (ev) ev.trap = 'demoted'; }
      } else {
        const k = sp.portals.indexOf(at);
        if (k >= 0) {
          const dest = sp.portals[1 - k];
          if (nb[dest] === 0) { if (ev) ev.warp = { from: at, to: dest }; at = dest; }
          else if (ev) ev.blocked = dest;
        }
      }
    }
    if (p) nb[at] = p;
    if (ev) ev.at = at;
    return nb;
  }

  // Random special squares: two portals at least 3 squares apart and a trap,
  // on rows lo..hi (never on a back row, so promotion is never involved).
  function placeSpecials(b, rand, lo, hi, emptyOnly) {
    const pool = DARK.filter(i => row(i) >= lo && row(i) <= hi && (!emptyOnly || b[i] === 0));
    if (pool.length < 3) return null;
    const dist = (a, c) => Math.max(Math.abs(row(a) - row(c)), Math.abs(col(a) - col(c)));
    let pick = null;
    for (let tries = 0; tries < 300; tries++) {
      const s = pool.slice();
      for (let i = s.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [s[i], s[j]] = [s[j], s[i]];
      }
      pick = { portals: [s[0], s[1]], trap: s[2] };
      if (dist(s[0], s[1]) >= 3) break;
    }
    return pick;
  }

  function newGame(rand) {
    const board = initialBoard();
    return { board, turn: WHITE, specials: placeSpecials(board, rand, 2, 5, false), ply: 0, quiet: 0 };
  }

  const key = (b, side) => b.join(',') + (side === WHITE ? 'w' : 'b');

  const NAMES = 'abcdefgh';
  const square = i => NAMES[col(i)] + (8 - row(i));
  const notation = m => [m.from, ...m.path].map(square).join(m.caps.length ? '×' : '–');

  function count(b) {
    const n = { wm: 0, wk: 0, bm: 0, bk: 0 };
    for (const i of DARK) {
      const p = b[i];
      if (p === MAN) n.wm++; else if (p === KING) n.wk++;
      else if (p === -MAN) n.bm++; else if (p === -KING) n.bk++;
    }
    return n;
  }

  return {
    WHITE, BLACK, MAN, KING, DARK, DRAW_QUIET, REPEATS, WANDER,
    row, col, initialBoard, moves, apply, placeSpecials, newGame, key, square, notation, count,
  };
})();

if (typeof module !== 'undefined') module.exports = Rules;
