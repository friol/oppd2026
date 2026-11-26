// Pixel art renderer: sky, weather, the building in cutaway with its homes and shops, residents, street life and effects.
// World coordinates: x = 0 is the left outer wall, y = 0 is the street level (floors go up into negative y).
'use strict';

const RENDER = (() => {
  const FH = 60, SLAB = 4, AW = 150, WALL = 6;
  const AX = { A: 6, B: 198 }, SX = 159, STW = 36, BW = 354;
  const C = {
    outline: '#2a1a1a', facade: '#f0b27a', facadeDk: '#d9925e', facadeLt: '#f8c898', slab: '#c8553d', slabDk: '#8a3a2a',
    stair: '#e6d2ae', stairDk: '#b89a74', wood: '#9a6a44', woodDk: '#5a3a24', woodLt: '#c0905a', rail: '#3a2a2a',
    sidewalk: '#b8b0a8', curb: '#8a8480', road: '#4a4a52', line: '#e8e0c0', glass: '#a8d0e8', metal: '#a0a8b0'
  };

  let cv, ctx, scn, sx, stc, st, g; // main canvas, offscreen building and street layers, and the context the helpers draw on
  let vw = 800, vh = 450, cam = { x: 0, y: 0, w: 400, h: 225, s: 2 }, fitS = 0, zoom = 1, focus = { x: 177, y: -60 };
  let time = 0, last = 0, dt = 0.016, speedNow = 1, skyNow = ['#000000', '#000000'];
  const people = {}, prevState = {}, guests = {}, spots = {}, customers = {};
  let walkers = [], cars = [], icons = [], parts = [], clouds = [], stars = [], skyline = [], pigeons = [];
  let shake = null, flash = 0, bolt = null, plane = null, hailUntil = 0, elev = { y: -40, target: 0, wait: 0 };
  let sel = null, hover = null;
  let bubbles = [], floats = [], scenes = [];

  // ---------- helpers ----------
  const S = () => SIM.S;
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  function hash(str) { let h = 2166136261; str = String(str); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
  function srng(seed) { let s = Math.floor(seed * 2147483646) + 1; return () => (s = s * 16807 % 2147483647) / 2147483647; }
  function disc(cx, cy, r, col) { g.fillStyle = col; for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(cx - w, cy + dy, w * 2 + 1, 1); } }
  const floorTop = f => -FH * (f + 1);
  const roofY = () => floorTop(S().floors);
  function room(u) { const ry = floorTop(u.floor) + SLAB; return { rx: AX[u.side], ry, fy: ry + 53 }; }
  const units = () => S().units;
  const famOf = u => SIM.famOf(u);
  const hr = () => S().t % 24;

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    scn = document.createElement('canvas'); sx = scn.getContext('2d'); g = sx;
    stc = document.createElement('canvas'); st = stc.getContext('2d');
    for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random() * 0.7, p: Math.random() });
    let x = -900;
    while (x < 1300) { const w = U.irand(30, 70); skyline.push({ x, w, h: U.irand(50, 170), seed: Math.random(), roof: U.irand(0, 3) }); x += w + U.irand(-8, 10); }
    for (let i = 0; i < 6; i++) clouds.push(newCloud(Math.random()));
    pigeons = [20, 30, 120, 260].map(px => ({ x: px, fly: 0, y: 0 }));
    BUS.on('fx', e => addIcon(e.apt, e.icon));
    BUS.on('vehicle', e => addCar(e.type, e.hours, e.apt));
    BUS.on('confetti', id => confetti(id));
    BUS.on('quake', mag => { shake = { until: time + 2.5 + mag * 0.3, mag: Math.max(1, mag - 3.5) }; scarePigeons(); debris(30); });
    BUS.on('lightning', strike => { flash = 0.35; bolt = { until: time + 0.25, strike, x: U.rand(0.1, 0.9) }; scarePigeons(); });
    BUS.on('hail', () => { hailUntil = time + 6; });
    BUS.on('fireworks', () => { fireworksUntil = time + 10; });
    BUS.on('say', e => {
      const same = bubbles.filter(b => b.apt === e.apt);
      if (same.length >= 2) bubbles.splice(bubbles.indexOf(same[0]), 1);
      if (bubbles.length < 14) bubbles.push({ apt: e.apt, text: String(e.text).toUpperCase(), t: -(e.delay || 0), pick: Math.random() });
    });
    BUS.on('money', e => { if (floats.length < 40) floats.push({ apt: e.apt, amount: e.amount, t: -Math.min(1.5, floats.filter(f => f.t <= 0).length * 0.06) }); });
    BUS.on('scene', e => { if (scenes.length < 4) scenes.push({ ...e, t: 0, guests: Array.from({ length: 6 }, () => randomLook({ age: U.irand(8, 75), sex: U.pick(['m', 'f']) })) }); });
    BUS.on('plane', e => { plane = { t: 0, crash: e.crash, y0: roofY() }; scarePigeons(); });
  }
  function reset() {
    for (const o of [people, prevState, guests, spots, customers]) for (const k in o) delete o[k];
    walkers = []; cars = []; icons = []; parts = []; plane = null; shake = null; zoom = 1; fitS = 0;
  }

  // ---------- camera ----------
  function regionTop() { const s = S(); return roofY() - (s.floorWork ? FH + 80 : 40); }
  function updateCam() {
    const rl = -32, rr = BW + 32, rb = 54, top = regionTop();
    const target = Math.min(vw / (rr - rl), vh / (rb - top));
    fitS = fitS ? fitS + (target - fitS) * Math.min(1, dt * 2.5) : target;
    const s = fitS * zoom;
    const w = Math.max(50, Math.round(vw / s)), h = Math.max(50, Math.round(vh / s));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; scn.width = w; scn.height = h; stc.width = w; stc.height = h; ctx.imageSmoothingEnabled = false; sx.imageSmoothingEnabled = false; st.imageSmoothingEnabled = false; }
    let x, y;
    if (zoom <= 1.001) { x = BW / 2 - w / 2; y = rb - h; }
    else {
      // Pan limits; when the view is wider (or taller) than the area, centre it instead,
      // otherwise the clamp bounces between its two ends every frame.
      const x0 = rl - 60, x1 = rr + 60 - w, y0 = top - 80, y1 = rb - h;
      x = x1 > x0 ? U.clamp(focus.x - w / 2, x0, x1) : BW / 2 - w / 2;
      y = y1 > y0 ? U.clamp(focus.y - h / 2, y0, y1) : y1;
      focus.x = x + w / 2; focus.y = y + h / 2;
    }
    cam = { x: Math.round(x), y: Math.round(y), w, h, s };
  }
  function resize(w, h) { vw = Math.max(50, w); vh = Math.max(50, h); }
  function toWorld(px, py) { return [cam.x + px / vw * cam.w, cam.y + py / vh * cam.h]; }
  function zoomAt(px, py, factor) {
    const [wx, wy] = toWorld(px, py);
    const nz = U.clamp(zoom * factor, 1, 4);
    if (nz === zoom) return;
    zoom = nz;
    const s = fitS * zoom, w = vw / s, h = vh / s;
    focus = { x: wx - px / vw * w + w / 2, y: wy - py / vh * h + h / 2 };
  }
  function pan(dx, dy) { if (zoom > 1.001) { focus.x -= dx / cam.s; focus.y -= dy / cam.s; } }

  // ---------- look and calendar ----------
  let festNow = null, fireworksUntil = 0;
  function applyLook() {
    const L = DATA.looks, lk = S().look || { facade: 0, roof: 0, rail: 0 };
    C.facade = L.facade.opts[lk.facade][1]; C.facadeDk = U.shade(C.facade, -0.12); C.facadeLt = U.shade(C.facade, 0.12);
    C.slab = L.roof.opts[lk.roof][1]; C.slabDk = U.shade(C.slab, -0.32);
    C.rail = L.rail.opts[lk.rail][1];
  }

  // ---------- sky ----------
  const SKY = [[0, '#0a0f2c', '#1b2450'], [5, '#141a44', '#30305a'], [6.5, '#5a6fb0', '#f0a070'], [8, '#4f9be0', '#a8d8f0'],
    [12, '#3d8fe0', '#9fd4f5'], [17, '#4f8fd0', '#b0d0e8'], [19, '#40508f', '#f08050'], [20.5, '#1a2050', '#503a70'], [22, '#0d1236', '#1e2652'], [24, '#0a0f2c', '#1b2450']];
  function darkness(h, raw) {
    let d;
    if (h >= 7.5 && h < 17.5) d = 0;
    else if (h >= 17.5 && h < 21) d = (h - 17.5) / 3.5 * 0.62;
    else if (h >= 21 || h < 5) d = 0.62;
    else d = 0.62 * (1 - (h - 5) / 2.5);
    if (raw) return d;
    d += ({ cloudy: 0.05, rain: 0.12, storm: 0.25, fog: 0.1, snow: 0.06 }[S().weather.type] || 0) * (1 - d);
    return Math.min(0.72, d);
  }
  function skyColors(h) {
    let i = 0; while (h >= SKY[i + 1][0]) i++;
    const a = SKY[i], b = SKY[i + 1], t = (h - a[0]) / (b[0] - a[0]);
    let top = U.mix(a[1], b[1], t), bot = U.mix(a[2], b[2], t);
    const tint = { cloudy: ['#7a8290', 0.35], rain: ['#5a6270', 0.6], storm: ['#2e333e', 0.75], fog: ['#a8acb0', 0.6], snow: ['#b0b6c0', 0.5] }[S().weather.type];
    if (tint) { const dk = darkness(h, true), k = tint[1] * (1 - dk * 0.9); top = U.mix(top, U.shade(tint[0], -dk), k); bot = U.mix(bot, U.shade(tint[0], -dk * 0.8), k); }
    return [top, bot];
  }
  // Airliners and helicopters crossing the sky, and shooting stars on clear nights (screen coordinates, behind the clouds).
  let skyObjs = [];
  function drawSkyTraffic(h, gy, dk, clear) {
    const W = cam.w, storm = S().weather.type === 'storm';
    if (skyObjs.filter(o => o.type !== 'star').length < 2 && !storm) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (Math.random() < 0.03 * dt) skyObjs.push({ type: 'plane', x: dir > 0 ? -20 : W + 20, y: U.rand(0.08, 0.3) * gy, vx: dir * U.rand(14, 22) });
      else if (Math.random() < 0.015 * dt) skyObjs.push({ type: 'heli', x: dir > 0 ? -20 : W + 20, y: U.rand(0.3, 0.55) * gy, vx: dir * U.rand(10, 15), bob: Math.random() * 6 });
    }
    if (dk > 0.4 && clear && Math.random() < 0.1 * dt) skyObjs.push({ type: 'star', x: U.rand(0.1, 0.9) * W, y: U.rand(0.03, 0.35) * gy, vx: U.pick([-1, 1]) * U.rand(70, 110), vy: U.rand(30, 50), t: 0 });
    const night = dk > 0.3, blink = Math.floor(time * 2) % 2 === 0;
    const P = (px, py, w, hh, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(px), Math.round(py), w, hh); };
    for (const o of skyObjs) {
      if (o.type === 'star') {
        o.t += dt; o.x += o.vx * dt; o.y += o.vy * dt;
        const a = Math.max(0, 1 - o.t / 0.7);
        for (let i = 0; i < 14; i++) { ctx.fillStyle = 'rgba(255,255,230,' + (a * (1 - i / 14)).toFixed(2) + ')'; ctx.fillRect(Math.round(o.x - o.vx * i * 0.012), Math.round(o.y - o.vy * i * 0.012), 1, 1); }
        continue;
      }
      o.x += o.vx * dt;
      const f = o.vx > 0 ? 1 : -1, x0 = o.x;
      const X = (dx) => f > 0 ? x0 + dx : x0 - dx; // mirror the sprite for planes flying left
      if (o.type === 'plane') {
        const y = o.y, body = night ? '#30344a' : '#e8e8f0';
        if (!night && clear) for (let i = 4; i < 40; i += 2) P(X(-i), y + 1, 2, 1, 'rgba(255,255,255,' + (0.5 * (1 - i / 40)).toFixed(2) + ')');
        P(Math.min(X(0), X(9)), y + 1, 10, 2, body); P(Math.min(X(-1), X(1)), y - 1, 2, 2, body); P(Math.min(X(3), X(6)), y + 2, 4, 1, U.shade(body, -0.2));
        if (!night) P(Math.min(X(2), X(7)), y + 1, 6, 1, '#6080b0');
        if (night) { if (blink) P(X(4), y + 3, 1, 1, f > 0 ? '#ff3030' : '#30ff60'); if (Math.floor(time * 3) % 3 === 0) P(X(9), y + 1, 1, 1, '#ffffff'); }
      } else {
        const y = o.y + Math.sin(time * 2 + o.bob) * 1.5, body = night ? '#2a2a38' : '#c03030';
        P(Math.min(X(0), X(5)), y, 6, 3, body); P(Math.min(X(4), X(5)), y + 1, 2, 1, night ? '#fff6b0' : '#a0d0f0');
        P(Math.min(X(-5), X(-1)), y + 1, 5, 1, body); P(X(-6), y - 1 + (Math.floor(time * 20) % 2), 1, 2, '#606060');
        const rl = Math.floor(time * 18) % 2 ? 11 : 4; P(X(2) - rl / 2, y - 2, rl, 1, '#404040'); P(X(2), y - 1, 1, 1, '#404040');
        P(Math.min(X(0), X(6)), y + 4, 7, 1, '#404040');
        if (night && blink) P(X(-5), y, 1, 1, '#ff3030');
      }
    }
    skyObjs = skyObjs.filter(o => o.type === 'star' ? o.t < 0.7 : o.x > -60 && o.x < W + 60);
  }
  function newCloud(x) { return { x, y: U.rand(0.05, 0.4), w: U.irand(26, 60), s: U.rand(0.6, 1.4) }; }
  function drawSky(h) {
    const [top, bot] = skyNow, gy = -cam.y, W = cam.w;
    for (let y = 0; y < Math.min(cam.h, gy + 6); y += 3) { ctx.fillStyle = U.mix(top, bot, U.clamp(y / gy, 0, 1)); ctx.fillRect(0, y, W, 3); }
    const w = S().weather.type, dk = darkness(h, true);
    const clear = w === 'sunny' || w === 'heatwave' || w === 'cloudy';
    if (dk > 0.25 && clear) for (const s of stars) {
      const tw = (Math.sin(time * 2 + s.p * 40) + 1) / 2;
      ctx.fillStyle = 'rgba(255,255,230,' + (dk * (0.4 + tw * 0.6)).toFixed(2) + ')';
      ctx.fillRect(Math.round(s.x * W), Math.round(s.y * gy), 1, 1);
    }
    const sunR = Math.max(5, Math.round(gy * 0.035));
    g = ctx;
    if (clear) {
      if (h >= 6 && h <= 20) {
        const k = (h - 6) / 14, x = Math.round(W * (0.06 + k * 0.88)), y = Math.round(gy * 0.75 - Math.sin(Math.PI * k) * gy * 0.62);
        const big = w === 'heatwave' ? 3 : 0;
        disc(x, y, sunR + 5 + big, 'rgba(255,230,150,0.22)'); disc(x, y, sunR + big, h < 8 || h > 18 ? '#ffb060' : '#fff1a0');
      } else {
        const k = (h >= 20 ? h - 20 : h + 4) / 10, x = Math.round(W * (0.06 + k * 0.88)), y = Math.round(gy * 0.7 - Math.sin(Math.PI * k) * gy * 0.55);
        disc(x, y, sunR, '#f0f0dc'); disc(x + Math.round(sunR / 2), y - 1, sunR - 1, U.mix(top, bot, U.clamp(y / gy, 0, 1)));
      }
    }
    g = sx;
    drawSkyTraffic(h, gy, dk, clear);
    const want = { sunny: 3, heatwave: 1, cloudy: 9, rain: 11, storm: 13, snow: 9, fog: 6 }[w] || 4;
    while (clouds.length < want) clouds.push(newCloud(-0.3 - Math.random()));
    const wind = w === 'storm' ? 0.03 : 0.008;
    const ccol = w === 'storm' ? '#4a4e58' : (w === 'rain' || w === 'snow') ? '#8a909a' : '#f4f4f4';
    const cc = U.mix(ccol, '#1a1e38', dk * 0.85);
    for (const c of clouds) {
      c.x += c.s * wind * dt;
      const x = Math.round(c.x * W), y = Math.round(c.y * gy), cw = c.w;
      ctx.fillStyle = U.shade(cc, -0.12); ctx.fillRect(x + 2, y + 9, cw - 4, 2);
      ctx.fillStyle = cc;
      ctx.fillRect(x, y + 4, cw, 6); ctx.fillRect(x + 4, y + 1, cw - 12, 4); ctx.fillRect(x + Math.round(cw * 0.3), y - 3, Math.round(cw * 0.35), 5); ctx.fillRect(x + Math.round(cw * 0.6), y - 1, Math.round(cw * 0.2), 3);
    }
    clouds = clouds.filter(c => c.x < 1.15);
  }
  function drawSkyline(h) {
    const [, bot] = skyNow, dk = darkness(h, true);
    const far = U.mix(bot, '#283050', 0.5), far2 = U.mix(bot, '#283050', 0.35);
    for (const b of skyline) {
      if (b.x + b.w < cam.x || b.x > cam.x + cam.w) continue;
      ctx.fillStyle = b.roof === 0 ? far2 : far; ctx.fillRect(b.x, -b.h, b.w, b.h);
      if (b.roof === 1) ctx.fillRect(b.x + b.w / 2 - 1, -b.h - 10, 2, 10);
      if (b.roof === 2) ctx.fillRect(b.x + 4, -b.h - 4, b.w - 8, 4);
      if (dk > 0.3 && !S().blackout) {
        const r = srng(b.seed);
        for (let yy = -b.h + 5; yy < -6; yy += 7) for (let xx = b.x + 3; xx < b.x + b.w - 3; xx += 5) {
          const v = r();
          if (v < 0.25) { ctx.fillStyle = v < 0.08 ? '#f8e8a0' : '#c8b070'; ctx.fillRect(xx, yy, 2, 3); }
        }
      }
    }
  }

  // ---------- people ----------
  // Draws a person facing right (face = 1) or left (-1). x is the left edge, fy the floor line under the feet.
  function person(c, x, fy, m, o = {}) {
    x = Math.round(x); fy = Math.round(fy);
    const flip = (o.face || 1) < 0, fr = o.frame || 0;
    const H = m.age < 3 ? 9 : m.age < 13 ? 12 : 18, Wd = 8, top = fy - H;
    const P = (a, b, w, h, col) => { c.fillStyle = col; c.fillRect(x + (flip ? Wd - a - w : a), top + b, w, h); };
    const skinD = U.shade(m.skin, -0.2), hair = m.hair, hairD = U.shade(hair, -0.25), shoes = m.shoes || '#2a1a14';
    const dl = fr === 1 ? -1 : fr === 3 ? 1 : 0, dr = -dl;
    if (m.age < 3) {
      P(1, 1, 5, 4, m.skin); P(1, 0, 5, 1, hair); P(3, 2, 1, 1, '#1a1a1a'); P(5, 2, 1, 1, '#1a1a1a'); P(4, 3, 1, 1, '#e07070');
      P(1, 5, 5, 3, m.shirt); P(0, 5, 1, 2, m.shirt); P(6, 5, 1, 2, m.shirt);
      P(1 + (fr % 2), 8, 2, 1, m.skin); P(4 - (fr % 2), 8, 2, 1, m.skin);
      return;
    }
    if (m.age < 13) {
      if (festNow === 'carnival') { P(1, -1, 6, 1, ['#e04080', '#40c0e0', '#f0d040', '#60d060'][m.skin.charCodeAt(2) % 4]); }
      P(2, 1, 4, 4, m.skin); P(2, 0, 4, 2, hair); P(1, 1, 1, 2, hair);
      if (m.style === 'long' || m.style === 'ponytail' || m.style === 'bun') P(1, 1, 1, 4, hair);
      P(4, 2, 1, 1, '#1a1a1a'); P(5, 2, 1, 1, '#1a1a1a'); P(5, 4, 1, 1, skinD);
      if (festNow === 'carnival') { P(2, 2, 5, 1, ['#202020', '#c02020', '#2040c0'][m.hair.charCodeAt(3) % 3]); P(4, 2, 1, 1, '#f0f0f0'); P(6, 2, 1, 1, '#f0f0f0'); }
      if (m.dress) { P(2, 5, 4, 5, m.shirt); P(2, 9, 4, 1, U.shade(m.shirt, -0.2)); P(2 + dl, 10, 2, 1, m.skin); P(4 + dr, 10, 2, 1, m.skin); }
      else { P(2, 5, 4, 3, m.shirt); P(2 + dl, 8, 2, 3, m.pants); P(4 + dr, 8, 2, 3, m.pants); }
      P(1, 5, 1, 3, m.shirt); P(6, 5, 1, 3, m.shirt); P(1, 8, 1, 1, m.skin); P(6, 8, 1, 1, m.skin);
      P(2 + dl, 11, 2, 1, shoes); P(4 + dr, 11, 2, 1, shoes);
      return;
    }
    // Long hair falls behind the shoulders.
    if (m.style === 'long') P(1, 1, 6, 7, hairD);
    // Legs, skirt and shoes.
    if (o.sit) {
      P(1, 12, 7, 2, m.dress ? m.shirt : m.pants); P(6, 14, 2, 3, m.dress ? m.skin : m.pants); P(6, 17, 3, 1, shoes);
    } else if (m.dress) {
      P(1, 11, 6, 4, m.shirt); P(1, 14, 6, 1, U.shade(m.shirt, -0.2));
      P(2 + dl, 15, 2, 2, m.skin); P(4 + dr, 15, 2, 2, m.skin);
      P(2 + dl, 17, 2, 1, shoes); P(4 + dr, 17, 3, 1, shoes);
    } else {
      P(2 + dl, 12, 2, 5, m.pants); P(4 + dr, 12, 2, 5, U.shade(m.pants, -0.12));
      P(2 + dl, 17, 2, 1, shoes); P(4 + dr, 17, 3, 1, shoes);
    }
    // Torso and arms.
    P(1, 7, 6, 4, m.shirt);
    if (!m.dress && !o.sit) P(1, 11, 6, 1, U.shade(m.pants, -0.3));
    P(1, 7, 6, 1, U.shade(m.shirt, 0.15)); P(3, 7, 2, 1, U.shade(m.shirt, 0.35));
    if (o.vest) { P(1, 7, 6, 4, '#f08020'); P(1, 9, 6, 1, '#f0f060'); }
    if (o.apron) P(2, 8, 4, 6, '#f4f4f0');
    const swing = fr === 1 ? -1 : fr === 3 ? 1 : 0;
    if (o.wave) { P(7, 3, 1, 4, m.shirt); P(7, 2, 1, 1, m.skin); }
    else { P(7, 7, 1, 4, U.shade(m.shirt, -0.1)); P(7, 11 + swing, 1, 1, m.skin); }
    P(0, 7, 1, 4, U.shade(m.shirt, -0.1)); P(0, 11 - swing, 1, 1, m.skin);
    if (o.carry) { P(5, 8, 5, 5, o.carry); P(5, 8, 5, 1, U.shade(o.carry, 0.2)); }
    // Head and face.
    P(3, 6, 2, 1, skinD);
    P(2, 1, 4, 5, m.skin); P(2, 5, 4, 1, skinD);
    P(3, 3, 1, 1, '#1a1a1a'); P(5, 3, 1, 1, '#1a1a1a');
    P(4, 4, 2, 1, U.shade(m.skin, -0.08));
    P(5, 5, 1, 1, o.talk && Math.floor(time * 8) % 2 ? '#7a2a2a' : skinD);
    if (m.beard) { P(2, 4, 4, 2, hair); P(5, 5, 1, 1, '#7a3a3a'); }
    if (m.glasses) { P(2, 3, 5, 1, '#202020'); P(3, 3, 1, 1, '#c8e8ff'); P(5, 3, 1, 1, '#c8e8ff'); }
    // Hair styles.
    const st = m.style || 'short';
    if (st === 'bald') { P(2, 1, 1, 3, hair); P(3, 1, 3, 1, U.shade(m.skin, 0.1)); }
    else if (st === 'curly') { P(1, -1, 6, 3, hair); P(1, 2, 2, 2, hair); P(2, -1, 1, 1, hairD); P(5, 0, 1, 1, hairD); P(3, 1, 1, 1, hairD); }
    else {
      P(2, 0, 4, 1, hair); P(1, 1, 6, 1, hair); P(1, 2, 2, 1, hair);
      if (st === 'long') { P(1, 2, 1, 6, hair); P(2, 3, 1, 2, hair); }
      if (st === 'bun') { P(2, -2, 3, 2, hair); P(3, -2, 1, 1, hairD); }
      if (st === 'ponytail') { P(0, 2, 1, 5, hair); P(1, 2, 1, 1, hairD); }
    }
    if (o.hat) { P(1, -1, 6, 2, o.hat); P(0, 1, 8, 1, U.shade(o.hat, -0.2)); }
    if (m.age >= 75 && !o.sit) P(8, 9, 1, 9, '#6a4a2a');
    if (o.umbrella) { P(-3, -6, 14, 1, o.umbrella); P(-1, -7, 10, 1, o.umbrella); P(1, -8, 6, 1, o.umbrella); P(4, -5, 1, 13, '#333333'); }
  }
  function pet(x, fy, kind, frame, face) {
    x = Math.round(x);
    const flip = face < 0, Wd = 12;
    const P = (a, b, w, h, col) => { g.fillStyle = col; g.fillRect(x + (flip ? Wd - a - w : a), fy - 9 + b, w, h); };
    if (kind === 'dog') {
      const c1 = '#b07a44', c2 = '#7a4a24';
      P(2, 3, 8, 4, c1); P(2, 6, 8, 1, c2); P(8, 0, 4, 4, c1); P(8, 0, 1, 3, c2); P(10, 1, 1, 1, '#111111'); P(11, 2, 1, 1, '#111111'); P(9, 3, 2, 1, '#e07070');
      P(0, frame ? 1 : 2, 2, 1, c1);
      P(3, 7, 1, 2, c2); P(8, 7, 1, 2, c2); P(frame ? 4 : 5, 7, 1, 2, c1); P(frame ? 7 : 6, 7, 1, 2, c1);
    } else {
      const c1 = '#5a5a64', c2 = '#3a3a44';
      P(2, 4, 6, 3, c1); P(7, 1, 4, 4, c1); P(7, 0, 1, 1, c1); P(10, 0, 1, 1, c1); P(8, 2, 1, 1, '#a0f070'); P(10, 2, 1, 1, '#a0f070');
      P(0, frame ? 1 : 2, 1, 4, c2); P(1, 5, 1, 1, c2);
      P(3, 7, 1, 2, c2); P(6, 7, 1, 2, c2);
    }
  }

  // ---------- furniture ----------
  const F = {
    bed(x, fy, blanket, w = 30, pillows = 2) {
      R(x, fy - 15, 3, 15, C.woodDk); R(x + 1, fy - 14, 1, 11, C.wood);
      R(x + w - 2, fy - 9, 2, 9, C.woodDk);
      R(x + 3, fy - 5, w - 5, 2, C.wood); R(x + 3, fy - 3, 1, 3, C.woodDk); R(x + w - 3, fy - 3, 1, 3, C.woodDk);
      R(x + 3, fy - 8, w - 5, 3, '#f4f0e6');
      R(x + 10, fy - 9, w - 12, 5, blanket); R(x + 10, fy - 9, w - 12, 1, U.shade(blanket, 0.25)); R(x + 10, fy - 5, w - 12, 1, U.shade(blanket, -0.2));
      for (let i = x + 12; i < x + w - 3; i += 4) R(i, fy - 7, 1, 1, U.shade(blanket, 0.3));
      R(x + 3, fy - 11, 6, 3, '#ffffff'); R(x + 3, fy - 9, 6, 1, '#d8d8e0');
      if (pillows > 1) { R(x + 4, fy - 12, 5, 1, '#f0f0f8'); }
    },
    crib(x, fy) { R(x, fy - 12, 14, 1, C.woodLt); R(x, fy - 3, 14, 1, C.woodLt); for (let i = 0; i < 14; i += 2) R(x + i, fy - 12, 1, 10, C.woodLt); R(x, fy - 2, 1, 2, C.woodLt); R(x + 13, fy - 2, 1, 2, C.woodLt); R(x + 2, fy - 5, 10, 2, '#a0c8f0'); },
    mattress(x, fy) { R(x, fy - 4, 22, 4, '#c8c0b0'); R(x, fy - 4, 22, 1, '#d8d0c0'); R(x + 1, fy - 6, 5, 2, '#e8e4d8'); R(x + 7, fy - 5, 13, 2, '#7a8a6a'); R(x + 9, fy - 6, 6, 1, '#7a8a6a'); },
    sofa(x, fy, col, w = 30) {
      R(x + 2, fy - 14, w - 4, 8, U.shade(col, -0.12)); R(x + 2, fy - 14, w - 4, 1, U.shade(col, 0.15)); R(x + Math.floor(w / 2), fy - 13, 1, 6, U.shade(col, -0.25));
      R(x, fy - 7, w, 4, col); R(x, fy - 7, w, 1, U.shade(col, 0.2)); R(x + Math.floor(w / 2), fy - 7, 1, 4, U.shade(col, -0.2));
      R(x, fy - 11, 3, 8, U.shade(col, -0.3)); R(x + w - 3, fy - 11, 3, 8, U.shade(col, -0.3)); R(x, fy - 11, 3, 1, U.shade(col, -0.1)); R(x + w - 3, fy - 11, 3, 1, U.shade(col, -0.1));
      R(x, fy - 3, w, 1, U.shade(col, -0.4)); R(x + 2, fy - 2, 1, 2, C.woodDk); R(x + w - 3, fy - 2, 1, 2, C.woodDk);
      R(x + 4, fy - 12, 5, 4, U.shade(col, 0.3)); R(x + 4, fy - 12, 5, 1, U.shade(col, 0.45));
    },
    armchair(x, fy, col) { R(x + 2, fy - 15, 10, 9, U.shade(col, -0.12)); R(x + 2, fy - 15, 10, 1, U.shade(col, 0.15)); R(x, fy - 7, 14, 4, col); R(x, fy - 11, 3, 8, U.shade(col, -0.3)); R(x + 11, fy - 11, 3, 8, U.shade(col, -0.3)); R(x + 1, fy - 3, 1, 3, C.woodDk); R(x + 12, fy - 3, 1, 3, C.woodDk); },
    table(x, fy, w = 20, cloth) {
      R(x, fy - 10, w, 2, C.wood); R(x + 1, fy - 8, 2, 8, C.woodDk); R(x + w - 3, fy - 8, 2, 8, C.woodDk);
      if (cloth) { R(x - 1, fy - 11, w + 2, 2, cloth); R(x - 1, fy - 9, 1, 3, cloth); R(x + w, fy - 9, 1, 3, cloth); for (let i = x; i < x + w; i += 3) R(i, fy - 11, 1, 1, U.shade(cloth, 0.4)); }
      R(x + Math.floor(w / 2) - 1, fy - 14, 3, 3, '#d0e8f0'); R(x + Math.floor(w / 2), fy - 17, 1, 3, '#3a8a3a'); R(x + Math.floor(w / 2) - 1, fy - 18, 3, 1, '#f04060');
    },
    chair(x, fy, face) { const bx = face > 0 ? x : x + 6; R(bx, fy - 17, 2, 17, C.woodDk); R(bx, fy - 17, 2, 1, C.woodLt); R(x, fy - 8, 8, 2, C.wood); R(x + 1, fy - 6, 1, 6, C.woodDk); R(x + 6, fy - 6, 1, 6, C.woodDk); },
    stool(x, fy, col) { R(x, fy - 8, 7, 2, col || '#c03030'); R(x + 3, fy - 6, 1, 6, '#808080'); R(x + 1, fy - 1, 5, 1, '#808080'); },
    tv(x, fy, on, big) {
      const cw = big ? 26 : 20, tw = big ? 24 : 16, th = big ? 15 : 11;
      R(x, fy - 10, cw, 10, C.woodDk); R(x + 1, fy - 9, cw / 2 - 1, 8, C.wood); R(x + cw / 2 + 1, fy - 9, cw / 2 - 2, 8, C.wood); R(x + cw / 2 - 2, fy - 6, 1, 1, '#d0b080'); R(x + cw / 2 + 2, fy - 6, 1, 1, '#d0b080');
      const tx = x + Math.floor((cw - tw) / 2), ty = fy - 11 - th;
      R(tx + tw / 2 - 2, fy - 11, 4, 1, '#222222'); R(tx, ty, tw, th, '#161616');
      if (on) {
        const k = Math.floor(time * 1.5) % 4;
        R(tx + 1, ty + 1, tw - 2, th - 2, ['#7ab8ff', '#f0a060', '#80d080', '#c080f0'][k]);
        R(tx + 1, ty + th - 4, tw - 2, 3, ['#4a9a4a', '#a05030', '#3a7a3a', '#6040a0'][k]);
        R(tx + 3 + Math.floor(time * 6) % (tw - 6), ty + th - 7, 2, 4, '#f0f0f0');
      } else { R(tx + 1, ty + 1, tw - 2, th - 2, '#2a3440'); R(tx + 2, ty + 2, 3, 1, '#4a5868'); }
    },
    shelf(x, fy, r, w = 14, h = 30) {
      R(x, fy - h, w, h, C.woodDk); R(x + 1, fy - h + 1, w - 2, h - 2, U.shade(C.woodDk, -0.25));
      for (let sy = fy - h + 8; sy < fy; sy += 8) {
        R(x + 1, sy, w - 2, 1, C.wood);
        let bx = x + 1;
        while (bx < x + w - 2) { const bw = r() < 0.7 ? 1 : 2, bh = 4 + Math.floor(r() * 3); if (r() < 0.85) R(bx, sy - bh, bw, bh, ['#c04040', '#4060b0', '#40905a', '#d0b040', '#806040', '#e0e0d0', '#8040a0'][Math.floor(r() * 7)]); bx += bw; }
      }
    },
    nightstand(x, fy, on) { R(x, fy - 8, 7, 8, C.wood); R(x + 1, fy - 6, 5, 1, C.woodDk); R(x + 3, fy - 4, 1, 1, '#d0b080'); R(x + 2, fy - 10, 3, 2, '#606060'); R(x + 1, fy - 13, 5, 3, on ? '#ffe9a0' : '#e8d8b0'); },
    wardrobe(x, fy, w = 16) { R(x, fy - 34, w, 34, C.wood); R(x, fy - 34, w, 2, C.woodDk); R(x + w / 2, fy - 32, 1, 30, C.woodDk); R(x + w / 2 - 2, fy - 18, 1, 3, '#d0b080'); R(x + w / 2 + 2, fy - 18, 1, 3, '#d0b080'); R(x + 1, fy - 2, w - 2, 2, C.woodDk); },
    fridge(x, fy) {
      R(x, fy - 30, 12, 30, '#eef2f4'); R(x + 11, fy - 30, 1, 30, '#c8d0d4'); R(x, fy - 20, 12, 1, '#b0b8bc');
      R(x + 9, fy - 27, 1, 4, '#808890'); R(x + 9, fy - 17, 1, 6, '#808890');
      R(x + 2, fy - 15, 2, 2, '#f04040'); R(x + 5, fy - 13, 2, 2, '#40a0f0'); R(x + 3, fy - 10, 3, 3, '#f0f0a0');
    },
    kitchen(x, fy, w, opts = {}) {
      const cab = opts.cab || '#d8c8a8', top = opts.marble ? '#e8e4e0' : '#9a8a78', tile = '#e8eef0';
      R(x, fy - 30, w, 15, tile);
      for (let ty = fy - 30; ty < fy - 15; ty += 3) for (let tx = x + ((ty / 3) % 2 ? 0 : 1); tx < x + w; tx += 3) R(tx, ty, 1, 1, U.shade(tile, -0.08));
      R(x, fy - 45, w, 12, cab); R(x, fy - 33, w, 1, U.shade(cab, -0.3));
      for (let i = x; i < x + w; i += 8) { R(i, fy - 45, 1, 12, U.shade(cab, -0.2)); R(i + 6, fy - 37, 1, 2, '#808080'); }
      R(x, fy - 14, w, 14, cab); R(x - 1, fy - 15, w + 2, 2, top);
      for (let i = x; i < x + w; i += 8) { R(i, fy - 13, 1, 13, U.shade(cab, -0.2)); R(i + 2, fy - 11, 2, 1, '#808080'); }
      R(x + 3, fy - 15, 8, 1, '#c0c8d0'); R(x + 6, fy - 19, 1, 4, '#a0a8b0'); R(x + 6, fy - 19, 3, 1, '#a0a8b0');
      const hx = x + w - 12;
      R(hx, fy - 16, 10, 1, '#303030'); R(hx + 1, fy - 17, 3, 1, opts.cooking ? '#ff6020' : '#505050'); R(hx + 6, fy - 17, 3, 1, '#505050');
      if (opts.cooking) { R(hx, fy - 21, 5, 4, '#808890'); R(hx - 1, fy - 21, 7, 1, '#a0a8b0'); if (Math.random() < 0.08) parts.push({ x: hx + 2, y: fy - 22, vx: U.rand(-1, 1), vy: -6, life: 1.4, col: 'rgba(240,240,240,0.6)', size: 1 }); }
      R(hx - 1, fy - 33, 12, 3, '#808890'); R(hx + 1, fy - 32, 8, 1, '#a0a8b0');
    },
    plant(x, fy, big, col) {
      const lc = col || '#3a8a3a', ll = U.shade(lc, 0.3), ld = U.shade(lc, -0.25);
      if (big) {
        R(x + 2, fy - 7, 8, 7, '#b05a30'); R(x + 1, fy - 8, 10, 2, '#c8703a');
        R(x + 5, fy - 20, 1, 12, ld);
        for (const [dx, dy] of [[-1, -22], [5, -24], [0, -15], [7, -17], [2, -12], [7, -11]]) { R(x + dx, fy + dy, 6, 4, lc); R(x + dx + 1, fy + dy, 3, 1, ll); }
      } else {
        R(x + 2, fy - 5, 6, 5, '#b05a30'); R(x + 1, fy - 6, 8, 1, '#c8703a');
        R(x + 1, fy - 12, 8, 6, lc); R(x + 3, fy - 14, 3, 2, lc); R(x + 2, fy - 11, 2, 2, ll); R(x + 6, fy - 9, 2, 2, ld);
      }
    },
    flowers(x, fy) { R(x + 1, fy - 5, 6, 5, '#e0e0f0'); for (let i = 0; i < 4; i++) { R(x + 1 + i * 2, fy - 10, 1, 5, '#3a8a3a'); R(x + i * 2, fy - 12, 3, 2, ['#f04060', '#f0e040', '#ffffff', '#c060f0'][i]); } },
    lamp(x, fy, on, col) { R(x + 1, fy - 1, 5, 1, '#404040'); R(x + 3, fy - 19, 1, 18, '#404040'); R(x, fy - 24, 7, 5, on ? '#ffe9a0' : (col || '#e0d0a0')); R(x + 1, fy - 25, 5, 1, on ? '#fff4c0' : (col || '#e0d0a0')); },
    ceilingLamp(cx, ry, on) { R(cx, ry, 1, 6, '#303030'); R(cx - 4, ry + 6, 9, 3, '#d8d0c0'); R(cx - 3, ry + 9, 7, 1, on ? '#fff6b0' : '#c8c8b0'); },
    bulb(cx, ry, on) { R(cx, ry, 1, 9, '#303030'); R(cx - 1, ry + 9, 3, 3, on ? '#fff6b0' : '#c8c8b0'); },
    chandelier(cx, ry, on) {
      R(cx, ry, 1, 4, '#806020'); R(cx - 7, ry + 6, 15, 1, '#d0a030'); R(cx - 4, ry + 4, 9, 2, '#d0a030'); R(cx - 1, ry + 7, 3, 3, '#d0a030');
      for (const d of [-7, -4, 0, 4, 7]) { R(cx + d, ry + 4, 1, 2, '#f0f0f0'); R(cx + d, ry + 3, 1, 1, on ? '#fff8c0' : '#e0d8b0'); R(cx + d, ry + 8, 1, 2, '#c8e8ff'); }
    },
    painting(x, y, r, w = 14, h = 10) {
      R(x, y, w, h, '#c8a040'); R(x, y, w, 1, '#e8c060');
      const v = Math.floor(r() * 3);
      if (v === 0) { R(x + 1, y + 1, w - 2, h - 4, '#80b8e0'); R(x + 1, y + h - 4, w - 2, 3, '#5a9a4a'); disc(x + 4, y + 3, 1, '#f8e060'); R(x + 7, y + h - 7, 4, 3, '#7a7a8a'); }
      else if (v === 1) { R(x + 1, y + 1, w - 2, h - 2, '#5a3a2a'); R(x + w / 2 - 2, y + 2, 4, 4, '#e0b090'); R(x + w / 2 - 3, y + 6, 6, h - 7, '#2a3a5a'); R(x + w / 2 - 2, y + 2, 4, 1, '#3a2a1a'); }
      else { R(x + 1, y + 1, w - 2, h - 2, '#f0e8d8'); R(x + 2, y + 2, 4, 4, '#e04040'); R(x + 6, y + 4, 5, 4, '#4060c0'); R(x + 4, y + 6, 3, 2, '#f0d040'); }
    },
    photo(x, y, col) { R(x, y, 6, 5, '#3a2a1a'); R(x + 1, y + 1, 4, 3, col); R(x + 2, y + 1, 2, 2, '#e8c0a0'); },
    clock(x, y) {
      disc(x + 3, y + 3, 3, '#3a2a1a'); disc(x + 3, y + 3, 2, '#f4f0e0');
      const h = hr(), a = (h % 12) / 12 * Math.PI * 2, b = (h % 1) * Math.PI * 2;
      R(x + 3 + Math.round(Math.sin(a)), y + 3 - Math.round(Math.cos(a)), 1, 1, '#000000'); R(x + 3 + Math.round(Math.sin(b) * 2), y + 3 - Math.round(Math.cos(b) * 2), 1, 1, '#a02020'); R(x + 3, y + 3, 1, 1, '#000000');
    },
    rug(x, fy, w, col) { R(x, fy, w, 2, col); for (let i = x + 1; i < x + w; i += 3) R(i, fy, 1, 1, U.shade(col, 0.3)); R(x - 1, fy + 1, 1, 1, '#e0d8c0'); R(x + w, fy + 1, 1, 1, '#e0d8c0'); },
    aquarium(x, fy) {
      R(x, fy - 8, 20, 8, C.woodDk); R(x + 1, fy - 7, 8, 6, C.wood); R(x + 11, fy - 7, 8, 6, C.wood);
      R(x, fy - 21, 20, 13, '#3a80c0'); R(x, fy - 21, 20, 1, '#202830'); R(x, fy - 10, 20, 2, '#c8b880');
      R(x + 3, fy - 14, 1, 4, '#3a9a3a'); R(x + 4, fy - 16, 1, 6, '#3a9a3a'); R(x + 15, fy - 15, 1, 5, '#3a9a3a');
      R(x + 2 + Math.floor((time * 4) % 15), fy - 16, 3, 2, '#ff8030'); R(x + 16 - Math.floor((time * 3) % 13), fy - 13, 2, 1, '#f0e040'); R(x + 2 + Math.floor((time * 2.3) % 16), fy - 18, 2, 1, '#f060c0');
      R(x + 17, fy - 12 - Math.floor((time * 6) % 8), 1, 1, '#c8f0ff');
    },
    piano(x, fy) { R(x, fy - 20, 20, 20, '#1a1414'); R(x, fy - 20, 20, 1, '#3a3030'); R(x + 1, fy - 11, 18, 2, '#f0f0f0'); for (let i = x + 2; i < x + 19; i += 3) R(i, fy - 11, 1, 1, '#1a1414'); R(x + 5, fy - 18, 8, 5, '#f0f0e0'); R(x - 1, fy - 12, 1, 12, '#1a1414'); R(x + 20, fy - 12, 1, 12, '#1a1414'); },
    desk(x, fy, on) {
      R(x, fy - 11, 22, 2, '#3a3a40'); R(x + 1, fy - 9, 2, 9, '#3a3a40'); R(x + 19, fy - 9, 2, 9, '#3a3a40');
      R(x + 5, fy - 22, 13, 9, '#1a1a1a'); R(x + 6, fy - 21, 11, 7, on ? ['#50f0a0', '#f050c0', '#50a0f0'][Math.floor(time * 2) % 3] : '#222222'); R(x + 10, fy - 13, 3, 2, '#1a1a1a');
      R(x + 4, fy - 12, 10, 1, '#606060'); R(x + 16, fy - 13, 2, 1, '#909090');
      R(x + 22, fy - 14, 6, 14, '#202024'); if (on) R(x + 23, fy - 12, 1, 10, ['#ff4080', '#40ffa0', '#40a0ff'][Math.floor(time * 3) % 3]);
    },
    workbench(x, fy) { R(x, fy - 10, 18, 2, C.wood); R(x + 1, fy - 8, 2, 8, C.woodDk); R(x + 15, fy - 8, 2, 8, C.woodDk); R(x, fy - 26, 18, 12, '#c8a878'); for (let i = 0; i < 4; i++) R(x + 2 + i * 4, fy - 24, 2, 7, ['#808080', '#c03030', '#3060c0', '#808080'][i]); R(x + 4, fy - 13, 5, 3, '#c03030'); },
    weights(x, fy) { R(x, fy - 2, 10, 2, '#e05080'); R(x + 1, fy - 5, 2, 3, '#303030'); R(x + 3, fy - 4, 4, 1, '#808080'); R(x + 7, fy - 5, 2, 3, '#303030'); },
    toys(x, fy, r) { for (let i = 0; i < 4; i++) R(x + i * 4 + Math.floor(r() * 2), fy - 3 - (i === 2 ? 3 : 0), 3, 3, ['#e04040', '#40a0e0', '#f0d040', '#40c060'][i]); disc(x + 20, fy - 3, 2, '#f08030'); R(x + 24, fy - 7, 5, 7, '#a06a3a'); R(x + 25, fy - 9, 3, 2, '#a06a3a'); R(x + 25, fy - 8, 1, 1, '#111111'); },
    radio(x, fy) { R(x, fy - 6, 9, 6, '#8a5a3a'); R(x + 1, fy - 5, 4, 4, '#d8c8a0'); R(x + 6, fy - 4, 2, 2, '#3a2a1a'); R(x + 7, fy - 10, 1, 4, '#808080'); },
    crates(x, fy, n) { for (let i = 0; i < n; i++) { const cx = x + (i % 3) * 10, cy = fy - 9 - Math.floor(i / 3) * 9; R(cx, cy, 9, 9, '#a07040'); R(cx, cy, 9, 1, '#c09060'); R(cx, cy + 4, 9, 1, '#7a5030'); R(cx + 4, cy, 1, 9, '#7a5030'); } },
    grow(x, ry, fy) { R(x, ry + 6, 34, 2, '#504060'); R(x + 1, ry + 8, 32, 1, '#e080ff'); g.fillStyle = 'rgba(200,90,255,0.18)'; g.fillRect(x - 3, ry + 9, 40, fy - ry - 9); for (let i = 0; i < 5; i++) { R(x + 1 + i * 7, fy - 5, 5, 5, '#7a5a3a'); R(x + i * 7, fy - 16, 7, 11, '#3a9a3a'); R(x + 2 + i * 7, fy - 19, 2, 3, '#3a9a3a'); R(x + 1 + i * 7, fy - 13, 2, 2, '#5ac05a'); } },
    screens(x, fy) { R(x, fy - 11, 34, 2, '#3a3a40'); R(x + 1, fy - 9, 2, 9, '#3a3a40'); R(x + 31, fy - 9, 2, 9, '#3a3a40'); for (let i = 0; i < 3; i++) { R(x + 1 + i * 11, fy - 21, 10, 9, '#101010'); R(x + 2 + i * 11, fy - 20, 8, 7, i === 1 ? '#103010' : '#301010'); for (let k = 0; k < 3; k++) R(x + 3 + i * 11, fy - 19 + k * 2, 2 + Math.floor((time * 3 + k + i) % 5), 1, i === 1 ? '#40e060' : '#e04040'); } },
    bags(x, fy) { R(x, fy - 26, 1, 26, '#505050'); R(x + 30, fy - 26, 1, 26, '#505050'); R(x, fy - 26, 31, 1, '#505050'); R(x, fy - 13, 31, 1, '#505050'); const cs = ['#c08040', '#e0c060', '#a03040', '#303030', '#e0a0c0', '#4060a0']; for (let i = 0; i < 6; i++) { R(x + 2 + i * 5, fy - 23, 4, 6, cs[i]); R(x + 3 + i * 5, fy - 25, 2, 2, cs[(i + 2) % 6]); R(x + 2 + i * 5, fy - 10, 4, 6, cs[(i + 3) % 6]); R(x + 3 + i * 5, fy - 12, 2, 2, cs[i]); } },
    tyres(x, fy) { for (let s = 0; s < 3; s++) for (let i = 0; i < 3 + (s % 2); i++) { R(x + s * 11, fy - 3 - i * 3, 10, 3, '#202020'); R(x + 3 + s * 11, fy - 3 - i * 3, 4, 1, '#505050'); } },
    easel(x, fy) { R(x + 2, fy - 24, 1, 24, C.wood); R(x + 12, fy - 24, 1, 24, C.wood); R(x + 7, fy - 22, 1, 22, C.woodDk); R(x, fy - 26, 15, 15, '#f0e8d0'); R(x + 2, fy - 24, 11, 11, '#6a4a2a'); R(x + 5, fy - 22, 5, 4, '#e0b090'); R(x + 4, fy - 18, 7, 5, '#2a3a2a'); R(x + 5, fy - 22, 5, 1, '#3a2a1a'); },
    safe(x, fy) { R(x, fy - 12, 12, 12, '#606870'); R(x + 1, fy - 11, 10, 10, '#707a84'); disc(x + 6, fy - 6, 2, '#d0d0d0'); R(x + 6, fy - 6, 1, 1, '#404040'); },
    cork(x, y) { R(x, y, 24, 15, '#b08850'); R(x, y, 24, 1, '#806030'); R(x + 2, y + 2, 5, 4, '#f0f0e0'); R(x + 16, y + 2, 5, 5, '#f0f0e0'); R(x + 9, y + 8, 5, 4, '#f0f0e0'); R(x + 3, y + 10, 4, 3, '#e0d080'); g.fillStyle = '#d02020'; for (let i = 0; i < 10; i++) { g.fillRect(x + 6 + i, y + 4 + Math.floor(i / 3), 1, 1); g.fillRect(x + 12 + Math.floor(i / 2), y + 9 - i % 4, 1, 1); } },
    telescope(x, fy) { R(x + 4, fy - 10, 1, 10, '#404040'); R(x + 1, fy - 1, 7, 1, '#404040'); R(x + 1, fy - 10, 1, 9, '#404040'); R(x + 7, fy - 10, 1, 9, '#404040'); for (let i = 0; i < 10; i++) R(x + 1 + i, fy - 11 - i, 3, 3, '#c0c0c8'); },
    sleepbags(x, fy) { const cs = ['#3a6a8a', '#8a3a3a', '#5a7a3a']; for (let i = 0; i < 3; i++) { R(x + i * 20, fy - 3, 18, 3, cs[i]); R(x + i * 20, fy - 3, 18, 1, U.shade(cs[i], 0.25)); R(x + 1 + i * 20, fy - 4, 4, 2, '#e8e0d0'); } },
    candle(x, fy) { R(x, fy - 4, 2, 4, '#f0f0e0'); R(x, fy - 6 - (Math.random() < 0.3 ? 1 : 0), 2, 2, Math.random() < 0.5 ? '#ffb030' : '#ffe060'); },
    boxes(x, fy) { R(x, fy - 8, 12, 8, '#c09060'); R(x, fy - 8, 12, 1, '#d8a878'); R(x + 5, fy - 8, 2, 8, '#d8c0a0'); R(x + 13, fy - 6, 9, 6, '#b08050'); R(x + 3, fy - 14, 8, 6, '#c8a070'); },
    window(x, y, w, h, opts = {}) {
      R(x - 1, y - 1, w + 2, h + 2, '#5a3a2a'); R(x, y, w, h, U.mix(skyNow[0], skyNow[1], 0.4)); R(x, y + h - 6, w, 6, U.mix(skyNow[1], '#506070', 0.3));
      const wt = S().weather.type;
      if (['rain', 'storm'].includes(wt)) for (let i = 0; i < 6; i++) R(x + 2 + ((i * 5 + Math.floor(time * 9)) % (w - 3)), y + 1 + ((i * 7 + Math.floor(time * 25)) % (h - 3)), 1, 3, 'rgba(200,220,255,0.6)');
      if (wt === 'snow') for (let i = 0; i < 6; i++) R(x + 2 + ((i * 7 + Math.floor(time * 3)) % (w - 3)), y + 1 + ((i * 5 + Math.floor(time * 6)) % (h - 2)), 1, 1, '#ffffff');
      if (darkness(hr(), true) > 0.3 && wt !== 'storm') for (let i = 0; i < 3; i++) R(x + 3 + i * 7, y + 3 + (i % 2) * 4, 1, 1, '#ffffe0');
      R(x + Math.floor(w / 2), y, 1, h, '#5a3a2a'); R(x, y + Math.floor(h / 2), w, 1, '#5a3a2a');
      R(x + 2, y + 2, 1, 4, 'rgba(255,255,255,0.35)');
      R(x - 3, y + h + 1, w + 6, 2, '#e8e0d0');
      if (opts.closed) { R(x - 1, y - 1, w + 2, h + 2, opts.closed); for (let i = x; i < x + w; i += 3) R(i, y - 1, 1, h + 2, U.shade(opts.closed, -0.25)); return; }
      if (opts.curtain) { const cc = opts.curtain; R(x - 4, y - 3, 6, h + 5, cc); R(x + w - 2, y - 3, 6, h + 5, cc); R(x - 4, y - 3, w + 8, 2, U.shade(cc, -0.25)); R(x - 3, y - 1, 1, h + 3, U.shade(cc, -0.2)); R(x + w + 1, y - 1, 1, h + 3, U.shade(cc, -0.2)); }
      if (opts.boards) { R(x - 2, y + 4, w + 4, 4, '#a08050'); R(x - 2, y + 13, w + 4, 4, '#8a6a40'); }
    }
  };

  // ---------- who is where ----------
  const eventOn = () => { const e = S().event; return e && e.started && S().t < e.end ? e : null; };
  const atEvent = (m, e) => m.age >= 3 && hash(m.id + ':' + e.start) < (e.type === 'football' ? 0.45 : 0.75);
  function memberState(f, m, h, d, wd) {
    const ev = eventOn();
    if (ev && f.kind !== 'squatter' && atEvent(m, ev)) return 'event';
    const r = hash(m.id + ':' + d);
    if (festNow === 'ferragosto' && hash(f.seed + 'sea') < 0.55 && f.kind === 'normal') return 'away';
    if (f.party) return 'home';
    if (f.kind === 'mysterious' && !(f.secret && f.secret.revealed)) return (h >= 20 || h < 5) ? 'home' : 'sleep';
    const inR = (a, b) => a < b ? (h >= a && h < b) : (h >= a || h < b);
    let s0 = 23, s1 = 7;
    if (m.age < 13) { s0 = 21; s1 = 7; }
    if (f.habits.includes('owl') || f.kind === 'squatter') { s0 = 2; s1 = 10; }
    if (f.habits.includes('early')) { s0 = 21; s1 = 5; }
    const j = m.job || {};
    const weekday = wd >= 1 && wd <= 5;
    if (j.night && j.inc > 0 && !j.retired && weekday && f.kind !== 'mysterious') {
      if (h >= 21 || h < 5) return 'away';
      if (h >= 6 && h < 13) return 'sleep';
      return 'home';
    }
    if (inR(s0, s1)) return 'sleep';
    if (m.age < 3) return 'home';
    if (j.school && m.age >= 6 && weekday && inR(8, 14 + Math.floor(r * 2))) return 'away';
    if (!j.retired && !j.jobless && !j.school && j.inc > 0 && f.kind === 'normal' && weekday) {
      if (inR(8 + Math.floor(r * 2), 17 + Math.floor(hash(m.id) * 3))) return 'away';
    }
    const o = 9 + Math.floor(r * 10);
    if (r < 0.55 && inR(o, o + 2)) return 'away';
    return 'home';
  }
  function shopOpen(u, h) {
    if (!u.shop || u.work || u.burnt) return false;
    const d = DATA.shops[u.shop.type];
    if (SIM.dow() === 0 && !['cafe', 'pizzeria', 'gelateria', 'bakery', 'bnb'].includes(u.shop.type)) return false;
    if (festNow === 'ferragosto' && u.shop.type !== 'gelateria' && u.shop.type !== 'bnb' && hash(u.id + 'hol') < 0.7) return false;
    return h >= d.hours[0] && h < d.hours[1];
  }
  function unitLit(u, h) {
    if (u.fire) return true;
    if (u.work) return true;
    if (u.shop) return !S().blackout && shopOpen(u, h);
    const f = famOf(u);
    if (!f) return false;
    if (S().blackout) return f.kind === 'squatter';
    if (f.party) return true;
    return f.members.some(m => prevState[m.id] === 'home');
  }

  // Random look for party guests, customers and passers-by.
  function randomLook(m) {
    m.skin = U.pick(DATA.skins); m.hair = m.age > 62 ? '#d0d0d0' : U.pick(DATA.hairs); m.shirt = U.pick(DATA.shirts); m.pants = U.pick(DATA.pants);
    m.shoes = U.pick(['#2a1a14', '#3a3a40', '#f0f0f0']); m.style = U.pick(m.sex === 'f' ? ['long', 'bun', 'ponytail', 'curly'] : ['short', 'curly', 'bald', 'short']);
    m.beard = m.sex === 'm' && m.age >= 18 && U.chance(0.3); m.glasses = U.chance(0.2); m.dress = m.sex === 'f' && U.chance(0.35);
    return m;
  }
  const WORKER = { age: 35, sex: 'm', skin: '#e8b88f', hair: '#2b1d14', shirt: '#3a5a8a', pants: '#304060', shoes: '#3a2a1a', style: 'short' };

  // ---------- apartments ----------
  function drawApt(u, rx, ry, fy) {
    const f = famOf(u), h = hr();
    const pent = u.size === 'penthouse', lux = u.size === 'luxury' || pent, studio = u.size === 'studio';
    const wall = f ? f.wall : '#d8ccb0';
    R(rx, ry, AW, 53, wall);
    const r = srng(f ? f.seed : u.seed);
    const ls = f ? f.ls : 1, normal = f && f.kind === 'normal';
    // Wallpaper.
    if (lux || (normal && ls === 3)) { for (let x = rx + 2; x < rx + AW; x += 5) R(x, ry, 1, 53, U.shade(wall, -0.06)); R(rx, ry + 2, AW, 1, '#d0a840'); }
    else if (normal && ls === 2) { for (let y = ry + 4; y < fy - 14; y += 6) for (let x = rx + 2 + (y % 2) * 3; x < rx + AW; x += 7) R(x, y, 1, 1, U.shade(wall, -0.1)); }
    else if (normal && ls === 1) { R(rx, fy - 16, AW, 16, U.shade(wall, -0.07)); R(rx, fy - 17, AW, 1, U.shade(wall, -0.18)); }
    else if (f && ls === 0) { R(rx + 20, ry + 6, 8, 6, U.shade(wall, -0.06)); R(rx + 110, ry + 26, 7, 9, U.shade(wall, -0.06)); }
    R(rx, ry, AW, 1, U.shade(wall, -0.25));
    // Floor.
    const floorCol = lux ? '#e8e0d8' : (f && ls === 0) ? '#8a7a6a' : '#a87048';
    R(rx, fy, AW, 3, floorCol);
    if (lux) for (let x = rx; x < rx + AW; x += 8) { R(x, fy, 1, 3, '#c8c0b8'); R(x + 4, fy + 1, 1, 1, '#d0c8c0'); }
    else for (let x = rx + 7; x < rx + AW; x += 14) R(x, fy, 1, 3, U.shade(floorCol, -0.2));
    R(rx, fy, AW, 1, U.shade(floorCol, 0.15));
    R(rx, fy - 2, AW, 2, U.shade(wall, -0.3));
    const kindLook = f && f.kind === 'shady' ? f.secret.look : f && f.kind === 'mysterious' && !f.secret.revealed ? 'mystery' : f && f.kind === 'squatter' ? 'squat' : null;
    const win = { closed: kindLook === 'mystery' ? '#3a1a3a' : null, boards: kindLook === 'squat', curtain: f && !kindLook ? f.accent : null };
    if (pent) { F.window(rx + 56, ry + 5, 44, 26, win); F.window(rx + 8, ry + 5, 30, 18, win); }
    else { F.window(rx + 62, ry + 9, 26, 20, win); if (lux) F.window(rx + 14, ry + 9, 18, 14, win); }
    const sp = spots[u.id] = [];
    if (!f) {
      if (u.sealed) {
        for (let i = 0; i < AW; i += 3) R(rx + i, ry + 14 + Math.floor(i / 8), 3, 3, i % 12 < 6 ? '#f0d020' : '#202020');
        PIX.text(g, 'POLICE - DO NOT CROSS', rx + 34, ry + 38, '#a02020');
      } else {
        R(rx + 63, ry + 12, 24, 12, '#f8f4e8'); R(rx + 63, ry + 12, 24, 2, '#c03030'); PIX.text(g, 'RENT', rx + 68, ry + 16, '#c03030');
        F.boxes(rx + 112, fy); F.bulb(rx + 75, ry, false);
        if (lux) F.chandelier(rx + 40, ry, false);
        if (u.emptyDays > 20) { R(rx + 20, ry + 1, 1, 6, '#c8c8c8'); R(rx + 17, ry + 7, 7, 1, '#c8c8c8'); }
      }
      return;
    }
    const lit = unitLit(u, h), evening = h >= 18 && h < 23;
    if (!studio && !kindLook) { R(rx + 50, ry, 3, 30, U.shade(wall, -0.15)); R(rx + 50, ry + 30, 3, 1, U.shade(wall, -0.35)); R(rx + 49, ry + 30, 1, 23, U.shade(wall, -0.22)); R(rx + 53, ry + 30, 1, 23, U.shade(wall, -0.22)); }
    if (kindLook === 'squat') {
      F.sleepbags(rx + 4, fy);
      for (let i = 0; i < 8; i++) R(rx + 10 + Math.floor(r() * 130), ry + 6 + Math.floor(r() * 30), U.irand(5, 14), 2, ['#e04090', '#40c0e0', '#f0e040', '#40e060'][i % 4]);
      PIX.text(g, 'NO RENT', rx + 100, ry + 10, '#e04090');
      F.candle(rx + 70, fy); F.candle(rx + 90, fy); F.crates(rx + 118, fy, 2);
      for (let i = 0; i < 8; i++) R(rx + 64 + Math.floor(r() * 50), fy - 1, 2, 1, '#605040');
      sp.push({ x: rx + 70 }, { x: rx + 30 });
    } else {
      if (ls === 0 && !lux) F.mattress(rx + 4, fy);
      else if (studio) F.bed(rx + 3, fy, f.accent, 24, 1);
      else F.bed(rx + 3, fy, f.accent, 32, 2);
      if (!studio && !kindLook) { F.nightstand(rx + 38, fy, lit && h >= 21); F.painting(rx + 14, ry + 7, r, 16, 11); }
      if (lux) F.wardrobe(rx + 33, fy, 14);
      const cooking = lit && ((h >= 12 && h < 13.5) || (h >= 19 && h < 20.5));
      if (studio) { F.kitchen(rx + 114, fy, 22, { cooking }); F.fridge(rx + 137, fy); }
      else { F.kitchen(rx + 108, fy, 28, { cooking, marble: lux, cab: lux ? '#f0ece4' : ls >= 2 ? '#a8c0c8' : '#d8c8a8' }); F.fridge(rx + 137, fy); }
      sp.push({ x: rx + 120, face: 1 });
      F.clock(rx + 98, ry + 6);
      const look = kindLook && kindLook !== 'mystery' ? kindLook : null;
      if (look) {
        const x = rx + 58;
        ({ crates: () => F.crates(x, fy, 5), screens: () => F.screens(x, fy), bags: () => F.bags(x, fy), tyres: () => F.tyres(x, fy), grow: () => F.grow(x, ry, fy), easel: () => { F.easel(x, fy); F.easel(x + 18, fy); } })[look]();
        F.chair(rx + 96, fy, -1); sp.push({ x: rx + 96, sit: true, face: -1 });
      } else if (kindLook === 'mystery') {
        F.cork(rx + 56, ry + 6); F.safe(rx + 56, fy); F.telescope(rx + 70, fy); F.lamp(rx + 92, fy, lit, '#802040'); F.crates(rx + 30, fy, 1);
        F.armchair(rx + 80, fy, '#5a2a3a'); sp.push({ x: rx + 82, sit: true, face: -1 });
      } else if (studio) {
        F.rug(rx + 30, fy, 30, f.accent);
        F.table(rx + 36, fy, 16, ls >= 1 ? '#e8e0d0' : null); F.chair(rx + 28, fy, 1); F.chair(rx + 52, fy, -1);
        F.tv(rx + 88, fy, lit && evening);
        sp.push({ x: rx + 28, sit: true, face: 1 }, { x: rx + 52, sit: true, face: -1 });
      } else {
        const elder = f.members.some(m => m.age >= 65);
        const music = SIM.has(f, 'music'), gamer = SIM.has(f, 'gamer');
        if (ls <= 1 && !lux) {
          F.table(rx + 62, fy, 22, ls === 1 ? '#c8e0f0' : null); F.chair(rx + 54, fy, 1); F.chair(rx + 86, fy, -1);
          sp.push({ x: rx + 54, sit: true, face: 1 }, { x: rx + 86, sit: true, face: -1 });
        } else {
          F.rug(rx + 56, fy, 36, f.sofa);
          if (elder) { F.armchair(rx + 60, fy, f.sofa); F.radio(rx + 76, fy); sp.push({ x: rx + 62, sit: true, face: 1 }); }
          else { F.sofa(rx + 58, fy, f.sofa, 30); sp.push({ x: rx + 63, sit: true, face: 1 }, { x: rx + 75, sit: true, face: 1 }); }
          F.lamp(rx + 54, fy, lit && evening);
        }
        if (music) { F.piano(rx + 90, fy); F.stool(rx + 82, fy, '#3a2a2a'); sp.push({ x: rx + 81, sit: true, face: 1 }); }
        else if (gamer) { F.desk(rx + 78, fy, lit); F.stool(rx + 84, fy, '#c03030'); sp.push({ x: rx + 83, sit: true, face: 1 }); }
        else F.tv(rx + 88, fy, lit && (evening || (h >= 13 && h < 14)), ls >= 2);
        if (lux || ls === 3) { F.chandelier(rx + 75, ry, lit); if (!SIM.has(f, 'diy')) F.aquarium(rx + 18, fy); }
        else F.ceilingLamp(rx + 75, ry, lit);
        if (ls >= 2 && !lux) F.shelf(rx + 36, fy, r, 12, 28);
        if (SIM.has(f, 'garden')) F.plant(rx + 40, fy, true);
        if (SIM.has(f, 'diy')) F.workbench(rx + 18, fy);
        if (SIM.has(f, 'sporty')) F.weights(rx + 38, fy);
        if (f.members.some(m => m.age < 3)) F.crib(rx + 20, fy);
        else if (f.members.some(m => m.age < 12)) F.toys(rx + 56, fy, r);
        for (let i = 0; i < Math.min(3, f.members.length); i++) F.photo(rx + 56 + i * 8, ry + 6, f.members[i].shirt);
      }
    }
    drawResidents(u, f, rx, ry, fy, h);
    if (f.pet) {
      const p = people['pet' + f.id] = people['pet' + f.id] || { x: rx + 40, tx: rx + 40, wait: 0, face: 1 };
      const moving = walk(p, rx + 4, rx + 130, f.pet === 'dog' ? 10 : 7);
      pet(p.x, fy, f.pet, moving ? Math.floor(time * 6) % 2 : 0, p.face);
    }
    if (f.party) {
      for (let i = 0; i < 6; i++) { g.fillStyle = ['rgba(255,60,160,0.3)', 'rgba(60,200,255,0.3)', 'rgba(255,230,60,0.3)'][(i + Math.floor(time * 3)) % 3]; g.fillRect(rx + 8 + i * 23, ry + 4 + ((i * 7 + Math.floor(time * 6)) % 22), 10, 7); }
      R(rx + 74, ry, 1, 5, '#606060'); disc(rx + 74, ry + 8, 3, Math.floor(time * 4) % 2 ? '#e0e0f0' : '#a0a0c0');
      const gs = guests[f.id] = guests[f.id] || Array.from({ length: U.irand(3, 5) }, () => ({ m: randomLook({ age: U.irand(18, 40), sex: U.pick(['m', 'f']) }), x: rx + U.irand(10, 120), tx: rx + 60, wait: 0, face: 1 }));
      for (const p of gs) { const mv = walk(p, rx + 4, rx + 136, 12); person(g, p.x, fy - (Math.floor(time * 4 + p.x) % 2), p.m, { frame: mv ? Math.floor(time * 8) % 4 : 0, face: p.face, wave: Math.floor(time * 2 + p.x) % 3 === 0 }); }
    } else delete guests[f.id];
  }
  function walk(p, x0, x1, speed) {
    if (p.wait > 0) { p.wait -= dt; return false; }
    const d = p.tx - p.x;
    if (Math.abs(d) < 0.6) { p.wait = U.rand(1.5, 6); p.tx = U.rand(x0, x1); p.spot = null; return false; }
    p.face = d > 0 ? 1 : -1;
    p.x += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    return true;
  }
  function drawResidents(u, f, rx, ry, fy, h) {
    const s = S(), d = SIM.day(), wd = SIM.dow();
    let sleepers = 0;
    const balX = u.side === 'A' ? -15 : BW + 7;
    const sp = spots[u.id] || [];
    for (const m of f.members) {
      const st = memberState(f, m, h, d, wd);
      const prev = prevState[m.id];
      if (prev && prev !== st && speedNow <= 3 && st !== 'event' && prev !== 'event') {
        if (st === 'away' && prev !== 'away') spawnWalker(m, true);
        else if (prev === 'away' && st !== 'away') spawnWalker(m, false);
      }
      prevState[m.id] = st;
      if (st === 'away' || st === 'event') continue;
      if (st === 'sleep') {
        if (f.kind === 'squatter') { R(rx + 6 + sleepers * 20, fy - 7, 4, 4, m.skin); R(rx + 6 + sleepers * 20, fy - 7, 4, 1, m.hair); }
        else if (m.age >= 3 && sleepers < 2) { const floorBed = f.ls === 0 && u.size !== 'luxury', hx = rx + 5 + sleepers * (floorBed ? 6 : 1), hy = floorBed ? fy - 8 : fy - 14 + sleepers * 2; R(hx, hy, 4, 4, m.skin); R(hx, hy, 4, 1, m.hair); R(hx + 1, hy + 2, 2, 1, U.shade(m.skin, -0.3)); }
        if (sleepers === 0 && Math.random() < 0.004) addIcon(u.id, 'zz');
        sleepers++;
        continue;
      }
      const p = people[m.id] = people[m.id] || { x: rx + U.rand(10, 130), tx: rx + U.rand(10, 130), wait: U.rand(0, 3), face: 1, balc: 0 };
      if (p.x < rx - 30 || p.x > rx + AW + 30) { p.x = rx + U.rand(10, 130); p.tx = p.x; }
      const outdoorsOk = !['rain', 'storm', 'snow'].includes(s.weather.type) && h > 7 && h < 23;
      if (p.balc > 0) {
        p.balc -= dt;
        person(g, balX, fy + 3, m, { face: u.side === 'A' ? -1 : 1 });
        if (SIM.has(f, 'smoker') && Math.random() < 0.08) parts.push({ x: balX + (u.side === 'A' ? 0 : 8), y: fy - 14, vx: U.rand(-2, 2), vy: -5, life: 1.8, col: 'rgba(220,220,220,0.7)', size: 1 });
        continue;
      }
      // A new target: often a seat or the stove, sometimes the balcony.
      if (p.wait <= 0 && Math.abs(p.tx - p.x) < 0.6) {
        if (outdoorsOk && (SIM.has(f, 'smoker') || SIM.has(f, 'garden')) && m.age >= 18 && Math.random() < 0.15) { p.balc = U.rand(6, 14); p.wait = 0.5; continue; }
        const spot = sp.length && Math.random() < 0.6 ? U.pick(sp) : null;
        if (spot && !f.members.some(o => o !== m && people[o.id] && people[o.id].spot === spot)) { p.tx = spot.x; p.spot = spot; }
        else { p.tx = rx + U.rand(6, 136); p.spot = null; }
      }
      const moving = walk(p, rx + 6, rx + 136, m.age < 13 ? 13 : m.age >= 75 ? 5 : 9);
      const atSpot = !moving && p.spot && Math.abs(p.x - p.spot.x) < 1;
      const face = atSpot && p.spot.face ? p.spot.face : p.face;
      person(g, p.x, fy, m, { frame: moving ? Math.floor(time * 8 + p.x) % 4 : 0, face, sit: atSpot && p.spot.sit && m.age >= 13, talk: !moving && f.members.length > 1 && Math.floor(time + p.x) % 5 === 0 });
    }
  }

  // ---------- shops ----------
  const SHOPWALL = { cafe: '#e8d0b0', bakery: '#f0e0c0', pizzeria: '#e8c8a0', grocery: '#e0ecd0', pharmacy: '#e8f4ec', barber: '#e0e8f0', florist: '#e8f0d8', gelateria: '#f8e0e8',
    dentist: '#e8f0f4', gym: '#c8ccd4', detective: '#7a6a5a', daycare: '#f8f0c0', yoga: '#e8e0f0', lawyer: '#d8d0c0', bnb: '#f4e8d8', coworking: '#e4ecf0' };
  const SIGN = { cafe: '#5a3a24', bakery: '#c08030', pizzeria: '#2a7a3a', grocery: '#3a8a3a', pharmacy: '#30a050', barber: '#3050a0', florist: '#c04080', gelateria: '#e070a0',
    dentist: '#3080c0', gym: '#202020', detective: '#2a2a2a', daycare: '#e04040', yoga: '#8060c0', lawyer: '#5a3a2a', bnb: '#806030', coworking: '#3070a0' };
  function drawShop(u, rx, ry, fy) {
    const sh = u.shop, t = sh.type, h = hr(), open = shopOpen(u, h);
    const wall = SHOPWALL[t];
    R(rx, ry, AW, 53, wall);
    for (let x = rx; x < rx + AW; x += 4) R(x, fy, 4, 3, (x / 4) % 2 ? '#e8e8e8' : '#505860');
    if (t === 'gym' || t === 'yoga') R(rx, fy, AW, 3, t === 'gym' ? '#303438' : '#c8a070');
    R(rx, fy - 2, AW, 2, U.shade(wall, -0.3));
    // Sign board with the name.
    const name = sh.name.toUpperCase(), tw = name.length * 4 - 1;
    R(rx + 4, ry + 2, AW - 8, 10, SIGN[t]); R(rx + 4, ry + 11, AW - 8, 1, U.shade(SIGN[t], -0.3));
    if (sh.neon) { const nc = Math.floor(time * 2) % 2 ? '#ff60d0' : '#60f0ff'; R(rx + 2, ry + 1, AW - 4, 1, nc); R(rx + 2, ry + 12, AW - 4, 1, nc); R(rx + 2, ry + 1, 1, 12, nc); R(rx + AW - 3, ry + 1, 1, 12, nc); }
    PIX.text(g, name, rx + Math.round((AW - tw) / 2), ry + 4, open ? (sh.neon ? '#fff0ff' : '#fff8e0') : '#c8c0b0');
    const sp = spots[u.id] = [];
    const r = srng(u.seed);
    const counter = (x, w, col) => { R(x, fy - 14, w, 14, col); R(x - 1, fy - 15, w + 2, 2, U.shade(col, 0.25)); R(x, fy - 2, w, 2, U.shade(col, -0.3)); };
    const shelfRow = (x, y, w, cols) => { R(x, y + 5, w, 1, C.woodDk); for (let i = x + 1; i < x + w - 2; i += 3) R(i, y + 1, 2, 4, cols[Math.floor(r() * cols.length)]); };
    let ox = rx + 80;
    switch (t) {
      case 'cafe':
        counter(rx + 92, 40, '#7a4a2a');
        R(rx + 112, fy - 23, 12, 8, '#b0b8c0'); R(rx + 114, fy - 21, 8, 3, '#303030'); R(rx + 115, fy - 18, 2, 3, '#606060');
        if (open && Math.random() < 0.1) parts.push({ x: rx + 117, y: fy - 25, vx: U.rand(-1, 1), vy: -6, life: 1.2, col: 'rgba(240,240,240,0.6)', size: 1 });
        R(rx + 95, fy - 20, 14, 5, '#e8e0d0'); for (let i = 0; i < 4; i++) R(rx + 96 + i * 3, fy - 19, 2, 2, ['#e0a040', '#a05020', '#f0d080', '#c08040'][i]);
        R(rx + 96, ry + 16, 36, 14, '#1a2a1a'); PIX.text(g, 'MENU', rx + 106, ry + 18, '#f0f0f0'); R(rx + 99, ry + 25, 20, 1, '#a0a0a0'); R(rx + 99, ry + 27, 14, 1, '#a0a0a0');
        for (const tx of [rx + 16, rx + 54]) { R(tx, fy - 12, 14, 2, '#d8d0c0'); R(tx + 6, fy - 10, 2, 10, '#404040'); R(tx + 3, fy - 1, 8, 1, '#404040'); F.chair(tx - 9, fy, 1); F.chair(tx + 15, fy, -1); sp.push({ x: tx - 9, sit: true, face: 1 }, { x: tx + 15, sit: true, face: -1 }); R(tx + 4, fy - 14, 2, 2, '#f0f0f0'); }
        F.ceilingLamp(rx + 30, ry + 12, open); F.ceilingLamp(rx + 70, ry + 12, open); F.plant(rx + 78, fy, true);
        ox = rx + 120; sp.push({ x: rx + 88, face: 1 });
        break;
      case 'bakery':
        counter(rx + 70, 34, '#e8d8c0'); R(rx + 71, fy - 14, 32, 8, '#c8e0f0');
        for (let i = 0; i < 5; i++) R(rx + 73 + i * 6, fy - 11, 4, 3, ['#d08030', '#f0c080', '#e06080', '#c07030', '#f0e0b0'][i]);
        for (let s = 0; s < 3; s++) { R(rx + 8, ry + 20 + s * 10, 46, 1, C.woodDk); for (let i = 0; i < 6; i++) { R(rx + 9 + i * 7, ry + 16 + s * 10, 6, 4, s === 1 ? '#c08040' : '#d89850'); R(rx + 10 + i * 7, ry + 16 + s * 10, 4, 1, '#e8b870'); } }
        R(rx + 112, fy - 34, 34, 34, '#a03a2a'); R(rx + 116, fy - 26, 26, 14, '#2a1a14'); R(rx + 118, fy - 22, 22, 8, open ? '#f08020' : '#3a2a20'); R(rx + 112, fy - 36, 34, 2, '#7a2a20');
        ox = rx + 98; sp.push({ x: rx + 60, face: 1 });
        break;
      case 'pizzeria':
        R(rx + 110, fy - 36, 36, 36, '#b05a3a'); R(rx + 112, fy - 34, 32, 2, '#c87050'); disc(rx + 128, fy - 14, 10, '#3a1a10'); R(rx + 116, fy - 14, 24, 14, '#b05a3a');
        if (open) for (let i = 0; i < 5; i++) R(rx + 120 + i * 3, fy - 20 + U.irand(0, 3), 2, U.irand(3, 6), ['#ff8020', '#ffd040', '#ff4010'][i % 3]);
        R(rx + 125, ry + 1, 6, 16, '#8a4a30');
        counter(rx + 80, 24, '#e8e0d0');
        for (const tx of [rx + 14, rx + 48]) { F.table(tx, fy, 18, '#d03030'); F.chair(tx - 9, fy, 1); F.chair(tx + 19, fy, -1); sp.push({ x: tx - 9, sit: true, face: 1 }, { x: tx + 19, sit: true, face: -1 }); }
        R(rx + 30, ry + 16, 40, 1, '#3a8a3a'); for (let i = 0; i < 8; i++) R(rx + 31 + i * 5, ry + 17, 3, 4, ['#3a8a3a', '#f0f0f0', '#d03030'][i % 3]);
        ox = rx + 100;
        break;
      case 'grocery':
        for (let s = 0; s < 3; s++) shelfRow(rx + 6, ry + 15 + s * 12, 50, ['#e04040', '#40a040', '#f0d040', '#4060c0', '#f08030', '#f0f0f0']);
        for (let i = 0; i < 3; i++) { R(rx + 62 + i * 12, fy - 8, 11, 8, '#a07040'); for (let k = 0; k < 4; k++) disc(rx + 64 + i * 12 + k * 2, fy - 9, 1, ['#f04020', '#f0c020', '#60c030'][i]); }
        counter(rx + 104, 28, '#d0c0a0'); R(rx + 112, fy - 21, 10, 6, '#404048'); R(rx + 113, fy - 20, 8, 2, '#60f060');
        ox = rx + 134; sp.push({ x: rx + 30, face: -1 }, { x: rx + 96, face: 1 });
        break;
      case 'pharmacy':
        for (let s = 0; s < 3; s++) shelfRow(rx + 8, ry + 15 + s * 12, 70, ['#f0f0f0', '#e8f0f8', '#f0e0e0', '#e0f0e0', '#4090e0']);
        counter(rx + 92, 40, '#f0f4f4'); R(rx + 92, fy - 10, 40, 1, '#30a050');
        R(rx + 136, ry + 16, 10, 10, open && Math.floor(time * 2) % 2 ? '#40e060' : '#208040'); R(rx + 140, ry + 17, 2, 8, '#ffffff'); R(rx + 137, ry + 20, 8, 2, '#ffffff');
        ox = rx + 128; sp.push({ x: rx + 84, face: 1 }, { x: rx + 40, face: -1 });
        break;
      case 'barber':
        for (const bx of [rx + 20, rx + 60]) { R(bx - 2, ry + 15, 18, 16, '#c8e0f0'); R(bx - 3, ry + 14, 20, 1, '#808080'); R(bx, fy - 10, 14, 3, '#c03030'); R(bx + 10, fy - 18, 4, 8, '#c03030'); R(bx + 6, fy - 7, 2, 7, '#808080'); R(bx + 2, fy - 1, 10, 1, '#808080'); sp.push({ x: bx + 3, sit: true, face: -1 }); }
        R(rx + 140, ry + 14, 5, 30, '#f0f0f0'); for (let i = 0; i < 6; i++) R(rx + 140, ry + 14 + ((i * 5 + Math.floor(time * 8)) % 30), 5, 2, i % 2 ? '#e02020' : '#2040c0');
        counter(rx + 100, 26, '#3a3a40');
        ox = rx + 34;
        break;
      case 'florist':
        for (let i = 0; i < 8; i++) F.flowers(rx + 6 + i * 11, fy);
        R(rx + 6, fy - 26, 92, 2, C.woodDk);
        for (let i = 0; i < 4; i++) F.plant(rx + 8 + i * 22, fy - 26, false, ['#3a8a3a', '#4aa04a', '#2a7a4a', '#5ab05a'][i]);
        counter(rx + 104, 30, '#c8b090');
        ox = rx + 128; sp.push({ x: rx + 96, face: 1 }, { x: rx + 40, face: 1 });
        break;
      case 'gelateria':
        counter(rx + 50, 60, '#f0f0f0'); R(rx + 51, fy - 22, 58, 8, '#c8e8f8');
        for (let i = 0; i < 8; i++) R(rx + 53 + i * 7, fy - 19, 5, 4, ['#f8f0d0', '#a05030', '#f090b0', '#90e070', '#f0e040', '#e04040', '#ffffff', '#60a0f0'][i]);
        R(rx + 120, ry + 16, 14, 20, '#f8d8e0'); R(rx + 124, ry + 28, 6, 8, '#d0a060'); disc(rx + 127, ry + 24, 4, '#f090b0');
        R(rx + 12, fy - 12, 14, 2, '#f8f8f8'); R(rx + 18, fy - 10, 2, 10, '#c0c0c0'); F.chair(rx + 27, fy, -1); sp.push({ x: rx + 27, sit: true, face: -1 }, { x: rx + 42, face: 1 });
        ox = rx + 80;
        break;
      case 'dentist':
        R(rx + 30, fy - 10, 30, 4, '#40a0c0'); R(rx + 26, fy - 18, 6, 10, '#40a0c0'); R(rx + 42, fy - 6, 4, 6, '#d0d0d0'); R(rx + 36, fy - 2, 18, 2, '#d0d0d0');
        R(rx + 44, ry + 14, 1, 14, '#808080'); R(rx + 40, ry + 28, 10, 3, '#f0f0f0');
        sp.push({ x: rx + 34, sit: true, face: 1 });
        F.shelf(rx + 6, fy, r, 14, 30); counter(rx + 110, 30, '#f0f4f8');
        if (open && Math.random() < 0.004) addIcon(u.id, 'excl');
        ox = rx + 54;
        break;
      case 'gym':
        R(rx + 10, fy - 12, 22, 4, '#303030'); R(rx + 12, fy - 22, 2, 10, '#505050'); R(rx + 28, fy - 8, 2, 8, '#505050'); R(rx + 10, fy - 13, 22, 1, '#606060');
        for (let i = 0; i < 4; i++) { R(rx + 46 + i * 8, fy - 6, 6, 6, '#202020'); R(rx + 48 + i * 8, fy - 9, 2, 3, '#808080'); }
        R(rx + 86, ry + 14, 30, 30, '#a8c0d0'); R(rx + 87, ry + 15, 28, 28, '#c8e0f0');
        R(rx + 122, fy - 20, 2, 20, '#808080'); R(rx + 116, fy - 22, 14, 2, '#303030'); R(rx + 114, fy - 24, 3, 6, '#202020'); R(rx + 129, fy - 24, 3, 6, '#202020');
        ox = rx + 70;
        break;
      case 'detective':
        F.cork(rx + 14, ry + 16); F.shelf(rx + 124, fy, r, 18, 32);
        R(rx + 60, fy - 12, 36, 2, '#4a2a1a'); R(rx + 62, fy - 10, 3, 10, '#4a2a1a'); R(rx + 91, fy - 10, 3, 10, '#4a2a1a');
        F.lamp(rx + 64, fy - 12, open, '#40a060'); R(rx + 76, fy - 14, 8, 2, '#f0f0e0'); R(rx + 86, fy - 15, 6, 3, '#5a3a2a');
        F.chair(rx + 98, fy, -1);
        ox = rx + 98; sp.push({ x: rx + 50, sit: false, face: 1 });
        break;
      case 'daycare':
        for (let i = 0; i < 7; i++) R(rx + 8 + i * 20, ry + 16, 14, 10, ['#f04040', '#40a0f0', '#f0d040', '#40c060', '#c060f0', '#f08030', '#40d0d0'][i]);
        for (let i = 0; i < 3; i++) { R(rx + 20 + i * 30, fy - 7, 14, 2, '#f0d040'); R(rx + 21 + i * 30, fy - 5, 1, 5, '#f0d040'); R(rx + 32 + i * 30, fy - 5, 1, 5, '#f0d040'); }
        F.toys(rx + 100, fy, r); R(rx + 124, fy - 16, 20, 16, '#40c060'); R(rx + 124, fy - 16, 20, 2, '#60e080');
        ox = rx + 110;
        break;
      case 'yoga':
        for (let i = 0; i < 4; i++) R(rx + 14 + i * 30, fy - 1, 22, 1, ['#80c0e0', '#e080c0', '#a0e080', '#e0c080'][i]);
        F.plant(rx + 4, fy, true); F.plant(rx + 134, fy, true, '#2a7a4a');
        R(rx + 66, ry + 16, 16, 16, '#f0e8d8'); disc(rx + 74, ry + 24, 5, '#c080e0'); disc(rx + 74, ry + 24, 2, '#f0e8d8');
        ox = rx + 120;
        break;
      case 'lawyer':
        F.shelf(rx + 6, fy, r, 20, 36); F.shelf(rx + 28, fy, r, 20, 36);
        R(rx + 80, fy - 13, 44, 3, '#5a2a1a'); R(rx + 82, fy - 10, 40, 10, '#6a3a24'); R(rx + 90, fy - 16, 10, 3, '#f0f0e0');
        F.armchair(rx + 128, fy, '#2a4a3a'); sp.push({ x: rx + 66, sit: false, face: 1 });
        F.painting(rx + 92, ry + 16, r, 18, 13);
        ox = rx + 129;
        break;
      case 'bnb':
        F.bed(rx + 4, fy, '#c04060', 26, 2); F.bed(rx + 36, fy, '#4060c0', 26, 2);
        F.window(rx + 70, ry + 16, 18, 14, { curtain: '#e0c080' });
        R(rx + 66, fy - 7, 10, 7, '#3060a0'); R(rx + 68, fy - 9, 6, 2, '#202020'); R(rx + 78, fy - 6, 8, 6, '#c03030');
        R(rx + 100, fy - 12, 30, 12, '#8a5a30'); R(rx + 99, fy - 13, 32, 2, '#a87040'); R(rx + 104, fy - 16, 6, 3, '#f0f0e0'); R(rx + 120, ry + 16, 12, 12, '#806030'); R(rx + 122, ry + 18, 8, 8, '#f0e0a0');
        sp.push({ x: rx + 92, face: 1 }, { x: rx + 60, face: -1 });
        ox = rx + 126;
        break;
      case 'coworking':
        for (const dx of [6, 52]) { R(rx + dx, fy - 11, 40, 2, '#e0e0e0'); R(rx + dx + 2, fy - 9, 2, 9, '#808080'); R(rx + dx + 36, fy - 9, 2, 9, '#808080'); for (let i = 0; i < 2; i++) { R(rx + dx + 6 + i * 18, fy - 15, 8, 4, '#303030'); R(rx + dx + 7 + i * 18, fy - 14, 6, 2, Math.floor(time * 2 + i + dx) % 3 ? '#80c0f0' : '#a0f0c0'); F.stool(rx + dx + 7 + i * 18, fy, '#3070a0'); sp.push({ x: rx + dx + 7 + i * 18, sit: true, face: 1 }); } }
        F.plant(rx + 100, fy, true); R(rx + 116, fy - 26, 26, 26, '#f0f0f0'); R(rx + 118, fy - 24, 22, 12, '#3a3a40'); R(rx + 124, fy - 10, 10, 6, '#c08040');
        ox = rx + 130;
        break;
    }
    if (open) {
      const sit = t === 'detective' || t === 'lawyer';
      person(g, ox, fy, sh.owner, { face: -1, apron: ['bakery', 'pizzeria', 'gelateria', 'cafe', 'grocery'].includes(t), sit, hat: t === 'pizzeria' || t === 'bakery' ? '#f8f8f8' : null, talk: Math.floor(time * 0.7) % 3 === 0 });
      if (t === 'daycare' || t === 'yoga' || t === 'gym') drawClass(u, rx, fy, t);
      drawCustomers(u, rx, fy, sp);
    } else {
      R(rx + 62, ry + 33, 26, 9, '#f8f4e8'); R(rx + 62, ry + 33, 26, 1, '#c03030'); PIX.text(g, 'CLOSED', rx + 64, ry + 35, '#c03030');
      delete customers[u.id]; delete customers['class' + u.id];
    }
  }
  function drawClass(u, rx, fy, t) {
    const key = 'class' + u.id;
    const list = customers[key] = customers[key] || Array.from({ length: t === 'daycare' ? 4 : 3 }, (v, i) => ({ m: randomLook({ age: t === 'daycare' ? U.irand(2, 5) : U.irand(20, 60), sex: U.pick(['m', 'f']) }), x: rx + 14 + i * 32, tx: rx + 14 + i * 32, wait: 0, face: 1 }));
    for (const p of list) {
      if (t === 'daycare') { const mv = walk(p, rx + 6, rx + 120, 8); person(g, p.x, fy, p.m, { frame: mv ? Math.floor(time * 8) % 4 : 0, face: p.face }); }
      else if (t === 'yoga') person(g, p.x, fy, p.m, { face: 1, wave: Math.floor(time * 0.5 + p.x) % 2 === 0 });
      else person(g, p.x, fy - (Math.floor(time * 3 + p.x) % 2), p.m, { face: 1, frame: Math.floor(time * 8) % 4 });
    }
  }
  function drawCustomers(u, rx, fy, sp) {
    const list = customers[u.id] = customers[u.id] || [];
    const ground = u.floor === 0, door = ground ? (u.side === 'A' ? rx - 2 : rx + AW - 6) : (u.side === 'A' ? rx + AW - 8 : rx + 2);
    const hh = hr(), rush = (hh >= 12 && hh < 14) || (hh >= 18 && hh < 21) ? 1.6 : 1;
    if (list.length < 4 && Math.random() < 0.3 * (u.shop.health / 100) * rush * dt * Math.min(3, Math.max(1, speedNow))) {
      const m = randomLook({ age: U.irand(8, 85), sex: U.pick(['m', 'f']) });
      const free = sp.filter(s => !list.some(c => c.spot === s));
      const spot = free.length && Math.random() < 0.7 ? U.pick(free) : null;
      list.push({ m, x: door, tx: spot ? spot.x : rx + U.rand(20, 120), spot, stay: U.rand(4, 10), out: false, face: 1 });
    }
    for (const c of list) {
      const d = c.tx - c.x;
      if (Math.abs(d) > 0.6) { c.face = d > 0 ? 1 : -1; c.x += Math.sign(d) * Math.min(Math.abs(d), (c.out ? 11 : 9) * dt); }
      else if (!c.out) { c.stay -= dt; if (c.stay <= 0) { c.out = true; c.tx = door; } }
      else { c.done = true; if (ground) walkers.push({ x: c.x, dir: u.side === 'A' ? -1 : 1, speed: 13, m: c.m, umbrella: umbrella() }); }
      const atSpot = !c.out && c.spot && Math.abs(c.x - c.spot.x) < 1;
      const moving = Math.abs(c.tx - c.x) > 0.6;
      person(g, c.x, fy, c.m, { frame: moving ? Math.floor(time * 8 + c.x) % 4 : 0, face: atSpot && c.spot.face ? c.spot.face : c.face, sit: atSpot && c.spot.sit && c.m.age >= 13, talk: atSpot && Math.floor(time + c.x) % 4 === 0 });
    }
    customers[u.id] = list.filter(c => !c.done);
  }

  // ---------- common spaces ----------
  function drawCommon(u, rx, ry, fy) {
    const t = u.common, h = hr(), r = srng(u.seed);
    const wall = { laundry: '#d0e0e8', commonroom: '#f0e0c8', playroom: '#fff0b0', storage: '#b8b0a4' }[t];
    R(rx, ry, AW, 53, wall); R(rx, fy, AW, 3, t === 'playroom' ? '#60b060' : '#8a7a6a'); R(rx, fy - 2, AW, 2, U.shade(wall, -0.3));
    const label = DATA.commons[t].label.toUpperCase();
    R(rx + 4, ry + 2, label.length * 4 + 5, 9, '#3a2a2a'); PIX.text(g, label, rx + 7, ry + 4, '#f0e8d0');
    const sp = [];
    if (t === 'laundry') {
      for (let i = 0; i < 6; i++) { const x = rx + 8 + i * 17; R(x, fy - 16, 14, 16, '#f0f0f0'); R(x, fy - 16, 14, 3, '#c8c8c8'); disc(x + 7, fy - 7, 4, '#4a6a8a'); if ((i + Math.floor(time)) % 3 === 0 && h > 7 && h < 22) R(x + 6 + Math.round(Math.cos(time * 8 + i) * 2), fy - 7 + Math.round(Math.sin(time * 8 + i) * 2), 2, 2, '#f0f0f0'); }
      R(rx + 112, ry + 16, 34, 1, '#a0a0a0'); for (let i = 0; i < 5; i++) R(rx + 114 + i * 6, ry + 17, 5, 7, DATA.shirts[(i * 3) % DATA.shirts.length]);
      sp.push({ x: rx + 110, face: -1 }, { x: rx + 128, face: 1 });
    } else if (t === 'commonroom') {
      F.sofa(rx + 6, fy, '#c04040', 30); F.armchair(rx + 40, fy, '#4060a0'); F.tv(rx + 58, fy, h >= 18 && h < 23);
      R(rx + 94, fy - 12, 40, 3, '#2a6a3a'); R(rx + 113, fy - 15, 1, 3, '#f0f0f0'); R(rx + 96, fy - 9, 2, 9, '#5a3a24'); R(rx + 130, fy - 9, 2, 9, '#5a3a24');
      disc(rx + 100 + Math.round((Math.sin(time * 3) + 1) * 14), fy - 16 - Math.round(Math.abs(Math.sin(time * 6)) * 4), 1, '#ffffff');
      F.shelf(rx + 138, fy, r, 10, 26);
      sp.push({ x: rx + 11, sit: true, face: 1 }, { x: rx + 23, sit: true, face: 1 }, { x: rx + 42, sit: true, face: 1 }, { x: rx + 88, face: 1 }, { x: rx + 136, face: -1 });
    } else if (t === 'playroom') {
      R(rx + 10, fy - 22, 4, 22, '#e04040'); for (let i = 0; i < 6; i++) R(rx + 14 + i * 4, fy - 22 + i * 4, 5, 3, '#f0c020'); R(rx + 10, fy - 24, 10, 2, '#e04040');
      for (let i = 0; i < 8; i++) disc(rx + 50 + (i % 4) * 5, fy - 3 - Math.floor(i / 4) * 4, 2, ['#e04040', '#40a0f0', '#f0d040', '#40c060'][i % 4]);
      F.toys(rx + 80, fy, r); R(rx + 112, fy - 14, 30, 14, '#80c0f0'); R(rx + 112, fy - 14, 30, 2, '#a0e0ff');
      for (let i = 0; i < 6; i++) R(rx + 20 + i * 20, ry + 16, 10, 8, ['#f04040', '#40a0f0', '#f0d040', '#40c060', '#c060f0', '#f08030'][i]);
      sp.push({ x: rx + 52, face: 1 }, { x: rx + 84, face: -1 }, { x: rx + 120, face: 1 });
    } else {
      for (let i = 0; i < 5; i++) { const x = rx + 4 + i * 29; R(x, ry + 14, 26, 39, '#8a8a90'); for (let k = x + 2; k < x + 26; k += 4) R(k, ry + 14, 1, 39, '#a0a0a8'); R(x + 4, fy - 12, 10, 8, '#c09060'); R(x + 14, fy - 18, 8, 6, '#b08050'); }
      for (let i = 0; i < 2; i++) { const x = rx + 30 + i * 60; disc(x, fy - 5, 4, '#202020'); disc(x + 14, fy - 5, 4, '#202020'); R(x, fy - 9, 14, 1, ['#d03030', '#3060c0'][i]); R(x + 7, fy - 12, 1, 4, '#303030'); }
    }
    // A few residents use the space at the right time of day.
    const busy = (t === 'commonroom' && h >= 17 && h < 23) || (t === 'playroom' && h >= 15 && h < 19) || (t === 'laundry' && h >= 9 && h < 20);
    const key = 'common' + u.id;
    if (!busy || !sp.length) { delete customers[key]; return; }
    const pool = [];
    for (const f of SIM.fams()) if (f.kind !== 'squatter') for (const m of f.members) if ((t === 'playroom') === (m.age < 13) && m.age >= 3 && prevState[m.id] !== 'away') pool.push(m);
    const list = customers[key] = customers[key] || pool.filter(m => hash(m.id + ':' + SIM.day() + t) < 0.35).slice(0, sp.length).map((m, i) => ({ m, x: sp[i].x, spot: sp[i] }));
    for (const c of list) person(g, c.x, fy, c.m, { sit: c.spot.sit && c.m.age >= 13, face: c.spot.face, talk: Math.floor(time + c.x) % 3 === 0, wave: t === 'playroom' && Math.floor(time * 2 + c.x) % 2 === 0 });
  }

  // ---------- empty slots, building sites, ruins ----------
  function drawShell(u, rx, ry, fy) {
    R(rx, ry, AW, 53, '#a8a49c');
    const r = srng(u.seed);
    for (let i = 0; i < 18; i++) { const bx = rx + Math.floor(r() * 140), by = ry + Math.floor(r() * 46); R(bx, by, 6, 3, '#b0604a'); R(bx, by + 3, 6, 1, '#8a8478'); }
    R(rx, fy, AW, 3, '#8a8680'); R(rx, fy, AW, 1, '#9a968e');
    F.bulb(rx + 75, ry, false);
    R(rx + 112, fy - 7, 10, 7, '#e0d8c0'); R(rx + 123, fy - 5, 10, 5, '#d8d0b8'); R(rx + 113, fy - 5, 8, 1, '#a0a0a0');
    R(rx + 20, fy - 30, 1, 30, '#c09050'); R(rx + 30, fy - 30, 1, 30, '#c09050'); for (let y = fy - 28; y < fy; y += 5) R(rx + 20, y, 11, 1, '#c09050');
    const on = hover === u.id || sel === u.id;
    const col = on ? '#ffe060' : 'rgba(255,255,255,0.6)';
    R(rx + 58, ry + 14, 34, 24, on ? 'rgba(255,224,96,0.28)' : 'rgba(255,255,255,0.14)');
    R(rx + 73, ry + 18, 4, 16, col); R(rx + 67, ry + 24, 16, 4, col);
    const txt = u.kind === 'shop' ? 'VACANT SHOP' : u.floor === 0 ? 'SHOP SPACE' : 'EMPTY SHELL';
    PIX.text(g, txt, rx + 75 - Math.round((txt.length * 4 - 1) / 2), ry + 42, on ? '#ffe060' : '#f0f0f0');
  }
  function drawWorksite(u, rx, ry, fy) {
    R(rx, ry, AW, 53, '#c8c0b0');
    const p = U.clamp(1 - (u.work - S().t) / SIM.FIT_HOURS, 0, 1);
    R(rx, ry, Math.round(AW * p), 53, u.shop ? SHOPWALL[u.shop.type] : '#e8dcc0');
    R(rx, fy, AW, 3, '#8a8680');
    for (let x = rx + 10; x < rx + AW - 10; x += 44) { R(x, ry + 2, 1, 51, '#808080'); R(x + 18, ry + 2, 1, 51, '#808080'); R(x, ry + 22, 19, 2, '#c09050'); R(x, ry + 38, 19, 1, '#808080'); }
    const bob = Math.floor(time * 4) % 2;
    person(g, rx + 60 + Math.sin(time * 0.7) * 40, fy, WORKER, { vest: true, hat: '#f0d020', frame: Math.floor(time * 6) % 4, face: Math.cos(time * 0.7) > 0 ? 1 : -1 });
    person(g, rx + 102, ry + 22, { ...WORKER, skin: '#a86b44' }, { vest: true, hat: '#f0d020', wave: bob });
    if (Math.random() < 0.3) parts.push({ x: rx + 110, y: ry + 6, vx: U.rand(-10, 10), vy: U.rand(-8, 2), life: 0.4, col: '#ffe060', size: 1, grav: 40 });
    if (Math.random() < 0.1) parts.push({ x: rx + U.rand(10, 140), y: fy - 2, vx: U.rand(-3, 3), vy: -3, life: 1.5, col: 'rgba(220,210,190,0.6)', size: 2 });
    R(rx + 45, ry + 4, 60, 5, '#303030'); R(rx + 46, ry + 5, Math.round(58 * p), 3, '#60d060');
    PIX.text(g, 'WORK IN PROGRESS', rx + 44, ry + 12, '#a05000');
  }
  function drawRuin(u, rx, ry, fy) {
    R(rx, ry, AW, 53, '#2a2422');
    const r = srng(hash(u.id + 'r'));
    for (let i = 0; i < 20; i++) R(rx + Math.floor(r() * 140), ry + Math.floor(r() * 40), U.irand(4, 12), 2, '#1a1414');
    for (let i = 0; i < 6; i++) { const x = rx + 10 + i * 22, hh = 4 + Math.floor(r() * 10); R(x, fy - hh, 16, hh, '#4a3a32'); }
    R(rx + 30, ry + 6, 50, 3, '#3a2a22'); R(rx + 80, ry + 10, 3, 30, '#3a2a22');
    const txt = u.ruin === 'quake' ? 'COLLAPSED' : 'BURNT OUT';
    PIX.text(g, txt, rx + 57, ry + 22, '#8a7a75');
  }

  // ---------- building ----------
  function drawBuilding() {
    const s = S(), top = roofY();
    R(-1, top - 1, BW + 2, -top + 1, C.outline);
    drawRoof(top);
    for (let fl = 0; fl <= s.floors; fl++) {
      const t = floorTop(fl);
      R(0, t, BW, SLAB, C.slab); R(0, t, BW, 1, U.shade(C.slab, 0.2)); R(0, t + SLAB - 1, BW, 1, C.slabDk);
      R(0, t + SLAB, WALL, FH - SLAB, C.facade); R(BW - WALL, t + SLAB, WALL, FH - SLAB, C.facade);
      R(WALL - 1, t + SLAB, 1, FH - SLAB, C.facadeDk); R(BW - WALL, t + SLAB, 1, FH - SLAB, C.facadeDk); R(1, t + SLAB, 1, FH - SLAB, C.facadeLt); R(BW - 2, t + SLAB, 1, FH - SLAB, C.facadeLt);
      R(SX - 3, t + SLAB, 3, FH - SLAB, C.stairDk); R(SX + STW, t + SLAB, 3, FH - SLAB, C.stairDk);
      drawStair(fl, t + SLAB);
    }
    for (const u of units()) {
      const { rx, ry, fy } = room(u);
      if (u.burnt) drawRuin(u, rx, ry, fy);
      else if (u.work) drawWorksite(u, rx, ry, fy);
      else if (u.kind === 'apt') drawApt(u, rx, ry, fy);
      else if (u.kind === 'shop' && u.shop) drawShop(u, rx, ry, fy);
      else if (u.kind === 'common') drawCommon(u, rx, ry, fy);
      else drawShell(u, rx, ry, fy);
      if (u.fire) drawFire(u, rx, ry, fy);
    }
    // A yellow sign on every home or shop with an open request.
    for (const r of S().requests) {
      const id = r.fam ? (S().fams[r.fam] || {}).apt : r.unit;
      const u = id && SIM.unit(id);
      if (!u) continue;
      const { rx, ry } = room(u), urgent = r.deadline - SIM.day() <= 7;
      if (urgent && Math.floor(time * 3) % 2) continue;
      R(rx + AW - 14, ry + 14, 11, 13, '#2a1a1a'); R(rx + AW - 13, ry + 15, 9, 11, urgent ? '#ff6040' : '#ffe040');
      R(rx + AW - 9, ry + 17, 2, 5, '#2a1a1a'); R(rx + AW - 9, ry + 23, 2, 2, '#2a1a1a');
    }
    drawElevator();
    drawStaff();
    drawScenes('building');
    // Ground floor: glass doors in the outer walls and awnings over the street.
    for (const side of ['A', 'B']) {
      const u = SIM.unit('G' + side), x = side === 'A' ? 0 : BW - WALL;
      if (!u || !u.shop || u.work || u.burnt) continue;
      R(x, -26, WALL, 26, '#5a3a2a'); R(x + 1, -25, WALL - 2, 25, U.mix(C.glass, skyNow[1], 0.3)); R(x + 1, -13, WALL - 2, 1, '#c0a060');
      if (u.shop.smashed > SIM.day()) { R(x - 1, -22, WALL + 2, 3, '#a07040'); R(x - 1, -10, WALL + 2, 3, '#8a6030'); R(x + 2, -18, 1, 6, '#f0f0f0'); for (let i = 0; i < 4; i++) R(x - 6 + i * 3, -1, 2, 1, '#d0e8f0'); }
      const ax = side === 'A' ? -28 : BW + 2, col = SIGN[u.shop.type];
      for (let i = 0; i < 26; i += 4) R(ax + i, -36, 4, 7, (i / 4) % 2 ? col : '#f8f4e8');
      R(ax, -37, 26, 1, U.shade(col, -0.3)); for (let i = 0; i < 26; i += 4) R(ax + i + 1, -29, 2, 1, (i / 4) % 2 ? col : '#f8f4e8');
    }
    // Balconies.
    for (let fl = 1; fl <= s.floors; fl++) {
      const by = -FH * fl;
      for (const side of ['A', 'B']) {
        const x = side === 'A' ? -20 : BW;
        R(x, by - 3, 20, 4, C.slab); R(x, by, 20, 1, C.slabDk);
        const u = SIM.unit(fl + side), f = u && famOf(u);
        if (f && SIM.has(f, 'garden')) for (let i = 0; i < 4; i++) { R(x + 1 + i * 5, by - 8, 4, 5, '#b05a30'); R(x + 1 + i * 5, by - 13, 4, 5, '#3a8a3a'); R(x + 2 + i * 5, by - 15, 2, 2, ['#f04060', '#f0e040', '#ffffff', '#c060f0'][i]); }
        if (f && f.kind === 'normal' && hash(f.seed + 'l') < 0.45 && !['rain', 'storm'].includes(s.weather.type)) {
          R(x + 1, by - 24, 18, 1, '#a0a0a0');
          for (let i = 0; i < 3; i++) { const col = i === 1 ? f.accent : f.members[i % f.members.length].shirt; R(x + 2 + i * 6, by - 23, 4, 5, col); R(x + 2 + i * 6, by - 23, 4, 1, U.shade(col, 0.2)); }
        }
        if (f && hash(f.seed + 'b') < 0.3) { const cx = x + (side === 'A' ? 3 : 10); R(cx, by - 9, 7, 1, '#606060'); R(cx, by - 8, 1, 5, '#606060'); R(cx + 6, by - 8, 1, 5, '#606060'); R(cx, by - 13, 1, 4, '#606060'); }
        R(x, by - 14, 20, 2, C.rail); R(x, by - 14, 20, 1, U.shade(C.rail, 0.2));
        if (f && festNow === 'christmas') for (let i = 0; i < 20; i += 3) R(x + i, by - 13, 1, 1, ['#ff4040', '#40ff60', '#ffe040', '#40a0ff'][(i / 3 + Math.floor(time * 2 + fl)) % 4 | 0]);
        if (f && festNow === 'halloween' && hash(f.seed + 'pk') < 0.7) { const px = x + (side === 'A' ? 4 : 10); disc(px + 3, by - 6, 3, '#f08020'); R(px + 3, by - 10, 1, 2, '#3a8a3a'); R(px + 1, by - 7, 1, 1, '#2a1a0a'); R(px + 5, by - 7, 1, 1, '#2a1a0a'); R(px + 2, by - 5, 3, 1, '#2a1a0a'); }
        if (f && festNow === 'football' && hash(f.seed + 'fl') < 0.75) { const px = x + (side === 'A' ? 2 : 17); R(px, by - 28, 1, 15, '#808080'); const fx2 = side === 'A' ? px - 9 : px + 1; R(fx2, by - 28, 3, 6, '#20a040'); R(fx2 + 3, by - 28, 3, 6, '#f8f8f8'); R(fx2 + 6, by - 28, 3, 6, '#e03030'); }
        for (let i = 0; i < 20; i += 3) R(x + i + (side === 'A' ? 0 : 2), by - 12, 1, 9, C.rail);
        if (s.weather.type === 'snow') R(x, by - 15, 20, 1, '#f4f8ff');
      }
    }
    if (s.upgrades.escape) drawEscape(top);
    if (s.floorWork) drawConstruction(top);
  }
  // External fire escape on the west side: a landing for every floor and zigzag stairs.
  function drawEscape(top) {
    const x0 = -40, w = 18, col = '#2a2a30';
    for (let fl = 1; fl <= S().floors; fl++) {
      const by = -FH * fl;
      R(x0, by - 2, w + 20, 2, col); R(x0, by - 10, 1, 8, col); R(x0, by - 10, w, 1, col);
      const down = fl % 2 ? 1 : -1;
      for (let i = 0; i < 20; i++) R(x0 + (down > 0 ? i * w / 20 : w - i * w / 20), by + Math.round(i * (FH - 4) / 20), 2, 1, col);
    }
    R(x0, top - 2, 1, -top + 2 - FH, col); R(x0 + w, top - 2, 1, -top + 2 - FH, col);
  }
  function drawRoof(top) {
    const s = S();
    R(30, top - 18, 10, 16, '#a04030'); R(29, top - 20, 12, 3, '#6a2a20'); for (let y = top - 16; y < top; y += 4) R(30, y, 10, 1, '#8a3428');
    if (s.weather.temp < 12 && Math.random() < 0.2) parts.push({ x: 35, y: top - 22, vx: U.rand(0.5, 3), vy: -4, life: 3, col: 'rgba(200,200,200,0.5)', size: 2 });
    const ax = BW - 70;
    R(ax, top - 32, 1, 30, '#303030'); R(ax - 9, top - 30, 19, 1, '#303030'); R(ax - 6, top - 25, 13, 1, '#303030'); R(ax - 7, top - 20, 15, 1, '#303030');
    disc(BW - 40, top - 12, 5, '#d8d8d8'); disc(BW - 40, top - 12, 3, '#c0c0c0'); R(BW - 40, top - 7, 1, 6, '#808080');
    R(BW - 26, top - 16, 16, 14, '#8a9aa8'); R(BW - 26, top - 16, 16, 2, '#a8b8c8'); R(BW - 22, top - 4, 2, 4, '#606060'); R(BW - 14, top - 4, 2, 4, '#606060');
    if (s.upgrades.rod) { R(ax + 30, top - 44, 1, 42, '#b08040'); R(ax + 29, top - 46, 3, 2, '#d0a050'); }
    if (s.upgrades.solar) for (let i = 0; i < 6; i++) { const x = 50 + i * 18; R(x, top - 12, 16, 8, '#2a4a8a'); R(x, top - 12, 16, 1, '#6a8ad0'); R(x + 5, top - 12, 1, 8, '#4a6aaa'); R(x + 10, top - 12, 1, 8, '#4a6aaa'); R(x + 2, top - 4, 1, 3, '#505050'); R(x + 13, top - 4, 1, 3, '#505050'); }
    if (s.upgrades.pool) {
      const px = 160, pw = 80;
      R(px, top - 20, pw, 12, '#e8e8f0'); R(px, top - 20, pw, 1, '#ffffff'); R(px + 2, top - 18, pw - 4, 8, '#40a8e0'); R(px + 2, top - 18, pw - 4, 1, '#80d0f8');
      for (let i = 0; i < 6; i++) R(px + 4 + ((i * 13 + Math.floor(time * 6)) % (pw - 10)), top - 16 + (i % 3) * 2, 4, 1, '#a0e0ff');
      R(px + pw - 8, top - 26, 1, 8, '#c0c0c0'); R(px + pw - 5, top - 26, 1, 8, '#c0c0c0'); for (let y = top - 25; y < top - 18; y += 2) R(px + pw - 8, y, 4, 1, '#c0c0c0');
      const h = hr();
      if (h > 9 && h < 19 && SIM.season() === 'summer') { const sx0 = px + 30 + Math.round(Math.sin(time) * 18); R(sx0, top - 19, 4, 3, '#e8b88f'); R(sx0, top - 20, 4, 1, '#3a2a1a'); R(sx0 - 2, top - 17, 1, 1, '#e8b88f'); R(sx0 + 5, top - 17, 1, 1, '#e8b88f'); }
      R(px + pw + 8, top - 36, 1, 34, '#808080'); for (let i = 0; i < 18; i += 3) R(px + pw - 1 + i, top - 38 + Math.round(Math.abs(i - 9) / 3), 3, 2, i % 6 ? '#e04040' : '#f8f8f8');
    }
    if (s.upgrades.garden) {
      const gx = s.upgrades.pool ? 50 : 160;
      for (let i = 0; i < 10; i++) { const x = gx + i * 10; if (s.upgrades.solar && !s.upgrades.pool && x < 160) continue; R(x - 4, top - 4, 9, 4, '#b05a30'); disc(x, top - 8, 4, i % 2 ? '#3a8a3a' : '#4aa04a'); if (i % 3 === 0) R(x, top - 13, 2, 2, '#f04060'); }
    }
    R(-4, top - 8, BW + 8, 8, C.slab);
    for (let x = -4; x < BW + 4; x += 6) { R(x, top - 8, 5, 3, U.shade(C.slab, 0.12)); R(x + 3, top - 5, 5, 3, U.shade(C.slab, -0.08)); }
    R(-4, top - 9, BW + 8, 1, C.outline); R(-4, top - 1, BW + 8, 1, C.slabDk);
    const nm = SIM.buildingName().toUpperCase(), pw = nm.length * 4 + 5;
    R(Math.round(BW / 2 - pw / 2), top - 7, pw, 7, '#f4ead0'); PIX.text(g, nm, Math.round(BW / 2 - pw / 2) + 3, top - 6, '#8a3a2a');
    if (festNow === 'christmas') for (let x = -4; x < BW + 4; x += 6) R(x, top - 10, 2, 2, ['#ff4040', '#40ff60', '#ffe040', '#40a0ff'][(x / 6 + Math.floor(time * 2)) % 4 | 0]);
    if (s.weather.type === 'snow') R(-4, top - 10, BW + 8, 2, '#f4f8ff');
    for (const p of pigeons) {
      if (p.fly > 0) { p.fly -= dt; p.y -= 30 * dt; p.x += 40 * dt; if (p.fly <= 0) { p.y = 0; p.x = U.irand(10, BW - 10); } }
      const py = top - 11 + p.y;
      if (p.fly > 0 || p.y === 0) { R(p.x, py, 5, 3, '#808890'); R(p.x + 4, py - 1, 2, 2, '#707880'); R(p.x + 5, py - 1, 1, 1, '#f0a020'); R(p.x + 1, py + 3, 1, 1, '#c06040'); if (p.fly > 0) R(p.x, py - 1 - Math.floor(time * 10) % 2 * 2, 4, 1, '#a0a8b0'); }
    }
  }
  function drawConstruction(top) {
    const s = S(), p = U.clamp(1 - (s.floorWork - s.t) / SIM.FLOOR_HOURS, 0, 1);
    const base = top - 8, ht = FH - 4;
    for (let x = 0; x <= BW; x += 59) R(Math.min(x, BW - 3), base - ht, 3, ht, '#c06030');
    R(0, base - ht, BW, 3, '#c06030'); R(0, Math.round(base - ht / 2), BW, 2, '#a05028');
    const bh = Math.round(ht * p);
    for (let y = base - bh; y < base; y += 4) for (let x = 3 + (Math.round(y / 4) % 2) * 4; x < BW - 3; x += 8) R(x, y, 7, 3, '#b0604a');
    const cx = BW - 30, ctop = base - ht - 70;
    for (let y = ctop; y < base; y += 6) { R(cx, y, 2, 6, '#f0c020'); R(cx + 8, y, 2, 6, '#f0c020'); R(cx, y, 10, 1, '#d0a010'); R(cx + 2 + (Math.round(y / 6) % 2) * 4, y + 2, 2, 2, '#d0a010'); }
    R(cx - 180, ctop - 4, 220, 4, '#f0c020'); for (let x = cx - 180; x < cx + 40; x += 8) R(x, ctop - 6, 1, 2, '#d0a010');
    R(cx + 20, ctop - 2, 16, 10, '#808080'); R(cx - 4, ctop - 14, 18, 10, '#f0c020'); R(cx - 2, ctop - 12, 8, 5, '#a0d0f0');
    const hx = Math.round(cx - 100 + Math.sin(time * 0.4) * 60), hy = ctop + 20 + Math.round((Math.sin(time * 0.7) + 1) * 15);
    R(hx, ctop, 1, hy - ctop, '#303030'); R(hx - 1, hy, 3, 2, '#303030'); R(hx - 14, hy + 2, 30, 3, '#c06030');
    person(g, 60 + Math.sin(time * 0.5) * 40, base, WORKER, { vest: true, hat: '#f0d020', frame: Math.floor(time * 6) % 4, face: Math.cos(time * 0.5) > 0 ? 1 : -1 });
    person(g, 220, base - bh, { ...WORKER, skin: '#7a4a2e' }, { vest: true, hat: '#f0d020', wave: Math.floor(time * 3) % 2 });
    if (Math.random() < 0.3) parts.push({ x: U.rand(20, BW - 20), y: base - bh, vx: U.rand(-10, 10), vy: U.rand(-10, 0), life: 0.4, col: '#ffe060', size: 1, grav: 40 });
    R(BW / 2 - 40, base - ht - 14, 80, 7, '#303030'); R(BW / 2 - 39, base - ht - 13, Math.round(78 * p), 5, '#60d060');
  }
  function drawStair(fl, ry) {
    const s = S(), lift = s.upgrades.lift;
    R(SX, ry, STW, 56, C.stair);
    const fy = ry + 53;
    R(SX, fy, STW, 3, '#a89070');
    if (fl === 0) {
      R(SX + 4, fy - 30, 18, 30, '#4a3a2a'); R(SX + 5, fy - 29, 7, 29, U.mix(C.glass, skyNow[1], 0.35)); R(SX + 14, fy - 29, 7, 29, U.mix(C.glass, skyNow[1], 0.35)); R(SX + 11, fy - 16, 1, 3, '#d0b060'); R(SX + 14, fy - 16, 1, 3, '#d0b060');
      R(SX + 2, fy - 34, 22, 3, C.slab);
      if (!lift) { R(SX + 24, fy - 40, 10, 12, '#8a8a90'); for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) R(SX + 25 + i * 5, fy - 39 + j * 4, 4, 3, '#b0b4b8'); }
      R(SX + 4, fy, 18, 1, '#6a4a3a');
      if (festNow === 'christmas') { const tx = SX + 28; for (let i = 0; i < 6; i++) R(tx - i, fy - 24 + i * 3, 1 + i * 2, 3, '#2a7a3a'); R(tx, fy - 6, 1, 6, '#6a4a2a'); R(tx, fy - 26, 1, 2, '#ffe040'); for (let i = 0; i < 5; i++) R(tx - 3 + (i * 7) % 7, fy - 20 + i * 3, 1, 1, ['#ff4040', '#40a0ff', '#ffe040'][(i + Math.floor(time * 2)) % 3]); }
      if (festNow === 'halloween') { disc(SX + 28, fy - 4, 4, '#f08020'); R(SX + 26, fy - 5, 1, 1, '#ffe060'); R(SX + 30, fy - 5, 1, 1, '#ffe060'); }
      return;
    }
    const w = lift ? 22 : STW, n = lift ? 11 : 18, sw = w / n, sh = 53 / n;
    const left = fl % 2 === 0;
    for (let i = 0; i < n; i++) {
      const x = left ? SX + Math.round(i * sw) : SX + w - Math.round((i + 1) * sw);
      const y = Math.round(fy - (i + 1) * sh);
      R(x, y, Math.ceil(sw), fy - y, C.stairDk); R(x, y, Math.ceil(sw), 1, '#f0e0c0');
    }
    for (let i = 0; i < w; i++) R(left ? SX + i : SX + w - 1 - i, Math.round(fy - 10 - i * 53 / w), 1, 1, '#5a3a2a');
    R(SX + (left ? w - 10 : 2), ry + 3, 8, 7, '#f8f4e8'); PIX.text(g, String(fl % 10), SX + (left ? w - 8 : 4), ry + 4, '#3a2a1a');
  }
  function drawElevator() {
    const s = S();
    if (!s.upgrades.lift) return;
    const shaftX = SX + 23, top = roofY() + SLAB;
    R(shaftX, top, 13, -top, '#605850'); R(shaftX + 6, top, 1, -top, '#303030');
    for (let fl = 0; fl <= s.floors; fl++) { const y = floorTop(fl) + SLAB; R(shaftX, y + 30, 13, 1, '#403830'); R(shaftX, y + 30, 1, 23, '#808080'); R(shaftX + 12, y + 30, 1, 23, '#808080'); }
    const broken = s.blackout;
    elev.target = Math.min(elev.target, s.floors);
    if (!broken) {
      if (elev.wait > 0) elev.wait -= dt;
      else {
        const ty = floorTop(elev.target) + SLAB + 33, d = ty - elev.y;
        if (Math.abs(d) < 0.5) { elev.wait = U.rand(1.5, 6); elev.target = U.irand(0, s.floors); }
        else elev.y += Math.sign(d) * Math.min(Math.abs(d), 22 * dt);
      }
    }
    const y = Math.round(elev.y);
    R(shaftX + 1, y, 11, 20, '#b0b8c0'); R(shaftX + 1, y, 11, 1, '#808890'); R(shaftX + 6, y + 1, 1, 19, '#808890');
    R(shaftX + 2, y + 1, 9, 2, broken ? '#402020' : '#fff8d0');
    if (!broken && elev.wait <= 0) { R(shaftX + 4, y + 5, 4, 4, '#e8b88f'); R(shaftX + 4, y + 4, 4, 1, '#3a2a1a'); R(shaftX + 3, y + 9, 6, 7, '#4878d0'); }
  }

  // ---------- staff ----------
  const STAFFLOOK = {
    concierge: { age: 58, sex: 'm', skin: '#e8b88f', hair: '#9a9a9a', shirt: '#2a3a6a', pants: '#202838', shoes: '#1a1a1a', style: 'short', beard: true },
    cleaner: { age: 45, sex: 'f', skin: '#c98e62', hair: '#2b1d14', shirt: '#40a0a0', pants: '#304060', shoes: '#f0f0f0', style: 'bun' },
    guard: { age: 40, sex: 'm', skin: '#a86b44', hair: '#1a1a1a', shirt: '#303038', pants: '#202024', shoes: '#101010', style: 'short' }
  };
  function drawStaff() {
    const s = S(), h = hr(), lobbyFy = floorTop(0) + SLAB + 53;
    if (s.staff.concierge && h >= 7 && h < 20) person(g, SX + 13, lobbyFy, STAFFLOOK.concierge, { face: 1, hat: '#2a3a6a', talk: Math.floor(time * 0.5) % 4 === 0 });
    if (s.staff.guard && (h >= 20 || h < 7)) {
      person(g, SX + 13, lobbyFy, STAFFLOOK.guard, { face: Math.floor(time * 0.3) % 2 ? 1 : -1, hat: '#202024' });
      R(SX + 22, lobbyFy - 10, 2, 1, '#fff6b0');
    }
    if (s.staff.cleaner && h >= 8 && h < 13 && s.floors) {
      const fl = 1 + Math.floor(time / 10) % s.floors, fy = floorTop(fl) + SLAB + 53;
      const x = SX + 4 + Math.round((Math.sin(time * 0.5) + 1) * 4);
      person(g, x, fy, STAFFLOOK.cleaner, { face: Math.cos(time * 0.5) > 0 ? 1 : -1, wave: Math.floor(time * 3) % 2 });
      R(x + 10, fy - 5, 5, 5, '#3060c0'); R(x + 9, fy - 6, 7, 1, '#5080e0');
      R(x + 8, fy - 14, 1, 13, '#c0a060'); R(x + 6, fy - 1, 5, 1, '#d8d8d8');
    }
  }
  // Roadworks, the metro sign, the film set, carnival confetti, New Year fireworks.
  function drawCity() {
    const c = S().city || {}, d = SIM.day();
    if (c.roadworks > d) {
      const x = BW / 2 + 40;
      for (let i = 0; i < 8; i++) { R(x - 60 + i * 16, 14, 12, 3, i % 2 ? '#e03030' : '#f8f8f8'); R(x - 59 + i * 16, 17, 1, 8, '#808080'); }
      R(x - 40, 26, 70, 6, '#3a2a1a'); R(x - 38, 24, 66, 2, '#6a5a4a');
      R(x + 40, 18, 26, 12, '#f0b020'); R(x + 46, 12, 12, 7, '#f0b020'); R(x + 48, 13, 8, 4, '#a0d0f0'); disc(x + 44, 31, 3, '#202020'); disc(x + 62, 31, 3, '#202020');
      const arm = Math.sin(time) * 6; R(x + 30, 16 + Math.round(arm), 12, 2, '#d09010'); R(x + 26, 18 + Math.round(arm), 6, 5, '#808080');
      person(g, x - 20, 30, WORKER, { vest: true, hat: '#f0d020', frame: Math.floor(time * 6) % 4 });
      if (Math.random() < 0.3) parts.push({ x: x - 10 + U.rand(-20, 20), y: 26, vx: U.rand(-6, 6), vy: -8, life: 1, col: 'rgba(160,140,110,0.6)', size: 2 });
    }
    if (c.metro) { const mx = BW + 128; R(mx, -40, 2, 40, '#505058'); R(mx - 6, -52, 14, 13, '#d02020'); PIX.text(g, 'M', mx - 1, -48, '#ffffff'); }
    if (c.film > d) {
      R(SX + 60, -34, 2, 34, '#303030'); R(SX + 54, -40, 14, 8, '#202020'); R(SX + 56, -38, 10, 4, '#fff8c0');
      g.fillStyle = 'rgba(255,250,200,0.15)'; g.fillRect(SX - 20, -32, 76, 40);
      person(g, SX + 70, 6, { age: 40, sex: 'm', skin: '#e8b88f', hair: '#1a1a1a', shirt: '#202020', pants: '#304060', shoes: '#202020', style: 'short', beard: true }, { face: -1, hat: '#c03030' });
      R(SX + 66, -14, 7, 5, '#202020'); R(SX + 64, -13, 2, 3, '#404040');
    }
    if (festNow === 'carnival') { const r = srng(7); for (let i = 0; i < 80; i++) R(cam.x + Math.floor(r() * cam.w), Math.floor(r() * 8), 1, 1, ['#ff4060', '#40c0ff', '#ffe040', '#60e060'][i % 4]); }
    if (fireworksUntil > time && Math.random() < 0.08) {
      const fx0 = U.rand(cam.x + 20, cam.x + cam.w - 20), fy0 = U.rand(roofY() - 120, roofY() - 30), col = U.pick(['#ff4060', '#40c0ff', '#ffe040', '#60e060', '#ffffff', '#f080ff']);
      for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2, sp = U.rand(20, 45); parts.push({ x: fx0, y: fy0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: U.rand(1, 1.8), col, size: 1, grav: 20 }); }
      BUS.emit('sound', 'crash');
    }
  }
  // Tables and umbrellas on the pavement in front of shops with a terrace.
  function drawTerraces() {
    for (const side of ['A', 'B']) {
      const u = SIM.unit('G' + side);
      if (!u || !u.shop || !u.shop.terrace || u.work || u.burnt) continue;
      const open = shopOpen(u, hr()), col = SIGN[u.shop.type];
      for (const k of [0, 1]) {
        const x = AX[side] + 34 + k * 62;
        R(x + 7, -24, 1, 22, '#808080');
        for (let i = 0; i < 20; i += 4) R(x - 3 + i, -26 + Math.abs(i - 8) / 4, 4, 3, (i / 4) % 2 ? col : '#f8f4e8');
        R(x, -6, 15, 2, '#e8e0d0'); R(x + 7, -4, 1, 10, '#606060'); R(x + 4, 5, 7, 1, '#606060');
        if (open && !['rain', 'storm', 'snow'].includes(S().weather.type)) {
          const key = 'terr' + u.id + k;
          const c = customers[key] = customers[key] || { m: randomLook({ age: U.irand(18, 80), sex: U.pick(['m', 'f']) }) };
          person(g, x - 9, 6, c.m, { sit: true, face: 1, talk: Math.floor(time + k) % 3 === 0 });
          R(x + 3, -8, 2, 2, '#f0f0f0');
        }
      }
    }
  }
  // Courtyard party, street market or football tournament in front of the building.
  const evPeople = {};
  function drawEvent() {
    const ev = eventOn();
    if (!ev) { for (const k in evPeople) delete evPeople[k]; return; }
    const list = [];
    for (const f of SIM.fams()) if (f.kind !== 'squatter') for (const m of f.members) if (atEvent(m, ev)) list.push(m);
    const x0 = -60, x1 = BW + 60;
    if (ev.type === 'party') {
      for (let x = x0; x < x1; x += 2) { const k = ((x - x0) % 60) / 60, y = -46 + Math.round(Math.sin(k * Math.PI) * 6); R(x, y, 2, 1, '#303030'); if ((x - x0) % 10 === 0) R(x, y + 1, 2, 2, ['#ff4060', '#40c0ff', '#ffe040', '#60e060'][((x - x0) / 10 + Math.floor(time * 2)) % 4]); }
      for (const tx of [40, BW - 70]) { R(tx, -8, 30, 2, '#f0f0f0'); R(tx + 2, -6, 2, 12, '#808080'); R(tx + 26, -6, 2, 12, '#808080'); R(tx + 4, -11, 5, 3, '#e04040'); R(tx + 12, -12, 6, 4, '#f0c040'); R(tx + 21, -10, 4, 2, '#60a040'); }
      if (Math.random() < 0.05) parts.push({ x: U.rand(0, BW), y: -30, vx: 0, vy: -6, life: 2, col: '#8040c0', size: 2 });
    } else if (ev.type === 'market') {
      for (let i = 0; i < 4; i++) {
        const x = -30 + i * 110, col = ['#d03030', '#3060c0', '#30a050', '#e0a020'][i];
        R(x + 2, -26, 2, 26, '#5a3a24'); R(x + 44, -26, 2, 26, '#5a3a24');
        for (let j = 0; j < 48; j += 6) R(x + j, -30, 6, 5, (j / 6) % 2 ? col : '#f8f4e8');
        R(x, -10, 48, 3, '#a07040'); R(x + 2, -7, 44, 7, '#8a5a30');
        for (let j = 0; j < 8; j++) R(x + 3 + j * 5, -13, 4, 3, ['#f04020', '#f0c020', '#60c030', '#c060f0', '#f08030'][(j + i) % 5]);
      }
    } else {
      R(-24, 12, 2, 16, '#f0f0f0'); R(-24, 12, 10, 2, '#f0f0f0'); R(BW + 22, 12, 2, 16, '#f0f0f0'); R(BW + 14, 12, 10, 2, '#f0f0f0');
      const bx = Math.round(BW / 2 + Math.sin(time * 0.9) * (BW / 2 + 10) + Math.sin(time * 2.3) * 20), by = 28 - Math.round(Math.abs(Math.sin(time * 3)) * 6);
      disc(bx, by, 2, '#f8f8f8'); R(bx - 1, by - 1, 1, 1, '#202020');
      list.forEach((m, i) => {
        const p = evPeople[m.id] = evPeople[m.id] || { x: U.rand(0, BW), face: 1 };
        const tx = bx + (i % 2 ? -1 : 1) * (6 + (i * 13) % 40);
        const d = tx - p.x; p.face = d > 0 ? 1 : -1; p.x += Math.sign(d) * Math.min(Math.abs(d), (m.age < 13 ? 22 : 18) * dt);
        person(g, p.x, 30, m, { frame: Math.abs(d) > 1 ? Math.floor(time * 10 + i) % 4 : 0, face: p.face });
      });
      return;
    }
    list.forEach((m, i) => {
      const p = evPeople[m.id] = evPeople[m.id] || { x: U.rand(x0 + 20, x1 - 20), tx: 0, wait: U.rand(0, 3), face: 1 };
      const mv = walk(p, x0 + 20, x1 - 20, ev.type === 'market' ? 8 : 5);
      if (ev.type === 'party' && !mv) person(g, p.x, 6 - (Math.floor(time * 4 + i) % 2), m, { face: p.face, wave: Math.floor(time * 2 + i) % 2 === 0, talk: true });
      else person(g, p.x, 6, m, { frame: mv ? Math.floor(time * 8 + i) % 4 : 0, face: p.face });
    });
  }

  // ---------- street ----------
  function drawStreet() {
    const s = S(), h = hr(), season = SIM.season(), snow = s.weather.type === 'snow';
    const x0 = cam.x - 10, x1 = cam.x + cam.w + 10;
    for (let tx = -50; tx > x0 - 40; tx -= 66) drawTree(tx, season, snow);
    for (let tx = BW + 50; tx < x1 + 40; tx += 66) drawTree(tx, season, snow);
    for (const lx of [-84, BW + 84]) {
      R(lx, -46, 2, 46, '#303038'); R(lx - 6, -46, 8, 2, '#303038'); R(lx - 9, -45, 6, 3, darkness(h) > 0.2 && !s.blackout ? '#fff0b0' : '#808070'); R(lx - 1, -2, 4, 2, '#303038');
    }
    R(x0, 0, x1 - x0, 8, C.sidewalk); for (let x = Math.floor(x0 / 12) * 12; x < x1; x += 12) R(x, 0, 1, 8, '#a09890');
    R(x0, 0, x1 - x0, 1, '#d0c8c0');
    R(x0, 8, x1 - x0, 2, C.curb); R(x0, 10, x1 - x0, 50, C.road);
    for (let x = Math.floor(x0 / 30) * 30; x < x1; x += 30) R(x, 29, 16, 2, C.line);
    for (let i = 0; i < 8; i++) R(BW / 2 - 30 + i * 8, 11, 5, 14, '#d8d0b8');
    if (snow) { R(x0, -1, x1 - x0, 2, '#f4f8ff'); R(x0, 10, x1 - x0, 1, '#e0e8f0'); }
    spawnPedestrians();
    for (const w of walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.toDoor && Math.abs(w.x - (SX + 9)) < 1.5) w.done = true;
      person(g, w.x, 6, w.m, { frame: Math.floor(time * 8 + w.x) % 4, face: w.dir, umbrella: w.umbrella });
      if (w.dog) pet(w.x + (w.dir > 0 ? 10 : -14), 6, 'dog', Math.floor(time * 8) % 2, w.dir);
    }
    drawTerraces();
    drawCity();
    drawEvent();
    drawScenes('street');
    walkers = walkers.filter(w => !w.done && w.x > cam.x - 80 && w.x < cam.x + cam.w + 80);
    drawCars();
    if (s.flood) {
      const lvl = -12 + Math.round(Math.sin(time * 2) * 1.5);
      g.fillStyle = 'rgba(70,110,150,0.75)'; g.fillRect(x0, lvl, x1 - x0, 60 - lvl);
      for (let x = Math.floor(x0 / 10) * 10; x < x1; x += 10) R(x + Math.floor(time * 12) % 10, lvl, 5, 1, 'rgba(200,230,255,0.8)');
    }
  }
  function drawTree(tx, season, snow) {
    R(tx - 2, -26, 4, 26, '#5a3a24'); R(tx - 1, -26, 1, 26, '#7a5234');
    if (season === 'winter') {
      R(tx - 10, -38, 1, 12, '#5a3a24'); R(tx + 9, -40, 1, 14, '#5a3a24'); R(tx - 9, -27, 19, 1, '#5a3a24'); R(tx, -46, 1, 20, '#5a3a24'); R(tx - 5, -44, 1, 8, '#5a3a24'); R(tx + 5, -42, 1, 8, '#5a3a24');
      if (snow) { R(tx - 10, -40, 21, 1, '#f4f8ff'); R(tx - 1, -47, 3, 1, '#f4f8ff'); }
      return;
    }
    const c = season === 'autumn' ? ['#b0602a', '#d08a30', '#e0b040'] : season === 'summer' ? ['#2a7a2a', '#3a9a3a', '#5ab84a'] : ['#3a8a3a', '#4aa84a', '#7ac85a'];
    disc(tx, -40, 16, c[0]); disc(tx - 9, -32, 11, c[0]); disc(tx + 9, -31, 11, c[0]);
    disc(tx - 3, -45, 11, c[1]); disc(tx + 6, -38, 8, c[1]); disc(tx - 7, -49, 5, c[2]); disc(tx + 3, -52, 3, c[2]);
    if (season === 'spring') for (let i = 0; i < 10; i++) R(tx - 12 + ((i * 7) % 24), -52 + ((i * 11) % 24), 2, 2, '#ffb0d0');
    if (season === 'autumn' && Math.random() < 0.02) parts.push({ x: tx + U.rand(-12, 12), y: -40, vx: U.rand(-4, 4), vy: 6, life: 5, col: U.pick(c), size: 1, floor: 6 });
  }
  function spawnPedestrians() {
    const s = S(), h = hr();
    const rate = (h > 7 && h < 21 ? 0.35 : 0.06) * (s.weather.type === 'storm' ? 0.3 : 1);
    if (walkers.length < 16 && Math.random() < rate * dt) {
      const dir = U.chance(0.5) ? 1 : -1;
      walkers.push({ x: dir > 0 ? cam.x - 20 : cam.x + cam.w + 20, dir, speed: U.rand(12, 20), m: randomLook({ age: U.irand(8, 85), sex: U.pick(['m', 'f']) }), umbrella: umbrella(), dog: U.chance(0.12) });
    }
  }
  function umbrella() { return ['rain', 'storm'].includes(S().weather.type) ? U.pick(['#d03030', '#3050c0', '#202020', '#e0c020', '#40a060']) : null; }
  function spawnWalker(m, leaving) {
    if (walkers.length > 28) return;
    const door = SX + 9;
    if (leaving) walkers.push({ x: door, dir: U.chance(0.5) ? 1 : -1, speed: U.rand(12, 16), m, umbrella: umbrella() });
    else { const x = U.chance(0.5) ? cam.x - 10 : cam.x + cam.w + 10; walkers.push({ x, dir: x < door ? 1 : -1, speed: U.rand(12, 16), m, umbrella: umbrella(), toDoor: true }); }
  }

  // ---------- vehicles ----------
  const CAR_W = { film: 56, tv: 46, car: 34, van: 52, police: 36, firetruck: 64, ambulance: 46, repair: 48, blackcar: 38, hearse: 48, truck: 58, bus: 90 };
  function addCar(type, hours, apt) {
    const dir = U.chance(0.5) ? 1 : -1;
    const taken = cars.filter(c => c.lane === 1).map(c => c.park);
    let park = null;
    for (const p of U.shuffle([40, 110, 180, 250, 320, -60, 410])) if (!taken.some(t => Math.abs(t - p) < 66)) { park = p; break; }
    if (park == null) return; // no free spot: the vehicle stays out of view
    cars.push({ type, x: dir > 0 ? cam.x - 80 : cam.x + cam.w + 80, dir, park, leave: S().t + hours, apt, lane: 1 });
  }
  function drawCars() {
    const s = S();
    const busy = s.t % 24 > 6 && s.t % 24 < 23 ? 1 : 0.3;
    const match = (eventOn() && eventOn().type === 'football') || (S().city && S().city.roadworks > SIM.day());
    if (!match && Math.random() < 0.14 * dt * busy && cars.filter(c => c.lane === 0).length < 3) {
      const dir = U.chance(0.5) ? 1 : -1, type = U.chance(0.08) ? 'bus' : 'car';
      cars.push({ type, x: dir > 0 ? cam.x - 100 : cam.x + cam.w + 100, dir, lane: 0, col: U.pick(['#c03030', '#3060c0', '#e0e0e0', '#303030', '#e0a020', '#40a060', '#8040a0']) });
    }
    for (const c of cars) {
      const w = CAR_W[c.type];
      if (c.lane === 0) c.x += c.dir * (c.type === 'bus' ? 45 : 65) * dt;
      else if (s.t < c.leave) { const d = c.park - c.x; c.x += Math.sign(d) * Math.min(Math.abs(d), 60 * dt); }
      else c.x += c.dir * 65 * dt;
      drawCar(c, Math.round(c.x - w / 2), c.lane === 0 ? 27 : 46, w);
    }
    cars = cars.filter(c => (c.x > cam.x - 160 && c.x < cam.x + cam.w + 160) || (c.lane === 1 && s.t < c.leave));
  }
  function drawCar(c, x, yb, w) {
    const fl = Math.floor(time * 6) % 2, right = c.dir > 0;
    const wheel = (wx) => { disc(wx, yb - 3, 3, '#181818'); disc(wx, yb - 3, 1, '#a0a0a0'); };
    const front = right ? x + w - 2 : x;
    if (c.type === 'car' || c.type === 'police' || c.type === 'blackcar') {
      const col = c.type === 'police' ? '#f4f4f4' : c.type === 'blackcar' ? '#181820' : c.col;
      R(x, yb - 10, w, 6, col); R(x + 1, yb - 10, w - 2, 1, U.shade(col, 0.25));
      R(x + 7, yb - 16, w - 14, 6, col); R(x + 9, yb - 15, w - 18, 4, c.type === 'blackcar' ? '#303040' : '#a0d0f0'); R(x + Math.round(w / 2), yb - 15, 1, 4, col);
      R(x, yb - 5, w, 1, U.shade(col, -0.3));
      if (c.type === 'police') { R(x, yb - 9, w, 3, '#2040a0'); R(x + w / 2 - 5, yb - 18, 5, 2, fl ? '#ff2020' : '#802020'); R(x + w / 2, yb - 18, 5, 2, fl ? '#4040a0' : '#40a0ff'); }
      R(front, yb - 9, 2, 2, '#fff0a0'); R(right ? x : x + w - 2, yb - 9, 2, 2, '#e04040');
      wheel(x + 7); wheel(x + w - 8);
    } else if (c.type === 'bus') {
      R(x, yb - 22, w, 18, '#e0a020'); R(x, yb - 22, w, 2, '#f0c040'); for (let i = x + 4; i < x + w - 6; i += 10) R(i, yb - 19, 8, 7, '#a0d0f0');
      R(x, yb - 9, w, 2, '#c08010'); PIX.text(g, '26', right ? x + w - 12 : x + 4, yb - 8, '#3a2a1a'); wheel(x + 12); wheel(x + w - 14);
    } else if (c.type === 'firetruck') {
      R(x, yb - 16, w, 12, '#d02020'); R(x, yb - 16, w, 1, '#f04040'); R(x + 2, yb - 20, w - 18, 3, '#c0c0c0'); for (let i = 0; i < w - 18; i += 4) R(x + 2 + i, yb - 20, 1, 3, '#808080');
      const cab = right ? x + w - 14 : x; R(cab, yb - 22, 14, 7, '#d02020'); R(cab + 2, yb - 21, 10, 4, '#a0d0f0'); R(cab + 4, yb - 24, 6, 2, fl ? '#4080ff' : '#ff3030');
      R(x, yb - 9, w, 1, '#f0f0f0'); wheel(x + 9); wheel(x + 24); wheel(x + w - 10);
      const u = c.apt && SIM.unit(c.apt);
      if (u && S().t < c.leave && Math.abs(c.x - c.park) < 1) {
        const { rx, fy } = room(u);
        const tx = u.side === 'A' ? -10 : BW + 10, ty = fy - 10, sx0 = x + w / 2, sy0 = yb - 20;
        const n = Math.max(Math.abs(tx - sx0), Math.abs(ty - sy0));
        for (let i = 0; i < n; i++) { const px = Math.round(sx0 + (tx - sx0) * i / n), py = Math.round(sy0 + (ty - sy0) * i / n); R(px, py, 2, 1, '#c0c0c0'); if (i % 4 === 0) R(px, py - 1, 2, 3, '#a0a0a0'); }
        if (u.fire && Math.random() < 0.7) parts.push({ x: tx, y: ty, vx: (rx + 75 - tx) * U.rand(0.6, 1.1), vy: -20, life: 1, col: '#70b0ff', size: 2, grav: 30 });
      }
    } else if (c.type === 'truck') {
      const cab = right ? x + w - 14 : x, box = right ? x : x + 14;
      R(cab, yb - 18, 14, 13, '#e0a020'); R(cab + 2, yb - 17, 10, 5, '#a0d0f0');
      R(box, yb - 8, w - 14, 3, '#606060');
      const dx = Math.round(box + (w - 14) / 2); disc(dx, yb - 15, 9, '#d0d0d0'); for (let i = 0; i < 3; i++) { const a = time * 2 + i * 2.1; R(Math.round(dx + Math.cos(a) * 6), Math.round(yb - 15 + Math.sin(a) * 6), 2, 2, '#e08020'); }
      wheel(x + 8); wheel(Math.round(x + w / 2)); wheel(x + w - 9);
    } else {
      const col = { van: '#f0ece0', ambulance: '#f8f8f8', repair: '#f09030', hearse: '#202024', film: '#303034', tv: '#f0f0f4' }[c.type];
      const cab = right ? x + w - 14 : x, box = right ? x : x + 14;
      R(box, yb - 24, w - 14, 20, col); R(box, yb - 24, w - 14, 1, U.shade(col, 0.2)); R(cab, yb - 16, 14, 12, c.type === 'van' ? '#3a6ab0' : col);
      R(right ? cab + 5 : cab + 1, yb - 15, 8, 5, '#a0d0f0');
      if (c.type === 'van') { PIX.text(g, 'MOVING', box + 6, yb - 18, '#3a6ab0'); R(box + 4, yb - 11, w - 22, 1, '#3a6ab0'); }
      if (c.type === 'repair') { PIX.text(g, 'BUILD', box + 8, yb - 18, '#ffffff'); R(box, yb - 10, w - 14, 2, '#303030'); }
      if (c.type === 'ambulance') { R(box + 14, yb - 21, 4, 12, '#e02020'); R(box + 10, yb - 17, 12, 4, '#e02020'); R(cab + 5, yb - 19, 4, 3, fl ? '#ff2020' : '#4040ff'); }
      if (c.type === 'film') { PIX.text(g, 'FILM', box + 10, yb - 18, '#ffe040'); R(box + 4, yb - 12, w - 22, 1, '#ffe040'); }
      if (c.type === 'tv') { PIX.text(g, 'TV NEWS', box + 3, yb - 18, '#d03030'); R(box + 12, yb - 30, 1, 6, '#808080'); disc(box + 12, yb - 32, 3, '#e0e0e0'); }
      if (c.type === 'hearse') { R(box + 3, yb - 21, w - 20, 6, '#303038'); R(box + 6, yb - 19, 5, 3, '#e0e0e0'); }
      wheel(x + 8); wheel(x + w - 9);
      if (c.type === 'van' && Math.abs(c.x - c.park) < 1 && S().t < c.leave) {
        const k = (time * 0.35) % 1, bx = Math.round(c.x + (SX + 9 - c.x) * (k < 0.5 ? k * 2 : 2 - k * 2));
        const mover = { age: 30, sex: 'm', skin: '#c98e62', hair: '#1a1a1a', shirt: '#3a6ab0', pants: '#2a2a3a', shoes: '#202020', style: 'short' };
        const toward = SX > c.x ? 1 : -1;
        person(g, bx, 6, mover, { frame: Math.floor(time * 8) % 4, face: k < 0.5 ? toward : -toward, carry: k < 0.5 ? '#c09060' : null });
      }
    }
  }

  // ---------- effects ----------
  const ICONS = {
    heart: ['.#.#.', '#####', '#####', '.###.', '..#..'], angry: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
    money: ['.###.', '#.#..', '.###.', '..#.#', '.###.'], note: ['..##.', '..#.#', '..#..', '###..', '###..'],
    sad: ['..#..', '.###.', '#####', '#####', '.###.'], excl: ['..#..', '..#..', '..#..', '.....', '..#..'],
    question: ['.###.', '#...#', '..##.', '.....', '..#..'], zz: ['####.', '..#..', '.#...', '####.', '.....']
  };
  const ICOL = { heart: '#ff3060', angry: '#e02020', money: '#d0a000', note: '#8040c0', sad: '#3080e0', excl: '#e08000', question: '#8040c0', zz: '#5060a0' };
  function addIcon(id, icon) {
    const u = id && SIM.unit(id);
    if (!u || icons.length > 40 || !ICONS[icon]) return;
    const { rx, ry } = room(u);
    icons.push({ x: rx + U.irand(14, 130), y: ry + 26, icon, t: 0 });
  }
  function drawIcons() {
    for (const i of icons) {
      i.t += dt;
      const y = Math.round(i.y - i.t * 7);
      ctx.globalAlpha = i.t > 2 ? Math.max(0, 1 - (i.t - 2)) : 1;
      ctx.fillStyle = '#2a1a1a'; ctx.fillRect(i.x - 1, y - 1, 11, 11); ctx.fillRect(i.x + 1, y + 10, 3, 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(i.x, y, 9, 9); ctx.fillRect(i.x + 2, y + 9, 1, 1);
      PIX.spr(ctx, i.x + 2, y + 2, ICONS[i.icon], { '#': ICOL[i.icon] });
      ctx.globalAlpha = 1;
    }
    icons = icons.filter(i => i.t < 3);
  }
  function confetti(id) {
    const u = SIM.unit(id); if (!u) return;
    const { rx, ry } = room(u);
    for (let i = 0; i < 70; i++) parts.push({ x: rx + 75, y: ry + 14, vx: U.rand(-60, 60), vy: U.rand(-70, -10), life: U.rand(1.5, 3), col: U.pick(['#ff4060', '#40c0ff', '#ffe040', '#60e060', '#ffffff']), size: U.irand(1, 2), grav: 70 });
  }
  function debris(n) { for (let i = 0; i < n; i++) parts.push({ x: U.chance(0.5) ? U.rand(0, 6) : BW - U.rand(0, 6), y: U.rand(roofY(), -40), vx: U.rand(-14, 14), vy: 0, life: 2.5, col: U.pick([C.facade, C.facadeDk, '#a08070']), size: U.irand(1, 3), grav: 140, floor: 6 }); }
  function scarePigeons() { for (const p of pigeons) if (p.fly <= 0) p.fly = U.rand(2, 4); }
  function drawParts() {
    for (const p of parts) {
      p.life -= dt; p.vy += (p.grav || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.floor !== undefined && p.y > p.floor) { p.y = p.floor; p.vx = 0; p.vy = 0; }
      ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    parts = parts.filter(p => p.life > 0);
    if (parts.length > 900) parts.splice(0, parts.length - 900);
  }
  function drawFire(u, rx, ry, fy) {
    g.fillStyle = 'rgba(40,20,10,0.55)'; g.fillRect(rx, ry, AW, 56);
    for (let i = 0; i < 24; i++) {
      const x = rx + 2 + i * 6 + U.irand(-1, 1), hgt = U.irand(10, 40);
      R(x, fy - hgt, 5, hgt, '#d03010'); R(x + 1, Math.round(fy - hgt * 0.7), 3, Math.round(hgt * 0.7), '#f08020'); R(x + 1, Math.round(fy - hgt * 0.35), 3, Math.round(hgt * 0.35), '#ffe060');
    }
    if (Math.random() < 0.8) parts.push({ x: (u.side === 'A' ? -6 : BW + 6) + U.rand(-4, 4), y: ry + U.rand(0, 16), vx: U.rand(-3, 3) + (u.side === 'A' ? -4 : 4), vy: U.rand(-18, -10), life: U.rand(2, 4), col: U.pick(['rgba(60,60,60,0.7)', 'rgba(90,90,90,0.6)', 'rgba(40,40,40,0.8)']), size: U.irand(2, 4) });
  }
  function drawWeather() {
    const s = S(), w = s.weather.type, W = cam.w, H = cam.h;
    const bx0 = -1 - cam.x, bx1 = BW + 1 - cam.x, by0 = roofY() - 10 - cam.y, by1 = -cam.y;
    const inside = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y < by1;
    if (w === 'rain' || w === 'storm' || hailUntil > time) {
      const hail = hailUntil > time, n = Math.round((w === 'storm' ? 220 : 130) * W / 400), slant = w === 'storm' ? 3 : 1;
      ctx.fillStyle = hail ? '#ffffff' : 'rgba(170,200,240,0.7)';
      for (let i = 0; i < n; i++) {
        const x = (i * 37.7 + time * 40 * slant) % (W + 20) - 10, y = (i * 53.3 + time * (hail ? 300 : 230)) % (H + 10) - 10;
        if (inside(x, y)) continue;
        if (hail) ctx.fillRect(Math.round(x), Math.round(y), 2, 2); else ctx.fillRect(Math.round(x), Math.round(y), 1, 4);
      }
    }
    if (w === 'snow') {
      ctx.fillStyle = '#ffffff';
      const n = Math.round(150 * W / 400);
      for (let i = 0; i < n; i++) {
        const y = (i * 41.3 + time * 20) % (H + 10) - 5, x = (i * 67.1 + Math.sin(time + i) * 8 + time * 5) % W;
        if (inside(x, y)) continue;
        ctx.fillRect(Math.round(x), Math.round(y), i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
      }
    }
    if (w === 'fog') {
      for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(210,215,220,0.22)'; ctx.fillRect(((time * 8 + i * W / 3) % (W + 300)) - 300, H * 0.35 + i * H * 0.12, 320, 18); }
      ctx.fillStyle = 'rgba(200,205,210,0.18)'; ctx.fillRect(0, 0, W, H);
    }
    if (w === 'heatwave') { ctx.fillStyle = 'rgba(255,160,60,0.07)'; ctx.fillRect(0, 0, W, H); }
  }
  function drawLights(h) {
    const s = S(), dk = darkness(h);
    if (dk < 0.15) return;
    ctx.globalCompositeOperation = 'lighter';
    if (!s.blackout) for (const lx of [-84, BW + 84]) {
      ctx.fillStyle = 'rgba(255,220,140,' + (dk * 0.2).toFixed(2) + ')';
      for (let y = -42; y < 8; y++) { const w = (y + 42) * 0.55 + 3; ctx.fillRect(lx - 6 - w / 2, y, w, 1); }
    }
    if (dk > 0.35) for (const c of cars) if (['police', 'ambulance', 'firetruck'].includes(c.type) && Math.floor(time * 6) % 2) { ctx.fillStyle = 'rgba(255,60,60,0.12)'; ctx.fillRect(c.x - 16, 20, 32, 26); }
    for (const u of units()) {
      const { rx, ry } = room(u);
      if (u.fire) { ctx.fillStyle = 'rgba(255,120,30,0.14)'; ctx.fillRect(rx - 20, ry - 6, AW + 40, 66); continue; }
      if (!unitLit(u, h)) continue;
      const f = famOf(u);
      ctx.fillStyle = f && f.kind === 'squatter' ? 'rgba(255,150,40,0.06)' : 'rgba(255,200,110,' + (dk * 0.1).toFixed(2) + ')';
      ctx.fillRect(rx, ry, AW, 56);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- speech bubbles and money ----------
  // Where to draw something about a unit: above a resident at home, or in the middle of the room.
  function anchor(id, pick) {
    const u = SIM.unit(id);
    if (!u) return null;
    const { rx, ry, fy } = room(u), f = famOf(u);
    if (f) {
      const home = f.members.filter(m => people[m.id] && prevState[m.id] === 'home' && m.age >= 3);
      if (home.length) { const m = home[Math.floor(pick * home.length)], p = people[m.id]; return { x: p.balc > 0 ? (u.side === 'A' ? -11 : BW + 11) : p.x + 4, y: fy - (m.age < 13 ? 13 : 19), rx, ry }; }
    }
    return { x: rx + 75, y: ry + 22, rx, ry };
  }
  function drawBubbles() {
    const fast = speedNow >= 10, ttl = fast ? 1.6 : 3;
    for (const b of bubbles) {
      b.t += dt;
      if (b.t < 0) continue;
      const a = anchor(b.apt, b.pick);
      if (!a) { b.t = ttl; continue; }
      const w = b.text.length * 4 + 5, rise = Math.min(3, b.t * 8);
      const bx = Math.round(U.clamp(a.x - w / 2, a.rx - 18, a.rx + AW + 18 - w)), by = Math.round(a.y - 14 - rise);
      ctx.globalAlpha = b.t > ttl - 0.4 ? Math.max(0, (ttl - b.t) / 0.4) : Math.min(1, b.t * 6);
      ctx.fillStyle = '#2a1a1a'; ctx.fillRect(bx - 1, by - 1, w + 2, 11); ctx.fillRect(Math.round(a.x) - 1, by + 10, 3, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, by, w, 9); ctx.fillRect(Math.round(a.x), by + 9, 1, 3);
      PIX.text(ctx, b.text, bx + 3, by + 2, '#2a1a1a');
      ctx.globalAlpha = 1;
    }
    bubbles = bubbles.filter(b => b.t < ttl);
  }
  function drawFloats() {
    for (const f of floats) {
      f.t += dt;
      if (f.t < 0) continue;
      let x, y;
      if (f.apt) { const u = SIM.unit(f.apt); if (!u) { f.t = 9; continue; } const r = room(u); x = r.rx + 75; y = r.ry + 26; }
      else { x = BW / 2; y = roofY() - 24; }
      const txt = f.amount > 0 ? '+' + U.money(f.amount) : f.amount < 0 ? '-' + U.money(-f.amount) : 'LATE!';
      const col = f.amount > 0 ? '#60f080' : f.amount < 0 ? '#ff6050' : '#ffb030';
      const w = txt.length * 4 - 1, tx = Math.round(x - w / 2), ty = Math.round(y - f.t * 9);
      ctx.globalAlpha = f.t > 2 ? Math.max(0, 1 - (f.t - 2) / 0.6) : 1;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) PIX.text(ctx, txt, tx + ox, ty + oy, '#1a1020');
      PIX.text(ctx, txt, tx, ty, col);
      ctx.globalAlpha = 1;
    }
    floats = floats.filter(f => f.t < 2.6);
  }

  // ---------- staged scenes ----------
  const COP = { age: 35, sex: 'm', skin: '#e8b88f', hair: '#2b1d14', shirt: '#203060', pants: '#1a2040', shoes: '#101010', style: 'short' };
  const COP2 = { ...COP, skin: '#a86b44', beard: true };
  const DUR = { wedding: 11, fight: 6, raid: 10 };
  function drawScenes(layer) {
    for (const sc of scenes) {
      if (layer === 'building') sc.t += dt;
      const t = sc.t, door = SX + 9;
      if (sc.type === 'wedding' && layer === 'street') {
        const dress = (m) => m.sex === 'f' ? { ...m, shirt: '#ffffff', dress: true, shoes: '#ffffff' } : { ...m, shirt: '#1a1a1a', pants: '#1a1a1a', shoes: '#101010' };
        const walkX = door + Math.max(0, Math.min(70, (t - 1) * 10));
        sc.guests.forEach((m, i) => {
          const gx = door - 44 + i * 22 + (i >= 3 ? 46 : 0);
          person(g, gx, 6, m, { face: gx < walkX ? 1 : -1, wave: Math.floor(time * 3 + i) % 2 === 0 });
          if (Math.random() < 0.12) parts.push({ x: gx + 4, y: -14, vx: U.rand(-20, 20), vy: U.rand(-30, -10), life: 1.6, col: U.pick(['#ff4060', '#40c0ff', '#ffe040', '#ffffff']), size: 1, grav: 50 });
        });
        person(g, walkX, 6, dress(sc.a), { face: 1, frame: t > 1 && t < 8 ? Math.floor(time * 6) % 4 : 0 });
        person(g, walkX + 10, 6, dress(sc.b), { face: 1, frame: t > 1 && t < 8 ? Math.floor(time * 6 + 2) % 4 : 0, wave: t > 8 });
        // The wedding car, with tin cans.
        const cx = door + 90;
        const cy = -15; // far lane, clear of the parked vans
        R(cx, 36 + cy, 40, 6, '#f4f4f4'); R(cx + 8, 30 + cy, 22, 6, '#f4f4f4'); R(cx + 10, 31 + cy, 18, 4, '#a0d0f0'); disc(cx + 8, 43 + cy, 3, '#181818'); disc(cx + 32, 43 + cy, 3, '#181818');
        R(cx + 2, 33 + cy, 6, 3, '#ff6080'); R(cx + 30, 33 + cy, 6, 3, '#ff6080');
        for (let i = 0; i < 3; i++) { R(cx - 6 - i * 6, 41 + cy, 1, 1, '#808080'); R(cx - 8 - i * 6, 40 + cy, 3, 3, '#c0c0c0'); }
        PIX.text(g, 'JUST MARRIED', cx - 4, 21 + cy, '#ffffff');
      }
      if (sc.type === 'fight' && layer === 'building') {
        const fy = floorTop(sc.floor) + SLAB + 53, sh = Math.floor(time * 12) % 2;
        person(g, SX + 5 + sh, fy, sc.a, { face: 1, wave: Math.floor(time * 4) % 2 === 0, talk: true });
        person(g, SX + 20 - sh, fy, sc.b, { face: -1, wave: Math.floor(time * 4 + 1) % 2 === 0, talk: true });
        if (Math.random() < 0.1) parts.push({ x: SX + 17, y: fy - 22, vx: U.rand(-8, 8), vy: -10, life: 0.8, col: '#ff3030', size: 2 });
      }
      if (sc.type === 'raid') {
        const u = SIM.unit(sc.apt);
        if (!u) { sc.t = 99; continue; }
        const { rx, fy } = room(u);
        if (t < 2.5 && layer === 'street') {
          const k = t / 2.5, x = door + 90 - 90 * k;
          person(g, x, 6, COP, { face: -1, hat: '#1a2040', frame: Math.floor(time * 8) % 4 });
          person(g, x + 12, 6, COP2, { face: -1, hat: '#1a2040', frame: Math.floor(time * 8 + 2) % 4 });
        } else if (t >= 2.5 && t < 6 && layer === 'building') {
          const fl = Math.min(u.floor, 1 + Math.floor((t - 2.5) / 3.5 * u.floor)), sfy = floorTop(fl) + SLAB + 53;
          person(g, SX + 4 + Math.floor(time * 6) % 3, sfy, COP, { face: 1, hat: '#1a2040', frame: Math.floor(time * 8) % 4 });
          person(g, SX + 16, sfy, COP2, { face: 1, hat: '#1a2040', frame: Math.floor(time * 8 + 2) % 4 });
        } else if (t >= 6 && layer === 'building') {
          person(g, rx + 34, fy, COP, { face: 1, hat: '#1a2040', wave: Math.floor(time * 2) % 2 === 0 });
          if (sc.suspect) person(g, rx + 46, fy, sc.suspect, { face: -1, talk: true });
          person(g, rx + 58, fy, COP2, { face: -1, hat: '#1a2040' });
        }
      }
    }
    if (layer === 'building') scenes = scenes.filter(sc => sc.t < DUR[sc.type]);
  }

  // ---------- plane ----------
  function drawPlane() {
    if (!plane) return;
    plane.t += dt;
    const p = plane;
    if (p.crash) {
      const k = Math.min(1, p.t / 4), tx = BW * 0.55, ty = p.y0 - 10;
      if (!p.sx) { p.sx = cam.x + cam.w + 60; p.sy = cam.y + 10; }
      const x = p.sx + (tx - p.sx) * k, y = p.sy + (ty - p.sy) * k * k;
      if (k < 1) {
        planeSprite(x, y, true);
        if (Math.random() < 0.9) parts.push({ x: x + 40, y: y + 4, vx: U.rand(5, 20), vy: U.rand(-6, 0), life: 2, col: 'rgba(60,60,60,0.7)', size: 4 });
      } else if (!p.boom) {
        p.boom = true; flash = 0.9; shake = { until: time + 3, mag: 5 };
        BUS.emit('sound', 'explosion');
        for (let i = 0; i < 220; i++) parts.push({ x: tx + U.rand(-50, 50), y: ty + U.rand(-10, 60), vx: U.rand(-110, 110), vy: U.rand(-120, 10), life: U.rand(1, 3.5), col: U.pick(['#ffe060', '#f08020', '#d03010', '#606060', C.facade]), size: U.irand(1, 4), grav: 100, floor: 6 });
        SIM.crashDone();
      }
      if (p.boom && p.t < 12) for (let i = 0; i < 3; i++) parts.push({ x: U.rand(20, BW - 20), y: roofY() - 4, vx: U.rand(-3, 6), vy: U.rand(-20, -8), life: U.rand(2, 5), col: U.pick(['rgba(50,50,50,0.7)', 'rgba(80,80,80,0.6)', '#f08020']), size: U.irand(2, 5) });
      if (p.t > 12) plane = null;
    } else {
      const k = p.t / 5;
      if (!p.sx) p.sx = cam.x + cam.w + 60;
      planeSprite(p.sx - (cam.w + 200) * k, p.y0 - 40 - Math.sin(k * Math.PI) * 30, false);
      if (k > 1) plane = null;
    }
  }
  function planeSprite(x, y, burning) {
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = '#e8e8ee'; ctx.fillRect(x, y, 52, 9); ctx.fillRect(x - 4, y + 2, 4, 5);
    ctx.fillStyle = '#c03030'; ctx.fillRect(x, y + 6, 52, 2);
    ctx.fillStyle = '#e8e8ee'; ctx.fillRect(x + 40, y - 10, 10, 10); ctx.fillRect(x + 16, y + 8, 18, 4); ctx.fillRect(x + 20, y - 4, 12, 4);
    ctx.fillStyle = '#3a5a8a'; for (let i = 4; i < 36; i += 4) ctx.fillRect(x + i, y + 2, 2, 2);
    ctx.fillStyle = '#808890'; ctx.fillRect(x + 20, y + 12, 8, 3);
    if (burning) { ctx.fillStyle = Math.random() < 0.5 ? '#ff8020' : '#ffd040'; ctx.fillRect(x + 26, y + 10, 5, 6); }
  }

  // ---------- frame ----------
  function frame(now, speed) {
    dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now; time += dt; speedNow = speed;
    const s = S();
    if (!s) return;
    const h = hr();
    skyNow = skyColors(h);
    applyLook();
    festNow = SIM.festivity();
    updateCam();
    let ox = 0, oy = 0;
    if (shake && shake.until > time) { ox = Math.round(U.rand(-1, 1) * shake.mag); oy = Math.round(U.rand(-1, 1) * shake.mag * 0.5); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSky(h);
    ctx.setTransform(1, 0, 0, 1, -cam.x + ox, -cam.y + oy);
    drawSkyline(h);
    // Two layers: the building, and the street in front of it (passers-by, cars, trees, flood water).
    for (const c of [sx, st]) { c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cam.w, cam.h); c.setTransform(1, 0, 0, 1, -cam.x + ox, -cam.y + oy); }
    g = sx;
    drawBuilding();
    g = st;
    drawStreet();
    // Night: darken both layers, leaving lit homes and shops bright.
    const dk = darkness(h);
    if (dk > 0.01) {
      const night = 'rgba(12,16,44,' + dk.toFixed(2) + ')';
      sx.save();
      sx.globalCompositeOperation = 'source-atop';
      sx.beginPath(); sx.rect(cam.x - 20, cam.y - 20, cam.w + 40, cam.h + 40);
      for (const u of units()) if (unitLit(u, h)) { const { rx, ry } = room(u); sx.rect(rx, ry, AW, 56); }
      sx.fillStyle = night;
      sx.fill('evenodd');
      sx.restore();
      st.save();
      st.globalCompositeOperation = 'source-atop';
      st.fillStyle = night; st.fillRect(cam.x - 20, cam.y - 20, cam.w + 40, cam.h + 40);
      st.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(scn, 0, 0);
    ctx.setTransform(1, 0, 0, 1, -cam.x + ox, -cam.y + oy);
    g = ctx;
    drawLights(h);
    // Selection and hover outlines sit on the building, behind the street.
    for (const [id, col] of [[hover, 'rgba(255,255,255,0.6)'], [sel, Math.floor(time * 3) % 2 ? '#ffe040' : '#ffb000']]) {
      const u = id && SIM.unit(id);
      if (!u) continue;
      const { rx, ry } = room(u);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, ry + 0.5, AW - 1, 55);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(stc, 0, 0);
    ctx.setTransform(1, 0, 0, 1, -cam.x + ox, -cam.y + oy);
    drawParts();
    drawPlane();
    drawIcons();
    drawFloats();
    drawBubbles();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawWeather();
    if (bolt && bolt.until > time) {
      ctx.fillStyle = '#ffffe0';
      let x = bolt.strike ? BW - 70 - cam.x : bolt.x * cam.w, y = 0;
      const ty = bolt.strike ? roofY() - 32 - cam.y : U.irand(Math.round(cam.h * 0.2), Math.round(cam.h * 0.5));
      while (y < ty) { const nx = x + U.irand(-6, 6), ny = Math.min(ty, y + U.irand(5, 12)); for (let yy = y; yy < ny; yy++) ctx.fillRect(Math.round(x + (nx - x) * (yy - y) / (ny - y)), yy, 2, 1); x = nx; y = ny; }
    }
    if (flash > 0) { ctx.fillStyle = 'rgba(255,255,240,' + Math.min(0.8, flash).toFixed(2) + ')'; ctx.fillRect(0, 0, cam.w, cam.h); flash -= dt * 1.5; }
    g = sx;
  }

  // Map view coordinates (CSS pixels inside the canvas) to a unit id, 'building' or null.
  function hit(px, py) {
    const s = S(); if (!s) return null;
    const [x, y] = toWorld(px, py);
    for (const u of units()) {
      const { rx, ry } = room(u);
      if (x >= rx && x < rx + AW && y >= ry - SLAB && y < ry + 56) return u.id;
      const bx = u.side === 'A' ? -20 : BW;
      if (u.floor > 0 && x >= bx && x < bx + 20 && y >= ry + 30 && y < ry + 56) return u.id;
    }
    if (x >= -4 && x <= BW + 4 && y >= regionTop() && y <= 0) return 'building';
    return null;
  }

  return {
    // Test hook: put a plane, a helicopter or a shooting star in the sky right now.
    spawnSky(type) { const gy = -cam.y; skyObjs.push(type === 'star' ? { type, x: cam.w * 0.5, y: gy * 0.15, vx: 90, vy: 40, t: 0 } : { type, x: cam.w * 0.3, y: gy * (type === 'plane' ? 0.18 : 0.42), vx: type === 'plane' ? 18 : 12, bob: 0 }); },
    init, reset, frame, hit, resize, zoomAt, pan, get zoom() { return zoom; }, resetZoom() { zoom = 1; },
    set sel(v) { sel = v; }, get sel() { return sel; }, set hover(v) { hover = v; },
    // Used by the portraits in the side panel.
    drawPerson(c, x, fy, m, o) { person(c, x, fy, m, o || {}); }
  };
})();
