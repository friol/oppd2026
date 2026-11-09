// Pixel-art confetti for a win: square chips shot from the two bottom corners,
// snapped to a pixel grid, flipping as they fall. Drawn on a fixed canvas.
'use strict';

const Confetti = (() => {
  const COLORS = ['#7b5cff', '#3fd0ff', '#c58bff', '#ffd23f', '#ff8a3d', '#ff5fa2', '#ffffff', '#7cf2a0'];
  const GRAVITY = 0.26, DRAG = 0.985, FALL = 3.2;   // FALL: terminal speed, so chips float down
  let canvas = null, ctx = null, parts = [], raf = 0, scale = 1, px = 2;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    scale = dpr * Math.min(1.3, Math.max(0.7, innerWidth / 1200));
    px = Math.max(2, Math.round(2 * dpr));      // the pixel grid
    ctx.imageSmoothingEnabled = false;
  }

  function burst() {
    canvas = canvas || document.getElementById('confetti');
    if (!canvas) return;
    ctx = ctx || canvas.getContext('2d');
    resize();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = reduced ? 60 : 240;
    const W = canvas.width, H = canvas.height;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const delay = Math.floor(Math.random() * 40) + (i < n / 2 ? 0 : 35);  // two waves
      parts.push({
        x: left ? W * 0.04 : W * 0.96,
        y: H * 0.95,
        vx: (left ? 1 : -1) * (2 + Math.random() * 13) * scale,
        vy: -(15 + Math.random() * 13) * scale,
        size: Math.round((7 + Math.random() * 6) * scale / px) * px || px,
        rot: Math.random() * Math.PI,
        vr: 0.08 + Math.random() * 0.25,
        wob: Math.random() * Math.PI * 2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay,
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const snap = v => Math.round(v / px) * px;
    parts = parts.filter(p => {
      if (p.delay > 0) { p.delay--; return true; }
      p.vx *= DRAG;
      p.vy = Math.min(p.vy * DRAG + GRAVITY * scale, FALL * scale);
      p.wob += 0.12;
      p.x += p.vx + Math.sin(p.wob) * 1.2 * scale;
      p.y += p.vy;
      p.rot += p.vr;
      const w = Math.max(px, snap(p.size * Math.abs(Math.cos(p.rot))));
      ctx.fillStyle = p.color;
      ctx.fillRect(snap(p.x - w / 2), snap(p.y - p.size / 2), w, p.size);
      return p.y < H + 40 && p.x > -40 && p.x < W + 40;
    });
    if (parts.length) raf = requestAnimationFrame(step);
    else { raf = 0; ctx.clearRect(0, 0, W, H); }
  }

  function stop() {
    parts = [];
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { burst, stop };
})();
