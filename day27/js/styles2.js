// More generators (studies 13-16), same contract as js/styles.js.

// ---------------------------------------------------------------------------
// 13. Broken Cubes: a grid of turning wireframe cubes, each missing some of
//     its twelve edges; edges fade in and out over time.
STYLES.push({
  id: 'cubes', name: 'Broken Cubes', medium: 'Pen plotter · incomplete rotating cubes', aspect: 1,
  palettes: [
    { paper: '#efebe2', ground: null, ink: '#1d1b18' }, { paper: '#141414', ground: null, ink: '#efe9dc' },
    { paper: '#efebe2', ground: '#1d1b18', ink: '#efe9dc' }, { paper: '#ece9e1', ground: null, ink: '#b3252a' },
    { paper: '#e9ebe4', ground: '#1d3f8a', ink: '#f2e8d0' },
  ],
  make(r) {
    const pal = r.pick(this.palettes);
    const n = r.int(3, 6);
    const V = [];
    for (let i = 0; i < 8; i++) V.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    const E = [];
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const diff = (a ^ b);
      if (diff === 1 || diff === 2 || diff === 4) E.push([a, b]);
    }
    const spinAll = r.range(0.15, 0.4) * (r.chance(0.5) ? 1 : -1);
    const cells = Array.from({ length: n * n }, () => ({
      ax: r.range(0, TAU), ay: r.range(0, TAU), az: r.range(0, TAU),
      spin: spinAll * r.range(0.5, 1.3),
      on: E.map(() => r.chance(r.range(0.4, 0.8))),
      alpha: E.map(() => 0),
    }));
    const rate = r.range(0.04, 0.12);
    // Seeded randomness for the growth, so the same piece always grows the same way.
    const rnd = U.rng(r.int(1, 2e9));
    let last = 0;
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const s = Math.min(w, h) / n, dt = Math.max(0, t - last);
        last = t;
        if (pal.ground) { c.fillStyle = pal.ground; c.fillRect(0, 0, s * n, s * n); }
        c.strokeStyle = pal.ink;
        c.lineWidth = Math.max(1.2, s / 45);
        c.lineCap = 'round';
        const R = s * 0.27;
        cells.forEach((cell, idx) => {
          const cx = (idx % n + 0.5) * s, cy = (Math.floor(idx / n) + 0.5) * s;
          const ay = cell.ay + t * cell.spin, ax = cell.ax + t * cell.spin * 0.4;
          const cay = Math.cos(ay), say = Math.sin(ay), cax = Math.cos(ax), sax = Math.sin(ax);
          const cz = Math.cos(cell.az), sz = Math.sin(cell.az);
          const P = V.map(([x, y, z]) => {
            const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
            const x2 = x1 * cay + z * say, z2 = -x1 * say + z * cay;
            const y3 = y1 * cax - z2 * sax;
            return { x: cx + x2 * R, y: cy + y3 * R };
          });
          E.forEach(([a, b], k) => {
            // Now and then an edge appears or disappears, fading over ~1 s.
            if (rnd() < rate * dt / 12) cell.on[k] = !cell.on[k];
            cell.alpha[k] = U.clamp(cell.alpha[k] + (cell.on[k] ? dt : -dt), 0, 1);
            if (cell.alpha[k] <= 0) return;
            c.globalAlpha = cell.alpha[k];
            c.beginPath();
            c.moveTo(P[a].x, P[a].y);
            c.lineTo(P[b].x, P[b].y);
            c.stroke();
          });
        });
        c.globalAlpha = 1;
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 14. Gravel: a column of squares, orderly at one end and tumbling at the
//     other; the boundary of the disorder slides up and down.
STYLES.push({
  id: 'gravel', name: 'Gravel', medium: 'Pen plotter · order into disorder', aspect: 12 / 21,
  palettes: [
    { paper: '#efebe2', ink: '#1d1b18' }, { paper: '#ece9e1', ink: '#23295a' },
    { paper: '#f0ebe0', ink: '#7a1420' }, { paper: '#1c1a22', ink: '#efe6cf' },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const cols = 12, rows = 21;
    const rnd = Array.from({ length: cols * rows }, () => [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
    const up = r.chance(0.25); // disorder at the top instead of the bottom
    const amp = r.range(0.8, 1.3), slide = r.range(0.2, 0.35), sp = r.range(0.2, 0.4), ph = r.range(0, TAU);
    const filled = r.chance(0.25);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const s = Math.min(w / cols, h / rows), ox = (w - s * cols) / 2, oy = (h - s * rows) / 2;
        const shift = slide * Math.sin(t * sp + ph);
        c.lineWidth = Math.max(0.8, s / 30);
        c.lineJoin = 'miter';
        c.strokeStyle = pal.ink;
        c.fillStyle = pal.ink;
        for (let j = 0; j < rows; j++) {
          const f = up ? 1 - j / (rows - 1) : j / (rows - 1);
          const d = U.clamp(f - shift, 0, 1) ** 1.4 * amp;
          for (let i = 0; i < cols; i++) {
            const [a, b, q] = rnd[j * cols + i];
            const wob = noise(i * 0.7, j * 0.7, t * 0.3) * 0.25;
            const ang = (q + wob) * d * Math.PI / 4;
            const x = ox + (i + 0.5) * s + (a + wob) * d * s * 0.45;
            const y = oy + (j + 0.5) * s + b * d * s * 0.45;
            c.save();
            c.translate(x, y);
            c.rotate(ang);
            if (filled && (i + j) % 7 === 0) c.fillRect(-s / 2, -s / 2, s, s);
            else c.strokeRect(-s / 2, -s / 2, s, s);
            c.restore();
          }
        }
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 15. Flow Field: hundreds of short strokes following invisible currents
//     that slowly change, like iron filings or wind on a map.
STYLES.push({
  id: 'flow', name: 'Flow Field', medium: 'Pen plotter · strokes in a current', aspect: 4 / 3,
  palettes: [
    { paper: '#efebe2', inks: ['#1d1b18'] }, { paper: '#ece9e1', inks: ['#1d3f8a', '#c8282a'] },
    { paper: '#f0ebe0', inks: ['#7a1420', '#d9a23a', '#1d1b18'] }, { paper: '#16244a', inks: ['#f2e8d0', '#8fd3e8'] },
    { paper: '#e9ebe4', inks: ['#12775a', '#1d1b18'] }, { paper: '#1b1b1b', inks: ['#f68b1f', '#d6145c', '#efe6cf'] },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const count = r.int(900, 1600), steps = r.int(5, 14), turn = r.range(1, 3);
    const f = r.range(1.2, 3.5), speed = r.range(0.03, 0.08), stepLen = r.range(0.006, 0.012);
    const seeds = Array.from({ length: count }, () => ({ x: r(), y: r(), ink: 0, lw: r.range(0.6, 1.6) }));
    seeds.forEach(p => { p.ink = Math.floor(U.clamp((noise(p.x * 2, p.y * 2, 9) + 1) / 2, 0, 0.999) * pal.inks.length); });
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        c.save();
        c.beginPath();
        c.rect(0, 0, w, h);
        c.clip(); // strokes near the border must not run into the paper margin
        const shown = Math.floor(count * Math.min(1, t / 4));
        const z = t * speed, S = Math.min(w, h);
        c.lineCap = 'round';
        const paths = pal.inks.map(() => new Path2D());
        for (let k = 0; k < shown; k++) {
          const p = seeds[k], path = paths[p.ink];
          let x = p.x, y = p.y;
          path.moveTo(x * w, y * h);
          for (let i = 0; i < steps; i++) {
            const a = noise(x * f, y * f * (h / w), z) * TAU * turn;
            x += Math.cos(a) * stepLen * (S / w);
            y += Math.sin(a) * stepLen * (S / h);
            path.lineTo(x * w, y * h);
          }
        }
        c.lineWidth = Math.max(0.8, S / 600);
        pal.inks.forEach((ink, i) => { c.strokeStyle = ink; c.stroke(paths[i]); });
        c.restore();
      },
    };
  },
});

// ---------------------------------------------------------------------------
// 16. Line Terrain: a landscape of parallel profile lines in perspective,
//     each hiding the ones behind it, scrolling toward the viewer.
STYLES.push({
  id: 'terrain', name: 'Line Terrain', medium: 'Pen plotter · hidden-line landscape', aspect: 3 / 2,
  palettes: [
    { paper: '#efebe2', ink: '#1d1b18' }, { paper: '#0f1424', ink: '#e8e4d8' },
    { paper: '#ece9e1', ink: '#23295a' }, { paper: '#f0ebe0', ink: '#7a1420' }, { paper: '#14201a', ink: '#9ae0a8' },
  ],
  make(r, noise) {
    const pal = r.pick(this.palettes);
    const rows = r.int(45, 70), pts = 140, f = r.range(0.25, 0.6), amp = r.range(0.6, 1.4);
    const speed = r.range(0.4, 0.9), sharp = r.chance(0.5), valley = r.range(0, 1);
    const dz = 0.5, near = 2, horizonAt = r.range(0.22, 0.35);
    return {
      paper: pal.paper,
      draw(c, w, h, t) {
        const travel = t * speed, first = Math.floor(travel / dz);
        const horizon = h * horizonAt, F = h * 0.9, camH = 2.2;
        c.lineWidth = Math.max(0.7, w / 1100);
        c.lineJoin = 'round';
        c.strokeStyle = pal.ink;
        c.fillStyle = pal.paper;
        c.save();
        c.beginPath();
        c.rect(0, 0, w, h);
        c.clip(); // the nearest rows dip below the frame
        // Far rows first, so the nearer ones (filled below the line) hide them.
        for (let k = rows - 1; k >= 0; k--) {
          const wz = (first + k) * dz, depth = wz - travel + near;
          if (depth <= near * 0.6) continue;
          const sc = F / depth;
          // Each row spans the whole width, whatever its depth.
          const half = (w / 2) / (sc * 0.55) * 1.02;
          const line = new Path2D(), body = new Path2D();
          for (let i = 0; i <= pts; i++) {
            const wx = (i / pts - 0.5) * 2 * half;
            let n = noise(wx * f, wz * f) * 0.7 + noise(wx * f * 2.3, wz * f * 2.3, 5) * 0.3;
            if (sharp) n = 1 - Math.abs(n) * 2;                // ridged peaks
            const centre = 1 - valley * Math.exp(-wx * wx / 6); // optional valley in the middle
            const y = horizon + (camH - n * amp * centre) * sc;
            const x = w / 2 + wx * sc * 0.55;
            if (i) { line.lineTo(x, y); body.lineTo(x, y); } else { line.moveTo(x, y); body.moveTo(x, y); }
          }
          body.lineTo(w + 10, h + 10);
          body.lineTo(-10, h + 10);
          body.closePath();
          c.fill(body);
          c.globalAlpha = U.clamp(1.6 - depth / (rows * dz) * 1.4, 0.15, 1);
          c.stroke(line);
          c.globalAlpha = 1;
        }
        c.restore();
      },
    };
  },
});
