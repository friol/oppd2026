// "The Curse of Zormak": a tiny fantasy text adventure played on the old PC in
// the living room. Its state lives in S.mini (null when the PC is off), so it
// is saved and undone with the rest of the game. Every command costs 2 game
// minutes: it is very easy to lose track of time.
'use strict';

const MINI_ROOMS = {
  square: {
    name: 'Bramblewick Square',
    desc: 'The muddy square of Bramblewick village. An old stone WELL stands in the middle. A SAGE with a ridiculously long beard sits on a barrel. ' +
      'The forest lies north; the tavern is east.',
    exits: { n: 'forest', e: 'tavern' },
    art: [
      '    ___     _/\\_     ___     ___',
      '   |o o|   |    |   |o o|   |o o|',
      '   |   |   | ## |   |   |   |   |',
      ' __|___|___|____|___|___|___|___|__',
      '        (  WELL  )    sage: o/',
      '      VILLAGE OF BRAMBLEWICK',
    ],
  },
  tavern: {
    name: 'The Prancing Pickle',
    desc: 'A smoky tavern that smells of stew and bad decisions. A one-eyed BARKEEP polishes a mug. Behind him hangs a brass LANTERN with a price tag: 1 GOLD COIN. ' +
      'The square is west.',
    exits: { w: 'square' },
    art: [
      '  ____________________________',
      ' |  THE PRANCING PICKLE  [ ]  |',
      ' |   (o)  barkeep    lantern  |',
      ' |___/|\\______________[#]_____|',
      '   [] [] [] mugs  [] [] []',
      '      ~ a bard snores ~',
    ],
  },
  forest: {
    name: 'Whispering Woods',
    desc: 'Tall dark trees whisper rude things about you. Paths lead north to a bridge, east to a cave, and south back to the village.',
    exits: { s: 'square', n: 'bridge', e: 'cave' },
    art: [
      '    /\\      /\\    /\\      /\\',
      '   /  \\    /  \\  /  \\    /  \\',
      '  /____\\  /____\\/____\\  /____\\',
      '    ||      ||    ||      ||',
      '  "psst... your shoes are ugly"',
      '        WHISPERING WOODS',
    ],
  },
  cave: {
    name: 'Gloomy Cave',
    desc: () => S.mini.inv.includes('lantern')
      ? 'Your lantern lights up a damp cave. In the middle, a SWORD is stuck in a rock, glowing faintly. A sign: "WHOEVER PULLETH THIS SWORD... PLEASE PUT IT BACK AFTER." The exit is west.'
      : 'It is pitch dark in here. You can hear dripping water, and something breathing that isn\'t you. Without a light you won\'t find anything. The exit is west.',
    exits: { w: 'forest' },
    art: [
      '   _____________________________',
      '  /   .      .        .     .   \\',
      ' |      .   ___|>___      .      |',
      ' |   .     |  rock  |  .    .    |',
      '  \\________|________|___________/',
      '         GLOOMY  CAVE',
    ],
  },
  bridge: {
    name: 'Troll Bridge',
    desc: () => S.mini.f.troll
      ? 'An old wooden bridge over a chasm. The TROLL waves you through cheerfully, still muttering "piano... ha!" The castle is north, the forest south.'
      : 'An old wooden bridge over a bottomless chasm. A huge TROLL blocks the way: "NONE SHALL PASS! Unless... you answer my RIDDLE!" The forest is south.',
    exits: { s: 'forest', n: 'gate' },
    art: [
      '              ___',
      '   (o_o)     |   |  <- TROLL',
      '  _/|  |\\_____________________',
      ' |__|__|__|__|__|__|__|__|__|_|',
      '     \\                     /',
      '      ~~~~ bottomless ~~~~',
    ],
  },
  gate: {
    name: 'Castle Zormak',
    desc: 'The black gate of Castle Zormak, decorated with skulls (plastic, on closer inspection). Smoke drifts out of the door to the north. The bridge is south.',
    exits: { s: 'bridge', n: 'throne' },
    art: [
      '   |>         |>         |>',
      '  _|_   _   _|_|_   _   _|_',
      ' |   |_| |_|     |_| |_|   |',
      ' |   CASTLE   ZORMAK       |',
      ' |_________|  __  |________|',
      '           | |  | |',
    ],
  },
  throne: {
    name: 'Throne Room',
    desc: () => S.mini.f.won
      ? 'The empty throne room. Zormak has gone. Only a few scorch marks and a half-read book remain.'
      : 'A vast hall full of smoke and gold. On a mountain of coins lies ZORMAK THE TERRIBLE, a dragon as big as a bus. He opens one yellow eye. "Ugh. Another hero." The gate is south.',
    exits: { s: 'gate' },
    art: [
      '          __        ____',
      '     ____/ o\\______/    \\___   zzz..',
      '    <___    ____    _____   _>~~',
      '        \\__/    \\__/     \\_/',
      '   $ $ $ $ $  Z O R M A K  $ $ $ $',
      '  $ $ $ $ $ $ $ $ $ $ $ $ $ $ $ $ $',
    ],
  },
};

const MINI_HELP = 'ZORMAK.EXE commands: N S E W, LOOK, EXAMINE thing, TAKE thing, INVENTORY, TALK TO someone, BUY thing, SEARCH thing, ANSWER word, FIGHT someone, SCORE. ' +
  'QUIT turns the computer off.';

function miniSay(t) { say(t, 'pc'); }
function miniLook() {
  const r = MINI_ROOMS[S.mini.room];
  miniSay('== ' + r.name.toUpperCase() + ' ==');
  miniSay(typeof r.desc === 'function' ? r.desc() : r.desc);
}

function miniStart() {
  if (S.f.powerCut) { say('You press the power button. Nothing. No electricity, no computer.'); return; }
  if (!S.mini || S.mini.dead || S.mini.f.won) S.mini = { room: 'square', inv: [], f: {}, score: 0, played: 0 };
  S.pc = true;
  say('You sit down at the old beige PC. It whirs, beeps, and grinds its hard disk like a coffee mill.', 'note');
  miniSay('C:\\> ZORMAK.EXE');
  miniSay('*** THE CURSE OF ZORMAK *** (c) 1989 Dragonbyte Software. ' + (S.mini.played ? 'Resuming your saved quest...' : 'A dragon terrorises the land. Only YOU can stop him.'));
  miniSay('(Type HELP for commands, QUIT to switch the computer off.)');
  S.mini.lastNote = S.t;
  miniLook();
}

function miniQuit() {
  say('You switch off the computer. The screen shrinks to a white dot and disappears. Back to real life.', 'note');
  S.pc = false;
  describe();
}

function miniPoints(n) { S.mini.score += n; miniSay(`[Your score just went up by ${n}. Total: ${S.mini.score}/100]`); }

function miniDie(text) {
  miniSay(text);
  miniSay('*** YOU HAVE DIED IN THE CURSE OF ZORMAK *** Type RESTART to try again or QUIT.');
  S.mini.dead = true;
}

// Returns true if the command was a quit.
function miniExec(raw) {
  const STOPW = new Set(['the', 'a', 'an', 'to', 'at', 'with', 'in', 'into', 'on', 'from', 'for', 'of', 'my']);
  const w = raw.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((x) => x && !STOPW.has(x));
  if (!w.length) return false;
  const DIRS = { n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w' };
  const SYN = { l: 'look', x: 'examine', inspect: 'examine', get: 'take', grab: 'take', pull: 'take', i: 'inv', inventory: 'inv',
    speak: 'talk', ask: 'talk', kill: 'fight', attack: 'fight', hit: 'fight', slay: 'fight', say: 'answer', reply: 'answer',
    exit: 'quit', logout: 'quit', shutdown: 'quit', off: 'quit', go: 'go', walk: 'go', purchase: 'buy', check: 'search' };
  let v = SYN[w[0]] || w[0], rest = w.slice(1);
  if (v === 'turn' || v === 'switch') { if (rest.includes('off')) return true; }
  if (v === 'quit') return true;
  const n = rest.join(' ');
  const m = S.mini;
  advance(2);
  if (S.over || S.collapse) return true;
  m.played++;

  if (m.dead && v !== 'restart') { miniSay('You are dead. Even in a computer game. Type RESTART or QUIT.'); return false; }
  if (m.f.won && v !== 'restart' && v !== 'score') { miniSay('You have already beaten ZORMAK! Type RESTART to play again, or QUIT.'); return false; }

  if (v === 'look' && n) v = 'examine';
  const dir = DIRS[v] || (v === 'go' ? DIRS[rest[0]] : null);
  const r = MINI_ROOMS[m.room], has = (it) => m.inv.includes(it), word = (re) => new RegExp('\\b(' + re + ')\\b').test(n);

  if (dir) {
    const to = r.exits[dir];
    if (!to) { miniSay('You cannot go that way.'); return false; }
    if (m.room === 'bridge' && dir === 'n' && !m.f.troll) { miniSay('The troll puts a hand the size of a door in front of you. "RIDDLE FIRST! What has KEYS but opens no locks?" (ANSWER something.)'); return false; }
    m.room = to; miniLook();
    if (to === 'cave' && !has('lantern')) miniSay('(It might be smart to come back with a light.)');
    return false;
  }

  switch (v) {
    case 'help': miniSay(MINI_HELP); return false;
    case 'look': miniLook(); return false;
    case 'score': miniSay(`Score: ${m.score}/100. Rank: ${m.score >= 100 ? 'Dragon Whisperer' : m.score >= 50 ? 'Promising Squire' : 'Village Idiot'}.`); return false;
    case 'restart': S.mini = { room: 'square', inv: [], f: {}, score: 0, played: 1, lastNote: S.t }; miniSay('*** NEW GAME ***'); miniLook(); return false;
    case 'inv': miniSay(m.inv.length ? 'You carry: ' + m.inv.map((x) => ({ coin: 'a gold coin', lantern: 'a brass lantern', sword: 'a glowing sword' })[x]).join(', ') + '.' : 'You carry nothing but hope.'); return false;
    case 'examine': case 'search':
      if (m.room === 'square' && word('well')) {
        if (!m.f.coin) { m.f.coin = true; m.inv.push('coin'); miniSay('You peer into the well. Something glints on a ledge just within reach: a GOLD COIN! You take it.'); miniPoints(10); }
        else miniSay('Just water and a frog. The frog judges you.');
        return false;
      }
      if (word('sage')) { miniSay('He has a beard so long he uses it as a scarf, a belt and a blanket.'); return false; }
      if (word('lantern|lamp')) { miniSay(has('lantern') ? 'Your trusty brass lantern, burning bright.' : 'A brass lantern. Price: 1 GOLD COIN.'); return false; }
      if (word('sword')) { miniSay(has('sword') || m.room === 'cave' ? 'An elven blade that glows when dragons are near. Or when it is hungry. Nobody is sure.' : 'You see no sword here.'); return false; }
      if (word('troll')) { miniSay('Green, warty, and holding a little book called "1001 Riddles for Trolls".'); return false; }
      if (word('dragon|zormak')) { miniSay('Scales like shields, teeth like swords, and reading glasses on his nose. Odd.'); return false; }
      if (word('barkeep')) { miniSay('He has one eye, one tooth and one opinion: "Gold first."'); return false; }
      miniSay(n ? 'You see nothing special.' : 'Examine what?');
      return false;
    case 'talk':
      if (m.room === 'square' && word('sage|man|old')) { miniSay('The sage: "Zormak the Terrible lives in the castle past the troll bridge. No mortal weapon can hurt him... but they say an elven SWORD sleeps in the dark cave. You will need light. And money. Everything needs money." He sighs. "Even in fantasy."'); return false; }
      if (m.room === 'tavern' && word('barkeep|man')) { miniSay('"Lantern\'s one gold coin. No credit. Last hero who asked for credit is now a stew."'); return false; }
      if (m.room === 'bridge' && word('troll')) { miniSay(m.f.troll ? '"Piano! HA! Good one. Off you go."' : '"What has KEYS but opens no locks? ANSWER me, or turn back!"'); return false; }
      if (m.room === 'throne' && word('dragon|zormak')) { miniSay('Zormak yawns: "Every week a new hero. I just want to read my book in peace. Go home, little human, or FIGHT me, I don\'t care."'); return false; }
      miniSay('There is nobody here by that name.');
      return false;
    case 'buy':
      if (m.room !== 'tavern') { miniSay('There is nothing for sale here.'); return false; }
      if (!word('lantern|lamp|light')) { miniSay('The barkeep only sells the lantern. "And stew. Don\'t ask what\'s in it."'); return false; }
      if (has('lantern')) { miniSay('You already have the lantern.'); return false; }
      if (!has('coin')) { miniSay('"No gold, no lantern." Maybe there is some money lying around the village?'); return false; }
      m.inv = m.inv.filter((x) => x !== 'coin'); m.inv.push('lantern');
      miniSay('You slap the gold coin on the counter. The barkeep hands you the brass lantern. It lights up with a satisfying WHOOMF.');
      miniPoints(10);
      return false;
    case 'take':
      if (word('sword')) {
        if (m.room !== 'cave') { miniSay('There is no sword here.'); return false; }
        if (!has('lantern')) { miniSay('You grope around in the dark and touch something slimy. It touches you back. You stop.'); return false; }
        if (has('sword')) { miniSay('You already have it.'); return false; }
        m.inv.push('sword');
        miniSay('You grip the hilt and pull. The sword slides out of the rock with a heavenly "AAAAH" sound effect. It glows. You glow. Everyone glows.');
        miniPoints(20);
        return false;
      }
      if (word('lantern|lamp')) { miniSay(m.room === 'tavern' && !has('lantern') ? '"Oi! That\'s one GOLD COIN!" (BUY it.)' : 'You already have it, or it isn\'t here.'); return false; }
      if (word('coin|gold')) { miniSay(m.room === 'throne' ? 'You reach for the dragon\'s gold. One yellow eye follows your hand. You change your mind.' : 'No loose gold here. Have you checked the well?'); return false; }
      miniSay('You can\'t take that.');
      return false;
    case 'answer': case 'piano': case 'keyboard': case 'typewriter': {
      const ans = v === 'answer' ? n : v;
      if (m.room !== 'bridge' || m.f.troll) { miniSay('Nobody asked you anything.'); return false; }
      if (/\b(piano|keyboard|typewriter|computer)\b/.test(ans)) {
        m.f.troll = true;
        miniSay(`"${ans.toUpperCase()}!" The troll slaps his knee and the bridge shakes. "Correct! Pass, clever one!" He steps aside.`);
        miniPoints(20);
      } else miniSay('"WRONG!" roars the troll. "Think, little human: what has KEYS but opens no locks? You are probably touching one right now."');
      return false;
    }
    case 'fight':
      if (m.room === 'bridge' && word('troll')) { miniDie('You punch the troll. The troll punches you back. You fly gracefully into the bottomless chasm. It is, indeed, bottomless.'); return false; }
      if (m.room !== 'throne' || !word('dragon|zormak')) { miniSay('There is nothing here to fight.'); return false; }
      if (!has('sword')) { miniDie('You charge Zormak with your bare fists. He sneezes. You are now a small pile of ash with very surprised eyebrows.'); return false; }
      m.f.won = true; S.f.zormakWon = true; if (D() < 5 && within(9, 17)) S.f.zormakAtWork = true;
      diary('Beat The Curse of Zormak on the old PC. Zormak moved to the seaside. Good for him.');
      miniSay('You raise the glowing sword. Zormak sees it, sighs, and closes his book. "The elven blade? Oh, FINE." ' +
        'After a short, very heroic fight he flaps away through the roof, shouting "I\'m moving to the seaside! Somewhere QUIET!" Gold rains down on you.');
      miniPoints(40);
      miniSay('*** CONGRATULATIONS! YOU HAVE LIFTED THE CURSE OF ZORMAK! *** Final score: ' + m.score + '/100. Type QUIT to switch off the computer.');
      deed('zormak');
      return false;
    default:
      miniSay(`ZORMAK.EXE does not understand "${w[0]}". Type HELP.`);
      return false;
  }
}

// Called by the engine for every command typed while the PC is on.
function miniCommand(raw) {
  const quit = miniExec(raw);
  if (S.over) return;
  if (S.collapse) { say('Your head drops onto the keyboard: ZZZZZZZZZZZZZZZZZZZZ...', 'warn'); S.pc = false; return; }
  if (quit) { miniQuit(); return; }
  if (S.t - (S.mini.lastNote || S.t) >= 30) {
    S.mini.lastNote = S.t;
    say(`(You glance at the clock on the wall: it is already ${clock()}.)`, 'note');
  }
}

// Picture shown in the art panel while the PC is on: the room inside a monitor.
function miniArt() {
  const pic = MINI_ROOMS[S.mini.room].art.slice(0, 6);
  while (pic.length < 6) pic.push('');
  const W = 44;
  const lines = [
    '          .' + '-'.repeat(W + 6) + '.',
    '          |  .' + '-'.repeat(W) + '.  |',
  ];
  for (const p of pic) lines.push('          |  |' + (' ' + p).slice(0, W).padEnd(W) + '|  |');
  lines.push('          |  \'' + '-'.repeat(W) + '\'  |');
  lines.push('          \'' + '-'.repeat(20) + '.  [::]  .' + '-'.repeat(W + 6 - 30) + '\'');
  lines.push('                  ' + ' '.repeat(12) + '_|______|_');
  return lines.join('\n');
}
