'use strict';
// Saloon: unlockable tables (felt, rail and card back), the local records of
// past runs and the ambience (swinging lamp, light cone and dust motes).

const SALOON = (function () {
  // Tables unlock when the all-time best bank reaches `need`.
  const THEMES = [
    { id: 'classic', name: 'Classic Green', need: 0, felt: '#0f5a3a', feltDark: '#073322', rail: '#3b2314', backA: '#a3232b', backB: '#6d1219', line: 'rgba(255,255,255,.13)' },
    { id: 'oak', name: 'Saloon Oak', need: 250, felt: '#7b5130', feltDark: '#3a2312', rail: '#1f130b', backA: '#1f4f86', backB: '#10294a', line: 'rgba(255,255,255,.14)' },
    { id: 'river', name: 'Riverboat', need: 500, felt: '#1c4a72', feltDark: '#0b223a', rail: '#6b4a22', backA: '#262626', backB: '#050505', line: 'rgba(227,185,85,.3)' },
    { id: 'royal', name: 'Royal Flush', need: 1000, felt: '#6e1631', feltDark: '#2c0614', rail: '#160b06', backA: '#2c1f57', backB: '#140c2b', line: 'rgba(227,185,85,.28)' },
    { id: 'gold', name: 'Gold Rush', need: 2500, felt: '#2e2e2e', feltDark: '#0c0c0c', rail: '#8a6420', backA: '#d1a23a', backB: '#7c5a14', line: 'rgba(0,0,0,.22)' },
    { id: 'legend', name: 'Legend', need: 5000, felt: '#40205e', feltDark: '#14072a', rail: '#b8923f', backA: '#0f5a3a', backB: '#062a1b', line: 'rgba(227,185,85,.32)' }
  ];
  const MAX_RECORDS = 5;

  const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

  let best = 0;
  let current = load('day24.theme', 'classic');
  let unlockedCount = load('day24.unlocked', 1);
  let records = load('day24.records', []);
  if (!Array.isArray(records)) records = [];

  const unlocked = t => best >= t.need;

  function apply(id) {
    const t = THEMES.find(x => x.id === id && unlocked(x)) || THEMES[0];
    current = t.id;
    store('day24.theme', current);
    const s = document.documentElement.style;
    s.setProperty('--felt', t.felt);
    s.setProperty('--felt-dark', t.feltDark);
    s.setProperty('--rail', t.rail);
    s.setProperty('--back-a', t.backA);
    s.setProperty('--back-b', t.backB);
    s.setProperty('--back-line', t.line);
  }

  // Called whenever the best bank grows; returns the tables just unlocked.
  function setBest(value) {
    best = value;
    const count = THEMES.filter(unlocked).length;
    const fresh = count > unlockedCount ? THEMES.filter(unlocked).slice(unlockedCount) : [];
    if (count > unlockedCount) {
      unlockedCount = count;
      store('day24.unlocked', count);
    }
    return fresh;
  }

  // Store a finished run; returns its rank (1-based) or 0 if not in the top list.
  function addRecord(run) {
    const d = new Date();
    run.date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    run.id = Date.now();
    records.push(run);
    records.sort((a, b) => b.peak - a.peak || b.final - a.final);
    records = records.slice(0, MAX_RECORDS);
    store('day24.records', records);
    return records.findIndex(r => r.id === run.id) + 1;
  }

  // ---------- Toast ----------

  let toastEl, toastTimer = 0;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.remove('pop');
    void toastEl.offsetWidth;
    toastEl.classList.add('pop');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3400);
  }

  // ---------- Tables and records panel ----------

  let panel;
  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'overlay';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="panel wide" role="dialog" aria-label="Tables and records">' +
      '<h2>The Saloon</h2>' +
      '<h3>Tables</h3><div class="themes"></div>' +
      '<h3>Records</h3><div class="records"></div>' +
      '<button class="deal" type="button">Close</button></div>';
    document.body.appendChild(panel);
    panel.querySelector('button.deal').addEventListener('click', closePanel);
    panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });
  }

  function renderPanel() {
    const box = panel.querySelector('.themes');
    box.innerHTML = '';
    for (const t of THEMES) {
      const open = unlocked(t);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme' + (t.id === current ? ' on' : '') + (open ? '' : ' locked');
      b.disabled = !open;
      b.innerHTML =
        '<span class="swatch" style="--sf:' + t.felt + ';--sfd:' + t.feltDark + ';--sr:' + t.rail +
        ';--sa:' + t.backA + ';--sb:' + t.backB + ';--sl:' + t.line + '"><i></i></span>' +
        '<span class="tname">' + t.name + '</span>' +
        '<span class="tneed">' + (open ? (t.id === current ? 'In use' : 'Unlocked') : 'Reach $' + t.need) + '</span>';
      b.addEventListener('click', () => { apply(t.id); SOUND.chip(); renderPanel(); });
      box.appendChild(b);
    }

    const rec = panel.querySelector('.records');
    if (!records.length) {
      rec.innerHTML = '<p class="empty">No runs yet. Bust or cash out to get on the board.</p>';
      return;
    }
    rec.innerHTML = '<table><thead><tr><th>#</th><th>Peak</th><th>Final</th><th>Rounds</th><th>Level</th><th>Date</th></tr></thead><tbody>' +
      records.map((r, i) => '<tr><td>' + (i + 1) + '</td><td>$' + r.peak + '</td><td>$' + r.final + '</td><td>' + r.rounds +
        '</td><td>' + r.level + '</td><td>' + r.date + '</td></tr>').join('') + '</tbody></table>';
  }

  function openPanel() { renderPanel(); panel.hidden = false; panel.querySelector('button.deal').focus(); }
  function closePanel() { panel.hidden = true; }

  // ---------- Ambience ----------

  let table, lamp, canvas, ctx, motes = [];

  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(table.clientWidth * dpr);
    canvas.height = Math.round(table.clientHeight * dpr);
  }

  function makeMote(anywhere) {
    return {
      x: Math.random(),
      y: anywhere ? Math.random() : -0.02,
      vx: (Math.random() - 0.5) * 0.006,
      vy: 0.004 + Math.random() * 0.01,
      r: 0.6 + Math.random() * 1.4,
      ph: Math.random() * 6.28
    };
  }

  let last = 0;
  function loop(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, last ? t - last : 0);
    last = t;

    // The lamp swings slowly on a long cord: a mix of two sines.
    const angle = 3.2 * Math.sin(t * 0.75) + 1.1 * Math.sin(t * 1.83 + 1);
    const W = table.clientWidth, H = table.clientHeight;
    // Pendulum: the lamp is displaced by `off` and tilted by the same angle, so
    // its axis (and the light) points away from the pivot far above the table.
    const rad = angle * Math.PI / 180;
    const off = Math.sin(rad) * H * 1.4;          // horizontal offset of the cord in px
    lamp.style.transform = 'translateX(calc(-50% + ' + off.toFixed(1) + 'px)) rotate(' + (-angle).toFixed(2) + 'deg)';
    // Bulb centre: 20px below the cord along the tilted lamp axis.
    const BULB = 20;
    const apexX = W / 2 + off + BULB * Math.sin(rad), apexY = BULB * Math.cos(rad);
    const tilt = Math.tan(rad);
    table.style.setProperty('--lx', (apexX + tilt * (H * 0.42 - apexY) - W / 2).toFixed(1) + 'px');
    table.style.setProperty('--shx', (-off * 0.12).toFixed(1) + 'px');

    // Light cone and dust motes, additive. The cone starts at the bulb and
    // follows the lamp's axis down to the felt.
    const cw = canvas.width, ch = canvas.height, sc = cw / W;
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalCompositeOperation = 'lighter';
    const lx = apexX * sc, top = apexY * sc;
    const bottomX = (apexX + tilt * (H - apexY)) * sc;
    const grad = ctx.createLinearGradient(0, top, 0, ch);
    grad.addColorStop(0, 'rgba(255,214,150,0.10)');
    grad.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(lx - 12 * sc, top);
    ctx.lineTo(lx + 12 * sc, top);
    ctx.lineTo(bottomX + W * 0.32 * sc, ch);
    ctx.lineTo(bottomX - W * 0.32 * sc, ch);
    ctx.closePath();
    ctx.fill();

    for (const m of motes) {
      m.x += (m.vx + Math.sin(t * 0.7 + m.ph) * 0.002) * dt * 4;
      m.y += m.vy * dt * 4;
      if (m.y > 1.02 || m.x < -0.05 || m.x > 1.05) Object.assign(m, makeMote(false));
      const px = m.x * cw, py = m.y * ch;
      // Brightness: inside the cone the dust catches the light.
      const coneX = lx + (bottomX - lx) * m.y;
      const half = (12 * sc) + (W * 0.32 * sc - 12 * sc) * m.y;
      const inCone = Math.exp(-Math.pow((px - coneX) / half, 2) * 2);
      const a = (0.05 + 0.55 * inCone) * (0.6 + 0.4 * Math.sin(t * 2 + m.ph));
      ctx.fillStyle = 'rgba(255,226,170,' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(px, py, m.r * sc, 0, 6.283);
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }

  function init(tableEl, bestValue) {
    table = tableEl;
    best = bestValue;
    if (THEMES.filter(unlocked).length > unlockedCount) {
      unlockedCount = THEMES.filter(unlocked).length;
      store('day24.unlocked', unlockedCount);
    }
    apply(current);

    lamp = document.createElement('div');
    lamp.className = 'lamp';
    lamp.innerHTML = '<i class="cord"></i><i class="shade"></i><i class="bulb"></i>';
    table.appendChild(lamp);

    canvas = document.createElement('canvas');
    canvas.className = 'dust';
    table.appendChild(canvas);
    ctx = canvas.getContext('2d');
    for (let i = 0; i < 55; i++) motes.push(makeMote(true));
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.hidden = true;
    table.appendChild(toastEl);

    buildPanel();
    requestAnimationFrame(loop);
  }

  return {
    init, setBest, addRecord, toast, openPanel, closePanel,
    get panelOpen() { return panel && !panel.hidden; },
    get records() { return records; }
  };
})();
