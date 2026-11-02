// Klatt formant synthesizer (cascade/parallel, after Klatt 1980 / KLGLOTT88).
//
//   glottal source (KLGLOTT88 pulse + spectral tilt) + aspiration noise
//     -> nasal pole/zero -> R5 -> R4 -> R3 -> R2 -> R1          (cascade, vowels and sonorants)
//   frication noise -> A2..A6 parallel resonators + bypass AB    (parallel, fricatives and bursts)
//   sum -> radiation characteristic (first difference) -> output

const Klatt = {
  SR: 22050,
  STEP: 32,   // samples per parameter frame (~1.45 ms)

  // Klatt's dB scale: 6 dB doubles the amplitude, 0 dB = off
  lin(db) { return db <= 1 ? 0 : Math.pow(10, (db - 60) / 20); },

  resonator() { return { a: 0, b: 0, c: 0, y1: 0, y2: 0 }; },

  setRes(r, f, bw, sr) {
    f = Math.min(f, sr * 0.47);
    const T = 1 / sr;
    r.c = -Math.exp(-2 * Math.PI * bw * T);
    r.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
    r.a = 1 - r.b - r.c;
  },

  // Antiresonator: inverse of a resonator (zeros instead of poles)
  setAnti(r, f, bw, sr) {
    this.setRes(r, f, bw, sr);
    r.a0 = 1 / r.a;
    r.b0 = -r.b / r.a;
    r.c0 = -r.c / r.a;
  },

  // Band-pass resonator for the parallel branch: same poles and same peak gain as setRes,
  // plus zeros at 0 Hz and Nyquist, so the noise does not leak outside the band
  setBP(r, f, bw, sr) {
    this.setRes(r, f, bw, sr);
    const w0 = 2 * Math.PI * Math.min(f, sr * 0.47) / sr;
    r.g = r.a / (2 * Math.sin(w0));
    r.x1 = r.x1 || 0;
    r.x2 = r.x2 || 0;
  },

  stepBP(r, x) {
    const y = r.g * (x - r.x2) + r.b * r.y1 + r.c * r.y2;
    r.x2 = r.x1; r.x1 = x;
    r.y2 = r.y1; r.y1 = y;
    return y;
  },

  // voice: { oq, tilt, breath, jitter, shimmer, fscale }
  render(fr, voice) {
    const sr = this.SR, step = this.STEP;
    const out = new Float32Array(fr.n * step);
    const T = fr.tracks;

    const r1 = this.resonator(), r2 = this.resonator(), r3 = this.resonator(), r4 = this.resonator(), r5 = this.resonator();
    const rnp = this.resonator(), rnz = this.resonator();
    const p2 = this.resonator(), p3 = this.resonator(), p4 = this.resonator(), p5 = this.resonator(), p6 = this.resonator();
    const F4 = 3300 * voice.fscale, F5 = 3750 * voice.fscale;
    this.setRes(r4, F4, 250, sr);
    this.setRes(r5, F5, 200, sr);
    this.setRes(rnp, 270, 100, sr);
    this.setBP(p4, F4, 250, sr);
    this.setBP(p5, F5, 300, sr);
    // The bypass path (f, v, th, p, b) is a broad band around 3.5 kHz instead of raw white noise
    const pb = this.resonator();
    this.setBP(pb, 3500 * voice.fscale, 3500, sr);

    // Spectral tilt: one-pole low-pass on the glottal pulse
    const tiltA = Math.exp(-2 * Math.PI * Math.max(200, 3000 - voice.tilt * 220) / sr);

    let period = 0, pos = 0, nopen = 1, pulseAmp = 1;
    let tiltY = 0, nLast = 0, zx1 = 0, zx2 = 0, radPrev = 0;
    // Gentle low-pass on the output: tames the digital hiss of the noise above ~7 kHz
    const lpA = Math.exp(-2 * Math.PI * 7000 / sr);
    let lp1 = 0, lp2 = 0;
    // xorshift32 (exact 32-bit integer math): uniform in [-1, 1)
    let seed = 2463534242;
    const rand = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) / 2147483648 - 1;
    };
    // Near-Gaussian noise (sum of 4 uniforms, as in Klatt's generator), same variance as one uniform
    const gauss = () => 0.5 * (rand() + rand() + rand() + rand());

    let prevAv = 0, prevAh = 0, prevAf = 0;
    for (let f = 0; f < fr.n; f++) {
      // Per-frame filter coefficients
      this.setRes(r1, T.f1[f], T.b1[f], sr);
      this.setRes(r2, T.f2[f], T.b2[f], sr);
      this.setRes(r3, T.f3[f], T.b3[f], sr);
      this.setAnti(rnz, T.fnz[f], 100, sr);
      this.setBP(p2, T.f2[f], Math.max(T.b2[f], 150), sr);
      this.setBP(p3, T.f3[f], Math.max(T.b3[f], 200), sr);
      this.setBP(p6, T.f6[f], 1000, sr);
      const av = this.lin(T.av[f]), ah = this.lin(T.ah[f]) * 0.6 + voice.breath * this.lin(T.av[f]) * 0.6;
      const af = this.lin(T.af[f]);
      const g2 = this.lin(T.a2[f]) * 0.6, g3 = this.lin(T.a3[f]) * 0.4, g4 = this.lin(T.a4[f]) * 0.3;
      const g5 = this.lin(T.a5[f]) * 0.25, g6 = this.lin(T.a6[f]) * 0.3, gb = this.lin(T.ab[f]) * 0.12;
      const f0 = T.f0 ? T.f0[f] : fr.f0[f];

      for (let s = 0; s < step; s++) {
        const x = s / step;
        const avS = prevAv + (av - prevAv) * x;
        const ahS = prevAh + (ah - prevAh) * x;
        const afS = prevAf + (af - prevAf) * x;

        // ---- Glottal source: KLGLOTT88 flow pulse, new period at each cycle ----
        if (pos >= period) {
          pos = 0;
          const jit = 1 + voice.jitter * rand();
          period = sr / (f0 * jit);
          nopen = Math.max(2, voice.oq * period);
          pulseAmp = 1 + voice.shimmer * rand();
        }
        let glot = 0;
        if (pos < nopen) {
          const u = pos / nopen;
          glot = 6.75 * u * u * (1 - u) * pulseAmp;   // peak = 1 at u = 2/3
        }
        const open = pos < nopen;
        pos++;
        tiltY = (1 - tiltA) * glot + tiltA * tiltY;

        // ---- Noise (slightly low-passed, as in Klatt) ----
        const noise = gauss() + 0.75 * nLast;
        nLast = noise;
        // Aspiration and voiced frication are amplitude-modulated by the glottal cycle
        const mod = avS > 0 && !open ? 0.5 : 1;

        // ---- Cascade branch ----
        let x0 = avS * tiltY * 9 + ahS * noise * mod * 0.5;
        // Nasal pole/zero pair (cancel each other when fnz == 270)
        let y = rnp.a * x0 + rnp.b * rnp.y1 + rnp.c * rnp.y2; rnp.y2 = rnp.y1; rnp.y1 = y;
        const z = rnz.a0 * y + rnz.b0 * zx1 + rnz.c0 * zx2; zx2 = zx1; zx1 = y; y = z;
        y = this.step(r5, y); y = this.step(r4, y); y = this.step(r3, y); y = this.step(r2, y); y = this.step(r1, y);
        const casc = y;

        // ---- Parallel (frication) branch ----
        const fric = afS * noise * mod;
        const par = g2 * this.stepBP(p2, fric) - g3 * this.stepBP(p3, fric) + g4 * this.stepBP(p4, fric)
                  - g5 * this.stepBP(p5, fric) + g6 * this.stepBP(p6, fric) + gb * this.stepBP(pb, fric);

        // ---- Radiation characteristic ----
        const sum = casc + par;
        lp1 = (1 - lpA) * (sum - radPrev) + lpA * lp1;
        lp2 = (1 - lpA) * lp1 + lpA * lp2;
        out[f * step + s] = lp2;
        radPrev = sum;
      }
      prevAv = av; prevAh = ah; prevAf = af;
    }
    return out;
  },

  step(r, x) {
    const y = r.a * x + r.b * r.y1 + r.c * r.y2;
    r.y2 = r.y1;
    r.y1 = y;
    return y;
  },

  // Peak-normalize with short fades at both ends
  normalize(buf, peak = 0.85) {
    let m = 0;
    for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
    const g = m > 1e-9 ? peak / m : 0;
    const fade = Math.min(200, buf.length >> 1);
    for (let i = 0; i < buf.length; i++) {
      let w = 1;
      if (i < fade) w = i / fade; else if (i > buf.length - fade) w = (buf.length - i) / fade;
      buf[i] *= g * w;
    }
    return buf;
  }
};
