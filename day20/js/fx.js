// fx.js - generated sound effects (Web Audio, no files) and acceleration visuals:
// rocket flames with a short glowing trail, ignition flash, speed streaks, radial blur and FOV kick.
(function () {
  'use strict';
  const U = GLSL.U;

  // ======================= sounds =======================
  const SFX = {};
  let ac = null, master = null, echo = null;

  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.32;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7000;
      master.connect(lp); lp.connect(ac.destination);
      // a short airy echo makes the UI blips less dry
      echo = ac.createDelay(0.5);
      echo.delayTime.value = 0.11;
      const fb = ac.createGain(); fb.gain.value = 0.28;
      const wet = ac.createGain(); wet.gain.value = 0.22;
      echo.connect(fb); fb.connect(echo); echo.connect(wet); wet.connect(lp);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  function tone(f0, f1, dur, type, vol, delay) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); g.connect(echo);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, f0, f1, q, vol, delay) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + (delay || 0);
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  SFX.move = function () { tone(1250, 1500, 0.045, 'triangle', 0.22); };
  SFX.tick = function () { tone(1800, 2100, 0.03, 'square', 0.07); tone(900, 900, 0.04, 'triangle', 0.12); };
  SFX.select = function () {
    tone(660, 660, 0.09, 'triangle', 0.28);
    tone(990, 990, 0.12, 'triangle', 0.26, 0.065);
    tone(1320, 1330, 0.3, 'sine', 0.24, 0.13);
    noise(0.25, 2500, 6000, 1.5, 0.05, 0.1);
  };
  // last 5 seconds of a Ring Run: each beep a semitone higher
  // (5 = B5, 4 = C6, 3 = C#6, 2 = D6, 1 = D#6), the last one a little longer
  SFX.beep = function (n) {
    const f = 987.77 * Math.pow(2, (5 - n) / 12);
    const d = n > 1 ? 0.13 : 0.24;
    tone(f, f, d, 'square', 0.09);
    tone(f, f, d, 'triangle', 0.2);
  };
  SFX.back = function () { tone(760, 360, 0.18, 'triangle', 0.26); tone(380, 300, 0.12, 'sine', 0.12, 0.05); };
  SFX.open = function () { noise(0.35, 600, 2400, 0.9, 0.12); tone(440, 660, 0.18, 'sine', 0.12, 0.05); };

  // ======================= ring sound =======================
  // soundfx/ring.wav (0.75 s) on every successful ring pass; a small pool so close passes overlap.
  // During a bullseye streak the pitch rises a little.
  const RING = { pool: [], idx: 0 };
  SFX.ring = function (combo) {
    if (!RING.pool.length) for (let i = 0; i < 3; i++) { const a = new Audio('soundfx/ring.wav'); a.preload = 'auto'; RING.pool.push(a); }
    const a = RING.pool[RING.idx]; RING.idx = (RING.idx + 1) % RING.pool.length;
    a.preservesPitch = false;
    a.playbackRate = 1 + Math.min(6, Math.max(0, (combo || 0) - 1)) * 0.06;
    a.volume = 0.9;
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* blocked until a user gesture */ });
  };

  // soundfx/missed.wav (~1 s) when a ring is missed
  const MISSED = { pool: [], idx: 0 };
  SFX.missed = function () {
    if (!MISSED.pool.length) for (let i = 0; i < 2; i++) { const a = new Audio('soundfx/missed.wav'); a.preload = 'auto'; MISSED.pool.push(a); }
    const a = MISSED.pool[MISSED.idx]; MISSED.idx = (MISSED.idx + 1) % MISSED.pool.length;
    a.volume = 0.9;
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* blocked until a user gesture */ });
  };

  // End of a Ring Run: soundfx/applause.wav (~4.9 s) when completed, soundfx/boo.mp3 when lost
  // (out of time). Both stop if a new run starts.
  const endSounds = {};
  function playEnd(file) {
    let a = endSounds[file];
    if (!a) { a = endSounds[file] = new Audio('soundfx/' + file); a.preload = 'auto'; }
    SFX.stopRaceEnd();
    a.volume = 0.85;
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* blocked until a user gesture */ });
  }
  SFX.applause = function () { playEnd('applause.wav'); };
  SFX.boo = function () { playEnd('boo.mp3'); };
  SFX.stopRaceEnd = function () { for (const k in endSounds) endSounds[k].pause(); };

  // ======================= engine thrust sound =======================
  // soundfx/thruster.wav is a 5.8 s one-shot: build-up (0-0.6 s), peak (~0.8 s), long decay.
  // Played with <audio> elements (Web Audio cannot decode local files from file://):
  // it starts past the quiet build-up and plays once per push (holding the boost does not
  // repeat it), follows the engine power and fades out when the push stops.
  const THRUST = { pool: [], idx: 0, active: null, fading: [], latched: false };
  function thrustInit() {
    for (let i = 0; i < 2; i++) {
      const a = new Audio('soundfx/thruster.wav');
      a.preload = 'auto'; a.volume = 0;
      THRUST.pool.push(a);
    }
  }
  function thrustStart(offset, vol) {
    const el = THRUST.pool[THRUST.idx];
    THRUST.idx ^= 1;
    if (THRUST.active && THRUST.active !== el) THRUST.fading.push(THRUST.active);
    THRUST.fading = THRUST.fading.filter(x => x !== el);
    try { el.currentTime = offset; } catch (e) { /* not loaded yet */ }
    el.volume = vol;
    const p = el.play();
    if (p && p.catch) p.catch(() => { /* blocked until a user gesture */ });
    THRUST.active = el;
  }
  function thrustUpdate(dt, power, halted) {
    const vol = Math.min(1, 0.35 + 0.65 * power) * 0.8;
    if (halted) {
      for (const a of THRUST.pool) { a.pause(); a.volume = 0; }
      THRUST.active = null; THRUST.fading = []; THRUST.latched = false;
      return;
    }
    const a = THRUST.active;
    if (power > 0.3) {
      if (!THRUST.latched) { thrustStart(0.35, vol); THRUST.latched = true; }  // once per push
      else if (a && !a.paused && !a.ended) a.volume += (vol - a.volume) * Math.min(1, dt * 6);
    } else if (power < 0.12) {
      THRUST.latched = false;                                    // released: next push plays again
      if (a) { THRUST.fading.push(a); THRUST.active = null; }    // fade out what is still playing
    }
    // cross-fades / fade-outs
    THRUST.fading = THRUST.fading.filter(x => {
      x.volume = Math.max(0, x.volume - dt * 2.2);
      if (x.volume <= 0.001) { x.pause(); return false; }
      return true;
    });
  }

  // ======================= visuals =======================
  const FX = { speedFx: 0 };
  let overlay, flames = [], trail, streaks;
  const MAX_P = 700;
  const parts = [];           // CPU particle state
  let lastBoost = 0, flash = 0, emitAcc = 0, prevSpeed = 0, accel = 0;

  // ---- rocket flame: open cone, tip pointing backward (+Z of the ship) ----
  const flameVert = /* glsl */`
    varying float vT;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      vT = position.z;                       // 0 at the nozzle, 1 at the tip
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;
  const flameFrag = /* glsl */`
    uniform float uPower;
    uniform float uTime;
    varying float vT;
    varying vec3 vN;
    varying vec3 vV;
    void main() {
      float rim = abs(dot(vN, vV));          // soft edges, bright core
      float flick = 0.85 + 0.15 * sin(uTime * 60.0 + vT * 20.0);
      vec3 hot = mix(vec3(1.0, 0.95, 0.85) * 2.5, vec3(1.0, 0.5, 0.15) * 1.4, smoothstep(0.0, 0.45, vT)); // afterburner
      hot = mix(hot, vec3(0.8, 0.12, 0.05), smoothstep(0.45, 1.0, vT));
      // seen from behind the cone is almost edge-on everywhere: keep a floor so it stays bright
      float a = pow(1.0 - vT, 1.6) * (0.35 + 0.65 * rim) * uPower * flick;
      gl_FragColor = vec4(hot * a, 1.0);
    }`;

  // ---- glowing trail particles (points) ----
  const trailVert = /* glsl */`
    attribute float aLife;   // 0 new .. 1 dead
    attribute float aSize;
    varying float vLife;
    varying float vFade;
    uniform float uScale;
    void main() {
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = -mv.z;
      vFade = smoothstep(2.0, 10.0, d);        // never fill the screen
      gl_PointSize = aSize * (1.0 + aLife * 1.2) * uScale / max(d, 0.5);
      gl_Position = projectionMatrix * mv;
    }`;
  const trailFrag = /* glsl */`
    varying float vLife;
    varying float vFade;
    void main() {
      vec2 q = gl_PointCoord * 2.0 - 1.0;
      float r = dot(q, q);
      if (r > 1.0) discard;
      float k = (1.0 - r) * (1.0 - r);
      vec3 c = mix(vec3(1.0, 0.7, 0.4) * 1.4, vec3(0.6, 0.12, 0.04), smoothstep(0.0, 0.6, vLife));
      float a = k * pow(1.0 - vLife, 1.5) * vFade;
      gl_FragColor = vec4(c * a, 1.0);
    }`;

  // ---- speed streaks: thin lines flowing past the camera ----
  const NS = 140;
  const streakState = [];

  FX.init = function (ov) {
    overlay = ov;
    thrustInit();
    const cone = new THREE.CylinderGeometry(0.05, 0.42, 1, 18, 6, true);
    cone.rotateX(Math.PI / 2);               // axis along Z, wide end at -Z
    cone.translate(0, 0, 0.5);               // nozzle (wide end) at z = 0, tip at z = 1
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(cone, new THREE.ShaderMaterial({
        vertexShader: flameVert, fragmentShader: flameFrag,
        uniforms: { uPower: { value: 0 }, uTime: U.uTime },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      }));
      m.frustumCulled = false; m.visible = false;
      flames.push(m); overlay.add(m);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_P * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(MAX_P), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_P), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    trail = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: trailVert, fragmentShader: trailFrag, uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    trail.frustumCulled = false;
    overlay.add(trail);

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NS * 6), 3).setUsage(THREE.DynamicDrawUsage));
    streaks = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    streaks.frustumCulled = false;
    overlay.add(streaks);
    for (let i = 0; i < NS; i++) streakState.push(newStreak(true));
  };

  // a streak in camera space: around the view axis, ahead of the camera
  function newStreak(anywhere) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.pow(Math.random(), 0.7) * 45;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.75, z: -(anywhere ? 10 + Math.random() * 230 : 200 + Math.random() * 60), b: 0.4 + Math.random() * 0.6 };
  }

  const back = new THREE.Vector3(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3();

  FX.update = function (dt, camera, halted) {
    const S = SHIP;
    const speed = S.vel.length();
    if (dt > 0) {
      accel += ((speed - prevSpeed) / dt - accel) * Math.min(1, dt * 4);
      prevSpeed = speed;
    }
    // engine power: boost, or the engine pushing hard toward a higher throttle speed
    const push = THREE.MathUtils.clamp(accel / 25, 0, 1);
    const power = halted ? 0 : Math.max(S.boost, push * 0.7);

    // ignition: flash when the boost kicks in; the engines sound with soundfx/thruster.wav
    if (S.boost > 0.25 && lastBoost <= 0.25 && !halted) flash = 1;
    thrustUpdate(dt, power, halted);
    lastBoost = S.boost;
    flash = Math.max(0, flash - dt * 5);
    S.glowBoost = 1 + flash * 1.5;

    // flames at the nozzles
    back.set(0, 0, 1).applyQuaternion(S.quat);
    S.glows.forEach((g, i) => {
      const f = flames[i];
      if (!f) return;
      f.visible = power > 0.03;
      if (!f.visible) return;
      f.position.copy(g.position).addScaledVector(back, -0.15);
      f.quaternion.copy(S.quat);
      const len = (0.8 + 3.2 * power + flash * 1.5) * (S.nozzleR / 0.4) * 1.3;
      const w = (0.75 + 0.25 * power + flash * 0.3) * (S.nozzleR / 0.4); // flame width follows the nozzle
      f.scale.set(w, w, len * (0.92 + Math.random() * 0.16));
      f.material.uniforms.uPower.value = Math.min(1.4, power + flash * 0.6);
    });

    // trail particles
    if (power > 0.08 && dt > 0) {
      emitAcc += dt * 90 * power;
      while (emitAcc >= 1) {
        emitAcc -= 1;
        for (const g of S.glows) {
          if (parts.length >= MAX_P) break;
          const p = g.position.clone().addScaledVector(back, 0.3 + Math.random() * 1.0);
          p.x += (Math.random() - 0.5) * 0.4; p.y += (Math.random() - 0.5) * 0.4; p.z += (Math.random() - 0.5) * 0.4;
          // the trail lags behind: it moves slower than the ship, plus a push out of the nozzle
          const vel = S.vel.clone().multiplyScalar(0.975).addScaledVector(back, 5 + Math.random() * 4);
          parts.push({ p, v: vel, life: 0, max: 0.3 + Math.random() * 0.15, size: 0.3 + Math.random() * 0.2 + power * 0.25 });
        }
      }
    }
    const P = trail.geometry.getAttribute('position'), L = trail.geometry.getAttribute('aLife'), Z = trail.geometry.getAttribute('aSize');
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      if (dt > 0) { q.life += dt / q.max; q.p.addScaledVector(q.v, dt); q.v.multiplyScalar(1 - dt * 0.6); }
      if (q.life >= 1) { parts.splice(i, 1); continue; }
    }
    for (const q of parts) { P.setXYZ(n, q.p.x, q.p.y, q.p.z); L.setX(n, q.life); Z.setX(n, q.size); n++; }
    trail.geometry.setDrawRange(0, n);
    P.needsUpdate = L.needsUpdate = Z.needsUpdate = true;
    trail.material.uniforms.uScale.value = window.innerHeight * POST.scale / (2 * Math.tan(camera.fov * Math.PI / 360));

    // speed sensation: grows with boost / acceleration and with speed itself
    const fast = THREE.MathUtils.clamp((speed - 120) / 300, 0, 1);
    const target = halted ? 0 : THREE.MathUtils.clamp(Math.max(S.boost, push) * (0.35 + 0.65 * fast) + Math.max(0, fast - 0.6) * 0.25, 0, 1);
    FX.speedFx += (target - FX.speedFx) * Math.min(1, dt * 3 + (halted ? 1 : 0));
    S.fovKick = FX.speedFx * 9;

    // streaks flow past the camera at the ship's speed
    const sp = streaks.geometry.getAttribute('position'), sc = streaks.geometry.getAttribute('color');
    const show = FX.speedFx > 0.02 && S.camMode !== 2;
    streaks.visible = show;
    if (show) {
      const len = 4 + speed * 0.035 * FX.speedFx;
      for (let i = 0; i < NS; i++) {
        const s = streakState[i];
        s.z += speed * dt * 1.15;
        if (s.z > 5) streakState[i] = newStreak(false);
        const t = streakState[i];
        v0.set(t.x, t.y, t.z).applyMatrix4(camera.matrixWorld);
        v1.set(t.x, t.y, t.z - len).applyMatrix4(camera.matrixWorld);
        sp.setXYZ(i * 2, v0.x, v0.y, v0.z); sp.setXYZ(i * 2 + 1, v1.x, v1.y, v1.z);
        // fade in from the distance, fade out right next to the camera
        const k = FX.speedFx * t.b * THREE.MathUtils.smoothstep(-t.z, 2, 30) * (1 - THREE.MathUtils.smoothstep(-t.z, 150, 250)) * 0.55;
        const night = 0.25 + 0.75 * (1 - U.uNight.value);
        sc.setXYZ(i * 2, 0.8 * k * night, 0.9 * k * night, 1.0 * k * night);
        sc.setXYZ(i * 2 + 1, 0, 0, 0);
      }
      sp.needsUpdate = sc.needsUpdate = true;
    }
  };

  // ======================= background music =======================
  // An <audio> element (unlike Web Audio decoding it also plays from file://). Browsers only
  // allow playback after a user gesture, so it starts on the first click or key press.
  const MUSIC = { enabled: true, playing: false, el: null, volume: 0.42 };
  const MKEY = 'skyward.music';
  let fadeTimer = null;

  function fadeTo(target, done) {
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {
      const el = MUSIC.el, v = el.volume, step = 0.03;
      el.volume = Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
      if (el.volume === target) { clearInterval(fadeTimer); if (done) done(); }
    }, 50);
  }

  MUSIC.init = function () {
    try { MUSIC.enabled = localStorage.getItem(MKEY) !== '0'; } catch (e) { /* storage unavailable */ }
    MUSIC.el = new Audio('muzic/Cruising%20Altitude.mp3');
    MUSIC.el.loop = true;
    MUSIC.el.preload = 'auto';
    MUSIC.el.volume = 0;
    const kick = () => { if (MUSIC.enabled && !MUSIC.playing) MUSIC.play(); };
    window.addEventListener('pointerdown', kick, true);
    window.addEventListener('keydown', kick, true);
  };
  MUSIC.play = function () {
    const p = MUSIC.el.play();
    MUSIC.playing = true;
    if (p && p.catch) p.catch(() => { MUSIC.playing = false; }); // blocked until a user gesture
    fadeTo(MUSIC.volume);
  };
  MUSIC.toggle = function () {
    MUSIC.enabled = !MUSIC.enabled;
    try { localStorage.setItem(MKEY, MUSIC.enabled ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    if (MUSIC.enabled) MUSIC.play();
    else fadeTo(0, () => { MUSIC.el.pause(); MUSIC.playing = false; });
    return MUSIC.enabled;
  };

  FX.thrust = THRUST; // debug access
  window.SFX = SFX;
  window.FX = FX;
  window.MUSIC = MUSIC;
})();
