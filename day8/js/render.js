'use strict';

// Canvas drawing: tiles, sprites, lighting with fog of war, animations and effects.
const Render = (() => {
  const { T, W, H, idx } = Dungeon;
  const MOVE_TIME = 110;
  const LUNGE_TIME = 170;
  const STAGGER = 90;          // pause between attacks of different monsters
  const SHOT_SPEED = 0.05;     // ms per cell is 1 / this
  const FADE_TIME = 650;       // fade in after changing level
  const HERO_LIGHT = 7.2;
  const TORCH_LIGHT = 4.6;
  const LAVA_LIGHT = 2.6;      // radius of the light around each lava cell
  const SHADOW_REACH = 5.5;    // lights farther than this cast no shadow
  const PRINT_TURNS = 10;      // footprints fade away in so many turns
  const MAX_PARTS = 500;       // particles at most
  const REVEAL_SPEED = 0.025;  // cells per ms of the mapping wave
  const EYES_RANGE = 11;       // lurking monsters show their eyes this close
  const WOUNDED = 0.3;         // monsters below this share of HP tremble and blink red
  const FLOATERS = { ghost: 1, bat: 1, eyeball: 1, shade: 1 };
  // how much each plant bends in the wind
  const SWAY = { bush: 0.07, tree: 0.035, pine: 0.03, frost: 0.025 };
  // heavier armour gives the hero a metal (or dragon scale) sheen: [filter, strength]
  const ARMOR_TINT = {
    chainmail: ['grayscale(1) brightness(1.4)', 0.22], scale: ['grayscale(1) brightness(1.3)', 0.28],
    plate: ['grayscale(1) brightness(1.55) contrast(1.2)', 0.34], dragon: ['sepia(1) hue-rotate(70deg) saturate(3) brightness(0.9)', 0.32],
  };
  // colour of each kind of light: rgb for the glow, and the tint it gives to the half dark
  const LIGHT_COLORS = {
    torch: { glow: '255,140,50', tint: [110, 45, 0] },
    candle: { glow: '255,215,120', tint: [80, 60, 10] },
    merchant: { glow: '255,190,80', tint: [90, 60, 0] },
    crystal: { glow: '110,190,255', tint: [0, 45, 110] },
    lava: { glow: '255,80,20', tint: [120, 20, 0] },
    fireball: { glow: '255,130,40', tint: [130, 50, 0], r: 3.4 },
    bolt: { glow: '190,140,255', tint: [70, 30, 120], r: 2.8 },
    poison_bolt: { glow: '130,255,90', tint: [20, 100, 10], r: 2.4 },
    magic: { glow: '190,120,255', tint: [60, 20, 110], r: 3 },
    sparkle: { glow: '255,240,150', tint: [80, 70, 20], r: 2.4 },
    teleport: { glow: '150,120,255', tint: [40, 30, 120], r: 2.8 },
    explosion: { glow: '255,150,60', tint: [120, 50, 0], r: 3 },
    fire: { glow: '255,120,40', tint: [120, 40, 0], r: 2.6 },
    ice: { glow: '150,220,255', tint: [20, 70, 110], r: 2.4 },
    poison: { glow: '120,255,90', tint: [20, 90, 10], r: 2 },
    gold: { glow: '255,215,90', tint: [90, 70, 10], r: 3 },
    sleep: { glow: '190,140,255', tint: [50, 25, 100], r: 4 },
  };
  const decorColor = (o) => LIGHT_COLORS[o.kind === 'crystals' ? 'crystal' : o.kind] || LIGHT_COLORS.candle;
  const AMBIENT = 0.16;
  const REMEMBERED = 0.8;      // darkness of cells seen before but not in view
  const ITEM_SPRITES = { coins: 'coins', gem: 'gem', crown: 'crown', potion: 'potion', scroll: 'scroll', ring: 'ring', heart: 'heart', artifact: 'artifact', pickaxe: 'pickaxe', hourglass: 'hourglass' };
  const TRAP_SPRITES = { spikes: 'spikes', fire: 'fire', trap: 'trap', teleport: 'teleport', pit: 'pit' };
  const SHOT_SPRITES = { arrow: 'arrow', bolt: 'bolt', fireball: 'fireball', poison_bolt: 'poison_bolt' };

  let cv, ctx, img, mini, mctx, mdata;
  let vw = 0, vh = 0, dpr = 1, tile = 48;
  const cam = { x: 0, y: 0, snap: true };
  let fx = [], shots = [], jobs = [];
  let busyUntil = 0, fadeStart = -1e9, shake = { t0: -1e9, mag: 0 };
  let lm, lctx, ldata;
  let last = 0;
  let mist = null;            // tileable mist texture, made once
  let parts = [];             // particles: embers, dust, snow, fireflies, sand, ash
  let prints = new Map();     // footprints in snow and sand: cell -> { x, y, dx, dy, turn }
  const mapCache = new WeakMap(); // per map: lava cells and sun shafts
  let bats = [], nextBat = 0;     // bats flying over the dark, only for the mood
  let reveal = null;              // mapping wave: { t0, x, y, before }
  let grass = new Map();          // grass cells stepped on: cell -> last time someone stood there
  const veiled = (c, now) => !!reveal && !reveal.before[c] &&
    Math.hypot(c % W - reveal.x, ((c / W) | 0) - reveal.y) > (now - reveal.t0) * REVEAL_SPEED;

  function init(canvas, atlasImg, miniCanvas) {
    cv = canvas; ctx = cv.getContext('2d'); img = atlasImg;
    mini = miniCanvas; mctx = mini.getContext('2d');
    mini.width = W; mini.height = H; mdata = mctx.createImageData(W, H);
    lm = document.createElement('canvas'); lm.width = W; lm.height = H;
    lctx = lm.getContext('2d'); ldata = lctx.createImageData(W, H);
    resize();
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    tile = Math.max(30, Math.min(56, Math.round(Math.min(vw / 19, vh / 12.5))));
  }

  function spr(name, x, y, w = tile, h = w) {
    const p = ATLAS.sprites[name];
    if (!p) {
      const icon = Icons.get(name);
      if (icon) {
        // small pixel art: keep it crisp
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(icon, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
      }
      return;
    }
    const c = ATLAS.cell;
    ctx.drawImage(img, p[0] * c, p[1] * c, c, c, x, y, w, h);
  }

  // ---- events to animations ---------------------------------------------------

  function at(t, fn) { jobs.push({ t, fn }); }
  const busy = (now) => now < busyUntil || jobs.length > 0 || shots.length > 0;

  // hooks: { msg(text, cls), sound(name), hud(), dead(), level() }
  function play(s, events, hooks) {
    const now = performance.now();
    let t = now;
    let lastAttacker = null;
    for (const e of events) {
      switch (e.e) {
        case 'move':
          e.who.anim = { fx: e.from.x, fy: e.from.y, t0: t };
          e.who.hop = t;
          if (e.who !== s.hero && e.who.x !== e.from.x) e.who.flip = e.who.x < e.from.x;
          if (!FLOATERS[e.who.type] && s.vis[idx(e.from.x, e.from.y)]) { const f = e.from; at(t, () => puff(s, f.x, f.y, 2)); }
          if (e.who === s.hero) at(t, () => hooks.sound('step'));
          if (e.who === s.hero && soft(s, idx(e.from.x, e.from.y))) {
            prints.set(idx(e.from.x, e.from.y), { x: e.from.x, y: e.from.y, dx: e.who.x - e.from.x, dy: e.who.y - e.from.y, turn: s.turn });
          }
          busyUntil = Math.max(busyUntil, t + MOVE_TIME * 0.8);
          break;
        case 'teleport': {
          e.who.anim = null;
          e.who.appear = t + 150;
          const { from, to } = e;
          at(t, () => { sparks(from.x, from.y, 26, '170,200,255', false); sparks(to.x, to.y, 22, '170,200,255', true); });
          break;
        }
        case 'spell':
          spell(s, e, t);
          break;
        case 'cat':
          if (e.what === 'come') { e.who.appear = t; at(t, () => puff(s, e.x, e.y, 4, true)); }
          else if (e.what === 'go') {
            fx.push({ kind: 'fade', name: e.sprite || 'cat0', x: e.x, y: e.y, t0: t, dur: 600, rise: 0.2 });
            at(t, () => puff(s, e.x, e.y, 5, true));
          } else fx.push({ kind: 'rise', name: 'heart', x: e.x, y: e.y - 0.3, t0: t, dur: 900 });
          break;
        case 'dig':
          at(t + 60, () => { chips(e.x, e.y, s.theme.outdoor ? '90,150,60' : '150,140,160', 14); puff(s, e.x, e.y, 6, true); });
          shake = { t0: t + 60, mag: 3, dx: null, dy: null };
          break;
        case 'wish':
          fx.push({ kind: 'ring', x: e.x, y: e.y, t0: t + 150, dur: 700, r: 0.9, color: '140,200,255' });
          break;
        case 'summon':
          // the minion rises from a circle of runes
          fx.push({ kind: 'circle', x: e.x, y: e.y, t0: t, dur: 950, color: e.color || '255,70,110' });
          e.who.appear = t + 300;
          break;
        case 'lunge':
          if (e.who !== s.hero && lastAttacker !== e.who) { t += STAGGER; lastAttacker = e.who; }
          e.who.lunge = { dx: e.to.x - e.who.x, dy: e.to.y - e.who.y, t0: t };
          if (e.who !== s.hero) {
            // the monster faces its target, and the hero turns towards whoever attacks
            if (e.to.x !== e.who.x) e.who.flip = e.to.x < e.who.x;
            if (e.to.x === s.hero.x && e.to.y === s.hero.y) { const m = e.who; at(t, () => { s.hero.dir = facing(m.x - s.hero.x, m.y - s.hero.y); }); }
          }
          busyUntil = Math.max(busyUntil, t + LUNGE_TIME);
          break;
        case 'shoot': {
          const d = Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y);
          const dur = d / SHOT_SPEED;
          shots.push({ kind: e.kind, from: e.from, to: e.to, t0: t, dur });
          if (e.to.x === s.hero.x && e.to.y === s.hero.y && (e.from.x !== s.hero.x || e.from.y !== s.hero.y)) {
            const f = e.from;
            at(t, () => { s.hero.dir = facing(f.x - s.hero.x, f.y - s.hero.y); });
          }
          t += dur;
          break;
        }
        case 'hit':
          e.who.flash = t + LUNGE_TIME * 0.4;
          fx.push({ kind: 'sprite', name: 'blood', x: e.x, y: e.y, t0: t + 60, dur: 420, size: 0.7 });
          fx.push({ kind: 'text', text: (e.crit ? e.amount + '!' : '' + e.amount), cls: e.crit ? 'crit' : 'dmg', x: e.x, y: e.y, t0: t + 60, dur: 850 });
          break;
        case 'hurt':
          s.hero.flash = t + 60;
          fx.push({ kind: 'text', text: '-' + e.amount, cls: 'hurt', x: e.x, y: e.y, t0: t + 60, dur: 900 });
          at(t + 60, () => {
            // the screen is knocked away from where the blow came from
            const d = e.from ? Math.hypot(e.x - e.from.x, e.y - e.from.y) || 1 : 0;
            shake = { t0: performance.now(), mag: Math.min(9, 2 + e.amount * 0.6), dx: d ? (e.x - e.from.x) / d : null, dy: d ? (e.y - e.from.y) / d : null };
            hooks.hud();
          });
          break;
        case 'miss':
          fx.push({ kind: 'text', text: 'miss', cls: 'miss', x: e.x, y: e.y, t0: t + 60, dur: 700 });
          break;
        case 'die':
          death(s, e.who, t);
          break;
        case 'effect':
          fx.push({ kind: 'sprite', name: e.name, x: e.x, y: e.y, t0: t, dur: 520, size: e.name === 'magic' ? 1.1 : 0.95 });
          break;
        case 'float':
          fx.push({ kind: 'text', text: e.text, cls: e.cls, x: e.x, y: e.y, t0: t + 150, dur: 1100 });
          t += 60;
          break;
        case 'pickup':
          fx.push({ kind: 'rise', name: e.sprite || ITEM_SPRITES[e.kind], x: e.x, y: e.y, t0: t, dur: 700 });
          break;
        case 'chest':
          fx.push({ kind: 'fade', name: 'chest', x: e.x, y: e.y, t0: t, dur: 450 });
          break;
        case 'smash':
          fx.push({ kind: 'fade', name: e.kind, x: e.x, y: e.y, t0: t, dur: 350 });
          at(t, () => splinters(e.x, e.y, e.kind));
          break;
        case 'door':
          fx.push({ kind: 'door', x: e.x, y: e.y, t0: t, dur: 320 });
          at(t + 120, () => puff(s, e.x, e.y, 4, true));
          break;
        case 'alert':
          fx.push({ kind: 'icon', name: e.kind, follow: e.who, t0: t, dur: 900 });
          break;
        case 'spotted':
          fx.push({ kind: 'sprite', name: 'alert', x: e.x, y: e.y, t0: t, dur: 800, size: 0.6 });
          break;
        case 'trap':
          fx.push({ kind: 'sprite', name: TRAP_SPRITES[e.kind], x: e.x, y: e.y, t0: t, dur: 500, size: 1.1 });
          break;
        case 'level':
          fx = []; shots = []; parts = []; prints = new Map(); bats = []; nextBat = t + 5000; reveal = null; grass = new Map();
          s.hero.anim = null; s.hero.lunge = null;
          cam.snap = true;
          fadeStart = t;
          at(t, () => hooks.level());
          break;
        case 'dead':
          at(t + 400, () => hooks.dead());
          break;
        case 'won':
          fx.push({ kind: 'ring', x: s.hero.x, y: s.hero.y, t0: t, dur: 1200, r: 6, color: '255,215,90', light: 'gold' });
          at(t + 900, () => hooks.dead());
          break;
        case 'dread':
          // it seeps out of the floor, and the player has already sensed it
          e.who.appear = t;
          e.who.seenOnce = true;
          break;
        case 'shop':
          at(t + 120, () => hooks.shop());
          break;
        case 'msg':
          at(t, () => hooks.msg(e.text, e.cls));
          break;
        case 'sound':
          at(t, () => hooks.sound(e.name));
          break;
        case 'levelup':
        case 'mapped':
        case 'status':
          at(t, () => hooks.hud());
          break;
      }
    }
    at(t, () => hooks.hud());
  }

  // the screen flashes and ripples after the hourglass is turned
  let rewound = -1e9;
  const rewindFlash = () => { rewound = performance.now(); };

  function reset() {
    fx = []; shots = []; jobs = []; parts = []; prints = new Map(); bats = []; nextBat = performance.now() + 5000; reveal = null; grass = new Map(); busyUntil = 0; cam.snap = true; fadeStart = performance.now();
  }

  // ---- drawing ------------------------------------------------------------------

  function pos(e, now) {
    let x = e.x, y = e.y;
    if (e.anim) {
      const p = (now - e.anim.t0) / MOVE_TIME;
      if (p >= 1) e.anim = null;
      else if (p > 0) {
        const k = p * (2 - p);
        x = e.anim.fx + (e.x - e.anim.fx) * k; y = e.anim.fy + (e.y - e.anim.fy) * k;
      } else { x = e.anim.fx; y = e.anim.fy; }
    }
    if (e.lunge) {
      const p = (now - e.lunge.t0) / LUNGE_TIME;
      if (p >= 1) e.lunge = null;
      else if (p > 0) {
        const k = Math.sin(p * Math.PI) * 0.32;
        x += e.lunge.dx * k; y += e.lunge.dy * k;
      }
    }
    return { x, y };
  }

  const SHADE_FILTER = 'grayscale(1) sepia(1) hue-rotate(170deg) saturate(2.5) brightness(1.25)';

  function monsterSprite(m, now) {
    if (m.type === 'mimic') return 'chest';
    if (m.type === 'shade') return (m.past.cls || 'hero') + '_' + (m.dir || 'down');
    const frame = Math.floor((now + m.id * 137) / 420) % 2;
    return m.type + '_' + (m.look + frame * m.def.cols);
  }

  function frame(s, now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (let i = 0; i < jobs.length;) {
      if (jobs[i].t <= now) { const j = jobs.splice(i, 1)[0]; j.fn(); } else i++;
    }
    if (!s) return;
    const hp = pos(s.hero, now);
    if (cam.snap) { cam.x = hp.x; cam.y = hp.y; cam.snap = false; }
    const k = 1 - Math.exp(-dt * 9);
    cam.x += (hp.x - cam.x) * k; cam.y += (hp.y - cam.y) * k;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);

    let sx = 0, sy = 0;
    const sp = (now - shake.t0) / 260;
    if (sp < 1) {
      const m = shake.mag * (1 - sp);
      if (shake.dx !== null && shake.dx !== undefined) {
        const k = Math.cos(sp * Math.PI * 3) * m;
        sx = shake.dx * k + (Math.random() * 2 - 1) * m * 0.2;
        sy = shake.dy * k + (Math.random() * 2 - 1) * m * 0.2;
      } else { sx = (Math.random() * 2 - 1) * m; sy = (Math.random() * 2 - 1) * m; }
    }
    const ox = Math.round((vw / 2 - (cam.x + 0.5) * tile + sx) * dpr) / dpr;
    const oy = Math.round((vh / 2 - (cam.y + 0.5) * tile + sy) * dpr) / dpr;
    const x0 = Math.max(0, Math.floor(-ox / tile) - 1), y0 = Math.max(0, Math.floor(-oy / tile) - 1);
    const x1 = Math.min(W - 1, Math.ceil((vw - ox) / tile)), y1 = Math.min(H - 1, Math.ceil((vh - oy) / tile));
    const map = s.map, t = map.t;
    const th = s.theme;
    const extra = th.extra || [];
    const TS = tile + 0.5; // a hair of overlap hides the seams
    const water = [], lava = [];

    // tiles
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = idx(x, y);
        if (!s.seen[c] || veiled(c, now)) continue;
        const v = t[c], px = ox + x * tile, py = oy + y * tile;
        const vr = map.variant[c];
        if (v === T.WALL && th.outdoor) {
          // the edge of a clearing: ground with a thick plant on it
          spr(th.floor, px, py, TS);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(px, py, TS, TS);
          const plant = th.plants[vr % th.plants.length];
          const ps = tile * (1.05 + (vr % 5) * 0.04);
          sway(plant, px + (tile - ps) / 2 + ((vr >> 3) % 5 - 2) * tile * 0.03, py + tile - ps, ps, vr + x * 0.7, now);
          continue;
        }
        if (v === T.WALL) {
          spr('wall', px, py, TS);
          const below = y + 1 < H ? t[c + W] : T.VOID;
          if (below === T.WALL || below === T.VOID) {
            ctx.fillStyle = 'rgba(8,8,16,0.45)';
            ctx.fillRect(px, py, TS, TS);
          }
          continue;
        }
        const ground = th.outdoor && map.corridor[c] ? th.path : vr < 10 && extra.length ? extra[vr % extra.length] : th.floor;
        spr(ground, px, py, TS);
        // a slightly different shade per cell breaks the repetition
        ctx.fillStyle = 'rgba(0,0,0,' + (vr & 15) / 120 + ')';
        ctx.fillRect(px, py, TS, TS);
        if (v === T.WATER || v === T.LAVA) {
          spr(v === T.WATER ? 'water' : 'lava', px, py, TS);
          (v === T.WATER ? water : lava).push(c);
        } else if (v === T.DOOR) spr('door', px, py, TS);
        else if (v === T.OPEN) spr('portal', px, py, tile);
        else if (v === T.DOWN) spr('stairs_down', px, py, TS);
        else if (v === T.UP) spr('stairs_up', px, py, TS);
        if (v !== T.DOOR && v !== T.OPEN) wallDepth(t, x, y, px, py, th.outdoor);
      }
    }

    liquids(now, ox, oy, water, lava, TS);
    footprints(s, ox, oy);

    // things lying around
    if (reveal && now > reveal.t0 + 80 / REVEAL_SPEED) reveal = null;
    const onScreen = (o) => o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1 && s.seen[idx(o.x, o.y)] && !veiled(idx(o.x, o.y), now);
    for (const tr of s.traps.values()) {
      if (tr.known && onScreen(tr)) spr(TRAP_SPRITES[tr.kind], ox + tr.x * tile + tile * 0.08, oy + tr.y * tile + tile * 0.08, tile * 0.84);
    }
    for (const d of s.decor.values()) {
      if (!onScreen(d)) continue;
      if (d.plant) {
        const ps = tile * 1.15;
        sway(d.kind, ox + d.x * tile + (tile - ps) / 2, oy + d.y * tile + tile - ps, ps, d.x * 1.3 + d.y, now);
        continue;
      }
      if (d.kind === 'crystal' || d.kind === 'crystals') ctx.filter = 'brightness(' + (1.1 + 0.3 * Math.sin(now / 650 + d.x * 2 + d.y)) + ')';
      const k2 = d.block ? 1 : d.kind === 'web' ? 0.9 : 0.62;
      const px = ox + d.x * tile + tile * (1 - k2) / 2;
      const py = d.kind === 'web' ? oy + d.y * tile : oy + d.y * tile + tile * (1 - k2) * 0.8;
      if (d.searched || (d.well && !d.uses)) ctx.filter = 'brightness(0.6) saturate(0.6)';
      if (d.kind === 'web') web(s, d, px, py, tile * k2, now);
      else spr(d.kind, px, py, tile * k2);
      ctx.filter = 'none';
      if (d.nest && d.hp < d.maxHp) {
        const w = tile * 0.7, bx = ox + d.x * tile + (tile - w) / 2, by = oy + d.y * tile - tile * 0.02;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by - 1, w + 2, 5);
        ctx.fillStyle = '#e8c23a'; ctx.fillRect(bx, by, w * Math.max(0, d.hp / d.maxHp), 3);
      }
      // a coin purse floats over the merchant
      if (d.merchant) spr('coins', px + tile * 0.32, py - tile * 0.36 + Math.sin(now / 320) * tile * 0.05, tile * 0.36);
    }
    for (const c of s.chests.values()) if (onScreen(c)) spr('chest', ox + c.x * tile + tile * 0.06, oy + c.y * tile + tile * 0.04, tile * 0.88);
    for (const it of s.items.values()) {
      if (!onScreen(it)) continue;
      const bob = Math.sin(now / 300 + it.x + it.y) * tile * 0.04;
      spr(it.kind === 'gear' ? it.id : ITEM_SPRITES[it.kind], ox + it.x * tile + tile * 0.18, oy + it.y * tile + tile * 0.16 + bob, tile * 0.64);
    }
    for (const tc of s.torches) {
      if (!onScreen(tc)) continue;
      const f = 1 + Math.sin(now / 90 + tc.phase) * 0.04 + Math.sin(now / 37 + tc.phase * 3) * 0.03;
      const w = tile * 0.62 * f;
      spr('torch', ox + tc.x * tile + (tile - w) / 2, oy + tc.y * tile + tile * 0.98 - w, w);
    }

    // creatures, only where the hero can see
    const actors = s.monsters.filter(m => s.vis[idx(m.x, m.y)]).map(m => { m.seenOnce = true; return { e: m, p: pos(m, now) }; });
    if (s.cat && s.vis[idx(s.cat.x, s.cat.y)]) actors.push({ e: s.cat, p: pos(s.cat, now), cat: true });
    if (!s.over) actors.push({ e: s.hero, p: hp, hero: true });
    actors.sort((a, b) => a.p.y - b.p.y);
    for (const a of actors) {
      const px = ox + a.p.x * tile, py = oy + a.p.y * tile;
      const flip = !a.hero && a.e.type !== 'shade' && facesLeft(s, a.e);
      reflect(s, a, ox, oy, px, py, now, flip);
      shadow(s, a, px, py);
      // a little hop while stepping, a squash on landing; wounded monsters tremble
      let lift = 0, kx = 1, ky = 1;
      const q = a.e.hop ? (now - a.e.hop) / MOVE_TIME : 9;
      if (!FLOATERS[a.e.type] && q > 0 && q < 1) {
        const k = Math.sin(q * Math.PI);
        lift = k * tile * 0.08; ky = 1 + 0.05 * k; kx = 1 - 0.04 * k;
      } else if (!FLOATERS[a.e.type] && q >= 1 && q < 1.7) {
        const k = Math.sin((q - 1) / 0.7 * Math.PI);
        ky = 1 - 0.07 * k; kx = 1 + 0.06 * k;
      }
      const wounded = !a.hero && a.e.hp < a.e.maxHp * WOUNDED;
      const shake = wounded ? Math.sin(now / 23 + a.e.id) * tile * 0.018 : 0;
      const fx0 = px + tile / 2, fy0 = py + tile * 0.95;
      // fading in after a teleport or a summoning, growing out of the ground
      const ap = a.e.appear ? Math.max(0, Math.min(1, (now - a.e.appear) / 380)) : 1;
      if (ap >= 1) a.e.appear = 0;
      ctx.save();
      ctx.translate(fx0 + shake, fy0 - lift);
      ctx.scale(kx * (flip ? -1 : 1) * (0.5 + 0.5 * ap), ky * (0.3 + 0.7 * ap));
      ctx.translate(-fx0, -fy0);
      ctx.globalAlpha = ap;
      const flashing = a.e.flash && now < a.e.flash + 140 && now >= a.e.flash;
      if (flashing) ctx.filter = 'brightness(2.6) saturate(0.4)';
      if (a.hero) {
        const bob = Math.round(Math.sin(now / 260) * tile * 0.015);
        const h = a.e;
        if (h.invincible) {
          // golden aura, pulsing
          const r = tile * (0.55 + 0.04 * Math.sin(now / 150));
          const g = ctx.createRadialGradient(px + tile / 2, py + tile / 2, r * 0.3, px + tile / 2, py + tile / 2, r);
          g.addColorStop(0, 'rgba(255,220,90,0)');
          g.addColorStop(0.7, 'rgba(255,210,80,0.35)');
          g.addColorStop(1, 'rgba(255,200,60,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px - tile * 0.1, py - tile * 0.1, tile * 1.2, tile * 1.2);
        }
        if (h.invisible) ctx.globalAlpha = 0.32 + 0.08 * Math.sin(now / 200);
        heroBody(h, px, py + bob);
        ctx.globalAlpha = 1;
      } else if (a.cat) {
        // sitting, its tail swinging now and then
        spr('cat' + (Math.floor(now / 700) % 2), px + tile * 0.2, py + tile * 0.36, tile * 0.6);
      } else {
        const m = a.e;
        const float = (m.type === 'ghost' || m.type === 'bat' || m.type === 'eyeball' || m.type === 'shade') ? Math.sin(now / 240 + m.id) * tile * 0.05 - tile * 0.05 : 0;
        if (m.type === 'ghost') ctx.globalAlpha = 0.82;
        if (m.type === 'shade') {
          // the previous hero, pale blue and see-through
          ctx.globalAlpha = 0.62 + 0.12 * Math.sin(now / 300);
          if (!flashing) ctx.filter = SHADE_FILTER;
        }
        if (m.def.dread) {
          const bs = tile * 1.4, bx = px - (bs - tile) / 2, by = py - (bs - tile) * 0.92 + float;
          const g = ctx.createRadialGradient(px + tile / 2, py + tile * 0.5, 0, px + tile / 2, py + tile * 0.5, bs * 0.8);
          g.addColorStop(0, 'rgba(0,0,0,0.6)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px + tile / 2 - bs, py + tile * 0.5 - bs, bs * 2, bs * 2);
          ctx.globalAlpha = 0.92;
          if (!flashing) ctx.filter = 'brightness(0.14) saturate(0)';
          spr(monsterSprite(m, now), bx, by, bs);
          ctx.filter = 'none';
          ctx.globalCompositeOperation = 'lighter';
          for (const sx of [-1, 1]) glowAt(px + tile / 2 + sx * bs * 0.11, by + bs * 0.42, tile * 0.12, 1, '255,40,30');
          ctx.globalCompositeOperation = 'source-over';
        } else if (m.def.boss) {
          const bs = tile * Game.BOSS_SIZE;
          const g = ctx.createRadialGradient(px + tile / 2, py + tile * 0.6, 0, px + tile / 2, py + tile * 0.6, bs * 0.7);
          g.addColorStop(0, 'rgba(255,60,40,' + (0.22 + 0.08 * Math.sin(now / 260)) + ')');
          g.addColorStop(1, 'rgba(255,60,40,0)');
          ctx.fillStyle = g;
          ctx.fillRect(px + tile / 2 - bs, py + tile * 0.6 - bs, bs * 2, bs * 2);
          spr(monsterSprite(m, now), px - (bs - tile) / 2, py - (bs - tile) * 0.92 + float, bs);
          if (wounded && !flashing) hurtTint(monsterSprite(m, now), px - (bs - tile) / 2, py - (bs - tile) * 0.92 + float, bs, now, m.id);
        } else {
          if (m.def.hunter && !flashing) ctx.filter = 'hue-rotate(190deg) saturate(1.3) brightness(0.9)';
          // a mimic gnashes, bobbing up and down
          const gnash = m.type === 'mimic' ? Math.abs(Math.sin(now / 120 + m.id)) * tile * 0.06 : 0;
          spr(monsterSprite(m, now), px, py + float - gnash, tile);
          ctx.filter = 'none';
          if (wounded && !flashing) hurtTint(monsterSprite(m, now), px, py + float - gnash, tile, now, m.id);
          if (m.type === 'mimic') {
            ctx.fillStyle = '#f4f0e0';
            for (let i = 0; i < 5; i++) {
              const tx = px + tile * (0.24 + i * 0.12), ty = py + tile * 0.5 - gnash;
              ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + tile * 0.05, ty + tile * 0.09); ctx.lineTo(tx + tile * 0.1, ty); ctx.fill();
            }
            ctx.globalCompositeOperation = 'lighter';
            for (const sx of [0.36, 0.64]) glowAt(px + tile * sx, py + tile * 0.38 - gnash, tile * 0.07, 1, '255,60,40');
            ctx.globalCompositeOperation = 'source-over';
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.filter = 'none';
      if (!a.hero && !a.cat) {
        const m = a.e;
        if (m.peaceful) spr('heart', px + tile * 0.37, py - tile * 0.16 + Math.sin(now / 300 + m.id) * tile * 0.04, tile * 0.26);
        if (m.hp < m.maxHp && !m.def.boss) {
          const w = tile * 0.7, bx = px + (tile - w) / 2, by = py - tile * 0.02;
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by - 1, w + 2, 5);
          ctx.fillStyle = m.hp / m.maxHp > 0.5 ? '#7bd85b' : m.hp / m.maxHp > 0.25 ? '#e8c23a' : '#e34b3b';
          ctx.fillRect(bx, by, w * Math.max(0, m.hp / m.maxHp), 3);
        }
        if (m.asleep) {
          ctx.font = 'bold ' + Math.round(tile * 0.26) + 'px Consolas, monospace';
          ctx.fillStyle = 'rgba(190,200,255,' + (0.55 + 0.35 * Math.sin(now / 400 + m.id)) + ')';
          ctx.fillText('z', px + tile * 0.72, py + tile * 0.18 - (now / 40 + m.id * 10) % 8);
        }
      }
    }

    blades(s, actors, now, ox, oy);
    if (th.rays) rays(s, now, ox, oy);
    particles(s, dt, now, ox, oy, x0, y0, x1, y1, th);
    drawParts(s, ox, oy, false);
    heat(s, now, ox, oy, th);
    flares(s, dt, now);
    if (s.fog) fog(now, ox, oy, th);
    // under the lightmap, so the unexplored dark stays black
    if (s.night) dusk(s, ox, oy);
    light(s, now, ox, oy, hp, th);
    drawParts(s, ox, oy, true);
    flyingBats(s, dt, now, ox, oy, x0, y0, x1, y1, th);
    stairsCall(s, now, ox, oy);
    eyes(s, now, ox, oy);
    if (reveal) wave(now, ox, oy);

    // effects above the darkness
    for (const sh of shots) {
      const p = (now - sh.t0) / sh.dur;
      if (p < 0 || p > 1) continue;
      const x = sh.from.x + (sh.to.x - sh.from.x) * p, y = sh.from.y + (sh.to.y - sh.from.y) * p;
      const ang = Math.atan2(sh.to.y - sh.from.y, sh.to.x - sh.from.x);
      const lc = LIGHT_COLORS[sh.kind];
      if (lc) {
        ctx.globalCompositeOperation = 'lighter';
        glowAt(ox + (x + 0.5) * tile, oy + (y + 0.5) * tile, tile * 1.3, 0.45, lc.glow);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.save();
      ctx.translate(ox + (x + 0.5) * tile, oy + (y + 0.5) * tile);
      // arrow and bolt sprites point up, the others are drawn flying right
      ctx.rotate(sh.kind === 'arrow' ? ang + Math.PI / 2 : sh.kind === 'bolt' ? 0 : ang);
      spr(SHOT_SPRITES[sh.kind], -tile * 0.35, -tile * 0.35, tile * 0.7);
      ctx.restore();
    }
    shots = shots.filter(sh => now < sh.t0 + sh.dur);

    for (const f of fx) {
      const p = (now - f.t0) / f.dur;
      if (p < 0 || p > 1) continue;
      const cx = ox + (f.follow ? pos(f.follow, now).x : f.x) * tile, cy = oy + (f.follow ? pos(f.follow, now).y : f.y) * tile;
      if (f.kind === 'sprite' && LIGHT_COLORS[f.name]) {
        ctx.globalCompositeOperation = 'lighter';
        glowAt(cx + tile / 2, cy + tile / 2, tile * 1.8, 0.4 * (1 - p), LIGHT_COLORS[f.name].glow);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (f.kind === 'ring') {
        const r = f.r * tile * (1 - (1 - p) * (1 - p));
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(' + f.color + ',' + 0.75 * (1 - p) + ')';
        ctx.lineWidth = tile * (0.55 * (1 - p) + 0.08);
        ctx.beginPath(); ctx.arc(cx + tile / 2, cy + tile / 2, r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.kind === 'circle') {
        const k = p < 0.3 ? p / 0.3 : p > 0.7 ? (1 - p) / 0.3 : 1;
        const ccx = cx + tile / 2, ccy = cy + tile * 0.85, rx = tile * 0.55 * (0.5 + 0.5 * Math.min(1, p / 0.3)), ry = rx * 0.42;
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(' + f.color + ',' + 0.85 * k + ')';
        ctx.lineWidth = Math.max(1.5, tile / 24);
        for (const q of [1, 0.68]) { ctx.beginPath(); ctx.ellipse(ccx, ccy, rx * q, ry * q, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.fillStyle = 'rgba(' + f.color + ',' + k + ')';
        for (let i = 0; i < 6; i++) {
          const an = now / 500 + i * Math.PI / 3;
          ctx.fillRect(ccx + Math.cos(an) * rx * 0.84 - 2, ccy + Math.sin(an) * ry * 0.84 - 2, 4, 4);
        }
        glowAt(ccx, ccy, tile * 1.1, 0.35 * k, f.color);
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.kind === 'puddle') {
        if (!s.vis[idx(f.x, f.y)]) continue;
        ctx.fillStyle = 'rgba(' + f.color + ',' + 0.5 * (1 - p) + ')';
        ctx.beginPath();
        ctx.ellipse(cx + tile / 2, cy + tile * 0.86, tile * 0.4 * (0.5 + 0.5 * Math.min(1, p * 5)), tile * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (f.kind === 'flare') {
        const k = Math.sin(p * Math.PI);
        ctx.globalAlpha = k;
        const w = tile * 0.9, hh = tile * (0.7 + 1.5 * k);
        spr('fire', cx + (tile - w) / 2, cy + tile * 0.9 - hh, w, hh);
        ctx.globalCompositeOperation = 'lighter';
        glowAt(cx + tile / 2, cy + tile * 0.3, tile * 2.6, 0.35 * k, '255,120,40');
        ctx.globalCompositeOperation = 'source-over';
      } else if (f.kind === 'door') {
        // the door swings open on its hinge, on the left
        ctx.globalAlpha = 1 - p * 0.5;
        spr('door', cx, cy, tile * (1 - p * 0.85), tile);
      } else if (f.kind === 'sprite') {
        const sz = tile * f.size * (0.6 + 0.5 * Math.min(1, p * 2.5));
        ctx.globalAlpha = p < 0.6 ? 1 : (1 - p) / 0.4;
        spr(f.name, cx + (tile - sz) / 2, cy + (tile - sz) / 2, sz);
      } else if (f.kind === 'fade') {
        ctx.globalAlpha = 1 - p;
        if (f.filter) ctx.filter = f.filter;
        const fs = tile * (f.size || 1);
        const rise = f.rise ?? (f.filter ? 0.6 : -0.1);
        let w = fs, hh = fs, x = cx - (fs - tile) / 2, y = cy - (fs - tile) * 0.92 - p * tile * rise;
        // melt: flattens into the floor; stretch: thins out upwards; spin: tumbles
        if (f.melt) { hh = fs * (1 - p * 0.85); w = fs * (1 + p * 0.5); x -= (w - fs) / 2; y += fs - hh; }
        if (f.stretch) { hh = fs * (1 + p * 0.7); w = fs * (1 - p * 0.45); x += (fs - w) / 2; y -= hh - fs; }
        if (f.spin) {
          ctx.save();
          ctx.translate(x + w / 2, y + hh / 2);
          ctx.rotate(p * 5);
          spr(f.name, -w / 2, -hh / 2, w, hh);
          ctx.restore();
        } else spr(f.name, x, y, w, hh);
        ctx.filter = 'none';
      } else if (f.kind === 'rise') {
        ctx.globalAlpha = 1 - p * p;
        spr(f.name, cx + tile * 0.18, cy - p * tile * 0.7, tile * 0.64);
      } else if (f.kind === 'icon') {
        if (!s.vis[idx(f.follow.x, f.follow.y)]) continue;
        ctx.globalAlpha = p < 0.8 ? 1 : (1 - p) / 0.2;
        const pop = Math.min(1, p * 6);
        spr(f.name, cx + tile * 0.3, cy - tile * 0.42 - pop * tile * 0.06, tile * 0.42 * (0.6 + 0.4 * pop));
      } else if (f.kind === 'text') {
        ctx.globalAlpha = p < 0.65 ? 1 : (1 - p) / 0.35;
        const size = Math.round(tile * (f.cls === 'crit' || f.cls === 'lvl' ? 0.42 : 0.32));
        ctx.font = 'bold ' + size + 'px Consolas, "Lucida Console", monospace';
        ctx.textAlign = 'center';
        const tx = cx + tile / 2, ty = cy + tile * 0.1 - p * tile * 0.8;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(f.text, tx, ty);
        ctx.fillStyle = TEXT_COLORS[f.cls] || '#fff';
        ctx.fillText(f.text, tx, ty);
        ctx.textAlign = 'start';
      }
      ctx.globalAlpha = 1;
    }
    fx = fx.filter(f => now < f.t0 + f.dur);

    const fp = (now - fadeStart) / FADE_TIME;
    if (fp < 1) {
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - Math.max(0, fp)) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }
    vignette(th, s.night || 0);
    const rw = (now - rewound) / 900;
    if (rw >= 0 && rw < 1) {
      ctx.fillStyle = 'rgba(180,210,255,' + 0.55 * (1 - rw) + ')';
      ctx.fillRect(0, 0, vw, vh);
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.6 * (1 - rw) + ')';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(vw / 2, vh / 2, Math.hypot(vw, vh) * 0.5 * (1 - rw), 0, Math.PI * 2); ctx.stroke();
    }
    bossBar(s);
    minimap(s);
  }

  // dark edges around the screen, stronger in the darkest places
  function vignette(th, night) {
    const k = (th.outdoor ? 0.28 : th.name === 'Inferno' ? 0.5 : 0.42) + 0.25 * night;
    const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.38, vw / 2, vh / 2, Math.hypot(vw, vh) / 2);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + k + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);
  }

  // warm orange as the evening comes, then the blue of the night, over the map
  function dusk(s, ox, oy) {
    const k = s.night;
    const warm = Math.sin(Math.PI * Math.min(1, k * 1.6)) * 0.12;
    if (warm > 0.005) { ctx.fillStyle = 'rgba(255,120,40,' + warm + ')'; ctx.fillRect(ox, oy, W * tile, H * tile); }
    ctx.fillStyle = 'rgba(15,25,80,' + 0.28 * k + ')';
    ctx.fillRect(ox, oy, W * tile, H * tile);
  }

  // name and health of a boss in view, at the top of the screen
  function bossBar(s) {
    const b = s.monsters.find(m => m.def.boss && s.vis[idx(m.x, m.y)]);
    if (!b) return;
    const w = Math.min(420, vw - 40), x = (vw - w) / 2, y = vw < 700 ? 110 : 82;
    ctx.font = 'bold 14px Consolas, "Lucida Console", monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#000';
    ctx.strokeText(b.name, vw / 2, y);
    ctx.fillStyle = '#ffb02e';
    ctx.fillText(b.name, vw / 2, y);
    ctx.textAlign = 'start';
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 2, y + 6, w + 4, 12);
    const k = Math.max(0, b.hp / b.maxHp);
    const g = ctx.createLinearGradient(0, y + 8, 0, y + 16);
    g.addColorStop(0, '#ff6a5a'); g.addColorStop(1, '#9a1a14');
    ctx.fillStyle = g;
    ctx.fillRect(x, y + 8, w * k, 8);
    ctx.strokeStyle = '#4a4660'; ctx.lineWidth = 1;
    ctx.strokeRect(x - 2.5, y + 5.5, w + 5, 13);
  }

  const TEXT_COLORS = {
    dmg: '#fff', crit: '#ffb02e', hurt: '#ff5a4a', miss: '#b8c0d0', xp: '#9fd7ff',
    gold: '#ffd84a', heal: '#7dff8a', magic: '#c99bff', str: '#ff9b52', lvl: '#ffe066',
  };

  // ---- environment ---------------------------------------------------------------

  // lava cells and sun shafts of a map, worked out once
  function cache(s) {
    let c = mapCache.get(s.map);
    if (c) return c;
    const lava = [];
    for (let i = 0; i < W * H; i++) if (s.map.t[i] === T.LAVA) lava.push(i);
    // a shaft of sunlight in about half of the clearings
    const shafts = [];
    s.map.rooms.forEach((r, i) => {
      const v = s.map.variant[idx(r.x, r.y)];
      shafts.push({ x: r.x + 1 + (v % Math.max(1, r.w - 2)), y: r.y + 1 + ((v >> 2) % Math.max(1, r.h - 2)), w: 1.3 + (v % 5) * 0.2, ph: i * 1.7 });
    });
    c = { lava, shafts };
    mapCache.set(s.map, c);
    return c;
  }

  // the mist texture tinted with a colour; each use gets its own pattern
  // object, because a pattern keeps its own transform
  function tinted(color, use) {
    if (!mist) { mist = makeMist(); mist.pats = {}; }
    const key = color + '|' + use;
    if (!mist.pats[key]) {
      const c = document.createElement('canvas');
      c.width = mist.width; c.height = mist.height;
      const g = c.getContext('2d');
      g.drawImage(mist, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = 'rgb(' + color + ')';
      g.fillRect(0, 0, c.width, c.height);
      mist.pats[key] = ctx.createPattern(c, 'repeat');
    }
    return mist.pats[key];
  }

  // moving light on the water, flowing glow and crust on the lava, bubbles and ripples
  function liquids(now, ox, oy, water, lava, TS) {
    if (!water.length && !lava.length) return;
    const layer = (cells, color, use, cellsPer, vx, vy, alpha, op) => {
      if (!cells.length) return;
      const pat = tinted(color, use);
      const k = cellsPer * tile / mist.width;
      pat.setTransform(new DOMMatrix([k, 0, 0, k, ox + now * vx * tile / 1000, oy + now * vy * tile / 1000]));
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pat;
      ctx.beginPath();
      for (const c of cells) ctx.rect(ox + (c % W) * tile, oy + ((c / W) | 0) * tile, TS, TS);
      ctx.fill();
    };
    layer(water, '150,200,255', 'water1', 3, 0.25, 0.1, 0.32, 'lighter');
    layer(water, '20,40,90', 'water2', 4, -0.18, 0.14, 0.3, 'source-over');
    layer(lava, '255,170,40', 'lava1', 3, 0.12, 0.05, 0.5, 'lighter');
    layer(lava, '50,8,0', 'lava2', 2.5, -0.08, 0.06, 0.45, 'source-over');
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // a bubble that grows and pops on the lava, a ring that spreads on the water
    const blob = (c, lavaCell) => {
      const v = (c * 2654435761) >>> 0;
      const period = 2200 + (v % 9) * 350;
      const p = ((now + (v >>> 8) % period) % period) / period;
      const bx = ox + ((c % W) + 0.2 + (v % 7) * 0.1) * tile, by = oy + (((c / W) | 0) + 0.2 + ((v >>> 4) % 7) * 0.1) * tile;
      if (lavaCell) {
        if (p < 0.3) {
          ctx.fillStyle = 'rgba(255,215,110,0.75)';
          ctx.beginPath(); ctx.arc(bx, by, tile * (0.03 + p * 0.25), 0, Math.PI * 2); ctx.fill();
        } else if (p < 0.42) {
          ctx.strokeStyle = 'rgba(255,190,90,' + (1 - (p - 0.3) / 0.12) * 0.7 + ')';
          ctx.lineWidth = Math.max(1, tile / 32);
          ctx.beginPath(); ctx.arc(bx, by, tile * (0.1 + (p - 0.3) * 0.9), 0, Math.PI * 2); ctx.stroke();
        }
      } else if (p < 0.4) {
        ctx.strokeStyle = 'rgba(200,230,255,' + (1 - p / 0.4) * 0.35 + ')';
        ctx.lineWidth = Math.max(1, tile / 40);
        ctx.beginPath(); ctx.ellipse(bx, by, tile * (0.05 + p * 0.6), tile * (0.025 + p * 0.3), 0, 0, Math.PI * 2); ctx.stroke();
      }
    };
    for (const c of lava) blob(c, true);
    for (const c of water) if (c % 3 === 0) blob(c, false);
  }

  // snow and sand outside the paths keep the hero's footprints for a while
  function soft(s, c) {
    const th = s.theme;
    return !!th.outdoor && (th.floor === 'snow' || th.floor === 'sand') && !s.map.corridor[c] && s.map.t[c] === T.FLOOR;
  }

  function footprints(s, ox, oy) {
    if (!prints.size) return;
    const snow = s.theme.floor === 'snow';
    for (const [c, f] of prints) {
      const a = 1 - (s.turn - f.turn) / PRINT_TURNS;
      if (a <= 0) { prints.delete(c); continue; }
      if (!s.seen[c]) continue;
      ctx.save();
      ctx.translate(ox + (f.x + 0.5) * tile, oy + (f.y + 0.55) * tile);
      ctx.rotate(Math.atan2(f.dy, f.dx));
      ctx.fillStyle = snow ? 'rgba(70,95,140,' + a * 0.4 + ')' : 'rgba(110,70,30,' + a * 0.4 + ')';
      for (const [along, side] of [[-0.16, -0.1], [0.16, 0.1]]) {
        ctx.beginPath();
        ctx.ellipse(along * tile, side * tile, tile * 0.08, tile * 0.045, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // a soft contact shadow, plus a long one away from the nearest flame (or the sun outdoors)
  function shadow(s, a, px, py) {
    const big = !a.hero && a.e.def && a.e.def.boss ? Game.BOSS_SIZE : 1;
    const cx = px + tile / 2, cy = py + tile * 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, tile * 0.26 * big, tile * 0.08 * big, 0, 0, Math.PI * 2);
    ctx.fill();
    let ang, len, alpha;
    if (s.theme.outdoor) {
      ang = 0.5; len = 0.65; alpha = 0.3;
    } else {
      let best = null, bd = SHADOW_REACH;
      const near = (lx, ly) => {
        const d = Math.hypot(a.p.x - lx, a.p.y + 0.4 - ly);
        if (d < bd) { bd = d; best = { x: lx, y: ly }; }
      };
      for (const tc of s.torches) near(tc.x, tc.y + 0.6);
      for (const o of s.decor.values()) if (o.light && !o.merchant) near(o.x, o.y + 0.4);
      if (!best || bd < 0.35) return;
      ang = Math.atan2(a.p.y + 0.4 - best.y, a.p.x - best.x);
      len = Math.min(1.15, 0.5 + bd * 0.15);
      alpha = 0.62 * (1 - bd / SHADOW_REACH);
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, len * tile * big, 0);
    g.addColorStop(0, 'rgba(0,0,0,' + alpha + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(len * tile * big * 0.45, 0, len * tile * big * 0.6, tile * 0.14 * big, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // slanted shafts of sunlight through cracks in the cave roof, under the lightmap
  function rays(s, now, ox, oy) {
    ctx.globalCompositeOperation = 'lighter';
    for (const r of cache(s).shafts) {
      if (!s.seen[idx(r.x, r.y)]) continue;
      const a = (0.3 + 0.08 * Math.sin(now / 2600 + r.ph)) * (1 - (s.night || 0));
      if (a <= 0.01) continue;
      const bx = ox + (r.x + 0.5) * tile, by = oy + (r.y + 0.6) * tile;
      const tx = bx - tile * 1.6, ty = by - tile * 5;
      const w = r.w * tile * (1 + 0.05 * Math.sin(now / 1900 + r.ph));
      const g = ctx.createLinearGradient(tx, ty, bx, by);
      g.addColorStop(0, 'rgba(255,248,210,0)');
      g.addColorStop(1, 'rgba(255,248,210,' + a + ')');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(tx - w * 0.3, ty);
      ctx.lineTo(tx + w * 0.3, ty);
      ctx.lineTo(bx + w / 2, by);
      ctx.lineTo(bx - w / 2, by);
      ctx.closePath();
      ctx.fill();
      // the sunny patch on the ground
      const pg = ctx.createRadialGradient(bx, by, 0, bx, by, w * 0.8);
      pg.addColorStop(0, 'rgba(255,245,200,' + a * 0.9 + ')');
      pg.addColorStop(1, 'rgba(255,245,200,0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.ellipse(bx, by, w * 0.8, w * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- bodies --------------------------------------------------------------------

  const facing = (dx, dy) => (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));

  // monsters that hunt look at the hero; the others where they last went
  function facesLeft(s, m) {
    if (m.hunting && s.hero.x !== m.x) return s.hero.x < m.x;
    return !!m.flip;
  }

  function glowAt(x, y, r, a, rgb) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // the hero with the weapon in hand (behind the back when facing away)
  // and a sheen for heavy armour
  function heroBody(h, x, y) {
    const name = h.cls + '_' + h.dir;
    const wpn = h.weapon && h.weapon !== 'dagger' && Icons.has(h.weapon) ? h.weapon : null;
    const hand = (front) => {
      if (!wpn || (h.dir === 'up') === front) return;
      const ws = tile * 0.46;
      let wx = x + tile * 0.55, wy = y + tile * 0.38, mirror = false;
      if (h.dir === 'left') { wx = x - tile * 0.01; mirror = true; }
      if (h.dir === 'up') { wx = x + tile * 0.03; wy = y + tile * 0.3; mirror = true; }
      ctx.save();
      if (mirror) { ctx.translate(wx + ws, wy); ctx.scale(-1, 1); spr(wpn, 0, 0, ws); } else spr(wpn, wx, wy, ws);
      ctx.restore();
    };
    hand(false);
    spr(name, x, y, tile);
    const at = h.armor && ARMOR_TINT[h.armor];
    if (at) {
      ctx.save();
      ctx.globalAlpha *= at[1];
      ctx.filter = at[0];
      spr(name, x, y, tile);
      ctx.restore();
    }
    hand(true);
  }

  // a red pulse over a badly wounded monster
  function hurtTint(name, x, y, size, now, id) {
    ctx.save();
    ctx.globalAlpha *= 0.25 + 0.25 * Math.sin(now / 110 + id);
    ctx.filter = 'brightness(0.55) sepia(1) saturate(9) hue-rotate(-35deg)';
    spr(name, x, y, size);
    ctx.restore();
  }

  // the creature upside down in the water below its feet, in wavy strips
  function reflect(s, a, ox, oy, px, py, now, flip) {
    if (a.cat || (a.hero ? a.e.invisible : a.e.def.boss)) return;
    const cx = Math.round(a.p.x), cy = Math.round(a.p.y);
    const cells = [[cx, cy], [cx, cy + 1]].filter(([x, y]) => y < H && s.map.t[idx(x, y)] === T.WATER && s.seen[idx(x, y)]);
    if (!cells.length) return;
    const name = a.hero ? a.e.cls + '_' + a.e.dir : monsterSprite(a.e, now);
    const p = ATLAS.sprites[name];
    if (!p) return;
    const c = ATLAS.cell, n = 8, feet = py + tile * 0.95;
    ctx.save();
    ctx.beginPath();
    for (const [x, y] of cells) ctx.rect(ox + x * tile, oy + y * tile, tile + 0.5, tile + 0.5);
    ctx.clip();
    ctx.globalAlpha = a.e.type === 'ghost' ? 0.18 : 0.3;
    ctx.filter = 'brightness(0.75) saturate(0.7)';
    ctx.translate(px + tile / 2, feet);
    ctx.scale(flip ? -1 : 1, -1);
    for (let i = 0; i < n; i++) {
      const dx = Math.sin(now / 180 + i * 0.8 + a.p.x * 2) * tile * 0.03 * (0.3 + i / n);
      ctx.drawImage(img, p[0] * c, p[1] * c + i * c / n, c, c / n, -tile / 2 + dx, -tile * 0.95 + i * tile / n, tile, tile / n + 0.5);
    }
    ctx.restore();
  }

  // ---- spells, deaths, sparks ---------------------------------------------------

  // sparks bursting out of a point, or (inward) gathering into it
  function sparks(x, y, n, col, inward) {
    for (let i = 0; i < n && parts.length < MAX_PARTS; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.2, life = 0.35 + Math.random() * 0.45;
      const cx = x + 0.5, cy = y + 0.5;
      if (inward) {
        const d = 0.8 + Math.random() * 0.6;
        parts.push({ k: 'spark', free: true, col, age: 0, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, vx: -Math.cos(a) * d / life, vy: -Math.sin(a) * d / life, life, size: 1.5 + Math.random() * 1.5 });
      } else {
        parts.push({ k: 'spark', free: true, col, age: 0, x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life, size: 1.5 + Math.random() * 1.5 });
      }
    }
  }

  // what each scroll looks like when read
  function spell(s, e, t) {
    switch (e.kind) {
      case 'fire':
        fx.push({ kind: 'ring', x: e.x, y: e.y, t0: t, dur: 700, r: 8, color: '255,120,40', light: 'fire' });
        fx.push({ kind: 'ring', x: e.x, y: e.y, t0: t + 120, dur: 650, r: 6, color: '255,200,80' });
        break;
      case 'sleep': {
        fx.push({ kind: 'ring', x: e.x, y: e.y, t0: t, dur: 1000, r: 6, color: '170,120,255', light: 'sleep' });
        // a violet haze settles on the sleepers
        at(t + 150, () => {
          for (const m of s.monsters) {
            if (!m.asleep || !s.vis[idx(m.x, m.y)]) continue;
            for (let i = 0; i < 7 && parts.length < MAX_PARTS; i++) {
              parts.push({ k: 'puff', age: 0, col: '190,140,255', x: m.x + 0.2 + Math.random() * 0.6, y: m.y - 0.3 + Math.random() * 0.3, vx: (Math.random() - 0.5) * 0.3, vy: 0.25 + Math.random() * 0.3, life: 1 + Math.random() * 0.6, size: 3 + Math.random() * 3 });
            }
          }
        });
        break;
      }
      case 'mapping':
        reveal = { t0: t, x: e.x, y: e.y, before: e.before };
        break;
      case 'invisibility':
        at(t, () => sparks(e.x, e.y, 24, '230,235,255', false));
        break;
      case 'invincibility':
        fx.push({ kind: 'ring', x: e.x, y: e.y, t0: t, dur: 600, r: 2.6, color: '255,215,90', light: 'gold' });
        break;
    }
  }

  // each kind of monster dies in its own way
  function death(s, m, t) {
    const name = monsterSprite(m, 0), x = m.x, y = m.y;
    const fade = (o) => fx.push(Object.assign({ kind: 'fade', name, x, y, t0: t + 80, dur: 500 }, o));
    if (m.type === 'shade' || m.def.boss) {
      fade({ dur: 1200, filter: m.type === 'shade' ? SHADE_FILTER : null, size: m.def.boss ? Game.BOSS_SIZE : 1 });
      fx.push({ kind: 'sprite', name: 'smoke', x, y, t0: t + 120, dur: 520, size: 0.9 });
      return;
    }
    switch (m.type) {
      case 'skeleton':
        // falls apart into bones
        fade({ dur: 300, melt: true });
        at(t + 80, () => chips(x, y, '235,228,210', 14));
        break;
      case 'slime':
        fade({ dur: 650, melt: true });
        fx.push({ kind: 'puddle', x, y, t0: t + 300, dur: 2600, color: '90,200,60' });
        break;
      case 'ghost':
        fade({ dur: 900, stretch: true, rise: 1.3 });
        break;
      case 'bat':
        fade({ dur: 550, spin: true, rise: -0.45 });
        break;
      case 'demon':
        fx.push({ kind: 'sprite', name: 'explosion', x, y, t0: t + 60, dur: 520, size: 1.2 });
        fade({ dur: 250 });
        at(t + 60, () => {
          for (let i = 0; i < 22 && parts.length < MAX_PARTS; i++) {
            const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
            parts.push({ k: 'ember', age: 0, x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: 0.5 + Math.random() * 0.6, size: 1.5 + Math.random() * 2 });
          }
        });
        break;
      case 'eyeball':
        fade({ dur: 350, size: 1.25 });
        at(t + 80, () => chips(x, y, '200,60,70', 8));
        break;
      default:
        fade({});
        fx.push({ kind: 'sprite', name: 'smoke', x, y, t0: t + 120, dur: 520, size: 0.9 });
    }
  }

  // pieces flying out of a cell and falling to the floor
  function chips(x, y, col, n) {
    for (let i = 0; i < n && parts.length < MAX_PARTS; i++) {
      parts.push({ k: 'chip', age: 0, col, x: x + 0.5, y: y + 0.55, vx: (Math.random() - 0.5) * 4.5, vy: -1.2 - Math.random() * 2.4, g: 11,
        floor: y + 0.75 + Math.random() * 0.4, life: 0.8 + Math.random() * 0.6, size: 1.6 + Math.random() * 2.2, rot: Math.random() * 3 });
    }
  }

  // the edge of the mapping wave, sweeping out from the reader
  function wave(now, ox, oy) {
    const r = (now - reveal.t0) * REVEAL_SPEED;
    if (r <= 0) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, W * tile, H * tile); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(120,220,255,' + Math.max(0, 0.45 - r / 160) + ')';
    ctx.lineWidth = tile * 0.45;
    ctx.beginPath(); ctx.arc(ox + (reveal.x + 0.5) * tile, oy + (reveal.y + 0.5) * tile, r * tile, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // ---- lurking things ------------------------------------------------------------

  // awake monsters just out of sight, seen before, show two glowing eyes in the dark
  function eyes(s, now, ox, oy) {
    const h = s.hero;
    ctx.globalCompositeOperation = 'lighter';
    for (const m of s.monsters) {
      const c = idx(m.x, m.y);
      if (s.vis[c] || !m.seenOnce || m.asleep || !s.seen[c] || Math.abs(m.x - h.x) + Math.abs(m.y - h.y) > EYES_RANGE) continue;
      if ((now / 1000 + m.id * 0.37) % 3.2 < 0.14) continue; // a blink
      const p = pos(m, now);
      const big = m.def.boss ? Game.BOSS_SIZE : 1;
      const ex = ox + (p.x + 0.5) * tile, ey = oy + (p.y + 0.55 - 0.25 * big) * tile, gap = tile * 0.09 * big;
      const col = m.type === 'ghost' || m.type === 'shade' ? '160,220,255' : '255,50,40';
      for (const sx of [-1, 1]) glowAt(ex + sx * gap, ey, tile * 0.09 * big, 0.95, col);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // a breath of cold light over the stairs down, visible from afar once found
  function stairsCall(s, now, ox, oy) {
    const d = s.map.down, c = idx(d.x, d.y);
    if (!s.seen[c] || veiled(c, now)) return;
    const col = s.monsters.some(m => m.guard) ? '255,110,100' : '150,200,255';
    const a = 0.17 + 0.08 * Math.sin(now / 900);
    const x = ox + d.x * tile, y = oy + d.y * tile;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, y - tile * 1.6, 0, y + tile * 0.9);
    g.addColorStop(0, 'rgba(' + col + ',0)');
    g.addColorStop(1, 'rgba(' + col + ',' + a + ')');
    ctx.fillStyle = g;
    ctx.fillRect(x + tile * 0.15, y - tile * 1.6, tile * 0.7, tile * 2.5);
    glowAt(x + tile / 2, y + tile / 2, tile * 1.2, a, col);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- lava and grass -------------------------------------------------------------

  // now and then a tongue of fire leaps out of the lava and lights the room
  function flares(s, dt, now) {
    const lava = cache(s).lava.filter(c => s.vis[c]);
    if (!lava.length || Math.random() > dt * 0.35) return;
    const c = lava[Math.floor(Math.random() * lava.length)];
    const x = c % W, y = (c / W) | 0;
    fx.push({ kind: 'flare', x, y, t0: now, dur: 1000 });
    for (let i = 0; i < 14 && parts.length < MAX_PARTS; i++) {
      parts.push({ k: 'ember', age: 0, x: x + 0.3 + Math.random() * 0.4, y: y + 0.4, vx: (Math.random() - 0.5) * 0.8, vy: -1.5 - Math.random() * 1.5, life: 0.7 + Math.random() * 0.7, size: 1.5 + Math.random() * 2 });
    }
  }

  // the air above the lava shimmers: strips of the canvas are copied back a little
  // shifted (drawing the canvas onto itself is allowed, reading pixels is not)
  function heat(s, now, ox, oy, th) {
    const lava = cache(s).lava;
    if (!lava.length) return;
    const amp = tile * (th.name === 'Inferno' ? 0.035 : 0.022), n = 6;
    for (const c of lava) {
      if (!s.vis[c]) continue;
      const x = ox + (c % W) * tile, y0 = oy + (((c / W) | 0) - 0.6) * tile, hgt = tile * 1.5, sh = hgt / n;
      for (let i = 0; i < n; i++) {
        const y = y0 + i * sh;
        const off = Math.sin(now / 110 + y * 0.09 + c) * amp * (i + 1) / n;
        ctx.drawImage(cv, x * dpr, y * dpr, tile * dpr, sh * dpr, x + off, y, tile, sh);
      }
    }
  }

  // blades of grass part around whoever walks through the garden, then stand up again
  function blades(s, actors, now, ox, oy) {
    const th = s.theme;
    if (!th.outdoor || th.floor !== 'grass') return;
    for (const a of actors) {
      if (FLOATERS[a.e.type]) continue;
      const c = idx(Math.round(a.p.x), Math.round(a.p.y));
      if (s.map.t[c] === T.FLOOR && !s.map.corridor[c]) grass.set(c, now);
    }
    const u = tile / 48;
    ctx.lineCap = 'round';
    for (const [c, t0] of grass) {
      const age = now - t0;
      if (age > 1600) { grass.delete(c); continue; }
      const k = age < 60 ? 1 : 1 - (age - 60) / 1540;
      const px = ox + (c % W) * tile, py = oy + ((c / W) | 0) * tile;
      for (let i = 0; i < 7; i++) {
        const bx = px + tile * (0.12 + i * 0.127), by = py + tile * 0.98;
        const side = (bx - (px + tile / 2)) / (tile / 2);
        const tipX = bx + side * tile * 0.25 * k + Math.sin(now / 500 + i) * u, tipY = by - tile * (0.3 - 0.12 * k);
        ctx.strokeStyle = i % 2 ? 'rgba(80,160,45,0.95)' : 'rgba(120,200,70,0.95)';
        ctx.lineWidth = 2.2 * u;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + side * tile * 0.05 * k, by - tile * 0.15, tipX, tipY); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  // a cobweb shivers while someone is near it
  function web(s, d, px, py, size, now) {
    const near = [s.hero, ...s.monsters].some(o => Math.abs(o.x - d.x) <= 1 && Math.abs(o.y - d.y) <= 1);
    if (near) d.wob = now;
    const k = d.wob ? Math.max(0, 1 - (now - d.wob) / 900) : 0;
    if (!k) { spr('web', px, py, size); return; }
    ctx.save();
    ctx.translate(px + size / 2, py);
    ctx.transform(1, 0, Math.sin(now / 45) * 0.09 * k, 1 + Math.sin(now / 60) * 0.05 * k, 0, 0);
    spr('web', -size / 2, 0, size);
    ctx.restore();
  }

  // ---- scenery helpers ---------------------------------------------------------------

  // a plant bent by the wind, pivoting on its base
  function sway(name, x, y, size, phase, now) {
    const amp = SWAY[name] || 0;
    if (!amp) { spr(name, x, y, size); return; }
    const k = amp * (Math.sin(now / 1100 + phase) + 0.45 * Math.sin(now / 430 + phase * 2.3));
    ctx.save();
    ctx.translate(x + size / 2, y + size);
    ctx.transform(1, 0, -k, 1, 0, 0);
    spr(name, -size / 2, -size, size);
    ctx.restore();
  }

  // a band of shade on the floor at the foot of a wall, softer at the sides
  function wallDepth(t, x, y, px, py, outdoor) {
    const k = outdoor ? 0.6 : 1;
    if (y > 0 && t[idx(x, y - 1)] === T.WALL) {
      const bands = [0.36, 0.22, 0.12, 0.05];
      for (let i = 0; i < bands.length; i++) {
        ctx.fillStyle = 'rgba(0,0,0,' + bands[i] * k + ')';
        ctx.fillRect(px, py + i * tile * 0.08, tile + 0.5, tile * 0.08 + 0.5);
      }
    }
    for (const side of [-1, 1]) {
      if (x + side < 0 || x + side >= W || t[idx(x + side, y)] !== T.WALL) continue;
      const bands = [0.2, 0.09];
      for (let i = 0; i < bands.length; i++) {
        ctx.fillStyle = 'rgba(0,0,0,' + bands[i] * k + ')';
        ctx.fillRect(side < 0 ? px + i * tile * 0.07 : px + tile - (i + 1) * tile * 0.07, py, tile * 0.07 + 0.5, tile + 0.5);
      }
    }
  }

  // bats crossing the screen now and then, dim over the dark, fainter in the light
  function flyingBats(s, dt, now, ox, oy, x0, y0, x1, y1, th) {
    const night = s.night || 0;
    if (th.outdoor && night < 0.4) return;
    if (now > nextBat) {
      nextBat = now + (night ? 2500 + Math.random() * 5000 : 8000 + Math.random() * 12000);
      const left = Math.random() < 0.5;
      bats.push({ x: left ? x0 - 1 : x1 + 2, y: y0 + 1 + Math.random() * Math.max(1, y1 - y0 - 2), vx: (left ? 1 : -1) * (2.6 + Math.random() * 1.6), ph: Math.random() * 6 });
    }
    for (const b of bats) { b.x += b.vx * dt; b.y += Math.sin(now / 280 + b.ph) * dt * 0.9; }
    bats = bats.filter(b => b.x > x0 - 3 && b.x < x1 + 4);
    for (const b of bats) {
      const c = idx(Math.max(0, Math.min(W - 1, Math.floor(b.x))), Math.max(0, Math.min(H - 1, Math.floor(b.y))));
      const sz = tile * 0.5;
      ctx.save();
      ctx.globalAlpha = s.vis[c] ? 0.18 : 0.6;
      ctx.filter = 'brightness(0.55) saturate(0.6)';
      ctx.translate(ox + b.x * tile, oy + b.y * tile);
      if (b.vx < 0) ctx.scale(-1, 1);
      spr('bat_' + (Math.floor(now / 80 + b.ph) % 4), -sz / 2, -sz / 2, sz);
      ctx.restore();
    }
  }

  // ---- particles ---------------------------------------------------------------
  // kinds drawn under the lightmap (they fade in the dark): dust, snow, sand, ash;
  // kinds that shine on top of it, only where the hero can see: ember, fly

  const GLOWING = { ember: 1, fly: 1, spark: 1 };

  function particles(s, dt, now, ox, oy, x0, y0, x1, y1, th) {
    const count = (rate) => { const k = rate * dt; let n = Math.floor(k); if (Math.random() < k - n) n++; return n; };
    const add = (p) => { if (parts.length < MAX_PARTS) parts.push(Object.assign({ age: 0 }, p)); };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const wx = () => rnd(x0, x1 + 1), wy = () => rnd(y0, y1 + 1);
    // embers from the torches and the lava in view
    for (const tc of s.torches) {
      if (!s.vis[idx(tc.x, tc.y + 1)]) continue;
      for (let i = count(1.8); i--;) add({ k: 'ember', x: tc.x + 0.5 + rnd(-0.08, 0.08), y: tc.y + 0.5, vx: rnd(-0.15, 0.15), vy: rnd(-1.1, -0.6), life: rnd(0.7, 1.4), size: rnd(1, 2) });
    }
    for (const c of cache(s).lava) {
      if (!s.vis[c]) continue;
      for (let i = count(0.3); i--;) add({ k: 'ember', x: c % W + rnd(0.1, 0.9), y: ((c / W) | 0) + rnd(0.2, 0.9), vx: rnd(-0.1, 0.1), vy: rnd(-0.8, -0.4), life: rnd(0.6, 1.2), size: rnd(1, 2.2) });
    }
    const name = th.name;
    if (!th.outdoor) {
      // dust motes in the light around the hero
      const h = s.hero;
      for (let i = count(name === 'Inferno' ? 0 : 5); i--;) add({ k: 'dust', x: h.x + rnd(-4, 5), y: h.y + rnd(-4, 5), vx: rnd(-0.08, 0.08), vy: rnd(-0.06, 0.04), life: rnd(3, 6), size: rnd(0.8, 1.6) });
    }
    if (name === 'Inferno') {
      for (let i = count(16); i--;) add({ k: 'ash', x: wx(), y: wy() - 1, vx: rnd(-0.25, 0.05), vy: rnd(0.2, 0.45), life: rnd(3, 6), size: rnd(1, 2.4) });
    } else if (name === 'Frozen Hollow') {
      for (let i = count(60); i--;) add({ k: 'snow', x: wx(), y: wy() - 1, vx: rnd(0.05, 0.3), vy: rnd(0.6, 1.1), life: rnd(2.5, 4.5), size: rnd(1, 2.6), ph: rnd(0, 6) });
    } else if (name === 'Desert Ruins') {
      for (let i = count(22); i--;) add({ k: 'sand', x: x0 - 1, y: wy(), vx: rnd(4, 7), vy: rnd(0.1, 0.5), life: (x1 - x0 + 3) / 4, size: rnd(1, 1.8) });
    } else if (th.rays) {
      // fireflies over the grass, a few at a time
      const flies = parts.reduce((n, p) => n + (p.k === 'fly'), 0);
      const night = s.night || 0;
      if (flies < 18 + 30 * night && Math.random() < dt * (5 + 15 * night)) {
        // only where the hero can see, or they would be wasted in the dark
        for (let i = 0; i < 6; i++) {
          const x = wx(), y = wy();
          if (x < 0 || y < 0 || x >= W || y >= H || !s.vis[idx(Math.floor(x), Math.floor(y))]) continue;
          add({ k: 'fly', x, y, vx: 0, vy: 0, life: rnd(6, 11), size: rnd(1.5, 2.4), ph: rnd(0, 6) });
          break;
        }
      }
    }
    // the Dread trails black smoke
    for (const m of s.monsters) {
      if (!m.def.dread || !s.vis[idx(m.x, m.y)]) continue;
      for (let i = count(10); i--;) add({ k: 'puff', col: '12,6,16', x: m.x + rnd(0.2, 0.8), y: m.y + rnd(0.3, 0.9), vx: rnd(-0.2, 0.2), vy: rnd(-0.5, -0.2), life: rnd(0.6, 1.1), size: rnd(3, 5.5) });
    }
    // sparks rising from the Heart of the Deep
    for (const it of s.items.values()) {
      if (it.kind !== 'artifact' || !s.seen[idx(it.x, it.y)]) continue;
      for (let i = count(4); i--;) add({ k: 'spark', free: true, col: '255,90,110', x: it.x + rnd(0.3, 0.7), y: it.y + 0.6, vx: rnd(-0.1, 0.1), vy: rnd(-0.9, -0.5), life: rnd(0.8, 1.4), size: rnd(1.2, 2) });
    }
    // drops from the cave roof
    if (name === 'Caverns') {
      for (let i = count(1.4); i--;) {
        for (let k = 0; k < 6; k++) {
          const x = Math.floor(wx()), y = Math.floor(wy());
          if (x < 0 || y < 0 || x >= W || y >= H || !s.vis[idx(x, y)]) continue;
          const v = s.map.t[idx(x, y)];
          if (v !== T.FLOOR && v !== T.WATER) continue;
          const fl = y + rnd(0.45, 0.85);
          add({ k: 'drip', x: x + rnd(0.2, 0.8), y: fl - 1.8, vx: 0, vy: 0.4, g: 14, floor: fl, life: 4, size: 1.3, water: v === T.WATER });
          break;
        }
      }
    }
    // cold light rising from the stairs down, once found (red while sealed)
    const dn = s.map.down;
    if (s.seen[idx(dn.x, dn.y)]) {
      const col = s.monsters.some(m => m.guard) ? '255,110,100' : '160,205,255';
      for (let i = count(2.5); i--;) add({ k: 'spark', free: true, col, x: dn.x + rnd(0.25, 0.75), y: dn.y + 0.75, vx: rnd(-0.05, 0.05), vy: rnd(-0.9, -0.5), life: rnd(1.2, 2), size: rnd(1, 1.8) });
    }
    // move, sway and age
    const landed = [];
    for (const p of parts) {
      p.age += dt;
      if (p.k === 'fly') {
        p.vx += (Math.random() - 0.5) * dt * 1.6; p.vy += (Math.random() - 0.5) * dt * 1.6;
        p.vx *= 0.98; p.vy *= 0.98;
      }
      const sway = p.k === 'snow' || p.k === 'ash' ? Math.sin(now / 500 + (p.ph || p.x * 3)) * 0.25 : 0;
      p.x += (p.vx + sway) * dt;
      p.y += p.vy * dt;
      if (p.g) {
        p.vy += p.g * dt;
        if (p.y > p.floor) {
          p.y = p.floor; p.vy = 0; p.vx = 0; p.g = 0;
          if (p.k === 'drip') { p.age = p.life; landed.push(p); }
        }
      }
    }
    parts = parts.filter(p => p.age < p.life);
    for (const p of landed) {
      if (p.water) add({ k: 'ripple', x: p.x, y: p.y, vx: 0, vy: 0, life: 0.9, size: 1 });
      else for (let i = 0; i < 2; i++) add({ k: 'puff', col: '170,200,230', x: p.x, y: p.y, vx: rnd(-0.4, 0.4), vy: -0.2, life: 0.3, size: 1.2 });
    }
  }

  // a puff of dust (snow, sand) at the feet of whoever steps away, or by a door
  function puff(s, x, y, n, door) {
    const th = s.theme, v = s.map.t[idx(x, y)];
    if (v === T.LAVA) return;
    let col = '165,155,145';
    if (v === T.WATER) col = '180,215,255';
    else if (th.outdoor && !door) {
      if (th.floor === 'grass' && !s.map.corridor[idx(x, y)]) return;
      col = th.floor === 'snow' ? '240,245,255' : '230,200,150';
    }
    for (let i = 0; i < n && parts.length < MAX_PARTS; i++) {
      parts.push({ k: 'puff', age: 0, col, x: x + 0.5 + (Math.random() - 0.5) * (door ? 0.8 : 0.4), y: y + (door ? 0.7 : 0.85) + (Math.random() - 0.5) * 0.1,
        vx: (Math.random() - 0.5) * 0.6, vy: -0.05 - Math.random() * 0.25, life: 0.35 + Math.random() * 0.3, size: 2 + Math.random() * 1.8 });
    }
  }

  // pieces of a smashed barrel, crate or urn fly out and fall
  function splinters(x, y, kind) {
    const col = kind === 'urn' ? '185,100,60' : kind === 'crate' ? '175,125,65' : '140,90,45';
    for (let i = 0; i < 12 && parts.length < MAX_PARTS; i++) {
      parts.push({ k: 'chip', age: 0, col, x: x + 0.5, y: y + 0.55, vx: (Math.random() - 0.5) * 4.5, vy: -1.2 - Math.random() * 2.4, g: 11,
        floor: y + 0.75 + Math.random() * 0.4, life: 0.8 + Math.random() * 0.6, size: 1.6 + Math.random() * 2.2, rot: Math.random() * 3 });
    }
  }

  function drawParts(s, ox, oy, glowing) {
    if (!parts.length) return;
    const u = tile / 48;   // particle sizes are for 48 px cells
    if (glowing) ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      if (!!GLOWING[p.k] !== glowing) continue;
      const c = idx(Math.floor(p.x), Math.floor(p.y));
      if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H || !s.seen[c]) continue;
      if (glowing && !s.vis[c] && !p.free) continue;
      const t = p.age / p.life;
      const fade = Math.min(1, t * 5, (1 - t) * 4);
      const x = ox + p.x * tile, y = oy + p.y * tile, r = p.size * u;
      switch (p.k) {
        case 'spark':
          ctx.fillStyle = 'rgba(' + p.col + ',' + fade * 0.9 + ')';
          ctx.fillRect(x - r / 2, y - r / 2, r, r);
          break;
        case 'drip':
          ctx.strokeStyle = 'rgba(170,210,255,' + 0.75 + ')';
          ctx.lineWidth = Math.max(1, r);
          ctx.beginPath(); ctx.moveTo(x, y - tile * 0.08); ctx.lineTo(x, y); ctx.stroke();
          break;
        case 'ripple':
          ctx.strokeStyle = 'rgba(200,230,255,' + (1 - t) * 0.6 + ')';
          ctx.lineWidth = Math.max(1, u);
          ctx.beginPath(); ctx.ellipse(x, y, tile * (0.04 + t * 0.3), tile * (0.02 + t * 0.12), 0, 0, Math.PI * 2); ctx.stroke();
          break;
        case 'puff':
          ctx.fillStyle = 'rgba(' + p.col + ',' + fade * 0.4 + ')';
          ctx.beginPath(); ctx.arc(x, y, r * (1 + t * 1.6), 0, Math.PI * 2); ctx.fill();
          break;
        case 'chip':
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot + p.vx * p.age * 2);
          ctx.fillStyle = 'rgba(' + p.col + ',' + fade + ')';
          ctx.fillRect(-r * 0.7, -r * 0.4, r * 1.4, r * 0.8);
          ctx.restore();
          break;
        case 'ember':
          ctx.fillStyle = 'rgba(255,' + Math.round(200 - t * 120) + ',60,' + fade * 0.9 + ')';
          ctx.fillRect(x - r / 2, y - r / 2, r, r);
          break;
        case 'fly': {
          const blink = Math.max(0, Math.sin(p.age * 2.2 + p.ph)) * fade;
          if (blink < 0.05) break;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
          g.addColorStop(0, 'rgba(220,255,120,' + blink * 0.9 + ')');
          g.addColorStop(1, 'rgba(180,255,90,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
          break;
        }
        case 'dust':
          ctx.fillStyle = 'rgba(255,240,210,' + fade * 0.35 + ')';
          ctx.fillRect(x, y, r, r);
          break;
        case 'snow':
          // a faint blue shadow keeps the flakes visible over the snow
          ctx.fillStyle = 'rgba(60,85,140,' + fade * 0.35 + ')';
          ctx.beginPath(); ctx.arc(x + r * 0.6, y + r * 0.9, r * 1.1, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,' + fade * 0.95 + ')';
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          break;
        case 'ash':
          ctx.fillStyle = 'rgba(70,62,60,' + fade * 0.7 + ')';
          ctx.fillRect(x, y, r * 1.4, r);
          break;
        case 'sand':
          ctx.strokeStyle = 'rgba(255,236,190,' + fade * 0.55 + ')';
          ctx.lineWidth = r;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * tile * 0.06, y - p.vy * tile * 0.06); ctx.stroke();
          break;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- mist ------------------------------------------------------------------

  // soft wisps: tileable value noise in two octaves, white with alpha
  function makeMist(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const im = g.createImageData(size, size);
    const grid = (n) => { const a = []; for (let i = 0; i < n * n; i++) a.push(Math.random()); return a; };
    const octaves = [[4, 0.6, grid(4)], [8, 0.3, grid(8)], [16, 0.1, grid(16)]];
    const ease = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        for (const [n, w, a] of octaves) {
          const fx = x / size * n, fy = y / size * n;
          const ix = Math.floor(fx), iy = Math.floor(fy), tx = ease(fx - ix), ty = ease(fy - iy);
          const at = (i, j) => a[((j % n + n) % n) * n + ((i % n + n) % n)];
          const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
          const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
          v += (top + (bot - top) * ty) * w;
        }
        const o = (y * size + x) * 4;
        im.data[o] = im.data[o + 1] = im.data[o + 2] = 255;
        im.data[o + 3] = Math.pow(Math.max(0, Math.min(1, (v - 0.28) * 2.2)), 1.4) * 255;
      }
    }
    g.putImageData(im, 0, 0);
    return c;
  }

  // two layers of mist drifting at different speeds and sizes over the map;
  // drawn under the lightmap, so it glows near light and vanishes in the dark
  function fog(now, ox, oy, th) {
    const pat = tinted(th.fogColor || '205,215,235', 'fog');
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, W * tile, H * tile);
    ctx.clip();
    const layers = [[7, 0.010, 0.004, 0.62], [11, -0.006, 0.007, 0.45]];
    for (const [cells, vx, vy, alpha] of layers) {
      const k = cells * tile / mist.width;
      const size = mist.width * k;
      const dx = ((ox + now * vx * tile / 48) % size + size) % size;
      const dy = ((oy + now * vy * tile / 48) % size + size) % size;
      ctx.globalAlpha = alpha * (0.85 + 0.15 * Math.sin(now / 2300 + cells));
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (dx - size), dpr * (dy - size));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, (vw + size * 2) / k, (vh + size * 2) / k);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function light(s, now, ox, oy, hp, th) {
    const night = s.night || 0;
    const dark = night ? th.dark.map((v, i) => Math.round(v + ([2, 5, 16][i] - v) * night)) : th.dark;
    const remembered = Math.min(0.9, (th.remembered ?? REMEMBERED) + 0.18 * night);
    const dim = s.special === 'gauntlet' ? 0.5 : 1;
    const ambient = (th.ambient ?? AMBIENT) * (1 - 0.72 * night) * dim;
    const d = ldata.data;
    const flick = 1 + Math.sin(now / 130) * 0.025 + Math.sin(now / 53) * 0.02;
    const sources = [{ x: hp.x, y: hp.y, r: HERO_LIGHT * flick * (s.special === 'gauntlet' ? 0.55 : 1), k: 1, tint: null }];
    for (const tc of s.torches) {
      const f = 1 + Math.sin(now / 90 + tc.phase) * 0.05;
      sources.push({ x: tc.x, y: tc.y + 0.6, r: TORCH_LIGHT * f, k: 0.9, tint: LIGHT_COLORS.torch.tint });
    }
    for (const o of s.decor.values()) {
      if (!o.light) continue;
      const crystal = o.kind === 'crystal' || o.kind === 'crystals';
      const r = o.light * (crystal ? 1 + 0.12 * Math.sin(now / 650 + o.x * 2 + o.y) : 1);
      sources.push({ x: o.x, y: o.y, r, k: crystal ? 0.45 : 0.7, tint: decorColor(o).tint });
    }
    const lavaCells = cache(s).lava.filter(c => s.seen[c]);
    for (const c of lavaCells) {
      const x = c % W, y = (c / W) | 0;
      sources.push({ x, y, r: LAVA_LIGHT * (1 + 0.06 * Math.sin(now / 400 + x + y * 2)), k: 0.28, tint: LIGHT_COLORS.lava.tint });
    }
    for (const it of s.items.values()) {
      if (it.kind === 'artifact') sources.push({ x: it.x, y: it.y, r: 4 + 0.3 * Math.sin(now / 400), k: 0.8, tint: [130, 20, 40] });
    }
    // flying fireballs and bolts light the walls they pass
    for (const sh of shots) {
      const lc = LIGHT_COLORS[sh.kind], p = (now - sh.t0) / sh.dur;
      if (!lc || p < 0 || p > 1) continue;
      sources.push({ x: sh.from.x + (sh.to.x - sh.from.x) * p, y: sh.from.y + (sh.to.y - sh.from.y) * p, r: lc.r, k: 0.8, tint: lc.tint });
    }
    // and so do spells and explosions, while they fade
    for (const f of fx) {
      const p = (now - f.t0) / f.dur;
      if (p < 0 || p > 1) continue;
      const lc = f.kind === 'sprite' && LIGHT_COLORS[f.name];
      if (lc) sources.push({ x: f.x, y: f.y, r: lc.r * (1 - p * 0.6), k: 0.8 * (1 - p), tint: lc.tint });
      else if (f.kind === 'ring' && f.light) sources.push({ x: f.x, y: f.y, r: f.r * (1 - (1 - p) * (1 - p)) + 1.5, k: 0.9 * (1 - p), tint: LIGHT_COLORS[f.light].tint });
      else if (f.kind === 'flare') sources.push({ x: f.x, y: f.y, r: 6.5, k: 1.2 * Math.sin(p * Math.PI), tint: LIGHT_COLORS.lava.tint });
      else if (f.kind === 'circle') sources.push({ x: f.x, y: f.y + 0.3, r: 2.6, k: 0.6 * Math.sin(p * Math.PI), tint: [110, 10, 40] });
    }
    for (let c = 0; c < W * H; c++) {
      const i = c * 4;
      d[i] = dark[0]; d[i + 1] = dark[1]; d[i + 2] = dark[2];
      if (!s.seen[c] || veiled(c, now)) { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; continue; }
      if (!s.vis[c]) { d[i + 3] = 255 * remembered; continue; }
      const x = c % W, y = (c / W) | 0;
      let L = ambient, tr = 0, tg = 0, tb = 0;
      for (const l of sources) {
        const dx = x - l.x, dy = y - l.y;
        const q = dx * dx + dy * dy;
        if (q >= l.r * l.r) continue;
        const f = 1 - Math.sqrt(q) / l.r;
        const w = f * f * 1.5 * l.k;
        L += w;
        if (l.tint) { tr += l.tint[0] * w; tg += l.tint[1] * w; tb += l.tint[2] * w; }
      }
      // coloured lights tint the half dark around them
      d[i] = Math.min(255, dark[0] + tr * 0.6); d[i + 1] = Math.min(255, dark[1] + tg * 0.6); d[i + 2] = Math.min(255, dark[2] + tb * 0.6);
      if (s.map.t[c] === T.LAVA) L += 0.5;
      d[i + 3] = 255 * Math.max(0, 1 - Math.min(1, L)) * 0.94;
    }
    lctx.putImageData(ldata, 0, 0);

    // warm glow of the flames
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, a, rgb) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const tc of s.torches) {
      const below = idx(tc.x, tc.y + 1);
      if (!s.vis[below] && !s.vis[idx(tc.x, tc.y)]) continue;
      const f = 1 + Math.sin(now / 70 + tc.phase) * 0.08;
      glow(ox + (tc.x + 0.5) * tile, oy + (tc.y + 0.7) * tile, tile * 3.2 * f, 0.15, '255,140,50');
      glow(ox + (tc.x + 0.5) * tile, oy + (tc.y + 0.45) * tile, tile * 0.6 * f, 0.35, '255,190,90');
    }
    for (const o of s.decor.values()) {
      if (!o.light || !s.vis[idx(o.x, o.y)]) continue;
      const crystal = o.kind === 'crystal' || o.kind === 'crystals';
      const pulse = crystal ? 0.5 + 0.5 * Math.sin(now / 650 + o.x * 2 + o.y) : 0;
      glow(ox + (o.x + 0.5) * tile, oy + (o.y + 0.5) * tile, tile * (crystal ? 1.3 + pulse * 0.4 : o.merchant ? 2 : 1.6), crystal ? 0.12 + pulse * 0.1 : 0.12, decorColor(o).glow);
    }
    for (const it of s.items.values()) {
      if (it.kind === 'artifact' && s.vis[idx(it.x, it.y)]) glow(ox + (it.x + 0.5) * tile, oy + (it.y + 0.5) * tile, tile * 1.8, 0.3 + 0.1 * Math.sin(now / 400), '255,60,90');
    }
    // known magic traps shimmer faintly
    for (const tr of s.traps.values()) {
      if (!tr.known || !s.vis[idx(tr.x, tr.y)] || (tr.kind !== 'teleport' && tr.kind !== 'fire')) continue;
      glow(ox + (tr.x + 0.5) * tile, oy + (tr.y + 0.5) * tile, tile * 0.9, 0.1 + 0.04 * Math.sin(now / 300 + tr.x), tr.kind === 'fire' ? '255,120,40' : '150,120,255');
    }
    // red glow over and around the lava
    for (const c of lavaCells) {
      if (!s.vis[c]) continue;
      const x = c % W, y = (c / W) | 0;
      glow(ox + (x + 0.5) * tile, oy + (y + 0.5) * tile, tile * 2.3, 0.11 + 0.03 * Math.sin(now / 350 + x * 2 + y), '255,80,20');
    }
    glow(ox + (hp.x + 0.5) * tile, oy + (hp.y + 0.5) * tile, tile * 4.5 * flick, 0.06, '255,170,100');
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lm, ox, oy, W * tile, H * tile);
  }

  function minimap(s) {
    if (mini.hidden) return;
    const d = mdata.data, t = s.map.t;
    for (let c = 0; c < W * H; c++) {
      const i = c * 4;
      let r = 0, g = 0, b = 0, a = 0;
      if (s.seen[c]) {
        const v = t[c];
        a = 255;
        if (v === T.WALL) { r = 92; g = 92; b = 112; }
        else if (v === T.DOWN) { r = 255; g = 214; b = 74; }
        else if (v === T.WATER) { r = 40; g = 100; b = 200; }
        else if (v === T.LAVA) { r = 220; g = 70; b = 20; }
        else if (v === T.DOOR || v === T.OPEN) { r = 150; g = 100; b = 50; }
        else { r = 40; g = 40; b = 52; }
        if (!s.vis[c] && v !== T.DOWN) { r *= 0.7; g *= 0.7; b *= 0.7; }
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
    }
    const dot = (x, y, r, g, b) => { const i = idx(x, y) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
    for (const c of s.chests.values()) if (s.seen[idx(c.x, c.y)]) dot(c.x, c.y, 230, 160, 60);
    for (const m of s.monsters) if (s.vis[idx(m.x, m.y)]) dot(m.x, m.y, 255, 60, 60);
    dot(s.hero.x, s.hero.y, 255, 255, 255);
    mctx.putImageData(mdata, 0, 0);
  }

  return { init, resize, play, frame, busy, reset, monsterSprite, rewindFlash };
})();
