// Node test: generates the world and writes a shaded overview PNG.
// Usage: node tools/testworld.js out.png
const fs = require('fs'), vm = require('vm'), zlib = require('zlib'), path = require('path');
const ctx = { console, Math, Float32Array, Uint8Array, Date };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['noise.js', 'world.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'), ctx);
const W = ctx.WORLD;
let t0 = Date.now(), last = '';
for (const [p, label] of W.generate()) { if (label !== last) { console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', label); last = label; } }
console.log('total', (Date.now() - t0) / 1000, 's');
let mx = -1e9, mn = 1e9; for (const h of W.height) { mx = Math.max(mx, h); mn = Math.min(mn, h); }
console.log('height range', mn.toFixed(0), mx.toFixed(0), 'lakes', JSON.stringify(W.lakes), 'towns', W.towns.length, 'spawn', JSON.stringify(W.spawn));

const S = 1024, img = Buffer.alloc(S * (S * 3 + 1));
for (let y = 0; y < S; y++) {
  img[y * (S * 3 + 1)] = 0;
  for (let x = 0; x < S; x++) {
    const wx = -W.HALF + (x + 0.5) / S * W.SIZE, wz = -W.HALF + (y + 0.5) / S * W.SIZE;
    const h = W.heightAt(wx, wz), n = W.normalAt(wx, wz);
    const sh = Math.max(0, n.x * -0.5 + n.y * 0.6 + n.z * -0.6) * 1.1;
    let c;
    const forest = W.maskAt(wx, wz, 2), fields = W.maskAt(wx, wz, 3);
    if (h < 0) c = [20, 60 + Math.max(-100, h) * 0.3 + 40, 120];
    else if (h > 1500 + (1 - n.y) * 2000 && n.y > 0.6) c = [240, 240, 245];
    else if (n.y < 0.75) c = [120, 110, 100];
    else c = [70 + fields * 90 - forest * 40, 130 - forest * 50, 50 + fields * 20 - forest * 20];
    const o = y * (S * 3 + 1) + 1 + x * 3;
    for (let k = 0; k < 3; k++) img[o + k] = Math.max(0, Math.min(255, c[k] * (h < 0 ? 1 : sh)));
  }
}
for (const t of W.towns) { const x = Math.round((t.x + W.HALF) / W.SIZE * S), y = Math.round((t.z + W.HALF) / W.SIZE * S); for (let d = -3; d <= 3; d++) for (let e = -3; e <= 3; e++) { const o = (y + d) * (S * 3 + 1) + 1 + (x + e) * 3; img[o] = 255; img[o + 1] = 0; img[o + 2] = 0; } }
{ const x = Math.round((W.spawn.x + W.HALF) / W.SIZE * S), y = Math.round((W.spawn.z + W.HALF) / W.SIZE * S); for (let d = -5; d <= 5; d++) { for (const [a, b] of [[d, 0], [0, d]]) { const o = (y + a) * (S * 3 + 1) + 1 + (x + b) * 3; img[o] = 255; img[o + 1] = 255; img[o + 2] = 0; } } }
function crc32(b) { let c, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
const hdr = Buffer.alloc(13); hdr.writeUInt32BE(S, 0); hdr.writeUInt32BE(S, 4); hdr[8] = 8; hdr[9] = 2;
fs.writeFileSync(process.argv[2] || 'world.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hdr), chunk('IDAT', zlib.deflateSync(img)), chunk('IEND', Buffer.alloc(0))]));
