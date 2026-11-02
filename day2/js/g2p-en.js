// English letter-to-sound rules, after the NRL rule set (Elovitz et al., 1976),
// plus a small dictionary of common irregular words (CMU-style stress digits).
// Output: array of { ph, stress, gem }.
//
// Rule syntax: "left[match]right=PHONEMES"; context symbols:
//   ' ' word boundary   '#' one or more vowels   ':' zero or more consonants
//   '^' one consonant   '.' voiced consonant     '+' front vowel (E I Y)
//   '%' suffix (ER E ES ED ING ELY)   '@' T S R D L Z N J TH CH SH

const EnglishG2P = {
  dict: {
    a: 'AX0', the: 'DH AX0', of: 'AH1 V', to: 'T UW1', and: 'AE1 N D', you: 'Y UW1', your: 'Y AO1 R',
    i: 'AY1', is: 'IH1 Z', it: 'IH1 T', in: 'IH1 N', be: 'B IY1', we: 'W IY1', me: 'M IY1', he: 'HH IY1',
    she: 'SH IY1', they: 'DH EY1', are: 'AA1 R', was: 'W AA1 Z', were: 'W ER1', have: 'HH AE1 V',
    has: 'HH AE1 Z', do: 'D UW1', does: 'D AH1 Z', done: 'D AH1 N', said: 'S EH1 D', says: 'S EH1 Z',
    one: 'W AH1 N', two: 'T UW1', once: 'W AH1 N S', what: 'W AH1 T', who: 'HH UW1', where: 'W EH1 R',
    there: 'DH EH1 R', their: 'DH EH1 R', here: 'HH IY1 R', come: 'K AH1 M', some: 'S AH1 M',
    love: 'L AH1 V', above: 'AX0 B AH1 V', give: 'G IH1 V', live: 'L IH1 V', been: 'B IH1 N',
    hello: 'HH AX0 L OW1', world: 'W ER1 L D', computer: 'K AX0 M P Y UW1 T ER0', speech: 'S P IY1 CH',
    synthesis: 'S IH1 N TH AX0 S IH0 S', synthesizer: 'S IH1 N TH AX0 S AY2 Z ER0', voice: 'V OY1 S',
    music: 'M Y UW1 Z IH0 K', song: 'S AO1 NG', sing: 'S IH1 NG', happy: 'HH AE1 P IY0',
    birthday: 'B ER1 TH D EY2', dear: 'D IY1 R', friend: 'F R EH1 N D', friends: 'F R EH1 N D Z',
    twinkle: 'T W IH1 NG K AX0 L', little: 'L IH1 T AX0 L', star: 'S T AA1 R', how: 'HH AW1',
    wonder: 'W AH1 N D ER0', up: 'AH1 P', high: 'HH AY1', like: 'L AY1 K', diamond: 'D AY1 M AX0 N D',
    sky: 'S K AY1', mary: 'M EH1 R IY0', had: 'HH AE1 D', lamb: 'L AE1 M',
    fleece: 'F L IY1 S', white: 'W AY1 T', snow: 'S N OW1', again: 'AX0 G EH1 N', any: 'EH1 N IY0',
    many: 'M EH1 N IY0', only: 'OW1 N L IY0', people: 'P IY1 P AX0 L', about: 'AX0 B AW1 T',
    because: 'B IH0 K AO1 Z', before: 'B IH0 F AO1 R', today: 'T AX0 D EY1', tomorrow: 'T AX0 M AA1 R OW0',
    good: 'G UH1 D', morning: 'M AO1 R N IH0 NG', night: 'N AY1 T', thank: 'TH AE1 NG K', thanks: 'TH AE1 NG K S',
    please: 'P L IY1 Z', yes: 'Y EH1 S', no: 'N OW1', name: 'N EY1 M', my: 'M AY1', by: 'B AY1',
    welcome: 'W EH1 L K AX0 M', klatt: 'K L AE1 T', machine: 'M AX0 SH IY1 N', language: 'L AE1 NG G W IH0 JH',
    english: 'IH1 NG G L IH0 SH', italian: 'IH0 T AE1 L Y AX0 N', daisy: 'D EY1 Z IY0', answer: 'AE1 N S ER0',
    half: 'HH AE1 F', crazy: 'K R EY1 Z IY0', all: 'AO1 L', for: 'F AO1 R', from: 'F R AH1 M',
    with: 'W IH1 DH', this: 'DH IH1 S', that: 'DH AE1 T', can: 'K AE1 N', will: 'W IH1 L', not: 'N AA1 T',
    very: 'V EH1 R IY0', water: 'W AO1 T ER0', could: 'K UH1 D', would: 'W UH1 D', should: 'SH UH1 D',
    eye: 'AY1', eyes: 'AY1 Z', heart: 'HH AA1 R T', sun: 'S AH1 N', moon: 'M UW1 N', day: 'D EY1',
    talk: 'T AO1 K', walk: 'W AO1 K', know: 'N OW1', new: 'N UW1', now: 'N AW1', our: 'AW1 ER0',
    hour: 'AW1 ER0', time: 'T AY1 M', make: 'M EY1 K', way: 'W EY1', see: 'S IY1', sea: 'S IY1',
    la: 'L AA1', "i'm": 'AY1 M', glorious: 'G L AO1 R IY0 AX0 S', rain: 'R EY1 N', house: 'HH AW1 S', singing: 'S IH1 NG IH0 NG', beautiful: 'B Y UW1 T IH0 F UH0 L', every: 'EH1 V R IY0', everyone: 'EH1 V R IY0 W AH2 N', nothing: 'N AH1 TH IH0 NG', something: 'S AH1 M TH IH0 NG',
    entirely: 'EH0 N T AY1 ER0 L IY0', browser: 'B R AW1 Z ER0'
  },

  rulesSrc: {
    A: [' [A] =AX', ' [ARE] =AA R', ' [AR]O=AX R', '[AR]#=EH R', ' ^[AS]#=EY S', '[A]WA=AX', '[AW]=AO',
        ' :[ANY]=EH N IY', '[A]^+#=EY', '#:[ALLY]=AX L IY', ' [AL]#=AX L', '[AGAIN]=AX G EH N',
        '#:[AG]E=IH JH', '[A]^+:#=AE', ' :[A]^+ =EY', '[A]^%=EY', ' [ARR]=AX R', '[ARR]=AE R',
        ' :[AR] =AA R', '[AR] =ER', '[AR]=AA R', '[AIR]=EH R', '[AI]=EY', '[AY]=EY', '[AU]=AO',
        '#:[AL] =AX L', '#:[ALS] =AX L Z', '[ALK]=AO K', '[AL]^=AO L', ' :[ABLE]=EY B AX L',
        '[ABLE]=AX B AX L', '[ANG]+=EY N JH', '[A]=AE'],
    B: [' [BE]^#=B IH', '[BEING]=B IY IH NG', ' [BOTH] =B OW TH', ' [BUS]#=B IH Z', '[BUIL]=B IH L', '[B]=B'],
    C: [' [CH]^=K', '^E[CH]=K', '[CH]=CH', ' S[CI]#=S AY', '[CI]A=SH', '[CI]O=SH', '[CI]EN=SH',
        '[C]+=S', '[CK]=K', '[COM]%=K AH M', '[C]=K'],
    D: ['#:[DED] =D IH D', '.E[D] =D', '#^:E[D] =T', ' [DE]^#=D IH', ' [DO] =D UW', ' [DOES]=D AH Z',
        ' [DOING]=D UW IH NG', ' [DOW]=D AW', '[DU]A=JH UW', '[D]=D'],
    E: ['#:[E] =', ' :[E] =IY', '#[ED] =D', '#:[E]D =', '[EV]ER=EH V', '[E]^%=IY', '[ERI]#=IY R IY',
        '[ERI]=EH R IH', '#:[ER]#=ER', '[ER]#=EH R', '[ER]=ER', ' [EVEN]=IY V EH N', '#:[E]W=',
        '@[EW]=UW', '[EW]=Y UW', '[E]O=IY', '#:S[ES] =IH Z', '#:C[ES] =IH Z', '#:G[ES] =IH Z',
        '#:Z[ES] =IH Z', '#:X[ES] =IH Z', '#:J[ES] =IH Z', '#:CH[ES] =IH Z', '#:SH[ES] =IH Z',
        '#:[E]S =', '#:[ELY] =L IY', '#:[EMENT]=M EH N T', '[EFUL]=F UH L', '[EE]=IY', '[EARN]=ER N',
        ' [EAR]^=ER', '[EAD]=EH D', '#:[EA] =IY AX', '[EA]SU=EH', '[EA]=IY', '[EIGH]=EY', '[EI]=IY',
        ' [EYE]=AY', '[EY]=IY', '[EU]=Y UW', '[E]=EH'],
    F: ['[FUL]=F UH L', '[F]=F'],
    G: ['[GIV]=G IH V', ' [G]I^=G', '[GE]T=G EH', 'SU[GGES]=G JH EH S', '[GG]=G', ' B#[G]=G', '[G]+=JH',
        '[GREAT]=G R EY T', '#[GH]=', '[G]=G'],
    H: [' [HAV]=HH AE V', ' [HERE]=HH IY R', ' [HOUR]=AW ER', '[HOW]=HH AW', '[H]#=HH', '[H]='],
    I: [' [IN]=IH N', ' [I] =AY', '[IN]D=AY N', '[IER]=IY ER', '#:R[IED] =IY D', '[IED] =AY D',
        '[IEN]=IY EH N', '[IE]T=AY EH', ' :[I]%=AY', '[I]%=IY', '[IE]=IY', '[I]^+:#=IH', '[IR]#=AY R',
        '[IZ]%=AY Z', '[IS]%=AY Z', '[I]D%=AY', '+^[I]^+=IH', '[I]T%=AY', '#^:[I]^+=IH', '[I]^+=AY',
        '[IR]=ER', '[IGH]=AY', '[ILD]=AY L D', '[IGN] =AY N', '[IGN]^=AY N', '[IGN]%=AY N', '[IQUE]=IY K',
        '[I]=IH'],
    J: ['[J]=JH'],
    K: [' [K]N=', '[K]=K'],
    L: ['[LO]C#=L OW', 'L[L]=', '#^:[L]%=AX L', '[LEAD]=L IY D', '[L]=L'],
    M: ['[MOV]=M UW V', '[M]=M'],
    N: ['E[NG]+=N JH', '[NG]R=NG G', '[NG]#=NG G', '[NGL]%=NG G AX L', '[NG]=NG', '[NK]=NG K',
        ' [NOW] =N AW', '[N]=N'],
    O: ['[OF] =AX V', '[OROUGH]=ER OW', '#:[OR] =ER', '#:[ORS] =ER Z', '[OR]=AO R', ' [ONE]=W AH N',
        '[OW]=OW', ' [OVER]=OW V ER', '[OV]=AH V', '[O]^%=OW', '[O]^EN=OW', '[O]^I#=OW', '[OL]D=OW L',
        '[OUGHT]=AO T', '[OUGH]=AH F', ' [OU]=AW', 'H[OU]S#=AW', '[OUS]=AX S', '[OUR]=AO R',
        '[OULD]=UH D', '^[OU]^L=AH', '[OUP]=UW P', '[OU]=AW', '[OY]=OY', '[OING]=OW IH NG', '[OI]=OY',
        '[OOR]=AO R', '[OOK]=UH K', '[OOD]=UH D', '[OO]=UW', '[O]E=OW', '[O] =OW', '[OA]=OW',
        ' [ONLY]=OW N L IY', ' [ONCE]=W AH N S', 'C[O]N=AA', '[O]NG=AO', ' :^[O]N=AH', 'I[ON]=AX N',
        '#:[ON] =AX N', '#^[ON]=AX N', '[O]ST =OW', '[OF]^=AO F', '[OTHER]=AH DH ER', '[OSS] =AO S',
        '#^:[OM]=AH M', '[O]=AA'],
    P: ['[PH]=F', '[PEOP]=P IY P', '[POW]=P AW', '[PUT] =P UH T', '[P]=P'],
    Q: ['[QUAR]=K W AO R', '[QU]=K W', '[Q]=K'],
    R: [' [RE]^#=R IY', '[R]=R'],
    S: ['[SH]=SH', '#[SION]=ZH AX N', '[SOME]=S AH M', '#[SUR]#=ZH ER', '[SUR]#=SH ER', '#[SU]#=ZH UW',
        '#[SSU]#=SH UW', '#[SED] =Z D', '#[S]#=Z', '[SAID]=S EH D', '^[SION]=SH AX N', '[S]S=',
        '.[S] =Z', '#:.E[S] =Z', '#^:##[S] =Z', '#^:#[S] =S', 'U[S] =S', ' :#[S] =Z', ' [SCH]=S K',
        '[S]C+=', '#[SM]=Z M', '[S]=S'],
    T: [' [THE] =DH AX', '[TO] =T UW', '[THAT] =DH AE T', ' [THIS] =DH IH S', ' [THEY]=DH EY',
        ' [THERE]=DH EH R', '[THER]=DH ER', '[THEIR]=DH EH R', ' [THAN] =DH AE N', ' [THEM] =DH EH M',
        '[THESE] =DH IY Z', ' [THEN]=DH EH N', '[THROUGH]=TH R UW', '[THOSE]=DH OW Z', '[THOUGH] =DH OW',
        ' [THUS]=DH AH S', '[TH]=TH', '#:[TED] =T IH D', 'S[TI]#N=CH', '[TI]O=SH', '[TI]A=SH',
        '[TIEN]=SH AX N', '[TUR]#=CH ER', '[TU]A=CH UW', ' [TWO]=T UW', '[T]=T'],
    U: [' [UN]I=Y UW N', ' [UN]=AH N', ' [UPON]=AX P AO N', '@[UR]#=UH R', '[UR]#=Y UH R', '[UR]=ER',
        '[U]^ =AH', '[U]^^=AH', '[UY]=AY', ' G[U]#=', 'G[U]%=', 'G[U]#=W', '#N[U]=Y UW', '@[U]=UW',
        '[U]=Y UW'],
    V: ['[VIEW]=V Y UW', '[V]=V'],
    W: [' [WERE]=W ER', '[WA]S=W AA', '[WA]T=W AA', '[WHERE]=W EH R', '[WHAT]=W AA T', '[WHOL]=HH OW L',
        '[WHO]=HH UW', '[WH]=W', '[WAR]=W AO R', '[WOR]^=W ER', '[WR]=R', '[W]=W'],
    X: ['[X]=K S'],
    Y: ['[YOUNG]=Y AH NG', ' [YOU]=Y UW', ' [YES]=Y EH S', ' [Y]=Y', '#^:[Y] =IY', '#^:[Y]I=IY',
        ' :[Y] =AY', ' :[Y]#=AY', ' :[Y]^+:#=IH', ' :[Y]^#=AY', '[Y]=IH'],
    Z: ['[Z]=Z']
  },

  rules: null,

  init() {
    if (this.rules) return;
    this.rules = {};
    for (const letter in this.rulesSrc) {
      this.rules[letter] = this.rulesSrc[letter].map(src => {
        const m = src.match(/^(.*)\[(.+)\](.*)=(.*)$/);
        return { left: m[1], match: m[2], right: m[3], out: m[4].trim() ? m[4].trim().split(' ') : [] };
      });
    }
  },

  convert(word) {
    this.init();
    const lw = word.toLowerCase().replace(/[^a-z']/g, '');
    if (this.dict[lw]) return this.parseDict(this.dict[lw]);
    const w = ' ' + lw.toUpperCase().replace(/'/g, '') + ' ';
    const phones = [];
    let i = 1;
    while (i < w.length - 1) {
      const rules = this.rules[w[i]];
      let done = false;
      if (rules) {
        for (const r of rules) {
          if (!w.startsWith(r.match, i)) continue;
          if (!this.matchLeft(w, i - 1, r.left) || !this.matchRight(w, i + r.match.length, r.right)) continue;
          phones.push(...r.out);
          i += r.match.length;
          done = true;
          break;
        }
      }
      if (!done) i++;
    }
    // Doubled letters may yield the same consonant twice (running -> N N)
    return this.assignStress(phones.filter((p, k) => k === 0 || p !== phones[k - 1] || isVowel(p)));
  },

  parseDict(s) {
    return s.split(' ').map(tok => {
      const d = tok.match(/[012]$/);
      return { ph: d ? tok.slice(0, -1) : tok, stress: d && d[0] !== '0' ? 1 : 0, gem: false };
    });
  },

  // Simple stress rule: first full vowel (not schwa) of the word
  assignStress(phones) {
    const out = phones.map(ph => ({ ph, stress: 0, gem: false }));
    const first = out.find(p => isVowel(p.ph) && p.ph !== 'AX') || out.find(p => isVowel(p.ph));
    if (first) first.stress = 1;
    return out;
  },

  isVowelCh(c) { return 'AEIOUY'.includes(c); },
  isConsCh(c) { return c >= 'A' && c <= 'Z' && !this.isVowelCh(c); },

  // Left context is matched right-to-left, starting from the char before the match
  matchLeft(w, pos, pat) {
    for (let k = pat.length - 1; k >= 0; k--) {
      const p = pat[k];
      if (/[A-Z]/.test(p)) {
        if (w[pos] !== p) return false;
        pos--;
        continue;
      }
      switch (p) {
        case ' ': if (pos >= 0 && w[pos] !== ' ') return false; pos--; break;
        case '#': if (!this.isVowelCh(w[pos])) return false; while (this.isVowelCh(w[pos])) pos--; break;
        case ':': while (this.isConsCh(w[pos])) pos--; break;
        case '^': if (!this.isConsCh(w[pos])) return false; pos--; break;
        case '.': if (!'BDVGJLMNRWZ'.includes(w[pos]) || !w[pos]) return false; pos--; break;
        case '+': if (!'EIY'.includes(w[pos]) || !w[pos]) return false; pos--; break;
        case '@':
          if (w[pos] === 'H' && 'TCS'.includes(w[pos - 1])) { pos -= 2; break; }
          if (!'TSRDLZNJ'.includes(w[pos]) || !w[pos]) return false;
          pos--;
          break;
        default: return false;
      }
    }
    return true;
  },

  matchRight(w, pos, pat) {
    for (let k = 0; k < pat.length; k++) {
      const p = pat[k];
      if (/[A-Z]/.test(p)) {
        if (w[pos] !== p) return false;
        pos++;
        continue;
      }
      switch (p) {
        case ' ': if (pos < w.length && w[pos] !== ' ') return false; pos++; break;
        case '#': if (!this.isVowelCh(w[pos])) return false; while (this.isVowelCh(w[pos])) pos++; break;
        case ':': while (this.isConsCh(w[pos])) pos++; break;
        case '^': if (!this.isConsCh(w[pos])) return false; pos++; break;
        case '.': if (!w[pos] || !'BDVGJLMNRWZ'.includes(w[pos])) return false; pos++; break;
        case '+': if (!w[pos] || !'EIY'.includes(w[pos])) return false; pos++; break;
        case '%': {
          const rest = w.slice(pos);
          const suf = ['ING', 'ELY', 'ER', 'ES', 'ED', 'E'].find(s => rest.startsWith(s) && !/[A-Z]/.test(rest[s.length] || ' '));
          if (!suf) return false;
          pos += suf.length;
          break;
        }
        default: return false;
      }
    }
    return true;
  }
};
