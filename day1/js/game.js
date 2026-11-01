// AIrkanoid - an Arkanoid-style game with a computer-controlled paddle in the middle of the field.

// ---------- Layout constants (logical resolution) ----------
const W = 640;
const H = 720;
const HUD_H = 56;
const WALL = 14;
const FIELD_L = WALL;
const FIELD_R = W - WALL;
const FIELD_T = HUD_H + WALL;
// Default brick size (19-column grid); a level can override it with brickW / brickH
const BRICK_W = 32;
const BRICK_H = 18;
const GRID_Y = 110;
const PLAYER_Y = 680;
const PLAYER_H = 22;
const CPU_Y = 420;
const CPU_H = 24;
const CPU_W = 104;
const BALL_R = 8;
const SHIELD_Y = H - 14;
const BASE_SPEED = 360;
const MAX_BALLS = 12;

const COLOR_BY_CHAR = { b: 'blue', g: 'green', y: 'yellow', o: 'orange', r: 'red', p: 'purple', c: 'cyan', m: 'magenta' };
const COLOR_HEX = { blue: '#3b82f6', green: '#22c55e', yellow: '#facc15', orange: '#f97316', red: '#ef4444', purple: '#a855f7' };
const BRICK_POINTS = { blue: 50, green: 60, yellow: 70, orange: 80, red: 90, purple: 100 };

// Space Invaders level: aliens replace the bricks, march in formation and shoot at the player
const ALIEN_POINTS = { green: 150, cyan: 120, magenta: 100, orange: 80, red: 60 };
const ALIEN_W = 52;
const ALIEN_H = 38;
const ALIEN_BODY_W = 52; // width of the alien body in the atlas sprite, without its glow (see tools/make_atlas.py)
const ALIEN_SHOT_SPEED = 220;
const ALIEN_MAX_DROP = 90;

// "CPU attack" negative power-up: the CPU paddle shoots plasma balls aimed at the player.
// Shots are spaced out so they can be dodged.
const CPU_SHOT_SPEED = 200;
const CPU_FIRE_DELAY = 1.7;

// Warp power-up: opens a gate in the right wall at paddle height; driving the paddle
// through it skips to the next level with a bonus
const GATE_H = 60;
const WARP_BONUS = 10000;

// CPU paddle difficulty for each level
const CPU_DIFFICULTY = [
  { speed: 190, noise: 80, react: 0.32, aim: 0.15 },
  { speed: 235, noise: 68, react: 0.24, aim: 0.4 },
  { speed: 280, noise: 58, react: 0.18, aim: 0.6 }
];

const POWERUPS = {
  extraBall: { weight: 12, label: 'EXTRA BALL' },
  multiBall: { weight: 12, label: 'MULTI BALL' },
  grow: { weight: 12, label: 'BIG PADDLE', time: 15 },
  shrink: { weight: 8, label: 'SMALL PADDLE', time: 12, bad: true },
  speed: { weight: 10, label: 'SLOW BALL', time: 10 },
  shield: { weight: 10, label: 'SHIELD', time: 12 },
  time: { weight: 10, label: 'CPU FROZEN', time: 8 },
  points: { weight: 12, label: '+1000' },
  bomb: { weight: 8, label: 'BOMB!' },
  life: { weight: 4, label: '1UP' },
  laser: { weight: 10, label: 'LASER! HOLD FIRE', time: 10 },
  cpuGun: { weight: 8, label: 'CPU ATTACK!', time: 10, bad: true },
  warp: { weight: 3, label: 'WARP GATE OPEN' },
  steel: { weight: 6, label: 'STEEL BALL', time: 6 }
};
const DROP_CHANCE = 0.18;
const MAX_CAPSULES = 3;
const BULLET_SPEED = 700;
const FIRE_DELAY = 0.22;

const HISCORE_KEY = 'airkanoid.highscores';
const DEFAULT_SCORES = [
  ['SEG', 30000], ['C64', 25000], ['ARK', 20000], ['TAI', 15000],
  ['AMI', 10000], ['NES', 7500], ['ZXS', 5000], ['MSX', 2500]
].map(([name, score]) => ({ name, score }));

// ---------- Canvas and assets ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const atlasImg = new Image();
atlasImg.src = 'assets/atlas.png';
const titleImg = new Image();
titleImg.src = 'assets/title.png';
const winImg = new Image();
winImg.src = 'assets/win.png';

function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = Math.floor(W * scale) + 'px';
  canvas.style.height = Math.floor(H * scale) + 'px';
  canvas.width = Math.floor(W * scale * dpr);
  canvas.height = Math.floor(H * scale * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function spr(name, x, y, w, h) {
  const f = ATLAS_FRAMES[name];
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(atlasImg, f[0], f[1], f[2], f[3], x, y, w, h);
}

// Draws a paddle sprite stretched horizontally while keeping its end caps intact.
function sprSliced(name, x, y, w, h, g = ctx) {
  const f = ATLAS_FRAMES[name];
  const capSrc = Math.round(f[2] * 0.15);
  const capDst = Math.min(capSrc * h / f[3], w / 3);
  g.imageSmoothingEnabled = true;
  g.drawImage(atlasImg, f[0], f[1], capSrc, f[3], x, y, capDst, h);
  g.drawImage(atlasImg, f[0] + capSrc, f[1], f[2] - capSrc * 2, f[3], x + capDst, y, w - capDst * 2, h);
  g.drawImage(atlasImg, f[0] + f[2] - capSrc, f[1], capSrc, f[3], x + w - capDst, y, capDst, h);
}

// Pre-rendered starfield background, plus the HUD panel and metal frame on their own layer
// so they can be drawn on top of any level background
const bgCanvas = document.createElement('canvas');
const frameCanvas = document.createElement('canvas');
const twinkles = [];
function buildBackground() {
  bgCanvas.width = W;
  bgCanvas.height = H;
  let g = bgCanvas.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#02030d');
  grad.addColorStop(0.6, '#050c2e');
  grad.addColorStop(1, '#0a1f5c');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const nx = Math.random() * W, ny = HUD_H + Math.random() * (H - HUD_H);
    const neb = g.createRadialGradient(nx, ny, 0, nx, ny, 160);
    neb.addColorStop(0, i % 2 ? 'rgba(120,60,200,0.12)' : 'rgba(40,90,220,0.14)');
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = neb;
    g.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 220; i++) {
    const s = Math.random() < 0.85 ? 1 : 2;
    g.fillStyle = Math.random() < 0.7 ? '#cfe3ff' : '#7aa7ff';
    g.globalAlpha = 0.3 + Math.random() * 0.7;
    g.fillRect(Math.floor(Math.random() * W), Math.floor(Math.random() * H), s, s);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 40; i++) {
    twinkles.push({ x: Math.random() * W, y: HUD_H + Math.random() * (H - HUD_H), p: Math.random() * 6.28 });
  }

  frameCanvas.width = W;
  frameCanvas.height = H;
  g = frameCanvas.getContext('2d');

  // HUD panel
  const hud = g.createLinearGradient(0, 0, 0, HUD_H);
  hud.addColorStop(0, '#0b1230');
  hud.addColorStop(1, '#050816');
  g.fillStyle = hud;
  g.fillRect(0, 0, W, HUD_H);
  g.fillStyle = '#1e3a8a';
  g.fillRect(0, HUD_H - 2, W, 2);

  // Metal pipes (left, right, top)
  const pipeV = (x) => {
    const pg = g.createLinearGradient(x, 0, x + WALL, 0);
    pg.addColorStop(0, '#3f4652');
    pg.addColorStop(0.35, '#e5e9f0');
    pg.addColorStop(0.6, '#9aa3b2');
    pg.addColorStop(1, '#2b3039');
    g.fillStyle = pg;
    g.fillRect(x, HUD_H, WALL, H - HUD_H);
  };
  pipeV(0);
  pipeV(W - WALL);
  const pt = g.createLinearGradient(0, HUD_H, 0, HUD_H + WALL);
  pt.addColorStop(0, '#3f4652');
  pt.addColorStop(0.35, '#e5e9f0');
  pt.addColorStop(0.6, '#9aa3b2');
  pt.addColorStop(1, '#2b3039');
  g.fillStyle = pt;
  g.fillRect(0, HUD_H, W, WALL);
  // joints
  g.fillStyle = '#1b1f27';
  for (let y = HUD_H + 80; y < H; y += 120) {
    g.fillRect(0, y, WALL, 3);
    g.fillRect(W - WALL, y, WALL, 3);
  }
  for (let x = 100; x < W; x += 140) g.fillRect(x, HUD_H, 3, WALL);
}
buildBackground();

// ---------- High scores ----------
function loadScores() {
  try {
    const data = JSON.parse(localStorage.getItem(HISCORE_KEY));
    if (Array.isArray(data) && data.length) return data;
  } catch (e) { /* ignore broken storage */ }
  return DEFAULT_SCORES.slice();
}

function saveScores(list) {
  try { localStorage.setItem(HISCORE_KEY, JSON.stringify(list)); } catch (e) { /* storage unavailable */ }
}

function qualifies(score) {
  const list = game.highScores;
  return score > 0 && (list.length < 8 || score > list[list.length - 1].score);
}

function insertScore(name, score) {
  const list = game.highScores;
  list.push({ name, score });
  list.sort((a, b) => b.score - a.score);
  list.length = Math.min(list.length, 8);
  saveScores(list);
  game.lastEntry = list.findIndex((e) => e.name === name && e.score === score);
}

// ---------- Game state ----------
const game = {
  state: 'intro',
  stateTime: 0,
  time: 0,
  paused: false,
  score: 0,
  lives: 3,
  level: 0,
  speedRamp: 1,
  bricks: [],
  balls: [],
  capsules: [],
  bullets: [],
  fireCooldown: 0,
  effects: {},
  booms: [],
  ghosts: [],
  shards: [],
  enemyShots: [],
  inv: { ox: 0, oy: 0, dir: 1, stepT: 0, frame: 0, fireT: 0 },
  floaters: [],
  player: { x: W / 2, w: 96, flash: 0, visible: true },
  cpu: { x: W / 2, target: W / 2, react: 0, gunT: 0 },
  highScores: loadScores(),
  lastEntry: -1,
  entry: { letters: [0, 0, 0], pos: 0 },
  // Attract mode: the computer plays level 1 by itself
  demo: false,
  demoTime: 0,
  demoAim: 0,
  demoTarget: W / 2
};

const input = { left: false, right: false, mouseX: null, fire: false };

const IN_GAME_STATES = ['levelIntro', 'play', 'dying', 'levelClear', 'warping'];

function setState(s) {
  game.state = s;
  game.stateTime = 0;
  // Give the mouse back outside of the game itself
  if (!IN_GAME_STATES.includes(s) && document.pointerLockElement === canvas) document.exitPointerLock();
}

function difficulty() {
  return CPU_DIFFICULTY[Math.min(game.level, CPU_DIFFICULTY.length - 1)];
}

// The CPU paddle is not used on every level (e.g. Space Invaders)
function hasCpu() {
  return !LEVELS[game.level].noCpu;
}

function ballSpeed() {
  return BASE_SPEED * (1 + 0.08 * game.level) * game.speedRamp * (game.effects.speed ? 0.65 : 1);
}

function newGame() {
  game.score = 0;
  game.lives = 3;
  startLevel(0);
}

function startLevel(i) {
  game.level = i;
  game.bricks = [];
  const lv = LEVELS[i];
  const bw = lv.brickW || BRICK_W, bh = lv.brickH || BRICK_H;
  const cols = lv.rows[0].length;
  const gridX = (FIELD_L + FIELD_R) / 2 - cols * bw / 2;
  lv.rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) {
      const ch = row[c] || '.';
      const color = COLOR_BY_CHAR[ch.toLowerCase()];
      if (!color) continue;
      const hits = ch === ch.toUpperCase() ? 3 : 1;
      if (lv.aliens) {
        // Aliens are smaller than their grid cell; base position is moved by the formation offset
        const x = gridX + c * bw + (bw - ALIEN_W) / 2, y = GRID_Y + r * bh + (bh - ALIEN_H) / 2;
        game.bricks.push({
          col: c, row: r, color, hits: 1, maxHits: 1, alive: true, alien: true,
          x, y, baseX: x, baseY: y, w: ALIEN_W, h: ALIEN_H
        });
        continue;
      }
      game.bricks.push({
        col: c, row: r, color, hits, maxHits: hits, alive: true,
        x: gridX + c * bw, y: GRID_Y + r * bh, w: bw, h: bh
      });
    }
  });
  game.inv = { ox: 0, oy: 0, dir: 1, stepT: 0.5, frame: 0, fireT: 1.5 };
  game.cpu.x = game.cpu.target = W / 2;
  game.warped = false;
  resetRound();
  setState('levelIntro');
  Sfx.levelStart();
  Music.reset(game.demo ? DEMO_SONG : game.level);
}

// Clears transient objects and puts a fresh ball on the paddle.
function resetRound() {
  game.balls = [];
  game.capsules = [];
  game.bullets = [];
  game.enemyShots = [];
  game.effects = {};
  game.warpOpen = false;
  game.speedRamp = 1;
  game.player.visible = true;
  game.player.w = 96;
  game.balls.push({ x: game.player.x, y: 0, vx: 0, vy: 0, stuck: true, offset: 0, cpuNoise: 0 });
}

function launchBalls() {
  game.balls.forEach((b) => {
    if (!b.stuck) return;
    b.stuck = false;
    const a = (Math.random() - 0.5) * 0.7;
    const s = ballSpeed();
    b.vx = Math.sin(a) * s;
    b.vy = -Math.cos(a) * s;
    planCpuShot(b);
  });
}

// ---------- CPU paddle ----------
function predictX(ball, ty) {
  if (ball.vy === 0) return ball.x;
  const t = (ty - ball.y) / ball.vy;
  if (t < 0) return ball.x;
  const L = FIELD_L + BALL_R, R = FIELD_R - BALL_R, span = R - L;
  let u = (ball.x + ball.vx * t - L) % (2 * span);
  if (u < 0) u += 2 * span;
  if (u > span) u = 2 * span - u;
  return L + u;
}

// Decides how the CPU will try to hit this ball: an aim offset plus some human-like error.
function planCpuShot(ball) {
  const d = difficulty();
  const half = CPU_W / 2;
  if (Math.random() < d.aim) {
    // Aim the return shot away from the player's paddle
    const mag = 10 + Math.random() * half * 0.7;
    ball.cpuNoise = game.player.x < W / 2 ? -mag : mag;
  } else {
    ball.cpuNoise = (Math.random() * 2 - 1) * d.noise;
  }
  game.cpu.react = d.react;
}

function updateCpu(dt) {
  const cpu = game.cpu;
  if (game.effects.time) return;
  const d = difficulty();
  const half = CPU_W / 2;
  const hitY = CPU_Y + CPU_H / 2 + BALL_R;

  // Most urgent ball coming up from below
  let threat = null, best = Infinity;
  for (const b of game.balls) {
    if (b.stuck || b.vy >= 0 || b.y < hitY) continue;
    const t = (b.y - hitY) / -b.vy;
    if (t < best) { best = t; threat = b; }
  }

  if (threat) {
    cpu.target = predictX(threat, hitY) + threat.cpuNoise;
  } else {
    // Get out of the way of balls falling towards the player, otherwise drift to the center
    let dodge = null;
    for (const b of game.balls) {
      if (!b.stuck && b.vy > 0 && b.y < CPU_Y) { dodge = predictX(b, CPU_Y); break; }
    }
    if (dodge !== null && Math.abs(dodge - cpu.x) < half + 30) {
      cpu.target = dodge > W / 2 ? dodge - half - 40 : dodge + half + 40;
    } else if (dodge === null) {
      cpu.target += (W / 2 - cpu.target) * Math.min(1, dt * 0.5);
    }
  }

  if (cpu.react > 0) {
    cpu.react -= dt;
    return;
  }
  const diff = cpu.target - cpu.x;
  const step = d.speed * dt;
  cpu.x += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
  cpu.x = Math.max(FIELD_L + half, Math.min(FIELD_R - half, cpu.x));
}

// ---------- Ball physics ----------
function setBallAngle(ball, angle, up) {
  const s = ballSpeed();
  ball.vx = Math.sin(angle) * s;
  ball.vy = Math.cos(angle) * s * (up ? -1 : 1);
}

// Avoid near-horizontal trajectories that take forever, and perfectly vertical ones that loop
function fixAngle(ball) {
  const s = Math.hypot(ball.vx, ball.vy);
  if (Math.abs(ball.vy) < s * 0.3) {
    ball.vy = Math.sign(ball.vy || 1) * s * 0.3;
    ball.vx = Math.sign(ball.vx || 1) * Math.sqrt(s * s - ball.vy * ball.vy);
  } else if (Math.abs(ball.vx) < s * 0.12) {
    ball.vx = (ball.vx ? Math.sign(ball.vx) : Math.random() < 0.5 ? -1 : 1) * s * 0.12;
    ball.vy = Math.sign(ball.vy) * Math.sqrt(s * s - ball.vx * ball.vx);
  }
}

function stepBall(ball, dt) {
  const prevY = ball.y;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Walls
  if (ball.x < FIELD_L + BALL_R) { ball.x = FIELD_L + BALL_R; ball.vx = Math.abs(ball.vx); Sfx.wall(); }
  if (ball.x > FIELD_R - BALL_R) { ball.x = FIELD_R - BALL_R; ball.vx = -Math.abs(ball.vx); Sfx.wall(); }
  if (ball.y < FIELD_T + BALL_R) { ball.y = FIELD_T + BALL_R; ball.vy = Math.abs(ball.vy); Sfx.wall(); }

  // Shield
  if (game.effects.shield && ball.vy > 0 && ball.y + BALL_R > SHIELD_Y) {
    ball.y = SHIELD_Y - BALL_R;
    ball.vy = -Math.abs(ball.vy);
    Sfx.wall();
  }

  // Player paddle
  const p = game.player;
  if (p.visible && ball.vy > 0 && ball.y + BALL_R >= PLAYER_Y - PLAYER_H / 2 && prevY <= PLAYER_Y &&
      Math.abs(ball.x - p.x) <= p.w / 2 + BALL_R) {
    const off = Math.max(-1, Math.min(1, (ball.x - p.x) / (p.w / 2 + BALL_R)));
    game.speedRamp = Math.min(1.35, game.speedRamp + 0.01);
    setBallAngle(ball, off * Math.PI / 3, true);
    ball.y = PLAYER_Y - PLAYER_H / 2 - BALL_R;
    p.flash = 0.2;
    planCpuShot(ball);
    if (game.demo) game.demoAim = (Math.random() - 0.5) * 0.9;
    Sfx.paddle();
  }

  // CPU paddle: the bottom side sends rising balls back to the player,
  // the top side bounces falling balls back up towards the bricks
  const c = game.cpu;
  if (hasCpu() && Math.abs(ball.x - c.x) <= CPU_W / 2 + BALL_R) {
    const off = Math.max(-1, Math.min(1, (ball.x - c.x) / (CPU_W / 2 + BALL_R)));
    if (ball.vy < 0 && ball.y - BALL_R <= CPU_Y + CPU_H / 2 && prevY >= CPU_Y) {
      setBallAngle(ball, off * Math.PI * 0.3, false);
      ball.y = CPU_Y + CPU_H / 2 + BALL_R;
      Sfx.cpu();
    } else if (ball.vy > 0 && ball.y + BALL_R >= CPU_Y - CPU_H / 2 && prevY <= CPU_Y) {
      setBallAngle(ball, off * Math.PI * 0.3, true);
      ball.y = CPU_Y - CPU_H / 2 - BALL_R;
      Sfx.cpu();
    }
  }

  // Bricks (one hit per step). A steel ball smashes through every brick it touches without bouncing.
  for (const br of game.bricks) {
    if (!br.alive) continue;
    const cx = Math.max(br.x, Math.min(ball.x, br.x + br.w));
    const cy = Math.max(br.y, Math.min(ball.y, br.y + br.h));
    const dx = ball.x - cx, dy = ball.y - cy;
    if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
    if (game.effects.steel) {
      hitBrick(br, true, true);
      Sfx.steel();
      continue;
    }
    const bcx = br.x + br.w / 2, bcy = br.y + br.h / 2;
    // Compare normalized overlap to decide which face was hit
    const nx = (ball.x - bcx) / (br.w / 2 + BALL_R);
    const ny = (ball.y - bcy) / (br.h / 2 + BALL_R);
    if (Math.abs(nx) > Math.abs(ny)) {
      ball.vx = Math.sign(nx) * Math.abs(ball.vx);
      ball.x = nx > 0 ? br.x + br.w + BALL_R : br.x - BALL_R;
    } else {
      ball.vy = Math.sign(ny) * Math.abs(ball.vy);
      ball.y = ny > 0 ? br.y + br.h + BALL_R : br.y - BALL_R;
    }
    hitBrick(br);
    break;
  }
  fixAngle(ball);
}

// force: destroy regardless of remaining hits; drop: allow a power-up drop (default only for normal hits)
function hitBrick(br, force, drop = !force) {
  br.hits = force ? 0 : br.hits - 1;
  if (br.hits > 0) {
    game.score += 10;
    Sfx.hardBrick();
    return;
  }
  br.alive = false;
  if (br.alien) {
    game.score += ALIEN_POINTS[br.color];
    game.booms.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, size: 60, t: 0 });
    Sfx.alienDie();
  } else {
    game.score += BRICK_POINTS[br.color] * (br.maxHits > 1 ? 2 : 1);
    game.ghosts.push({ x: br.x, y: br.y, w: br.w, h: br.h, color: COLOR_HEX[br.color], t: 0.35 });
    Sfx.brick();
  }
  if (drop && Math.random() < DROP_CHANCE && game.capsules.length < MAX_CAPSULES) {
    game.capsules.push({ x: br.x + br.w / 2, y: br.y + br.h / 2, type: randomPowerup(), t: 0 });
  }
}

function randomPowerup() {
  // CPU-related power-ups make no sense on levels without the CPU paddle
  const entries = Object.entries(POWERUPS).filter(([name]) => hasCpu() || name !== 'cpuGun');
  let r = Math.random() * entries.reduce((s, [, p]) => s + p.weight, 0);
  for (const [name, p] of entries) {
    r -= p.weight;
    if (r <= 0) return name;
  }
  return entries[0][0];
}

// ---------- Power-ups ----------
function applyPowerup(type, x, y) {
  const def = POWERUPS[type];
  const fx = game.effects;
  Sfx.powerup();
  // Without a CPU paddle the freeze power-up stops the aliens instead
  const label = type === 'time' && !hasCpu() ? 'ALIENS FROZEN' : def.label;
  game.floaters.push({ x, y: y - 20, text: label, color: def.bad ? '#f87171' : '#fde68a', t: 1.2 });
  switch (type) {
    case 'extraBall':
      if (game.balls.length < MAX_BALLS) {
        const b = { x: game.player.x, y: PLAYER_Y - PLAYER_H / 2 - BALL_R, vx: 0, vy: 0, stuck: false, cpuNoise: 0 };
        setBallAngle(b, (Math.random() - 0.5) * 1.2, true);
        planCpuShot(b);
        game.balls.push(b);
      }
      break;
    case 'multiBall':
      for (const b of game.balls.slice()) {
        if (b.stuck) continue;
        const a = Math.atan2(b.vx, -b.vy);
        for (const da of [-0.4, 0.4]) {
          if (game.balls.length >= MAX_BALLS) break;
          const nb = { x: b.x, y: b.y, vx: 0, vy: 0, stuck: false, cpuNoise: b.cpuNoise };
          const s = Math.hypot(b.vx, b.vy);
          nb.vx = Math.sin(a + da) * s;
          nb.vy = -Math.cos(a + da) * s;
          game.balls.push(nb);
        }
      }
      break;
    case 'grow':
      delete fx.shrink;
      fx.grow = def.time;
      break;
    case 'shrink':
      delete fx.grow;
      fx.shrink = def.time;
      break;
    case 'speed':
    case 'shield':
    case 'time':
    case 'laser':
    case 'steel':
    case 'cpuGun':
      fx[type] = def.time;
      if (type === 'cpuGun') game.cpu.gunT = 0.8;
      if (type === 'time') Sfx.freeze();
      break;
    case 'points':
      game.score += 1000;
      break;
    case 'bomb':
      bombBricks();
      break;
    case 'life':
      game.lives = Math.min(9, game.lives + 1);
      break;
    case 'warp':
      game.warpOpen = true;
      break;
  }
}

// The paddle has reached the gate: it slides out of the field, then the level ends
function startWarp() {
  game.balls = [];
  game.capsules = [];
  game.bullets = [];
  game.enemyShots = [];
  Sfx.warp();
  setState('warping');
}

function updateWarp(dt) {
  const p = game.player;
  p.x += 300 * dt;
  if (p.x - p.w / 2 > W) {
    p.visible = false;
    game.warped = true;
    game.score += WARP_BONUS;
    Sfx.levelClear();
    setState('levelClear');
  }
}

// Blows up a random brick and its neighbours, hard bricks included
function bombBricks() {
  const alive = game.bricks.filter((b) => b.alive);
  if (!alive.length) return;
  const center = alive[Math.floor(Math.random() * alive.length)];
  for (const b of alive) {
    if (Math.abs(b.col - center.col) <= 1 && Math.abs(b.row - center.row) <= 1) hitBrick(b, true);
  }
  game.booms.push({ x: center.x + center.w / 2, y: center.y + center.h / 2, size: 110, t: 0 });
  Sfx.explode();
}

// ---------- Update ----------
function updatePlayer(dt) {
  const p = game.player;
  if (game.demo) {
    const diff = game.demoTarget - p.x, step = 650 * dt;
    p.x += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
  } else if (input.left || input.right) {
    p.x += (input.right ? 1 : -1) * 560 * dt;
  } else if (input.mouseX !== null) {
    p.x = input.mouseX;
  }
  const targetW = game.effects.grow ? 150 : game.effects.shrink ? 64 : 96;
  p.w += (targetW - p.w) * Math.min(1, dt * 10);
  // With the warp gate open the paddle may slide halfway into the right wall
  p.x = Math.max(FIELD_L + p.w / 2, Math.min(game.warpOpen ? FIELD_R : FIELD_R - p.w / 2, p.x));
  p.flash = Math.max(0, p.flash - dt);

  for (const b of game.balls) {
    if (!b.stuck) continue;
    b.x = p.x + b.offset;
    b.y = PLAYER_Y - PLAYER_H / 2 - BALL_R;
  }
}

// Laser power-up: two cannons on the paddle ends fire while the fire button is held
function updateBullets(dt) {
  const p = game.player;
  game.fireCooldown -= dt;
  if (game.effects.laser && input.fire && game.fireCooldown <= 0 && !game.balls.some((b) => b.stuck)) {
    game.fireCooldown = FIRE_DELAY;
    const y = PLAYER_Y - PLAYER_H / 2;
    game.bullets.push({ x: p.x - p.w / 2 + 8, y }, { x: p.x + p.w / 2 - 8, y });
    Sfx.laser();
  }

  const c = game.cpu;
  for (const bl of game.bullets) {
    const prevY = bl.y;
    bl.y -= BULLET_SPEED * dt;
    if (bl.y < FIELD_T) { bl.done = true; continue; }
    // The CPU paddle shields the bricks from bullets
    if (hasCpu() && prevY >= CPU_Y && bl.y <= CPU_Y + CPU_H / 2 && Math.abs(bl.x - c.x) <= CPU_W / 2) {
      bl.done = true;
      game.ghosts.push({ x: bl.x - 6, y: CPU_Y + CPU_H / 2 - 6, w: 12, h: 12, color: '#fde047', t: 0.15 });
      continue;
    }
    for (const br of game.bricks) {
      if (br.alive && bl.x >= br.x && bl.x <= br.x + br.w && bl.y <= br.y + br.h && bl.y + 12 >= br.y) {
        hitBrick(br);
        bl.done = true;
        break;
      }
    }
  }
  game.bullets = game.bullets.filter((bl) => !bl.done);
}

// Aliens step sideways as a block, drop down at the edges, speed up as they thin out,
// and the lowest alien of a column shoots at the player
function updateInvaders(dt) {
  const inv = game.inv;
  const alive = game.bricks.filter((b) => b.alive);
  if (!alive.length || game.effects.time) return;

  inv.stepT -= dt;
  if (inv.stepT <= 0) {
    inv.stepT = 0.12 + 0.45 * alive.length / game.bricks.length;
    inv.frame ^= 1;
    const minX = Math.min(...alive.map((b) => b.x));
    const maxX = Math.max(...alive.map((b) => b.x + b.w));
    if ((inv.dir > 0 && maxX + 10 > FIELD_R - 4) || (inv.dir < 0 && minX - 10 < FIELD_L + 4)) {
      inv.dir = -inv.dir;
      if (inv.oy < ALIEN_MAX_DROP) inv.oy += 10;
    } else {
      inv.ox += 10 * inv.dir;
    }
    for (const b of game.bricks) {
      b.x = b.baseX + inv.ox;
      b.y = b.baseY + inv.oy;
    }
  }

  // Hold fire while the ball is still on the paddle
  if (game.balls.some((b) => b.stuck)) return;
  inv.fireT -= dt;
  if (inv.fireT <= 0) {
    inv.fireT = 0.9 + Math.random() * (0.6 + alive.length / game.bricks.length);
    const lowest = {};
    for (const b of alive) if (!lowest[b.col] || b.row > lowest[b.col].row) lowest[b.col] = b;
    const shooters = Object.values(lowest);
    // A third of the shots come from the alien closest to the player
    const shooter = Math.random() < 0.35
      ? shooters.reduce((a, b) => Math.abs(b.x + b.w / 2 - game.player.x) < Math.abs(a.x + a.w / 2 - game.player.x) ? b : a)
      : shooters[Math.floor(Math.random() * shooters.length)];
    game.enemyShots.push({ x: shooter.x + shooter.w / 2, y: shooter.y + shooter.h, vx: 0, vy: ALIEN_SHOT_SPEED, h: 16, t: 0 });
    Sfx.alienShot();
  }
}

// The CPU paddle fires at the player's current position while the "CPU attack" malus is active
function updateCpuGun(dt) {
  const c = game.cpu;
  if (!game.effects.cpuGun || game.effects.time || game.balls.some((b) => b.stuck)) return;
  c.gunT -= dt;
  if (c.gunT > 0) return;
  c.gunT = CPU_FIRE_DELAY;
  const y = CPU_Y + CPU_H / 2 + 6;
  const dx = game.player.x - c.x, dy = PLAYER_Y - y;
  const len = Math.hypot(dx, dy);
  game.enemyShots.push({ x: c.x, y, vx: dx / len * CPU_SHOT_SPEED, vy: dy / len * CPU_SHOT_SPEED, h: 10, cpu: true, t: 0 }); // hitbox a bit smaller than the glow, to be fair
  Sfx.cpuShot();
}

// Shots from aliens and from the CPU paddle; s.y is the top of the shot, s.h its height
function updateEnemyShots(dt) {
  const p = game.player;
  for (const s of game.enemyShots) {
    s.t += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (game.effects.shield && s.y + s.h >= SHIELD_Y) { s.done = true; continue; }
    // Laser bullets can shoot enemy shots down
    for (const bl of game.bullets) {
      if (!bl.done && Math.abs(bl.x - s.x) < 7 && bl.y <= s.y + s.h && bl.y + 12 >= s.y) {
        bl.done = s.done = true;
        break;
      }
    }
    if (!s.done && p.visible && s.y + s.h >= PLAYER_Y - PLAYER_H / 2 && s.y <= PLAYER_Y + PLAYER_H / 2 &&
        Math.abs(s.x - p.x) <= p.w / 2) {
      s.done = true;
      loseLife();
      return;
    }
  }
  game.enemyShots = game.enemyShots.filter((s) => !s.done && s.y < H);
}

// The paddle explodes: used when the last ball is lost or an alien shot hits the paddle
function loseLife() {
  const p = game.player;
  p.visible = false;
  game.balls = [];
  game.capsules = [];
  game.bullets = [];
  game.enemyShots = [];
  game.booms.push({ x: p.x, y: PLAYER_Y, size: 150, t: 0 });
  Sfx.explode();
  Sfx.loseLife();
  setState('dying');
}

function updatePlay(dt) {
  updatePlayer(dt);
  if (game.warpOpen && game.player.x >= FIELD_R - 6) {
    startWarp();
    return;
  }
  if (hasCpu()) updateCpu(dt);

  // Timed effects
  for (const k of Object.keys(game.effects)) {
    game.effects[k] -= dt;
    if (game.effects[k] <= 0) {
      delete game.effects[k];
      if (k === 'time' && hasCpu()) shatterIce();
    }
  }

  // Keep every ball at the current target speed
  const s = ballSpeed();
  for (const b of game.balls) {
    if (b.stuck) continue;
    const cur = Math.hypot(b.vx, b.vy) || 1;
    b.vx *= s / cur;
    b.vy *= s / cur;
    const steps = Math.ceil((s * dt) / 4);
    for (let i = 0; i < steps; i++) stepBall(b, dt / steps);
    // Motion trail for the steel ball
    if (game.effects.steel) {
      b.trail = b.trail || [];
      b.trail.unshift({ x: b.x, y: b.y });
      b.trail.length = Math.min(b.trail.length, 6);
    } else {
      b.trail = null;
    }
  }
  game.balls = game.balls.filter((b) => b.y - BALL_R < H);

  updateBullets(dt);
  if (LEVELS[game.level].aliens) updateInvaders(dt);
  if (hasCpu()) updateCpuGun(dt);
  updateEnemyShots(dt);
  if (game.state !== 'play') return;

  // Falling capsules
  const p = game.player;
  for (const c of game.capsules) {
    c.t += dt;
    c.y += 140 * dt;
    if (c.y + 14 >= PLAYER_Y - PLAYER_H / 2 && c.y - 14 <= PLAYER_Y + PLAYER_H / 2 &&
        Math.abs(c.x - p.x) <= p.w / 2 + 14) {
      c.done = true;
      applyPowerup(c.type, c.x, c.y);
    }
  }
  game.capsules = game.capsules.filter((c) => !c.done && c.y < H + 20);

  if (!game.bricks.some((b) => b.alive)) {
    game.score += 1000 * (game.level + 1);
    game.capsules = [];
    game.bullets = [];
    Sfx.levelClear();
    setState('levelClear');
    return;
  }

  if (!game.balls.length) loseLife();
}

function updateEffects(dt) {
  for (const b of game.booms) b.t += dt;
  game.booms = game.booms.filter((b) => b.t < 7 * 0.08);
  for (const g of game.ghosts) g.t -= dt;
  game.ghosts = game.ghosts.filter((g) => g.t > 0);
  for (const f of game.floaters) { f.t -= dt; f.y -= 30 * dt; }
  game.floaters = game.floaters.filter((f) => f.t > 0);
  for (const sh of game.shards) {
    sh.t -= dt;
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    sh.vy += 600 * dt;
    sh.rot += sh.spin * dt;
  }
  game.shards = game.shards.filter((sh) => sh.t > 0);
}

// The frozen CPU paddle thaws by breaking its ice shell into falling shards
function shatterIce() {
  const c = game.cpu;
  for (let i = 0; i < 16; i++) {
    game.shards.push({
      x: c.x + (Math.random() - 0.5) * CPU_W, y: CPU_Y + (Math.random() - 0.5) * CPU_H,
      vx: (Math.random() - 0.5) * 240, vy: -Math.random() * 180,
      rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 20,
      size: 3 + Math.random() * 4, t: 0.6 + Math.random() * 0.4
    });
  }
  Sfx.shatter();
}

function finishGame() {
  if (qualifies(game.score)) {
    game.entry = { letters: [0, 0, 0], pos: 0 };
    setState('enterName');
  } else {
    game.lastEntry = -1;
    setState('scores');
  }
}

// ---------- Demo (attract) mode ----------
const DEMO_IDLE_TIME = 5;
const DEMO_MAX_TIME = 60;

function startDemo() {
  game.demo = true;
  game.demoTime = 0;
  game.demoAim = 0;
  game.demoTarget = W / 2;
  Sfx.silent = true;
  newGame();
}

function stopDemo() {
  game.demo = false;
  game.paused = false;
  input.fire = false;
  Sfx.silent = false;
  setState('intro');
}

// Computer player: intercepts the next falling ball (hitting it off-centre to vary the angle),
// otherwise goes for useful power-ups
function updateDemo(dt) {
  game.demoTime += dt;
  if (['levelClear', 'gameOver'].includes(game.state) || game.demoTime > DEMO_MAX_TIME) {
    stopDemo();
    return;
  }
  const p = game.player;
  const hitY = PLAYER_Y - PLAYER_H / 2 - BALL_R;
  let next = null;
  for (const b of game.balls) {
    if (b.stuck || b.vy <= 0) continue;
    if (!next || (hitY - b.y) / b.vy < (hitY - next.y) / next.vy) next = b;
  }
  const capsule = game.capsules.filter((c) => !POWERUPS[c.type].bad).sort((a, b) => b.y - a.y)[0];
  if (next) game.demoTarget = predictX(next, hitY) + game.demoAim * p.w / 2;
  else if (capsule) game.demoTarget = capsule.x;
  input.fire = !!game.effects.laser;
  if (game.state === 'play' && game.balls.some((b) => b.stuck) && game.stateTime > 1) launchBalls();
}

function update(dt) {
  game.time += dt;
  if (game.paused) return;
  game.stateTime += dt;
  updateEffects(dt);
  if (game.demo) {
    updateDemo(dt);
    if (!game.demo) return;
  }

  switch (game.state) {
    case 'intro':
      if (game.stateTime > DEMO_IDLE_TIME) startDemo();
      break;
    case 'levelIntro':
      updatePlayer(dt);
      if (game.stateTime > 2) setState('play');
      break;
    case 'play':
      updatePlay(dt);
      break;
    case 'dying':
      if (hasCpu()) updateCpu(dt);
      if (game.stateTime > 1.4) {
        game.lives--;
        if (game.lives <= 0) {
          Sfx.gameOver();
          setState('gameOver');
        } else {
          resetRound();
          if (!game.demo) Music.reset(game.level); // the level tune restarts from the top after losing a life
          setState('play');
        }
      }
      break;
    case 'warping':
      updateWarp(dt);
      break;
    case 'levelClear':
      if (!game.warped) updatePlayer(dt);
      if (game.stateTime > 2.5) {
        if (game.level + 1 < LEVELS.length) startLevel(game.level + 1);
        else {
          Music.reset(WIN_SONG);
          setState('win');
        }
      }
      break;
    case 'gameOver':
      if (game.stateTime > 3) finishGame();
      break;
    case 'win':
      if (game.stateTime > 15) finishGame();
      break;
    case 'scores':
      if (game.stateTime > 10) setState('intro');
      break;
  }
}

// ---------- Rendering ----------
function pad(n, len) {
  return String(n).padStart(len, '0');
}

// Level 1: starfield with twinkling stars
function drawStars() {
  ctx.drawImage(bgCanvas, 0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  for (const s of twinkles) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(game.time * 2 + s.p);
    ctx.fillRect(s.x, s.y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

// Level 2: calm C64 demo-style horizontal parallax starfield on the classic C64 blue,
// with faint CRT scanlines. Three layers of square pixels drift left at different speeds.
const C64_STAR_LAYERS = [
  { size: 2, speed: 8, color: '#352879' },
  { size: 2, speed: 18, color: '#6c5eb5' },
  { size: 3, speed: 32, color: '#a39be6' }
];
const c64Stars = [];
for (let i = 0; i < 90; i++) {
  c64Stars.push({ x: Math.random() * W, y: HUD_H + Math.random() * (H - HUD_H), layer: i % 3 });
}

function drawC64Stars() {
  const grad = ctx.createLinearGradient(0, HUD_H, 0, H);
  grad.addColorStop(0, '#0d0a2e');
  grad.addColorStop(1, '#1b1550');
  ctx.fillStyle = grad;
  ctx.fillRect(0, HUD_H, W, H - HUD_H);
  for (const st of c64Stars) {
    const l = C64_STAR_LAYERS[st.layer];
    const x = ((st.x - game.time * l.speed) % W + W) % W;
    ctx.fillStyle = l.color;
    ctx.fillRect(Math.floor(x), Math.floor(st.y), l.size, l.size);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let y = HUD_H; y < H; y += 3) ctx.fillRect(0, y, W, 1);
}

// Level 3: Space Harrier style checkerboard floor rushing towards the player,
// rendered pixel by pixel at low resolution and scaled up for a chunky 16-bit look
const FLOOR_W = 160;
const FLOOR_H = (H - HUD_H) / 4;
const FLOOR_HORIZON = 62;
const floorCanvas = document.createElement('canvas');
floorCanvas.width = FLOOR_W;
floorCanvas.height = FLOOR_H;
let floorData = null;

function drawCheckerFloor() {
  const g = floorCanvas.getContext('2d');
  if (!floorData) floorData = g.createImageData(FLOOR_W, FLOOR_H);
  const d = floorData.data;
  const travel = game.time * 1.2;
  const sway = Math.sin(game.time * 0.4) * 1.5; // gentle side drift, as if steering
  const fog = [78, 26, 100]; // matches the sky colour at the horizon
  for (let y = 0; y < FLOOR_H; y++) {
    let i = y * FLOOR_W * 4;
    if (y < FLOOR_HORIZON) {
      // Sky: deep blue fading to a purple glow at the horizon
      const k = (y / FLOOR_HORIZON) ** 2;
      for (let x = 0; x < FLOOR_W; x++, i += 4) {
        d[i] = 8 + 70 * k;
        d[i + 1] = 6 + 20 * k;
        d[i + 2] = 30 + 70 * k;
        d[i + 3] = 255;
      }
      continue;
    }
    const dy = y - FLOOR_HORIZON + 1;
    const z = 80 / dy;
    const row = Math.floor(z + travel) & 1;
    const near = Math.min(1, (dy / (FLOOR_H - FLOOR_HORIZON)) * 1.4);
    for (let x = 0; x < FLOOR_W; x++, i += 4) {
      const wx = (x - FLOOR_W / 2) * z / 24 + sway;
      const light = ((Math.floor(wx) + row) & 1) === 0;
      const c = light ? [30, 95, 70] : [14, 45, 40];
      d[i] = fog[0] + (c[0] - fog[0]) * near;
      d[i + 1] = fog[1] + (c[1] - fog[1]) * near;
      d[i + 2] = fog[2] + (c[2] - fog[2]) * near;
      d[i + 3] = 255;
    }
  }
  g.putImageData(floorData, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(floorCanvas, 0, HUD_H, W, H - HUD_H);
}

// Level 4: dark sky tinted like the alien rows (green at the top to red at the bottom),
// with a slow downward starfield as if the invaders were descending, and faint scanlines
const invaderStars = [];
for (let i = 0; i < 70; i++) {
  invaderStars.push({ x: Math.random() * W, y: Math.random() * (H - HUD_H), speed: 10 + Math.random() * 30 });
}

function drawInvaderSky() {
  const grad = ctx.createLinearGradient(0, HUD_H, 0, H);
  grad.addColorStop(0, '#04160b');
  grad.addColorStop(0.3, '#05121c');
  grad.addColorStop(0.55, '#10071a');
  grad.addColorStop(0.8, '#140c06');
  grad.addColorStop(1, '#180606');
  ctx.fillStyle = grad;
  ctx.fillRect(0, HUD_H, W, H - HUD_H);
  for (const st of invaderStars) {
    const y = HUD_H + (st.y + game.time * st.speed) % (H - HUD_H);
    ctx.globalAlpha = 0.25 + st.speed / 60;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(st.x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  for (let y = HUD_H; y < H; y += 3) ctx.fillRect(0, y, W, 1);
}

const LEVEL_BACKGROUNDS = [drawStars, drawC64Stars, drawCheckerFloor, drawInvaderSky];

function drawBackground() {
  // High score screens keep the starfield; gameplay uses the current level's background
  const inGame = !['enterName', 'scores'].includes(game.state);
  (inGame ? LEVEL_BACKGROUNDS[game.level % LEVEL_BACKGROUNDS.length] : drawStars)();
  ctx.drawImage(frameCanvas, 0, 0, W, H);
}

function drawHud() {
  PixelFont.draw(ctx, 'LIVES', 18, 8, 2, '#7dd3fc');
  for (let i = 0; i < Math.min(game.lives, 6); i++) spr('lifeIcon', 18 + i * 30, 28, 26, 16);
  if (game.lives > 6) PixelFont.draw(ctx, '+' + (game.lives - 6), 200, 30, 2, '#7dd3fc');
  PixelFont.draw(ctx, 'SCORE', 290, 8, 2, '#fbbf24', 'center');
  PixelFont.draw(ctx, pad(game.score, 6), 290, 26, 3, '#ffffff', 'center');
  PixelFont.draw(ctx, 'LEVEL', 425, 8, 2, '#86efac', 'center');
  PixelFont.draw(ctx, game.level + 1, 425, 26, 3, '#ffffff', 'center');
  const hi = Math.max(game.score, game.highScores[0] ? game.highScores[0].score : 0);
  PixelFont.draw(ctx, 'HI-SCORE', 622, 8, 2, '#f472b6', 'right');
  PixelFont.draw(ctx, pad(hi, 6), 622, 26, 3, '#ffffff', 'right');
}

function drawBricks() {
  const frozen = !!game.effects.time;
  for (const br of game.bricks) {
    if (!br.alive) continue;
    if (br.alien) {
      drawAlien(br, frozen);
      continue;
    }
    const suffix = br.maxHits === 1 || br.hits === 3 ? '' : br.hits === 2 ? 'Dmg' : 'Crk';
    spr('brick_' + br.color + suffix, br.x + 0.5, br.y + 0.5, br.w - 1, br.h - 1);
  }
  // Destroyed bricks leave a fading dashed outline
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 2;
  for (const g of game.ghosts) {
    ctx.globalAlpha = g.t / 0.35;
    ctx.strokeStyle = g.color;
    ctx.strokeRect(g.x + 2, g.y + 2, g.w - 4, g.h - 4);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawAlien(br, frozen) {
  const f = ATLAS_FRAMES['alien_' + br.color + game.inv.frame];
  const sc = br.w / ALIEN_BODY_W;
  const w = f[2] * sc, h = f[3] * sc;
  spr('alien_' + br.color + game.inv.frame, br.x + br.w / 2 - w / 2, br.y + br.h / 2 - h / 2, w, h);
  if (frozen) {
    // Encased in ice while the freeze power-up is active
    ctx.fillStyle = 'rgba(180, 230, 255, 0.4)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(br.x - 3, br.y - 3, br.w + 6, br.h + 6, 6);
    ctx.fill();
    ctx.stroke();
  }
}

function drawEnemyShots() {
  for (const s of game.enemyShots) {
    if (s.cpu) {
      // Pulsing red plasma ball
      const r = 7 + Math.sin(s.t * 20);
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(s.x, s.y + s.h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fee2e2';
      ctx.beginPath();
      ctx.arc(s.x, s.y + s.h / 2, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    // Classic zig-zag alien bolts
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 3;
    const phase = Math.floor(s.t * 12) % 2 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    for (let i = 1; i <= 4; i++) ctx.lineTo(s.x + (i % 2 ? 4 : -4) * phase, s.y + i * 4);
    ctx.stroke();
  }
}

function drawPaddles() {
  const c = game.cpu;
  if (hasCpu()) {
    if (game.effects.time) drawFrozenCpu(c.x - CPU_W / 2, CPU_Y - CPU_H / 2);
    else sprSliced('paddleBig', c.x - CPU_W / 2, CPU_Y - CPU_H / 2, CPU_W, CPU_H);
    if (game.effects.cpuGun) {
      // Cannon under the CPU paddle, its tip glowing just before each shot
      const charge = Math.max(0, 1 - c.gunT / 0.4);
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(c.x - 6, CPU_Y + CPU_H / 2 - 2, 12, 8);
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(c.x - 3, CPU_Y + CPU_H / 2 + 6, 6, 5);
      ctx.fillStyle = 'rgba(239, 68, 68, ' + (0.3 + 0.7 * charge) + ')';
      ctx.fillRect(c.x - 3, CPU_Y + CPU_H / 2 + 10, 6, 3);
    }
  }
  drawShards();

  const p = game.player;
  if (!p.visible) return;
  let name = 'paddle';
  if (game.effects.shrink) name = 'paddleSmall';
  else if (p.flash > 0) name = p.flash > 0.1 ? 'paddleA1' : 'paddleA2';
  sprSliced(name, p.x - p.w / 2, PLAYER_Y - PLAYER_H / 2, p.w, PLAYER_H);
  if (game.effects.laser) {
    // Cannons on both ends of the paddle
    for (const cx of [p.x - p.w / 2 + 8, p.x + p.w / 2 - 8]) {
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(cx - 4, PLAYER_Y - PLAYER_H / 2 - 8, 8, 10);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(cx - 2, PLAYER_Y - PLAYER_H / 2 - 11, 4, 4);
    }
  }
}

function drawBullets() {
  ctx.shadowColor = '#fde047';
  ctx.shadowBlur = 8;
  for (const bl of game.bullets) {
    ctx.fillStyle = '#fde047';
    ctx.fillRect(bl.x - 2, bl.y, 4, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bl.x - 1, bl.y, 2, 6);
  }
  ctx.shadowBlur = 0;
}

// Frozen CPU paddle: icy-tinted sprite inside a translucent ice shell with icicles.
// The ice forms quickly, then cracks and shakes when the effect is about to end.
const iceCanvas = document.createElement('canvas');
const ICICLES = [[0.1, 7], [0.24, 4], [0.38, 9], [0.55, 5], [0.7, 10], [0.86, 6]];

function drawFrozenCpu(x, y) {
  const left = game.effects.time;
  const grow = Math.min(1, (POWERUPS.time.time - left) / 0.3);
  if (left < 1) x += Math.sin(game.time * 70) * 1.5;

  // Paddle tinted blue (drawn off-screen at 2x so the tint stays sharp)
  iceCanvas.width = CPU_W * 2;
  iceCanvas.height = CPU_H * 2;
  const g = iceCanvas.getContext('2d');
  g.scale(2, 2);
  sprSliced('paddleBig', 0, 0, CPU_W, CPU_H, g);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(140, 215, 255, ' + 0.7 * grow + ')';
  g.fillRect(0, 0, CPU_W, CPU_H);
  ctx.drawImage(iceCanvas, x, y, CPU_W, CPU_H);

  // Ice shell
  const pad = 5 * grow;
  const sx = x - pad, sy = y - pad, sw = CPU_W + pad * 2, sh = CPU_H + pad * 2;
  const shell = ctx.createLinearGradient(0, sy, 0, sy + sh);
  shell.addColorStop(0, 'rgba(235, 250, 255, 0.6)');
  shell.addColorStop(1, 'rgba(120, 190, 240, 0.35)');
  ctx.globalAlpha = grow;
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.roundRect(sx, sy, sw, sh, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Glints across the ice
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = 3;
  for (const off of [14, 22, 70]) {
    ctx.beginPath();
    ctx.moveTo(sx + off, sy + sh);
    ctx.lineTo(sx + off + 14, sy);
    ctx.stroke();
  }
  // Cracks when about to thaw
  if (left < 2) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + sw * 0.3, sy);
    ctx.lineTo(sx + sw * 0.36, sy + sh * 0.45);
    ctx.lineTo(sx + sw * 0.31, sy + sh * 0.7);
    ctx.lineTo(sx + sw * 0.38, sy + sh);
    ctx.moveTo(sx + sw * 0.36, sy + sh * 0.45);
    ctx.lineTo(sx + sw * 0.5, sy + sh * 0.55);
    ctx.moveTo(sx + sw * 0.75, sy);
    ctx.lineTo(sx + sw * 0.7, sy + sh * 0.5);
    ctx.lineTo(sx + sw * 0.78, sy + sh);
    ctx.stroke();
  }
  ctx.restore();

  // Icicles hanging from the bottom
  ctx.fillStyle = 'rgba(200, 240, 255, 0.85)';
  for (const [at, len] of ICICLES) {
    const ix = sx + sw * at;
    ctx.beginPath();
    ctx.moveTo(ix - 3, sy + sh - 1);
    ctx.lineTo(ix + 3, sy + sh - 1);
    ctx.lineTo(ix, sy + sh - 1 + len * grow);
    ctx.fill();
  }

  // Twinkling frost sparkles
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const a = Math.sin(game.time * 4 + i * 1.7);
    if (a < 0.3) continue;
    const px = sx + sw * (0.15 + i * 0.23), py = sy + 3 + (i % 2) * (sh - 6);
    ctx.globalAlpha = grow * a;
    ctx.fillRect(px - 3, py - 0.5, 6, 1);
    ctx.fillRect(px - 0.5, py - 3, 1, 6);
  }
  ctx.globalAlpha = 1;
}

function drawShards() {
  ctx.fillStyle = 'rgba(210, 240, 255, 0.9)';
  for (const sh of game.shards) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, sh.t * 2);
    ctx.translate(sh.x, sh.y);
    ctx.rotate(sh.rot);
    ctx.beginPath();
    ctx.moveTo(0, -sh.size);
    ctx.lineTo(sh.size * 0.7, sh.size * 0.6);
    ctx.lineTo(-sh.size * 0.7, sh.size * 0.6);
    ctx.fill();
    ctx.restore();
  }
}

function drawBalls() {
  const frame = Math.floor(game.time * 14) % 9;
  const steel = game.effects.steel;
  for (const b of game.balls) {
    if (steel) drawSteelBall(b, steel);
    else spr('ball' + frame, b.x - BALL_R - 1, b.y - BALL_R - 1, BALL_R * 2 + 2, BALL_R * 2 + 2);
  }
}

// Shiny metal sphere with a fading trail; it blinks when the effect is about to end
function drawSteelBall(b, left) {
  if (b.trail) {
    b.trail.forEach((t, i) => {
      ctx.globalAlpha = 0.3 * (1 - i / b.trail.length);
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (1 - i * 0.1), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  if (left < 1.5 && Math.floor(game.time * 10) % 2) {
    spr('ball0', b.x - BALL_R - 1, b.y - BALL_R - 1, BALL_R * 2 + 2, BALL_R * 2 + 2);
    return;
  }
  const r = BALL_R + 1;
  const g = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.4, r * 0.1, b.x, b.y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, '#d1d5db');
  g.addColorStop(0.8, '#6b7280');
  g.addColorStop(1, '#1f2937');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawCapsules() {
  for (const c of game.capsules) {
    const bob = Math.sin(c.t * 6) * 2;
    spr('pu_' + c.type, c.x - 15, c.y - 15 + bob, 30, 30);
  }
}

function drawBooms() {
  for (const b of game.booms) {
    const f = Math.min(6, Math.floor(b.t / 0.08));
    const s = b.size * (0.3 + 0.7 * (f / 6));
    spr('boom' + f, b.x - s / 2, b.y - s / 2, s, s);
  }
}

function drawWarpGate() {
  if (!game.warpOpen && game.state !== 'warping') return;
  const top = PLAYER_Y - GATE_H / 2;
  // Glow spilling into the field
  const glow = ctx.createRadialGradient(FIELD_R, PLAYER_Y, 0, FIELD_R, PLAYER_Y, 90);
  glow.addColorStop(0, 'rgba(236, 72, 153, 0.35)');
  glow.addColorStop(1, 'rgba(236, 72, 153, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(FIELD_R - 90, PLAYER_Y - 90, 90 + W - FIELD_R, 180);
  // The opening in the wall, with energy lines streaming through it
  ctx.fillStyle = '#05010d';
  ctx.fillRect(FIELD_R, top, W - FIELD_R, GATE_H);
  for (let i = 0; i < 6; i++) {
    const y = top + (game.time * 90 + i * GATE_H / 6) % GATE_H;
    ctx.fillStyle = i % 2 ? 'rgba(236, 72, 153, 0.85)' : 'rgba(103, 232, 249, 0.85)';
    ctx.fillRect(FIELD_R + 2, y, W - FIELD_R - 4, 3);
  }
  ctx.fillStyle = '#f9a8d4';
  ctx.shadowColor = '#ec4899';
  ctx.shadowBlur = 14;
  ctx.fillRect(FIELD_R - 2, top - 3, W - FIELD_R + 2, 3);
  ctx.fillRect(FIELD_R - 2, top + GATE_H, W - FIELD_R + 2, 3);
  ctx.shadowBlur = 0;
  if (game.state === 'play' && blink(2)) PixelFont.draw(ctx, '>>>', FIELD_R - 12, top - 24, 2, '#f472b6', 'right');
}

function drawShieldAndEffects() {
  const fx = game.effects;
  if (fx.shield) {
    const blink = fx.shield < 2 && Math.floor(game.time * 8) % 2;
    if (!blink) {
      ctx.fillStyle = '#22d3ee';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 12;
      ctx.fillRect(FIELD_L, SHIELD_Y, FIELD_R - FIELD_L, 4);
      ctx.shadowBlur = 0;
    }
  }
  // Active effect icons with remaining time
  let x = FIELD_R - 30;
  for (const k of Object.keys(fx)) {
    spr('pu_' + k, x, FIELD_T + 6, 22, 22);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(x, FIELD_T + 30, 22 * Math.min(1, fx[k] / POWERUPS[k].time), 3);
    x -= 28;
  }
}

function drawFloaters() {
  for (const f of game.floaters) {
    ctx.globalAlpha = Math.min(1, f.t * 2);
    PixelFont.draw(ctx, f.text, f.x, f.y, 2, f.color, 'center');
  }
  ctx.globalAlpha = 1;
}

function blink(rate = 2) {
  return Math.floor(game.time * rate * 2) % 2 === 0;
}

function drawPanel(y, h) {
  ctx.fillStyle = 'rgba(2,4,16,0.75)';
  ctx.fillRect(40, y, W - 80, h);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2;
  ctx.strokeRect(40, y, W - 80, h);
}

function drawGame() {
  drawBricks();
  drawWarpGate();
  drawCapsules();
  drawPaddles();
  drawBullets();
  drawEnemyShots();
  drawBalls();
  drawBooms();
  drawShieldAndEffects();
  drawFloaters();

  const st = game.state;
  if (game.demo) {
    PixelFont.draw(ctx, 'DEMO', W / 2, 300, 5, '#fbbf24', 'center');
    if (blink(1)) PixelFont.draw(ctx, 'PRESS ANY KEY', W / 2, 350, 2, '#ffffff', 'center');
  }
  if (st === 'levelIntro') {
    drawPanel(480, 140);
    PixelFont.draw(ctx, 'LEVEL ' + (game.level + 1), W / 2, 500, 6, '#fbbf24', 'center');
    PixelFont.draw(ctx, LEVELS[game.level].name, W / 2, 570, 3, '#7dd3fc', 'center');
  } else if (st === 'play' && !game.demo && game.balls.some((b) => b.stuck) && blink(1.5)) {
    PixelFont.draw(ctx, 'SPACE OR CLICK TO LAUNCH', W / 2, 610, 2, '#ffffff', 'center');
  } else if (st === 'levelClear') {
    drawPanel(480, 140);
    PixelFont.draw(ctx, game.warped ? 'WARP!' : 'LEVEL CLEAR!', W / 2, 500, 5, game.warped ? '#f472b6' : '#86efac', 'center');
    PixelFont.draw(ctx, 'BONUS ' + (game.warped ? WARP_BONUS : 1000 * (game.level + 1)), W / 2, 570, 3, '#ffffff', 'center');
  } else if (st === 'gameOver') {
    drawPanel(460, 120);
    PixelFont.draw(ctx, 'GAME OVER', W / 2, 490, 7, '#ef4444', 'center');
  }
  if (game.paused) {
    drawPanel(480, 100);
    PixelFont.draw(ctx, 'PAUSED', W / 2, 498, 6, '#ffffff', 'center');
    PixelFont.draw(ctx, 'PRESS P OR CLICK TO RESUME', W / 2, 550, 2, '#7dd3fc', 'center');
  }
}

function drawScoreTable(y, count, highlight) {
  PixelFont.draw(ctx, 'HIGH SCORES', W / 2, y, 3, '#f472b6', 'center');
  const colors = ['#fbbf24', '#e5e7eb', '#f97316'];
  game.highScores.slice(0, count).forEach((e, i) => {
    const ry = y + 40 + i * 30;
    const col = i === highlight && blink(3) ? '#22d3ee' : colors[i] || '#93c5fd';
    PixelFont.draw(ctx, (i + 1) + '.', 190, ry, 3, col, 'right');
    PixelFont.draw(ctx, e.name, 220, ry, 3, col);
    PixelFont.draw(ctx, pad(e.score, 6), 450, ry, 3, col, 'right');
  });
}

function drawIntro() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (titleImg.complete && titleImg.naturalWidth) {
    const w = 560, h = w * titleImg.naturalHeight / titleImg.naturalWidth;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(titleImg, (W - w) / 2, 6, w, h);
  }
  if (blink(1.2)) PixelFont.draw(ctx, 'PRESS SPACE OR CLICK TO START', W / 2, 438, 2, '#ffffff', 'center');
  drawScoreTable(466, 5, -1);
  PixelFont.draw(ctx, 'MOUSE / ARROWS: MOVE   SPACE: LAUNCH', W / 2, 658, 2, '#7dd3fc', 'center');
  PixelFont.draw(ctx, 'P: PAUSE   M: MUTE', W / 2, 680, 2, '#7dd3fc', 'center');
  PixelFont.draw(ctx, 'BEAT THE RED CPU PADDLE!', W / 2, 702, 2, '#ef4444', 'center');
}

function drawEnterName() {
  drawPanel(240, 380);
  PixelFont.draw(ctx, 'NEW HIGH SCORE!', W / 2, 280, 4, '#fbbf24', 'center');
  PixelFont.draw(ctx, pad(game.score, 6), W / 2, 340, 5, '#ffffff', 'center');
  PixelFont.draw(ctx, 'ENTER YOUR INITIALS', W / 2, 420, 2, '#7dd3fc', 'center');
  const e = game.entry;
  for (let i = 0; i < 3; i++) {
    const x = W / 2 - 75 + i * 75;
    const active = i === e.pos;
    const ch = String.fromCharCode(65 + e.letters[i]);
    if (!active || blink(3)) PixelFont.draw(ctx, ch, x, 460, 7, active ? '#22d3ee' : '#ffffff', 'center');
    ctx.fillStyle = active ? '#22d3ee' : '#475569';
    ctx.fillRect(x - 22, 518, 44, 4);
  }
  PixelFont.draw(ctx, 'TYPE OR USE ARROWS, ENTER TO CONFIRM', W / 2, 570, 2, '#94a3b8', 'center');
}

// Horizontal sway of a dancing paddle; side (+1 / -1) mirrors the moves
function danceSway(beat, side) {
  return Math.sin(Math.PI * beat / 2) * 26 * side;
}

// One dancing paddle: hops on every beat, squashes on landing, sways and tilts.
// side (+1 / -1) mirrors the moves so the two paddles dance facing each other.
function drawDancer(name, x, y, w, h, beat, side) {
  const f = beat % 1;
  const big = Math.floor(beat) % 4 === 0; // higher jump on the first beat of each bar
  const hop = Math.sin(Math.PI * f) * (big ? 34 : 18);
  const squash = f < 0.15 ? 1 - (0.15 - f) / 0.15 * 0.35 : 1; // flattened right after landing
  const sway = danceSway(beat, side);
  const tilt = Math.sin(Math.PI * beat) * 0.18 * side;
  ctx.save();
  ctx.translate(x + sway, y - hop);
  ctx.rotate(tilt);
  ctx.scale(2 - squash, squash);
  sprSliced(name, -w / 2, -h, w, h);
  ctx.restore();
  // Shadow on the floor, smaller while in the air
  const sh = 1 - hop / 50;
  ctx.fillStyle = 'rgba(125, 211, 252, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x + sway, y + 6, w / 2 * sh, 4 * sh, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Balls juggled by the dancing paddles. Every bounce happens exactly on a beat, when a paddle
// is back on the floor and squashed, so each ball follows a parabola between two landing spots.
// Ball: dancer indices it travels between, offset on the paddle, flight time and arc height (beats, px).
const DANCE_Y = 630;
const WIN_BALLS = [
  { from: 0, to: 1, dx: 0, flight: 2, start: 0, arc: 110 },
  { from: 1, to: 0, dx: 0, flight: 2, start: 1, arc: 110 },
  { from: 0, to: 0, dx: -0.32, flight: 1, start: 0, arc: 60 },
  { from: 1, to: 1, dx: 0.32, flight: 1, start: 0, arc: 60 }
];

function drawWinBalls(dancers, beat) {
  const frame = Math.floor(game.time * 14) % 9;
  for (const b of WIN_BALLS) {
    const t = beat - b.start;
    if (t < 0) continue;
    const seg = Math.floor(t / b.flight);
    const k = (t - seg * b.flight) / b.flight;
    // Landing spot on dancer d at beat n (top of the squashed paddle)
    const spot = (d, n) => ({ x: d.x + danceSway(n, d.side) + d.w * b.dx, y: DANCE_Y - d.h * 0.65 - BALL_R });
    const a = spot(dancers[seg % 2 ? b.to : b.from], b.start + seg * b.flight);
    const c = spot(dancers[seg % 2 ? b.from : b.to], b.start + (seg + 1) * b.flight);
    const x = a.x + (c.x - a.x) * k;
    const y = a.y + (c.y - a.y) * k - 4 * b.arc * k * (1 - k);
    spr('ball' + frame, x - BALL_R - 1, y - BALL_R - 1, BALL_R * 2 + 2, BALL_R * 2 + 2);
  }
}

// Victory screen: the "YOU WIN!" picture, the final score and the two paddles dancing to the music
function drawWin() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (winImg.complete && winImg.naturalWidth) {
    const h = W * winImg.naturalHeight / winImg.naturalWidth;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(winImg, 0, 62, W, h);
  }
  PixelFont.draw(ctx, 'CONGRATULATIONS!', W / 2, 18, 4, '#fbbf24', 'center');
  PixelFont.draw(ctx, 'YOU BEAT THE CPU AND ALL ' + LEVELS.length + ' LEVELS', W / 2, 440, 2, '#ffffff', 'center');
  PixelFont.draw(ctx, 'SCORE ' + pad(game.score, 6), W / 2, 470, 4, '#7dd3fc', 'center');

  // Follow the music when it plays (it may be muted), otherwise keep the victory song tempo
  let beat = Music.beat();
  if (beat < 0) beat = game.stateTime * SONGS[WIN_SONG].bpm / 60;
  const dancers = [
    { name: 'paddleBig', x: W / 2 - 130, w: CPU_W, h: CPU_H, side: 1 },
    { name: 'paddle', x: W / 2 + 130, w: game.player.w, h: PLAYER_H, side: -1 }
  ];
  for (const d of dancers) drawDancer(d.name, d.x, DANCE_Y, d.w, d.h, beat, d.side);
  drawWinBalls(dancers, beat);

  if (game.stateTime > 3 && blink(1)) PixelFont.draw(ctx, 'PRESS SPACE', W / 2, 690, 2, '#ffffff', 'center');
}

function render() {
  // The title screen shows only the title image and its text, without playfield or HUD
  if (game.state === 'intro') {
    drawIntro();
    return;
  }
  if (game.state === 'win') {
    drawWin();
    return;
  }
  drawBackground();
  if (game.state === 'enterName') {
    drawEnterName();
  } else if (game.state === 'scores') {
    drawPanel(200, 380);
    drawScoreTable(230, 8, game.lastEntry);
    if (blink(1)) PixelFont.draw(ctx, 'PRESS SPACE', W / 2, 545, 2, '#ffffff', 'center');
  } else {
    drawGame();
  }
  drawHud();
}

// ---------- Input ----------
function confirmName() {
  const name = game.entry.letters.map((l) => String.fromCharCode(65 + l)).join('');
  insertScore(name, game.score);
  Sfx.powerup();
  setState('scores');
}

function primaryAction() {
  Sfx.init();
  switch (game.state) {
    case 'intro':
      newGame();
      break;
    case 'levelIntro':
      setState('play');
      break;
    case 'play':
      if (!game.paused) launchBalls();
      break;
    case 'scores':
      setState('intro');
      break;
    case 'win':
      if (game.stateTime > 3) finishGame();
      break;
    case 'enterName':
      confirmName();
      break;
  }
}

function handleNameKey(e) {
  const en = game.entry;
  if (/^[a-zA-Z]$/.test(e.key)) {
    en.letters[en.pos] = e.key.toUpperCase().charCodeAt(0) - 65;
    en.pos = Math.min(2, en.pos + 1);
    Sfx.select();
  } else if (e.key === 'ArrowUp') {
    en.letters[en.pos] = (en.letters[en.pos] + 1) % 26;
    Sfx.select();
  } else if (e.key === 'ArrowDown') {
    en.letters[en.pos] = (en.letters[en.pos] + 25) % 26;
    Sfx.select();
  } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
    en.pos = Math.max(0, en.pos - 1);
  } else if (e.key === 'ArrowRight') {
    en.pos = Math.min(2, en.pos + 1);
  } else if (e.key === 'Enter') {
    confirmName();
  }
}

// Any key, click or touch during the demo goes back to the title screen;
// on the title screen it resets the idle timer (mouse movement alone does not)
function demoInterrupt() {
  if (game.state === 'intro') game.stateTime = 0;
  if (!game.demo) return false;
  stopDemo();
  return true;
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (demoInterrupt()) return;
  if (game.state === 'enterName') {
    Sfx.init();
    handleNameKey(e);
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { input.left = true; input.mouseX = null; }
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { input.right = true; input.mouseX = null; }
  else if (e.key === ' ' || e.key === 'Enter') {
    input.fire = true;
    if (!e.repeat) primaryAction();
  }
  else if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') &&
           IN_GAME_STATES.includes(game.state)) game.paused = !game.paused;
  else if (e.key === 'm' || e.key === 'M') Sfx.muted = !Sfx.muted;
  else if (e.key === 'N' && e.shiftKey && !game.paused && ['play', 'levelIntro'].includes(game.state)) 
  {
    // Cheat for testing: Shift+N clears the current level
    game.bricks.forEach((b) => { b.alive = false; });
    setState('play');
  }
  else if (e.key === 'F' && e.shiftKey && !game.paused && game.state === 'play') {
    // Cheat for testing: Shift+F drops a "freeze CPU" capsule right below the CPU paddle
    game.capsules.push({ x: game.player.x, y: CPU_Y + 40, type: 'time', t: 0 });
  }
  else if (e.key === 'S' && e.shiftKey && !game.paused && game.state === 'play') {
    // Cheat for testing: Shift+S drops a "steel ball" capsule right above the player's paddle
    game.capsules.push({ x: game.player.x, y: CPU_Y + 40, type: 'steel', t: 0 });
  }
  else if (e.key === 'W' && e.shiftKey && !game.paused && game.state === 'play') {
    // Cheat for testing: Shift+W drops a "warp" capsule right above the player's paddle
    game.capsules.push({ x: game.player.x, y: CPU_Y + 40, type: 'warp', t: 0 });
  }
  else if (e.key === 'G' && e.shiftKey && !game.paused && game.state === 'play' && hasCpu()) {
    // Cheat for testing: Shift+G drops a "CPU attack" capsule right below the CPU paddle
    game.capsules.push({ x: game.player.x, y: CPU_Y + 40, type: 'cpuGun', t: 0 });
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') input.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') input.right = false;
  if (e.key === ' ' || e.key === 'Enter') input.fire = false;
});

function pointerX(clientX) {
  const r = canvas.getBoundingClientRect();
  return Math.max(FIELD_L, Math.min(FIELD_R, (clientX - r.left) / r.width * W));
}

// While playing, the mouse is captured (pointer lock) so the cursor stays hidden
// and the paddle keeps responding even when the mouse goes past the playfield.
function lockPointer() {
  if (document.pointerLockElement === canvas || !canvas.requestPointerLock) return;
  try {
    const req = canvas.requestPointerLock();
    if (req && req.catch) req.catch(() => {});
  } catch (e) { /* pointer lock not available: window-wide tracking still works */ }
}

document.addEventListener('pointerlockchange', () => {
  // Esc releases the lock: pause the game instead of losing the paddle
  if (!document.pointerLockElement && IN_GAME_STATES.includes(game.state)) game.paused = true;
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    const r = canvas.getBoundingClientRect();
    const base = input.mouseX === null ? game.player.x : input.mouseX;
    input.mouseX = Math.max(FIELD_L, Math.min(FIELD_R, base + e.movementX / r.width * W));
  } else {
    input.mouseX = pointerX(e.clientX);
  }
});
canvas.addEventListener('mousedown', () => {
  if (demoInterrupt()) return;
  input.fire = true;
  if (game.paused) {
    game.paused = false;
    lockPointer();
    return;
  }
  primaryAction();
  if (IN_GAME_STATES.includes(game.state)) lockPointer();
});
window.addEventListener('mouseup', () => { input.fire = false; });
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (demoInterrupt()) return;
  input.mouseX = pointerX(e.touches[0].clientX);
  input.fire = true;
  primaryAction();
}, { passive: false });
canvas.addEventListener('touchend', () => { input.fire = false; });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  input.mouseX = pointerX(e.touches[0].clientX);
}, { passive: false });

// ---------- Main loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  update(dt);
  // The demo plays its own soft tune throughout; real games only during actual play and the victory screen
  Music.update(!game.paused && (game.demo || game.state === 'play' || game.state === 'win'));
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
