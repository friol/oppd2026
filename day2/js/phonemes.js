// Phoneme inventory for the Klatt synthesizer (shared by Italian and English).
// Values follow Klatt (1980) where available, adult male vocal tract.
//
// t     type: V vowel, D diphthong, G glide, L liquid, N nasal, F fricative,
//             S stop, A affricate, H aspirate, T tap (Italian r)
// f, b  F1..F3 targets and bandwidths (Hz); to = F1..F3 end target of a diphthong
// inh, min   inherent / minimum duration in ms (Klatt duration rules)
// av    voicing amplitude (dB); voiced consonants use a lower value
// fr    frication spectrum: parallel amplitudes in dB { a2, a3, a4, a5, a6, ab } and optional f6
// burst burst spectrum of stops (same shape as fr); asp = aspirated in English
// place locus class for stops/affricates: lab, alv, pal, vel

const DEFAULT_B = [70, 100, 160];

const Phonemes = {
  // ---------- Italian vowels ----------
  a:  { t: 'V', f: [750, 1300, 2500], inh: 170, min: 60 },
  e:  { t: 'V', f: [420, 2050, 2650], inh: 160, min: 55 },
  E:  { t: 'V', f: [560, 1800, 2500], inh: 170, min: 60 },
  i:  { t: 'V', f: [290, 2250, 2950], b: [50, 100, 200], inh: 150, min: 50 },
  o:  { t: 'V', f: [450, 850, 2400], inh: 160, min: 55 },
  O:  { t: 'V', f: [580, 950, 2450], inh: 170, min: 60 },
  u:  { t: 'V', f: [300, 750, 2300], b: [50, 90, 160], inh: 150, min: 50 },

  // ---------- English vowels ----------
  IY: { t: 'V', f: [310, 2020, 2960], b: [45, 200, 400], inh: 155, min: 55 },
  IH: { t: 'V', f: [400, 1800, 2570], b: [50, 100, 140], inh: 135, min: 40 },
  EH: { t: 'V', f: [530, 1680, 2500], b: [60, 90, 200], inh: 150, min: 70 },
  AE: { t: 'V', f: [620, 1660, 2430], b: [70, 150, 320], inh: 230, min: 80 },
  AA: { t: 'V', f: [700, 1220, 2600], b: [130, 70, 160], inh: 240, min: 100 },
  AO: { t: 'V', f: [600, 990, 2570], b: [90, 100, 80], inh: 240, min: 100 },
  AH: { t: 'V', f: [620, 1220, 2550], b: [80, 50, 140], inh: 140, min: 60 },
  UH: { t: 'V', f: [450, 1100, 2350], b: [80, 100, 80], inh: 160, min: 60 },
  ER: { t: 'V', f: [470, 1270, 1540], b: [100, 60, 110], inh: 180, min: 80 },
  AX: { t: 'V', f: [500, 1400, 2300], b: [100, 60, 110], inh: 120, min: 60 },
  EY: { t: 'D', f: [480, 1720, 2520], to: [330, 2200, 2600], b: [70, 100, 200], inh: 190, min: 100 },
  AY: { t: 'D', f: [660, 1200, 2550], to: [400, 1880, 2500], b: [100, 70, 200], inh: 250, min: 150 },
  AW: { t: 'D', f: [640, 1230, 2550], to: [420, 940, 2350], b: [80, 70, 140], inh: 260, min: 100 },
  OY: { t: 'D', f: [550, 960, 2400], to: [360, 1820, 2450], b: [60, 50, 130], inh: 280, min: 150 },
  OW: { t: 'D', f: [540, 1100, 2300], to: [450, 900, 2300], b: [80, 70, 70], inh: 220, min: 80 },
  UW: { t: 'D', f: [350, 1250, 2200], to: [320, 900, 2200], b: [65, 110, 140], inh: 210, min: 70 },

  // ---------- Glides and liquids ----------
  W:  { t: 'G', f: [290, 610, 2150], b: [50, 80, 60], inh: 80, min: 60, av: 56 },
  Y:  { t: 'G', f: [260, 2070, 3020], b: [40, 250, 500], inh: 80, min: 40, av: 56 },
  R:  { t: 'L', f: [310, 1060, 1380], b: [70, 100, 120], inh: 80, min: 30, av: 56 },
  L:  { t: 'L', f: [310, 1050, 2880], b: [50, 100, 280], inh: 80, min: 40, av: 56 },
  Ll: { t: 'L', f: [360, 1500, 2800], b: [50, 100, 280], inh: 70, min: 40, av: 56 },   // Italian clear l
  LY: { t: 'L', f: [300, 1950, 2750], b: [50, 120, 280], inh: 90, min: 60, av: 56 },   // Italian "gli"
  r:  { t: 'T', f: [400, 1350, 2500], b: [80, 120, 200], inh: 50, min: 35, av: 56 },   // Italian tap

  // ---------- Nasals ----------
  M:  { t: 'N', f: [480, 1270, 2130], b: [40, 200, 200], inh: 70, min: 50, av: 54 },
  N:  { t: 'N', f: [480, 1340, 2470], b: [40, 300, 300], inh: 60, min: 30, av: 54 },
  NG: { t: 'N', f: [480, 2000, 2900], b: [40, 300, 300], inh: 95, min: 60, av: 54 },
  NY: { t: 'N', f: [480, 2100, 2850], b: [40, 250, 300], inh: 80, min: 50, av: 54 },

  // ---------- Fricatives ----------
  F:  { t: 'F', f: [340, 1100, 2080], b: [200, 120, 150], inh: 100, min: 80, fr: { ab: 50 } },
  V:  { t: 'F', f: [220, 1100, 2080], b: [60, 90, 120], inh: 60, min: 40, av: 47, fr: { ab: 45 } },
  TH: { t: 'F', f: [320, 1290, 2540], b: [200, 90, 200], inh: 90, min: 60, fr: { a6: 28, ab: 45 } },
  DH: { t: 'F', f: [270, 1290, 2540], b: [60, 80, 170], inh: 50, min: 30, av: 47, fr: { a6: 24, ab: 40 } },
  S:  { t: 'F', f: [320, 1390, 2530], b: [200, 80, 200], inh: 105, min: 60, fr: { a5: 29, a6: 42, f6: 5000 } },
  Z:  { t: 'F', f: [240, 1390, 2530], b: [70, 60, 180], inh: 75, min: 40, av: 47, fr: { a5: 26, a6: 39, f6: 5000 } },
  SH: { t: 'F', f: [300, 1840, 2750], b: [200, 100, 300], inh: 105, min: 80, fr: { a3: 52, a4: 45, a5: 43, a6: 41 } },
  ZH: { t: 'F', f: [300, 1840, 2750], b: [70, 60, 280], inh: 70, min: 40, av: 47, fr: { a3: 48, a4: 41, a5: 39, a6: 37 } },
  HH: { t: 'H', f: null, inh: 80, min: 20 },

  // ---------- Stops (closure + burst [+ aspiration]) ----------
  P:  { t: 'S', place: 'lab', inh: 90, min: 50, asp: true, burst: { ab: 63 } },
  B:  { t: 'S', place: 'lab', inh: 85, min: 60, av: 42, burst: { ab: 58 } },
  T:  { t: 'S', place: 'alv', inh: 75, min: 50, asp: true, burst: { a4: 48, a5: 54, a6: 58 } },
  D:  { t: 'S', place: 'alv', inh: 75, min: 50, av: 42, burst: { a4: 45, a5: 50, a6: 52 } },
  K:  { t: 'S', place: 'vel', inh: 80, min: 60, asp: true, burst: { a2: 48, a3: 57, a4: 46 } },
  G:  { t: 'S', place: 'vel', inh: 80, min: 60, av: 42, burst: { a2: 46, a3: 53, a4: 42 } },

  // ---------- Affricates (closure + fricative release) ----------
  CH: { t: 'A', place: 'pal', inh: 90, min: 60, rel: 'SH' },
  JH: { t: 'A', place: 'pal', inh: 90, min: 60, av: 42, rel: 'ZH' },
  TS: { t: 'A', place: 'alv', inh: 90, min: 60, rel: 'S' },
  DZ: { t: 'A', place: 'alv', inh: 90, min: 60, av: 42, rel: 'Z' }
};

// Formant loci of the stop closures (F2/F3 of velars come from the neighbouring vowel)
const STOP_LOCI = {
  lab: [200, 900, 2100],
  alv: [200, 1700, 2600],
  pal: [250, 1950, 2750],
  vel: [250, 1500, 2300]
};

function isVowel(ph) {
  const p = Phonemes[ph];
  return !!p && (p.t === 'V' || p.t === 'D');
}
