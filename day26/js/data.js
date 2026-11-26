// Static data: names, jobs, habits, secrets and event texts.
'use strict';

const DATA = {
  surnames: ['Rossi', 'Bianchi', 'Esposito', 'Ferrari', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno',
    'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri',
    'Fontana', 'Santoro', 'Rinaldi', 'Caruso', 'Ferrara', 'Martini', 'Leone', 'Longo', 'Gentile', 'Vitale',
    'Serra', 'Coppola', 'De Santis', 'Marchetti', 'Parisi', 'Villa', 'Fabbri', 'Grasso', 'Messina', 'Sala',
    'Gatti', 'Pellegrini', 'Palumbo', 'Sanna', 'Farina', 'Monti', 'Cattaneo', 'Amato', 'Testa', 'Carbone',
    'Nguyen', 'Kowalski', 'Okafor', 'Haddad', 'Chen', 'Silva', 'Popescu', 'Schmidt', 'Dubois', 'Novak', 'Ahmed', 'Garcia'],
  male: ['Marco', 'Luca', 'Giuseppe', 'Antonio', 'Francesco', 'Alessandro', 'Matteo', 'Lorenzo', 'Andrea', 'Paolo',
    'Giovanni', 'Roberto', 'Stefano', 'Davide', 'Simone', 'Fabio', 'Gino', 'Salvatore', 'Pietro', 'Enzo',
    'Tommaso', 'Leonardo', 'Riccardo', 'Nicola', 'Vittorio', 'Omar', 'Wei', 'Tomasz', 'Chidi', 'Pablo'],
  female: ['Giulia', 'Francesca', 'Sara', 'Chiara', 'Maria', 'Anna', 'Elena', 'Laura', 'Valentina', 'Martina',
    'Alessia', 'Federica', 'Silvia', 'Paola', 'Rosa', 'Teresa', 'Lucia', 'Giovanna', 'Carla', 'Beatrice',
    'Sofia', 'Aurora', 'Ginevra', 'Alice', 'Emma', 'Amina', 'Mei', 'Agnieszka', 'Ngozi', 'Ines'],

  // Ordinary jobs: [name, min income, max income, works at night]
  jobs: [
    ['Teacher', 1600, 1900], ['Nurse', 1700, 2000, true], ['Office clerk', 1400, 1700], ['Mechanic', 1600, 1900],
    ['Engineer', 2800, 3600], ['Doctor', 4000, 5500], ['Lawyer', 3000, 5000], ['Shop assistant', 1200, 1400],
    ['Barista', 1000, 1250], ['Bus driver', 1500, 1750], ['Programmer', 2400, 3400], ['Architect', 2200, 3000],
    ['Chef', 1800, 2400, true], ['Plumber', 1900, 2600], ['Electrician', 1900, 2500], ['Accountant', 2100, 2800],
    ['Postman', 1400, 1600], ['Pharmacist', 2400, 3000], ['Police officer', 1800, 2100], ['Firefighter', 1900, 2200],
    ['Baker', 1300, 1600, true], ['Security guard', 1300, 1500, true], ['Hairdresser', 1200, 1700], ['Taxi driver', 1400, 2000, true],
    ['Journalist', 1500, 2600], ['Graphic designer', 1500, 2300], ['Bank clerk', 1900, 2400], ['Pizza maker', 1300, 1700, true]],

  // Strange but legal jobs, with a quirky event each.
  strange: [
    ['Snake milker', 1800, 2600, false, '{N} brought work home. A small cobra was spotted in the stairwell.'],
    ['Professional cuddler', 1500, 2200, false, '{N} offered free cuddles at the stairwell. Nobody knew how to react.'],
    ['Ice sculptor', 1400, 2400, false, '{N} left a giant ice swan melting in the lobby.'],
    ['Fortune teller', 1100, 2600, true, '{N} predicted a disaster for the building. Everyone is a bit nervous now.'],
    ['Crypto influencer', 500, 6000, false, '{N} is live-streaming from the balcony, shouting "to the moon".'],
    ['Taxidermist', 1600, 2300, false, 'A stuffed owl appeared on {N}\'s doormat. It is watching everyone.'],
    ['Clown', 1100, 1700, false, '{N} rehearsed balloon animals on the stairs. A child cried, another laughed.'],
    ['Professional mourner', 1300, 1900, false, '{N} practised wailing at 7 a.m. The neighbours thought someone had died.'],
    ['Pet food taster', 1800, 2300, false, '{N} described the new salmon pâté to everyone in the lift.'],
    ['ASMR streamer', 900, 3200, true, '{N} whispered into a microphone all night. The walls are very thin.'],
    ['Mime', 800, 1300, false, '{N} got "trapped in an invisible box" in the lobby for an hour.'],
    ['Ghost tour guide', 1000, 1600, true, '{N} brought a ghost tour into the building\'s basement.'],
    ['Golf ball diver', 2000, 3200, false, '{N} hung a wetsuit to dry on the balcony. It smells like pond.'],
    ['Elvis impersonator', 1100, 2200, true, '{N} sang "Suspicious Minds" in the lift. Thank you very much.'],
    ['Competitive eater', 900, 3000, false, '{N} ordered 40 hot dogs for "training". The delivery guy was concerned.'],
    ['Hand model', 2500, 4500, false, '{N} refused to touch the lift button with bare hands. Again.'],
    ['Bubble artist', 900, 1500, false, 'Giant soap bubbles drifted out of {N}\'s window all afternoon.'],
    ['Escape room actor', 1100, 1500, true, '{N} locked themselves in the bike room "for practice".']],

  // Cover stories of tenants with less than legal jobs.
  shady: [
    { key: 'smuggler', cover: 'Import-export', truth: 'smuggling contraband cigarettes', look: 'crates' },
    { key: 'fence', cover: 'Antique dealer', truth: 'fencing stolen goods', look: 'crates' },
    { key: 'pyramid', cover: 'Financial consultant', truth: 'running a pyramid scheme', look: 'screens' },
    { key: 'bookie', cover: 'Bookmaker', truth: 'running an illegal betting ring', look: 'screens' },
    { key: 'bags', cover: 'Fashion designer', truth: 'selling counterfeit handbags', look: 'bags' },
    { key: 'chopshop', cover: 'Car parts reseller', truth: 'running a chop shop for stolen cars', look: 'tyres' },
    { key: 'grow', cover: 'Herbalist', truth: 'growing something very illegal under purple lamps', look: 'grow' },
    { key: 'forger', cover: 'Art collector', truth: 'forging Renaissance paintings', look: 'easel' }],

  // Mysterious tenants: their cover and what is really going on.
  covers: ['Consultant', 'Prefers not to say', 'Freelance researcher', '"Entrepreneur"', 'Independent means', 'Night work'],
  mysteries: [
    { key: 'spy', truth: 'a retired secret agent', end: 'vanished overnight, leaving only a burnt passport in the sink.' },
    { key: 'witness', truth: 'in witness protection', end: 'was quietly moved to a new identity by two men in grey suits.' },
    { key: 'rockstar', truth: 'a world-famous rock star hiding from the fans', end: 'was found out: a crowd of fans is singing in the street.' },
    { key: 'novelist', truth: 'a novelist writing a thriller about this very building', end: 'published the book. The building is famous now!' },
    { key: 'billionaire', truth: 'an eccentric billionaire who wanted to live among "normal people"', end: 'donated a fortune to the building fund before leaving.' },
    { key: 'baker', truth: 'a night-shift baker with a very pale complexion (not a vampire, apparently)', end: 'left a tray of warm croissants at every door.' },
    { key: 'magician', truth: 'a stage magician rehearsing a disappearing act', end: 'disappeared. Literally. The rent was left in an envelope.' },
    { key: 'ghosthunter', truth: 'a ghost hunter convinced the lift is haunted', end: 'declared the lift "spiritually clean". The lift still breaks down.' },
    { key: 'astronomer', truth: 'an amateur astronomer who talks to the sky every night', end: 'discovered a comet and named it after the building.' }],

  mysteryHints: ['Strange lights flickered in {A} all night.', 'A black car waited outside {A} for hours, then drove away.',
    'Someone in {A} received a package marked "FRAGILE - DO NOT X-RAY".', 'Nobody has ever seen the tenant of {A} in daylight.',
    'Odd humming sounds came from {A} at 3 a.m.', 'The tenant of {A} pays the fees in old banknotes.',
    'A man in a trench coat asked the concierge about {A}.', 'The doormat of {A} is new every morning.'],
  shadyHints: ['Delivery vans keep stopping for {A} at odd hours.', 'A strange sweet smell drifts out of {A}.',
    'Men in sunglasses visited {A} and left with heavy bags.', 'The tenant of {A} has five phones and answers all of them.',
    'A police car slowed down in front of the building and looked at {A}\'s window.', 'Boxes keep going in and out of {A}.'],

  habits: {
    party: { label: 'Party animal', bad: ['early', 'neat'] },
    early: { label: 'Early bird', bad: ['party', 'music', 'gamer'] },
    owl: { label: 'Night owl', bad: ['early'] },
    music: { label: 'Musician', bad: ['early', 'neat'] },
    garden: { label: 'Balcony gardener', bad: ['smoker'], good: ['garden'] },
    dog: { label: 'Dog owner', bad: ['neat', 'cat'] },
    cat: { label: 'Cat lover', bad: ['dog'], good: ['cat'] },
    gossip: { label: 'Gossip', bad: ['gossip'] },
    diy: { label: 'DIY enthusiast', bad: ['early'] },
    smoker: { label: 'Smoker', bad: ['garden', 'neat'] },
    cook: { label: 'Great cook', good: ['cook'] },
    gamer: { label: 'Gamer', bad: ['early'], good: ['gamer'] },
    neat: { label: 'Neat freak', bad: ['party', 'dog', 'smoker'] },
    sporty: { label: 'Fitness fanatic', good: ['sporty'] },
    moaner: { label: 'Serial complainer', bad: ['party', 'music', 'moaner'] },
    helpful: { label: 'Helpful neighbour', good: ['helpful'] }
  },

  // Neighbourly interactions. "need" names a habit {A} or {B} must have (prefix B: for {B}).
  good: [
    ['{A} invited {B} over for dinner.', 8], ['{A} helped {B} carry the groceries upstairs.', 5],
    ['{A} brought {B} a tray of homemade lasagna.', 8, 'cook'], ['{A} and {B} chatted on the stairs for an hour.', 4],
    ['{A} lent {B} a ladder.', 4], ['{A} watered {B}\'s plants while they were away.', 6],
    ['{A} and {B} watched the match together.', 6], ['{A} shared the wifi password with {B}.', 5],
    ['{A} fixed {B}\'s leaking tap for free.', 9, 'diy'], ['{A} babysat for {B}.', 10, 'B:kids'],
    ['{A} gave {B} a cutting from the balcony geraniums.', 6, 'garden'], ['{A} and {B} went jogging together.', 6, 'sporty'],
    ['{A} signed for a parcel for {B}.', 4], ['{A} shoveled the snow in front of {B}\'s door.', 7, 'snow'],
    ['{A} played a song for {B}\'s birthday.', 7, 'music'], ['{A} and {B} played video games until dawn.', 7, 'gamer']],
  bad: [
    ['{A} complained about {B}\'s loud music.', -8, 'B:music'], ['{A} accused {B} of stealing their parking spot.', -7],
    ['{A} found {B}\'s rubbish next to the bins, unsorted.', -6], ['{A} and {B} argued about the stairwell cleaning rota.', -6],
    ['{B}\'s laundry dripped onto {A}\'s balcony.', -5, 'B:above'], ['{A} complained about the smell of {B}\'s fried fish.', -5],
    ['{A} borrowed {B}\'s drill and never gave it back.', -7], ['{A} spread gossip about {B}.', -9, 'gossip'],
    ['{B}\'s dog barked all night and kept {A} awake.', -8, 'B:dog'], ['{A} caught {B} smoking in the lift.', -7, 'B:smoker'],
    ['{B} drilled holes on a Sunday morning. {A} was not amused.', -8, 'B:diy'],
    ['{A} and {B} had a shouting match over the thermostat.', -9], ['{A} left a passive-aggressive note on {B}\'s door.', -6, 'moaner'],
    ['{B}\'s cat used {A}\'s doormat as a toilet.', -7, 'B:cat'], ['{A} complained that {B} slams the front door.', -5],
    ['{A} and {B} fought over the last washing machine.', -6]],
  feud: [
    ['{A} and {B} no longer greet each other on the stairs.', 0], ['{A} called the police on {B} for "suspicious noises".', 0],
    ['{A} and {B} are suing each other over a 3 cm hedge.', 1500], ['{A} glued {B}\'s letterbox shut. Allegedly.', 200],
    ['{A} built a wall of plants on the balcony to avoid seeing {B}.', 0]],

  moveAway: ['got a job in Milan', 'decided to move to the countryside', 'found a bigger place across town',
    'moved closer to the grandparents', 'went to live by the sea', 'moved abroad for work'],
  villas: ['bought a villa in Sardinia', 'moved to a castle in Scotland', 'bought a yacht and sailed away', 'moved to a penthouse in Monte Carlo'],
  meetingGood: ['The residents\' meeting went surprisingly well. Someone even brought cake.',
    'The meeting ended early and everyone agreed on the new bin rota. A miracle.',
    'At the meeting the residents planned a summer barbecue in the courtyard.'],
  meetingBad: ['The meeting degenerated into a shouting match about the bins.',
    'The meeting lasted four hours and nobody agreed on anything.',
    'Someone brought up the 2019 balcony incident at the meeting. Chaos ensued.'],

  // Well paid jobs for the tenants of luxury flats.
  richJobs: [['Surgeon', 6000, 9000], ['CEO', 7000, 12000], ['Footballer', 8000, 20000], ['Opera singer', 4500, 8000],
    ['Fashion influencer', 4000, 15000], ['Corporate lawyer', 5500, 9000], ['Notary', 5000, 8000], ['Film director', 4500, 10000]],

  // Businesses: where they can open, fit-out cost, monthly rent, opening hours and effect on the residents.
  shops: {
    cafe: { label: 'Café', where: 'ground', cost: 6000, rent: 650, hours: [6, 20], bonus: 3, owner: 'Barista', desc: 'Morning espresso for everybody. The gossip hub of the building.', names: ['Bar Sport', 'Caffè Roma', 'Bar Centrale', 'Caffè Aurora'] },
    bakery: { label: 'Bakery', where: 'ground', cost: 5500, rent: 550, hours: [6, 14], bonus: 3, owner: 'Baker', desc: 'The smell of fresh bread wakes up the building.', names: ['Forno Rossi', 'Il Fornaio', 'Panificio Bella', 'Pane & Amore'] },
    pizzeria: { label: 'Pizzeria', where: 'ground', cost: 8000, rent: 850, hours: [11, 23], bonus: 2, owner: 'Pizzaiolo', desc: 'Packed every evening. The wood oven is a small fire risk.', names: ['Da Gino', 'Vesuvio', 'Bella Napoli', 'Margherita'] },
    grocery: { label: 'Grocery', where: 'ground', cost: 6000, rent: 650, hours: [8, 20], bonus: 3, owner: 'Grocer', desc: 'Milk, fruit and gossip at the till.', names: ['Alimentari Sole', 'Mini Market', 'Frutta & Verdura'] },
    pharmacy: { label: 'Pharmacy', where: 'ground', cost: 9000, rent: 950, hours: [8, 20], bonus: 2, owner: 'Pharmacist', desc: 'The elderly residents are very grateful.', names: ['Farmacia Centrale', 'Farmacia San Marco'] },
    barber: { label: 'Barber', where: 'ground', cost: 4500, rent: 450, hours: [9, 19], bonus: 1, owner: 'Barber', desc: 'Haircuts, shaves and football talk.', names: ['Barbiere Tony', 'Salone Figaro', 'Forbici d\'Oro'] },
    florist: { label: 'Florist', where: 'ground', cost: 4500, rent: 400, hours: [8, 19], bonus: 2, owner: 'Florist', desc: 'Flowers for weddings, birthdays and apologies.', names: ['Il Girasole', 'Fiori di Maria', 'Petali'] },
    gelateria: { label: 'Gelateria', where: 'ground', cost: 6500, rent: 650, hours: [11, 23], bonus: 2, owner: 'Gelataio', desc: 'Queues in summer, empty in winter.', names: ['Gelateria Polare', 'Cono d\'Oro', 'Dolce Freddo'] },
    dentist: { label: 'Dentist', where: 'upper', cost: 9000, rent: 1050, hours: [9, 18], bonus: -1, owner: 'Dentist', desc: 'Pays well. The drill is heard two floors away.', names: ['Studio Bianchi', 'Sorriso Dental'] },
    gym: { label: 'Gym', where: 'upper', cost: 8000, rent: 800, hours: [7, 22], bonus: 1, owner: 'Personal trainer', desc: 'Fitness fans love it; the neighbours hear the weights drop.', names: ['Iron Gym', 'Power Fit'] },
    detective: { label: 'Private eye', where: 'upper', cost: 6000, rent: 600, hours: [10, 23], bonus: 0, owner: 'Private detective', desc: 'Mysterious and shady tenants get found out twice as fast.', names: ['Agenzia Sherlock', 'Occhio di Lince'] },
    daycare: { label: 'Day care', where: 'upper', cost: 7000, rent: 650, hours: [8, 17], bonus: 1, owner: 'Teacher', desc: 'Families with small children are much happier.', names: ['Arcobaleno', 'Piccoli Passi'] },
    yoga: { label: 'Yoga studio', where: 'upper', cost: 5000, rent: 450, hours: [7, 21], bonus: 2, owner: 'Yoga teacher', desc: 'Calm vibes: fewer quarrels in the building.', names: ['Namasté', 'Loto Blu'] },
    lawyer: { label: 'Law firm', where: 'upper', cost: 7000, rent: 950, hours: [9, 19], bonus: 0, owner: 'Lawyer', desc: 'Feuds between neighbours are easier to settle.', names: ['Studio Legale Conti', 'Avvocati Associati'] },
    bnb: { label: 'B&B', where: 'upper', cost: 8000, rent: 1000, hours: [7, 23], bonus: 0, owner: 'Host', desc: 'Pays well in summer and badly in winter. Tourists with suitcases, and sometimes noise.', names: ['B&B La Terrazza', 'Casa Vacanze Roma', 'Il Nido'] },
    coworking: { label: 'Coworking', where: 'upper', cost: 7000, rent: 800, hours: [8, 20], bonus: 1, owner: 'Community manager', desc: 'Quiet laptops, steady rent. Gamers and remote workers like it.', names: ['Hub 26', 'Spazio Lavoro', 'CoLab Roma'] }
  },
  shopEvents: {
    cafe: ['At {S}, {A} told {B} everything about the neighbours.', '{S} gave away free cornetti for its birthday.', 'Two pensioners argued about football at {S} for three hours.'],
    bakery: ['The smell of fresh bread from {S} woke up the whole building.', '{S} sold out of focaccia by 8 a.m.', 'The baker at {S} made a birthday cake shaped like the building.'],
    pizzeria: ['{S} had a queue down the street tonight.', 'The pizzaiolo of {S} threw a pizza so high it hit the ceiling.', 'A food critic praised {S}. Bookings are full.'],
    grocery: ['{S} put out crates of fresh peaches. The whole building is eating peaches.', 'Someone left the fridge of {S} open all night.', '{S} started home deliveries for the residents.'],
    pharmacy: ['The elderly residents queued at {S} to measure their blood pressure.', '{S} handed out free sunscreen.', 'The pharmacist of {S} recognised a rash from across the street.'],
    barber: ['Half the building got the same haircut at {S}.', 'The barber of {S} sang opera while shaving a customer.'],
    florist: ['{S} decorated the entrance with flowers for free.', 'Someone ordered 99 red roses at {S}. The whole building wants to know for whom.'],
    gelateria: ['{S} invented a new flavour: "Condominio". Nobody knows what is in it.', 'Kids queued at {S} all afternoon.'],
    dentist: ['Screams from {S} echoed through the stairwell.', 'The dentist of {S} offered free check-ups to the residents.'],
    gym: ['Somebody dropped a 100 kg weight at {S}. The chandeliers downstairs swung.', '{S} held a spinning marathon with very loud music.'],
    detective: ['The detective of {S} was seen following someone with a newspaper with two holes in it.', '{S} found a lost cat for the neighbours.'],
    daycare: ['The children of {S} sang a song in the courtyard.', '{S} held a finger-painting day. The stairs are now very colourful.'],
    yoga: ['A group meditation at {S} made the building unusually quiet.', 'Someone fell asleep in savasana at {S} and stayed until closing.'],
    lawyer: ['The lawyer of {S} offered free advice to the residents.', '{S} won a big case. Champagne on the stairs.'],
    bnb: ['A group of tourists at {S} sang until 2 a.m. in four languages.', 'Tourists from {S} asked {A} for directions to the Colosseum. Twice.', '{S} got a five-star review: "Lovely building, very lively neighbours."'],
    coworking: ['A startup at {S} raised a million euros. They bought pizza for the whole building.', 'Someone at {S} held a video call from the balcony, very loudly.']
  },

  // Common spaces built in a slot instead of a home or a shop: they help the whole building.
  commons: {
    laundry: { label: 'Laundry room', cost: 3000, where: 'any', desc: 'Washing machines for everyone: residents a bit happier, families with children much happier.' },
    commonroom: { label: 'Common room', cost: 4000, where: 'any', desc: 'Sofas and a ping-pong table: neighbours get along better and you can organise events twice as often.' },
    playroom: { label: 'Kids\' playroom', cost: 3500, where: 'any', desc: 'Toys and a slide: families with children are much happier and more likely to stay.' },
    storage: { label: 'Cellars & bike room', cost: 2500, where: 'ground', desc: 'A cellar for every family: small extra rent every week, and fewer bikes on the stairs.' }
  },
  // Looks of the building: colour of the facade, roof and railings, and the name plate.
  looks: {
    facade: { label: 'Facade', cost: 3000, opts: [['Peach', '#f0b27a'], ['Ochre', '#e0b050'], ['Pink', '#f0a0a0'], ['Mint', '#a8d8b8'], ['Sky', '#a8c8e8'], ['Cream', '#f0e4c8'], ['Brick', '#c06848']] },
    roof: { label: 'Roof and floors', cost: 2500, opts: [['Terracotta', '#c8553d'], ['Brown', '#8a5a3a'], ['Slate', '#5a6070'], ['Copper', '#4a9a80']] },
    rail: { label: 'Railings', cost: 2000, opts: [['Iron', '#3a2a2a'], ['White', '#e8e8e8'], ['Brass', '#c09040'], ['Green', '#2a6a3a']] },
    name: { label: 'Name plate', cost: 300, opts: [['Via Roma 26'], ['Palazzo Pina'], ['Residenza Aurora'], ['Condominio Sole'], ['Villa Margherita'], ['Casa Felice']] }
  },

  // Short lines shown in speech bubbles inside the building (pixel font: keep them short, no accents).
  say: {
    good: ['Come in, come in!', 'You are an angel', 'Thanks, neighbour!', 'Coffee?', 'How kind of you!', 'Lovely to see you', 'Anytime!'],
    thanks: ['Thank you!', 'Grazie mille!', "You shouldn't have", 'So sweet!'],
    angry: ['Unbelievable!', 'Not again!', 'I will call the police!', 'Have some respect!', 'Every single day!', 'Shame on you!'],
    reply: ['Mind your business!', 'Oh, calm down!', 'Whatever...', "It wasn't me!", 'Says who?'],
    need: { 'B:music': 'Turn it down!', 'B:dog': 'Shut that dog up!', 'B:smoker': 'No smoking!', 'B:diy': 'It is Sunday!', 'B:above': 'My balcony is wet!', 'B:cat': 'Your cat again!', gossip: 'Did you hear...', moaner: 'I wrote a letter!' },
    feud: ['You again?!', 'Get out of my sight!', 'See you in court!', 'Never speak to me!'],
    request: { bigger: 'We need more room!', stairs: 'These stairs...', away: "I can't stand them!", shop: 'If only we had a shop', kitchen: 'My poor kitchen!', pet: 'Can we have a dog?', upgrade: 'We signed a petition', terrace: 'A terrace, please!', neon: 'Nobody sees us!' }
  },

  hairStyles: ['short', 'long', 'bun', 'bald', 'curly', 'ponytail'],

  // Colours for people and homes.
  skins: ['#f3d2b3', '#e8b88f', '#c98e62', '#a86b44', '#7a4a2e', '#f0c8a0'],
  hairs: ['#2b1d14', '#4a3020', '#7a4a22', '#c8902e', '#e0c070', '#1a1a1a', '#a03018'],
  shirts: ['#d04848', '#4878d0', '#48a858', '#e0a030', '#8848c0', '#30a0a0', '#e070a0', '#f0f0e8', '#506070', '#c06030'],
  pants: ['#304060', '#403830', '#202838', '#605040', '#384858'],
  walls: ['#e8d8b0', '#c8e0d0', '#d8d0e8', '#f0d0c0', '#d0e0f0', '#e8e0c8', '#f0e0a8', '#c8d8b8', '#e8c8d0'],
  accents: ['#c04040', '#4060b0', '#40905a', '#b08030', '#8050a0', '#308888', '#c06090']
};
