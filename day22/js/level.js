'use strict';
// Level data: tile grid (one char per cell), entity list, theme. Serialization for the editor.

// Tile types. solid: blocks bodies. portal: accepts portals. grate: solid for bodies,
// transparent for shots and projectiles. bump: reacts when hit from below.
const TILES = {
  '.': { name: 'Empty' },
  '#': { name: 'Ground', solid: 1, portal: 1 },
  '=': { name: 'Stone', solid: 1, portal: 1 },
  'M': { name: 'Metal (no portals)', solid: 1 },
  'B': { name: 'Brick', solid: 1, bump: 1 },
  'C': { name: 'Cracked brick', solid: 1, bump: 1, weak: 1 },
  '?': { name: 'Coin block', solid: 1, bump: 1 },
  'P': { name: 'Power-up block', solid: 1, bump: 1 },
  'U': { name: 'Used block', solid: 1 },
  'H': { name: 'Hidden block' },
  'G': { name: 'Grate', solid: 1, grate: 1 },
  'X': { name: 'Crumbling rock', solid: 1, crumble: 1 },
  'S': { name: 'Fake wall' },
  'W': { name: 'Water', water: 1 },
  'F': { name: 'Fire', fire: 1 }
};

// Entity types placeable in the editor (x, y are tile cells; the entity stands on the bottom of its cell)
const ENTITY_TYPES = {
  start: 'Player start', exit: 'Exit door', checkpoint: 'Checkpoint',
  coin: 'Coin', scoin: 'Silver coin (5)', heart: 'Heart', potion: 'Heart container (+1 max)', medkit: 'Medkit', plasma: 'Plasma core', orb: 'Shield orb',
  chest: 'Treasure chest', secret: 'Secret area marker',
  goblin: 'Goblin', brute: 'Brute goblin', slime: 'Slime', plant: 'Carnivorous plant', turret: 'Spitter turret (facing left)',
  turretR: 'Spitter turret (facing right)', bat: 'Bat', eye: 'Floating eye', spikeball: 'Spike ball trap', boss: 'Dark Knight boss',
  sign: 'Sign', bush: 'Bush', rock: 'Rock', crate: 'Crate', barrel: 'Barrel', torch: 'Torch', fence: 'Fence'
};

// Per-world look. ground / stone: terrain sets of '#' and '=' (see TERRAIN in render.js).
// Worlds 1-2 use the forest pack with different tints; world 3 (city: true) the Central City pack.
const THEMES = [
  { name: 'Green Hills', ground: 'grass', stone: 'stone', metal: 'metal', sky: '#dff6f3', skyTint: null, farTint: null, tint: null },
  { name: 'Mossy Caverns', ground: 'moss', stone: 'stone', metal: 'metal', sky: '#173341', skyTint: 'rgba(8,38,52,0.62)', farTint: 'rgba(6,26,34,0.35)', tint: 'rgba(4,18,24,0.3)' },
  { name: 'Dark Citadel', ground: 'city', stone: 'panel', metal: 'girder', sky: '#2a0a52', city: true }
];

class Level {
  constructor(w, h, theme) {
    this.w = w; this.h = h; this.theme = theme || 0;
    this.t = new Array(w * h).fill('.');
    this.ents = [];
    this.name = THEMES[this.theme].name;
    this.seed = 0;
  }
  get(x, y) {
    if (x < 0 || x >= this.w) return 'M';
    if (y < 0 || y >= this.h) return '.';
    return this.t[y * this.w + x];
  }
  set(x, y, c) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.t[y * this.w + x] = c;
  }
  fill(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  add(t, x, y, props) {
    const e = Object.assign({ t, x, y }, props || {});
    this.ents.push(e);
    return e;
  }
  clone() { return Level.fromJSON(this.toJSON()); }
  toJSON() {
    const rows = [];
    for (let y = 0; y < this.h; y++) rows.push(this.t.slice(y * this.w, (y + 1) * this.w).join(''));
    return { v: 1, name: this.name, theme: this.theme, seed: this.seed, w: this.w, h: this.h, rows, ents: this.ents.map(e => Object.assign({}, e)) };
  }
  static fromJSON(o) {
    const L = new Level(o.w, o.h, o.theme);
    L.name = o.name || THEMES[L.theme].name;
    L.seed = o.seed || 0;
    for (let y = 0; y < o.h; y++) {
      const r = o.rows[y] || '';
      for (let x = 0; x < o.w; x++) L.t[y * o.w + x] = TILES[r[x]] ? r[x] : '.';
    }
    L.ents = (o.ents || []).filter(e => ENTITY_TYPES[e.t]).map(e => Object.assign({}, e));
    return L;
  }
  // Change the width (adds empty columns with ground at the bottom of the last column, or crops)
  resize(nw) {
    nw = Math.max(40, Math.min(600, nw | 0));
    const t = new Array(nw * this.h).fill('.');
    for (let y = 0; y < this.h; y++) for (let x = 0; x < nw; x++) {
      t[y * nw + x] = x < this.w ? this.t[y * this.w + x] : this.t[y * this.w + this.w - 1];
    }
    this.t = t; this.w = nw;
    this.ents = this.ents.filter(e => e.x < nw);
  }
}

if (typeof module !== 'undefined') module.exports = { TILES, ENTITY_TYPES, THEMES, Level };
