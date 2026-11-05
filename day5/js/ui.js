'use strict';

// View components: sliders, LCD display, pattern view, channel strips, sample grid, EQ curve.
const UI = (() => {
  const T = Tracker;
  const DPR = () => window.devicePixelRatio || 1;
  const MONO = 'Consolas, "Lucida Console", "Courier New", monospace';

  // sizes the backing store for the device pixel ratio; the CSS size is set only when asked
  function fitCanvas(canvas, w, h, setStyle) {
    const dpr = DPR();
    const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    if (setStyle) {
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ------------------------------------------------------------ slider

  class Slider {
    constructor(el, o) {
      this.el = el;
      this.min = o.min ?? 0;
      this.max = o.max ?? 1;
      this.step = o.step ?? 0;
      this.def = o.def ?? o.value ?? this.min;
      this.vertical = el.classList.contains('v');
      this.onInput = o.onInput || (() => {});
      this.onChange = o.onChange || (() => {});
      this.dragging = false;
      el.tabIndex = 0;
      el.innerHTML = '<div class="track"><div class="fill"></div></div><div class="thumb"></div>';
      this.fill = el.querySelector('.fill');
      this.thumb = el.querySelector('.thumb');
      this.center = o.center ?? false;
      this.set(o.value ?? this.min);

      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        this.dragging = true;
        this.fromEvent(e);
      });
      el.addEventListener('pointermove', (e) => { if (this.dragging) this.fromEvent(e); });
      const end = () => {
        if (!this.dragging) return;
        this.dragging = false;
        this.onChange(this.value);
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('dblclick', () => this.input(this.def, true));
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.input(this.value + (e.deltaY < 0 ? 1 : -1) * (this.step || (this.max - this.min) / 50), true);
      }, { passive: false });
      el.addEventListener('keydown', (e) => {
        const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        this.input(this.value + d * (this.step || (this.max - this.min) / 50), true);
      });
    }

    fromEvent(e) {
      const r = this.el.getBoundingClientRect();
      const f = this.vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      this.input(this.min + Math.max(0, Math.min(1, f)) * (this.max - this.min), false);
    }

    input(v, commit) {
      this.set(v);
      this.onInput(this.value);
      if (commit) this.onChange(this.value);
    }

    set(v) {
      if (this.step) v = Math.round(v / this.step) * this.step;
      v = Math.max(this.min, Math.min(this.max, v));
      this.value = v;
      const f = (v - this.min) / (this.max - this.min || 1);
      if (this.vertical) {
        this.thumb.style.top = (1 - f) * 100 + '%';
        if (this.center) {
          const a = Math.min(f, 0.5), b = Math.max(f, 0.5);
          this.fill.style.top = (1 - b) * 100 + '%';
          this.fill.style.bottom = a * 100 + '%';
        } else {
          this.fill.style.top = (1 - f) * 100 + '%';
          this.fill.style.bottom = '0';
        }
        this.fill.style.background = f >= 0.5 ? 'linear-gradient(0deg, #2a7a3e, #ffd23c)' : 'linear-gradient(0deg, #4fc3ff, #1d4f7a)';
      } else {
        this.thumb.style.left = f * 100 + '%';
        this.fill.style.width = f * 100 + '%';
      }
    }
  }

  // ------------------------------------------------------------ LCD

  const SEG_DIGITS = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
  const LCD_ON = '#3cff7a', LCD_GHOST = 'rgba(60, 255, 122, 0.07)', LCD_MID = '#29b356', LCD_LABEL = '#1f8a43';

  function segPath(ctx, x, y, len, t, vertical) {
    const h = t / 2;
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(x, y); ctx.lineTo(x + h, y + h); ctx.lineTo(x + h, y + len - h);
      ctx.lineTo(x, y + len); ctx.lineTo(x - h, y + len - h); ctx.lineTo(x - h, y + h);
    } else {
      ctx.moveTo(x, y); ctx.lineTo(x + h, y - h); ctx.lineTo(x + len - h, y - h);
      ctx.lineTo(x + len, y); ctx.lineTo(x + len - h, y + h); ctx.lineTo(x + h, y + h);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawDigit(ctx, x, y, w, h, bits) {
    const t = 3.2, g = 1;
    const segs = [
      [x + g, y, w - 2 * g, false], [x + w, y + g, h / 2 - 2 * g, true], [x + w, y + h / 2 + g, h / 2 - 2 * g, true],
      [x + g, y + h, w - 2 * g, false], [x, y + h / 2 + g, h / 2 - 2 * g, true], [x, y + g, h / 2 - 2 * g, true],
      [x + g, y + h / 2, w - 2 * g, false],
    ];
    segs.forEach((s, i) => {
      const on = bits & (1 << i);
      ctx.fillStyle = on ? LCD_ON : LCD_GHOST;
      ctx.shadowBlur = on ? 6 : 0;
      segPath(ctx, s[0], s[1], s[2], t, s[3]);
    });
    ctx.shadowBlur = 0;
  }

  class Lcd {
    constructor(canvas) {
      this.canvas = canvas;
      this.scopeMode = 0;
      this.showRemaining = false;
      this.scroll = 0;
      this.peaks = new Float32Array(20);
      canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        if (x < 150 && y < 40) this.showRemaining = !this.showRemaining;
        else if (x < 150) this.scopeMode = 1 - this.scopeMode;
        if (this.onToggle) this.onToggle();
      });
    }

    draw(s) {
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      const ctx = fitCanvas(this.canvas, w, h);
      ctx.fillStyle = '#060a07';
      ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = 'rgba(60, 255, 122, 0.8)';

      // status icon
      ctx.fillStyle = s.state === 'play' ? LCD_ON : LCD_MID;
      if (s.state === 'play') {
        ctx.beginPath(); ctx.moveTo(9, 9); ctx.lineTo(17, 14); ctx.lineTo(9, 19); ctx.fill();
      } else if (s.state === 'pause') {
        ctx.fillRect(9, 9, 3, 10); ctx.fillRect(14, 9, 3, 10);
      } else ctx.fillRect(9, 10, 8, 8);

      // time
      const t = this.showRemaining && s.duration ? Math.max(0, s.duration - s.time) : s.time;
      const secs = Math.floor(t), m = Math.min(99, Math.floor(secs / 60)), sec = secs % 60;
      const dx = 34, dw = 15, dh = 26, sp = 22;
      if (this.showRemaining) { ctx.fillStyle = LCD_ON; ctx.fillRect(dx - 10, 6 + dh / 2 - 1, 6, 3); }
      drawDigit(ctx, dx, 6, dw, dh, m >= 10 ? SEG_DIGITS[Math.floor(m / 10)] : 0);
      drawDigit(ctx, dx + sp, 6, dw, dh, SEG_DIGITS[m % 10]);
      ctx.fillStyle = LCD_ON;
      ctx.shadowBlur = 6;
      ctx.fillRect(dx + 2 * sp - 2, 12, 3, 3);
      ctx.fillRect(dx + 2 * sp - 2, 22, 3, 3);
      ctx.shadowBlur = 0;
      drawDigit(ctx, dx + 2 * sp + 6, 6, dw, dh, SEG_DIGITS[Math.floor(sec / 10)]);
      drawDigit(ctx, dx + 3 * sp + 6, 6, dw, dh, SEG_DIGITS[sec % 10]);

      // oscilloscope / spectrum
      const sx = 8, sy = 44, sw = 138, sh = 60;
      ctx.strokeStyle = '#123d20';
      ctx.strokeRect(sx - 0.5, sy - 0.5, sw + 1, sh + 1);
      ctx.fillStyle = '#123d20';
      for (let i = 1; i < 4; i++) ctx.fillRect(sx, sy + i * sh / 4, sw, 1);
      if (this.scopeMode === 0) this.drawScope(ctx, s.wave, sx, sy, sw, sh);
      else this.drawSpectrum(ctx, s.freq, sx, sy, sw, sh);
      ctx.fillStyle = LCD_LABEL;
      ctx.font = `8px ${MONO}`;
      ctx.fillText(this.scopeMode ? 'SPECTRUM' : 'SCOPE', sx + 2, sy + 9);

      // marquee
      const rx = 158, rw = w - rx - 8;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, 4, rw, 18);
      ctx.clip();
      ctx.font = `bold 13px ${MONO}`;
      ctx.fillStyle = LCD_ON;
      ctx.shadowBlur = 5;
      const text = s.title;
      const tw = ctx.measureText(text).width;
      if (tw <= rw) {
        ctx.fillText(text, rx, 18);
      } else {
        const gap = '   ***   ', full = ctx.measureText(text + gap).width;
        this.scroll = (this.scroll + 0.5) % full;
        ctx.fillText(text + gap + text, rx - this.scroll, 18);
      }
      ctx.restore();

      // info boxes
      ctx.font = `bold 10px ${MONO}`;
      let bx = rx;
      const box = (label, on = true) => {
        const bw = ctx.measureText(label).width + 8;
        ctx.strokeStyle = on ? LCD_MID : '#163d22';
        ctx.strokeRect(bx + 0.5, 28.5, bw, 13);
        ctx.fillStyle = on ? LCD_ON : '#1c5530';
        ctx.fillText(label, bx + 4, 39);
        bx += bw + 5;
      };
      box(s.format || '---');
      box((s.channels ? String(s.channels).padStart(2, '0') : '--') + ' CH');
      box(Math.round(s.rate / 1000) + ' KHZ');
      box(s.linear ? 'LINEAR' : 'AMIGA', !!s.format);
      box('STEREO', s.separation > 0);

      const row = (y, parts) => {
        let x = rx;
        for (const [label, value] of parts) {
          ctx.font = `9px ${MONO}`;
          ctx.fillStyle = LCD_LABEL;
          ctx.fillText(label, x, y);
          x += ctx.measureText(label).width + 4;
          ctx.font = `bold 12px ${MONO}`;
          ctx.fillStyle = LCD_ON;
          ctx.shadowBlur = 4;
          ctx.fillText(value, x, y);
          ctx.shadowBlur = 0;
          x += ctx.measureText(value).width + 12;
        }
      };
      const d2 = (v) => (v < 0 ? '--' : String(v).padStart(2, '0'));
      row(62, [['ORD', `${d2(s.order)}/${d2(s.orders - 1)}`], ['PAT', d2(s.pattern)], ['ROW', `${d2(s.row)}/${d2(s.rows - 1)}`]]);
      row(80, [['SPD', d2(s.speed)], ['BPM', String(s.tempo || 0).padStart(3, '0')], ['VOICES', d2(s.voices)]]);
      ctx.font = `9px ${MONO}`;
      ctx.fillStyle = LCD_LABEL;
      const tail = s.duration ? `LENGTH ${fmtTime(s.duration)}` : '';
      ctx.fillText(tail + (s.tracker ? (tail ? '  ·  ' : '') + s.tracker.toUpperCase() : ''), rx, 102);

      // dot matrix overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 0.6);
    }

    drawScope(ctx, wave, x, y, w, h) {
      if (!wave) return;
      const n = wave.length, mid = y + h / 2;
      ctx.fillStyle = LCD_ON;
      ctx.shadowBlur = 4;
      let prev = mid;
      for (let i = 0; i < w; i++) {
        const v = wave[Math.floor(i * n / w)];
        const yy = Math.max(y, Math.min(y + h - 1, mid - v * h * 0.48));
        const top = Math.min(prev, yy), len = Math.max(1, Math.abs(prev - yy));
        ctx.fillStyle = Math.abs(v) > 0.7 ? '#ffd23c' : LCD_ON;
        ctx.fillRect(x + i, top, 1, len);
        prev = yy;
      }
      ctx.shadowBlur = 0;
    }

    drawSpectrum(ctx, freq, x, y, w, h) {
      if (!freq) return;
      const bars = this.peaks.length, bw = w / bars, n = freq.length;
      for (let b = 0; b < bars; b++) {
        const lo = Math.floor(Math.pow(n, b / bars)), hi = Math.max(lo + 1, Math.floor(Math.pow(n, (b + 1) / bars)));
        let v = 0;
        for (let i = lo; i < hi && i < n; i++) v = Math.max(v, freq[i]);
        v /= 255;
        this.peaks[b] = Math.max(v, this.peaks[b] - 0.012);
        const bh = v * h;
        const g = ctx.createLinearGradient(0, y + h, 0, y);
        g.addColorStop(0, '#1fbf55'); g.addColorStop(0.6, '#3cff7a'); g.addColorStop(0.85, '#ffd23c'); g.addColorStop(1, '#ff5d6c');
        ctx.fillStyle = g;
        ctx.fillRect(x + b * bw + 1, y + h - bh, bw - 2, bh);
        ctx.fillStyle = '#d0ffe0';
        ctx.fillRect(x + b * bw + 1, y + h - this.peaks[b] * h - 1, bw - 2, 1);
      }
    }
  }

  // ------------------------------------------------------------ pattern view

  const COLORS = {
    note: '#e8eefc', off: '#ff8a96', ins: '#ffcc55', volume: '#6be675', pitch: '#4fc3ff',
    pan: '#ffa04d', global: '#ff5d6c', misc: '#d58bff', empty: '#262d3a', rownum: '#56627a', rownumHi: '#9aa7c0',
  };

  class PatternView {
    constructor(scroll, canvas, spacer) {
      this.scroll = scroll;
      this.canvas = canvas;
      this.spacer = spacer;
      this.song = null;
      this.order = -1;
      this.row = -1;
      this.mute = null;
      this.solo = null;
      this.fontSize = 12;
      this.lineH = 15;
      this.dirty = true;
      const ctx = canvas.getContext('2d');
      ctx.font = `${this.fontSize}px ${MONO}`;
      this.cw = Math.ceil(ctx.measureText('0000000000').width) / 10;
      this.numW = 4 * this.cw;
      this.colW = 16 * this.cw;
      // M and S buttons at the right end of each channel header (offsets inside the column)
      this.btnW = Math.round(2.4 * this.cw);
      this.soloX = this.colW - 3 - this.btnW;
      this.muteX = this.soloX - 2 - this.btnW;
      scroll.addEventListener('scroll', () => { this.dirty = true; });
      canvas.addEventListener('click', (e) => {
        const hit = this.headerHit(e);
        if (!hit || !this.onHeader) return;
        // the buttons choose mute or solo; elsewhere on the header: click = mute, shift+click = solo
        const kind = hit.button || (e.shiftKey ? 'solo' : 'mute');
        this.onHeader(hit.c, kind);
      });
      canvas.addEventListener('mousemove', (e) => {
        const hit = this.headerHit(e);
        canvas.style.cursor = hit ? 'pointer' : '';
        canvas.title = !hit ? '' : hit.button === 'mute' ? 'Mute channel' : hit.button === 'solo' ? 'Solo channel'
          : 'Click: mute, Shift+click: solo';
      });
    }

    headerHit(e) {
      const r = this.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (!this.song || y > this.lineH + 4 || x < this.numW) return null;
      const px = x - this.numW + this.scroll.scrollLeft, c = Math.floor(px / this.colW), cx = px - c * this.colW;
      if (c >= this.song.channels) return null;
      const button = cx >= this.soloX && cx < this.soloX + this.btnW ? 'solo'
        : cx >= this.muteX && cx < this.muteX + this.btnW ? 'mute' : null;
      return { c, button };
    }

    setSong(song) {
      this.song = song;
      this.order = this.row = -1;
      this.spacer.style.width = song ? this.numW + song.channels * this.colW + 'px' : '0';
      this.scroll.scrollLeft = 0;
      this.dirty = true;
    }

    setMutes(mute, solo) {
      this.mute = mute;
      this.solo = solo;
      this.dirty = true;
    }

    drawButton(ctx, x, headH, label, on, bg, fg) {
      const y = 3, h = headH - 7, w = this.btnW;
      ctx.fillStyle = on ? bg : '#20252f';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = on ? 'rgba(255,255,255,0.25)' : '#474e5c';
      ctx.fillRect(x, y, w, 1);
      ctx.fillRect(x, y, 1, h);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, y + h - 1, w, 1);
      ctx.fillRect(x + w - 1, y, 1, h);
      ctx.save();
      ctx.font = `bold ${this.fontSize - 2}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = on ? fg : '#8b93a3';
      ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
      ctx.restore();
    }

    update(order, row) {
      if (!this.dirty && order === this.order && row === this.row) return;
      this.order = order;
      this.row = row;
      this.dirty = false;
      this.draw();
    }

    draw() {
      const sc = this.scroll, w = sc.clientWidth, h = sc.clientHeight;
      const ctx = fitCanvas(this.canvas, w, h, true);
      const { cw, lineH, numW, colW } = this;
      const song = this.song;
      ctx.fillStyle = '#06080c';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${this.fontSize}px ${MONO}`;
      ctx.textBaseline = 'middle';
      const headH = lineH + 4;
      if (!song) {
        ctx.fillStyle = COLORS.rownum;
        ctx.fillText('No module loaded — drop a file or press L to open one.', 12, headH + 20);
        return;
      }
      const pat = song.patterns[song.orders[this.order]] || { rows: 64, data: null };
      const nch = song.channels, sx = sc.scrollLeft;
      const vis = Math.floor((h - headH) / lineH), center = Math.floor(vis / 2);
      const first = Math.max(0, Math.floor((sx - colW) / colW)), last = Math.min(nch - 1, Math.ceil((sx + w) / colW));
      const hl = song.rowHighlight || 4;
      const anySolo = this.solo && this.solo.some((v) => v);

      for (let i = 0; i < vis; i++) {
        const r = this.row - center + i, y = headH + i * lineH;
        if (r < 0 || r >= pat.rows) continue;
        if (r === this.row) {
          ctx.fillStyle = '#1d3a63';
          ctx.fillRect(0, y, w, lineH);
          ctx.fillStyle = '#4f86d6';
          ctx.fillRect(0, y, w, 1);
          ctx.fillRect(0, y + lineH - 1, w, 1);
        } else if (r % (hl * 4) === 0) {
          ctx.fillStyle = '#121a27';
          ctx.fillRect(0, y, w, lineH);
        } else if (r % hl === 0) {
          ctx.fillStyle = '#0d121b';
          ctx.fillRect(0, y, w, lineH);
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(numW, 0, w - numW, h);
      ctx.clip();
      for (let c = first; c <= last; c++) {
        const x = numW + c * colW - sx;
        ctx.fillStyle = '#141924';
        ctx.fillRect(x + colW - 1, headH, 1, h - headH);
      }
      const d = pat.data, shift = song.octaveShift, type = song.type;
      for (let i = 0; i < vis; i++) {
        const r = this.row - center + i;
        if (r < 0 || r >= pat.rows) continue;
        const y = headH + i * lineH + lineH / 2 + 1, cur = r === this.row;
        for (let c = first; c <= last; c++) {
          const x = numW + c * colW - sx + cw;
          const o = (r * nch + c) * T.CELL;
          const note = d ? d[o] : 0, ins = d ? d[o + 1] : 0, vc = d ? d[o + 2] : 0, vp = d ? d[o + 3] : 0;
          const fx = d ? d[o + 4] : 0, fp = d ? d[o + 5] : 0;
          ctx.fillStyle = note ? (note > 120 ? COLORS.off : COLORS.note) : COLORS.empty;
          ctx.fillText(T.noteText(note, shift), x, y);
          ctx.fillStyle = ins ? COLORS.ins : COLORS.empty;
          ctx.fillText(ins ? String(ins).padStart(2, '0') : '..', x + 4 * cw, y);
          ctx.fillStyle = vc ? COLORS[T.volClass(vc)] : COLORS.empty;
          ctx.fillText(T.volText(vc, vp), x + 7 * cw, y);
          ctx.fillStyle = fx ? COLORS[T.fxClass(fx, fp)] : COLORS.empty;
          ctx.fillText(T.fxText(type, fx, fp), x + 11 * cw, y);
          if (cur) {
            ctx.fillStyle = 'rgba(255,255,255,0.05)';
            ctx.fillRect(x - cw, y - lineH / 2 - 1, colW - 1, lineH);
          }
        }
      }
      // muted columns
      for (let c = first; c <= last; c++) {
        const off = anySolo ? !this.solo[c] : this.mute && this.mute[c];
        if (!off) continue;
        ctx.fillStyle = 'rgba(6, 8, 12, 0.72)';
        ctx.fillRect(numW + c * colW - sx, headH, colW - 1, h - headH);
      }
      // header
      ctx.fillStyle = '#10141c';
      ctx.fillRect(numW, 0, w - numW, headH);
      for (let c = first; c <= last; c++) {
        const x = numW + c * colW - sx;
        const solo = this.solo && this.solo[c], muted = anySolo ? !solo : this.mute && this.mute[c];
        const g = ctx.createLinearGradient(0, 0, 0, headH);
        g.addColorStop(0, solo ? '#7a6414' : muted ? '#4a1820' : '#353b48');
        g.addColorStop(1, solo ? '#4a3c0a' : muted ? '#2a0e13' : '#1c2028');
        ctx.fillStyle = g;
        ctx.fillRect(x + 1, 1, colW - 3, headH - 3);
        ctx.fillStyle = solo ? '#fff3c4' : muted ? '#ff8a96' : '#c9cfdb';
        ctx.fillText(`CH ${String(c + 1).padStart(2, '0')}`, x + cw, headH / 2);
        this.drawButton(ctx, x + this.muteX, headH, 'M', this.mute && this.mute[c], '#6b1d26', '#ffd0d4');
        this.drawButton(ctx, x + this.soloX, headH, 'S', solo, '#7a6414', '#fff3c4');
      }
      ctx.restore();

      // row numbers
      ctx.fillStyle = '#0b0f16';
      ctx.fillRect(0, 0, numW - 2, h);
      for (let i = 0; i < vis; i++) {
        const r = this.row - center + i;
        if (r < 0 || r >= pat.rows) continue;
        const y = headH + i * lineH + lineH / 2 + 1;
        ctx.fillStyle = r === this.row ? '#fff' : r % hl === 0 ? COLORS.rownumHi : COLORS.rownum;
        ctx.fillText(String(r).padStart(pat.rows > 100 ? 3 : 2, '0'), cw * 0.6, y);
      }
      ctx.fillStyle = '#10141c';
      ctx.fillRect(0, 0, numW - 2, headH);
      // current pattern number (same decimal numbering as the LCD)
      ctx.fillStyle = '#e8c45a';
      ctx.fillText(String(song.orders[this.order] ?? 0).padStart(2, '0'), cw * 0.6, headH / 2);
    }
  }

  // ------------------------------------------------------------ channel strips

  class ChannelsView {
    constructor(el) {
      this.el = el;
      this.items = [];
      el.innerHTML = '<div class="none">No module loaded.</div>';
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button'), card = e.target.closest('.ch');
        if (!card || !this.onToggle) return;
        const i = +card.dataset.i;
        if (b && b.classList.contains('s')) this.onToggle(i, 'solo');
        else if (b && b.classList.contains('m')) this.onToggle(i, 'mute');
      });
    }

    setSong(song) {
      this.el.innerHTML = '';
      this.items = [];
      if (!song) { this.el.innerHTML = '<div class="none">No module loaded.</div>'; return; }
      for (let i = 0; i < song.channels; i++) {
        const div = document.createElement('div');
        div.className = 'ch';
        div.dataset.i = i;
        div.innerHTML = `<div class="ch-top"><span class="ch-num">${String(i + 1).padStart(2, '0')}</span>` +
          '<span class="ch-note">...</span><span class="ch-ins">..</span><span class="spacer"></span>' +
          '<button class="m" title="Mute">M</button><button class="s" title="Solo">S</button></div>' +
          '<div class="ch-vu"><div class="vu-fill"></div><div class="vu-peak"></div></div>';
        this.el.appendChild(div);
        this.items.push({
          div, note: div.querySelector('.ch-note'), ins: div.querySelector('.ch-ins'),
          fill: div.querySelector('.vu-fill'), peakEl: div.querySelector('.vu-peak'),
          level: 0, peak: 0, peakT: 0, noteText: '', insText: '',
        });
      }
    }

    setMutes(mute, solo) {
      const anySolo = solo.some((v) => v);
      this.items.forEach((it, i) => {
        it.div.classList.toggle('muted', !!mute[i]);
        it.div.classList.toggle('soloed', !!solo[i]);
        it.div.classList.toggle('silent', anySolo ? !solo[i] : !!mute[i]);
      });
    }

    update(snap, gain, shift, dt) {
      this.items.forEach((it, i) => {
        const raw = snap ? Math.min(1, Math.sqrt(snap.vu[i] / gain)) : 0;
        it.level = Math.max(raw, it.level - dt * 2.2);
        if (it.level >= it.peak) { it.peak = it.level; it.peakT = 0.6; }
        else if ((it.peakT -= dt) < 0) it.peak = Math.max(0, it.peak - dt * 0.8);
        it.fill.style.clipPath = `inset(0 ${(100 - it.level * 100).toFixed(1)}% 0 0)`;
        it.peakEl.style.left = `calc(${(it.peak * 100).toFixed(1)}% - 2px)`;
        const n = snap && snap.notes[i] >= 0 ? T.noteName(snap.notes[i], shift) : '...';
        const ins = snap && snap.notes[i] >= 0 ? String(snap.ins[i]).padStart(2, '0') : '..';
        if (n !== it.noteText) { it.note.textContent = n; it.noteText = n; }
        if (ins !== it.insText) { it.ins.textContent = ins; it.insText = ins; }
      });
    }
  }

  // ------------------------------------------------------------ sample grid

  class SamplesView {
    constructor(canvas, info) {
      this.canvas = canvas;
      this.info = info;
      this.song = null;
      this.flash = new Float32Array(0);
      this.cellW = 52;
      this.cellH = 26;
      this.hover = -1;
      this.base = null;
      this.width = 0;
      canvas.addEventListener('mousemove', (e) => {
        const i = this.at(e);
        if (i !== this.hover) { this.hover = i; this.showInfo(i); }
      });
      canvas.addEventListener('mouseleave', () => { this.hover = -1; this.showInfo(-1); });
      canvas.addEventListener('click', (e) => {
        const i = this.at(e);
        if (i >= 0 && this.onPick) this.onPick(i);
      });
    }

    at(e) {
      if (!this.song) return -1;
      const r = this.canvas.getBoundingClientRect();
      const c = Math.floor((e.clientX - r.left) / this.cellW), row = Math.floor((e.clientY - r.top) / this.cellH);
      const i = row * this.cols + c;
      return c < this.cols && i < this.song.samples.length ? i : -1;
    }

    showInfo(i) {
      const s = this.song && this.song.samples[i];
      if (!s) {
        this.info.textContent = this.song ? `${this.song.samples.filter((x) => x.length).length} samples` +
          (this.song.useInstruments ? `, ${this.song.instruments.length} instruments` : '') + ' — hover for details, click to listen' : ' ';
        return;
      }
      const loop = s.loopType ? (s.loopType === 2 ? ' · ping-pong loop' : ' · loop') : '';
      const size = s.length ? ` · ${s.length > 9999 ? (s.length / 1024).toFixed(1) + 'k' : s.length} frames · ${s.bits}-bit${s.stereo ? ' stereo' : ''}${loop} · vol ${s.volume} · ${Math.round(s.c5)} Hz` : ' · empty';
      this.info.textContent = `${String(i + 1).padStart(2, '0')} ${s.name || '(no name)'}${size}`;
    }

    setSong(song) {
      this.song = song;
      this.flash = new Float32Array(song ? song.samples.length : 0);
      this.width = 0;
      this.showInfo(-1);
    }

    layout() {
      const w = this.canvas.parentElement.clientWidth - 16;
      if (w === this.width) return;
      this.width = w;
      const n = this.song ? this.song.samples.length : 0;
      this.cols = Math.max(1, Math.floor(w / 52));
      this.cellW = w / this.cols;
      const rows = Math.max(1, Math.ceil(n / this.cols));
      this.height = rows * this.cellH;
      const dpr = DPR();
      const base = document.createElement('canvas');
      base.width = Math.round(w * dpr);
      base.height = Math.round(this.height * dpr);
      const ctx = base.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#050607';
      ctx.fillRect(0, 0, w, this.height);
      ctx.font = `8px ${MONO}`;
      for (let i = 0; i < n; i++) {
        const s = this.song.samples[i], x = (i % this.cols) * this.cellW, y = Math.floor(i / this.cols) * this.cellH;
        const cw = this.cellW - 2, ch = this.cellH - 2;
        ctx.fillStyle = s.length ? '#0b1410' : '#08090b';
        ctx.fillRect(x + 1, y + 1, cw, ch);
        if (s.length) {
          const mid = y + 1 + ch / 2 + 3, amp = (ch - 8) / 2;
          ctx.fillStyle = '#2a9f52';
          const step = s.length / cw;
          for (let px = 0; px < cw; px++) {
            let lo = 0, hi = 0;
            const a = Math.floor(px * step), b = Math.max(a + 1, Math.floor((px + 1) * step));
            for (let k = a; k < b; k += Math.max(1, Math.floor((b - a) / 32))) {
              const v = s.data[k];
              if (v < lo) lo = v;
              if (v > hi) hi = v;
            }
            ctx.fillRect(x + 1 + px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
          }
          if (s.loopType) {
            ctx.fillStyle = 'rgba(255, 204, 85, 0.25)';
            const lx = x + 1 + s.loopStart / s.length * cw, lw = Math.max(1, (s.loopEnd - s.loopStart) / s.length * cw);
            ctx.fillRect(lx, y + ch - 1, lw, 2);
          }
        }
        ctx.fillStyle = s.length ? '#8fa0b8' : '#39404d';
        ctx.fillText(String(i + 1).padStart(2, '0'), x + 3, y + 9);
      }
      this.base = base;
    }

    update(snap, dt) {
      this.layout();
      const w = this.width, h = this.height || this.cellH;
      const ctx = fitCanvas(this.canvas, w, h, true);
      if (!this.song) {
        ctx.fillStyle = '#050607';
        ctx.fillRect(0, 0, w, h);
        return;
      }
      ctx.drawImage(this.base, 0, 0, w, h);
      if (snap) for (const i of snap.playing) if (i < this.flash.length) this.flash[i] = 1;
      for (let i = 0; i < this.flash.length; i++) {
        const f = this.flash[i];
        const x = (i % this.cols) * this.cellW, y = Math.floor(i / this.cols) * this.cellH;
        if (f > 0) {
          ctx.strokeStyle = `rgba(60, 255, 122, ${0.25 + 0.75 * f})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 1.5, y + 1.5, this.cellW - 3, this.cellH - 3);
          ctx.fillStyle = `rgba(60, 255, 122, ${0.12 * f})`;
          ctx.fillRect(x + 1, y + 1, this.cellW - 2, this.cellH - 2);
          this.flash[i] = Math.max(0, f - dt * 3);
        }
        if (i === this.hover) {
          ctx.strokeStyle = '#ffcc55';
          ctx.strokeRect(x + 0.5, y + 0.5, this.cellW - 1, this.cellH - 1);
        }
      }
    }
  }

  // ------------------------------------------------------------ sample browser

  // List of sample names plus a large waveform of the selected one, with loops and live play positions.
  class SampleBrowser {
    constructor(list, wave, canvas, meta) {
      this.list = list;
      this.wave = wave;
      this.canvas = canvas;
      this.meta = meta;
      this.song = null;
      this.rows = [];
      this.sel = -1;
      this.base = null;
      this.baseKey = '';
      this.live = '';
      list.addEventListener('click', (e) => {
        const row = e.target.closest('.smp-row');
        if (row) this.select(+row.dataset.i);
      });
      list.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.smp-row');
        if (row && this.onPlay) this.onPlay(+row.dataset.i);
      });
      canvas.addEventListener('click', () => { if (this.sel >= 0 && this.onPlay) this.onPlay(this.sel); });
      canvas.title = 'Click to listen';
    }

    setSong(song) {
      this.song = song;
      this.list.innerHTML = '';
      this.rows = [];
      this.live = '';
      this.sel = -1;
      this.baseKey = '';
      if (!song) { this.meta.textContent = ''; return; }
      song.samples.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'smp-row' + (s.length ? '' : ' empty');
        row.dataset.i = i;
        row.innerHTML = '<span class="n"></span><span class="name"></span><span class="len"></span>';
        row.children[0].textContent = String(i + 1).padStart(2, '0');
        row.children[1].textContent = s.name || ' ';
        row.children[2].textContent = !s.length ? '—' : s.length > 9999 ? (s.length / 1024).toFixed(1) + 'k' : String(s.length);
        this.list.appendChild(row);
        this.rows.push(row);
      });
      const first = song.samples.findIndex((s) => s.length);
      this.select(first >= 0 ? first : 0);
    }

    select(i) {
      if (!this.song || i < 0 || i >= this.rows.length) return;
      if (this.rows[this.sel]) this.rows[this.sel].classList.remove('sel');
      this.sel = i;
      const row = this.rows[i], l = this.list;
      row.classList.add('sel');
      // keep the row visible without scrolling the page
      if (row.offsetTop < l.scrollTop) l.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = row.offsetTop + row.offsetHeight - l.clientHeight;
      this.baseKey = '';
      this.showMeta();
    }

    move(d) { this.select(Math.max(0, Math.min(this.rows.length - 1, this.sel + d))); }

    showMeta() {
      const song = this.song, s = song.samples[this.sel];
      const parts = [`${String(this.sel + 1).padStart(2, '0')} ${s.name.trim() || '(no name)'}`];
      if (!s.length) parts.push('empty');
      else {
        parts.push(`${s.length} frames`, `${s.bits}-bit${s.stereo ? ' stereo' : ''}`);
        if (s.loopType) parts.push(`${s.loopType === 2 ? 'ping-pong loop' : 'loop'} ${s.loopStart}–${s.loopEnd}`);
        if (s.susType) parts.push(`sustain ${s.susStart}–${s.susEnd}`);
        parts.push(`vol ${s.volume}`, `${Math.round(s.c5)} Hz`);
        if (song.useInstruments) {
          const used = [];
          song.instruments.forEach((ins, k) => { if (ins.sampleMap.includes(this.sel)) used.push(k + 1); });
          if (used.length) parts.push(`instr ${used.slice(0, 8).join(', ')}${used.length > 8 ? '…' : ''}`);
        }
      }
      this.meta.textContent = parts.join(' · ');
    }

    // waveform, loop zones and grid, redrawn only when the sample or the size changes
    drawBase(w, h) {
      const dpr = DPR(), base = document.createElement('canvas');
      base.width = Math.round(w * dpr);
      base.height = Math.round(h * dpr);
      const ctx = base.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#060a07';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0d1a11';
      for (let i = 1; i < 8; i++) ctx.fillRect(Math.round(i * w / 8), 0, 1, h);
      ctx.fillRect(0, Math.round(h / 4), w, 1);
      ctx.fillRect(0, Math.round(h * 3 / 4), w, 1);
      ctx.fillStyle = '#133b20';
      ctx.fillRect(0, Math.round(h / 2), w, 1);
      const s = this.song.samples[this.sel];
      ctx.font = `10px ${MONO}`;
      ctx.textBaseline = 'top';
      if (!s.length) {
        ctx.fillStyle = '#3b6b48';
        ctx.fillText('EMPTY SAMPLE', 8, 8);
        return base;
      }
      const X = (p) => p / s.length * w;
      const zone = (a, b, fill, line, label, y) => {
        const x0 = X(a), x1 = Math.max(x0 + 1, X(b));
        ctx.fillStyle = fill;
        ctx.fillRect(x0, 0, x1 - x0, h);
        ctx.fillStyle = line;
        ctx.fillRect(Math.floor(x0), 0, 1, h);
        ctx.fillRect(Math.min(w - 1, Math.floor(x1)), 0, 1, h);
        ctx.fillText(label, Math.min(x0 + 4, w - 60), y);
      };
      if (s.loopType) zone(s.loopStart, s.loopEnd, 'rgba(255, 204, 85, 0.10)', 'rgba(255, 204, 85, 0.7)', s.loopType === 2 ? 'PING-PONG' : 'LOOP', 4);
      if (s.susType) zone(s.susStart, s.susEnd, 'rgba(79, 195, 255, 0.10)', 'rgba(79, 195, 255, 0.7)', 'SUSTAIN', 16);
      // peak envelope per pixel column (long samples) or a line through the frames (short ones)
      const mid = h / 2, amp = h / 2 - 6, step = s.length / w;
      ctx.fillStyle = '#2a9f52';
      for (let px = 0; step >= 2 && px < w; px++) {
        const a = Math.floor(px * step), b = Math.max(a + 1, Math.floor((px + 1) * step));
        let lo = 1, hi = -1;
        for (let k = a; k < b && k < s.length; k++) {
          const v = s.data[k];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi < lo) continue;
        ctx.fillRect(px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      if (step < 2) {
        ctx.strokeStyle = '#3cff7a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = 0; k < s.length; k++) {
          const x = X(k + 0.5), y = mid - s.data[k] * amp;
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      return base;
    }

    update(snap) {
      if (!this.song || this.sel < 0) return;
      // light the numbers of the samples that are sounding
      const live = snap ? [...snap.playing].sort((a, b) => a - b).join(',') : '';
      if (live !== this.live) {
        const on = new Set(live ? live.split(',').map(Number) : []);
        this.rows.forEach((r, i) => r.classList.toggle('live', on.has(i)));
        this.live = live;
      }
      const w = this.wave.clientWidth, h = this.wave.clientHeight;
      if (!w || !h) return;
      const key = `${this.sel}:${w}x${h}`;
      if (key !== this.baseKey) { this.base = this.drawBase(w, h); this.baseKey = key; }
      const ctx = fitCanvas(this.canvas, w, h);
      ctx.drawImage(this.base, 0, 0, w, h);
      const s = this.song.samples[this.sel];
      if (!snap || !snap.heads || !s.length) return;
      // play positions of the voices using this sample
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#3cff7a';
      ctx.shadowBlur = 6;
      for (let i = 0; i < snap.heads.length; i += 2) {
        if (snap.heads[i] === this.sel) ctx.fillRect(Math.floor(snap.heads[i + 1] / s.length * w), 0, 1, h);
      }
      ctx.shadowBlur = 0;
    }
  }

  // ------------------------------------------------------------ EQ response curve

  function drawEqCurve(canvas, filters, on) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const ctx = fitCanvas(canvas, w, h);
    ctx.fillStyle = '#060a07';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#123d20';
    ctx.fillRect(0, Math.round(h / 2), w, 1);
    const n = Math.max(2, Math.floor(w));
    const freqs = new Float32Array(n), total = new Float32Array(n).fill(0);
    for (let i = 0; i < n; i++) freqs[i] = 20 * Math.pow(1000, i / (n - 1));
    if (filters && on) {
      const mag = new Float32Array(n), ph = new Float32Array(n);
      for (const f of filters) {
        f.getFrequencyResponse(freqs, mag, ph);
        for (let i = 0; i < n; i++) total[i] += 20 * Math.log10(mag[i]);
      }
    }
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const y = h / 2 - Math.max(-15, Math.min(15, total[i])) / 15 * (h / 2 - 2);
      if (i) ctx.lineTo(i * w / (n - 1), y); else ctx.moveTo(0, y);
    }
    ctx.strokeStyle = on ? '#3cff7a' : '#1c5530';
    ctx.shadowColor = 'rgba(60, 255, 122, 0.8)';
    ctx.shadowBlur = on ? 4 : 0;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  return { Slider, Lcd, PatternView, ChannelsView, SamplesView, SampleBrowser, drawEqCurve, fitCanvas, fmtTime };
})();
