'use strict';
// Game entities: player, enemies, boss, traps, pickups, projectiles, decorations.
// Entity data from the level uses tile cells; an entity stands on the bottom of its cell.

const GRAV = 1900, MAX_FALL = 1250;
const BOSS_WINDUP = 0.45;   // seconds the boss crouches before his jump
const SPIKE_SHAKE = 0.55;   // seconds a spike ball trembles before it falls
const BOSS_BURN = 2.7;   // seconds the final boss burns before he explodes
const ENEMY_TYPES = ['goblin', 'brute', 'slime', 'plant', 'turret', 'turretR', 'bat', 'eye', 'spikeball', 'boss'];

class Ent {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.dead = false; this.portalable = true; this.portalCD = 0; this.onGround = false;
    this.t = Math.random() * 10;
  }
  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }
  inWater(w) { return w.tile(Math.floor(this.cx / TILE), Math.floor((this.y + this.h * 0.7) / TILE)) === 'W'; }
  update() { }
  draw() { }
}

function cellBottom(e) { return [(e.x + 0.5) * TILE, (e.y + 1) * TILE]; }

// ======================= Player =======================
const RUN_SPEED = 230, JUMP_V = 540;

class Player extends Ent {
  constructor(px, py) {
    super(px - 9, py - 38, 18, 38);
    this.isPlayer = true; this.solidBody = true;
    this.face = 1; this.aim = 0;
    this.hp = 3; this.maxHp = 3;
    this.inv = 0; this.coyote = 0; this.jumpBuf = 0; this.jumping = false;
    this.fireCD = 0; this.plasma = 0; this.shield = 0;
    this.frame = 'idle0'; this.runDist = 0; this.lastColor = 0; this.recoil = 0;
    this.dying = 0; this.wasGround = false;
  }
  pivot() {
    const [fw, fh] = SPR.size(this.frame);
    const sx = this.cx - fw / 2, sy = this.y + this.h - fh + 1;
    const a = GUN_ANCHOR[this.frame] || GUN_ANCHOR.idle0;
    return [this.face < 0 ? sx + fw - a[0] : sx + a[0], sy + a[1]];
  }
  hurt(w, src) {
    if (this.inv > 0 || this.shield > 0 || this.dying || this.won) return;
    this.hp--;
    this.inv = 1.5;
    w.shake = 6;
    const dir = src ? U.sign(this.cx - (src.cx !== undefined ? src.cx : src.x)) || -this.face : -this.face;
    this.vx = dir * 260; this.vy = -330;
    w.emit('hurt');
    if (this.hp <= 0) this.die(w);
  }
  die(w, how) {
    if (this.dying) return;
    this.hp = 0;
    this.dying = 0.001;
    this.vx = this.vy = 0;
    this.portalable = false;
    w.shake = Math.max(w.shake, 5);
    if (how === 'water') w.ripple(this.cx, this.y + this.h * 0.8);
    if (how === 'water') for (let i = 0; i < 14; i++) w.particle({ x: this.cx, y: this.y + this.h, vx: (Math.random() - 0.5) * 200, vy: -150 - Math.random() * 200, life: 0.8, grav: 900, color: '#8fd3ff', size: 3 });
    w.emit('dying');
  }
  update(w, dt, inp) {
    this.t += dt;
    if (this.dying) {
      // turns red for a moment, then bursts into pixels
      this.dying += dt;
      if (this.dying > 0.28 && !this.exploded) { this.exploded = true; this.explode(w); }
      if (this.dying > 1.7 && !this.reported) { this.reported = true; w.emit('dead'); }
      return;
    }
    if (this.won) { this.vx = 0; inp = {}; }
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const ground = this.wasGround;
    if (dir) {
      if (Math.abs(this.vx) <= RUN_SPEED || U.sign(this.vx) !== dir) this.vx = U.approach(this.vx, dir * RUN_SPEED, (ground ? 2000 : 1200) * dt);
      else this.vx = U.approach(this.vx, dir * RUN_SPEED, (ground ? 1400 : 100) * dt);
    } else {
      this.vx = U.approach(this.vx, 0, (ground ? 1900 : Math.abs(this.vx) > RUN_SPEED ? 100 : 450) * dt);
    }
    // jump with coyote time and input buffer
    if (inp.jumpPressed) this.jumpBuf = 0.13; else this.jumpBuf -= dt;
    this.coyote = ground ? 0.09 : this.coyote - dt;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = -JUMP_V; this.jumpBuf = 0; this.coyote = 0; this.jumping = true;
      w.emit('jump');
      this.dust(w, 3);
    }
    if (this.vy >= 0) this.jumping = false;
    const rising = this.vy < 0 && inp.jump && this.jumping;
    this.vy = Math.min(this.vy + (rising ? 1250 : GRAV) * dt, MAX_FALL);
    const fast = Math.abs(this.vy) > 700;
    w.moveBody(this, dt);
    if (this.hitY < 0) this.jumping = false;
    if (this.onGround && !this.wasGround && fast) { this.dust(w, 6); w.shake = Math.max(w.shake, 2); }
    this.wasGround = this.onGround;
    w.standOn(this);

    // aim and fire
    const [px, py] = this.pivot();
    if (inp.mx !== undefined) {
      this.aim = Math.atan2(inp.my - py, inp.mx - px);
      this.face = inp.mx >= this.cx ? 1 : -1;
    }
    this.fireCD -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const ca = Math.cos(this.aim), sa = Math.sin(this.aim);
    if ((inp.fire0 || inp.fire1) && this.fireCD <= 0) {
      const c = inp.fire0 ? 0 : 1;
      w.firePortal(c, px, py, this.aim);
      this.fireCD = 0.22; this.lastColor = c; this.recoil = 1;
      w.emit('shoot', { c });
      for (let i = 0; i < 6; i++) w.particle({ x: px + ca * 18, y: py + sa * 18, vx: ca * 120 + (Math.random() - 0.5) * 90, vy: sa * 120 + (Math.random() - 0.5) * 90,
        life: 0.25, color: PORTAL_COLORS[c], size: 2, glow: 1 });
    }
    if (inp.fire2 && this.plasma > 0 && this.fireCD <= 0) {
      this.plasma--;
      this.fireCD = 0.3; this.recoil = 1;
      w.add(new Proj('plasma', px + ca * 10, py + sa * 10, ca * 620, sa * 620, this));
      w.emit('plasmaShot');
    }
    this.inv = Math.max(0, this.inv - dt);
    if (this.shield > 0) this.shield -= dt;

    // animation
    if (!this.onGround) this.frame = this.vy < 0 ? 'jump' : 'fall';
    else if (Math.abs(this.vx) > 20) {
      this.runDist += Math.abs(this.vx) * dt * (U.sign(this.vx) === this.face ? 1 : -1);
      // 8-frame walk cycle generated by tools/cut.py, advanced by the distance covered
      const i = ((Math.floor(this.runDist / 7) % 8) + 8) % 8;
      this.frame = 'walk' + i;
    } else this.frame = 'idle0';

    // hazards
    if (this.inWater(w)) { this.die(w, 'water'); return; }
    if (this.y > w.L.h * TILE + 60) { this.die(w, 'fall'); return; }
    if (w.boxHits(this.x + 3, this.y + this.h * 0.5, this.w - 6, this.h * 0.5, c => c === 'F')) this.hurt(w, null);

    // enemies
    for (const e of w.ents) {
      if (!e.enemy || e.dead || e.dying || !e.harmful) continue;
      if (!U.overlap(this, e)) continue;
      if (this.shield > 0 && e.hp !== undefined && !e.isBoss) { e.kill(w, 'pop', this); continue; }
      const feet = this.y + this.h;
      if (e.stompable && this.vy > 60 && feet - e.y < 16) {
        e.stomp(w, this);
        this.vy = -(inp.jump ? 560 : 380);
        this.jumping = !!inp.jump;
      } else this.hurt(w, e);
    }
  }
  explode(w) {
    w.emit('explode');
    const [fw, fh] = SPR.size(this.frame);
    const sx = this.cx - fw / 2, sy = this.y + this.h - fh + 1;
    const reds = ['#ff2a2a', '#e01818', '#ff5a4a', '#b80f14', '#ff7b6b'];
    for (const [px, py] of PLAYER_PIXELS) {
      const x = sx + (this.face < 0 ? fw - px - 2 : px), y = sy + py;
      const dx = x - this.cx, dy = y - this.cy, d = Math.hypot(dx, dy) || 1;
      const sp = 90 + Math.random() * 260;
      w.particle({ x: x + 1, y: y + 1, vx: dx / d * sp + (Math.random() - 0.5) * 60, vy: dy / d * sp - 160 - Math.random() * 120,
        life: 0.7 + Math.random() * 0.8, grav: 900, color: reds[(Math.random() * reds.length) | 0], size: 2 + (Math.random() < 0.3 ? 1 : 0) });
    }
    w.shake = Math.max(w.shake, 7);
  }
  dust(w, n) {
    for (let i = 0; i < n; i++) w.particle({ x: this.cx + (Math.random() - 0.5) * 16, y: this.y + this.h, vx: (Math.random() - 0.5) * 80, vy: -20 - Math.random() * 40,
      life: 0.4, color: 'rgba(230,225,210,0.8)', size: 2 + Math.random() * 2 });
  }
  draw(ctx, w) {
    if (this.alpha !== undefined) {
      if (this.alpha <= 0) return;
      ctx.save(); ctx.globalAlpha *= this.alpha;
      this.drawBody(ctx, w);
      ctx.restore();
    } else this.drawBody(ctx, w);
  }
  drawBody(ctx, w) {
    if (this.dying) {
      if (!this.exploded) {
        const [fw, fh] = SPR.size(this.frame);
        const shake = (Math.random() - 0.5) * 3;
        ctx.save();
        ctx.translate(Math.round(this.cx + shake), Math.round(this.y + this.h - fh + 1));
        if (this.face < 0) ctx.scale(-1, 1);
        ctx.drawImage(SPR.tinted(this.frame, '#ff2020'), -fw / 2, 0);
        ctx.restore();
      }
      return;
    }
    if (this.inv > 0 && Math.floor(this.inv * 18) % 2) return;
    const [fw, fh] = SPR.size(this.frame);
    if (this.shield > 0) {
      const a = this.shield < 2 ? (Math.floor(this.shield * 8) % 2 ? 0.2 : 0.55) : 0.55;
      const g = ctx.createRadialGradient(this.cx, this.cy, 4, this.cx, this.cy, 34);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, `rgba(140,220,255,${a * 0.4})`); g.addColorStop(1, 'rgba(140,220,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.cx, this.cy, 34, 0, 7); ctx.fill();
    }
    SPR.draw(ctx, this.frame, this.cx - fw / 2 + (this.face < 0 ? fw : 0), this.y + this.h - fh + 1, { flip: this.face < 0 });
    // portal gun barrel, rotated toward the mouse
    const [px, py] = this.pivot();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(this.aim);
    if (this.face < 0) ctx.scale(1, -1);
    ctx.translate(-this.recoil * 3, 0);
    SPR.draw(ctx, 'gun', -2, -GUN_ANCHOR.gun[1] * 1.3, { scale: 1.3 });
    ctx.fillStyle = '#e8eef5';
    ctx.fillRect(8, -2, 7, 4);
    ctx.shadowColor = PORTAL_COLORS[this.lastColor]; ctx.shadowBlur = 10;
    ctx.fillStyle = PORTAL_COLORS[this.lastColor];
    ctx.beginPath(); ctx.arc(16, 0, 2.6 + this.recoil * 2, 0, 7); ctx.fill();
    ctx.restore();
  }
}

// ======================= Enemies =======================
class Enemy extends Ent {
  constructor(x, y, w, h) {
    super(x, y, w, h);
    this.enemy = true; this.harmful = true; this.stompable = true; this.hp = 1;
    this.score = 100; this.flash = 0; this.dir = -1; this.solidBody = true;
  }
  stomp(w, by) {
    this.hp--;
    w.emit('stomp', { kill: this.hp <= 0 });
    if (this.hp <= 0) this.kill(w, 'stomp', by);
    else { this.flash = 0.3; w.emit('score', { n: 50, x: this.cx, y: this.y }); }
  }
  damage(w, n, src) {
    this.hp -= n;
    this.flash = 0.25;
    if (this.hp <= 0) this.kill(w, 'pop', src);
  }
  kill(w, how, src) {
    if (this.dying || this.dead) return;
    // "portal kill": what killed it went through a portal (fireball, plasma, spike ball), or the
    // monster itself went through one and then drowned. Kills by the player (stomp, shield) never count,
    // otherwise every kill would after the player's first teleport.
    const byPlayer = !!(src && src.isPlayer);
    const portal = !byPlayer && ((src && src.teleports > 0) || (how === 'water' && this.teleports > 0));
    w.emit('kill', { x: this.cx, y: this.y, n: this.score, portal });
    this.harmful = false; this.portalable = false;
    if (how === 'stomp') { this.dying = 0.001; this.squash = true; }
    else if (how === 'water') {
      this.dying = 0.001; this.sink = true; w.smoke(this.cx, this.y + this.h, 2);
      w.emit('splash');
      w.ripple(this.cx, this.y + this.h * 0.8);
      for (let i = 0; i < 10; i++) w.particle({ x: this.cx, y: this.y + this.h * 0.7, vx: (Math.random() - 0.5) * 150, vy: -120 - Math.random() * 170, life: 0.7, grav: 900, color: '#bfe6ff', size: 2 + Math.random() * 2 });
    }
    else { this.dying = 0.001; this.vy = -380; this.vx = (src && src.vx ? U.sign(src.vx) : -this.dir) * 80; }
    this.keep = true;
  }
  // returns true when the dying animation is running
  updateDying(w, dt) {
    if (!this.dying) return false;
    this.dying += dt;
    if (this.squash) { if (this.dying > 0.4) this.dead = true; }
    else if (this.sink) { this.y += 30 * dt; if (this.dying > 0.8) this.dead = true; }
    else { this.vy += 1500 * dt; this.x += this.vx * dt; this.y += this.vy * dt; if (this.dying > 2.5) this.dead = true; }
    if (this.dead) this.keep = false;
    return true;
  }
  commonChecks(w) {
    if (this.inWater(w)) { this.kill(w, 'water'); return true; }
    if (this.y > w.L.h * TILE + 60) { this.dead = true; return true; }
    return false;
  }
  // draws a sprite centred on (x, y) with the hit flash (used by the flying enemies)
  drawAt(ctx, name, x, y, o) {
    o = Object.assign({ ax: 0.5, ay: 0.5 }, o || {});
    SPR.draw(ctx, name, x, y, o);
    if (this.flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.flash * 2;
      SPR.draw(ctx, name, x, y, o); ctx.restore();
    }
  }
  drawSprite(ctx, name, o) {
    o = Object.assign({ ax: 0.5, ay: 1 }, o || {});
    let x = this.cx, y = this.y + this.h + 1;
    if (this.squash) { o.sy = 0.35; }
    if (this.dying && !this.squash && !this.sink) { o.flipY = true; o.ay = 0; y = this.y; }
    if (this.sink) o.alpha = Math.max(0, 1 - this.dying);
    SPR.draw(ctx, name, x, y, o);
    if (this.flash > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = this.flash * 2;
      SPR.draw(ctx, name, x, y, o); ctx.restore();
    }
  }
}

class Walker extends Enemy {
  constructor(e, brute) {
    const [bx, by] = cellBottom(e);
    const w = brute ? 28 : 24, h = brute ? 34 : 28;
    super(bx - w / 2, by - h, w, h);
    this.brute = brute;
    this.hp = brute ? 2 : 1;
    this.speed = brute ? 48 : 58;
    this.score = brute ? 200 : 100;
    this.anim = brute ? 'bwalk' : 'gwalk';   // 8-frame walk cycles generated by tools/cut.py
    this.walked = 0;
  }
  update(w, dt) {
    this.t += dt;
    if (this.updateDying(w, dt)) return;
    this.flash = Math.max(0, this.flash - dt);
    // wakes up a bit beyond the visible area (the view is 960 px wide, plus the camera shift toward the mouse),
    // so every monster that can be seen is already walking
    if (!this.active) { if (Math.abs(this.cx - w.player.cx) < 1100) this.active = true; else return; }
    if (this.onGround || Math.abs(this.vx) <= this.speed + 1) this.vx = this.dir * this.speed;
    else this.vx = U.approach(this.vx, this.dir * this.speed, 300 * dt);
    this.vy = Math.min(this.vy + GRAV * dt, MAX_FALL);
    const x0 = this.x;
    w.moveBody(this, dt);
    this.walked += Math.abs(this.x - x0);
    if (this.hitX) this.dir = -this.hitX;
    if (this.onGround) {
      const fx = this.dir > 0 ? this.x + this.w + 2 : this.x - 2;
      if (!w.isSolid(Math.floor(fx / TILE), Math.floor((this.y + this.h + 4) / TILE), 'body')) this.dir = -this.dir;
      w.standOn(this);
    }
    this.commonChecks(w);
  }
  onTeleport() { this.dir = U.sign(this.vx) || this.dir; }
  draw(ctx) {
    const f = this.anim + (Math.floor(this.walked / 3) % 8);
    this.drawSprite(ctx, f, { flip: this.dir > 0 });
  }
}

class Slime extends Enemy {
  constructor(e) {
    const [bx, by] = cellBottom(e);
    super(bx - 12, by - 20, 24, 20);
    this.hop = 1 + Math.random();
  }
  update(w, dt) {
    this.t += dt;
    if (this.updateDying(w, dt)) return;
    const p = w.player;
    if (this.onGround) {
      this.vx = U.approach(this.vx, 0, 600 * dt);
      this.hop -= dt;
      if (this.hop <= 0 && Math.abs(p.cx - this.cx) < 620) {
        this.dir = U.sign(p.cx - this.cx) || -1;
        this.vy = -380 - Math.random() * 120; this.vx = this.dir * (90 + Math.random() * 50);
        this.hop = 1 + Math.random() * 1.2;
      }
    }
    this.vy = Math.min(this.vy + GRAV * dt, MAX_FALL);
    w.moveBody(this, dt);
    if (this.hitX) this.vx = -this.vx * 0.5;
    this.commonChecks(w);
  }
  draw(ctx) {
    const squish = this.onGround ? 1 + Math.sin(this.t * 6) * 0.06 : 0.9;
    this.drawSprite(ctx, this.onGround ? 'slime0' : 'slime1', { sy: squish, sx: 2 - squish, flip: this.dir > 0 });
  }
}

class Plant extends Enemy {
  constructor(e) {
    const [bx, by] = cellBottom(e);
    super(bx - 13, by - 40, 26, 40);
    this.stompable = false; this.portalable = false;
    this.cool = 1.5 + Math.random(); this.shootT = 0; this.score = 150;
  }
  update(w, dt) {
    this.t += dt;
    if (this.updateDying(w, dt)) return;
    this.flash = Math.max(0, this.flash - dt);
    const p = w.player;
    this.dir = p.cx < this.cx ? -1 : 1;
    this.shootT -= dt;
    const dx = p.cx - this.cx, dy = p.cy - (this.y + 10);
    const inRange = Math.hypot(dx, dy) < 420 && !p.dying;
    // the countdown only runs while the hero is in range (out of range it waits at 0.8 s), so a plant
    // that has been waiting does not shoot the instant he appears: it always shows the wind-up first
    if (inRange) this.cool -= dt; else this.cool = Math.max(this.cool, 0.8);
    if (this.cool <= 0 && inRange) {
      const a = Math.atan2(dy, dx);
      w.add(new Proj('fire', this.cx + Math.cos(a) * 14, this.y + 12 + Math.sin(a) * 10, Math.cos(a) * 240, Math.sin(a) * 240, this));
      this.cool = 2.2 + Math.random() * 0.6; this.shootT = 0.3;
    }
  }
  // calm (sways gently, closed bulb) -> alert when the hero is near (angry face, faster sway) ->
  // wind-up (opens, swells and trembles, a glow in the mouth) -> spits with a lunge and recoils
  draw(ctx, w) {
    const p = w && w.player, near = p && Math.hypot(p.cx - this.cx, p.cy - this.cy) < 460 && !p.dying;
    const windup = near && this.cool < 0.55 && this.shootT <= 0 ? U.clamp(1 - this.cool / 0.55, 0, 1) : 0;
    if (this.shootT > 0) {
      const k = 1 - this.shootT / 0.3;                       // 0 -> 1 over the spit
      const lunge = k < 0.3 ? 1 + 0.16 * (k / 0.3) : 1.16 - 0.16 * ((k - 0.3) / 0.7);
      this.drawSprite(ctx, 'plant_shoot', { flip: this.dir < 0, sx: lunge, sy: 2 - lunge * 0.98 });
    } else if (windup > 0) {
      const sh = (Math.random() - 0.5) * 2.4 * windup;
      this.drawSprite(ctx, 'plant1', { sx: 1 + 0.12 * windup, sy: 1 + 0.08 * windup });
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gx = this.cx + this.dir * 8 + sh, gy = this.y + 12;
      const gr = 18 * windup + 4;
      const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr);
      g.addColorStop(0, 'rgba(255,170,60,' + (0.7 * windup) + ')'); g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g; ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      ctx.restore();
    } else {
      const i = Math.floor(this.t * (near ? 5.6 : 3.3)) % 8;
      this.drawSprite(ctx, (near ? 'pasway' : 'psway') + i, {});
    }
  }
}

class Turret extends Enemy {
  constructor(e, right) {
    const [bx, by] = cellBottom(e);
    super(bx - 16, by - 30, 32, 30);
    this.dir = right ? 1 : -1;
    this.stompable = false; this.portalable = false;
    this.cool = 1 + Math.random(); this.shootT = 0; this.score = 250;
  }
  update(w, dt) {
    this.t += dt;
    if (this.updateDying(w, dt)) return;
    this.flash = Math.max(0, this.flash - dt);
    this.cool -= dt; this.shootT -= dt;
    if (this.cool <= 0 && Math.abs(w.player.cx - this.cx) < 760) {
      w.add(new Proj('fire', this.cx + this.dir * 22, this.y + 12, this.dir * 230, 0, this));
      this.cool = 1.8; this.shootT = 0.25;
    }
  }
  draw(ctx) {
    this.drawSprite(ctx, 'spitter', { flip: this.dir < 0, sx: this.shootT > 0 ? 1.08 : 1 });
  }
}

class Bat extends Enemy {
  constructor(e) {
    const [bx, by] = cellBottom(e);
    super(bx - 14, by - 28, 28, 18);
    this.hx = this.x; this.hy = this.y; this.swoop = 0; this.portalable = true;
  }
  update(w, dt) {
    this.t += dt;
    if (this.updateDying(w, dt)) return;
    const p = w.player;
    const d = Math.hypot(p.cx - this.cx, p.cy - this.cy);
    let tx, ty;
    if (this.swoop > 0 || (d < 230 && !p.dying && this.rest <= 0)) {
      if (this.swoop <= 0) this.swoop = 1.6;
      this.swoop -= dt;
      if (this.swoop <= 0) this.rest = 1.2;
      tx = p.cx - this.w / 2; ty = p.cy - this.h / 2;
    } else {
      this.rest = (this.rest || 0) - dt;
      tx = this.hx + Math.sin(this.t * 1.3) * 60; ty = this.hy + Math.sin(this.t * 2.6) * 18;
    }
    const sp = this.swoop > 0 ? 150 : 90;
    const dx = tx - this.x, dy = ty - this.y, l = Math.hypot(dx, dy) || 1;
    this.vx = U.approach(this.vx, dx / l * sp, 500 * dt);
    this.vy = U.approach(this.vy, dy / l * sp, 500 * dt);
    this.dir = U.sign(this.vx) || this.dir;
    w.moveBody(this, dt);
    this.commonChecks(w);
  }
  onTeleport() { this.hx = this.x; this.hy = this.y; }
  // wing flap cycle (tools/cut.py: flap0..7), faster while swooping; the body tilts nose-down when it
  // dives and nose-up when it climbs, and it leans into the dive
  draw(ctx) {
    if (this.dying) { this.drawSprite(ctx, 'bat0', { flip: this.dir > 0, ay: 0.8 }); return; }
    const rate = this.swoop > 0 ? 26 : 14;
    const i = Math.floor(this.t * rate) % 8;
    const tilt = U.clamp(this.vy / 260, -0.5, 0.5) * (this.dir > 0 ? 1 : -1);
    const stretch = this.swoop > 0 ? 1.08 : 1;
    this.drawAt(ctx, 'flap' + i, this.cx, this.cy - 2, { flip: this.dir > 0, rot: tilt, sx: stretch });
  }
}

class Eye extends Enemy {
  constructor(e) {
    const [bx, by] = cellBottom(e);
    super(bx - 14, by - 28, 28, 28);
    this.hx = this.x; this.hy = this.y; this.cool = 2 + Math.random(); this.shootT = 0; this.score = 150;
    this.blink = 1 + Math.random() * 3; this.blinkT = 0; this.gx = 0; this.gy = 0;
  }
  update(w, dt) {
    this.t += dt;
    if (this.updateDying(w, dt)) return;
    this.flash = Math.max(0, this.flash - dt);
    const p = w.player;
    this.dir = p.cx < this.cx ? -1 : 1;
    // blink every few seconds; the eye looks toward the hero (the sprite moves a couple of pixels)
    this.blink -= dt;
    if (this.blink <= 0 && this.blinkT <= 0) { this.blinkT = 0.16; this.blink = 2.2 + Math.random() * 3; }
    this.blinkT = Math.max(0, this.blinkT - dt);
    const lx = p.cx - this.cx, ly = p.cy - this.cy, ll = Math.hypot(lx, ly) || 1;
    this.gx = U.approach(this.gx, lx / ll * 2.5, 20 * dt); this.gy = U.approach(this.gy, ly / ll * 2.5, 20 * dt);
    const tx = this.hx + Math.sin(this.t * 0.9) * 40, ty = this.hy + Math.cos(this.t * 1.7) * 24;
    this.vx = (tx - this.x) * 2; this.vy = (ty - this.y) * 2;
    w.moveBody(this, dt);
    this.shootT -= dt;
    const dx = p.cx - this.cx, dy = p.cy - this.cy;
    const inRange = Math.hypot(dx, dy) < 380 && !p.dying;
    if (inRange) this.cool -= dt; else this.cool = Math.max(this.cool, 0.9);   // always charges before the first shot
    if (this.cool <= 0 && inRange) {
      const a = Math.atan2(dy, dx);
      w.add(new Proj('bolt', this.cx, this.cy, Math.cos(a) * 280, Math.sin(a) * 280, this));
      this.cool = 2.6; this.shootT = 0.3;
    }
    this.commonChecks(w);
  }
  onTeleport() { this.hx = this.x; this.hy = this.y; }
  draw(ctx, w) {
    if (this.dying) {
      const f = 'eye0';
      this.drawSprite(ctx, f, { ay: 0.9 });
      return;
    }
    const p = w && w.player, inRange = p && Math.hypot(p.cx - this.cx, p.cy - this.cy) < 380 && !p.dying;
    const charge = inRange && this.cool < 0.7 && this.shootT <= 0 ? U.clamp(1 - this.cool / 0.7, 0, 1) : 0;
    const wob = Math.sin(this.t * 1.4) * 0.07;
    const tr = charge * 1.4;
    const x = this.cx + this.gx * 0.6 + (Math.random() - 0.5) * tr, y = this.cy + this.gy * 0.6 + (Math.random() - 0.5) * tr;
    if (this.shootT > 0) {
      const k = 1 - this.shootT / 0.3;
      const f = 'eye_shoot', ax = this.dir > 0 ? 0.3 : 0.7;
      this.drawAt(ctx, f, this.cx, this.cy, { flip: this.dir < 0, ax, ay: 0.5, sx: 1 + 0.12 * (1 - k) });
      return;
    }
    // charging: a red glow behind the eye that grows
    if (charge > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const r = 14 + 22 * charge, g = ctx.createRadialGradient(this.cx, this.cy, 2, this.cx, this.cy, r);
      g.addColorStop(0, 'rgba(255,60,60,' + (0.55 * charge) + ')'); g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g; ctx.fillRect(this.cx - r, this.cy - r, r * 2, r * 2);
      ctx.restore();
    }
    const bl = this.blinkT > 0 ? Math.sin(Math.PI * (1 - this.blinkT / 0.16)) : 0;     // 0 open ... 1 shut
    this.drawAt(ctx, 'eye0', x, y, { rot: wob, sy: 1 - 0.88 * bl, sx: (1 + 0.1 * charge) * (1 + 0.1 * bl), scale: 1 + 0.08 * charge });
  }
}

// Hangs from the ceiling and drops when something walks below. Goes through portals.
class SpikeBall extends Ent {
  constructor(e, w) {
    const [bx, by] = cellBottom(e);
    super(bx - 13, by - 28, 26, 26);
    this.hx = this.x; this.hy = this.y;
    this.state = 'hang'; this.respawn = !!e.respawn; this.timer = 0;
    this.portalable = true;
    let ty = e.y;
    while (ty > 0 && !w.isSolid(e.x, ty - 1, 'body')) ty--;
    this.ceil = ty * TILE;
  }
  update(w, dt) {
    this.t += dt;
    if (this.state === 'hang') {
      const targets = [w.player, w.boss].filter(t => t && !t.dying && !t.dead);
      // something walks under it: it first trembles for a moment (a warning), then it detaches and falls
      for (const t of targets) if (Math.abs(t.cx - this.cx) < 22 + t.w / 2 && t.y > this.y) {
        this.state = 'shake'; this.shakeT = 0; this.vy = 0; this.vx = 0;
        w.emit('spikeShake', { x: this.cx, y: this.cy });
        break;
      }
      return;
    }
    if (this.state === 'shake') {
      this.shakeT += dt;
      if (Math.random() < dt * 30) w.particle({ x: this.cx + (Math.random() - 0.5) * 10, y: this.ceil + 2, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 60,
        life: 0.5, grav: 600, color: '#6b6f82', size: 1.5 + Math.random() * 1.5 });
      if (this.shakeT >= SPIKE_SHAKE) {
        this.state = 'fall'; this.vy = 0; this.vx = 0;
        w.emit('spikeDrop', { x: this.cx, y: this.cy });
      }
      return;
    }
    if (this.state === 'gone') {
      this.timer -= dt;
      if (this.timer <= 0) { this.state = 'hang'; this.x = this.hx; this.y = this.hy; this.teleports = 0; }
      return;
    }
    this.vy = Math.min(this.vy + GRAV * dt, MAX_FALL);
    this.vx = U.approach(this.vx, 0, 30 * dt);
    w.moveBody(this, dt);
    const p = w.player;
    if (U.overlap(this, p)) p.hurt(w, this);
    for (const e of w.ents) {
      if (!e.enemy || e.dead || e.dying || !U.overlap(this, e)) continue;
      e.damage(w, e.isBoss ? 1 : 9, this);
      this.shatter(w); return;
    }
    if (this.hitY > 0 || this.hitX || this.hitY < 0) {
      if (this.hitTile && w.tile(this.hitTile[0], this.hitTile[1]) === 'C') w.breakCracked(this.hitTile[0], this.hitTile[1]);
      this.shatter(w);
    }
    if (this.y > w.L.h * TILE + 60 || this.inWater(w)) { if (this.inWater(w)) w.ripple(this.cx, this.cy); this.shatter(w); }
  }
  shatter(w) {
    w.emit('spikeLand', { x: this.cx, y: this.cy });
    w.smoke(this.cx, this.cy, 3);
    w.shake = Math.max(w.shake, 4);
    for (let i = 0; i < 6; i++) w.particle({ x: this.cx, y: this.cy, vx: (Math.random() - 0.5) * 300, vy: -100 - Math.random() * 200, life: 0.6, grav: 1200, color: '#3c3f5a', size: 3 });
    if (this.respawn) { this.state = 'gone'; this.timer = 5; this.y = -999; }
    else this.dead = true;
  }
  draw(ctx) {
    if (this.state === 'gone') return;
    if (this.state === 'hang' || this.state === 'shake') {
      // hanging it sways slowly; about to fall it trembles harder and harder
      const k = this.state === 'shake' ? Math.min(1, this.shakeT / SPIKE_SHAKE) : 0;
      const sway = this.state === 'shake' ? (Math.random() - 0.5) * (3 + 6 * k) : Math.sin(this.t * 2) * 2;
      ctx.strokeStyle = '#555a66'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(this.cx, this.ceil); ctx.lineTo(this.cx + sway, this.y + 2); ctx.stroke(); ctx.setLineDash([]);
      SPR.draw(ctx, 'spikeball', this.cx + sway, this.cy, { ax: 0.5, ay: 0.5 });
    } else SPR.draw(ctx, 'spikeball', this.cx, this.cy, { ax: 0.5, ay: 0.5, rot: this.t * 6 });
  }
}

// Ground shock wave from the boss stomp
class Shock extends Ent {
  constructor(x, y, dir) { super(x - 14, y - 24, 28, 24); this.vx = dir * 300; this.life = 1.3; this.portalable = false; this.dir = dir; }
  update(w, dt) {
    this.life -= dt;
    w.moveBody(this, dt);
    if (this.hitX || this.life <= 0) { this.dead = true; w.smoke(this.cx, this.cy, 1); }
    if (U.overlap(this, w.player)) w.player.hurt(w, this);
  }
  draw(ctx) { SPR.draw(ctx, 'smoke1', this.cx, this.y + this.h, { ax: 0.5, ay: 1, scale: 0.7, flip: this.dir < 0, alpha: Math.min(1, this.life * 2) }); }
}

class Boss extends Enemy {
  constructor(e) {
    const [bx, by] = cellBottom(e);
    super(bx - 34, by - 130, 68, 130);
    this.isBoss = true; this.stompable = false; this.portalable = false;
    this.hp = this.maxHp = 8; this.score = 5000;
    this.state = 'sleep'; this.timer = 0; this.shots = 0; this.inv = 0;
    this.homeX = this.x; this.portalFx = null;
    this.walked = 0; this.windup = 0; this.landT = 0; this.recoil = 0;
  }
  damage(w, n, src) {
    if (this.inv > 0 || this.state === 'sleep' || this.dying) return;
    this.hp -= 1; this.inv = 0.7; this.flash = 0.4;
    w.shake = 8;
    w.emit('bossHit', { x: this.cx, y: this.y, portal: !!(src && src.teleports) });
    if (this.hp <= 0) {
      this.dying = 0.001; this.harmful = false; this.keep = true;
      w.emit('kill', { x: this.cx, y: this.y, n: this.score, portal: false });
      w.emit('bossBurn');
    }
  }
  kill() { }
  update(w, dt) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.inv = Math.max(0, this.inv - dt);
    const p = w.player;
    if (this.dying) {
      this.dying += dt;
      if (!this.exploded) {
        // he catches fire: more and more flames and smoke, then he bursts
        const k = Math.min(1, this.dying / BOSS_BURN);
        if (Math.random() < dt * (14 + 30 * k)) {
          const x = this.x + Math.random() * this.w, y = this.y + Math.random() * this.h;
          w.smoke(x, y, 1);
          w.particle({ x, y, vx: (Math.random() - 0.5) * 30, vy: -50 - 40 * k, life: 0.5, sprite: 'fire', size: 0.45 + 0.35 * k, fade: 1 });
        }
        if (Math.random() < dt * (10 + 40 * k)) w.particle({ x: this.x + Math.random() * this.w, y: this.y + Math.random() * this.h, vx: (Math.random() - 0.5) * 80, vy: -80 - Math.random() * 120,
          life: 0.4 + Math.random() * 0.4, grav: 300, color: Math.random() < 0.5 ? '#ffb040' : '#ff6a2a', size: 2 + Math.random() * 2, glow: 1 });
        w.shake = Math.max(w.shake, 1 + 3 * k);
        if (this.dying >= BOSS_BURN) this.explode(w);
      } else if (this.dying > BOSS_BURN + 1.2) { this.dead = true; this.keep = false; }
      return;
    }
    if (this.state === 'sleep') {
      if (p.x > this.homeX - 14 * TILE) { this.state = 'idle'; this.timer = 1.2; w.boss = this; w.emit('bossWake'); }
      return;
    }
    this.dir = p.cx < this.cx ? -1 : 1;
    this.timer -= dt;
    const enraged = this.hp <= 4;
    if (this.state === 'idle') {
      this.vx = U.approach(this.vx, 0, 600 * dt);
      if (this.timer <= 0) {
        const opts = ['walk', 'volley', 'stomp', 'volley', 'summon', 'stomp'];
        this.state = opts[Math.floor(Math.random() * opts.length)];
        if (this.state === 'summon' && w.ents.filter(e => e instanceof Bat && !e.dead).length >= 3) this.state = 'volley';
        this.timer = { walk: 1.8, volley: 1.4, stomp: 3.45, summon: 1.6 }[this.state];
        this.shots = 0;
        // the stomp jump starts after a short crouch (BOSS_WINDUP): a warning for the player
        if (this.state === 'stomp') { this.windup = BOSS_WINDUP; this.airborne = false; this.vx = 0; }
        if (this.state === 'walk') { w.emit('bossGrunt'); this.stepT = 0.25; }
        if (this.state === 'summon') this.portalFx = { x: this.cx + this.dir * 140, y: this.y - 10, t: 0 };
      }
    } else if (this.state === 'walk') {
      this.vx = U.approach(this.vx, this.dir * (enraged ? 120 : 85), 400 * dt);
      this.stepT -= dt;
      if (this.stepT <= 0 && this.onGround) {
        this.stepT = enraged ? 0.38 : 0.5; w.emit('bossStep'); w.shake = Math.max(w.shake, 1.5);
        for (let i = 0; i < 4; i++) w.particle({ x: this.cx + (Math.random() - 0.5) * 40, y: this.y + this.h, vx: (Math.random() - 0.5) * 70, vy: -20 - Math.random() * 40,
          life: 0.4, color: 'rgba(210,200,185,0.7)', size: 2 + Math.random() * 2 });
      }
      if (this.timer <= 0) this.toIdle();
    } else if (this.state === 'volley') {
      this.vx = U.approach(this.vx, 0, 600 * dt);
      const n = enraged ? 5 : 3;
      if (this.timer < 1.3 - this.shots * 0.25 && this.shots < n) {
        this.shots++; this.recoil = 1;
        const sx = this.cx + this.dir * 40, sy = this.y + 48;
        const a = Math.atan2(p.cy - sy, p.cx - sx) + (Math.random() - 0.5) * 0.25;
        w.add(new Proj('fire', sx, sy, Math.cos(a) * 270, Math.sin(a) * 270, this, true));
      }
      if (this.timer <= 0) this.toIdle();
    } else if (this.state === 'stomp') {
      if (this.windup > 0) {
        // crouching: dust rises, then he jumps
        this.windup -= dt; this.vx = 0;
        if (Math.random() < dt * 30) w.particle({ x: this.cx + (Math.random() - 0.5) * 70, y: this.y + this.h, vx: (Math.random() - 0.5) * 90, vy: -10 - Math.random() * 40,
          life: 0.4, color: 'rgba(210,200,185,0.7)', size: 2 + Math.random() * 2 });
        w.shake = Math.max(w.shake, 1.2);
        if (this.windup <= 0) { this.vy = -760; this.vx = U.clamp((p.cx - this.cx) * 1.1, -280, 280); this.airborne = true; w.emit('bossJump'); }
      } else if (this.onGround && this.airborne && this.vy >= 0) {
        this.airborne = false; this.landT = 0.22;
        w.emit('bossLand');
        w.shake = 12;
        w.add(new Shock(this.cx - 40, this.y + this.h, -1));
        w.add(new Shock(this.cx + 40, this.y + this.h, 1));
        this.vx = 0;
        this.timer = Math.min(this.timer, 0.5);
      }
      if (this.timer <= 0 && !this.airborne && this.windup <= 0) this.toIdle();
    } else if (this.state === 'summon') {
      this.vx = 0;
      if (this.portalFx) {
        this.portalFx.t += dt;
        if (this.portalFx.t > 0.8 && !this.portalFx.done) {
          this.portalFx.done = true;
          for (let i = 0; i < 2; i++) {
            const b = w.add(new Bat({ x: Math.floor(this.portalFx.x / TILE), y: Math.floor(this.portalFx.y / TILE) }));
            b.vx = (i ? 1 : -1) * 120;
            b.score = 50;
          }
        }
      }
      if (this.timer <= 0) { this.portalFx = null; this.toIdle(); }
    }
    this.vy = Math.min(this.vy + GRAV * dt, MAX_FALL);
    const bx = this.x;
    w.moveBody(this, dt);
    this.walked += Math.abs(this.x - bx);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.landT = Math.max(0, this.landT - dt);
  }
  toIdle() { this.state = 'idle'; this.timer = this.hp <= 4 ? 0.5 : 0.9; }
  // Bursts into about a thousand reddish fragments (the pixels of his sprite) that fly out and fall
  explode(w) {
    this.exploded = true;
    const sc = ATLAS.boss_defeat, step = 3;
    const sx = this.cx - sc[2] / 2, sy = this.y + this.h + 2 - sc[3];
    for (const [px, py, r, g, b] of BOSS_PIXELS) {
      const x = sx + (this.dir > 0 ? sc[2] - px - step : px) + step / 2, y = sy + py + step / 2;
      const dx = x - this.cx, dy = y - (this.y + this.h * 0.45), d = Math.hypot(dx, dy) || 1;
      const sp = 120 + Math.random() * 520;
      // the original colour pushed toward red / fire, a few pieces are pure embers
      const hot = Math.random() < 0.22;
      const col = hot ? (Math.random() < 0.5 ? '#ff7a2a' : '#ffc050')
        : 'rgb(' + Math.min(255, Math.round(r * 0.55 + 130)) + ',' + Math.round(g * 0.4 + 18) + ',' + Math.round(b * 0.3 + 14) + ')';
      w.particle({ x, y, vx: dx / d * sp + (Math.random() - 0.5) * 90, vy: dy / d * sp - 140 - Math.random() * 260, life: 0.9 + Math.random() * 1.3,
        grav: 950, color: col, size: step + (Math.random() < 0.25 ? 1 : 0), glow: hot ? 1 : 0 });
    }
    for (let i = 0; i < 14; i++) w.smoke(this.cx + (Math.random() - 0.5) * 80, this.y + Math.random() * this.h, 1);
    w.shake = 18;
    w.emit('bossExplode');
    w.emit('bossDefeated');
  }
  draw(ctx) {
    if (this.portalFx) {
      const s = Math.min(1, this.portalFx.t * 2.5) * 0.8;
      SPR.draw(ctx, 'boss_portal', this.portalFx.x, this.portalFx.y, { ax: 0.5, ay: 0.5, scale: s, alpha: 0.9 });
    }
    if (this.dying) {
      if (this.exploded) return;
      // burning: the sprite trembles and turns more and more red (a red silhouette fades in over it)
      const k = Math.min(1, this.dying / BOSS_BURN), sc = ATLAS.boss_defeat;
      const jx = (Math.random() - 0.5) * (1 + 4 * k), jy = (Math.random() - 0.5) * (1 + 2 * k);
      const x = this.cx + jx, y = this.y + this.h + 2 + jy;
      SPR.draw(ctx, 'boss_defeat', x, y, { ax: 0.5, ay: 1, flip: this.dir > 0 });
      ctx.save();
      ctx.globalAlpha = Math.min(0.88, 0.1 + 0.8 * k * k) * (0.85 + 0.15 * Math.sin(this.dying * 30));
      ctx.translate(Math.round(x), Math.round(y));
      if (this.dir > 0) ctx.scale(-1, 1);
      ctx.drawImage(SPR.tinted('boss_defeat', '#ff2a14'), -sc[2] / 2, -sc[3]);
      ctx.restore();
      return;
    }
    // pose: breathing when idle, an 8-frame walk, a crouch before the jump (squash), a stretch in the air,
    // a squash on landing, a backward lean and a pulse when firing, a throb when summoning
    let name = 'boss', sx = 1, sy = 1, rot = 0, jx = 0;
    const flipS = this.dir > 0 ? -1 : 1;
    if (this.state === 'idle') sy = 1 + 0.014 * Math.sin(this.t * 2.6);
    else if (this.state === 'walk' && this.onGround) { name = 'bwk' + (Math.floor(this.walked / 9) % 8); rot = 0.03 * flipS * -1; }
    else if (this.state === 'stomp') {
      if (this.windup > 0) { const k = 1 - this.windup / BOSS_WINDUP; sy = 1 - 0.14 * Math.min(1, k * 1.6); sx = 1 + 0.07 * k; jx = (Math.random() - 0.5) * 2 * k; }
      else if (this.airborne) { sy = 1.07; sx = 0.95; }
      else if (this.landT > 0) { const k = this.landT / 0.22; sy = 1 - 0.13 * k; sx = 1 + 0.07 * k; }
    } else if (this.state === 'volley') { rot = -0.05 * flipS * -1 * this.recoil; sx = 1 + 0.05 * this.recoil; sy = 1 - 0.02 * this.recoil; }
    else if (this.state === 'summon') { sy = 1.02 + 0.03 * Math.sin(this.t * 12); sx = 1.01; }
    const enraged = this.hp <= 4;
    const ox = this.cx + jx, oy = this.y + this.h + 1;
    this.drawSprite(ctx, name, { flip: this.dir > 0, sx, sy, rot, ax: 0.5, ay: 1 });
    // enraged: a red throbbing silhouette over the armour
    if (enraged) {
      const sc = ATLAS[name];
      ctx.save();
      ctx.globalAlpha = 0.14 + 0.12 * Math.sin(this.t * 6);
      ctx.translate(Math.round(ox), Math.round(oy));
      ctx.rotate(rot);
      ctx.scale((this.dir > 0 ? -1 : 1) * sx, sy);
      ctx.drawImage(SPR.tinted(name, '#ff2a14'), -sc[2] / 2, -sc[3]);
      ctx.restore();
    }
    // glowing eyes (white-blue, red when enraged)
    const eyes = [[34, 21], [45, 22]];
    const top = oy - ATLAS.boss[3] * sy, cxs = ox;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [ex, ey] of eyes) {
      const px = cxs + (ex - ATLAS.boss[2] / 2) * sx * (this.dir > 0 ? -1 : 1), py = top + ey * sy;
      const r = 6 + 2 * Math.sin(this.t * 5 + ex);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, enraged ? 'rgba(255,70,50,0.85)' : 'rgba(170,215,255,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    ctx.restore();
  }
}

// ======================= Projectiles =======================
// fire: plant / turret / boss fireballs. bolt: eye shots. plasma: the player's power-up shot.
class Proj extends Ent {
  constructor(kind, x, y, vx, vy, owner, big) {
    super(x - 7, y - 7, 14, 14);
    this.kind = kind; this.vx = vx; this.vy = vy; this.owner = owner;
    this.shot = true; this.life = 5; this.big = big;
  }
  // an enemy fired it: tell the game, so it can play the shot sound (volume depends on distance)
  init(w) {
    if (this.owner && this.owner.enemy) w.emit('enemyShot', { kind: this.kind, big: !!this.big, x: this.cx, y: this.cy });
  }
  update(w, dt) {
    this.life -= dt;
    w.moveBody(this, dt);
    const trail = this.kind === 'plasma' || this.kind === 'bolt' ? '#7fd0ff' : '#ffb040';
    if (Math.random() < 0.6) w.particle({ x: this.cx, y: this.cy, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.3, color: trail, size: 2 + Math.random() * 2, glow: 1 });
    if (this.hitX || this.hitY) {
      const [tx, ty] = this.hitTile;
      if (w.tile(tx, ty) === 'C' && this.kind !== 'bolt') w.breakCracked(tx, ty);
      return this.explode(w, 'wall');
    }
    if (this.life <= 0 || this.inWater(w) || this.y > w.L.h * TILE + 40) return this.explode(w);
    const p = w.player;
    if (this.kind !== 'plasma' && U.overlap(this, p) && !p.dying) { p.hurt(w, this); return this.explode(w); }
    for (const e of w.ents) {
      if (!e.enemy || e.dead || e.dying || !U.overlap(this, e)) continue;
      if (this.kind !== 'plasma' && !this.teleports && (e === this.owner || !e.isBoss)) continue;
      if (e.isBoss && this.kind !== 'plasma' && !this.teleports) continue;
      e.damage(w, 1, this);
      return this.explode(w, 'enemy');
    }
  }
  explode(w, how) {
    this.dead = true;
    if (this.kind === 'plasma' && how) w.emit('plasmaHit', { how });
    else if (how === 'wall') w.emit('enemyHit', { kind: this.kind, x: this.cx, y: this.cy });
    const col = this.kind === 'fire' ? '#ff9a30' : '#7fd0ff';
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 7, s = 40 + Math.random() * 120;
      w.particle({ x: this.cx, y: this.cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, color: col, size: 2.5, glow: 1 });
    }
  }
  draw(ctx) {
    const name = this.kind === 'fire' ? 'fireball_o' : 'fireball_b';
    const sc = this.kind === 'bolt' ? 0.6 : this.big ? 1.2 : 0.85;
    SPR.draw(ctx, name, this.cx, this.cy, { ax: 0.72, ay: 0.5, rot: Math.atan2(this.vy, this.vx), scale: sc });
  }
}

// ======================= Pickups and props =======================
const PICKUP_SPRITE = { coin: 'coin', scoin: 'scoin', heart: 'heart', potion: 'potion', medkit: 'medkit', plasma: 'fireball_b', orb: 'orb' };

class Pickup extends Ent {
  constructor(e) {
    super((e.x + 0.5) * TILE - 11, (e.y + 0.5) * TILE - 11, 22, 22);
    this.kind = e.t; this.portalable = false; this.rise = 0;
  }
  update(w, dt) {
    this.t += dt;
    if (this.rise > 0) { const d = Math.min(this.rise, 70 * dt); this.y -= d; this.rise -= d; return; }
    const p = w.player;
    if (!p.dying && U.overlap(this, p)) {
      this.dead = true;
      const k = this.kind;
      if (k === 'coin') w.emit('coin', { n: 1, x: this.cx, y: this.y });
      else if (k === 'scoin') w.emit('coin', { n: 5, x: this.cx, y: this.y });
      else if (k === 'heart') { if (p.hp >= p.maxHp && p.maxHp < 5) p.maxHp++; p.hp = Math.min(p.maxHp, p.hp + 1); w.emit('power', { text: 'HEART +1', x: this.cx, y: this.y }); }
      else if (k === 'potion') { if (p.maxHp < 5) p.maxHp++; p.hp = p.maxHp; w.emit('power', { text: 'HEART CONTAINER! MAX HEALTH +1', x: this.cx, y: this.y }); }
      else if (k === 'medkit') { p.hp = p.maxHp; w.emit('power', { text: 'FULL HEALTH', x: this.cx, y: this.y }); }
      else if (k === 'plasma') { p.plasma += 12; w.emit('power', { text: 'PLASMA CORE! (SHIFT or MIDDLE CLICK)', x: this.cx, y: this.y }); }
      else if (k === 'orb') { p.shield = 10; w.emit('power', { text: 'SHIELD!', x: this.cx, y: this.y }); }
      if (k !== 'coin' && k !== 'scoin') w.emit('powerGet', { kind: k });
      for (let i = 0; i < 6; i++) w.particle({ x: this.cx, y: this.cy, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 120, life: 0.4, color: '#fff6a0', size: 2, glow: 1 });
    }
  }
  draw(ctx) {
    const name = PICKUP_SPRITE[this.kind];
    const bob = Math.sin(this.t * 3) * 2;
    if (this.kind === 'coin' || this.kind === 'scoin') {
      SPR.draw(ctx, name, this.cx, this.cy + bob, { ax: 0.5, ay: 0.5, sx: Math.max(0.15, Math.abs(Math.cos(this.t * 3))) });
    } else {
      const g = ctx.createRadialGradient(this.cx, this.cy, 2, this.cx, this.cy, 22);
      g.addColorStop(0, 'rgba(255,255,220,0.5)'); g.addColorStop(1, 'rgba(255,255,220,0)');
      ctx.fillStyle = g; ctx.fillRect(this.cx - 22, this.cy - 22, 44, 44);
      if (this.kind === 'orb') {
        ctx.strokeStyle = 'rgba(140,220,255,' + (0.5 + Math.sin(this.t * 6) * 0.3) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.cx, this.cy + bob, 15, 0, 7); ctx.stroke();
      }
      SPR.draw(ctx, name, this.cx, this.cy + bob, { ax: 0.5, ay: 0.5, scale: this.kind === 'plasma' ? 0.75 : 1 });
    }
  }
}

class CoinPop extends Ent {
  constructor(x, y) { super(x - 10, y - 24, 20, 24); this.vy = -420; this.portalable = false; this.life = 0.55; }
  update(w, dt) { this.t += dt; this.life -= dt; this.vy += 1300 * dt; this.y += this.vy * dt; if (this.life <= 0) this.dead = true; }
  draw(ctx) { SPR.draw(ctx, 'coin', this.cx, this.cy, { ax: 0.5, ay: 0.5, sx: Math.max(0.15, Math.abs(Math.cos(this.t * 14))) }); }
}

class Chest extends Ent {
  constructor(e) { const [bx, by] = cellBottom(e); super(bx - 17, by - 28, 34, 28); this.portalable = false; this.open = false; }
  update(w) {
    if (this.open || w.player.dying || !U.overlap(this, w.player)) return;
    this.open = true;
    w.emit('coin', { n: 10, x: this.cx, y: this.y });
    w.emit('power', { text: 'TREASURE! +10 COINS', x: this.cx, y: this.y - 20 });
    for (let i = 0; i < 10; i++) w.particle({ x: this.cx, y: this.y + 6, vx: (Math.random() - 0.5) * 200, vy: -250 - Math.random() * 200, life: 0.9, grav: 900, sprite: 'coin', size: 0.6 });
    if (w.player.hp < w.player.maxHp) w.player.hp++;
  }
  draw(ctx) { SPR.draw(ctx, this.open ? 'fo_chest_open' : 'fo_chest', this.cx, this.y + this.h + 1, { ax: 0.5, ay: 1 }); }
}

// Checkpoint: just a torch. Not reached yet: a dull ember on a dark stick (with a faint wisp of
// smoke). Reached: the torch ignites and burns brightly (big flickering flame, glow, sparks).
class Checkpoint extends Ent {
  constructor(e) { const [bx, by] = cellBottom(e); super(bx - 16, by - 64, 32, 64); this.portalable = false; this.on = false; this.cell = [e.x, e.y]; this.flare = 0; }
  update(w, dt) {
    this.t += dt;
    const top = this.y + this.h - 40;   // top of the stick
    if (!this.on && !w.player.dying && U.overlap(this, w.player)) {
      this.on = true; this.flare = 0.6;
      w.emit('checkpoint', { x: this.cell[0], y: this.cell[1], px: this.cx, py: this.y });
      for (let i = 0; i < 18; i++) w.particle({ x: this.cx + (Math.random() - 0.5) * 8, y: top - 6, vx: (Math.random() - 0.5) * 140, vy: -60 - Math.random() * 140,
        life: 0.5 + Math.random() * 0.5, grav: 250, color: i % 2 ? '#ffd060' : '#ff8a30', size: 2 + Math.random() * 2, glow: 1 });
    }
    this.flare = Math.max(0, this.flare - dt);
    if (this.on) {
      if (Math.random() < dt * 26) w.particle({ x: this.cx + (Math.random() - 0.5) * 8, y: top - 8 - Math.random() * 6, vx: (Math.random() - 0.5) * 36, vy: -50 - Math.random() * 70,
        life: 0.5 + Math.random() * 0.4, color: Math.random() < 0.5 ? '#ffcf60' : '#ff9a3a', size: 1.5 + Math.random() * 1.5, glow: 1 });
    } else if (Math.random() < dt * 1.2) {
      w.particle({ x: this.cx, y: top - 2, vx: (Math.random() - 0.5) * 8, vy: -16 - Math.random() * 10, life: 1.1, color: 'rgba(150,150,160,0.45)', size: 3 });
    }
  }
  draw(ctx) {
    const bx = this.cx, by = this.y + this.h + 1, k = 2.4;
    const r = ATLAS.torch, rows = 12;               // rows 0-11 of the sprite are its flame: only the stick is used
    const sh = (r[3] - rows) * k, top = by - sh;
    ctx.save();
    if (!this.on) ctx.globalAlpha = 0.8;
    ctx.drawImage(SPR.img.atlas, r[0], r[1] + rows, r[2], r[3] - rows, Math.round(bx - r[2] * k / 2), Math.round(top), r[2] * k, sh);
    ctx.restore();
    if (!this.on) {
      // dim ember: a faint pulsing glow and a dull orange spark on the stick
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 2.2);
      const g = ctx.createRadialGradient(bx, top, 0, bx, top, 16);
      g.addColorStop(0, 'rgba(255,110,40,' + (0.16 + 0.1 * pulse) + ')'); g.addColorStop(1, 'rgba(255,110,40,0)');
      ctx.fillStyle = g; ctx.fillRect(bx - 16, top - 16, 32, 32);
      ctx.fillStyle = 'rgba(210,80,30,' + (0.45 + 0.3 * pulse) + ')';
      ctx.fillRect(Math.round(bx - 2), Math.round(top - 3), 4, 3);
      return;
    }
    // burning: flickering flame sprite with a big warm glow (bigger for a moment after ignition)
    const fl = 1 + this.flare * 1.2, flick = 0.92 + 0.14 * Math.sin(this.t * 17) + 0.06 * Math.sin(this.t * 31);
    const gr = 58 * fl;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(bx, top - 14, 2, bx, top - 14, gr);
    g.addColorStop(0, 'rgba(255,190,90,' + (0.55 * flick) + ')'); g.addColorStop(0.45, 'rgba(255,140,50,0.2)'); g.addColorStop(1, 'rgba(255,110,30,0)');
    ctx.fillStyle = g; ctx.fillRect(bx - gr, top - 14 - gr, gr * 2, gr * 2);
    ctx.restore();
    const flip = Math.floor(this.t * 9) % 2 === 0;
    SPR.draw(ctx, 'fire', bx, top + 6, { ax: 0.5, ay: 1, sx: 0.9 * fl * (0.95 + 0.1 * Math.sin(this.t * 21)), sy: 0.95 * fl * flick, flip });
  }
}

class Exit extends Ent {
  constructor(e) { const [bx, by] = cellBottom(e); super(bx - 18, by - 64, 36, 64); this.portalable = false; this.boss = !!e.boss; this.cell = [e.x, e.y]; }
  update(w, dt) {
    const p = w.player;
    this.locked = this.boss && !w.bossDone;   // the boss door opens after he has exploded
    if (this.enter) { this.runEnter(w, dt); return; }
    if (!this.locked && !p.dying && !p.won && Math.abs(p.cx - this.cx) < 14 && p.y + p.h > this.y + 20 && p.y < this.y + this.h) {
      this.enter = { t: 0, x0: p.x, opened: false, closed: false };
      this.open = 0;
      w.emit('exit');
    }
  }
  // Exit sequence (about 1.5 s): the hero steps to the middle of the door, the door swings open,
  // he fades into the doorway, and the door closes behind him with a thud and a puff of dust.
  runEnter(w, dt) {
    const e = this.enter, p = w.player;
    e.t += dt;
    const t = e.t, ease = v => v * v * (3 - 2 * v), cl = v => Math.max(0, Math.min(1, v));
    p.won = true; p.vx = 0;
    p.x = e.x0 + (this.cx - p.w / 2 - e.x0) * ease(cl(t / 0.35));
    if (!e.opened && t >= 0.35) { e.opened = true; w.emit('doorOpen'); }
    this.open = t < 0.35 ? 0 : t < 0.65 ? ease((t - 0.35) / 0.3) : t < 1.1 ? 1 : 1 - ease(cl((t - 1.1) / 0.35));
    p.alpha = 1 - cl((t - 0.7) / 0.4);
    if (!e.closed && t >= 1.45) {
      e.closed = true; w.emit('doorClose');
      w.shake = Math.max(w.shake, 3);
      for (let i = 0; i < 10; i++) w.particle({ x: this.cx + (Math.random() - 0.5) * 36, y: this.y + this.h, vx: (Math.random() - 0.5) * 140, vy: -20 - Math.random() * 60,
        life: 0.5, color: 'rgba(225,215,190,0.8)', size: 2 + Math.random() * 3 });
    }
  }
  // The door sits in a small gatehouse: a 3x3 tile wall behind it (mossy bricks, or panels in the
  // city world) with a roof ledge and a dark recess, so it is not a lone door on the grass.
  // Purely visual: it does not change the level data or the collisions.
  wall(ctx, w) {
    const [cx, cy] = this.cell, th = w && w.theme;
    const city = th && th.city;
    const p = city ? 'ct_' : 'fo_';
    const cols = city ? [2, 3, 4] : [10, 11, 12], top = city ? 4 : 12, mid = city ? 5 : 13, bot = city ? 6 : 13;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      SPR.tile(ctx, p + cols[c] + '_' + (r === 0 ? top : r === 2 ? bot : mid), (cx - 1 + c) * TILE, (cy - 2 + r) * TILE);
    }
    // roof ledge, slightly wider than the wall
    ctx.fillStyle = city ? '#8a86e0' : '#6d6a55';
    ctx.fillRect((cx - 1) * TILE - 4, (cy - 2) * TILE - 5, 3 * TILE + 8, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect((cx - 1) * TILE - 4, (cy - 2) * TILE + 1, 3 * TILE + 8, 4);
    // recess behind the door and a soft shadow on the ground at the base
    const g = ctx.createRadialGradient(this.cx, this.y + 36, 6, this.cx, this.y + 36, 56);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect((cx - 1) * TILE, (cy - 2) * TILE, 3 * TILE, 3 * TILE);
  }
  draw(ctx, w) {
    if (!this.boss) this.wall(ctx, w);
    if (!this.locked) {
      const g = ctx.createRadialGradient(this.cx, this.y + 30, 4, this.cx, this.y + 30, 60);
      g.addColorStop(0, 'rgba(255,240,170,0.45)'); g.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = g; ctx.fillRect(this.cx - 60, this.y - 30, 120, 120);
    }
    const open = this.open || 0;
    if (open <= 0) SPR.draw(ctx, 'door', this.cx, this.y + this.h + 1, { ax: 0.5, ay: 1, scale: 1.1 });
    else {
      // open doorway: dark interior with a warm light, and the door leaf swinging toward the viewer
      const dx = this.cx - 16, dy = this.y + 7, dh = this.h - 7;
      const gi = ctx.createLinearGradient(0, dy, 0, dy + dh);
      gi.addColorStop(0, '#120c08'); gi.addColorStop(1, '#6a4a2a');
      ctx.fillStyle = gi; ctx.fillRect(dx, dy, 32, dh);
      ctx.fillStyle = 'rgba(255,214,140,' + (0.25 * open) + ')'; ctx.fillRect(dx, dy + dh - 10, 32, 10);
      SPR.draw(ctx, 'door', this.cx - 20, this.y + this.h + 1, { ax: 0, ay: 1, scale: 1.1, sx: Math.max(0.12, 1 - 0.85 * open) });
    }
    if (!this.boss) {
      // plants at the two ends of the wall
      const by = this.y + this.h + 2;
      SPR.draw(ctx, 'fo_tuft', this.cx - 52, by, { ax: 0.5, ay: 1 });
      SPR.draw(ctx, 'fo_tuft', this.cx + 54, by, { ax: 0.5, ay: 1, flip: true });
    }
    if (this.locked) {
      ctx.strokeStyle = '#2a2a30'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(this.x - 2, this.y + 18); ctx.lineTo(this.x + this.w + 2, this.y + 50);
      ctx.moveTo(this.x + this.w + 2, this.y + 18); ctx.lineTo(this.x - 2, this.y + 50); ctx.stroke();
    }
  }
}

class Sign extends Ent {
  constructor(e) { const [bx, by] = cellBottom(e); super(bx - 16, by - 30, 32, 30); this.text = e.text || ''; this.portalable = false; }
  // The hint is a small translucent tooltip above the player's head: it fades in when the hero is
  // close to the sign and fades out when he walks away.
  update(w, dt) {
    const p = w.player;
    const near = this.text && Math.abs(p.cx - this.cx) < 72 && Math.abs(p.cy - this.cy) < 72;
    this.fade = U.approach(this.fade || 0, near ? 1 : 0, dt * 5);
    if (this.fade > 0.02) w.bubble = { x: this.cx, y: this.y - 36 - (1 - this.fade) * 8, text: this.text, a: this.fade };
  }
  draw(ctx, w) { SPR.draw(ctx, w && w.theme && w.theme.city ? 'ct_p_sign' : 'sign', this.cx, this.y + this.h + 1, { ax: 0.5, ay: 1 }); }
}

class Secret extends Ent {
  constructor(e) { super((e.x - 1) * TILE, (e.y - 1) * TILE, 3 * TILE, 3 * TILE); this.portalable = false; }
  update(w) { if (!w.player.dying && U.overlap(this, w.player)) { this.dead = true; w.secretsFound++; w.emit('secret', { x: this.cx, y: this.y }); } }
}

class Decor extends Ent {
  constructor(e) {
    const [bx, by] = cellBottom(e);
    super(bx - 16, by - 32, 32, 32);
    this.kind = e.t; this.portalable = false; this.decor = true;
    this.ox = ((e.x * 7919) % 11) - 5;
    this.v = (e.x * 7 + e.y * 13) >>> 0;   // stable pseudo-random variant (per position)
  }
  update(w, dt) {
    this.t += dt;
    const city = w.theme && w.theme.city;
    if (this.kind === 'torch' && !city && Math.random() < dt * 12) w.particle({ x: this.cx + this.ox, y: this.y + this.h - 30, vx: (Math.random() - 0.5) * 10, vy: -30, life: 0.5, color: '#ffb040', size: 2, glow: 1 });
  }
  // World 3 (city): the same decoration kinds become street furniture from Props-01.png
  drawCity(ctx) {
    const v = this.v, by = this.y + this.h + 2, x = this.cx + this.ox;
    const pick = a => a[v % a.length];
    switch (this.kind) {
      case 'bush': SPR.draw(ctx, pick(['ct_p_bag', 'ct_p_bag2', 'ct_p_bag']), x, by, { ax: 0.5, ay: 1 }); break;
      case 'rock': SPR.draw(ctx, pick(['ct_p_bollard', 'ct_p_bag2', 'ct_p_bollard']), x, by, { ax: 0.5, ay: 1 }); break;
      case 'crate': SPR.draw(ctx, pick(['ct_p_mailbox', 'ct_p_mailbox', 'ct_p_kiosk', 'ct_p_mailbox']), x, by, { ax: 0.5, ay: 1 }); break;
      case 'barrel': SPR.draw(ctx, 'ct_p_tl' + ((Math.floor(this.t / 1.1) + v) % 4), x, by, { ax: 0.5, ay: 1 }); break;   // traffic light, cycles its lights
      case 'fence': SPR.draw(ctx, pick(['ct_p_barrier', 'ct_p_barrier2', 'ct_p_frame']), x, by, { ax: 0.5, ay: 1 }); break;
      case 'torch': {
        // street lamp: pole with a cold light at the top
        const top = by - 116, r = 40 + Math.sin(this.t * 2 + v) * 1.5;
        const g = ctx.createRadialGradient(x + 14, top + 4, 2, x + 14, top + 4, r);
        g.addColorStop(0, 'rgba(190,220,255,0.38)'); g.addColorStop(1, 'rgba(150,190,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x + 14 - r, top + 4 - r, r * 2, r * 2);
        SPR.draw(ctx, 'ct_p_pole', x - 8, by, { ax: 0.5, ay: 1 });
        break;
      }
    }
  }
  draw(ctx, w) {
    if (w && w.theme && w.theme.city) return this.drawCity(ctx);
    const name = { bush: 'fo_tuft', rock: 'fo_rock', crate: 'fo_pot', barrel: 'fo_pot2', torch: 'torch', fence: 'fo_cattail' }[this.kind];
    if (this.kind === 'torch') {
      const r = 26 + Math.sin(this.t * 13) * 2;
      const g = ctx.createRadialGradient(this.cx + this.ox, this.y + this.h - 28, 2, this.cx + this.ox, this.y + this.h - 28, r);
      g.addColorStop(0, 'rgba(255,190,90,0.5)'); g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = g; ctx.fillRect(this.cx + this.ox - r, this.y + this.h - 28 - r, r * 2, r * 2);
    }
    SPR.draw(ctx, name, this.cx + this.ox, this.y + this.h + 2, { ax: 0.5, ay: 1 });
  }
}

function makeEntity(e, w) {
  switch (e.t) {
    case 'goblin': return new Walker(e, false);
    case 'brute': return new Walker(e, true);
    case 'slime': return new Slime(e);
    case 'plant': return new Plant(e);
    case 'turret': return new Turret(e, false);
    case 'turretR': return new Turret(e, true);
    case 'bat': return new Bat(e);
    case 'eye': return new Eye(e);
    case 'spikeball': return new SpikeBall(e, w);
    case 'boss': return new Boss(e);
    case 'coin': case 'scoin': case 'heart': case 'potion': case 'medkit': case 'plasma': case 'orb': return new Pickup(e);
    case 'chest': return new Chest(e);
    case 'checkpoint': return new Checkpoint(e);
    case 'exit': return new Exit(e);
    case 'sign': return new Sign(e);
    case 'secret': return new Secret(e);
    case 'bush': case 'rock': case 'crate': case 'barrel': case 'torch': case 'fence': return new Decor(e);
  }
  return null;
}
