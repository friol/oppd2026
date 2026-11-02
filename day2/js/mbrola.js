// MBROLA mode: diphone concatenation with real recorded voices.
//
// The MBROLA program itself (mbrola/mbrola.js: the original C sources compiled to WebAssembly,
// AGPL, see mbrola/build.sh) runs on Emscripten's in-memory file system: the voice database and
// a .pho file (phone, duration in ms, pitch points) go in, 16-bit samples at 16 kHz come out.
// The voices (mbrola/voices/, each with its license) are loaded on demand, as scripts so that
// the page also works from file://. Durations, F0 and singing come from our prosody; MBROLA
// only picks the diphones and reshapes them (MBR-PSOLA).

// One recorded voice per language, with the vocal tract scale of its speaker (male = 1, as the
// fscale of the app voices). The other app voices are obtained by scaling the tract: durations
// x k and F0 / k into MBROLA, then the output is resampled by k (k = app fscale / voice fscale)
const MBROLA_VOICES = {
  it: { id: 'it3', fscale: 1 },      // Italian male
  en: { id: 'us1', fscale: 1.16 }    // American English female
};

// Our phonemes -> SAMPA symbols of the voices (it3 and it4 share one set, us1 and us2 another)
const MBROLA_SAMPA = {
  it: {
    a: 'a', e: 'e', E: 'E', i: 'i', o: 'o', O: 'O', u: 'u', W: 'w', Y: 'j',
    P: 'p', B: 'b', T: 't', D: 'd', K: 'k', G: 'g', F: 'f', V: 'v', S: 's', Z: 'z', SH: 'S', ZH: 'Z',
    TS: 'ts', DZ: 'dz', CH: 'tS', JH: 'dZ', M: 'm', N: 'n', NG: 'ng', NY: 'J', Ll: 'l', L: 'l', LY: 'L', r: 'r', R: 'r',
    // English sounds in Italian text: the nearest Italian ones
    IY: 'i', IH: 'i', EH: 'E', AE: 'E', AA: 'a', AO: 'O', AH: 'a', UH: 'u', ER: 'e', AX: 'e', UW: 'u',
    EY: 'e', AY: 'a', AW: 'a', OY: 'O', OW: 'o', TH: 't', DH: 'd', HH: '_'
  },
  en: {
    IY: 'i', IH: 'I', EH: 'E', AE: '{', AA: 'A', AO: 'O', AH: 'V', UH: 'U', ER: 'r=', AX: '@',
    EY: 'EI', AY: 'AI', AW: 'aU', OY: 'OI', OW: '@U', UW: 'u', W: 'w', Y: 'j', R: 'r', L: 'l', Ll: 'l',
    M: 'm', N: 'n', NG: 'N', F: 'f', V: 'v', TH: 'T', DH: 'D', S: 's', Z: 'z', SH: 'S', ZH: 'Z', HH: 'h',
    P: 'p', B: 'b', T: 't', D: 'd', K: 'k', G: 'g', CH: 'tS', JH: 'dZ',
    // Italian sounds in English text
    a: 'A', e: 'EI', E: 'E', i: 'i', o: '@U', O: 'O', u: 'u', r: 'r', TS: 'ts', DZ: 'dz', NY: 'n', LY: 'l'
  }
};
// Replacements tried, in order, when a diphone is missing from the voice
const MBROLA_ALT = {
  E: ['e'], O: ['o'], e: ['E'], o: ['O'], j: ['i'], w: ['u'], nf: ['n'], ng: ['n'], J: ['n'], L: ['l'], Z: ['dZ', 'S'],
  ts: ['t'], dz: ['d'], p_h: ['p'], t_h: ['t'], k_h: ['k'], 'r=': ['@']
};

const Mbrola = {
  module: null,
  voices: {},        // id -> Set of available diphones "a-b"
  loading: null,

  // ---------- Loading ----------
  loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('cannot load ' + src));
      document.head.appendChild(s);
    });
  },

  // Voices needed by a text: one per language used
  voicesFor(settings, text) {
    const langs = new Set([settings.lang]);
    for (const it of Parser.parse(text, { lang: settings.lang, tempo: settings.tempo }).items) if (it.lang) langs.add(it.lang);
    return [...langs].map(l => MBROLA_VOICES[l].id);
  },

  isReady(ids) {
    return !!this.module && ids.every(id => this.voices[id]);
  },

  // Loads the program and the voices (once each)
  async prepare(settings, text) {
    const ids = this.voicesFor(settings, text);
    if (this.isReady(ids)) return;
    if (!this.module) {
      if (typeof createMbrola === 'undefined') await this.loadScript('mbrola/mbrola.js');
      this.module = await createMbrola({ print: () => {}, printErr: () => {} });
    }
    for (const id of ids) {
      if (this.voices[id]) continue;
      if (!(window.MBROLA_DATA && MBROLA_DATA[id])) await this.loadScript('mbrola/voices/' + id + '.js');
      const bin = atob(MBROLA_DATA[id]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      delete MBROLA_DATA[id];
      this.module.FS.writeFile('/' + id, bytes);
      this.voices[id] = this.diphones(bytes);
    }
  },

  // Names of the diphones in a voice database: header, then one index entry per diphone
  // (left and right phone as zero-terminated strings, half-segment, frame counts) and
  // finally the copies (old name -> new name) that reuse existing waveforms
  diphones(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    let p = 11;
    const total = dv.getInt16(p, true); p += 2;
    let marks = dv.getUint16(p, true); p += 2;
    if (marks === 0) { marks = dv.getInt32(p, true); p += 4; }
    p += 4 + 2 + 1 + 1;   // raw size, frequency, MBR period, coding
    const str = () => { let s = ''; while (b[p]) s += String.fromCharCode(b[p++]); p++; return s; };
    const set = new Set();
    let n = 0, frames = 0;
    for (; n < total && frames !== marks; n++) {
      const l = str(), r = str();
      p += 2;
      frames += b[p];
      p += 2;
      set.add(l + '-' + r);
    }
    for (; n < total; n++) { str(); str(); set.add(str() + '-' + str()); }
    return set;
  },

  // Runs the MBROLA program on a .pho text; returns 16-bit samples at 16 kHz
  run(id, pho) {
    const M = this.module;
    M.FS.writeFile('/in.pho', pho);
    M._mbrola_reset();
    M.callMain(['-e', '/' + id, '/in.pho', '/out.raw']);
    const b = M.FS.readFile('/out.raw');
    return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length & ~1)));
  },

  // ---------- Phones -> .pho ----------

  // MBROLA symbol of one of our phones (Italian stressed vowels carry a 1, English stops
  // followed by aspiration use the aspirated allophones)
  symbol(p, next, lang) {
    if (p.ph === '_') return '_';
    let s = MBROLA_SAMPA[lang][p.ph] || '_';
    if (lang === 'it') {
      if (isVowel(p.ph) && p.stress) s += '1';
      if (s === 'n' && next && /^[FV]$/.test(next.ph)) s = 'nf';
      if (s === 'n' && next && /^[KG]$/.test(next.ph)) s = 'ng';
    } else if (/^[ptk]$/.test(s) && next && next.t - (p.t + p.dur) > 0.01) s += '_h';
    return s;
  },

  // Chooses, for every phone, the symbol or a replacement so that the diphones exist (Viterbi
  // over the candidates: a replacement costs 1, a missing diphone 10)
  fix(syms, set) {
    const cands = syms.map(s => {
      const c = [s];
      if (/1$/.test(s)) c.push(s.slice(0, -1));
      for (const a of MBROLA_ALT[s.replace(/1$/, '')] || []) { c.push(a + (/1$/.test(s) ? '1' : '')); c.push(a); }
      return [...new Set(c)];
    });
    let cost = cands[0].map((_, j) => j), back = [];
    for (let i = 1; i < syms.length; i++) {
      const nc = [], bk = [];
      cands[i].forEach((s, j) => {
        let best = Infinity, arg = 0;
        cands[i - 1].forEach((q, k) => {
          const c = cost[k] + (set.has(q + '-' + s) ? 0 : 10) + j;
          if (c < best) { best = c; arg = k; }
        });
        nc.push(best); bk.push(arg);
      });
      cost = nc; back.push(bk);
    }
    let j = cost.indexOf(Math.min(...cost));
    const out = new Array(syms.length);
    for (let i = syms.length - 1; i >= 0; i--) { out[i] = cands[i][j]; if (i) j = back[i - 1][j]; }
    return out;
  },

  // .pho text for phones [a, b) of the utterance; k = vocal tract factor (durations x k, F0 / k)
  pho(fr, ph, a, b, lang, id, k) {
    const SR = Klatt.SR, step = fr.step;
    const syms = [], rows = [];
    for (let i = a; i < b; i++) {
      const p = ph[i], next = ph[i + 1];
      const t1 = i + 1 < ph.length ? next.t : p.t + p.dur;
      syms.push(this.symbol(p, next, lang));
      // Duration from the start of this phone to the start of the next one (it includes the
      // aspiration that the prosody inserts after English stops); rounded on the running total
      const ms = Math.round(t1 * 1000 * k) - Math.round(p.t * 1000 * k);
      // Pitch points every ~20 ms
      const pts = [];
      const n = Math.max(1, Math.round((t1 - p.t) / 0.02));
      for (let q = 0; q <= n; q++) {
        const t = p.t + (t1 - p.t) * q / n;
        const f0 = fr.f0[Math.min(fr.n - 1, Math.floor(t * SR / step))];
        // MBROLA truncates the period to whole samples at 16 kHz (always sharp, up to half a
        // semitone on high notes): ask for the pitch whose truncation is the nearest period
        pts.push(Math.round(100 * q / n) + ' ' + (16000 / (Math.round(16000 * k / f0) + 0.5)).toFixed(2));
      }
      rows.push([ms, pts.join(' ')]);
    }
    const fixed = this.fix(syms, this.voices[id]);
    return fixed.map((s, i) => s + ' ' + Math.max(1, rows[i][0]) + (s === '_' ? '' : ' ' + rows[i][1])).join('\n') + '\n';
  },

  // ---------- Rendering ----------
  render(fr, voice) {
    const SR = Klatt.SR, ph = fr.built.phones;
    const out = new Float32Array(fr.n * fr.step);
    // Runs of phones in the same language (silences stay with the current run)
    let a = 0;
    while (a < ph.length) {
      const lang = (ph.slice(a).find(p => p.lang) || {}).lang || 'it';
      let b = a + 1;
      while (b < ph.length && !(ph[b].lang && ph[b].lang !== lang)) b++;
      const { id, fscale } = MBROLA_VOICES[lang];
      const k = voice.fscale / fscale;
      const s = this.run(id, this.pho(fr, ph, a, b, lang, id, k));
      // 16 kHz (times k: k > 1 shorter tract and higher formants, k < 1 longer) -> SR, cubic
      const ratio = 16000 * k / SR, o0 = Math.round(ph[a].t * SR);
      for (let j = 0; o0 + j < out.length; j++) {
        const x = j * ratio, i = Math.floor(x), f = x - i;
        if (i + 2 >= s.length) break;
        const y0 = s[Math.max(0, i - 1)], y1 = s[i], y2 = s[i + 1], y3 = s[i + 2];
        out[o0 + j] += (y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)))) / 32768;
      }
      a = b;
    }
    return out;
  }
};
