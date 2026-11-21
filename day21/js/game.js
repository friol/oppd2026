// GAME: modes (title, free ride, time trial), countdown, checkpoints, derailment, medals, menus and HUD.
(function () {
  'use strict';
  const T = TRACK;
  const G = {
    mode: 'title',          // title | ride | trial
    state: 'idle',          // trial: countdown | run | derailed | done
    paused: false,
    time: 0, penalty: 0, derails: 0,
    st: null,
    ctl: { throttle: 0, brake: 0 },
    msg: null,
    best: null,
    gNow: { vert: 1, lat: 0 }, gPeak: 0,
  };
  const CPN = 6;   // checkpoints per lap

  function load() {
    try { const v = parseFloat(localStorage.getItem('riemann.best')); G.best = isFinite(v) ? v : null; } catch (e) { G.best = null; }
  }
  function save() { try { localStorage.setItem('riemann.best', String(G.best)); } catch (e) { } }

  // Medal times from an AI driver that keeps 3% under the speed cap
  function computeMedals() {
    const st = T.newState('game');
    let t = 0;
    const dt = 1 / 60;
    while (st.dist < T.L && t < 300) {
      const cap = T.trainCap(st.s, 2) * 0.97;
      T.step(st, dt, { throttle: st.v < cap - 0.3 ? 1 : 0, brake: st.v > cap ? 1 : 0 });
      t += dt;
    }
    G.aiTime = t;
    G.medals = { gold: Math.ceil(t * 1.06 * 10) / 10, silver: Math.ceil(t * 1.18 * 10) / 10, bronze: Math.ceil(t * 1.35 * 10) / 10 };
  }

  G.init = function () {
    load();
    computeMedals();
    G.startRide(true);
    G.mode = 'title';
    buildMinimap();
  };

  G.say = function (text, dur, color, sub) { G.msg = { text, t: dur || 1.5, dur: dur || 1.5, color: color || '#fff', sub, spr: SPR[text] }; };

  // Countdown sprites ("3", "2", "1", "GO!"), keyed by message text.
  const SPR = {};
  [['3', 'cd3'], ['2', 'cd2'], ['1', 'cd1'], ['GO!', 'cdgo']].forEach(([k, f]) => { const im = new Image(); im.src = 'img/' + f + '.png'; SPR[k] = im; });

  G.startRide = function (quick) {
    G.mode = 'ride'; G.state = 'idle';
    G.st = T.newState('ride');
    G.st.hold = quick ? G.st.dwell - 2 : G.st.dwell - 4;
    TRAIN.reset();
    G.msg = null;
  };

  G.startTrial = function () {
    G.mode = 'trial'; G.state = 'countdown';
    G.st = T.newState('game');
    G.st.auto = false;
    G.time = 0; G.penalty = 0; G.derails = 0; G.cp = 0; G.cdown = 3.6; G.lastBeep = 4;
    G.splits = [];
    G.gPeak = 0;
    TRAIN.reset();
    G.msg = null;
  };

  // Main update; returns nothing. Called with the real frame dt.
  G.update = function (dt, input) {
    if (G.msg) { G.msg.t -= dt; if (G.msg.t <= 0) G.msg = null; }
    if (G.paused) return;
    const st = G.st;
    G.ctl.throttle = 0; G.ctl.brake = 0;
    if (G.mode === 'trial') {
      if (G.state === 'countdown') {
        G.cdown -= dt;
        const n = Math.ceil(G.cdown);
        if (n < G.lastBeep && n <= 3) {
          G.lastBeep = n;
          if (n > 0) { AUDIO.countdown(n); G.say(String(n), 0.9, '#ffd040'); }
        }
        if (G.cdown <= 0) { G.state = 'run'; AUDIO.countdown(0); G.say('GO!', 1.0, '#7dff6a'); }
        return;
      }
      if (G.state === 'run') {
        G.ctl.throttle = input.throttle ? 1 : 0;
        G.ctl.brake = input.brake ? 1 : 0;
        G.time += dt;
        stepPhysics(dt);
        // checkpoints
        const next = (G.cp + 1) * T.L / CPN;
        if (G.cp < CPN - 1 && st.dist >= next) {
          G.cp++;
          G.splits.push(G.time + G.penalty);
          AUDIO.checkpoint();
          G.say('CHECKPOINT ' + G.cp + '/' + (CPN - 1), 1.2, '#7fd8ff', fmt(G.time + G.penalty));
        }
        // derailment
        if (checkDerail()) {
          G.state = 'derailed'; G.derailT = 3.2; G.derails++;
          TRAIN.derail(st.s, st.v);
          AUDIO.crash();
          G.say('DERAILED!', 2.8, '#ff4a3a', G.derailWhy + '  (+5 s)');
          POST.flash = 0.6;
        }
        if (st.dist >= T.L) finish();
        return;
      }
      if (G.state === 'derailed') {
        TRAIN.updateDerail(dt);
        G.derailT -= dt;
        if (G.derailT <= 0) respawn();
        return;
      }
      if (G.state === 'done') {
        // emergency brakes on the station straight, whatever the zone
        const st2 = G.st;
        st2.v = Math.max(0, st2.v - 12 * dt);
        st2.brakeOn = st2.v > 0 ? 1 : 0; st2.motorOn = 0;
        st2.s = T.wrap(st2.s + st2.v * dt);
        G.gNow = T.gAt(T.carS(st2.s, 0), st2.v);
        return;
      }
    } else {
      stepPhysics(dt);
    }
  };

  function stepPhysics(dt) {
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < n; i++) T.step(G.st, dt / n, G.ctl);
    // felt g (worst car for the limits, front car for display)
    G.gNow = T.gAt(T.carS(G.st.s, 0), G.st.v);
  }

  function checkDerail() {
    const st = G.st, Lm = T.LIMITS;
    for (let c = 0; c < T.N_CARS; c++) {
      const g = T.gAt(T.carS(st.s, c), st.v);
      G.gPeak = Math.max(G.gPeak, g.vert);
      if (g.vert > Lm.vmax) { G.derailWhy = 'Riders blacked out: ' + g.vert.toFixed(1) + ' g'; return true; }
      if (g.vert < Lm.vmin) { G.derailWhy = 'Wheels lifted off the rails: ' + g.vert.toFixed(1) + ' g'; return true; }
      if (Math.abs(g.lat) > Lm.lat) { G.derailWhy = 'Thrown off sideways: ' + Math.abs(g.lat).toFixed(1) + ' g lateral'; return true; }
    }
    return false;
  }

  function respawn() {
    const st = G.st;
    const d = G.cp * T.L / CPN;
    st.s = T.wrap(T.sStop + d);
    st.dist = d;
    const cap = T.trainCap(st.s, 30);
    st.v = Math.max(3, Math.min(cap * 0.55, 12));
    G.penalty += 5;
    TRAIN.reset();
    G.state = 'run';
    G.say('GO!', 0.8, '#7dff6a');
  }

  function finish() {
    G.state = 'done';
    const total = G.time + G.penalty;
    G.final = total;
    G.newBest = G.best === null || total < G.best;
    if (G.newBest) { G.best = total; save(); }
    const m = G.medals;
    G.medal = total <= m.gold ? 'gold' : total <= m.silver ? 'silver' : total <= m.bronze ? 'bronze' : null;
    // Only celebrate: no sound at all for a run without medal or record.
    if (G.medal || G.newBest) AUDIO.fanfare();
    setTimeout(() => { if (G.mode === 'trial' && G.state === 'done') MENU.openResults(); }, 1600);
  }

  function fmt(t) {
    if (t === null || t === undefined) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }
  G.fmt = fmt;

  // ---------------- HUD ----------------
  let mini = null, miniBox = null;
  function buildMinimap() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of T.P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    miniBox = { x0, x1, z0, z1 };
  }
  function miniXY(p, W, H, pad) {
    const b = miniBox, sx = (W - pad * 2) / (b.x1 - b.x0), sz = (H - pad * 2) / (b.z1 - b.z0), s = Math.min(sx, sz);
    const ox = (W - (b.x1 - b.x0) * s) / 2, oz = (H - (b.z1 - b.z0) * s) / 2;
    return [ox + (p[0] - b.x0) * s, oz + (p[2] - b.z0) * s];
  }

  function panel(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(10,14,40,0.55)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke();
  }

  G.drawHud = function (ctx, W, H, camName) {
    ctx.clearRect(0, 0, W, H);
    if (G.mode === 'title' || MENU.open) return;
    const st = G.st, dpr = W / window.innerWidth;
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = W / dpr, h = H / dpr;
    const kmh = Math.abs(st.v) * 3.6;
    const trial = G.mode === 'trial';
    const cap = trial ? T.trainCap(st.s, 0) : 0;
    const risk = trial ? st.v / Math.max(cap, 0.1) : 0;
    const font = '"Bahnschrift", "Segoe UI", sans-serif';

    // speed gauge (bottom right)
    const cx = w - 120, cy = h - 105, R = 80;
    panel(ctx, cx - 105, cy - 95, 210, 180);
    const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, VM = 160;
    ctx.lineCap = 'round';
    ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(cx, cy, R - 10, a0, a1); ctx.stroke();
    if (trial) {
      // safe band
      const ac = a0 + (a1 - a0) * Math.min(1, cap * 3.6 / VM);
      ctx.strokeStyle = 'rgba(90,255,120,0.35)';
      ctx.beginPath(); ctx.arc(cx, cy, R - 10, a0, ac); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,70,50,0.45)';
      ctx.beginPath(); ctx.arc(cx, cy, R - 10, ac, a1); ctx.stroke();
    }
    const av = a0 + (a1 - a0) * Math.min(1, kmh / VM);
    const col = !trial ? '#ffb43a' : risk > 1 ? '#ff4030' : risk > 0.9 ? '#ffb020' : '#6aff7a';
    ctx.strokeStyle = col; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(cx, cy, R - 10, a0, av); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = 'bold 44px ' + font; ctx.fillText(kmh.toFixed(0), cx, cy + 8);
    ctx.font = '13px ' + font; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('km/h', cx, cy + 28);
    if (trial) {
      ctx.font = 'bold 13px ' + font; ctx.fillStyle = risk > 1 ? '#ff6050' : 'rgba(160,255,170,0.9)';
      ctx.fillText('SAFE ' + (cap * 3.6).toFixed(0), cx, cy + 52);
      // throttle / brake bars
      ctx.fillStyle = st.motorOn > 0 ? '#5ad1ff' : 'rgba(255,255,255,0.12)'; ctx.fillRect(cx - 95, cy + 65, 85, 6);
      ctx.fillStyle = st.brakeOn > 0 ? '#ff5a3a' : 'rgba(255,255,255,0.12)'; ctx.fillRect(cx + 10, cy + 65, 85, 6);
    }

    // g-meter (bottom left)
    const gx = 110, gy = h - 105;
    panel(ctx, gx - 95, gy - 95, 190, 180);
    const gs = 11;   // px per g
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(gx + k * gs * 2, gy - 75); ctx.lineTo(gx + k * gs * 2, gy + 65); ctx.stroke(); }
    // limits box: vertical from vmin..vmax (centered at 1 g), lateral +-lat
    const Lm = T.LIMITS;
    const gyOf = (v) => gy - 5 - (v - 2.5) * gs;
    ctx.strokeStyle = 'rgba(255,80,60,0.75)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(gx - Lm.lat * gs * 2, gyOf(Lm.vmax), Lm.lat * gs * 4, gyOf(Lm.vmin) - gyOf(Lm.vmax));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(gx - 40, gyOf(1)); ctx.lineTo(gx + 40, gyOf(1)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - 40, gyOf(0)); ctx.lineTo(gx + 40, gyOf(0)); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    const g = G.gNow;
    const dx = gx + UTIL.clamp(g.lat, -3, 3) * gs * 2, dy = gyOf(UTIL.clamp(g.vert, -2, 7));
    const gr = Math.max((g.vert - 1) / (Lm.vmax - 1), (1 - g.vert) / (1 - Lm.vmin), Math.abs(g.lat) / Lm.lat);
    ctx.fillStyle = gr > 0.85 ? '#ff4030' : gr > 0.6 ? '#ffb020' : '#6aff7a';
    ctx.beginPath(); ctx.arc(dx, dy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.font = 'bold 15px ' + font;
    ctx.fillText(g.vert.toFixed(1) + ' g', gx - 85, gy - 75);
    ctx.font = '12px ' + font; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('lat ' + g.lat.toFixed(1), gx - 85, gy - 59);
    ctx.textAlign = 'right';
    const p = T.P[T.idx(st.s)];
    ctx.fillText('alt ' + p[1].toFixed(0) + ' m', gx + 85, gy - 75);
    ctx.fillText(Math.round(st.dist % T.L) + ' / ' + Math.round(T.L) + ' m', gx + 85, gy - 59);

    // minimap (top right)
    const MW = 230, MH = 120, mx = w - MW - 16, my = 16;
    panel(ctx, mx, my, MW, MH);
    ctx.save(); ctx.translate(mx, my);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,140,120,0.9)'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < T.N; i += 8) { const q = miniXY(T.P[i], MW, MH, 12); if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]); }
    ctx.closePath(); ctx.stroke();
    if (trial) {
      for (let k = 1; k < CPN; k++) {
        const q = miniXY(T.P[T.idx(T.sStop + k * T.L / CPN)], MW, MH, 12);
        ctx.fillStyle = k <= G.cp ? '#7fd8ff' : 'rgba(255,255,255,0.5)';
        ctx.fillRect(q[0] - 3, q[1] - 3, 6, 6);
      }
      const q0 = miniXY(T.P[T.idx(T.sStop)], MW, MH, 12);
      ctx.fillStyle = '#fff'; ctx.fillRect(q0[0] - 1, q0[1] - 7, 3, 14);
    }
    const qt = miniXY(T.P[T.idx(st.s)], MW, MH, 12);
    ctx.fillStyle = '#ffd040'; ctx.beginPath(); ctx.arc(qt[0], qt[1], 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // camera name
    ctx.textAlign = 'left'; ctx.font = '12px ' + font; ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText('CAM: ' + camName.toUpperCase() + '   [C] change   [H] help', 18, 26);

    // trial timer
    if (trial) {
      panel(ctx, w / 2 - 130, 12, 260, 70);
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = 'bold 38px ' + font;
      ctx.fillText(fmt(G.time + G.penalty), w / 2, 52);
      ctx.font = '12px ' + font; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const m = G.medals;
      ctx.fillText('Gold ' + fmt(m.gold) + '  ·  Silver ' + fmt(m.silver) + '  ·  Bronze ' + fmt(m.bronze) + (G.penalty ? '   (+' + G.penalty + ' s)' : ''), w / 2, 72);
      if (G.state === 'run' && risk > 1) {
        if (Math.floor(performance.now() / 180) % 2 === 0) {
          ctx.font = 'bold 26px ' + font; ctx.fillStyle = '#ff4030';
          ctx.fillText('TOO FAST — BRAKE!', w / 2, h * 0.30);
        }
        if (!G.warnT || performance.now() - G.warnT > 300) { G.warnT = performance.now(); AUDIO.warn(); }
      }
      if (G.state === 'countdown' && G.cdown > 3) {
        ctx.font = 'bold 20px ' + font; ctx.fillStyle = '#fff';
        ctx.fillText('W / ↑ accelerate   ·   S / ↓ brake   ·   keep the speed under the SAFE mark', w / 2, h * 0.3);
      }
    } else {
      ctx.textAlign = 'center'; ctx.font = '13px ' + font; ctx.fillStyle = 'rgba(255,255,255,0.7)';
      const z = T.zoneAt(T.centerS(st.s));
      const info = z === T.Z.station ? (st.hold > 0 ? 'Boarding… departing in ' + Math.max(0, Math.ceil(st.dwell - st.hold)) + ' s  (Space to dispatch)' : 'Station') : z === T.Z.lift ? 'Lift hill' : '';
      if (info) { panel(ctx, w / 2 - 170, 14, 340, 32); ctx.fillStyle = '#fff'; ctx.fillText(info, w / 2, 35); }
    }

    // big message
    if (G.msg) {
      const m = G.msg, k = Math.min(1, m.t / 0.3), pop = 1 + Math.max(0, (m.t - m.dur + 0.15)) * 3;
      ctx.globalAlpha = k;
      ctx.textAlign = 'center';
      if (m.spr && m.spr.complete && m.spr.naturalWidth) {
        // Sprite rushes in from the left (its speed streaks trail behind it) and settles with a small overshoot.
        // Motion blur = a few ghost copies spread back along the path, weighted by the current speed.
        const IN = 0.28, age = m.dur - m.t, u = Math.min(1, age / IN);
        const pos = x => { const e = 1 - Math.pow(1 - x, 3); return (1 - e) * -(w * 0.55 + 200); };
        const sh = Math.min(h * 0.3, 260) * (m.text === 'GO!' ? 0.85 : 1), sw = sh * m.spr.naturalWidth / m.spr.naturalHeight;
        const x0 = pos(u), spd = u < 1 ? x0 - pos(Math.max(0, u - 0.05)) : 0;   // px moved per 0.05 of the entry (positive: moving right)
        const blur = Math.min(1, Math.abs(spd) / 40), n = 9, a0 = k;
        const settle = u < 1 ? 1 : 1 + Math.max(0, 0.08 * Math.sin((age - IN) / 0.25 * Math.PI)) * (age - IN < 0.25 ? 1 : 0);
        const dw = sw * settle, dh = sh * settle, cy = h * 0.38;
        if (blur > 0.02) {
          for (let i = n; i >= 1; i--) {
            ctx.globalAlpha = a0 * 0.5 * blur * (1 - i / (n + 1));
            ctx.drawImage(m.spr, w / 2 + x0 - spd * i / n * 1.6 - dw / 2, cy - dh / 2, dw, dh);
          }
        }
        ctx.globalAlpha = a0 * Math.min(1, u * 3);
        ctx.drawImage(m.spr, w / 2 + x0 - dw / 2, cy - dh / 2, dw, dh);
        ctx.globalAlpha = 1;
      } else {
      ctx.font = 'italic 900 ' + Math.round(64 * pop) + 'px ' + font;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(20,10,60,0.85)';
      ctx.strokeText(m.text, w / 2, h * 0.42);
      ctx.fillStyle = m.color; ctx.fillText(m.text, w / 2, h * 0.42);
      if (m.sub) { ctx.font = 'bold 20px ' + font; ctx.fillStyle = '#fff'; ctx.strokeText(m.sub, w / 2, h * 0.42 + 38); ctx.fillText(m.sub, w / 2, h * 0.42 + 38); }
      ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  };

  window.GAME = G;

  // ---------------- Menus ----------------
  const MENU = { open: false, sel: 0, kind: 'title', items: [] };
  window.MENU = MENU;
  const elMenu = () => document.getElementById('menu');
  const elRes = () => document.getElementById('results');

  // ---------------- Online leaderboard ----------------
  function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function boardTable(entries, me) {
    if (!entries.length) return '<p class="best">No times yet: be the first!</p>';
    const low = (me || '').toLowerCase();
    return '<table class="board">' + entries.map(e =>
      '<tr class="' + (e.name.toLowerCase() === low ? 'me' : '') + '"><td>' + e.rank + '</td><td>' + esc(e.name) +
      '<i>' + (e.derails ? e.derails + ' derailment' + (e.derails > 1 ? 's' : '') + ' (+' + (e.derails * 5) + ' s)' : 'clean lap') + '</i></td><td>' + fmt(e.time_ms / 1000) + '</td></tr>').join('') + '</table>';
  }
  function boardCard() {
    if (!ONLINE.cache && !ONLINE.error) {
      ONLINE.top().then(refreshBoardCard, refreshBoardCard);
      return '<h3>Leaderboard</h3><p>Loading…</p>';
    }
    if (!ONLINE.cache) return '<h3>Leaderboard</h3><p>Leaderboard unavailable: ' + esc(ONLINE.error) + '</p>';
    return '<h3>Leaderboard</h3>' + boardTable(ONLINE.cache.entries, ONLINE.getName()) +
      '<p class="best">Best time of each driver. Finish a time trial to submit yours.</p>';
  }
  function refreshBoardCard() {
    if (MENU.open && MENU.kind !== 'results' && MENU.items[MENU.sel] && MENU.items[MENU.sel].id === 'board') refresh();
  }

  // name field + submit button on the results screen
  function setupSubmit() {
    const input = document.getElementById('lbName'), btn = document.getElementById('lbSend');
    const msg = document.getElementById('lbMsg'), table = document.getElementById('lbTable');
    const run = { timeMs: Math.round(G.final * 1000), driveMs: Math.round(G.time * 1000), derails: G.derails };
    const show = (entries, me) => { table.innerHTML = boardTable(entries, me); };
    ONLINE.top().then(e => show(e, ONLINE.getName()), () => { msg.textContent = 'Leaderboard unavailable right now.'; });
    // typing must not drive the menu or the train (main.js ignores keys while an input has focus)
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    btn.addEventListener('click', send);
    let busy = false;
    async function send() {
      if (busy || btn.disabled) return;
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!ONLINE.validName(name)) { msg.textContent = 'Name: 2–16 letters, digits, spaces, _ . -'; return; }
      busy = true; btn.disabled = true; msg.textContent = 'Sending…';
      try {
        const res = await ONLINE.submit(Object.assign({ name }, run));
        ONLINE.setName(name);
        msg.innerHTML = 'Submitted! You are <b>#' + res.rank + '</b>' + (res.best < run.timeMs ? ' (your best: ' + fmt(res.best / 1000) + ')' : '') + '.';
        show(res.entries, name);
        input.disabled = true;
        AUDIO.ui('select');
      } catch (err) {
        msg.textContent = 'Not sent: ' + err.message;
        btn.disabled = false;
      }
      busy = false;
    }
  }

  function medalRow() {
    const m = G.medals;
    return `<div class="medals">
      <span class="md gold">● ${fmt(m.gold)}</span><span class="md silver">● ${fmt(m.silver)}</span><span class="md bronze">● ${fmt(m.bronze)}</span></div>
      <p class="best">Your best: <b>${fmt(G.best)}</b></p>`;
  }

  function itemsFor(kind) {
    const items = [];
    if (kind === 'pause') {
      items.push({ id: 'resume', label: 'Resume', info: 'Back to the ride.' });
      if (G.mode === 'trial') items.push({ id: 'retry', label: 'Restart Trial', info: 'Start the time trial again from the station.' });
    }
    items.push({ id: 'ride', label: 'Ride', info: '<h3>Free ride</h3><p>Sit back and enjoy the ride: station, lift hill, a 45 m first drop, an overbanked turn, airtime hill, vertical loop and helix.</p><p>Switch cameras with <b>C</b> (front seat, back seat, chase, side, trackside, orbit).</p>' });
    items.push({ id: 'trial', label: 'Time Trial', info: '<h3>Time trial</h3><p>You drive the train with linear motors and brakes. Complete the lap as fast as you can.</p><p>Go too fast and the train derails: too many g in the valleys and the loop, negative g over the hills, or lateral g in the turns. Each derailment costs 5 s.</p>' + medalRow() });
    if (ONLINE.enabled) items.push({ id: 'board', label: 'Leaderboard', info: boardCard });
    items.push({ id: 'controls', label: 'Controls', info: controlsHtml() });
    if (kind === 'pause') items.push({ id: 'title', label: 'Title Screen', info: 'Leave to the title screen.' });
    return items;
  }

  function controlsHtml() {
    return `<h3>Controls</h3><table class="keys">
      <tr><td>W / ↑</td><td>Accelerate (time trial)</td></tr>
      <tr><td>S / ↓</td><td>Brake (time trial)</td></tr>
      <tr><td>C · 1–6</td><td>Change camera</td></tr>
      <tr><td>Mouse drag</td><td>Look around / orbit</td></tr>
      <tr><td>Wheel</td><td>Zoom (orbit and chase)</td></tr>
      <tr><td>Space</td><td>Dispatch the train (free ride)</td></tr>
      <tr><td>R</td><td>Restart time trial</td></tr>
      <tr><td>Esc · P</td><td>Pause menu</td></tr>
      <tr><td>N</td><td>Sound on / off</td></tr>
      <tr><td>H</td><td>Help</td></tr></table>`;
  }

  MENU.show = function (kind) {
    MENU.kind = kind; MENU.open = true; MENU.sel = 0;
    G.paused = kind === 'pause';
    MENU.items = itemsFor(kind);
    const el = elMenu();
    el.className = 'show ' + kind;
    el.innerHTML = `<div class="mv-left">
        <img class="logo" src="img/logo.png" alt="Riemann's Rollercoaster">
        ${kind === 'pause' ? '<div class="ptitle">PAUSED</div>' : '<div class="tag">A steel coaster simulator</div>'}
        <div class="items">${MENU.items.map((it, i) => `<div class="item" data-i="${i}">${it.label}</div>`).join('')}</div>
        <div class="hint">↑↓ select · Enter confirm${kind === 'pause' ? ' · Esc resume' : ''}</div>
      </div><div class="mv-info"></div>`;
    el.querySelectorAll('.item').forEach(d => {
      d.addEventListener('mouseenter', () => { const i = +d.dataset.i; if (i !== MENU.sel) { MENU.sel = i; AUDIO.ui('move'); refresh(); } });
      d.addEventListener('click', () => { MENU.sel = +d.dataset.i; activate(); });
    });
    refresh();
  };

  function refresh() {
    const el = elMenu();
    el.querySelectorAll('.item').forEach((d, i) => d.classList.toggle('sel', i === MENU.sel));
    const info = MENU.items[MENU.sel].info;
    el.querySelector('.mv-info').innerHTML = typeof info === 'function' ? info() : info;
  }

  MENU.close = function () {
    MENU.open = false; G.paused = false;
    elMenu().className = '';
    elRes().className = '';
  };

  function activate() {
    const it = MENU.items[MENU.sel];
    AUDIO.start();
    AUDIO.ui(it.id === 'resume' ? 'back' : 'select');
    switch (it.id) {
      case 'resume': MENU.close(); break;
      case 'ride': MENU.close(); G.startRide(false); CAM.set(CAM.preferred()); break;
      case 'trial': case 'retry': MENU.close(); G.startTrial(); CAM.set(0); break;
      case 'title': MENU.close(); G.startRide(true); G.mode = 'title'; MENU.show('title'); break;
      case 'controls': case 'board': break;
      case 'again': MENU.close(); G.startTrial(); CAM.set(0); break;
      case 'free': MENU.close(); G.startRide(false); break;
      case 'menu': MENU.close(); G.startRide(true); G.mode = 'title'; MENU.show('title'); break;
    }
  }

  MENU.openResults = function () {
    MENU.kind = 'results'; MENU.open = true; MENU.sel = 0;
    MENU.items = [{ id: 'again', label: 'Retry' }, { id: 'free', label: 'Free Ride' }, { id: 'menu', label: 'Title Screen' }];
    const el = elRes();
    const medal = G.medal ? `<div class="medal ${G.medal}">${G.medal.toUpperCase()} MEDAL</div>` : '<div class="medal none">NO MEDAL</div>';
    el.className = 'show';
    el.innerHTML = `<div class="mv-left">
        <div class="ptitle">LAP COMPLETE</div>
        <div class="bigtime">${fmt(G.final)}</div>
        ${medal}
        <p class="sum">${G.newBest ? '<b class="nb">NEW RECORD!</b>' : 'Best: ' + fmt(G.best)}</p>
        <div class="items">${MENU.items.map((it, i) => `<div class="item" data-i="${i}">${it.label}</div>`).join('')}</div>
      </div><div class="mv-info">
        <h3>Lap details</h3>
        <table class="keys">
          <tr><td>Driving time</td><td>${fmt(G.time)}</td></tr>
          <tr><td>Derailments</td><td>${G.derails} (+${G.penalty} s)</td></tr>
          <tr><td>Peak vertical g</td><td>${G.gPeak.toFixed(1)} g</td></tr>
          ${G.splits.map((s, i) => `<tr><td>Checkpoint ${i + 1}</td><td>${fmt(s)}</td></tr>`).join('')}
        </table>${medalRow()}${ONLINE.enabled ? `
        <div class="online"><h3>Online leaderboard</h3>
          <div class="send"><input id="lbName" maxlength="16" placeholder="Your driver name" value="${esc(ONLINE.getName())}" autocomplete="nickname" spellcheck="false"><button id="lbSend">Submit</button></div>
          <p class="best" id="lbMsg"></p><div id="lbTable"></div></div>` : ''}</div>`;
    el.querySelectorAll('.item').forEach(d => {
      d.addEventListener('mouseenter', () => { MENU.sel = +d.dataset.i; refreshRes(); });
      d.addEventListener('click', () => { MENU.sel = +d.dataset.i; activate(); });
    });
    refreshRes();
    if (ONLINE.enabled) setupSubmit();
  };
  function refreshRes() { elRes().querySelectorAll('.item').forEach((d, i) => d.classList.toggle('sel', i === MENU.sel)); }

  MENU.key = function (e) {
    if (!MENU.open) return false;
    const k = e.key;
    const res = MENU.kind === 'results';
    if (k === 'ArrowUp' || (!res && (k === 'w' || k === 'W'))) { MENU.sel = (MENU.sel + MENU.items.length - 1) % MENU.items.length; AUDIO.ui('move'); res ? refreshRes() : refresh(); }
    else if (k === 'ArrowDown' || (!res && (k === 's' || k === 'S'))) { MENU.sel = (MENU.sel + 1) % MENU.items.length; AUDIO.ui('move'); res ? refreshRes() : refresh(); }
    else if (k === 'Enter' || (!res && k === ' ')) activate();
    else if ((k === 'Escape' || k === 'p' || k === 'P') && MENU.kind === 'pause') { AUDIO.ui('back'); MENU.close(); }
    else return k !== 'n' && k !== 'N' && k !== 'h' && k !== 'H' && !(res && /^[1-6cC]$/.test(k));
    return true;
  };
})();
