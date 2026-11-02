// Text parser: splits the input into words and escape sequences.
//
// Escapes (they apply to the next word):
//   \note:B4        sing the word on this pitch (also C#5, Eb3, SI4, sol3, ...)
//   \note:G4,A4     one note per syllable (extra notes become a melisma on the last syllable)
//   \time:4         duration of the word: 1 whole, 2 half, 4 quarter, 8, 16; "4." dotted, "2+8" tied
//   \time:8.,16     one duration per note
// Escapes that stay active until changed:
//   \tempo:120      beats (quarter notes) per minute
//   \lang:it|en     language of the following words
// Other:
//   \rest:4         a silence of the given duration

const Parser = {
  NOTE_NAMES: { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 },
  SOLFEGE: { do: 0, re: 2, mi: 4, fa: 5, sol: 7, so: 7, la: 9, si: 11, ti: 11 },

  DIGITS: {
    it: ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove'],
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
  },

  // Returns { items, warnings }
  parse(text, opts) {
    let lang = opts.lang;
    let tempo = opts.tempo;
    let lastTimes = ['4'];
    let pendingNotes = null, pendingTimes = null;
    const items = [];
    const warnings = [];
    const re = /\\([a-zA-Z]+)(?::([^\s\\]*))?|[^\s\\]+/g;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) {
        const name = m[1].toLowerCase();
        const val = (m[2] || '').replace(/[,;!?]+$/, '');
        switch (name) {
          case 'note': {
            const notes = val.replace(/\.+$/, '').split(',').map(s => this.noteFreq(s));
            if (notes.some(f => !f)) warnings.push('Invalid note: \\note:' + val);
            else pendingNotes = notes;
            break;
          }
          case 'time': {
            const times = val.split(',').filter(s => s);
            if (!times.length || times.some(s => !this.timeBeats(s))) warnings.push('Invalid duration: \\time:' + val);
            else pendingTimes = times;
            break;
          }
          case 'tempo': {
            const t = parseFloat(val);
            if (t >= 20 && t <= 400) tempo = t; else warnings.push('Invalid tempo: \\tempo:' + val);
            break;
          }
          case 'lang': {
            const l = val.toLowerCase();
            if (l === 'it' || l === 'en') lang = l; else warnings.push('Unknown language: \\lang:' + val);
            break;
          }
          case 'rest': {
            const b = this.timeBeats(val || '4');
            if (b) items.push({ type: 'rest', dur: b * 60 / tempo }); else warnings.push('Invalid rest: \\rest:' + val);
            break;
          }
          default:
            warnings.push('Unknown escape: \\' + m[1]);
        }
        continue;
      }

      // A word token, possibly with punctuation around it
      const tok = m[0];
      const punctMatch = tok.match(/[.,;:!?…]+$/);
      const punct = punctMatch ? punctMatch[0][punctMatch[0].length - 1] : null;
      const core = tok.replace(/^[^\p{L}\d']+|[^\p{L}\d']+$/gu, '');
      if (!core) {
        if (punct) items.push({ type: 'pause', punct });
        continue;
      }
      let sung = null;
      if (pendingNotes || pendingTimes) {
        const times = pendingTimes || lastTimes;
        lastTimes = times;
        sung = {
          notes: pendingNotes,                                   // null = spoken pitch, sung timing
          times: times.map(s => this.timeBeats(s) * 60 / tempo)
        };
      }
      pendingNotes = pendingTimes = null;
      const phones = this.wordPhones(core, lang);
      if (phones.length) items.push({ type: 'word', text: core, lang, phones, sung, punct });
      if (punct && !sung) items.push({ type: 'pause', punct });
    }
    return { items, warnings };
  },

  wordPhones(word, lang) {
    const g2p = lang === 'it' ? ItalianG2P : EnglishG2P;
    const out = [];
    // Digits are read one by one; Italian elisions (l'amico) are joined into one word
    const parts = word.split(/(\d)/).filter(s => s);
    for (const part of parts) {
      if (/^\d$/.test(part)) {
        out.push(...g2p.convert(this.DIGITS[lang][+part]));
        continue;
      }
      const sub = lang === 'it' ? part.split(/['’]/).filter(s => s) : [part.replace(/’/g, "'")];
      for (const s of sub) out.push(...g2p.convert(s));
    }
    return out.filter(p => Phonemes[p.ph]);
  },

  // Frequency in Hz of a note name like A4, C#5, Bb3, SI4, sol#3
  noteFreq(s) {
    const m = s.trim().match(/^([a-gA-G]|do|re|mi|fa|sol|so|la|si|ti)(#|b|s)?(-?\d)$/i);
    if (!m) return 0;
    const name = m[1].toLowerCase();
    let semi = name.length === 1 ? this.NOTE_NAMES[name] : this.SOLFEGE[name];
    if (m[2] === '#' || m[2] === 's') semi++;
    if (m[2] === 'b') semi--;
    const midi = 12 * (parseInt(m[3], 10) + 1) + semi;
    return 440 * Math.pow(2, (midi - 69) / 12);
  },

  // Length in beats (quarter notes) of a duration like 4, 8., 2+8
  timeBeats(s) {
    let total = 0;
    for (const part of s.split('+')) {
      const m = part.trim().match(/^(\d+)(\.*)$/);
      if (!m || +m[1] <= 0) return 0;
      let beats = 4 / +m[1], add = beats;
      for (let k = 0; k < m[2].length; k++) { add /= 2; beats += add; }
      total += beats;
    }
    return total;
  }
};
