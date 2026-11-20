// towns.js - small villages: houses along a few streets, a church with a bell tower,
// asphalt roads draped on the terrain, lit windows at night.
(function () {
  'use strict';
  const T = { houses: 0 };

  const WALLS = [[0.75, 0.72, 0.65], [0.78, 0.68, 0.50], [0.70, 0.55, 0.42], [0.80, 0.78, 0.74], [0.66, 0.60, 0.50], [0.76, 0.62, 0.55]];
  const ROOFS = [[0.40, 0.14, 0.08], [0.33, 0.12, 0.08], [0.18, 0.17, 0.17], [0.30, 0.20, 0.14], [0.45, 0.20, 0.12]];

  function srgb(c) { return c.map(v => Math.pow(v, 2.2)); }

  // Walls: windows are drawn procedurally (dark glass by day, warm light at night)
  function wallMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    m.onBeforeCompile = function (shader) {
      shader.uniforms.uNight = GLSL.U.uNight;
      shader.vertexShader = 'varying vec3 vLocal; varying vec3 vScale; varying vec3 vObjN; varying float vSeed;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position; vObjN = normal;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`);
      shader.fragmentShader = 'uniform float uNight; varying vec3 vLocal; varying vec3 vScale; varying vec3 vObjN; varying float vSeed;\n' + shader.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (abs(vObjN.y) < 0.5) {
            float u = abs(vObjN.x) > 0.5 ? vLocal.z * vScale.z : vLocal.x * vScale.x;
            float v = vLocal.y * vScale.y;
            vec2 cell = floor(vec2(u / 3.2, v / 2.9));
            vec2 f = fract(vec2(u / 3.2, v / 2.9));
            float win = step(0.3, f.x) * step(f.x, 0.7) * step(0.35, f.y) * step(f.y, 0.75) * step(1.0, v) * step(v, vScale.y - 0.6);
            float on = step(0.45, fract(sin(dot(cell + vSeed * 31.0 + vObjN.xz * 7.0, vec2(17.31, 41.7))) * 9123.1));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.025, 0.03), win);
            totalEmissiveRadiance += win * on * uNight * vec3(1.0, 0.62, 0.28) * 0.45;
          }`);
      GLSL.addCloudShadow(shader);
    };
    return m;
  }

  function roofMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    m.onBeforeCompile = function (shader) { GLSL.addCloudShadow(shader); };
    return m;
  }

  // Unit box with its base at y = 0, extended down (hides sloped ground)
  function boxGeo() { const g = new THREE.BoxGeometry(1, 1.4, 1); g.translate(0, 0.3, 0); return g; }
  // Gable roof prism, unit size, base at y = 0
  function roofGeo() {
    const s = new THREE.Shape();
    s.moveTo(-0.56, 0); s.lineTo(0.56, 0); s.lineTo(0, 1); s.lineTo(-0.56, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.08, bevelEnabled: false });
    g.translate(0, 0, -0.54);
    return g;
  }
  function spireGeo() { const g = new THREE.ConeGeometry(0.72, 1, 4); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0); return g; }

  T.init = function (scene) {
    const W = WORLD;
    const houses = [], roofs = [], spires = [], roads = [];
    for (const town of W.towns) {
      const rnd = NOISE.mulberry32(town.seed);
      const ca = Math.cos(town.angle), sa = Math.sin(town.angle);
      const toW = (u, v) => [town.x + u * ca - v * sa, town.z + u * sa + v * ca];
      // streets: a main street and perpendicular side streets
      const streets = [{ u0: -town.r, v0: 0, du: 1, dv: 0, len: town.r * 2 }];
      for (let u = -town.r * 0.6; u <= town.r * 0.6; u += 70 + rnd() * 40) {
        if (rnd() < 0.7) streets.push({ u0: u, v0: -town.r * 0.55, du: 0, dv: 1, len: town.r * 1.1 * (0.5 + rnd() * 0.5) });
      }
      for (const st of streets) {
        // road polyline
        const pts = [];
        for (let s = 0; s <= st.len; s += 12) pts.push(toW(st.u0 + st.du * s, st.v0 + st.dv * s));
        roads.push({ pts, w: st === streets[0] ? 7 : 5 });
        // houses on both sides
        for (let s = 8; s < st.len - 6; s += 13 + rnd() * 9) {
          for (const side of [-1, 1]) {
            if (rnd() < 0.15) continue;
            const off = 9 + rnd() * 4;
            const u = st.u0 + st.du * s - st.dv * side * off, v = st.v0 + st.dv * s + st.du * side * off;
            const dc = Math.hypot(u, v) / town.r;
            if (dc > 1 || rnd() < dc * 0.6) continue;
            const [x, z] = toW(u, v);
            const w = 7 + rnd() * 5, d = 6 + rnd() * 4, h = rnd() < 0.35 ? 7.5 + rnd() * 2 : 4.6 + rnd() * 1.5;
            const rot = town.angle + (st.du ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.12;
            let y = 1e9;
            for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, 0]]) y = Math.min(y, W.heightAt(x + a * w, z + b * d));
            if (y < 1.5) continue;
            if (houses.some(o => Math.hypot(o.x - x, o.z - z) < 9)) continue;
            houses.push({ x, y, z, w, d, h, rot, wall: WALLS[(rnd() * WALLS.length) | 0], roof: ROOFS[(rnd() * ROOFS.length) | 0], rh: 2.5 + rnd() * 1.5 });
          }
        }
      }
      // church in the square
      const [cx, cz] = toW(0, -22);
      const cy = Math.min(W.heightAt(cx, cz), W.heightAt(cx + 8, cz + 8), W.heightAt(cx - 8, cz - 8));
      houses.push({ x: cx, y: cy, z: cz, w: 11, d: 24, h: 10, rot: town.angle + Math.PI / 2, wall: [0.82, 0.78, 0.70], roof: [0.38, 0.14, 0.08], rh: 6 });
      const [tx, tz] = toW(-6, -38);
      const ty = W.heightAt(tx, tz);
      houses.push({ x: tx, y: ty, z: tz, w: 5.5, d: 5.5, h: 26, rot: town.angle, wall: [0.80, 0.76, 0.68], roof: null });
      spires.push({ x: tx, y: ty + 26 * 1.0, z: tz, s: 5.5, h: 9, rot: town.angle });
    }
    T.houses = houses.length;

    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const hm = new THREE.InstancedMesh(boxGeo(), wallMaterial(), houses.length);
    const roofList = houses.filter(o => o.roof);
    const rm = new THREE.InstancedMesh(roofGeo(), roofMaterial(), roofList.length + spires.length);
    houses.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot);
      // box spans -0.4..1.0 of its scaled height: shift so the eave sits at o.h above ground
      p.set(o.x, o.y + 0.0, o.z); s.set(o.w, o.h, o.d);
      mtx.compose(p, q, s); hm.setMatrixAt(i, mtx);
      hm.setColorAt(i, c.setRGB(...srgb(o.wall)));
    });
    let r = 0;
    for (const o of roofList) {
      q.setFromAxisAngle(up, o.rot);
      p.set(o.x, o.y + o.h, o.z); s.set(o.w, o.rh, o.d);
      mtx.compose(p, q, s); rm.setMatrixAt(r, mtx); rm.setColorAt(r, c.setRGB(...srgb(o.roof))); r++;
    }
    hm.castShadow = hm.receiveShadow = rm.castShadow = rm.receiveShadow = true;
    hm.frustumCulled = rm.frustumCulled = false;
    scene.add(hm, rm);
    const sm = new THREE.InstancedMesh(spireGeo(), roofMaterial(), spires.length);
    spires.forEach((o, i) => {
      q.setFromAxisAngle(up, o.rot); p.set(o.x, o.y, o.z); s.set(o.s, o.h, o.s);
      mtx.compose(p, q, s); sm.setMatrixAt(i, mtx); sm.setColorAt(i, c.setRGB(...srgb([0.25, 0.27, 0.28])));
    });
    sm.castShadow = true;
    sm.frustumCulled = false;
    rm.count = r;
    scene.add(sm);

    // roads: ribbons draped on the terrain
    const pos = [], idx = [];
    for (const rd of roads) {
      const base = pos.length / 3;
      for (let k = 0; k < rd.pts.length; k++) {
        const a = rd.pts[Math.max(0, k - 1)], b = rd.pts[Math.min(rd.pts.length - 1, k + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const [x, z] = rd.pts[k];
        for (const sd of [-1, 1]) {
          const px = x - dz * sd * rd.w / 2, pz = z + dx * sd * rd.w / 2;
          pos.push(px, Math.max(W.heightAt(px, pz), W.heightAt(x, z)) + 0.25, pz);
        }
        if (k > 0) { const i0 = base + (k - 1) * 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    roadMat.onBeforeCompile = function (shader) { GLSL.addCloudShadow(shader); };
    const road = new THREE.Mesh(rg, roadMat);
    road.receiveShadow = true;
    scene.add(road);
  };

  window.TOWNS = T;
})();
