// game.js - game layer on top of the flight simulator:
//  - free flight (exploration) and "Ring Run" (fly through rings against the clock) in 3 difficulties
//  - checkpoint timer, score, ring bonuses (bullseye combo, inverted, knife edge, low, fast),
//    time-bonus orbs, stunts (barrel roll, loop)
//  - persistent achievements and best scores (localStorage)
(function () {
  'use strict';

  const DIFF = {
    easy: { name: 'Easy', rings: 15, radius: 42, gap: [800, 1100], turn: 0.35, agl: [170, 320], ref: 140, start: 12, mult: 1, orbs: 0, missSkip: true, missPenalty: 0 },
    normal: { name: 'Normal', rings: 20, radius: 30, gap: [650, 950], turn: 0.6, agl: [90, 230], ref: 185, start: 10, mult: 1.5, orbs: 4, missSkip: true, missPenalty: 5 },
    hard: { name: 'Hard', rings: 25, radius: 20, gap: [500, 800], turn: 0.9, agl: [35, 170], ref: 235, start: 8, mult: 2.2, orbs: 6, missSkip: false, missPenalty: 0 }
  };

  const ACH = [
    { id: 'first_ring', name: 'Through the Hoop', desc: 'Fly through your first ring' },
    { id: 'finish_easy', name: 'Cadet', desc: 'Finish a Ring Run on Easy' },
    { id: 'finish_normal', name: 'Pilot', desc: 'Finish a Ring Run on Normal' },
    { id: 'finish_hard', name: 'Ace', desc: 'Finish a Ring Run on Hard' },
    { id: 'flawless', name: 'Flawless', desc: 'Finish a course with no missed rings and no crashes' },
    { id: 'sharpshooter', name: 'Sharpshooter', desc: '5 bullseyes in a row' },
    { id: 'needle', name: 'Thread the Needle', desc: 'Bullseye on Hard' },
    { id: 'edge', name: 'Edge of Glory', desc: 'Pass a ring right next to its rim' },
    { id: 'inv_ring', name: 'Topsy-Turvy', desc: 'Pass a ring upside down' },
    { id: 'knife', name: 'Knife Edge', desc: 'Pass a ring with the wings vertical' },
    { id: 'speed_ring', name: 'Speed Demon', desc: 'Pass a ring above 1,500 km/h' },
    { id: 'barrel', name: 'Do a Barrel Roll!', desc: 'Complete a full roll' },
    { id: 'loop', name: 'Loop the Loop', desc: 'Complete a full loop' },
    { id: 'inverted', name: 'Upside Down', desc: 'Fly inverted for 5 seconds' },
    { id: 'sonic', name: 'Sound Barrier', desc: 'Exceed 1,235 km/h' },
    { id: 'treetop', name: 'Treetop Flyer', desc: '10 s below 25 m over land, faster than 300 km/h' },
    { id: 'skimmer', name: 'Wave Skimmer', desc: '5 s below 10 m over water' },
    { id: 'stratos', name: 'Above It All', desc: 'Climb to 6,000 m' },
    { id: 'night', name: 'Night Owl', desc: 'Finish a Ring Run at night' },
    { id: 'tour', name: 'Grand Tour', desc: 'Fly low over 10 different villages' },
    { id: 'lakes', name: 'Mirror, Mirror', desc: 'Skim 3 different lakes below 40 m' },
    { id: 'flock', name: 'Birds of a Feather', desc: 'Fly within 40 m of a flock of birds' },
    { id: 'spotter', name: 'Plane Spotter', desc: 'Fly within 400 m of an airliner' },
    { id: 'oops', name: 'Oops', desc: 'Crash for the first time' }
  ];

  const COUNTDOWN = 3.5; // seconds, the ship keeps flying meanwhile

  const G = {
    mode: 'free',          // 'free' | 'ring'
    state: 'menu',         // 'menu' | 'free' | 'countdown' | 'race' | 'results'
    diff: null,
    rings: [], orbs: [], next: 0,
    time: 0, elapsed: 0, score: 0, combo: 0, misses: 0, crashes: 0, bullseyes: 0,
    countdown: 0,
    popups: [], toasts: [],
    store: { ach: {}, best: {} },
    marker: null           // next ring screen marker for the HUD
  };
  let scene, overlay, camera;
  const ringGroup = new THREE.Group();

  // ---------------- persistence ----------------
  const KEY = 'skyward.v1';
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.ach) G.store = { ach: s.ach || {}, best: s.best || {} }; } catch (e) { /* storage unavailable */ }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(G.store)); } catch (e) { /* storage unavailable */ } }

  function unlock(id) {
    if (G.store.ach[id]) return;
    const a = ACH.find(x => x.id === id);
    if (!a) return;
    G.store.ach[id] = Date.now();
    save();
    G.toasts.push({ title: a.name, desc: a.desc, t: 5 });
  }
  function popup(text, color) { G.popups.push({ text, color: color || '#ffcf6b', t: 1.8 }); }

  // ---------------- course generation ----------------
  function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

  function makeCourse(cfg, start, heading) {
    const rnd = Math.random;
    const pts = [];
    let x = start.x, z = start.z, y = start.y, a = heading, target = null;
    const features = WORLD.lakes.map(l => ({ x: l.x, z: l.z })).concat(WORLD.towns.map(t => ({ x: t.x, z: t.z })));
    for (let i = 0; i < cfg.rings; i++) {
      // every few rings, aim at a scenic feature ahead (lake, village)
      if (i % 4 === 0) {
        const ahead = features.filter(f => {
          const d = Math.hypot(f.x - x, f.z - z);
          return d > 2000 && d < 8000 && Math.abs(angDiff(Math.atan2(f.x - x, -(f.z - z)), a)) < 1.6;
        });
        target = ahead.length ? ahead[(rnd() * ahead.length) | 0] : null;
      }
      let want = a;
      if (target) want = Math.atan2(target.x - x, -(target.z - z));
      // keep away from the open sea
      if (Math.hypot(x, z) > 12000) want = Math.atan2(-x, z);
      a += THREE.MathUtils.clamp(angDiff(want, a), -cfg.turn, cfg.turn) * 0.7 + (rnd() - 0.5) * cfg.turn * 0.8;
      const gap = cfg.gap[0] + rnd() * (cfg.gap[1] - cfg.gap[0]);
      const nx = x + Math.sin(a) * gap, nz = z - Math.cos(a) * gap;
      const ground = Math.max(0, WORLD.heightAt(nx, nz));
      let ny = ground + cfg.agl[0] + rnd() * (cfg.agl[1] - cfg.agl[0]);
      // the straight line from the previous ring must clear the terrain
      const clear = Math.max(25, cfg.agl[0] * 0.5);
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        const g = Math.max(0, WORLD.heightAt(x + (nx - x) * t, z + (nz - z) * t)) + clear;
        ny = Math.max(ny, y + (g - y) / t);
      }
      // no wild climbs or dives between rings
      ny = Math.min(ny, y + gap * 0.45);
      ny = Math.max(ny, y - gap * 0.4, ground + clear);
      // the first ring sits near the starting height, straight ahead
      if (i === 0) ny = Math.max(Math.min(ny, y + gap * 0.12), y - gap * 0.12, ground + clear);
      pts.push(new THREE.Vector3(nx, ny, nz));
      x = nx; z = nz; y = ny;
    }
    return pts;
  }

  // ---------------- smoke rings ----------------
  // Every ring is a loop of soft smoke puffs: camera-facing quads (one instanced draw for all
  // rings) shaded with animated value noise and a fake spherical normal for sun / sky lighting.
  // They live in the overlay scene (drawn after the atmosphere, depth tested against the scene).
  const MAX_PUFFS = 3000;
  const smoke = { mesh: null, n: 0 };
  const smokeVert = /* glsl */`
    attribute vec4 aPos;   // centre xyz, size
    attribute vec4 aData;  // seed, dissolve 0..1, spin, unused
    attribute vec4 aTint;  // rgb tint, opacity
    uniform float uTime;
    varying vec2 vUv;
    varying vec4 vTint;
    varying float vSeed;
    varying float vFade;
    varying vec3 vViewPos;
    void main() {
      float seed = aData.x, fade = aData.y;
      vec3 c = aPos.xyz;
      // slow billowing drift; a dissolving ring expands and rises
      c += vec3(sin(uTime * 0.31 + seed * 6.0), 0.7 * sin(uTime * 0.23 + seed * 9.0), cos(uTime * 0.27 + seed * 4.0)) * aPos.w * 0.12;
      c.y += fade * aPos.w * 1.6;
      float size = aPos.w * (1.0 + fade * 1.3);
      vec4 mv = viewMatrix * vec4(c, 1.0);
      float ang = seed * 6.2832 + uTime * 0.06 * aData.z;
      vec2 q = position.xy;
      mv.xy += vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y) * size;
      vUv = q; vTint = aTint; vSeed = seed; vFade = fade; vViewPos = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;
  const smokeFrag = /* glsl */`
    uniform float uTime;
    uniform vec3 uLightDir, uLightColor, uAmbient;
    varying vec2 vUv;
    varying vec4 vTint;
    varying float vSeed;
    varying float vFade;
    varying vec3 vViewPos;
    ${GLSL.common}
    void main() {
      float r = length(vUv);
      if (r > 1.0) discard;
      float n = vnoise2(vUv * 2.2 + vSeed * 17.0 + uTime * 0.05) * 0.6 + vnoise2(vUv * 5.3 - vSeed * 11.0 - uTime * 0.09) * 0.4;
      float d = smoothstep(1.0, 0.2, r + (n - 0.5) * 0.6);
      // fake sphere normal: puffs look round and lit from the sun side
      vec3 nv = normalize(vec3(vUv, sqrt(max(0.0, 1.0 - r * r)) + 0.35));
      vec3 nw = (vec4(nv, 0.0) * viewMatrix).xyz;
      float lam = 0.45 + 0.55 * max(dot(nw, uLightDir), -0.4);
      vec3 col = (uAmbient * 0.95 + uLightColor * 0.085 * lam) * (0.82 + 0.3 * n);
      col *= vTint.rgb;
      float dist = length(vViewPos);
      float a = d * vTint.a * (1.0 - vFade)
              * (1.0 - smoothstep(5000.0, 9000.0, dist))   // far away
              * smoothstep(4.0, 18.0, dist);               // do not fill the screen when flying through
      gl_FragColor = vec4(col, a * 0.88);
    }`;

  function initSmoke() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (const name of ['aPos', 'aData', 'aTint']) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader: smokeVert, fragmentShader: smokeFrag, transparent: true, depthWrite: false,
      uniforms: { uTime: GLSL.U.uTime, uLightDir: GLSL.U.uLightDir, uLightColor: GLSL.U.uLightColor, uAmbient: LIFE.ambient }
    });
    smoke.mesh = new THREE.Mesh(g, m);
    smoke.mesh.frustumCulled = false;
    smoke.mesh.renderOrder = 5;
    overlay.add(smoke.mesh);
  }

  // Adds the puffs of one ring; returns its puff range
  function addSmokeRing(center, normal, r) {
    const g = smoke.mesh.geometry;
    const P = g.getAttribute('aPos'), D = g.getAttribute('aData');
    const u = new THREE.Vector3().crossVectors(normal, Math.abs(normal.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u);
    const start = smoke.n;
    // a slim ring: many small puffs (main loop + a staggered second loop), little scatter
    const MAIN = 44, SECOND = 20;
    for (let k = 0; k < MAIN + SECOND && smoke.n < MAX_PUFFS; k++) {
      const main = k < MAIN;
      const a = (main ? k / MAIN : (k - MAIN + 0.5) / SECOND) * Math.PI * 2 + (Math.random() - 0.5) * 0.06;
      const rr = r * (1 + (Math.random() - 0.5) * 0.07);
      const p = center.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr).addScaledVector(normal, (Math.random() - 0.5) * r * 0.07);
      const size = r * (main ? 0.2 : 0.16) * (0.8 + Math.random() * 0.45);
      P.setXYZW(smoke.n, p.x, p.y, p.z, size);
      D.setXYZW(smoke.n, Math.random(), 0, Math.random() < 0.5 ? -1 : 1, 0);
      smoke.n++;
    }
    P.needsUpdate = true; D.needsUpdate = true;
    g.instanceCount = smoke.n;
    return { start, count: smoke.n - start };
  }

  function setRingTint(ring, rr, gg, bb, a) {
    const T = smoke.mesh.geometry.getAttribute('aTint');
    for (let k = ring.start; k < ring.start + ring.count; k++) T.setXYZW(k, rr, gg, bb, a);
    T.needsUpdate = true;
  }
  function setRingFade(ring, f) {
    const D = smoke.mesh.geometry.getAttribute('aData');
    for (let k = ring.start; k < ring.start + ring.count; k++) D.setY(k, f);
    D.needsUpdate = true;
  }
  function orbMesh() {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 1), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(1.0, 0.75, 0.2), emissiveIntensity: 4, roughness: 0.3 }));
    return m;
  }

  function clearCourse() {
    smoke.n = 0;
    if (smoke.mesh) smoke.mesh.geometry.instanceCount = 0;
    for (const o of G.orbs) { ringGroup.remove(o.mesh); o.mesh.geometry.dispose(); o.mesh.material.dispose(); }
    G.rings = []; G.orbs = [];
  }

  // ---------------- modes ----------------
  G.startFree = function () {
    clearCourse();
    G.mode = 'free'; G.state = 'free';
    hideMenus();
    HUD.message('Free flight — explore the island (M for the menu)', 3);
  };

  G.startRace = function (key) {
    const cfg = DIFF[key];
    SFX.stopRaceEnd();
    clearCourse();
    G.mode = 'ring'; G.diff = key; G.cfg = cfg;
    // The ship keeps flying: the course starts where it will be when the countdown ends,
    // along its current direction of travel and at its current height (if clear of the terrain).
    const f = SHIP.vel.clone(); f.y = 0;
    if (f.lengthSq() < 1) f.set(0, 0, -1).applyQuaternion(SHIP.quat).setY(0);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    const heading = Math.atan2(f.x, -f.z);
    const lead = SHIP.vel.length() * COUNTDOWN;
    const sx = SHIP.pos.x + f.x * lead, sz = SHIP.pos.z + f.z * lead;
    let ground = 0;
    for (let k = -2; k <= 6; k++) ground = Math.max(ground, WORLD.heightAt(sx + f.x * k * 150, sz + f.z * k * 150));
    const start = new THREE.Vector3(sx, Math.max(SHIP.pos.y + SHIP.vel.y * COUNTDOWN, ground + cfg.agl[0] * 0.5 + 30), sz);
    const pts = makeCourse(cfg, start, heading);
    G.start = start.clone(); G.startDir = f.clone();
    for (let i = 0; i < pts.length; i++) {
      const prev = i === 0 ? start : pts[i - 1], nxt = i === pts.length - 1 ? pts[i].clone().add(pts[i].clone().sub(prev)) : pts[i + 1];
      const n = nxt.clone().sub(prev).normalize();
      const finish = i === pts.length - 1;
      const puffs = addSmokeRing(pts[i], n, cfg.radius);
      G.rings.push({ pos: pts[i], n, r: cfg.radius, start: puffs.start, count: puffs.count, passed: false, finish, seg: pts[i].distanceTo(prev) });
    }
    // time-bonus orbs, off the ideal line between some rings
    for (let k = 0; k < cfg.orbs; k++) {
      const i = 2 + Math.floor(Math.random() * (pts.length - 3));
      const a = pts[i - 1], b = pts[i];
      const side = new THREE.Vector3().crossVectors(b.clone().sub(a), new THREE.Vector3(0, 1, 0)).normalize();
      const p = a.clone().lerp(b, 0.5).addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * (40 + Math.random() * 70));
      p.y = Math.max(p.y + (Math.random() - 0.3) * 50, Math.max(0, WORLD.heightAt(p.x, p.z)) + 25);
      const mesh = orbMesh(); mesh.position.copy(p); ringGroup.add(mesh);
      G.orbs.push({ pos: p, mesh, taken: false });
    }
    G.next = 0; G.score = 0; G.combo = 0; G.misses = 0; G.crashes = 0; G.bullseyes = 0; G.elapsed = 0;
    G.bonusLog = { rings: 0, bullseye: 0, stunts: 0, orbs: 0, style: 0 };
    G.time = cfg.start + G.rings[0].seg / cfg.ref * 1.25;
    G.state = 'countdown'; G.countdown = COUNTDOWN;
    hideMenus();
    updateRingLook();
  };

  // only the menu pauses the simulation: the ship keeps flying through the countdown and the results
  G.blocking = function () { return G.state === 'menu'; };
  G.racing = function () { return G.state === 'race'; };

  // ---------------- per-frame logic ----------------
  const prevPos = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3();
  const stunt = { roll: 0, rollQuiet: 0, pitch: 0, pitchQuiet: 0, inv: 0, low: 0, skim: 0 };
  const visitedTowns = new Set(), visitedLakes = new Set();

  function updateRingLook() {
    // next ring: warm golden smoke; finish: greenish; the rest white, fainter further ahead
    G.rings.forEach((r, i) => {
      if (r.passed) return;
      const isNext = i === G.next;
      const a = isNext ? 1 : i < G.next + 4 ? 0.8 : 0.4;
      if (r.finish) setRingTint(r, 0.75, 1.2, 0.8, a);
      else if (isNext) setRingTint(r, 1.9, 1.35, 0.6, a);
      else setRingTint(r, 1, 1, 1, a);
    });
  }

  function passRing(r, hitDist, speedKmh, agl) {
    const cfg = G.cfg;
    r.passed = true;
    G.next++;
    let pts = Math.round(100 * cfg.mult);
    const k = hitDist / r.r;
    G.bonusLog.rings += pts;
    unlock('first_ring');
    const tags = [];
    if (k < 0.3) {
      G.combo++; G.bullseyes++;
      const b = Math.round(80 * cfg.mult * (1 + (G.combo - 1) * 0.5));
      pts += b; G.bonusLog.bullseye += b;
      tags.push('BULLSEYE' + (G.combo > 1 ? ' ×' + G.combo : ''));
      if (G.combo >= 5) unlock('sharpshooter');
      if (G.diff === 'hard') unlock('needle');
    } else G.combo = 0;
    if (k > 0.85) { const b = Math.round(120 * cfg.mult); pts += b; G.bonusLog.style += b; tags.push('CLOSE SHAVE'); unlock('edge'); }
    if (up.y < -0.6) { const b = Math.round(300 * cfg.mult); pts += b; G.bonusLog.style += b; tags.push('INVERTED'); unlock('inv_ring'); }
    else if (Math.abs(up.y) < 0.3) { const b = Math.round(250 * cfg.mult); pts += b; G.bonusLog.style += b; tags.push('KNIFE EDGE'); unlock('knife'); }
    if (agl < 35) { const b = Math.round(200 * cfg.mult); pts += b; G.bonusLog.style += b; tags.push('LOW PASS'); }
    if (speedKmh > 1000) { const b = Math.round(150 * cfg.mult); pts += b; G.bonusLog.style += b; tags.push('FAST'); }
    if (speedKmh > 1500) unlock('speed_ring');
    G.score += pts;
    SFX.ring(G.combo);
    popup('+' + pts + (tags.length ? '  ' + tags.join(' · ') : ''), tags.length ? '#ffcf6b' : '#7fe8ff');
    // extend the clock with the next segment
    if (G.next < G.rings.length) G.time += G.rings[G.next].seg / cfg.ref * 1.25;
    r.fade = 0.0001; // starts dissolving
    if (r.finish) finishRace(true);
    else updateRingLook();
  }

  function missRing(r) {
    const cfg = G.cfg;
    G.misses++; G.combo = 0;
    r.missed = true;
    SFX.missed();
    if (cfg.missSkip) {
      r.passed = true; G.next++;
      r.fade = 0.0001;
      G.time -= cfg.missPenalty;
      popup('MISSED' + (cfg.missPenalty ? '  −' + cfg.missPenalty + ' s' : ''), '#ff6a50');
      if (G.next < G.rings.length) G.time += G.rings[G.next].seg / cfg.ref * 1.25;
      if (r.finish) finishRace(true);
      else updateRingLook();
    } else {
      popup('MISSED — turn back!', '#ff6a50');
    }
  }

  function finishRace(ok) {
    G.state = 'results';
    const cfg = G.cfg;
    const timeBonus = ok ? Math.round(Math.max(0, G.time) * 20 * cfg.mult) : 0;
    const clean = ok && G.misses === 0 && G.crashes === 0;
    const cleanBonus = clean ? Math.round(1000 * cfg.mult) : 0;
    G.score += timeBonus + cleanBonus;
    G.result = { ok, timeBonus, cleanBonus, clean };
    if (!ok) SFX.boo();
    if (ok) {
      SFX.applause();
      unlock('finish_' + G.diff);
      if (clean) unlock('flawless');
      if (ATMO.night > 0.6) unlock('night');
    }
    const prev = G.store.best[G.diff] || 0;
    G.result.record = ok && G.score > prev;
    if (G.result.record) { G.store.best[G.diff] = G.score; save(); }
    showResults();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Called by main on a crash. Returns true when the game handled the respawn.
  G.onCrash = function () {
    unlock('oops');
    if (G.state !== 'race') return false;
    G.crashes++; G.combo = 0;
    G.time -= 5;
    popup('CRASH  −5 s', '#ff6a50');
    // respawn in front of the next ring, facing it
    const r = G.rings[G.next];
    const prev = G.next > 0 ? G.rings[G.next - 1].pos : G.start;
    const d = r.pos.clone().sub(prev); d.y = 0; d.normalize();
    const p = r.pos.clone().addScaledVector(d, -350);
    p.y = Math.max(r.pos.y, Math.max(0, WORLD.heightAt(p.x, p.z)) + 80);
    SHIP.reset(p.x, p.y, p.z, d.x, d.z);
    return true;
  };

  function stunts(dt, speedKmh, agl, overWater) {
    // barrel roll: a full turn of roll without stopping
    const rr = SHIP.rates.z;
    if (Math.abs(rr) > 0.6) { stunt.roll += rr * dt; stunt.rollQuiet = 0; } else if ((stunt.rollQuiet += dt) > 0.5) stunt.roll = 0;
    if (Math.abs(stunt.roll) >= Math.PI * 2) {
      stunt.roll = 0; unlock('barrel');
      if (G.state === 'race') { const b = Math.round(250 * G.cfg.mult); G.score += b; G.bonusLog.stunts += b; popup('BARREL ROLL  +' + b); }
      else popup('BARREL ROLL');
    }
    // loop: a full turn of pitch
    const pr = SHIP.rates.x;
    if (Math.abs(pr) > 0.35) { stunt.pitch += pr * dt; stunt.pitchQuiet = 0; } else if ((stunt.pitchQuiet += dt) > 1.0) stunt.pitch = 0;
    if (Math.abs(stunt.pitch) >= Math.PI * 2) {
      stunt.pitch = 0; unlock('loop');
      if (G.state === 'race') { const b = Math.round(400 * G.cfg.mult); G.score += b; G.bonusLog.stunts += b; popup('LOOP  +' + b); }
      else popup('LOOP THE LOOP');
    }
    // inverted flight
    if (up.y < -0.7) { if ((stunt.inv += dt) > 5) unlock('inverted'); } else stunt.inv = 0;
    if (speedKmh > 1235) unlock('sonic');
    if (SHIP.pos.y > 6000) unlock('stratos');
    if (!overWater && agl < 25 && speedKmh > 300) { if ((stunt.low += dt) > 10) unlock('treetop'); } else stunt.low = 0;
    if (overWater && agl < 10) { if ((stunt.skim += dt) > 5) unlock('skimmer'); } else stunt.skim = 0;
    // sightseeing
    WORLD.towns.forEach((t, i) => { if (agl < 400 && Math.hypot(t.x - SHIP.pos.x, t.z - SHIP.pos.z) < t.r * 1.3) visitedTowns.add(i); });
    if (visitedTowns.size >= 10) unlock('tour');
    WORLD.lakes.forEach((l, i) => { if (overWater && agl < 40 && Math.hypot(l.x - SHIP.pos.x, l.z - SHIP.pos.z) < l.r * 1.2) visitedLakes.add(i); });
    if (visitedLakes.size >= 3) unlock('lakes');
    for (const f of LIFE.flocks) if (f.pos.distanceTo(SHIP.pos) < 40) unlock('flock');
    for (const p of LIFE.planes) if (p.obj.position.distanceTo(SHIP.pos) < 400) unlock('spotter');
  }

  G.update = function (dt, cam) {
    camera = cam;
    for (const p of G.popups) p.t -= dt;
    G.popups = G.popups.filter(p => p.t > 0);
    if (G.toasts.length) { G.toasts[0].t -= dt; if (G.toasts[0].t <= 0) G.toasts.shift(); }
    // ring animation
    for (const r of G.rings) {
      if (r.fade !== undefined && r.fade > 0 && r.fade < 1) {
        r.fade = Math.min(1, r.fade + dt / 1.6);
        setRingFade(r, r.fade);
      }
    }
    for (const o of G.orbs) if (!o.taken) { o.mesh.rotation.y += dt * 2; o.mesh.rotation.x += dt; }
    if (G.state === 'menu') { prevPos.copy(SHIP.pos); return; }

    up.set(0, 1, 0).applyQuaternion(SHIP.quat);
    right.set(1, 0, 0).applyQuaternion(SHIP.quat);
    const speedKmh = SHIP.vel.length() * 3.6;
    const groundH = WORLD.heightAt(SHIP.pos.x, SHIP.pos.z);
    const overWater = groundH < 0;
    const agl = SHIP.agl;

    if (G.state === 'countdown') {
      const before = Math.ceil(G.countdown);
      G.countdown -= dt;
      if (Math.ceil(G.countdown) !== before && G.countdown > 0) popup(String(Math.ceil(G.countdown)), '#ffffff');
      if (G.countdown <= 0) { G.state = 'race'; popup('GO!', '#78ffaa'); }
      prevPos.copy(SHIP.pos);
      return;
    }

    stunts(dt, speedKmh, agl, overWater);

    if (G.state === 'race') {
      const before = Math.ceil(G.time);
      G.time -= dt; G.elapsed += dt;
      // the clock is running out: a beep at 5, 4, 3, 2 and 1 seconds left
      const now = Math.ceil(G.time);
      if (now !== before && now >= 1 && now <= 5 && G.time > 0) SFX.beep(now);
      // ring crossing: segment prevPos -> pos against the next ring's plane
      const r = G.rings[G.next];
      if (r) {
        const d0 = tmp.copy(prevPos).sub(r.pos).dot(r.n);
        const d1 = SHIP.pos.clone().sub(r.pos).dot(r.n);
        if (d0 < 0 && d1 >= 0) {
          const t = d0 / (d0 - d1);
          const hit = prevPos.clone().lerp(SHIP.pos, t);
          const dist = hit.distanceTo(r.pos);
          if (dist <= r.r) passRing(r, dist, speedKmh, agl);
          else if (dist < r.r * 4) missRing(r);
        }
      }
      for (const o of G.orbs) {
        if (o.taken) continue;
        if (o.pos.distanceTo(SHIP.pos) < 16) {
          o.taken = true; o.mesh.visible = false;
          G.time += 5; const b = Math.round(150 * G.cfg.mult); G.score += b; G.bonusLog.orbs += b;
          popup('TIME BONUS  +5 s  +' + b, '#ffd76b');
        }
      }
      if (G.time <= 0 && G.state === 'race') { G.time = 0; finishRace(false); }
    }
    prevPos.copy(SHIP.pos);

    // next ring marker for the HUD
    G.marker = null;
    if ((G.state === 'race') && G.rings[G.next]) {
      const rp = G.rings[G.next].pos;
      const v = rp.clone().project(camera);
      const behind = rp.clone().sub(camera.position).dot(camera.getWorldDirection(tmp)) < 0;
      G.marker = { x: v.x, y: v.y, behind, dist: rp.distanceTo(SHIP.pos) };
    }
  };

  // ---------------- HUD (drawn by hud.js) ----------------
  function fmtTime(t) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = t - m * 60;
    return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
  }

  G.drawHud = function (ctx, W, H) {
    const F = 'Bahnschrift, Segoe UI, sans-serif';
    if (G.mode === 'ring' && (G.state === 'race' || G.state === 'countdown')) {
      // panel under the heading tape
      const x = W / 2 - 180, y = 56;
      ctx.fillStyle = 'rgba(6,14,22,0.55)'; ctx.fillRect(x, y, 360, 52);
      ctx.strokeStyle = 'rgba(127,232,255,0.25)'; ctx.strokeRect(x + 0.5, y + 0.5, 359, 51);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left'; ctx.fillStyle = '#7fe8ff'; ctx.font = '600 11px ' + F;
      ctx.fillText('RING', x + 14, y + 19);
      ctx.fillStyle = '#fff'; ctx.font = '700 20px ' + F;
      ctx.fillText(Math.min(G.next + 1, G.rings.length) + ' / ' + G.rings.length, x + 14, y + 42);
      ctx.textAlign = 'center'; ctx.fillStyle = '#7fe8ff'; ctx.font = '600 11px ' + F;
      ctx.fillText('TIME', W / 2, y + 19);
      ctx.fillStyle = G.time < 10 ? (Math.floor(G.time * 4) % 2 ? '#ff6a50' : '#fff') : '#fff'; ctx.font = '700 26px ' + F;
      ctx.fillText(fmtTime(G.time), W / 2, y + 45);
      ctx.textAlign = 'right'; ctx.fillStyle = '#7fe8ff'; ctx.font = '600 11px ' + F;
      ctx.fillText('SCORE' + (G.combo > 1 ? '  COMBO ×' + G.combo : ''), x + 346, y + 19);
      ctx.fillStyle = '#ffcf6b'; ctx.font = '700 20px ' + F;
      ctx.fillText(G.score.toLocaleString('en-US'), x + 346, y + 42);
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(160,230,255,0.6)'; ctx.font = '600 11px ' + F;
      ctx.fillText(DIFF[G.diff].name.toUpperCase() + ' RING RUN', W / 2, y + 66);
    }
    // next ring marker
    if (G.marker) {
      const m = G.marker;
      let sx = (m.x * 0.5 + 0.5) * W, sy = (1 - (m.y * 0.5 + 0.5)) * H;
      const on = !m.behind && sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40;
      ctx.lineWidth = 2;
      if (on) {
        ctx.strokeStyle = '#ffc040';
        const s = 16;
        ctx.beginPath();
        ctx.moveTo(sx - s, sy - s + 6); ctx.lineTo(sx - s, sy - s); ctx.lineTo(sx - s + 6, sy - s);
        ctx.moveTo(sx + s - 6, sy - s); ctx.lineTo(sx + s, sy - s); ctx.lineTo(sx + s, sy - s + 6);
        ctx.moveTo(sx - s, sy + s - 6); ctx.lineTo(sx - s, sy + s); ctx.lineTo(sx - s + 6, sy + s);
        ctx.moveTo(sx + s - 6, sy + s); ctx.lineTo(sx + s, sy + s); ctx.lineTo(sx + s, sy + s - 6);
        ctx.stroke();
        ctx.fillStyle = '#ffc040'; ctx.font = '600 12px ' + F; ctx.textAlign = 'center';
        ctx.fillText(Math.round(m.dist) + ' m', sx, sy + s + 16);
      } else {
        // arrow at the screen edge pointing toward the ring
        let dx = sx - W / 2, dy = sy - H / 2;
        if (m.behind) { dx = -dx; dy = -dy; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1; }
        const ang = Math.atan2(dy, dx);
        const R = Math.min(W, H) * 0.36;
        const ax = W / 2 + Math.cos(ang) * R, ay = H / 2 + Math.sin(ang) * R;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.fillStyle = '#ffc040';
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#ffc040'; ctx.font = '600 12px ' + F; ctx.textAlign = 'center';
        ctx.fillText(Math.round(m.dist) + ' m', ax, ay + 26);
      }
    }
    // score popups: countdown digits big in the middle, the newest bonuses stacked under the race panel
    const small = G.popups.filter(p => !/^\d$|GO!/.test(p.text)).slice(-4);
    for (const p of G.popups) {
      const big = /^\d$|GO!/.test(p.text);
      if (!big && small.indexOf(p) < 0) continue;
      ctx.globalAlpha = Math.min(1, p.t / 0.4);
      ctx.textAlign = 'center'; ctx.fillStyle = p.color;
      ctx.font = (big ? '700 64px ' : '700 20px ') + F;
      ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
      const y = big ? H * 0.42 : 160 + (small.length - 1 - small.indexOf(p)) * 26 + (1.8 - p.t) * 6;
      ctx.fillText(p.text, W / 2, y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    // achievement toast
    if (G.toasts.length) {
      const t = G.toasts[0];
      const a = Math.min(1, t.t / 0.4, (5 - t.t) / 0.3);
      const w = 300, x = W - w - 16, y = 40;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = 'rgba(30,22,6,0.85)'; ctx.fillRect(x, y, w, 58);
      ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 57);
      ctx.textAlign = 'left'; ctx.fillStyle = '#ffcf6b'; ctx.font = '600 11px ' + F;
      ctx.fillText('★ ACHIEVEMENT UNLOCKED', x + 14, y + 18);
      ctx.fillStyle = '#fff'; ctx.font = '700 17px ' + F; ctx.fillText(t.title, x + 14, y + 37);
      ctx.fillStyle = '#c8b890'; ctx.font = '500 11px ' + F; ctx.fillText(t.desc, x + 14, y + 51);
      ctx.globalAlpha = 1;
    }
  };

  // ---------------- menus (HTML) ----------------
  const $ = (id) => document.getElementById(id);
  function hideMenus() {
    $('menu').classList.remove('show'); $('results').classList.remove('show');
    // back to the pilot's camera after the menu's cinematic orbit
    if (G.savedCam !== undefined) { SHIP.camMode = G.savedCam; G.savedCam = undefined; }
  }

  // Title-screen style menu: big items on the left (mouse or keyboard), an info card on the
  // right that follows the selection. Achievements appear only when their item is selected.
  // MENU.mode: 'main' (title screen) or 'pause' (same look, pause items)
  const MENU = { sel: 0, diff: 'normal', items: [], mode: 'main' };
  const DIFF_KEYS = ['easy', 'normal', 'hard'];
  const fmtN = (n) => n.toLocaleString('en-US');

  function canResume() { return G.prevState === 'free' || G.prevState === 'race' || G.prevState === 'countdown' || G.prevState === 'results'; }

  function inRace() { return G.prevState === 'race' || G.prevState === 'countdown'; }

  function menuItems() {
    const items = [];
    if (MENU.mode === 'pause') {
      items.push('resume');
      if (inRace()) items.push('restart');
      items.push('free', 'main', 'music', 'controls');
      return items;
    }
    if (canResume()) items.push('resume');
    items.push('free', 'ring');
    if (ONLINE.enabled) items.push('board');
    items.push('ach', 'music', 'controls');
    return items;
  }

  // subtitle of the pause screen: what was going on when the game was paused
  function pauseSubtitle() {
    if (inRace()) return DIFF[G.diff].name.toUpperCase() + ' RING RUN · RING ' + Math.min(G.next + 1, G.rings.length) + ' / ' + G.rings.length + ' · ' + fmtTime(G.time) + ' LEFT · ' + fmtN(G.score) + ' PTS';
    const h = Math.floor(ATMO.hours), m = Math.floor((ATMO.hours - h) * 60);
    return (G.prevState === 'results' ? 'RESULTS' : 'FREE FLIGHT') + ' · ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' · ' + Math.round(SHIP.pos.y) + ' M';
  }

  function infoCard(id) {
    const unlocked = ACH.filter(x => G.store.ach[x.id]);
    if (id === 'resume') {
      return '<h4>Resume</h4><p>Back to the cockpit, right where you left off.</p>' +
        (MENU.mode === 'pause' ? '<p class="small">Press <kbd>P</kbd> or <kbd>Esc</kbd> to resume at any time.</p>' : '');
    }
    if (id === 'restart') {
      const d = DIFF[G.diff];
      return '<h4>Restart Course <em>' + d.name + '</em></h4><p>Abandon this run and start a brand new ' + d.name.toLowerCase() + ' course from where you are now.</p>' +
        '<p class="small">The current score (' + fmtN(G.score) + ') is not saved.</p>';
    }
    if (id === 'main') {
      return '<h4>Main Menu</h4><p>Back to the title screen: game modes, difficulty and achievements.</p>' +
        (inRace() ? '<p class="small">The current run stays paused until you start something else or resume.</p>' : '');
    }
    if (id === 'free' && MENU.mode === 'pause' && inRace()) {
      return '<h4>Quit to Free Flight</h4><p>Leave the course and keep flying freely from here.</p>';
    }
    if (id === 'free') {
      return '<h4>Free Flight</h4><p>No clock, no rings: explore the island, its valleys, lakes and villages at your own pace. ' +
        'Many achievements can be earned just by flying.</p>' +
        '<ul class="facts"><li><b>22</b> villages</li><li><b>' + WORLD.lakes.length + '</b> lakes</li><li><b>32</b> km wide</li></ul>';
    }
    if (id === 'ring') {
      const d = DIFF[MENU.diff];
      const best = G.store.best[MENU.diff];
      const miss = d.missSkip ? (d.missPenalty ? 'skipped, −' + d.missPenalty + ' s' : 'skipped') : 'turn back for it';
      return '<h4>Ring Run <em>' + d.name + '</em></h4>' +
        '<p>Fly through the smoke rings in order before the clock runs out. Every ring adds time.</p>' +
        '<ul class="facts"><li><b>' + d.rings + '</b> rings</li><li><b>' + d.radius + ' m</b> radius</li><li><b>×' + d.mult + '</b> score</li></ul>' +
        '<p class="small">Missed ring: ' + miss + (d.orbs ? ' · ' + d.orbs + ' golden time orbs' : '') + '</p>' +
        '<p class="small">Bonus: bullseye combos, inverted and knife-edge passes, low and fast passes, barrel rolls and loops.</p>' +
        '<div class="best">' + (best ? 'BEST <b>' + fmtN(best) + '</b>' : 'NO RECORD YET') + '</div>';
    }
    if (id === 'ach') {
      const pct = Math.round(unlocked.length / ACH.length * 100);
      const recent = unlocked.sort((x, y) => G.store.ach[y.id] - G.store.ach[x.id]);
      return '<h4>Achievements <em>' + unlocked.length + ' / ' + ACH.length + '</em></h4>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="achs">' + ACH.map(x => {
          const on = !!G.store.ach[x.id];
          return '<div class="' + (on ? 'on' : '') + '"><b>' + (on ? '★ ' + x.name : x.name) + '</b><span>' + x.desc + '</span></div>';
        }).join('') + '</div>' +
        (recent.length ? '' : '<p class="small">None yet — they unlock as you fly.</p>');
    }
    if (id === 'board') {
      const d = MENU.diff, c = ONLINE.cache[d];
      if (!c && !ONLINE.errors[d]) {
        ONLINE.top(d).then(refreshBoardCard, refreshBoardCard);
        return '<h4>Leaderboard <em>' + DIFF[d].name + '</em></h4><p class="small">Loading…</p>';
      }
      if (!c) return '<h4>Leaderboard <em>' + DIFF[d].name + '</em></h4><p class="small">Leaderboard unavailable: ' + esc(ONLINE.errors[d]) + '</p>';
      return '<h4>Leaderboard <em>' + DIFF[d].name + '</em></h4>' + boardTable(c.entries, ONLINE.getName()) +
        '<p class="small">Best score of each pilot. Finish a Ring Run to submit yours.</p>';
    }
    if (id === 'music') {
      return '<h4>Music <em>' + (MUSIC.enabled ? 'ON' : 'OFF') + '</em></h4>' +
        '<p>Background track: “Cruising Altitude”.</p>' +
        '<p class="small">Press Enter (or ← →) to switch it on or off. In flight use <kbd>N</kbd>. The choice is remembered.</p>';
    }
    if (id === 'controls') {
      return '<h4>Controls</h4><ul class="keys">' +
        '<li><kbd>Mouse</kbd> click to capture: virtual stick</li>' +
        '<li><kbd>W</kbd><kbd>S</kbd> pitch · <kbd>A</kbd><kbd>D</kbd> roll · <kbd>Q</kbd><kbd>E</kbd> yaw</li>' +
        '<li><kbd>R</kbd><kbd>F</kbd> / wheel throttle · <kbd>Shift</kbd> boost</li>' +
        '<li><kbd>C</kbd> camera · <kbd>M</kbd> menu</li>' +
        '<li><kbd>T</kbd> +1 hour · <kbd>L</kbd> weather · <kbd>N</kbd> music · <kbd>H</kbd> full help</li></ul>';
    }
    return '';
  }

  // leaderboard helpers
  function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
  function boardTable(entries, me) {
    if (!entries.length) return '<p class="small">No scores yet: be the first!</p>';
    const low = (me || '').toLowerCase();
    return '<table class="board">' + entries.map(e =>
      '<tr class="' + (e.name.toLowerCase() === low ? 'me' : '') + '"><td>' + e.rank + '</td><td>' + esc(e.name) +
      '<i>' + e.rings + '/' + e.total + ' rings · ' + fmtTime(e.time_ms / 1000) + (e.finished ? '' : ' · out of time') + '</i></td><td>' + fmtN(e.score) + '</td></tr>').join('') + '</table>';
  }
  function refreshBoardCard() {
    if (G.state === 'menu' && MENU.items[MENU.sel] === 'board') { MENU.shown = null; renderMenu(); }
  }

  const LABEL = { board: 'Leaderboard', resume: 'Resume', restart: 'Restart Course', free: 'Free Flight', main: 'Main Menu', ring: 'Ring Run', ach: 'Achievements', music: 'Music', controls: 'Controls' };
  G.refreshMenu = function () { if (G.state === 'menu') renderMenu(); };

  function itemHtml(id, i, nAch) {
    let extra = '';
    if (id === 'ring' || id === 'board') extra = '<span class="diff"><a data-d="-1">◀</a><u>' + DIFF[MENU.diff].name + '</u><a data-d="1">▶</a></span>';
    if (id === 'ach') extra = '<span class="count">' + nAch + ' / ' + ACH.length + '</span>';
    if (id === 'music') extra = '<span class="count">' + (MUSIC.enabled ? 'ON' : 'OFF') + '</span>';
    const label = id === 'free' && MENU.mode === 'pause' && inRace() ? 'Quit to Free Flight' : LABEL[id];
    return '<span class="lbl">' + label + '</span>' + extra;
  }

  // The menu DOM is built once when it opens (with its entrance animation); moving through it
  // only updates the selected item and the info card, so nothing re-animates or flashes.
  function renderMenu(full) {
    const items = menuItems();
    MENU.sel = Math.max(0, Math.min(MENU.sel, items.length - 1));
    const nAch = ACH.filter(x => G.store.ach[x.id]).length;
    const ul = $('menu').querySelector('.items');
    if (full || !ul || items.join() !== MENU.items.join() || $('menu').dataset.mode !== MENU.mode) {
      MENU.items = items;
      MENU.shown = null;
      const list = items.map((id, i) => '<li data-i="' + i + '" class="' + (i === MENU.sel ? 'sel' : '') + '">' + itemHtml(id, i, nAch) + '</li>').join('');
      $('menu').innerHTML =
        '<div class="mv-left">' +
        (MENU.mode === 'pause'
          ? '<div class="logo pause">PAUSED<small>' + pauseSubtitle() + '</small></div>'
          : '<div class="logo">SKYWARD<small>SU-35 · FLIGHT · RING RUN</small></div>') +
        '<ul class="items">' + list + '</ul>' +
        '<div class="foot"><kbd>↑</kbd><kbd>↓</kbd> select &nbsp; ' + (MENU.mode === 'main' ? '<kbd>←</kbd><kbd>→</kbd> difficulty &nbsp; ' : '') + '<kbd>Enter</kbd> confirm' +
        (canResume() ? ' &nbsp; <kbd>' + (MENU.mode === 'pause' ? 'P' : 'M') + '</kbd> resume' : '') + '</div>' +
        '</div>' +
        '<div class="mv-info"></div>';
      $('menu').querySelectorAll('.items li').forEach((li, i) => { li.dataset.h = itemHtml(items[i], i, nAch); });
      $('menu').dataset.mode = MENU.mode;
    } else {
      ul.querySelectorAll('li').forEach((li, i) => {
        li.classList.toggle('sel', i === MENU.sel);
        const html = itemHtml(items[i], i, nAch);
        if (li.dataset.h !== html) { li.innerHTML = html; li.dataset.h = html; }
      });
    }
    // info card: content only (the card itself stays put)
    const id = MENU.items[MENU.sel];
    const card = infoCard(id);
    if (MENU.shown !== card) { $('menu').querySelector('.mv-info').innerHTML = card; MENU.shown = card; }
  }

  function menuConfirm() {
    const id = MENU.items[MENU.sel];
    if (id === 'music') SFX.tick();
    else if (id !== 'resume' && id !== 'ach') SFX.select();
    if (id === 'resume') G.toggleMenu();
    else if (id === 'restart') G.startRace(G.diff);
    else if (id === 'main') { MENU.mode = 'main'; MENU.sel = 0; renderMenu(true); }
    else if (id === 'free') G.startFree();
    else if (id === 'ring') G.startRace(MENU.diff);
    else if (id === 'music') { MUSIC.toggle(); renderMenu(); }
    else if (id === 'controls') { const h = $('help'); h.classList.toggle('show'); }
  }
  function menuDiff(step) {
    const i = DIFF_KEYS.indexOf(MENU.diff);
    MENU.diff = DIFF_KEYS[(i + step + 3) % 3];
    SFX.tick();
    renderMenu();
  }

  function onMenuKey(e) {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return; // typing a name
    if (onResultsKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (G.state !== 'menu') return;
    const c = e.code;
    if (c === 'ArrowUp' || c === 'KeyW') { MENU.sel = (MENU.sel + MENU.items.length - 1) % MENU.items.length; SFX.move(); renderMenu(); }
    else if (c === 'ArrowDown' || c === 'KeyS') { MENU.sel = (MENU.sel + 1) % MENU.items.length; SFX.move(); renderMenu(); }
    else if ((c === 'ArrowLeft' || c === 'KeyA') && (MENU.items[MENU.sel] === 'ring' || MENU.items[MENU.sel] === 'board')) menuDiff(-1);
    else if ((c === 'ArrowRight' || c === 'KeyD') && (MENU.items[MENU.sel] === 'ring' || MENU.items[MENU.sel] === 'board')) menuDiff(1);
    else if ((c === 'ArrowLeft' || c === 'ArrowRight' || c === 'KeyA' || c === 'KeyD') && MENU.items[MENU.sel] === 'music') menuConfirm();
    else if (c === 'Enter' || c === 'Space') { menuConfirm(); }
    else if (c === 'Escape' && canResume()) G.toggleMenu();
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onMenuMouse(e) {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const i = +li.dataset.i;
    if (e.type === 'mouseover') { if (i !== MENU.sel) { MENU.sel = i; SFX.move(); renderMenu(); } return; }
    e.stopPropagation();
    const d = e.target.closest('a[data-d]');
    if (d) { MENU.sel = i; menuDiff(+d.dataset.d); return; }
    MENU.sel = i;
    menuConfirm();
  }

  G.showMenu = function (mode) {
    G.prevState = G.state === 'menu' ? G.prevState : G.state;
    G.state = 'menu';
    MENU.mode = mode || 'main';
    MENU.sel = 0;
    if (G.diff) MENU.diff = G.diff;
    renderMenu(true);
    // the menu background is a slow cinematic orbit around the ship
    if (G.savedCam === undefined) { G.savedCam = SHIP.camMode; SHIP.camMode = 2; }
    $('menu').classList.add('show');
    $('results').classList.remove('show');
    $('help').classList.remove('show');
    if (document.pointerLockElement) document.exitPointerLock();
  };

  // Pause: the same title-screen look with pause items. P toggles it; it also opens by itself
  // when the window loses focus during a flight.
  G.togglePause = function () {
    if (G.state === 'menu') { if (MENU.mode === 'pause') G.toggleMenu(); return; }
    SFX.open();
    G.showMenu('pause');
  };
  G.isPaused = function () { return G.state === 'menu' && MENU.mode === 'pause'; };

  G.toggleMenu = function () {
    if (G.state === 'menu') {
      if (canResume()) {
        SFX.back();
        G.state = G.prevState;
        hideMenus();
        $('help').classList.remove('show');
        if (G.state === 'results') $('results').classList.add('show');
      }
    } else { SFX.open(); G.showMenu(); }
  };

  // Results screen, same title-screen style as the main menu. The ship keeps flying behind it,
  // so only the arrow keys and Enter drive it (W/S/Space stay with the flight controls).
  const RES = { sel: 0, items: [] };

  function showResults() {
    const R = G.result, L = G.bonusLog;
    const best = G.store.best[G.diff] || 0;
    RES.sel = 0;
    RES.items = [
      { m: G.diff, label: 'Retry', hint: 'New ' + DIFF[G.diff].name.toLowerCase() + ' course' },
      { m: 'free', label: 'Free Flight', hint: 'Keep exploring' },
      { m: 'menu', label: 'Menu', hint: 'Modes · achievements' }
    ];
    const row = (k, v, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + k + '</td><td>' + v + '</td></tr>';
    $('results').innerHTML =
      '<div class="mv-left">' +
      '<div class="logo res' + (R.ok ? '' : ' fail') + '">' + (R.ok ? 'COURSE COMPLETE' : 'OUT OF TIME') +
      '<small>' + DIFF[G.diff].name.toUpperCase() + ' RING RUN · ' + G.next + ' / ' + G.rings.length + ' RINGS · ' + fmtTime(G.elapsed) + '</small></div>' +
      '<div class="bigscore"><span>SCORE</span><b>' + fmtN(G.score) + '</b>' +
      (R.record ? '<em class="rec">★ NEW RECORD</em>' : '<em>' + (best ? 'BEST ' + fmtN(best) : 'NO RECORD YET') + '</em>') + '</div>' +
      '<ul class="items">' + RES.items.map((it, i) =>
        '<li data-r="' + i + '" class="' + (i === 0 ? 'sel' : '') + '"><span class="lbl">' + it.label + '</span><span class="count">' + it.hint + '</span></li>').join('') + '</ul>' +
      '<div class="foot"><kbd>↑</kbd><kbd>↓</kbd> select &nbsp; <kbd>Enter</kbd> confirm &nbsp; <kbd>M</kbd> menu</div>' +
      '</div>' +
      '<div class="mv-info"><h4>Score breakdown</h4><table class="breakdown">' +
      row('Rings', fmtN(L.rings)) +
      row('Bullseyes (' + G.bullseyes + ')', fmtN(L.bullseye)) +
      row('Style passes', fmtN(L.style)) +
      row('Stunts', fmtN(L.stunts)) +
      row('Time orbs', fmtN(L.orbs)) +
      row('Time left bonus', fmtN(R.timeBonus)) +
      row('Clean run' + (R.clean ? '' : ' <i>' + G.misses + ' missed · ' + G.crashes + ' crashes</i>'), fmtN(R.cleanBonus)) +
      row('Total', fmtN(G.score), 'tot') +
      '</table>' +
      (ONLINE.enabled && G.score > 0 ?
        '<div class="online"><h4>Online leaderboard</h4>' +
        '<div class="send"><input id="lbName" maxlength="16" placeholder="Your pilot name" value="' + esc(ONLINE.getName()) + '" autocomplete="nickname" spellcheck="false">' +
        '<button id="lbSend">Submit</button></div>' +
        '<p class="small" id="lbMsg"></p><div id="lbTable"></div></div>' : '') +
      '</div>';
    $('results').classList.add('show');
    if (ONLINE.enabled && G.score > 0) setupSubmit();
  }

  // name field + submit button of the results screen
  function setupSubmit() {
    const input = $('lbName'), btn = $('lbSend'), msg = $('lbMsg'), table = $('lbTable');
    const diff = G.diff;
    const run = {
      difficulty: diff, score: G.score,
      rings: G.rings.filter(r => r.passed && !r.missed).length, totalRings: G.rings.length,
      timeMs: Math.round(G.elapsed * 1000), finished: !!G.result.ok
    };
    const show = (entries, me) => { table.innerHTML = boardTable(entries, me); };
    ONLINE.top(diff).then(e => show(e, ONLINE.getName()), () => { msg.textContent = 'Leaderboard unavailable right now.'; });
    // typing must not fly the jet or drive the menu
    ['keydown', 'keyup'].forEach(t => input.addEventListener(t, e => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Enter') send(); }));
    btn.addEventListener('click', (e) => { e.stopPropagation(); send(); });
    let busy = false;
    async function send() {
      if (busy || btn.disabled) return;
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!ONLINE.validName(name)) { msg.textContent = 'Name: 2–16 letters, digits, spaces, _ . -'; return; }
      busy = true; btn.disabled = true; msg.textContent = 'Sending…';
      try {
        const res = await ONLINE.submit(Object.assign({ name }, run));
        ONLINE.setName(name);
        msg.innerHTML = 'Submitted! You are <b>#' + res.rank + '</b> on ' + DIFF[diff].name + (res.best > G.score ? ' (your best: ' + fmtN(res.best) + ')' : '') + '.';
        show(res.entries, name);
        input.disabled = true;
        SFX.select();
      } catch (err) {
        msg.textContent = 'Not sent: ' + err.message;
        btn.disabled = false;
      }
      busy = false;
    }
  }

  function resSelect(i) {
    if (i === RES.sel) return;
    RES.sel = i;
    $('results').querySelectorAll('.items li').forEach((li, k) => li.classList.toggle('sel', k === i));
    SFX.move();
  }
  function resConfirm() {
    const m = RES.items[RES.sel].m;
    if (m === 'menu') SFX.back(); else SFX.select();
    if (m === 'free') G.startFree();
    else if (m === 'menu') G.showMenu();
    else G.startRace(m);
  }
  function onResultsMouse(e) {
    const li = e.target.closest('li[data-r]');
    if (!li) return;
    if (e.type === 'mouseover') { resSelect(+li.dataset.r); return; }
    e.stopPropagation();
    resSelect(+li.dataset.r);
    resConfirm();
  }
  function onResultsKey(e) {
    if (G.state !== 'results' || !$('results').classList.contains('show')) return false;
    const c = e.code, n = RES.items.length;
    if (c === 'ArrowUp') resSelect((RES.sel + n - 1) % n);
    else if (c === 'ArrowDown') resSelect((RES.sel + 1) % n);
    else if (c === 'Enter') resConfirm();
    else return false;
    return true;
  }

  G.init = function (sc, ov) {
    scene = sc; overlay = ov;
    scene.add(ringGroup);
    initSmoke();
    load();
    $('menu').addEventListener('click', onMenuMouse);
    $('menu').addEventListener('mouseover', onMenuMouse);
    $('results').addEventListener('click', onResultsMouse);
    $('results').addEventListener('mouseover', onResultsMouse);
    window.addEventListener('keydown', onMenuKey, true); // capture: menu keys do not reach the flight controls
  };

  G.ACH = ACH;
  window.GAME = G;
})();
