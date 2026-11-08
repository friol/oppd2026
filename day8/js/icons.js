'use strict';

// Pixel-art icons for the equipment, which the spritesheet does not have.
// Each one is drawn on a 16×16 canvas and gets a dark outline automatically.
const Icons = (() => {
  const N = 16;
  const OUTLINE = '#120e18';
  const canvases = {};
  const urls = {};

  function make(draw) {
    const grid = Array.from({ length: N }, () => new Array(N).fill(null));
    const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) grid[y][x] = c; };
    draw(px);
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let c = grid[y][x];
        if (!c) {
          const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx]);
          if (!near) continue;
          c = OUTLINE;
        }
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return cv;
  }

  // blade along the diagonal from the top right corner, hilt at the bottom left
  function sword(len, light, mid, dark, guard, grip) {
    return make((px) => {
      const cx = 13, cy = 2;
      for (let t = 0; t < len; t++) {
        px(cx - t, cy + t, mid);
        px(cx - t + 1, cy + t, light);
        px(cx - t, cy + t + 1, dark);
      }
      px(cx + 1, cy - 1, light);
      const gx = cx - len, gy = cy + len;
      for (let k = -2; k <= 2; k++) px(gx + k, gy + k, guard);
      for (let t = 1; t <= 2; t++) px(gx - t, gy + t, grip);
      px(gx - 3, gy + 3, guard);
    });
  }

  function mace() {
    return make((px) => {
      for (let t = 0; t < 8; t++) px(2 + t, 13 - t, t < 3 ? '#5a3418' : '#8a5a2c');
      for (let y = 2; y <= 8; y++) {
        for (let x = 8; x <= 14; x++) {
          const d = Math.hypot(x - 11, y - 5);
          if (d <= 2.9) px(x, y, d < 1.3 ? '#d8dde8' : (x + y < 16 ? '#a9b1c4' : '#5c6478'));
        }
      }
      for (const [x, y] of [[11, 1], [15, 5], [11, 9], [7, 5], [14, 2], [14, 8], [8, 2]]) px(x, y, '#c9d0dd');
    });
  }

  function axe() {
    return make((px) => {
      for (let t = 0; t < 12; t++) px(2 + t, 14 - t, t < 3 ? '#5a3418' : '#8a5a2c');
      for (let y = 0; y <= 10; y++) {
        for (let x = 4; x <= 15; x++) {
          const d = Math.hypot(x - 9.5, y - 4.5);
          if (d <= 4.6 && x + y < 14 && x + y > 8) px(x, y, d > 3.6 ? '#eef1f6' : (x < 8 ? '#a9b1c4' : '#7b8396'));
        }
      }
    });
  }

  // body armour, one shape recoloured with a pattern per material
  const BODY = [
    '................',
    '...aaa....aaa...',
    '..aaaaa..aaaaa..',
    '.aaaaaaaaaaaaaa.',
    '.aaaaaaaaaaaaaa.',
    '.aa.aaaaaaaa.aa.',
    '.aa.aaaaaaaa.aa.',
    '.aa.aaaaaaaa.aa.',
    '....aaaaaaaa....',
    '....aaaaaaaa....',
    '....aaaaaaaa....',
    '....bbbbbbbb....',
    '....aaaaaaaa....',
    '....aaa..aaa....',
    '................',
    '................',
  ];

  function armour(light, mid, dark, belt, pattern) {
    return make((px) => {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const ch = BODY[y][x];
          if (ch === '.') continue;
          if (ch === 'b') { px(x, y, belt); continue; }
          let c = x < 6 ? light : x > 10 ? dark : mid;
          c = pattern(x, y, c, light, mid, dark) || c;
          px(x, y, c);
        }
      }
    });
  }

  // pixel maps: one character per pixel, '.' is empty
  function sprite(rows, colors) {
    return make((px) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (colors[ch]) px(x, y, colors[ch]); })));
  }

  // the dungeon cat, sitting, with its tail in two positions
  const CAT = [
    '................',
    '................',
    '...k.....k......',
    '...kk...kk......',
    '...kkkkkkk......',
    '...kyykyyk......',
    '...kkkpkkk......',
    '....kkkkk.......',
    '....kkkkk.......',
    '...kkkkkkk......',
    '..kkkhkkkkk.....',
    '..kkhkkkkkk.....',
    '..kkkkkkkkk.....',
    '..kkkkkkkkk.....',
    '..kk.kkk.kk.....',
    '................',
  ];
  const TAILS = [
    [[11, 13], [12, 12], [13, 11], [13, 10], [13, 9], [12, 8]],
    [[11, 13], [12, 13], [13, 13], [14, 12], [14, 11], [15, 10]],
  ];
  function cat(frame) {
    return make((px) => {
      const col = { k: '#2c2638', h: '#4a4360', y: '#f2d04a', p: '#e88aa0' };
      CAT.forEach((r, y) => [...r].forEach((ch, x) => { if (col[ch]) px(x, y, col[ch]); }));
      for (const [x, y] of TAILS[frame]) px(x, y, col.k);
    });
  }

  // a stone well with water, seen from the front
  const WELL = [
    '................',
    '................',
    '................',
    '....gggggggg....',
    '..gggggggggggg..',
    '.ggwwwwwwwwwwgg.',
    '.gwwbwwwwwwbwwg.',
    '.ggwwwwwwwwwwgg.',
    '..gggggggggggg..',
    '.ssssssssssssss.',
    '.sddsssddssssds.',
    '.ssssssssssssss.',
    '.ssddssssddssss.',
    '.ssssssssssssss.',
    '..dddddddddddd..',
    '................',
  ];

  // the hero's face for the HUD: hood in the class colour, mood from the health
  const HOODS = { warrior: ['#e05050', '#a82a30'], rogue: ['#5cbf52', '#2f7a2c'], mage: ['#a860e8', '#6a2aa8'], hero: ['#5a7ae8', '#2c44a8'] };
  function face(cls, mood, poisoned) {
    const [hl, hd] = HOODS[cls] || HOODS.hero;
    const skin = poisoned ? '#a8d888' : '#f2c6a0', cheek = poisoned ? '#7ab060' : '#f0909a';
    return make((px) => {
      for (let y = 1; y <= 14; y++) {
        for (let x = 1; x <= 14; x++) {
          const d = Math.hypot(x - 7.5, y - 7.8);
          if (d > 7) continue;
          px(x, y, d > 5.6 || y < 4 ? (x < 6 ? hl : hd) : skin);
        }
      }
      for (let x = 5; x <= 10; x++) px(x, 2, hl);
      px(4, 9, cheek); px(11, 9, cheek);
      const eye = '#1a1420';
      if (mood === 'dying') {
        px(5, 7, eye); px(6, 7, eye); px(9, 7, eye); px(10, 7, eye);
        px(5, 5, eye); px(6, 6, eye); px(10, 5, eye); px(9, 6, eye);     // worried brows
        px(7, 10, eye); px(8, 10, eye); px(6, 11, eye); px(9, 11, eye); px(7, 12, eye); px(8, 12, eye);
        px(7, 11, '#a02030'); px(8, 11, '#a02030');                      // open mouth
        px(4, 8, '#6ab8ff'); px(4, 9, '#6ab8ff');                        // a tear
      } else {
        px(5, 7, eye); px(6, 7, eye); px(9, 7, eye); px(10, 7, eye);
        px(5, 6, eye); px(10, 6, eye);
        if (mood === 'hurt') {
          for (let x = 6; x <= 9; x++) px(x, 11, eye);                   // flat mouth
          px(5, 5, eye); px(6, 5, eye); px(9, 5, eye); px(10, 5, eye);
          px(12, 5, '#6ab8ff'); px(12, 6, '#6ab8ff');                    // a drop of sweat
        } else if (mood === 'brave') {
          for (let x = 5; x <= 10; x++) px(x, 10, '#ffffff');            // a big grin
          for (let x = 6; x <= 9; x++) px(x, 11, eye);
          px(4, 10, eye); px(11, 10, eye);
        } else {
          px(5, 10, eye); px(10, 10, eye);                               // a smile
          for (let x = 6; x <= 9; x++) px(x, 11, eye);
        }
      }
    });
  }

  const DRAW = {
    cat0: () => cat(0),
    cat1: () => cat(1),
    // the Heart of the Deep: a red crystal heart with a golden setting
    artifact: () => sprite([
      '................',
      '................',
      '...rrr....rrr...',
      '..rRRWr..rRRRr..',
      '.rRRWWRrrRRRRRr.',
      '.rRRWRRRRRRRRRr.',
      '.rRRRRRRRRRRRdr.',
      '.rRRRRRRRRRRRdr.',
      '..rRRRRRRRRRdr..',
      '...rRRRRRRRdr...',
      '....rRRRRRdr....',
      '.....rRRRdr.....',
      '......rRdr......',
      '.....gg.gg......',
      '......ggg.......',
      '................',
    ], { r: '#7a1020', R: '#e8304a', W: '#ffc0c8', d: '#a01830', g: '#f2c14e' }),
    // a nest: a dark mound with pale eggs
    nest: () => sprite([
      '................',
      '................',
      '................',
      '................',
      '......ee........',
      '.....eEEe..e....',
      '...ee.eE..eEe...',
      '..eEEe...eEEEe..',
      '..eEEe.ee.eEe...',
      '.mmeemmeEemmmm..',
      'mmMmmMmmeemMmmm.',
      'mMmmMmmMmmMmmMmm',
      'mmmMmmmmMmmmMmmm',
      '.mmmmmmmmmmmmmm.',
      '..dddddddddddd..',
      '................',
    ], { e: '#c9c0a8', E: '#f2ecd8', m: '#4a3a2c', M: '#6a5440', d: '#2a2018' }),
    // the gong of the arena
    gong: () => sprite([
      '................',
      '.wwwwwwwwwwwwww.',
      '.w............w.',
      '.w....oooo....w.',
      '.w...oGGGGo...w.',
      '.w..oGGYYGGo..w.',
      '.w..oGYGGYGo..w.',
      '.w..oGYGGYGo..w.',
      '.w..oGGYYGGo..w.',
      '.w...oGGGGo...w.',
      '.w....oooo....w.',
      '.w............w.',
      '.w............w.',
      'ww............ww',
      'dd............dd',
      '................',
    ], { w: '#7a5a3a', d: '#4a3422', o: '#a8741e', G: '#f2c14e', Y: '#fff0a0' }),
    pickaxe: () => sprite([
      '................',
      '...ssssss.......',
      '..sSSSSSSss.....',
      '.sS.....ttSs....',
      '.s......ttsSs...',
      '.......tt..sSs..',
      '......tt....sSs.',
      '.....tt......ss.',
      '....tt........s.',
      '...tt...........',
      '..tt............',
      '.tt.............',
      'tt..............',
      '................',
      '................',
      '................',
    ], { s: '#6c7488', S: '#c9d0dd', t: '#8a5a2c' }),
    hourglass: () => sprite([
      '................',
      '...wwwwwwwwww...',
      '....g......g....',
      '....gyyyyyyg....',
      '....g.yyyy.g....',
      '.....g.yy.g.....',
      '......g..g......',
      '.......gg.......',
      '......g..g......',
      '.....g.yy.g.....',
      '....g.yyyy.g....',
      '....gyyyyyyg....',
      '....g......g....',
      '...wwwwwwwwww...',
      '................',
      '................',
    ], { w: '#8a5a2c', g: '#9ad0ff', y: '#f2d04a' }),
    well: () => sprite(WELL, { g: '#8d879c', w: '#3a7ad0', b: '#9ad0ff', s: '#a9a3b8', d: '#6c6680' }),
    dagger: () => sword(5, '#eef1f6', '#b9c0cf', '#6c7488', '#c9a24a', '#6a4422'),
    shortsword: () => sword(7, '#eef1f6', '#b9c0cf', '#6c7488', '#a8741e', '#6a4422'),
    mace,
    axe,
    longsword: () => sword(9, '#ffffff', '#c9d0dd', '#707a90', '#f2c14e', '#3a2a5a'),
    runeblade: () => sword(9, '#d8fbff', '#5fd4ff', '#2a6fb0', '#c99bff', '#2a1a40'),
    leather: () => armour('#b07a44', '#8a5a2c', '#5e3a1a', '#3a2410', () => null),
    studded: () => armour('#b07a44', '#8a5a2c', '#5e3a1a', '#3a2410', (x, y) => ((x + y) % 3 === 0 && y % 2 === 1 ? '#e8c46a' : null)),
    chainmail: () => armour('#b9c0cf', '#8a93a8', '#5c6478', '#5a3418', (x, y, c, l, m, d) => ((x + y) % 2 ? d : null)),
    scale: () => armour('#8fd07a', '#4f9a48', '#2f6a30', '#5a3418', (x, y, c, l, m, d) => ((x + (y % 2)) % 2 === 0 && y % 2 === 0 ? d : null)),
    plate: () => armour('#eef1f6', '#b9c0cf', '#6c7488', '#a8741e', (x, y, c, l, m, d) => (y === 4 || y === 8 ? d : x === 7 || x === 8 ? l : null)),
    dragon: () => armour('#ff7a5a', '#c8323a', '#7a1a2a', '#f2c14e', (x, y) => ((x + (y % 2)) % 2 === 0 && y % 2 === 0 ? '#f2c14e' : null)),
  };

  function get(name) {
    if (!DRAW[name]) return null;
    if (!canvases[name]) canvases[name] = DRAW[name]();
    return canvases[name];
  }

  function url(name) {
    if (!urls[name] && get(name)) urls[name] = get(name).toDataURL();
    return urls[name] || null;
  }

  // faces are made on demand: face_<class>_<mood>[_p]
  function faceUrl(cls, mood, poisoned) {
    const key = 'face_' + cls + '_' + mood + (poisoned ? '_p' : '');
    if (!urls[key]) urls[key] = face(cls, mood, poisoned).toDataURL();
    return urls[key];
  }

  return { get, url, faceUrl, has: (name) => !!DRAW[name] };
})();
