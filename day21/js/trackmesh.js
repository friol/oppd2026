// TRACKMESH: tubular rails and spine swept along the banked frames, cross ties, steel supports with footings.
(function () {
  'use strict';
  const T = TRACK, S = SCENERY;
  const TM = {};
  TM.RAIL_X = 0.55;      // half gauge
  TM.SPINE_Y = -0.62;    // spine center below the rail line
  TM.RAIL_R = 0.065;
  TM.SPINE_R = 0.21;

  // Sweep a tube along the track. offset(i) -> [dr, du] in the frame; returns BufferGeometry
  function sweep(step, radius, segs, dr, du, range) {
    const N = T.N;
    const i0 = range ? range[0] : 0, i1 = range ? range[1] : N;
    const closed = !range;
    const rings = [];
    for (let i = i0; i < i1; i += step) rings.push(i % N);
    if (!closed) rings.push(i1 % N);
    const pos = [], nor = [], idx = [];
    for (const i of rings) {
      const P = T.P[i], Uv = T.U[i], R = T.R[i];
      const c = [P[0] + R[0] * dr + Uv[0] * du, P[1] + R[1] * dr + Uv[1] * du, P[2] + R[2] * dr + Uv[2] * du];
      for (let k = 0; k < segs; k++) {
        const a = k / segs * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const n = [Uv[0] * ca + R[0] * sa, Uv[1] * ca + R[1] * sa, Uv[2] * ca + R[2] * sa];
        pos.push(c[0] + n[0] * radius, c[1] + n[1] * radius, c[2] + n[2] * radius);
        nor.push(n[0], n[1], n[2]);
      }
    }
    const nr = rings.length, last = closed ? nr : nr - 1;
    for (let r = 0; r < last; r++) {
      const a = r * segs, b = ((r + 1) % nr) * segs;
      for (let k = 0; k < segs; k++) {
        const k1 = (k + 1) % segs;
        idx.push(a + k, a + k1, b + k, a + k1, b + k1, b + k);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  // Flat ribbon (catwalk floor) along a range
  function ribbon(step, dr, du, width, range) {
    const pos = [], nor = [], idx = [];
    let n = 0;
    for (let i = range[0]; i <= range[1]; i += step) {
      const P = T.P[i], Uv = T.U[i], R = T.R[i];
      for (const w of [-width / 2, width / 2]) {
        pos.push(P[0] + R[0] * (dr + w) + Uv[0] * du, P[1] + R[1] * (dr + w) + Uv[1] * du, P[2] + R[2] * (dr + w) + Uv[2] * du);
        nor.push(Uv[0], Uv[1], Uv[2]);
      }
      if (n > 0) { const a = (n - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      n++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  // Box between two points (local helper for the tie geometry)
  function strut(a, b, w, h) {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.BoxGeometry(w, h, d.length());
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, new THREE.Vector3(0, 0, 1).cross(d).lengthSq() > 1e-6 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    g.applyMatrix4(m);
    return g;
  }

  TM.frameMatrix = function (i, m) {
    const P = T.P[i], Uv = T.U[i], R = T.R[i], Tn = T.T[i];
    m.makeBasis(new THREE.Vector3(R[0], R[1], R[2]), new THREE.Vector3(Uv[0], Uv[1], Uv[2]), new THREE.Vector3(-Tn[0], -Tn[1], -Tn[2]));
    m.setPosition(P[0], P[1], P[2]);
    return m;
  };

  TM.build = function (scene) {
    const paint = S.patch(new THREE.MeshPhysicalMaterial({ color: 0xe8705f, roughness: 0.32, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 1.2 }));
    const steel = S.patch(new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.3 }));
    const concrete = S.patch(new THREE.MeshStandardMaterial({ color: 0x8e8e90, roughness: 0.9 }));
    const dark = S.patch(new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.5 }));
    TM.materials = { paint, steel, concrete, dark };
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };

    add(sweep(2, TM.RAIL_R, 10, TM.RAIL_X, 0), paint);
    add(sweep(2, TM.RAIL_R, 10, -TM.RAIL_X, 0), paint);
    add(sweep(2, TM.SPINE_R, 14, 0, TM.SPINE_Y), paint);

    // Cross ties (instanced): V-shaped struts from each rail to the spine + rail plates
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const tieParts = [
      strut(v(TM.RAIL_X, -0.04, 0), v(0.12, TM.SPINE_Y + 0.12, 0), 0.07, 0.11),
      strut(v(-TM.RAIL_X, -0.04, 0), v(-0.12, TM.SPINE_Y + 0.12, 0), 0.07, 0.11),
      new THREE.BoxGeometry(0.5, 0.14, 0.12).translate(0, TM.SPINE_Y + 0.12, 0),
    ];
    const tieGeo = S.merge(tieParts.map(g => ({ geo: g })));
    const step = Math.round(1.2 / T.ds);
    const nTies = Math.floor(T.N / step);
    const ties = new THREE.InstancedMesh(tieGeo, paint, nTies);
    const m = new THREE.Matrix4();
    for (let k = 0; k < nTies; k++) ties.setMatrixAt(k, TM.frameMatrix(k * step, m));
    ties.castShadow = true; ties.receiveShadow = true;
    scene.add(ties);

    // Lift hill: chain trough, catwalk and handrail
    const lift = [];
    for (let i = 0; i < T.N; i++) if (T.zone[i] === T.Z.lift) lift.push(i);
    if (lift.length) {
      const r = [lift[0], lift[lift.length - 1]];
      add(ribbon(2, 0, -0.05, 0.18, r), dark);
      const walk = ribbon(2, -1.25, -0.25, 0.75, r);
      add(walk, S.patch(new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide })));
      add(sweep(4, 0.03, 6, -1.6, 0.75, r), steel);
      add(sweep(4, 0.025, 6, -1.6, 0.35, r), steel);
      // walkway brackets
      const brGeo = new THREE.BoxGeometry(1.3, 0.06, 0.06).translate(-1.0, -0.28, 0);
      const postGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 5).translate(-1.6, 0.25, 0);
      const bgeo = S.merge([{ geo: brGeo }, { geo: postGeo }]);
      const st = Math.round(2.4 / T.ds);
      const cnt = Math.floor(lift.length / st);
      const br = new THREE.InstancedMesh(bgeo, steel, cnt);
      for (let k = 0; k < cnt; k++) br.setMatrixAt(k, TM.frameMatrix(lift[k * st], m));
      br.castShadow = true; scene.add(br);
    }

    buildSupports(scene, steel, concrete);
  };

  // ---------- Supports ----------
  function buildSupports(scene, steel, concrete) {
    // spatial hash of track samples for clearance tests
    const CELL = 4, grid = new Map();
    const key = (x, z) => Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
    for (let i = 0; i < T.N; i += 2) {
      const p = T.P[i], k = key(p[0], p[2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    TM.nearTrack = function (x, z, r) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), n = Math.ceil(r / CELL);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
        const l = grid.get((cx + a) + ',' + (cz + b));
        if (!l) continue;
        for (const i of l) { const p = T.P[i]; if (Math.hypot(p[0] - x, p[2] - z) < r) return true; }
      }
      return false;
    };
    function blocked(x, z, yTop, self, rad) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const l = grid.get((cx + a) + ',' + (cz + b));
        if (!l) continue;
        for (const i of l) {
          let d = Math.abs(i - self); d = Math.min(d, T.N - d);
          if (d * T.ds < 6) continue;
          const p = T.P[i];
          if (p[1] < yTop + 1.6 && Math.hypot(p[0] - x, p[2] - z) < rad + 1.6) return true;
        }
      }
      return false;
    }

    const cyl = [], foot = [];
    const col = (a, b, r) => cyl.push({ a, b, r });
    const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    const every = Math.round(7.5 / T.ds);
    for (let i = 0; i < T.N; i += every) {
      const z = T.zone[i];
      if (z === T.Z.station) continue;
      const Uv = T.U[i];
      if (Uv[1] < 0.05) continue;                      // inverted or vertical: no support from below
      const P = V3(T.P[i]), U3 = V3(Uv), R3 = V3(T.R[i]);
      const spine = P.clone().addScaledVector(U3, TM.SPINE_Y);
      // attachment point: below the spine, pushed further away from the rails on banked sections
      const att = spine.clone().addScaledVector(U3, -TM.SPINE_R * 0.8 - (1 - Uv[1]) * 0.9);
      const g = S.heightAt(att.x, att.z);
      const hgt = att.y - g;
      if (hgt < 0.25) continue;
      const r = Math.min(0.42, 0.16 + hgt * 0.007);
      if (blocked(att.x, att.z, att.y, i, r)) continue;
      // arm from the spine to the column top
      if (att.distanceTo(spine) > 0.05) col(spine, att, 0.11);
      if (hgt > 14 && z !== T.Z.free || hgt > 18) {
        // A-frame with two legs splayed across the track and horizontal braces
        const side = new THREE.Vector3(-T.T[i][2], 0, T.T[i][0]).normalize();
        const spread = 1.0 + hgt * 0.09;
        const feet = [att.clone().addScaledVector(side, spread), att.clone().addScaledVector(side, -spread)];
        feet.forEach(f => { f.y = S.heightAt(f.x, f.z); });
        if (blocked(feet[0].x, feet[0].z, att.y, i, r) || blocked(feet[1].x, feet[1].z, att.y, i, r)) continue;
        feet.forEach(f => { col(f, att, r); foot.push(f); });
        for (let y = 7; y < hgt - 3; y += 7) {
          const t = y / hgt;
          const a = feet[0].clone().lerp(att, t), b = feet[1].clone().lerp(att, t);
          col(a, b, r * 0.45);
          if (y + 7 < hgt - 3) {
            const a2 = feet[0].clone().lerp(att, (y + 7) / hgt);
            col(b, a2, r * 0.3);
          }
        }
      } else {
        const base = new THREE.Vector3(att.x, g, att.z);
        col(base, att, r);
        foot.push(base);
      }
    }
    const geo = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
    geo.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, steel, cyl.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    cyl.forEach((c, k) => {
      const d = new THREE.Vector3().subVectors(c.b, c.a);
      const l = d.length();
      q.setFromUnitVectors(up, d.normalize());
      sc.set(c.r, l, c.r);
      m.compose(c.a, q, sc);
      im.setMatrixAt(k, m);
    });
    im.castShadow = true; im.receiveShadow = true;
    scene.add(im);
    const fgeo = new THREE.CylinderGeometry(0.75, 0.85, 0.6, 14);
    const fm = new THREE.InstancedMesh(fgeo, concrete, foot.length);
    foot.forEach((f, k) => { m.makeTranslation(f.x, f.y + 0.15, f.z); fm.setMatrixAt(k, m); });
    fm.castShadow = true; fm.receiveShadow = true;
    scene.add(fm);
    TM.supportCount = cyl.length;
  }

  window.TRACKMESH = TM;
})();
