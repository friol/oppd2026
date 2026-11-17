// Wandering NPCs. Each one walks a fixed route: the position is computed from
// the game clock (route[floor(t / step) % length]) during its active hours, so
// nothing about their movement needs to be stored in the save state.
// act(c) handles commands aimed at them; return true when handled.
'use strict';

const NPCS = {

rocco: {
  letter: 'R', short: 'Rocco the tramp',
  name: 'Rocco', words: 'rocco|tramp|hobo|bum|trolley|shopping trolley',
  step: 9, hours: [[8, 21]],
  route: ['church', 'avsouth', 'neon', 'avsouth', 'avnorth', 'elm', 'parkgate', 'oak', 'pond', 'oak', 'playground', 'oak', 'parkgate', 'elm', 'avnorth', 'avsouth'],
  here: 'Rocco, a bearded tramp in three overcoats, pushes a squeaky shopping trolley full of cans, broken umbrellas and a garden gnome.',
  arrive: 'Squeak, squeak: Rocco the tramp rolls in with his shopping trolley, humming opera.',
  leave: 'Rocco squeaks away with his trolley, still humming.',
  desc: 'Rocco has been "between flats" since 1997. His trolley is his house, his office and his museum. He collects cans, umbrellas and stories.',
  act(c) {
    if (c.v === 'talk') {
      const l = ['"The sky is lying to you, son. Rain is coming. I lost my umbrella in 1997 and it has been raining inside me ever since. Got an UMBRELLA?"',
        '"Cans are money. Bottles are money. Recycling is not a hobby, it is a lifestyle."',
        '"That boy in Rook Alley with the little knife? My nephew. Bad boy. But he respects family. Only family."',
        '"I was a ballet dancer, you know. Then a taxi driver. Then this. Life is a staircase, son. Sometimes down."'];
      say('Rocco: ' + l[S.turn % l.length]);
      return true;
    }
    if (c.v === 'give') {
      if (has('umbrella') && is(c.all, 'umbrella|brolly')) {
        lose('umbrella');
        say('Rocco opens the umbrella, checks every spoke and tears up. "An umbrella. A REAL one." He digs in his trolley and hangs a rusty bottle cap on a string around your neck. ' +
          '"My lucky cap. Everybody in Rook Alley knows it. If my nephew bothers you, show him this."');
        place('luckycap', S.loc); getItem('luckycap', true);
        deed('rocco');
        return true;
      }
      if (is(c.all, 'money|cash|coin|coins|euro|dollar|dollars|bucks')) { say('"Money? Son, I have a trolley full of money." He points at the cans. "What I need is an UMBRELLA."'); return true; }
      const id = findItem(c.n, true);
      if (!id) { say('You don\'t have that.'); return true; }
      if (['sandwich', 'pizza', 'croissant', 'chocolate'].includes(id)) { say('"After sunset, son. I have a schedule. Give it to Sam at the church, he is always hungry."'); return true; }
      if (I[id].value && id !== 'phone') { lose(id); say(`"For the museum!" Rocco puts ${I[id].name} in his trolley next to the gnome. "Very kind. Still no umbrella, though."`); return true; }
      say('Rocco looks at it, sniffs it and gives it back. "No museum value."');
      return true;
    }
  },
},

stranger: {
  letter: 'N', short: 'Neighbour from 2C',
  name: 'the stranger from 2C', words: 'stranger|neighbour|neighbor|man black|black coat|mysterious man|2c|cello|cello case',
  step: 11, hours: [[8, 20]],
  route: ['landing', 'lobby', 'elm', 'avnorth', 'avsouth', 'plaza', 'post', 'plaza', 'oldtown', 'plaza', 'avsouth', 'avnorth', 'elm', 'lobby'],
  here: 'A tall man in a black coat and dark glasses stands here with a cello case: your neighbour from flat 2C. Nobody knows his name.',
  arrive: 'The mysterious neighbour from 2C glides in, cello case in hand, without making a sound.',
  leave: 'The man from 2C turns and leaves. You never hear his footsteps.',
  desc: 'Nobody in the building knows his name. Black coat, dark glasses, a cello case he never opens. Mrs. Pinto thinks he is a spy. Mr. Kowalski says he pays the rent a year in advance, in cash. He is the only person who ever pays Kowalski in advance.',
  act(c) {
    if (c.v === 'talk' || c.v === 'help') {
      const days = S.f.n2c || (S.f.n2c = []);
      if (days.includes(D())) { say(days.length >= 3 ? 'He nods. You are friends now, in his way.' : 'He nods again, slightly less. Once a day seems to be his limit.'); return true; }
      days.push(D());
      if (days.length === 1) say('You say hello. He looks at you through his dark glasses for a long second, then nods. Not one word.');
      else if (days.length === 2) say('"Morning!" you say. He touches the brim of his hat. By his standards, it is a long conversation.');
      else {
        say('He stops. Slowly, he takes off his glasses. "Saturday. Table three. Don\'t forget the ring." Then he puts them back on and walks away. How does he KNOW?');
        deed('stranger');
      }
      return true;
    }
    if (c.v === 'give') { say('He raises one hand: no, thank you. Polite, final and slightly frightening.'); return true; }
    if (c.v === 'open' && is(c.all, 'cello|case')) { say('You reach for the cello case. He turns his head towards you, very slowly. You decide you don\'t want to know.'); return true; }
    if (c.v === 'fight' || c.v === 'insult') { say('He looks at you. Just looks. You suddenly remember an urgent appointment elsewhere.'); return true; }
  },
},

sandra: {
  letter: 'S', short: 'Sandra the jogger',
  name: 'Sandra', words: 'sandra|jogger|runner|woman running',
  step: 3, hours: [[6.5, 8.5], [18, 20]],
  route: ['elm', 'parkgate', 'oak', 'pond', 'oak', 'playground', 'oak', 'parkgate', 'library', 'parkgate', 'elm', 'maple'],
  here: 'Sandra the jogger bounces on the spot in neon leggings, checking her watch.',
  arrive: 'Sandra the jogger comes running past in neon leggings, breathing in perfect rhythm.',
  leave: 'Sandra sprints off. She is already a dot in the distance.',
  desc: 'Sandra runs twice a day, every day, in every weather. Rumour says she has never been seen walking.',
  act(c) {
    if (c.v === 'run' || c.v === 'exercise' || c.v === 'follow' || (c.v === 'talk' && is(c.all, 'run|jog|join'))) {
      if (S.fit < 1) { say('You try to keep up. After fifty metres you are wheezing against a lamp post while she disappears. Maybe try the gym first.'); advance(5); return true; }
      if (!once('sandra' + D())) { say('Once a day is plenty, your knees say.'); return true; }
      const tips = ['"Big Mike at the construction site lends his ladder to anyone wearing a hard hat. Never go in without one!"',
        '"Rook Alley after dark? Only if you can run faster than me. Or if you know the right people."',
        '"The ATM only gives five hundred a day. My brother got evicted that way. Plan ahead!"',
        '"Grumman? My cousin works for him. Black coffee, no sugar. That\'s the secret."'];
      advance(20);
      say('You fall in beside her and run a whole lap of the park. Between breaths she shares a tip: ' + tips[(S.f.sandraTip = (S.f.sandraTip || 0) + 1) % tips.length]);
      return true;
    }
    if (c.v === 'talk') { say('"Morning! Can\'t stop! PACE!" she shouts, running on the spot. (If you\'re fit enough, you could RUN WITH her.)'); return true; }
  },
},

ferretti: {
  letter: 'F', short: 'Mrs. Ferretti',
  name: 'Mrs. Ferretti', words: 'ferretti|gossip|signora|dog|pippo|chihuahua|old woman',
  step: 12, hours: [[9, 12.5], [15, 19]],
  route: ['elm', 'maple', 'cafe', 'maple', 'rose', 'supermarket', 'rose', 'maple', 'elm', 'lobby'],
  here: 'Mrs. Ferretti, the neighbourhood gossip, is here with Pippo, a chihuahua in a knitted sweater. Her eyes miss nothing.',
  arrive: 'Mrs. Ferretti trots in with Pippo the chihuahua, scanning everyone like a security camera.',
  leave: 'Mrs. Ferretti hurries off. Somewhere, somebody needs to hear the latest news.',
  desc: 'Mrs. Ferretti knows everything about everybody, and tells everybody about everything. She goes to the same hairdresser as Laura. Be careful.',
  act(c) {
    if (c.v === 'talk') {
      const g = ['"Did you hear? Mr. Moss from Maple Street lost his wallet in the park! Under a bench, I bet. That man is a disaster."',
        '"That Laura of yours is a treasure. If you don\'t marry her, my nephew will."',
        '"The man in 2C? A spy. Or a dentist. Same thing, really."',
        '"Poor Mrs. Pinto, three floors with her shopping, every Tuesday and Thursday. Nobody helps anymore."',
        '"Never go up to the VIP room at Club Velvet. My cousin\'s husband went ONCE. They live apart now."'];
      say('Mrs. Ferretti leans in: ' + g[(S.f.gossip = (S.f.gossip || 0) + 1) % g.length]);
      return true;
    }
    if (c.v === 'pet' || c.v === 'compliment' || c.v === 'kiss' || (c.v === 'give' && is(c.all, 'roses|flowers|chocolate|chocolates'))) {
      if (once('ferrettiNice')) {
        say('Mrs. Ferretti beams. "Such MANNERS! I\'ll tell Laura, I see her at the hairdresser on Thursday." Pippo licks your hand. (Laura will hear good things about you.)');
        love(3);
      } else say('Pippo wags. Mrs. Ferretti nods approvingly.');
      return true;
    }
    if (c.v === 'insult' || c.v === 'fight' || c.v === 'kick' || c.v === 'shout') {
      if (once('ferrettiRude')) {
        say('Mrs. Ferretti gasps so hard Pippo falls over. "Well! Wait until LAURA hears about this!" She will. In detail. (Laura is not going to like this.)', 'warn');
        love(-10);
      } else say('She refuses to even look at you.');
      return true;
    }
  },
},

hans: {
  letter: 'H', short: 'Hans the tourist',
  name: 'Hans', words: 'hans|tourist|german|lost man',
  step: 8, hours: [[10, 18]], gone: () => S.f.hansHelped,
  route: ['avsouth', 'plaza', 'business', 'plaza', 'post', 'plaza', 'avsouth', 'church', 'avsouth', 'neon'],
  here: 'A lost tourist in sandals and socks turns a huge city map in every direction, looking desperate.',
  arrive: 'A tourist in sandals and socks wanders in, holding a map the size of a bedsheet.',
  leave: 'The lost tourist wanders off, in exactly the wrong direction.',
  desc: 'Hans from Stuttgart. Camera, bum bag, socks with sandals. His map is upside down.',
  act(c) {
    if (c.v === 'help' || c.v === 'show' || (c.v === 'talk' && is(c.all, 'direction|directions|way'))) {
      S.f.hansHelped = true; advance(5);
      say('You turn his map the right way up and show him: Downtown Plaza, then southwest into the Old Town, and there is Luigi\'s. ' +
        '"Ach so! Danke! DANKE SCHOEN!" He shakes your hand for a very long time and marches off, socks first.');
      deed('tourist');
      return true;
    }
    if (c.v === 'talk') { say('"Entschuldigung! I am searching ze Old Town, ze famous Trattoria? Mein map is... maybe upside down?" (You could HELP him.)'); return true; }
    if (c.v === 'give') { say('"Nein, nein, danke! Only ze directions, bitte!"'); return true; }
  },
},

vince: {
  letter: 'V', short: 'Vince',
  name: 'Vince', words: 'vince|tracksuit|pickpocket|thief',
  step: 7, hours: [[11, 20]], gone: () => S.f.vinceGone,
  route: ['plaza', 'business', 'mall', 'foodcourt', 'mall', 'business', 'plaza', 'avsouth', 'neon', 'avsouth'],
  here: 'A man in a shiny tracksuit drifts through the crowd, a little too close to people\'s pockets.',
  arrive: 'A man in a shiny tracksuit slips in, eyes darting from pocket to pocket.',
  leave: 'The man in the tracksuit melts into the crowd.',
  desc: () => 'Shiny tracksuit, fast hands, faster eyes. Sergeant Doyle has a photo of him on the wall: "VINCE - PICKPOCKET".' +
    (S.f.vinceStole ? ' He has YOUR money.' : ''),
  act(c) {
    if (c.v === 'fight' || c.v === 'shout' || c.v === 'take' || c.v === 'kick' || (c.v === 'call' && is(c.all, 'police|cops|911|112'))) {
      S.f.vinceGone = true; S.f.vinceNear = false;
      say(c.v === 'shout' || c.v === 'call' ? '"THIEF! STOP THAT MAN!" you yell. Two mall security guards tackle Vince like rugby players.'
        : 'You grab his wrist before he can move. "OI!" A security guard runs over and Vince is soon in handcuffs.');
      if (S.f.vinceStole) { S.cash += S.f.vinceStole; say(`The guard finds your $${S.f.vinceStole} in his tracksuit and gives it back.`); }
      say('Sergeant Doyle will be delighted: Vince has been robbing tourists for months.');
      deed('vince');
      return true;
    }
    if (c.v === 'talk') { say('"Wot? Never seen you before, mate." His eyes are on your back pocket.'); return true; }
  },
},

dino: {
  letter: 'D', short: 'Dino the pizza boy',
  name: 'Dino', words: 'dino|scooter|pizza guy|pizza boy|delivery boy|rider',
  step: 2, hours: [[11, 14], [18, 23]],
  route: ['avnorth', 'busstop', 'maple', 'rose', 'maple', 'elm', 'avnorth', 'avsouth', 'neon', 'avsouth', 'plaza', 'oldtown', 'plaza', 'avsouth'],
  here: 'Dino the pizza boy revs his scooter on the sidewalk, a tower of pizza boxes strapped behind him.',
  arrive: 'BRRRAAAAP! A pizza scooter mounts the sidewalk and misses you by a whisker. "SORRY, BOSS!" yells Dino.',
  leave: 'Dino zooms off on his scooter, ignoring two red lights in a row.',
  desc: 'Dino, eighteen, delivers pizzas at the speed of sound. Traffic laws are just suggestions to him.',
  act(c) {
    if (c.v === 'talk' || c.v === 'fight' || c.v === 'shout') { say('"CAN\'T STOP, BOSS! THIRTY MINUTES OR IT\'S FREE!" He is already gone in a cloud of exhaust.'); return true; }
  },
},

mortimer: {
  letter: 'M', short: 'Mortimer, your cat',
  name: 'Mortimer', words: 'mortimer|cat|kitty|tomcat|puss|pussycat',
  step: 20, hours: [[0, 24]],
  route: ['bedroom', 'bedroom', 'living', 'kitchen', 'kitchen', 'living', 'bathroom', 'living', 'bedroom', 'living'],
  // Words like "cat food" belong to the tin, not to the cat (except when feeding).
  ignore: (c) => is(c.all, 'food|biscuits|box|bowl') && !['feed', 'give', 'put'].includes(c.v),
  here: () => S.f['catfed' + D()]
    ? 'Mortimer, your fat grey cat, is curled up here like a furry cushion, purring.'
    : 'Mortimer, your fat grey cat, sits here staring at you. He is clearly thinking about FOOD.',
  arrive: () => ['Mortimer pads in, tail up like a question mark.', 'Mortimer strolls in and flops on the floor with a heavy THUMP.',
    'Mortimer wanders in, inspects you, finds you lacking, and sits down anyway.'][S.turn % 3],
  leave: 'Mortimer stretches, yawns, and wanders off to another room.',
  desc: () => 'Mortimer: 6 kg of grey fur, green eyes and opinions. He has lived with you for five years and still treats you as staff. ' +
    (S.f['catfed' + D()] ? 'He has eaten today and looks content.' : 'He has NOT eaten today. His stare says so.'),
  act(c) {
    if (c.v === 'feed' || ((c.v === 'give' || c.v === 'put') && is(c.all, 'food|biscuits'))) { feedCat(); return true; }
    if (c.v === 'pet' || c.v === 'hug' || c.v === 'kiss') {
      say(S.f['catfed' + D()] ? 'You scratch Mortimer behind the ears. He purrs like an old diesel engine and drools a little.'
        : 'You reach out to pet him. Mortimer dodges and stares at his empty bowl, then at you. Food first, affection later.');
      return true;
    }
    if (c.v === 'talk') {
      say(S.f['catfed' + D()] ? '"Mrrrp," says Mortimer, which means "You may continue to exist."'
        : '"MEEEEOOOOW," says Mortimer, loudly and repeatedly. Translation: "THE BOWL. IS. EMPTY."');
      return true;
    }
    if (c.v === 'take') { say('You pick Mortimer up. He goes limp like a 6 kg sack of potatoes and glares at you until you put him down.'); return true; }
    if (c.v === 'fight' || c.v === 'kick' || c.v === 'insult') { say('You would never. Also, he would win.'); return true; }
    if (c.v === 'play') { say('You wiggle a shoelace. Mortimer watches it with the boredom of a retired lion. He has seen better shoelaces.'); return true; }
  },
},

};

// ----------------------------------------------------------- Mortimer
const HOME_ROOMS = new Set(['bedroom', 'bathroom', 'living', 'kitchen']);

// Portions left in the box of cat biscuits (the starting box has 2).
function catPortions() { return S.f.catPortions === undefined ? 2 : S.f.catPortions; }

function feedCat() {
  if (!(has('catfood') || here('catfood'))) {
    say('You have no cat food. Mortimer stares at you as if you were the worst person alive. (The supermarket on Rose Lane sells boxes of cat biscuits.)');
    return;
  }
  if (S.f['catfed' + D()]) { say('Mortimer already had his portion today. He disagrees strongly, but you hold firm.'); return; }
  S.f.catPortions = catPortions() - 1;
  S.f['catfed' + D()] = true;
  say('You shake the box. At the sound Mortimer materialises from nowhere and empties the bowl in eleven seconds flat. ' +
    'Then he licks his paw and pretends nothing happened.');
  if (S.f.catPortions <= 0) { lose('catfood'); say('That was the last portion: you throw the empty box away. Buy another one at the supermarket on Rose Lane.', 'note'); }
  else say(`(${S.f.catPortions} portion${S.f.catPortions === 1 ? '' : 's'} left in the box.)`, 'note');
  deed('mortimer');
}

// At 4 AM after a day without food, Mortimer hides one of your things.
function catRevenge(day) {
  if (S.f['catrev' + day]) return;
  S.f['catrev' + day] = true;
  if (S.f.catHid) { say('In the night, Mortimer shreds an entire roll of toilet paper. A protest about the empty bowl.', 'note'); return; }
  const atHome = L[S.loc].zone === 'home';
  const order = ['ring', 'badge', 'keys', 'wallet', 'phone', 'ticket', 'gymclothes', 'note'];
  const pool = order.filter((id) => HOME_ROOMS.has(S.where[id]) || (atHome && has(id)));
  if (!pool.length) { say('In the night, Mortimer knocks every single object off your shelves. A protest about the empty bowl.', 'note'); return; }
  const id = pool[day % pool.length];
  lose(id);
  S.f.catHid = id; S.f.catSpot = day % 2 ? 'bed' : 'sofa'; S.f.catNews = true;
  if (!S.asleep) say('Out of the corner of your eye you see Mortimer dragging something away. Revenge for the empty bowl!', 'warn');
}

// Searching under the sofa or the bed gives back what the cat hid.
function catFind(spot) {
  if (!S.f.catHid || S.f.catSpot !== spot) return false;
  const id = S.f.catHid;
  S.f.catHid = null;
  place(id, S.loc);
  say(`You get down on your knees and look under the ${spot}. Dust, three hair ties, a petrified chip... and ${I[id].name}! Mortimer watches you from a safe distance, unrepentant.`);
  return true;
}

// ------------------------------------------------------------ helpers
function npcWhere(id) {
  const n = NPCS[id];
  if (n.gone && n.gone()) return null;
  if (!n.hours.some(([a, b]) => within(a, b))) return null;
  return n.route[Math.floor(S.t / n.step) % n.route.length];
}
function npcsHere() { return Object.keys(NPCS).filter((id) => npcWhere(id) === S.loc); }
function npcText(id, k) { const v = NPCS[id][k]; return typeof v === 'function' ? v() : v; }

// Commands aimed at an NPC who is here.
function npcAct(c) {
  const id = npcsHere().find((k) => is(c.all, NPCS[k].words) && !(NPCS[k].ignore && NPCS[k].ignore(c)));
  if (!id) return false;
  if (c.v === 'examine') { say(npcText(id, 'desc')); return true; }
  if (NPCS[id].act && NPCS[id].act(c)) return true;
  if (c.v === 'talk' || c.v === 'ask') { say(`${NPCS[id].name[0].toUpperCase() + NPCS[id].name.slice(1)} doesn't seem to want to chat.`); return true; }
  return false;
}

// After every command: arrivals, departures and the NPCs' own business.
function npcTurn(before, locBefore) {
  const now = npcsHere();
  if (S.loc === locBefore) {
    for (const id of before) if (!now.includes(id) && !(NPCS[id].gone && NPCS[id].gone())) say(npcText(id, 'leave'), 'note');
    for (const id of now) if (!before.includes(id)) say(npcText(id, 'arrive'), 'note');
  }
  // Vince: one turn of warning, then he steals.
  if (now.includes('vince') && !S.f.vinceStole) {
    if (!S.f.vinceNear) {
      S.f.vinceNear = true;
      say('The man in the tracksuit bumps into you. "Sorry, mate." His hand lingers near your pocket... (Act fast!)', 'warn');
    } else if (has('wallet') && S.cash > 0) {
      const amt = Math.min(S.cash, 50);
      S.cash -= amt; S.f.vinceStole = amt;
      say(`You feel a tug. When you check your wallet, $${amt} is gone! The man in the tracksuit is strolling away, whistling.`, 'warn');
    }
  } else if (!now.includes('vince')) S.f.vinceNear = false;
  // Dino loses a pizza, once.
  if (now.includes('dino') && !S.f.dinoPizza && S.where.pizza === null) {
    S.f.dinoPizza = true; place('pizza', S.loc);
    say('As Dino swerves, a pizza box flies off the back of his scooter and lands at your feet. He doesn\'t notice.', 'note');
  }
}
