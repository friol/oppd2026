'use strict';

// Game rules: levels, hero, monsters, items, traps and turns. No DOM.
// act(s, action) plays one player action and returns a list of events
// that main.js turns into animations, sounds and messages.
const Game = (() => {
  const D = (typeof Dungeon !== 'undefined') ? Dungeon : require('./dungeon.js');
  const F = (typeof FOV !== 'undefined') ? FOV : require('./fov.js');
  const { T, W, H, idx, int, pick } = D;

  const SIGHT = 8;            // hero view radius
  const NOTICE = 8;           // monsters notice the hero within this distance
  const TRACK = 7;            // turns a monster keeps hunting after losing sight
  const HERO_HIT = 0.88;
  const MONSTER_HIT = 0.72;
  const CRIT = 0.1;
  const KILLS_PER_STR = 8;    // every so many kills the hero gets stronger
  const SPOT = 0.3;           // chance per turn to spot a trap nearby
  const SNEAK = 1.5;          // damage against a monster that has not noticed you

  // the three classes: same hero, different colours and gifts
  const CLASSES = {
    warrior: { name: 'Warrior', armor: 'leather', sneak: SNEAK, info: 'Starts with leather armour' },
    rogue: { name: 'Rogue', sneak: 3, trapsight: true, info: 'Sees every trap in view, triple damage with sneak attacks' },
    mage: { name: 'Mage', sneak: SNEAK, scholar: true, info: 'Knows every scroll from the start' },
  };
  const LOOKS = [[0, -1, 'up'], [0, 1, 'down'], [-1, 0, 'left'], [1, 0, 'right']];

  // stats at the depth where they first appear; they grow deeper down
  const MONSTERS = {
    slime: { hp: 7, str: 2, xp: 3, min: 1, cols: 3, slow: true },
    bat: { hp: 5, str: 2, xp: 3, min: 1, cols: 2, erratic: 0.45 },
    skeleton: { hp: 11, str: 4, xp: 6, min: 1, cols: 3 },
    goblin: { hp: 13, str: 5, xp: 8, min: 2, cols: 3, ranged: { kind: 'arrow', str: 4, range: 5, chance: 0.25 } },
    spider: { hp: 10, str: 4, xp: 9, min: 3, cols: 1, poison: 3, ranged: { kind: 'poison_bolt', str: 3, range: 4, chance: 0.3, poison: 3 } },
    ghost: { hp: 14, str: 6, xp: 12, min: 4, cols: 2, evade: 0.25 },
    eyeball: { hp: 12, str: 4, xp: 14, min: 5, cols: 2, ranged: { kind: 'bolt', str: 6, range: 6, chance: 0.5 } },
    demon: { hp: 30, str: 9, xp: 30, min: 7, cols: 2, ranged: { kind: 'fireball', str: 10, range: 6, chance: 0.35 } },
    // never spawned at random: see addShade
    shade: { hp: 0, str: 0, xp: 0, min: Infinity, cols: 1, relentless: true, noSleep: true },
    // a chest with teeth, only on the topsy-turvy levels
    mimic: { hp: 0, str: 0, xp: 0, min: Infinity, cols: 1, noSleep: true },
  };

  const TRAPS = {
    spikes: { name: 'spike trap', min: 1 },
    fire: { name: 'fire trap', min: 2 },
    // 'trap' is drawn as a trapdoor on the sheet: it drops the hero to the next level;
    // 'pit' is a shallow hole that hurts and takes a few turns to climb out of
    trap: { name: 'trapdoor', min: 2 },
    teleport: { name: 'teleport rune', min: 3 },
    pit: { name: 'pit', min: 1 },
  };

  // scrolls are read whenever the player wants; turns > 0 means a timed effect
  const SCROLLS = {
    mapping: { name: 'Mapping', weight: 22, info: 'Reveals the whole level and its traps' },
    teleport: { name: 'Teleport', weight: 18, info: 'Takes you to a far corner of the level' },
    invisibility: { name: 'Invisibility', weight: 16, turns: 15, info: 'Monsters cannot see you; attacking breaks it' },
    invincibility: { name: 'Invincibility', weight: 12, turns: 10, info: 'Nothing can hurt you' },
    fire: { name: 'Firestorm', weight: 14, info: 'Burns every monster in sight' },
    sleep: { name: 'Slumber', weight: 18, info: 'Every monster in sight falls asleep' },
  };
  // scrolls start unidentified: each game gives every kind a random label
  const SYLLABLES = ['ZU', 'MBA', 'KLA', 'TOO', 'NEB', 'RAX', 'VEL', 'OSH', 'PRI', 'GAN', 'DUR', 'ELK', 'YUM', 'BOR', 'FEX', 'QUA', 'ITH', 'NOR'];

  // equipment: weapons add to the damage, armour soaks part of each blow
  const GEAR = {
    dagger: { slot: 'weapon', name: 'Dagger', atk: 1, tier: 0 },
    shortsword: { slot: 'weapon', name: 'Short sword', atk: 2, tier: 1 },
    mace: { slot: 'weapon', name: 'Mace', atk: 3, tier: 2 },
    axe: { slot: 'weapon', name: 'Battle axe', atk: 4, tier: 3 },
    longsword: { slot: 'weapon', name: 'Longsword', atk: 5, tier: 4 },
    runeblade: { slot: 'weapon', name: 'Runeblade', atk: 7, tier: 5 },
    leather: { slot: 'armor', name: 'Leather armour', def: 1, tier: 0 },
    studded: { slot: 'armor', name: 'Studded leather', def: 2, tier: 1 },
    chainmail: { slot: 'armor', name: 'Chainmail', def: 3, tier: 2 },
    scale: { slot: 'armor', name: 'Scale mail', def: 4, tier: 3 },
    plate: { slot: 'armor', name: 'Plate armour', def: 5, tier: 4 },
    dragon: { slot: 'armor', name: 'Dragon scale', def: 7, tier: 5 },
  };
  const DEF_DODGE = 0.015;    // each point of defence makes monsters miss a bit more
  const GEAR_ON_FLOOR = 0.35; // chance of a piece of equipment lying on each level

  // a boss every BOSS_EVERY levels guards the stairs, a different one each time;
  // after the last one the list starts again, stronger
  const BOSS_EVERY = 5;
  const BOSSES = [
    { base: 'slime', name: 'Slime King', hp: 90, str: 11, summon: { type: 'slime', every: 4, max: 4 },
      intro: 'A wet, gurgling sound fills the level: the Slime King guards the stairs down.' },
    { base: 'skeleton', name: 'Bone Lord', hp: 120, str: 14, summon: { type: 'skeleton', every: 5, max: 3 },
      intro: 'Bones rattle in the dark: the Bone Lord guards the stairs down.' },
    { base: 'goblin', name: 'Goblin Warlord', hp: 140, str: 16, ranged: { kind: 'arrow', str: 9, range: 7, chance: 0.5 },
      intro: 'War drums echo through the halls: the Goblin Warlord guards the stairs down.' },
    { base: 'spider', name: 'Broodmother', hp: 150, str: 16, poison: 4, summon: { type: 'spider', every: 5, max: 3 },
      ranged: { kind: 'poison_bolt', str: 8, range: 5, chance: 0.35, poison: 4 },
      intro: 'Webs cover every wall: the Broodmother guards the stairs down.' },
    { base: 'eyeball', name: 'Eye of the Abyss', hp: 160, str: 16, regen: 2, ranged: { kind: 'bolt', str: 14, range: 8, chance: 0.6 },
      intro: 'You feel watched from everywhere: the Eye of the Abyss guards the stairs down.' },
    { base: 'demon', name: 'Archdemon', hp: 210, str: 20, summon: { type: 'bat', every: 4, max: 4 }, ranged: { kind: 'fireball', str: 16, range: 7, chance: 0.45 },
      intro: 'The air burns and smells of sulphur: the Archdemon guards the stairs down.' },
  ];
  const BOSS_SIZE = 1.7;      // drawn this many cells tall

  // the shade of the previous run waits by the stairs of this depth, weaker than it was
  const SHADE_DEPTH = 3;
  const SHADE = { hpK: 0.5, hpMin: 14, hpMax: 40, strK: 0.6, strMin: 3, strMax: 8, xp: 25 };

  const SHELF_FIND = 0.55;   // chance that a bookshelf hides a scroll

  // a merchant on some levels: from MERCHANT_MIN, always on MERCHANT_SURE,
  // never with the shade or a boss; shopping takes no turn
  const MERCHANT_MIN = 2;
  const MERCHANT_SURE = 4;
  const MERCHANT_CHANCE = 0.35;

  // the goal: the Heart of the Deep lies at ARTIFACT_DEPTH in place of the stairs down,
  // guarded by the boss. With it the hero must climb back up through the levels already
  // seen (kept in s.saved, map remembered), filled again by monsters ASCENT_BONUS levels
  // stronger, and walk out of the stairs up of depth 1 to win
  const ARTIFACT_DEPTH = 30;
  const ASCENT_BONUS = 4;
  const WIN_BONUS = 5000;
  const CLIMB_BONUS = 100;   // score for each level climbed back
  const ASCENT_CROWD = 24;   // no more monsters than this after the restock
  const ARTIFACT_NAME = 'The Heart of the Deep';
  const ARTIFACT = 'the Heart of the Deep';
  // what a level is made of, saved when the hero leaves it going down
  const LEVEL_KEYS = ['map', 'monsters', 'items', 'decor', 'chests', 'traps', 'torches', 'seen', 'theme', 'shop', 'fog', 'special', 'arena',
    'arrive', 'night', 'dusk', 'nightfall', 'nightBats'];

  // the Dread: on DREAD_CHANCE of the levels (about 1 in 5), never with a boss or the shade
  // and never on the way back up, an unkillable shadow rises DREAD_DELAY turns after the
  // hero arrives (with a warning DREAD_WARN turns before) and hunts the hero, slowly,
  // until the hero takes the stairs down
  const DREAD_CHANCE = 0.2;
  const DREAD_DELAY = 60;
  const DREAD_WARN = 15;

  // credit at the merchant: one item at a time, CREDIT_RATE times its price, up to
  // CREDIT_LIMIT + CREDIT_PER_DEPTH × depth. Any merchant takes the payment (they are
  // all of the same guild); after DEBT_LEVELS new levels a bounty hunter comes on
  // every level until the debt is paid or the hunter is dead
  const CREDIT_RATE = 1.5;
  const CREDIT_LIMIT = 120;
  const CREDIT_PER_DEPTH = 25;
  const DEBT_LEVELS = 3;

  // nests: from NEST_MIN, NEST_CHANCE of the levels; while the hero is within NEST_RANGE
  // a nest hatches a monster every NEST_EVERY turns, NEST_MAX alive at a time
  const NEST_MIN = 3;
  const NEST_CHANCE = 0.3;
  const NEST_EVERY = 10;
  const NEST_MAX = 3;
  const NEST_RANGE = 12;
  const NEST_TYPES = ['spider', 'slime', 'bat', 'skeleton'];

  // rare special levels: from SPECIAL_MIN, SPECIAL_CHANCE of the dungeon levels without
  // a boss, the shade, the Heart or the Dread
  const SPECIAL_MIN = 3;
  const SPECIAL_CHANCE = 0.12;
  const SPECIALS = {
    gauntlet: { name: 'The Gauntlet', intro: 'No monster dares to live here. The dark is full of traps: every step could be your last. A treasure waits by the stairs.' },
    arena: { name: 'The Arena', intro: 'The roar of a crowd echoes from afar. Somewhere on this level a gong waits to be struck.' },
    topsy: { name: 'Topsy-turvy', intro: 'Everything feels upside down here. The monsters smile at you... and the chests seem to be watching.' },
  };
  const GAUNTLET_TRAPS = 45;
  const ARENA_WAVES = 3;

  // a black cat shows up on some levels, follows the hero for a while and purrs
  // (1 HP, at most CAT_HEALS times) after CAT_PURR turns side by side
  const CAT_MIN = 2;
  const CAT_CHANCE = 0.3;
  const CAT_LIFE = [14, 24];
  const CAT_PURR = 3;
  const CAT_HEALS = 3;

  // a wishing well: WELL_COST gold per wish, WELL_USES wishes, usually nothing happens
  const WELL_CHANCE = 0.3;
  const WELL_COST = 10;
  const WELL_USES = 3;
  const ECHOES = [
    'Plop. A distant echo... and that is all.',
    'The coin sinks without a sound. Somewhere below, a frog laughs.',
    'Ripples spread and fade. Nothing happens.',
    'A faint "thank you" rises from the depths. That is all.',
    'The water swallows your coin, and your hopes with it.',
  ];

  // in the garden evening falls after DUSK_START turns, and it is night DUSK_LEN turns later
  const DUSK_START = 90;
  const DUSK_LEN = 50;
  const NIGHT_BATS = 3;

  // a random name for every hero
  const NAMES = ['Gorbag', 'Elsa', 'Brann', 'Mirela', 'Tobin', 'Ysolde', 'Corwin', 'Nettle', 'Fenwick', 'Rhosyn',
    'Aldo', 'Petra', 'Quill', 'Saffi', 'Dunstan', 'Marigold', 'Osric', 'Wren', 'Bartolo', 'Ilsa'];
  const EPITHETS = ['the Wary', 'the Absent-minded', 'the Bold', 'the Unlucky', 'the Hungry', 'the Lost', 'the Stubborn',
    'the Clumsy', 'the Brave-ish', 'the Sleepy', 'the Curious', 'the Unready', 'the Loud', 'the Patient', 'the Humble'];

  // drifting mist on some levels, only a look: from FOG_MIN, FOG_CHANCE of the
  // levels (a theme may set its own `fog` chance and `fogColor`)
  const FOG_MIN = 2;
  const FOG_CHANCE = 0.3;

  const LOOT = [
    ['coins', 35], ['potion', 22], ['gear', 14], ['gem', 12], ['scroll', 10],
    ['heart', 8], ['ring', 7], ['crown', 4], ['pickaxe', 4], ['hourglass', 2],
  ];
  const PICK_DIGS = 6;        // digs of a pickaxe found
  const HOURGLASS_MAX = 3;    // charges of the hourglass at most
  const REWIND = 10;          // turns turned back by the hourglass
  const HEIR_POTIONS = 3;     // potions that can be left to the heir at most

  // dressing by theme, changing every three depths
  const THEMES = [
    { name: 'Crypt', small: ['bone', 'bone2', 'bones', 'skull_small', 'rocks', 'candle'],
      furniture: ['barrel', 'crate', 'urn', 'table', 'chair'] },
    { name: 'Caverns', small: ['rocks', 'mushroom', 'mushroom2', 'weeds', 'crystals', 'bones'],
      furniture: ['barrel', 'crate', 'urn', 'crystal'] },
    { name: 'Inferno', small: ['bones', 'bone', 'skull_small', 'rocks', 'candle'],
      furniture: ['urn', 'barrel', 'crate'] },
  ];
  const BREAKABLE = { barrel: 1, crate: 1, urn: 1 };
  const LIGHTS = { candle: 2.6, crystals: 1.6, crystal: 2.2 };
  // look of the dungeon themes, read by render.js
  Object.assign(THEMES[0], { floor: 'floor', extra: [], dark: [3, 3, 9] });
  Object.assign(THEMES[1], { floor: 'dtile_0_0', extra: [], dark: [2, 5, 12] });
  Object.assign(THEMES[2], { floor: 'dtile_2_1', extra: ['dtile_2_10', 'dtile_2_11'], dark: [14, 3, 2], fogColor: '150,120,110' });

  // scenario levels in the open: every SCENARIO_EVERY levels, but never on a boss level.
  // Walls become thick vegetation (plants), corridors become paths, there are no doors
  // or torches but more daylight; favour lists the monsters that are more common there.
  const SCENARIO_EVERY = 6;
  const SCENARIOS = [
    { name: 'Overgrown Garden', outdoor: true, floor: 'grass', path: 'sand', plants: ['tree', 'bush', 'tree', 'pine'],
      small: ['flower', 'weeds', 'mushroom', 'mushroom2', 'rocks', 'flower'], furniture: ['tree', 'bush'],
      pool: 0.5, ambient: 0.5, remembered: 0.68, dark: [2, 10, 4], favour: ['slime', 'spider', 'bat'], rays: true,
      intro: 'Sunlight pours through a crack far above: a wild garden has taken over this level.' },
    { name: 'Desert Ruins', outdoor: true, floor: 'sand', path: 'floor', plants: ['cactus', 'rocks', 'cactus'],
      small: ['bones', 'skull_small', 'rocks', 'bone2', 'bone'], furniture: ['cactus', 'urn', 'crate'],
      pool: 0.12, ambient: 0.55, remembered: 0.66, dark: [16, 9, 2], favour: ['skeleton', 'goblin'], fog: 0.15, fogColor: '235,210,165',
      intro: 'Hot wind and drifting sand: the ruins of a buried city stretch before you.' },
    { name: 'Frozen Hollow', outdoor: true, floor: 'snow', path: 'floor', plants: ['pine', 'frost', 'pine'],
      small: ['crystals', 'rocks', 'bones', 'frost'], furniture: ['pine', 'frost', 'crystal'],
      pool: 0.4, ambient: 0.48, remembered: 0.7, dark: [4, 8, 18], favour: ['ghost', 'eyeball', 'bat'], fog: 0.75,
      intro: 'Your breath turns to mist: snow covers everything in this frozen hollow.' },
  ];
  const PLANTS = { tree: 1, pine: 1, bush: 1, cactus: 1, frost: 1, crystal: 1 };

  function theme(depth) {
    if (depth % SCENARIO_EVERY === 0 && depth % BOSS_EVERY !== 0) {
      return SCENARIOS[(depth / SCENARIO_EVERY - 1) % SCENARIOS.length];
    }
    return THEMES[Math.floor((depth - 1) / 3) % THEMES.length];
  }

  const xpFor = (lvl) => Math.round(10 * Math.pow(lvl, 1.45));
  const roll = (rnd, str) => int(rnd, Math.ceil(str / 2), str);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const nm = (m) => m.name || m.type;
  const an = (w) => (/^[aeiou]/.test(w) ? 'an ' : 'a ') + w;

  // past: what is left of the previous run (see pastRecord), or null
  // heir: { from, item: { kind, id, n } }, the heirloom left by the previous hero
  function create(seed = (Math.random() * 2 ** 32) >>> 0, past = null, cls = 'warrior', heir = null) {
    if (!CLASSES[cls]) cls = 'warrior';
    const C = CLASSES[cls];
    // the name has its own random numbers, so it does not change the dungeon
    const nr = D.rng((seed ^ 0x5bd1e995) >>> 0);
    const name = pick(nr, NAMES) + ' ' + pick(nr, EPITHETS);
    const s = {
      seed, rnd: D.rng(seed), depth: 0, turn: 0, over: false, cause: '', nextId: 1, past,
      hero: {
        id: 0, x: 0, y: 0, dir: 'down', hp: 24, maxHp: 24, str: 5, lvl: 1, xp: 0, xpTotal: 0,
        gold: 0, spent: 0, kills: 0, potions: 1, scrolls: {}, poison: 0, stuck: 0, invisible: 0, invincible: 0,
        weapon: 'dagger', armor: C.armor || null, cls, name, digs: 0, hourglass: 0, parent: heir ? heir.from : null,
      },
      labels: {}, identified: {},
      saved: {}, maxDepth: 0, climbed: 0, ascending: false, won: false, debt: null, levels: 0,
    };
    const used = new Set();
    for (const k of Object.keys(SCROLLS)) {
      let label;
      do {
        const pool = SYLLABLES.slice();
        label = '';
        for (let i = 0, n = int(s.rnd, 2, 3); i < n; i++) label += pool.splice(Math.floor(s.rnd() * pool.length), 1)[0];
      } while (used.has(label));
      used.add(label);
      s.labels[k] = label;
      if (C.scholar) s.identified[k] = true;
    }
    if (heir && heir.item) inherit(s.hero, heir.item);
    newLevel(s);
    return s;
  }

  function newLevel(s) {
    const rnd = s.rnd;
    s.depth++;
    s.levels++;
    const th = theme(s.depth);
    const map = D.generate(s.depth, rnd, th);
    Object.assign(s, {
      map, monsters: [], items: new Map(), decor: new Map(), chests: new Map(), traps: new Map(),
      torches: [], seen: new Uint8Array(W * H), vis: new Uint8Array(W * H),
      theme: th, shop: null, cat: null, catAt: 0, dread: null, special: null, arena: null, arrive: s.turn, night: 0, dusk: false, nightfall: false, nightBats: 0,
      fog: s.depth >= FOG_MIN && rnd() < (th.fog ?? FOG_CHANCE),
    });
    const h = s.hero;
    h.x = map.start.x; h.y = map.start.y; h.dir = 'down'; h.stuck = 0;

    const t = map.t;
    const free = (x, y) => t[idx(x, y)] === T.FLOOR && !occupied(s, x, y) && !(x === h.x && y === h.y);
    const roomCells = (r, edgeOnly) => {
      const out = [];
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
          if ((!edgeOnly || edge) && free(x, y)) out.push([x, y]);
        }
      }
      return out;
    };
    const nearEntrance = (x, y) => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const c = idx(x + dx, y + dy);
          if (map.corridor[c] || t[c] === T.DOOR || t[c] === T.DOWN || t[c] === T.UP) return true;
        }
      }
      return false;
    };
    const others = map.rooms.filter(r => r !== map.startRoom);

    // blocking things go one at a time, and only if every walkable cell stays reachable
    const reachableAll = () => {
      const pass = (v, c) => D.walkable(v) && !s.decor.get(c)?.block && !s.chests.has(c);
      const d = D.distances(t, h.x, h.y, pass);
      for (let c = 0; c < W * H; c++) if (pass(t[c], c) && d[c] < 0) return false;
      return true;
    };
    const place = (map_, c, obj) => {
      map_.set(c, obj);
      if (!reachableAll()) { map_.delete(c); return false; }
      return true;
    };

    // chests
    const chests = int(rnd, 2, 3);
    for (let i = 0, n = 0; i < 40 && n < chests; i++) {
      const cells = roomCells(pick(rnd, others), true).filter(([x, y]) => !nearEntrance(x, y));
      if (!cells.length) continue;
      const [x, y] = pick(rnd, cells);
      if (place(s.chests, idx(x, y), { x, y })) n++;
    }
    // a wishing well in a room, now and then
    if (others.length && s.depth >= 2 && rnd() < WELL_CHANCE) {
      for (let i = 0; i < 20; i++) {
        const r = pick(rnd, others);
        const cells = roomCells(r, false).filter(([x, y]) => x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1 && !nearEntrance(x, y));
        if (!cells.length) continue;
        const [x, y] = pick(rnd, cells);
        if (place(s.decor, idx(x, y), { x, y, kind: 'well', block: true, well: true, uses: WELL_USES })) break;
      }
    }
    // the cat comes later, if at all
    if (s.depth >= CAT_MIN && s.depth % BOSS_EVERY !== 0 && rnd() < CAT_CHANCE) s.catAt = s.turn + int(rnd, 8, 40);
    // the merchant stands inside a room, away from the doors
    const shopHere = s.depth >= MERCHANT_MIN && s.depth % BOSS_EVERY !== 0 && !(s.past && s.depth === SHADE_DEPTH);
    if (shopHere && others.length && (s.depth === MERCHANT_SURE || rnd() < MERCHANT_CHANCE)) {
      for (let i = 0; i < 30 && !s.shop; i++) {
        const r = pick(rnd, others);
        const cells = roomCells(r, false).filter(([x, y]) => x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1 && !nearEntrance(x, y));
        if (!cells.length) continue;
        const [x, y] = pick(rnd, cells);
        if (place(s.decor, idx(x, y), { x, y, kind: 'merchant', block: true, merchant: true, light: 2.5 })) s.shop = { x, y, stock: stock(s), met: false };
      }
    }
    // furniture along room edges, small dressing anywhere
    // bookshelves against the top wall, in every theme; they may hide a scroll
    const shelfRooms = th.outdoor ? [] : others.filter(() => rnd() < 0.2);
    if (!th.outdoor && !shelfRooms.length && others.length) shelfRooms.push(pick(rnd, others));
    for (const r of shelfRooms) {
      const cells = roomCells(r, true).filter(([x, y]) => y === r.y && !nearEntrance(x, y));
      const n = Math.min(cells.length, rnd() < 0.25 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        const [x, y] = cells.splice(Math.floor(rnd() * cells.length), 1)[0];
        place(s.decor, idx(x, y), { x, y, kind: 'bookshelf', block: true, shelf: true });
      }
    }
    for (const r of map.rooms) {
      const n = int(rnd, 0, Math.min(4, Math.floor(r.w * r.h / 14))) + (th.outdoor ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const cells = roomCells(r, true).filter(([x, y]) => !nearEntrance(x, y));
        if (!cells.length) break;
        const [x, y] = pick(rnd, cells);
        let kind = pick(rnd, th.furniture);
        place(s.decor, idx(x, y), { x, y, kind, block: true, breakable: !!BREAKABLE[kind], plant: !!PLANTS[kind], light: LIGHTS[kind] });
      }
      const m = int(rnd, 1, 3);
      for (let i = 0; i < m; i++) {
        const cells = roomCells(r, false);
        if (!cells.length) break;
        const [x, y] = pick(rnd, cells);
        const kind = pick(rnd, th.small);
        s.decor.set(idx(x, y), { x, y, kind, block: false, light: LIGHTS[kind] });
      }
      // cobwebs in the corners
      if (!th.outdoor && rnd() < 0.4) {
        const [x, y] = pick(rnd, [[r.x, r.y], [r.x + r.w - 1, r.y]]);
        if (free(x, y) && !nearEntrance(x, y)) s.decor.set(idx(x, y), { x, y, kind: 'web', block: false });
      }
    }
    // torches on the top wall of the rooms
    for (const r of th.outdoor ? [] : map.rooms) {
      const n = r.w >= 8 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? r.cx : (i === 0 ? r.x + 1 : r.x + r.w - 2);
        if (t[idx(x, r.y - 1)] === T.WALL && rnd() < 0.8) s.torches.push({ x, y: r.y - 1, phase: rnd() * 6 });
      }
    }
    // items on the floor
    for (let i = 0, n = int(rnd, 2, 4); i < n; i++) {
      const cells = roomCells(pick(rnd, others), false);
      if (cells.length) { const [x, y] = pick(rnd, cells); s.items.set(idx(x, y), { x, y, kind: 'coins' }); }
    }
    if (rnd() < 0.6) {
      const cells = roomCells(pick(rnd, others), false);
      if (cells.length) { const [x, y] = pick(rnd, cells); s.items.set(idx(x, y), { x, y, kind: 'potion' }); }
    }
    if (rnd() < GEAR_ON_FLOOR) {
      const cells = roomCells(pick(rnd, others), false);
      if (cells.length) { const [x, y] = pick(rnd, cells); s.items.set(idx(x, y), { x, y, kind: 'gear', id: rollGear(s) }); }
    }
    // hidden traps, also in corridors, never next to the stairs
    const shadeHere = s.past && s.depth === SHADE_DEPTH;
    const bossHere = s.depth % BOSS_EVERY === 0;
    const special = !s.ascending && s.depth >= SPECIAL_MIN && !bossHere && !shadeHere && !th.outdoor && s.depth !== ARTIFACT_DEPTH &&
      rnd() < SPECIAL_CHANCE ? pick(rnd, Object.keys(SPECIALS)) : null;
    s.special = special;
    // no trapdoors on the levels of the shade and the bosses: there is no falling past them
    const kinds = Object.keys(TRAPS).filter(k => TRAPS[k].min <= s.depth && !((shadeHere || bossHere) && k === 'trap'));
    const traps = special === 'gauntlet' ? GAUNTLET_TRAPS : Math.min(12, 3 + s.depth);
    for (let i = 0, n = 0; i < (special === 'gauntlet' ? 3000 : 200) && n < traps; i++) {
      const x = int(rnd, 1, W - 2), y = int(rnd, 1, H - 2);
      const c = idx(x, y);
      if (!free(x, y) || s.traps.has(c) || map.roomAt(x, y) === map.startRoom) continue;
      if (Math.abs(x - map.down.x) + Math.abs(y - map.down.y) < 3) continue;
      if (Math.abs(x - h.x) + Math.abs(y - h.y) < 5) continue;
      s.traps.set(c, { x, y, kind: pick(rnd, kinds), known: false });
      n++;
    }
    // monsters, none in the start room
    const types = Object.keys(MONSTERS).filter(k => MONSTERS[k].min <= s.depth);
    const weights = types.map(k => (s.depth - MONSTERS[k].min < 4 ? 3 : 1) * (th.favour && th.favour.includes(k) ? 3 : 1));
    const count = special === 'gauntlet' ? 0 : Math.round(Math.min(22, 6 + Math.round(s.depth * 1.5)) * (special === 'arena' ? 0.5 : 1));
    for (let i = 0, n = 0; i < 300 && n < count; i++) {
      const r = pick(rnd, others);
      const cells = roomCells(r, false).filter(([x, y]) => !s.traps.has(idx(x, y)));
      if (!cells.length) continue;
      const [x, y] = pick(rnd, cells);
      s.monsters.push(spawn(s, pickWeighted(rnd, types, weights), x, y));
      n++;
    }
    if (shadeHere) addShade(s);
    if (bossHere) addBoss(s);
    // inside a room, not by its walls or doors
    const inner = (r) => roomCells(r, false).filter(([x, y]) => x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1 && !nearEntrance(x, y) && !s.traps.has(idx(x, y)));
    if (special === 'gauntlet') {
      // darkness: no torches, no candles; a treasure next to the stairs down
      s.torches = [];
      for (const [c, d] of s.decor) if (d.light && !d.merchant) s.decor.delete(c);
      const dn = map.down;
      let placed = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = dn.x + dx, y = dn.y + dy, c = idx(x, y);
        if (placed < 2 && free(x, y) && !s.traps.has(c) && place(s.chests, c, { x, y, rich: true })) placed++;
      }
    } else if (special === 'arena') {
      const room = others.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
      const cells = inner(room).sort((a, b) => Math.hypot(a[0] - room.cx, a[1] - room.cy) - Math.hypot(b[0] - room.cx, b[1] - room.cy));
      for (const [x, y] of cells) {
        if (place(s.decor, idx(x, y), { x, y, kind: 'gong', block: true, gong: true })) {
          s.arena = { x, y, room: { x: room.x, y: room.y, w: room.w, h: room.h }, wave: 0, started: false, done: false };
          break;
        }
      }
      // the arena starts empty
      s.monsters = s.monsters.filter(m => !(m.x >= room.x && m.x < room.x + room.w && m.y >= room.y && m.y < room.y + room.h));
    } else if (special === 'topsy') {
      for (let i = 0, n = 0; i < 40 && n < 3; i++) {
        const cells = roomCells(pick(rnd, others), true).filter(([x, y]) => !nearEntrance(x, y));
        if (!cells.length) continue;
        const [x, y] = pick(rnd, cells);
        if (place(s.chests, idx(x, y), { x, y })) n++;
      }
      for (const ch of s.chests.values()) ch.mimic = true;
      for (const m of s.monsters) { m.peaceful = true; m.asleep = false; }
    }
    // a nest in one of the rooms
    if (!special && !bossHere && !shadeHere && s.depth >= NEST_MIN && s.depth !== ARTIFACT_DEPTH && rnd() < NEST_CHANCE) {
      const kinds = NEST_TYPES.filter(k => MONSTERS[k].min <= s.depth);
      for (let i = 0; i < 20; i++) {
        const cells = inner(pick(rnd, others));
        if (!cells.length) continue;
        const [x, y] = pick(rnd, cells);
        const hp = 18 + 3 * s.depth;
        if (place(s.decor, idx(x, y), { x, y, kind: 'nest', block: true, nest: true, type: pick(rnd, kinds), hp, maxHp: hp, cool: 0, id: s.nextId++ })) break;
      }
    }
    // the end of the descent: the Heart of the Deep instead of the stairs down
    if (s.depth === ARTIFACT_DEPTH) {
      const d = map.down;
      map.t[idx(d.x, d.y)] = T.FLOOR;
      s.items.set(idx(d.x, d.y), { x: d.x, y: d.y, kind: 'artifact' });
    }
    if (!s.ascending && !special && s.depth >= 2 && !bossHere && !shadeHere && s.depth !== ARTIFACT_DEPTH && rnd() < DREAD_CHANCE) {
      s.dread = { at: s.turn + DREAD_DELAY, m: null };
    }
    s.maxDepth = Math.max(s.maxDepth, s.depth);
    updateView(s);
  }

  // ---- heirlooms -------------------------------------------------------------------

  // what the hero can leave to the next one
  function heirlooms(s) {
    const h = s.hero, out = [];
    if (h.weapon && h.weapon !== 'dagger') out.push({ kind: 'gear', id: h.weapon, name: GEAR[h.weapon].name + ' (' + gearStat(GEAR[h.weapon]) + ')', icon: h.weapon });
    if (h.armor) out.push({ kind: 'gear', id: h.armor, name: GEAR[h.armor].name + ' (' + gearStat(GEAR[h.armor]) + ')', icon: h.armor });
    if (h.hourglass) out.push({ kind: 'hourglass', name: 'The hourglass (1 charge)', icon: 'hourglass' });
    if (h.digs) out.push({ kind: 'pickaxe', n: h.digs, name: 'The pickaxe (' + h.digs + ' digs)', icon: 'pickaxe' });
    for (const k of Object.keys(h.scrolls).slice(0, 3)) {
      out.push({ kind: 'scroll', id: k, name: s.identified[k] ? 'A scroll of ' + SCROLLS[k].name : 'A scroll labelled "' + s.labels[k] + '"', icon: 'scroll' });
    }
    if (h.potions) out.push({ kind: 'potion', n: Math.min(HEIR_POTIONS, h.potions), name: Math.min(HEIR_POTIONS, h.potions) + ' healing potion' + (Math.min(HEIR_POTIONS, h.potions) > 1 ? 's' : ''), icon: 'potion' });
    return out;
  }

  function inherit(h, it) {
    if (it.kind === 'gear' && GEAR[it.id]) {
      const g = GEAR[it.id], cur = h[g.slot] ? GEAR[h[g.slot]] : null;
      if (!cur || (g.slot === 'weapon' ? g.atk > cur.atk : g.def > cur.def)) h[g.slot] = it.id;
    } else if (it.kind === 'scroll' && SCROLLS[it.id]) h.scrolls[it.id] = (h.scrolls[it.id] || 0) + 1;
    else if (it.kind === 'potion') h.potions += it.n || 1;
    else if (it.kind === 'hourglass') h.hourglass = Math.min(HOURGLASS_MAX, h.hourglass + 1);
    else if (it.kind === 'pickaxe') h.digs += it.n || PICK_DIGS;
  }

  // ---- the hourglass ------------------------------------------------------------------
  // A snapshot is the state without the levels left behind (they do not change while
  // the hero stays on a level); rewinding loads it, keeps those levels and spends a charge.

  const snapshot = (s) => save(Object.assign({}, s, { saved: {} }));

  function rewind(cur, snap) {
    const s = load(snap);
    if (!s) return null;
    s.saved = cur.saved;
    s.hero.hourglass = Math.max(0, cur.hero.hourglass - 1);
    s.cheated = s.cheated || cur.cheated;
    return s;
  }

  // ---- the pickaxe ------------------------------------------------------------------

  function dig(s, dx, dy, ev) {
    const h = s.hero;
    if (!h.digs) { ev.push({ e: 'msg', text: 'You have no pickaxe.' }); return false; }
    const x = h.x + dx, y = h.y + dy, c = idx(x, y);
    h.dir = LOOKS.find(l => l[0] === dx && l[1] === dy)[2];
    if (tile(s, x, y) !== T.WALL) { ev.push({ e: 'msg', text: 'There is no wall to dig there.' }); return false; }
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) { ev.push({ e: 'msg', text: 'This rock is too hard, even for your pickaxe.' }); return false; }
    s.map.t[c] = T.FLOOR;
    s.map.corridor[c] = 1;
    // the rock behind becomes a wall, so the new tunnel has sides
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let xx = x - 1; xx <= x + 1; xx++) if (D.inside(xx, yy) && s.map.t[idx(xx, yy)] === T.VOID) s.map.t[idx(xx, yy)] = T.WALL;
    }
    s.torches = s.torches.filter(t => t.x !== x || t.y !== y);
    h.digs--;
    const outdoor = s.theme.outdoor;
    ev.push({ e: 'lunge', who: h, to: { x, y } }, { e: 'dig', x, y }, { e: 'sound', name: 'smash' }, { e: 'status' },
      { e: 'msg', text: (outdoor ? 'You hack a way through the thicket.' : 'You dig through the rock.') + (h.digs ? ' ' + h.digs + (h.digs === 1 ? ' dig' : ' digs') + ' left.' : ' Your pickaxe breaks!'), cls: h.digs ? null : 'warn' });
    return true;
  }

  // ---- saving ----------------------------------------------------------------------
  // The whole state goes to JSON: typed arrays as base64, Maps as their entries; the
  // random generator as its state; animation fields of render.js are left out. On load
  // the functions of the maps are rebuilt and the Dread is linked to its monster again.

  const SAVE_VERSION = 1;
  const EPHEMERAL = { anim: 1, lunge: 1, flash: 1, hop: 1, appear: 1, wob: 1, roomAt: 1, startRoom: 1 };

  function b64(u8) {
    if (typeof btoa === 'function') { let t = ''; for (let i = 0; i < u8.length; i++) t += String.fromCharCode(u8[i]); return btoa(t); }
    return Buffer.from(u8).toString('base64');
  }
  function unb64(text) {
    if (typeof atob === 'function') { const t = atob(text), u8 = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u8[i] = t.charCodeAt(i); return u8; }
    return new Uint8Array(Buffer.from(text, 'base64'));
  }

  function save(s) {
    const o = Object.assign({}, s, { rnd: s.rnd.state(), vis: null, dread: s.dread && { at: s.dread.at, m: s.dread.m ? s.dread.m.id : null } });
    return JSON.stringify({ v: SAVE_VERSION, s: o }, (k, v) => {
      if (EPHEMERAL[k]) return undefined;
      if (v instanceof Uint8Array) return { $u8: b64(v) };
      if (v instanceof Map) return { $map: [...v] };
      return v;
    });
  }

  // null if the text is not a save of this version
  function load(text) {
    let o;
    try {
      o = JSON.parse(text, (k, v) => (v && typeof v === 'object' ? (v.$u8 !== undefined ? unb64(v.$u8) : v.$map ? new Map(v.$map) : v) : v));
    } catch (e) { return null; }
    if (!o || o.v !== SAVE_VERSION || !o.s || !o.s.map) return null;
    const s = o.s;
    s.rnd = D.rng(s.seed, s.rnd);
    const fix = (map) => { map.roomAt = (x, y) => map.rooms.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h); };
    fix(s.map);
    for (const lv of Object.values(s.saved)) fix(lv.map);
    if (s.dread && s.dread.m !== null) {
      const m = s.monsters.find(o2 => o2.id === s.dread.m);
      s.dread = m ? { at: s.dread.at, m } : null;
    }
    s.vis = new Uint8Array(W * H);
    updateView(s);
    return s;
  }

  // ---- the way back up ----------------------------------------------------------

  function saveLevel(s) {
    const lv = {};
    for (const k of LEVEL_KEYS) lv[k] = s[k];
    lv.monsters = s.monsters.filter(m => !m.def.dread);
    s.saved[s.depth] = lv;
  }

  function ascend(s, ev) {
    const h = s.hero;
    if (s.depth === 1) { escape(s, ev); return; }
    const d = s.depth - 1;
    if (s.saved[d]) {
      s.depth = d;
      Object.assign(s, s.saved[d], { cat: null, catAt: 0, dread: null, vis: new Uint8Array(W * H) });
      delete s.saved[d];
    } else {
      // never seen (it should not happen): a new level
      s.depth = d - 1;
      newLevel(s);
    }
    s.climbed++;
    s.levels++;
    h.x = s.map.down.x; h.y = s.map.down.y; h.dir = 'up'; h.stuck = 0;
    s.monsters = s.monsters.filter(m => m.x !== h.x || m.y !== h.y);
    restock(s);
    updateView(s);
    ev.push({ e: 'level', depth: s.depth, fell: false, up: true }, { e: 'sound', name: 'stairs' },
      { e: 'msg', text: 'You climb back to depth ' + s.depth + ' — the ' + s.theme.name + '. Monsters have flocked here, stronger than before.', cls: 'magic' });
    if (s.depth === 1) ev.push({ e: 'msg', text: 'A breath of fresh air: the stairs up lead out of the dungeon!', cls: 'hint' });
    debtCheck(s, ev);
  }

  // monsters come back to the levels on the way up, stronger
  function restock(s) {
    const h = s.hero, rnd = s.rnd;
    const types = Object.keys(MONSTERS).filter(k => MONSTERS[k].min <= s.depth + ASCENT_BONUS);
    const n = Math.min(14, 4 + Math.round(s.depth * 0.6), Math.max(0, ASCENT_CROWD - s.monsters.length));
    for (let i = 0, k = 0; i < 400 && k < n; i++) {
      const x = int(rnd, 1, W - 2), y = int(rnd, 1, H - 2);
      if (tile(s, x, y) !== T.FLOOR || occupied(s, x, y) || s.traps.has(idx(x, y)) || Math.abs(x - h.x) + Math.abs(y - h.y) < 8) continue;
      const m = spawn(s, pick(rnd, types), x, y, ASCENT_BONUS);
      m.asleep = rnd() < 0.2;
      s.monsters.push(m);
      k++;
    }
  }

  function escape(s, ev) {
    s.over = true;
    s.won = true;
    s.cause = 'escaped with ' + ARTIFACT;
    ev.push({ e: 'won' }, { e: 'sound', name: 'levelup' },
      { e: 'msg', text: 'You step out into the sunlight with ' + ARTIFACT + '. Victory!', cls: 'gold' });
  }

  // ---- the Dread ---------------------------------------------------------------------

  const DREAD = Object.assign({}, MONSTERS.ghost, {
    evade: 0, slow: true, erratic: 0, relentless: true, noSleep: true, invincible: true, dread: true, ranged: null, poison: 0,
  });

  function dreadTurn(s, ev) {
    const dr = s.dread, h = s.hero;
    if (!dr || dr.m) return;
    const left = dr.at - s.turn;
    if (left === DREAD_WARN) {
      ev.push({ e: 'msg', text: 'A cold wind rises from the deep. Something has noticed you: do not linger here!', cls: 'warn' }, { e: 'sound', name: 'vanish' });
    }
    if (left > 0) return;
    // it rises far away, out of sight, and comes for the hero
    const pass = (v, c) => D.walkable(v) && v !== T.LAVA && !s.decor.get(c)?.block && !s.chests.has(c);
    const dist = D.distances(s.map.t, h.x, h.y, pass);
    let best = null, bd = -1;
    for (let c = 0; c < W * H; c++) {
      const d = dist[c];
      if (d < 0 || s.vis[c] || s.map.t[c] !== T.FLOOR || occupied(s, c % W, (c / W) | 0)) continue;
      const score = d <= 20 ? d : 40 - d;   // about 20 steps away, if possible
      if (score > bd) { bd = score; best = c; }
    }
    if (best === null) { dr.at = s.turn + 5; return; }
    const m = {
      id: s.nextId++, type: 'ghost', name: 'Dread', def: DREAD, x: best % W, y: (best / W) | 0, hp: 9999, maxHp: 9999,
      str: 7 + s.depth, xp: 0, look: 0, asleep: false, hunting: true, track: TRACK, cool: 0,
    };
    s.monsters.push(m);
    dr.m = m;
    ev.push({ e: 'dread', who: m }, { e: 'sound', name: 'roar' }, { e: 'status' },
      { e: 'msg', text: 'The Dread has risen. It cannot be harmed: run for the stairs down!', cls: 'bad' });
  }

  // a free cell close to the stairs down, clear of other monsters
  function guardSpot(s) {
    const d = s.map.down;
    let spot = null;
    for (let r = 1; r <= 3 && !spot; r++) {
      for (let dy = -r; dy <= r && !spot; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = d.x + dx, y = d.y + dy;
          if (tile(s, x, y) === T.FLOOR && !occupied(s, x, y) && !s.traps.has(idx(x, y))) { spot = { x, y }; break; }
        }
      }
    }
    if (!spot) spot = { x: d.x, y: d.y };
    // monsters standing in its way would only get in the way of the duel
    s.monsters = s.monsters.filter(m => Math.abs(m.x - spot.x) + Math.abs(m.y - spot.y) > 3);
    return spot;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function addBoss(s) {
    const n = s.depth / BOSS_EVERY - 1;
    const b = BOSSES[n % BOSSES.length], round = Math.floor(n / BOSSES.length);
    const base = MONSTERS[b.base];
    const def = Object.assign({}, base, { slow: false, erratic: 0, evade: 0, boss: true, relentless: true, noSleep: true,
      poison: b.poison || base.poison, ranged: b.ranged || null, summon: b.summon || null, regen: b.regen || 0 });
    if (def.ranged && round) def.ranged = Object.assign({}, def.ranged, { str: Math.round(def.ranged.str * (1 + 0.3 * round)) });
    const hp = Math.round(b.hp * (1 + 0.5 * round));
    const spot = guardSpot(s);
    s.monsters.push({
      id: s.nextId++, type: b.base, name: b.name, def, x: spot.x, y: spot.y, hp, maxHp: hp,
      str: Math.round(b.str * (1 + 0.3 * round)), xp: 40 + 6 * s.depth, look: 0,
      asleep: false, hunting: false, track: 0, guard: true, cool: 0, intro: b.intro,
    });
  }

  // the previous hero, as a weaker ghost guarding the stairs down
  function addShade(s) {
    const p = s.past;
    const spot = guardSpot(s);
    const hp = clamp(Math.round(p.maxHp * SHADE.hpK), SHADE.hpMin, SHADE.hpMax);
    const atkBonus = Math.floor((GEAR[p.weapon]?.atk || 0) / 2);
    s.monsters.push({
      id: s.nextId++, type: 'shade', def: MONSTERS.shade, x: spot.x, y: spot.y, hp, maxHp: hp,
      str: clamp(Math.round(p.str * SHADE.strK), SHADE.strMin, SHADE.strMax) + atkBonus, xp: SHADE.xp,
      look: 0, dir: 'down', asleep: false, hunting: false, track: 0, past: p, guard: true,
    });
  }

  // what the shade of this run will remember in the next one
  function pastRecord(s) {
    const h = s.hero;
    return { name: h.name, cls: h.cls, lvl: h.lvl, str: h.str, maxHp: h.maxHp, weapon: h.weapon, armor: h.armor, depth: s.depth, cause: s.cause };
  }

  const guardian = (s) => s.monsters.find(m => m.guard);

  function pickWeighted(rnd, list, weights) {
    let total = weights.reduce((a, b) => a + b, 0), r = rnd() * total;
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r < 0) return list[i]; }
    return list[list.length - 1];
  }

  // bonus: as if the level were so much deeper (the monsters of the way back up)
  function spawn(s, type, x, y, bonus = 0) {
    const def = MONSTERS[type];
    const over = Math.max(0, s.depth + bonus - def.min);
    const k = 1 + 0.15 * over;
    const hp = Math.round(def.hp * k);
    return {
      id: s.nextId++, type, def, x, y, hp, maxHp: hp,
      str: Math.round(def.str * (1 + 0.1 * over)), xp: Math.round(def.xp * k),
      look: int(s.rnd, 0, def.cols - 1), asleep: s.rnd() < 0.45, hunting: false, track: 0,
    };
  }

  const monsterAt = (s, x, y) => s.monsters.find(m => m.x === x && m.y === y);
  function occupied(s, x, y) {
    const c = idx(x, y);
    return !!(s.decor.get(c)?.block || s.chests.has(c) || monsterAt(s, x, y) || (s.cat && s.cat.x === x && s.cat.y === y));
  }
  const tile = (s, x, y) => (D.inside(x, y) ? s.map.t[idx(x, y)] : T.VOID);

  function updateView(s) {
    const h = s.hero;
    s.vis = F.compute(W, H, h.x, h.y, SIGHT, (x, y) => D.opaque(tile(s, x, y)));
    for (let i = 0; i < W * H; i++) if (s.vis[i]) s.seen[i] = 1;
    // the rogue's eye: every trap in view is plain to see
    if (CLASSES[h.cls].trapsight) for (const trap of s.traps.values()) if (s.vis[idx(trap.x, trap.y)]) trap.known = true;
  }

  // ---- actions --------------------------------------------------------------

  function act(s, a) {
    const ev = [];
    if (s.over) return ev;
    const h = s.hero;
    let used = false;
    if (a.type === 'move') used = move(s, a.dx, a.dy, ev);
    else if (a.type === 'wait') { used = true; search(s, ev, 0.5); }
    else if (a.type === 'descend') {
      const v = tile(s, h.x, h.y);
      if (s.ascending) {
        if (v === T.UP) { ascend(s, ev); return ev; }
        ev.push({ e: 'msg', text: v === T.DOWN ? ARTIFACT_NAME + ' pulls you upward: there is no going down now.' : 'There are no stairs up here. Find them!' });
        return ev;
      }
      if (v === T.UP) { ev.push({ e: 'msg', text: 'These stairs lead back up, but your quest lies below.' }); return ev; }
      const g = guardian(s);
      if (tile(s, h.x, h.y) === T.DOWN && g) {
        ev.push({ e: 'msg', text: g.type === 'shade' ? 'An icy force seals the stairs. Your shade will not let you pass.' : 'A dark power seals the stairs while the ' + g.name + ' lives.', cls: 'bad' }, { e: 'sound', name: 'bump' });
        return ev;
      }
      if (tile(s, h.x, h.y) === T.DOWN) { descend(s, ev, false); return ev; }
      ev.push({ e: 'msg', text: 'There are no stairs down here.' });
    } else if (a.type === 'cheat') {
      // straight to the next level, even past the shade; the run is marked as cheated
      if (!s.ascending && s.depth >= ARTIFACT_DEPTH) { ev.push({ e: 'msg', text: 'XYZZY! Nothing happens: the floor is too deep to swallow you.' }); return ev; }
      s.cheated = true;
      ev.push({ e: 'effect', name: 'portal', x: h.x, y: h.y }, { e: 'msg', text: s.ascending ? 'XYZZY! A hollow voice says "Fool." and the ceiling pulls you up.' : 'XYZZY! A hollow voice says "Fool." and the floor swallows you.', cls: 'magic' });
      if (s.ascending) ascend(s, ev); else descend(s, ev, false);
      return ev;
    } else if (a.type === 'quaff') used = quaff(s, ev);
    else if (a.type === 'read') used = read(s, a.scroll, ev);
    else if (a.type === 'buy') buy(s, a.item, ev);
    else if (a.type === 'dig') used = dig(s, a.dx, a.dy, ev);
    if (used && !s.over && s.pendingFall) { s.pendingFall = false; descend(s, ev, true); return ev; }
    if (used && !s.over) endTurn(s, ev);
    return ev;
  }

  function move(s, dx, dy, ev) {
    const h = s.hero;
    h.dir = LOOKS.find(l => l[0] === dx && l[1] === dy)[2];
    const x = h.x + dx, y = h.y + dy, c = idx(x, y);
    if (h.stuck > 0) {
      h.stuck--;
      ev.push({ e: 'msg', text: h.stuck ? 'You claw at the walls of the pit.' : 'You climb out of the pit.' }, { e: 'sound', name: 'step' });
      return true;
    }
    const m = monsterAt(s, x, y);
    if (m) { attack(s, m, ev); return true; }
    if (s.cat && s.cat.x === x && s.cat.y === y) {
      s.cat.near++;
      ev.push({ e: 'msg', text: pick(s.rnd, ['You pet the cat. It closes its eyes.', 'The cat headbutts your hand.', 'You scratch the cat behind the ears.']), cls: 'hint' }, { e: 'sound', name: 'meow' });
      return true;
    }
    if (s.chests.has(c)) { openChest(s, x, y, ev); return true; }
    const d = s.decor.get(c);
    if (d && d.block) {
      if (d.breakable) { smash(s, d, ev); return true; }
      if (d.shelf && !d.searched) { browse(s, d, ev); return true; }
      if (d.well) return wish(s, d, ev);
      if (d.nest) { strikeNest(s, d, ev); return true; }
      if (d.gong) return gong(s, d, ev);
      if (d.merchant) {
        if (s.debt) settle(s, ev);
        ev.push({ e: 'msg', text: s.shop.met ? '"Back again? Take your time."' : '"Welcome, traveller! Gold for goods, goods for gold."', cls: 'gold' }, { e: 'sound', name: 'coin' }, { e: 'shop' });
        s.shop.met = true;
        return false;
      }
      if (d.shelf) ev.push({ e: 'msg', text: 'You have already searched this bookshelf.' });
      ev.push({ e: 'bump', dir: [dx, dy] });
      return false;
    }
    const v = tile(s, x, y);
    if (v === T.WALL || v === T.VOID) { ev.push({ e: 'bump', dir: [dx, dy] }); return false; }
    if (v === T.DOOR) {
      s.map.t[c] = T.OPEN;
      ev.push({ e: 'door', x, y }, { e: 'sound', name: 'door' }, { e: 'msg', text: 'The door creaks open.' });
      return true;
    }
    const from = { x: h.x, y: h.y };
    h.x = x; h.y = y;
    ev.push({ e: 'move', who: h, from, to: { x, y } });
    arrive(s, ev);
    return true;
  }

  function arrive(s, ev) {
    const h = s.hero, c = idx(h.x, h.y);
    const item = s.items.get(c);
    if (item) { s.items.delete(c); gain(s, item.kind, h.x, h.y, ev, item.id); }
    const v = tile(s, h.x, h.y);
    if (v === T.DOWN) ev.push({ e: 'msg', text: 'Stairs lead down into the dark. Press Enter to descend.', cls: 'hint' });
    if (v === T.WATER) ev.push({ e: 'sound', name: 'splash' });
    if (v === T.LAVA) {
      const dmg = 6 + s.depth;
      ev.push({ e: 'effect', name: 'fire', x: h.x, y: h.y }, { e: 'msg', text: 'The lava burns you!', cls: 'bad' });
      hurt(s, dmg, 'burned in lava', ev);
    }
    const trap = s.traps.get(c);
    if (trap && !s.over) spring(s, trap, ev);
  }

  function teleport(s, text, ev) {
    const h = s.hero;
    const cells = [];
    for (let c = 0; c < W * H; c++) {
      const x = c % W, y = (c / W) | 0;
      if (s.map.t[c] === T.FLOOR && !occupied(s, x, y) && !s.traps.has(c) && Math.hypot(x - h.x, y - h.y) > 12) cells.push([x, y]);
    }
    if (!cells.length) return;
    const [x, y] = pick(s.rnd, cells);
    const from = { x: h.x, y: h.y };
    h.x = x; h.y = y;
    ev.push({ e: 'effect', name: 'magic', x: from.x, y: from.y }, { e: 'teleport', who: h, from, to: { x, y } },
      { e: 'effect', name: 'magic', x, y }, { e: 'msg', text, cls: 'magic' }, { e: 'sound', name: 'teleport' });
    updateView(s);
  }

  function spring(s, trap, ev) {
    const h = s.hero;
    const first = !trap.known;
    trap.known = true;
    ev.push({ e: 'trap', kind: trap.kind, x: trap.x, y: trap.y, first });
    switch (trap.kind) {
      case 'spikes':
        ev.push({ e: 'msg', text: 'Spikes shoot up from the floor!', cls: 'bad' }, { e: 'sound', name: 'spikes' });
        hurt(s, 3 + s.depth, 'impaled on a spike trap', ev);
        break;
      case 'fire':
        ev.push({ e: 'effect', name: 'explosion', x: h.x, y: h.y }, { e: 'msg', text: 'A jet of fire engulfs you!', cls: 'bad' }, { e: 'sound', name: 'fire' });
        hurt(s, 4 + s.depth, 'burned by a fire trap', ev);
        break;
      case 'trap':
        ev.push({ e: 'msg', text: 'A trapdoor swings open under your feet!', cls: 'bad' }, { e: 'sound', name: 'door' }, { e: 'sound', name: 'fall' });
        hurt(s, 2 + (s.depth >> 1), 'killed by a fall through a trapdoor', ev);
        // on the way back up there is no falling: the hero clings to the edge
        if (!s.over && s.ascending) ev.push({ e: 'msg', text: 'You grab the edge and haul yourself out of the trapdoor.' });
        else if (!s.over) s.pendingFall = true;
        break;
      case 'teleport':
        teleport(s, 'The rune flares and the world twists around you!', ev);
        break;
      case 'pit':
        h.stuck = 3;
        ev.push({ e: 'msg', text: 'You tumble into a pit! It will take a while to climb out.', cls: 'bad' }, { e: 'sound', name: 'land' });
        hurt(s, 2 + (s.depth >> 1), 'killed by a fall into a pit', ev);
        break;
    }
  }

  function descend(s, ev, fell) {
    saveLevel(s);
    newLevel(s);
    ev.push({ e: 'level', depth: s.depth, fell }, { e: 'sound', name: fell ? 'land' : 'stairs' },
      { e: 'msg', text: (fell ? 'You land hard on depth ' : 'You descend to depth ') + s.depth + ' — the ' + s.theme.name + '.', cls: 'magic' });
    if (s.theme.intro) ev.push({ e: 'msg', text: s.theme.intro, cls: 'hint' });
    if (s.fog) ev.push({ e: 'msg', text: s.theme.name === 'Inferno' ? 'Thick smoke hangs over this level.' : 'A pale mist drifts through this level.', cls: 'hint' });
    if (s.shop) ev.push({ e: 'msg', text: 'You hear the jingle of coins: a merchant has set up shop on this level.', cls: 'gold' });
    const g = guardian(s);
    if (g) ev.push({ e: 'msg', text: g.type === 'shade' ? 'A chill runs down your spine: something familiar waits by the stairs.' : g.intro, cls: 'warn' });
    if (s.dread) ev.push({ e: 'msg', text: 'The air here is heavy and still. Do not linger.', cls: 'warn' });
    if (s.special) ev.push({ e: 'msg', text: SPECIALS[s.special].name + '! ' + SPECIALS[s.special].intro, cls: 'hint' });
    if ([...s.decor.values()].some(d => d.nest)) ev.push({ e: 'msg', text: 'You hear scratching and hatching somewhere: a nest is breeding monsters on this level.', cls: 'warn' });
    debtCheck(s, ev);
    if (s.depth === ARTIFACT_DEPTH) ev.push({ e: 'msg', text: 'There are no stairs below: somewhere on this level lies ' + ARTIFACT + '.', cls: 'gold' });
  }

  function attack(s, m, ev) {
    const h = s.hero, rnd = s.rnd;
    ev.push({ e: 'lunge', who: h, to: { x: m.x, y: m.y } });
    if (m.def.invincible) {
      ev.push({ e: 'miss', x: m.x, y: m.y }, { e: 'sound', name: 'swish' }, { e: 'float', x: m.x, y: m.y, text: 'immune', cls: 'magic' },
        { e: 'msg', text: 'Your blow passes through the ' + nm(m) + ' like smoke. It cannot be harmed!', cls: 'warn' });
      return;
    }
    if (m.peaceful) {
      m.peaceful = false;
      ev.push({ e: 'msg', text: 'The ' + nm(m) + ' stops smiling. Now it is angry!', cls: 'warn' });
    }
    const unaware = m.asleep || !m.hunting;
    if (m.asleep) m.asleep = false;
    if (!m.hunting) { m.hunting = true; m.track = TRACK; }
    if (h.invisible) {
      h.invisible = 0;
      ev.push({ e: 'msg', text: 'You strike and fade back into view!', cls: 'warn' }, { e: 'status' });
    }
    if (rnd() > HERO_HIT) {
      ev.push({ e: 'miss', x: m.x, y: m.y }, { e: 'sound', name: 'swish' }, { e: 'msg', text: 'You miss the ' + nm(m) + '.' });
      return;
    }
    if (m.def.evade && rnd() < m.def.evade) {
      ev.push({ e: 'miss', x: m.x, y: m.y }, { e: 'sound', name: 'swish' }, { e: 'msg', text: 'Your blade passes through the ' + nm(m) + '.' });
      return;
    }
    const crit = rnd() < CRIT;
    const sneak = unaware ? CLASSES[h.cls].sneak : 1;
    const dmg = Math.round((roll(rnd, h.str) + atk(h)) * (crit ? 2 : 1) * sneak);
    m.hp -= dmg;
    ev.push({ e: 'hit', who: m, amount: dmg, crit, x: m.x, y: m.y }, { e: 'sound', name: crit ? 'crit' : 'hit' });
    if (crit) ev.push({ e: 'effect', name: 'explosion', x: m.x, y: m.y });
    if (m.hp <= 0) kill(s, m, ev);
    else if (sneak > 1) ev.push({ e: 'msg', text: 'Sneak attack! The ' + nm(m) + ' never saw you coming.', cls: 'hint' });
    else if (crit) ev.push({ e: 'msg', text: 'A critical hit on the ' + nm(m) + '!' });
  }

  function kill(s, m, ev) {
    const h = s.hero;
    s.monsters.splice(s.monsters.indexOf(m), 1);
    h.kills++;
    ev.push({ e: 'die', who: m }, { e: 'sound', name: 'die' },
      { e: 'msg', text: 'You slay the ' + nm(m) + '. +' + m.xp + ' XP' }, { e: 'float', x: m.x, y: m.y, text: '+' + m.xp + ' XP', cls: 'xp' });
    if (m.type === 'shade') {
      const p = m.past;
      const gear = [p.weapon, p.armor].filter(g => g && g !== 'dagger');
      s.items.set(idx(m.x, m.y), gear.length ? { x: m.x, y: m.y, kind: 'gear', id: pick(s.rnd, gear) } : { x: m.x, y: m.y, kind: 'potion' });
      ev.push({ e: 'effect', name: 'magic', x: m.x, y: m.y }, { e: 'sound', name: 'vanish' },
        { e: 'msg', text: 'Your shade fades with a sigh and leaves something behind. The stairs are free.', cls: 'magic' });
    } else if (m.def.boss) {
      s.items.set(idx(m.x, m.y), { x: m.x, y: m.y, kind: 'gear', id: rollGear(s, 2) });
      ev.push({ e: 'effect', name: 'explosion', x: m.x, y: m.y }, { e: 'sound', name: 'levelup' },
        { e: 'msg', text: 'The ' + m.name + ' falls! The seal on the stairs breaks.', cls: 'good' });
      gain(s, 'crown', m.x, m.y, ev);
    } else if (m.type === 'mimic') {
      ev.push({ e: 'msg', text: 'The mimic falls open: its belly is full of treasure!', cls: 'gold' });
      gain(s, pick(s.rnd, ['gem', 'crown', 'gem']), m.x, m.y, ev);
      gain(s, s.rnd() < 0.5 ? 'gear' : pick(s.rnd, ['heart', 'ring', 'potion']), m.x, m.y, ev);
    } else if (m.def.hunter) {
      s.debt = null;
      ev.push({ e: 'msg', text: 'The bounty hunter falls. Nobody is left to collect your debt.', cls: 'good' }, { e: 'status' });
      gain(s, 'coins', m.x, m.y, ev);
    } else if (s.rnd() < 0.2) s.items.set(idx(m.x, m.y), { x: m.x, y: m.y, kind: s.rnd() < 0.75 ? 'coins' : 'potion' });
    if (h.kills % KILLS_PER_STR === 0) {
      h.str++;
      ev.push({ e: 'msg', text: h.kills + ' foes slain: you feel battle-hardened. STR +1', cls: 'good' }, { e: 'float', x: h.x, y: h.y, text: 'STR +1', cls: 'str' });
    }
    addXp(s, m.xp, ev);
  }

  function addXp(s, n, ev) {
    const h = s.hero;
    h.xp += n; h.xpTotal += n;
    while (h.xp >= xpFor(h.lvl)) {
      h.xp -= xpFor(h.lvl);
      h.lvl++;
      const hp = 5 + int(s.rnd, 0, 3);
      h.maxHp += hp;
      h.hp = Math.min(h.maxHp, h.hp + hp + Math.round(h.maxHp * 0.25));
      h.str++;
      ev.push({ e: 'levelup', lvl: h.lvl }, { e: 'effect', name: 'magic', x: h.x, y: h.y }, { e: 'sound', name: 'levelup' },
        { e: 'msg', text: 'Welcome to level ' + h.lvl + '! HP +' + hp + ', STR +1', cls: 'good' }, { e: 'float', x: h.x, y: h.y, text: 'LEVEL UP', cls: 'lvl' });
    }
  }

  // from: where the blow comes from, if it comes from a monster
  function hurt(s, dmg, cause, ev, from) {
    const h = s.hero;
    if (h.invincible) {
      ev.push({ e: 'float', x: h.x, y: h.y, text: 'immune', cls: 'magic' });
      return;
    }
    h.hp -= dmg;
    ev.push({ e: 'hurt', who: h, amount: dmg, x: h.x, y: h.y, from });
    if (h.hp <= 0) {
      h.hp = 0;
      s.over = true;
      s.cause = cause;
      ev.push({ e: 'dead', cause }, { e: 'sound', name: 'death' }, { e: 'msg', text: 'You die...', cls: 'bad' });
    }
  }

  function gain(s, kind, x, y, ev, id) {
    const h = s.hero, rnd = s.rnd;
    let text, cls = 'gold';
    switch (kind) {
      case 'coins': { const n = int(rnd, 4, 12) + 3 * s.depth; h.gold += n; text = '+' + n + ' gold'; break; }
      case 'gem': { const n = 40 + 20 * s.depth; h.gold += n; text = 'A gem! +' + n + ' gold'; break; }
      case 'crown': { const n = 120 + 40 * s.depth; h.gold += n; text = 'A jewelled crown! +' + n + ' gold'; break; }
      case 'potion': h.potions++; text = 'A healing potion'; cls = 'heal'; break;
      case 'scroll': {
        const keys = Object.keys(SCROLLS);
        const k = pickWeighted(rnd, keys, keys.map(n => SCROLLS[n].weight));
        h.scrolls[k] = (h.scrolls[k] || 0) + 1;
        text = s.identified[k] ? 'A scroll of ' + SCROLLS[k].name : 'A scroll labelled "' + s.labels[k] + '"'; cls = 'magic';
        break;
      }
      case 'gear': { equip(s, id || rollGear(s), x, y, ev); return; }
      case 'ring': h.str++; text = 'A ring of might! STR +1'; cls = 'str'; break;
      case 'heart': h.maxHp += 5; h.hp += 5; text = 'A heart crystal! Max HP +5'; cls = 'heal'; break;
      case 'pickaxe': h.digs += PICK_DIGS; text = 'A pickaxe! ' + h.digs + ' digs: press G and a direction'; cls = 'str'; break;
      case 'hourglass':
        if (h.hourglass >= HOURGLASS_MAX) { const n = 60 + 20 * s.depth; h.gold += n; text = 'An hourglass, but yours is full: you sell the sand. +' + n + ' gold'; break; }
        h.hourglass++;
        text = 'An hourglass of time! ' + h.hourglass + (h.hourglass > 1 ? ' charges' : ' charge') + ': press T to turn back ' + REWIND + ' turns';
        cls = 'magic';
        break;
      case 'artifact':
        s.ascending = true;
        h.artifact = true;
        text = ARTIFACT_NAME + '! Now climb back to the surface';
        cls = 'gold';
        ev.push({ e: 'effect', name: 'magic', x, y }, { e: 'sound', name: 'levelup' }, { e: 'status' },
          { e: 'msg', text: 'The dungeon shudders and groans. Monsters stir on every level above you.', cls: 'warn' });
        break;
    }
    ev.push({ e: 'pickup', kind, x, y }, { e: 'sound', name: kind === 'coins' || kind === 'gem' || kind === 'crown' ? 'coin' : 'pickup' },
      { e: 'float', x, y, text: text.replace(/^A[^!]*! /, ''), cls }, { e: 'msg', text: text + '.', cls });
  }

  // ---- the merchant --------------------------------------------------------

  // what is for sale: prices and gear grow with the depth
  function stock(s) {
    const rnd = s.rnd, d = s.depth, keys = Object.keys(SCROLLS);
    const tier = Math.min(5, Math.floor((d - 1) / 2) + 1);
    const gearOf = (slot) => Object.keys(GEAR).find(k => GEAR[k].slot === slot && GEAR[k].tier === tier);
    // two different scrolls
    const a = pickWeighted(rnd, keys, keys.map(k => SCROLLS[k].weight));
    const rest = keys.filter(k => k !== a);
    const b = pickWeighted(rnd, rest, rest.map(k => SCROLLS[k].weight));
    return [
      { kind: 'potion', price: 25 + 4 * d },
      { kind: 'potion', price: 25 + 4 * d },
      { kind: 'scroll', id: a, price: 35 + 4 * d },
      { kind: 'scroll', id: b, price: 35 + 4 * d },
      { kind: 'gear', id: gearOf('weapon'), price: 60 + 70 * tier },
      { kind: 'gear', id: gearOf('armor'), price: 60 + 70 * tier },
      rnd() < 0.4 ? { kind: 'heart', price: 110 + 12 * d } : rnd() < 0.6 ? { kind: 'ring', price: 140 + 15 * d } : { kind: 'pickaxe', price: 70 + 6 * d },
    ];
  }

  // the stock as the player sees it, for the shop menu
  function shopItems(s) {
    if (!s.shop) return [];
    const h = s.hero;
    return s.shop.stock.map(it => {
      const o = { price: it.price, sold: !!it.sold, afford: h.gold >= it.price, useful: true };
      o.credit = !o.afford && !s.debt && it.price <= creditLimit(s) ? Math.ceil(it.price * CREDIT_RATE) : 0;
      if (it.kind === 'potion') Object.assign(o, { name: 'Healing potion', info: 'Drink it to heal (Q)', icon: 'potion' });
      else if (it.kind === 'heart') Object.assign(o, { name: 'Heart crystal', info: 'Max HP +5', icon: 'heart' });
      else if (it.kind === 'ring') Object.assign(o, { name: 'Ring of might', info: 'STR +1', icon: 'ring' });
      else if (it.kind === 'pickaxe') Object.assign(o, { name: 'Pickaxe', info: PICK_DIGS + ' digs through walls (G and a direction)', icon: 'pickaxe' });
      else if (it.kind === 'scroll') {
        const sc = scrollInfo(s, it.id);
        Object.assign(o, { name: sc.known ? 'Scroll of ' + sc.name : 'Scroll ' + sc.name, info: sc.info, icon: 'scroll' });
      } else {
        const g = GEAR[it.id], cur = h[g.slot] ? GEAR[h[g.slot]] : null;
        o.useful = !cur || (g.slot === 'weapon' ? g.atk > cur.atk : g.def > cur.def);
        Object.assign(o, { name: g.name, icon: it.id, info: gearStat(g) + ' · yours: ' + (cur ? cur.name + ', ' + gearStat(cur) : 'none') + (o.useful ? '' : ' (no better)') });
      }
      return o;
    });
  }

  function buy(s, i, ev) {
    const h = s.hero, it = s.shop && s.shop.stock[i];
    if (!it || it.sold) return;
    const info = shopItems(s)[i];
    if (!info.useful) { ev.push({ e: 'msg', text: '"That is no better than what you have, friend."', cls: 'gold' }); return; }
    const onCredit = h.gold < it.price && !!info.credit;
    if (onCredit) {
      s.debt = { amount: info.credit, due: s.levels + DEBT_LEVELS };
      it.sold = true;
      ev.push({ e: 'sound', name: 'coin' }, { e: 'status' }, { e: 'msg', cls: 'warn',
        text: '"Take it now, pay me later: ' + info.credit + ' gold within ' + DEBT_LEVELS + ' levels. Any merchant of the guild will do. Do not make me send someone..."' });
    } else if (h.gold < it.price) {
      ev.push({ e: 'msg', text: s.debt ? '"No more credit until you pay what you owe!"' : '"That is ' + it.price + ' gold. Come back when you can pay."', cls: 'warn' }, { e: 'sound', name: 'bump' });
      return;
    } else {
      h.gold -= it.price;
      h.spent += it.price;
      it.sold = true;
      ev.push({ e: 'sound', name: 'coin' }, { e: 'float', x: h.x, y: h.y, text: '-' + it.price + ' gold', cls: 'gold' });
    }
    switch (it.kind) {
      case 'potion': h.potions++; break;
      case 'scroll': h.scrolls[it.id] = (h.scrolls[it.id] || 0) + 1; break;
      case 'heart': h.maxHp += 5; h.hp += 5; break;
      case 'ring': h.str++; break;
      case 'pickaxe': h.digs += PICK_DIGS; break;
      case 'gear': {
        const g = GEAR[it.id], cur = h[g.slot] ? GEAR[h[g.slot]] : null;
        h[g.slot] = it.id;
        ev.push({ e: 'sound', name: 'equip' }, { e: 'msg', text: 'You buy the ' + g.name + ' (' + gearStat(g) + ') and put it on' + (cur ? '; the merchant takes your old ' + cur.name + '.' : '.'), cls: 'good' }, { e: 'status' });
        return;
      }
    }
    ev.push({ e: 'msg', text: 'You buy ' + (it.kind === 'scroll' ? 'a scroll' : an(info.name.toLowerCase())) + (onCredit ? ' on credit.' : ' for ' + it.price + ' gold.'), cls: 'gold' }, { e: 'status' });
  }

  // ---- debts ---------------------------------------------------------------------

  const creditLimit = (s) => CREDIT_LIMIT + CREDIT_PER_DEPTH * s.depth;

  // talking to any merchant: pay the debt if the purse allows it
  function settle(s, ev) {
    const h = s.hero, d = s.debt;
    if (h.gold < d.amount) {
      const left = d.due - s.levels;
      ev.push({ e: 'msg', cls: 'warn', text: '"You still owe the guild ' + d.amount + ' gold. ' + (left > 0 ? left + (left === 1 ? ' level' : ' levels') + ' left, friend."' : 'The hunter is already on your trail."') });
      return;
    }
    h.gold -= d.amount;
    h.spent += d.amount;
    s.debt = null;
    ev.push({ e: 'float', x: h.x, y: h.y, text: '-' + d.amount + ' gold', cls: 'gold' }, { e: 'status' },
      { e: 'msg', text: 'You pay your debt of ' + d.amount + ' gold. "A pleasure doing business!"', cls: 'gold' });
    // the hunter is called off
    for (const m of s.monsters.filter(o => o.def.hunter)) {
      s.monsters.splice(s.monsters.indexOf(m), 1);
      ev.push({ e: 'cat', what: 'go', who: m, x: m.x, y: m.y, sprite: 'goblin_0' });
      ev.push({ e: 'msg', text: 'The bounty hunter lowers the bow and walks away.', cls: 'good' });
    }
  }

  // a level reached with an overdue debt brings a bounty hunter, far away and coming
  const HUNTER = Object.assign({}, MONSTERS.goblin, {
    relentless: true, noSleep: true, hunter: true, erratic: 0, ranged: { kind: 'arrow', str: 6, range: 7, chance: 0.4 },
  });

  function debtCheck(s, ev) {
    const d = s.debt;
    if (!d || s.levels < d.due || s.monsters.some(m => m.def.hunter)) return;
    const spot = farSpot(s, 16);
    if (!spot) return;
    const hp = 26 + 5 * s.depth;
    s.monsters.push({
      id: s.nextId++, type: 'goblin', name: 'Bounty Hunter', def: HUNTER, x: spot.x, y: spot.y, hp, maxHp: hp,
      str: 5 + s.depth, xp: 30 + 3 * s.depth, look: 0, asleep: false, hunting: true, track: TRACK, cool: 0,
    });
    ev.push({ e: 'msg', text: 'You owe the merchants\' guild ' + d.amount + ' gold, and they have sent a bounty hunter after you!', cls: 'bad' }, { e: 'sound', name: 'roar' });
  }

  // a free cell about `want` steps from the hero, out of sight
  function farSpot(s, want) {
    const h = s.hero;
    const pass = (v, c) => D.walkable(v) && v !== T.LAVA && !s.decor.get(c)?.block && !s.chests.has(c);
    const dist = D.distances(s.map.t, h.x, h.y, pass);
    let best = null, bd = -1;
    for (let c = 0; c < W * H; c++) {
      const d = dist[c];
      if (d < 0 || s.vis[c] || s.map.t[c] !== T.FLOOR || s.traps.has(c) || occupied(s, c % W, (c / W) | 0)) continue;
      const score = d <= want ? d : 2 * want - d;
      if (score > bd) { bd = score; best = c; }
    }
    return best === null ? null : { x: best % W, y: (best / W) | 0 };
  }

  // ---- nests, the arena and the mimics -----------------------------------------------

  function strikeNest(s, d, ev) {
    const h = s.hero;
    ev.push({ e: 'lunge', who: h, to: { x: d.x, y: d.y } });
    if (h.invisible) { h.invisible = 0; ev.push({ e: 'status' }); }
    const dmg = roll(s.rnd, h.str) + atk(h);
    d.hp -= dmg;
    ev.push({ e: 'hit', who: d, amount: dmg, crit: false, x: d.x, y: d.y }, { e: 'sound', name: 'hit' });
    if (d.hp > 0) return;
    s.decor.delete(idx(d.x, d.y));
    ev.push({ e: 'smash', kind: 'nest', x: d.x, y: d.y }, { e: 'sound', name: 'smash' },
      { e: 'msg', text: 'You destroy the ' + d.type + ' nest! +' + (15 + 2 * s.depth) + ' XP', cls: 'good' });
    gain(s, 'coins', d.x, d.y, ev);
    addXp(s, 15 + 2 * s.depth, ev);
  }

  function nestTurn(s, ev) {
    const h = s.hero;
    for (const d of s.decor.values()) {
      if (!d.nest || Math.abs(d.x - h.x) + Math.abs(d.y - h.y) > NEST_RANGE || ++d.cool < NEST_EVERY) continue;
      d.cool = 0;
      if (s.monsters.filter(m => m.nestOf === d.id).length >= NEST_MAX) continue;
      const cells = neighbours(d).filter(([x, y]) => tile(s, x, y) === T.FLOOR && !occupied(s, x, y) && !(x === h.x && y === h.y));
      if (!cells.length) continue;
      const [x, y] = pick(s.rnd, cells);
      const m = spawn(s, d.type, x, y);
      Object.assign(m, { asleep: false, nestOf: d.id, xp: Math.ceil(m.xp / 2) });
      s.monsters.push(m);
      ev.push({ e: 'summon', who: m, x, y, color: '120,220,90' });
      if (s.vis[idx(d.x, d.y)]) ev.push({ e: 'msg', text: 'Something crawls out of the nest: ' + an(d.type) + '!', cls: 'warn' }, { e: 'sound', name: 'summon' });
    }
  }

  function gong(s, d, ev) {
    const a = s.arena;
    ev.push({ e: 'lunge', who: s.hero, to: { x: d.x, y: d.y } }, { e: 'sound', name: 'gong' }, { e: 'wish', x: d.x, y: d.y });
    if (a.done) { ev.push({ e: 'msg', text: 'The gong hums softly. The arena is yours.' }); return true; }
    if (a.started) { ev.push({ e: 'msg', text: 'The fight is already on!', cls: 'warn' }); return true; }
    a.started = true;
    ev.push({ e: 'msg', text: 'BONG! A distant crowd roars: fight ' + ARENA_WAVES + ' waves for the treasure of the arena!', cls: 'warn' });
    wave(s, ev);
    return true;
  }

  function wave(s, ev) {
    const a = s.arena, h = s.hero, r = a.room;
    a.wave++;
    const types = Object.keys(MONSTERS).filter(k => MONSTERS[k].min <= s.depth + 1);
    const n = 2 + a.wave + Math.floor(s.depth / 6);
    const cells = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (tile(s, x, y) === T.FLOOR && !occupied(s, x, y) && !s.traps.has(idx(x, y)) && Math.abs(x - h.x) + Math.abs(y - h.y) >= 3) cells.push([x, y]);
      }
    }
    for (let i = 0; i < n && cells.length; i++) {
      const [x, y] = cells.splice(Math.floor(s.rnd() * cells.length), 1)[0];
      const m = spawn(s, pick(s.rnd, types), x, y, a.wave - 1);
      Object.assign(m, { asleep: false, hunting: true, track: TRACK, arena: true });
      s.monsters.push(m);
      ev.push({ e: 'summon', who: m, x, y });
    }
    ev.push({ e: 'sound', name: 'summon' }, { e: 'msg', text: 'Wave ' + a.wave + ' of ' + ARENA_WAVES + '!', cls: 'bad' });
  }

  function arenaTurn(s, ev) {
    const a = s.arena;
    if (!a || !a.started || a.done || s.monsters.some(m => m.arena)) return;
    if (a.wave < ARENA_WAVES) { wave(s, ev); return; }
    a.done = true;
    const r = a.room, h = s.hero;
    ev.push({ e: 'sound', name: 'levelup' }, { e: 'msg', text: 'The crowd cheers! The treasure of the arena appears.', cls: 'gold' });
    // chests and a fine piece of gear around the gong
    let n = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = a.x + dx, y = a.y + dy, c = idx(x, y);
      if (tile(s, x, y) !== T.FLOOR || occupied(s, x, y) || s.items.has(c) || (x === h.x && y === h.y)) continue;
      if (n === 0) s.items.set(c, { x, y, kind: 'gear', id: rollGear(s, 2) });
      else s.chests.set(c, { x, y, rich: true });
      ev.push({ e: 'effect', name: 'sparkle', x, y });
      if (++n >= 4) break;
    }
  }

  // a chest with teeth
  function mimic(s, x, y, ev) {
    s.chests.delete(idx(x, y));
    const hp = 14 + 4 * s.depth;
    const m = {
      id: s.nextId++, type: 'mimic', def: MONSTERS.mimic, x, y, hp, maxHp: hp, str: 4 + Math.round(s.depth * 0.8),
      xp: 12 + 2 * s.depth, look: 0, asleep: false, hunting: true, track: TRACK,
    };
    s.monsters.push(m);
    ev.push({ e: 'lunge', who: s.hero, to: { x, y } }, { e: 'alert', who: m, kind: 'alert' }, { e: 'sound', name: 'roar' },
      { e: 'msg', text: 'The chest snaps open... and it has teeth! A mimic!', cls: 'bad' });
    strike(s, m, ev);
  }

  // better equipment is worn at once, the rest is left behind
  function rollGear(s, bonus = 0) {
    const rnd = s.rnd;
    const slot = rnd() < 0.5 ? 'weapon' : 'armor';
    const tier = Math.max(0, Math.min(5, Math.floor((s.depth - 1) / 2 + rnd() * 2 - 0.5) + bonus));
    return Object.keys(GEAR).find(k => GEAR[k].slot === slot && GEAR[k].tier === tier);
  }

  const atk = (h) => (h.weapon ? GEAR[h.weapon].atk : 0);
  const def = (h) => (h.armor ? GEAR[h.armor].def : 0);
  const gearStat = (g) => (g.slot === 'weapon' ? 'ATK +' + g.atk : 'DEF +' + g.def);

  // armour soaks a random part of each blow, but at least 1 always gets through
  function soak(s, dmg) {
    return Math.max(1, dmg - int(s.rnd, 0, def(s.hero)));
  }

  function equip(s, id, x, y, ev) {
    const h = s.hero, g = GEAR[id];
    const cur = h[g.slot] ? GEAR[h[g.slot]] : null;
    const better = !cur || (g.slot === 'weapon' ? g.atk > cur.atk : g.def > cur.def);
    ev.push({ e: 'pickup', kind: 'gear', sprite: id, x, y });
    if (better) {
      h[g.slot] = id;
      ev.push({ e: 'sound', name: 'equip' }, { e: 'float', x, y, text: gearStat(g), cls: 'str' }, { e: 'status' },
        { e: 'msg', text: 'You equip the ' + g.name + ' (' + gearStat(g) + ')' + (cur ? ', leaving your ' + cur.name + ' behind.' : '.'), cls: 'good' });
    } else {
      ev.push({ e: 'sound', name: 'pickup' }, { e: 'msg', text: 'You find ' + an(g.name.toLowerCase()) + ' (' + gearStat(g) + '), no better than your ' + cur.name + '. You leave it.' });
    }
  }

  function openChest(s, x, y, ev) {
    if (s.chests.get(idx(x, y)).mimic) { mimic(s, x, y, ev); return; }
    const rich = !!s.chests.get(idx(x, y)).rich;
    s.chests.delete(idx(x, y));
    ev.push({ e: 'chest', x, y }, { e: 'sound', name: 'chest' }, { e: 'effect', name: 'sparkle', x, y }, { e: 'lunge', who: s.hero, to: { x, y } });
    const kinds = LOOT.map(l => l[0]), w = LOOT.map(l => l[1]);
    const n = rich || s.rnd() < 0.3 ? 2 : 1;
    for (let i = 0; i < n; i++) gain(s, pickWeighted(s.rnd, kinds, w), x, y, ev);
  }

  function smash(s, d, ev) {
    s.decor.delete(idx(d.x, d.y));
    ev.push({ e: 'lunge', who: s.hero, to: { x: d.x, y: d.y } }, { e: 'smash', kind: d.kind, x: d.x, y: d.y },
      { e: 'effect', name: 'smoke', x: d.x, y: d.y }, { e: 'sound', name: 'smash' }, { e: 'msg', text: 'You smash the ' + d.kind + '.' });
    const r = s.rnd();
    if (r < 0.35) gain(s, 'coins', d.x, d.y, ev);
    else if (r < 0.45) gain(s, 'potion', d.x, d.y, ev);
  }

  function quaff(s, ev) {
    const h = s.hero;
    if (!h.potions) { ev.push({ e: 'msg', text: 'You have no potions.' }); return false; }
    h.potions--;
    const heal = Math.min(h.maxHp - h.hp, Math.round(h.maxHp * 0.5) + 5);
    h.hp += heal;
    h.poison = 0;
    ev.push({ e: 'sound', name: 'potion' }, { e: 'effect', name: 'sparkle', x: h.x, y: h.y },
      { e: 'float', x: h.x, y: h.y, text: '+' + heal + ' HP', cls: 'heal' }, { e: 'msg', text: 'You drink a potion and feel better.', cls: 'heal' });
    return true;
  }

  function browse(s, d, ev) {
    d.searched = true;
    ev.push({ e: 'lunge', who: s.hero, to: { x: d.x, y: d.y } }, { e: 'sound', name: 'pages' });
    if (s.rnd() < SHELF_FIND) gain(s, 'scroll', d.x, d.y, ev);
    else ev.push({ e: 'msg', text: 'You search the bookshelf: only dusty, crumbling books.' });
  }

  const scrollCount = (h) => Object.values(h.scrolls).reduce((a, b) => a + b, 0);

  // monsters the hero can see right now
  const inSight = (s) => s.monsters.filter(m => s.vis[idx(m.x, m.y)] && dist(m, s.hero) <= SIGHT);

  function read(s, kind, ev) {
    const h = s.hero;
    if (!kind || !h.scrolls[kind]) { ev.push({ e: 'msg', text: 'You have no such scroll.' }); return false; }
    if (--h.scrolls[kind] === 0) delete h.scrolls[kind];
    ev.push({ e: 'effect', name: 'magic', x: h.x, y: h.y });
    // for render.js: the look of the spell (mapping also needs the map as it was)
    ev.push({ e: 'spell', kind, x: h.x, y: h.y, before: kind === 'mapping' ? s.seen.slice() : null });
    if (!s.identified[kind]) {
      s.identified[kind] = true;
      ev.push({ e: 'msg', text: 'You read the scroll labelled "' + s.labels[kind] + '": it is a scroll of ' + SCROLLS[kind].name + '!', cls: 'hint' });
    }
    switch (kind) {
      case 'mapping':
        for (let c = 0; c < W * H; c++) if (s.map.t[c] !== T.VOID) s.seen[c] = 1;
        for (const trap of s.traps.values()) trap.known = true;
        ev.push({ e: 'sound', name: 'teleport' }, { e: 'mapped' },
          { e: 'msg', text: 'The scroll burns away and the whole level glows in your mind.', cls: 'magic' });
        break;
      case 'teleport':
        teleport(s, 'You read the scroll and vanish in a flash of light!', ev);
        break;
      case 'invisibility':
        h.invisible = SCROLLS[kind].turns;
        for (const m of s.monsters) {
          if (m.hunting && !m.def.dread) { m.hunting = false; m.track = 0; if (s.vis[idx(m.x, m.y)]) ev.push({ e: 'alert', who: m, kind: 'question' }); }
        }
        ev.push({ e: 'sound', name: 'vanish' }, { e: 'status' },
          { e: 'msg', text: 'You fade from sight. Invisible for ' + h.invisible + ' turns.', cls: 'magic' });
        break;
      case 'invincibility':
        h.invincible = SCROLLS[kind].turns;
        ev.push({ e: 'sound', name: 'shield' }, { e: 'status' }, { e: 'float', x: h.x, y: h.y, text: 'INVINCIBLE', cls: 'lvl' },
          { e: 'msg', text: 'A golden aura surrounds you. Invincible for ' + h.invincible + ' turns.', cls: 'magic' });
        break;
      case 'fire': {
        const foes = inSight(s);
        ev.push({ e: 'sound', name: 'fire' }, { e: 'msg', text: foes.length ? 'A firestorm sweeps the room!' : 'Flames roar around you, but nothing is there to burn.', cls: 'magic' });
        for (const m of foes) {
          if (m.def.invincible) continue;
          const dmg = 8 + 2 * s.depth + int(s.rnd, 0, 4);
          m.hp -= dmg;
          m.asleep = false;
          ev.push({ e: 'effect', name: 'explosion', x: m.x, y: m.y }, { e: 'hit', who: m, amount: dmg, crit: false, x: m.x, y: m.y });
          if (m.hp <= 0) kill(s, m, ev);
          else if (!m.hunting) { m.hunting = true; m.track = TRACK; }
        }
        break;
      }
      case 'sleep': {
        const foes = inSight(s);
        for (const m of foes) {
          if (m.def.noSleep) continue;
          m.asleep = true; m.hunting = false; m.track = 0;
          ev.push({ e: 'effect', name: 'sparkle', x: m.x, y: m.y });
        }
        ev.push({ e: 'sound', name: 'sleep' }, { e: 'msg', text: foes.length ? 'A drowsy mist rises: ' + foes.length + (foes.length === 1 ? ' monster falls' : ' monsters fall') + ' asleep.' : 'A drowsy mist rises, but nobody is around.', cls: 'magic' });
        break;
      }
    }
    return true;
  }

  function search(s, ev, chance) {
    const h = s.hero;
    for (const trap of s.traps.values()) {
      if (trap.known || !s.vis[idx(trap.x, trap.y)] || dist(trap, h) > 2.5) continue;
      if (s.rnd() < chance) {
        trap.known = true;
        ev.push({ e: 'spotted', x: trap.x, y: trap.y }, { e: 'msg', text: 'You spot a ' + TRAPS[trap.kind].name + '!', cls: 'warn' }, { e: 'sound', name: 'spot' });
      }
    }
  }

  // ---- monsters ------------------------------------------------------------

  function endTurn(s, ev) {
    const h = s.hero;
    s.turn++;
    if (h.poison > 0) {
      h.poison--;
      ev.push({ e: 'effect', name: 'poison', x: h.x, y: h.y });
      hurt(s, 1, 'succumbed to poison', ev);
      if (s.over) return;
    } else if (h.hp < h.maxHp && s.turn % Math.max(3, 10 - h.lvl) === 0) h.hp++;
    // timed effects of the scrolls
    if (h.invisible && --h.invisible === 0) ev.push({ e: 'msg', text: 'You fade back into view.', cls: 'warn' }, { e: 'status' });
    else if (h.invisible === 3) ev.push({ e: 'msg', text: 'Your invisibility is wearing off...', cls: 'warn' });
    if (h.invincible && --h.invincible === 0) ev.push({ e: 'msg', text: 'Your golden aura fades away.', cls: 'warn' }, { e: 'status' });
    else if (h.invincible === 3) ev.push({ e: 'msg', text: 'Your aura flickers...', cls: 'warn' });
    updateView(s);
    dreadTurn(s, ev);
    nestTurn(s, ev);
    arenaTurn(s, ev);
    const pass = (v, c) => D.walkable(v) && v !== T.LAVA && !s.decor.get(c)?.block && !s.chests.has(c);
    const scent = D.distances(s.map.t, h.x, h.y, pass);
    for (const m of s.monsters.slice()) {
      if (s.over) break;
      monsterTurn(s, m, scent, pass, ev);
    }
    if (!s.over) catTurn(s, ev);
    if (!s.over) nightfall(s, ev);
    updateView(s);
    search(s, ev, SPOT);
  }

  // ---- the cat, the well and the night -----------------------------------------

  function catTurn(s, ev) {
    const h = s.hero;
    if (!s.cat) {
      if (!s.catAt || s.turn < s.catAt) return;
      // out of the shadows, a few cells away, where the hero can see it
      const cells = [];
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const x = h.x + dx, y = h.y + dy, d = Math.abs(dx) + Math.abs(dy);
          if (d >= 3 && d <= 5 && tile(s, x, y) === T.FLOOR && !occupied(s, x, y) && !s.traps.has(idx(x, y)) && s.vis[idx(x, y)]) cells.push([x, y]);
        }
      }
      if (!cells.length) { s.catAt = s.turn + 5; return; }
      s.catAt = 0;
      const [x, y] = pick(s.rnd, cells);
      s.cat = { id: -1, type: 'cat', x, y, life: int(s.rnd, CAT_LIFE[0], CAT_LIFE[1]), near: 0, heals: 0, hunting: true };
      ev.push({ e: 'cat', what: 'come', who: s.cat, x, y }, { e: 'sound', name: 'meow' },
        { e: 'msg', text: 'A black cat steps out of the shadows and stares at you.', cls: 'hint' });
      return;
    }
    const c = s.cat;
    if (--c.life <= 0 || dist(c, h) > 10) {
      ev.push({ e: 'cat', what: 'go', who: c, x: c.x, y: c.y },
        { e: 'msg', text: c.heals ? 'The cat blinks slowly at you and slips away.' : 'The cat loses interest and vanishes into the dark.', cls: 'hint' });
      s.cat = null;
      return;
    }
    if (Math.max(Math.abs(c.x - h.x), Math.abs(c.y - h.y)) <= 1) {
      if (++c.near >= CAT_PURR && c.heals < CAT_HEALS) {
        c.near = 0;
        ev.push({ e: 'sound', name: 'purr' }, { e: 'cat', what: 'purr', who: c, x: c.x, y: c.y });
        if (h.hp < h.maxHp) {
          h.hp++; c.heals++;
          ev.push({ e: 'float', x: h.x, y: h.y, text: '+1', cls: 'heal' }, { e: 'msg', text: 'The cat rubs against your leg and purrs. +1 HP', cls: 'heal' }, { e: 'status' });
        } else ev.push({ e: 'msg', text: 'The cat purrs happily.', cls: 'hint' });
      }
      return;
    }
    c.near = 0;
    if (s.rnd() < 0.2) return; // it sits and licks a paw
    const here = Math.abs(c.x - h.x) + Math.abs(c.y - h.y);
    let best = null, bd = here;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy, v = tile(s, x, y);
      if ((v !== T.FLOOR && v !== T.OPEN && v !== T.DOWN && v !== T.UP) || occupied(s, x, y) || s.traps.has(idx(x, y)) || (x === h.x && y === h.y)) continue;
      const d = Math.abs(x - h.x) + Math.abs(y - h.y);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (!best) return;
    const from = { x: c.x, y: c.y };
    c.x = best[0]; c.y = best[1];
    ev.push({ e: 'move', who: c, from });
  }

  function wish(s, d, ev) {
    const h = s.hero;
    if (!d.uses) { ev.push({ e: 'msg', text: 'The well is dry. Only your reflection looks back.' }); return false; }
    if (h.gold < WELL_COST) { ev.push({ e: 'msg', text: 'A wish costs ' + WELL_COST + ' gold. Your purse is too light.' }); return false; }
    h.gold -= WELL_COST;
    d.uses--;
    ev.push({ e: 'lunge', who: h, to: { x: d.x, y: d.y } }, { e: 'wish', x: d.x, y: d.y }, { e: 'sound', name: 'plop' },
      { e: 'float', x: h.x, y: h.y, text: '-' + WELL_COST + ' gold', cls: 'gold' }, { e: 'status' });
    const r = s.rnd();
    if (r < 0.66) ev.push({ e: 'msg', text: pick(s.rnd, ECHOES) });
    else {
      const gift = r < 0.8 ? 'potion' : r < 0.9 ? 'coins' : r < 0.96 ? 'scroll' : r < 0.99 ? 'heart' : 'ring';
      ev.push({ e: 'msg', text: 'The water bubbles... the well grants your wish!', cls: 'magic' }, { e: 'effect', name: 'sparkle', x: d.x, y: d.y });
      gain(s, gift, d.x, d.y, ev);
    }
    if (!d.uses) ev.push({ e: 'msg', text: 'The water sinks out of sight: the well is dry.' });
    return true;
  }

  // evening and then night over the garden; at night some bats come out to hunt
  function nightfall(s, ev) {
    if (!s.theme.rays) return;
    s.night = Math.max(0, Math.min(1, (s.turn - s.arrive - DUSK_START) / DUSK_LEN));
    if (s.night > 0 && !s.dusk) {
      s.dusk = true;
      ev.push({ e: 'msg', text: 'The light turns golden and fades: evening falls over the garden.', cls: 'hint' });
    }
    if (s.night >= 1 && !s.nightfall) {
      s.nightfall = true;
      ev.push({ e: 'msg', text: 'Night has fallen. Something flutters among the trees.', cls: 'warn' });
    }
    if (s.night < 0.5 || s.nightBats >= NIGHT_BATS || s.rnd() > 0.06) return;
    const h = s.hero;
    for (let i = 0; i < 30; i++) {
      const x = h.x + int(s.rnd, -14, 14), y = h.y + int(s.rnd, -14, 14);
      const d = Math.abs(x - h.x) + Math.abs(y - h.y);
      if (d < 8 || tile(s, x, y) !== T.FLOOR || occupied(s, x, y) || s.vis[idx(x, y)]) continue;
      const b = spawn(s, 'bat', x, y);
      b.asleep = false;
      s.monsters.push(b);
      s.nightBats++;
      return;
    }
  }

  function monsterTurn(s, m, scent, pass, ev) {
    const h = s.hero, rnd = s.rnd;
    if (m.def.slow && s.turn % 2) return;
    // on the topsy-turvy levels monsters only stroll around, unless provoked
    if (m.peaceful) { if (rnd() < 0.4) wander(s, m, pass, ev); return; }
    const d = dist(m, h);
    const sees = !h.invisible && s.vis[idx(m.x, m.y)] && d <= NOTICE;
    if (m.asleep) {
      if (sees && (d <= 3 || rnd() < 0.25)) {
        m.asleep = false; m.hunting = true; m.track = TRACK;
        ev.push({ e: 'alert', who: m, kind: 'alert' });
      }
      return;
    }
    if (sees) {
      if (!m.hunting) ev.push({ e: 'alert', who: m, kind: 'alert' });
      if (m.type === 'shade' && !m.met) {
        m.met = true;
        const p = m.past;
        ev.push({ e: 'sound', name: 'death' }, { e: 'msg', cls: 'magic',
          text: 'A pale figure turns towards you: your own shade, a level ' + p.lvl + ' hero ' + p.cause + '. It wants you to join it.' });
      }
      if (m.def.boss && !m.met) {
        m.met = true;
        ev.push({ e: 'sound', name: 'roar' }, { e: 'msg', text: 'The ' + m.name + ' sees you and roars!', cls: 'bad' });
      }
      m.hunting = true; m.track = TRACK;
    } else if (m.hunting && !m.def.relentless && --m.track <= 0) {
      m.hunting = false;
      ev.push({ e: 'alert', who: m, kind: 'question' });
    }
    if (m.hunting) {
      if (m.type === 'shade') m.dir = facing(h.x - m.x, Math.abs(h.x - m.x) >= Math.abs(h.y - m.y) ? 0 : h.y - m.y, m.dir);
      if (m.def.regen && m.hp < m.maxHp) m.hp = Math.min(m.maxHp, m.hp + m.def.regen);
      if (m.def.summon && ++m.cool >= m.def.summon.every && summon(s, m, ev)) { m.cool = 0; return; }
      if (Math.abs(m.x - h.x) + Math.abs(m.y - h.y) === 1) { strike(s, m, ev); return; }
      const r = m.def.ranged;
      if (r && sees && d <= r.range && rnd() < r.chance && clear(s, m, h)) { shoot(s, m, r, ev); return; }
      if (m.def.erratic && rnd() < m.def.erratic) { wander(s, m, pass, ev); return; }
      const here = scent[idx(m.x, m.y)];
      const steps = neighbours(m).filter(([x, y]) => {
        const c = idx(x, y);
        return scent[c] >= 0 && (here < 0 || scent[c] < here) && !monsterAt(s, x, y) && !(x === h.x && y === h.y);
      });
      if (steps.length) {
        steps.sort((a, b) => scent[idx(a[0], a[1])] - scent[idx(b[0], b[1])]);
        step(s, m, steps[0][0], steps[0][1], ev);
      }
    } else if (rnd() < 0.4) wander(s, m, pass, ev);
  }

  // bosses call minions to their side, up to a maximum alive at the same time
  function summon(s, m, ev) {
    const sm = m.def.summon;
    if (s.monsters.filter(o => o.minionOf === m.id).length >= sm.max) return false;
    const h = s.hero;
    const cells = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = m.x + dx, y = m.y + dy;
        if (tile(s, x, y) === T.FLOOR && !occupied(s, x, y) && !(x === h.x && y === h.y)) cells.push([x, y]);
      }
    }
    if (!cells.length) return false;
    const [x, y] = pick(s.rnd, cells);
    const o = spawn(s, sm.type, x, y);
    Object.assign(o, { asleep: false, hunting: true, track: TRACK, minionOf: m.id, xp: Math.ceil(o.xp / 2) });
    s.monsters.push(o);
    ev.push({ e: 'lunge', who: m, to: { x, y } }, { e: 'summon', who: o, x, y }, { e: 'sound', name: 'summon' });
    if (s.vis[idx(m.x, m.y)]) ev.push({ e: 'msg', text: 'The ' + m.name + ' calls ' + an(sm.type) + ' to its side!', cls: 'warn' });
    return true;
  }

  const facing = (dx, dy, cur) => (LOOKS.find(l => l[0] === Math.sign(dx) && l[1] === Math.sign(dy)) || [0, 0, cur])[2];

  const neighbours = (p) => [[p.x + 1, p.y], [p.x - 1, p.y], [p.x, p.y + 1], [p.x, p.y - 1]];

  function wander(s, m, pass, ev) {
    const h = s.hero;
    const opts = neighbours(m).filter(([x, y]) => pass(tile(s, x, y), idx(x, y)) && !monsterAt(s, x, y) && !(x === h.x && y === h.y));
    if (opts.length) { const [x, y] = pick(s.rnd, opts); step(s, m, x, y, ev); }
  }

  function step(s, m, x, y, ev) {
    const c = idx(x, y);
    if (s.map.t[c] === T.DOOR) {
      s.map.t[c] = T.OPEN;
      if (s.vis[c]) ev.push({ e: 'door', x, y }, { e: 'sound', name: 'door' });
    }
    const from = { x: m.x, y: m.y };
    if (m.type === 'shade') m.dir = facing(x - m.x, y - m.y, m.dir);
    m.x = x; m.y = y;
    ev.push({ e: 'move', who: m, from, to: { x, y } });
  }

  function clear(s, a, b) {
    return F.line(a.x, a.y, b.x, b.y).every(([x, y]) => !D.opaque(tile(s, x, y)) && !monsterAt(s, x, y) && !s.decor.get(idx(x, y))?.block);
  }

  const killer = (s, m) => (m.type === 'shade' ? 'killed by your own shade' : m.def.boss || m.def.dread || m.def.hunter ? 'slain by the ' + m.name : 'killed by ' + an(m.type)) + ' on depth ' + s.depth;

  function strike(s, m, ev) {
    const h = s.hero, rnd = s.rnd;
    ev.push({ e: 'lunge', who: m, to: { x: h.x, y: h.y } });
    if (rnd() > MONSTER_HIT - DEF_DODGE * def(h)) {
      ev.push({ e: 'miss', x: h.x, y: h.y }, { e: 'sound', name: 'swish' }, { e: 'msg', text: 'The ' + nm(m) + ' misses you.' });
      return;
    }
    const dmg = soak(s, roll(rnd, m.str));
    if (h.invincible) { ev.push({ e: 'sound', name: 'clank' }, { e: 'msg', text: 'The ' + nm(m) + "'s blow glances off your golden aura." }); hurt(s, dmg, '', ev); return; }
    ev.push({ e: 'sound', name: 'hurt' }, { e: 'msg', text: 'The ' + nm(m) + ' hits you for ' + dmg + '.', cls: 'bad' });
    if (m.def.poison && !h.poison && rnd() < 0.5) {
      h.poison = m.def.poison;
      ev.push({ e: 'msg', text: 'You are poisoned!', cls: 'bad' });
    }
    hurt(s, dmg, killer(s, m), ev, { x: m.x, y: m.y });
  }

  function shoot(s, m, r, ev) {
    const h = s.hero, rnd = s.rnd;
    ev.push({ e: 'shoot', kind: r.kind, from: { x: m.x, y: m.y }, to: { x: h.x, y: h.y } }, { e: 'sound', name: 'shoot' });
    if (rnd() > MONSTER_HIT - DEF_DODGE * def(h)) {
      ev.push({ e: 'miss', x: h.x, y: h.y }, { e: 'msg', text: 'The ' + nm(m) + "'s " + r.kind.replace('_', ' ') + ' misses you.' });
      return;
    }
    const dmg = soak(s, roll(rnd, r.str));
    if (h.invincible) { ev.push({ e: 'msg', text: 'The ' + nm(m) + "'s " + r.kind.replace('_', ' ') + ' bursts harmlessly on your aura.' }); hurt(s, dmg, '', ev); return; }
    ev.push({ e: 'effect', name: r.kind === 'fireball' ? 'explosion' : r.kind === 'poison_bolt' ? 'poison' : r.kind === 'bolt' ? 'magic' : 'blood', x: h.x, y: h.y },
      { e: 'sound', name: 'hurt' }, { e: 'msg', text: 'The ' + nm(m) + "'s " + r.kind.replace('_', ' ') + ' hits you for ' + dmg + '.', cls: 'bad' });
    if (r.poison && !h.poison) { h.poison = r.poison; ev.push({ e: 'msg', text: 'You are poisoned!', cls: 'bad' }); }
    hurt(s, dmg, killer(s, m), ev, { x: m.x, y: m.y });
  }

  // what the player knows about a kind of scroll
  function scrollInfo(s, kind) {
    const sc = SCROLLS[kind];
    if (s.identified[kind]) return { name: sc.name, info: sc.info, turns: sc.turns, known: true };
    return { name: '"' + s.labels[kind] + '"', info: 'Unidentified: read it to find out what it does', known: false };
  }

  function score(s) {
    const h = s.hero;
    // gold spent at the merchant still counts
    return h.gold + h.spent + (s.maxDepth - 1) * 100 + s.climbed * CLIMB_BONUS + h.xpTotal * 2 + (s.won ? WIN_BONUS : 0);
  }

  return { REWIND, heirlooms, snapshot, rewind, save, load, ARTIFACT_DEPTH, ARTIFACT_NAME, WELL_COST, shopItems, CLASSES, MONSTERS, TRAPS, THEMES, SCROLLS, GEAR, SIGHT, create, act, xpFor, score, monsterAt, tile, scrollCount, scrollInfo, atk, def, pastRecord, BOSSES, BOSS_EVERY, BOSS_SIZE, SCENARIOS, theme };
})();

if (typeof module !== 'undefined') module.exports = Game;
