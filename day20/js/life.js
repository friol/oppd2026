// life.js - sky traffic: bird flocks (V formations of geese, starling murmurations,
// soaring raptors) and sporadic airliners at cruise altitude with contrails.
(function () {
  'use strict';
  const U = GLSL.U;
  const L = { flocks: [], planes: [], birdCount: 0 };
  const MAX_BIRDS = 900;
  let birdMesh, flapAttr, planeProto = null, planeInfo = null, overlay, scene;
  let planeTimer = 12;

  // ---------------- birds ----------------
  function birdGeometry() {
    // unit wingspan along X, forward = -Z, wings split in inner/outer panels so they bend
    const v = [
      // body (two triangles, a thin diamond seen from above and the side)
      0, 0, -0.32, 0.045, 0, 0.0, 0, 0, 0.26,
      0, 0, -0.32, 0, 0, 0.26, -0.045, 0, 0.0,
      0, 0, -0.32, 0, 0.04, 0.0, 0, 0, 0.26,
      // left wing: inner + outer panel
      0, 0, -0.1, -0.25, 0, -0.06, 0, 0, 0.08,
      -0.25, 0, -0.06, -0.25, 0, 0.1, 0, 0, 0.08,
      -0.25, 0, -0.06, -0.5, 0, 0.06, -0.25, 0, 0.1,
      // right wing
      0, 0, -0.1, 0, 0, 0.08, 0.25, 0, -0.06,
      0.25, 0, -0.06, 0, 0, 0.08, 0.25, 0, 0.1,
      0.25, 0, -0.06, 0.25, 0, 0.1, 0.5, 0, 0.06,
      // tail
      0, 0, 0.2, -0.07, 0, 0.36, 0.07, 0, 0.36
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }

  function initBirds() {
    const g = birdGeometry();
    flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 3), 3); // freq, phase, glide
    flapAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aFlap', flapAttr);
    const m = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9, side: THREE.DoubleSide });
    m.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = U.uTime;
      shader.vertexShader = 'uniform float uTime; attribute vec3 aFlap;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ax = abs(position.x);
        float glide = aFlap.z;
        float s = sin(uTime * aFlap.x + aFlap.y);
        transformed.y += mix(s * 0.75, 0.06, glide) * pow(ax, 1.3) * 1.6;
        transformed.x *= 1.0 - (1.0 - glide) * 0.15 * max(s, 0.0) * ax;`);
    };
    birdMesh = new THREE.InstancedMesh(g, m, MAX_BIRDS);
    birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    birdMesh.frustumCulled = false;
    birdMesh.count = 0;
    scene.add(birdMesh);
  }

  const TYPES = {
    geese: { span: 1.6, speed: 17, freq: 13, min: 9, max: 27 },
    starlings: { span: 0.38, speed: 15, freq: 42, min: 70, max: 180 },
    raptors: { span: 2.0, speed: 11, freq: 9, min: 1, max: 3 }
  };

  function spawnFlock(camPos, camDir) {
    const r = Math.random();
    const type = r < 0.45 ? 'geese' : r < 0.8 ? 'starlings' : 'raptors';
    const T = TYPES[type];
    // somewhere ahead of the camera, 600..2200 m away
    const a = Math.atan2(camDir.z, camDir.x) + (Math.random() - 0.5) * 2.2;
    const d = 600 + Math.random() * 1600;
    const x = camPos.x + Math.cos(a) * d, z = camPos.z + Math.sin(a) * d;
    const ground = Math.max(0, WORLD.heightAt(x, z));
    const agl = type === 'raptors' ? 150 + Math.random() * 250 : 40 + Math.random() * 300;
    const n = T.min + Math.floor(Math.random() * (T.max - T.min + 1));
    const birds = [];
    for (let i = 0; i < n; i++) {
      let ox, oy, oz;
      if (type === 'geese') {
        // V formation: leader at the tip, two arms trailing behind
        const k = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        ox = side * k * T.span * 1.25; oz = k * T.span * 1.6; oy = (Math.random() - 0.5) * 0.4;
        if (i > 0 && Math.random() < 0.15 && i === n - 1) ox *= 0.6; // a straggler
      } else if (type === 'starlings') {
        const u = Math.random() * 6.283, v = Math.acos(Math.random() * 2 - 1), rr = Math.cbrt(Math.random()) * 26;
        ox = Math.sin(v) * Math.cos(u) * rr; oy = Math.cos(v) * rr * 0.45; oz = Math.sin(v) * Math.sin(u) * rr;
      } else {
        ox = (Math.random() - 0.5) * 300; oy = (Math.random() - 0.5) * 60; oz = (Math.random() - 0.5) * 300;
      }
      birds.push({ ox, oy, oz, ph: Math.random() * 6.28, f: T.freq * (0.9 + Math.random() * 0.2), w1: 0.3 + Math.random() * 0.5, w2: 0.3 + Math.random() * 0.5, w3: 0.3 + Math.random() * 0.5 });
    }
    L.flocks.push({ type, T, pos: new THREE.Vector3(x, ground + agl, z), heading: Math.random() * 6.283, turn: 0, agl, birds, age: 0, circle: Math.random() * 6.28 });
  }

  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sv = new THREE.Vector3(), pv = new THREE.Vector3();

  function updateBirds(dt, t, camPos, camDir) {
    // keep a few flocks around the camera
    for (let i = L.flocks.length - 1; i >= 0; i--) {
      const f = L.flocks[i];
      if (f.pos.distanceTo(camPos) > 4500) L.flocks.splice(i, 1);
    }
    while (L.flocks.length < 7) spawnFlock(camPos, camDir);

    let n = 0;
    for (const f of L.flocks) {
      f.age += dt;
      f.turn += ((Math.sin(t * 0.07 + f.circle) * 0.5) - f.turn) * dt * 0.2;
      if (f.type === 'raptors') f.turn = 0.25; // circling in thermals
      f.heading += f.turn * dt * (f.type === 'geese' ? 0.12 : 1);
      const dx = Math.sin(f.heading), dz = -Math.cos(f.heading);
      f.pos.x += dx * f.T.speed * dt; f.pos.z += dz * f.T.speed * dt;
      // follow the terrain, never below it
      const g = Math.max(0, WORLD.heightAt(f.pos.x + dx * 150, f.pos.z + dz * 150), WORLD.heightAt(f.pos.x, f.pos.z));
      const want = g + f.agl;
      f.pos.y += (want - f.pos.y) * Math.min(1, dt * 0.25);
      const climb = (want - f.pos.y) * 0.002;
      const ch = Math.cos(f.heading), sh = Math.sin(f.heading);
      for (const b of f.birds) {
        if (n >= MAX_BIRDS) break;
        let ox = b.ox, oy = b.oy, oz = b.oz, yaw = f.heading, roll = -f.turn * 0.6;
        if (f.type === 'starlings') {
          // swirling murmuration: each bird orbits inside a breathing cloud
          const s = 1 + 0.35 * Math.sin(t * 0.4 + f.circle);
          ox = b.ox * s + Math.sin(t * b.w1 + b.ph) * 14 + Math.sin(t * 0.23 + f.circle) * 20 * Math.sin(b.oy * 0.1);
          oy = b.oy * s + Math.sin(t * b.w2 * 1.3 + b.ph * 2) * 6;
          oz = b.oz * s + Math.cos(t * b.w3 + b.ph) * 14;
          yaw += Math.cos(t * b.w1 + b.ph) * 0.5; roll = Math.sin(t * b.w2 + b.ph) * 0.6;
        } else if (f.type === 'raptors') {
          const a = t * 0.12 + b.ph;
          ox = b.ox + Math.cos(a) * 60; oz = b.oz + Math.sin(a) * 60; oy = b.oy;
          yaw = -a; roll = -0.35;
        } else {
          ox += Math.sin(t * 0.7 + b.ph) * 0.4; oy += Math.sin(t * 0.9 + b.ph) * 0.3;
        }
        // local offset (x right, z behind) rotated by the heading
        pv.set(f.pos.x + ox * ch - oz * sh, f.pos.y + oy, f.pos.z + ox * sh + oz * ch);
        e.set(climb, -yaw, roll);
        qq.setFromEuler(e);
        sv.setScalar(f.T.span);
        m4.compose(pv, qq, sv);
        birdMesh.setMatrixAt(n, m4);
        const glide = f.type === 'raptors' ? 1 : (Math.sin(t * 0.5 + b.ph * 3) > 0.75 ? 1 : 0);
        flapAttr.setXYZ(n, b.f, b.ph, glide);
        n++;
      }
    }
    birdMesh.count = n;
    birdMesh.instanceMatrix.needsUpdate = true;
    flapAttr.needsUpdate = true;
    L.birdCount = n;
  }

  // ---------------- airliners ----------------
  function setupPlane(gltf) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    // retract the landing gear: hide gear legs and gear doors
    root.traverse(o => { if (/GEAR|COVER/i.test(o.name)) o.visible = false; });
    const box = new THREE.Box3();
    root.traverse(o => { if (o.isMesh && o.visible) box.expandByObject(o); });
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    // long axis = fuselage; the highest vertex (tail fin) marks the rear
    const longX = size.x > size.z;
    let topV = null, topY = -1e9;
    root.traverse(o => {
      if (!o.isMesh || !o.visible) return;
      const p = o.geometry.getAttribute('position'), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 7) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y > topY) { topY = v.y; topV = v.clone(); } }
    });
    const rearSign = longX ? Math.sign(topV.x - center.x) : Math.sign(topV.z - center.z);
    const len = longX ? size.x : size.z;
    const s = 67 / len;
    const pivot = new THREE.Group();
    root.position.copy(center).multiplyScalar(-1);
    pivot.add(root);
    // we want: nose -> -Z, rear -> +Z
    if (longX) pivot.rotation.y = rearSign > 0 ? Math.PI / 2 : -Math.PI / 2;
    else pivot.rotation.y = rearSign > 0 ? 0 : Math.PI;
    pivot.scale.setScalar(s);
    const holder = new THREE.Group();
    holder.add(pivot);
    holder.traverse(o => {
      if (o.isMesh) {
        o.castShadow = false; o.receiveShadow = false;
        if (o.material) { o.material.roughness = 0.45; o.material.metalness = 0.2; }
      }
    });
    // engine positions (for contrails) in holder space
    holder.updateMatrixWorld(true);
    const engines = [];
    holder.traverse(o => {
      if (o.isMesh && /ENGINE/i.test(o.name)) {
        const b = new THREE.Box3().setFromObject(o);
        const c = b.getCenter(new THREE.Vector3());
        c.z = b.max.z + 2; // engine exhaust
        engines.push(c);
      }
    });
    const hb = new THREE.Box3().setFromObject(holder);
    planeInfo = { engines, span: Math.max(hb.max.x, -hb.min.x), wingZ: 0 };
    planeProto = holder;
  }

  const trailVert = /* glsl */`
    attribute float aAlpha;
    varying float vAlpha;
    varying float vDist;
    void main() {
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;
  const trailFrag = /* glsl */`
    uniform vec3 uLightColor;
    uniform vec3 uAmbient;
    varying float vAlpha;
    varying float vDist;
    void main() {
      vec3 c = uLightColor * 0.09 + uAmbient * 0.8;
      float fade = 1.0 - smoothstep(25000.0, 45000.0, vDist);
      gl_FragColor = vec4(c, vAlpha * fade);
    }`;

  function makeTrailMesh() {
    const MAXP = 400 * 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(MAXP * 2), 1).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint32Array(MAXP * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: trailVert, fragmentShader: trailFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uLightColor: U.uLightColor, uAmbient: L.ambient }
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    return mesh;
  }

  function navLight(color, size) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.SpriteMaterial({ map: t, color, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: false, transparent: true });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  }

  function spawnPlane(camPos) {
    if (!planeProto) return;
    const obj = planeProto.clone(true);
    const heading = Math.random() * Math.PI * 2;
    const dx = Math.sin(heading), dz = -Math.cos(heading);
    const lateral = (Math.random() < 0.5 ? -1 : 1) * (800 + Math.random() * 5000);
    const alt = 5600 + Math.random() * 3000;
    const start = new THREE.Vector3(camPos.x - dx * 26000 - dz * lateral, alt, camPos.z - dz * 26000 + dx * lateral);
    obj.position.copy(start);
    obj.rotation.set(0, -heading, 0, 'YXZ');
    scene.add(obj);
    const trail = makeTrailMesh();
    overlay.add(trail);
    const lights = [navLight(new THREE.Color(4, 0.3, 0.2), 0.006), navLight(new THREE.Color(0.3, 4, 0.5), 0.006), navLight(new THREE.Color(6, 6, 6), 0.008), navLight(new THREE.Color(6, 1, 1), 0.007)];
    for (const l of lights) overlay.add(l);
    L.planes.push({ obj, heading, dx, dz, speed: 235, life: 0, trails: planeInfo.engines.map(() => []), emit: 0, trail, lights });
  }

  const tv = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3(), tan = new THREE.Vector3();

  function updatePlanes(dt, t, camPos) {
    planeTimer -= dt;
    if (planeTimer <= 0 && L.planes.length < 2) { spawnPlane(camPos); planeTimer = 25 + Math.random() * 50; }
    for (let i = L.planes.length - 1; i >= 0; i--) {
      const p = L.planes[i];
      p.life += dt;
      p.obj.position.x += p.dx * p.speed * dt;
      p.obj.position.z += p.dz * p.speed * dt;
      p.obj.updateMatrixWorld(true);
      // contrails: sample the engine exhausts
      p.emit -= dt;
      if (p.emit <= 0) {
        p.emit = 0.3;
        planeInfo.engines.forEach((e, k) => {
          const w = e.clone().applyMatrix4(p.obj.matrixWorld);
          p.trails[k].push({ p: w, t: t });
          if (p.trails[k].length > 380) p.trails[k].shift();
        });
      }
      buildTrail(p, t);
      // navigation lights: red left, green right, white tail strobe, red beacon
      const m = p.obj.matrixWorld;
      const sp = planeInfo.span * 0.98;
      p.lights[0].position.set(-sp, 0, 4).applyMatrix4(m);
      p.lights[1].position.set(sp, 0, 4).applyMatrix4(m);
      p.lights[2].position.set(0, 2, 33).applyMatrix4(m);
      p.lights[3].position.set(0, 3.5, 0).applyMatrix4(m);
      const strobe = (t % 1.2) < 0.06 ? 1 : 0;
      const beacon = (t % 1.0) < 0.1 ? 1 : 0;
      const vis = 0.25 + 0.75 * U.uNight.value;
      p.lights[0].material.opacity = vis; p.lights[1].material.opacity = vis;
      p.lights[2].material.opacity = strobe; p.lights[3].material.opacity = beacon * vis;
      const far = p.obj.position.distanceTo(camPos);
      if (p.life > 30 && far > 30000) {
        scene.remove(p.obj); overlay.remove(p.trail); p.trail.geometry.dispose();
        for (const l of p.lights) overlay.remove(l);
        L.planes.splice(i, 1);
      }
    }
  }

  // camera-facing ribbons, widening and fading with age
  function buildTrail(p, t) {
    const g = p.trail.geometry;
    const pos = g.getAttribute('position'), al = g.getAttribute('aAlpha'), idx = g.index;
    let v = 0, ii = 0;
    const cam = L.camera.position;
    for (let k = 0; k < p.trails.length; k++) {
      const pts = p.trails[k].slice();
      // live head point at the engine
      const head = planeInfo.engines[k].clone().applyMatrix4(p.obj.matrixWorld);
      pts.push({ p: head, t: t });
      for (let j = 0; j < pts.length; j++) {
        const a = pts[Math.max(0, j - 1)].p, b = pts[Math.min(pts.length - 1, j + 1)].p;
        tan.subVectors(b, a).normalize();
        toCam.subVectors(cam, pts[j].p).normalize();
        side.crossVectors(tan, toCam).normalize();
        const age = t - pts[j].t;
        const distBehind = pts[pts.length - 1].p.distanceTo(pts[j].p);
        const w = 1.2 + age * 0.45;
        // contrails form ~60 m behind the engines, then slowly dissipate
        const alpha = Math.min(1, distBehind / 120) * Math.max(0, 1 - age / 110) * 0.55 / (1 + age * 0.02);
        tv.copy(pts[j].p).addScaledVector(side, w);
        pos.setXYZ(v, tv.x, tv.y, tv.z); al.setX(v, alpha); v++;
        tv.copy(pts[j].p).addScaledVector(side, -w);
        pos.setXYZ(v, tv.x, tv.y, tv.z); al.setX(v, alpha); v++;
        if (j > 0) {
          const q = v - 4;
          idx.setX(ii++, q); idx.setX(ii++, q + 1); idx.setX(ii++, q + 2);
          idx.setX(ii++, q + 1); idx.setX(ii++, q + 3); idx.setX(ii++, q + 2);
        }
      }
    }
    g.setDrawRange(0, ii);
    pos.needsUpdate = true; al.needsUpdate = true; idx.needsUpdate = true;
  }

  L.init = function (sc, ov, camera) {
    scene = sc; overlay = ov; L.camera = camera;
    L.ambient = { value: new THREE.Color(0.5, 0.6, 0.8) };
    initBirds();
    const loader = new THREE.GLTFLoader();
    const bin = Uint8Array.from(atob(window.A345_GLB), c => c.charCodeAt(0)).buffer;
    return new Promise(res => loader.parse(bin, '', g => { setupPlane(g); res(); }, err => { console.error('A345 load failed', err); res(); }));
  };

  L.spawnPlane = function () { spawnPlane(L.camera.position); return L.planes[L.planes.length - 1]; };

  L.update = function (dt, t, camPos, camDir) {
    updateBirds(dt, t, camPos, camDir);
    updatePlanes(dt, t, camPos);
  };

  window.LIFE = L;
})();
