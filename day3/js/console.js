// Retro console text for the panels: a 5x7 dot-matrix font atlas and a buffer of
// fake terminal output, both as textures so the panels can type it in the shader.
const ConsoleText = (() => {
  const COLS = 64;          // characters per line in the buffer
  const LINES = 512;        // lines in the buffer
  const GRID = 8;           // atlas holds ASCII 32..95 in an 8x8 grid
  const DOT = 8;            // atlas pixels per font pixel

  // 5x7 glyphs, 5 columns each, bit 0 is the top row
  const GLYPHS = {
    'A': [0x7C, 0x12, 0x11, 0x12, 0x7C], 'B': [0x7F, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3E, 0x41, 0x41, 0x41, 0x22], 'D': [0x7F, 0x41, 0x41, 0x22, 0x1C],
    'E': [0x7F, 0x49, 0x49, 0x49, 0x41], 'F': [0x7F, 0x09, 0x09, 0x09, 0x01],
    'G': [0x3E, 0x41, 0x49, 0x49, 0x7A], 'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
    'I': [0x00, 0x41, 0x7F, 0x41, 0x00], 'J': [0x20, 0x40, 0x41, 0x3F, 0x01],
    'K': [0x7F, 0x08, 0x14, 0x22, 0x41], 'L': [0x7F, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7F, 0x02, 0x0C, 0x02, 0x7F], 'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
    'O': [0x3E, 0x41, 0x41, 0x41, 0x3E], 'P': [0x7F, 0x09, 0x09, 0x09, 0x06],
    'Q': [0x3E, 0x41, 0x51, 0x21, 0x5E], 'R': [0x7F, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31], 'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
    'U': [0x3F, 0x40, 0x40, 0x40, 0x3F], 'V': [0x1F, 0x20, 0x40, 0x20, 0x1F],
    'W': [0x3F, 0x40, 0x38, 0x40, 0x3F], 'X': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Y': [0x07, 0x08, 0x70, 0x08, 0x07], 'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
    '0': [0x3E, 0x51, 0x49, 0x45, 0x3E], '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46], '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7F, 0x10], '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3C, 0x4A, 0x49, 0x49, 0x30], '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36], '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
    '!': [0x00, 0x00, 0x5F, 0x00, 0x00], '.': [0x00, 0x60, 0x60, 0x00, 0x00],
    ':': [0x00, 0x36, 0x36, 0x00, 0x00], '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '/': [0x20, 0x10, 0x08, 0x04, 0x02], '=': [0x14, 0x14, 0x14, 0x14, 0x14],
    '?': [0x02, 0x01, 0x51, 0x09, 0x06], ',': [0x00, 0x50, 0x30, 0x00, 0x00],
    '(': [0x00, 0x1C, 0x22, 0x41, 0x00], ')': [0x00, 0x41, 0x22, 0x1C, 0x00],
    '<': [0x08, 0x14, 0x22, 0x41, 0x00], '>': [0x00, 0x41, 0x22, 0x14, 0x08],
    '+': [0x08, 0x08, 0x3E, 0x08, 0x08], '_': [0x40, 0x40, 0x40, 0x40, 0x40],
    "'": [0x00, 0x05, 0x03, 0x00, 0x00], ' ': [0, 0, 0, 0, 0],
    '[': [0x00, 0x7F, 0x41, 0x41, 0x00], ']': [0x00, 0x41, 0x41, 0x7F, 0x00],
    '#': [0x14, 0x7F, 0x14, 0x7F, 0x14], '$': [0x24, 0x2A, 0x7F, 0x2A, 0x12],
    '%': [0x23, 0x13, 0x08, 0x64, 0x62], '*': [0x14, 0x08, 0x3E, 0x08, 0x14],
    '"': [0x00, 0x07, 0x00, 0x07, 0x00], '\\': [0x02, 0x04, 0x08, 0x10, 0x20],
    '@': [0x32, 0x49, 0x79, 0x41, 0x3E], '&': [0x36, 0x49, 0x55, 0x22, 0x50],
    ';': [0x00, 0x56, 0x36, 0x00, 0x00], '^': [0x04, 0x02, 0x01, 0x02, 0x04]
  };

  // Each glyph sits in a 6x8 cell; font pixels are drawn as slightly separated dots
  function glyphAtlas(maxAnisotropy) {
    const c = document.createElement('canvas');
    c.width = GRID * 6 * DOT;
    c.height = GRID * 8 * DOT;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    for (let i = 0; i < GRID * GRID; i++) {
      const cols = GLYPHS[String.fromCharCode(32 + i)];
      if (!cols) continue;
      const ox = (i % GRID) * 6 * DOT, oy = Math.floor(i / GRID) * 8 * DOT;
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 7; y++) {
          if (cols[x] & (1 << y)) g.fillRect(ox + x * DOT, oy + y * DOT, DOT - 1, DOT - 1);
        }
      }
    }
    const texture = new THREE.CanvasTexture(c);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = maxAnisotropy;
    return texture;
  }

  const rnd = n => Math.floor(Math.random() * n);
  const pick = a => a[rnd(a.length)];
  const hex = (n, d) => n.toString(16).toUpperCase().padStart(d, '0');
  const ip = () => `${pick([10, 172, 192])}.${rnd(256)}.${rnd(256)}.${rnd(255) + 1}`;

  // Blocks of fake terminal output, each returns a list of lines
  const BLOCKS = [
    () => {
      let t = Math.random() * 2;
      const msgs = ['PCI: PROBING BUS 00', 'MEMORY TEST: 655360 BYTES OK', 'MOUNTING /DEV/HDA1 ON /',
        'CPU0: MICROCODE REVISION 0X2F', 'ETH0: LINK UP, 100 MBPS FULL DUPLEX', 'LOADING MODULE NEURAL_IF',
        'RTC: SYNCHRONIZED WITH NODE 01', 'SCSI0: 3 DEVICES FOUND', 'IRQ 7: HANDLER INSTALLED',
        'VFS: ROOT FILESYSTEM READY', 'SWAP: 65536K ON /DEV/HDA2'];
      return Array.from({ length: 4 + rnd(6) }, () => `[${(t += Math.random()).toFixed(6).padStart(11)}] ${pick(msgs)}`);
    },
    () => {
      let addr = rnd(0xF000);
      return Array.from({ length: 4 + rnd(8) }, () => {
        const bytes = Array.from({ length: 8 }, () => rnd(256));
        const ascii = bytes.map(b => b >= 48 && b < 91 ? String.fromCharCode(b) : '.').join('');
        const line = `${hex(addr, 4)}: ${bytes.map(b => hex(b, 2)).join(' ')}  ${ascii}`;
        addr += 8;
        return line;
      });
    },
    () => {
      const host = ip();
      const out = [`$ PING ${host}`];
      for (let i = 0; i < 3 + rnd(4); i++) out.push(`64 BYTES FROM ${host}: SEQ=${i} TTL=64 TIME=${(Math.random() * 40).toFixed(1)} MS`);
      return out;
    },
    () => {
      const out = ['C:\\> DIR /W'];
      const names = ['KERNEL  SYS', 'ZION    DAT', 'TRACE   EXE', 'AGENT   LOG', 'ORACLE  CFG', 'NEBUCHAD BIN', 'CONSTRCT IMG', 'CONFIG  SYS', 'AUTOEXEC BAT'];
      for (let i = 0; i < 3 + rnd(5); i++) out.push(`${pick(names).padEnd(13)} ${String(rnd(99999)).padStart(6)}  ${String(rnd(12) + 1).padStart(2, '0')}-${String(rnd(28) + 1).padStart(2, '0')}-99`);
      out.push(`  ${rnd(20) + 3} FILE(S)  ${rnd(900000)} BYTES FREE`);
      return out;
    },
    () => {
      const block = hex(rnd(0xFFFFFF), 6);
      const out = [`DECRYPTING BLOCK 0X${block}...`];
      let pct = 0;
      while (pct < 100) {
        pct = Math.min(100, pct + 10 + rnd(30));
        out.push(`  [${'#'.repeat(pct / 5).padEnd(20, '.')}] ${pct}%`);
      }
      out.push(pick(['DONE.', 'CHECKSUM OK.', 'KEY ACCEPTED.']));
      return out;
    },
    () => Array.from({ length: 3 + rnd(4) }, () =>
      `CONNECT ${ip()}:${pick([21, 22, 23, 80, 443, 8080, 31337])} ... ${pick(['OK', 'OK', 'REFUSED', 'TIMEOUT'])}`),
    () => [`$ TRACE --NODE ${rnd(99)}`, `TRACING CALL FROM ${ip()}`, `  HOP ${rnd(9) + 1}: ${ip()}`,
      `  HOP ${rnd(9) + 10}: ${ip()}`, pick(['SIGNAL LOST.', 'TARGET LOCATED.', 'CARRIER DETECTED.'])],
    () => [`> ${pick(['LOGIN: ROOT', 'RUN SIMULATION', 'LOAD "*",8,1', 'SYS 64738', 'CALL -151', 'FORMAT C: /Q'])}`,
      pick(['ACCESS GRANTED', 'ACCESS DENIED', 'READY.', 'SEARCHING FOR *', 'OK', '?SYNTAX ERROR'])],
    () => [pick(['WAKE UP...', 'FOLLOW THE WHITE RABBIT.', 'KNOCK, KNOCK.', 'THE MATRIX HAS YOU.', 'SYSTEM FAILURE'])]
  ];

  function textBuffer() {
    const lines = [];
    while (lines.length < LINES) {
      lines.push(...pick(BLOCKS)(), '');
    }
    // Last column of each row holds the line length, used for the cursor
    const data = new Uint8Array((COLS + 1) * LINES);
    for (let y = 0; y < LINES; y++) {
      const line = lines[y].slice(0, COLS);
      for (let x = 0; x < line.length; x++) {
        const code = line.charCodeAt(x);
        data[y * (COLS + 1) + x] = code >= 32 && code < 96 ? code : 63;
      }
      data[y * (COLS + 1) + COLS] = line.length;
    }
    const texture = new THREE.DataTexture(data, COLS + 1, LINES, THREE.RedFormat, THREE.UnsignedByteType);
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }

  function create(maxAnisotropy) {
    return { glyphs: glyphAtlas(maxAnisotropy), text: textBuffer() };
  }

  return { create, COLS, LINES, GRID };
})();
