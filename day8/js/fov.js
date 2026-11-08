'use strict';

// Field of view by recursive shadowcasting over the eight octants.
const FOV = (() => {
  const OCTANTS = [
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
  ];

  // blocks(x, y) tells whether a cell stops sight; returns 1 for visible cells
  function compute(w, h, ox, oy, radius, blocks) {
    const vis = new Uint8Array(w * h);
    vis[oy * w + ox] = 1;
    const r2 = radius * radius;

    function cast(row, start, end, xx, xy, yx, yy) {
      if (start < end) return;
      let next = start;
      for (let j = row; j <= radius; j++) {
        let blocked = false;
        for (let dx = -j, dy = -j; dx <= 0; dx++) {
          const l = (dx - 0.5) / (dy + 0.5), r = (dx + 0.5) / (dy - 0.5);
          if (start < r) continue;
          if (end > l) break;
          const x = ox + dx * xx + dy * xy, y = oy + dx * yx + dy * yy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (dx * dx + dy * dy <= r2) vis[y * w + x] = 1;
          if (blocked) {
            if (blocks(x, y)) { next = r; continue; }
            blocked = false;
            start = next;
          } else if (blocks(x, y) && j < radius) {
            blocked = true;
            cast(j + 1, start, l, xx, xy, yx, yy);
            next = r;
          }
        }
        if (blocked) break;
      }
    }

    for (const [xx, xy, yx, yy] of OCTANTS) cast(1, 1, 0, xx, xy, yx, yy);
    return vis;
  }

  // straight line between two cells without the end points, for ranged attacks
  function line(x0, y0, x1, y1) {
    const cells = [];
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    for (;;) {
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === x1 && y === y1) break;
      cells.push([x, y]);
    }
    return cells;
  }

  return { compute, line };
})();

if (typeof module !== 'undefined') module.exports = FOV;
