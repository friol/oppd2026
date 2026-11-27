// The generators. Each style has an id, a name, a medium, an aspect ratio (w / h)
// and make(rand, noise) which returns a piece: { paper, draw(ctx, w, h, t) }.
// draw() paints the inner area of the print (margins are handled by the app),
// t is the time in seconds since the piece appeared.
const STYLES = [];

// Helpers shared by several styles.
function visibleSides(front, back, center, V, cb) {
  // Calls cb(k) for each side of a box whose back face is moved toward V
  // and whose side faces are therefore visible.
  for (let k = 0; k < front.length; k++) {
    const p1 = front[k], p2 = front[(k + 1) % front.length];
    let nx = p2.y - p1.y, ny = -(p2.x - p1.x);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    if (nx * (mx - center.x) + ny * (my - center.y) < 0) { nx = -nx; ny = -ny; }
    if (nx * (V.x - mx) + ny * (V.y - my) > 0) cb(k, p1, p2, back[k], back[(k + 1) % back.length]);
  }
}

function quad(c, a, b, d, e) {
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath();
}

// ---------------------------------------------------------------------------
// 1. Diamond Variation: a diamond of extruded rhombic tiles, torn by a splash.
STYLES.push({
  id: 'diamond', name: 'Diamond Variation', medium: 'Serigraph · displaced rhombic lattice', aspect: 1,
  palettes: [
    { paper: '#ece5d6', tops: ['#e8aa52', '#cf7a33', '#a9541f'], dark: '#5e2412', deep: '#2b0d06', line: '#f6dcae' },
    { paper: '#e9e8e2', tops: ['#a8cfe0', '#6a9fc0', '#3f6f96'], dark: '#1f3d5c', deep: '#0b1a2b', line: '#eef6fa' },
    { paper: '#ebe6d9', tops: ['#c9cf7a', '#8fa44a', '#5d7a32'], dark: '#2f4219', deep: '#141f0a', line: '#f1f2cf' },
    { paper: '#eee4dc', tops: ['#f0a0a8', '#d8606e', '#a8324a'], dark: '#5a1426', deep: '#2a0712', line: '#fbe0e2' },
    { paper: '#e8e4dc', tops: ['#d8d2c4', '#a39b8c', '#6f6658'], dark: '#3a342c', deep: '#16130f', line: '#f8f4ea' },
    { paper: '#efe9dc', tops: ['#f3c64a', '#e0703a', '#7a5ab0'], dark: '#3a2460', deep: '#170c28', line: '#fff1c8' },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const N = r.int(8, 12), M = Math.round(N * r.range(1.5, 2.1));
    const nf = r.range(0.18, 0.4), tone = [];
    for (let i = 0; i < N; i++) {
      tone[i] = [];
      for (let j = 0; j < M; j++) {
        const v = noise(i * nf, j * nf * 0.6, 3.3) + (r() - 0.5) * 0.5;
        tone[i][j] = v < -0.18 ? 2 : v < 0.18 ? 1 : 0;
      }
    }
    const c0 = { x: r.range(0.35, 0.65), y: r.range(0.4, 0.65) };
    const ang0 = r.range(0, TAU), spin = r.range(-0.08, 0.08);
    const power = r.range(0.7, 1.3), sigma = r.range(0.14, 0.24), gap = r.range(0.84, 0.94);
    const ph = r.range(0, TAU);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const S = Math.min(w, h), top = { x: w / 2, y: (h - S) / 2 };
        const ux = S / 2 / N, uy = S / 2 / N, vx = -S / 2 / M, vy = S / 2 / M;
        const grow = U.ease(U.clamp(t / 4, 0, 1));
        const pulse = (0.55 + 0.45 * Math.sin(t * 0.35 + ph)) * grow;
        const C = { x: w * (c0.x + 0.12 * Math.sin(t * 0.11 + ph)), y: h * (c0.y + 0.1 * Math.sin(t * 0.083)) };
        const a = ang0 + spin * t, dx = Math.cos(a), dy = Math.sin(a);
        const pts = [];
        for (let i = 0; i <= N; i++) {
          pts[i] = [];
          for (let j = 0; j <= M; j++) {
            const x = top.x + i * ux + j * vx, y = top.y + i * uy + j * vy;
            const ex = x - C.x, ey = y - C.y;
            const f = Math.exp(-(ex * ex + ey * ey) / ((S * sigma) ** 2)) * power * pulse;
            pts[i][j] = { x: x + dx * f * S * 0.22 + ex * f * 0.35, y: y + dy * f * S * 0.22 + ey * f * 0.35, f };
          }
        }
        const cells = [];
        for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
          const q = [pts[i][j], pts[i + 1][j], pts[i + 1][j + 1], pts[i][j + 1]];
          cells.push({
            q, tone: tone[i][j],
            cx: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
            f: (q[0].f + q[1].f + q[2].f + q[3].f) / 4,
          });
        }
        cells.sort((p, q) => p.cy - q.cy);
        const lw = Math.max(0.6, S / 800);
        c.lineJoin = 'round';
        c.lineWidth = lw;
        for (const cell of cells) {
          const hgt = S * (0.008 + cell.f * 0.05);
          const ctr = { x: cell.cx, y: cell.cy - hgt };
          const q = cell.q.map(p => ({ x: cell.cx + (p.x - cell.cx) * gap, y: cell.cy + (p.y - cell.cy) * gap - hgt }));
          for (let k = 0; k < 4; k++) {
            const p1 = q[k], p2 = q[(k + 1) % 4];
            let nx = p2.y - p1.y, ny = -(p2.x - p1.x);
            if (nx * ((p1.x + p2.x) / 2 - ctr.x) + ny * ((p1.y + p2.y) / 2 - ctr.y) < 0) { nx = -nx; ny = -ny; }
            if (ny <= 0) continue;
            quad(c, p1, p2, { x: p2.x, y: p2.y + hgt }, { x: p1.x, y: p1.y + hgt });
            c.fillStyle = nx < 0 ? pal.dark : pal.deep;
            c.fill();
            c.strokeStyle = pal.deep;
            c.stroke();
          }
          U.poly(c, q);
          c.fillStyle = pal.tops[cell.tone];
          c.fill();
          c.strokeStyle = pal.line;
          c.stroke();
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 2. Computer Ribbon: a spiralling polygon ribbon made of hundreds of plotter
//    lines, inside a framed field with one rounded corner.
STYLES.push({
  id: 'ribbon', name: 'Computer Ribbon', medium: 'Plotter on screenprint · line ribbon', aspect: 1,
  palettes: [
    { outer: '#f68b1f', inner: '#d6145c', field: '#12775a', line: '#d9a23a' },
    { outer: '#f4c21c', inner: '#2a6fd0', field: '#16244a', line: '#8fd3e8' },
    { outer: '#e8452c', inner: '#f19a1c', field: '#1b1b1b', line: '#f3e2b0' },
    { outer: '#7fb63a', inner: '#1a8c8c', field: '#3a1e5c', line: '#f0a8d0' },
    { outer: '#d6145c', inner: '#5a1e8a', field: '#f1e6c8', line: '#1c5a8a' },
    { outer: '#1f6fd0', inner: '#f2b21c', field: '#a8261e', line: '#f7e3a0' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const corner = r.int(0, 3);
    const n = r.int(3, 7), turns = r.range(1.1, 2.3), shrink = r.range(0.55, 0.85);
    const twist = r.range(2.5, 9), w0 = r.range(0.12, 0.26), L = r.int(520, 900);
    const off = { x: r.range(-0.05, 0.05), y: r.range(-0.05, 0.05) };
    const th0 = r.range(0, TAU), dir = r.chance(0.5) ? 1 : -1, soft = r.range(0.6, 0.95);
    return {
      paper: '#f3f1ea',
      draw(c, w, h, t) {
        const b = w * 0.035, rad = w * 0.18;
        const frame = (inset, color) => {
          const rr = [0, 0, 0, 0];
          rr[corner] = Math.max(0, rad - inset);
          c.beginPath();
          c.roundRect(inset, inset, w - 2 * inset, h - 2 * inset, rr);
          c.fillStyle = color;
          c.fill();
        };
        frame(0, pal.outer);
        frame(b, pal.inner);
        frame(2 * b, pal.field);
        c.save();
        c.clip();
        const fw = w - 4 * b, fh = h - 4 * b;
        const cx = 2 * b + fw * (0.5 + off.x), cy = 2 * b + fh * (0.5 + off.y);
        const R0 = Math.min(fw, fh) * 0.36;
        const count = Math.floor(L * Math.min(1, t / 5));
        const seg = TAU / n;
        c.beginPath();
        for (let k = 0; k < count; k++) {
          const s = k / L;
          const th = th0 + dir * (s * turns * TAU + t * 0.04);
          const local = (((th - th0) % seg) + seg) % seg;
          const rp = U.lerp(1, Math.cos(Math.PI / n) / Math.cos(local - Math.PI / n), soft);
          const R = R0 * (1 - shrink * s) * rp;
          const ax = cx + R * Math.cos(th), ay = cy + R * Math.sin(th);
          const phi = s * twist * TAU + t * 0.25;
          const hw = R0 * w0 * (1 - 0.5 * s);
          const ex = Math.cos(phi) * hw, ey = Math.sin(phi) * hw;
          c.moveTo(ax - ex, ay - ey);
          c.lineTo(ax + ex, ay + ey);
        }
        c.strokeStyle = pal.line;
        c.lineWidth = Math.max(0.6, w / 1000);
        c.stroke();
        c.restore();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 3. Exploded City: a grid of boxes receding toward a wandering vanishing point.
STYLES.push({
  id: 'boxes', name: 'Exploded City', medium: 'Serigraph · exploded perspective', aspect: 0.8,
  palettes: [
    { paper: '#efe8d6', front: '#f4d31c', win: '#3d7bd0', sideA: '#b3252a', sideB: '#1b1b1b', ink: '#141414' },
    { paper: '#ece6da', front: '#ece4cf', win: '#e04a2a', sideA: '#1d4f8a', sideB: '#141414', ink: '#141414' },
    { paper: '#f0ece2', front: '#f2a0b8', win: '#1d8a7a', sideA: '#f3c33a', sideB: '#2a2250', ink: '#2a2250' },
    { paper: '#e9e4d8', front: '#f39a2a', win: '#2a2a2a', sideA: '#2c8c5a', sideB: '#5a1a10', ink: '#1a0e08' },
    { paper: '#eceae4', front: '#9ad0e8', win: '#f2d21a', sideA: '#e0402a', sideB: '#16306a', ink: '#0e1630' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const [cols, rows] = r.pick([[3, 4], [4, 4], [4, 5], [3, 3], [3, 4]]);
    const cells = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      cells.push({
        i, j, rot: r.range(-0.4, 0.4), ph: r.range(0, TAU), sc: r.range(0.82, 1),
        inset: r.range(0.18, 0.3), mini: { x: r.range(-0.3, 0.3), y: r.range(-0.3, 0.3), s: r.range(0.25, 0.45) },
      });
    }
    const fa = r.range(0.07, 0.14), fb = r.range(0.05, 0.12), pa = r.range(0, TAU), pb = r.range(0, TAU);
    const amp = r.range(0.12, 0.28), depth0 = r.range(0.25, 0.42);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const cw = w / cols, ch = h / rows;
        const V = { x: w * (0.5 + amp * Math.sin(t * fa + pa)), y: h * (0.5 + amp * Math.sin(t * fb + pb)) };
        const grow = U.ease(U.clamp(t / 3, 0, 1));
        const depth = (depth0 + 0.07 * Math.sin(t * 0.4)) * grow;
        const lw = Math.max(1, w / 260);
        c.lineJoin = 'round';
        c.lineWidth = lw;
        c.strokeStyle = pal.ink;
        const boxes = cells.map(cell => {
          const cc = { x: (cell.i + 0.5) * cw, y: (cell.j + 0.5) * ch };
          const hw = cw * 0.44 * cell.sc, hh = ch * 0.44 * cell.sc;
          const a = cell.rot * Math.sin(t * 0.22 + cell.ph) * grow;
          const ca = Math.cos(a), sa = Math.sin(a);
          const F = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: cc.x + x * ca - y * sa, y: cc.y + x * sa + y * ca }));
          return { cell, cc, F, d: Math.hypot(cc.x - V.x, cc.y - V.y) };
        });
        boxes.sort((p, q) => q.d - p.d);
        for (const { cell, cc, F } of boxes) {
          const B = F.map(p => ({ x: p.x + (V.x - p.x) * depth, y: p.y + (V.y - p.y) * depth }));
          visibleSides(F, B, cc, V, (k, p1, p2, b1, b2) => {
            quad(c, p1, p2, b2, b1);
            c.fillStyle = k % 2 ? pal.sideB : pal.sideA;
            c.fill();
            c.stroke();
          });
          U.poly(c, F);
          c.fillStyle = pal.front;
          c.fill();
          c.stroke();
          // Window: a hole whose inner walls show on the side away from V.
          const W = F.map(p => ({ x: U.lerp(p.x, cc.x, cell.inset * 2), y: U.lerp(p.y, cc.y, cell.inset * 2) }));
          const Wb = W.map(p => ({ x: p.x + (V.x - p.x) * depth * 0.6, y: p.y + (V.y - p.y) * depth * 0.6 }));
          c.save();
          U.poly(c, W);
          c.clip();
          c.fillStyle = pal.sideA;
          c.fill();
          U.poly(c, Wb);
          c.fillStyle = pal.win;
          c.fill();
          c.stroke();
          // A small box floating inside the window.
          const wc = { x: (Wb[0].x + Wb[2].x) / 2, y: (Wb[0].y + Wb[2].y) / 2 };
          const ms = cell.mini.s;
          const mc = { x: wc.x + (W[1].x - W[0].x) * cell.mini.x * 0.5, y: wc.y + (W[3].y - W[0].y) * cell.mini.y * 0.5 };
          const Mf = Wb.map(p => ({ x: mc.x + (p.x - wc.x) * ms, y: mc.y + (p.y - wc.y) * ms }));
          const Mb = Mf.map(p => ({ x: p.x + (V.x - p.x) * depth * 0.5, y: p.y + (V.y - p.y) * depth * 0.5 }));
          visibleSides(Mf, Mb, mc, V, (k, p1, p2, b1, b2) => {
            quad(c, p1, p2, b2, b1);
            c.fillStyle = k % 2 ? pal.sideB : pal.sideA;
            c.fill();
            c.stroke();
          });
          U.poly(c, Mf);
          c.fillStyle = pal.front;
          c.fill();
          c.stroke();
          c.restore();
          U.poly(c, W);
          c.stroke();
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 4. In the Wild: jagged peaks drawn with nested contour lines that converge
//    toward a point, plotted one line at a time.
STYLES.push({
  id: 'peaks', name: 'In the Wild', medium: 'Pen plotter · nested contours', aspect: 2,
  palettes: [
    { paper: '#efeae0', ink: '#1d1a17' }, { paper: '#ece9e1', ink: '#23295a' },
    { paper: '#f0e9dc', ink: '#5a2a18' }, { paper: '#eeeae2', ink: '#7a1420' }, { paper: '#e9ebe4', ink: '#1d4a3a' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const count = r.int(6, 11), mts = [];
    for (let m = 0; m < count; m++) {
      // Spread the peaks along the range: each one is centred in its own slot.
      const width = r.range(0.16, 0.36);
      const mid = (m + r.range(0.2, 0.8)) / count;
      const x0 = U.clamp(mid - width / 2, 0.01, 0.99 - width), x1 = x0 + width;
      const H = r.range(0.25, 0.95), ax = x0 + width * r.range(0.3, 0.7);
      const verts = [{ x: x0, y: 0 }];
      const side = (fromX, toX, fromY, toY) => {
        const n = r.int(1, 3);
        for (let j = 1; j <= n; j++) {
          const f = j / (n + 1);
          verts.push({
            x: U.lerp(fromX, toX, f) + r.range(-0.25, 0.25) * width / (n + 1),
            y: U.clamp(U.lerp(fromY, toY, f) + r.range(-0.12, 0.2) * H, 0.02, H * 0.95),
          });
        }
      };
      side(x0, ax, 0, H);
      verts.push({ x: ax, y: H });
      side(ax, x1, H, 0);
      verts.push({ x: x1, y: 0 });
      mts.push({
        verts, H, width, lines: r.int(26, 46), sway: r.range(0, TAU),
        conv: { x: U.lerp(x0, x1, r.range(0.05, 0.95)), y: H * r.range(0, 0.22) },
      });
    }
    mts.sort((p, q) => q.H - p.H);
    const minX = Math.min(...mts.map(m => m.verts[0].x)), maxX = Math.max(...mts.map(m => m.verts[m.verts.length - 1].x));
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const base = h * 0.96, sy = h * 0.9;
        const P = (x, y) => ({ x: x * w, y: base - y * sy });
        // All the peaks are plotted at the same time, from the outline inward.
        const prog = Math.min(1, t / 3);
        c.lineJoin = 'miter';
        c.lineWidth = Math.max(0.7, w / 1200);
        c.strokeStyle = pal.ink;
        for (const mt of mts) {
          const C = { x: mt.conv.x + Math.sin(t * 0.25 + mt.sway) * mt.width * 0.14, y: mt.conv.y };
          // Paper fill hides the peaks behind this one.
          U.poly(c, mt.verts.map(v => P(v.x, v.y)));
          c.fillStyle = pal.paper;
          c.fill();
          c.beginPath();
          const n = Math.ceil(mt.lines * prog);
          for (let k = 0; k < n; k++) {
            const s = (k / mt.lines) * 0.97;
            mt.verts.forEach((v, i) => {
              const p = P(U.lerp(v.x, C.x, s), U.lerp(v.y, C.y, s));
              if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y);
            });
          }
          c.stroke();
        }
        c.beginPath();
        c.moveTo(minX * w, base);
        c.lineTo(minX * w + (maxX - minX) * w * prog, base);
        c.stroke();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 5. Square Field: a grid of concentric squares whose colours drift from one
//    side to the other through a slowly moving noise field.
STYLES.push({
  id: 'squares', name: 'Square Field', medium: 'Serigraph · concentric squares', aspect: 4 / 3,
  palettes: [
    { edge: '#e0581c', ground: '#f08a24', levels: ['#c8321e', '#e86a1c', '#f8c637'] },
    { edge: '#2a5ea8', ground: '#3f7fc4', levels: ['#16286a', '#2f6db8', '#a8d8f0'] },
    { edge: '#3a7a3a', ground: '#5a9a3a', levels: ['#1e4d2b', '#3f8a34', '#d8e88a'] },
    { edge: '#a8206a', ground: '#c8287a', levels: ['#5a1050', '#a82068', '#f8b0c8'] },
    { edge: '#3a3a3a', ground: '#8a8a86', levels: ['#262626', '#6a6a66', '#ecebe4'] },
    { edge: '#6a3aa0', ground: '#e07a2a', levels: ['#3a1a6a', '#b04a8a', '#f6d04a'] },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const cols = r.int(26, 44), rows = Math.round(cols * 0.75);
    const rnd = Array.from({ length: cols * rows }, () => [r(), r(), r()]);
    const ga = r.chance(0.7) ? r.range(-0.4, 0.4) + (r.chance(0.5) ? Math.PI : 0) : r.range(0, TAU);
    const fs = r.range(0.06, 0.16), sp = r.range(0.04, 0.1), nk = r.range(0.35, 0.7);
    const sizes = [0.2, 0.28, 0.36];
    return {
      paper: '#f2efe8',
      draw(c, w, h, t) {
        const s = Math.min(w / cols, h / rows), ox = (w - s * cols) / 2, oy = (h - s * rows) / 2;
        c.fillStyle = pal.edge;
        c.fillRect(ox, oy, s * cols, s * rows);
        const gx = Math.cos(ga), gy = Math.sin(ga);
        const lvl = v => v < 0.38 ? 0 : v < 0.62 ? 1 : 2;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
          const [r1, r2, r3] = rnd[y * cols + x];
          const g = gx * (x / cols - 0.5) + gy * (y / rows - 0.5) + 0.5;
          const ring = pal.levels[lvl(g + noise(x * fs, y * fs, t * sp) * nk + (r1 - 0.5) * 0.35)];
          const core = pal.levels[lvl(g + noise(x * fs + 40, y * fs, t * sp) * nk + (r2 - 0.5) * 0.5)];
          const px = ox + x * s, py = oy + y * s;
          const i1 = s * 0.08, i2 = s * 0.19;
          c.fillStyle = ring;
          c.fillRect(px + i1, py + i1, s - 2 * i1, s - 2 * i1);
          c.fillStyle = pal.ground;
          c.fillRect(px + i2, py + i2, s - 2 * i2, s - 2 * i2);
          const cs = s * sizes[Math.floor(r3 * 3)] * (0.9 + 0.2 * Math.sin(t * 0.6 + r3 * 20));
          c.fillStyle = core;
          c.fillRect(px + (s - cs) / 2, py + (s - cs) / 2, cs, cs);
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 6. Raster Weather: a coarse raster of a few flat colours where each cell
//    keeps copying a neighbour, so patches grow, merge and get eaten.
STYLES.push({
  id: 'pixels', name: 'Raster Weather', medium: 'Screenprint · raster voter model', aspect: 1,
  palettes: [
    ['#1d4f9a', '#e8401c', '#ede4a8', '#d2d2ce', '#111111'],
    ['#2a7a4a', '#f2b81c', '#efe6cf', '#c8402a', '#1a1a1a'],
    ['#5a2a8a', '#f07aa8', '#f5ecd6', '#2ab0c8', '#141414'],
    ['#8a2a1a', '#d8a050', '#efe4c8', '#4a6a3a', '#1d1410'],
    ['#0f5a7a', '#f2a01c', '#e8e8e0', '#9ac8c0', '#202830'],
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const G = r.int(40, 64), grid = new Uint8Array(G * G);
    const f = r.range(0.08, 0.2), order = [0, 1, 2, 3, 4].sort(() => r() - 0.5);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const v = (noise(x * f, y * f * r.range(0.6, 1.4)) * 0.75 + noise(x * f * 3, y * f * 3, 5) * 0.35 + 1) / 2;
      let k = U.clamp(Math.floor(v * 5), 0, 4);
      if (r.chance(0.08)) k = r.int(0, 4);
      grid[y * G + x] = order[k];
    }
    const hBias = r.range(0.25, 0.8), mut = r.range(0.002, 0.008), rate = r.range(0.8, 2);
    // Seeded randomness for the growth, so the same piece always grows the same way.
    const rnd = U.rng(r.int(1, 2e9));
    let last = 0;
    return {
      paper: '#ede9df',
      draw(c, w, h, t) {
        let steps = Math.min(G * G, Math.floor((t - last) * G * G * rate));
        if (steps > 0) last = t;
        while (steps-- > 0) {
          const x = (rnd() * G) | 0, y = (rnd() * G) | 0;
          if (rnd() < mut) {
            // Mutation: a short stroke of a random colour.
            const col = (rnd() * 5) | 0, len = 1 + ((rnd() * 4) | 0), hor = rnd() < hBias;
            for (let i = 0; i < len; i++) {
              const xx = hor ? x + i : x, yy = hor ? y : y + i;
              if (xx < G && yy < G) grid[yy * G + xx] = col;
            }
            continue;
          }
          const hor = rnd() < hBias, d = rnd() < 0.5 ? -1 : 1;
          const nx = hor ? x + d : x, ny = hor ? y : y + d;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          grid[y * G + x] = grid[ny * G + nx];
        }
        const s = Math.min(w, h) / G, ox = (w - s * G) / 2, oy = (h - s * G) / 2;
        for (let y = 0; y < G; y++) {
          let x = 0;
          while (x < G) {
            const k = grid[y * G + x];
            let e = x + 1;
            while (e < G && grid[y * G + e] === k) e++;
            c.fillStyle = pal[k];
            c.fillRect(ox + x * s, oy + y * s, (e - x) * s + 0.6, s + 0.6);
            x = e;
          }
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 7. Wire Form: a rotating 3D blob drawn as a dense stack of closed plotter loops.
STYLES.push({
  id: 'mesh', name: 'Wire Form', medium: 'Pen plotter · rotating wire form', aspect: 1,
  palettes: [
    { paper: '#ecebe6', ink: '20,20,22' }, { paper: '#ebeae4', ink: '30,46,96' },
    { paper: '#efe9e0', ink: '96,26,26' }, { paper: '#e9ece6', ink: '15,74,58' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const Nc = r.int(70, 130), S = 150;
    const k2 = r.int(1, 4), k3 = r.int(2, 5), a1 = r.range(0, 0.35), f1 = r.range(0.5, 2), p1 = r.range(0, TAU);
    const a2 = r.range(0.08, 0.3), a3 = r.range(0.05, 0.25), p2 = r.range(0, TAU), p3 = r.range(0, TAU);
    const tw = r.range(-4, 4), dxA = r.range(0, 0.3), dxF = r.range(0.5, 2), dxP = r.range(0, TAU);
    const rot0 = r.range(0, TAU), tilt = r.range(0.25, 0.6), spin = r.range(0.08, 0.18) * (r.chance(0.5) ? 1 : -1);
    const flat = r.range(0.6, 1);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const R = Math.min(w, h) * 0.32, cx = w / 2, cy = h / 2;
        const ry = rot0 + t * spin, rx = tilt + 0.15 * Math.sin(t * 0.07), m = t * 0.15;
        const cyr = Math.cos(ry), syr = Math.sin(ry), cxr = Math.cos(rx), sxr = Math.sin(rx);
        const count = Math.floor(Nc * Math.min(1, t / 5));
        c.beginPath();
        for (let i = 0; i < count; i++) {
          const u = i / (Nc - 1);
          const y = (u - 0.5) * 2 * R * 0.85 * flat;
          const prof = Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * u)), 0.5) * (1 + a1 * Math.sin(TAU * f1 * u + p1 + m * 0.3));
          const ox = R * dxA * Math.sin(Math.PI * u * dxF + dxP + m * 0.2);
          for (let j = 0; j <= S; j++) {
            const v = (j / S) * TAU;
            const rad = R * 0.75 * prof * (1 + a2 * Math.sin(k2 * v + u * tw + p2 + m) + a3 * Math.cos(k3 * v + p3 - m * 0.7));
            const x = ox + rad * Math.cos(v), z = rad * Math.sin(v);
            const x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
            const y1 = y * cxr - z1 * sxr;
            if (j) c.lineTo(cx + x1, cy + y1); else c.moveTo(cx + x1, cy + y1);
          }
        }
        c.strokeStyle = 'rgba(' + pal.ink + ',0.55)';
        c.lineWidth = Math.max(0.5, w / 1400);
        c.stroke();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 8. Twisted Leaf: a flattened tube twisting along an S-shaped spine,
//    drawn as a stack of thin elliptical sections.
STYLES.push({
  id: 'twist', name: 'Twisted Leaf', medium: 'Pen plotter · twisted section', aspect: 5 / 7,
  palettes: [
    { paper: '#eeebe4', ink: '200,40,42' }, { paper: '#ecebe6', ink: '29,63,138' },
    { paper: '#efebe3', ink: '26,26,26' }, { paper: '#f0ebe2', ink: '208,96,26' }, { paper: '#ebece6', ink: '30,120,90' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const N = r.int(90, 150), amp = r.range(0.04, 0.13), f = r.range(0.6, 1.4), p = r.range(0, TAU);
    const twist = r.range(0.6, 2.2) * TAU, Amax = r.range(0.14, 0.24), flatB = r.range(0.15, 0.4);
    const tilt = r.range(0.3, 0.6), lean = r.range(-0.25, 0.25), spin = r.range(0.2, 0.45) * (r.chance(0.5) ? 1 : -1);
    const pw = r.range(0.6, 1.2), tipUp = r.chance(0.5);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const count = Math.floor(N * Math.min(1, t / 5));
        c.beginPath();
        for (let k = 0; k < count; k++) {
          const s = k / (N - 1);
          const sx = w / 2 + w * amp * Math.sin(Math.PI * s * f * 2 + p) + lean * w * (s - 0.5);
          const sy = h * (0.94 - 0.88 * s);
          const env = Math.pow(Math.sin(Math.PI * s), pw) * (tipUp ? 1 - 0.4 * s : 0.6 + 0.4 * s);
          const a = Amax * w * env, b = a * flatB;
          const th = s * twist + t * spin, ct = Math.cos(th), st = Math.sin(th);
          for (let j = 0; j <= 40; j++) {
            const ph = (j / 40) * TAU, cp = Math.cos(ph), sp = Math.sin(ph);
            const x = a * cp * ct - b * sp * st, z = a * cp * st + b * sp * ct;
            const X = sx + x, Y = sy + z * tilt;
            if (j) c.lineTo(X, Y); else c.moveTo(X, Y);
          }
        }
        c.strokeStyle = 'rgba(' + pal.ink + ',0.85)';
        c.lineWidth = Math.max(0.6, w / 900);
        c.stroke();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 9. Disorder Squares: a grid of concentric squares whose corners wander more
//    and more as disorder grows across the sheet.
STYLES.push({
  id: 'disorder', name: 'Disorder Squares', medium: 'Pen plotter · concentric squares, growing disorder', aspect: 1,
  palettes: [
    { paper: '#efebe2', ink: '#1d1b18', accent: '#c8282a' }, { paper: '#ece9e1', ink: '#23295a', accent: '#e07a1a' },
    { paper: '#f0ebe0', ink: '#7a1420', accent: '#1d1b18' }, { paper: '#e9ebe4', ink: '#1d4a3a', accent: '#c8282a' },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const n = r.int(7, 13), rings = r.int(4, 8);
    // Where the disorder is strongest: a corner, a side or the centre.
    const focus = r.pick([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 1 }]);
    const inverse = focus.x === 0.5 && r.chance(0.5); // calm centre, wild edges
    const maxAmp = r.range(0.25, 0.55), speed = r.range(0.15, 0.35);
    const accents = new Set();
    for (let i = 0; i < n * n * rings * 0.04; i++) accents.add(r.int(0, n * n * rings - 1));
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const s = Math.min(w, h) / n;
        const breathe = 0.75 + 0.25 * Math.sin(t * 0.3);
        c.lineJoin = 'round';
        c.lineWidth = Math.max(0.7, w / 900);
        const plain = new Path2D(), accent = new Path2D();
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const fx = (i + 0.5) / n, fy = (j + 0.5) / n;
          let d = Math.hypot(fx - focus.x, fy - focus.y) / Math.SQRT2;
          if (focus.x === 0.5) d *= 2;
          const dis = U.clamp(inverse ? d : 1 - d, 0, 1) ** 1.6 * maxAmp * breathe;
          const cx = (i + 0.5) * s, cy = (j + 0.5) * s;
          for (let k = 0; k < rings; k++) {
            const half = s * 0.46 * (1 - k / rings);
            const p = accents.has((j * n + i) * rings + k) ? accent : plain;
            for (let q = 0; q < 4; q++) {
              const sx = q === 0 || q === 3 ? -1 : 1, sy = q < 2 ? -1 : 1;
              const ox = noise(i * 3.1 + k * 1.7 + q * 9.3, j * 2.3, t * speed) * dis * s;
              const oy = noise(i * 2.7 + q * 5.1, j * 3.3 + k * 1.9, t * speed + 40) * dis * s;
              if (q) p.lineTo(cx + sx * half + ox, cy + sy * half + oy); else p.moveTo(cx + sx * half + ox, cy + sy * half + oy);
            }
            p.closePath();
          }
        }
        c.strokeStyle = pal.ink;
        c.stroke(plain);
        c.strokeStyle = pal.accent;
        c.stroke(accent);
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 10. Harmonograph: the trace of two damped pendulums, slowly detuning.
STYLES.push({
  id: 'harmono', name: 'Harmonograph', medium: 'Pen plotter · damped pendulums', aspect: 1,
  palettes: [
    { paper: '#efebe2', ink: '29,27,24' }, { paper: '#ece9e1', ink: '35,41,120' },
    { paper: '#f0ebe0', ink: '170,30,40' }, { paper: '#e9ebe4', ink: '20,100,80' }, { paper: '#1c1a22', ink: '240,200,120' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const ratio = r.pick([[1, 1], [2, 1], [3, 2], [3, 1], [4, 3], [5, 4], [2, 3]]);
    const base = r.range(2.5, 4);
    const f = [ratio[0] * base, ratio[1] * base, ratio[0] * base + r.range(-0.03, 0.03), ratio[1] * base + r.range(-0.03, 0.03)];
    const p = [0, 1, 2, 3].map(() => r.range(0, TAU));
    const d = [0, 1, 2, 3].map(() => r.range(0.004, 0.02));
    const a = [r.range(0.5, 1), r.range(0, 0.5), r.range(0.5, 1), r.range(0, 0.5)];
    const T = r.range(80, 140), N = 5000, drift = r.range(0.03, 0.08) * (r.chance(0.5) ? 1 : -1);
    const ax = a[0] + a[1], ay = a[2] + a[3];
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const R = Math.min(w, h) * 0.47, cx = w / 2, cy = h / 2;
        const count = Math.floor(N * Math.min(1, t / 5));
        const ph = t * drift;
        c.beginPath();
        for (let i = 0; i < count; i++) {
          const u = (i / N) * T;
          const x = a[0] * Math.sin(f[0] * u + p[0] + ph) * Math.exp(-d[0] * u) + a[1] * Math.sin(f[1] * u + p[1]) * Math.exp(-d[1] * u);
          const y = a[2] * Math.sin(f[2] * u + p[2]) * Math.exp(-d[2] * u) + a[3] * Math.sin(f[3] * u + p[3] - ph) * Math.exp(-d[3] * u);
          const X = cx + (x / ax) * R, Y = cy + (y / ay) * R;
          if (i) c.lineTo(X, Y); else c.moveTo(X, Y);
        }
        c.strokeStyle = 'rgba(' + pal.ink + ',0.6)';
        c.lineWidth = Math.max(0.5, w / 1300);
        c.stroke();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 11. Truchet Weave: quarter-circle tiles that keep turning, so the bands
//     re-route themselves into new loops and meanders.
STYLES.push({
  id: 'truchet', name: 'Truchet Weave', medium: 'Serigraph · turning Truchet tiles', aspect: 1,
  palettes: [
    { bg: '#1d3f8a', ink: '#f2e8d0' }, { bg: '#f2e8d0', ink: '#1b1b1b' }, { bg: '#e8452c', ink: '#1b1b1b' },
    { bg: '#12775a', ink: '#f6c533' }, { bg: '#f4d31c', ink: '#b3252a' }, { bg: '#2a2250', ink: '#f2a0b8' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const n = r.int(8, 18), bands = r.int(1, 3), kind = r.chance(0.75) ? 'arc' : 'diag';
    const tiles = Array.from({ length: n * n }, () => ({ o: r.int(0, 1), from: 0, start: -1 }));
    const rate = r.range(0.02, 0.08), TURN = 0.7;
    // Seeded randomness for the growth, so the same piece always grows the same way.
    const rnd = U.rng(r.int(1, 2e9));
    let last = 0;
    return {
      paper: '#f2efe8',
      draw(c, w, h, t) {
        const s = Math.min(w, h) / n, dt = Math.max(0, t - last);
        last = t;
        // Finish old turns and start a few new ones.
        for (const tile of tiles) {
          if (tile.start >= 0 && t - tile.start > TURN) tile.start = -1;
          if (tile.start < 0 && rnd() < rate * dt) { tile.from = tile.o; tile.o ^= 1; tile.start = t; }
        }
        c.fillStyle = pal.bg;
        c.fillRect(0, 0, s * n, s * n);
        c.strokeStyle = pal.ink;
        c.lineCap = 'butt';
        const lw = (s * 0.5) / (bands * 2 - 1);
        c.lineWidth = lw;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const tile = tiles[j * n + i];
          let turns = tile.o;
          if (tile.start >= 0) turns = tile.from + U.ease(U.clamp((t - tile.start) / TURN, 0, 1));
          c.save();
          c.translate((i + 0.5) * s, (j + 0.5) * s);
          // Each tile only paints inside its own square, even while turning.
          c.beginPath();
          c.rect(-s / 2, -s / 2, s, s);
          c.clip();
          c.rotate(turns * Math.PI / 2);
          c.beginPath();
          for (let b = 0; b < bands; b++) {
            const off = (b - (bands - 1) / 2) * lw * 2;
            if (kind === 'arc') {
              const rr = s / 2 + off;
              c.moveTo(-s / 2 + rr, -s / 2);
              c.arc(-s / 2, -s / 2, rr, 0, Math.PI / 2);
              c.moveTo(s / 2 - rr, s / 2);
              c.arc(s / 2, s / 2, rr, Math.PI, Math.PI * 1.5);
            } else {
              const o = off / Math.SQRT2;
              c.moveTo(-s + o, -s - o);
              c.lineTo(s + o, s - o);
            }
          }
          c.stroke();
          c.restore();
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 12. Moiré Rings: two families of fine rings (or rings and lines) drifting
//     over each other.
STYLES.push({
  id: 'moire', name: 'Moiré Rings', medium: 'Pen plotter · interfering rings', aspect: 1,
  palettes: [
    { paper: '#efebe2', a: '#1d1b18', b: '#1d1b18' }, { paper: '#ece9e1', a: '#1d3f8a', b: '#c8282a' },
    { paper: '#f0ebe0', a: '#7a1420', b: '#7a1420' }, { paper: '#1c1a22', a: '#efe6cf', b: '#f2a01c' },
    { paper: '#e9ebe4', a: '#12775a', b: '#d6145c' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const rings = r.int(45, 80), lines = r.chance(0.3);
    const fa = [r.range(0.05, 0.12), r.range(0.05, 0.12)], pa = [r.range(0, TAU), r.range(0, TAU)];
    const amp = r.range(0.08, 0.22), clipCircle = r.chance(0.5);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const S = Math.min(w, h), R = S * 0.5;
        const grow = U.ease(U.clamp(t / 2.5, 0, 1));
        c.save();
        c.beginPath();
        if (clipCircle) c.arc(w / 2, h / 2, R, 0, TAU); else c.rect(0, 0, w, h);
        c.clip();
        c.lineWidth = Math.max(0.6, S / 700);
        const step = (S * 0.75) / rings;
        for (let f = 0; f < 2; f++) {
          const cx = w / 2 + Math.sin(t * fa[f] + pa[f]) * S * amp * (f ? 1 : -1);
          const cy = h / 2 + Math.cos(t * fa[1 - f] + pa[f]) * S * amp;
          c.beginPath();
          if (f === 1 && lines) {
            // Second family as parallel lines, slowly turning.
            const a = t * 0.05 + pa[1], dx = Math.cos(a), dy = Math.sin(a);
            const m = Math.floor(rings * 1.4 * grow);
            for (let k = -m; k <= m; k++) {
              const o = k * step * 0.9;
              c.moveTo(cx - dx * S - dy * o, cy - dy * S + dx * o);
              c.lineTo(cx + dx * S - dy * o, cy + dy * S + dx * o);
            }
          } else {
            const m = Math.floor(rings * grow);
            for (let k = 1; k <= m; k++) { c.moveTo(cx + k * step, cy); c.arc(cx, cy, k * step, 0, TAU); }
          }
          c.strokeStyle = f ? pal.b : pal.a;
          c.stroke();
        }
        c.restore();
      },
    };
  },
});
