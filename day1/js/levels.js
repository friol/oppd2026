// Level layouts: one string per row, one char per brick (default brick size fits a 19-column grid).
// Optional brickW / brickH override the default brick size.
// Lowercase = 1-hit brick, uppercase = 3-hit brick, '.' = empty.
// b=blue g=green y=yellow o=orange r=red p=purple (alien level also: c=cyan m=magenta)
const LEVELS = [
  {
    name: 'CLASSIC',
    brickW: 58,
    brickH: 26,
    rows: [
      'RRRRRRRRRR',
      'oooooooooo',
      'yyyyyyyyyy',
      'gggggggggg',
      'bbbbbbbbbb'
    ]
  },
  {
    name: 'COMMODORE',
    brickW: 58,
    brickH: 26,
    rows: [
      '..bbb.....',
      '.bbbbb....',
      'bbb..b....',
      'bb....oooo',
      'bb........',
      'bb....rrrr',
      'bbb..b....',
      '.bbbbb....',
      '..bbb.....',
    ]
  },
  {
    name: 'SEGA',
    brickW: 40,
    brickH: 24,
    rows: [
      'bbb.bbb.bbb.bbb',
      'b...b...b...b.b',
      'bbb.bb..b.b.bbb',
      '..b.b...b.b.b.b',
      'bbb.bbb.bbb.b.b',
      '...............',
      'PPPPPPPPPPPPPPP'
    ]
  },
  {
    // Space Invaders: aliens instead of bricks, no CPU paddle. c=cyan m=magenta
    name: 'INVADERS',
    aliens: true,
    noCpu: true,
    brickW: 64,
    brickH: 44,
    rows: [
      'gggggggg',
      'cccccccc',
      'mmmmmmmm',
      'oooooooo',
      'rrrrrrrr'
    ]
  }
];
