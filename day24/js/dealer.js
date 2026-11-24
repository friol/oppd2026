'use strict';
// The dealer: "Lucky Lou", a saloon hustler. Two hands reach in from the top
// of the table and push the cards around, a portrait in the corner talks
// through a speech bubble, and on Hard he sometimes cheats behind a distraction.

const DEALER = (function () {
  let table, cards, geom;               // geom() -> { spacing, cardW, cardH }
  let bubble, bubbleText, hideTimer = 0, dealerEl, heatFill;
  const hands = [];

  // Hand seen from above, fingers pointing at the player, with shirt cuff and
  // coat sleeve going up off the table. Thumb on the right (dealer's right hand,
  // shown on the player's left); the other hand is the mirrored copy.
  const HAND_SVG =
    '<svg viewBox="0 0 80 320" preserveAspectRatio="xMidYMax meet" aria-hidden="true">' +
    '<rect x="13" y="0" width="54" height="204" fill="#2b1a12"/>' +
    '<rect x="13" y="0" width="7" height="204" fill="#3a251a"/>' +
    '<rect x="10" y="194" width="60" height="24" rx="5" fill="#efe7d4"/>' +
    '<circle cx="58" cy="206" r="3.4" fill="#e3b955"/>' +
    '<path d="M68 236 C80 244 80 262 70 272 C66 266 62 254 60 246 Z" fill="#dcab82" stroke="#b07f5c" stroke-width="1.2"/>' +
    '<path d="M16 214 H64 C69 240 67 262 61 278 H19 C13 262 11 240 16 214 Z" fill="#e2b48c" stroke="#b07f5c" stroke-width="1.2"/>' +
    '<rect x="17" y="258" width="11" height="44" rx="5.5" fill="#e2b48c" stroke="#b07f5c" stroke-width="1.2"/>' +
    '<rect x="28.5" y="260" width="11" height="52" rx="5.5" fill="#e2b48c" stroke="#b07f5c" stroke-width="1.2"/>' +
    '<rect x="40" y="260" width="11" height="50" rx="5.5" fill="#e2b48c" stroke="#b07f5c" stroke-width="1.2"/>' +
    '<rect x="51.5" y="258" width="10" height="42" rx="5" fill="#e2b48c" stroke="#b07f5c" stroke-width="1.2"/>' +
    '<path d="M24 222 Q40 230 56 222" stroke="#c99470" stroke-width="1.4" fill="none"/>' +
    '</svg>';

  // Portrait: bowler hat, slick moustache and a crooked smile.
  const FACE_SVG =
    '<svg viewBox="0 0 64 64" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="31" fill="#3a2416"/>' +
    '<ellipse cx="32" cy="38" rx="15" ry="17" fill="#e2b48c"/>' +
    '<ellipse cx="17" cy="38" rx="3" ry="5" fill="#d6a47c"/>' +
    '<ellipse cx="47" cy="38" rx="3" ry="5" fill="#d6a47c"/>' +
    // Hair under the hat, so he can tip it.
    '<path d="M19 27 C19 21 45 21 45 27 L45 31 C41 26 23 26 19 31 Z" fill="#3b2415"/>' +
    '<g class="hat bowler"><ellipse cx="32" cy="24" rx="22" ry="4.5" fill="#151515"/>' +
    '<path d="M19 24 C19 8 45 8 45 24 Z" fill="#1f1f1f"/>' +
    '<rect x="19" y="19" width="26" height="4" fill="#7a1d22"/></g>' +
    // Seasonal hats (shown by setSeason).
    '<g class="hat sh santa"><ellipse cx="32" cy="24" rx="22" ry="5" fill="#f4f1e8"/>' +
    '<path d="M14 24 C16 9 30 3 47 6 C50 8 51 12 49 15 C41 12 37 17 50 24 Z" fill="#c4262e"/>' +
    '<circle cx="50" cy="13" r="4.5" fill="#f4f1e8"/></g>' +
    '<g class="hat sh witch"><ellipse cx="32" cy="24" rx="24" ry="4.5" fill="#2a1538"/>' +
    '<path d="M21 24 L35 3 L43 24 Z" fill="#2a1538"/><rect x="21" y="19" width="22" height="4" fill="#8a4cc0"/></g>' +
    '<path class="brow0" d="M24 33 l6 -1.5 M34 31.5 l6 1.5" stroke="#2b1a12" stroke-width="2" stroke-linecap="round"/>' +
    '<path class="brow1" d="M23 31 L31 34.5 M41 34.5 L49 31" stroke="#2b1a12" stroke-width="2.6" stroke-linecap="round"/>' +
    '<circle class="eye" cx="27" cy="36" r="1.8" fill="#2b1a12"/>' +
    '<circle class="eye" cx="37" cy="36" r="1.8" fill="#2b1a12"/>' +
    '<path d="M32 38 l-2 6 h3" stroke="#b07f5c" stroke-width="1.4" fill="none"/>' +
    '<path d="M21 46 C26 42 30 45 32 45 C34 45 38 42 43 46 C40 47 36 48 32 47 C28 48 24 47 21 46 Z" fill="#2b1a12"/>' +
    '<path class="mouth0" d="M28 50 Q33 53 37 49" stroke="#8a3a2a" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path class="mouth1" d="M27 52 Q32 48 38 52" stroke="#8a3a2a" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '</svg>';

  const LINES = {
    greet: ['Step right up, partner! Find the Joker, win the cash.', 'Easy money, friend. Just follow the Joker.', 'Care to test those eyes, stranger?'],
    deal: ["Here's the Joker. Keep your eyes on him.", 'Watch closely now…', 'Joker in the middle. Simple, right?', 'Nice and slow… for now.'],
    shuffle: ['Round and round she goes…', 'Faster than a rattlesnake!', "Don't blink, partner.", "Where's he going? Where's he going?", 'My hands are quicker than your eyes.', 'Hup, hup, hup!'],
    pick: ["Well? Where's the Joker?", 'Take your pick, partner.', 'Go on, point.', 'Feeling lucky?'],
    win: ["Hmph. Beginner's luck.", "Lucky guess, that's all.", "Well I'll be… sharp eyes.", "Don't get used to it."],
    streak: ['Are you counting cards on me?', 'Somebody fetch the sheriff, this one\'s a cheat!', 'Alright, alright. No more Mr. Nice Lou.'],
    lose: ['Ha! Better luck next time.', 'So close… not.', 'The house thanks you kindly.', "That Joker's a slippery fella."],
    bigBet: ["All in? Now that's the spirit!", 'Feeling brave, are we?', 'Big money! I like you already.'],
    bust: ['Pleasure doing business with you!', 'Come back when your pockets are full.'],
    cashout: ['Leaving so soon? Suit yourself.', 'Smart money walks away. Dumb money comes back.'],
    unlock: ['A fancy table for a high roller.', 'Moving up in the world, partner.'],
    hard: ['Hard, eh? I like a challenge.'],
    easy: ['Starting slow? Smart.'],
    cheat: ['Hey, is that a gold coin over there?', 'Whoa, look at that!', 'Did you drop something, partner?'],
    aid: ['Buying a little help, partner?', 'Money well spent… maybe.', 'Is that cheating? I call it shopping.', 'Pay the man, get the hint.'],
    surprise: ['Ah, a little surprise tonight.', 'Something special in the deck, friend.'],
    ace: ["Golden Ace… you're too smart for me.", 'A safe little prize. How sensible.'],
    skull: ['Ha! The Skull claims another soul.', 'Ooh, that one bites, partner.'],
    timeup: ['Too slow, partner!', "Time's up! Snooze you lose.", 'The clock does not wait.'],
    win1: ['Again? You are on a roll.', "Beginner's luck is wearing thin, partner."],
    win2: ['Are you counting cards?', "That's once too often, friend."],
    win3: ["Now you're pushing it!", "I'm watching you, partner. Closely."],
    lose1: ['Ah, so you ARE mortal.', 'Mine again. Feels better already.'],
    lose2: ["Ha! Now we're even.", 'Serves you right.'],
    lose3: ["Hah! That's for all the others!", 'Pay up, partner. Pay up.'],
    shuffle1: ["Try to keep up this time.", 'Quicker now, partner.'],
    shuffle2: ["Let's see you follow THIS.", 'Hup! Try and catch it!'],
    shuffle3: ['No more Mr. Nice Lou!', 'Eyes on the cards, you rascal!'],
    pick2: ["Well? Don't just sit there.", 'Go on, guess.'],
    pick3: ["Pick one! I dare you.", 'Choose, and choose badly.'],
    sheriff: ['Oh! Sheriff. Evening. Just a friendly game!', "Nothing to see here, Sheriff, honest."],
    sheriffGone: ['Phew. Now, where were we?', 'Finally. Shall we continue?'],
    cat: ["Don't trust that cat, partner.", 'That cat knows nothing.', 'Cats lie, friend. Always.'],
    thief: ['Hey! Hands off the chips!', 'Somebody is quick with their fingers!'],
    thiefCaught: ['Good catch, partner!', "Ha! Caught him red-handed."],
    thiefWin: ['Easy pickings. Thank you kindly!', 'Quick hands, that one.'],
    duelWin: ['Blast! Fastest gun in the county...', "Fine, fine. Take your reward."],
    duelLose: ['Ha! Even the sheriff beats you.', 'Pay the fine, partner.'],
    wait: ["Tick tock, partner.", "Don't be shy now.", "I haven't got all day…", 'Well? Cat got your tongue?', "I'm waiting, friend."],
    idle: ['Another round, partner?', 'The cards are getting restless.', 'Come on, the Joker misses you.', "Don't leave a lady waiting."]
  };
  const lastLine = {};
  let mood = 0;                         // 0 calm .. 3 furious, from the heat (see setHeat)

  function pickLine(kind) {
    const list = LINES[kind];
    let i;
    do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && i === lastLine[kind]);
    lastLine[kind] = i;
    return list[i];
  }

  function init(tableEl, cardList, geometry) {
    table = tableEl;
    cards = cardList;
    geom = geometry;

    for (const side of [-1, 1]) {
      const el = document.createElement('div');
      el.className = 'hand' + (side > 0 ? ' mirror' : '');
      el.innerHTML = HAND_SVG;
      table.appendChild(el);
      hands.push({ el, side, x: side * 3, y: -3, card: null, rest: 0 });
    }

    const dealer = document.createElement('div');
    dealer.className = 'dealer';
    dealer.innerHTML = '<div class="pcol"><div class="portrait">' + FACE_SVG + '</div>' +
      '<div class="heat" title="Dealer&#39;s patience: the more you win, the angrier he gets"><i></i></div></div>' +
      '<div class="bubble" hidden><span class="who">Lucky Lou</span><span class="text"></span></div>';
    table.appendChild(dealer);
    dealerEl = dealer;
    bubble = dealer.querySelector('.bubble');
    bubbleText = dealer.querySelector('.text');
    heatFill = dealer.querySelector('.heat i');

    requestAnimationFrame(loop);
  }

  // ---------- Hands ----------

  // The hands grab these cards (leftmost card to the left hand).
  function hold(list) {
    const sorted = list.slice(0, 2).sort((a, b) => a.x - b.x);
    if (sorted.length === 1) sorted.unshift(null);
    hands[0].card = sorted[0];
    hands[1].card = sorted[1];
  }

  function release() { hands.forEach(h => { h.card = null; }); }

  let last = 0;
  function loop(now) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    const g = geom();
    const H = table.clientHeight;
    for (const h of hands) {
      let tx, ty, k, wob = 0;
      if (h.card) {
        // Fingertips a little above the card centre, following lift and scale.
        tx = h.card.x * g.spacing;
        ty = h.card.y * g.cardH - 0.08 * g.cardH * h.card.s;
        k = 1 - Math.exp(-dt * 40);
      } else {
        // Resting just past the top edge, fingers peeking in, slowly breathing.
        tx = h.side * g.spacing * 1.05;
        ty = -H * 0.46 + g.cardH * 0.18 + Math.sin(now / 900 + h.side) * 4;
        k = 1 - Math.exp(-dt * 5);
        if (h.act && now < h.act.until) {
          // Fidgeting while the player thinks.
          k = 1 - Math.exp(-dt * 18);
          if (h.act.kind === 'drum') {
            // Fingers come down on the felt and drum on it.
            ty += g.cardH * 0.55 - Math.max(0, Math.sin((now - h.act.t0) / 45)) * 10;
          } else {
            // Beckoning: the hand comes in and waves "come on".
            ty += g.cardH * 0.5;
            tx += h.side * -g.spacing * 0.35;
            wob = Math.sin((now - h.act.t0) / 90) * 14;
          }
        }
      }
      h.x += (tx - h.x) * k;
      h.y += (ty - h.y) * k;
      // The arm points back to the dealer's shoulder above the table.
      const shoulderX = h.side * g.spacing * 0.7;
      const ang = wob + Math.max(-35, Math.min(35, Math.atan2(shoulderX - h.x, H * 0.46 + h.y + g.cardH * 2) * 180 / Math.PI));
      const s = h.card ? h.card.s : 1;
      h.el.style.transform = 'translate(-50%, -100%) translate(' + h.x.toFixed(1) + 'px, ' + h.y.toFixed(1) +
        'px) rotate(' + ang.toFixed(2) + 'deg) scale(' + s.toFixed(3) + ')';
    }
    requestAnimationFrame(loop);
  }

  // ---------- Speech ----------

  function say(kind, chance) {
    if (chance !== undefined && Math.random() > chance) return;
    const key = mood > 0 && LINES[kind + mood] ? kind + mood : kind;
    const text = LINES[key] ? pickLine(key) : kind;
    bubbleText.textContent = text;
    bubble.hidden = false;
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.classList.add('pop');
    SOUND.mumble(text.split(' ').length);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { bubble.hidden = true; }, 1800 + text.length * 45);
  }

  // ---------- Distraction ----------
  // A gold coin rolls across the felt with a clink while the dealer points at it.
  // Returns a promise that resolves once the coin has left the table.
  function distract() {
    say('cheat');
    const coin = document.createElement('div');
    coin.className = 'coin';
    const fromLeft = Math.random() < 0.5;
    coin.style.setProperty('--from', fromLeft ? '-12%' : '112%');
    coin.style.setProperty('--to', fromLeft ? '112%' : '-12%');
    table.appendChild(coin);
    SOUND.clink();
    setTimeout(() => SOUND.clink(), 380);
    return new Promise(r => setTimeout(() => { coin.remove(); r(); }, 1700));
  }

  // ---------- Fidgets ----------
  // Little gestures while waiting: tip the hat, drum the fingers, beckon.
  // `mood` ('wait' or 'idle') picks the line he says.
  function fidget(kind, mood) {
    if (hands.some(h => h.card)) return;
    const now = performance.now();
    if (kind === 'tip') {
      dealerEl.classList.add('tip');
      setTimeout(() => dealerEl.classList.remove('tip'), 1500);
    } else if (kind === 'drum') {
      hands[1].act = { kind, t0: now, until: now + 1600 };
      for (let i = 0; i < 5; i++) setTimeout(() => SOUND.tap(), 250 + i * 283);
    } else {
      hands[0].act = { kind: 'beckon', t0: now, until: now + 1700 };
    }
    say(mood || 'wait');
  }

  // How irritated he is (0..100): drives the meter, the face and the lines he picks.
  function setHeat(h) {
    mood = h < 25 ? 0 : h < 50 ? 1 : h < 75 ? 2 : 3;
    if (!dealerEl) return;
    for (let m = 1; m <= 3; m++) dealerEl.classList.toggle('m' + m, mood >= m);
    heatFill.style.width = Math.max(3, h) + '%';
    heatFill.style.setProperty('--h', Math.round(120 - 1.2 * h));
  }

  // Seasonal hat: 'christmas' (Santa hat) or 'halloween' (witch hat); anything else keeps the bowler.
  function setSeason(id) {
    if (!dealerEl) return;
    for (const s of ['christmas', 'halloween', 'autumn']) dealerEl.classList.toggle('s-' + s, id === s);
  }

  return { init, hold, release, say, distract, fidget, setHeat, setSeason, FACE_SVG, get mood() { return mood; } };
})();
