'use strict';
// The saloon cat on the felt. On phones and tablets the saloon background (and
// its cat on the bar) is hidden, so now and then the cat strolls along the
// bottom edge of the table instead, below the cards, and can be petted there.

const FELTCAT = (function () {
  const SPEED = 75;                // px per second
  const W = 56;                    // cat width in px
  let table, el, box, on = false, x = 0, dir = 1, sitUntil = 0, sitAt = null, last = 0, timer = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const sceneShown = () => SCENE.root && getComputedStyle(SCENE.root).display !== 'none';

  function start() {
    if (on || sceneShown() || document.hidden) { schedule(); return; }
    const T = table.clientWidth;
    dir = Math.random() < 0.5 ? 1 : -1;
    x = dir > 0 ? -W - 6 : T + 6;
    // Half the time it sits down for a moment somewhere along the way.
    sitAt = Math.random() < 0.5 ? rnd(T * 0.2, T * 0.8 - W) : null;
    sitUntil = 0;
    on = true;
    el.hidden = false;
    el.classList.remove('sit');
    box.firstChild.style.transform = dir < 0 ? 'scaleX(-1)' : '';   // on the svg, so the hop does not undo it
    last = 0;
    requestAnimationFrame(step);
  }

  function step(now) {
    if (!on) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    if (sitUntil) {
      if (now > sitUntil) { sitUntil = 0; el.classList.remove('sit'); }
    } else {
      x += dir * SPEED * dt;
      if (sitAt !== null && (dir > 0 ? x >= sitAt : x <= sitAt)) {
        sitAt = null;
        sitUntil = now + 2200;
        el.classList.add('sit');
        SOUND.meow();
      }
    }
    el.style.transform = 'translateX(' + x.toFixed(1) + 'px)';
    if (x > table.clientWidth + 10 || x < -W - 10) {
      on = false;
      el.hidden = true;
      schedule();
      return;
    }
    requestAnimationFrame(step);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(start, rnd(25000, 50000));
  }

  function init(tableEl) {
    table = tableEl;
    el = document.createElement('div');
    el.className = 'cat feltcat';
    el.hidden = true;
    el.innerHTML = '<div class="catbox">' + SCENE.CAT_SVG + '</div>';
    box = el.firstChild;
    el.addEventListener('click', () => SCENE.pet(el, box));
    table.appendChild(el);
    timer = setTimeout(start, 12000);
  }

  return { init, start, get on() { return on; } };
})();
