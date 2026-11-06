'use strict';

// Module loaders: MOD, S3M, XM and IT are converted into one common song structure.
// Pattern cells are 6 bytes: note, instrument, volume command, volume param, effect, effect param.
const Tracker = (() => {
  const FX = {
    NONE: 0, ARP: 1, PORTAUP: 2, PORTADN: 3, TONEPORTA: 4, VIBRATO: 5, TONEVOL: 6, VIBVOL: 7,
    TREMOLO: 8, PAN: 9, OFFSET: 10, VOLSLIDE: 11, JUMP: 12, SETVOL: 13, BREAK: 14, SPEED: 15,
    TEMPO: 16, GLOBALVOL: 17, GVOLSLIDE: 18, KEYOFF: 19, ENVPOS: 20, PANSLIDE: 21, RETRIG: 22,
    TREMOR: 23, XFINEPORTA: 24, CHANVOL: 25, CHANVOLSLIDE: 26, FINEVIB: 27, PANBRELLO: 28,
    SPECIAL: 29, EXT: 30, MIDI: 31,
  };
  const VC = {
    NONE: 0, VOL: 1, FINEUP: 2, FINEDN: 3, SLIDEUP: 4, SLIDEDN: 5, PORTADN: 6, PORTAUP: 7,
    PAN: 8, TONEPORTA: 9, VIBDEPTH: 10, VIBSPEED: 11, PANL: 12, PANR: 13,
  };
  const NOTE_FADE = 253, NOTE_CUT = 254, NOTE_OFF = 255;
  const CELL = 6;

  // native effect numbers -> internal codes
  const MX_FX = [FX.ARP, FX.PORTAUP, FX.PORTADN, FX.TONEPORTA, FX.VIBRATO, FX.TONEVOL, FX.VIBVOL, FX.TREMOLO,
    FX.PAN, FX.OFFSET, FX.VOLSLIDE, FX.JUMP, FX.SETVOL, FX.BREAK, FX.EXT, FX.SPEED,
    FX.GLOBALVOL, FX.GVOLSLIDE, 0, 0, FX.KEYOFF, FX.ENVPOS, 0, 0, 0, FX.PANSLIDE, 0, FX.RETRIG,
    0, FX.TREMOR, 0, 0, 0, FX.XFINEPORTA, 0, 0];
  const ST_FX = [0, FX.SPEED, FX.JUMP, FX.BREAK, FX.VOLSLIDE, FX.PORTADN, FX.PORTAUP, FX.TONEPORTA,
    FX.VIBRATO, FX.TREMOR, FX.ARP, FX.VIBVOL, FX.TONEVOL, FX.CHANVOL, FX.CHANVOLSLIDE, FX.OFFSET,
    FX.PANSLIDE, FX.RETRIG, FX.TREMOLO, FX.SPECIAL, FX.TEMPO, FX.FINEVIB, FX.GLOBALVOL, FX.GVOLSLIDE,
    FX.PAN, FX.PANBRELLO, FX.MIDI];
  const LETTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const MX_CHAR = [], ST_CHAR = [];
  MX_FX.forEach((f, i) => { if (f) MX_CHAR[f] = LETTERS[i]; });
  ST_FX.forEach((f, i) => { if (f) ST_CHAR[f] = LETTERS[9 + i]; });

  // ---------------------------------------------------------------- helpers

  function text(u8, off, len) {
    let s = '';
    for (let i = 0; i < len && off + i < u8.length; i++) {
      const c = u8[off + i];
      if (c === 0) break;
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
    }
    return s.replace(/\s+$/, '');
  }

  function makeSample(o) {
    return Object.assign({
      name: '', data: new Float32Array(0), length: 0, bits: 8, stereo: false,
      loopStart: 0, loopEnd: 0, loopType: 0, susStart: 0, susEnd: 0, susType: 0,
      volume: 64, globalVol: 64, pan: -1, c5: 8363,
      vibType: 0, vibSweep: 0, vibDepth: 0, vibRate: 0,
    }, o);
  }

  function makeInstrument(o) {
    const noteMap = new Uint8Array(120);
    for (let i = 0; i < 120; i++) noteMap[i] = i;
    return Object.assign({
      name: '', sampleMap: new Int16Array(120).fill(-1), noteMap,
      volEnv: null, panEnv: null, pitchEnv: null,
      fadeout: 0, nna: 0, dct: 0, dca: 0, globalVol: 1, pan: -1, cutoff: -1, resonance: -1,
      volSwing: 0, panSwing: 0,
    }, o);
  }

  function fixLoops(s) {
    s.length = s.data.length;
    if (s.loopType && !(s.loopStart < s.length && s.loopEnd > s.loopStart)) s.loopType = 0;
    if (s.loopType) s.loopEnd = Math.min(s.loopEnd, s.length);
    if (s.susType && !(s.susStart < s.length && s.susEnd > s.susStart)) s.susType = 0;
    if (s.susType) s.susEnd = Math.min(s.susEnd, s.length);
    return s;
  }

  // Reads 8/16 bit PCM; stereo samples (stored as two blocks) are mixed down to mono.
  function readPCM(u8, off, len, o = {}) {
    const out = new Float32Array(Math.max(0, len));
    const chans = o.stereo ? 2 : 1, bps = o.bits16 ? 2 : 1;
    for (let c = 0; c < chans; c++) {
      let p = off + c * len * bps, acc = 0;
      for (let i = 0; i < len && p + bps <= u8.length; i++, p += bps) {
        let v = o.bits16 ? (u8[p] | (u8[p + 1] << 8)) : u8[p];
        if (o.delta) { acc = (acc + v) & (o.bits16 ? 0xFFFF : 0xFF); v = acc; }
        if (o.unsigned) v ^= o.bits16 ? 0x8000 : 0x80;
        out[i] += (o.bits16 ? (v << 16 >> 16) / 32768 : (v << 24 >> 24) / 128) / chans;
      }
    }
    return out;
  }

  // IT 2.14 / 2.15 sample decompression (one channel). Returns signed values.
  function itDecompress(u8, off, len, bits16, it215) {
    const out = new Float32Array(len);
    const maxWidth = bits16 ? 17 : 9, blockLen = bits16 ? 0x4000 : 0x8000;
    const scale = bits16 ? 32768 : 128;
    let pos = off, dest = 0;
    while (dest < len && pos + 2 <= u8.length) {
      const size = u8[pos] | (u8[pos + 1] << 8);
      pos += 2;
      const end = Math.min(pos + size, u8.length);
      let bitPos = pos * 8;
      const readBits = (n) => {
        let v = 0;
        for (let i = 0; i < n; i++, bitPos++) {
          const byte = bitPos >> 3;
          if (byte >= end) return v;
          v |= ((u8[byte] >> (bitPos & 7)) & 1) << i;
        }
        return v;
      };
      const count = Math.min(blockLen, len - dest);
      let width = maxWidth, d1 = 0, d2 = 0, i = 0;
      while (i < count && (bitPos >> 3) < end) {
        let v = readBits(width);
        if (width < 7) {
          if (v === 1 << (width - 1)) {
            v = readBits(bits16 ? 4 : 3) + 1;
            width = v < width ? v : v + 1;
            continue;
          }
        } else if (width < maxWidth) {
          const border = ((bits16 ? 0xFFFF : 0xFF) >> (maxWidth - width)) - (bits16 ? 8 : 4);
          if (v > border && v <= border + (bits16 ? 16 : 8)) {
            v -= border;
            width = v < width ? v : v + 1;
            continue;
          }
        } else if (width === maxWidth) {
          if (v & (bits16 ? 0x10000 : 0x100)) { width = (v + 1) & 0xFF; continue; }
        } else break;
        const bits = bits16 ? 16 : 8;
        if (width < bits) { const sh = 32 - width; v = (v << sh) >> sh; }
        else v = bits16 ? (v << 16 >> 16) : (v << 24 >> 24);
        if (bits16) { d1 = (d1 + v) << 16 >> 16; d2 = (d2 + d1) << 16 >> 16; }
        else { d1 = (d1 + v) << 24 >> 24; d2 = (d2 + d1) << 24 >> 24; }
        out[dest + i] = (it215 ? d2 : d1) / scale;
        i++;
      }
      dest += count;
      pos = end;
    }
    return out;
  }

  function emptyPattern(rows, nch) {
    return { rows, data: new Uint8Array(rows * nch * CELL) };
  }

  // Converts a MOD/XM effect (0..35) into the cell
  function setMXEffect(d, o, eff, param) {
    let fx = eff < MX_FX.length ? MX_FX[eff] : 0;
    if (fx === FX.ARP && !param) fx = 0;
    if (fx === FX.SPEED && !param) fx = 0;
    d[o + 4] = fx;
    d[o + 5] = fx ? param : 0;
  }

  // ---------------------------------------------------------------- MOD

  function loadMOD(u8) {
    const sig = text(u8, 1080, 4);
    let nch = 0, nsmp = 31;
    if (/^(M\.K\.|M!K!|M&K!|FLT4|4CHN|N\.T\.)$/.test(sig)) nch = 4;
    else if (/^(OCTA|OKTA|CD81|FLT8)$/.test(sig)) nch = 8;
    else if (/^\dCHN$/.test(sig)) nch = +sig[0];
    else if (/^\d\d(CH|CN)$/.test(sig)) nch = +sig.slice(0, 2);
    else if (/^TDZ\d$/.test(sig)) nch = +sig[3];
    else { nch = 4; nsmp = 15; }
    if (!nch || u8.length < 20 + nsmp * 30 + 130) throw new Error('Not a module file');

    const hdr = 20 + nsmp * 30;
    const songLen = u8[hdr];
    if (!songLen || songLen > 128) throw new Error('Not a module file');
    const allOrders = Array.from(u8.subarray(hdr + 2, hdr + 130));
    const orders = allOrders.slice(0, songLen);
    const patStart = hdr + 130 + (nsmp === 31 ? 4 : 0);
    const patSize = 64 * nch * 4;

    const headers = [];
    let smpBytes = 0;
    for (let i = 0; i < nsmp; i++) {
      const o = 20 + i * 30;
      const len = ((u8[o + 22] << 8) | u8[o + 23]) * 2;
      let ft = u8[o + 24] & 15;
      if (ft > 7) ft -= 16;
      headers.push({
        name: text(u8, o, 22), len, ft, vol: Math.min(u8[o + 25], 64),
        ls: ((u8[o + 26] << 8) | u8[o + 27]) * 2, ll: ((u8[o + 28] << 8) | u8[o + 29]) * 2,
      });
      smpBytes += len;
    }
    // old 15-sample files have no signature: reject data that cannot be one
    if (nsmp === 15 && (headers.some((h, i) => u8[20 + i * 30 + 25] > 64) || allOrders.some((o) => o > 63))) {
      throw new Error('Not a module file');
    }
    let npat = Math.max(...allOrders) + 1;
    if (patStart + npat * patSize + smpBytes > u8.length + 1024) npat = Math.max(...orders) + 1;

    const patterns = [];
    for (let p = 0; p < npat; p++) {
      const pat = emptyPattern(64, nch), d = pat.data;
      for (let r = 0; r < 64; r++) {
        for (let c = 0; c < nch; c++) {
          const src = patStart + p * patSize + (r * nch + c) * 4;
          if (src + 4 > u8.length) continue;
          const b0 = u8[src], b1 = u8[src + 1], b2 = u8[src + 2], b3 = u8[src + 3];
          const o = (r * nch + c) * CELL;
          const period = ((b0 & 0x0F) << 8) | b1;
          if (period) d[o] = Math.max(0, Math.min(119, Math.round(60 + 12 * Math.log2(428 / period)))) + 1;
          d[o + 1] = (b0 & 0xF0) | (b2 >> 4);
          setMXEffect(d, o, b2 & 0x0F, b3);
        }
      }
      patterns.push(pat);
    }

    let off = patStart + npat * patSize;
    const samples = headers.map((h, i) => {
      const data = readPCM(u8, off, Math.min(h.len, Math.max(0, u8.length - off)));
      off += h.len;
      let ls = h.ls;
      if (h.ll > 2 && ls + h.ll > h.len && ls / 2 + h.ll <= h.len) ls /= 2;
      return fixLoops(makeSample({
        index: i, name: h.name, data, volume: h.vol, c5: 8363 * Math.pow(2, h.ft / 96),
        loopType: h.ll > 2 ? 1 : 0, loopStart: ls, loopEnd: ls + h.ll,
      }));
    });

    const chanPan = [];
    for (let c = 0; c < nch; c++) chanPan.push((c & 3) === 0 || (c & 3) === 3 ? 0 : 256);
    return {
      type: 'mod', format: nsmp === 15 ? 'MOD (15)' : 'MOD', title: text(u8, 0, 20), tracker: sig.trim() || 'Soundtracker',
      channels: nch, orders, restart: u8[hdr + 1] < songLen ? u8[hdr + 1] : 0, patterns, samples,
      instruments: samples.map((s, i) => makeInstrument({ name: s.name, sampleMap: new Int16Array(120).fill(i) })),
      useInstruments: false, speed: 6, tempo: 125, globalVol: 64, chanPan, chanVol: new Array(nch).fill(64),
      linear: false, octaveShift: -3, rowHighlight: 4, message: '',
    };
  }

  // ---------------------------------------------------------------- S3M

  function loadS3M(u8, dv) {
    const ordNum = dv.getUint16(0x20, true), insNum = dv.getUint16(0x22, true), patNum = dv.getUint16(0x24, true);
    const flags = dv.getUint16(0x26, true), cwt = dv.getUint16(0x28, true), ffi = dv.getUint16(0x2A, true);
    const stereo = u8[0x33] & 0x80;
    let nch = 0;
    const chanPan = [];
    for (let c = 0; c < 32; c++) {
      const s = u8[0x40 + c];
      if ((s & 0x7F) < 16 && !(s & 0x80)) nch = c + 1;
      chanPan.push(!stereo ? 128 : (s & 0x7F) < 8 ? 51 : 205);
    }
    nch = Math.max(nch, 1);
    const orders = [];
    for (let i = 0; i < ordNum; i++) {
      const o = u8[0x60 + i];
      if (o === 255) break;
      orders.push(o);
    }
    const insPtr = 0x60 + ordNum, patPtr = insPtr + insNum * 2;
    if (u8[0x35] === 0xFC) {
      const panOff = patPtr + patNum * 2;
      for (let c = 0; c < 32; c++) {
        const b = u8[panOff + c];
        if (b & 0x20) chanPan[c] = Math.round((b & 15) * 256 / 15);
      }
    }

    const samples = [];
    for (let i = 0; i < insNum; i++) {
      const o = dv.getUint16(insPtr + i * 2, true) * 16;
      const s = makeSample({ index: i, name: text(u8, o + 0x30, 28) });
      if (o && u8[o] === 1 && o + 0x50 <= u8.length) {
        const memseg = ((u8[o + 0x0D] << 16) | dv.getUint16(o + 0x0E, true)) * 16;
        const len = dv.getUint32(o + 0x10, true), f = u8[o + 0x1F];
        s.bits = f & 4 ? 16 : 8;
        s.stereo = !!(f & 2);
        s.data = readPCM(u8, memseg, Math.min(len, 0x400000), { bits16: f & 4, stereo: f & 2, unsigned: ffi !== 1 });
        s.volume = Math.min(u8[o + 0x1C], 64);
        s.c5 = dv.getUint32(o + 0x20, true) || 8363;
        if (f & 1) { s.loopType = 1; s.loopStart = dv.getUint32(o + 0x14, true); s.loopEnd = dv.getUint32(o + 0x18, true); }
      }
      samples.push(fixLoops(s));
    }

    const patterns = [];
    for (let p = 0; p < patNum; p++) {
      const pat = emptyPattern(64, nch), d = pat.data;
      let o = dv.getUint16(patPtr + p * 2, true) * 16;
      patterns.push(pat);
      if (!o) continue;
      const end = Math.min(u8.length, o + dv.getUint16(o, true) + 2);
      o += 2;
      for (let r = 0; r < 64 && o < end;) {
        const what = u8[o++];
        if (!what) { r++; continue; }
        const c = what & 31, valid = c < nch, at = (r * nch + c) * CELL;
        if (what & 32) {
          const note = u8[o], ins = u8[o + 1];
          o += 2;
          if (valid) {
            if (note === 254) d[at] = NOTE_CUT;
            else if (note < 0xF0) d[at] = Math.min(119, (note >> 4) * 12 + (note & 15) + 12) + 1;
            d[at + 1] = ins;
          }
        }
        if (what & 64) {
          const v = u8[o++];
          if (valid) {
            if (v <= 64) { d[at + 2] = VC.VOL; d[at + 3] = v; }
            else if (v >= 128 && v <= 192) { d[at + 2] = VC.PAN; d[at + 3] = v - 128; }
          }
        }
        if (what & 128) {
          const cmd = u8[o], info = u8[o + 1];
          o += 2;
          if (valid && cmd >= 1 && cmd <= 26) { d[at + 4] = ST_FX[cmd]; d[at + 5] = info; }
        }
      }
    }
    return {
      type: 's3m', format: 'S3M', title: text(u8, 0, 28), tracker: cwt >> 12 === 1 ? 'Scream Tracker 3' : 'S3M tracker',
      channels: nch, orders, restart: 0, patterns, samples,
      instruments: samples.map((s, i) => makeInstrument({ name: s.name, sampleMap: new Int16Array(120).fill(i) })),
      useInstruments: false, speed: u8[0x31] && u8[0x31] !== 255 ? u8[0x31] : 6, tempo: u8[0x32] >= 33 ? u8[0x32] : 125,
      globalVol: u8[0x30] || 64, chanPan: chanPan.slice(0, nch), chanVol: new Array(nch).fill(64),
      linear: false, fastSlides: !!(flags & 64) || cwt === 0x1300, octaveShift: -1, rowHighlight: 4, message: '',
    };
  }

  // ---------------------------------------------------------------- XM

  function envFromPoints(pts, n, flags, sus, ls, le, center) {
    if (!(flags & 1) || !n) return null;
    const points = [];
    for (let i = 0; i < Math.min(n, pts.length); i++) points.push({ t: pts[i][0], v: pts[i][1] - center });
    const tick = (i) => points[Math.min(i, points.length - 1)].t;
    return {
      points, end: points[points.length - 1].t,
      sus: !!(flags & 2), susStart: tick(sus), susEnd: tick(sus),
      loop: !!(flags & 4), loopStart: tick(ls), loopEnd: tick(le),
    };
  }

  function loadXM(u8, dv) {
    const hsize = dv.getUint32(60, true);
    const songLen = dv.getUint16(64, true), restart = dv.getUint16(66, true);
    const nch = Math.max(1, dv.getUint16(68, true)), npat = dv.getUint16(70, true), nins = dv.getUint16(72, true);
    const flags = dv.getUint16(74, true);
    const orders = Array.from(u8.subarray(80, 80 + Math.min(songLen, 256)));
    let off = 60 + hsize;

    const patterns = [];
    for (let p = 0; p < npat; p++) {
      const hlen = dv.getUint32(off, true);
      const rows = dv.getUint16(off + 5, true) || 64, psize = dv.getUint16(off + 7, true);
      off += hlen;
      const pat = emptyPattern(rows, nch), d = pat.data;
      let o = off;
      const end = Math.min(u8.length, off + psize);
      for (let i = 0; i < rows * nch && o < end; i++) {
        let b = u8[o++], note = 0, ins = 0, vol = 0, eff = 0, param = 0;
        if (b & 0x80) {
          if (b & 1) note = u8[o++];
          if (b & 2) ins = u8[o++];
          if (b & 4) vol = u8[o++];
          if (b & 8) eff = u8[o++];
          if (b & 16) param = u8[o++];
        } else {
          note = b; ins = u8[o]; vol = u8[o + 1]; eff = u8[o + 2]; param = u8[o + 3];
          o += 4;
        }
        const at = i * CELL;
        if (note === 97) d[at] = NOTE_OFF;
        else if (note >= 1 && note <= 96) d[at] = note + 12;
        d[at + 1] = ins;
        const hi = vol >> 4, lo = vol & 15;
        if (vol >= 0x10 && vol <= 0x50) { d[at + 2] = VC.VOL; d[at + 3] = vol - 0x10; }
        else if (hi >= 6) {
          d[at + 2] = [VC.SLIDEDN, VC.SLIDEUP, VC.FINEDN, VC.FINEUP, VC.VIBSPEED, VC.VIBDEPTH,
            VC.PAN, VC.PANL, VC.PANR, VC.TONEPORTA][hi - 6];
          d[at + 3] = hi === 0xC ? Math.round(lo * 64 / 15) : hi === 0xF ? lo << 4 : lo;
        }
        setMXEffect(d, at, eff, param);
      }
      off += psize;
      patterns.push(pat);
    }

    const samples = [], instruments = [];
    for (let i = 0; i < nins && off + 29 <= u8.length; i++) {
      const isz = dv.getUint32(off, true), nsmp = dv.getUint16(off + 27, true);
      const ins = makeInstrument({ name: text(u8, off + 4, 22) });
      instruments.push(ins);
      if (!nsmp) { off += isz; continue; }
      const shsize = dv.getUint32(off + 29, true) || 40;
      const pts = (base) => {
        const a = [];
        for (let k = 0; k < 12; k++) a.push([dv.getUint16(base + k * 4, true), dv.getUint16(base + k * 4 + 2, true)]);
        return a;
      };
      const vib = { vibType: u8[off + 235], vibSweep: u8[off + 236], vibDepth: u8[off + 237], vibRate: u8[off + 238] };
      ins.volEnv = envFromPoints(pts(off + 129), u8[off + 225], u8[off + 233], u8[off + 227], u8[off + 228], u8[off + 229], 0);
      ins.panEnv = envFromPoints(pts(off + 177), u8[off + 226], u8[off + 234], u8[off + 230], u8[off + 231], u8[off + 232], 32);
      ins.fadeout = dv.getUint16(off + 239, true) / 32768;
      const first = samples.length;
      for (let n = 12; n < 108; n++) {
        const k = u8[off + 33 + n - 12];
        ins.sampleMap[n] = k < nsmp ? first + k : -1;
      }
      off += isz;
      const heads = [];
      for (let s = 0; s < nsmp; s++, off += shsize) {
        heads.push({
          len: dv.getUint32(off, true), ls: dv.getUint32(off + 4, true), ll: dv.getUint32(off + 8, true),
          vol: Math.min(u8[off + 12], 64), fine: dv.getInt8(off + 13), type: u8[off + 14], pan: u8[off + 15],
          rel: dv.getInt8(off + 16), name: text(u8, off + 18, 22),
        });
      }
      for (const h of heads) {
        const b16 = (h.type & 16) ? 2 : 1;
        const s = makeSample(Object.assign({
          index: samples.length, name: h.name, bits: b16 * 8, volume: h.vol, pan: Math.round(h.pan * 256 / 255),
          c5: 8363 * Math.pow(2, (h.rel + h.fine / 128) / 12), relNote: h.rel,
          data: readPCM(u8, off, Math.floor(Math.min(h.len, Math.max(0, u8.length - off)) / b16), { bits16: b16 === 2, delta: true }),
          loopType: h.ll ? ((h.type & 3) === 2 ? 2 : (h.type & 3) ? 1 : 0) : 0,
          loopStart: Math.floor(h.ls / b16), loopEnd: Math.floor((h.ls + h.ll) / b16),
        }, vib));
        samples.push(fixLoops(s));
        off += h.len;
      }
    }
    return {
      type: 'xm', format: 'XM', title: text(u8, 17, 20), tracker: text(u8, 38, 20),
      channels: nch, orders, restart: restart < orders.length ? restart : 0, patterns, samples, instruments,
      useInstruments: true, speed: dv.getUint16(76, true) || 6, tempo: dv.getUint16(78, true) || 125, globalVol: 64,
      chanPan: new Array(nch).fill(128), chanVol: new Array(nch).fill(64),
      linear: !!(flags & 1), octaveShift: -1, rowHighlight: 4, message: '',
    };
  }

  // ---------------------------------------------------------------- IT

  // disabled envelopes are kept (on: false): S78 / S7A / S7C can turn them on
  function readITEnv(u8, dv, o, center) {
    const flags = u8[o], n = Math.min(u8[o + 1], 25);
    if (!n) return null;
    const points = [];
    for (let i = 0; i < n; i++) {
      const v = center ? dv.getInt8(o + 6 + i * 3) : u8[o + 6 + i * 3];
      points.push({ t: dv.getUint16(o + 7 + i * 3, true), v });
    }
    const tick = (i) => points[Math.min(i, n - 1)].t;
    return {
      points, end: points[n - 1].t, on: !!(flags & 1), filter: !!(flags & 128),
      loop: !!(flags & 2), loopStart: tick(u8[o + 2]), loopEnd: tick(u8[o + 3]),
      sus: !!(flags & 4), susStart: tick(u8[o + 4]), susEnd: tick(u8[o + 5]),
    };
  }

  function loadIT(u8, dv) {
    const ordNum = dv.getUint16(0x20, true), insNum = dv.getUint16(0x22, true);
    const smpNum = dv.getUint16(0x24, true), patNum = dv.getUint16(0x26, true);
    const cmwt = dv.getUint16(0x2A, true), flags = dv.getUint16(0x2C, true), special = dv.getUint16(0x2E, true);
    const orders = [];
    for (let i = 0; i < ordNum; i++) {
      const o = u8[0xC0 + i];
      if (o === 255) break;
      orders.push(o);
    }
    const insOff = 0xC0 + ordNum, smpOff = insOff + insNum * 4, patOff = smpOff + smpNum * 4;

    const samples = [];
    for (let i = 0; i < smpNum; i++) {
      const o = dv.getUint32(smpOff + i * 4, true);
      const s = makeSample({ index: i });
      if (o + 0x50 <= u8.length && text(u8, o, 4) === 'IMPS') {
        const f = u8[o + 0x12], cvt = u8[o + 0x2E], dfp = u8[o + 0x2F];
        const len = Math.min(dv.getUint32(o + 0x30, true), 0x1000000);
        Object.assign(s, {
          name: text(u8, o + 0x14, 26), globalVol: Math.min(u8[o + 0x11], 64), volume: Math.min(u8[o + 0x13], 64),
          pan: dfp & 128 ? Math.min(dfp & 127, 64) * 4 : -1, c5: dv.getUint32(o + 0x3C, true) || 8363,
          bits: f & 2 ? 16 : 8, stereo: !!(f & 4),
          loopType: f & 16 ? (f & 64 ? 2 : 1) : 0, loopStart: dv.getUint32(o + 0x34, true), loopEnd: dv.getUint32(o + 0x38, true),
          susType: f & 32 ? (f & 128 ? 2 : 1) : 0, susStart: dv.getUint32(o + 0x40, true), susEnd: dv.getUint32(o + 0x44, true),
          vibRate: u8[o + 0x4C], vibDepth: u8[o + 0x4D], vibSweep: u8[o + 0x4E], vibType: u8[o + 0x4F],
        });
        const ptr = dv.getUint32(o + 0x48, true);
        if ((f & 1) && len) {
          if (f & 8) {
            s.data = itDecompress(u8, ptr, len, !!(f & 2), !!(cvt & 4));
            if (f & 4) {
              // the right channel follows the left one: find its start by decoding again is costly,
              // so walk the block headers of the left channel
              let p = ptr, done = 0;
              const block = f & 2 ? 0x4000 : 0x8000;
              while (done < len && p + 2 <= u8.length) { p += 2 + (u8[p] | (u8[p + 1] << 8)); done += block; }
              const right = itDecompress(u8, p, len, !!(f & 2), !!(cvt & 4));
              for (let k = 0; k < len; k++) s.data[k] = (s.data[k] + right[k]) / 2;
            }
          } else {
            s.data = readPCM(u8, ptr, len, { bits16: f & 2, stereo: f & 4, unsigned: !(cvt & 1) });
          }
        }
      }
      samples.push(fixLoops(s));
    }

    let instruments;
    const useInstruments = !!(flags & 4);
    if (useInstruments) {
      instruments = [];
      for (let i = 0; i < insNum; i++) {
        const o = dv.getUint32(insOff + i * 4, true);
        const ins = makeInstrument({});
        instruments.push(ins);
        if (o + 0x200 > u8.length || text(u8, o, 4) !== 'IMPI') continue;
        ins.name = text(u8, o + 0x20, 26);
        for (let n = 0; n < 120; n++) {
          const note = u8[o + 0x40 + n * 2], smp = u8[o + 0x41 + n * 2];
          ins.noteMap[n] = note < 120 ? note : n;
          ins.sampleMap[n] = smp && smp <= smpNum ? smp - 1 : -1;
        }
        if (cmwt >= 0x200) {
          ins.nna = u8[o + 0x11] & 3;
          ins.dct = u8[o + 0x12] & 3;
          ins.dca = u8[o + 0x13] % 3;
          ins.fadeout = dv.getUint16(o + 0x14, true) / 1024;
          ins.globalVol = Math.min(u8[o + 0x18], 128) / 128;
          ins.pan = u8[o + 0x19] & 128 ? -1 : Math.min(u8[o + 0x19], 64) * 4;
          ins.volSwing = Math.min(u8[o + 0x1A], 100) / 100;
          ins.panSwing = Math.min(u8[o + 0x1B], 64) * 4;
          if (u8[o + 0x3A] & 128) ins.cutoff = u8[o + 0x3A] & 127;
          if (u8[o + 0x3B] & 128) ins.resonance = u8[o + 0x3B] & 127;
          ins.volEnv = readITEnv(u8, dv, o + 0x130, false);
          ins.panEnv = readITEnv(u8, dv, o + 0x182, true);
          ins.pitchEnv = readITEnv(u8, dv, o + 0x1D4, true);
        } else {
          // old (IT 1.x) instrument layout
          const f = u8[o + 0x11];
          ins.nna = u8[o + 0x1A] & 3;
          ins.fadeout = dv.getUint16(o + 0x18, true) / 512;
          const points = [];
          for (let k = 0; k < 25; k++) {
            const t = u8[o + 0x1F8 + k * 2];
            if (t === 0xFF) break;
            points.push({ t, v: u8[o + 0x1F9 + k * 2] });
          }
          if ((f & 1) && points.length) {
            const tick = (k) => points[Math.min(k, points.length - 1)].t;
            ins.volEnv = {
              points, end: points[points.length - 1].t,
              loop: !!(f & 2), loopStart: tick(u8[o + 0x12]), loopEnd: tick(u8[o + 0x13]),
              sus: !!(f & 4), susStart: tick(u8[o + 0x14]), susEnd: tick(u8[o + 0x15]),
            };
          }
        }
      }
    } else {
      instruments = samples.map((s, i) => makeInstrument({ name: s.name, sampleMap: new Int16Array(120).fill(i), fadeout: 1 }));
    }

    // patterns: decode into 64 channels, then keep only the channels in use
    const raw = [];
    let nch = 1;
    for (let p = 0; p < patNum; p++) {
      const o = dv.getUint32(patOff + p * 4, true);
      if (!o || o + 8 > u8.length) { raw.push({ rows: 64, data: null }); continue; }
      const len = dv.getUint16(o, true), rows = dv.getUint16(o + 2, true) || 64;
      const d = new Uint8Array(rows * 64 * CELL);
      const mask = new Uint8Array(64), last = new Uint8Array(64 * CELL);
      let q = o + 8;
      const end = Math.min(u8.length, q + len);
      for (let r = 0; r < rows && q < end;) {
        const cv = u8[q++];
        if (!cv) { r++; continue; }
        const c = (cv - 1) & 63;
        if (cv & 128) mask[c] = u8[q++];
        const m = mask[c], at = (r * 64 + c) * CELL, lc = c * CELL;
        if (m & 1) {
          const n = u8[q++];
          last[lc] = n === 255 ? NOTE_OFF : n === 254 ? NOTE_CUT : n >= 120 ? NOTE_FADE : n + 1;
        }
        if (m & 2) last[lc + 1] = u8[q++];
        if (m & 4) {
          const v = u8[q++];
          let vc = 0, vp = 0;
          if (v <= 64) { vc = VC.VOL; vp = v; }
          else if (v <= 74) { vc = VC.FINEUP; vp = v - 65; }
          else if (v <= 84) { vc = VC.FINEDN; vp = v - 75; }
          else if (v <= 94) { vc = VC.SLIDEUP; vp = v - 85; }
          else if (v <= 104) { vc = VC.SLIDEDN; vp = v - 95; }
          else if (v <= 114) { vc = VC.PORTADN; vp = v - 105; }
          else if (v <= 124) { vc = VC.PORTAUP; vp = v - 115; }
          else if (v >= 128 && v <= 192) { vc = VC.PAN; vp = v - 128; }
          else if (v >= 193 && v <= 202) { vc = VC.TONEPORTA; vp = [0, 1, 4, 8, 16, 32, 64, 96, 128, 255][v - 193]; }
          else if (v >= 203 && v <= 212) { vc = VC.VIBDEPTH; vp = v - 203; }
          last[lc + 2] = vc;
          last[lc + 3] = vp;
        }
        if (m & 8) {
          const cmd = u8[q], info = u8[q + 1];
          q += 2;
          last[lc + 4] = cmd >= 1 && cmd <= 26 ? ST_FX[cmd] : 0;
          last[lc + 5] = last[lc + 4] ? info : 0;
        }
        if (m & 0x11) d[at] = last[lc];
        if (m & 0x22) d[at + 1] = last[lc + 1];
        if (m & 0x44) { d[at + 2] = last[lc + 2]; d[at + 3] = last[lc + 3]; }
        if (m & 0x88) { d[at + 4] = last[lc + 4]; d[at + 5] = last[lc + 5]; }
        if (m) nch = Math.max(nch, c + 1);
      }
      raw.push({ rows, data: d });
    }
    const patterns = raw.map(({ rows, data }) => {
      const pat = emptyPattern(rows, nch);
      if (data) for (let r = 0; r < rows; r++) pat.data.set(data.subarray(r * 64 * CELL, (r * 64 + nch) * CELL), r * nch * CELL);
      return pat;
    });

    const stereo = flags & 1;
    const chanPan = [], chanVol = [], chanSurround = [];
    for (let c = 0; c < nch; c++) {
      const p = u8[0x40 + c] & 127;
      chanPan.push(stereo && p <= 64 ? p * 4 : 128);
      chanSurround.push(stereo && p === 100);
      chanVol.push(Math.min(u8[0x80 + c], 64));
    }
    let message = '';
    if (special & 1) {
      const len = dv.getUint16(0x36, true), mo = dv.getUint32(0x38, true);
      for (let i = 0; i < len && mo + i < u8.length; i++) {
        const c = u8[mo + i];
        if (!c) break;
        message += c === 13 ? '\n' : c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
      }
    }
    return {
      type: 'it', format: 'IT', title: text(u8, 4, 26), tracker: dv.getUint16(0x28, true) >= 0x5000 ? 'OpenMPT' : 'Impulse Tracker',
      channels: nch, orders, restart: 0, patterns, samples, instruments, useInstruments,
      speed: u8[0x32] || 6, tempo: u8[0x33] >= 32 ? u8[0x33] : 125, globalVol: Math.min(u8[0x30], 128),
      chanPan, chanVol, chanSurround, linear: !!(flags & 8), linkG: !!(flags & 32), oldEffects: !!(flags & 16),
      extFilter: !!(flags & 0x1000), octaveShift: 0, rowHighlight: u8[0x1E] || 4, message,
    };
  }

  // ---------------------------------------------------------------- entry point

  function load(buffer) {
    const u8 = new Uint8Array(buffer), dv = new DataView(buffer);
    let song;
    if (text(u8, 0, 17) === 'Extended Module:') song = loadXM(u8, dv);
    else if (text(u8, 0, 4) === 'IMPM') song = loadIT(u8, dv);
    else if (u8.length > 0x60 && text(u8, 0x2C, 4) === 'SCRM') song = loadS3M(u8, dv);
    else song = loadMOD(u8);
    if (!song.orders.length) throw new Error('The module has no orders');
    song.patterns.forEach((p) => { p.used = false; });
    for (const o of song.orders) if (song.patterns[o]) song.patterns[o].used = true;
    return song;
  }

  // ---------------------------------------------------------------- display helpers

  const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
  const VC_CHARS = ' vabcdefpghulr';
  const HEX = (v) => v.toString(16).toUpperCase().padStart(2, '0');

  function noteText(note, shift) {
    if (!note) return '...';
    if (note === NOTE_OFF) return '===';
    if (note === NOTE_CUT) return '^^^';
    if (note === NOTE_FADE) return '~~~';
    const n = note - 1;
    return NOTE_NAMES[n % 12] + Math.max(0, Math.floor(n / 12) + shift);
  }
  function noteName(n, shift) { return n < 0 ? '' : noteText(n + 1, shift); }

  function volText(vc, vp) {
    return vc ? VC_CHARS[vc] + String(vp).padStart(2, '0') : '...';
  }

  function fxText(type, fx, param) {
    if (!fx) return '...';
    const c = (type === 'mod' || type === 'xm' ? MX_CHAR : ST_CHAR)[fx] || '?';
    return c + HEX(param);
  }

  // colour class of an effect: pitch, volume, pan, global or misc
  function fxClass(fx, param) {
    const x = param >> 4;
    switch (fx) {
      case FX.ARP: case FX.PORTAUP: case FX.PORTADN: case FX.TONEPORTA: case FX.VIBRATO:
      case FX.FINEVIB: case FX.XFINEPORTA: case FX.TONEVOL: case FX.VIBVOL:
        return 'pitch';
      case FX.VOLSLIDE: case FX.SETVOL: case FX.TREMOLO: case FX.TREMOR: case FX.CHANVOL: case FX.CHANVOLSLIDE:
        return 'volume';
      case FX.PAN: case FX.PANSLIDE: case FX.PANBRELLO:
        return 'pan';
      case FX.JUMP: case FX.BREAK: case FX.SPEED: case FX.TEMPO: case FX.GLOBALVOL: case FX.GVOLSLIDE:
        return 'global';
      case FX.EXT:
        return x >= 1 && x <= 5 ? 'pitch' : x === 6 || x === 0xE ? 'global' : x === 7 || (x >= 0xA && x <= 0xC) ? 'volume' : x === 8 ? 'pan' : 'misc';
      case FX.SPECIAL:
        return x >= 1 && x <= 3 ? 'pitch' : x === 4 ? 'volume' : x === 5 || x === 8 ? 'pan' : x === 6 || x === 0xB || x === 0xE ? 'global' : 'misc';
      default:
        return 'misc';
    }
  }

  function volClass(vc) {
    if (vc === VC.PAN || vc === VC.PANL || vc === VC.PANR) return 'pan';
    if (vc >= VC.PORTADN && vc !== VC.PAN) return 'pitch';
    return 'volume';
  }

  return { FX, VC, NOTE_FADE, NOTE_CUT, NOTE_OFF, CELL, load, noteText, noteName, volText, fxText, fxClass, volClass, HEX };
})();

if (typeof module !== 'undefined') module.exports = Tracker;
