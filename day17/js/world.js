// World data: good deeds, items, people's schedules and the ~50 locations.
// Location hooks receive a parsed command c = { v, n, n2, all } and return
// true when they handled it. Engine helpers (say, has, advance, ...) are
// defined in engine.js.
'use strict';

// ---------------------------------------------------------------- good deeds
const DEEDS = {
  lady:     { pts: 10, max: 3, name: 'Helped an old lady across Main Avenue' },
  gym:      { pts: 10, max: 3, name: 'Worked out at the gym' },
  shopping: { pts: 20, name: 'Took Laura shopping (and carried the bags)' },
  wallet:   { pts: 20, name: 'Handed a lost wallet in to the police' },
  sam:      { pts: 10, name: 'Gave Sam something to eat' },
  cat:      { pts: 20, name: 'Rescued a cat from the old oak' },
  recycle:  { pts: 5,  name: 'Recycled your empty bottles' },
  blood:    { pts: 15, name: 'Donated blood' },
  pinto:    { pts: 15, name: "Carried Mrs. Pinto's groceries upstairs" },
  book:     { pts: 5,  name: 'Returned your overdue library book' },
  mom:      { pts: 10, name: 'Called your mother' },
  litter:   { pts: 5,  name: 'Picked up litter in the park' },
  ducks:    { pts: 5,  name: 'Fed the ducks' },
  burglar:  { pts: 25, name: 'Stopped a burglary' },
  thug:     { pts: 15, name: 'Disarmed a mugger' },
  busker:   { pts: 5,  name: 'Tipped the street musician' },
  ladder:   { pts: 5,  name: 'Returned the borrowed ladder' },
  rocco:    { pts: 10, name: 'Gave Rocco the umbrella he dreamed of' },
  stranger: { pts: 5,  name: 'Got the stranger from 2C to speak' },
  tourist:  { pts: 10, name: 'Gave directions to a lost tourist' },
  vince:    { pts: 10, name: 'Caught Vince the pickpocket' },
  zormak:   { pts: 15, name: 'Lifted the Curse of Zormak on your old PC' },
  mortimer: { pts: 5, max: 6, name: 'Fed Mortimer, your cat' },
};
// Ending bonuses: accepted proposal 40, wearing the suit 10, all bills on time 10.
const BONUS = 60;
const MAX_SCORE = Object.values(DEEDS).reduce((a, d) => a + d.pts * (d.max || 1), 0) + BONUS;

const RING_PRICE = 1250;
const RENT = 600;
const ELEC = 78, ELEC_FEE = 40;
const GAS = 54, GAS_FEE = 30;
const SALARY = 1400;
const ATM_LIMIT = 500;

// ------------------------------------------------------- who is where, when
const P = {
  laura:    () => (D() < 5 && within(18, 23)) || (D() === 5 && within(9, 19)),
  lauraRest:() => D() === 5 && within(19.75, 21.5),
  boss:     () => D() < 5 && within(9, 18),
  lady:     () => within(7.5, 9.5) && !S.daily['lady' + D()],
  pinto:    () => (D() === 1 || D() === 3) && within(18, 20) && !S.f.pintoMet,
  cat:      () => S.t >= at(1, 7) && !S.f.catSaved,
  girl:     () => P.cat() && within(8, 20),
  thug:     () => within(20, 5) && !S.f.thugGone && S.f.thugNight !== nightId(),
  burglar:  () => D() === 2 && within(22, 24) && !S.f.burglarDone,
  busker:   () => D() < 6 && within(10, 19),
  foreman:  () => D() < 6 && within(7, 17),
  party:    () => D() === 3 && within(21, 24),
  bossClub: () => D() === 3 && within(22, 24),
  crystal:  () => within(21, 4) && S.f.crystalNight !== nightId(),
  kowalski: () => within(8, 21),
};

// ----------------------------------------------------------------- items
// w = weight in kg, at = starting location (null = not in the world yet),
// hidden() = true while the player has not discovered it, value = pawn price.
const I = {
  wallet: { name: 'your wallet', words: 'my wallet|your wallet|wallet', w: 0.2, at: 'bedroom',
    desc: () => `Brown, worn and faithful. It holds your cash ($${S.cash}) and your bank card. You can't buy anything without it.` },
  keys: { name: 'your house keys', words: 'house keys|keys|key|keyring', w: 0.1, at: 'bedroom',
    desc: 'Three keys and a bottle opener shaped like a fish. One of them opens your flat, 3B.' },
  phone: { name: 'your phone', words: 'phone|mobile|cellphone|smartphone|cell', w: 0.2, at: 'bedroom', value: 40,
    desc: 'A slightly cracked smartphone. You can CALL people with it: Laura, Mom, the police...' },
  gymclothes: { name: 'your gym clothes', words: 'gym clothes|gym kit|clothes|shorts|sneakers|kit', w: 1.4, at: 'bedroom',
    desc: 'T-shirt, shorts and sneakers rolled into a ball. You need them to work out at the gym.' },
  dumbbell: { name: 'a 10 kg dumbbell', words: 'dumbbell|dumbell|weight', w: 10, at: 'bedroom', value: 15,
    desc: '10 kg of good intentions. These days it is mostly a doorstop.' },
  badge: { name: 'your office badge', words: 'office badge|badge|pass|id badge', w: 0.05, at: 'living',
    desc: 'Your Grumman & Co. badge. In the photo you look like a startled owl. Tony at security won\'t let you in without it.' },
  backpack: { name: 'a backpack', words: 'backpack|rucksack|pack', w: 1.1, at: 'living',
    desc: 'A sturdy grey backpack. With it you can carry up to 20 kg in total. Without it, only what fits in your hands and pockets: 6 kg.' },
  umbrella: { name: 'an umbrella', words: 'umbrella|brolly', w: 0.6, at: 'living', value: 4,
    desc: 'A black umbrella. The forecast says sunny all week, so it is just extra weight.' },
  book: { name: 'a library book', words: 'library book|book', w: 0.9, at: 'living',
    desc: '"Being Ordinary: A Field Guide" by D. Plain. A stamp says RETURN TO CITY LIBRARY. It is three weeks overdue.',
    read: 'You read a random page: "The ordinary man pays his bills, calls his mother, and always crosses at the green light." Sound advice.' },
  ticket: { name: 'a dry-cleaning ticket', words: 'dry cleaning ticket|dry-cleaning ticket|ticket|receipt', w: 0.01, at: 'kitchen',
    desc: 'Ticket #4471, Spotless Dry Cleaners, Main Avenue. One dark blue suit, $12 to pay on collection.' },
  note: { name: 'a note from Laura', words: 'note|laura note|post-it|message', w: 0.01, at: 'kitchen',
    desc: 'A pink post-it in Laura\'s handwriting. You could READ it.',
    read: '"Darling! Don\'t forget: dinner at MY place on WEDNESDAY at 8 PM. And SATURDAY is our 3rd anniversary: Luigi\'s, 8 PM, you booked it, right?? You also PROMISED to take me shopping this week! Love you. L. xxx"' },
  bottles: { name: 'a bag of empty bottles', words: 'empty bottles|bottles|bag of bottles|glass', w: 2.4, at: 'kitchen',
    desc: 'A clinking bag of empty glass bottles. The recycling bins are on Elm Street, right outside.' },
  catfood: { name: 'a box of cat biscuits', words: 'box of cat biscuits|cat biscuits|cat food|catfood|biscuits', w: 1, at: 'kitchen',
    desc: () => `"PURRFECT CRUNCH - Salmon & Regret". One portion a day keeps Mortimer's revenge away. ` +
      `${catPortions()} portion${catPortions() === 1 ? '' : 's'} left. You could FEED the cat with it.` },
  bread: { name: 'some stale bread', words: 'stale bread|bread|loaf', w: 0.4, at: 'kitchen',
    desc: 'Too hard for humans. Ducks, however, are not picky.',
    eat: 'You try a bite and nearly lose a tooth. Better leave it to the ducks.', noEat: true },
  elecbill: { name: 'an electricity bill', words: 'electricity bill|electric bill|electricity|power bill', w: 0.02, at: 'lobby',
    hidden: () => !S.f.mailOpen,
    desc: () => `CITY POWER - Amount due: $${ELEC}. Pay by WEDNESDAY at any post office. "Unpaid bills will result in disconnection."` + (S.f.elecPaid ? ' It is stamped PAID.' : '') },
  gasbill: { name: 'a gas bill', words: 'gas bill|gas', w: 0.02, at: 'lobby',
    hidden: () => !S.f.mailOpen,
    desc: () => `CITY GAS - Amount due: $${GAS}. Pay by FRIDAY at any post office. "Late payment: $${GAS_FEE} fee and disconnection."` + (S.f.gasPaid ? ' It is stamped PAID.' : '') },
  newspaper: { name: 'a newspaper', words: 'newspaper|paper|news|daily', w: 0.3, at: 'cafe',
    desc: 'Today\'s City Daily, free for customers. You could READ it.',
    read: () => 'CITY DAILY headlines:\n' +
      ' * JAYWALKING DEATHS UP 30%: "Cross only at the Elm Street crosswalk, on the green man," say police.\n' +
      ' * MUGGINGS IN ROOK ALLEY: police warn citizens to avoid the alley behind the park after dark.\n' +
      ' * CLUB VELVET: complaints about a "champagne scam" in the VIP lounge. Men billed $350 for one bottle.\n' +
      ' * BURGLARIES on the rise around Elm Street: "If you see something, call the police," says Sgt. Doyle.\n' +
      (S.t >= at(1, 7) ? ' * CAT STUCK IN PARK OAK: girl in tears. "Somebody needs a ladder!"\n' : '') +
      ' * BLOOD SUPPLIES LOW: the City Clinic asks for donors, weekdays 8 AM to 4 PM.' },
  coffee: { name: 'a cup of coffee', words: 'cup of coffee|coffee|cup|espresso', w: 0.3, at: null,
    desc: 'Hot, black, slightly too strong.', drink: 'You drink the coffee. Your eyes open a little wider.' },
  croissant: { name: 'a croissant', words: 'croissant|pastry', w: 0.1, at: null,
    desc: 'Buttery and flaky.', eat: 'You eat the croissant. Flakes everywhere.' },
  sandwich: { name: 'a ham sandwich', words: 'ham sandwich|sandwich', w: 0.3, at: null,
    desc: 'Ham, cheese and a sad lettuce leaf, wrapped in paper.', eat: 'You wolf down the sandwich.' },
  pizza: { name: 'a slice of pizza', words: 'slice of pizza|pizza|slice', w: 0.3, at: null,
    desc: 'Pepperoni, wrapped in a napkin.', eat: 'You eat the pizza. The roof of your mouth will never forgive you.' },
  chocolate: { name: 'a box of chocolates', words: 'box of chocolates|chocolates|chocolate|box', w: 0.2, at: null,
    desc: 'Dark chocolate pralines. Laura\'s favourite.', eat: 'You eat a praline. Then another. Then you stop yourself: these were for Laura.', noEat: true },
  roses: { name: 'a bouquet of roses', words: 'bouquet of roses|bouquet|roses|flowers|rose', w: 0.5, at: null,
    desc: 'A dozen red roses. Laura will love them.' },
  ring: { name: 'an engagement ring', words: 'engagement ring|ring|diamond', w: 0.03, at: null,
    desc: 'A white gold ring with a small but honest diamond, in a velvet box. $1,250 of pure hope.' },
  suit: { name: 'a dark blue suit', words: 'dark blue suit|blue suit|suit', w: 1.6, at: null, wear: true,
    desc: 'Freshly dry-cleaned. In it you look like a man with a plan.' },
  lostwallet: { name: 'a brown wallet', words: 'brown wallet|lost wallet|leather wallet|wallet', w: 0.25, at: 'playground',
    hidden: () => !S.f.benchSeen,
    desc: () => S.f.stoleMoss
      ? 'Empty now, apart from the ID card of a Mr. Gerald Moss, 14 Maple Street.'
      : 'Somebody lost it. Inside: $80 and the ID card of a Mr. Gerald Moss, 14 Maple Street. The police station is next to St. Mark\'s church.' },
  ladder: { name: 'an aluminium ladder', words: 'aluminium ladder|aluminum ladder|ladder', w: 9, at: null,
    desc: 'A long aluminium ladder, splattered with paint. It belongs to the construction site.' },
  stepladder: { name: 'a stepladder', words: 'stepladder|step ladder|ladder', w: 7, at: null, value: 20,
    desc: 'A brand-new folding stepladder.' },
  hardhat: { name: 'a hard hat', words: 'hard hat|hardhat|helmet|hat', w: 0.4, at: 'construction', wear: true,
    desc: 'A yellow hard hat. "VISITOR" is written on it with a marker.' },
  groceries: { name: "Mrs. Pinto's groceries", words: 'grocery bags|groceries|shopping', w: 8, at: null,
    desc: 'Two bulging bags: potatoes, milk, tins of cat food, and what feels like a bowling ball.' },
  bags: { name: "Laura's shopping bags", words: 'shopping bags|bags|laura bags', w: 6, at: null,
    desc: 'Four bags from Chez Nina. Shoes, mostly. Shoes are heavy.' },
  luckycap: { name: "Rocco's lucky cap", words: "lucky cap|bottle cap|rocco's cap|cap|charm", w: 0.01, at: null,
    desc: 'A rusty bottle cap on a string. According to Rocco, everybody in Rook Alley knows it.' },
  report: { name: 'the quarterly report', words: 'quarterly report|report|papers', w: 0.5, at: null,
    desc: 'Forty pages of charts nobody will read. Mr. Grumman wants it on his desk by THURSDAY at 5 PM.',
    read: 'Q3 sales: down. Q3 costs: up. Q3 coffee consumption: record high. Conclusion: "Synergies."' },
};

// ------------------------------------------------------------ small helpers
function lauraHere() { return S.loc === 'laura' && P.laura(); }
function mugCash(who) {
  if (!has('wallet') || S.cash <= 0) {
    say(`${who} pats you down, finds nothing worth taking and shoves you away in disgust.`);
    return;
  }
  say(`${who} takes all your cash: $${S.cash}. Your bank card, luckily, he leaves.`);
  S.cash = 0;
}
function deliverBags() {
  if (has('bags') && lauraHere()) {
    lose('bags');
    say('You put the shopping bags down. Laura kisses you: "My hero! You carried ALL of them!"');
    deed('shopping'); love(15); contact();
  }
}

// ------------------------------------------------------------- locations
const L = {

// =============================== HOME =====================================
bedroom: {
  name: 'Bedroom', zone: 'home',
  desc: () => 'Your bedroom. An unmade bed, a nightstand with an alarm clock and a wardrobe that never quite closes. ' +
    (S.f.powerCut ? 'The alarm clock display is dark: no electricity. ' : '') +
    'The bathroom is east, the living room south.',
  exits: { e: 'bathroom', s: 'living' },
  things: {
    'bed': 'Your bed. You could SLEEP in it at night.',
    'nightstand|night stand|bedside table': 'A wobbly nightstand. You keep your stuff on it.',
    'alarm clock|alarm|clock': () => S.f.powerCut ? 'Dead. No power, no alarm. Great.' :
      `It says ${clock()}. ` + (S.f.alarmOff ? 'The alarm is switched OFF. You could SET it again.' : 'The alarm is set for 7:00. You could TURN it OFF... if you dare.'),
    'wardrobe|closet': 'Shirts, more shirts, a tie with ducks on it. The suit you need is still at the dry cleaner.',
    'window': 'Outside, Elm Street wakes up. A car honks. Somebody shouts. Pretty normal.',
  },
  act(c) {
    if (c.v === 'sleep') { goToSleep(); return true; }
    if (c.v === 'examine' && is(c.all, 'bed|under bed') && catFind('bed')) return true;
    if ((c.v === 'off' || c.v === 'push') && is(c.all, 'alarm|clock|alarm clock')) {
      if (S.f.alarmOff) { say('The alarm is already off.'); return true; }
      S.f.alarmOff = true;
      say('Click. You switch off the alarm. No more BEEP BEEP BEEP. What could possibly go wrong?');
      return true;
    }
    if ((c.v === 'set' || c.v === 'on') && is(c.all, 'alarm|clock|alarm clock')) {
      if (!S.f.alarmOff) { say('The alarm is already set for 7:00.'); return true; }
      S.f.alarmOff = false;
      say('You set the alarm for 7:00 again. Responsible. Boring, but responsible.');
      return true;
    }
    if (c.v === 'open' && is(c.all, 'wardrobe|closet')) { say('The wardrobe creaks open. Shirts, shirts, the duck tie. Nothing useful.'); return true; }
  },
},

bathroom: {
  name: 'Bathroom', zone: 'home',
  desc: 'A tiny bathroom: shower, sink, mirror, toilet. The tiles are a colour the landlord calls "avocado". The bedroom is west.',
  exits: { w: 'bedroom' },
  things: {
    'mirror': 'A tired, ordinary man looks back at you. He needs a shave and a plan.',
    'shower': 'A shower with a temperamental mixer tap.',
    'sink|toothbrush': 'Toothbrush, toothpaste, a razor.',
    'toilet': 'It works. Most days.',
  },
  act(c) {
    if (c.v === 'shower' || (c.v === 'use' && is(c.all, 'shower'))) {
      advance(10);
      if (S.f.gasCut) say('You turn on the shower. ICE COLD! The gas has been cut off. You scream like a kettle.');
      else say('A long hot shower. You feel almost human.');
      return true;
    }
    if (c.v === 'shave' || (c.v === 'brush') || (c.v === 'use' && is(c.all, 'sink|toothbrush|razor'))) {
      advance(5); say('You shave and brush your teeth. Fresh and ordinary.'); return true;
    }
    if (c.v === 'use' && is(c.all, 'toilet')) { advance(3); say('Business done. You wash your hands like a responsible adult.'); return true; }
  },
},

living: {
  name: 'Living Room', zone: 'home',
  desc: () => 'Your living room: a sagging sofa, a TV, a coffee table, a coat rack by the front door, and in the corner a desk with your old beige PC. ' +
    (S.f.powerCut ? 'With the power cut, the room is dim and silent. ' : '') +
    'The bedroom is north, the kitchen east. The front door (west) leads out to the landing.',
  exits: { n: 'bedroom', e: 'kitchen', w: 'landing', out: 'landing' },
  things: {
    'sofa|couch': 'Sagging in the exact shape of you.',
    'tv|television': () => S.f.powerCut ? 'Black screen. No electricity.' : 'An old flat-screen. You could WATCH it.',
    'coffee table|table': 'Coffee rings, a remote, crumbs.',
    'coat rack|rack|hook': 'Where you hang your coat, your bag and, usually, your badge.',
    'door|front door': 'The front door of flat 3B. It locks behind you, so don\'t forget your keys.',
    'computer|pc|monitor|desk|keyboard': () => S.f.powerCut ? 'Your old PC. Without electricity it is just a beige doorstop.' :
      'Your old beige PC from 1989, with a monitor the size of a microwave. Its hard disk still holds THE CURSE OF ZORMAK, ' +
      'a fantasy text adventure you never finished. You could PLAY it.' + (S.f.zormakWon ? ' (You finally beat it!)' : ''),
  },
  act(c) {
    if (c.v === 'examine' && is(c.all, 'sofa|couch|cushions') && catFind('sofa')) return true;
    if (((c.v === 'use' || c.v === 'on' || c.v === 'play' || c.v === 'sit') && is(c.all, 'computer|pc|game|zormak|desk|keyboard|monitor')) ||
      (c.v === 'play' && !c.all)) { miniStart(); return true; }
    if ((c.v === 'watch' || c.v === 'use' || c.v === 'on') && is(c.all, 'tv|television')) {
      if (S.f.powerCut) { say('Nothing. The electricity has been cut off.'); return true; }
      advance(15);
      const news = ['"...police remind citizens to cross Main Avenue ONLY at the crosswalk, on green..."',
        '"...and in sport, the City Ducks lose again..."',
        '"...a reminder that Club Velvet\'s VIP lounge is under investigation for overcharging..."',
        '"...weather: sunny, sunny, sunny. Leave the umbrella at home..."'];
      say('You watch TV for a while. ' + news[S.turn % news.length]);
      return true;
    }
    if (c.v === 'sit' || c.v === 'lie') { say('You sink into the sofa. It would be so easy to stay here forever. You get up.'); return true; }
  },
},

kitchen: {
  name: 'Kitchen', zone: 'home',
  desc: 'A narrow kitchen: fridge, stove, sink full of mugs and a small table. Magnets cover the fridge door. The living room is west.',
  exits: { w: 'living' },
  things: {
    'fridge|refrigerator|magnets': 'Inside: mustard, one egg of uncertain age, and light. Lots of light.',
    'bowl|cat bowl': () => S.f['catfed' + D()] ? "Mortimer's bowl, licked so clean it shines." : "Mortimer's bowl. EMPTY. The word MORTIMER is painted on it, as if anyone could forget.",
    'stove|cooker': 'You have used it twice. Both times the smoke alarm applauded.',
    'sink|mugs': 'A tower of mugs. Future-you will deal with it.',
    'table|kitchen table': 'A small table for two.',
  },
  act(c) {
    if (c.v === 'feed' || ((c.v === 'put' || c.v === 'give' || c.v === 'open') && is(c.all, 'cat food|food|biscuits|bowl'))) { feedCat(); return true; }
    if (c.v === 'open' && is(c.all, 'fridge|refrigerator')) { say('Mustard, an egg of uncertain age. You close it again.'); return true; }
    if ((c.v === 'make' || c.v === 'cook') ) { say('You are out of coffee and out of food. The Corner Cafe on Maple Street will sort you out.'); return true; }
    if (c.v === 'wash' ) { advance(10); say('You wash the mugs. All of them. A small victory over chaos.'); return true; }
  },
},

landing: {
  name: 'Third Floor Landing', zone: 'home',
  desc: () => 'The third floor landing smells of floor polish and someone else\'s dinner. Your door, 3B, is east. ' +
    'Across the landing is 3A, where Mrs. Pinto lives. The stairs go down to the lobby.',
  exits: { e: 'living', in: 'living', d: 'lobby' },
  people: () => {
    let s = '';
    if (P.burglar()) s += 'A MAN IN A BLACK HOODIE is crouched at Mrs. Pinto\'s door, working the lock with a crowbar! He hasn\'t seen you yet. ';
    if (S.f.pintoCarry) s += 'Mrs. Pinto is at her door, catching her breath, waiting for her groceries. ';
    return s;
  },
  things: {
    'door 3a|3a|pinto door|pinto\'s door': 'Mrs. Pinto\'s door. A doormat says WELCOME (CATS ONLY).',
    'door 3b|3b|my door|your door|door': 'Your door, 3B. It locks automatically.',
  },
  enter() {
    if (S.f.pintoCarry && has('groceries')) {
      lose('groceries'); S.f.pintoCarry = false;
      say('Mrs. Pinto arrives behind you, puffing. "Oh, bless you, dear! My knees aren\'t what they used to be." She takes her bags and gives you a sticky caramel.');
      deed('pinto');
    }
  },
  act(c) {
    if (c.v === 'go' && (c.n === 'e' || c.n === 'in')) {
      if (!has('keys') && !S.f.spare) {
        say('Your door is locked, and your keys are... not in your pocket. Mr. Kowalski, the landlord on the ground floor, has a spare key.');
        return true;
      }
      return false;
    }
    if (P.burglar()) {
      if (c.v === 'call' && is(c.all, 'police|cops|911|112|113|emergency')) {
        if (!has('phone')) { say('You have no phone with you!'); return true; }
        S.f.burglarDone = true; advance(15);
        say('You whisper into the phone. Five minutes later two officers storm up the stairs and catch the burglar red-handed. ' +
          'Mrs. Pinto opens her door in curlers: "My hero!"');
        deed('burglar'); return true;
      }
      if (c.v === 'fight' || c.v === 'tackle') {
        S.f.burglarDone = true;
        if (S.fit >= 3) {
          say('Those gym sessions pay off: you tackle him before he can swing the crowbar and sit on him until Mrs. Pinto calls the police.');
          deed('burglar'); return true;
        }
        say('You charge. He swings the crowbar. CLONK. Darkness...');
        say('You wake up in the City Clinic on Thursday afternoon with a bandage on your head. The burglar got away.', 'warn');
        S.work[3] = { am: true, pm: true, arrived: true };
        S.asleep = true; advanceTo(at(3, 15)); S.asleep = false;
        if (!S.over) moveTo('clinic');
        return true;
      }
      if (c.v === 'shout' || c.v === 'yell' || c.v === 'scream') {
        S.f.burglarDone = true;
        say('"HEY!" you yell. The burglar jumps, drops the crowbar and runs down the stairs. Mrs. Pinto\'s door is saved, but he\'s still out there. Calling the police might have been smarter.');
        return true;
      }
    }
    if (c.v === 'knock' || c.v === 'ring') {
      if (night() && !within(20, 22)) say('It\'s late. Mrs. Pinto is asleep; you hear snoring and the TV.');
      else say('Mrs. Pinto opens the door a crack, eight cats at her feet. "Oh, it\'s you, dear! I do my shopping Tuesdays and Thursdays, those bags are SO heavy..."');
      return true;
    }
  },
},

lobby: {
  name: 'Building Lobby', zone: 'home',
  desc: () => 'The lobby of number 9, Elm Street. A wall of mailboxes, a dusty plant and the door of flat 1A: MR. KOWALSKI - LANDLORD (east). ' +
    'The stairs go up; the street door is south.',
  exits: { u: 'landing', e: 'landlord', s: 'elm', out: 'elm' },
  people: () => P.pinto() ? 'Old Mrs. Pinto from 3A stands at the foot of the stairs with two huge grocery bags, staring up the stairs in despair. ' : '',
  things: {
    'mailbox|mailboxes|mail|box': () => S.f.mailOpen ? 'Your mailbox, now empty except for pizza flyers.' : 'Your mailbox, 3B, is stuffed. You could OPEN it.',
    'plant': 'A plastic plant. Somebody waters it anyway.',
    'stairs': 'Three floors. No elevator.',
  },
  act(c) {
    if (c.v === 'open' && is(c.all, 'mailbox|mailboxes|mail|box')) {
      if (S.f.mailOpen) { say('Just pizza flyers now.'); return true; }
      S.f.mailOpen = true;
      say('You open your mailbox. Among the pizza flyers: an ELECTRICITY BILL and a GAS BILL. Lovely.');
      return true;
    }
    if (P.pinto() && ((c.v === 'help' && is(c.all, 'pinto|lady|woman|her|mrs')) || ((c.v === 'take' || c.v === 'carry') && is(c.all, 'groceries|bags|shopping|grocery')))) {
      place('groceries', 'lobby');
      if (getItem('groceries', true)) {
        S.f.pintoMet = true; S.f.pintoCarry = true;
        say('"Oh, would you, dear? Number 3A, like you didn\'t know." You lift the 8 kg of groceries. She follows you slowly up the stairs.');
      } else {
        place('groceries', null);
        say('Mrs. Pinto looks at how much you are already carrying. "Oh no, dear, you\'ll break your back. Put some of that stuff down first."');
      }
      return true;
    }
    if (c.v === 'talk' && is(c.all, 'pinto|lady|woman|mrs') && P.pinto()) {
      say('"Three floors and no elevator. At my age! If only a strong young man would HELP me..."'); return true;
    }
  },
},

landlord: {
  name: "Mr. Kowalski's Flat", zone: 'home',
  closed: () => P.kowalski() ? null : 'You knock on 1A. A voice shouts: "Office hours are 8 to 21! Go away!"',
  desc: () => 'A flat that smells of cabbage and money. A sign on the wall: RENT DUE SATURDAY - CASH ONLY! ' +
    'Mr. Kowalski, your landlord, sits in his armchair with a ledger. ' +
    (S.f.rentPaid ? 'He nods at you: you are paid up. ' : '') + 'The lobby is west.',
  exits: { w: 'lobby', out: 'lobby' },
  things: {
    'kowalski|landlord|mr kowalski': 'Sixty-five, cardigan, reading glasses on a chain. He trusts nobody, especially banks.',
    'sign': 'RENT DUE SATURDAY NOON - CASH ONLY! NO EXCUSES! NO CHEQUES! NO "MY CAT ATE IT"!',
    'ledger': 'A thick book. Your name has a question mark next to it this month.',
  },
  act(c) {
    if (c.v === 'pay' || (c.v === 'give' && is(c.all, 'money|cash|rent|euro|dollar|dollars|bucks'))) {
      if (S.f.rentPaid) { say('"You already paid, boy. Don\'t confuse me."'); return true; }
      if (!spend(RENT)) { say(`"Six hundred dollars. CASH. Not a cent less." (You need $${RENT} in cash. The ATM is on Downtown Plaza.)`); return true; }
      S.f.rentPaid = true;
      say(`You count $${RENT} into his hand. He counts it again. And again. "Good boy. See you next month."`);
      return true;
    }
    if (c.v === 'talk' || (c.v === 'ask')) {
      if (is(c.all, 'key|spare')) {
        if (has('keys')) say('"You have keys. I can see them from here."');
        else { S.f.spare = true; say('"AGAIN?" He sighs and lets you into 3B with his master key whenever you need. "Find your keys, boy!" (You can now get into your flat.)'); }
        return true;
      }
      say(S.f.rentPaid ? '"Rent is paid. Go, go."' : `"Saturday, noon. $${RENT}. Cash. If not, I change the locks. Is nothing personal."`);
      return true;
    }
  },
},

// ============================ NORTH: RESIDENTIAL ===========================
elm: {
  name: 'Elm Street', zone: 'north',
  desc: () => 'Elm Street, your street. Your building, number 9, is north. Next to it stand the recycling bins, glass and paper. ' +
    'The park gate is west, Maple Street east. South, Elm Street meets busy Main Avenue.',
  exits: { n: 'lobby', in: 'lobby', w: 'parkgate', e: 'maple', s: 'avnorth' },
  things: {
    'bins|bin|recycling|recycling bins|glass bin': 'Two big bins: GLASS and PAPER. Somebody put a pizza box in the glass one. Monsters.',
    'building|number 9': 'Your building. Four floors of normal lives.',
  },
  act(c) {
    if ((c.v === 'recycle' || ((c.v === 'put' || c.v === 'drop' || c.v === 'throw') && is(c.all, 'bin|bins|recycling'))) && is(c.all, 'bottles|glass|bag')) {
      if (!has('bottles')) { say('You have no bottles with you.'); return true; }
      lose('bottles');
      say('CRASH! TINKLE! SMASH! You feed the bottles to the glass bin one by one. Deeply satisfying.');
      deed('recycle'); return true;
    }
    if (c.v === 'recycle') { say('Recycle what? You have nothing recyclable.'); return true; }
  },
},

parkgate: {
  name: 'City Park Gate', zone: 'north',
  desc: 'The iron gate of City Park. Paths lead north into the park. Westwards is the City Library; to the south, the florist. Elm Street is east.',
  exits: { n: 'oak', w: 'library', s: 'florist', e: 'elm' },
  things: { 'gate': 'Wrought iron, painted green, locked only at Christmas.' },
},

oak: {
  name: 'The Old Oak', zone: 'park',
  desc: () => 'The heart of City Park: a huge old oak tree, its branches spread like an umbrella. ' +
    (P.cat() ? 'High up on a branch, a small ginger CAT is meowing pitifully. ' : '') +
    'Paths lead west to the pond, east to the playground and south to the gate.',
  people: () => P.girl() ? 'A little girl, Mia, is crying under the tree: "Mister! Biscuit can\'t get down! It\'s too high!" ' : '',
  exits: { s: 'parkgate', w: 'pond', e: 'playground' },
  things: {
    'oak|tree|branch|branches': () => P.cat() ? 'The cat is on a branch at least four metres up. Way too high to reach. You would need a ladder.' : 'A majestic old oak. A squirrel stares at you.',
    'cat|biscuit|kitten': () => P.cat() ? 'A ginger kitten, frozen with fear, four metres up.' : 'Biscuit is safely back home.',
    'girl|mia': () => P.girl() ? 'About seven, with a red backpack and tears on her cheeks.' : 'There\'s no girl here.',
  },
  act(c) {
    const ladder = (has('ladder') || here('ladder')) ? 'ladder' : (has('stepladder') || here('stepladder')) ? 'stepladder' : null;
    const rescue = c.v === 'rescue' || c.v === 'climb' || ((c.v === 'take' || c.v === 'get' || c.v === 'help' || c.v === 'save') && is(c.all, 'cat|biscuit|kitten|girl|mia')) ||
      ((c.v === 'use' || c.v === 'put' || c.v === 'drop' || c.v === 'lean') && is(c.all, 'ladder|stepladder'));
    if (P.cat() && rescue) {
      if (!ladder) {
        if (c.v === 'climb') say('You hug the trunk and get about one metre up before sliding down, scraping your palms. The cat looks unimpressed. You need a ladder.');
        else say('The cat is four metres up. You can\'t reach it without a ladder.');
        return true;
      }
      S.f.catSaved = true; advance(10);
      say(`You lean the ${I[ladder].name.replace(/^an? /, '')} against the oak and climb up, rung by wobbly rung. ` +
        'The kitten hisses, then clings to your shirt. You climb down to cheers from a small crowd of dog walkers.');
      if (P.girl() || within(8, 20)) say('Mia hugs Biscuit, then your leg. "THANK YOU, MISTER!"');
      deed('cat'); return true;
    }
    if (c.v === 'talk' && is(c.all, 'girl|mia') && P.girl()) { say('"Biscuit climbed up chasing a pigeon and now he can\'t get down! Somebody needs a LADDER!"'); return true; }
    if (c.v === 'talk' && is(c.all, 'cat|biscuit')) { say(P.cat() ? '"Meow," says the cat, meaning "do something".' : 'There is no cat here.'); return true; }
  },
},

pond: {
  name: 'Duck Pond', zone: 'park',
  desc: 'A green pond where a gang of ducks patrols the water, looking for handouts. The old oak is east.',
  exits: { e: 'oak' },
  things: { 'ducks|duck|pond|water': 'Mallards. They watch you with the cold eyes of professional beggars.' },
  act(c) {
    if (c.v === 'feed' || (c.v === 'give' && is(c.all, 'duck|ducks')) || (c.v === 'throw' && is(c.all, 'bread|croissant'))) {
      const food = has('bread') ? 'bread' : has('croissant') ? 'croissant' : null;
      if (!food) { say('The ducks look at your empty hands and quack with contempt. Bring them some bread.'); return true; }
      lose(food);
      say('You crumble the ' + (food === 'bread' ? 'stale bread' : 'croissant') + ' into the water. A feeding frenzy! A small boy claps. Somewhere, a duck is very happy.');
      deed('ducks'); return true;
    }
    if (c.v === 'swim') { say('In THAT water? No.'); return true; }
  },
},

playground: {
  name: 'Playground', zone: 'park',
  desc: () => 'A playground with swings, a slide and a sandpit, ringed by benches. ' +
    (S.f.litter ? '' : 'Crisp packets and soda cans litter the grass around an empty bin. ') +
    'The oak is west. East, a narrow passage leads into Rook Alley.',
  exits: { w: 'oak', e: 'alley' },
  things: {
    'bench|benches': () => {
      if (!S.f.benchSeen) { S.f.benchSeen = true; return 'You look under the benches. Chewing gum, a lost mitten... and a BROWN WALLET!'; }
      return 'Graffitied benches. "K + J 4EVER".';
    },
    'litter|cans|packets|rubbish|trash': () => S.f.litter ? 'The grass is clean now.' : 'Crisp packets, cans, a sad balloon. The bin is right there, people!',
    'bin': 'An empty bin, surrounded by litter. Irony.',
    'swings|swing|slide|sandpit|sand': 'Built for people half your size.',
  },
  act(c) {
    if ((c.v === 'take' || c.v === 'clean' || c.v === 'collect' || c.v === 'pick') && is(c.all, 'litter|cans|packets|rubbish|trash|up') && !is(c.all, 'wallet')) {
      if (S.f.litter) { say('The playground is already clean.'); return true; }
      S.f.litter = true; advance(5);
      say('You pick up the litter and put it in the bin. A jogger gives you a thumbs-up.');
      deed('litter'); return true;
    }
    if (c.v === 'swing' || (c.v === 'use' && is(c.all, 'swing|slide'))) { say('Wheee! A mother gives you a look. You stop.'); return true; }
  },
},

alley: {
  name: 'Rook Alley', zone: 'north',
  desc: () => 'A narrow, dripping alley between the backs of buildings. Dumpsters, broken crates, graffiti. ' +
    (night() ? 'The only streetlight flickers. It is very dark here. ' : 'Even by day it feels unsafe. ') +
    'West, back to the playground; south, Maple Street.',
  exits: { w: 'playground', s: 'maple' },
  things: { 'dumpster|dumpsters|trash|crates': 'Rats live here. They have a better lease than you.', 'graffiti': '"NORMAL IS AN ILLUSION". Deep.' },
  enter() {
    if (P.thug() && has('luckycap')) {
      S.f.thugNight = nightId();
      say('A figure with a pocket knife steps out of the shadows... then freezes, staring at the bottle cap around your neck. ' +
        `"That's Uncle Rocco's lucky cap! Why didn't you SAY so?" He folds the knife, mumbles an apology and vanishes.`, 'warn');
      return;
    }
    if (P.thug()) {
      S.enc = 'thug';
      say('A figure steps out of the shadows. Hoodie, bad teeth, and a POCKET KNIFE that clicks open. "Wallet. Cash. NOW," he hisses. ' +
        '(You could GIVE him your money, RUN, or FIGHT.)', 'warn');
    }
  },
  act(c) {
    if (S.enc !== 'thug') return false;
    S.enc = null; S.f.thugNight = nightId();
    if (c.v === 'give' || c.v === 'accept' || c.v === 'pay') { mugCash('The mugger'); say('He vanishes into the dark.'); return true; }
    if (c.v === 'run' || c.v === 'go') {
      if (S.fit >= 2) {
        say('You turn and RUN. Thanks to the gym your legs know what to do. The mugger gives up after twenty metres, wheezing.');
        moveTo(S.prev && S.prev !== 'alley' ? S.prev : 'maple'); return true;
      }
      say('You run, but you are not exactly an athlete. He catches you in ten metres.'); mugCash('He'); return true;
    }
    if (c.v === 'fight' || c.v === 'tackle') {
      if (S.fit >= 3) {
        S.f.thugGone = true;
        say('He lunges. You sidestep like the gym taught you, twist his wrist, and the knife clatters to the ground. ' +
          'You sit on him until a patrol car arrives. "Rook Alley is safe again," says the officer.');
        deed('thug'); return true;
      }
      gameOver('You throw a heroic punch. He is faster, and his knife is sharper than your reflexes. ' +
        'The last thing you see is the flickering streetlight... Ordinary men should not fight knives in dark alleys.', 'dead');
      return true;
    }
    if (c.v === 'call') { say('You reach for your phone. He grabs your arm.'); mugCash('He'); return true; }
    say('While you hesitate, he grabs you by the collar.'); mugCash('He');
    return true;
  },
},

library: {
  name: 'City Library', zone: 'north',
  desc: () => 'The City Library, a temple of silence with a creaky floor. ' +
    (D() < 6 && within(9, 19) ? 'The librarian, Mrs. Hush, glares at everyone over her glasses. ' : 'It is closed, but there is a RETURNS slot in the door. ') +
    'The park gate is east.',
  exits: { e: 'parkgate', out: 'parkgate' },
  things: { 'slot|returns|returns slot': 'A brass slot marked BOOK RETURNS.', 'librarian|hush|mrs hush': 'She has been shushing people since 1974.', 'books|shelves': 'Millions of words. None of them about you.' },
  act(c) {
    if ((c.v === 'return' || c.v === 'give' || c.v === 'put' || c.v === 'drop') && is(c.all, 'book')) {
      if (!has('book')) { say('You don\'t have the library book with you.'); return true; }
      lose('book');
      say(D() < 6 && within(9, 19) ? 'Mrs. Hush takes the book, checks the date, and sighs. "Three weeks late. But returned. That\'s something." She almost smiles.'
        : 'You slide the book through the returns slot. THUNK. Your conscience is lighter.');
      deed('book'); return true;
    }
    if (c.v === 'read') { advance(20); say('You read magazines for twenty minutes. "SHHH!" says Mrs. Hush, although you said nothing.'); return true; }
  },
},

florist: {
  name: 'Blooming Marvellous Florist', zone: 'north',
  closed: () => (D() < 6 && within(8, 19)) ? null : 'The florist is closed (open 8 AM to 7 PM, Monday to Saturday).',
  desc: 'Buckets of tulips, daisies and red roses fill this tiny shop. The florist, a cheerful woman with soil on her apron, hums to herself. ROSES: $25 a bouquet. The park gate is north.',
  exits: { n: 'parkgate', out: 'parkgate' },
  shop: { roses: 25 },
  things: { 'florist|woman': '"Flowers for a lady? Roses never fail, love."', 'tulips|daisies': 'Pretty, but Laura loves roses.' },
},

maple: {
  name: 'Maple Street', zone: 'north',
  desc: 'A busy residential street. The Corner Cafe has its door open, letting out the smell of coffee (in). Elm Street is west, Rose Lane east. ' +
    'North, a gap between buildings leads into Rook Alley. South is the bus stop on Main Avenue.',
  exits: { w: 'elm', e: 'rose', n: 'alley', s: 'busstop', in: 'cafe' },
  things: { 'cafe|corner cafe': 'The Corner Cafe. Best croissants in the neighbourhood.' },
},

cafe: {
  name: 'Corner Cafe', zone: 'north',
  closed: () => within(6.5, 20) ? null : 'The Corner Cafe is closed (open 6:30 AM to 8 PM).',
  desc: 'A cosy cafe with steamed-up windows. Behind the counter, Gino the barista works the espresso machine like a pianist. ' +
    'Menu: COFFEE $2, CROISSANT $2, SANDWICH $4. Free newspapers for customers. Maple Street is outside.',
  exits: { out: 'maple' },
  shop: { coffee: 2, croissant: 2, sandwich: 4 },
  things: { 'gino|barista': '"The usual?" asks Gino. You have never ordered the same thing twice.', 'menu': 'COFFEE $2, CROISSANT $2, SANDWICH $4.', 'machine|espresso machine': 'Chrome, steam, Italian swearing.' },
  act(c) { if (c.v === 'talk') { say('Gino: "Did you hear? Somebody got mugged in Rook Alley again. After dark that place is no good."'); return true; } },
},

rose: {
  name: 'Rose Lane', zone: 'north',
  desc: 'A pretty lane with window boxes. Laura\'s building is north (in). Gruber\'s Hardware is east, the Super Saver supermarket south. Maple Street is west.',
  exits: { w: 'maple', n: 'laura', in: 'laura', e: 'hardware', s: 'supermarket' },
  things: { 'building|laura building|intercom': 'Laura lives on the second floor. Her name is on the intercom with a heart drawn next to it.' },
},

laura: {
  name: "Laura's Apartment", zone: 'laura',
  closed: () => P.laura() ? null : 'You ring Laura\'s intercom. No answer. (She is usually home on weekday evenings from 6 PM, and on Saturday from 9 AM.)',
  desc: 'Laura\'s cosy apartment: fairy lights, a pink velvet sofa, books and candles everywhere, and a framed photo of the two of you. ' +
    'Laura is here, curled up on the sofa. Rose Lane is outside (south).',
  exits: { s: 'rose', out: 'rose' },
  things: {
    'laura|girlfriend|her': () => `Laura: curly hair, big laugh, terrible taste in TV. You love her. ${loveText()}`,
    'photo|picture': 'The two of you at the seaside, three years ago. You were sunburnt. She was laughing.',
    'sofa|lights|candles|books': 'Everything here smells of vanilla.',
  },
  enter() {
    contact();
    say(`Laura opens the door. ${loveText()}`);
    if (D() === 2 && within(19.5, 20.75) && !S.f.wedDinner) {
      S.f.wedDinner = true; advance(90); love(10);
      say('"You came! And on time!" Dinner is lasagna and candles. You talk for hours. It is a lovely evening.');
    }
    deliverBags();
  },
  act(c) {
    if (c.v === 'talk') {
      contact();
      const lines = [
        `"How was work? Is Grumman still a pain?"`,
        `"You remember SATURDAY, right? Luigi's, 8 PM. Our anniversary!"`,
        S.f.shopDone ? '"Thanks again for the shopping trip, darling."' : '"You PROMISED to take me shopping this week... The boutique at the mall closes at 9."',
        D() < 2 && !S.f.wedDinner ? '"Don\'t forget dinner here on Wednesday at 8!"' : '"I made a playlist of our songs. It\'s 4 hours long."',
      ];
      say('Laura: ' + lines[S.turn % lines.length]);
      return true;
    }
    if (c.v === 'kiss' || c.v === 'hug') {
      contact();
      if (once('kiss' + D())) { love(3); say('Laura smiles and kisses you back. "Mmm. What was that for?"'); }
      else say('"Alright, alright, Romeo."');
      return true;
    }
    if (c.v === 'give' && is(c.all, 'roses|flowers|bouquet|rose')) {
      if (!has('roses')) { say('You have no flowers.'); return true; }
      lose('roses'); contact();
      if (once('roses' + D())) { love(10); say('"ROSES! For no reason?" She puts them in a vase and hugs you tightly.'); }
      else { love(2); say('"More roses? It\'s starting to look like a funeral in here!" But she is smiling.'); }
      return true;
    }
    if (c.v === 'give' && is(c.all, 'chocolate|chocolates|box')) {
      if (!has('chocolate')) { say('You have no chocolates.'); return true; }
      lose('chocolate'); contact();
      if (once('choc')) { love(5); say('"My favourite pralines!" She eats three at once. "Want one? No? Good."'); }
      else say('"You\'re trying to fatten me up," she laughs.');
      return true;
    }
    if (c.v === 'give' && is(c.all, 'bags|shopping')) { if (has('bags')) deliverBags(); else say("You don't have her bags with you."); return true; }
    if (c.v === 'shop' || ((c.v === 'take' || c.v === 'ask' || c.v === 'talk') && is(c.all, 'shopping|shop|mall'))) {
      if (S.f.shopDone) { say('"We already went this week, silly. My credit card needs a rest."'); return true; }
      if (!within(9, 19.5)) { say('"It\'s too late now, the mall closes at 9! Another day, darling."'); return true; }
      if (!spend(60, true)) { say('You check your wallet. "Shopping" means at least $60 for a lunch, a scarf and a coffee. You don\'t have that much cash on you.'); return true; }
      S.f.shopDone = true; contact();
      say('"REALLY? Let\'s go!" You spend ninety minutes in Chez Nina, the mall boutique. You buy her a scarf ($60) and hold her coat while she tries on everything. ' +
        'She buys four bags of shoes.');
      advance(90); moveTo('boutique', true);
      place('bags', 'boutique');
      if (getItem('bags', true)) say('"Carry these home for me, darling? I\'ll meet you at my place!" She hands you 6 kg of shopping bags and skips away.');
      else say('"Carry these home for me, darling?" She puts the 6 kg of bags at your feet... but you are carrying too much. "Bring them to my place, okay?" She skips away.');
      return true;
    }
    if (c.v === 'propose') { say('Not here, not like this. You planned it properly: Saturday, 8 PM, at Luigi\'s.'); return true; }
    if (c.v === 'give' && is(c.all, 'ring')) { say('Not yet! The plan is Saturday at Luigi\'s. Keep it hidden!'); return true; }
  },
},

hardware: {
  name: "Gruber's Hardware", zone: 'north',
  closed: () => (D() < 6 && within(8, 18)) ? null : 'Gruber\'s Hardware is closed (8 AM to 6 PM, Monday to Saturday).',
  desc: 'Shelves of nails, screws, saws and mysterious plastic things. Old Mr. Gruber watches you from behind the till. A sign: STEPLADDER - $49. Rose Lane is west.',
  exits: { w: 'rose', out: 'rose' },
  shop: { stepladder: 49 },
  things: { 'gruber|mr gruber|man': '"You look like a man who needs a ladder," he says. He says that to everyone.', 'nails|screws|saws': 'You don\'t need any of those. Probably.' },
},

supermarket: {
  name: 'Super Saver Supermarket', zone: 'north',
  closed: () => within(8, 21) ? null : 'The supermarket is closed (8 AM to 9 PM).',
  desc: 'Fluorescent lights, a squeaky trolley, and music from 1987. Prices: BREAD $2, CHOCOLATES $3, CAT BISCUITS $9 a box (7 portions). Rose Lane is north.',
  exits: { n: 'rose', out: 'rose' },
  shop: { bread: 2, chocolate: 3 },
  things: { 'trolley': 'One wheel has its own opinion about direction.', 'music': 'A pan-flute version of a song you used to like.' },
  act(c) {
    if ((c.v === 'buy' || c.v === 'order') && is(c.all, 'cat food|catfood|cat biscuits|biscuits|box cat|food')) {
      if (!spend(9)) return true;
      if (!has('catfood')) {
        place('catfood', 'supermarket');
        if (!getItem('catfood', true)) { S.cash += 9; place('catfood', null); return true; }
        S.f.catPortions = 7;
        say('You buy a box of cat biscuits for $9: seven portions of salmon-flavoured peace and quiet.');
      } else {
        S.f.catPortions = catPortions() + 7;
        say(`You buy another box for $9 and pour it into the one you carry. ${S.f.catPortions} portions now.`);
      }
      return true;
    }
  },
},

// ============================== MAIN AVENUE ================================
avnorth: {
  name: 'Main Avenue (North Side)', zone: 'avenue',
  desc: () => 'The north sidewalk of Main Avenue, six lanes of honking, roaring traffic. Here is the city\'s main CROSSWALK, with a pedestrian light and a button. ' +
    `The light shows a ${S.light === 'green' ? 'GREEN walking man' : 'RED standing man'}. ` +
    'South, across the avenue, is downtown. Elm Street is north, the bus stop east, Spotless Dry Cleaners west.',
  people: () => P.lady() ? 'A tiny old lady with a walking frame waits at the kerb, eyeing the traffic nervously. ' : '',
  exits: { n: 'elm', e: 'busstop', w: 'drycleaner', s: 'avsouth' },
  things: {
    'light|pedestrian light|traffic light|signal': () => `It shows a ${S.light === 'green' ? 'GREEN man: safe to cross.' : 'RED man: do NOT cross.'}`,
    'button': 'A grey button: PUSH FOR GREEN.',
    'traffic|cars|road|avenue': 'Taxis, vans, scooters, a bus. Nobody is slowing down for anybody.',
    'lady|old lady|woman|granny': () => P.lady() ? 'Mrs. Abernathy, about ninety, with a walking frame and a hat with cherries on it.' : 'There\'s no old lady here right now.',
  },
  act(c) {
    if (c.v === 'push' || c.v === 'press') { S.lc = 1; say('You push the button. BEEP. "Wait," says the box.'); return true; }
    if (P.lady() && (c.v === 'help' || c.v === 'talk') && is(c.all, 'lady|woman|granny|abernathy|her|old')) {
      if (c.v === 'talk') { say('"Oh dear, these cars! Would you help an old lady across, young man?"'); return true; }
      S.daily['lady' + D()] = true; advance(5);
      say('You offer your arm. You wait for the green, then cross step by tiny step while the traffic growls. On the other side Mrs. Abernathy pats your cheek: "Such a nice young man."');
      deed('lady'); moveTo('avsouth'); return true;
    }
    if ((c.v === 'go' && c.n === 's') || c.v === 'cross') return crossAvenue('avsouth');
  },
},

busstop: {
  name: 'Main Avenue Bus Stop', zone: 'avenue',
  desc: 'A bus stop with a dented shelter. There is NO crosswalk here; the traffic is fast and heavy. The FitZone Gym is east. Maple Street is north, the crosswalk west.',
  exits: { w: 'avnorth', n: 'maple', e: 'gym', s: 'avsouth' },
  things: { 'shelter|bench': 'Somebody wrote "BUS 24 NEVER COMES" with a marker. It\'s true.', 'traffic|road|avenue': 'Cars weave from lane to lane at 70 km/h.', 'timetable': 'Lines 12, 24, 37. You don\'t need a bus: everything is walking distance.' },
  act(c) {
    if ((c.v === 'go' && c.n === 's') || c.v === 'cross') {
      gameOver('You step off the kerb between two parked vans. You never see the taxi doing seventy. ' +
        'The headline tomorrow: "JAYWALKING DEATHS UP 31%". Ordinary men cross at the crosswalk.', 'dead');
      return true;
    }
    if (c.v === 'wait' && is(c.all, 'bus')) { advance(20); say('You wait twenty minutes. Bus 24 does not come. Bus 24 never comes.'); return true; }
  },
},

gym: {
  name: 'FitZone Gym', zone: 'avenue',
  closed: () => within(6, 23) ? null : 'The gym is closed (6 AM to 11 PM).',
  desc: 'Treadmills, weights and mirrors. Very fit people grunt at their reflections. A sign: NO PAIN NO GAIN. The bus stop is west.',
  exits: { w: 'busstop', out: 'busstop' },
  things: { 'weights|treadmill|treadmills|mirrors': 'Instruments of torture. You could EXERCISE.', 'sign': 'NO PAIN NO GAIN. Someone added: NO BRAIN.' },
  act(c) {
    if (c.v === 'exercise' || c.v === 'use' || c.v === 'lift' || c.v === 'run' && is(c.all, 'treadmill')) {
      if (!has('gymclothes')) { say('The trainer stops you: "Not in those shoes, mate. Gym clothes required."'); return true; }
      if (S.f.weak === D()) { say('You gave blood today. You get on the treadmill, the room spins, you get off. Better rest today.'); return true; }
      if (!once('gym' + D())) { say('You already worked out today. Your muscles beg for mercy.'); return true; }
      advance(60); S.fit++;
      say(['You change and do an hour of treadmill and weights. You are sweaty, red and proud.',
        'Another hour of suffering. Your legs feel stronger. Running away from trouble is getting easier.',
        'You lift, you run, you grunt at the mirror. You feel ready to take on the world. Or at least a burglar.'][Math.min(S.fit - 1, 2)]);
      deed('gym'); return true;
    }
  },
},

drycleaner: {
  name: 'Spotless Dry Cleaners', zone: 'avenue',
  closed: () => (D() < 6 && within(7.5, 19)) ? null : 'The dry cleaner is closed (7:30 AM to 7 PM, Monday to Saturday).',
  desc: 'Rows of clothes in plastic covers move slowly on a motorised rail. Mrs. Wong waits behind the till. Main Avenue is east.',
  exits: { e: 'avnorth', out: 'avnorth' },
  things: { 'wong|mrs wong|woman': '"Ticket?" says Mrs. Wong. She never says anything else.', 'rail|clothes': 'Hundreds of garments. Yours is in there somewhere.' },
  act(c) {
    if ((c.v === 'give' && is(c.all, 'ticket|receipt')) || ((c.v === 'take' || c.v === 'get' || c.v === 'collect' || c.v === 'pay' || c.v === 'ask') && is(c.all, 'suit'))) {
      if (S.f.suitGot) { say('"Ticket?" says Mrs. Wong. You already collected your suit.'); return true; }
      if (!has('ticket')) { say('"Ticket?" says Mrs. Wong. You have no ticket. She shakes her head.'); return true; }
      if (!spend(12)) return true;
      place('suit', 'drycleaner'); lose('ticket'); S.f.suitGot = true;
      say('Mrs. Wong presses a button. The rail whirs and stops at your dark blue suit. "Twelve dollars."');
      getItem('suit');
      return true;
    }
  },
},

avsouth: {
  name: 'Main Avenue (South Side)', zone: 'avenue',
  desc: () => 'The south sidewalk of Main Avenue, at the other end of the crosswalk. ' +
    `The pedestrian light shows a ${S.light === 'green' ? 'GREEN walking man' : 'RED standing man'}. ` +
    'Downtown Plaza is south. St. Mark\'s church is west, the Neon Strip east.',
  exits: { n: 'avnorth', s: 'plaza', w: 'church', e: 'neon' },
  things: {
    'light|pedestrian light|traffic light|signal': () => `It shows a ${S.light === 'green' ? 'GREEN man: safe to cross.' : 'RED man: do NOT cross.'}`,
    'button': 'PUSH FOR GREEN.', 'traffic|cars|road|avenue': 'Roaring, honking, unforgiving.',
  },
  act(c) {
    if (c.v === 'push' || c.v === 'press') { S.lc = 1; say('BEEP. "Wait."'); return true; }
    if ((c.v === 'go' && c.n === 'n') || c.v === 'cross') return crossAvenue('avnorth');
  },
},

// ============================== DOWNTOWN ===================================
church: {
  name: "St. Mark's Church", zone: 'downtown',
  desc: 'The steps of St. Mark\'s, an old stone church. Pigeons everywhere. Main Avenue is east; the police station is west, the City Clinic south.',
  people: () => 'Sam, a homeless man with a kind face and a paper cup, sits on the steps with his dog, Captain. ',
  exits: { e: 'avsouth', w: 'police', s: 'clinic' },
  things: {
    'sam|man|homeless': 'Sam used to be a bus driver. Now he sits here with Captain. He says hello to everybody.',
    'dog|captain': 'A scruffy mutt with one ear up. He wags at you.',
    'church|doors': 'The doors are closed except on Sunday.', 'cup': 'A few coins.', 'pigeons': 'They have seen things.',
  },
  act(c) {
    if (c.v === 'go' && c.n === 'n') { say('There\'s no crosswalk here. Use the crosswalk, east of here.'); return true; }
    if (c.v === 'give' && is(c.all, 'sandwich|pizza|croissant|food|chocolate|chocolates')) {
      const food = ['sandwich', 'pizza', 'croissant', 'chocolate'].find(has);
      if (!food) { say('You have no food to give.'); return true; }
      lose(food);
      if (S.deeds.sam) { say('"Again? You\'re spoiling me!" Sam shares it with Captain.'); return true; }
      say(`Sam's eyes light up. "Real food! God bless you." He gives half of the ${I[food].name.replace(/^an? |^some /, '')} to Captain.`);
      deed('sam'); return true;
    }
    if (c.v === 'give' && is(c.all, 'money|cash|coin|coins|euro|dollar|dollars|bucks')) {
      if (!spend(2)) return true;
      say('You drop $2 in the cup. "Thanks, friend. What I\'d really like is a SANDWICH, though. My stomach can\'t eat coins."'); return true;
    }
    if (c.v === 'talk' || c.v === 'pet') {
      say(c.v === 'pet' ? 'Captain licks your hand.' : '"Morning, friend! Careful crossing the avenue. And stay out of Rook Alley at night. Me, I\'d kill for a sandwich. Figuratively."');
      return true;
    }
  },
},

police: {
  name: 'Police Station', zone: 'downtown',
  desc: 'The local police station. Wanted posters, a LOST & FOUND window, and behind the desk the huge Sergeant Doyle, eating a doughnut. St. Mark\'s is east.',
  exits: { e: 'church', out: 'church' },
  things: { 'doyle|sergeant|officer|policeman': 'Two metres tall, one metre wide, all moustache.', 'posters|poster': 'WANTED: "The Pigeon", for theft of a sandwich.', 'window|lost and found': 'LOST & FOUND. Hand in found items here.' },
  act(c) {
    if ((c.v === 'give' || c.v === 'return' || c.v === 'drop') && is(c.all, 'wallet|brown wallet|lost wallet') && has('lostwallet')) {
      lose('lostwallet');
      if (S.f.stoleMoss) { say('Doyle opens it. "Mr. Moss reported $80 in this wallet. It\'s empty." He stares at you for a very long time. "Thank you, citizen." He does not mean it.'); return true; }
      say('"Gerald Moss! He was here this morning, in tears. Honest folk still exist!" Sergeant Doyle shakes your hand with a doughnut-sugary paw.');
      deed('wallet'); return true;
    }
    if (c.v === 'report' || c.v === 'talk') { say('"Mugged? Robbed? Lost a cat? Fill in form 27B. Or just be careful out there, son: Rook Alley after dark is trouble, and Club Velvet\'s VIP lounge is a scam."'); return true; }
  },
},

clinic: {
  name: 'City Clinic', zone: 'downtown',
  desc: () => 'A clean, bright clinic. Posters: DONATE BLOOD - SAVE LIVES. ' +
    (D() < 5 && within(8, 16) ? 'Nurse Kelly sits at reception, smiling. ' : 'The donation room is closed now (weekdays 8 AM to 4 PM). ') +
    'St. Mark\'s church is north.',
  exits: { n: 'church', out: 'church' },
  things: { 'nurse|kelly|reception': '"Here to donate? We\'re always short."', 'posters|poster': 'DONATE BLOOD - SAVE LIVES. Weekdays 8 AM - 4 PM. Free biscuit!' },
  act(c) {
    if (c.v === 'donate' || c.v === 'give' && is(c.all, 'blood')) {
      if (!(D() < 5 && within(8, 16))) { say('Donations are only taken on weekdays, 8 AM to 4 PM.'); return true; }
      if (S.deeds.blood) { say('"Once is plenty this month, love!" says Nurse Kelly.'); return true; }
      advance(45); S.f.weak = D();
      say('Nurse Kelly sticks a needle in your arm. You look at the ceiling and think of England. Forty-five minutes and one free biscuit later, you feel a bit wobbly. Better skip the gym today.');
      deed('blood'); return true;
    }
  },
},

plaza: {
  name: 'Downtown Plaza', zone: 'downtown',
  desc: 'A wide square with a fountain in the middle. First City Bank is west, with an ATM in its wall; the post office is east. ' +
    'Commerce Street continues south, Main Avenue is north. Southwest, a cobbled lane leads into the Old Town.',
  people: () => P.busker() ? 'A busker with a guitar sings "Wonderwall" for the fourth time, a hat at his feet. ' : '',
  exits: { n: 'avsouth', s: 'business', w: 'bank', e: 'post', sw: 'oldtown' },
  things: {
    'atm|cash machine|machine': () => `An ATM. You can WITHDRAW cash (max $${ATM_LIMIT} per day) or check your BALANCE. You need your wallet: the card is in it.`,
    'fountain': 'Coins glint at the bottom. Wishes of ordinary people.',
    'busker|musician|guitar|hat': () => P.busker() ? 'He is young, enthusiastic and slightly out of tune.' : 'No busker at this hour.',
  },
  act(c) {
    if (c.v === 'withdraw' || (c.v === 'use' && is(c.all, 'atm|machine'))) { atmWithdraw(c); return true; }
    if (c.v === 'balance') { atmBalance(); return true; }
    if (P.busker() && ((c.v === 'give' || c.v === 'tip' || c.v === 'put' || c.v === 'drop') && is(c.all, 'busker|musician|hat|money|coin|coins|euro|dollar|dollars|bucks|tip|him'))) {
      if (!spend(2)) return true;
      say('You drop $2 into the hat. The busker winks and switches to a song you actually like.');
      if (!S.deeds.busker) deed('busker');
      return true;
    }
    if (c.v === 'throw' && is(c.all, 'coin|money')) { if (!spend(1)) return true; say('You toss $1 into the fountain and wish for a "yes" on Saturday.'); return true; }
  },
},

bank: {
  name: 'First City Bank', zone: 'downtown',
  closed: () => (D() < 5 && within(8.5, 16)) ? null : 'The bank is closed (weekdays 8:30 AM to 4 PM). The ATM outside works 24/7.',
  desc: 'Marble floors, velvet ropes and a queue that hasn\'t moved since Tuesday. A teller sits behind glass. The plaza is east.',
  exits: { e: 'plaza', out: 'plaza' },
  things: { 'teller': 'A teller with the expression of a closed door.', 'queue': 'Seven people. All of them sighing.' },
  act(c) {
    if (c.v === 'balance' || c.v === 'talk') { advance(20); say(`After twenty minutes in the queue, the teller tells you: "Balance $${S.bank}. Salary is credited on Friday at 5 PM. Withdrawals at the ATM outside."`); return true; }
    if (c.v === 'withdraw') { say('"Use the ATM outside, please."'); return true; }
  },
},

post: {
  name: 'Post Office', zone: 'downtown',
  closed: () => ((D() < 5 && within(8, 19)) || (D() === 5 && within(8, 13))) ? null : 'The post office is closed (weekdays 8 AM - 7 PM, Saturday 8 AM - 1 PM).',
  desc: 'The post office: a ticket machine, an endless queue, and a sign over counter 2: PAY BILLS HERE (CASH). The plaza is west.',
  exits: { w: 'plaza', out: 'plaza' },
  things: { 'sign|counter': 'PAY BILLS HERE - CASH ONLY.', 'queue': 'Somebody is sending a piano. By post.', 'machine|ticket machine': 'Your ticket number: 47. Now serving: 12.' },
  act(c) {
    if (c.v === 'pay') {
      const onlyGas = is(c.all, 'gas') && !is(c.all, 'electricity|electric|power|bills|all');
      const onlyElec = is(c.all, 'electricity|electric|power') && !is(c.all, 'gas|bills|all');
      const E = !onlyGas && has('elecbill') && !S.f.elecPaid;
      const G = !onlyElec && has('gasbill') && !S.f.gasPaid;
      let did = false;
      if (E) {
        const amt = ELEC + (S.f.powerCut ? ELEC_FEE : 0);
        if (spend(amt)) {
          say(`You pay the electricity bill: $${amt}.` + (S.f.powerCut ? ' (Including the reconnection fee.) The power is back on.' : ''));
          S.f.elecPaid = true; S.f.powerCut = false; did = true;
        }
      }
      if (G) {
        const amt = GAS + (S.f.gasCut ? GAS_FEE : 0);
        if (spend(amt)) { say(`You pay the gas bill: $${amt}.`); S.f.gasPaid = true; S.f.gasCut = false; did = true; }
      }
      if (did) { advance(20); say('After twenty minutes in the queue, the clerk stamps everything with great violence. PAID.'); return true; }
      if (!E && !G) {
        if (!S.f.mailOpen) say("Pay what? You haven't even checked your mail.");
        else if (S.f.elecPaid && S.f.gasPaid) say('Your bills are all paid. The rent goes to Mr. Kowalski, in cash.');
        else say('You need to bring the bill with you to pay it.');
      }
      return true;
    }
  },
},

business: {
  name: 'Commerce Street', zone: 'downtown',
  desc: 'Glass towers and people in a hurry. The Grumman & Co. building, where you work, is south. Sparkle & Sons Jewellers is west, the City Mall east. The plaza is north.',
  exits: { n: 'plaza', s: 'officelobby', w: 'jeweler', e: 'mall' },
  things: { 'tower|towers|building|grumman': 'Grumman & Co. Insurance Solutions. Your home away from home, from 9 to 5.' },
},

jeweler: {
  name: 'Sparkle & Sons Jewellers', zone: 'downtown',
  closed: () => (D() < 6 && within(10, 19)) ? null : 'The jeweller is closed (10 AM to 7 PM, Monday to Saturday).',
  desc: `Glass cases glitter under spotlights. Mr. Sparkle Jr., monocle and all, bows slightly. In the main case: THE ring. White gold, a small honest diamond, $${RING_PRICE.toLocaleString('en')}. Commerce Street is east.`,
  exits: { e: 'business', out: 'business' },
  things: {
    'ring|rings|case|diamond': `White gold, a small honest diamond. $${RING_PRICE}. Perfect for Laura.`,
    'sparkle|jeweller|jeweler|man': '"An engagement, sir? How wonderful. We accept cards, of course."',
  },
  act(c) {
    if ((c.v === 'buy' || c.v === 'pay') && is(c.all, 'ring|diamond|it')) {
      if (has('ring')) { say('You already have the ring. One wife is plenty.'); return true; }
      if (!has('wallet')) { say('You pat your pockets. No wallet, no card. Mr. Sparkle\'s smile freezes.'); return true; }
      if (S.bank + S.cash < RING_PRICE) {
        say(`Mr. Sparkle swipes your card. BEEP. DECLINED. "Perhaps after payday, sir?" (Bank: $${S.bank}, cash: $${S.cash}. Salary arrives Friday at 5 PM.)`);
        return true;
      }
      const fromBank = Math.min(S.bank, RING_PRICE);
      S.bank -= fromBank; S.cash -= RING_PRICE - fromBank;
      place('ring', 'jeweler'); getItem('ring', true);
      say(`You pay $${RING_PRICE}` + (fromBank < RING_PRICE ? ` ($${fromBank} by card, the rest in cash)` : ' by card') +
        '. Mr. Sparkle places the ring in a velvet box. "She is a lucky woman, sir." You put it somewhere very, very safe.');
      return true;
    }
    if (c.v === 'talk') { say('"An engagement ring, sir? Our classic model is $1,250. Card or cash."'); return true; }
  },
},

mall: {
  name: 'City Mall', zone: 'mall',
  closed: () => within(9, 21) ? null : 'The mall is closed (9 AM to 9 PM).',
  desc: 'The atrium of the City Mall: shoe shops, phone shops, a fountain that plays music. An escalator goes up to the boutique Chez Nina. The food court is east. Commerce Street is west.',
  exits: { w: 'business', out: 'business', u: 'boutique', e: 'foodcourt' },
  things: { 'escalator': 'It goes up. Exciting.', 'shops|shoe shop|phone shop': 'Nothing you need. Or can afford.' },
},

boutique: {
  name: 'Chez Nina Boutique', zone: 'mall',
  desc: 'A fashionable boutique where a dress costs as much as your fridge. The saleswoman, Nina, calls everybody "darling". The escalator goes down.',
  exits: { d: 'mall' },
  things: { 'nina|saleswoman': '"Darling! Are you shopping for a lady? Bring her here, darling!"', 'dress|dresses|clothes': 'You look at a price tag and need to sit down.' },
  act(c) { if (c.v === 'buy') { say('"For YOU, darling? Bring your lady and we\'ll talk."'); return true; } },
},

foodcourt: {
  name: 'Food Court', zone: 'mall',
  desc: 'Plastic trays, plastic chairs, plastic smiles. PIZZA $4 a slice. The atrium is west.',
  exits: { w: 'mall' },
  shop: { pizza: 4 },
  things: { 'noodles|burgers': 'Sold out of everything but pizza. As always.' },
},

// ================================ OFFICE ===================================
officelobby: {
  name: 'Grumman & Co. Lobby', zone: 'office',
  closed: () => (D() < 5 && within(7, 20)) ? null : 'The Grumman & Co. building is closed. A sign: OPEN WEEKDAYS 7 AM - 8 PM.',
  desc: 'A chilly marble lobby. Tony the security guard watches the turnstiles from his desk. The lifts are behind the turnstiles (in). Commerce Street is north.',
  exits: { n: 'business', out: 'business', in: 'elevator', u: 'elevator' },
  things: { 'tony|guard|security': 'Tony reads crossword puzzles and trusts no one without a badge.', 'turnstiles|turnstile': 'BADGE ACCESS ONLY.' },
  act(c) {
    if (c.v === 'go' && (c.n === 'in' || c.n === 'u')) {
      if (!has('badge')) { say('Tony stops you: "Badge, please." You don\'t have it. "No badge, no entry. Rules are rules." It\'s probably at home on the coat rack.'); return true; }
      return false;
    }
    if (c.v === 'talk') { say('"Morning. Grumman\'s in a mood today. Then again, he\'s always in a mood."'); return true; }
  },
},

elevator: {
  name: 'Lift', zone: 'office',
  desc: 'A mirrored lift playing "The Girl from Ipanema". Floor 7 (up) is your office; the lobby is down.',
  exits: { u: 'openspace', d: 'officelobby', out: 'officelobby' },
  things: { 'mirror|mirrors': 'Infinite copies of an ordinary man.', 'buttons': 'G, 1 to 7.' },
},

openspace: {
  name: 'Open Space, 7th Floor', zone: 'office',
  desc: () => 'Rows of desks, ringing phones and the hum of air conditioning. Your desk is here, a mountain of folders on it. ' +
    (D() < 5 && within(8, 18) ? 'Ben, your colleague, waves at you from the next desk. ' : '') +
    'Mr. Grumman\'s office is east. The break room is north, the copy room south. The lift is down.',
  exits: { d: 'elevator', e: 'bossoffice', n: 'breakroom', s: 'copyroom' },
  things: {
    'desk|my desk|computer|folders': 'Your desk. You can WORK here. You can also PRINT the quarterly report from your computer.',
    'ben|colleague': '"Ben: thirty, beard, loves crypto. Harmless."',
  },
  enter() {
    const d = D(), w = S.work[d] || (S.work[d] = {});
    if (d > 4 || w.arrived) return;
    if (within(7, 17)) {
      w.arrived = true;
      if (!w.am && within(9.26, 13)) {
        const pts = within(11, 13) ? 20 : 10;
        say(`Mr. Grumman pokes his head out of his office: "${clock()}! Do you think this is a HOLIDAY CAMP?" (Boss -${pts})`, 'warn');
        bossMood(-pts);
      } else if (w.am && !w.pm && within(14.26, 17)) {
        say('"Long lunch, was it?" says Mr. Grumman, tapping his watch. (Boss -10)', 'warn'); bossMood(-10);
      }
      if (S.over) return;
      if (d <= 3 && !S.f.reportTold) {
        S.f.reportTold = true;
        say('Mr. Grumman: "Ah, there you are. The QUARTERLY REPORT. On my desk by THURSDAY at 5 PM. Print it, bring it. Don\'t make me ask twice."');
      }
    }
  },
  act(c) {
    if (c.v === 'work') { doWork(); return true; }
    if (c.v === 'print' || (c.v === 'use' && is(c.all, 'computer'))) {
      if (S.f.printed) { say('You already sent the report to the printer in the copy room.'); return true; }
      S.f.printed = true; S.f.reportTold = true; advance(5);
      say('You open REPORT_Q3_final_FINAL_v7.xls and press PRINT. "Sent to COPY ROOM printer." Somewhere south, a printer groans.');
      if (S.f.jamFixed) place('report', 'copyroom');
      return true;
    }
    if (c.v === 'talk' && is(c.all, 'ben|colleague')) {
      const l = ['"Thursday night is my birthday party at Club Velvet! Be there! Even Grumman is coming."',
        '"Pro tip: the boss likes his coffee black. A coffee from the break room works wonders."',
        '"Don\'t go into the VIP lounge at Velvet, man. Those girls are expensive. Like, $350 expensive."',
        '"The copy room printer jams every time. You have to OPEN it and pull out the paper."'];
      say('Ben: ' + l[S.turn % l.length]); return true;
    }
  },
},

bossoffice: {
  name: "Mr. Grumman's Office", zone: 'office',
  desc: () => 'A corner office with a view, a motivational poster ("WINNERS NEVER TAKE LUNCH") and an empty Employee of the Month frame. ' +
    (P.boss() ? `Mr. Grumman sits behind his desk. ${bossText()} ` : 'The boss is not here. ') + 'The open space is west.',
  exits: { w: 'openspace', out: 'openspace' },
  things: {
    'grumman|boss|mr grumman': () => P.boss() ? `Bald, red-faced, a tie with tiny golf clubs on it. ${bossText()}` : 'He isn\'t here.',
    'poster': 'WINNERS NEVER TAKE LUNCH.', 'frame': 'Employee of the Month: (empty). For eleven years.',
  },
  act(c) {
    if (!P.boss()) return false;
    if (c.v === 'give' && is(c.all, 'report|papers') ) {
      if (!has('report')) { say('You don\'t have the report.'); return true; }
      lose('report'); S.f.reportDone = true;
      const late = S.t > at(3, 17);
      say(late ? '"LATE! But... it\'s actually good." He grunts. (Boss +10)' : '"The quarterly report. On time. Hm. HM. Good work." He almost smiles. (Boss +20)');
      bossMood(late ? 10 : 20); return true;
    }
    if (c.v === 'give' && is(c.all, 'coffee|cup')) {
      if (!has('coffee')) { say('You have no coffee.'); return true; }
      lose('coffee');
      if (once('bosscoffee' + D())) { say('"Black, no sugar. How did you know?" (Boss +5)'); bossMood(5); }
      else say('"Another one? Are you trying to give me a heart attack?"');
      return true;
    }
    if (c.v === 'compliment' || c.v === 'flatter') {
      if (once('compliment')) { say('"Nice tie, sir." He looks at the golf clubs. "It IS a nice tie." (Boss +3)'); bossMood(3); }
      else say('"Yes, yes. Back to work."');
      return true;
    }
    if (c.v === 'insult' || c.v === 'fight' || c.v === 'shout' || c.v === 'yell') {
      gameOver('You tell Mr. Grumman exactly what you think of him. It feels GREAT for eight seconds. Then Tony escorts you out with a cardboard box. ' +
        'No job, no salary, no ring. Laura is not impressed.', 'fired');
      return true;
    }
    if (c.v === 'ask' && is(c.all, 'raise|money|salary')) { say('"A RAISE? Ha! HA! Get out." (Boss -5)'); bossMood(-5); return true; }
    if (c.v === 'talk' || c.v === 'ask') {
      say(!S.f.reportDone && D() <= 3 ? '"Where\'s my QUARTERLY REPORT? Thursday, 5 PM!"' : S.boss >= 70 ? '"Good work this week. Keep it up."' : '"Shouldn\'t you be WORKING?"');
      return true;
    }
  },
},

breakroom: {
  name: 'Break Room', zone: 'office',
  desc: 'A small break room: a coffee machine, a fridge full of labelled yoghurts and a passive-aggressive sign: PLEASE WASH YOUR MUGS!! The open space is south.',
  exits: { s: 'openspace' },
  things: { 'machine|coffee machine': 'It makes coffee. Free for employees. You could GET COFFEE.', 'fridge|yoghurts': '"DO NOT TOUCH - SANDRA". Every single item.', 'sign': 'Two exclamation marks. Somebody is angry.' },
  act(c) {
    if ((c.v === 'take' || c.v === 'make' || c.v === 'get' || c.v === 'use' || c.v === 'buy') && is(c.all, 'coffee|machine|cup')) {
      if (has('coffee')) { say('You already have a cup of coffee.'); return true; }
      place('coffee', 'breakroom');
      if (getItem('coffee', true)) say('The machine gurgles and fills a cup with black coffee.');
      return true;
    }
  },
},

copyroom: {
  name: 'Copy Room', zone: 'office',
  desc: () => 'A hot, windowless room with a giant printer-copier. ' +
    (S.f.jamFixed ? 'The printer hums happily. ' : 'Its display blinks: PAPER JAM IN TRAY 2. ') + 'The open space is north.',
  exits: { n: 'openspace' },
  things: {
    'printer|copier|display|tray': () => S.f.jamFixed ? 'Working, for once.' : 'PAPER JAM IN TRAY 2. You could OPEN the printer.',
  },
  act(c) {
    if ((c.v === 'open' || c.v === 'fix' || c.v === 'repair' || c.v === 'kick' || c.v === 'hit' || c.v === 'fight') && is(c.all, 'printer|copier|tray|jam')) {
      if (S.f.jamFixed) { say('It\'s working. Don\'t jinx it.'); return true; }
      if (c.v === 'kick' || c.v === 'hit' || c.v === 'fight') { say('You kick the printer. It beeps angrily. PAPER JAM IN TRAY 2. Maybe OPEN it instead.'); return true; }
      S.f.jamFixed = true; advance(5);
      say('You open the side panel and pull out a crumpled, half-eaten sheet of paper. The printer purrs back to life.');
      if (S.f.printed && S.where.report === null && !S.f.reportDone && !has('report')) { place('report', 'copyroom'); say('Your quarterly report slides out into the tray!'); }
      return true;
    }
    if ((c.v === 'print') ) { say('You need to print it from the computer at your desk.'); return true; }
  },
},

// ========================= EAST: NEON STRIP & CLUB =========================
neon: {
  name: 'Neon Strip', zone: 'east',
  desc: () => 'A street of flashing signs: a kebab shop, a pawn shop (north) and, east, the purple neon of CLUB VELVET. ' +
    'To the south, a fenced construction site. Main Avenue is west.' + (night() ? ' At night the strip buzzes with party people.' : ''),
  exits: { w: 'avsouth', n: 'pawnshop', e: 'clubdoor', s: 'construction' },
  things: { 'kebab|kebab shop': 'Smells incredible at 2 AM, terrible at 9 AM.', 'signs|neon': 'VELVET * VELVET * VELVET.' },
},

clubdoor: {
  name: 'Club Velvet Entrance', zone: 'east',
  desc: () => 'A velvet rope, a purple door and a bass you feel in your teeth. Behind the rope stands Brick, the bouncer. ' +
    (within(21, 4) ? 'Entry: $15. ' : 'The club is closed now (open 9 PM to 4 AM). ') + 'The Neon Strip is west.',
  exits: { w: 'neon', in: 'dancefloor' },
  things: { 'brick|bouncer': 'A wall with a face.', 'rope': 'Velvet. Of course.' },
  act(c) {
    if (c.v === 'go' && c.n === 'in') {
      if (!within(21, 4)) { say('The door is locked. Club Velvet opens at 9 PM.'); return true; }
      if (S.f.clubPaid === nightId()) return false;
      if (P.party()) { S.f.clubPaid = nightId(); say('"Name?" You mention Ben\'s birthday party. Brick checks his list and lifts the rope.'); return false; }
      if (!spend(15)) { say('Brick shakes his head. "Fifteen bucks or you go home."'); return true; }
      S.f.clubPaid = nightId(); say('You pay $15. Brick lifts the rope without a word.');
      return false;
    }
    if (c.v === 'talk') { say('Brick: "Fifteen bucks. And no trainers." He looks at your trainers. "Fine. Today, trainers."'); return true; }
  },
},

dancefloor: {
  name: 'Club Velvet Dance Floor', zone: 'club',
  desc: () => 'Lasers, smoke and a hundred sweaty people jumping in unison. A bar along one wall sells beer ($6). Stairs go up to the VIP LOUNGE. The exit is out.' +
    (P.party() ? ' In a corner, your colleagues celebrate Ben\'s birthday with a cake shaped like a bitcoin.' : '') +
    (P.bossClub() ? ' Even Mr. Grumman is here, loosening his golf-club tie.' : ''),
  exits: { out: 'clubdoor', w: 'clubdoor', u: 'vip' },
  things: { 'bar': 'Beer $6.', 'ben|colleagues|cake': () => P.party() ? 'Ben waves wildly: "YOU CAME!"' : 'Strangers.', 'grumman|boss': () => P.bossClub() ? 'Mr. Grumman, dancing. You will never unsee this.' : 'Not here.' },
  act(c) {
    if (c.v === 'dance') {
      advance(30);
      say(P.party() ? 'You dance with Ben and the gang. Your moves are... memorable.' : 'You dance for half an hour. You are terrible. Nobody cares. It\'s great.');
      if (P.bossClub() && once('bossdance')) { say('Mr. Grumman claps you on the shoulder: "Team player! I like that!" (Boss +10)'); bossMood(10); }
      return true;
    }
    if ((c.v === 'talk') && is(c.all, 'grumman|boss') && P.bossClub()) {
      if (once('bossdance')) { say('Mr. Grumman, two beers in: "You know what? You\'re alright. TEAM PLAYER!" (Boss +10)'); bossMood(10); }
      else say('"Have you met my wife? She\'s not here."');
      return true;
    }
    if (c.v === 'talk' && is(c.all, 'ben')) { say(P.party() ? '"Thanks for coming, man! Stay out of the VIP lounge, though. Trust me."' : 'Ben isn\'t here tonight.'); return true; }
    if ((c.v === 'buy' || c.v === 'drink' || c.v === 'order') && is(c.all, 'beer|drink|beers')) {
      if (!spend(6)) return true;
      advance(10); say('You drink a beer. It tastes like $6 of foam.'); return true;
    }
  },
},

vip: {
  name: 'VIP Lounge', zone: 'club',
  desc: 'Red velvet, low lights and a bar where a bottle of champagne costs $350. Men in shiny shirts and very glamorous women sit on long sofas. Stairs go down to the dance floor.',
  exits: { d: 'dancefloor' },
  things: { 'bar|champagne': 'CHAMPAGNE: $350 a bottle. Not a typo.', 'women|men|sofas': 'Everybody here is either very rich or about to be very poor.' },
  enter() {
    if (P.crystal()) {
      S.enc = 'crystal';
      say('A stunning woman in a silver dress slides next to you. "Hi, handsome. I\'m Crystal. You look lonely. Buy me a glass of champagne?" ' +
        'She puts a hand on your knee. (ACCEPT or REFUSE?)', 'warn');
    }
  },
  act(c) {
    if (S.enc !== 'crystal') {
      if ((c.v === 'buy' || c.v === 'order') && is(c.all, 'champagne|drink|bottle')) { say('$350? For fizzy wine? You keep your wallet firmly closed.'); return true; }
      return false;
    }
    S.enc = null; S.f.crystalNight = nightId();
    if (c.v === 'accept' || c.v === 'kiss' || c.v === 'flirt' || ((c.v === 'buy' || c.v === 'order' || c.v === 'give') && is(c.all, 'champagne|drink|bottle|glass|her|crystal'))) {
      S.f.escort = true;
      let pay = 350; const c1 = Math.min(S.cash, pay); S.cash -= c1; S.bank -= (pay - c1);
      say('"A glass" turns out to be a bottle, and the bottle is $350. Crystal laughs at everything you say and leans very close. ' +
        `The waiter takes $${c1} in cash` + (pay > c1 ? ` and $${pay - c1} from your card` : '') + '.', 'warn');
      say('And then: a FLASH. Across the room, Laura\'s best friend Chloe lowers her phone, looks at you in disgust, and starts typing. Very fast.', 'warn');
      advance(30);
      say('[SMS] Laura: "Chloe just sent me a photo. VIP lounge?? Who is SHE??? Don\'t you DARE call me."', 'sms');
      love(-60);
      return true;
    }
    say('"No thanks. I have a girlfriend." Crystal shrugs: "Your loss, sugar," and drifts towards a man with a gold watch.');
    return c.v === 'go' ? false : true;
  },
},

pawnshop: {
  name: "Honest Abe's Pawn Shop", zone: 'east',
  closed: () => (D() < 6 && within(10, 19)) ? null : 'The pawn shop is closed (10 AM to 7 PM, Monday to Saturday).',
  desc: 'Saxophones, guitars, televisions and a stuffed owl. Honest Abe, behind a barred counter, will SELL you nothing but BUY almost anything. The Neon Strip is south.',
  exits: { s: 'neon', out: 'neon' },
  things: { 'abe|honest abe': '"Everything has a price, my friend. Show me what you\'ve got."', 'owl': 'It looks honest. Abe, less so.' },
  act(c) {
    if (c.v === 'sell') {
      const id = findItem(c.n, true);
      if (!id) { say('Sell what? You don\'t have that.'); return true; }
      if (id === 'ring') { say('"Selling the engagement ring before the engagement? Bad sign, my friend." He won\'t take it.'); return true; }
      if (id === 'book') { say('"That\'s library property!" says Abe. Even he has principles.'); return true; }
      if (id === 'lostwallet') { say('"Another man\'s wallet? I\'m honest, my friend. It says so on the sign." He points at the police station.'); return true; }
      const v = I[id].value;
      if (!v) { say('Abe looks at it and laughs. "I wouldn\'t give you a cent for that."'); return true; }
      lose(id); S.cash += v;
      say(`Abe gives you $${v} for ${I[id].name}.`); return true;
    }
    if (c.v === 'buy') { say('"I only buy, my friend. Selling is for amateurs."'); return true; }
  },
},

construction: {
  name: 'Construction Site Gate', zone: 'east',
  desc: () => 'A fenced building site with a sign: DANGER - HARD HAT AREA. A site office trailer stands by the gate. ' +
    (D() < 6 && within(7, 17) ? 'The gate south is open; you hear drilling and shouting. ' : 'The gate is locked for the night. ') +
    'The Neon Strip is north.',
  exits: { n: 'neon', s: 'site', in: 'site' },
  things: { 'sign': 'DANGER - HARD HAT AREA. FALLING OBJECTS. NO EXCEPTIONS.', 'trailer|office': 'The site office. A hook by the door holds spare visitor hard hats.', 'hook': 'A hook for visitor hard hats.' },
  act(c) {
    if (c.v === 'go' && (c.n === 's' || c.n === 'in')) {
      if (!(D() < 6 && within(7, 17))) { say('The gate is locked. Work hours: 7 AM to 5 PM, Monday to Saturday.'); return true; }
      if (!(has('hardhat') && S.worn.hardhat)) {
        if (!S.f.hatWarned) {
          S.f.hatWarned = true;
          say('You step through the gate. A BRICK smashes into the mud one metre from your foot. "OI! NO HARD HAT, NO ENTRY!" yells someone from the scaffolding. You step back out, heart pounding.', 'warn');
          return true;
        }
        gameOver('You walk into the site without a hard hat again. This time the brick doesn\'t miss. The sign said HARD HAT AREA. The sign was right.', 'dead');
        return true;
      }
      return false;
    }
  },
},

site: {
  name: 'Construction Site', zone: 'east',
  desc: () => 'Scaffolding, cement mixers and mud. Bricks rain down from above at irregular intervals. ' +
    (P.foreman() ? 'Big Mike, the foreman, shouts orders into a radio. ' : '') +
    (S.f.ladderOut ? '' : 'Against the trailer leans an old aluminium LADDER. ') + 'The gate is north.',
  exits: { n: 'construction', out: 'construction' },
  things: { 'mike|foreman|big mike': '"Whatever you\'re selling, I\'m not buying." He is busy but not unkind.', 'scaffolding': 'Seven floors of pipes and planks.', 'mixer|mixers': 'Round and round.', 'ladder': () => S.f.ladderOut ? 'You already borrowed it.' : 'A long aluminium ladder. Heavy, 9 kg. Maybe you could BORROW it.' },
  act(c) {
    const ask = (c.v === 'borrow' || c.v === 'take' || c.v === 'ask' || c.v === 'get' || (c.v === 'talk' && is(c.all, 'ladder'))) && is(c.all, 'ladder');
    if (ask) {
      if (S.f.ladderOut) { say(has('ladder') ? 'You already have it.' : '"I already lent you my ladder! Bring it back!"'); return true; }
      if (!P.foreman()) { say('Nobody is around to ask, and taking it would be stealing.'); return true; }
      place('ladder', 'site');
      if (getItem('ladder', true)) {
        S.f.ladderOut = true;
        say('"The ladder? For a CAT? Ha! Go on then, take it. Just bring it back when you\'re done." You heave the 9 kg ladder onto your shoulder.');
      } else { place('ladder', null); say('"Mate, you\'re carrying half a house already. You\'ll never manage a 9 kg ladder like that."'); }
      return true;
    }
    if ((c.v === 'return' || c.v === 'give' || c.v === 'drop') && is(c.all, 'ladder')) {
      if (!has('ladder')) { say('You don\'t have the site\'s ladder.'); return true; }
      lose('ladder'); S.f.ladderOut = false; S.f.ladderBack = true;
      say('"Brought it back! You\'re a rare one." Big Mike leans it against the trailer.');
      deed('ladder'); return true;
    }
    if (c.v === 'talk') { say('"Visitors keep the hard hat ON, understood? We lose a brick a minute up there."'); return true; }
  },
},

// =============================== OLD TOWN ==================================
oldtown: {
  name: 'Old Town Lane', zone: 'downtown',
  desc: 'A cobbled lane between leaning old houses. Scooters zip past without warning. Luigi\'s Trattoria glows warmly to the north (in). The plaza is northeast.',
  exits: { ne: 'plaza', n: 'restaurant', in: 'restaurant' },
  things: { 'scooters|scooter': 'They are the real danger in the Old Town. You flatten yourself against a wall as one passes.', 'trattoria|luigi|restaurant': 'Luigi\'s. Checked tablecloths, candles in wine bottles. Perfect for a proposal.' },
},

restaurant: {
  name: "Luigi's Trattoria", zone: 'downtown',
  closed: () => (within(12, 15) || within(19, 23)) ? null : 'Luigi\'s is closed right now (12-3 PM and 7-11 PM).',
  desc: () => 'Checked tablecloths, candles in wine bottles, mandolin music. Luigi, enormous and moustached, beams at you. ' +
    (D() === 5 && S.t >= at(5, 19) ? 'Table 3 is RESERVED for you, with a single rose on it. ' : 'He reminds you: "Saturday, 8 PM, table 3. Is all ready, signore!" ') +
    (P.lauraRest() ? 'Laura sits at table 3 in her green dress, waiting for you. ' : '') + 'The lane is south.',
  exits: { s: 'oldtown', out: 'oldtown' },
  things: {
    'luigi': '"Amore! Is the most important night, eh? I put extra candles."',
    'laura': () => P.lauraRest() ? `Laura, in her green dress, more beautiful than ever. ${loveText()}` : 'She isn\'t here yet.',
    'table|table 3': 'Table 3, by the window. Your table.',
  },
  enter() {
    if (P.lauraRest()) {
      contact();
      if (S.t > at(5, 20.25) && once('latedinner')) { say('"You\'re LATE. On our anniversary." Laura is not amused. (You are ' + Math.round((S.t - at(5, 20)) / 1) + ' minutes late.)', 'warn'); love(-10); }
      else say('Laura stands up and kisses you. "Happy anniversary, you."');
      say('This is it. The moment. You could PROPOSE now.');
    } else if (D() === 5 && within(19, 19.75)) say('You are early. Luigi seats you at table 3. Laura should arrive at about 7:45. You could WAIT.');
  },
  act(c) {
    if (c.v === 'propose' || c.v === 'kneel' || (c.v === 'give' && is(c.all, 'ring')) || (c.v === 'ask' && is(c.all, 'marry'))) {
      if (!P.lauraRest()) { say(D() === 5 ? 'Laura isn\'t here yet. WAIT for her.' : 'Saturday, 8 PM. That\'s the plan. Don\'t rush it.'); return true; }
      if (!has('ring')) { say('You get down on one knee... reach into your pocket... and find nothing. No ring! You turn it into tying your shoelace. Laura raises an eyebrow.'); return true; }
      finale(); return true;
    }
    if (c.v === 'talk' && is(c.all, 'laura')) {
      if (!P.lauraRest()) { say('She isn\'t here.'); return true; }
      say('"Three years," she says, playing with the candle. "Three years and you still make me laugh. So? Any big plans for the next three?" She looks at you. Meaningfully.');
      return true;
    }
    if (c.v === 'talk') { say('"Signore! Saturday is the big night, eh? I keep table 3 for you. Laura... she will say yes. Luigi knows."'); return true; }
    if (c.v === 'eat' || c.v === 'order') {
      if (P.lauraRest()) { say('You order two plates of spaghetti. Very romantic, very messy. Now, about that ring...'); return true; }
      if (!spend(12)) return true;
      advance(40); say('You eat Luigi\'s lasagna ($12). It is the best thing that happened to you this week.'); return true;
    }
  },
},

};

// ---------------------------------------------------------- shared texts
function loveText() {
  const l = S.love;
  return l >= 80 ? 'She looks at you like you hung the moon.' : l >= 60 ? 'She seems happy with you.' :
    l >= 35 ? 'She seems a little distant lately.' : 'She seems cold and annoyed with you.';
}
function bossText() {
  const b = S.boss;
  return b >= 75 ? 'He looks almost pleased with you.' : b >= 45 ? 'He grunts at you. Normal.' :
    b >= 25 ? 'He glares at you. You are on thin ice.' : 'His face is purple. One more mistake and you\'re out.';
}

// ----------------------------------------------------------------- map
// Schematic city grid used by the MAP command: [column, row, short label].
// Every compass exit links cells on the same row/column (or a diagonal).
const MAP = {
  bedroom: [4, 1, 'Bedroom'], bathroom: [5, 1, 'Bathroom'],
  landing: [3, 2, 'Landing'], living: [4, 2, 'Living Rm'], kitchen: [5, 2, 'Kitchen'],
  lobby: [3, 3, 'Lobby'], landlord: [4, 3, 'Kowalski'],
  pond: [0, 4, 'Duck Pond'], oak: [1, 4, 'Old Oak'], playground: [2, 4, 'Playground'], alley: [4, 4, 'Rook Alley'],
  cafe: [5, 4, 'Cafe'], laura: [6, 4, "Laura's"],
  library: [0, 5, 'Library'], parkgate: [1, 5, 'Park Gate'], elm: [3, 5, 'Elm St'], maple: [4, 5, 'Maple St'],
  rose: [6, 5, 'Rose Lane'], hardware: [7, 5, 'Hardware'],
  florist: [1, 6, 'Florist'], drycleaner: [2, 6, 'Dry Clean'], avnorth: [3, 6, 'Main Av N'], busstop: [4, 6, 'Bus Stop'],
  gym: [5, 6, 'Gym'], supermarket: [6, 6, 'Supermkt'], pawnshop: [7, 6, 'Pawn Shop'], vip: [9, 6, 'VIP'],
  police: [0, 7, 'Police'], church: [1, 7, "St Mark's"], avsouth: [3, 7, 'Main Av S'], neon: [7, 7, 'Neon Strip'],
  clubdoor: [8, 7, 'Velvet'], dancefloor: [9, 7, 'Dancefloor'],
  clinic: [1, 8, 'Clinic'], bank: [2, 8, 'Bank'], plaza: [3, 8, 'Plaza'], post: [4, 8, 'Post Off.'], construction: [7, 8, 'Site Gate'],
  restaurant: [1, 9, "Luigi's"], boutique: [4, 9, 'Boutique'], site: [7, 9, 'Building'],
  oldtown: [1, 10, 'Old Town'], jeweler: [2, 10, 'Jeweller'], business: [3, 10, 'Commerce'], mall: [4, 10, 'Mall'], foodcourt: [5, 10, 'Food Court'],
  officelobby: [3, 11, 'Office'], breakroom: [4, 11, 'Break Rm'],
  elevator: [3, 12, 'Lift'], openspace: [4, 12, 'Open Space'], bossoffice: [5, 12, 'Boss'],
  copyroom: [4, 13, 'Copy Room'],
};
// Exits not drawn on the map (jaywalking is not a road).
const MAP_SKIP = new Set(['busstop>s']);
