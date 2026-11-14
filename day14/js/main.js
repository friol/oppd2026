'use strict';
// Boot, screens, input handling and the main loop.
(() => {
  const $ = (id) => document.getElementById(id);
  const view = $('view'), overlay = $('overlay'), og = overlay.getContext('2d');
  const RES = [{ name: 'Retro', h: 200 }, { name: 'Classic', h: 270 }, { name: 'Sharp', h: 400 }, { name: 'HD', h: 720 }];

  const FX = ['Off', 'Light', 'Full'];
  const settings = { diff: 1, res: 1, sens: 5, sound: true, fx: 2 };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('wolfenstain') || '{}')); } catch (e) { /* storage unavailable */ }
  Sound.setEnabled(settings.sound);
  // Browsers only allow audio after a user gesture.
  for (const ev of ['pointerdown', 'keydown', 'click']) window.addEventListener(ev, () => Sound.unlock(), true);
  const save = () => { try { localStorage.setItem('wolfenstain', JSON.stringify(settings)); } catch (e) { /* ignore */ } };

  let state = 'loading';
  const keys = new Set();
  let mouseX = 0, mouseY = 0, wheel = 0, firing = false, usePressed = false, jumpPressed = false, weaponKey = -1;
  let showMap = false;

  // ---------- Screens ----------
  const screens = ['title', 'help', 'pause', 'inter', 'dead', 'win'];
  function show(name) {
    for (const s of screens) $(s).hidden = s !== name;
    const first = name && $(name).querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function setState(s) {
    state = s;
    show(['title', 'help', 'pause', 'inter', 'dead', 'win'].includes(s) ? s : null);
    $('hud').style.visibility = s === 'title' || s === 'help' ? 'hidden' : 'visible';
    if (s !== 'play' && document.pointerLockElement) document.exitPointerLock();
    // Depth-of-field feel: the frozen scene behind in-game menus goes out of focus.
    document.body.classList.toggle('menu-blur', ['pause', 'inter', 'dead', 'win'].includes(s));
  }
  function refreshLabels() {
    $('diffv').textContent = Game.DIFFICULTY[settings.diff].name;
    for (const el of [$('resv'), ...document.querySelectorAll('.resv')]) el.textContent = RES[settings.res].name;
    $('sensv').textContent = settings.sens;
    for (const el of document.querySelectorAll('.sndv')) el.textContent = settings.sound ? 'On' : 'Off';
    for (const el of document.querySelectorAll('.fxv')) el.textContent = FX[settings.fx];
  }

  function lock() {
    try {
      const r = view.requestPointerLock();
      if (r && r.catch) r.catch(() => {});
    } catch (e) { /* not available */ }
  }

  function startPlay() {
    setState('play');
    keys.clear(); firing = false;
    lock();
  }

  function levelCard() {
    const st = Game.state;
    const card = $('levelcard');
    card.querySelector('small').textContent = `LEVEL ${st.levelIndex + 1}`;
    card.querySelector('strong').textContent = st.level.name;
    card.classList.add('show');
    clearTimeout(levelCard.t);
    levelCard.t = setTimeout(() => card.classList.remove('show'), 2600);
  }

  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '100%';

  const actions = {
    start() { Game.newGame(settings.diff); levelCard(); startPlay(); },
    diff() { settings.diff = (settings.diff + 1) % Game.DIFFICULTY.length; save(); refreshLabels(); },
    res() { settings.res = (settings.res + 1) % RES.length; save(); refreshLabels(); resize(); },
    sens() { settings.sens = settings.sens % 10 + 1; save(); refreshLabels(); },
    fx() { settings.fx = (settings.fx + 2) % FX.length; save(); refreshLabels(); },
    sound() { settings.sound = !settings.sound; Sound.setEnabled(settings.sound); save(); refreshLabels(); },
    help() { setState('help'); },
    back() { setState('title'); },
    resume() { startPlay(); },
    restart() { Game.restartLevel(); levelCard(); startPlay(); },
    quit() { setState('title'); },
    continue() {
      if (Game.nextLevel()) { levelCard(); startPlay(); } else setState('title');
    },
  };
  // GUI feedback: a button click when the highlighted item changes and a magic
  // chime on click (pitched down for going back / quitting).
  const LOW_ACTS = new Set(['back', 'quit']);
  let hovered = null;
  function uiMove(b) {
    if (b === hovered) return;
    hovered = b;
    Sound.play('uiMove');
  }
  document.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.screen button');
    if (b) uiMove(b); else if (!e.target.closest('.screen .box, .menu')) hovered = null;
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b || !actions[b.dataset.act]) return;
    actions[b.dataset.act]();
    Sound.play('uiClick', { rate: LOW_ACTS.has(b.dataset.act) ? 0.85 : 1 });
    hovered = document.activeElement;
  });

  // ---------- Game events ----------
  let msgTimer = 0;
  Game.events.message = (text) => {
    const m = $('msg');
    m.textContent = text;
    m.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => m.classList.remove('show'), 2200);
  };
  Game.events.levelComplete = (s) => {
    $('intername').textContent = s.name;
    $('interstats').innerHTML = `
      <tr><td>Kills</td><td>${pct(s.kills, s.totalKills)}</td></tr>
      <tr><td>Treasure &amp; items</td><td>${pct(s.items, s.totalItems)}</td></tr>
      <tr><td>Secrets</td><td>${pct(s.secrets, s.totalSecrets)}</td></tr>
      <tr><td>Time</td><td>${fmtTime(s.time)}</td></tr>`;
    setState('inter');
  };
  Game.events.death = () => { setTimeout(() => setState('dead'), 1100); };
  Game.events.victory = (s) => {
    $('winstats').innerHTML = `
      <tr><td>Difficulty</td><td>${s.difficulty}</td></tr>
      <tr><td>Monsters slain</td><td>${s.kills}</td></tr>
      <tr><td>Total time</td><td>${fmtTime(s.time)}</td></tr>`;
    setState('win');
  };

  // ---------- Input ----------
  const GAME_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft', 'ControlRight']);
  window.addEventListener('keydown', (e) => {
    if (state === 'play') {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyF') usePressed = true;
      if (e.code === 'Space') jumpPressed = true;
      if (e.code === 'KeyM' || e.code === 'Tab') showMap = !showMap;
      if (/^Digit[1-4]$/.test(e.code)) weaponKey = +e.code.slice(5) - 1;
      if (e.code === 'Escape' || e.code === 'KeyP') setState('pause');
      return;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      const scr = screens.map($).find((s) => !s.hidden);
      if (!scr) return;
      const btns = [...scr.querySelectorAll('button')];
      const i = btns.indexOf(document.activeElement);
      const next = btns[(i + (e.code === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
      next.focus();
      uiMove(next);
      e.preventDefault();
    } else if (e.code === 'Escape') {
      if (state === 'pause') { actions.resume(); Sound.play('uiClick'); }
      else if (state === 'help') { actions.back(); Sound.play('uiClick', { rate: 0.85 }); }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; if (state === 'play') setState('pause'); });

  view.addEventListener('mousedown', (e) => {
    if (state !== 'play') return;
    if (!document.pointerLockElement) { lock(); return; }
    if (e.button === 0) firing = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) firing = false; });
  window.addEventListener('mousemove', (e) => {
    if (state === 'play' && document.pointerLockElement === view) {
      mouseX += e.movementX; mouseY += e.movementY;
    }
  });
  window.addEventListener('wheel', (e) => { if (state === 'play') wheel += Math.sign(e.deltaY); }, { passive: true });
  let lockedOnce = false;
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === view) lockedOnce = true;
    else if (state === 'play' && lockedOnce) setState('pause');
  });
  view.addEventListener('contextmenu', (e) => e.preventDefault());

  function readInput() {
    const k = (c) => keys.has(c);
    const sens = 0.0006 + settings.sens * 0.00035;
    const input = {
      fwd: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
      strafe: (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0),
      turn: (k('ArrowRight') ? 1 : 0) - (k('ArrowLeft') ? 1 : 0),
      run: k('ShiftLeft') || k('ShiftRight'),
      fire: firing || k('ControlLeft') || k('ControlRight'),
      use: usePressed, jump: jumpPressed || false, weapon: weaponKey, wheel: Math.sign(wheel),
      mouseX: mouseX * sens, mouseY: mouseY * sens,
    };
    mouseX = mouseY = wheel = 0; usePressed = false; jumpPressed = false; weaponKey = -1;
    return input;
  }

  // ---------- HUD ----------
  const last = {};
  function setText(id, v) { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } }
  function updateHud() {
    const h = Game.hud();
    if (!h) return;
    setText('hpv', h.hp); setText('mpv', h.mana); setText('bov', h.bolts);
    setText('wname', h.weaponName);
    setText('lvlname', `Level ${h.level}`);
    setText('kills', `${h.kills} / ${h.totalKills}`);
    $('hpb').style.width = `${Math.max(0, h.hp)}%`;
    $('mpb').style.width = `${h.mana}%`;
    $('hpv').parentElement.classList.toggle('low', h.hp <= 25);
    $('keyv').className = h.key ? '' : 'nokey';
    const sig = `${h.weapon}|${h.owned.join()}`;
    if (last.slots !== sig) {
      last.slots = sig;
      [...$('slots').children].forEach((s, i) => { s.className = (h.owned[i] ? 'own' : '') + (i === h.weapon ? ' on' : ''); });
    }
    const bb = $('bossbar');
    bb.hidden = h.boss < 0;
    if (h.boss >= 0) bb.querySelector('i').style.width = `${Math.max(0, h.boss * 100)}%`;
  }

  // ---------- Resolution ----------
  // The scene renders at a low retro resolution; the canvas itself matches the
  // display so the final pass (upscale + screen effects) is sharp.
  function resize() {
    const H = Math.min(RES[settings.res].h, window.innerHeight);
    const W = Math.round(H * window.innerWidth / window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    Renderer.resize(W, H, Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
    overlay.width = W; overlay.height = H;
  }
  window.addEventListener('resize', resize);

  // ---------- Loop ----------
  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    if (state === 'play') {
      Game.update(dt, readInput());
    } else {
      Sound.silenceAmbient();
    }
    if (!$('title').hidden) titleGhosts(now / 1000);
    if (Game.state && ['play', 'dead', 'inter', 'win', 'pause'].includes(state)) {
      og.imageSmoothingEnabled = false;
      Game.drawOverlay(og, overlay.width, overlay.height, showMap && state === 'play');
      if (state === 'play' || state === 'dead') Game.render(now / 1000, { overlay, fx: settings.fx });
      updateHud();
    }
    requestAnimationFrame(frame);
  }

  // ---------- Title fog ----------
  // Seamless fractal value noise, turned into a soft pale-green fog texture.
  function fogTexture(size = 256) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size);
    const hash = (x, y, s) => {
      let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const smooth = (t) => t * t * (3 - 2 * t);
    const noise = (x, y, period, seed) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
      const p = (a) => ((a % period) + period) % period;
      const v00 = hash(p(xi), p(yi), seed), v10 = hash(p(xi + 1), p(yi), seed);
      const v01 = hash(p(xi), p(yi + 1), seed), v11 = hash(p(xi + 1), p(yi + 1), seed);
      return (v00 + (v10 - v00) * fx) + ((v01 + (v11 - v01) * fx) - (v00 + (v10 - v00) * fx)) * fy;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0, amp = 0.5, total = 0;
        for (let o = 0; o < 5; o++) {
          const period = 4 << o;
          v += noise(x / size * period, y / size * period, period, o + 1) * amp;
          total += amp; amp *= 0.5;
        }
        v /= total;
        const a = Math.max(0, Math.min(1, (v - 0.38) / 0.42));
        const i = (y * size + x) * 4;
        img.data[i] = 170; img.data[i + 1] = 196; img.data[i + 2] = 172;
        img.data[i + 3] = Math.round(a * a * (3 - 2 * a) * 150);
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }
  $('title').style.setProperty('--fog', `url(${fogTexture()})`);

  // Seamless grey-blue granite for menus and HUD: tileable value noise in
  // three octaves, mineral speckles and a few faint hairline cracks.
  function stoneTexture(size = 128) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
    const layer = (n) => Array.from({ length: n * n }, Math.random);
    const octs = [[4, layer(4), 0.5], [12, layer(12), 0.32], [32, layer(32), 0.18]];
    const at = (grid, n, x, y) => grid[((y + n) % n) * n + ((x + n) % n)];
    const noise = (grid, n, x, y) => {
      const fx = x / size * n, fy = y / size * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      return (at(grid, n, x0, y0) * (1 - sx) + at(grid, n, x0 + 1, y0) * sx) * (1 - sy) + (at(grid, n, x0, y0 + 1) * (1 - sx) + at(grid, n, x0 + 1, y0 + 1) * sx) * sy;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [n, grid, w] of octs) v += noise(grid, n, x, y) * w;
      let k = 0.72 + v * 0.45 + (Math.random() - 0.5) * 0.1;
      if (Math.random() < 0.03) k *= 1.25;
      if (Math.random() < 0.03) k *= 0.7;
      const i = (y * size + x) * 4;
      d[i] = 74 * k; d[i + 1] = 84 * k; d[i + 2] = 98 * k; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI * 2;
      g.strokeStyle = 'rgba(15,20,28,0.45)';
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { a += (Math.random() - 0.5) * 1.2; x += Math.cos(a) * 7; y += Math.sin(a) * 7; g.lineTo(x, y); }
      g.stroke();
    }
    return c.toDataURL();
  }
  document.documentElement.style.setProperty('--stone-tex', `url(${stoneTexture()})`);

  // ---------- Title ghosts ----------
  // Procedural 3D ghosts (head, sheet-like body with a rippling hem trailing
  // behind, reaching arms, dark eyes) drifting through the background. They are
  // ray-marched as glowing fog at low resolution and blurred by CSS.
  const GHOST_FS = `#version 300 es
    precision highp float;
    uniform vec2 uRes; uniform float uTime; uniform vec4 uG[6];
    out vec4 oCol;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 x){
      vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }
    float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
    float capsule(vec3 p, vec3 a, vec3 b, float r){ vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
    // Ghost in local space (facing +z); e = distance to the eyes and mouth.
    float ghost(vec3 p, float t, out float e){
      float k = clamp(0.5 - p.y, 0.0, 1.6);
      p.z += k * k * 0.18;
      p.x += sin(p.y * 4.0 + t * 2.3) * 0.08 * k;
      float head = length(p - vec3(0.0, 0.55, 0.0)) - 0.26;
      float y = clamp(p.y, -0.8, 0.55);
      float r = mix(0.46, 0.2, (y + 0.8) / 1.35);
      float hem = -0.8 + 0.1 * sin(atan(p.z, p.x) * 6.0 + t * 3.0);
      float body = max(length(p.xz) - r, max(p.y - 0.55, hem - p.y)) * 0.7;
      float w = sin(t * 1.7) * 0.12;
      float arms = min(capsule(p, vec3(-0.22, 0.3, 0.05), vec3(-0.48, 0.08 + w, 0.48), 0.06),
                       capsule(p, vec3(0.22, 0.3, 0.05), vec3(0.48, 0.08 - w, 0.48), 0.06));
      e = min(min(length(p - vec3(-0.1, 0.6, 0.21)), length(p - vec3(0.1, 0.6, 0.21))) - 0.055,
              length((p - vec3(0.0, 0.45, 0.23)) * vec3(1.0, 0.6, 1.0)) - 0.05);
      return smin(smin(head, body, 0.15), arms, 0.1);
    }
    void main(){
      vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
      vec3 rd = normalize(vec3(uv, 1.7));
      vec3 acc = vec3(0.0);
      float t = 1.5 + 0.06 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      for (int i = 0; i < 72; i++) {
        vec3 p = rd * t;
        float dmin = 1e9;
        for (int g = 0; g < 6; g++) {
          vec3 q = p - uG[g].xyz;
          float c = cos(uG[g].w), s = sin(uG[g].w);
          q = vec3(c * q.x - s * q.z, q.y, s * q.x + c * q.z);
          if (dot(q, q) > 4.0) { dmin = min(dmin, length(q) - 1.2); continue; }
          float e, d = ghost(q, uTime * 0.9 + float(g) * 7.3, e);
          dmin = min(dmin, d);
          float dens = exp(-max(d, 0.0) * 26.0) * (0.5 + 0.5 * noise(q * 4.0 + vec3(0.0, uTime * 0.6, 0.0)));
          if (d < 0.0) dens *= 1.0 + min(-d * 8.0, 2.0);
          float eye = smoothstep(0.03, -0.02, e);
          vec3 col = mix(vec3(0.55, 0.9, 0.85), vec3(0.75, 0.85, 1.0), fract(float(g) * 0.37));
          acc += col * dens * (1.0 - 0.95 * eye) * 0.028 * exp(-t * 0.06);
        }
        t += max(dmin * 0.5, 0.04);
        if (t > 15.0) break;
      }
      float a = clamp(max(acc.r, max(acc.g, acc.b)), 0.0, 1.0);
      oCol = vec4(min(acc, vec3(a)), a);
    }`;
  let ghostGL = null;
  function initTitleGhosts() {
    const cv = $('ghosts'), gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true });
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
      const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
      void main(){ gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, GHOST_FS));
    gl.linkProgram(prog);
    ghostGL = { gl, prog, vao: gl.createVertexArray(), uRes: gl.getUniformLocation(prog, 'uRes'),
      uTime: gl.getUniformLocation(prog, 'uTime'), uG: gl.getUniformLocation(prog, 'uG') };
  }
  // Each ghost follows its own slow 3D Lissajous path and faces where it goes.
  function ghostPath(i, t, aspect) {
    // Kept inside the view frustum (screen x = 1.7 * x / z, half-width = aspect / 2).
    const a = 0.022 + i * 0.005, z = 8 + 3 * Math.sin(t * a * 0.8 + i * 1.9);
    return [Math.sin(t * a + i * 2.1) * z * 0.27 * aspect, Math.sin(t * a * 1.3 + i * 0.7) * z * 0.14 - 0.1, z];
  }
  function titleGhosts(time) {
    if (!ghostGL) return;
    const { gl, prog, vao, uRes, uTime, uG } = ghostGL, cv = $('ghosts');
    const aspect = window.innerWidth / window.innerHeight;
    const w = 400, h = Math.round(w / aspect);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const g = new Float32Array(24);
    for (let i = 0; i < 6; i++) {
      const p = ghostPath(i, time, aspect), q = ghostPath(i, time + 1.5, aspect);
      g.set([p[0], p[1], p[2], Math.atan2(q[0] - p[0], q[2] - p[2])], i * 4);
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform2f(uRes, w, h);
    gl.uniform1f(uTime, time * 0.6);
    gl.uniform4fv(uG, g);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      try { initTitleGhosts(); } catch (e) { console.warn('Title ghosts disabled', e); }
      const assets = await Assets.load((t) => { $('loadmsg').textContent = t + '…'; });
      Renderer.init(view, assets);
      Game.init(assets);
      resize();
      refreshLabels();
      $('loading').hidden = true;
      setState('title');
      requestAnimationFrame(frame);
    } catch (err) {
      console.error(err);
      $('loading').classList.add('error');
      $('loadmsg').textContent = location.protocol === 'file:'
        ? 'Please open this page through a web server (e.g. http://localhost/oppd2026/day14/): browsers block image processing on file:// pages.'
        : 'Error: ' + err.message;
    }
  }
  boot();
})();
