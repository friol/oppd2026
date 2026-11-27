// More generators (studies 17-20), same contract as js/styles.js.

// ---------------------------------------------------------------------------
// 17. Drifting Circles: concentric circles whose centre drifts a little at
//     each ring, so the lines crowd on one side like an engraving.
STYLES.push({
  id: 'rings', name: 'Drifting Circles', medium: 'Pen plotter · circles with wandering centres', aspect: 1,
  palettes: [
    { paper: '#efebe2', inks: ['#1d1b18', '#c8282a', '#1d3f8a'] }, { paper: '#ece9e1', inks: ['#23295a', '#e07a1a', '#12775a'] },
    { paper: '#1c1a22', inks: ['#efe6cf', '#f2a01c', '#8fd3e8'] }, { paper: '#f0ebe0', inks: ['#7a1420', '#1d1b18', '#d9a23a'] },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const groups = Array.from({ length: r.int(1, 3) }, (_, g) => ({
      x: r.range(0.3, 0.7), y: r.range(0.3, 0.7), n: r.int(45, 95), maxR: r.range(0.3, 0.55),
      drift: r.range(0.002, 0.007), ink: pal.inks[g % pal.inks.length], seed: r.range(0, 100),
    }));
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const S = Math.min(w, h), grow = Math.min(1, t / 3);
        c.save();
        c.beginPath();
        c.rect(0, 0, w, h);
        c.clip();
        c.lineWidth = Math.max(0.6, S / 900);
        for (const g of groups) {
          let x = g.x, y = g.y;
          const shown = Math.floor(g.n * grow);
          c.beginPath();
          for (let k = 1; k <= shown; k++) {
            // Each ring moves the centre along a slowly changing direction.
            x += noise(k * 0.04, g.seed, t * 0.12) * g.drift * 2;
            y += noise(k * 0.04 + 50, g.seed, t * 0.12) * g.drift * 2;
            const rad = (k / g.n) * g.maxR * S;
            c.moveTo(x * w + rad, y * h);
            c.arc(x * w, y * h, rad, 0, TAU);
          }
          c.strokeStyle = g.ink;
          c.stroke();
        }
        c.restore();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 18. Polygon Whirls: a polygon drawn again and again, each copy turned a
//     little and shrunk so its corners touch the previous sides; tiles turn
//     in opposite directions, forming pursuit spirals.
STYLES.push({
  id: 'whirl', name: 'Polygon Whirls', medium: 'Serigraph · nested turning polygons', aspect: 1,
  palettes: [
    { paper: '#efebe2', line: '#1d1b18', fills: null }, { paper: '#ece9e1', line: '#1d1b18', fills: ['#f4d31c', '#efebe2'] },
    { paper: '#f0ebe0', line: '#16244a', fills: ['#3d7bd0', '#efe9dc'] }, { paper: '#1b1b1b', line: '#efe6cf', fills: null },
    { paper: '#efe8d6', line: '#2a0d06', fills: ['#d6145c', '#f68b1f'] }, { paper: '#e9ebe4', line: '#12775a', fills: null },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const n = r.pick([3, 4, 4, 4, 6]), tiles = r.pick([1, 2, 2, 3, 4]);
    const steps = r.int(40, 90), a0 = r.range(0.05, 0.14), base = r.range(0, TAU);
    // Squares and hexagons tile the sheet; triangles use one turned whirl per tile.
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const S = Math.min(w, h), T = S / tiles;
        const alpha = a0 + 0.035 * Math.sin(t * 0.35);
        const k = Math.cos(Math.PI / n) / Math.cos(Math.PI / n - alpha);
        const shown = Math.floor(steps * Math.min(1, t / 3));
        c.lineJoin = 'miter';
        c.lineWidth = Math.max(0.6, T / 400);
        for (let j = 0; j < tiles; j++) for (let i = 0; i < tiles; i++) {
          const dir = (i + j) % 2 ? 1 : -1;
          const cx = (i + 0.5) * T, cy = (j + 0.5) * T;
          // Squares fill their tile; other polygons are inscribed in it.
          let R = n === 4 ? T * Math.SQRT1_2 : T * 0.5;
          let ang = (n === 4 ? Math.PI / 4 : base) + (n === 3 && dir < 0 ? Math.PI : 0);
          for (let s = 0; s < shown; s++) {
            c.beginPath();
            for (let v = 0; v < n; v++) {
              const a = ang + (v / n) * TAU;
              const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
              if (v) c.lineTo(x, y); else c.moveTo(x, y);
            }
            c.closePath();
            if (pal.fills) { c.fillStyle = pal.fills[s % 2]; c.fill(); }
            c.strokeStyle = pal.line;
            c.stroke();
            R *= k;
            ang += alpha * dir;
          }
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 19. Growing Maze: lines that grow cell by cell, turning and branching,
//     until they fill the sheet like a coral or a labyrinth.
STYLES.push({
  id: 'maze', name: 'Growing Maze', medium: 'Pen plotter · branching growth', aspect: 1,
  palettes: [
    { paper: '#efebe2', inks: ['#1d1b18'] }, { paper: '#ece9e1', inks: ['#1d3f8a', '#c8282a'] },
    { paper: '#1c1a22', inks: ['#efe6cf', '#f2a01c'] }, { paper: '#f0ebe0', inks: ['#7a1420', '#12775a', '#d9a23a'] },
    { paper: '#f4d31c', inks: ['#1b1b1b'] },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const G = r.int(26, 50), straight = r.range(0.35, 0.85), branch = r.range(0.04, 0.18);
    const width = r.range(0.25, 0.6), rate = G * G / r.range(8, 14);
    const used = new Uint8Array(G * G);
    // Seeded randomness for the growth, so the same piece always grows the same way.
    const rnd = U.rng(Math.floor(straight * 1e9) + G);
    const paths = pal.inks.map(() => new Path2D());
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let heads = [], last = 0, debt = 0, done = false;
    const seed = (x, y) => {
      used[y * G + x] = 1;
      const ink = (rnd() * pal.inks.length) | 0;
      paths[ink].moveTo(x + 0.5, y + 0.5);
      paths[ink].lineTo(x + 0.5, y + 0.5); // a dot, so lone seeds still show
      heads.push({ x, y, d: (rnd() * 4) | 0, ink });
    };
    for (let i = r.int(1, 4); i > 0; i--) seed(r.int(0, G - 1), r.int(0, G - 1));
    function step() {
      if (!heads.length) {
        // Everyone is stuck: start again from a free cell, if any.
        for (let tries = 0; tries < 60; tries++) {
          const x = (rnd() * G) | 0, y = (rnd() * G) | 0;
          if (!used[y * G + x]) { seed(x, y); return; }
        }
        for (let i = 0; i < G * G; i++) if (!used[i]) { seed(i % G, (i / G) | 0); return; }
        done = true;
        return;
      }
      const hi = (rnd() * heads.length) | 0, hd = heads[hi];
      const free = [];
      DIRS.forEach(([dx, dy], d) => {
        const x = hd.x + dx, y = hd.y + dy;
        if (x >= 0 && y >= 0 && x < G && y < G && !used[y * G + x]) free.push(d);
      });
      if (!free.length) { heads.splice(hi, 1); return; }
      const d = free.includes(hd.d) && rnd() < straight ? hd.d : free[(rnd() * free.length) | 0];
      if (rnd() < branch) heads.push({ x: hd.x, y: hd.y, d: (d + 1) % 4, ink: hd.ink });
      const nx = hd.x + DIRS[d][0], ny = hd.y + DIRS[d][1];
      used[ny * G + nx] = 1;
      paths[hd.ink].moveTo(hd.x + 0.5, hd.y + 0.5);
      paths[hd.ink].lineTo(nx + 0.5, ny + 0.5);
      hd.x = nx; hd.y = ny; hd.d = d;
    }
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        debt += Math.max(0, t - last) * rate;
        last = t;
        while (debt >= 1 && !done) { step(); debt--; }
        const s = Math.min(w, h) / G;
        c.save();
        c.translate((w - s * G) / 2, (h - s * G) / 2);
        c.scale(s, s);
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.lineWidth = width;
        pal.inks.forEach((ink, i) => { c.strokeStyle = ink; c.stroke(paths[i]); });
        c.restore();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 20. Circle Packing: circles of many sizes packed without touching, in flat
//     serigraph colours; they pop in one by one, half-discs keep turning.
STYLES.push({
  id: 'packing', name: 'Circle Packing', medium: 'Serigraph · packed circles', aspect: 1,
  palettes: [
    { paper: '#efe8d6', cols: ['#b3252a', '#f4d31c', '#3d7bd0', '#1b1b1b'] },
    { paper: '#ece9e1', cols: ['#f68b1f', '#d6145c', '#12775a', '#16244a'] },
    { paper: '#1c1a22', cols: ['#efe6cf', '#f2a01c', '#e8452c', '#8fd3e8'] },
    { paper: '#f0ebe0', cols: ['#1d1b18', '#7a1420', '#d9a23a', '#9ab0a0'] },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const maxR = r.range(0.1, 0.2), gap = r.range(0.003, 0.008), minR = 0.006;
    const circles = [];
    for (let a = 0; a < 6000 && circles.length < 420; a++) {
      const x = r(), y = r();
      let rad = Math.min(maxR, x, y, 1 - x, 1 - y);
      for (const o of circles) {
        rad = Math.min(rad, Math.hypot(x - o.x, y - o.y) - o.r - gap);
        if (rad < minR) break;
      }
      if (rad < minR) continue;
      const cols = pal.cols, i = r.int(0, cols.length - 1);
      circles.push({
        x, y, r: rad, kind: r.pick(['disc', 'disc', 'rings', 'half', 'half', 'dot']),
        col: cols[i], col2: cols[(i + r.int(1, cols.length - 1)) % cols.length],
        rings: r.int(2, 5), ph: r.range(0, TAU), spin: r.range(0.2, 0.6) * (r.chance(0.5) ? 1 : -1),
      });
    }
    const APPEAR = 4;
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const S = Math.min(w, h), ox = (w - S) / 2, oy = (h - S) / 2;
        circles.forEach((ci, i) => {
          const born = (i / circles.length) * APPEAR;
          const g = U.ease(U.clamp((t - born) / 0.6, 0, 1));
          if (g <= 0) return;
          const x = ox + ci.x * S, y = oy + ci.y * S, rad = ci.r * S * g;
          c.beginPath();
          c.arc(x, y, rad, 0, TAU);
          if (ci.kind === 'rings') {
            c.lineWidth = Math.max(1, rad / (ci.rings * 2.2));
            c.strokeStyle = ci.col;
            for (let k = 1; k <= ci.rings; k++) {
              c.beginPath();
              c.arc(x, y, Math.max(0, rad * (k / ci.rings) - c.lineWidth / 2), 0, TAU);
              c.stroke();
            }
            return;
          }
          c.fillStyle = ci.col;
          c.fill();
          if (ci.kind === 'half') {
            const a = ci.ph + t * ci.spin;
            c.beginPath();
            c.arc(x, y, rad, a, a + Math.PI);
            c.closePath();
            c.fillStyle = ci.col2;
            c.fill();
          } else if (ci.kind === 'dot') {
            c.beginPath();
            c.arc(x, y, rad * 0.4, 0, TAU);
            c.fillStyle = ci.col2;
            c.fill();
          }
        });
      },
    };
  },
});
