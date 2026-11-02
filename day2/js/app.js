// Klatt Vox UI: controls, playback with Web Audio, spectrogram view.

const STORE_KEY = 'klattvox.v1';
const DEFAULTS = { lang: 'it', voice: 'male', engine: 'klatt', rate: 1, pitch: 0, tempo: 100, transpose: 0, vibrato: 1, text: PRESETS[0].text };

const App = {
  settings: null,
  ctx: null,
  source: null,
  result: null,
  resultKey: '',
  playStart: 0,
  specImage: null,
  raf: 0,
  analysis: null,   // last audio transcription, shown as a piano roll
  view: 'synth',    // 'synth' = spectrogram of the synthesis, 'analysis' = piano roll

  init() {
    this.settings = Object.assign({}, DEFAULTS, this.load());
    if (!ENGINES[this.settings.engine]) this.settings.engine = DEFAULTS.engine;
    this.$ = id => document.getElementById(id);
    this.text = this.$('text');
    this.canvas = this.$('spec');
    this.text.value = this.settings.text;

    this.bindSeg('lang');
    this.bindSeg('voice');
    this.bindSeg('engine');
    this.engineChanged();
    const fmt = {
      rate: v => v.toFixed(2) + '×',
      pitch: v => (v > 0 ? '+' : '') + v + ' st',
      tempo: v => v + ' bpm',
      transpose: v => (v > 0 ? '+' : '') + v + ' st',
      vibrato: v => v.toFixed(1)
    };
    for (const k in fmt) {
      const input = this.$(k), out = input.nextElementSibling;
      input.value = this.settings[k];
      out.textContent = fmt[k](+input.value);
      input.addEventListener('input', () => {
        this.settings[k] = +input.value;
        out.textContent = fmt[k](+input.value);
        this.save();
      });
    }

    const presets = this.$('presets');
    PRESETS.forEach(p => {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.addEventListener('click', () => {
        this.text.value = p.text;
        this.settings.lang = p.lang;
        this.settings.voice = p.voice;
        this.refreshSeg('lang');
        this.refreshSeg('voice');
        this.engineChanged();
        this.save();
        this.speak();
      });
      presets.appendChild(b);
    });

    this.text.addEventListener('input', () => this.save());
    this.text.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.speak(); }
    });
    this.$('speak').addEventListener('click', () => this.toggle());
    this.$('stop').addEventListener('click', () => this.stop());
    this.$('save').addEventListener('click', () => this.download());
    this.$('theme').addEventListener('click', () => this.cycleTheme());
    this.showTheme();
    this.$('load').addEventListener('click', () => this.$('file').click());
    this.$('file').addEventListener('change', e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) this.loadAudio(f);
    });
    window.addEventListener('resize', () => this.draw());
    this.draw();
  },

  bindSeg(key) {
    this.$(key).querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        this.settings[key] = b.dataset.v;
        this.refreshSeg(key);
        if (key === 'engine' || key === 'lang') this.engineChanged();
        this.save();
      });
    });
    this.refreshSeg(key);
  },

  // Some engines allow only some voices (Piper: female) and can start loading in the background
  engineChanged() {
    const eng = ENGINES[this.settings.engine];
    const allowed = eng.voices || null;
    this.$('voice').querySelectorAll('button').forEach(b => {
      b.disabled = !!allowed && !allowed.includes(b.dataset.v);
      b.title = b.disabled ? 'Not available with the ' + eng.label + ' engine' : '';
    });
    if (allowed && !allowed.includes(this.settings.voice)) {
      this.settings.voice = allowed[0];
      this.refreshSeg('voice');
      this.save();
    }
    if (eng.preload) eng.preload(this.settings);
  },

  refreshSeg(key) {
    this.$(key).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.v === this.settings[key]));
  },

  load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  },

  save() {
    this.settings.text = this.text.value;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ }
  },

  // ---------- Theme: auto (system) -> light -> dark ----------
  cycleTheme() {
    const order = ['auto', 'light', 'dark'];
    const cur = document.documentElement.dataset.theme || 'auto';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    if (next === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    try {
      if (next === 'auto') localStorage.removeItem('klattvox.theme');
      else localStorage.setItem('klattvox.theme', next);
    } catch (e) { /* storage unavailable */ }
    this.showTheme();
  },

  showTheme() {
    const labels = { auto: '◐ AUTO', light: '☀ LIGHT', dark: '☾ DARK' };
    this.$('theme').textContent = labels[document.documentElement.dataset.theme || 'auto'];
  },

  setStatus(s, led) {
    this.$('status').textContent = s;
    this.$('led').className = 'led' + (led ? ' ' + led : '');
  },

  // ---------- Audio -> notes ----------
  async loadAudio(file) {
    this.stop();
    this.setStatus('ANALYZING', 'busy');
    try {
      const x = await Transcriber.decode(await file.arrayBuffer());
      const a = Transcriber.analyze(x, this.$('lyrics').value, this.settings.lang);
      if (!a.notes.length) throw new Error('no pitched voice found');
      this.analysis = a;
      this.analysis.name = file.name;
      this.view = 'analysis';
      this.text.value = a.text;
      this.save();
      const warn = a.unusedWords.length ? ['Lyrics left over (not enough notes): ' + a.unusedWords.join(' ')] : [];
      this.$('warnings').textContent = warn.join(' · ');
      this.$('phon').innerHTML = '';
      this.$('info').textContent = file.name + ' · ' + a.duration.toFixed(2) + ' s · ' + a.notes.length + ' notes · ' + a.bpm + ' bpm';
      this.setStatus('READY');
    } catch (err) {
      this.$('warnings').textContent = 'Could not transcribe ' + file.name + ': ' + err.message;
      this.setStatus('READY');
    }
    this.draw();
  },

  // Piano roll of the analysed file: raw pitch contour and quantized notes
  drawAnalysis(g, w, h) {
    const a = this.analysis, strip = 22, ph = h - strip;
    let lo = Infinity, hi = -Infinity;
    for (const n of a.notes) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }
    lo -= 3; hi += 3;
    if (hi - lo < 14) { const c = (hi + lo) / 2; lo = Math.floor(c - 7); hi = Math.ceil(c + 7); }
    const rowH = ph / (hi - lo + 1);
    const y = m => ph - (m - lo + 0.5) * rowH;
    const tx = t => t / a.duration * w;
    g.font = '10px ui-monospace, Consolas, monospace';
    // Semitone lanes (darker for black keys) and C labels
    for (let m = lo; m <= hi; m++) {
      const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
      g.fillStyle = black ? '#080907' : '#0d0f0b';
      g.fillRect(0, y(m) - rowH / 2, w, rowH);
      if (m % 12 === 0) {
        g.fillStyle = 'rgba(156, 240, 138, 0.45)';
        g.fillText(Transcriber.noteName(m), 4, y(m) + 3);
      }
    }
    // Quantized notes
    for (const n of a.notes) {
      const x0 = tx(n.t), x1 = tx(n.end);
      g.fillStyle = 'rgba(255, 181, 71, 0.28)';
      g.fillRect(x0, y(n.midi) - rowH / 2 + 1, Math.max(2, x1 - x0), rowH - 2);
      g.strokeStyle = '#ffb547';
      g.strokeRect(x0 + 0.5, y(n.midi) - rowH / 2 + 1.5, Math.max(2, x1 - x0 - 1), rowH - 3);
      if (x1 - x0 > 24 && rowH > 9) {
        g.fillStyle = '#ffb547';
        g.fillText(Transcriber.noteName(n.midi), x0 + 3, y(n.midi) + 3);
      }
    }
    // Raw pitch contour
    const tr = a.track;
    g.strokeStyle = '#9cf08a';
    g.lineWidth = 1.5;
    g.beginPath();
    let pen = false;
    for (let i = 0; i < tr.midi.length; i++) {
      const m = tr.midi[i];
      if (!m) { pen = false; continue; }
      const px = tx(i * tr.hop + Transcriber.WIN / 2), py = y(m);
      if (pen) g.lineTo(px, py); else g.moveTo(px, py);
      pen = true;
    }
    g.stroke();
    g.lineWidth = 1;
    // Time strip
    g.fillStyle = '#0b0c09';
    g.fillRect(0, ph, w, strip);
    g.fillStyle = '#7d8470';
    g.textBaseline = 'middle';
    const step = a.duration > 20 ? 5 : a.duration > 8 ? 2 : 1;
    for (let t = 0; t < a.duration; t += step) g.fillText(t + 's', tx(t) + 3, ph + strip / 2);
    g.textBaseline = 'alphabetic';
  },

  // One button: SPEAK -> PAUSE while playing -> RESUME while paused
  setButton(state) {
    const labels = { speak: '▶ SPEAK', pause: '❚❚ PAUSE', resume: '▶ RESUME' };
    this.$('speak').textContent = labels[state];
  },

  toggle() {
    if (!this.source) { this.speak(); return; }
    if (this.ctx.state === 'running') {
      this.ctx.suspend();
      cancelAnimationFrame(this.raf);
      this.setStatus('PAUSED', 'busy');
      this.setButton('resume');
    } else {
      this.ctx.resume();
      this.setStatus('SPEAKING', 'on');
      this.setButton('pause');
      this.animate();
    }
  },

  // Synthesize the current text (cached while text and settings are unchanged)
  render() {
    const s = Object.assign({}, this.settings);
    delete s.text;
    const key = JSON.stringify(s) + '\u0000' + this.text.value;
    if (this.result && this.resultKey === key) return this.result;
    const t0 = performance.now();
    this.result = TTS.synthesize(this.text.value, s);
    this.resultKey = key;
    const ms = performance.now() - t0;
    this.$('warnings').textContent = this.result.warnings.join(' · ');
    this.$('info').textContent = this.result.engine + ' · ' + (this.result.samples.length / this.result.sampleRate).toFixed(2) + ' s · ' +
      this.result.sampleRate + ' Hz · rendered in ' + ms.toFixed(0) + ' ms';
    this.buildSpectrogram();
    this.showTranscription();
    return this.result;
  },

  // Engines with external data (MBROLA voices) load it first; resolves false on failure
  async prepare() {
    const eng = ENGINES[this.settings.engine];
    if (!eng.prepare) return true;
    this.setStatus('LOADING VOICE', 'busy');
    try {
      await eng.prepare(this.settings, this.text.value);
      return true;
    } catch (err) {
      this.$('warnings').textContent = 'Could not load the ' + eng.label + ' engine: ' + err.message;
      this.setStatus('READY');
      return false;
    }
  },

  async speak() {
    this.stop();
    if (!await this.prepare()) return;
    this.setStatus('SYNTHESIZING', 'busy');
    // Let the status repaint before the (synchronous) synthesis
    setTimeout(() => {
      const r = this.render();
      this.view = 'synth';
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const buf = this.ctx.createBuffer(1, r.samples.length, r.sampleRate);
      buf.copyToChannel(r.samples, 0);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.onended = () => {
        if (this.source !== src) return;
        this.source = null;
        this.setStatus('READY');
        this.setButton('speak');
        cancelAnimationFrame(this.raf);
        this.draw();
      };
      this.source = src;
      this.playStart = this.ctx.currentTime + 0.05;
      src.start(this.playStart);
      this.setStatus('SPEAKING', 'on');
      this.setButton('pause');
      this.animate();
    }, 20);
  },

  stop() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      try { s.stop(); } catch (e) { /* already stopped */ }
    }
    cancelAnimationFrame(this.raf);
    this.setStatus('READY');
    this.setButton('speak');
    this.draw();
  },

  async download() {
    if (!await this.prepare()) return;
    this.setStatus('READY');
    const r = this.render();
    const blob = new Blob([TTS.wav(r.samples, r.sampleRate)], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'klatt-vox.wav';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  animate() {
    this.draw();
    if (this.source) this.raf = requestAnimationFrame(() => this.animate());
  },

  // ---------- Transcription ----------
  showTranscription() {
    const box = this.$('phon');
    box.innerHTML = '';
    const words = this.result.items.filter(it => it.type === 'word');
    const tr = TTS.transcription(this.result.items);
    words.forEach((w, i) => {
      const el = document.createElement('span');
      el.className = 'w';
      const b = document.createElement('b');
      b.textContent = w.text + (w.sung ? ' ♪' : '');
      const s = document.createElement('span');
      s.textContent = tr[i];
      el.append(b, s);
      box.appendChild(el);
    });
  },

  // ---------- Spectrogram ----------
  buildSpectrogram() {
    const r = this.result, x = r.samples, sr = r.sampleRate;
    const N = 512, hop = 96, maxHz = 6500;
    const bins = Math.floor(N / 2 * maxHz / (sr / 2));
    const cols = Math.max(1, Math.floor((x.length - N) / hop));
    const img = new ImageData(cols, bins);
    const re = new Float32Array(N), im = new Float32Array(N);
    const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    const db = new Float32Array(cols * bins);
    let max = -200;
    for (let c = 0; c < cols; c++) {
      for (let i = 0; i < N; i++) { re[i] = x[c * hop + i] * win[i]; im[i] = 0; }
      this.fft(re, im);
      for (let k = 0; k < bins; k++) {
        const v = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
        db[c * bins + k] = v;
        if (v > max) max = v;
      }
    }
    const range = 70;
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < bins; k++) {
        const v = Math.max(0, Math.min(1, (db[c * bins + k] - max + range) / range));
        const [R, G, B] = this.heat(v);
        const p = ((bins - 1 - k) * cols + c) * 4;
        img.data[p] = R; img.data[p + 1] = G; img.data[p + 2] = B; img.data[p + 3] = 255;
      }
    }
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = bins;
    off.getContext('2d').putImageData(img, 0, 0);
    this.specImage = { canvas: off, maxHz, duration: x.length / sr };
  },

  heat(v) {
    const stops = [[0, [5, 6, 4]], [0.35, [18, 60, 24]], [0.62, [120, 215, 105]], [0.85, [255, 181, 71]], [1, [255, 248, 225]]];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        const t = (v - a) / (b - a);
        return ca.map((c, j) => c + (cb[j] - c) * t);
      }
    }
    return stops[stops.length - 1][1];
  },

  // In-place radix-2 FFT
  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  },

  draw() {
    const cv = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#050604';
    g.fillRect(0, 0, w, h);
    const analysisView = this.view === 'analysis' && this.analysis;
    this.$('scope-title').textContent = analysisView ? 'PIANO ROLL · DETECTED PITCH' : 'SPECTROGRAM';
    if (analysisView) { this.drawAnalysis(g, w, h); return; }
    const strip = 22;
    const ph = h - strip;

    // Frequency grid
    g.font = '10px ui-monospace, Consolas, monospace';
    const maxHz = this.specImage ? this.specImage.maxHz : 6500;
    if (this.specImage) {
      g.imageSmoothingEnabled = true;
      g.drawImage(this.specImage.canvas, 0, 0, w, ph);
    }
    g.strokeStyle = 'rgba(156, 240, 138, 0.12)';
    g.fillStyle = 'rgba(156, 240, 138, 0.45)';
    for (let f = 1000; f < maxHz; f += 1000) {
      const y = ph - f / maxHz * ph;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      g.fillText(f / 1000 + 'k', 4, y - 3);
    }

    // Phoneme strip
    g.fillStyle = '#0b0c09';
    g.fillRect(0, ph, w, strip);
    if (!this.result) {
      g.fillStyle = '#5a6050';
      g.fillText('press SPEAK to synthesize', 12, ph / 2);
      return;
    }
    const dur = this.specImage.duration;
    const tx = t => t / dur * w;
    const now = this.source ? this.ctx.currentTime - this.playStart : -1;
    g.textBaseline = 'middle';
    for (const p of this.result.built.phones) {
      if (p.ph === '_') continue;
      const x0 = tx(p.t), x1 = tx(p.t + p.dur);
      const active = now >= p.t && now < p.t + p.dur;
      g.fillStyle = active ? 'rgba(255, 181, 71, 0.25)' : (isVowel(p.ph) ? 'rgba(156, 240, 138, 0.08)' : 'transparent');
      g.fillRect(x0, ph, x1 - x0, strip);
      g.strokeStyle = 'rgba(125, 132, 112, 0.35)';
      g.beginPath(); g.moveTo(x0 + 0.5, ph); g.lineTo(x0 + 0.5, h); g.stroke();
      if (x1 - x0 > 12) {
        g.fillStyle = active ? '#ffb547' : (isVowel(p.ph) ? '#9cf08a' : '#7d8470');
        g.fillText(p.ph, x0 + 3, ph + strip / 2);
      }
    }
    g.textBaseline = 'alphabetic';

    // Playhead
    if (now >= 0) {
      const x = tx(now);
      g.strokeStyle = '#ffb547';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.lineWidth = 1;
    }
  }
};

App.init();
