// Circular (theta) maze: concentric rings of cells, the start is the central cell
// and the only exit is a gap in the outermost wall.
const Maze = (() => {
  const TAU = Math.PI * 2;
  const NEWEST = 0.65; // growing tree: chance of extending the newest cell (long corridors) vs a random one (branches)

  // Cells per ring: 1 in the centre, 6 in the first ring, then doubled whenever
  // a cell would become more than twice as wide as the ring is thick.
  function ringSizes(rings) {
    const sizes = [1];
    for (let r = 1; r < rings; r++) {
      let n = r === 1 ? 6 : sizes[r - 1];
      if (r > 1 && TAU * r / n > 2) n *= 2;
      sizes.push(n);
    }
    return sizes;
  }

  // Cell ids, the inward neighbour (parent) and the clockwise neighbour of every cell.
  function grid(rings) {
    const size = ringSizes(rings), first = [];
    let total = 0;
    for (const n of size) { first.push(total); total += n; }
    const ring = new Int32Array(total), index = new Int32Array(total);
    const parent = new Int32Array(total).fill(-1), cw = new Int32Array(total).fill(-1);
    const adj = [];
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < size[r]; i++) {
        ring[first[r] + i] = r;
        index[first[r] + i] = i;
        adj.push([]);
      }
    }
    for (let id = 1; id < total; id++) {
      const r = ring[id], i = index[id];
      const p = first[r - 1] + Math.floor(i * size[r - 1] / size[r]);
      const c = first[r] + (i + 1) % size[r];
      parent[id] = p; cw[id] = c;
      adj[id].push(p, c); adj[p].push(id); adj[c].push(id);
    }
    return { rings, size, first, total, ring, index, parent, cw, adj };
  }

  const key = (g, a, b) => a < b ? a * g.total + b : b * g.total + a;

  // Perfect maze (a spanning tree) carved with the growing tree algorithm.
  function carve(g) {
    const links = g.adj.map(() => []), open = new Set();
    const visited = new Uint8Array(g.total);
    const active = [0];
    visited[0] = 1;
    while (active.length) {
      const k = Math.random() < NEWEST ? active.length - 1 : Math.floor(Math.random() * active.length);
      const c = active[k];
      const free = g.adj[c].filter(n => !visited[n]);
      if (!free.length) { active.splice(k, 1); continue; }
      const n = free[Math.floor(Math.random() * free.length)];
      links[c].push(n); links[n].push(c);
      open.add(key(g, c, n));
      visited[n] = 1;
      active.push(n);
    }
    return Object.assign({}, g, { links, open });
  }

  // Exit on the outer cell farthest from the centre; the score rewards long
  // solutions with many forks along the way.
  function solve(m) {
    const dist = new Int32Array(m.total).fill(-1), prev = new Int32Array(m.total).fill(-1);
    const queue = [0];
    dist[0] = 0;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      for (const n of m.links[c]) {
        if (dist[n] < 0) { dist[n] = dist[c] + 1; prev[n] = c; queue.push(n); }
      }
    }
    const outer = m.first[m.rings - 1];
    let exit = outer;
    for (let id = outer; id < m.total; id++) if (dist[id] > dist[exit]) exit = id;
    const solution = [];
    for (let c = exit; c >= 0; c = prev[c]) solution.unshift(c);
    let forks = 0;
    for (const c of solution) {
      const choices = m.links[c].length - (c === 0 ? 0 : 1);
      if (choices >= 2) forks++;
    }
    m.exit = exit;
    m.solution = solution;
    m.forks = forks;
    m.score = solution.length + 4 * forks;
    return m;
  }

  // Carve several mazes and keep the hardest one.
  function generate(rings, tries) {
    const g = grid(rings);
    let best = null;
    for (let t = 0; t < tries; t++) {
      const m = solve(carve(g));
      if (!best || m.score > best.score) best = m;
    }
    return best;
  }

  const isOpen = (m, a, b) => m.open.has(key(m, a, b));
  const angle = (i, n) => i * TAU / n - Math.PI / 2; // cell 0 starts at the top, angles grow clockwise

  // Centre of a cell in polar coordinates (radius in ring units).
  function center(m, id) {
    if (id === 0) return { r: 0, a: 0 };
    const r = m.ring[id];
    return { r: r + 0.5, a: angle(m.index[id] + 0.5, m.size[r]) };
  }

  return { generate, isOpen, angle, center };
})();
