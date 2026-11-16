// Time RewAInd - vertical shoot'em up with time rewind and learning enemies.
// All game state lives in S (plain data) so it can be snapshotted and rewound.
(function () {
'use strict';

var W = 480, H = 720, SC = 2;
var cv = document.getElementById('game');
var ctx = cv.getContext('2d');
cv.width = W * SC; cv.height = H * SC;
// WebGL post-processing (js/post.js): the 2D canvas becomes an offscreen frame, the GL canvas is what is shown.
// G toggles it (remembered); without WebGL the 2D canvas stays on screen.
var post = null, view = cv;
try { post = self.PostFX && self.PostFX.init(cv); } catch (e) { post = null; }
if (post) { post.canvas.id = 'game'; post.canvas.setAttribute('aria-label', cv.getAttribute('aria-label') || ''); cv.parentNode.replaceChild(post.canvas, cv); view = post.canvas; }
var postOn = true;
try { postOn = localStorage.getItem('rw16:postfx') !== '0'; } catch (e) { }
function setPost(on) {
  if (!post) return;
  postOn = on;
  try { localStorage.setItem('rw16:postfx', on ? '1' : '0'); } catch (e) { }
  var want = on ? post.canvas : cv;
  if (view !== want) { view.parentNode.replaceChild(want, view); want.id = 'game'; view = want; view.tabIndex = 0; view.focus(); }
}
view.tabIndex = 0;
var AT = self.ATLAS;
var img = new Image();
var ready = false;
img.onload = function () { ready = true; };
img.src = 'img/atlas.png?v=108';
var logo = new Image();
var logoOk = false;
logo.onload = function () { logoOk = true; };
logo.src = 'img/logo.png?v=108';
var clockImg = new Image();
var clockOk = false;
clockImg.onload = function () { clockOk = true; };
clockImg.src = 'img/clock.png?v=108';
var CLOCK_CX = 154.7, CLOCK_CY = 170.3;   // hub position inside clock.png

// ---------- helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function sh(n, w) { var a = AT[n]; w = Math.min(w, a[2] * 1.3); return a[3] * w / a[2]; }
function spr(n, x, y, w, o) {
  var a = AT[n]; if (!a) return;
  if (w > a[2] * 1.3) w = a[2] * 1.3;   // never enlarge a sprite much: it loses definition
  var h = a[3] * w / a[2];
  ctx.save();
  ctx.translate(x, y);
  if (o) {
    if (o.rot) ctx.rotate(o.rot);
    if (o.flip) ctx.scale(-1, 1);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;
  }
  ctx.drawImage(img, a[0], a[1], a[2], a[3], -w / 2, -h / 2, w, h);
  ctx.restore();
}
function txt(s, x, y, size, color, align) {
  ctx.font = 'bold ' + size + 'px "Courier New", monospace';
  ctx.textAlign = align || 'left';
  ctx.fillStyle = color || '#fff';
  ctx.fillText(s, x, y);
}
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

// ---------- globals outside the snapshot ----------
var G = {
  mode: 'title',      // title | play | pause | over | win
  rw: 3,              // rewinds left for the current level
  rewinding: null,
  rwFlash: 0,
  hi: parseInt(store('rw16:hi') || '0', 10) || 0,
  time: 0,
  ai: null,
  msg: '', msgT: 0
};
var S = null;         // current state
var LV = [];          // current level script
var snaps = [];
var snapAcc = 0;
var keys = {};
var ptr = { down: false, x: 0, y: 0, active: false };

function newAI() { return { hist: new Array(12).fill(0), fire: 0, samples: 0, mode: 'SCANNING', share: 0, peak: 6 }; }

var LEVELS = [
  { name: 'OUTER RIM DRIFT', sp: 70, top: '#04061a', bot: '#0c1650', star: '#bfe4ff' },
  { name: 'THE HIVE NEBULA', sp: 80, top: '#14031c', bot: '#34094a', star: '#ffc6f5' },
  { name: 'CHRONOS STATION', sp: 90, top: '#03050b', bot: '#101a34', star: '#a8ffee' }
];

// static starfield and parallax decor (functions of S.scroll only)
var stars = [];
(function () {
  var r = mulberry32(99);
  for (var l = 0; l < 3; l++) for (var i = 0; i < 55; i++) stars.push({ x: r() * W, y: r() * H, l: l, b: 0.4 + r() * 0.6 });
})();
var DECOR = [
  [ // level 1
    { sp: 'nebula', x: 90, w: 220, off: 100, f: 0.05, a: 0.35 }, { sp: 'planet', x: 380, w: 130, off: 900, f: 0.07, a: 1 },
    { sp: 'cloud0', x: 300, w: 420, off: 1500, f: 0.06, a: 0.28 }, { sp: 'moon1', x: 60, w: 55, off: 1900, f: 0.09, a: 1 },
    { sp: 'cloud3', x: 150, w: 300, off: 500, f: 0.06, a: 0.25 }, { sp: 'nebula', x: 400, w: 200, off: 1250, f: 0.05, a: 0.3 }
  ],
  [ // level 2
    { sp: 'cloud0', x: 240, w: 480, off: 200, f: 0.06, a: 0.3 }, { sp: 'cloud1', x: 120, w: 230, off: 800, f: 0.06, a: 0.3 },
    { sp: 'cloud2', x: 380, w: 240, off: 1400, f: 0.06, a: 0.28 }, { sp: 'cloud3', x: 90, w: 300, off: 500, f: 0.06, a: 0.25 },
    { sp: 'moon2', x: 420, w: 50, off: 1700, f: 0.08, a: 1 },
    // vines lying sideways, far away (background only)
    { sp: 'vine', x: 130, w: 62, off: 350, f: 0.09, a: 0.32, rot: Math.PI / 2 }, { sp: 'vine', x: 350, w: 56, off: 1350, f: 0.08, a: 0.28, rot: -Math.PI / 2 }, { sp: 'nebula', x: 200, w: 250, off: 1100, f: 0.05, a: 0.3 }
  ],
  [ // level 3
    { sp: 'cloud3', x: 250, w: 280, off: 700, f: 0.06, a: 0.14 },
    { sp: 'cloud1', x: 120, w: 200, off: 1800, f: 0.06, a: 0.14 }, { sp: 'moon2', x: 400, w: 55, off: 200, f: 0.08, a: 1 }
  ]
];

// ---------- difficulty ----------
// level transition: ship flies in at the start; at the end it leaves upwards and jumps to hyperspace
var ENTRY = 1.1, EXIT_AT = 1.6, WARP_AT = 2.2, FLASH_AT = 4.0, NEXT_AT = 4.6;
function warpAmt() {                 // 0..1: how stretched the stars are
  if (G.mode === 'win') return 0;
  if (S.clear) return Math.pow(clamp((S.clear - WARP_AT) / (FLASH_AT - WARP_AT), 0, 1), 2);
  if (S.t < 0.9) return Math.pow(1 - S.t / 0.9, 2);
  return 0;
}
var DIFF = { spd: 1.4, fire: 0.45, bullet: 1.3, dmg: 1.4 };   // + damage multiplier of enemy bullets   // enemy speed, fire interval and bullet speed multipliers

// ---------- level scripts ----------
function genLevel(n) {
  var r = mulberry32(1000 + n * 77);
  var R = function (a, b) { return a + r() * (b - a); };
  var I = function (a, b) { return Math.floor(R(a, b + 1)); };
  var ev = [];
  var dropCycle = ['S', 'P', 'D', 'H', 'S', 'D'], dc = 0;   // P and H are the rarest
  function add(t, spec) { spec.t = t; ev.push(spec); return spec; }
  function en(t, spec) {
    spec.k = 'en';
    if (spec.sp !== 'sp_capsule') {
      var sm = spec.big ? 1 : DIFF.spd + 0.05 * (n - 1);
      if (spec.vy) spec.vy *= sm;
      if (spec.vx) spec.vx *= sm;
      if (spec.fire) spec.fire *= DIFF.fire;
    }
    if (!spec.drop && r() < 0.04) spec.drop = ['S', 'D', 'S', 'D', 'P', 'H'][I(0, 5)];
    return add(t, spec);
  }
  var smalls = n === 1 ? ['e_s0', 'e_s1', 'e_s2', 'e_s3', 'e_s4'] : n === 2 ? ['e_s5', 'e_s6', 'e_s7', 'e_s8', 'e_s9'] : ['e_s10', 'e_s11', 'e_s12', 'e_s13', 'e_s14'];
  var drs = n === 1 ? ['d0', 'd1', 'd2', 'd3'] : n === 2 ? ['d4', 'd5', 'd1', 'd2'] : ['d5', 'd6', 'd7', 'd8'];
  var meds = n === 1 ? ['e_m0', 'e_m2', 'e_m4'] : n === 2 ? ['e_m4', 'e_m6', 'e_m7'] : ['e_m3', 'e_m8', 'e_m0'];
  var learners = ['e_m1', 'e_m5', 'e_m3'];
  var shp = function () { return smalls[I(0, 4)]; };
  var shHp = n === 3 ? 4 : 3;
  var fireK = 'aim';

  var waves = {
    V: function (t) {
      var base = R(130, 350), s = shp(), py = R(150, 250);
      [0, -1, 1, -2, 2].forEach(function (o) {
        // descend as a V, then the wings peel off to the sides and dive
        en(t, { sp: s, w: 44, hp: shHp, x: base + o * 44, y: -30 - Math.abs(o) * 36, vy: 95, pat: 'vpeel', amp: 45, fr: 1.3, ph: 0, py: py, side: o < 0 ? -1 : o > 0 ? 1 : (r() < 0.5 ? -1 : 1), fire: R(2.6, 4), fk: fireK, score: 100 });
      });
    },
    Line: function (t) {
      var left = r() < 0.5, s = shp(), y = R(60, 150);
      for (var i = 0; i < 6; i++) en(t + i * 0.32, { sp: s, w: 42, hp: shHp, x: left ? -30 : W + 30, y: y, vx: left ? 150 : -150, vy: 30, pat: 'wave', amp: 55, fr: 3, ph: 0, dive: R(1.2, 2.2), fire: R(3, 5), fk: fireK, score: 100 });   // cross, then dive at the player
    },
    Column: function (t) {
      var x = R(80, 400), s = shp();
      for (var i = 0; i < 4; i++) en(t + i * 0.45, { sp: s, w: 44, hp: shHp, x: x, x0: x, y: -30, vy: 120, pat: 'sine', amp: clamp(Math.min(x - 40, W - 40 - x), 40, 90), fr: 2.4, ph: 0, fire: R(1.8, 2.8), fk: 'aim', score: 100 });   // snake: all follow the same path
    },
    Orbit: function (t) {
      var cx = R(150, 330), s = drs[I(0, 3)];
      for (var i = 0; i < 6; i++) en(t, { sp: s, w: 34, hp: 2, x: cx, y: -50, x0: cx, vy: 70, pat: 'orbit', amp: 58, fr: 2.4, sway: 70, ph: i * Math.PI / 3, fire: R(3.5, 5.5), fk: 'aim', score: 120 });
    },
    Med: function (t) {
      var s = meds[I(0, 2)];
      [130, 350].forEach(function (x, i) {
        en(t + i * 0.6, { sp: s, w: 66, hp: 8, x: x, y: -50, vy: 90, ty: R(90, 170), hold: 6, sw: 95, pat: 'stop', fire: 1.9, fk: 'spread3', score: 300 });
      });
    },
    Learn: function (t) {
      var c = 1 + (n > 2 ? 1 : 0);
      for (var i = 0; i < c; i++) en(t + i * 1.1, { sp: learners[I(0, 2)], w: 66, hp: 9, x: R(90, 390), y: -50, vy: 110, pat: 'learn', L: 1, fire: 2.2, fk: 'aim', score: 500 });
    },
    Jelly: function (t) {
      en(t, { sp: 'sp_jelly', w: 56, hp: 9, x: R(120, 360), y: -60, vy: 55, pat: 'sine', amp: 90, fr: 1.1, ph: 0, fire: 3.4, fk: 'ring8', score: 400 });
    },
    Worm: function (t) {
      en(t, { sp: 'm_worm', w: 46, hp: 11, x: R(120, 360), y: -80, vy: 70, pat: 'sine', amp: 100, fr: 0.9, ph: 0, fire: 2.4, fk: 'aim', score: 450 });
    },
    Loop: function (t) {
      // a file of ships comes down, each one loops the loop at the same spot, then leaves diagonally
      var x = R(140, 340), s = shp(), dir = r() < 0.5 ? -1 : 1, ty = R(170, 260);
      for (var i = 0; i < 5; i++) en(t + i * 0.38, { sp: s, w: 42, hp: shHp, x: x, y: -30, vy: 150, pat: 'loop', ty: ty, rad: 65, dir: dir, fr: 4.2, fire: R(2.5, 3.5), fk: 'aim', score: 120 });
    },
    Zig: function (t) {
      // zig-zag descent with sharp turns
      var s = shp();
      for (var i = 0; i < 5; i++) en(t + i * 0.3, { sp: s, w: 42, hp: shHp, x: 60 + i * 90, y: -30 - i * 10, vy: 105, vx: (i % 2 ? 1 : -1) * 170, pat: 'zig', zt: 0.5, fire: R(2.4, 3.6), fk: fireK, score: 110 });
    },
    Ufo: function (t) {
      for (var i = 0; i < 3; i++) en(t + i * 0.7, { sp: 'sp_ufo', w: 56, hp: 6, x: 90 + i * 150, y: -40, vy: 100, pat: 'sine', amp: 60, fr: 1.8, ph: i, fire: 2.2, fk: 'spread3', score: 300 });
    }
  };
  var seq = n === 1 ? ['V', 'Line', 'Loop', 'Column', 'Orbit', 'Zig', 'V', 'Med', 'Learn', 'Loop', 'Line', 'Orbit', 'Zig', 'Column', 'Learn']
    : n === 2 ? ['V', 'Jelly', 'Loop', 'Line', 'Learn', 'Zig', 'Worm', 'Orbit', 'Med', 'Column', 'Loop', 'Learn', 'Jelly', 'Zig', 'Line', 'Worm']
    : ['Line', 'Ufo', 'Loop', 'Learn', 'Zig', 'Orbit', 'Med', 'Jelly', 'Loop', 'Learn', 'V', 'Ufo', 'Zig', 'Column', 'Learn', 'Med'];
  var dur = n === 3 ? 58 : 66;
  var gap = n === 1 ? 2.9 : n === 2 ? 2.6 : 2.3;
  var t = 3, k = 0;
  while (t < dur) { waves[seq[k % seq.length]](t); k++; t += gap + R(-0.5, 0.8); }

  // capsules carrying power-ups
  for (t = 9; t < dur; t += 17) {
    en(t, { sp: 'sp_capsule', w: 28, hp: 4, x: R(80, 400), y: -50, vy: 60, pat: 'evade', fire: 0, fk: 'down', score: 200, drop: dropCycle[dc++ % dropCycle.length] });
  }

  // obstacles (scroll with the background)
  function ob(t, spec) { spec.k = 'ob'; return add(t, spec); }
  function turret(t, x, plat, kind) {
    // mounted on top of a platform spawned at the same time
    add(t, { k: 'tu', x: x, y: plat.y0 - sh(plat.sp, plat.w) / 2 + 12, kind: kind });
  }
  var tks = n === 2 ? ['red', 'green'] : ['red', 'green', 'blue', 'purple', 'laser'];
  for (t = 5; t < dur - 3; t += R(2.1, 3.5)) {
    var q = r();
    if (n === 1) {
      if (q < 0.8) {
        var an = 'ast' + I(0, 7), nat = AT[an][2], cnt = nat < 60 ? I(2, 3) : 1;
        for (var ci = 0; ci < cnt; ci++) {
          var w = Math.round(nat * R(0.75, 1.1));
          ob(t + ci * 0.5, { sp: an, w: w, hp: w > 90 ? 14 : w > 55 ? 8 : 3, hs: 0.7, x: R(w / 2, W - w / 2), drop: r() < 0.015 ? 'H' : null, circ: 1, score: 50 });
        }
      }
      else ob(t, { sp: 'crystal', w: 70, hp: 6, hs: 0.65, x: R(60, 420), score: 100, drop: 'S' });
    } else if (n === 2) {
      if (q < 0.3) ob(t, { sp: 'isle0', w: 220, hp: 999, hs: 0.7, x: R(110, 370) });
      else if (q < 0.55) { var pl = ob(t, { sp: 'isle1', w: 100, hp: 999, hs: 0.7, x: R(60, 420) }); }
      else if (q < 0.7) ob(t, { sp: 'isle2', w: 70, hp: 999, hs: 0.7, x: R(40, 440) });
      else if (q < 0.8) ob(t, { sp: 'isle2', w: 70, hp: 999, hs: 0.7, x: R(40, 440) });
      else if (q < 0.9) ob(t, { sp: 'hive', w: 90, hp: 999, hs: 0.6, x: r() < 0.5 ? 50 : W - 50 });
      else ob(t, { sp: 'isle1', w: 100, hp: 999, hs: 0.7, x: R(60, 420) });
    } else {
      if (q < 0.3) { var px = R(130, 350), p1 = ob(t, { sp: 'plat1', w: 190, hp: 999, hs: 0.8, x: px }); p1.y0 = -sh('plat1', 190) / 2 - 10; }
      else if (q < 0.45) { var p0 = ob(t, { sp: 'plat0', w: 230, hp: 999, hs: 0.8, x: R(120, 360) }); p0.y0 = -sh('plat0', 230) / 2 - 10; }
      else {
        var os = 'o_container';
        ob(t, { sp: os, w: 60, hp: 999, hs: 0.8, x: R(40, 440) });
      }
    }
  }
  // mini bosses / final boss
  if (n === 1) en(dur + 2, { sp: 'e_b0', w: 150, hp: 230, x: 240, y: -120, vy: 70, pat: 'mini', fire: 1.5, fk: 'fan5', score: 3000, big: 1, drop: 'P' });
  else if (n === 2) en(dur + 2, { sp: 'e_b1', w: 140, hp: 340, x: 240, y: -120, vy: 70, pat: 'mini', fire: 1.4, fk: 'fan5', score: 4000, big: 1, drop: 'S' });
  else {
    en(34, { sp: 'e_b2', w: 150, hp: 130, x: 240, y: -120, vy: 70, pat: 'mini', fire: 1.3, fk: 'fan5', score: 5000, big: 1, drop: 'P' });
    add(dur + 6, { k: 'boss' });
  }
  ev.sort(function (a, b) { return a.t - b.t; });
  return ev;
}

// ---------- state ----------
function newState(n, carry) {
  var c = carry || {};
  return {
    lv: n, t: 0, scroll: 0, sp: LEVELS[n - 1].sp, ev: 0, nid: 1,
    rs: 12345 + n * 991, score: c.score || 0, shake: 0, clear: 0, kills: 0,
    p: { x: W / 2, y: 610, hp: c.hp || 100, w: c.w || 1, shield: 0, inv: 2, drones: c.drones || 0, ft: 0, mt: 0, dt: 0, dead: false, deadT: 0, hurt: 0, shHit: 0, tl: 0, vy: 0 },
    pb: [], eb: [], en: [], ob: [], tu: [], pk: [], fx: [], boss: null
  };
}
function rnd() {
  S.rs = S.rs + 0x6D2B79F5 | 0;
  var t = Math.imul(S.rs ^ S.rs >>> 15, 1 | S.rs);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function startLevel(n, carry) {
  if (!G.ai) G.ai = newAI();
  LV = genLevel(n);
  Music.level(n);
  S = newState(n, carry);
  snaps = []; snapAcc = 0; echoes = []; G.slowT = 0;
  G.rw = 3; G.rewinding = null; G.mode = 'play';
}
function startGame() {
  Amb.stop();
  G.ai = newAI();
  startLevel(1, null);
}

// ---------- spawning ----------
function spawn(e) {
  if (e.k === 'en') {
    var o = {};
    for (var k in e) o[k] = e[k];
    o.id = S.nid++; o.a = 0; o.f = (e.fire || 0) * (0.5 + rnd() * 0.8); o.maxhp = o.hp;
    o.x0 = e.x0 != null ? e.x0 : e.x; o.y0 = e.y; o.fl = 0; o.h = 0;
    o.w = Math.min(e.w, AT[e.sp][2] * 1.3);
    o.vx = e.vx || 0; o.vy = e.vy || 0; o.r = o.w * (e.sp === 'sp_capsule' ? 0.6 : 0.36);   // the capsule lies sideways: wider target
    S.en.push(o);
  } else if (e.k === 'ob') {
    var ow = Math.min(e.w, AT[e.sp][2] * 1.3), h = sh(e.sp, ow);
    S.ob.push({ id: S.nid++, sp: e.sp, x: e.x, y: -h / 2 - 10, w: ow, h: h, hs: e.hs || 0.7, hp: e.hp, circ: e.circ || 0, drop: e.drop, score: e.score || 0, flip: !!e.flip, fl: 0 });
  } else if (e.k === 'tu') {
    S.tu.push({ id: S.nid++, x: e.x, y: e.y, kind: e.kind, hp: 6, ft: 1 + rnd() * 2, fl: 0, w: 44 });
  } else if (e.k === 'boss') {
    S.boss = { x: 240, y: -230, hp: 380, maxhp: 380, a: 0, st: 'in', pl: { hp: 70 }, pr: { hp: 70 }, ft: 2, rt: 3, sf: 0, bs: 0, bt: 7, beam: 0, bx: 240, sm: 10, dying: 0, fl: 0, done: false, ph: 1 };
    S.alarm = 4.2; Sfx.alarm.start();
  }
}

function eb(x, y, vx, vy, sp, w, dm) {
  S.eb.push({ id: S.nid++, x: x, y: y, vx: vx * DIFF.bullet, vy: vy * DIFF.bullet, sp: sp || 'ebOrbO', w: w || 16, r: (w || 16) * 0.32, dm: Math.round((dm || 10) * DIFF.dmg) });
}
function aimAng(x, y) { return Math.atan2(S.p.y - y, S.p.x - x); }
function efire(e) {
  if (e.big || e.w >= 60) { Sfx.bigShot(); light(e.x, e.y + e.w * 0.3, 90, [255, 90, 160], 0.18, 0.8); } else Sfx.enemyShot();
  var a = aimAng(e.x, e.y), y = e.y + e.w * 0.25, i, sp;
  switch (e.fk) {
    case 'down': eb(e.x, y, 0, 210, 'ebOrbO', 16); break;
    case 'aim': eb(e.x, y, Math.cos(a) * 200, Math.sin(a) * 200, 'ebOrbB', 18); break;
    case 'spread3': for (i = -1; i <= 1; i++) eb(e.x, y, Math.cos(a + i * 0.32) * 190, Math.sin(a + i * 0.32) * 190, 'ebOrbO', 16); break;
    case 'ring8': for (i = 0; i < 8; i++) eb(e.x, e.y, Math.cos(i * Math.PI / 4) * 130, Math.sin(i * Math.PI / 4) * 130, 'ebPink', 14); break;
    case 'fan5': for (i = -2; i <= 2; i++) eb(e.x, y, Math.cos(a + i * 0.22) * 200, Math.sin(a + i * 0.22) * 200, 'ebOrbB', 20); break;
  }
}
function explode(x, y, size, delay) {
  S.fx.push({ k: 'exp', x: x, y: y, t: -(delay || 0), d: 0.55, s: size });
  light(x, y, size * 2.4, [255, 165, 70], 0.5, Math.min(1, 0.45 + size / 160), delay);
  if (size >= 100) shock(x, y, Math.min(260, size * 1.7), Math.min(1, size / 150), delay);
  if (size > 50) S.fx.push({ k: 'smoke', x: x, y: y, t: -(delay || 0) + 0.2, d: 0.9, s: size * 0.7 });
}
// Debris: the sprite is cut into a grid and the pieces fly away spinning (fx, rewound like the rest).
function debris(sp, x, y, w, n, flip) {
  var a = AT[sp]; if (!a) return;
  w = Math.min(w, a[2] * 1.3);
  var cols = n >= 9 ? 3 : 2, rows = n >= 9 ? 4 : n >= 6 ? 3 : 2, k = w / a[2], cells = [];
  for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) cells.push([c, r]);
  for (var i = 0; i < Math.min(n, cells.length); i++) {
    var j = Math.floor(rnd() * cells.length), cl = cells.splice(j, 1)[0];
    var sw = a[2] / cols, shh = a[3] / rows;
    var ox = (cl[0] + 0.5) * sw - a[2] / 2, oy = (cl[1] + 0.5) * shh - a[3] / 2;
    if (flip) { ox = -ox; oy = -oy; }
    var ang = Math.atan2(oy, ox) + (rnd() - 0.5) * 0.8, v = 70 + rnd() * 150;
    S.fx.push({ k: 'deb', sp: sp, cx: cl[0] * sw, cy: cl[1] * shh, sw: sw, sh: shh, sc: k, flip: flip,
      x: x + ox * k, y: y + oy * k, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v + 30, r: rnd() * 6.28, vr: (rnd() - 0.5) * 12, t: 0, d: 0.55 + rnd() * 0.35 });
  }
}
// Glass shattering: the crystal sprite is broken into triangular shards (a fan of random wedges, each one cut out
// of the texture) that fly away spinning, catching the light; plus glitter and a cold flash.
function shatter(o) {
  var a = AT[o.sp], k = o.w / a[2], hw = o.w / 2, hh = o.h / 2, n = 16, base = rnd() * 6.28, pts = [];
  for (var i = 0; i < n; i++) {
    var an = base + (i + (rnd() - 0.5) * 0.6) / n * 6.2832, rr = 0.75 + rnd() * 0.5;
    pts.push([Math.cos(an) * hw * 1.2 * rr, Math.sin(an) * hh * 1.2 * rr]);
  }
  var cx0 = (rnd() - 0.5) * hw * 0.3, cy0 = (rnd() - 0.5) * hh * 0.3;
  for (i = 0; i < n; i++) {
    var p1 = pts[i], p2 = pts[(i + 1) % n];
    // split each wedge in two along a random point, so the pieces are smaller and more irregular
    var m = 0.35 + rnd() * 0.3, mx = cx0 + (p1[0] + p2[0]) / 2 * m, my = cy0 + (p1[1] + p2[1]) / 2 * m;
    [[[cx0, cy0], [mx, my], p1], [[mx, my], p1, p2], [[cx0, cy0], [mx, my], p2]].forEach(function (tri) {
      var gx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, gy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      var ang = Math.atan2(gy, gx), v = 60 + rnd() * 170 + Math.hypot(gx, gy) * 1.5;
      S.fx.push({ k: 'shard', sp: o.sp, sc: k, ox: gx, oy: gy, tri: tri.map(function (q) { return [q[0] - gx, q[1] - gy]; }),
        x: o.x + gx, y: o.y + gy, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, r: 0, vr: (rnd() - 0.5) * 10, t: 0, d: 0.7 + rnd() * 0.5, gl: rnd() * 6.28 });
    });
  }
  for (i = 0; i < 26; i++) {
    var ga = rnd() * 6.28, gv = 80 + rnd() * 260;
    S.fx.push({ k: 'glit', x: o.x, y: o.y, vx: Math.cos(ga) * gv, vy: Math.sin(ga) * gv, t: 0, d: 0.4 + rnd() * 0.6, s: 1 + rnd() * 2.5, ph: rnd() * 6.28 });
  }
  light(o.x, o.y, o.w * 2.6, [140, 220, 255], 0.45, 0.9);
  shock(o.x, o.y, o.w * 1.3, 0.35);
}
// smoke puff (damaged enemies, missile trails)
function puff(x, y, s, d, vx, vy) { S.fx.push({ k: 'puff', x: x, y: y, s: s, d: d, vx: vx || 0, vy: vy || 0, t: 0, n: Math.floor(rnd() * 3) }); }
// dynamic light (fx, so it is rewound with the rest of the state)
function light(x, y, r, col, d, i, delay) { S.fx.push({ k: 'light', x: x, y: y, r: r, c: col, d: d, i: i, t: -(delay || 0) }); }
// shockwave ring that refracts the scene behind it
function shock(x, y, r, s, delay) { S.fx.push({ k: 'shock', x: x, y: y, r: r, s: s, d: 0.6, t: -(delay || 0) }); }
function spark(x, y, n) {
  for (var i = 0; i < n; i++) {
    var a = rnd() * 6.28, v = 60 + rnd() * 140;
    S.fx.push({ k: 'sp', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, d: 0.3 + rnd() * 0.2 });
  }
}
function dropPickup(x, y, k) { S.pk.push({ x: x, y: y, k: k, a: 0 }); }

// ---------- player ----------
function hurt(d, cont) {
  var p = S.p;
  if (p.dead || S.clear) return;
  if (!cont) { if (p.inv > 0) return; p.inv = 0.7; }
  if (p.shield > 0) { p.shHit = 0.4; p.shield -= d; if (p.shield < 0) { d = -p.shield; p.shield = 0; } else d = 0; }
  if (d > 0) { p.hp -= d; p.hurt = 0.4; S.shake = Math.max(S.shake, cont ? 2 : 6); }
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deadT = 0;
    slowMo(0.4); debris('player0', p.x, p.y, 58, 6, false);
    Sfx.explosion();
    explode(p.x, p.y, 110); explode(p.x - 14, p.y + 10, 60, 0.1); explode(p.x + 16, p.y - 8, 60, 0.2);
    S.shake = 14;
  }
}
function pb(x, y, vx, vy, sp, w, dm, o) {
  var b = { id: S.nid++, x: x, y: y, vx: vx, vy: vy, sp: sp, w: w, dm: dm, r: w * 0.5, hm: 0, pierce: 0, hit: [] };
  if (o) for (var k in o) b[k] = o[k];
  S.pb.push(b);
}
function playerFire() {
  var p = S.p, x = p.x, y = p.y - 26, lv = p.w;
  (lv === 1 ? Sfx.weapon1 : Sfx.weapon2)();
  // muzzle flashes, attached to the ship (offsets from its position)
  var mz = lv === 1 ? [[0, -26]] : lv === 2 ? [[-9, -26], [9, -26]] : lv < 5 ? [[0, -28], [-12, -22], [12, -22]] : [[0, -28], [-12, -22], [12, -22], [-22, -18], [22, -18]];
  for (var mi = 0; mi < mz.length; mi++) S.fx.push({ k: 'mz', ox: mz[mi][0], oy: mz[mi][1], t: 0, d: 0.07, s: lv >= 3 ? 15 : 11, c: mi > 0 && lv >= 3 && mi < 3 ? '120,255,150' : '120,210,255' });
  if (lv === 1) pb(x, y, 0, -640, 'bLaserS', 9, 1);
  else if (lv === 2) { pb(x - 9, y, 0, -640, 'bLaserS', 9, 1); pb(x + 9, y, 0, -640, 'bLaserS', 9, 1); }
  else if (lv >= 3) {
    pb(x, y, 0, -660, 'bLaserS', 9, 1);
    pb(x - 12, y + 4, -80, -620, 'bGreen', 12, 1); pb(x + 12, y + 4, 80, -620, 'bGreen', 12, 1);
    if (lv >= 5) { pb(x - 22, y + 8, -30, -640, 'bLaserS', 9, 1); pb(x + 22, y + 8, 30, -640, 'bLaserS', 9, 1); }
  }
  if (lv >= 4) {
    p.mt -= 0.16;
    if (p.mt <= 0) {
      p.mt = 0.55;
      pb(x - 20, p.y, -40, -300, 'bMissile', 12, 3, { hm: 1, r: 8 }); pb(x + 20, p.y, 40, -300, 'bMissile', 12, 3, { hm: 1, r: 8 });
    }
  }
  if (lv >= 5) { p.dt -= 0.16; if (p.dt <= 0) { p.dt = 0.45; pb(x, y - 10, 0, -520, 'bPlasmaBig', 24, 4, { pierce: 1, r: 12 }); } }
  for (var i = 0; i < p.drones; i++) pb(x + (i ? 44 : -44), p.y + 6, 0, -600, 'bLaserS', 8, 1);
}
function updatePlayer(dt) {
  var p = S.p, sp = 285, mx = 0, my = 0, ox = p.x, oy = p.y;
  if (S.t < ENTRY || S.clear > EXIT_AT) {
    // autopilot: fly in from below at the start of a level, fly out upwards at the end
    if (S.t < ENTRY) { var u = S.t / ENTRY, e = 1 - Math.pow(1 - u, 3); p.y = H + 70 - (H + 70 - 610) * e; p.x += (W / 2 - p.x) * Math.min(1, dt * 4); }
    else { p.ax = (p.ax || 0) + dt * 1100; p.x += (W / 2 - p.x) * Math.min(1, dt * 3); p.y -= p.ax * dt; }
    p.tl += (clamp((p.x - ox) / dt / sp, -1, 1) - p.tl) * Math.min(1, dt * 9);
    p.vy = S.t < ENTRY ? -285 : (p.y - oy) / dt;
    if (p.hurt > 0) p.hurt -= dt;
    if (p.shHit > 0) p.shHit -= dt;
    G.firing = false;
    return;
  }
  if (keys.ArrowLeft || keys.KeyA) mx -= 1;
  if (keys.ArrowRight || keys.KeyD) mx += 1;
  if (keys.ArrowUp || keys.KeyW) my -= 1;
  if (keys.ArrowDown || keys.KeyS) my += 1;
  if (mx && my) { mx *= 0.7071; my *= 0.7071; }
  p.x += mx * sp * dt; p.y += my * sp * dt;
  if (ptr.active) {
    var dx = ptr.x - p.x, dy = (ptr.y - 70) - p.y, d = Math.hypot(dx, dy);
    if (d > 1) { var s = Math.min(d, 520 * dt); p.x += dx / d * s; p.y += dy / d * s; }
  }
  p.x = clamp(p.x, 22, W - 22); p.y = clamp(p.y, 70, H - 40);
  // smoothed banking (tilt) and vertical speed, used only for drawing
  p.tl += (clamp((p.x - ox) / dt / sp, -1, 1) - p.tl) * Math.min(1, dt * 9);
  p.vy = (p.y - oy) / dt;
  if (p.inv > 0) p.inv -= dt;
  if (p.hurt > 0) p.hurt -= dt;
  if (p.shHit > 0) p.shHit -= dt;
  var firing = !!(keys.Space || ptr.down);
  G.firing = firing;
  p.ft -= dt;
  if (firing && p.ft <= 0 && !S.clear) { p.ft = 0.16; playerFire(); }
}

// ---------- learning AI ----------
function updateAI(dt) {
  var ai = G.ai, p = S.p, i, sum = 0, pk = 0;
  var dec = Math.pow(0.5, dt / 6);
  for (i = 0; i < 12; i++) ai.hist[i] *= dec;
  ai.hist[clamp(Math.floor(p.x / W * 12), 0, 11)] += dt;
  ai.fire += ((G.firing ? 1 : 0) - ai.fire) * Math.min(1, dt / 3.5);
  for (i = 0; i < 12; i++) { sum += ai.hist[i]; if (ai.hist[i] > ai.hist[pk]) pk = i; }
  ai.samples += dt; ai.peak = pk; ai.share = sum > 0 ? ai.hist[pk] / sum : 0;
  ai.mode = (ai.share > 0.4 && sum > 1.5) ? 'HUNTING' : (ai.fire > 0.55 ? 'DODGING' : 'SCANNING');
}

// ---------- enemies ----------
function updateEnemy(e, dt) {
  var ai = G.ai, i, ox = e.x;
  e.a += dt;
  if (e.fl > 0) e.fl -= dt;
  switch (e.pat) {
    case 'line': e.y += e.vy * dt; e.x += e.vx * dt; break;
    case 'sine': e.y += e.vy * dt; e.x = e.x0 + Math.sin(e.a * e.fr + e.ph) * e.amp; break;
    case 'wave':
      if (e.dive && e.a > e.dive && !e.dv) {   // break off and dive at where the player is now
        var da = aimAng(e.x, e.y), dsp = 250 * DIFF.spd;
        e.dv = 1; e.vx = Math.cos(da) * dsp; e.vy = Math.max(120, Math.sin(da) * dsp);
      }
      if (e.dv) { e.x += e.vx * dt; e.y += e.vy * dt; }
      else { e.x += e.vx * dt; e.y0 += e.vy * dt; e.y = e.y0 + Math.sin(e.a * e.fr + e.ph) * e.amp; }
      break;
    case 'vpeel':
      e.y += e.vy * dt;
      if (e.y < e.py) e.x = e.x0 + Math.sin(e.a * e.fr + e.ph) * e.amp;
      else { e.pv = (e.pv || 0) + 320 * dt; e.x += e.side * e.pv * dt; e.y += e.pv * 0.35 * dt; }
      break;
    case 'loop':
      if (!e.lp) {
        e.y += e.vy * dt;
        if (e.y >= e.ty) { e.lp = 1; e.la = 0; e.lcx = e.x + e.dir * e.rad; e.lcy = e.y; }
      } else if (e.lp === 1) {
        // full circle around (lcx, lcy), starting from the point we arrived at
        e.la += e.fr * dt;
        var a0 = e.dir > 0 ? Math.PI : 0, an2 = a0 - e.dir * e.la;
        e.x = e.lcx + Math.cos(an2) * e.rad; e.y = e.lcy + Math.sin(an2) * e.rad;
        if (e.la >= 6.2832) { e.lp = 2; e.vx = e.dir * 160 * DIFF.spd; }
      } else { e.x += e.vx * dt; e.y += e.vy * dt; }
      break;
    case 'evade':
      // power-up capsule: jinks sideways at random moments, sometimes stops or backs up a little
      e.jt = (e.jt || 0) - dt;
      if (e.jt <= 0) {
        e.jt = 0.6 + rnd() * 0.8;
        var dir2 = rnd() < 0.5 ? -1 : 1;
        if (e.x < 70) dir2 = 1; else if (e.x > W - 70) dir2 = -1;
        e.tvx = dir2 * (70 + rnd() * 90); e.tvy = rnd() < 0.2 && e.y > 120 ? -25 : 45 + rnd() * 45;   // backs up only once well on screen
      }
      e.vx += ((e.tvx || 0) - e.vx) * Math.min(1, dt * 4);
      e.cvy = (e.cvy == null ? e.vy : e.cvy) + ((e.tvy == null ? e.vy : e.tvy) - (e.cvy == null ? e.vy : e.cvy)) * Math.min(1, dt * 5);
      e.x = clamp(e.x + e.vx * dt, 25, W - 25); e.y += e.cvy * dt;
      break;
    case 'zig':
      e.zc = (e.zc || 0) + dt;
      if (e.zc > e.zt || e.x < 30 || e.x > W - 30) { e.zc = 0; e.vx = -e.vx; e.x = clamp(e.x, 30, W - 30); }
      e.x += e.vx * dt; e.y += e.vy * dt;
      break;
    case 'orbit': {
      var cy = e.y0 + e.vy * e.a, an = e.ph + e.a * e.fr, cx = e.x0 + Math.sin(e.a * 0.9) * (e.sway || 0);
      e.x = cx + Math.cos(an) * e.amp; e.y = cy + Math.sin(an) * e.amp * 0.6; break;
    }
    case 'stop':
      if (e.y < e.ty && !e.h) e.y += e.vy * dt;
      else { e.h += dt; e.x = clamp(e.x0 + Math.sin(e.h * 1.4) * (e.sw || 40), 40, W - 40); if (e.h > e.hold) e.y += e.vy * 1.4 * dt; }
      break;
    case 'mini':
      if (e.y < 110 && !e.arr) e.y += e.vy * dt; else e.arr = 1;
      if (e.arr) {
        // follow the hover path smoothly (setting the position directly made it jump on arrival)
        e.ma = (e.ma || 0) + dt;
        var mtx = 240 + Math.sin(e.ma * 0.75) * 130, mty = 110 + Math.sin(e.ma * 1.3) * 18, mk = Math.min(1, dt * 3);
        e.x += (mtx - e.x) * mk; e.y += (mty - e.y) * mk; e.rt = (e.rt == null ? 3 : e.rt) - dt; if (e.rt <= 0) { e.rt = 3; var ro = e.ma * 0.7; for (i = 0; i < 18; i++) eb(e.x, e.y, Math.cos(i * 0.349 + ro) * 140, Math.sin(i * 0.349 + ro) * 140, 'ebPink', 14); } }
      break;
    case 'learn': {
      var mode = ai.mode;
      if (e.y < 100 && !e.dv) { e.y += e.vy * dt; break; }
      if (mode === 'HUNTING') {
        if (!e.dv) {
          e.lt = (e.lt || 0) + dt;
          e.x += clamp((ai.peak * W / 12 + W / 24) - e.x, -120, 120) * dt;  // slide above the learned hot spot
          if (e.lt > 0.7) { e.dv = 1; var tx = clamp(0.5 * (ai.peak * W / 12 + W / 24) + 0.5 * S.p.x, 30, W - 30); e.vx = (tx - e.x) / 0.9; e.vy = 270 * DIFF.spd; }
        } else { e.x += e.vx * dt; e.y += e.vy * dt; }
      } else if (mode === 'DODGING') {
        e.y += 70 * DIFF.spd * dt;
        if (e.dg > 0) e.dg -= dt;
        else {
          for (i = 0; i < S.pb.length; i++) {
            var b = S.pb[i];
            if (b.y > e.y && b.y - e.y < 260 && Math.abs(b.x - e.x) < e.w * 0.5 + 12) { e.dvx = (b.x > e.x ? -1 : 1) * 230; if (e.x < 60) e.dvx = 230; if (e.x > W - 60) e.dvx = -230; e.dg = 0.45; e.dmv = 0.28; break; }
          }
        }
        if (e.dmv > 0) { e.dmv -= dt; e.x += e.dvx * dt; }
      } else {   // scanning: weave, easing towards the path so a change of mode does not teleport the ship
        e.y += 85 * DIFF.spd * dt;
        var stx = clamp(e.x0 + Math.sin(e.a * 2) * 100, 30, W - 30);
        e.x += clamp(stx - e.x, -260 * dt, 260 * dt);
      }
      e.x = clamp(e.x, 20, W - 20);
      break;
    }
  }
  // badly damaged big/medium enemies trail smoke and sparks
  if ((e.big || e.w >= 60) && e.hp < e.maxhp / 3 && e.y > -20) {
    e.smk = (e.smk || 0) - dt;
    if (e.smk <= 0) {
      e.smk = 0.07;
      var ox2 = (rnd() - 0.5) * e.w * 0.5, oy2 = (rnd() - 0.5) * e.w * 0.3;
      puff(e.x + ox2, e.y + oy2, 18 + rnd() * 12, 0.8, (rnd() - 0.5) * 20, -30 - rnd() * 30);
      if (rnd() < 0.35) spark(e.x + ox2, e.y + oy2, 2);
    }
  }
  // smoothed banking from the horizontal speed (drawing only)
  e.tl = (e.tl || 0) + (clamp((e.x - ox) / Math.max(dt, 1e-3) / 160, -1, 1) - (e.tl || 0)) * Math.min(1, dt * 6);
  if (e.fire && e.y > 10 && e.y < H - 110) {
    e.f -= dt;
    if (e.f <= 0) { e.f = e.fire * (0.8 + rnd() * 0.5); efire(e); }
  }
}
function slowMo(d) { if (!(G.slowT > d * 0.5)) { G.slowT = d; G.slowD = d; } }
function killEnemy(e) {
  S.score += e.score || 100; S.kills++;
  Sfx.enemyExp(!!e.big);
  explode(e.x, e.y, e.big ? 130 : e.w * 1.2);
  if (e.big) { slowMo(0.45); explode(e.x - 30, e.y + 20, 70, 0.15); explode(e.x + 30, e.y - 20, 70, 0.3); S.shake = 10; }
  if (e.drop) dropPickup(e.x, e.y, e.drop);
}

// ---------- boss ----------
function updateBoss(dt) {
  var b = S.boss, p = S.p, i;
  if (!b) return;
  b.a += dt; if (b.fl > 0) b.fl -= dt;
  if (b.st === 'in') { b.y += 60 * dt; if (b.y >= 135) b.st = 'fight'; return; }
  if (b.st === 'die') {
    b.dying += dt;
    if (Math.random() < dt * 9) { explode(b.x + (Math.random() - 0.5) * 160, b.y + (Math.random() - 0.5) * 200, 50 + Math.random() * 50); Sfx.enemyExp(false); }
    S.shake = 5;
    if (b.dying > 3.2 && !b.done) { b.done = true; slowMo(0.7); Sfx.enemyExp(true); explode(b.x, b.y, 260); S.shake = 16; S.score += 15000; S.clear = 0.001; }
    return;
  }
  var pods = (b.pl.hp > 0 ? 1 : 0) + (b.pr.hp > 0 ? 1 : 0);
  var ph = pods > 0 ? 1 : 2;
  if (b.hp < b.maxhp / 3) {
    b.smk = (b.smk || 0) - dt;
    if (b.smk <= 0) { b.smk = 0.05; var bx2 = b.x + (rnd() - 0.5) * 140, by2 = b.y + (rnd() - 0.5) * 120; puff(bx2, by2, 26 + rnd() * 20, 1, (rnd() - 0.5) * 20, -40); if (rnd() < 0.4) spark(bx2, by2, 3); }
  }
  if (ph === 2 && b.ph === 1) { b.ph = 2; G.msg = 'GUARDIAN ENRAGED'; G.msgT = 2.5; S.shake = 8; explode(b.x - 110, b.y + 30, 70); explode(b.x + 110, b.y + 30, 70); }
  var tx = b.beam ? b.bx : 240 + Math.sin(b.a * (ph === 1 ? 0.45 : 0.7)) * 120;
  b.x += clamp(tx - b.x, -140, 140) * Math.min(1, dt * 2);
  b.y += (135 + Math.sin(b.a * 1.1) * 12 - b.y) * Math.min(1, dt * 3);
  // pods
  b.ft -= dt;
  if (b.ft <= 0) {
    b.ft = ph === 1 ? 1.5 : 2.4;
    Sfx.bigShot();
    [[b.pl, -112], [b.pr, 112]].forEach(function (q) {
      if (q[0].hp <= 0) return;
      var px = b.x + q[1], py = b.y + 30, a = aimAng(px, py);
      eb(px, py, Math.cos(a - 0.1) * 215, Math.sin(a - 0.1) * 215, 'ebOrbB', 20); eb(px, py, Math.cos(a + 0.1) * 215, Math.sin(a + 0.1) * 215, 'ebOrbB', 20);
    });
    if (ph === 2) { var a2 = aimAng(b.x, b.y); for (i = -2; i <= 2; i++) eb(b.x, b.y + 50, Math.cos(a2 + i * 0.2) * 210, Math.sin(a2 + i * 0.2) * 210, 'ebOrbO', 18); }
  }
  b.rt -= dt;
  if (b.rt <= 0) { b.rt = ph === 1 ? 4.5 : 3.4; Sfx.bigShot(); var n = ph === 1 ? 12 : 16; for (i = 0; i < n; i++) eb(b.x, b.y + 20, Math.cos(i * 6.2832 / n + b.a) * 135, Math.sin(i * 6.2832 / n + b.a) * 135, 'ebPink', 15); }
  if (ph === 2) {
    if (Math.sin(b.a * 0.8) > 0.2) { b.sf -= dt; if (b.sf <= 0) { b.sf = 0.16; b.bs += 0.5; eb(b.x, b.y + 30, Math.cos(b.bs) * 150, Math.sin(b.bs) * 150 + 40, 'ebOrbO', 15); } }
    b.bt -= dt;
    if (b.beam === 0 && b.bt <= 0) { b.beam = 1; b.bx = clamp(p.x, 60, W - 60); b.bTimer = 1.2; }
    else if (b.beam === 1) { b.bTimer -= dt; if (b.bTimer <= 0) { b.beam = 2; b.bTimer = 1.6; S.shake = 5; } }
    else if (b.beam === 2) {
      b.bTimer -= dt;
      if (Math.abs(p.x - b.x) < 24 && p.y > b.y) hurt(34 * dt, true);
      if (b.bTimer <= 0) { b.beam = 0; b.bt = 8; }
    }
    b.sm -= dt;
    if (b.sm <= 0) { b.sm = 12; for (i = 0; i < 4; i++) spawn({ k: 'en', sp: 'd' + (5 + i), w: 34, hp: 2, x: b.x, y: b.y + 40, x0: b.x, vy: 80, pat: 'orbit', amp: 50, fr: 2.6, ph: i * 1.57, fire: 3, fk: 'aim', score: 150 }); }
  }
  // contact with player
  if (!p.dead && Math.hypot(p.x - b.x, (p.y - b.y) * 0.8) < 70) { Sfx.scrape(); hurt(20); }
}

// ---------- main update ----------
// Player hitbox: an ellipse over the drawn hull (the hull is drawn 9 px above p.y: its exhaust was cropped off).
// Swept test: the bullet is checked along the segment it travelled this frame, so fast bullets cannot jump over it.
function shipHit(x, y, r, px0, py0) {
  var p = S.p, cx = p.x, cy = p.y - 9, rx = 21 + r, ry = 21 + r;
  var n = px0 == null ? 1 : 3;
  for (var k = 0; k < n; k++) {
    var f = n === 1 ? 1 : k / (n - 1), sx = n === 1 ? x : px0 + (x - px0) * f, sy = n === 1 ? y : py0 + (y - py0) * f;
    var dx = (sx - cx) / rx, dy = (sy - cy) / ry;
    if (dx * dx + dy * dy < 1) return true;
  }
  return false;
}
function circRect(cx, cy, r, rx, ry, rw, rh) {
  var nx = clamp(cx, rx - rw / 2, rx + rw / 2), ny = clamp(cy, ry - rh / 2, ry + rh / 2);
  var dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}
function obBox(o) { return o.circ ? [o.w * o.hs, o.h * o.hs] : [o.w * o.hs, o.h * o.hs]; }

function damageObstacle(o, d) {
  if (o.hp > 500) return false;
  o.hp -= d; o.fl = 0.08;
  if (o.hp <= 0) { if (o.sp === 'crystal') Sfx.shatter(); else if (o.sp.indexOf('ast') === 0) Sfx.boom(o.w); S.score += o.score || 0; if (o.sp === 'crystal') shatter(o); else explode(o.x, o.y, o.w * 1.1); if (o.drop) dropPickup(o.x, o.y, o.drop); return true; }
  return false;
}

function update(dt) {
  var s = S, p = s.p, i, j;
  s.t += dt; s.scroll += s.sp * dt * (1 + 28 * warpAmt());   // the background races past during the jump
  if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 30);
  if (s.alarm > 0) { s.alarm -= dt; if (s.alarm <= 0) Sfx.alarm.stop(); }
  while (s.ev < LV.length && LV[s.ev].t <= s.t) { spawn(LV[s.ev]); s.ev++; }

  if (!p.dead) { updatePlayer(dt); updateAI(dt); recordEcho(dt); }
  else { p.deadT += dt; G.firing = false; if (p.deadT > 2.6 && G.mode === 'play') G.mode = 'over'; }

  // snapshots for the time rewind
  snapAcc += dt;
  if (snapAcc >= 0.1) { snapAcc -= 0.1; if (!p.dead) { snaps.push(structuredClone(s)); if (snaps.length > 90) snaps.shift(); } }

  // enemies
  for (i = s.en.length - 1; i >= 0; i--) {
    var e = s.en[i];
    updateEnemy(e, dt);
    if (e.y > H + 90 || e.x < -120 || e.x > W + 120 || e.y < -200) { s.en.splice(i, 1); continue; }
    if (!p.dead && shipHit(e.x, e.y, e.r * 0.85)) { Sfx.scrape(); hurt(15); e.hp -= 4; e.fl = 0.14; spark(e.x, e.y, 6); if (e.hp <= 0) { killEnemy(e); s.en.splice(i, 1); } }
  }
  updateBoss(dt);

  // obstacles
  for (i = s.ob.length - 1; i >= 0; i--) {
    var o = s.ob[i];
    o.y += s.sp * dt; if (o.fl > 0) o.fl -= dt;
    if (o.y - o.h / 2 > H + 20) { s.ob.splice(i, 1); continue; }
    if (!p.dead) {
      var bx = obBox(o), pr = 13;
      if (circRect(p.x, p.y + 4, pr, o.x, o.y, bx[0], bx[1])) {
        // push the ship out along the axis of least penetration
        var ox = (bx[0] / 2 + pr) - Math.abs(p.x - o.x), oy = (bx[1] / 2 + pr) - Math.abs(p.y + 4 - o.y);
        if (ox < oy) p.x += (p.x < o.x ? -1 : 1) * ox; else p.y += (p.y + 4 < o.y ? -1 : 1) * oy;
        p.x = clamp(p.x, 22, W - 22); p.y = clamp(p.y, 70, H - 40);
        Sfx.scrape(); hurt(18); spark(p.x, p.y, 8);
      }
    }
  }
  // turrets
  for (i = s.tu.length - 1; i >= 0; i--) {
    var t = s.tu[i];
    t.y += s.sp * dt; if (t.fl > 0) t.fl -= dt;
    if (t.y > H + 60) { s.tu.splice(i, 1); continue; }
    t.ft -= dt;
    if (t.ft <= 0 && t.y > 30 && t.y < H - 150 && !p.dead) {
      t.ft = 2.3; t.fl2 = 0.25; Sfx.enemyShot();
      var a = aimAng(t.x, t.y);
      if (t.kind === 'laser') eb(t.x, t.y, Math.cos(a) * 320, Math.sin(a) * 320, 'ebBigB', 22);
      else if (t.kind === 'purple') { for (j = 0; j < 3; j++) eb(t.x, t.y - j * 12, Math.cos(a) * 230, Math.sin(a) * 230, 'ebPink', 14); }
      else eb(t.x, t.y, Math.cos(a) * 215, Math.sin(a) * 215, 'ebOrbB', 18);
    }
    if (t.fl2 > 0) t.fl2 -= dt;
  }

  // player bullets
  for (i = s.pb.length - 1; i >= 0; i--) {
    var b = s.pb[i], dead = false;
    if (b.hm) {
      b.st = (b.st || 0) - dt; if (b.st <= 0) { b.st = 0.035; puff(b.x, b.y, 10, 0.5, 0, 0); }
      var best = null, bd = 1e9;
      for (j = 0; j < s.en.length; j++) { var q = s.en[j], d2 = (q.x - b.x) * (q.x - b.x) + (q.y - b.y) * (q.y - b.y); if (q.y < b.y && d2 < bd) { bd = d2; best = q; } }
      if (!best && s.boss && s.boss.st === 'fight') best = s.boss;
      if (best) {
        var ta = Math.atan2(best.y - b.y, best.x - b.x), ca = Math.atan2(b.vy, b.vx), df = ta - ca;
        while (df > Math.PI) df -= 6.2832; while (df < -Math.PI) df += 6.2832;
        ca += clamp(df, -5 * dt, 5 * dt);
        var spd = Math.min(560, Math.hypot(b.vx, b.vy) + 900 * dt);
        b.vx = Math.cos(ca) * spd; b.vy = Math.sin(ca) * spd;
      } else b.vy = Math.max(b.vy - 700 * dt, -520);
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < -40 || b.x < -40 || b.x > W + 40 || b.y > H + 40) { s.pb.splice(i, 1); continue; }
    // obstacles
    for (j = 0; j < s.ob.length && !dead; j++) {
      var ob = s.ob[j], bb = obBox(ob);
      if (circRect(b.x, b.y, b.r, ob.x, ob.y, bb[0], bb[1])) {
        if (damageObstacle(ob, b.dm)) s.ob.splice(j, 1);
        spark(b.x, b.y, 2); dead = true;
      }
    }
    // turrets
    for (j = 0; j < s.tu.length && !dead; j++) {
      var tt = s.tu[j];
      if (Math.abs(b.x - tt.x) < 22 && Math.abs(b.y - tt.y) < 22) {
        tt.hp -= b.dm; tt.fl = 0.08; spark(b.x, b.y, 2);
        if (tt.hp <= 0) { s.score += 250; explode(tt.x, tt.y, 54); s.tu.splice(j, 1); }
        if (!b.pierce) dead = true;
      }
    }
    // enemies
    for (j = 0; j < s.en.length && !dead; j++) {
      var en = s.en[j];
      if (b.hit.indexOf(en.id) >= 0) continue;
      if (Math.hypot(b.x - en.x, b.y - en.y) < en.r + b.r) {
        en.hp -= b.dm; en.fl = 0.14; spark(b.x, b.y, 2); if (en.hp > 0 && en.sp !== 'sp_capsule') Sfx.enemyHit();
        if (b.pierce) b.hit.push(en.id); else dead = true;
        if (en.hp <= 0) { killEnemy(en); s.en.splice(j, 1); j--; }
      }
    }
    // boss
    var bo = s.boss;
    if (bo && !dead && bo.st !== 'die' && bo.st !== 'in') {
      if (bo.pl.hp > 0 && Math.hypot(b.x - (bo.x - 112), b.y - (bo.y + 30)) < 30) { bo.pl.hp -= b.dm; bo.fl = 0.12; spark(b.x, b.y, 2); if (bo.pl.hp <= 0) { slowMo(0.2); explode(bo.x - 112, bo.y + 30, 80); shock(bo.x - 112, bo.y + 30, 140, 0.7); Sfx.enemyExp(true); s.score += 1500; } if (!b.pierce) dead = true; }
      else if (bo.pr.hp > 0 && Math.hypot(b.x - (bo.x + 112), b.y - (bo.y + 30)) < 30) { bo.pr.hp -= b.dm; bo.fl = 0.12; spark(b.x, b.y, 2); if (bo.pr.hp <= 0) { slowMo(0.2); explode(bo.x + 112, bo.y + 30, 80); shock(bo.x + 112, bo.y + 30, 140, 0.7); Sfx.enemyExp(true); s.score += 1500; } if (!b.pierce) dead = true; }
      else {
        var dx = (b.x - bo.x) / 78, dy = (b.y - bo.y) / 105;
        if (dx * dx + dy * dy < 1 && b.hit.indexOf('boss') < 0) {
          var pods = (bo.pl.hp > 0 ? 1 : 0) + (bo.pr.hp > 0 ? 1 : 0);
          bo.hp -= b.dm * (pods ? 0.25 : 1); bo.fl = 0.12; spark(b.x, b.y, 2); if (bo.hp > 0) Sfx.enemyHit();
          if (b.pierce) b.hit.push('boss'); else dead = true;
          if (bo.hp <= 0) { slowMo(0.6); bo.hp = 0; bo.st = 'die'; bo.beam = 0; s.eb = []; G.msg = 'GUARDIAN DESTROYED'; G.msgT = 3; }
        }
      }
    }
    if (dead) s.pb.splice(i, 1);
  }

  // enemy bullets
  for (i = s.eb.length - 1; i >= 0; i--) {
    var q2 = s.eb[i];
    var qx0 = q2.x, qy0 = q2.y;
    q2.x += q2.vx * dt; q2.y += q2.vy * dt;
    if (q2.y < -40 || q2.y > H + 40 || q2.x < -40 || q2.x > W + 40) { s.eb.splice(i, 1); continue; }
    var blocked = false;
    for (j = 0; j < s.ob.length; j++) { var o2 = s.ob[j], b2 = obBox(o2); if (circRect(q2.x, q2.y, q2.r, o2.x, o2.y, b2[0], b2[1])) { blocked = true; break; } }
    if (blocked) { spark(q2.x, q2.y, 2); s.eb.splice(i, 1); continue; }
    if (!p.dead && shipHit(q2.x, q2.y, q2.r, qx0, qy0)) { if (p.inv <= 0 && !s.clear) Sfx.hurt(); hurt(q2.dm); s.eb.splice(i, 1); }
  }

  // pickups
  for (i = s.pk.length - 1; i >= 0; i--) {
    var k = s.pk[i];
    k.a += dt; k.y += 70 * dt; k.x += Math.sin(k.a * 3) * 20 * dt;
    if (k.y > H + 30) { s.pk.splice(i, 1); continue; }
    if (!p.dead && Math.hypot(k.x - p.x, k.y - p.y) < 30) {
      if (k.k === 'P') { if (p.w < 5) { p.w++; G.msg = 'WEAPON LEVEL ' + p.w; Sfx.upgrade(); } else { s.score += 500; G.msg = 'BONUS +500'; Sfx.bonus(); } }
      else if (k.k === 'S') { p.shield = 45; G.msg = 'SHIELD ONLINE'; Sfx.shield(); }
      else if (k.k === 'H') { p.hp = Math.min(100, p.hp + 35); G.msg = 'ENERGY +35'; Sfx.energy(); }
      else if (k.k === 'D') { if (p.drones < 2) { p.drones++; G.msg = 'WINGMAN DRONE'; Sfx.wingman(); } else { s.score += 500; G.msg = 'BONUS +500'; } }
      G.msgT = 1.6; s.score += 50; s.pk.splice(i, 1);
      s.fx.push({ k: 'ring', t: 0, d: 0.45, c: { P: '255,170,60', S: '80,210,255', H: '255,90,120', D: '255,230,90' }[k.k] });
      light(p.x, p.y, 160, k.k === 'S' ? [80, 210, 255] : k.k === 'H' ? [255, 90, 120] : [255, 190, 80], 0.4, 0.7);
    }
  }

  // fx
  for (i = s.fx.length - 1; i >= 0; i--) {
    var f = s.fx[i]; f.t += dt;
    if (f.k === 'sp') { f.x += f.vx * dt; f.y += f.vy * dt; }
    else if (f.k === 'deb') { f.x += f.vx * dt; f.y += f.vy * dt + s.sp * 0.3 * dt; f.vx *= 1 - dt * 1.2; f.vy *= 1 - dt * 1.2; f.r += f.vr * dt; }
    else if (f.k === 'puff') { f.x += f.vx * dt; f.y += f.vy * dt; }
    else if (f.k === 'shard') { f.x += f.vx * dt; f.y += f.vy * dt + s.sp * 0.4 * dt; f.vx *= 1 - dt * 0.8; f.vy *= 1 - dt * 0.8; f.r += f.vr * dt; }
    else if (f.k === 'glit') { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 1 - dt * 2; f.vy *= 1 - dt * 2; }
    if (f.t > f.d) s.fx.splice(i, 1);
  }

  // level completion
  if (!s.clear && !p.dead) {
    if (s.lv < 3 && s.ev >= LV.length && s.en.length === 0) { s.clear = 0.001; s.eb = []; }
  }
  if (s.clear) {
    var pc = s.clear;
    s.clear += dt;
    if (pc <= EXIT_AT && s.clear > EXIT_AT) Sfx.warp();   // the ship takes off: the jump sound covers take-off, warp and flash
    if (s.lv < 3 && s.clear > NEXT_AT) {
      var bonus = 1000 + G.rw * 500; s.score += bonus;
      var c = { score: s.score, hp: Math.min(100, s.p.hp + 15), w: s.p.w, drones: s.p.drones };
      startLevel(s.lv + 1, c);
    } else if (s.lv === 3 && s.clear > NEXT_AT) { s.score += 3000 + G.rw * 1000; G.mode = 'win'; G.winT = 0; saveHi(); }
  }
  if (G.msgT > 0) G.msgT -= dt;
  if (G.mode === 'over') saveHi();
}
function saveHi() { if (S.score > G.hi) { G.hi = S.score; store('rw16:hi', String(G.hi)); } }

// ---------- time rewind ----------
function tryRewind() {
  if (G.rewinding || !S || G.rw <= 0 || snaps.length < 5 || (G.mode !== 'play' && G.mode !== 'over')) return;
  if (S.clear) return;
  G.rw--;
  // states to travel through, newest first: the current one, then up to 5 s of snapshots
  var n = Math.min(50, snaps.length - 1);
  var list = [S].concat(snaps.splice(snaps.length - n, n).reverse());
  Sfx.rewind.start();
  G.rewinding = { list: list, t: 0, d: 1.1 + 1.3 * n / 50, pos: 0, spd: 0, ang: 0 };
}
function lerp(a, b, f) { return a + (b - a) * f; }
// Display-only state between two snapshots (positions interpolated so the slow parts are smooth).
function blendState(A, B, f) {
  if (f <= 0 || A === B) return A;
  var D = {}, k, i;
  for (k in A) D[k] = A[k];
  D.scroll = lerp(A.scroll, B.scroll, f);
  D.p = {}; for (k in A.p) D.p[k] = A.p[k];
  D.p.x = lerp(A.p.x, B.p.x, f); D.p.y = lerp(A.p.y, B.p.y, f); D.p.tl = lerp(A.p.tl || 0, B.p.tl || 0, f);
  var bm = {};
  for (i = 0; i < B.en.length; i++) bm[B.en[i].id] = B.en[i];
  D.en = A.en.map(function (e) { var o = bm[e.id]; if (!o) return e; var c = {}; for (var q in e) c[q] = e[q]; c.x = lerp(e.x, o.x, f); c.y = lerp(e.y, o.y, f); return c; });
  var om = {};
  for (i = 0; i < B.ob.length; i++) om[B.ob[i].id] = B.ob[i];
  D.ob = A.ob.map(function (o) { var b = om[o.id]; if (!b) return o; var c = {}; for (var q in o) c[q] = o[q]; c.y = lerp(o.y, b.y, f); return c; });
  function lerpList(la, lb) {
    var m = {}, j;
    for (j = 0; j < lb.length; j++) m[lb[j].id] = lb[j];
    return la.map(function (q) { var o = m[q.id]; if (!o) return q; var c = {}; for (var z in q) c[z] = q[z]; c.x = lerp(q.x, o.x, f); c.y = lerp(q.y, o.y, f); return c; });
  }
  D.pb = lerpList(A.pb, B.pb); D.eb = lerpList(A.eb, B.eb); D.pk = A.pk; D.tu = lerpList(A.tu, B.tu);
  if (A.boss && B.boss) { D.boss = {}; for (k in A.boss) D.boss[k] = A.boss[k]; D.boss.x = lerp(A.boss.x, B.boss.x, f); D.boss.y = lerp(A.boss.y, B.boss.y, f); }
  return D;
}
function updateRewind(dt) {
  var r = G.rewinding, last = r.list.length - 1;
  r.t += dt;
  var u = Math.min(1, r.t / r.d);
  // progressive: starts slowly, speeds up, then slows down again before landing in the past
  var e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  var pos = e * last;
  r.spd = (pos - r.pos) / Math.max(dt, 1e-3); r.pos = pos; r.ang += r.spd * dt * 0.6;
  var i = Math.min(last, Math.floor(pos));
  S = blendState(r.list[i], r.list[Math.min(last, i + 1)], pos - i);
  G.rwFlash = 1;
  if (u >= 1) {
    S = r.list[last];
    Sfx.rewind.end();
    S.p.inv = 1.8; S.p.dead = false; S.p.deadT = 0;
    G.rewinding = null; G.mode = 'play'; snapAcc = 0; echoes = [];
    if (S.p.hp <= 0) S.p.hp = 30;
    G.msg = 'TIME REWOUND'; G.msgT = 1.5;
  }
}

// ---------- drawing ----------
// Far background: procedural nebula/galaxy tile (js/space.js), scrolled very slowly and repeated vertically.
function drawSpace(level, off) {
  var t = self.SpaceBG.get(level), th = self.SpaceBG.TH, y = off % th;
  if (postActive()) { G.space = { tile: t, off: y }; return; }   // drawn (and stirred by the gas fluid) in the WebGL pass
  ctx.drawImage(t, 0, y - th, W, th);
  ctx.drawImage(t, 0, y, W, th);
}
function drawBackground() {
  var lv = LEVELS[S.lv - 1];
  drawSpace(S.lv, S.scroll * 0.12);
  // a light veil of the level colours keeps each level's mood
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, lv.top); g.addColorStop(1, lv.bot);
  ctx.globalAlpha = 0.25; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
  var i, st, WA = warpAmt();
  // nearer star layers (parallax) on top of the far tile; planets, moons and clouds are in front of them
  ctx.fillStyle = lv.star;
  for (i = 0; i < stars.length; i++) {
    st = stars[i];
    var sp = 0.25 + st.l * 0.35, y2 = (st.y + S.scroll * sp) % H;
    ctx.globalAlpha = st.b * (0.22 + st.l * 0.18);
    var wl = WA * 90 * (0.35 + st.l * 0.5);   // hyperspace: stars stretch into streaks
    ctx.fillRect(st.x, y2 - wl, 1 + st.l * 0.5, 1 + st.l * 0.8 + wl);
  }
  ctx.globalAlpha = 1;
  // far decor
  var dec = DECOR[S.lv - 1], cyc = 2300;
  for (i = 0; i < dec.length; i++) {
    var d = dec[i], y = ((d.off + S.scroll * d.f) % cyc) - 400;
    if (y > -300 && y < H + 300) spr(d.sp, d.x, y, d.w, { alpha: d.a, rot: d.rot });
  }
  ctx.globalAlpha = 1;
  if (S.lv === 3) drawEdgeStructures();   // the station is closer than clouds and moons
}
// Level 3: continuous station structures along both edges, far away (slow parallax, dimmed).
function drawEdgeStructures(mask) {
  var w = 112, f = 0.3, ov = 4;
  var tiles = ['wall0', 'wall1'], hs = [sh('wall0', w) - ov, sh('wall1', w) - ov], P = hs[0] + hs[1];
  for (var side = 0; side < 2; side++) {
    var off = (S.scroll * f + side * P * 0.5) % P;
    var x = side ? W - w / 2 + 18 : w / 2 - 18;
    var y = off - P, k = 0;
    while (y < H) {
      var h = hs[k % 2];
      if (y + h > 0) spr(tiles[k % 2], x, y + h / 2, w, { flip: !!side, alpha: 0.75 });
      y += h; k++;
    }
    // towers turned sideways, sticking out of the wall towards the middle (one per tile pair, alternating sprite)
    var tw = 58;
    for (var ty = off - P, j = 0; ty < H + P; ty += P, j++) {
      var cy = ty + hs[0] * 0.55, tn = (j + side) % 2 ? 'tower1' : 'tower0', tl = sh(tn, tw);
      if (cy < -tw || cy > H + tw) continue;
      var bx = side ? W - w + 22 : w - 22;                     // base sits on the inner edge of the wall
      spr(tn, side ? bx - tl / 2 + 6 : bx + tl / 2 - 6, cy, tw, { rot: side ? -Math.PI / 2 : Math.PI / 2, alpha: 0.7 });
    }
  }
  if (mask) return;
  // haze: pushes the structures into the distance
  // (horizontal gradient, so there is no hard edge towards the middle of the screen)
  var hz = w + 150;
  var gl = ctx.createLinearGradient(0, 0, hz, 0);
  gl.addColorStop(0, 'rgba(4,8,22,0.5)'); gl.addColorStop(0.6, 'rgba(4,8,22,0.42)'); gl.addColorStop(1, 'rgba(4,8,22,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, hz, H);
  var gr = ctx.createLinearGradient(W, 0, W - hz, 0);
  gr.addColorStop(0, 'rgba(4,8,22,0.5)'); gr.addColorStop(0.6, 'rgba(4,8,22,0.42)'); gr.addColorStop(1, 'rgba(4,8,22,0)');
  ctx.fillStyle = gr; ctx.fillRect(W - hz, 0, hz, H);
}
var TRAIL_COL = { bLaserS: '90,200,255', bGreen: '120,255,140', bPlasmaBig: '120,220,255', ebOrbO: '255,140,60', ebOrbB: '80,150,255', ebPink: '255,90,200', ebBigB: '90,150,255' };
// Short additive streak behind each bullet, opposite to its velocity; longer when faster.
function drawTrails(list, mine) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (b.hm) continue;                               // missiles leave smoke instead
    var c = TRAIL_COL[b.sp]; if (!c) continue;
    var v = Math.hypot(b.vx, b.vy); if (v < 1) continue;
    var len = Math.min(mine ? 46 : 34, v * (mine ? 0.06 : 0.09)), ex = b.x - b.vx / v * len, ey = b.y - b.vy / v * len;
    var g = ctx.createLinearGradient(b.x, b.y, ex, ey);
    g.addColorStop(0, 'rgba(' + c + ',0.55)'); g.addColorStop(1, 'rgba(' + c + ',0)');
    ctx.strokeStyle = g; ctx.lineWidth = Math.max(2, b.w * (mine ? 0.45 : 0.4));
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(ex, ey); ctx.stroke();
  }
  ctx.restore();
}
// ---------- time echoes ----------
// Ghost copies of the ship at its recent positions (display only, not part of the rewound state).
var echoes = [], echoAcc = 0;
var echoCv = document.createElement('canvas'), echoCtx = echoCv.getContext('2d');
function recordEcho(dt) {
  echoAcc += dt;
  if (echoAcc < 0.045) return;
  echoAcc = 0;
  var p = S.p;
  echoes.unshift({ x: p.x, y: p.y });
  if (echoes.length > 5) echoes.pop();
}
function drawEchoes() {
  var p = S.p;
  if (p.dead || echoes.length < 2) return;
  var rdy = G.rw > 0 ? 1 : 0.35;                     // brighter while a rewind is available
  // one cyan silhouette of the ship, reused for every ghost
  var size = 90, px = size * SC;
  if (echoCv.width !== px) { echoCv.width = px; echoCv.height = px; }
  echoCtx.setTransform(1, 0, 0, 1, 0, 0); echoCtx.clearRect(0, 0, px, px);
  echoCtx.globalCompositeOperation = 'source-over'; echoCtx.globalAlpha = 1;
  echoCtx.setTransform(SC, 0, 0, SC, size / 2 * SC, size / 2 * SC);
  var main = ctx; ctx = echoCtx;
  try { drawShip(0, 0, 58, p.tl, 0, 1, true); } finally { ctx = main; }
  echoCtx.setTransform(1, 0, 0, 1, 0, 0); echoCtx.globalCompositeOperation = 'source-atop';
  echoCtx.fillStyle = 'rgb(60,200,255)'; echoCtx.fillRect(0, 0, px, px);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (var i = 1; i < echoes.length; i++) {
    var a = echoes[i], b = echoes[i - 1], sp = Math.hypot(a.x - b.x, a.y - b.y);   // px per sample
    var al = Math.min(1, sp / 12) * 0.14 * (1 - i / echoes.length) * rdy;
    if (al < 0.01) continue;
    ctx.globalAlpha = al;
    ctx.drawImage(echoCv, a.x - size / 2, a.y - size / 2, size, size);
  }
  ctx.restore();
}
// Rewind: RGB split, red shifted one way and blue the other (like a VHS tape rewinding).
var chromaCv = document.createElement('canvas'), chromaCtx = chromaCv.getContext('2d');
var chanCv = document.createElement('canvas'), chanCtx = chanCv.getContext('2d');
function chromaSplit(dx) {
  if (dx < 0.4 || postActive()) return;   // with WebGL the aberration is done in the shader
  if (chromaCv.width !== cv.width) { chromaCv.width = chanCv.width = cv.width; chromaCv.height = chanCv.height = cv.height; }
  chromaCtx.setTransform(1, 0, 0, 1, 0, 0); chromaCtx.globalCompositeOperation = 'copy'; chromaCtx.drawImage(cv, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.globalCompositeOperation = 'lighter';
  [['#f00', -dx], ['#0f0', 0], ['#00f', dx]].forEach(function (ch) {
    chanCtx.setTransform(1, 0, 0, 1, 0, 0);
    chanCtx.globalCompositeOperation = 'copy'; chanCtx.drawImage(chromaCv, 0, 0);
    chanCtx.globalCompositeOperation = 'multiply'; chanCtx.fillStyle = ch[0]; chanCtx.fillRect(0, 0, chanCv.width, chanCv.height);
    ctx.drawImage(chanCv, ch[1] * SC, 0);
  });
  ctx.restore();
}

// ---------- foreground space dust ----------
// Close, fast, blurred particles (display only). Speed grows when the ship flies forward and during the warp.
var dust = [];
(function () { var r = mulberry32(5); for (var i = 0; i < 34; i++) dust.push({ x: r() * W, y: r() * H, z: 0.4 + r() * 0.6, b: 0.25 + r() * 0.5 }); })();
var dustLast = 0;
function drawDust() {
  var now = G.time, dt = Math.min(0.05, now - dustLast); dustLast = now;
  if (G.mode === 'pause') dt = 0;
  var fwd = clamp(-(S.p.vy || 0) / 285, 0, 1), w = warpAmt();
  var v = (G.rewinding ? -900 : 520 + 380 * fwd + 2600 * w);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (var i = 0; i < dust.length; i++) {
    var d = dust[i];
    d.y += v * d.z * dt;
    if (d.y > H + 40) { d.y -= H + 80; d.x = Math.random() * W; }
    if (d.y < -40) { d.y += H + 80; d.x = Math.random() * W; }
    var len = 6 + Math.abs(v) * d.z * 0.03, wd = 1 + d.z * 1.4;
    var g = ctx.createLinearGradient(d.x, d.y - len, d.x, d.y);
    g.addColorStop(0, 'rgba(180,210,255,0)'); g.addColorStop(1, 'rgba(200,225,255,' + d.b * (0.35 + 0.4 * w) + ')');
    ctx.fillStyle = g; ctx.fillRect(d.x - wd / 2, d.y - len, wd, len);
  }
  ctx.restore();
}
// ---------- boss alarm ----------
function drawAlarm() {
  var a = S.alarm || 0;
  if (a <= 0) return;
  var T = 4.2, t = T - a, k = Math.min(1, t / 0.4, a / 0.6);      // fade in / out
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,' + 0.5 * k + ')'; ctx.fillRect(0, 0, W, H);
  // backlit silhouette of the boss
  var sa = AT.boss, sw = 330, shh = sa[3] * sw / sa[2];
  tinted(W / 2, 330, 420, 'rgb(10,0,4)', 0.85 * k, function () { ctx.drawImage(img, sa[0], sa[1], sa[2], sa[3], -sw / 2, -shh / 2, sw, shh); });
  ctx.globalCompositeOperation = 'lighter';
  var rg = ctx.createRadialGradient(W / 2, 330, 40, W / 2, 330, 260);
  rg.addColorStop(0, 'rgba(255,40,40,' + 0.25 * k + ')'); rg.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 60, W, 540);
  ctx.globalCompositeOperation = 'source-over';
  // flashing red bands with moving hazard stripes
  var blink = 0.55 + 0.45 * Math.sin(t * 10);
  [[150, 1], [520, -1]].forEach(function (bd) {
    var by = bd[0], bh = 46;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, by, W, bh); ctx.clip();
    ctx.fillStyle = 'rgba(120,0,0,' + 0.75 * k + ')'; ctx.fillRect(0, by, W, bh);
    ctx.fillStyle = 'rgba(255,40,30,' + 0.55 * k * blink + ')';
    var off = (t * 80 * bd[1]) % 40;
    for (var x = -60 + off; x < W + 60; x += 40) { ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + 20, by); ctx.lineTo(x + 20 - bh, by + bh); ctx.lineTo(x - bh, by + bh); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,90,80,' + k + ')'; ctx.fillRect(0, by, W, 2); ctx.fillRect(0, by + bh - 2, W, 2);
  });
  ctx.globalAlpha = k * (0.6 + 0.4 * blink);
  txt('WARNING', W / 2, 186, 30, '#ffdddd', 'center');
  txt('FINAL GUARDIAN APPROACHING', W / 2, 551, 15, '#ffdddd', 'center');
  ctx.restore();
}
// ---------- white flash of the hyperspace jump ----------
function drawFlash() {
  var a = 0;
  if (S.clear > FLASH_AT) a = Math.min(1, (S.clear - FLASH_AT) / (NEXT_AT - FLASH_AT));
  else if (S.t < 0.5 && !S.clear) a = 1 - S.t / 0.5;
  if (a <= 0) return;
  ctx.fillStyle = 'rgba(235,245,255,' + a + ')'; ctx.fillRect(0, 0, W, H);
}

// ---------- dynamic lighting ----------
// Lights are drawn into a low-res buffer, cut to the shape of structures, obstacles, turrets, enemies and the boss
// (so they light up objects, not empty space), then added onto the scene.
var lightCv = document.createElement('canvas'), lightCtx = lightCv.getContext('2d');
var maskCv = document.createElement('canvas'), maskCtx = maskCv.getContext('2d');
lightCv.width = maskCv.width = W; lightCv.height = maskCv.height = H;
function collectLights() {
  var L = [], i, f, s = S;
  for (i = 0; i < s.fx.length; i++) {
    f = s.fx[i];
    if (f.k !== 'light' || f.t < 0) continue;
    var u = f.t / f.d, k = (1 - u) * (1 - u);
    L.push([f.x, f.y, f.r * (0.8 + 0.4 * u), f.c, f.i * k]);
  }
  for (i = 0; i < s.pb.length; i++) if (s.pb[i].sp === 'bPlasmaBig') L.push([s.pb[i].x, s.pb[i].y, 80, [90, 200, 255], 0.55]);
  for (i = 0; i < s.eb.length; i++) if (s.eb[i].sp === 'ebBigB') L.push([s.eb[i].x, s.eb[i].y, 70, [80, 140, 255], 0.5]);
  var b = s.boss;
  if (b && b.beam === 2) for (var y = b.y + 60; y < H + 60; y += 90) L.push([b.x, y, 150, [200, 90, 255], 0.75]);
  else if (b && b.beam === 1) L.push([b.bx, b.y + 80, 90, [200, 90, 255], 0.35]);
  return L;
}
function postActive() { return !!(post && postOn && view === post.canvas); }
function drawLights() {
  var L = collectLights();
  G.postLights = [];
  if (!L.length) return;
  var main = ctx, i, s = S;
  // 1. mask: everything solid in the scene
  maskCtx.setTransform(1, 0, 0, 1, 0, 0); maskCtx.globalCompositeOperation = 'source-over'; maskCtx.globalAlpha = 1;
  maskCtx.clearRect(0, 0, W, H);
  ctx = maskCtx;
  try {
    if (s.lv === 3) drawEdgeStructures(true);
    for (i = 0; i < s.ob.length; i++) spr(s.ob[i].sp, s.ob[i].x, s.ob[i].y, s.ob[i].w, { flip: s.ob[i].flip });
    for (i = 0; i < s.tu.length; i++) spr('c_' + s.tu[i].kind + 'Idle', s.tu[i].x, s.tu[i].y, 44);
    for (i = 0; i < s.en.length; i++) spr(s.en[i].sp, s.en[i].x, s.en[i].y, s.en[i].w);
    if (s.boss && s.boss.st !== 'die') spr('boss', s.boss.x, s.boss.y, 215);
  } finally { ctx = main; }
  if (postActive()) {
    // the WebGL pass shades the masked objects with relief lighting; here only the faint glow in the air
    L.sort(function (a, b) { return b[4] - a[4]; });
    G.postLights = L.slice(0, 8).map(function (l) { return [l[0], l[1], l[2], l[4] * 1.3, l[3]]; });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < L.length; i++) {
      var a0 = L[i], c0 = a0[3], g0 = ctx.createRadialGradient(a0[0], a0[1], 0, a0[0], a0[1], a0[2] * 0.7);
      g0.addColorStop(0, 'rgba(' + c0[0] + ',' + c0[1] + ',' + c0[2] + ',' + a0[4] * 0.12 + ')');
      g0.addColorStop(1, 'rgba(' + c0[0] + ',' + c0[1] + ',' + c0[2] + ',0)');
      ctx.fillStyle = g0; ctx.fillRect(a0[0] - a0[2], a0[1] - a0[2], a0[2] * 2, a0[2] * 2);
    }
    ctx.restore();
    return;
  }
  // 2. lights, additive
  var lc = lightCtx;
  lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 1; lc.globalCompositeOperation = 'source-over';
  lc.clearRect(0, 0, W, H);
  lc.globalCompositeOperation = 'lighter';
  for (i = 0; i < L.length; i++) {
    var l = L[i], c = l[3], g = lc.createRadialGradient(l[0], l[1], 0, l[0], l[1], l[2]);
    g.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + l[4] + ')');
    g.addColorStop(0.45, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + l[4] * 0.4 + ')');
    g.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
    lc.fillStyle = g; lc.fillRect(l[0] - l[2], l[1] - l[2], l[2] * 2, l[2] * 2);
  }
  // 3. keep the light only on solid things
  lc.globalCompositeOperation = 'destination-in';
  lc.drawImage(maskCv, 0, 0);
  // 4. add to the scene, plus a faint glow in the air around each light
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(lightCv, 0, 0, W, H);
  for (i = 0; i < L.length; i++) {
    var a = L[i], cc = a[3], ga = ctx.createRadialGradient(a[0], a[1], 0, a[0], a[1], a[2] * 0.7);
    ga.addColorStop(0, 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',' + a[4] * 0.12 + ')');
    ga.addColorStop(1, 'rgba(' + cc[0] + ',' + cc[1] + ',' + cc[2] + ',0)');
    ctx.fillStyle = ga; ctx.fillRect(a[0] - a[2], a[1] - a[2], a[2] * 2, a[2] * 2);
  }
  ctx.restore();
}

// ---------- shockwaves ----------
// The scene is copied once, then for each ring an annulus of it is drawn magnified around the centre:
// the background bends outwards along the ring, like air pushed by the blast.
var shockCv = document.createElement('canvas'), shockCtx = shockCv.getContext('2d');
function drawShocks() {
  if (postActive()) return;   // refracted in the WebGL pass
  var list = [], i, f;
  for (i = 0; i < S.fx.length; i++) { f = S.fx[i]; if (f.k === 'shock' && f.t >= 0) list.push(f); }
  if (!list.length) return;
  if (shockCv.width !== cv.width) { shockCv.width = cv.width; shockCv.height = cv.height; }
  shockCtx.setTransform(1, 0, 0, 1, 0, 0); shockCtx.clearRect(0, 0, shockCv.width, shockCv.height);
  shockCtx.drawImage(cv, 0, 0);
  for (i = 0; i < list.length; i++) {
    f = list[i];
    var u = f.t / f.d, e = 1 - Math.pow(1 - u, 3), R = f.r * e + 6, T = 8 + 16 * (1 - u), st = f.s * (1 - u);
    var sc = 1 + 0.14 * st;
    ctx.save();
    ctx.beginPath(); ctx.arc(f.x, f.y, R + T, 0, 6.2832); ctx.arc(f.x, f.y, Math.max(0, R - T), 0, 6.2832, true); ctx.clip();
    ctx.drawImage(shockCv, 0, 0, shockCv.width, shockCv.height, f.x - f.x * sc, f.y - f.y * sc, W * sc, H * sc);
    ctx.restore();
    // bright leading edge
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,230,190,' + 0.35 * st + ')'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y, R + T * 0.6, 0, 6.2832); ctx.stroke();
    ctx.restore();
  }
}

function glow(n, x, y, w, a) { ctx.globalCompositeOperation = 'lighter'; spr(n, x, y, w, { alpha: a }); ctx.globalCompositeOperation = 'source-over'; }

function drawWorld() {
  var s = S, p = s.p, i, e;
  drawBackground();
  // obstacles
  for (i = 0; i < s.ob.length; i++) {
    var o = s.ob[i];
    spr(o.sp, o.x, o.y, o.w, { flip: o.flip });
    if (o.fl > 0) glow(o.sp, o.x, o.y, o.w, 0.6);
  }
  // turrets
  var tc = { red: 'c_red', green: 'c_green', blue: 'c_blue', purple: 'c_purple', laser: 'c_laser', gun: 'c_gun' };
  for (i = 0; i < s.tu.length; i++) {
    var t = s.tu[i], nm = tc[t.kind] + (t.fl2 > 0 ? 'Fire' : 'Idle');
    spr(nm, t.x, t.y, 44);
    if (t.fl > 0) glow(nm, t.x, t.y, 44, 0.6);
  }
  // pickups
  var pn = { P: 'puP', S: 'puS', H: 'puHeart', D: 'puStar' };
  for (i = 0; i < s.pk.length; i++) {
    var k = s.pk[i], pulse = 1 + Math.sin(k.a * 6) * 0.1;
    glow(pn[k.k], k.x, k.y, 40 * pulse, 0.5);
    spr(pn[k.k], k.x, k.y, 30 * pulse);
  }
  // enemies
  for (i = 0; i < s.en.length; i++) {
    e = s.en[i];
    if (e.L) {
      ctx.strokeStyle = 'rgba(70,215,255,' + (0.45 + 0.3 * Math.sin(G.time * 6 + e.id)) + ')';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(e.x, e.y, e.w * 0.58, e.w * 0.5, 0, 0, 6.283); ctx.stroke();
    }
    drawEnemy(e);
    if (e.big) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(e.x - 40, e.y - e.w * 0.75, 80, 5);
      ctx.fillStyle = '#ff5a3c'; ctx.fillRect(e.x - 40, e.y - e.w * 0.75, 80 * Math.max(0, e.hp / e.maxhp), 5);
    }
  }
  drawBoss();
  drawTrails(s.pb, true);
  // player bullets
  for (i = 0; i < s.pb.length; i++) {
    var b = s.pb[i], rot = b.hm ? Math.atan2(b.vy, b.vx) + Math.PI / 2 : 0;
    glow(b.sp, b.x, b.y, b.w * 1.7, 0.35);
    spr(b.sp, b.x, b.y, b.w, { rot: rot });
  }
  // player
  drawEchoes();
  if (!p.dead) drawPlayer();
  // enemy bullets
  drawTrails(s.eb, false);
  for (i = 0; i < s.eb.length; i++) { var q = s.eb[i]; glow(q.sp, q.x, q.y, q.w * 1.5, 0.35); spr(q.sp, q.x, q.y, q.w); }
  // fx
  for (i = 0; i < s.fx.length; i++) {
    var f = s.fx[i];
    if (f.t < 0) continue;
    var u = f.t / f.d;
    if (f.k === 'exp') {
      var fr = 'x' + Math.min(8, Math.floor(u * 9)), ew = AT[fr][2] * Math.min(1.3, f.s / 116 * (0.85 + u * 0.3));
      glow(fr, f.x, f.y, ew, 1 - u * 0.3); spr(fr, f.x, f.y, ew);
    }
    else if (f.k === 'smoke') { var sn = 'smoke' + (Math.abs(Math.floor(f.x)) % 3); spr(sn, f.x, f.y - u * 30, AT[sn][2] * Math.min(1.3, f.s / 100 * (0.8 + u * 0.4)), { alpha: 0.7 * (1 - u) }); }
    else if (f.k === 'deb') {
      var da = AT[f.sp], dw = f.sw * f.sc, dh = f.sh * f.sc;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r + (f.flip ? Math.PI : 0)); ctx.globalAlpha = Math.min(1, (1 - u) * 1.6);
      ctx.drawImage(img, da[0] + f.cx, da[1] + f.cy, f.sw, f.sh, -dw / 2, -dh / 2, dw, dh);
      if (u < 0.35) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * (1 - u / 0.35); ctx.drawImage(img, da[0] + f.cx, da[1] + f.cy, f.sw, f.sh, -dw / 2, -dh / 2, dw, dh); }   // still glowing hot
      ctx.restore();
    }
    else if (f.k === 'mz') {
      if (p.dead) continue;
      var mx2 = p.x + f.ox, my2 = p.y + f.oy, mr = f.s * (1 - u * 0.4);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var mg = ctx.createRadialGradient(mx2, my2, 0, mx2, my2, mr);
      mg.addColorStop(0, 'rgba(255,255,255,' + (1 - u) + ')'); mg.addColorStop(0.35, 'rgba(' + f.c + ',' + 0.8 * (1 - u) + ')'); mg.addColorStop(1, 'rgba(' + f.c + ',0)');
      ctx.fillStyle = mg; ctx.beginPath(); ctx.ellipse(mx2, my2 - mr * 0.3, mr * 0.7, mr * 1.2, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    else if (f.k === 'ring') {
      if (p.dead) continue;
      var rr2 = 12 + 70 * (1 - Math.pow(1 - u, 2));
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(' + f.c + ',' + 0.85 * (1 - u) + ')'; ctx.lineWidth = 1 + 5 * (1 - u);
      ctx.beginPath(); ctx.arc(p.x, p.y, rr2, 0, 6.2832); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + 0.5 * (1 - u) + ')'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, rr2 * 0.82, 0, 6.2832); ctx.stroke();
      ctx.restore();
    }
    else if (f.k === 'shard') {
      var sa = AT[f.sp], tr = f.tri, al2 = Math.min(1, (1 - u) * 1.8);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.r);
      ctx.beginPath(); ctx.moveTo(tr[0][0], tr[0][1]); ctx.lineTo(tr[1][0], tr[1][1]); ctx.lineTo(tr[2][0], tr[2][1]); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.globalAlpha = al2;
      // the piece of the crystal texture this shard came from (fall back to an icy fill outside the sprite)
      ctx.fillStyle = 'rgba(90,140,230,0.55)'; ctx.fill();
      ctx.drawImage(img, sa[0], sa[1], sa[2], sa[3], -f.ox - sa[2] * f.sc / 2, -f.oy - sa[3] * f.sc / 2, sa[2] * f.sc, sa[3] * f.sc);
      // light catching the glass: a glint that sweeps as the shard spins
      var gl = 0.5 + 0.5 * Math.sin(f.r * 2 + f.gl);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al2 * gl * 0.7;
      ctx.fillStyle = 'rgba(200,240,255,1)'; ctx.fill();
      ctx.restore();
      ctx.globalAlpha = al2 * 0.9; ctx.strokeStyle = 'rgba(220,245,255,0.9)'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.restore();
    }
    else if (f.k === 'glit') {
      var tw = 0.5 + 0.5 * Math.sin(G.time * 40 + f.ph), gs = f.s * (0.6 + tw);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - u) * (0.5 + 0.5 * tw);
      ctx.fillStyle = '#dff6ff';
      ctx.beginPath(); ctx.moveTo(f.x, f.y - gs * 2); ctx.lineTo(f.x + gs * 0.6, f.y); ctx.lineTo(f.x, f.y + gs * 2); ctx.lineTo(f.x - gs * 0.6, f.y); ctx.closePath(); ctx.fill();
      ctx.fillRect(f.x - gs * 1.6, f.y - 0.4, gs * 3.2, 0.8);
      ctx.restore();
    }
    else if (f.k === 'puff') { var pn = 'smoke' + f.n; spr(pn, f.x, f.y, f.s * (0.6 + u * 0.9), { alpha: 0.55 * (1 - u) }); }
    else if (f.k === 'sp') { ctx.fillStyle = 'rgba(255,' + Math.floor(200 - u * 120) + ',80,' + (1 - u) + ')'; ctx.fillRect(f.x, f.y, 2, 2); }
  }
}
// One fixed body frame (the exhaust baked into the sheet is cropped off), animated thrusters and banking.
var BODY_ROWS = 85;           // rows of the player0 sprite above the baked-in flame
var NOZZLES = [[0.5, 0.78, 1], [0.15, 0.72, 0.55], [0.85, 0.72, 0.55]]; // x frac, y frac of body, size
function flame(x, y, len, wid) {
  var g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(140,235,255,0.95)');
  g.addColorStop(0.65, 'rgba(70,160,255,0.75)'); g.addColorStop(1, 'rgba(40,100,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x - wid, y); ctx.quadraticCurveTo(x - wid * 0.9, y + len * 0.55, x, y + len);
  ctx.quadraticCurveTo(x + wid * 0.9, y + len * 0.55, x + wid, y); ctx.closePath(); ctx.fill();
}
function drawShip(x, y, w, tilt, vy, alpha, glowOnly) {
  // Banking as a roll around the ship's long axis: the hull is drawn in 1-px strips,
  // each projected with a simple perspective (the far side shrinks, the near side grows).
  var a = AT.player0, k = w / a[2], bh = BODY_ROWS * k, hw = w / 2, top = -a[3] * k / 2;
  var roll = tilt * 0.75, cr = Math.cos(roll), sr = Math.sin(roll), D = 0.45;
  function proj(u) { var s = 1 / (1 + u * sr * D); return [u * cr * hw * s, s]; }
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  var i, p0, p1, n = a[2];
  if (!glowOnly) {
    // thrusters first (behind the hull); flicker independently and stretch when flying forward
    var boost = clamp(-vy / 285, -0.4, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (i = 0; i < NOZZLES.length; i++) {
      var nz = NOZZLES[i], u = nz[0] * 2 - 1, pr = proj(u), s = pr[1];
      var fl = 0.8 + 0.2 * Math.sin(G.time * 55 + i * 2.1) + 0.12 * Math.sin(G.time * 23 + i * 5);
      flame(pr[0], (top + nz[1] * bh + 4) * s, (38 + 22 * boost) * nz[2] * fl * s, (8.5 + 2 * boost) * nz[2] * s * cr);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  for (i = 0; i < n; i++) {
    p0 = proj(i / n * 2 - 1); p1 = proj((i + 1) / n * 2 - 1);
    var dw = Math.abs(p1[0] - p0[0]) + 0.6, sc = (p0[1] + p1[1]) / 2;
    ctx.drawImage(img, a[0] + i, a[1], 1, BODY_ROWS, Math.min(p0[0], p1[0]), top * sc, dw, bh * sc);
  }
  ctx.restore();
}
// Enemies are alive: bank into turns (roll squash + small rotation), hover wobble, flickering engines.
function drawEnemy(e) {
  var a = AT[e.sp], w = Math.min(e.w, a[2] * 1.3), h = a[3] * w / a[2];
  // mini-bosses and the power-up capsule stay steady: no wobble, breathing or banking
  var still = e.big || e.sp === 'sp_capsule';
  var ph = e.id * 1.7, big = still ? 0 : 1, tl = still ? 0 : (e.tl || 0);
  var wx = Math.sin(G.time * 2.6 + ph) * 1.6 * big, wy = Math.sin(G.time * 3.4 + ph * 0.7) * 1.4 * big;
  var rot = -tl * 0.22 + Math.sin(G.time * 2.1 + ph) * 0.05 * big;
  // squash (banking roll + breathing) only on the small ships: medium ones keep their shape
  var sq = e.w >= 60 ? 0 : 1;
  var sx = (1 - Math.abs(tl) * 0.16 * sq) * (1 + Math.sin(G.time * 5 + ph) * 0.015 * big * sq), sy = 1 - Math.sin(G.time * 5 + ph) * 0.015 * big * sq;
  var organic = e.sp.indexOf('sp_') === 0 || e.sp === 'm_worm';
  // ships in the sheet point up (engines painted at the bottom): turn them so the nose leads the descent
  var ship = /^(e_s|e_m|e_b|m_\d)/.test(e.sp);
  ctx.save();
  ctx.translate(e.x + wx, e.y + wy); ctx.rotate(rot + (ship ? Math.PI : 0) + (e.sp === 'sp_capsule' ? Math.PI / 2 : 0));   // the power-up beacon lies horizontally
  if (!organic) {
    // engine glow at the rear (after the turn, the rear of the ship is at the top of the screen)
    var fl = 0.7 + 0.3 * Math.sin(G.time * 31 + ph) + 0.15 * Math.sin(G.time * 13 + ph * 2);
    var r = w * 0.2 * fl, gy = ship ? h * 0.42 : -h * 0.42;
    var g = ctx.createRadialGradient(0, gy, 0, 0, gy, r * 1.6);
    g.addColorStop(0, 'rgba(230,250,255,' + 0.8 * fl + ')'); g.addColorStop(0.35, 'rgba(90,170,255,' + 0.5 * fl + ')'); g.addColorStop(1, 'rgba(60,80,255,0)');
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, gy + (ship ? r * 0.4 : -r * 0.4), r * 0.9, r * 1.6, 0, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.scale(sx, sy);
  ctx.drawImage(img, a[0], a[1], a[2], a[3], -w / 2, -h / 2, w, h);
  // hit: the ship flushes red for a moment
  if (e.fl > 0) tinted(0, 0, Math.max(w, h) * 1.05, 'rgb(255,30,20)', 0.8 * Math.min(1, e.fl / 0.1), function () { ctx.drawImage(img, a[0], a[1], a[2], a[3], -w / 2, -h / 2, w, h); });
  ctx.restore();
}
// Draw something into an offscreen canvas, colour it (source-atop keeps its shape) and lay it over the scene.
var tintCv = document.createElement('canvas'), tintCtx = tintCv.getContext('2d');
function tinted(x, y, size, color, alpha, drawFn) {
  var px = Math.ceil(size * SC);
  if (tintCv.width !== px) { tintCv.width = px; tintCv.height = px; }
  tintCtx.setTransform(1, 0, 0, 1, 0, 0); tintCtx.clearRect(0, 0, px, px);
  tintCtx.globalCompositeOperation = 'source-over'; tintCtx.globalAlpha = 1;
  tintCtx.setTransform(SC, 0, 0, SC, size / 2 * SC, size / 2 * SC);
  tintCtx.imageSmoothingEnabled = true; tintCtx.imageSmoothingQuality = 'high';
  var main = ctx; ctx = tintCtx;
  try { drawFn(); } finally { ctx = main; }
  tintCtx.setTransform(1, 0, 0, 1, 0, 0);
  tintCtx.globalCompositeOperation = 'source-atop'; tintCtx.globalAlpha = 1;
  tintCtx.fillStyle = color; tintCtx.fillRect(0, 0, px, px);
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(tintCv, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}
function drawPlayer() {
  var p = S.p, al = 1;
  if (p.inv > 0 && Math.floor(G.time * 20) % 2 === 0 && !S.clear) al = 0.45;
  ctx.globalAlpha = al;
  for (var i = 0; i < p.drones; i++) {
    var dx = p.x + (i ? 44 : -44) + Math.sin(G.time * 3 + i) * 3, dy = p.y + 6 + Math.cos(G.time * 3 + i) * 3;
    spr('drone', dx, dy, 24);
  }
  drawShip(p.x, p.y, 58, p.tl, p.vy, al, false);
  if (p.hurt > 0) {   // hit: the hull turns reddish for a moment
    var hk = Math.min(1, p.hurt / 0.4);
    tinted(p.x, p.y, 90, 'rgb(255,40,30)', 0.6 * hk * al, function () { drawShip(0, 0, 58, p.tl, p.vy, 1, true); });
  }
  if (p.shield > 0) {
    // pulsing glow while the shield is up (pulses faster when it is about to fail)
    var lvl = Math.min(1, p.shield / 45), pulse = 0.5 + 0.5 * Math.sin(G.time * (p.shield < 12 ? 14 : 5));
    var gr = 56 + pulse * 10, gx = p.x, gy = p.y, sk = Math.max(0, Math.min(1, (p.shHit || 0) / 0.4));
    // hit on the shield: its colour veers from cyan to orange/red, then back
    var cr = Math.round(90 + 165 * sk), cg = Math.round(210 - 120 * sk), cb = Math.round(255 - 215 * sk);
    var g = ctx.createRadialGradient(gx, gy, 14, gx, gy, gr);
    g.addColorStop(0, 'rgba(' + cr + ',' + cg + ',' + cb + ',0)'); g.addColorStop(0.55, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + Math.min(0.8, (0.18 + 0.2 * pulse) * (0.5 + 0.5 * lvl) + 0.3 * sk) + ')');
    g.addColorStop(1, 'rgba(' + cr + ',' + Math.round(140 - 90 * sk) + ',' + Math.round(255 - 225 * sk) + ',0)');
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 6.283); ctx.fill();
    spr('shield', p.x, p.y, 84 + pulse * 6, { alpha: (0.08 + 0.2 * lvl) * (0.6 + 0.6 * pulse) });
    ctx.globalCompositeOperation = 'source-over';
    spr('shield', p.x, p.y, 84, { alpha: 0.12 + 0.16 * lvl });
    if (sk > 0) tinted(p.x, p.y, 100, 'rgb(255,110,30)', 0.75 * sk, function () { spr('shield', 0, 0, 84 + pulse * 6); });
  }
  ctx.globalAlpha = 1;
}
function drawBoss() {
  var b = S.boss;
  if (!b || b.done) return;   // gone after the final explosion
  if (b.pl.hp > 0) { spr('bossWingL', b.x - 112, b.y + 30, 56); if (b.fl > 0) tinted(b.x - 112, b.y + 30, 100, 'rgb(255,30,20)', 0.55 * Math.min(1, b.fl / 0.1), function () { spr('bossWingL', 0, 0, 56); }); }
  if (b.pr.hp > 0) { spr('bossWingR', b.x + 112, b.y + 30, 56); if (b.fl > 0) tinted(b.x + 112, b.y + 30, 100, 'rgb(255,30,20)', 0.55 * Math.min(1, b.fl / 0.1), function () { spr('bossWingR', 0, 0, 56); }); }
  if (b.beam === 1) {
    ctx.fillStyle = 'rgba(200,80,255,' + (0.25 + 0.25 * Math.sin(G.time * 40)) + ')';
    ctx.fillRect(b.bx - 3, b.y, 6, H);
  } else if (b.beam === 2) {
    var bh = H - b.y, bw = 64;
    ctx.save(); ctx.translate(b.x, b.y + bh / 2 + 30);
    var a = AT.bossBeam;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, a[0], a[1], a[2], a[3], -bw / 2, -bh / 2, bw, bh);
    ctx.drawImage(img, a[0], a[1], a[2], a[3], -bw / 2, -bh / 2, bw, bh);
    ctx.restore(); ctx.globalCompositeOperation = 'source-over';
  }
  // the dying boss stays solid (a see-through boss showed the background through it) and chars instead:
  // it darkens and glows red-hot in flickers until the final explosion
  var al = 1;
  spr('boss', b.x, b.y, 215);
  if (b.st === 'die') {
    var burn = Math.min(1, b.dying / 3.2);
    tinted(b.x, b.y, 300, 'rgb(20,6,10)', 0.65 * burn, function () { spr('boss', 0, 0, 215); });
    tinted(b.x, b.y, 300, 'rgb(255,80,30)', (0.15 + 0.35 * burn) * (0.5 + 0.5 * Math.sin(G.time * 23)), function () { spr('boss', 0, 0, 215); });
  }
  if (b.fl > 0) tinted(b.x, b.y, 300, 'rgb(255,30,20)', 0.55 * Math.min(1, b.fl / 0.1) * al, function () { spr('boss', 0, 0, 215); });
  if (b.st !== 'die') {
    ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(90, 46, 300, 7);
    ctx.fillStyle = '#c04cff'; ctx.fillRect(90, 46, 300 * Math.max(0, b.hp / b.maxhp), 7);
    ctx.strokeStyle = '#fff6'; ctx.strokeRect(90, 46, 300, 7);
  }
}

function drawHUD() {
  var p = S.p, i;
  txt('SCORE ' + String(S.score).padStart(7, '0'), 10, 22, 15, '#fff');
  txt('HI ' + String(G.hi).padStart(7, '0'), W - 10, 22, 13, '#9fb4ff', 'right');
  txt('LV' + S.lv, W / 2, 22, 14, '#ffd36b', 'center');
  // energy bar
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(10, H - 22, 160, 12);
  var hpc = p.hp > 50 ? '#46e68a' : p.hp > 25 ? '#ffc43c' : '#ff4a3c';
  ctx.fillStyle = hpc; ctx.fillRect(10, H - 22, 160 * p.hp / 100, 12);
  if (p.shield > 0) { ctx.fillStyle = '#46d7ff'; ctx.fillRect(10, H - 26, 160 * Math.min(1, p.shield / 45), 3); }
  ctx.strokeStyle = '#fff8'; ctx.strokeRect(10, H - 22, 160, 12);
  txt('ENERGY', 12, H - 28, 10, '#fff9');
  // weapon pips
  for (i = 0; i < 5; i++) { ctx.fillStyle = i < p.w ? '#ff9a3c' : 'rgba(255,255,255,.15)'; ctx.fillRect(182 + i * 12, H - 20, 9, 8); }
  txt('WEAPON', 182, H - 28, 10, '#fff9');
  // rewind charges
  txt('REWIND [R]', W - 10, H - 28, 10, '#9fe9ff', 'right');
  for (i = 0; i < 3; i++) clockIcon(W - 24 - i * 26, H - 14, 9, i < G.rw);
  // AI status
  if (G.ai) {
    var col = G.ai.mode === 'HUNTING' ? '#ff6a5a' : G.ai.mode === 'DODGING' ? '#ffd45a' : '#7ad7ff';
    txt('ENEMY AI: ' + G.ai.mode + ' ' + Math.min(100, Math.floor(G.ai.samples / 90 * 100)) + '%', 10, 40, 11, col);
  }
  if (G.msgT > 0 && G.mode !== 'win') { ctx.globalAlpha = Math.min(1, G.msgT); txt(G.msg, W / 2, 300, 20, '#fff', 'center'); ctx.globalAlpha = 1; }
  if (S.t < 3.2 && G.mode !== 'win') {
    ctx.globalAlpha = Math.min(1, 3.2 - S.t);
    txt('LEVEL ' + S.lv, W / 2, 330, 34, '#ffd36b', 'center'); txt(LEVELS[S.lv - 1].name, W / 2, 362, 18, '#fff', 'center');
    ctx.globalAlpha = 1;
  }
  if (S.clear && S.clear < 2.4 && G.mode !== 'win' && !(S.lv === 3 && S.boss && !S.boss.done)) {   // the victory screen has its own text
    txt(S.lv < 3 ? 'LEVEL COMPLETE' : 'TIMELINE SECURED', W / 2, 330, 32, '#6dffb0', 'center');
    txt('Bonus: ' + (S.lv < 3 ? 1000 + G.rw * 500 : 3000 + G.rw * 1000) + ' (rewinds left x ' + (S.lv < 3 ? 500 : 1000) + ')', W / 2, 360, 14, '#fff', 'center');
  }
}
function clockIcon(x, y, r, on) {
  ctx.globalAlpha = on ? 1 : 0.25;
  ctx.strokeStyle = '#46d7ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.stroke();
  ctx.strokeStyle = '#ff9a3c'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r * 0.7); ctx.moveTo(x, y); ctx.lineTo(x - r * 0.5, y + r * 0.3); ctx.stroke();
  ctx.lineWidth = 1; ctx.globalAlpha = 1;
}
function overlayDim(a) { ctx.fillStyle = 'rgba(0,0,10,' + a + ')'; ctx.fillRect(0, 0, W, H); }

// Ornate black clock hand pointing up (rotated by the caller): tail, shaft, diamond, tip.
function clockHand(len, wid) {
  ctx.beginPath();
  ctx.moveTo(0, len * 0.22); ctx.lineTo(-wid * 0.45, 0); ctx.lineTo(-wid * 0.35, -len * 0.45);
  ctx.lineTo(-wid, -len * 0.6); ctx.lineTo(-wid * 0.3, -len * 0.74); ctx.lineTo(0, -len);
  ctx.lineTo(wid * 0.3, -len * 0.74); ctx.lineTo(wid, -len * 0.6); ctx.lineTo(wid * 0.35, -len * 0.45);
  ctx.lineTo(wid * 0.45, 0); ctx.closePath();
  ctx.fillStyle = '#0b0b10'; ctx.fill();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.stroke();
  ctx.fillStyle = 'rgba(120,130,160,0.35)'; ctx.fillRect(-0.5, -len * 0.92, 1, len * 0.8);   // faint sheen
}
function drawRewindClock(x, y, w, ang, k) {
  var s = w / 320;
  if (clockOk) {
    var h = clockImg.height * s;
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(G.time * 30) * 0.012 * k);   // slight shake at full speed
    ctx.drawImage(clockImg, -CLOCK_CX * s, -CLOCK_CY * s, w, h);
    ctx.restore();
  } else clockIcon(x, y, 60, true);
  // hands run backwards: the minute hand spins, the hour hand follows 12 times slower
  ctx.save(); ctx.translate(x, y);
  ctx.save(); ctx.rotate(-1.1 - ang / 12); clockHand(w * 0.21, w * 0.04); ctx.restore();
  ctx.save(); ctx.rotate(-ang); clockHand(w * 0.31, w * 0.032); ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, w * 0.035, 0, 6.283); ctx.fillStyle = '#0b0b10'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(120,130,160,0.5)'; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, w * 0.012, 0, 6.283); ctx.fillStyle = '#3a3d4a'; ctx.fill();
  ctx.restore(); ctx.lineWidth = 1;
}
function drawRewindFX() {
  var r = G.rewinding; if (!r) return;
  var k = Math.min(1, r.spd / 40);          // effect intensity follows the rewind speed
  chromaSplit(1 + 4 * k);
  var u = Math.min(1, r.t / r.d), fade = Math.min(1, u * 6, (1 - u) * 6 + 0.3);
  ctx.fillStyle = 'rgba(40,140,255,' + (0.1 + 0.16 * k) * fade + ')'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(160,230,255,' + (0.06 + 0.14 * k) * fade + ')';
  for (var y = (r.pos * 37) % 12; y < H; y += 12) ctx.fillRect(0, y, W, 2);
  if (Math.random() < 0.15 + 0.6 * k) { var gy = Math.random() * H; ctx.drawImage(cv, 0, gy * SC, W * SC, 30 * SC, (Math.random() - 0.5) * 30 * k, gy, W, 30); }
  ctx.globalAlpha = fade;
  drawRewindClock(W / 2, 350, 180, r.ang, k);
  txt('◀◀ REWIND', W / 2, 470, 26, '#bfeaff', 'center');
  txt('-' + (r.pos / 10).toFixed(1) + ' s', W / 2, 498, 16, '#ffd36b', 'center');
  ctx.globalAlpha = 1;
}

function drawTitle() {
  drawSpace(1, G.time * 6);
  ctx.fillStyle = '#bfe4ff';
  for (var i = 0; i < stars.length; i++) { var st = stars[i]; ctx.globalAlpha = st.b * 0.35; ctx.fillRect(st.x, (st.y + G.time * (20 + st.l * 30)) % H, 1.5, 1.5 + st.l); }
  ctx.globalAlpha = 1;
  if (!ready) { txt('LOADING...', W / 2, 360, 18, '#fff', 'center'); return; }
  spr('boss', W / 2, 360 + Math.sin(G.time) * 6, 190, { alpha: 0.5 });
  drawShip(W / 2 + Math.sin(G.time * 0.8) * 12, 535, 58, Math.cos(G.time * 0.8) * 0.15, 0, 1, false);
  if (logoOk) { var lw = 440, lh = logo.height * lw / logo.width; ctx.drawImage(logo, W / 2 - lw / 2, 150 - lh / 2 + Math.sin(G.time * 1.3) * 3, lw, lh); }
  else { txt('TIME', W / 2, 120, 54, '#46d7ff', 'center'); txt('RewAInd', W / 2, 170, 54, '#ff9a3c', 'center'); }
  txt('Be kind, rewind time.', W / 2, 640, 13, '#fff', 'center');
  if (Math.floor(G.time * 2) % 2 === 0) txt('PRESS ENTER OR TAP TO START', W / 2, 668, 18, '#ffd36b', 'center');
  txt('HI ' + String(G.hi).padStart(7, '0'), W / 2, 700, 12, '#9fb4ff', 'center');
}

function render() {
  G.space = null;
  if (postActive()) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); }   // transparent where the space background shows
  ctx.setTransform(SC, 0, 0, SC, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (!ready) { ctx.fillStyle = '#050818'; ctx.fillRect(0, 0, W, H); txt('LOADING...', W / 2, 360, 18, '#fff', 'center'); return; }
  if (G.mode === 'title') { drawTitle(); return; }
  if (G.mode === 'win') { drawWin(); return; }
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
  drawWorld();
  ctx.restore();
  drawLights();
  drawShocks();
  drawDust();
  drawAlarm();
  drawFlash();
  drawHUD();
  drawRewindFX();
  if (G.mode === 'pause') { overlayDim(0.55); txt('PAUSED', W / 2, 350, 34, '#fff', 'center'); txt('P to resume', W / 2, 380, 14, '#cfe', 'center'); }
  if (S.p.dead && !G.rewinding) {
    var can = G.rw > 0 && snaps.length >= 5;
    if (G.mode === 'over') { overlayDim(0.5); txt('SHIP DESTROYED', W / 2, 320, 32, '#ff6a5a', 'center'); txt('Score ' + S.score, W / 2, 352, 16, '#fff', 'center'); }
    if (can) txt('PRESS R: REWIND TIME (' + G.rw + ' left)', W / 2, 400, 17, '#7ad7ff', 'center');
    if (G.mode === 'over') txt(can ? 'or ENTER to restart' : 'ENTER to restart', W / 2, 430, 14, '#ffd36b', 'center');
  }
}

// ---------- title ambience (Web Audio, synthesized: no files, no network) ----------
// Low continuous drone + sparse high pings through a long feedback delay (space echo).
var Amb = (function () {
  var ac = null, master = null, nodes = [], pingTimer = 0, on = false;
  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    // drone: slightly detuned low oscillators -> slow-moving low-pass
    var lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2;
    var dg = ac.createGain(); dg.gain.value = 0.55; lp.connect(dg); dg.connect(master);
    [[55, 'sawtooth', 0.35], [55.35, 'sawtooth', 0.35], [82.4, 'sine', 0.3], [110.2, 'triangle', 0.18]].forEach(function (d) {
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = d[1]; o.frequency.value = d[0]; g.gain.value = d[2]; o.connect(g); g.connect(lp); o.start(); nodes.push(o);
    });
    var lfo = ac.createOscillator(), lg = ac.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 110; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); nodes.push(lfo);
    var lfo2 = ac.createOscillator(), lg2 = ac.createGain();       // slow tremolo on the drone
    lfo2.frequency.value = 0.13; lg2.gain.value = 0.18; lfo2.connect(lg2); lg2.connect(dg.gain); lfo2.start(); nodes.push(lfo2);
    // echo bus: delay with filtered feedback
    var dl = ac.createDelay(2); dl.delayTime.value = 0.62;
    var fb = ac.createGain(); fb.gain.value = 0.58;
    var ef = ac.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 2400;
    var wet = ac.createGain(); wet.gain.value = 0.9;
    dl.connect(ef); ef.connect(fb); fb.connect(dl); ef.connect(wet); wet.connect(master);
    build.echo = dl;
    return true;
  }
  function ping() {
    if (!on) return;
    var f = [523.25, 587.33, 698.46, 783.99, 880, 1046.5, 1174.7][Math.floor(Math.random() * 7)] * (Math.random() < 0.3 ? 2 : 1);
    var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain(), pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.985, t + 1.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.6);
    o.connect(g);
    if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; g.connect(pan); pan.connect(build.echo); pan.connect(master); } else { g.connect(build.echo); g.connect(master); }
    o.start(t); o.stop(t + 1.8);
    pingTimer = setTimeout(ping, 2500 + Math.random() * 4500);
  }
  return {
    isOn: function () { return on; },
    ctxState: function () { return ac ? ac.state : 'none'; },
    start: function () {
      try {
        if (on) { if (ac.state === 'suspended') ac.resume(); return; }
        if (!ac && !build()) return;
        if (ac.state === 'suspended') ac.resume();
        on = true;
        var t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0.16, t + 3);
        clearTimeout(pingTimer); pingTimer = setTimeout(ping, 1200);
      } catch (e) { }
    },
    stop: function () {
      if (!on) return;
      on = false; clearTimeout(pingTimer);
      try {
        var t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + 0.8);
        var old = nodes, c = ac; nodes = []; ac = null; master = null;
        setTimeout(function () { try { old.forEach(function (o) { o.stop(); }); c.close(); } catch (e) { } }, 1200);
      } catch (e) { }
    }
  };
})();

// ---------- sound effects (HTML audio pools, so they also work from file://) ----------
var Sfx = (function () {
  function pool(src, n, vol) {
    var arr = [], i = 0;
    for (var k = 0; k < n; k++) { var a = new Audio('soundfx/' + src + '?v=10'); a.preload = 'auto'; a.volume = vol; arr.push(a); }
    return function () {
      var a = arr[i++ % n];
      try { a.currentTime = 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
    };
  }
  return {
    weapon1: pool('weapon1.mp3', 6, 0.30),
    weapon2: pool('weapon2.mp3', 6, 0.30),
    upgrade: pool('player.weapon.upgrade.mp3', 2, 0.6),
    explosion: pool('player.ship.explosion.mp3', 2, 0.8),
    shield: pool('shield.on.mp3', 2, 0.7),
    // enemy shots: quiet, few voices, minimum gap and a little random pitch so volleys do not turn into noise
    enemyShot: (function () {
      var arr = [], i = 0, last = 0;
      for (var k = 0; k < 5; k++) { var a = new Audio('soundfx/enemy.laser.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; a.volume = 0.16; arr.push(a); }
      return function () {
        var now = performance.now();
        if (now - last < 60) return;
        last = now;
        var a = arr[i++ % arr.length];
        try { a.playbackRate = 0.92 + Math.random() * 0.2; a.currentTime = 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
      };
    })(),
    // big enemies (mini-bosses, boss, medium ships): heavier blaster; the mp3 starts with 0.1 s of silence, skipped
    bigShot: (function () {
      var arr = [], i = 0, last = 0;
      for (var k = 0; k < 4; k++) { var a = new Audio('soundfx/615812__flyingsaucerinvasion__sci-fi-laser-blaster-shot-6.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; a.volume = 0.22; arr.push(a); }
      return function () {
        var now = performance.now();
        if (now - last < 90) return;
        last = now;
        var a = arr[i++ % arr.length];
        try { a.playbackRate = 0.95 + Math.random() * 0.1; a.currentTime = 0.1; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
      };
    })(),
    // time rewind: voice (echo baked into the file) and, shortly after, a chime that rings out on its own
    rewind: (function () {
      var voice = new Audio('soundfx/rewind.voice.echo.mp3?v=108'), chime = new Audio('soundfx/rewind.chime.mp3?v=108'), tm = 0;
      voice.preload = chime.preload = 'auto'; voice.volume = 0.8; chime.volume = 0.75;
      function play(a, from) { try { a.currentTime = from || 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { } }
      return {
        start: function () { clearTimeout(tm); play(voice); tm = setTimeout(function () { play(chime, 0.065); }, 380); },  // chime: skip 65 ms of silence
        end: function () { }
      };
    })(),
    // final boss warning: loops for as long as the alarm screen is up, then fades out
    alarm: (function () {
      var a = new Audio('soundfx/263682__ryanconway__warning-alarm.mp3?v=108'), fade = 0;
      a.preload = 'auto'; a.loop = true;
      return {
        start: function () { clearInterval(fade); try { a.volume = 0.45; a.currentTime = 0.06; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { } },
        stop: function () {
          clearInterval(fade);
          fade = setInterval(function () { a.volume = Math.max(0, a.volume - 0.05); if (a.volume <= 0) { clearInterval(fade); a.pause(); } }, 30);
        }
      };
    })(),
    // hyperspace jump between levels (converted from 634494__alexander93o__soun10.m4a); skip 50 ms of silence
    warp: function () { try { var a = new Audio('soundfx/warp.mp3?v=108'); a.volume = 0.6; a.currentTime = 0.05; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { } },
    pauseOn: pool('434610__jensenk__pauseon.mp3', 1, 0.35),
    pauseOff: pool('434611__jensenk__pauseoff.mp3', 1, 0.35),
    energy: pool('energy.echo.mp3', 2, 0.12),   // energy.wav with a baked-in echo
    hurt: pool('player.hurt.mp3', 3, 0.6),
    wingman: pool('wingman.mp3', 2, 0.2),   // synthesized (see CLAUDE.md)
    bonus: pool('bonus.mp3', 2, 0.3),
    // crystal asteroids breaking: quieter and pitched down (lower, heavier ice)
    shatter: (function () {
      var arr = [], i = 0;
      for (var k = 0; k < 3; k++) { var a = new Audio('soundfx/shattering.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; a.volume = 0.2; arr.push(a); }
      return function () {
        var a = arr[i++ % arr.length];
        try { a.playbackRate = 0.72; a.currentTime = 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
      };
    })(),
    // player ship scraping against enemies, obstacles or the boss: repeats every ~0.22 s while in contact
    scrape: (function () {
      var arr = [], i = 0, last = 0;
      for (var k = 0; k < 3; k++) { var a = new Audio('soundfx/366400__waveplaysfx__sfx-short-metallic-hit.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; a.volume = 0.3; arr.push(a); }
      return function () {
        var now = performance.now();
        if (now - last < 220) return;
        last = now;
        var a = arr[i++ % arr.length];
        try { a.playbackRate = 0.9 + Math.random() * 0.2; a.currentTime = 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
      };
    })(),
    // enemy ship hit (not killed): quiet, rate-limited because hits come in streams; skip 35 ms of leading silence
    enemyHit: (function () {
      var arr = [], i = 0, last = 0;
      for (var k = 0; k < 4; k++) { var a = new Audio('soundfx/458867__raclure__damage-sound-effect.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; a.volume = 0.22; arr.push(a); }
      return function () {
        var now = performance.now();
        if (now - last < 75) return;
        last = now;
        var a = arr[i++ % arr.length];
        try { a.playbackRate = 0.94 + Math.random() * 0.12; a.currentTime = 0.035; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
      };
    })(),
    // rock asteroids: low-bit boom with boosted bass and baked-in echo; bigger rocks are louder and deeper
    boom: (function () {
      var arr = [], i = 0;
      for (var k = 0; k < 3; k++) { var a = new Audio('soundfx/asteroid.boom.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; arr.push(a); }
      return function (size) {
        var a = arr[i++ % arr.length], big = Math.min(1, Math.max(0, (size - 30) / 80));
        try { a.volume = 0.28 + 0.3 * big; a.playbackRate = 1.1 - 0.25 * big; a.currentTime = 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { }); } catch (e) { }
      };
    })(),       // synthesized: P picked up with weapons already at max
    // enemy explosions: quiet, slightly lowered pitch (softer, less harsh), few voices and a minimum gap
    // between hits so that several kills in a row do not pile up and distort
    enemyExp: (function () {
      var arr = [], i = 0, last = 0;
      for (var k = 0; k < 4; k++) { var a = new Audio('soundfx/explosion.enemy.mp3?v=108'); a.preload = 'auto'; a.preservesPitch = false; arr.push(a); }
      return function (big) {
        var now = performance.now();
        if (now - last < 70) return;
        last = now;
        var a = arr[i++ % arr.length];
        try {
          a.volume = big ? 0.3 : 0.18;
          a.playbackRate = (big ? 0.78 : 0.9) + Math.random() * 0.08;
          a.currentTime = 0; var pr = a.play(); if (pr && pr.catch) pr.catch(function () { });
        } catch (e) { }
      };
    })()
  };
})();

// ---------- music (level background, kept low under the sound effects) ----------
var Music = (function () {
  // per track: file, loop start/end (skip the silent intro and tail), volume (livello2.mp3 is mastered quieter)
  var TRACKS = {
    1: { src: 'muzic/level1.mp3?v=108', start: 3.3, end: 183.6, vol: 0.55 },
    2: { src: 'muzic/livello2.mp3?v=108', start: 1.9, end: 167.6, vol: 1.0 },
    3: { src: 'muzic/level3.mp3?v=108', start: 3.8, end: 270.5, vol: 0.6 }
  };
  var START = 0, END = 1e9, VOL = 0.55;
  var el = null, cur = 0, fadeT = 0, target = 0, want = false;
  function step() {                      // volume ramps (setInterval, independent of the game loop)
    if (!el) return;
    var v = el.volume + (target - el.volume) * 0.12;
    if (Math.abs(target - v) < 0.005) v = target;
    el.volume = Math.max(0, Math.min(1, v));
    if (target === 0 && el.volume === 0) { el.pause(); clearInterval(fadeT); fadeT = 0; }
    else if (el.volume === target) { clearInterval(fadeT); fadeT = 0; }
  }
  function fadeTo(v) { target = v; if (!fadeT) fadeT = setInterval(step, 50); }
  return {
    level: function (n) {               // call at the start of each level
      var tr = TRACKS[n];
      if (!tr) { cur = 0; want = false; fadeTo(0); return; }
      var src = tr.src; START = tr.start; END = tr.end; VOL = tr.vol;
      if (!el) {
        el = new Audio(); el.preload = 'auto';
        el.addEventListener('timeupdate', function () { if (el.currentTime >= END) el.currentTime = START; });
        el.addEventListener('ended', function () { el.currentTime = START; el.play().catch(function () { }); });
      }
      if (cur !== n) { el.src = src; cur = n; }
      try { el.currentTime = START; } catch (e) { }
      el.volume = 0; want = true;
      var pr = el.play(); if (pr && pr.catch) pr.catch(function () { });
      fadeTo(VOL);
    },
    stop: function () { want = false; fadeTo(0); },
    info: function () { return el ? { t: el.currentTime, vol: el.volume, paused: el.paused } : null; },
    // follow the game mode: paused game -> paused music
    sync: function (mode) {
      if (!el || !want) return;
      if (mode === 'pause') { if (!el.paused) el.pause(); }
      else if (el.paused) { var pr = el.play(); if (pr && pr.catch) pr.catch(function () { }); }
    }
  };
})();

// ---------- loop ----------
var last = 0;
// Sources for the WebGL effects: heat haze, shock rings, the boss beam and light shafts (logical coordinates).
function postSources() {
  var s = S, p = s.p, heat = [], shocks = [], rays = [], i, f, u;
  if (!p.dead && p.y < H + 40 && p.y > -40) heat.push([p.x, p.y + 32, 26, 1.3 + Math.max(0, -p.vy / 285) * 1.2]);
  for (i = 0; i < s.fx.length; i++) {
    f = s.fx[i];
    if (f.t < 0) continue;
    u = f.t / f.d;
    if (f.k === 'exp' && f.s >= 40) {
      heat.push([f.x, f.y, f.s * 0.9, 2.4 * (1 - u)]);
      if (f.s >= 100 && u < 0.7) rays.push([f.x, f.y, 1.4 * (1 - u / 0.7), [255, 190, 120]]);
    } else if (f.k === 'shock') {
      var e = 1 - Math.pow(1 - u, 3);
      shocks.push([f.x, f.y, f.r * e + 6, 8 + 16 * (1 - u), f.s * (1 - u)]);
    }
  }
  heat.sort(function (a, b) { return b[3] - a[3]; });
  var b = s.boss, beam = null;
  if (b && !b.done) {
    if (b.beam === 2) beam = [b.x, b.y + 30, 46, 3];
    if (b.st === 'fight') rays.push([b.x, b.y + 10, b.ph === 2 ? 0.5 : 0.28, [230, 120, 255]]);
    if (b.st === 'die') rays.push([b.x, b.y, 0.6 + 0.4 * Math.sin(G.time * 20), [255, 140, 80]]);
  }
  var w = warpAmt();
  if (w > 0.02) rays.push([W / 2, 300, w * 1.6, [200, 225, 255]]);
  rays.sort(function (a, b2) { return b2[2] - a[2]; });
  // gas impulses: explosions blow the nebula outwards (with a little swirl), the ship's exhaust pushes it down
  var splats = [];
  for (i = 0; i < s.fx.length; i++) {
    f = s.fx[i];
    if (f.k === 'exp' && f.t >= 0 && f.t < 0.12 && f.s >= 40) splats.push([f.x, f.y, f.s * 0.9, f.s * 1.3, 0, 0, 0.45]);
  }
  splats.sort(function (a, b2) { return b2[3] - a[3]; });
  if (!p.dead && p.y < H + 20) splats.unshift([p.x, p.y + 42, 24, 14 + Math.max(0, -p.vy / 285) * 20, 0, 1, 0]);
  if (b && b.beam === 2) splats.push([b.x, H * 0.6, 60, 18, (Math.sin(G.time * 3) > 0 ? 1 : -1), 0, 0]);
  return { heat: heat.slice(0, 8), shocks: shocks.slice(0, 6), beam: beam, rays: rays.slice(0, 4), splats: splats.slice(0, 8) };
}
// Victory: a clean screen (space background only, no HUD or leftovers of the level) fading in from the white flash.
function drawWin() {
  drawSpace(S.lv, G.time * 10);
  ctx.fillStyle = 'rgba(0,0,10,0.45)'; ctx.fillRect(0, 0, W, H);
  txt('VICTORY', W / 2, 290, 44, '#6dffb0', 'center');
  txt('The timeline is yours.', W / 2, 325, 16, '#fff', 'center');
  txt('Bonus ' + (3000 + G.rw * 1000) + ' (rewinds left x 1000)', W / 2, 360, 13, '#9fb4ff', 'center');
  txt('FINAL SCORE ' + S.score, W / 2, 395, 20, '#ffd36b', 'center');
  txt('ENTER to play again', W / 2, 440, 14, '#cfe', 'center');
  var a = 1 - (G.winT || 0) / 0.8;
  if (a > 0) { ctx.fillStyle = 'rgba(235,245,255,' + a + ')'; ctx.fillRect(0, 0, W, H); }
}
function warpAmtSafe() { return S && G.mode !== 'title' ? warpAmt() : 0; }
function frame(ts) {
  var dt = Math.min(0.033, (ts - last) / 1000 || 0.016); last = ts;
  G.time += dt;
  if (G.mode === 'win') G.winT = (G.winT || 0) + dt;
  if (ready && G.mode !== 'title') {
    if (G.rewinding) updateRewind(dt);
    else if (G.mode === 'play' || G.mode === 'over') {
      // hit-stop: a short slow-motion after decisive kills, easing back to full speed
      var ts = 1;
      if (G.slowT > 0) { var q = G.slowT / G.slowD; ts = 1 - 0.8 * q * q; G.slowT -= dt; }
      update(dt * ts);
    }
  }
  Music.sync(G.mode);
  render();
  if (post && postOn && view === post.canvas) {
    var rk = G.rewinding ? Math.min(1, G.rewinding.spd / 40) : 0;
    var fxp = G.mode === 'title' || !S ? { heat: [], shocks: [], beam: null, rays: [] } : postSources();
    post.render({ time: G.time, threshold: 0.62, bloom: 0.85 + 0.35 * warpAmtSafe(), aberration: 0.002 + 0.012 * rk + 0.01 * warpAmtSafe(), grain: 0.035,
      lw: W, lh: H, heat: fxp.heat, shocks: fxp.shocks, beam: fxp.beam, rays: fxp.rays,
      lights: G.mode === 'title' ? [] : (G.postLights || []), mask: maskCv,
      tile: G.space ? G.space.tile : null, tileOff: G.space ? G.space.off : 0,
      scrollV: G.mode === 'title' || !S ? 6 : (G.mode === 'play' || G.mode === 'over' ? S.sp * 0.12 * (1 + 28 * warpAmt()) : 0),
      splats: fxp.splats || [], dof: G.mode === 'title' ? 0.45 : 0.6 + 0.4 * (G.slowT > 0 ? G.slowT / G.slowD : 0), flare: 1 });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- input ----------
window.addEventListener('keydown', function (e) {
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
  if (e.code === 'Enter') { if (G.mode === 'title' || G.mode === 'win' || G.mode === 'over') { if (ready) startGame(); } }
  else if (e.code === 'KeyR') tryRewind();
  else if (e.code === 'KeyG') setPost(!postOn);
  else if (e.code === 'KeyP') { if (G.mode === 'play') { G.mode = 'pause'; Sfx.pauseOn(); } else if (G.mode === 'pause') { G.mode = 'play'; Sfx.pauseOff(); } }
});
window.addEventListener('keyup', function (e) { keys[e.code] = false; });
window.addEventListener('blur', function () { keys = {}; ptr.down = false; ptr.active = false; if (G.mode === 'play') G.mode = 'pause'; });
function toGame(e) { var r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; }
function onView(type, fn) { cv.addEventListener(type, fn); if (post) post.canvas.addEventListener(type, fn); }
onView('pointerdown', function (e) {
  var q = toGame(e);
  if (G.mode === 'title') { if (!Amb.isOn()) Amb.start(); else startGame(); return; }   // first tap = sound (audio needs a gesture), second = play
  if (G.mode === 'win') { startGame(); return; }
  if (q.x > W - 100 && q.y > H - 40) { tryRewind(); return; }
  if (G.mode === 'over') { if (G.rw > 0 && snaps.length >= 5) tryRewind(); else startGame(); return; }
  if (G.mode === 'pause') { G.mode = 'play'; Sfx.pauseOff(); return; }
  ptr.down = true; ptr.active = true; ptr.x = q.x; ptr.y = q.y;
  try { view.setPointerCapture(e.pointerId); } catch (x) { }
});
onView('pointermove', function (e) { if (ptr.active) { var q = toGame(e); ptr.x = q.x; ptr.y = q.y; } });
function pend() { ptr.down = false; ptr.active = false; }
onView('pointerup', pend); onView('pointercancel', pend);
onView('contextmenu', function (e) { e.preventDefault(); });
// browsers only allow audio after a user gesture: the title ambience starts on the first key press / touch
function ambGesture() { if (G.mode === 'title') Amb.start(); }
window.addEventListener('keydown', function (e) { if (e.code !== 'Enter') ambGesture(); });
window.addEventListener('pointerdown', function () { /* tap starts the game: nothing to do */ });
if (post && !postOn) setPost(false);
view.focus();

// debug hook for automated tests
window.__rw = { Amb: Amb, Music: Music, G: G, get S() { return S; }, startLevel: startLevel, startGame: startGame, keys: keys, snaps: function () { return snaps.length; } };
})();
