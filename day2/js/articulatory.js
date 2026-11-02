// Articulatory mode: F1-F3 come from a simulated vocal tract instead of formant tables.
//
//   vowel layer: tongue body constriction (place, area) and lips (area, protrusion) on a
//     Stevens-House area function; a critically damped second-order system drives it toward
//     the next vowel, so the tongue moves vowel to vowel under the consonants (Ohman 1966)
//     and short vowels undershoot their targets
//   consonant layer: local constrictions (lips, teeth, alveolar ridge, palate, velum)
//     switched on and off with smooth activation ramps around each consonant
//   acoustics: lossless tube of 0.5 cm sections, closed at the glottis and open at the lips;
//     the formants are the zeros of the element D(f) of the chain matrix
//
// Vowel layer targets are fitted at run time so that each steady vowel lands on the F1-F3
// targets of phonemes.js. Nasals, laterals, English r, taps and frication keep the rule
// formants (their spectra need side branches the single tube does not have); the rest of
// the Natural mode (LF source, microprosody, flutter...) is applied on top.

const TRACT = { body: 16, dx: 0.5, c: 35000 };   // cm, cm, cm/s; the lips are one extra section

// Consonant places: constriction centre (cm from the glottis), spatial spread (cm) and
// the pull on the tongue body (the tip is attached to it): [place, area, weight]
const PLACES = {
  den:  { x: 15.3, w: 0.5, body: [11, 1.5, 0.6] },
  alv:  { x: 14.5, w: 0.7, body: [11, 1.0, 0.9] },
  post: { x: 13.5, w: 0.9, body: [11.5, 0.8, 1] },
  pal:  { x: 12.0, w: 1.2, body: [12, 0.5, 1] },
  // Made by the tongue body itself; at 11 cm the closure gives the "velar pinch" (F2 and
  // F3 converge) before front and open vowels
  vel:  { x: 11.0, w: 1.4 }
};

// Consonant gestures: [place ('lab' = lips), constriction area in cm2]
const GESTURES = {
  P: ['lab', 0], B: ['lab', 0], M: ['lab', 0], F: ['lab', 0.3], V: ['lab', 0.3],
  TH: ['den', 0.2], DH: ['den', 0.2],
  T: ['alv', 0], D: ['alv', 0], N: ['alv', 0], TS: ['alv', 0], DZ: ['alv', 0],
  S: ['alv', 0.1], Z: ['alv', 0.1], L: ['alv', 0.5], Ll: ['alv', 0.5],
  SH: ['post', 0.15], ZH: ['post', 0.15], CH: ['post', 0], JH: ['post', 0],
  NY: ['pal', 0], LY: ['pal', 0.3], R: ['pal', 0.7],
  K: ['vel', 0], G: ['vel', 0], NG: ['vel', 0]
};

const MIN_AREA = 0.01;
// Vowel layer parameters: [constriction place (cm), ln constriction area, ln lip area, lip length (cm)]
const VT_MIN = [3, Math.log(0.15), Math.log(0.05), 0.5];
const VT_MAX = [14.5, Math.log(5), Math.log(5), 2.2];

const Articulatory = {
  cache: {},
  codebook: null,

  // ---------- Acoustics ----------

  // Body area function (cm2) of the vowel layer
  areas(v, out) {
    const rc = Math.sqrt(Math.exp(v[1]) / Math.PI);
    for (let i = 0; i < out.length; i++) {
      const x = (i + 0.5) * TRACT.dx, z = x - v[0];
      const r = Math.min(1.3, rc + 0.025 * Math.max(0, 1.2 - rc) * z * z);
      let a = Math.PI * r * r;
      if (x < 1.5) a = Math.min(a, 2);   // larynx tube
      out[i] = a;
    }
    return out;
  },

  // First three zeros of D(f) for the body areas plus one lip section; null if not found
  formants(A, lipA, lipL) {
    const kl = 2 * Math.PI / TRACT.c;
    const lip = lipL + 0.8 * Math.sqrt(lipA / Math.PI);   // end correction of the open mouth
    const F = [];
    let prev = 0, prevF = 0;
    for (let f = 80; f <= 5000 && F.length < 3; f += 20) {
      const cb = Math.cos(kl * f * TRACT.dx), sb = Math.sin(kl * f * TRACT.dx);
      // Chain matrix [[a, jb], [jc, d]] from the glottis to the lips
      let a = 1, b = 0, c = 0, d = 1;
      for (let i = 0; i < A.length; i++) {
        const Z = 1 / A[i];
        const a2 = a * cb - b * sb / Z, b2 = a * Z * sb + b * cb;
        const c2 = c * cb + d * sb / Z, d2 = d * cb - c * Z * sb;
        a = a2; b = b2; c = c2; d = d2;
      }
      const cl = Math.cos(kl * f * lip), sl = Math.sin(kl * f * lip), Zl = 1 / lipA;
      d = d * cl - c * Zl * sl;
      if (prevF && Math.sign(d) !== Math.sign(prev)) F.push(prevF + 20 * prev / (prev - d));
      prev = d; prevF = f;
    }
    return F.length === 3 ? F : null;
  },

  vowelFormants(v) {
    const A = this.areas(v, new Float64Array(TRACT.body / TRACT.dx));
    return this.formants(A, Math.exp(v[2]), v[3]);
  },

  // ---------- Fitting vowel targets ----------

  error(F, target) {
    if (!F) return 1e9;
    const w = [1, 1, 0.6];
    let e = 0;
    for (let k = 0; k < 3; k++) { const r = (F[k] - target[k]) / target[k]; e += w[k] * r * r; }
    return e;
  },

  // Coarse grid of the whole parameter space, built once
  buildCodebook() {
    const cb = [];
    for (let xc = 4; xc <= 14; xc += 0.5)
      for (const ac of [0.25, 0.4, 0.65, 1, 1.6, 2.5, 4])
        for (const al of [0.15, 0.3, 0.6, 1.2, 2.5, 4.5])
          for (const ll of [0.6, 1.2, 2]) {
            const v = [xc, Math.log(ac), Math.log(al), ll];
            const F = this.vowelFormants(v);
            if (F) cb.push({ v, F });
          }
    return cb;
  },

  // Vowel layer parameters whose formants best match target F1-F3: best grid point, then pattern search
  fit(target) {
    const key = target.join(',');
    if (this.cache[key]) return this.cache[key];
    if (!this.codebook) this.codebook = this.buildCodebook();
    let best = null, be = Infinity;
    for (const c of this.codebook) { const e = this.error(c.F, target); if (e < be) { be = e; best = c.v; } }
    let v = best.slice();
    const step = [0.5, 0.25, 0.25, 0.3];
    for (let it = 0; it < 200 && step[0] > 0.01; it++) {
      let improved = false;
      for (let k = 0; k < 4; k++) {
        for (const s of [1, -1]) {
          const t = v.slice();
          t[k] = Math.min(VT_MAX[k], Math.max(VT_MIN[k], t[k] + s * step[k]));
          const e = this.error(this.vowelFormants(t), target);
          if (e < be) { be = e; v = t; improved = true; }
        }
      }
      if (!improved) for (let k = 0; k < 4; k++) step[k] /= 2;
    }
    return (this.cache[key] = v);
  },

  // ---------- Tract geometry over time ----------
  // Returns the tube every EVERY frames: [{ k, A (body areas), lipA, ll (lip length), corr }]

  tubes(fr, segs) {
    const n = fr.n, dt = fr.step / Klatt.SR;
    const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

    // Vowel layer timeline: each vowel's target is active from the end of the previous vowel
    const tl = [];
    let lastEnd = 0;
    segs.forEach((s, i) => {
      const P = Phonemes[s.label];
      let F = null;
      if (P && (P.t === 'V' || P.t === 'D' || P.t === 'G')) F = P.f;
      else if (s.glide && Phonemes[segs[i - 1].label]) F = Phonemes[segs[i - 1].label].to;
      if (!F) return;
      // The single-constriction tube cannot reach every vowel exactly (front mid vowels,
      // rhotic ER): the residual is kept as a log-ratio and moves with the vowel layer
      const v = this.fit(F), Fv = this.vowelFormants(v);
      const corr = F.map((f, q) => Math.log(Math.min(1.6, Math.max(0.6, f / Fv[q]))));
      tl.push({ t: lastEnd, v: v.concat(corr) });
      lastEnd = s.t + s.dur;
    });
    if (!tl.length) return [];

    // Consonant gestures with activation ramps (closures move a little earlier and faster);
    // also the taps of the Italian r and the fricative release of affricates
    const gest = [];
    segs.forEach((s, i) => {
      let g = GESTURES[s.label], rise = null;
      const prev = segs[i - 1] && Phonemes[segs[i - 1].label];
      if (s.p.tap) { g = ['alv', 0.02]; rise = 0.008; }
      else if (!g && prev && prev.t === 'A' && s.p.af > 0) g = GESTURES[prev.rel];
      if (!g) return;
      if (rise === null) rise = g[1] ? 0.035 : 0.045;
      gest.push({ place: g[0], area: Math.max(MIN_AREA, g[1]), on: s.t, off: s.t + s.dur, rise, fall: Math.min(0.035, rise) });
    });

    // Integrate the vowel layer (critically damped, omega = 45 rad/s) and sample the tube every 4 frames
    const W = 45, EVERY = 4;
    const D = tl[0].v.length;
    const p = tl[0].v.slice(), vel = new Array(D).fill(0);
    const out = [];
    let ti = 0;
    for (let k = 0; k < n; k++) {
      const t = k * dt;
      while (ti < tl.length - 1 && t >= tl[ti + 1].t) ti++;
      const tg = tl[ti].v;
      for (let j = 0; j < D; j++) {
        vel[j] += (W * W * (tg[j] - p[j]) - 2 * W * vel[j]) * dt;
        p[j] += vel[j] * dt;
      }
      if (k % EVERY && k !== n - 1) continue;

      // Active gestures; coronal and palatal ones also pull the tongue body forward
      const active = [];
      const body = p.slice(0, 4);
      for (const g of gest) {
        if (t < g.on - g.rise || t > g.off + g.fall) continue;
        const act = Math.min(ease((t - g.on + g.rise) / g.rise), 1 - ease((t - g.off) / g.fall));
        active.push([g, act]);
        const b = PLACES[g.place] && PLACES[g.place].body;
        if (b) {
          body[0] += (b[0] - body[0]) * act * b[2];
          body[1] += (Math.log(b[1]) - body[1]) * act * b[2];
        }
      }
      const A = this.areas(body, new Float64Array(TRACT.body / TRACT.dx));
      let lipA = Math.exp(p[2]);
      for (const [g, act] of active) {
        if (g.place === 'lab') { if (g.area < lipA) lipA += (g.area - lipA) * act; continue; }
        const pl = PLACES[g.place];
        for (let i = 0; i < A.length; i++) {
          const z = ((i + 0.5) * TRACT.dx - pl.x) / pl.w;
          const wgt = act * Math.exp(-z * z);
          if (g.area < A[i]) A[i] += (g.area - A[i]) * wgt;
        }
      }
      for (let i = 0; i < A.length; i++) A[i] = Math.max(MIN_AREA, A[i]);
      out.push({ k, A, lipA: Math.max(MIN_AREA, lipA), ll: p[3], corr: p.slice(4) });
    }
    return out;
  },

  // ---------- Per-frame formant tracks ----------

  shape(fr, segs, voice) {
    const n = fr.n, dt = fr.step / Klatt.SR, T = fr.tracks;
    const Fm = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    let last = null, lastK = -1;
    for (const tb of this.tubes(fr, segs)) {
      const Ft = this.formants(tb.A, tb.lipA, tb.ll);
      const F = Ft ? Ft.map((f, q) => f * Math.exp(tb.corr[q])) : last;
      if (!F) continue;
      // Linear interpolation since the previous sample point
      for (let j = lastK + 1; j <= tb.k; j++) {
        const x = lastK < 0 || !last ? 1 : (j - lastK) / (tb.k - lastK);
        for (let q = 0; q < 3; q++) Fm[q][j] = last ? last[q] + (F[q] - last[q]) * x : F[q];
      }
      last = F; lastK = tb.k;
    }
    if (!last) return;

    // Where the tube is used: vowels, glides, h, stop closures, aspiration and silence
    const w = new Float32Array(n);
    for (const s of segs) {
      const P = Phonemes[s.label];
      let use;
      if (P) use = 'VDGHSA'.includes(P.t) ? 1 : 0;
      else if (s.glide) use = 1;
      else use = s.p.af > 0 || s.p.av > 0 ? 0 : 1;
      for (let k = Math.max(0, Math.ceil(s.t / dt)); k < Math.min(n, (s.t + s.dur) / dt); k++) w[k] = use;
    }
    const a = Math.exp(-dt / 0.01);
    for (let k = 1; k < n; k++) w[k] = (1 - a) * w[k] + a * w[k - 1];
    for (let k = n - 2; k >= 0; k--) w[k] = (1 - a) * w[k] + a * w[k + 1];

    const keys = ['f1', 'f2', 'f3'];
    for (let k = 0; k < n; k++) {
      for (let q = 0; q < 3; q++) {
        const tr = T[keys[q]];
        tr[k] = w[k] * Fm[q][k] * voice.fscale + (1 - w[k]) * tr[k];
      }
      if (T.f1[k] < fr.f0[k] * 1.05) T.f1[k] = fr.f0[k] * 1.05;
    }
  }
};
