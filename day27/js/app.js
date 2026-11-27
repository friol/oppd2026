// Page logic: picks a style and a seed, sizes the print, runs the animation
// loop, auto-advances, keeps a history, favourites and the gallery, the
// full-screen mode and the controls.
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('art'), ctx = canvas.getContext('2d');
  const print = $('print'), stage = $('stage'), label = $('label');
  const AUTO_SECONDS = 30, FADE_MS = 320, IDLE_MS = 2500, THUMB_T = 12;
  // Space reserved for the label: width beside the print, height below it.
  const SIDE_LABEL = 230, SIDE_GAP = 32, BELOW_LABEL = 78;
  const FAV_KEY = 'day27.favs';

  const S = {
    history: [], idx: -1, style: null, seed: 0, piece: null, t: 0,
    paused: false, fading: false, w: 0, h: 0, dpr: 1,
    kiosk: false, gallery: false,
    auto: localStorage.getItem('day27.auto') !== '0',
    filter: localStorage.getItem('day27.filter') || 'all',
  };
  if (S.filter !== 'all' && !STYLES.some(s => s.id === S.filter)) S.filter = 'all';

  const styleOf = id => STYLES.find(s => s.id === id);
  // An entry is { style, seed, pal? }: pal, when present, is the seed of the
  // palette choice only (see U.rng), used by the colour remix.
  const makePiece = entry => {
    const st = styleOf(entry.style) || STYLES[0];
    return { st, piece: st.make(U.rng(entry.seed, entry.pal), U.noise(entry.seed * 7 + 13)) };
  };
  const palIndex = (st, entry) => Math.floor(U.rng(entry.pal != null ? entry.pal : entry.seed)() * st.palettes.length);
  const randomSeed = () => 1 + Math.floor(Math.random() * 99999);
  const entryName = (st, e) => st.name + ', No. ' + e.seed + (e.pal != null ? '·' + e.pal : '');

  // --- pieces -------------------------------------------------------------
  function newEntry() {
    let st;
    if (S.filter !== 'all') st = styleOf(S.filter);
    else {
      const others = STYLES.filter(s => s !== S.style);
      st = others[Math.floor(Math.random() * others.length)];
    }
    return { style: st.id, seed: randomSeed() };
  }

  function create(entry) {
    const { st, piece } = makePiece(entry);
    S.style = st;
    S.seed = entry.seed;
    S.entry = entry;
    S.piece = piece;
    S.t = 0;
    const no = STYLES.indexOf(st) + 1;
    label.innerHTML = '<b>' + entryName(st, entry) + '</b>' +
      '<span>' + st.medium + '</span>' +
      '<span class="meta">study ' + no + ' of ' + STYLES.length + ' · seed ' + entry.seed +
      (entry.pal != null ? ' · colour remix ' + entry.pal : '') + ' · piece ' + (S.idx + 1) + ' of this visit</span>';
    try { history.replaceState(null, '', '#' + st.id + '/' + entry.seed + (entry.pal != null ? '/' + entry.pal : '')); } catch (e) { }
    renderChips(); // before layout: the menu takes room from the stage on phones
    showFav();
    layout();
  }

  function show(entry) {
    if (S.fading) return;
    if (!S.piece) { create(entry); return; }
    S.fading = true;
    print.classList.add('fade');
    setTimeout(() => {
      create(entry);
      print.classList.remove('fade');
      S.fading = false;
    }, FADE_MS);
  }

  function next() {
    if (S.idx < S.history.length - 1) { S.idx++; show(S.history[S.idx]); return; }
    fresh();
  }
  function fresh(entry) {
    S.history.push(entry || newEntry());
    S.idx = S.history.length - 1;
    show(S.history[S.idx]);
  }
  function prev() {
    if (S.idx <= 0) return;
    S.idx--;
    show(S.history[S.idx]);
  }

  // --- layout -------------------------------------------------------------
  function layout() {
    if (!S.style) return;
    const a = S.style.aspect;
    const fit = (aw, ah) => {
      let w = Math.max(120, aw), h = w / a;
      if (h > ah) { h = Math.max(120, ah); w = h * a; }
      return [Math.floor(w), Math.floor(h)];
    };
    const sw = stage.clientWidth - 24, sh = stage.clientHeight - 24;
    let w, h, useBelow = false;
    if (S.kiosk) [w, h] = fit(sw, sh);
    else {
      // The label goes to the right of the print; it moves below only when
      // that gives a clearly bigger print (narrow or portrait screens).
      const side = fit(sw - SIDE_LABEL - SIDE_GAP, sh);
      const below = fit(sw, sh - BELOW_LABEL);
      useBelow = below[0] * below[1] > side[0] * side[1] * 1.15;
      [w, h] = useBelow ? below : side;
    }
    stage.classList.toggle('below', useBelow);
    S.w = w; S.h = h;
    S.dpr = Math.min(2, window.devicePixelRatio || 1);
    print.style.width = w + 'px';
    print.style.height = h + 'px';
    canvas.width = Math.round(w * S.dpr);
    canvas.height = Math.round(h * S.dpr);
    label.style.width = useBelow ? Math.max(w, 260) + 'px' : SIDE_LABEL + 'px';
  }

  // --- drawing ------------------------------------------------------------
  // Paper, margins, then the piece itself (also used for gallery thumbnails).
  function paint(c, piece, w, h, t) {
    c.fillStyle = piece.paper;
    c.fillRect(0, 0, w, h);
    const m = Math.round(Math.min(w, h) * 0.06);
    c.save();
    c.translate(m, m);
    piece.draw(c, w - 2 * m, h - 2 * m, t);
    c.restore();
  }

  function draw() {
    if (!S.piece) return;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    paint(ctx, S.piece, S.w, S.h, S.t);
  }

  let last = performance.now();
  function frame(now) {
    // Schedule first: an error in one piece must not stop the whole page.
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!S.paused && !S.fading && !S.gallery) {
      S.t += dt;
      if (S.auto && S.t > AUTO_SECONDS) next();
    }
    try { draw(); } catch (e) { console.error(e); }
    $('timer').style.width = S.auto ? Math.min(100, (S.t / AUTO_SECONDS) * 100) + '%' : '0';
  }

  // --- controls -----------------------------------------------------------
  function setPaused(p) {
    S.paused = p;
    $('play').textContent = p ? 'Play' : 'Pause';
    $('play').classList.toggle('on', p);
  }
  function setAuto(a) {
    S.auto = a;
    localStorage.setItem('day27.auto', a ? '1' : '0');
    $('auto').classList.toggle('on', a);
  }
  function setFilter(id) {
    S.filter = id;
    localStorage.setItem('day27.filter', id);
    fresh();
  }
  const fileName = ext => 'day27-' + S.style.id + '-' + S.seed + (S.entry.pal != null ? '-' + S.entry.pal : '') + '.' + ext;
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function save() { canvas.toBlob(b => download(b, fileName('png'))); }
  // Vectors of the piece as it is now (pieces that evolve by chance, like
  // Raster Weather or Growing Maze, are regrown, so details may differ).
  const svgNow = () => SVGX.render(() => makePiece(S.entry).piece, paint, S.w, S.h, S.t);
  function saveSvg() { download(new Blob([svgNow()], { type: 'image/svg+xml' }), fileName('svg')); }

  // --- remix --------------------------------------------------------------
  // Same composition, other colours: a new palette seed that picks a
  // different palette of the same study.
  function remixColours() {
    const st = S.style, e = S.entry;
    if (st.palettes.length < 2) return;
    const now = palIndex(st, e);
    let pal;
    for (let i = 0; i < 50; i++) { pal = randomSeed(); if (palIndex(st, { seed: e.seed, pal }) !== now) break; }
    fresh({ style: st.id, seed: e.seed, pal });
  }
  // Same colours, another composition: new seed, palette seed kept.
  function remixShape() {
    const e = S.entry;
    let seed = randomSeed();
    if (seed === e.seed) seed++;
    fresh({ style: e.style, seed, pal: e.pal != null ? e.pal : e.seed });
  }

  function renderChips() {
    const box = $('styles');
    if (!box.childElementCount) {
      // Every study shows its number; only 0-9 are also keyboard shortcuts.
      const add = (id, text, no) => {
        const b = document.createElement('button');
        b.dataset.id = id;
        b.title = no <= 9 ? text + ' (' + no + ')' : text;
        b.innerHTML = '<i>' + no + '</i>' + text;
        b.onclick = () => setFilter(id);
        box.appendChild(b);
      };
      add('all', 'All studies', 0);
      STYLES.forEach((s, i) => add(s.id, s.name, i + 1));
    }
    for (const b of box.children) b.classList.toggle('on', b.dataset.id === S.filter);
  }

  // --- full screen ----------------------------------------------------------
  // Only the print on the wall; the cursor hides after a moment of stillness.
  let idleTimer = 0;
  function poke() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    if (S.kiosk) idleTimer = setTimeout(() => document.body.classList.add('idle'), IDLE_MS);
  }
  function setKiosk(on) {
    if (on === S.kiosk) return;
    S.kiosk = on;
    document.body.classList.toggle('kiosk', on);
    if (on) {
      const el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => { });
      const hint = $('hint');
      hint.classList.add('show');
      setTimeout(() => hint.classList.remove('show'), 2200);
    } else if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    poke();
    layout();
  }
  // Leaving browser full screen (Esc, F11) also leaves the kiosk view.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setKiosk(false);
    layout();
  });
  document.addEventListener('mousemove', poke);
  print.addEventListener('dblclick', () => setKiosk(!S.kiosk));

  // --- favourites and gallery ---------------------------------------------
  const loadFavs = () => { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; } };
  const saveFavs = favs => localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  const palOf = e => (e.pal != null ? e.pal : null);
  const sameAs = (f, e) => f.style === e.style && f.seed === e.seed && palOf(f) === palOf(e);
  const isFav = () => S.entry && loadFavs().some(f => sameAs(f, S.entry));

  function showFav() {
    const on = isFav();
    $('fav').classList.toggle('on', !!on);
    $('fav').textContent = on ? '♥ Kept' : '♡ Keep';
    $('gallery-btn').textContent = 'Gallery ' + loadFavs().length;
  }
  function toggleFav() {
    let favs = loadFavs();
    if (isFav()) favs = favs.filter(f => !sameAs(f, S.entry));
    else favs.unshift({ ...S.entry });
    saveFavs(favs);
    showFav();
  }

  function renderGallery() {
    const grid = $('ggrid'), favs = loadFavs().filter(f => styleOf(f.style));
    grid.innerHTML = '';
    $('gempty').hidden = favs.length > 0;
    showFav();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const f of favs) {
      const { st, piece } = makePiece(f);
      const card = document.createElement('div');
      card.className = 'card';
      const max = 190, w = st.aspect >= 1 ? max : Math.round(max * st.aspect), h = st.aspect >= 1 ? Math.round(max / st.aspect) : max;
      const cv = document.createElement('canvas');
      cv.width = w * dpr; cv.height = h * dpr;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(c, piece, w, h, THUMB_T);
      const frameBox = document.createElement('button');
      frameBox.className = 'thumb';
      frameBox.title = 'Show ' + entryName(st, f);
      frameBox.appendChild(cv);
      frameBox.onclick = () => { setGallery(false); fresh({ ...f }); };
      const cap = document.createElement('div');
      cap.className = 'cap';
      cap.innerHTML = '<span>' + entryName(st, f) + '</span>';
      const del = document.createElement('button');
      del.className = 'del';
      del.title = 'Remove from the gallery';
      del.textContent = '✕';
      del.onclick = () => { saveFavs(loadFavs().filter(x => !sameAs(x, f))); renderGallery(); showFav(); };
      cap.appendChild(del);
      card.append(frameBox, cap);
      grid.appendChild(card);
    }
  }
  function setGallery(on) {
    S.gallery = on;
    $('gallery').hidden = !on;
    if (on) renderGallery();
  }
  $('gallery').addEventListener('click', e => { if (e.target === $('gallery')) setGallery(false); });
  $('gclose').onclick = () => setGallery(false);

  // --- buttons and keys -----------------------------------------------------
  $('next').onclick = next;
  $('prev').onclick = prev;
  $('play').onclick = () => setPaused(!S.paused);
  $('auto').onclick = () => setAuto(!S.auto);
  $('save').onclick = save;
  $('svg').onclick = saveSvg;
  $('remix-c').onclick = remixColours;
  $('remix-s').onclick = remixShape;
  $('fav').onclick = toggleFav;
  $('gallery-btn').onclick = () => setGallery(true);
  $('full').onclick = () => setKiosk(true);
  const showMusic = () => $('music').classList.toggle('on', MUSIC.enabled);
  $('music').onclick = () => { MUSIC.toggle(); showMusic(); };
  showMusic();

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (S.gallery) { if (k === 'Escape' || k === 'g') setGallery(false); return; }
    if (k === ' ') { setPaused(!S.paused); e.preventDefault(); }
    else if (k === 'Escape') setKiosk(false);
    else if (k === 'ArrowRight' || k === 'n') next();
    else if (k === 'ArrowLeft' || k === 'p') prev();
    else if (k === 'a') setAuto(!S.auto);
    else if (k === 's') save();
    else if (k === 'v') saveSvg();
    else if (k === 'c') remixColours();
    else if (k === 'r') remixShape();
    else if (k === 'm') { MUSIC.toggle(); showMusic(); }
    else if (k === 'f') setKiosk(!S.kiosk);
    else if (k === 'k') toggleFav();
    else if (k === 'g') setGallery(true);
    else if (k === '0') setFilter('all');
    else if (/^[1-9]$/.test(k) && +k <= STYLES.length) setFilter(STYLES[+k - 1].id);
  });

  window.addEventListener('resize', layout);

  // --- start --------------------------------------------------------------
  setAuto(S.auto);
  const m = /^#(\w+)\/(\d+)(?:\/(\d+))?$/.exec(location.hash);
  const first = m && styleOf(m[1]) ? { style: m[1], seed: +m[2], ...(m[3] ? { pal: +m[3] } : {}) } : newEntry();
  S.history.push(first);
  S.idx = 0;
  create(first);
  requestAnimationFrame(frame);

  // Hooks for tests.
  window.APP = { S, next, prev, show: (style, seed, pal) => create({ style, seed, pal }), setPaused, setKiosk, setGallery, toggleFav, remixColours, remixShape, svg: svgNow };
})();
