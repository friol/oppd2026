'use strict';
// Game simulation: player, weapons, enemies, projectiles, pickups, traps,
// plus the sprite list and first-person weapon overlay for each frame.
const Game = (() => {
  // walk/attack/pain/dead are frame indices in the enemy sheet row.
  const ENEMIES = {
    skeleton: { hp: 40, speed: 1.7, ppu: 90, radius: 0.3, melee: { dmg: 8, range: 0.9 }, walk: [5, 6, 13, 11], attack: [3, 8], pain: 15, dead: 16, drop: ['bolts', 0.35] },
    orc: { hp: 80, speed: 1.9, ppu: 84, radius: 0.32, melee: { dmg: 15, range: 0.95 }, walk: [5, 6, 2, 6], attack: [4, 8], pain: 15, dead: 16, drop: ['health', 0.3] },
    wizard: { hp: 45, speed: 1.4, ppu: 88, radius: 0.3, ranged: { kind: 'orb_blue', dmg: 12, speed: 7, cd: 2.2 }, walk: [5, 6, 2, 6], attack: [4, 8], pain: 15, dead: 16, drop: ['mana', 0.55] },
    demon: { hp: 120, speed: 2.0, ppu: 82, radius: 0.35, ranged: { kind: 'fire', dmg: 18, speed: 8, cd: 2.0, splash: 1.4 }, melee: { dmg: 20, range: 1.0 }, walk: [5, 6, 2, 6], attack: [4, 8], pain: 15, dead: 16, drop: ['mana', 0.5] },
    zombie: { hp: 60, speed: 1.0, ppu: 88, radius: 0.3, melee: { dmg: 12, range: 0.9 }, walk: [5, 6, 9, 6], attack: [7, 8], pain: 15, dead: 16, drop: ['health', 0.15] },
    spider: { hp: 25, speed: 3.2, ppu: 112, radius: 0.32, melee: { dmg: 6, range: 0.85 }, walk: [0, 1, 2, 3], attack: [4, 8], pain: 15, dead: 16 },
    eye: { hp: 35, speed: 1.6, ppu: 118, radius: 0.28, fly: 0.65, ranged: { kind: 'orb_red', dmg: 9, speed: 9, cd: 1.6 }, walk: [0, 1, 2, 3], attack: [14, 1], pain: 15, dead: 16 },
    slime: { hp: 55, speed: 0.9, ppu: 92, radius: 0.3, melee: { dmg: 10, range: 0.85 }, walk: [0, 1, 2, 3], attack: [4, 10], pain: 15, dead: 16 },
    ghost: { hp: 45, speed: 1.9, ppu: 90, radius: 0.28, fly: 0.12, alpha: 0.72, melee: { dmg: 10, range: 0.9 }, walk: [5, 6, 13, 6], attack: [4, 8], pain: 15, dead: 16 },
    dragon: { hp: 1100, speed: 1.3, ppu: 48, radius: 0.9, boss: true, ranged: { kind: 'fire', dmg: 22, speed: 9, cd: 1.1, splash: 1.8, spread: 3 }, melee: { dmg: 30, range: 1.6 }, walk: [0, 1, 2, 1], attack: [4, 7], pain: 6, dead: 8 },
  };
  const BLOOD = { skeleton: [0.9, 0.88, 0.8], slime: [0.4, 0.9, 0.2], ghost: [0.6, 0.8, 1.0], eye: [0.75, 0.05, 0.05], dragon: [0.6, 0.05, 0.02] };
  const WEAPONS = [
    { id: 'dagger', name: 'Dagger', rate: 0.38, dmg: [18, 30], range: 1.4 },
    { id: 'staff', name: 'Frost Staff', rate: 0.26, mana: 2, dmg: [11, 16], speed: 16, kind: 'ice' },
    { id: 'xbow', name: 'Crossbow', rate: 0.75, bolts: 1, dmg: [42, 58], speed: 30, kind: 'arrow' },
    { id: 'fire', name: 'Fireball', rate: 0.95, mana: 8, dmg: [45, 60], speed: 11, kind: 'fire', splash: 2.2 },
  ];
  const DIFFICULTY = [
    { name: 'SQUIRE', dmg: 0.55, hp: 0.8 },
    { name: 'KNIGHT', dmg: 1.0, hp: 1.0 },
    { name: 'PALADIN', dmg: 1.5, hp: 1.25 },
  ];
  const ITEM_SPRITES = {
    health: ['potion_red', 230], mana: ['potion_blue', 230], bolts: ['arrow', 190], key: ['key', 105],
    crossbow: ['crossbow_pickup', 340], tome: ['tome', 90],
  };
  const PROJ = {
    ice: { frame: 'orb_blue', size: 0.22, light: [0.4, 0.7, 1.0], li: 0.9 },
    arrow: { frame: 'arrow', size: 0.45, light: null },
    fire: { frames: ['fire1', 'fire2', 'fire3'], size: 0.4, light: [1.0, 0.55, 0.15], li: 1.4 },
    orb_red: { frame: 'orb_red', size: 0.24, light: [1.0, 0.25, 0.15], li: 0.8 },
    orb_blue: { frame: 'orb_purple', size: 0.26, light: [0.65, 0.4, 1.0], li: 0.9 },
  };
  const EYE = 0.62, PLAYER_H = 0.9, GRAVITY = 14;

  let A, G = null;
  const events = { message() {}, levelComplete() {}, death() {}, victory() {} };

  function init(assets) { A = assets; }
  const rand = (a, b) => a + Math.random() * (b - a);
  const frame = (name) => A.atlas.frames[name];

  function freshPlayer() {
    return { hp: 100, mana: 60, bolts: 0, owned: { dagger: true, staff: true, xbow: false, fire: false }, weapon: 1 };
  }

  function newGame(diff) {
    G = { diff: DIFFICULTY[diff], diffIndex: diff, inv: freshPlayer(), levelIndex: 0, total: { kills: 0, time: 0 } };
    startLevel(0);
  }

  function startLevel(index) {
    const level = LEVELS[index];
    const world = World.create(level, A.textures);
    Renderer.setLevel(world);
    const inv = G.inv;
    G.saved = JSON.parse(JSON.stringify(inv));
    const p = {
      x: world.start.x, z: world.start.z, y: 0, vy: 0, vx: 0, vz: 0, r: 0.24, eyeY: EYE,
      yaw: (level.start || 0) * Math.PI / 180, pitch: 0, onGround: true, bob: 0, moving: 0,
      key: false, cooldown: 0, anim: 9, switchT: 0, switchTo: -1, lastHurt: 0,
      swayX: 0, swayY: 0, kick: 0, land: 0,
    };
    p.y = World.floorAt(world, p.x, p.z, 0.1);
    Object.assign(G, {
      level, levelIndex: index, world, p, time: 0,
      enemies: world.spawns.map((s) => makeEnemy(s.type, s.x, s.z, world)),
      items: world.items.map((i) => ({ ...i, taken: false, counted: true })),
      decor: world.decor,
      projs: [], parts: [], effects: [], muzzle: 0,
      flash: { hurt: 0, pickup: 0, lava: 0 }, shake: 0,
      stats: { kills: 0, totalKills: world.spawns.length, items: 0, totalItems: world.items.length, secrets: 0, totalSecrets: world.pushwalls.length },
      flowCell: -1, flowT: 0, seenT: 0, ended: false, victoryT: -1, boss: null, lastFireSnd: -1, lastFireHit: -1,
      decals: [], motes: [], frost: 0, torchHits: {}, smokers: [], ripples: [], bubbles: [], drips: [],
    });
    G.boss = G.enemies.find((e) => e.def.boss) || null;
    G.lavaCells = [];
    world.cells.forEach((c, i) => { if (c.kind === 'lava') G.lavaCells.push({ x: i % world.W + 0.5, z: Math.floor(i / world.W) + 0.5 }); });
    G.liquid = G.lavaCells.length > 0 || world.waters.length > 0;
    // Wall lights strong enough to cast long moving shadows (torches, crystals, windows).
    G.castLights = world.lights.filter((L) => L.r >= 3.5 && L.i >= 0.6);
    G.sootTorches = world.torches.slice();
    // Water under a roof drips from the ceiling.
    G.dripCells = [];
    world.cells.forEach((c, i) => { if (c.kind === 'water' && !c.sky) G.dripCells.push({ x: i % world.W + 0.5, z: Math.floor(i / world.W) + 0.5, f: c.f, top: c.c }); });
    // Low mist drifting over water (and waterfall pools) and lava.
    G.mists = [
      ...world.waters.map((w) => ({ x: w.x, z: w.z, lava: false })),
      ...G.lavaCells.map((c) => ({ x: c.x, z: c.z, lava: true })),
    ].map((m) => ({ ...m, f: World.floorAt(world, m.x, m.z, 0.05), ph: Math.random() * 100 }));
    World.computeFlow(world, p.x, p.z);
    markSeen();
  }

  function restartLevel() {
    G.inv = JSON.parse(JSON.stringify(G.saved));
    G.inv.hp = Math.max(G.inv.hp, 100);
    startLevel(G.levelIndex);
  }

  function nextLevel() {
    if (G.levelIndex + 1 < LEVELS.length) { startLevel(G.levelIndex + 1); return true; }
    return false;
  }

  function makeEnemy(type, x, z, world) {
    const def = ENEMIES[type], f0 = frame(`${type}_${def.walk[0]}`);
    const e = {
      type, def, x, z, y: 0, hp: def.hp * G.diff.hp, state: 'idle', t: 0, anim: Math.random(), cool: rand(0.5, 1.5),
      awake: false, see: false, losT: Math.random() * 0.2, hit: 0, dead: false, fired: false, flip: false,
      height: f0.h / def.ppu, vx: 0, vz: 0, mode: '',
    };
    e.y = World.floorAt(world, x, z, 0.1) + (def.fly || 0);
    return e;
  }

  // ---------------- Player ----------------
  function updatePlayer(dt, input) {
    const p = G.p, w = G.world, inv = G.inv;
    p.yaw += input.turn * dt * 2.6 + input.mouseX;
    p.pitch = Math.max(-1.0, Math.min(1.0, p.pitch - input.mouseY));
    // Weapon sway lags behind turning; recoil and landing dips relax back.
    const idt = 1 / Math.max(dt, 1e-3);
    const turnRate = (input.turn * dt * 2.6 + input.mouseX) * idt, lookRate = -input.mouseY * idt;
    const ks = Math.min(1, dt * 9);
    p.swayX += (Math.max(-1, Math.min(1, -turnRate * 0.14)) - p.swayX) * ks;
    p.swayY += (Math.max(-1, Math.min(1, lookRate * 0.14)) - p.swayY) * ks;
    p.kick *= Math.exp(-dt * 9);
    p.land *= Math.exp(-dt * 7);

    const cell = w.at(Math.floor(p.x), Math.floor(p.z));
    const inWater = cell && cell.kind === 'water' && p.y < -0.1;
    const speed = (input.run ? 5.0 : 3.2) * (inWater ? 0.6 : 1);
    const fx = Math.cos(p.yaw), fz = Math.sin(p.yaw);
    let mx = fx * input.fwd - fz * input.strafe, mz = fz * input.fwd + fx * input.strafe;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const k = 1 - Math.exp(-dt * (p.onGround ? 14 : 3));
    p.vx += (mx * speed - p.vx) * k;
    p.vz += (mz * speed - p.vz) * k;

    const feet = p.y;
    const nx = p.x + p.vx * dt;
    if (!World.blocked(w, nx, p.z, p.r, feet, PLAYER_H, false)) p.x = nx; else p.vx = 0;
    const nz = p.z + p.vz * dt;
    if (!World.blocked(w, p.x, nz, p.r, feet, PLAYER_H, false)) p.z = nz; else p.vz = 0;
    // Push out of pillars and monsters.
    for (const d of G.decor) pushOut(p, d.x, d.z, p.r + d.r);
    for (const e of G.enemies) if (!e.dead && Math.abs(e.y - p.y) < 1.2) pushOut(p, e.x, e.z, p.r + e.def.radius * 0.8);

    // Vertical motion.
    const floor = World.floorAt(w, p.x, p.z, p.r * 0.7);
    if (input.jump && p.onGround) { p.vy = 4.6; p.onGround = false; Sound.play('jump', { rate: rand(0.95, 1.05) }); }
    if (p.y > floor + 0.001 || p.vy > 0) {
      p.vy -= GRAVITY * dt;
      p.y += p.vy * dt;
      if (p.y <= floor) {
        if (p.vy < -6) G.shake = Math.max(G.shake, 0.15);
        if (p.vy < -2) Sound.play('step', { vol: 1.4, rate: 0.85 });
        p.land = Math.max(p.land, Math.min(1, -p.vy / 7));
        p.y = floor; p.vy = 0; p.onGround = true;
      }
      else p.onGround = false;
    } else { p.y = floor; p.vy = 0; p.onGround = true; }
    const c2 = w.at(Math.floor(p.x), Math.floor(p.z));
    if (c2 && !c2.sky && p.y + PLAYER_H > c2.c) { p.y = Math.min(p.y, c2.c - PLAYER_H); p.vy = Math.min(p.vy, 0); }

    // Smooth step-ups and head bob.
    const speedNow = Math.hypot(p.vx, p.vz);
    p.moving = p.onGround ? Math.min(1, speedNow / 3.2) : 0;
    const prevStride = Math.floor(p.bob / Math.PI);
    p.bob += dt * speedNow * 2.4;
    // One footstep per stride (half a weapon-bob cycle), alternating left/right.
    if (p.onGround && p.moving > 0.3 && Math.floor(p.bob / Math.PI) !== prevStride) {
      const stride = Math.floor(p.bob / Math.PI);
      Sound.play('step', { pan: stride % 2 ? 0.25 : -0.25, rate: rand(0.9, 1.1) * (inWater ? 0.8 : 1), vol: (input.run ? 1.15 : 1) * rand(0.85, 1) });
      if (inWater) ripple(p.x, p.z, 1);
    }
    p.eyeY += (p.y + EYE - p.eyeY) * Math.min(1, dt * 18);
    if (Math.abs(p.y + EYE - p.eyeY) > 0.4) p.eyeY = p.y + EYE;

    // Lava burns.
    if (c2 && c2.kind === 'lava' && p.y < -0.2) {
      damagePlayer(22 * dt * Math.max(0.6, G.diff.dmg), true);
      G.flash.lava = 0.6;
      if (Math.random() < dt * 20) spark(p.x + rand(-0.3, 0.3), p.y, p.z + rand(-0.3, 0.3), [1, 0.5, 0.1]);
    }
    // Trap plates.
    if (c2 && c2.kind === 'plate') {
      const plate = w.plates.find((pl) => pl.x === Math.floor(p.x) && pl.z === Math.floor(p.z));
      if (plate && plate.cool <= 0) triggerPlate(plate);
    }
    for (const pl of w.plates) pl.cool -= dt;

    // Pickups.
    for (const it of G.items) {
      if (it.taken || Math.hypot(it.x - p.x, it.z - p.z) > 0.6) continue;
      if (pickup(it.type)) {
        it.taken = true;
        if (it.counted) G.stats.items++;
        G.flash.pickup = 0.35;
      }
    }

    // Mana slowly regenerates.
    if (inv.mana < 100) inv.mana = Math.min(100, inv.mana + dt * 1.2);

    // Weapons.
    p.cooldown -= dt;
    p.anim += dt;
    if (p.switchT > 0) {
      p.switchT -= dt;
      if (p.switchT <= 0.18 && p.switchTo >= 0) { inv.weapon = p.switchTo; p.switchTo = -1; }
    }
    if (input.weapon >= 0) selectWeapon(input.weapon);
    if (input.wheel) cycleWeapon(input.wheel);
    if (input.fire && p.cooldown <= 0 && p.switchT <= 0) fire();
    if (input.use) use();
  }

  function pushOut(p, x, z, minD) {
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
    if (d < minD && d > 1e-4) {
      const nx = x + dx / d * minD, nz = z + dz / d * minD;
      if (!World.blocked(G.world, nx, p.z, p.r, p.y, PLAYER_H, false)) p.x = nx;
      if (!World.blocked(G.world, p.x, nz, p.r, p.y, PLAYER_H, false)) p.z = nz;
    }
  }

  function pickup(type) {
    const inv = G.inv;
    switch (type) {
      case 'health': if (inv.hp >= 100) return false; inv.hp = Math.min(100, inv.hp + 25); Sound.play('heal'); events.message('Healing potion +25'); return true;
      case 'mana': if (inv.mana >= 100) return false; inv.mana = Math.min(100, inv.mana + 30); Sound.play('potion'); events.message('Mana potion +30'); return true;
      case 'bolts': if (inv.bolts >= 60) return false; inv.bolts = Math.min(60, inv.bolts + 8); events.message('Crossbow bolts +8'); return true;
      case 'key': G.p.key = true; Sound.play('key'); events.message('You found the IRON KEY'); return true;
      case 'crossbow':
        inv.owned.xbow = true; inv.bolts = Math.min(60, inv.bolts + 12);
        events.message('CROSSBOW! Press 3'); selectWeapon(2); return true;
      case 'tome':
        inv.owned.fire = true; inv.mana = Math.min(100, inv.mana + 30);
        events.message('Tome of FIREBALL! Press 4'); selectWeapon(3); return true;
    }
    return false;
  }

  function selectWeapon(i) {
    const inv = G.inv, w = WEAPONS[i];
    if (!w || !inv.owned[w.id] || (i === inv.weapon && p().switchTo < 0)) return;
    p().switchTo = i; p().switchT = 0.36;
  }
  const p = () => G.p;
  function cycleWeapon(dir) {
    const inv = G.inv;
    let i = p().switchTo >= 0 ? p().switchTo : inv.weapon;
    for (let k = 0; k < 4; k++) {
      i = (i + dir + 4) % 4;
      if (inv.owned[WEAPONS[i].id]) { selectWeapon(i); return; }
    }
  }

  function aimDir() {
    const P = G.p, cp = Math.cos(P.pitch);
    let dir = [Math.cos(P.yaw) * cp, Math.sin(P.pitch), Math.sin(P.yaw) * cp];
    // Vertical auto-aim towards a monster close to the crosshair.
    let best = null, bestA = 0.1;
    const eyeY = P.eyeY;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
      if (d > 20) continue;
      const ang = Math.abs(Math.atan2(Math.sin(Math.atan2(dz, dx) - P.yaw), Math.cos(Math.atan2(dz, dx) - P.yaw)));
      if (ang < Math.max(bestA, Math.atan2(e.def.radius, d)) && World.los(G.world, P.x, P.z, e.x, e.z)) { best = e; bestA = ang; }
    }
    if (best && Math.abs(P.pitch) < 0.35) {
      const d = Math.hypot(best.x - P.x, best.z - P.z);
      const vy = (best.y + best.height * 0.5 - eyeY) / d;
      const n = Math.hypot(1, vy);
      dir = [Math.cos(P.yaw) / n, vy / n, Math.sin(P.yaw) / n];
    }
    return dir;
  }

  function fire() {
    const P = G.p, inv = G.inv, wp = WEAPONS[inv.weapon];
    if (wp.mana && inv.mana < wp.mana) { events.message('Not enough mana'); P.cooldown = 0.4; return; }
    if (wp.bolts && inv.bolts < wp.bolts) { events.message('No bolts left'); P.cooldown = 0.4; return; }
    if (wp.mana) inv.mana -= wp.mana;
    if (wp.bolts) inv.bolts -= wp.bolts;
    P.cooldown = wp.rate;
    P.anim = 0;
    P.kick = { dagger: 0.35, staff: 0.3, xbow: 1, fire: 0.8 }[wp.id];
    if (wp.id === 'dagger') {
      let best = null, bestD = 1e9;
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz);
        if (d > wp.range + e.def.radius) continue;
        const dot = (dx * Math.cos(P.yaw) + dz * Math.sin(P.yaw)) / Math.max(d, 1e-3);
        if (dot > 0.75 && d < bestD) { best = e; bestD = d; }
      }
      if (best) hurtEnemy(best, rand(...wp.dmg), best.x, P.eyeY - 0.2, best.z, 'blade');
      return;
    }
    const dir = aimDir();
    const rx = -Math.sin(P.yaw), rz = Math.cos(P.yaw);
    const side = wp.id === 'staff' ? 0.12 : 0;
    const ox = P.x + dir[0] * 0.25 + rx * side, oz = P.z + dir[2] * 0.25 + rz * side, oy = P.eyeY - 0.1;
    spawnProj('p', wp.kind, ox, oy, oz, dir, wp.speed, rand(...wp.dmg), wp.splash || 0);
    if (wp.id === 'xbow') Sound.play('xbow', { rate: rand(0.95, 1.05) });
    if (wp.id === 'staff') {
      Sound.play('ice', { rate: rand(0.94, 1.06), pan: 0.15 });
      G.frost = Math.min(1, G.frost + 0.045);
    }
    if (wp.id !== 'xbow') G.muzzle = 0.12;
    wakeByNoise(P.x, P.z, wp.id === 'fire' ? 12 : 9);
  }

  function use() {
    const P = G.p, w = G.world;
    const fx = Math.cos(P.yaw), fz = Math.sin(P.yaw);
    for (let d = 0.3; d <= 1.6; d += 0.1) {
      const x = P.x + fx * d, z = P.z + fz * d;
      const pw = World.pushwallAt(w, x, z);
      if (pw) { pushWall(pw, x - P.x, z - P.z); return; }
      const c = w.at(Math.floor(x), Math.floor(z));
      if (!c) return;
      if (c.door) { useDoor(c.door, true); return; }
      if (c.solid) {
        if (c.ch === 'E') { completeLevel(); }
        return;
      }
    }
  }

  function useDoor(door, byPlayer) {
    if (door.locked) {
      if (!byPlayer) return;
      if (!G.p.key) {
        Sound.play('locked');
        events.message(door.gate ? 'The portcullis is locked. Find the key.' : 'This door is locked. Find the key.');
        return;
      }
      door.locked = false;
      events.message('Unlocked with the iron key');
    }
    if (door.state === 'closed' || door.state === 'closing') {
      if (door.state === 'closed') Sound.play('door', { x: door.x + 0.5, z: door.z + 0.5, rate: door.gate ? 0.8 : 1 });
      door.state = 'opening';
    }
    else if (byPlayer && door.state === 'open' && !door.gate) { door.timer = 0; }
  }

  function pushWall(pw, dx, dz) {
    if (pw.moving || pw.done) return;
    if (Math.abs(dx) > Math.abs(dz)) { pw.dx = Math.sign(dx); pw.dz = 0; } else { pw.dx = 0; pw.dz = Math.sign(dz); }
    const next = G.world.at(pw.x + pw.dx, pw.z + pw.dz);
    if (!next || next.solid || next.door) { pw.dx = pw.dz = 0; return; }
    pw.moving = true;
    G.stats.secrets++;
    events.message('You found a SECRET!');
  }

  function triggerPlate(plate) {
    plate.cool = 8;
    events.message('A trap is sprung!');
    G.shake = 0.25;
    const P = G.p;
    for (const t of G.world.turrets) {
      if (Math.hypot(t.x - P.x, t.z - P.z) < 14 && World.los(G.world, t.x, t.z, P.x, P.z)) { t.volley = 3; t.volleyT = 0.2; }
    }
    wakeByNoise(plate.x + 0.5, plate.z + 0.5, 14);
  }

  function completeLevel() {
    if (G.ended) return;
    G.ended = true;
    G.total.kills += G.stats.kills;
    G.total.time += G.time;
    events.levelComplete({ ...G.stats, time: G.time, name: G.level.name, last: G.levelIndex + 1 >= LEVELS.length });
  }

  function damagePlayer(amount, silent) {
    const inv = G.inv;
    if (inv.hp <= 0 || G.ended) return;
    inv.hp -= amount * (silent ? 1 : G.diff.dmg);
    G.flash.hurt = Math.min(0.8, G.flash.hurt + (silent ? 0.02 : 0.35));
    if (!silent) G.shake = Math.max(G.shake, 0.18);
    if (inv.hp <= 0) {
      inv.hp = 0;
      G.ended = true;
      Sound.play('death');
      events.death();
    }
  }

  // ---------------- Enemies ----------------
  function wake(e) {
    if (e.dead || e.awake) return;
    e.awake = true;
    e.state = 'chase';
  }
  function wakeByNoise(x, z, radius) {
    for (const e of G.enemies) {
      if (e.awake || e.dead) continue;
      if (Math.hypot(e.x - x, e.z - z) > radius) continue;
      const i = Math.floor(e.z) * G.world.W + Math.floor(e.x);
      if (G.world.flow[i] >= 0 && G.world.flow[i] < radius * 1.6) wake(e);
      else if (World.los(G.world, e.x, e.z, x, z)) wake(e);
    }
  }

  function hurtEnemy(e, dmg, hx, hy, hz, kind) {
    if (e.dead) return;
    e.hp -= dmg;
    e.hit = 0.12;
    const col = BLOOD[e.type] || [0.65, 0.04, 0.04];
    for (let i = 0; i < 8; i++) particle(hx, hy, hz, rand(-1.5, 1.5), rand(0, 2.5), rand(-1.5, 1.5), col, 0.06, 0.6, false);
    if (e.type !== 'ghost' && Math.random() < 0.5) floorDecal('splat', e.x + rand(-0.3, 0.3), e.z + rand(-0.3, 0.3), rand(0.2, 0.38), col);
    if (!e.awake) wake(e);
    if (e.hp <= 0) { killEnemy(e, kind); return; }
    if (e.state !== 'attack' && Math.random() < (e.def.boss ? 0.08 : 0.45)) { e.state = 'pain'; e.t = 0.25; }
  }

  function killEnemy(e, kind) {
    e.dead = true;
    e.state = 'dead';
    e.deadAt = G.time;
    G.stats.kills++;
    // Ice and fire kills get their own deaths (not for the boss or ghosts).
    e.deathKind = (kind === 'ice' || kind === 'fire') && !e.def.boss && e.type !== 'ghost' ? kind : null;
    e.deathFrame = e.sprite;
    e.deathY = e.y;
    const col = BLOOD[e.type] || [0.65, 0.04, 0.04];
    if (!e.deathKind) for (let i = 0; i < 20; i++) particle(e.x, e.y + e.height * 0.5, e.z, rand(-2, 2), rand(0.5, 3.5), rand(-2, 2), col, 0.07, 0.9, false);
    e.y = e.def.fly ? World.floorAt(G.world, e.x, e.z, 0.1) : e.y;
    if (e.type !== 'ghost' && !e.deathKind) floorDecal('splat', e.x, e.z, e.def.boss ? 1.6 : rand(0.55, 0.75), col);
    if (e.type === 'zombie') Sound.play('zombieDeath', { x: e.x, z: e.z, rate: rand(0.92, 1.05) });
    if (e.type === 'slime') {
      Sound.play('slime', { x: e.x, z: e.z, rate: rand(0.92, 1.08) });
      for (let i = 0; i < 25; i++) particle(e.x, e.y + 0.25, e.z, rand(-3, 3), rand(1, 4), rand(-3, 3), col, 0.09, 1.1, false);
    }
    const drop = e.def.drop;
    if (drop && Math.random() < drop[1]) G.items.push({ type: drop[0], x: e.x, z: e.z, taken: false, counted: false });
    if (e.def.boss) {
      G.victoryT = 3.5;
      for (let i = 0; i < 6; i++) setTimeout(() => explosion(e.x + rand(-1, 1), e.y + rand(0.3, 2), e.z + rand(-1, 1), 0), i * 250);
      events.message('The dragon is slain!');
    }
  }

  function nextCellTarget(e) {
    const w = G.world, field = e.def.fly ? w.flowFly : w.flow;
    const cx = Math.floor(e.x), cz = Math.floor(e.z);
    const here = field[cz * w.W + cx];
    let best = null, bestV = here >= 0 ? here : 1e9;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const v = field[(cz + dz) * w.W + cx + dx];
      if (v >= 0 && v < bestV) { bestV = v; best = [cx + dx + 0.5, cz + dz + 0.5]; }
    }
    return best;
  }

  function startAttack(e, mode) {
    e.state = 'attack'; e.mode = mode; e.t = 0; e.fired = false;
    if (e.type === 'spider' && mode === 'melee') Sound.play('spiderBite', { x: e.x, z: e.z, rate: rand(0.9, 1.1) });
  }

  function enemyAttack(e) {
    const P = G.p, d = e.def;
    const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz);
    if (e.mode === 'melee') {
      if (dist < d.melee.range + P.r + d.radius + 0.25 && Math.abs(P.y - (e.y - (d.fly || 0))) < 1.2) damagePlayer(d.melee.dmg);
      return;
    }
    const r = d.ranged, oy = e.y + e.height * 0.6;
    const n = r.spread || 1;
    for (let i = 0; i < n; i++) {
      const ang = Math.atan2(dz, dx) + (i - (n - 1) / 2) * 0.16 + rand(-0.04, 0.04);
      const vy = (P.eyeY - 0.15 - oy) / Math.max(dist, 0.5);
      const len = Math.hypot(1, vy);
      spawnProj('e', r.kind, e.x + Math.cos(ang) * (d.radius + 0.1), oy, e.z + Math.sin(ang) * (d.radius + 0.1),
        [Math.cos(ang) / len, vy / len, Math.sin(ang) / len], r.speed, r.dmg, r.splash || 0);
    }
  }

  function updateEnemy(e, dt) {
    if (e.dead) return;
    const d = e.def, P = G.p, w = G.world;
    e.anim += dt;
    e.hit = Math.max(0, e.hit - dt);
    e.cool -= dt;
    const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz);
    e.losT -= dt;
    if (e.losT <= 0) {
      e.losT = 0.15 + Math.random() * 0.1;
      e.see = dist < 20 && World.los(w, e.x, e.z, P.x, P.z);
    }
    if (d.fly) e.y = World.floorAt(w, e.x, e.z, 0.1) + d.fly + Math.sin(e.anim * 2.5) * 0.06;
    if (!e.awake) {
      if (e.see && dist < (d.boss ? 16 : 11)) wake(e);
      return;
    }
    if (e.state === 'pain') { e.t -= dt; if (e.t <= 0) e.state = 'chase'; return; }
    if (e.state === 'attack') {
      e.t += dt;
      const hitT = e.mode === 'melee' ? 0.32 : 0.38;
      if (!e.fired && e.t >= hitT) { e.fired = true; enemyAttack(e); }
      if (e.t >= hitT + 0.35) {
        e.state = 'chase';
        e.cool = e.mode === 'melee' ? rand(0.4, 0.8) : d.ranged.cd * rand(0.8, 1.3);
      }
      return;
    }
    // Chase.
    if (d.melee && e.see && dist < d.melee.range + P.r + d.radius && e.cool <= 0) { startAttack(e, 'melee'); return; }
    if (d.ranged && e.see && dist < 16 && dist > 1.4 && e.cool <= 0 && Math.random() < dt * (d.boss ? 3 : 1.4)) { startAttack(e, 'ranged'); return; }

    let tx, tz;
    if (e.see && dist < 4.5) { tx = P.x; tz = P.z; }
    else {
      const t = nextCellTarget(e);
      if (t) { tx = t[0]; tz = t[1]; } else { tx = P.x; tz = P.z; }
    }
    // Ranged-only monsters keep their distance.
    if (d.ranged && !d.melee && e.see && dist < 3.5) { tx = e.x - dx; tz = e.z - dz; }
    const mdx = tx - e.x, mdz = tz - e.z, ml = Math.hypot(mdx, mdz);
    if (ml < 0.05) return;
    const sp = d.speed * dt;
    const vx = mdx / ml * sp, vz = mdz / ml * sp;
    const feet = d.fly ? e.y - d.fly : e.y;
    const hgt = Math.min(e.height, 1.3);
    const walker = !d.fly;
    const ox = e.x, oz = e.z;
    let moved = false;
    if (!World.blocked(w, e.x + vx, e.z, d.radius, feet, hgt, walker)) { e.x += vx; moved = true; }
    else tryOpen(e.x + Math.sign(vx) * (d.radius + 0.2), e.z);
    if (!World.blocked(w, e.x, e.z + vz, d.radius, feet, hgt, walker)) { e.z += vz; moved = true; }
    else tryOpen(e.x, e.z + Math.sign(vz) * (d.radius + 0.2));
    e.vx = vx / dt; e.vz = vz / dt;
    // Badly wounded enemies leave drops of blood behind them.
    if (e.type !== 'ghost' && e.hp < e.def.hp * G.diff.hp * 0.6) {
      e.trail = (e.trail || 0) + Math.hypot(vx, vz);
      if (e.trail > 0.45) {
        e.trail = 0;
        floorDecal('splat', e.x + rand(-0.15, 0.15), e.z + rand(-0.15, 0.15), rand(0.07, 0.15), BLOOD[e.type] || [0.65, 0.04, 0.04]);
      }
    }
    if (!moved) e.anim -= dt * 0.5;
    if (!d.fly) e.y = World.floorAt(w, e.x, e.z, 0.1);
    // Skeletons clatter: one bony step every stride actually walked.
    if (e.type === 'skeleton') {
      e.stride = (e.stride || 0) + Math.hypot(e.x - ox, e.z - oz);
      if (e.stride > 0.75) {
        e.stride = 0;
        Sound.play('boneStep', { x: e.x, z: e.z, rate: rand(0.88, 1.12), vol: rand(0.8, 1) });
      }
    }
    // Spiders skitter: a random slice of the scurrying recording every couple of units walked.
    if (e.type === 'spider') {
      e.stride = (e.stride || 0) + Math.hypot(e.x - ox, e.z - oz);
      if (e.stride > 2) {
        e.stride = 0;
        Sound.play('spiderSteps', { x: e.x, z: e.z, offset: rand(0.23, 1.9), rate: rand(0.9, 1.15) });
      }
    }
  }
  function tryOpen(x, z) {
    const c = G.world.at(Math.floor(x), Math.floor(z));
    if (c && c.door && !c.door.locked) useDoor(c.door, false);
  }

  // Living spiders nearby growl now and then, from the closest one's position.
  function spiderGrowls(dt) {
    G.growlT = (G.growlT ?? rand(0.5, 1.5)) - dt;
    if (G.growlT > 0) return;
    const P = G.p;
    let best = null, bestD = 10;
    for (const e of G.enemies) {
      if (e.dead || e.type !== 'spider') continue;
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (!best) { G.growlT = 0.5; return; }
    Sound.play('growl', { x: best.x, z: best.z, rate: rand(0.85, 1.15) });
    G.growlT = best.awake ? rand(1.8, 3.2) : rand(3, 5.5);
  }

  // Groans from the nearest zombie in earshot; more often once it has noticed the player.
  function zombieGroans(dt) {
    G.groanT = (G.groanT ?? rand(1, 3)) - dt;
    if (G.groanT > 0) return;
    const P = G.p;
    let best = null, bestD = 11;
    for (const e of G.enemies) {
      if (e.dead || e.type !== 'zombie') continue;
      const d = Math.hypot(e.x - P.x, e.z - P.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (!best) { G.groanT = 0.5; return; }
    Sound.play('zombie', { x: best.x, z: best.z, rate: rand(0.85, 1.1) });
    G.groanT = best.awake ? rand(2.8, 4.5) : rand(5, 8);
  }

  // Wet scuttling while an awake slime is closing in on the player.
  function slimeScuttle(dt) {
    G.scuttleT = (G.scuttleT ?? 0) - dt;
    if (G.scuttleT > 0) return;
    const P = G.p;
    let best = null, bestD = 9;
    for (const e of G.enemies) {
      if (e.dead || e.type !== 'slime' || !e.awake) continue;
      const dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz);
      const approaching = (e.vx * dx + e.vz * dz) / (d || 1) > 0.15;
      if (approaching && d < bestD) { best = e; bestD = d; }
    }
    if (!best) { G.scuttleT = 0.3; return; }
    Sound.play('scuttle', { x: best.x, z: best.z, rate: rand(0.9, 1.1) });
    G.scuttleT = rand(2.4, 3.2);
  }

  // Looping ambiences (running water, wall torches): each follows its nearest
  // source, muffled and quieter when that source is behind a wall.
  function ambience(name, sources, range) {
    const P = G.p;
    let best = null, bestD = range + 2;
    for (const s of sources) {
      const d = Math.hypot(s.x - P.x, s.z - P.z);
      if (d < bestD) { best = s; bestD = d; }
    }
    if (!best) { Sound.ambient(name, 0); return; }
    const sp = Sound.spatial(best.x, best.z, range);
    const visible = World.los(G.world, P.x, P.z, best.x, best.z);
    Sound.ambient(name, sp.level * (visible ? 1 : 0.55), sp.pan, !visible);
  }

  function separateEnemies() {
    const list = G.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || !a.awake) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = (a.def.radius + b.def.radius) * 0.85;
        if (d < m && d > 1e-4) {
          const push = (m - d) * 0.5, ux = dx / d * push, uz = dz / d * push;
          if (!World.blocked(G.world, a.x - ux, a.z - uz, a.def.radius, a.y - (a.def.fly || 0), 0.9, !a.def.fly)) { a.x -= ux; a.z -= uz; }
          if (!World.blocked(G.world, b.x + ux, b.z + uz, b.def.radius, b.y - (b.def.fly || 0), 0.9, !b.def.fly)) { b.x += ux; b.z += uz; }
        }
      }
    }
  }

  // ---------------- Projectiles & effects ----------------
  function spawnProj(owner, kind, x, y, z, dir, speed, dmg, splash) {
    G.projs.push({ owner, kind, x, y, z, vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed, dmg, splash, life: 4, t: 0 });
    // One whoosh per volley (the dragon spits several fireballs at once).
    if (kind === 'fire' && G.time - (G.lastFireSnd ?? -1) > 0.06) {
      G.lastFireSnd = G.time;
      Sound.play('fireball', { x, z, rate: rand(0.92, 1.08) });
    }
  }
  function particle(x, y, z, vx, vy, vz, col, size, life, emissive) {
    if (G.parts.length > 600) G.parts.shift();
    G.parts.push({ x, y, z, vx, vy, vz, col, size, life, max: life, emissive });
  }
  function spark(x, y, z, col) { particle(x, y, z, rand(-0.6, 0.6), rand(0.5, 2), rand(-0.6, 0.6), col, 0.05, 0.5, true); }

  function explosion(x, y, z, radius, dmg, owner) {
    G.effects.push({ x, y, z, t: 0, dur: 0.45, frames: ['exp1', 'exp2', 'exp3', 'exp4'], size: 1.3, light: [1, 0.55, 0.2], li: 2.2 });
    for (let i = 0; i < 18; i++) spark(x, y, z, [1, rand(0.3, 0.8), 0.1]);
    const P = G.p;
    if (Math.hypot(P.x - x, P.z - z) < 4) G.shake = Math.max(G.shake, 0.25);
    if (!radius) return;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.z - z) - e.def.radius;
      if (d < radius && World.los(G.world, x, z, e.x, e.z)) hurtEnemy(e, dmg * (1 - Math.max(0, d) / radius), e.x, e.y + e.height * 0.5, e.z, 'fire');
    }
    const dp = Math.hypot(P.x - x, P.z - z);
    if (dp < radius && World.los(G.world, x, z, P.x, P.z)) damagePlayer(dmg * (1 - dp / radius) * (owner === 'p' ? 0.35 : 0.6));
  }

  function projBlocked(x, y, z) {
    const w = G.world, c = w.at(Math.floor(x), Math.floor(z));
    if (!c || c.solid) return true;
    if (c.door && c.door.open < 0.7) return true;
    if (y < c.f || (!c.sky && y > c.c)) return true;
    // Columns: round shaft, wider plinth near the floor.
    for (const d of G.decor) {
      if (y > c.f + d.h) continue;
      const r = d.type === 'pillar' ? (y < c.f + 0.3 ? 0.36 : 0.26) : d.r * 0.9;
      if (Math.hypot(x - d.x, z - d.z) < r) return true;
    }
    return !!World.pushwallAt(w, x, z);
  }

  function updateProjectiles(dt) {
    const P = G.p;
    for (const pr of G.projs) {
      pr.t += dt; pr.life -= dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(pr.vx, pr.vy, pr.vz) * dt / 0.08));
      const sdt = dt / steps;
      let hit = false;
      for (let s = 0; s < steps && !hit; s++) {
        const px = pr.x, py = pr.y, pz = pr.z;
        pr.x += pr.vx * sdt; pr.y += pr.vy * sdt; pr.z += pr.vz * sdt;
        if (pr.kind === 'arrow') pr.vy -= 1.5 * sdt;
        if (projBlocked(pr.x, pr.y, pr.z)) { hit = true; impact(pr, null, surfaceAt(px, py, pz, pr.x, pr.y, pr.z)); break; }
        if (pr.owner === 'p') {
          for (const e of G.enemies) {
            if (e.dead) continue;
            if (Math.hypot(e.x - pr.x, e.z - pr.z) < e.def.radius + 0.12 && pr.y > e.y - 0.1 && pr.y < e.y + e.height + 0.1) {
              hit = true; impact(pr, e); break;
            }
          }
        } else if (Math.hypot(P.x - pr.x, P.z - pr.z) < P.r + 0.15 && pr.y > P.y - 0.1 && pr.y < P.y + PLAYER_H + 0.1) {
          hit = true; impact(pr, 'player');
        }
      }
      if (hit || pr.life <= 0) pr.dead = true;
      else if (pr.kind !== 'arrow' && Math.random() < dt * 30) {
        const L = PROJ[pr.kind].light;
        if (L) particle(pr.x, pr.y, pr.z, rand(-0.3, 0.3), rand(-0.2, 0.4), rand(-0.3, 0.3), L, 0.04, 0.35, true);
      }
    }
    G.projs = G.projs.filter((p) => !p.dead);
  }

  function impact(pr, target, surf) {
    const col = PROJ[pr.kind].light || [0.8, 0.75, 0.6];
    if (!target && !surf) {
      const wc = G.world.at(Math.floor(pr.x), Math.floor(pr.z));
      if (wc && wc.kind === 'water' && pr.y < wc.f + 0.1) ripple(pr.x, pr.z, 1.4);
    }
    // Back off slightly so effects are not buried in the wall.
    const sp = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    const x = pr.x - pr.vx / sp * 0.12, y = pr.y - pr.vy / sp * 0.12, z = pr.z - pr.vz / sp * 0.12;
    if (target && target !== 'player') {
      hurtEnemy(target, pr.dmg, x, y, z, pr.kind);
      if (pr.kind === 'ice' && pr.owner === 'p') Sound.play('iceShatter', { x, z, rate: rand(0.92, 1.1) });
    }
    if (target === 'player') damagePlayer(pr.dmg);
    if (!target && pr.kind === 'ice') {
      Sound.play('thud', { x, z, rate: rand(0.9, 1.1) });
      douseTorch(x, y, z);
    }
    // Fireball bursting on a wall/floor or on the player (once per volley of the dragon).
    if (pr.kind === 'fire' && (!target || target === 'player') && G.time - G.lastFireHit > 0.08) {
      G.lastFireHit = G.time;
      Sound.play('fireHit', target === 'player' ? { rate: rand(0.95, 1.05) } : { x, z, rate: rand(0.92, 1.08) });
    }
    if (pr.kind === 'fire') {
      if (surf) addDecal('scorch', surf, pr.splash > 1.5 ? 1.2 : 0.85, null);
      else if (y - World.floorAt(G.world, x, z, 0.05) < 0.7) floorDecal('scorch', x, z, 0.7, null);
    }
    if (pr.kind === 'ice' && surf) addDecal('frost', surf, rand(0.42, 0.6), null);
    if (pr.splash) explosion(x, y, z, pr.splash, pr.dmg * 0.6, pr.owner);
    else for (let i = 0; i < 8; i++) spark(x, y, z, col);
    if (!pr.splash && pr.kind !== 'arrow') G.effects.push({ x, y, z, t: 0, dur: 0.15, frames: [PROJ[pr.kind].frame], size: 0.4, light: col, li: 1 });
  }

  // Frozen enemies stand still for a moment then burst into ice shards;
  // burnt ones smoulder, blacken and crumble to a heap of ash.
  const FREEZE_T = 0.6, BURN_T = 1.6, ASH_T = 2.4;
  // These keep their corpse on the floor after the ice/fire effect.
  const KEEP_CORPSE = { skeleton: 1, orc: 1, spider: 1 };
  function updateDeaths(dt) {
    for (const e of G.enemies) {
      if (!e.dead || !e.deathKind || e.deathDone) continue;
      const k = G.time - e.deadAt, mid = e.deathY + e.height * 0.5;
      if (e.deathKind === 'ice') {
        if (k < FREEZE_T) {
          if (Math.random() < dt * 20) particle(e.x + rand(-0.2, 0.2), e.deathY + rand(0, e.height), e.z + rand(-0.2, 0.2), 0, rand(0.1, 0.4), 0, [0.85, 0.95, 1], 0.025, 0.4, true);
          continue;
        }
        for (let i = 0; i < 36; i++) {
          particle(e.x + rand(-0.15, 0.15), mid + rand(-0.3, 0.3), e.z + rand(-0.15, 0.15), rand(-2.5, 2.5), rand(0.5, 3.5), rand(-2.5, 2.5),
            [rand(0.6, 0.85), rand(0.85, 0.95), 1], rand(0.03, 0.08), rand(0.6, 1.2), false);
        }
        Sound.play('iceShatter', { x: e.x, z: e.z, rate: rand(0.85, 0.95), vol: 1.2 });
        floorDecal('frost', e.x, e.z, rand(0.6, 0.8), null);
        e.deathDone = true;
      } else {
        if (k < BURN_T) {
          if (Math.random() < dt * 30) particle(e.x + rand(-0.25, 0.25), e.y + rand(0, 0.3), e.z + rand(-0.25, 0.25), rand(-0.2, 0.2), rand(0.6, 1.6), rand(-0.2, 0.2), [1, rand(0.35, 0.7), 0.1], rand(0.03, 0.06), rand(0.3, 0.6), true);
          if (Math.random() < dt * 6) smoke(e.x, e.y + 0.3, e.z, 0.6, 1.4);
          continue;
        }
        if (KEEP_CORPSE[e.type]) {
          floorDecal('scorch', e.x, e.z, 0.8, null);
          e.deathDone = true;
          continue;
        }
        if (k < ASH_T) continue;
        for (let i = 0; i < 18; i++) particle(e.x + rand(-0.3, 0.3), e.y + 0.1, e.z + rand(-0.3, 0.3), rand(-0.6, 0.6), rand(0.3, 1.2), rand(-0.6, 0.6), [0.3, 0.28, 0.26], 0.04, 0.8, false);
        floorDecal('scorch', e.x, e.z, 0.8, null);
        floorDecal('splat', e.x, e.z, 0.45, [0.2, 0.19, 0.18]);
        e.deathDone = true;
      }
    }
  }

  // ---------------- Decals ----------------
  const DECAL_LIFE = { scorch: 40, splat: 40, frost: 14 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Surface hit when moving from p to (x,y,z): {x,y,z,n} or null for moving or
  // awkward surfaces (doors, push-walls, step sides, liquids, waterfalls).
  function surfaceAt(px, py, pz, x, y, z) {
    const w = G.world, ix = Math.floor(x), iz = Math.floor(z), pix = Math.floor(px), piz = Math.floor(pz);
    const c = w.at(ix, iz), prev = w.at(pix, piz);
    if (!c || !prev || c.door || prev.door || World.pushwallAt(w, x, z)) return null;
    if (pix !== ix || piz !== iz) {
      if (!c.solid || c.ch === 'F') return null;
      const lo = prev.f + 0.25, hi = (prev.sky ? prev.f + 2.5 : prev.c) - 0.25;
      const sideX = pix !== ix && (piz === iz || (w.at(ix, piz) || {}).solid);
      if (sideX) {
        const nx = Math.sign(px - x), wx = nx > 0 ? ix + 1 : ix;
        return { x: wx + nx * 0.012, y: clamp(py, lo, hi), z: pz, n: [nx, 0, 0] };
      }
      const nz = Math.sign(pz - z), wz = nz > 0 ? iz + 1 : iz;
      return { x: px, y: clamp(py, lo, hi), z: wz + nz * 0.012, n: [0, 0, nz] };
    }
    if (y < c.f) return c.kind === 'lava' || c.kind === 'water' ? null : { x: px, y: c.f + 0.012, z: pz, n: [0, 1, 0] };
    if (!c.sky && y > c.c) return { x: px, y: c.c - 0.012, z: pz, n: [0, -1, 0] };
    return null;
  }
  function floorDecal(kind, x, z, size, col) {
    const c = G.world.at(Math.floor(x), Math.floor(z));
    if (!c || c.solid || c.door || c.kind === 'lava' || c.kind === 'water') return;
    addDecal(kind, { x, y: c.f + 0.012, z, n: [0, 1, 0] }, size, col);
  }
  function addDecal(kind, surf, size, col) {
    if (G.decals.length > 180) G.decals.shift();
    // Slight lift per decal so overlapping ones do not z-fight.
    const lift = (G.decals.length % 8) * 0.0015;
    G.decals.push({ kind, x: surf.x + surf.n[0] * lift, y: surf.y + surf.n[1] * lift, z: surf.z + surf.n[2] * lift,
      n: surf.n, size, col, rot: Math.random() * Math.PI * 2, t: 0, v: Math.floor(Math.random() * 3) });
  }

  // ---------------- Dust motes ----------------
  function updateMotes(dt) {
    const P = G.p, w = G.world;
    while (G.motes.length < 90) G.motes.push({ dead: true });
    for (const m of G.motes) {
      if (!m.dead) {
        m.vx += rand(-0.08, 0.08) * dt; m.vy += rand(-0.06, 0.06) * dt; m.vz += rand(-0.08, 0.08) * dt;
        m.x += m.vx * dt; m.y += (m.vy + Math.sin(G.time * 0.7 + m.ph) * 0.02) * dt; m.z += m.vz * dt;
        const c = w.at(Math.floor(m.x), Math.floor(m.z));
        if (!c || c.solid || m.y < c.f + 0.05 || m.y > (c.sky ? c.f + 2.5 : c.c) - 0.05 || Math.hypot(m.x - P.x, m.z - P.z) > 5.5) m.dead = true;
        continue;
      }
      const a = Math.random() * Math.PI * 2, d = rand(0.6, 5);
      const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d, c = w.at(Math.floor(x), Math.floor(z));
      if (!c || c.solid || c.door) continue;
      const top = c.sky ? c.f + 2.5 : c.c;
      Object.assign(m, { dead: false, a: 0, sz: rand(0.8, 1.8), x, z, y: rand(c.f + 0.15, top - 0.1), vx: rand(-0.04, 0.04), vy: rand(-0.02, 0.02), vz: rand(-0.04, 0.04), ph: Math.random() * 9 });
    }
  }

  // Ice hitting a wall torch: steam each time; after a few hits it goes out,
  // its light is removed from the lightmap and it smokes for a while.
  const TORCH_HITS = 3;
  function douseTorch(x, y, z) {
    const w = G.world;
    const t = w.torches.find((t) => Math.hypot(t.x - x, t.z - z) < 0.6);
    if (!t) return;
    const c = w.at(Math.floor(t.x), Math.floor(t.z));
    const ty = (c ? c.f : 0) + 0.95;
    G.torchHits[t.cell] = (G.torchHits[t.cell] || 0) + 1;
    for (let i = 0; i < 8; i++) smoke(t.x, ty, t.z, 0.8, 0.9);
    if (G.torchHits[t.cell] < TORCH_HITS) return;
    const gone = World.extinguish(w, t.cell);
    G.castLights = G.castLights.filter((L) => !gone.includes(L));
    Renderer.setLevel(w);
    for (let i = 0; i < 26; i++) smoke(t.x, ty, t.z, 1.4, 1.6);
    G.smokers.push({ x: t.x, y: ty, z: t.z, t: 6 });
    events.message('The torch goes out');
  }
  function smoke(x, y, z, spread, life) {
    particle(x, y, z, rand(-0.3, 0.3) * spread, rand(0.4, 1.2), rand(-0.3, 0.3) * spread, [0.55, 0.55, 0.58], rand(0.05, 0.09), rand(0.6, 1) * life, false);
    G.parts[G.parts.length - 1].float = true;
  }

  // Embers rising from lit torches; drops falling from crypt ceilings into water.
  function updateAmbientFx(dt) {
    const P = G.p, w = G.world;
    for (const t of w.torches) {
      if (Math.hypot(t.x - P.x, t.z - P.z) > 9 || Math.random() > dt * 1.6) continue;
      particle(t.x + t.dx * 0.05 + rand(-0.04, 0.04), t.f + 1.02, t.z + t.dz * 0.05 + rand(-0.04, 0.04), rand(-0.1, 0.1), rand(0.3, 0.6), rand(-0.1, 0.1),
        [1, rand(0.45, 0.75), 0.15], rand(0.015, 0.03), rand(0.8, 1.6), true);
      G.parts[G.parts.length - 1].rise = true;
    }
    for (const c of G.dripCells) {
      if (Math.hypot(c.x - P.x, c.z - P.z) > 10 || Math.random() > dt * 0.18) continue;
      G.drips.push({ x: c.x + rand(-0.4, 0.4), z: c.z + rand(-0.4, 0.4), y: c.top - 0.02, vy: 0, f: c.f });
    }
    for (const d of G.drips) {
      d.vy -= 9.8 * dt; d.y += d.vy * dt;
      if (d.y > d.f) continue;
      d.done = true;
      ripple(d.x, d.z, 0.6);
      for (let i = 0; i < 3; i++) particle(d.x, d.f + 0.02, d.z, rand(-0.4, 0.4), rand(0.6, 1.2), rand(-0.4, 0.4), [0.7, 0.8, 0.95], 0.015, 0.3, false);
    }
    G.drips = G.drips.filter((d) => !d.done);
  }

  // ---------------- Water, lava and light effects ----------------
  function ripple(x, z, strength) {
    G.ripples.push({ x, z, t: 0, s: strength });
    if (G.ripples.length > 4) G.ripples.shift();
  }
  const rippleData = new Float32Array(16);
  function rippleUniform() {
    rippleData.fill(0);
    G.ripples.forEach((r, i) => rippleData.set([r.x, r.z, r.t, r.s], i * 4));
    return rippleData;
  }
  function updateLiquids(dt) {
    for (const r of G.ripples) r.t += dt;
    G.ripples = G.ripples.filter((r) => r.t < 3);
    const P = G.p;
    // Spray at the foot of waterfalls.
    for (const f of G.world.falls) {
      if (Math.hypot(f.x - P.x, f.z - P.z) > 10 || Math.random() > dt * 12) continue;
      const a = rand(-0.45, 0.45);
      particle(f.x + f.dx * 0.15 - f.dz * a, f.f + 0.05, f.z + f.dz * 0.15 + f.dx * a,
        f.dx * rand(0.2, 0.9), rand(0.8, 1.8), f.dz * rand(0.2, 0.9), [0.75, 0.85, 0.95], rand(0.02, 0.04), rand(0.3, 0.6), false);
    }
    // Lava bubbles swell and burst into sparks.
    if (G.lavaCells.length && Math.random() < dt * 4) {
      const near = G.lavaCells.filter((c) => Math.hypot(c.x - P.x, c.z - P.z) < 10);
      if (near.length) {
        const c = near[Math.floor(Math.random() * near.length)];
        G.bubbles.push({ x: c.x + rand(-0.4, 0.4), z: c.z + rand(-0.4, 0.4), t: 0, dur: rand(0.6, 1.3), size: rand(0.12, 0.28) });
      }
    }
    for (const b of G.bubbles) {
      b.t += dt;
      if (b.t >= b.dur) {
        const y = World.floorAt(G.world, b.x, b.z, 0.01) + 0.02;
        for (let i = 0; i < 7; i++) particle(b.x, y, b.z, rand(-0.8, 0.8), rand(1.2, 2.6), rand(-0.8, 0.8), [1, rand(0.35, 0.7), 0.1], 0.035, rand(0.4, 0.8), true);
      }
    }
    G.bubbles = G.bubbles.filter((b) => b.t < b.dur);
  }

  function updateParticles(dt) {
    updateLiquids(dt);
    for (const s of G.smokers) {
      s.t -= dt;
      if (Math.random() < dt * 10 * Math.min(1, s.t / 3)) smoke(s.x, s.y - 0.1, s.z, 0.4, 1.4);
    }
    G.smokers = G.smokers.filter((s) => s.t > 0);
    for (const q of G.parts) {
      q.life -= dt;
      // Smoke rises and slows down; everything else falls.
      if (q.float) { q.vy += (0.5 - q.vy) * dt * 2; q.vx *= 1 - dt; q.vz *= 1 - dt; }
      else if (q.rise) { q.vy += (0.5 - q.vy) * dt * 1.5; q.vx += rand(-1, 1) * dt; q.vz += rand(-1, 1) * dt; }
      else q.vy -= 6 * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const f = World.floorAt(G.world, q.x, q.z, 0.01);
      if (q.y < f + 0.01) { q.y = f + 0.01; q.vx *= 0.5; q.vz *= 0.5; q.vy = 0; }
    }
    G.parts = G.parts.filter((q) => q.life > 0);
    for (const d of G.decals) d.t += dt;
    G.decals = G.decals.filter((d) => d.t < DECAL_LIFE[d.kind]);
    updateMotes(dt);
    updateDeaths(dt);
    updateAmbientFx(dt);
    for (const e of G.effects) e.t += dt;
    G.effects = G.effects.filter((e) => e.t < e.dur);
  }

  function updateTurrets(dt) {
    const P = G.p, w = G.world;
    for (const t of w.turrets) {
      t.cool -= dt;
      const dx = P.x - t.x, dz = P.z - t.z, d = Math.hypot(dx, dz);
      let shoot = false;
      if (t.volley > 0) {
        t.volleyT -= dt;
        if (t.volleyT <= 0) { t.volley--; t.volleyT = 0.35; shoot = true; }
      } else if (t.cool <= 0 && d < 9 && (dx * t.nx + dz * t.nz) / d > 0.55 && World.los(w, t.x, t.z, P.x, P.z)) {
        shoot = true; t.cool = 2.8 / Math.max(0.7, G.diff.dmg);
      }
      if (shoot) {
        const vy = (P.eyeY - 0.2 - 0.9) / Math.max(d, 0.5), len = Math.hypot(1, vy);
        spawnProj('e', 'fire', t.x + t.nx * 0.15, 0.9, t.z + t.nz * 0.15, [dx / d / len, vy / len, dz / d / len], 7.5, 14, 1.2);
      }
    }
  }

  function updateWorld(dt) {
    const w = G.world;
    for (const d of w.doors) {
      if (d.state === 'opening') {
        d.open = Math.min(1, d.open + dt * 1.6);
        if (d.open >= 1) { d.state = 'open'; d.timer = d.gate ? 1e9 : 4.5; }
      } else if (d.state === 'open') {
        d.timer -= dt;
        if (d.timer <= 0) {
          const occupied = [G.p, ...G.enemies.filter((e) => !e.dead)].some((o) => Math.abs(o.x - d.x - 0.5) < 0.5 + (o.r || o.def.radius) && Math.abs(o.z - d.z - 0.5) < 0.5 + (o.r || o.def.radius));
          if (occupied) d.timer = 0.5;
          else {
            d.state = 'closing';
            // Same creak as opening, a bit lower, softer and never quite identical.
            Sound.play('door', { x: d.x + 0.5, z: d.z + 0.5, rate: (d.gate ? 0.72 : 0.88) * rand(0.96, 1.04), vol: 0.85 });
          }
        }
      } else if (d.state === 'closing') {
        const occupied = [G.p, ...G.enemies.filter((e) => !e.dead)].some((o) => Math.abs(o.x - d.x - 0.5) < 0.5 + (o.r || o.def.radius) && Math.abs(o.z - d.z - 0.5) < 0.5 + (o.r || o.def.radius));
        if (occupied) d.state = 'opening';
        else {
          d.open = Math.max(0, d.open - dt * 1.6);
          if (d.open <= 0) d.state = 'closed';
        }
      }
    }
    for (const pw of w.pushwalls) {
      if (!pw.moving) continue;
      const step = dt * 1.1;
      pw.x += pw.dx * step; pw.z += pw.dz * step; pw.moved += step;
      if (pw.moved >= 1) {
        pw.x = Math.round(pw.x); pw.z = Math.round(pw.z);
        pw.moved = 0;
        pw.steps = (pw.steps || 0) + 1;
        const next = w.at(pw.x + pw.dx, pw.z + pw.dz);
        if (pw.steps >= 2 || !next || next.solid || next.door) { pw.moving = false; pw.done = true; }
      }
    }
  }

  function markSeen() {
    const P = G.p, w = G.world, R = 9;
    for (let z = Math.floor(P.z) - R; z <= Math.floor(P.z) + R; z++) {
      for (let x = Math.floor(P.x) - R; x <= Math.floor(P.x) + R; x++) {
        const c = w.at(x, z);
        if (!c || c.seen) continue;
        if (Math.hypot(x + 0.5 - P.x, z + 0.5 - P.z) > R) continue;
        // Walls are seen when an adjacent open cell is visible.
        if (c.solid) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = w.at(x + dx, z + dz);
            if (n && !n.solid && World.los(w, P.x, P.z, x + dx + 0.5, z + dz + 0.5)) { c.seen = true; break; }
          }
        } else if (World.los(w, P.x, P.z, x + 0.5, z + 0.5)) c.seen = true;
      }
    }
  }

  function update(dt, input) {
    if (!G || G.ended) return;
    G.time += dt;
    updatePlayer(dt, input);
    Sound.setListener(G.p.x, G.p.z, G.p.yaw);
    if (G.ended) return;
    const w = G.world, P = G.p;
    const cellIdx = Math.floor(P.z) * w.W + Math.floor(P.x);
    G.flowT -= dt;
    if (cellIdx !== G.flowCell || G.flowT <= 0) { G.flowCell = cellIdx; G.flowT = 1; World.computeFlow(w, P.x, P.z); }
    for (const e of G.enemies) updateEnemy(e, dt);
    separateEnemies();
    spiderGrowls(dt);
    slimeScuttle(dt);
    zombieGroans(dt);
    ambience('water', G.world.waters, 12);
    ambience('fire', G.world.torches, 7);
    ambience('glow', G.world.crystals, 5);
    updateTurrets(dt);
    updateProjectiles(dt);
    updateParticles(dt);
    updateWorld(dt);
    G.seenT -= dt;
    if (G.seenT <= 0) { G.seenT = 0.25; markSeen(); }
    for (const k in G.flash) G.flash[k] = Math.max(0, G.flash[k] - dt * 1.5);
    G.shake = Math.max(0, G.shake - dt);
    G.muzzle = Math.max(0, G.muzzle - dt);
    G.frost = Math.max(0, G.frost - dt * 0.05);
    if (G.victoryT > 0) {
      G.victoryT -= dt;
      if (G.victoryT <= 0) {
        G.ended = true;
        G.total.kills += G.stats.kills;
        G.total.time += G.time;
        events.victory({ kills: G.total.kills, time: G.total.time, difficulty: G.diff.name });
      }
    }
  }

  // ---------------- Rendering data ----------------
  function camera() {
    const P = G.p;
    const bob = Math.sin(P.bob * 2) * 0.03 * P.moving;
    const sh = G.shake;
    return {
      x: P.x + (Math.random() - 0.5) * sh * 0.15, y: P.eyeY + bob - P.land * 0.08 + (Math.random() - 0.5) * sh * 0.15, z: P.z + (Math.random() - 0.5) * sh * 0.15,
      yaw: P.yaw, pitch: P.pitch + P.kick * 0.045, fov: 66 * Math.PI / 180,
    };
  }

  function dynamicLights(cam) {
    const L = [];
    L.push({ x: cam.x, y: cam.y, z: cam.z, r: 4.5, col: [1, 0.85, 0.6], i: 0.32 });
    if (G.muzzle > 0) {
      const wp = WEAPONS[G.inv.weapon];
      const col = wp.id === 'fire' ? [1, 0.55, 0.2] : [0.4, 0.7, 1];
      L.push({ x: cam.x + Math.cos(cam.yaw) * 0.5, y: cam.y, z: cam.z + Math.sin(cam.yaw) * 0.5, r: 5, col, i: 1.6 * G.muzzle / 0.12 });
    }
    for (const pr of G.projs) {
      const P = PROJ[pr.kind];
      if (P.light) L.push({ x: pr.x, y: pr.y, z: pr.z, r: 3.5, col: P.light, i: P.li });
    }
    for (const e of G.effects) {
      if (e.light) L.push({ x: e.x, y: e.y, z: e.z, r: 4.5, col: e.light, i: e.li * (1 - e.t / e.dur) });
    }
    // Green slimes glow, pulsing slowly.
    for (const e of G.enemies) {
      if (e.dead || e.type !== 'slime') continue;
      L.push({ x: e.x, y: e.y + 0.3, z: e.z, r: 2.8, col: [0.3, 1, 0.25], i: 0.75 * slimePulse(e) });
    }
    // Glowing particles (sparks, embers) light their surroundings: a few, spread apart.
    const glowing = [];
    for (const q of G.parts) {
      if (!q.emissive || q.life < q.max * 0.3 || glowing.length >= 5) continue;
      if (glowing.some((g) => Math.hypot(g.x - q.x, g.y - q.y, g.z - q.z) < 0.7)) continue;
      glowing.push(q);
      L.push({ x: q.x, y: q.y, z: q.z, r: 1.5, col: q.col, i: 0.7 * q.life / q.max });
    }
    L.sort((a, b) => Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z));
    return L.slice(0, 16);
  }

  function slimePulse(e) { return 0.8 + 0.2 * Math.sin(G.time * 2.6 + e.x * 1.7 + e.z * 2.3); }

  function lightLevel(x, y, z, lights) {
    const lm = World.lightAt(G.world, x, z);
    const amb = G.level.ambient;
    let r = amb + lm[0], g = amb + lm[1], b = amb + lm[2];
    for (const L of lights) {
      const d = Math.hypot(L.x - x, L.y - y, L.z - z);
      if (d >= L.r) continue;
      const a = (1 - d / L.r) ** 2 * L.i;
      r += L.col[0] * a; g += L.col[1] * a; b += L.col[2] * a;
    }
    return [Math.min(r, 1.8), Math.min(g, 1.8), Math.min(b, 1.8)];
  }

  let spriteData = new Float32Array(Renderer.MAX_SPRITES * 36);
  function buildSprites(cam, lights) {
    const list = [];
    const add = (name, x, y, z, ppu, tint, alpha, flip, sizeOverride) => {
      const f = frame(name);
      if (!f) return;
      let w = f.w / ppu, h = f.h / ppu;
      if (sizeOverride) { const s = sizeOverride / Math.max(f.w, f.h); w = f.w * s; h = f.h * s; }
      const s = { f, x, y, z, w, h, tint, alpha, flip, d: (x - cam.x) ** 2 + (z - cam.z) ** 2 + (y - cam.y) ** 2 };
      list.push(s);
      return s;
    };
    // Billboards all face the camera, so sprites lying on the same spot (heaps of
    // corpses, a drop on its corpse) would be coplanar and z-fight: each gets a
    // small, stable nudge towards the camera, and items sit in front of corpses.
    for (const e of G.enemies) {
      const d = e.def;
      let idx;
      if (e.dead) idx = d.dead;
      else if (e.state === 'pain') idx = d.pain;
      else if (e.state === 'attack') idx = d.attack[e.t < (e.mode === 'melee' ? 0.32 : 0.38) ? 0 : 1];
      else if (!e.awake) idx = d.walk[0];
      else idx = d.walk[Math.floor(e.anim * (d.speed > 2.5 ? 10 : 5)) % d.walk.length];
      let tint = lightLevel(e.x, e.y + 0.5, e.z, lights);
      if (e.hit > 0) tint = [2.2, 1.2, 1.2];
      if (e.type === 'ghost') tint = tint.map((v) => v * 0.6 + 0.5);
      const rx = -Math.sin(cam.yaw), rz = Math.cos(cam.yaw);
      const flip = !e.dead && (e.vx * rx + e.vz * rz) < -0.2;
      const keepAfter = e.dead && e.deathKind && KEEP_CORPSE[e.type] && G.time - e.deadAt >= (e.deathKind === 'ice' ? FREEZE_T : BURN_T);
      if (keepAfter && e.deathKind === 'fire') tint = tint.map((v) => v * 0.45);
      if (e.dead && e.deathKind && !keepAfter) {
        const k = G.time - e.deadAt;
        if (e.deathKind === 'ice') {
          if (k >= FREEZE_T) continue;
          const sh = Math.sin(k * 90) * 0.012 * k / FREEZE_T;
          add(e.deathFrame, e.x + sh, e.deathY, e.z, d.ppu, [0.55 + tint[0] * 0.3, 0.8 + tint[1] * 0.3, 1.3], 1, false);
        } else {
          if (k >= ASH_T) continue;
          const b = Math.min(1, k / 1.0), glowK = k < BURN_T ? (0.25 + 0.15 * Math.sin(k * 23)) * (1 - b * 0.7) : 0;
          const ct = tint.map((v, i) => v * (1 - b) * 0.9 + [0.09, 0.08, 0.07][i] * b + [1, 0.4, 0.1][i] * glowK);
          add(`${e.type}_${d.dead}`, e.x, e.y, e.z, d.ppu, ct, k < BURN_T ? 1 : 1 - (k - BURN_T) / (ASH_T - BURN_T), false);
        }
        continue;
      }
      // Ghosts leave no corpse: the last frame rises and fades away.
      if (e.dead && e.type === 'ghost') {
        const k = (G.time - e.deadAt) / 1.1;
        if (k >= 1) continue;
        add(`${e.type}_${idx}`, e.x, World.floorAt(G.world, e.x, e.z, 0.1) + k * 0.5, e.z, d.ppu, tint, (d.alpha || 1) * (1 - k), false);
        continue;
      }
      e.sprite = `${e.type}_${idx}`;
      const spr = add(e.sprite, e.x, e.dead ? World.floorAt(G.world, e.x, e.z, 0.1) : e.y, e.z, d.ppu, tint, e.dead ? 1 : (d.alpha || 1), flip);
      if (spr && e.dead) spr.bias = 0.01 + (G.enemies.indexOf(e) % 7) * 0.012;
    }
    for (const it of G.items) {
      if (it.taken) continue;
      const [name, ppu] = ITEM_SPRITES[it.type];
      const y = World.floorAt(G.world, it.x, it.z, 0.1) + 0.06 + Math.sin(G.time * 3 + it.x * 3) * 0.04;
      const t = lightLevel(it.x, y, it.z, lights).map((v) => v * 1.2 + 0.25);
      const spr = add(name, it.x, y, it.z, ppu, t, 1, false);
      if (spr) spr.bias = 0.12 + (G.items.indexOf(it) % 4) * 0.01;
    }
    for (const pr of G.projs) {
      const P = PROJ[pr.kind];
      const name = P.frames ? P.frames[Math.floor(pr.t * 12) % P.frames.length] : P.frame;
      const tint = pr.kind === 'arrow' ? lightLevel(pr.x, pr.y, pr.z, lights) : [1.3, 1.3, 1.3];
      add(name, pr.x, pr.y - P.size / 2, pr.z, 1, tint, 1, false, P.size);
    }
    for (const ef of G.effects) {
      const k = Math.min(ef.frames.length - 1, Math.floor(ef.t / ef.dur * ef.frames.length));
      add(ef.frames[k], ef.x, ef.y - ef.size / 2, ef.z, 1, [1.3, 1.3, 1.3], 1, false, ef.size);
    }
    for (const q of G.parts) {
      const a = q.life / q.max;
      const t = q.emissive ? q.col.map((v) => v * 1.5) : q.col.map((v, i) => v * lightLevel(q.x, q.y, q.z, lights)[i]);
      if (q.float) {
        // Smoke puffs: soft, growing and fading as they rise.
        const sz = q.size * (2 + (1 - a) * 5), L = lightLevel(q.x, q.y, q.z, lights);
        add('glow', q.x, q.y - sz / 2, q.z, 1, q.col.map((v, i) => v * (0.55 + L[i] * 0.6)), -0.45 * a, false, sz);
        continue;
      }
      add('white', q.x, q.y, q.z, 1, t, Math.min(1, a * 2), false, q.size);
    }
    // Dust motes: brightness from the light falling on them (drawn as points by dustPoints).
    const amb = G.level.ambient;
    for (const m of G.motes) {
      if (m.dead) continue;
      const L = lightLevel(m.x, m.y, m.z, lights);
      const lit = (L[0] + L[1] + L[2]) / 3 - amb - 0.12;
      m.lit = L; m.a = Math.min(0.7, lit * 1.2) * (0.55 + 0.45 * Math.sin(G.time * 2.3 + m.ph * 5));
    }
    // Mist over liquids: soft billboards drifting slowly; lava steam rises.
    for (const m of G.mists) {
      const dd = Math.hypot(m.x - cam.x, m.z - cam.z);
      if (dd > 13) continue;
      const near = Math.min(1, Math.max(0, (dd - 0.4) / 1.2));
      const t = G.time * 0.25 + m.ph;
      const x = m.x + Math.sin(t) * 0.3, z = m.z + Math.cos(t * 0.8) * 0.3;
      if (m.lava) {
        const k = (G.time * 0.18 + m.ph) % 1;
        const a = Math.sin(k * Math.PI) * 0.22 * near;
        list.push({ f: frame('mist'), x, y: m.f - 0.1 + k * 0.5, z, w: 1.3, h: 0.8, tint: [1, 0.42, 0.15], alpha: -a, flip: false,
          d: (x - cam.x) ** 2 + (z - cam.z) ** 2 + (m.f - cam.y) ** 2 });
      } else {
        const L = lightLevel(x, m.f + 0.2, z, lights);
        const tint = [L[0] * 0.8 + 0.3, L[1] * 0.85 + 0.33, L[2] * 0.9 + 0.38];
        list.push({ f: frame('mist'), x, y: m.f - 0.12, z, w: 1.5, h: 0.6, tint, alpha: -(0.2 + 0.06 * Math.sin(t * 3)) * near, flip: false,
          d: (x - cam.x) ** 2 + (z - cam.z) ** 2 + (m.f - cam.y) ** 2 });
      }
    }
    // Decals: scorch marks, frost, blood. Quads lying on their surface.
    for (const dc of G.decals) {
      const life = DECAL_LIFE[dc.kind], fade = Math.min(1, (life - dc.t) / 5, dc.t * 12);
      const n = dc.n, hs = dc.size / 2;
      // In-plane axes: any vector not parallel to n, then rotate by rot.
      const e1 = n[1] !== 0 ? [1, 0, 0] : [-n[2], 0, n[0]];
      const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
      const cr = Math.cos(dc.rot) * hs, sr = Math.sin(dc.rot) * hs;
      const axes = [0, 1, 2].map((i) => e1[i] * cr + e2[i] * sr).concat([0, 1, 2].map((i) => -e1[i] * sr + e2[i] * cr));
      let tint, alpha;
      if (dc.kind === 'scorch') { tint = [0.02, 0.015, 0.01]; alpha = 0.85; }
      else {
        const L = lightLevel(dc.x, dc.y, dc.z, lights);
        // Ice: lit by the room but never black; it thins out as it melts.
        if (dc.kind === 'frost') { const k = Math.min(1.1, (L[0] + L[1] + L[2]) / 3 * 0.85 + 0.22); tint = [k, k, k * 1.05]; alpha = 0.95 * (0.55 + 0.45 * Math.max(0, 1 - dc.t / life)); }
        else { tint = dc.col.map((v, i) => v * L[i] * 0.8); alpha = 0.85; }
      }
      list.push({ f: frame(dc.kind === 'frost' ? `frost${dc.v}` : dc.kind), x: dc.x, y: dc.y, z: dc.z, axes, tint, alpha: -alpha * fade, flip: false,
        d: (dc.x - cam.x) ** 2 + (dc.z - cam.z) ** 2 + (dc.y - cam.y) ** 2 + 0.03 });
    }
    const near = (x, z, r) => (x - cam.x) ** 2 + (z - cam.z) ** 2 < r * r;
    const dist2 = (x, y, z) => (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2;
    const soft = (name, x, y, z, axes, tint, alpha, bias = 0) => list.push({ f: frame(name), x, y, z, axes, tint, alpha: -alpha, flip: false, d: dist2(x, y, z) + bias });
    // Light shafts slanting down from stained-glass windows (two crossed quads).
    for (const wdw of G.world.windows) {
      if (!near(wdw.x, wdw.z, 16)) continue;
      let dx = wdw.dx * 0.75, dy = -0.6, dz = wdw.dz * 0.75;
      const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
      const len = 2.4, sy = wdw.f + 1.2;
      const cx = wdw.x + dx * len / 2, cy = sy + dy * len / 2, cz = wdw.z + dz * len / 2;
      const wa = [-wdw.dz * 0.34, 0, wdw.dx * 0.34];
      const wb = [dy * wa[2] - dz * wa[1], dz * wa[0] - dx * wa[2], dx * wa[1] - dy * wa[0]];
      const wbl = Math.hypot(...wb) / 0.34;
      const B = [dx * len / 2, dy * len / 2, dz * len / 2];
      const k = 0.42 + 0.06 * Math.sin(G.time * 0.8 + wdw.x);
      const tint = wdw.col.map((v) => v * 0.9 + 0.35);
      soft('beam', cx, cy, cz, [...wa, ...B], tint, k);
      soft('beam', cx, cy, cz, [wb[0] / wbl, wb[1] / wbl, wb[2] / wbl, ...B], tint, k * 0.8);
    }
    // Foam at the foot of waterfalls.
    for (const f of G.world.falls) {
      if (!near(f.x, f.z, 12)) continue;
      for (let i = 0; i < 3; i++) {
        const ph = G.time * 1.6 + i * 2.1 + f.x, sz = 0.5 + 0.12 * Math.sin(ph * 1.3);
        const x = f.x + f.dx * (0.2 + 0.08 * i) - f.dz * (i - 1) * 0.3, z = f.z + f.dz * (0.2 + 0.08 * i) + f.dx * (i - 1) * 0.3;
        list.push({ f: frame('mist'), x, y: f.f - 0.08, z, w: sz, h: sz * 0.55, tint: [0.85, 0.92, 1], alpha: -(0.4 + 0.12 * Math.sin(ph)), flip: false, d: dist2(x, f.f, z) });
      }
    }
    // Lava bubbles (flat glowing domes) and water ripples (expanding rings).
    for (const b of G.bubbles) {
      const k = b.t / b.dur, r = b.size * (0.3 + k), y = World.floorAt(G.world, b.x, b.z, 0.01) + 0.015;
      soft('glow', b.x, y, b.z, [r, 0, 0, 0, 0, r], [1.6, 0.7, 0.2], 0.55 + 0.4 * k);
    }
    for (const rp of G.ripples) {
      const c = G.world.at(Math.floor(rp.x), Math.floor(rp.z));
      if (!c) continue;
      const r = 0.15 + rp.t * 0.7, a = Math.max(0, 0.35 * rp.s * (1 - rp.t / 1.6));
      if (a > 0.01) soft('ring', rp.x, c.f + 0.03, rp.z, [r, 0, 0, 0, 0, r], [0.8, 0.9, 1], a);
    }
    // Soot above torches (on the wall, and on low ceilings), falling drips.
    for (const t of G.sootTorches) {
      if (!near(t.x, t.z, 12)) continue;
      // The flame reaches the top of the torch tile: soot goes on the wall above it (tall rooms) or on the ceiling.
      const fx = t.x - t.dx * 0.088, fz = t.z - t.dz * 0.088, y0 = t.f + (t.c - t.f > 1.6 ? 1.38 : 1.5), y1 = Math.min(t.c, y0 + 1.0);
      if (y1 - y0 > 0.12) soft('soot', fx, (y0 + y1) / 2, fz, [-t.dz * 0.36, 0, t.dx * 0.36, 0, (y1 - y0) / 2, 0], [0.02, 0.016, 0.012], 1.25, 0.03);
      if (t.c - t.f <= 1.7) soft('shadow', fx + t.dx * 0.3, t.c - 0.012, fz + t.dz * 0.3, [-t.dz * 0.42, 0, t.dx * 0.42, t.dx * 0.32, 0, t.dz * 0.32], [0.02, 0.018, 0.015], 1.15, 0.03);
    }
    for (const d of G.drips) {
      list.push({ f: frame('white'), x: d.x, y: d.y, z: d.z, w: 0.012, h: 0.05, tint: [0.75, 0.85, 1], alpha: 0.85, flip: false, d: dist2(d.x, d.y, d.z) });
    }
    // Cobwebs hanging across upper corners, moss at the foot of walls.
    for (const cw of G.world.cobwebs) {
      if (!near(cw.x, cw.z, 12)) continue;
      const e1x = cw.x - cw.sx * cw.size, e2z = cw.z - cw.sz * cw.size, h = cw.size * 0.8;
      const cx = (e1x + cw.x) / 2, cz = (cw.z + e2z) / 2, cy = cw.top - h / 2;
      const L = lightLevel(cx, cy, cz, lights);
      soft('web', cx, cy, cz, [(cw.x - e1x) / 2, 0, (e2z - cw.z) / 2, 0, h / 2, 0], L.map((v) => v * 0.8 + 0.12), 0.75);
    }
    for (const m of G.world.moss) {
      if (!near(m.x, m.z, 12)) continue;
      const L = lightLevel(m.x, m.f + 0.2, m.z, lights);
      const off = (m.s - 0.6) * 0.6, x = m.x - m.dz * off, z = m.z + m.dx * off;
      soft('moss', x, m.f + m.s * 0.28, z, [-m.dz * m.s / 2, 0, m.dx * m.s / 2, 0, m.s * 0.28, 0], L.map((v) => v * 0.9 + 0.08), 0.9, 0.02);
    }
    // Soft blob shadows (drawn just before what stands on them).
    const shadow = (x, z, r, strength) => {
      const fy = World.floorAt(G.world, x, z, 0.05) + 0.012;
      list.push({ f: frame('shadow'), x, y: fy, z, w: r * 2, h: r * 1.5, flat: true, tint: [0, 0, 0], alpha: -strength, flip: false,
        d: (x - cam.x) ** 2 + (z - cam.z) ** 2 + (fy - cam.y) ** 2 + 0.02 });
    };
    for (const e of G.enemies) if (!e.dead) shadow(e.x, e.z, e.def.radius * 1.35, e.def.fly ? 0.35 : 0.6);
    // Slime glow: a halo just behind the body and a luminous pool on the floor.
    for (const e of G.enemies) {
      if (e.dead || e.type !== 'slime') continue;
      const k = slimePulse(e), dx = e.x - cam.x, dz = e.z - cam.z, dd = Math.hypot(dx, dz) || 1;
      const hx = e.x + dx / dd * 0.08, hz = e.z + dz / dd * 0.08, hy = e.y - 0.15;
      list.push({ f: frame('glow'), x: hx, y: hy, z: hz, w: 1.3, h: 1.1, tint: [0.45, 1.6, 0.35], alpha: -0.38 * k, flip: false,
        d: dx * dx + dz * dz + (hy - cam.y) ** 2 + 0.05 });
      const fy = World.floorAt(G.world, e.x, e.z, 0.05) + 0.013;
      list.push({ f: frame('glow'), x: e.x, y: fy, z: e.z, w: 1.9, h: 1.9, flat: true, tint: [0.4, 1.5, 0.3], alpha: -0.42 * k, flip: false,
        d: dx * dx + dz * dz + (fy - cam.y) ** 2 + 0.03 });
    }
    for (const it of G.items) if (!it.taken) shadow(it.x, it.z, 0.2, 0.45);
    for (const d of G.decor) if (d.type === 'pillar') shadow(d.x, d.z, 0.5, 0.45);
    // Long shadows from wall lights, swaying with the flame (two strongest lights per caster).
    const castShadows = (x, z, w, h, f, strength) => {
      const w0 = G.world, c0 = w0.at(Math.floor(x), Math.floor(z));
      if (!f || !c0 || c0.solid) return;
      const cand = [];
      for (const L of G.castLights) {
        const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
        if (d >= L.r * 0.95 || d < 0.3) continue;
        const k = (1 - d / L.r) ** 1.5 * Math.min(1, L.i) * strength;
        if (k > 0.04) cand.push({ L, dx: dx / d, dz: dz / d, d, k });
      }
      cand.sort((a, b) => b.k - a.k);
      let used = 0;
      for (const s of cand) {
        if (used >= 2) break;
        if (!World.los(w0, s.L.x, s.L.z, x, z)) continue;
        used++;
        const ph = s.L.x * 3.1 + s.L.z * 1.7;
        const a = Math.sin(G.time * 7.3 + ph) * 0.03 + Math.sin(G.time * 13.1 + ph) * 0.015;
        const dx = s.dx * Math.cos(a) - s.dz * Math.sin(a), dz = s.dx * Math.sin(a) + s.dz * Math.cos(a);
        let len = Math.min(3, h * (0.5 + s.d * 0.45)) * (1 + 0.06 * Math.sin(G.time * 9.1 + ph));
        // Stop at walls, doors and floor steps.
        for (let t = 0.1; t < len; t += 0.1) {
          const c = w0.at(Math.floor(x + dx * t), Math.floor(z + dz * t));
          if (!c || c.solid || c.door || Math.abs(c.f - c0.f) > 0.05) { len = t; break; }
        }
        if (len < 0.2) continue;
        const k = s.k * (0.88 + 0.12 * Math.sin(G.time * 11 + ph));
        const cx = x + dx * len / 2, cz = z + dz * len / 2, fy = c0.f + 0.011;
        list.push({ f, x: cx, y: fy, z: cz, axes: [-dz * w / 2, 0, dx * w / 2, dx * len / 2, 0, dz * len / 2],
          tint: [0, 0, 0], alpha: -Math.min(0.7, k), flip: false,
          d: (cx - cam.x) ** 2 + (cz - cam.z) ** 2 + (fy - cam.y) ** 2 + 0.04 });
      }
    };
    for (const e of G.enemies) {
      if (e.dead || e.def.fly || Math.hypot(e.x - cam.x, e.z - cam.z) > 14) continue;
      const f = e.sprite && frame(e.sprite);
      if (f) castShadows(e.x, e.z, f.w / e.def.ppu, f.h / e.def.ppu, f, 0.95);
    }
    for (const d of G.decor) if (d.type === 'pillar' && Math.hypot(d.x - cam.x, d.z - cam.z) < 14) castShadows(d.x, d.z, 0.5, 2.4, frame('colshadow'), 0.35);
    list.sort((a, b) => b.d - a.d);
    const rx = -Math.sin(cam.yaw), rz = Math.cos(cam.yaw);
    const n = Math.min(list.length, Renderer.MAX_SPRITES);
    let o = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i], hw = s.w / 2;
      const u0 = s.flip ? s.f.u1 : s.f.u0, u1 = s.flip ? s.f.u0 : s.f.u1;
      const [r, g, b] = s.tint;
      const hd = s.h / 2;
      const A = s.axes;
      const verts = A ? [
        [s.x - A[0] - A[3], s.y - A[1] - A[4], s.z - A[2] - A[5], s.f.u0, s.f.v1],
        [s.x + A[0] - A[3], s.y + A[1] - A[4], s.z + A[2] - A[5], s.f.u1, s.f.v1],
        [s.x + A[0] + A[3], s.y + A[1] + A[4], s.z + A[2] + A[5], s.f.u1, s.f.v0],
        [s.x - A[0] + A[3], s.y - A[1] + A[4], s.z - A[2] + A[5], s.f.u0, s.f.v0],
      ] : s.flat ? [
        [s.x - hw, s.y, s.z - hd, s.f.u0, s.f.v1],
        [s.x + hw, s.y, s.z - hd, s.f.u1, s.f.v1],
        [s.x + hw, s.y, s.z + hd, s.f.u1, s.f.v0],
        [s.x - hw, s.y, s.z + hd, s.f.u0, s.f.v0],
      ] : [
        [s.x - rx * hw - rz * (s.bias || 0), s.y, s.z - rz * hw + rx * (s.bias || 0), u0, s.f.v1],
        [s.x + rx * hw - rz * (s.bias || 0), s.y, s.z + rz * hw + rx * (s.bias || 0), u1, s.f.v1],
        [s.x + rx * hw - rz * (s.bias || 0), s.y + s.h, s.z + rz * hw + rx * (s.bias || 0), u1, s.f.v0],
        [s.x - rx * hw - rz * (s.bias || 0), s.y + s.h, s.z - rz * hw + rx * (s.bias || 0), u0, s.f.v0],
      ];
      for (const v of verts) {
        spriteData[o++] = v[0]; spriteData[o++] = v[1]; spriteData[o++] = v[2];
        spriteData[o++] = v[3]; spriteData[o++] = v[4];
        spriteData[o++] = r; spriteData[o++] = g; spriteData[o++] = b; spriteData[o++] = s.alpha;
      }
    }
    return { data: spriteData, count: n };
  }

  // opts: { overlay: canvas, fx: 0 off | 1 light | 2 full (CRT) }
  function render(time, opts) {
    const cam = camera();
    const lights = dynamicLights(cam);
    const sprites = buildSprites(cam, lights);
    const flicker = 0.93 + 0.05 * Math.sin(time * 9.1) + 0.03 * Math.sin(time * 23.7);
    Renderer.draw(cam, {
      ambient: G.level.ambient, fog: G.level.fog, fogDensity: G.level.fogDensity, flicker, time,
      sky: true, reflectY: G.liquid ? -0.3 : undefined, lowFog: G.level.lowFog || 0, ripples: rippleUniform(),
    }, lights, World.dynamicMesh(G.world), sprites.data, sprites.count, {
      overlay: opts.overlay, time, crt: opts.fx >= 2, grade: G.level.grade,
      aberration: opts.fx >= 1 ? Math.min(1.2, G.flash.hurt * 1.8) : 0,
      heat: opts.fx >= 1 ? heatAmount() : 0,
      ...dustPoints(cam),
    });
    G.lastLights = lights;
  }

  // Dust motes as tiny translucent points at display resolution, skipped when a wall hides them.
  const dustData = new Float32Array(128 * 8);
  function dustPoints(cam) {
    const px = Math.max(1, window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) / 720);
    let n = 0;
    for (const m of G.motes) {
      if (m.dead || m.a < 0.03 || n >= 128) continue;
      if (!World.los(G.world, cam.x, cam.z, m.x, m.z)) continue;
      const L = m.lit;
      dustData.set([m.x, m.y, m.z, Math.min(1, L[0] * 0.9 + 0.25), Math.min(1, L[1] * 0.85 + 0.22), Math.min(1, L[2] * 0.75 + 0.18), m.a, m.sz * px], n * 8);
      n++;
    }
    return { dust: dustData, dustCount: n };
  }

  // Heat haze strength: close to lava, full when standing in it.
  function heatAmount() {
    const P = G.p;
    let d = 1e9;
    for (const c of G.lavaCells) d = Math.min(d, Math.hypot(c.x - P.x, c.z - P.z));
    return Math.max(0, Math.min(1, 1.3 - d / 2.6));
  }

  // ---------------- First-person overlay ----------------
  let weaponLayer = null;
  function drawOverlay(g, W, H, showMap) {
    g.clearRect(0, 0, W, H);
    if (!G) return;
    const P = G.p, inv = G.inv, V = A.views;
    const light = lightLevel(P.x, P.eyeY, P.z, G.lastLights || []);
    const bright = Math.max(0.35, Math.min(1.5, (light[0] + light[1] + light[2]) / 3 + 0.15));
    const s = H / 300;
    const breathe = Math.sin(G.time * 1.8) * 2 * s * (1 - P.moving);
    const bx = Math.sin(P.bob) * 6 * s * P.moving + P.swayX * 22 * s;
    const by = Math.abs(Math.cos(P.bob)) * 7 * s * P.moving + breathe + P.swayY * 14 * s + P.land * 18 * s + P.kick * 8 * s;
    let lower = 0;
    if (P.switchT > 0) lower = (P.switchT > 0.18 ? (0.36 - P.switchT) : P.switchT) / 0.18 * H * 0.55;
    const t = P.anim, wp = WEAPONS[inv.weapon];
    g.imageSmoothingEnabled = false;
    // The weapon is drawn on its own layer, then tinted towards the hue of the
    // surrounding light (orange by torches, violet by crystals, green by slimes).
    if (!weaponLayer || weaponLayer.width !== W || weaponLayer.height !== H) {
      weaponLayer = document.createElement('canvas');
      weaponLayer.width = W; weaponLayer.height = H;
    }
    const wl = weaponLayer.getContext('2d');
    wl.clearRect(0, 0, W, H);
    wl.imageSmoothingEnabled = false;
    wl.filter = `brightness(${bright.toFixed(2)})`;
    const put = (img, cx, h, dx = 0, dy = 0, sc = 1) => {
      const hh = h * H * sc, ww = img.width * hh / img.height;
      wl.drawImage(img, Math.round(cx * W - ww / 2 + bx + dx), Math.round(H - hh + by + lower + dy + 4 * s), Math.round(ww), Math.round(hh));
      return { x: cx * W - ww / 2 + bx + dx, y: H - hh + by + lower + dy + 4 * s, w: ww, h: hh };
    };
    let glow = null, flash = null, bolt = null;
    if (wp.id === 'dagger') {
      const k = t < 0.3 ? Math.sin(t / 0.3 * Math.PI) : 0;
      put(V.dagger, 0.66, 0.5, -k * W * 0.1, -k * H * 0.16, 1 + k * 0.12);
    } else if (wp.id === 'staff') {
      const k = t < 0.2 ? 1 - t / 0.2 : 0;
      const r = put(V.staff, 0.74, 0.62, k * 4 * s, k * 10 * s);
      glow = { x: r.x + r.w * 0.86, y: r.y + r.h * 0.07, r: (10 + 26 * k) * s, c: '140,200,255', a: 0.35 + 0.6 * k };
      if (t < 0.08) flash = { kind: 'star', x: glow.x, y: glow.y, r: 30 * s * (1 - t / 0.08 * 0.5), c: '200,235,255' };
    } else if (wp.id === 'xbow') {
      const k = t < 0.12 ? t / 0.12 : t < 0.7 ? 1 - (t - 0.12) / 0.58 : 0;
      // Held crossbow: bolt tip near the crosshair, the arm running off the bottom-right corner.
      const hh = 0.66 * H, ww = V.xbow.width * hh / V.xbow.height;
      // After the shot the rail is empty until the next bolt is loaded.
      const r = put(t < 0.6 || inv.bolts <= 0 ? V.xbowEmpty : V.xbow, 0.5, 0.66, ww * 0.06, hh * 0.14 + k * 22 * s);
      if (t < 0.24) bolt = { r, k: t / 0.24 };
      if (t < 0.04) flash = { kind: 'snap', x: r.x + r.w * 0.47, y: r.y + r.h * 0.12, r: 16 * s, c: '255,245,210' };
    } else if (wp.id === 'fire') {
      if (t < 0.35) {
        const r = put(V.orb, 0.5, 0.46, 0, (1 - t / 0.35) * -6 * s);
        glow = { x: r.x + r.w / 2, y: r.y + r.h * 0.45, r: 40 * s, c: '255,150,40', a: 0.6 * (1 - t / 0.35) };
        if (t < 0.09) flash = { kind: 'fire', x: glow.x, y: glow.y - 6 * s, r: H * 0.16 * (1 + t / 0.09 * 0.4) };
      } else {
        const f = 1 + Math.sin(G.time * 14) * 0.02;
        const r = put(V.flame, 0.64, 0.46, 0, 0, f);
        glow = { x: r.x + r.w * 0.6, y: r.y + r.h * 0.2, r: (14 + Math.sin(G.time * 11) * 3) * s, c: '255,140,40', a: 0.35 };
      }
    }
    wl.filter = 'none';
    const lmax = Math.max(light[0], light[1], light[2], 1e-3), lmin = Math.min(light[0], light[1], light[2]);
    const sat = (lmax - lmin) / lmax;
    if (sat > 0.05) {
      wl.globalCompositeOperation = 'source-atop';
      wl.fillStyle = `rgba(${light.map((v) => Math.round(v / lmax * 255)).join(',')},${Math.min(0.4, sat * 0.55).toFixed(3)})`;
      wl.fillRect(0, 0, W, H);
      wl.globalCompositeOperation = 'source-over';
    }
    g.drawImage(weaponLayer, 0, 0);
    if (glow) {
      const gr = g.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.r);
      gr.addColorStop(0, `rgba(${glow.c},${glow.a})`);
      gr.addColorStop(1, `rgba(${glow.c},0)`);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = gr;
      g.fillRect(glow.x - glow.r, glow.y - glow.r, glow.r * 2, glow.r * 2);
      g.globalCompositeOperation = 'source-over';
    }
    if (flash) drawMuzzle(g, flash, s);
    if (bolt) drawBolt(g, bolt.r, bolt.k, W, H, s);
    // Crosshair.
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    g.fillStyle = 'rgba(255,230,180,0.75)';
    g.fillRect(cx - 4, cy, 3, 1); g.fillRect(cx + 2, cy, 3, 1); g.fillRect(cx, cy - 4, 1, 3); g.fillRect(cx, cy + 2, 1, 3);
    if (G.frost > 0.56) {
      // Only after a long burst of ice (about 15 shots in a row) does it creep in.
      g.globalAlpha = Math.max(0, Math.min(1, (G.frost - 0.55) / 0.4));
      g.drawImage(frostOverlay(W, H), 0, 0);
      g.globalAlpha = 1;
    }
    // Screen tints.
    const tint = (col, a) => { if (a <= 0) return; g.fillStyle = `rgba(${col},${a})`; g.fillRect(0, 0, W, H); };
    if (G.flash.hurt > 0) {
      const gr = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.7);
      gr.addColorStop(0, `rgba(160,0,0,${G.flash.hurt * 0.25})`);
      gr.addColorStop(1, `rgba(160,0,0,${Math.min(0.8, G.flash.hurt)})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    tint('255,210,90', G.flash.pickup * 0.35);
    tint('255,90,0', G.flash.lava * 0.3);
    if (inv.hp <= 0) tint('120,0,0', 0.5);
    if (showMap) drawMap(g, W, H);
  }

  // Icy rim with crystal ferns growing in from the edges (built once per size).
  let frostCache = null;
  function frostOverlay(W, H) {
    if (frostCache && frostCache.width === W && frostCache.height === H) return frostCache;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    gr.addColorStop(0, 'rgba(190,225,255,0)');
    gr.addColorStop(0.6, 'rgba(190,225,255,0.18)');
    gr.addColorStop(1, 'rgba(220,240,255,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    g.lineWidth = Math.max(1, H / 300);
    const fern = (x, y, a, len, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.strokeStyle = `rgba(230,245,255,${0.14 + depth * 0.09})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      if (depth <= 0) return;
      for (let i = 1; i <= 3; i++) {
        const k = i / 4, bx = x + (x2 - x) * k, by = y + (y2 - y) * k;
        for (const s of [-1, 1]) fern(bx, by, a + s * rand(0.6, 1.0), len * rand(0.3, 0.45), depth - 1);
      }
    };
    const n = Math.round((W + H) / 7);
    for (let i = 0; i < n; i++) {
      // Start on a random edge, growing inwards; corners get more.
      const side = Math.floor(Math.random() * 4), t = Math.random() ** 1.6 * (Math.random() < 0.5 ? 1 : -1) * 0.5 + 0.5;
      const [x, y, a] = [[t * W, 0, Math.PI / 2], [t * W, H, -Math.PI / 2], [0, t * H, 0], [W, t * H, Math.PI]][side];
      fern(x, y, a + rand(-0.6, 0.6), H * rand(0.04, 0.12), 2);
    }
    frostCache = c;
    return c;
  }

  // The fired bolt leaves the rail and flies into the screen towards the
  // crosshair, shrinking with distance (tip and tail projected separately).
  function drawBolt(g, r, k, W, H, s) {
    const vx = W / 2, vy = H / 2, d = k * 7;
    const tip0 = [r.x + r.w * 0.464, r.y + r.h * 0.005], tail0 = [r.x + r.w * 0.62, r.y + r.h * 0.3];
    const st = 1.6 / (1.6 + d), sl = 1 / (1 + d);
    const tip = [vx + (tip0[0] - vx) * st, vy + (tip0[1] - vy) * st];
    const tail = [vx + (tail0[0] - vx) * sl, vy + (tail0[1] - vy) * sl];
    const dx = tip[0] - tail[0], dy = tip[1] - tail[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    g.save();
    // Motion streak.
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(255,240,210,${0.35 * (1 - k)})`;
    g.lineWidth = Math.max(1, 2 * s * sl);
    g.beginPath(); g.moveTo(tip0[0], tip0[1]); g.lineTo(tip[0], tip[1]); g.stroke();
    g.globalCompositeOperation = 'source-over';
    // Shaft.
    g.lineCap = 'round';
    g.strokeStyle = '#2e2a26';
    g.lineWidth = Math.max(1, 7 * s * sl);
    g.beginPath(); g.moveTo(tail[0], tail[1]); g.lineTo(tip[0], tip[1]); g.stroke();
    g.strokeStyle = '#8c8478';
    g.lineWidth = Math.max(1, 2 * s * sl);
    g.beginPath(); g.moveTo(tail[0] + px * 1.5 * s * sl, tail[1] + py * 1.5 * s * sl); g.lineTo(tip[0], tip[1]); g.stroke();
    // Fletching.
    const fl = 14 * s * sl, fw = 7 * s * sl;
    g.fillStyle = '#9c8466';
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(tail[0] + ux * fl, tail[1] + uy * fl);
      g.lineTo(tail[0] + px * fw * side, tail[1] + py * fw * side);
      g.lineTo(tail[0] - ux * fl * 0.3 + px * fw * side, tail[1] - uy * fl * 0.3 + py * fw * side);
      g.lineTo(tail[0], tail[1]);
      g.fill();
    }
    // Iron head.
    const hl = 18 * s * st, hw = 7 * s * st;
    const bx = tip[0] - ux * hl, by = tip[1] - uy * hl;
    g.fillStyle = '#5a5a62';
    g.beginPath(); g.moveTo(tip[0] + ux * hl * 0.2, tip[1] + uy * hl * 0.2); g.lineTo(bx + px * hw, by + py * hw); g.lineTo(bx - px * hw, by - py * hw); g.fill();
    g.fillStyle = '#b4b4bc';
    g.beginPath(); g.moveTo(tip[0] + ux * hl * 0.2, tip[1] + uy * hl * 0.2); g.lineTo(bx + px * hw, by + py * hw); g.lineTo(bx, by); g.fill();
    g.restore();
  }

  // One-frame muzzle effects: icy star burst, bow-string snap, fire bloom.
  function drawMuzzle(g, f, s) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    if (f.kind === 'fire') {
      const img = A.views.fire3, h = f.r, w = img.width * h / img.height;
      g.globalAlpha = 0.9;
      g.drawImage(img, Math.round(f.x - w / 2), Math.round(f.y - h / 2), Math.round(w), Math.round(h));
    } else {
      const gr = g.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      gr.addColorStop(0, `rgba(${f.c},0.95)`);
      gr.addColorStop(0.35, `rgba(${f.c},0.45)`);
      gr.addColorStop(1, `rgba(${f.c},0)`);
      g.fillStyle = gr;
      g.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      g.strokeStyle = `rgba(${f.c},0.8)`;
      g.lineWidth = Math.max(1, s);
      const rays = f.kind === 'star' ? 6 : 3;
      g.beginPath();
      for (let i = 0; i < rays; i++) {
        const a = f.kind === 'star' ? i / rays * Math.PI * 2 + G.time * 3 : -Math.PI / 2 + (i - 1) * 0.35;
        const len = f.r * (f.kind === 'star' ? 1.4 : 1.8);
        g.moveTo(f.x, f.y);
        g.lineTo(f.x + Math.cos(a) * len, f.y + Math.sin(a) * len);
      }
      g.stroke();
    }
    g.restore();
  }

  function drawMap(g, W, H) {
    const w = G.world, P = G.p;
    const cs = Math.max(2, Math.floor(Math.min(W * 0.9 / w.W, H * 0.85 / w.H)));
    const ox = Math.floor((W - cs * w.W) / 2), oy = Math.floor((H - cs * w.H) / 2);
    g.fillStyle = 'rgba(5,4,10,0.78)';
    g.fillRect(ox - 4, oy - 4, cs * w.W + 8, cs * w.H + 8);
    for (let z = 0; z < w.H; z++) for (let x = 0; x < w.W; x++) {
      const c = w.at(x, z);
      if (!c.seen) continue;
      let col;
      if (c.solid) col = c.ch === 'E' ? '#4f4' : c.ch === 'T' ? '#e93' : '#8a7f70';
      else if (c.door) col = c.door.locked ? '#d33' : '#c80';
      else if (c.kind === 'lava') col = '#a31';
      else if (c.kind === 'water') col = '#236';
      else col = c.sky ? '#253020' : '#2a2630';
      g.fillStyle = col;
      g.fillRect(ox + x * cs, oy + z * cs, cs, cs);
    }
    for (const it of G.items) {
      if (it.taken || !w.at(Math.floor(it.x), Math.floor(it.z)).seen) continue;
      g.fillStyle = it.type === 'key' ? '#fd3' : '#6cf';
      g.fillRect(ox + it.x * cs - 1, oy + it.z * cs - 1, 2, 2);
    }
    const px = ox + P.x * cs, pz = oy + P.z * cs;
    g.strokeStyle = '#ff4'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, pz); g.lineTo(px + Math.cos(P.yaw) * cs * 1.6, pz + Math.sin(P.yaw) * cs * 1.6); g.stroke();
    g.fillStyle = '#ff4'; g.fillRect(px - 1, pz - 1, 3, 3);
  }

  function hud() {
    if (!G) return null;
    const inv = G.inv, P = G.p, wp = WEAPONS[inv.weapon];
    return {
      hp: Math.ceil(inv.hp), mana: Math.floor(inv.mana), bolts: inv.bolts, key: P.key,
      weapon: inv.weapon, weaponName: wp.name, owned: WEAPONS.map((w) => inv.owned[w.id]),
      level: G.levelIndex + 1, levelName: G.level.name,
      kills: G.stats.kills, totalKills: G.stats.totalKills,
      boss: G.boss && G.boss.awake && !G.boss.dead ? G.boss.hp / (G.boss.def.hp * G.diff.hp) : -1,
    };
  }

  return {
    init, newGame, restartLevel, nextLevel, update, render, drawOverlay, hud, events, DIFFICULTY, WEAPONS,
    get state() { return G; },
  };
})();
