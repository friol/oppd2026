// Particle effects: drift sparks, boost flames, dust, smoke, explosions.
'use strict';

// Sound effects: pools of <audio> elements (they also work from file://)
const Sfx = {
  pools: {},
  load(name, src, voices) {
    const list = [];
    for (let i = 0; i < voices; i++) {
      const a = new Audio(src);
      a.preload = 'auto';
      list.push(a);
    }
    this.pools[name] = { list, next: 0 };
  },
  play(name, volume) {
    const p = this.pools[name];
    if (!p || volume <= 0.02) return;
    const a = p.list[p.next];
    p.next = (p.next + 1) % p.list.length;
    try {
      a.pause();
      a.currentTime = 0;
      a.volume = clamp(volume, 0, 1);
      const r = a.play();
      if (r && r.catch) r.catch(() => { });   // blocked until the first user gesture
    } catch (e) { }
  }
};
Sfx.load('nitro', 'soundfx/nitro.mp3', 6);
// "three, two, one" one second apart, made from the original three.two.one sample: "fight" cut off, echo added
Sfx.load('countdown', 'soundfx/countdown.mp3', 1);
// "Get ready": plays at the start of the intro, before the countdown (3.7 s, like the intro)
Sfx.load('getready', 'soundfx/get.ready.mp3', 1);
Sfx.load('finish', 'soundfx/finish.mp3', 1);   // the player crosses the finish line
Sfx.load('lap2', 'soundfx/lap2.mp3', 1);       // the player finishes lap 1 (starts lap 2)
Sfx.load('lap3', 'soundfx/lap3.mp3', 1);       // the player finishes lap 2 (starts lap 3)
// Fade a sound out and stop it (e.g. when the intro is skipped)
Sfx.fadeOut = function (name, sec) {
  const p = this.pools[name];
  if (!p) return;
  for (const a of p.list) {
    if (a.paused) continue;
    const v0 = a.volume, t0 = performance.now();
    clearInterval(a._fade);
    a._fade = setInterval(() => {
      const k = (performance.now() - t0) / (sec * 1000);
      if (k >= 1) { clearInterval(a._fade); a.pause(); a.currentTime = 0; a.volume = v0; } else a.volume = v0 * (1 - k);
    }, 16);
  }
};
// "GO!" with lots of echo, made from go.dry.mp3 (see CLAUDE.md)
Sfx.load('go', 'soundfx/go.mp3', 1);
Sfx.load('splat', 'soundfx/splat.mp3', 4);
Sfx.load('explosion', 'soundfx/explosion.mp3', 4);
Sfx.load('gem', 'soundfx/gem.mp3', 4);   // item pickup: hexaedron.mp3 with echo (tools/gem_echo.py)
Sfx.load('drift', 'soundfx/drift.mp3', 6);   // start of a skid (the loop is drift_loop.mp3)
// One-shot at a world position: full volume within 10 m of the camera, silent beyond ~100 m
Sfx.playAt = function (name, pos, cam, volume, range) {
  const d = cam ? Math.hypot(cam.x - pos.x, cam.y - pos.y, cam.z - pos.z) : 0;
  this.play(name, volume * clamp(1 - (d - 10) / ((range || 100) - 10), 0, 1));
};

// Looping sounds (one <audio> each), e.g. the shield hum of every car
Sfx.loops = new Set();
Sfx.loop = function (src) {
  const a = new Audio(src);
  a.loop = true;
  a.preload = 'auto';
  Engine.routeElement(a);
  const h = {
    on: false, el: a,
    set(volume) {
      if (volume > 0.02) {
        a.volume = clamp(volume, 0, 1);
        if (!h.on || a.paused) {
          h.on = true;
          const r = a.play();
          if (r && r.catch) r.catch(() => { h.on = false; });
        }
      } else h.stop();
    },
    stop() { if (h.on) { h.on = false; a.pause(); a.currentTime = 0; } },
    pause() { if (h.on) { a.pause(); h.on = false; } },
    dispose() { h.stop(); Sfx.loops.delete(h); }
  };
  Sfx.loops.add(h);
  return h;
};
// Routes the elements that exist before the audio context (the pools) through the reverb bus
Sfx.attach = function () {
  for (const k in this.pools) for (const a of this.pools[k].list) Engine.routeElement(a);
  for (const h of this.loops) Engine.routeElement(h.el);
};
Sfx.pauseLoops = function () { for (const h of Sfx.loops) h.pause(); };
// One-shot sounds during the pause menu: suspend, then resume or stop
Sfx.suspend = function () {
  for (const k in this.pools) for (const a of this.pools[k].list) if (!a.paused) { a.pause(); a._resume = true; }
};
Sfx.resume = function () {
  for (const k in this.pools) for (const a of this.pools[k].list) if (a._resume) { a._resume = false; const r = a.play(); if (r && r.catch) r.catch(() => { }); }
};
Sfx.stopAll = function () {
  for (const k in this.pools) for (const a of this.pools[k].list) { a._resume = false; a.pause(); }
  this.pauseLoops();
};

// Fragment shader of the soft smoke puffs: round falloff broken up by value noise (rotated
// by a per-particle seed, so no two puffs look alike), lit from above
const SMOKE_FRAG = `varying vec4 vC; varying float vS;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main(){
    vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
    float a = vS * 6.2832; vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
    float nz = n(q * 4.0 + vS * 17.0) * 0.6 + n(q * 9.0 - vS * 5.0) * 0.4;
    float m = 1.0 - smoothstep(0.12, 0.5, d + (nz - 0.5) * 0.32);
    float shade = 0.82 + 0.36 * (0.5 - p.y) + (nz - 0.5) * 0.25;
    gl_FragColor = vec4(vC.rgb * shade, vC.a * m * m);
  }`;

// Race music: one <audio> element (works from file://), looping, with fades.
// M toggles it; the choice is remembered in localStorage (kario18:music).
const Music = {
  el: null, src: null, target: 0, vol: 0, VOL: 0.45, old: null, oldVol: 0,
  on: (() => { try { return localStorage.getItem('kario18:music') !== 'off'; } catch (e) { return true; } })(),
  play(src) {
    if (!src) { this.fadeOut(); return; }     // a track without music: the current one fades out
    if (this.src !== src || !this.el) {
      // another track: the old one fades out while the new one fades in
      if (this.old) this.old.pause();
      this.old = null;
      if (this.el && !this.el.paused) { this.old = this.el; this.oldVol = this.vol; }
      this.el = new Audio(src);
      this.el.loop = true;
      this.src = src;
      this.vol = 0;
      this.el.volume = 0;
    }
    this.target = this.VOL;
    this.resume();
  },
  resume() {
    if (!this.el || !this.on || this.target <= 0) return;
    const r = this.el.play();
    if (r && r.catch) r.catch(() => { });
  },
  pause() { if (this.el) this.el.pause(); if (this.old) { this.old.pause(); this.old = null; } },
  fadeOut() { this.target = 0; },
  stop() { this.target = 0; this.vol = 0; if (this.el) { this.el.pause(); this.el.currentTime = 0; } },
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('kario18:music', this.on ? 'on' : 'off'); } catch (e) { }
    if (this.on) this.resume(); else this.pause();
    return this.on;
  },
  update(dt) {
    if (this.old) {
      this.oldVol -= dt * 0.6;
      if (this.oldVol <= 0.001) { this.old.pause(); this.old = null; } else this.old.volume = clamp(this.oldVol, 0, 1);
    }
    if (!this.el) return;
    this.vol += clamp(this.target - this.vol, -dt * 0.6, dt * 0.6);   // ~0.75 s fades
    this.el.volume = clamp(this.vol, 0, 1);
    if (this.vol <= 0.001 && this.target === 0 && !this.el.paused) this.el.pause();
  }
};

class ParticleSystem {
  // mode: true = additive glow, false = solid toon dots, 'smoke' = soft puffs
  constructor(scene, max, additive) {
    const smoke = additive === 'smoke';
    if (smoke) additive = false;
    this.smoke = smoke;
    this.max = max;
    this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.seed = new Float32Array(max);
    g.setAttribute('pseed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { scale: { value: 500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 pcolor; attribute float psize; attribute float pseed; uniform float scale; varying vec4 vC; varying float vS;
        void main(){ vC = pcolor; vS = pseed; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = psize * scale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: smoke ? SMOKE_FRAG : additive
        ? `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
           float a = smoothstep(0.5, 0.1, d); gl_FragColor = vec4(vC.rgb * a * vC.a, 1.0); }`
        : `varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
           float rim = step(0.4, d); gl_FragColor = vec4(mix(vC.rgb, vC.rgb * 0.7, rim), vC.a); }`
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.geo = g;
    scene.add(this.points);
  }
  add(p) {
    if (Q.particles < 1 && Math.random() > Q.particles) return;   // Low: half of the particles
    if (this.list.length >= this.max) this.list.shift();
    p.age = 0;
    if (p.seed === undefined) p.seed = Math.random();
    this.list.push(p);
  }
  update(dt, cam, h) {
    this.uniforms.scale.value = h / (2 * Math.tan(cam.fov * Math.PI / 360));
    const L = this.list;
    let w = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vy -= (p.grav || 0) * dt;
      const dr = 1 - damp(p.drag || 0, dt);
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      if (p.turb) {   // random swirl
        p.vx += (Math.random() - 0.5) * p.turb * dt; p.vy += (Math.random() - 0.3) * p.turb * 0.5 * dt; p.vz += (Math.random() - 0.5) * p.turb * dt;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      L[w++] = p;
    }
    L.length = w;
    for (let i = 0; i < w; i++) {
      const p = L[i], t = p.age / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.col[i * 4] = p.r; this.col[i * 4 + 1] = p.g; this.col[i * 4 + 2] = p.b;
      if (p.soft) {
        // smoke: quick fade in, long fade out, grows fast then slows down
        this.col[i * 4 + 3] = p.a * Math.min(1, t * 12) * Math.pow(1 - t, 1.6);
        this.size[i] = lerp(p.s0, p.s1, 1 - (1 - t) * (1 - t));
      } else {
        this.col[i * 4 + 3] = p.a * (1 - t * t);
        this.size[i] = lerp(p.s0, p.s1, t);
      }
      this.seed[i] = p.seed;
    }
    this.geo.setDrawRange(0, w);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
    this.geo.attributes.pseed.needsUpdate = true;
  }
  clear() { this.list.length = 0; this.geo.setDrawRange(0, 0); }
}

// Permanent tyre marks: one dynamic mesh, ring buffer of quads shared by every car.
// Each wheel continues its own strip (the new quad starts on the last quad's end edge).
class SkidMarks {
  constructor(scene, max) {
    this.max = max || 12000;
    this.pos = new Float32Array(this.max * 4 * 3);
    this.col = new Float32Array(this.max * 4 * 4);
    const idx = new Uint32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) {
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.clear();
  }
  clear() {
    this.next = 0; this.count = 0; this.dirtyMin = Infinity; this.dirtyMax = -1;
    this.geo.setDrawRange(0, 0);
  }
  // strip = per-wheel state object {x, z, y, lx, lz, rx, rz, on}; returns nothing
  mark(strip, x, y, z, alpha, width) {
    if (!strip.on) {
      // start a new strip: just remember the point
      strip.on = true; strip.x = x; strip.y = y; strip.z = z; strip.edge = null;
      return;
    }
    const dx = x - strip.x, dz = z - strip.z, len = Math.hypot(dx, dz);
    if (len < 0.45) return;
    if (len > 6) { strip.x = x; strip.y = y; strip.z = z; strip.edge = null; return; }   // teleport / respawn
    const hw = width / 2, px = -dz / len * hw, pz = dx / len * hw;
    const e0 = strip.edge || [strip.x - px, strip.y, strip.z - pz, strip.x + px, strip.y, strip.z + pz];
    const e1 = [x - px, y, z - pz, x + px, y, z + pz];
    const q = this.next, o = q * 12;
    this.pos.set(e0, o); this.pos.set(e1, o + 6);
    const a0 = strip.alpha === undefined ? alpha : strip.alpha;
    const c = q * 16, k = 0.007;   // linear: dark rubber
    this.col.set([k, k, k, a0, k, k, k, a0, k, k, k, alpha, k, k, k, alpha], c);
    strip.edge = e1; strip.alpha = alpha;
    strip.x = x; strip.y = y; strip.z = z;
    this.dirtyMin = Math.min(this.dirtyMin, q); this.dirtyMax = Math.max(this.dirtyMax, q);
    this.next = (q + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
  }
  end(strip) { strip.on = false; strip.edge = null; strip.alpha = undefined; }
  update() {
    if (this.dirtyMax < 0) return;
    const lo = this.dirtyMin, hi = this.dirtyMax;
    this.posAttr.updateRange.offset = lo * 12; this.posAttr.updateRange.count = (hi - lo + 1) * 12;
    this.colAttr.updateRange.offset = lo * 16; this.colAttr.updateRange.count = (hi - lo + 1) * 16;
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
    this.geo.setDrawRange(0, this.count * 6);
    this.dirtyMin = Infinity; this.dirtyMax = -1;
  }
}

class FX {
  constructor(scene) {
    this.glow = new ParticleSystem(scene, 1600, true);
    this.solid = new ParticleSystem(scene, 1400, false);
    this.smokeSys = new ParticleSystem(scene, 1800, 'smoke');
    this.c = new THREE.Color();
  }
  rgb(hex) { this.c.set(hex); return this.c; }
  spark(x, y, z, hex, vx, vz) {
    const c = this.rgb(hex);
    this.glow.add({ x, y, z, vx: vx + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, vz: vz + (Math.random() - 0.5) * 3,
      grav: 14, drag: 1, life: 0.3 + Math.random() * 0.2, s0: 0.45, s1: 0.1, r: c.r, g: c.g, b: c.b, a: 1 });
  }
  flame(x, y, z, vx, vz) {
    const hot = Math.random() < 0.5;
    this.glow.add({ x, y, z, vx: vx + (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, vz: vz + (Math.random() - 0.5) * 2,
      drag: 2, life: 0.22, s0: 0.9, s1: 0.2, r: 1, g: hot ? 0.85 : 0.45, b: hot ? 0.3 : 0.08, a: 1 });
  }
  dust(x, y, z, hex) {
    const c = this.rgb(hex).clone().multiplyScalar(0.85);
    this.solid.add({ x: x + (Math.random() - 0.5), y, z: z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 3, vy: 1.5 + Math.random() * 2, vz: (Math.random() - 0.5) * 3,
      grav: 3, drag: 1.5, life: 0.55, s0: 0.5, s1: 1.1, r: c.r, g: c.g, b: c.b, a: 0.7 });
  }
  // Streak of air: a fast, very short-lived, stretched-looking dot that flies backwards
  streak(x, y, z, vx, vz) {
    for (let i = 0; i < 4; i++) {
      this.glow.add({ x: x - vx * 0.012 * i, y, z: z - vz * 0.012 * i, vx, vy: 0, vz, drag: 0, life: 0.16, s0: 0.12, s1: 0.04, r: 0.5, g: 0.55, b: 0.6, a: 0.55 - i * 0.1 });
    }
  }
  // Soft billowing smoke (same soft puffs as the exhaust). grey: 0 = black .. 1 = white
  // tint = [r, g, b] multipliers (a brownish dust cloud, for instance)
  puff(x, y, z, vx, vy, vz, grey, size, life, alpha, tint) {
    const g = lin(clamp(grey + (Math.random() - 0.5) * 0.08, 0, 1));
    this.smokeSys.add({ x, y, z, vx, vy, vz, grav: -1.2, drag: 1.6, turb: 6, soft: true,
      life: life * (0.8 + Math.random() * 0.4), s0: size * 0.35, s1: size * (0.9 + Math.random() * 0.5),
      r: g * (tint ? tint[0] : 1), g: g * (tint ? tint[1] : 1), b: g * (tint ? tint[2] : 1.03), a: alpha });
  }
  // Generic smoke column (rocket trail, kept for compatibility)
  smoke(x, y, z) {
    this.puff(x, y, z, (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.6, 2.4, 1.4, 0.35);
  }
  burst(x, y, z, hex, n, spd) {
    const c = this.rgb(hex);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, s = spd * (0.4 + Math.random() * 0.6);
      this.glow.add({ x, y, z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 2, vz: Math.sin(a) * Math.cos(e) * s,
        grav: 9, drag: 1.5, life: 0.5 + Math.random() * 0.4, s0: 0.8, s1: 0.2, r: c.r, g: c.g, b: c.b, a: 1 });
    }
  }
  explosion(x, y, z) {
    this.burst(x, y, z, 0xffb030, 40, 16);
    this.burst(x, y, z, 0xffffff, 12, 9);
    // dark billowing cloud: fast at first, then rising and swelling
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      this.puff(x + Math.cos(a) * 0.6, y + Math.random() * 0.8, z + Math.sin(a) * 0.6,
        Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.12 + Math.random() * 0.2, 4.6, 2.4, 0.62);
    }
    // a lighter top, lit by the fire
    for (let i = 0; i < 8; i++) {
      this.puff(x, y + 1, z, (Math.random() - 0.5) * 3, 4 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.55, 4.5, 2.2, 0.45);
    }
  }
  // Exhaust smoke puff: leaves the pipe backwards, keeps part of the car's speed, slows down,
  // rises, swells and swirls. dark: 0 = light grey, 1 = rich dark smoke
  exhaust(x, y, z, vx, vy, vz, dark, strength) {
    const g = lin(lerp(0.78, 0.42, dark) + (Math.random() - 0.5) * 0.06);
    this.smokeSys.add({ x, y, z,
      vx: vx + (Math.random() - 0.5) * 0.8, vy: vy + 0.4 + Math.random() * 0.5, vz: vz + (Math.random() - 0.5) * 0.8,
      grav: -0.6, drag: 2.2, turb: 5, soft: true,
      life: 1.1 + Math.random() * 0.8, s0: 0.25, s1: 1.6 + Math.random() * 1.2 + strength * 0.8,
      r: g, g: g, b: g * 1.04, a: 0.22 + 0.3 * strength });
  }
  update(dt, cam, h) { this.glow.update(dt, cam, h); this.solid.update(dt, cam, h); this.smokeSys.update(dt, cam, h); }
  clear() { this.glow.clear(); this.solid.clear(); this.smokeSys.clear(); }
}
