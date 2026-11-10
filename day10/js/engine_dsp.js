'use strict';
// Physically inspired V8 engine sound, computed sample by sample.
// The class is self-contained: audio.js sends its source (EngineDSP.toString()) to an
// AudioWorklet, or runs it in a ScriptProcessor when worklets are not available.
//
//   crankshaft (720 deg cycle, 8 cylinders firing about every 90 deg, slightly uneven
//   like a cross-plane V8, which gives the burble)
//     -> each firing: exhaust blowdown pulse (sharp attack, exponential decay,
//        random strength) carrying turbulent noise, weak and irregular off the
//        throttle, with rare pops
//     -> 8 exhaust runners (tubes of slightly different length: delay + reflection)
//     -> 2 bank collectors -> silencer (resonant tube) -> tailpipe (open-end reflection)
//     -> radiation (high-frequency emphasis), lowpass, DC blocker, soft clip
class EngineDSP {
  constructor(sr) {
    this.sr = sr;
    this.rpm = 1000; this.load = 0.5; this.vol = 0;        // targets, set from outside
    this.cRpm = 1000; this.cLoad = 0.5; this.cVol = 0;     // smoothed per sample
    this.phase = 0;                                         // crank angle in the 720 deg cycle
    this.seed = 12345;
    const tube = metres => {
      const d = Math.max(2, Math.round(sr * metres / 343));
      return { buf: new Float32Array(d), i: 0, lp: 0 };
    };
    this.cyl = [];
    const uneven = [0, 9, -7, 4, 0, -9, 7, -4];             // degrees away from even 90 deg firing
    const banks = [0, 1, 1, 0, 1, 0, 0, 1];                 // cross-plane: banks do not alternate
    for (let c = 0; c < 8; c++) {
      // runners 0.65..1 m long; each cylinder is a little different (trim): that imbalance
      // gives the low "growl" orders
      this.cyl.push({ angle: c * 90 + uneven[c] + 10, bank: banks[c], t: 1e9, len: 1, amp: 0,
        trim: 0.82 + ((c * 5) % 8) / 7 * 0.36,
        runner: tube(0.65 + ((c * 3) % 8) * 0.05) });
    }
    this.coll = [tube(0.6), tube(0.68)];
    this.silencer = tube(2.0);
    this.tail = tube(1.0);
    this.prevX = 0; this.lpOut = 0; this.dcX = 0; this.dcY = 0; this.rumble = 0;
    this.env = 0.05; this.agc = 1;                          // slow loudness levelling
  }

  rand() { // xorshift, 0..1
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  // tube: output = input + k * lowpass(output delayed by the tube length)
  tube(t, x, k, damp) {
    const d = t.buf[t.i];
    t.lp += (d - t.lp) * damp;
    const y = x + k * t.lp;
    t.buf[t.i] = y;
    t.i = (t.i + 1) % t.buf.length;
    return y;
  }

  process(out) {
    const sr = this.sr, cyl = this.cyl;
    for (let n = 0; n < out.length; n++) {
      this.cRpm += (this.rpm - this.cRpm) * 0.0015;
      this.cLoad += (this.load - this.cLoad) * 0.002;
      this.cVol += (this.vol - this.cVol) * 0.002;
      const degPerSample = this.cRpm * 6 / sr;            // rpm / 60 * 360 / sr
      const prev = this.phase;
      let ph = prev + degPerSample, wrapped = false;
      if (ph >= 720) { ph -= 720; wrapped = true; }
      this.phase = ph;

      let bank0 = 0, bank1 = 0;
      for (let c = 0; c < 8; c++) {
        const cy = cyl[c], a = cy.angle;
        if (wrapped ? (prev < a || ph >= a) : (prev < a && ph >= a)) {
          // blowdown pulse: ~55 deg of crank, stronger with load, never two identical
          cy.t = 0;
          cy.len = Math.max(6, 55 / degPerSample);
          const L = this.cLoad;
          let amp = (0.25 + 0.75 * L) * cy.trim * (0.85 + 0.3 * this.rand());
          if (L < 0.3) {
            if (this.rand() < 0.18) amp *= 0.2;               // lean misfire off the throttle
            else if (this.rand() < 0.012 * (this.cRpm / 8000)) amp *= 2.6; // overrun pop
          }
          cy.amp = amp;
        }
        let p = 0;
        if (cy.t < cy.len) {
          const k = cy.t / (cy.len * 0.22);
          const env = k * Math.exp(1 - k);                  // sharp attack, exponential decay
          p = cy.amp * env * (1 + (this.rand() - 0.5) * 0.9); // turbulent gas: noisy pulse
          cy.t++;
        }
        const r = this.tube(cy.runner, p, -0.5, 0.6);
        if (cy.bank) bank1 += r; else bank0 += r;
      }
      const c0 = this.tube(this.coll[0], bank0 * 0.3, 0.35, 0.45);
      const c1 = this.tube(this.coll[1], bank1 * 0.3, 0.35, 0.45);
      const s = this.tube(this.silencer, (c0 + c1) * 0.5, 0.55, 0.3);
      const x = this.tube(this.tail, s, -0.45, 0.45);

      // radiation from the tailpipe: more highs as the gas flow rises
      const bright = 0.12 + 0.28 * this.cLoad;
      let y = x * (1 - bright) + (x - this.prevX) * bright * 3;
      this.prevX = x;
      const fc = 900 + this.cRpm * 0.3 + this.cLoad * 900;
      this.lpOut += (y - this.lpOut) * (1 - Math.exp(-2 * Math.PI * fc / sr));
      y = this.lpOut;
      // low mechanical rumble that follows the crank
      this.rumble += ((this.rand() - 0.5) - this.rumble) * 0.02;
      y += this.rumble * 0.15;
      // DC blocker
      const dc = y - this.dcX + 0.995 * this.dcY;
      this.dcX = y; this.dcY = dc;
      // slow automatic gain: the tube resonances make some rpm much louder than others;
      // level them out (gain 0.6..4, ~0.3 s) but keep the change of timbre
      this.env += (dc * dc - this.env) * 0.00007;
      const want = Math.min(4, Math.max(0.6, 0.08 / Math.sqrt(this.env + 1e-9)));
      this.agc += (want - this.agc) * 0.0001;
      out[n] = Math.tanh(dc * this.agc * 1.6) * this.cVol;
    }
  }
}
if (typeof module !== 'undefined') module.exports = EngineDSP;
