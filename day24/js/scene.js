'use strict';
// Saloon background: silhouetted patrons who react to the game, a cat that
// walks along the bar, and a pair of swinging batwing doors. Everything lives
// in the side margins around the table (it is hidden on narrow screens).

const SCENE = (function () {
  const BAR = 0.63;                         // bar top as a fraction of the viewport height (CSS --bar)
  const PH = () => Math.max(90, Math.min(150, innerHeight * 0.19));   // base patron height (CSS --ph)
  const ALL = ['cheer', 'laugh', 'gasp', 'hush', 'up'];

  const WORDS = {
    cheer: ['Yeehaw!', 'Bravo!', 'Atta boy!', 'Woo-hoo!', 'Hooray!', 'Nice one!'],
    laugh: ['Ha ha!', 'Hee hee!', 'Haw haw!', 'Oh boy!', 'Ha!', 'Poor fella!'],
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

  let root, tableEl, doorsEl, catEl, catBox;
  const patrons = [];
  let margins = { left: 0, right: 0 };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // ---------- Build ----------

  function build() {
    root = document.createElement('div');
    root.className = 'scene';
    root.setAttribute('aria-hidden', 'true');

    // Back wall doors first, so patrons stand in front of them.
    doorsEl = document.createElement('div');
    doorsEl.className = 'doors';
    doorsEl.innerHTML = '<i class="glow"></i><i class="leaf l"></i><i class="leaf r"></i><i class="post"></i>';
    root.appendChild(doorsEl);

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
    catEl.addEventListener('click', () => {
      SOUND.meow();
      catBox.classList.remove('hop');
      void catBox.offsetWidth;
      catBox.classList.add('hop');
    });
    root.appendChild(catEl);

    document.body.insertBefore(root, document.body.firstChild);
  }

  // Show as many patrons as fit in the margins left and right of the table.
  function layout() {
    const r = tableEl.getBoundingClientRect();
    margins = { left: r.left, right: innerWidth - r.right };
    const ph = PH();
    const doorsOn = margins.right >= 120;
    doorsEl.hidden = !doorsOn;

    for (const side of ['left', 'right']) {
      const m = margins[side];
      let x = side === 'right' && doorsOn ? 96 : 12;
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

  // kind: cheer | laugh | gasp | hush; power > 1 for a bigger reaction (win streaks).
  function react(kind, power) {
    power = power || 1;
    if (kind === 'cheer') SOUND.cheers();
    else if (kind === 'laugh') SOUND.laugh();
    else SOUND.ooh(kind === 'hush');

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
    layout();
    window.addEventListener('resize', layout);
    requestAnimationFrame(loop);
    setInterval(sip, 6500);
    (function doorsLater() { setTimeout(() => { swing(); doorsLater(); }, rnd(28000, 65000)); })();
    catTimer = setTimeout(() => { startCat(); if (!cat.on) schedule(); }, 9000);
  }

  return { init, react, swing, startCat, layout, patrons, cat };
})();
