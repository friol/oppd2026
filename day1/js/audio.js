// Synthesized sound effects (Web Audio, no sound files needed).
const Sfx = {
  ctx: null,
  muted: false,
  silent: false, // true during the demo mode (sound effects only, the demo has its own music)

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.ctx = new AC();
  },

  tone(freq, dur, type = 'square', vol = 0.08, slideTo = 0, delay = 0) {
    if (!this.ctx || this.muted || this.silent) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },

  paddle() { this.tone(440, 0.08, 'square', 0.07); },
  cpu() { this.tone(220, 0.1, 'sawtooth', 0.06); },
  wall() { this.tone(660, 0.04, 'triangle', 0.06); },
  brick() { this.tone(880, 0.06, 'square', 0.05); },
  hardBrick() { this.tone(330, 0.08, 'triangle', 0.08); },
  powerup() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.08, 'square', 0.05, 0, i * 0.06)); },
  laser() { this.tone(1400, 0.07, 'square', 0.035, 500); },
  explode() { this.tone(200, 0.6, 'sawtooth', 0.12, 30); this.tone(120, 0.5, 'square', 0.08, 25, 0.05); },
  levelStart() {
    // Short fanfare: square-wave melody over a triangle bass line
    const lead = [[392, 0, 0.1], [523, 0.12, 0.1], [659, 0.24, 0.1], [784, 0.36, 0.2], [659, 0.6, 0.1],
                  [784, 0.72, 0.1], [880, 0.84, 0.1], [784, 0.96, 0.1], [1047, 1.08, 0.5]];
    const bass = [[131, 0, 0.5], [98, 0.6, 0.4], [131, 1.08, 0.6]];
    lead.forEach(([f, t, d]) => this.tone(f, d, 'square', 0.05, 0, t));
    bass.forEach(([f, t, d]) => this.tone(f, d, 'triangle', 0.1, 0, t));
  },
  levelClear() { [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 'square', 0.06, 0, i * 0.12)); },
  loseLife() {
    // Dramatic descending chromatic phrase ending in a falling slide, over a sinking bass
    [[659, 0.15], [622, 0.35], [587, 0.55]].forEach(([f, t]) => this.tone(f, 0.18, 'square', 0.06, 0, t));
    this.tone(554, 0.7, 'square', 0.06, 220, 0.75);
    [[165, 0.15], [156, 0.55], [110, 0.75]].forEach(([f, t], i) => this.tone(f, i < 2 ? 0.38 : 0.7, 'triangle', 0.14, 0, t));
  },
  gameOver() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.1, 0, i * 0.25)); },
  freeze() {
    this.tone(400, 0.4, 'triangle', 0.08, 1800);
    [2093, 2637, 3136].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.04, 0, 0.3 + i * 0.06));
  },
  shatter() { [3136, 2093, 2637, 1760, 2349].forEach((f, i) => this.tone(f, 0.08, 'triangle', 0.05, 0, i * 0.035)); },
  cpuShot() { this.tone(300, 0.2, 'sawtooth', 0.05, 120); this.tone(900, 0.06, 'square', 0.03, 400); },
  warp() {
    this.tone(150, 0.8, 'sawtooth', 0.06, 1800);
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.1, 'square', 0.04, 0, 0.3 + i * 0.08));
  },
  steel() { this.tone(1800, 0.05, 'square', 0.03, 900); this.tone(180, 0.1, 'triangle', 0.1, 90); },
  alienShot() { this.tone(700, 0.12, 'square', 0.025, 250); },
  alienDie() { this.tone(500, 0.25, 'sawtooth', 0.06, 60); this.tone(1200, 0.08, 'square', 0.03, 300); },
  select() { this.tone(988, 0.05, 'square', 0.05); }
};

// Background tunes, one per level. Each song has 8 bars of 16 steps (16th notes).
// bassRoots: MIDI root note per bar; lead: per bar, [step, midi note, length in steps];
// drums: 16-step patterns ('x' = hit); arp: optional chord shape per bar for fast arpeggios.
const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];
const SONGS = [
  {
    // Level 1: upbeat A minor pop (Am - F - C - G)
    bpm: 140,
    leadWave: 'square',
    bassStyle: 'pump',
    bassRoots: [45, 41, 48, 43, 45, 41, 48, 43],
    drums: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    lead: [
      [[0, 69, 2], [2, 72, 2], [4, 76, 2], [6, 81, 2], [8, 79, 2], [10, 76, 2], [12, 72, 2], [14, 76, 2]],
      [[0, 77, 4], [4, 76, 2], [6, 72, 2], [8, 69, 4], [12, 72, 2], [14, 77, 2]],
      [[0, 79, 3], [3, 76, 3], [6, 72, 2], [8, 76, 2], [10, 79, 2], [12, 84, 4]],
      [[0, 83, 2], [2, 79, 2], [4, 74, 2], [6, 79, 2], [8, 83, 4], [12, 81, 2], [14, 79, 2]],
      [[0, 88, 4], [4, 84, 2], [6, 81, 2], [8, 88, 2], [10, 86, 2], [12, 84, 2], [14, 83, 2]],
      [[0, 81, 6], [6, 84, 2], [8, 89, 4], [12, 88, 2], [14, 84, 2]],
      [[0, 79, 2], [2, 84, 2], [4, 88, 4], [8, 86, 2], [10, 84, 2], [12, 79, 4]],
      [[0, 83, 2], [2, 86, 2], [4, 91, 4], [8, 88, 2], [10, 86, 2], [12, 83, 4]]
    ]
  },
  {
    // Level 2: C64 SID style in E minor with fast chord arpeggios (Em - C - D - Bm)
    bpm: 150,
    leadWave: 'square',
    bassStyle: 'gallop',
    bassRoots: [40, 36, 38, 35, 40, 36, 38, 35],
    arp: [MINOR, MAJOR, MAJOR, MINOR, MINOR, MAJOR, MAJOR, MINOR],
    drums: { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
    lead: [
      [[0, 76, 6], [6, 79, 2], [8, 83, 6], [14, 81, 2]],
      [[0, 79, 4], [4, 76, 4], [8, 72, 6], [14, 74, 2]],
      [[0, 74, 2], [2, 78, 2], [4, 81, 4], [8, 78, 2], [10, 74, 2], [12, 69, 4]],
      [[0, 71, 6], [6, 74, 2], [8, 78, 8]],
      [[0, 88, 4], [4, 86, 2], [6, 83, 2], [8, 79, 4], [12, 83, 4]],
      [[0, 84, 6], [6, 83, 2], [8, 79, 4], [12, 76, 4]],
      [[0, 81, 2], [2, 83, 2], [4, 86, 4], [8, 90, 4], [12, 86, 4]],
      [[0, 83, 8], [8, 78, 4], [12, 74, 4]]
    ]
  },
  {
    // Level 3: fast 16-bit console style in D minor with a sawtooth lead (Dm - Bb - C - A)
    bpm: 165,
    leadWave: 'sawtooth',
    bassStyle: 'octaves',
    bassRoots: [38, 34, 36, 33, 38, 34, 36, 33],
    drums: { kick: 'x...x...x...x.x.', snare: '....x.......x..x', hat: '..x...x...x...x.' },
    lead: [
      [[0, 74, 2], [2, 77, 2], [4, 81, 2], [6, 86, 3], [9, 84, 1], [10, 81, 2], [12, 77, 2], [14, 81, 2]],
      [[0, 82, 4], [4, 81, 2], [6, 77, 2], [8, 74, 4], [12, 77, 4]],
      [[0, 79, 2], [2, 84, 2], [4, 88, 3], [7, 86, 1], [8, 84, 2], [10, 79, 2], [12, 76, 4]],
      [[0, 81, 3], [3, 85, 3], [6, 88, 2], [8, 85, 2], [10, 81, 2], [12, 76, 2], [14, 73, 2]],
      [[0, 86, 1], [1, 86, 1], [2, 86, 2], [4, 89, 2], [6, 86, 2], [8, 93, 4], [12, 89, 2], [14, 86, 2]],
      [[0, 82, 2], [2, 86, 2], [4, 89, 4], [8, 86, 2], [10, 82, 2], [12, 77, 4]],
      [[0, 84, 2], [2, 88, 2], [4, 91, 4], [8, 88, 2], [10, 84, 2], [12, 79, 4]],
      [[0, 85, 4], [4, 88, 4], [8, 81, 4], [12, 85, 2], [14, 88, 2]]
    ]
  },
  {
    // Level 4: Space Invaders. The bass is the arcade's famous descending four-note march,
    // under an eerie E minor melody with arpeggios (Em - Em - C - D)
    bpm: 128,
    leadWave: 'square',
    bassStyle: 'march',
    march: [40, 38, 36, 35],
    bassRoots: [40, 40, 36, 38, 40, 40, 36, 38],
    arp: [MINOR, MINOR, MAJOR, MAJOR, MINOR, MINOR, MAJOR, MAJOR],
    arpEvery: 2,
    drums: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    lead: [
      [[0, 76, 4], [4, 79, 4], [8, 83, 6], [14, 81, 2]],
      [[0, 79, 2], [2, 78, 2], [4, 76, 8], [12, 71, 4]],
      [[0, 72, 4], [4, 76, 4], [8, 79, 4], [12, 84, 4]],
      [[0, 83, 6], [6, 81, 2], [8, 78, 8]],
      [[0, 88, 2], [2, 86, 2], [4, 83, 4], [8, 88, 4], [12, 91, 4]],
      [[0, 90, 2], [2, 88, 2], [4, 83, 8], [12, 79, 4]],
      [[0, 84, 4], [4, 88, 4], [8, 91, 4], [12, 88, 4]],
      [[0, 86, 8], [8, 81, 4], [12, 78, 4]]
    ]
  },
  {
    // Demo mode: slow, soft and dreamy (Dm - G - C - Am), triangle waves only, no kick or snare
    bpm: 96,
    gain: 0.7,
    leadWave: 'triangle',
    leadVol: 0.07,
    bassStyle: 'long',
    bassRoots: [38, 43, 48, 45, 38, 43, 48, 45],
    arp: [MINOR, MAJOR, MAJOR, MINOR, MINOR, MAJOR, MAJOR, MINOR],
    arpWave: 'triangle',
    arpVol: 0.045,
    arpEvery: 2,
    drums: { kick: '................', snare: '................', hat: '..x...x...x...x.' },
    lead: [
      [[0, 74, 6], [8, 77, 4], [12, 76, 4]],
      [[0, 74, 8], [8, 71, 8]],
      [[0, 72, 6], [8, 76, 4], [12, 79, 4]],
      [[0, 76, 12], [12, 72, 4]],
      [[0, 81, 6], [8, 77, 4], [12, 79, 4]],
      [[0, 79, 8], [8, 74, 8]],
      [[0, 76, 4], [4, 79, 4], [8, 84, 8]],
      [[0, 81, 12], [12, 76, 4]]
    ]
  },
  {
    // Victory: triumphant C major fanfare (C - F - G - C - Am - F - G - C)
    bpm: 132,
    leadWave: 'square',
    bassStyle: 'pump',
    bassRoots: [48, 41, 43, 48, 45, 41, 43, 48],
    arp: [MAJOR, MAJOR, MAJOR, MAJOR, MINOR, MAJOR, MAJOR, MAJOR],
    arpEvery: 2,
    drums: { kick: 'x.......x.x.....', snare: '....x.......x.xx', hat: 'x.x.x.x.x.x.x.x.' },
    lead: [
      [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 84, 6], [12, 79, 2], [14, 84, 2]],
      [[0, 81, 4], [4, 77, 2], [6, 81, 2], [8, 84, 6], [14, 81, 2]],
      [[0, 83, 2], [2, 79, 2], [4, 74, 2], [6, 79, 2], [8, 83, 4], [12, 86, 4]],
      [[0, 88, 8], [8, 84, 4], [12, 79, 4]],
      [[0, 81, 2], [2, 84, 2], [4, 88, 4], [8, 86, 2], [10, 84, 2], [12, 81, 4]],
      [[0, 77, 2], [2, 81, 2], [4, 84, 4], [8, 89, 4], [12, 88, 2], [14, 86, 2]],
      [[0, 86, 4], [4, 83, 2], [6, 86, 2], [8, 91, 6], [14, 89, 2]],
      [[0, 88, 12], [12, 84, 4]]
    ]
  }
];
const DEMO_SONG = 4;
const WIN_SONG = 5;

// Looping 8-bit background music: square/saw lead, triangle bass, square arpeggios and noise drums.
// A small look-ahead scheduler queues notes slightly ahead of time for steady timing.
const Music = {
  song: SONGS[0],
  step: 0,
  nextTime: 0,
  timer: null,
  bus: null,
  noise: null,

  setup() {
    const ctx = Sfx.ctx;
    if (!ctx || this.bus) return;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.55;
    this.bus.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  },

  freq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  },

  note(midi, t, dur, type, vol) {
    const ctx = Sfx.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(this.freq(midi), t);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.setValueAtTime(vol, t + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.bus);
    osc.start(t);
    osc.stop(t + dur);
  },

  drum(kind, t) {
    const ctx = Sfx.ctx;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      osc.connect(gain).connect(this.bus);
      osc.start(t);
      osc.stop(t + 0.15);
      return;
    }
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const dur = kind === 'snare' ? 0.12 : 0.03;
    src.buffer = this.noise;
    filter.type = kind === 'snare' ? 'bandpass' : 'highpass';
    filter.frequency.value = kind === 'snare' ? 1800 : 7000;
    gain.gain.setValueAtTime(kind === 'snare' ? 0.25 : 0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.bus);
    src.start(t);
    src.stop(t + dur);
  },

  scheduleStep(i, t) {
    const song = this.song;
    const sixteenth = 60 / song.bpm / 4;
    const bar = Math.floor(i / 16) % song.lead.length;
    const s = i % 16;

    for (const kind of ['kick', 'snare', 'hat']) {
      if (song.drums[kind][s] === 'x') this.drum(kind, t);
    }

    // Bass line: 8th notes alternating root/octave, a galloping 16th rhythm, or 16th octaves
    const root = song.bassRoots[bar];
    if (song.bassStyle === 'pump' && s % 2 === 0) {
      this.note(s % 4 === 0 ? root : root + 12, t, sixteenth * 1.8, 'triangle', 0.22);
    } else if (song.bassStyle === 'gallop' && s % 4 !== 1) {
      this.note(s % 4 === 2 ? root + 12 : root, t, sixteenth * 0.9, 'triangle', 0.24);
    } else if (song.bassStyle === 'octaves') {
      this.note(s % 2 ? root + 12 : root, t, sixteenth * 0.9, 'triangle', 0.24);
    } else if (song.bassStyle === 'march' && s % 4 === 0) {
      this.note(song.march[s / 4], t, sixteenth * 3, 'triangle', 0.3);
    } else if (song.bassStyle === 'long' && s % 8 === 0) {
      this.note(root, t, sixteenth * 7.5, 'triangle', 0.14);
    }

    // Fast chord arpeggio, the classic way to fake chords on a sound chip
    const every = song.arpEvery || 1;
    if (song.arp && s % every === 0) {
      const tone = song.arp[bar][(s / every) % 3];
      this.note(root + 24 + tone, t, sixteenth * every * 0.8, song.arpWave || 'square', song.arpVol || 0.02);
    }

    const vol = song.leadVol || (song.leadWave === 'sawtooth' ? 0.035 : 0.045);
    for (const [at, midi, len] of song.lead[bar]) {
      if (at === s) this.note(midi, t, sixteenth * len * 0.9, song.leadWave, vol);
    }
  },

  tick() {
    const ctx = Sfx.ctx;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.scheduleStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += 60 / this.song.bpm / 4;
    }
  },

  // Selects a song (level index, or DEMO_SONG) and restarts it from the beginning
  reset(index) {
    this.song = SONGS[index];
    this.step = 0;
  },

  // Current playback position in beats (quarter notes), or -1 when the music is not playing.
  // Notes are queued slightly ahead, so the position is derived from the audio clock.
  beat() {
    if (!this.timer) return -1;
    const sixteenth = 60 / this.song.bpm / 4;
    return Math.max(0, this.step - (this.nextTime - Sfx.ctx.currentTime) / sixteenth) / 4;
  },

  // Called every frame: starts or stops the music to match the game state
  update(on) {
    on = on && !Sfx.muted && !!Sfx.ctx;
    if (on && !this.timer) {
      this.setup();
      this.bus.gain.value = 0.55 * (this.song.gain || 1);
      this.step -= this.step % 16; // resume from the start of the current bar
      this.nextTime = Sfx.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
    } else if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
};
