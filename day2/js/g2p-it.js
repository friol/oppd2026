// Italian letter-to-sound rules.
// Output: array of { ph, stress, gem } where stress is 1 on the stressed vowel and
// gem marks a geminate (double) consonant.

const ItalianG2P = {
  // Words whose i/u hiatus or stress the rules cannot guess
  exceptions: {
    mio: 'm i1 o', mia: 'm i1 a', mie: 'm i1 e', tuo: 't u1 o', tua: 't u1 a', tue: 't u1 e',
    suo: 's u1 o', sua: 's u1 a', sue: 's u1 e', zio: 'TS i1 o', zia: 'TS i1 a', via: 'v i1 a',
    io: 'i1 o', dio: 'd i1 o', addio: 'a d d i1 o', maria: 'm a r i1 a', poesia: 'p o e z i1 a',
    sciare: 'SH a1 r e', sintesi: 's i1 n t e z i', zucchero: 'TS u1 k k e r o', paura: 'p a u1 r a', trio: 't r i1 o', tuoi: 't w O1 i',
    farmacia: 'f a r m a CH i1 a', magia: 'm a JH i1 a', bugia: 'b u JH i1 a', energia: 'e n e r JH i1 a',
    musica: 'm u1 z i k a', medico: 'm E1 d i k o', camera: 'k a1 m e r a', tavola: 't a1 v o l a',
    subito: 's u1 b i t o', piccolo: 'p i1 k k o l o', numero: 'n u1 m e r o', telefono: 't e l E1 f o n o',
    macchina: 'm a1 k k i n a', albero: 'a1 l b e r o', isola: 'i1 z o l a', pagina: 'p a1 JH i n a',
    sabato: 's a1 b a t o', domenica: 'd o m e1 n i k a', martino: 'm a r t i1 n o', dormi: 'd O1 r m i',
    campane: 'k a m p a1 n e', suonano: 's w O1 n a n o', mattutino: 'm a t t u t i1 n o',
    andiamo: 'a n d y a1 m o', facile: 'f a1 CH i l e', difficile: 'd i f f i1 CH i l e', utile: 'u1 t i l e',
    ottimo: 'O1 t t i m o', ultimo: 'u1 l t i m o', simile: 's i1 m i l e', orribile: 'o r r i1 b i l e',
    mondo: 'm o1 n d o', ciao: 'CH a1 o', buongiorno: 'b w O n JH o1 r n o', buonasera: 'b w O n a s e1 r a',
    grazie: 'g r a1 TS y e', bene: 'b E1 n e', sono: 's o1 n o', bella: 'b E1 l l a', bello: 'b E1 l l o',
    sei: 's E1 i', lei: 'l E1 i', noi: 'n o1 i', voi: 'v o1 i', poi: 'p O1 i', mai: 'm a1 i'
  },

  // Phoneme symbols used in exception strings: single letters map to Italian phonemes
  sym: { a: 'a', e: 'e', E: 'E', i: 'i', o: 'o', O: 'O', u: 'u', p: 'P', b: 'B', t: 'T', d: 'D',
         k: 'K', g: 'G', f: 'F', v: 'V', s: 'S', z: 'Z', m: 'M', n: 'N', l: 'Ll', r: 'r', y: 'Y', w: 'W' },

  vowels: 'aeiouàèéìíòóùú',
  voicedCons: 'bdglmnrv',

  convert(word) {
    word = word.toLowerCase();
    if (this.exceptions[word]) return this.parseExc(this.exceptions[word]);
    return this.rules(word);
  },

  parseExc(s) {
    const out = [];
    for (const tok of s.split(' ')) {
      const stress = tok.endsWith('1') ? 1 : 0;
      const name = stress ? tok.slice(0, -1) : tok;
      const ph = this.sym[name] || name;
      // Doubled consonant letters become one geminate phoneme
      const last = out[out.length - 1];
      if (last && last.ph === ph && !isVowel(ph)) { last.gem = true; continue; }
      out.push({ ph, stress, gem: false });
    }
    return out;
  },

  isV(c) { return !!c && this.vowels.includes(c); },

  rules(w) {
    const out = [];
    const n = w.length;
    let accented = -1; // index in out of the vowel carrying a written accent
    const push = (ph, gem = false) => out.push({ ph, stress: 0, gem });
    let i = 0;
    while (i < n) {
      const c = w[i], c1 = w[i + 1] || '', c2 = w[i + 2] || '';
      const front = c1 === 'e' || c1 === 'i' || c1 === 'è' || c1 === 'é' || c1 === 'ì';
      // Geminate: same consonant letter doubled (cc, gg, zz handled below)
      const doubled = !this.isV(c) && c === c1 && c !== 'c' && c !== 'g' && c !== 'z' && c !== 's';

      if (this.isV(c)) {
        let ph, stressed = false;
        switch (c) {
          case 'a': ph = 'a'; break;
          case 'à': ph = 'a'; stressed = true; break;
          case 'e': ph = 'e'; break;
          case 'è': ph = 'E'; stressed = true; break;
          case 'é': ph = 'e'; stressed = true; break;
          case 'i': ph = 'i'; break;
          case 'ì': case 'í': ph = 'i'; stressed = true; break;
          case 'o': ph = 'o'; break;
          case 'ò': ph = 'O'; stressed = true; break;
          case 'ó': ph = 'o'; stressed = true; break;
          case 'u': ph = 'u'; break;
          case 'ù': case 'ú': ph = 'u'; stressed = true; break;
        }
        // Unaccented i/u before another vowel become glides (piano, buono, guerra)
        if ((c === 'i' || c === 'u') && this.isV(c1)) ph = c === 'i' ? 'Y' : 'W';
        if (stressed) accented = out.length;
        push(ph);
        i++;
        continue;
      }

      switch (c) {
        case 'c':
          if (c1 === 'c') {
            if (c2 === 'h') { push('K', true); i += 3; }
            else if ('eièéì'.includes(c2)) { push('CH', true); i += this.skipI(w, i + 2) ? 3 : 2; }
            else { push('K', true); i += 2; }
          } else if (c1 === 'h') { push('K'); i += 2; }
          else if (front) { push('CH'); i += this.skipI(w, i + 1) ? 2 : 1; }
          else { push('K'); i++; }
          break;
        case 'g':
          if (c1 === 'g') {
            if (c2 === 'h') { push('G', true); i += 3; }
            else if ('eièéì'.includes(c2)) { push('JH', true); i += this.skipI(w, i + 2) ? 3 : 2; }
            else { push('G', true); i += 2; }
          } else if (c1 === 'h') { push('G'); i += 2; }
          else if (c1 === 'n') { push('NY', this.isV(w[i - 1])); i += 2; }
          else if (c1 === 'l' && c2 === 'i') {
            push('LY', this.isV(w[i - 1]));
            i += this.isV(w[i + 3]) ? 3 : 2; // "gli" + vowel: the i is silent
          }
          else if (front) { push('JH'); i += this.skipI(w, i + 1) ? 2 : 1; }
          else { push('G'); i++; }
          break;
        case 's':
          if (c1 === 'c' && (c2 === 'e' || c2 === 'i' || c2 === 'è' || c2 === 'é' || c2 === 'ì')) {
            push('SH', this.isV(w[i - 1]));
            i += this.skipI(w, i + 2) ? 3 : 2;
          } else if (c1 === 's') { push('S', true); i += 2; }
          else if (this.isV(w[i - 1]) && this.isV(c1)) { push('Z'); i++; }   // intervocalic s
          else if (c1 && this.voicedCons.includes(c1)) { push('Z'); i++; }    // s before voiced consonant
          else { push('S'); i++; }
          break;
        case 'z':
          if (c1 === 'z') { push('TS', true); i += 2; }
          else { push(i === 0 ? 'DZ' : 'TS'); i++; }
          break;
        case 'q':
          push('K');
          i += c1 === 'q' ? 2 : 1;
          if (w[i] === 'u') { push('W'); i++; }
          break;
        case 'h': i++; break; // silent
        case 'x': push('K'); push('S'); i++; break;
        case 'j': push('Y'); i++; break;
        case 'y': push(this.isV(c1) ? 'Y' : 'i'); i++; break;
        case 'w': push('V'); i++; break;
        case 'k': push('K', doubled); i += doubled ? 2 : 1; break;
        default: {
          const map = { p: 'P', b: 'B', t: 'T', d: 'D', f: 'F', v: 'V', m: 'M', n: 'N', l: 'Ll', r: 'r' };
          if (map[c]) push(map[c], doubled);
          i += doubled ? 2 : 1;
        }
      }
    }

    // Stress: written accent, otherwise penultimate syllable nucleus
    const nuclei = [];
    out.forEach((p, k) => { if (isVowel(p.ph)) nuclei.push(k); });
    if (accented >= 0) out[accented].stress = 1;
    else if (nuclei.length >= 2) out[nuclei[nuclei.length - 2]].stress = 1;
    else if (nuclei.length === 1) out[nuclei[0]].stress = 1;
    return out;
  },

  // "ci"/"gi"/"sci" followed by a vowel: the i only marks the soft consonant
  skipI(w, k) {
    return w[k] === 'i' && this.isV(w[k + 1]);
  }
};
