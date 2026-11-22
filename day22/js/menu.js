'use strict';
// Title-screen style menus (same layout as day20 "Skyward"): logo and big items on the left,
// an info card on the right that follows the selection. One DOM container (#menu) for every mode:
// main (title), pause, complete (world clear / victory), gameover.

const $ = id => document.getElementById(id);

const WORLD_INFO = [
  'Rolling meadows where everything starts. Signs teach you how portals work: grates, high walls, flings and falling monsters.',
  'Damp caves full of water, bats and spitting turrets. Cracked bricks hide the way forward — bring the fire to them.',
  'A fortress under the night sky. Fire pits, spike balls, the hardest portal puzzles and the Dark Knight waiting at the end.'
];

const MENU = { mode: 'main', sel: 0, items: [], world: 0, data: null, shown: null, thumbs: [] };
const fmtN = n => Number(n).toLocaleString('en-US');

const UI = {
  current: null,
  show(id) {
    $('menu').classList.toggle('hidden', id !== 'menu');
    $('victory').classList.toggle('hidden', id !== 'victory');
    for (const o of ['edbar', 'edpal', 'edstatus']) $(o).classList.toggle('hidden', id !== 'editor');
    $('stage').classList.toggle('dim', id === 'menu' && MENU.mode !== 'main');
    UI.current = id;
  },
  open(mode, data) {
    MENU.mode = mode; MENU.data = data || null; MENU.sel = 0;
    UI.show('menu');
    UI.render(true);
  },
  title() { GAME.state = 'title'; UI.open('main'); },
  pause() { GAME.state = 'pause'; SFX.pause(); UI.open('pause'); },
  resume() { SFX.resume(); GAME.state = 'play'; UI.show(null); IN.mouse.clicked = [false, false, false]; },
  gameOver() { UI.open('gameover'); },
  levelComplete(s) { UI.open('complete', s); },
  // Triumph screen shown after the final door of world 3: the victory picture full screen (slow zoom,
  // fade in from black), a title, the score, and "press Enter" to go on to the score breakdown.
  victory(s) {
    UI.show('victory');
    UI.victoryData = s; UI.victoryAt = performance.now();
    $('victory').innerHTML =
      '<img src="img/victory.jpg" alt="">' +
      '<div class="vshade"></div>' +
      '<div class="vtext"><span class="kicker">Mission complete</span><h1>VICTORY</h1>' +
      '<p class="vsub">The Dark Citadel has fallen</p>' +
      '<div class="vscore"><span>SCORE</span><b>' + fmtN(GAME.score) + '</b></div>' +
      '<div class="vhint">PRESS ENTER TO CONTINUE</div></div>';
    SFX.triumph();
  },
  // leave the triumph screen (not in the first 1.5 s, so a key still held does not skip it)
  victoryNext() {
    if (UI.current !== 'victory' || performance.now() - UI.victoryAt < 1500) return;
    SFX.select();
    UI.levelComplete(UI.victoryData);
  },

  items() {
    switch (MENU.mode) {
      case 'pause': return ['resume', 'respawn', 'restart', 'controls', 'music', 'quit'];
      case 'complete': return MENU.data.last ? ['title'] : ['next', 'title'];
      case 'gameover': return ['retry', 'title'];
      case 'controls': return ['back'];
      default: return ['play', 'worlds', 'editor', 'controls', 'music'];
    }
  },
  unlocked(i) { return i + 1 <= GAME.progress().unlocked; },

  isLocked(id) { return id === 'editor' && !GAME.editorUnlocked(); },
  itemHtml(id) {
    const L = {
      play: 'Play', worlds: 'Worlds', editor: 'Level Editor', controls: 'Controls', resume: 'Resume', respawn: 'Back to Checkpoint',
      restart: 'Restart World', music: 'Music', back: 'Back', quit: GAME.test ? 'Back to Editor' : 'Quit to Title', next: 'Next World', title: 'Title Screen', retry: 'Try Again'
    };
    let extra = '';
    if (id === 'worlds') {
      const name = THEMES[MENU.world].name + (UI.unlocked(MENU.world) ? '' : ' ·🔒');
      extra = '<span class="diff"><a data-d="-1">◀</a><u>' + name + '</u><a data-d="1">▶</a></span>';
    }
    if (id === 'editor' && UI.isLocked(id)) extra = '<span class="count">🔒</span>';   // locked until all 3 worlds are completed
    if (id === 'music') extra = '<span class="count">' + (MUSIC.enabled ? 'On' : 'Off') + ' · key M</span>';
    if (id === 'respawn') extra = '<span class="count">−1 life</span>';
    if (id === 'next') extra = '<span class="count">World 0' + (GAME.levelIndex + 2) + ' · ' + THEMES[GAME.levelIndex + 1].name + '</span>';
    if (id === 'retry') extra = '<span class="count">World 0' + (GAME.levelIndex + 1) + ' · 3 lives</span>';
    return '<span class="lbl">' + L[id] + '</span>' + extra;
  },

  header() {
    const w = 'WORLD 0' + (GAME.levelIndex + 1) + ' · ' + (GAME.levelData ? GAME.levelData.name.toUpperCase() : '');
    if (MENU.mode === 'main') return '<div class="logowrap"><img class="logoimg" src="img/title.png" alt="Super Portal Guy"><canvas class="vortex" width="24" height="28"></canvas></div><div class="sub">(IDEA BY A.PANNONE)</div>';
    if (MENU.mode === 'controls') return '<div class="logo ctl">CONTROLS<small>PORTAL GUN · RUN · JUMP</small></div><div class="ctl-keys">' + UI.card('controls').replace('<h4>Controls</h4>', '') + '</div>';
    if (MENU.mode === 'pause') return '<div class="logo pause">PAUSED<small>' + w + ' · ' + Math.floor(GAME.time) + ' S · ' + fmtN(GAME.score) + ' PTS</small></div>';
    if (MENU.mode === 'complete') {
      const s = MENU.data;
      return '<div class="logo res">' + (s.last ? 'MISSION COMPLETE' : 'WORLD CLEAR') + '<small>' + w + ' · ' + s.time + ' S · ' + s.secrets + '/' + s.secretsTotal + ' SECRETS</small></div>' +
        '<div class="bigscore"><span>SCORE</span><b>' + fmtN(GAME.score) + '</b></div>';
    }
    return '<div class="logo res fail">GAME OVER<small>' + w + '</small></div>' +
      '<div class="bigscore"><span>FINAL SCORE</span><b>' + fmtN(GAME.score) + '</b></div>';
  },

  card(id) {
    if (MENU.mode === 'complete') {
      const s = MENU.data, row = (k, v, c) => '<tr' + (c ? ' class="' + c + '"' : '') + '><td>' + k + '</td><td>' + v + '</td></tr>';
      return '<h4>Score breakdown</h4><table class="breakdown">' +
        row('Time bonus <i>' + s.time + ' s</i>', '+' + fmtN(s.timeBonus)) +
        row('Secrets <i>' + s.secrets + ' / ' + s.secretsTotal + ' found</i>', '+' + fmtN(s.secretBonus)) +
        row('Coins', fmtN(GAME.coins)) + row('Lives left', Math.max(0, GAME.lives)) +
        row('Total', fmtN(GAME.score), 'tot') + '</table>' +
        (s.last ? '<p class="small">The Dark Knight is gone and the citadel is free. Thanks for playing Super Portal Guy!</p>' : '') +
        (s.editor ? '<p class="unlock">★ LEVEL EDITOR UNLOCKED — find it in the main menu</p>' : '');
    }
    switch (id) {
      case 'play':
        return '<h4>New Game <em>World 01</em></h4><p>Run, jump and shoot portals through three worlds. Blue and orange portals connect anything: you, monsters, fireballs, spike balls — and they keep their speed.</p>' +
          '<ul class="facts"><li><b>3</b> worlds</li><li><b>3</b> lives</li><li><b>1</b> boss</li></ul>' +
          '<p class="small">Worlds are procedural; edited versions saved in the Level Editor are used instead.</p>';
      case 'worlds': {
        const i = MENU.world, open = UI.unlocked(i), best = GAME.progress().best[i] || 0;
        return '<div class="thumb" data-w="' + i + '"></div><h4>' + THEMES[i].name + ' <em>World 0' + (i + 1) + '</em></h4><p>' + WORLD_INFO[i] + '</p>' +
          (GAME.source(i) === 'custom' ? '<p class="small">Using your edited version of this world.</p>' : GAME.source(i) === 'file' ? '<p class="small">Loaded from levels/world' + (i + 1) + '.json.</p>' : '') +
          (open ? '<div class="best">' + (best ? 'BEST <b>' + fmtN(best) + '</b>' : 'NO RECORD YET') + '</div>' : '<div class="best">🔒 CLEAR WORLD 0' + i + ' TO UNLOCK</div>');
      }
      case 'editor':
        return '<h4>Level Editor</h4><p>Paint tiles and place monsters, traps, power-ups and secrets on the three worlds. Generate new layouts from any seed and test-play instantly.</p>' +
          '<ul class="keys"><li><kbd>Left</kbd> paint · <kbd>Right</kbd> erase</li><li><kbd>Middle drag</kbd> / <kbd>←</kbd><kbd>→</kbd> / wheel scroll</li>' +
          '<li>Save, export and import JSON levels</li></ul>';
      case 'controls':
        return '<h4>Controls</h4><ul class="keys">' +
          '<li><kbd>←</kbd><kbd>→</kbd> or <kbd>A</kbd><kbd>D</kbd> run</li>' +
          '<li><kbd>Space</kbd> / <kbd>↑</kbd> jump — hold to go higher</li>' +
          '<li><kbd>Mouse</kbd> aim the portal gun</li>' +
          '<li><kbd class="blue">Left click</kbd> blue portal · <kbd class="orange">Right click</kbd> orange</li>' +
          '<li><kbd>Shift</kbd> / <kbd>Middle click</kbd> plasma shot (power-up)</li>' +
          '<li><kbd>R</kbd> close portals · <kbd>Esc</kbd> <kbd>P</kbd> pause · <kbd>M</kbd> music on/off</li></ul>' +
          '<p class="small">Portals stick to earth and stone, never to metal. Shots fly through grates — you don\'t.</p>';
      case 'resume': return '<h4>Resume</h4><p>Back into the action, right where you left off.</p><p class="small">Press <kbd>Esc</kbd> or <kbd>P</kbd> to resume at any time.</p>';
      case 'respawn': return '<h4>Back to Checkpoint</h4><p>Stuck behind a puzzle you can no longer solve? Respawn at the last checkpoint.</p><p class="small">Costs one life. Portals are closed.</p>';
      case 'restart': return '<h4>Restart World</h4><p>Start this world again from the beginning.</p><p class="small">Score and coins collected so far are kept.</p>';
      case 'quit': return GAME.test ? '<h4>Back to Editor</h4><p>Stop the test play and go back to editing.</p>' : '<h4>Quit to Title</h4><p>Leave the current game.</p><p class="small">Progress inside this world is lost.</p>';
      case 'retry': return '<h4>Try Again</h4><p>Restart World 0' + (GAME.levelIndex + 1) + ' with three fresh lives.</p><p class="small">Tip: a portal on the floor and one up high lets you skip most dangers.</p>';
      case 'title': return '<h4>Title Screen</h4><p>Back to the main menu.</p>';
      case 'next': return '<h4>Next World <em>World 0' + (GAME.levelIndex + 2) + '</em></h4><p>' + WORLD_INFO[GAME.levelIndex + 1] + '</p>';
    }
    return '';
  },

  // Builds the DOM once (with its entrance animation); moving only updates selection and card.
  render(full) {
    const items = UI.items();
    MENU.sel = U.clamp(MENU.sel, 0, items.length - 1);
    const el = $('menu');
    const ul = el.querySelector('.items');
    if (full || !ul || items.join() !== MENU.items.join()) {
      MENU.items = items; MENU.shown = null;
      el.className = 'mode-' + MENU.mode;
      el.innerHTML = '<div class="mv-left">' + UI.header() +
        '<ul class="items">' + items.map((id, i) => '<li data-i="' + i + '" class="' + (i === MENU.sel ? 'sel' : '') + (UI.isLocked(id) ? ' locked' : '') + '">' + UI.itemHtml(id) + '</li>').join('') + '</ul>' +
        '</div>' +
        '<div class="mv-info"></div>' +
        (MENU.mode === 'main' ? '<div class="fine">A nonprofit independent amateur project. Not affiliated with Valve Corporation.</div>' : '');
    } else {
      ul.querySelectorAll('li').forEach((li, i) => {
        li.classList.toggle('sel', i === MENU.sel);
        li.classList.toggle('locked', UI.isLocked(items[i]));
        const h = UI.itemHtml(items[i]);
        if (li.dataset.h !== h) { li.innerHTML = h; li.dataset.h = h; }
      });
    }
    // the title screen has no info card
    const card = MENU.mode === 'main' || MENU.mode === 'controls' ? '' : UI.card(MENU.items[MENU.sel]);
    if (MENU.shown !== card) {
      el.querySelector('.mv-info').innerHTML = card;
      MENU.shown = card;
      const th = el.querySelector('.thumb');
      if (th) th.appendChild(UI.thumb(+th.dataset.w));
    }
  },

  // live preview of a world, rendered once and cached
  thumb(i) {
    if (MENU.thumbs[i]) return MENU.thumbs[i];
    const big = document.createElement('canvas');
    big.width = VIEW_W; big.height = VIEW_H;
    const c = big.getContext('2d');
    c.imageSmoothingEnabled = false;
    const L = GAME.getLevel(i), w = new World(L);
    const s = L.ents.find(e => e.t === 'start') || { x: 2 };
    const boss = L.ents.find(e => e.t === 'boss');
    const idx = i === 0 ? -1 : L.t.indexOf('C');
    const fx = boss ? (boss.x - 16) * TILE : idx >= 0 ? (idx % L.w - 9) * TILE : (s.x - 3) * TILE;
    GAME.drawWorld(c, w, { x: U.clamp(fx, 0, L.w * TILE - VIEW_W), y: L.h * TILE - VIEW_H }, { noAim: true });
    const t = document.createElement('canvas');
    t.width = 352; t.height = 150;
    t.getContext('2d').drawImage(big, 60, 170, 880, 375, 0, 0, t.width, t.height);
    return (MENU.thumbs[i] = t);
  },

  // Animated vortex inside the "O" of the logo: rotating spiral arms, dark depth, pulsing core.
  // One canvas pixel = one pixel of the logo art (VORTEX_MASK cells from tools/cut.py), coloured
  // with the blue ramp of the logo ring, so it blends with the title's pixel art.
  VPAL: ['#020a2e', '#03144f', '#04206e', '#0a2f96', '#0a49c0', '#1468dc', '#2c98f2', '#82d4ff', '#e6f6ff'],
  drawVortex(t) {
    const cv = document.querySelector('#menu .vortex');
    if (!cv || typeof VORTEX_MASK === 'undefined') return;
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, P = UI.VPAL;
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 0.2, rx = 9.4, ry = 12.4;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!VORTEX_MASK[y] || VORTEX_MASK[y][x] !== '#') continue;
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, r = Math.min(1, Math.hypot(nx, ny));
      const a = Math.atan2(ny, nx);
      const s1 = 0.5 + 0.5 * Math.sin(a * 3 - Math.log(r + 0.06) * 4.5 - t * 3.2);
      const s2 = 0.5 + 0.5 * Math.sin(a * 2 + r * 7 - t * 1.7);
      const arms = s1 * s1 * 0.8 + s2 * 0.2;
      const core = Math.max(0, 1 - r / 0.28) * (0.75 + 0.25 * Math.sin(t * 5));
      // darker toward the rim, like the inner edge of the logo's O
      // the core only gets lighter blue (never the near-white tints of the ramp), so no white pixels appear
      const b = 0.08 + arms * 0.62 * (1 - 0.55 * r) + core * 0.28;
      c.fillStyle = P[Math.max(0, Math.min(6, Math.round(b * (P.length - 1))))];
      c.fillRect(x, y, 1, 1);
    }
  },
  move(d) { MENU.sel = (MENU.sel + d + MENU.items.length) % MENU.items.length; SFX.move(); UI.render(); },
  world(d) { MENU.world = (MENU.world + d + 3) % 3; SFX.tick(); UI.render(); },
  confirm() {
    const id = MENU.items[MENU.sel];
    if (UI.isLocked(id)) { SFX.back(); return; }
    if (id === 'music') { MUSIC.toggle(); SFX.tick(); UI.render(); return; }
    if (id === 'back' || id === 'title' || id === 'quit' || (id === 'worlds' && !UI.unlocked(MENU.world))) SFX.back();
    else if (id !== 'resume' && id !== 'respawn') SFX.select();
    switch (id) {
      case 'play': GAME.newGame(0); break;
      case 'worlds': if (UI.unlocked(MENU.world)) GAME.newGame(MENU.world); break;
      case 'editor': MENU.thumbs = []; EDITOR.open(0); EDITOR.buildPalette(); break;
      case 'resume': UI.resume(); break;
      case 'respawn': UI.resume(); GAME.world.player.die(GAME.world, 'fall'); GAME.world.player.dying = 1.9; break;
      case 'restart': GAME.carry = null; GAME.startLevel(GAME.levelIndex, GAME.test ? GAME.levelData : undefined); break;
      case 'quit': if (GAME.test) EDITOR.open(GAME.levelIndex, true); else UI.title(); break;
      case 'next': GAME.nextLevel(); break;
      case 'retry': GAME.lives = 3; GAME.score = 0; GAME.coins = 0; GAME.carry = null; GAME.startLevel(GAME.levelIndex); break;
      case 'title': UI.title(); break;
      case 'controls': if (MENU.mode === 'main') UI.open('controls'); break;
      case 'back': UI.open('main'); MENU.sel = 3; UI.render(); break;
    }
  },
  key(e) {
    const c = e.code;
    if (c === 'ArrowUp' || c === 'KeyW') UI.move(-1);
    else if (c === 'ArrowDown' || c === 'KeyS') UI.move(1);
    else if ((c === 'ArrowLeft' || c === 'KeyA') && MENU.items[MENU.sel] === 'worlds') UI.world(-1);
    else if ((c === 'ArrowRight' || c === 'KeyD') && MENU.items[MENU.sel] === 'worlds') UI.world(1);
    else if (c === 'Enter' || c === 'Space') UI.confirm();
    else if ((c === 'Escape' || c === 'KeyP') && MENU.mode === 'pause') UI.resume();
    else if (c === 'Escape' && MENU.mode === 'controls') {
      SFX.back(); UI.open('main'); MENU.sel = 3; UI.render(); }
    else return;
    e.preventDefault();
  }
};

// mouse: hover selects, click confirms, ◀ ▶ change world
$('menu').addEventListener('mouseover', e => {
  const li = e.target.closest('li[data-i]');
  if (li && +li.dataset.i !== MENU.sel) { MENU.sel = +li.dataset.i; SFX.move(); UI.render(); }
});
$('menu').addEventListener('click', e => {
  const li = e.target.closest('li[data-i]');
  if (!li) return;
  MENU.sel = +li.dataset.i;
  const d = e.target.closest('a[data-d]');
  if (d) UI.world(+d.dataset.d); else UI.confirm();
});
