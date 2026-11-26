// Shared helpers: random numbers, colours, event bus, pixel font and sprite drawing.
'use strict';

const U = {
  rand: (a, b) => a + Math.random() * (b - a),
  irand: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  chance: p => Math.random() < p,
  clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  },
  money(n) {
    const s = '€' + Math.abs(Math.round(n)).toLocaleString('en-US');
    return n < 0 ? '-' + s : s;
  },
  cap: s => s.charAt(0).toUpperCase() + s.slice(1),
  esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)] || 'th'); },

  // Colour helpers on '#rrggbb' strings.
  hex2rgb: h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)],
  rgb2hex: (r, g, b) => '#' + [r, g, b].map(v => Math.round(U.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''),
  mix(a, b, t) {
    const x = U.hex2rgb(a), y = U.hex2rgb(b);
    return U.rgb2hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  },
  shade: (c, t) => t > 0 ? U.mix(c, '#ffffff', t) : U.mix(c, '#000000', -t)
};

// Tiny publish/subscribe bus between simulation, renderer and UI.
const BUS = {
  h: {},
  on(e, f) { (this.h[e] = this.h[e] || []).push(f); },
  emit(e, d) { (this.h[e] || []).forEach(f => f(d)); }
};

// 3x5 pixel font for labels drawn inside the canvas: five rows of three cells per glyph.
const FONT = {
  'A': '.#.#.#####.##.#',
  'B': '##.#.###.#.###.',
  'C': '.###..#..#...##',
  'D': '##.#.##.##.###.',
  'E': '####..##.#..###',
  'F': '####..##.#..#..',
  'G': '.###..#.##.#.##',
  'H': '#.##.#####.##.#',
  'I': '###.#..#..#.###',
  'J': '..#..#..##.#.#.',
  'K': '#.##.###.#.##.#',
  'L': '#..#..#..#..###',
  'M': '#.########.##.#',
  'N': '##.#.##.##.##.#',
  'O': '.#.#.##.##.#.#.',
  'P': '##.#.###.#..#..',
  'Q': '.#.#.##.###..##',
  'R': '##.#.###.#.##.#',
  'S': '.###...#...###.',
  'T': '###.#..#..#..#.',
  'U': '#.##.##.##.####',
  'V': '#.##.##.##.#.#.',
  'W': '#.##.########.#',
  'X': '#.##.#.#.#.##.#',
  'Y': '#.##.#.#..#..#.',
  'Z': '###..#.#.#..###',
  '0': '####.##.##.####',
  '1': '.#.##..#..#.###',
  '2': '##...#.#.#..###',
  '3': '##...#.#...###.',
  '4': '#.##.####..#..#',
  '5': '####..##...###.',
  '6': '.###..####.####',
  '7': '###..#.#..#..#.',
  '8': '####.#####.####',
  '9': '####.####..###.',
  ' ': '...............',
  '.': '.............#.',
  '!': '.#..#..#.....#.',
  '-': '......###......',
  ':': '....#.....#....',
  '?': '##...#.#.....#.',
  '/': '..#..#.#.#..#..',
  "'": '.#..#..........',
  '&': '.#.#.#.#.#.#.##',
  ',': '..........#.#..',
  '+': '....#.###.#....',
  '"': '#.##.#.........',
  '€': '.###..####...##',
};

const PIX = {
  // Draw text with the pixel font; returns the width in pixels.
  text(ctx, str, x, y, color) {
    ctx.fillStyle = color;
    // Strip accents (CAFFÈ -> CAFFE): the pixel font has no accented letters.
    str = String(str).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    for (let i = 0; i < str.length; i++) {
      const g = FONT[str[i]] || FONT['?'];
      for (let p = 0; p < 15; p++) if (g[p] === '#') ctx.fillRect(x + i * 4 + (p % 3), y + Math.floor(p / 3), 1, 1);
    }
    return str.length * 4 - 1;
  },
  // Draw a sprite given as rows of characters; '.' and ' ' are transparent.
  spr(ctx, x, y, rows, pal, flip) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;
        const col = pal[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(x + (flip ? row.length - 1 - c : c), y + r, 1, 1);
      }
    }
  },
  rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
};
