// User interface: title screen, HUD, side panels, decisions, camera input and the main loop.
'use strict';

const UI = (() => {
  const $ = id => document.getElementById(id);
  const SPEEDS = [0, 1, 3, 10, 30];
  const HOURS_PER_SEC = 1 / 1.5; // at 1x one game hour lasts 1.5 seconds
  let speed = 1, lastSpeed = 1, tab = 'bld', sel = null, running = false, hidden = false, menuOpen = false;
  let lastPanel = '', lastHud = 0, logCount = 0, bannerTimer = 0;
  let disasters = +(localStorage.getItem('day26.disasters') || 1);
  const S = () => SIM.S;

  // ---------- title ----------
  function showTitle() {
    running = false;
    $('game').hidden = true; $('title').hidden = false;
    $('btnContinue').hidden = !SIM.hasSave();
    closeModal();
    setSeg();
  }
  function setSeg() { for (const b of $('disSeg').children) b.classList.toggle('on', +b.dataset.v === disasters); }
  function start(cont) {
    SOUND.unlock(); MUSIC.unlock();
    if (!(cont && SIM.load())) SIM.newGame({ disasters });
    RENDER.reset();
    $('title').hidden = true; $('game').hidden = false;
    $('log').innerHTML = ''; logCount = 0;
    for (const e of S().log.slice(0, 120).reverse()) addLog(e);
    sel = null; RENDER.sel = null; tab = 'bld';
    setSpeed(1); running = true;
    fundShown = S().fund;
    fit(); renderPanel(true); hud(true);
    SOUND.play('bell');
  }

  // Animated sunset sky behind the logo.
  function titleSky() {
    const c = $('titlesky'), x = c.getContext('2d');
    const stars = Array.from({ length: 60 }, () => [Math.random() * 200, Math.random() * 80, Math.random() * 6]);
    const clouds = Array.from({ length: 5 }, () => [Math.random() * 220, 20 + Math.random() * 60, 16 + Math.random() * 20]);
    // A city skyline in two layers: a paler one far away, and a dark one in front with lit windows.
    function makeSkyline(near) {
      const list = [];
      let bx = -4;
      while (bx < 204) {
        const w = near ? U.irand(10, 24) : U.irand(8, 18), h = near ? U.irand(14, 40) : U.irand(30, 60);
        const roof = U.pick(near ? ['flat', 'antenna', 'water', 'pitched', 'stepped', 'chimney', 'dome', 'spire', 'flat', 'antenna'] : ['flat', 'antenna', 'dome', 'stepped', 'flat', 'spire']);
        const wins = [];
        if (near) for (let wy = 120 - h + 4; wy < 116; wy += 4) for (let wx = bx + 2; wx < bx + w - 2; wx += 3) if (Math.random() < 0.32) wins.push([wx, wy, Math.random()]);
        list.push({ x: bx, w, h, roof, wins });
        if (near && Math.random() < 0.25) list.push({ x: bx + w + 2, tree: true, r: U.irand(3, 5) });
        bx += w + (Math.random() < 0.3 ? U.irand(2, 6) : 0) + (list[list.length - 1].tree ? 9 : 0);
      }
      return list;
    }
    const far = makeSkyline(false), near = makeSkyline(true);
    function drawBuilding(b, col) {
      x.fillStyle = col;
      if (b.tree) { for (let dy = -b.r; dy <= b.r; dy++) { const w = Math.floor(Math.sqrt(b.r * b.r - dy * dy)); x.fillRect(b.x + 3 - w, 112 - b.r + dy, w * 2 + 1, 1); } x.fillRect(b.x + 3, 112, 1, 8); return; }
      const top = 120 - b.h, cx = b.x + (b.w >> 1);
      x.fillRect(b.x, top, b.w, b.h);
      switch (b.roof) {
        case 'antenna': x.fillRect(cx, top - 8, 1, 8); x.fillRect(cx - 2, top - 6, 5, 1); x.fillRect(cx - 1, top - 4, 3, 1); break;
        case 'water': x.fillRect(b.x + 2, top - 5, 6, 4); x.fillRect(b.x + 2, top - 1, 1, 1); x.fillRect(b.x + 7, top - 1, 1, 1); break;
        case 'pitched': for (let i = 0; i < b.w; i++) { const hh = Math.floor(Math.min(i, b.w - 1 - i) / 2); x.fillRect(b.x + i, top - hh, 1, hh); } break;
        case 'stepped': x.fillRect(b.x + 2, top - 5, b.w - 4, 5); x.fillRect(b.x + 4, top - 9, Math.max(2, b.w - 8), 4); break;
        case 'chimney': x.fillRect(b.x + 2, top - 5, 2, 5); x.fillRect(b.x + b.w - 5, top - 3, 2, 3); break;
        case 'dome': { const r = Math.min(5, (b.w >> 1) - 1); for (let dy = 0; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); x.fillRect(cx - w, top - dy, w * 2 + 1, 1); } x.fillRect(cx, top - r - 3, 1, 3); break; }
        case 'spire': x.fillRect(cx - 2, top - 10, 5, 10); x.fillRect(cx - 1, top - 14, 3, 4); x.fillRect(cx, top - 18, 1, 4); break;
      }
    }
    let t = 0;
    (function loop() {
      if (!$('title').hidden) {
        t += 0.016;
        for (let y = 0; y < 120; y += 4) { x.fillStyle = U.mix('#0b1030', '#f08050', Math.pow(y / 120, 1.6)); x.fillRect(0, y, 200, 4); }
        for (const s of stars) { x.fillStyle = 'rgba(255,255,220,' + (0.3 + 0.7 * (Math.sin(t * 2 + s[2]) + 1) / 2) * (1 - s[1] / 90) + ')'; x.fillRect(s[0] | 0, s[1] | 0, 1, 1); }
        for (const c2 of clouds) { c2[0] += 0.08; if (c2[0] > 210) c2[0] = -40; x.fillStyle = 'rgba(90,70,120,0.7)'; x.fillRect(c2[0] | 0, c2[1] | 0, c2[2] | 0, 3); x.fillRect((c2[0] + 3) | 0, (c2[1] - 2) | 0, (c2[2] - 8) | 0, 2); }
        for (const b of far) drawBuilding(b, '#4a3058');
        for (const b of near) {
          drawBuilding(b, '#1a1430');
          // Lit windows, each switching off now and then.
          if (b.wins) for (const [wx, wy, k] of b.wins) if (Math.sin(t * 0.4 + k * 60) > -0.85) { x.fillStyle = k < 0.5 ? '#f8d878' : '#e0a050'; x.fillRect(wx, wy, 1, 2); }
        }
      }
      requestAnimationFrame(loop);
    })();
  }

  // ---------- main loop ----------
  function loop(now) {
    requestAnimationFrame(loop);
    if (!running || !S()) return;
    const modalOpen = !$('modal').hidden;
    const sp = (hidden || modalOpen) ? 0 : SPEEDS[speed];
    if (sp && !S().over) {
      const dt = Math.min(0.1, (now - (loop.prev || now)) / 1000);
      SIM.advance(dt * sp * HOURS_PER_SEC);
    }
    loop.prev = now;
    RENDER.frame(now, sp);
    tickFund(now);
    if (now - lastHud > 250) { lastHud = now; hud(); renderPanel(); checkDecision(); }
  }
  function setSpeed(i) {
    if (i > 0) lastSpeed = i;
    speed = i;
    for (const b of $('speeds').children) b.classList.toggle('on', +b.dataset.s === i);
    $('pausedTag').hidden = i !== 0;
  }

  // ---------- HUD ----------
  // The fund counts toward its new value, green when it grows and red when it shrinks.
  let fundShown = 0, fundLast = 0;
  function tickFund(now) {
    const target = S().fund, dt = Math.min(0.1, (now - (fundLast || now)) / 1000);
    fundLast = now;
    const diff = target - fundShown;
    if (Math.abs(diff) < 1) fundShown = target;
    else fundShown += diff * Math.min(1, dt * 3) + Math.sign(diff) * Math.min(Math.abs(diff), 40 * dt);
    const el = $('fund');
    el.textContent = U.money(fundShown);
    el.classList.toggle('up', diff >= 1); el.classList.toggle('down', diff <= -1);
  }
  const WICON = { sunny: '☀ Sunny', cloudy: '☁ Cloudy', rain: '☂ Rain', storm: '⚡ Storm', snow: '❄ Snow', fog: '≋ Fog', heatwave: '☀ Heatwave' };
  function hud() {
    const s = S(); if (!s) return;
    const fest = SIM.festivity();
    $('dow').textContent = SIM.date().toLocaleDateString('en-GB', { weekday: 'long' }) + (fest ? ' · ' + SIM.FEST[fest].label : '');
    $('date').textContent = SIM.dateStr();
    const h = s.t % 24;
    $('clock').textContent = String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 4) * 15).padStart(2, '0');
    $('weather').textContent = WICON[s.weather.type] + ' ' + s.weather.temp + '°C';
    $('fund').classList.toggle('neg', s.fund < 0);
    $('pop').textContent = SIM.residents() + ' · ' + s.floors + (s.floors === 1 ? ' floor' : ' floors');
    const r = SIM.rating();
    $('rating').textContent = '★'.repeat(r) + '☆'.repeat(5 - r);
    $('repNum').textContent = Math.round(s.rep);
    $('repStat').title = SIM.repName() + ': rents ×' + SIM.repMul().toFixed(2) + ', loans at ' + (SIM.loanRate() * 100).toFixed(1) + '%';
    const debt = SIM.debt();
    $('debtLbl').textContent = debt > 0 ? 'Fund · debt ' + U.money(debt) : 'Fund';
    $('debtLbl').classList.toggle('neg', s.missed > 0);
    const g = SIM.goal();
    $('goal').innerHTML = g ? '<span class="gl">Goal ' + g.n + '/' + g.of + '</span> ' + U.esc(g.text) + ' <span class="gp">' + bar(g.v / g.max * 100, 'good') + (g.max > 1 ? '<small>' + (g.max >= 1000 ? U.money(g.v) + ' / ' + U.money(g.max) : g.v + '/' + g.max) + '</small>' : '') + '</span> <span class="gr">+' + U.money(g.reward) + '</span>'
      : '<span class="gl">All goals reached!</span> Via Roma 26 is the pride of the city.';
    $('zoomFit').hidden = RENDER.zoom <= 1.001;
    const nreq = s.requests.length, urgent = s.requests.some(r => r.deadline - SIM.day() <= 7);
    $('reqBadge').hidden = !nreq; $('reqBadge').textContent = nreq; $('reqBadge').classList.toggle('urgent', urgent);
    SOUND.setRain(s.weather.type === 'storm' ? 0.12 : s.weather.type === 'rain' ? 0.06 : 0);
  }

  // ---------- side panel ----------
  function bar(v, cls) { return '<span class="bar ' + (cls || '') + '"><i style="width:' + U.clamp(v, 0, 100).toFixed(0) + '%"></i></span>'; }
  function moodName(v) { return v >= 80 ? 'Delighted' : v >= 62 ? 'Happy' : v >= 45 ? 'Content' : v >= 28 ? 'Unhappy' : 'Miserable'; }
  function moodCls(v) { return v >= 62 ? 'good' : v >= 40 ? 'mid' : 'bad'; }
  function btn(label, act, arg, dis, cls) { return '<button class="btn small ' + (cls || '') + '" data-act="' + act + '" data-arg="' + (arg == null ? '' : arg) + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>'; }
  function buildList(u) {
    const s = S();
    let h = '';
    if (u.floor > 0) {
      h += '<h4>Build an apartment</h4><ul class="ups">';
      for (const k in SIM.SIZES) {
        if (k === 'penthouse' && u.floor !== s.floors) continue;
        const z = SIM.SIZES[k], c = SIM.buildCost(u, k);
        h += '<li><div><b>' + z.label + '</b><span>' + z.desc + ' Rent ' + U.money(z.rent) + '/month, up to ' + z.cap + ' people.</span></div>' + btn(U.money(c), 'build', u.id + ':' + k, s.fund < c) + '</li>';
      }
      h += '</ul>';
    }
    const where = u.floor === 0 ? 'ground' : 'upper';
    h += '<h4>' + (u.floor === 0 ? 'Open a shop' : 'Rent it to a business') + '</h4><ul class="ups">';
    for (const k in DATA.shops) {
      const d = DATA.shops[k];
      if (d.where !== where) continue;
      const c = SIM.buildCost(u, k);
      h += '<li><div><b>' + d.label + '</b><span>' + d.desc + ' Rent ' + U.money(d.rent) + '/month.</span></div>' + btn(U.money(c), 'build', u.id + ':' + k, s.fund < c) + '</li>';
    }
    h += '</ul><h4>Or a common space for everyone</h4><ul class="ups">';
    for (const k in DATA.commons) {
      const d = DATA.commons[k];
      if (d.where === 'ground' && u.floor !== 0) continue;
      const c = SIM.buildCost(u, k), dup = SIM.hasCommon(k);
      h += '<li><div><b>' + d.label + '</b><span>' + d.desc + ' No rent.</span></div>' + (dup ? '<span class="ok">Built</span>' : btn(U.money(c), 'build', u.id + ':' + k, s.fund < c)) + '</li>';
    }
    return h + '</ul>';
  }
  function panelUnit() {
    const s = S();
    if (!sel) return '<p class="hint">Click an apartment, a shop or an empty slot in the building.</p>' + residentsList();
    const u = SIM.unit(sel);
    if (!u) { sel = null; RENDER.sel = null; return panelBld(); }
    const where = u.floor === 0 ? 'Ground floor, ' + (u.side === 'A' ? 'west' : 'east') + ' side' : U.ordinal(u.floor) + ' floor, ' + (u.side === 'A' ? 'west' : 'east') + ' side';
    let h = '<div class="ahead"><h2>' + SIM.label3(u) + '</h2><span class="sub">' + where + '</span></div>';
    if (u.fire) return h + '<p class="warn">On fire! The firefighters are on their way.</p>';
    if (u.work) return h + '<p>Builders at work. Ready in ' + Math.max(1, Math.ceil(u.work - s.t)) + ' hours.</p>' + (u.shop ? '<p class="hint">Opening soon: ' + U.esc(u.shop.name) + ' (' + DATA.shops[u.shop.type].label.toLowerCase() + ').</p>' : '');
    if (u.sealed) return h + '<p>Sealed by the police until ' + SIM.dateStr(u.sealed) + '.</p>';
    if (u.burnt) return h + '<p>' + (u.ruin === 'quake' ? 'Collapsed in the earthquake.' : 'Gutted by fire.') + ' Rebuild it as you like, at 60% of the price.</p>' + buildList(u);
    if (u.kind === 'common') return h + '<h3>' + DATA.commons[u.common].label + '</h3><p>' + DATA.commons[u.common].desc + '</p><div class="actions">' + btn('Clear it out (' + U.money(500) + ')', 'demolish', u.id, s.fund < 500, 'danger') + '</div>';
    if (u.kind === 'empty') return h + '<p>' + (u.floor === 0 ? 'An empty shop space on the street. Open a business here and it will pay rent every week.' : 'An empty shell. Fit it out as an apartment or rent it to a business.') + '</p>' + buildList(u);
    if (u.kind === 'shop' && !u.shop) return h + '<p>A vacant shop. Refit it for a new business at half price, or wait for an entrepreneur to knock.</p>' + buildList(u);
    if (u.shop) {
      const sh = u.shop, d = DATA.shops[sh.type];
      h += '<div class="fam"><canvas class="portrait" id="portrait" width="12" height="20"></canvas><div><h3>' + U.esc(sh.name) + '</h3><span class="sub">' + d.label + ' · since ' + SIM.dateStr(sh.since) + '</span></div></div>';
      h += '<p>' + d.desc + '</p>';
      h += '<div class="row"><span>Trade</span>' + bar(sh.health, moodCls(sh.health)) + '<b>' + (sh.health >= 70 ? 'Booming' : sh.health >= 45 ? 'Steady' : sh.health >= 25 ? 'Slow' : 'Struggling') + '</b></div>';
      h += '<dl class="kv"><dt>Owner</dt><dd>' + U.esc(sh.owner.first) + ' (' + d.owner.toLowerCase() + ')</dd><dt>Rent</dt><dd>' + U.money(SIM.shopRent(u)) + '/month' + (sh.health <= 30 ? ' (half paid)' : '') + '</dd><dt>Hours</dt><dd>' + d.hours[0] + ':00-' + d.hours[1] + ':00</dd></dl>';
      if (sh.secret && sh.secret.sus) h += '<p class="secret">Odd things happen here ' + '●'.repeat(Math.min(5, sh.secret.sus)) + '</p>';
      const sr = s.requests.find(r => r.unit === u.id);
      if (sr) h += '<ul class="reqs">' + reqCard(sr) + '</ul>';
      return h + '<div class="actions">' + btn('End the lease', 'close', u.id, false, 'danger') + '</div>';
    }
    const f = SIM.famOf(u), z = SIM.SIZES[u.size];
    if (!f) {
      return h + '<p>' + z.label + ', empty for ' + u.emptyDays + ' day' + (u.emptyDays === 1 ? '' : 's') + '. Rent ' + U.money(SIM.rentOf(u)) + '/month. Empty apartments attract squatters.</p>'
        + btn('Find tenants (' + U.money(150) + ')', 'advertise', u.id, s.fund < 150 || s.pending.some(p => p.type === 'applicants'));
    }
    const inc = SIM.income(f), cost = SIM.monthlyCosts(f);
    h += '<div class="fam"><canvas class="portrait" id="portrait" width="' + Math.max(16, f.members.length * 10 + 2) + '" height="20"></canvas>'
      + '<div><h3>' + U.esc(SIM.Label(f)) + '</h3><span class="sub">' + z.label + ' · ' + (f.kind === 'squatter' ? 'squatters' : 'since ' + SIM.dateStr(Math.max(0, f.moveIn))) + '</span></div></div>';
    if (f.secret && f.secret.revealed) h += '<p class="secret">Truth: ' + U.esc(f.secret.truth) + '.</p>';
    else if (f.secret && f.secret.sus > 0) h += '<p class="secret">Neighbours whisper about strange goings-on ' + '●'.repeat(Math.min(5, f.secret.sus)) + '</p>';
    if (f.members.length > z.cap) h += '<p class="warn">Too many people for a ' + z.label.toLowerCase() + '.</p>';
    h += '<div class="row"><span>Mood</span>' + bar(f.happy, moodCls(f.happy)) + '<b>' + moodName(f.happy) + '</b></div>';
    if (f.kind !== 'squatter') {
      h += '<dl class="kv"><dt>Lifestyle</dt><dd>' + SIM.LIFESTYLES[f.ls] + '</dd><dt>Income</dt><dd>' + U.money(inc) + '/month</dd>'
        + '<dt>Spending</dt><dd>' + U.money(cost) + '/month</dd><dt>Rent</dt><dd class="' + (f.arrears ? 'neg' : '') + '">' + U.money(SIM.rentOf(u)) + (f.arrears ? ' · ' + f.arrears + ' week' + (f.arrears > 1 ? 's' : '') + ' late' : ' · paid') + '</dd>'
        + '<dt>Savings</dt><dd class="' + (f.savings < 0 ? 'neg' : '') + '">' + U.money(f.savings) + '</dd></dl>';
    }
    h += '<ul class="members">' + f.members.map(m => '<li><i style="background:' + m.shirt + '"></i>' + U.esc(m.first) + ', ' + m.age + ' <span>' + U.esc(m.job ? m.job.name : '') + '</span></li>').join('') + '</ul>';
    const chips = f.habits.map(k => '<span class="chip">' + DATA.habits[k].label + '</span>');
    if (f.pet) chips.push('<span class="chip">' + (f.pet === 'dog' ? 'Has a dog' : 'Has a cat') + '</span>');
    if (chips.length) h += '<div class="chips">' + chips.join('') + '</div>';
    const others = SIM.fams().filter(o => o !== f).map(o => ({ o, r: SIM.rel(f.id, o.id) })).sort((x, y) => y.r - x.r);
    const fit = SIM.fitFor(f, u.id);
    if (fit.length) h += '<h4>Next door, above and below</h4>' + fitList(fit);
    if (others.length) h += '<h4>Relations</h4><ul class="rels">' + others.map(({ o, r }) => '<li data-sel="' + o.apt + '"><b>' + o.apt + '</b> ' + U.esc(SIM.Label(o)) + '<span class="rel ' + (r >= 10 ? 'good' : r > -15 ? 'mid' : 'bad') + '">' + SIM.relName(r) + '</span></li>').join('') + '</ul>';
    const fr = s.requests.find(r => r.fam === f.id);
    if (fr) h = h.replace('</div></div>', '</div></div><ul class="reqs">' + reqCard(fr) + '</ul>');
    const free = SIM.freeApts();
    if (f.kind !== 'squatter' && free.length) {
      h += '<h4>Move them to another apartment (' + U.money(SIM.MOVE_COST) + ')</h4><div class="actions">' + free.map(o => {
        const z = SIM.SIZES[o.size];
        return btn(o.id + ' · ' + z.label + ' (' + z.cap + ')', 'move', f.id + ':' + o.id, s.fund < SIM.MOVE_COST, z.cap > SIM.SIZES[u.size].cap ? 'primary' : '');
      }).join('') + '</div>';
    }
    const ec = SIM.evictCost(f);
    h += '<div class="actions">' + btn(f.secret && !f.secret.revealed ? 'Knock and investigate' : 'Knock on the door', 'knock', f.id, f.knocked === SIM.day())
      + btn((f.kind === 'squatter' ? 'Call the police' : 'Evict') + ' (' + U.money(ec) + ')', 'evict', f.id, s.fund < ec, SIM.justified(f) ? '' : 'danger') + '</div>';
    if (!SIM.justified(f) && f.kind !== 'squatter') h += '<p class="hint">Evicting a family that pays its rent upsets everybody.</p>';
    return h;
  }
  // Who lives around a unit and why they would get along (or not).
  function fitList(fit) {
    return '<ul class="fit">' + fit.map(n => {
      const cls = n.c > 0 ? 'good' : n.c < 0 ? 'bad' : 'mid';
      const why = n.why.length ? n.why.map(w => '<span class="' + (w[0] === '+' ? 'pro' : 'con') + '">' + U.esc(w.slice(1)) + '</span>').join('') : '<span>no particular feelings</span>';
      return '<li class="' + cls + '"><b>' + (n.id[0] === 'G' ? 'G' + n.id[1] : n.id) + '</b><i>' + (n.c > 0 ? '+' + n.c : n.c) + '</i><div><em>' + U.esc(n.who) + '</em>' + why + '</div></li>';
    }).join('') + '</ul>';
  }
  function panelBld() {
    const s = S();
    let h = '<div class="ahead"><h2>Via Roma 26</h2><span class="sub">' + s.floors + ' floor' + (s.floors > 1 ? 's' : '') + ' above the shops</span></div>';
    const fc = SIM.floorCost();
    const block = SIM.floorBlock();
    if (s.floorWork) h += '<div class="buildbox"><b>Building the ' + U.ordinal(s.floors + 1) + ' floor</b> ' + bar((1 - (s.floorWork - s.t) / SIM.FLOOR_HOURS) * 100, 'good') + '</div>';
    else if (s.floors >= SIM.MAX_FLOORS) h += '<div class="buildbox"><b>The building is as tall as the city allows.</b></div>';
    else if (!s.permit && (!block || block.startsWith('You need'))) h += '<div class="buildbox"><div><b>Permit for the ' + U.ordinal(s.floors + 1) + ' floor</b><span>Every new floor needs a council permit. The better your reputation, the faster it comes. Building will then cost ' + U.money(fc) + '.</span></div>' + btn('Apply ' + U.money(500), 'permit', '', s.fund < 500, 'primary') + '</div>';
    else if (block && s.permit && s.permit.state !== 'granted') h += '<div class="buildbox"><div><b>Permit pending</b><span>' + block + '</span></div></div>';
    else if (block) h += '<div class="buildbox warnbox"><div><b>Cannot build the ' + U.ordinal(s.floors + 1) + ' floor</b><span>' + block + '</span></div></div>';
    else h += '<div class="buildbox"><div><b>Permit granted: build the ' + U.ordinal(s.floors + 1) + ' floor</b><span>Two empty shells to fit out. Takes a day and a half; the top floor will hear it.</span></div>' + btn(U.money(fc), 'floor', '', !SIM.canBuildFloor(), 'primary') + '</div>';
    if (s.floors + 1 >= 4 && !s.upgrades.lift) h += '<p class="hint">City rules: a lift is required from the 5th floor, a fire escape from the 7th.</p>';
    const empty = s.units.filter(u => (u.kind === 'empty' || (u.kind === 'shop' && !u.shop) || u.burnt) && !u.work);
    if (empty.length) h += '<p class="hint">' + empty.length + ' slot' + (empty.length > 1 ? 's' : '') + ' waiting to be built: ' + empty.map(u => '<a data-sel="' + u.id + '">' + SIM.label3(u) + '</a>').join(', ') + '.</p>';
    h += '<h4>Rents</h4><div class="seg wide">' + SIM.RENT_NAMES.map((v, i) => '<button data-act="rent" data-arg="' + i + '" class="' + (s.rentLevel === i ? 'on' : '') + '">' + v + ' ×' + SIM.RENT_MUL[i] + '</button>').join('') + '</div>';
    const homes = s.units.filter(u => u.fam).length, rentIn = s.units.reduce((a, u) => a + (u.fam && SIM.famOf(u).kind !== 'squatter' ? SIM.rentOf(u) : 0), 0) + SIM.shops().reduce((a, u) => a + SIM.shopRent(u), 0);
    h += '<dl class="kv"><dt>Monthly rents</dt><dd>' + U.money(rentIn) + '</dd><dt>Monthly costs</dt><dd>' + U.money(SIM.upkeep()) + '</dd><dt>Homes let</dt><dd>' + homes + '</dd><dt>Businesses</dt><dd>' + SIM.shops().length + '</dd></dl>';
    // The bank.
    const debt = SIM.debt(), limit = SIM.creditLimit();
    h += '<h4>Bank</h4><p class="hint">Rate ' + (SIM.loanRate() * 100).toFixed(1) + '% a year (lower with a better reputation), two years. Credit available: ' + U.money(Math.max(0, limit - debt)) + '. Four missed weekly payments and the bank takes the building.</p>';
    if (s.loans.length) h += '<ul class="ups">' + s.loans.map((l, i) => '<li><div><b>' + U.money(l.bal) + ' left</b><span>' + U.money(l.weekly) + ' a week · ' + l.weeks + ' weeks to go · ' + (l.rate * 100).toFixed(1) + '%</span></div>' + btn('Repay', 'repay', i, s.fund < l.bal) + '</li>').join('') + '</ul>';
    if (s.missed) h += '<p class="warn">Missed payments: ' + s.missed + ' of 4!</p>';
    h += '<div class="actions">' + SIM.LOANS.map(a => btn('Borrow ' + U.money(a) + ' (' + U.money(SIM.weeklyFor(a)) + '/wk)', 'borrow', a, debt + a > limit)).join('') + '</div>';
    if (s.racket && s.racket.state === 'paying') h += '<p class="secret">You pay ' + U.money(s.racket.weekly) + ' a week in protection money. If it comes out, it is a scandal.</p><div class="actions">' + btn('Stop paying', 'stopracket', '', false, 'danger') + '</div>';
    h += '<dl class="kv"><dt>Reputation</dt><dd>' + Math.round(s.rep) + ' · ' + SIM.repName() + '</dd><dt>Market rents</dt><dd>×' + SIM.repMul().toFixed(2) + '</dd><dt>Next inspection</dt><dd>in ' + Math.max(0, s.nextInspect - SIM.day()) + ' days</dd></dl>';
    // City news that affect the building.
    const city = [];
    if (s.city.metro) city.push('Metro station at the corner: rents +10%.');
    if (s.city.roadworks > SIM.day()) city.push('Roadworks in the street for ' + (s.city.roadworks - SIM.day()) + ' more days: ground-floor shops suffer.');
    if (s.city.mayorUntil > SIM.day()) city.push('A friendly mayor: permits twice as fast.');
    if (s.city.film > SIM.day()) city.push('A film crew is shooting in the building.');
    if (city.length) h += '<h4>City</h4><ul class="citynews">' + city.map(c => '<li>' + c + '</li>').join('') + '</ul>';
    // The look of the building.
    h += '<h4>Look of the building</h4>';
    for (const k in DATA.looks) {
      const d = DATA.looks[k];
      h += '<div class="lookrow"><span>' + d.label + ' <small>' + U.money(d.cost) + '</small></span><div class="swatches">' + d.opts.map((o, i) => {
        const on = s.look[k] === i, dis = !on && s.fund < d.cost;
        return o[1] ? '<button class="sw' + (on ? ' on' : '') + '" title="' + o[0] + '" style="background:' + o[1] + '" data-act="look" data-arg="' + k + ':' + i + '"' + (dis ? ' disabled' : '') + '></button>'
          : '<button class="swt' + (on ? ' on' : '') + '" data-act="look" data-arg="' + k + ':' + i + '"' + (dis ? ' disabled' : '') + '>' + o[0] + '</button>';
      }).join('') + '</div></div>';
    }
    h += '<h4>Staff</h4><ul class="ups">';
    for (const k in SIM.STAFF) {
      const st = SIM.STAFF[k];
      h += '<li><div><b>' + st.label + ' · ' + U.money(st.weekly) + '/week</b><span>' + st.desc + '</span></div>' + btn(s.staff[k] ? 'Dismiss' : 'Hire', 'hire', k, false, s.staff[k] ? 'danger' : '') + '</li>';
    }
    h += '</ul><h4>Events</h4>';
    if (s.event) {
      const e = SIM.EVENTS[s.event.type];
      h += '<div class="buildbox"><div><b>' + e.label + '</b><span>' + (s.event.started ? 'In progress now, in front of the building!' : 'Starts ' + (s.event.start - s.t < 24 - (s.t % 24) ? 'today' : 'tomorrow') + ' at ' + e.hour + ':00.') + '</span></div></div>';
    } else {
      const cool = SIM.eventCooldown() - (SIM.day() - s.lastEvent);
      if (cool > 0) h += '<p class="hint">The residents need a rest: next event in ' + cool + ' days.</p>';
      h += '<ul class="ups">' + Object.keys(SIM.EVENTS).map(k => { const e = SIM.EVENTS[k]; return '<li><div><b>' + e.label + '</b><span>' + e.desc + '</span></div>' + btn(U.money(e.cost), 'organize', k, cool > 0 || s.fund < e.cost || SIM.fams().length < 2) + '</li>'; }).join('') + '</ul>';
    }
    const wait = 30 - (SIM.day() - s.lastMeeting);
    h += '<div class="actions">' + btn(wait > 0 ? 'Meeting in ' + wait + ' days' : 'Call a residents\' meeting', 'meeting', '', wait > 0 || SIM.fams().length < 2) + '</div>';
    h += '<h4>Upgrades</h4><ul class="ups">';
    for (const k in SIM.UPGRADES) {
      const u = SIM.UPGRADES[k];
      h += '<li><div><b>' + u.label + '</b><span>' + u.desc + '</span></div>' + (s.upgrades[k] ? '<span class="ok">Installed</span>' : btn(U.money(u.cost), 'buy', k, s.fund < u.cost)) + '</li>';
    }
    h += '</ul>';
    const st = s.stats;
    h += '<h4>Since you took over</h4><dl class="kv stats"><dt>Days</dt><dd>' + SIM.day() + '</dd><dt>Rent earned</dt><dd>' + U.money(st.earned) + '</dd><dt>New tenants</dt><dd>' + st.welcomed + '</dd><dt>Moved out</dt><dd>' + st.left
      + '</dd><dt>Quarrels</dt><dd>' + st.quarrels + '</dd><dt>Kind deeds</dt><dd>' + st.friendships + '</dd><dt>Weddings</dt><dd>' + st.weddings + '</dd><dt>Births</dt><dd>' + st.births
      + '</dd><dt>Jackpots</dt><dd>' + st.lottery + '</dd><dt>Arrests</dt><dd>' + st.arrests + '</dd><dt>Disasters</dt><dd>' + st.disasters + '</dd><dt>Works done</dt><dd>' + st.built + '</dd></dl>';
    return h;
  }
  function residentsList() {
    const s = S();
    const list = s.units.slice().sort((a, b) => b.floor - a.floor || (a.side < b.side ? -1 : 1));
    return '<ul class="reslist">' + list.map(u => {
      const f = SIM.famOf(u);
      let who = '<em>Empty</em>', mood = '';
      if (u.work) who = '<em>Under construction</em>';
      else if (u.burnt) who = '<em>Ruined</em>';
      else if (u.sealed) who = '<em>Sealed</em>';
      else if (u.shop) { who = U.esc(u.shop.name) + ' <small>(' + DATA.shops[u.shop.type].label.toLowerCase() + ')</small>'; mood = bar(u.shop.health, moodCls(u.shop.health)); }
      else if (f) { who = U.esc(SIM.Label(f)) + ' <small>(' + f.members.length + ')</small>'; if (f.kind !== 'squatter') mood = bar(f.happy, moodCls(f.happy)); }
      else if (u.kind === 'apt') who = '<em>For rent</em>';
      else if (u.kind === 'common') who = '<em>' + DATA.commons[u.common].label + '</em>';
      else if (u.kind === 'empty') who = '<em>Empty shell — build here</em>';
      return '<li data-sel="' + u.id + '" class="' + (u.id === sel ? 'on' : '') + '"><b>' + (u.floor === 0 ? 'G' + u.side : u.id) + '</b><span class="who">' + who + '</span>' + mood + '</li>';
    }).join('') + '</ul>';
  }
  function reqCard(r) {
    const s = S(), left = r.deadline - SIM.day(), def = SIM.REQ[r.type];
    const f = r.fam && s.fams[r.fam], u = r.unit && SIM.unit(r.unit);
    const where = f ? f.apt : u ? SIM.label3(u) : 'All';
    const w = def.reward, rw = [];
    if (w.money) rw.push('+' + U.money(w.money));
    if (w.rep) rw.push('+' + w.rep + ' reputation');
    if (w.boost) rw.push(f ? 'much happier' : 'everyone happier');
    if (w.health) rw.push('better trade');
    let acts = '';
    if (def.cost !== undefined) acts = btn(def.cost ? 'Pay ' + U.money(def.cost) : 'Allow', 'fulfil', r.id, s.fund < def.cost, 'primary') + btn('Refuse', 'decline', r.id);
    else if (r.type === 'upgrade') acts = btn('Buy ' + SIM.UPGRADES[r.extra].label.toLowerCase() + ' (' + U.money(SIM.UPGRADES[r.extra].cost) + ')', 'buy', r.extra, s.fund < SIM.UPGRADES[r.extra].cost, 'primary');
    else if (r.type === 'shop') { const slot = s.units.find(x => !x.work && !x.burnt && ((x.kind === 'empty' && (x.floor === 0) === (DATA.shops[r.extra].where === 'ground')) || (x.kind === 'shop' && !x.shop))); if (slot) acts = '<button class="btn small primary" data-sel="' + slot.id + '">Go to ' + SIM.label3(slot) + '</button>'; }
    else if (r.type === 'stairs' && !s.upgrades.lift) acts = btn('Buy the lift (' + U.money(SIM.UPGRADES.lift.cost) + ')', 'buy', 'lift', s.fund < SIM.UPGRADES.lift.cost, 'primary') + '<button class="btn small" data-sel="' + f.apt + '">Move them…</button>';
    else if (f) acts = '<button class="btn small primary" data-sel="' + f.apt + '">Move them…</button>';
    const fail = def.fail ? 'If ignored: they move out.' : 'If ignored: disappointment.';
    return '<li class="req' + (left <= 7 ? ' urgent' : '') + '"><div class="rh"><b>' + where + '</b><span>' + (left <= 0 ? 'last day!' : left + ' day' + (left === 1 ? '' : 's') + ' left') + '</span></div><p>' + U.esc(r.text) + '</p>'
      + '<p class="rw">Reward: ' + (rw.join(', ') || 'gratitude') + '. <span>' + fail + '</span></p><div class="actions">' + acts + '</div></li>';
  }
  function panelReq() {
    const s = S();
    if (!s.requests.length) return '<p class="hint">No requests right now. Tenants and shopkeepers ask for things from time to time: fulfil them before the deadline for gratitude, money and reputation.</p>';
    return '<p class="hint">Fulfil requests before the deadline. Some are solved by doing something (moving a family, opening a shop, buying an upgrade), others by paying.</p><ul class="reqs">' + s.requests.slice().sort((a, b) => a.deadline - b.deadline).map(reqCard).join('') + '</ul>';
  }
  function renderPanel(force) {
    if (!S()) return;
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.tab === tab);
    const html = tab === 'apt' ? panelUnit() : tab === 'bld' ? panelBld() : tab === 'req' ? panelReq() : '<p class="hint">Everything at Via Roma 26, top to bottom.</p>' + residentsList();
    if (!force && html === lastPanel) return;
    if (!force && $('panel').matches(':active')) return;
    lastPanel = html;
    const scroll = $('panel').scrollTop;
    $('panel').innerHTML = html;
    $('panel').scrollTop = scroll;
    const pc = $('portrait');
    if (pc && sel) {
      const u = SIM.unit(sel), c = pc.getContext('2d');
      if (u && u.shop) RENDER.drawPerson(c, 2, 19, u.shop.owner, { face: 1 });
      else { const f = SIM.famOf(u); if (f) f.members.forEach((m, i) => RENDER.drawPerson(c, 1 + i * 10, 19, m, { face: 1 })); }
    }
  }
  function select(id) {
    sel = id; RENDER.sel = id; tab = 'apt';
    renderPanel(true);
    SOUND.play('click');
  }
  function onPanelClick(e) {
    const t = e.target.closest('[data-act],[data-sel]');
    if (!t || t.disabled) return;
    if (t.dataset.sel) return select(t.dataset.sel);
    const a = t.dataset.act, arg = t.dataset.arg;
    let ok = true;
    if (a === 'build') { const [id, what] = arg.split(':'); ok = SIM.build(id, what); }
    else if (a === 'floor') ok = SIM.buildFloor();
    else if (a === 'permit') ok = SIM.applyPermit();
    else if (a === 'borrow') ok = SIM.borrow(+arg);
    else if (a === 'repay') ok = SIM.repay(+arg);
    else if (a === 'stopracket') ok = SIM.stopRacket();
    else if (a === 'buy') ok = SIM.buy(arg);
    else if (a === 'rent') SIM.setRent(+arg);
    else if (a === 'meeting') ok = SIM.meeting();
    else if (a === 'advertise') ok = SIM.advertise(arg);
    else if (a === 'close') ok = SIM.closeBusiness(arg);
    else if (a === 'evict') ok = SIM.evict(+arg);
    else if (a === 'knock') ok = SIM.knock(+arg);
    else if (a === 'fulfil') ok = SIM.fulfil(+arg);
    else if (a === 'decline') ok = SIM.decline(+arg);
    else if (a === 'move') { const [fid, uid] = arg.split(':'); ok = SIM.relocate(+fid, uid); if (ok) select(uid); }
    else if (a === 'hire') ok = SIM.hire(arg);
    else if (a === 'look') { const [k, i] = arg.split(':'); ok = SIM.setLook(k, +i); }
    else if (a === 'demolish') ok = SIM.demolish(arg);
    else if (a === 'organize') ok = SIM.organize(arg);
    SIM.checkRequests();
    SOUND.play(ok === false ? 'angry' : 'click');
    renderPanel(true); hud(); checkDecision();
  }

  // ---------- news log ----------
  function addLog(e) {
    const li = document.createElement('li');
    li.className = 't-' + e.type;
    if (e.apt) li.dataset.sel = e.apt;
    li.innerHTML = '<span class="d">' + e.d.replace(/ \d{4}$/, '') + ' ' + String(e.h).padStart(2, '0') + ':00</span>' + U.esc(e.text);
    $('log').prepend(li);
    if (++logCount > 120) { $('log').lastChild.remove(); logCount--; }
  }

  // ---------- banner, modal, decisions ----------
  function banner(e) {
    const b = $('banner');
    b.textContent = e.text; b.className = 'banner show ' + (e.kind || '');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove('show'), 3500);
    if (e.kind === 'disaster') SOUND.play('alert');
  }
  function openModal(html, cls) {
    $('modalBox').innerHTML = html; $('modalBox').className = 'box ' + (cls || '');
    $('modal').hidden = false;
  }
  function closeModal() { $('modal').hidden = true; menuOpen = false; }
  function candCard(f, i, apt) {
    let note = '';
    if (f.kind === 'shady') note = U.pick(['Offers to pay six months in advance, in cash.', 'Asks if the cellar has a separate entrance.', 'Gives a different phone number every time.']);
    else if (f.kind === 'mysterious') note = U.pick(['Did not want to be photographed for the lease.', 'Only available for a viewing after midnight.', 'References: "classified".']);
    else if (f.habits.includes('party')) note = 'Previous landlord: "lively tenants".';
    else if (f.habits.includes('helpful')) note = 'Excellent references from the previous building.';
    else if (f.habits.includes('moaner')) note = 'Already asked about the noise rules three times.';
    note = note || U.pick(['Seems nice.', 'Polite and punctual at the viewing.', 'Brought a box of pastries to the viewing.', 'Asked lots of questions about the lift.']);
    return '<div class="cand"><canvas class="portrait big" data-cand="' + i + '" width="' + Math.max(16, f.members.length * 10 + 2) + '" height="20"></canvas><h3>' + U.esc(SIM.Label(f)) + '</h3>'
      + '<ul>' + f.members.map(m => '<li>' + U.esc(m.first) + ', ' + m.age + ' <span>' + U.esc(m.job.name) + '</span></li>').join('') + '</ul>'
      + '<p class="inc">Income ' + U.money(SIM.income(f)) + '/month</p>'
      + '<div class="chips">' + f.habits.map(k => '<span class="chip">' + DATA.habits[k].label + '</span>').join('') + '</div>'
      + '<p class="note">' + note + '</p>'
      + (apt ? (() => { const fit = SIM.fitFor(f, apt); const tot = fit.reduce((a, n) => a + n.c, 0); return fit.length ? '<p class="fitsum ' + (tot > 0 ? 'good' : tot < 0 ? 'bad' : '') + '">Neighbours: ' + (tot > 0 ? 'good match' : tot < 0 ? 'trouble ahead' : 'neutral') + '</p>' + fitList(fit) : ''; })() : '')
      + '<button class="btn primary" data-opt="' + i + '">Choose (' + (i + 1) + ')</button></div>';
  }
  function checkDecision() {
    if (!S() || S().over || !$('modal').hidden) return;
    const d = SIM.decision();
    if (!d) return;
    let html = '<h2>' + U.esc(d.title) + '</h2><p>' + U.esc(d.text) + '</p>';
    if (d.type === 'applicants') html += '<div class="cands">' + d.cands.map((f, i) => candCard(f, i, S().pending[0].ctx.apt)).join('') + '</div><div class="opts"><button class="btn" data-opt="' + d.cands.length + '">Not now</button></div>';
    else html += '<div class="opts">' + d.options.map((o, i) => '<button class="btn' + (i === 0 ? ' primary' : '') + '" data-opt="' + i + '">' + U.esc(o) + '</button>').join('') + '</div>';
    openModal(html, d.type === 'applicants' ? 'wide' : '');
    if (d.type === 'applicants') for (const c of $('modalBox').querySelectorAll('canvas[data-cand]')) {
      const f = d.cands[+c.dataset.cand], x = c.getContext('2d');
      f.members.forEach((m, i) => RENDER.drawPerson(x, 1 + i * 10, 19, m, { face: 1 }));
    }
    SOUND.play('alert');
  }
  function onModalClick(e) {
    const t = e.target.closest('button');
    if (!t) { if (e.target === $('modal') && menuOpen) closeModal(); return; }
    if (t.dataset.opt != null) { closeModal(); SIM.decide(+t.dataset.opt); renderPanel(true); hud(); setTimeout(checkDecision, 300); return; }
    const m = t.dataset.menu;
    if (m === 'resume') closeModal();
    else if (m === 'help') help(true);
    else if (m === 'title') { SIM.save(); showTitle(); }
    else if (m === 'again') { closeModal(); start(false); }
    else if (m === 'back') { if (S() && !S().over) menu(); else showTitle(); }
  }
  function menu() {
    menuOpen = true;
    openModal('<h2>Menu</h2><p>The game is saved automatically every day.</p><div class="opts col">'
      + '<button class="btn primary" data-menu="resume">Resume</button><button class="btn" data-menu="help">How to play</button><button class="btn" data-menu="title">Save and quit to title</button></div>');
  }
  function help(inGame) {
    menuOpen = true;
    openModal('<h2>How to play</h2><div class="help">'
      + '<p>Aunt Pina left you a tiny building in Via Roma: two apartments over two empty shop spaces. Rent it out, open shops, add floor after floor and watch life happen: families arrive and leave, fall in love and fight, win the lottery and lose their jobs.</p>'
      + '<ul><li><b>Click an empty slot</b> to fit out an apartment (studio, apartment or luxury flat) or open a business. Ground-floor spaces are for shops; upper floors can also host offices, a gym, a dentist and more.</li>'
      + '<li><b>Building tab</b>: add a new floor (up to ten), set the rents, call a residents\' meeting, buy upgrades like the lift or a rooftop pool.</li>'
      + '<li><b>Rent day</b> is every Monday: tenants and businesses pay, you pay taxes and cleaning. Tenants who cannot pay for two months are evicted.</li>'
      + '<li><b>Choose your tenants</b> carefully: read the notes, some applicants are not what they seem. Empty apartments attract squatters.</li>'
      + '<li>Shops make the residents happier and earn rent, but they can go bust. Follow the <b>goals</b> at the top for city grants.</li>'
      + '<li><b>Money is tight</b>: floors cost a lot. Borrow from the bank to grow faster, but the weekly payments come no matter what. Four missed payments and the bank takes the building.</li>'
      + '<li><b>Reputation</b> sets the rents the market pays, how fast and how respectable applicants are, the interest on loans and the permit times. Happy tenants, full flats and good shops raise it; squatters, scandals, ruins and feuds sink it.</li>'
      + '<li><b>Neighbours matter</b>: each applicant shows how they would get along with the people and shops next door, above and below. A party animal over an early bird, or a gym under a newborn, ends in a feud and people moving out.</li>'
      + '<li><b>The council</b>: every floor needs a permit; a lift is mandatory from the 5th floor, a fire escape from the 7th. Inspectors drop by and fine overcrowding, squatters and ruins. Bribes are faster but can blow up in your face months later.</li>'
      + '<li>Racketeers, lawsuits and noise complaints are decisions with consequences that come back later.</li>'
      + '<li><b>Requests</b>: tenants and shopkeepers ask for things with a deadline (a bigger home, a lift, a shop, a terrace...). Fulfil them for rewards, or they leave disappointed.</li>'
      + '<li><b>Make it yours</b>: repaint the facade, change roof and railings, rename the building. Use a slot for a laundry, a common room, a kids\' playroom or cellars: no rent, but the whole building benefits. Penthouses can only go on the top floor.</li>'
      + '<li><b>The calendar</b>: Christmas, Carnival, Easter, the summer football tournament, Ferragosto (half the building at the seaside) and Halloween; plus roadworks, a new metro station, film crews, TV interviews and elections.</li>'
      + '<li><b>Be active</b>: move families between apartments, hire a concierge, a cleaner or a night guard, and organise parties, markets and football tournaments in the street.</li>'
      + '<li>Rarely, disasters strike: fires, earthquakes, floods... and planes. You lose only if your debts pass ' + U.money(-10000) + '.</li></ul>'
      + '<p class="keys"><b>Wheel</b> zoom · <b>drag</b> to move when zoomed · <b>Space</b> pause · <b>1-4</b> speed · <b>F</b> add a floor · <b>B</b> building · <b>Q</b> requests · <b>R</b> people · <b>M</b> sound · <b>N</b> music · <b>Esc</b> menu</p></div>'
      + '<div class="opts"><button class="btn primary" data-menu="' + (inGame ? 'back' : 'resume') + '">OK</button></div>');
  }
  function gameOver(o) {
    setTimeout(() => {
      const st = S().stats;
      openModal('<h2>Game over</h2><p>' + U.esc(o.text) + '</p>'
        + '<dl class="kv stats"><dt>Days as owner</dt><dd>' + o.day + '</dd><dt>Rent earned</dt><dd>' + U.money(st.earned) + '</dd><dt>Families welcomed</dt><dd>' + st.welcomed + '</dd><dt>Families that left</dt><dd>' + st.left
        + '</dd><dt>Weddings</dt><dd>' + st.weddings + '</dd><dt>Babies</dt><dd>' + st.births + '</dd><dt>Works done</dt><dd>' + st.built + '</dd><dt>Disasters</dt><dd>' + st.disasters + '</dd></dl>'
        + '<div class="opts"><button class="btn primary" data-menu="again">New building</button><button class="btn" data-menu="back">Title screen</button></div>', 'over');
      SOUND.play('power');
    }, 1200);
  }

  // ---------- canvas size, pointer, zoom and pan ----------
  function fit() {
    const v = $('view'), cv = $('cv');
    const w = v.clientWidth, h = v.clientHeight;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    RENDER.resize(w, h);
  }
  function pos(e) { const r = $('cv').getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  let drag = null;
  function onDown(e) { drag = { x: e.clientX, y: e.clientY, moved: 0 }; $('cv').setPointerCapture(e.pointerId); }
  function onMove(e) {
    if (drag && e.buttons) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
      if (drag.moved > 6) { RENDER.pan(dx, dy); $('tip').hidden = true; $('cv').style.cursor = RENDER.zoom > 1.001 ? 'grabbing' : 'default'; return; }
    }
    const [x, y] = pos(e), id = RENDER.hit(x, y), tip = $('tip');
    RENDER.hover = id && id !== 'building' ? id : null;
    if (id && id !== 'building') {
      const u = SIM.unit(id), f = SIM.famOf(u);
      let t = SIM.label3(u) + ' · ';
      if (u.work) t += 'under construction';
      else if (u.burnt) t += 'ruined';
      else if (u.shop) t += u.shop.name + ' (' + DATA.shops[u.shop.type].label.toLowerCase() + ')';
      else if (f) t += SIM.Label(f) + (f.kind !== 'squatter' ? ' · ' + moodName(f.happy) : '');
      else if (u.kind === 'apt') t += 'for rent';
      else if (u.kind === 'common') t += DATA.commons[u.common].label.toLowerCase();
      else t += 'click to build';
      tip.textContent = t; tip.hidden = false;
      const vr = $('view').getBoundingClientRect();
      tip.style.left = Math.min(e.clientX - vr.left + 14, vr.width - tip.offsetWidth - 4) + 'px';
      tip.style.top = (e.clientY - vr.top + 14) + 'px';
      $('cv').style.cursor = 'pointer';
    } else { tip.hidden = true; $('cv').style.cursor = RENDER.zoom > 1.001 ? 'grab' : id ? 'pointer' : 'default'; }
  }
  function onUp(e) {
    const wasDrag = drag && drag.moved > 6;
    drag = null;
    if (wasDrag) return;
    SOUND.unlock();
    const [x, y] = pos(e), id = RENDER.hit(x, y);
    if (id === 'building') { tab = 'bld'; sel = null; RENDER.sel = null; renderPanel(true); SOUND.play('click'); }
    else if (id) select(id);
  }
  function onWheel(e) {
    e.preventDefault();
    const [x, y] = pos(e);
    RENDER.zoomAt(x, y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    hud();
  }

  // ---------- wiring ----------
  function init() {
    RENDER.init($('cv'));
    titleSky();
    $('btnNew').onclick = () => start(false);
    $('btnContinue').onclick = () => start(true);
    $('btnHelpTitle').onclick = () => help(false);
    $('disSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; disasters = +b.dataset.v; localStorage.setItem('day26.disasters', disasters); setSeg(); };
    $('speeds').onclick = e => { const b = e.target.closest('button'); if (b) { setSpeed(+b.dataset.s); SOUND.play('click'); } };
    $('btnSound').onclick = () => { SOUND.setMuted(!SOUND.muted); $('btnSound').classList.toggle('off', SOUND.muted); };
    $('btnSound').classList.toggle('off', SOUND.muted);
    $('btnMusic').onclick = () => $('btnMusic').classList.toggle('off', !MUSIC.toggle());
    $('btnMusic').classList.toggle('off', !MUSIC.enabled);
    $('btnMenu').onclick = menu;
    $('zoomFit').onclick = () => { RENDER.resetZoom(); hud(); };
    $('tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.tab; renderPanel(true); } };
    $('panel').onclick = onPanelClick;
    $('log').onclick = e => { const li = e.target.closest('li[data-sel]'); if (li) select(li.dataset.sel); };
    $('modal').onclick = onModalClick;
    const cv = $('cv');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointerleave', () => { $('tip').hidden = true; RENDER.hover = null; });
    cv.addEventListener('wheel', onWheel, { passive: false });
    new ResizeObserver(fit).observe($('view'));
    BUS.on('log', e => {
      if (!running) return;
      addLog(e);
      // A new request slows the game back to 1x, so it is not missed (a paused game stays paused).
      if (e.type === 'request' && speed > 1) setSpeed(1);
    });
    BUS.on('banner', banner);
    BUS.on('sound', n => SOUND.play(n));
    BUS.on('gameover', gameOver);
    document.addEventListener('keydown', e => {
      if ($('game').hidden) return;
      if (!$('modal').hidden) {
        if (e.key === 'Escape' && menuOpen) closeModal();
        const n = parseInt(e.key, 10), opt = $('modalBox').querySelector('[data-opt="' + (n - 1) + '"]');
        if (n && opt) opt.click();
        return;
      }
      if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : lastSpeed); }
      else if (e.key >= '1' && e.key <= '4') setSpeed(+e.key);
      else if (e.key === '0') { RENDER.resetZoom(); hud(); }
      else if (e.key === 'm' || e.key === 'M') $('btnSound').click();
      else if (e.key === 'n' || e.key === 'N') $('btnMusic').click();
      else if (e.key === 'b' || e.key === 'B') { tab = 'bld'; renderPanel(true); }
      else if (e.key === 'r' || e.key === 'R') { tab = 'res'; renderPanel(true); }
      else if (e.key === 'q' || e.key === 'Q') { tab = 'req'; renderPanel(true); }
      else if (e.key === 'f' || e.key === 'F') { tab = 'bld'; if (!(SIM.buildFloor() || SIM.applyPermit())) SOUND.play('angry'); renderPanel(true); }
      else if (e.key === 'Escape') menu();
    });
    document.addEventListener('visibilitychange', () => { hidden = document.hidden; MUSIC.suspend(hidden); if (hidden) SIM.save(); });
    window.addEventListener('pagehide', () => SIM.save());
    // The first click or tap anywhere (title screen included) starts the music.
    document.addEventListener('pointerdown', () => { SOUND.unlock(); MUSIC.unlock(); }, { once: true });
    showTitle();
    requestAnimationFrame(loop);
  }

  init();
  return { start, select, setSpeed, get tab() { return tab; } };
})();
