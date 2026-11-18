// Shared helpers: random numbers, noise, math, toon materials and outlines.
'use strict';

// Colour management: hex colours and textures are sRGB, lighting happens in linear space,
// the final post-processing pass tone maps (ACES) and converts back to sRGB.
THREE.ColorManagement.legacyMode = false;
// Look: realistic (PBR materials, no outlines). Set outlines back to true for the old toon look.
const GFX = { outlines: false };

// Deterministic PRNG (mulberry32)
function RNG(seed) {
  let a = seed >>> 0;
  const r = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = arr => arr[Math.floor(r() * arr.length)];
  return r;
}

// Value noise with smooth interpolation
function hash2(x, y, s) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
function fbm(x, y, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < (oct || 4); i++) {
    sum += amp * noise2(x * f, y * f, s + i * 17);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
// Frame-rate independent exponential approach factor
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// Three-step gradient for toon shading
let _toonGrad = null;
function toonGradient() {
  if (_toonGrad) return _toonGrad;
  const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
  _toonGrad = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  _toonGrad.minFilter = _toonGrad.magFilter = THREE.NearestFilter;
  _toonGrad.generateMipmaps = false;
  _toonGrad.needsUpdate = true;
  return _toonGrad;
}
// Standard surface material (the name is kept from the toon version): physically based,
// rough dielectric unless the options say otherwise
function toon(opts) {
  return new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0, envMapIntensity: 0.55 }, opts));
}
// sRGB value -> linear (for colours written directly into shaders / particles)
const lin = v => Math.pow(v, 2.2);

// Adds a smoothed normal attribute (oNormal) so outlines have no gaps at hard edges
function addOutlineNormals(geom) {
  if (geom.attributes.oNormal) return geom;
  if (!geom.attributes.normal) geom.computeVertexNormals();
  const p = geom.attributes.position, n = geom.attributes.normal;
  const map = new Map(), out = new Float32Array(p.count * 3);
  const key = i => Math.round(p.getX(i) * 1000) + ',' + Math.round(p.getY(i) * 1000) + ',' + Math.round(p.getZ(i) * 1000);
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    let acc = map.get(k);
    if (!acc) { acc = [0, 0, 0]; map.set(k, acc); }
    acc[0] += n.getX(i); acc[1] += n.getY(i); acc[2] += n.getZ(i);
  }
  for (let i = 0; i < p.count; i++) {
    const acc = map.get(key(i));
    const l = Math.hypot(acc[0], acc[1], acc[2]) || 1;
    out[i * 3] = acc[0] / l; out[i * 3 + 1] = acc[1] / l; out[i * 3 + 2] = acc[2] / l;
  }
  geom.setAttribute('oNormal', new THREE.BufferAttribute(out, 3));
  return geom;
}

// Inverted hull outline material (works with InstancedMesh and fog)
const _outlineMats = {};
function outlineMaterial(thickness, color) {
  const k = thickness + ':' + (color || 0);
  if (_outlineMats[k]) return _outlineMats[k];
  const m = new THREE.MeshBasicMaterial({ color: color || 0x111018, side: THREE.BackSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec3 oNormal;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      'vec3 transformed = position + oNormal * ' + thickness.toFixed(4) + ';');
  };
  m.customProgramCacheKey = () => 'outline' + thickness;
  _outlineMats[k] = m;
  return m;
}
function withOutline(mesh, thickness, color) {
  if (!GFX.outlines) return new THREE.Object3D();
  addOutlineNormals(mesh.geometry);
  let o;
  if (mesh.isInstancedMesh) {
    o = new THREE.InstancedMesh(mesh.geometry, outlineMaterial(thickness, color), mesh.count);
    o.instanceMatrix = mesh.instanceMatrix;
  } else {
    o = new THREE.Mesh(mesh.geometry, outlineMaterial(thickness, color));
    o.position.copy(mesh.position);
    o.quaternion.copy(mesh.quaternion);
    o.scale.copy(mesh.scale);
  }
  o.frustumCulled = mesh.frustumCulled;
  return o;
}

// Canvas texture helper
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}

function ordinal(n) {
  return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
}
function fmtTime(t) {
  if (!isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}
