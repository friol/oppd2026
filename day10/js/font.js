'use strict';
// 5x7 bitmap font. Each glyph: 7 rows, 5 bits per row (bit 4 = leftmost pixel), hex encoded.
const Font = (() => {
  const RAW = {
    'A': '0E11111F111111', 'B': '1E11111E11111E', 'C': '0E11101010110E', 'D': '1C12111111121C',
    'E': '1F10101E10101F', 'F': '1F10101E101010', 'G': '0E11101711110F', 'H': '1111111F111111',
    'I': '0E04040404040E', 'J': '0702020202120C', 'K': '11121418141211', 'L': '1010101010101F',
    'M': '111B1515111111', 'N': '11111915131111', 'O': '0E11111111110E', 'P': '1E11111E101010',
    'Q': '0E11111115120D', 'R': '1E11111E141211', 'S': '0F10100E01011E', 'T': '1F040404040404',
    'U': '1111111111110E', 'V': '11111111110A04', 'W': '1111111515150A', 'X': '11110A040A1111',
    'Y': '1111110A040404', 'Z': '1F01020408101F',
    '0': '0E11131519110E', '1': '040C040404040E', '2': '0E11010204081F', '3': '1F02040201110E',
    '4': '02060A121F0202', '5': '1F101E0101110E', '6': '0608101E11110E', '7': '1F010204080808',
    '8': '0E11110E11110E', '9': '0E11110F01020C',
    ' ': '00000000000000', '.': '00000000000C0C', ',': '000000000C0408', ':': '000C0C000C0C00',
    '-': '0000001F000000', '+': '0004041F040400', '!': '04040404040004', '?': '0E110102040004',
    '/': '01010204081010', "'": '04040800000000', '<': '02040810080402', '>': '08040201020408',
    '%': '18190204081303', '(': '02040808080402', ')': '08040202020408', '"': '0A0A0A00000000',
    '=': '00001F001F0000', '$': '040F140E051E04', '*': '0004150E150400', '~': '00000D16000000'
  };
  const GLYPHS = {};
  for (const ch in RAW) {
    const rows = [];
    for (let i = 0; i < 7; i++) rows.push(parseInt(RAW[ch].substr(i * 2, 2), 16));
    GLYPHS[ch] = rows;
  }

  const cache = new Map();

  function build(text, color, shadow, outline) {
    const len = text.length;
    const pad = outline ? 1 : 0;
    const sh = shadow ? 1 : 0;
    const c = document.createElement('canvas');
    c.width = Math.max(1, len * 6 - 1 + pad * 2 + sh);
    c.height = 7 + pad * 2 + sh;
    const g = c.getContext('2d');
    const plot = (ox, oy, col) => {
      for (let i = 0; i < len; i++) {
        const gl = GLYPHS[text[i]] || GLYPHS['?'];
        for (let y = 0; y < 7; y++) {
          const row = gl[y];
          if (!row) continue;
          g.fillStyle = Array.isArray(col) ? col[y] : col;
          for (let x = 0; x < 5; x++) if (row & (16 >> x)) g.fillRect(ox + i * 6 + x, oy + y, 1, 1);
        }
      }
    };
    if (outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) plot(pad + dx, pad + dy, outline);
    }
    if (shadow) plot(pad + 1, pad + 1, shadow);
    plot(pad, pad, color);
    return c;
  }

  function get(text, color, shadow, outline) {
    const key = text + '|' + color + '|' + shadow + '|' + outline;
    let c = cache.get(key);
    if (!c) {
      if (cache.size > 800) cache.clear();
      c = build(text, color, shadow, outline);
      cache.set(key, c);
    }
    return c;
  }

  // o: { color, scale, align: 'left'|'center'|'right', shadow (color|null), outline (color) }
  function draw(g, text, x, y, o = {}) {
    text = String(text).toUpperCase();
    const scale = o.scale || 1;
    const shadow = o.shadow === undefined ? '#000' : o.shadow;
    const c = get(text, o.color || '#fff', shadow, o.outline || null);
    const off = o.outline ? scale : 0;
    const tw = width(text, scale);
    let dx = x - off;
    if (o.align === 'center') dx = x - tw / 2 - off;
    else if (o.align === 'right') dx = x - tw - off;
    g.drawImage(c, Math.round(dx), Math.round(y - off), c.width * scale, c.height * scale);
  }

  function width(text, scale = 1) { return (String(text).length * 6 - 1) * scale; }

  return { draw, width };
})();
