'use strict';
// The game starts once the bitmap sprite sheet has loaded.
function startGame(sheet, logo) {
  // ================================================================== constants
  const W = 320, H = 180;          // logical screen: HUD, backgrounds, particles, menus
  const R = 2, VW = W * R, VH = H * R; // the 3D view (road, sprites, cars) renders at twice that
  const SEG = 200, RUMBLE = 3, ROAD_W = 2000, LANES = 3;
  const CAM_H = 1000, CAM_D = 1 / Math.tan(50 * Math.PI / 180), PLAYER_Z = CAM_H * CAM_D;
  const DRAW_DIST = 220;
  const MAX_SPEED = SEG * 60, ACCEL = MAX_SPEED / 5, BRAKING = -MAX_SPEED, DECEL = -MAX_SPEED / 5;
  const OFF_DECEL = -MAX_SPEED / 2, OFF_LIMIT = MAX_SPEED / 4, CENTRIFUGAL = 0.3;
  const SPLIT_END = 4, COMMIT_SPLIT = 1.15, FORK_LEAD = 70, FORK_LEN = 300, BODY_LEN = 1900, GOAL_IN = 140;
  const START_TIME = 62, TIME_BONUS = 58, KMH = 293;
  const LANE_X = [-0.66, 0, 0.66];

  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const crt = document.getElementById('crt');
  // overlay canvas at the real display resolution, used by the title screen only
  const hud = document.getElementById('hud');
  const hctx = hud.getContext('2d');
  let hudDirty = false;

  function fit() {
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    const w = Math.floor(W * s), h = Math.floor(H * s);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    crt.style.width = w + 'px'; crt.style.height = h + 'px';
    hud.style.width = w + 'px'; hud.style.height = h + 'px';
    const dpr = window.devicePixelRatio || 1;
    hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
  }
  window.addEventListener('resize', fit);
  fit();

  Gfx.init(sheet);
  const SPR = Gfx.SPR;
  const PLAYER_W = SPR.player[1].ww / ROAD_W;
  for (const k in THEMES) {
    const th = THEMES[k];
    th.key = k; th.bg = Gfx.BG[k];
    // inside a tunnel the road rows use darker colours and the walls hide the ground
    if (th.tunnel) {
      const dk = c => Gfx.mix(c, '#100c1c', 0.4);
      th.tunnel.th = Object.assign({}, th, { road: th.road.map(dk), rumble: th.rumble.map(dk), lane: dk(th.lane), water: null,
        groundL: th.tunnel.wall, groundR: th.tunnel.wall });
    }
  }

  // ================================================================== utils
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5);
  const smooth = t => t * t * (3 - 2 * t);
  function overlap(x1, w1, x2, w2, pct = 1) {
    const h = pct / 2;
    return !((x1 + w1 * h) < (x2 - w2 * h) || (x1 - w1 * h) > (x2 + w2 * h));
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ================================================================== state
  let segments = [], stages = [], cars = [], particles = [], smoke = [], msgs = [], carSegs = [];
  let position = 0, playerX = 0, speed = 0, steer = 0, offroad = false;
  let curStage = null, runSeed = 1;
  let state = 'title', pausedFrom = null, stateT = 0, T = 0;
  let timeLeft = 0, fuel = 100, damage = 0, score = 0, coins = 0;
  let route = [], endReason = '', bonus = null;
  let prevSplit = 0, prevFork = false, lastItemIdx = 0;
  let aiVis = 0, wheelPhase = 0;
  let roadVy = 0, roadAcc = 0, accMax = 0;        // vertical motion of the road under the car
  let sparks = [], sag = 0, scrapeT = 0, sparkGlow = 0, landT = 0, landK = 0;
  // jumps: height of the car above the road and its vertical speed (world units)
  let airH = 0, airV = 0, airT = 0, airMax = 0, crestArmed = true;
  // a crest sharper than CREST_FROM (road vertical acceleration, measured at full speed: the
  // sharp ones go from -10000 to -27000, a handful per minute) kicks the car up by 900..2400/s
  let AIR_G = 8000;
  const CREST_FROM = 8000;
  const jumpV = c => clamp(900 + (c - CREST_FROM) * 0.08, 900, 2400) * speed / MAX_SPEED;
  const TUNNEL_W = 1.35, TUNNEL_H = 2300;
  // overtaking streak, radio DJ tag, photo finish, tunnel
  let streak = 0, streakPop = 0, radioTag = null, lastTrack = null;
  let photo = null, photoWant = false, camFlash = 0, tunnelK = 0;
  // night lights collected while drawing sprites, perfect start, scenery events
  // light layer: lamps and fireworks are painted on it during the back-to-front pass, nearer
  // sprites punch them out (so a palm in front hides a lamp behind it), and the layer is added
  // over the scene after the night overlay
  const lcv = document.createElement('canvas'); lcv.width = VW; lcv.height = VH;
  const lctx = lcv.getContext('2d');
  let lightOn = false, lightDark = 0;
  const lglow = (x, y, rad, rgb, a) => {
    const g = lctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    lctx.fillStyle = g; lctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  function punch(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    lctx.globalCompositeOperation = 'destination-out';
    lctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    lctx.globalCompositeOperation = 'lighter';
  }
  let lamps = [], gasDownAt = -1, prevGasCd = false, startCheck = false, spinT = 0;
  let fireworks = [], fwT = 2, trainWas = false, trainT = 0, trainB0 = 0;
  // fun stuff: passenger speech bubble, horn, close-call boost, day/night, weather
  let speech = null, hornCD = 0, boostT = 0, saidLowFuel = false;
  // overdrive: a wrench picked up with no damage gives +15 % top speed for a while
  let overT = 0;
  // slipstream: tucked in behind a car for a moment = less drag (+8 % top speed), kept for
  // SLIP_HOLD s after pulling out so the pass gets a slingshot
  let slipT = 0, slipHold = 0, slipK = 0;
  const SLIP_HOLD = 1.5;
  const streaks = Array.from({ length: 22 }, (_, i) => ({ a: (i / 22) * Math.PI * 2 + Math.random() * 0.2, p: Math.random(), v: 0.8 + Math.random() * 0.6 }));
  // how dark the night gets in the current stage (theme nightK, eased across the fork)
  let nightKNow = 1;
  let night = 0, weather = { kind: null, level: 0, said: null }, flash = 0, lightT = 8, thunderT = -1;
  let gust = 0, gustDir = 1, gustT = 6, gustLife = 0, carFx = [], playerRect = null;
  const GUST_LEN = 2.4;
  const drops = Array.from({ length: 260 }, () => ({ x: Math.random() * 640, y: Math.random() * 360, l: 8 + Math.random() * 14, v: 0.8 + Math.random() * 0.4 }));
  const dust = Array.from({ length: 36 }, () => ({ x: Math.random() * 640, y: 120 + Math.random() * 240, l: 6 + Math.random() * 22, v: 0.6 + Math.random() * 0.8 }));
  const POLICE = 'trafficB12', TRUCKS = ['trafficB8', 'trafficB9', 'trafficB14', 'trafficB15'];
  const LINES = {
    bump: ['HEY! WATCH IT!', 'MIND THE PAINT!', 'WHO TAUGHT YOU TO DRIVE?', 'EYES ON THE ROAD!', 'NOT AGAIN...'],
    crash: ['OUCH!', 'NOT THE PALMS!', 'ARE YOU CRAZY?!', 'THAT WILL LEAVE A MARK!'],
    close: ['TOO CLOSE!', 'WOW!', 'THAT WAS NEAR!', 'SHOW OFF!'],
    fuel: ['WE NEED GAS!', 'GRAB THOSE COINS!'],
    police: ["IT'S THE COPS!", 'STEP ON IT!'],
    lost: ['WE LOST THEM!', 'BYE BYE, OFFICER!'],
    rain: ["I'M SOAKED!", 'PUT THE ROOF UP!'],
    sand: ['SAND IN MY EYES!', 'WHAT A STORM!'],
    goal: ['WHAT A RIDE!', 'AGAIN! AGAIN!'],
    jump: ['WE ARE FLYING!', 'WHOA!', 'MY STOMACH!', 'DO IT AGAIN!'],
    tunnel: ['HELLO-O-O!', 'ECHO! ECHO!', 'HONK IN HERE!'],
    streak: ['NOBODY CAN STOP US!', 'EAT OUR DUST!'],
    start: ['WHAT A LAUNCH!', 'GO GO GO!'],
    dolphin: ['DOLPHINS! LOOK!', 'SO CUTE!'],
    tumble: ['WHAT WAS THAT?!', 'GET IT OFF!'],
    fireworks: ['FIREWORKS! SO PRETTY!', 'HAPPY NEW YEAR?!'],
    train: ['A TRAIN! CHOO CHOO!']
  };
  function say(kind, force = false) {
    if (speech && speech.t > 0.6 && !force) return;
    const l = LINES[kind];
    speech = { text: l[(Math.random() * l.length) | 0], t: 1.8 };
  }
  let crashT = 0, crashCD = 0, shake = 0, spawnT = 0, alarmT = 0, aiLane = 0, lastBeep = -1;
  let bgOff = 0;
  let musicSel = 0, hiScore = 0, gas = false;
  try { hiScore = parseInt(localStorage.getItem('retrorun.hi') || '0', 10) || 0; } catch (e) { /* storage unavailable */ }

  // ---- high score table: 10 entries { name, score, time (s, full runs only), stage (1..3 or 4 = goal) }
  const SCORES_KEY = 'retrorun.scores', BEST_KEY = 'retrorun.best', NAME_KEY = 'retrorun.name';
  const DEFAULT_SCORES = [['RRN', 400000], ['MIA', 320000], ['NEO', 260000], ['SUN', 210000], ['PLM', 170000],
    ['BAY', 130000], ['KEY', 100000], ['DSR', 70000], ['VCE', 45000], ['FUN', 25000]]
    .map(([name, score], i) => ({ name, score, time: null, stage: i < 3 ? 3 : i < 7 ? 2 : 1 }));
  let scores = DEFAULT_SCORES, bestTime = null, lastName = 'AAA';
  try {
    const sv = JSON.parse(localStorage.getItem(SCORES_KEY) || 'null');
    if (Array.isArray(sv) && sv.length) scores = sv.slice(0, 10);
    bestTime = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
    lastName = localStorage.getItem(NAME_KEY) || lastName;
  } catch (e) { /* storage unavailable */ }
  hiScore = Math.max(hiScore, scores[0].score);
  const saveScores = () => {
    try {
      localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
      localStorage.setItem(BEST_KEY, JSON.stringify(bestTime));
      localStorage.setItem(NAME_KEY, lastName);
    } catch (e) { /* storage unavailable */ }
  };
  // race clock (from GO to goal / game over, pauses excluded) and the name-entry screen
  let raceTime = 0, finishTime = null, newRank = -1;
  const entry = { name: ['A', 'A', 'A'], pos: 0 };
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!- ';
  // seconds -> m'ss"cc
  const fmtTime = s => {
    if (s === null || s === undefined) return "-'--" + '"--';
    const cs = Math.floor(s * 100);
    return Math.floor(cs / 6000) + "'" + String(Math.floor(cs / 100) % 60).padStart(2, '0') + '"' + String(cs % 100).padStart(2, '0');
  };
  try { musicSel = clamp(parseInt(localStorage.getItem('retrorun.radio') || '0', 10) || 0, 0, 2); } catch (e) { /* storage unavailable */ }

  // ================================================================== track building
  function lastY() { return segments.length ? segments[segments.length - 1].p2.world.y : 0; }

  function addSegment(curve, y, c) {
    const n = segments.length;
    const x = c.center * ROAD_W;
    segments.push({
      index: n, curve, center: c.center, theme: c.theme, stage: c.stage,
      p1: { world: { x, y: lastY(), z: n * SEG }, camera: {}, screen: {} },
      p2: { world: { x, y, z: (n + 1) * SEG }, camera: {}, screen: {} },
      light: Math.floor(n / RUMBLE) % 2 === 0,
      sprites: [], items: [], cars: [], clip: H,
      fork: false, s1: 0, s2: 0, t1: 0, t2: 0, tunnel: 0
    });
  }

  function addRoad(enter, hold, leave, curve, hill, c) {
    const startY = lastY(), endY = startY + Math.round(hill) * SEG, total = enter + hold + leave;
    for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total), c);
    for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total), c);
    for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total), c);
  }

  function buildStage(key, level, center) {
    const th = THEMES[key];
    const rnd = Gfx.rng32(hash(key) ^ (level * 977) ^ runSeed);
    const st = { key, th, level, center, start: segments.length, choice: 0, commitT: 0, next: null, aiSide: rnd() < 0.5 ? -1 : 1 };
    const c = { center, theme: th, stage: st };
    const rint = (a, b) => a + ((rnd() * (b - a + 1)) | 0);

    addRoad(0, 60, 0, 0, 0, c);
    while (segments.length - st.start < BODY_LEN) {
      if (th.tunnel && !st.tunnel && segments.length - st.start > BODY_LEN * 0.4) {
        // flat, gently bending tube with a straight run-up so the portal is seen coming
        addRoad(0, 30, 0, 0, 0, c);
        const a = segments.length;
        addRoad(15, rint(60, 90), 15, (rnd() < 0.5 ? -1 : 1) * 1.2, 0, c);
        st.tunnel = [a, segments.length];
        for (let i = a; i < segments.length; i++) segments[i].tunnel = i === a ? 2 : 1;  // 2 = portal
        addRoad(0, 20, 0, 0, 0, c);
        continue;
      }
      const r = rnd(), dir = rnd() < 0.5 ? -1 : 1;
      const hill = (rnd() * 2 - 1) * th.hill;
      const curve = dir * (1.5 + rnd() * th.curve);
      if (r < 0.22) addRoad(0, rint(40, 100), 0, 0, hill, c);
      else if (r < 0.6) addRoad(rint(25, 50), rint(50, 130), rint(25, 50), curve, hill, c);
      else if (r < 0.82) { addRoad(30, rint(30, 60), 30, curve, hill / 2, c); addRoad(30, rint(30, 60), 30, -curve, -hill / 2, c); }
      else for (let k = 0; k < 3; k++) addRoad(15, 15, 15, 0, (k % 2 ? -1 : 1) * (8 + rnd() * th.hill * 0.6), c);
    }
    st.bodyEnd = segments.length;

    if (th.next && level < 2) {
      addRoad(20, FORK_LEAD - 20, 0, 0, -0.0, c);
      st.forkStart = segments.length;
      const y = lastY();
      for (let i = 0; i < FORK_LEN; i++) {
        addSegment(0, y, c);
        const s = segments[segments.length - 1];
        s.fork = true;
        s.t1 = i / FORK_LEN; s.t2 = (i + 1) / FORK_LEN;
        s.s1 = SPLIT_END * smooth(s.t1); s.s2 = SPLIT_END * smooth(s.t2);
      }
      st.trafficEnd = st.bodyEnd;
    } else {
      addRoad(0, GOAL_IN + 400, 0, 0, 0, c);
      st.goalSeg = st.bodyEnd + GOAL_IN;
      st.trafficEnd = st.goalSeg - 40;
    }
    st.end = segments.length;

    // ---- scenery
    const add = (idx, name, offset, o = {}) => {
      const seg = segments[idx];
      if (!seg) return;
      let s = SPR[name];
      if (Array.isArray(s)) s = s[(rnd() * s.length) | 0];
      seg.sprites.push({ spr: s, offset, ax: o.ax !== undefined ? o.ax : (offset < 0 ? -1 : 0), follow: o.follow || 0, collide: !!o.collide, bob: !!o.bob });
    };
    for (let i = st.start; i < st.end; i++) {
      const n = i - st.start;
      if (n > 6 && n < 18) continue; // keep the gantry area clear
      if (segments[i].tunnel || (st.tunnel && i >= st.tunnel[0] - 2 && i < st.tunnel[0])) continue;
      if (segments[i].fork) th.forkDecor(n, rnd, (name, off, o = {}) => add(i, name, off, Object.assign({}, o, { follow: off < 0 ? -1 : 1 })));
      else th.decorate(n, rnd, (name, off, o) => add(i, name, off, o));
    }
    // scenery events, animated in render(): dolphin pairs jumping beside the bridge, tumbleweeds
    if (key === 'keys' || key === 'desert') {
      for (let i = st.start + 80; i < st.bodyEnd - 20; i += 70 + ((rnd() * 70) | 0)) {
        if (segments[i].tunnel) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        if (key === 'keys') {
          const off = side * (2 + rnd() * 2.5);
          for (const lag of [0, 0.18]) segments[i].sprites.push({ spr: SPR.dolphin[1], offset: off + lag * side * 0.8, ax: -0.5, follow: 0, collide: false, bob: false, dolphin: { lag, t0: -1 } });
        } else segments[i].sprites.push({ spr: SPR.tumble[0], offset: 0, ax: -0.5, follow: 0, collide: false, bob: false, tumble: { side, t0: -1, hit: false } });
      }
    }
    add(st.start + 12, level === 0 ? 'archStart' : 'archCheck', 0, { ax: -0.5 });
    // spectators: a big cheering crowd at the start, a smaller one at each checkpoint
    // (full-body people packed side by side, outermost first so the ones near the kerb overlap them)
    const [from, to, cols] = level === 0 ? [13, 27, 5] : [13, 19, 2];
    for (let k = from; k < to; k++) {
      for (let j = cols - 1; j >= 0; j--) {
        const off = 1.06 + j * 0.17 + rnd() * 0.05;
        add(st.start + k, 'cheer', -off); add(st.start + k, 'cheer', off);
      }
    }
    if (st.goalSeg) add(st.goalSeg, 'archGoal', 0, { ax: -0.5 });
    if (st.forkStart) {
      const sign = Gfx.forkSign(THEMES[th.next[0]].name, THEMES[th.next[1]].name);
      for (const idx of [st.bodyEnd + 6, st.forkStart + 4]) segments[idx].sprites.push({ spr: sign, offset: 0, ax: -0.5, follow: 0, collide: false, bob: false });
    }

    // ---- pickups: coin trails and wrenches
    const lastIdx = (st.forkStart ? st.bodyEnd : st.goalSeg) - 40;
    let n = st.start + 110;
    while (n < lastIdx) {
      const pat = rnd();
      if (pat < 0.45) {
        const lane = LANE_X[(rnd() * 3) | 0];
        for (let k = 0; k < 6; k++) addItem(n + k * 5, 'coin', lane);
      } else {
        const a = LANE_X[(rnd() * 3) | 0], b = LANE_X[(rnd() * 3) | 0];
        for (let k = 0; k < 7; k++) addItem(n + k * 5, 'coin', easeInOut(a, b === a ? -a || 0.66 : b, k / 6));
      }
      n += 100 + ((rnd() * 70) | 0);
    }
    for (const f of [0.28, 0.55, 0.82]) {
      const idx = Math.floor(st.start + 110 + (lastIdx - st.start - 110) * f) + 47;
      if (idx < lastIdx) addItem(idx, 'wrench', LANE_X[(rnd() * 3) | 0]);
    }

    stages.push(st);
    return st;
  }

  function addItem(idx, type, offset) {
    const seg = segments[idx];
    if (seg && !seg.fork) seg.items.push({ type, offset, taken: false });
  }

  function newTrack(seed) {
    segments = []; stages = []; cars = []; particles = []; smoke = []; sparks = []; msgs = []; carSegs = [];
    speech = null; boostT = 0; overT = 0; slipT = 0; slipHold = 0; slipK = 0; flash = 0; gust = 0; weather.level = 0; weather.said = null;
    airH = 0; airV = 0; airT = 0; crestArmed = true; fireworks = []; spinT = 0; trainT = 0; streak = 0; photo = null; photoWant = false; camFlash = 0; tunnelK = 0;
    runSeed = seed;
    curStage = buildStage('miami', 0, 0);
    position = 0; playerX = 0; speed = 0; steer = 0;
    prevSplit = 0; prevFork = false; lastItemIdx = 0; crashT = 0; crashCD = 0; shake = 0;
    route = ['miami'];
    populateTraffic();
  }

  const findSeg = z => segments[clamp(Math.floor(z / SEG), 0, segments.length - 1)];

  function project(p, camX, camY, camZ) {
    p.camera.x = p.world.x - camX;
    p.camera.y = p.world.y - camY;
    p.camera.z = p.world.z - camZ;
    p.screen.scale = CAM_D / p.camera.z;
    p.screen.x = VW / 2 + p.screen.scale * p.camera.x * VW / 2;
    p.screen.y = VH / 2 - p.screen.scale * p.camera.y * VH / 2;
    p.screen.w = p.screen.scale * ROAD_W * VW / 2;
  }

  // Left/right branch splits at a fraction t (0 = p1, 1 = p2) of a fork segment.
  // After the choice, the unused branch veers away so it leaves the view before it ends.
  function splitsAt(seg, t) {
    if (!seg.fork) return [0, 0];
    const s = lerp(seg.s1, seg.s2, t);
    let sL = s, sR = s;
    const st = seg.stage;
    if (st.choice) {
      const ft = lerp(seg.t1, seg.t2, t);
      const e = ft > st.commitT ? 14 * Math.pow((ft - st.commitT) / (1 - st.commitT), 2) : 0;
      if (st.choice > 0) sL += e; else sR += e;
    }
    return [sL, sR];
  }

  const driving = () => state === 'race' || state === 'timeup';

  // horn: cars ahead in the player's lane move out of the way (or hurry up)
  function honk() {
    if (hornCD > 0) return;
    if (overT > 0) { hornCD = 1.2; Sound.hornTune(); }   // overdrive: a musical horn
    else { hornCD = 0.45; Sound.horn(); }
    const pz = position + PLAYER_Z;
    for (const c of cars) {
      if (c.z < pz || c.z - pz > SEG * 24 || c.chase > 0) continue;
      const prel = playerX - findSeg(c.z).center;
      if (Math.abs(prel - c.offset) > 0.5) continue;
      if (c.lc || !startLaneChange(c, 0.2)) c.speed = Math.min(MAX_SPEED * 0.75, c.speed * 1.25);
    }
  }

  // ================================================================== traffic
  function spawnCarAt(idx) {
    const seg = segments[idx];
    if (!seg || seg.fork || idx >= seg.stage.trafficEnd || idx < seg.stage.start + 30) return false;
    const s = SPR.cars[(Math.random() * SPR.cars.length) | 0];
    const truck = TRUCKS.includes(s.name);
    cars.push({
      z: idx * SEG + Math.random() * SEG,
      offset: LANE_X[(Math.random() * 3) | 0] + (Math.random() - 0.5) * 0.1,
      speed: MAX_SPEED * (truck ? 0.14 + Math.random() * 0.12 : 0.22 + Math.random() * 0.33),
      spr: s, w: s.ww / ROAD_W, end: seg.stage.trafficEnd, pct: 0,
      police: s.name === POLICE, truck, lc: null, chase: 0, hit: false, passed: false
    });
    return true;
  }

  function populateTraffic() {
    const pIdx = Math.floor((position + PLAYER_Z) / SEG);
    for (let k = 0; k < curStage.th.traffic; k++) spawnCarAt(pIdx + 30 + ((Math.random() * (DRAW_DIST - 40)) | 0));
  }

  // lane change with the indicator on first (blink seconds), towards a free lane
  function laneFree(c, to) {
    return !cars.some(o => o !== c && Math.abs(o.offset - to) < 0.4 && Math.abs(o.z - c.z) < SEG * 6);
  }
  function startLaneChange(c, blink) {
    const lane = LANE_X.reduce((a, b) => Math.abs(b - c.offset) < Math.abs(a - c.offset) ? b : a);
    const opts = LANE_X.filter(l => Math.abs(l - lane) > 0.1 && Math.abs(l - lane) < 0.8 && laneFree(c, l));
    if (!opts.length) return false;
    const to = opts[(Math.random() * opts.length) | 0];
    c.lc = { to, blink, dir: Math.sign(to - c.offset) };
    return true;
  }

  function updateTraffic(dt) {
    const pz = position + PLAYER_Z;
    let chasing = false;
    for (const c of cars) {
      if (c.chase > 0) {
        // police chase: let the player get ahead, then hunt them down in their lane
        chasing = true;
        c.chase -= dt;
        const behind = c.z < pz - SEG * 0.5;
        const want = behind ? Math.min(MAX_SPEED * 1.02, speed + MAX_SPEED * 0.12) : Math.max(MAX_SPEED * 0.12, speed * 0.55);
        c.speed += (want - c.speed) * Math.min(1, dt * 1.6);
        // behind: hunt the player in their lane; ahead: pull aside so the player can pass
        const pl = clamp(playerX - findSeg(c.z).center, -0.7, 0.7);
        const target = behind ? pl : (pl > 0 ? -0.66 : 0.66);
        c.offset += clamp(target - c.offset, -dt * 0.7, dt * 0.7);
        if (c.chase <= 0) {
          c.speed = MAX_SPEED * 0.25;
          if (driving()) { msg('YOU LOST THEM!', '#20e0f0', 1.6); say('lost', true); }
        }
      } else {
        // follow slower cars in the same lane instead of driving through them
        for (const o of cars) {
          if (o !== c && o.z > c.z && o.z - c.z < SEG * 3 && Math.abs(o.offset - c.offset) < 0.35 && o.speed < c.speed) c.speed = o.speed;
        }
        if (!c.lc && !c.truck && Math.random() < dt * 0.07) startLaneChange(c, 0.9);
        if (c.lc) {
          if (c.lc.blink > 0) c.lc.blink -= dt;
          else {
            const d = c.lc.to - c.offset;
            c.offset += clamp(d, -dt * 0.5, dt * 0.5);
            if (Math.abs(d) < 0.005) { c.offset = c.lc.to; c.lc = null; }
          }
        }
      }
      c.z += c.speed * dt;
    }
    Sound.ambient(weather.kind === 'rain' ? weather.level : 0, weather.kind === 'sand' ? weather.level * (0.6 + gust * 0.6) : 0, chasing ? 1 : 0);
    // chasing police cars are kept even when they fall far behind
    cars = cars.filter(c => (c.z > position - SEG * 8 || (c.chase > 0 && c.z > position - SEG * 80)) && c.z / SEG < c.end);
    let ahead = 0;
    for (const c of cars) if (c.z > pz) ahead++;
    spawnT -= dt;
    if (ahead < curStage.th.traffic && spawnT <= 0) {
      if (spawnCarAt(Math.floor(pz / SEG) + DRAW_DIST - 12 + ((Math.random() * 8) | 0))) spawnT = 0.35;
    }
  }

  // ================================================================== messages & particles
  // img (optional): atlas name drawn on the overlay canvas instead of the text, h game px tall
  function msg(text, color = '#ffffff', t = 2, scale = 1, img = null, h = 0) {
    msgs.push({ text, color, t, max: t, scale, img, h });
    if (msgs.length > 4) msgs.shift();
  }

  // Smoke puffs (logical coords, drawn at view resolution): they grow, slow down and fade.
  // kind: 'tyre' | 'dust' | 'dark' (SPR.puff textures)
  function puff(kind, x, y, vx, vy, size, life, alpha = 0.7) {
    if (smoke.length > 160) return;
    smoke.push({ kind, v: (Math.random() * 4) | 0, x, y, vx, vy, size, grow: size * (1.2 + Math.random()), life, max: life, alpha });
  }

  // Rear tyres sit about 33 logical px either side of the screen centre, on the ground line.
  const TYRE_DX = 33, TYRE_Y = H - 8;
  function emitSmoke(dt) {
    const pct = speed / MAX_SPEED, driving = state === 'race' || state === 'timeup' || state === 'goal';
    const pSeg = findSeg(position + PLAYER_Z);
    const sideKick = -steer * 30;                     // the car slides, the smoke stays behind
    const tyres = (rate, kind, size, life, alpha, sides = [-1, 1]) => {
      for (const sd of sides) {
        let n = rate * dt;
        while (n > 0) {
          if (n >= 1 || Math.random() < n) {
            puff(kind, W / 2 + sd * TYRE_DX + (Math.random() - 0.5) * 8, TYRE_Y - Math.random() * 3,
              sd * (15 + Math.random() * 25) + sideKick, 6 + Math.random() * 14, size * (0.7 + Math.random() * 0.6), life, alpha);
          }
          n -= 1;
        }
      }
    };
    // burnout: revving on the grid or flooring it from low speed
    if (spinT > 0) tyres(45, 'tyre', 11, 1.0, 0.75);
    if ((state === 'countdown' && keys.gas) || (driving && gas && pct < 0.35 && !offroad)) {
      tyres(state === 'countdown' ? 22 : 30 * (1 - pct / 0.35), 'tyre', 9, 0.9, 0.65);
    }
    if (driving && pct > 0.15 && airH < 20) {
      // cornering hard or steering at speed: the outer tyre smokes (both on tight bends)
      const bend = Math.abs(pSeg.curve);
      if (!offroad && steer !== 0 && pct > 0.55 && (bend >= 2 || pct > 0.85)) {
        tyres(10 + bend * 3 * pct, 'tyre', 7, 0.6, 0.5, bend >= 4 ? [-1, 1] : [-steer]);
      }
      if (!offroad && keys.brake && pct > 0.4) tyres(16 * pct, 'tyre', 7, 0.55, 0.5);
      if (offroad) tyres(18 + 25 * pct, 'dust', 10, 0.8, 0.75);
    }
    // damaged engine: dark smoke rising from the engine cover
    if (damage > 50 && state !== 'title' && Math.random() < dt * damage / 8) {
      puff('dark', W / 2 + (Math.random() - 0.5) * 44, H - 24, (Math.random() - 0.5) * 12 + sideKick * 0.5, -18 - Math.random() * 10, 7, 1.1, damage > 80 ? 0.75 : 0.5);
    }
    for (const p of smoke) {
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.2 * dt;
      p.size += p.grow * dt;
    }
    smoke = smoke.filter(p => p.life > 0);
  }

  // ---- sparks: the floor scrapes the tarmac when the suspension bottoms out in a dip.
  // View coordinates (VW x VH). Thresholds measured in play: road vertical acceleration is
  // below ~1600 95 % of the time and peaks around 10000 in the deepest dips.
  const SPARK_FROM = 3000, SPARK_FULL = 7000;
  function updateSparks(dt) {
    const moving = state === 'race' || state === 'timeup' || state === 'goal' || state === 'title';
    let k = moving && speed > MAX_SPEED * 0.3 && crashT <= 0 && airH <= 0
      ? clamp((roadAcc - SPARK_FROM) / (SPARK_FULL - SPARK_FROM), 0, 1) : 0;
    if (landT > 0) { landT -= dt; k = Math.max(k, landK); }
    sag = Math.max(sag * Math.pow(0.002, dt), roadAcc > SPARK_FROM * 0.6 && moving && airH <= 0 ? Math.min(4, roadAcc / 1500) : 0);
    sparkGlow += ((k > 0 ? 0.5 + 0.5 * k : 0) - sparkGlow) * Math.min(1, dt * 14);
    if (k > 0) {
      let n = (12 + 90 * k) * dt;                       // a few sparks per scrape, not a fountain
      const ground = VH - 5 * R;
      while (n > 0) {
        if (n >= 1 || Math.random() < n) {
          const side = Math.random() - 0.5;
          const life = 0.12 + Math.random() * 0.22;
          // they leave the floor low, skim the tarmac and come towards the camera, so the road
          // point under each spark (its floor) slides down the screen as it flies
          sparks.push({
            x: VW / 2 + side * 104, y: ground - 1 - Math.random() * 3,
            vx: side * 460 + (Math.random() - 0.5) * 200 - steer * 120,
            vy: -15 - Math.random() * 90 * (0.4 + k),
            floor: ground + 1, fv: 40 + Math.random() * 120,
            life, max: life, px: 0, py: 0
          });
        }
        n -= 1;
      }
      scrapeT -= dt;
      if (scrapeT <= 0) { scrapeT = 0.07; Sound.scrape(); }
    }
    for (const p of sparks) {
      p.px = p.x; p.py = p.y;
      p.life -= dt;
      p.vy += 1600 * dt;
      p.vx *= 1 - 0.8 * dt;
      p.floor += p.fv * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.4; p.vx *= 0.8; } // skips on the tarmac
    }
    sparks = sparks.filter(p => p.life > 0 && p.x > -10 && p.x < VW + 10);
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  }

  function drawSparks() {
    if (!sparks.length && sparkGlow < 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (sparkGlow > 0.02) {                       // hot glow on the tarmac under the floor
      const gy = VH - 5 * R - 2;
      const gr = ctx.createRadialGradient(VW / 2, gy, 4, VW / 2, gy, 90);
      gr.addColorStop(0, `rgba(255,170,60,${0.3 * sparkGlow})`);
      gr.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(VW / 2 - 100, gy - 18, 200, 30);
    }
    for (const p of sparks) {
      const age = 1 - p.life / p.max;               // white-hot -> yellow -> orange -> red
      const head = age < 0.25 ? '#fffbe8' : age < 0.55 ? '#ffe070' : age < 0.8 ? '#ff9a30' : '#e0401a';
      const tail = age < 0.4 ? '#ffb040' : '#c03010';
      const a = Math.min(1, p.life / p.max * 2.2);
      // streak from the last position (x2 for motion blur), drawn as 2x2 pixels
      const dx = (p.x - p.px) * 2, dy = (p.y - p.py) * 2;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
      ctx.fillStyle = tail;
      for (let i = steps; i > 0; i--) {
        ctx.globalAlpha = a * (1 - i / (steps + 1)) * 0.8;
        ctx.fillRect(Math.round(p.x - dx * i / steps), Math.round(p.y - dy * i / steps), 2, 2);
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = head;
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    }
    ctx.restore();
  }

  // ================================================================== atmosphere
  // Day/night: one cycle every NIGHT_CYCLE seconds of racing, starting at sunset, so a run goes
  // sunset -> night -> dawn. Weather comes from the stage theme (rain in the bayou, sand in the
  // desert) and fades in and out, also across the fork into the next stage.
  const NIGHT_CYCLE = 240;
  function updateAtmosphere(dt, pSeg) {
    hornCD = Math.max(0, hornCD - dt);
    boostT = Math.max(0, boostT - dt);
    overT = Math.max(0, overT - dt);
    if (speech) { speech.t -= dt; if (speech.t <= 0) speech = null; }
    const racing = state !== 'title';
    const ph = (raceTime / NIGHT_CYCLE + 0.12) % 1;
    const nWant = racing ? 0.5 - 0.5 * Math.cos(ph * Math.PI * 2) : 0;
    night += (nWant - night) * Math.min(1, dt * 0.8);
    // weather of the stage under the car, or of the next one once the fork is committed
    let th = pSeg.theme;
    if (pSeg.fork && pSeg.stage.choice && pSeg.stage.next) th = pSeg.stage.next.th;
    nightKNow += ((th.nightK !== undefined ? th.nightK : 1) - nightKNow) * Math.min(1, dt * 0.5);
    const want = racing ? th.weather || null : null;
    if (weather.kind !== want) {
      weather.level = Math.max(0, weather.level - dt * 0.6);
      if (weather.level <= 0) weather.kind = want;
    } else if (want) weather.level = Math.min(1, weather.level + dt * 0.35);
    // weather comment only once the checkpoint banners are gone, so nothing covers the road
    if (weather.kind && weather.level > 0.9 && !msgs.length && weather.said !== weather.kind && driving()) { weather.said = weather.kind; say(weather.kind, true); }
    // rain: drops, lightning and thunder
    if (weather.kind === 'rain') {
      const slant = -40 - steer * 90;
      for (const d of drops) {
        d.y += 900 * d.v * dt; d.x += slant * dt;
        if (d.y > VH) { d.y -= VH + 20; d.x = Math.random() * VW; }
        if (d.x < -20) d.x += VW + 40; else if (d.x > VW + 20) d.x -= VW + 40;
      }
      lightT -= dt;
      if (lightT <= 0 && weather.level > 0.6) { flash = 1; thunderT = 0.3 + Math.random() * 0.9; lightT = 7 + Math.random() * 10; }
    }
    flash = Math.max(0, flash - dt * 3.5);
    if (thunderT > 0) { thunderT -= dt; if (thunderT <= 0) { Sound.thunder(); shake = Math.max(shake, 0.15); } }
    // sand: gusts every few seconds and flying grit
    if (weather.kind === 'sand') {
      gustT -= dt;
      if (gustT <= 0) { gustT = 5 + Math.random() * 5; gustDir = Math.random() < 0.5 ? -1 : 1; gustLife = GUST_LEN; }
      gustLife = Math.max(0, gustLife - dt);
      gust = gustLife > 0 ? Math.sin(Math.PI * (1 - gustLife / GUST_LEN)) : 0;   // rises and falls in GUST_LEN s
      const vx = gustDir * (500 + 500 * gust);
      for (const d of dust) {
        d.x += vx * d.v * dt;
        if (d.x > VW + 30) { d.x = -30; d.y = 120 + Math.random() * 240; }
        if (d.x < -30) { d.x = VW + 30; d.y = 120 + Math.random() * 240; }
      }
    } else gust = 0;
  }

  // ---- background events: fireworks over the sea at Miami by night, a freight train in the desert
  // (logical coordinates; x is a background coordinate that scrolls with the far layer)
  function updateEvents(dt) {
    const k = curStage.key, racing = state !== 'title';
    if (k === 'miami' && racing && night > 0.25) {
      fwT -= dt;
      if (fwT <= 0) {
        fwT = 0.7 + Math.random() * 2.2;
        const cols = [['#ff3fa4', '#ff9ad0'], ['#20e0f0', '#c0fbff'], ['#ffe14a', '#fff6c0'], ['#3aff7a', '#d0ffd8'], ['#ff7a3a', '#ffd0a0']];
        fireworks.push({ x: 200 + Math.random() * 105, y: 90, ty: 36 + Math.random() * 24, col: cols[(Math.random() * cols.length) | 0], parts: null, t: 0, b0: bgOff });
        if (fireworks.length === 1 && driving() && Math.random() < 0.3) say('fireworks');
      }
    }
    for (const f of fireworks) {
      f.t += dt;
      if (!f.parts) {
        f.y -= 75 * dt;
        if (f.y <= f.ty) {
          f.parts = Array.from({ length: 48 }, (_, i) => { const a = i / 48 * Math.PI * 2 + Math.random() * 0.1, v = 26 + Math.random() * 16; return { x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, c: Math.random() < 0.4 ? f.col[1] : f.col[0] }; });
          f.life = 1.6;
          Sound.firework();
        }
      } else {
        f.life -= dt;
        for (const p of f.parts) { p.vx *= 1 - 1.2 * dt; p.vy = p.vy * (1 - 1.2 * dt) + 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      }
    }
    fireworks = fireworks.filter(f => !f.parts || f.life > 0);
    // the train first shows up a few seconds after entering the desert, then every ~65 s
    if (k === 'desert') { if (trainT === 0) trainB0 = bgOff; trainT += dt; }
    // train horn when it comes into view
    const tv = k === 'desert' && racing && trainVisible();
    if (tv && !trainWas) { Sound.trainHorn(); if (driving() && Math.random() < 0.5) say('train'); }
    trainWas = tv;
  }
  const TRAIN_LEN = 210;
  const trainX = () => (((trainT * 18 + 60 - (bgOff - trainB0) * 0.5) % 900) + 900) % 900 - 300;
  const trainVisible = () => { const x = trainX(); return x > -TRAIN_LEN && x < W; };

  // painted on the light layer (view coordinates = logical x R), so they shine at night and the
  // buildings and palms in front hide them
  function drawFireworks() {
    const g = lctx;
    for (const f of fireworks) {
      g.save(); g.translate(-Math.round((bgOff - f.b0) * 0.5) * R, 0);   // they stay over the sea as the view turns
      if (!f.parts) {                                // rocket with a short fading trail
        for (let k = 0; k < 4; k++) { g.globalAlpha = 1 - k * 0.25; g.fillStyle = k ? '#ffb060' : '#fff2c8'; g.fillRect(Math.round(f.x * R), Math.round((f.y + k * 2) * R), R, R * 2); }
      } else {
        if (f.life > 1.3) lglow(f.x * R, f.y * R, 40, '255,240,210', (f.life - 1.3) * 1.2);   // the flash of the burst
        g.globalAlpha = clamp(f.life / 0.8, 0, 1);
        const sz = f.life > 0.9 ? R + 1 : R;
        for (const p of f.parts) { g.fillStyle = p.c; g.fillRect(Math.round(p.x * R), Math.round(p.y * R), sz, sz); }
      }
      g.globalAlpha = 1;
      g.restore();
    }
  }

  // freight train crossing the plain, far away, on the horizon (runs to the right)
  // y: the far edge of the visible terrain (logical px), so the train sits on the plain
  function drawTrain(y) {
    const x0 = Math.round(trainX());
    if (x0 <= -TRAIN_LEN || x0 >= W) return;
    const haze = c => Gfx.mix(c, '#c0705a', 0.18);
    const cars = ['#8a3a2a', '#3a5a7a', '#9a7a3a', '#5a6a4a', '#7a2a4a'];
    for (let i = 0; i < 10; i++) {                  // boxcars
      const cx = x0 + i * 18;
      ctx.fillStyle = haze(cars[(i * 3) % 5]); ctx.fillRect(cx, y - 7, 16, 6);
      ctx.fillStyle = haze('#e8d0b0'); ctx.fillRect(cx, y - 7, 16, 1);          // sunlit roof
      ctx.fillStyle = haze('#2a1a1a'); ctx.fillRect(cx + 7, y - 6, 2, 4);         // door
      ctx.fillRect(cx + 2, y - 1, 3, 1); ctx.fillRect(cx + 11, y - 1, 3, 1);       // bogies
    }
    const lx = x0 + 180;
    ctx.fillStyle = haze('#f0b020'); ctx.fillRect(lx, y - 8, 28, 7);             // locomotive
    ctx.fillStyle = haze('#d02020'); ctx.fillRect(lx, y - 4, 28, 1);
    ctx.fillStyle = haze('#2a2a3a'); ctx.fillRect(lx + 2, y - 11, 9, 3); ctx.fillRect(lx + 19, y - 10, 2, 2);
    ctx.fillStyle = haze('#bfe8ff'); ctx.fillRect(lx + 4, y - 10, 5, 1);         // cab window
    ctx.fillStyle = haze('#2a1a1a'); for (let w = 2; w < 28; w += 6) ctx.fillRect(lx + w, y - 1, 3, 1);
    if (night > 0.2) { ctx.fillStyle = '#fff4c0'; ctx.fillRect(lx + 27, y - 7, 2, 2); }
  }

  // seagulls and a banner plane over Miami's sunset (logical coordinates, inside drawBg)
  let bannerImg = null;
  function drawSkyLife() {
    ctx.fillStyle = '#2a1430';
    for (let i = 0; i < 6; i++) {
      const x = ((i * 67 + T * (6 + i * 1.3) + bgOff * 0.2) % (W + 40)) - 20;
      const y = 18 + i * 7 + Math.sin(T * 0.8 + i * 2) * 4;
      const up = Math.floor(T * 5 + i) % 2;          // flapping wings
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      ctx.fillRect(Math.round(x) - 2, Math.round(y) - (up ? 1 : -1), 2, 1);
      ctx.fillRect(Math.round(x) + 1, Math.round(y) - (up ? 1 : -1), 2, 1);
    }
    if (!bannerImg) {
      const text = 'VISIT RETRORUN';
      bannerImg = document.createElement('canvas');
      bannerImg.width = Font.width(text) + 6; bannerImg.height = 11;
      const g = bannerImg.getContext('2d');
      g.fillStyle = '#fff4e0'; g.fillRect(0, 0, bannerImg.width, 11);
      g.fillStyle = '#ff3fa4'; g.fillRect(0, 0, 1, 11);
      Font.draw(g, text, 3, 2, { color: '#ff3fa4', shadow: null });
    }
    const px = W + 60 - ((T * 16) % 1000);            // right to left, every ~60 s
    if (px > -bannerImg.width - 40 && px < W + 40) {
      const py = 30 + Math.sin(T * 0.6) * 2;
      ctx.fillStyle = '#2a1430';
      ctx.fillRect(Math.round(px), Math.round(py), 9, 2);       // fuselage
      ctx.fillRect(Math.round(px) + 3, Math.round(py) - 2, 3, 6); // wings
      ctx.fillRect(Math.round(px) + 8, Math.round(py) - 2, 1, 3); // tail
      ctx.fillRect(Math.round(px) + 9, Math.round(py) + 1, 6, 1); // tow rope
      ctx.drawImage(bannerImg, Math.round(px) + 15, Math.round(py) - 4);
    }
  }

  // night overlay, lights, rain, sand and lightning, over the 3D view (view coordinates)
  function drawAtmosphere(th) {
    const nk = nightKNow * night;
    ctx.save();
    if (nk > 0.01 || weather.level > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      let col = Gfx.mix('#ffffff', '#2c2f70', nk * 0.78);
      if (weather.kind === 'rain') col = Gfx.mix(col, '#7c86a6', weather.level * 0.45);
      if (weather.kind === 'sand') col = Gfx.mix(col, '#e0b07a', weather.level * (0.18 + 0.14 * gust));
      ctx.fillStyle = col; ctx.fillRect(0, 0, VW, VH);
    }
    if (tunnelK > 0.01) {                          // sodium lamps: warm and a bit darker
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = Gfx.mix('#ffffff', '#b08a6a', tunnelK * 0.55);
      ctx.fillRect(0, 0, VW, VH);
    }
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, rad, rgb, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    const dark = Math.max(nk, weather.level * 0.5, tunnelK * 0.7);
    const wx = 1 - tunnelK;                        // no rain or sand inside the tunnel
    if (lightOn) ctx.drawImage(lcv, 0, 0);
    if (slipK > 0.03) {                            // slipstream: wind streaks rushing out from the vanishing point
      ctx.strokeStyle = `rgba(230,245,255,${0.32 * slipK})`; ctx.lineWidth = R;
      ctx.beginPath();
      const cx = VW / 2, cy = VH * 0.42;
      for (const s of streaks) {
        const r0 = 120 + s.p * 260, len = 18 + s.p * 50;
        const dx = Math.cos(s.a), dy = Math.sin(s.a) * 0.55;
        if (Math.abs(dx) < 0.35) continue;         // keep the middle of the screen clear
        ctx.moveTo(cx + dx * r0, cy + dy * r0); ctx.lineTo(cx + dx * (r0 + len), cy + dy * (r0 + len));
      }
      ctx.stroke();
    }
    for (const f of carFx) {
      const { c, x, y, dw, dh } = f;
      if (dark > 0.15) for (const sd of [-1, 1]) glow(x + sd * dw * 0.32, y - dh * 0.42, Math.max(3, dw * 0.2), '255,40,30', 0.75 * dark);
      if (c.lc && Math.floor(T * 3.5) % 2) glow(x + c.lc.dir * dw * 0.44, y - dh * 0.45, Math.max(3, dw * 0.16), '255,170,20', 0.95);
      if (c.chase > 0) {
        const red = Math.floor(T * 8) % 2;
        glow(x + (red ? -1 : 1) * dw * 0.14, y - dh * 0.95, Math.max(4, dw * 0.35), red ? '255,30,40' : '40,90,255', 0.9);
      }
    }
    if (playerRect && dark > 0.15) {
      const { x, y, w, h } = playerRect;
      const tl = keys.brake ? 1 : 0.6;
      for (const sd of [-1, 1]) glow(x + w / 2 + sd * w * 0.36, y + h * 0.5, 14, '255,30,30', tl * dark);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (weather.kind === 'rain' && weather.level * wx > 0.01) {
      const n = Math.floor(drops.length * weather.level * wx), sl = (-40 - steer * 90) / 900;
      ctx.strokeStyle = 'rgba(205,220,255,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const d = drops[i]; ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + sl * d.l, d.y + d.l); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(220,230,255,0.5)';           // splashes on the tarmac
      for (let i = 0; i < 40 * weather.level * wx; i++) ctx.fillRect(Math.random() * VW, VH * 0.62 + Math.random() * VH * 0.38, 2, 1);
    }
    if (weather.kind === 'sand' && weather.level * wx > 0.01) {
      const wl = weather.level * wx;
      ctx.fillStyle = `rgba(225,180,120,${0.04 * wl + 0.07 * gust * wl})`;
      ctx.fillRect(0, 0, VW, VH);
      const n = Math.floor(dust.length * wl * (0.35 + 0.65 * gust));   // mostly during gusts
      ctx.fillStyle = 'rgba(248,215,160,0.45)';
      for (let i = 0; i < n; i++) { const d = dust[i]; ctx.fillRect(Math.round(d.x), Math.round(d.y), Math.round(d.l * (0.5 + 0.5 * gust)), 1); }
    }
    if (flash > 0 && tunnelK < 0.5) { ctx.fillStyle = `rgba(235,240,255,${flash * 0.6})`; ctx.fillRect(0, 0, VW, VH); }
    ctx.restore();
  }

  // Street lamps and signs switch on one by one as it gets dark (each lamp has its own threshold
  // and flickers while it warms up); neon signs buzz off for a moment now and then.
  function lampLight(L) {
    const dark = lightDark, glow = lglow, ctx = lctx;
    {
      const h = ((L.id * 2654435761) >>> 0) / 4294967296;
      const on = 0.14 + h * 0.24;
      let a = clamp((dark - on) / 0.1, 0, 1);
      if (a <= 0) return;
      if (a < 1 && Math.sin(T * 41 + L.id * 3.7) > 0.3) a *= 0.15;               // warming up
      if (L.kind === 'neon' && (Math.floor(T * 12) + L.id * 37) % 113 < 3) a *= 0.1; // buzz
      if (L.kind === 'lamp' && L.base < L.clip) {                                 // pool of light on the ground,
        ctx.save();                                                               // hidden behind a nearer crest
        ctx.beginPath(); ctx.rect(0, 0, VW, L.clip); ctx.clip();
        ctx.translate(L.x, L.base); ctx.scale(1, 0.28);
        glow(0, 0, L.r * 2.6, L.rgb, 0.16 * a);
        ctx.restore();
      }
      if (L.kind === 'neon') {                                                    // the whole tube frame glows
        for (const f of [-0.32, 0, 0.32]) glow(L.x + f * L.w, L.y, L.r * 0.6, L.rgb, 0.32 * a);
        return;
      }
      glow(L.x, L.y, L.r, L.rgb, 0.55 * a);
      glow(L.x, L.y, Math.max(1.5, L.r * 0.3), '255,252,235', 0.85 * a);
      if (L.kind === 'beam') {                                                    // turning lighthouse beam
        const ang = T * 1.6, len = L.r * 14;
        ctx.save(); ctx.translate(L.x, L.y);
        for (const s of [0, Math.PI]) {
          const c = Math.cos(ang + s);
          if (c < -0.2) continue;                                                 // pointing away
          const dx = Math.sin(ang + s) * len, sp = L.r * 1.2;
          const gr = ctx.createLinearGradient(0, 0, dx, 0);
          gr.addColorStop(0, `rgba(${L.rgb},${0.35 * a * (0.4 + 0.6 * Math.max(0, c))})`); gr.addColorStop(1, `rgba(${L.rgb},0)`);
          ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(dx, -sp); ctx.lineTo(dx, sp); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
  }

  // passenger speech bubble above his head: the girl drives (left-hand drive), he sits on the right
  function drawSpeech() {
    if (!speech) return;
    // drawn on the full-resolution overlay with half-size font pixels: small and light
    const g = hctx, u = hud.width / W, fs = Math.max(1, Math.round(u / 2));
    const tw = Font.width(speech.text, fs), pad = 3 * fs;
    const bw = tw + pad * 2, bh = 7 * fs + pad * 2;
    const hx = Math.round((W / 2 + 18) * u), by = Math.round((H - 66) * u);  // passenger's head (right seat)
    const bx = clamp(Math.round(hx - bw / 2), 4, hud.width - bw - 4);
    g.globalAlpha = Math.min(1, speech.t * 4) * 0.88;
    g.fillStyle = '#1a0630'; g.fillRect(bx - fs, by - fs, bw + 2 * fs, bh + 2 * fs);
    g.fillStyle = '#ffffff'; g.fillRect(bx, by, bw, bh);
    g.fillStyle = '#1a0630'; g.fillRect(hx - fs, by + bh + fs, 3 * fs, fs);   // little tail
    g.fillStyle = '#ffffff'; g.fillRect(hx, by + bh, fs, fs * 2);
    g.globalAlpha = Math.min(1, speech.t * 4);
    Font.draw(g, speech.text, bx + pad, by + pad, { color: '#1a0630', shadow: null, scale: fs });
    g.globalAlpha = 1;
    hudDirty = true;
  }

  // ---- overtaking streak: clean passes in a row; every 5 a score bonus, every 10 also +3 s
  function overtake() {
    streak++; streakPop = 1;
    if (streak % 5) return;
    const pts = 250 * streak;
    score += pts;
    if (streak % 10 === 0) { timeLeft += 3; msg('STREAK X' + streak + '!  +3S', '#ffe14a', 1.6); Sound.streak(true); say('streak'); }
    else { msg('STREAK X' + streak + '  +' + pts, '#ff7ad0', 1.4); Sound.streak(false); }
  }
  function breakStreak() {
    if (streak >= 3 && state === 'race') msg('STREAK LOST', '#b8a8d8', 1);
    streak = 0;
  }

  function perfectStart() {
    speed = Math.max(speed, MAX_SPEED * 0.4); boostT = 2.2;
    msg('PERFECT START!', '#3aff7a', 1.6);
    Sound.whoosh(); say('start');
    for (const sd of [-1, 1]) for (let i = 0; i < 6; i++) puff('tyre', W / 2 + sd * TYRE_DX, TYRE_Y, sd * 40 * Math.random(), 10 + Math.random() * 20, 10, 0.8, 0.6);
  }
  function wheelspin() { spinT = 0.6; msg('WHEELSPIN!', '#ff7a3a', 1.2); }

  // ---- landing after a jump: the suspension bottoms out, the floor sparks, air time scores
  function land(impact) {
    if (airT < 0.12) return;
    const k = clamp(impact / 2600, 0, 1);
    sag = Math.max(sag, 1.5 + 4.5 * k);
    shake = Math.max(shake, 0.1 + 0.25 * k);
    landT = 0.07 + 0.15 * k; landK = 0.4 + 0.6 * k;
    Sound.land(k);
    if (driving() && airT > 0.45) {
      const pts = Math.round(airT * 10) * 200;
      score += pts;
      msg('BIG AIR! +' + pts, '#ffe14a', 1.3);
      if (Math.random() < 0.6) say('jump');
    }
  }

  function burst(x, y, n, cols, spd = 60) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = spd * (0.4 + Math.random() * 0.8);
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0.5 + Math.random() * 0.4, col: cols[(Math.random() * cols.length) | 0], g: 120, s: 1 + (Math.random() < 0.3 ? 1 : 0) });
    }
  }

  // ================================================================== game flow
  function startRace() {
    newTrack((Math.random() * 1e9) | 0);
    timeLeft = START_TIME; fuel = 100; damage = 0; score = 0; coins = 0; bonus = null;
    raceTime = 0; finishTime = null; newRank = -1; saidLowFuel = false;
    state = 'countdown'; stateT = 0; lastBeep = -1; lastTrack = null;
    gasDownAt = -1; prevGasCd = keys.gas; startCheck = false;  // the radio tag shows at the start
    msg('OCEAN DRIVE', '#ffe14a', 3, 2);
    Sound.engineStart();
    Sound.playMusic(musicSel);
  }

  function toTitle() {
    newTrack(1986);
    state = 'title'; stateT = 0;
    speed = MAX_SPEED * 0.6;
    if (Sound.ready) Sound.playMusic(musicSel);
  }

  function endGame(reason) {
    state = 'gameover'; stateT = 0; endReason = reason;
    saveHi();
    Sound.stopMusic(); Sound.gameOver();
  }

  // after the end screens: name entry if the score makes the table, then the table
  function toScores() {
    if (Math.floor(score) > scores[scores.length - 1].score) {
      state = 'entry'; stateT = 0;
      entry.name = lastName.padEnd(3, 'A').slice(0, 3).split(''); entry.pos = 0;
    } else {
      if (finishTime !== null && (bestTime === null || finishTime < bestTime.time)) { bestTime = { name: '---', time: finishTime }; saveScores(); }
      newRank = -1; state = 'scores'; stateT = 0;
    }
  }

  function submitEntry() {
    const name = entry.name.join('').replace(/ +$/, '') || '---';
    lastName = entry.name.join('');
    const rec = { name, score: Math.floor(score), time: finishTime, stage: finishTime !== null ? 4 : curStage.level + 1 };
    scores.push(rec);
    scores.sort((a, b) => b.score - a.score);
    scores = scores.slice(0, 10);
    newRank = scores.indexOf(rec);
    if (finishTime !== null && (bestTime === null || finishTime < bestTime.time)) bestTime = { name, time: finishTime };
    hiScore = Math.max(hiScore, scores[0].score);
    saveScores();
    Sound.checkpoint();
    state = 'scores'; stateT = 0;
  }

  // k: 'up' | 'down' | 'left' | 'ok' | a single character typed on the keyboard
  function entryKey(k) {
    const L = ALPHABET, cur = L.indexOf(entry.name[entry.pos]);
    if (k === 'up') entry.name[entry.pos] = L[(cur + 1) % L.length];
    else if (k === 'down') entry.name[entry.pos] = L[(cur - 1 + L.length) % L.length];
    else if (k === 'left') entry.pos = Math.max(0, entry.pos - 1);
    else {
      if (k !== 'ok') entry.name[entry.pos] = k;
      entry.pos++;
      if (entry.pos > 2) { submitEntry(); return; }
    }
    Sound.select();
  }

  function saveHi() {
    if (score > hiScore) {
      hiScore = Math.floor(score);
      try { localStorage.setItem('retrorun.hi', String(hiScore)); } catch (e) { /* storage unavailable */ }
    }
  }

  function commitFork(st, side, seg, pct) {
    st.choice = side;
    st.commitT = lerp(seg.t1, seg.t2, pct);
    const key = st.th.next[side < 0 ? 0 : 1];
    st.next = buildStage(key, st.level + 1, st.center + side * SPLIT_END);
    if (state === 'race') { msg(THEMES[key].name, '#20e0f0', 2); Sound.fork(); }
  }

  function enterStage(st) {
    curStage = st;
    if (state === 'race') {
      route.push(st.key);
      timeLeft += TIME_BONUS;
      msg('CHECKPOINT!', '#ffe14a', 1.8, 2, 'uiCheckpoint', 11);
      msg('EXTENDED PLAY +' + TIME_BONUS + 'S', '#20e0f0', 1.8);
      msg('STAGE ' + (st.level + 1) + ' - ' + st.th.name, '#ff7ad0', 2.2);
      Sound.checkpoint();
    } else if (state === 'title') {
      route.push(st.key);
    }
  }

  // ================================================================== update
  function update(dt) {
    T += dt;
    if (state === 'paused') return;
    stateT += dt;

    for (const m of msgs) m.t -= dt;
    msgs = msgs.filter(m => m.t > 0);
    streakPop = Math.max(0, streakPop - dt * 3);
    camFlash = Math.max(0, camFlash - dt * 2.2);
    // radio DJ: a small tag whenever a station starts playing during a race
    {
      const np = Sound.nowPlaying;
      if (np && np !== lastTrack && state !== 'title') { radioTag = { name: np, t: 3.4 }; Sound.tune(); }
      lastTrack = np;
      if (radioTag) { radioTag.t -= dt; if (radioTag.t <= 0) radioTag = null; }
    }
    for (const p of particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; }
    particles = particles.filter(p => p.life > 0);
    shake = Math.max(0, shake - dt);
    crashCD = Math.max(0, crashCD - dt);
    emitSmoke(dt);
    // wheel animation: frames per second grow with speed, capped so it does not strobe
    if (state !== 'countdown') wheelPhase += dt * Math.min(16, 40 * speed / MAX_SPEED);

    if (state === 'countdown') {
      const n = 3 - Math.floor(stateT);
      if (n !== lastBeep && n > 0) { lastBeep = n; Sound.beep(false); }
      if (keys.gas && !prevGasCd) gasDownAt = stateT;
      prevGasCd = keys.gas;
      if (stateT >= 3) {
        state = 'race'; stateT = 0; Sound.beep(true);
        // perfect start: gas pressed in the last 0.45 s before GO (or just after); held from earlier = wheelspin
        startCheck = true;
        if (keys.gas) { startCheck = false; if (gasDownAt >= 2.55) perfectStart(); else wheelspin(); }
      }
      Sound.engineSet(0, keys.gas, true, false);
      return;
    }
    if (state === 'gameover') { speed = Math.max(0, speed + DECEL * 2 * dt); Sound.engineSet(0, false, false, false); }

    if (startCheck && state === 'race') {
      if (keys.gas) { startCheck = false; if (stateT < 0.2) perfectStart(); }
      else if (stateT > 0.2) startCheck = false;
    }
    spinT = Math.max(0, spinT - dt);
    let pSeg = findSeg(position + PLAYER_Z);
    const speedPct = speed / MAX_SPEED;

    // ---- controls (player or autopilot)
    let left = false, right = false, brake = false, ai = null;
    gas = false;
    const driving = state === 'race' || state === 'timeup';
    if (crashT > 0) {
      crashT -= dt;
      speed = Math.max(0, speed + BRAKING * 0.8 * dt);
      steer = Math.floor(T * 14) % 2 ? -1 : 1;
      if (crashT <= 0) {
        const pS = splitsAt(pSeg, 0.5);
        const side = pSeg.fork ? (pSeg.stage.choice || (playerX >= pSeg.center ? 1 : -1)) : 0;
        const bc = pSeg.center + side * (side < 0 ? pS[0] : pS[1]);
        playerX = bc + clamp(playerX - bc, -0.7, 0.7);
        steer = 0;
      }
    } else if (driving) {
      left = keys.left; right = keys.right; brake = keys.brake;
      gas = keys.gas && state === 'race' && fuel > 0;
    } else if (state === 'title' || state === 'goal') {
      // autopilot: keep a free lane and pick a branch at forks
      let target = pSeg.center + aiLane;
      if (pSeg.fork) target = pSeg.center + (pSeg.stage.choice || pSeg.stage.aiSide) * lerp(pSeg.s1, pSeg.s2, 0.5);
      const pz = position + PLAYER_Z;
      for (const c of cars) {
        if (c.z > pz && c.z - pz < SEG * 30 && Math.abs(c.offset - aiLane) < 0.4) {
          aiLane = LANE_X.find(l => !cars.some(o => o.z > pz && o.z - pz < SEG * 30 && Math.abs(o.offset - l) < 0.4)) ?? aiLane;
          break;
        }
      }
      // proportional steering that also cancels the centrifugal push of the bend
      ai = clamp((target - playerX) * 3 + speedPct * pSeg.curve * CENTRIFUGAL, -1, 1);
      gas = state === 'title' && speed < MAX_SPEED * 0.72;
      brake = state === 'goal' && stateT > 1;
    }

    const dx = dt * 2 * speedPct * (airH > 20 ? 0.35 : 1);   // little grip in the air
    if (ai !== null) {
      // autopilot: smooth the shown car frame, with hysteresis, so it does not flicker
      playerX += dx * ai;
      aiVis += (ai - aiVis) * Math.min(1, dt * 8);
      if (crashT <= 0) steer = Math.abs(aiVis) > (steer ? 0.25 : 0.5) ? Math.sign(aiVis) : 0;
    } else {
      if (left) playerX -= dx; else if (right) playerX += dx;
      if (crashT <= 0) steer = left ? -1 : right ? 1 : 0;
    }
    // rain makes the car slide more in bends; desert gusts push it sideways
    const wet = weather.kind === 'rain' ? weather.level : 0;
    playerX -= dx * speedPct * pSeg.curve * CENTRIFUGAL * (1 + 0.45 * wet);
    if (weather.kind === 'sand' && driving) playerX += gustDir * gust * weather.level * (1 - tunnelK) * dt * 0.35;

    // close-call boost: up to 12 % over the normal top speed for a moment
    const maxNow = MAX_SPEED * (1 - 0.45 * damage / 100) * (1 + 0.12 * Math.min(1, boostT)) * (1 + 0.15 * Math.min(1, overT)) * (1 + 0.08 * slipK);
    if (crashT > 0) { /* handled above */ }
    else if (gas) speed = Math.min(speed + ACCEL * dt * (spinT > 0 ? 0.15 : 1), Math.max(maxNow, speed + DECEL * dt));
    else if (brake) speed += BRAKING * dt;
    else speed += DECEL * dt;
    speed = clamp(speed, 0, MAX_SPEED * 1.3);   // boost and overdrive go past the normal top speed

    // ---- advance
    const oldPos = position;
    position += speed * dt;
    const endZ = (segments.length - 4) * SEG - PLAYER_Z;
    if (position > endZ) { position = endZ; speed = 0; }
    pSeg = findSeg(position + PLAYER_Z);
    const pPct = ((position + PLAYER_Z) % SEG) / SEG;

    // ---- forks: the car follows the branch it is on; the choice locks once the roads separate
    let split = 0, side = 0;
    if (pSeg.fork) {
      const st = pSeg.stage;
      split = lerp(pSeg.s1, pSeg.s2, pPct);
      side = st.choice || (playerX >= pSeg.center ? 1 : -1);
      if (prevFork) playerX += side * (split - prevSplit);
      if (!st.choice && split > COMMIT_SPLIT) commitFork(st, side, pSeg, pPct);
    }
    prevFork = pSeg.fork; prevSplit = split;
    const bCenter = pSeg.center + side * split;

    if (pSeg.stage !== curStage && pSeg.stage.start <= pSeg.index) enterStage(pSeg.stage);

    // ---- background parallax
    const dSeg = (position - oldPos) / SEG;
    bgOff += pSeg.curve * dSeg * 1.4;

    // ---- suspension: vertical acceleration of the road under the car (+ = compression, in a dip)
    {
      const ps = findSeg(position + PLAYER_Z);
      const vy = (ps.p2.world.y - ps.p1.world.y) / SEG * speed;
      roadAcc += ((vy - roadVy) / dt - roadAcc) * 0.3;
      roadVy = vy;
      accMax = Math.max(accMax, roadAcc);
    }
    // ---- jumps (arcade): a sharp crest kicks the car up, then it flies under AIR_G
    {
      const crest = -roadAcc;
      if (airH <= 0) {
        if (crest > CREST_FROM && crestArmed && speed > MAX_SPEED * 0.5 && crashT <= 0) {
          crestArmed = false; airV = jumpV(crest); airH = airV * dt; airT = 0; airMax = 0;
        }
        if (crest < CREST_FROM * 0.4) crestArmed = true;
      } else {
        airT += dt;
        if (airT < 0.12) airV = Math.max(airV, jumpV(crest) - AIR_G * airT);   // the crest keeps sharpening
        airV -= AIR_G * dt;
        airH += airV * dt;
        airMax = Math.max(airMax, airH);
        if (airH <= 0 || crashT > 0) { land(-airV); airH = 0; airV = 0; }
      }
    }
    updateSparks(dt);

    // ---- tunnel: walls like rails, echo, darker light
    {
      const inT = findSeg(position).tunnel || pSeg.tunnel;
      const prevK = tunnelK;
      tunnelK += ((inT ? 1 : 0) - tunnelK) * Math.min(1, dt * 4);
      if (prevK < 0.5 && tunnelK >= 0.5 && driving && Math.random() < 0.6) say('tunnel');
      Sound.tunnel(state === 'title' || state === 'gameover' ? 0 : Math.round(tunnelK * 50) / 50);
    }

    // ---- off-road, roadside objects, rails
    const th = pSeg.theme;
    const rel = playerX - bCenter;
    offroad = Math.abs(rel) > 1;
    if (offroad && speed > OFF_LIMIT) speed = Math.max(OFF_LIMIT, speed + OFF_DECEL * dt);
    if (offroad && crashT <= 0 && speed > 0) {
      const prel = playerX - pSeg.center;
      const [sL, sR] = splitsAt(pSeg, 0);
      for (const s of pSeg.sprites) {
        if (!s.collide) continue;
        const so = s.offset + (s.follow < 0 ? -sL : s.follow > 0 ? sR : 0);
        const sw = s.spr.ww / ROAD_W;
        const sc = so + s.ax * sw + s.spr.cx * sw;
        if (overlap(prel, PLAYER_W, sc, s.spr.cw * sw, 0.9)) {
          crashT = 1.1; shake = 0.6;
          if (crashCD <= 0) { damage = Math.min(100, damage + 12); crashCD = 1; msg('CRASH!', '#ff3040', 1.2); if (driving) say('crash', true); }
          breakStreak();
          position = Math.max(0, pSeg.p1.world.z - PLAYER_Z - SEG * 0.5);
          speed = Math.min(speed, MAX_SPEED / 5);
          Sound.crash();
          burst(W / 2, H - 20, 14, ['#ffffff', '#ffe14a', '#ff7a3a']);
          break;
        }
      }
    }
    const lim = pSeg.tunnel ? TUNNEL_W - 0.2 : th.limit;
    if (Math.abs(rel) > lim) {
      playerX = bCenter + Math.sign(rel) * lim;
      if ((th.rail || pSeg.tunnel) && speed > 100) {
        speed *= (1 - dt * 1.2);
        if (Math.random() < 0.5) burst(W / 2 + Math.sign(rel) * 38, H - 14, 2, ['#ffe14a', '#ffffff'], 40);
        if (Math.random() < 0.2) Sound.scrape();
      }
    }

    // ---- traffic collisions
    if (crashT <= 0) {
      const pz = position + PLAYER_Z;
      for (const c of cars) {
        const dz = c.z - pz;
        if (dz < -SEG * 0.3 || dz > SEG * 0.9 || speed <= c.speed) continue;
        const cs = findSeg(c.z);
        const prel = playerX - cs.center;
        if (overlap(prel, PLAYER_W, c.offset, c.w, 0.85)) {
          speed = c.speed * (c.speed / speed);
          position = c.z - PLAYER_Z - SEG * 0.95;
          playerX += prel < c.offset ? -0.1 : 0.1;
          shake = 0.35;
          if (crashCD <= 0 && driving) { damage = Math.min(100, damage + 16); crashCD = 0.6; msg('DAMAGE!', '#ff7a3a', 1.2); say('bump', true); }
          if (driving) breakStreak();
          c.hit = true;
          if (c.police && driving && c.chase <= 0) {
            c.chase = 7; c.lc = null;
            msg('POLICE CHASE!', '#ff3040', 1.8); say('police', true);
          }
          Sound.bump();
          burst(W / 2, H - 30, 8, ['#cccccc', '#ffffff', '#ff7a3a']);
          break;
        }
      }
    }

    // ---- a chasing police car rams the player from behind
    if (crashT <= 0 && driving) {
      const pz = position + PLAYER_Z;
      for (const c of cars) {
        if (c.chase <= 0 || c.z > pz || pz - c.z > SEG * 0.8 || c.speed <= speed) continue;
        if (overlap(playerX - findSeg(c.z).center, PLAYER_W, c.offset, c.w, 0.8)) {
          damage = Math.min(100, damage + 8); shake = 0.3;
          speed = Math.min(MAX_SPEED, speed + MAX_SPEED * 0.1);
          c.speed = speed * 0.7; c.z = pz - SEG * 1.5;
          msg('RAMMED!', '#ff3040', 1.2); Sound.bump(); breakStreak();
          break;
        }
      }
    }

    // ---- close calls: passing a car within a hair without touching it
    {
      const pz = position + PLAYER_Z;
      for (const c of cars) {
        if (c.passed || c.z > pz - SEG * 0.2) continue;
        c.passed = true;
        if (c.hit || !driving || c.z < pz - SEG * 2) continue;
        if (state === 'race') overtake();
        if (speed < MAX_SPEED * 0.45) continue;
        const gap = Math.abs(playerX - findSeg(c.z).center - c.offset) - (PLAYER_W + c.w) / 2 * 0.85;
        if (gap < 0.09) {
          score += 1000; boostT = 1.6;
          msg('CLOSE CALL! +1000', '#3aff7a', 1.3);
          Sound.whoosh();
          if (Math.random() < 0.5) say('close');
        }
      }
    }

    // ---- pickups
    const pIdx = Math.floor((position + PLAYER_Z) / SEG);
    for (let i = Math.max(lastItemIdx + 1, pIdx - 8); i <= pIdx; i++) {
      const seg = segments[i];
      if (!seg) continue;
      for (const it of seg.items) {
        if (it.taken || Math.abs(playerX - seg.center - it.offset) > 0.3) continue;
        if (state !== 'race' && state !== 'timeup') continue;
        it.taken = true;
        if (it.type === 'coin') {
          fuel = Math.min(100, fuel + 2.5); score += 300; coins++;
          Sound.coin();
          burst(W / 2, H - 40, 6, ['#ffd23a', '#fff3a0', '#ffffff'], 50);
        } else {
          if (damage <= 0) {                // nothing to repair: tune the engine instead
            overT = Math.min(overT + 12, 24); score += 500;
            Sound.wrench(); Sound.whoosh();
            msg('OVERDRIVE! +15% SPEED', '#ffe14a', 1.6);
          } else {
            damage = Math.max(0, damage - 35); score += 500;
            Sound.wrench();
            msg('REPAIRED!', '#4aa8ff', 1.5);
          }
          burst(W / 2, H - 40, 12, ['#4aa8ff', '#ffffff'], 70);
        }
      }
    }
    lastItemIdx = Math.max(lastItemIdx, pIdx);

    updateTraffic(dt);

    // ---- slipstream: a car 1.2..7 segments ahead, right in front of the player
    {
      const pz = position + PLAYER_Z;
      let tucked = false;
      if (driving && speed > MAX_SPEED * 0.5 && crashT <= 0 && airH <= 0) {
        for (const c of cars) {
          const dz = c.z - pz;
          if (dz < SEG * 1.2 || dz > SEG * 7) continue;
          if (Math.abs(playerX - findSeg(c.z).center - c.offset) < (c.w + PLAYER_W) / 2 * 0.55) { tucked = true; break; }
        }
      }
      slipT = tucked ? slipT + dt : Math.max(0, slipT - dt * 2);
      if (tucked && slipT > 0.8) {
        if (slipHold <= 0 && state === 'race') { msg('SLIPSTREAM!', '#20e0f0', 1.1); Sound.whoosh(); }
        slipHold = SLIP_HOLD;
      } else slipHold = Math.max(0, slipHold - dt);
      slipK += ((slipHold > 0 ? 1 : 0) - slipK) * Math.min(1, dt * 5);
      for (const s of streaks) { s.p += dt * s.v * (1.2 + speed / MAX_SPEED); if (s.p > 1) { s.p -= 1; s.a = Math.random() * Math.PI * 2; } }
    }

    // ---- timers, fuel, score, end conditions
    if (state === 'race' || state === 'timeup') raceTime += dt;
    updateAtmosphere(dt, pSeg);
    updateEvents(dt);
    if (state === 'race') {
      timeLeft -= dt;
      fuel = Math.max(0, fuel - dt * (0.35 + (gas ? 0.5 + 0.7 * speedPct : 0)));
      score += speed * dt * 0.02;
      const sec = Math.ceil(timeLeft);
      if (timeLeft < 10 && sec !== lastBeep) { lastBeep = sec; Sound.alarm(); }
      if (fuel < 20 && fuel > 0) { alarmT -= dt; if (alarmT <= 0) { alarmT = 1.2; Sound.alarm(); } }
      if (fuel < 20 && !saidLowFuel) { saidLowFuel = true; say('fuel', true); }
      if (fuel > 35) saidLowFuel = false;
      if (fuel <= 0 && !msgs.some(m => m.text === 'OUT OF FUEL!')) msg('OUT OF FUEL!', '#ff3040', 3, 2);
      if (fuel <= 0 && speed < 60) endGame('OUT OF FUEL');
      if (timeLeft <= 0) { timeLeft = 0; state = 'timeup'; stateT = 0; msg('TIME UP!', '#ff3040', 4, 2); }
      if (curStage.goalSeg && !photo && !photoWant && pIdx >= curStage.goalSeg - 5) photoWant = true;
      if (curStage.goalSeg && pIdx >= curStage.goalSeg) {
        state = 'goal'; stateT = 0; finishTime = raceTime;
        bonus = { time: Math.floor(timeLeft) * 1000, fuel: Math.floor(fuel) * 50, coins };
        score += bonus.time + bonus.fuel;
        saveHi();
        Sound.goal(); say('goal', true);
        aiLane = clamp(Math.round((playerX - pSeg.center) / 0.66), -1, 1) * 0.66;
      }
    } else if (state === 'timeup') {
      if (speed < 60) endGame('TIME UP');
    } else if (state === 'title') {
      if (curStage.goalSeg && pIdx > curStage.goalSeg + 200) { newTrack(((Math.random() * 1e6) | 0) + 1); speed = MAX_SPEED * 0.6; }
    }

    Sound.engineSet(speed / MAX_SPEED * (airH > 20 && gas ? 1.07 : 1), gas, state !== 'title' && state !== 'gameover', offroad);
  }

  // ================================================================== render
  function hline(x0, x1, y, col) {
    let a = Math.round(x0), b = Math.round(x1);
    if (a < 0) a = 0;
    if (b > VW) b = VW;
    if (b > a) { ctx.fillStyle = col; ctx.fillRect(a, y, b - a, 1); }
  }

  function mark(xc, wpx, y, col) {
    const w = Math.max(1, Math.round(wpx));
    hline(xc - w / 2, xc - w / 2 + w, y, col);
  }

  function drawBg(th, alpha) {
    const bg = th.bg;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = bg.fill; ctx.fillRect(0, 90, W, H - 90);
    ctx.drawImage(bg.sky, 0, 0);
    if (th.key === 'miami') drawSkyLife();
    bg.layers.forEach(l => {
      const iw = l.img.width;
      const off = ((Math.round(bgOff * l.speed + iw * 0.3) % iw) + iw) % iw;
      ctx.drawImage(l.img, -off, l.y);
      ctx.drawImage(l.img, iw - off, l.y);
    });
    ctx.globalAlpha = 1;
  }

  function drawRows(seg, maxy) {
    const a = seg.p1.screen, b = seg.p2.screen;
    const y0 = Math.max(0, Math.ceil(b.y)), y1 = Math.min(maxy, Math.ceil(a.y), VH);
    if (y1 <= y0) return;
    const th = seg.tunnel ? seg.theme.tunnel.th : seg.theme, L = seg.light ? 0 : 1;
    const wave = ((seg.index >> 1) + Math.floor(T * 3)) & 1;
    for (let y = y0; y < y1; y++) {
      const t = (y + 0.5 - a.y) / (b.y - a.y);
      const cx = a.x + (b.x - a.x) * t, w = a.w + (b.w - a.w) * t;
      const [sL, sR] = splitsAt(seg, t);
      // ground
      hline(0, cx, y, th.groundL[L]);
      hline(cx, VW, y, th.groundR[L]);
      if (th.water) {
        const wc = th.water.cols[wave], fw = Math.max(1, w * 0.08);
        if (th.water.r) { const xs = cx + (sR + th.water.r) * w; hline(xs - fw, xs, y, th.water.foam); hline(xs, VW, y, wc); }
        if (th.water.l) { const xs = cx - (sL + th.water.l) * w; hline(xs, xs + fw, y, th.water.foam); hline(0, xs, y, wc); }
      }
      // road (one or two branches)
      const centers = (sL > 0.001 || sR > 0.001) ? [cx - sL * w, cx + sR * w] : [cx];
      for (const c of centers) hline(c - w * 1.15, c + w * 1.15, y, th.rumble[L]);
      for (const c of centers) hline(c - w, c + w, y, th.road[L]);
      if (w > 5 * R) {
        const lw = w * 0.03;
        for (const c of centers) {
          mark(c - w * 0.94, lw, y, th.lane);
          mark(c + w * 0.94, lw, y, th.lane);
          if (L === 0) for (let k = 1; k < LANES; k++) mark(c - w + 2 * w * k / LANES, lw, y, th.lane);
        }
      }
    }
  }

  // One ring of tunnel between p1 and p2: walls, ceiling, a neon trim and a ceiling lamp every
  // few segments; the first segment also gets the portal face. Drawn back to front with the sprites.
  function drawTunnelSeg(seg, ctx) {
    const tt = seg.theme.tunnel, L = seg.light ? 0 : 1;
    // the first rings are in shadow: a dark mouth, as real tunnels look from outside
    const d = seg.index - seg.stage.tunnel[0], mouth = d < 12 ? 0.55 * (1 - d / 12) : 0;
    const sh = c => mouth ? Gfx.mix(c, '#0c0818', mouth) : c;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, seg.clip); ctx.clip();   // hidden behind a nearer crest
    const a = seg.p1.screen, b = seg.p2.screen;
    const hA = a.scale * TUNNEL_H * VH / 2, hB = b.scale * TUNNEL_H * VH / 2;
    const lA = a.x - a.w * TUNNEL_W, rA = a.x + a.w * TUNNEL_W, lB = b.x - b.w * TUNNEL_W, rB = b.x + b.w * TUNNEL_W;
    const quad = (col, x0, y0, x1, y1, x2, y2, x3, y3) => {
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
    };
    // walls and ceiling (1 px overlap hides the seams)
    quad(sh(tt.wall[L]), lA, a.y + 1, lA, a.y - hA, lB, b.y - hB, lB, b.y);
    quad(sh(tt.wall[L]), rA, a.y + 1, rA, a.y - hA, rB, b.y - hB, rB, b.y);
    quad(sh(tt.ceil[L]), lA - 1, a.y - hA, rA + 1, a.y - hA, rB, b.y - hB - 1, lB, b.y - hB - 1);
    // neon trim along both walls at a third of the height
    const tA = hA * 0.32, tB = hB * 0.32, wA = Math.max(1, hA * 0.025), wB = Math.max(1, hB * 0.025);
    quad(tt.trim, lA, a.y - tA, lA, a.y - tA - wA, lB, b.y - tB - wB, lB, b.y - tB);
    quad(tt.trim, rA, a.y - tA, rA, a.y - tA - wA, rB, b.y - tB - wB, rB, b.y - tB);
    if (seg.index % 4 === 0) {                     // ceiling lamp
      const cA = a.w * 0.12, cB = b.w * 0.12;
      quad(tt.lamp, a.x - cA, a.y - hA, a.x + cA, a.y - hA, b.x + cB, b.y - hB, b.x - cB, b.y - hB);
    }
    if (seg.tunnel === 2) {                        // portal face around the opening
      const fw = a.w * 5, top = a.y - hA * 1.9;
      ctx.fillStyle = tt.face; ctx.beginPath();
      ctx.rect(a.x - fw, top, fw * 2, a.y - top);
      ctx.rect(lA, a.y - hA, rA - lA, hA + 1);
      ctx.fill('evenodd');
      const pw = a.w * 0.3;                                                 // pillars either side
      ctx.fillStyle = Gfx.mix(tt.face, '#1a0630', 0.25);
      ctx.fillRect(lA - pw, top, pw, a.y - top); ctx.fillRect(rA, top, pw, a.y - top);
      ctx.fillStyle = tt.trim;
      ctx.fillRect(lA - pw, a.y - hA * 1.14, rA - lA + pw * 2, Math.max(1, hA * 0.08));   // band above the arch
      ctx.fillRect(a.x - fw, top, fw * 2, Math.max(1, hA * 0.07));                         // and along the top
      ctx.fillStyle = 'rgba(12,8,24,0.5)';                                                 // shadow inside the arch
      ctx.fillRect(lA, a.y - hA, rA - lA, Math.max(1, hA * 0.08));
    }
    ctx.restore();
  }

  // Dolphins jump out of the water (once, ~1.1 s, when the car gets near); tumbleweeds roll
  // across the road in front of the car, bouncing. d = segments ahead of the player.
  function drawEventSprite(s, seg, d, sc, sx, sy, k) {
    const hpx = sc * VH / 2;                                 // world height -> view pixels
    if (s.dolphin) {
      const e = s.dolphin;
      if (e.t0 < 0) { if (d < 120 && d > 30) { e.t0 = T; if (e.lag === 0 && driving() && Math.random() < 0.4) say('dolphin'); } else return; }
      const p = (T - e.t0 - e.lag) / 1.3;
      const x = sx + s.offset * k;
      if ((p > -0.05 && p < 0.12) || (p > 0.88 && p < 1.08)) drawSprite(SPR.splash, sc, x, sy, -0.5, seg.clip);
      if (p <= 0 || p >= 1) return;
      const fr = SPR.dolphin[p < 0.38 ? 0 : p < 0.62 ? 1 : 2];
      drawSprite(fr, sc, x + (p - 0.5) * fr.ww * 0.8 * sc * VW / 2 * Math.sign(s.offset), sy - Math.sin(p * Math.PI) * 900 * hpx + fr.wh * 0.3 * sc * VW / 2, -0.5, seg.clip);
      return;
    }
    const e = s.tumble;
    if (e.t0 < 0) { if (d < 55 && d > 8) e.t0 = T; else return; }
    const p = (T - e.t0) / 1.7;
    if (p >= 1) return;
    const off = e.side * (3.4 - 6.8 * p);
    const hop = Math.abs(Math.sin(p * Math.PI * 4)) * 260 * (1 - p * 0.4);
    const fr = SPR.tumble[(Math.floor(T * 12) * (e.side > 0 ? 1 : -1) % 4 + 4) % 4];
    drawSprite(fr, sc, sx + off * k, sy - hop * hpx, -0.5, seg.clip);
    // it hits the car: bits of twigs everywhere, no damage
    if (!e.hit && d <= 0 && d > -2 && Math.abs(off - (playerX - seg.center)) < 0.45) {
      e.hit = true;
      burst(W / 2, H - 40, 18, ['#a8804a', '#7a5a30', '#d8b070'], 70);
      Sound.whoosh();
      if (driving() && Math.random() < 0.6) say('tumble');
    }
  }

  function drawSprite(s, scale, x, y, ax, clipY) {
    const dw = s.ww * scale * VW / 2, dh = s.wh * scale * VW / 2;
    if (dw < 0.6 || dh < 0.6) return;
    const dx = x + dw * ax, dy = y - dh;
    if (dx > VW || dx + dw < 0 || dy > VH) return;
    const clipH = Math.max(0, dy + dh - clipY);
    if (clipH >= dh) return;
    const srcH = s.h - s.h * clipH / dh;
    if (srcH < 0.5) return;
    const ox = Math.round(dx), oy = Math.round(dy), ow = Math.max(1, Math.round(dw)), oh = Math.max(1, Math.round(dh - clipH));
    ctx.drawImage(s.img, 0, 0, s.w, srcH, ox, oy, ow, oh);
    if (lightOn) punch(s.img, 0, 0, s.w, srcH, ox, oy, ow, oh);
  }

  function drawPlayer() {
    // turning frames while steering, brake lights when braking straight
    let s = SPR.player[steer + 1];
    if (steer === 0 && keys.brake && speed > 50) s = SPR.playerBrake;
    const scale = CAM_D / PLAYER_Z;
    const dw = s.ww * scale * VW / 2, dh = s.wh * scale * VW / 2;
    const moving = speed > 50 && state !== 'countdown';
    const lift = Math.round(airH * scale * VH / 2);
    const bounce = moving && lift < 2 ? R * Math.round(Math.random() * (offroad ? 2 : 1) * (speed / MAX_SPEED)) : 0;
    const x = Math.round(VW / 2 - dw / 2), y0 = Math.round(VH - dh - 5 * R), y = y0 - bounce + Math.round(sag) - lift;
    // ground shadow following the tyres of this frame; it stays on the road while the car bounces
    // or flies (smaller and lighter the higher the car is)
    const k = dw / s.w, sf = 1 / (1 + lift / 90);
    const shw = s.shadow.width * k * sf, shh = s.shadow.height * k * sf;
    ctx.globalAlpha = 0.55 * sf;
    ctx.drawImage(s.shadow, Math.round(x - s.shadowM * k + (s.shadow.width * k - shw) / 2), Math.round(y0 + (s.shadow.height * k - shh)), Math.round(shw), Math.round(shh));
    ctx.globalAlpha = 1;
    // headlight pool on the road ahead: a soft ellipse with no hard edges, drawn before the car so
    // the car itself is not lit; only once it is dark enough (night overlay comes later)
    const pth = findSeg(position + PLAYER_Z).theme;
    const dark = Math.max(nightKNow * night, weather.level * 0.5, tunnelK * 0.7);
    if (dark > 0.3) {
      const k2 = (dark - 0.3) / 0.7;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(x + dw / 2, y - 6); ctx.scale(1, 0.3);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 170);
      g.addColorStop(0, `rgba(255,240,200,${0.32 * k2})`);
      g.addColorStop(0.6, `rgba(255,240,200,${0.12 * k2})`);
      g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 170, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const wimg = s.wheels[Math.floor(wheelPhase) % s.wheels.length];
    ctx.drawImage(wimg, x, y, Math.round(dw), Math.round(dh));
    if (lightOn) punch(wimg, 0, 0, wimg.width, wimg.height, x, y, Math.round(dw), Math.round(dh));
    playerRect = { x, y, w: Math.round(dw), h: Math.round(dh) };
  }

  function render() {
    ctx.save();
    if (shake > 0) ctx.translate(R * Math.round((Math.random() - 0.5) * shake * 6), R * Math.round((Math.random() - 0.5) * shake * 4));

    const base = findSeg(position);
    const basePct = (position % SEG) / SEG;
    const pSeg = findSeg(position + PLAYER_Z);
    const pPct = ((position + PLAYER_Z) % SEG) / SEG;
    const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pPct);

    // background, cross-fading into the next stage while driving down a branch
    ctx.save(); ctx.scale(R, R);
    drawBg(curStage.th, 1);
    if (pSeg.fork && pSeg.stage.choice && pSeg.stage.next) {
      const st = pSeg.stage;
      const ft = lerp(pSeg.t1, pSeg.t2, pPct);
      const k = clamp((ft - st.commitT) / (1 - st.commitT), 0, 1);
      if (k > 0) drawBg(st.next.th, k);
    }
    ctx.restore();

    // road, front to back with hill clipping
    let maxy = VH, x = 0, dx = -(base.curve * basePct);
    const camX = playerX * ROAD_W, camY = playerY + CAM_H, camZ = position;
    const last = Math.min(segments.length, base.index + DRAW_DIST);
    for (let i = base.index; i < last; i++) {
      const seg = segments[i];
      seg.clip = maxy;
      project(seg.p1, camX - x, camY, camZ);
      project(seg.p2, camX - x - dx, camY, camZ);
      x += dx; dx += seg.curve;
      if (seg.p1.camera.z <= CAM_D || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
      drawRows(seg, maxy);
      maxy = Math.min(maxy, Math.max(0, Math.ceil(seg.p2.screen.y)));
    }

    // the desert train runs along the far edge of the terrain (only when that edge is near the horizon)
    if (curStage.key === 'desert' && maxy / R < 100) { ctx.save(); ctx.scale(R, R); drawTrain(Math.ceil(maxy / R)); ctx.restore(); }

    // attach cars to segments for this frame
    for (const s of carSegs) s.cars.length = 0;
    carSegs = [];
    for (const c of cars) {
      const s = segments[Math.floor(c.z / SEG)];
      if (!s) continue;
      c.pct = (c.z % SEG) / SEG;
      s.cars.push(c); carSegs.push(s);
    }

    // sprites, back to front
    carFx = []; lamps = [];
    {
      const lt = pSeg.theme;
      lightDark = Math.max(nightKNow * night, weather.level * 0.5, tunnelK * 0.7);
      const fw = fireworks.length > 0 && curStage.key === 'miami';
      lightOn = lightDark > 0.12 || fw;
      if (lightOn) {
        lctx.globalCompositeOperation = 'source-over'; lctx.clearRect(0, 0, VW, VH);
        lctx.globalCompositeOperation = 'lighter';
        if (fw) drawFireworks();
      }
    }
    const pIdxR = Math.floor((position + PLAYER_Z) / SEG);
    const coinFrame = SPR.coin[Math.floor(T * 8) % 4];
    for (let i = last - 1; i >= base.index; i--) {
      const seg = segments[i];
      if (seg.p1.camera.z <= CAM_D) { if (seg === pSeg) drawPlayer(); continue; }
      if (seg.tunnel) {
        drawTunnelSeg(seg, ctx);
        if (lightOn) { lctx.globalCompositeOperation = 'destination-out'; drawTunnelSeg(seg, lctx); lctx.globalCompositeOperation = 'lighter'; }
      }
      const sc = seg.p1.screen.scale, sx = seg.p1.screen.x, sy = seg.p1.screen.y;
      const k = sc * ROAD_W * VW / 2;
      let sL = 0, sR = 0;
      if (seg.fork) [sL, sR] = splitsAt(seg, 0);
      for (const s of seg.sprites) {
        if (s.dolphin || s.tumble) { drawEventSprite(s, seg, i - pIdxR, sc, sx, sy, k); continue; }
        const so = s.offset + (s.follow < 0 ? -sL : s.follow > 0 ? sR : 0);
        const bob = s.bob ? Math.sin(T * 2.5 + i) * sc * 60 * VW / 2 : 0;
        drawSprite(s.spr, sc, sx + so * k, sy + bob, s.ax, seg.clip);
        if (s.spr.lights) {
          const dw = s.spr.ww * sc * VW / 2, dh = s.spr.wh * sc * VW / 2, dx = sx + so * k + dw * s.ax, dy = sy + bob - dh;
          s.spr.lights.forEach(([fx, fy, rf, rgb, kind], j) => {
            const ly = dy + fy * dh;
            if (ly < seg.clip && dh > 4) {
              const L = { x: dx + fx * dw, y: ly, r: Math.max(2, rf * dh), w: dw, rgb, kind, id: i * 7 + j, base: dy + dh, clip: seg.clip };
              lamps.push(L);
              if (lightOn && lightDark > 0.12) lampLight(L);
            }
          });
        }
      }
      for (const c of seg.cars) {
        const csc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, c.pct);
        const cx = lerp(seg.p1.screen.x, seg.p2.screen.x, c.pct) + csc * c.offset * ROAD_W * VW / 2;
        const cy = lerp(seg.p1.screen.y, seg.p2.screen.y, c.pct);
        drawSprite(c.spr, csc, cx, cy, -0.5, seg.clip);
        const dw = c.spr.ww * csc * VW / 2, dh = c.spr.wh * csc * VW / 2;
        if (dw > 3 && cy <= seg.clip + 1) carFx.push({ c, x: cx, y: cy, dw, dh });
      }
      for (const it of seg.items) {
        if (it.taken) continue;
        const hover = (110 + Math.sin(T * 5 + i) * 30) * sc * VW / 2;
        drawSprite(it.type === 'coin' ? coinFrame : SPR.wrench, sc, sx + it.offset * k, sy - hover, -0.5, seg.clip);
      }
      if (seg === pSeg) drawPlayer();
    }

    // smoke over the car (it is between the car and the camera)
    for (const p of smoke) {
      const tex = SPR.puff[p.kind][p.v], k = p.life / p.max;
      const sz = Math.round(p.size * R);
      ctx.globalAlpha = p.alpha * Math.min(1, k * 1.6) * Math.min(1, (1 - k) * 8 + 0.3);
      ctx.drawImage(tex, Math.round(p.x * R - sz / 2), Math.round(p.y * R - sz / 2), sz, sz);
    }
    ctx.globalAlpha = 1;
    drawSparks();
    drawAtmosphere(pSeg.theme);
    ctx.scale(R, R);
    for (const p of particles) {
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.restore();

    // photo finish: grab the 3D view before the HUD is drawn over it
    if (photoWant) {
      photo = document.createElement('canvas');
      photo.width = VW; photo.height = VH;
      photo.getContext('2d').drawImage(canvas, 0, 0);
      photoWant = false; camFlash = 1;
      Sound.shutter();
    }

    if (hudDirty) { hctx.clearRect(0, 0, hud.width, hud.height); hudDirty = false; }
    ctx.save(); ctx.scale(R, R);
    drawOverlay(pSeg);
    ctx.restore();
  }

  // ================================================================== HUD and screens
  const txt = (s, x, y, color, o = {}) => Font.draw(ctx, s, x, y, Object.assign({ color }, o));
  const blink = (rate = 2) => Math.floor(T * rate * 2) % 2 === 0;

  function bar(x, y, w, h, frac, col, back = '#1a0a2a') {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * clamp(frac, 0, 1)), h);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, Math.round(w * clamp(frac, 0, 1)), 1);
  }

  function drawHUD(pSeg) {
    if (cars.some(c => c.chase > 0) && blink(3)) txt('POLICE!', W / 2, 30, Math.floor(T * 6) % 2 ? '#ff3040' : '#4a7aff', { align: 'center', outline: '#1a0630' });
    if (boostT > 0) txt('BOOST', W / 2, 30 + (cars.some(c => c.chase > 0) ? 9 : 0), '#3aff7a', { align: 'center' });
    if (overT > 0 && (overT > 3 || blink(3))) txt('OVERDRIVE ' + Math.ceil(overT), 8, 50, '#ffe14a');
    const tcol = timeLeft < 10 ? (blink(2) ? '#ff3040' : '#ffe14a') : '#ffe14a';
    txt('TIME', 8, 5, '#ff4fa8');
    txt(String(Math.ceil(timeLeft)).padStart(2, '0'), 8, 14, tcol, { scale: 2 });
    txt(fmtTime(raceTime), 8, 31, '#b8a8d8');
    if (streak >= 2 && state === 'race') {
      const col = streakPop > 0.5 ? '#ffffff' : streak >= 10 ? '#ffe14a' : '#ff7ad0';
      txt('STREAK X' + streak, 8 - Math.round(streakPop * 2), 41, col, { outline: streakPop > 0 ? '#1a0630' : undefined });
    }
    txt('SCORE', W / 2, 5, '#ff4fa8', { align: 'center' });
    txt(String(Math.floor(score)).padStart(7, '0'), W / 2, 14, '#ffffff', { align: 'center' });
    txt('STAGE ' + (curStage.level + 1), W - 8, 5, '#20e0f0', { align: 'right' });
    txt(curStage.th.name, W - 8, 14, '#ffffff', { align: 'right' });

    const kmh = String(Math.round(speed / MAX_SPEED * KMH)).padStart(3, ' ');
    txt(kmh, 8, 156, '#ffffff', { scale: 2 });
    txt('KM/H', 46, 163, '#ff4fa8');
    bar(8, 172, 60, 3, speed / MAX_SPEED, speed > MAX_SPEED * 0.85 ? '#ff3fa4' : '#20e0f0');

    const fcol = fuel < 20 ? '#ff3040' : fuel < 45 ? '#ffd23a' : '#3aff7a';
    txt('FUEL', 238, 157, fuel < 20 && blink(2) ? '#ff3040' : '#ffffff', { align: 'right' });
    bar(244, 158, 68, 5, fuel / 100, fcol);
    txt('DMG', 238, 168, damage > 70 && blink(2) ? '#ff3040' : '#ffffff', { align: 'right' });
    bar(244, 169, 68, 5, damage / 100, damage > 70 ? '#ff3040' : '#ff8a3a');
    ctx.drawImage(SPR.coin[0].img, 244, 141, 9, 9);
    txt('X' + coins, 255, 142, '#ffd23a');

    // fork hint
    if (pSeg.fork && !pSeg.stage.choice && state === 'race') {
      const th = pSeg.stage.th;
      if (blink(2)) txt('CHOOSE YOUR ROAD!', W / 2, 40, '#ffe14a', { align: 'center' });
      txt('< ' + THEMES[th.next[0]].name, 8, 52, '#20e0f0');
      txt(THEMES[th.next[1]].name + ' >', W - 8, 52, '#20e0f0', { align: 'right' });
    } else if (state === 'race' && pSeg.index >= curStage.bodyEnd && curStage.forkStart && !curStage.choice) {
      if (blink(1.5)) txt('FORK AHEAD', W / 2, 40, '#ffe14a', { align: 'center' });
    }
    if (fuel > 0 && fuel < 20 && state === 'race' && blink(1)) txt('LOW FUEL - GRAB COINS!', W / 2, 128, '#ff3040', { align: 'center' });
  }

  // Messages sit in the sky just under the HUD, drawn on the full-resolution overlay with
  // half-size pixels (scale 2 -> normal size) so they don't cover the road; they fade in/out.
  function drawMsgs() {
    if (!msgs.length) return;
    const g = hctx, u = hud.width / W, fs = Math.max(1, Math.round(u / 2));
    let y = 25;
    for (const m of msgs) {
      const mh = m.img ? m.h : 3.5 * m.scale;
      g.globalAlpha = Math.min(1, m.t * 3, (m.max - m.t) * 8);
      if (m.img) hudImg(m.img, W / 2, y + mh / 2, mh);
      else Font.draw(g, m.text, Math.round(W / 2 * u), Math.round(y * u),
        { color: m.color, scale: fs * m.scale, align: 'center', outline: '#1a0630', shadow: null });
      y += mh + 2;
    }
    g.globalAlpha = 1; hudDirty = true;
  }

  // Radio DJ tag: a cassette and the station, sliding in at the top right under the stage name
  function drawRadioTag() {
    if (!radioTag || state === 'title') return;
    const g = hctx, u = hud.width / W, fs = Math.max(1, Math.round(u / 2)), p = fs;   // p: half game pixel
    const name = radioTag.name, t = radioTag.t;
    const tw = Math.max(Font.width('RADIO RETRO FM', fs), Font.width(name, fs));
    const bw = 34 * p + tw, bh = 22 * p;
    const slide = smooth(clamp(Math.min(3.4 - t, t) / 0.3, 0, 1));
    const bx = Math.round(hud.width - 8 * u - bw + (1 - slide) * (bw + 8 * u)), by = Math.round(25 * u);
    g.globalAlpha = 0.85;
    g.fillStyle = '#1a0630'; g.fillRect(bx, by, bw, bh);
    g.fillStyle = '#ff3fa4'; g.fillRect(bx, by, bw, p); g.fillRect(bx, by + bh - p, bw, p);
    g.globalAlpha = 1;
    // cassette 26 x 16 half pixels with two turning reels
    const cx = bx + 3 * p, cy = by + 3 * p;
    g.fillStyle = '#2a2a3a'; g.fillRect(cx, cy, 26 * p, 16 * p);
    g.fillStyle = '#ffe14a'; g.fillRect(cx + 2 * p, cy + 2 * p, 22 * p, 4 * p);
    g.fillStyle = '#ff3fa4'; g.fillRect(cx + 2 * p, cy + 4 * p, 22 * p, p);
    g.fillStyle = '#d8d0e8'; g.fillRect(cx + 6 * p, cy + 8 * p, 14 * p, 5 * p);
    const spin = Math.floor(T * 8) % 2;
    for (const rx of [cx + 7 * p, cx + 15 * p]) {
      g.fillStyle = '#2a2a3a'; g.fillRect(rx, cy + 9 * p, 4 * p, 3 * p);
      g.fillStyle = '#ffffff'; g.fillRect(rx + (spin ? p : 2 * p), cy + 9 * p + (spin ? p : 0), p, spin ? p : 3 * p);
    }
    const tx = cx + 30 * p;
    Font.draw(g, 'RADIO RETRO FM', tx, by + 4 * p, { color: '#ff7ad0', shadow: null, scale: fs });
    Font.draw(g, name, tx, by + 12 * p, { color: '#ffffff', shadow: null, scale: fs });
    hudDirty = true;
  }

  // Photo finish: the picture taken at the goal arch in a Polaroid frame that drops in tilted and
  // develops; route and total time hand-written in the bottom strip. t: seconds since it appeared.
  function drawPolaroid(cx, cy, t) {
    const g = hctx, u = hud.width / W, fs = Math.max(1, Math.round(u / 2));
    const pw = 128, ph = 72, b = 5, bb = 20, fw = pw + b * 2, fh = ph + b + bb;
    const drop = 1 - smooth(clamp(t / 0.55, 0, 1));
    g.save();
    g.translate(cx * u, (cy - drop * 150) * u);
    g.rotate((-4 - drop * 14) * Math.PI / 180);
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect((-fw / 2 + 2) * u, (-fh / 2 + 3) * u, fw * u, fh * u);
    g.fillStyle = '#f6f1e4'; g.fillRect(-fw / 2 * u, -fh / 2 * u, fw * u, fh * u);
    const px = (-fw / 2 + b) * u, py = (-fh / 2 + b) * u;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(photo, px, py, pw * u, ph * u);
    g.fillStyle = 'rgba(255,170,90,0.10)'; g.fillRect(px, py, pw * u, ph * u);       // warm print
    const dev = clamp((t - 0.4) / 1.6, 0, 1);                                         // developing
    if (dev < 1) { g.fillStyle = `rgba(232,226,210,${(1 - dev) * 0.95})`; g.fillRect(px, py, pw * u, ph * u); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px, py, pw * u, u / 2);              // inner edge
    // caption in the bottom strip: route (first word of each stage) and the total time, sized to fit
    const cap = route.map(k => THEMES[k].name.split(' ')[0]).join(' > '), tm = 'TIME ' + fmtTime(finishTime);
    const stripTop = (fh / 2 - bb) * u, stripH = bb * u;
    const cs = Math.max(1, Math.min(fs, Math.floor(pw * u * 0.92 / Font.width(cap, 1))));
    const ts = Math.max(1, Math.min(Math.floor(stripH * 0.4 / 7), Math.floor(pw * u * 0.8 / Font.width(tm, 1))));
    const capY = stripTop + Math.round(stripH * 0.14);
    Font.draw(g, cap, 0, capY, { color: '#2c2a7a', shadow: null, scale: cs, align: 'center' });
    Font.draw(g, tm, 0, capY + 7 * cs + Math.round(stripH * 0.08), { color: '#c02060', shadow: null, scale: ts, align: 'center' });
    g.restore();
    hudDirty = true;
  }

  const NODE = { miami: [0, 0], neon: [-1, 1], bayou: [1, 1], keys: [-1, 2], desert: [1, 2] };
  const EDGES = [['miami', 'neon'], ['miami', 'bayou'], ['neon', 'keys'], ['neon', 'desert'], ['bayou', 'keys'], ['bayou', 'desert']];

  function pxLine(x0, y0, x1, y1, col) {
    ctx.fillStyle = col;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), 1, 1);
  }

  function drawRouteMap(cx, y0) {
    const pos = k => [cx + NODE[k][0] * 62, y0 + NODE[k][1] * 18];
    const onRoute = (a, b) => route.some((r, i) => r === a && route[i + 1] === b);
    for (const [a, b] of EDGES) {
      const [x0, y0a] = pos(a), [x1, y1] = pos(b);
      pxLine(x0, y0a + 3, x1, y1 + 3, onRoute(a, b) ? '#ff3fa4' : '#4a3a7a');
    }
    for (const k in NODE) {
      const [x, y] = pos(k);
      const name = THEMES[k].name, w = Font.width(name);
      const visited = route.includes(k), current = route[route.length - 1] === k;
      ctx.fillStyle = visited ? '#3a0f5a' : '#120a28';
      ctx.fillRect(Math.round(x - w / 2 - 3), y - 2, w + 6, 11);
      txt(name, x, y, current && blink(2) ? '#ffffff' : visited ? '#ffe14a' : '#7a6a9a', { align: 'center' });
    }
  }

  // atlas image on the full-resolution overlay, centred at (cx, cy) in game pixels, h game px tall
  function hudImg(name, cx, cy, h) {
    const [sx, sy, sw, sh] = ATLAS[name];
    const u = hud.width / W, dh = h * u, dw = dh * sw / sh;
    hctx.imageSmoothingEnabled = true; hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(Gfx.sheet(), sx, sy, sw, sh, Math.round(cx * u - dw / 2), Math.round(cy * u - dh / 2), Math.round(dw), Math.round(dh));
    hudDirty = true;
  }

  function dim(a = 0.55) { ctx.fillStyle = `rgba(12,2,30,${a})`; ctx.fillRect(0, 0, W, H); }

  const LOGO = ['#ffffff', '#ffe9fb', '#ffb3ec', '#ff6fd0', '#d23cc0', '#8a2cc8', '#4a3ae0'];

  // Title screen: dimmed backdrop on the game canvas, logo and text on the full-resolution
  // overlay. Positions are in game pixels (u = real pixels per game pixel); the font uses
  // half-size pixels so the text stays crisp but smaller than the in-game HUD.
  const RANKS = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH', '7TH', '8TH', '9TH', '10TH'];
  function drawScoreTable(hl) {
    txt('HIGH SCORES', W / 2, 10, LOGO, { align: 'center', scale: 2, outline: '#1a0630' });
    const head = '#ff4fa8';
    txt('RANK', 30, 34, head); txt('NAME', 70, 34, head); txt('SCORE', 176, 34, head, { align: 'right' });
    txt('TIME', 238, 34, head, { align: 'right' }); txt('STAGE', 252, 34, head);
    scores.forEach((e, i) => {
      const y = 46 + i * 10;
      const col = i === hl ? (blink(3) ? '#ffffff' : '#3aff7a') : i < 3 ? '#ffe14a' : '#20e0f0';
      txt(RANKS[i], 30, y, col); txt(e.name, 70, y, col);
      txt(String(e.score).padStart(7, '0'), 176, y, col, { align: 'right' });
      txt(fmtTime(e.time), 238, y, col, { align: 'right' });
      txt(e.stage >= 4 ? 'GOAL' : String(e.stage), 252, y, col);
    });
    txt('BEST TIME  ' + (bestTime ? fmtTime(bestTime.time) + '  ' + bestTime.name : fmtTime(null)), W / 2, 152, '#3aff7a', { align: 'center' });
  }

  function drawEntry() {
    txt('NEW HIGH SCORE!', W / 2, 20, LOGO, { align: 'center', scale: 2, outline: '#1a0630' });
    const sc = Math.floor(score);
    const rank = scores.filter(e => e.score >= sc).length;
    txt('YOU RANK ' + RANKS[rank] + '   SCORE ' + sc, W / 2, 46, '#ffe14a', { align: 'center' });
    if (finishTime !== null) txt('TOTAL TIME ' + fmtTime(finishTime), W / 2, 57, '#3aff7a', { align: 'center' });
    txt('ENTER YOUR INITIALS', W / 2, 74, '#ffffff', { align: 'center' });
    for (let i = 0; i < 3; i++) {
      const x = W / 2 - 41 + i * 30, cur = i === entry.pos;
      const col = cur ? (blink(3) ? '#ffffff' : '#ff4fa8') : '#20e0f0';
      txt(entry.name[i] === ' ' ? '_' : entry.name[i], x + 6, 90, col, { scale: 3, outline: '#1a0630' });
      if (cur) { ctx.fillStyle = col; ctx.fillRect(x + 5, 115, 16, 2); }
    }
    txt(touchMode ? 'GAS/BRAKE: LETTER   >: NEXT' : 'TYPE, OR UP/DOWN + ENTER', W / 2, 140, '#b8a8d8', { align: 'center' });
  }

  const RADIO_Y = 110; // title screen radio line (also the touch target for changing station)
  function drawTitle() {
    if (Math.floor(stateT / 7) % 2 === 1) {         // attract mode: show the high score table
      dim(0.6);
      drawScoreTable(-1);
      if (blink(1.2)) txt(touchMode ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, 168, '#ff4fa8', { align: 'center' });
      return;
    }
    ctx.fillStyle = 'rgba(12,2,30,0.2)'; ctx.fillRect(0, 0, W, H);

    hudDirty = true;
    const g = hctx, u = hud.width / W, fs = Math.max(1, Math.round(u / 2)), cx = hud.width / 2;
    g.imageSmoothingEnabled = false;
    // no backing panel: every line gets a dark outline so it reads over the scenery
    const OL = '#1a0630';
    const t = (s, y, color, o = {}) => Font.draw(g, s, cx, Math.round(y * u), Object.assign({ color, scale: fs, align: 'center', outline: OL }, o));

    t('HI ' + String(hiScore).padStart(7, '0'), 4, '#20e0f0');
    const lw = 232 * u, lh = lw * logo.height / logo.width;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(logo, Math.round(cx - lw / 2), Math.round(12 * u), Math.round(lw), Math.round(lh));
    g.imageSmoothingEnabled = false;
    t('~ A NEON ROAD TRIP ~', 89, '#ffe14a');

    // icon row: [coin] COINS = FUEL   [wrench] = REPAIR
    const ic = 8 * fs, gap = 4 * fs, a = 'COINS = FUEL', b = '= REPAIR';
    const total = ic + gap + Font.width(a, fs) + 16 * fs + ic + gap + Font.width(b, fs);
    let x = Math.round(cx - total / 2);
    const y = Math.round(96 * u);
    g.drawImage(SPR.coin[0].img, x, y - fs, ic, ic); x += ic + gap;
    Font.draw(g, a, x, y, { color: '#ffd23a', scale: fs, outline: OL }); x += Font.width(a, fs) + 16 * fs;
    g.drawImage(SPR.wrench.img, x, y - fs, ic, ic); x += ic + gap;
    Font.draw(g, b, x, y, { color: '#7ab8ff', scale: fs, outline: OL });
    t('BEAT THE CLOCK - CHOOSE YOUR ROAD AT EVERY FORK', 103, '#ffffff');

    t('RADIO: < ' + Sound.tracks[musicSel] + ' >', RADIO_Y, '#20e0f0');
    if (blink(1.2)) t(touchMode ? 'TAP TO START' : 'PRESS ENTER TO START', 119, '#ff4fa8', { scale: fs * 2 });
    t('ARROWS/WASD DRIVE   M MUSIC   P PAUSE', 171, '#b8a8d8');
  }

  function drawOverlay(pSeg) {
    if (state === 'title') { drawTitle(); return; }
    if (state === 'entry') { dim(0.6); drawEntry(); return; }
    if (state === 'scores') {
      dim(0.6);
      drawScoreTable(newRank);
      if (stateT > 0.5 && blink(1.2)) txt(touchMode ? 'TAP TO CONTINUE' : 'PRESS ENTER', W / 2, 168, '#ff4fa8', { align: 'center' });
      return;
    }
    drawHUD(pSeg);
    drawSpeech();
    drawMsgs();
    drawRadioTag();

    if (state === 'countdown') {
      // each digit pops in slightly bigger and settles
      const n = 3 - Math.floor(stateT), f = stateT % 1;
      if (n > 0) hudImg('cd' + n, W / 2, 100, 44 * (1 + 0.35 * Math.max(0, 1 - f / 0.15)));
    } else if (state === 'race' && stateT < 1) {
      hudImg('uiGo', W / 2, 100, 42 * (1 + 0.3 * Math.max(0, 1 - stateT / 0.15)));
    }

    if (state === 'gameover' && stateT > 0.8) {
      dim();
      txt('GAME OVER', W / 2, 18, ['#ffffff', '#ffd0e8', '#ff9ad0', '#ff5a9a', '#ff3060', '#d02040', '#a01030'], { align: 'center', scale: 3, outline: '#1a0630' });
      txt(endReason, W / 2, 46, '#ffe14a', { align: 'center' });
      txt('SCORE ' + Math.floor(score) + '   TIME ' + fmtTime(raceTime), W / 2, 60, '#ffffff', { align: 'center' });
      txt('HI ' + hiScore, W / 2, 70, '#20e0f0', { align: 'center' });
      drawRouteMap(W / 2, 90);
      if (blink(1.2)) txt(touchMode ? 'TAP TO CONTINUE' : 'PRESS ENTER', W / 2, 160, '#ff4fa8', { align: 'center' });
    }

    if (state === 'goal' && stateT > 2) {
      // photo finish on the left, results on the right
      dim(0.55);
      const cx = 234;
      txt('GOAL!', cx, 12, LOGO, { align: 'center', scale: 3, outline: '#1a0630' });
      txt('WHAT A RIDE!', cx, 38, '#ffe14a', { align: 'center' });
      txt('TIME BONUS  ' + bonus.time, cx, 52, '#ffffff', { align: 'center' });
      txt('FUEL BONUS  ' + bonus.fuel, cx, 61, '#ffffff', { align: 'center' });
      const record = bestTime === null || finishTime < bestTime.time;
      txt('TOTAL ' + fmtTime(finishTime), cx, 75, '#3aff7a', { align: 'center' });
      if (!record) txt('BEST  ' + fmtTime(bestTime.time) + ' ' + bestTime.name, cx, 84, '#ffe14a', { align: 'center' });
      else if (blink(2)) txt('NEW BEST TIME!', cx, 84, '#ffe14a', { align: 'center' });
      txt('SCORE ' + Math.floor(score), cx, 98, '#20e0f0', { align: 'center' });
      txt('HI ' + hiScore, cx, 107, '#20e0f0', { align: 'center' });
      if (photo) drawPolaroid(80, 92, stateT - 2);
      else drawRouteMap(W / 2, 120);
      if (stateT > 4 && blink(1.2)) txt(touchMode ? 'TAP TO CONTINUE' : 'PRESS ENTER', W / 2, 164, '#ff4fa8', { align: 'center' });
    }
    if (camFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${camFlash * camFlash * 0.85})`; ctx.fillRect(0, 0, W, H); }

    if (state === 'paused') {
      dim(0.5);
      txt('PAUSED', W / 2, 70, '#ffe14a', { align: 'center', scale: 3, outline: '#1a0630' });
      txt('P TO RESUME', W / 2, 100, '#ffffff', { align: 'center' });
    }

  }

  // ================================================================== input
  const keys = { left: false, right: false, gas: false, brake: false };
  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'gas', KeyW: 'gas', KeyZ: 'gas', ArrowDown: 'brake', KeyS: 'brake', KeyX: 'brake'
  };
  let touchMode = false;

  function action() {
    Sound.init();
    if (state === 'title') { Sound.select(); startRace(); }
    else if (state === 'gameover' && stateT > 1) toScores();
    else if (state === 'goal' && stateT > 4) toScores();
    else if (state === 'entry') entryKey('ok');
    else if (state === 'scores' && stateT > 0.5) toTitle();
  }

  function togglePause() {
    if (state === 'paused') { state = pausedFrom; pausedFrom = null; Sound.resume(); }
    else if (state === 'race' || state === 'countdown' || state === 'timeup') { pausedFrom = state; state = 'paused'; Sound.suspend(); }
  }

  function changeRadio(d) {
    musicSel = (musicSel + d + Sound.tracks.length) % Sound.tracks.length;
    try { localStorage.setItem('retrorun.radio', String(musicSel)); } catch (e) { /* storage unavailable */ }
    Sound.select();
    Sound.playMusic(musicSel);
  }

  window.addEventListener('keydown', e => {
    if (state === 'entry') {   // name entry: type letters, or arrows to pick, Enter to confirm
      e.preventDefault();
      if (e.repeat && !/^Arrow(Up|Down)$/.test(e.code)) return;
      const m = /^(Key([A-Z])|Digit([0-9]))$/.exec(e.code);
      if (m) entryKey(m[2] || m[3]);
      else if (e.code === 'ArrowUp') entryKey('up');
      else if (e.code === 'ArrowDown') entryKey('down');
      else if (e.code === 'ArrowLeft' || e.code === 'Backspace') entryKey('left');
      else if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'Space') entryKey('ok');
      return;
    }
    const first = !Sound.ready;
    Sound.init();
    if (first && state === 'title') Sound.playMusic(musicSel);
    const k = KEYMAP[e.code];
    if (k) {
      if (state === 'title' && !e.repeat && (k === 'left' || k === 'right')) changeRadio(k === 'left' ? -1 : 1);
      keys[k] = true; e.preventDefault();
    }
    if (e.repeat) return;
    if (e.code === 'Space' && driving()) { honk(); e.preventDefault(); }
    else if (e.code === 'Enter' || e.code === 'Space') { action(); e.preventDefault(); }
    else if (e.code === 'KeyM') { const on = Sound.toggleMusic(); if (state !== 'title') msg(on ? 'MUSIC ON' : 'MUSIC OFF', '#b8a8d8', 1.2); }
    else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'KeyH' && driving()) honk();
    else if (e.code === 'KeyR' && state !== 'title' && state !== 'entry') changeRadio(1);
  });
  window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) keys[k] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'race' || state === 'countdown') togglePause(); });

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') touchMode = true;
    const first = !Sound.ready;
    Sound.init();
    if (first && state === 'title' && !touchMode) Sound.playMusic(musicSel);
    if (state === 'paused') { togglePause(); return; }
    if (state === 'title' && touchMode) {
      const rect = canvas.getBoundingClientRect();
      const y = (e.clientY - rect.top) / rect.height * H, x = (e.clientX - rect.left) / rect.width * W;
      if (y > RADIO_Y - 4 && y < RADIO_Y + 8) { changeRadio(x < W / 2 ? -1 : 1); return; }
    }
    action();
  });

  document.querySelectorAll('#touch button').forEach(b => {
    const k = b.dataset.key;
    const on = e => {
      e.preventDefault(); touchMode = true; Sound.init();
      if (state === 'entry') { if (k !== 'horn') entryKey({ gas: 'up', brake: 'down', left: 'left', right: 'ok' }[k]); return; }
      if (k === 'horn') { if (driving()) honk(); b.classList.add('on'); return; }
      keys[k] = true; b.classList.add('on');
    };
    const off = e => { e.preventDefault(); keys[k] = false; b.classList.remove('on'); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });

  // debug hook for automated visual tests: index.html?debug
  if (location.search.includes('debug')) {
    window.rrDebug = {
      jump(rel) { const b = curStage[rel.from]; position = Math.max(0, ((Array.isArray(b) ? b[0] : b) + rel.by) * SEG - PLAYER_Z); lastItemIdx = Math.floor(position / SEG); },
      set(o) { if ('x' in o) playerX = o.x; if ('speed' in o) speed = o.speed * MAX_SPEED; if ('time' in o) timeLeft = o.time; if ('fuel' in o) fuel = o.fuel; if ('damage' in o) damage = o.damage; if ('score' in o) score = o.score; if ('raceTime' in o) raceTime = o.raceTime; if ('g' in o) AIR_G = o.g; if ('over' in o) overT = o.over; if ('trainT' in o) { trainT = o.trainT; trainB0 = bgOff; } },
      police() { const pz = position + PLAYER_Z; const c = cars.find(o => o.z > pz) || cars[0]; if (!c) return 'none'; c.police = true; c.spr = SPR.cars.find(x => x.name === POLICE); c.chase = 7; c.z = pz - SEG * 3; c.offset = 0; return 'chase'; },
      say(k) { say(k || 'bump', true); return speech.text; },
      night(v) { night = v; raceTime = v >= 0.5 ? NIGHT_CYCLE * 0.38 : 0; return night; },
      lamps() { return lamps.length; },
      tow() { const pz = position + PLAYER_Z; const c = cars.find(o => o.z > pz) || cars[0]; if (!c) return 0; c.z = pz + SEG * 3.5; c.offset = playerX - findSeg(c.z).center; c.speed = speed; c.lc = null; return 1; },
      lane() { const c = cars.find(o => o.z > position + PLAYER_Z && !o.lc); return c ? startLaneChange(c, 5) : false; },
      info() { return { state, stage: curStage.key, level: curStage.level, seg: Math.floor((position + PLAYER_Z) / SEG), x: playerX, route: route.join('>'), segs: segments.length, music: Sound.nowPlaying, steer, acc: Math.round(roadAcc), accMax: Math.round(accMax), air: Math.round(airH), airT: +airT.toFixed(2), airMax: Math.round(airMax), streak, slip: +slipK.toFixed(2), kmh: Math.round(speed / MAX_SPEED * KMH), tunnel: +tunnelK.toFixed(2), train: Math.round(trainX()), photo: !!photo, radio: radioTag && radioTag.name }; }
    };
  }

  // ================================================================== main loop
  toTitle();
  const STEP = 1 / 60;
  let acc = 0, lastT = performance.now();
  function frame(now) {
    acc += Math.min(0.25, (now - lastT) / 1000);
    lastT = now;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

{
  const load = src => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('RetroRun: cannot load ' + src));
    img.src = src;
  });
  Promise.all([load('assets/sprites.png'), load('assets/logo.png')])
    .then(([sheet, logo]) => startGame(sheet, logo))
    .catch(e => console.error(e.message));
}
