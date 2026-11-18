// undefAIned: game states, camera, input, HUD, menus and race management.
'use strict';

const MODES = ['Quick Race', 'Grand Prix', 'Time Trial'];
const CLASSES = [
  { name: '50cc  Easy', skill: [0.84, 0.9] },
  { name: '100cc  Normal', skill: [0.92, 0.97] },
  { name: '150cc  Hard', skill: [0.98, 1.03] }
];
const GP_POINTS = [15, 12, 10, 8, 6, 4, 2, 1];
const PLAYER_COLOR = '#ffe14a';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('kario18:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('kario18:' + k, JSON.stringify(v)); } catch (e) { } }
};

const game = {
  state: 'boot', time: 0, cars: [], player: null, track: null, trackIndex: -1,
  settings: Object.assign({ mode: 0, track: 0, car: 0, diff: 1, gfx: 0 }, store.get('settings', {})),
  gp: null, raceTime: 0, stateT: 0, finishCount: 0
};
// graphics preset: no saved choice yet = measure the frame time on the title screen (autoDetectGfx)
game.autoGfx = store.get('settings', {}).gfx === undefined;
if (!QUALITY[game.settings.gfx]) game.settings.gfx = 0;
Q = QUALITY[game.settings.gfx];
// settings.car is the car type (0-2); older saves stored one of the 9 models
if (!(game.settings.car >= 0 && game.settings.car < CAR_TYPES.length)) game.settings.car = CAR_MODELS[game.settings.car] ? CAR_MODELS[game.settings.car].type : 0;
const playerModel = () => CAR_TYPES[game.settings.car].template;
function carLabel(model, isPlayer) {
  const m = CAR_MODELS[model];
  return CAR_TYPES[m.type].name + ' ' + (isPlayer ? 'Red' : m.color);
}
const trackCache = [];
function trackData(i) { return trackCache[i] || (trackCache[i] = genTrack(TRACKS[i])); }

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio) * Q.scale);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// tone mapping and sRGB conversion happen in the last post-processing pass (FINAL_SHADER)
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputEncoding = THREE.LinearEncoding;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.3, 5000);
game.scene = scene;
game.renderer = renderer;

// ---- post-processing: HDR scene (half float, 4x MSAA) -> [SSAO] -> bloom -> final grade
const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null }, exposure: { value: 1 }, tint: { value: new THREE.Vector3(1, 1, 1) },
    saturation: { value: 1.08 }, contrast: { value: 1.12 }, vignette: { value: 0.32 }, time: { value: 0 },
    blur: { value: 0 }, haze: { value: 0 }, hazeAt: { value: new THREE.Vector2(0.5, 0.55) }, speedLines: { value: 0 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float exposure; uniform vec3 tint; uniform float saturation;
    uniform float contrast; uniform float vignette; uniform float time; varying vec2 vUv;
    uniform float blur; uniform float haze; uniform vec2 hazeAt; uniform float speedLines;
    float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 uv = vUv;
      // heat haze behind the exhausts / during the turbo: the picture wobbles around hazeAt
      if (haze > 0.001) {
        vec2 hd = uv - hazeAt;
        float hf = haze * exp(-dot(hd * vec2(2.2, 3.4), hd * vec2(2.2, 3.4)) * 3.0);
        uv += vec2(sin(uv.y * 70.0 + time * 9.0), cos(uv.x * 60.0 + time * 7.0)) * 0.0045 * hf;
      }
      // radial blur from the centre of the screen: samples along the ray towards the centre
      vec3 acc = texture2D(tDiffuse, uv).rgb;
      float edge = smoothstep(0.12, 0.6, length((uv - vec2(0.5, 0.42)) * vec2(1.3, 1.0)));
      if (blur > 0.001) {
        vec2 dir = (vec2(0.5, 0.46) - uv);
        float jit = hsh(uv * 731.0 + time) * 0.5;
        acc = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float k = (float(i) + jit) / 8.0;
          acc += texture2D(tDiffuse, uv + dir * blur * k * edge).rgb;
        }
        acc /= 8.0;
      }
      vec3 c = acc * exposure * tint;
      c = toSRGB(aces(c));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5;
      c *= 1.0 - (vignette + blur * 2.5) * smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
      // speed lines: thin streaks radiating from the centre, only in the outer part of the screen
      if (speedLines > 0.001) {
        float ang = atan(d.y, d.x), rad = length(d * vec2(1.25, 1.0));
        float lines = step(0.84, hsh(vec2(floor(ang * 38.0), floor(time * 14.0))));
        float len = hsh(vec2(floor(ang * 38.0) + 3.0, floor(time * 14.0)));
        float m = smoothstep(0.34 + len * 0.1, 0.62, rad) * lines * speedLines;
        c += vec3(0.9, 0.95, 1.0) * m * 0.22;
      }
      // a touch of noise against banding in the sky
      c += (fract(sin(dot(vUv * 913.0 + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`
};
let post = null;
// (re)creates the post-processing chain for the current preset Q: MSAA samples, bloom or not
function buildPost() {
  if (post) { post.composer.passes.forEach(p => p.dispose && p.dispose()); post.composer.dispose(); }
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new THREE.EffectComposer(renderer, rt);
  composer.addPass(new THREE.RenderPass(scene, camera));
  let bloom = null;
  if (Q.bloom) {
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.35, 1.1);   // strength, radius, threshold (HDR: only lights, sun, sparks)
    composer.addPass(bloom);
  }
  const final = new THREE.ShaderPass(FINAL_SHADER);
  composer.addPass(final);
  return { composer, bloom, final };
}
post = buildPost();
// colour grade of the current track (tint, exposure, saturation) into the final pass
function applyGrade() {
  const gr = (game.theme && game.theme.grade) || {};
  post.final.uniforms.tint.value.set(...(gr.tint || [1, 1, 1]));
  post.final.uniforms.exposure.value = gr.exposure || 1;
  post.final.uniforms.saturation.value = gr.saturation || 1.08;
}
game.camPos = camera.position;
game.fx = new FX(scene);
game.skids = new SkidMarks(scene);
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  post.composer.setPixelRatio(renderer.getPixelRatio());
  post.composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { resize(); cam.shift = null; });
resize();

// ---------------------------------------------------------------- input

const keys = {};
const pad = { steer: 0, throttle: 0, brake: 0, drift: false, item: false, look: false, prev: {} };
window.addEventListener('keydown', e => {
  Engine.init();   // audio needs a user gesture
  if (game.state !== 'paused') Music.resume();   // the browser blocks the music until the first key press: retry now
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) onKey(e.code);
  keys[e.code] = true;
});
window.addEventListener('pointerdown', () => { Engine.init(); if (game.state !== 'paused') Music.resume(); });
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (racingState()) setPaused(true); });

function pollPad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  let gpad = null;
  for (const g of gps) if (g && g.connected) { gpad = g; break; }
  if (!gpad) { pad.steer = pad.throttle = pad.brake = 0; pad.drift = pad.item = pad.look = false; return; }
  const b = i => gpad.buttons[i] && gpad.buttons[i].pressed;
  const bv = i => gpad.buttons[i] ? gpad.buttons[i].value : 0;
  let sx = gpad.axes[0] || 0;
  if (Math.abs(sx) < 0.15) sx = 0;
  if (b(14)) sx = -1;
  if (b(15)) sx = 1;
  pad.steer = sx;
  pad.throttle = Math.max(b(0) ? 1 : 0, bv(7));
  pad.brake = Math.max(b(1) ? 1 : 0, bv(6));
  pad.drift = b(4) || b(5);
  pad.item = b(2) || b(3);
  pad.look = b(11);
  // menu navigation edges
  const edges = { up: b(12) || (gpad.axes[1] || 0) < -0.6, down: b(13) || (gpad.axes[1] || 0) > 0.6, left: b(14) || sx < -0.6, right: b(15) || sx > 0.6, a: b(0), back: b(1), start: b(9) };
  const map = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', a: 'Enter', back: 'Escape', start: 'Escape' };
  for (const k in edges) {
    if (edges[k] && !pad.prev[k]) {
      if (k === 'a' && racingState()) continue;
      if ((k === 'left' || k === 'right') && racingState()) continue;
      if ((k === 'up' || k === 'down') && racingState()) continue;
      if (k === 'back' && racingState()) continue;
      onKey(map[k]);
    }
    pad.prev[k] = edges[k];
  }
}
function racingState() { return ['intro', 'countdown', 'race', 'finish'].includes(game.state); }

function readPlayerInput(car) {
  const inp = car.input;
  const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
  inp.steer = clamp((right ? 1 : 0) - (left ? 1 : 0) + pad.steer, -1, 1);
  inp.throttle = (keys.ArrowUp || keys.KeyW || pad.throttle > 0.3) ? 1 : 0;
  inp.brake = (keys.ArrowDown || keys.KeyS || pad.brake > 0.3) ? 1 : 0;
  inp.drift = !!(keys.Space || keys.ShiftLeft || keys.ShiftRight || pad.drift);
  const itemNow = !!(keys.KeyX || keys.KeyE || keys.ControlLeft || keys.ControlRight || keys.KeyZ || pad.item);
  inp.item = itemNow && !inp.itemHeld;
  inp.itemHeld = itemNow;
}

// ---------------------------------------------------------------- track management

let built = null;
function setTrack(i) {
  if (game.trackIndex === i && built) return;
  clearCars();
  if (game.items) { game.items.dispose(); game.items = null; }
  if (game.hazards) { game.hazards.dispose(); game.hazards = null; }
  if (built) built.dispose();
  game.fx.clear();
  game.trackIndex = i;
  game.track = trackData(i);
  game.theme = THEMES[TRACKS[i].theme];
  built = buildTrackScene(game.track, scene, renderer);
  game.sunDir = built.sunDir;
  applyGrade();
  hud.prepareMinimap();
}
function clearCars() {
  for (const c of game.cars) { scene.remove(c.mesh.root); c.stopSounds(); }
  game.cars = [];
  game.player = null;
}
function spawnCars(list) {
  clearCars();
  game.skids.clear();
  list.forEach(e => {
    const c = new Car(game, e.slot, e.model, !!e.player, e.driver);
    c.ai.baseSkill = e.skill || 1;
    c.skill = c.isPlayer ? 1 : c.ai.baseSkill;
    game.cars.push(c);
    if (e.player) game.player = c;
  });
}
function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor((rng || Math.random)() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------------------------------------------------------------- HUD

// preload the countdown graphics so they do not pop in late
['count3', 'count2', 'count1', 'countgo', 'lap2', 'lap3', 'boost', 'splat', 'place1', 'place2', 'place3', 'bestlap', 'boom'].forEach(n => { new Image().src = 'img/' + n + '.png'; });

const hud = {
  flashT: 0,
  flash(text, color) {
    const el = $('hud-flash');
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  },
  msg(text, color) {
    const el = $('hud-msg');
    el.textContent = text || '';
    el.style.color = color || 'var(--hot1)';
    el.classList.remove('pop'); void el.offsetWidth; if (text) el.classList.add('pop');
  },
  // Countdown graphics (img/count3.png ... countgo.png, cut out by tools/countdown_build.py)
  count(name) {
    const el = $('hud-count');
    if (!name) {
      if (el.style.display === 'block') { el.classList.remove('pop'); el.classList.add('out'); }
      return;
    }
    el.src = 'img/' + name + '.png';
    el.className = name === 'countgo' ? 'go' : name.startsWith('lap') ? 'lap' : name.startsWith('place') ? 'place' : '';
    el.style.display = 'block';
    void el.offsetWidth;
    el.classList.add('pop');
  },
  // centre graphic that goes away by itself (lap 2 / lap 3)
  banner(name, ms) {
    this.count(name);
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => this.count(null), ms);
  },
  // small graphic flashed above the car (BOOST!, SPLAT!), like flash() for text
  flashPic(name) {
    const el = $('hud-pic');
    el.src = 'img/' + name + '.png';
    el.className = name;
    void el.offsetWidth;
    el.classList.add('show');
  },
  prepareMinimap() {
    const tr = game.track, b = tr.bounds, W = 240, pad = 18;
    const s = Math.min((W - pad * 2) / (b.maxX - b.minX), (W - pad * 2) / (b.maxZ - b.minZ));
    const ox = (W - (b.maxX - b.minX) * s) / 2, oz = (W - (b.maxZ - b.minZ) * s) / 2;
    this.mm = { s, tx: x => ox + (x - b.minX) * s, tz: z => oz + (z - b.minZ) * s };
    // static layer
    const c = document.createElement('canvas');
    c.width = c.height = W;
    const g = c.getContext('2d');
    drawTrackShape(g, tr, this.mm, 13, 8);
    // hazards on the map: ice (cyan), sand (sand), rockslides (red), ramps (orange)
    const dot = (i, color) => { const x = this.mm.tx(tr.x[i]), y = this.mm.tz(tr.z[i]); g.beginPath(); g.arc(x, y, 5, 0, 6.28); g.fillStyle = '#160e2a'; g.fill(); g.beginPath(); g.arc(x, y, 3.4, 0, 6.28); g.fillStyle = color; g.fill(); };
    for (const p of tr.ice) dot((p.a + p.b) >> 1, '#8fe6ff');
    for (const p of tr.sand) dot((p.a + p.b) >> 1, '#e8c470');
    for (const s of tr.slides) dot(s.idx, '#ff5a3a');
    for (const r of tr.ramps) dot(r.a + 3, '#ff9a1e');
    this.mmStatic = c;
  },
  lastPlace: 0,
  update() {
    const p = game.player;
    if (!p) return;
    const tr = game.track, laps = TRACKS[game.trackIndex].laps;
    $('lapNum').textContent = clamp(p.lap, 1, laps);
    $('lapTot').textContent = '/' + laps;
    $('hud-time').textContent = fmtTime(game.raceTime);
    const n = p.place || 1;
    if (n !== this.lastPlace) {
      $('posNum').textContent = n;
      $('posSuf').textContent = ordinal(n).slice(String(n).length);
      const el = $('hud-pos');
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      this.lastPlace = n;
    }
    $('hud-pos').style.display = game.cars.length > 1 ? '' : 'none';
    const kmh = Math.max(0, Math.round(p.speed * 3.6));
    $('speedNum').textContent = kmh;
    const gl = Engine.gearLabel;
    if (gl !== this.lastGear) {
      const el = $('gearNum');
      el.textContent = gl;
      el.classList.remove('shift'); void el.offsetWidth; el.classList.add('shift');
      this.lastGear = gl;
    }
    drawTacho(Engine.rpm);
    $('hud-wrong').style.display = p.wrongTimer > 1 && !p.finished ? 'block' : 'none';
    // item slot
    let icon = p.item, name = p.item ? ITEM_INFO[p.item].label : '';
    if (p.itemRoll > 0) { icon = ITEM_KEYS[Math.floor(game.time * 14) % ITEM_KEYS.length]; name = ''; }
    if (icon !== this.lastIcon) { drawItemIcon($('itemIcon'), icon); this.lastIcon = icon; }
    $('itemName').textContent = name;
    // minimap
    const mm = $('minimap'), g = mm.getContext('2d');
    g.clearRect(0, 0, 240, 240);
    g.drawImage(this.mmStatic, 0, 0);
    for (const r of game.items.rockets) {
      g.fillStyle = '#ff3a3a';
      g.fillRect(this.mm.tx(r.x) - 2, this.mm.tz(r.z) - 2, 4, 4);
    }
    const order = game.cars.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const c of order) {
      const x = this.mm.tx(c.x), y = this.mm.tz(c.z), r = c.isPlayer ? 7 : 5;
      g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.fillStyle = '#160e2a'; g.fill();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = c.isPlayer ? PLAYER_COLOR : c.color; g.fill();
      if (c.isPlayer) {
        g.beginPath();
        g.moveTo(x + Math.cos(c.heading) * 12, y + Math.sin(c.heading) * 12);
        g.lineTo(x + Math.cos(c.heading + 2.5) * 7, y + Math.sin(c.heading + 2.5) * 7);
        g.lineTo(x + Math.cos(c.heading - 2.5) * 7, y + Math.sin(c.heading - 2.5) * 7);
        g.closePath(); g.fillStyle = '#fff'; g.fill();
      }
    }
    // lap times
    $('hud-laps').innerHTML = p.lapTimes.map((t, i) => 'L' + (i + 1) + ' ' + fmtTime(t)).join('<br>');
  }
};

// Tachometer: img/tacho.png (contagiri.png with its painted needle removed, see CLAUDE.md)
// plus a rotating needle. Geometry in image pixels (600x200): the scale is an ellipse,
// TACHO.ticks are the points of the values 0..8 (x1000 rpm) on it.
const TACHO = {
  img: Object.assign(new Image(), { src: 'img/tacho.png' }),
  pivot: [308.27, 147.43], hubR: 15.7,
  ticks: [[130.8, 158.51], [150.15, 118.09], [184.49, 82.42], [242.18, 52.46], [309.47, 41.92],
    [376.75, 52.46], [434.68, 82.6], [468.78, 118.09], [488.14, 158.51]],
  shown: 0
};
function drawTacho(rpm) {
  const cv = $('tacho'), g = cv.getContext('2d'), T = TACHO;
  // a light needle lag, like a real gauge
  T.shown += (rpm - T.shown) * 0.35;
  const v = clamp(T.shown / 1000, 0, 8.25);
  const i = Math.min(7, Math.floor(v)), f = v - i;
  const a = T.ticks[i], b = T.ticks[i + 1];
  const px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f;
  const [cx, cy] = T.pivot;
  const dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy) * 0.93;
  const ang = Math.atan2(dy, dx);
  g.clearRect(0, 0, cv.width, cv.height);
  if (T.img.complete && T.img.naturalWidth) g.drawImage(T.img, 0, 0, cv.width, cv.height);
  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  const r0 = T.hubR + 1;
  // glow
  g.shadowColor = 'rgba(255, 60, 20, 0.9)';
  g.shadowBlur = 14;
  g.beginPath();
  g.moveTo(r0, -4.2); g.lineTo(len, -1.3); g.lineTo(len + 1.5, 0); g.lineTo(len, 1.3); g.lineTo(r0, 4.2);
  g.closePath();
  g.fillStyle = '#ff2a12';
  g.fill();
  g.shadowBlur = 0;
  // hot core
  const gr = g.createLinearGradient(r0, 0, len, 0);
  gr.addColorStop(0, '#ffe25a'); gr.addColorStop(0.7, '#ffb21e'); gr.addColorStop(1, '#ff7a14');
  g.beginPath();
  g.moveTo(r0, -1.6); g.lineTo(len - 2, -0.5); g.lineTo(len - 2, 0.5); g.lineTo(r0, 1.6);
  g.closePath();
  g.fillStyle = gr;
  g.fill();
  g.restore();
}

function drawTrackShape(g, tr, mm, outer, inner) {
  g.lineJoin = g.lineCap = 'round';
  const path = () => {
    g.beginPath();
    for (let i = 0; i < tr.N; i += 3) { const x = mm.tx(tr.x[i]), y = mm.tz(tr.z[i]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.closePath();
  };
  path(); g.lineWidth = outer; g.strokeStyle = '#160e2a'; g.stroke();
  path(); g.lineWidth = inner; g.strokeStyle = '#f4f0ff'; g.stroke();
  // start line
  const i = 0, x = mm.tx(tr.x[i]), y = mm.tz(tr.z[i]);
  g.save(); g.translate(x, y); g.rotate(Math.atan2(tr.tz[i], tr.tx[i]));
  g.fillStyle = '#160e2a'; g.fillRect(-2.5, -outer / 2 - 1, 5, outer + 2);
  g.fillStyle = '#ff3a3a'; g.fillRect(-1.5, -outer / 2, 3, outer);
  g.restore();
}

function drawItemIcon(cv, icon) {
  const g = cv.getContext('2d'), W = cv.width;
  g.clearRect(0, 0, W, W);
  if (!icon) return;
  g.save();
  g.translate(W / 2, W / 2);
  g.lineJoin = 'round';
  g.lineWidth = 5; g.strokeStyle = '#160e2a';
  if (icon === 'turbo') {
    // flame
    g.beginPath();
    g.moveTo(0, -36); g.bezierCurveTo(22, -12, 28, 10, 18, 26); g.bezierCurveTo(10, 36, -10, 36, -18, 26);
    g.bezierCurveTo(-28, 10, -14, -4, -10, -18); g.bezierCurveTo(-4, -6, 0, -10, 0, -36); g.closePath();
    const gr = g.createLinearGradient(0, -36, 0, 34); gr.addColorStop(0, '#ffe14a'); gr.addColorStop(1, '#ff4a1a');
    g.fillStyle = gr; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(0, -4); g.bezierCurveTo(12, 8, 10, 22, 0, 26); g.bezierCurveTo(-10, 22, -10, 10, 0, -4); g.fillStyle = '#fff6b0'; g.fill();
  } else if (icon === 'rocket') {
    g.rotate(-Math.PI / 4);
    g.beginPath(); g.moveTo(34, 0); g.quadraticCurveTo(22, -12, 6, -11); g.lineTo(-22, -11); g.lineTo(-22, 11); g.lineTo(6, 11); g.quadraticCurveTo(22, 12, 34, 0); g.closePath();
    g.fillStyle = '#f4f4f4'; g.fill(); g.stroke();
    g.beginPath(); g.moveTo(34, 0); g.quadraticCurveTo(26, -9, 16, -10); g.lineTo(16, 10); g.quadraticCurveTo(26, 9, 34, 0); g.fillStyle = '#ff3a3a'; g.fill(); g.stroke();
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(-10, 11 * s); g.lineTo(-24, 24 * s); g.lineTo(-24, 11 * s); g.closePath(); g.fillStyle = '#ff3a3a'; g.fill(); g.stroke(); }
    g.beginPath(); g.moveTo(-22, -7); g.lineTo(-36, 0); g.lineTo(-22, 7); g.fillStyle = '#ffb43a'; g.fill();
  } else if (icon === 'oil') {
    g.beginPath(); g.moveTo(0, -36); g.bezierCurveTo(14, -14, 30, 4, 26, 18); g.bezierCurveTo(22, 34, -22, 34, -26, 18); g.bezierCurveTo(-30, 4, -14, -14, 0, -36); g.closePath();
    g.fillStyle = '#2a2040'; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(-9, 10, 5, 9, 0.4, 0, Math.PI * 2); g.fillStyle = '#9a7bff'; g.fill();
  } else if (icon === 'shield') {
    g.beginPath(); g.arc(0, 0, 32, 0, Math.PI * 2);
    const gr = g.createRadialGradient(-10, -12, 4, 0, 0, 32); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.4, '#8ff4ff'); gr.addColorStop(1, '#1f8bff');
    g.fillStyle = gr; g.fill(); g.stroke();
    g.beginPath(); g.ellipse(-11, -13, 9, 5, -0.6, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
  }
  g.restore();
}

// ---------------------------------------------------------------- camera

const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 68, mode: 0, modeT: 0, side: null, follow: null };
const _t = new THREE.Vector3(), _l = new THREE.Vector3();

function chaseCam(car, dt, snap) {
  const back = keys.KeyC || pad.look;
  const target = car.heading + (car.drift.on ? car.slide * 0.35 : 0) + (back ? Math.PI : 0);
  if (snap || back !== cam.wasBack) cam.yaw = target;
  cam.wasBack = back;
  cam.yaw += wrapAngle(target - cam.yaw) * damp(5, dt);
  const sp = clamp(car.speed / car.top, 0, 1.4);
  const dist = 7.2 + sp * 1.6, hgt = 2.6 + sp * 0.3;
  _t.set(car.x - Math.cos(cam.yaw) * dist, car.y + hgt, car.z - Math.sin(cam.yaw) * dist);
  const tr = game.track;
  const groundY = tr.y[car.idx];
  _t.y = Math.max(_t.y, groundY + 1.4);
  if (snap) cam.pos.copy(_t); else cam.pos.lerp(_t, damp(12, dt));
  _l.set(car.x + Math.cos(cam.yaw) * 5, car.y + 1.3 + car.hopY * 0.5, car.z + Math.sin(cam.yaw) * 5);
  if (snap) cam.look.copy(_l); else cam.look.lerp(_l, damp(20, dt));
  const fovT = 66 + sp * 12 + (car.boost > 0 ? 10 : 0);
  cam.fov += (fovT - cam.fov) * damp(3.2, dt);
  applyCam();
}
function orbitCam(car, dt, radius, height, speed) {
  const a = game.time * (speed || 0.25);
  _t.set(car.x + Math.cos(a) * radius, car.y + height, car.z + Math.sin(a) * radius);
  cam.pos.lerp(_t, damp(3, dt));
  _l.set(car.x, car.y + 1, car.z);
  cam.look.lerp(_l, damp(6, dt));
  cam.fov += (50 - cam.fov) * damp(3, dt);
  applyCam();
}
// TV style cameras for the attract mode
function cinemaCam(dt) {
  const cars = game.cars;
  if (!cars.length) return;
  cam.modeT -= dt;
  if (!cam.follow || cam.modeT <= 0) {
    cam.follow = cars[Math.floor(Math.random() * cars.length)];
    cam.mode = (cam.mode + 1) % 3;
    cam.modeT = 7;
    cam.side = null;
    cam.snap = true;   // hard cut to the new shot
    if (cam.mode === 0) { chaseCam(cam.follow, dt, true); cam.snap = false; }
  }
  const c = cam.follow, tr = game.track;
  if (cam.mode === 0) { chaseCam(c, dt); return; }
  if (cam.mode === 1) {
    if (!cam.side) {
      const i = (c.idx + 45) % tr.N, s = Math.random() < 0.5 ? -1 : 1, off = tr.hw + 6;
      cam.side = { x: tr.x[i] - tr.tz[i] * off * s, z: tr.z[i] + tr.tx[i] * off * s, y: tr.y[i] + 2.5 };
      cam.pos.set(cam.side.x, cam.side.y, cam.side.z);
      cam.look.set(c.x, c.y + 1, c.z);
    }
    let d = c.idx - ((trackNearest(tr, cam.side.x, cam.side.z, 80).idx) || 0);
    if (d < -tr.N / 2) d += tr.N;
    if (d > tr.N / 2) d -= tr.N;   // the car may still be before the line while the camera is past it
    if (d > 25) cam.side = null;
    _l.set(c.x, c.y + 1, c.z);
    cam.look.lerp(_l, damp(10, dt));
    cam.fov += (40 - cam.fov) * damp(3, dt);
    applyCam();
    return;
  }
  // low front camera looking back at the car
  const fx = Math.cos(c.heading), fz = Math.sin(c.heading);
  _t.set(c.x + fx * 9 - fz * 2.5, c.y + 1.0, c.z + fz * 9 + fx * 2.5);
  _l.set(c.x, c.y + 0.9, c.z);
  if (cam.snap) { cam.pos.copy(_t); cam.look.copy(_l); cam.snap = false; }
  cam.pos.lerp(_t, damp(8, dt));
  cam.look.lerp(_l, damp(12, dt));
  cam.fov += (55 - cam.fov) * damp(3, dt);
  applyCam();
}
function applyCam() {
  // in the menu the car is shown on the right, next to the panels
  const w = window.innerWidth, h = window.innerHeight;
  const shift = game.state === 'menu' && w > 900 ? -w * 0.36 : 0;
  if (shift !== cam.shift) {
    cam.shift = shift;
    if (shift) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset();
  }
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  // shake: trauma (0..1) from kerbs, bumps and explosions, amplitude = trauma^2; the rotation
  // is applied after lookAt so it is a real hand-held style tremor, not a position slide
  const sh = shake.value * shake.value;
  if (sh > 0.0004) {
    const t = game.time * 38;
    camera.rotation.x += (Math.sin(t * 1.3) + Math.sin(t * 2.7 + 1)) * 0.5 * 0.022 * sh;
    camera.rotation.y += (Math.sin(t * 1.7 + 2) + Math.sin(t * 3.1)) * 0.5 * 0.022 * sh;
    camera.rotation.z += Math.sin(t * 2.1 + 4) * 0.018 * sh;
  }
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
}
const shake = { value: 0 };
function addShake(a) { shake.value = Math.min(1, shake.value + a); }

// ---------------------------------------------------------------- races

function aiRoster(count, seed) {
  const rng = RNG(seed);
  const models = shuffle(CAR_MODELS.map((m, i) => i), rng);
  const drivers = shuffle(DRIVERS.slice(), rng);
  const out = [];
  for (let i = 0; i < count; i++) out.push({ model: models[i % models.length], driver: drivers[i] });
  return out;
}

function startAttract() {
  setTrack(0);
  const roster = aiRoster(8, Date.now() & 0xffff);
  spawnCars(roster.map((r, i) => ({ slot: i, model: r.model, driver: r.driver, skill: 0.9 + Math.random() * 0.08 })));
  if (game.items) game.items.dispose();
  if (game.hazards) game.hazards.dispose();
  game.items = new Items(game);
  game.hazards = new Hazards(game);
  game.cars.forEach(c => { c.speed = 0; });
  cam.follow = null; cam.modeT = 0;
}

function menuPreview() {
  const s = game.settings;
  const ti = s.mode === 1 ? 0 : s.track;
  if (game.trackIndex !== ti) setTrack(ti);
  if (!game.items) game.items = new Items(game);
  if (!game.hazards) game.hazards = new Hazards(game);
  spawnCars([{ slot: 0, model: playerModel(), driver: { name: 'You', color: PLAYER_COLOR }, player: true }]);
}

function startRace() {
  const s = game.settings;
  store.set('settings', s);
  const ti = s.mode === 1 ? game.gp.round : s.track;
  showLoading(true);
  setTimeout(() => {
    setTrack(ti);
    if (game.items) game.items.dispose();
    if (game.hazards) game.hazards.dispose();
    game.items = new Items(game);
    game.hazards = new Hazards(game);
    game.fx.clear();
    const cls = CLASSES[s.diff];
    const entries = [];
    if (s.mode === 2) {
      entries.push({ slot: 0, model: playerModel(), driver: { name: 'You', color: PLAYER_COLOR }, player: true });
    } else {
      const roster = s.mode === 1 ? game.gp.roster : aiRoster(7, Date.now() & 0xffff);
      let order;  // grid order: list of roster indices, -1 = player
      if (s.mode === 1 && game.gp.round > 0) {
        order = gpStandings().map(e => e.id);   // leader on pole
      } else {
        order = roster.map((r, i) => i).concat([-1]);
      }
      order.forEach((id, slot) => {
        if (id === -1) entries.push({ slot, model: playerModel(), driver: { name: 'You', color: PLAYER_COLOR }, player: true });
        else {
          const r = roster[id];
          entries.push({ slot, model: r.model, driver: r.driver, skill: lerp(cls.skill[0], cls.skill[1], Math.random()), rid: id });
        }
      });
    }
    spawnCars(entries);
    entries.forEach((e, i) => { game.cars[i].rid = e.player ? -1 : e.rid; });
    if (s.mode === 2) {
      // time trial: three turbos, no item boxes
      game.player.item = 'turbo';
      game.player.spareTurbos = 2;
      game.items.boxes.forEach(b => { b.mesh.visible = false; b.t = 1e9; });
    }
    game.raceTime = 0;
    game.finishCount = 0;
    game.firstThrottle = null;
    game.lastCount = 0;
    hud.lastPlace = 0; hud.lastIcon = undefined;
    showScreen(null);
    $('hud').classList.remove('hidden');
    hud.msg('');
    $('hud-count').style.display = 'none';
    showLoading(false);
    setState('intro');
    updatePlaces();
    Music.play(TRACKS[ti].music);
    Sfx.play('getready', 0.9);
  }, 30);
}

function gpStandings() {
  const gp = game.gp;
  const list = [{ id: -1, name: 'You', color: PLAYER_COLOR, model: playerModel(), pts: gp.points[-1] || 0 }];
  gp.roster.forEach((r, i) => list.push({ id: i, name: r.driver.name, color: r.driver.color, model: r.model, pts: gp.points[i] || 0 }));
  list.sort((a, b) => b.pts - a.pts || (a.id === -1 ? -1 : 1));
  return list;
}

function updatePlaces() {
  const sorted = game.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.dist - a.dist;
  });
  sorted.forEach((c, i) => { c.place = i + 1; });
}

function carCollisions() {
  const cs = game.cars;
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx * dx + dz * dz > 36 || Math.abs(a.y - b.y) > 3) continue;
    // two circles per car (front and rear)
    let best = null;
    const ax = Math.cos(a.heading), az = Math.sin(a.heading), bx = Math.cos(b.heading), bz = Math.sin(b.heading);
    for (const sa of [-1.05, 1.05]) for (const sb of [-1.05, 1.05]) {
      const px = (b.x + bx * sb) - (a.x + ax * sa), pz = (b.z + bz * sb) - (a.z + az * sa);
      const d = Math.hypot(px, pz);
      const pen = 2.1 - d;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: d > 1e-4 ? px / d : 1, nz: d > 1e-4 ? pz / d : 0 };
    }
    if (!best) continue;
    const { pen, nx, nz } = best;
    const wa = b.shield > 0 && a.shield <= 0 ? 0.9 : a.shield > 0 && b.shield <= 0 ? 0.1 : 0.5;
    a.x -= nx * pen * wa; a.z -= nz * pen * wa;
    b.x += nx * pen * (1 - wa); b.z += nz * pen * (1 - wa);
    const va = a.speed * (ax * nx + az * nz), vb = b.speed * (bx * nx + bz * nz);
    const closing = va - vb;
    if (closing > 0) {
      const k = closing * 0.55;
      a.ext.x -= nx * k * wa * 2; a.ext.z -= nz * k * wa * 2;
      b.ext.x += nx * k * (1 - wa) * 2; b.ext.z += nz * k * (1 - wa) * 2;
      if (ax * nx + az * nz > 0.5) a.speed -= closing * 0.35;
      if (-(bx * nx + bz * nz) > 0.5) b.speed -= closing * 0.35;
      if (a.shield > 0 && b.shield <= 0 && closing > 6) b.hit('bump');
      if (b.shield > 0 && a.shield <= 0 && closing > 6) a.hit('bump');
      if (closing > 8) game.fx.burst((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.8, (a.z + b.z) / 2, 0xffe08a, 10, 7);
      if ((a.isPlayer || b.isPlayer) && closing > 5) addShake(clamp(closing / 40, 0.12, 0.5));
      if (a.drift.on && closing > 10) a.drift.on = false;
      if (b.drift.on && closing > 10) b.drift.on = false;
    }
  }
}

function simulateCars(dt, racing, attract) {
  const tr = game.track, N = tr.N, laps = TRACKS[game.trackIndex].laps;
  for (const c of game.cars) {
    if (c.isPlayer && !c.finished && !attract) readPlayerInput(c);
    else updateAI(c, dt, game);
    if (racing && c.input.item && c.item) {
      game.items.use(c);
      if (c.spareTurbos > 0 && !c.item) { c.spareTurbos--; c.item = 'turbo'; }
    }
    if (c.isPlayer && !attract && keys.KeyR && racing && !c.finished) { keys.KeyR = false; c.respawn(); }
    c.update(dt, racing);
  }
  carCollisions();
  game.items.update(dt);
  if (game.hazards) game.hazards.update(dt);
  for (const c of game.cars) c.syncMesh(dt);
  if (!racing) return;
  // laps and finish
  for (const c of game.cars) {
    if (c.finished) continue;
    const done = Math.floor(c.dist / N);
    if (done > c.maxLap && c.dist >= 0) {
      for (let k = c.maxLap; k < done; k++) {
        c.lapTimes.push(game.raceTime - c.lapStart);
        c.lapStart = game.raceTime;
      }
      c.maxLap = done;
      if (c.maxLap >= laps && !attract) {
        c.finished = true;
        c.finishTime = game.raceTime;
        game.finishCount++;
        if (c.isPlayer) onPlayerFinish();
      } else if (c.isPlayer && !attract) {
        const best = Math.min(...c.lapTimes);
        // lap 2 / lap 3 graphics (img/lap2.png, lap3.png); text for other lap counts
        const n = c.maxLap + 1;
        if (built) built.crowdBurst(0.7, 0.3);   // a lap done: the stands cheer
        if (n === 2 || n === 3) { hud.banner('lap' + n, 1500); Sfx.play('lap' + n, 0.9); }
        else if (c.maxLap === laps - 1) { hud.msg('FINAL LAP!', '#ff6a1a'); setTimeout(() => hud.msg(''), 1600); }
        else { hud.msg('LAP ' + n); setTimeout(() => hud.msg(''), 1200); }
        if (c.lapTimes[c.lapTimes.length - 1] === best && c.lapTimes.length > 1) hud.flashPic('bestlap');
      }
    }
  }
  if (attract) {
    // keep the attract race going forever
    for (const c of game.cars) if (c.maxLap > 50) c.maxLap = 0;
  }
  updatePlaces();
}

function onPlayerFinish() {
  const p = game.player;
  // 1st! / 2nd! / 3rd! graphics (img/place1-3.png); text for the other places and the time trial
  if (game.settings.mode !== 2 && p.place <= 3) hud.count('place' + p.place);
  else hud.msg(game.settings.mode === 2 ? 'FINISH!' : ordinal(p.place) + '!', '#fff');
  saveBest(p);
  Sfx.play('finish', 0.95);
  if (built) built.crowdBurst(1, 0.1);   // and again at the finish
  setState('finish');
}

function saveBest(p) {
  const all = store.get('best', {});
  const k = 't' + game.trackIndex;
  const b = all[k] || {};
  const lap = Math.min(...p.lapTimes);
  if (!b.lap || lap < b.lap) b.lap = lap;
  if (!b.race || p.finishTime < b.race) b.race = p.finishTime;
  all[k] = b;
  store.set('best', all);
}

function showResults() {
  const s = game.settings, tr = game.track, N = tr.N, laps = TRACKS[game.trackIndex].laps;
  // estimate times for cars still racing
  for (const c of game.cars) {
    if (!c.finished) {
      const left = (laps * N - c.dist) * SPACING;
      c.finishTime = game.raceTime + left / (c.top * 0.85);
      c.finished = true;
    }
  }
  const sorted = game.cars.slice().sort((a, b) => a.finishTime - b.finishTime);
  const t = $('resTable');
  let html = '<tr><th>POS</th><th>DRIVER</th><th>TIME</th>' + (s.mode === 1 ? '<th style="text-align:right">PTS</th>' : '<th></th>') + '</tr>';
  sorted.forEach((c, i) => {
    let pts = '';
    if (s.mode === 1) {
      const gain = GP_POINTS[i] || 0;
      game.gp.points[c.rid] = (game.gp.points[c.rid] || 0) + gain;
      pts = '+' + gain;
    }
    const tm = s.mode === 2 ? 'Best lap ' + fmtTime(Math.min(...c.lapTimes)) : (i === 0 ? fmtTime(c.finishTime) : '+' + (c.finishTime - sorted[0].finishTime).toFixed(2));
    html += `<tr class="${c.isPlayer ? 'me' : ''}"><td>${ordinal(i + 1)}</td><td><span class="dot" style="background:${c.isPlayer ? PLAYER_COLOR : c.color}"></span>${c.name} <span class="sub">${carLabel(c.model, c.isPlayer)}</span></td><td>${s.mode === 2 ? fmtTime(c.finishTime) : tm}</td><td>${s.mode === 2 ? tm : pts}</td></tr>`;
  });
  t.innerHTML = html;
  $('resTitle').textContent = s.mode === 1 ? TRACKS[game.trackIndex].name.toUpperCase() + ' (' + (game.gp.round + 1) + '/3)' : 'RESULTS';
  $('resHelp').textContent = s.mode === 1 ? 'Enter: standings' : 'Enter: menu  ·  R: race again';
  game.resultsStep = 'race';
  Music.fadeOut();
  hud.msg('');
  hud.count(null);
  $('hud').classList.add('hidden');
  showScreen('results');
  setState('results');
}

function showStandings() {
  const st = gpStandings();
  const last = game.gp.round >= TRACKS.length - 1;
  let html = '<tr><th>POS</th><th>DRIVER</th><th></th><th style="text-align:right">POINTS</th></tr>';
  st.forEach((e, i) => {
    html += `<tr class="${e.id === -1 ? 'me' : ''}"><td>${ordinal(i + 1)}</td><td><span class="dot" style="background:${e.color}"></span>${e.name}</td><td class="sub">${carLabel(e.model, e.id === -1)}</td><td>${e.pts}</td></tr>`;
  });
  $('resTable').innerHTML = html;
  if (last) {
    const me = st.findIndex(e => e.id === -1) + 1;
    $('resTitle').textContent = me === 1 ? 'CHAMPION!' : 'GRAND PRIX: ' + ordinal(me).toUpperCase();
    $('resHelp').textContent = 'Enter: menu';
  } else {
    $('resTitle').textContent = 'STANDINGS';
    $('resHelp').textContent = 'Enter: next race (' + TRACKS[game.gp.round + 1].name + ')';
  }
  game.resultsStep = last ? 'gpdone' : 'standings';
}

// ---------------------------------------------------------------- screens and menu

function showScreen(id) {
  for (const s of ['title', 'menu', 'pause', 'results']) $(s).classList.toggle('hidden', s !== id);
}
function showLoading(on) { $('loading').classList.toggle('hidden', !on); }
function setState(s) { game.state = s; game.stateT = 0; }
function setPaused(on) {
  if (on && racingState()) {
    game.pausedFrom = game.state;
    game.pausedT = game.stateT;   // keep the countdown / intro / finish timers
    setState('paused');
    buildList('pauseList', ['Resume', 'Restart race', 'Quit to menu'], 0);
    showScreen('pause');
    Sfx.suspend();
    Music.pause();
    UiSfx.pause();
  } else if (!on && game.state === 'paused') {
    showScreen(null);
    game.state = game.pausedFrom;
    game.stateT = game.pausedT;
    Sfx.resume();
    Music.resume();
    UiSfx.resume();
  }
}

const TITLE_MUSIC = 'muzik/titles.mp3';   // tune of the title demo and of the menu

// Applies game.settings.gfx: resolution, post-processing chain, car lacquer, and rebuilds the
// current track (shadow map, terrain, props and grass depend on the preset). `then` runs after,
// to respawn whatever was on the track.
function changeQuality(then) {
  Q = QUALITY[game.settings.gfx] || QUALITY[0];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio) * Q.scale);
  post = buildPost();
  resize();
  applyGrade();
  for (const m of [CarAssets.material, CarAssets.redMaterial]) if (m) { m.clearcoat = Q.clearcoat ? 1 : 0; m.needsUpdate = true; }
  const ti = game.trackIndex;
  if (ti >= 0) { game.trackIndex = -1; setTrack(ti); }
  if (then) then();
}
function showToast(text, ms) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => el.classList.remove('show'), ms || 6000);
}
// First run (no saved choice): the median frame time on the title screen decides the preset.
const autoGfx = { frames: 0, times: [] };
function autoDetectGfx(ms) {
  if (document.hidden) return;
  if (++autoGfx.frames < 90) return;             // let the shaders compile and the caches warm up
  if (ms < 200) autoGfx.times.push(ms);           // ignore hiccups (tab switches)
  if (autoGfx.times.length < 150) return;
  game.autoGfx = false;
  const t = autoGfx.times.sort((a, b) => a - b), med = t[t.length >> 1];
  if (med > 25) {                                 // below ~40 fps: this PC needs the Low preset
    game.settings.gfx = 1;
    store.set('settings', game.settings);
    showToast('Graphics set to Low for this PC. You can change it in the menu (GRAPHICS).');
    showLoading(true);
    setTimeout(() => { changeQuality(() => startAttract()); showLoading(false); }, 30);
  } else store.set('settings', game.settings);    // remember that High was chosen
}

const menu = { sel: 0 };
const MENU_ROWS = [
  { id: 'mode', label: 'MODE', values: () => MODES },
  { id: 'track', label: 'TRACK', values: () => TRACKS.map(t => t.name), off: () => game.settings.mode === 1 },
  { id: 'car', label: 'CAR', values: () => CAR_TYPES.map(t => t.name) },
  { id: 'diff', label: 'CLASS', values: () => CLASSES.map(c => c.name), off: () => game.settings.mode === 2 },
  { id: 'gfx', label: 'GRAPHICS', values: () => ['High (modern PC)', 'Low (older PC)'] },
  { id: 'go', label: 'START RACE' }
];
function renderMenu() {
  const s = game.settings;
  const el = $('menuRows');
  // the rows are created once and then updated in place, so the pulse of the selected row
  // and the mouse highlight are not interrupted by a rebuild
  if (el.children.length !== MENU_ROWS.length) {
    el.innerHTML = '';
    MENU_ROWS.forEach((r, i) => {
      const d = document.createElement('div');
      d.innerHTML = r.id === 'go' ? '<span></span>'
        : `<span class="lbl">${r.label}</span><span class="arr" data-d="-1">&#9664;</span><span class="val"></span><span class="arr" data-d="1">&#9654;</span>`;
      d.addEventListener('mouseenter', () => { if (!d.classList.contains('disabled')) UiSfx.hover(); });
      d.addEventListener('click', ev => {
        const dd = ev.target.dataset && ev.target.dataset.d;
        if (r.id === 'go') { menu.sel = i; menuAction('Enter'); }
        else if (r.off && r.off()) return;
        else if (dd) { menu.sel = i; menuChange(+dd); UiSfx.change(+dd); }
        else if (menu.sel !== i) { menu.sel = i; UiSfx.move(); }
        else { menuChange(1); UiSfx.change(1); }
        renderMenu();
      });
      el.appendChild(d);
    });
  }
  MENU_ROWS.forEach((r, i) => {
    const d = el.children[i];
    d.className = 'row' + (i === menu.sel ? ' sel' : '') + (r.off && r.off() ? ' disabled' : '') + (r.id === 'go' ? ' go' : '');
    if (r.id === 'go') d.firstChild.textContent = s.mode === 1 ? 'START GRAND PRIX' : 'START RACE';
    else d.querySelector('.val').textContent = r.off && r.off() ? (r.id === 'track' ? 'All 3 tracks' : '-') : r.values()[s[r.id]];
  });
  // info cards
  const ti = s.mode === 1 ? 0 : s.track;
  const T = TRACKS[ti];
  $('trackName').textContent = s.mode === 1 ? 'Grand Prix' : T.name;
  $('trackBlurb').textContent = s.mode === 1 ? 'Race all three tracks in a row: ' + TRACKS.map(t => t.name).join(', ') + '. Points decide the champion.' : T.blurb;
  const best = store.get('best', {})['t' + ti];
  $('trackBest').textContent = s.mode !== 1 && best ? 'Best lap ' + fmtTime(best.lap) + '  ·  Best race ' + fmtTime(best.race) : '';
  const pc = $('trackPreview'), g = pc.getContext('2d');
  g.clearRect(0, 0, pc.width, pc.height);
  const tr = trackData(ti), b = tr.bounds;
  const sc = Math.min((pc.width - 30) / (b.maxX - b.minX), (pc.height - 30) / (b.maxZ - b.minZ));
  const ox = (pc.width - (b.maxX - b.minX) * sc) / 2, oz = (pc.height - (b.maxZ - b.minZ) * sc) / 2;
  drawTrackShape(g, tr, { tx: x => ox + (x - b.minX) * sc, tz: z => oz + (z - b.minZ) * sc }, 14, 8);
  const ct = CAR_TYPES[s.car];
  $('carName').textContent = ct.name;
  $('carBlurb').textContent = ct.blurb;
  $('statSpeed').style.width = (ct.speed * 100) + '%';
  $('statAccel').style.width = (ct.accel * 100) + '%';
  $('statHand').style.width = (ct.handling * 100) + '%';
}
// true when the selected row has a value that can change
function menuCanChange() {
  const r = MENU_ROWS[menu.sel];
  return r.id !== 'go' && !(r.off && r.off());
}
function menuChange(d) {
  const r = MENU_ROWS[menu.sel], s = game.settings;
  if (r.id === 'go' || (r.off && r.off())) return;
  const n = r.values().length;
  s[r.id] = (s[r.id] + d + n) % n;
  store.set('settings', s);
  if (r.id === 'gfx') {
    showLoading(true);
    setTimeout(() => { changeQuality(() => menuPreview()); showLoading(false); }, 30);
    return;
  }
  if (r.id === 'track' || r.id === 'mode') {
    const ti = s.mode === 1 ? 0 : s.track;
    if (ti !== game.trackIndex) {
      showLoading(true);
      setTimeout(() => { menuPreview(); showLoading(false); }, 30);
      return;
    }
  }
  if (r.id === 'car') menuPreview();
}
function menuAction(k) {
  if (k === 'Enter') {
    if (MENU_ROWS[menu.sel].id !== 'go') { menu.sel = MENU_ROWS.length - 1; renderMenu(); UiSfx.move(); return; }
    UiSfx.start();
    if (game.settings.mode === 1) {
      game.gp = { round: 0, points: {}, roster: aiRoster(7, Date.now() & 0xffff) };
    } else game.gp = null;
    startRace();
  }
}
function openMenu() {
  Music.play(TITLE_MUSIC);
  showScreen('menu');
  $('hud').classList.add('hidden');
  setState('menu');
  showLoading(true);
  setTimeout(() => { menuPreview(); renderMenu(); showLoading(false); }, 30);
}

function buildList(id, items, sel) {
  const el = $(id);
  el.innerHTML = '';
  items.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'row' + (i === sel ? ' sel' : '');
    d.innerHTML = '<span>' + t + '</span>';
    d.addEventListener('mouseenter', () => UiSfx.hover());
    d.addEventListener('click', () => { game.listSel = i; if (i !== 0) UiSfx.confirm(); listAction(i); });
    el.appendChild(d);
  });
  game.listSel = sel;
}
function listAction(i) {
  if (game.state !== 'paused') return;
  if (i === 0) setPaused(false);
  else if (i === 1) { Sfx.stopAll(); Music.stop(); showScreen(null); startRace(); }
  else { Sfx.stopAll(); Music.stop(); game.gp = null; game.items && game.items.dispose(); game.items = null; game.hazards && game.hazards.dispose(); game.hazards = null; openMenu(); }
}

function onKey(code) {
  const st = game.state;
  if (code === 'KeyM') { hud.flash(Music.toggle() ? 'MUSIC ON' : 'MUSIC OFF', '#fff'); return; }
  if (st === 'title') {
    if (code === 'Enter' || code === 'Space') { UiSfx.confirm(); openMenu(); }
    return;
  }
  if (st === 'menu') {
    if (code === 'ArrowUp' || code === 'KeyW') { do { menu.sel = (menu.sel + MENU_ROWS.length - 1) % MENU_ROWS.length; } while (MENU_ROWS[menu.sel].off && MENU_ROWS[menu.sel].off()); renderMenu(); UiSfx.move(); }
    else if (code === 'ArrowDown' || code === 'KeyS') { do { menu.sel = (menu.sel + 1) % MENU_ROWS.length; } while (MENU_ROWS[menu.sel].off && MENU_ROWS[menu.sel].off()); renderMenu(); UiSfx.move(); }
    else if (code === 'ArrowLeft' || code === 'KeyA') { if (menuCanChange()) UiSfx.change(-1); menuChange(-1); renderMenu(); }
    else if (code === 'ArrowRight' || code === 'KeyD') { if (menuCanChange()) UiSfx.change(1); menuChange(1); renderMenu(); }
    else if (code === 'Enter') menuAction('Enter');
    else if (code === 'Escape') { UiSfx.back(); Music.play(TITLE_MUSIC); showScreen('title'); setState('title'); showLoading(true); setTimeout(() => { startAttract(); showLoading(false); }, 30); }
    return;
  }
  if (st === 'paused') {
    if (code === 'Escape' || code === 'KeyP') setPaused(false);     // (setPaused plays the resume sound)
    else if (code === 'ArrowUp' || code === 'ArrowDown') {
      UiSfx.move();
      game.listSel = (game.listSel + (code === 'ArrowUp' ? 2 : 1)) % 3;
      buildList('pauseList', ['Resume', 'Restart race', 'Quit to menu'], game.listSel);
    } else if (code === 'Enter') { if (game.listSel !== 0) UiSfx.confirm(); listAction(game.listSel); }
    return;
  }
  if (st === 'results') {
    if (code === 'Enter' || code === 'KeyR') UiSfx.confirm();
    if (code === 'Enter') {
      if (game.resultsStep === 'race' && game.settings.mode === 1) showStandings();
      else if (game.resultsStep === 'standings') { game.gp.round++; startRace(); }
      else { game.gp = null; openMenu(); }
    } else if (code === 'KeyR' && game.settings.mode !== 1) startRace();
    return;
  }
  if (racingState()) {
    if (code === 'Escape' || code === 'KeyP') setPaused(true);
    else if (code === 'Enter' && st === 'intro') { setState('countdown'); Sfx.fadeOut('getready', 0.25); }
    else if (code === 'Enter' && st === 'finish' && game.stateT > 1) showResults();
  }
}

// Speed sensation: radial blur (grows with speed, more with the boost), vignette, speed
// lines and heat haze with the turbo, camera shake from the kerbs. Only while racing.
function updateSpeedFx(dt) {
  const u = post.final.uniforms, p = game.player;
  const racing = p && (game.state === 'race' || game.state === 'finish');
  let blurT = 0, hazeT = 0, linesT = 0;
  if (racing && p.speed > 0) {
    const v = clamp(p.speed / p.top, 0, 1.4);
    blurT = Math.max(0, v - 0.75) * 0.05 + (p.boost > 0 ? 0.03 : 0);
    linesT = p.boost > 0 ? 0.8 : smooth(0.95, 1.2, v) * 0.4;
    hazeT = p.boost > 0 ? 0.9 : 0;
    if (!Q.speedFx) { blurT = 0; hazeT = 0; }   // Low: no radial blur / heat haze
    // rumble strips and driving through the grass
    if (Math.abs(p.lat) > game.track.hw - 0.6 && Math.abs(p.lat) < game.track.hw + 1.7 && game.track.kerb[p.idx] && p.speed > 8) addShake(dt * 2.2);
    else if (p.offroad && p.speed > 10) addShake(dt * 1.6);
  }
  // air streaks past the car: thin additive lines in the wind, more with the boost
  if (racing && p.speed > p.top * 0.6 && Math.random() < dt * (30 + (p.boost > 0 ? 60 : 0))) {
    const fx = Math.cos(p.heading), fz = Math.sin(p.heading), side = Math.random() < 0.5 ? -1 : 1;
    const lat = (2.2 + Math.random() * 4) * side, ahead = 6 + Math.random() * 14;
    game.fx.streak(p.x + fx * ahead - fz * lat, p.y + 0.5 + Math.random() * 2.5, p.z + fz * ahead + fx * lat, -fx * p.speed * 0.9, -fz * p.speed * 0.9);
  }
  u.blur.value += (blurT - u.blur.value) * damp(5, dt);
  u.haze.value += (hazeT - u.haze.value) * damp(6, dt);
  u.speedLines.value += (linesT - u.speedLines.value) * damp(6, dt);
  shake.value = Math.max(0, shake.value - dt * 1.7);
  if (!racing) shake.value = Math.min(shake.value, 0.4);
}

// How enclosed the place of the player is: the reverb of the canyon (the barriers close in, rock arches
// overhead) and of the ice tunnel (the roofed part, a little before and after the portals).
function updateSpace() {
  const p = game.player, tr = game.track;
  let canyon = 0, tunnel = 0;
  if (p && tr && ['intro', 'countdown', 'race', 'finish'].includes(game.state)) {
    const i = p.idx;
    if (tr.canyon && i >= tr.canyon.a - 2 && i <= tr.canyon.b + 2) canyon = smooth(0, 0.7, (BARRIER - tr.barrier[i]) / (BARRIER - 4.6));
    for (const a of tr.arches || []) canyon = Math.max(canyon, 0.55 * smooth(16, 3, Math.abs(i - a)));
    if (tr.tunnel) {
      const s0 = tr.tunnel.a + tr.tunnel.ramp, s1 = tr.tunnel.b - tr.tunnel.ramp;
      tunnel = smooth(s0 - 12, s0 + 2, i) * smooth(s1 + 12, s1 - 2, i);
    }
  }
  Engine.setSpace(canyon, tunnel);
}

// Player engine: on from the intro to the end of the race, silent in menus and pause
function updateEngineSound(dt) {
  const st = game.state, p = game.player;
  const on = !!p && ['intro', 'countdown', 'race', 'finish'].includes(st);
  if (!on) { Engine.set(dt, 0, false, false); return; }
  const grid = st === 'intro' || st === 'countdown';
  const thr = grid ? !!(keys.ArrowUp || keys.KeyW || pad.throttle > 0.3) : !!p.input.throttle;
  let pct = Math.abs(p.speed) / p.top;
  if (p.drift.on) pct += 0.07;                      // wheels spinning in the slide
  if (p.hopY > 0.15 && thr) pct += 0.05;            // unloaded in the air
  Engine.set(dt, pct, thr && p.spin <= 0, true, grid, p.type.rev);
  exhaustSmoke(p, dt, thr && p.spin <= 0, grid);
}

// Exhaust smoke of the player's car: thick when the revs climb fast (blipping on the grid,
// launch, downshift blips), some when pulling hard in the low gears, a dark puff at every
// upshift, a light wisp at idle
function exhaustSmoke(p, dt, thr, grid) {
  if (dt <= 0) return;
  const rpm = Engine.rpm;
  const rate = (rpm - (game.lastRpm === undefined ? rpm : game.lastRpm)) / dt;
  game.lastRpm = rpm;
  let k = 0.035, dark = 0.2;
  if (thr) {
    k = Math.max(k, clamp(rate / 5000, 0, 1));
    const low = p.top * 0.35;
    if (!grid && p.speed < low) k = Math.max(k, 0.15 + 0.45 * (1 - Math.max(0, p.speed) / low));
    dark = 0.3 + 0.5 * k;
  }
  const gear = Engine.gear;
  if (!grid && gear > (game.lastGear || 1)) game.puffT = 0.15;
  game.puffT = Math.max(0, (game.puffT || 0) - dt);
  if (game.puffT > 0) { k = Math.max(k, 0.9); dark = 0.75; }
  game.lastGear = grid ? 1 : gear;
  p.emitExhaust(k, dark, dt);
}

// ---------------------------------------------------------------- main loop

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  try { frameBody(now); }
  catch (e) {
    // a bug in the game logic must not freeze the picture: log it once per message and keep drawing
    if (frame.lastErr !== e.message) { frame.lastErr = e.message; console.error('Frame error:', e); }
    try { post.composer.render(0); } catch (e2) { }
  }
}
function frameBody(now) {
  if (game.autoGfx && game.state === 'title') autoDetectGfx(now - last);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollPad();
  if (game.state === 'boot' || !game.track) { return; }
  if (game.state !== 'paused') game.time += dt;
  else Sfx.pauseLoops();   // looping sounds restart from syncMesh on resume
  game.stateT += dt;
  const st = game.state;
  const p = game.player;

  if (st === 'title') {
    // attract mode: AI cars race behind the logo
    simulateCars(dt, true, true);
    cinemaCam(dt);
  } else if (st === 'menu') {
    // (right after "Quit to menu" the items are gone until menuPreview rebuilds them)
    if (p && game.items) { p.input.throttle = 0; simulateCars(dt, false, true); orbitCam(p, dt, 11, 3.2, 0.3); }
  } else if (st === 'intro') {
    // sweeping camera from the front of the grid down behind the player
    simulateCars(dt, false);
    const tr = game.track, k = smooth(0, 3.5, game.stateT);
    const a = Math.atan2(tr.tz[0], tr.tx[0]);
    const from = _t.set(tr.x[0] + Math.cos(a) * 30 + Math.sin(a) * 25, tr.y[0] + 26, tr.z[0] + Math.sin(a) * 30 - Math.cos(a) * 25);
    const to = new THREE.Vector3(p.x - Math.cos(p.heading) * 7.2, p.y + 2.6, p.z - Math.sin(p.heading) * 7.2);
    cam.pos.copy(from).lerp(to, k);
    _l.set(lerp(tr.x[0], p.x + Math.cos(p.heading) * 5, k), p.y + 1.3, lerp(tr.z[0], p.z + Math.sin(p.heading) * 5, k));
    cam.look.copy(_l);
    cam.fov = lerp(50, 66, k);
    cam.yaw = p.heading;
    applyCam();
    $('hud-skip').style.display = 'block';
    if (game.stateT > 3.6) setState('countdown');
  } else if (st === 'countdown') {
    $('hud-skip').style.display = 'none';
    simulateCars(dt, false);
    chaseCam(p, dt, game.stateT < dt * 1.5);
    const left = 3 - game.stateT;
    const shown = Math.ceil(left);
    if (shown !== game.lastCount && shown > 0) {
      hud.count('count' + shown);
      if (shown === 3) Sfx.play('countdown', 0.9);   // the sample says "three, two, one" one second apart
      game.lastCount = shown;
    }
    // rocket start: press throttle right as the "1" shows
    const thr = keys.ArrowUp || keys.KeyW || pad.throttle > 0.3;
    if (thr && game.firstThrottle === null) game.firstThrottle = left;
    if (left <= 0) {
      setState('race');
      game.lastCount = 0;
      hud.count('countgo');
      Sfx.play('go', 0.95);
      if (built) built.crowdBurst(1, 0.22);   // the crowd cheers at GO
      setTimeout(() => hud.count(null), 900);
      if (game.firstThrottle !== null && thr) {
        if (game.firstThrottle > 0.2 && game.firstThrottle < 1.1) { p.boost = 1.2; hud.flash('ROCKET START!', '#ffb43a'); }
        else if (game.firstThrottle > 2.2) { p.slowStart = SLOW_START; hud.flash('SLOW START', '#ff9a3c'); }   // too early: slower acceleration
      }
      for (const c of game.cars) if (!c.isPlayer && Math.random() < 0.35) c.boost = 0.8;
    }
  } else if (st === 'race' || st === 'finish') {
    game.raceTime += st === 'race' ? dt : 0;
    if (st === 'finish') {
      // keep the clock for the AI still racing
      game.raceTime += dt;
    }
    simulateCars(dt, true);
    if (st === 'race') chaseCam(p, dt);
    else orbitCam(p, dt, 10, 3.2, 0.35);
    if (st === 'finish' && (game.finishCount >= game.cars.length || game.stateT > 9)) showResults();
  } else if (st === 'results') {
    simulateCars(dt, true);
    orbitCam(p, dt, 11, 3.5, 0.2);
  }

  if (racingState() || st === 'paused') hud.update();
  // keep the shadow camera around the action
  if (built) {
    const f = cam.look;
    built.sun.position.set(f.x + built.sunDir.x * 160, f.y + built.sunDir.y * 160, f.z + built.sunDir.z * 160);
    built.sun.target.position.copy(f);
    built.update(dt, game.time, camera);
  }
  game.fx.update(st === 'paused' ? 0 : dt, camera, renderer.domElement.height);
  game.skids.update();
  updateEngineSound(dt);
  updateSpace();
  // rockets in flight: Doppler whine (silent in menus and while paused)
  RocketSound.update(game.items ? game.items.rockets : [], camera, dt, st !== 'paused' && !!game.items && st !== 'menu' && st !== 'title' && st !== 'results');
  Music.update(dt);
  post.final.uniforms.time.value = game.time % 100;
  updateSpeedFx(dt);
  post.composer.render(dt);
}

// ---------------------------------------------------------------- boot

game.hud = hud;
showLoading(true);
loadCarAssets(() => {
  startAttract();
  showLoading(false);
  showScreen('title');
  setState('title');
  Music.play(TITLE_MUSIC);
});
$('title').addEventListener('click', () => { if (game.state === 'title') openMenu(); });
requestAnimationFrame(frame);
