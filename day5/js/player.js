'use strict';

// Module replayer: interprets the song tick by tick and mixes the voices in stereo.
// It is a plain function of the Tracker constants so that main.js can also run its source
// inside the AudioWorklet (definePlayer.toString()).
function definePlayer(T) {
  const { FX, VC, NOTE_FADE, NOTE_CUT, NOTE_OFF, CELL } = T;

  const AMIGA_CLOCK = 14317056;   // freq = AMIGA_CLOCK / period (periods are 4x the ProTracker ones)
  const MAX_BG_VOICES = 64;       // voices left playing by IT new note actions
  const RAMP_TIME = 0.0015;       // seconds of volume ramp against clicks
  const S3M_SHARED = new Set([FX.VOLSLIDE, FX.PORTADN, FX.PORTAUP, FX.TREMOR, FX.ARP, FX.VIBVOL,
    FX.TONEVOL, FX.RETRIG, FX.TREMOLO, FX.SPECIAL]);
  const EMPTY = { rows: 64, data: null };

  const SINE = Array.from({ length: 64 }, (_, i) => Math.round(255 * Math.sin(i * Math.PI / 32)));
  function waveform(type, pos) {
    pos &= 63;
    switch (type & 3) {
      case 0: return SINE[pos];
      case 1: return 255 - pos * 8;
      case 2: return pos < 32 ? 255 : -255;
      default: return Math.floor(Math.random() * 511) - 255;
    }
  }
  // FT2 auto vibrato (256 steps, amplitude 64): sine (starting downwards), square, ramp up, ramp down
  function xmAutoVib(type, pos) {
    switch (type & 3) {
      case 1: return pos > 127 ? 64 : -64;
      case 2: return (((pos >> 1) + 64) & 127) - 64;
      case 3: return ((64 - (pos >> 1)) & 127) - 64;
      default: return -Math.round(64 * Math.sin(2 * Math.PI * pos / 256));
    }
  }

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const envOn = (e) => !!e && e.on !== false;

  function envValue(env, pos) {
    const pts = env.points;
    if (pos <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      const b = pts[i];
      if (pos <= b.t) {
        const a = pts[i - 1], d = b.t - a.t;
        return d > 0 ? a.v + (b.v - a.v) * (pos - a.t) / d : b.v;
      }
    }
    return pts[pts.length - 1].v;
  }

  // XM (FT2) jumps back as soon as the loop end is reached, IT also plays the end point
  function envNext(env, pos, keyOn, xm) {
    pos++;
    const e = xm ? 0 : 1;
    if (keyOn && env.sus && pos >= env.susEnd + e) pos = env.susStart;
    else if (env.loop && pos >= env.loopEnd + e) pos = env.loopStart;
    return Math.min(pos, env.end + 1);
  }

  class Player {
    constructor(song, sampleRate) {
      this.song = song;
      this.sampleRate = sampleRate;
      this.nch = song.channels;
      this.mx = song.type === 'mod' || song.type === 'xm';
      this.linear = song.linear;
      this.gvolMax = song.type === 'it' ? 128 : 64;
      this.mixGain = 0.9 / Math.sqrt(Math.max(4, this.nch));
      this.rampLen = Math.max(1, Math.round(sampleRate * RAMP_TIME));
      this.separation = 1;
      this.muted = new Uint8Array(this.nch);
      this.repeat = true;
      this.reset(0);
    }

    reset(order) {
      const song = this.song;
      this.speed = song.speed;
      this.tempo = song.tempo;
      this.gvol = song.globalVol;
      this.channels = [];
      for (let i = 0; i < this.nch; i++) this.channels.push(this.makeChannel(i));
      this.voices = [];
      this.tick = 0;
      this.patDelay = 0;
      this.extraTicks = 0;
      this.jumpOrder = -1;
      this.breakRow = -1;
      this.loopJump = -1;
      this.visited = new Set();
      this.ended = false;
      this.tickLeft = 0;
      this.gotoOrder(order, 0);
    }

    makeChannel(i) {
      return {
        idx: i, note: -1, ins: 0, insObj: null, smp: null, voice: null,
        period: 0, target: 0, vol: 64, pan: this.song.chanPan[i], chanVol: this.song.chanVol[i],
        surround: !!(this.song.chanSurround && this.song.chanSurround[i]),
        fx: 0, param: 0, vc: 0, vp: 0, nna: 0,
        vibPos: 0, vibSpeed: 0, vibDepth: 0, vibWave: 0, c5: 8363,
        tremPos: 0, tremSpeed: 0, tremDepth: 0, tremWave: 0,
        panbPos: 0, panbSpeed: 0, panbDepth: 0, panbWave: 0,
        vibDelta: 0, tremDelta: 0, arp: 0, panDelta: 0, tremorOff: false, tremorOn: false, tremorCount: 0,
        mem: {}, retrigCount: 0, loopRow: 0, loopCount: 0, delayTick: -1, delayed: null, offsetHi: 0,
        cutoff: 127, resonance: 0, macro: 0,
      };
    }

    // ------------------------------------------------------------ order/row navigation

    gotoOrder(order, row) {
      const orders = this.song.orders;
      for (let guard = 0; guard < 512; guard++) {
        if (order >= orders.length) { order = this.song.restart; this.markEnd(); }
        if (orders[order] === 254) { order++; continue; }
        if (orders[order] === 255) { order = orders.length; continue; }
        break;
      }
      // S3M (as in OpenMPT): a new pattern starts with the loop start back on row 0
      if (this.song.type === 's3m' && this.channels) for (const ch of this.channels) { ch.loopRow = 0; ch.loopCount = 0; }
      this.order = order;
      this.pattern = this.song.patterns[orders[order]] || EMPTY;
      this.row = row < this.pattern.rows ? row : 0;
    }

    markEnd() {
      this.ended = true;
      this.visited.clear();
    }

    seek(order) {
      for (const v of this.voices) this.stopVoice(v);
      const keep = this.voices;
      const muted = this.muted;
      this.reset(order);
      this.voices = keep;
      this.muted = muted;
    }

    nextRow() {
      if (this.loopJump >= 0) {
        this.row = this.loopJump;
        this.loopJump = this.jumpOrder = this.breakRow = -1;
        return;
      }
      if (this.jumpOrder >= 0 || this.breakRow >= 0) {
        const order = this.jumpOrder >= 0 ? this.jumpOrder : this.order + 1;
        this.gotoOrder(order, Math.max(0, this.breakRow));
        this.jumpOrder = this.breakRow = -1;
      } else if (++this.row >= this.pattern.rows) this.gotoOrder(this.order + 1, 0);
      // coming back to a row already played (outside pattern loops) means the song is over
      if (this.visited.has(this.order * 1024 + this.row) && !this.channels.some((c) => c.loopCount > 0)) this.markEnd();
    }

    // ------------------------------------------------------------ tick processing

    doTick() {
      if (this.voices.length > 16) this.voices = this.voices.filter((v) => v.active);
      if (this.tick === 0) this.readRow();
      const t = this.tick;
      for (const ch of this.channels) {
        ch.vibDelta = 0;
        ch.tremDelta = 0;
        ch.arp = 0;
        ch.panDelta = 0;
        if (t > 0 && ch.delayTick === t) {
          const [note, ins, vc, vp] = ch.delayed;
          ch.delayTick = -1;
          ch.vc = vc;
          ch.vp = vp;
          this.processNote(ch, note, ins);
          this.volColumn(ch, 0);
        } else if (ch.delayTick < 0) {
          this.volColumn(ch, t);
        }
        this.effect(ch, t);
        if (!this.dry) this.updateChannel(ch);
      }
      if (this.dry) this.voices.length = 0;
      else this.updateVoices();
      if (++this.tick >= this.speed * (1 + this.patDelay) + this.extraTicks) {
        this.tick = 0;
        this.nextRow();
      }
    }

    readRow() {
      this.patDelay = 0;
      this.extraTicks = 0;
      this.visited.add(this.order * 1024 + this.row);
      const d = this.pattern.data, base = this.row * this.nch * CELL;
      for (const ch of this.channels) {
        const o = base + ch.idx * CELL;
        const note = d ? d[o] : 0, ins = d ? d[o + 1] : 0;
        let fx = d ? d[o + 4] : 0, param = d ? d[o + 5] : 0;
        param = this.memory(ch, fx, param);
        ch.fx = fx;
        ch.param = param;
        ch.vc = d ? d[o + 2] : 0;
        ch.vp = d ? d[o + 3] : 0;
        ch.delayTick = -1;
        ch.rowNote = note > 0 && note <= 120;
        const sub = param >> 4;
        if (((fx === FX.EXT && this.mx) || fx === FX.SPECIAL) && sub === 0xD && (param & 15)) {
          ch.delayTick = param & 15;
          ch.delayed = [note, ins, ch.vc, ch.vp];
          ch.vc = 0;
          continue;
        }
        this.processNote(ch, note, ins);
      }
    }

    // resolves the "00 = use last value" effect memories, which differ between trackers
    memory(ch, fx, p) {
      const type = this.song.type, m = ch.mem;
      if (!fx) return p;
      if (type === 's3m' && S3M_SHARED.has(fx)) {
        if (p) m.last = p; else p = m.last || 0;
        return p;
      }
      const keep = (k) => { if (p) m[k] = p; else p = m[k] || 0; };
      switch (fx) {
        case FX.PORTAUP: if (type === 'it') keep('ef'); else if (type === 'xm') keep('up'); break;
        case FX.PORTADN: if (type === 'it') keep('ef'); else if (type === 'xm') keep('dn'); break;
        case FX.TONEPORTA: keep(type === 'it' && this.song.linkG ? 'ef' : 'porta'); break;
        case FX.VOLSLIDE: case FX.TONEVOL: case FX.VIBVOL: if (type !== 'mod') keep('vol'); break;
        case FX.OFFSET: keep('offset'); break;
        case FX.TREMOR: keep('tremor'); break;
        case FX.RETRIG: keep('retrig'); break;
        case FX.PANSLIDE: keep('pan'); break;
        case FX.GVOLSLIDE: keep('gvol'); break;
        case FX.CHANVOLSLIDE: keep('cvol'); break;
        case FX.ARP: if (type === 'it') keep('arp'); break;
        case FX.TEMPO: if (p < 0x20) keep('tempo'); break;
        case FX.SPECIAL: if (type === 'it') keep('s'); break;
      }
      return p;
    }

    notePeriod(n, c5) {
      if (this.linear) return 7680 - n * 64;
      return AMIGA_CLOCK / (c5 * Math.pow(2, (n - 60) / 12));
    }

    periodFreq(p, c5) {
      if (this.linear) return c5 * Math.pow(2, (3840 - p) / 768);
      return p > 0 ? AMIGA_CLOCK / p : 0;
    }

    processNote(ch, note, ins) {
      const song = this.song, type = song.type;
      const porta = ch.fx === FX.TONEPORTA || ch.fx === FX.TONEVOL || ch.vc === VC.TONEPORTA;
      if (ins) {
        ch.ins = ins;
        ch.insObj = song.instruments[ins - 1] || null;
      }
      const instr = ch.insObj;
      let triggered = false;
      if (note >= 1 && note <= 120 && instr) {
        const n = note - 1, si = instr.sampleMap[n], smp = si >= 0 ? song.samples[si] : null;
        const real = instr.noteMap[n];
        if (smp && smp.length) {
          let c5 = smp.c5;
          // E5x: set finetune for this note (XM: 0..15 -> -128..112, MOD: signed nibble)
          if (this.mx && ch.fx === FX.EXT && (ch.param >> 4) === 5) {
            const y = ch.param & 15, fine = type === 'xm' ? y * 16 - 128 : (y < 8 ? y : y - 16) * 16;
            c5 = 8363 * Math.pow(2, ((smp.relNote || 0) + fine / 128) / 12);
          }
          const period = this.notePeriod(real, c5);
          if (porta && ch.voice && ch.voice.active && !ch.voice.stopping) {
            ch.target = period;
            ch.note = real;
          } else {
            this.trigger(ch, instr, smp, real, period);
            ch.c5 = c5;
            triggered = true;
          }
        } else if (type === 'it' && ch.voice) {
          this.stopVoice(ch.voice);
          ch.voice = null;
        }
      } else if (note === NOTE_OFF) {
        if (ch.voice) this.keyOff(ch.voice);
      } else if (note === NOTE_CUT) {
        if (ch.voice) this.stopVoice(ch.voice);
        ch.voice = null;
      } else if (note === NOTE_FADE) {
        if (ch.voice) ch.voice.fading = true;
      }

      if (ins && instr) {
        const smp = triggered ? ch.smp : song.samples[instr.sampleMap[ch.note >= 0 ? ch.note : 60]] || ch.smp;
        if (instr.pan >= 0 && triggered) this.setPan(ch, instr.pan);
        if (smp) {
          ch.vol = smp.volume;
          if (smp.pan >= 0) this.setPan(ch, smp.pan);
        }
        if (type === 'xm' && !triggered && ch.voice && ch.voice.active && note !== NOTE_OFF) {
          const v = ch.voice;
          v.volPos = v.panPos = 0;
          v.fade = 1;
          v.fading = false;
          v.keyOn = true;
        }
      }

      if (triggered && ch.fx === FX.OFFSET) {
        const v = ch.voice, s = v.smp;
        let off = ch.param * 256 + (ch.offsetHi << 16);
        if (off >= s.length) {
          if (s.loopType && type !== 'it') off = s.loopStart;
          else if (type === 'it' && !song.oldEffects) off = 0;
          else { this.stopVoice(v); off = 0; }
        }
        v.pos = off;
      }
    }

    trigger(ch, instr, smp, note, period) {
      const it = this.song.type === 'it';
      const old = ch.voice;
      if (it && instr.dct) {
        for (const v of this.voices) {
          if (!v.active || v.stopping || v.owner !== ch.idx || v.ins !== instr) continue;
          if (instr.dct === 1 && v.note !== note) continue;
          if (instr.dct === 2 && v.smp !== smp) continue;
          if (instr.dca === 0) this.stopVoice(v);
          else if (instr.dca === 1) this.keyOff(v);
          else v.fading = true;
        }
      }
      if (old && old.active && !old.stopping) {
        if (!it || ch.nna === 0) this.stopVoice(old);
        else {
          old.bg = true;
          if (ch.nna === 2) this.keyOff(old);
          else if (ch.nna === 3) old.fading = true;
          this.limitVoices();
        }
      }
      const v = {
        active: true, stopping: false, bg: false, owner: ch.idx, ins: instr, smp, note,
        pos: 0, dir: 1, step: 0, keyOn: true, fade: 1, fading: false,
        volPos: 0, panPos: 0, pitchPos: 0, volEnvOn: envOn(instr.volEnv), panEnvOn: envOn(instr.panEnv), pitchEnvOn: envOn(instr.pitchEnv),
        avPos: 0, avTick: 0, avAmp: 0, freq: 0, vol: 0, pan: 128,
        l: 0, r: 0, tl: 0, tr: 0, dl: 0, dr: 0, ramp: 0, peak: 0, fresh: true,
        cutoff: 127, resonance: 0, flt: false, fkey: -1, fa: 1, fb0: 0, fb1: 0, y1: 0, y2: 0,
        // IT random volume / pan variation of the instrument, chosen once per note
        swing: 1 + (Math.random() * 2 - 1) * instr.volSwing, panSwing: Math.round((Math.random() * 2 - 1) * instr.panSwing),
      };
      this.voices.push(v);
      ch.voice = v;
      ch.smp = smp;
      ch.note = note;
      ch.period = ch.target = period;
      ch.nna = instr.nna;
      if (instr.cutoff >= 0) ch.cutoff = instr.cutoff;
      if (instr.resonance >= 0) ch.resonance = instr.resonance;
      ch.retrigCount = 0;
      if (!(ch.vibWave & 4)) ch.vibPos = 0;
      if (!(ch.tremWave & 4)) ch.tremPos = 0;
    }

    limitVoices() {
      let bg = 0;
      for (const v of this.voices) if (v.active && v.bg && !v.stopping) bg++;
      for (const v of this.voices) {
        if (bg <= MAX_BG_VOICES) break;
        if (v.active && v.bg && !v.stopping) { this.stopVoice(v); bg--; }
      }
    }

    stopVoice(v) {
      if (!v.active || v.stopping) return;
      v.stopping = true;
      v.tl = v.tr = 0;
      v.ramp = this.rampLen;
      v.dl = -v.l / v.ramp;
      v.dr = -v.r / v.ramp;
    }

    keyOff(v) {
      v.keyOn = false;
      const env = v.ins.volEnv;
      if (this.song.type === 'xm') {
        if (env && v.volEnvOn) v.fading = true;
        else this.stopVoice(v);
      } else if (!env || !v.volEnvOn || env.loop) {
        v.fading = true;
      }
    }

    // ------------------------------------------------------------ effects

    slide(ch, d) {
      ch.period += d;
      if (this.song.type === 'mod') ch.period = clamp(ch.period, 452, 3424);
      else if (this.linear) ch.period = clamp(ch.period, 0, 9216);
      else ch.period = clamp(ch.period, 28, 65535);
    }

    stPitchSlide(ch, p, t, dir) {
      if (p >= 0xF0) { if (t === 0) this.slide(ch, dir * 4 * (p & 15)); }
      else if (p >= 0xE0) { if (t === 0) this.slide(ch, dir * (p & 15)); }
      else if (t > 0) this.slide(ch, dir * 4 * p);
    }

    tonePorta(ch, speed) {
      if (!ch.target || !ch.voice) return;
      if (ch.period < ch.target) ch.period = Math.min(ch.period + speed, ch.target);
      else if (ch.period > ch.target) ch.period = Math.max(ch.period - speed, ch.target);
    }

    portaSpeed(ch) {
      return ch.mem[this.song.type === 'it' && this.song.linkG ? 'ef' : 'porta'] || 0;
    }

    // ST3/IT style slide with fine variants (DxF / DFx), applied to any field
    stVolSlide(obj, key, p, t, max) {
      const x = p >> 4, y = p & 15;
      let v = obj[key];
      if (y === 15 && x) { if (t === 0) v += x; }
      else if (x === 15 && y) { if (t === 0) v -= y; }
      else if (t > 0 || this.song.fastSlides) {
        if (y === 0) v += x;
        else if (x === 0) v -= y;
        else if (this.song.type !== 'it') v -= y;
      }
      obj[key] = clamp(v, 0, max);
    }

    volSlide(ch, p, t) {
      if (this.mx) {
        if (t > 0) ch.vol = clamp(ch.vol + ((p >> 4) ? (p >> 4) : -(p & 15)), 0, 64);
      } else this.stVolSlide(ch, 'vol', p, t, 64);
    }

    vibrato(ch, t, fine) {
      if (t === 0 && this.song.type !== 'it') return;
      ch.vibDelta = waveform(ch.vibWave, ch.vibPos) * ch.vibDepth / (fine ? 128 : 32);
      ch.vibPos += ch.vibSpeed;
    }

    setVibrato(ch, p) {
      if (p >> 4) ch.vibSpeed = p >> 4;
      if (p & 15) ch.vibDepth = p & 15;
    }

    // restarts the sample, also when it has already reached its end
    retrig(ch) {
      const v = ch.voice;
      if (!v || (v.stopping && v.active)) return;
      if (!v.active) {
        v.active = true;
        v.stopping = false;
        if (!this.voices.includes(v)) this.voices.push(v);
      }
      v.pos = 0;
      v.dir = 1;
      if (this.song.type === 'it') v.volPos = v.panPos = v.pitchPos = 0;
    }

    volColumn(ch, t) {
      const p = ch.vp;
      switch (ch.vc) {
        case VC.VOL: if (t === 0) ch.vol = Math.min(p, 64); break;
        case VC.FINEUP: if (t === 0) ch.vol = Math.min(64, ch.vol + p); break;
        case VC.FINEDN: if (t === 0) ch.vol = Math.max(0, ch.vol - p); break;
        case VC.SLIDEUP: if (t > 0) ch.vol = Math.min(64, ch.vol + p); break;
        case VC.SLIDEDN: if (t > 0) ch.vol = Math.max(0, ch.vol - p); break;
        case VC.PORTADN: if (t > 0) this.slide(ch, 16 * p); break;
        case VC.PORTAUP: if (t > 0) this.slide(ch, -16 * p); break;
        case VC.PAN: if (t === 0) this.setPan(ch, Math.min(256, p * 4)); break;
        case VC.PANL: if (t > 0) ch.pan = Math.max(0, ch.pan - p); break;
        case VC.PANR: if (t > 0) ch.pan = Math.min(256, ch.pan + p); break;
        case VC.VIBSPEED: if (t === 0 && p) ch.vibSpeed = p; break;
        case VC.VIBDEPTH:
          if (t === 0 && p) ch.vibDepth = p;
          this.vibrato(ch, t, false);
          break;
        case VC.TONEPORTA: {
          const key = this.song.type === 'it' && this.song.linkG ? 'ef' : 'porta';
          if (t === 0 && p) ch.mem[key] = p;
          if (t > 0) this.tonePorta(ch, 4 * (ch.mem[key] || 0));
          break;
        }
      }
    }

    effect(ch, t) {
      const p = ch.param, x = p >> 4, y = p & 15, first = t === 0, type = this.song.type;
      switch (ch.fx) {
        case FX.ARP:
          ch.arp = [0, x, y][t % 3];
          break;
        case FX.PORTAUP:
          if (this.mx) { if (!first) this.slide(ch, -4 * p); }
          else this.stPitchSlide(ch, p, t, -1);
          break;
        case FX.PORTADN:
          if (this.mx) { if (!first) this.slide(ch, 4 * p); }
          else this.stPitchSlide(ch, p, t, 1);
          break;
        case FX.TONEPORTA:
          if (!first) this.tonePorta(ch, 4 * this.portaSpeed(ch));
          break;
        case FX.VIBRATO: case FX.FINEVIB:
          if (first) this.setVibrato(ch, p);
          this.vibrato(ch, t, ch.fx === FX.FINEVIB);
          break;
        case FX.TONEVOL:
          if (!first) this.tonePorta(ch, 4 * this.portaSpeed(ch));
          this.volSlide(ch, p, t);
          break;
        case FX.VIBVOL:
          this.vibrato(ch, t, false);
          this.volSlide(ch, p, t);
          break;
        case FX.TREMOLO:
          if (first) {
            if (x) ch.tremSpeed = x;
            if (y) ch.tremDepth = y;
          }
          if (!first || type === 'it') {
            ch.tremDelta = waveform(ch.tremWave, ch.tremPos) * ch.tremDepth / 64;
            ch.tremPos += ch.tremSpeed;
          }
          break;
        case FX.PAN:
          if (first) {
            if (type === 's3m') { if (p <= 0x80) this.setPan(ch, p * 2); else if (p === 0xA4) ch.surround = true; }
            else this.setPan(ch, p === 255 ? 256 : p);
          }
          break;
        case FX.VOLSLIDE:
          this.volSlide(ch, p, t);
          break;
        case FX.JUMP:
          if (first) {
            this.jumpOrder = p;
            if (this.breakRow < 0) this.breakRow = 0;
          }
          break;
        case FX.SETVOL:
          if (first) ch.vol = Math.min(p, 64);
          break;
        case FX.BREAK:
          if (first) this.breakRow = type === 'it' ? p : x * 10 + y;
          break;
        case FX.SPEED:
          if (first) {
            if (this.mx && p >= 0x20) this.tempo = p;
            else if (p) this.speed = p;
          }
          break;
        case FX.TEMPO:
          if (p >= 0x20) { if (first) this.tempo = p; }
          else if (!first && type === 'it') this.tempo = clamp(this.tempo + (x ? y : -y), 32, 255);
          break;
        case FX.GLOBALVOL:
          if (first) this.gvol = Math.min(p, this.gvolMax);
          break;
        case FX.GVOLSLIDE:
          if (type === 'it') this.stVolSlide(this, 'gvol', p, t, 128);
          else if (!first) this.gvol = clamp(this.gvol + (x ? x : -y), 0, 64);
          break;
        case FX.KEYOFF:
          if (t === p && ch.voice) this.keyOff(ch.voice);
          break;
        case FX.ENVPOS:
          if (first && ch.voice) ch.voice.volPos = ch.voice.panPos = p;
          break;
        case FX.PANSLIDE:
          if (type === 'xm') { if (!first) ch.pan = clamp(ch.pan + (x ? x : -y), 0, 256); }
          else {
            if (y === 15 && x) { if (first) ch.pan = clamp(ch.pan - x * 4, 0, 256); }
            else if (x === 15 && y) { if (first) ch.pan = clamp(ch.pan + y * 4, 0, 256); }
            else if (!first) ch.pan = clamp(ch.pan + (x ? -x * 4 : y * 4), 0, 256);
          }
          break;
        case FX.RETRIG: {
          if (!y) break;
          if (this.mx ? (t > 0 && t % y === 0) : (++ch.retrigCount >= y)) {
            ch.retrigCount = 0;
            this.retrig(ch);
            const v = ch.vol;
            switch (x) {
              case 1: case 2: case 3: case 4: case 5: ch.vol = v - (1 << (x - 1)); break;
              case 6: ch.vol = v * 2 / 3; break;
              case 7: ch.vol = v / 2; break;
              case 9: case 10: case 11: case 12: case 13: ch.vol = v + (1 << (x - 9)); break;
              case 14: ch.vol = v * 3 / 2; break;
              case 15: ch.vol = v * 2; break;
            }
            ch.vol = clamp(Math.round(ch.vol), 0, 64);
          }
          break;
        }
        case FX.TREMOR: {
          // a counter that reloads the on/off length only when the state flips
          if (ch.tremorCount <= 0) {
            ch.tremorOn = !ch.tremorOn;
            ch.tremorCount = ch.tremorOn ? (this.mx ? x + 1 : x || 1) : (this.mx ? y + 1 : y || 1);
          }
          ch.tremorCount--;
          ch.tremorOff = !ch.tremorOn;
          break;
        }
        case FX.XFINEPORTA:
          if (first) {
            const k = 'x' + x;
            let v = y;
            if (v) ch.mem[k] = v; else v = ch.mem[k] || 0;
            if (x === 1) this.slide(ch, -v);
            else if (x === 2) this.slide(ch, v);
          }
          break;
        case FX.CHANVOL:
          if (first) ch.chanVol = Math.min(p, 64);
          break;
        case FX.CHANVOLSLIDE:
          this.stVolSlide(ch, 'chanVol', p, t, 64);
          break;
        case FX.PANBRELLO:
          if (first) {
            if (x) ch.panbSpeed = x;
            if (y) ch.panbDepth = y;
          }
          ch.panDelta = waveform(ch.panbWave, ch.panbPos) * ch.panbDepth / 32;
          ch.panbPos += ch.panbSpeed;
          break;
        case FX.MIDI:
          // default IT macros: SF0 + Z00-Z7F sets the cutoff, SF1 the resonance, Z80-Z8F the resonance
          if (first && type === 'it') {
            if (p < 0x80) { if (ch.macro === 0) ch.cutoff = p; else if (ch.macro === 1) ch.resonance = p; }
            else if (p < 0x90) ch.resonance = (p & 15) * 8;
          }
          break;
        case FX.EXT:
          this.extended(ch, x, y, t);
          break;
        case FX.SPECIAL:
          this.special(ch, x, y, t);
          break;
      }
      if (ch.fx !== FX.TREMOR) ch.tremorOff = false;
    }

    // MOD/XM Exy
    extended(ch, x, y, t) {
      const first = t === 0;
      if (this.song.type === 'xm' && (x === 1 || x === 2 || x === 0xA || x === 0xB)) {
        const k = 'e' + x;
        if (y) ch.mem[k] = y; else y = ch.mem[k] || 0;
      }
      switch (x) {
        case 1: if (first) this.slide(ch, -4 * y); break;
        case 2: if (first) this.slide(ch, 4 * y); break;
        case 4: if (first) ch.vibWave = y; break;
        case 6: if (first) this.patternLoop(ch, y); break;
        case 7: if (first) ch.tremWave = y; break;
        case 8: if (first) ch.pan = Math.round(y * 256 / 15); break;
        case 9: if (y && t > 0 && t % y === 0) this.retrig(ch); break;
        case 0xA: if (first) ch.vol = Math.min(64, ch.vol + y); break;
        case 0xB: if (first) ch.vol = Math.max(0, ch.vol - y); break;
        case 0xC: if (t === y) ch.vol = 0; break;
        case 0xE: if (first && !this.patDelay) this.patDelay = y; break;
      }
    }

    // S3M/IT Sxy
    special(ch, x, y, t) {
      const first = t === 0;
      switch (x) {
        case 3: if (first) ch.vibWave = y; break;
        case 4: if (first) ch.tremWave = y; break;
        case 5: if (first) ch.panbWave = y; break;
        case 6: if (first) this.extraTicks += y; break;
        case 7: if (first) this.noteAction(ch, y); break;
        case 8: if (first) this.setPan(ch, Math.round(y * 256 / 15)); break;
        case 9:
          if (first && y < 2) ch.surround = y === 1;
          else if (first) this.playDirection(ch, y);
          break;
        case 0xA: if (first) ch.offsetHi = y; break;
        case 0xB: if (first) this.patternLoop(ch, y); break;
        case 0xC: if (t === (y || (this.song.type === 'it' ? 1 : -1))) ch.vol = 0; break;
        case 0xE: if (first && !this.patDelay) this.patDelay = y; break;
        case 0xF: if (first) ch.macro = y; break;
      }
    }

    // setting the panning also turns surround off
    setPan(ch, p) {
      ch.pan = p;
      ch.surround = false;
    }

    // S9E / S9F (OpenMPT extension): play the sample forward / backward; a backward note
    // that has not moved yet starts from the end of the sample (or of its loop)
    playDirection(ch, y) {
      const v = ch.voice;
      if (!v || !v.active || (y !== 0xE && y !== 0xF)) return;
      if (y === 0xE) { v.dir = 1; return; }
      const s = v.smp, sus = s.susType && v.keyOn, loop = sus || s.loopType;
      if (v.pos === 0 && (ch.rowNote || !loop)) v.pos = Math.max(0, (sus ? s.susEnd : loop ? s.loopEnd : s.length) - 1e-6);
      v.dir = -1;
    }

    noteAction(ch, y) {
      const past = this.voices.filter((v) => v.active && v.owner === ch.idx && v.bg);
      const v = ch.voice;
      switch (y) {
        case 0: past.forEach((p) => this.stopVoice(p)); break;
        case 1: past.forEach((p) => this.keyOff(p)); break;
        case 2: past.forEach((p) => { p.fading = true; }); break;
        case 3: case 4: case 5: case 6: ch.nna = y - 3; break;
        case 7: case 8: if (v) v.volEnvOn = y === 8 && !!v.ins.volEnv; break;
        case 9: case 10: if (v) v.panEnvOn = y === 10 && !!v.ins.panEnv; break;
        case 11: case 12: if (v) v.pitchEnvOn = y === 12 && !!v.ins.pitchEnv; break;
      }
    }

    patternLoop(ch, y) {
      if (y === 0) { ch.loopRow = this.row; return; }
      if (ch.loopCount) {
        if (--ch.loopCount === 0) {
          if (this.song.type === 'it') ch.loopRow = this.row + 1;
          return;
        }
      } else ch.loopCount = y;
      this.loopJump = ch.loopRow;
    }

    // ------------------------------------------------------------ voice parameters

    updateChannel(ch) {
      const v = ch.voice;
      if (!v || !v.active || v.stopping) return;
      let freq = this.periodFreq(ch.period + ch.vibDelta, ch.c5);
      if (ch.arp) freq *= Math.pow(2, ch.arp / 12);
      v.freq = freq;
      const vol = ch.tremorOff ? 0 : clamp(ch.vol + ch.tremDelta, 0, 64);
      v.vol = vol / 64 * ch.chanVol / 64;
      v.pan = clamp(ch.pan + ch.panDelta, 0, 256);
      v.surround = ch.surround;
      v.cutoff = ch.cutoff;
      v.resonance = ch.resonance;
    }

    updateVoices() {
      const gv = this.gvol / this.gvolMax * this.mixGain, sep = this.separation, xm = this.song.type === 'xm';
      for (const v of this.voices) {
        if (!v.active || v.stopping) continue;
        const ins = v.ins, smp = v.smp;
        let env = 1, pan = clamp(v.pan + v.panSwing, 0, 256), freq = v.freq;
        if (v.volEnvOn) {
          const e = ins.volEnv;
          env = envValue(e, v.volPos) / 64;
          v.volPos = envNext(e, v.volPos, v.keyOn, xm);
          if (v.volPos > e.end) {
            if (e.points[e.points.length - 1].v === 0 && (!v.keyOn || !xm)) { this.stopVoice(v); continue; }
            // IT: the end of the volume envelope starts the note fade
            if (!xm) v.fading = true;
          }
        }
        if (v.panEnvOn) {
          const e = ins.panEnv;
          pan += envValue(e, v.panPos) / 32 * (128 - Math.abs(pan - 128));
          v.panPos = envNext(e, v.panPos, v.keyOn, xm);
        }
        let fmod = 256;
        if (v.pitchEnvOn) {
          const e = ins.pitchEnv, ev = envValue(e, v.pitchPos);
          if (e.filter) fmod = ev * 8;
          else freq *= Math.pow(2, ev / 24);
          v.pitchPos = envNext(e, v.pitchPos, v.keyOn, xm);
        }
        if (this.song.type === 'it') this.setupFilter(v, fmod);
        if (smp.vibDepth) {
          let depth = smp.vibDepth;
          if (xm) {
            // FT2: position advances before use, depth fades in over `sweep` ticks (only while the key is held),
            // the result is added to the period (1/64 semitone for linear periods)
            if (smp.vibSweep && v.keyOn) v.avAmp = Math.min(1, v.avAmp + 1 / smp.vibSweep);
            v.avPos = (v.avPos + smp.vibRate) & 255;
            const d = Math.floor(xmAutoVib(smp.vibType, v.avPos) * depth * (smp.vibSweep ? v.avAmp : 1) / 64);
            if (this.linear) freq *= Math.pow(2, -d / 768);
            else if (freq > 0) freq = AMIGA_CLOCK / (AMIGA_CLOCK / freq + d);
          } else {
            depth *= Math.min(1, v.avTick * (smp.vibSweep || 1) / 256);
            freq *= Math.pow(2, waveform(smp.vibType, v.avPos >> 2) * depth / (255 * 32 * 12));
            v.avPos += smp.vibRate;
          }
          v.avTick++;
        }
        if (v.fading) {
          v.fade -= ins.fadeout;
          if (v.fade <= 0) { v.fade = 0; this.stopVoice(v); continue; }
        }
        v.step = freq / this.sampleRate;
        const gain = this.muted[v.owner] ? 0 : v.vol * env * v.fade * Math.min(1, smp.globalVol / 64 * ins.globalVol * v.swing) * gv;
        const p = v.surround ? 0.5 : (pan / 256 - 0.5) * sep + 0.5;
        // surround (IT/S3M): centered, right channel in opposite phase as much as the stereo separation
        const tl = gain * (2 - 2 * p), tr = v.surround ? gain * (1 - 2 * sep) : gain * 2 * p;
        if (v.fresh) {
          v.fresh = false;
          v.l = v.r = 0;
        }
        v.tl = tl;
        v.tr = tr;
        v.ramp = this.rampLen;
        v.dl = (tl - v.l) / v.ramp;
        v.dr = (tr - v.r) / v.ramp;
      }
    }

    // IT resonant low-pass filter, same formulas as Impulse Tracker / OpenMPT
    // (OpenMPT's "extended filter range" header flag widens the cutoff scale and uses the ModPlug coefficients)
    setupFilter(v, fmod) {
      const cutoff = v.cutoff, res = v.resonance;
      const key = cutoff * 1e6 + res * 1e3 + fmod;
      if (key === v.fkey) return;
      v.fkey = key;
      if (cutoff >= 127 && res === 0 && fmod === 256) { v.flt = false; return; }
      let fc = 110 * Math.pow(2, 0.25 + cutoff * (fmod + 256) / ((this.song.extFilter ? 20 : 24) * 512));
      fc = clamp(Math.round(fc), 120, Math.min(20000, this.sampleRate / 2)) * 2 * Math.PI / this.sampleRate;
      const damp = Math.pow(10, -res * (24 / 128) / 20);
      let d, e;
      if (!this.song.extFilter) {
        // Impulse Tracker coefficients
        const r = 1 / fc;
        d = damp * r + damp - 1;
        e = r * r;
      } else {
        // ModPlug coefficients, used by OpenMPT with the extended filter range
        d = Math.min(2, (1 - 2 * damp) * fc);
        d = (2 * damp - d) / fc;
        e = 1 / (fc * fc);
      }
      const n = 1 + d + e;
      if (!v.flt) { v.y1 = v.y2 = 0; }
      v.flt = true;
      v.fa = 1 / n;
      v.fb0 = (d + e + e) / n;
      v.fb1 = -e / n;
    }

    // ------------------------------------------------------------ mixing

    mix(L, R, off, count) {
      for (const v of this.voices) {
        if (!v.active) continue;
        const smp = v.smp, d = smp.data;
        let ls, le, lt;
        if (smp.susType && v.keyOn) { ls = smp.susStart; le = smp.susEnd; lt = smp.susType; }
        else if (smp.loopType) { ls = smp.loopStart; le = smp.loopEnd; lt = smp.loopType; }
        else { ls = 0; le = smp.length; lt = 0; }
        let pos = v.pos, dir = v.dir, l = v.l, r = v.r, ramp = v.ramp, peak = v.peak, y1 = v.y1, y2 = v.y2;
        const step = v.step, dl = v.dl, dr = v.dr, flt = v.flt, fa = v.fa, fb0 = v.fb0, fb1 = v.fb1;
        if (pos >= le) {
          if (!lt) { v.active = false; continue; }
          pos = ls;
        }
        for (let i = off, end = off + count; i < end; i++) {
          const ip = pos | 0;
          let nx = ip + 1;
          if (nx >= le) nx = lt === 1 ? ls : ip;
          const s0 = d[ip];
          let s = s0 + (d[nx] - s0) * (pos - ip);
          if (flt) {
            s = s * fa + y1 * fb0 + y2 * fb1;
            y2 = y1;
            y1 = s < -2 ? -2 : s > 2 ? 2 : s;
          }
          if (ramp > 0) {
            l += dl;
            r += dr;
            if (--ramp === 0) { l = v.tl; r = v.tr; }
          }
          L[i] += s * l;
          R[i] += s * r;
          const a = (s < 0 ? -s : s) * (l > r ? l : r);
          if (a > peak) peak = a;
          if (dir > 0) {
            pos += step;
            if (pos >= le) {
              if (lt === 0) { v.active = false; break; }
              const len = le - ls;
              if (lt === 1) pos = ls + (pos - le) % len;
              else { pos = Math.max(ls, le - 1 - (pos - le) % len); dir = -1; }
            }
          } else {
            pos -= step;
            if (pos < ls) {
              if (lt === 0) { v.active = false; break; }
              const len = le - ls;
              if (lt === 1) pos = Math.min(le - 1e-6, le - (ls - pos) % len);
              else { pos = Math.min(le - 1, ls + (ls - pos) % len); dir = 1; }
            }
          }
        }
        v.pos = pos;
        v.dir = dir;
        v.l = l;
        v.r = r;
        v.ramp = ramp;
        v.peak = peak;
        v.y1 = y1;
        v.y2 = y2;
        if (v.stopping && ramp <= 0) v.active = false;
      }
    }

    // Fills two channel buffers; calls onTick(sampleOffset) at every tick start.
    render(L, R, onTick) {
      const n = L.length;
      L.fill(0);
      R.fill(0);
      let off = 0;
      while (off < n) {
        if (this.tickLeft <= 0) {
          if (onTick && onTick(off) === false) break;
          this.doTick();
          // whole samples per tick, as the trackers do
          this.tickLeft = Math.max(1, Math.floor(this.sampleRate * 2.5 / this.tempo));
        }
        const count = Math.min(this.tickLeft, n - off);
        this.mix(L, R, off, count);
        off += count;
        this.tickLeft -= count;
      }
    }

    // state for the views, taken at a tick start
    snapshot() {
      const nch = this.nch, vu = new Float32Array(nch), notes = new Int16Array(nch).fill(-1);
      const smps = new Int16Array(nch).fill(-1), ins = new Int16Array(nch);
      const playing = new Set(), heads = [];
      let voices = 0;
      for (const v of this.voices) {
        if (!v.active) continue;
        voices++;
        if (v.peak > vu[v.owner]) vu[v.owner] = v.peak;
        v.peak = 0;
        playing.add(v.smp.index);
        if (!v.stopping) heads.push(v.smp.index, v.pos);   // play positions for the sample browser
      }
      for (const ch of this.channels) {
        const v = ch.voice;
        if (v && v.active && !v.stopping) {
          notes[ch.idx] = ch.note;
          smps[ch.idx] = ch.smp.index;
          ins[ch.idx] = ch.ins;
        }
      }
      const ended = this.ended;
      this.ended = false;
      return {
        order: this.order, row: this.row, pattern: this.song.orders[this.order], tick: this.tick,
        rows: this.pattern.rows, speed: this.speed, tempo: this.tempo, voices, vu, notes, smps, ins, playing, heads, ended,
      };
    }
  }

  // Walks the song without mixing to find its length and the start time of each order.
  function scan(song) {
    const p = new Player(song, 44100);
    p.dry = true;
    const orderTimes = new Array(song.orders.length).fill(-1);
    let time = 0;
    p.ended = false;
    while (time < 3600) {
      if (p.tick === 0 && p.row === 0 && orderTimes[p.order] < 0) orderTimes[p.order] = time;
      p.doTick();
      if (p.ended) break;
      time += 2.5 / p.tempo;
    }
    for (let i = 0, last = 0; i < orderTimes.length; i++) {
      if (orderTimes[i] < 0) orderTimes[i] = last; else last = orderTimes[i];
    }
    return { duration: time, orderTimes };
  }

  // Renders the first minute at a low rate and returns the gain that brings it to a common loudness.
  function measureGain(song) {
    const rate = 11025, p = new Player(song, rate), n = 2048;
    const L = new Float32Array(n), R = new Float32Array(n);
    let sum = 0, count = 0, peak = 0;
    for (let i = 0; i < 60 * rate / n && !p.ended; i++) {
      p.render(L, R);
      for (let k = 0; k < n; k++) {
        const a = L[k], b = R[k];
        sum += a * a + b * b;
        peak = Math.max(peak, Math.abs(a), Math.abs(b));
      }
      count += 2 * n;
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    if (rms < 1e-4) return 1;
    return clamp(Math.min(0.16 / rms, 1.4 / peak), 0.5, 6);
  }

  return { Player, scan, measureGain };
}

const Player = definePlayer(typeof Tracker !== 'undefined' ? Tracker : require('./formats.js'));
if (typeof module !== 'undefined') module.exports = Player;
