'use strict';
// Image loading and sprite drawing from the atlas built by tools/cut.py.

const SPR = {
  img: {},
  load(done, progress) {
    const files = ['atlas', 'title', 'bg_sky', 'bg_far', 'bg_near', 'bg_city_sky', 'bg_city_far', 'bg_city_near', 'bg_fog_mid', 'bg_fog_front'];
    let n = 0;
    for (const f of files) {
      const im = new Image();
      im.onload = () => { n++; if (progress) progress(n / files.length); if (n === files.length) done(); };
      im.onerror = () => { console.error('Missing image', f); n++; if (n === files.length) done(); };
      im.src = 'img/' + f + '.png';
      this.img[f] = im;
    }
  },
  size(name) { const r = ATLAS[name]; return r ? [r[2], r[3]] : [0, 0]; },
  // Draws a sprite. (x, y) is the anchor point; o.ax/o.ay (0..1) choose the anchor inside the sprite
  // (default top-left). o.flip mirrors horizontally, o.scale/o.sx/o.sy scale, o.rot rotates, o.alpha fades.
  draw(ctx, name, x, y, o) {
    const r = ATLAS[name];
    if (!r) return;
    o = o || {};
    const sx = (o.sx || 1) * (o.scale || 1), sy = (o.sy || 1) * (o.scale || 1);
    const w = r[2] * sx, h = r[3] * sy;
    const ax = (o.ax || 0) * w, ay = (o.ay || 0) * h;
    if (!o.flip && !o.rot && o.alpha === undefined && !o.flipY) {
      ctx.drawImage(this.img.atlas, r[0], r[1], r[2], r[3], Math.round(x - ax), Math.round(y - ay), w, h);
      return;
    }
    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.translate(Math.round(x), Math.round(y));
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(o.flip ? -1 : 1, o.flipY ? -1 : 1);
    ctx.drawImage(this.img.atlas, r[0], r[1], r[2], r[3], -ax, -ay, w, h);
    ctx.restore();
  },
  // A sprite filled with a flat colour (cached small canvas)
  tintCache: {},
  tinted(name, color) {
    const key = name + color;
    if (this.tintCache[key]) return this.tintCache[key];
    const r = ATLAS[name], c = document.createElement('canvas');
    c.width = r[2]; c.height = r[3];
    const g = c.getContext('2d');
    g.drawImage(this.img.atlas, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = color; g.fillRect(0, 0, r[2], r[3]);
    return (this.tintCache[key] = c);
  },
  // Draws a tile-sized region of a sprite (used for 32x32 tiles)
  tile(ctx, name, x, y, w, h) {
    const r = ATLAS[name];
    if (!r) return;
    ctx.drawImage(this.img.atlas, r[0], r[1], r[2], r[3], x, y, w || TILE, h || TILE);
  }
};
