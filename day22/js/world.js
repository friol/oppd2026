'use strict';
// World simulation core: mutable tile grid, tile collision, portals (placement, ray casts,
// teleporting bodies), block bumps, particles.

const PORTAL_COLORS = ['#3aa8ff', '#ff9a2a'];
const PORTAL_NAMES = ['blue', 'orange'];

class World {
  constructor(level, opts) {
    opts = opts || {};
    this.L = level.clone();
    this.theme = THEMES[this.L.theme] || THEMES[0];
    this.portals = [null, null];
    this.ents = [];
    this.shots = [];
    this.fx = [];
    this.time = 0;
    this.bumps = new Map();      // "x,y" -> remaining time of the bump animation
    this.crumble = new Map();    // "x,y" -> {t, gone}
    this.player = null;
    this.events = [];            // messages for the game (score, coins, secrets, ...)
    this.secretsTotal = 0;
    this.secretsFound = 0;
    this.shake = 0;
    this.ripples = [];           // rings on the water surface (see RENDER.water)
    this.powerCycle = 0;
    this.boss = null;
    this.spawnAll(opts);
  }

  spawnAll(opts) {
    for (const e of this.L.ents) {
      if (e.t === 'start') continue;
      if (opts.skipBefore && e.x < opts.skipBefore && ['coin', 'scoin', 'secret'].indexOf(e.t) < 0 && ENEMY_TYPES.indexOf(e.t) >= 0) continue;
      const ent = makeEntity(e, this);
      if (ent) this.add(ent);
      if (e.t === 'secret') this.secretsTotal++;
    }
  }
  add(e) { e.world = this; this.ents.push(e); if (e.init) e.init(this); return e; }
  emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }

  // ---------- tiles ----------
  tile(x, y) { return this.L.get(x, y); }
  isSolid(x, y, kind) {
    const c = this.L.get(x, y);
    const d = TILES[c];
    if (!d || !d.solid) return false;
    if (kind === 'shot' && d.grate) return false;
    if (c === 'X') { const s = this.crumble.get(x + ',' + y); if (s && s.gone) return false; }
    return true;
  }
  isOpen(x, y) { return !this.isSolid(x, y, 'body'); }
  canHoldPortal(x, y) {
    const d = TILES[this.L.get(x, y)];
    return !!(d && d.portal);
  }
  boxHits(x, y, w, h, pred) {
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (pred(this.L.get(tx, ty), tx, ty)) return [tx, ty];
    return null;
  }

  // ---------- movement with portals ----------
  moveBody(e, dt) {
    e.hitX = 0; e.hitY = 0; e.onGround = false; e.hitTile = null;
    let mx = e.vx * dt, my = e.vy * dt;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(mx), Math.abs(my)) / 7));
    mx /= n; my /= n;
    for (let i = 0; i < n; i++) {
      if (mx && this.moveAxis(e, mx, 0)) return true;
      if (my && this.moveAxis(e, 0, my)) return true;
      if (e.hitX) mx = 0;
      if (e.hitY) my = 0;
    }
    return false;
  }

  // Returns true when the body went through a portal
  moveAxis(e, dx, dy) {
    const kind = e.shot ? 'shot' : 'body';
    if (dx) {
      e.x += dx;
      const tx = dx > 0 ? Math.floor((e.x + e.w - 0.001) / TILE) : Math.floor(e.x / TILE);
      const y0 = Math.floor(e.y / TILE), y1 = Math.floor((e.y + e.h - 0.001) / TILE);
      for (let ty = y0; ty <= y1; ty++) {
        if (!this.isSolid(tx, ty, kind)) continue;
        const nx = dx > 0 ? -1 : 1, plane = dx > 0 ? tx * TILE : (tx + 1) * TILE;
        if (this.tryPortal(e, nx, 0, plane)) return true;
        e.x = dx > 0 ? tx * TILE - e.w : (tx + 1) * TILE;
        e.hitX = dx > 0 ? 1 : -1;
        e.hitTile = [tx, ty];
        if (!e.shot) e.vx = 0;
        return false;
      }
    } else if (dy) {
      const prevTop = e.y;
      e.y += dy;
      const ty = dy > 0 ? Math.floor((e.y + e.h - 0.001) / TILE) : Math.floor(e.y / TILE);
      const x0 = Math.floor(e.x / TILE), x1 = Math.floor((e.x + e.w - 0.001) / TILE);
      if (dy < 0 && e.isPlayer) {
        // hidden blocks appear when hit from below
        for (let tx = x0; tx <= x1; tx++) {
          if (this.L.get(tx, ty) === 'H' && prevTop >= (ty + 1) * TILE - 0.5) {
            this.L.set(tx, ty, '?');
            this.emit('secretBlock');
          }
        }
      }
      let hit = -1, best = 1e9;
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.isSolid(tx, ty, kind)) continue;
        const dist = Math.abs((tx + 0.5) * TILE - (e.x + e.w / 2));
        if (dist < best) { best = dist; hit = tx; }
      }
      if (hit >= 0) {
        const ny = dy > 0 ? -1 : 1, plane = dy > 0 ? ty * TILE : (ty + 1) * TILE;
        if (this.tryPortal(e, 0, ny, plane)) return true;
        e.y = dy > 0 ? ty * TILE - e.h : (ty + 1) * TILE;
        e.hitY = dy > 0 ? 1 : -1;
        e.hitTile = [hit, ty];
        if (dy > 0) e.onGround = true;
        if (!e.shot) {
          if (dy < 0 && e.isPlayer && e.vy < -60) this.bump(hit, ty, e);
          e.vy = 0;
        }
      }
    }
    return false;
  }

  // ---------- portals ----------
  portalOn(nx, ny, plane, a0, a1) {
    for (const p of this.portals) {
      if (!p || p.nx !== nx || p.ny !== ny || p.plane !== plane) continue;
      if (a0 >= p.a - 4 && a1 <= p.b + 4) return p;
    }
    return null;
  }
  tryPortal(e, nx, ny, plane) {
    if (!e.portalable || e.portalCD > 0) return false;
    const pin = nx ? this.portalOn(nx, 0, plane, e.y, e.y + e.h) : this.portalOn(0, ny, plane, e.x, e.x + e.w);
    if (!pin || pin.open < 0.5) return false;
    const pout = this.portals[1 - pin.c];
    if (!pout || pout.open < 0.5) return false;
    this.teleport(e, pin, pout);
    return true;
  }
  teleport(e, pin, pout) {
    const d = [-pin.nx, -pin.ny], no = [pout.nx, pout.ny];
    let k = 0;
    for (; k < 4; k++) { const r = U.rot90(d, k); if (r[0] === no[0] && r[1] === no[1]) break; }
    const tIn = U.rot90(d, 1);
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const off = (cx - pin.cx) * tIn[0] + (cy - pin.cy) * tIn[1];
    let v = [e.vx, e.vy], tOut;
    if (k === 2) {
      // facing the same way: mirror (keeps the sideways motion)
      const vd = v[0] * d[0] + v[1] * d[1];
      v = [v[0] - 2 * vd * d[0], v[1] - 2 * vd * d[1]];
      tOut = tIn;
    } else {
      v = U.rot90(v, k);
      tOut = U.rot90(tIn, k);
    }
    const vn = v[0] * no[0] + v[1] * no[1];
    const minV = e.shot ? 60 : no[1] < 0 ? 420 : 150;
    if (vn < minV) { v[0] += no[0] * (minV - vn); v[1] += no[1] * (minV - vn); }
    // popping out of a floor portal: a small sideways push so bodies do not fall straight back in
    if (!e.shot && no[1] < 0 && Math.abs(v[0]) < 80) v[0] = (e.face || e.dir || 1) * 130;
    const half = no[0] ? e.h / 2 : e.w / 2;
    const lim = Math.max(0, TILE - half);
    const o = U.clamp(off, -lim, lim);
    let ncx = pout.cx + tOut[0] * o, ncy = pout.cy + tOut[1] * o;
    if (no[0]) ncx = pout.plane + no[0] * (e.w / 2 + 0.5); else ncy = pout.plane + no[1] * (e.h / 2 + 0.5);
    e.x = ncx - e.w / 2; e.y = ncy - e.h / 2;
    e.vx = v[0]; e.vy = v[1];
    e.portalCD = 0.05;
    e.teleports = (e.teleports || 0) + 1;
    if (e.onTeleport) e.onTeleport(pin, pout);
    if (e.isPlayer || e.enemy) this.emit('warp', { mine: !!e.isPlayer, x: e.x + e.w / 2, y: e.y + e.h / 2 });
    this.portalBurst(pin, 8);
    this.portalBurst(pout, 14);
  }

  // DDA ray cast through the grid. Returns the first solid cell (for the given kind) and the face normal.
  raycast(x0, y0, dx, dy, maxD, kind) {
    let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const ddx = dx ? Math.abs(TILE / dx) : 1e9, ddy = dy ? Math.abs(TILE / dy) : 1e9;
    let mx = dx > 0 ? ((tx + 1) * TILE - x0) / dx : dx < 0 ? (x0 - tx * TILE) / -dx : 1e9;
    let my = dy > 0 ? ((ty + 1) * TILE - y0) / dy : dy < 0 ? (y0 - ty * TILE) / -dy : 1e9;
    for (let i = 0; i < 400; i++) {
      let t, nx = 0, ny = 0;
      if (mx < my) { tx += sx; t = mx; mx += ddx; nx = -sx; } else { ty += sy; t = my; my += ddy; ny = -sy; }
      if (t > maxD) return null;
      if (ty > this.L.h + 2 || ty < -2) return null;
      if (this.isSolid(tx, ty, kind || 'shot')) return { tx, ty, nx, ny, t, x: x0 + dx * t, y: y0 + dy * t };
    }
    return null;
  }

  // Where would a portal go for this ray hit? Returns a portal description or null.
  portalSpot(hit, color) {
    if (!hit || !this.canHoldPortal(hit.tx, hit.ty)) return null;
    const { tx, ty, nx, ny } = hit;
    const other = this.portals[1 - color];
    const make = (ptx, pty) => {
      const p = { c: color, nx, ny, tx: ptx, ty: pty };
      if (nx) {
        p.plane = nx < 0 ? ptx * TILE : (ptx + 1) * TILE;
        p.a = pty * TILE; p.b = p.a + 2 * TILE;
        p.cx = p.plane; p.cy = p.a + TILE;
      } else {
        p.plane = ny < 0 ? pty * TILE : (pty + 1) * TILE;
        p.a = ptx * TILE; p.b = p.a + 2 * TILE;
        p.cx = p.a + TILE; p.cy = p.plane;
      }
      if (other && other.nx === nx && other.ny === ny && other.plane === p.plane && p.a < other.b && p.b > other.a) return null;
      return p;
    };
    if (nx) {
      const f = (hit.y - ty * TILE) / TILE;
      for (const t0 of f < 0.5 ? [ty - 1, ty] : [ty, ty - 1]) {
        if (this.canHoldPortal(tx, t0) && this.canHoldPortal(tx, t0 + 1) && this.isOpen(tx + nx, t0) && this.isOpen(tx + nx, t0 + 1)) {
          const p = make(tx, t0); if (p) return p;
        }
      }
    } else {
      const f = (hit.x - tx * TILE) / TILE;
      for (const t0 of f < 0.5 ? [tx - 1, tx] : [tx, tx - 1]) {
        if (this.canHoldPortal(t0, ty) && this.canHoldPortal(t0 + 1, ty) && this.isOpen(t0, ty + ny) && this.isOpen(t0 + 1, ty + ny) &&
          this.isOpen(t0, ty + 2 * ny) && this.isOpen(t0 + 1, ty + 2 * ny)) {
          const p = make(t0, ty); if (p) return p;
        }
      }
    }
    return null;
  }

  firePortal(color, x0, y0, ang) {
    this.shots.push({ c: color, x: x0, y: y0, ox: x0, oy: y0, dx: Math.cos(ang), dy: Math.sin(ang), dist: 0, max: 1100, trail: [] });
  }
  placePortal(p) {
    p.open = 0;
    this.portals[p.c] = p;
    this.portalBurst(p, 18);
    this.emit('portalOpen', { c: p.c });
  }
  clearPortals() {
    for (const p of this.portals) if (p) this.portalBurst(p, 10);
    this.portals = [null, null];
  }
  portalBurst(p, n) {
    const col = PORTAL_COLORS[p.c];
    for (let i = 0; i < n; i++) {
      const s = (Math.random() - 0.5) * 2 * TILE;
      const tx = p.nx ? 0 : 1, ty = p.nx ? 1 : 0;
      const sp = 40 + Math.random() * 160;
      this.particle({ x: p.cx + tx * s, y: p.cy + ty * s, vx: p.nx * sp + (Math.random() - 0.5) * 60, vy: p.ny * sp + (Math.random() - 0.5) * 60,
        life: 0.3 + Math.random() * 0.4, color: col, size: 2 + Math.random() * 2, glow: 1 });
    }
  }
  updateShots(dt) {
    for (const s of this.shots) {
      const step = 2000 * dt;
      const hit = this.raycast(s.x, s.y, s.dx, s.dy, step, 'shot');
      s.trail.push([s.x, s.y]);
      if (s.trail.length > 6) s.trail.shift();
      if (hit) {
        s.dead = true;
        const p = this.portalSpot(hit, s.c);
        if (p) this.placePortal(p);
        else this.fizzle(hit.x, hit.y, PORTAL_COLORS[s.c]);
        continue;
      }
      s.x += s.dx * step; s.y += s.dy * step; s.dist += step;
      if (s.dist > s.max) { s.dead = true; this.fizzle(s.x, s.y, PORTAL_COLORS[s.c]); }
    }
    this.shots = this.shots.filter(s => !s.dead);
    for (const p of this.portals) if (p) p.open = Math.min(1, p.open + dt * 6);
  }
  fizzle(x, y, col) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 140;
      this.particle({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25 + Math.random() * 0.25, color: i % 2 ? '#fff' : col, size: 2, glow: 1 });
    }
  }

  // ---------- blocks ----------
  bump(tx, ty, by) {
    const c = this.L.get(tx, ty);
    const key = tx + ',' + ty;
    if (!TILES[c] || !TILES[c].bump) return;
    this.bumps.set(key, 0.18);
    const cx = (tx + 0.5) * TILE, cy = ty * TILE;
    if (c === '?') {
      this.L.set(tx, ty, 'U');
      this.add(new CoinPop(cx, cy));
      this.emit('coin', { n: 1, x: cx, y: cy });
    } else if (c === 'P') {
      this.L.set(tx, ty, 'U');
      const kinds = ['plasma', 'heart', 'orb', 'plasma', 'potion', 'medkit'];
      const k = kinds[this.powerCycle++ % kinds.length];
      const it = this.add(new Pickup({ t: k, x: tx, y: ty - 1 }, this));
      it.rise = TILE;
      it.y += TILE;
      this.emit('powerSpawn', { kind: k });
    } else if (c === 'B' || c === 'C') {
      this.breakTile(tx, ty);
      this.emit('score', { n: 50, x: cx, y: cy });
    }
    // enemies standing on a bumped block get knocked out
    for (const e of this.ents) {
      if (e.enemy && !e.dead && e.x < (tx + 1) * TILE && e.x + e.w > tx * TILE && Math.abs(e.y + e.h - ty * TILE) < 4) e.kill(this, 'bump');
    }
  }
  breakTile(tx, ty) {
    const c = this.L.get(tx, ty);
    this.L.set(tx, ty, '.');
    const name = c === 'C' ? 'brick_cracked' : 'brick';
    for (let i = 0; i < 4; i++) {
      this.particle({ x: (tx + 0.25 + (i % 2) * 0.5) * TILE, y: (ty + 0.25 + (i >> 1) * 0.5) * TILE, vx: (i % 2 ? 1 : -1) * (60 + Math.random() * 60),
        vy: -250 - Math.random() * 150 + (i >> 1) * 100, life: 1, grav: 1200, sprite: name, size: 0.45, spin: (Math.random() - 0.5) * 12 });
    }
    this.shake = Math.max(this.shake, 3);
  }
  // Breaks a whole connected group of cracked bricks
  breakCracked(tx, ty) {
    const stack = [[tx, ty]];
    let n = 0;
    while (stack.length && n < 60) {
      const [x, y] = stack.pop();
      if (this.L.get(x, y) !== 'C') continue;
      this.breakTile(x, y); n++;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    if (n) this.emit('score', { n: 50 * n, x: (tx + 0.5) * TILE, y: ty * TILE });
    return n;
  }
  updateTiles(dt) {
    for (const [k, t] of this.bumps) { if (t - dt <= 0) this.bumps.delete(k); else this.bumps.set(k, t - dt); }
    for (const [k, s] of this.crumble) {
      s.t += dt;
      if (!s.gone && s.t > 0.55) {
        s.gone = true; s.t = 0;
        const [x, y] = k.split(',').map(Number);
        for (let i = 0; i < 6; i++) this.particle({ x: (x + Math.random()) * TILE, y: (y + Math.random()) * TILE, vx: (Math.random() - 0.5) * 80, vy: Math.random() * 60,
          life: 0.8, grav: 900, color: '#6b5a4a', size: 3 + Math.random() * 3 });
      } else if (s.gone && s.t > 4) {
        const [x, y] = k.split(',').map(Number);
        const busy = this.ents.some(e => e.solidBody && !e.dead && U.overlap(e, { x: x * TILE, y: y * TILE, w: TILE, h: TILE }));
        if (!busy) this.crumble.delete(k);
      }
    }
  }
  standOn(e) {
    // crumbling rocks start to fall when something stands on them
    if (!e.onGround) return;
    const y = Math.floor((e.y + e.h + 1) / TILE);
    for (let x = Math.floor(e.x / TILE); x <= Math.floor((e.x + e.w - 0.001) / TILE); x++) {
      if (this.L.get(x, y) === 'X' && !this.crumble.has(x + ',' + y)) this.crumble.set(x + ',' + y, { t: 0, gone: false });
    }
  }

  // ---------- particles ----------
  particle(p) { p.max = p.life; this.fx.push(p); return p; }
  text(x, y, str, color) { this.particle({ x, y, vx: 0, vy: -50, life: 1, text: str, color: color || '#fff' }); }
  smoke(x, y, n) {
    for (let i = 0; i < (n || 1); i++) this.particle({ x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 10, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30,
      life: 0.6, sprite: Math.random() < 0.5 ? 'smoke0' : 'smoke1', size: 0.35 + Math.random() * 0.2, fade: 1 });
  }
  // y of the water surface above the point (px, py), or py if it is not in water
  waterSurface(px, py) {
    const tx = Math.floor(px / TILE);
    let ty = Math.floor(py / TILE);
    if (this.L.get(tx, ty) !== 'W') return py;
    while (this.L.get(tx, ty - 1) === 'W') ty--;
    return ty * TILE;
  }
  ripple(px, py) { this.ripples.push({ x: px, y: this.waterSurface(px, py), t: 0 }); if (this.ripples.length > 20) this.ripples.shift(); }
  updateFx(dt) {
    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter(r => r.t < 1.1);
    for (const p of this.fx) {
      p.life -= dt;
      p.vy += (p.grav || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
    }
    this.fx = this.fx.filter(p => p.life > 0);
    if (this.fx.length > 2000) this.fx.splice(0, this.fx.length - 2000);
  }

  update(dt, input) {
    this.time += dt;
    this.updateTiles(dt);
    this.updateShots(dt);
    for (const e of this.ents) {
      if (e.dead) continue;
      if (e.portalCD > 0) e.portalCD -= dt;
      e.update(this, dt, input);
    }
    this.ents = this.ents.filter(e => !e.dead || e.keep);
    this.updateFx(dt);
    this.shake = Math.max(0, this.shake - dt * 20);
  }
}

if (typeof module !== 'undefined') module.exports = { World };
