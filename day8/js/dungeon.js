'use strict';

// Random dungeon layout: rooms joined by corridors, doors, walls and pools.
// No DOM: it also loads in Node.
const Dungeon = (() => {
  const W = 60, H = 40;
  const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, OPEN: 4, DOWN: 5, UP: 6, WATER: 7, LAVA: 8 };
  const MAX_ROOMS = 13;
  const EXTRA_LINKS = 3;
  const DOOR_CHANCE = 0.45;
  const POOL_CHANCE = 0.35;

  // mulberry32: small seeded generator, returns floats in [0, 1)
  // state: to resume a generator saved with f.state()
  function rng(seed, state) {
    let a = state !== undefined ? state | 0 : seed >>> 0;
    const f = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.state = () => a;
    return f;
  }
  const int = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const walkable = (t) => t === T.FLOOR || t === T.OPEN || t === T.DOOR ||
    t === T.DOWN || t === T.UP || t === T.WATER || t === T.LAVA;
  const opaque = (t) => t === T.WALL || t === T.VOID || t === T.DOOR;

  // opts.outdoor: no doors, ragged clearings instead of square rooms, water only
  // (opts.pool sets how often); used by the scenario levels
  function generate(depth, rnd, opts = {}) {
    for (;;) {
      const map = attempt(depth, rnd, opts);
      if (map) return map;
    }
  }

  function attempt(depth, rnd, opts) {
    const t = new Uint8Array(W * H);
    const corridor = new Uint8Array(W * H);
    const rooms = [];
    for (let i = 0; i < 400 && rooms.length < MAX_ROOMS; i++) {
      const w = int(rnd, 5, 11), h = int(rnd, 4, 8);
      const x = int(rnd, 2, W - w - 3), y = int(rnd, 2, H - h - 3);
      if (rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
    }
    if (rooms.length < 7) return null;
    for (const r of rooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) t[idx(x, y)] = T.FLOOR;
      }
    }

    const dig = (x, y) => {
      if (t[idx(x, y)] === T.VOID) { t[idx(x, y)] = T.FLOOR; corridor[idx(x, y)] = 1; }
    };
    const link = (a, b) => {
      let x = a.cx, y = a.cy;
      const goX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); dig(x, y); } };
      const goY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); dig(x, y); } };
      if (rnd() < 0.5) { goX(); goY(); } else { goY(); goX(); }
    };
    const dist = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cy - b.cy);

    // spanning tree: always join the closest pair of a joined and a free room
    const joined = [rooms[0]], free = rooms.slice(1);
    while (free.length) {
      let best = null;
      for (const a of joined) {
        for (const b of free) {
          if (!best || dist(a, b) < best.d) best = { a, b, d: dist(a, b) };
        }
      }
      link(best.a, best.b);
      joined.push(best.b);
      free.splice(free.indexOf(best.b), 1);
    }
    // a few loops, so there is more than one way around
    for (let i = 0; i < EXTRA_LINKS; i++) {
      const a = pick(rnd, rooms);
      const near = rooms.filter(r => r !== a).sort((p, q) => dist(a, p) - dist(a, q));
      link(a, near[1] || near[0]);
    }

    const roomAt = (x, y) => rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const floorish = (x, y) => inside(x, y) && t[idx(x, y)] !== T.VOID;

    // doors: corridor cells in a room's wall ring, with wall on both sides
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (!corridor[idx(x, y)]) continue;
        const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) =>
          !corridor[idx(x + dx, y + dy)] && t[idx(x + dx, y + dy)] === T.FLOOR);
        if (!touches) continue;
        const ew = !floorish(x - 1, y) && !floorish(x + 1, y);
        const ns = !floorish(x, y - 1) && !floorish(x, y + 1);
        if (!(ew || ns)) continue;
        const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => t[idx(x + dx, y + dy)] === T.DOOR);
        if (!nearDoor && rnd() < DOOR_CHANCE) t[idx(x, y)] = T.DOOR;
      }
    }

    if (opts.outdoor) {
      for (let i = 0; i < W * H; i++) if (t[i] === T.DOOR) t[i] = T.FLOOR;
      roughen(t, rnd);
    }

    // walls around everything that was dug
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (t[idx(x, y)] !== T.VOID) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = inside(x + dx, y + dy) ? t[idx(x + dx, y + dy)] : T.VOID;
            if (v !== T.VOID && v !== T.WALL) { near = true; break; }
          }
        }
        if (near) t[idx(x, y)] = T.WALL;
      }
    }

    // pools, two cells away from the room edges so the room stays crossable
    const lavaChance = opts.outdoor ? 0 : depth >= 7 ? 0.8 : depth >= 3 ? 0.4 : 0;
    const poolChance = opts.pool ?? POOL_CHANCE;
    for (const r of rooms) {
      if (r.w < 7 || r.h < 6 || rnd() > poolChance) continue;
      const kind = rnd() < lavaChance ? T.LAVA : T.WATER;
      const x0 = r.x + 2, y0 = r.y + 2, x1 = r.x + r.w - 3, y1 = r.y + r.h - 3;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const rx = (x1 - x0) / 2 + 0.6, ry = (y1 - y0) / 2 + 0.6;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          if (d < 0.75 + rnd() * 0.4) t[idx(x, y)] = kind;
        }
      }
      r.pool = kind;
    }

    // start in a random room, stairs down in the farthest one
    const start = pick(rnd, rooms);
    const sx = start.cx, sy = start.cy;
    if (t[idx(sx, sy)] !== T.FLOOR) return null;
    const d = distances(t, sx, sy);
    let far = null;
    for (const r of rooms) {
      if (r === start) continue;
      const cells = [];
      for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
        for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
          if (t[idx(x, y)] === T.FLOOR && d[idx(x, y)] >= 0) cells.push([x, y]);
        }
      }
      for (const [x, y] of cells) {
        if (!far || d[idx(x, y)] > far.d) far = { x, y, d: d[idx(x, y)] };
      }
    }
    if (!far) return null;
    t[idx(sx, sy)] = T.UP;
    t[idx(far.x, far.y)] = T.DOWN;

    const variant = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) variant[i] = Math.floor(rnd() * 256);
    return { w: W, h: H, t, corridor, variant, rooms, start: { x: sx, y: sy }, down: { x: far.x, y: far.y }, startRoom: start, roomAt };
  }

  // eat into the void around the dug cells, so rooms become ragged clearings
  function roughen(t, rnd) {
    for (let pass = 0; pass < 2; pass++) {
      const add = [];
      for (let y = 2; y < H - 2; y++) {
        for (let x = 2; x < W - 2; x++) {
          if (t[idx(x, y)] !== T.VOID) continue;
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) if (t[idx(x + dx, y + dy)] === T.FLOOR) n++;
          }
          if (n >= 3 && rnd() < 0.3 + n * 0.06) add.push(idx(x, y));
        }
      }
      for (const c of add) t[c] = T.FLOOR;
    }
  }

  // breadth-first distances over walkable cells, -1 where unreachable
  function distances(t, sx, sy, pass = walkable) {
    const d = new Int16Array(W * H).fill(-1);
    const q = [idx(sx, sy)];
    d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const n = idx(nx, ny);
        if (d[n] < 0 && pass(t[n], n)) { d[n] = d[c] + 1; q.push(n); }
      }
    }
    return d;
  }

  return { W, H, T, rng, int, pick, idx, inside, walkable, opaque, generate, distances };
})();

if (typeof module !== 'undefined') module.exports = Dungeon;
