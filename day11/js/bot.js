// OPPD-1 display mascot: a little robot that dances to the beat, plus note particles and small effect animations
'use strict';

const BOT = {
  notes: [],          // floating music notes { x, y, vx, vy, life, col, ch }
  lastEmit: [0, 0, 0, 0],
  kickT: 0,
  lastInput: performance.now(),
  blinkAt: 0
};

function botEmit(pi) {
  const now = performance.now();
  if (now - BOT.lastEmit[pi] < 140 || BOT.notes.length > 24) return;
  BOT.lastEmit[pi] = now;
  BOT.notes.push({ x: (Math.random() - 0.5) * 10, y: -38, vx: (Math.random() - 0.5) * 22, vy: -18 - Math.random() * 14, life: 1, col: pi === 0 ? ROW_COLORS[0] : KC[pi], ch: Math.random() < 0.5 ? '♪' : '♫' });
}

// pose of the robot for this frame
function botPose() {
  const now = performance.now(), t = now / 1000;
  const p = { bob: 0, lean: 0, armL: 2.6, armR: -2.6, legL: 0, legR: 0, eyes: 'open', look: 0, mouth: 'line', antenna: 0, zz: false };
  if (now > BOT.blinkAt) { BOT.blinkAt = now + 2500 + Math.random() * 3000; }
  const blinking = BOT.blinkAt - now > 0 && BOT.blinkAt - now < 120;
  if (!SEQ.playing) {
    const idle = now - BOT.lastInput > 25000;
    p.bob = Math.sin(t * 2) * 0.8;
    p.armL = 2.7 + Math.sin(t * 2) * 0.05; p.armR = -2.7 - Math.sin(t * 2) * 0.05;
    if (idle) { p.eyes = 'closed'; p.lean = 0.12; p.zz = true; p.mouth = 'o'; p.bob = Math.sin(t * 1.2) * 1.2; }
    else { p.eyes = blinking ? 'closed' : 'open'; p.look = Math.sin(t * 0.7) > 0.8 ? 1 : Math.sin(t * 0.7) < -0.8 ? -1 : 0; }
    p.antenna = Math.sin(t * 3) * 0.15;
    return p;
  }
  const bd = 60 / PRJ.bpm;
  const ph = UI.beatT ? clamp((AC.currentTime - UI.beatT) / bd, 0, 1) : 0;
  const beat = UI.beatN || 0, odd = beat % 2 === 1;
  const energy = clamp(UI.act.reduce((a, b) => a + b, 0), 0, 1.5);
  const amp = 1.5 + energy * 3.5;
  p.bob = -Math.sin(Math.PI * ph) * amp;
  p.antenna = -Math.sin(Math.PI * 2 * ph) * 0.4;
  p.eyes = blinking ? 'closed' : energy > 0.7 ? 'happy' : 'open';
  p.mouth = energy > 0.5 ? 'smile' : 'line';
  if (energy < 0.08) { p.bob *= 0.4; return p; }   // quiet: just nodding
  const move = Math.floor(beat / 8) % 4;
  const sw = Math.sin(Math.PI * (beat % 2 + ph));        // -1..1 over two beats
  if (move === 0) {          // bounce: arms pump in turn
    p.armL = odd ? 0.6 : 2.4; p.armR = odd ? -2.4 : -0.6;
    p.legL = odd ? -0.2 : 0; p.legR = odd ? 0 : 0.2;
  } else if (move === 1) {   // sway with arms out
    p.lean = sw * 0.22; p.armL = 1.6 + sw * 0.4; p.armR = -1.6 + sw * 0.4;
    p.look = sw > 0.3 ? 1 : sw < -0.3 ? -1 : 0;
  } else if (move === 2) {   // disco point
    p.lean = odd ? -0.12 : 0.12;
    p.armR = odd ? -2.6 : -0.5; p.armL = 2.5;
    p.legL = odd ? -0.25 : 0;
  } else {                   // robot dance: stiff arms, head looks around
    const step = beat % 4;
    p.armL = [1.6, 0.9, 1.6, 2.6][step]; p.armR = [-2.6, -1.6, -0.9, -1.6][step];
    p.look = [0, 1, 0, -1][step];
    p.bob *= 0.6;
  }
  if (performance.now() - BOT.kickT < 90) p.eyes = 'big';
  return p;
}

// draw the robot standing on (cx, by); scale s
function drawBot(g, cx, by, s, pose) {
  const body = '#cfd6d0', joint = '#8a948e', face = '#0e100f';
  g.save();
  g.translate(cx, by);
  g.scale(s, s);
  // shadow
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath(); g.ellipse(0, 0, 13 + pose.bob * 0.4, 2.5, 0, 0, Math.PI * 2); g.fill();
  const hipY = -12 + pose.bob * 0.5;
  // legs
  g.strokeStyle = joint; g.lineWidth = 3; g.lineCap = 'round';
  [[-4, pose.legL], [4, pose.legR]].forEach(([x, a]) => {
    const fx = x * 1.3 + Math.sin(a) * 10;   // feet stay on the floor, the legs stretch
    g.beginPath(); g.moveTo(x, hipY); g.lineTo(fx, -2); g.stroke();
    g.fillStyle = body; g.fillRect(fx - 3.5, -3, 7, 3);
  });
  // upper body pivots on the hips
  g.translate(0, hipY);
  g.rotate(pose.lean);
  const top = -17;
  // arms (angle 0 = straight up, pi = straight down)
  [[-9, pose.armL], [9, pose.armR]].forEach(([x, a]) => {
    const hx = x - Math.sin(a) * 11, hy = top + 4 - Math.cos(a) * 11;
    g.strokeStyle = joint; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(x, top + 4); g.lineTo(hx, hy); g.stroke();
    g.fillStyle = body; g.beginPath(); g.arc(hx, hy, 2.4, 0, Math.PI * 2); g.fill();
  });
  // torso with a tiny level meter
  g.fillStyle = body; rrect(g, -9, top, 18, 17, 3); g.fill();
  g.fillStyle = face; g.fillRect(-5, top + 5, 10, 5);
  const lv = clamp(UI.act.reduce((a, b) => a + b, 0), 0, 1);
  g.fillStyle = C.accent; g.fillRect(-4, top + 6, 8 * lv, 3);
  // head
  g.translate(0, top - 2);
  g.rotate(pose.look * 0.08);
  g.strokeStyle = joint; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -16); g.lineTo(Math.sin(pose.antenna) * 7, -23); g.stroke();
  g.fillStyle = SEQ.playing && UI.beatT && AC.currentTime - UI.beatT < 0.1 ? C.accent : C.rec;
  g.beginPath(); g.arc(Math.sin(pose.antenna) * 7, -24, 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = body; rrect(g, -13, -17, 26, 17, 4); g.fill();
  g.fillStyle = face; rrect(g, -10, -14, 20, 11, 2.5); g.fill();
  const ex = pose.look * 2;
  g.fillStyle = C.accent; g.strokeStyle = C.accent; g.lineWidth = 1.3;
  [-4.5, 4.5].forEach(x => {
    const X = x + ex;
    if (pose.eyes === 'closed') { g.beginPath(); g.moveTo(X - 2, -9); g.lineTo(X + 2, -9); g.stroke(); }
    else if (pose.eyes === 'happy') { g.beginPath(); g.arc(X, -8, 2.2, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    else if (pose.eyes === 'big') g.fillRect(X - 2.2, -12, 4.4, 6);
    else g.fillRect(X - 1.6, -11, 3.2, 4);
  });
  g.strokeStyle = C.accent; g.lineWidth = 1;
  g.beginPath();
  if (pose.mouth === 'smile') g.arc(ex, -7, 2.5, Math.PI * 0.15, Math.PI * 0.85);
  else if (pose.mouth === 'open') { g.fillRect(ex - 1.5, -6, 3, 2); }
  else if (pose.mouth === 'o') g.arc(ex, -5, 1, 0, Math.PI * 2);
  else { g.moveTo(ex - 2, -4.5); g.lineTo(ex + 2, -4.5); }
  g.stroke();
  g.restore();
  // zZz while sleeping
  if (pose.zz) {
    const t = performance.now() / 1000;
    for (let i = 0; i < 3; i++) {
      const k = (t * 0.5 + i / 3) % 1;
      g.globalAlpha = 1 - k;
      T(g, 'z', cx + 16 * s + k * 14, by - 46 * s - k * 16, 7 + k * 5, C.dim, 'left', 700);
    }
    g.globalAlpha = 1;
  }
}

// floating notes around the robot (cx, by = robot base), clipped to a box
function drawBotNotes(g, cx, by, dt) {
  BOT.notes = BOT.notes.filter(n => n.life > 0);
  BOT.notes.forEach(n => {
    n.x += n.vx * dt; n.y += n.vy * dt; n.vy += 6 * dt; n.life -= dt * 0.9;
    g.globalAlpha = clamp(n.life, 0, 1);
    T(g, n.ch, cx + n.x, by + n.y, 10, n.col, 'center');
  });
  g.globalAlpha = 1;
}

// smoke puffs over a hot distortion, glitch blocks over a heavy bitcrusher
function drawFxExtras(g, cfg, x, y, w, h) {
  const t = performance.now() / 1000;
  if (cfg.type === 'DISTORT' && cfg.p1 > 0.5) {
    const k = (cfg.p1 - 0.5) / 0.5;
    for (let i = 0; i < 7; i++) {
      const ph = (t * (0.4 + k * 0.4) + i / 7) % 1;
      const px = x + w * 0.5 + Math.sin(i * 2.3 + t * 1.5) * 30 * ph + (i - 3) * 8;
      const py = y + h * 0.45 - ph * 34;
      g.globalAlpha = (1 - ph) * 0.35 * k;
      g.fillStyle = i % 2 ? '#9aa39d' : '#6f7a74';
      g.beginPath(); g.arc(px, py, 3 + ph * 9, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  if (cfg.type === 'BITCRUSH' && cfg.p1 > 0.4) {
    const k = (cfg.p1 - 0.4) / 0.6, seed = Math.floor(t * 12);
    for (let i = 0; i < 6 * k; i++) {
      const r1 = Math.abs(Math.sin((seed + i) * 91.7)) % 1, r2 = Math.abs(Math.sin((seed + i) * 37.3)) % 1;
      g.globalAlpha = 0.5;
      g.fillStyle = i % 2 ? C.accent : '#ee8a69';
      g.fillRect(x + r1 * w, y + r2 * h, 4 + r2 * 14, 2 + r1 * 3);
    }
    g.globalAlpha = 1;
  }
}
