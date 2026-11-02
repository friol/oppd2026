// Prosody: turns parsed words into timed segments with Klatt parameter targets,
// an F0 contour (speech intonation or sung notes) and per-frame parameter tracks.

const PAUSE_SEC = { ',': 0.22, ';': 0.3, ':': 0.3, '.': 0.42, '!': 0.42, '?': 0.42, '…': 0.5 };
// Klatt's inherent durations describe careful reading; normal speech is a bit faster
const SPEECH_SPEED = 1.22;
const LEAD_SEC = 0.12;
const TAIL_SEC = 0.2;

// Parameters stored per segment / frame
const PARAMS = ['f1', 'f2', 'f3', 'b1', 'b2', 'b3', 'f6', 'av', 'ah', 'af', 'a2', 'a3', 'a4', 'a5', 'a6', 'ab', 'fnz'];

// Transition (crossfade) width in ms for each parameter at a segment boundary
const TRANSITION_MS = {
  f1: 40, f2: 40, f3: 40, b1: 25, b2: 25, b3: 25, f6: 10, av: 10, ah: 12,
  af: 12, a2: 6, a3: 6, a4: 6, a5: 6, a6: 6, ab: 6, fnz: 20
};
const FORMANT_KEYS = { f1: 1, f2: 1, f3: 1, b1: 1, b2: 1, b3: 1 };
const FNP = 270;

const Prosody = {
  // ---------- Step 1: units with durations ----------
  // voice: { f0, rate, transpose }
  build(items, voice) {
    const units = [];
    const rate = voice.rate;
    for (let w = 0; w < items.length; w++) {
      const it = items[w];
      if (it.type === 'rest') { units.push({ kind: 'sil', dur: it.dur, rest: true }); continue; }
      if (it.type === 'pause') { units.push({ kind: 'sil', dur: PAUSE_SEC[it.punct] / rate, punct: it.punct }); continue; }
      const next = items[w + 1];
      const phraseFinal = !next || next.type === 'pause' || (!it.sung && next.type === 'rest');
      if (it.sung) this.sungUnits(it, w, units, voice);
      else this.spokenUnits(it, w, phraseFinal, units, rate);
    }
    return this.place(units, items, voice);
  },

  phoneDur(ph, k, rate) {
    const p = Phonemes[ph];
    return (p.min + (p.inh - p.min) * k) / 1000 / rate;
  },

  spokenUnits(it, w, phraseFinal, units, rate) {
    const ph = it.phones;
    const lastV = ph.map(p => isVowel(p.ph)).lastIndexOf(true);
    for (let i = 0; i < ph.length; i++) {
      const p = ph[i];
      let k = 1;
      if (isVowel(p.ph)) {
        if (!p.stress) k = it.lang === 'it' ? 0.4 : (p.ph === 'AX' ? 0.2 : 0.5);
        else if (it.lang === 'it') {
          // Italian: stressed vowels are long in open syllables, short in closed ones
          const n1 = ph[i + 1], n2 = ph[i + 2];
          const closed = n1 && !isVowel(n1.ph) && (n1.gem || (n2 && !isVowel(n2.ph) && Phonemes[n2.ph].t !== 'L' && Phonemes[n2.ph].t !== 'T' && Phonemes[n2.ph].t !== 'G'));
          k = closed ? 0.75 : 1.05;
        }
        if (!phraseFinal) k *= 0.85;
      } else {
        // Consonants of unstressed syllables are shorter
        const nv = ph.slice(i + 1).find(q => isVowel(q.ph));
        if (nv && !nv.stress) k = 0.7;
        if (p.gem) k = 2.2;
      }
      if (phraseFinal && i >= lastV && lastV >= 0) k *= 1.4;
      units.push({ kind: 'ph', ph: p.ph, dur: this.phoneDur(p.ph, k, rate * SPEECH_SPEED), stress: p.stress, gem: p.gem, word: w, lang: it.lang });
    }
  },

  // Split a word into syllables (onset consonants, vowel, coda consonants)
  syllables(ph) {
    const nuclei = [];
    ph.forEach((p, i) => { if (isVowel(p.ph)) nuclei.push(i); });
    if (!nuclei.length) return [{ onset: ph.slice(), vowel: null, coda: [] }];
    const syl = nuclei.map(n => ({ onset: [], vowel: ph[n], coda: [] }));
    syl[0].onset = ph.slice(0, nuclei[0]);
    for (let j = 0; j < nuclei.length - 1; j++) {
      const between = ph.slice(nuclei[j] + 1, nuclei[j + 1]);
      // One consonant goes to the next syllable; with clusters the first one closes this syllable
      const split = between.length >= 2 ? 1 : 0;
      syl[j].coda = between.slice(0, split);
      syl[j + 1].onset = between.slice(split);
    }
    syl[syl.length - 1].coda = ph.slice(nuclei[nuclei.length - 1] + 1);
    return syl;
  },

  sungUnits(it, w, units, voice) {
    const syl = this.syllables(it.phones);
    const count = Math.max(it.sung.notes ? it.sung.notes.length : 0, it.sung.times.length);
    const parts = [];
    for (let k = 0; k < count; k++) {
      const f = it.sung.notes ? it.sung.notes[Math.min(k, it.sung.notes.length - 1)] * Math.pow(2, voice.transpose / 12) : 0;
      parts.push({ f, d: it.sung.times[Math.min(k, it.sung.times.length - 1)] });
    }
    // Map notes to syllables: extra notes become a melisma, extra syllables share the last note
    const m = syl.length;
    const perSyl = syl.map(() => []);
    if (count >= m) parts.forEach((p, k) => perSyl[Math.min(k, m - 1)].push(p));
    else {
      parts.slice(0, count - 1).forEach((p, k) => perSyl[k].push(p));
      const last = parts[count - 1], share = m - (count - 1);
      for (let j = count - 1; j < m; j++) perSyl[j].push({ f: last.f, d: last.d / share });
    }
    const cdur = p => this.phoneDur(p.ph, p.gem ? 1.4 : 0.7, 1);
    syl.forEach((s, j) => {
      units.push({
        kind: 'syl', word: w, lang: it.lang, parts: perSyl[j],
        onset: s.onset.map(p => ({ ph: p.ph, dur: cdur(p), gem: p.gem })),
        vowel: s.vowel, coda: s.coda.map(p => ({ ph: p.ph, dur: cdur(p), gem: p.gem }))
      });
    });
  },

  // ---------- Step 2: timeline, pitch points, labels ----------
  place(units, items, voice) {
    const phones = [];           // { ph, t, dur, stress, gem, sung, word }
    const f0pts = [];            // [t, Hz]
    const vib = [];              // [t0, t1] vibrato regions
    let t = LEAD_SEC;
    const B = voice.f0;
    let prevNoteF = 0;

    const sum = a => a.reduce((s, p) => s + p.dur, 0);
    for (let u = 0; u < units.length; u++) {
      const un = units[u], next = units[u + 1];
      const nextOn = next && next.kind === 'syl' && (un.kind === 'syl' || un.rest) ? sum(next.onset) : 0;
      if (un.kind === 'ph') {
        phones.push({ ph: un.ph, t, dur: un.dur, stress: un.stress, gem: un.gem, word: un.word, lang: un.lang });
        t += un.dur;
        prevNoteF = 0;
      } else if (un.kind === 'sil') {
        const d = Math.max(0.02, un.dur - nextOn);
        phones.push({ ph: '_', t, dur: d, punct: un.punct });
        t += d;
        if (!un.rest) prevNoteF = 0;
      } else {
        // Sung syllable: onset (already placed before the beat if borrowed), vowel on the beat
        for (const c of un.onset) {
          phones.push({ ph: c.ph, t, dur: c.dur, gem: c.gem, word: un.word, sung: true, lang: un.lang });
          t += c.dur;
        }
        const beat = t;
        const D = un.parts.reduce((s, p) => s + p.d, 0);
        let coda = sum(un.coda);
        let room = D - coda - nextOn;
        if (room < 0.45 * D) {
          // Squeeze consonants so that the vowel keeps at least 45% of the note
          const s = 0.55 * D / Math.max(1e-6, coda + nextOn);
          un.coda.forEach(c => { c.dur *= s; });
          if (nextOn) next.onset.forEach(c => { c.dur *= s; });
          coda *= s;
          room = 0.45 * D;
        }
        if (un.vowel) {
          phones.push({ ph: un.vowel.ph, t, dur: room, stress: 1, word: un.word, sung: true, lang: un.lang });
          t += room;
        } else {
          phones.push({ ph: '_', t, dur: room });
          t += room;
        }
        for (const c of un.coda) {
          phones.push({ ph: c.ph, t, dur: c.dur, gem: c.gem, word: un.word, sung: true, lang: un.lang });
          t += c.dur;
        }
        // Pitch: one level per note, short portamento, vibrato on long notes.
        // With voice.natural the pitch overshoots the new note slightly and then settles.
        let tp = beat;
        for (const p of un.parts) {
          const f = p.f || B;
          if (prevNoteF && prevNoteF !== f) {
            const ta = tp + Math.min(0.06, p.d * 0.25);
            const over = voice.natural && p.d > 0.2;
            f0pts.push([tp, prevNoteF], [ta, over ? f * Math.pow(f / prevNoteF, 0.15) : f]);
            if (over) f0pts.push([ta + 0.07, f]);
          } else f0pts.push([tp, f]);
          f0pts.push([tp + p.d - 0.005, f]);
          if (p.f && p.d > 0.28) vib.push([tp + 0.15, tp + p.d]);
          prevNoteF = f;
          tp += p.d;
        }
      }
    }
    phones.push({ ph: '_', t, dur: TAIL_SEC });
    const total = t + TAIL_SEC;
    if (voice.monotone) f0pts.push([0, B], [total, B]);
    else this.speechPitch(phones, items, B, f0pts);
    f0pts.sort((a, b) => a[0] - b[0]);
    if (!f0pts.length) f0pts.push([0, B]);
    return { phones, items, f0pts, vib, total, natural: !!voice.natural };
  },

  // Intonation of the spoken parts: declination, pitch accents on stressed syllables,
  // final fall for statements and rise for questions.
  speechPitch(phones, items, B, pts) {
    let start = 0;
    for (let i = 0; i <= phones.length; i++) {
      const p = phones[i];
      const boundary = !p || (p.ph === '_' && (p.punct || p.dur > 0.15 || i === phones.length - 1));
      if (!boundary) continue;
      const phrase = phones.slice(start, i).filter(q => q.ph !== '_' && !q.sung);
      start = i + 1;
      if (!phrase.length) continue;
      const t0 = phrase[0].t, t1 = phrase[phrase.length - 1].t + phrase[phrase.length - 1].dur;
      const P = Math.max(0.2, t1 - t0);
      const punct = p ? p.punct : '.';
      const base = t => B * (1.06 - 0.16 * (t - t0) / P);
      pts.push([t0, base(t0)]);
      let accents = 0;
      const vowels = phrase.filter(q => isVowel(q.ph));
      const lastStressed = vowels.filter(q => q.stress).pop();
      for (const v of vowels) {
        if (!v.stress) continue;
        const word = items[v.word];
        if (word && word.text.length <= 3 && vowels.length > 2) continue; // function words: no accent
        const peak = accents === 0 ? (punct === '!' ? 1.38 : 1.25) : 1.16;
        accents++;
        if (v === lastStressed && punct === '?') {
          pts.push([v.t, base(v.t) * 0.95], [t1, B * 1.45]);
          continue;
        }
        pts.push([v.t, base(v.t)], [v.t + v.dur * 0.4, base(v.t) * peak], [v.t + v.dur, base(v.t + v.dur) * 1.03]);
      }
      if (punct === '?') { if (!lastStressed) pts.push([t1, B * 1.45]); }
      else if (punct === ',' || punct === ';' || punct === ':') pts.push([t1, B * 1.02]);
      else pts.push([t1, B * 0.76]);
    }
  },

  // ---------- Step 3: segments with parameter targets ----------
  segments(phones, voice) {
    const segs = [];
    const blank = () => { const o = {}; PARAMS.forEach(k => { o[k] = 0; }); o.f6 = 4900; o.fnz = FNP; o.f1 = null; return o; };
    const vowelNear = (i, dir) => {
      for (let j = i + dir; j >= 0 && j < phones.length && Math.abs(j - i) <= 3; j += dir) {
        if (phones[j].ph === '_') break;
        if (isVowel(phones[j].ph)) return Phonemes[phones[j].ph];
      }
      return null;
    };
    const setF = (o, f, b) => {
      [o.f1, o.f2, o.f3] = f;
      [o.b1, o.b2, o.b3] = b || DEFAULT_B;
    };
    const add = (o, t, dur, label, glide) => segs.push({ p: o, t, dur, label, glide: !!glide });

    for (let i = 0; i < phones.length; i++) {
      const ph = phones[i];
      const P = Phonemes[ph.ph];
      const next = phones[i + 1], prev = phones[i - 1];
      if (ph.ph === '_') { add(blank(), ph.t, ph.dur, ''); continue; }
      const o = blank();
      switch (P.t) {
        case 'V':
          setF(o, P.f, P.b);
          o.av = ph.sung ? 62 : (ph.stress ? 61 : 58);
          add(o, ph.t, ph.dur, ph.ph);
          break;
        case 'D': {
          const split = ph.sung ? 0.78 : 0.45;
          setF(o, P.f, P.b);
          o.av = ph.sung ? 62 : (ph.stress ? 61 : 58);
          const o2 = Object.assign({}, o);
          [o2.f1, o2.f2, o2.f3] = P.to;
          add(o, ph.t, ph.dur * split, ph.ph);
          add(o2, ph.t + ph.dur * split, ph.dur * (1 - split), '', true);
          break;
        }
        case 'G': case 'L':
          setF(o, P.f, P.b);
          o.av = P.av;
          add(o, ph.t, ph.dur, ph.ph);
          break;
        case 'N':
          setF(o, P.f, P.b);
          o.av = P.av;
          o.fnz = 450;
          add(o, ph.t, ph.dur, ph.ph);
          break;
        case 'T': {
          // Italian r: one tap (two or three when doubled) = short drop of voicing and F1
          const taps = ph.gem ? 3 : 1;
          const dip = 0.022;
          const open = Math.max(0.012, (ph.dur - taps * dip) / (taps + 1));
          let tt = ph.t;
          for (let k = 0; k < taps; k++) {
            const a = Object.assign({}, o); setF(a, P.f, P.b); a.av = P.av;
            add(a, tt, open, k ? '' : ph.ph); tt += open;
            const d = Object.assign({}, o); setF(d, [250, P.f[1], P.f[2]], P.b); d.av = 36;
            add(d, tt, dip, ''); tt += dip;
          }
          const a = Object.assign({}, o); setF(a, P.f, P.b); a.av = P.av;
          add(a, tt, Math.max(0.005, ph.t + ph.dur - tt), '');
          break;
        }
        case 'F':
          setF(o, P.f, P.b);
          this.fric(o, P, !!P.av);
          add(o, ph.t, ph.dur, ph.ph);
          break;
        case 'H':
          o.ah = 58;   // formants copied from the next vowel below
          add(o, ph.t, ph.dur, ph.ph);
          break;
        case 'S': case 'A': {
          const voiced = !!P.av;
          let loc = STOP_LOCI[P.place].slice();
          if (P.place === 'vel') {
            const v = vowelNear(i, 1) || vowelNear(i, -1);
            if (v) loc = [250, v.f[1], Math.max(v.f[2], v.f[1] + 350)];
          }
          const relDur = P.t === 'A' ? ph.dur * 0.5 : (ph.ph === 'K' || ph.ph === 'G' ? 0.018 : 0.012);
          const cl = Object.assign({}, o);
          setF(cl, loc, [90, 150, 200]);
          cl.av = voiced ? P.av : 0;
          add(cl, ph.t, Math.max(0.02, ph.dur - relDur), ph.ph);
          const rel = Object.assign({}, cl);
          if (P.t === 'A') this.fric(rel, Phonemes[P.rel], voiced);
          else {
            Object.assign(rel, P.burst);
            rel.af = voiced ? 54 : 60;
          }
          const tRel = ph.t + Math.max(0.02, ph.dur - relDur);
          add(rel, tRel, relDur, '');
          // Aspiration of English voiceless stops before a vowel (not after s)
          const nextIsV = next && (isVowel(next.ph) || (Phonemes[next.ph] && 'GL'.includes(Phonemes[next.ph].t)));
          if (P.asp && nextIsV && ph.lang === 'en' && !(prev && prev.ph === 'S')) {
            const asp = blank();
            asp.ah = 56;
            add(asp, tRel + relDur, next.stress ? 0.05 : 0.03, '');
            // Aspiration time is taken from the following phone
            next.t += next.stress ? 0.05 : 0.03;
            next.dur = Math.max(0.03, next.dur - (next.stress ? 0.05 : 0.03));
          }
          break;
        }
      }
    }

    // Segments without own formants (silence, h, aspiration) take them from the next voiced segment
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].p.f1 !== null) continue;
      let src = null;
      for (let j = i + 1; j < segs.length && !src; j++) if (segs[j].p.f1 !== null) src = segs[j].p;
      for (let j = i - 1; j >= 0 && !src; j--) if (segs[j].p.f1 !== null) src = segs[j].p;
      const s = src || { f1: 500, f2: 1500, f3: 2500, b1: 70, b2: 100, b3: 160 };
      ['f1', 'f2', 'f3', 'b1', 'b2', 'b3'].forEach(k => { segs[i].p[k] = s[k]; });
    }
    return segs;
  },

  fric(o, P, voiced) {
    Object.assign(o, P.fr);
    o.af = voiced ? 56 : 60;
    o.av = voiced ? P.av : 0;
  },

  // ---------- Step 4: per-frame parameter tracks ----------
  // Returns { n, step, tracks: {param: Float32Array}, f0: Float32Array }
  frames(segs, built, voice, sr, step) {
    const n = Math.ceil(built.total * sr / step) + 1;
    const tracks = {};
    PARAMS.forEach(k => { tracks[k] = new Float32Array(n); });
    const f0 = new Float32Array(n);
    const ease = x => x * x * (3 - 2 * x);
    let si = 0;
    for (let fr = 0; fr < n; fr++) {
      const t = fr * step / sr;
      while (si < segs.length - 1 && t >= segs[si].t + segs[si].dur) si++;
      const s = segs[si], prev = segs[si - 1], next = segs[si + 1];
      const tl = s.t, tr = s.t + s.dur;
      for (const k of PARAMS) {
        let v = s.p[k];
        if (prev && t < tl + s.dur / 2) {
          const W = this.width(k, prev, s);
          const w = Math.min(W, prev.dur, s.dur);
          if (w > 0 && t < tl + w / 2) v += (prev.p[k] - v) * (1 - ease(Math.min(1, (t - tl + w / 2) / w)));
        } else if (next && t >= tr - s.dur / 2) {
          const W = this.width(k, s, next);
          const w = Math.min(W, s.dur, next.dur);
          if (w > 0 && t > tr - w / 2) v += (next.p[k] - v) * ease(Math.min(1, (t - tr + w / 2) / w));
        }
        tracks[k][fr] = v;
      }
      f0[fr] = this.f0At(built, t);
    }
    // Formant scaling for the voice (vocal tract length)
    for (const k of ['f1', 'f2', 'f3', 'f6']) {
      const a = tracks[k];
      for (let i = 0; i < n; i++) a[i] *= voice.fscale;
    }
    // Formant tuning (as sopranos do): F1 never stays below F0, otherwise high notes
    // on closed vowels lose most of their energy
    for (let i = 0; i < n; i++) if (tracks.f1[i] < f0[i] * 1.05) tracks.f1[i] = f0[i] * 1.05;
    return { n, step, tracks, f0 };
  },

  width(k, a, b) {
    if (FORMANT_KEYS[k]) {
      if (b.glide) return Infinity;
      const ta = a.label && Phonemes[a.label] ? Phonemes[a.label].t : '';
      const tb = b.label && Phonemes[b.label] ? Phonemes[b.label].t : '';
      if ('GL'.includes(ta) && ta || 'GL'.includes(tb) && tb) return 0.07;
    }
    return TRANSITION_MS[k] / 1000;
  },

  f0At(built, t) {
    const pts = built.f0pts;
    let f;
    if (t <= pts[0][0]) f = pts[0][1];
    else if (t >= pts[pts.length - 1][0]) f = pts[pts.length - 1][1];
    else {
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= t) lo = mid; else hi = mid; }
      const [t0, f0] = pts[lo], [t1, f1] = pts[hi];
      const x = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      f = f0 * Math.pow(f1 / f0, x);
    }
    for (const [a, b] of built.vib) {
      if (t >= a && t < b) {
        const u = t - a, ramp = Math.min(1, u / 0.25);
        // With voice.natural the rate wanders by +-0.3 Hz and the depth by +-20%, as in real singers
        const cyc = built.natural ? 5.6 * u + 0.068 * Math.sin(2 * Math.PI * 0.7 * u) : 5.6 * u;
        const depth = built.natural ? 1 + 0.2 * Math.sin(2 * Math.PI * 0.43 * u + 1.3) : 1;
        f *= 1 + 0.022 * built.vibDepth * depth * ramp * Math.sin(2 * Math.PI * cyc);
      }
    }
    return f;
  }
};
