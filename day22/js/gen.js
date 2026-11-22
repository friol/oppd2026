'use strict';
// Procedural level generator. A level is a sequence of chunks; each chunk is a small hand-designed
// pattern with random parameters. Portal chunks are built so that they can only be solved with the
// portal gun (see the comments of each chunk for the intended solution).

const GEN = {
  H: 22,
  BASE_G: 18,          // row of the ground surface
  SEEDS: [1101, 2202, 3303],

  generate(index, seed) {
    seed = seed || GEN.SEEDS[index];
    const R = U.rng(seed);
    const L = new Level(420, GEN.H, index);
    L.seed = seed;
    const b = { L, R, x: 0, g: GEN.BASE_G, d: index, signs: index === 0 };
    const C = GEN.chunks;
    const seq = GEN.plans[index](R, C);
    for (const fn of seq) fn(b);
    // trim: keep two columns after the end, closed by a metal wall
    const w = b.x + 2;
    const out = new Level(w, GEN.H, index);
    out.seed = seed;
    for (let y = 0; y < GEN.H; y++) for (let x = 0; x < w; x++) out.set(x, y, L.get(x, y));
    for (let x = b.x; x < w; x++) GEN.ground(out, x, b.g);
    out.fill(w - 1, 0, w - 1, GEN.H - 1, 'M');
    out.ents = L.ents.filter(e => e.x < w);
    if (index === 2) GEN.cityProps(out, seed);
    return out;
  },

  // World 3 (city): extra street furniture on the flat ground (lamps, traffic lights, mailboxes,
  // barriers, trash, bollards). It uses its own random generator, so it never changes the layout
  // of the level or what the main generator produces afterwards.
  cityProps(L, seed) {
    const R = U.rng((seed ^ 0x5eed1234) >>> 0), g = GEN.BASE_G;
    const kinds = ['torch', 'crate', 'barrel', 'fence', 'bush', 'rock', 'torch', 'barrel'];
    let last = -9;
    for (let x = 9; x < L.w - 8; x++) {
      if (x - last < 4) continue;
      if (L.get(x, g) !== '#' || L.get(x, g - 1) !== '.' || L.get(x - 1, g - 1) !== '.' || L.get(x + 1, g - 1) !== '.') continue;
      if (L.ents.some(e => Math.abs(e.x - x) <= 1 && e.y >= g - 3 && e.y <= g)) continue;
      if (!R.chance(0.22)) continue;
      L.add(R.pick(kinds), x, g - 1);
      last = x;
    }
  },

  // ---- level plans ----
  plans: [
    // Level 1: tutorial-ish, every portal mechanic introduced with a sign
    (R, C) => [
      C.start, b => C.flat(b, 10, 1), ...R.shuffle([C.blocks, C.gap, b => C.flat(b, 9, 1)]),
      C.grateWall, b => C.flat(b, 8, 1), C.hill, C.cliffPortal, C.checkpoint,
      ...R.shuffle([C.plantLedge, C.secretRoom, C.gap]), C.enemyDrop, b => C.flat(b, 8, 1),
      C.checkpoint, C.flingGap, C.blocks, C.batZone, C.end
    ],
    // Level 2: caves, turrets and cracked bricks
    (R, C) => [
      C.start, C.waterPlatforms, C.turretGate,
      ...R.shuffle([C.batZone, C.plantLedge, C.crackedCeiling, C.gap, C.fireRun]),
      C.checkpoint,
      ...R.shuffle([C.cliffPortal, C.enemyDrop, C.secretRoom, C.waterPlatforms, C.flingGap, C.blocks]),
      C.hill, C.end
    ],
    // Level 3: the citadel and the boss
    (R, C) => [
      C.start, ...R.shuffle([C.fireRun, C.turretGate, C.grateWall, C.plantLedge, C.batZone]),
      C.checkpoint,
      ...R.shuffle([C.cliffPortal, C.enemyDrop, C.flingGap, C.secretRoom, C.crackedCeiling, C.waterPlatforms]),
      C.checkpoint, C.bossArena
    ]
  ],

  // ground column from row top to the bottom
  ground(L, x, top) { L.fill(x, top, x, GEN.H - 1, '#'); },
  flatGround(b, w) { for (let i = 0; i < w; i++) GEN.ground(b.L, b.x + i, b.g); },
  coinArc(b, x0, n, row, hgt) {
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      b.L.add('coin', x0 + i, row - Math.round(Math.sin(t * Math.PI) * (hgt || 0)));
    }
  },
  decor(b, x0, w) {
    const kinds = [['bush', 'bush', 'rock', 'fence'], ['rock', 'bush', 'barrel', 'torch'], ['torch', 'crate', 'barrel', 'rock', 'fence', 'bush', 'barrel']][b.d];
    for (let i = 0; i < w; i++) if (b.R.chance(0.18)) b.L.add(b.R.pick(kinds), x0 + i, b.g - 1);
  },
  sign(b, x, text) { if (b.signs) b.L.add('sign', x, b.g - 1, { text }); },
  enemies(b, x0, w, n) {
    const kinds = [['goblin', 'goblin', 'slime'], ['goblin', 'slime', 'slime', 'brute'], ['goblin', 'brute', 'slime']][b.d];
    for (let i = 0; i < n; i++) b.L.add(b.R.pick(kinds), x0 + b.R.int(0, Math.max(0, w - 1)), b.g - 1);
  },

  chunks: {
    start(b) {
      GEN.flatGround(b, 10);
      b.L.add('start', b.x + 2, b.g - 1);
      if (b.d === 0) GEN.sign(b, b.x + 5, 'ARROWS move, SPACE jumps. Stomp the monsters!');
      else b.L.add('torch', b.x + 5, b.g - 1);
      b.x += 10;
    },
    flat(b, w, en) {
      GEN.flatGround(b, w);
      GEN.coinArc(b, b.x + 2, Math.min(5, w - 3), b.g - 3, 1);
      GEN.decor(b, b.x, w);
      GEN.enemies(b, b.x + 3, w - 4, b.R.int(en ? 1 : 0, 1 + b.d));
      b.x += w;
    },
    hill(b) {
      // up two steps, a flat top, and down again
      const h = b.R.int(1, 2), top = 3 + b.R.int(0, 3);
      const cols = [0, h, h * 2, ...Array(top).fill(h * 2), h, 0];
      cols.forEach((u, i) => GEN.ground(b.L, b.x + i, b.g - u));
      GEN.coinArc(b, b.x + 3, top, b.g - h * 2 - 2, 0);
      if (b.R.chance(0.6)) b.L.add(b.R.pick(['goblin', 'slime']), b.x + 3, b.g - h * 2 - 1);
      b.x += cols.length;
    },
    blocks(b) {
      const w = 13;
      GEN.flatGround(b, w);
      const pat = b.R.shuffle(['B', '?', 'B', 'P', '?']);
      // the jump reaches about 3.6 tiles: the platforms must be at most 3 tiles above what the hero stands on
      for (let i = 0; i < 5; i++) b.L.set(b.x + 4 + i, b.g - 3, pat[i]);
      if (b.R.chance(0.6)) {
        // upper tier, 3 tiles above the first one and shifted right: jump onto it from the edge of the first tier
        b.L.set(b.x + 6, b.g - 6, '?'); b.L.set(b.x + 7, b.g - 6, 'B'); b.L.set(b.x + 8, b.g - 6, '?');
        GEN.coinArc(b, b.x + 6, 3, b.g - 8, 0);
      }
      // a hidden block above the left side
      b.L.set(b.x + 1, b.g - 3, 'H');
      GEN.enemies(b, b.x + 9, 3, 1);
      GEN.decor(b, b.x, 3);
      b.x += w;
    },
    gap(b) {
      const gw = b.R.int(2, 3 + (b.d > 0 ? 1 : 0));
      GEN.flatGround(b, 3);
      if (b.R.chance(0.45)) b.L.fill(b.x + 3, GEN.H - 2, b.x + 2 + gw, GEN.H - 1, 'W');
      GEN.coinArc(b, b.x + 3, gw, b.g - 3, 1);
      b.x += 3 + gw;
      GEN.flatGround(b, 3);
      if (b.d > 0 && b.R.chance(0.5)) b.L.add('bat', b.x - gw, b.g - 6);
      b.x += 3;
    },
    // Wall reaching the sky with a grate window: shoot a portal through the grate onto the floor
    // beyond, put the other one on this side and walk through.
    grateWall(b) {
      const w = 20;
      GEN.flatGround(b, w);
      b.L.fill(b.x + 8, 0, b.x + 9, b.g - 5, 'M');
      b.L.fill(b.x + 8, b.g - 4, b.x + 9, b.g - 1, 'G');
      GEN.sign(b, b.x + 3, 'LEFT CLICK: blue portal. RIGHT CLICK: orange portal. Shots fly through grates - you do not.');
      GEN.coinArc(b, b.x + 12, 5, b.g - 2, 1);
      if (b.d > 0) b.L.add('goblin', b.x + 16, b.g - 1);
      b.x += w;
    },
    // Metal cliff (no portals) too high to jump. A stone pillar hangs above the plateau: shoot a
    // portal on its left face (over the cliff edge) and one on the floor, then walk in.
    cliffPortal(b) {
      const g = b.g, x = b.x;
      GEN.flatGround(b, 10);
      b.L.fill(x + 10, g - 6, x + 10, GEN.H - 1, 'M');
      for (let i = 11; i <= 21; i++) GEN.ground(b.L, x + i, g - 6);
      b.L.fill(x + 14, 0, x + 15, g - 9, '=');
      GEN.sign(b, x + 2, 'Too high? Shoot a portal on the high stone wall, one at your feet, and step in. Portals do not stick to metal.');
      GEN.coinArc(b, x + 11, 3, g - 8, 0);
      GEN.coinArc(b, x + 17, 4, g - 8, 1);
      if (b.d > 0) b.L.add(b.R.pick(['goblin', 'slime']), x + 19, g - 7);
      b.x += 22;
      GEN.flatGround(b, 2);
      b.x += 2;
    },
    // A tower, a pit with a portal-friendly floor and a chasm too wide to jump.
    // Portal A on the pit floor (visible from the tower top), B on the floor at the chasm edge:
    // jump off the tower into A and fly out of B.
    flingGap(b) {
      const g = b.g, x = b.x;
      GEN.flatGround(b, 2);
      [2, 2, 4, 4, 6, 6, 8, 8].forEach((h, i) => { GEN.ground(b.L, x + 2 + i, g); b.L.fill(x + 2 + i, g - h, x + 2 + i, g - 1, '='); });
      for (let i = 10; i <= 12; i++) GEN.ground(b.L, x + i, g + 3);
      for (let i = 13; i <= 17; i++) GEN.ground(b.L, x + i, g);
      b.L.fill(x + 18, GEN.H - 2, x + 23, GEN.H - 1, 'W');
      GEN.sign(b, x + 1, 'Speedy thing goes in, speedy thing comes out! Portal the pit floor and the chasm edge, then jump in from the top.');
      GEN.coinArc(b, x + 17, 7, g - 9, 3);
      b.x += 24;
      GEN.flatGround(b, 4);
      b.x += 4;
    },
    // Low tunnel with a brute: drop it into the water through a floor portal and the
    // underside of the stone ledge above the pool.
    enemyDrop(b) {
      const g = b.g, x = b.x;
      GEN.flatGround(b, 3);
      b.L.fill(x + 3, g + 1, x + 6, GEN.H - 1, 'W');
      b.L.fill(x + 2, g - 6, x + 7, g - 6, '=');
      for (let i = 7; i <= 21; i++) GEN.ground(b.L, x + i, g);
      b.L.fill(x + 8, g - 6, x + 18, g - 3, 'M');
      b.L.add('brute', x + 15, g - 1);
      if (b.d > 0) b.L.add('goblin', x + 11, g - 1);
      GEN.coinArc(b, x + 10, 6, g - 1, 0);
      GEN.sign(b, x + 1, 'Monsters fall into portals too. Try the tunnel floor and the ledge above the water.');
      b.x += 22;
    },
    // Turret shooting left; a gate of cracked bricks. Redirect its fire with portals:
    // A on the right face of the left stump, B on the right face of the stone block near the gate.
    turretGate(b) {
      const g = b.g, x = b.x;
      b.signs = true;
      GEN.flatGround(b, 17);
      b.L.fill(x + 1, g - 2, x + 1, g - 1, '=');
      b.L.set(x + 5, g - 1, 'M');
      b.L.add('turret', x + 5, g - 2);
      b.L.fill(x + 9, g - 2, x + 9, g - 1, '=');
      b.L.fill(x + 13, 0, x + 13, g - 6, 'M');
      b.L.fill(x + 13, g - 5, x + 13, g - 1, 'C');
      if (b.d === 1) GEN.sign(b, x - 1, 'Cracked bricks hate fire. Make the turret shoot where you want with portals.');
      b.signs = b.d === 0;
      GEN.coinArc(b, x + 10, 2, g - 1, 0);
      b.x += 17;
    },
    plantLedge(b) {
      const w = 15, g = b.g, x = b.x;
      GEN.flatGround(b, w);
      const p1 = 4, p2 = 10, h1 = b.R.int(2, 3), h2 = b.R.int(1, 3);
      b.L.fill(x + p1, g - h1, x + p1 + 1, g - 1, '=');
      b.L.fill(x + p2, g - h2, x + p2 + 1, g - 1, '=');
      b.L.add('plant', x + p1, g - h1 - 1);
      if (b.d > 0 || b.R.chance(0.5)) b.L.add('plant', x + p2 + 1, g - h2 - 1);
      GEN.coinArc(b, x + p1 + 2, p2 - p1 - 2, g - 4, 1);
      if (b.d === 0) GEN.sign(b, x + 1, 'Plants spit fire. Send their fireballs back through your portals!');
      b.x += w;
    },
    waterPlatforms(b) {
      const g = b.g, x = b.x;
      GEN.flatGround(b, 2);
      b.L.fill(x + 2, g + 1, x + 11, GEN.H - 1, 'W');
      b.L.fill(x + 4, g, x + 5, g, '=');
      b.L.fill(x + 8, g, x + 9, g, 'X');
      for (let i = 12; i <= 14; i++) GEN.ground(b.L, x + i, g);
      GEN.coinArc(b, x + 3, 9, g - 3, 2);
      if (b.d > 0) b.L.add('bat', x + 7, g - 6);
      if (b.d > 1) b.L.add('eye', x + 10, g - 8);
      b.x += 15;
    },
    fireRun(b) {
      const g = b.g, x = b.x, w = 17;
      GEN.flatGround(b, w);
      b.L.fill(x + 4, g - 1, x + 5, g - 1, 'F');
      b.L.set(x + 11, g - 1, 'F');
      b.L.fill(x + 6, g - 7, x + 15, g - 7, 'M');
      b.L.add('spikeball', x + 8, g - 6);
      b.L.add('spikeball', x + 13, g - 6);
      GEN.coinArc(b, x + 7, 3, g - 3, 1);
      GEN.enemies(b, x + 14, 2, b.d);
      b.x += w;
    },
    batZone(b) {
      const w = 15;
      GEN.flatGround(b, w);
      b.L.add('bat', b.x + 5, b.g - 6);
      if (b.d > 0) b.L.add('bat', b.x + 11, b.g - 8);
      if (b.d > 0 || b.R.chance(0.5)) b.L.add('eye', b.x + 9, b.g - 9);
      GEN.coinArc(b, b.x + 3, 9, b.g - 5, 2);
      GEN.decor(b, b.x, w);
      b.x += w;
    },
    // Stone overhang with two cracked bricks: bump them, then portal into the alcove above
    // (its stone ceiling is visible through the hole).
    crackedCeiling(b) {
      const g = b.g, x = b.x, w = 14;
      GEN.flatGround(b, w);
      b.L.fill(x + 3, g - 5, x + 10, g - 5, '=');
      b.L.fill(x + 6, g - 5, x + 7, g - 5, 'C');
      b.L.fill(x + 3, g - 10, x + 3, g - 6, 'M');
      b.L.fill(x + 10, g - 10, x + 10, g - 6, 'M');
      b.L.fill(x + 4, g - 10, x + 9, g - 10, '=');
      b.L.fill(x + 3, g - 11, x + 10, g - 11, 'M');
      GEN.coinArc(b, x + 4, 2, g - 6, 0);
      GEN.coinArc(b, x + 8, 2, g - 6, 0);
      b.L.add('chest', x + 5, g - 6);
      b.L.add('secret', x + 6, g - 7);
      b.L.add('coin', x + 6, g - 2); b.L.add('coin', x + 7, g - 2);
      b.x += w;
    },
    // Closed metal room high up with a grate floor and a stone ceiling.
    secretRoom(b) {
      const g = b.g, x = b.x, w = 14;
      GEN.flatGround(b, w);
      b.L.fill(x + 3, g - 10, x + 3, g - 6, 'M');
      b.L.fill(x + 10, g - 10, x + 10, g - 6, 'M');
      b.L.fill(x + 4, g - 10, x + 9, g - 10, '=');
      b.L.fill(x + 4, g - 6, x + 9, g - 6, 'G');
      b.L.fill(x + 3, g - 11, x + 10, g - 11, 'M');
      GEN.coinArc(b, x + 4, 6, g - 7, 0);
      b.L.add(b.R.pick(['chest', 'chest', 'heart']), x + 6, g - 7);
      b.L.add('secret', x + 7, g - 8);
      GEN.decor(b, x, w);
      b.x += w;
    },
    checkpoint(b) {
      GEN.flatGround(b, 6);
      b.L.add('checkpoint', b.x + 3, b.g - 1);
      b.x += 6;
    },
    end(b) {
      GEN.flatGround(b, 16);
      b.L.add('exit', b.x + 9, b.g - 1);
      GEN.decor(b, b.x, 6);
      b.L.add('torch', b.x + 7, b.g - 1);
      b.L.add('torch', b.x + 12, b.g - 1);
      b.x += 16;
    },
    // Closed arena with a stone ceiling full of spike balls. The boss can only be hurt by
    // fireballs (its own, redirected), plasma and falling spike balls.
    bossArena(b) {
      const g = b.g, x = b.x, w = 36;
      GEN.flatGround(b, w);
      b.L.fill(x, 0, x, g - 5, 'M');
      b.L.fill(x + 1, g - 12, x + 34, g - 12, '=');
      b.L.fill(x + 1, 0, x + 34, g - 13, 'M');
      b.L.fill(x + 35, 0, x + 35, g - 1, '=');
      b.L.fill(x + 7, g - 5, x + 9, g - 5, '=');
      b.L.fill(x + 26, g - 5, x + 28, g - 5, '=');
      for (const sx of [6, 12, 18, 24, 30]) b.L.add('spikeball', x + sx, g - 11, { respawn: 1 });
      b.L.add('plasma', x + 3, g - 1);
      b.L.add('boss', x + 24, g - 1);
      b.L.add('exit', x + 32, g - 1, { boss: 1 });
      b.L.add('torch', x + 2, g - 1); b.L.add('torch', x + 33, g - 1);
      b.x += w;
    }
  }
};

if (typeof module !== 'undefined') module.exports = { GEN };
