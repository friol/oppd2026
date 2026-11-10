'use strict';
// Procedural pixel-art: every sprite and background layer is painted once at start-up
// into small offscreen canvases using integer rectangles only (no anti-aliasing).
const Gfx = (() => {
  const K = 8;          // world units per sprite pixel (at mult = 1)
  const SPR = {};
  const BG = {};

  // ------------------------------------------------------------------ helpers
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    return { c, g };
  }

  function rng32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function shade(h, f) { const [r, g, b] = hex2rgb(h); return rgb2hex(r * f, g * f, b * f); }
  function mix(a, b, t) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  }

  // Pixel painter bound to a 2D context.
  function P(g) {
    const R = Math.round;
    const r = (x, y, w, h, c) => {
      const x0 = R(x), y0 = R(y), x1 = R(x + w), y1 = R(y + h);
      if (x1 <= x0 || y1 <= y0) return;
      g.fillStyle = c; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    };
    const disc = (cx, cy, rad, c) => {
      g.fillStyle = c;
      for (let dy = -rad; dy <= rad; dy++) {
        const hw = R(Math.sqrt(Math.max(0, rad * rad - dy * dy)));
        g.fillRect(R(cx - hw), R(cy + dy), hw * 2 + 1, 1);
      }
    };
    const ell = (cx, cy, rx, ry, c) => {
      g.fillStyle = c;
      for (let dy = -ry; dy <= ry; dy++) {
        const hw = R(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
        g.fillRect(R(cx - hw), R(cy + dy), hw * 2 + 1, 1);
      }
    };
    const ring = (cx, cy, ro, ri, c) => {
      g.fillStyle = c;
      for (let dy = -ro; dy <= ro; dy++) for (let dx = -ro; dx <= ro; dx++) {
        const d = dx * dx + dy * dy;
        if (d <= ro * ro && d > ri * ri) g.fillRect(cx + dx, cy + dy, 1, 1);
      }
    };
    const line = (x0, y0, x1, y1, c, t = 1) => {
      g.fillStyle = c;
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1;
      for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
        g.fillRect(R(x - (t - 1) / 2), R(y - (t - 1) / 2), t, t);
      }
    };
    // scanline fill for convex polygons: pts = [x0,y0,x1,y1,...]
    const poly = (pts, c) => {
      g.fillStyle = c;
      const n = pts.length / 2;
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < pts.length; i += 2) { minY = Math.min(minY, pts[i]); maxY = Math.max(maxY, pts[i]); }
      for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
        const yc = y + 0.5;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < n; i++) {
          const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
            const x = ax + (yc - ay) * (bx - ax) / (by - ay);
            lo = Math.min(lo, x); hi = Math.max(hi, x);
          }
        }
        if (hi > lo) { const a = R(lo), b = R(hi); if (b > a) g.fillRect(a, y, b - a, 1); }
      }
    };
    const rect = (x, y, w, h, c) => { r(x, y, w, 1, c); r(x, y + h - 1, w, 1, c); r(x, y, 1, h, c); r(x + w - 1, y, 1, h, c); };
    const text = (s, x, y, c, o = {}) => Font.draw(g, s, x, y, Object.assign({ color: c, shadow: null }, o));
    return { r, disc, ell, ring, line, poly, rect, text, g };
  }

  // Wrap a canvas into a sprite. mult scales its size in the world.
  // cx / cw: collision centre and width as a fraction of the sprite width.
  function spr(c, mult, cx = 0.5, cw = 0.8) {
    return { img: c, w: c.width, h: c.height, ww: c.width * K * mult, wh: c.height * K * mult, cx, cw };
  }

  function flip(src) {
    const { c, g } = mk(src.width, src.height);
    g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ background palms (silhouettes)
  const PAL = {
    tropic: { trunk: '#a26a3c', trunk2: '#7c4c28', leaf: '#2f9a4a', leaf2: '#1f763a', nut: '#5a3a18' },
    shadow: { trunk: '#2a0f4a', trunk2: '#2a0f4a', leaf: '#2a0f4a', leaf2: '#2a0f4a', nut: '#2a0f4a' },
    deep: { trunk: '#1e0a3a', trunk2: '#1e0a3a', leaf: '#1e0a3a', leaf2: '#1e0a3a', nut: '#1e0a3a' }
  };

  function drawPalm(p, bx, by, h, lean, pal) {
    const tx = bx + lean * h * 0.22, ty = by - h * 0.75;
    const cx = bx + lean * h * 0.02, cy = by - h * 0.4;
    const steps = Math.ceil(h);
    const tw = Math.max(1.5, h * 0.06);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * bx + 2 * (1 - t) * t * cx + t * t * tx;
      const y = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * cy + t * t * ty;
      const w = tw * (1.2 - 0.5 * t);
      p.r(x - w / 2, y - 1, w, 2, (Math.floor(i / 3) % 2) ? pal.trunk : pal.trunk2);
    }
    const L = h * 0.32;
    const fronds = [[-175, 1.0, 0.8], [-150, 1.05, 1.0], [-120, 0.85, 1.2], [-95, 0.6, 1.4], [-62, 0.85, 1.2],
      [-30, 1.05, 1.0], [-5, 1.0, 0.8], [-110, 0.6, 0.4], [-72, 0.6, 0.4]];
    for (const [deg, lm, droop] of fronds) {
      const a = deg * Math.PI / 180, len = L * lm;
      const n = Math.ceil(len * 1.5);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = tx + Math.cos(a) * len * t;
        const y = ty + Math.sin(a) * len * t + droop * len * t * t * 0.8;
        const th = Math.max(1, h * 0.03 * (1 - t) + 1);
        if (i % 2 === 0 && t > 0.08) {
          const ll = h * 0.07 * (1 - t * 0.6);
          p.line(x, y, x + Math.cos(a) * ll * 0.4, y + ll, pal.leaf2);
        }
        p.r(x - th / 2, y - th / 2, th, th, pal.leaf);
      }
    }
    const nr = Math.max(1, Math.round(h * 0.02));
    p.disc(tx - 1, ty + 2, nr, pal.nut); p.disc(tx + 2, ty + 2, nr, pal.nut);
  }

  // ------------------------------------------------------------------ Miami scenery
  function hotel(col, acc, neon, name, seed) {
    const { c, g } = mk(96, 124);
    const p = P(g);
    const rnd = rng32(seed);
    const top = 28, side = shade(col, 0.82), lite = shade(col, 1.06);
    // stepped tower
    p.r(36, 8, 24, top - 8, col); p.r(54, 8, 6, top - 8, side);
    p.r(34, 6, 28, 2, acc); p.r(40, 2, 16, 4, col); p.r(40, 2, 16, 1, acc); p.r(47, 0, 2, 2, acc);
    // main block
    p.r(4, top, 88, 96, col); p.r(72, top, 20, 96, side); p.r(4, top, 2, 96, lite);
    p.r(2, top - 2, 92, 2, acc); p.r(2, top, 92, 1, '#fff7ec');
    for (let f = 0; f < 5; f++) {
      const y = top + 8 + f * 15;
      p.r(4, y - 3, 88, 2, '#fff7ec'); p.r(4, y - 1, 88, 1, shade(col, 0.7));
      for (let x = 9; x < 90; x += 10) {
        if (x > 38 && x < 58) continue;
        p.r(x, y + 1, 6, 8, rnd() < 0.4 ? '#ffd77a' : '#2d2f5e');
        p.r(x, y + 1, 6, 1, '#1c1d40');
      }
    }
    // vertical neon sign
    const L = name.length, sh = L * 8 + 4;
    p.r(41, 10, 14, sh, '#1a0f2e'); p.rect(41, 10, 14, sh, neon);
    for (let i = 0; i < L; i++) p.text(name[i], 46, 13 + i * 8, neon);
    // ground floor with striped awning
    p.r(4, 106, 88, 18, shade(col, 0.9));
    for (let x = 6; x < 90; x += 8) { p.r(x, 104, 4, 4, acc); p.r(x + 4, 104, 4, 4, '#ffffff'); }
    p.r(6, 108, 84, 1, shade(col, 0.6));
    p.r(40, 112, 16, 12, '#2a1a3a'); p.r(41, 113, 6, 11, '#ffcf7a'); p.r(49, 113, 6, 11, '#ffcf7a');
    for (let x = 10; x < 36; x += 9) p.r(x, 112, 6, 8, '#2d2f5e');
    for (let x = 62; x < 88; x += 9) p.r(x, 112, 6, 8, '#2d2f5e');
    return c;
  }

  function lifeguard(body, stripe, roof) {
    const { c, g } = mk(58, 72);
    const p = P(g);
    const wood = '#f1e6d2', woodD = '#c9bba2';
    p.r(12, 40, 3, 32, wood); p.r(41, 40, 3, 32, wood); p.r(26, 40, 3, 32, woodD);
    p.line(13, 46, 42, 66, woodD); p.line(42, 46, 13, 66, woodD);
    p.line(44, 42, 56, 71, wood, 2);
    for (let k = 0; k < 5; k++) p.r(45 + k * 2, 47 + k * 5, 4, 1, woodD);
    p.r(6, 38, 44, 3, '#ffffff'); p.r(6, 41, 44, 1, woodD);
    for (let x = 6; x < 50; x += 4) p.r(x, 33, 1, 5, '#ffffff');
    p.r(6, 33, 44, 1, '#ffffff');
    p.r(12, 16, 32, 22, body);
    for (let i = 0; i < 4; i++) p.r(14 + i * 8, 16, 3, 22, stripe);
    p.r(18, 20, 20, 8, '#1d2c52'); p.r(18, 20, 20, 1, '#5a7ac0');
    p.poly([8, 16, 48, 16, 40, 8, 16, 8], roof); p.r(8, 16, 40, 1, shade(roof, 0.7));
    p.r(27, 0, 1, 8, '#dddddd'); p.poly([28, 0, 36, 2, 28, 4], '#ff3040');
    return c;
  }

  function surfboard(col, st) {
    const { c, g } = mk(10, 36);
    const p = P(g);
    p.ell(5, 16, 4, 16, col); p.r(4, 2, 2, 28, st);
    p.ell(5, 33, 5, 2, '#d9a35c');
    return c;
  }

  function surfer(skin, shorts, board) {
    const { c, g } = mk(40, 32);
    const p = P(g);
    p.ell(20, 28, 19, 4, '#1b93b8'); p.ell(26, 25, 11, 5, '#22a6c9'); p.ell(30, 22, 6, 4, '#7fd8ee');
    p.r(4, 27, 32, 1, '#ffffff'); p.disc(33, 21, 3, '#ffffff');
    p.ell(18, 23, 12, 2, board); p.r(7, 23, 22, 1, shade(board, 0.7));
    p.r(13, 14, 2, 8, skin); p.r(21, 14, 2, 8, skin); p.r(13, 11, 10, 4, shorts);
    p.r(14, 5, 7, 7, skin); p.line(14, 6, 8, 10, skin); p.line(20, 6, 27, 3, skin);
    p.disc(17, 2, 2, skin); p.r(15, 0, 5, 2, '#3a2010');
    return c;
  }

  function oceanSign() {
    const { c, g } = mk(100, 56);
    const p = P(g);
    p.r(16, 34, 4, 22, '#4a4a5a'); p.r(80, 34, 4, 22, '#4a4a5a');
    p.r(0, 0, 100, 36, '#1a0a30'); p.rect(0, 0, 100, 36, '#ff3fa4'); p.rect(2, 2, 96, 32, '#20e0f0');
    p.text('OCEAN DRIVE', 50, 8, '#ffe14a', { align: 'center' });
    p.text('MIAMI BEACH', 50, 20, '#ff7ad0', { align: 'center' });
    return c;
  }

  // ------------------------------------------------------------------ Neon city
  function skyscraper(seed) {
    const { c, g } = mk(72, 180);
    const p = P(g);
    const r = rng32(seed * 77 + 5);
    const body = ['#1c1640', '#221a4a', '#18203f'][seed % 3];
    const neon = ['#ff2bd6', '#00f0ff', '#ffe14a', '#7a5cff'][seed % 4];
    p.r(8, 20, 56, 160, body); p.r(52, 20, 12, 160, shade(body, 0.72));
    p.r(16, 8, 40, 12, body); p.r(28, 2, 16, 6, body);
    p.r(35, 0, 2, 2, '#ff3040');
    for (let y = 26; y < 176; y += 7) {
      for (let x = 12; x < 60; x += 6) {
        const lit = r() < 0.42;
        p.r(x, y, 3, 4, lit ? ['#ffd96a', '#6af0ff', '#ff8ad8', '#fff4c0'][(r() * 4) | 0] : '#2c2560');
      }
    }
    p.r(8, 20, 1, 160, neon); p.r(63, 20, 1, 160, neon); p.r(8, 20, 56, 1, neon); p.r(16, 8, 40, 1, neon);
    return c;
  }

  function neonSign(word, c1, c2) {
    const { c, g } = mk(84, 60);
    const p = P(g);
    p.r(12, 36, 3, 24, '#3a3a4a'); p.r(69, 36, 3, 24, '#3a3a4a');
    p.r(0, 0, 84, 38, '#120820'); p.rect(0, 0, 84, 38, c1); p.rect(2, 2, 80, 34, c1);
    const sc = word.length <= 6 ? 2 : 1;
    p.text(word, 42, sc === 2 ? 12 : 15, c2, { align: 'center', scale: sc });
    return c;
  }

  // ------------------------------------------------------------------ Bayou
  function airboat() {
    const { c, g } = mk(46, 30);
    const p = P(g);
    p.ring(32, 11, 10, 8, '#5a5a5a'); p.r(31, 2, 2, 18, '#333'); p.r(24, 10, 16, 2, '#333');
    p.r(29, 20, 6, 3, '#666');
    p.r(2, 22, 42, 6, '#f0f0f0'); p.r(2, 24, 42, 1, '#2a7ad8'); p.r(2, 27, 42, 1, '#bdbdbd');
    p.r(12, 16, 8, 6, '#333'); p.disc(16, 13, 2, '#d9905a'); p.r(13, 10, 7, 2, '#e8c040');
    p.ell(23, 29, 22, 1, '#9cc0a0');
    return c;
  }

  function gatorSign() {
    const { c, g } = mk(36, 44);
    const p = P(g);
    p.r(17, 22, 2, 22, '#6a5a40');
    p.r(0, 0, 36, 22, '#f2c40f'); p.rect(1, 1, 34, 20, '#222');
    p.text('GATOR', 18, 3, '#222', { align: 'center' });
    p.text('XING', 18, 12, '#222', { align: 'center' });
    return c;
  }

  // ------------------------------------------------------------------ scenery events
  // dolphin (nose to the right), drawn rotated by a degrees: nose up while rising, down while diving
  function dolphin(a) {
    const { c, g } = mk(46, 30);
    const p = P(g);
    const ca = Math.cos(a * Math.PI / 180), sa = Math.sin(a * Math.PI / 180);
    // rotate (x, y) pairs around (22, 9) and move them to the canvas centre
    const R = pts => { const o = []; for (let i = 0; i < pts.length; i += 2) { const x = pts[i] - 22, y = pts[i + 1] - 9; o.push(23 + x * ca - y * sa, 15 + x * sa + y * ca); } return o; };
    p.poly(R([7, 9, 1, 3, 4, 9]), '#3e5f80');                    // tail flukes
    p.poly(R([7, 9, 1, 15, 4, 9]), '#3e5f80');
    p.poly(R([19, 6, 25, 5, 16, 1]), '#3e5f80');                  // dorsal fin
    p.poly(R([6, 8, 14, 5, 24, 4.5, 33, 6, 40, 9, 34, 11.5, 16, 12, 6, 10]), '#5a82a8');
    p.poly(R([14, 10.5, 33, 10, 39, 9.5, 33, 12, 16, 12.2]), '#d4e2ea'); // belly
    const e = R([34, 7.5]); p.r(e[0], e[1], 1, 1, '#10202a');      // eye
    return c;
  }
  function splash() {
    const { c, g } = mk(40, 14);
    const p = P(g);
    p.ell(20, 11, 18, 3, '#bff4ff'); p.ell(20, 11, 12, 2, '#ffffff');
    for (const [x, h] of [[8, 5], [14, 9], [20, 11], [26, 8], [32, 5]]) p.r(x, 11 - h, 2, h, '#ffffff');
    return c;
  }
  // tumbleweed: a ball of tangled twigs, frame k rotates it by 22.5 deg
  function tumbleweed(k) {
    const { c, g } = mk(30, 30);
    const p = P(g);
    const rnd = rng32(77);
    for (let i = 0; i < 26; i++) {
      const a0 = rnd() * Math.PI * 2 + k * Math.PI / 8, a1 = a0 + 1 + rnd() * 2.5;
      const r0 = 6 + rnd() * 8, r1 = 6 + rnd() * 8;
      p.line(15 + Math.cos(a0) * r0, 15 + Math.sin(a0) * r0, 15 + Math.cos(a1) * r1, 15 + Math.sin(a1) * r1, i % 3 ? '#a8804a' : '#7a5a30');
    }
    return c;
  }

  // ------------------------------------------------------------------ Keys
  function sailboat(sail2) {
    const { c, g } = mk(38, 50);
    const p = P(g);
    p.r(18, 2, 1, 38, '#d8d8d8');
    p.poly([19, 3, 19, 38, 34, 38], '#fafafa');
    p.poly([17, 8, 17, 38, 5, 38], sail2);
    p.poly([2, 40, 36, 40, 31, 47, 7, 47], '#ffffff');
    p.r(4, 42, 30, 1, '#2a4a8a');
    p.ell(19, 48, 18, 1, '#d8f4ff');
    return c;
  }

  function lighthouse() {
    const { c, g } = mk(30, 100);
    const p = P(g);
    for (let y = 22; y < 92; y++) {
      const w = 10 + (y - 22) * 0.12;
      p.r(15 - w / 2, y, w, 1, Math.floor((y - 22) / 12) % 2 ? '#ffffff' : '#e02828');
    }
    p.r(8, 18, 14, 4, '#333'); p.r(10, 10, 10, 8, '#ffe680'); p.r(14, 10, 2, 8, '#c8a040');
    p.poly([8, 10, 22, 10, 15, 3], '#333'); p.r(14, 0, 2, 4, '#333');
    p.poly([0, 88, 30, 88, 26, 82, 4, 82], '#c83030'); p.r(0, 88, 30, 12, '#f4f4f4'); p.r(12, 92, 6, 8, '#333');
    return c;
  }

  function island() {
    const { c, g } = mk(84, 60);
    const p = P(g);
    p.ell(42, 55, 40, 4, '#7fe0e8'); p.ell(42, 53, 34, 4, '#f2d08a'); p.ell(42, 51, 26, 2, '#e8c070');
    drawPalm(p, 32, 52, 46, -0.3, PAL.tropic); drawPalm(p, 52, 52, 38, 0.4, PAL.tropic);
    return c;
  }

  function buoy() {
    const { c, g } = mk(10, 18);
    const p = P(g);
    p.ell(5, 15, 5, 2, '#a01818'); p.r(3, 4, 4, 11, '#e02020'); p.r(3, 8, 4, 2, '#ffffff');
    p.r(4, 1, 2, 3, '#555'); p.r(4, 0, 2, 1, '#ffe060');
    return c;
  }

  function railpost() {
    const { c, g } = mk(8, 26);
    const p = P(g);
    p.r(3, 3, 2, 23, '#e8e8ee'); p.r(1, 0, 6, 3, '#c8c8d0'); p.r(2, 3, 4, 1, '#fff6c0');
    return c;
  }

  // ------------------------------------------------------------------ Desert
  function motel() {
    const { c, g } = mk(68, 96);
    const p = P(g);
    p.r(32, 46, 4, 50, '#5a5a66');
    p.r(2, 4, 64, 42, '#1e1020'); p.rect(2, 4, 64, 42, '#20e0f0'); p.rect(4, 6, 60, 38, '#ff3f7a');
    p.text('MOTEL', 34, 12, '#ff5a8a', { align: 'center', scale: 2 });
    p.text('VACANCY', 34, 32, '#3aff7a', { align: 'center' });
    p.poly([46, 0, 66, 0, 66, 4, 46, 4], '#ffe14a');
    return c;
  }

  // ------------------------------------------------------------------ pickups and gantries
  function coinFrames() {
    const out = [];
    for (const hw of [6, 4, 1, 4]) {
      const { c, g } = mk(14, 14);
      const p = P(g);
      p.ell(7, 7, hw, 6, '#b8860b');
      if (hw > 1) p.ell(7, 7, hw - 1, 5, '#ffd23a');
      if (hw >= 4) { p.r(6, 4, 2, 6, '#fff3a0'); p.r(7 - hw + 1, 6, 1, 2, '#fff6c0'); }
      out.push(c);
    }
    return out;
  }

  function wrench() {
    const { c, g } = mk(16, 16);
    const p = P(g);
    p.disc(8, 8, 7, '#ffffff'); p.disc(8, 8, 6, '#1e6fff');
    p.line(4, 12, 11, 5, '#f2f2f2', 2);
    p.disc(11, 5, 2, '#f2f2f2'); p.r(11, 3, 2, 2, '#1e6fff');
    p.disc(4, 12, 1, '#f2f2f2');
    return c;
  }

  function arch(text, c1, c2) {
    const { c, g } = mk(160, 72);
    const p = P(g);
    p.r(0, 0, 8, 72, '#d8d8d8'); p.r(152, 0, 8, 72, '#d8d8d8');
    p.r(6, 0, 2, 72, '#9a9a9a'); p.r(158, 0, 2, 72, '#9a9a9a');
    p.r(0, 4, 160, 22, c1);
    for (let x = 0; x < 160; x += 4) {
      const o = (x / 4) % 2;
      p.r(x, 4 + o * 2, 4, 2, '#ffffff'); p.r(x, 22 + o * 2, 4, 2, '#ffffff');
    }
    p.text(text, 80, 9, c2, { align: 'center', scale: 2, shadow: '#000' });
    return c;
  }

  function forkSign(left, right) {
    const { c, g } = mk(200, 74);
    const p = P(g);
    p.r(2, 20, 6, 54, '#9a9aa2'); p.r(192, 20, 6, 54, '#9a9aa2');
    p.r(2, 22, 196, 4, '#7a7a82');
    for (const [x, name, dir] of [[14, left, -1], [102, right, 1]]) {
      p.r(x, 0, 84, 40, '#0b6e3a'); p.rect(x + 1, 1, 82, 38, '#ffffff');
      const ax = x + 42;
      if (dir < 0) p.poly([ax - 14, 12, ax - 4, 5, ax - 4, 9, ax + 14, 9, ax + 14, 15, ax - 4, 15, ax - 4, 19], '#ffffff');
      else p.poly([ax + 14, 12, ax + 4, 5, ax + 4, 9, ax - 14, 9, ax - 14, 15, ax + 4, 15, ax + 4, 19], '#ffffff');
      p.text(name, ax, 26, '#ffffff', { align: 'center' });
    }
    return spr(c, 3.25);
  }

  // ------------------------------------------------------------------ backgrounds
  // Sky: dithered colour bands, 320x100 (horizon at y=90).
  function sky(stops, seed, stars) {
    const { c, g } = mk(320, 100);
    const r = rng32(seed);
    const n = stops.length, bandH = 92 / n;
    for (let y = 0; y < 100; y++) {
      const f = y / bandH, i = Math.min(n - 1, Math.floor(f)), fr = f - i;
      g.fillStyle = stops[i]; g.fillRect(0, y, 320, 1);
      if (i < n - 1 && fr > 0.5) {
        g.fillStyle = stops[i + 1];
        const step = fr > 0.75 ? 2 : 4;
        for (let x = (y % 2) * (step / 2); x < 320; x += step) g.fillRect(x, y, 1, 1);
      }
    }
    for (let k = 0; k < stars; k++) {
      g.fillStyle = r() < 0.7 ? '#ffffff' : '#ffc8f0';
      g.fillRect((r() * 320) | 0, (r() * 40) | 0, 1, 1);
    }
    return c;
  }

  // Synthwave sun with horizontal cuts in the lower half.
  function sun(p, cx, cy, rad, cTop, cMid, cBot) {
    for (let dy = -rad; dy <= rad; dy++) {
      if (dy > 2 && (dy % 6) < Math.min(4, 1 + Math.floor((dy - 2) / 7))) continue;
      const t = (dy + rad) / (2 * rad);
      const col = t < 0.5 ? mix(cTop, cMid, t * 2) : mix(cMid, cBot, (t - 0.5) * 2);
      const hw = Math.round(Math.sqrt(rad * rad - dy * dy));
      p.r(cx - hw, cy + dy, hw * 2 + 1, 1, col);
    }
  }

  function glow(g, p, cx, cy, radii, col) {
    g.globalAlpha = 0.12;
    for (const rr of radii) p.disc(cx, cy, rr, col);
    g.globalAlpha = 1;
  }

  function skyline(p, r, x0, x1, hz, hMin, hMax, col, winCols, winP, deco) {
    let x = x0;
    while (x < x1) {
      const bw = 8 + ((r() * 14) | 0), bh = hMin + ((r() * (hMax - hMin)) | 0);
      p.r(x, hz - bh, bw, bh, col);
      if (deco) {
        p.r(x + 2, hz - bh - 3, bw - 4, 3, col);
        if (r() < 0.3) p.r(x + (bw >> 1), hz - bh - 8, 1, 5, col);
      }
      for (let wy = hz - bh + 3; wy < hz - 2; wy += 3) {
        for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
          if (r() < winP) p.r(wx, wy, 1, 1, winCols[(r() * winCols.length) | 0]);
        }
      }
      x += bw + (r() < 0.3 ? 3 + ((r() * 6) | 0) : 0);
    }
  }

  function bgMiami() {
    const r = rng32(1986);
    const skyC = sky(['#1a0b3d', '#2d0f5c', '#4b1370', '#7a1a80', '#b0257e', '#e0407a', '#ff6a5a', '#ff9a4a', '#ffc860'], 7, 40);
    // far: sun setting into the sea + art deco skyline on the shore
    const far = mk(640, 78); let p = P(far.g); const hz = 62;
    glow(far.g, p, 470, 36, [46, 41, 36], '#ffb070');
    sun(p, 470, 36, 30, '#fff27a', '#ff9a3a', '#ff2f8f');
    p.r(0, hz, 640, 16, '#3b2475');
    for (let y = hz + 1; y < 78; y++) {
      for (let k = 0; k < 10; k++) p.r(r() * 640, y, 4 + r() * 10, 1, '#55358f');
      if (y % 2 === 0) {
        const w = 44 - (y - hz) * 1.6;
        p.r(470 - w / 2 + (r() - 0.5) * 6, y, w, 1, y % 4 ? '#ff8a4a' : '#ffd06a');
      }
    }
    p.r(0, hz - 2, 320, 3, '#2a1050');
    skyline(p, r, 10, 300, hz - 1, 8, 32, '#3a1a66', ['#ff9ad0', '#ffd27a', '#7ae8ff'], 0.18, true);
    for (let k = 0; k < 6; k++) drawPalm(p, 20 + k * 50 + r() * 20, hz - 1, 18 + r() * 8, r() - 0.5, PAL.shadow);
    // clouds crossing the sun
    const cl = mk(640, 50); p = P(cl.g);
    for (let k = 0; k < 10; k++) {
      const x = r() * 640, y = 8 + r() * 36, len = 20 + r() * 40;
      p.ell(x, y, Math.round(len), 2, '#c84a9a');
      p.ell(x + 6, y - 1, Math.round(len * 0.65), 1, '#ff7ab0');
      p.r(x - len * 0.6, y + 2, len * 1.2, 1, '#ffb070');
    }
    // near: closer palm silhouettes
    const near = mk(640, 34); p = P(near.g);
    for (let k = 0; k < 9; k++) {
      const x = 20 + r() * 270;
      drawPalm(p, x, 33, 24 + r() * 10, (r() - 0.5) * 1.2, PAL.deep);
    }
    p.r(0, 32, 300, 2, '#1e0a3a');
    return { sky: skyC, fill: '#3b2475', layers: [{ img: far.c, y: 90 - hz, speed: 0.5 }, { img: cl.c, y: 6, speed: 0.3 }, { img: near.c, y: 90 - 34, speed: 0.9 }] };
  }

  function bgNeon() {
    const r = rng32(88);
    const skyC = sky(['#05021a', '#0c0430', '#1a0846', '#2e0c5c', '#4a1070', '#741a7e', '#a8287e'], 3, 90);
    { const p = P(skyC.getContext('2d')); p.disc(64, 22, 9, '#ffe8f8'); p.disc(68, 20, 8, '#0c0430'); }
    const far = mk(640, 78); let p = P(far.g); const hz = 62;
    p.r(0, hz, 640, 16, '#0e0824');
    skyline(p, r, 0, 640, hz, 14, 56, '#140a30', ['#ffd96a', '#6af0ff', '#ff8ad8'], 0.35, false);
    for (let k = 0; k < 20; k++) p.r(r() * 640, hz - 30 - r() * 26, 1, 1, '#ff3040');
    p.r(0, hz - 1, 640, 1, '#ff2bd6');
    const near = mk(640, 42); p = P(near.g);
    let x = 0;
    while (x < 640) {
      const bw = 14 + ((r() * 26) | 0), bh = 8 + ((r() * 28) | 0);
      const neon = ['#00f0ff', '#ff2bd6', '#ffe14a'][(r() * 3) | 0];
      p.r(x, 42 - bh, bw, bh, '#22104a'); p.r(x, 42 - bh, bw, 1, neon);
      if (r() < 0.4) p.r(x + 3, 42 - bh + 4, bw - 6, 3, neon);
      x += bw + ((r() * 18) | 0);
    }
    return { sky: skyC, fill: '#0e0824', layers: [{ img: far.c, y: 90 - hz, speed: 0.5 }, { img: near.c, y: 90 - 42, speed: 0.9 }] };
  }

  function bgBayou() {
    const r = rng32(311);
    const skyC = sky(['#24304e', '#3c3c62', '#6a4a6e', '#a8606a', '#e08a5a', '#f2b45e', '#f8d880'], 5, 10);
    const far = mk(640, 78); let p = P(far.g); const hz = 62;
    glow(far.g, p, 200, 44, [30, 25], '#fff0b0');
    p.disc(200, 44, 18, '#fff0b0');
    p.r(0, hz, 640, 16, '#3a4a42');
    for (let y = hz + 1; y < 78; y += 2) p.r(200 - 16 + (r() - 0.5) * 6, y, 32 - (y - hz), 1, '#f2d890');
    for (let x = 0; x < 640; x++) {
      const h = 8 + 5 * Math.sin(x * 0.05) + 3 * Math.sin(x * 0.17) + (x % 37 < 4 ? 8 : 0);
      p.r(x, hz - h, 1, h, '#28382a');
    }
    const near = mk(640, 24); p = P(near.g);
    let x = 0;
    while (x < 640) {
      const w = 30 + r() * 60;
      for (let k = 0; k < w; k++) {
        const h = 4 + 6 * Math.sin((k / w) * Math.PI) + r() * 3;
        p.r(x + k, 24 - h, 1, h, '#18261a');
      }
      x += w + r() * 60;
    }
    return { sky: skyC, fill: '#3a4a42', layers: [{ img: far.c, y: 90 - hz, speed: 0.5 }, { img: near.c, y: 90 - 24, speed: 0.9 }] };
  }

  function bgKeys() {
    const r = rng32(1234);
    const skyC = sky(['#1b5fc0', '#2a74d4', '#3e8ae0', '#58a2ea', '#78baf2', '#9cd2f8', '#c4e8fc'], 9, 0);
    const far = mk(640, 78); let p = P(far.g); const hz = 62;
    p.r(0, hz, 640, 16, '#1a8ec0');
    for (let y = hz + 1; y < 78; y++) for (let k = 0; k < 8; k++) p.r(r() * 640, y, 3 + r() * 8, 1, '#3aa8d8');
    for (let k = 0; k < 5; k++) {
      const x = r() * 600;
      p.ell(x, hz, Math.round(14 + r() * 16), 3, '#2a8a4a'); p.r(x - 10, hz, 20, 1, '#f2d08a');
      drawPalm(p, x, hz - 1, 12, r() - 0.5, PAL.tropic);
    }
    p.r(330, hz - 4, 240, 1, '#d8d8d8');
    for (let x = 334; x < 570; x += 12) p.r(x, hz - 4, 1, 4, '#c8c8c8');
    for (let k = 0; k < 6; k++) { const x = r() * 640; p.poly([x, hz - 6, x, hz - 1, x + 4, hz - 1], '#ffffff'); }
    const cl = mk(640, 60); p = P(cl.g);
    for (let k = 0; k < 9; k++) {
      const x = r() * 620, y = 14 + r() * 36;
      for (let j = 0; j < 5; j++) p.disc(x + j * 7 - 14, y - (j % 2) * 4, Math.round(5 + r() * 4), '#ffffff');
      p.r(x - 22, y + 3, 44, 3, '#d8ecff');
    }
    return { sky: skyC, fill: '#1a8ec0', layers: [{ img: far.c, y: 90 - hz, speed: 0.5 }, { img: cl.c, y: 0, speed: 0.25 }] };
  }

  function bgDesert() {
    const r = rng32(777);
    const skyC = sky(['#1e0c3e', '#3c1250', '#6a1a5a', '#a42a5a', '#e2484a', '#ff7a3a', '#ffb24a'], 11, 50);
    const far = mk(640, 78); let p = P(far.g); const hz = 62;
    glow(far.g, p, 330, 40, [38, 33], '#ffb070');
    sun(p, 330, 40, 26, '#ffe070', '#ff8a3a', '#ff3a6a');
    p.r(0, hz, 640, 16, '#7a2a2a');
    let x = 0;
    while (x < 640) {
      const w = 30 + r() * 60, h = 10 + r() * 24, s = 6 + r() * 8;
      p.poly([x, hz, x + s, hz - h, x + w - s, hz - h, x + w, hz], '#5a1a3a');
      p.r(x + s, hz - h, w - 2 * s, 1, '#8a3a5a');
      x += w + r() * 50;
    }
    const near = mk(640, 30); p = P(near.g);
    x = 0;
    while (x < 640) {
      const w = 40 + r() * 50, h = 8 + r() * 14, s = 5 + r() * 6;
      p.poly([x, 30, x + s, 30 - h, x + w - s, 30 - h, x + w, 30], '#8a3424');
      p.r(x + s, 30 - h, w - 2 * s, 1, '#c0583a');
      x += w + 40 + r() * 80;
    }
    return { sky: skyC, fill: '#7a2a2a', layers: [{ img: far.c, y: 90 - hz, speed: 0.5 }, { img: near.c, y: 90 - 30, speed: 0.9 }] };
  }

  // ------------------------------------------------------------------ smoke puffs
  // A soft pixel cloud: overlapping discs, lit from the top-left, with a ragged edge.
  function puff(seed, light, mid, dark) {
    const { c, g } = mk(32, 32);
    const p = P(g), r = rng32(seed);
    const blobs = [];
    for (let i = 0; i < 7; i++) {
      const a = r() * Math.PI * 2, d = r() * 7;
      blobs.push([16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 5 + r() * 5]);
    }
    for (const [x, y, rad] of blobs) p.disc(Math.round(x + 1), Math.round(y + 1), Math.round(rad), dark);
    for (const [x, y, rad] of blobs) p.disc(Math.round(x), Math.round(y), Math.round(rad - 1), mid);
    for (const [x, y, rad] of blobs) p.disc(Math.round(x - 1), Math.round(y - 2), Math.round(rad * 0.55), light);
    return c;
  }

  // ------------------------------------------------------------------ bitmap sprites (assets/sprites.png, see js/atlas.js)
  let sheet = null;
  function atl(name, o = {}) {
    const [x, y, w, h] = ATLAS[name];
    const { c, g } = mk(w, h);
    if (o.flip) { g.translate(w, 0); g.scale(-1, 1); }
    g.drawImage(sheet, x, y, w, h, 0, 0, w, h);
    if (o.tint) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = o.tint; g.fillRect(0, 0, w, h);
    }
    return c;
  }
  // Bitmap sprite sized by its world height; the collision box is centred on the
  // trunk/pole base measured by the build script (unless o.cx is given).
  function bs(name, worldH, cw = 0.8, o = {}) {
    const c = atl(name, o), base = ATLAS[name][4];
    const cx = o.cx !== undefined ? o.cx : (o.flip ? 1 - base : base);
    return spr(c, worldH / (c.height * K), cx, cw);
  }
  // name list -> sprites, each also mirrored for variety
  const both = (names, worldH, cw, o = {}) =>
    names.flatMap(n => [bs(n, worldH, cw, o), bs(n, worldH, cw, Object.assign({}, o, { flip: true }))]);

  // ------------------------------------------------------------------ init
  function init(img) {
    sheet = img;
    // player car: every frame shares one scale so the 82 px straight frame is drawn 1:1
    const pm = 512 / (ATLAS.car0[2] * K);
    // each frame carries its ground shadow (built offline along the tyre contact line,
    // SHADOW_M = 8 px wider than the frame on both sides, same top edge)
    // and 4 wheel-animation copies (rotating rims / scrolling tread), cycled with speed
    const car = n => Object.assign(spr(atl(n), pm), {
      shadow: atl('shadow_' + n), shadowM: 8,
      wheels: [0, 1, 2, 3].map(k => atl(n + '_w' + k))
    });
    // carTurn: nose turning left (right flank visible); carTurnR is its mirror
    SPR.playerBrake = car('carBrake');
    SPR.player = [car('carTurn'), car('car0'), car('carTurnR')];
    // traffic: all sheet cars share one scale (a ~128 px car is ~470 world units wide)
    SPR.cars = Object.keys(ATLAS).filter(n => n.startsWith('traffic'))
      .map(n => Object.assign(spr(atl(n), 470 / (128 * K)), { name: n }));

    const palms = ['palm0', 'palm1', 'palm2', 'palm3', 'palm4'];
    SPR.palm = both(palms, 3000, 0.12);
    SPR.palmNight = both(palms, 3000, 0.12, { tint: 'rgba(40,10,80,0.55)' });
    const hotels = [['#ffb3c7', '#ff3fa4', '#20e0f0', 'HOTEL'], ['#a8f0d0', '#20a8b8', '#ff3fa4', 'TIDES'], ['#c8b6ff', '#7a5cff', '#ffe14a', 'LUNA'],
      ['#ffe7a3', '#ff8a3a', '#ff3fa4', 'CORAL'], ['#ffc8a0', '#ff5a6a', '#20e0f0', 'PALMS'], ['#9fe6f0', '#2a7ad8', '#ff7ad0', 'AZUL']];
    SPR.hotel = hotels.map((h, i) => spr(hotel(h[0], h[1], h[2], h[3], i + 1), 6.5, 0.5, 0.9));
    SPR.umbrella = both(['umbrella'], 850, 0.12);
    SPR.chair = both(['chair'], 420, 0.8);
    SPR.beachgoer = both(['girl', 'guy'], 470, 0.6);
    SPR.flowers = both(['flowerbush0', 'flowerbush1', 'hibiscus0', 'hibiscus1'], 480, 0.8);
    SPR.billboard = [bs('billSunset', 1900, 0.9), bs('billPalm', 1900, 0.9)];
    SPR.streetlamp = [bs('lampTriple', 2300, 0.15)];
    SPR.lifeguard = [spr(lifeguard('#ff8fc4', '#ffe14a', '#20c8d8'), 3.5, 0.45, 0.6), spr(lifeguard('#9fe6f0', '#ff5a8a', '#ffd23a'), 3.5, 0.45, 0.6)];
    SPR.surfboard = [['#ff3fa4', '#ffffff'], ['#20c8d8', '#ffe14a'], ['#ffd23a', '#ff5a6a'], ['#7a5cff', '#ffffff']].map(s => spr(surfboard(s[0], s[1]), 2.2, 0.5, 0.6));
    SPR.surfer = [spr(surfer('#d9905a', '#ff3fa4', '#ffd23a'), 3), spr(flip(surfer('#b8743e', '#20c8d8', '#ff5a6a')), 3)];
    SPR.oceansign = [spr(oceanSign(), 4.5, 0.5, 0.9)];
    SPR.cheer = both(Object.keys(ATLAS).filter(n => n.startsWith('person')), 480, 0.6);

    SPR.skyscraper = [0, 1, 2, 3, 4].map(i => spr(skyscraper(i), 7, 0.5, 0.8));
    // lamp arms point right in the sheet: as-is on the left kerb, mirrored on the right one
    SPR.lampL = ['lampA', 'lampD'].map(n => bs(n, 2400, 0.12));
    SPR.lampR = ['lampA', 'lampD'].map(n => bs(n, 2400, 0.12, { flip: true }));
    SPR.neonsign = [['ARCADE', '#00f0ff', '#ff2bd6'], ['DISCO', '#ff2bd6', '#ffe14a'], ['TURBO', '#ffe14a', '#00f0ff'],
      ['VAPOR', '#7a5cff', '#ff8ad8'], ['RADICAL', '#ff3040', '#00f0ff']].map(n => spr(neonSign(n[0], n[1], n[2]), 4.5, 0.5, 0.9));
    SPR.neonarrow = [bs('arrowSign', 1500, 0.2)];
    // night lights: [x, y (fractions of the sprite), glow radius (fraction of the height), rgb, kind]
    // kind 'lamp' also lights the ground, 'neon' buzzes off now and then, 'beam' turns (lighthouse)
    const lit = (list, lights) => list.forEach(s => { s.lights = lights; });
    const WARM = '255,214,140';
    lit(SPR.streetlamp, [[0.16, 0.19, 0.1, WARM, 'lamp'], [0.48, 0.09, 0.12, WARM, 'lamp'], [0.84, 0.19, 0.1, WARM, 'lamp']]);
    lit([SPR.lampL[0]], [[0.8, 0.055, 0.12, WARM, 'lamp']]); lit([SPR.lampR[0]], [[0.2, 0.055, 0.12, WARM, 'lamp']]);
    lit([SPR.lampL[1]], [[0.74, 0.2, 0.12, WARM, 'lamp']]); lit([SPR.lampR[1]], [[0.26, 0.2, 0.12, WARM, 'lamp']]);
    SPR.neonsign.forEach((s, i) => { s.lights = [[0.5, 0.32, 0.55, hex2rgb(['#00f0ff', '#ff2bd6', '#ffe14a', '#7a5cff', '#ff3040'][i]).join(','), 'neon']]; });
    lit(SPR.oceansign, [[0.5, 0.32, 0.6, '32,224,240', 'neon']]);
    lit(SPR.neonarrow, [[0.5, 0.35, 0.45, '255,60,200', 'neon']]);
    SPR.dolphin = [-28, 0, 28].map(a => spr(dolphin(a), 3.4));
    SPR.splash = spr(splash(), 3);
    SPR.tumble = [0, 1, 2, 3].map(k => spr(tumbleweed(k), 2.2));

    SPR.tree = both(['treeCone', 'treeA', 'treeB', 'treeBig', 'treeRound'], 3400, 0.15);
    SPR.flamingo = both(['flamingo'], 760, 0.5);
    SPR.airboat = [spr(airboat(), 3), spr(flip(airboat()), 3)];
    SPR.bush = both(['shrub', 'fern', 'agave'], 650, 0.7);
    SPR.gatorsign = [spr(gatorSign(), 2.5, 0.5, 0.2)];
    SPR.curvesign = [bs('curveSign', 1300, 0.2)];

    SPR.sailboat = ['#ff6a8a', '#ffd23a', '#20c8d8'].map(c => spr(sailboat(c), 4));
    SPR.lighthouse = [spr(lighthouse(), 5)];
    SPR.lighthouse[0].lights = [[0.5, 0.14, 0.12, '255,240,170', 'beam']];
    SPR.island = [spr(island(), 6)];
    SPR.buoy = [spr(buoy(), 2.5)];
    SPR.railpost = [spr(railpost(), 2.5)];

    SPR.cactus = both(['cactus'], 2000, 0.35);
    SPR.agave = both(['agave'], 700, 0.7);
    SPR.rock = [['rockBig', 1500], ['rockMid', 1150], ['rockSmall', 850], ['rockFlat', 650], ['boulders', 1500], ['rocks2', 1100]]
      .flatMap(([n, h]) => both([n], h, 0.8));
    SPR.route66 = [bs('route66', 1400, 0.2)];
    SPR.chevron = [bs('chevron', 1300, 0.2)];
    SPR.motel = [spr(motel(), 4, 0.5, 0.15)];
    lit(SPR.motel, [[0.5, 0.26, 0.4, '255,63,122', 'neon']]);

    // smoke textures by kind: tyre smoke, off-road dust, damaged-engine smoke
    const puffs = (l, m, d) => [1, 2, 3, 4].map(i => puff(i * 7 + l.length, l, m, d));
    SPR.puff = {
      tyre: puffs('#fbfbff', '#dcdee8', '#a9adbd'),
      dust: puffs('#f3e1b8', '#d8bd8a', '#a68a5e'),
      dark: puffs('#77777f', '#55555d', '#34343a')
    };
    SPR.coin = coinFrames().map(c => spr(c, 1.8));
    SPR.wrench = spr(wrench(), 1.6);
    SPR.archStart = [spr(arch('START', '#ff3fa4', '#ffffff'), 3.6)];
    SPR.archCheck = [spr(arch('CHECKPOINT', '#1e6fff', '#ffe14a'), 3.6)];
    SPR.archGoal = [spr(arch('GOAL', '#20b050', '#ffffff'), 3.6)];

    BG.miami = bgMiami();
    BG.neon = bgNeon();
    BG.bayou = bgBayou();
    BG.keys = bgKeys();
    BG.desert = bgDesert();
  }

  return { K, SPR, BG, init, forkSign, rng32, shade, mix, sheet: () => sheet };
})();
