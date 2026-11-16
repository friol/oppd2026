// Procedural deep-space backgrounds: nebulae, dust lanes, galaxies and a realistic star field.
// Each level gets one tall tile (480x1440) that repeats seamlessly in the vertical direction.
self.SpaceBG = (function () {
  'use strict';
  var TW = 480, TH = 1440;       // tile size (logical pixels)
  var NS = 3;                    // the nebula is computed at 1/NS resolution and smoothed when scaled up
  var NW = TW / NS, NH = TH / NS;

  var PAL = {
    1: { base: [5, 9, 28], c1: [40, 95, 200], c2: [150, 45, 150], c3: [185, 225, 255], k: 0.55, seed: 11 },
    2: { base: [16, 5, 30], c1: [140, 38, 150], c2: [60, 40, 175], c3: [255, 175, 230], k: 0.55, seed: 23 },
    3: { base: [4, 7, 15], c1: [20, 90, 115], c2: [60, 48, 125], c3: [150, 255, 240], k: 0.5, seed: 37 }
  };

  function rng(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(ix, iy, s) {
    var h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // value noise, periodic in y with period py lattice cells (so the tile wraps vertically)
  function noise(x, y, py, s) {
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    var ya = ((y0 % py) + py) % py, yb = (ya + 1) % py;
    var a = hash(x0, ya, s), b = hash(x0 + 1, ya, s), c = hash(x0, yb, s), d = hash(x0 + 1, yb, s);
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  function fbm(x, y, py, s, oct) {
    var v = 0, amp = 0.5, f = 1, n = 0;
    for (var o = 0; o < oct; o++) { v += amp * noise(x * f, y * f, py * f, s + o * 17); n += amp; amp *= 0.5; f *= 2; }
    return v / n;
  }
  function sstep(a, b, x) { var t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

  function makeNebula(P) {
    var c = document.createElement('canvas'); c.width = NW; c.height = NH;
    var g = c.getContext('2d'), im = g.createImageData(NW, NH), d = im.data;
    var dens = new Float32Array(NW * NH);
    var cells = 4, py = cells * NH / NW, s = P.seed;       // 4 lattice cells across, 12 down
    for (var y = 0; y < NH; y++) {
      for (var x = 0; x < NW; x++) {
        var u = x / NW * cells, v = y / NW * cells;
        // domain warping gives the wispy, filament-like shapes
        var wx = fbm(u + 3.1, v, py, s + 1, 4), wy = fbm(u, v + 7.7, py, s + 2, 4);
        var n1 = fbm(u + 1.8 * wx, v + 1.8 * wy, py, s + 3, 5);
        var n2 = fbm(u * 1.0 + 0.9 * wy + 5.2, v + 0.9 * wx, py, s + 4, 5);
        var dust = fbm(u * 1.6 + 2.5 * wx, v * 1.6, py * 1.6 | 0 || 1, s + 5, 5);
        var a = sstep(0.42, 0.82, n1), b2 = Math.pow(sstep(0.38, 0.8, n2), 2.2), core = Math.pow(a, 4);
        var dk = 1 - 0.6 * sstep(0.5, 0.72, dust);
        var r = P.base[0] + (P.c1[0] * Math.pow(a, 1.5) * 0.85 + P.c2[0] * b2 * 0.75 + P.c3[0] * core * 0.5) * P.k;
        var gg = P.base[1] + (P.c1[1] * Math.pow(a, 1.5) * 0.85 + P.c2[1] * b2 * 0.75 + P.c3[1] * core * 0.5) * P.k;
        var bb = P.base[2] + (P.c1[2] * Math.pow(a, 1.5) * 0.85 + P.c2[2] * b2 * 0.75 + P.c3[2] * core * 0.5) * P.k;
        var i = (y * NW + x) * 4;
        d[i] = r * dk; d[i + 1] = gg * dk; d[i + 2] = bb * dk; d[i + 3] = 255;
        dens[y * NW + x] = Math.max(a, b2) * dk;
      }
    }
    g.putImageData(im, 0, 0);
    return { cv: c, dens: dens };
  }

  // star colours by temperature: blue-white, white, yellow, orange, red
  var TEMPS = [[170, 200, 255], [210, 225, 255], [255, 250, 240], [255, 230, 180], [255, 200, 140], [255, 170, 130]];
  function starCol(r) { var t = TEMPS[Math.min(TEMPS.length - 1, Math.floor(Math.pow(r, 1.3) * TEMPS.length))]; return t; }

  function drawWrapped(g, y, h, fn) {        // draw at y and, near the seams, also one tile up/down
    fn(y);
    if (y - h < 0) fn(y + TH);
    if (y + h > TH) fn(y - TH);
  }

  function galaxy(g, R, x, y) {
    var size = 22 + R() * 34, tilt = 0.28 + R() * 0.5, rot = R() * Math.PI, arms = R() < 0.75 ? 2 : 0;
    var hue = R() < 0.5 ? [190, 210, 255] : [255, 225, 190];
    g.save(); g.translate(x, y); g.rotate(rot); g.globalCompositeOperation = 'lighter';
    // halo
    g.save(); g.scale(1, tilt);
    var hg = g.createRadialGradient(0, 0, 0, 0, 0, size);
    hg.addColorStop(0, 'rgba(' + hue + ',0.32)'); hg.addColorStop(0.35, 'rgba(' + hue + ',0.1)'); hg.addColorStop(1, 'rgba(' + hue + ',0)');
    g.fillStyle = hg; g.beginPath(); g.arc(0, 0, size, 0, 6.2832); g.fill();
    g.restore();
    // spiral arms: dots along two logarithmic spirals, seen at an angle
    if (arms) {
      for (var a = 0; a < arms; a++) {
        for (var k = 0; k < 260; k++) {
          var t = k / 260, rr = size * (0.12 + 0.88 * t), th = a * Math.PI + t * 4.2 + (R() - 0.5) * 0.5;
          var px = Math.cos(th) * rr + (R() - 0.5) * 2.5, py = (Math.sin(th) * rr + (R() - 0.5) * 2.5) * tilt;
          var al = (1 - t) * 0.5 * (0.4 + R() * 0.6);
          g.fillStyle = R() < 0.15 ? 'rgba(255,170,200,' + al + ')' : 'rgba(170,200,255,' + al + ')';
          g.fillRect(px, py, 1, 1);
        }
      }
    }
    // bright core
    g.save(); g.scale(1, tilt);
    var cg = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.22);
    cg.addColorStop(0, 'rgba(255,245,220,0.95)'); cg.addColorStop(1, 'rgba(255,220,170,0)');
    g.fillStyle = cg; g.beginPath(); g.arc(0, 0, size * 0.22, 0, 6.2832); g.fill();
    g.restore();
    g.restore();
  }

  function make(level) {
    var P = PAL[level] || PAL[1], R = rng(P.seed * 7919);
    var neb = makeNebula(P);
    var c = document.createElement('canvas'); c.width = TW; c.height = TH;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(neb.cv, 0, 0, TW, TH);
    // galaxies (away from the seam)
    var ng = 2 + Math.floor(R() * 2);
    for (var i = 0; i < ng; i++) galaxy(g, R, 40 + R() * (TW - 80), 120 + R() * (TH - 240));
    g.globalCompositeOperation = 'lighter';
    // faint star dust: many dim stars, denser inside the nebula
    for (i = 0; i < 2600; i++) {
      var x = R() * TW, y = R() * TH, dn = neb.dens[Math.floor(y / NS) * NW + Math.floor(x / NS)] || 0;
      if (R() > 0.3 + 0.7 * dn) continue;
      var col = starCol(R()), al = 0.15 + Math.pow(R(), 3) * 0.6;
      g.fillStyle = 'rgba(' + col + ',' + al + ')';
      g.fillRect(x, y, 1, 1);
    }
    // brighter stars with a soft glow, a few with diffraction spikes
    for (i = 0; i < 70; i++) {
      var sx = R() * TW, sy = R() * TH, sc = starCol(R()), big = R() < 0.18, gr = big ? 5 + R() * 5 : 2 + R() * 2.5;
      drawWrapped(g, sy, gr * 3, function (yy) {
        var rg = g.createRadialGradient(sx, yy, 0, sx, yy, gr);
        rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.25, 'rgba(' + sc + ',0.6)'); rg.addColorStop(1, 'rgba(' + sc + ',0)');
        g.fillStyle = rg; g.fillRect(sx - gr, yy - gr, gr * 2, gr * 2);
        if (big) {
          var L = gr * 3;
          [[1, 0], [0, 1]].forEach(function (dv) {
            var lg = g.createLinearGradient(sx - dv[0] * L, yy - dv[1] * L, sx + dv[0] * L, yy + dv[1] * L);
            lg.addColorStop(0, 'rgba(' + sc + ',0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.55)'); lg.addColorStop(1, 'rgba(' + sc + ',0)');
            g.fillStyle = lg;
            if (dv[0]) g.fillRect(sx - L, yy - 0.5, L * 2, 1); else g.fillRect(sx - 0.5, yy - L, 1, L * 2);
          });
        }
      });
    }
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  var cache = {};
  return {
    TW: TW, TH: TH,
    get: function (level) { return cache[level] || (cache[level] = make(level)); }
  };
})();
