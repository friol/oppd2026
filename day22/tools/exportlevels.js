// Writes the three procedural levels as JSON files in levels/ (world1.json ... world3.json).
// The game reads these files at start (when served over http) instead of generating the levels, so
// they can be edited with the level editor (Export) or by hand.
// Usage: node tools/exportlevels.js [--force]   (existing files are not overwritten without --force)
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console, Math });
for (const f of ['util.js', 'level.js', 'gen.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8').replace(/^'use strict';/, '').replace(/^(const|class) (\w+)/gm, 'var $2 = $1 $2').replace(/var (\w+) = const \w+/g, 'var $1').replace(/var (\w+) = class (\w+)/g, 'var $1 = class $2'), ctx, { filename: f });
}
const dir = path.join(__dirname, '../levels');
fs.mkdirSync(dir, { recursive: true });
for (let i = 0; i < 3; i++) {
  const file = path.join(dir, 'world' + (i + 1) + '.json');
  if (fs.existsSync(file) && !process.argv.includes('--force')) { console.log('skip (exists): ' + file); continue; }
  const L = ctx.GEN.generate(i);
  fs.writeFileSync(file, JSON.stringify(L.toJSON()));
  console.log('written ' + file + '  ' + L.w + 'x' + L.h + ', ' + L.ents.length + ' entities');
}
