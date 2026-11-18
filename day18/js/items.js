// Power-ups: item boxes, boost pads, rockets, oil slicks, shields.
'use strict';

const ITEM_INFO = {
  turbo: { label: 'TURBO', icon: 'turbo' },
  rocket: { label: 'ROCKET', icon: 'rocket' },
  oil: { label: 'OIL SLICK', icon: 'oil' },
  shield: { label: 'SHIELD', icon: 'shield' }
};
const ITEM_KEYS = Object.keys(ITEM_INFO);

// Weighted pick: leaders get defensive items, stragglers get offensive ones
function pickItem(place, total) {
  const r = (place - 1) / Math.max(1, total - 1);   // 0 = first, 1 = last
  const w = {
    turbo: 12 + r * 40,
    rocket: place === 1 ? 0 : 10 + r * 30,
    oil: 40 - r * 30,
    shield: 26 - r * 10
  };
  let sum = 0;
  for (const k of ITEM_KEYS) sum += w[k];
  let x = Math.random() * sum;
  for (const k of ITEM_KEYS) { x -= w[k]; if (x <= 0) return k; }
  return 'turbo';
}

const _v = new THREE.Vector3();

// Item gem: translucent glass with thin-film iridescence. Each facet has its own hue (from
// its normal), the hues drift with the view angle and time; bright fresnel rim, a sparkle
// on the facets facing the sun, a slow pulse (per-gem phase from its position). Drawn as
// back faces (dim, the inside) and then front faces.
const GEM_VERT = `varying vec3 vN; varying vec3 vV; varying vec3 vNo; varying float vPh;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal); vNo = normal; vV = normalize(cameraPosition - w.xyz);
    vPh = fract(dot(modelMatrix[3].xyz, vec3(0.131, 0.071, 0.113)));
    gl_Position = projectionMatrix * viewMatrix * w; }`;
const GEM_FRAG = `uniform float time; uniform float back;
  varying vec3 vN; varying vec3 vV; varying vec3 vNo; varying float vPh;
  void main(){
    vec3 N = normalize(vN), V = normalize(vV);
    float ndv = abs(dot(N, V));
    float fres = pow(1.0 - ndv, 2.2);
    float facet = fract(dot(normalize(vNo), vec3(1.7, 2.3, 3.1)) * 3.7);
    float ph = facet + ndv * 1.4 + time * 0.22 + vPh;
    vec3 film = 0.5 + 0.5 * cos(6.2832 * (ph + vec3(0.0, 0.33, 0.67)));
    float pulse = 0.78 + 0.22 * sin(time * 4.0 + vPh * 6.2832);
    vec3 L = normalize(vec3(-0.45, 0.8, 0.35));
    float spark = pow(max(dot(reflect(-V, N), L), 0.0), 40.0);
    vec3 col = mix(film, vec3(1.0), fres * 0.45) * (0.6 + 0.8 * fres) * pulse + spark * 1.2;
    float a = (0.52 + 0.42 * fres + spark) * mix(1.0, 0.6, back);
    if (back > 0.5) col *= 0.6;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }`;

// Oil slick shader. A height field (value noise fbm, per-slick seed) gives an irregular
// puddle with thin edges and a few droplets around it. Dark glossy liquid: fresnel
// reflection of the sky, sun glint on the slightly bumpy surface, thin-film rainbow sheen
// where the oil is thin.
const OIL_VERT = `varying vec2 vUv; varying vec3 vW;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w; }`;
const OIL_FRAG = `uniform float time; uniform float spread; uniform float fade; uniform float seed;
  uniform vec3 sun; uniform vec3 skyTop; uniform vec3 skyHor;
  varying vec2 vUv; varying vec3 vW;
  float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), f.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
  // oil thickness at p (p in -1..1)
  float height(vec2 p){
    vec2 q = p + vec2(fbm(p * 1.3 + seed), fbm(p * 1.3 + seed + 4.7)) * 0.55 - 0.27;   // domain warp: organic outline
    float r = length(q) / max(spread, 0.001);
    float body = 0.62 - r * 0.78 + (fbm(p * 2.4 + seed * 1.7 + time * 0.02) - 0.5) * 0.45;
    // droplets splashed around the puddle
    vec2 dc = p * 7.0 + seed * 3.1;
    float blob = n2(dc) * 0.7 + n2(dc * 2.1) * 0.3;
    float drops = smoothstep(0.7, 0.86, blob) * smoothstep(1.1, 0.75, r) * smoothstep(0.5, 0.62, r) * 0.32;
    return max(body, drops - 0.1);
  }
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float h = height(p);
    float a = smoothstep(0.0, 0.05, h);
    if (a <= 0.001) discard;
    // surface normal from the height gradient (gentle bumps)
    float e = 0.01;
    vec2 g = vec2(height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0)), height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))) / (2.0 * e);
    g = clamp(g, -2.5, 2.5);   // liquid surfaces are almost flat: no steep, glaring facets
    vec3 N = normalize(vec3(-g.x * 0.06, 1.0, -g.y * 0.06));
    vec3 V = normalize(cameraPosition - vW);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(skyHor, skyTop, smoothstep(0.0, 0.6, R.y));
    float glint = pow(max(dot(R, sun), 0.0), 180.0) * 2.5;
    // thin film interference: rainbow bands where the oil is thin, shifting with the view
    float thin = 1.0 - smoothstep(0.03, 0.32, h);
    float phase = h * 7.0 + dot(V, N) * 2.0 + fbm(p * 3.0 + seed) * 1.5;
    vec3 film = 0.5 + 0.5 * cos(6.2832 * (phase + vec3(0.0, 0.33, 0.67)));
    vec3 col = vec3(0.004, 0.0035, 0.003);               // crude oil: brown-black (linear)
    col += sky * fres * 0.9;
    col += film * thin * (0.22 + 0.5 * fres);
    col += vec3(1.0, 0.97, 0.9) * glint;
    // the thick middle is nearly opaque, the rim lets the asphalt show through
    float alpha = a * mix(0.55, 0.96, smoothstep(0.02, 0.25, h)) * fade;
    gl_FragColor = vec4(col, alpha);
  }`;

class Items {
  constructor(game) {
    this.game = game;
    const tr = game.track, N = tr.N;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.boxes = [];
    this.rockets = [];
    this.oils = [];

    // item boxes: translucent iridescent dodecahedra (gems) with glowing edges and core
    const gemGeo = new THREE.DodecahedronGeometry(1.25, 0);   // already non-indexed
    gemGeo.computeVertexNormals();                       // flat facets
    const gemMat = side => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side,
      uniforms: { time: { value: 0 }, back: { value: side === THREE.BackSide ? 1 : 0 } },
      vertexShader: GEM_VERT, fragmentShader: GEM_FRAG
    });
    this.gemMats = [gemMat(THREE.BackSide), gemMat(THREE.FrontSide)];
    const edgeGeo = new THREE.EdgesGeometry(new THREE.DodecahedronGeometry(1.26, 0));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.coreMat = new THREE.SpriteMaterial({
      map: canvasTex(64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    });
    // soft halo around each gem (additive, colour cycles through the rainbow)
    this.haloMat = new THREE.SpriteMaterial({
      map: canvasTex(128, 128, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
        gr.addColorStop(0.55, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }),
      // depth tested (so cars and hills hide it); small (radius 1.3 m: a bigger halo reaches the road and is cut by it with a straight edge; the gem floats 1.2-1.6 m
      // above the road) not to be cut by the road surface
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1
    });
    for (const row of tr.itemRows) {
      for (let k = -2; k <= 2; k++) {
        const lat = k * tr.hw * 0.36;
        const m = new THREE.Group();
        const x = tr.x[row] - tr.tz[row] * lat, z = tr.z[row] + tr.tx[row] * lat, y = tr.y[row] + 1.4;
        m.position.set(x, y, z);
        const gem = new THREE.Group();
        const back = new THREE.Mesh(gemGeo, this.gemMats[0]), front = new THREE.Mesh(gemGeo, this.gemMats[1]);
        back.renderOrder = 2; front.renderOrder = 3;
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        edges.renderOrder = 4;
        gem.add(back, front, edges);
        const core = new THREE.Sprite(this.coreMat);
        core.scale.setScalar(1.6);
        core.renderOrder = 2;
        const halo = new THREE.Sprite(this.haloMat);
        halo.scale.setScalar(2.6);
        halo.renderOrder = 1;
        m.add(halo, gem, core);
        this.group.add(m);
        this.boxes.push({ x, y, z, mesh: m, gem, core, halo, t: 0, grow: 1, phase: Math.random() * 6 });
      }
    }

    // boost pads: scrolling chevrons
    this.padTex = canvasTex(64, 128, (g, w, h) => {
      g.fillStyle = '#ff7a1a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffe23a';
      for (let i = 0; i < 2; i++) {
        const y0 = i * 64;
        g.beginPath(); g.moveTo(6, y0 + 52); g.lineTo(32, y0 + 18); g.lineTo(58, y0 + 52); g.lineTo(58, y0 + 38); g.lineTo(32, y0 + 6); g.lineTo(6, y0 + 38); g.closePath(); g.fill();
      }
    }, true);
    this.padTex.repeat.set(1, 2);
    const padMat = new THREE.MeshBasicMaterial({ map: this.padTex });
    this.pads = [];
    for (const p of tr.pads) {
      const geo = new THREE.PlaneGeometry(4.5, 7);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(-Math.PI / 2);   // chevrons point along +x (driving direction)
      const m = new THREE.Mesh(geo, padMat);
      const i = p.idx;
      m.position.set(tr.x[i] - tr.tz[i] * p.lat, tr.y[i] + 0.04, tr.z[i] + tr.tx[i] * p.lat);
      m.rotation.y = -Math.atan2(tr.tz[i], tr.tx[i]);
      const border = new THREE.Mesh(new THREE.PlaneGeometry(5.1, 7.6).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a1030 }));
      border.position.y = -0.01;
      m.add(border);
      this.group.add(m);
      this.pads.push({ idx: i, lat: p.lat });
    }

    // shared meshes for rockets and oil
    this.rocketGeo = mergeColored([
      { geo: new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8), m: M4(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), color: 0xf4f4f4 },
      { geo: new THREE.ConeGeometry(0.3, 0.7, 8), m: M4(1.15, 0, 0, 1, 1, 1, 0, 0, -Math.PI / 2), color: 0xff3a3a },
      { geo: new THREE.BoxGeometry(0.5, 0.06, 1.0), m: M4(-0.6, 0, 0), color: 0xff3a3a },
      { geo: new THREE.BoxGeometry(0.5, 1.0, 0.06), m: M4(-0.6, 0, 0), color: 0xff3a3a }
    ]);
    addOutlineNormals(this.rocketGeo);
    this.rocketMat = toon({ vertexColors: true });
    // oil slick: a flat quad, the puddle itself is drawn by OIL_FRAG
    this.oilGeo = new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2);
    const th = this.game.theme;
    this.oilSky = [new THREE.Color(th.skyTop), new THREE.Color(th.skyHorizon)];
  }

  oilMaterial(seed) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        time: { value: 0 }, spread: { value: 0 }, fade: { value: 1 }, seed: { value: seed },
        sun: { value: new THREE.Vector3(-0.45, 0.8, 0.35).normalize() },
        skyTop: { value: this.oilSky[0] }, skyHor: { value: this.oilSky[1] }
      },
      vertexShader: OIL_VERT, fragmentShader: OIL_FRAG
    });
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  rocketTarget(owner) {
    let best = null, bd = 1e9;
    for (const c of this.game.cars) {
      if (c === owner || c.finished) continue;
      const d = c.dist - owner.dist;
      if (d > 1 && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  use(car) {
    const it = car.item;
    if (!it || car.itemRoll > 0) return;
    car.item = null;
    const tr = this.game.track;
    const fx = Math.cos(car.heading), fz = Math.sin(car.heading);
    if (it === 'turbo') {
      car.boost = Math.max(car.boost, 1.7);
      if (car.isPlayer) this.game.hud.flash('TURBO!', '#ffb43a');
    } else if (it === 'shield') {
      car.shield = 8;
    } else if (it === 'oil') {
      Sfx.playAt('splat', car, this.game.camPos, car.isPlayer ? 0.9 : 0.75);
      const x = car.x - fx * 4, z = car.z - fz * 4;
      const idx = trackLocal(tr, x, z, car.idx, 10);
      trackProject(tr, x, z, idx, proj);
      const m = new THREE.Mesh(this.oilGeo, this.oilMaterial(Math.random() * 100));
      m.position.set(x, proj.h + 0.04, z);
      // lie on the road surface, which can slope (x = along the track, z = across)
      _v.set(proj.tx, proj.slope, proj.tz).normalize();
      const across = new THREE.Vector3(-proj.tz, 0, proj.tx), up = new THREE.Vector3().crossVectors(across, _v);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(_v, up, across));
      m.renderOrder = 1;
      this.group.add(m);
      this.oils.push({ x, z, idx, lat: proj.lat, mesh: m, life: 35, age: 0, owner: car, safe: 0.8 });
      if (this.oils.length > 14) this.removeOil(this.oils[0]);
    } else if (it === 'rocket') {
      const target = this.rocketTarget(car);
      const m = new THREE.Mesh(this.rocketGeo, this.rocketMat);
      m.add(new THREE.Mesh(this.rocketGeo, outlineMaterial(0.05)));
      this.group.add(m);
      this.rockets.push({ s: car.dist + 3, lat: car.lat, y: car.y + 1, target, owner: car, life: 7, mesh: m, x: car.x, z: car.z, safe: 0.4 });
    }
  }

  removeOil(o) {
    this.group.remove(o.mesh);
    o.mesh.material.dispose();
    this.oils.splice(this.oils.indexOf(o), 1);
  }

  update(dt) {
    const g = this.game, tr = g.track, N = tr.N, t = g.time;
    // boxes
    for (const m of this.gemMats) m.uniforms.time.value = t;
    this.coreMat.color.setHSL((t * 0.12) % 1, 0.6, 0.75);
    this.haloMat.color.setHSL((t * 0.12 + 0.5) % 1, 0.9, 0.62);
    for (const b of this.boxes) {
      if (b.t > 0) {
        b.t -= dt;
        b.mesh.visible = b.t <= 0;
        if (b.t <= 0) b.grow = 0.01;
      }
      if (!b.mesh.visible) continue;
      b.grow = Math.min(1, b.grow + dt * 3);
      // pulse: the gem breathes, the core throbs a little out of step
      const beat = Math.sin(t * 4 + b.phase);
      b.mesh.scale.setScalar(b.grow * (1 + beat * 0.07));
      b.core.scale.setScalar(1.3 + Math.max(0, Math.sin(t * 4 + b.phase - 0.6)) * 0.9);
      b.halo.scale.setScalar(2.5 + beat * 0.3);
      b.gem.rotation.set(t * 0.6 + b.phase, t * 1.1 + b.phase, 0.4);
      b.mesh.position.y = b.y + Math.sin(t * 2.5 + b.phase) * 0.2;
      for (const c of g.cars) {
        const dx = c.x - b.x, dz = c.z - b.z;
        if (dx * dx + dz * dz < 2.7 * 2.7 && Math.abs(c.y - b.y) < 3) {
          b.t = 3; b.mesh.visible = false;
          Sfx.playAt('gem', b, g.camPos, c.isPlayer ? 0.4 : 0.28);
          g.fx.burst(b.x, b.y, b.z, 0xffffff, 14, 8);
          g.fx.burst(b.x, b.y, b.z, 0xffd23a, 10, 6);
          if (!c.item && c.itemRoll <= 0 && !c.finished) {
            c.pendingItem = pickItem(c.place || g.cars.length, g.cars.length);
            c.itemRoll = c.isPlayer ? 1.4 : 0.6;
            c.ai.holdT = 0;
          }
          break;
        }
      }
    }
    // boost pads
    this.padTex.offset.y = (this.padTex.offset.y - dt * 2.2) % 1;
    for (const p of this.pads) {
      for (const c of g.cars) {
        let di = c.idx - p.idx;
        if (di > N / 2) di -= N;
        if (di < -N / 2) di += N;
        if (di >= -2 && di <= 2 && Math.abs(c.lat - p.lat) < 2.6) {
          if (c.boost < 0.9 && c.isPlayer) g.hud.flashPic('boost');
          c.boost = Math.max(c.boost, 1.1);
        }
      }
    }
    // oil slicks
    for (let i = this.oils.length - 1; i >= 0; i--) {
      const o = this.oils[i];
      o.life -= dt; o.safe -= dt;
      if (o.life <= 0) { this.removeOil(o); continue; }
      // the oil spreads out like a liquid in ~0.7 s, then creeps slowly; fades out at the end
      o.age += dt;
      const u = o.mesh.material.uniforms, k = Math.min(1, o.age / 0.7);
      u.spread.value = (1 - Math.pow(1 - k, 3)) * (1 + Math.min(o.age, 20) * 0.006);
      u.time.value = o.age;
      u.fade.value = Math.min(1, o.life);
      for (const c of g.cars) {
        if (c === o.owner && o.safe > 0) continue;
        const dx = c.x - o.x, dz = c.z - o.z;
        if (dx * dx + dz * dz < 2.4 * 2.4) {
          c.hit('oil');
          this.removeOil(o);
          break;
        }
      }
    }
    // rockets follow the track and home in on their target
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt; r.safe -= dt;
      r.s += 78 * dt / SPACING;
      const tgt = r.target;
      if (tgt && !tgt.finished) {
        const gap = tgt.dist - r.s;
        if (gap < 30) r.lat += (tgt.lat - r.lat) * damp(6, dt);
        if (gap < -2) r.s = tgt.dist; // never overshoot the target
      }
      const fi = ((r.s % N) + N) % N, i0 = Math.floor(fi), i1 = (i0 + 1) % N, f = fi - i0;
      const cx = lerp(tr.x[i0], tr.x[i1], f), cz = lerp(tr.z[i0], tr.z[i1], f);
      const ttx = tr.tx[i0], ttz = tr.tz[i0];
      const nx = cx - ttz * r.lat, nz = cz + ttx * r.lat;
      const ny = lerp(tr.y[i0], tr.y[i1], f) + 1.0;
      r.mesh.position.set(nx, ny, nz);
      r.mesh.rotation.set(t * 10, -Math.atan2(nz - r.z, nx - r.x), 0, 'YXZ');
      r.x = nx; r.z = nz;
      g.fx.flame(nx - ttx * 1.2, ny, nz - ttz * 1.2, -ttx * 6, -ttz * 6);
      if (Math.random() < 0.4) g.fx.smoke(nx - ttx * 1.5, ny, nz - ttz * 1.5);
      let hitCar = null;
      for (const c of g.cars) {
        if (c === r.owner && r.safe > 0) continue;
        const dx = c.x - nx, dz = c.z - nz;
        if (dx * dx + dz * dz < 2.6 * 2.6) { hitCar = c; break; }
      }
      if (hitCar || r.life <= 0) {
        if (hitCar) hitCar.hit('rocket');
        g.fx.explosion(nx, ny, nz);
        // explosion.mp3: loud for everyone, audible from far away
        Sfx.playAt('explosion', { x: nx, y: ny, z: nz }, g.camPos, hitCar && hitCar.isPlayer ? 1 : 0.85, 180);
        // shake from the blast, if it goes off near the player
        // (the title demo has no player)
        const dpl = g.player ? Math.hypot(g.player.x - nx, g.player.z - nz) : 1e9;
        if (dpl < 35) addShake(0.5 * (1 - dpl / 35));
        this.group.remove(r.mesh);
        this.rockets.splice(i, 1);
      }
    }
  }
}
