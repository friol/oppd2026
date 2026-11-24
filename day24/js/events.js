'use strict';
// Saloon events: the sheriff's duel (react faster than he does).

const EVENTS = (function () {
  const rnd = (a, b) => a + Math.random() * (b - a);
  // Five-point star (the sheriff's badge) around (cx, cy).
  const starPoints = (cx, cy, ro, ri) => Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? ri : ro;
    return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }).join(' ');

  let table;
  let duelOn = false, duelPressFn = null;

  // ---------- The duel ----------

  function duelist(cls) {
    const star = cls === 'sheriff';
    return '<div class="duelist ' + cls + '"><svg viewBox="0 0 100 170" aria-hidden="true">' +
      '<g class="dbody"><rect x="32" y="106" width="15" height="52" rx="3"/><rect x="53" y="106" width="15" height="52" rx="3"/>' +
      '<rect x="28" y="156" width="21" height="9" rx="3"/><rect x="51" y="156" width="21" height="9" rx="3"/>' +
      '<path d="M28 50 L72 50 L76 108 L24 108 Z"/><rect x="44" y="40" width="12" height="12"/>' +
      '<ellipse cx="50" cy="32" rx="10" ry="11"/><ellipse cx="50" cy="22" rx="26" ry="4.5"/>' +
      '<path d="M36 22 C35 6 46 2 50 4 C54 2 65 6 64 22 Z"/>' +
      (star ? '<polygon class="star" points="' + starPoints(38, 70, 8, 3.6) + '"/>' : '') +
      '</g>' +
      '<g class="darm"><rect x="64" y="50" width="9" height="42" rx="4"/><rect x="62" y="88" width="13" height="8"/>' +
      '<rect x="66" y="94" width="5" height="18"/>' +
      '<polygon class="flash" points="68.5,112 76,122 70,124 74,134 68.5,128 63,134 67,124 61,122"/></g>' +
      '</svg></div>';
  }

  // opts: { bounty, fine }. done({ won, ms, sheriffMs, surrendered }).
  function duel(opts, done) {
    if (duelOn) return;
    duelOn = true;
    const sheriffMs = Math.round(rnd(330, 470));
    const el = document.createElement('div');
    el.className = 'duel';
    el.innerHTML =
      '<div class="dsky"></div><div class="dsun"></div><div class="dground"></div><i class="tumble"></i>' +
      '<h2 class="dtitle">High Noon</h2>' + duelist('you') + duelist('sheriff') +
      '<div class="dmsg">&nbsp;</div>' +
      '<div class="dsub">The sheriff wants a word. Click (or press Space) the instant you see DRAW. Too early and he shoots.</div>' +
      '<div class="dres" hidden></div>' +
      '<button class="dskip" type="button">Surrender (−$' + opts.fine + ')</button>';
    document.body.appendChild(el);
    const msg = el.querySelector('.dmsg'), res = el.querySelector('.dres'), skip = el.querySelector('.dskip');
    let phase = 'intro', t0 = 0;
    const timers = [];
    const after = (ms, f) => timers.push(setTimeout(f, ms));

    function close(result) {
      timers.forEach(clearTimeout);
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
      duelOn = false; duelPressFn = null;
      done(result);
    }

    function finish(won, ms, why) {
      if (phase === 'done') return;
      phase = 'done';
      timers.forEach(clearTimeout);
      el.classList.add(won ? 'youfire' : 'sheriffire');
      SOUND.gunshot();
      msg.textContent = won ? 'You win!' : why;
      msg.classList.toggle('good', won);
      msg.classList.toggle('bad', !won);
      skip.hidden = true;
      res.hidden = false;
      res.innerHTML = (ms !== null ? 'You: <b>' + ms + ' ms</b> · ' : '') + 'Sheriff: <b>' + sheriffMs + ' ms</b><br>' +
        (won ? 'The sheriff pays a bounty of <b>$' + opts.bounty + '</b>.' : 'You pay a fine of <b>$' + opts.fine + '</b>.') +
        '<br><button class="deal" type="button">Continue</button>';
      const btn = res.querySelector('button');
      after(500, () => btn.focus());
      btn.addEventListener('click', () => close({ won, ms, sheriffMs }));
    }

    function press() {
      if (phase === 'intro') return;                          // grace period, ignore stray clicks
      if (phase === 'wait') finish(false, null, 'Too early!');
      else if (phase === 'draw') {
        const ms = Math.round(performance.now() - t0);
        finish(ms < sheriffMs, ms, 'Too slow!');
      }
    }
    duelPressFn = press;
    el.addEventListener('pointerdown', e => { if (e.target === skip || e.target.closest('.dres')) return; press(); });
    skip.addEventListener('click', () => { if (phase === 'done') return; close({ surrendered: true }); });

    SOUND.wind();
    after(700, () => { msg.textContent = 'Ready…'; phase = 'wait'; });
    after(700 + rnd(1700, 4200), () => {
      if (phase !== 'wait') return;
      phase = 'draw';
      msg.textContent = 'DRAW!';
      msg.classList.add('draw');
      SOUND.draw();
      t0 = performance.now();
      after(sheriffMs, () => finish(false, null, 'Too slow!'));
    });
  }

  function init(tableEl) { table = tableEl; }

  return {
    init, duel,
    duelPress: () => { if (duelPressFn) duelPressFn(); },
    get duelActive() { return duelOn; }
  };
})();
