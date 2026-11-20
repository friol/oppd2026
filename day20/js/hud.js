// hud.js - glass cockpit overlay drawn on a 2D canvas: analog speedometer with
// throttle arc, altimeter, vertical speed, heading tape, clock, stick indicator.
(function () {
  'use strict';
  const H = { msg: '', msgTime: 0 };
  let cv, ctx, W = 0, Hh = 0, dpr = 1;
  const AMBER = '#ffcf6b', CYAN = '#7fe8ff', DIM = 'rgba(160,230,255,0.35)', BG = 'rgba(6,14,22,0.55)';

  H.init = function (canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    H.resize();
  };
  H.resize = function () {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; Hh = window.innerHeight;
    cv.width = W * dpr; cv.height = Hh * dpr;
    cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
  };
  H.message = function (text, secs) { H.msg = text; H.msgTime = secs || 3; };

  function speedometer(cx, cy, r, kmh, throttle, boost) {
    const MAX = 2000;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = v => a0 + (a1 - a0) * Math.min(1, v / MAX);
    // dial
    ctx.fillStyle = BG;
    ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(127,232,255,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, Math.PI * 2); ctx.stroke();
    // red zone (boost)
    ctx.strokeStyle = 'rgba(255,80,60,0.75)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, r - 3, ang(1050), ang(2000)); ctx.stroke();
    // ticks
    for (let v = 0; v <= MAX; v += 50) {
      const a = ang(v), major = v % 200 === 0;
      const r1 = r - (major ? 14 : v % 100 === 0 ? 9 : 5);
      ctx.strokeStyle = major ? CYAN : DIM; ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
      if (major) {
        ctx.fillStyle = CYAN; ctx.font = '600 11px Bahnschrift, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(v / 100), cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26));
      }
    }
    // throttle arc (inner)
    ctx.strokeStyle = 'rgba(120,255,170,0.25)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r - 40, a0, a1); ctx.stroke();
    ctx.strokeStyle = boost > 0.1 ? '#ff8a4c' : '#78ffaa';
    ctx.beginPath(); ctx.arc(cx, cy, r - 40, a0, a0 + (a1 - a0) * Math.min(1, throttle + boost * 0.3)); ctx.stroke();
    // needle
    const a = ang(kmh);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 3; ctx.shadowColor = AMBER; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * 12, cy - Math.sin(a) * 12); ctx.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    // digital readout
    ctx.fillStyle = '#fff'; ctx.font = '700 26px Bahnschrift, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(Math.round(kmh)), cx, cy + r * 0.55);
    ctx.fillStyle = CYAN; ctx.font = '600 11px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText('KM/H  ×100', cx, cy + r * 0.55 + 15);
    ctx.fillText('THR ' + Math.round(throttle * 100) + '%' + (boost > 0.1 ? '  BOOST' : ''), cx, cy - r * 0.32);
    ctx.fillStyle = DIM; ctx.fillText(Math.round(kmh / 1.852) + ' KT', cx, cy + r * 0.55 + 29);
  }

  function box(x, y, w, h) {
    ctx.fillStyle = BG; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(127,232,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function headingTape(cx, y, heading) {
    const w = 360, h = 30;
    box(cx - w / 2, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - w / 2, y, w, h); ctx.clip();
    const pxPerDeg = 3;
    const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let d = Math.floor(heading - 70); d <= heading + 70; d++) {
      if (d % 5) continue;
      const dd = ((d % 360) + 360) % 360;
      const x = cx + (d - heading) * pxPerDeg;
      ctx.strokeStyle = dd % 15 === 0 ? CYAN : DIM; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + h - (dd % 15 === 0 ? 9 : 5)); ctx.stroke();
      if (dd % 15 === 0) {
        ctx.fillStyle = names[dd] ? AMBER : CYAN; ctx.font = '600 12px Bahnschrift, Segoe UI, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(names[dd] || String(dd).padStart(3, '0'), x, y + 13);
      }
    }
    ctx.restore();
    ctx.fillStyle = AMBER;
    ctx.beginPath(); ctx.moveTo(cx, y + h + 1); ctx.lineTo(cx - 6, y + h + 9); ctx.lineTo(cx + 6, y + h + 9); ctx.fill();
  }

  H.draw = function (s) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, Hh);
    if (!s.ready || s.menu) return; // the title-screen menu hides the flight HUD
    const sh = s.ship;
    const kmh = sh.vel.length() * 3.6;
    // speedometer, bottom left
    speedometer(120, Hh - 130, 96, kmh, sh.throttle, sh.boost);

    // altimeter + vertical speed, bottom right
    const bx = W - 220, by = Hh - 196;
    box(bx, by, 196, 172);
    ctx.textAlign = 'left'; ctx.fillStyle = CYAN; ctx.font = '600 12px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText('ALTITUDE MSL', bx + 14, by + 22);
    ctx.fillStyle = '#fff'; ctx.font = '700 30px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText(Math.round(sh.pos.y).toLocaleString('en-US') + ' m', bx + 14, by + 54);
    ctx.fillStyle = CYAN; ctx.font = '600 12px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText('ABOVE GROUND', bx + 14, by + 80);
    ctx.fillStyle = sh.agl < 60 ? '#ff6a50' : '#fff'; ctx.font = '700 20px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText(Math.round(sh.agl).toLocaleString('en-US') + ' m', bx + 14, by + 102);
    ctx.fillStyle = CYAN; ctx.font = '600 12px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText('VERTICAL SPEED', bx + 14, by + 128);
    const vs = sh.vspeed;
    ctx.fillStyle = vs < -40 ? '#ff6a50' : '#fff'; ctx.font = '700 20px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText((vs >= 0 ? '+' : '') + Math.round(vs) + ' m/s', bx + 14, by + 150);
    // VSI bar
    const vh = THREE.MathUtils.clamp(vs / 100, -1, 1) * 70;
    ctx.fillStyle = 'rgba(127,232,255,0.15)'; ctx.fillRect(bx + 168, by + 16, 10, 140);
    ctx.fillStyle = vs >= 0 ? '#78ffaa' : '#ff8a4c';
    ctx.fillRect(bx + 168, by + 86 - Math.max(vh, 0), 10, Math.abs(vh));

    // heading tape
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(sh.quat);
    let hd = Math.atan2(f.x, -f.z) * 180 / Math.PI; if (hd < 0) hd += 360;
    headingTape(W / 2, 14, hd);

    // clock and info, top left
    box(14, 14, 190, 64);
    const hh = Math.floor(s.hours), mm = Math.floor((s.hours - hh) * 60);
    ctx.fillStyle = '#fff'; ctx.font = '700 26px Bahnschrift, Segoe UI, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), 26, 46);
    ctx.fillStyle = CYAN; ctx.font = '600 12px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText('TIME ×' + s.daySpeed + (s.paused ? '  PAUSED' : ''), 110, 40);
    ctx.fillText(s.place, 26, 66);

    // stats, top right
    ctx.textAlign = 'right'; ctx.fillStyle = DIM; ctx.font = '600 11px Bahnschrift, Segoe UI, sans-serif';
    ctx.fillText(s.fps + ' FPS  ·  ' + ['LOW', 'MEDIUM', 'HIGH'][s.quality] + '  ·  H = HELP', W - 16, 26);

    // flight path marker + stick indicator
    if (sh.camMode !== 2) {
      const cx = W / 2, cy = Hh / 2;
      ctx.strokeStyle = 'rgba(127,232,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 7, cy); ctx.moveTo(cx + 7, cy); ctx.lineTo(cx + 18, cy); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy - 13);
      ctx.stroke();
      if (s.mouseActive) {
        ctx.strokeStyle = 'rgba(127,232,255,0.25)';
        ctx.strokeRect(cx - 60, cy - 60, 120, 120);
        ctx.fillStyle = AMBER;
        ctx.beginPath(); ctx.arc(cx + s.stick.x * 60, cy - s.stick.y * 60, 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // messages
    if (H.msgTime > 0) {
      ctx.globalAlpha = Math.min(1, H.msgTime);
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '700 22px Bahnschrift, Segoe UI, sans-serif';
      ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
      ctx.fillText(H.msg, W / 2, Hh * 0.3);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (window.GAME) GAME.drawHud(ctx, W, Hh);
    if (!s.mouseActive && !s.help && !s.menu) {
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '600 14px Bahnschrift, Segoe UI, sans-serif';
      ctx.fillText('Click to fly with the mouse  ·  keyboard: W/S pitch, A/D roll, Q/E yaw, R/F throttle', W / 2, Hh - 24);
    }
  };

  window.HUD = H;
})();
