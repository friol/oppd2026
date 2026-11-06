// Tetraphon / Octaphon game rules: sequence growth, expected pad and tempo. No DOM, loads in Node too.
const Game = (() => {
  const START_STEP = 640;  // ms between two notes of the first rounds
  const MIN_STEP = 180;    // fastest tempo
  const SPEEDUP = 0.93;    // each extra note makes the step this much shorter
  const ON_RATIO = 0.62;   // part of the step a pad stays lit while the sequence is shown
  const TIMEOUT = 4000;    // ms the player may wait before the next press
  const MAX_REPEAT = 2;    // never more than this many equal pads in a row

  // Time between two notes when the sequence has `len` notes
  function stepTime(len) {
    return Math.max(MIN_STEP, START_STEP * Math.pow(SPEEDUP, Math.max(0, len - 1)));
  }

  // Pad the player must press as k-th input; reverse mode walks the sequence backwards
  function expected(seq, mode, k) {
    return mode === 'reverse' ? seq[seq.length - 1 - k] : seq[k];
  }

  // Random pad out of `pads` (4 Tetraphon, 8 Octaphon) to append, avoiding long runs of the same pad
  function nextPad(seq, rnd = Math.random, pads = 4) {
    const n = seq.length;
    let run = n >= MAX_REPEAT;
    for (let i = 1; run && i <= MAX_REPEAT; i++) run = seq[n - i] === seq[n - 1];
    let p = Math.floor(rnd() * (run ? pads - 1 : pads));
    if (run && p >= seq[n - 1]) p++;
    return p;
  }

  // Achievements: completing a sequence of `len` notes, unlocked separately in each mode
  const ACHIEVEMENTS = [
    { len: 5, title: 'Not bad' },
    { len: 10, title: 'Very good' },
    { len: 15, title: 'Mastermind' },
    { len: 20, title: 'Virtuoso' },
    { len: 25, title: 'Photographic memory' },
    { len: 30, title: 'Superhuman' },
    { len: 40, title: 'Living legend' },
    { len: 50, title: 'Beyond all voices' }
  ];

  // Achievements earned by completing a sequence of `len` notes that are not in `have` yet
  function earned(len, have) {
    return ACHIEVEMENTS.filter(a => a.len <= len && !have[a.len]);
  }

  // First achievement still to reach after a best of `len`
  function nextAchievement(len) {
    return ACHIEVEMENTS.find(a => a.len > len) || null;
  }

  return { stepTime, expected, nextPad, earned, nextAchievement, ACHIEVEMENTS, ON_RATIO, TIMEOUT };
})();

if (typeof module !== 'undefined') module.exports = Game;
