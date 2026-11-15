// Crossword generator and verifier (dense, Italian-style grids). No DOM access: also runs under Node.
(function (root) {
  'use strict';

  // Grid presets. d0: initial share of black cells; when no fill is found with PER patterns,
  // the share grows by 1% until dMax. maxLen: longest word allowed in the black-cell pattern.
  const SIZES = {
    s: { rows: 7, cols: 11, d0: 0.13, dMax: 0.24, maxLen: 9 },
    m: { rows: 10, cols: 15, d0: 0.14, dMax: 0.24, maxLen: 9 },
    l: { rows: 12, cols: 17, d0: 0.17, dMax: 0.25, maxLen: 9 }
  };
  // Extra initial black share per language (a smaller or less flexible word list needs more blacks;
  // starting closer to the density that usually works avoids wasting attempts).
  const LANG_D0 = { it: 0, en: 0.015 };
  const PER = 40;     // patterns tried at each density
  const BUDGET = 300; // search nodes per pattern
  const TRY = 8;      // candidate words tried per slot

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function popcount(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }

  function commonPrefix(a, b) {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  }

  // True when the clue gives the answer away: a clue word equal to the answer, containing it
  // (ZOO / zoologico), contained in it (PANETTIERE / pane), or sharing its root (CASTAGNO / castagne:
  // a common prefix of 5+ letters, or of 4 letters that is all but at most 2 letters of the shorter word).
  function revealsAnswer(answer, clue) {
    const words = clue.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/[^A-Z]+/);
    for (const t of words) {
      if (!t) continue;
      if (t === answer) return true;
      if (answer.length >= 3 && t.includes(answer)) return true;
      if (t.length >= 4 && answer.includes(t)) return true;
      const c = commonPrefix(t, answer);
      if (c >= 5 || (c >= 4 && c >= Math.min(t.length, answer.length) - 2)) return true;
    }
    return false;
  }

  // "WORD|clue" or "WORD|clue|PLURAL|plural clue" -> Map word -> clue. The plural has its own clue,
  // written in the plural. Invalid lines (including a plural without its clue) are reported in `bad`;
  // a word whose clue reveals it is left out and reported too. A word already defined keeps its first clue.
  function parseDictionary(lines) {
    const map = new Map();
    const bad = [];
    const add = (w, c, line) => {
      if (map.has(w)) return;
      if (revealsAnswer(w, c)) { bad.push(line + '  (the clue reveals ' + w + ')'); return; }
      map.set(w, c);
    };
    for (const line of lines) {
      const parts = line.split('|').map(s => s.trim());
      const word = (parts[0] || '').toUpperCase();
      const clue = parts[1] || '';
      const plural = (parts[2] || '').toUpperCase();
      const pluralClue = parts[3] || '';
      if (!/^[A-Z]{2,}$/.test(word) || !clue || (plural && (!/^[A-Z]{2,}$/.test(plural) || !pluralClue))) { bad.push(line); continue; }
      add(word, clue, line);
      if (plural && plural !== word) add(plural, pluralClue, line);
    }
    return { map, bad };
  }

  // Two clues count as the same when they differ only in case or spacing.
  function clueKey(clue) {
    return clue.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Per word length: the word list and, for each position and letter, a bitset of matching words.
  function buildIndex(dict) {
    const byLen = {};
    for (const w of dict.keys()) (byLen[w.length] = byLen[w.length] || []).push(w);
    const idx = {};
    for (const L in byLen) {
      const ws = byLen[L].sort();
      const nw = (ws.length + 31) >>> 5;
      const bits = [];
      for (let p = 0; p < L; p++) {
        bits.push([]);
        for (let c = 0; c < 26; c++) bits[p].push(new Uint32Array(nw));
      }
      ws.forEach((w, i) => {
        for (let p = 0; p < L; p++) bits[p][w.charCodeAt(p) - 65][i >>> 5] |= 1 << (i & 31);
      });
      const all = new Uint32Array(nw);
      for (let i = 0; i < ws.length; i++) all[i >>> 5] |= 1 << (i & 31);
      const codes = new Uint8Array(ws.length * L);
      ws.forEach((w, i) => { for (let p = 0; p < L; p++) codes[i * L + p] = w.charCodeAt(p) - 65; });
      // Letters that occur at each position in some word (the others never need to be tested).
      const present = new Array(+L).fill(0);
      ws.forEach(w => { for (let p = 0; p < L; p++) present[p] |= 1 << (w.charCodeAt(p) - 65); });
      // Clue of each word, normalized: a clue may appear only once in a puzzle.
      const keys = ws.map(w => clueKey(dict.get(w)));
      idx[L] = { ws, keys, nw, bits, all, codes, present, L: +L };
    }
    return idx;
  }

  // Random black-cell pattern: black cells never touch each other orthogonally, no run is longer
  // than maxLen, and every letter belongs to at least one run of 2+ letters.
  function makePattern(R, C, maxLen, density, rng) {
    const B = new Uint8Array(R * C);
    const free = k => {
      const r = (k / C) | 0, c = k % C;
      return !B[k] && !(c > 0 && B[k - 1]) && !(c < C - 1 && B[k + 1]) && !(r > 0 && B[k - C]) && !(r < R - 1 && B[k + C]);
    };
    // Break runs that are too long.
    for (let guard = 0; guard < 400; guard++) {
      let long = null;
      for (let dir = 0; dir < 2 && !long; dir++) {
        const lines = dir ? C : R, len = dir ? R : C;
        for (let a = 0; a < lines && !long; a++) {
          let run = 0;
          for (let b = 0; b <= len; b++) {
            const k = dir ? b * C + a : a * C + b;
            if (b < len && !B[k]) { run++; continue; }
            if (run > maxLen) {
              long = [];
              for (let x = b - run + 2; x < b - 2; x++) long.push(dir ? x * C + a : a * C + x);
              break;
            }
            run = 0;
          }
        }
      }
      if (!long) break;
      const opts = long.filter(free);
      if (!opts.length) return null;
      B[opts[Math.floor(rng() * opts.length)]] = 1;
    }
    let count = 0;
    for (const b of B) count += b;
    for (let tries = 0; count < R * C * density && tries < 3000; tries++) {
      const k = Math.floor(rng() * R * C);
      if (free(k)) { B[k] = 1; count++; }
    }
    const isB = (r, c) => r < 0 || c < 0 || r >= R || c >= C || B[r * C + c];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        if (!B[r * C + c] && isB(r, c - 1) && isB(r, c + 1) && isB(r - 1, c) && isB(r + 1, c)) return null;
      }
    }
    return B;
  }

  // Slots are the runs of 2+ letters; single letters between two blacks are not words.
  function findSlots(B, R, C) {
    const S = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const k = r * C + c;
        if (B[k]) continue;
        if ((c === 0 || B[k - 1]) && c + 1 < C && !B[k + 1]) {
          const cells = [];
          for (let x = c; x < C && !B[r * C + x]; x++) cells.push(r * C + x);
          S.push({ dir: 'across', row: r, col: c, cells });
        }
        if ((r === 0 || B[k - C]) && r + 1 < R && !B[k + C]) {
          const cells = [];
          for (let y = r; y < R && !B[y * C + c]; y++) cells.push(y * C + c);
          S.push({ dir: 'down', row: r, col: c, cells });
        }
      }
    }
    return S;
  }

  // Fills the slots with dictionary words. Each slot keeps a bitset domain of candidate words;
  // after every choice the allowed letters of shared cells are propagated to the crossing slots
  // (arc consistency), then the slot with the fewest candidates is filled next.
  function fill(S, idx, rng) {
    const n = S.length;
    if (S.some(s => !idx[s.cells.length])) return null;
    const cross = S.map(() => []);
    const at = new Map();
    S.forEach((s, i) => s.cells.forEach((k, p) => {
      if (at.has(k)) {
        const [j, q] = at.get(k);
        cross[i].push([p, j, q]);
        cross[j].push([q, i, p]);
      } else at.set(k, [i, p]);
    }));

    const ix = S.map(s => idx[s.cells.length]);
    let dom = ix.map(x => x.all.slice());
    const assigned = new Array(n).fill(null);
    const used = new Set(); // clues already in the grid (a repeated word would repeat its clue too)
    let steps = 0;

    // Letters still possible at position p of slot i. With few candidates it is faster to read
    // their letters directly; otherwise test each letter's bitset against the domain.
    function lettersAt(i, d, p) {
      const { bits, nw, codes, present, L: len } = ix[i];
      let mask = 0;
      let cnt = 0;
      for (let w = 0; w < nw && cnt <= 40; w++) if (d[w]) cnt += popcount(d[w]);
      if (cnt <= 40) {
        for (let w = 0; w < nw; w++) {
          let x = d[w];
          while (x) {
            const b = x & -x;
            x ^= b;
            mask |= 1 << codes[((w << 5) + 31 - Math.clz32(b)) * len + p];
          }
        }
        return mask;
      }
      for (let c = 0; c < 26; c++) {
        if (!(present[p] & (1 << c))) continue;
        const b = bits[p][c];
        for (let w = 0; w < nw; w++) if (d[w] & b[w]) { mask |= 1 << c; break; }
      }
      return mask;
    }

    // True if slot i can still have at position p a letter outside the mask L (cheaper than
    // lettersAt when the answer is no, which is when a revision would change nothing).
    function hasOther(i, d, p, L) {
      const { bits, nw, present } = ix[i];
      for (let c = 0; c < 26; c++) {
        if (!(present[p] & ~L & (1 << c))) continue;
        const b = bits[p][c];
        for (let w = 0; w < nw; w++) if (d[w] & b[w]) return true;
      }
      return false;
    }

    const allowed = new Uint32Array(Math.max(...ix.map(x => x.nw)));

    function propagate(D, queue) {
      const inQ = new Uint8Array(n);
      for (const i of queue) inQ[i] = 1;
      while (queue.length) {
        const i = queue.pop();
        inQ[i] = 0;
        for (const [p, j, q] of cross[i]) {
          const L = lettersAt(i, D[i], p);
          const dj = D[j];
          // Nothing to remove when every letter slot j can still have there is allowed by slot i.
          if (!hasOther(j, dj, q, L)) continue;
          const { bits, nw } = ix[j];
          allowed.fill(0, 0, nw);
          for (let c = 0; c < 26; c++) {
            if (!(L & (1 << c))) continue;
            const b = bits[q][c];
            for (let w = 0; w < nw; w++) allowed[w] |= b[w];
          }
          let changed = false, any = false;
          for (let w = 0; w < nw; w++) {
            const nv = (dj[w] & allowed[w]) >>> 0;
            if (nv !== dj[w]) { dj[w] = nv; changed = true; }
            if (nv) any = true;
          }
          if (!any) return false;
          if (changed && !inQ[j]) { inQ[j] = 1; queue.push(j); }
        }
      }
      return true;
    }

    function size(d) {
      let c = 0;
      for (const x of d) c += popcount(x);
      return c;
    }

    function rec(left) {
      if (++steps > BUDGET) return false;
      if (!left) return true;
      let best = -1, bc = Infinity;
      for (let i = 0; i < n; i++) {
        if (assigned[i] !== null) continue;
        const c = size(dom[i]);
        if (c < bc) { bc = c; best = i; }
      }
      const { ws, keys, nw } = ix[best];
      const list = [];
      const d = dom[best];
      for (let w = 0; w < nw; w++) {
        let x = d[w];
        while (x) {
          const b = x & -x;
          const j = (w << 5) + 31 - Math.clz32(b);
          x ^= b;
          if (!used.has(keys[j])) list.push(j);
        }
      }
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      for (const j of list.slice(0, TRY)) {
        const saved = dom;
        dom = dom.map(x => x.slice());
        dom[best].fill(0);
        dom[best][j >>> 5] = 1 << (j & 31);
        assigned[best] = ws[j];
        used.add(keys[j]);
        if (propagate(dom, [best]) && rec(left - 1)) return true;
        dom = saved;
        assigned[best] = null;
        used.delete(keys[j]);
        if (steps > BUDGET) return false;
      }
      return false;
    }

    if (!propagate(dom, S.map((_, i) => i))) return null;
    return rec(n) ? assigned : null;
  }

  // Builds the puzzle from the filled slots: solution rows, numbers on the start cells
  // (reading order) and one clued entry per slot.
  function buildPuzzle(R, C, B, S, words, dict, lang, size, seed) {
    const g = new Array(R * C).fill('#');
    S.forEach((s, i) => s.cells.forEach((k, p) => { g[k] = words[i][p]; }));
    for (let k = 0; k < g.length; k++) if (!B[k] && g[k] === '#') g[k] = '?';
    const solution = [];
    for (let r = 0; r < R; r++) solution.push(g.slice(r * C, r * C + C).join(''));

    const starts = [...new Set(S.map(s => s.cells[0]))].sort((a, b) => a - b);
    const numbers = new Array(R * C).fill(0);
    starts.forEach((k, i) => { numbers[k] = i + 1; });

    const entries = S.map((s, i) => ({
      num: numbers[s.cells[0]],
      dir: s.dir,
      row: s.row,
      col: s.col,
      answer: words[i],
      clue: dict.get(words[i])
    })).sort((a, b) => (a.dir === b.dir ? a.num - b.num : a.dir === 'across' ? -1 : 1));

    return { lang, size, seed, rows: R, cols: C, solution, numbers, entries };
  }

  // Reads every maximal run of 2+ letters straight from the solution grid and numbers the cells
  // with the standard rule, independently of how the puzzle was built.
  function scanGrid(solution) {
    const rows = solution.length, cols = solution[0].length;
    const isL = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && solution[r][c] !== '#';
    const runs = [];
    const numbers = new Array(rows * cols).fill(0);
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!isL(r, c)) continue;
        const a = !isL(r, c - 1) && isL(r, c + 1);
        const d = !isL(r - 1, c) && isL(r + 1, c);
        if (!a && !d) continue;
        numbers[r * cols + c] = ++n;
        if (a) { let s = ''; for (let k = c; isL(r, k); k++) s += solution[r][k]; runs.push({ num: n, dir: 'across', row: r, col: c, answer: s }); }
        if (d) { let s = ''; for (let k = r; isL(k, c); k++) s += solution[k][c]; runs.push({ num: n, dir: 'down', row: r, col: c, answer: s }); }
      }
    }
    return { runs, numbers };
  }

  // Checks that the puzzle shown to the player is consistent: every word in the grid has exactly one
  // entry, the entry number is the number printed in its start cell, the answer is what the grid spells
  // there, and the clue is the dictionary definition of that answer and does not give it away.
  function verify(p, dict) {
    const errors = [];
    const err = m => { if (errors.length < 20) errors.push(m); };
    for (const row of p.solution) if (!/^[A-Z#]+$/.test(row) || row.length !== p.cols) err('Invalid grid row: ' + row);
    if (p.solution.length !== p.rows) err('Wrong number of rows');
    if (errors.length) return { ok: false, errors, stats: {} };

    const { runs, numbers } = scanGrid(p.solution);
    const key = e => e.dir + ':' + e.row + ',' + e.col;
    const byKey = new Map();
    for (const e of p.entries) {
      if (byKey.has(key(e))) err('Two entries start at ' + key(e));
      byKey.set(key(e), e);
    }

    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i] !== p.numbers[i]) err('Cell ' + i + ' is numbered ' + p.numbers[i] + ', expected ' + numbers[i]);
    }

    const seen = new Set();
    const clues = new Map(); // normalized clue -> answer that uses it
    for (const run of runs) {
      const e = byKey.get(key(run));
      if (!e) { err('Word without a clue in the grid: ' + run.answer); continue; }
      if (e.num !== run.num) err(run.answer + ': entry number ' + e.num + ' but the cell shows ' + run.num);
      if (e.answer !== run.answer) err('Entry ' + e.num + ' ' + e.dir + ' expects ' + e.answer + ' but the grid spells ' + run.answer);
      if (!dict.has(run.answer)) err(run.answer + ' is not in the dictionary');
      else if (dict.get(run.answer) !== e.clue) err(run.answer + ': the clue does not match the dictionary');
      if (revealsAnswer(run.answer, e.clue)) err(run.answer + ': the clue "' + e.clue + '" gives the answer away');
      if (seen.has(run.answer)) err(run.answer + ' is used twice');
      seen.add(run.answer);
      const ck = clueKey(e.clue);
      if (clues.has(ck) && clues.get(ck) !== run.answer) err(run.answer + ' and ' + clues.get(ck) + ' have the same clue "' + e.clue + '"');
      clues.set(ck, run.answer);
    }
    if (runs.length !== p.entries.length) err(p.entries.length + ' entries but ' + runs.length + ' words in the grid');

    // Every letter cell must belong to at least one clued word.
    const covered = new Set();
    for (const run of runs) {
      for (let i = 0; i < run.answer.length; i++) {
        covered.add(run.dir === 'across' ? run.row * p.cols + run.col + i : (run.row + i) * p.cols + run.col);
      }
    }
    let letters = 0, crossed = 0;
    for (let r = 0; r < p.rows; r++) {
      for (let c = 0; c < p.cols; c++) {
        if (p.solution[r][c] === '#') continue;
        letters++;
        const k = r * p.cols + c;
        if (!covered.has(k)) err('Letter at ' + r + ',' + c + ' belongs to no word');
        const h = (c > 0 && p.solution[r][c - 1] !== '#') || (c < p.cols - 1 && p.solution[r][c + 1] !== '#');
        const v = (r > 0 && p.solution[r - 1][c] !== '#') || (r < p.rows - 1 && p.solution[r + 1][c] !== '#');
        if (h && v) crossed++;
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      stats: {
        words: runs.length,
        letters,
        crossed,
        blacks: p.rows * p.cols - letters,
        numbered: Math.max(0, ...numbers)
      }
    };
  }

  const indexCache = new WeakMap();

  // Builds a verified puzzle. The seed fully determines the result (budgets are counted in search
  // steps, not time). A candidate that fails verification is discarded and the search goes on.
  function generate(opts) {
    const cfg = SIZES[opts.size] || SIZES.m;
    if (!indexCache.has(opts.dict)) indexCache.set(opts.dict, buildIndex(opts.dict));
    const idx = indexCache.get(opts.dict);
    const rng = mulberry32(opts.seed * 7919 + 17);
    const t0 = Date.now();
    const rejected = [];
    let patterns = 0;
    for (let d = cfg.d0 + (LANG_D0[opts.lang] || 0); d <= cfg.dMax + 1e-9; d += 0.01) {
      for (let t = 0; t < PER; t++) {
        const B = makePattern(cfg.rows, cfg.cols, cfg.maxLen, d, rng);
        if (!B) continue;
        patterns++;
        const S = findSlots(B, cfg.rows, cfg.cols);
        const words = fill(S, idx, rng);
        if (!words) continue;
        const puzzle = buildPuzzle(cfg.rows, cfg.cols, B, S, words, opts.dict, opts.lang, opts.size, opts.seed);
        const report = verify(puzzle, opts.dict);
        if (report.ok) {
          report.patterns = patterns;
          report.rejected = rejected;
          report.ms = Date.now() - t0;
          return { ok: true, puzzle, report };
        }
        rejected.push(report.errors[0]);
      }
    }
    return { ok: false, rejected: rejected.length ? rejected : ['no pattern could be filled'] };
  }

  const api = { SIZES, parseDictionary, revealsAnswer, generate, verify, scanGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Crossword = api;
})(this);
