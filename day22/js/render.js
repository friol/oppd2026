'use strict';
// Drawing of backgrounds, tiles, portals, particles and the HUD.

const VIEW_W = 960, VIEW_H = 540;

// Terrain sets in the forest pack (img/forest/Tiles.png, 16 px cells used at 2x): cell rows for the
// grass/stone overhang above the top (cap), top, middle and bottom; cell columns for the edges.
const TERRAIN = {
  // l / r use the fully opaque, flat-edged columns (1 and 3): the rounded edge tiles are partly
  // transparent, which made the portals (placed on the exact tile plane) look detached
  grass: { cap: 0, top: 1, mid: [2, 3], bot: 4, l: 1, m: [1, 2, 3], r: 3 },
  stone: { cap: null, top: 12, mid: [13], bot: 13, l: 10, m: [11], r: 12 },   // mossy brick wall (flat, opaque edges)
  moss: { cap: null, top: 11, mid: [12, 13], bot: 13, l: 0, m: [1, 2], r: 3 },
  ruin: { cap: null, top: 12, mid: [13], bot: 13, l: 10, m: [11], r: 12 },
  // Central City pack (img/city/Tiles.png): cracked asphalt and the framed lavender panel
  city: { p: 'ct_', cap: null, top: 7, mid: [8], bot: 8, l: 4, m: [4, 5], r: 5 },
  panel: { p: 'ct_', cap: null, top: 4, mid: [5], bot: 6, l: 2, m: [3], r: 4 }
};
const FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

const RENDER = {
  // Parallax background (forest pack): sky with clouds, far and near fir trees, per-world tints.
  // horizon = screen y of the usual ground level.
  // anim: also draw the moving effects (mist, leaves, dust, drops); the editor leaves it off.
  background(ctx, theme, camx, horizon, anim) {
    const lift = horizon - 412, tm = performance.now() / 1000;
    // drift: px/s the layer also moves by itself (the fog bands of the city)
    const layer = (name, par, bottom, vpar, drift) => {
      const im = SPR.img[name];
      if (!im || !im.width) return;
      const y = bottom - im.height + lift * vpar;
      let x = -((camx * par + (anim && drift ? tm * drift : 0)) % im.width);
      if (x > 0) x -= im.width;
      for (; x < VIEW_W; x += im.width) ctx.drawImage(im, Math.round(x), Math.round(y));
    };
    ctx.fillStyle = theme.sky; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (theme.city) {
      // Central City: purple sky, moon, two skylines and two bands of fog
      layer('bg_city_sky', 0.02, VIEW_H + 60 + lift * 0.05, 0);
      const mx = 690 - ((camx * 0.01) % 1200);
      SPR.draw(ctx, 'ct_moon', mx, 70 + lift * 0.05);
      layer('bg_city_far', 0.06, 420, 0.25);
      layer('bg_fog_mid', 0.08, 470, 0.3, 9);
      layer('bg_city_near', 0.15, 470, 0.45);
      layer('bg_fog_front', 0.2, 560, 0.6, 20);
      return;
    }
    layer('bg_sky', 0.03, VIEW_H + Math.min(0, lift * 0.04), 0);
    if (theme.skyTint) { ctx.fillStyle = theme.skyTint; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    if (theme.stars) RENDER.stars(ctx, camx);
    layer('bg_far', 0.12, 430, 0.35);
    if (theme.farTint) { ctx.fillStyle = theme.farTint; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    layer('bg_near', 0.28, 475, 0.6);
    if (anim) AMB.back(ctx, theme, camx, horizon, tm);
    if (theme.tint) { ctx.fillStyle = theme.tint; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  },
  // Clouds drawn at 1/2 resolution and scaled up without smoothing, so they are pixel art too
  clouds(ctx, camx, lift) {
    const K = 2;
    if (!RENDER.cloudCv) { RENDER.cloudCv = document.createElement('canvas'); RENDER.cloudCv.width = VIEW_W / K; RENDER.cloudCv.height = VIEW_H / K; }
    const cv = RENDER.cloudCv, c = cv.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 7; i++) {
      const w = 1400;
      const x = Math.round((((i * 260 + 90 - camx * 0.04 - performance.now() * 0.004) % w + w) % w - 200) / K);
      const y = Math.round((50 + ((i * 53) % 110) + lift * 0.05) / K);
      const s = (0.7 + (i % 3) * 0.25) / K;
      const blob = (dx, dy, rx, ry) => { c.beginPath(); c.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, 7); c.fill(); };
      c.fillStyle = '#c9dcef';
      blob(0, 3, 60, 15); blob(30, -6, 36, 15); blob(-30, -1, 30, 12);
      c.fillStyle = '#ffffff';
      blob(0, 0, 56, 13); blob(30, -10, 33, 14); blob(-30, -4, 27, 10);
    }
    // hard alpha: no soft edges after the upscale
    const img = c.getImageData(0, 0, cv.width, cv.height), d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 210 : 0;
    c.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, 0, 0, VIEW_W, VIEW_H);
  },
  stars(ctx, camx) {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 80; i++) {
      const x = ((i * 137.5 - camx * 0.02) % VIEW_W + VIEW_W) % VIEW_W, y = (i * 61) % 260;
      ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(i + performance.now() * 0.001 * (1 + i % 3)));
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
  },

  // Tiles of the visible area. w may be a World (in game) or null (editor, uses L directly).
  tiles(ctx, L, theme, cam, w, time, editor) {
    const x0 = Math.max(0, Math.floor(cam.x / TILE)), x1 = Math.min(L.w - 1, Math.floor((cam.x + VIEW_W) / TILE));
    const y0 = Math.max(0, Math.floor(cam.y / TILE)), y1 = Math.min(L.h - 1, Math.floor((cam.y + VIEW_H) / TILE));
    const solidLook = c => c === '#' || c === 'S';
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const c = L.get(x, y);
      if (c === '.' || c === 'W') continue;
      let px = x * TILE, py = y * TILE;
      if (w) { const b = w.bumps.get(x + ',' + y); if (b) py -= Math.sin((0.18 - b) / 0.18 * Math.PI) * 8; }
      switch (c) {
        case '#': case 'S':
          RENDER.terrain(ctx, TERRAIN[theme.ground], L, x, y, px, py, k => k === '#' || k === 'S');
          if (editor && c === 'S') { ctx.strokeStyle = '#f0f'; ctx.setLineDash([4, 3]); ctx.strokeRect(px + 2, py + 2, TILE - 4, TILE - 4); ctx.setLineDash([]); }
          break;
        case '=':
          RENDER.terrain(ctx, TERRAIN[theme.stone], L, x, y, px, py, k => k === '=');
          break;
        case 'M':
          // city: cross-braced steel girders, a 2x2 pattern
          if (theme.metal === 'girder') SPR.tile(ctx, 'ct_' + (x % 2) + '_' + (2 + y % 2), px, py);
          else SPR.tile(ctx, theme.metal, px, py);
          break;
        case 'B': SPR.tile(ctx, 'brick', px, py); break;
        case 'C': SPR.tile(ctx, 'brick_cracked', px, py); break;
        case '?': case 'P': SPR.tile(ctx, Math.floor(time * 2.5 + x * 0.3) % 3 === 0 ? 'qblock2' : 'qblock', px, py);
          if (editor && c === 'P') { ctx.fillStyle = '#f33'; ctx.font = 'bold 11px ' + FONT; ctx.fillText('P', px + 2, py + 11); }
          break;
        case 'U': SPR.tile(ctx, 'qblock', px, py); ctx.fillStyle = 'rgba(70,40,20,0.75)'; ctx.fillRect(px, py, TILE, TILE);
          ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1); break;
        case 'H':
          if (editor) { ctx.strokeStyle = '#ff0'; ctx.setLineDash([3, 3]); ctx.strokeRect(px + 3, py + 3, TILE - 6, TILE - 6); ctx.setLineDash([]); }
          break;
        case 'G': RENDER.grate(ctx, px, py); break;
        case 'X': {
          // rotten wooden planks (they break after you step on them)
          let gone = false, shake = 0;
          if (w) { const st = w.crumble.get(x + ',' + y); if (st) { gone = st.gone; shake = st.gone ? 0 : (Math.random() - 0.5) * 3; } }
          if (gone) { if (editor) break; ctx.globalAlpha = 0.15; }
          if (theme.city) SPR.tile(ctx, 'ct_2_1', px + shake, py);   // city: crates
          else {
            const col = L.get(x - 1, y) !== 'X' ? 5 : L.get(x + 1, y) !== 'X' ? 7 : 6;
            SPR.tile(ctx, 'fo_' + col + '_6', px + shake, py);
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'F': {
          const fl = 0.9 + Math.sin(time * 18 + x) * 0.1;
          const gr = ctx.createRadialGradient(px + 16, py + 22, 2, px + 16, py + 22, 34);
          gr.addColorStop(0, 'rgba(255,160,40,0.45)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
          ctx.fillStyle = gr; ctx.fillRect(px - 18, py - 12, 68, 68);
          SPR.draw(ctx, 'fire', px + 16, py + TILE + 1, { ax: 0.5, ay: 1, sy: fl, flip: Math.floor(time * 8 + x) % 2 === 0 });
          break;
        }
      }
    }
  },
  // Water: a darker underlay, the reflections of the entities above the surface (mirrored, fading with
  // depth), the pack's water tiles scrolling sideways, drifting light streaks, a rippled bright surface
  // line and expanding rings where something fell in (w.ripples). Without `w` (the editor) only the
  // tiles and the surface line are drawn.
  water(ctx, L, cam, time, w) {
    const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1), x1 = Math.min(L.w - 1, Math.floor((cam.x + VIEW_W) / TILE) + 1);
    const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1), y1 = Math.min(L.h - 1, Math.floor((cam.y + VIEW_H) / TILE));
    // surface spans: runs of columns whose top water cell is on the same row
    const spans = [];
    for (let y = y0; y <= y1; y++) {
      let run = null;
      for (let x = x0; x <= x1; x++) {
        const surf = L.get(x, y) === 'W' && L.get(x, y - 1) !== 'W';
        if (surf && run) run.x1 = x;
        else if (surf) { run = { x0: x, x1: x, y }; spans.push(run); }
        else run = null;
      }
    }
    const depthOf = (x, y) => { let d = 0; while (L.get(x, y + d + 1) === 'W') d++; return d; };
    for (const sp of spans) {
      const Y = sp.y * TILE, SX = sp.x0 * TILE, SW = (sp.x1 - sp.x0 + 1) * TILE;
      // the water cells of this span (top 4 rows), used for clipping the effects
      const cells = [];
      for (let x = sp.x0; x <= sp.x1; x++) for (let d = 0; d < 4 && L.get(x, sp.y + d) === 'W'; d++) cells.push([x, sp.y + d, d]);
      const clipCells = () => { ctx.beginPath(); for (const [cx, cy] of cells) ctx.rect(cx * TILE, cy * TILE, TILE, TILE); ctx.clip(); };

      // 1) underlay
      ctx.fillStyle = 'rgba(14,62,108,0.5)';
      for (const [cx, cy] of cells) ctx.fillRect(cx * TILE, cy * TILE, TILE, TILE);

      // 2) reflections of what stands or flies above the water
      if (w) {
        ctx.save(); clipCells();
        for (const e of w.ents) {
          if (e.decor || e.dead || e.dying && e.exploded) continue;
          if (e.x + e.w < SX - 40 || e.x > SX + SW + 40) continue;
          const bottom = e.y + e.h;
          if (bottom < Y - 150 || e.y > Y + 24) continue;
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.translate(Math.sin(time * 2.4 + e.x * 0.05) * 1.6, 2 * Y);
          ctx.scale(1, -1);
          e.draw(ctx, w);
          ctx.restore();
        }
        ctx.restore();
      }

      // 3) the water tiles: texture scrolling slowly sideways, more opaque with depth
      for (const [cx, cy, d] of cells) {
        const r = ATLAS['fo_' + (6 + (cx % 4)) + '_' + (d === 0 ? 19 : 20)];
        if (!r) continue;
        ctx.globalAlpha = [0.4, 0.55, 0.75, 0.9][d];
        const off = Math.floor(((time * (d === 0 ? 9 : 5) + cx * 7) % TILE + TILE) % TILE);
        ctx.drawImage(SPR.img.atlas, r[0] + off, r[1], r[2] - off, r[3], cx * TILE, cy * TILE, TILE - off, TILE);
        if (off) ctx.drawImage(SPR.img.atlas, r[0], r[1], off, r[3], cx * TILE + TILE - off, cy * TILE, off, TILE);
      }
      ctx.globalAlpha = 1;

      // 4) drifting light streaks under the surface
      ctx.save(); clipCells();
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 4; k++) {
        ctx.strokeStyle = 'rgba(190,235,255,' + (0.13 - k * 0.02) + ')';
        ctx.beginPath();
        for (let x = SX; x <= SX + SW; x += 6) {
          const yy = Y + 12 + k * 17 + Math.sin(x * 0.045 + time * (1.1 + k * 0.25) + k * 2) * 2.6;
          if (x === SX) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();

      // 5) rippled surface: two bright wavy lines
      ctx.lineWidth = 1.6;
      for (const [off, al, wd] of [[2, 0.85, 1.6], [5, 0.3, 1]]) {
        ctx.strokeStyle = 'rgba(225,248,255,' + al + ')'; ctx.lineWidth = wd;
        ctx.beginPath();
        for (let x = SX; x <= SX + SW; x += 3) {
          const yy = Y + off + Math.sin(x * 0.09 + time * 2.3 + off) * 1.4 + Math.sin(x * 0.21 - time * 3.1) * 0.8;
          if (x === SX) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
    // 6) rings where something fell into the water
    if (w && w.ripples) {
      for (const r of w.ripples) {
        const k = r.t / 1.1;
        ctx.strokeStyle = 'rgba(225,248,255,' + (0.8 * (1 - k)) + ')'; ctx.lineWidth = 1.5;
        for (let i = 0; i < 2; i++) {
          const kk = Math.max(0, k - i * 0.18);
          if (kk <= 0) continue;
          ctx.beginPath(); ctx.ellipse(r.x, r.y + 2, 6 + kk * 62, 1.5 + kk * 8, 0, 0, 7); ctx.stroke();
        }
      }
    }
  },
  // Autotiling of a terrain block from the pack: rows (cap above the top, top, middle, bottom) and
  // columns (left edge, middle variants, right edge) picked from the neighbours of the same terrain.
  terrain(ctx, set, L, x, y, px, py, same) {
    const up = same(L.get(x, y - 1)), dn = y + 1 >= L.h || same(L.get(x, y + 1));
    const lf = x === 0 || same(L.get(x - 1, y)), rt = x === L.w - 1 || same(L.get(x + 1, y));
    const h = (x * 7 + y * 13) >>> 0;
    const row = !up ? set.top : !dn ? set.bot : set.mid[h % set.mid.length];
    const col = lf && rt ? set.m[h % set.m.length] : !lf && !rt ? set.m[0] : !lf ? set.l : set.r;
    const p = set.p || 'fo_';
    let name = p + col + '_' + row;
    if (!ATLAS[name]) name = p + set.m[0] + '_' + set.mid[0];
    SPR.tile(ctx, name, px, py);
    if (!up && set.cap !== null && ATLAS[p + col + '_' + set.cap]) SPR.tile(ctx, p + col + '_' + set.cap, px, py - TILE);
  },
  grate(ctx, px, py) {
    ctx.fillStyle = 'rgba(30,36,48,0.35)'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = '#4a5160';
    for (let i = 2; i < TILE; i += 6) ctx.fillRect(px + i, py, 2, TILE);
    ctx.fillRect(px, py + 14, TILE, 3);
    ctx.fillStyle = 'rgba(200,210,230,0.35)';
    for (let i = 2; i < TILE; i += 6) ctx.fillRect(px + i, py, 1, TILE);
    ctx.strokeStyle = '#2b2f38'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
  },

  portal(ctx, p, time) {
    const s = 1 - Math.pow(1 - (p.open || 0), 3);
    const col = PORTAL_COLORS[p.c];
    ctx.save();
    ctx.translate(p.cx + p.nx * 4, p.cy + p.ny * 4);
    if (p.ny) ctx.rotate(Math.PI / 2);
    // glow
    ctx.globalCompositeOperation = 'lighter';
    // soft elliptical glow: a radial gradient in a squashed space, fading to zero at its edge
    ctx.save();
    ctx.scale(0.5 * s, s);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
    g.addColorStop(0, col + '99'); g.addColorStop(0.3, col + '55'); g.addColorStop(0.65, col + '1c'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 56, 0, 7); ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    // inner surface
    const ig = ctx.createRadialGradient(0, 0, 1, 0, 0, 30);
    ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.35, col); ig.addColorStop(1, '#0a1020');
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.ellipse(0, 0, 7 * s, 30 * s, 0, 0, 7); ctx.fill();
    // ring
    SPR.draw(ctx, p.c ? 'porange' : 'pblue', 0, 0, { ax: 0.5, ay: 0.5, sx: 0.75 * s, sy: s * (1 + Math.sin(time * 6) * 0.03) });
    ctx.restore();
  },

  shots(ctx, shots) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of shots) {
      const col = PORTAL_COLORS[s.c];
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath();
      const t0 = s.trail[0] || [s.x, s.y];
      ctx.moveTo(t0[0], t0[1]); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill();
    }
    ctx.restore();
  },

  particles(ctx, fx) {
    for (const p of fx) {
      const a = Math.max(0, Math.min(1, p.life / (p.max * 0.5)));
      if (p.text) {
        ctx.globalAlpha = a;
        RENDER.text(ctx, p.text, p.x, p.y, 14, p.color, 'center');
        ctx.globalAlpha = 1;
      } else if (p.sprite) {
        SPR.draw(ctx, p.sprite, p.x, p.y, { ax: 0.5, ay: 0.5, scale: p.size, rot: p.rot || 0, alpha: p.fade ? a : 1 });
      } else {
        if (p.glow) ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  },

  // Dotted aim line with a preview of where the portal would land
  aim(ctx, w, p) {
    if (p.dying || p.won) return;
    const [px, py] = p.pivot();
    const dx = Math.cos(p.aim), dy = Math.sin(p.aim);
    const hit = w.raycast(px, py, dx, dy, 1100, 'shot');
    const ex = hit ? hit.x : px + dx * 1100, ey = hit ? hit.y : py + dy * 1100;
    ctx.save();
    // dark outline under a bright dotted line, so the beam reads on light and dark backgrounds
    // (the line fades out with distance)
    const x0 = px + dx * 20, y0 = py + dy * 20;
    const grad = ctx.createLinearGradient(x0, y0, ex, ey);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(1, 'rgba(255,255,255,0.45)');
    ctx.lineDashOffset = -performance.now() * 0.03;
    ctx.setLineDash([4, 6]); ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(8,16,36,0.7)'; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = grad; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    if (hit) {
      const spot = w.portalSpot(hit, 0) || w.portalSpot(hit, 1);
      if (spot) {
        ctx.translate(spot.cx + spot.nx * 3, spot.cy + spot.ny * 3);
        if (spot.ny) ctx.rotate(Math.PI / 2);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(8,16,36,0.7)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 30, 0, 0, 7); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(0, 0, 6, 30, 0, 0, 7); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,80,80,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey + 5); ctx.moveTo(ex + 5, ey - 5); ctx.lineTo(ex - 5, ey + 5); ctx.stroke();
      }
    }
    ctx.restore();
  },

  // Hint tooltip: small, dark translucent glass with light text, so it hides as little as possible
  bubble(ctx, b) {
    ctx.font = '11px ' + FONT;
    const words = b.text.split(' '), lines = [];
    let line = '';
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width > 190 && line) { lines.push(line); line = wd; } else line = t;
    }
    if (line) lines.push(line);
    const wdt = Math.max(...lines.map(l => ctx.measureText(l).width)) + 14, h = lines.length * 14 + 10;
    const x = b.x - wdt / 2, y = b.y - h - 6, a = b.a === undefined ? 1 : b.a;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(8,12,24,0.66)'; ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, wdt, h, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x - 4, y + h); ctx.lineTo(b.x, y + h + 5); ctx.lineTo(b.x + 4, y + h); ctx.fill();
    ctx.fillStyle = '#f2f6ff';
    lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 15 + i * 14));
    ctx.restore();
  },

  // Outlined text in the bitmap pixel font (js/pixelfont.js); size picks the pixel scale
  text(ctx, str, x, y, size, color, align) {
    const scale = size >= 28 ? 4 : size >= 20 ? 3 : size >= 12 ? 2 : 1;
    PFONT.draw(ctx, String(str), x, y, scale, color || '#fff', align || 'left');
  },

  hud(ctx, G) {
    const w = G.world, p = w.player;
    for (let i = 0; i < p.maxHp; i++) SPR.draw(ctx, 'heart', 16 + i * 24, 14, { alpha: i < p.hp ? 1 : 0.25 });
    SPR.draw(ctx, 'coin', 18, 46);
    RENDER.text(ctx, '× ' + G.coins, 42, 64, 18);
    SPR.draw(ctx, 'idle0', 100, 40, { scale: 0.55 });
    RENDER.text(ctx, '× ' + Math.max(0, G.lives), 124, 64, 18);
    RENDER.text(ctx, G.levelLabel(), VIEW_W / 2, 30, 18, '#fff', 'center');
    RENDER.text(ctx, 'TIME ' + Math.floor(G.time), VIEW_W / 2, 52, 15, '#d8e4ff', 'center');
    RENDER.text(ctx, 'SCORE ' + String(G.score).padStart(6, '0'), VIEW_W - 16, 30, 18, '#fff', 'right');
    RENDER.text(ctx, '★ SECRETS ' + w.secretsFound + '/' + w.secretsTotal, VIEW_W - 16, 52, 15, '#ffe27a', 'right');
    // portal state
    for (let c = 0; c < 2; c++) {
      const x = VIEW_W - 92 + c * 22, y = 74;
      ctx.strokeStyle = PORTAL_COLORS[c]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, 6, 11, 0, 0, 7); ctx.stroke();
      if (w.portals[c]) { ctx.fillStyle = PORTAL_COLORS[c]; ctx.fill(); }
    }
    if (p.plasma > 0) {
      SPR.draw(ctx, 'fireball_b', VIEW_W - 44, 74, { ax: 0.5, ay: 0.5, scale: 0.8 });
      RENDER.text(ctx, '' + p.plasma, VIEW_W - 16, 80, 15, '#9fe0ff', 'right');
    }
    if (p.shield > 0) RENDER.text(ctx, 'SHIELD ' + Math.ceil(p.shield), 16, 92, 14, '#9fe0ff');
    // boss bar
    const b = w.boss;
    if (b && !b.dead && b.state !== 'sleep') {
      const bw = 360, x = VIEW_W / 2 - bw / 2, y = VIEW_H - 40;
      RENDER.text(ctx, 'THE DARK KNIGHT', VIEW_W / 2, y - 8, 15, '#e8c8ff', 'center');
      ctx.fillStyle = '#1a1020'; ctx.fillRect(x - 3, y - 3, bw + 6, 18);
      ctx.fillStyle = '#5a1f2a'; ctx.fillRect(x, y, bw, 12);
      ctx.fillStyle = '#e0303c'; ctx.fillRect(x, y, bw * Math.max(0, b.hp) / b.maxHp, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(x, y, bw * Math.max(0, b.hp) / b.maxHp, 4);
    }
    if (G.msg && G.msg.t > 0 && G.state === 'play') {
      const a = Math.min(1, G.msg.t * 2);
      ctx.globalAlpha = a;
      RENDER.text(ctx, G.msg.text, VIEW_W / 2, 150, 30, G.msg.color || '#ffe27a', 'center');
      if (G.msg.sub) RENDER.text(ctx, G.msg.sub, VIEW_W / 2, 178, 16, '#fff', 'center');
      ctx.globalAlpha = 1;
    }
  }
};
