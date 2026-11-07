// Hand-drawn strokes in SVG: slightly bent lines and wobbly loops, revealed with a
// dash animation (pathLength = 1) so every mark looks drawn on the spot.
'use strict';

const Sketch = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const X_STROKE = 230;   // ms per stroke of an X
  const X_GAP = 110;      // pause between the two strokes
  const O_TIME = 480;
  const GRID_STROKE = 300;
  const GRID_STAGGER = 130;
  const STRIKE_TIME = 420;

  const j = n => (Math.random() * 2 - 1) * n;
  const f = v => v.toFixed(1);

  // A line with a gentle, irregular bend.
  function line(x1, y1, x2, y2, bend = 0.04) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, b = j(bend * len);
    const b2 = b * 0.6 + j(bend * len * 0.5);
    return `M${f(x1)} ${f(y1)} C${f(x1 + dx * 0.33 + nx * b)} ${f(y1 + dy * 0.33 + ny * b)} ` +
      `${f(x1 + dx * 0.66 + nx * b2)} ${f(y1 + dy * 0.66 + ny * b2)} ${f(x2)} ${f(y2)}`;
  }

  // Catmull-Rom spline through the points, as cubic Beziers.
  function smooth(p) {
    let d = `M${f(p[0][0])} ${f(p[0][1])}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[Math.max(i - 1, 0)], b = p[i], c = p[i + 1], e = p[Math.min(i + 2, p.length - 1)];
      d += ` C${f(b[0] + (c[0] - a[0]) / 6)} ${f(b[1] + (c[1] - a[1]) / 6)} ` +
        `${f(c[0] - (e[0] - b[0]) / 6)} ${f(c[1] - (e[1] - b[1]) / 6)} ${f(c[0])} ${f(c[1])}`;
    }
    return d;
  }

  // A hand-drawn O: counter-clockwise from the top, a bit more than one turn,
  // slightly squashed and tilted, with the end drifting past the start.
  function loop(cx, cy, r) {
    const a0 = -Math.PI * 0.55 + j(0.35), turn = Math.PI * 2 + 0.3 + Math.random() * 0.35;
    const sx = 1 + j(0.07), tilt = j(0.35), drift = j(0.08) * r, phase = Math.random() * 6.3;
    const pts = [], n = 16;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 - turn * t;
      const rr = r * (1 + 0.045 * Math.sin(3 * a + phase)) + drift * t;
      const x = Math.cos(a) * rr * sx, y = Math.sin(a) * rr;
      pts.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    }
    return smooth(pts);
  }

  function group(parent, cls) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', cls);
    parent.appendChild(g);
    return g;
  }

  function path(parent, d, dur, delay) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('pathLength', '1');
    p.setAttribute('class', 'ink');
    p.style.animationDuration = dur + 'ms';
    p.style.animationDelay = delay + 'ms';
    parent.appendChild(p);
    return { delay, dur };
  }

  const done = strokes => Math.max(...strokes.map(s => s.delay + s.dur));

  // player 1 = X, 2 = O, centered on (cx, cy) in a 100-unit cell.
  function mark(parent, player, cx, cy) {
    const el = group(parent, 'mark ' + (player === 1 ? 'x' : 'o'));
    const strokes = [];
    if (player === 1) {
      const s = 25 + j(2);
      strokes.push(path(el, line(cx - s + j(3), cy - s + j(3), cx + s + j(3), cy + s + j(3), 0.05), X_STROKE, 0));
      strokes.push(path(el, line(cx + s + j(3), cy - s + j(3), cx - s + j(3), cy + s + j(3), 0.05), X_STROKE, X_STROKE + X_GAP));
    } else {
      strokes.push(path(el, loop(cx + j(2), cy + j(2), 28 + j(1.5)), O_TIME, 0));
    }
    return { el, strokes, time: done(strokes) };
  }

  // The two vertical and two horizontal lines of the board (300 x 300).
  function grid(parent) {
    const el = group(parent, 'grid');
    const strokes = [];
    const lines = [[100, 0], [200, 0], [100, 1], [200, 1]];
    lines.forEach(([at, horiz], i) => {
      const a = at + j(3), b = at + j(3), s = 12 + j(6), e = 288 + j(6);
      const d = horiz ? line(s, a, e, b, 0.012) : line(a, s, b, e, 0.012);
      strokes.push(path(el, d, GRID_STROKE, i * GRID_STAGGER));
    });
    return { el, strokes, time: done(strokes) };
  }

  // A line through the winning cells, overshooting both ends.
  function strike(parent, a, b) {
    const el = group(parent, 'strike');
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), k = 36 / len;
    const d = line(a[0] - dx * k + j(4), a[1] - dy * k + j(4), b[0] + dx * k + j(4), b[1] + dy * k + j(4), 0.03);
    const strokes = [path(el, d, STRIKE_TIME, 0)];
    return { el, strokes, time: done(strokes) };
  }

  return { mark, grid, strike };
})();
