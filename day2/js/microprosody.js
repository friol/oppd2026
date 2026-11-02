// Pitch refinements applied to the F0 track (used by the MBROLA mode):
//
//   microprosody: F0 perturbation after voiceless/voiced obstruents, intrinsic vowel F0,
//     small F0 dip during voiced consonants
//   flutter (KLSYN88, FL = 25): slow quasi-random wander of F0, half as much when singing
//
// Pitch overshoot on new notes and the irregular vibrato are done in prosody.js when
// voice.natural is set.

const HIGH_VOWELS = { i: 1, u: 1, IY: 1, IH: 1, UW: 1, UH: 1 };
const LOW_VOWELS = { a: 1, O: 1, AA: 1, AE: 1, AO: 1 };

const Microprosody = {
  apply(fr, built, voice) {
    if (voice.monotone) return;   // robot: no human variation
    const n = fr.n, dt = fr.step / Klatt.SR, phones = built.phones;
    const span = (t0, t1, fn) => {
      for (let i = Math.max(0, Math.ceil(t0 / dt)); i < Math.min(n, t1 / dt); i++) fn(i, i * dt);
    };

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
      } else if (P.av) {
        const dip = 'SAF'.includes(P.t) ? -0.06 : -0.025;
        span(p.t, p.t + p.dur, k => { g[k] += dip; });
      }
    });
    const a = Math.exp(-dt / 0.012);
    for (let i = 1; i < n; i++) g[i] = (1 - a) * g[i] + a * g[i - 1];
    for (let i = n - 2; i >= 0; i--) g[i] = (1 - a) * g[i] + a * g[i + 1];

    // Flutter
    const sungAt = new Uint8Array(n);
    phones.forEach(p => { if (p.sung) span(p.t, p.t + p.dur, k => { sungAt[k] = 1; }); });
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      const fl = Math.sin(2 * Math.PI * 12.7 * t) + Math.sin(2 * Math.PI * 7.1 * t) + Math.sin(2 * Math.PI * 4.7 * t);
      fr.f0[i] *= Math.exp(g[i]) * (1 + 0.005 * fl * (sungAt[i] ? 0.5 : 1));
    }
  }
};
