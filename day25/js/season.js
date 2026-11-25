'use strict';
// Seasons (from day24): the saloon changes with the date. Halloween (Oct 20 -
// Nov 2): carved pumpkins, bats and a witch hat on the dealer. Autumn (Nov 3 -
// Nov 30): plain pumpkins and falling leaves. Christmas (Dec 1 - Jan 6): fairy
// lights, snow and a Santa hat. Choose "Auto" (by date) or force one in the
// Medals panel, or with ?season=halloween|autumn|christmas|off in the address.
// Particles and lights live in their own layer behind the app, so they show on
// phones and tablets too; the pumpkins sit on the bar of the saloon background.

const SEASON = (function () {
  const LIST = [
    { id: 'halloween', name: 'Halloween', from: [10, 20], to: [11, 2] },
    { id: 'autumn', name: 'Autumn', from: [11, 3], to: [11, 30] },
    { id: 'christmas', name: 'Christmas', from: [12, 1], to: [1, 6] }
  ];
  const KEY = 'day25.season';

  let choice = 'auto';
  try {
    const q = new URLSearchParams(location.search).get('season');
    choice = q || localStorage.getItem(KEY) || 'auto';
  } catch (e) { }

  const inRange = (d, s) => {
    const v = (d.getMonth() + 1) * 100 + d.getDate();
    const a = s.from[0] * 100 + s.from[1], b = s.to[0] * 100 + s.to[1];
    return a <= b ? v >= a && v <= b : v >= a || v <= b;    // Christmas wraps over the new year
  };

  function current() {
    if (choice === 'off') return null;
    if (choice !== 'auto') return LIST.some(s => s.id === choice) ? choice : null;
    const s = LIST.find(x => inRange(new Date(), x));
    return s ? s.id : null;
  }

  // ---------- Decorations ----------

  let root = null, fx = null, decor = null, cv = null, ctx = null, mode = null, raf = 0, last = 0;
  let parts = [], bat = null, nextBat = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const PUMPKIN =
    '<svg viewBox="0 0 64 54" aria-hidden="true">' +
    '<path d="M32 12 C10 6 2 22 4 34 C6 48 20 52 32 50 C44 52 58 48 60 34 C62 22 54 6 32 12 Z" fill="#e8761e" stroke="#8a3a0c" stroke-width="1.5"/>' +
    '<path d="M32 12 C22 20 22 42 32 50 M32 12 C42 20 42 42 32 50" fill="none" stroke="#b8500e" stroke-width="1.6"/>' +
    '<path d="M32 12 C30 6 34 3 38 4" fill="none" stroke="#3d6b24" stroke-width="3" stroke-linecap="round"/>' +
    '<g class="face"><path d="M18 24 L26 24 L22 31 Z M38 24 L46 24 L42 31 Z" fill="#ffd25a"/>' +
    '<path d="M18 38 L24 42 L28 38 L32 43 L36 38 L40 42 L46 38 L44 45 L20 45 Z" fill="#ffd25a"/></g></svg>';

  function clearDecor() {
    cancelAnimationFrame(raf);
    raf = 0; mode = null; bat = null;
    if (decor) { decor.remove(); decor = null; }
    if (cv) { cv.remove(); cv = null; ctx = null; }
    if (fx) fx.innerHTML = '';
    if (root) root.classList.remove('s-halloween', 's-autumn', 's-christmas');
    if (fx) fx.className = 'seasonfx';
  }

  // Fairy lights hanging in festoons across the top of the screen.
  function buildLights() {
    const box = document.createElement('div');
    box.className = 'xlights';
    const W = innerWidth, n = Math.max(3, Math.round(W / 220)), seg = W / n, sag = 52;
    let d = 'M0 3', bulbs = '', k = 0;
    const colors = ['#ff4a3d', '#ffd25a', '#4adf6a', '#4aa8ff'];
    for (let j = 0; j < n; j++) {
      const x0 = j * seg, x1 = x0 + seg;
      d += ' Q' + (x0 + seg / 2).toFixed(1) + ' ' + (3 + sag).toFixed(1) + ' ' + x1.toFixed(1) + ' 3';
      for (let b = 1; b <= 4; b++) {
        const t = b / 5, x = x0 + seg * t, y = 3 + 2 * t * (1 - t) * sag;
        bulbs += '<i style="left:' + x.toFixed(1) + 'px;top:' + (y + 2).toFixed(1) + 'px;--c:' + colors[k % 4] +
          ';animation-delay:' + (-(k % 7) * 0.31).toFixed(2) + 's"></i>';
        k++;
      }
    }
    box.innerHTML = '<svg width="' + W + '" height="' + (sag / 2 + 20) + '"><path d="' + d + '" fill="none" stroke="#1a2a1a" stroke-width="2"/></svg>' + bulbs;
    return box;
  }

  // A pair of pumpkins on the bar, at the inner edge of each margin.
  function placePumpkins() {
    if (!decor || !table) return;
    const r = table.getBoundingClientRect();
    const mL = r.left, mR = innerWidth - r.right;
    decor.querySelectorAll('.pumpkin').forEach(p => {
      const left = p.classList.contains('l');
      const m = left ? mL : mR;
      p.hidden = m < 170;
      p.style[left ? 'left' : 'right'] = Math.max(8, m - 70) + 'px';
    });
  }

  let table = null;

  function resizeCanvas() {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const makePart = (anywhere) => mode === 'snow'
    ? { x: rnd(0, innerWidth), y: anywhere ? rnd(0, innerHeight) : -10, r: rnd(1, 3), vy: rnd(25, 60), ph: rnd(0, 6.28) }
    : { x: rnd(0, innerWidth), y: anywhere ? rnd(0, innerHeight) : -20, r: rnd(6, 11), vy: rnd(35, 75), ph: rnd(0, 6.28), rot: rnd(0, 6.28), vr: rnd(-2, 2), c: ['#c4561a', '#d98a22', '#8a3a14', '#b8862b'][Math.floor(Math.random() * 4)] };

  function drawBat(x, y, s, flap) {
    ctx.fillStyle = '#0d0805';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 * s, 5 * s, 0, 0, 6.283);
    ctx.fill();
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + dir * 2 * s, y - 1 * s);
      ctx.lineTo(x + dir * 24 * s, y - 11 * s * flap);
      ctx.lineTo(x + dir * 17 * s, y + 1 * s);
      ctx.lineTo(x + dir * 11 * s, y + 6 * s);
      ctx.lineTo(x + dir * 2 * s, y + 4 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x - 3 * s, y - 4 * s); ctx.lineTo(x - 2 * s, y - 9 * s); ctx.lineTo(x, y - 4 * s);
    ctx.moveTo(x, y - 4 * s); ctx.lineTo(x + 2 * s, y - 9 * s); ctx.lineTo(x + 3 * s, y - 4 * s);
    ctx.fill();
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (!ctx) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (mode === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (const p of parts) {
        p.y += p.vy * dt;
        p.x += Math.sin(now / 900 + p.ph) * 14 * dt;
        if (p.y > innerHeight + 10) Object.assign(p, makePart(false));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    } else if (mode === 'leaves') {
      for (const p of parts) {
        p.y += p.vy * dt;
        p.x += Math.sin(now / 700 + p.ph) * 30 * dt;
        p.rot += p.vr * dt;
        if (p.y > innerHeight + 20) Object.assign(p, makePart(false));
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, 6.283); ctx.fill();
        ctx.strokeStyle = 'rgba(60,20,5,.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.lineTo(p.r, 0); ctx.stroke();
        ctx.restore();
      }
    } else if (mode === 'bats') {
      if (!bat && now > nextBat) {
        const dir = Math.random() < 0.5 ? 1 : -1;
        bat = { x: dir > 0 ? -40 : innerWidth + 40, y: rnd(40, innerHeight * 0.3), dir, s: rnd(0.8, 1.4), ph: 0 };
      }
      if (bat) {
        bat.x += bat.dir * 170 * dt;
        bat.ph += dt * 14;
        const y = bat.y + Math.sin(bat.x / 60) * 26;
        drawBat(bat.x, y, bat.s, 0.3 + Math.abs(Math.sin(bat.ph)));
        if (bat.x < -60 || bat.x > innerWidth + 60) { bat = null; nextBat = now + rnd(5000, 12000); }
      }
    }
  }

  function startParticles(m) {
    mode = m;
    cv = document.createElement('canvas');
    cv.className = 'seasoncv';
    fx.insertBefore(cv, fx.firstChild);
    ctx = cv.getContext('2d');
    resizeCanvas();
    parts = [];
    const n = m === 'snow' ? 110 : m === 'leaves' ? 45 : 0;
    for (let i = 0; i < n; i++) parts.push(makePart(true));
    nextBat = performance.now() + 2500;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function apply() {
    const id = current();
    root = SCENE.root;
    table = document.getElementById('mid');
    if (!fx) {
      fx = document.createElement('div');
      fx.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(fx, document.body.firstChild);
    }
    clearDecor();
    document.documentElement.dataset.season = id || '';
    DEALER.setSeason(id);
    if (!id || !root) return;

    root.classList.add('s-' + id);
    fx.classList.add('s-' + id);
    if (id === 'christmas') fx.appendChild(buildLights());
    decor = document.createElement('div');
    decor.className = 'season-decor';
    if (id === 'halloween' || id === 'autumn') {
      for (const side of ['l', 'r']) {
        const p = document.createElement('div');
        p.className = 'pumpkin ' + side + (id === 'autumn' ? ' plain' : '');
        p.innerHTML = PUMPKIN;
        decor.appendChild(p);
      }
    }
    root.appendChild(decor);
    placePumpkins();
    startParticles(id === 'christmas' ? 'snow' : id === 'autumn' ? 'leaves' : 'bats');
  }

  function set(c) {
    choice = c;
    try { localStorage.setItem(KEY, c); } catch (e) { }
    apply();
  }

  // Buttons for the Medals panel.
  function render(box) {
    box.innerHTML = '';
    const cur = current();
    [['auto', 'Auto'], ['off', 'Off'], ...LIST.map(s => [s.id, s.name])].forEach(([id, name]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'seasonbtn' + (choice === id ? ' on' : '');
      b.textContent = name + (id === 'auto' && cur ? ' (' + LIST.find(s => s.id === cur).name + ')' : '');
      b.addEventListener('click', () => { set(id); render(box); SOUND.chip(); });
      box.appendChild(b);
    });
  }

  function init() {
    apply();
    window.addEventListener('resize', () => {
      placePumpkins();
      resizeCanvas();
      if (fx && fx.classList.contains('s-christmas')) {
        const old = fx.querySelector('.xlights');
        if (old) { old.remove(); fx.appendChild(buildLights()); }
      }
    });
  }

  return { init, apply, set, render, current };
})();
