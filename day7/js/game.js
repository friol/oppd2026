// Rules of tic-tac-toe in two modes: "classic" and "vanish" (three marks each,
// the fourth one erases the oldest). No DOM here, so the file also loads in Node.
'use strict';

const Game = (() => {
  const X = 1, O = 2;
  const LIMIT = 3;    // marks per player in vanish mode
  const REPEATS = 3;  // the same position this many times is a draw (vanish mode)
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  const other = p => 3 - p;

  // board: 9 cells, 0 = empty; marks: cells of each player, oldest first.
  function create(mode, first = X) {
    return { mode, board: [0, 0, 0, 0, 0, 0, 0, 0, 0], marks: { [X]: [], [O]: [] }, turn: first, ply: 0 };
  }

  function free(s) {
    const r = [];
    for (let i = 0; i < 9; i++) if (!s.board[i]) r.push(i);
    return r;
  }

  // The cell whose mark disappears when player p plays next, or -1.
  function doomed(s, p = s.turn) {
    return s.mode === 'vanish' && s.marks[p].length >= LIMIT ? s.marks[p][0] : -1;
  }

  // Returns the new state and the cell that was erased (-1 if none).
  // The oldest mark goes away before the new one is placed, so it never counts for a line.
  function play(s, cell) {
    const p = s.turn, q = other(p);
    const board = s.board.slice(), mine = s.marks[p].slice();
    let removed = -1;
    if (s.mode === 'vanish' && mine.length >= LIMIT) {
      removed = mine.shift();
      board[removed] = 0;
    }
    board[cell] = p;
    mine.push(cell);
    return {
      state: { mode: s.mode, board, marks: { [p]: mine, [q]: s.marks[q] }, turn: q, ply: s.ply + 1 },
      removed,
    };
  }

  function winner(board) {
    for (const l of LINES) {
      const v = board[l[0]];
      if (v && v === board[l[1]] && v === board[l[2]]) return { player: v, line: l };
    }
    return null;
  }

  const full = s => s.board.every(Boolean);

  // Identifies a position, including the order in which marks will vanish.
  const key = s => s.marks[X].join('') + '|' + s.marks[O].join('') + '|' + s.turn;

  return { X, O, LIMIT, REPEATS, LINES, other, create, free, doomed, play, winner, full, key };
})();

if (typeof module !== 'undefined') module.exports = Game;
