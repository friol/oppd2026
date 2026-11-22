'use strict';
// Shared helpers. Classic script (globals), also loadable in Node via vm.

const TILE = 32;

const U = {
  clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  lerp: (a, b, t) => a + (b - a) * t,
  sign: v => v < 0 ? -1 : v > 0 ? 1 : 0,
  approach: (v, target, step) => v < target ? Math.min(v + step, target) : Math.max(v - step, target),
  overlap: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
  // Seeded PRNG (mulberry32) with a few helpers
  rng(seed) {
    let a = seed >>> 0;
    const f = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      f,
      int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
      pick: arr => arr[Math.floor(f() * arr.length)],
      chance: p => f() < p,
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
        return arr;
      }
    };
  },
  // Rotate a grid direction by k quarter turns (y down)
  rot90(v, k) {
    let x = v[0], y = v[1];
    for (let i = 0; i < ((k % 4) + 4) % 4; i++) { const t = x; x = -y; y = t; }
    return [x, y];
  }
};

if (typeof module !== 'undefined') module.exports = { U, TILE };
