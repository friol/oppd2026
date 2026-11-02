// Text-to-speech pipeline: text -> parser -> prosody -> Klatt -> samples.

const VOICES = {
  male:   { label: 'Male',   f0: 110, fscale: 1.0,  oq: 0.55, tilt: 4,  breath: 0.05, jitter: 0.008, shimmer: 0.04 },
  female: { label: 'Female', f0: 205, fscale: 1.16, oq: 0.65, tilt: 7,  breath: 0.18, jitter: 0.008, shimmer: 0.04 },
  child:  { label: 'Child',  f0: 280, fscale: 1.3,  oq: 0.62, tilt: 6,  breath: 0.12, jitter: 0.006, shimmer: 0.03 },
  robot:  { label: 'Robot',  f0: 100, fscale: 1.0,  oq: 0.4,  tilt: 0,  breath: 0,    jitter: 0,     shimmer: 0, monotone: true }
};

const TTS = {
  // settings: { lang, voice, engine, rate, pitch (semitones), tempo, vibrato (0..2), transpose }
  synthesize(text, settings) {
    const base = VOICES[settings.voice] || VOICES.male;
    const engine = ENGINES[settings.engine] || ENGINES.klatt;
    const voice = Object.assign({}, base, {
      f0: base.f0 * Math.pow(2, settings.pitch / 12),
      rate: settings.rate,
      transpose: settings.transpose || 0,
      name: settings.voice
    }, engine.voice);
    const { items, warnings } = Parser.parse(text, { lang: settings.lang, tempo: settings.tempo });
    const built = Prosody.build(items, voice);
    built.vibDepth = base.monotone ? 0 : settings.vibrato;
    const segs = Prosody.segments(built.phones, voice);
    const fr = Prosody.frames(segs, built, voice, Klatt.SR, Klatt.STEP);
    if (engine.shape) engine.shape(fr, built, voice, segs);
    const samples = Klatt.normalize(engine.render(fr, voice));
    return { samples, items, warnings, built, segs, frames: fr, sampleRate: Klatt.SR, engine: engine.label };
  },

  // Readable transcription: one group of phonemes per word, stressed vowels marked with '
  transcription(items) {
    return items.filter(it => it.type === 'word').map(it =>
      it.phones.map(p => (p.stress && isVowel(p.ph) ? "'" : '') + p.ph + (p.gem ? ':' : '')).join(' ')
    );
  },

  wav(samples, sr) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const dv = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
    return buf;
  }
};
