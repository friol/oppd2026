// Piper mode: neural speech (VITS models run locally with onnxruntime-web, no network).
//
// One model per language (piper/models/, each with its model card). Our G2P phonemes are
// written in the espeak-ng IPA the models were trained on, turned into ids with the model's
// phoneme_id_map, and the model returns the waveform at 22050 Hz. The models choose their own
// durations and intonation, so the speed knob maps to length_scale while pitch and voice are
// ignored; sung words (\note, \time) go to MBROLA, which follows our notes and timing.
//
// The inference is asynchronous: prepare() synthesizes the spoken parts and render() puts
// them together with the sung parts. onnxruntime loads its WebAssembly with fetch and a
// dynamic import, which browsers block on file://: the page must be served over http.

const PIPER_MODELS = { it: 'it_IT-paola-medium', en: 'en_US-ljspeech-medium' };
const PIPER_SENTENCE_GAP = 0.2;   // seconds of silence between sentences (as piper does)

// Our phonemes -> espeak-ng IPA
const PIPER_IPA = {
  it: {
    a: 'a', e: 'e', E: 'ɛ', i: 'i', o: 'o', O: 'ɔ', u: 'u', W: 'w', Y: 'j',
    P: 'p', B: 'b', T: 't', D: 'd', K: 'k', G: 'ɡ', F: 'f', V: 'v', S: 's', Z: 'z', SH: 'ʃ', ZH: 'ʒ',
    TS: 'ts', DZ: 'dz', CH: 'tʃ', JH: 'dʒ', M: 'm', N: 'n', NG: 'ŋ', NY: 'ɲ', Ll: 'l', L: 'l', LY: 'ʎ', r: 'r', R: 'r',
    IY: 'i', IH: 'i', EH: 'ɛ', AE: 'ɛ', AA: 'a', AO: 'ɔ', AH: 'a', UH: 'u', ER: 'e', AX: 'e', UW: 'u',
    EY: 'ei', AY: 'ai', AW: 'au', OY: 'ɔi', OW: 'ou', TH: 't', DH: 'd', HH: ''
  },
  en: {
    IY: 'iː', IH: 'ɪ', EH: 'ɛ', AE: 'æ', AA: 'ɑː', AO: 'ɔː', AH: 'ʌ', UH: 'ʊ', ER: 'ɜː', AX: 'ə',
    EY: 'eɪ', AY: 'aɪ', AW: 'aʊ', OY: 'ɔɪ', OW: 'oʊ', UW: 'uː', W: 'w', Y: 'j', R: 'ɹ', L: 'l', Ll: 'l',
    M: 'm', N: 'n', NG: 'ŋ', F: 'f', V: 'v', TH: 'θ', DH: 'ð', S: 's', Z: 'z', SH: 'ʃ', ZH: 'ʒ', HH: 'h',
    P: 'p', B: 'b', T: 't', D: 'd', K: 'k', G: 'ɡ', CH: 'tʃ', JH: 'dʒ',
    a: 'ɑː', e: 'eɪ', E: 'ɛ', i: 'iː', o: 'oʊ', O: 'ɔː', u: 'uː', r: 'ɹ', TS: 'ts', DZ: 'dz', NY: 'nj', LY: 'lj'
  }
};

// Monosyllabic function words: unstressed, as espeak-ng writes them
const PIPER_UNSTRESSED = {
  it: new Set('il lo la i gli le l un uno una di a da in con su per tra fra e ed o ma se che chi non mi ti si ci vi ne del dal nel col sul al dei degli delle della dello alla allo agli alle sui coi nei'.split(' ')),
  en: new Set('a an the of to in on at by for from with and or but as if than that am is are was were be been has had have do does did can could will would shall should may might must i me my you your he him his she her it its we us our they them their this these those there'.split(' '))
};

const Piper = {
  ort: null,
  models: {},     // lang -> { session, config }
  audio: [],      // Float32Array per spoken chunk, filled by prepare()
  loading: null,   // preload in progress

  // ---------- Text -> chunks ----------

  // Consecutive items spoken in one language, or sung (rests go with the singing; a pause
  // stays with the chunk before it)
  chunks(items) {
    const out = [];
    items.forEach((it, i) => {
      let kind;
      if (it.type === 'word') kind = it.sung ? 'sung' : 'speak:' + it.lang;
      else if (it.type === 'rest') kind = 'sung';
      else kind = out.length ? out[out.length - 1].kind : null;
      if (!kind) return;
      const last = out[out.length - 1];
      if (last && last.kind === kind) last.items.push(i);
      else out.push({ kind, lang: kind.startsWith('speak:') ? kind.slice(6) : null, items: [i] });
    });
    return out;
  },

  // espeak-style IPA of one word: stress mark before the stressed vowel, Italian geminates
  // doubled and stressed vowels long in open syllables, American flap t
  ipa(word) {
    const ph = word.phones, lang = word.lang, T = PIPER_IPA[lang];
    const atonic = ph.filter(p => isVowel(p.ph)).length === 1 && PIPER_UNSTRESSED[lang].has(word.text.toLowerCase().replace(/'/g, ''));
    let s = '';
    ph.forEach((p, i) => {
      if (atonic) p = Object.assign({}, p, { stress: 0 });
      const next = ph[i + 1], prev = ph[i - 1];
      let x = T[p.ph] !== undefined ? T[p.ph] : (PIPER_IPA[lang === 'it' ? 'en' : 'it'][p.ph] || '');
      if (lang === 'it') {
        if (p.ph === 'N' && next && /^[FV]$/.test(next.ph)) x = 'ɱ';
        if (p.ph === 'N' && next && /^[KG]$/.test(next.ph)) x = 'ŋ';
        if (p.gem) x = x[0] + x;
        if (isVowel(p.ph) && p.stress) {
          const open = next && !next.gem && (isVowel(next.ph) || (ph[i + 2] && isVowel(ph[i + 2].ph)));
          x = 'ˈ' + x + (open ? 'ː' : '');
        }
      } else {
        if (p.ph === 'ER' && !p.stress) x = 'ɚ';
        if (p.ph === 'AH' && !p.stress) x = 'ə';
        if (p.ph === 'T' && prev && next && isVowel(prev.ph) && isVowel(next.ph) && !next.stress) x = 'ɾ';
        if (isVowel(p.ph) && p.stress) x = 'ˈ' + x;
      }
      s += x;
    });
    return s;
  },

  // Sentences of a spoken chunk, as IPA strings with punctuation
  sentences(items, chunk) {
    const out = [];
    let cur = '';
    for (const i of chunk.items) {
      const it = items[i];
      if (it.type !== 'word') continue;
      cur += (cur ? ' ' : '') + this.ipa(it) + (it.punct || '');
      if (/[.!?…]/.test(it.punct || '')) { out.push(cur); cur = ''; }
    }
    if (cur) out.push(cur + '.');
    return out;
  },

  // ---------- Loading and inference ----------
  loadScript(src) { return Mbrola.loadScript(src); },

  async loadOrt() {
    if (location.protocol === 'file:') {
      throw new Error('Piper needs the page served over http (for example http://localhost/oppd2026/day2/ with XAMPP), not opened as a file');
    }
    if (typeof ort === 'undefined') await this.loadScript('piper/ort/ort.wasm.min.js');
    ort.env.wasm.wasmPaths = new URL('piper/ort/', location.href).href;
    // Several threads only with cross-origin isolation (headers in .htaccess), otherwise one
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    // Model compilation and inference run in a Web Worker: the page stays responsive
    ort.env.wasm.proxy = true;
    return ort;
  },

  async loadModel(lang) {
    const name = 'piper/models/' + PIPER_MODELS[lang] + '.onnx';
    const config = await (await fetch(name + '.json')).json();
    const session = await this.ort.InferenceSession.create(name, { executionProviders: ['wasm'] });
    return { session, config };
  },

  async speak(lang, ipa, rate) {
    const { session, config } = this.models[lang], map = config.phoneme_id_map, inf = config.inference;
    const ids = [...map['^']];
    for (const ch of ipa) if (map[ch]) ids.push(...map[ch], ...map['_']);
    ids.push(...map['$']);
    const T = this.ort.Tensor;
    const res = await session.run({
      input: new T('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      input_lengths: new T('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new T('float32', Float32Array.from([inf.noise_scale, inf.length_scale / rate, inf.noise_w]), [3])
    });
    return res.output.data;
  },

  // Background loading of the runtime and of the model of the current language, so that the
  // first SPEAK does not wait for it (errors are reported later by prepare)
  preload(settings) {
    const go = async () => {
      if (!this.ort) this.ort = await this.loadOrt();
      if (!this.models[settings.lang]) this.models[settings.lang] = await this.loadModel(settings.lang);
    };
    if (!this.loading) this.loading = go().catch(() => {}).finally(() => { this.loading = null; });
    return this.loading;
  },

  // Loads what the text needs (models, MBROLA for the sung parts) and synthesizes the speech
  async prepare(settings, text) {
    if (this.loading) await this.loading;
    const items = Parser.parse(text, { lang: settings.lang, tempo: settings.tempo }).items;
    const chunks = this.chunks(items);
    if (chunks.some(c => c.kind === 'sung')) await Mbrola.prepare(settings, text);
    const spoken = chunks.filter(c => c.lang);
    if (spoken.length && !this.ort) this.ort = await this.loadOrt();
    for (const c of spoken) if (!this.models[c.lang]) this.models[c.lang] = await this.loadModel(c.lang);
    this.audio = [];
    for (const c of spoken) {
      const parts = [];
      for (const s of this.sentences(items, c)) parts.push(await this.speak(c.lang, s, settings.rate));
      const gap = Math.round(PIPER_SENTENCE_GAP * Klatt.SR);
      const out = new Float32Array(parts.reduce((n, p) => n + p.length + gap, 0));
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length + gap; }
      this.audio.push(out);
    }
  },

  // ---------- Rendering: spoken chunks from prepare(), sung chunks from MBROLA ----------
  render(fr, voice) {
    const SR = Klatt.SR, ph = fr.built.phones, items = fr.built.items;
    const pieces = [];
    let spoken = 0;
    for (const c of this.chunks(items)) {
      if (c.lang) { pieces.push(this.audio[spoken++] || new Float32Array(0)); continue; }
      // Sung: its phones, with the rests (silences without punctuation) around them
      const set = new Set(c.items);
      let a = ph.findIndex(p => set.has(p.word)), b = -1;
      ph.forEach((p, i) => { if (set.has(p.word)) b = i + 1; });
      if (a < 0) {   // rests only
        const d = c.items.reduce((s, i) => s + (items[i].dur || 0), 0);
        pieces.push(new Float32Array(Math.round(d * SR)));
        continue;
      }
      while (a > 0 && ph[a - 1].ph === '_' && !ph[a - 1].punct && a - 1 > 0) a--;
      while (b < ph.length - 1 && ph[b].ph === '_' && !ph[b].punct) b++;
      const out = new Float32Array(Math.round((ph[b - 1].t + ph[b - 1].dur - ph[a].t) * SR) + 1);
      Mbrola.renderRange(fr, voice, a, b, out, 0);
      pieces.push(out);
    }
    const lead = Math.round(0.1 * SR), tail = Math.round(0.2 * SR);
    const out = new Float32Array(lead + pieces.reduce((n, p) => n + p.length, 0) + tail);
    let o = lead;
    for (const p of pieces) { out.set(p, o); o += p.length; }
    return out;
  }
};
