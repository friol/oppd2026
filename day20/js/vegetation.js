// vegetation.js - forests: trees are generated per 256 m cell from the forest mask
// and streamed around the camera into instanced meshes (detailed near, simple far).
(function () {
  'use strict';
  const CELL = 256;
  const NEAR_R = 1000, FAR_R = 3400;
  const MAX_NEAR = 12000, MAX_FAR = 60000;
  const V = { near: [], far: [], count: 0 };
  const cache = new Map();
  let lastKey = '';

  // ---- geometry helpers (vertex coloured, merged by hand) ----
  function merge(parts) {
    let n = 0, ni = 0;
    for (const p of parts) { n += p.getAttribute('position').count; ni += p.index ? p.index.count : p.getAttribute('position').count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = [];
    let o = 0;
    for (const p of parts) {
      const P = p.getAttribute('position'), Nn = p.getAttribute('normal'), c = p.userData.color;
      for (let i = 0; i < P.count; i++) {
        pos.set([P.getX(i), P.getY(i), P.getZ(i)], (o + i) * 3);
        nor.set([Nn.getX(i), Nn.getY(i), Nn.getZ(i)], (o + i) * 3);
        const j = p.userData.jitter ? 0.85 + 0.3 * Math.random() : 1;
        col.set([c[0] * j, c[1] * j, c[2] * j], (o + i) * 3);
      }
      if (p.index) for (let i = 0; i < p.index.count; i++) idx.push(p.index.getX(i) + o);
      else for (let i = 0; i < P.count; i++) idx.push(i + o);
      o += P.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }
  function part(geo, color, jitter) { geo.userData.color = color; geo.userData.jitter = jitter; return geo; }

  function wobble(geo, amt, seed) {
    const P = geo.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const k = 1 + amt * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 + y * 1.3 + seed);
      P.setXYZ(i, x * k, y, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }

  const TRUNK = [0.09, 0.06, 0.035];
  const NEEDLE = [0.025, 0.07, 0.03];
  const LEAF = [0.06, 0.12, 0.03];

  // unit-height trees (scaled per instance); y = 0 at the ground
  function conifer(detail) {
    const seg = detail ? 7 : 4;
    const parts = [part(new THREE.CylinderGeometry(0.03, 0.045, 0.3, 5).translate(0, 0.15, 0), TRUNK)];
    const tiers = detail ? [[0.34, 0.5, 0.15], [0.27, 0.42, 0.38], [0.19, 0.36, 0.6], [0.1, 0.25, 0.8]] : [[0.32, 0.92, 0.1]];
    for (const [r, h, y] of tiers) parts.push(part(wobble(new THREE.ConeGeometry(r, h, seg, 1).translate(0, y + h / 2, 0), 0.08, y * 9), NEEDLE, true));
    return merge(parts);
  }
  function broadleaf(detail) {
    const parts = [part(new THREE.CylinderGeometry(0.035, 0.06, 0.45, 5).translate(0, 0.225, 0), TRUNK)];
    if (detail) {
      parts.push(part(wobble(new THREE.IcosahedronGeometry(0.33, 1).translate(0, 0.62, 0), 0.12, 1), LEAF, true));
      parts.push(part(wobble(new THREE.IcosahedronGeometry(0.22, 1).translate(0.14, 0.78, 0.05), 0.12, 2), LEAF, true));
      parts.push(part(wobble(new THREE.IcosahedronGeometry(0.2, 1).translate(-0.12, 0.74, -0.08), 0.12, 3), LEAF, true));
    } else {
      parts.push(part(new THREE.OctahedronGeometry(0.36, 0).scale(1, 0.9, 1).translate(0, 0.66, 0), LEAF, false));
    }
    return merge(parts);
  }

  function makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    m.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = GLSL.U.uTime;
      // gentle wind sway, stronger at the top of the crown
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07;
          transformed.x += sin(uTime * 1.3 + ph) * 0.02 * position.y * position.y;
          transformed.z += cos(uTime * 1.1 + ph) * 0.015 * position.y * position.y;
        #endif`);
      GLSL.addCloudShadow(shader);
    };
    return m;
  }

  function makeMesh(geo, max, mat, shadow) {
    const m = new THREE.InstancedMesh(geo, mat, max);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.receiveShadow = true;
    return m;
  }

  V.init = function (scene) {
    const mat = makeMaterial();
    V.near = [makeMesh(conifer(true), MAX_NEAR, mat, true), makeMesh(broadleaf(true), MAX_NEAR, mat, true)];
    V.far = [makeMesh(conifer(false), MAX_FAR, mat, false), makeMesh(broadleaf(false), MAX_FAR, mat, false)];
    for (const m of V.near.concat(V.far)) scene.add(m);
  };

  // Trees of one cell: [x, y, z, height, rotation, type, tint] * n
  function genCell(ci, cj) {
    const key = ci + ',' + cj;
    let c = cache.get(key);
    if (c) return c;
    const W = WORLD;
    const rnd = NOISE.mulberry32((ci * 73856093) ^ (cj * 19349663) ^ 0x5bd1e995);
    const out = [];
    const step = 11;
    for (let z = 0; z < CELL; z += step) for (let x = 0; x < CELL; x += step) {
      const px = ci * CELL + x + rnd() * step, pz = cj * CELL + z + rnd() * step;
      const f = W.maskAt(px, pz, 2);
      const r = rnd();
      const lone = 0.012; // isolated trees in meadows
      if (r > f * 0.85 + lone) continue;
      const h = W.heightAt(px, pz);
      if (h < 3 || h > 1000) continue;
      if (f < 0.05) { // a lone tree: avoid slopes, fields and villages
        const n = W.normalAt(px, pz);
        if (n.y < 0.9 || W.maskAt(px, pz, 3) > 0.5) continue;
      }
      const coniferP = 0.15 + 0.85 * Math.min(1, Math.max(0, (h - 250) / 650));
      const type = rnd() < coniferP ? 0 : 1;
      const size = (type === 0 ? 14 : 11) * (0.65 + 0.7 * rnd()) * (h > 800 ? 0.75 : 1);
      out.push(px, h - 0.4, pz, size, rnd() * 6.283, type, rnd());
    }
    c = new Float32Array(out);
    cache.set(key, c);
    if (cache.size > 2500) { // drop the oldest cells
      const it = cache.keys();
      for (let k = 0; k < 500; k++) cache.delete(it.next().value);
    }
    return c;
  }

  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  V.update = function (camPos) {
    const ci0 = Math.floor(camPos.x / CELL), cj0 = Math.floor(camPos.z / CELL);
    const key = ci0 + ',' + cj0;
    if (key === lastKey) return;
    lastKey = key;
    const counts = [0, 0, 0, 0];
    const R = Math.ceil(FAR_R / CELL);
    const meshes = [V.near[0], V.near[1], V.far[0], V.far[1]];
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const cx = (ci0 + di + 0.5) * CELL, cz = (cj0 + dj + 0.5) * CELL;
      const d = Math.hypot(cx - camPos.x, cz - camPos.z);
      if (d > FAR_R) continue;
      const near = d < NEAR_R;
      const arr = genCell(ci0 + di, cj0 + dj);
      for (let k = 0; k < arr.length; k += 7) {
        const type = arr[k + 5];
        if (!near && (k / 7) % 2 === 1 && d > FAR_R * 0.6) continue; // thin out far away
        const slot = (near ? 0 : 2) + type;
        const m = meshes[slot];
        const n = counts[slot];
        if (n >= (near ? MAX_NEAR : MAX_FAR)) continue;
        const s = arr[k + 3] * (!near && d > FAR_R * 0.6 ? 1.12 : 1);
        q.setFromAxisAngle(up, arr[k + 4]);
        sc.set(s * (0.9 + arr[k + 6] * 0.2), s, s * (0.9 + arr[k + 6] * 0.2));
        pv.set(arr[k], arr[k + 1], arr[k + 2]);
        mtx.compose(pv, q, sc);
        m.setMatrixAt(n, mtx);
        const t = arr[k + 6];
        col.setRGB(0.8 + t * 0.4, 0.85 + t * 0.3, 0.75 + (1 - t) * 0.3);
        m.setColorAt(n, col);
        counts[slot] = n + 1;
      }
    }
    for (let s = 0; s < 4; s++) {
      meshes[s].count = counts[s];
      meshes[s].instanceMatrix.needsUpdate = true;
      if (meshes[s].instanceColor) meshes[s].instanceColor.needsUpdate = true;
    }
    V.count = counts[0] + counts[1] + counts[2] + counts[3];
  };

  window.VEG = V;
})();
