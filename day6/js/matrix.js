// Round dot-matrix display of the hub: static text, a small label above and below and big digits in the middle.
// Renders a scene into an N×N brightness map (row 0 = far edge of the hub, the top on screen).
const DotMatrix = (() => {
  const N = 48, C = N / 2;
  const TOP_Y = 10, BIG_Y = 17, BOTTOM_Y = 33; // first row of the top label, the big text and the bottom label
  const PROGRESS_R = [22.6, 23.6];             // progress ring along the rim, in dots
  const GHOST = 0.07;                          // s, LCD afterglow of dots turning off

  // Big font, 5×7 drawn at twice the size (two or three characters fit); rows top to bottom
  const BIG_SRC = {
    A: '01110 10001 10001 11111 10001 10001 10001', E: '11111 10000 10000 11110 10000 10000 11111',
    G: '01110 10001 10000 10111 10001 10001 01111', O: '01110 10001 10001 10001 10001 10001 01110',
    0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
    2: '01110 10001 00001 00010 00100 01000 11111', 3: '11111 00010 00100 00010 00001 10001 01110',
    4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
    6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000',
    8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
    '-': '00000 00000 00000 11111 00000 00000 00000', ' ': '000 000 000 000 000 000 000'
  };

  // Small font for the labels, 3×5 (nine characters fit on a line)
  const SMALL_SRC = {
    A: '010 101 111 101 101', B: '110 101 110 101 110', C: '011 100 100 100 011', D: '110 101 101 101 110',
    E: '111 100 110 100 111', F: '111 100 110 100 100', G: '011 100 101 101 011', H: '101 101 111 101 101',
    I: '111 010 010 010 111', J: '001 001 001 101 010', K: '101 101 110 101 101', L: '100 100 100 100 111',
    M: '101 111 111 101 101', N: '110 101 101 101 101', O: '010 101 101 101 010', P: '110 101 110 100 100',
    Q: '010 101 101 110 011', R: '110 101 110 101 101', S: '011 100 010 001 110', T: '111 010 010 010 010',
    U: '101 101 101 101 011', V: '101 101 101 101 010', W: '101 101 111 111 101', X: '101 101 010 101 101',
    Y: '101 101 010 010 010', Z: '111 001 010 100 111',
    0: '111 101 101 101 111', 1: '010 110 010 010 111', 2: '110 001 010 100 111', 3: '110 001 010 001 110',
    4: '101 101 111 001 001', 5: '111 100 110 001 110', 6: '011 100 111 101 111', 7: '111 001 010 010 010',
    8: '111 101 111 101 111', 9: '111 101 111 001 110',
    '!': '1 1 1 0 1', '-': '000 000 111 000 000', ' ': '00 00 00 00 00'
  };

  // Glyph columns as bit masks, bit 0 = top row
  function parse(src) {
    const font = {};
    for (const ch in src) {
      const rows = src[ch].split(' ');
      const cols = [];
      for (let x = 0; x < rows[0].length; x++) {
        let m = 0;
        rows.forEach((r, y) => { if (r[x] === '1') m |= 1 << y; });
        cols.push(m);
      }
      font[ch] = cols;
    }
    return font;
  }
  const BIG = parse(BIG_SRC), SMALL = parse(SMALL_SRC);

  // Radius and angle (clockwise from the top, 0..1) of every dot centre
  const R = new Float32Array(N * N), A = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - C, dy = y + 0.5 - C;
      R[y * N + x] = Math.hypot(dx, dy);
      A[y * N + x] = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1;
    }
  }

  function create() {
    const target = new Float32Array(N * N), shown = new Float32Array(N * N), bytes = new Uint8Array(N * N);

    // Text centred horizontally from row y0, every font dot drawn as a size×size block
    function text(str, font, y0, size) {
      const glyphs = [...String(str).toUpperCase()].map(ch => font[ch] || font[' ']);
      const w = glyphs.reduce((s, g) => s + (g.length + 1) * size, 0) - size;
      let x = Math.round(C - w / 2);
      for (const g of glyphs) {
        for (const m of g) {
          for (let gy = 0; gy < 7; gy++) {
            if (!(m >> gy & 1)) continue;
            for (let k = 0; k < size * size; k++) {
              const px = x + k % size, py = y0 + gy * size + Math.floor(k / size);
              if (px >= 0 && px < N && py >= 0 && py < N) target[py * N + px] = 1;
            }
          }
          x += size;
        }
        x += size;
      }
    }

    // scene: { top: label, center: short big text, bottom: label, progress: 0..1 | null }
    function render(scene, dt) {
      target.fill(0);
      if (scene.top) text(scene.top, SMALL, TOP_Y, 1);
      if (scene.center) text(scene.center, BIG, BIG_Y, 2);
      if (scene.bottom) text(scene.bottom, SMALL, BOTTOM_Y, 1);
      if (scene.progress != null) {
        for (let i = 0; i < N * N; i++) {
          if (R[i] >= PROGRESS_R[0] && R[i] < PROGRESS_R[1]) target[i] = A[i] < scene.progress ? 1 : 0.14;
        }
      }
      const fade = Math.exp(-Math.max(0, dt) / GHOST);
      for (let i = 0; i < N * N; i++) {
        shown[i] = Math.max(target[i], shown[i] * fade);
        bytes[i] = Math.min(255, Math.round(shown[i] * 255));
      }
      return bytes;
    }

    return { render, N };
  }

  return { create, N };
})();
