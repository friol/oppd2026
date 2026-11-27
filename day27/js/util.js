// Seeded random numbers, value noise and small math helpers.
const TAU = Math.PI * 2;

const U = {
  // mulberry32 generator with a few convenience helpers attached.
  // Every study picks its palette with its very first random number, so an
  // optional firstSeed replaces just that number: same composition, other
  // colours (the main sequence still advances, so nothing else changes).
  rng(seed, firstSeed) {
    let a = seed >>> 0, first = firstSeed !== undefined && firstSeed !== null;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const r = () => {
      const v = next();
      if (first) { first = false; return U.rng(firstSeed)(); }
      return v;
    };
    r.range = (lo, hi) => lo + r() * (hi - lo);
    r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    r.chance = p => r() < p;
    return r;
  },

  // 3D value noise in roughly [-1, 1].
  noise(seed) {
    const rand = U.rng(seed), p = new Uint8Array(512), v = new Float32Array(256);
    for (let i = 0; i < 256; i++) { p[i] = i; v[i] = rand() * 2 - 1; }
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const k = p[i]; p[i] = p[j]; p[j] = k; }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    const h = (x, y, z) => v[p[p[p[x & 255] + (y & 255)] + (z & 255)]];
    const f = t => t * t * (3 - 2 * t);
    const L = U.lerp;
    return (x, y = 0, z = 0) => {
      const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      const u = f(x - X), w = f(y - Y), q = f(z - Z);
      return L(
        L(L(h(X, Y, Z), h(X + 1, Y, Z), u), L(h(X, Y + 1, Z), h(X + 1, Y + 1, Z), u), w),
        L(L(h(X, Y, Z + 1), h(X + 1, Y, Z + 1), u), L(h(X, Y + 1, Z + 1), h(X + 1, Y + 1, Z + 1), u), w),
        q);
    };
  },

  lerp: (a, b, t) => a + (b - a) * t,
  clamp: (v, lo, hi) => v < lo ? lo : v > hi ? hi : v,
  ease: t => t * t * (3 - 2 * t),

  // Trace a closed polygon path from an array of {x, y}.
  poly(c, pts) {
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    c.closePath();
  },
};
