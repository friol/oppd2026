'use strict';
// Minimal immediate-mode pixel-art GUI drawn on a low-resolution canvas that is
// scaled up with nearest-neighbour filtering. Widgets register hit regions every
// frame; mouse events are dispatched against the regions of the previous frame.

const COL = {
  bg: '#03101a', panel: '#082230', panel2: '#0b2d3e', edge: '#1b6a86', edgeHi: '#4cc6e4',
  edgeLo: '#041820', text: '#8fe8f5', dim: '#2a6a7c', bright: '#e6fbff', note: '#9ff3ff',
  inst: '#e6fbff', vol: '#6ee0a8', fx: '#ffb86b', hot: '#ff6b7a', ice: '#bfefff',
  bar: '#2ed3e6', barHi: '#ff7a8a', row: '#0d3347', rowBeat: '#0a2a3b', play: '#14566e', cursor: '#4cc6e4'
};

const UI = {
  canvas: null, ctx: null, W: 640, H: 360, S: 2,
  hits: [], pending: [], lock: false, active: null,
  mx: -1, my: -1, down: false,
  repeat: null, focus: null, focusBuf: '', focusCb: null,
  atlas: {}, glyphIdx: null, keys: null, frame: 0,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keys = Object.keys(FONT_GLYPHS);
    this.glyphIdx = {};
    this.keys.forEach((k, i) => { this.glyphIdx[k] = i; });
  },

  // Resize the logical canvas so that W*S x H*S fits the window.
  resize(scale) {
    this.S = scale;
    this.W = Math.max(1, Math.floor(window.innerWidth / scale));
    this.H = Math.max(1, Math.floor(window.innerHeight / scale));
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.canvas.style.width = (this.W * scale) + 'px';
    this.canvas.style.height = (this.H * scale) + 'px';
    this.ctx.imageSmoothingEnabled = false;
  },

  begin() {
    this.hits = this.pending; this.pending = []; this.frame++;
    this.ctx.imageSmoothingEnabled = false;
    // hold-to-repeat for spinner buttons
    const r = this.repeat;
    if (r) {
      if (!this.down) this.repeat = null;
      else {
        const t = performance.now() - r.t0;
        if (t > 400 && performance.now() - r.last > 70) {
          r.last = performance.now();
          r.fn(t > 1800 ? 8 : t > 1000 ? 3 : 1);
        }
      }
    }
  },

  // ---- primitives ----
  rect(x, y, w, h, c) { this.ctx.fillStyle = c; this.ctx.fillRect(x | 0, y | 0, w | 0, h | 0); },

  glyphAtlas(color) {
    let a = this.atlas[color];
    if (a) return a;
    a = document.createElement('canvas');
    a.width = this.keys.length * 6; a.height = 7;
    const g = a.getContext('2d');
    g.fillStyle = color;
    this.keys.forEach((k, i) => {
      const cols = FONT_GLYPHS[k];
      for (let x = 0; x < 5; x++) for (let y = 0; y < 7; y++) if (cols[x] & (1 << y)) g.fillRect(i * 6 + x, y, 1, 1);
    });
    this.atlas[color] = a;
    return a;
  },

  textW(s, sc) { return s.length * 6 * (sc || 1) - (sc || 1); },

  text(s, x, y, color, sc, align) {
    s = String(s).toUpperCase(); sc = sc || 1;
    if (align === 'center') x -= this.textW(s, sc) / 2;
    else if (align === 'right') x -= this.textW(s, sc);
    x = Math.round(x); y = Math.round(y);
    const a = this.glyphAtlas(color), ctx = this.ctx, idx = this.glyphIdx, q = idx['?'];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === ' ') continue;
      const gi = idx[c] === undefined ? q : idx[c];
      ctx.drawImage(a, gi * 6, 0, 6, 7, x + i * 6 * sc, y, 6 * sc, 7 * sc);
    }
  },

  // Beveled pixel panel.
  panel(x, y, w, h, fill) {
    this.rect(x, y, w, h, COL.edgeLo);
    this.rect(x + 1, y + 1, w - 2, h - 2, COL.edge);
    this.rect(x + 2, y + 2, w - 4, h - 4, fill || COL.panel);
    this.rect(x + 1, y + 1, w - 2, 1, COL.edgeHi);
    this.rect(x + 1, y + 1, 1, h - 2, COL.edgeHi);
  },

  inset(x, y, w, h, fill) {
    this.rect(x, y, w, h, COL.edgeHi);
    this.rect(x, y, w - 1, h - 1, COL.edgeLo);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill || '#04141d');
  },

  // Little icicles hanging from a horizontal edge.
  icicles(x, y, w, seed) {
    let s = seed || 7;
    for (let i = 4; i < w - 6; i += 5 + (s % 7)) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const h = 2 + (s >> 8) % 7;
      for (let k = 0; k < h; k++) {
        const hw = Math.max(0, 2 - ((k * 3 / h) | 0));
        this.rect(x + i - hw + 1, y + k, hw * 2 - 1 || 1, 1, k < 2 ? COL.ice : COL.edgeHi);
      }
    }
  },

  // ---- hit regions ----
  hit(x, y, w, h, h2) {
    if (this.lock) return;
    h2.x = x; h2.y = y; h2.w = w; h2.h = h;
    this.pending.push(h2);
  },

  hover(x, y, w, h) {
    return !this.lock && this.mx >= x && this.mx < x + w && this.my >= y && this.my < y + h;
  },

  button(x, y, w, h, label, onDown, opt) {
    opt = opt || {};
    const hov = this.hover(x, y, w, h), prs = this.active && this.active.id === opt.id && opt.id;
    const on = opt.on;
    this.rect(x, y, w, h, COL.edgeLo);
    this.rect(x + 1, y + 1, w - 2, h - 2, on ? '#1b8aa6' : (hov ? '#164b60' : COL.panel2));
    if (!prs && !opt.flat) { this.rect(x + 1, y + 1, w - 2, 1, hov || on ? COL.ice : COL.edgeHi); this.rect(x + 1, y + 1, 1, h - 2, COL.edgeHi); }
    const tc = opt.color || (on ? COL.bright : (hov ? COL.bright : COL.text));
    this.text(label, x + w / 2, y + (h - 7) / 2 + (prs ? 1 : 0), tc, 1, 'center');
    if (onDown) this.hit(x, y, w, h, { onDown, id: opt.id });
  },

  // [-] value [+] spinner. step(dir, mult) is called on press and while held.
  spinner(x, y, label, value, step, vw) {
    vw = vw || 20;
    this.text(label, x, y + 2, COL.dim);
    const lx = x + label.length * 6 + 2;
    const mk = (bx, txt, dir) => {
      this.button(bx, y, 9, 11, txt, e => {
        const m = e && e.shiftKey ? 10 : 1;
        step(dir, m);
        this.repeat = { fn: k => step(dir, k * m), t0: performance.now(), last: performance.now() };
      }, { flat: true });
    };
    mk(lx, '-', -1);
    this.inset(lx + 10, y, vw, 11);
    this.text(value, lx + 10 + vw / 2, y + 2, COL.bright, 1, 'center');
    mk(lx + 10 + vw + 1, '+', 1);
    this.hit(lx, y, vw + 21, 11, { onWheel: dy => step(dy < 0 ? 1 : -1, 1) });
    return lx + vw + 22 - x;
  },

  // Editable single-line text field.
  field(id, x, y, w, value, maxLen, onCommit) {
    const foc = this.focus === id;
    this.inset(x, y, w, 11, foc ? '#0b3a4f' : '#04141d');
    let s = foc ? this.focusBuf : value;
    const maxc = Math.floor((w - 4) / 6);
    let shown = s;
    if (foc) shown = s.length >= maxc ? s.slice(s.length - maxc + 1) : s;
    else shown = s.slice(0, maxc);
    this.text(shown + (foc && (this.frame >> 4) % 2 ? '_' : ''), x + 3, y + 2, foc ? COL.bright : COL.text);
    this.hit(x, y, w, 11, {
      onDown: () => { this.focus = id; this.focusBuf = value; this.focusCb = onCommit; this.focusMax = maxLen; }
    });
  },

  // Keyboard input while a field is focused. Returns true if the event was consumed.
  fieldKey(e) {
    if (!this.focus) return false;
    if (e.key === 'Enter') { const cb = this.focusCb, v = this.focusBuf; this.focus = null; cb && cb(v); }
    else if (e.key === 'Escape') this.focus = null;
    else if (e.key === 'Backspace') this.focusBuf = this.focusBuf.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this.focusBuf.length < this.focusMax) this.focusBuf += e.key;
    else return true;
    e.preventDefault();
    return true;
  },

  blurField() {
    if (this.focus) { const cb = this.focusCb, v = this.focusBuf; this.focus = null; cb && cb(v); }
  },

  // ---- mouse dispatch ----
  mouseDown(x, y, e) {
    this.mx = x; this.my = y; this.down = true;
    const hadFocus = this.focus;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.onDown && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) {
        if (hadFocus && this.focus === hadFocus) this.blurField();
        this.active = h;
        h.onDown(e, x - h.x, y - h.y);
        return;
      }
    }
    this.blurField();
  },

  mouseMove(x, y, e) {
    this.mx = x; this.my = y;
    const a = this.active;
    if (a && a.onDrag) a.onDrag(e, x - a.x, y - a.y);
  },

  mouseUp(x, y, e) {
    this.down = false;
    const a = this.active; this.active = null;
    if (a && a.onUp) a.onUp(e, x - a.x, y - a.y);
  },

  wheel(x, y, dy, e) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.onWheel && x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) { h.onWheel(dy, e); return true; }
    }
    return false;
  }
};
