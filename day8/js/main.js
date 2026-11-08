'use strict';

// Screens, input, HUD, message log and saved data.
(() => {
  const KEY = 'oppd2026.day8.';
  const LOG_SIZE = 6;
  const HISTORY_SIZE = 600;
  const SAVE_EVERY = 20;      // turns between automatic saves (also on every level and when leaving the page)
  const SAVED_LOG = 200;      // messages kept with the save   // messages kept for the full log (P)
  const MAX_SCORES = 5;
  const OVER_DELAY = 900;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(KEY + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const settings = Object.assign({ sound: true, minimap: true, cls: 'warrior' }, store.get('settings', {}));
  const CLASS_KEYS = Object.keys(Game.CLASSES);
  if (!Game.CLASSES[settings.cls]) settings.cls = CLASS_KEYS[0];

  let s = null;
  let screen = 'title';
  let queued = null;
  let history = [];
  let savedTurn = -1, saveWarned = false;
  // the hourglass: states at the start of the last turns on this level
  let snaps = [];
  let digging = false;      // G pressed: the next direction digs
  let pendingDeath = false; // dead with a charge left: rewind or accept
  let heirChoice = null;    // the heirloom picked on the end screen           // every message of this game: { text, cls, depth }

  const atlas = new Image();
  atlas.src = 'assets/atlas.png';

  // sprite icons in the HTML, from the same atlas
  function icon(el, name) {
    const size = el.clientWidth || 24;
    if (Icons.has(name)) {
      el.style.backgroundImage = 'url(' + Icons.url(name) + ')';
      el.style.backgroundSize = '100% 100%';
      el.style.backgroundPosition = '0 0';
      el.style.imageRendering = 'pixelated';
      return;
    }
    el.style.imageRendering = '';
    const [c, r] = ATLAS.sprites[name];
    const rows = Math.ceil(Object.keys(ATLAS.sprites).length / 16);
    el.style.backgroundImage = 'url(assets/atlas.png)';
    el.style.backgroundSize = 16 * size + 'px ' + rows * size + 'px';
    el.style.backgroundPosition = -c * size + 'px ' + -r * size + 'px';
  }
  const icons = () => document.querySelectorAll('i[data-s]').forEach(el => icon(el, el.dataset.s));

  // ---- screens --------------------------------------------------------------

  function show(name) {
    screen = name;
    $('title').hidden = name !== 'title';
    $('choose').hidden = name !== 'choose';
    $('over').hidden = name !== 'over';
    for (const id of ['scroll-menu', 'shop-menu', 'log-menu', 'ask-menu']) $(id).hidden = true;
    const playing = name === 'game' || name === 'over';
    for (const id of ['hud', 'log', 'keys']) $(id).hidden = !playing;
    $('minimap').hidden = !playing || !settings.minimap;
    if (name === 'title') { savedRun(); best(); fitTitle(); }
    if (name !== 'game') Sound.ambient(null);
    if (name === 'choose') classes();
    icons();
  }

  // ---- the saved run ------------------------------------------------------------

  const SAVE_KEY = KEY + 'save';
  const readSave = () => { try { return localStorage.getItem(SAVE_KEY); } catch (e) { return null; } };
  function dropSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* private mode */ }
    store.set('saveInfo', null);
  }

  function saveRun() {
    if (!s || s.over) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ game: Game.save(s), log: history.slice(-SAVED_LOG) }));
      const h = s.hero;
      store.set('saveInfo', { name: h.name, cls: h.cls, depth: s.depth, ascending: s.ascending, lvl: h.lvl });
      savedTurn = s.turn;
    } catch (e) {
      if (!saveWarned) { saveWarned = true; msg('The game could not be saved (no space left in the browser).', 'warn'); }
    }
  }

  function continueGame() {
    const text = readSave();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    const loaded = data && Game.load(data.game);
    if (!loaded) { dropSave(); show('title'); return; }
    Sound.unlock();
    s = loaded;
    snaps = []; digging = false; pendingDeath = false;
    history = data.log || [];
    $('log').innerHTML = '';
    for (const m of history.slice(-LOG_SIZE)) {
      const li = document.createElement('li');
      li.textContent = m.text;
      if (m.cls) li.className = m.cls;
      $('log').appendChild(li);
    }
    savedTurn = s.turn;
    Render.reset();
    show('game');
    Sound.play('start');
    msg('Welcome back, ' + s.hero.name + '. Depth ' + s.depth + ' — the ' + s.theme.name + '.', 'magic');
    hud();
  }

  function newGame() {
    // a new game abandons the saved one
    dropSave();
    Sound.unlock();
    const heir = store.get('heir', null);
    s = Game.create(undefined, store.get('past', null), settings.cls, heir, store.get('graffiti', []));
    snaps = []; digging = false; pendingDeath = false;
    $('log').innerHTML = '';
    history = [];
    Render.reset();
    show('game');
    Sound.play('start');
    msg(s.hero.name + ' enters the ' + s.theme.name + '. Find the stairs down, and watch your step.', 'magic');
    if (s.hero.lantern) msg('You carry the lantern of your family. It burns a little brighter with every generation (' + s.hero.lantern + '/5).', 'gold');
    if (heir) msg('You are the child of ' + heir.from + (heir.item ? ', and you carry what they left you: ' + heir.item.name + '.' : '.'), 'hint');
    hud();
  }

  // class choice on the title screen: same hero, three colours
  function classes() {
    const el = $('classes');
    el.innerHTML = CLASS_KEYS.map((k, i) => {
      const c = Game.CLASSES[k];
      return '<button role="radio" data-cls="' + k + '" aria-checked="' + (k === settings.cls) + '">' +
        '<i data-s="' + k + '_down"></i><b><kbd>' + (i + 1) + '</kbd> ' + c.name + '</b><small>' + c.info + '</small></button>';
    }).join('');
    icons();
  }

  function choose(k) {
    if (!Game.CLASSES[k]) return;
    settings.cls = k;
    store.set('settings', settings);
    for (const b of $('classes').children) b.setAttribute('aria-checked', b.dataset.cls === k);
  }

  // the Continue button, when a run was saved
  function savedRun() {
    const info = readSave() && store.get('saveInfo', null);
    $('continue').hidden = !info;
    $('saved-run').hidden = !info;
    $('title-hint').innerHTML = info ? 'Press <kbd>Enter</kbd> to continue, <kbd>N</kbd> for a new game'
      : 'Press <kbd>Enter</kbd> to begin your descent';
    if (info) {
      $('saved-run').textContent = 'Saved: ' + info.name + ', level ' + info.lvl + ' ' + Game.CLASSES[info.cls].name.toLowerCase() +
        ', depth ' + info.depth + (info.ascending ? ' on the way up' : '') + '. A new game abandons it.';
    }
  }

  // the title image takes the height left by the menu, so nothing is cut off
  function fitTitle() {
    const img = $('title').querySelector('img'), menu = $('title').querySelector('.menu');
    img.style.maxHeight = Math.max(140, Math.min(window.innerHeight * 0.62, window.innerHeight - menu.offsetHeight - 18 - 32 - 8)) + 'px';
  }

  function lineageLine() {
    const l = store.get('lineage', []);
    if (l.length < 2) return '';
    return '<p id="lineage">Lineage: ' + l.map(p => p.name + (p.won ? ' ★' : '')).join(' → ') + ' → …</p>';
  }

  function best() {
    const list = store.get('scores', []);
    const el = $('best');
    if (!list.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<table><caption>Hall of fame</caption><tr><th>Score</th><th>Hero</th><th>Class</th><th>Depth</th><th>Level</th><th>Date</th></tr>' +
      list.map(r => '<tr><td>' + r.score + (r.won ? ' ★' : '') + (r.cheat ? '*' : '') + '</td><td>' + (r.name || '-') + (r.parent ? '<br><span class="parent">child of ' + r.parent + '</span>' : '') + '</td><td>' + (r.cls ? Game.CLASSES[r.cls].name : '-') + '</td><td>' + r.depth + '</td><td>' + r.lvl + '</td><td>' + r.date + '</td></tr>').join('') + '</table>' +
      (list.some(r => r.won) ? '<p class="help">★ escaped with the Heart of the Deep</p>' : '') +
      lineageLine() +
      (list.some(r => r.cheat) ? '<p class="help">* this player knows how to play the Colossal Cave Adventure</p>' : '');
  }

  function gameOver() {
    // a charge of the hourglass left: the player may turn time back instead
    if (!s.won && s.hero.hourglass && rewindTarget()) {
      pendingDeath = true;
      $('over-title').textContent = 'You died';
      $('over-icon').dataset.s = 'hourglass';
      icon($('over-icon'), 'hourglass');
      $('cause').textContent = s.hero.name + (/^succumbed/.test(s.cause) ? ' ' : ' was ') + s.cause + '.';
      $('verse').hidden = true;
      $('over-icon').classList.remove('pulse');
      $('over').classList.remove('won');
      $('summary').innerHTML = '';
      $('record').textContent = '';
      $('rewind-offer').hidden = false;
      $('heir').hidden = true;
      $('over-actions').hidden = true;
      setTimeout(() => { if (s && s.over) show('over'); }, OVER_DELAY);
      return;
    }
    finish();
  }

  function finish() {
    pendingDeath = false;
    const h = s.hero;
    dropSave();
    $('rewind-offer').hidden = true;
    $('over-actions').hidden = false;
    // the family goes on
    const lineage = store.get('lineage', []);
    lineage.push({ name: h.name, won: !!s.won });
    store.set('lineage', lineage.slice(-8));
    heirs();
    const score = Game.score(s);
    const list = store.get('scores', []);
    const entry = { score, name: h.name, parent: h.parent || null, cls: h.cls, depth: s.maxDepth, lvl: h.lvl, kills: h.kills, gold: h.gold, date: new Date().toISOString().slice(0, 10), cheat: !!s.cheated, won: !!s.won };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const rank = list.indexOf(entry);
    store.set('scores', list.slice(0, MAX_SCORES));
    // the next run will meet this hero again, as a shade
    // a hero who escaped does not come back as a shade
    store.set('past', s.won ? null : Game.pastRecord(s));
    $('over-title').textContent = s.won ? 'Victory!' : 'You died';
    $('over-icon').dataset.s = s.won ? 'artifact' : 'skull';
    icon($('over-icon'), $('over-icon').dataset.s);
    // every cause reads after "was", except the poison
    // the words scratched on a wall for the descendants, and the bard's song if there is one
    const graffiti = store.get('graffiti', []);
    graffiti.push(Game.graffitiFor(s));
    store.set('graffiti', graffiti.slice(-10));
    $('verse').hidden = !h.verse;
    $('verse').textContent = h.verse ? 'The bard sang of you: "' + h.verse + '"' : '';
    $('over-icon').classList.toggle('pulse', !!s.won);
    $('over').classList.toggle('won', !!s.won);
    $('cause').textContent = s.won ? h.name + ' escaped the dungeon with the Heart of the Deep!'
      : h.name + (/^succumbed/.test(s.cause) ? ' ' : ' was ') + s.cause + '.';
    Sound.ambient(null);
    Sound.play(s.won ? 'victory' : 'funeral');
    const rows = [['Hero', h.name + (h.parent ? ', child of ' + h.parent : '')], ['Class', Game.CLASSES[h.cls].name], ['Deepest', s.maxDepth], ['Level', h.lvl], ['Strength', h.str], ['Weapon', Game.GEAR[h.weapon].name], ['Armour', h.armor ? Game.GEAR[h.armor].name : 'none'], ['Foes slain', h.kills], ['Gold', h.gold], ['Score', score]];
    if (h.lantern) rows.push(['Lantern', h.lantern + '/5']);
    if (s.won) rows.push(['Lineage', lineage.slice(-5).map(p => p.name).join(' → ')]);
    $('summary').innerHTML = rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>').join('');
    $('record').textContent = rank === 0 ? 'A new record!' : rank < MAX_SCORES ? 'Hall of fame: #' + (rank + 1) : '';
    if (screen !== 'over') setTimeout(() => { if (s && s.over) show('over'); }, OVER_DELAY);
  }

  // the heirloom: the first one is picked unless the player chooses another
  let heirItems = [];
  function heirs() {
    heirItems = Game.heirlooms(s);
    const ol = $('heir-list');
    ol.innerHTML = '';
    $('heir').hidden = !heirItems.length;
    heirItems.forEach((it, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.setAttribute('role', 'radio');
      b.innerHTML = '<kbd>' + (i + 1) + '</kbd><b><i data-s="' + it.icon + '"></i>' + it.name + '</b>';
      b.addEventListener('click', () => pickHeir(i));
      li.appendChild(b);
      ol.appendChild(li);
    });
    pickHeir(heirItems.length ? 0 : -1);
    icons();
  }

  function pickHeir(i) {
    const it = heirItems[i] || null;
    store.set('heir', { from: s.hero.name, item: it, lantern: s.hero.lantern || 0 });
    [...$('heir-list').querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-checked', k === i));
  }

  // ---- HUD and log ----------------------------------------------------------

  function hud() {
    if (!s) return;
    const h = s.hero;
    $('hp').textContent = h.hp + ' / ' + h.maxHp;
    $('hp-bar').style.width = (100 * h.hp / h.maxHp) + '%';
    document.querySelector('.stat.hp').classList.toggle('poison', h.poison > 0);
    $('str').textContent = h.str;
    const w = Game.GEAR[h.weapon], ar = h.armor ? Game.GEAR[h.armor] : null;
    $('atk').textContent = '+' + Game.atk(h);
    $('def').textContent = Game.def(h);
    $('weapon').title = 'Weapon: ' + w.name + ' (ATK +' + w.atk + ')';
    $('armor').title = ar ? 'Armour: ' + ar.name + ' (DEF +' + ar.def + ')' : 'No armour';
    $('armor').classList.toggle('empty', !ar);
    const wi = $('weapon').querySelector('i'), ai = $('armor').querySelector('i');
    if (wi.dataset.s !== h.weapon) { wi.dataset.s = h.weapon; icon(wi, h.weapon); }
    const an = h.armor || 'leather';
    if (ai.dataset.s !== an) { ai.dataset.s = an; icon(ai, an); }
    $('lvl').textContent = h.lvl;
    $('xp-bar').style.width = (100 * h.xp / Game.xpFor(h.lvl)) + '%';
    $('depth').textContent = s.depth + (s.ascending ? ' ▲' : '');
    $('gold').textContent = h.gold;
    $('kills').textContent = h.kills;
    $('potions').textContent = h.potions;
    const scrolls = Game.scrollCount(h);
    $('scrolls').textContent = scrolls;
    $('use-potion').classList.toggle('empty', !h.potions);
    $('use-scroll').classList.toggle('empty', !scrolls);
    $('view').classList.toggle('trippy', h.trip > 0);
    $('use-hourglass').hidden = !h.hourglass;
    $('hourglass').textContent = h.hourglass;
    $('use-pick').hidden = !h.digs;
    $('digs').textContent = h.digs;
    $('use-pick').classList.toggle('armed', digging);
    const st = [];
    if (h.poison) st.push('Poisoned');
    if (h.stuck) st.push('Trapped');
    if (h.invisible) st.push('Invisible ' + h.invisible);
    if (h.invincible) st.push('Invincible ' + h.invincible);
    if (digging) st.push('Digging: which way?');
    if (h.trip) st.push('Seeing colours ' + h.trip);
    if (s.dread && s.dread.m) st.push('Hunted!');
    if (s.debt) {
      const left = s.debt.due - s.levels;
      st.push('Debt ' + s.debt.amount + (left > 0 ? ' (' + left + (left === 1 ? ' level)' : ' levels)') : ' — bounty hunter!'));
    }
    if (s.arena && s.arena.started && !s.arena.done) st.push('Arena: wave ' + s.arena.wave + '/3');
    if (h.artifact) st.push('Heart of the Deep: climb!');
    $('status').textContent = st.join(' · ');
    $('sound-btn').classList.toggle('off', !settings.sound);
    // the face in the corner, and the sound of the place
    const mood = h.invincible ? 'brave' : h.hp > h.maxHp * 0.6 ? 'fine' : h.hp > h.maxHp * 0.3 ? 'hurt' : 'dying';
    const pt = $('portrait'), fu = Icons.faceUrl(h.cls, mood, h.poison > 0);
    if (pt.dataset.u !== fu) { pt.dataset.u = fu; pt.style.backgroundImage = 'url(' + fu + ')'; }
    pt.title = h.name + ', ' + Game.CLASSES[h.cls].name;
    pt.classList.toggle('invisible', h.invisible > 0);
    pt.classList.toggle('invincible', h.invincible > 0);
    Sound.ambient(screen === 'game' && !s.over ? s.theme.name + (s.night > 0.5 ? ' night' : '') : null);
  }

  function msg(text, cls) {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    const log = $('log');
    log.appendChild(li);
    while (log.children.length > LOG_SIZE) log.firstChild.remove();
    history.push({ text, cls, depth: s ? s.depth : 0 });
    if (history.length > HISTORY_SIZE) history.shift();
  }

  // ---- the hourglass and the pickaxe -------------------------------------------

  // the oldest state of this level no more than REWIND turns back
  function rewindTarget() {
    const ok = snaps.filter(p => p.levels === s.levels && p.turn < s.turn && p.turn >= s.turn - Game.REWIND);
    return ok[0] || null;
  }

  function turnHourglass() {
    if (!s || !s.hero.hourglass) { if (s) msg('You have no hourglass.'); return; }
    const p = rewindTarget();
    if (!p) { msg('The sand will not flow back: nothing has happened here yet.'); return; }
    const back = s.turn - p.turn;
    const t = Game.rewind(s, p.text);
    if (!t) return;
    s = t;
    snaps = snaps.filter(q => q.turn < p.turn && q.levels === s.levels);
    pendingDeath = false;
    Render.reset();
    Render.rewindFlash();
    show('game');
    Sound.play('teleport');
    msg('The sand flows backwards: ' + back + (back === 1 ? ' turn' : ' turns') + ' undone. ' +
      (s.hero.hourglass ? s.hero.hourglass + (s.hero.hourglass === 1 ? ' charge' : ' charges') + ' left.' : 'The hourglass crumbles to dust.'), 'magic');
    hud();
  }

  function startDig() {
    if (!s || s.over || screen !== 'game') return;
    if (!s.hero.digs) { msg('You have no pickaxe.'); return; }
    digging = !digging;
    if (digging) msg('Dig which way? Press a direction (G again to cancel).', 'hint');
    hud();
  }

  // ---- full message log -----------------------------------------------------

  function openLog() {
    if (!s || screen !== 'game') return;
    const ol = $('history');
    ol.innerHTML = '';
    let depth = -1;
    for (const m of history) {
      if (m.depth !== depth) {
        depth = m.depth;
        const h = document.createElement('li');
        h.className = 'depth';
        h.textContent = 'Depth ' + depth;
        ol.appendChild(h);
      }
      const li = document.createElement('li');
      li.textContent = m.text;
      if (m.cls) li.className = m.cls;
      ol.appendChild(li);
    }
    $('log-menu').hidden = false;
    ol.scrollTop = ol.scrollHeight;
    ol.focus();
  }

  function closeLog() { $('log-menu').hidden = true; }

  // ---- merchant -------------------------------------------------------------

  function openShop() {
    if (!s || s.over || screen !== 'game' || !s.shop) return;
    fillShop();
    $('shop-menu').hidden = false;
    const b = $('shop-list').querySelector('button:not(:disabled)');
    if (b) b.focus();
  }

  function fillShop() {
    $('shop-gold').textContent = s.hero.gold;
    $('shop-name').textContent = s.merchant ? s.merchant.name : 'Merchant';
    const ol = $('shop-list');
    ol.innerHTML = '';
    Game.shopItems(s).forEach((it, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.disabled = it.sold;
      b.innerHTML = '<kbd>' + (i + 1) + '</kbd><b><i data-s="' + it.icon + '"></i>' + it.name + '</b>' +
        '<span class="n' + (it.afford || it.sold || it.credit ? '' : ' poor') + '">' + (it.sold ? 'sold' : it.price + ' gold' + (it.afford || !it.credit ? '' : ' · credit ' + it.credit)) + '</span>' +
        '<span class="info">' + it.info + '</span>';
      b.addEventListener('click', () => buy(i));
      li.appendChild(b);
      ol.appendChild(li);
    });
    icons();
  }

  function buy(i) {
    if (!s || s.over) return;
    const focused = document.activeElement;
    Render.play(s, Game.act(s, { type: 'buy', item: i }), hooks);
    fillShop();
    hud();
    // keep the focus on the same row, or the first one still for sale
    const rows = $('shop-list').querySelectorAll('button');
    const again = rows[i] && !rows[i].disabled ? rows[i] : $('shop-list').querySelector('button:not(:disabled)');
    if (again && focused && focused.closest && focused.closest('#shop-list')) again.focus();
  }

  function closeShop() { $('shop-menu').hidden = true; }

  // ---- a question with a few answers (the forgetful knight) ---------------------

  let askCount = 0;
  function openAsk(e) {
    if (!s || s.over) return;
    $('ask-title').textContent = e.title;
    $('ask-text').textContent = e.text;
    const ol = $('ask-list');
    ol.innerHTML = '';
    askCount = e.options.length;
    e.options.forEach((o, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.innerHTML = '<kbd>' + (i + 1) + '</kbd><b>' + o + '</b>';
      b.addEventListener('click', () => answer(i));
      li.appendChild(b);
      ol.appendChild(li);
    });
    $('ask-menu').hidden = false;
    ol.querySelector('button').focus();
  }

  function answer(i) {
    $('ask-menu').hidden = true;
    if (i < 0) { msg('"Take your time... I have plenty of it."', 'hint'); return; }
    if (!s || s.over) return;
    Render.play(s, Game.act(s, { type: 'answer', choice: i }), hooks);
    hud();
  }

  const hooks = {
    msg, hud, shop: openShop, ask: openAsk,
    sound: (name) => Sound.play(name),
    dead: gameOver,
    level: () => { hud(); saveRun(); },
  };

  // ---- actions --------------------------------------------------------------

  function perform(a) {
    if (!s || s.over || screen !== 'game') return;
    if (Render.busy(performance.now())) { queued = a; return; }
    if (digging && a.type === 'move') { a = { type: 'dig', dx: a.dx, dy: a.dy }; }
    if (digging) { digging = false; hud(); }
    // the state at the start of this turn, for the hourglass (only on this level)
    if (s.hero.hourglass && (!snaps.length || snaps[snaps.length - 1].turn !== s.turn)) {
      if (snaps.length && snaps[0].levels !== s.levels) snaps = [];
      snaps.push({ turn: s.turn, levels: s.levels, text: Game.snapshot(s) });
      if (snaps.length > Game.REWIND + 1) snaps.shift();
    }
    const ev = Game.act(s, a);
    if (ev.some(e => e.e === 'bump')) Sound.play('bump');
    Render.play(s, ev, hooks);
    if (!s.over && s.turn - savedTurn >= SAVE_EVERY) saveRun();
  }

  // ---- scroll menu: the player picks which scroll to read ---------------------

  let menuKinds = [];

  function openScrolls() {
    if (!s || s.over || screen !== 'game') return;
    const h = s.hero;
    menuKinds = Object.keys(Game.SCROLLS).filter(k => h.scrolls[k]);
    if (!menuKinds.length) { msg('You have no scrolls. Search the bookshelves!'); return; }
    $('scroll-list').innerHTML = '';
    menuKinds.forEach((k, i) => {
      const sc = Game.scrollInfo(s, k);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.innerHTML = '<kbd>' + (i + 1) + '</kbd><b>' + sc.name + (sc.turns ? ' (' + sc.turns + ' turns)' : '') +
        '</b><span class="n">×' + h.scrolls[k] + '</span><span class="info">' + sc.info + '</span>';
      b.addEventListener('click', () => readScroll(k));
      li.appendChild(b);
      $('scroll-list').appendChild(li);
    });
    $('scroll-menu').hidden = false;
    icons();
    $('scroll-list').querySelector('button').focus();
  }

  const menuOpen = () => !$('scroll-menu').hidden;
  function closeScrolls() { $('scroll-menu').hidden = true; }

  function readScroll(kind) {
    closeScrolls();
    perform({ type: 'read', scroll: kind });
  }

  // cheat: typing this word during a game takes you one level down
  const CHEAT = 'xyzzy';
  let typed = '';

  const MOVES = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
    8: [0, -1], 2: [0, 1], 4: [-1, 0], 6: [1, 0],
  };

  function toggleSound() {
    settings.sound = !settings.sound;
    Sound.on = settings.sound;
    store.set('settings', settings);
    hud();
  }

  function toggleMap() {
    settings.minimap = !settings.minimap;
    store.set('settings', settings);
    $('minimap').hidden = !settings.minimap;
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (screen === 'title') {
      const saved = !$('continue').hidden;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); if (saved) continueGame(); else show('choose'); }
      else if (k === 'n') { e.preventDefault(); show('choose'); }
      return;
    }
    if (screen === 'choose') {
      const n = parseInt(k, 10);
      const at = CLASS_KEYS.indexOf(settings.cls);
      if (n >= 1 && n <= CLASS_KEYS.length) choose(CLASS_KEYS[n - 1]);
      else if (k === 'ArrowLeft' || k === 'ArrowUp') choose(CLASS_KEYS[(at + CLASS_KEYS.length - 1) % CLASS_KEYS.length]);
      else if (k === 'ArrowRight' || k === 'ArrowDown') choose(CLASS_KEYS[(at + 1) % CLASS_KEYS.length]);
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); newGame(); }
      else if (k === 'Escape') show('title');
      return;
    }
    if (screen === 'over') {
      if (pendingDeath) {
        if (k === 't') { e.preventDefault(); turnHourglass(); }
        else if (k === 'Enter') { e.preventDefault(); finish(); }
        return;
      }
      const n = parseInt(k, 10);
      if (n >= 1 && n <= heirItems.length) { e.preventDefault(); pickHeir(n - 1); }
      else if (k === 'Enter') { e.preventDefault(); show('choose'); }
      else if (k === 'Escape') show('title');
      return;
    }
    if (!$('shop-menu').hidden) {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= s.shop.stock.length) { e.preventDefault(); buy(n - 1); }
      else if (k === 'Escape') { e.preventDefault(); closeShop(); }
      return;
    }
    if (!$('ask-menu').hidden) {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= askCount) { e.preventDefault(); answer(n - 1); }
      else if (k === 'Escape') { e.preventDefault(); answer(-1); }
      return;
    }
    if (!$('log-menu').hidden) {
      if (k === 'Escape' || k === 'p') { e.preventDefault(); closeLog(); }
      return; // arrows and Page Up/Down scroll the list
    }
    if (menuOpen()) {
      const n = parseInt(k, 10);
      if (n >= 1 && n <= menuKinds.length) { e.preventDefault(); readScroll(menuKinds[n - 1]); }
      else if (k === 'Escape' || k === 'r') { e.preventDefault(); closeScrolls(); }
      return; // Enter and Space activate the focused button
    }
    if (k.length === 1) {
      typed = (typed + k).slice(-CHEAT.length);
      if (typed === CHEAT) { typed = ''; perform({ type: 'cheat' }); return; }
    }
    if (k === 'm') { toggleSound(); return; }
    if (k === 'Tab') { e.preventDefault(); toggleMap(); return; }
    let a = null;
    if (MOVES[k]) a = { type: 'move', dx: MOVES[k][0], dy: MOVES[k][1] };
    else if (k === ' ' || k === '.' || k === '5') a = { type: 'wait' };
    else if (k === 'Enter' || k === '>' || k === '<') a = { type: 'descend' };
    else if (k === 'q') a = { type: 'quaff' };
    else if (k === 'r') { e.preventDefault(); openScrolls(); return; }
    else if (k === 'p') { e.preventDefault(); openLog(); return; }
    else if (k === 't') { e.preventDefault(); turnHourglass(); return; }
    else if (k === 'g') { e.preventDefault(); startDig(); return; }
    else if (digging && k === 'Escape') { digging = false; msg('You put the pickaxe away.'); hud(); return; }
    if (a) { e.preventDefault(); perform(a); }
  });

  // touch and mouse: tap around the hero to move, on the hero to wait or descend
  $('view').addEventListener('pointerdown', (e) => {
    if (screen !== 'game' || !s) return;
    Sound.unlock();
    const dx = e.clientX - window.innerWidth / 2, dy = e.clientY - window.innerHeight / 2;
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.05;
    if (Math.hypot(dx, dy) < r) {
      const v = Game.tile(s, s.hero.x, s.hero.y);
      perform(v === Dungeon.T.DOWN || (v === Dungeon.T.UP && s.ascending) ? { type: 'descend' } : { type: 'wait' });
    } else if (Math.abs(dx) > Math.abs(dy)) perform({ type: 'move', dx: Math.sign(dx), dy: 0 });
    else perform({ type: 'move', dx: 0, dy: Math.sign(dy) });
  });

  $('start').addEventListener('click', () => show('choose'));
  $('continue').addEventListener('click', continueGame);
  // the page may be closed at any moment
  window.addEventListener('pagehide', saveRun);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveRun(); });
  $('begin').addEventListener('click', newGame);
  $('back').addEventListener('click', () => show('title'));
  $('classes').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) choose(b.dataset.cls);
  });
  $('again').addEventListener('click', () => show('choose'));
  $('to-title').addEventListener('click', () => show('title'));
  $('use-potion').addEventListener('click', () => perform({ type: 'quaff' }));
  $('use-scroll').addEventListener('click', openScrolls);
  $('scroll-menu').addEventListener('pointerdown', (e) => { if (e.target.id === 'scroll-menu') closeScrolls(); });
  $('shop-menu').addEventListener('pointerdown', (e) => { if (e.target.id === 'shop-menu') closeShop(); });
  $('log-menu').addEventListener('pointerdown', (e) => { if (e.target.id === 'log-menu') closeLog(); });
  $('ask-menu').addEventListener('pointerdown', (e) => { if (e.target.id === 'ask-menu') answer(-1); });
  $('open-log').addEventListener('click', openLog);
  $('use-hourglass').addEventListener('click', turnHourglass);
  $('use-pick').addEventListener('click', startDig);
  $('do-rewind').addEventListener('click', turnHourglass);
  $('accept').addEventListener('click', finish);
  $('sound-btn').addEventListener('click', toggleSound);
  window.addEventListener('resize', () => { Render.resize(); icons(); if (screen === 'title') fitTitle(); });

  function loop(now) {
    if (s && (screen === 'game' || screen === 'over')) {
      if (queued && !Render.busy(now)) { const a = queued; queued = null; perform(a); }
      // a drawing error must not stop the loop, or the game would freeze
      try { Render.frame(s, now); } catch (err) { console.error(err); }
    }
    requestAnimationFrame(loop);
  }

  // read-only access for tests in the browser console
  window.roguelAIke = { state: () => s, perform };

  Sound.on = settings.sound;
  const begin = () => {
    Render.init($('view'), atlas, $('minimap'));
    show('title');
    requestAnimationFrame(loop);
  };
  if (atlas.complete) begin(); else atlas.onload = begin;
})();
