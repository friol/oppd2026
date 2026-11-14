'use strict';
// World: parses a level map into cells, builds the static 3D mesh, bakes a
// shadowed lightmap and answers collision / visibility / pathfinding queries.
//
// LEGEND
//   Walls:  # stone  M mossy stone  B red brick  D dark brick  L big blocks  C purple cobble
//           K dark brick  S skulls  O bones  R rock  U wood  J metal  A gold  V vines  I ivy
//           T torch  X/Y crystals  W stained glass  N rose window  F waterfall  Z skull relief
//           Q gargoyle statue  G gargoyle trap (spits fire)  1-4 banners  E exit lever
//   Floors: . floor  , carpet  : tall hall  * open sky  ~ lava pit  _ water  c crate  ^ dais  p trap plate
//   Doors:  + wooden door  = locked door (key)  H locked portcullis (key)  % secret push wall
//   Things: @ player  s skeleton  o orc  m wizard  d demon  z zombie  a spider  e eye  g slime
//           f ghost  x dragon  h health  j mana  b bolts  k key  r crossbow  t fire tome  i pillar
const World = (() => {
  const CEIL = 1.5, TALL = 2.6, SKY = 3.2, LM_RES = 8, STEP = 0.4;
  const WALLS = {
    '#': 'stone', M: 'stone_moss', B: 'brick_red', D: 'brick_dark', L: 'block_big', C: 'cobble_purple',
    K: 'dark_brick', S: 'skull_wall', O: 'bones', R: 'rock', U: 'wood_dark', J: 'metal_panel', A: 'gold',
    V: 'vines', I: 'ivy', T: 'torch', X: 'crystal_purple', Y: 'crystal_blue', W: 'stained', N: 'rose',
    F: 'waterfall', Z: 'skull_relief', Q: 'gargoyle_statue', G: 'gargoyle', E: 'lever',
    1: 'banner_red', 2: 'banner_blue', 3: 'banner_purple', 4: 'banner_green',
  };
  // [color, intensity, radius] of lights emitted by wall tiles.
  const WALL_LIGHTS = {
    T: [[1.0, 0.6, 0.26], 1.5, 5.5], X: [[0.75, 0.35, 1.0], 1.1, 4.5], Y: [[0.35, 0.65, 1.0], 1.1, 4.5],
    W: [[0.7, 0.55, 1.0], 0.7, 4], N: [[0.9, 0.5, 0.7], 0.8, 4.5], F: [[0.4, 0.6, 0.9], 0.6, 3.5], E: [[0.5, 1.0, 0.5], 0.7, 2.5],
  };
  // 6 = free-standing prop: lightmap sampled further out along the normal so round shapes get shaded.
  // 7 = metal (shiny highlights), 8 = wet floor (set per level, see create()).
  const FLAG = { lava: 1, water: 2, waterfall: 3, crystal_purple: 4, crystal_blue: 4, torch: 5, column: 6, column_stone: 6,
    iron_door: 7, bars: 7, cage: 7, metal_panel: 7, metal_floor: 7, gold: 7, lever: 7,
    // 9 = cloth (banners sway), 10 = foliage (ivy and vines tremble).
    banner_red: 9, banner_blue: 9, banner_purple: 9, banner_green: 9, ivy: 10, vines: 10 };
  const WET = 8 * 256;
  const ENTITY = { s: 'skeleton', o: 'orc', m: 'wizard', d: 'demon', z: 'zombie', a: 'spider', e: 'eye', g: 'slime', f: 'ghost', x: 'dragon' };
  const ITEMS = { h: 'health', j: 'mana', b: 'bolts', k: 'key', r: 'crossbow', t: 'tome' };
  const BASE = { '.': 1, ',': 1, ':': 1, '*': 1 };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function create(level, tex) {
    const rows = level.map, H = rows.length, W = rows[0].length;
    const T = (n) => {
      const i = tex.index[n];
      if (i === undefined) throw new Error('Unknown texture ' + n);
      return i + 256 * (FLAG[n] || 0);
    };
    const cells = new Array(W * H);
    const spawns = [], items = [], decor = [], doors = [], pushwalls = [], turrets = [], lights = [], plates = [], waters = [], torches = [], crystals = [];
    const windows = [], falls = [], cobwebs = [], moss = [];
    let start = { x: 1.5, z: 1.5 };

    for (let z = 0; z < H; z++) {
      if (rows[z].length !== W) throw new Error(`Map row ${z} has wrong length`);
      for (let x = 0; x < W; x++) {
        const ch = rows[z][x];
        if (WALLS[ch]) { cells[z * W + x] = { solid: true, ch, wall: T(WALLS[ch]) }; continue; }
        const c = { solid: false, ch, f: 0, c: CEIL, floor: T(level.floor) + (level.wet ? WET : 0), ceil: T(level.ceil), sky: false, kind: '', side: T(level.side), base: !!BASE[ch], seen: false };
        if (ch === ',') c.floor = T(level.alt);
        if (ch === ':') c.c = TALL;
        if (ch === '*') { c.c = SKY; c.sky = true; c.floor = T(level.outdoor); }
        cells[z * W + x] = c;
      }
    }
    const at = (x, z) => (x < 0 || z < 0 || x >= W || z >= H) ? null : cells[z * W + x];
    const solidAt = (x, z) => { const c = at(x, z); return !c || c.solid; };

    // Non-base open cells inherit ceiling/floor from the nearest base cell.
    const src = new Int32Array(W * H).fill(-1), q = [];
    cells.forEach((c, i) => { if (!c.solid && c.base) { src[i] = i; q.push(i); } });
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, z = (i / W) | 0;
      for (const [dx, dz] of DIRS) {
        const n = at(x + dx, z + dz);
        if (!n || n.solid) continue;
        const j = (z + dz) * W + x + dx;
        if (src[j] === -1) { src[j] = src[i]; q.push(j); }
      }
    }
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = z * W + x, c = cells[i];
      if (c.solid) continue;
      if (!c.base && src[i] >= 0) {
        const b = cells[src[i]];
        c.c = b.c; c.sky = b.sky; c.floor = b.floor; c.ceil = b.ceil;
      }
      const ch = c.ch, cx = x + 0.5, cz = z + 0.5;
      if (ch === '~') { c.f = -0.45; c.floor = T('lava'); c.kind = 'lava'; lights.push({ x: cx, z: cz, col: [1, 0.42, 0.1], i: 0.42, r: 2.4 }); }
      else if (ch === '_') { c.f = -0.25; c.floor = T('water'); c.kind = 'water'; waters.push({ x: cx, z: cz }); }
      else if (ch === 'c') { c.f = 0.6; c.floor = T('crate'); c.side = T('crate'); c.kind = 'crate'; }
      else if (ch === '^') { c.f = 0.3; c.floor = T('red_tile'); c.side = T('block_big'); }
      else if (ch === 'p') { c.floor = T('plate'); c.kind = 'plate'; plates.push({ x, z, cool: 0 }); }
      else if (ch === '+' || ch === '=' || ch === 'H') {
        c.c = CEIL; c.sky = false; c.ceil = T(level.ceil);
        const orient = (solidAt(x - 1, z) && solidAt(x + 1, z)) ? 'x' : 'z';
        c.door = {
          x, z, orient, open: 0, state: 'closed', timer: 0, locked: ch !== '+', gate: ch === 'H',
          tex: T(ch === '+' ? 'door_wood' : ch === '=' ? 'iron_door' : 'bars'),
        };
        doors.push(c.door);
      } else if (ch === '%') {
        const count = {};
        for (const [dx, dz] of DIRS) { const n = at(x + dx, z + dz); if (n && n.solid) count[n.wall] = (count[n.wall] || 0) + 1; }
        const texId = +Object.keys(count).sort((a, b) => count[b] - count[a])[0];
        pushwalls.push({ x, z, tex: texId, f: c.f, c: c.c, moving: false, dx: 0, dz: 0, moved: 0, found: false });
      } else if (ch === '@') start = { x: cx, z: cz };
      else if (ENTITY[ch]) spawns.push({ type: ENTITY[ch], x: cx, z: cz });
      else if (ITEMS[ch]) items.push({ type: ITEMS[ch], x: cx, z: cz });
      else if (ch === 'i') decor.push({ type: 'pillar', x: cx, z: cz, r: 0.36, h: 9, shaft: T('column'), stone: T('column_stone') });
    }

    // Lights and traps attached to wall faces.
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = cells[z * W + x];
      if (!c.solid) continue;
      for (const [dx, dz] of DIRS) {
        const n = at(x + dx, z + dz);
        if (!n || n.solid) continue;
        const fx = x + 0.5 + dx * 0.5, fz = z + 0.5 + dz * 0.5;
        const L = WALL_LIGHTS[c.ch];
        if (L) lights.push({ x: fx + dx * 0.3, z: fz + dz * 0.3, col: L[0], i: L[1], r: L[2], cell: z * W + x });
        if (c.ch === 'F') waters.push({ x: fx + dx * 0.1, z: fz + dz * 0.1 });
        if (c.ch === 'T') torches.push({ x: fx + dx * 0.1, z: fz + dz * 0.1, cell: z * W + x, dx, dz, f: n.f, c: n.sky ? n.f + 3 : n.c });
        if (c.ch === 'X' || c.ch === 'Y') crystals.push({ x: fx + dx * 0.1, z: fz + dz * 0.1 });
        if (c.ch === 'W' || c.ch === 'N') windows.push({ x: fx, z: fz, dx, dz, f: n.f, col: WALL_LIGHTS[c.ch][0] });
        if (c.ch === 'F') falls.push({ x: fx, z: fz, dx, dz, f: n.f });
        // Moss creeping up the foot of indoor walls (deterministic scatter).
        if (!n.sky && !DECORATED.test(c.ch) && hash2(x * 7 + dx, z * 13 + dz) < 0.3) moss.push({ x: fx + dx * 0.012, z: fz + dz * 0.012, dx, dz, f: n.f, s: 0.4 + hash2(x, z * 3 + dx) * 0.4 });
        if (c.ch === 'G') turrets.push({ x: fx + dx * 0.2, z: fz + dz * 0.2, nx: dx, nz: dz, cool: 1 + Math.random() * 2 });
      }
    }

    // Cobwebs in upper corners of indoor rooms (two perpendicular walls meeting).
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = cells[z * W + x];
      if (c.solid || c.sky || c.door) continue;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (!solidAt(x + sx, z) || !solidAt(x, z + sz) || hash2(x * 3 + sx, z * 5 + sz) > 0.35) continue;
        const kx = x + (sx > 0 ? 1 : 0), kz = z + (sz > 0 ? 1 : 0);
        const size = 0.35 + hash2(x + sx * 9, z - sz * 7) * 0.3;
        cobwebs.push({ x: kx, z: kz, sx, sz, top: c.c, size });
      }
    }
    // Furniture: sarcophagi in dead-end alcoves, altars under stained-glass windows.
    const taken = (x, z) => spawns.concat(items, decor).some((o) => Math.floor(o.x) === x && Math.floor(o.z) === z) || (Math.floor(start.x) === x && Math.floor(start.z) === z);
    const plain = (c) => c && !c.solid && !c.sky && !c.door && !c.kind && BASE[c.ch] && !pushwalls.some((p) => cells[p.z * W + p.x] === c);
    let sarco = 0;
    for (let z = 1; z < H - 1 && sarco < 3; z++) for (let x = 1; x < W - 1 && sarco < 3; x++) {
      const c = cells[z * W + x];
      if (!plain(c) || taken(x, z)) continue;
      const open = DIRS.filter(([dx, dz]) => !solidAt(x + dx, z + dz));
      if (open.length !== 1 || DIRS.some(([dx, dz]) => { const n = at(x + dx, z + dz); return n && n.solid && DECORATED.test(n.ch); })) continue;
      const [ox, oz] = open[0], nb = at(x + ox, z + oz);
      if (!nb || nb.door) continue;
      decor.push({ type: 'sarcophagus', x: x + 0.5 - ox * 0.08, z: z + 0.5 - oz * 0.08, r: 0.42, h: 0.5, ax: ox !== 0 ? 1 : 0, f: c.f, tex: T('column_stone'), lid: T('block_big') });
      sarco++;
    }
    let altars = 0;
    for (const wdw of windows) {
      if (altars >= 4) break;
      const x = Math.floor(wdw.x + wdw.dx * 0.5), z = Math.floor(wdw.z + wdw.dz * 0.5), c = at(x, z);
      if (!plain(c) || taken(x, z)) continue;
      const side = [[wdw.dz, wdw.dx], [-wdw.dz, -wdw.dx]].every(([px, pz]) => !solidAt(x + px, z + pz));
      if (!side || solidAt(x + wdw.dx, z + wdw.dz)) continue;
      decor.push({ type: 'altar', x: x + 0.5 - wdw.dx * 0.22, z: z + 0.5 - wdw.dz * 0.22, r: 0.38, h: 0.6, ax: wdw.dx !== 0 ? 0 : 1, f: c.f,
        tex: T('column_stone'), top: T('carpet_red') });
      altars++;
    }

    const world = {
      W, H, cells, at, start, spawns, items, decor, doors, pushwalls, turrets, lights, plates, level, windows, falls, cobwebs, moss,
      mesh: null, lightmap: null, flow: new Int16Array(W * H), flowFly: new Int16Array(W * H),
      plainWall: T(level.side), waters, torches, crystals, torchOut: T('torch_out'), beam: T('wood_dark'),
    };
    world.mesh = buildMesh(world);
    world.lightmap = bakeLightmap(world);
    return world;
  }

  // ---------------- Geometry ----------------
  // Vertex: x y z  u v  layer  shade  nx ny nz  (10 floats)
  function quad(out, p, uv, layer, shade, n) {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      out.push(p[k][0], p[k][1], p[k][2], uv[k][0], uv[k][1], layer, shade[k], n[0], n[1], n[2]);
    }
  }
  // A vertical face on the boundary between cell (x,z) and its neighbor in dir (dx,dz).
  function wallFace(out, x, z, dx, dz, y0, y1, layer, sameTile) {
    if (y1 - y0 < 0.001) return;
    let ax, az, bx, bz;
    if (dx === 1) { ax = x + 1; az = z; bx = x + 1; bz = z + 1; }
    else if (dx === -1) { ax = x; az = z + 1; bx = x; bz = z; }
    else if (dz === 1) { ax = x + 1; az = z + 1; bx = x; bz = z + 1; }
    else { ax = x; az = z; bx = x + 1; bz = z; }
    const n = [-dx, 0, -dz];
    const s = dx !== 0 ? 0.78 : 1.0;
    // Texture tiles align with world height; sameTile stretches 1 tile over the face.
    const v0 = sameTile ? 1 : -y0, v1 = sameTile ? 0 : -y1;
    quad(out, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]],
      [[0, v0], [1, v0], [1, v1], [0, v1]], layer, [s * 0.8, s * 0.8, s, s], n);
  }

  const DECORATED = /[TXYWNZQGE1234]/;
  // Texture of the plain wall continuing the same wall line as an ornamental tile.
  function frameTex(w, x, z, dx, dz) {
    for (let k = 1; k < 4; k++) {
      for (const s of [1, -1]) {
        const c = w.at(x + dz * k * s, z + dx * k * s);
        if (c && c.solid && !DECORATED.test(c.ch)) return c.wall;
      }
    }
    return w.plainWall;
  }

  function buildMesh(w) {
    const out = [];
    const { W, H, at } = w;
    const solidCell = (x, z) => { const c = at(x, z); return !c || c.solid; };
    const ao = (cx, cz) => {
      let n = 0;
      if (solidCell(cx - 1, cz - 1)) n++; if (solidCell(cx, cz - 1)) n++;
      if (solidCell(cx - 1, cz)) n++; if (solidCell(cx, cz)) n++;
      return 1 - 0.14 * n;
    };
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = at(x, z);
      if (c.solid) continue;
      const cornersAo = [ao(x, z), ao(x + 1, z), ao(x + 1, z + 1), ao(x, z + 1)];
      const fy = c.f;
      if (c.kind === 'water') {
        // Finely split so the vertex shader can make the surface ripple.
        const N = 6;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const x0 = x + i / N, x1 = x + (i + 1) / N, z0 = z + j / N, z1 = z + (j + 1) / N;
          quad(out, [[x0, fy, z0], [x1, fy, z0], [x1, fy, z1], [x0, fy, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c.floor, [0.95, 0.95, 0.95, 0.95], [0, 1, 0]);
        }
      } else {
        quad(out, [[x, fy, z], [x + 1, fy, z], [x + 1, fy, z + 1], [x, fy, z + 1]],
          [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], c.floor, cornersAo.map((a) => a * 0.95), [0, 1, 0]);
      }
      // Wooden ceiling beams across indoor rooms, one every third column.
      if (!c.sky && !c.door && x % 3 === 1) box(out, x + 0.42, x + 0.58, c.c - 0.14, c.c, z, z + 1, w.beam, [true, true, false, false, false, true]);
      if (!c.sky) {
        const cy = c.c;
        quad(out, [[x, cy, z], [x + 1, cy, z], [x + 1, cy, z + 1], [x, cy, z + 1]],
          [[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1]], c.ceil, cornersAo.map((a) => a * 0.7), [0, -1, 0]);
      }
      for (const [dx, dz] of DIRS) {
        const n = at(x + dx, z + dz);
        if (!n || n.solid) {
          const layer = n ? n.wall : at(x, z).side;
          const decorated = n && DECORATED.test(n.ch);
          // Under open sky the wall stops at RUIN_CUT; its broken crown is added by ruinTops().
          const top = c.sky && n ? RUIN_CUT : c.c;
          if (decorated && top - c.f > 1.6) {
            // Tall faces: ornament once at eye level, plain wall tiles above and below.
            const plain = frameTex(w, x + dx, z + dz, dx, dz);
            wallFace(out, x, z, dx, dz, c.f, c.f + 0.2, plain, false);
            wallFace(out, x, z, dx, dz, c.f + 0.2, c.f + 1.4, layer, true);
            wallFace(out, x, z, dx, dz, c.f + 1.4, top, plain, false);
          } else if (decorated) {
            wallFace(out, x, z, dx, dz, c.f, top, layer, true);
          } else {
            wallFace(out, x, z, dx, dz, c.f, top, layer, false);
          }
          continue;
        }
        if (n.f > c.f) wallFace(out, x, z, dx, dz, c.f, Math.min(n.f, c.c), n.side, false);
        if (n.c < c.c) wallFace(out, x, z, dx, dz, Math.max(n.c, c.f), c.c, at(x, z).side, false);
      }
    }
    for (const d of w.decor) {
      const c = at(Math.floor(d.x), Math.floor(d.z));
      if (d.type === 'pillar') pillar(out, d, c);
      else if (d.type === 'sarcophagus') {
        const hx = d.ax ? 0.4 : 0.26, hz = d.ax ? 0.26 : 0.4;
        box(out, d.x - hx, d.x + hx, c.f, c.f + 0.4, d.z - hz, d.z + hz, d.tex, [true, true, true, true, false, false], 0.8);
        box(out, d.x - hx - 0.04, d.x + hx + 0.04, c.f + 0.4, c.f + 0.5, d.z - hz - 0.04, d.z + hz + 0.04, d.lid, [true, true, true, true, true, true]);
        box(out, d.x - hx * 0.6, d.x + hx * 0.6, c.f + 0.5, c.f + 0.56, d.z - hz * 0.6, d.z + hz * 0.6, d.lid, [true, true, true, true, true, false]);
      } else if (d.type === 'altar') {
        const hx = d.ax ? 0.4 : 0.22, hz = d.ax ? 0.22 : 0.4;
        box(out, d.x - hx, d.x + hx, c.f, c.f + 0.52, d.z - hz, d.z + hz, d.tex, [true, true, true, true, false, false], 0.85);
        box(out, d.x - hx - 0.05, d.x + hx + 0.05, c.f + 0.52, c.f + 0.6, d.z - hz - 0.05, d.z + hz + 0.05, d.tex, [true, true, true, true, false, true]);
        box(out, d.x - hx + 0.02, d.x + hx - 0.02, c.f + 0.6, c.f + 0.61, d.z - hz + 0.02, d.z + hz - 0.02, d.top, [false, false, false, false, true, false]);
      }
    }
    ruinTops(out, w);
    return new Float32Array(out);
  }

  // ---------------- Ruined wall tops ----------------
  // Wall cells touching open sky get a broken crown: each cell's top is split
  // into 4x4 stone blocks whose heights drop by whole brick courses, following
  // a smooth noise (long breaches) plus per-block jitter. Heights depend only
  // on world position, so neighbouring cells match; step faces are emitted
  // only on the higher side of each height change.
  const RUIN_CUT = SKY - 1.0, RUIN_N = 4;
  function hash2(x, z) {
    let h = Math.imul(x, 374761393) + Math.imul(z, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z), tx = x - x0, tz = z - z0;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    return (hash2(x0, z0) * (1 - sx) + hash2(x0 + 1, z0) * sx) * (1 - sz) + (hash2(x0, z0 + 1) * (1 - sx) + hash2(x0 + 1, z0 + 1) * sx) * sz;
  }
  function ruinTops(out, w) {
    const { W, H, at } = w;
    const ruin = new Uint8Array(W * H), floorMin = new Float32Array(W * H);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = at(x, z);
      if (!c.solid) continue;
      let sky = false, min = 0;
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        const n = at(x + ox, z + oz);
        if (!n || n.solid) continue;
        if (n.sky) sky = true; else min = Math.max(min, n.c);
      }
      ruin[z * W + x] = sky ? 1 : 0;
      floorMin[z * W + x] = min;
    }
    const S = 1 / RUIN_N;
    // Height of sub-block (gx, gz); null outside the map, -Infinity for open cells.
    const height = (gx, gz) => {
      const x = Math.floor(gx / RUIN_N), z = Math.floor(gz / RUIN_N), c = at(x, z);
      if (!c) return null;
      if (!c.solid) return -Infinity;
      if (!ruin[z * W + x]) return SKY;
      const big = vnoise(gx / 9, gz / 9), small = hash2(gx, gz);
      const drop = Math.min(0.75, Math.max(0, Math.round((big * 1.1 + small * 0.35 - 0.45) * 4) / 4));
      return Math.max(SKY - drop, floorMin[z * W + x] + 0.05);
    };
    const vface = (ax, az, bx, bz, y0, y1, layer, n, u0, u1) => {
      const s = n[0] !== 0 ? 0.78 : 1.0;
      quad(out, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]],
        [[u0, -y0], [u1, -y0], [u1, -y1], [u0, -y1]], layer, [s * 0.85, s * 0.85, s, s], n);
    };
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (!ruin[z * W + x]) continue;
      // Ornaments (torches, banners...) stay at eye level: the crown is plain wall (waterfalls keep flowing).
      const cc = at(x, z), deco = DECORATED.test(cc.ch) && cc.ch !== 'F';
      const layer = deco ? frameTex(w, x, z, 1, 0) : cc.wall;
      for (let j = 0; j < RUIN_N; j++) for (let i = 0; i < RUIN_N; i++) {
        const gx = x * RUIN_N + i, gz = z * RUIN_N + j, h = height(gx, gz);
        const x0 = gx * S, x1 = x0 + S, z0 = gz * S, z1 = z0 + S;
        quad(out, [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]],
          [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], layer, [0.92, 0.92, 0.92, 0.92], [0, 1, 0]);
        for (const [dx, dz] of DIRS) {
          let hn = height(gx + dx, gz + dz);
          if (hn === null) continue;
          if (hn === -Infinity) {
            // Open neighbour: only the sky side shows the crown (from the cut up).
            const n = at(Math.floor((gx + dx) / RUIN_N), Math.floor((gz + dz) / RUIN_N));
            if (!n.sky) continue;
            hn = RUIN_CUT;
          }
          if (hn >= h - 1e-4) continue;
          // Fallen stones at the foot of deep breaches, on the sky side.
          if (hn === RUIN_CUT && h < SKY - 0.2) {
            const n = at(Math.floor((gx + dx) / RUIN_N), Math.floor((gz + dz) / RUIN_N));
            const cnt = Math.floor(hash2(gx * 3 + dx, gz * 5 + dz) * (SKY - h) * 4.5);
            for (let k = 0; k < cnt; k++) {
              const r1 = hash2(gx + k * 17, gz - k * 11), r2 = hash2(gx * 7 - k, gz * 3 + k * 5), r3 = hash2(gx - k * 3, gz + k * 13);
              const sz = 0.05 + r3 * 0.09, along = (r1 - 0.5) * S * 2, out2 = 0.1 + r2 * 0.6;
              const cx = (dx !== 0 ? (dx > 0 ? x1 : x0) + dx * out2 : (x0 + x1) / 2 + along);
              const cz = (dz !== 0 ? (dz > 0 ? z1 : z0) + dz * out2 : (z0 + z1) / 2 + along);
              if (n.kind === 'water' || n.kind === 'lava') continue;
              box(out, cx - sz, cx + sz, n.f, n.f + sz * (1.1 + r1 * 0.6), cz - sz * (0.8 + r2 * 0.5), cz + sz * (0.8 + r2 * 0.5), layer, [true, true, true, true, true, false], 0.8);
            }
          }
          // Face on the boundary towards (dx, dz), wound like wallFace's.
          if (dx === 1) vface(x1, z0, x1, z1, hn, h, layer, [1, 0, 0], z0, z1);
          else if (dx === -1) vface(x0, z1, x0, z0, hn, h, layer, [-1, 0, 0], -z1, -z0);
          else if (dz === 1) vface(x1, z1, x0, z1, hn, h, layer, [0, 0, 1], -x1, -x0);
          else vface(x0, z0, x1, z0, hn, h, layer, [0, 0, -1], x0, x1);
        }
      }
    }
  }

  // Axis-aligned box; faces = [+x, -x, +z, -z, top, bottom]. UVs follow world units.
  function box(out, x0, x1, y0, y1, z0, z1, layer, faces, dark = 1) {
    const k = dark;
    if (faces[0]) quad(out, [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [[z0, -y0], [z1, -y0], [z1, -y1], [z0, -y1]], layer, [0.62 * k, 0.62 * k, 0.78 * k, 0.78 * k], [1, 0, 0]);
    if (faces[1]) quad(out, [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [[-z1, -y0], [-z0, -y0], [-z0, -y1], [-z1, -y1]], layer, [0.62 * k, 0.62 * k, 0.78 * k, 0.78 * k], [-1, 0, 0]);
    if (faces[2]) quad(out, [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [[-x1, -y0], [-x0, -y0], [-x0, -y1], [-x1, -y1]], layer, [0.8 * k, 0.8 * k, k, k], [0, 0, 1]);
    if (faces[3]) quad(out, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[x0, -y0], [x1, -y0], [x1, -y1], [x0, -y1]], layer, [0.8 * k, 0.8 * k, k, k], [0, 0, -1]);
    if (faces[4]) quad(out, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], layer, [k, k, k, k], [0, 1, 0]);
    if (faces[5]) quad(out, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], layer, [0.55, 0.55, 0.55, 0.55], [0, -1, 0]);
  }

  // Classical column: square plinth, round torus, fluted shaft (slight taper),
  // flared echinus and a square abacus, from the floor up to the ceiling.
  function pillar(out, d, c) {
    const y0 = c.f, y1 = c.sky ? c.f + 2.2 : c.c, x = d.x, z = d.z;
    const SEG = 16;
    const box = (h, ya, yb, layer, top, bottom) => {
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [nx, nz] of sides) {
        // Corners going counter-clockwise seen from outside.
        const tx = -nz, tz = nx;
        const ax = x + nx * h - tx * h, az = z + nz * h - tz * h, bx = x + nx * h + tx * h, bz = z + nz * h + tz * h;
        const s = nx !== 0 ? 0.8 : 1.0;
        quad(out, [[ax, ya, az], [bx, ya, bz], [bx, yb, bz], [ax, yb, az]],
          [[0, -ya], [2 * h, -ya], [2 * h, -yb], [0, -yb]], layer, [s * 0.85, s * 0.85, s, s], [nx, 0, nz]);
      }
      if (top) quad(out, [[x - h, yb, z - h], [x + h, yb, z - h], [x + h, yb, z + h], [x - h, yb, z + h]],
        [[0, 0], [2 * h, 0], [2 * h, 2 * h], [0, 2 * h]], layer, [1, 1, 1, 1], [0, 1, 0]);
      if (bottom) quad(out, [[x - h, ya, z - h], [x + h, ya, z - h], [x + h, ya, z + h], [x - h, ya, z + h]],
        [[0, 0], [2 * h, 0], [2 * h, 2 * h], [0, 2 * h]], layer, [0.6, 0.6, 0.6, 0.6], [0, -1, 0]);
    };
    // Frustum between radii ra (at ya) and rb (at yb); u wraps `rep` times around.
    const ring = (ra, rb, ya, yb, layer, rep, shadeA, shadeB) => {
      const ny = (ra - rb) / Math.max(0.01, yb - ya) * 0.5;
      for (let i = 0; i < SEG; i++) {
        const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const am = (a0 + a1) / 2, n = [Math.cos(am), ny, Math.sin(am)];
        const sh = 0.82 + 0.18 * Math.abs(Math.sin(am));
        quad(out, [[x + c1 * ra, ya, z + s1 * ra], [x + c0 * ra, ya, z + s0 * ra], [x + c0 * rb, yb, z + s0 * rb], [x + c1 * rb, yb, z + s1 * rb]],
          [[(i + 1) / SEG * rep, -ya], [i / SEG * rep, -ya], [i / SEG * rep, -yb], [(i + 1) / SEG * rep, -yb]],
          layer, [sh * shadeA, sh * shadeA, sh * shadeB, sh * shadeB], n);
      }
    };
    box(0.37, y0, y0 + 0.12, d.stone, true, false);
    box(0.32, y0 + 0.12, y0 + 0.18, d.stone, true, false);
    ring(0.3, 0.3, y0 + 0.18, y0 + 0.24, d.stone, 2, 0.85, 0.95);
    ring(0.3, 0.24, y0 + 0.24, y0 + 0.28, d.stone, 2, 0.95, 0.95);
    const sTop = y1 - 0.28;
    ring(0.24, 0.22, y0 + 0.28, sTop, d.shaft, 4, 0.85, 1);
    ring(0.24, 0.24, sTop, sTop + 0.04, d.stone, 2, 1, 1);
    ring(0.24, 0.33, sTop + 0.04, y1 - 0.14, d.stone, 2, 1, 1);
    box(0.38, y1 - 0.14, y1, d.stone, c.sky, true);
  }

  // Dynamic geometry: doors and push walls, rebuilt every frame.
  function dynamicMesh(w) {
    const out = [];
    for (const d of w.doors) {
      if (d.open >= 0.999 && !d.gate) continue;
      const c = w.at(d.x, d.z), y0 = c.f, y1 = c.c, t = 0.06;
      let a0, a1;
      if (d.gate) {
        const lift = d.open * (y1 - y0) * 0.95;
        a0 = y0 + lift; a1 = y1 + lift;
        if (a0 >= y1 - 0.01) continue;
        a1 = y1;
      } else { a0 = y0; a1 = y1; }
      const off = d.gate ? 0 : d.open;
      const vTop = d.gate ? (a1 - a0) / (y1 - y0) : 0;
      if (d.orient === 'x') {
        const x0 = d.x + off, x1 = d.x + 1 + off, zm = d.z + 0.5;
        for (const s of [-1, 1]) {
          quad(out, [[x0, a0, zm + s * t], [x1, a0, zm + s * t], [x1, a1, zm + s * t], [x0, a1, zm + s * t]],
            [[0, 1], [1, 1], [1, 1 - (d.gate ? vTop : 1)], [0, 1 - (d.gate ? vTop : 1)]], d.tex, [0.85, 0.85, 1, 1], [0, 0, s]);
        }
        quad(out, [[x0, a0, zm - t], [x0, a0, zm + t], [x0, a1, zm + t], [x0, a1, zm - t]],
          [[0, 1], [0.05, 1], [0.05, 0], [0, 0]], d.tex, [0.6, 0.6, 0.7, 0.7], [-1, 0, 0]);
      } else {
        const z0 = d.z + off, z1 = d.z + 1 + off, xm = d.x + 0.5;
        for (const s of [-1, 1]) {
          quad(out, [[xm + s * t, a0, z0], [xm + s * t, a0, z1], [xm + s * t, a1, z1], [xm + s * t, a1, z0]],
            [[0, 1], [1, 1], [1, 1 - (d.gate ? vTop : 1)], [0, 1 - (d.gate ? vTop : 1)]], d.tex, [0.7, 0.7, 0.8, 0.8], [s, 0, 0]);
        }
        quad(out, [[xm - t, a0, z0], [xm + t, a0, z0], [xm + t, a1, z0], [xm - t, a1, z0]],
          [[0, 1], [0.05, 1], [0.05, 0], [0, 0]], d.tex, [0.6, 0.6, 0.7, 0.7], [0, 0, -1]);
      }
    }
    for (const p of w.pushwalls) {
      const x0 = p.x, z0 = p.z, x1 = x0 + 1, z1 = z0 + 1, y0 = p.f - 0.5, y1 = p.c;
      const faces = [
        [[[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], 0.78],
        [[[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [-1, 0, 0], 0.78],
        [[[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, 1], 1],
        [[[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], 1],
      ];
      for (const [pts, n, s] of faces) {
        quad(out, pts, [[0, -y0], [1, -y0], [1, -y1], [0, -y1]], p.tex, [s * 0.8, s * 0.8, s, s], n);
      }
    }
    return new Float32Array(out);
  }

  // ---------------- Lightmap ----------------
  function bakeLightmap(w) {
    const LW = w.W * LM_RES, LH = w.H * LM_RES;
    const acc = new Float32Array(LW * LH * 3);
    for (const L of w.lights) addLight(w, L, acc, 1);
    // Moonlight on open-air cells.
    for (let tz = 0; tz < LH; tz++) for (let tx = 0; tx < LW; tx++) {
      const c = w.at((tx / LM_RES) | 0, (tz / LM_RES) | 0);
      if (c && !c.solid && c.sky) { const i = (tz * LW + tx) * 3; acc[i] += 0.16; acc[i + 1] += 0.2; acc[i + 2] += 0.36; }
    }
    w.lmAcc = acc;
    return finishLightmap(w, acc);
  }
  // Adds (sign 1) or removes (sign -1) one light's shadowed contribution.
  function addLight(w, L, acc, sign) {
    const LW = w.W * LM_RES, LH = w.H * LM_RES;
    const solid = (x, z) => { const c = w.at(Math.floor(x), Math.floor(z)); return !c || c.solid || w.pushwalls.some((p) => p.x === Math.floor(x) && p.z === Math.floor(z)); };
    const visible = (ax, az, bx, bz) => {
      const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), n = Math.ceil(d / 0.09);
      for (let k = 1; k < n; k++) if (solid(ax + dx * k / n, az + dz * k / n)) return false;
      // Columns block light too (segment against the shaft's circle).
      for (const c of w.decor) {
        if (c.type !== 'pillar') continue;
        const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / (d * d || 1)));
        if (Math.hypot(ax + dx * t - c.x, az + dz * t - c.z) < 0.25) return false;
      }
      return true;
    };
    const tx0 = Math.max(0, Math.floor((L.x - L.r) * LM_RES)), tx1 = Math.min(LW - 1, Math.ceil((L.x + L.r) * LM_RES));
    const tz0 = Math.max(0, Math.floor((L.z - L.r) * LM_RES)), tz1 = Math.min(LH - 1, Math.ceil((L.z + L.r) * LM_RES));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const px = (tx + 0.5) / LM_RES, pz = (tz + 0.5) / LM_RES;
      const d = Math.hypot(px - L.x, pz - L.z);
      if (d >= L.r || solid(px, pz) || !visible(L.x, L.z, px, pz)) continue;
      const a = (1 - d / L.r) ** 2 * L.i * sign, i = (tz * LW + tx) * 3;
      acc[i] = Math.max(0, acc[i] + L.col[0] * a); acc[i + 1] = Math.max(0, acc[i + 1] + L.col[1] * a); acc[i + 2] = Math.max(0, acc[i + 2] + L.col[2] * a);
    }
  }
  function finishLightmap(w, lit) {
    const LW = w.W * LM_RES, LH = w.H * LM_RES, acc = lit.slice();
    const solid = (x, z) => { const c = w.at(Math.floor(x), Math.floor(z)); return !c || c.solid || w.pushwalls.some((p) => p.x === Math.floor(x) && p.z === Math.floor(z)); };
    // Spread values into wall texels so bilinear filtering never darkens wall bases.
    const filled = new Uint8Array(LW * LH), q = [];
    for (let tz = 0; tz < LH; tz++) for (let tx = 0; tx < LW; tx++) {
      if (!solid((tx + 0.5) / LM_RES, (tz + 0.5) / LM_RES)) { filled[tz * LW + tx] = 1; q.push(tz * LW + tx); }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % LW, z = (i / LW) | 0;
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= LW || nz >= LH) continue;
        const j = nz * LW + nx;
        if (filled[j]) continue;
        filled[j] = 1;
        acc[j * 3] = acc[i * 3]; acc[j * 3 + 1] = acc[i * 3 + 1]; acc[j * 3 + 2] = acc[i * 3 + 2];
        q.push(j);
      }
    }
    const data = new Uint8Array(LW * LH * 4);
    for (let i = 0; i < LW * LH; i++) {
      for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.min(255, Math.round(acc[i * 3 + k] * 0.5 * 255));
      data[i * 4 + 3] = 255;
    }
    return { w: LW, h: LH, data };
  }
  function lightAt(w, x, z) {
    const lm = w.lightmap;
    const tx = Math.min(lm.w - 1, Math.max(0, Math.floor(x * LM_RES))), tz = Math.min(lm.h - 1, Math.max(0, Math.floor(z * LM_RES)));
    const i = (tz * lm.w + tx) * 4;
    return [lm.data[i] / 127.5, lm.data[i + 1] / 127.5, lm.data[i + 2] / 127.5];
  }

  // ---------------- Queries ----------------
  function pushwallAt(w, x, z) {
    for (const p of w.pushwalls) if (x >= p.x && x < p.x + 1 && z >= p.z && z < p.z + 1) return p;
    return null;
  }
  // Is a circle of radius r with feet at height `feet` blocked at (x,z)?
  function blocked(w, x, z, r, feet, height, walker) {
    for (let cz = Math.floor(z - r); cz <= Math.floor(z + r); cz++) {
      for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
        const c = w.at(cx, cz);
        if (!c || c.solid) return true;
        if (c.door && c.door.open < 0.9) return true;
        if (c.f > feet + STEP) return true;
        if (c.c < feet + height) return true;
        if (walker && c.kind === 'lava') return true;
      }
    }
    for (const p of w.pushwalls) {
      if (x + r > p.x && x - r < p.x + 1 && z + r > p.z && z - r < p.z + 1) return true;
    }
    return false;
  }
  function floorAt(w, x, z, r) {
    let f = -10;
    for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
      const c = w.at(Math.floor(x + ox), Math.floor(z + oz));
      if (c && !c.solid) f = Math.max(f, c.f);
    }
    return f;
  }
  // Line of sight across the grid (walls, closed doors and push walls block).
  function los(w, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), n = Math.ceil(d / 0.12);
    for (let k = 1; k < n; k++) {
      const x = ax + dx * k / n, z = az + dz * k / n;
      const c = w.at(Math.floor(x), Math.floor(z));
      if (!c || c.solid) return false;
      if (c.door && c.door.open < 0.6) return false;
      if (w.pushwalls.length && pushwallAt(w, x, z)) return false;
    }
    return true;
  }
  // Breadth-first distance fields from the player's cell, for enemy navigation.
  function computeFlow(w, px, pz) {
    const sx = Math.floor(px), sz = Math.floor(pz);
    for (const [field, flyer] of [[w.flow, false], [w.flowFly, true]]) {
      field.fill(-1);
      const start = sz * w.W + sx;
      if (!w.cells[start] || w.cells[start].solid) continue;
      field[start] = 0;
      const q = [start];
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % w.W, z = (i / w.W) | 0;
        for (const [dx, dz] of DIRS) {
          const nx = x + dx, nz = z + dz, c = w.at(nx, nz);
          if (!c || c.solid) continue;
          const j = nz * w.W + nx;
          if (field[j] !== -1) continue;
          if (c.door && c.door.locked && c.door.open < 0.9) continue;
          if (!flyer && (c.kind === 'lava' || c.kind === 'crate')) continue;
          if (pushwallAt(w, nx + 0.5, nz + 0.5)) continue;
          field[j] = field[i] + 1;
          if (field[j] < 40) q.push(j);
        }
      }
    }
  }

  // Puts out the torch in wall cell `idx`: unlit texture, its lights removed
  // from the lightmap. Returns the removed lights.
  function extinguish(w, idx) {
    const c = w.cells[idx];
    if (!c || c.out) return [];
    c.out = true;
    c.wall = w.torchOut;
    const gone = w.lights.filter((L) => L.cell === idx);
    for (const L of gone) addLight(w, L, w.lmAcc, -1);
    w.lights = w.lights.filter((L) => L.cell !== idx);
    w.torches = w.torches.filter((t) => t.cell !== idx);
    w.mesh = buildMesh(w);
    w.lightmap = finishLightmap(w, w.lmAcc);
    return gone;
  }

  return { create, extinguish, dynamicMesh, lightAt, blocked, floorAt, los, computeFlow, pushwallAt, STEP, LM_RES };
})();
