'use strict';
// Game flow: levels, lives, score, camera, events from the world, title scene.

const GAME = {
  state: 'title',          // title | play | pause | complete | gameover | victory | editor
  world: null,
  cam: { x: 0, y: 0 },
  levelIndex: 0, lives: 3, score: 0, coins: 0, time: 0,
  msg: null, checkpoint: null, carry: null, test: false,
  cache: [],

  // ---- levels ----
  customKey: i => 'spg.level.' + (i + 1),
  hasCustom(i) { try { return !!localStorage.getItem(GAME.customKey(i)); } catch (e) { return false; } },
  // Level files: levels/world1.json ... world3.json (same format as the editor's Export). They are
  // read once at start with fetch, so they need the game to be served over http (for example XAMPP
  // at http://localhost/...): browsers do not let a page opened from file:// read other files.
  files: [null, null, null],
  loadFiles() {
    return Promise.all([0, 1, 2].map(i =>
      fetch('levels/world' + (i + 1) + '.json', { cache: 'no-cache' })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (!j) return;
          try { Level.fromJSON(j); GAME.files[i] = j; } catch (e) { console.warn('Invalid level file world' + (i + 1) + '.json', e); }
        })
        .catch(() => { })));
  },
  hasFile(i) { return !!GAME.files[i]; },
  // Where the level of world i comes from: the editor's saved version, a levels/*.json file, or the generator
  source(i) { return GAME.hasCustom(i) ? 'custom' : GAME.hasFile(i) ? 'file' : 'procedural'; },
  getLevel(i) {
    try {
      const s = localStorage.getItem(GAME.customKey(i));
      if (s) return Level.fromJSON(JSON.parse(s));
    } catch (e) { console.warn('Bad custom level', e); }
    if (GAME.files[i]) return Level.fromJSON(GAME.files[i]);
    if (!GAME.cache[i]) GAME.cache[i] = GEN.generate(i);
    return GAME.cache[i];
  },
  // Progress saved in the browser: unlocked worlds, best score and "completed" flag per world.
  // Opening the page with ?unlock in the address bar unlocks everything (worlds and level editor).
  devUnlock: /[?&]unlock(&|$)/.test(location.search),
  progress() {
    if (GAME.devUnlock) return { unlocked: 3, best: [0, 0, 0], done: [true, true, true] };
    try {
      const p = JSON.parse(localStorage.getItem('spg.progress')) || { unlocked: 1, best: [0, 0, 0] };
      if (!p.done) p.done = [0, 1, 2].map(i => (p.best && p.best[i] > 0));   // saves from before the flag existed
      return p;
    } catch (e) { return { unlocked: 1, best: [0, 0, 0], done: [false, false, false] }; }
  },
  // the level editor opens when all 3 worlds have been completed
  editorUnlocked() { const d = GAME.progress().done; return !!d && d[0] && d[1] && d[2]; },
  saveProgress(p) { try { localStorage.setItem('spg.progress', JSON.stringify(p)); } catch (e) { } },
  levelLabel() { return 'WORLD ' + (GAME.levelIndex + 1) + ' - ' + GAME.levelData.name.toUpperCase(); },

  newGame(i) {
    GAME.lives = 3; GAME.score = 0; GAME.coins = 0; GAME.carry = null; GAME.test = false;
    GAME.startLevel(i);
  },
  testLevel(L, i) {
    GAME.lives = 99; GAME.score = 0; GAME.coins = 0; GAME.carry = null; GAME.test = true;
    GAME.startLevel(i, L);
  },
  startLevel(i, L) {
    GAME.levelIndex = i;
    GAME.levelData = L || GAME.getLevel(i);
    GAME.checkpoint = null;
    GAME.time = 0;
    GAME.spawn();
    GAME.state = 'play';
    GAME.flash(GAME.levelData.name.toUpperCase(), 'World ' + (i + 1) + (GAME.test ? ' - test play (ESC returns to the editor)' : ''), '#fff', 3);
    UI.show(null);
  },
  spawn() {
    const w = new World(GAME.levelData);
    let s = GAME.checkpoint || GAME.levelData.ents.find(e => e.t === 'start') || { x: 2, y: 10 };
    const p = new Player((s.x + 0.5) * TILE, (s.y + 1) * TILE);
    if (GAME.carry) { p.maxHp = GAME.carry.maxHp; p.plasma = GAME.carry.plasma; }
    p.hp = p.maxHp;
    p.world = w;
    w.player = p;
    w.ents.unshift(p);
    GAME.world = w;
    GAME.snapCam();
  },

  flash(text, sub, color, t) { GAME.msg = { text, sub, color, t: t || 2 }; },

  // ---- per frame ----
  update(dt, input) {
    if (GAME.state === 'title') return TITLE.update(dt);
    if (GAME.state !== 'play') return;
    const w = GAME.world;
    if (!w.player.won && !w.player.dying) GAME.time += dt;
    if (GAME.msg) GAME.msg.t -= dt;
    w.bubble = null;
    w.update(dt, input);
    for (const ev of w.events) GAME.onEvent(ev);
    w.events.length = 0;
    GAME.updateCam(dt, input);
    if (GAME.endT !== undefined) {
      GAME.endT -= dt;
      if (GAME.endT <= 0) { GAME.endT = undefined; GAME.levelDone(); }
    }
  },
  onEvent(ev) {
    const w = GAME.world, p = w.player;
    switch (ev.type) {
      case 'jump': SFX.jump(); break;
      case 'stomp': SFX.stomp(ev.kill); break;
      case 'hurt': if (!GAME.world.player.dying) SFX.hurt(); break;
      case 'dying': SFX.dying(); SFX.sadTune(); break;
      case 'explode': SFX.explode(); break;
      case 'shoot': SFX.portal(ev.c); break;
      case 'portalOpen': SFX.portalOpen(ev.c); break;
      case 'spikeShake': case 'spikeDrop': case 'spikeLand': {
        // the spike balls' sounds fade with distance from the hero (inaudible beyond ~620 px)
        const d = Math.hypot(ev.x - p.cx, ev.y - p.cy);
        if (d < 620) SFX.quiet(0.25 + 0.75 * (1 - d / 620), () => ev.type === 'spikeShake' ? SFX.spikeShake(SPIKE_SHAKE) : ev.type === 'spikeDrop' ? SFX.spikeDrop() : SFX.spikeLand());
        break;
      }
      case 'enemyShot': case 'enemyHit': {
        // sounds of enemy shots fade with the distance from the hero and are inaudible beyond ~620 px
        const d = Math.hypot(ev.x - p.cx, ev.y - p.cy);
        if (d < 620) SFX.quiet(0.25 + 0.75 * (1 - d / 620), () => ev.type === 'enemyShot' ? SFX.enemyShot(ev.kind, ev.big) : SFX.enemyHit(ev.kind));
        break;
      }
      case 'powerSpawn': SFX.powerSpawn(ev.kind); break;
      case 'powerGet': SFX.powerGet(ev.kind); break;
      case 'warp':
        if (ev.mine) SFX.warp(1);
        else {
          // a monster goes through a portal: same sound, quieter and a bit higher, fading with distance
          const d = Math.hypot(ev.x - p.cx, ev.y - p.cy);
          if (d < 520) SFX.warp(0.55 * (1 - d / 520), true);
        }
        break;
      case 'coin':
        SFX.coin();
        GAME.coins += ev.n; GAME.score += 10 * ev.n;
        if (ev.n > 1) w.text(ev.x, ev.y, '+' + ev.n, '#ffe27a');
        if (GAME.coins >= 100) { GAME.coins -= 100; GAME.lives++; w.text(p.cx, p.y - 10, '1-UP!', '#7f7'); GAME.flash('1-UP!', '100 coins', '#7f7'); }
        break;
      case 'score': GAME.score += ev.n; w.text(ev.x, ev.y, '' + ev.n); break;
      case 'kill':
        GAME.score += ev.n;
        w.text(ev.x, ev.y, '' + ev.n);
        if (ev.portal) { GAME.score += 250; GAME.flash('PORTAL KILL!', '+250', '#9fe0ff', 1.4); }
        break;
      case 'secret': GAME.score += 500; GAME.flash('SECRET FOUND!', '+500', '#ffe27a'); break;
      case 'secretBlock': GAME.score += 100; w.text(p.cx, p.y - 20, 'HIDDEN BLOCK!', '#ffe27a'); break;
      case 'power': w.text(ev.x, ev.y - 10, ev.text, '#9fe0ff'); break;
      case 'checkpoint':
        if (!GAME.checkpoint || GAME.checkpoint.x !== ev.x) { GAME.checkpoint = { x: ev.x, y: ev.y }; SFX.checkpoint(); GAME.flash('CHECKPOINT', '', '#ffcf60', 1.5); }
        break;
      case 'bossWake': GAME.flash('THE DARK KNIGHT AWAKENS', 'Only fire, plasma and spike balls can hurt him. Use your portals!', '#e8c8ff', 3.5); break;
      case 'bossHit': if (ev.portal) GAME.flash('PORTAL STRIKE!', '', '#9fe0ff', 1); break;
      case 'bossDefeated': w.bossDone = true; GAME.flash('THE DARK KNIGHT FALLS!', 'The exit is open', '#ffe27a', 3); break;
      case 'dead':
        GAME.lives--;
        if (GAME.lives < 0) { GAME.state = 'gameover'; UI.gameOver(); }
        else { GAME.carry = { maxHp: p.maxHp, plasma: 0 }; GAME.spawn(); GAME.flash('LIVES × ' + GAME.lives, '', '#fff', 1.5); }
        break;
      case 'exit':
        p.won = true;
        GAME.endT = 2.1;   // long enough for the door sequence and the fanfare
        SFX.victory();
        GAME.flash('LEVEL CLEAR!', '', '#7f7', 2);
        break;
      case 'splash': SFX.splash(); break;
      case 'bossGrunt': SFX.bossGrunt(); break;
      case 'bossBurn': SFX.bossBurn(BOSS_BURN); break;
      case 'bossExplode': SFX.bossExplode(); break;
      case 'bossStep': SFX.bossStep(); break;
      case 'bossJump': SFX.bossJump(); break;
      case 'bossLand': SFX.bossLand(); break;
      case 'plasmaShot': SFX.plasmaShot(); break;
      case 'plasmaHit': SFX.plasmaHit(ev.how); break;
      case 'doorOpen': SFX.doorOpen(); break;
      case 'doorClose': SFX.doorClose(); break;
    }
  },
  levelDone() {
    const w = GAME.world, p = w.player;
    const timeBonus = Math.max(0, Math.floor(300 - GAME.time)) * 10;
    const secretBonus = w.secretsFound * 1000;
    GAME.score += timeBonus + secretBonus;
    GAME.carry = { maxHp: p.maxHp, plasma: p.plasma };
    if (GAME.test) { EDITOR.open(GAME.levelIndex, true); return; }
    const pr = GAME.progress();
    pr.unlocked = Math.max(pr.unlocked, Math.min(3, GAME.levelIndex + 2));
    pr.best[GAME.levelIndex] = Math.max(pr.best[GAME.levelIndex] || 0, GAME.score);
    pr.done[GAME.levelIndex] = true;
    const first = !GAME.editorUnlocked();
    GAME.saveProgress(pr);
    GAME.justUnlockedEditor = first && GAME.editorUnlocked();
    GAME.state = GAME.levelIndex >= 2 ? 'victory' : 'complete';
    const stats = { time: Math.floor(GAME.time), timeBonus, secrets: w.secretsFound, secretsTotal: w.secretsTotal, secretBonus, last: GAME.levelIndex >= 2, editor: GAME.justUnlockedEditor };
    // after the last door: the triumph screen first, then the score breakdown
    if (stats.last) UI.victory(stats); else UI.levelComplete(stats);
  },
  nextLevel() { GAME.startLevel(GAME.levelIndex + 1); },

  // ---- camera ----
  camTarget(input) {
    const p = GAME.world.player, L = GAME.world.L;
    let lx = 0, ly = 0;
    if (input && input.sx !== undefined) {
      lx = U.clamp((input.sx - VIEW_W / 2) * 0.22, -120, 120);
      ly = U.clamp((input.sy - VIEW_H / 2) * 0.3, -110, 90);
    }
    return [U.clamp(p.cx - VIEW_W / 2 + lx, 0, L.w * TILE - VIEW_W), U.clamp(p.cy - VIEW_H * 0.6 + ly, 0, L.h * TILE - VIEW_H)];
  },
  snapCam() { const [x, y] = GAME.camTarget(); GAME.cam.x = x; GAME.cam.y = y; },
  updateCam(dt, input) {
    const [x, y] = GAME.camTarget(input);
    const k = 1 - Math.exp(-dt * 7);
    GAME.cam.x += (x - GAME.cam.x) * k;
    GAME.cam.y += (y - GAME.cam.y) * k;
  },

  // ---- drawing ----
  drawWorld(ctx, w, cam, opts) {
    opts = opts || {};
    const L = w.L;
    const sh = w.shake;
    const cx = Math.round(cam.x + (Math.random() - 0.5) * sh), cy = Math.round(cam.y + (Math.random() - 0.5) * sh);
    const horizonY = (opts.horizon || GEN.BASE_G) * TILE - cy;
    if (!opts.noBg) RENDER.background(ctx, w.theme, cx, horizonY, true);
    ctx.save();
    ctx.translate(-cx, -cy);
    const view = { x: cx, y: cy };
    for (const e of w.ents) if (e.decor) e.draw(ctx, w);
    RENDER.tiles(ctx, L, w.theme, view, w, w.time, false);
    for (const p of w.portals) if (p) RENDER.portal(ctx, p, w.time);
    for (const e of w.ents) if (!e.decor && !e.isPlayer && e.x + e.w > cx - 64 && e.x < cx + VIEW_W + 64) e.draw(ctx, w);
    if (w.player) w.player.draw(ctx, w);
    RENDER.water(ctx, L, view, w.time, w);
    RENDER.shots(ctx, w.shots);
    RENDER.particles(ctx, w.fx);
    if (w.player && !opts.noAim) RENDER.aim(ctx, w, w.player);
    if (w.bubble) RENDER.bubble(ctx, w.bubble);
    ctx.restore();
    if (!opts.noBg) AMB.front(ctx, w.theme, cx, horizonY, performance.now() / 1000);   // leaves, dust and mist in front of the level
  },
  draw(ctx) {
    if (GAME.state === 'title') return TITLE.draw(ctx);
    if (GAME.state === 'editor') return EDITOR.draw(ctx);
    if (!GAME.world) return;
    GAME.drawWorld(ctx, GAME.world, GAME.cam);
    RENDER.hud(ctx, GAME);
  }
};

// ======================= Title scene =======================
// A small room where the hero runs, jumps and shoots portals by himself.
const TITLE = {
  world: null, t: 0,
  init() {
    const L = new Level(30, 17, 0);
    L.fill(0, 14, 29, 16, '#');
    L.fill(0, 4, 0, 13, '=');
    L.fill(29, 4, 29, 13, '=');
    L.fill(0, 0, 29, 3, '.');
    for (const [t, x] of [['bush', 3], ['rock', 9], ['bush', 21], ['fence', 25], ['torch', 14]]) L.add(t, x, 13);
    for (let i = 0; i < 5; i++) L.add('coin', 12 + i, 10);
    const w = new World(L);
    const p = new Player(300, 14 * TILE);
    p.world = w; w.player = p; w.ents.unshift(p);
    p.hp = 99;
    TITLE.world = w; TITLE.t = 0;
  },
  input() {
    const w = TITLE.world, p = w.player;
    const t = TITLE.t % 13;
    const inp = { mx: p.cx + p.face * 200, my: p.cy };
    const at = (a, b) => t >= a && t < b;
    const aimAt = (x, y) => { inp.mx = x; inp.my = y; };
    if (at(0, 0.6)) aimAt(29 * TILE, 12 * TILE);
    if (at(0.45, 0.5)) inp.fire0 = true;
    if (at(0.8, 0.85)) { inp.jumpPressed = true; }
    if (at(0.8, 1.2)) inp.jump = true;
    if (at(0.9, 1.4)) aimAt(TILE, 12.5 * TILE);
    if (at(1.1, 1.15)) inp.fire1 = true;
    if (at(1.6, 6.8)) { inp.right = true; }
    if (at(3.2, 3.25) || at(5.4, 5.45)) { inp.jumpPressed = true; inp.jump = true; }
    if (at(6.8, 7.5)) aimAt(Math.min(27, Math.floor(p.cx / TILE) + 5) * TILE, 14 * TILE);
    if (at(7.2, 7.25)) inp.fire0 = true;
    if (at(7.5, 8.1)) aimAt(29 * TILE, 6 * TILE);
    if (at(7.8, 7.85)) inp.fire1 = true;
    if (at(8.3, 10.5)) inp.right = true;
    if (at(10.6, 11.6)) { inp.left = true; aimAt(p.cx - 300, p.cy - 120); }
    if (at(11.0, 11.05)) { inp.jumpPressed = true; inp.jump = true; }
    if (at(12.5, 12.55)) w.clearPortals();
    return inp;
  },
  update(dt) {
    if (!TITLE.world) TITLE.init();
    TITLE.t += dt;
    const w = TITLE.world;
    w.update(dt, TITLE.input());
    // the demo hero's jumps and shots, quietly in the background
    for (const ev of w.events) {
      if (ev.type === 'jump') SFX.quiet(0.35, SFX.jump);
      else if (ev.type === 'shoot') SFX.quiet(0.35, () => SFX.portal(ev.c));
      else if (ev.type === 'portalOpen') SFX.quiet(0.35, () => SFX.portalOpen(ev.c));
    }
    w.events.length = 0;
    const p = w.player;
    if (p.y > 16 * TILE || p.x < -40 || p.x > 30 * TILE) { p.x = 300; p.y = 14 * TILE - p.h; p.vx = p.vy = 0; }
    // respawn the coins now and then
    if (!w.ents.some(e => e.kind === 'coin')) for (let i = 0; i < 5; i++) w.add(new Pickup({ t: 'coin', x: 12 + i, y: 10 }));
  },
  draw(ctx) {
    if (!TITLE.world) TITLE.init();
    const w = TITLE.world;
    GAME.drawWorld(ctx, w, { x: 0, y: 4 }, { noAim: true, horizon: 14 });
  }
};
