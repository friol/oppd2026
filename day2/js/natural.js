// "Natural" mode: the Klatt synthesizer with the refinements that make rule-based
// speech sound less mechanical:
//
//   LF glottal source (Liljencrants-Fant), shaped by Rd per period: pressed on loud and
//     stressed vowels, laxer on voiced consonants, breathy at the end of phrases
//   microprosody: F0 perturbation after voiceless/voiced obstruents, intrinsic vowel F0,
//     small F0 dip during voiced consonants
//   undershoot (Lindblom 1963): short vowels do not reach their formant targets, and
//     unstressed vowels drift toward the neutral vowel (more in English than in Italian)
//   flutter (KLSYN88): slow quasi-random wander of F0 and amplitude
//   singing: breathy note onsets, singer's formant (F3 pulled toward 2.8 kHz); pitch
//     overshoot and irregular vibrato are done in prosody.js when voice.natural is set

// ---------- LF model: one flow pulse per Rd value, normalized period, peak = 1 ----------
const LF = {
  N: 1024,
  cache: {},

  table(rd) {
    const key = Math.round(Math.min(2.5, Math.max(0.3, rd)) * 20);
    return this.cache[key] || (this.cache[key] = this.build(key / 20));
  },

  // Rd -> Ra, Rk, Rg (Fant 1995), then solve epsilon (return phase) and alpha (zero net flow)
  build(Rd) {
    const N = this.N;
    const ra = (-1 + 4.8 * Rd) / 100, rk = (22.4 + 11.8 * Rd) / 100;
    const rg = 0.25 * rk / (0.11 * Rd / (0.5 + 1.2 * rk) - ra);
    const tp = 1 / (2 * rg), te = tp * (1 + rk), ta = ra;
    let eps = 1 / ta;
    for (let k = 0; k < 40; k++) eps = (1 - Math.exp(-eps * (1 - te))) / ta;
    const wg = Math.PI / tp;
    const ret = t => -(Math.exp(-eps * (t - te)) - Math.exp(-eps * (1 - te))) / (eps * ta);
    // Flow derivative with Ee = 1 (continuity at te fixes E0 for each alpha)
    const deriv = (alpha, t) => t <= te
      ? -Math.exp(alpha * t) * Math.sin(wg * t) / (Math.exp(alpha * te) * Math.sin(wg * te))
      : ret(t);
    // Net flow of one period (a coarser grid is enough to find alpha)
    const M = 256;
    const area = alpha => { let s = 0; for (let i = 0; i < M; i++) s += deriv(alpha, (i + 0.5) / M); return s; };
    // Scan for a sign change, then bisect
    let lo = -20, hi = lo, flo = area(lo);
    for (let a = lo + 1; a <= 150; a++) {
      const fa = area(a);
      if (Math.sign(fa) !== Math.sign(flo)) { hi = a; break; }
      lo = a; flo = fa;
    }
    if (hi === -20) hi = lo;
    for (let k = 0; k < 40 && hi !== lo; k++) {
      const mid = (lo + hi) / 2, fm = area(mid);
      if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else hi = mid;
    }
    const alpha = (lo + hi) / 2;
    // Integrate to flow, remove the residual drift, normalize the peak
    const flow = new Float32Array(N + 1);
    for (let i = 0; i < N; i++) flow[i + 1] = flow[i] + deriv(alpha, (i + 0.5) / N) / N;
    const drift = flow[N];
    let peak = 0;
    for (let i = 0; i <= N; i++) { flow[i] -= drift * i / N; peak = Math.max(peak, flow[i]); }
    for (let i = 0; i <= N; i++) flow[i] /= peak;
    return { flow, te: Math.min(1, te + ta) };
  },

  sample(shape, x) {
    const p = Math.min(1, x) * this.N, i = Math.floor(p), fr = p - i;
    const a = shape.flow[Math.min(i, this.N)], b = shape.flow[Math.min(i + 1, this.N)];
    return a + (b - a) * fr;
  }
};

const HIGH_VOWELS = { i: 1, u: 1, IY: 1, IH: 1, UW: 1, UH: 1 };
const LOW_VOWELS = { a: 1, O: 1, AA: 1, AE: 1, AO: 1 };
const NEUTRAL_F = [500, 1500, 2500];

const Natural = {
  voice: { natural: true, source: 'lf' },

  // ---------- Undershoot and vowel reduction (on segment targets) ----------
  undershoot(segs, phones) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const P = Phonemes[s.label];
      if (!P || P.t !== 'V') continue;
      const ph = phones.find(q => q.ph === s.label && Math.abs(q.t - s.t) < 1e-9);
      if (!ph || ph.sung) continue;
      // Locus: mean of the neighbouring targets that are actually sounding
      const loc = [0, 0, 0];
      let m = 0;
      for (const nb of [segs[i - 1], segs[i + 1]]) {
        if (!nb || (!nb.p.av && !nb.p.af && !nb.p.ah && !nb.label)) continue;
        loc[0] += nb.p.f1; loc[1] += nb.p.f2; loc[2] += nb.p.f3; m++;
      }
      const f = [s.p.f1, s.p.f2, s.p.f3];
      if (!ph.stress && s.label !== 'AX') {
        const red = ph.lang === 'en' ? 0.3 : 0.1;
        for (let k = 0; k < 3; k++) f[k] += (NEUTRAL_F[k] - f[k]) * red;
      }
      if (m) {
        const c = Math.min(0.4, Math.exp(-s.dur / 0.05));
        for (let k = 0; k < 3; k++) f[k] += (loc[k] / m - f[k]) * c * (k === 0 ? 0.5 : 1);
      }
      [s.p.f1, s.p.f2, s.p.f3] = f;
    }
  },

  // ---------- Per-frame refinements: F0, amplitude, source shape, breathiness ----------
  shape(fr, built, voice) {
    const n = fr.n, dt = fr.step / Klatt.SR, T = fr.tracks, phones = built.phones;
    const L = v => Klatt.lin(v), dB = x => x > 0 ? Math.max(0, 60 + 20 * Math.log10(x)) : 0;
    const span = (t0, t1, fn) => {
      for (let i = Math.max(0, Math.ceil(t0 / dt)); i < Math.min(n, t1 / dt); i++) fn(i, i * dt);
    };

    // Rd track: base from the voice's open quotient, laxer when voicing is weaker
    const rd0 = Math.min(2, Math.max(0.5, 0.6 + 2.7 * (voice.oq - 0.4)));
    const rd = new Float32Array(n);
    for (let i = 0; i < n; i++) rd[i] = T.av[i] > 1 ? rd0 * Math.min(1.5, Math.max(0.8, 1 + 0.035 * (60 - T.av[i]))) : rd0;
    T.rd = rd;
    if (voice.monotone) return;   // robot: LF source only, no human variation

    // Microprosody, as a log-F0 offset smoothed over ~12 ms
    const g = new Float32Array(n);
    phones.forEach((p, i) => {
      if (p.ph === '_' || p.sung) return;
      const P = Phonemes[p.ph];
      if (isVowel(p.ph)) {
        const iv = HIGH_VOWELS[p.ph] ? 0.035 : LOW_VOWELS[p.ph] ? -0.025 : 0;
        const q = phones[i - 1];
        const Q = q && q.ph !== '_' ? Phonemes[q.ph] : null;
        const pert = Q && 'SAFH'.includes(Q.t) ? (Q.av ? -0.05 : 0.07) : 0;
        span(p.t, p.t + p.dur, (k, t) => { g[k] += iv + pert * Math.exp(-(t - p.t) / 0.04); });
        if (p.stress) span(p.t, p.t + p.dur, k => { rd[k] *= 0.88; });
      } else if (P.av) {
        const dip = 'SAF'.includes(P.t) ? -0.06 : -0.025;
        span(p.t, p.t + p.dur, k => { g[k] += dip; });
      }
    });
    const a = Math.exp(-dt / 0.012);
    for (let i = 1; i < n; i++) g[i] = (1 - a) * g[i] + a * g[i - 1];
    for (let i = n - 2; i >= 0; i--) g[i] = (1 - a) * g[i] + a * g[i + 1];

    // Flutter (KLSYN88, FL = 25) on F0 and a slow amplitude wander; half as much when singing
    const sungAt = new Uint8Array(n);
    phones.forEach(p => { if (p.sung) span(p.t, p.t + p.dur, k => { sungAt[k] = 1; }); });
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      const fl = Math.sin(2 * Math.PI * 12.7 * t) + Math.sin(2 * Math.PI * 7.1 * t) + Math.sin(2 * Math.PI * 4.7 * t);
      fr.f0[i] *= Math.exp(g[i]) * (1 + 0.005 * fl * (sungAt[i] ? 0.5 : 1));
      if (T.av[i] > 1) T.av[i] += 0.4 * (Math.sin(2 * Math.PI * 3.1 * t + 1) + Math.sin(2 * Math.PI * 5.3 * t + 2));
    }

    // Phrase ends of speech: laxer, breathier voice over the last 300 ms
    phones.forEach((p, i) => {
      const q = phones[i - 1];
      if (p.ph !== '_' || !q || q.ph === '_' || q.sung || !(p.punct || i === phones.length - 1)) return;
      const end = p.t, t0 = end - 0.3;
      span(t0, end, (k, t) => {
        const x = (t - t0) / 0.3;
        rd[k] *= 1 + 0.6 * x * x;
        T.ah[k] = dB(L(T.ah[k]) + 0.25 * x * x * L(T.av[k]));
      });
    });

    // Singing: breathy onset after a silence, singer's formant on sung vowels
    phones.forEach((p, i) => {
      if (!p.sung || !isVowel(p.ph)) return;
      const q = phones[i - 1];
      if (!q || q.ph === '_') {
        span(p.t, p.t + 0.08, (k, t) => {
          const x = 1 - (t - p.t) / 0.08;
          T.ah[k] = dB(L(T.ah[k]) + 0.35 * x * L(T.av[k]));
          rd[k] *= 1 + 0.4 * x;
        });
      }
      const f3 = 2800 * voice.fscale;
      span(p.t + 0.03, p.t + p.dur - 0.03, k => {
        T.f3[k] += (f3 - T.f3[k]) * 0.3;
        T.b3[k] *= 0.75;
      });
    });
  }
};
