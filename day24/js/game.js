'use strict';
// Find the Joker: a three-card monte game (four cards on Pro).

(function () {
  const START_BANK = 100;
  const BETS = [5, 10, 25, 50];

  // Difficulty levels. `moves` = [first round, maximum] shuffle moves,
  // `dur` = base duration of one move in ms, `minDur` = fastest allowed move,
  // `gap` = pause between moves, `moveSet` = weights of the move types,
  // `time` = seconds to pick a card, `cards` = number of cards (default 3).
  const LEVELS = {
    easy: {
      name: 'Easy', payout: 1, time: 12, moves: [6, 12], dur: 560, minDur: 230, gap: 90, jitter: 0,
      moveSet: { swapAdj: 6, swapFar: 2 }
    },
    medium: {
      name: 'Medium', payout: 2, time: 9, moves: [9, 16], dur: 460, minDur: 170, gap: 45, jitter: 0.15,
      moveSet: { swapAdj: 4, swapFar: 3, feint: 2, rotate: 2, cross: 1 }
    },
    hard: {
      name: 'Hard', payout: 3, time: 7, moves: [12, 22], dur: 380, minDur: 135, gap: 0, jitter: 0.25,
      moveSet: { swapAdj: 2, swapFar: 3, feint: 2, rotate: 3, cross: 2, stack: 2, double: 2 }
    },
    pro: {
      name: 'Pro', payout: 4, time: 8, cards: 4, moves: [14, 26], dur: 360, minDur: 125, gap: 0, jitter: 0.25,
      moveSet: { swapAdj: 2, swapFar: 3, feint: 2, rotate: 3, cross: 2, stack: 2, double: 2 }
    }
  };

  // Helpers the player can buy with the bank. They never eat into the bet.
  const AIDS = {
    slow: { name: 'Slow', cost: 10, tip: 'Slows down the next shuffle' },
    clue: { name: 'Eliminate', cost: 20, tip: 'Turns over one wrong card' },
    peek: { name: 'Peek', cost: 30, tip: 'Shows the Joker for half a second' }
  };

  const $ = id => document.getElementById(id);
  const table = $('table'), msg = $('message'), dealBtn = $('deal');

  const state = {
    bank: START_BANK,
    bet: 10,
    level: 'easy',
    round: 0,        // rounds played in this game, drives the speed-up
    wins: 0,
    streak: 0,       // consecutive Joker wins
    peak: START_BANK,
    best: START_BANK,
    timerOn: true,   // time limit for picking
    slow: false,     // "Slow" helper armed for the next shuffle
    used: {},        // helpers used this round
    runAids: new Set(), // helpers used in this run (for a medal)
    locked: false,   // a helper animation is running
    surprise: null,  // 'ace' | 'skull' | null: special card in this round
    cheated: false,  // the dealer used the coin trick this round
    allIn: false,
    bankAtDeal: START_BANK,
    heat: 0,         // how irritated the dealer is, 0..100 (drives his mood, tricks and the sheriff)
    sheriff: false,  // the sheriff is in the saloon
    sheriffRounds: 0,
    eventTimer: 0,   // timer of the random cat / thief event
    phase: 'idle'    // idle | show | shuffle | pick | reveal | result | over
  };
  try {
    state.best = Math.max(START_BANK, parseInt(localStorage.getItem('day24.best')) || 0);
    if (LEVELS[localStorage.getItem('day24.level')]) state.level = localStorage.getItem('day24.level');
    state.timerOn = localStorage.getItem('day24.timer') !== 'off';
  } catch (e) { }

  // ---------- Helpers ----------

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const bump = t => Math.sin(Math.PI * t);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rnd = n => Math.floor(Math.random() * n);
  const coin = () => Math.random() < 0.5;
  const shuffled = list => list.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

  // Run fn(t) every frame for `dur` ms with t going from 0 to 1.
  function animate(dur, fn) {
    return new Promise(resolve => {
      const t0 = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - t0) / dur);
        fn(t);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  // ---------- Cards ----------

  const HAT_SVG =
    '<svg class="hat" viewBox="0 0 100 92" aria-hidden="true">' +
    '<path d="M26 70 C22 50 12 40 10 26 C26 30 38 46 44 68 Z" fill="#c4262e"/>' +
    '<path d="M38 68 C40 44 46 24 50 8 C54 24 60 44 62 68 Z" fill="#e3b955"/>' +
    '<path d="M74 70 C78 50 88 40 90 26 C74 30 62 46 56 68 Z" fill="#5b2a86"/>' +
    '<circle cx="10" cy="25" r="6" fill="#e3b955"/>' +
    '<circle cx="50" cy="8" r="6" fill="#c4262e"/>' +
    '<circle cx="90" cy="25" r="6" fill="#e3b955"/>' +
    '<rect x="20" y="66" width="60" height="14" rx="5" fill="#2b2b2b"/>' +
    '<path d="M30 73 l5 -5 l5 5 l-5 5 Z M45 73 l5 -5 l5 5 l-5 5 Z M60 73 l5 -5 l5 5 l-5 5 Z" fill="#e3b955"/>' +
    '<path d="M36 84 Q50 94 64 84" stroke="#c4262e" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  const SKULL_SVG =
    '<svg class="hat" viewBox="0 0 100 100" aria-hidden="true">' +
    '<path d="M50 8 C26 8 14 26 14 44 C14 56 20 64 28 68 L28 84 L72 84 L72 68 C80 64 86 56 86 44 C86 26 74 8 50 8 Z" fill="#e8e0f0"/>' +
    '<circle cx="36" cy="46" r="9" fill="#17101a"/><circle cx="64" cy="46" r="9" fill="#17101a"/>' +
    '<path d="M50 54 L44 66 H56 Z" fill="#17101a"/>' +
    '<path d="M38 84 V74 M46 84 V74 M54 84 V74 M62 84 V74" stroke="#17101a" stroke-width="3"/></svg>';

  const letters = word => word.split('').map(l => '<span>' + l + '</span>').join('');

  function frontHTML(kind) {
    if (kind === 'joker') {
      return '<div class="face front joker">' +
        '<div class="corner tl">' + letters('JOKER') + '</div>' + HAT_SVG +
        '<div class="title">JOKER</div>' +
        '<div class="corner br">' + letters('JOKER') + '</div></div>';
    }
    if (kind === 'skull') {
      return '<div class="face front skull">' +
        '<div class="corner tl">' + letters('SKULL') + '</div>' + SKULL_SVG +
        '<div class="title">−2× BET</div>' +
        '<div class="corner br">' + letters('SKULL') + '</div></div>';
    }
    if (kind === 'ace') {
      const corner = '<span>A</span><span class="suit">★</span>';
      return '<div class="face front gold">' +
        '<div class="corner tl">' + corner + '</div>' +
        '<div class="pip"><span>★<small>½ BET</small></span></div>' +
        '<div class="corner br">' + corner + '</div></div>';
    }
    const [rank, suit, red] = {
      king: ['K', '♠', false], queen: ['Q', '♥', true], jack: ['J', '♣', false]
    }[kind];
    const corner = '<span>' + rank + '</span><span class="suit">' + suit + '</span>';
    return '<div class="face front' + (red ? ' red' : '') + '">' +
      '<div class="corner tl">' + corner + '</div>' +
      '<div class="pip"><span>' + suit + '<small>' + rank + '</small></span></div>' +
      '<div class="corner br">' + corner + '</div></div>';
  }

  // Four card elements; the fourth only plays on Pro. Each card keeps its element,
  // face, current slot and current pose (x in slot units, y in card heights).
  const cards = ['king', 'joker', 'queen', 'jack'].map((kind, i) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Card');
    el.innerHTML = '<div class="inner">' + frontHTML(kind) + '<div class="face back"></div></div>';
    table.insertBefore(el, msg);
    const c = { el, kind, slot: i, x: i - 1, y: 0, r: 0, s: 1, out: false };
    el.addEventListener('click', () => pick(c));
    return c;
  });

  const N = () => LEVELS[state.level].cards || 3;
  const active = () => cards.slice(0, N());
  const sx = slot => slot - (N() - 1) / 2;            // slot -> x in card spacings
  const cardAt = slot => active().find(c => c.slot === slot);
  const jokerCard = () => active().find(c => c.kind === 'joker');

  function setKind(c, kind) {
    c.kind = kind;
    c.el.querySelector('.front').outerHTML = frontHTML(kind);
  }

  // Faces for a new round: the Joker plus plain cards, sometimes one of them
  // replaced by a surprise card (Golden Ace or Skull). Done while face down.
  function assignKinds(allowSurprise) {
    const n = N();
    const kinds = shuffled(['joker', ...['king', 'queen', 'jack'].slice(0, n - 1)]);
    state.surprise = null;
    if (allowSurprise && state.round >= 2 && Math.random() < 0.3) {
      state.surprise = coin() ? 'ace' : 'skull';
      const plain = kinds.map((k, i) => k === 'joker' ? -1 : i).filter(i => i >= 0);
      kinds[plain[rnd(plain.length)]] = state.surprise;
    }
    active().forEach((c, i) => setKind(c, kinds[i]));
  }

  let spacing = 0, cardH = 0;
  // Size the cards to fit the table: all cards side by side in the width and
  // enough room above and below for the highest arcs (about 2.5 card heights).
  function measure() {
    const n = N();
    const w = Math.max(48, Math.min(150, table.clientWidth / (n + 0.8), table.clientHeight / 2.5 / 1.4));
    cardH = w * 1.4;
    table.style.setProperty('--cw', w.toFixed(1) + 'px');
    table.style.setProperty('--ch', cardH.toFixed(1) + 'px');
    spacing = Math.min(w * 1.3, (table.clientWidth - w) / (n - 1) - 6);
    cards.forEach((c, i) => {
      c.el.classList.toggle('gone', i >= n);
      render(c, c.el.style.zIndex || 1, 0);
    });
  }

  function render(c, z, lift) {
    c.el.style.transform = 'translate(-50%, -50%) translate(' + (c.x * spacing).toFixed(2) + 'px, ' +
      (c.y * cardH).toFixed(2) + 'px) rotate(' + c.r.toFixed(2) + 'deg) scale(' + c.s.toFixed(4) + ')';
    c.el.style.zIndex = z;
    c.el.style.setProperty('--lift', lift.toFixed(3));
  }

  function pose(c, p) {
    c.x = p.x;
    c.y = p.y || 0;
    c.r = p.r || 0;
    c.s = p.s || 1;
    render(c, p.z || 1, p.lift || 0);
  }

  function setDown(c, down) { c.el.classList.toggle('down', down); }

  // ---------- Shuffle moves ----------
  // Every move takes a duration in ms, animates the cards and updates their slots.
  // The cards always stay trackable: when two of them overlap, one is clearly
  // lifted (higher, bigger, on top) and the other one is pushed under.

  // Two cards trade places; one passes over the other.
  async function swapSlots(a, b, dur, arc, quiet) {
    const ca = cardAt(a), cb = cardAt(b);
    const top = coin() ? ca : cb;
    DEALER.hold([ca, cb]);
    if (!quiet) SOUND.whoosh(dur, Math.abs(a - b));
    await animate(dur, t => {
      const e = ease(t), k = bump(e);
      for (const [c, from, to] of [[ca, a, b], [cb, b, a]]) {
        const up = c === top;
        pose(c, {
          x: lerp(sx(from), sx(to), e),
          y: (up ? -arc : arc * 0.6) * k,
          s: 1 + (up ? 0.1 : -0.06) * k,
          r: (to - from) * 5 * k * (up ? 1 : -1),
          z: up ? 3 : 2,
          lift: up ? k : 0
        });
      }
    });
    ca.slot = b;
    cb.slot = a;
    if (!quiet) SOUND.tap();
  }

  const adjPair = () => { const a = rnd(N() - 1); return coin() ? [a, a + 1] : [a + 1, a]; };
  const anyPair = () => { const n = N(), a = rnd(n); return [a, (a + 1 + rnd(n - 1)) % n]; };
  // Two slots at least two apart (the outer ones on 3 cards).
  const farPair = () => {
    const n = N(), all = [];
    for (let a = 0; a < n; a++) for (let b = a + 2; b < n; b++) all.push([a, b]);
    const p = all[rnd(all.length)];
    return coin() ? p : [p[1], p[0]];
  };

  // Two cards start a swap, almost meet, then go back home.
  async function feint(dur) {
    const [a, b] = anyPair();
    const ca = cardAt(a), cb = cardAt(b);
    const top = coin() ? ca : cb;
    const depth = 0.42 + Math.random() * 0.08;
    DEALER.hold([ca, cb]);
    SOUND.whoosh(dur * 0.5, 1);
    await animate(dur, t => {
      const k = bump(ease(t));
      for (const [c, from, to] of [[ca, a, b], [cb, b, a]]) {
        const up = c === top;
        pose(c, {
          x: sx(from) + (sx(to) - sx(from)) * depth * k,
          y: (up ? -0.22 : 0.12) * k,
          s: 1 + (up ? 0.07 : -0.04) * k,
          r: (to - from) * 4 * k,
          z: up ? 3 : 2,
          lift: up ? k * 0.7 : 0
        });
      }
    });
    SOUND.tap();
  }

  // All cards move at once, rotating their slots by one step.
  // The card that wraps around travels high over (or low under) the others.
  async function rotate(dur) {
    const n = N();
    const dir = coin() ? 1 : -1;
    const over = coin();
    const plan = active().map(c => [c, c.slot, (c.slot + dir + n) % n]);
    // One hand carries the card that wraps around, the other pushes a neighbour.
    const longCard = plan.find(p => Math.abs(p[2] - p[1]) === n - 1)[0];
    DEALER.hold([longCard, plan.find(p => p[0] !== longCard)[0]]);
    SOUND.whoosh(dur, 2);
    await animate(dur, t => {
      const e = ease(t), k = bump(e);
      for (const [c, from, to] of plan) {
        const long = Math.abs(to - from) === n - 1;
        const y = long ? (over ? -0.55 : 0.5) : (over ? 0.16 : -0.16);
        const lifted = long ? over : !over;
        pose(c, {
          x: lerp(sx(from), sx(to), e),
          y: y * k,
          s: 1 + (lifted ? 0.09 : -0.05) * k,
          r: (to - from) * 3 * k,
          z: lifted ? 3 : 1,
          lift: lifted ? k : 0
        });
      }
    });
    for (const [c, , to] of plan) c.slot = to;
    SOUND.tap();
  }

  // Swap with almost no arc: the cards slide right through each other.
  function cross(dur) {
    const [a, b] = anyPair();
    return swapSlots(a, b, dur * 1.05, 0.07);
  }

  // Two neighbouring cards slide on top of each other, wobble together for
  // a moment, then split up again, either swapped or back where they were.
  async function stack(dur) {
    const [a, b] = adjPair();
    const ca = cardAt(a), cb = cardAt(b);
    const top = coin() ? ca : cb;
    const real = Math.random() < 0.6;
    const mid = (sx(a) + sx(b)) / 2;
    const drift = (coin() ? 1 : -1) * 0.12;
    const total = dur * 1.9;
    DEALER.hold([ca, cb]);
    SOUND.whoosh(total * 0.35, 1);
    let tapped = false;
    await animate(total, t => {
      if (t > 0.62 && !tapped) { tapped = true; SOUND.whoosh(total * 0.38, 1); }
      for (const [c, from, other] of [[ca, a, b], [cb, b, a]]) {
        const up = c === top;
        const to = real ? other : from;
        // Position inside the stack: the top card is a bit higher and offset.
        const hx = mid + (up ? -0.06 : 0.06) * Math.sign(sx(from) - mid);
        const hy = up ? -0.12 : 0.03;
        let x, y, k;
        if (t < 0.38) {
          const e = ease(t / 0.38);
          x = lerp(sx(from), hx, e); y = lerp(0, hy, e); k = e;
        } else if (t < 0.62) {
          const h = (t - 0.38) / 0.24;
          x = hx + drift * bump(h); y = hy; k = 1;
        } else {
          const e = ease((t - 0.62) / 0.38);
          x = lerp(hx, sx(to), e); y = lerp(hy, 0, e); k = 1 - e;
        }
        pose(c, {
          x, y,
          s: 1 + (up ? 0.08 : -0.03) * k,
          r: (up ? -4 : 3) * k,
          z: up ? 3 : 2,
          lift: up ? k : 0
        });
      }
    });
    if (real) { ca.slot = b; cb.slot = a; }
    SOUND.tap();
  }

  // Two quick swaps back to back, the second one sharing a card with the first.
  async function double(dur) {
    const [a, b] = adjPair();
    await swapSlots(a, b, dur * 0.75, 0.3);
    const rest = [];
    for (let s = 0; s < N(); s++) if (s !== a && s !== b) rest.push(s);
    await swapSlots(coin() ? a : b, rest[rnd(rest.length)], dur * 0.75, 0.3);
  }

  const MOVES = {
    swapAdj: d => { const [a, b] = adjPair(); return swapSlots(a, b, d, 0.32); },
    swapFar: d => { const [a, b] = farPair(); return swapSlots(a, b, d * 1.1, 0.42); },
    feint, rotate, cross, stack, double
  };

  function pickMove(set, last, final) {
    let entries = Object.entries(set);
    // No feint twice in a row, and the last move always really moves cards.
    if (last === 'feint' || final) entries = entries.filter(([k]) => k !== 'feint');
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of entries) { if ((r -= w) < 0) return k; }
    return entries[0][0];
  }

  // Speed factor for this round: every round played makes the shuffle faster.
  const speedFactor = () => Math.max(0.5, Math.pow(0.955, state.round));

  async function shuffle(slowK) {
    const L = LEVELS[state.level];
    const n = Math.min(L.moves[1], L.moves[0] + Math.floor(state.round / 2));
    const k = speedFactor();
    // The dealer taunts once somewhere in the shuffle.
    const tauntAt = Math.random() < 0.65 ? 1 + rnd(Math.max(1, n - 2)) : -1;
    // From the third round he sometimes cheats: a coin rolls across the table to
    // draw the eye while he does one quick silent swap. On Hard and Pro that is
    // normal, and the angrier he is the more often (twice when furious); on the
    // easier levels he only cheats once he is really annoyed. Never with the sheriff around.
    const hardish = state.level === 'hard' || state.level === 'pro';
    let chance = hardish ? 0.3 + state.heat * 0.004 : (state.heat >= 50 ? (state.heat - 40) * 0.006 : 0);
    if (state.sheriff || state.round < 2) chance = 0;
    const cheatSet = new Set();
    if (Math.random() < chance) {
      const first = 2 + rnd(Math.max(1, n - 4));
      cheatSet.add(first);
      if (state.heat >= 75 && n >= 9) {
        const second = 2 + rnd(Math.max(1, n - 4));
        if (Math.abs(second - first) >= 3) cheatSet.add(second);
      }
    }
    let last = null;
    for (let i = 0; i < n; i++) {
      // Moves also speed up within the round.
      const prog = n > 1 ? i / (n - 1) : 1;
      const jitter = 1 + (Math.random() * 2 - 1) * L.jitter;
      const dur = Math.max(L.minDur, L.dur * k * (1 - 0.45 * prog) * jitter) * slowK;
      if (i === tauntAt && !cheatSet.has(i)) DEALER.say('shuffle');
      if (cheatSet.has(i)) {
        state.cheated = true;
        const coinGone = DEALER.distract();
        await wait(350);
        const [a, b] = anyPair();
        await swapSlots(a, b, Math.max(L.minDur, dur * 0.6), 0.05, true);
        await coinGone;
        last = 'cheat';
        continue;
      }
      last = pickMove(L.moveSet, last, i === n - 1);
      await MOVES[last](dur);
      if (L.gap) await wait(L.gap * k * (1 - 0.5 * prog) * slowK);
    }
    DEALER.release();
  }

  // ---------- Round flow ----------

  // Bring all cards back in line, with the Joker in the middle.
  async function regroup() {
    const act = active(), n = act.length;
    const jc = act.find(c => c.kind === 'joker');
    const jokerSlot = n === 3 ? 1 : (coin() ? 1 : 2);
    const slots = [];
    for (let s = 0; s < n; s++) if (s !== jokerSlot) slots.push(s);
    const target = new Map([[jc, jokerSlot]]);
    shuffled(act.filter(c => c !== jc)).forEach((c, i) => target.set(c, slots[i]));
    const start = act.map(c => ({ c, x: c.x, y: c.y, r: c.r, s: c.s }));
    if (start.some(p => Math.abs(p.x - sx(target.get(p.c))) > 0.01)) SOUND.whoosh(420, 1);
    await animate(420, t => {
      const e = ease(t);
      for (const p of start) {
        pose(p.c, { x: lerp(p.x, sx(target.get(p.c)), e), y: lerp(p.y, 0, e), r: lerp(p.r, 0, e), s: lerp(p.s, 1, e) });
      }
    });
    for (const [c, s] of target) c.slot = s;
  }

  function say(text, tone) {
    msg.textContent = text;
    msg.className = 'message' + (tone ? ' ' + tone : '');
  }

  function clearCardMarks() {
    cards.forEach(c => { c.out = false; c.el.classList.remove('win', 'miss', 'dim', 'out', 'chosen'); });
  }

  async function deal() {
    if (busy()) return;
    if (state.bet > state.bank) state.bet = state.bank;
    const L = LEVELS[state.level];
    state.phase = 'show';
    state.used = {};
    state.cheated = false;
    state.allIn = state.bet >= state.bank;
    state.bankAtDeal = state.bank;
    updateUI();
    SOUND.stopCheers();
    FX.bet(state.bet);
    clearCardMarks();

    // Turn everything face down, give the cards their faces for this round, line them up.
    const act = active();
    if (act.some(c => !c.el.classList.contains('down'))) {
      act.forEach(c => setDown(c, true));
      SOUND.flip();
      await wait(450);
    }
    assignKinds(true);
    await regroup();

    // Show them face up.
    act.forEach(c => setDown(c, false));
    SOUND.flip();
    await wait(450);
    if (state.surprise === 'ace') say('A surprise card! The Golden Ace pays half your bet.');
    else if (state.surprise === 'skull') say('A surprise card! Beware the Skull: it costs double.');
    else say('Watch the Joker…');
    if (state.surprise) DEALER.say('surprise');
    else if (state.bet === state.bank || state.bet >= 100) DEALER.say('bigBet');
    else DEALER.say('deal', 0.5);
    await wait(state.surprise || act.length > 3 ? 2200 : 1300);

    act.forEach(c => setDown(c, true));
    SOUND.flip();
    await wait(550);

    state.phase = 'shuffle';
    say('Keep your eyes on it…');
    const slowK = state.slow ? 1.7 : 1;
    state.slow = false;
    updateUI();
    await shuffle(slowK);

    state.phase = 'pick';
    table.classList.add('picking');
    say('Where is the Joker? Pick a card.');
    DEALER.say('pick', 0.4);
    scheduleEvent();
    if (state.timerOn) FX.startTimer(L.time, () => reveal(null));
    updateUI();
  }

  async function pick(c) {
    if (state.phase !== 'pick' || state.locked || !active().includes(c) || c.out) return;
    await reveal(c);
  }

  // The player picks card `c` (null when the time runs out): drum roll,
  // slow turn of the card, then the outcome.
  async function reveal(c) {
    if (state.phase !== 'pick') return;
    state.phase = 'reveal';
    FX.stopTimer();
    clearTimeout(state.eventTimer);
    FX.cancelCat();
    FX.cancelThief();
    table.classList.remove('picking');
    updateUI();
    SCENE.react('gasp');     // the crowd holds its breath

    if (c) {
      c.el.classList.add('chosen');
      SOUND.drumroll(1.1);
      await wait(380);
      const inner = c.el.querySelector('.inner');
      inner.style.transitionDuration = '.8s';
      setDown(c, false);
      SOUND.flip();
      await wait(820);
      SOUND.hit();
      inner.style.transitionDuration = '';
    } else {
      say("Time's up!", 'bad');
      DEALER.say('timeup');
      await wait(700);
    }

    const L = LEVELS[state.level];
    const stake = Math.min(state.bet, state.bank);
    const jc = jokerCard();
    const kind = c ? c.kind : null;
    const bankEl = $('bank');
    bankEl.classList.remove('up', 'down');
    void bankEl.offsetWidth; // restart the flash animation
    const speedNow = 1 / speedFactor();
    let outcome = 'miss';

    if (kind === 'joker') {
      outcome = 'joker';
      const prize = stake * L.payout;
      state.bank += prize;
      state.wins++;
      state.streak++;
      c.el.classList.add('win');
      bankEl.classList.add('up');
      SOUND.win();
      say('You found the Joker! +$' + prize, 'good');
      DEALER.say(state.streak >= 3 ? 'streak' : 'win');
      FX.win(prize);
      setTimeout(() => SCENE.react('cheer', state.streak >= 3 || stake >= 50 ? 2 : 1), 250);
    } else if (kind === 'ace') {
      outcome = 'ace';
      const prize = Math.max(1, Math.ceil(stake / 2));
      state.bank += prize;
      state.streak = 0;
      c.el.classList.add('win');
      bankEl.classList.add('up');
      SOUND.win();
      say('Golden Ace! A safe +$' + prize, 'good');
      DEALER.say('ace');
      FX.win(prize, 0.45);
    } else {
      const loss = kind === 'skull' ? stake * 2 : stake;
      outcome = kind === 'skull' ? 'skull' : 'miss';
      state.bank = Math.max(0, state.bank - loss);
      state.streak = 0;
      if (c) c.el.classList.add('miss');
      bankEl.classList.add('down');
      SOUND.lose();
      if (kind === 'skull') say('The Skull! −$' + loss, 'bad');
      else if (c) say('Not this one. −$' + loss, 'bad');
      FX.lose(kind === 'skull');
      if (c) DEALER.say(kind === 'skull' ? 'skull' : 'lose');
      setTimeout(() => SCENE.react('boo'), 350);       // the crowd boos every lost round
    }

    // The dealer's temper: wins wind him up (more on a streak), losses calm him down.
    if (outcome === 'joker') state.heat += 14 + Math.min(10, (state.streak - 1) * 3);
    else if (outcome === 'ace') state.heat += 4;
    else state.heat -= c ? 12 : 6;
    state.heat -= 2 + (state.sheriff ? 10 : 0);
    state.heat = Math.max(0, Math.min(100, state.heat));

    // Show where the Joker was.
    if (c !== jc) {
      await wait(450);
      setDown(jc, false);
      jc.el.classList.add('win');
      SOUND.flip();
    }
    if (c) c.el.classList.remove('chosen');

    // Medals for this round.
    const earned = [];
    if (outcome === 'joker') {
      earned.push('first');
      if (state.streak >= 5) earned.push('streak5');
      if (state.allIn) earned.push('allin');
      if ((state.level === 'hard' || state.level === 'pro') && speedNow >= 1.8) earned.push('fast');
      if (state.cheated) earned.push('coin');
      if (state.level === 'pro') earned.push('pro');
      if (state.bankAtDeal <= 20) earned.push('brink');
    }
    if (outcome === 'ace') earned.push('ace');
    if (outcome === 'skull' && state.bank > 0) earned.push('skull');
    if (state.bank >= 5000) earned.push('legend');
    setTimeout(() => earned.forEach(id => MEDALS.award(id)), 1400);

    state.round++;
    state.peak = Math.max(state.peak, state.bank);
    setTimeout(sheriffCheck, 1600);
    if (state.bank > state.best) {
      state.best = state.bank;
      try { localStorage.setItem('day24.best', state.best); } catch (e) { }
      const fresh = SALOON.setBest(state.best);
      if (fresh.length) {
        const t = fresh[fresh.length - 1];
        setTimeout(() => {
          SOUND.unlock();
          SALOON.toast('New table unlocked: ' + t.name + '!');
          DEALER.say('unlock');
        }, 900);
      }
    }

    await wait(650);
    active().forEach(o => {
      if (o.el.classList.contains('down')) { setDown(o, false); o.el.classList.add('dim'); }
    });

    if (state.bank <= 0) {
      state.bank = 0;
      state.phase = 'over';
      updateUI();
      DEALER.say('bust');
      SCENE.react('hush');
      setTimeout(() => SCENE.swing(), 900);   // the loser slinks out through the batwing doors
      await wait(900);
      SOUND.gameOver();
      endRun('bust');
      return;
    }
    if (state.bet > state.bank) state.bet = state.bank;
    state.phase = 'result';
    updateUI();
  }

  // ---------- Sheriff ----------

  // The sheriff walks in when the dealer is furious: no more tricks for a few rounds.
  function sheriffCheck() {
    if (state.phase === 'over') return;
    if (state.sheriff) {
      if (--state.sheriffRounds <= 0) dismissSheriff();
    } else if (state.heat >= 80 && state.round >= 3) {
      callSheriff();
    }
  }

  function callSheriff() {
    state.sheriff = true;
    state.sheriffRounds = 3;
    SCENE.sheriff(true);
    DEALER.say('sheriff');
    SALOON.toast('The sheriff walks in, and he wants a duel!');
    MEDALS.award('sheriff');
    updateUI();
    setTimeout(startDuel, 2200);
  }

  // High noon: react faster than the sheriff. Win and he leaves, the dealer calms
  // down and you collect a bounty; lose (or surrender) and you pay a fine.
  function startDuel() {
    if (!state.sheriff || state.phase === 'over') return;
    const bounty = Math.max(25, Math.round(state.bank * 0.15));
    const fine = Math.min(Math.max(15, Math.round(state.bank * 0.1)), Math.max(0, state.bank - 1));
    EVENTS.duel({ bounty, fine }, r => {
      if (r.won) {
        state.bank += bounty;
        flashBank('up');
        FX.rain(14);
        SOUND.coins(10);
        MEDALS.award('duel');
        if (r.ms < 250) MEDALS.award('lightning');
        dismissSheriff();
        state.heat = 0;
        DEALER.say('duelWin');
      } else {
        state.bank -= fine;
        flashBank('down');
        DEALER.say('duelLose');
      }
      updateUI();
    });
  }

  function dismissSheriff() {
    state.sheriff = false;
    SCENE.sheriff(false);
    state.heat = Math.min(state.heat, 35);
    DEALER.say('sheriffGone');
    updateUI();
  }

  // ---------- Random events while picking: a cat hint or a chip thief ----------

  function scheduleEvent() {
    clearTimeout(state.eventTimer);
    if (state.round < 1 || Math.random() > 0.6) return;       // from the 2nd round, 60% of rounds
    const kind = Math.random() < 0.65 ? 'thief' : 'cat';      // mostly the thief
    state.eventTimer = setTimeout(() => runEvent(kind), 1200 + rnd(1800));
  }

  function flashBank(cls) {
    const el = $('bank');
    el.classList.remove('up', 'down');
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function runEvent(kind) {
    if (state.phase !== 'pick') return;
    if (kind === 'cat') {
      // The cat sits under a card: the Joker's about 45% of the time, otherwise another one.
      const pool = active().filter(c => c.kind !== 'joker' && !c.out);
      const target = Math.random() < 0.45 || !pool.length ? jokerCard() : pool[rnd(pool.length)];
      FX.catHint(target.x * spacing);
      DEALER.say('cat', 0.7);
      return;
    }
    say('A hand in your chips! Click it!', 'bad');
    DEALER.say('thief', 0.6);
    FX.thief(result => {
      if (result === 'caught') {
        const tip = Math.max(5, Math.round(state.bet * 0.2));
        state.bank += tip;
        flashBank('up');
        FX.rain(8);
        SOUND.coins(8);
        DEALER.say('thiefCaught');
        SCENE.react('laugh');
        MEDALS.bump('thief', 3);
        if (state.phase === 'pick') say('Got him! +$' + tip, 'good');
      } else {
        const loss = Math.max(0, Math.min(Math.max(5, Math.round(state.bet * 0.25)), state.bank - 1));
        state.bank -= loss;
        flashBank('down');
        DEALER.say('thiefWin');
        if (state.phase === 'pick') say('The thief got away with $' + loss + '!', 'bad');
      }
      updateUI();
      setTimeout(() => { if (state.phase === 'pick') say('Where is the Joker? Pick a card.'); }, 1800);
    });
  }

  // Close the current run (busted or cashed out), store it and show the summary.
  function endRun(how) {
    const rank = SALOON.addRecord({
      peak: state.peak, final: state.bank, rounds: state.round, wins: state.wins,
      level: LEVELS[state.level].name
    });
    SCENE.refreshPosters();
    $('overTitle').textContent = how === 'bust' ? 'Busted!' : 'Cashed out!';
    $('overText').textContent =
      (how === 'bust' ? '' : 'You walk away with $' + state.bank + '. ') +
      'You played ' + state.round + ' round' + (state.round === 1 ? '' : 's') +
      ' and found the Joker ' + state.wins + ' time' + (state.wins === 1 ? '' : 's') +
      '. Peak bank: $' + state.peak + '.';
    $('overRank').textContent = rank === 1 ? 'New record!' : rank ? 'Run #' + rank + ' on the board.' : '';
    $('over').hidden = false;
    $('again').focus();
  }

  function cashOut() {
    if (state.phase !== 'result') return;
    state.phase = 'over';
    updateUI();
    DEALER.say('cashout');
    SOUND.chip();
    if (state.bank >= 1000) MEDALS.award('rich');
    endRun('cashout');
  }

  // A different level can have a different number of cards: re-deal the faces.
  function applyLevel() {
    measure();
    FX.clear();
    clearCardMarks();
    assignKinds(false);
    active().forEach(c => setDown(c, false));
    regroup();
  }

  function newGame() {
    $('over').hidden = true;
    Object.assign(state, {
      bank: START_BANK, bet: 10, round: 0, wins: 0, streak: 0, peak: START_BANK, phase: 'idle',
      slow: false, used: {}, locked: false, surprise: null, cheated: false
    });
    state.runAids = new Set();
    state.heat = 0;
    clearTimeout(state.eventTimer);
    FX.cancelCat();
    FX.cancelThief();
    if (state.sheriff) { state.sheriff = false; SCENE.sheriff(false); }
    FX.clear();
    FX.stopTimer();
    clearCardMarks();
    cards.forEach(c => setDown(c, false));
    regroup();
    say('Place your bet and deal.');
    updateUI();
  }

  // ---------- Helpers (aids) ----------

  const canAfford = id => state.bank - AIDS[id].cost >= state.bet;

  function recordAid(id) {
    state.runAids.add(id);
    if (state.runAids.size === Object.keys(AIDS).length) MEDALS.award('gadget');
  }

  async function useAid(id) {
    const a = AIDS[id];
    if (id === 'slow') {
      // Arm (or disarm and refund) before dealing.
      if (busy()) return;
      if (state.slow) {
        state.slow = false;
        state.bank += a.cost;
      } else if (canAfford('slow')) {
        state.slow = true;
        state.bank -= a.cost;
        recordAid(id);
        DEALER.say('aid');
      }
      SOUND.chip();
      updateUI();
      return;
    }
    if (state.phase !== 'pick' || state.locked || state.used[id] || !canAfford(id)) return;
    state.used[id] = true;
    state.bank -= a.cost;
    recordAid(id);
    SOUND.chip();
    DEALER.say('aid');

    if (id === 'clue') {
      // Turn over one wrong card: it is out of the game.
      const pool = active().filter(c => c.kind !== 'joker' && !c.out);
      const c = pool[rnd(pool.length)];
      c.out = true;
      c.el.classList.add('out', 'dim');
      setDown(c, false);
      SOUND.flip();
    } else {
      // Peek: the Joker's card flips up for half a second and back.
      state.locked = true;
      updateUI();
      const j = jokerCard(), inner = j.el.querySelector('.inner');
      inner.style.transitionDuration = '.16s';
      setDown(j, false);
      SOUND.flip();
      await wait(560);
      // If the time ran out meanwhile, the reveal is already under way: leave it face up.
      if (state.phase === 'pick') { setDown(j, true); SOUND.flip(); }
      await wait(220);
      inner.style.transitionDuration = '';
      state.locked = false;
    }
    updateUI();
  }

  // ---------- Controls ----------

  const levelBox = $('levels'), chipBox = $('chips'), aidBox = $('aids');

  for (const [id, L] of Object.entries(LEVELS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.level = id;
    b.innerHTML = L.name + '<small>pays ' + L.payout + ':1</small>';
    b.addEventListener('click', () => {
      if (busy() || state.level === id) return;
      if (id === 'hard' || id === 'easy') DEALER.say(id);
      const cardsBefore = N();
      state.level = id;
      try { localStorage.setItem('day24.level', id); } catch (e) { }
      SOUND.chip();
      if (N() !== cardsBefore) applyLevel();
      updateUI();
    });
    levelBox.appendChild(b);
  }

  for (const v of [...BETS, 'all']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.v = v;
    b.textContent = v === 'all' ? 'ALL IN' : '$' + v;
    b.addEventListener('click', () => {
      if (busy()) return;
      state.bet = v === 'all' ? state.bank : v;
      SOUND.chip();
      updateUI();
    });
    chipBox.appendChild(b);
  }

  for (const [id, a] of Object.entries(AIDS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aid';
    b.dataset.aid = id;
    b.title = a.tip;
    b.innerHTML = a.name + '<small>$' + a.cost + '</small>';
    b.addEventListener('click', () => useAid(id));
    aidBox.appendChild(b);
  }

  const busy = () => !['idle', 'result'].includes(state.phase);

  function updateUI() {
    const b = busy();
    $('bank').textContent = '$' + state.bank;
    $('round').textContent = state.round + 1;
    $('speed').textContent = '×' + (1 / speedFactor()).toFixed(2);
    $('best').textContent = '$' + state.best;
    $('betValue').textContent = '$' + state.bet;
    for (const btn of levelBox.children) {
      btn.classList.toggle('on', btn.dataset.level === state.level);
      btn.disabled = b;
    }
    for (const chip of chipBox.children) {
      const v = chip.dataset.v === 'all' ? state.bank : +chip.dataset.v;
      chip.classList.toggle('on', chip.dataset.v === 'all' ? state.bet === state.bank && !BETS.includes(state.bet) : v === state.bet);
      chip.disabled = b || v > state.bank;
    }
    // Helpers: "Slow" before dealing; "Eliminate" and "Peek" once each while picking.
    const picking = state.phase === 'pick' && !state.locked;
    const wrong = active().filter(c => c.kind !== 'joker' && !c.out).length;
    for (const btn of aidBox.children) {
      const id = btn.dataset.aid;
      let usable;
      if (id === 'slow') usable = !b && (state.slow || canAfford('slow'));
      else if (id === 'clue') usable = picking && !state.used.clue && canAfford('clue') && wrong > 1;
      else usable = picking && !state.used.peek && canAfford('peek');
      btn.disabled = !usable;
      btn.classList.toggle('on', id === 'slow' ? state.slow : !!state.used[id]);
    }
    dealBtn.disabled = b;
    dealBtn.textContent = state.phase === 'result' ? 'Deal again' : 'Deal';
    $('cashout').disabled = state.phase !== 'result';
    DEALER.setHeat(state.heat);
    armFidget();
  }

  // While the player thinks (or hesitates before the next deal) the dealer
  // gets restless: taps his fingers, beckons or tips his hat.
  let fidgetTimer = 0;
  function armFidget() {
    clearTimeout(fidgetTimer);
    if (!['pick', 'idle', 'result'].includes(state.phase)) return;
    fidgetTimer = setTimeout(() => {
      DEALER.fidget(['drum', 'beckon', 'tip'][rnd(3)], state.phase === 'pick' ? 'wait' : 'idle');
      armFidget();
    }, 5500 + rnd(3500));
  }

  dealBtn.addEventListener('click', deal);
  $('again').addEventListener('click', newGame);
  $('cashout').addEventListener('click', cashOut);
  $('saloon').addEventListener('click', () => SALOON.openPanel());

  const muteBtn = $('mute');
  const showMute = () => { muteBtn.textContent = SOUND.muted ? 'Sound off' : 'Sound on'; };
  muteBtn.addEventListener('click', () => { SOUND.toggleMute(); showMute(); });
  showMute();

  const musicBtn = $('music');
  const showMusic = () => { musicBtn.textContent = MUSIC.enabled ? 'Music on' : 'Music off'; };
  musicBtn.addEventListener('click', () => { MUSIC.toggle(); showMusic(); });
  showMusic();

  const timerBtn = $('timer');
  const showTimer = () => { timerBtn.textContent = state.timerOn ? 'Timer on' : 'Timer off'; };
  function toggleTimer() {
    state.timerOn = !state.timerOn;
    try { localStorage.setItem('day24.timer', state.timerOn ? 'on' : 'off'); } catch (e) { }
    // Turning it off while picking removes the running timer; on starts none until the next round.
    if (!state.timerOn) FX.stopTimer();
    showTimer();
  }
  timerBtn.addEventListener('click', toggleTimer);
  showTimer();

  // Audio can only start after a user gesture.
  window.addEventListener('pointerdown', () => { SOUND.init(); MUSIC.unlock(); }, { capture: true });

  window.addEventListener('keydown', e => {
    SOUND.init();
    if (EVENTS.duelActive) {
      if (e.key === ' ' || e.key === 'Enter') { EVENTS.duelPress(); e.preventDefault(); }
      return;
    }
    if (e.key !== 'n' && e.key !== 'N') MUSIC.unlock();
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (SALOON.panelOpen) {
      if (e.key === 'Escape') SALOON.closePanel();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (!$('over').hidden) { newGame(); e.preventDefault(); return; }
      if (document.activeElement && document.activeElement.tagName === 'BUTTON' && e.key === 'Enter') return;
      if (!busy()) { deal(); e.preventDefault(); }
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      const c = cardAt(+e.key - 1);
      if (c) pick(c);
    } else if (e.key === 'm' || e.key === 'M') {
      SOUND.toggleMute();
      showMute();
    } else if (e.key === 'n' || e.key === 'N') {
      MUSIC.toggle();
      showMusic();
    } else if (e.key === 't' || e.key === 'T') {
      toggleTimer();
    }
  });

  window.addEventListener('resize', measure);
  measure();
  SALOON.init(table, state.best);
  SCENE.init(table);
  SCENE.hooks.cat = () => MEDALS.bump('cat', 3);
  FX.init(table);
  DEALER.init(table, cards, () => ({ spacing, cardH }));
  EVENTS.init(table);
  SEASON.init();
  // Start with the faces of the chosen level.
  assignKinds(false);
  regroup();
  updateUI();
  setTimeout(() => DEALER.say('greet'), 700);

  // Test hooks.
  window.GAME = {
    state, cards, active, deal, pick, reveal, cardAt, MOVES, cashOut, endRun, useAid, assignKinds,
    callSheriff, dismissSheriff, runEvent, startDuel,
    get joker() { return jokerCard(); }
  };
})();
