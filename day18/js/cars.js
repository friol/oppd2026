// Car models, arcade driving physics and AI drivers.
'use strict';

// The player always drives a red car: the `template` model of the chosen type, with the
// palette texels of its body paint (`paint`, [x, y] in the 512x512 embedded texture)
// drawn with a solid red material instead. Templates have light paint that never
// shares texels with glass or trim (unlike the black variants).
const CAR_TYPES = [
  { name: 'Stinger', speed: 1.0, accel: 0.7, handling: 0.8, blurb: 'Wedge supercar. Highest top speed.',
    rev: 1.12, template: 2, paint: [[413, 1], [414, 1], [413, 2], [414, 2]] },
  { name: 'Thunder', speed: 0.8, accel: 1.0, handling: 0.7, blurb: 'Muscle car. Explosive acceleration.',
    rev: 0.86, template: 4, paint: [[386, 2], [386, 1]] },
  { name: 'Arrow', speed: 0.75, accel: 0.8, handling: 0.95, blurb: 'Sport sedan. Sharpest handling.',
    rev: 1.0, template: 8, paint: [[325, 114]] }
];
const PLAYER_PAINT = 0xe0201a;
const CAR_MODELS = [
  { type: 0, color: 'Silver', nodes: ['car_lambo', 'wheel', 'wheel.001', 'wheel.002', 'wheel.003'], tint: '#9aa0aa' },
  { type: 0, color: 'Bronze', nodes: ['lambo_2'], tint: '#8a4a1c' },
  { type: 0, color: 'Pearl', nodes: ['lambo_3'], tint: '#f4f4f4' },
  { type: 1, color: 'Forest', nodes: ['car_mustang', 'wheel.004', 'wheel.005', 'wheel.006', 'wheel.007'], tint: '#2a2a30' },
  { type: 1, color: 'Snow', nodes: ['mustang_2'], tint: '#ffffff' },
  { type: 1, color: 'Shadow', nodes: ['mustang_3'], tint: '#15151a' },
  { type: 2, color: 'Silver', nodes: ['audi'], tint: '#777a80' },
  { type: 2, color: 'Midnight', nodes: ['audi.001'], tint: '#1a1e2a' },
  { type: 2, color: 'Blaze', nodes: ['audi.002'], tint: '#ff5a1a' }
];
const DRIVERS = [
  { name: 'Blaze', color: '#ff4b4b' }, { name: 'Nitro', color: '#4ba8ff' }, { name: 'Pixel', color: '#ffd23a' },
  { name: 'Turbo Tina', color: '#5ee07a' }, { name: 'Max Drift', color: '#ff8ad8' }, { name: 'Rusty', color: '#ff9a3c' },
  { name: 'Vex', color: '#b28cff' }, { name: 'Zoom', color: '#7ef0f0' }, { name: 'Gizmo', color: '#c8ff5a' }
];

const CarAssets = { geos: [], bodies: {}, material: null, redMaterial: null, ready: false, pix: null };

// Splits a car body into material groups: 0 = textured body, 1 = player red paint,
// 2 = headlights, 3 = tail lights. Lights are found from the palette colour of each
// triangle and where it sits: bright yellow/white at the very front, red at the very back.
function bodyGroups(model, red) {
  const key = model + (red ? 'r' : '');
  if (CarAssets.bodies[key]) return CarAssets.bodies[key];
  const body = CarAssets.geos[model].body, pix = CarAssets.pix;
  const paint = red ? new Set(CAR_TYPES[CAR_MODELS[model].type].paint.map(p => p[0] + ',' + p[1])) : null;
  const I = body.index.array, U = body.attributes.uv.array, P = body.attributes.position.array;
  body.computeBoundingBox();
  const bb = body.boundingBox, len = bb.max.x - bb.min.x;
  const lists = [[], [], [], []];
  for (let t = 0; t < I.length; t += 3) {
    const v = I[t];
    const tx = Math.min(511, Math.floor(U[v * 2] * 512)), ty = Math.min(511, Math.floor(U[v * 2 + 1] * 512));
    let cat = 0;
    if (paint && paint.has(tx + ',' + ty)) cat = 1;
    else {
      const o = (ty * 512 + tx) * 4, r = pix[o], g = pix[o + 1], b = pix[o + 2];
      const cx = (P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3;
      if (cx > bb.max.x - len * 0.16 && r > 200 && g > 170 && b < 170) cat = 2;
      else if (cx < bb.min.x + len * 0.14 && r > 140 && g < 90 && b < 90) cat = 3;
    }
    lists[cat].push(I[t], I[t + 1], I[t + 2]);
  }
  const g = body.clone();
  g.setIndex([].concat(...lists));
  g.clearGroups();
  let start = 0;
  lists.forEach((l, i) => { g.addGroup(start, l.length, i); start += l.length; });
  g.userData.counts = lists.map(l => l.length / 3);
  return (CarAssets.bodies[key] = g);
}


function mergeBufferGeos(list) {
  let vCount = 0;
  for (const g of list) vCount += g.attributes.position.count;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2);
  const idx = [];
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    const ia = g.index ? g.index.array : null;
    const n = g.attributes.position.count;
    if (ia) for (let i = 0; i < ia.length; i++) idx.push(ia[i] + o);
    else for (let i = 0; i < n; i++) idx.push(i + o);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

// Copy of the triangles in `tris` (list of triangle indices) with compacted vertices
function subGeometry(geo, tris, offset) {
  const src = geo.index.array, P = geo.attributes.position.array, Nn = geo.attributes.normal.array, U = geo.attributes.uv.array;
  const remap = new Map(), pos = [], nor = [], uv = [], idx = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const v = src[t * 3 + k];
      let r = remap.get(v);
      if (r === undefined) {
        r = remap.size; remap.set(v, r);
        pos.push(P[v * 3] - offset.x, P[v * 3 + 1] - offset.y, P[v * 3 + 2] - offset.z);
        nor.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]);
        uv.push(U[v * 2], U[v * 2 + 1]);
      }
      idx.push(r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  addOutlineNormals(g);
  return g;
}

// Most models have the wheels baked into the body: find them as separate mesh islands
// (a tire about as tall as it is long, thin, touching the ground, plus the rim and
// caliper islands inside it) and cut them out so they can spin and steer.
function splitWheels(geo) {
  const P = geo.attributes.position.array, I = geo.index.array, n = P.length / 3;
  const par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[i * 3] * 1e4) + ',' + Math.round(P[i * 3 + 1] * 1e4) + ',' + Math.round(P[i * 3 + 2] * 1e4);
    if (seen.has(k)) unite(i, seen.get(k)); else seen.set(k, i);
  }
  for (let t = 0; t < I.length; t += 3) { unite(I[t], I[t + 1]); unite(I[t + 1], I[t + 2]); }
  const comps = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = comps.get(r);
    if (!c) { c = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], wheel: -1 }; comps.set(r, c); }
    for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], P[i * 3 + a]); c.max[a] = Math.max(c.max[a], P[i * 3 + a]); }
  }
  const tires = [];
  for (const c of comps.values()) {
    const dx = c.max[0] - c.min[0], dy = c.max[1] - c.min[1], dz = c.max[2] - c.min[2];
    if (dy > 0.5 && dy < 0.9 && Math.abs(dx - dy) < 0.12 && dz < 0.4 && c.min[1] < 0.1) tires.push(c);
  }
  const e = 0.03;
  for (const c of comps.values()) {
    tires.forEach((t, wi) => {
      if (c.min[0] >= t.min[0] - e && c.max[0] <= t.max[0] + e && c.min[1] >= t.min[1] - e &&
          c.max[1] <= t.max[1] + e && c.min[2] >= t.min[2] - e && c.max[2] <= t.max[2] + e) c.wheel = wi;
    });
  }
  const bodyTris = [], wheelTris = tires.map(() => []);
  for (let t = 0; t < I.length / 3; t++) {
    const w = comps.get(find(I[t * 3])).wheel;
    (w < 0 ? bodyTris : wheelTris[w]).push(t);
  }
  const wheels = tires.map((t, wi) => {
    const center = new THREE.Vector3((t.min[0] + t.max[0]) / 2, (t.min[1] + t.max[1]) / 2, (t.min[2] + t.max[2]) / 2);
    return { geo: subGeometry(geo, wheelTris[wi], center), center, radius: (t.max[1] - t.min[1]) / 2 };
  });
  return { body: subGeometry(geo, bodyTris, new THREE.Vector3()), wheels };
}

function loadCarAssets(done) {
  const bin = atob(window.CARS_GLB);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  new THREE.GLTFLoader().parse(buf.buffer, '', gltf => {
    gltf.scene.updateMatrixWorld(true);
    let tex = null;
    for (const m of CAR_MODELS) {
      const parts = [];
      for (const n of m.nodes) {
        // GLTFLoader strips dots from node names ("wheel.001" -> "wheel001")
        const mesh = gltf.scene.getObjectByName(n) || gltf.scene.getObjectByName(n.replace(/\./g, ''));
        if (!mesh) { console.warn('Car node not found: ' + n); continue; }
        if (!tex && mesh.material.map) tex = mesh.material.map;
        const g = mesh.geometry.clone();
        g.applyMatrix4(mesh.matrixWorld);
        parts.push(g);
      }
      const geo = mergeBufferGeos(parts);
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      geo.rotateY(Math.PI); // the models face -X, the game uses +X as forward
      const split = splitWheels(geo);
      if (split.wheels.length !== 4) console.warn('Car model ' + m.nodes[0] + ': found ' + split.wheels.length + ' wheels');
      // exhaust tailpipes: at the rear bumper, low, either side of the centre
      split.body.computeBoundingBox();
      split.rear = split.body.boundingBox.min.x + 0.08;
      CarAssets.geos.push(split);
    }
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    // palette pixels, to classify the triangles (lights)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const cg = cv.getContext('2d');
    cg.drawImage(tex.image, 0, 0, 512, 512);
    CarAssets.pix = cg.getImageData(0, 0, 512, 512).data;
    // glossy car paint: clear coat over the palette colours, sky reflections from the env map
    CarAssets.material = new THREE.MeshPhysicalMaterial({
      map: tex, roughness: 0.38, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1,
      shadowSide: THREE.DoubleSide   // the bodies are open underneath: cast with both faces
    });
    CarAssets.redMaterial = new THREE.MeshPhysicalMaterial({
      color: PLAYER_PAINT, roughness: 0.32, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.9,
      shadowSide: THREE.DoubleSide
    });
    CarAssets.wheelMaterial = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.5 });
    CarAssets.headMaterial = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xfff2c8, emissiveIntensity: 2.2, roughness: 0.2 });
    CarAssets.ready = true;
    done();
  }, err => { console.error(err); });
}

// Shield: a pulsing spherical force field. Fresnel rim, a hexagonal energy lattice whose
// cells shimmer, a scan wave climbing from the ground, faint back faces for depth.
// `power` fades it in / out, `flash` lights it up when it is created or absorbs a hit.
const SHIELD_VERT = `varying vec3 vN; varying vec3 vV; varying vec3 vP;
  void main(){ vP = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const SHIELD_FRAG = `uniform float time; uniform float power; uniform float flash; uniform vec3 color;
  varying vec3 vN; varying vec3 vV; varying vec3 vP;
  float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.732))), p.x); }
  vec4 hexCoords(vec2 uv){
    vec2 r = vec2(1.0, 1.732), h = r * 0.5;
    vec2 a = mod(uv, r) - h, b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, uv - gv);
  }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main(){
    vec3 N = normalize(vN), V = normalize(vV);
    float facing = abs(dot(N, V));
    float fres = pow(1.0 - facing, 2.4);
    // hexagons wrapped around the sphere (12 around: seamless at the atan seam)
    vec2 uv = vec2(atan(vP.z, vP.x) / 6.28318 * 12.0, asin(clamp(vP.y, -1.0, 1.0)) * 3.6);
    vec4 hx = hexCoords(uv + vec2(0.0, time * 0.15));
    float edge = 0.5 - hexDist(hx.xy);
    float line = 1.0 - smoothstep(0.0, 0.06, edge);
    float cell = 0.5 + 0.5 * sin(time * 3.0 + hash(hx.zw) * 6.2832);
    cell = pow(cell, 6.0);                                   // a few cells light up at a time
    // scan wave climbing from the ground
    float w = fract(time * 0.55);
    float wave = exp(-pow((vP.y * 0.5 + 0.5 - w) * 9.0, 2.0));
    float pulse = 0.8 + 0.2 * sin(time * 7.0);
    float k = fres * 1.25
            + line * (0.18 + 0.9 * fres) * (0.55 + 0.45 * pulse)
            + cell * (0.06 + 0.25 * fres) * (1.0 - smoothstep(0.0, 0.25, edge))
            + wave * (0.12 + line * 0.7)
            + flash * (0.35 + line);
    if (!gl_FrontFacing) k *= 0.35;
    vec3 c = mix(color, vec3(0.85, 1.0, 1.0), clamp(fres * fres + flash * 0.6, 0.0, 1.0));
    gl_FragColor = vec4(c * k * power * pulse, 1.0);
  }`;
function shieldMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, power: { value: 0 }, flash: { value: 0 }, color: { value: new THREE.Color(0x3fc8ff) } },
    vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG
  });
}

// Soft blob shadow under the cars (the models are open underneath, so their
// shadow-map silhouettes looked hollow)
let _blob = null;
function blobShadow() {
  if (!_blob) {
    // a round gradient, stretched into an ellipse by the plane
    const tex = canvasTex(128, 128, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,0.5)');
      gr.addColorStop(0.55, 'rgba(0,0,0,0.5)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    _blob = {
      geo: new THREE.PlaneGeometry(5.2, 2.7).rotateX(-Math.PI / 2),
      mat: new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    };
  }
  const m = new THREE.Mesh(_blob.geo, _blob.mat);
  m.position.y = 0.04;
  m.renderOrder = 1;
  return m;
}

function buildCarMesh(model, red) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const body = new THREE.Group();
  root.add(tilt); tilt.add(body);
  tilt.add(blobShadow());
  const asset = CarAssets.geos[model];
  // tail lights: own material per car (they brighten when braking)
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a0a, emissiveIntensity: 1.2, roughness: 0.2 });
  const m = new THREE.Mesh(bodyGroups(model, red),
    [CarAssets.material, CarAssets.redMaterial, CarAssets.headMaterial, tailMat]);
  m.castShadow = true;
  body.add(m);
  body.add(withOutline(m, 0.035));
  // wheels: steer pivot (y) -> spinning mesh (z)
  const wheels = asset.wheels.map(w => {
    const pivot = new THREE.Group();
    pivot.position.copy(w.center);
    const spin = new THREE.Group();
    const wm = new THREE.Mesh(w.geo, CarAssets.wheelMaterial);
    wm.castShadow = true;
    spin.add(wm);
    spin.add(withOutline(wm, 0.025));
    pivot.add(spin);
    body.add(pivot);
    return { pivot, spin, front: w.center.x > 0, radius: w.radius };
  });
  // shield bubble
  const sh = new THREE.Mesh(new THREE.SphereGeometry(2.9, 64, 40), shieldMaterial());
  sh.scale.set(1.15, 0.62, 0.8);
  sh.position.y = 0.7;
  sh.visible = false;
  tilt.add(sh);
  return { root, tilt, body, shield: sh, wheels, wheelAngle: 0, tailMat };
}

// ---------------------------------------------------------------- car

const TOP_SPEED = 46;       // m/s with speed stat 1.0
const REVERSE_SPEED = 12;
const proj = {};
const _wp = new THREE.Vector3(), _wd = new THREE.Vector3();

// Road surface height at (x, z), searching near sample idx
const _rh = {};
function roadHeight(tr, x, z, idx) {
  const i = trackLocal(tr, x, z, idx, 6);
  return trackProject(tr, x, z, i, _rh).h;
}

class Car {
  constructor(game, slot, model, isPlayer, driver) {
    this.game = game;
    this.model = model;
    this.type = CAR_TYPES[CAR_MODELS[model].type];
    this.isPlayer = isPlayer;
    this.name = driver.name;
    this.color = driver.color;
    const t = this.type;
    this.top = TOP_SPEED * (0.9 + 0.1 * t.speed);
    this.accel = 15 + 11 * t.accel;
    this.turn = 1.55 + 0.55 * t.handling;
    this.mesh = buildCarMesh(model, isPlayer);
    game.scene.add(this.mesh.root);
    this.skill = 1;
    this.input = { throttle: 0, brake: 0, steer: 0, drift: false, item: false };
    this.reset(slot);
  }
  reset(slot) {
    const tr = this.game.track;
    const g = gridSlot(tr, slot);
    this.idx = g.idx;
    this.x = tr.x[g.idx] - tr.tz[g.idx] * g.lat;
    this.z = tr.z[g.idx] + tr.tx[g.idx] * g.lat;
    this.y = tr.y[g.idx];
    this.heading = Math.atan2(tr.tz[g.idx], tr.tx[g.idx]);
    this.speed = 0;
    this.ext = { x: 0, z: 0 };
    this.hopY = 0; this.hopV = 0;
    this.slide = 0; this.lean = 0; this.pitch = 0;
    this.drift = { on: false, dir: 0, charge: 0, level: 0 };
    this.boost = 0; this.spin = 0; this.spinAngle = 0; this.shield = 0; this.stall = 0;
    this.item = null; this.itemRoll = 0; this.pendingItem = null;
    this.dist = g.idx - tr.N;     // continuous progress in samples, 0 = start line
    this.prevIdx = g.idx;
    this.maxLap = 0;
    this.finished = false; this.finishTime = 0; this.place = 0;
    this.lapTimes = []; this.lapStart = 0;
    this.offroad = false; this.wrongTimer = 0; this.stuckTimer = 0;
    this.turnRate = 0;
    this.lat = g.lat;
    this.ai = { lane: (Math.random() * 2 - 1) * 3, laneT: 2 + Math.random() * 3, itemT: 0, holdT: 0 };
    this.syncMesh(0);
  }
  get lap() { return Math.floor(this.dist / this.game.track.N) + 1; }

  hit(kind) {
    if (this.shield > 0) {
      this.shield = 0;
      this.shieldPop = 0.35;   // the field bursts outwards and fades
      this.game.fx.burst(this.x, this.y + 1, this.z, 0x6fe8ff, 30, 12);
      return false;
    }
    if (this.spin > 0) return false;
    this.spin = kind === 'rocket' ? 1.6 : 1.2;
    this.spinKind = kind;
    if (this.isPlayer) addShake(kind === 'rocket' ? 0.95 : 0.6);
    // initial puff of tyre smoke all around the car
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
      this.game.fx.puff(this.x + Math.cos(a) * 1.5, this.y + 0.3, this.z + Math.sin(a) * 1.5,
        Math.cos(a) * s, 0.8 + Math.random(), Math.sin(a) * s, kind === 'rocket' ? 0.35 : 0.85, 3.4, 1.8, 0.5);
    }
    this.drift.on = false; this.drift.charge = 0;
    this.speed *= kind === 'rocket' ? 0.15 : 0.35;
    if (kind === 'rocket') this.hopV = 9;
    if (this.isPlayer) {
      if (kind === 'oil') this.game.hud.flashPic('splat');
      else if (kind === 'rocket') this.game.hud.flashPic('boom');
      else this.game.hud.flash('BONK!', '#ff5a3c');
    }
    return true;
  }

  update(dt, racing) {
    const tr = this.game.track, inp = this.input, N = tr.N;
    const fx = this.game.fx;
    let maxV = this.top * this.skill;
    if (this.boost > 0) maxV *= 1.32;
    else if (this.offroad) maxV *= 0.5;
    // before the start (and in the menu) the cars stand still: no brake, or it would become reverse gear
    if (!racing) { inp.throttle = 0; inp.brake = 0; inp.steer = 0; inp.drift = false; this.speed *= 1 - damp(4, dt); }

    // timers
    this.boost = Math.max(0, this.boost - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.stall = Math.max(0, this.stall - dt);
    if (this.itemRoll > 0) {
      this.itemRoll -= dt;
      if (this.itemRoll <= 0) { this.item = this.pendingItem; this.pendingItem = null; }
    }

    let steer = inp.steer;
    if (this.spin > 0) {
      this.spin -= dt;
      this.spinAngle += dt * 13;
      this.speed *= 1 - damp(2.2, dt);
      steer = 0;
      if (this.spin <= 0) this.spinAngle = 0;
      this.spinSmoke(dt);
    } else if (this.stall > 0) {
      this.speed *= 1 - damp(3, dt);
    } else {
      if (inp.throttle) {
        const r = clamp(this.speed / maxV, 0, 1);
        // progressive: brisk launch, the last km/h come slowly (top speed in ~6 s), so the
        // 5 gears of the engine sound are spread over time
        if (this.speed < maxV) this.speed += this.accel * 0.75 * (1 - 0.9 * Math.pow(r, 1.3)) * dt;
      }
      if (inp.brake) {
        if (this.speed > 0.5) this.speed -= 32 * dt;
        else this.speed = Math.max(this.speed - 14 * dt, -REVERSE_SPEED);
      }
      if (!inp.throttle && !inp.brake) {
        const d = Math.min(Math.abs(this.speed), 7 * dt);
        this.speed -= Math.sign(this.speed) * d;
      }
      if (this.speed > maxV) this.speed = Math.max(maxV, this.speed - (this.offroad ? 34 : 18) * dt);
      if (this.boost > 0 && this.speed < maxV) this.speed = Math.min(maxV, this.speed + 45 * dt);
    }

    // drifting: hop in, slide around the corner, charge a mini turbo
    const d = this.drift;
    if (!d.on && inp.drift && this.spin <= 0 && Math.abs(steer) > 0.25 && this.speed > 14 && this.hopY <= 0.01) {
      d.on = true; d.dir = Math.sign(steer); d.charge = 0; d.level = 0;
      this.hopV = 5.5;
    }
    if (d.on && (!inp.drift || this.speed < 9 || this.spin > 0)) {
      if (d.level > 0 && this.spin <= 0) {
        this.boost = Math.max(this.boost, d.level === 2 ? 1.25 : 0.6);
        if (this.isPlayer) this.game.hud.flash(d.level === 2 ? 'SUPER TURBO!' : 'TURBO!', d.level === 2 ? '#ff9a3c' : '#5ad2ff');
      }
      d.on = false; d.charge = 0; d.level = 0;
    }
    const sf = clamp(Math.abs(this.speed) / 9, 0, 1) * Math.sign(this.speed || 1);
    const highSpeed = clamp(this.speed / this.top, 0, 1);
    let turn;
    if (d.on) {
      turn = d.dir * this.turn * (0.72 + 0.5 * steer * d.dir) * 0.98;
      d.charge += dt * (steer * d.dir > 0.3 ? 1.35 : 0.8);
      d.level = d.charge > 2.3 ? 2 : d.charge > 0.95 ? 1 : 0;
      if (d.level > 0) {
        const col = d.level === 2 ? 0xff9a2a : 0x4ac8ff;
        this.sparks(col);
      }
    } else {
      turn = steer * this.turn * (1 - 0.45 * highSpeed);
    }
    if (this.spin <= 0) this.heading += turn * sf * dt;
    this.turnRate = turn * sf;

    // integrate motion
    const fxv = Math.cos(this.heading), fzv = Math.sin(this.heading);
    this.x += (fxv * this.speed + this.ext.x) * dt;
    this.z += (fzv * this.speed + this.ext.z) * dt;
    const ek = 1 - damp(5, dt);
    this.ext.x *= ek; this.ext.z *= ek;

    // follow the track
    this.idx = trackLocal(tr, this.x, this.z, this.idx, 16);
    trackProject(tr, this.x, this.z, this.idx, proj);
    const limit = tr.hw + BARRIER - 1.3;
    if (Math.abs(proj.lat) > limit) {
      const sgn = Math.sign(proj.lat), over = Math.abs(proj.lat) - limit;
      const nx = -proj.tz * sgn, nz = proj.tx * sgn;   // outward wall normal
      this.x -= nx * over; this.z -= nz * over;
      const vn = (fxv * nx + fzv * nz) * Math.sign(this.speed);
      if (vn > 0) {
        const imp = Math.abs(this.speed);
        this.speed *= 1 - 0.55 * vn;
        // turn the car along the wall
        const ta = Math.atan2(proj.tz, proj.tx);
        const along = Math.cos(this.heading - ta) >= 0 ? ta : ta + Math.PI;
        this.heading += wrapAngle(along - this.heading) * Math.min(1, vn * 0.9);
        this.ext.x -= nx * imp * 0.12 * vn; this.ext.z -= nz * imp * 0.12 * vn;
        if (imp > 12) fx.burst(this.x + nx * 1.2, this.y + 0.6, this.z + nz * 1.2, 0xffe08a, 8, 6);
        if (this.isPlayer && imp > 8) addShake(clamp(imp / 45, 0.15, 0.7));
        d.on = false;
      }
      proj.lat = sgn * limit;
    }
    this.lat = proj.lat;
    const alat = Math.abs(proj.lat);
    this.offroad = alat > tr.hw + 1.5;
    // stick to the road: height under the front and the rear axle (no lag, otherwise the car
    // sinks on climbs; two samples so the wheels stay on the surface in dips and over crests)
    const off = alat > tr.hw + 3 ? -0.3 : alat > tr.hw + 1.6 ? -0.15 : 0;
    const hx = Math.cos(this.heading) * 1.25, hz = Math.sin(this.heading) * 1.25;
    const hF = roadHeight(tr, this.x + hx, this.z + hz, this.idx), hB = roadHeight(tr, this.x - hx, this.z - hz, this.idx);
    // the off-road dip eases in, the road height itself is followed exactly
    this.offY = (this.offY || 0) + (off - (this.offY || 0)) * damp(10, dt);
    this.y = (hF + hB) / 2 + this.offY;
    this.groundPitch = Math.atan2(hF - hB, 2.5);
    this.hopV -= 30 * dt;
    this.hopY = Math.max(0, this.hopY + this.hopV * dt);
    if (this.hopY <= 0 && this.hopV < 0) this.hopV = 0;

    // offroad dust
    if (this.offroad && Math.abs(this.speed) > 6 && Math.random() < 0.6) {
      fx.dust(this.x - fxv * 2, this.y + 0.3, this.z - fzv * 2, this.game.theme.grass[1]);
    }
    if (this.boost > 0) this.flames();

    // progress, laps
    let di = this.idx - this.prevIdx;
    if (di < -N / 2) di += N;
    if (di > N / 2) di -= N;
    this.dist += di;
    this.prevIdx = this.idx;
    const ta = Math.atan2(proj.tz, proj.tx);
    const dirDot = Math.cos(this.heading - ta);
    if (dirDot < -0.2 && this.speed > 4 && this.spin <= 0) this.wrongTimer += dt; else this.wrongTimer = 0;
    this.pitch = this.groundPitch;

    if (racing && Math.abs(this.speed) < 2 && !this.finished) this.stuckTimer += dt; else this.stuckTimer = 0;
  }

  // Spinning out: thick tyre smoke from the wheels scrubbing sideways (whitish), darker
  // and with soot after a rocket hit; the puffs keep part of the car's motion and hang in the air
  spinSmoke(dt) {
    const fx = this.game.fx, m = this.mesh;
    const k = clamp(this.spin / 1.2, 0.3, 1);
    this.spinAcc = (this.spinAcc || 0) + 55 * k * dt;
    if (this.spinAcc < 1 || !m.wheels.length) return;
    m.root.updateMatrixWorld(true);
    const vx = Math.cos(this.heading) * this.speed * 0.5, vz = Math.sin(this.heading) * this.speed * 0.5;
    const rocket = this.spinKind === 'rocket';
    while (this.spinAcc >= 1) {
      this.spinAcc -= 1;
      const w = m.wheels[Math.floor(Math.random() * m.wheels.length)];
      w.pivot.getWorldPosition(_wp);
      fx.puff(_wp.x, _wp.y - w.radius * 0.6, _wp.z,
        vx + (Math.random() - 0.5) * 4, 0.6 + Math.random() * 1.2, vz + (Math.random() - 0.5) * 4,
        rocket ? 0.25 + Math.random() * 0.25 : 0.82, 3 + Math.random() * 1.5, 1.6, rocket ? 0.5 : 0.55);
    }
  }

  // Tyre marks on the asphalt: drifting, spinning out, launching from a standstill, hard braking
  skidMarks(dt) {
    const skids = this.game.skids, m = this.mesh;
    if (!skids || !m.wheels.length) return;
    if (this.speed < 1) this.launchT = 0; else this.launchT = (this.launchT || 0) + dt;
    const tr = this.game.track;
    let a = 0;
    if (Math.abs(this.lat) < tr.hw + 1.6 && this.hopY < 0.05) {
      if (this.drift.on && this.speed > 8) a = 0.55;
      else if (this.spin > 0 && this.speed > 3) a = 0.6;
      else if (this.input.throttle && this.launchT < 1.1 && this.speed < 16) a = 0.55 * (1 - this.speed / 16) + (this.boost > 0 ? 0.3 : 0);
      else if (this.input.brake && this.speed > 18) a = 0.35;
    }
    // tyre screech: same conditions as the marks; on oil for the whole spin, on any surface
    let screech = a;
    if (this.spin > 0 && this.spinKind === 'oil') screech = Math.max(screech, 0.7);
    this.updateScreech(screech, dt);
    if (!this.strips) this.strips = m.wheels.map(() => ({ on: false }));
    if (a < 0.05) { for (const s of this.strips) if (s.on) skids.end(s); return; }
    m.root.updateMatrixWorld(true);
    m.wheels.forEach((w, i) => {
      const s = this.strips[i];
      if (w.front && this.spin <= 0) { if (s.on) skids.end(s); return; }   // only the rear wheels, all four in a spin
      w.pivot.getWorldPosition(_wp);
      skids.mark(s, _wp.x, _wp.y - w.radius + 0.03, _wp.z, clamp(a, 0, 0.85), 0.3);
    });
  }

  // Force field animation: power-up with an overshoot, breathing, flicker before it
  // runs out, burst when it absorbs a hit
  updateShield(dt) {
    const sh = this.mesh.shield, u = sh.material.uniforms, t = this.game.time;
    this.shieldPop = Math.max(0, (this.shieldPop || 0) - dt);
    if (this.shield > 0) {
      this.shieldAge = (this.shieldAge || 0) + dt;
      const a = this.shieldAge;
      // grows from nothing with a springy overshoot
      const grow = a < 0.45 ? 1 - Math.exp(-a * 9) * Math.cos(a * 16) : 1;
      const breathe = 1 + Math.sin(t * 5.5) * 0.025 + Math.sin(t * 13) * 0.01;
      const sc = grow * breathe;
      sh.scale.set(1.15 * sc, 0.62 * sc, 0.8 * sc);
      // last 1.5 s: flicker, more and more often
      let power = 1;
      if (this.shield < 1.5) power = Math.sin(t * (30 + (1.5 - this.shield) * 40)) > -0.2 ? 1 : 0.15;
      u.power.value = power;
      u.flash.value = Math.max(0, 1 - a * 3);
      sh.visible = true;
      // energy crackles on the surface
      if (Math.random() < 0.35 * dt * 60) {
        const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.2;
        const fx = Math.cos(this.heading), fz = Math.sin(this.heading);
        const lx = Math.cos(th) * Math.cos(ph) * 3.3, lz = Math.sin(th) * Math.cos(ph) * 2.3, ly = Math.sin(ph) * 1.8;
        this.game.fx.spark(this.x + fx * lx - fz * lz, this.y + 0.7 + ly, this.z + fz * lx + fx * lz, 0x9ff0ff,
          (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
      }
    } else if (this.shieldPop > 0) {
      const k = this.shieldPop / 0.35;
      const sc = 1 + (1 - k) * 0.7;
      sh.scale.set(1.15 * sc, 0.62 * sc, 0.8 * sc);
      u.power.value = k;
      u.flash.value = k;
      sh.visible = true;
      this.shieldAge = 0;
    } else {
      sh.visible = false;
      this.shieldAge = 0;
    }
    u.time.value = t + this.model * 1.7;
  }

  // Exhaust smoke from the two tailpipes; k = 0..1 puffs per pipe (about 80/s at 1)
  emitExhaust(k, dark, dt) {
    this.exhaustAcc = (this.exhaustAcc || 0) + k * 80 * dt;
    if (this.exhaustAcc < 1) return;
    const m = this.mesh, rear = CarAssets.geos[this.model].rear;
    m.root.updateMatrixWorld(true);
    const fx = this.game.fx;
    const vx = Math.cos(this.heading) * this.speed, vz = Math.sin(this.heading) * this.speed;
    while (this.exhaustAcc >= 1) {
      this.exhaustAcc -= 1;
      for (const side of [-0.42, 0.42]) {
        _wp.set(rear, 0.32, side);
        m.body.localToWorld(_wp);
        _wd.set(rear - 1, 0.32, side);
        m.body.localToWorld(_wd).sub(_wp);   // backwards direction of the pipe
        const out = 2.5 + 3 * k;
        fx.exhaust(_wp.x, _wp.y, _wp.z, vx * 0.6 + _wd.x * out, _wd.y * out, vz * 0.6 + _wd.z * out, dark, k);
      }
    }
  }

  // drift.wav at the start of a skid (natural attack), then the seamless drift_loop.wav while
  // it lasts; volume from the skid strength and the distance from the camera
  updateScreech(level, dt) {
    const cp = this.game.camPos;
    const d = cp ? Math.hypot(cp.x - this.x, cp.y - this.y, cp.z - this.z) : 0;
    const vol = level > 0.05 ? (this.isPlayer ? 0.75 : 0.55) * clamp(level * 1.3, 0, 1) * clamp(1 - (d - 10) / 80, 0, 1) : 0;
    if (vol > 0.02) {
      if (!this.screeching) { this.screeching = true; this.screechT = 0; Sfx.play('drift', vol); }
      this.screechT += dt;
      if (!this.skidSnd) this.skidSnd = Sfx.loop('soundfx/drift_loop.wav');
      this.skidSnd.set(this.screechT > 0.35 ? vol : 0);
    } else {
      this.screeching = false;
      if (this.skidSnd) this.skidSnd.stop();
    }
  }

  stopSounds() {
    if (this.shieldSnd) { this.shieldSnd.dispose(); this.shieldSnd = null; }
    if (this.skidSnd) { this.skidSnd.dispose(); this.skidSnd = null; }
  }

  respawn() {
    const tr = this.game.track;
    const i = this.idx;
    this.x = tr.x[i]; this.z = tr.z[i]; this.y = tr.y[i];
    this.heading = Math.atan2(tr.tz[i], tr.tx[i]);
    this.speed = 0; this.ext.x = this.ext.z = 0; this.spin = 0; this.spinAngle = 0;
    this.drift.on = false;
    this.stuckTimer = 0;
  }

  sparks(col) {
    const fxv = Math.cos(this.heading), fzv = Math.sin(this.heading);
    const rx = -fzv, rz = fxv;
    for (const s of [-1, 1]) {
      if (Math.random() < 0.5) continue;
      const px = this.x - fxv * 1.5 + rx * s * 0.95, pz = this.z - fzv * 1.5 + rz * s * 0.95;
      this.game.fx.spark(px, this.y + this.hopY + 0.15, pz, col, -fxv * 4 + rx * s * 3, -fzv * 4 + rz * s * 3);
    }
  }
  flames() {
    const fxv = Math.cos(this.heading), fzv = Math.sin(this.heading);
    const rx = -fzv, rz = fxv;
    for (const s of [-0.45, 0.45]) {
      const px = this.x - fxv * 2.25 + rx * s, pz = this.z - fzv * 2.25 + rz * s;
      this.game.fx.flame(px, this.y + this.hopY + 0.45, pz, -fxv * 8 + this.speed * fxv * 0.7, -fzv * 8 + this.speed * fzv * 0.7);
    }
  }

  syncMesh(dt) {
    const m = this.mesh;
    // a turbo just started (item, drift mini turbo, boost pad, rocket start): nitro sound,
    // fading with the distance from the camera
    if (this.boost > (this.prevBoost || 0) + 0.2) {
      const cp = this.game.camPos;
      const d = cp ? Math.hypot(cp.x - this.x, cp.y - this.y, cp.z - this.z) : 0;
      Sfx.play('nitro', (this.isPlayer ? 0.85 : 0.7) * clamp(1 - (d - 10) / 90, 0, 1));
    }
    this.prevBoost = this.boost;
    // shield hum, looping while the shield is up
    if (this.shield > 0) {
      if (!this.shieldSnd) this.shieldSnd = Sfx.loop('soundfx/shield.mp3');
      const cp = this.game.camPos;
      const d = cp ? Math.hypot(cp.x - this.x, cp.y - this.y, cp.z - this.z) : 0;
      this.shieldSnd.set((this.isPlayer ? 0.7 : 0.55) * clamp(1 - (d - 10) / 70, 0, 1));
    } else if (this.shieldSnd) this.shieldSnd.stop();
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = -this.heading;
    // visual drift slide angle, body lean, pitch on slopes
    const slideT = this.drift.on ? this.drift.dir * 0.42 : this.input.steer * 0.05 * clamp(this.speed / 20, 0, 1);
    this.slide += (slideT - this.slide) * damp(8, dt || 1);
    const leanT = -this.turnRate * 0.05 * clamp(this.speed / 20, 0, 1);
    this.lean += (leanT - this.lean) * damp(6, dt || 1);
    m.tilt.rotation.set(this.lean, 0, this.pitch);
    // the roll pivots on the ground at the centre: lift the car so the outer wheels stay on the road
    m.tilt.position.y = Math.abs(Math.sin(this.lean)) * 0.9;
    m.body.rotation.y = -(this.slide + this.spinAngle);
    m.body.position.y = this.hopY + (this.speed > 1 ? Math.sin(this.game.time * 30 + this.model) * 0.012 : 0);
    // rolling wheels (forward = clockwise seen from +z), front wheels steer
    if (m.wheels.length) {
      m.wheelAngle -= this.speed * (dt || 0) / m.wheels[0].radius;
      const steer = this.spin > 0 ? 0 : (this.drift.on ? -this.drift.dir * 0.25 + this.input.steer * 0.2 : this.input.steer * 0.42);
      for (const w of m.wheels) {
        w.spin.rotation.z = m.wheelAngle;
        if (w.front) w.pivot.rotation.y = -steer;
      }
    }
    this.skidMarks(dt || 0);
    // brake lights
    m.tailMat.emissiveIntensity = this.input.brake && this.speed > 1 ? 6 : 1.2;
    this.updateShield(dt || 0);
  }
}

// ---------------------------------------------------------------- AI

function updateAI(car, dt, game) {
  const tr = game.track, N = tr.N, inp = car.input, ai = car.ai;
  if (car.finished) {
    // cruise after the finish line
    inp.throttle = car.speed < 18 ? 1 : 0;
  }
  ai.laneT -= dt;
  if (ai.laneT <= 0) {
    ai.laneT = 2.5 + Math.random() * 4;
    ai.lane = (Math.random() * 2 - 1) * tr.hw * 0.35;
  }
  const lookM = 9 + Math.max(0, car.speed) * 0.42;
  const ti = (car.idx + Math.round(lookM / SPACING)) % N;
  let lane = ai.lane;
  // dodge slower cars and oil just ahead
  for (const o of game.cars) {
    if (o === car) continue;
    const ahead = o.dist - car.dist;
    if (ahead > 0 && ahead < 9 && Math.abs(o.lat - (car.lat)) < 3 && o.speed < car.speed + 2) {
      lane += (o.lat > car.lat ? -1 : 1) * 4;
    }
  }
  for (const oil of game.items.oils) {
    let ahead = oil.idx - car.idx;
    if (ahead < -N / 2) ahead += N;
    if (ahead > 0 && ahead < 18 && Math.abs(oil.lat - car.lat) < 3) lane += (oil.lat > car.lat ? -1 : 1) * 5;
  }
  const tLat = clamp(tr.racing[ti] * 0.9 + lane, -tr.hw + 2, tr.hw - 2);
  const px = tr.x[ti] - tr.tz[ti] * tLat, pz = tr.z[ti] + tr.tx[ti] * tLat;
  const want = Math.atan2(pz - car.z, px - car.x);
  const diff = wrapAngle(want - car.heading);
  inp.steer = clamp(diff * 2.6, -1, 1);
  inp.drift = false;

  // corner speed: how fast can this car take the tightest bend ahead?
  let kmax = 0;
  const span = Math.round((20 + car.speed * 1.3) / SPACING);
  for (let j = 2; j < span; j += 2) kmax = Math.max(kmax, Math.abs(tr.ks[(car.idx + j) % N]));
  const T = car.turn;
  let vCorner = kmax > 0 ? T / (kmax + 0.45 * T / car.top) : 999;
  vCorner *= 0.97;
  // rubber banding against the player
  const pl = game.player;
  const rel = pl && pl !== car ? (pl.dist - car.dist) * SPACING : 0;
  car.skill = ai.baseSkill * (1 + clamp(rel / 500, -0.07, 0.1));
  if (!car.finished) {
    inp.throttle = car.speed < vCorner ? 1 : 0;
    inp.brake = car.speed > vCorner + 4 ? 1 : 0;
    if (Math.abs(diff) > 1.4) { inp.throttle = 1; inp.brake = 0; }
  } else inp.brake = 0;

  // stuck recovery
  if (car.stuckTimer > 2.5) car.respawn();

  // items
  inp.item = false;
  if (car.item && !car.finished) {
    ai.holdT += dt;
    const it = car.item;
    if (it === 'turbo') {
      if (kmax < 1 / 200 || ai.holdT > 6) inp.item = true;
    } else if (it === 'rocket') {
      const tgt = game.items.rocketTarget(car);
      if ((tgt && (tgt.dist - car.dist) * SPACING < 90) || ai.holdT > 9) inp.item = true;
    } else if (it === 'oil') {
      const behind = game.cars.some(o => o !== car && car.dist - o.dist > 2 && (car.dist - o.dist) * SPACING < 30);
      if (behind || ai.holdT > 10) inp.item = true;
    } else if (it === 'shield') {
      if (game.items.rockets.some(r => r.target === car) || ai.holdT > 12) inp.item = true;
    }
    if (inp.item) ai.holdT = 0;
  }
}
