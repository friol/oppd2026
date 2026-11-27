// More generators (studies 21-22), same contract as js/styles.js.

// ---------------------------------------------------------------------------
// 21. Op Waves: flat bands of two colours whose edges ripple, with the
//     ripple swelling and fading across the sheet (Op Art).
STYLES.push({
  id: 'opwaves', name: 'Op Waves', medium: 'Serigraph · rippling bands', aspect: 4 / 5,
  palettes: [
    ['#1b1b1b', '#efebe2'], ['#b3252a', '#efe8d6'], ['#1d3f8a', '#f4d31c'], ['#12775a', '#f2e8d0'],
    ['#1b1b1b', '#efebe2', '#d6145c'], ['#16244a', '#efe6cf', '#f68b1f', '#efe6cf'],
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const bands = r.int(28, 48), vertical = r.chance(0.35);
    const k = r.range(1.5, 5), amp = r.range(0.5, 1.6), spread = r.range(0.15, 0.35);
    const centre = r.range(0.3, 0.7), shear = r.range(-1.5, 1.5), speed = r.range(0.3, 0.7) * (r.chance(0.5) ? 1 : -1);
    return {
      paper: '#f2efe8',
      draw(c, w, h, t) {
        // Work in a frame where bands are horizontal; turn it for vertical bands.
        const W = vertical ? h : w, H = vertical ? w : h;
        c.save();
        if (vertical) { c.translate(w, 0); c.rotate(Math.PI / 2); }
        c.beginPath();
        c.rect(0, 0, W, H);
        c.clip();
        const bh = H / bands, N = 120;
        const edge = (j, u) => {
          // Ripple strongest around 'centre', fading towards the sides.
          const env = Math.exp(-((u - centre) ** 2) / (2 * spread * spread));
          return j * bh + Math.sin(u * k * TAU + j * shear * 0.2 + t * speed) * amp * bh * env;
        };
        // Extra bands beyond both ends: wide ripples must not open gaps at the edges.
        for (let j = -3; j <= bands + 2; j++) {
          c.beginPath();
          for (let i = 0; i <= N; i++) { const u = i / N; c.lineTo(u * W, edge(j, u)); }
          for (let i = N; i >= 0; i--) { const u = i / N; c.lineTo(u * W, edge(j + 1, u)); }
          c.closePath();
          c.fillStyle = pal[(j + pal.length * 4) % pal.length];
          c.fill();
        }
        c.restore();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 22. Unknown Script: a page of invented writing. Each piece makes its own
//     alphabet of glyphs from strokes on a 3x3 grid, then writes words with
//     it, line by line; afterwards a letter now and then rewrites itself.
STYLES.push({
  id: 'glyphs', name: 'Unknown Script', medium: 'Pen plotter · invented alphabet', aspect: 3 / 4,
  palettes: [
    { paper: '#efebe2', ink: '#1d1b18', rubric: '#b3252a' }, { paper: '#ece9e1', ink: '#23295a', rubric: '#c8282a' },
    { paper: '#1c1a22', ink: '#efe6cf', rubric: '#f2a01c' }, { paper: '#f0e6cc', ink: '#3a2412', rubric: '#7a1420' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    // Nodes of the 3x3 grid and the short strokes that join neighbours.
    const nodes = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) nodes.push([x / 2, y / 2]);
    const links = [];
    for (let a = 0; a < 9; a++) for (let b = a + 1; b < 9; b++) {
      const dx = Math.abs(nodes[a][0] - nodes[b][0]), dy = Math.abs(nodes[a][1] - nodes[b][1]);
      if (dx <= 0.5 && dy <= 0.5) links.push([a, b]);
    }
    const curvy = r.chance(0.4);
    const makeGlyph = () => {
      const strokes = [];
      for (let i = r.int(3, 5); i > 0; i--) {
        const [a, b] = r.pick(links);
        strokes.push({ a, b, bend: curvy && r.chance(0.5) ? r.range(-0.35, 0.35) : 0 });
      }
      return { strokes, dot: r.chance(0.2) ? r.int(0, 8) : -1 };
    };
    const alphabet = Array.from({ length: r.int(18, 30) }, makeGlyph);
    const cols = r.int(14, 22), rowsPerLine = 1;
    const lines = Math.round(cols * (4 / 3) * 0.62);
    // The text: words of 2-7 letters separated by spaces (-1), in paragraphs.
    const text = [];
    let paraStart = true;
    for (let row = 0; row < lines; row++) {
      if (r.chance(0.12) && row > 0) { for (let i = 0; i < cols; i++) text.push(-2); paraStart = true; continue; }
      let col = 0;
      while (col < cols) {
        const len = Math.min(cols - col, r.int(2, 7));
        for (let i = 0; i < len; i++) text.push(r.int(0, alphabet.length - 1) + (paraStart && i === 0 ? 1000 : 0));
        paraStart = false;
        col += len;
        if (col < cols) { text.push(-1); col++; }
      }
    }
    const fade = new Float32Array(text.length).fill(1);
    // Seeded randomness for the growth, so the same piece always grows the same way.
    const rnd = U.rng(r.int(1, 2e9));
    const WRITE = 6;
    let last = 0;
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const dt = Math.max(0, t - last);
        last = t;
        // After the page is written, a letter now and then changes.
        if (t > WRITE && rnd() < dt * 1.5) {
          const i = (rnd() * text.length) | 0;
          if (text[i] >= 0) { text[i] = (rnd() * alphabet.length) | 0; fade[i] = 0; }
        }
        const cw = w / cols, lh = h / lines * rowsPerLine;
        const g = Math.min(cw, lh * 0.8) * 0.8;
        const shown = Math.floor(text.length * Math.min(1, t / WRITE));
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.lineWidth = Math.max(1, g * 0.1);
        for (let i = 0; i < shown; i++) {
          let code = text[i];
          if (code < 0) continue;
          const rubric = code >= 1000;
          if (rubric) code -= 1000;
          fade[i] = Math.min(1, fade[i] + dt * 1.5);
          const col = i % cols, row = (i / cols) | 0;
          const ox = col * cw + (cw - g) / 2, oy = row * lh + (lh - g) / 2;
          const gl = alphabet[code];
          c.globalAlpha = fade[i];
          c.strokeStyle = c.fillStyle = rubric ? pal.rubric : pal.ink;
          c.beginPath();
          for (const s of gl.strokes) {
            const A = nodes[s.a], B = nodes[s.b];
            const ax = ox + A[0] * g, ay = oy + A[1] * g, bx = ox + B[0] * g, by = oy + B[1] * g;
            c.moveTo(ax, ay);
            if (s.bend) {
              const mx = (ax + bx) / 2 - (by - ay) * s.bend, my = (ay + by) / 2 + (bx - ax) * s.bend;
              c.quadraticCurveTo(mx, my, bx, by);
            } else c.lineTo(bx, by);
          }
          c.stroke();
          if (gl.dot >= 0) {
            c.beginPath();
            c.arc(ox + nodes[gl.dot][0] * g, oy + nodes[gl.dot][1] * g, c.lineWidth * 0.9, 0, TAU);
            c.fill();
          }
        }
        c.globalAlpha = 1;
      },
    };
  },
});
