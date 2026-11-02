// Audio -> escape sequences: pitch tracking (YIN), note segmentation, tempo estimation
// and rhythm quantization. Words cannot be recognized: notes are sung on "la", or on the
// syllables of user-supplied lyrics.

const Transcriber = {
  SR: 11025,        // analysis sample rate
  HOP: 0.01,        // frame hop (s)
  WIN: 0.03,        // analysis window (s)
  FMIN: 65,
  FMAX: 1400,

  // Decode a WAV/MP3 file into mono samples at SR
  async decode(arrayBuffer) {
    const wav = this.parseWav(arrayBuffer);
    if (wav) return this.resample(wav.mono, wav.sampleRate);
    // MP3 and other formats: let the browser decode (an offline context needs no audio device)
    const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(arrayBuffer);
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
    }
    return this.resample(mono, buf.sampleRate);
  },

  // Plain PCM / float WAV reader (null if the file is not one)
  parseWav(ab) {
    const dv = new DataView(ab);
    const tag = o => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
    if (ab.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let fmt = null, pos = 12;
    while (pos + 8 <= ab.byteLength) {
      const id = tag(pos), size = dv.getUint32(pos + 4, true), body = pos + 8;
      if (id === 'fmt ') {
        fmt = { format: dv.getUint16(body, true), channels: dv.getUint16(body + 2, true),
                sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
        if (fmt.format === 0xfffe && size >= 26) fmt.format = dv.getUint16(body + 24, true); // extensible
      } else if (id === 'data' && fmt) {
        const bytes = fmt.bits / 8, frame = bytes * fmt.channels;
        const ok = (fmt.format === 1 && [8, 16, 24, 32].includes(fmt.bits)) || (fmt.format === 3 && fmt.bits === 32);
        if (!ok) return null;
        const n = Math.floor(Math.min(size, ab.byteLength - body) / frame);
        const mono = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let c = 0; c < fmt.channels; c++) {
            const o = body + i * frame + c * bytes;
            if (fmt.format === 3) s += dv.getFloat32(o, true);
            else if (fmt.bits === 8) s += (dv.getUint8(o) - 128) / 128;
            else if (fmt.bits === 16) s += dv.getInt16(o, true) / 32768;
            else if (fmt.bits === 24) s += ((dv.getUint8(o) | dv.getUint8(o + 1) << 8 | dv.getInt8(o + 2) << 16)) / 8388608;
            else s += dv.getInt32(o, true) / 2147483648;
          }
          mono[i] = s / fmt.channels;
        }
        return { mono, sampleRate: fmt.sampleRate };
      }
      pos = body + size + (size & 1);
    }
    return null;
  },

  // Band-limited resampling to SR (windowed-sinc low-pass + interpolation)
  resample(x, srIn) {
    const ratio = srIn / this.SR;
    if (Math.abs(ratio - 1) < 1e-6) return x;
    const n = Math.floor(x.length / ratio);
    const out = new Float32Array(n);
    const fc = 0.45 / Math.max(1, ratio);           // cutoff in cycles per input sample
    const H = Math.ceil(4 / fc);                    // half filter length
    for (let i = 0; i < n; i++) {
      const c = i * ratio, c0 = Math.floor(c);
      let acc = 0, norm = 0;
      for (let k = c0 - H + 1; k <= c0 + H; k++) {
        if (k < 0 || k >= x.length) continue;
        const d = k - c;
        const s = d === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * d) / (Math.PI * d);
        const w = 0.5 + 0.5 * Math.cos(Math.PI * d / H);   // Hann window
        acc += x[k] * s * w;
        norm += s * w;
      }
      out[i] = norm ? acc / norm : 0;
    }
    return out;
  },

  // ---------- Pitch tracking ----------
  // Returns { f0: Float32Array (0 = unvoiced), midi, rms, hop }
  track(x) {
    const sr = this.SR;
    const W = Math.round(this.WIN * sr), hop = Math.round(this.HOP * sr);
    const tauMin = Math.floor(sr / this.FMAX), tauMax = Math.ceil(sr / this.FMIN);
    const n = Math.max(0, Math.floor((x.length - W - tauMax) / hop));
    const f0 = new Float32Array(n), rms = new Float32Array(n), ap = new Float32Array(n);
    const d = new Float32Array(tauMax + 1);
    let maxRms = 0;
    for (let i = 0; i < n; i++) {
      const s = i * hop;
      let e = 0;
      for (let j = 0; j < W; j++) e += x[s + j] * x[s + j];
      rms[i] = Math.sqrt(e / W);
      if (rms[i] > maxRms) maxRms = rms[i];
      // YIN: difference function and cumulative mean normalization
      let sum = 0, best = -1;
      d[0] = 1;
      for (let tau = 1; tau <= tauMax; tau++) {
        let acc = 0;
        for (let j = 0; j < W; j++) { const v = x[s + j] - x[s + j + tau]; acc += v * v; }
        sum += acc;
        d[tau] = sum > 0 ? acc * tau / sum : 1;
      }
      for (let tau = tauMin; tau < tauMax; tau++) {
        if (d[tau] < 0.15) {
          while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++;
          best = tau;
          break;
        }
      }
      if (best < 0) {
        best = tauMin;
        for (let tau = tauMin; tau < tauMax; tau++) if (d[tau] < d[best]) best = tau;
      }
      ap[i] = d[best];
      // Parabolic interpolation around the minimum
      const a = d[best - 1], b = d[best], c = d[best + 1];
      const den = a - 2 * b + c;
      const tau = den > 0 ? best + 0.5 * (a - c) / den : best;
      f0[i] = sr / tau;
    }
    // Voicing decision: periodic enough and not too quiet
    const floor = maxRms * Math.pow(10, -40 / 20);
    const midi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (ap[i] > 0.3 || rms[i] < floor) { f0[i] = 0; midi[i] = 0; }
      else midi[i] = 69 + 12 * Math.log2(f0[i] / 440);
    }
    this.cleanup(midi);
    for (let i = 0; i < n; i++) f0[i] = midi[i] ? 440 * Math.pow(2, (midi[i] - 69) / 12) : 0;
    return { f0, midi, rms, hop: this.HOP };
  },

  median(a) {
    const s = Array.from(a).sort((p, q) => p - q);
    return s.length ? s[s.length >> 1] : 0;
  },

  // Median smoothing and octave-jump correction on voiced frames
  cleanup(midi) {
    const n = midi.length, src = Float32Array.from(midi);
    for (let i = 0; i < n; i++) {
      if (!src[i]) continue;
      const near = [];
      for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < n && src[j]) near.push(src[j]);
      midi[i] = this.median(near);
    }
    for (let i = 0; i < n; i++) {
      if (!midi[i]) continue;
      const ctx = [];
      for (let j = i - 12; j <= i + 12; j++) if (j >= 0 && j < n && midi[j]) ctx.push(midi[j]);
      const m = this.median(ctx);
      while (midi[i] - m > 9) midi[i] -= 12;
      while (m - midi[i] > 9) midi[i] += 12;
    }
  },

  // ---------- Note segmentation ----------
  // A note ends on a pitch change that lasts, on an unvoiced gap, or on an energy dip
  // followed by a new attack (repeated notes on different syllables).
  segment(tr) {
    const { midi, rms, hop } = tr;
    const n = midi.length;
    const notes = [];
    let cur = null, unvoiced = 0;
    const close = () => {
      if (!cur) return;
      const len = cur.pitches.length;
      const core = cur.pitches.slice(Math.floor(len * 0.2), Math.ceil(len * 0.8));
      // The beat falls on the vowel: start where the energy reaches half of the note peak,
      // so voiced onset consonants (l, m, r...) do not anticipate the note
      let first = cur.first;
      while (first < cur.last && rms[first] < 0.5 * cur.peak) first++;
      const dur = (cur.last - first + 1) * hop;
      if (dur >= 0.045) notes.push({ t: first * hop, end: (cur.last + 1) * hop, midi: Math.round(this.median(core.length ? core : cur.pitches)) });
      cur = null;
    };
    const open = i => { cur = { first: i, last: i, pitches: [midi[i]], peak: rms[i], dipped: false }; };
    for (let i = 0; i < n; i++) {
      if (!midi[i]) {
        if (++unvoiced >= 3) close();
        continue;
      }
      unvoiced = 0;
      if (!cur) { open(i); continue; }
      const ref = this.median(cur.pitches.slice(-15));
      const ahead = [];
      for (let j = i; j < Math.min(n, i + 4); j++) if (midi[j]) ahead.push(midi[j]);
      const jump = Math.abs(midi[i] - ref) > 0.8 && Math.abs(this.median(ahead) - ref) > 0.8;
      if (rms[i] < 0.4 * cur.peak) cur.dipped = true;
      const reattack = cur.dipped && rms[i] > 0.75 * cur.peak && i - cur.first > 6;
      if (jump || reattack) { close(); open(i); continue; }
      cur.last = i;
      cur.pitches.push(midi[i]);
      if (!cur.dipped) cur.peak = Math.max(cur.peak, rms[i]);
    }
    close();
    // Drop short blips glued to the next note: they are glides between two pitches
    return notes.filter((nt, k) => !(nt.end - nt.t < 0.07 && notes[k + 1] && notes[k + 1].t - nt.end < 0.03));
  },

  // ---------- Tempo and rhythm ----------
  estimateTempo(notes) {
    const ioi = [];
    for (let i = 1; i < notes.length; i++) {
      const d = notes[i].t - notes[i - 1].t;
      if (d > 0.08 && d < 2.5) ioi.push(d);
    }
    if (!ioi.length) return 100;
    let best = 100, bestCost = Infinity;
    for (let bpm = 60; bpm <= 180; bpm += 0.5) {
      const eighth = 30 / bpm;
      let cost = 0;
      for (const d of ioi) {
        const x = d / eighth;
        const q = Math.max(0.5, Math.round(x * 2) / 2);
        cost += Math.abs(x - q) + (q % 1 ? 0.12 : 0);
      }
      cost += 0.3 * Math.abs(Math.log2(bpm / 110));   // mild preference for moderate tempos
      if (cost < bestCost) { bestCost = cost; best = bpm; }
    }
    return Math.round(best);
  },

  // Events in sixteenth-note units: { midi, units } for notes, { rest: true, units } for rests
  quantize(notes, bpm) {
    const six = 15 / bpm;
    // Snap to common note values when close (7 -> 8, 5 -> 4 or 6), larger value on ties
    const nice = [1, 2, 3, 4, 6, 8, 12, 16];
    const snap = x => {
      const u = Math.max(1, Math.round(x));
      if (u > 16 || nice.includes(u)) return u;
      let best = u;
      for (const v of nice) if (Math.abs(v - x) <= 1.05 && (best === u || Math.abs(v - x) <= Math.abs(best - x))) best = v;
      return best;
    };
    const events = [];
    for (let i = 0; i < notes.length; i++) {
      const nt = notes[i], next = notes[i + 1];
      const slot = snap(((next ? next.t : nt.end) - nt.t) / six);
      const sound = Math.min(slot, snap((nt.end - nt.t) / six));
      // Only a real silence becomes a rest: short gaps are just consonants between syllables
      if (slot - sound >= 2 && next && next.t - nt.end > 22.5 / bpm) {
        events.push({ midi: nt.midi, units: sound });
        events.push({ rest: true, units: slot - sound });
      } else events.push({ midi: nt.midi, units: slot });
    }
    return events;
  },

  // ---------- Text generation ----------
  NAMES: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  noteName(m) { return this.NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); },

  // Sixteenth units -> \time value (ties with '+' when needed)
  timeToken(u) {
    const table = [[16, '1'], [12, '2.'], [8, '2'], [6, '4.'], [4, '4'], [3, '8.'], [2, '8'], [1, '16']];
    const exact = table.find(([v]) => v === u);
    if (exact) return exact[1];
    const parts = [];
    for (const [v, s] of table) while (u >= v) { parts.push(s); u -= v; }
    return parts.join('+');
  },

  // lyrics: optional text; its syllables take the notes in order, the rest is sung on "la"
  toText(events, bpm, lyrics, lang) {
    const words = [];
    if (lyrics && lyrics.trim()) {
      for (const w of lyrics.trim().split(/\s+/)) {
        const core = w.replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, '');
        if (!core) continue;
        const syl = Prosody.syllables(Parser.wordPhones(core, lang)).length;
        words.push({ text: w, syl: Math.max(1, syl) });
      }
    }
    const out = ['\\tempo:' + bpm];
    let line = [], lineUnits = 0, wi = 0, warned = false;
    const flush = () => { if (line.length) out.push(line.join(' ')); line = []; lineUnits = 0; };
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.rest) {
        line.push('\\rest:' + this.timeToken(ev.units));
        lineUnits += ev.units;
        i++;
      } else if (wi < words.length) {
        // A word takes as many notes as it has syllables; rests met inside move after it
        const w = words[wi++];
        const notes = [], rests = [];
        while (i < events.length && notes.length < w.syl) {
          if (events[i].rest) rests.push(events[i]); else notes.push(events[i]);
          i++;
        }
        line.push('\\note:' + notes.map(e => this.noteName(e.midi)).join(',') +
          ' \\time:' + notes.map(e => this.timeToken(e.units)).join(',') + ' ' + w.text);
        for (const r of rests) line.push('\\rest:' + this.timeToken(r.units));
        lineUnits += notes.concat(rests).reduce((s, e) => s + e.units, 0);
      } else {
        line.push('\\note:' + this.noteName(ev.midi) + ' \\time:' + this.timeToken(ev.units) + ' la');
        lineUnits += ev.units;
        i++;
      }
      if (lineUnits >= 32 || (ev.rest && lineUnits >= 16)) flush();
    }
    flush();
    if (wi < words.length) warned = true;
    return { text: out.join('\n'), unusedWords: warned ? words.slice(wi).map(w => w.text) : [] };
  },

  // Full analysis of decoded samples
  analyze(x, lyrics, lang) {
    const tr = this.track(x);
    const notes = this.segment(tr);
    const bpm = this.estimateTempo(notes);
    const events = this.quantize(notes, bpm);
    const res = this.toText(events, bpm, lyrics, lang);
    return { track: tr, notes, bpm, events, text: res.text, unusedWords: res.unusedWords, duration: x.length / this.SR };
  }
};
