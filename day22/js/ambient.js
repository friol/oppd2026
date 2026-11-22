'use strict';
// Ambient background effects, drawn from the time and a hash only (no state to update):
//   world 1: drifting mist layers and falling leaves (some in front of the level too);
//   world 2: greenish mist, floating dust motes and water drops that fall and splash;
//   world 3: the fog bands of the city drift (see RENDER.background).
// All of it is pixel art: the fog is a small procedural texture scaled up without smoothing.

const AMB = {
  fogCache: {},
  hash(i, k) { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); },

  // Pixel fog texture: periodic value noise (so it tiles horizontally), a vertical window that
  // fades it out at the top and bottom, and 4 alpha levels. 128x24 art pixels scaled 3x.
  // The fog is a set of separate, small banks (about 200-400 px wide and 30-60 px tall on screen), each
  // with its own width and height and sitting at a different altitude inside a taller texture. The
  // texture is 384 art pixels wide (1152 on screen) and 60 tall, 3x: it is generated once per colour
  // and `seed`, tiles horizontally, and a fine periodic noise gives the banks ragged, wispy edges.
  fogTex(rgb, seed) {
    seed = seed || 0;
    const key = rgb.join(',') + '/' + seed;
    if (this.fogCache[key]) return this.fogCache[key];
    const LW = 384, LH = 60, K = 3, NB = 4;
    const lat = (ix, iy, per) => AMB.hash(((ix % per) + per) % per, iy + seed * 17);
    const noise = (x, y, per) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = lat(x0, y0, per), b = lat(x0 + 1, y0, per), c = lat(x0, y0 + 1, per), d = lat(x0 + 1, y0 + 1, per);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
    // each bank is a cluster of round "puffs" of different sizes (a cumulus look): x centre, half-width,
    // y centre and a list of puffs {x, y, r}; the density is the sum of soft discs (metaballs), so the
    // outline is lumpy, then a fine noise erodes the edges
    const puffs = [];
    for (let i = 0; i < NB; i++) {
      const cx = (i + 0.15 + 0.7 * AMB.hash(i, 30 + seed)) * LW / NB;
      const hw = 32 + 30 * AMB.hash(i, 31 + seed);
      const cy = 12 + (LH - 26) * AMB.hash(i, 32 + seed);
      const np = 6 + Math.floor(4 * AMB.hash(i, 34 + seed));
      for (let k = 0; k < np; k++) {
        const u = AMB.hash(i * 13 + k, 40 + seed), v = AMB.hash(i * 13 + k, 41 + seed), w = AMB.hash(i * 13 + k, 42 + seed);
        const mid = 1 - Math.abs(u * 2 - 1);                         // puffs near the middle are bigger and higher
        puffs.push({ x: cx + (u * 2 - 1) * hw, y: cy - mid * 2.5 + (v - 0.35) * 5, r: 6 + 8 * w * (0.55 + 0.45 * mid) });
      }
    }
    const cv = document.createElement('canvas');
    cv.width = LW; cv.height = LH;
    const g = cv.getContext('2d'), img = g.createImageData(LW, LH);
    // 1) density
    const dens = new Float32Array(LW * LH);
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      let d = 0;
      for (const pf of puffs) {
        const dx = (((x - pf.x + LW / 2) % LW) + LW) % LW - LW / 2, dy = (y - pf.y) * 1.25;   // a bit flattened
        const q = 1 - (dx * dx + dy * dy) / (pf.r * pf.r);
        if (q > 0) d += q * q;
      }
      const n = 0.65 * noise(x / 9, y / 4, LW / 9 | 0) + 0.35 * noise(x / 4.5 + 3.3, y / 2.2 + 1.7, LW / 4.5 | 0);
      dens[y * LW + x] = Math.min(1, Math.max(0, (d * 1.0 + (n - 0.5) * 0.55 - 0.22) * 1.9));
    }
    // 2) colour: three tones from the density slope (lit top edges, darker underside) and 4 alpha levels
    const light = [rgb[0] + (255 - rgb[0]) * 0.55, rgb[1] + (255 - rgb[1]) * 0.55, rgb[2] + (255 - rgb[2]) * 0.55];
    const dark = [rgb[0] * 0.72, rgb[1] * 0.74, rgb[2] * 0.8];
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const dd = dens[y * LW + x];
      const above = y > 1 ? dens[(y - 2) * LW + x] : 0, below = y < LH - 2 ? dens[(y + 2) * LW + x] : 0;
      const slope = below - above;                                   // > 0: the top of a puff, < 0: its underside
      const col = slope > 0.18 ? light : slope < -0.18 ? dark : rgb;
      const i = (y * LW + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2];
      img.data[i + 3] = Math.round(Math.round(dd * 4) / 4 * 225);
    }
    g.putImageData(img, 0, 0);
    const big = document.createElement('canvas');
    big.width = LW * K; big.height = LH * K;
    const bg = big.getContext('2d');
    bg.imageSmoothingEnabled = false;
    bg.drawImage(cv, 0, 0, big.width, big.height);
    return (this.fogCache[key] = big);
  },
  // a horizontally tiled fog band: scrolls with the camera (par) and drifts by itself (speed px/s)
  fog(ctx, rgb, camx, par, speed, y, alpha, t, seed) {
    const tex = AMB.fogTex(rgb, seed), w = tex.width;
    let x = -(((camx * par + t * speed) % w) + w) % w;
    if (x > 0) x -= w;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (; x < VIEW_W; x += w) ctx.drawImage(tex, Math.round(x), Math.round(y));
    ctx.restore();
  },

  // falling leaves: they flutter sideways, spin (their width flips) and drift with the wind
  leaves(ctx, camx, t, n, front) {
    const pal = ['#6f9a2a', '#a7b83a', '#d49a2e', '#c9622b', '#8bb13a'];
    const k = front ? 1.6 : 1;
    for (let i = 0; i < n; i++) {
      const T = (front ? 7 : 10) + AMB.hash(i, 1) * 6;               // seconds to fall across the screen
      const ph = ((t / T + AMB.hash(i, 2)) % 1 + 1) % 1;
      const y = -12 + ph * (VIEW_H + 24);
      const par = front ? 1.1 : 0.35 + AMB.hash(i, 3) * 0.3;
      const x0 = AMB.hash(i, 4) * (VIEW_W + 80) + ph * (front ? 90 : 60) - camx * par;
      const x = (((x0 + Math.sin(t * 1.5 + i * 2.1) * 16 * k) % (VIEW_W + 80)) + VIEW_W + 80) % (VIEW_W + 80) - 40;
      const flip = Math.sin(t * 4.5 + i * 1.7) > 0;
      const w = (flip ? 5 : 3) * k, h = (flip ? 3 : 4) * k;
      ctx.fillStyle = pal[i % pal.length];
      ctx.globalAlpha = front ? 0.95 : 0.8;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }
    ctx.globalAlpha = 1;
  },

  // dust motes floating slowly in the air of the caverns
  dust(ctx, camx, t, n, front) {
    for (let i = 0; i < n; i++) {
      const par = front ? 0.9 : 0.25 + AMB.hash(i, 5) * 0.35;
      const x = (((AMB.hash(i, 6) * VIEW_W + Math.sin(t * 0.3 + i) * 26 + t * (3 + AMB.hash(i, 7) * 4) - camx * par) % VIEW_W) + VIEW_W) % VIEW_W;
      const y = AMB.hash(i, 8) * (VIEW_H - 60) + Math.cos(t * 0.35 + i * 1.3) * 18;
      const a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 2.7));
      ctx.fillStyle = 'rgba(215,240,222,' + (front ? a : a * 0.85) + ')';
      const s = AMB.hash(i, 9) < 0.45 ? 3 : 2;
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  },

  // water drops falling from the cave ceiling, with a small splash when they land
  drips(ctx, camx, t, horizon) {
    const ground = horizon - 6;
    for (let i = 0; i < 10; i++) {
      const cycle = 2.2 + AMB.hash(i, 10) * 2.4;
      const ph = ((t / cycle + AMB.hash(i, 11)) % 1 + 1) % 1;
      const x = (((AMB.hash(i, 12) * VIEW_W * 1.3 - camx * (0.4 + AMB.hash(i, 13) * 0.3)) % VIEW_W) + VIEW_W) % VIEW_W;
      const fall = 0.5;
      if (ph < fall) {
        const k = ph / fall, y = 20 + k * k * (ground - 20);
        ctx.fillStyle = 'rgba(150,215,245,0.95)'; ctx.fillRect(Math.round(x), Math.round(y - 3), 2, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(Math.round(x), Math.round(y + 2), 2, 2);
      } else if (ph < fall + 0.18) {
        const s = (ph - fall) / 0.18;                              // splash: a ring and a few droplets
        ctx.strokeStyle = 'rgba(190,230,250,' + (0.7 * (1 - s)) + ')'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, ground + 2, 2 + s * 9, 0.8 + s * 2.2, 0, 0, 7); ctx.stroke();
        for (let d = -1; d <= 1; d += 2) {
          ctx.fillStyle = 'rgba(210,240,255,' + (0.8 * (1 - s)) + ')';
          ctx.fillRect(Math.round(x + d * s * 8), Math.round(ground - s * 7 + s * s * 9), 1, 1);
        }
      }
    }
  },

  // behind the level (called from RENDER.background after the tree layers)
  back(ctx, theme, camx, horizon, t) {
    if (theme.ground === 'grass') {
      AMB.fog(ctx, [226, 242, 236], camx, 0.14, 7, horizon - 250, 0.3, t, 0);
      AMB.leaves(ctx, camx, t, 20, false);
    } else if (theme.ground === 'moss') {
      AMB.fog(ctx, [120, 175, 150], camx, 0.16, 5, horizon - 240, 0.36, t, 2);
      AMB.dust(ctx, camx, t, 50, false);
      AMB.drips(ctx, camx, t, horizon);
    }
  },
  // in front of the level (called after the level has been drawn)
  front(ctx, theme, camx, horizon, t) {
    if (theme.ground === 'grass') {
      AMB.leaves(ctx, camx, t, 7, true);
      AMB.fog(ctx, [226, 242, 236], camx, 0.5, 14, horizon - 190, 0.1, t, 1);
    } else if (theme.ground === 'moss') {
      AMB.dust(ctx, camx, t, 16, true);
      AMB.fog(ctx, [110, 165, 140], camx, 0.55, 9, horizon - 180, 0.08, t, 3);
    }
  }
};
