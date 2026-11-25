'use strict';
// Medals: achievements for special feats, kept in localStorage. Earning one
// shows a toast at the top of the screen (queued, so they never overlap) with
// a little fanfare. The Medals panel lists them all, locked ones greyed out.

const MEDALS = (function () {
  // icon: a card symbol id (js/symbols.js), or 'cat' for the bar cat.
  const LIST = [
    { id: 'first', icon: 'star', name: 'First Clear', desc: 'Clear a table for the first time.' },
    { id: 'lucky', icon: 'horseshoe', name: 'Sharp Start', desc: 'Find a pair with the very first two cards you turn.' },
    { id: 'streak5', icon: 'sun', name: 'Hot Streak', desc: 'Find 5 pairs in a row.' },
    { id: 'streak10', icon: 'waves', name: 'Unstoppable', desc: 'Find 10 pairs in a row.' },
    { id: 'perfect', icon: 'moon', name: 'Photographic Memory', desc: 'Clear a table without a single mistake.' },
    { id: 'whisker', icon: 'heart', name: 'By a Whisker', desc: 'Clear a table with no mistakes left to spare.' },
    { id: 'quick', icon: 'boot', name: 'Quick Draw', desc: 'Clear the Easy table in under 20 seconds.' },
    { id: 'medium', icon: 'bottle', name: 'Medium Rare', desc: 'Clear the Medium table.' },
    { id: 'hard', icon: 'anchor', name: 'Hard Case', desc: 'Clear the Hard table.' },
    { id: 'pro', icon: 'spade', name: 'Card Shark', desc: 'Clear the Pro table.' },
    { id: 'ghost', icon: 'diamond', name: 'Ghost of the Saloon', desc: 'Clear the Pro table without a single mistake.' },
    { id: 'score', icon: 'bell', name: 'High Roller', desc: 'Score 5000 points or more in one game.' },
    { id: 'duel', icon: 'badge', name: 'Fastest Gun', desc: 'Win the duel the sheriff calls after a perfect game.' },
    { id: 'lightning', icon: 'bolt', name: 'Lightning Draw', desc: 'Win the duel drawing in under 250 ms.' },
    { id: 'regular', icon: 'hat', name: 'Regular', desc: 'Play 10 games.' },
    { id: 'quitter', icon: 'cactus', name: 'Cold Feet', desc: 'Walk away from a game halfway through.' },
    { id: 'cat', icon: 'cat', name: 'Cat Whisperer', desc: 'Pet the saloon cat three times.' }
  ];

  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

  let earned = load('day25.medals', []);
  if (!Array.isArray(earned)) earned = [];
  let progress = load('day25.medalprog', {});
  if (!progress || typeof progress !== 'object') progress = {};

  const has = id => earned.includes(id);
  const listeners = [];

  // ---------- Toasts ----------

  let toastEl = null, busy = false, timer = 0;
  const queue = [];

  function toast(html) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'mtoast';
      toastEl.setAttribute('role', 'status');
      toastEl.hidden = true;
      document.body.appendChild(toastEl);
    }
    queue.push(html);
    if (!busy) next();
  }

  function next() {
    const html = queue.shift();
    if (html === undefined) { busy = false; toastEl.hidden = true; return; }
    busy = true;
    toastEl.innerHTML = html;
    toastEl.hidden = false;
    toastEl.classList.remove('pop');
    void toastEl.offsetWidth;
    toastEl.classList.add('pop');
    SOUND.unlock();
    clearTimeout(timer);
    timer = setTimeout(next, 3200);
  }

  // ---------- Medals ----------

  function icon(m) {
    if (m.icon === 'cat') return typeof SCENE !== 'undefined' ? SCENE.CAT_SVG : '';
    return SYMBOLS.svg(m.icon);
  }

  // Earn a medal; returns true the first time.
  function award(id) {
    const m = LIST.find(x => x.id === id);
    if (!m || has(id)) return false;
    earned.push(id);
    store('day25.medals', earned);
    toast('<span class="mico' + (m.icon === 'cat' ? ' mcat' : '') + '">' + icon(m) + '</span><span><small>Medal earned</small><b>' + m.name + '</b></span>');
    listeners.forEach(f => f(id));
    return true;
  }

  // One more step toward a medal that needs `target` of them; returns the new count.
  function bump(id, target) {
    progress[id] = (progress[id] || 0) + 1;
    store('day25.medalprog', progress);
    if (progress[id] >= target) award(id);
    return progress[id];
  }

  function render(box) {
    box.innerHTML = LIST.map(m =>
      '<div class="medal' + (has(m.id) ? ' on' : '') + '">' +
      '<span class="mico' + (m.icon === 'cat' ? ' mcat' : '') + '">' + icon(m) + '</span>' +
      '<span class="mtext"><b>' + m.name + '</b><small>' + m.desc + '</small></span></div>').join('');
  }

  return {
    award, bump, has, render, toast,
    onAward(f) { listeners.push(f); },
    list: LIST,
    get count() { return earned.length; },
    progress(id) { return progress[id] || 0; }
  };
})();
