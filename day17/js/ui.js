// User interface: title screen, typewriter output, command line, art panel.
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const titleEl = $('title'), gameEl = $('game'), out = $('out'), promptEl = $('prompt');
  const typed = $('typed'), cmd = $('cmd'), artEl = $('art'), statusEl = $('status');

  // ---------------------------------------------------- typewriter output
  const queue = [];
  let cur = null, curText = '', pos = 0, typing = false;
  const CHARS_PER_FRAME = 9;

  OUT = (text, cls) => { queue.push({ text, cls }); if (!typing) { typing = true; requestAnimationFrame(step); } };

  function newLine(q) {
    cur = document.createElement('div');
    cur.className = 'line ' + (q.cls || '');
    out.insertBefore(cur, promptEl);
    curText = q.text; pos = 0;
  }
  function step() {
    let budget = CHARS_PER_FRAME;
    while (budget > 0) {
      if (!cur) { const q = queue.shift(); if (!q) { typing = false; scroll(); return; } newLine(q); }
      const n = Math.min(budget, curText.length - pos);
      cur.append(curText.substr(pos, n));
      pos += n; budget -= n;
      if (pos >= curText.length) cur = null;
    }
    scroll();
    requestAnimationFrame(step);
  }
  function flush() {
    if (cur) { cur.append(curText.substr(pos)); cur = null; }
    while (queue.length) { const q = queue.shift(); newLine(q); cur.append(curText); cur = null; }
    trim(); scroll();
  }
  function trim() { while (out.children.length > 600) out.removeChild(out.firstChild); }
  function scroll() { out.scrollTop = out.scrollHeight; }

  // ----------------------------------------------------------- music
  // One looping soundtrack. The on/off choice is remembered per browser.
  const MUSIC_KEY = 'pnta17:music', VOLUME = 0.45;
  const track = new Audio('muzic/searching.in.the.dark.mp3');
  track.loop = true; track.preload = 'auto'; track.volume = 0;
  let musicOn = true, fadeTimer = null;
  try { musicOn = localStorage.getItem(MUSIC_KEY) !== 'off'; } catch (e) { /* ignore */ }
  function fade(to, done) {
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      const v = track.volume + (to > track.volume ? 0.03 : -0.03);
      if (Math.abs(to - track.volume) <= 0.03) { track.volume = to; clearInterval(fadeTimer); if (done) done(); }
      else track.volume = Math.min(1, Math.max(0, v));
    }, 40);
  }
  function musicPlay() {
    if (!musicOn || !started) return;
    const p = track.play();
    if (p && p.catch) p.catch(() => { /* autoplay blocked: retried on the next key press */ });
    fade(VOLUME);
  }
  function musicStop() { fade(0, () => track.pause()); }
  MUSIC = (want) => {
    musicOn = want === null || want === undefined ? !musicOn : want;
    try { localStorage.setItem(MUSIC_KEY, musicOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
    if (musicOn) musicPlay(); else musicStop();
    return musicOn;
  };
  // Browsers only allow audio after a user gesture: retry on any key or tap.
  const kick = () => { if (musicOn && started && track.paused) musicPlay(); };
  document.addEventListener('keydown', kick);
  document.addEventListener('pointerdown', kick);

  // ------------------------------------------------------ night pictures
  // Outdoor art after dark: stars in the open sky, a moon, lit windows
  // ("[]" -> "##" in amber), shop signs closed. Everything is derived from
  // the day picture with a fixed hash, so stars don't jump around.
  const NIGHT_FIX = {   // same-length replacements for drawings with a sun
    pond: [['\\  |  /', '  .-.  '], ['----(_)----', '   (   )   '], ['/  |  \\', "  '-'  "]],
  };
  const MOON = [' .-. ', '(   )', " '-' "];
  const hash = (a, b, c) => {
    let h = 2166136261;
    for (const ch of a + ':' + b + ':' + c) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  function nightArt(id, lines) {
    const W = 64;
    let txt = lines.map((l) => l.padEnd(W));
    let moon = false;
    if (NIGHT_FIX[id]) {
      for (const [a, b] of NIGHT_FIX[id]) txt = txt.map((l) => l.replace(a, b));
      moon = true;
    }
    txt = txt.map((l) => l.replace(/OPEN/g, 'SHUT'));
    const g = txt.map((l) => l.split(''));
    const cls = g.map((row) => row.map(() => ''));
    // Lit windows: about two out of three (top rows only: lower rows hold cars).
    for (let r = 0; r < Math.min(7, g.length); r++) {
      for (let c = 0; c < W - 1; c++) {
        if (g[r][c] === '[' && g[r][c + 1] === ']' && hash(id, r, c) % 3) {
          g[r][c] = g[r][c + 1] = '#';
          cls[r][c] = cls[r][c + 1] = 'lit';
        }
      }
    }
    // Sky = blank cells with nothing above them.
    const sky = g.map((row) => row.map(() => false));
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < W; c++) sky[r][c] = g[r][c] === ' ' && (r === 0 || sky[r - 1][c]);
    }
    if (!moon) {
      for (let c = W - 7; c >= 1 && !moon; c--) {
        let free = true;
        for (let r = 0; r < 3 && free; r++) for (let k = -1; k <= 5; k++) if (!sky[r][c + k]) free = false;
        if (!free) continue;
        for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) { g[r][c + k] = MOON[r][k]; cls[r][c + k] = 'moon'; sky[r][c + k] = false; }
        moon = true;
      }
    }
    for (let r = 0; r < Math.min(6, g.length); r++) {
      for (let c = 0; c < W; c++) {
        if (!sky[r][c]) continue;
        const h = hash(id, r, c) % 97;
        if (h < 4) { g[r][c] = h === 0 ? '*' : '.'; cls[r][c] = h % 2 ? 'star tw' : 'star'; }
      }
    }
    return g.map((row, r) => {
      let out = '', cur = null;
      for (let c = 0; c < row.length; c++) {
        if (cls[r][c] !== cur) { if (cur) out += '</span>'; cur = cls[r][c]; if (cur) out += `<span class="${cur}">`; }
        out += esc(row[c]);
      }
      return (cur ? out + '</span>' : out).replace(/\s+$/, '');
    }).join('\n');
  }

  // ------------------------------------------------- art and status line
  RENDER = () => {
    if (!S) return;
    const raw = S.pc && S.mini ? miniArt() : ART[S.loc] || '';
    const lines = raw.replace('@@:@@', clock()).split('\n');
    while (lines.length < 11) lines.push('');
    const dark = OUTDOOR.has(S.loc) && night();
    if (dark) artEl.innerHTML = nightArt(S.loc, lines.slice(0, 11));
    else artEl.textContent = lines.slice(0, 11).join('\n');
    artEl.classList.toggle('night', dark);
    const day = DAYS[D()] ? DAYS[D()].slice(0, 3).toUpperCase() : '';
    statusEl.innerHTML = '';
    const parts = [`${day} ${clock()}`, L[S.loc].name.toUpperCase(), has('wallet') ? `CASH $${S.cash}` : 'NO WALLET',
      `LOAD ${kg(load())}/${cap()} kg`, `SCORE ${S.score}/${MAX_SCORE}`];
    for (const p of parts) { const s = document.createElement('span'); s.textContent = p; statusEl.append(s); }
    const mb = document.createElement('button');
    mb.type = 'button'; mb.className = 'musicbtn'; mb.textContent = musicOn ? 'MUSIC ON' : 'MUSIC OFF';
    mb.title = 'Turn the music on or off (or type MUSIC ON / MUSIC OFF)';
    mb.addEventListener('click', (e) => { e.stopPropagation(); MUSIC(null); RENDER(); cmd.focus(); });
    statusEl.append(mb);
  };

  // ------------------------------------------------------- full-screen map
  const mapEl = $('map'), mapPre = $('mappre');
  let lastMap = null;
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Width of one monospace character as a fraction of the font size.
  function charRatio() {
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-family:inherit';
    s.textContent = 'M'.repeat(20);
    mapPre.append(s);
    const r = s.getBoundingClientRect().width / 2000;
    s.remove();
    return r || 0.6;
  }
  function fitMap() {
    if (!lastMap || mapEl.hidden) return;
    const cols = Math.max(...lastMap.lines.map((l) => l.length), 1), rows = lastMap.lines.length;
    const box = mapPre.getBoundingClientRect();
    const fs = Math.min(box.width / (cols * charRatio()), box.height / (rows * 1.2), 24);
    mapPre.firstChild.style.fontSize = Math.max(fs, 3) + 'px';
  }
  SHOWMAP = (m) => {
    flush();
    lastMap = m;
    const html = m.lines.map((line, r) => {
      const ms = m.marks.filter((k) => k.row === r).sort((a, b) => a.start - b.start);
      let out = '', pos = 0;
      for (const k of ms) {
        out += esc(line.slice(pos, k.start)) + `<span class="${k.cls}">` + esc(line.slice(k.start, k.end)) + '</span>';
        pos = k.end;
      }
      return out + esc(line.slice(pos));
    }).join('\n');
    mapPre.innerHTML = '<div>' + html + '</div>';
    $('mapinfo').textContent = `${DAYS[D()].toUpperCase()} ${clock()} - EXPLORED ${m.count}/${m.total} - YOU: ${L[S.loc].name.toUpperCase()}`;
    const leg = $('maplegend');
    leg.innerHTML = '<span><span class="here">[You]</span> you are here</span>' +
      (m.unknown ? '<span><span class="unk">[?]</span> not explored yet</span>' : '') +
      m.people.map((p) => `<span><span class="npc">${p.letter}</span> ${esc(p.name)} (${esc(p.where)})</span>`).join('');
    mapEl.hidden = false;
    fitMap();
  };
  function closeMap() { mapEl.hidden = true; cmd.focus(); }
  window.addEventListener('resize', fitMap);
  // Capture phase: while the map is open, any key only closes it.
  document.addEventListener('keydown', (e) => {
    if (mapEl.hidden) return;
    e.preventDefault(); e.stopPropagation();
    closeMap();
  }, true);
  mapEl.addEventListener('click', closeMap);

  // ---------------------------------------------------------- input
  const history = [];
  let hIdx = 0;
  function syncTyped() { typed.textContent = cmd.value; }
  cmd.addEventListener('input', syncTyped);
  cmd.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = cmd.value.trim();
      flush();
      cmd.value = ''; syncTyped();
      if (!text) return;
      history.push(text); hIdx = history.length;
      OUT('> ' + text, 'echo');
      exec(text);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (hIdx > 0) { hIdx--; cmd.value = history[hIdx]; syncTyped(); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hIdx < history.length) { hIdx++; cmd.value = history[hIdx] || ''; syncTyped(); }
    } else if (e.key === 'Escape') {
      flush();
    }
  });
  // Keep the caret at the end: the fake cursor is always drawn there.
  cmd.addEventListener('select', () => { const n = cmd.value.length; cmd.setSelectionRange(n, n); });
  gameEl.addEventListener('mouseup', () => { if (!window.getSelection().toString()) cmd.focus(); });

  // ------------------------------------------------------- title screen
  if (hasSave()) $('loadhint').hidden = false;
  let started = false, melting = false;

  // The logo melts downwards, strip by strip, then the game starts.
  function meltLogo(done) {
    const img = titleEl.querySelector('img');
    if (!img || !img.complete || !img.naturalWidth) { done(); return; }
    const r = img.getBoundingClientRect();
    // Full-resolution copy of the logo (screen pixels), so it looks exactly
    // like the picture until it starts to melt.
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const sctx = src.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(img, 0, 0, W, H);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H * 2;   // twice as tall: room to fall
    cv.className = 'melt';
    Object.assign(cv.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: (r.height * 2) + 'px' });
    document.body.append(cv);
    img.style.visibility = 'hidden';
    titleEl.classList.add('melting');
    const ctx = cv.getContext('2d');
    // Doom-style melt in thin vertical strips: each strip waits a moment, then
    // falls faster and faster. Delays and speeds drift gently from strip to
    // strip, so the melting edge is a soft wave. Physics is in seconds and in
    // fractions of the logo height (u), so the timing is the same at any size.
    const SW = Math.max(2, Math.round(4 * dpr));   // strip width in pixels
    const N = Math.ceil(W / SW), u = H / 100;
    const wait = [], v0 = [], off = [];
    let wv = Math.random() * 0.25, sv = 0;
    for (let k = 0; k < N; k++) {
      wv = Math.max(0, Math.min(0.5, wv + (Math.random() - 0.5) * 0.06 * (200 / N)));
      sv = Math.max(-1, Math.min(1, sv + (Math.random() - 0.5) * 0.3 * (200 / N)));
      wait[k] = wv;               // seconds before the strip starts to move
      v0[k] = (6 + sv * 2) * u;   // starting speed, pixels per second
      off[k] = 0;
    }
    const GRAV = 90 * u;          // pixels per second squared
    // Colour and height of the lowest solid pixel of each strip (for drips).
    // From file:// the browser may forbid reading pixels: then drips are green.
    const bottom = [];
    let pix = null;
    try { pix = sctx.getImageData(0, 0, W, H).data; } catch (e) { /* tainted canvas */ }
    for (let k = 0; k < N; k++) {
      const x = Math.min(W - 1, k * SW + (SW >> 1));
      if (!pix) { bottom[k] = { y: Math.round(H * 0.8), c: '#39ff7a' }; continue; }
      for (let y = H - 1; y >= 0; y--) {
        const i = (y * W + x) * 4;
        if (pix[i + 3] > 120) { bottom[k] = { y, c: `rgb(${pix[i]},${pix[i + 1]},${pix[i + 2]})` }; break; }
      }
    }
    const DS = Math.max(2, Math.round(3 * dpr));   // drip size
    const drips = [];
    let t0 = null, last = null;
    function frame(now) {
      if (t0 === null) { t0 = last = now; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, cv.height);
      let alive = false;
      for (let k = 0; k < N; k++) {
        const tt = t - wait[k];
        off[k] = tt <= 0 ? 0 : v0[k] * tt + 0.5 * GRAV * tt * tt;
        if (off[k] >= H * 2) continue;
        alive = true;
        const x = k * SW, w = Math.min(SW, W - x);
        // Fade a little as the strip falls.
        ctx.globalAlpha = Math.max(0, 1 - off[k] / (H * 2.2));
        ctx.drawImage(src, x, 0, w, H, x, off[k], w, H);
        // Now and then a drop falls off the bottom of a moving strip.
        if (tt > 0 && bottom[k] && Math.random() < 0.6 * dt) {
          drips.push({ x: x + Math.random() * (w - 1), y: off[k] + bottom[k].y + 1, v: v0[k] + GRAV * tt + 4 * u, c: bottom[k].c });
        }
      }
      for (const d of drips) {
        d.v += GRAV * 1.4 * dt; d.y += d.v * dt;
        if (d.y >= H * 2) continue;
        alive = true;
        ctx.globalAlpha = Math.max(0, 1 - d.y / (H * 2.1));
        ctx.fillStyle = d.c;
        ctx.beginPath(); ctx.arc(d.x, d.y, DS / 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (alive && t < 6 && !finished) requestAnimationFrame(frame);
      else finish();
    }
    // Safety net: if animation frames never arrive, start the game anyway.
    let finished = false;
    function finish() { if (finished) return; finished = true; cv.remove(); done(); }
    setTimeout(finish, 7000);
    requestAnimationFrame(frame);
  }

  function start(load) {
    if (started || melting) return;
    melting = true;
    meltLogo(() => begin(load));
  }
  function begin(load) {
    if (started) return;
    started = true;
    titleEl.hidden = true; gameEl.hidden = false;
    S = newState();
    if (!(load && loadGame())) newGame();
    RENDER();
    musicPlay();
    cmd.focus();
  }
  document.addEventListener('keydown', (e) => {
    if (started || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    start(e.key === 'l' || e.key === 'L');
  });
  titleEl.addEventListener('click', () => start(false));
})();
