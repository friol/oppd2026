// terrain.js - quadtree (CDLOD style) terrain: one instanced grid patch, per-patch
// size/offset, vertex morphing between levels, skirts against cracks, heights read
// from the float heightmap in the vertex shader. Procedural PBR surface shading.
(function () {
  'use strict';
  const U = GLSL.U;
  const GRID = 64;            // cells per patch side
  const MIN_SIZE = 256;       // smallest patch (4 m vertex spacing)
  const K = 2.1;              // LOD distance factor
  const MAX_PATCHES = 1200;

  const T = { meshes: [], material: null, stats: 0 };
  let minmax = null;          // per-level min/max heights of quadtree nodes
  let levels = 0;

  function buildGeometry() {
    const pos = [], idx = [];
    const V = GRID + 1;
    for (let j = 0; j <= GRID; j++) for (let i = 0; i <= GRID; i++) pos.push(i / GRID, 0, j / GRID);
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      const a = j * V + i, b = a + V, c = a + 1, d = b + 1;
      idx.push(a, b, c, b, d, c);
    }
    // skirts: border vertices duplicated with y = -1 (pushed down in the shader)
    const border = [];
    for (let i = 0; i < GRID; i++) border.push(i);                       // top edge
    for (let j = 0; j < GRID; j++) border.push(j * V + GRID);            // right
    for (let i = GRID; i > 0; i--) border.push(GRID * V + i);            // bottom
    for (let j = GRID; j > 0; j--) border.push(j * V);                   // left
    const base = pos.length / 3;
    for (const b of border) pos.push(pos[b * 3], -1, pos[b * 3 + 2]);
    for (let k = 0; k < border.length; k++) {
      const a = border[k], b = border[(k + 1) % border.length];
      const sa = base + k, sb = base + (k + 1) % border.length;
      idx.push(a, sa, b, b, sa, sb);
    }
    return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
  }

  function makeMesh(baseGeo) {
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(baseGeo.index);
    g.setAttribute('position', baseGeo.getAttribute('position'));
    const patch = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PATCHES * 4), 4);
    patch.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPatch', patch);
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, T.material);
    m.frustumCulled = false;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }

  // Precompute min/max heights for every quadtree node (bottom-up)
  function buildMinMax() {
    const W = WORLD, cellsPer = MIN_SIZE / W.CELL; // 16 samples per smallest node
    let n = W.SIZE / MIN_SIZE;                     // 128 nodes per side
    let cur = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let lo = 1e9, hi = -1e9;
      for (let y = 0; y <= cellsPer; y++) for (let x = 0; x <= cellsPer; x++) {
        const h = W.height[(j * cellsPer + y) * W.N + i * cellsPer + x];
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      cur[(j * n + i) * 2] = lo; cur[(j * n + i) * 2 + 1] = hi;
    }
    minmax = [cur];
    while (n > 1) {
      const m = n / 2, nxt = new Float32Array(m * m * 2);
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        let lo = 1e9, hi = -1e9;
        for (let k = 0; k < 4; k++) {
          const o = ((j * 2 + (k >> 1)) * n + i * 2 + (k & 1)) * 2;
          lo = Math.min(lo, cur[o]); hi = Math.max(hi, cur[o + 1]);
        }
        nxt[(j * m + i) * 2] = lo; nxt[(j * m + i) * 2 + 1] = hi;
      }
      minmax.push(nxt); cur = nxt; n = m;
    }
    levels = minmax.length; // level 0 = MIN_SIZE nodes, last = root
  }

  T.init = function (scene) {
    buildMinMax();
    const geo = buildGeometry();
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(geo.pos, 3));
    baseGeo.setIndex(new THREE.BufferAttribute(geo.idx, 1));

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.FrontSide, envMapIntensity: 1.8 });
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.tHeight = U.tHeight;
      shader.uniforms.tNormal = U.tNormal;
      shader.uniforms.uCamPos = T.camUniform;
      shader.uniforms.uTime = U.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + GLSL.terrain + `
          attribute vec4 aPatch;           // x0, z0, size, unused
          uniform vec3 uCamPos;
          varying vec3 vWorldPos;
          varying vec3 vTerrainPos;
          varying float vSkirt;`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', `
          float size = aPatch.z;
          float cell = size / ${GRID}.0;
          vec2 xz = aPatch.xy + position.xz * size;
          // CDLOD morph: odd vertices slide onto the coarser grid with distance
          float h0 = terrainHeight(xz);
          float dist = distance(vec3(xz.x, h0, xz.y), uCamPos);
          float mEnd = size * ${(2 * K * 0.95).toFixed(3)};
          float mStart = mEnd * 0.7;
          float morph = clamp((dist - mStart) / (mEnd - mStart), 0.0, 1.0);
          vec2 g = position.xz * ${GRID}.0;
          vec2 fr = fract(g * 0.5) * 2.0;
          xz -= fr * cell * morph;
          float h = terrainHeight(xz);
          vSkirt = 0.0;
          if (position.y < 0.0) { h -= cell * 1.5 + 4.0; vSkirt = 1.0; }
          vec3 transformed = vec3(xz.x, h, xz.y);
          vTerrainPos = transformed;`)
        .replace('#include <project_vertex>', `
          vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;`)
        .replace('#include <worldpos_vertex>', `
          vec4 worldPosition = vec4(transformed, 1.0);
          vWorldPos = transformed;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GLSL.common + GLSL.terrain + `
          varying vec3 vTerrainPos;
          varying float vSkirt;
          uniform vec3 uCamPos;
          float tRough = 0.9;
          vec3 tWorldNormal = vec3(0.0, 1.0, 0.0);
          vec3 fieldColor(vec2 p, float dist) {
            // farmland patchwork: rotated grid of rectangular plots
            mat2 r = mat2(0.866, -0.5, 0.5, 0.866);
            vec2 q = r * p;
            vec2 cell = floor(q / vec2(140.0, 70.0));
            float hsh = hash12(cell);
            vec2 f = fract(q / vec2(140.0, 70.0));
            float edge = min(min(f.x, 1.0 - f.x) * 140.0, min(f.y, 1.0 - f.y) * 70.0);
            vec3 c = hsh < 0.22 ? vec3(0.25, 0.19, 0.07) : hsh < 0.5 ? vec3(0.06, 0.10, 0.025) : hsh < 0.66 ? vec3(0.11, 0.075, 0.045)
                   : hsh < 0.84 ? vec3(0.10, 0.13, 0.035) : vec3(0.17, 0.16, 0.06);
            c *= 0.9 + 0.2 * hash12(cell + 3.7);
            // furrows, faded out before they alias
            float fur = 1.0 - smoothstep(150.0, 600.0, dist);
            c *= 1.0 - fur * 0.1 * (0.5 + 0.5 * sin((hsh > 0.5 ? q.x : q.y) * 1.6));
            return mix(vec3(0.03, 0.05, 0.018), c, smoothstep(1.0, 3.5, edge));
          }`);

      // surface: compute world normal + albedo (replaces the color / normal chunks)
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          vec3 P = vTerrainPos;
          vec2 tuv = terrainUv(P.xz);
          vec4 tn = texture2D(tNormal, tuv);
          vec3 N = vec3(tn.r * 2.0 - 1.0, 0.0, tn.g * 2.0 - 1.0);
          N.y = sqrt(max(0.0, 1.0 - dot(N.xz, N.xz)));
          float camDist = distance(P, uCamPos);
          // detail normal from procedural noise (fades out with distance)
          float dFade = 1.0 - smoothstep(600.0, 2500.0, camDist);
          vec3 dn1 = vnoised2(P.xz / 9.0);
          vec3 dn2 = vnoised2(P.xz / 2.7 + 3.1);
          vec2 dg = (dn1.yz / 9.0 * 2.2 + dn2.yz / 2.7 * 0.6) * dFade;
          float slope = 1.0 - N.y;
          float h = P.y;
          float n1 = vnoise2(P.xz / 70.0), n2 = vnoise2(P.xz / 13.0), n3 = vnoise2(P.xz / 420.0);
          float forest = tn.b, fields = tn.a;

          // base: grass, dry grass, alpine meadow
          vec3 grassLush = vec3(0.045, 0.085, 0.022);
          vec3 grassDry = vec3(0.12, 0.115, 0.045);
          vec3 alpine = vec3(0.08, 0.10, 0.04);
          vec3 col = mix(grassLush, grassDry, smoothstep(0.35, 0.8, n3 * 0.7 + n1 * 0.3));
          col = mix(col, alpine, smoothstep(500.0, 900.0, h + n1 * 150.0));
          col *= 0.75 + 0.5 * n2 * (0.6 + 0.4 * vnoise2(P.xz / 4.0));
          // forest floor seen from afar (canopy colour)
          col = mix(col, vec3(0.025, 0.055, 0.018) * (0.8 + 0.4 * n1), forest * smoothstep(200.0, 1200.0, camDist) * 0.7 + forest * 0.25);
          // farmland
          col = mix(col, fieldColor(P.xz, camDist), smoothstep(0.35, 0.7, fields + (n1 - 0.5) * 0.4));
          // beaches and lake shores
          float sand = 1.0 - smoothstep(0.8, 2.2 + n1 * 2.0, h);
          col = mix(col, vec3(0.42, 0.36, 0.20) * (0.85 + 0.3 * n2), sand);
          // underwater sea bed
          col = mix(col, vec3(0.09, 0.10, 0.06), smoothstep(0.0, -3.0, h));
          // rock on steep slopes: layered, weathered, with lichen
          float strata = 0.5 + 0.5 * sin(h * 0.045 + n1 * 9.0 + n2 * 2.5 + n3 * 14.0);
          float n4 = vnoise2(P.xz / 31.0 + 11.0);
          vec3 rock = mix(vec3(0.085, 0.08, 0.075), vec3(0.20, 0.18, 0.16), n4 * 0.6 + n2 * 0.25 + strata * 0.15);
          rock = mix(rock, vec3(0.16, 0.12, 0.085), smoothstep(0.55, 0.8, n3) * 0.6);         // iron stains
          rock = mix(rock, vec3(0.07, 0.09, 0.04), smoothstep(0.6, 0.85, n2 * n4 * 1.6) * 0.5); // lichen
          float rockMask = smoothstep(0.25, 0.40, slope + (n1 - 0.5) * 0.14 + smoothstep(1300.0, 1900.0, h) * 0.1);
          col = mix(col, rock, rockMask);
          // snow caps: above the snowline, sliding off the steepest faces
          float snowLine = 1080.0 + (n3 - 0.5) * 260.0 + (n1 - 0.5) * 120.0 - (N.z) * 90.0;
          float snowSlope = mix(0.48, 0.72, smoothstep(snowLine, snowLine + 500.0, h));
          float snow = smoothstep(snowLine - 60.0, snowLine + 140.0, h) * (1.0 - smoothstep(snowSlope - 0.1, snowSlope, slope + (n2 - 0.5) * 0.12));
          col = mix(col, vec3(0.80, 0.84, 0.90) * (0.92 + 0.08 * n2), snow);
          tRough = mix(mix(0.95, 0.75, rockMask), 0.55, snow);
          tRough = mix(tRough, 0.35, smoothstep(1.2, 0.0, h) * smoothstep(-1.0, 0.0, h)); // wet sand

          N = normalize(N + vec3(-dg.x, 0.0, -dg.y) * mix(1.0, 0.4, snow));
          tWorldNormal = N;
          diffuseColor.rgb = col;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_begin>', `
          vec3 normal = normalize((viewMatrix * vec4(tWorldNormal, 0.0)).xyz);
          vec3 geometryNormal = normal;
          float faceDirection = 1.0;`)
        .replace('#include <normal_fragment_maps>', '');
      GLSL.addCloudShadow(shader, false);
    };
    T.material = mat;
    T.camUniform = { value: new THREE.Vector3() };

    T.meshMain = makeMesh(baseGeo);
    T.meshRefl = makeMesh(baseGeo);
    scene.add(T.meshMain);
    scene.add(T.meshRefl);
  };

  // ---- quadtree selection ----
  const box = new THREE.Box3(), vMin = new THREE.Vector3(), vMax = new THREE.Vector3();
  const sel = [];

  function nodeDist(cx, cy, cz, x0, z0, size, lo, hi) {
    const dx = Math.max(x0 - cx, 0, cx - (x0 + size));
    const dz = Math.max(z0 - cz, 0, cz - (z0 + size));
    const dy = Math.max(lo - cy, 0, cy - hi);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function select(cam, level, i, j) {
    const W = WORLD;
    const size = MIN_SIZE << level;
    const n = W.SIZE / size;
    const mm = minmax[level];
    const lo = mm[(j * n + i) * 2], hi = mm[(j * n + i) * 2 + 1];
    const x0 = -W.HALF + i * size, z0 = -W.HALF + j * size;
    const d = nodeDist(cam.x, cam.y, cam.z, x0, z0, size, lo, hi);
    if (level > 0 && d < size * K) {
      for (let k = 0; k < 4; k++) select(cam, level - 1, i * 2 + (k & 1), j * 2 + (k >> 1));
    } else {
      sel.push(x0, z0, size, lo, hi);
    }
  }

  // Selects patches around the (real) camera and fills both meshes,
  // each frustum-culled for its own camera.
  T.update = function (camera, reflCamera) {
    sel.length = 0;
    select(camera.position, levels - 1, 0, 0);
    T.camUniform.value.copy(camera.position);
    fill(T.meshMain, camera);
    fill(T.meshRefl, reflCamera);
    T.stats = T.meshMain.geometry.instanceCount;
  };

  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4();
  function fill(mesh, cam) {
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const arr = mesh.geometry.getAttribute('aPatch');
    let c = 0;
    for (let k = 0; k < sel.length && c < MAX_PATCHES; k += 5) {
      const x0 = sel[k], z0 = sel[k + 1], s = sel[k + 2];
      vMin.set(x0, sel[k + 3] - 60, z0); vMax.set(x0 + s, sel[k + 4] + 5, z0 + s);
      box.set(vMin, vMax);
      if (!frustum.intersectsBox(box)) continue;
      arr.array[c * 4] = x0; arr.array[c * 4 + 1] = z0; arr.array[c * 4 + 2] = s; arr.array[c * 4 + 3] = 0;
      c++;
    }
    arr.needsUpdate = true;
    mesh.geometry.instanceCount = c;
  }

  window.TERRAIN = T;
})();
