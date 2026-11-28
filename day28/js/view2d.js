// Fallback renderer (canvas 2D, painter's algorithm), used only when WebGL is not available.
// Real 3D rendering of the cylinder on a 2D canvas: perspective projection,
// back-face culling, per-face lighting (diffuse + specular) and painter's order.
// World units: cylinder radius 1, y axis up. A point at angle a (degrees, 0 = facing
// the viewer when the view angle is 0) and radius r is at x = r sin a, z = r cos a.
const VIEW2D = (() => {
  const RAD = Math.PI / 180;
  const HALF = 23;                 // half width of a tile slot in degrees (the rest is black bar)
  const RB = 1.0, RT = 1.05, RC = 1.07, RH = 0.9;   // body, tile face, caps, back of the empty slot
  const ROWH = 0.74, TOP = 1.11, BOT = TOP - 3 * ROWH;
  const M = 0.005, GM = 0.004;     // tile inset from the ring edges (tiles in a column touch), half width of the grooves
  const CAP_T = 0.3, CAP_B = 0.34, CH = 0.035;      // cap heights and chamfer
  const DIST = 6.2;                // camera distance from the axis
  const TS = 8;                    // strips across a tile face

  let cv, ctx, dpr = 1, W = 0, H = 0, f = 1, cx = 0, cy = 0, cp = 1, sp = 0;
  let light = false;              // light mode: softer floor shadow, golden glow
  let glow = 0;                    // 0..1, pulsing light when the cylinder is solved (s.glow)
  const G = { R: 100, cx: 0, cy: 0 };
  const confetti = [];
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const LIGHT = norm([-0.5, 0.65, 0.75]);   // camera space, from the upper left front

  // frame: the element whose area the cylinder is fitted and centred in (the canvas may be larger,
  // e.g. the whole window, so the cylinder is never cut off at the edges).
  let frame = null;
  function init(canvas, frameEl) { cv = canvas; frame = frameEl || canvas; ctx = cv.getContext('2d'); resize(); }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    // fitting area in canvas coordinates (minus the view bar under it, when shown)
    const fr = frame.getBoundingClientRect(), bar = document.querySelector('.viewbar');
    const barH = bar && bar.offsetParent !== null ? 48 : 0;
    const fw = Math.max(1, fr.width), fh = Math.max(1, fr.height - barH);
    f = Math.min(fw / 2.75, fh / 3.75) * DIST;
    cx = fr.left - r.left + fw / 2;
    cy = fr.top - r.top + fh / 2 - fh * 0.065;   // a little above the middle
    G.R = f / DIST; G.cx = cx; G.cy = cy;
  }

  // ---------- projection ----------
  // World -> camera space (pitch around x), then perspective.
  function cam(x, y, z) { return [x, y * cp - z * sp, y * sp + z * cp]; }
  function scr(c) { const d = DIST - c[2]; return [cx + f * c[0] / d, cy - f * c[1] / d]; }
  const pol = (a, y, r) => cam(r * Math.sin(a * RAD), y, r * Math.cos(a * RAD));
  const ncam = (x, y, z) => [x, y * cp - z * sp, y * sp + z * cp];
  const radial = a => ncam(Math.sin(a * RAD), 0, Math.cos(a * RAD));
  const UP = () => ncam(0, 1, 0), DOWN = () => ncam(0, -1, 0);

  // Shade a face; returns null when it faces away from the camera.
  function shade(n, p, base, ks = 0.5, shin = 50, always) {
    const v = norm([-p[0], -p[1], DIST - p[2]]);
    const nv = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
    if (nv <= 0.002 && !always) return null;
    const diff = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    const h = norm([LIGHT[0] + v[0], LIGHT[1] + v[1], LIGHT[2] + v[2]]);
    const s = ks * Math.pow(Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]), shin);
    const k = 0.3 + 0.78 * diff;
    return 'rgb(' + base.map(c => Math.round(Math.min(255, c * k + 255 * s))).join(',') + ')';
  }

  // A face: camera-space points, normal, colour. Pushed into a list for sorting.
  // With edge normals n0, n1 (curved strips) the face gets a smooth gradient from pts[0] to pts[1].
  function face(list, pts, n, base, ks, shin, n0, n1) {
    let zx = 0, zy = 0, zz = 0;
    for (const p of pts) { zx += p[0]; zy += p[1]; zz += p[2]; }
    const c = [zx / pts.length, zy / pts.length, zz / pts.length];
    const fill = shade(n, c, base, ks, shin);
    if (!fill) return;
    const q = { pts, fill, z: c[2] };
    if (n0) {
      const s0 = shade(n0, c, base, ks, shin, true), s1 = shade(n1, c, base, ks, shin, true);
      q.grad = [scr(pts[0]), scr(pts[1]), s0, s1];
    }
    list.push(q);
  }

  function paint(list, sort = true) {
    if (sort) list.sort((a, b) => a.z - b.z);
    for (const q of list) {
      ctx.beginPath();
      q.pts.forEach((p, i) => { const s = scr(p); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
      ctx.closePath();
      let st = q.fill;
      if (q.grad) {
        const [a, b, c0, c1] = q.grad;
        if (Math.abs(b[0] - a[0]) > 0.5) { st = ctx.createLinearGradient(a[0], 0, b[0], 0); st.addColorStop(0, c0); st.addColorStop(1, c1); }
      }
      ctx.fillStyle = st; ctx.fill();
      ctx.strokeStyle = st; ctx.stroke();   // hides hairline seams between faces
    }
  }

  // ---------- geometry builders ----------
  // Curved band on a cylinder of radius r, angles a0..a1, heights y0 (top) .. y1 (bottom).
  function band(list, a0, a1, y0, y1, r, base, n = 2, ks, shin, inward = false) {
    for (let i = 0; i < n; i++) {
      const b0 = a0 + (a1 - a0) * i / n, b1 = a0 + (a1 - a0) * (i + 1) / n, nr = radial((b0 + b1) / 2);
      const sg = inward ? -1 : 1, e0 = radial(b0).map(v => v * sg), e1 = radial(b1).map(v => v * sg);
      face(list, [pol(b0, y0, r), pol(b1, y0, r), pol(b1, y1, r), pol(b0, y1, r)],
        nr.map(v => v * sg), base, ks, shin, e0, e1);
    }
  }
  // Flat ring (annulus) at height y between radii r0 and r1, facing up or down.
  function ring(list, a0, a1, y, r0, r1, base, n, up, ks, shin) {
    const nn = up ? UP() : DOWN();
    for (let i = 0; i < n; i++) {
      const b0 = a0 + (a1 - a0) * i / n, b1 = a0 + (a1 - a0) * (i + 1) / n;
      face(list, [pol(b0, y, r0), pol(b1, y, r0), pol(b1, y, r1), pol(b0, y, r1)], nn, base, ks, shin);
    }
  }
  // Radial wall at angle a (between radii r0..r1, heights y0..y1); dir = +1 faces increasing angles.
  function wall(list, a, y0, y1, r0, r1, dir, base, ks, shin) {
    const n = ncam(Math.cos(a * RAD) * dir, 0, -Math.sin(a * RAD) * dir);
    face(list, [pol(a, y0, r0), pol(a, y0, r1), pol(a, y1, r1), pol(a, y1, r0)], n, base, ks, shin);
  }

  // Faces farther than this from the front can never be seen (tiles stick out, so up to about 98 degrees is visible).
  const LIM = 105;
  const clipA = (a0, a1) => { a0 = Math.max(a0, -LIM); a1 = Math.min(a1, LIM); return a1 > a0 ? [a0, a1] : null; };
  const wrap = a => ((a + 180) % 360 + 360) % 360 - 180;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
  const RIB = 4.5;                 // half width of a rib in degrees
  const RIBC = [24, 24, 27];
  const BODY = [20, 20, 23], CAP = [25, 25, 28], GROOVE = [5, 5, 6], HOLE = [16, 16, 18];

  // ---------- drawing ----------
  // s = { grid, view, pitch, ring: [3 offsets], slide: {c, r, to, p} | null, hover: {r, c} | null }
  function draw(s) {
    const pitch = (s.pitch === undefined ? 24 : s.pitch) * RAD;
    cp = Math.cos(pitch); sp = Math.sin(pitch);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 0.8; ctx.lineJoin = 'round';

    shadow();
    glow = s.glow || 0;
    light = document.documentElement.classList.contains('light');
    if (glow > 0) halo();

    const rowTop = k => TOP - k * ROWH;
    const tileY = (k) => [rowTop(k) - M, rowTop(k) - ROWH + M];
    const angle = (r, c) => wrap(c * 60 + s.ring[r] - s.view);
    const isHole = (r, c) => s.grid[r][c] === PUZZLE.GAP || (s.slide && s.slide.c === c && (s.slide.r === r || s.slide.to === r));

    // 1. bottom cap: side band, then the ledge around the body
    let L = [];
    band(L, -180, 180, BOT - CH, BOT - CAP_B, RC, CAP, 48, 0.55, 60);   // below the bevel, or it pokes out over it
    ring(L, -180, 180, BOT, RB * 0.97, RC - CH, CAP, 48, true, 0.5, 60);   // starts under the body: no gaps
    chamfer(L, BOT, RC, CAP);
    paint(L);

    // 2. inner black cylinder (closes the inside, seen through the empty slot) and the grooves between rings
    L = [];
    band(L, -90, 90, TOP, BOT, RH, HOLE, 24, 0.15, 12);
    paint(L);
    L = [];
    for (let k = 1; k < 3; k++) band(L, -180, 180, rowTop(k) + GM, rowTop(k) - GM, RB * 0.985, GROOVE, 48, 0.2, 20);
    paint(L);
    // underside of the top cap (faces down: seen only when the camera is lower than it), all of it from the
    // body to the edge; drawn before the rings, so tiles and body cover the parts they hide
    L = [];
    ring(L, -180, 180, TOP, RB * 0.97, RC, CAP, 48, false, 0.3, 40);
    paint(L);

    // 3. the rings, one sector at a time, back to front by real camera depth: a slot (body around it,
    //    then its tile or the empty recess) or a bar between two columns (body, then the rib).
    //    Nearer sectors cover the farther ones, so tiles sticking out at the edges stay correct.
    const items = [];
    for (let r = 0; r < 3; r++) {
      const yT = rowTop(r) - (r ? GM : 0), yB = rowTop(r) - ROWH + (r < 2 ? GM : 0), [t0, t1] = tileY(r);
      for (let c = 0; c < 6; c++) {
        const a = angle(r, c), v = s.grid[r][c];
        items.push({ kind: 'slot', r, c, a, yT, yB, t0, t1, hole: isHole(r, c), v, hi: s.hover && s.hover.r === r && s.hover.c === c });
        items.push({ kind: 'bar', r, a: wrap(a + 30), yT, yB });
      }
    }
    if (s.slide) {
      const sl = s.slide, yy = rowTop(sl.r) + (rowTop(sl.to) - rowTop(sl.r)) * sl.p;
      items.push({ kind: 'slide', r: Math.min(sl.r, sl.to), a: angle(sl.r, sl.c), yT: yy - M, yB: yy - ROWH + M, v: s.grid[sl.r][sl.c] });
    }
    items.forEach(t => t.z = pol(t.a, (t.yT + t.yB) / 2, RB)[2]);
    // a sliding tile goes right after both slots it moves between, or their recess would cover it
    if (s.slide) {
      const sl = s.slide, ends = items.filter(t => t.kind === 'slot' && t.c === sl.c && (t.r === sl.r || t.r === sl.to));
      items[items.length - 1].z = Math.max(...ends.map(t => t.z)) + 1e-6;
    }
    // The camera always looks down, so a ring never covers the ring above it: rings bottom to top, each back to front.
    items.sort((p, q) => q.r - p.r || p.z - q.z);
    for (const t of items) {
      if (Math.abs(t.a) > 125) continue;          // fully hidden behind the body
      if (t.kind === 'bar') {
        L = [];
        band(L, t.a - 30 + HALF, t.a + 30 - HALF, t.yT, t.yB, RB, BODY, 2, 0.55, 70);
        paint(L);
        rib({ a: t.a, y: [t.yT, t.yB] });
      } else if (t.kind === 'slot') {
        const a0 = t.a - HALF, a1 = t.a + HALF;
        L = [];
        band(L, a0, a1, t.yT, t.t0, RB, BODY, 4, 0.55, 70);
        band(L, a0, a1, t.t1, t.yB, RB, BODY, 4, 0.55, 70);
        if (t.hole) {
          band(L, a0, a1, t.t0, t.t1, RH, HOLE, 6, 0.15, 12);
          ring(L, a0, a1, t.t0, RH, RB, [30, 30, 34], 6, false, 0.1, 10);
          ring(L, a0, a1, t.t1, RH, RB, [30, 30, 34], 6, true, 0.1, 10);
          wall(L, a0, t.t0, t.t1, RH, RB, 1, [30, 30, 34], 0.1, 10);
          wall(L, a1, t.t0, t.t1, RH, RB, -1, [30, 30, 34], 0.1, 10);
        }
        paint(L);
        if (!t.hole) tile({ a: t.a, y: [t.t0, t.t1], v: t.v, hi: t.hi });
      } else tile({ a: t.a, y: [t.yT, t.yB], v: t.v });
    }

    // 5. top cap: side band, chamfer and lid
    L = [];
    band(L, -180, 180, TOP + CAP_T - CH, TOP, RC, CAP, 48, 0.55, 60);
    paint(L);
    L = [];
    chamfer(L, TOP + CAP_T, RC, CAP, true);
    paint(L);
    lid(TOP + CAP_T);

    drawConfetti();
  }

  // Small bevel at the edge of a cap (top: between the side and the lid).
  function chamfer(L, y, r, base, top) {
    const n = 48;
    for (let i = 0; i < n; i++) {
      const b0 = -180 + 360 * i / n, b1 = b0 + 360 / n, m = (b0 + b1) / 2;
      const cn = a => norm(ncam(Math.sin(a * RAD) * 0.7, 0.7, Math.cos(a * RAD) * 0.7));
      if (top) face(L, [pol(b0, y - CH, r), pol(b1, y - CH, r), pol(b1, y, r - CH), pol(b0, y, r - CH)], cn(m), base, 0.45, 40, cn(b0), cn(b1));
      else face(L, [pol(b0, y, r - CH), pol(b1, y, r - CH), pol(b1, y - CH, r), pol(b0, y - CH, r)], cn(m), base, 0.45, 40, cn(b0), cn(b1));
    }
  }

  function lid(y) {
    // camera height in world units: below the lid its top face cannot be seen
    if (DIST * sp <= y) return;
    const r = RC - CH, n = 72, pts = [];
    for (let i = 0; i < n; i++) pts.push(scr(pol(-180 + 360 * i / n, y, r)));
    const c = scr(pol(0, y, 0));
    const g = ctx.createLinearGradient(c[0] - f / DIST, c[1] - f / DIST * 0.5, c[0] + f / DIST, c[1] + f / DIST * 0.5);
    g.addColorStop(0, '#2e2e33'); g.addColorStop(0.5, '#18181b'); g.addColorStop(1, '#0d0d0f');
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    // a shallow raised disc in the middle of the lid
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const p = scr(pol(-180 + 360 * i / n, y, 0.78)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.lineWidth = 0.8;
  }

  // ---------- glow when solved ----------
  // Golden halo behind the whole cylinder: its outline (hull of the two caps) stroked many times,
  // wider and fainter each time, so the light fades smoothly away from the edge (no blur, no box artefacts).
  function halo() {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = 360 * i / 48;
      pts.push(scr(pol(a, TOP + CAP_T, RC)), scr(pol(a, BOT - CAP_B, RC)));
    }
    const h = hull(pts), n = 24, maxW = G.R * (0.035 + 0.045 * glow);
    ctx.save();
    ctx.beginPath(); h.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = light ? `rgba(255, 253, 238, ${0.07 + 0.09 * glow})` : `rgba(255, 250, 215, ${0.02 + 0.04 * glow})`;
    for (let i = 0; i < n; i++) { ctx.lineWidth = maxW * (1 - i / n) * 2; ctx.stroke(); }
    ctx.restore();
  }
  // Pulsing light on a tile face, with a soft halo in the tile's colour.
  function shine(a0, a1, y0, y1, hex) {
    const fr = frontRange(a0, a1, (y0 + y1) / 2, RT);
    if (!fr) return;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= TS; i++) { const p = scr(pol(fr[0] + (fr[1] - fr[0]) * i / TS, y0, RT)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    for (let i = TS; i >= 0; i--) { const p = scr(pol(fr[0] + (fr[1] - fr[0]) * i / TS, y1, RT)); ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = hex; ctx.shadowBlur = G.R * 0.12 * glow * dpr;
    ctx.fillStyle = `rgba(255, 252, 230, ${0.18 * glow})`;
    ctx.fill();
    ctx.restore();
  }
  // Convex hull of screen points (monotone chain).
  function hull(p) {
    p = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  // Shadow on the floor (the plane under the base): a dark, tight contact shadow right at the edge
  // of the base, plus a wide soft shadow pushed away from the light (to the right and back).
  function shadow() {
    const y = BOT - CAP_B - 0.002;
    const dark = light ? [60, 45, 25] : [0, 0, 0];
    floorBlob(0, 0, RC * 1.12, y, dark, light ? 0.45 : 0.75, 0.82);
    floorBlob(0.75, -0.2, RC * 1.55, y, dark, light ? 0.26 : 0.45, 0.15);
  }
  // Soft disc on the floor: circle (x, z, radius r) projected to a screen ellipse, filled with a radial
  // gradient that is solid up to `core` of the radius and fades to nothing at the rim.
  function floorBlob(x, z, r, y, rgb, alpha, core) {
    const pts = [];
    for (let i = 0; i < 36; i++) { const a = i / 36 * Math.PI * 2; pts.push(scr(cam(x + r * Math.sin(a), y, z + r * Math.cos(a)))); }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const ex = (x0 + x1) / 2, ey = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = Math.max(1, (y1 - y0) / 2);
    const c = rgb.join(',');
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(${c},${alpha})`);
    g.addColorStop(core, `rgba(${c},${alpha * 0.85})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.save();
    ctx.translate(ex, ey); ctx.scale(1, ry / rx);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }


  // A rib: a narrow black slab standing out of the body up to the tile faces.
  function rib(t) {
    const a0 = t.a - RIB, a1 = t.a + RIB, [y0, y1] = t.y, v = clipA(a0, a1);
    if (!v) return;
    const L = [];
    ring(L, v[0], v[1], y0, RB, RT, RIBC, 2, true, 0.5, 60);
    if (Math.abs(a0) < LIM) wall(L, a0, y0, y1, RB, RT, -1, RIBC, 0.6, 60);
    if (Math.abs(a1) < LIM) wall(L, a1, y0, y1, RB, RT, 1, RIBC, 0.6, 60);
    paint(L);
    const F = [];
    band(F, a0, a1, y0, y1, RT, RIBC, 3, 0.6, 60);
    paint(F, false);
  }

  function tile(t) {
    const base = rgb(PUZZLE.COLOURS[t.v].hex), a0 = t.a - HALF, a1 = t.a + HALF, [y0, y1] = t.y;
    const v = clipA(a0, a1);
    if (!v) return;
    // top, bottom and side faces only on the visible half: beyond it the body hides them
    const L = [];
    ring(L, v[0], v[1], y0, RB, RT, base, 4, true, 0.3, 30);
    ring(L, v[0], v[1], y1, RB, RT, base, 4, false, 0.3, 30);
    if (Math.abs(a0) < LIM) wall(L, a0, y0, y1, RB, RT, -1, base, 0.3, 30);
    if (Math.abs(a1) < LIM) wall(L, a1, y0, y1, RB, RT, 1, base, 0.3, 30);
    paint(L);
    const F = [];
    band(F, a0, a1, y0, y1, RT, base, TS, 0.42, 28);
    paint(F, false);
    if (glow > 0) shine(a0, a1, y0, y1, PUZZLE.COLOURS[t.v].hex);
    // Lines on the face only where the face looks at the camera: past the edge they would show through.
    const fr = frontRange(a0, a1, (y0 + y1) / 2, RT);
    if (!fr) return;
    // thin seam at the bottom edge, so tiles that touch stay readable
    ctx.beginPath();
    for (let i = 0; i <= TS; i++) { const p = scr(pol(fr[0] + (fr[1] - fr[0]) * i / TS, y1, RT)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineWidth = 0.8;
    star(t.a, (y0 + y1) / 2, (y0 - y1) * 0.27);
    if (t.hi) {
      ctx.beginPath();
      for (let i = 0; i <= TS; i++) { const p = scr(pol(fr[0] + (fr[1] - fr[0]) * i / TS, y0, RT)); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
      for (let i = TS; i >= 0; i--) { const p = scr(pol(fr[0] + (fr[1] - fr[0]) * i / TS, y1, RT)); ctx.lineTo(p[0], p[1]); }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(2, G.R * 0.02); ctx.stroke();
      ctx.lineWidth = 0.8;
    }
  }

  // Part [b0, b1] of the angles a0..a1 where a cylinder surface of radius r faces the camera, or null.
  function frontRange(a0, a1, y, r) {
    const n = 24;
    let b0 = null, b1 = null;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, p = pol(a, y, r), nr = radial(a);
      if (nr[0] * -p[0] + nr[1] * -p[1] + nr[2] * (DIST - p[2]) > 0) { if (b0 === null) b0 = a; b1 = a; }
    }
    return b0 === null || b1 - b0 < 0.5 ? null : [b0, b1];
  }

  // Embossed 5-point star on a tile face.
  function star(a, ym, size) {
    const c = pol(a, ym, RT), n = radial(a);
    const v = norm([-c[0], -c[1], DIST - c[2]]);
    const k = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
    if (k < 0.2) return;
    const path = dy => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const t = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? size * 0.42 : size;
        const u = rr * Math.cos(t), w = -rr * Math.sin(t);
        const p = scr(pol(a + (u / RT) / RAD, ym + w + dy, RT + 0.002));
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      }
      ctx.closePath();
    };
    ctx.lineWidth = Math.max(1, G.R * 0.012);
    path(-0.008); ctx.strokeStyle = `rgba(255,255,255,${0.3 * k})`; ctx.stroke();
    path(0); ctx.strokeStyle = `rgba(0,0,0,${0.22 * k})`; ctx.stroke();
    ctx.lineWidth = 0.8;
  }

  // ---------- picking: cast a ray from the screen point into the world ----------
  function ray(x, y) {
    const d = [(x - cx) / f, -(y - cy) / f, -1], o = [0, 0, DIST];
    // camera space -> world (inverse pitch)
    const un = v => [v[0], v[1] * cp + v[2] * sp, -v[1] * sp + v[2] * cp];
    return { o: un(o), d: un(d) };
  }
  function hitCyl(x, y, R) {
    const { o, d } = ray(x, y);
    const A = d[0] * d[0] + d[2] * d[2], B = 2 * (o[0] * d[0] + o[2] * d[2]), C = o[0] * o[0] + o[2] * o[2] - R * R;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    const p = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
    return { y: p[1], a: Math.atan2(p[0], p[2]) / RAD, o, d };
  }

  // Screen point -> { r, c } of the cell under it (c = puzzle column), or null.
  function hit(x, y, s) {
    const h = hitCyl(x, y, RT);
    if (!h || h.y > TOP || h.y < BOT) return null;
    const r = Math.floor((TOP - h.y) / ROWH);
    if (r < 0 || r > 2) return null;
    const c = PUZZLE.mod(Math.round((h.a + s.view - s.ring[r]) / 60));
    return { r, c, a: h.a };
  }

  // Is the point on the cylinder at all (body, caps, lid)?
  function onBody(x, y) {
    const h = hitCyl(x, y, RC);
    if (h && h.y < TOP + CAP_T && h.y > BOT - CAP_B) return true;
    if (!h) return false;
    // the lid, seen from above
    const t = (TOP + CAP_T - h.o[1]) / h.d[1], px = h.o[0] + t * h.d[0], pz = h.o[2] + t * h.d[2];
    return t > 0 && px * px + pz * pz < RC * RC;
  }

  // ---------- confetti stars for the win ----------
  function burst() {
    const top = scr(pol(0, TOP + CAP_T, 0));
    for (let i = 0; i < 140; i++) {
      confetti.push({
        x: top[0] + (Math.random() - 0.5) * G.R, y: top[1],
        vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 9,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        s: 4 + Math.random() * 6, col: PUZZLE.COLOURS[i % 6].hex,
      });
    }
  }
  function drawConfetti() {
    for (let i = confetti.length - 1; i >= 0; i--) {
      const p = confetti[i];
      p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y > H + 20) { confetti.splice(i, 1); continue; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 2));
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const t = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? p.s * 0.45 : p.s;
        k ? ctx.lineTo(rr * Math.cos(t), rr * Math.sin(t)) : ctx.moveTo(rr * Math.cos(t), rr * Math.sin(t));
      }
      ctx.fillStyle = p.col; ctx.fill();
      ctx.restore();
    }
  }

  return { init, resize, draw, hit, onBody, burst, G };
})();
