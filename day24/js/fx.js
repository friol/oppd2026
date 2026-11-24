'use strict';
// Table effects: the pot (chips sliding onto the felt), coin rain, table shake
// and the pick timer bar.

const FX = (function () {
  const DENOMS = [100, 50, 25, 10, 5];
  const MAX_CHIPS = 8;
  let table, pot, bar, fill, num;
  let timer = 0, endAt = 0, lastSec = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);

  function init(tableEl) {
    table = tableEl;
    pot = document.createElement('div');
    pot.className = 'pot';
    table.appendChild(pot);
    bar = document.createElement('div');
    bar.className = 'timer';
    bar.hidden = true;
    bar.innerHTML = '<span class="num"></span><i class="fill"></i>';
    table.appendChild(bar);
    fill = bar.querySelector('.fill');
    num = bar.querySelector('.num');
  }

  // Split an amount into chip values (greedy, at most MAX_CHIPS shown).
  function chipsFor(amount) {
    const out = [];
    for (const d of DENOMS) while (amount >= d && out.length < MAX_CHIPS) { out.push(d); amount -= d; }
    return out;
  }

  // A stack of chips that slides in from below the table.
  function stack(amount, cls) {
    const col = document.createElement('div');
    col.className = 'stack ' + (cls || '');
    chipsFor(amount).forEach((v, i) => {
      const c = document.createElement('i');
      c.className = 'pchip c' + v;
      c.style.bottom = (i * 6) + 'px';
      c.style.left = rnd(-3, 3).toFixed(1) + 'px';
      c.style.animationDelay = (i * 70) + 'ms';
      col.appendChild(c);
      if (i < 3) setTimeout(() => SOUND.chip(), i * 90);
    });
    return col;
  }

  function clear() {
    pot.className = 'pot';
    pot.innerHTML = '';
  }

  // The bet goes onto the table.
  function bet(amount) {
    clear();
    pot.appendChild(stack(amount));
    const sum = document.createElement('span');
    sum.className = 'sum';
    sum.textContent = '$' + amount;
    pot.appendChild(sum);
  }

  // Coins fall from the top of the table.
  function rain(n) {
    for (let i = 0; i < n; i++) {
      const c = document.createElement('i');
      c.className = 'rcoin';
      const dur = rnd(1.1, 2);
      const delay = rnd(0, 0.9);
      c.style.left = rnd(2, 96).toFixed(1) + '%';
      c.style.setProperty('--dur', dur.toFixed(2) + 's');
      c.style.setProperty('--delay', delay.toFixed(2) + 's');
      c.style.setProperty('--sz', rnd(16, 28).toFixed(0) + 'px');
      table.appendChild(c);
      setTimeout(() => c.remove(), (dur + delay) * 1000 + 100);
    }
  }

  function sweep(cls, ms) {
    pot.classList.add(cls);
    setTimeout(clear, ms);
  }

  // The player wins: extra chips join the pot, coins rain down, the pot flies off to the bank.
  // `scale` < 1 for a consolation prize.
  function win(prize, scale) {
    scale = scale || 1;
    const extra = stack(prize, 'extra');
    pot.insertBefore(extra, pot.firstChild);
    const n = Math.min(70, Math.round((18 + prize / 3) * scale));
    rain(n);
    SOUND.coins(Math.round(n * 0.8));
    setTimeout(() => sweep('up', 900), 1100);
  }

  // The dealer takes the pot and the table jolts.
  function lose(big) {
    setTimeout(() => { SOUND.chip(); sweep('lost', 800); }, 400);
    shake(big);
  }

  function shake(big) {
    table.classList.remove('shake', 'shake2');
    void table.offsetWidth;
    table.classList.add(big ? 'shake2' : 'shake');
    SOUND.thud();
    setTimeout(() => table.classList.remove('shake', 'shake2'), 700);
  }

  // ---------- Pick timer ----------

  function stopTimer() {
    clearInterval(timer);
    timer = 0;
    bar.hidden = true;
  }

  function startTimer(sec, onEnd) {
    stopTimer();
    bar.hidden = false;
    bar.classList.remove('hot');
    fill.style.transition = 'none';
    fill.style.width = '100%';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + sec + 's linear';
    fill.style.width = '0%';
    endAt = performance.now() + sec * 1000;
    lastSec = Math.ceil(sec);
    num.textContent = lastSec + 's';
    timer = setInterval(() => {
      const left = (endAt - performance.now()) / 1000;
      const s = Math.max(0, Math.ceil(left));
      if (s !== lastSec) {
        lastSec = s;
        num.textContent = s + 's';
        bar.classList.toggle('hot', s <= 3);
        if (s > 0) SOUND.tick(s <= 3);
      }
      if (left <= 0) { stopTimer(); onEnd(); }
    }, 100);
  }


  // ---------- Chip thief ----------
  // A hand creeps in from the right edge toward the pot. Click it before it
  // grabs a chip. onResult('caught' | 'stole') says how it ended.

  const THIEF_SVG =
    '<svg viewBox="0 0 230 64" aria-hidden="true">' +
    '<rect x="120" y="12" width="110" height="40" fill="#3b2a52"/>' +
    '<rect x="120" y="12" width="110" height="6" fill="#5a4278"/>' +
    '<rect x="112" y="10" width="14" height="44" rx="3" fill="#efe7d4"/>' +
    '<path d="M112 14 H84 C74 16 70 26 70 32 C70 40 76 48 84 50 H112 Z" fill="#d9a77f" stroke="#a97a58" stroke-width="1.2"/>' +
    '<rect x="34" y="16" width="46" height="8" rx="4" fill="#d9a77f" stroke="#a97a58" stroke-width="1.2"/>' +
    '<rect x="30" y="24.5" width="50" height="8" rx="4" fill="#d9a77f" stroke="#a97a58" stroke-width="1.2"/>' +
    '<rect x="32" y="33" width="48" height="8" rx="4" fill="#d9a77f" stroke="#a97a58" stroke-width="1.2"/>' +
    '<rect x="38" y="41.5" width="42" height="7" rx="3.5" fill="#d9a77f" stroke="#a97a58" stroke-width="1.2"/>' +
    '<path d="M84 50 C74 58 56 58 50 52 C58 50 70 48 84 44 Z" fill="#cf9c74" stroke="#a97a58" stroke-width="1.2"/></svg>';

  let thiefState = null;

  function dropThief(st, ms) {
    st.timers.forEach(clearTimeout);
    st.timers = [setTimeout(() => st.el.remove(), ms)];
  }

  function thief(onResult) {
    cancelThief();
    const W = table.clientWidth;
    const el = document.createElement('div');
    el.className = 'thief';
    el.innerHTML = THIEF_SVG;
    el.style.left = (W + 20) + 'px';
    table.appendChild(el);
    const st = { el, done: false, grabbed: false, timers: [] };
    thiefState = st;
    SOUND.sneak();
    void el.offsetWidth;
    el.style.left = (W * 0.95 - 28 - 40) + 'px';          // fingertips over the pot

    el.addEventListener('pointerdown', e => {
      if (st.done || st.grabbed) return;
      e.stopPropagation();
      st.done = true;
      el.classList.add('caught', 'flee');
      el.style.left = (W + 30) + 'px';
      SOUND.slap();
      dropThief(st, 600);
      onResult('caught');
    });

    st.timers.push(setTimeout(() => {
      if (st.done) return;
      st.grabbed = true;
      // Take the top chip of the bet.
      const top = pot.querySelector('.stack:not(.extra) .pchip:last-child');
      if (top) {
        const chip = top.cloneNode();
        chip.style.cssText = '';
        chip.classList.add('tchip');
        top.remove();
        el.appendChild(chip);
      }
      SOUND.chip();
      st.timers.push(setTimeout(() => {
        el.classList.add('back');
        el.style.left = (W + 30) + 'px';
        st.done = true;
        onResult('stole');
        dropThief(st, 900);
      }, 300));
    }, 1900));
  }

  // The player picked a card: a thief that has not grabbed yet runs away.
  function cancelThief() {
    const st = thiefState;
    if (!st || st.done || st.grabbed) return;
    st.done = true;
    st.el.classList.add('flee');
    st.el.style.left = (table.clientWidth + 30) + 'px';
    dropThief(st, 600);
  }

  // ---------- Cat hint ----------
  // A cat strolls over the felt, sits under one card and meows. It points at the
  // Joker only some of the time (the caller picks the card).

  let catState = null;

  function catHint(xPx) {
    cancelCat();
    const W = table.clientWidth;
    const CW = 62 * 1.35;
    const fromRight = Math.random() < 0.5;
    const el = document.createElement('div');
    el.className = 'cat tcat';
    el.innerHTML = '<div class="catbox">' + SCENE.CAT_SVG + '</div>';
    el.firstChild.style.transform = fromRight ? 'scaleX(-1)' : '';
    el.style.left = (fromRight ? W + 10 : -CW - 10) + 'px';
    table.appendChild(el);
    const st = { el, timers: [] };
    catState = st;
    void el.offsetWidth;
    el.style.transition = 'left 2.3s linear';
    el.style.left = (W / 2 + xPx - CW / 2) + 'px';
    st.timers.push(setTimeout(() => { el.classList.add('sit'); SOUND.meow(); }, 2300));
    st.timers.push(setTimeout(() => SOUND.meow(), 4100));
    st.timers.push(setTimeout(() => {              // walks on, out the other side
      el.classList.remove('sit');
      el.style.left = (fromRight ? -CW - 10 : W + 10) + 'px';
    }, 5600));
    st.timers.push(setTimeout(() => el.remove(), 8100));
  }

  function cancelCat() {
    const st = catState;
    if (!st) return;
    catState = null;
    st.timers.forEach(clearTimeout);
    st.el.style.transition = 'opacity .3s';
    st.el.style.opacity = '0';
    setTimeout(() => st.el.remove(), 350);
  }

  return { init, bet, win, lose, clear, shake, rain, startTimer, stopTimer, thief, cancelThief, catHint, cancelCat };
})();
