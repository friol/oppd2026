// SCENERY: sky dome with clouds, terrain with mountains, grass blades, trees, station, lighting helpers.
(function () {
  'use strict';
  const U = UTIL;
  const S = {};

  S.sunDir = new THREE.Vector3(-0.40, 0.62, -0.68).normalize();
  S.CLOUD_H = 2200;
  S.park = { x: 35, z: 35 };
  S.U = {
    uCloudTime: { value: 0 },
    uCloudCover: { value: 0.50 },
    uSun: { value: S.sunDir },
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
  };
  // Palette taken from the reference picture (linear RGB)
  S.zenith = new THREE.Vector3(0.085, 0.105, 0.62);
  S.horizon = new THREE.Vector3(0.40, 0.43, 0.88);
  S.fogColor = new THREE.Color().setRGB(0.40, 0.43, 0.86);

  // ---------- Terrain height (park is flat) ----------
  S.heightAt = function (x, z) {
    const dx = x - S.park.x, dz = z - S.park.z;
    const r = Math.hypot(dx, dz);
    if (r < 230) return 0;
    const near = U.smooth(230, 700, r);
    const hills = (U.fbm2(x / 520, z / 520, 5) - 0.42) * 80 + U.fbm2(x / 140, z / 140, 3) * 8;
    const ang = Math.atan2(dz, dx);
    const mod = 0.35 + 0.9 * U.fbm2(Math.cos(ang) * 2.2 + 7, Math.sin(ang) * 2.2 + 3, 3);
    const m = U.ridged2(x / 1500, z / 1500, 6);
    const mtn = U.smooth(2200, 5200, r) * Math.pow(m, 1.3) * 1300 * mod;
    return near * Math.max(hills, -4) + mtn;
  };

  // ---------- Cloud shadows for any MeshStandardMaterial ----------
  S.CHUNK_SHADOW = `
  uniform vec3 uSun;
  varying vec3 vCsW;
  ${U.GLSL_NOISE}
  float cloudShadowAt(vec3 p) {
    vec2 q = p.xz + uSun.xz / max(uSun.y, 0.15) * (${S.CLOUD_H.toFixed(1)} - p.y);
    return 1.0 - 0.6 * cloudDensity(q, false);
  }
  `;
  let patchId = 0;
  // opts: { vert: fn(shader), frag: fn(shader), uniforms: {} }
  S.patch = function (mat, opts) {
    opts = opts || {};
    const key = 'p' + (patchId++);
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uCloudTime = S.U.uCloudTime;
      sh.uniforms.uCloudCover = S.U.uCloudCover;
      sh.uniforms.uSun = S.U.uSun;
      sh.uniforms.uTime = S.U.uTime;
      sh.uniforms.uCam = S.U.uCam;
      if (opts.uniforms) Object.assign(sh.uniforms, opts.uniforms);
      sh.vertexShader = 'varying vec3 vCsW;\nuniform float uTime;\nuniform vec3 uCam;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        vec4 csw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          csw = instanceMatrix * csw;
        #endif
        vCsW = (modelMatrix * csw).xyz;`);
      sh.fragmentShader = 'uniform float uTime;\nuniform vec3 uCam;\n' + S.CHUNK_SHADOW + sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float csh = cloudShadowAt(vCsW); reflectedLight.directDiffuse *= csh; reflectedLight.directSpecular *= csh; }`);
      if (opts.vert) opts.vert(sh);
      if (opts.frag) opts.frag(sh);
    };
    return mat;
  };

  // ---------- Sky ----------
  function skyMaterial(envMode) {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSun: S.U.uSun, uCloudTime: S.U.uCloudTime, uCloudCover: S.U.uCloudCover,
        uZen: { value: S.zenith }, uHor: { value: S.horizon }, uEnv: { value: envMode ? 1 : 0 },
      },
      vertexShader: `
        varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: `
        uniform vec3 uSun, uZen, uHor;
        uniform float uEnv;
        varying vec3 vW;
        ${U.GLSL_NOISE}
        void main() {
          vec3 d = normalize(vW - cameraPosition);
          float y = d.y;
          float mu = dot(d, uSun);
          vec3 col = mix(uHor, uZen, pow(clamp(y, 0.0, 1.0), 0.5));
          // whitish band right above the horizon
          col = mix(col, uHor * 1.12, exp(-max(y, 0.0) * 18.0) * 0.6);
          // sun glow
          col += vec3(1.0, 0.92, 0.80) * (0.18 * pow(max(mu, 0.0), 6.0) + 0.45 * pow(max(mu, 0.0), 90.0));
          if (uEnv < 0.5) col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99955, 0.99975, mu) * 60.0;
          // clouds
          if (y > 0.005) {
            float t = (${S.CLOUD_H.toFixed(1)} - cameraPosition.y) / y;
            vec2 p = cameraPosition.xz + d.xz * t;
            float dens = cloudDensity(p, uEnv < 0.5);
            if (dens > 0.001) {
              float toward = cloudDensity(p + uSun.xz * 160.0, false);
              float lit = exp(-toward * 1.8);
              vec3 dark = vec3(0.50, 0.52, 0.80);
              vec3 bright = vec3(1.35, 1.33, 1.30);
              vec3 cc = mix(dark, bright, lit);
              cc += vec3(1.0, 0.9, 0.75) * pow(max(mu, 0.0), 8.0) * (1.0 - dens) * 1.5;
              float fade = smoothstep(0.005, 0.18, y);
              cc = mix(uHor * 1.1, cc, smoothstep(0.0, 0.25, y));
              col = mix(col, cc, dens * fade * 0.92);
            }
          }
          if (y < 0.0) {
            vec3 below = uEnv > 0.5 ? vec3(0.07, 0.16, 0.04) : uHor;
            col = mix(col, below, smoothstep(0.0, -0.05, y));
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }

  S.buildSky = function (scene) {
    const geo = new THREE.SphereGeometry(1, 48, 24);
    S.sky = new THREE.Mesh(geo, skyMaterial(false));
    S.sky.scale.setScalar(9000);
    S.sky.frustumCulled = false;
    S.sky.renderOrder = -10;
    scene.add(S.sky);
  };

  // Environment map from a sky-only scene (reflections on the steel)
  S.buildEnv = function (renderer, scene) {
    const envScene = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMaterial(true));
    m.scale.setScalar(500);
    envScene.add(m);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(envScene, 0, 0.1, 1000);
    scene.environment = rt.texture;
    pm.dispose();
  };

  S.buildLights = function (scene) {
    const sun = new THREE.DirectionalLight(0xfff3e4, 2.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const c = sun.shadow.camera;
    c.left = -90; c.right = 90; c.top = 90; c.bottom = -90; c.near = 1; c.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    S.sun = sun;
    const hemi = new THREE.HemisphereLight(0x8890ff, 0x335522, 0.25);
    scene.add(hemi);
  };

  // Shadow box follows the focus point, snapped to texels to avoid shimmering
  S.updateSun = function (focus) {
    const c = S.sun.shadow.camera;
    const texel = (c.right - c.left) / S.sun.shadow.mapSize.x;
    const d = S.sunDir;
    // light space basis
    const fwd = d.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    let a = focus.dot(right), b = focus.dot(up), e = focus.dot(fwd);
    a = Math.round(a / texel) * texel; b = Math.round(b / texel) * texel;
    const p = right.multiplyScalar(a).add(up.multiplyScalar(b)).add(fwd.multiplyScalar(e));
    S.sun.target.position.copy(p);
    S.sun.position.copy(p).addScaledVector(d, 400);
  };

  // ---------- Terrain ----------
  S.buildTerrain = function (scene) {
    const A = 720, K = 220, RMAX = 9000;
    const pos = [], idx = [];
    for (let k = 0; k <= K; k++) {
      const r = k === 0 ? 0 : RMAX * Math.pow(k / K, 2.2) + k * 1.5;
      for (let a = 0; a < A; a++) {
        const ang = a / A * Math.PI * 2;
        const x = S.park.x + Math.cos(ang) * r, z = S.park.z + Math.sin(ang) * r;
        pos.push(x, S.heightAt(x, z), z);
      }
    }
    for (let k = 0; k < K; k++) {
      for (let a = 0; a < A; a++) {
        const i0 = k * A + a, i1 = k * A + (a + 1) % A, i2 = i0 + A, i3 = i1 + A;
        idx.push(i0, i1, i2, i1, i3, i2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0.6 });
    S.patch(mat, {
      frag: (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          vec2 gp = vCsW.xz;
          float vd = length(vCsW - cameraPosition);
          float detail = 1.0 - smoothstep(40.0, 260.0, vd);
          float n1 = fbm4(gp * 0.010);
          float n2 = fbm4(gp * 0.055);
          float n3 = vnoise(gp * 1.9) * 0.6 + vnoise(gp * 5.3) * 0.4;
          vec3 cA = vec3(0.085, 0.28, 0.032), cB = vec3(0.19, 0.36, 0.045), cC = vec3(0.05, 0.17, 0.025);
          vec3 gcol = mix(cA, cB, smoothstep(0.35, 0.78, n1));
          gcol = mix(gcol, cC, smoothstep(0.55, 0.82, n2) * 0.55);
          gcol *= mix(1.0, 0.75 + 0.5 * n3, detail);
          // terrain beyond the park: woods, rock and snow
          vec3 nW = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
          float h = vCsW.y;
          float forest = smoothstep(0.55, 0.62, fbm4(gp * 0.0016 + 4.0)) * smoothstep(10.0, 40.0, h) * (1.0 - smoothstep(900.0, 1100.0, h));
          gcol = mix(gcol, vec3(0.03, 0.09, 0.03), forest * 0.85);
          float rock = smoothstep(0.82, 0.70, nW.y) * smoothstep(60.0, 220.0, h);
          rock = max(rock, smoothstep(450.0, 750.0, h + fbm4(gp * 0.004) * 300.0) * 0.8);
          gcol = mix(gcol, vec3(0.23, 0.22, 0.24) * (0.7 + 0.5 * n1), rock);
          float snow = smoothstep(700.0, 900.0, h + fbm4(gp * 0.003) * 350.0) * smoothstep(0.45, 0.65, nW.y);
          gcol = mix(gcol, vec3(0.85, 0.87, 0.95), snow);
          // station plaza (concrete) and paths
          vec2 pq = abs(gp - vec2(-33.0, 0.0)) - vec2(26.0, 8.0);
          float plaza = 1.0 - smoothstep(0.0, 0.6, max(pq.x, pq.y));
          float pathD = abs(gp.y + 8.0 + 30.0 * sin(gp.x * 0.012)) ;
          float path = (1.0 - smoothstep(1.2, 2.0, pathD)) * step(-70.0, gp.x) * step(gp.x, 190.0) * (1.0 - plaza);
          gcol = mix(gcol, vec3(0.42, 0.36, 0.28) * (0.8 + 0.3 * n3), path);
          gcol = mix(gcol, vec3(0.45, 0.45, 0.46) * (0.9 + 0.15 * n3), plaza);
          diffuseColor.rgb = gcol;`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 gq = vCsW.xz;
            float dd = 1.0 - smoothstep(20.0, 120.0, length(vCsW - cameraPosition));
            float e = 0.15;
            float hx = vnoise(gq * 3.0 + vec2(e, 0.0)) - vnoise(gq * 3.0 - vec2(e, 0.0));
            float hz = vnoise(gq * 3.0 + vec2(0.0, e)) - vnoise(gq * 3.0 - vec2(0.0, e));
            vec3 pert = (viewMatrix * vec4(-hx, 0.0, -hz, 0.0)).xyz;
            normal = normalize(normal + pert * 0.6 * dd);
          }`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = 0.95;');
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    S.terrain = mesh;
  };

  // ---------- Grass blades around the camera (wrapped tile, stable in world space) ----------
  S.buildGrass = function (scene) {
    const TILE = 56, COUNT = 110000;
    const base = new THREE.BufferGeometry();
    // tapered blade: 2 segments
    const bp = [-0.5, 0, 0, 0.5, 0, 0, -0.35, 0.5, 0, 0.35, 0.5, 0, 0, 1, 0];
    base.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    base.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.normal = base.attributes.normal;
    const rnd = U.rng(77);
    const inst = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      inst[i * 4] = rnd() * TILE; inst[i * 4 + 1] = rnd() * TILE;
      inst[i * 4 + 2] = rnd() * Math.PI * 2; inst[i * 4 + 3] = 0.12 + rnd() * rnd() * 0.28;
    }
    geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(inst, 4));
    geo.instanceCount = COUNT;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    S.patch(mat, {
      vert: (sh) => {
        sh.vertexShader = 'attribute vec4 aBlade;\nvarying vec3 vGrass;\n' + U.GLSL_NOISE + sh.vertexShader
          .replace('#include <beginnormal_vertex>', `
            const float TILE = ${TILE.toFixed(1)};
            vec2 wp = uCam.xz + mod(aBlade.xy - uCam.xz, TILE) - TILE * 0.5;
            float dist = length(vec3(wp.x, 0.0, wp.y) - uCam);
            float fade = 1.0 - smoothstep(TILE * 0.30, TILE * 0.47, dist);
            vec2 pq = abs(wp - vec2(-33.0, 0.0)) - vec2(26.5, 8.5);
            float mask = step(0.0, max(pq.x, pq.y));
            float pathD = abs(wp.y + 8.0 + 30.0 * sin(wp.x * 0.012));
            mask *= step(1.6, pathD);
            mask *= step(length(wp - vec2(${S.park.x.toFixed(1)}, ${S.park.z.toFixed(1)})), 225.0);
            float bh = aBlade.w * fade * mask * (0.7 + 0.6 * vnoise(wp * 0.15));
            vec2 dir = vec2(cos(aBlade.z), sin(aBlade.z));
            vec2 side = vec2(-dir.y, dir.x);
            float wind = (vnoise(wp * 0.04 + vec2(uTime * 0.5, uTime * 0.2)) - 0.45) * 0.9 + sin(uTime * 2.3 + wp.x * 0.4 + wp.y * 0.3) * 0.1;
            float bend = position.y * position.y;
            vec3 objectNormal = normalize(vec3(side.x * 0.3, 1.0, side.y * 0.3));
            float gn1 = fbm4(wp * 0.010), gn2 = fbm4(wp * 0.055);
            vec3 gA = vec3(0.085, 0.28, 0.032), gB = vec3(0.19, 0.36, 0.045), gC = vec3(0.05, 0.17, 0.025);
            vGrass = mix(gA, gB, smoothstep(0.35, 0.78, gn1));
            vGrass = mix(vGrass, gC, smoothstep(0.55, 0.82, gn2) * 0.55);
            vGrass *= (0.55 + 0.75 * position.y) * (0.85 + 0.3 * fract(aBlade.x * 13.7));
          `)
          .replace('#include <begin_vertex>', `
            float bw = 0.022 * (1.0 - position.y * 0.6);
            vec3 transformed = vec3(wp.x, 0.0, wp.y)
              + vec3(side.x, 0.0, side.y) * position.x * bw * 2.0
              + vec3(0.0, position.y * bh, 0.0)
              + vec3(dir.x * 0.4 + wind, 0.0, dir.y * 0.4 + wind * 0.4) * bend * bh * 0.7;
          `);
      },
      frag: (sh) => {
        sh.fragmentShader = 'varying vec3 vGrass;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = vGrass;');
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    S.grass = mesh;
  };

  // ---------- Geometry merge helper (non-indexed, with vertex colors) ----------
  S.merge = function (parts) {
    const pos = [], nor = [], col = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      if (p.matrix) g.applyMatrix4(p.matrix);
      const a = g.attributes.position.array, n = g.attributes.normal.array;
      for (let i = 0; i < a.length; i++) { pos.push(a[i]); nor.push(n[i]); }
      const c = p.color || [1, 1, 1];
      for (let i = 0; i < a.length / 3; i++) col.push(c[0], c[1], c[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return geo;
  };
  const M4 = () => new THREE.Matrix4();

  function lumpy(geo, amp, freq, seed) {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = U.noise2(x * freq + seed, z * freq + y * freq * 0.7 - seed) - 0.5;
      const l = Math.hypot(x, y, z) || 1;
      const k = 1 + n * amp;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // ---------- Trees ----------
  S.buildTrees = function (scene, avoid) {
    const trunkC = [0.16, 0.10, 0.06];
    const conifer = S.merge([
      { geo: new THREE.CylinderGeometry(0.18, 0.28, 3, 6), matrix: M4().makeTranslation(0, 1.5, 0), color: trunkC },
      { geo: lumpy(new THREE.ConeGeometry(2.6, 4.5, 9, 2), 0.15, 1.3, 1), matrix: M4().makeTranslation(0, 3.6, 0), color: [0.05, 0.13, 0.05] },
      { geo: lumpy(new THREE.ConeGeometry(2.1, 3.8, 9, 2), 0.15, 1.3, 2), matrix: M4().makeTranslation(0, 5.6, 0), color: [0.06, 0.15, 0.055] },
      { geo: lumpy(new THREE.ConeGeometry(1.4, 3.2, 9, 2), 0.15, 1.3, 3), matrix: M4().makeTranslation(0, 7.4, 0), color: [0.07, 0.17, 0.06] },
    ]);
    const broad = S.merge([
      { geo: new THREE.CylinderGeometry(0.2, 0.35, 3.4, 6), matrix: M4().makeTranslation(0, 1.7, 0), color: trunkC },
      { geo: lumpy(new THREE.IcosahedronGeometry(2.6, 2), 0.35, 0.8, 4), matrix: M4().makeTranslation(0, 5.0, 0), color: [0.10, 0.24, 0.05] },
      { geo: lumpy(new THREE.IcosahedronGeometry(1.9, 2), 0.35, 0.9, 5), matrix: M4().makeTranslation(1.5, 4.2, 0.6), color: [0.12, 0.27, 0.055] },
      { geo: lumpy(new THREE.IcosahedronGeometry(1.8, 2), 0.35, 0.9, 6), matrix: M4().makeTranslation(-1.3, 4.4, -0.8), color: [0.09, 0.22, 0.05] },
      { geo: lumpy(new THREE.IcosahedronGeometry(1.6, 2), 0.35, 1.0, 7), matrix: M4().makeTranslation(0.2, 6.6, -0.3), color: [0.13, 0.29, 0.06] },
    ]);
    const rnd = U.rng(1234);
    const lists = [[], []];
    let tries = 0;
    while (lists[0].length + lists[1].length < 2600 && tries < 120000) {
      tries++;
      const r = 70 + Math.pow(rnd(), 0.8) * 1100, a = rnd() * Math.PI * 2;
      const x = S.park.x + Math.cos(a) * r, z = S.park.z + Math.sin(a) * r;
      const cluster = U.fbm2(x / 160 + 9, z / 160 - 4, 4);
      if (cluster < 0.58 && rnd() > 0.012) continue;
      if (avoid(x, z)) continue;
      const h = S.heightAt(x, z);
      if (h > 120) continue;
      const kind = rnd() < 0.55 ? 0 : 1;
      lists[kind].push([x, h, z, 0.75 + rnd() * 0.7, rnd() * 6.28, rnd()]);
    }
    const mat = S.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.5 }));
    [conifer, broad].forEach((geo, k) => {
      const list = lists[k];
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
      const col = new THREE.Color();
      list.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[4]);
        sc.set(t[3], t[3] * (0.85 + t[5] * 0.4), t[3]);
        p.set(t[0], t[1] - 0.2, t[2]);
        m.compose(p, q, sc);
        im.setMatrixAt(i, m);
        col.setRGB(0.8 + t[5] * 0.4, 0.85 + t[5] * 0.3, 0.8 + (1 - t[5]) * 0.3);
        im.setColorAt(i, col);
      });
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
    });
  };

  // ---------- Station ----------
  S.buildStation = function (scene) {
    const g = new THREE.Group();
    const concrete = S.patch(new THREE.MeshStandardMaterial({ color: 0x9a9a9e, roughness: 0.85 }));
    const roofM = S.patch(new THREE.MeshPhysicalMaterial({ color: 0xc8302a, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
    const steel = S.patch(new THREE.MeshStandardMaterial({ color: 0xd6dae0, roughness: 0.3, metalness: 0.85 }));
    const blue = S.patch(new THREE.MeshStandardMaterial({ color: 0x2747b8, roughness: 0.5 }));
    const yellow = S.patch(new THREE.MeshStandardMaterial({ color: 0xffb52a, roughness: 0.5 }));
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x223344, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55 });
    const add = (geo, mat, x, y, z, cast) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast !== false; m.receiveShadow = true; g.add(m); return m; };
    const x0 = -50, x1 = -14, cx = (x0 + x1) / 2, len = x1 - x0;
    // platforms on both sides, 0.7 m above the rails' bottom
    add(new THREE.BoxGeometry(len, 1.05, 3.4), concrete, cx, 0.52, 2.95);
    add(new THREE.BoxGeometry(len, 1.05, 3.4), concrete, cx, 0.52, -2.95);
    add(new THREE.BoxGeometry(len, 0.08, 0.25), yellow, cx, 1.08, 1.35);
    add(new THREE.BoxGeometry(len, 0.08, 0.25), yellow, cx, 1.08, -1.35);
    // trench under the track
    add(new THREE.BoxGeometry(len, 0.3, 2.5), concrete, cx, 0.05, 0, false);
    // roof on columns
    for (let i = 0; i <= 6; i++) {
      const x = x0 + 1 + i * (len - 2) / 6;
      add(new THREE.CylinderGeometry(0.14, 0.14, 4.2, 10), steel, x, 3.1, 4.3);
      add(new THREE.CylinderGeometry(0.14, 0.14, 4.2, 10), steel, x, 3.1, -4.3);
    }
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-5.4, 0); roofShape.quadraticCurveTo(0, 1.4, 5.4, 0); roofShape.lineTo(5.4, 0.25); roofShape.quadraticCurveTo(0, 1.65, -5.4, 0.25); roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: len + 3, bevelEnabled: false, curveSegments: 16 });
    roofGeo.rotateY(Math.PI / 2); roofGeo.translate(x0 - 1.5, 5.2, 0);
    const roof = new THREE.Mesh(roofGeo, roofM); roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
    add(new THREE.BoxGeometry(len + 3, 0.5, 0.3), blue, cx, 5.25, 5.35);
    add(new THREE.BoxGeometry(len + 3, 0.5, 0.3), blue, cx, 5.25, -5.35);
    // operator booth
    add(new THREE.BoxGeometry(3.2, 2.6, 2.6), blue, x1 - 3, 2.35, -6.2);
    add(new THREE.BoxGeometry(3.3, 0.2, 2.7), roofM, x1 - 3, 3.75, -6.2);
    add(new THREE.BoxGeometry(2.6, 1.0, 0.05), glass, x1 - 3, 2.8, -4.88, false);
    // railings on the outer edge of the platforms
    const railGeo = new THREE.CylinderGeometry(0.04, 0.04, len, 6); railGeo.rotateZ(Math.PI / 2);
    add(railGeo, steel, cx, 2.1, 4.6); add(railGeo, steel, cx, 2.1, -4.6);
    for (let i = 0; i <= 12; i++) {
      const x = x0 + i * len / 12;
      add(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6), steel, x, 1.58, 4.6);
      add(new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6), steel, x, 1.58, -4.6);
    }
    // stairs
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(2.2, 0.26, 0.4), concrete, x0 + 6, 0.13 + i * 0.26 - 0.0, 4.65 + (3 - i) * 0.4 + 0.4);
    scene.add(g);
  };

  S.update = function (t, cam) {
    S.U.uTime.value = t;
    S.U.uCloudTime.value = t;
    S.U.uCam.value.copy(cam.position);
    if (S.sky) S.sky.position.copy(cam.position);
  };

  window.SCENERY = S;
})();
