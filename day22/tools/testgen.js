// Generates the three levels in Node and prints them as ASCII (entities as lowercase letters).
// Usage: node tools/testgen.js [level 1-3] [seed]
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math });
for (const f of ['util.js', 'level.js', 'gen.js', 'sim.js']) {
  const p = path.join(__dirname, '../js', f);
  if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8').replace(/^'use strict';/, '').replace(/^(const|class) (\w+)/gm, 'var $2 = $1 $2').replace(/var (\w+) = const \w+/g, 'var $1').replace(/var (\w+) = class (\w+)/g, 'var $1 = class $2'), ctx, { filename: f });
}
const only = process.argv[2] ? [parseInt(process.argv[2]) - 1] : [0, 1, 2];
const sym = { start: '@', exit: 'D', checkpoint: 'k', coin: 'o', scoin: 'O', goblin: 'g', brute: 'b', slime: 's', plant: 'p', turret: 't', turretR: 't',
  bat: 'v', eye: 'e', spikeball: '*', boss: 'K', sign: 'i', chest: 'c', secret: '$', heart: 'h', medkit: 'm', plasma: 'q', orb: 'r' };
for (const i of only) {
  const L = ctx.GEN.generate(i, process.argv[3] ? parseInt(process.argv[3]) : undefined);
  const g = [];
  for (let y = 0; y < L.h; y++) { g.push([]); for (let x = 0; x < L.w; x++) g[y].push(L.get(x, y)); }
  for (const e of L.ents) if (sym[e.t] && g[e.y]) g[e.y][e.x] = sym[e.t];
  console.log(`Level ${i + 1} "${L.name}" seed ${L.seed}: ${L.w}x${L.h}, ${L.ents.length} entities, ` +
    `${L.ents.filter(e => e.t === 'coin').length} coins, ${L.ents.filter(e => e.t === 'secret').length} secrets`);
  const cols = 160;
  for (let x0 = 0; x0 < L.w; x0 += cols) {
    console.log('-- columns ' + x0);
    for (let y = 0; y < L.h; y++) console.log(g[y].slice(x0, x0 + cols).join(''));
  }
}
