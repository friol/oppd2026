// Game engine: state, time, parser, generic verbs and rules.
// No DOM access here: output goes through OUT(text, cls), set by ui.js.
'use strict';

let S = null;                       // the whole game state (plain JSON data)
let OUT = () => {};                 // output sink
let RENDER = () => {};              // called after every command (art + status)
let SHOWMAP = () => {};             // opens the full-screen map (set by ui.js)
let MUSIC = () => {};               // music on/off/toggle (set by ui.js)
let spent = false;                  // did the current command already pass time?

const START = 7 * 60;               // Monday 07:00
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const INDOOR_ZONES = new Set(['home', 'office', 'mall', 'club', 'laura', 'park']);
const OUTDOOR = new Set(['elm', 'parkgate', 'oak', 'pond', 'playground', 'alley', 'maple', 'rose', 'avnorth', 'busstop',
  'avsouth', 'church', 'plaza', 'business', 'neon', 'clubdoor', 'construction', 'site', 'oldtown']);
const SAVE_KEY = 'pnta17:save';

function say(text, cls) { OUT(String(text), cls || ''); }

// ------------------------------------------------------------------ state
function newState() {
  const where = {};
  for (const id in I) where[id] = I[id].at || null;
  return {
    loc: 'bedroom', visited: { bedroom: true }, prev: null, t: START, cash: 60, bank: 1150, atm: {}, where, worn: {}, f: {},
    deeds: {}, score: 0, love: 55, boss: 50, fit: 0, turn: 0, work: {}, contact: {}, daily: {}, once: {},
    enc: null, over: null, asleep: false, light: 'red', lc: 0, collapse: false, pc: false, mini: null,
  };
}

// ------------------------------------------------------------------- time
const pad = (n) => String(n).padStart(2, '0');
function D(t) { return Math.floor((t === undefined ? S.t : t) / 1440); }
function H(t) { return ((t === undefined ? S.t : t) % 1440) / 60; }
function clock(t) { const m = (t === undefined ? S.t : t) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
function at(d, h) { return d * 1440 + Math.round(h * 60); }
function within(a, b) { const h = H(); return a <= b ? (h >= a && h < b) : (h >= a || h < b); }
function weekday() { return D() < 5; }
function night() { return within(20, 6); }
function nightId() { return H() < 6 ? D() - 1 : D(); }

// Advance the clock minute by minute, firing timed events.
// Returns false if an event interrupted the wait.
function advance(m) {
  spent = true;
  const end = S.t + m;
  while (S.t < end && !S.over) {
    S.t++;
    if (minuteEvent(S.t) === 'stop') return false;
  }
  return !S.over;
}
function advanceTo(t) { return t > S.t ? advance(t - S.t) : true; }

function minuteEvent(t) {
  const d = D(t), m = t % 1440;
  if (m === 17 * 60 && d < 5) workEval(d);
  if (!S.over && weekEvent(d, m) === 'stop') return 'stop';
  if (S.over) return 'stop';
  if (m === 0) {
    if (d === 3 && !S.f.elecPaid && !S.f.powerCut) {
      S.f.powerCut = true; S.f.lateBill = true;
      say('[SMS] City Power: "Your electricity bill is overdue. Supply DISCONNECTED. Pay at the post office (+$' + ELEC_FEE + ' reconnection fee)."', 'sms');
    }
    if (d === 5 && !S.f.gasPaid && !S.f.gasCut) {
      S.f.gasCut = true; S.f.lateBill = true;
      say('[SMS] City Gas: "Your gas bill is overdue. Supply DISCONNECTED. Late fee: $' + GAS_FEE + '."', 'sms');
    }
  }
  if (d === 5 && m === 12 * 60 && !S.f.rentPaid) {
    gameOver('Saturday, noon. Mr. Kowalski climbs the stairs with a locksmith. "No rent, no flat. Is nothing personal." ' +
      'Your stuff ends up in boxes in the lobby. Laura finds you sleeping on her sofa and asks a lot of questions. The proposal will have to wait.', 'evicted');
    return 'stop';
  }
  if (m === 23 * 60 && d < 5 && !S.contact[d]) {
    say('[SMS] Laura: "You didn\'t call me today. Not even once. Goodnight, I guess."', 'sms');
    love(-5);
    if (S.over) return 'stop';
  }
  if (d === 2 && m === 20 * 60 + 45 && !S.f.wedDinner) {
    say('[SMS] Laura: "The lasagna is cold. So am I. Thanks for NOTHING."', 'sms');
    love(-25);
    if (S.over) return 'stop';
  }
  if (m === 4 * 60 && d > 0 && !S.f['catfed' + (d - 1)]) catRevenge(d - 1);
  if (m === 60 && !S.asleep) { S.collapse = true; return 'stop'; }
  if (d === 2 && m === 22 * 60 + 40 && S.asleep && L[S.loc].zone === 'home' && !S.f.burglarDone) {
    S.asleep = false;
    say('CRACK! A noise from the landing jolts you awake. It sounds like somebody forcing a door...', 'warn');
    return 'stop';
  }
  if (d === 5 && m === 19 * 60 + 45 && S.loc === 'restaurant') {
    contact();
    say('Laura walks in, wearing her green dress. Your heart does a somersault. "Happy anniversary," she smiles, sitting down. This is the moment: you could PROPOSE.');
    return 'stop';
  }
  if (d === 5 && m === 21 * 60 + 30) {
    if (S.loc === 'restaurant') {
      gameOver('Laura folds her napkin. "It\'s getting late." She asks for the bill. "I thought tonight you were going to... never mind." The moment is gone.', 'lose');
    } else {
      gameOver('[SMS] Laura: "I waited at Luigi\'s for an HOUR AND A HALF. On our ANNIVERSARY. Don\'t call me. Ever."', 'dumped');
    }
    return 'stop';
  }
  return null;
}

// --------------------------------------------------------------- work
function workEval(d) {
  if (S.over) return;
  const w = S.work[d] || {};
  const pen = (w.am ? 0 : 20) + (w.pm ? 0 : 20);
  if (pen) {
    say(`[E-MAIL] Mr. Grumman: "${pen === 40 ? 'Where WERE you today?!' : 'HALF a day of work? Is this a joke?'}" (Boss -${pen})`, 'warn');
    bossMood(-pen);
    if (S.over) return;
  }
  if (d === 3 && !S.f.reportDone) {
    say('[E-MAIL] Mr. Grumman: "It is 5 PM on THURSDAY. Where is my QUARTERLY REPORT?!" (Boss -30)', 'warn');
    bossMood(-30);
    if (S.over) return;
  }
  if (d === 4) {
    S.bank += SALARY;
    say(`[SMS] First City Bank: "Salary credited: $${SALARY}. Balance: $${S.bank}."`, 'sms');
    if (S.f.presBonus) { S.bank += 150; say('[SMS] First City Bank: "Bonus credited: $150 (Friday presentation)."', 'sms'); }
    if (S.boss >= 80) { S.bank += 200; say('[E-MAIL] Mr. Grumman: "Good week. There is a $200 bonus in your account. Don\'t get used to it."', 'sms'); }
  }
}

function doWork() {
  const d = D();
  if (d > 4) { say('It\'s the weekend! Even Mr. Grumman is on the golf course.'); return; }
  const w = S.work[d] || (S.work[d] = {});
  w.arrived = true;
  const flavour = ['A customer claims a seagull stole his car keys. You file it under "Acts of God".',
    'You fill in forms about forms. Ben shows you a meme. You laugh too loud.',
    'The air conditioning breaks, then fixes itself, then breaks again.',
    'You answer 43 e-mails. 44 new ones arrive.'];
  if (H() < 13) {
    if (w.am) { say('You already did the morning shift. It\'s lunch break from 1 PM.'); return; }
    w.am = true;
    say('You sit down and attack the mountain of folders. ' + flavour[d % 4]);
    if (d === 4 && !S.f.meetingDone && H() < 11) {
      if (H() < 10.5 && !advanceTo(at(4, 10.5))) return;
      if (S.over || S.f.meetingDone) return;
      startMeeting();
      return;
    }
    if (advanceTo(at(d, 13))) say('1 PM: lunch break! You are free until 2 PM.');
    return;
  }
  if (H() < 17) {
    if (w.pm) { say('You already did the afternoon shift.'); return; }
    w.pm = true;
    say('Back to the grind. ' + flavour[(d + 2) % 4]);
    if (advanceTo(at(d, 17))) say('5 PM! Another day survived. You are free.');
    return;
  }
  say('Office hours are over (9 to 5, lunch 1 to 2). Go home!');
}

// ------------------------------------------------------------- items
function visible(id) { const h = I[id].hidden; return !(h && h()); }
function has(id) { return S.where[id] === 'inv'; }
function here(id) { return S.where[id] === S.loc && visible(id); }
function invList() { return Object.keys(I).filter(has); }
function load() { return invList().reduce((a, id) => a + I[id].w, 0); }
function cap() { return has('backpack') ? 20 : 6; }
function kg(w) { return (+w.toFixed(2)) + ' kg'; }
function place(id, loc) { S.where[id] = loc; }
function lose(id) { S.where[id] = null; S.worn[id] = false; }

function getItem(id, quiet) {
  if (has(id)) { if (!quiet) say('You already have it.'); return true; }
  const w = I[id].w, l = load();
  if (l + w > cap() + 1e-9) {
    if (!has('backpack') && l + w + I.backpack.w <= 20) say(`You can't carry that: your hands and pockets are full (${kg(l)} of 6 kg). A backpack would help.`);
    else say(`Too heavy! That would bring you to ${kg(l + w)}, and you can't carry more than ${cap()} kg. Drop something first.`);
    return false;
  }
  S.where[id] = 'inv';
  if (!quiet) say(`Taken: ${I[id].name} (${kg(w)}).`);
  return true;
}

// Word matching: does `text` contain any of the |-separated phrases?
function is(text, words) {
  if (!text) return false;
  const alts = words.split('|').filter(Boolean).map((w) => w.replace(/[.*+?^${}()[\]\\]/g, '\\$&'));
  return new RegExp('(?:^|\\s)(?:' + alts.join('|') + ')(?=\\s|$)').test(text);
}

function findItem(name, invOnly) {
  if (!name) return null;
  let best = null, bestScore = 0;
  for (const id in I) {
    if (!(has(id) || (!invOnly && here(id)))) continue;
    for (const w of I[id].words.split('|')) {
      if (!is(name, w)) continue;
      const sc = w.length + (name === w ? 100 : 0) + (has(id) ? 0.5 : 0);
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
  }
  return best;
}

// ----------------------------------------------------------- the player
function clamp(v) { return Math.max(0, Math.min(100, v)); }
function love(d) {
  S.love = clamp(S.love + d);
  if (S.love <= 0) gameOver('[SMS] Laura: "I can\'t do this any more. It\'s over. Please leave my key with Mr. Kowalski."', 'dumped');
}
function bossMood(d) {
  S.boss = clamp(S.boss + d);
  if (S.boss <= 0) gameOver('Mr. Grumman calls you into his office. "Late, absent, useless. YOU\'RE FIRED!" Tony escorts you out with a cardboard box. ' +
    'No job, no salary, no ring.', 'fired');
}
function contact() { S.contact[D()] = true; }
function once(k) { if (S.once[k]) return false; S.once[k] = true; return true; }

function deed(k) {
  const d = DEEDS[k], c = S.deeds[k] || 0;
  if (c >= (d.max || 1)) return false;
  S.deeds[k] = c + 1; S.score += d.pts;
  say(`[+${d.pts} points: ${d.name}]`, 'score');
  if (k !== 'birthday' && k !== 'presentation') diary(d.name.replace(/your/g, 'my').replace(/Your/g, 'My') + '.');
  return true;
}

function spend(x, silent) {
  if (!has('wallet')) { if (!silent) say('You reach for your wallet... It\'s not with you!'); return false; }
  if (S.cash < x) { if (!silent) say(`Not enough cash: you need $${x} and you have $${S.cash}. There's an ATM on Downtown Plaza.`); return false; }
  S.cash = Math.round((S.cash - x) * 100) / 100;
  return true;
}

// -------------------------------------------------------------- moving
const DIR = { n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w', u: 'u', up: 'u', upstairs: 'u',
  d: 'd', down: 'd', downstairs: 'd', in: 'in', inside: 'in', out: 'out', outside: 'out', ne: 'ne', northeast: 'ne',
  nw: 'nw', northwest: 'nw', se: 'se', southeast: 'se', sw: 'sw', southwest: 'sw' };
const DIRNAME = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down', in: 'in', out: 'out',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest' };

function goDir(dir) {
  const dest = L[S.loc].exits[dir];
  if (!dest) { say(dir === 'out' ? 'You are not inside anything you can leave that way.' : 'You can\'t go that way.'); return; }
  const cl = L[dest].closed && L[dest].closed();
  if (cl) { say(cl); return; }
  travel(dest);
}
function travel(dest) {
  const a = L[S.loc].zone, b = L[dest].zone;
  if (!advance(a === b && INDOOR_ZONES.has(a) ? 1 : 3)) return;
  moveTo(dest);
}
function moveTo(dest, noEnter) {
  S.prev = S.loc; S.loc = dest; S.visited[dest] = true;
  describe();
  if (!noEnter && L[dest].enter) L[dest].enter();
}
function crossAvenue(dest) {
  if (S.light !== 'green') {
    if (!S.f.redWarned) { trafficFine(); return true; }
    gameOver('You step onto the crosswalk on a RED light. "It\'s only a second," you think. ' +
      'It is exactly the second a delivery van needs. The last thing you hear is a horn playing "La Cucaracha". ' +
      'Ordinary men wait for the green man.', 'dead');
    return true;
  }
  say('You cross on the green, quickly, keeping an eye on a taxi that clearly has opinions about pedestrians.');
  travel(dest);
  return true;
}
function updateLight() {
  if (S.loc !== 'avnorth' && S.loc !== 'avsouth') return;
  S.lc++;
  const nl = (S.lc % 4) < 2 ? 'red' : 'green';
  if (nl !== S.light) {
    S.light = nl;
    say(nl === 'green' ? 'The pedestrian light turns GREEN. Beep-beep-beep.' : 'The pedestrian light turns RED. The traffic surges forward.', 'note');
  }
}

function describe() {
  const l = L[S.loc];
  say(l.name, 'title');
  let d = typeof l.desc === 'function' ? l.desc() : l.desc;
  if (l.people) { const p = l.people(); if (p) d += ' ' + p.trim(); }
  for (const id of npcsHere()) d += ' ' + npcText(id, 'here');
  say(d);
  const items = Object.keys(I).filter(here);
  if (items.length) say('You can see: ' + items.map((id) => I[id].name).join(', ') + '.', 'items');
  say('Exits: ' + Object.keys(l.exits).map((k) => DIRNAME[k]).join(', ') + '.', 'exits');
}

// ----------------------------------------------------------------- map
// Draws the explored part of the city as text. Returns { lines, marks, people, ... }:
// marks = [{ row, start, end, cls }] to highlight (here / unk / npc).
function buildMap() {
  S.visited[S.loc] = true;
  const vis = Object.keys(L).filter((id) => S.visited[id] && MAP[id]);
  // Places seen from a visited location but never entered: drawn as [?].
  const unk = new Set();
  for (const a of vis) {
    for (const dir in L[a].exits) {
      const b = L[a].exits[dir];
      if (!S.visited[b] && MAP[b] && !MAP_SKIP.has(a + '>' + dir)) unk.add(b);
    }
  }
  const cells = vis.concat([...unk]);
  const xs = cells.map((id) => MAP[id][0]), ys = cells.map((id) => MAP[id][1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const CW = 13;
  const g = Array.from({ length: (y1 - y0) * 2 + 2 }, () => Array((x1 - x0 + 1) * CW).fill(' '));
  const cx = (id) => (MAP[id][0] - x0) * CW + Math.floor(CW / 2);
  const ry = (id) => (MAP[id][1] - y0) * 2;
  const put = (r, c, ch) => {
    const e = g[r][c];
    if (e === ' ') g[r][c] = ch;
    else if ((e === '-' && ch === '|') || (e === '|' && ch === '-')) g[r][c] = '+';
  };
  const seen = new Set();
  for (const a of vis) {
    for (const dir in L[a].exits) {
      const b = L[a].exits[dir];
      if (!MAP[b] || MAP_SKIP.has(a + '>' + dir) || !(S.visited[b] || unk.has(b))) continue;
      const key = [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const c0 = cx(a), r0 = ry(a), c1 = cx(b), r1 = ry(b);
      if (r0 === r1) for (let c = Math.min(c0, c1) + 1; c < Math.max(c0, c1); c++) put(r0, c, '-');
      else if (c0 === c1) for (let r = Math.min(r0, r1) + 1; r < Math.max(r0, r1); r++) put(r, c0, '|');
      else {
        const ch = (c1 - c0) * (r1 - r0) > 0 ? '\\' : '/';
        for (let r = Math.min(r0, r1) + 1; r < Math.max(r0, r1); r++) put(r, Math.round(c0 + (c1 - c0) * (r - r0) / (r1 - r0)), ch);
      }
    }
  }
  const marks = [];
  const box = (id, t, cls) => {
    const r = ry(id), s = cx(id) - Math.floor(t.length / 2);
    for (let i = 0; i < t.length; i++) g[r][s + i] = t[i];
    if (cls) marks.push({ row: r, start: s, end: s + t.length, cls });
  };
  for (const id of unk) box(id, '[?]', 'unk');
  for (const id of vis) box(id, '[' + MAP[id][2] + ']', id === S.loc ? 'here' : '');
  // People currently in explored places: their letters go under the box.
  const people = [];
  for (const id of vis) {
    const who = Object.keys(NPCS).filter((n) => npcWhere(n) === id);
    if (!who.length) continue;
    const t = who.map((n) => NPCS[n].letter).join(''), r = ry(id) + 1, s = cx(id) + 2;
    for (let i = 0; i < t.length; i++) g[r][s + i] = t[i];
    marks.push({ row: r, start: s, end: s + t.length, cls: 'npc' });
    for (const n of who) people.push({ letter: NPCS[n].letter, name: NPCS[n].short, where: MAP[id][2] });
  }
  return {
    lines: g.map((row) => row.join('').replace(/\s+$/, '')), marks, people,
    count: vis.length, unknown: unk.size, total: Object.keys(MAP).length,
  };
}

// --------------------------------------------------------------- sleep
function goToSleep(forced) {
  const h = H();
  if (!forced && !(h >= 21 || h < 6)) { say(`You're not sleepy. It's only ${clock()}. (You can sleep after 9 PM.)`); return; }
  if (!forced && partyKeepsAwake()) return;
  const cut = S.f.powerCut && !forced && S.loc === 'bedroom';
  const off = !forced && !cut && S.f.alarmOff;
  const base = h < 6 ? D() * 1440 : (D() + 1) * 1440;
  // A well-fed Mortimer wakes you for breakfast when no alarm rings.
  const catWake = (cut || off) && S.f['catfed' + (h < 6 ? D() - 1 : D())];
  const wake = base + (cut || off ? (catWake ? 7 * 60 + 30 : 9 * 60 + 40) : 7 * 60);
  if (!forced) {
    say(cut ? 'You set the alarm... but the clock is dead: no electricity. You fall asleep anyway.' :
      off ? 'The alarm clock is switched off. No beeping tomorrow. You fall asleep with a blissful smile.' : 'The alarm is set for 7:00. You fall asleep.');
  }
  S.asleep = true;
  const ok = advanceTo(wake);
  S.asleep = false;
  if (S.over) return;
  if (ok) {
    const workday = D() < 5;
    let txt, cls = '';
    if (forced) txt = 'You wake up stiff and cold.';
    else if (catWake) txt = 'A heavy paw lands on your face. Then another. Mortimer sits on your chest, purring like a tractor: BREAKFAST TIME. ' +
      'No alarm rang, but your cat did. Good boy.';
    else if (cut) { txt = 'Sunlight on your face. SUNLIGHT?! The alarm never rang! You are LATE!'; cls = 'warn'; }
    else if (off && workday) { txt = 'You wake up all by yourself, rested and happy... then you see the clock. 9:40! You switched the alarm OFF! You are LATE for work!'; cls = 'warn'; }
    else if (off) txt = 'No alarm, no rush: a long, lazy Saturday lie-in. Bliss.';
    else txt = 'BEEP BEEP BEEP! The alarm drags you out of a dream about a giant diamond ring.';
    say(`${DAYS[D()]}, ${clock()}. ` + txt, cls);
    if (S.f.catNews) {
      S.f.catNews = false;
      say('Mortimer sits on the windowsill looking extremely pleased with himself. Something tells you he has HIDDEN something of yours. Cats love sofas and beds...', 'warn');
    }
  }
  describe();
}
function collapse() {
  S.collapse = false;
  if (L[S.loc].zone === 'home') {
    say('It\'s 1 AM. Your eyelids weigh a ton. You collapse on the sofa, fully dressed...');
    S.loc = 'living';
    goToSleep(true);
    return;
  }
  say('It\'s 1 AM. You sit on a park bench "just for a minute"... and fall fast asleep.', 'warn');
  S.loc = 'playground';
  const robbed = has('wallet') && S.cash > 0;
  goToSleep(true);
  if (robbed && !S.over) { S.cash = 0; say('Your cash is gone. Somebody helped themselves while you were snoring. At least they left the card.', 'warn'); }
}

// ----------------------------------------------------------- money, phone
function atmWithdraw(c) {
  if (!has('wallet')) { say('Your bank card is in your wallet, and your wallet is not with you.'); return; }
  if (atmCardTrouble()) return;
  const m = (c.all.match(/\d+/) || [])[0];
  if (!m) { say(`How much? For example: WITHDRAW 200. (Daily limit $${ATM_LIMIT}.)`); return; }
  const amt = parseInt(m, 10), used = S.atm[D()] || 0;
  if (amt <= 0 || amt % 10) { say('The ATM only gives out multiples of $10.'); return; }
  if (used + amt > ATM_LIMIT) { say(`"DAILY LIMIT EXCEEDED." You can withdraw $${ATM_LIMIT - used} more today.`); return; }
  if (amt > S.bank) { say(`"INSUFFICIENT FUNDS." Balance: $${S.bank}.`); return; }
  S.bank -= amt; S.cash += amt; S.atm[D()] = used + amt;
  say(`The ATM whirs and spits out $${amt}. Cash: $${S.cash}. Bank balance: $${S.bank}.`);
}
function atmBalance() {
  if (!has('wallet')) { say('Your card is in your wallet, which is not with you.'); return; }
  if (atmCardTrouble()) return;
  say(`ATM: balance $${S.bank}. Withdrawn today: $${S.atm[D()] || 0} of $${ATM_LIMIT}.`);
}

function callPhone(c) {
  if (!has('phone')) { say('You don\'t have your phone with you.'); return; }
  const who = c.all;
  if (!who) { say('Call whom? (Laura, Mom, the police...)'); return; }
  if (is(who, 'laura|girlfriend|her')) {
    advance(5); contact();
    if (S.loc === 'laura' || (S.loc === 'restaurant' && P.lauraRest())) { say('She is right in front of you. She looks at you as if you were a little bit stupid.'); return; }
    if (once('call' + D())) {
      love(3);
      say('Laura picks up: "Hey, you! I was just thinking about you. ' +
        (D() === 5 ? 'See you at Luigi\'s at 8, okay? Wear something nice!"' : D() === 2 ? 'Dinner at 8 tonight, don\'t forget!"' : 'Come and see me tonight, if you want..."'));
    } else say('"Again? Miss me already? Bye, silly!"');
    return;
  }
  if (is(who, 'mom|mother|mum|mama|ma|parents')) {
    if (!within(8, 22)) { say('It\'s too late to call Mom. She would think somebody died.'); return; }
    if (D() === 3 && !S.f.bdayCalled) { advance(40); birthdayCall(); return; }
    advance(20);
    if (!S.deeds.mom) {
      say('Mom: "FINALLY! Are you eating? Is Laura well? When are you getting MARRIED? Your cousin Gary is already on his second wife!" ' +
        'Twenty minutes later you hang up. She sounded so happy.');
      deed('mom');
    } else say('Mom: "Twice in a week? Are you in trouble? Is it money? Is it a GIRL? Is it Laura? Put Laura on!"');
    return;
  }
  if (is(who, 'police|cops|911|112|113|999|emergency')) { say('"Police, what\'s your emergency?" You realise you don\'t have one, mumble "wrong number" and hang up, red-faced.'); return; }
  if (is(who, 'boss|grumman')) { say('Call the boss voluntarily? Are you mad?'); return; }
  if (is(who, 'ben|colleague')) { say('Ben: "Dude! Club Velvet, Thursday night, my birthday! Be there!"'); return; }
  say('You don\'t have that number.');
}

function buy(c) {
  const shop = L[S.loc].shop;
  if (!shop) { say('There\'s nothing for sale here.'); return; }
  const id = Object.keys(shop).find((k) => is(c.all, I[k].words));
  if (!id) { say('They sell: ' + Object.keys(shop).map((k) => `${I[k].name} ($${shop[k]})`).join(', ') + '.'); return; }
  const cl = L[S.loc].closed && L[S.loc].closed();
  if (cl) { say(cl); return; }
  if (has(id)) { say(`You already have ${I[id].name}.`); return; }
  if (!spend(shop[id])) return;
  place(id, S.loc);
  if (getItem(id, true)) say(`You buy ${I[id].name} for $${shop[id]}.`);
  else { S.cash += shop[id]; place(id, null); say('(You get your money back.)'); }
}

// ---------------------------------------------------------- the ending
function finale() {
  advance(5);
  say('You take a deep breath, push back your chair and get down on one knee. The whole restaurant goes silent. Luigi drops a plate. ' +
    'You open the little velvet box. "Laura... will you marry me?"');
  if (S.love >= 60) {
    say('Laura\'s hands fly to her mouth. "YES! Yes, yes, YES, you ordinary, wonderful man!" The restaurant bursts into applause. Luigi cries into his apron.', 'good');
    const lines = ['Proposal accepted: +40'];
    let bonus = 40;
    if (has('suit') && S.worn.suit) { bonus += 10; lines.push('Wearing your best suit: +10'); }
    if (!S.f.lateBill && S.f.elecPaid && S.f.gasPaid) { bonus += 10; lines.push('All bills paid on time: +10'); }
    S.score += bonus;
    say('[' + lines.join(' | ') + ']', 'score');
    gameOver('And so a pretty normal man in a pretty normal city lived a pretty normal, pretty happy life. Which, if you think about it, is quite extraordinary.', 'win');
  } else if (S.love >= 35) {
    gameOver('Laura looks at the ring for a very long time. "I... I need some time. This week you were... somewhere else." She doesn\'t say no. She doesn\'t say yes. ' +
      'You eat your tiramisu in silence.', 'meh');
  } else {
    gameOver('Laura gently closes the box and slides it back across the table. "I\'m sorry. I can\'t. Not after this week." She leaves. Luigi brings you a grappa, on the house.', 'lose');
  }
}

function rank() {
  const s = S.score;
  return s >= 260 ? 'Rank: Saint of the Suburbs.' : s >= 200 ? 'Rank: Pillar of the Community.' : s >= 140 ? 'Rank: Thoroughly Decent Bloke.' :
    s >= 80 ? 'Rank: Pretty Normal Guy.' : s >= 30 ? 'Rank: Mildly Useful Citizen.' : 'Rank: Professional Couch Potato.';
}

function gameOver(text, kind) {
  if (S.over) return;
  S.over = kind; S.enc = null;
  say(text, kind === 'win' ? 'good' : 'warn');
  const title = { win: '*** CONGRATULATIONS: SHE SAID YES! ***', dead: '*** YOU HAVE DIED ***', fired: '*** YOU ARE FIRED ***',
    dumped: '*** LAURA HAS LEFT YOU ***', evicted: '*** EVICTED ***', meh: '*** THE END... SORT OF ***', lose: '*** GAME OVER ***' }[kind];
  say(title, 'banner');
  say(`Final score: ${S.score} of ${MAX_SCORE}. ${rank()}`, 'score');
  showDiary(true);
  showAchievements();
  say(kind === 'win' ? 'Type RESTART to play again.' : 'Type UNDO to take back your last move, LOAD to restore a saved game, or RESTART.');
}

// ------------------------------------------------------------- parser
const VERBS = [
  ['look at', 'examine'], ['look in', 'examine'], ['look under', 'examine'], ['look inside', 'examine'], ['look', 'look'], ['l', 'look'],
  ['examine', 'examine'], ['x', 'examine'], ['inspect', 'examine'], ['check', 'examine'], ['search', 'examine'], ['read', 'read'],
  ['pick up', 'take'], ['take off', 'remove'], ['take', 'take'], ['get', 'take'], ['grab', 'take'], ['collect', 'take'], ['carry', 'take'], ['steal', 'take'],
  ['put on', 'wear'], ['wear', 'wear'], ['dress in', 'wear'], ['remove', 'remove'],
  ['put down', 'drop'], ['drop', 'drop'], ['discard', 'drop'], ['put', 'put'], ['place', 'put'], ['throw', 'throw'], ['toss', 'throw'],
  ['i', 'inv'], ['inv', 'inv'], ['inventory', 'inv'],
  ['give', 'give'], ['hand', 'give'], ['offer', 'give'],
  ['talk to', 'talk'], ['talk with', 'talk'], ['talk', 'talk'], ['speak to', 'talk'], ['speak with', 'talk'], ['speak', 'talk'],
  ['chat with', 'talk'], ['chat', 'talk'], ['greet', 'talk'], ['say hello to', 'talk'], ['hello', 'talk'], ['hi', 'talk'], ['ask', 'ask'],
  ['help', 'help'], ['assist', 'help'], ['use', 'use'], ['open', 'open'], ['close', 'close'], ['shut', 'close'],
  ['eat', 'eat'], ['drink', 'drink'], ['buy', 'buy'], ['purchase', 'buy'], ['order', 'order'], ['pay for', 'pay'], ['pay', 'pay'],
  ['sell', 'sell'], ['pawn', 'sell'], ['withdraw', 'withdraw'], ['balance', 'balance'],
  ['work', 'work'], ['sleep', 'sleep'], ['go to bed', 'sleep'], ['go to sleep', 'sleep'], ['nap', 'sleep'],
  ['wait', 'wait'], ['z', 'wait'],
  ['call', 'call'], ['phone', 'call'], ['ring', 'call'], ['dial', 'call'], ['telephone', 'call'],
  ['push', 'push'], ['press', 'push'], ['climb', 'climb'], ['feed', 'feed'], ['kiss', 'kiss'], ['hug', 'hug'], ['cuddle', 'hug'],
  ['dance', 'dance'], ['work out', 'exercise'], ['exercise', 'exercise'], ['workout', 'exercise'], ['train', 'exercise'], ['lift', 'exercise'],
  ['donate', 'donate'], ['fight', 'fight'], ['hit', 'fight'], ['punch', 'fight'], ['attack', 'fight'], ['kick', 'kick'], ['tackle', 'fight'], ['stop', 'fight'],
  ['follow', 'follow'], ['jog', 'run'], ['run with', 'run'], ['jog with', 'run'], ['catch', 'fight'], ['show', 'show'], ['point', 'show'], ['guide', 'show'], ['direct', 'show'], ['run', 'run'], ['flee', 'run'], ['escape', 'run'], ['run away', 'run'],
  ['accept', 'accept'], ['yes', 'accept'], ['y', 'accept'], ['sure', 'accept'], ['ok', 'accept'], ['okay', 'accept'],
  ['refuse', 'refuse'], ['decline', 'refuse'], ['no', 'refuse'], ['reject', 'refuse'],
  ['propose', 'propose'], ['marry', 'propose'], ['kneel', 'propose'],
  ['shower', 'shower'], ['take shower', 'shower'], ['wash', 'wash'], ['shave', 'shave'], ['brush', 'brush'],
  ['recycle', 'recycle'], ['rescue', 'rescue'], ['save', 'save'], ['borrow', 'borrow'], ['return', 'return'], ['bring back', 'return'],
  ['insult', 'insult'], ['swear at', 'insult'], ['compliment', 'compliment'], ['flatter', 'compliment'], ['praise', 'compliment'],
  ['fix', 'fix'], ['repair', 'fix'], ['unjam', 'fix'], ['clear', 'fix'], ['print', 'print'], ['knock', 'knock'], ['knock on', 'knock'],
  ['shout', 'shout'], ['yell', 'shout'], ['scream', 'shout'], ['swing', 'swing'], ['swim', 'swim'], ['sit', 'sit'], ['sit on', 'sit'], ['lie', 'sit'], ['rest', 'sit'],
  ['watch', 'watch'], ['turn on', 'on'], ['switch on', 'on'], ['turn off', 'off'], ['switch off', 'off'], ['disable', 'off'], ['unplug', 'off'], ['set', 'set'], ['enable', 'set'], ['pet', 'pet'], ['stroke', 'pet'], ['tip', 'tip'], ['shop', 'shop'], ['go shopping', 'shop'], ['play', 'play'], ['boot', 'on'], ['log on', 'on'],
  ['report', 'report'], ['make', 'make'], ['cook', 'make'], ['clean', 'clean'], ['flirt', 'flirt'], ['flirt with', 'flirt'], ['lean', 'lean'],
  ['cross', 'cross'], ['go', 'go'], ['walk', 'go'], ['head', 'go'], ['enter', 'enter'], ['exit', 'exit'], ['leave', 'exit'],
  ['score', 'score'], ['points', 'score'], ['status', 'score'], ['time', 'time'], ['hint', 'hint'], ['hints', 'hint'],
  ['diary', 'diary'], ['journal', 'diary'], ['complain', 'complain'], ['join', 'join'], ['party', 'join'], ['map', 'map'], ['m', 'map'], ['music', 'music'], ['soundtrack', 'music'], ['mute', 'mute'], ['unmute', 'unmute'], ['load', 'load'], ['restore', 'load'], ['restart', 'restart'], ['undo', 'undo'], ['commands', 'help'],
].sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);

const STOP = new Set(['the', 'a', 'an', 'some', 'my', 'please', 'mr', 'mrs', 'ms', 'miss']);
const PREP = new Set(['to', 'with', 'in', 'into', 'on', 'onto', 'from', 'for', 'at', 'against', 'inside', 'under', 'up']);

function parse(raw) {
  const s = raw.toLowerCase().replace(/[$€]/g, '').replace(/[^a-z0-9': -]/g, ' ').replace(/(\D):|:(\D)|:$/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (DIR[s]) return { v: 'go', n: DIR[s], n2: '', all: DIR[s], raw: s };
  const words = s.split(' ');
  let v = null, rest = [];
  for (const [phrase, canon] of VERBS) {
    const pw = phrase.split(' ');
    if (words.slice(0, pw.length).join(' ') === phrase) { v = canon; rest = words.slice(pw.length); break; }
  }
  if (!v) return { v: '?', n: s, n2: '', all: s, raw: s, word: words[0] };
  rest = rest.filter((w) => !STOP.has(w));
  if (v === 'go' || v === 'run' && rest.length) {
    const r = rest.filter((w) => w !== 'to' && w !== 'away');
    if (DIR[r[0]]) return { v: v === 'run' ? 'run' : 'go', n: DIR[r[0]], n2: '', all: DIR[r[0]], raw: s };
  }
  if (v === 'enter') return { v: 'go', n: 'in', n2: '', all: 'in', raw: s };
  if (v === 'exit') return { v: 'go', n: 'out', n2: '', all: 'out', raw: s };
  const idx = rest.findIndex((w, i) => i > 0 && PREP.has(w));
  const n = (idx >= 0 ? rest.slice(0, idx) : rest).filter((w) => !PREP.has(w)).join(' ');
  const n2 = idx >= 0 ? rest.slice(idx + 1).filter((w) => !PREP.has(w)).join(' ') : '';
  const all = rest.filter((w) => !PREP.has(w)).join(' ');
  return { v, n, n2, all, raw: s };
}

// ---------------------------------------------------------- generic verbs
function thingText(name) {
  const things = L[S.loc].things || {};
  for (const k in things) if (is(name, k)) { const t = things[k]; return typeof t === 'function' ? t() : t; }
  return null;
}

function generic(c) {
  const v = c.v;
  switch (v) {
    case 'look': describe(); return;
    case 'examine': {
      if (!c.all) { describe(); return; }
      const id = findItem(c.all);
      const tt = thingText(c.all);
      if (id && (!tt || has(id) || findItem(c.n))) { const d = I[id].desc; say(typeof d === 'function' ? d() : d); return; }
      if (tt) { say(tt); return; }
      if (is(c.all, 'me|myself|self')) { say(`A pretty normal man. Fitness: ${['couch potato', 'getting there', 'fit', 'athletic'][Math.min(S.fit, 3)]}.`); return; }
      say('You don\'t see that here.');
      return;
    }
    case 'read': {
      const id = findItem(c.all);
      if (!id) { const tt = thingText(c.all); say(tt || 'Read what?'); return; }
      const r = I[id].read;
      say(r ? (typeof r === 'function' ? r() : r) : 'There\'s nothing written on it.');
      return;
    }
    case 'take': {
      if (c.all === 'all' || c.all === 'everything') {
        const list = Object.keys(I).filter(here);
        if (!list.length) { say('There\'s nothing here to take.'); return; }
        for (const id of list) getItem(id);
        return;
      }
      if (!c.all) { say('Take what?'); return; }
      if (is(c.n, 'money|cash|euro|dollar|dollars|bucks|notes') && (has('lostwallet') || here('lostwallet'))) {
        if (S.f.stoleMoss) { say('It\'s already empty. You saw to that.'); return; }
        S.f.stoleMoss = true; S.cash += 80;
        say('You look around, then slip Mr. Moss\'s $80 into your own pocket. Nobody saw. Probably. Grandma would not be proud.');
        return;
      }
      if (c.all === 'bills' && (here('elecbill') || here('gasbill'))) {
        for (const b of ['elecbill', 'gasbill']) if (here(b)) getItem(b);
        return;
      }
      const id = findItem(c.all);
      if (id) { getItem(id); return; }
      say(thingText(c.all) ? 'You can\'t take that.' : 'You don\'t see that here.');
      return;
    }
    case 'put':
      if (!c.n2) { generic({ ...c, v: 'drop' }); return; }
      say('You can\'t put that there.'); return;
    case 'drop': {
      const id = findItem(c.n || c.all, true);
      if (!id) { say(c.all ? 'You don\'t have that.' : 'Drop what?'); return; }
      if (id === 'backpack' && load() - I.backpack.w > 6) { say('Without the backpack you can only carry 6 kg in your hands and pockets. Drop other things first.'); return; }
      place(id, S.loc); S.worn[id] = false;
      say(`Dropped: ${I[id].name}.`);
      return;
    }
    case 'throw': say('Throwing things around in public? That\'s not very normal.'); return;
    case 'wear': {
      const id = findItem(c.all, true);
      if (!id) { say('You don\'t have that.'); return; }
      if (!I[id].wear) { say('You can\'t wear that.'); return; }
      if (S.worn[id]) { say('You are already wearing it.'); return; }
      S.worn[id] = true; advance(id === 'suit' ? 5 : 1);
      say(id === 'suit' ? 'You change into the dark blue suit. Mirror check: sharp. Very sharp.' : `You put on ${I[id].name}.`);
      return;
    }
    case 'remove': {
      const id = findItem(c.all, true);
      if (!id || !S.worn[id]) { say('You aren\'t wearing that.'); return; }
      S.worn[id] = false; say(`You take off ${I[id].name}.`); return;
    }
    case 'inv': showInventory(); return;
    case 'give':
      if (!c.all) { say('Give what?'); return; }
      if (!findItem(c.n || c.all, true) && !is(c.all, 'money|cash|coin|coins|euro|dollar|dollars|bucks')) { say('You don\'t have that.'); return; }
      if (!c.n2) { say('Give it to whom?'); return; }
      say('They don\'t seem interested.'); return;
    case 'talk': case 'ask':
      say(c.all ? 'Nobody here wants to chat about that.' : 'Talk to whom?'); return;
    case 'help': say('How exactly? Try a more specific action.'); return;
    case 'use': {
      const id = findItem(c.n || c.all);
      if (id === 'phone') { say('Whom do you want to CALL? (Laura, Mom, the police...)'); return; }
      if (id === 'ladder' || id === 'stepladder') { say('There\'s nothing here that needs a ladder.'); return; }
      if (id && I[id].wear) { generic({ ...c, v: 'wear' }); return; }
      say(id ? 'You can\'t think of a way to use that here.' : 'Use what?'); return;
    }
    case 'open': {
      const id = findItem(c.all);
      if (id === 'wallet') { say(`Your wallet: $${S.cash} in cash and your bank card.`); return; }
      if (id === 'lostwallet') { say(typeof I.lostwallet.desc === 'function' ? I.lostwallet.desc() : I.lostwallet.desc); return; }
      if (id === 'backpack') { say('You look inside: ' + (invList().filter((x) => x !== 'backpack').map((x) => I[x].name).join(', ') || 'nothing') + '.'); return; }
      say('You can\'t open that.'); return;
    }
    case 'close': say('Nothing to close.'); return;
    case 'eat': case 'drink': {
      const id = findItem(c.all, true);
      if (!id) { say('You don\'t have that.'); return; }
      const t = I[id][v] || (v === 'drink' ? I[id].drink : I[id].eat);
      if (!t) { say(v === 'eat' ? 'That\'s not food.' : 'You can\'t drink that.'); return; }
      say(t); if (!I[id].noEat) lose(id); advance(5);
      return;
    }
    case 'buy': case 'order': buy(c); return;
    case 'pay': say('There\'s nothing to pay here.'); return;
    case 'sell': say('There\'s nobody here who wants to buy it. Try a pawn shop.'); return;
    case 'withdraw': case 'balance': say('You need an ATM. There\'s one on Downtown Plaza.'); return;
    case 'work': say('You can only work at your desk, on the 7th floor of Grumman & Co.'); return;
    case 'sleep': say(L[S.loc].zone === 'home' ? 'You sleep in the bedroom.' : 'You can\'t sleep here. Your bed is at home.'); return;
    case 'wait': doWait(c); return;
    case 'call': callPhone(c); return;
    case 'push': say('Nothing happens.'); return;
    case 'climb': {
      const ex = L[S.loc].exits;
      if (is(c.all, 'down') && ex.d) { goDir('d'); return; }
      if (ex.u && !is(c.all, 'down')) { goDir('u'); return; }
      say('There\'s nothing to climb here.'); return;
    }
    case 'feed': say('Feed whom? Nobody here looks hungry for what you have.'); return;
    case 'kiss': case 'hug': case 'flirt': say('Better not. People would talk.'); return;
    case 'dance': say('You do a little dance. A passer-by takes a step back.'); return;
    case 'exercise': say('You do ten push-ups. You feel... exactly the same. A gym would help.'); return;
    case 'donate': say('You can donate blood at the City Clinic, south of St. Mark\'s church.'); return;
    case 'fight': case 'kick': say('Violence is not the ordinary man\'s way.'); return;
    case 'run': say('You jog on the spot. Nobody knows why.'); return;
    case 'follow': say("Follow whom? There's nobody here to follow."); return;
    case 'show': say("There's nobody here who needs directions."); return;
    case 'accept': case 'refuse': say('Nobody asked you anything.'); return;
    case 'propose': say('Not now, not here. Saturday, 8 PM, at Luigi\'s Trattoria: that\'s the plan.'); return;
    case 'shower': case 'shave': case 'brush': say('You can do that in your bathroom.'); return;
    case 'wash': case 'clean': say('It\'s clean enough.'); return;
    case 'recycle': say('The recycling bins are on Elm Street, outside your building.'); return;
    case 'rescue': say('Rescue whom?'); return;
    case 'borrow': say('There\'s nothing here you can borrow.'); return;
    case 'return': say('There\'s nobody here to return that to.'); return;
    case 'insult': say('You mutter something rude. Nobody hears. You feel slightly better.'); return;
    case 'compliment': say('"Nice weather today," you tell nobody in particular.'); return;
    case 'fix': say('Nothing here needs fixing. Except maybe your life.'); return;
    case 'print': say('You need a computer and a printer. Like the ones at the office.'); return;
    case 'knock': say('You knock. Nobody answers.'); return;
    case 'shout': say('You shout. People stare. You stop.'); return;
    case 'swing': case 'swim': case 'watch': case 'on': case 'off': case 'set': case 'pet': case 'lean': say('You can\'t do that here.'); return;
    case 'sit': say('You sit down for a moment and watch the world go by. Then you get up again.'); advance(5); return;
    case 'tip': say('There\'s nobody here to tip.'); return;
    case 'play': say('There is nothing to play with here. Your old PC is at home, in the living room.'); return;
    case 'shop': say('Laura would LOVE to go shopping. Ask her at her place.'); return;
    case 'report': say('Reports go to the police station, next to St. Mark\'s church.'); return;
    case 'make': say('You can\'t make anything here.'); return;
    case 'cross': say('There\'s nothing to cross here.'); return;
    case 'go':
      if (!c.n || !DIR[c.n] && !DIRNAME[c.n]) { say('Which way? (north, south, east, west, up, down, in, out...)'); return; }
      goDir(DIR[c.n] || c.n); return;
    case 'save': // "save cat" lands here only when not handled as meta
      say('Save whom?'); return;
    default:
      say(`I don't know the verb "${c.word || v}". Type HELP for a list of commands.`);
  }
}

function doWait(c) {
  let mins = 10;
  const m = c.all.match(/(\d{1,2})(?::(\d\d))?/);
  if (is(c.all, 'until|till|til') && m) {
    let target = D() * 1440 + parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    if (target <= S.t) target += 1440;
    mins = target - S.t;
  } else if (m) mins = parseInt(m[1], 10) * (is(c.all, 'hour|hours|h') ? 60 : 1);
  else if (is(c.all, 'laura|her') && S.loc === 'restaurant' && D() === 5 && S.t < at(5, 19.75)) mins = at(5, 19.75) - S.t;
  if (mins > 18 * 60) { say('That\'s too long to wait. Maybe SLEEP?'); return; }
  if (mins < 1) mins = 1;
  if (advance(mins)) say(mins >= 30 ? `You wait. It is now ${clock()}.` : 'Time passes.');
}

function showInventory() {
  const list = invList();
  if (!list.length) say('You are carrying nothing at all.');
  else {
    say('You are carrying:');
    for (const id of list) say(`  ${I[id].name} (${kg(I[id].w)})${S.worn[id] ? ', worn' : ''}`);
  }
  say(`Total weight: ${kg(load())} of ${cap()} kg${has('backpack') ? '' : ' (hands and pockets only: take a backpack to carry up to 20 kg)'}.` +
    (has('wallet') ? ` Cash: $${S.cash}.` : ''));
}

function showScore() {
  say(`Score: ${S.score} of ${MAX_SCORE}. ${rank()}`, 'score');
  const done = Object.keys(S.deeds);
  if (done.length) for (const k of done) say(`  * ${DEEDS[k].name}${S.deeds[k] > 1 ? ' (x' + S.deeds[k] + ')' : ''}: +${DEEDS[k].pts * S.deeds[k]}`);
  else say('  No good deeds yet. Grandma would be disappointed.');
  say(`Laura: ${loveText()}`);
  say(`Mr. Grumman: ${bossText()}`);
  say(`Bills: electricity ${S.f.elecPaid ? 'PAID' : 'unpaid (due Wednesday)'}, gas ${S.f.gasPaid ? 'PAID' : 'unpaid (due Friday)'}, rent ${S.f.rentPaid ? 'PAID' : `$${RENT} unpaid (Saturday noon, cash)`}.`);
  say(`Ring: ${has('ring') ? 'in your pocket!' : 'not bought yet'}.`);
}

function showHint() {
  const h = [], d = D(), hr = H(), w = S.work[d] || {};
  if (S.f.cardGone) h.push('The ATM ate your bank card. Get it back at the counter inside First City Bank (weekdays 8:30 AM - 4 PM): try the lunch break.');
  if (partyOn() && L[S.loc].zone === 'home') h.push('Party in 2B! COMPLAIN to the neighbours, JOIN the party, or buy EARPLUGS at the supermarket.');
  if (D() === 3 && !S.f.bdayCalled) h.push("Today is Mom's BIRTHDAY (it's on the kitchen calendar). CALL MOM before 10 PM!");
  if ((D() === 3 || (D() === 4 && H() < 10.5)) && !S.f.meetingDone) h.push('Friday at 10:30 AM: the presentation. Be at your desk WORKING in the morning.');
  if (S.f.catHid) h.push(`Mortimer hid something of yours (${I[S.f.catHid].name}). Look under the ${S.f.catSpot === 'bed' ? 'bed in the bedroom' : 'sofa in the living room'}.`);
  if (!S.f['catfed' + D()] && H() >= 17) h.push('Mortimer\'s bowl is empty. FEED the cat (boxes of cat biscuits at the supermarket on Rose Lane), or he will take revenge tonight.');
  if (S.f.alarmOff && D() < 5) h.push('Your alarm clock is switched OFF: you will sleep until 9:40 and be late for work. SET ALARM in the bedroom.');
  if (S.where.wallet === 'bedroom') h.push('Your wallet, keys and phone are on the nightstand in the bedroom. Take them!');
  if (S.where.backpack === 'living') h.push('Take the backpack from the living room: without it you can only carry 6 kg.');
  if (S.where.badge === 'living' && d < 5) h.push('Your office badge is on the coat rack in the living room. Tony won\'t let you in without it.');
  if (d < 5 && hr < 13 && !w.am) h.push('Work starts at 9:00. Grumman & Co. is on Commerce Street, south of Downtown Plaza, across Main Avenue. Go to your desk and WORK. Cross on the green!');
  if (d < 5 && hr >= 13 && hr < 17 && !w.pm) h.push('Lunch break ends at 2 PM. Get back to your desk and WORK.');
  if (d <= 3 && !S.f.reportDone) h.push(!S.f.printed ? 'PRINT the quarterly report at your desk and give it to Mr. Grumman by Thursday at 5 PM.' :
    !S.f.jamFixed ? 'The copy room printer is jammed. OPEN it.' : 'Take the report from the copy room and GIVE it to Mr. Grumman.');
  if (!S.f.mailOpen) h.push('Check the mailbox in your building lobby.');
  else if (!S.f.elecPaid || !S.f.gasPaid) h.push('Pay your bills at the post office (Downtown Plaza, east): electricity by Wednesday, gas by Friday. Bring the bills and cash.');
  if (!S.f.rentPaid) h.push(`Mr. Kowalski wants $${RENT} in CASH by Saturday noon. The ATM gives only $${ATM_LIMIT} a day: plan ahead.`);
  if (!S.f.shopDone) h.push('Laura wants to go shopping. Visit her after 6 PM (the mall closes at 9) and ask her to go SHOPPING.');
  if (d <= 2 && !S.f.wedDinner) h.push('Wednesday at 8 PM: dinner at Laura\'s place, Rose Lane. Don\'t miss it.');
  if (S.love < 60) h.push('Laura needs more love before Saturday: flowers, chocolates, calls, visits.');
  if (!has('ring')) h.push(S.bank + S.cash >= RING_PRICE ? 'Buy the ring at Sparkle & Sons, Commerce Street (open 10 AM - 7 PM).' :
    'The ring costs $1,250. Your salary arrives on Friday at 5 PM; the jeweller is open until 7 PM and on Saturday.');
  if (!S.f.suitGot) h.push('Your suit is waiting at the dry cleaner\'s on Main Avenue. Bring the ticket from the kitchen.');
  if (d === 5) h.push('Tonight at 8 PM: Luigi\'s Trattoria, Old Town Lane (southwest of Downtown Plaza). Bring the ring and PROPOSE!');
  const deeds = Object.keys(DEEDS).filter((k) => (S.deeds[k] || 0) < (DEEDS[k].max || 1));
  if (deeds.length) h.push('Good deeds still waiting: try the park, the church steps, the clinic, the library, the recycling bins...');
  if (!h.length) h.push('Just be a good, ordinary person.');
  say('HINTS:', 'title');
  h.slice(0, 3).forEach((x) => say(' - ' + x, 'note'));
}

const HELP_TEXT = [
  'COMMANDS (you can type them in lowercase):',
  ' Moving:   N, S, E, W, NE, SW, UP (U), DOWN (D), IN, OUT, CROSS',
  ' Looking:  LOOK (L), EXAMINE (X) thing, READ thing, INVENTORY (I)',
  ' Things:   TAKE / DROP thing, TAKE ALL, WEAR / REMOVE thing, EAT, DRINK, OPEN',
  ' People:   TALK TO someone, ASK someone FOR thing, GIVE thing TO someone, HELP someone, KISS, HUG',
  ' Money:    BUY thing, PAY bill, PAY RENT, SELL thing, WITHDRAW 200, BALANCE',
  ' Phone:    CALL LAURA / MOM / POLICE',
  ' Life:     WORK, SLEEP, WAIT (Z), WAIT 30, WAIT UNTIL 20, EXERCISE, DANCE, PUSH BUTTON, PLAY (the PC at home)...',
  ' Game:     MAP, DIARY (DIARY WEEK), MUSIC (ON/OFF), SCORE, TIME, HINT, SAVE, LOAD, UNDO, RESTART',
  'You can carry 6 kg in your hands and pockets, 20 kg with a backpack.',
];

// ------------------------------------------------------------- meta
let undoStack = [];
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); say('Game saved.', 'note'); }
  catch (e) { say('Sorry, the game could not be saved in this browser.', 'warn'); }
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
function loadGame() {
  let data = null;
  try { data = localStorage.getItem(SAVE_KEY); } catch (e) { /* ignore */ }
  if (!data) { say('There is no saved game.', 'warn'); return false; }
  S = Object.assign(newState(), JSON.parse(data)); undoStack = [];
  say('Game loaded.', 'note'); describe();
  return true;
}
function newGame() {
  S = newState(); undoStack = [];
  say('This is a text adventure about a normal man in a normal city, with a normal cat and a normal girlfriend.');
  say('Type HELP for commands, HINT if stuck.', 'note');
  describe();
}

// ------------------------------------------------------------- main
const FREE = new Set(['look', 'examine', 'inv', 'read']);

// While the PC is on, input goes to the game on the computer, except a few
// meta commands (save, load, undo, music).
const PC_META = new Set(['save', 'load', 'undo', 'music', 'mute', 'unmute']);

function exec(raw) {
  const c = parse(raw);
  if (!c) return;
  if (S && S.enc === 'meeting' && !S.over && !['save', 'load', 'undo', 'music', 'mute', 'unmute', 'help', 'hint', 'score', 'time', 'diary'].includes(c.v)) {
    undoStack.push(JSON.stringify(S));
    meetingAnswer(raw);
    RENDER();
    return;
  }
  if (S && S.pc && !S.over && !(PC_META.has(c.v) && !(c.v === 'save' && c.all))) {
    undoStack.push(JSON.stringify(S));
    if (undoStack.length > 50) undoStack.shift();
    spent = false; S.turn++;
    miniCommand(raw);
    if (!S.over && S.collapse) collapse();
    RENDER();
    return;
  }
  if (c.v === 'help' && !c.all) { HELP_TEXT.forEach((l, i) => say(l, i ? '' : 'title')); return; }
  if (c.v === 'save' && !c.all) { saveGame(); return; }
  if (c.v === 'save') c.v = 'rescue';
  if (c.v === 'load') { loadGame(); RENDER(); return; }
  if (c.v === 'restart') { newGame(); RENDER(); return; }
  if (c.v === 'undo') {
    if (!undoStack.length) { say('Nothing to undo.'); return; }
    S = JSON.parse(undoStack.pop()); say('Undone. Time goes back. If only real life worked like this.', 'note'); describe(); RENDER(); return;
  }
  if (c.v === 'music' || c.v === 'mute' || c.v === 'unmute') {
    const want = c.v === 'mute' || / off$/.test(c.raw) ? false : c.v === 'unmute' || / on$/.test(c.raw) ? true : null;
    const on = MUSIC(want);
    say(on ? 'Music ON. (Type MUSIC OFF to turn it off.)' : 'Music OFF. (Type MUSIC ON to turn it back on.)', 'note');
    RENDER(); return;
  }
  if (c.v === 'diary') { showDiary(is(c.all, 'week|all|whole')); return; }
  if (c.v === 'map') { say('You picture the city in your head... (press any key to close the map)', 'note'); SHOWMAP(buildMap()); return; }
  if (c.v === 'score') { showScore(); return; }
  if (c.v === 'time') { say(`It is ${DAYS[D()]}, ${clock()}.`); return; }
  if (c.v === 'hint') { showHint(); return; }
  if (S.over) { say('The game is over. Type RESTART, LOAD or UNDO.'); return; }

  undoStack.push(JSON.stringify(S));
  if (undoStack.length > 50) undoStack.shift();
  spent = false;
  S.turn++;

  const loc = L[S.loc], locBefore = S.loc, npcBefore = npcsHere();
  let handled = !S.enc && (npcAct(c) || weekAct(c));
  if (!handled && !(S.enc && FREE.has(c.v)) && loc.act) {
    handled = !!loc.act(c);
    if (!handled && (c.v === 'ask' || c.v === 'order')) handled = !!loc.act({ ...c, v: c.v === 'ask' ? 'talk' : 'buy' });
  }
  if (!handled) generic(c);
  if (!S.over && !spent) advance(1);
  if (!S.over && S.collapse) collapse();
  if (!S.over) updateLight();
  if (!S.over) npcTurn(npcBefore, locBefore);
  RENDER();
}
