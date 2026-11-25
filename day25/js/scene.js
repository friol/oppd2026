'use strict';
// Saloon background (adapted from day24): silhouetted patrons who react to the
// game, a pianist, a cat that walks along the bar, swinging batwing doors and
// wanted posters. Everything lives
// in the side margins around the table (it is hidden on narrow screens).

const SCENE = (function () {
  const BAR = 0.63;                         // bar top as a fraction of the viewport height (CSS --bar)
  const PH = () => Math.max(90, Math.min(150, innerHeight * 0.19));   // base patron height (CSS --ph)
  const ALL = ['cheer', 'laugh', 'boo', 'gasp', 'hush', 'up'];

  const WORDS = {
    cheer: ['Yeehaw!', 'Bravo!', 'Atta boy!', 'Woo-hoo!', 'Hooray!', 'Nice one!'],
    laugh: ['Ha ha!', 'Hee hee!', 'Haw haw!', 'Oh boy!', 'Ha!', 'Poor fella!'],
    boo: ['Boo!', 'Booo!', 'Shame!', 'Bah!', 'Terrible!', 'Boo-hoo!'],
    gasp: ['Ooh!', 'Whoa!', 'Oh!', 'Well now…', 'Hmm?'],
    hush: ['Oh no…', 'Ouch.', 'Poor soul.', 'Tough luck.']
  };

  // Patron look: hat type, size, which side it faces, and where it stands.
  const LEFT = [['cowboy', 1], ['bowler', 0.94], ['feather', 1.04], ['tophat', 0.97]];
  const RIGHT = [['tophat', 1.02], ['bare', 0.93], ['cowboy', 1.05], ['bowler', 0.96]];

  const HATS = {
    cowboy: '<ellipse cx="32" cy="34" rx="27" ry="5"/><path d="M19 34 C19 18 26 14 32 17 C38 14 45 18 45 34 Z"/>',
    bowler: '<ellipse cx="32" cy="35" rx="20" ry="4"/><path d="M20 35 C20 17 44 17 44 35 Z"/>',
    bare: '<path d="M18 46 C16 24 48 24 46 46 C42 36 22 36 18 46 Z"/>',
    tophat: '<ellipse cx="32" cy="35" rx="20" ry="4"/><rect x="21" y="8" width="22" height="27" rx="2"/>',
    feather: '<ellipse cx="32" cy="34" rx="25" ry="6"/><path d="M20 34 C22 22 42 22 44 34 Z"/>' +
      '<path d="M40 28 C58 8 63 24 52 37 C55 25 48 20 40 28 Z"/>'
  };

  function patronSVG(type) {
    return '<svg viewBox="0 0 64 120" aria-hidden="true">' +
      // Raised arm with a mug of beer (shown when cheering or sipping).
      '<g class="arm"><path d="M48 86 C58 78 60 64 58 54 L51 55 C53 64 51 73 42 81 Z"/>' +
      '<circle cx="55" cy="52" r="5"/>' +
      '<rect class="mug" x="51" y="34" width="11" height="15" rx="2"/>' +
      '<rect class="foam" x="51" y="32" width="11" height="5" rx="2.5"/>' +
      '<path class="handle" d="M62 38 C67 38 67 46 62 46" fill="none" stroke-width="2"/></g>' +
      '<path d="M2 120 C2 92 12 80 26 76 L38 76 C52 80 62 92 62 120 Z"/>' +
      '<rect x="27" y="62" width="10" height="16"/>' +
      '<ellipse cx="32" cy="48" rx="13" ry="15"/>' + HATS[type] + '</svg>';
  }

  const CAT_SVG =
    '<svg viewBox="0 -3 62 37" aria-hidden="true">' +
    '<path class="tail" d="M10 14 C0 14 -2 4 5 -1" fill="none" stroke-width="4" stroke-linecap="round"/>' +
    '<rect class="leg l1" x="13" y="21" width="4" height="11" rx="2"/>' +
    '<rect class="leg l2" x="19" y="21" width="4" height="11" rx="2"/>' +
    '<rect class="leg l3" x="33" y="21" width="4" height="11" rx="2"/>' +
    '<rect class="leg l4" x="39" y="21" width="4" height="11" rx="2"/>' +
    '<rect x="10" y="9" width="32" height="14" rx="7"/>' +
    '<circle cx="46" cy="11" r="7"/>' +
    '<path d="M41 6 L42 -2 L47 4 Z M47 4 L52 -2 L52 7 Z"/>' +
    '<circle class="eye" cx="47.5" cy="10" r="1.2"/><circle class="eye" cx="51.5" cy="10" r="1.2"/>' +
    '</svg>';

  // Pianist in profile (left) at an upright piano (right); the arm and head
  // move while he plays.
  const PIANIST_SVG =
    '<svg viewBox="0 0 140 110" aria-hidden="true">' +
    '<g class="pbody"><path d="M8 110 C8 82 20 66 34 62 L50 64 C54 74 54 92 54 110 Z"/>' +
    '<g class="phead"><circle cx="40" cy="48" r="11"/><ellipse cx="40" cy="39" rx="16" ry="3.5"/>' +
    '<path d="M28 39 C28 23 52 23 52 39 Z"/></g></g>' +
    '<rect x="60" y="30" width="80" height="9" rx="2"/><rect x="64" y="38" width="72" height="72" rx="3"/>' +
    '<rect x="68" y="44" width="30" height="20" rx="1" fill="#e8dcc0" fill-opacity=".35" stroke="none"/>' +
    '<rect x="64" y="72" width="44" height="5" rx="1"/>' +
    '<rect x="64" y="66" width="44" height="7" fill="#0d0805" stroke="none"/>' +
    '<rect class="key k0" x="66.0" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k1" x="70.8" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k2" x="75.6" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k3" x="80.4" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k4" x="85.2" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k5" x="90.0" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k6" x="94.8" y="68" width="4" height="5" stroke="none"/>' +
    '<rect class="key k7" x="99.6" y="68" width="4" height="5" stroke="none"/>' +
    // Two arms, out of phase: each swings from the shoulder and presses the keys with its fingers.
    '<g class="parm a1"><path d="M46 70 L70 67 L72 73 L48 79 Z"/>' +
    '<g class="hand"><path d="M70 65 L84 66 L84 72 L70 73 Z"/>' +
    '<rect class="fng f1" x="78" y="69" width="3" height="5" rx="1.2"/>' +
    '<rect class="fng f2" x="81.5" y="69" width="3" height="5" rx="1.2"/>' +
    '<rect class="fng f3" x="85" y="69" width="3" height="5" rx="1.2"/></g></g>' +
    '<g class="parm a2"><path d="M46 72 L74 68 L76 74 L48 81 Z"/>' +
    '<g class="hand"><path d="M74 66 L90 67 L90 73 L74 74 Z"/>' +
    '<rect class="fng f1" x="87" y="70" width="3" height="5" rx="1.2"/>' +
    '<rect class="fng f2" x="90.5" y="70" width="3" height="5" rx="1.2"/></g></g></svg>';

  let root, tableEl, doorsEl, catEl, catBox, pianoEl, postersEl;
  let posterEls = { left: [], right: [] };
  const hooks = {};                         // hooks.cat(): called when the cat is clicked
  const patrons = [];
  let margins = { left: 0, right: 0 };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // ---------- Build ----------

  function build() {
    root = document.createElement('div');
    root.className = 'scene';
    root.setAttribute('aria-hidden', 'true');

    // Wanted posters pinned to the back wall.
    postersEl = document.createElement('div');
    postersEl.className = 'posters';
    root.appendChild(postersEl);

    // Back wall doors first, so patrons stand in front of them.
    doorsEl = document.createElement('div');
    doorsEl.className = 'doors';
    doorsEl.innerHTML = '<i class="glow"></i><i class="leaf l"></i><i class="leaf r"></i><i class="post"></i>';
    root.appendChild(doorsEl);

    pianoEl = document.createElement('div');
    pianoEl.className = 'pianist';
    pianoEl.innerHTML = PIANIST_SVG;
    root.appendChild(pianoEl);

    [['left', LEFT], ['right', RIGHT]].forEach(([side, list]) => {
      list.forEach(([type, sc], i) => {
        const el = document.createElement('div');
        el.className = 'patron ' + side;
        el.style.setProperty('--sc', sc);
        el.style.setProperty('--d', (-rnd(0, 5)).toFixed(2) + 's');
        el.innerHTML = '<div class="body' + (Math.random() < 0.5 ? ' flip' : '') + '">' + patronSVG(type) + '</div><span class="say"></span>';
        root.appendChild(el);
        patrons.push({ el, side, sc, timer: 0, say: el.querySelector('.say'), sayTimer: 0 });
      });
    });

    const counter = document.createElement('div');
    counter.className = 'counter';
    root.appendChild(counter);

    catEl = document.createElement('div');
    catEl.className = 'cat';
    catEl.hidden = true;
    catEl.innerHTML = '<div class="catbox">' + CAT_SVG + '</div>';
    catBox = catEl.firstChild;
    catEl.addEventListener('click', () => pet(catEl, catBox));
    root.appendChild(catEl);

    document.body.insertBefore(root, document.body.firstChild);
  }

  // Petting a cat (the one on the bar, or the one on the felt): it hops and
  // meows, a heart floats up, and hooks.cat() counts it.
  function pet(el, box) {
    SOUND.meow();
    if (hooks.cat) hooks.cat();
    box.classList.remove('hop');
    void box.offsetWidth;
    box.classList.add('hop');
    const h = document.createElement('i');
    h.className = 'pet';
    h.textContent = '♥';
    el.appendChild(h);
    setTimeout(() => h.remove(), 1200);
  }

  // Show as many patrons as fit in the margins left and right of the table.
  function layout() {
    const r = tableEl.getBoundingClientRect();
    margins = { left: r.left, right: innerWidth - r.right };
    const ph = PH();
    const doorsOn = margins.right >= 120;
    doorsEl.hidden = !doorsOn;

    // The pianist takes the far left of the bar when there is room for him.
    const pianoW = ph * 0.8 * 140 / 110;
    const pianistOn = margins.left >= 230;
    pianoEl.hidden = !pianistOn;

    // Posters: as many as fit in each margin, high up on the wall.
    const pw = Math.round(ph * 0.66);
    postersEl.style.setProperty('--pw', pw + 'px');
    for (const side of ['left', 'right']) {
      posterEls[side].forEach((el, k) => {
        const x = 14 + k * (pw + 12);
        const fits = x + pw <= margins[side] - 10;
        el.hidden = !fits;
        if (fits) el.style[side] = x + 'px';
      });
    }

    for (const side of ['left', 'right']) {
      const m = margins[side];
      let x = side === 'right' ? (doorsOn ? 96 : 12) : (pianistOn ? 8 + pianoW + 6 : 12);
      for (const p of patrons.filter(q => q.side === side)) {
        const w = ph * p.sc * 64 / 120;
        const fits = x + w <= m - 8;
        p.el.hidden = !fits;
        if (fits) {
          p.el.style[side] = x.toFixed(0) + 'px';
          x += w * 0.85 + 6;
        }
      }
    }
  }

  // ---------- Reactions ----------

  function speak(p, kind) {
    p.say.textContent = pick(WORDS[kind]);
    p.say.classList.remove('show');
    void p.say.offsetWidth;
    p.say.classList.add('show');
  }

  // kind: cheer | laugh | boo | gasp | hush; power > 1 for a bigger reaction (streaks).
  // quiet: the patrons move and talk but the crowd sounds are not played
  // (used for the small reactions to single pairs).
  function react(kind, power, quiet) {
    power = power || 1;
    if (quiet) { /* no crowd sound */ }
    else if (kind === 'cheer') { SOUND.cheers(); SOUND.flourish(); play(1900); }
    else if (kind === 'laugh') SOUND.laugh();
    else if (kind === 'boo') SOUND.boo();
    else {
      SOUND.ooh(kind === 'hush');
      if (kind === 'hush') { SOUND.sadPiano(); play(2300); }
    }

    const vis = patrons.filter(p => !p.el.hidden).sort(() => Math.random() - 0.5);
    vis.forEach((p, i) => {
      clearTimeout(p.timer);
      p.timer = setTimeout(() => {
        p.el.classList.remove(...ALL);
        void p.el.offsetWidth;
        p.el.classList.add(kind);
        if (kind === 'cheer') p.el.classList.add('up');
        if (i < 1 + power) speak(p, kind);
        p.timer = setTimeout(() => p.el.classList.remove(...ALL), 1700);
      }, Math.random() * (kind === 'hush' ? 120 : 400));
    });
  }

  // ---------- Pianist in time with the music ----------
  // While the soundtrack plays, the pianist follows its beat grid (js/beats.js,
  // made by tools/beats.py): the left hand hits on the beat and the right one on
  // the off-beat, the head nods and the body leans on every beat, and everything
  // is scaled by how loud the music is at that moment.
  const LAG = 0.06;                  // s: sound is heard a bit after the audio clock says so
  let synced = false, boostUntil = 0, parts = null;

  // Sharp hit right on the beat that dies away, with a small anticipation just before the next one.
  const hit = p => { const k = Math.exp(-p * 6); return p > 0.9 ? Math.max(k, (p - 0.9) * 5) : k; };
  const wrap = p => ((p % 1) + 1) % 1;

  // Index of the last beat at or before time t (-1 before the first one).
  function beatAt(t) {
    let lo = 0, hi = STOMP_BEATS.length - 1, r = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (STOMP_BEATS[mid] <= t) { r = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return r;
  }

  function clearPiano() {
    if (!parts) return;
    for (const el of [parts.body, parts.head, parts.a1, parts.a2, ...parts.f1, ...parts.f2, ...parts.keys]) {
      el.style.transform = '';
      el.style.fillOpacity = '';
    }
  }

  function updatePiano() {
    if (pianoEl.hidden) return;
    const on = typeof STOMP_BEATS !== 'undefined' && typeof MUSIC !== 'undefined' && MUSIC.enabled && !MUSIC.audio.paused;
    if (!on) {
      if (synced) { synced = false; clearPiano(); }
      return;
    }
    if (!parts) {
      const q = sel => [...pianoEl.querySelectorAll(sel)];
      parts = {
        body: pianoEl.querySelector('.pbody'), head: pianoEl.querySelector('.phead'),
        a1: pianoEl.querySelector('.a1'), a2: pianoEl.querySelector('.a2'),
        f1: q('.a1 .fng'), f2: q('.a2 .fng'), keys: q('.key')
      };
    }
    if (!synced) { synced = true; pianoEl.classList.remove('playing'); }

    const t = MUSIC.audio.currentTime - LAG;
    const i = beatAt(t);
    const n = STOMP_BEATS.length;
    let p = 0.5, e = 0.3;                                   // before the first beat: barely moving
    if (i >= 0) {
      const b0 = STOMP_BEATS[i];
      const b1 = i + 1 < n ? STOMP_BEATS[i + 1] : b0 + 0.565;
      p = Math.min(1, (t - b0) / (b1 - b0));
      const e1 = i + 1 < n ? STOMP_ENERGY[i + 1] : STOMP_ENERGY[i];
      e = STOMP_ENERGY[i] + (e1 - STOMP_ENERGY[i]) * p;
    }
    const amp = (0.45 + 0.55 * e) * (performance.now() < boostUntil ? 1.7 : 1);
    const hb = hit(p), hl = hb, hr = hit(wrap(p + 0.5));   // beat, left hand, right hand (off-beat)
    const A = 9 * amp;

    parts.body.style.transform = 'rotate(' + (2.4 * amp * hb).toFixed(2) + 'deg)';
    parts.head.style.transform = 'rotate(' + (-6.5 * amp * hb).toFixed(2) + 'deg)';
    parts.a1.style.transform = 'rotate(' + (-A + 2 * A * hl).toFixed(2) + 'deg)';
    parts.a2.style.transform = 'rotate(' + (-A + 2 * A * hr).toFixed(2) + 'deg)';
    // Fingers press one after the other; keys go down under them.
    parts.f1.forEach((el, j) => {
      const h = hit(wrap(p - 0.05 * j)) * amp;
      el.style.transform = 'translateY(' + (2.6 * h).toFixed(2) + 'px) scaleY(' + (1 - 0.2 * h).toFixed(2) + ')';
    });
    parts.f2.forEach((el, j) => {
      const h = hit(wrap(p + 0.5 - 0.05 * j)) * amp;
      el.style.transform = 'translateY(' + (2.6 * h).toFixed(2) + 'px) scaleY(' + (1 - 0.2 * h).toFixed(2) + ')';
    });
    parts.keys.forEach((el, j) => {
      const h = hit(wrap(p + (j < 4 ? 0 : 0.5) - 0.06 * (j % 4))) * Math.min(1, amp);
      el.style.transform = 'translateY(' + (1.4 * h).toFixed(2) + 'px)';
      el.style.fillOpacity = (0.85 - 0.4 * h).toFixed(2);
    });
  }

  // On wins and busts he plays harder for `ms`: a bigger swing with the music,
  // or a fast keyboard flourish when there is no music to follow.
  let playTimer = 0;
  function play(ms) {
    boostUntil = performance.now() + ms;
    if (synced) return;
    pianoEl.classList.add('playing');
    clearTimeout(playTimer);
    playTimer = setTimeout(() => pianoEl.classList.remove('playing'), ms);
  }

  // ---------- Wanted posters ----------
  // Left margin: your best scores (hooks.records() -> [{ level, score, date }]).
  // Right margin: the dealer and your wins (hooks.stats() -> { wins, games }).
  // Redrawn when a game ends.

  const HAT_BY_LEVEL = { Easy: 'bowler', Medium: 'cowboy', Hard: 'tophat', Pro: 'feather' };
  const TILTS = [-2.5, 1.8, -1.2, 2.6, -1.8];

  function poster(html, i) {
    const el = document.createElement('div');
    el.className = 'poster';
    el.style.setProperty('--rot', TILTS[i % TILTS.length] + 'deg');
    el.innerHTML = '<i class="pin"></i>' + html;
    postersEl.appendChild(el);
    return el;
  }

  function refreshPosters() {
    if (!postersEl) return;
    postersEl.innerHTML = '';
    const recs = hooks.records ? hooks.records() : [];
    const stats = hooks.stats ? hooks.stats() : { wins: 0, games: 0 };
    const left = recs.length
      ? recs.slice(0, 3).map((r, i) => poster(
        '<b class="ph">WANTED</b><div class="pface">' + patronSVG(HAT_BY_LEVEL[r.level] || 'bowler') + '</div>' +
        '<span class="pamt">' + r.score + '</span><small>#' + (i + 1) + ' · ' + r.level + '</small><small>' + r.date + '</small>', i))
      : [poster('<b class="ph">WANTED</b><div class="pq">YOU</div><span class="pamt">???</span><small>Clear a table</small><small>to get on the wall</small>', 0)];
    const lou = poster('<b class="ph">WANTED</b><div class="pface lou">' +
      (typeof DEALER !== 'undefined' ? DEALER.FACE_SVG : '') + '</div><span class="pamt">Lucky Lou</span><small>for marking the cards</small>', 3);
    const medals = hooks.medals ? hooks.medals() : { got: 0, total: 0 };
    const wins = poster('<b class="ph">HALL OF FAME</b><div class="pq">★</div><span class="pamt">' +
      medals.got + '/' + medals.total + '</span><small>medals earned</small><small>' + stats.wins + '/' + stats.games + ' tables cleared</small>', 4);
    posterEls = { left, right: [lou, wins] };
    if (tableEl) layout();
  }

  // A random patron takes a sip of beer.
  function sip() {
    const vis = patrons.filter(p => !p.el.hidden && !ALL.some(c => p.el.classList.contains(c)));
    if (!vis.length) return;
    const p = pick(vis);
    p.el.classList.add('up');
    setTimeout(() => { if (!ALL.slice(0, 4).some(c => p.el.classList.contains(c))) p.el.classList.remove('up'); }, 1500);
  }

  // ---------- Doors ----------

  function swing() {
    if (doorsEl.hidden) return;
    doorsEl.classList.remove('swing');
    void doorsEl.offsetWidth;
    doorsEl.classList.add('swing');
    SOUND.creak();
  }

  // ---------- Cat ----------

  const cat = { on: false, x: 0, dir: 1, state: 'walk', stopAt: null, sitUntil: 0, entered: false, meowAt: 0 };
  const CAT_W = 62;

  function startCat() {
    const W = innerWidth;
    if (cat.on || (margins.left < 90 && margins.right < 90)) return;
    cat.dir = Math.random() < 0.5 ? 1 : -1;
    cat.x = cat.dir > 0 ? -CAT_W - 10 : W + 10;
    // Sometimes it stops for a moment in the first margin it reaches.
    const m = cat.dir > 0 ? margins.left : margins.right;
    cat.stopAt = null;
    if (m > CAT_W + 30 && Math.random() < 0.7) {
      const off = rnd(10, m - CAT_W - 10);
      cat.stopAt = cat.dir > 0 ? off : W - off - CAT_W;
    }
    cat.state = 'walk';
    cat.entered = false;
    cat.meowAt = 0;
    cat.on = true;
    catEl.hidden = false;
    catEl.classList.remove('sit');
    catBox.style.transform = cat.dir < 0 ? 'scaleX(-1)' : '';
  }

  // Meow, but never within 2 s of the previous one (the sample would be cut).
  function catMeow(now) {
    if (now - (cat.lastMeow || -1e9) < 2000) return false;
    cat.lastMeow = now;
    SOUND.meow();
    return true;
  }

  let last = 0;
  function loop(now) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    updatePiano();
    if (cat.on) {
      if (cat.state === 'walk') {
        cat.x += cat.dir * 95 * dt;
        if (cat.stopAt !== null && (cat.dir > 0 ? cat.x >= cat.stopAt : cat.x <= cat.stopAt)) {
          cat.state = 'sit';
          cat.sitUntil = now + 2600;
          cat.stopAt = null;
          catEl.classList.add('sit');
          catMeow(now);
        }
        if (cat.x > innerWidth + 20 || cat.x < -CAT_W - 20) {
          cat.on = false;
          catEl.hidden = true;
          schedule();
        }
      } else if (now > cat.sitUntil) {
        cat.state = 'walk';
        catEl.classList.remove('sit');
      }
      catEl.style.transform = 'translateX(' + cat.x.toFixed(1) + 'px)';

      // Meows: one as soon as the cat shows up, then now and then while it is
      // in sight (not while it is behind the table).
      const cx = cat.x + CAT_W / 2;
      const inSight = cx > 0 && cx < innerWidth && (cx < margins.left || cx > innerWidth - margins.right);
      if (inSight && !cat.entered) {
        cat.entered = true;
        cat.meowAt = now + 250;
      }
      if (inSight && cat.entered && now > cat.meowAt) {
        catMeow(now);
        cat.meowAt = now + rnd(3500, 7000);
      }
    }
    requestAnimationFrame(loop);
  }

  let catTimer = 0;
  function schedule() {
    clearTimeout(catTimer);
    catTimer = setTimeout(() => { startCat(); if (!cat.on) schedule(); }, rnd(22000, 50000));
  }

  // ---------- Init ----------

  function init(table) {
    tableEl = table;
    build();
    refreshPosters();
    layout();
    window.addEventListener('resize', layout);
    requestAnimationFrame(loop);
    setInterval(sip, 6500);
    (function doorsLater() { setTimeout(() => { swing(); doorsLater(); }, rnd(28000, 65000)); })();
    catTimer = setTimeout(() => { startCat(); if (!cat.on) schedule(); }, 9000);
  }

  return {
    init, react, swing, startCat, layout, patrons, cat, hooks, play, pet, CAT_SVG,
    refreshPosters,
    get root() { return root; }
  };
})();
