// TRAIN: procedural coaster cars (local frame: -Z forward, +X right, +Y up, rails at y = 0), riders and derailment.
(function () {
  'use strict';
  const T = TRACK, S = SCENERY;
  const TR = { cars: [], riders: [], derailed: false };

  const M = {};
  function mats() {
    M.paint = S.patch(new THREE.MeshPhysicalMaterial({ color: 0xd8180e, roughness: 0.35, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 0.7 }));
    M.stripe = S.patch(new THREE.MeshPhysicalMaterial({ color: 0xffb020, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 }));
    M.seat = S.patch(new THREE.MeshStandardMaterial({ color: 0x1c2550, roughness: 0.75 }));
    M.chassis = S.patch(new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.45, metalness: 0.8 }));
    M.wheel = S.patch(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 }));
    M.chrome = S.patch(new THREE.MeshStandardMaterial({ color: 0xf0f0f4, roughness: 0.12, metalness: 1, envMapIntensity: 1.5 }));
    M.bar = S.patch(new THREE.MeshStandardMaterial({ color: 0xffc22a, roughness: 0.4, metalness: 0.2 }));
    M.light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4cc, emissiveIntensity: 3 });
    M.skin = [0xf1c7a5, 0xd9a27a, 0x9a6440, 0xf6d5bd, 0x6e4529].map(c => S.patch(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })));
    M.hair = [0x2a1a10, 0x6a4020, 0xd9b060, 0x111111, 0xa04020].map(c => S.patch(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })));
    M.shirt = [0x2f6fe0, 0x40b040, 0xe060c0, 0xf0d020, 0xffffff, 0x20b0b0, 0xff7020, 0x8040d0].map(c => S.patch(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })));
  }

  const L = 2.5;   // body length
  function sideProfile(front) {
    // (f, y): f > 0 is forward. Shape in the plane, later rotated so f -> -Z and extruded along X.
    const s = new THREE.Shape();
    const r = -L / 2;
    s.moveTo(r, 0.32);
    if (front) {
      s.lineTo(L / 2 + 0.75, 0.32);
      s.quadraticCurveTo(L / 2 + 1.05, 0.34, L / 2 + 1.0, 0.58);
      s.quadraticCurveTo(L / 2 + 0.6, 0.86, L / 2 - 0.05, 0.92);
    } else {
      s.lineTo(L / 2, 0.32);
      s.quadraticCurveTo(L / 2 + 0.12, 0.6, L / 2 - 0.02, 0.98);
    }
    s.lineTo(0.95, 0.98);
    s.quadraticCurveTo(0.55, 0.80, 0.2, 0.92);
    s.lineTo(-0.25, 0.98);
    s.quadraticCurveTo(-0.6, 0.80, -0.95, 0.92);
    s.lineTo(r + 0.05, 1.22);
    s.quadraticCurveTo(r - 0.08, 1.2, r, 1.0);
    s.lineTo(r, 0.32);
    return s;
  }
  function stripeProfile(front) {
    const s = new THREE.Shape();
    const end = front ? L / 2 + 0.98 : L / 2 + 0.05;
    s.moveTo(-L / 2, 0.55); s.lineTo(end - 0.05, 0.55);
    s.lineTo(end, 0.62); s.lineTo(end - 0.05, 0.68); s.lineTo(-L / 2, 0.68); s.closePath();
    return s;
  }
  function extrudeSide(shape, depth, bevel) {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
    g.rotateY(Math.PI / 2);   // shape x -> -Z, extrusion -> +X
    return g;
  }

  // Box with rounded edges (extruded rounded rectangle with bevel)
  function roundBox(w, h, d, r) {
    const sh = new THREE.Shape();
    const x = -w / 2 + r, y = -h / 2 + r, ww = w - 2 * r, hh = h - 2 * r;
    sh.moveTo(x, y); sh.lineTo(x + ww, y); sh.lineTo(x + ww, y + hh); sh.lineTo(x, y + hh); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 4, curveSegments: 4 });
    g.translate(0, 0, -(d - 2 * r) / 2);
    g.computeVertexNormals();
    return g;
  }

  function mesh(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  function makeRider(rnd, parent, x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0.55, z);
    const shirt = M.shirt[Math.floor(rnd() * M.shirt.length)];
    const skinI = Math.floor(rnd() * M.skin.length);
    const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 10), shirt, 0, 0.36, 0.06, g);
    torso.scale.set(1, 1, 0.75);
    mesh(new THREE.SphereGeometry(0.115, 16, 12), M.skin[skinI], 0, 0.78, 0.04, g);
    const hair = mesh(new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair[Math.floor(rnd() * M.hair.length)], 0, 0.80, 0.06, g);
    hair.rotation.x = -0.25;
    const arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.21, 0.56, 0.04);
      const arm = mesh(new THREE.CapsuleGeometry(0.05, 0.42, 4, 8), shirt, 0, 0.26, 0, pivot);
      mesh(new THREE.SphereGeometry(0.055, 8, 6), M.skin[skinI], 0, 0.52, 0, pivot);
      void arm;
      g.add(pivot);
      arms.push({ pivot, sx });
    }
    parent.add(g);
    return { group: g, arms, excite: 0, phase: rnd() * 10, brave: 0.3 + rnd() * 0.7 };
  }

  function makeCar(front, rnd) {
    const car = new THREE.Group();
    const width = 1.5;
    // side panels
    const sp = sideProfile(front);
    const right = mesh(extrudeSide(sp, 0.06, 0.03), M.paint, width / 2 - 0.06, 0, 0, car);
    const left = mesh(extrudeSide(sp, 0.06, 0.03), M.paint, -width / 2, 0, 0, car);
    void right; void left;
    const st = stripeProfile(front);
    mesh(extrudeSide(st, 0.02, 0.005), M.stripe, width / 2 + 0.01, 0, 0, car);
    mesh(extrudeSide(st, 0.02, 0.005), M.stripe, -width / 2 - 0.05, 0, 0, car);
    // floor and walls
    mesh(new THREE.BoxGeometry(width, 0.1, L), M.paint, 0, 0.37, 0, car);
    mesh(new THREE.BoxGeometry(width - 0.05, 0.62, 0.08), M.paint, 0, 0.68, L / 2 - 0.04, car);
    if (front) {
      // nose: a solid rounded block filling the front
      const nose = extrudeSide(sideProfile(true), width - 0.1, 0.04);
      // keep only the nose part visible by clipping with a box: simpler to build a dedicated nose shape
      nose.dispose();
      const ns = new THREE.Shape();
      ns.moveTo(L / 2 - 0.1, 0.32); ns.lineTo(L / 2 + 0.75, 0.32);
      ns.quadraticCurveTo(L / 2 + 1.03, 0.34, L / 2 + 0.98, 0.58);
      ns.quadraticCurveTo(L / 2 + 0.6, 0.84, L / 2 - 0.05, 0.88);
      ns.lineTo(L / 2 - 0.1, 0.88); ns.closePath();
      mesh(extrudeSide(ns, width - 0.14, 0.05), M.paint, -(width - 0.14) / 2, 0, 0, car);
      // chevron and headlights
      const chev = new THREE.Shape();
      chev.moveTo(0, 0); chev.lineTo(0.35, 0.22); chev.lineTo(0, 0.44); chev.lineTo(-0.12, 0.44); chev.lineTo(0.2, 0.22); chev.lineTo(-0.12, 0); chev.closePath();
      const cg = new THREE.ExtrudeGeometry(chev, { depth: 0.03, bevelEnabled: false });
      cg.rotateX(-Math.PI / 2); cg.rotateY(Math.PI / 2);
      const c1 = mesh(cg, M.stripe, 0.22, 0.91, -(L / 2 + 0.25), car); c1.rotation.x = -0.12;
      for (const sx of [-0.45, 0.45]) {
        const hl = mesh(new THREE.SphereGeometry(0.075, 12, 8), M.light, sx, 0.6, -(L / 2 + 0.98), car);
        hl.scale.z = 0.5;
        mesh(new THREE.TorusGeometry(0.08, 0.018, 6, 16), M.chrome, sx, 0.6, -(L / 2 + 0.985), car);
      }
      // grab bar on the dash
      const gb = new THREE.CylinderGeometry(0.03, 0.03, width - 0.3, 8); gb.rotateZ(Math.PI / 2);
      mesh(gb, M.chrome, 0, 0.98, -(L / 2) + 0.05, car);
    } else {
      mesh(new THREE.BoxGeometry(width - 0.05, 0.58, 0.08), M.paint, 0, 0.66, -L / 2 + 0.04, car);
    }
    // seats: two rows of two
    const rows = [-0.48, 0.62];
    const riderSlots = [];
    for (const rz of rows) {
      for (const sx of [-0.33, 0.33]) {
        mesh(roundBox(0.56, 0.14, 0.5, 0.05), M.seat, sx, 0.5, rz, car);
        const back = mesh(roundBox(0.56, 0.62, 0.14, 0.06), M.seat, sx, 0.84, rz + 0.3, car);
        back.rotation.x = 0.14;
        const hr = mesh(roundBox(0.3, 0.26, 0.15, 0.07), M.seat, sx, 1.26, rz + 0.36, car);
        hr.rotation.x = 0.14;
        // lap bar
        const lb = new THREE.TorusGeometry(0.18, 0.03, 6, 14, Math.PI);
        const bar = mesh(lb, M.bar, sx, 0.78, rz - 0.22, car);
        bar.rotation.y = Math.PI / 2; bar.rotation.z = Math.PI;
        riderSlots.push([sx, rz]);
      }
    }
    // chassis and wheel assemblies (around each rail)
    mesh(new THREE.BoxGeometry(0.5, 0.16, L - 0.3), M.chassis, 0, 0.26, 0, car);
    const axle = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 14); axle.rotateZ(Math.PI / 2);
    const sideW = new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12);
    for (const fz of [-0.85, 0.85]) {
      const block = new THREE.BoxGeometry(1.35, 0.1, 0.3);
      mesh(block, M.chassis, 0, 0.26, fz, car);
      for (const sx of [-0.55, 0.55]) {
        mesh(new THREE.BoxGeometry(0.2, 0.42, 0.42), M.chassis, sx + Math.sign(sx) * 0.13, 0.08, fz, car);
        for (const dz of [-0.13, 0.13]) {
          mesh(axle, M.wheel, sx, 0.14, fz + dz, car);       // road wheels
          mesh(axle, M.wheel, sx, -0.14, fz + dz, car);      // upstop wheels
        }
        mesh(sideW, M.wheel, sx + Math.sign(sx) * 0.11, 0, fz, car);   // guide wheel
      }
    }
    // coupling
    mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8).rotateX(Math.PI / 2), M.chrome, 0, 0.26, L / 2 + 0.2, car);
    const riders = riderSlots.map(([sx, rz]) => makeRider(rnd, car, sx, rz));
    car.matrixAutoUpdate = false;
    return { group: car, riders, vel: new THREE.Vector3(), ang: new THREE.Vector3() };
  }

  TR.build = function (scene) {
    mats();
    const rnd = UTIL.rng(2026);
    for (let c = 0; c < T.N_CARS; c++) {
      const car = makeCar(c === 0, rnd);
      scene.add(car.group);
      TR.cars.push(car);
      car.riders.forEach(r => TR.riders.push(r));
    }
    // seat positions for the POV cameras (front-left seat of the first car, back-left of the last)
    TR.seatFront = { car: 0, rider: 0, pos: new THREE.Vector3(-0.33, 1.46, -0.45) };
    TR.seatRear = { car: T.N_CARS - 1, rider: 2, pos: new THREE.Vector3(-0.33, 1.46, 0.65) };
  };

  const fr = { pos: [0, 0, 0], t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] };
  const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  // Place the cars along the track; returns nothing. sFront = arc length of the front car's center.
  TR.place = function (sFront, dt, gVert, speed) {
    if (TR.derailed) return;
    for (let c = 0; c < TR.cars.length; c++) {
      const car = TR.cars[c];
      // orient by the chord between the two bogies, up from the frame
      const sc = T.carS(sFront, c);
      T.frameAt(sc, fr);
      vy.set(fr.u[0], fr.u[1], fr.u[2]);
      vz.set(-fr.t[0], -fr.t[1], -fr.t[2]);
      vx.crossVectors(vy, vz).normalize();
      car.group.matrix.makeBasis(vx, vy, vz);
      car.group.matrix.setPosition(fr.pos[0], fr.pos[1], fr.pos[2]);
      car.group.matrixWorldNeedsUpdate = true;
    }
    // riders: arms up when it gets exciting (drops, airtime, high speed)
    const excite = (gVert !== undefined && (gVert < 0.55 || gVert > 2.6)) || speed > 24 ? 1 : 0;
    const t = performance.now() / 1000;
    TR.riders.forEach((r, i) => {
      const target = excite * (r.brave > 0.45 ? 1 : 0.35);
      r.excite += (target - r.excite) * Math.min(1, dt * (target > r.excite ? 3 : 1.2));
      const wave = Math.sin(t * 7 + r.phase) * 0.12 * r.excite;
      r.arms.forEach(a => {
        // down (holding the bar) to up in a V
        a.pivot.rotation.x = -(1 - r.excite) * 2.35 + wave;
        a.pivot.rotation.z = -a.sx * (r.excite * 0.45);
      });
      void i;
    });
  };

  // Derailment: cars fly off with the current velocity and tumble until they hit the ground
  TR.derail = function (sFront, v) {
    TR.derailed = true;
    TR.cars.forEach((car, c) => {
      const sc = T.carS(sFront, c);
      T.frameAt(sc, fr);
      car.vel.set(fr.t[0], fr.t[1], fr.t[2]).multiplyScalar(v);
      car.vel.x += fr.u[0] * 3 + (Math.random() - 0.5) * 3;
      car.vel.y += fr.u[1] * 3 + Math.random() * 2;
      car.vel.z += fr.u[2] * 3 + (Math.random() - 0.5) * 3;
      car.ang.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4);
      car.pos = new THREE.Vector3(fr.pos[0], fr.pos[1], fr.pos[2]);
      car.quat = new THREE.Quaternion().setFromRotationMatrix(car.group.matrix);
    });
  };
  const dq = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  TR.updateDerail = function (dt) {
    TR.cars.forEach(car => {
      car.vel.y -= 9.81 * dt;
      car.vel.multiplyScalar(1 - 0.05 * dt);
      car.pos.addScaledVector(car.vel, dt);
      const g = S.heightAt(car.pos.x, car.pos.z) + 0.5;
      if (car.pos.y < g) {
        car.pos.y = g;
        if (car.vel.y < 0) car.vel.y *= -0.3;
        car.vel.x *= 0.6; car.vel.z *= 0.6;
        car.ang.multiplyScalar(0.6);
      }
      e.set(car.ang.x * dt, car.ang.y * dt, car.ang.z * dt);
      dq.setFromEuler(e);
      car.quat.multiply(dq);
      car.group.matrix.compose(car.pos, car.quat, one);
      car.group.matrixWorldNeedsUpdate = true;
    });
  };
  TR.reset = function () { TR.derailed = false; };

  // Hide the rider sitting where the POV camera is
  TR.hideRider = function (seat) {
    TR.cars.forEach(c => c.riders.forEach(r => { r.group.visible = true; }));
    if (seat) TR.cars[seat.car].riders[seat.rider].group.visible = false;
  };

  // World matrix of a car (for cameras)
  TR.carMatrix = function (c) { return TR.cars[c].group.matrix; };

  window.TRAIN = TR;
})();
