'use strict';
// Card symbols: one inline SVG per pair (viewBox 0 0 100 100). Each has a
// distinct shape and colour so pairs are easy to tell apart at a glance.

const SYMBOLS = (function () {
  const star = (cx, cy, ro, ri, n) => Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
    return (cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1);
  }).join(' ');

  const LIST = [
    { id: 'star', name: 'Star', color: '#d9a21b',
      svg: '<polygon points="' + star(50, 53, 42, 17, 5) + '" fill="#e8b425" stroke="#9c6f08" stroke-width="3" stroke-linejoin="round"/>' },
    { id: 'waves', name: 'Waves', color: '#1f6fb2',
      svg: [30, 50, 70].map(y => '<path d="M10 ' + y + ' q10 -12 20 0 t20 0 t20 0 t20 0" fill="none" stroke="#1f6fb2" stroke-width="7" stroke-linecap="round"/>').join('') },
    { id: 'moon', name: 'Moon', color: '#5a6b8c',
      svg: '<path d="M62 12 A40 40 0 1 0 88 66 A32 32 0 1 1 62 12 Z" fill="#7a8bb0" stroke="#3d4a66" stroke-width="3"/>' +
        '<circle cx="76" cy="26" r="3" fill="#e8b425"/><circle cx="86" cy="42" r="2" fill="#e8b425"/>' },
    { id: 'sun', name: 'Sun', color: '#e0701b',
      svg: Array.from({ length: 12 }, (_, i) => '<rect x="47" y="4" width="6" height="16" rx="3" fill="#f08a24" transform="rotate(' + i * 30 + ' 50 50)"/>').join('') +
        '<circle cx="50" cy="50" r="24" fill="#f7a92c" stroke="#c8580f" stroke-width="3"/>' },
    { id: 'heart', name: 'Heart', color: '#c4262e',
      svg: '<path d="M50 88 C20 66 8 50 8 32 C8 18 20 10 31 10 C40 10 46 15 50 23 C54 15 60 10 69 10 C80 10 92 18 92 32 C92 50 80 66 50 88 Z" fill="#d6303a" stroke="#8e141b" stroke-width="3"/>' },
    { id: 'diamond', name: 'Diamond', color: '#d6487a',
      svg: '<polygon points="50,6 84,50 50,94 16,50" fill="#e05a8a" stroke="#962a52" stroke-width="3" stroke-linejoin="round"/>' +
        '<polygon points="50,18 72,50 50,82 28,50" fill="#f4a0bf" opacity=".55"/>' },
    { id: 'spade', name: 'Spade', color: '#1b1b1b',
      svg: '<path d="M50 8 C40 26 12 38 12 58 C12 72 24 78 34 76 C40 75 44 71 46 67 C45 78 41 86 34 92 L66 92 C59 86 55 78 54 67 C56 71 60 75 66 76 C76 78 88 72 88 58 C88 38 60 26 50 8 Z" fill="#222"/>' },
    { id: 'club', name: 'Club', color: '#2f7d3a',
      svg: '<circle cx="50" cy="28" r="18" fill="#2f8a3e"/><circle cx="28" cy="56" r="18" fill="#2f8a3e"/><circle cx="72" cy="56" r="18" fill="#2f8a3e"/>' +
        '<path d="M46 50 L54 50 C55 70 60 82 68 92 L32 92 C40 82 45 70 46 50 Z" fill="#1f6a2c"/>' },
    { id: 'horseshoe', name: 'Horseshoe', color: '#6b6f76',
      svg: '<path d="M22 90 L22 50 A28 32 0 0 1 78 50 L78 90 L62 90 L62 52 A12 16 0 0 0 38 52 L38 90 Z" fill="#8a8f98" stroke="#4a4e55" stroke-width="3" stroke-linejoin="round"/>' +
        [[30, 80], [30, 62], [70, 80], [70, 62], [38, 32], [62, 32]].map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="#2a2c30"/>').join('') },
    { id: 'cactus', name: 'Cactus', color: '#3f8f4f',
      svg: '<path d="M42 92 L42 20 A8 8 0 0 1 58 20 L58 92 Z" fill="#4aa35c" stroke="#2a6a36" stroke-width="3"/>' +
        '<path d="M42 62 L28 62 A8 8 0 0 1 20 54 L20 36 A6 6 0 0 1 32 36 L32 50 L42 50" fill="#4aa35c" stroke="#2a6a36" stroke-width="3"/>' +
        '<path d="M58 54 L72 54 A8 8 0 0 0 80 46 L80 30 A6 6 0 0 0 68 30 L68 42 L58 42" fill="#4aa35c" stroke="#2a6a36" stroke-width="3"/>' +
        '<rect x="30" y="88" width="40" height="6" rx="2" fill="#a0622c"/>' },
    { id: 'badge', name: 'Sheriff badge', color: '#b8860b',
      svg: '<polygon points="' + star(50, 50, 44, 24, 6) + '" fill="#e3b955" stroke="#8a6410" stroke-width="3" stroke-linejoin="round"/>' +
        Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + i * Math.PI / 3; return '<circle cx="' + (50 + 44 * Math.cos(a)).toFixed(1) + '" cy="' + (50 + 44 * Math.sin(a)).toFixed(1) + '" r="5" fill="#e3b955" stroke="#8a6410" stroke-width="2"/>'; }).join('') +
        '<circle cx="50" cy="50" r="13" fill="none" stroke="#8a6410" stroke-width="2.5"/>' },
    { id: 'boot', name: 'Boot', color: '#7a4a22',
      svg: '<path d="M30 8 L58 8 L60 56 C70 60 86 64 90 74 C92 80 90 86 84 86 L24 86 L22 70 C24 50 26 30 30 8 Z" fill="#8f5a2c" stroke="#4e2e12" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M32 22 L56 22 M36 36 Q46 30 54 40" stroke="#c99257" stroke-width="3" fill="none"/>' +
        '<path d="M20 86 L50 86 L50 92 L22 92 Z" fill="#4e2e12"/><circle cx="18" cy="78" r="7" fill="none" stroke="#c0c4cc" stroke-width="3"/>' },
    { id: 'hat', name: 'Cowboy hat', color: '#a0703a',
      svg: '<path d="M6 62 C20 76 80 76 94 62 C88 58 82 64 74 62 L70 34 C68 22 58 26 50 30 C42 26 32 22 30 34 L26 62 C18 64 12 58 6 62 Z" fill="#c08a4a" stroke="#6a4520" stroke-width="3" stroke-linejoin="round"/>' +
        '<path d="M27 54 C40 58 60 58 73 54 L72 48 C60 52 40 52 28 48 Z" fill="#6a2a1a"/>' },
    { id: 'bottle', name: 'Bottle', color: '#2c7a5a',
      svg: '<path d="M42 6 L58 6 L58 28 C68 34 72 42 72 52 L72 88 C72 92 68 94 64 94 L36 94 C32 94 28 92 28 88 L28 52 C28 42 32 34 42 28 Z" fill="#2f8a66" stroke="#174a36" stroke-width="3" stroke-linejoin="round"/>' +
        '<rect x="34" y="54" width="32" height="22" rx="2" fill="#f1e4c0"/><path d="M40 62 L60 62 M42 68 L58 68" stroke="#8a3a2a" stroke-width="2.5"/>' +
        '<rect x="40" y="4" width="20" height="7" rx="2" fill="#7a4a22"/>' },
    { id: 'bolt', name: 'Lightning', color: '#e0b000',
      svg: '<polygon points="58,4 18,56 46,56 36,96 82,38 54,38 66,4" fill="#f5cd1e" stroke="#a07c00" stroke-width="3" stroke-linejoin="round"/>' },
    { id: 'anchor', name: 'Anchor', color: '#24456e',
      svg: '<circle cx="50" cy="16" r="9" fill="none" stroke="#2a4f7e" stroke-width="6"/>' +
        '<path d="M50 25 L50 88 M30 40 L70 40" stroke="#2a4f7e" stroke-width="7" stroke-linecap="round"/>' +
        '<path d="M14 58 C16 80 34 90 50 90 C66 90 84 80 86 58" fill="none" stroke="#2a4f7e" stroke-width="7" stroke-linecap="round"/>' +
        '<polygon points="8,62 20,50 24,66" fill="#2a4f7e"/><polygon points="92,62 80,50 76,66" fill="#2a4f7e"/>' },
    { id: 'bell', name: 'Bell', color: '#c9962f',
      svg: '<path d="M50 10 C30 10 24 28 24 46 C24 62 18 70 10 76 L90 76 C82 70 76 62 76 46 C76 28 70 10 50 10 Z" fill="#e3b955" stroke="#8a6410" stroke-width="3" stroke-linejoin="round"/>' +
        '<circle cx="50" cy="84" r="9" fill="#a8781c"/><rect x="45" y="2" width="10" height="10" rx="3" fill="#8a6410"/>' +
        '<path d="M34 40 C34 28 40 22 46 20" stroke="#fff3c8" stroke-width="4" fill="none" stroke-linecap="round" opacity=".7"/>' },
    { id: 'key', name: 'Key', color: '#8f5f2a',
      svg: '<circle cx="28" cy="50" r="20" fill="none" stroke="#a8702e" stroke-width="9"/>' +
        '<path d="M46 50 L92 50" stroke="#a8702e" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M76 50 L76 68 M88 50 L88 64" stroke="#a8702e" stroke-width="8" stroke-linecap="round"/>' }
  ];

  return {
    LIST,
    // Full SVG markup for a symbol.
    svg(id) {
      const s = LIST.find(x => x.id === id);
      return '<svg viewBox="0 0 100 100" aria-hidden="true">' + s.svg + '</svg>';
    },
    name(id) { return LIST.find(x => x.id === id).name; }
  };
})();
