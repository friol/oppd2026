'use strict';
// Card back: a saloon-style design in SVG. Burgundy damask lattice, a gold
// frame with a rope border and corner flourishes, and a sunburst medallion with
// a sheriff's star and the "DV" monogram in the middle.
// Gradients and patterns are defined once in a hidden <svg> (CARDBACK.install)
// and shared by every card.

const CARDBACK = (function () {
  const W = 100, H = 143;          // same proportions as the inside of the card's white border
  const CX = W / 2, CY = H / 2;

  const star = (cx, cy, ro, ri, n) => Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
    return (cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2);
  }).join(' ');

  const DEFS =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    // Felt-red background, lighter in the middle (colours follow the CSS theme variables).
    '<radialGradient id="dvBg" cx="50%" cy="50%" r="75%">' +
    '<stop offset="0" style="stop-color: var(--back-a)"/><stop offset="1" style="stop-color: var(--back-b)"/></radialGradient>' +
    '<linearGradient id="dvGold" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#fbe9b0"/><stop offset=".45" stop-color="#d9a940"/>' +
    '<stop offset=".7" stop-color="#f3d27a"/><stop offset="1" stop-color="#8a6410"/></linearGradient>' +
    // Damask lattice: thin diamonds with a dot and a tiny four-point star in each cell.
    '<pattern id="dvLattice" width="10" height="10" patternUnits="userSpaceOnUse">' +
    '<path d="M5 0 L10 5 L5 10 L0 5 Z" fill="none" stroke="rgba(255,225,160,.16)" stroke-width=".5"/>' +
    '<circle cx="5" cy="5" r=".9" fill="rgba(255,225,160,.22)"/>' +
    '<path d="M0 -1.4 L.35 -.35 L1.4 0 L.35 .35 L0 1.4 L-.35 .35 L-1.4 0 L-.35 -.35 Z" fill="rgba(255,225,160,.18)"/>' +
    '<path d="M10 -1.4 L10.35 -.35 L11.4 0 L10.35 .35 L10 1.4 L9.65 .35 L8.6 0 L9.65 -.35 Z" fill="rgba(255,225,160,.18)"/>' +
    '<path d="M0 8.6 L.35 9.65 L1.4 10 L.35 10.35 L0 11.4 L-.35 10.35 L-1.4 10 L-.35 9.65 Z" fill="rgba(255,225,160,.18)"/>' +
    '<path d="M10 8.6 L10.35 9.65 L11.4 10 L10.35 10.35 L10 11.4 L9.65 10.35 L8.6 10 L9.65 9.65 Z" fill="rgba(255,225,160,.18)"/>' +
    '</pattern>' +
    // Dark vignette inside the frame and a soft diagonal sheen.
    '<radialGradient id="dvVignette" cx="50%" cy="50%" r="70%">' +
    '<stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>' +
    '<linearGradient id="dvSheen" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset=".25" stop-color="#fff" stop-opacity="0"/><stop offset=".42" stop-color="#fff" stop-opacity=".13"/>' +
    '<stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
    '</defs></svg>';

  // One corner flourish (top-left); the others are mirrored copies.
  const CORNER =
    '<path d="M13 13 C22 13 25 16 25 23 M13 13 C13 22 16 25 23 25" fill="none" stroke="url(#dvGold)" stroke-width="1.1" stroke-linecap="round"/>' +
    '<path d="M13 13 C18 15 20 17 21 21 C17 20 15 18 13 13 Z" fill="url(#dvGold)"/>' +
    '<circle cx="25.4" cy="24" r="1.1" fill="url(#dvGold)"/><circle cx="24" cy="25.4" r="1.1" fill="url(#dvGold)"/>';

  const corners = [[1, 1, 0, 0], [-1, 1, W, 0], [1, -1, 0, H], [-1, -1, W, H]]
    .map(([sx, sy, tx, ty]) => '<g transform="translate(' + tx + ' ' + ty + ') scale(' + sx + ' ' + sy + ')">' + CORNER + '</g>').join('');

  // Sunburst rays behind the medallion.
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = i * Math.PI / 12, r0 = 23.5, r1 = i % 2 ? 29 : 34;
    return '<line x1="' + (CX + r0 * Math.cos(a)).toFixed(2) + '" y1="' + (CY + r0 * Math.sin(a)).toFixed(2) +
      '" x2="' + (CX + r1 * Math.cos(a)).toFixed(2) + '" y2="' + (CY + r1 * Math.sin(a)).toFixed(2) + '"/>';
  }).join('');

  // Ball tips on the six points of the sheriff's star.
  const tips = Array.from({ length: 6 }, (_, i) => {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    return '<circle cx="' + (CX + 15.6 * Math.cos(a)).toFixed(2) + '" cy="' + (CY + 15.6 * Math.sin(a)).toFixed(2) + '" r="1.9"/>';
  }).join('');

  const diamond = (x, y, s) => '<path d="M' + x + ' ' + (y - s) + ' L' + (x + s * .7) + ' ' + y + ' L' + x + ' ' + (y + s) + ' L' + (x - s * .7) + ' ' + y + ' Z"/>';

  const SVG =
    '<svg class="backart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true">' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#dvBg)"/>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#dvLattice)"/>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#dvVignette)"/>' +
    // Frame: outer gold line, rope, inner thin line.
    '<rect x="4.5" y="4.5" width="' + (W - 9) + '" height="' + (H - 9) + '" rx="5" fill="none" stroke="url(#dvGold)" stroke-width="1.6"/>' +
    '<rect x="8" y="8" width="' + (W - 16) + '" height="' + (H - 16) + '" rx="3.5" fill="none" stroke="url(#dvGold)" stroke-width="1.3" stroke-dasharray="2.2 1.1"/>' +
    '<rect x="10.5" y="10.5" width="' + (W - 21) + '" height="' + (H - 21) + '" rx="2" fill="none" stroke="#f3dc9b" stroke-opacity=".45" stroke-width=".5"/>' +
    corners +
    // Small diamonds on the middle of each side of the frame.
    '<g fill="url(#dvGold)">' + diamond(CX, 8, 2.6) + diamond(CX, H - 8, 2.6) + diamond(8, CY, 2.6) + diamond(W - 8, CY, 2.6) + '</g>' +
    // Medallion.
    '<g stroke="url(#dvGold)" stroke-width=".9" stroke-linecap="round" opacity=".75">' + rays + '</g>' +
    '<circle cx="' + CX + '" cy="' + CY + '" r="22" fill="#3d0a0e" fill-opacity=".55" stroke="url(#dvGold)" stroke-width="2"/>' +
    '<circle cx="' + CX + '" cy="' + CY + '" r="19.2" fill="none" stroke="#f3dc9b" stroke-opacity=".6" stroke-width=".6" stroke-dasharray="1 1.4"/>' +
    '<polygon points="' + star(CX, CY, 15.6, 8.4, 6) + '" fill="url(#dvGold)" stroke="#6b4a0c" stroke-width=".6" stroke-linejoin="round"/>' +
    '<g fill="url(#dvGold)" stroke="#6b4a0c" stroke-width=".5">' + tips + '</g>' +
    '<circle cx="' + CX + '" cy="' + CY + '" r="7.2" fill="#7a1520" stroke="#6b4a0c" stroke-width=".8"/>' +
    '<text x="' + CX + '" y="' + (CY + 2.7) + '" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="7.6" fill="#f7e3a1" letter-spacing="-.3">DV</text>' +
    '<rect width="' + W + '" height="' + H + '" fill="url(#dvSheen)"/>' +
    '</svg>';

  return {
    SVG,
    // Put the shared gradients and patterns in the page (once).
    install() {
      if (document.getElementById('dvBg')) return;
      document.body.insertAdjacentHTML('afterbegin', DEFS);
    }
  };
})();
