// SVG export: a stand-in for CanvasRenderingContext2D that records what a
// piece draws as SVG elements, so every study can be saved as vectors
// (for large prints or a real pen plotter). It covers the subset of the
// canvas API the studies use: paths, arcs, quadratic curves, rects,
// transforms, save/restore, clip, Path2D, colours, line width and alpha.
const SVGX = (() => {
  // Path2D stand-in: records its commands in its own coordinates; they are
  // transformed by the context when it is stroked or filled.
  class RecPath {
    constructor() { this.ops = []; }
    moveTo(x, y) { this.ops.push(['M', x, y]); }
    lineTo(x, y) { this.ops.push(['L', x, y]); }
    closePath() { this.ops.push(['Z']); }
    rect(x, y, w, h) { this.ops.push(['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']); }
    arc(x, y, r, a0, a1, ccw) { this.ops.push(['A', x, y, r, a0, a1, !!ccw]); }
    quadraticCurveTo(cx, cy, x, y) { this.ops.push(['Q', cx, cy, x, y]); }
  }

  const num = v => +v.toFixed(2);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // Points along an arc, with the canvas sweep rules.
  function arcPoints(x, y, r, a0, a1, ccw, scale) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = sweep % TAU + TAU;
    if (ccw && sweep > 0) sweep = sweep % TAU - TAU;
    if (Math.abs(a1 - a0) >= TAU) sweep = ccw ? -TAU : TAU;
    const n = Math.max(8, Math.min(240, Math.ceil(Math.abs(sweep) * r * scale / 3)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + sweep * (i / n);
      pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
    return pts;
  }

  function context(width, height) {
    const out = [], clips = [];
    let m = [1, 0, 0, 1, 0, 0];          // a b c d e f, like setTransform
    let path = new RecPath();            // current path, already in page coordinates
    let st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1, clip: null };
    const stack = [];
    const tx = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const scaleOf = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const mul = (a, b, c, d, e, f) => {
      m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
    };

    // Turn recorded ops into an SVG path string, transforming with matrix tm.
    function toD(ops, tm) {
      const T = (x, y) => [tm[0] * x + tm[2] * y + tm[4], tm[1] * x + tm[3] * y + tm[5]];
      const sc = Math.sqrt(Math.abs(tm[0] * tm[3] - tm[1] * tm[2])) || 1;
      let d = '', open = false;
      for (const op of ops) {
        if (op[0] === 'M') { const [x, y] = T(op[1], op[2]); d += 'M' + num(x) + ' ' + num(y); open = true; }
        else if (op[0] === 'L') { const [x, y] = T(op[1], op[2]); d += (open ? 'L' : 'M') + num(x) + ' ' + num(y); open = true; }
        else if (op[0] === 'Z') { if (open) d += 'Z'; }
        else if (op[0] === 'Q') {
          const [cx, cy] = T(op[1], op[2]), [x, y] = T(op[3], op[4]);
          d += 'Q' + num(cx) + ' ' + num(cy) + ' ' + num(x) + ' ' + num(y); open = true;
        } else if (op[0] === 'A') {
          arcPoints(op[1], op[2], op[3], op[4], op[5], op[6], sc).forEach(([px, py], i) => {
            const [x, y] = T(px, py);
            d += (i === 0 && !open ? 'M' : 'L') + num(x) + ' ' + num(y);
          });
          open = true;
        }
      }
      return d;
    }

    const attrs = () => (st.clip ? ' clip-path="url(#' + st.clip + ')"' : '') + (st.globalAlpha < 1 ? ' opacity="' + num(st.globalAlpha) + '"' : '');
    function emitFill(d) {
      if (d) out.push('<path d="' + d + '" fill="' + esc(st.fillStyle) + '"' + attrs() + '/>');
    }
    function emitStroke(d, sc) {
      if (d) out.push('<path d="' + d + '" fill="none" stroke="' + esc(st.strokeStyle) + '" stroke-width="' + num(st.lineWidth * sc) +
        '" stroke-linecap="' + st.lineCap + '" stroke-linejoin="' + st.lineJoin + '"' + attrs() + '/>');
    }

    const ctx = {
      beginPath() { path = new RecPath(); },
      moveTo(x, y) { const [a, b] = tx(x, y); path.moveTo(a, b); },
      lineTo(x, y) { const [a, b] = tx(x, y); path.lineTo(a, b); },
      closePath() { path.closePath(); },
      quadraticCurveTo(cx, cy, x, y) { const [a, b] = tx(cx, cy), [c, d] = tx(x, y); path.quadraticCurveTo(a, b, c, d); },
      arc(x, y, r, a0, a1, ccw) {
        // Flattened now, with the current transform (rotations, scales).
        arcPoints(x, y, r, a0, a1, ccw, scaleOf()).forEach(([px, py], i) => {
          const [a, b] = tx(px, py);
          if (i === 0 && !path.ops.length) path.moveTo(a, b); else path.lineTo(a, b);
        });
      },
      rect(x, y, w, h) { ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); },
      roundRect(x, y, w, h, radii) {
        const [tl, tr, br, bl] = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        if (tr) ctx.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0);
        ctx.lineTo(x + w, y + h - br);
        if (br) ctx.arc(x + w - br, y + h - br, br, 0, Math.PI / 2);
        ctx.lineTo(x + bl, y + h);
        if (bl) ctx.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI);
        ctx.lineTo(x, y + tl);
        if (tl) ctx.arc(x + tl, y + tl, tl, Math.PI, Math.PI * 1.5);
        ctx.closePath();
      },
      fill(p) { emitFill(p instanceof RecPath ? toD(p.ops, m) : toD(path.ops, [1, 0, 0, 1, 0, 0])); },
      stroke(p) { emitStroke(p instanceof RecPath ? toD(p.ops, m) : toD(path.ops, [1, 0, 0, 1, 0, 0]), scaleOf()); },
      fillRect(x, y, w, h) { const keep = path; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.fill(); path = keep; },
      strokeRect(x, y, w, h) { const keep = path; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke(); path = keep; },
      clip() {
        const id = 'c' + clips.length;
        clips.push('<clipPath id="' + id + '"><path d="' + toD(path.ops, [1, 0, 0, 1, 0, 0]) + '"/></clipPath>');
        st.clip = id; // only the innermost clip is kept (enough for these studies)
      },
      save() { stack.push({ st: { ...st }, m: m.slice() }); },
      restore() { const s = stack.pop(); if (s) { st = s.st; m = s.m; } },
      translate(x, y) { mul(1, 0, 0, 1, x, y); },
      scale(x, y) { mul(x, 0, 0, y, 0, 0); },
      rotate(a) { const c = Math.cos(a), s = Math.sin(a); mul(c, s, -s, c, 0, 0); },
      setTransform(a, b, c, d, e, f) { m = [a, b, c, d, e, f]; },
    };
    for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha']) {
      Object.defineProperty(ctx, k, { get: () => st[k], set: v => { st[k] = v; } });
    }
    ctx.toString = () => '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height + '">\n<defs>' + clips.join('') + '</defs>\n' + out.join('\n') + '\n</svg>\n';
    return ctx;
  }

  // Render a freshly made piece at time t into an SVG string. Pieces build
  // Path2D objects, so Path2D is swapped for the recorder while they run.
  function render(makePiece, paint, w, h, t) {
    const real = window.Path2D;
    window.Path2D = RecPath;
    try {
      const piece = makePiece();
      const ctx = context(w, h);
      paint(ctx, piece, w, h, t);
      return ctx.toString();
    } finally {
      window.Path2D = real;
    }
  }

  return { render };
})();
