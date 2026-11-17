// Events of the week and end-of-game extras: traffic fines, Mom's birthday,
// the neighbours' party, the ATM that eats your card, the Friday presentation,
// the diary and the secret achievements. Loaded before engine.js; everything
// here is called at runtime, so engine helpers are available.
'use strict';

// ------------------------------------------------------------------ diary
function diary(text) { (S.diary || (S.diary = [])).push({ d: D(), t: clock(), text }); }

function diaryDay(d) { return (S.diary || []).filter((e) => e.d === d); }

function showDiary(week) {
  if (week) {
    say('YOUR WEEK, AS TOLD BY YOUR DIARY', 'title');
    for (let d = 0; d <= Math.min(D(), 5); d++) {
      const es = diaryDay(d);
      say(`${DAYS[d]}: ` + (es.length ? es.map((e) => e.text).join(' ') : 'Nothing happened. A pretty normal day.'), 'note');
    }
    return;
  }
  const es = diaryDay(D());
  say(`DEAR DIARY - ${DAYS[D()]}, ${clock()}`, 'title');
  if (!es.length) { say('Nothing happened today. Pretty normal. Maybe tomorrow I will do something worth writing down.'); return; }
  for (const e of es) say(`  ${e.t}  ${e.text}`);
  say(es.length >= 6 ? 'What a day. I need a nap. And a holiday. And a nap on holiday.' :
    es.length >= 3 ? 'A busy day for a normal man.' : 'Not bad, not great. Normal.', 'note');
  say('(Type DIARY WEEK to read the whole week.)', 'note');
}

// ------------------------------------------------------- 1. traffic fines
// First time you cross where or when you shouldn't, a traffic cop saves you
// and fines you. The second time, there is no cop.
function trafficFine() {
  S.f.redWarned = true; S.f.fined = true;
  const amt = has('wallet') ? Math.min(S.cash, 50) : 0;
  S.cash -= amt;
  say('PHWEEEET! A traffic cop yanks you back by the collar just as a van roars through the spot where you would have been. ' +
    '"Jaywalking! Do you WANT to die?" ' +
    (amt ? `He writes you a $${amt} fine and takes the cash on the spot.` : 'You have no cash on you, so he settles for a very long lecture.') +
    ' (Next time there will be no cop. Only the van.)', 'warn');
  diary(`Got fined${amt ? ' $' + amt : ''} for jaywalking. The cop said I was "a statistic waiting to happen".`);
}

// ------------------------------------------------- 2. Mom's birthday (Thu)
function birthdayCall() {
  S.f.bdayCalled = true;
  say('"HAPPY BIRTHDAY, MOM!" She bursts into tears. "You REMEMBERED! Your father forgot until 9 o\'clock, and he was IN THE ROOM." ' +
    'Forty minutes of family news later, you hang up. She sounded like the happiest woman in the world.');
  if (!S.deeds.mom) deed('mom');
  deed('birthday');
  diary('Called Mom for her birthday. She cried. I may have cried a little too.');
}

// ------------------------------------------- 3. the party in 2B (Tue night)
function partyOn() {
  return !S.f.partyStopped && ((D() === 1 && H() >= 22) || (D() === 2 && H() < 2));
}

// Commands about the party, from any room of the flat or the landing.
function partyAct(c) {
  if (!partyOn() || !(L[S.loc].zone === 'home')) return false;
  if (c.v === 'complain' || (c.v === 'knock' && is(c.all, '2b|door|neighbours|neighbors|party')) ||
    (c.v === 'shout' && S.loc !== 'landing')) {
    S.f.partyStopped = true; advance(10);
    say('You go down to 2B in your pyjamas and knock. A guy in a toga opens the door. "Too loud? Sorry, man!" ' +
      'The music stops. Somebody boos. You go back to bed feeling about ninety years old.');
    diary('Went down in my pyjamas to ask the people in 2B to turn the music off. A man in a toga apologised.');
    if (S.loc !== 'bedroom' && S.loc !== 'landing') moveTo(S.loc);
    return true;
  }
  if (c.v === 'join' || c.v === 'dance') {
    S.f.partied = true; S.f.partyStopped = true;
    say('Oh, why not. You go down to 2B. Within minutes you are wearing a toga and leading a conga line. ' +
      'At 2 AM you climb back upstairs, deaf and happy.');
    S.asleep = true;             // no 1 AM collapse while partying
    advanceTo(at(2, 2));
    S.asleep = false;
    if (S.over) return true;
    say('Bad news: Mrs. Ferretti lives right above 2B and saw EVERYTHING through her window. Laura will hear about the conga line. (Laura -5)', 'warn');
    love(-5);
    diary('Joined the toga party in 2B. Led a conga line. Mrs. Ferretti saw it all. Worth it? Unclear.');
    if (S.over) return true;
    S.loc = 'bedroom';
    goToSleep();
    return true;
  }
  return false;
}

// Called by goToSleep: true if the noise keeps you awake.
function partyKeepsAwake() {
  if (!partyOn() || L[S.loc].zone !== 'home') return false;
  if (has('earplugs')) { say('Downstairs the party is in full swing, but you push in your earplugs. Blessed, muffled silence.'); return false; }
  say('BOOM. BOOM. BOOM. The neighbours in 2B, one floor down, are having a party. The bed vibrates. Sleep is impossible. ' +
    '(You could COMPLAIN, JOIN the party, or buy EARPLUGS at the supermarket.)', 'warn');
  return true;
}

// --------------------------------------------- 4. the ATM eats your card
// Returns true if the ATM can't be used.
function atmCardTrouble() {
  if (S.f.cardGone) { say('Your card is still inside the ATM. Only the bank staff can get it out: ask at the counter inside (weekdays 8:30 AM - 4 PM).'); return true; }
  if (D() >= 1 && !S.f.cardEaten) {
    S.f.cardEaten = true; S.f.cardGone = true;
    say('You put your card in. The ATM thinks about it, beeps three times, and SWALLOWS it. The screen says: "CARD RETAINED. PLEASE CONTACT YOUR BRANCH." ' +
      'The branch is right here, but it is open only on weekdays from 8:30 AM to 4 PM.', 'warn');
    diary('The ATM ate my bank card. Just ate it. No reason. I may never financially recover.');
    return true;
  }
  return false;
}
function bankReturnsCard() {
  advance(25);
  S.f.cardGone = false; S.f.cardBack = true;
  say('Twenty-five minutes, two forms and one photocopy of your ID later, the teller hands back your card with the face of someone handing back a hostage.');
  diary('Got my bank card back after 25 minutes of forms. A small victory against the system.');
}

// ------------------------------------------ 6. the Friday presentation
const MEETING_Q = [
  'The Friday presentation. The whole team sits around the meeting table. Mr. Grumman points at you: "YOU. Q3 sales went DOWN. Why? And what do we do about it?"',
  '  A) "It\'s the economy, sir. The global economy."',
  '  B) "Synergies, sir. We need more... synergies."',
  '  C) "We lost two big clients because we answer too slowly. I propose a 24-hour reply rule."',
  '  D) "Honestly? Ask Ben."',
  '(Type A, B, C or D.)',
];
function startMeeting() {
  S.enc = 'meeting';
  MEETING_Q.forEach((l, i) => say(l, i ? 'note' : 'warn'));
}
function meetingAnswer(raw) {
  const ch = (raw.trim().toLowerCase().match(/^[a-d1-4]/) || [])[0];
  if (!ch) { say('Everyone is staring at you. Answer A, B, C or D.', 'warn'); return; }
  const k = 'abcd'.indexOf(ch) >= 0 ? 'abcd'.indexOf(ch) : parseInt(ch, 10) - 1;
  S.enc = null; S.f.meetingDone = true;
  if (k === 0) { say('Mr. Grumman nods slowly. "The economy. How... original." Nobody claps.'); diary('Blamed the economy at the Friday presentation. The economy did not defend itself.'); }
  if (k === 1) { say('"SYNERGIES!" Mr. Grumman\'s eyes light up. He writes it on the whiteboard and underlines it three times. (Boss +5)'); bossMood(5); diary('Said "synergies" at the presentation. The boss LOVED it. I do not know what it means.'); }
  if (k === 2) {
    say('Silence. Then Mr. Grumman slaps the table: "THAT is an answer! A plan! With NUMBERS!" He looks at you as if seeing you for the first time. ' +
      '"There\'ll be something extra in your pay today." (Boss +10)', 'good');
    bossMood(10); S.f.presBonus = true; deed('presentation');
    diary('Nailed the Friday presentation. Grumman said "THAT is an answer". Framing this moment.');
  }
  if (k === 3) {
    say('Ben chokes on his coffee. Mr. Grumman frowns: "Blaming colleagues? Not a team player." Ben will not forget this. (Boss -10)', 'warn');
    bossMood(-10); diary('Blamed Ben at the presentation. Ben is now writing my name in a little black notebook.');
  }
  if (S.over) return;
  if (advanceTo(at(4, 13))) say('The meeting ends, you finish the morning\'s work, and at 1 PM it\'s lunch break.');
}

// Hook for exec: commands handled by this file before the location's own.
function weekAct(c) {
  return partyAct(c);
}

// Timed events of this file, called by minuteEvent for every minute.
function weekEvent(d, m) {
  if (d === 3 && m === 8 * 60) say('[SMS] Dad: "Don\'t forget, today is your mother\'s BIRTHDAY. She says she doesn\'t care. She cares. CALL HER."', 'sms');
  if (d === 3 && m === 22 * 60 && !S.f.bdayCalled) {
    S.f.bdayMissed = true;
    say('[SMS] Mom: "Not a call, not a message. On my BIRTHDAY. I raised you. I will tell Laura what kind of son you are." (Laura -5)', 'sms');
    love(-5);
    diary('Forgot Mom\'s birthday. She texted. She will tell Laura. She already told Laura.');
  }
  if (d === 1 && m === 22 * 60 && !S.f.partyStopped && L[S.loc].zone === 'home') say('From the flat below, 2B, comes a thumping bass. Somebody is having a PARTY.', 'note');
  if (d === 1 && m === 23 * 60 + 15 && S.asleep && L[S.loc].zone === 'home' && partyOn() && !has('earplugs')) {
    S.asleep = false;
    say('BOOM-TSS-BOOM-TSS! You are blasted awake. The neighbours in 2B are having a PARTY and the floor is shaking. ' +
      '(COMPLAIN, JOIN the party, or find some EARPLUGS.)', 'warn');
    return 'stop';
  }
  if (d === 4 && m === 11 * 60 && !S.f.meetingDone && S.enc !== 'meeting') {
    S.f.meetingDone = true; S.f.meetingMissed = true;
    say('[E-MAIL] Mr. Grumman: "You MISSED the Friday presentation. In front of EVERYBODY. We will talk about this." (Boss -10)', 'warn');
    bossMood(-10);
    diary('Missed the Friday presentation. Grumman sent an e-mail in capital letters.');
  }
  return null;
}

// --------------------------------------------- 13. secret achievements
const ACHIEVEMENTS = [
  ['Clockwork', 'Never late for work, not even once.', () => !S.f.late && Object.keys(S.work).length > 0],
  ['Office Gamer', 'Beat The Curse of Zormak during office hours.', () => S.f.zormakAtWork],
  ['Cat Whisperer', 'Mortimer never had to hide anything of yours.', () => !S.f.catEverHid && (S.deeds.mortimer || 0) >= Math.min(6, D() + 1)],
  ['Model Citizen', 'No fines, no late bills, rent paid.', () => !S.f.fined && !S.f.lateBill && S.f.rentPaid],
  ['Living Dangerously', 'Fined for jaywalking. And lived.', () => S.f.fined],
  ['Party Animal', 'Led the conga line in 2B.', () => S.f.partied],
  ['Good Son', 'Remembered Mom\'s birthday.', () => S.f.bdayCalled],
  ['Bureaucracy Survivor', 'Got your card back from the bank.', () => S.f.cardBack],
  ['Employee of the Week', 'Nailed the Friday presentation.', () => S.deeds.presentation],
  ['Nightmare for Pickpockets', 'Caught Vince red-handed.', () => S.f.vinceGone],
  ['Gym Rat', 'Worked out three times.', () => S.fit >= 3],
  ['Saint of the Suburbs', 'Every single good deed, at maximum.', () => Object.keys(DEEDS).every((k) => (S.deeds[k] || 0) >= (DEEDS[k].max || 1))],
  ['Professional Couch Potato', 'Finished with fewer than 50 points.', () => S.score < 50],
];
function showAchievements() {
  const got = ACHIEVEMENTS.filter((a) => a[2]());
  say(`SECRET ACHIEVEMENTS: ${got.length} of ${ACHIEVEMENTS.length}`, 'title');
  for (const a of ACHIEVEMENTS) say(a[2]() ? `  * ${a[0]}: ${a[1]}` : '  - ???', a[2]() ? 'score' : 'note');
}
