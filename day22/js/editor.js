'use strict';
// Level editor: paint tiles and entities on the procedural levels, save them in the browser,
// export / import JSON, play-test.

const ENT_ICON = {
  start: ['idle0', 1], exit: ['door', 1.05], checkpoint: ['torch', 1.6], coin: ['coin', 1], scoin: ['scoin', 1], heart: ['heart', 1],
  potion: ['potion', 1], medkit: ['medkit', 1], plasma: ['fireball_b', 0.8], orb: ['orb', 1], chest: ['fo_chest', 1], secret: null, goblin: ['gwalk0', 1],
  brute: ['bwalk0', 1], slime: ['slime0', 1], plant: ['plant0', 0.9], turret: ['spitter', 0.9], turretR: ['spitter', 0.9],
  bat: ['bat0', 1], eye: ['eye0', 1], spikeball: ['spikeball', 1], boss: ['boss', 0.6], sign: ['sign', 1], bush: ['fo_tuft', 1],
  rock: ['fo_rock', 1], crate: ['fo_pot', 1], barrel: ['fo_pot2', 1], torch: ['torch', 1], fence: ['fo_cattail', 1]
};
const TILE_ORDER = ['.', '#', '=', 'M', 'G', 'B', 'C', '?', 'P', 'H', 'X', 'S', 'W', 'F'];

const EDITOR = {
  L: null, index: 0, cam: { x: 0, y: 0 }, tool: { kind: 'tile', v: '#' }, dirty: false,
  hover: null, paintBtn: -1, panFrom: null, keys: {},

  open(i, keepCurrent) {
    if (!(keepCurrent && EDITOR.L && EDITOR.index === i)) {
      EDITOR.index = i;
      EDITOR.L = GAME.getLevel(i).clone();
      EDITOR.dirty = false;
      const s = EDITOR.L.ents.find(e => e.t === 'start');
      EDITOR.cam.x = s ? Math.max(0, s.x * TILE - 200) : 0;
      EDITOR.cam.y = EDITOR.L.h * TILE - VIEW_H + 100;
    }
    GAME.state = 'editor';
    UI.show('editor');
    EDITOR.refreshBar();
  },
  refreshBar() {
    document.querySelectorAll('#edbar [data-lvl]').forEach(b => b.classList.toggle('on', +b.dataset.lvl === EDITOR.index));
    document.getElementById('edseed').value = EDITOR.L.seed || '';
    EDITOR.status();
  },
  status(extra) {
    const L = EDITOR.L, h = EDITOR.hover;
    const tool = EDITOR.tool.kind === 'tile' ? TILES[EDITOR.tool.v].name : ENTITY_TYPES[EDITOR.tool.v];
    document.getElementById('edstatus').textContent =
      `World ${EDITOR.index + 1} · ${L.w}×${L.h} · ${({ custom: 'saved in this browser', file: 'from levels/world' + (EDITOR.index + 1) + '.json', procedural: 'procedural' })[GAME.source(EDITOR.index)]}${EDITOR.dirty ? ' · unsaved changes' : ''}` +
      ` · tool: ${tool}` + (h ? ` · cell ${h[0]},${h[1]}` : '') + (extra ? ' · ' + extra : '') +
      '  —  left: paint, right: erase, middle drag / arrows / wheel: scroll, T: test from the mouse position';
  },
  buildPalette() {
    const pal = document.getElementById('edpal');
    pal.innerHTML = '';
    const add = (kind, v, label) => {
      const b = document.createElement('button');
      b.title = label;
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      EDITOR.drawIcon(c.getContext('2d'), kind, v);
      b.appendChild(c);
      b.onclick = () => { EDITOR.tool = { kind, v }; pal.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); EDITOR.status(); };
      if (kind === EDITOR.tool.kind && v === EDITOR.tool.v) b.classList.add('on');
      pal.appendChild(b);
    };
    for (const t of TILE_ORDER) add('tile', t, TILES[t].name);
    const sep = document.createElement('span'); sep.className = 'sep'; pal.appendChild(sep);
    for (const t in ENTITY_TYPES) add('ent', t, ENTITY_TYPES[t]);
  },
  drawIcon(ctx, kind, v) {
    ctx.imageSmoothingEnabled = true;
    if (kind === 'tile') {
      const L = new Level(3, 3, EDITOR.L ? EDITOR.L.theme : 0);
      L.set(1, 1, v);
      ctx.save(); ctx.translate(-32, -32);
      if (v === '.') { ctx.strokeStyle = '#c33'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(38, 38); ctx.lineTo(58, 58); ctx.moveTo(58, 38); ctx.lineTo(38, 58); ctx.stroke(); }
      else if (v === 'W') SPR.tile(ctx, 'fo_6_19', 32, 32);
      else RENDER.tiles(ctx, L, THEMES[L.theme], { x: 0, y: 0 }, null, 0, true);
      ctx.restore();
      return;
    }
    const ic = ENT_ICON[v];
    if (!ic) { ctx.fillStyle = '#ffe27a'; ctx.font = 'bold 24px ' + FONT; ctx.fillText('★', 5, 26); return; }
    const [w, h] = SPR.size(ic[0]);
    const s = Math.min(30 / w, 30 / h);
    SPR.draw(ctx, ic[0], 16, 31, { ax: 0.5, ay: 1, scale: s, flip: v === 'turret' });
  },

  // ---- editing ----
  cellAt(sx, sy) { return [Math.floor((sx + EDITOR.cam.x) / TILE), Math.floor((sy + EDITOR.cam.y) / TILE)]; },
  paint(cx, cy) {
    const L = EDITOR.L;
    if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h) return;
    if (EDITOR.tool.kind === 'tile') {
      if (L.get(cx, cy) !== EDITOR.tool.v) { L.set(cx, cy, EDITOR.tool.v); EDITOR.changed(); }
      return;
    }
    const t = EDITOR.tool.v;
    if (L.ents.some(e => e.x === cx && e.y === cy && e.t === t)) return;
    if (t === 'start' || t === 'boss') L.ents = L.ents.filter(e => e.t !== t);
    const e = L.add(t, cx, cy);
    if (t === 'sign') {
      e.text = prompt('Sign text:', 'Hello!') || '';
      EDITOR.paintBtn = -1;
    }
    EDITOR.changed();
  },
  erase(cx, cy) {
    const L = EDITOR.L;
    const n = L.ents.length;
    L.ents = L.ents.filter(e => !(e.x === cx && e.y === cy));
    if (L.ents.length === n && L.get(cx, cy) !== '.') L.set(cx, cy, '.');
    EDITOR.changed();
  },
  changed() { EDITOR.dirty = true; EDITOR.status(); },

  mouseDown(sx, sy, btn) {
    if (btn === 1) { EDITOR.panFrom = [sx, sy, EDITOR.cam.x, EDITOR.cam.y]; return; }
    EDITOR.paintBtn = btn;
    EDITOR.mouseMove(sx, sy);
  },
  mouseMove(sx, sy) {
    if (EDITOR.panFrom) {
      const [x0, y0, cx, cy] = EDITOR.panFrom;
      EDITOR.cam.x = cx - (sx - x0); EDITOR.cam.y = cy - (sy - y0);
      EDITOR.clampCam();
      return;
    }
    const c = EDITOR.cellAt(sx, sy);
    const moved = !EDITOR.hover || c[0] !== EDITOR.hover[0] || c[1] !== EDITOR.hover[1];
    EDITOR.hover = c;
    if (EDITOR.paintBtn === 0) EDITOR.paint(c[0], c[1]);
    else if (EDITOR.paintBtn === 2) EDITOR.erase(c[0], c[1]);
    else if (moved) EDITOR.status();
  },
  mouseUp() { EDITOR.paintBtn = -1; EDITOR.panFrom = null; },
  wheel(dx, dy, shift) {
    if (shift) EDITOR.cam.y += dy; else EDITOR.cam.x += dy + dx;
    EDITOR.clampCam();
  },
  clampCam() {
    const L = EDITOR.L;
    EDITOR.cam.x = U.clamp(EDITOR.cam.x, -64, L.w * TILE - VIEW_W + 64);
    EDITOR.cam.y = U.clamp(EDITOR.cam.y, -64, L.h * TILE - VIEW_H + 120);
  },
  update(dt) {
    const k = EDITOR.keys, sp = 700 * dt;
    if (k.ArrowLeft || k.KeyA) EDITOR.cam.x -= sp;
    if (k.ArrowRight || k.KeyD) EDITOR.cam.x += sp;
    if (k.ArrowUp || k.KeyW) EDITOR.cam.y -= sp;
    if (k.ArrowDown || k.KeyS) EDITOR.cam.y += sp;
    EDITOR.clampCam();
  },

  // ---- toolbar actions ----
  confirmLose() { return !EDITOR.dirty || confirm('Discard the unsaved changes?'); },
  selectLevel(i) { if (i !== EDITOR.index && EDITOR.confirmLose()) { EDITOR.open(i); EDITOR.buildPalette(); } },
  save() {
    try {
      localStorage.setItem(GAME.customKey(EDITOR.index), JSON.stringify(EDITOR.L.toJSON()));
      EDITOR.dirty = false; EDITOR.status('saved: the game now uses this version');
    } catch (e) { alert('Could not save: ' + e.message); }
  },
  revert() {
    if (!confirm('Remove the version saved in this browser and go back to ' + (GAME.hasFile(EDITOR.index) ? 'the level file?' : 'the procedural level?'))) return;
    try { localStorage.removeItem(GAME.customKey(EDITOR.index)); } catch (e) { }
    GAME.cache[EDITOR.index] = null;
    EDITOR.L = GAME.getLevel(EDITOR.index).clone();
    EDITOR.dirty = false; EDITOR.refreshBar();
  },
  regenerate() {
    if (!EDITOR.confirmLose()) return;
    let seed = parseInt(document.getElementById('edseed').value);
    if (!seed) seed = 1 + Math.floor(Math.random() * 999999);
    EDITOR.L = GEN.generate(EDITOR.index, seed);
    EDITOR.dirty = true; EDITOR.refreshBar();
  },
  randomSeed() {
    document.getElementById('edseed').value = 1 + Math.floor(Math.random() * 999999);
    EDITOR.regenerate();
  },
  resize(d) { EDITOR.L.resize(EDITOR.L.w + d); EDITOR.changed(); },
  play() { GAME.testLevel(EDITOR.L.clone(), EDITOR.index); },
  // Test from the current position: the cell under the mouse, or the middle of the visible area when
  // the mouse is not over the level. The hero starts on the nearest spot where he can stand there; the
  // level in the editor is not changed (only the copy used for the test gets the new start).
  playHere() {
    const L = EDITOR.L;
    const cell = EDITOR.hover || EDITOR.cellAt(VIEW_W / 2, VIEW_H / 2);
    const solid = (x, y) => { const d = TILES[L.get(x, y)]; return !!(d && d.solid); };
    const free = (x, y) => { const d = TILES[L.get(x, y)]; return !!d && !d.solid && !d.water && !d.fire; };
    // stand on the first free cell with solid ground below, searching down from the cell, then to the sides
    const spotIn = x => {
      if (x < 1 || x >= L.w - 1) return null;
      let y = Math.max(0, Math.min(L.h - 2, cell[1]));
      while (y > 0 && solid(x, y)) y--;                 // inside a block: go up to free space
      while (y < L.h - 2 && !solid(x, y + 1)) { if (!free(x, y + 1) && !solid(x, y + 1)) return null; y++; }   // fall to the ground (water/fire below: not a spot)
      return solid(x, y + 1) && free(x, y) ? [x, y] : null;
    };
    let spot = null;
    for (let d = 0; d <= 14 && !spot; d++) spot = spotIn(cell[0] + d) || spotIn(cell[0] - d);
    if (!spot) { EDITOR.status('no ground to stand on near that point'); return; }
    const T = L.clone();
    T.ents = T.ents.filter(e => e.t !== 'start');
    T.add('start', spot[0], spot[1]);
    GAME.testLevel(T, EDITOR.index);
  },
  exportJSON() {
    const blob = new Blob([JSON.stringify(EDITOR.L.toJSON())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'world' + (EDITOR.index + 1) + '.json';   // put it in levels/ to ship it with the game
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try { EDITOR.L = Level.fromJSON(JSON.parse(r.result)); EDITOR.dirty = true; EDITOR.refreshBar(); }
      catch (e) { alert('Not a valid level file: ' + e.message); }
    };
    r.readAsText(file);
  },
  close() { if (EDITOR.confirmLose()) { EDITOR.dirty = false; UI.title(); } },

  // ---- drawing ----
  draw(ctx) {
    const L = EDITOR.L, cam = { x: Math.round(EDITOR.cam.x), y: Math.round(EDITOR.cam.y) };
    const theme = THEMES[L.theme] || THEMES[0];
    RENDER.background(ctx, theme, Math.max(0, cam.x), GEN.BASE_G * TILE - cam.y);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(-200, -200, 200, L.h * TILE + 400); ctx.fillRect(L.w * TILE, -200, 200, L.h * TILE + 400);
    ctx.fillRect(0, L.h * TILE, L.w * TILE, 200);
    const t = performance.now() / 1000;
    RENDER.tiles(ctx, L, theme, cam, null, t, true);
    RENDER.water(ctx, L, cam, t);
    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(cam.x / TILE); x <= (cam.x + VIEW_W) / TILE; x++) { ctx.moveTo(x * TILE + 0.5, cam.y); ctx.lineTo(x * TILE + 0.5, cam.y + VIEW_H); }
    for (let y = Math.floor(cam.y / TILE); y <= (cam.y + VIEW_H) / TILE; y++) { ctx.moveTo(cam.x, y * TILE + 0.5); ctx.lineTo(cam.x + VIEW_W, y * TILE + 0.5); }
    ctx.stroke();
    for (const e of L.ents) {
      if (e.x * TILE < cam.x - 128 || e.x * TILE > cam.x + VIEW_W + 64) continue;
      EDITOR.drawEnt(ctx, e);
    }
    if (EDITOR.hover) {
      const [hx, hy] = EDITOR.hover;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(hx * TILE + 1, hy * TILE + 1, TILE - 2, TILE - 2);
      if (EDITOR.paintBtn < 0) {
        ctx.globalAlpha = 0.5;
        ctx.save(); ctx.translate(hx * TILE, hy * TILE); EDITOR.drawIcon(ctx, EDITOR.tool.kind, EDITOR.tool.v); ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    RENDER.text(ctx, 'LEVEL EDITOR', 12, 68, 14, '#ffe27a');
  },
  drawEnt(ctx, e) {
    const bx = (e.x + 0.5) * TILE, by = (e.y + 1) * TILE;
    const ic = ENT_ICON[e.t];
    if (e.t === 'secret') {
      ctx.strokeStyle = '#ffe27a'; ctx.setLineDash([5, 4]); ctx.strokeRect((e.x - 1) * TILE, (e.y - 1) * TILE, 3 * TILE, 3 * TILE); ctx.setLineDash([]);
      RENDER.text(ctx, '★', bx - 8, by - 8, 20, '#ffe27a');
      return;
    }
    if (['coin', 'scoin', 'heart', 'potion', 'medkit', 'plasma', 'orb'].indexOf(e.t) >= 0) SPR.draw(ctx, ic[0], bx, by - 16, { ax: 0.5, ay: 0.5 });
    else if (e.t === 'spikeball') SPR.draw(ctx, ic[0], bx, by - 15, { ax: 0.5, ay: 0.5 });
    else SPR.draw(ctx, ic[0], bx, by + 1, { ax: 0.5, ay: 1, scale: ic[1] === 0.6 ? 1.3 : ic[1] * (e.t === 'start' ? 1 : 1), flip: e.t === 'turret' });
    if (e.t === 'start') RENDER.text(ctx, 'START', bx, by - 48, 11, '#7f7', 'center');
    if (e.t === 'sign' && e.text) RENDER.text(ctx, e.text.slice(0, 18) + (e.text.length > 18 ? '…' : ''), bx, by - 34, 10, '#fff', 'center');
    if (e.t === 'exit' && e.boss) RENDER.text(ctx, 'boss', bx, by - 70, 10, '#e8c8ff', 'center');
  }
};
