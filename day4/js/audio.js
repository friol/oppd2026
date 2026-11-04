// Synthesized sound effects (Web Audio, no sound files needed).
const Sfx = {
  ctx: null,
  muted: false,

  // Must be called from a user gesture: browsers keep audio suspended until then.
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggle() {
    this.muted = !this.muted;
    return this.muted;
  },

  tone(freq, dur, type = 'sine', vol = 0.08, slideTo = 0, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },

  step() { this.tone(620 + Math.random() * 60, 0.05, 'sine', 0.035); },
  tick(sec) { this.tone(sec <= 3 ? 1320 : 880, 0.07, 'square', 0.04); },
  start() { this.tone(110, 0.9, 'sine', 0.12, 330); },
  win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => this.tone(f, 0.6, 'triangle', 0.12, 0, k * 0.12)); },
  lose() { this.tone(300, 1.4, 'sawtooth', 0.08, 60); }
};
