'use strict';
// Find the Joker: a three-card monte game.

(function () {
  const START_BANK = 100;
  const BETS = [5, 10, 25, 50];

  // Difficulty levels. `moves` = [first round, maximum] shuffle moves,
  // `dur` = base duration of one move in ms, `minDur` = fastest allowed move,
  // `gap` = pause between moves, `moveSet` = weights of the move types.
  const LEVELS = {
    easy: {
      name: 'Easy', payout: 1, moves: [6, 12], dur: 560, minDur: 230, gap: 90, jitter: 0,
      moveSet: { swapAdj: 6, swapFar: 2 }
    },
    medium: {
      name: 'Medium', payout: 2, moves: [9, 16], dur: 460, minDur: 170, gap: 45, jitter: 0.15,
      moveSet: { swapAdj: 4, swapFar: 3, feint: 2, rotate: 2, cross: 1 }
    },
    hard: {
      name: 'Hard', payout: 3, moves: [12, 22], dur: 380, minDur: 135, gap: 0, jitter: 0.25,
      moveSet: { swapAdj: 2, swapFar: 3, feint: 2, rotate: 3, cross: 2, stack: 2, double: 2 }
    }
  };

  const $ = id => document.getElementById(id);
  const table = $('table'), msg = $('message'), dealBtn = $('deal');

  const state = {
    bank: START_BANK,
    bet: 10,
    level: 'easy',
    round: 0,      // rounds played in this game, drives the speed-up
    wins: 0,
    streak: 0,     // consecutive wins
    peak: START_BANK,
    best: START_BANK,
    phase: 'idle'  // idle | show | shuffle | pick | reveal | result | over
  };
  try {
    state.best = Math.max(START_BANK, parseInt(localStorage.getItem('day24.best')) || 0);
    if (LEVELS[localStorage.getItem('day24.level')]) state.level = localStorage.getItem('day24.level');
  } catch (e) { }

  // ---------- Helpers ----------

  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const lerp = (a, b, t) => a + (b - a) * t;
  const bump = t => Math.sin(Math.PI * t);
  const sx = slot => slot - 1;                  // slot 0..2 -> x -1..1
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const rnd = n => Math.floor(Math.random() * n);
  const coin = () => Math.random() < 0.5;

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

  function frontHTML(kind) {
    if (kind === 'joker') {
      const letters = 'JOKER'.split('').map(l => '<span>' + l + '</span>').join('');
      return '<div class="face front joker">' +
        '<div class="corner tl">' + letters + '</div>' + HAT_SVG +
        '<div class="title">JOKER</div>' +
        '<div class="corner br">' + letters + '</div></div>';
    }
    const [rank, suit, red] = kind === 'king' ? ['K', '♠', false] : ['Q', '♥', true];
    const corner = '<span>' + rank + '</span><span class="suit">' + suit + '</span>';
    return '<div class="face front' + (red ? ' red' : '') + '">' +
      '<div class="corner tl">' + corner + '</div>' +
      '<div class="pip"><span>' + suit + '<small>' + rank + '</small></span></div>' +
      '<div class="corner br">' + corner + '</div></div>';
  }

  // Each card: element, current slot and current pose (x in slot units, y in card heights).
  const cards = ['king', 'joker', 'queen'].map((kind, i) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Card');
    el.innerHTML = '<div class="inner">' + frontHTML(kind) + '<div class="face back"></div></div>';
    table.insertBefore(el, msg);
    const c = { el, kind, slot: i, x: sx(i), y: 0, r: 0, s: 1 };
    el.addEventListener('click', () => pick(c));
    return c;
  });
  const joker = cards[1];
  const cardAt = slot => cards.find(c => c.slot === slot);

  let spacing = 0, cardH = 0;
  // Size the cards to fit the table: three cards side by side in the width and
  // enough room above and below for the highest arcs (about 2.5 card heights).
  function measure() {
    const w = Math.max(48, Math.min(150, table.clientWidth / 3.8, table.clientHeight / 2.5 / 1.4));
    cardH = w * 1.4;
    table.style.setProperty('--cw', w.toFixed(1) + 'px');
    table.style.setProperty('--ch', cardH.toFixed(1) + 'px');
    spacing = Math.min(w * 1.3, (table.clientWidth - w) / 2 - 6);
    cards.forEach(c => render(c, c.el.style.zIndex || 1, 0));
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

  const adjPair = () => { const a = rnd(2); return coin() ? [a, a + 1] : [a + 1, a]; };
  const anyPair = () => { const a = rnd(3); return [a, (a + 1 + rnd(2)) % 3]; };

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

  // All three cards move at once, rotating their slots by one step.
  // The card that wraps around travels high over (or low under) the others.
  async function rotate(dur) {
    const dir = coin() ? 1 : -1;
    const over = coin();
    const plan = cards.map(c => [c, c.slot, (c.slot + dir + 3) % 3]);
    // One hand carries the card that wraps around, the other pushes a neighbour.
    const longCard = plan.find(p => Math.abs(p[2] - p[1]) === 2)[0];
    DEALER.hold([longCard, plan.find(p => p[0] !== longCard)[0]]);
    SOUND.whoosh(dur, 2);
    await animate(dur, t => {
      const e = ease(t), k = bump(e);
      for (const [c, from, to] of plan) {
        const long = Math.abs(to - from) === 2;
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
    const c = [0, 1, 2].find(s => s !== a && s !== b);
    await swapSlots(coin() ? a : b, c, dur * 0.75, 0.3);
  }

  const MOVES = {
    swapAdj: d => { const [a, b] = adjPair(); return swapSlots(a, b, d, 0.32); },
    swapFar: d => swapSlots(...(coin() ? [0, 2] : [2, 0]), d * 1.1, 0.42),
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

  async function shuffle() {
    const L = LEVELS[state.level];
    const n = Math.min(L.moves[1], L.moves[0] + Math.floor(state.round / 2));
    const k = speedFactor();
    // The dealer taunts once somewhere in the shuffle.
    const tauntAt = Math.random() < 0.65 ? 1 + rnd(Math.max(1, n - 2)) : -1;
    // On Hard, from the third round, he sometimes cheats: a coin rolls across
    // the table to draw the eye while he does one quick silent swap.
    const cheatAt = state.level === 'hard' && state.round >= 2 && Math.random() < 0.3 ? 2 + rnd(Math.max(1, n - 4)) : -1;
    let last = null;
    for (let i = 0; i < n; i++) {
      // Moves also speed up within the round.
      const prog = n > 1 ? i / (n - 1) : 1;
      const jitter = 1 + (Math.random() * 2 - 1) * L.jitter;
      const dur = Math.max(L.minDur, L.dur * k * (1 - 0.45 * prog) * jitter);
      if (i === tauntAt && i !== cheatAt) DEALER.say('shuffle');
      if (i === cheatAt) {
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
      if (L.gap) await wait(L.gap * k * (1 - 0.5 * prog));
    }
    DEALER.release();
  }

  // ---------- Round flow ----------

  // Bring all cards back in line, face up, with the Joker in the middle.
  async function regroup() {
    const others = cards.filter(c => c !== joker);
    if (coin()) others.reverse();
    const target = new Map([[others[0], 0], [joker, 1], [others[1], 2]]);
    const start = cards.map(c => ({ c, x: c.x, y: c.y, r: c.r, s: c.s }));
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

  async function deal() {
    if (state.phase !== 'idle' && state.phase !== 'result') return;
    if (state.bet > state.bank) state.bet = state.bank;
    state.phase = 'show';
    updateUI();
    SOUND.stopCheers();
    cards.forEach(c => c.el.classList.remove('win', 'miss', 'dim'));

    if (cards.some(c => c.el.classList.contains('down'))) {
      cards.forEach(c => setDown(c, false));
      SOUND.flip();
      await wait(450);
    }
    await regroup();
    say('Watch the Joker…');
    if (state.bet === state.bank || state.bet >= 100) DEALER.say('bigBet');
    else DEALER.say('deal', 0.5);
    await wait(1200);

    cards.forEach(c => setDown(c, true));
    SOUND.flip();
    await wait(550);

    state.phase = 'shuffle';
    say('Keep your eyes on it…');
    await shuffle();

    state.phase = 'pick';
    table.classList.add('picking');
    say('Where is the Joker? Pick a card.');
    DEALER.say('pick', 0.4);
    updateUI();
  }

  async function pick(c) {
    if (state.phase !== 'pick') return;
    state.phase = 'reveal';
    table.classList.remove('picking');
    setDown(c, false);
    SOUND.flip();
    SCENE.react('gasp');     // the crowd holds its breath
    await wait(450);

    const L = LEVELS[state.level];
    const bankEl = $('bank');
    bankEl.classList.remove('up', 'down');
    void bankEl.offsetWidth; // restart the flash animation

    if (c === joker) {
      const prize = state.bet * L.payout;
      state.bank += prize;
      state.wins++;
      c.el.classList.add('win');
      bankEl.classList.add('up');
      SOUND.win();
      say('You found the Joker! +$' + prize, 'good');
      state.streak++;
      DEALER.say(state.streak >= 3 ? 'streak' : 'win');
      setTimeout(() => SCENE.react('cheer', state.streak >= 3 || state.bet >= 50 ? 2 : 1), 250);
    } else {
      state.bank -= state.bet;
      state.streak = 0;
      c.el.classList.add('miss');
      bankEl.classList.add('down');
      SOUND.lose();
      say('Not this one. −$' + state.bet, 'bad');
      if (state.bank > 0) {
        DEALER.say('lose');
        setTimeout(() => SCENE.react('laugh'), 700);
      }
      await wait(450);
      setDown(joker, false);
      joker.el.classList.add('win');
      SOUND.flip();
    }
    state.round++;
    state.peak = Math.max(state.peak, state.bank);
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
    cards.forEach(o => {
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

  // Close the current run (busted or cashed out), store it and show the summary.
  function endRun(how) {
    const rank = SALOON.addRecord({
      peak: state.peak, final: state.bank, rounds: state.round, wins: state.wins,
      level: LEVELS[state.level].name
    });
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
    endRun('cashout');
  }

  function newGame() {
    $('over').hidden = true;
    Object.assign(state, { bank: START_BANK, bet: 10, round: 0, wins: 0, streak: 0, peak: START_BANK, phase: 'idle' });
    cards.forEach(c => { setDown(c, false); c.el.classList.remove('win', 'miss', 'dim'); });
    regroup();
    say('Place your bet and deal.');
    updateUI();
  }

  // ---------- Controls ----------

  const levelBox = $('levels'), chipBox = $('chips');

  for (const [id, L] of Object.entries(LEVELS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.level = id;
    b.innerHTML = L.name + '<small>pays ' + L.payout + ':1</small>';
    b.addEventListener('click', () => {
      if (busy()) return;
      if (state.level !== id && (id === 'hard' || id === 'easy')) DEALER.say(id);
      state.level = id;
      try { localStorage.setItem('day24.level', id); } catch (e) { }
      SOUND.chip();
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
    dealBtn.disabled = b;
    dealBtn.textContent = state.phase === 'result' ? 'Deal again' : 'Deal';
    $('cashout').disabled = state.phase !== 'result';
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

  // Audio can only start after a user gesture.
  window.addEventListener('pointerdown', () => { SOUND.init(); MUSIC.unlock(); }, { capture: true });

  window.addEventListener('keydown', e => {
    SOUND.init();
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
    } else if (['1', '2', '3'].includes(e.key)) {
      pick(cardAt(+e.key - 1));
    } else if (e.key === 'm' || e.key === 'M') {
      SOUND.toggleMute();
      showMute();
    } else if (e.key === 'n' || e.key === 'N') {
      MUSIC.toggle();
      showMusic();
    }
  });

  window.addEventListener('resize', measure);
  measure();
  SALOON.init(table, state.best);
  SCENE.init(table);
  DEALER.init(table, cards, () => ({ spacing, cardH }));
  updateUI();
  setTimeout(() => DEALER.say('greet'), 700);

  // Test hooks.
  window.GAME = { state, cards, deal, pick, cardAt, MOVES, joker, cashOut, endRun };
})();
