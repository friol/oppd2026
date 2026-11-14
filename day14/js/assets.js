'use strict';
// Loads the source sheets and slices them into game-ready assets:
// - a 128x128 texture array (walls / floors / ceilings)
// - a packed sprite atlas (enemies, items, projectiles, effects)
// - first-person weapon view images (drawn on the 2D overlay)
const Assets = (() => {
  const TS = 128;

  // Texture sheet grid (medieval.textures.png), measured in source pixels.
  const GX = [[7,149],[160,303],[314,456],[467,609],[619,761],[772,916],[927,1070],[1081,1224],[1235,1378],[1388,1529]];
  const GY = [[6,152],[163,306],[317,458],[469,609],[620,741],[751,877],[888,1017]];
  const TEX_CELLS = {
    stone_moss:[0,0], stone:[0,1], brick_light:[0,2], cobble_purple:[0,3], brick_moss:[0,4], cobble:[0,5], brick_red:[0,6], brick_dark:[0,7], block_big:[0,8], lever:[0,9],
    floor_cobble:[1,0], floor_moss:[1,1], floor_moss2:[1,2], flagstone:[1,3], checker:[1,4], metal_floor:[1,5], tiles:[1,6], flagstone2:[1,7], red_tile:[1,8], plate:[1,9],
    wood_dark:[2,0], wood:[2,1], parquet:[2,2], crate:[2,3], planks:[2,4], door_wood:[2,5], iron_door:[2,6], cage:[2,7], bars:[2,8], lava:[2,9],
    carpet_red:[3,0], carpet_blue:[3,1], carpet_purple:[3,2], carpet_green:[3,3], brick_pale:[3,9],
    wall_moss:[4,0], ivy:[4,1], dark_cobble:[4,2], waterfall:[4,3], water:[4,4], dirt:[4,5], grass:[4,6], grass2:[4,7], sand:[4,8], snow:[4,9],
    metal_panel:[5,0], lattice:[5,1], gold:[5,2], rose:[5,3], stained:[5,4], skull_relief:[5,5], gargoyle:[5,6], gargoyle_statue:[5,7], pillar_panel:[5,8], torch:[5,9],
    cobble_moss:[6,0], cobweb:[6,1], dark_brick:[6,2], skull_wall:[6,3], bones:[6,4], rock:[6,5], rock_hole:[6,6], crystal_purple:[6,7], crystal_blue:[6,8], vines:[6,9],
  };
  // Banners hang over a stone wall; their black background is keyed out.
  const BANNERS = {
    banner_red:[620,468,724,614], banner_blue:[733,468,840,614],
    banner_purple:[847,468,954,614], banner_green:[976,470,1059,614],
  };
  // Textures whose dark gaps become transparent (alpha tested).
  const KEYED = { bars: 70, cage: 70 };

  // Enemy sheet: 9 rows of 17 frames (16 poses + corpse), then the dragon.
  const ENEMY_ROWS = ['skeleton','orc','wizard','demon','zombie','spider','eye','slime','ghost'];
  const ROW_Y = [[16,103],[122,203],[218,307],[329,420],[440,527],[547,618],[631,706],[721,772],[786,883]];
  const ROW_X = [
    [[31,102],[140,200],[233,281],[315,367],[408,486],[535,571],[598,645],[678,734],[757,834],[862,912],[944,995],[1029,1068],[1101,1129],[1168,1222],[1262,1299],[1345,1406],[1419,1523]],
    [[29,105],[143,203],[235,283],[312,366],[411,501],[534,579],[596,645],[677,735],[757,838],[857,915],[944,994],[1026,1067],[1094,1149],[1163,1221],[1258,1298],[1345,1408],[1419,1523]],
    [[21,118],[142,219],[240,285],[314,384],[398,494],[530,578],[590,648],[676,731],[744,834],[864,924],[938,995],[1025,1069],[1100,1153],[1164,1225],[1254,1304],[1344,1393],[1418,1523]],
    [[19,115],[140,207],[236,279],[306,383],[401,494],[532,577],[598,652],[678,741],[754,847],[858,927],[949,997],[1025,1062],[1096,1139],[1175,1226],[1248,1305],[1338,1397],[1419,1523]],
    [[36,88],[141,188],[231,277],[322,371],[427,483],[521,574],[603,652],[680,741],[766,834],[860,909],[954,1008],[1032,1066],[1090,1129],[1173,1230],[1255,1298],[1352,1396],[1418,1523]],
    [[14,115],[131,208],[226,290],[307,385],[401,501],[524,580],[595,659],[680,739],[760,827],[856,925],[940,1008],[1024,1075],[1088,1149],[1166,1228],[1252,1320],[1336,1406],[1418,1522]],
    [[28,103],[133,201],[227,288],[314,382],[414,488],[532,580],[600,657],[678,738],[765,822],[860,917],[945,1003],[1024,1071],[1092,1143],[1169,1228],[1250,1313],[1340,1401],[1425,1512]],
    [[33,97],[135,200],[229,284],[314,378],[418,486],[531,581],[597,651],[682,739],[760,815],[864,919],[943,1007],[1028,1075],[1092,1144],[1173,1228],[1250,1308],[1340,1396],[1420,1518]],
    [[34,96],[142,191],[234,285],[325,370],[421,484],[530,579],[602,642],[681,735],[763,819],[863,916],[950,999],[1032,1070],[1098,1136],[1177,1217],[1256,1306],[1351,1396],[1430,1500]],
  ];
  const DRAGON = [[11,893,182,1008],[194,893,329,1004],[341,894,479,1004],[495,896,603,1004],[616,893,811,1008],
                  [827,893,1040,1006],[1051,896,1128,1005],[1153,884,1362,1008],[1345,926,1524,1008]];

  // Weapon sheet (weapons.webp) rectangles [x0,y0,x1,y1].
  const WEAPON_RECTS = {
    handL:[36,60,152,198], handR:[164,60,279,197], flame:[343,53,472,197], orb:[542,55,809,198],
    staff:[26,354,212,545], dagger:[237,390,378,545],
    fire1:[96,292,132,335], fire2:[235,288,305,344], fire3:[342,273,508,363],
    exp1:[576,295,619,337], exp2:[653,290,717,346], exp3:[737,270,835,365], exp4:[854,251,986,385],
    potion_red:[698,426,763,520], potion_blue:[792,426,858,520], arrow:[890,464,997,490],
  };

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Cannot load ' + src));
      img.src = src;
    });
  }
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }
  function sourceCtx(img) {
    const g = ctx2d(makeCanvas(img.width, img.height));
    g.drawImage(img, 0, 0);
    return g;
  }

  // Make background pixels connected to the region border transparent.
  function floodKey(id, isBg) {
    const w = id.width, h = id.height, d = id.data;
    const seen = new Uint8Array(w * h), stack = [];
    const push = (x, y) => {
      const i = y * w + x;
      if (!seen[i] && isBg(d, i * 4)) { seen[i] = 1; stack.push(i); }
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      d[i * 4 + 3] = 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    return id;
  }
  const isBlack = (t) => (d, i) => Math.max(d[i], d[i + 1], d[i + 2]) < t;
  const isGray = (d, i) => Math.abs(d[i] - 133) < 26 && Math.abs(d[i + 1] - 133) < 26 && Math.abs(d[i + 2] - 133) < 26;

  // Crop transparent borders; returns a canvas.
  function trimmed(id) {
    const w = id.width, h = id.height, d = id.data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
    const c = makeCanvas(x1 - x0 + 1, y1 - y0 + 1);
    const full = makeCanvas(w, h);
    ctx2d(full).putImageData(id, 0, 0);
    c.getContext('2d').drawImage(full, -x0, -y0);
    return c;
  }

  // ---------------- Textures ----------------
  function buildTextures(img) {
    const src = sourceCtx(img);
    const tmp = makeCanvas(TS, TS), g = ctx2d(tmp);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const names = [], layers = [];
    const cellRect = (r, c) => { const ins = 3; return [GX[c][0] + ins, GY[r][0] + ins, GX[c][1] - GX[c][0] - 2 * ins, GY[r][1] - GY[r][0] - 2 * ins]; };
    const push = (name) => { names.push(name); layers.push(new Uint8Array(g.getImageData(0, 0, TS, TS).data.buffer)); };

    for (const [name, [r, c]] of Object.entries(TEX_CELLS)) {
      g.clearRect(0, 0, TS, TS);
      g.drawImage(img, ...cellRect(r, c), 0, 0, TS, TS);
      if (KEYED[name]) {
        const id = g.getImageData(0, 0, TS, TS), d = id.data;
        for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) < KEYED[name]) d[i + 3] = 0;
        g.putImageData(id, 0, 0);
      }
      push(name);
    }
    for (const [name, [x0, y0, x1, y1]] of Object.entries(BANNERS)) {
      const ban = trimmed(floodKey(src.getImageData(x0, y0, x1 - x0, y1 - y0), isBlack(40)));
      g.clearRect(0, 0, TS, TS);
      g.drawImage(img, ...cellRect(0, 1), 0, 0, TS, TS);
      const h = TS * 0.94, w = ban.width * h / ban.height;
      g.drawImage(ban, (TS - w) / 2, 0, w, h);
      push(name);
    }
    // Burnt-out torch: the flame pixels are filled in from the surrounding
    // wall (diffusion) and a charred stub is left on the sconce.
    {
      g.clearRect(0, 0, TS, TS);
      g.drawImage(img, ...cellRect(...TEX_CELLS.torch), 0, 0, TS, TS);
      const id = g.getImageData(0, 0, TS, TS), d = id.data, mask = new Uint8Array(TS * TS);
      for (let y = 0; y < TS * 0.56; y++) for (let x = Math.floor(TS * 0.25); x < TS * 0.77; x++) {
        const i = (y * TS + x) * 4;
        if (d[i] > 70 && d[i] - d[i + 2] > 30) mask[y * TS + x] = 1;
      }
      // Grow the mask to swallow the flame's glow fringe.
      let grown = mask;
      for (let k = 0; k < 3; k++) {
        const nxt = grown.slice();
        for (let y = 1; y < TS - 1; y++) for (let x = 1; x < TS - 1; x++) {
          if (grown[y * TS + x - 1] || grown[y * TS + x + 1] || grown[(y - 1) * TS + x] || grown[(y + 1) * TS + x]) nxt[y * TS + x] = 1;
        }
        grown = nxt;
      }
      for (let it = 0; it < 60; it++) {
        for (let y = 1; y < TS - 1; y++) for (let x = 1; x < TS - 1; x++) {
          if (!grown[y * TS + x]) continue;
          for (let k = 0; k < 3; k++) {
            const i = (y * TS + x) * 4 + k;
            d[i] = (d[i - 4] + d[i + 4] + d[i - TS * 4] + d[i + TS * 4]) / 4;
          }
        }
      }
      // No warm glow left on the stone: grey it out, slightly sooty.
      for (let p = 0; p < TS * TS; p++) {
        if (!grown[p]) continue;
        const i = p * 4, l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 0.8;
        d[i] = l * 1.02; d[i + 1] = l; d[i + 2] = l * 0.98;
      }
      let bottom = 0;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (mask[y * TS + x]) bottom = Math.max(bottom, y);
      for (let y = bottom - 6; y <= bottom; y++) for (let x = TS / 2 - 5; x < TS / 2 + 5; x++) {
        const i = (y * TS + x) * 4, k = 0.25 + 0.1 * Math.random();
        d[i] = 40 * k; d[i + 1] = 34 * k; d[i + 2] = 30 * k;
      }
      g.putImageData(id, 0, 0);
      push('torch_out');
    }
    // Procedural stone for the 3D pillars: a fluted shaft and plain dressed stone.
    for (const [name, fluted] of [['column', true], ['column_stone', false]]) {
      const id = g.createImageData(TS, TS);
      pillarStone(id.data, fluted);
      g.putImageData(id, 0, 0);
      push(name);
    }
    const data = new Uint8Array(TS * TS * 4 * layers.length);
    layers.forEach((l, i) => data.set(l, i * TS * TS * 4));
    const index = {};
    names.forEach((n, i) => { index[n] = i; });
    return { size: TS, count: names.length, data, index };
  }

  // Warm grey stone with soft blotches and speckles; optional vertical flutes
  // (4 per tile: concave channels separated by bright fillets). Tiles in u and v.
  function pillarStone(d, fluted) {
    let seed = fluted ? 911 : 577;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const N = 8, grid = Array.from({ length: N * N }, rnd);
    const noise = (x, y) => {
      const fx = x / TS * N, fy = y / TS * N, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i, j) => grid[((j % N) * N + (i % N))];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      let k = 0.82 + 0.22 * noise(x, y) + 0.1 * noise(x * 3 % TS, y * 3 % TS) + (rnd() - 0.5) * 0.12;
      if (fluted) {
        const p = (x % 32) / 32;
        if (p < 0.1) k *= 1.12;
        else { const q = (p - 0.1) / 0.9; k *= 0.5 + 0.5 * Math.sin(Math.PI * q) + 0.15 * q; }
      }
      if (rnd() < 0.015) k *= 0.6;
      const i = (y * TS + x) * 4;
      d[i] = Math.min(255, 182 * k); d[i + 1] = Math.min(255, 168 * k); d[i + 2] = Math.min(255, 152 * k); d[i + 3] = 255;
    }
  }

  // ---------------- Enemy frames ----------------
  // Label 8-connected foreground blobs of the whole sheet, so that each frame
  // only keeps the blobs whose centroid lies inside its rectangle.
  function labelBlobs(id) {
    const w = id.width, h = id.height, d = id.data;
    const lab = new Int32Array(w * h).fill(-1);
    const cx = [], cy = [], cnt = [];
    const fg = (i) => Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) > 40;
    const stack = [];
    for (let s = 0; s < w * h; s++) {
      if (lab[s] !== -1 || !fg(s)) continue;
      const id2 = cnt.length;
      let sx = 0, sy = 0, n = 0;
      lab[s] = id2; stack.push(s);
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i / w) | 0;
        sx += x; sy += y; n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (lab[j] === -1 && fg(j)) { lab[j] = id2; stack.push(j); }
        }
      }
      cx.push(sx / n); cy.push(sy / n); cnt.push(n);
    }
    return { lab, cx, cy, cnt, w };
  }
  function extractFrame(sheet, blobs, x0, y0, x1, y1) {
    x0 -= 3; y0 -= 3; x1 += 3; y1 += 3;
    const w = x1 - x0, h = y1 - y0;
    const out = new ImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = (y + y0) * blobs.w + (x + x0), b = blobs.lab[si];
      if (b < 0) continue;
      const bx = blobs.cx[b], by = blobs.cy[b];
      if (bx < x0 || bx >= x1 || by < y0 || by >= y1) continue;
      const di = (y * w + x) * 4;
      out.data[di] = sheet.data[si * 4];
      out.data[di + 1] = sheet.data[si * 4 + 1];
      out.data[di + 2] = sheet.data[si * 4 + 2];
      out.data[di + 3] = 255;
    }
    return trimmed(out);
  }

  // ---------------- Procedural sprites ----------------
  function orb(rgb, size = 32) {
    const c = makeCanvas(size, size), g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(0.3, `rgb(${rgb})`);
    gr.addColorStop(0.75, `rgba(${rgb},0.85)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    // Hard pixel edge: alpha test happens at 0.5, so this keeps a crisp blob.
    return c;
  }
  function keySprite() {
    const c = makeCanvas(24, 40), g = c.getContext('2d');
    g.fillStyle = '#7a5410'; g.fillRect(9, 12, 6, 26); g.fillRect(4, 1, 16, 14);
    g.fillStyle = '#f2c230'; g.fillRect(10, 12, 4, 25); g.fillRect(5, 2, 14, 12);
    g.clearRect(9, 5, 6, 6);
    g.fillStyle = '#f2c230'; g.fillRect(14, 28, 6, 3); g.fillRect(14, 33, 8, 3);
    g.fillStyle = '#fff3a0'; g.fillRect(6, 3, 3, 2); g.fillRect(11, 14, 1, 20);
    return c;
  }
  function tomeSprite() {
    const c = makeCanvas(34, 30), g = c.getContext('2d');
    g.fillStyle = '#3a0d0d'; g.fillRect(1, 2, 32, 27);
    g.fillStyle = '#8c1c13'; g.fillRect(3, 3, 28, 24);
    g.fillStyle = '#e8d9a8'; g.fillRect(3, 26, 28, 3);
    g.fillStyle = '#f2b030';
    g.fillRect(16, 7, 2, 16); g.fillRect(10, 14, 14, 2);
    g.fillRect(12, 9, 2, 2); g.fillRect(20, 9, 2, 2); g.fillRect(12, 19, 2, 2); g.fillRect(20, 19, 2, 2);
    g.fillStyle = '#ffdd66'; g.fillRect(3, 3, 28, 1);
    return c;
  }
  // Soft round blob for ground shadows (blended, not alpha tested).
  function shadowSprite() {
    const S = 48, c = makeCanvas(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  }
  // Decal and mist sprites (soft blended, tinted at draw time).
  function blob(g, x, y, r, a, col = '255,255,255') {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(0.6, `rgba(${col},${a * 0.7})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function scorchSprite() {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    blob(g, S / 2, S / 2, S / 2, 0.75, '0,0,0');
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.22;
      blob(g, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.08 + Math.random() * 0.14), 0.5, '0,0,0');
    }
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      g.lineWidth = 1 + Math.random() * 2;
      g.beginPath();
      g.moveTo(S / 2 + Math.cos(a) * S * 0.2, S / 2 + Math.sin(a) * S * 0.2);
      g.lineTo(S / 2 + Math.cos(a) * S * 0.47, S / 2 + Math.sin(a) * S * 0.47);
      g.stroke();
    }
    return c;
  }
  // Ice splash left by the frost staff: a frosted patch with a ragged edge,
  // ice shards bursting from a dense white impact, fern-like rime growing at
  // the rim, thin blue cracks and sparkles. Colours are baked; the tint only lights it.
  function frostSprite(seed) {
    const S = 96, R = S * 0.46, C = S / 2, c = makeCanvas(S, S), g = c.getContext('2d');
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const N = 6, grid = Array.from({ length: N * N }, rnd);
    const noise = (x, y) => {
      const fx = x / S * N, fy = y / S * N, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const at = (i, j) => grid[((j + N) % N) * N + ((i + N) % N)];
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
    // Frosted patch: a few overlapping lobes so the splash is lopsided.
    const lobes = [[C, C, R * 0.7]];
    for (let k = 0; k < 4; k++) {
      const a = rnd() * Math.PI * 2, dd = R * (0.2 + rnd() * 0.3);
      lobes.push([C + Math.cos(a) * dd, C + Math.sin(a) * dd, R * (0.3 + rnd() * 0.3)]);
    }
    const id = g.createImageData(S, S), d = id.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - C, y - C) / R;
      let lr = 9;
      for (const [lx, ly, lrad] of lobes) lr = Math.min(lr, Math.hypot(x - lx, y - ly) / lrad);
      const e = lr * 0.75 + (noise(x, y) - 0.5) * 0.5 + (noise(x * 3, y * 3) - 0.5) * 0.25;
      let a = Math.max(0, Math.min(1, (1 - e) / 0.4));
      a *= 0.3 + 0.25 * noise(x * 4, y * 4) + 0.3 * Math.max(0, 1 - r * 1.6);
      const w = 0.8 + 0.2 * noise(x * 5, y * 5);
      const i = (y * S + x) * 4;
      d[i] = 172 * w; d[i + 1] = 208 * w; d[i + 2] = 238 * w; d[i + 3] = a * 255;
    }
    g.putImageData(id, 0, 0);
    // Shards bursting out of the impact.
    const shards = 6 + Math.floor(rnd() * 4);
    for (let k = 0; k < shards; k++) {
      const a = rnd() * Math.PI * 2, len = R * (0.25 + rnd() * 0.5), wdt = 0.05 + rnd() * 0.1;
      const tx = C + Math.cos(a) * len, ty = C + Math.sin(a) * len;
      const lx = C + Math.cos(a - wdt) * R * 0.15, ly = C + Math.sin(a - wdt) * R * 0.15;
      const rx = C + Math.cos(a + wdt) * R * 0.15, ry = C + Math.sin(a + wdt) * R * 0.15;
      const gr = g.createLinearGradient(C, C, tx, ty);
      gr.addColorStop(0, 'rgba(225,242,255,0.6)'); gr.addColorStop(1, 'rgba(190,225,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(tx, ty); g.lineTo(rx, ry); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(245,252,255,0.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(tx, ty); g.stroke();
    }
    // Rime ferns growing from the rim.
    g.lineWidth = 1;
    const fern = (x, y, a, len, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.strokeStyle = `rgba(220,240,255,${0.18 + depth * 0.1})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (depth <= 0) return;
      for (let i = 1; i <= 2; i++) {
        const t = i / 3, bx = x + (x2 - x) * t, by = y + (y2 - y) * t;
        for (const sgn of [-1, 1]) fern(bx, by, a + sgn * (0.7 + rnd() * 0.3), len * 0.4, depth - 1);
      }
    };
    for (let k = 0; k < 5; k++) {
      const a = rnd() * Math.PI * 2, r0 = R * (0.4 + rnd() * 0.2);
      fern(C + Math.cos(a) * r0, C + Math.sin(a) * r0, a + (rnd() - 0.5) * 0.8, R * (0.15 + rnd() * 0.15), 2);
    }
    // Frozen droplets thrown around the splash, some with a short streak.
    for (let k = 0; k < 16; k++) {
      const a = rnd() * Math.PI * 2, r = R * (0.55 + rnd() * 0.45), x = C + Math.cos(a) * r, y = C + Math.sin(a) * r, rad = 0.8 + rnd() * 1.8;
      g.fillStyle = 'rgba(215,238,255,0.65)';
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      if (rnd() < 0.4) {
        g.strokeStyle = 'rgba(215,238,255,0.35)';
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a) * rad * 4, y - Math.sin(a) * rad * 4); g.stroke();
      }
    }
    // Dense icy core with thin blue cracks.
    blob(g, C, C, R * 0.2, 0.75, '235,248,255');
    g.strokeStyle = 'rgba(70,120,180,0.55)';
    for (let k = 0; k < 6; k++) {
      let x = C, y = C, a = rnd() * Math.PI * 2;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 4; s++) { a += (rnd() - 0.5) * 0.9; x += Math.cos(a) * R * 0.09; y += Math.sin(a) * R * 0.09; g.lineTo(x, y); }
      g.stroke();
    }
    // Sparkles.
    g.fillStyle = '#fff';
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.85;
      g.fillRect(Math.round(C + Math.cos(a) * r), Math.round(C + Math.sin(a) * r), 1, 1);
    }
    return c;
  }
  function splatSprite() {
    const S = 48, c = makeCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#fff';
    const dot = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    for (let i = 0; i < 6; i++) dot(S / 2 + (Math.random() - 0.5) * 10, S / 2 + (Math.random() - 0.5) * 10, 5 + Math.random() * 6);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 10;
      dot(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 1 + Math.random() * 2.5);
    }
    return c;
  }
  function mistSprite() {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.18;
      blob(g, S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.2 + Math.random() * 0.12), 0.35);
    }
    return c;
  }
  // Soft white radial glow (tinted at draw time).
  function glowSprite() {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    return c;
  }
  // Light shaft: soft across, bright near the window (bottom of the image), fading out at the far end.
  function beamSprite() {
    const W = 32, H = 64, c = makeCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H, i = (y * W + x) * 4;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
      id.data[i + 3] = 255 * Math.max(0, 1 - u * u) ** 1.5 * Math.min(1, (1 - v) * 12) * v ** 1.4;
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  // Soot plume above a torch: narrow at the bottom, spreading and fading upwards, streaky.
  function sootSprite() {
    const W = 48, H = 64, c = makeCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H);
    let seed = 777;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const streak = Array.from({ length: W }, () => 0.75 + rnd() * 0.25);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = 1 - (y + 0.5) / H, half = 0.3 + 0.22 * v, u = Math.abs((x + 0.5) / W - 0.5) / half;
      const a = Math.pow(Math.max(0, 1 - u * u), 0.7) * (1 - v * 0.55) * Math.min(1, v * 5 + 0.35) * streak[x];
      id.data[(y * W + x) * 4 + 3] = 255 * Math.min(1, a);
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  // Thin expanding ring for ripples on water.
  function ringSprite() {
    const S = 64, c = makeCanvas(S, S), g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 12, 0, Math.PI * 2); g.stroke();
    return c;
  }
  // Cobweb hanging from its top edge: radial threads and sagging spiral arcs.
  function webSprite() {
    const W = 64, H = 52, c = makeCanvas(W, H), g = c.getContext('2d');
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.strokeStyle = 'rgba(235,235,235,0.75)'; g.lineWidth = 1;
    const rays = [];
    for (let i = 0; i <= 8; i++) rays.push(Math.PI * (0.02 + 0.96 * i / 8) + (rnd() - 0.5) * 0.08);
    for (const a of rays) { g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2 - Math.cos(a) * W * 0.5, Math.sin(a) * H * 0.98); g.stroke(); }
    g.strokeStyle = 'rgba(220,220,220,0.55)';
    for (let r = 0.18; r < 1; r += 0.14 + rnd() * 0.05) {
      g.beginPath();
      rays.forEach((a, i) => {
        const x = W / 2 - Math.cos(a) * W * 0.5 * r, y = Math.sin(a) * H * 0.98 * r;
        if (i === 0) g.moveTo(x, y);
        else { const pa = rays[i - 1], px = W / 2 - Math.cos(pa) * W * 0.5 * r, py = Math.sin(pa) * H * 0.98 * r; g.quadraticCurveTo((x + px) / 2, (y + py) / 2 + 2.5 * r, x, y); }
      });
      g.stroke();
    }
    return c;
  }
  // Damp moss patch: dense green speckles at the bottom, thinning out upwards.
  function mossSprite() {
    const W = 64, H = 36, c = makeCanvas(W, H), g = c.getContext('2d');
    let seed = 4242;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 520; i++) {
      const x = rnd() * W, y = H - Math.pow(rnd(), 1.8) * H, edge = Math.min(x, W - x) / (W * 0.5);
      if (rnd() > edge * 1.6) continue;
      const k = 0.5 + rnd() * 0.5;
      g.fillStyle = `rgba(${Math.round(60 * k)},${Math.round(110 * k + 20)},${Math.round(35 * k)},${0.55 + rnd() * 0.45})`;
      g.fillRect(Math.floor(x), Math.floor(y), 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 2));
    }
    return c;
  }
  // Long shadow of a column on the floor: soft sides, fading towards the far end (top).
  function columnShadowSprite() {
    const W = 32, H = 64, c = makeCanvas(W, H), g = c.getContext('2d'), id = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H;
      id.data[(y * W + x) * 4 + 3] = 255 * Math.max(0, 1 - u ** 4) * (0.25 + 0.75 * v);
    }
    g.putImageData(id, 0, 0);
    return c;
  }
  function solid(color, s = 4) {
    const c = makeCanvas(s, s), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, s, s);
    return c;
  }

  // ---------------- Atlas packing ----------------
  function packAtlas(entries) {
    const SIZE = 2048, PAD = 2;
    const atlas = makeCanvas(SIZE, SIZE), g = atlas.getContext('2d');
    let x = PAD, y = PAD, rowH = 0;
    const frames = {};
    const sorted = [...entries].sort((a, b) => b.c.height - a.c.height);
    for (const e of sorted) {
      const w = e.c.width, h = e.c.height;
      if (x + w + PAD > SIZE) { x = PAD; y += rowH + PAD; rowH = 0; }
      if (y + h + PAD > SIZE) throw new Error('Sprite atlas overflow');
      g.drawImage(e.c, x, y);
      frames[e.name] = { u0: x / SIZE, v0: y / SIZE, u1: (x + w) / SIZE, v1: (y + h) / SIZE, w, h };
      x += w + PAD;
      rowH = Math.max(rowH, h);
    }
    return { canvas: atlas, frames };
  }

  async function load(onProgress = () => {}) {
    // The crossbow images were cut out of their backgrounds offline (img/crossbow_*.png).
    const [texImg, enemyImg, weaponImg, xbowPickup, xbowHand, xbowEmpty] = await Promise.all([
      loadImage('img/medieval.textures.png'), loadImage('img/enemies.png'), loadImage('img/weapons.webp'),
      loadImage('img/crossbow_pickup.png'), loadImage('img/crossbow_hand.png'), loadImage('img/crossbow_hand_empty.png'),
    ]);
    onProgress('Carving textures');
    await new Promise(requestAnimationFrame);
    const textures = buildTextures(texImg);

    onProgress('Summoning monsters');
    await new Promise(requestAnimationFrame);
    const entries = [];
    const sheet = sourceCtx(enemyImg).getImageData(0, 0, enemyImg.width, enemyImg.height);
    const blobs = labelBlobs(sheet);
    ENEMY_ROWS.forEach((type, r) => {
      ROW_X[r].forEach(([x0, x1], i) => {
        entries.push({ name: `${type}_${i}`, c: extractFrame(sheet, blobs, x0, ROW_Y[r][0], x1, ROW_Y[r][1]) });
      });
    });
    DRAGON.forEach(([x0, y0, x1, y1], i) => {
      entries.push({ name: `dragon_${i}`, c: extractFrame(sheet, blobs, x0, y0, x1, y1) });
    });

    onProgress('Forging weapons');
    await new Promise(requestAnimationFrame);
    const wsrc = sourceCtx(weaponImg);
    const views = {};
    for (const [name, [x0, y0, x1, y1]] of Object.entries(WEAPON_RECTS)) {
      views[name] = trimmed(floodKey(wsrc.getImageData(x0, y0, x1 - x0, y1 - y0), isGray));
    }
    const asCanvas = (img) => { const c = makeCanvas(img.width, img.height); ctx2d(c).drawImage(img, 0, 0); return c; };
    views.xbow = asCanvas(xbowHand);
    views.xbowEmpty = asCanvas(xbowEmpty);
    for (const n of ['fire1','fire2','fire3','exp1','exp2','exp3','exp4','potion_red','potion_blue','arrow']) {
      entries.push({ name: n, c: views[n] });
    }
    entries.push({ name: 'crossbow_pickup', c: asCanvas(xbowPickup) });
    entries.push({ name: 'orb_blue', c: orb('120,190,255') });
    entries.push({ name: 'orb_red', c: orb('255,70,50') });
    entries.push({ name: 'orb_green', c: orb('120,255,90') });
    entries.push({ name: 'orb_purple', c: orb('200,110,255') });
    entries.push({ name: 'key', c: keySprite() });
    entries.push({ name: 'tome', c: tomeSprite() });
    entries.push({ name: 'white', c: solid('#fff') });
    entries.push({ name: 'shadow', c: shadowSprite() });
    entries.push({ name: 'colshadow', c: columnShadowSprite() });
    entries.push({ name: 'glow', c: glowSprite() });
    entries.push({ name: 'beam', c: beamSprite() });
    entries.push({ name: 'soot', c: sootSprite() });
    entries.push({ name: 'ring', c: ringSprite() });
    entries.push({ name: 'web', c: webSprite() });
    entries.push({ name: 'moss', c: mossSprite() });
    entries.push({ name: 'scorch', c: scorchSprite() });
    for (let i = 0; i < 3; i++) entries.push({ name: `frost${i}`, c: frostSprite(4111 + i * 7919) });
    entries.push({ name: 'splat', c: splatSprite() });
    entries.push({ name: 'mist', c: mistSprite() });
    const atlas = packAtlas(entries);
    return { textures, atlas, views };
  }

  return { load, loadImage };
})();
