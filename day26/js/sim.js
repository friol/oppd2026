// Simulation core: the building you grow, its families and businesses, time, weather, money, events and disasters.
'use strict';

const SIM = (() => {
  const START = new Date(2026, 2, 1, 0, 0, 0); // the game starts on 1 March 2026
  const MAX_FLOORS = 10;
  const RENT_NAMES = ['Low', 'Normal', 'High'];
  const RENT_MUL = [0.85, 1, 1.2];
  const LIFESTYLES = ['Frugal', 'Modest', 'Comfortable', 'Lavish'];
  const LS_COST = [420, 650, 1000, 1600];
  const SIZES = {
    studio: { label: 'Studio', cost: 4000, rent: 450, cap: 2, desc: 'Small and cheap: singles, couples and students.' },
    flat: { label: 'Apartment', cost: 7000, rent: 750, cap: 5, desc: 'Bedroom, living room and kitchen, for any family.' },
    luxury: { label: 'Luxury flat', cost: 15000, rent: 1500, cap: 6, desc: 'Marble and chandeliers, for wealthy tenants only.' },
    penthouse: { label: 'Penthouse', cost: 20000, rent: 2300, cap: 6, desc: 'Top floor only: glass walls and a view over the city, for the very rich.' }
  };
  const UPGRADES = {
    lift: { label: 'Lift', cost: 9000, desc: 'Without it, tenants above the 3rd floor (and the elderly above the 1st) are unhappy.' },
    solar: { label: 'Solar panels', cost: 12000, desc: 'Lower bills for everybody, and a greener conscience.' },
    cameras: { label: 'CCTV cameras', cost: 3000, desc: 'Fewer burglaries and squatters; shady tenants get noticed sooner.' },
    rod: { label: 'Lightning rod', cost: 2000, desc: 'Lightning no longer starts fires or blackouts.' },
    garden: { label: 'Roof garden', cost: 4500, desc: 'Residents are happier and get along better.' },
    pool: { label: 'Rooftop pool', cost: 18000, desc: 'Everyone is happier, wealthy tenants most of all.' },
    escape: { label: 'Fire escape', cost: 6000, desc: 'Required by law to build above the 6th floor. Inspectors check it.' }
  };
  const LOANS = [10000, 25000, 50000], LOAN_WEEKS = 104, SHOP_COST = 1.3;
  const STAFF = {
    concierge: { label: 'Concierge', weekly: 180, desc: 'Applicants arrive sooner, parcels get collected, small complaints are settled before they reach you.' },
    cleaner: { label: 'Cleaner', weekly: 110, desc: 'Spotless stairs: everyone is a bit happier and the building looks respectable.' },
    guard: { label: 'Night guard', weekly: 230, desc: 'No squatters, far fewer burglaries, and racketeers think twice.' }
  };
  const EVENTS = {
    party: { label: 'Courtyard party', cost: 800, hour: 19, hours: 5, desc: 'Music, food and dancing in front of the building. Neighbours bond, but old feuds may flare up.' },
    market: { label: 'Street market', cost: 500, hour: 9, hours: 8, desc: 'Stalls on the pavement: the shops sell more and the stall fees pay you back.' },
    football: { label: 'Five-a-side tournament', cost: 400, hour: 16, hours: 3, desc: 'The residents play football in the street. Fitness fans and kids love it.' }
  };
  const MOVE_COST = 200;
  const FLOOR_HOURS = 36, FIT_HOURS = 16;
  // Disaster multipliers for the three settings, and the plane crash odds per day.
  const DIS = [0.4, 1, 4];
  const PLANE = [1 / 150000, 1 / 50000, 1 / 700];

  let S = null;

  // ---------- small helpers ----------
  const day = () => Math.floor(S.t / 24);
  const hour = () => Math.floor(S.t % 24);
  const date = (d = day()) => { const x = new Date(START); x.setDate(x.getDate() + d); return x; };
  const month = () => date().getMonth() + 1;
  const dow = () => date().getDay(); // 0 = Sunday
  const dateStr = (d) => date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const isNight = (h = S.t % 24) => h >= 21 || h < 6.5;
  const season = () => { const m = month(); return m === 12 || m <= 2 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'; };
  const dis = () => DIS[S.settings.disasters];

  const fams = () => Object.values(S.fams);
  const unit = (id) => S.units.find(u => u.id === id);
  const famOf = (u) => u && u.fam ? S.fams[u.fam] : null;
  const unitOf = (f) => unit(f.apt);
  const residents = () => fams().reduce((n, f) => n + f.members.length, 0);
  const adults = (f) => f.members.filter(m => m.age >= 18);
  const kids = (f) => f.members.filter(m => m.age < 18);
  const has = (f, h) => f.habits.includes(h);
  const income = (f) => f.members.reduce((s, m) => s + (m.job ? m.job.inc : 0), 0);
  const shops = () => S.units.filter(u => u.kind === 'shop' && u.shop && !u.work && !u.burnt);
  const hasShop = (type) => shops().some(u => u.shop.type === type);
  const apts = () => S.units.filter(u => u.kind === 'apt');
  const floorCost = () => 10000 + 4000 * S.floors;
  const label3 = (u) => u.floor === 0 ? 'Ground ' + u.side : u.id;

  function label(f) {
    if (f.kind === 'squatter') return 'the squatters';
    if (f.group) return f.members[0].first + ' ' + f.name + ' & roommates';
    if (f.members.length === 1) return f.members[0].first + ' ' + f.name;
    return 'the ' + f.name + ' family';
  }
  const Label = (f) => U.cap(label(f));
  const shopName = (u) => u.shop ? u.shop.name : '';

  function log(text, type = 'info', apt = null) {
    const e = { id: ++S.logId, d: dateStr(), h: hour(), text, type, apt };
    S.log.unshift(e);
    if (S.log.length > 250) S.log.length = 250;
    BUS.emit('log', e);
  }
  const fx = (apt, icon) => BUS.emit('fx', { apt, icon });
  // Speech bubbles over the residents, staged scenes, and money flying out of the homes.
  const say = (apt, text, delay = 0) => { if (apt) BUS.emit('say', { apt, text, delay }); };
  const scene = (type, data) => BUS.emit('scene', { type, ...data });
  const money = (apt, amount) => BUS.emit('money', { apt, amount });
  const sound = (name) => BUS.emit('sound', name);
  const vehicle = (type, hours, apt) => BUS.emit('vehicle', { type, hours, apt });
  const banner = (text, kind) => BUS.emit('banner', { text, kind });
  const ask = (type, ctx) => { S.pending.push({ type, ctx }); BUS.emit('decision'); };

  // ---------- relations ----------
  const rk = (a, b) => a < b ? a + '|' + b : b + '|' + a;
  const rel = (a, b) => S.rel[rk(a, b)] || 0;
  function addRel(a, b, d) { const k = rk(a, b); S.rel[k] = U.clamp((S.rel[k] || 0) + d, -100, 100); }
  function relName(v) {
    return v >= 75 ? 'Best friends' : v >= 35 ? 'Friends' : v >= 10 ? 'Friendly' : v > -15 ? 'Neutral' : v > -45 ? 'Tense' : v > -70 ? 'Hostile' : 'Feud';
  }
  // Compatibility of two households, with the reasons (the UI uses them to explain good and bad neighbours).
  function compatDetail(a, b) {
    let c = 0;
    const why = [];
    const L = k => DATA.habits[k].label.toLowerCase();
    for (const h of a.habits) {
      const d = DATA.habits[h];
      for (const g of b.habits) {
        if (d.bad && d.bad.includes(g)) { c--; why.push('-' + L(h) + ' vs ' + L(g)); }
        if (d.good && d.good.includes(g)) { c++; why.push('+both ' + L(h)); }
      }
    }
    for (const h of b.habits) { const d = DATA.habits[h]; for (const g of a.habits) if (d.bad && d.bad.includes(g)) { c--; why.push('-' + L(g) + ' vs ' + L(h)); } }
    const elder = f => f.members.some(m => m.age >= 70);
    if ((elder(a) && has(b, 'party')) || (elder(b) && has(a, 'party'))) { c--; why.push('-party animal vs the elderly'); }
    if ((kids(a).length && has(b, 'smoker')) || (kids(b).length && has(a, 'smoker'))) { c--; why.push('-smoker vs children'); }
    const baby = f => kids(f).some(m => m.age < 2), noisy = f => has(f, 'party') || has(f, 'music');
    if ((baby(a) && noisy(b)) || (baby(b) && noisy(a))) { c--; why.push('-noise vs a newborn'); }
    if (has(a, 'helpful') || has(b, 'helpful')) { c++; why.push('+helpful neighbour'); }
    if (kids(a).length && kids(b).length) { c++; why.push('+the children play together'); }
    if (a.kind === 'squatter' || b.kind === 'squatter') { c -= 2; why.push('-squatters'); }
    return { c, why: Array.from(new Set(why)) };
  }
  const compat = (a, b) => compatDetail(a, b).c;
  // How a household feels about a business next door, above or below.
  const SHOPMOOD = {
    gym: { bad: ['early', 'neat', 'moaner'], baby: -2, elder: -1, good: ['sporty'] }, dentist: { bad: ['moaner', 'early'] },
    pizzeria: { bad: ['neat'], good: ['cook', 'party'] }, daycare: { bad: ['moaner', 'neat', 'owl'], kids: 2 },
    cafe: { good: ['gossip', 'early'] }, bakery: { good: ['early', 'cook'], bad: ['owl'] }, yoga: { good: ['sporty', 'neat'], bad: ['party'] },
    gelateria: { kids: 1 }, bnb: { bad: ['neat', 'early', 'moaner'], good: ['party'] }, coworking: { good: ['gamer'] }, barber: { good: ['gossip'] }, grocery: { good: ['cook'] }, pharmacy: { elder: 2 }, florist: { good: ['garden'] },
    detective: { bad: ['gossip'] }, lawyer: { good: ['moaner'] }
  };
  function shopCompat(f, type) {
    const m = SHOPMOOD[type] || {}, why = [], name = DATA.shops[type].label.toLowerCase();
    let c = 0;
    for (const h of f.habits) {
      if ((m.bad || []).includes(h)) { c--; why.push('-' + DATA.habits[h].label.toLowerCase() + ' vs the ' + name); }
      if ((m.good || []).includes(h)) { c++; why.push('+' + DATA.habits[h].label.toLowerCase() + ' likes the ' + name); }
    }
    if (m.baby && kids(f).some(k => k.age < 3)) { c += m.baby; why.push('-the ' + name + ' wakes the baby'); }
    if (m.elder && f.members.some(k => k.age >= 70)) { c += m.elder; why.push((m.elder > 0 ? '+' : '-') + 'the ' + name + (m.elder > 0 ? ' helps' : ' bothers') + ' the elderly'); }
    if (m.kids && kids(f).length) { c += m.kids; why.push('+the ' + name + ' for the kids'); }
    return { c, why };
  }
  // Units touching each other: same floor, or directly above or below.
  function adjacent(u) { return S.units.filter(o => o !== u && (o.floor === u.floor || (o.side === u.side && Math.abs(o.floor - u.floor) === 1))); }
  // What a household would think of the neighbours of a unit (applicants' cards and the unit panel).
  function fitFor(f, id) {
    const u = unit(id), out = [];
    for (const n of adjacent(u)) {
      const o = famOf(n);
      if (o && o !== f) { const d = compatDetail(f, o); out.push({ id: n.id, who: label(o), c: d.c, why: d.why }); }
      else if (n.shop && !n.work && !n.burnt) { const d = shopCompat(f, n.shop.type); out.push({ id: n.id, who: n.shop.name, c: d.c, why: d.why }); }
    }
    return out;
  }
  function neighbours(u) {
    return S.units.filter(o => o !== u && o.floor > 0 && (o.floor === u.floor || (o.side === u.side && Math.abs(o.floor - u.floor) === 1)));
  }

  // ---------- reputation and the bank ----------
  function repHit(d) { S.rep = U.clamp(S.rep + d, 0, 100); }
  function repTarget() {
    const aptList = apts().filter(u => !u.work && !u.burnt);
    const occ = aptList.length ? aptList.filter(u => u.fam && famOf(u).kind !== 'squatter').length / aptList.length : 0;
    let t = avgHappy() * 0.6 + occ * 15 + Math.min(12, shops().reduce((a, u) => a + u.shop.health / 25, 0));
    if (fams().some(f => f.kind === 'squatter')) t -= 12;
    t -= S.units.filter(u => u.burnt).length * 4 + S.units.filter(u => u.sealed).length * 4;
    t += [3, 0, -5][S.rentLevel];
    if (S.staff.concierge) t += 3;
    if (S.staff.cleaner) t += 2;
    if (S.staff.guard) t += 1;
    if (S.upgrades.garden) t += 3;
    if (S.upgrades.pool) t += 4;
    if (S.upgrades.cameras) t += 2;
    if (S.racket && S.racket.state === 'paying') t -= 3;
    return U.clamp(t, 0, 100);
  }
  const repMul = () => 0.75 + S.rep / 200; // what the market pays, from 75% to 125%
  const repName = () => S.rep >= 85 ? 'Prestigious' : S.rep >= 65 ? 'Respected' : S.rep >= 45 ? 'Ordinary' : S.rep >= 25 ? 'Shabby' : 'Notorious';
  const loanRate = () => 0.04 + (100 - S.rep) * 0.0012; // yearly interest
  const debt = () => S.loans.reduce((a, l) => a + l.bal, 0);
  const creditLimit = () => Math.round((12000 + S.floors * 12000 + shops().length * 4000) * (0.5 + S.rep / 100) / 1000) * 1000;
  function weeklyFor(amount) { const r = loanRate() / 52; return Math.round(amount * r / (1 - Math.pow(1 + r, -LOAN_WEEKS))); }
  function borrow(amount) {
    if (debt() + amount > creditLimit()) return false;
    const weekly = weeklyFor(amount);
    S.loans.push({ amount, bal: amount, weekly, rate: loanRate(), weeks: LOAN_WEEKS });
    S.fund += amount; S.stats.loans = (S.stats.loans || 0) + 1;
    log('The bank lent you ' + U.money(amount) + ' at ' + (loanRate() * 100).toFixed(1) + '%: ' + U.money(weekly) + ' a week for two years.', 'money');
    sound('coin');
    return true;
  }
  function repay(i) {
    const l = S.loans[i];
    if (!l || S.fund < l.bal) return false;
    S.fund -= l.bal; S.loans.splice(i, 1);
    log('You paid off a loan early. The bank manager looks disappointed.', 'money');
    checkGoal();
    return true;
  }
  function loanTick() {
    if (!S.loans.length) return;
    let missed = false;
    for (const l of S.loans) {
      l.bal *= 1 + l.rate / 52;
      const due = Math.min(l.weekly, Math.round(l.bal));
      if (S.fund >= due) { S.fund -= due; l.bal -= due; l.weeks--; }
      else { missed = true; l.bal *= 1.02; }
    }
    S.loans = S.loans.filter(l => l.bal > 1);
    if (missed) {
      S.missed = (S.missed || 0) + 1; repHit(-4);
      banner('Missed loan payment! (' + S.missed + '/4)', 'bad');
      log('You could not pay the bank this week: late fees added. After four missed payments in a row the bank takes the building.', 'bad');
      if (S.missed >= 4) gameOver('bank', 'The bank foreclosed on Via Roma 26 after four missed payments.');
    } else {
      S.missed = 0;
      if (!S.loans.length) { log('All loans paid off. The bank sends you a calendar as a gift.', 'good'); checkGoal(); }
    }
  }

  // ---------- generation ----------
  let mid = 0;
  const round10 = v => Math.round(v / 10) * 10;
  function genJob(age, flavor) {
    if (age < 3) return { name: 'Toddler', inc: 0 };
    if (age < 6) return { name: 'Nursery school', inc: 0 };
    if (age < 19) return { name: 'Pupil', inc: 0, school: true };
    if (flavor === 'rich') { const j = U.pick(DATA.richJobs); return { name: j[0], inc: round10(U.irand(j[1], j[2])) }; }
    if (age < 26 && U.chance(0.5)) return { name: 'University student', inc: U.irand(500, 800) };
    if (age >= 67) return { name: 'Retired', inc: round10(U.irand(900, 2200)), retired: true };
    if (flavor === 'strange' || U.chance(0.07)) {
      const j = U.pick(DATA.strange);
      return { name: j[0], inc: round10(U.irand(j[1], j[2])), night: !!j[3], strange: true, quip: j[4] };
    }
    if (U.chance(0.07)) return { name: 'Unemployed', inc: 400, jobless: true };
    const j = U.pick(DATA.jobs);
    return { name: j[0], inc: round10(U.irand(j[1], j[2])), night: !!j[3] };
  }
  // Appearance: colours plus a few details for the bigger sprites.
  function genLook(m) {
    const elder = m.age >= 62;
    m.skin = U.pick(DATA.skins);
    m.hair = elder ? U.pick(['#d8d8d8', '#b0b0b0', '#f0f0f0', '#9a9a9a']) : U.pick(DATA.hairs);
    m.shirt = U.pick(DATA.shirts); m.pants = U.pick(DATA.pants);
    m.shoes = U.pick(['#2a1a14', '#3a3a40', '#6a3a20', '#f0f0f0', '#a02020']);
    const st = m.sex === 'f' ? ['long', 'bun', 'ponytail', 'curly', 'short'] : ['short', 'short', 'curly', 'bald', 'long'];
    m.style = elder && m.sex === 'm' && U.chance(0.5) ? 'bald' : U.pick(st);
    m.beard = m.sex === 'm' && m.age >= 18 && U.chance(0.3);
    m.glasses = (m.age >= 50 && U.chance(0.55)) || U.chance(0.12);
    m.dress = m.sex === 'f' && m.age >= 3 && U.chance(0.35);
    return m;
  }
  function genMember(age, sex, flavor) {
    sex = sex || (U.chance(0.5) ? 'm' : 'f');
    const m = { id: ++mid + '_' + Math.floor(Math.random() * 1e6), first: U.pick(sex === 'm' ? DATA.male : DATA.female), age, sex, job: genJob(age, flavor) };
    return genLook(m);
  }
  function lifestyleFor(f, size) {
    const rent = SIZES[size || 'flat'].rent;
    const per = (income(f) - rent) / Math.max(1, adults(f).length + kids(f).length * 0.5);
    return per < 650 ? 0 : per < 1200 ? 1 : per < 2200 ? 2 : 3;
  }
  function freeSurname() { return U.pick(DATA.surnames.filter(n => !fams().some(o => o.name.split('-').includes(n)))); }
  // kind: 'normal' | 'mysterious' | 'shady' | 'squatter'; size: the apartment it is meant for.
  function genFamily(kind, size = 'flat') {
    // A bad reputation attracts dubious tenants; a good one, respectable ones.
    const shady = U.clamp(0.09 + (50 - (S.rep || 50)) * 0.004, 0.02, 0.3);
    const rich = size === 'luxury' || size === 'penthouse';
    if (!kind) kind = rich ? (U.chance(0.1) ? 'mysterious' : 'normal') : U.chance(0.07) ? 'mysterious' : U.chance(shady) ? 'shady' : 'normal';
    const f = {
      id: ++S.nextId, kind, name: freeSurname(), members: [], habits: [], ls: 1, apt: null,
      wall: U.pick(DATA.walls), accent: U.pick(DATA.accents), sofa: U.pick(DATA.accents), happy: U.irand(60, 76), boost: 0,
      savings: 0, arrears: 0, moveIn: 0, unhappyDays: 0, pet: null, party: 0, secret: null, seed: Math.random()
    };
    const adultAge = () => U.irand(23, 62);
    const flavor = rich ? 'rich' : U.chance(0.18) ? 'strange' : null;
    if (kind === 'mysterious') {
      const m = genMember(U.irand(30, 70));
      m.job = { name: U.pick(DATA.covers), inc: U.irand(30, 90) * 100, night: true };
      m.shirt = '#2a2a34'; m.pants = '#1a1a22'; m.glasses = true;
      f.members.push(m);
      f.secret = { kind: 'mystery', ...U.pick(DATA.mysteries), sus: 0, revealed: false, asked: false };
      f.wall = '#4a4058';
    } else if (kind === 'shady') {
      const s = U.pick(DATA.shady);
      const m = genMember(U.irand(28, 55));
      m.job = { name: s.cover, inc: U.irand(35, 80) * 100, night: true };
      f.members.push(m);
      if (size !== 'studio' && U.chance(0.4)) f.members.push(genMember(U.irand(25, 50), m.sex === 'm' ? 'f' : 'm'));
      f.secret = { kind: 'shady', ...s, sus: 0, revealed: false, offered: false, bribed: false };
      f.habits.push(U.pick(['owl', 'smoker', 'party', 'neat']));
    } else if (kind === 'squatter') {
      f.name = 'Squatters';
      for (let i = U.irand(2, 4); i > 0; i--) {
        const m = genMember(U.irand(18, 40));
        m.job = { name: U.pick(['None', 'Street juggler', 'Busker', 'Odd jobs']), inc: 0 };
        m.shirt = U.pick(['#5a5040', '#6a3a3a', '#3a4a3a']);
        f.members.push(m);
      }
      f.habits = U.shuffle(['party', 'music', 'smoker', 'dog', 'owl']).slice(0, 2);
      f.wall = '#9a9080'; f.happy = 55;
    } else {
      // Household types allowed by the size of the apartment.
      const types = size === 'studio' ? [['single', 5], ['couple', 3], ['students', 2], ['elder', 1]]
        : rich ? [['single', 2], ['couple', 3], ['family', 4]]
          : [['single', 2], ['couple', 2.5], ['family', 3.5], ['parent', 1], ['elder', 1.2], ['students', 0.6]];
      let r = Math.random() * types.reduce((a, t) => a + t[1], 0), type = 'single';
      for (const t of types) { r -= t[1]; if (r <= 0) { type = t[0]; break; } }
      if (type === 'single') f.members.push(genMember(adultAge(), null, flavor));
      else if (type === 'couple') { const a = genMember(adultAge(), null, flavor); f.members.push(a, genMember(U.clamp(a.age + U.irand(-6, 6), 20, 70), a.sex === 'm' ? 'f' : 'm')); }
      else if (type === 'family') {
        const a = genMember(U.irand(28, 50), null, flavor);
        f.members.push(a, genMember(U.clamp(a.age + U.irand(-5, 5), 24, 55), a.sex === 'm' ? 'f' : 'm'));
        for (let i = U.irand(1, 3); i > 0; i--) f.members.push(genMember(U.irand(0, Math.min(17, a.age - 20))));
      } else if (type === 'parent') {
        const a = genMember(U.irand(26, 50), null, flavor);
        f.members.push(a);
        for (let i = U.irand(1, 2); i > 0; i--) f.members.push(genMember(U.irand(1, Math.min(17, a.age - 20))));
      } else if (type === 'elder') {
        const a = genMember(U.irand(67, 86));
        f.members.push(a);
        if (size !== 'studio' && U.chance(0.55)) f.members.push(genMember(U.clamp(a.age + U.irand(-4, 4), 66, 90), a.sex === 'm' ? 'f' : 'm'));
      } else {
        f.group = true;
        for (let i = size === 'studio' ? 2 : U.irand(2, 3); i > 0; i--) { const m = genMember(U.irand(19, 25)); m.job = { name: 'University student', inc: U.irand(550, 800) }; f.members.push(m); }
      }
      const hn = U.chance(0.25) ? 1 : U.chance(0.6) ? 2 : 3;
      f.habits = U.shuffle(Object.keys(DATA.habits)).slice(0, hn);
      if (f.members.some(m => m.age >= 70)) f.habits = f.habits.filter(h => h !== 'party' && h !== 'gamer');
      if (f.group && !f.habits.includes('party') && U.chance(0.6)) f.habits.push('party');
    }
    if (kind === 'normal' && (S.rep || 50) < 35 && U.chance(0.5)) { const a = f.members.find(m => m.age >= 18 && !m.job.retired); if (a) a.job = { name: 'Unemployed', inc: 400, jobless: true }; }
    if (has(f, 'dog')) f.pet = 'dog';
    else if (has(f, 'cat')) f.pet = 'cat';
    f.ls = kind === 'squatter' ? 0 : lifestyleFor(f, size);
    if (rich && kind !== 'squatter') f.ls = Math.max(2, f.ls);
    f.savings = kind === 'squatter' ? 0 : round10(income(f) * U.rand(1, 5));
    return f;
  }
  function genShop(type, opts = {}) {
    const d = DATA.shops[type];
    const owner = genMember(U.irand(24, 62));
    owner.job = { name: d.owner, inc: 0 };
    const used = S.units.filter(u => u.shop).map(u => u.shop.name), names = d.names.filter(n => !used.includes(n));
    return { type, name: U.pick(names.length ? names : d.names), owner, health: U.irand(55, 80), discount: !!opts.discount, secret: opts.secret || null, since: day() };
  }

  // ---------- new game, save, load ----------
  function newUnit(floor, side) { return { id: (floor === 0 ? 'G' : floor) + side, floor, side, kind: 'empty', size: null, shop: null, fam: null, emptyDays: 0, askAgain: 0, fire: 0, burnt: false, sealed: 0, work: 0, seed: Math.random() }; }
  function newGame(settings) {
    mid = 0;
    S = {
      v: 5, t: 7, fund: 9000, look: { facade: 0, roof: 0, rail: 0, name: 0 }, city: {}, fest: null, staff: {}, event: null, lastEvent: -99, requests: [], reqId: 0, rep: 50, loans: [], missed: 0, permit: null, later: [], racket: null, nextInspect: 50, rentLevel: 1, floors: 1, floorWork: 0, logId: 0, nextId: 0, settings: { disasters: 1, ...settings },
      units: [], fams: {}, rel: {}, log: [], pending: [], upgrades: {}, weather: { type: 'sunny', temp: 14 },
      lastMeeting: -99, over: null, blackout: 0, flood: 0, goal: 0,
      stats: { welcomed: 0, left: 0, quarrels: 0, friendships: 0, weddings: 0, births: 0, lottery: 0, disasters: 0, arrests: 0, built: 0, earned: 0 }
    };
    for (const fl of [0, 1]) for (const s of ['A', 'B']) S.units.push(newUnit(fl, s));
    unit('1A').kind = 'apt'; unit('1A').size = 'flat';
    unit('1B').kind = 'apt'; unit('1B').size = 'flat';
    const f = genFamily('normal', 'flat');
    moveIn(f, unit('1A'), true);
    f.moveIn = -U.irand(30, 900);
    unit('1B').emptyDays = 1;
    newWeather(true);
    log('You inherited a small building at Via Roma 26 from your aunt Pina. Make it grow!', 'good');
    log('Click the empty slots on the ground floor to open a shop, or add floors from the Building tab.', 'info');
    save();
    return S;
  }
  function save() { try { if (S && !S.over) localStorage.setItem('day26.save', JSON.stringify(S)); } catch (e) { } }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem('day26.save'));
      if (s && s.v === 5 && !s.over) { S = s; S.pending = S.pending || []; S.crashing = false; return true; }
    } catch (e) { }
    return false;
  }
  const hasSave = () => { try { const s = JSON.parse(localStorage.getItem('day26.save')); return !!(s && s.v === 5 && !s.over); } catch (e) { return false; } };
  function clearSave() { localStorage.removeItem('day26.save'); }

  // ---------- moving in and out ----------
  function moveIn(f, u, quiet) {
    f.apt = u.id; f.moveIn = day();
    u.fam = f.id; u.emptyDays = 0;
    S.fams[f.id] = f;
    for (const o of fams()) if (o !== f) {
      const near = neighbours(u).some(n => n.fam === o.id) ? 1.5 : 1;
      S.rel[rk(f.id, o.id)] = U.clamp(Math.round(compat(f, o) * 10 * near + U.irand(-12, 15)), -60, 60);
    }
    if (!quiet) {
      S.stats.welcomed++;
      if (f.kind === 'squatter') return;
      log(Label(f) + ' moved into apartment ' + u.id + '. Welcome!', 'good', u.id);
      say(u.id, 'Home sweet home!', 2);
      vehicle('van', 4, u.id); fx(u.id, 'heart'); sound('doorbell');
    }
  }
  function moveOut(f, why, type = 'info', opts = {}) {
    const u = unitOf(f);
    if (u) { u.fam = null; u.emptyDays = 0; u.askAgain = 0; }
    delete S.fams[f.id];
    for (const k of Object.keys(S.rel)) if (k.split('|').includes(String(f.id))) delete S.rel[k];
    if (why) log(why, type, u && u.id);
    if (why && u && f.kind !== 'squatter') say(u.id, U.pick(['Goodbye, everyone!', 'Farewell!', 'Never again!', 'Ciao!']));
    if (!opts.noVan && f.kind !== 'squatter') vehicle('van', 4, u && u.id);
    if (f.kind !== 'squatter') S.stats.left++;
  }

  // ---------- money ----------
  const cityMul = () => S.city && S.city.metro ? 1.1 : 1;
  const rentOf = (u) => Math.round(SIZES[u.size || 'flat'].rent * RENT_MUL[S.rentLevel] * repMul() * cityMul() / 10) * 10;
  const shopRent = (u) => Math.round(DATA.shops[u.shop.type].rent * (u.shop.discount ? 0.7 : 1) * RENT_MUL[S.rentLevel] * repMul() / 10) * 10;
  function monthlyCosts(f) {
    if (f.kind === 'squatter') return 0;
    const n = adults(f).length + kids(f).length * 0.5;
    let util = 100 + f.members.length * 28;
    const s = season();
    if (s === 'winter') util += 130;
    if (s === 'summer' && f.ls >= 2) util += 60;
    if (S.upgrades.solar) util *= 0.65;
    return Math.round(LS_COST[f.ls] * n + util + rentOf(unitOf(f)));
  }
  function upkeep() {
    const built = S.units.filter(u => u.kind !== 'empty').length;
    return Math.round((150 + built * 60 + S.floors * 40 + (S.upgrades.lift ? 120 : 0) + (S.upgrades.pool ? 250 : 0) + (S.upgrades.cameras ? 40 : 0)) / 10) * 10;
  }
  const WK = 12 / 52; // months to weeks
  function weekTick() {
    let rent = 0;
    const late = [];
    for (const f of fams()) {
      if (f.kind === 'squatter') continue;
      const r = rentOf(unitOf(f)) * WK;
      f.savings += income(f) * WK;
      if (f.savings >= r) { rent += r; f.arrears = 0; money(f.apt, r); } else { f.arrears++; late.push(f); money(f.apt, 0); }
      f.savings -= monthlyCosts(f) * WK;
      if (f.savings < 0) f.boost -= 3;
    }
    let shopIn = 0;
    for (const u of shops()) { const r = shopRent(u) * WK * (u.shop.health > 30 ? 1 : 0.5); shopIn += r; money(u.id, r); }
    if (hasCommon('storage')) rent += fams().filter(f => f.kind !== 'squatter').length * 15;
    const cost = upkeep() * WK, wages = staffCost();
    S.fund += rent + shopIn - cost - wages;
    money(null, -(cost + wages));
    if (S.racket && S.racket.state === 'paying') {
      S.fund -= S.racket.weekly;
      if (U.chance(0.03)) {
        log('A journalist found out you pay protection money. The police arrested the gang, and the papers had a field day with you.', 'bad');
        repHit(-12); S.fund -= 2000; S.racket = { state: 'gone', until: day() + 400 }; banner('SCANDAL: protection money!', 'bad');
      }
    }
    loanTick();
    S.stats.earned += rent + shopIn;
    log('Rent day: ' + U.money(rent) + ' from tenants' + (shopIn ? ', ' + U.money(shopIn) + ' from businesses' : '') + '. Taxes, cleaning and insurance: ' + U.money(cost) + (wages ? ', staff ' + U.money(wages) : '') + '.', 'money');
    sound('coin');
    for (const f of late) {
      if (f.arrears >= 8) moveOut(f, Label(f) + ' were evicted after two months of unpaid rent.', 'bad');
      else if (f.arrears === 1 || f.arrears % 3 === 0) log(Label(f) + ' could not pay the rent this week (' + f.arrears + ' late).', 'bad', f.apt);
    }
  }
  function monthTick() {
    for (const f of fams()) {
      if (f.kind === 'squatter') continue;
      if (f.savings < 0 && f.ls > 0 && U.chance(0.6)) { f.ls--; log(Label(f) + ' are tightening their belts: lifestyle now ' + LIFESTYLES[f.ls].toLowerCase() + '.', 'bad', f.apt); }
      else if (f.savings > income(f) * 8 && f.ls < 3 && U.chance(0.25)) { f.ls++; log(Label(f) + ' upgraded their lifestyle: new furniture is arriving.', 'money', f.apt); vehicle('van', 3, f.apt); }
    }
  }

  // ---------- weather ----------
  const WEATHER = {
    winter: [['sunny', 3], ['cloudy', 3], ['rain', 1.5], ['snow', 1.5], ['fog', 1]],
    spring: [['sunny', 4], ['cloudy', 2.5], ['rain', 2.5], ['storm', 0.7], ['fog', 0.3]],
    summer: [['sunny', 5.5], ['cloudy', 1], ['heatwave', 2], ['storm', 1.2], ['rain', 0.3]],
    autumn: [['sunny', 2.5], ['cloudy', 3], ['rain', 3], ['storm', 0.8], ['fog', 0.7]]
  };
  const TEMPS = { winter: [-3, 9], spring: [10, 22], summer: [24, 33], autumn: [8, 20] };
  function newWeather(first) {
    const s = season(), list = WEATHER[s];
    let type;
    if (!first && U.chance(0.45) && list.some(w => w[0] === S.weather.type)) type = S.weather.type;
    else {
      let r = Math.random() * list.reduce((a, w) => a + w[1], 0);
      for (const w of list) { r -= w[1]; if (r <= 0) { type = w[0]; break; } }
      type = type || 'sunny';
    }
    if (type === 'heatwave' && month() < 7) type = 'sunny';
    let temp = U.irand(TEMPS[s][0], TEMPS[s][1]);
    if (type === 'heatwave') temp = U.irand(35, 41);
    if (type === 'snow') temp = Math.min(temp, U.irand(-4, 1));
    if (type === 'storm' || type === 'rain') temp -= 2;
    const prev = S.weather.type;
    S.weather = { type, temp };
    if (!first && type !== prev) {
      if (type === 'storm') log('A storm is rolling in. Batten down the hatches!', 'bad');
      else if (type === 'snow') log('It is snowing! The courtyard is white.', 'info');
      else if (type === 'heatwave') log('Heatwave: ' + temp + '°C. Air conditioners are humming everywhere.', 'bad');
    }
  }

  // ---------- happiness ----------
  function shopBonus(f) {
    let b = 0;
    const small = kids(f).some(m => m.age < 7), elder = f.members.some(m => m.age >= 65);
    for (const u of shops()) {
      const t = u.shop.type;
      b += DATA.shops[t].bonus;
      if (t === 'pharmacy' && elder) b += 4;
      if (t === 'daycare' && small) b += 6;
      if (t === 'gym' && has(f, 'sporty')) b += 4;
      if (t === 'florist' && has(f, 'garden')) b += 3;
      if (t === 'gelateria' && season() === 'summer') b += 2;
      if (t === 'pizzeria' && has(f, 'neat')) b -= 3;
    }
    return Math.min(10, b);
  }
  function happyTarget(f) {
    if (f.kind === 'squatter') return 55;
    const u = unitOf(f);
    let h = 52;
    const ns = neighbours(u).map(famOf).filter(Boolean);
    if (ns.length) h += ns.reduce((s, o) => s + rel(f.id, o.id), 0) / ns.length * 0.3;
    for (const n of adjacent(u)) if (n.shop && !n.work && !n.burnt) h += shopCompat(f, n.shop.type).c * 4;
    if (f.savings < 0) h -= 15; else if (f.savings > income(f) * 6) h += 5;
    h += [-3, 0, 3, 6][f.ls];
    h += { sunny: 3, cloudy: 0, rain: -1, storm: -3, snow: 1, fog: -1, heatwave: -5 }[S.weather.type] || 0;
    h += shopBonus(f);
    if (f.members.length > SIZES[u.size].cap) h -= 10;
    if (!S.upgrades.lift) { if (u.floor >= 4) h -= (u.floor - 3) * 4; if (u.floor >= 2 && f.members.some(m => m.age >= 70)) h -= 6; }
    if (fams().some(o => o.kind === 'squatter')) h -= 4;
    if (S.floorWork) h -= u.floor === S.floors ? 6 : 2;
    if (neighbours(u).some(n => n.work)) h -= 4;
    if (S.upgrades.garden) h += 4;
    if (S.staff.cleaner) h += 3;
    if (hasCommon('laundry')) h += 2 + (kids(f).length ? 2 : 0);
    if (hasCommon('playroom') && kids(f).length) h += 6;
    if (hasCommon('storage')) h += 1;
    if (hasCommon('commonroom')) h += 2;
    if (S.upgrades.solar) h += 2;
    if (S.upgrades.pool) h += u.size === 'luxury' || u.size === 'penthouse' ? 7 : 3;
    h += [4, 0, S.rep >= 70 ? -2 : -7][S.rentLevel];
    if (f.warned > day()) h -= 4;
    return U.clamp(h, 0, 100);
  }
  function avgHappy() { const l = fams().filter(f => f.kind !== 'squatter'); return l.length ? l.reduce((a, f) => a + f.happy, 0) / l.length : 60; }
  function rating() { return U.clamp(Math.round(S.rep / 20), 0, 5); }

  // ---------- goals ----------
  const occupied = () => apts().filter(u => u.fam && famOf(u).kind !== 'squatter').length;
  const GOALS = [
    { text: 'Rent out both apartments', reward: 800, prog: () => [occupied(), 2] },
    { text: 'Open your first shop', reward: 1000, prog: () => [shops().length, 1] },
    { text: 'Add a second floor', reward: 1500, prog: () => [S.floors, 2] },
    { text: 'House 10 residents', reward: 2000, prog: () => [residents(), 10] },
    { text: 'Run three businesses', reward: 2500, prog: () => [shops().length, 3] },
    { text: 'Reach a reputation of 65', reward: 2500, prog: () => [Math.floor(S.rep), 65] },
    { text: 'Build a luxury flat', reward: 2500, prog: () => [apts().filter(u => (u.size === 'luxury' || u.size === 'penthouse') && !u.work).length, 1] },
    { text: 'Install a lift', reward: 1500, prog: () => [S.upgrades.lift ? 1 : 0, 1] },
    { text: 'Reach five floors', reward: 5000, prog: () => [S.floors, 5] },
    { text: 'Celebrate a wedding in the building', reward: 2500, prog: () => [S.stats.weddings, 1] },
    { text: 'House 30 residents', reward: 5000, prog: () => [residents(), 30] },
    { text: 'Take a loan and pay it all back', reward: 4000, prog: () => [(S.stats.loans || 0) > 0 && !S.loans.length ? 1 : 0, 1] },
    { text: 'Reach seven floors', reward: 8000, prog: () => [S.floors, 7] },
    { text: 'Have €100,000 free of debt', reward: 10000, prog: () => [Math.max(0, Math.floor(S.fund - debt())), 100000] },
    { text: 'Reach the top: ten floors', reward: 15000, prog: () => [S.floors, 10] },
    { text: 'Reach a reputation of 90', reward: 20000, prog: () => [Math.floor(S.rep), 90] }
  ];
  function goal() { const g = GOALS[S.goal]; if (!g) return null; const [v, max] = g.prog(); return { text: g.text, reward: g.reward, v: Math.min(v, max), max, n: S.goal + 1, of: GOALS.length }; }
  function checkGoal() {
    const g = GOALS[S.goal];
    if (!g) return;
    const [v, max] = g.prog();
    if (v >= max) {
      S.goal++; S.fund += g.reward; repHit(2); money(null, g.reward);
      banner('Goal reached: ' + g.text + '! +' + U.money(g.reward), 'money');
      log('Goal reached: ' + g.text.toLowerCase() + '. The city council gave you a ' + U.money(g.reward) + ' grant.', 'money');
      sound('jackpot');
    }
  }

  // ---------- events between neighbours ----------
  function socialEvent() {
    const list = fams();
    if (list.length < 2) return;
    const a = U.pick(list);
    const ns = neighbours(unitOf(a)).map(famOf).filter(Boolean);
    const b = (ns.length && U.chance(0.7)) ? U.pick(ns) : U.pick(list.filter(o => o !== a));
    const r = rel(a.id, b.id);
    if (r <= -70 && U.chance(0.5)) return feudEvent(a, b);
    let pGood = 0.56 + r / 250 + compat(a, b) * 0.07 + (a.happy - 55) / 300;
    if (has(a, 'moaner')) pGood -= 0.15;
    if (has(a, 'helpful')) pGood += 0.15;
    if (S.weather.type === 'heatwave') pGood -= 0.1;
    if (hasShop('yoga')) pGood += 0.08;
    const good = U.chance(U.clamp(pGood, 0.1, 0.9));
    const fits = (e) => {
      const need = e[2];
      if (!need) return true;
      if (need === 'B:kids') return kids(b).length > 0;
      if (need === 'B:above') return unitOf(b).floor === unitOf(a).floor + 1 && unitOf(b).side === unitOf(a).side;
      if (need === 'snow') return S.weather.type === 'snow';
      if (need.startsWith('B:')) return has(b, need.slice(2));
      return has(a, need);
    };
    const pool = (good ? DATA.good : DATA.bad).filter(fits);
    const special = pool.filter(e => e[2]);
    const e = (special.length && U.chance(0.55)) ? U.pick(special) : U.pick(pool);
    const text = e[0].replace('{A}', label(a)).replace('{B}', label(b));
    addRel(a.id, b.id, e[1]);
    a.boost += e[1] * 0.4; b.boost += e[1] * 0.4;
    if (good) { S.stats.friendships++; fx(a.apt, 'heart'); fx(b.apt, 'heart'); repHit(0.2); say(a.apt, U.pick(DATA.say.good)); say(b.apt, U.pick(DATA.say.thanks), 1.6); }
    else {
      S.stats.quarrels++; fx(a.apt, 'angry'); fx(b.apt, 'angry'); sound('angry'); repHit(-0.4); if (e[2] && e[2].startsWith('B:')) complain(b);
      say(a.apt, DATA.say.need[e[2]] || U.pick(DATA.say.angry)); say(b.apt, U.pick(DATA.say.reply), 1.6);
      // Bad blood ends with a face-to-face on the landing.
      if (rel(a.id, b.id) <= -30 && U.chance(0.5)) scene('fight', { floor: unitOf(a).floor, a: U.pick(adults(a)) || a.members[0], b: U.pick(adults(b)) || b.members[0] });
    }
    log(U.cap(text), good ? 'social' : 'quarrel', a.apt);
    // Lonely hearts: two single adults who like each other.
    if (good && rel(a.id, b.id) >= 55 && a.members.length === 1 && b.members.length === 1 && a.kind === 'normal' && b.kind === 'normal'
      && a.members[0].sex !== b.members[0].sex && a.members[0].age >= 20 && b.members[0].age >= 20 && Math.abs(a.members[0].age - b.members[0].age) < 15) {
      if (rel(a.id, b.id) >= 80) wedding(a, b);
      else if (U.chance(0.5)) { log(Label(a) + ' and ' + label(b) + ' were seen holding hands in the courtyard.', 'social', a.apt); fx(a.apt, 'heart'); fx(b.apt, 'heart'); addRel(a.id, b.id, 6); }
    }
    if (!good && rel(a.id, b.id) <= -60 && !S.pending.some(p => p.type === 'feud') && U.chance(0.25)) ask('feud', { a: a.id, b: b.id });
  }
  function feudEvent(a, b) {
    const e = U.pick(DATA.feud);
    const text = e[0].replace('{A}', label(a)).replace('{B}', label(b));
    log(U.cap(text) + (e[1] ? ' It cost them ' + U.money(e[1]) + ' each.' : ''), 'quarrel', a.apt);
    a.savings -= e[1]; b.savings -= e[1]; a.boost -= 5; b.boost -= 5;
    fx(a.apt, 'angry'); fx(b.apt, 'angry'); sound('angry');
    say(a.apt, U.pick(DATA.say.feud)); say(b.apt, U.pick(DATA.say.feud), 1.6);
    scene('fight', { floor: unitOf(a).floor, a: U.pick(adults(a)) || a.members[0], b: U.pick(adults(b)) || b.members[0] });
    S.stats.quarrels++;
  }
  function wedding(a, b) {
    const [stay, go] = U.chance(0.5) ? [a, b] : [b, a];
    const m = go.members[0];
    log(Label(stay) + ' and ' + label(go) + ' got married! ' + m.first + ' moved into ' + stay.apt + '.', 'good', stay.apt);
    if (hasShop('florist')) log('The florist decorated the whole staircase for the wedding.', 'social');
    if (stay.name !== go.name) stay.name = stay.name + '-' + go.name;
    stay.members.push(m);
    stay.habits = Array.from(new Set(stay.habits.concat(go.habits))).slice(0, 3);
    stay.savings += go.savings; stay.boost += 25;
    for (const o of fams()) if (o !== stay && o !== go) addRel(stay.id, o.id, 3);
    moveOut(go, null, 'info');
    S.stats.left--;
    S.stats.weddings++; repHit(3);
    BUS.emit('confetti', stay.apt); fx(stay.apt, 'heart'); sound('wedding');
    say(stay.apt, 'I do!'); say(stay.apt, 'I do too!', 1.6);
    scene('wedding', { a: stay.members[0], b: m });
  }
  function startParty(f) {
    if (f.warned > day()) return;
    f.party = S.t + U.irand(4, 6);
    log(Label(f) + ' ' + vb(f, 'is', 'are') + ' throwing a party in ' + f.apt + '!', 'social', f.apt);
    say(f.apt, U.pick(['Party time!', 'Turn it up!', 'Who brought the cake?']), 1);
    fx(f.apt, 'note'); sound('party');
  }
  function partyTick(f) {
    if (f.party <= S.t) { f.party = 0; return; }
    fx(f.apt, 'note');
    if (U.chance(0.3)) {
      const ns = neighbours(unitOf(f)).map(famOf).filter(Boolean);
      if (!ns.length) return;
      const o = U.pick(ns);
      const angry = has(o, 'early') || has(o, 'neat') || has(o, 'moaner') || o.members.some(m => m.age >= 70) || U.chance(0.35);
      if (has(o, 'party') || !angry) { addRel(o.id, f.id, 6); o.boost += 3; log(Label(o) + ' joined the party next door. Great music!', 'social', f.apt); fx(o.apt, 'heart'); }
      else { addRel(o.id, f.id, -9); o.boost -= 5; S.stats.quarrels++; complain(f); const when = hour() === 0 ? 'midnight' : hour() + ' o\'clock'; log(Label(o) + ' banged on the wall with a broom: "It is ' + when + '!"', 'quarrel', o.apt); say(o.apt, 'It is ' + when + '!'); say(f.apt, 'Party pooper!', 1.6); fx(o.apt, 'angry'); sound('angry'); }
    }
  }

  // ---------- life events ----------
  function lifeEvents(f, p) {
    if (f.kind === 'squatter') {
      if (U.chance(p / 60)) { log('The squatters in ' + f.apt + ' held a drum circle in the stairwell.', 'quarrel', f.apt); for (const o of fams()) if (o !== f) addRel(o.id, f.id, -3); fx(f.apt, 'note'); }
      return;
    }
    const u = unitOf(f);
    if (U.chance(p / 150)) {
      const w = U.irand(5, 50) * 10;
      f.savings += w; f.boost += 8;
      log(Label(f) + ' won ' + U.money(w) + ' on a scratch card.', 'money', f.apt); say(f.apt, 'Lucky me!'); fx(f.apt, 'money'); sound('coin');
    }
    if (U.chance(p / 5000)) return jackpot(f);
    for (const m of f.members.slice()) {
      const j = m.job;
      if (!j) continue;
      if (m.age >= 18 && !j.retired && !j.jobless && j.inc > 0 && !j.school && f.kind === 'normal' && U.chance(p / 1100)) {
        log(m.first + ' ' + f.name + ' (' + j.name.toLowerCase() + ') lost their job.', 'bad', f.apt); say(f.apt, 'I got fired...');
        m.job = { name: 'Unemployed', inc: 400, jobless: true, was: j.name }; f.boost -= 15; fx(f.apt, 'sad');
      } else if (j.jobless && U.chance(p / 70)) {
        const nj = genJob(Math.max(26, Math.min(m.age, 60)));
        m.job = nj.jobless ? { name: 'Shop assistant', inc: 1300 } : nj;
        log(m.first + ' ' + f.name + ' found a job as ' + m.job.name.toLowerCase() + '.', 'good', f.apt); say(f.apt, 'I got the job!'); f.boost += 12; fx(f.apt, 'heart');
      } else if (j.inc > 900 && !j.retired && U.chance(p / 800)) {
        j.inc = round10(j.inc * 1.15);
        log(m.first + ' ' + f.name + ' got a promotion. Prosecco on the balcony!', 'good', f.apt); say(f.apt, 'Promoted!'); f.boost += 8; fx(f.apt, 'money');
      } else if (j.strange && j.quip && U.chance(p / 90)) {
        log(j.quip.replace('{N}', m.first + ' the ' + j.name.toLowerCase()), 'odd', f.apt); fx(f.apt, 'excl');
        for (const o of fams()) if (o !== f) addRel(o.id, f.id, U.irand(-3, 2));
      }
      if (m !== f.members[0] && m.age >= 20 && m.age < 40 && f.members.length > 1 && !f.group && U.chance(p / 500)) {
        f.members.splice(f.members.indexOf(m), 1);
        log(m.first + ' ' + f.name + ' left home to live on their own. Mum cried a little.', 'info', f.apt); f.boost -= 3;
      }
      if (m.age >= 82 && U.chance(p / 1400)) {
        f.members.splice(f.members.indexOf(m), 1);
        if (U.chance(0.5)) log(m.first + ' ' + f.name + ' moved into a retirement home with a sea view.', 'info', f.apt);
        else { log(m.first + ' ' + f.name + ' passed away peacefully at ' + m.age + '. The whole building came to the funeral.', 'sad', f.apt); for (const o of fams()) if (o !== f) addRel(o.id, f.id, 5); vehicle('hearse', 3, f.apt); }
        f.boost -= 20; fx(f.apt, 'sad');
        if (!f.members.length) { moveOut(f, null, 'info', { noVan: true }); S.stats.left--; return; }
      }
    }
    const mom = f.members.find(m => m.sex === 'f' && m.age >= 21 && m.age <= 42);
    if (mom && adults(f).length >= 2 && kids(f).length < 4 && f.kind === 'normal' && U.chance(p / 500)) {
      const b = genMember(0); f.members.push(b);
      log(Label(f) + ' welcomed a baby: ' + b.first + '! Pink and blue ribbons on the door.', 'good', f.apt); say(f.apt, 'It\'s a ' + (b.sex === 'f' ? 'girl' : 'boy') + '!');
      if (f.members.length > SIZES[u.size].cap) log('The ' + SIZES[u.size].label.toLowerCase() + ' of ' + label(f) + ' is getting crowded.', 'bad', f.apt);
      S.stats.births++; f.boost += 20; fx(f.apt, 'heart'); vehicle('ambulance', 2, f.apt);
    }
    if (adults(f).length === 2 && !f.group && f.kind === 'normal' && U.chance(p / 3000)) {
      const m = adults(f)[1];
      f.members.splice(f.members.indexOf(m), 1);
      log(m.first + ' and ' + f.members[0].first + ' ' + f.name + ' broke up. ' + m.first + ' moved out with a suitcase.', 'sad', f.apt); f.boost -= 20; fx(f.apt, 'sad');
    }
    if (!f.pet && U.chance(p / 1500)) {
      f.pet = U.chance(0.5) ? 'dog' : 'cat';
      log(Label(f) + ' adopted a ' + (f.pet === 'dog' ? 'puppy' : 'kitten') + '.', 'good', f.apt); f.boost += 8; fx(f.apt, 'heart');
    }
    if (U.chance(p * (S.fest === 'ferragosto' ? 3 : 1) / ((S.upgrades.cameras ? 7000 : 2200) * (S.staff.guard ? 4 : 1)))) {
      const lost = Math.min(Math.max(0, f.savings), U.irand(3, 30) * 100);
      f.savings -= lost; f.boost -= 15;
      say(f.apt, 'We have been robbed!');
      log('Burglars broke into ' + f.apt + ' while ' + label(f) + ' were out' + (lost ? ' and took ' + U.money(lost) + ' in valuables.' : '. They found nothing worth taking.'), 'bad', f.apt);
      vehicle('police', 3, f.apt); fx(f.apt, 'excl'); sound('siren');
    }
    if (U.chance(p / 3000)) {
      const m = U.pick(f.members);
      log(m.first + ' ' + f.name + ' was rushed to hospital. Back home after a few days, with grapes from the neighbours.', 'sad', f.apt);
      vehicle('ambulance', 2, f.apt); sound('siren'); for (const o of fams()) if (o !== f && U.chance(0.4)) addRel(o.id, f.id, 4);
    }
    if (!S.upgrades.lift && u.floor >= 4 && U.chance(p / 120)) log(U.pick(f.members).first + ' ' + f.name + ' climbed ' + u.floor + ' floors with the shopping bags. Again. "When is the lift coming?"', 'bad', f.apt);
    if (U.chance(p / 1600) && f.kind === 'normal') moveOut(f, Label(f) + ' ' + U.pick(DATA.moveAway) + ' and left apartment ' + u.id + '.', 'info');
  }
  function jackpot(f) {
    const w = U.pick([50000, 100000, 250000, 500000, 1000000, 2000000]);
    S.stats.lottery++;
    f.savings += w;
    banner('JACKPOT! ' + Label(f) + ' won ' + U.money(w) + '!', 'money');
    say(f.apt, 'I won! I WON!');
    BUS.emit('confetti', f.apt); fx(f.apt, 'money'); sound('jackpot');
    const gift = Math.min(15000, Math.round(w * U.rand(0.02, 0.08) / 100) * 100);
    if (U.chance(0.55)) {
      S.fund += gift;
      moveOut(f, Label(f) + ' won ' + U.money(w) + ' at the lottery, ' + U.pick(DATA.villas) + ' and left you ' + U.money(gift) + ' as a thank-you.', 'money');
    } else {
      f.ls = 3; f.boost += 40;
      if (U.chance(0.6)) { S.fund += gift; log(Label(f) + ' won ' + U.money(w) + ' at the lottery! They are staying, and paid ' + U.money(gift) + ' of rent in advance.', 'money', f.apt); }
      else log(Label(f) + ' won ' + U.money(w) + ' at the lottery! They are staying, and bought a golden toilet.', 'money', f.apt);
      vehicle('van', 4, f.apt);
    }
  }

  // ---------- secrets ----------
  function secretTick(f) {
    const s = f.secret;
    if (!s || s.revealed) return;
    const fast = (S.upgrades.cameras && s.kind === 'shady' ? 1.6 : 1) * (hasShop('detective') ? 2 : 1);
    if (U.chance(0.035 * fast)) {
      s.sus++;
      const text = U.pick(s.kind === 'shady' ? DATA.shadyHints : DATA.mysteryHints).replace('{A}', f.apt);
      log(text, 'mystery', f.apt); fx(f.apt, 'question');
      if (s.kind === 'mystery' && U.chance(0.4)) vehicle('blackcar', 3, f.apt);
    }
    if (s.kind === 'mystery' && s.sus >= 3 && !s.asked && !S.pending.some(p => p.type === 'mystery')) { s.asked = true; ask('mystery', { f: f.id }); }
    if (s.kind === 'shady') {
      if (s.sus >= 3 && !s.offered && !S.pending.some(p => p.type === 'bribe')) { s.offered = true; ask('bribe', { f: f.id, amount: U.irand(15, 40) * 100 }); }
      if (s.sus >= 5 && U.chance(0.03)) raid(f);
    }
  }
  function raid(f) {
    const s = f.secret;
    s.revealed = true;
    const u = unitOf(f);
    banner('POLICE RAID at ' + u.id + '!', 'bad');
    say(u.id, 'Police! Open up!');
    scene('raid', { apt: u.id, suspect: f.members[0] });
    vehicle('police', 6, u.id); vehicle('police', 5, u.id); sound('siren');
    S.stats.arrests++;
    let text = 'Police raided ' + u.id + ': ' + label(f) + ' had been ' + s.truth + '. Arrested on the spot.';
    if (s.bribed) { S.fund -= 5000; text += ' Your bribe came out too: the court fined you ' + U.money(5000) + '.'; for (const o of fams()) o.boost -= 15; }
    u.sealed = day() + 10;
    repHit(s.bribed ? -10 : -3);
    moveOut(f, text, 'bad', { noVan: true });
    for (const o of fams()) o.boost += s.bribed ? 0 : 3;
  }
  function reveal(f) {
    const s = f.secret;
    s.revealed = true;
    const name = label(f);
    log('Mystery solved: ' + name + ' in ' + f.apt + ' is ' + s.truth + '.', 'mystery', f.apt);
    fx(f.apt, 'excl');
    if (['spy', 'witness', 'magician', 'billionaire', 'rockstar'].includes(s.key)) {
      const text = U.cap(name) + ' ' + s.end;
      if (s.key === 'billionaire') { const g = U.irand(10, 30) * 1000; S.fund += g; sound('jackpot'); log(text + ' (' + U.money(g) + ')', 'money', f.apt); moveOut(f, null, 'info', { noVan: true }); return; }
      if (s.key === 'rockstar') { for (const o of fams()) o.boost += 10; }
      if (s.key === 'magician') S.fund += 600;
      vehicle('blackcar', 3, f.apt);
      moveOut(f, text, 'mystery', { noVan: true });
    } else {
      log(U.cap(name) + ' ' + s.end, 'mystery', f.apt);
      if (s.key === 'novelist') { S.fund += 3000; log('Fans of the book now take selfies in front of the building. Royalties: ' + U.money(3000) + '.', 'money'); }
      if (s.key === 'baker') for (const o of fams()) if (o !== f) addRel(o.id, f.id, 20);
      f.kind = 'normal';
      f.members[0].job = { name: { novelist: 'Novelist', baker: 'Baker', ghosthunter: 'Ghost hunter', astronomer: 'Astronomer' }[s.key] || 'Freelance', inc: f.members[0].job.inc, night: true };
    }
  }

  // ---------- businesses ----------
  function shopTick(u) {
    const sh = u.shop, d = DATA.shops[sh.type];
    // Business health: more residents means more customers; weather and rivals matter.
    let drift = U.rand(-3, 3) + (residents() - 8) * 0.08;
    if (S.units.filter(o => o.shop && o.shop.type === sh.type && o !== u).length) drift -= 1.5;
    if (sh.type === 'bnb') drift += season() === 'summer' ? 2.5 : season() === 'winter' ? -2.5 : 0.5;
    if (S.city && S.city.roadworks > day() && u.floor === 0) drift -= 2;
    if (S.fest === 'ferragosto' && u.floor === 0 && sh.type !== 'gelateria') drift -= 1.5;
    if (S.fest === 'christmas' || (month() === 1 && date().getDate() <= 15)) drift += 1.5;
    if (sh.type === 'gelateria') drift += season() === 'summer' ? 2 : season() === 'winter' ? -2 : 0;
    if (['rain', 'storm'].includes(S.weather.type) && d.where === 'ground') drift -= 0.8;
    if (sh.secret) drift += 1.5; // it is not the customers paying the bills
    sh.health = U.clamp(sh.health + drift, 0, 100);
    if (sh.health <= 0) return closeShop(u, U.cap(sh.name) + ' (' + d.label.toLowerCase() + ') went out of business and closed down.');
    if (U.chance(0.12)) {
      const list = fams().filter(f => f.kind !== 'squatter');
      const a = U.pick(list) || null, b = U.pick(list.filter(x => x !== a)) || null;
      let t = U.pick(DATA.shopEvents[sh.type]);
      if (t.includes('{A}') && !(a && b)) return;
      t = t.replace('{S}', sh.name).replace('{A}', a ? label(a) : '').replace('{B}', b ? label(b) : '');
      log(U.cap(t), 'shop', u.id); fx(u.id, sh.type === 'dentist' ? 'excl' : 'heart');
      if (sh.type === 'cafe' && a && b) addRel(a.id, b.id, U.irand(-6, 4));
      if (['bakery', 'grocery', 'gelateria', 'pharmacy', 'florist', 'lawyer', 'daycare'].includes(sh.type)) for (const f of list) f.boost += 1.5;
    }
    if (sh.secret && !sh.secret.revealed && U.chance(0.05)) {
      sh.secret.sus++;
      log(U.pick(['Customers go into ' + sh.name + ' and come out without buying anything.', sh.name + ' is open at 3 a.m. Who shops there at 3 a.m.?', 'A van unloaded heavy boxes at ' + sh.name + ' at dawn.']), 'mystery', u.id); fx(u.id, 'question');
      if (sh.secret.sus >= 4 && U.chance(0.3)) {
        sh.secret.revealed = true; S.stats.arrests++;
        banner('POLICE RAID at ' + sh.name + '!', 'bad'); vehicle('police', 6, u.id); sound('siren');
        closeShop(u, 'Police raided ' + sh.name + ': it was a front for ' + sh.secret.truth + '. The shop was seized.');
        u.sealed = day() + 7;
      }
    }
  }
  function closeShop(u, text) {
    u.shop = null; u.emptyDays = 0;
    log(text, 'bad', u.id); vehicle('van', 3, u.id);
  }
  function shopOffer() {
    const free = S.units.filter(u => !u.work && !u.burnt && !u.sealed && ((u.kind === 'shop' && !u.shop) || (u.kind === 'empty' && u.floor === 0)));
    if (!free.length || S.pending.some(p => p.type === 'shopoffer')) return;
    const u = U.pick(free);
    const types = Object.keys(DATA.shops).filter(k => DATA.shops[k].where === (u.floor === 0 ? 'ground' : 'upper'));
    const type = U.pick(types);
    const secret = U.chance(0.18) ? { truth: U.pick(['laundering mafia money', 'selling stolen phones', 'an illegal gambling den', 'smuggling truffles']), sus: 0, revealed: false } : null;
    ask('shopoffer', { u: u.id, shop: genShop(type, { discount: true, secret }), who: U.pick(DATA.surnames) });
  }

  // ---------- disasters ----------
  const randUnit = (pred) => U.pick(S.units.filter(u => !u.work && !u.burnt && (u.fam || u.shop) && (!pred || pred(u))));
  function startFire(u, text) {
    if (!u || u.fire || u.burnt || u.work) return;
    u.fire = S.t + U.irand(3, 6);
    u.fireStart = S.t;
    S.stats.disasters++;
    banner('FIRE in ' + (u.shop ? u.shop.name : 'apartment ' + u.id) + '!', 'bad');
    say(u.id, 'Fire! Help!');
    log(text || 'Fire in ' + (u.shop ? u.shop.name : 'apartment ' + u.id) + '! Everybody out!', 'disaster', u.id);
    vehicle('firetruck', 7, u.id); sound('siren');
    if (u.fam) famOf(u).boost -= 25;
  }
  function fireTick(u) {
    if (!u.fire) return;
    if (S.t >= u.fire) {
      const long = u.fire - u.fireStart >= 5;
      u.fire = 0;
      const f = famOf(u);
      if (long || U.chance(0.4)) {
        u.burnt = true;
        const pay = 3000; S.fund += pay;
        log('The fire in ' + label3(u) + ' is out, but the place is gutted. Insurance paid ' + U.money(pay) + '. You can rebuild it.', 'disaster', u.id);
        u.burntDay = day(); repHit(-3);
        if (f) { moveOut(f, Label(f) + ' lost their home in the fire and moved in with relatives.', 'sad', { noVan: true }); if (U.chance(0.3)) lawsuit(Label(f), U.irand(20, 50) * 100, 'claiming the wiring was faulty'); }
        if (u.shop) { log(U.cap(u.shop.name) + ' lost everything in the fire and closed.', 'sad', u.id); u.shop = null; }
      } else {
        log('Firefighters put out the fire in ' + label3(u) + '. Smoke damage only.', 'disaster', u.id);
        if (f) { f.savings -= 1500; f.boost -= 10; }
        if (u.shop) u.shop.health -= 20;
      }
      return;
    }
    if (U.chance(0.06)) { const n = U.pick(neighbours(u).filter(o => !o.work && (o.fam || o.shop))); if (n) startFire(n, 'The fire spread to ' + n.id + '!'); }
  }
  function insurance(cost) {
    const pay = Math.round(cost * 0.5 / 100) * 100;
    if (pay > 0) { S.fund += pay; log('The insurance paid ' + U.money(pay) + ' towards the damage.', 'money'); }
  }
  function earthquake(mag) {
    mag = mag || Math.round((3.6 + Math.pow(Math.random(), 2) * 3.8) * 10) / 10;
    S.stats.disasters++;
    banner('EARTHQUAKE! Magnitude ' + mag.toFixed(1), 'disaster');
    BUS.emit('quake', mag); sound('quake');
    const cost = Math.round((mag - 3) * 1200 * S.floors / 100) * 100;
    S.fund -= cost;
    log('An earthquake of magnitude ' + mag.toFixed(1) + ' shook the building. Cracks, broken crockery and ' + U.money(cost) + ' of damage.', 'disaster');
    insurance(cost);
    for (const f of fams()) {
      f.boost -= mag * 4;
      if (mag >= 6 && f.kind === 'normal' && U.chance(0.25)) moveOut(f, Label(f) + ' were too scared to stay after the earthquake and left.', 'sad');
    }
    if (mag >= 6.2) {
      const u = randUnit();
      if (u) {
        u.burnt = true; u.ruin = 'quake'; u.burntDay = day();
        const f = famOf(u);
        log('Part of ' + label3(u) + ' collapsed in the earthquake. Nobody was hurt, but it must be rebuilt.', 'disaster', u.id);
        if (f) moveOut(f, null, 'info', { noVan: true });
        if (u.shop) u.shop = null;
      }
    }
    if (mag >= 5.5 && U.chance(0.4)) startFire(randUnit(), 'A gas pipe broke in the earthquake: fire!');
  }
  function flood() {
    S.flood = S.t + 20; S.stats.disasters++;
    banner('FLOOD! The street is under water', 'disaster'); sound('flood');
    S.fund -= 1500;
    log('Flash flood! The street turned into a river and the ground floor is soaked. Cleaning up cost ' + U.money(1500) + '.', 'disaster');
    for (const u of shops()) if (u.floor === 0) u.shop.health -= 25;
    for (const f of fams()) f.boost -= 6;
  }
  function lightning() {
    BUS.emit('lightning', true); sound('thunder');
    if (S.upgrades.rod) { log('Lightning struck the building. The lightning rod did its job!', 'good'); return; }
    log('Lightning struck the antenna! Sparks, a blackout and no TV.', 'disaster'); sound('power');
    S.blackout = S.t + U.irand(2, 5);
    if (U.chance(0.3)) startFire(randUnit(u => u.floor === S.floors), 'Lightning set the top floor on fire!');
  }
  function hail() {
    S.stats.disasters++;
    log('A violent hailstorm! Hailstones as big as walnuts dented every car in the street.', 'disaster'); sound('hail');
    BUS.emit('hail'); for (const f of fams()) f.boost -= 3;
  }
  function nearMiss() {
    banner('A plane flew dangerously low!', 'bad');
    log('A plane in trouble flew so low over the building that the windows rattled. It landed safely at the airport.', 'disaster');
    BUS.emit('plane', { crash: false }); sound('plane');
    for (const f of fams()) f.boost -= 6;
  }
  function planeCrash() {
    if (S.crashing) return;
    S.stats.disasters++; S.crashing = true;
    banner('MAYDAY! A plane is falling on the building!', 'disaster');
    BUS.emit('plane', { crash: true }); sound('plane');
  }
  // Called by the renderer when the plane hits: the top floors are gone.
  function crashDone() {
    S.crashing = false;
    const n = Math.min(2, S.floors);
    const lost = S.units.filter(u => u.floor > S.floors - n);
    let value = n * 8000;
    for (const u of lost) {
      const f = famOf(u);
      if (f) moveOut(f, null, 'info', { noVan: true });
      if (u.kind === 'apt') value += SIZES[u.size].cost; else if (u.shop) value += DATA.shops[u.shop.type].cost; else if (u.common) value += DATA.commons[u.common].cost;
    }
    S.units = S.units.filter(u => !lost.includes(u));
    S.floors -= n;
    S.floorWork = 0;
    if (S.floors === 0) { S.floors = 1; for (const s of ['A', 'B']) S.units.push(newUnit(1, s)); }
    log('A cargo plane crashed into the top of the building and took ' + (n === 1 ? 'the top floor' : 'the top ' + n + ' floors') + ' with it. By a miracle everyone was at the summer festival in the square.', 'disaster');
    insurance(value * 1.2);
    for (const f of fams()) f.boost -= 25;
    save();
  }
  function disasterTick() {
    const k = dis(), w = S.weather.type;
    if (U.chance(k / 1800 / 24)) earthquake();
    if ((w === 'storm' || w === 'rain') && !S.flood && U.chance(k * (w === 'storm' ? 1 / 60 : 1 / 400) / 24)) flood();
    if (w === 'storm' && U.chance(k * 0.007)) lightning();
    else if (w === 'storm' && U.chance(0.12)) BUS.emit('lightning', false);
    if (w === 'storm' && season() !== 'winter' && U.chance(k / 12 / 24)) hail();
    const n = S.units.filter(u => u.fam || u.shop).length;
    const fireP = (n / 6 / 1400 + (hasShop('pizzeria') ? 1 / 2500 : 0)) * k;
    if (U.chance(fireP / 24)) startFire(U.chance(0.3) && hasShop('pizzeria') ? shops().find(u => u.shop.type === 'pizzeria') : randUnit());
    if (U.chance(k / 2500 / 24)) nearMiss();
    if (S.floors >= 2 && U.chance(PLANE[S.settings.disasters] / 24)) planeCrash();
  }

  // ---------- empty apartments ----------
  function emptyTick(u) {
    if (u.work || u.fire || u.burnt) return;
    if (u.sealed && u.sealed <= day()) { u.sealed = 0; log('The police removed the seals from ' + label3(u) + '.', 'info', u.id); }
    if (u.sealed) return;
    if (u.kind === 'shop' && !u.shop) { u.emptyDays++; return; }
    if (u.kind !== 'apt' || u.fam) return;
    u.emptyDays++;
    const wait = Math.max(1, (S.rep >= 65 ? 1 : S.rep >= 40 ? 3 : 7) - (S.staff.concierge ? 2 : 0));
    if (u.emptyDays >= wait && u.askAgain <= day() && !S.pending.some(p => p.type === 'applicants')) {
      u.askAgain = day() + wait + 4;
      ask('applicants', { apt: u.id, cands: candidates(u) });
    } else if (u.emptyDays > 14 && !S.staff.guard && U.chance(S.upgrades.cameras ? 0.008 : 0.04)) {
      const f = genFamily('squatter');
      moveIn(f, u);
      repHit(-5);
      log('Squatters broke into the empty apartment ' + u.id + ' and moved in!', 'bad', u.id); say(u.id, 'Property is theft!', 1); fx(u.id, 'excl'); sound('crash');
      ask('squatters', { f: f.id });
    }
  }

  // ---------- construction ----------
  function workTick() {
    if (S.floorWork && S.t >= S.floorWork) {
      S.floorWork = 0; S.floors++;
      for (const u of S.units) if (u.size === 'penthouse' && u.floor === S.floors - 1) { u.size = 'luxury'; log('The penthouse ' + u.id + ' lost its view to the new floor: it is now a luxury flat.', 'info', u.id); }
      for (const s of ['A', 'B']) S.units.push(newUnit(S.floors, s));
      log('The ' + U.ordinal(S.floors) + ' floor is finished! Two empty shells are ready to be fitted out.', 'good');
      banner(U.cap(U.ordinal(S.floors)) + ' floor ready!', 'money'); sound('bell');
      BUS.emit('built', S.floors);
    }
    for (const u of S.units) if (u.work && S.t >= u.work) {
      u.work = 0;
      S.stats.built++;
      if (u.kind === 'apt') { u.emptyDays = 1; u.askAgain = 0; log(SIZES[u.size].label + ' ' + u.id + ' is ready. Tenants will be along soon.', 'good', u.id); }
      else if (u.common) { log('The ' + DATA.commons[u.common].label.toLowerCase() + ' in ' + label3(u) + ' is open. The residents are curious.', 'good', u.id); }
      else if (u.shop) { u.shop.since = day(); log(U.cap(u.shop.name) + ' (' + DATA.shops[u.shop.type].label.toLowerCase() + ') opened in ' + label3(u) + '! Ribbon cut, prosecco poured.', 'good', u.id); BUS.emit('confetti', u.id); }
      fx(u.id, 'heart'); sound('bell');
    }
  }

  // ---------- neighbours, the city, the racket, lawsuits ----------
  function candidates(u) {
    const n = S.rep < 30 ? 2 : 3;
    return Array.from({ length: n }, () => genFamily(null, u.size));
  }
  // Every day, bad neighbours grow apart and good ones grow closer; a feud makes people leave.
  function neighbourTick() {
    const list = fams();
    for (const a of list) for (const n of neighbours(unitOf(a))) {
      const b = famOf(n);
      if (!b || a.id > b.id) continue;
      const c = compat(a, b);
      if (c) addRel(a.id, b.id, c < 0 ? c * 0.9 : c * 0.4);
    }
    for (const f of list) {
      if (f.kind !== 'normal' || !S.fams[f.id]) continue;
      const enemy = neighbours(unitOf(f)).map(famOf).filter(Boolean).find(o => rel(f.id, o.id) <= -75);
      if (enemy && U.chance(0.04)) {
        moveOut(f, Label(f) + ' could not stand ' + label(enemy) + ' any more and moved out.', 'bad');
        repHit(-3);
        if (U.chance(0.3)) lawsuit(Label(f), U.irand(15, 40) * 100, 'for doing nothing about their neighbours');
      }
    }
  }
  function complain(f) {
    if (!f || f.kind === 'squatter' || f.warned > day()) return;
    if (S.staff.concierge && U.chance(0.4)) return; // the concierge had a word with them
    f.complaints = (f.complaints || 0) + 1;
    if (f.complaints >= 5 && !S.pending.some(p => p.type === 'complaints')) { f.complaints = 0; ask('complaints', { f: f.id }); }
  }
  function lawsuit(who, amount, why) { ask('lawsuit', { who, amount, why }); }
  function cityTick() {
    const d = day();
    if (S.permit && S.permit.state === 'pending' && d >= S.permit.ready) {
      S.permit.state = 'granted';
      log('Building permit granted: you can now build the ' + U.ordinal(S.floors + 1) + ' floor.', 'good');
      banner('Building permit granted!', 'money'); sound('bell');
    }
    if (d >= S.nextInspect) { S.nextInspect = d + U.irand(50, 90); inspect(); }
  }
  function inspect() {
    const issues = [];
    for (const f of fams()) { const u = unitOf(f); if (f.members.length > SIZES[u.size].cap) issues.push('overcrowding in ' + u.id); }
    if (fams().some(f => f.kind === 'squatter')) issues.push('squatters living in the building');
    for (const u of S.units) if (u.burnt && day() - (u.burntDay || 0) > 30) issues.push('unsafe ruins in ' + label3(u));
    if (S.floors >= 5 && !S.upgrades.lift) issues.push('no lift in a building of ' + S.floors + ' floors');
    if (S.floors >= 7 && !S.upgrades.escape) issues.push('no fire escape');
    vehicle('blackcar', 4, null);
    if (!issues.length) { log('A city inspector checked the building from top to bottom: everything in order!', 'good'); repHit(3); return; }
    ask('inspection', { issues, fine: issues.length * 1200 });
  }
  function racketTick() {
    const d = day(), r = S.racket;
    const ground = shops().filter(u => u.floor === 0);
    if (!r) { if (ground.length && d > 40 && U.chance(S.staff.guard ? 1 / 200 : 1 / 90)) ask('racket', { weekly: 60 + 50 * ground.length, step: 0 }); return; }
    if (r.state === 'gone') { if (d >= r.until) S.racket = null; return; }
    if (r.state === 'refused' && d >= r.next) {
      const u = U.pick(ground);
      if (!u) { S.racket = { state: 'gone', until: d + 200 }; return; }
      if (r.step <= 1) {
        u.shop.health -= 25; u.shop.smashed = d + 5; repHit(-3);
        banner('Window smashed at ' + u.shop.name + '!', 'bad'); sound('crash'); vehicle('police', 3, u.id);
        log('Someone smashed the window of ' + u.shop.name + ' during the night. A note said: "Think about our offer."', 'bad', u.id);
        S.racket = { state: 'waiting' };
        ask('racket', { weekly: Math.round(r.weekly * 1.5), step: 1 });
      } else {
        if (S.staff.guard && U.chance(0.5)) log('The night guard chased away two men with petrol cans in front of ' + u.shop.name + '. The gang gave up.', 'good', u.id);
        else startFire(u, 'Arson! ' + u.shop.name + ' was set on fire during the night. The gang made its point.');
        S.racket = { state: 'gone', until: d + 300 };
      }
    } else if (r.state === 'reported' && d >= r.next) {
      if (U.chance(0.6)) {
        log('The police arrested the racketeers who were threatening your shops. The whole street thanks you!', 'good');
        repHit(8); banner('Racketeers arrested!', 'money'); vehicle('police', 5, null); S.racket = { state: 'gone', until: d + 500 };
      } else {
        const u = U.pick(ground);
        log('The police could not prove anything, and the gang took revenge.', 'bad');
        if (u) startFire(u, 'Revenge! ' + u.shop.name + ' was set on fire.');
        S.racket = { state: 'gone', until: d + 300 };
      }
    }
  }
  function stopRacket() {
    if (!S.racket || S.racket.state !== 'paying') return false;
    S.racket = { state: 'refused', weekly: S.racket.weekly, step: 2, next: day() + U.irand(4, 10) };
    log('You told the racketeers you will not pay any more. They did not take it well.', 'bad');
    return true;
  }
  // Delayed consequences: bribes that come out, court cases.
  function laterTick() {
    const d = day();
    for (const e of S.later.filter(e => e.day <= d)) {
      if (e.type === 'scandal') {
        S.fund -= 4000; repHit(-15);
        banner('SCANDAL! Your bribe made the news', 'bad');
        log('A newspaper revealed that you bribed the ' + e.what + '. A ' + U.money(4000) + ' fine and your face on every front page.', 'bad');
      } else if (e.type === 'court') {
        if (U.chance(e.law ? 0.7 : 0.5)) { log('You won the case brought by ' + e.who + '. The judge dismissed it.', 'good'); repHit(2); }
        else { S.fund -= e.amount * 2; repHit(-5); log('You lost the case brought by ' + e.who + ' and must pay ' + U.money(e.amount * 2) + ' in damages and costs.', 'bad'); banner('Case lost: -' + U.money(e.amount * 2), 'bad'); }
      }
    }
    S.later = S.later.filter(e => e.day > d);
  }
  const scandalLater = (what, p) => { if (U.chance(p)) S.later.push({ day: day() + U.irand(20, 150), type: 'scandal', what }); };

  // ---------- staff ----------
  const staffCost = () => Object.keys(S.staff).filter(k => S.staff[k]).reduce((a, k) => a + STAFF[k].weekly, 0);
  function hire(k) {
    if (!STAFF[k]) return false;
    S.staff[k] = !S.staff[k];
    log(S.staff[k] ? 'You hired a ' + STAFF[k].label.toLowerCase() + ' (' + U.money(STAFF[k].weekly) + ' a week).' : 'You let the ' + STAFF[k].label.toLowerCase() + ' go.', S.staff[k] ? 'good' : 'info');
    if (!S.staff[k]) for (const f of fams()) f.boost -= 2;
    sound('click');
    return true;
  }

  // ---------- building events ----------
  function organize(type) {
    const e = EVENTS[type];
    if (!e || S.event || day() - S.lastEvent < eventCooldown() || S.fund < e.cost || fams().length < 2) return false;
    S.fund -= e.cost;
    let start = day() * 24 + e.hour;
    if (start <= S.t + 2) start += 24;
    S.event = { type, start, end: start + e.hours, started: false };
    log('Posters are up in the lobby: ' + e.label.toLowerCase() + ' ' + (start - S.t < 24 ? 'today' : 'tomorrow') + ' at ' + e.hour + ':00!', 'social');
    sound('bell');
    return true;
  }
  function eventTick() {
    const ev = S.event;
    if (!ev) return;
    if (!ev.started && S.t >= ev.start) {
      ev.started = true;
      log({ party: 'The courtyard party has started: lights, music and far too much food.', market: 'The street market is open! Stalls all along the pavement.', football: 'Kick-off! The residents\' football tournament has begun.' }[ev.type], 'social');
      sound('party');
    }
    if (S.t < ev.end) return;
    S.event = null; S.lastEvent = day();
    const list = fams().filter(f => f.kind !== 'squatter');
    if (ev.type === 'party') {
      let fights = 0;
      for (const a of list) {
        a.boost += 8;
        for (const b of list) if (a.id < b.id) {
          if (rel(a.id, b.id) <= -50 && U.chance(0.35)) { addRel(a.id, b.id, -10); fights++; log(Label(a) + ' and ' + label(b) + ' had a row at the party. Someone threw a meatball.', 'quarrel', a.apt); }
          else addRel(a.id, b.id, U.irand(4, 9));
        }
      }
      repHit(fights ? 1 : 3);
      log('The courtyard party was ' + (fights ? 'lively, let us say.' : 'a triumph. People are still humming the songs.'), fights ? 'social' : 'good');
    } else if (ev.type === 'market') {
      const fee = 200 + shops().length * 150;
      for (const u of shops()) u.shop.health = Math.min(100, u.shop.health + 15);
      for (const f of list) f.boost += 4;
      S.fund += fee; repHit(2);
      log('The street market was a success: the shops did great business and the stall fees brought in ' + U.money(fee) + '.', 'money');
    } else {
      const players = list.filter(f => f.members.some(m => m.age >= 10 && m.age <= 55));
      for (const a of players) { a.boost += has(a, 'sporty') || kids(a).length ? 12 : 5; for (const b of players) if (a.id < b.id) addRel(a.id, b.id, U.irand(3, 7)); }
      repHit(2);
      const t = U.shuffle(players.map(f => f.apt));
      log(players.length >= 2 ? 'Team ' + t[0] + ' beat team ' + t[1] + ' ' + U.irand(3, 7) + '-' + U.irand(1, 3) + ' in the final. Nobody agrees on the penalty.' : 'The tournament was short of players, but fun anyway.', 'good');
    }
    sound('jackpot');
  }

  // ---------- moving tenants ----------
  function freeApts() { return apts().filter(u => !u.fam && !u.work && !u.burnt && !u.sealed && !u.fire); }
  function relocate(fid, uid) {
    const f = S.fams[fid], to = unit(uid);
    if (!f || f.kind === 'squatter' || !to || to.kind !== 'apt' || to.fam || to.work || to.burnt || to.sealed || S.fund < MOVE_COST) return false;
    const from = unitOf(f);
    S.fund -= MOVE_COST;
    from.fam = null; from.emptyDays = 0; from.askAgain = 0;
    to.fam = f.id; to.emptyDays = 0; f.apt = to.id;
    f.boost += SIZES[to.size].cap > SIZES[from.size].cap ? 8 : 3;
    log(Label(f) + ' moved from ' + from.id + ' to ' + to.id + '. You paid the movers ' + U.money(MOVE_COST) + '.', 'info', to.id);
    vehicle('van', 3, to.id); fx(to.id, 'heart'); sound('doorbell');
    requestTick(true);
    return true;
  }

  // ---------- requests ----------
  // Tenants and shopkeepers ask for things, with a deadline. Some are fulfilled by doing something
  // (moving them, opening a shop, buying an upgrade), others by paying directly.
  const REQ = {
    bigger: { days: 40, fail: f => Label(f) + ' found a bigger home elsewhere and moved out.', reward: { rep: 3, boost: 15 } },
    stairs: { days: 50, fail: f => Label(f) + ' could not manage the stairs any more and moved to a ground-floor flat elsewhere.', reward: { rep: 3, boost: 15, money: 1000 } },
    away: { days: 30, fail: f => Label(f) + ' gave up on their neighbours and moved out.', reward: { rep: 2, boost: 15 } },
    shop: { days: 60, reward: { rep: 4, boost: 12 } },
    kitchen: { days: 30, cost: 1500, reward: { rep: 1, boost: 15 } },
    pet: { days: 20, cost: 0, reward: { boost: 10 } },
    upgrade: { days: 75, reward: { rep: 4, boost: 6, money: 1500 } },
    terrace: { days: 40, cost: 2000, reward: { rep: 2, health: 20 } },
    neon: { days: 30, cost: 800, reward: { health: 10 } }
  };
  const vb = (f, one, many) => f.members.length === 1 && !f.group ? one : many;
  function newRequest() {
    const pool = [], taken = (type, key) => S.requests.some(r => r.type === type && (r.fam === key || r.unit === key || r.extra === key));
    const pickShop = f => f.members.some(m => m.age >= 70) ? 'pharmacy' : kids(f).some(m => m.age < 6) ? 'daycare' : has(f, 'sporty') ? 'gym' : has(f, 'cook') ? 'grocery' : U.pick(['cafe', 'bakery', 'gelateria', 'florist']);
    for (const f of fams()) {
      if (f.kind !== 'normal' || S.requests.some(r => r.fam === f.id)) continue;
      const u = unitOf(f), cap = SIZES[u.size].cap;
      if (f.members.length > cap || (u.size === 'studio' && kids(f).length)) pool.push({ type: 'bigger', fam: f.id, extra: cap, text: Label(f) + ' ' + vb(f, 'is', 'are') + ' packed like sardines in their ' + SIZES[u.size].label.toLowerCase() + '. They need a bigger home.' });
      const elder = f.members.find(m => m.age >= 72);
      if (elder && u.floor >= 2 && !S.upgrades.lift) pool.push({ type: 'stairs', fam: f.id, text: elder.first + ' ' + f.name + ' (' + elder.age + ') can no longer climb to the ' + U.ordinal(u.floor) + ' floor. A lift, or a flat on the 1st floor, would save the day.' });
      const enemy = neighbours(u).map(famOf).find(o => o && rel(f.id, o.id) <= -45);
      if (enemy) pool.push({ type: 'away', fam: f.id, extra: enemy.id, text: Label(f) + ' cannot stand ' + label(enemy) + ' any more. Move one of them, or make peace between them.' });
      const want = pickShop(f);
      const where = DATA.shops[want].where;
      if (!hasShop(want) && !taken('shop', want) && S.units.some(x => !x.work && !x.burnt && ((x.kind === 'empty' && (x.floor === 0) === (where === 'ground')) || (x.kind === 'shop' && !x.shop))))
        pool.push({ type: 'shop', fam: f.id, extra: want, text: Label(f) + ' would love a ' + DATA.shops[want].label.toLowerCase() + ' in the building.' });
      if (f.ls >= 1 && u.size !== 'luxury' && !f.newKitchen) pool.push({ type: 'kitchen', fam: f.id, text: Label(f) + ' ' + vb(f, 'asks', 'ask') + ' for a new kitchen: the old one is falling apart.' });
      if (!f.pet && !has(f, 'neat') && !f.petAsked) pool.push({ type: 'pet', fam: f.id, text: Label(f) + ' ' + vb(f, 'asks', 'ask') + ' your permission to adopt a dog from the shelter. The neighbours may not love it.' });
    }
    const kidsCount = fams().reduce((a, f) => a + kids(f).length, 0);
    const upg = !S.upgrades.cameras && S.stats.arrests + (S.racket ? 1 : 0) > 0 ? 'cameras' : !S.upgrades.garden && kidsCount >= 3 ? 'garden' : !S.upgrades.solar && fams().length >= 6 ? 'solar' : !S.upgrades.pool && fams().length >= 10 && season() === 'summer' ? 'pool' : null;
    if (upg && !taken('upgrade', upg)) pool.push({ type: 'upgrade', fam: null, extra: upg, text: 'The residents collected signatures: they want ' + (upg === 'cameras' ? 'CCTV cameras' : 'a ' + UPGRADES[upg].label.toLowerCase()) + '. They will chip in ' + U.money(1500) + '.' });
    for (const u of shops()) {
      if (S.requests.some(r => r.unit === u.id)) continue;
      if (u.floor === 0 && ['cafe', 'pizzeria', 'gelateria', 'bakery'].includes(u.shop.type) && !u.shop.terrace) pool.push({ type: 'terrace', unit: u.id, text: U.cap(u.shop.name) + ' would like a terrace with tables on the pavement.' });
      if (!u.shop.neon) pool.push({ type: 'neon', unit: u.id, text: U.cap(u.shop.name) + ' asks for a neon sign: "Nobody sees us in the evening!"' });
    }
    if (!pool.length) return;
    const r = U.pick(pool);
    r.id = ++S.reqId; r.deadline = day() + REQ[r.type].days; S.lastReq = day();
    if (r.type === 'pet') S.fams[r.fam].petAsked = true;
    if (r.type === 'kitchen') S.fams[r.fam].newKitchen = true;
    S.requests.push(r);
    log('New request: ' + r.text, 'request', r.fam ? S.fams[r.fam].apt : r.unit);
    say(r.fam ? S.fams[r.fam].apt : r.unit, DATA.say.request[r.type]);
    banner('New request from ' + (r.fam ? S.fams[r.fam].apt : r.unit ? label3(unit(r.unit)) : 'the residents'), 'info');
    sound('alert'); fx(r.fam ? S.fams[r.fam].apt : r.unit, 'excl');
  }
  function reqDone(r) {
    const f = r.fam && S.fams[r.fam];
    switch (r.type) {
      case 'bigger': return f && SIZES[unitOf(f).size].cap > r.extra;
      case 'stairs': return f && (S.upgrades.lift || unitOf(f).floor === 1);
      case 'away': { const o = S.fams[r.extra]; return f && (!o || !neighbours(unitOf(f)).some(n => n.fam === o.id) || rel(f.id, o.id) > -15); }
      case 'shop': return hasShop(r.extra);
      case 'upgrade': return !!S.upgrades[r.extra];
      default: return !!r.paid;
    }
  }
  function requestTick(quiet) {
    for (const r of S.requests.slice()) {
      const f = r.fam && S.fams[r.fam], u = r.unit && unit(r.unit);
      if ((r.fam && !f) || (r.unit && (!u || !u.shop))) { S.requests.splice(S.requests.indexOf(r), 1); continue; }
      const def = REQ[r.type], who = f ? f.apt : u ? u.id : null;
      if (reqDone(r)) {
        S.requests.splice(S.requests.indexOf(r), 1);
        const w = def.reward;
        if (w.rep) repHit(w.rep);
        if (w.money) S.fund += w.money;
        if (w.boost) { if (f) f.boost += w.boost; else for (const o of fams()) o.boost += w.boost; }
        if (w.health && u) u.shop.health = Math.min(100, u.shop.health + w.health);
        say(who, U.pick(DATA.say.thanks));
        log('Request fulfilled: ' + r.text.split(':')[0].replace(/\.$/, '') + '. ' + (w.money ? 'They gave you ' + U.money(w.money) + '. ' : '') + 'Grateful smiles all round.', 'good', who);
        fx(who, 'heart'); sound('coin');
      } else if (day() > r.deadline) {
        S.requests.splice(S.requests.indexOf(r), 1);
        if (def.fail && f) { moveOut(f, def.fail(f), 'bad'); repHit(-3); }
        else if (f) { f.boost -= r.type === 'pet' ? 8 : 12; log(Label(f) + ' ' + vb(f, 'is', 'are') + ' disappointed: you ignored their request.', 'bad', who); repHit(-1); }
        else if (u) { u.shop.health -= r.type === 'terrace' ? 10 : 5; log(U.cap(u.shop.name) + ' gave up waiting for an answer.', 'bad', who); }
        else { for (const o of fams()) o.boost -= 4; repHit(-2); log('The residents\' petition was ignored. Grumbling in the stairwell.', 'bad'); }
      }
    }
    // At most two open requests, at least 12 days apart, about one every three weeks.
    if (!quiet && S.requests.length < 2 && day() - (S.lastReq || -99) >= 12 && U.chance(0.12)) newRequest();
  }
  // Requests you settle directly: pay for the kitchen, the terrace, the sign, or allow the dog.
  function fulfil(id) {
    const r = S.requests.find(x => x.id === id), def = r && REQ[r.type];
    if (!r || def.cost === undefined || S.fund < def.cost) return false;
    S.fund -= def.cost; r.paid = true;
    const f = r.fam && S.fams[r.fam], u = r.unit && unit(r.unit);
    if (r.type === 'pet' && f) { f.pet = 'dog'; if (!f.habits.includes('dog')) f.habits.push('dog'); }
    if (r.type === 'kitchen' && f) vehicle('repair', 6, f.apt);
    if (r.type === 'terrace' && u) { u.shop.terrace = true; vehicle('repair', 5, u.id); }
    if (r.type === 'neon' && u) u.shop.neon = true;
    requestTick(true);
    return true;
  }
  function decline(id) {
    const r = S.requests.find(x => x.id === id);
    if (!r) return false;
    r.deadline = day() - 1;
    requestTick(true);
    return true;
  }

  // ---------- common spaces ----------
  const hasCommon = (k) => S.units.some(u => u.kind === 'common' && u.common === k && !u.work && !u.burnt);
  const eventCooldown = () => hasCommon('commonroom') ? 7 : 14;
  function demolish(id) {
    const u = unit(id);
    if (!u || u.kind !== 'common' || u.work || S.fund < 500) return false;
    S.fund -= 500;
    log('The ' + DATA.commons[u.common].label.toLowerCase() + ' in ' + label3(u) + ' was cleared out. The space is free again.', 'info', u.id);
    u.kind = u.floor === 0 ? 'empty' : 'empty'; u.common = null;
    return true;
  }

  // ---------- the look of the building ----------
  function setLook(key, i) {
    const d = DATA.looks[key];
    if (!d || !d.opts[i] || S.look[key] === i || S.fund < d.cost) return false;
    S.fund -= d.cost; S.look[key] = i;
    if (key === 'name') log('A new brass plate at the door: "' + d.opts[i][0] + '".', 'good');
    else { log('The ' + d.label.toLowerCase() + ' is now ' + d.opts[i][0].toLowerCase() + '. The whole street stops to look.', 'good'); repHit(key === 'facade' ? 3 : 1); for (const f of fams()) f.boost += 3; vehicle('repair', 8); }
    sound('repair');
    return true;
  }
  const buildingName = () => DATA.looks.name.opts[S.look.name][0];

  // ---------- calendar ----------
  // The festivity of a given day (month 1-12, day of month).
  function festivity(d = date()) {
    const m = d.getMonth() + 1, dd = d.getDate();
    if ((m === 12 && dd >= 8) || (m === 1 && dd <= 6)) return 'christmas';
    if (m === 2 && dd >= 8 && dd <= 17) return 'carnival';
    if (m === 4 && dd >= 3 && dd <= 6) return 'easter';
    if ((m === 6 && dd >= 12) || (m === 7 && dd <= 12)) return 'football';
    if (m === 8 && dd >= 10 && dd <= 20) return 'ferragosto';
    if ((m === 10 && dd >= 25) || (m === 11 && dd <= 1)) return 'halloween';
    return null;
  }
  const FEST = {
    christmas: { label: 'Christmas', start: 'Christmas lights go up all over the building. The concierge set up a nativity scene in the lobby.' },
    carnival: { label: 'Carnival', start: 'It is Carnival! Children in costume and confetti on every stair.' },
    easter: { label: 'Easter', start: 'Easter: chocolate eggs for the children and lamb in every oven.' },
    football: { label: 'Summer tournament', start: 'The national team plays the summer tournament: flags on every balcony!' },
    ferragosto: { label: 'Ferragosto', start: 'Ferragosto: half the building has left for the seaside. The street is empty, the shops are closing for holidays.' },
    halloween: { label: 'Halloween', start: 'Pumpkins on the balconies: Halloween is coming.' }
  };
  function calendarTick() {
    const d = date(), m = d.getMonth() + 1, dd = d.getDate(), list = fams().filter(f => f.kind !== 'squatter');
    const fest = festivity();
    if (fest !== S.fest) { S.fest = fest; if (fest) { log(FEST[fest].start, 'fest'); banner(FEST[fest].label + '!', 'money'); sound('bell'); } }
    if (m === 12 && dd === 24) {
      for (const f of list) f.boost += f.savings < 0 ? -4 : 10;
      for (const a of list) for (const b of list) if (a.id < b.id && U.chance(0.3)) addRel(a.id, b.id, 4);
      log('Christmas Eve: tombola in the stairwell, panettone for everyone and a lot of shouting about the numbers.', 'fest'); sound('wedding');
    }
    if (m === 1 && dd === 1) { BUS.emit('fireworks'); log('Fireworks over Via Roma at midnight. The dog of the 3rd floor is not amused.', 'fest'); }
    if (m === 10 && dd === 31) {
      for (const f of list) { if (kids(f).length) f.boost += 8; if (has(f, 'moaner')) f.boost -= 4; }
      log('Halloween night: little ghosts and witches knocked on every door for sweets. ' + (list.some(f => has(f, 'moaner')) ? 'Somebody pretended not to be home.' : ''), 'fest');
    }
    if (fest === 'carnival' && U.chance(0.25)) { const f = U.pick(list.filter(x => kids(x).length)); if (f) { log(Label(f) + '\'s children threw confetti in the lift. It will take months to clean.', 'fest', f.apt); f.boost += 3; } }
    if (m === 4 && dd === 5) { for (const f of list) f.boost += 5; log('Easter Sunday: the smell of roast lamb fills the stairwell.', 'fest'); }
    if (fest === 'football' && d.getDay() % 3 === 0) footballMatch(list);
    // Seasonal nuisances.
    if ((m === 7 || m === 8) && U.chance(0.06)) { for (const f of list) f.boost -= 2; log(U.pick(['Mosquitoes everywhere: the whole building slept badly.', 'A tiger mosquito invasion: citronella candles on every balcony.']), 'bad'); }
    if ((m === 1 || m === 2) && U.chance(0.07) && list.length) { const f = U.pick(list); f.boost -= 6; log('Flu season: ' + label(f) + ' are in bed with a fever. Neighbours bring soup.', 'sad', f.apt); for (const o of list) if (o !== f && U.chance(0.3)) addRel(o.id, f.id, 3); }
    if (m === 9 && U.chance(0.05)) { const f = U.pick(list.filter(x => x.group)); if (f) moveOut(f, Label(f) + ' graduated and left to start their careers. The building is quieter.', 'info'); }
    if (m === 1 && dd === 2 && shops().length) log('The January sales have started: the shops are busy.', 'shop');
  }
  function footballMatch(list) {
    const r = Math.random(), opp = U.pick(['France', 'Germany', 'Spain', 'Brazil', 'England', 'Argentina', 'the Netherlands', 'Croatia']);
    if (r < 0.5) { for (const f of list) f.boost += 6; log('The national team beat ' + opp + ' ' + U.irand(1, 3) + '-0! Horns, flags and shouting from every window.', 'fest'); sound('party'); for (const f of list) if (U.chance(0.4)) { fx(f.apt, 'heart'); say(f.apt, 'GOOOAL!', Math.random() * 2); } }
    else if (r < 0.7) log('A draw against ' + opp + '. Half the building blames the referee.', 'fest');
    else { for (const f of list) f.boost -= 4; log('The national team lost to ' + opp + '. A silence of mourning over Via Roma.', 'sad'); for (const f of list) if (U.chance(0.4)) fx(f.apt, 'sad'); }
  }

  // ---------- city events ----------
  function cityEventTick() {
    const c = S.city, d = day(), list = fams();
    if (c.roadworks && c.roadworks <= d) { c.roadworks = 0; log('The roadworks in Via Roma are finally over. Silence, at last.', 'good'); }
    if (c.film && c.film <= d) c.film = 0;
    if (c.roadworks > d) for (const f of list) f.boost -= 1;
    if (!c.roadworks && U.chance(1 / 120)) {
      c.roadworks = d + U.irand(5, 14);
      log('The council dug up Via Roma: roadworks for ' + (c.roadworks - d) + ' days. Pneumatic drills at 7 a.m. and the shops lose customers.', 'bad'); banner('Roadworks in Via Roma!', 'bad');
    }
    if (!c.metro && d > 150 && U.chance(1 / 200)) {
      c.metro = true; repHit(5);
      log('A new metro station opened at the corner of Via Roma! Everybody wants to live here now: rents up 10%.', 'money'); banner('New metro station: rents +10%!', 'money'); sound('jackpot');
    }
    if (!c.film && fams().length >= 3 && U.chance(1 / 320) && !S.pending.some(p => p.type === 'film')) ask('film', { fee: U.irand(25, 60) * 100 });
    if (U.chance(1 / 160) && list.length >= 3) {
      const h = avgHappy(), good = h >= 60;
      repHit(good ? 4 : -4);
      const f = U.pick(list.filter(x => x.kind === 'normal')) || U.pick(list);
      log('The evening news interviewed ' + label(f) + ' outside the building. ' + (good ? '"Best building in the city!" Reputation up.' : '"The owner? Never seen him!" Reputation down.'), good ? 'good' : 'bad', f.apt);
      vehicle('tv', 4, null);
    }
    if (!c.mayorUntil && d > 90 && U.chance(1 / 300) && !S.pending.some(p => p.type === 'election')) ask('election', { cost: 1500 });
    if (c.mayorUntil && c.mayorUntil <= d) { c.mayorUntil = 0; log('The new mayor\'s term is over. No more favours from the council.', 'info'); }
  }

  // ---------- ticks ----------
  function hourTick() {
    if (S.over || S.crashing) return;
    const h = hour();
    if (h === 0) dayTick();
    if (S.over) return;
    workTick();
    eventTick();
    const list = fams();
    if (U.chance(0.04 * Math.min(1, list.length / 4))) socialEvent();
    if (h === 21 && (dow() === 5 || dow() === 6)) for (const f of list) if (has(f, 'party') && !f.party && U.chance(0.5)) startParty(f);
    for (const f of list) {
      if (!S.fams[f.id]) continue;
      if (f.party) partyTick(f);
      if (isNight(h)) secretTick(f);
      if (S.fams[f.id]) lifeEvents(f, 1 / 24);
    }
    for (const u of S.units) fireTick(u);
    disasterTick();
    if (S.blackout && S.t >= S.blackout) { S.blackout = 0; log('Power is back on.', 'info'); }
    if (S.flood && S.t >= S.flood) S.flood = 0;
    checkGoal();
  }
  function dayTick() {
    const d = day();
    newWeather();
    if (dow() === 1) weekTick();
    if (date().getDate() === 1) monthTick();
    if (d % 365 === 0 && d > 0) {
      for (const f of fams()) for (const m of f.members) { m.age++; if (m.age === 67 && m.job && !m.job.retired && f.kind === 'normal') m.job = { name: 'Retired', inc: round10(m.job.inc * 0.7), retired: true }; }
      log('Happy new year from Via Roma 26!', 'good');
    }
    for (const u of S.units) { emptyTick(u); if (u.shop && !u.work && !u.burnt) shopTick(u); }
    if (U.chance(0.04)) shopOffer();
    for (const f of fams()) {
      f.boost *= 0.85;
      f.happy = U.clamp(f.happy + (happyTarget(f) + f.boost - f.happy) * 0.2, 0, 100);
      if (S.upgrades.garden) for (const o of fams()) if (o.id > f.id) addRel(f.id, o.id, 0.15);
      if (hasCommon('commonroom')) for (const o of fams()) if (o.id > f.id) addRel(f.id, o.id, 0.3);
      if (f.kind === 'squatter') continue;
      f.unhappyDays = f.happy < 20 ? f.unhappyDays + 1 : 0;
      if (f.unhappyDays >= 10) moveOut(f, Label(f) + ' were fed up with the building and moved out. "Never again a condominium!"', 'bad');
    }
    for (const k in S.rel) S.rel[k] *= 0.995;
    neighbourTick();
    S.rep = U.clamp(S.rep + (repTarget() - S.rep) * 0.04, 0, 100);
    cityTick();
    racketTick();
    laterTick();
    requestTick();
    calendarTick();
    cityEventTick();
    if (S.over) return;
    if (S.fund < -10000) return gameOver('fund', 'The bank seized the building: your debts are out of control.');
    if (U.chance(0.012) && fams().length >= 3) {
      const options = Object.keys(UPGRADES).filter(k => !S.upgrades[k]);
      if (options.length) ask('proposal', { up: U.pick(options) });
    }
    save();
  }
  function gameOver(reason, text) {
    S.over = { reason, text, day: day() };
    log(text, 'disaster');
    clearSave();
    BUS.emit('gameover', S.over);
  }

  function advance(hours) {
    if (!S || S.over || S.crashing) return;
    const target = S.t + hours;
    while (Math.floor(target) > Math.floor(S.t) && !S.over && !S.crashing) {
      S.t = Math.floor(S.t) + 1;
      hourTick();
    }
    if (!S.over && !S.crashing) S.t = target;
  }

  // ---------- decisions ----------
  const DEC = {
    applicants: {
      build(c) {
        const u = unit(c.apt);
        return { title: 'New tenants for ' + SIZES[u.size].label.toLowerCase() + ' ' + c.apt, text: 'Rent ' + U.money(rentOf(u)) + ' a month. Three applicants want it:', cands: c.cands, options: c.cands.map(f => 'Choose ' + label(f)).concat(['Not now']) };
      },
      resolve(c, i) { const u = unit(c.apt); if (i < c.cands.length && u && !u.fam) moveIn(c.cands[i], u); }
    },
    shopoffer: {
      build(c) {
        const u = unit(c.u), sh = c.shop, d = DATA.shops[sh.type];
        return {
          title: 'A business wants ' + label3(u), text: sh.owner.first + ' ' + c.who + ' wants to open "' + sh.name + '" (' + d.label.toLowerCase() + ') here and will pay for the fit-out. Rent: ' + U.money(Math.round(d.rent * 0.7 * RENT_MUL[S.rentLevel] / 10) * 10) + ' a month (30% off). ' + d.desc,
          options: ['Accept', 'No, thanks']
        };
      },
      resolve(c, i) {
        const u = unit(c.u);
        if (i !== 0 || !u || u.work || u.burnt || u.shop || (u.kind !== 'shop' && u.kind !== 'empty')) return;
        u.kind = 'shop'; u.shop = c.shop; u.work = S.t + FIT_HOURS;
        log(U.cap(c.shop.name) + ' is fitting out ' + label3(u) + '. Opening soon!', 'good', u.id); vehicle('repair', 5, u.id);
      }
    },
    squatters: {
      build(c) {
        const f = S.fams[c.f];
        return { title: 'Squatters in ' + (f ? f.apt : '?'), text: 'A group of squatters has occupied the empty apartment. The neighbours are furious. What do you do?', options: ['Call the police (' + U.money(300) + ' legal fees)', 'Offer them a cheap lease', 'Let them stay'] };
      },
      resolve(c, i) {
        const f = S.fams[c.f];
        if (!f) return;
        if (i === 0) {
          S.fund -= 300; vehicle('police', 4, f.apt); sound('siren');
          if (U.chance(0.75)) moveOut(f, 'The police evicted the squatters from ' + f.apt + '. The neighbours applauded.', 'good');
          else log('The squatters in ' + f.apt + ' barricaded the door. The police will try again some other day.', 'bad', f.apt);
        } else if (i === 1) {
          if (U.chance(0.5)) {
            f.kind = 'normal'; f.name = freeSurname(); f.group = true;
            for (const m of f.members) m.job = { name: U.pick(['Street artist', 'Busker', 'Bike courier', 'Dishwasher']), inc: U.irand(700, 1100) };
            f.savings = 300; f.ls = 0;
            log('The squatters accepted the deal and signed a lease. They even painted the door.', 'good', f.apt);
          } else log('The squatters laughed at your offer: "Property is theft!"', 'bad', f.apt);
        } else { log('You let the squatters stay. The neighbours are not pleased.', 'bad', f.apt); for (const o of fams()) if (o !== f) o.boost -= 6; }
      }
    },
    bribe: {
      build(c) {
        const f = S.fams[c.f];
        return { title: 'An envelope under your door', text: (f ? Label(f) + ' (' + f.apt + ')' : 'A tenant') + ' left an envelope with ' + U.money(c.amount) + ' and a note: "For your trouble. You never saw the vans."', options: ['Keep the money', 'Report them to the police', 'Return it and say nothing'] };
      },
      resolve(c, i) {
        const f = S.fams[c.f];
        if (!f) return;
        if (i === 0) { S.fund += c.amount; f.secret.bribed = true; f.secret.sus = Math.max(f.secret.sus - 2, 0); log('You pocketed ' + U.money(c.amount) + '. Nobody asks where it came from. Yet.', 'money'); }
        else if (i === 1) { f.secret.sus += 3; if (U.chance(0.7)) raid(f); else log('The police took notes about ' + f.apt + ' and promised to look into it.', 'info', f.apt); }
        else log('You returned the envelope. ' + Label(f) + ' smiled a little too widely.', 'info', f.apt);
      }
    },
    mystery: {
      build(c) {
        const f = S.fams[c.f];
        return { title: 'The mystery of ' + (f ? f.apt : '?'), text: 'The neighbours keep talking about ' + (f ? label(f) : 'the tenant') + '. Strange lights, odd visitors, no one ever sees them by day. Do you investigate?', options: ['Knock on their door', 'Mind your own business'] };
      },
      resolve(c, i) {
        const f = S.fams[c.f];
        if (!f) return;
        if (i === 0) { if (U.chance(0.8)) reveal(f); else log('Nobody answered the door of ' + f.apt + ', but the peephole went dark.', 'mystery', f.apt); }
        else { f.secret.asked = false; f.secret.sus = 0; log('You decided not to pry. The gossip continues.', 'info'); }
      }
    },
    feud: {
      build(c) {
        const a = S.fams[c.a], b = S.fams[c.b], law = hasShop('lawyer');
        return { title: 'A feud is brewing', text: (a && b ? Label(a) + ' and ' + label(b) : 'Two families') + ' cannot stand each other any more. Lawyers have been mentioned.', options: ['Mediate yourself (free, 50%)', 'Hire a mediator (' + U.money(law ? 200 : 500) + ', ' + (law ? 95 : 85) + '%)', 'Let them fight it out'] };
      },
      resolve(c, i) {
        const a = S.fams[c.a], b = S.fams[c.b];
        if (!a || !b) return;
        const law = hasShop('lawyer');
        const ok = i === 0 ? U.chance(0.5) : i === 1 ? U.chance(law ? 0.95 : 0.85) : false;
        if (i === 1) S.fund -= law ? 200 : 500;
        if (ok) { addRel(a.id, b.id, 45); a.boost += 8; b.boost += 8; log(Label(a) + ' and ' + label(b) + ' shook hands. Peace is restored, for now.', 'good', a.apt); fx(a.apt, 'heart'); fx(b.apt, 'heart'); }
        else if (i < 2) { addRel(a.id, b.id, -10); log('The mediation between ' + label(a) + ' and ' + label(b) + ' ended with a slammed door.', 'quarrel', a.apt); }
        else feudEvent(a, b);
      }
    },
    film: {
      build(c) { return { title: 'Lights, camera, action!', text: 'A film crew wants to shoot a romantic comedy in the building for two days and offers ' + U.money(c.fee) + '. Some residents will love it, others will hate the cables on the stairs.', options: ['Accept (' + U.money(c.fee) + ')', 'No, thanks'] }; },
      resolve(c, i) {
        if (i !== 0) return;
        S.fund += c.fee; S.city.film = day() + 2; repHit(3);
        for (const f of fams()) f.boost += has(f, 'moaner') || has(f, 'neat') ? -6 : 6;
        log('The film crew moved in with lights and cameras. ' + U.pick(['A famous actor signed autographs in the lobby.', 'The director cast the concierge as an extra.', 'They shot the kiss scene on the 2nd-floor balcony eleven times.']), 'fest');
        vehicle('film', 48, null);
      }
    },
    election: {
      build(c) { return { title: 'Municipal elections', text: 'The election for mayor is close. One candidate promises "faster permits and fewer inspections for friends". He would appreciate a donation of ' + U.money(c.cost) + '. If he loses, the other side will remember.', options: ['Donate ' + U.money(c.cost), 'Stay neutral'] }; },
      resolve(c, i) {
        if (i !== 0) return;
        S.fund -= c.cost;
        if (U.chance(0.5)) { S.city.mayorUntil = day() + 365; log('Your candidate won the election! For a year, permits will be faster and inspections rarer.', 'good'); banner('Your candidate is mayor!', 'money'); S.nextInspect = day() + 150; }
        else { repHit(-3); S.nextInspect = day() + 10; log('Your candidate lost. The new mayor read the list of donors. Expect an inspection soon.', 'bad'); }
      }
    },
    permit: {
      build(c) {
        return { title: 'Building permit', text: 'The council clerk says your permit for the ' + U.ordinal(S.floors + 1) + ' floor will take ' + c.days + ' days. Then he looks at the ceiling and sighs: "Unless, of course..."', options: ['Wait ' + c.days + ' days', 'Slip him an envelope (' + U.money(c.bribe) + '): permit tomorrow', 'Hire a consultant (' + U.money(800) + '): half the time'] };
      },
      resolve(c, i) {
        if (!S.permit) return;
        if (i === 1 && S.fund >= c.bribe) { S.fund -= c.bribe; S.permit.ready = day() + 1; log('The clerk found your file "by chance" at the top of the pile.', 'info'); scandalLater('council clerk', 0.3); }
        else if (i === 2 && S.fund >= 800) { S.fund -= 800; S.permit.ready = day() + Math.ceil(c.days / 2); log('A consultant is pushing your permit through the council. ' + Math.ceil(c.days / 2) + ' days.', 'info'); }
        else log('You wait for the permit like everybody else.', 'info');
      }
    },
    inspection: {
      build(c) {
        return { title: 'City inspection', text: 'A city inspector found problems: ' + c.issues.join(', ') + '. The fine is ' + U.money(c.fine) + '.', options: ['Pay the fine (' + U.money(c.fine) + ')', 'Bribe the inspector (' + U.money(Math.round(c.fine * 0.4)) + ')', 'Contest it in court (50%)'] };
      },
      resolve(c, i) {
        if (i === 0) { S.fund -= c.fine; repHit(-2); log('You paid the inspector\'s fine of ' + U.money(c.fine) + '. Fix those problems before the next visit!', 'bad'); }
        else if (i === 1) { S.fund -= Math.round(c.fine * 0.4); log('The inspector pocketed the envelope and "forgot" his notes.', 'info'); scandalLater('city inspector', 0.3); }
        else if (U.chance(0.5)) log('The judge cancelled the inspector\'s fine. Lucky!', 'good');
        else { S.fund -= Math.round(c.fine * 1.5); repHit(-4); log('You lost against the city and paid ' + U.money(Math.round(c.fine * 1.5)) + '.', 'bad'); }
      }
    },
    racket: {
      build(c) {
        return {
          title: 'An offer you cannot refuse',
          text: c.step === 0 ? 'Two men in shiny suits visited your shops. For ' + U.money(c.weekly) + ' a week, they say, nothing bad will happen to them. "It would be a shame if something caught fire."' : 'The men in shiny suits are back, looking at the broken glass. The price went up: ' + U.money(c.weekly) + ' a week.',
          options: ['Pay ' + U.money(c.weekly) + ' a week', 'Refuse', 'Report them to the police']
        };
      },
      resolve(c, i) {
        if (i === 0) { S.racket = { state: 'paying', weekly: c.weekly }; log('You pay ' + U.money(c.weekly) + ' a week for "protection". Nobody must know.', 'bad'); repHit(-2); }
        else if (i === 1) { S.racket = { state: 'refused', weekly: c.weekly, step: c.step + 1, next: day() + U.irand(6, 14) }; log('You told the men in suits to get lost. They smiled.', 'info'); }
        else { S.racket = { state: 'reported', next: day() + U.irand(5, 10) }; log('You reported the racketeers to the police. An investigation has started.', 'info'); repHit(2); }
      }
    },
    lawsuit: {
      build(c) {
        const law = hasShop('lawyer');
        return { title: 'You are being sued', text: c.who + ' is suing you ' + c.why + ' and asks for ' + U.money(c.amount) + '. If you lose in court, it costs double.', options: ['Settle (' + U.money(c.amount) + ')', 'Go to court (lawyer ' + U.money(law ? 200 : 500) + ', ' + (law ? 70 : 50) + '% to win)'] };
      },
      resolve(c, i) {
        if (i === 0) { S.fund -= c.amount; repHit(-1); log('You settled with ' + c.who + ' for ' + U.money(c.amount) + '.', 'bad'); }
        else { const law = hasShop('lawyer'); S.fund -= law ? 200 : 500; S.later.push({ day: day() + U.irand(20, 40), type: 'court', who: c.who, amount: c.amount, law }); log('The case with ' + c.who + ' goes to court. Hearing in a few weeks.', 'info'); }
      }
    },
    complaints: {
      build(c) {
        const f = S.fams[c.f];
        return { title: 'Complaints about ' + (f ? f.apt : '?'), text: 'Several neighbours have complained about ' + (f ? label(f) : 'a tenant') + ': noise, parties, the dog, the music. They want you to do something.', options: ['Send a formal warning', 'Fine them ' + U.money(300) + ' (lease clause)', 'Ignore the complaints'] };
      },
      resolve(c, i) {
        const f = S.fams[c.f];
        if (!f) return;
        const ns = neighbours(unitOf(f)).map(famOf).filter(Boolean);
        if (i === 0) {
          f.warned = day() + 60; f.boost -= 10; for (const o of ns) o.boost += 5;
          if (U.chance(0.15)) moveOut(f, Label(f) + ' were offended by your warning and moved out.', 'bad');
          else log('You sent ' + label(f) + ' a formal warning. Things should calm down for a while.', 'info', f.apt);
        } else if (i === 1) {
          f.warned = day() + 40; f.boost -= 20; f.savings -= 300; S.fund += 300; for (const o of ns) o.boost += 5;
          log('You fined ' + label(f) + ' ' + U.money(300) + '. They slammed the door, but the music stopped.', 'info', f.apt);
        } else { for (const o of ns) o.boost -= 6; repHit(-4); log('You ignored the complaints about ' + label(f) + '. The neighbours talk about you now.', 'bad', f.apt); }
      }
    },
    proposal: {
      build(c) {
        const u = UPGRADES[c.up];
        return { title: 'The residents propose: ' + u.label, text: 'The residents offer to pay half of the ' + u.label.toLowerCase() + ' (' + U.money(u.cost) + '). ' + u.desc + ' You pay ' + U.money(u.cost / 2) + '.', options: ['Approve (' + U.money(u.cost / 2) + ')', 'Reject'] };
      },
      resolve(c, i) {
        if (i === 0) {
          if (S.fund < UPGRADES[c.up].cost / 2) { log('Not enough money for the ' + UPGRADES[c.up].label.toLowerCase() + '.', 'bad'); return; }
          S.fund -= UPGRADES[c.up].cost / 2; applyUpgrade(c.up);
        } else { log('You rejected the residents\' proposal. Grumbling in the stairwell.', 'info'); for (const f of fams()) f.boost -= 3; }
      }
    }
  };
  function decision() {
    const p = S && S.pending[0];
    if (!p) return null;
    const drop = () => { S.pending.shift(); return decision(); };
    if ((p.ctx.f && !S.fams[p.ctx.f]) || (p.ctx.a && (!S.fams[p.ctx.a] || !S.fams[p.ctx.b]))) return drop();
    if (p.type === 'applicants') { const u = unit(p.ctx.apt); if (!u || u.fam || u.burnt || u.sealed || u.work || u.kind !== 'apt') return drop(); }
    if (p.type === 'shopoffer') { const u = unit(p.ctx.u); if (!u || u.work || u.burnt || u.sealed || u.shop || (u.kind !== 'shop' && u.kind !== 'empty')) return drop(); }
    if (p.type === 'proposal' && S.upgrades[p.ctx.up]) return drop();
    return { type: p.type, ...DEC[p.type].build(p.ctx) };
  }
  function decide(i) {
    const p = S.pending.shift();
    if (p) DEC[p.type].resolve(p.ctx, i);
    sound('click');
    checkGoal();
    save();
  }

  // ---------- player actions ----------
  // Why the next floor cannot be built yet (null when it can).
  function floorBlock() {
    const next = S.floors + 1;
    if (S.floors >= MAX_FLOORS) return 'The city does not allow more than ' + MAX_FLOORS + ' floors.';
    if (S.floorWork) return 'A floor is already being built.';
    if (next >= 5 && !S.upgrades.lift) return 'The law requires a lift for buildings of five floors or more.';
    if (next >= 7 && !S.upgrades.escape) return 'The law requires a fire escape above the 6th floor.';
    if (!S.permit) return 'You need a building permit first.';
    if (S.permit.state !== 'granted') return 'The building permit is still being processed (' + Math.max(1, S.permit.ready - day()) + ' days).';
    return null;
  }
  function canBuildFloor() { return !floorBlock() && S.fund >= floorCost() && !S.crashing; }
  function applyPermit() {
    if (S.permit || S.floorWork || S.floors >= MAX_FLOORS || S.fund < 500) return false;
    S.fund -= 500;
    const days = Math.max(3, Math.round(U.irand(10, 18) * (1.4 - S.rep / 100) * (S.city && S.city.mayorUntil > day() ? 0.5 : 1)));
    S.permit = { state: 'pending', ready: day() + days, floor: S.floors + 1 };
    log('You applied for a permit to build the ' + U.ordinal(S.floors + 1) + ' floor. The council says ' + days + ' days.', 'info');
    ask('permit', { days, bribe: 800 + S.floors * 300 });
    return true;
  }
  function buildFloor() {
    if (!canBuildFloor()) return false;
    const c = floorCost();
    S.permit = null;
    S.fund -= c; S.floorWork = S.t + FLOOR_HOURS;
    log('Construction of the ' + U.ordinal(S.floors + 1) + ' floor has started (' + U.money(c) + '). Expect noise and dust for a day and a half.', 'info');
    vehicle('truck', FLOOR_HOURS, null); sound('repair');
    for (const f of fams()) f.boost -= 3;
    return true;
  }
  function buildCost(u, what) {
    const base = SIZES[what] ? SIZES[what].cost : DATA.commons[what] ? DATA.commons[what].cost : Math.round(DATA.shops[what].cost * SHOP_COST / 100) * 100;
    if (u.burnt) return Math.round(base * 0.6);
    if (!SIZES[what] && u.kind === 'shop') return Math.round(base * 0.5); // refit of a vacant shop
    return base;
  }
  // what: 'studio' | 'flat' | 'luxury' | a shop type
  function build(id, what) {
    const u = unit(id);
    if (!u || u.work || u.fam || (u.shop && !u.burnt) || u.sealed || u.fire) return false;
    const isApt = !!SIZES[what], common = DATA.commons[what];
    if (isApt && u.floor === 0) return false;
    if (what === 'penthouse' && u.floor !== S.floors) return false;
    if (common && (common.where === 'ground') !== (u.floor === 0) && common.where !== 'any') return false;
    if (common && hasCommon(what)) return false;
    if (!isApt && !common && DATA.shops[what].where !== (u.floor === 0 ? 'ground' : 'upper')) return false;
    if ((u.kind === 'apt' || u.kind === 'common') && !u.burnt) return false;
    const c = buildCost(u, what);
    if (S.fund < c) return false;
    S.fund -= c;
    u.burnt = false; u.ruin = null; u.emptyDays = 0;
    if (isApt) { u.kind = 'apt'; u.size = what; u.shop = null; u.common = null; }
    else if (common) { u.kind = 'common'; u.common = what; u.size = null; u.shop = null; }
    else { u.kind = 'shop'; u.size = null; u.shop = genShop(what); u.common = null; }
    u.work = S.t + FIT_HOURS;
    log((isApt ? 'Works started on a new ' + SIZES[what].label.toLowerCase() : common ? 'Works started on the ' + common.label.toLowerCase() : 'Fit-out started for ' + u.shop.name + ' (' + DATA.shops[what].label.toLowerCase() + ')') + ' in ' + label3(u) + ' (' + U.money(c) + ').', 'info', u.id);
    vehicle('repair', FIT_HOURS, u.id); sound('repair');
    return true;
  }
  function closeBusiness(id) {
    const u = unit(id);
    if (!u || !u.shop || u.work) return false;
    closeShop(u, 'You ended the lease of ' + u.shop.name + '. The shutters came down.');
    return true;
  }
  function applyUpgrade(k) {
    S.upgrades[k] = true;
    log('New: ' + UPGRADES[k].label.toLowerCase() + '! ' + UPGRADES[k].desc, 'good');
    for (const f of fams()) f.boost += 5;
    vehicle('repair', 8); sound('repair'); BUS.emit('works', k);
    checkGoal();
  }
  function buy(k) {
    const u = UPGRADES[k];
    if (S.upgrades[k] || S.fund < u.cost) return false;
    S.fund -= u.cost; applyUpgrade(k); return true;
  }
  function setRent(i) {
    if (i === S.rentLevel) return;
    const up = i > S.rentLevel;
    S.rentLevel = i;
    log('Rents set to ' + RENT_NAMES[i].toLowerCase() + '.' + (up ? ' The tenants grumble.' : ' The tenants cheer.'), up ? 'bad' : 'good');
    for (const f of fams()) f.boost += up ? -6 : 4;
  }
  function meeting() {
    if (day() - S.lastMeeting < 30 || fams().length < 2) return false;
    S.lastMeeting = day();
    const list = fams().filter(f => f.kind !== 'squatter');
    const r = Math.random() + (S.upgrades.garden ? 0.1 : 0);
    if (r > 0.5) {
      log(U.pick(DATA.meetingGood), 'good');
      for (const a of list) { a.boost += 6; for (const b of list) if (a.id < b.id) addRel(a.id, b.id, U.irand(2, 8)); }
    } else if (r > 0.15) {
      log(U.pick(DATA.meetingBad), 'quarrel');
      for (let i = 0; i < 4; i++) { const a = U.pick(list), b = U.pick(list); if (a !== b) addRel(a.id, b.id, -U.irand(4, 10)); }
    } else {
      log('At the meeting the residents put forward a proposal.', 'info');
      const options = Object.keys(UPGRADES).filter(k => !S.upgrades[k]);
      if (options.length) ask('proposal', { up: U.pick(options) });
    }
    sound('bell');
    return true;
  }
  function advertise(id) {
    const u = unit(id);
    if (!u || u.kind !== 'apt' || u.fam || u.burnt || u.sealed || u.work || S.fund < 150 || S.pending.some(p => p.type === 'applicants')) return false;
    S.fund -= 150;
    log('You put an ad for apartment ' + id + ' online.', 'info', id);
    ask('applicants', { apt: id, cands: candidates(u) });
    return true;
  }
  function evictCost(f) { return justified(f) ? 800 : 3000; }
  function justified(f) { return f.kind === 'squatter' || f.arrears >= 3 || (f.secret && f.secret.revealed && f.kind === 'shady'); }
  function evict(id) {
    const f = S.fams[id];
    if (!f || S.fund < evictCost(f)) return false;
    const fair = justified(f);
    S.fund -= evictCost(f);
    vehicle('police', 4, f.apt);
    moveOut(f, fair ? Label(f) + ' were evicted from ' + f.apt + '.' : 'You evicted ' + label(f) + ' from ' + f.apt + ' for no good reason. The residents are shocked.', fair ? 'info' : 'bad');
    if (!fair) { for (const o of fams()) o.boost -= 8; repHit(-10); lawsuit(Label(f), U.irand(30, 60) * 100, 'for wrongful eviction'); }
    return true;
  }
  function knock(id) {
    const f = S.fams[id];
    if (!f || f.knocked === day()) return false;
    f.knocked = day();
    if (f.secret && !f.secret.revealed) {
      if (f.secret.kind === 'mystery' && U.chance(0.35)) reveal(f);
      else { f.secret.sus++; log(f.kind === 'shady' ? Label(f) + ' opened the door just a crack: "Everything is fine. Goodbye."' : 'Nobody answered at ' + f.apt + ', but someone was breathing behind the door.', 'mystery', f.apt); }
    } else if (f.kind === 'squatter') {
      log('The squatters offered you herbal tea and a lecture on the housing crisis.', 'info', f.apt);
    } else {
      const lines = ['offered you coffee and talked about the weather for twenty minutes.', 'showed you photos of their holidays. All 400 of them.',
        'complained about the neighbours, but kindly.', 'thanked you for keeping the building so lively.', 'gave you a slice of cake.'];
      log(Label(f) + ' ' + U.pick(lines), 'social', f.apt);
      say(f.apt, U.pick(['Come in, come in!', 'Coffee?', 'What a surprise!']));
      f.boost += 4; fx(f.apt, 'heart');
    }
    return true;
  }

  // Test hook to trigger disasters on demand.
  function disaster(name) {
    ({ quake: () => earthquake(), fire: () => startFire(randUnit()), flood, lightning, hail, nearmiss: nearMiss, plane: planeCrash })[name]();
  }

  return {
    START, MAX_FLOORS, RENT_NAMES, RENT_MUL, LIFESTYLES, SIZES, UPGRADES, FIT_HOURS, FLOOR_HOURS,
    get S() { return S; },
    newGame, load, save, hasSave, clearSave, advance, crashDone,
    day, hour, date, dateStr, dow, season, isNight, fams, unit, famOf, unitOf, label, Label, label3, income, monthlyCosts, rentOf, shopRent, upkeep,
    rel, relName, residents, rating, avgHappy, goal, decision, decide, floorCost, canBuildFloor, buildFloor, buildCost, build, closeBusiness,
    buy, setRent, meeting, advertise, evict, evictCost, justified, knock, disaster, has, startFire, neighbours, shops,
    festivity, FEST, hasCommon, demolish, setLook, buildingName, eventCooldown,
    STAFF, EVENTS, MOVE_COST, REQ, hire, staffCost, organize, relocate, freeApts, fulfil, decline, checkRequests: () => requestTick(true), newRequest,
    LOANS, repName, repMul, loanRate, debt, creditLimit, weeklyFor, borrow, repay, floorBlock, applyPermit, fitFor, stopRacket, adjacent, compatDetail, shopCompat
  };
})();
