'use strict';
// Sample extraction from tracker modules (.xm, .s3m, .it, .mod) and audio files (.wav, ...).
// Every parser returns { type, title, samples: [sample...] } with samples shaped like newSample().

const ModLoader = {
  // Detects the format of an ArrayBuffer/filename and parses it.
  async load(file, audioCtx) {
    const buf = await file.arrayBuffer();
    const name = file.name || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const u8 = new Uint8Array(buf);
    const tag = (o, n) => String.fromCharCode.apply(null, u8.subarray(o, o + n));
    let res = null;
    if (tag(0, 17) === 'Extended Module: ') res = this.parseXM(buf);
    else if (tag(0x2C, 4) === 'SCRM') res = this.parseS3M(buf);
    else if (tag(0, 4) === 'IMPM') res = this.parseIT(buf);
    else if (buf.byteLength > 1084 && /^(M\.K\.|M!K!|FLT[48]|[2-9]CHN|[1-3][0-9]CH|OCTA|CD81)$/.test(tag(1080, 4))) res = this.parseMOD(buf);
    else if (ext === 'xm' || ext === 's3m' || ext === 'it' || ext === 'mod') throw new Error('Unrecognised module format');
    else res = await this.parseAudio(buf, name, audioCtx);
    return res;
  },

  text(u8, o, n) {
    let s = '';
    for (let i = 0; i < n && o + i < u8.length; i++) {
      const c = u8[o + i];
      if (c === 0) break;
      s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
    }
    return s.trim();
  },

  make(name, data, rate, vol, loopType, ls, le, srcIndex) {
    const s = newSample(name);
    s.data = data; s.rate = Math.max(1000, Math.min(192000, rate)); s.vol = Math.max(0, Math.min(64, vol));
    le = Math.min(le, data.length);
    if (loopType && le - ls >= 2) { s.loopType = loopType; s.loopStart = ls; s.loopEnd = le; }
    s.src = srcIndex;
    return s;
  },

  // ---- FastTracker 2 ----
  parseXM(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const title = this.text(u8, 17, 20);
    const hdrSize = dv.getUint32(60, true);
    const npat = dv.getUint16(70, true), nins = dv.getUint16(72, true);
    let o = 60 + hdrSize;
    for (let p = 0; p < npat; p++) {
      const hl = dv.getUint32(o, true), packed = dv.getUint16(o + 7, true);
      o += hl + packed;
    }
    const out = []; let n = 0;
    for (let i = 0; i < nins; i++) {
      if (o + 29 > buf.byteLength) break;
      const isz = dv.getUint32(o, true), iname = this.text(u8, o + 4, 22);
      const ns = dv.getUint16(o + 27, true);
      const shs = ns > 0 ? dv.getUint32(o + 29, true) : 40;
      let so = o + isz;
      const heads = [];
      for (let k = 0; k < ns; k++) {
        const h = so + k * shs;
        if (h + 40 > buf.byteLength) break;
        heads.push({
          len: dv.getUint32(h, true), ls: dv.getUint32(h + 4, true), ll: dv.getUint32(h + 8, true),
          vol: dv.getUint8(h + 12), fine: dv.getInt8(h + 13), type: dv.getUint8(h + 14),
          rel: dv.getInt8(h + 16), name: this.text(u8, h + 18, 22)
        });
      }
      let d = so + ns * shs;
      for (const h of heads) {
        const is16 = (h.type & 0x10) !== 0, frames = is16 ? h.len >> 1 : h.len;
        if (d + h.len > buf.byteLength) { d = buf.byteLength; }
        const data = new Float32Array(Math.max(0, Math.min(frames, (buf.byteLength - d) >> (is16 ? 1 : 0))));
        let acc = 0;
        for (let k = 0; k < data.length; k++) {
          if (is16) { acc = (acc + dv.getInt16(d + k * 2, true)) << 16 >> 16; data[k] = acc / 32768; }
          else { acc = (acc + dv.getInt8(d + k)) << 24 >> 24; data[k] = acc / 128; }
        }
        d += h.len;
        n++;
        if (!data.length) continue;
        const sh = is16 ? 1 : 0;
        const rate = 8363 * Math.pow(2, (h.rel + h.fine / 128) / 12);
        const lt = h.type & 3;
        const s = this.make(h.name || iname, data, rate, h.vol, lt === 3 ? 2 : lt, h.ls >> sh, (h.ls + h.ll) >> sh, n);
        s.bits = is16 ? 16 : 8;
        out.push(s);
      }
      o = d;
    }
    return { type: 'XM', title, samples: out };
  },

  // ---- Scream Tracker 3 ----
  parseS3M(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const title = this.text(u8, 0, 28);
    const ordNum = dv.getUint16(0x20, true), insNum = dv.getUint16(0x22, true);
    const ffi = dv.getUint16(0x2A, true);
    const signed = ffi === 1;
    const out = [];
    for (let i = 0; i < insNum; i++) {
      const po = dv.getUint16(0x60 + ordNum + i * 2, true) * 16;
      if (!po || po + 80 > buf.byteLength) continue;
      if (dv.getUint8(po) !== 1) continue;                      // only PCM samples
      const seg = ((dv.getUint8(po + 13) << 16) | dv.getUint16(po + 14, true)) * 16;
      const len = dv.getUint32(po + 16, true), ls = dv.getUint32(po + 20, true), le = dv.getUint32(po + 24, true);
      const vol = dv.getUint8(po + 28), flags = dv.getUint8(po + 31);
      const c2 = dv.getUint32(po + 32, true) || 8363;
      const is16 = (flags & 4) !== 0;
      const avail = Math.max(0, (buf.byteLength - seg) >> (is16 ? 1 : 0));
      const frames = Math.min(len, avail);
      if (!frames) continue;
      const data = new Float32Array(frames);
      for (let k = 0; k < frames; k++) {
        if (is16) { const v = dv.getUint16(seg + k * 2, true); data[k] = (signed ? (v << 16 >> 16) : v - 32768) / 32768; }
        else { const v = u8[seg + k]; data[k] = (signed ? (v << 24 >> 24) : v - 128) / 128; }
      }
      const s = this.make(this.text(u8, po + 48, 28), data, c2, vol, (flags & 1) ? 1 : 0, ls, le, i + 1);
      s.bits = is16 ? 16 : 8;
      out.push(s);
    }
    return { type: 'S3M', title, samples: out };
  },

  // ---- Impulse Tracker ----
  itDecompress(u8, off, len, is16, it215) {
    const out = new Float32Array(len);
    let o = off, done = 0;
    const blockMax = is16 ? 0x4000 : 0x8000;
    while (done < len && o + 2 <= u8.length) {
      const blen = u8[o] | (u8[o + 1] << 8); o += 2;
      const end = Math.min(u8.length, o + blen);
      let bitPos = 0;
      const readBits = n => {
        let v = 0;
        for (let i = 0; i < n; i++) {
          const byte = o + (bitPos >> 3);
          if (byte >= end) return v;
          v |= ((u8[byte] >> (bitPos & 7)) & 1) << i;
          bitPos++;
        }
        return v;
      };
      let width = is16 ? 17 : 9, d1 = 0, d2 = 0;
      const cnt = Math.min(blockMax, len - done);
      let k = 0;
      while (k < cnt) {
        if (o + (bitPos >> 3) >= end) break;
        let v = readBits(width);
        if (width < 7) {
          if (v === (1 << (width - 1))) { const nw = readBits(is16 ? 4 : 3) + 1; width = nw < width ? nw : nw + 1; continue; }
        } else if (width < (is16 ? 17 : 9)) {
          const border = (is16 ? (0xFFFF >> (17 - width)) - 8 : (0xFF >> (9 - width)) - 4);
          const span = is16 ? 16 : 8;
          if (v > border && v <= border + span) { v -= border; width = v < width ? v : v + 1; continue; }
        } else {
          if (v & (is16 ? 0x10000 : 0x100)) { width = (v + 1) & 0xFF; continue; }
        }
        let sv;
        if (is16) {
          if (width < 16) { const sh = 16 - width; sv = ((v << sh) << 16 >> 16) >> sh; } else sv = v << 16 >> 16;
        } else {
          if (width < 8) { const sh = 8 - width; sv = ((v << sh) << 24 >> 24) >> sh; } else sv = v << 24 >> 24;
        }
        d1 += sv; d2 += d1;
        const r = it215 ? d2 : d1;
        out[done + k] = is16 ? ((r << 16) >> 16) / 32768 : ((r << 24) >> 24) / 128;
        k++;
      }
      done += cnt;
      o = end;
    }
    return out;
  },

  parseIT(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const title = this.text(u8, 4, 26);
    const ordNum = dv.getUint16(0x20, true), insNum = dv.getUint16(0x22, true), smpNum = dv.getUint16(0x24, true);
    const cmwt = dv.getUint16(0x2A, true);
    const tbl = 0xC0 + ordNum + insNum * 4;
    const out = [];
    for (let i = 0; i < smpNum; i++) {
      const h = dv.getUint32(tbl + i * 4, true);
      if (!h || h + 0x50 > buf.byteLength) continue;
      if (String.fromCharCode(u8[h], u8[h + 1], u8[h + 2], u8[h + 3]) !== 'IMPS') continue;
      const flg = dv.getUint8(h + 0x12), vol = dv.getUint8(h + 0x13), cvt = dv.getUint8(h + 0x2E);
      const len = dv.getUint32(h + 0x30, true), lb = dv.getUint32(h + 0x34, true), le = dv.getUint32(h + 0x38, true);
      const c5 = dv.getUint32(h + 0x3C, true) || 8363, sp = dv.getUint32(h + 0x48, true);
      if (!(flg & 1) || !len || sp >= buf.byteLength) continue;
      const is16 = (flg & 2) !== 0, signed = (cvt & 1) !== 0;
      let data;
      if (flg & 8) data = this.itDecompress(u8, sp, len, is16, cmwt >= 0x215);
      else {
        const frames = Math.min(len, (buf.byteLength - sp) >> (is16 ? 1 : 0));
        data = new Float32Array(frames);
        for (let k = 0; k < frames; k++) {
          if (is16) { const v = dv.getUint16(sp + k * 2, true); data[k] = (signed ? (v << 16 >> 16) : v - 32768) / 32768; }
          else { const v = u8[sp + k]; data[k] = (signed ? (v << 24 >> 24) : v - 128) / 128; }
        }
      }
      const lt = (flg & 0x10) ? ((flg & 0x40) ? 2 : 1) : 0;
      const s = this.make(this.text(u8, h + 0x14, 26), data, c5, vol, lt, lb, le, i + 1);
      s.bits = is16 ? 16 : 8;
      out.push(s);
    }
    return { type: 'IT', title, samples: out };
  },

  // ---- ProTracker MOD ----
  parseMOD(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const sig = String.fromCharCode.apply(null, u8.subarray(1080, 1084));
    let nch = 4;
    if (/^\dCHN$/.test(sig)) nch = Number(sig[0]);
    else if (/^\d\dCH$/.test(sig)) nch = Number(sig.slice(0, 2));
    else if (sig === 'FLT8' || sig === 'OCTA' || sig === 'CD81') nch = 8;
    let maxPat = 0;
    for (let i = 0; i < 128; i++) maxPat = Math.max(maxPat, u8[952 + i]);
    let d = 1084 + (maxPat + 1) * 64 * 4 * nch;
    const out = [];
    for (let i = 0; i < 31; i++) {
      const h = 20 + i * 30;
      const len = dv.getUint16(h + 22, false) * 2;   // big endian
      let ft = u8[h + 24] & 15; if (ft > 7) ft -= 16;
      const vol = u8[h + 25], ls = dv.getUint16(h + 26, false) * 2, ll = dv.getUint16(h + 28, false) * 2;
      const frames = Math.max(0, Math.min(len, buf.byteLength - d));
      if (frames > 2) {
        const data = new Float32Array(frames);
        for (let k = 0; k < frames; k++) data[k] = dv.getInt8(d + k) / 128;
        const s = this.make(this.text(u8, h, 22), data, 8363 * Math.pow(2, ft / 96), vol, ll > 2 ? 1 : 0, ls, ls + ll, i + 1);
        s.bits = 8;
        out.push(s);
      }
      d += len;
    }
    return { type: 'MOD', title: this.text(u8, 0, 20), samples: out };
  },

  // ---- generic audio file (wav/ogg/mp3/flac...) decoded by the browser ----
  async parseAudio(buf, name, ctx) {
    if (!ctx) throw new Error('Audio not ready');
    const ab = await ctx.decodeAudioData(buf.slice(0));
    const n = ab.length, data = new Float32Array(n);
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const ch = ab.getChannelData(c);
      for (let i = 0; i < n; i++) data[i] += ch[i] / ab.numberOfChannels;
    }
    const s = this.make(name.replace(/\.[^.]+$/, '').slice(0, 22), data, ab.sampleRate, 64, 0, 0, 0, 1);
    s.bits = 16;
    return { type: 'AUDIO', title: name, samples: [s] };
  }
};

if (typeof module !== 'undefined') module.exports = { ModLoader };
