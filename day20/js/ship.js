// ship.js - the player's fighter jet (Su-35): model setup, flight model, cameras, engine glow.
(function () {
  'use strict';
  const S = {
    group: new THREE.Group(),     // flight frame: -Z forward, +Y up, +X right
    model: null,
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(),     // m/s
    speed: 120,
    throttle: 0.45,
    boost: 0,
    rates: new THREE.Vector3(),   // pitch, yaw, roll rates (rad/s)
    camMode: 0,                   // 0 chase, 1 cockpit, 2 cinematic
    camQuat: new THREE.Quaternion(),
    look: { yaw: 0, pitch: 0 },   // free look offset
    crashed: 0,
    vspeed: 0,
    agl: 0,
    eye: new THREE.Vector3(0, 1.1, -1.5),
    glows: []
  };
  const MIN_SPEED = 40, MAX_SPEED = 290, BOOST_SPEED = 520;
  const LENGTH = 21.9;            // ship length in meters (a real Su-35)
  const CAM_K = LENGTH / 12.5 * 0.8; // camera distances were tuned for a 12.5 m ship; 0.8 brings the jet a bit closer

  // ship.glb (tools/convert_ship.py): static mesh with its nose toward -Z, plus empties
  // Nozzle_1 / Nozzle_2 (engine exits) and Eye (pilot's head, for the cockpit camera).
  S.init = function (scene, overlay) {
    const loader = new THREE.GLTFLoader();
    const bin = Uint8Array.from(atob(window.SHIP_GLB), c => c.charCodeAt(0)).buffer;
    return new Promise((resolve) => {
      loader.parse(bin, '', (gltf) => {
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3();
        const nozzles = [];
        let eye = null;
        root.traverse(o => {
          if (/^Nozzle_\d$/.test(o.name)) nozzles.push(o);
          if (o.name === 'Eye') eye = o;
          if (o.isMesh) {
            box.expandByObject(o);
            o.castShadow = true; o.receiveShadow = true;
            const ms = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of ms) {
              if (!m) continue;
              // glass (canopy, HUD) must not write depth: the atmosphere pass draws the sky where
              // the depth is empty, so a depth-writing pane would turn the sky behind it black
              if (m.transparent) m.depthWrite = false;
              m.envMapIntensity = 1.0;
            }
          }
        });
        const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const scale = LENGTH / size.z;
        const pivot = new THREE.Group();
        root.position.copy(center).multiplyScalar(-1);
        pivot.add(root);
        pivot.scale.setScalar(scale);
        S.model = new THREE.Group();
        S.model.add(pivot);
        S.group.add(S.model);
        S.group.updateMatrixWorld(true);
        // cockpit eye point (in the flight frame: the group is still at the origin)
        if (eye) eye.getWorldPosition(S.eye);
        S.eye.y += 0.18; // a little higher, to look over the HUD frame
        // engine glows at the nozzle exits (each glow follows its empty every frame)
        const glowTex = glowTexture();
        // the empties' scale is the nozzle radius (model units): convert it to meters
        S.nozzleR = nozzles.length ? new THREE.Vector3().setFromMatrixScale(nozzles[0].matrixWorld).x : 0.4;
        for (const nz of nozzles) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3, 1.3, 0.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
          sp.scale.setScalar(1.3);
          sp.userData.mesh = nz;
          sp.userData.local = new THREE.Vector3(); // the empty's origin (localToWorld also applies its scale, but 0 stays 0)
          S.glows.push(sp);
          overlay.add(sp);
        }
        if (!nozzles.length) console.warn('Ship: no Nozzle_ empties found');
        scene.add(S.group);
        resolve();
      }, (err) => { console.error('Ship model load failed', err); scene.add(S.group); resolve(); });
    });
  };

  function glowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.7)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  S.reset = function (x, y, z, dirx, dirz) {
    S.pos.set(x, y, z);
    const yaw = Math.atan2(-dirx, -dirz);
    S.quat.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    S.camQuat.copy(S.quat);
    S.speed = 140; S.throttle = 0.45; S.rates.set(0, 0, 0);
    S.vel.set(0, 0, -1).applyQuaternion(S.quat).multiplyScalar(S.speed);
    S.agl = y - Math.max(WORLD.heightAt(x, z), 0);
  };

  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), dq = new THREE.Quaternion(), tmp = new THREE.Vector3();

  // input: { pitch, roll, yaw in -1..1, throttleDelta, boost }
  S.update = function (dt, input) {
    if (S.crashed > 0) { S.crashed -= dt; }
    S.throttle = THREE.MathUtils.clamp(S.throttle + input.throttleDelta * dt * 0.5, 0, 1);
    S.boost += ((input.boost ? 1 : 0) - S.boost) * Math.min(1, dt * 2.5);
    const target = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * S.throttle + (BOOST_SPEED - MAX_SPEED) * S.boost;

    fwd.set(0, 0, -1).applyQuaternion(S.quat);
    up.set(0, 1, 0).applyQuaternion(S.quat);
    right.set(1, 0, 0).applyQuaternion(S.quat);

    // control authority grows with airspeed
    const auth = THREE.MathUtils.clamp(S.speed / 90, 0.35, 1);
    const want = tmp.set(input.pitch * 1.5 * auth, -input.yaw * 0.55 * auth, -input.roll * 2.8 * auth);
    // coordinated turn: a banked wing slowly yaws the nose round
    const bank = Math.atan2(right.y, up.y);
    want.y += Math.sin(bank) * 9.81 / Math.max(S.speed, 60) * 0.9 * Math.max(0, up.y);
    S.rates.lerp(want, Math.min(1, dt * 5));
    dq.setFromEuler(new THREE.Euler(S.rates.x * dt, S.rates.y * dt, S.rates.z * dt, 'YXZ'));
    S.quat.multiply(dq).normalize();
    fwd.set(0, 0, -1).applyQuaternion(S.quat);

    // speed: engine pulls toward the throttle speed, gravity along the path
    S.speed += (target - S.speed) * dt * 0.35;
    S.speed += -9.81 * fwd.y * dt * 0.8;
    S.speed = Math.max(25, S.speed);
    // the velocity vector follows the nose (lift); a little sink at low speed
    const align = Math.min(1, dt * (1.5 + S.speed / 60));
    S.vel.lerp(tmp.copy(fwd).multiplyScalar(S.speed), align);
    S.vel.y -= Math.max(0, 75 - S.speed) * 0.12 * dt * 10;
    S.vel.setLength(Math.max(S.vel.length(), 1));
    const oldY = S.pos.y;
    S.pos.addScaledVector(S.vel, dt);
    S.pos.y = Math.min(S.pos.y, 14000);
    S.vspeed = (S.pos.y - oldY) / Math.max(dt, 1e-4);

    // ground / water collision
    const ground = Math.max(WORLD.heightAt(S.pos.x, S.pos.z), 0);
    S.agl = S.pos.y - ground;
    let crash = false;
    if (S.agl < 1.8) crash = true;
    S.group.position.copy(S.pos);
    S.group.quaternion.copy(S.quat);
    S.group.updateMatrixWorld(true);
    // engine glow follows the throttle and the nozzles
    const g = 0.35 + S.throttle * 0.45 + S.boost * 0.9;
    for (const sp of S.glows) {
      sp.position.copy(sp.userData.local);
      sp.userData.mesh.localToWorld(sp.position);
      sp.scale.setScalar(g * (S.glowBoost || 1) * (S.nozzleR / 0.4) * (0.95 + Math.random() * 0.1));
    }
    return crash;
  };

  const camOff = new THREE.Vector3(), lookAt = new THREE.Vector3(), lq = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  let orbit = 0;
  S.updateCamera = function (camera, dt) {
    S.camQuat.slerp(S.quat, 1 - Math.exp(-dt * (S.camMode === 1 ? 30 : 4.5)));
    S.look.yaw *= S.look.hold ? 1 : Math.exp(-dt * 3);
    S.look.pitch *= S.look.hold ? 1 : Math.exp(-dt * 3);
    e.set(S.look.pitch, S.look.yaw, 0);
    lq.setFromEuler(e);
    const fovBase = 62 + Math.max(0, S.speed - 150) / 370 * 14 + (S.fovKick || 0);
    if (S.camMode === 1) {
      // cockpit
      camera.position.copy(S.eye).applyQuaternion(S.quat).add(S.pos);
      camera.quaternion.copy(S.quat).multiply(lq);
      camera.near = 0.15;
      S.model.visible = true;
    } else if (S.camMode === 2) {
      // cinematic orbit
      orbit += dt * 0.15;
      camOff.set(Math.sin(orbit) * 34 * CAM_K, (7 + Math.sin(orbit * 0.7) * 5) * CAM_K, Math.cos(orbit) * 34 * CAM_K);
      camera.position.copy(S.pos).add(camOff);
      camera.up.set(0, 1, 0);
      camera.lookAt(S.pos);
      camera.near = 1.0;
    } else {
      const q = S.camQuat.clone().multiply(lq);
      camOff.set(0, 4.2 * CAM_K, 24 * CAM_K).applyQuaternion(q);
      camera.position.copy(S.pos).add(camOff);
      lookAt.set(0, 1.6 * CAM_K, -30 * CAM_K).applyQuaternion(q).add(S.pos);
      camera.up.set(0, 1, 0).applyQuaternion(q);
      camera.lookAt(lookAt);
      camera.near = 1.0;
      // keep the camera above the ground
      const g = Math.max(WORLD.heightAt(camera.position.x, camera.position.z), 0) + 2;
      if (camera.position.y < g) camera.position.y = g;
    }
    // high speed buzz
    const shake = Math.max(0, S.speed - 300) / 220 * 0.04;
    if (shake > 0) camera.rotateZ((Math.random() - 0.5) * shake * 0.2);
    camera.fov += (fovBase - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  window.SHIP = S;
})();
