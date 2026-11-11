// OPPD-1 panel skins: ORIGINAL, MIDNIGHT, 1983, MODULAR
// The panel look lives in style.css (#panel[data-skin]); this file switches it and recolours the display
// (the C / KC / ROW_COLORS palettes used by the canvas and the step grid).
'use strict';

const SKINS = [
  {
    id: 'original', name: 'ORIGINAL', caps: ['#4e6a80', '#c9a24c', '#6f8a72', '#c4664a'],
    C: { bg: '#141716', ink: '#e9eee9', dim: '#6f7a74', faint: '#3a423e', line: '#2f3532', hi: '#232a26', cell: '#1a1e1c', accent: '#b8e62e', rec: '#ff5a36' },
    KC: ['#8fb0c9', '#e3c06a', '#9cc19f', '#ee8a69'], ROWS: ['#7f9bb2', '#e08364', '#dcb965', '#8fae92', '#ad9bc2'], glow: 0
  },
  {
    id: 'midnight', name: 'MIDNIGHT', caps: ['#5a7a93', '#d0a54a', '#73957a', '#cf6c4e'],
    C: { bg: '#08090a', ink: '#e9eee9', dim: '#7d8a84', faint: '#353d39', line: '#262c29', hi: '#1d2422', cell: '#121615', accent: '#b8e62e', rec: '#ff5a36' },
    KC: ['#8fb0c9', '#e3c06a', '#9cc19f', '#ee8a69'], ROWS: ['#7fa4c4', '#e8876a', '#e2c066', '#8fc596', '#b7a2d8'],
    glow: 3, glowColor: 'rgba(184,230,46,0.35)'
  },
  {
    // 1983: a turquoise vacuum fluorescent display with an amber accent, and a soft phosphor glow
    id: 'retro', name: '1983', caps: ['#3f6f7c', '#d08a2e', '#6e8b4e', '#c4552a'],
    C: { bg: '#06120f', ink: '#6ff5d8', dim: '#3fae98', faint: '#1f5a4e', line: '#123029', hi: '#0f2a24', cell: '#0b1f1a', accent: '#ffb347', rec: '#ff6a3c' },
    KC: ['#6ff5d8', '#ffb347', '#a7f07a', '#ff8a5c'], ROWS: ['#c8642a', '#e0a040', '#7a9a5a', '#3f7f8a', '#9a5a7a'],
    glow: 6, glowColor: 'rgba(111,245,216,0.6)'
  },
  {
    id: 'modular', name: 'MODULAR', caps: ['#4f7fa6', '#e2b13a', '#5f9a6c', '#d4643f'],
    C: { bg: '#0d1012', ink: '#e9eee9', dim: '#87918c', faint: '#3a423e', line: '#2a3033', hi: '#1f2427', cell: '#171b1d', accent: '#f2c230', rec: '#ff5a36' },
    KC: ['#8fb0c9', '#f2c230', '#9cc19f', '#ee8a69'], ROWS: ['#4f7fa6', '#d4643f', '#e2b13a', '#5f9a6c', '#8f74b8'], glow: 0
  }
];
let SKIN = 0;

function applySkin(i) {
  SKIN = ((i % SKINS.length) + SKINS.length) % SKINS.length;
  const sk = SKINS[SKIN], panel = document.getElementById('panel');
  panel.dataset.skin = sk.id;
  // display palettes (mutated in place: os.js, bot.js and the engines read them every frame)
  Object.assign(C, sk.C);
  sk.KC.forEach((c, k) => { KC[k] = c; });
  sk.ROWS.forEach((c, k) => { ROW_COLORS[k] = c; });
  DISPLAY_FX.glow = sk.glow; DISPLAY_FX.glowColor = sk.glowColor || 'transparent';
  // panel pieces coloured from the palette
  document.querySelectorAll('.seq-rows .row').forEach((row, r) => row.style.setProperty('--rc', ROW_COLORS[r]));
  document.querySelectorAll('.part').forEach((b, k) => b.style.setProperty('--pc', k ? sk.caps[k] : ROW_COLORS[0]));
  document.getElementById('skinName').textContent = sk.name;
  const sw = document.getElementById('skinSw');
  sw.style.setProperty('--pos', SKIN);
  sw.setAttribute('aria-label', 'Panel skin: ' + sk.name + ' (click for the next one)');
  // the 1983 cheeks change the panel's inner width: re-place the black keys once the layout settles
  if (KB.place) KB.place();                                 // reading the width forces the new layout now
  requestAnimationFrame(() => { if (KB.place) KB.place(); });
  try { localStorage.setItem('oppd1.skin', sk.id); } catch (e) { /* per-viewer preference only */ }
}
function savedSkin() {
  let id = 'original';
  try { id = localStorage.getItem('oppd1.skin') || id; } catch (e) { /* ignore */ }
  return Math.max(0, SKINS.findIndex(s => s.id === id));
}
