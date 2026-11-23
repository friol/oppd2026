// Clock of Clocks: a 16x6 grid of small analog clocks rendered with three.js.
// The hands of the small clocks draw the current time (four 4x6 digits) and,
// between one time display and the next, perform coordinated choreographies.
(function () {
  'use strict';

  // ---- Layout -------------------------------------------------------------
  const COLS = 16, ROWS = 6;
  const MARGIN = 0.65;           // panel border around the grid (cell = 1 unit)
  const HOLE_R = 0.46;           // radius of each recessed dial
  const RECESS = 0.2;            // depth of the dial recess (front plate thickness)
  const BACK = 0.12;             // back plate thickness (thin: the panel sits close to the wall)
  const HAND_LEN = 0.435, HAND_TAIL = 0.05, HAND_W = 0.072;
  const PW = COLS + 2 * MARGIN, PH = ROWS + 2 * MARGIN;
  const DEG = Math.PI / 180;

  // ---- Timing (seconds) ---------------------------------------------------
  const TIME_HOLD = 20;          // how long the time stays on screen
  const SCENE_HOLD = 13;         // how long a choreography lasts
  const TO_TIME = 3.0;           // transition duration into the time
  const TO_SCENE = 2.6;          // transition duration into a choreography

  // ---- Digit font ---------------------------------------------------------
  // Clock angles: 0 = up, 90 = right, 180 = down, 270 = left (clockwise).
  const U = 0, R = 90, D = 180, L = 270, N = 225;   // N = rest position (7:30)
  const SYM = {
    '┌': [R, D], '┐': [L, D], '└': [U, R], '┘': [U, L],
    '─': [L, R], '│': [U, D], '╷': [D, D], '╵': [U, U], '╶': [R, R], ' ': [N, N],
  };
  // Each digit is 4 cells wide and 6 tall, drawn as the outline of a bold
  // glyph with one-cell strokes; every outline is a closed loop.
  const DIGIT_W = 4;
  const DIGITS = [
    ['┌──┐', '│┌┐│', '││││', '││││', '│└┘│', '└──┘'],
    ['┌─┐ ', '└┐│ ', ' ││ ', ' ││ ', ' ││ ', ' └┘ '],
    ['┌──┐', '└─┐│', '┌─┘│', '│┌─┘', '│└─┐', '└──┘'],
    ['┌──┐', '└─┐│', '┌─┘│', '└─┐│', '┌─┘│', '└──┘'],
    ['┌┐┌┐', '││││', '│└┘│', '└─┐│', '  ││', '  └┘'],
    ['┌──┐', '│┌─┘', '│└─┐', '└─┐│', '┌─┘│', '└──┘'],
    ['┌──┐', '│┌─┘', '│└─┐', '│┌┐│', '│└┘│', '└──┘'],
    ['┌──┐', '└─┐│', '  ││', '  ││', '  ││', '  └┘'],
    ['┌──┐', '│┌┐│', '│└┘│', '│┌┐│', '│└┘│', '└──┘'],
    ['┌──┐', '│┌┐│', '│└┘│', '└─┐│', '┌─┘│', '└──┘'],
  ];

  // ---- Helpers ------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mod = (a, n) => ((a % n) + n) % n;
  const easeInOut = p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  const smooth = p => p * p * (3 - 2 * p);
  // Stepped motion: rests for the first half of each unit, then eases to the next integer.
  const steps = x => Math.floor(x) + smooth(clamp((mod(x, 1) - 0.5) * 2, 0, 1));

  // ---- Renderer, scene, camera --------------------------------------------
  // Treat hex colours as sRGB (converted to linear for lighting), so that a
  // preset's colours look like the colours that were picked.
  THREE.ColorManagement.legacyMode = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;   // variance shadow maps: wide, smooth penumbras
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe8e5e0);
  const camera = new THREE.PerspectiveCamera(26, 1, 3, 200);   // near plane far out: precise depth for SSAO
  let camDist = 30;

  // ---- Post-processing ----------------------------------------------------
  // 1. Ambient occlusion (SSAO): a half-resolution pass renders view-space
  //    normals and depth; a shader compares 16 hemisphere samples around each
  //    point with the depth buffer, and a small blur softens the result. It
  //    gives soft contact shadows where the hands hover over the dial floor
  //    and in the inner corners of the recesses.
  // 2. The scene itself is rendered (linear, HDR, multisampled) into a target.
  // 3. A full-screen pass composes everything: ambient occlusion, a lens blur
  //    at the edges of the frame (sharp centre, softer corners and a touch of
  //    tilt-shift at top and bottom), ACES tone mapping, a light vignette,
  //    animated film grain, and the conversion to sRGB. Tone mapping happens
  //    only here, so the renderer itself does none.
  renderer.toneMapping = THREE.NoToneMapping;
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const normalRT = new THREE.WebGLRenderTarget(1, 1);
  normalRT.depthTexture = new THREE.DepthTexture(1, 1);
  normalRT.depthTexture.type = THREE.UnsignedIntType;
  const aoRT = new THREE.WebGLRenderTarget(1, 1);
  const aoBlurRT = new THREE.WebGLRenderTarget(1, 1);
  const normalMat = new THREE.MeshNormalMaterial();

  const QUAD_VS = `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  // Hemisphere kernel, denser near the centre.
  const AO_SAMPLES = 16;
  const aoKernel = [];
  for (let i = 0; i < AO_SAMPLES; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random()).normalize();
    const sc = i / AO_SAMPLES;
    v.multiplyScalar(Math.random() * (0.1 + 0.9 * sc * sc));
    aoKernel.push(v);
  }

  const ssaoMat = new THREE.ShaderMaterial({
    defines: { SAMPLES: AO_SAMPLES },
    uniforms: {
      tNormal: { value: normalRT.texture },
      tDepth: { value: normalRT.depthTexture },
      uRes: { value: new THREE.Vector2(1, 1) },
      cameraNear: { value: 1 }, cameraFar: { value: 200 },
      uProj: { value: camera.projectionMatrix },
      uInvProj: { value: camera.projectionMatrixInverse },
      uKernel: { value: aoKernel },
      uRadius: { value: 0.32 },     // world units: a bit more than the depth of the recess
      uBias: { value: 0.003 },
    },
    vertexShader: QUAD_VS,
    fragmentShader: `
      #include <packing>
      uniform sampler2D tNormal, tDepth;
      uniform vec2 uRes;
      uniform float cameraNear, cameraFar, uRadius, uBias;
      uniform mat4 uProj, uInvProj;
      uniform vec3 uKernel[SAMPLES];
      varying vec2 vUv;

      float viewZ(float d) { return perspectiveDepthToViewZ(d, cameraNear, cameraFar); }
      vec3 viewPos(vec2 uv, float d, float vz) {
        float clipW = uProj[2][3] * vz + uProj[3][3];
        vec4 clip = vec4((vec3(uv, d) - 0.5) * 2.0, 1.0) * clipW;
        return (uInvProj * clip).xyz;
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

      void main() {
        float d = texture2D(tDepth, vUv).x;
        if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
        float vz = viewZ(d);
        vec3 P = viewPos(vUv, d, vz);
        vec3 N = normalize(unpackRGBToNormal(texture2D(tNormal, vUv).rgb));
        // Random rotation per pixel (removed later by the blur).
        float a = hash(floor(vUv * uRes)) * 6.2831853;
        vec3 rnd = vec3(cos(a), sin(a), 0.0);
        vec3 T = normalize(rnd - N * dot(rnd, N));
        mat3 TBN = mat3(T, cross(N, T), N);
        float occ = 0.0;
        for (int i = 0; i < SAMPLES; i++) {
          vec3 S = P + TBN * uKernel[i] * uRadius;
          vec4 o = uProj * vec4(S, 1.0);
          vec2 suv = o.xy / o.w * 0.5 + 0.5;
          float sz = viewZ(texture2D(tDepth, suv).x);
          float range = smoothstep(0.0, 1.0, uRadius / abs(P.z - sz));
          occ += (sz >= S.z + uBias ? 1.0 : 0.0) * range;
        }
        gl_FragColor = vec4(vec3(1.0 - occ / float(SAMPLES)), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  // 4x4 box blur of the ambient occlusion (removes the per-pixel rotation noise).
  const aoBlurMat = new THREE.ShaderMaterial({
    uniforms: { tAO: { value: aoRT.texture }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: QUAD_VS,
    fragmentShader: `
      uniform sampler2D tAO;
      uniform vec2 uRes;
      varying vec2 vUv;
      void main() {
        float s = 0.0;
        for (int x = -2; x < 2; x++)
          for (int y = -2; y < 2; y++)
            s += texture2D(tAO, vUv + (vec2(float(x), float(y)) + 0.5) / uRes).r;
        gl_FragColor = vec4(vec3(s / 16.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const post = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: sceneRT.texture },
      tAO: { value: aoBlurRT.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uExposure: { value: 1.15 },
      uBlur: { value: 3 },          // maximum lens blur radius, in device pixels
      uLens: { value: 1 },          // 0 = off, 1 = on (eased when toggled)
      uAO: { value: 1 },            // ambient occlusion strength (eased when toggled)
      uFilm: { value: 1 },          // vignette + grain, 0..1 (eased when toggled)
      uFrame: { value: 0 },         // grain frame counter (24 per second)
      uRain: { value: 0 },          // drops on the lens, 0 = dry .. 1 = wet
      uTime: { value: 0 },
    },
    vertexShader: QUAD_VS,
    fragmentShader: `
      uniform sampler2D tScene, tAO;
      uniform vec2 uRes;
      uniform float uExposure, uBlur, uLens, uAO, uFilm, uFrame, uRain, uTime;
      varying vec2 vUv;

      // ACES filmic tone mapping (same fit as three.js).
      vec3 RRTAndODTFit(vec3 v) {
        vec3 a = v * (v + 0.0245786) - 0.000090537;
        vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
        return a / b;
      }
      vec3 aces(vec3 c) {
        const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c *= uExposure / 0.6;
        return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
      }
      // Hash without sine (Dave Hoskins): no banding with large inputs.
      float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      // Distance from the centre: 0 in the middle, 1 in the corners.
      float radial(vec2 uv) {
        float aspect = uRes.x / uRes.y;
        return length((uv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
      }
      // Lens blur radius: zero in the middle, growing towards the corners,
      // plus a gentle band at the top and bottom.
      float coc(vec2 uv) {
        float v = abs(uv.y - 0.5) * 2.0;
        return uBlur * uLens * max(smoothstep(0.42, 1.0, radial(uv)), 0.7 * smoothstep(0.6, 1.0, v));
      }

      // ---- Rain on the lens ----
      // Adapted from "Heartfelt" by Martijn Steinrucken aka BigWings (2017,
      // https://www.shadertoy.com/view/ltffzl), Creative Commons
      // Attribution-NonCommercial-ShareAlike 3.0. Drops run down the glass in
      // jerks leaving trails of droplets, small drops appear and fade, and the
      // glass is fogged except where the water has wiped it clear.
      vec3 rN13(float p) {
        vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.11369, 0.13787));
        p3 += dot(p3, p3.yzx + 19.19);
        return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
      }
      float rN(float t) { return fract(sin(t * 12345.564) * 7658.76); }
      float saw(float b, float t) { return smoothstep(0.0, b, t) * smoothstep(1.0, b, t); }

      // Running drops with their trails. Returns (drop mask, trail mask).
      vec2 dropLayer(vec2 uv, float t, float dens) {
        vec2 UV = uv;
        uv.y += t * 0.75;
        vec2 a = vec2(6.0, 1.0);
        vec2 grid = a * 2.0;
        vec2 id = floor(uv * grid);
        uv.y += rN(id.x);                          // each column at its own height
        id = floor(uv * grid);
        vec3 n = rN13(id.x * 35.2 + id.y * 2376.1);
        if (n.y > dens) return vec2(0.0);           // only some cells carry a drop
        vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
        float x = n.x - 0.5;
        float y = UV.y * 20.0;
        float wiggle = sin(y + sin(y));
        x += wiggle * (0.5 - abs(x)) * (n.z - 0.5);
        x *= 0.7;
        float ti = fract(t + n.z);
        y = (saw(0.85, ti) - 0.5) * 0.9 + 0.5;     // slow slide, then a quick drop
        vec2 p = vec2(x, y);
        float d = length((st - p) * a.yx);
        float mainDrop = smoothstep(0.4, 0.0, d);
        float r = sqrt(smoothstep(1.0, y, st.y));
        float cd = abs(st.x - x);
        float trail = smoothstep(0.23 * r, 0.15 * r * r, cd);
        float trailFront = smoothstep(-0.02, 0.02, st.y - y);
        trail *= trailFront * r * r;
        y = UV.y;
        y = fract(y * 10.0) + (st.y - 0.5);
        float dd = length(st - vec2(x, y));
        float droplets = smoothstep(0.3, 0.0, dd);
        float m = mainDrop + droplets * r * trailFront;
        return vec2(m, trail);
      }

      // Small drops that land and slowly fade.
      float staticDrops(vec2 uv, float t) {
        uv *= 40.0;
        vec2 id = floor(uv);
        uv = fract(uv) - 0.5;
        vec3 n = rN13(id.x * 107.45 + id.y * 3543.654);
        vec2 p = (n.xy - 0.5) * 0.7;
        float d = length(uv - p);
        if (fract(n.z * 7.0) > 0.35) return 0.0;  // fewer resting drops
        float fade = saw(0.025, fract(t + n.z));
        return smoothstep(0.3, 0.0, d) * fract(n.z * 10.0) * fade;
      }

      vec2 drops(vec2 uv, float t, float l0, float l1, float l2) {
        float s = staticDrops(uv, t) * l0;
        vec2 m1 = dropLayer(uv, t, 0.35) * l1;
        vec2 m2 = dropLayer(uv * 1.85, t, 0.25) * l2;
        float c = smoothstep(0.3, 1.0, s + m1.x + m2.x);
        return vec2(c, max(m1.y * l0, m2.y * l1));
      }

      void main() {
        // Rain: refraction offset from the drop height field, and fog on the
        // glass (0 = clear .. 1 = fully fogged).
        vec2 suv = vUv;
        float fog = 0.0, wetDrop = 0.0;
        if (uRain > 0.001) {
          vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y * 1.5;   // smaller drops than the original
          float t = uTime * 0.2;
          float l0 = smoothstep(0.0, 1.0, uRain) * 0.9;
          float l1 = smoothstep(0.25, 0.75, uRain);
          float l2 = smoothstep(0.0, 0.5, uRain);
          vec2 c = drops(uv, t, l0, l1, l2);
          vec2 e = vec2(0.001, 0.0);
          float cx = drops(uv + e, t, l0, l1, l2).x;
          float cy = drops(uv + e.yx, t, l0, l1, l2).x;
          vec2 n = vec2(cx - c.x, cy - c.x);
          suv += n;
          wetDrop = smoothstep(0.1, 0.2, c.x);
          fog = 0.55 * uRain * (1.0 - wetDrop) * (1.0 - 0.85 * clamp(c.y, 0.0, 1.0));
        }
        float radius = max(coc(vUv), fog * 6.0 * uRes.y / 900.0);
        vec3 col;
        if (radius < 0.35) {
          col = texture2D(tScene, suv).rgb;
        } else {
          // Golden-angle disc of 32 taps: a smooth, round "bokeh".
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 32; i++) {
            float fi = float(i);
            float r = sqrt((fi + 0.5) / 32.0) * radius;
            float a = fi * 2.39996323;
            acc += texture2D(tScene, suv + vec2(cos(a), sin(a)) * r / uRes).rgb;
          }
          col = acc / 32.0;
        }
        col *= mix(1.0, pow(texture2D(tAO, vUv).r, 1.8), uAO);
        vec3 c = aces(col);
        // Fogged glass: a little lighter and greyer than the scene behind it.
        c = mix(c, vec3(dot(c, vec3(0.333))) * 1.04 + 0.03, 0.18 * fog);
        // Vignette: corners up to ~22% darker.
        c *= 1.0 - 0.22 * uFilm * smoothstep(0.3, 1.1, radial(vUv));
        // Film grain: two hashes averaged (softer, less digital), a new
        // pattern 24 times a second, a little weaker in the shadows.
        vec2 px = floor(gl_FragCoord.xy) + mod(uFrame, 64.0) * vec2(17.0, 29.0);
        float g = (hash(px) + hash(px * 1.37 + 11.0)) * 0.5 - 0.5;
        c += g * 0.055 * uFilm * (0.35 + 0.65 * c);
        gl_FragColor = vec4(c, 1.0);
        #include <encodings_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post);
  postScene.add(quad);
  function runQuad(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCam);
  }

  function renderFrame() {
    post.uniforms.uFrame.value = Math.floor(performance.now() / 1000 * 24) % 1000;
    if (post.uniforms.uAO.value > 0.001) {
      // Normals + depth, without background or a new shadow map.
      const bg = scene.background;
      scene.background = null;
      scene.overrideMaterial = normalMat;
      wxGroup.visible = false;
      leafGroup.visible = false;    // drawn below with their own cut-out material
      leafShadowGroup.visible = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(normalRT);
      renderer.clear();
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      // The leaves go in too, with their real cut-out shape, so the
      // occlusion of the panel behind them is not printed over them.
      leafGroup.visible = true;
      if (leafGroup.children.length) {
        for (const m of leafGroup.children) m.material = m.userData.kind.normal;
        const ac = renderer.autoClear;
        renderer.autoClear = false;
        renderer.render(leafGroup, camera);
        renderer.autoClear = ac;
        for (const m of leafGroup.children) m.material = m.userData.kind.mat;
      }
      renderer.shadowMap.autoUpdate = true;
      wxGroup.visible = true;
      leafShadowGroup.visible = true;
      scene.background = bg;
      ssaoMat.uniforms.cameraNear.value = camera.near;
      ssaoMat.uniforms.cameraFar.value = camera.far;
      runQuad(ssaoMat, aoRT);
      runQuad(aoBlurMat, aoBlurRT);
    }
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    runQuad(post, null);
  }

  // ---- Lights: a low, warm key light from the upper left for long soft
  // shadows inside the dials, a cool weak fill from the right and a sky dome.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d2c6, 0.5);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff1e0, 1.1);
  key.position.set(-8, 6.5, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 7;
  key.shadow.blurSamples = 25;
  key.shadow.bias = -0.0005;
  const sc = key.shadow.camera;
  sc.left = -14; sc.right = 14; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 40;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xe6eeff, 0.22);
  fill.position.set(9, -3, 7);
  scene.add(fill);

  // ---- Environments for reflections --------------------------------------
  // Small studios (gradient dome + softboxes) prefiltered with PMREM.
  // boxes: [width, height, x, y, z, intensity], each facing the origin.
  function buildEnvironment(low, high, boxes) {
    const env = new THREE.Scene();
    const dome = new THREE.SphereGeometry(40, 48, 24);
    const pos = dome.attributes.position, cols = [];
    for (let i = 0; i < pos.count; i++) {
      const t = clamp(pos.getY(i) / 40 * 0.5 + 0.5, 0, 1);
      const v = low + (high - low) * t * t;
      cols.push(v, v * 0.98, v * 0.95);
    }
    dome.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    env.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    for (const [w, h, x, y, z, i] of boxes) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.material.color.setRGB(i, i * 0.98, i * 0.95);
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.02).texture;
    pmrem.dispose();
    return tex;
  }
  // Soft room for the panel, the wall and satin paint.
  scene.environment = buildEnvironment(0.08, 0.63, [
    [16, 10, -14, 12, 14, 5],      // key softbox, same side as the key light
    [10, 14, 18, -2, 10, 1.4],     // weak fill
  ]);
  // High-contrast product studio for the hands: a dark room with light strips.
  // The flat faces of the hands mirror the area behind the camera (within
  // ~10 degrees of +z), so two tall strips there draw bright bands across the
  // panel that drift as the camera moves; the rounded edges catch the top and
  // side softboxes as the hands turn.
  const handEnv = buildEnvironment(0.02, 0.14, [
    [60, 60, 0, 0, 30, 0.32],      // dim backdrop behind the camera
    [1.4, 40, -2.4, 0, 20, 7],     // main strip
    [0.6, 40, 3.0, 0, 20, 3.5],    // thin strip
    [26, 6, 0, 18, 12, 6],         // overhead softbox
    [6, 18, -18, 4, 8, 3.5],       // side softbox (key side)
    [24, 6, 0, -16, 8, 0.7],       // warm floor bounce
  ]);

  // ---- Surface textures ---------------------------------------------------
  // Generated once on a canvas: one image modulates the colour, the other
  // carries the height (red channel, bump) and roughness (green channel).
  // The textures span the whole panel (UVs are normalised to it below).
  function makeNoise(seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const g = new Float32Array(256 * 256);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
      const a = g[(xi & 255) | (yi & 255) << 8], b = g[((xi + 1) & 255) | (yi & 255) << 8];
      const c = g[(xi & 255) | ((yi + 1) & 255) << 8], d = g[((xi + 1) & 255) | ((yi + 1) & 255) << 8];
      return a + (b - a) * fx + (c - a + (d - c - b + a) * fx) * fy;
    };
  }

  function makeFinish(kind) {
    const W = 2048, H = 1024;
    const cMap = document.createElement('canvas'), cData = document.createElement('canvas');
    cMap.width = cData.width = W; cMap.height = cData.height = H;
    const xMap = cMap.getContext('2d'), xData = cData.getContext('2d');
    const iMap = xMap.createImageData(W, H), iData = xData.createImageData(W, H);
    const n1 = makeNoise(kind === 'metal' ? 11 : 3), n2 = makeNoise(29), n3 = makeNoise(57);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let height, tone, rough;
        if (kind === 'metal') {
          // Brushed metal: long fine streaks along x, a few deeper scratches.
          const streak = n1(x * 0.004, y * 0.9) * 0.55 + n2(x * 0.02, y * 2.7) * 0.35 + n3(x * 0.3, y * 6) * 0.1;
          const scratch = Math.pow(n3(x * 0.0015, y * 0.35), 18) * 0.6;
          height = streak - scratch;
          tone = 0.97 + 0.03 * streak;
          rough = 0.85 + 0.15 * streak;
        } else {
          // Painted wood: grain rings under the paint, fibres and brush strokes.
          const g = n1(x * 0.0025, y * 0.03) * 5 + n2(x * 0.001, y * 0.01) * 2;
          const ring = Math.abs((g % 1) - 0.5) * 2;
          const fibre = n2(x * 0.03, y * 0.7);
          const brush = n3(x * 0.0018, y * 0.28);
          height = 0.42 * ring + 0.2 * fibre + 0.38 * brush;
          tone = 0.985 + 0.015 * (1 - ring * 0.7 - fibre * 0.3);
          rough = 0.9 + 0.1 * (0.6 * brush + 0.4 * fibre);
        }
        const i = (y * W + x) * 4, t = clamp(tone, 0, 1) * 255;
        iMap.data[i] = iMap.data[i + 1] = iMap.data[i + 2] = t; iMap.data[i + 3] = 255;
        iData.data[i] = clamp(height, 0, 1) * 255;
        iData.data[i + 1] = clamp(rough, 0, 1) * 255;
        iData.data[i + 2] = 0; iData.data[i + 3] = 255;
      }
    }
    xMap.putImageData(iMap, 0, 0);
    xData.putImageData(iData, 0, 0);
    const map = new THREE.CanvasTexture(cMap), data = new THREE.CanvasTexture(cData);
    map.encoding = THREE.sRGBEncoding;
    for (const t of [map, data]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    return { map, data };
  }
  const FINISHES = { paint: makeFinish('paint'), metal: makeFinish('metal') };

  // ---- Materials ----------------------------------------------------------
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf6f5f2, roughness: 0.88, metalness: 0 });
  const dialMat = new THREE.MeshStandardMaterial({ color: 0xf8f7f4, roughness: 0.95, metalness: 0 });
  const handMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.7, metalness: 0, envMap: handEnv });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe3dfd8, roughness: 1, metalness: 0 });
  let finish = '';

  function setFinish(kind) {
    if (kind === finish || !FINISHES[kind]) return;
    finish = kind;
    const f = FINISHES[kind];
    for (const m of [bodyMat, dialMat]) {
      m.map = f.map;
      m.bumpMap = f.data;
      m.roughnessMap = f.data;
      m.needsUpdate = true;
    }
  }

  // ---- Look (colours and light levels) ------------------------------------
  // `look` is what is rendered, `goal` is where it is heading: every frame the
  // look eases towards the goal, so palette changes fade in calmly.
  const COLOR_KEYS = ['body', 'hands', 'light', 'wall', 'sky', 'ground', 'fill'];
  // metal/rough: body metalness and roughness, bump: relief of the surface
  // texture, envI: strength of the studio reflections.
  const NUMBER_KEYS = ['keyI', 'hemiI', 'fillI', 'exposure', 'handMetal', 'handRough', 'handEnv', 'metal', 'rough', 'bump', 'envI'];
  function makeLook() {
    const o = {};
    for (const k of COLOR_KEYS) o[k] = new THREE.Color();
    return o;
  }
  const look = makeLook(), goal = makeLook();

  function setLook(p, instant) {
    for (const k of COLOR_KEYS) if (p[k] !== undefined) goal[k].set(p[k]);
    for (const k of NUMBER_KEYS) if (p[k] !== undefined) goal[k] = p[k];
    if (p.finish) setFinish(p.finish);
    if (instant) updateLook(0, true);
  }

  function updateLook(dt, instant) {
    const a = instant ? 1 : 1 - Math.exp(-dt * 2.5);
    for (const k of COLOR_KEYS) look[k].lerp(goal[k], a);
    for (const k of NUMBER_KEYS) look[k] = look[k] === undefined ? goal[k] : look[k] + (goal[k] - look[k]) * a;
    bodyMat.color.copy(look.body);
    dialMat.color.copy(look.body).offsetHSL(0, 0, 0.012);
    for (const m of [bodyMat, dialMat]) {
      m.metalness = look.metal;
      m.roughness = look.rough;
      m.envMapIntensity = look.envI;
    }
    bodyMat.bumpScale = look.bump;
    dialMat.bumpScale = look.bump * 0.5;   // the dial floors are smoother
    handMat.color.copy(look.hands);
    handMat.metalness = look.handMetal;
    handMat.roughness = look.handRough;
    handMat.envMapIntensity = look.handEnv;
    wallMat.color.copy(look.wall);
    wallMat.envMapIntensity = look.envI * 0.5;
    scene.background.copy(look.wall);
    const sun = options.sun ? sunState(hourOfDay()) : NOON;
    key.position.copy(sun.pos);
    key.color.copy(look.light).multiply(sun.tint);
    key.intensity = look.keyI * sun.power * (1 - 0.3 * wx.rain - 0.1 * wx.snow);
    if (wx.snow > 0) key.color.lerp(C_SNOW_LIGHT, 0.3 * wx.snow);
    hemi.color.copy(look.sky);
    hemi.groundColor.copy(look.ground);
    hemi.intensity = look.hemiI * sun.ambient;
    fill.color.copy(look.fill);
    fill.intensity = look.fillI;
    post.uniforms.uExposure.value = look.exposure;
  }

  // ---- Light that follows the time of day ---------------------------------
  // The key light travels like the sun: low and cool from the left in the
  // morning, high and neutral at noon, low and golden from the right in the
  // evening; at night a dim blue "moon" from the upper right.
  const options = { sun: false, lens: true, ao: true, film: true, leaves: true };
  const wx = { idx: 0, t: 0, snow: 0, rain: 0, acc: 0, wet: 0 };   // weather state (see Weather)   // the sun is off by default
  let hourOverride = null;                      // for tests: a fixed hour
  function hourOfDay() {
    if (hourOverride !== null) return hourOverride;
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  }
  const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
  const C_SNOW_LIGHT = new THREE.Color(0xdfe8ff);
  const C_NIGHT = new THREE.Color(0x9fb2ff), C_MORNING = new THREE.Color(0xffd9bd);
  const C_EVENING = new THREE.Color(0xffae66), C_WHITE = new THREE.Color(0xffffff);
  const MOON_POS = new THREE.Vector3(6, 7, 8);
  const NOON = { pos: new THREE.Vector3(-8, 6.5, 7), tint: C_WHITE, power: 1, ambient: 1 };
  const sunOut = { pos: new THREE.Vector3(), tint: new THREE.Color(), power: 1, ambient: 1 };
  function sunState(h) {
    const day = smoothstep(5.3, 7, h) * (1 - smoothstep(19.2, 21, h));   // 0 night .. 1 day
    const arc = clamp((h - 6) / 14, 0, 1) * Math.PI;                      // sunrise .. sunset
    const elev = Math.sin(arc);
    sunOut.pos.set(-Math.cos(arc) * 10, 2.2 + 7.5 * elev, 6.5 + 2.5 * (1 - elev));
    sunOut.pos.lerp(MOON_POS, 1 - day);
    // Golden light near the horizon: pale peach in the morning, amber at dusk.
    const low = Math.pow(1 - elev, 2.2);
    sunOut.tint.copy(C_WHITE).lerp(h < 13 ? C_MORNING : C_EVENING, low);
    sunOut.tint.lerp(C_NIGHT, 1 - day);
    sunOut.power = (0.78 + 0.22 * elev) * (0.45 + 0.55 * day);
    sunOut.ambient = 0.72 + 0.28 * day;
    return sunOut;
  }
  setLook({
    body: 0xf6f5f2, hands: 0x050505, light: 0xfff1e0, wall: 0xe3dfd8, sky: 0xffffff, ground: 0xd9d2c6,
    fill: 0xe6eeff, keyI: 1.1, hemiI: 0.5, fillI: 0.22, exposure: 1.15, handMetal: 0, handRough: 0.6, handEnv: 0.5,
    finish: 'paint', metal: 0, rough: 0.9, bump: 0.009, envI: 0.3,
  }, true);

  // ---- Wind: breeze, gusts and whirlwinds ---------------------------------
  // One wind field shared by leaves, petals, snow and rain. A light breeze
  // blows to the right; every 6-16 s a gust (2-5 s, usually to the right,
  // sometimes back) with a flutter in it; every 20-40 s a whirlwind crosses
  // the view, spinning everything around its centre and lifting it a little.
  // Leaves and petals feel it as a force (windAt); the snow shader gets the
  // integrated drift (off) and the swirl angle, so nothing ever jumps.
  const WIND_NOISE = makeNoise(77);
  const wind = {
    vx: 0.15, off: 0,                     // current speed (units/s) and its integral
    gust: 0, gustTo: 0, gustEnd: 0, nextGust: 8,
    vort: { on: false, x: 0, y: 0, vx: 0, age: 0, life: 1, s: 0, R: 2.3, omega: 0, swirl: 0 },
    nextVort: 22,
  };
  const BREEZE = 0.15;

  function startGust(dir) {
    wind.gustTo = (0.7 + Math.random() * 1.5) * (dir || (Math.random() < 0.8 ? 1 : -1));
    wind.gustEnd = now + 2 + Math.random() * 3;
    wind.nextGust = 6 + Math.random() * 10;
  }
  function startVortex(x, y) {
    const v = wind.vort, fromLeft = x === undefined ? Math.random() < 0.6 : x < 0;
    v.on = true;
    v.x = x !== undefined ? x : (fromLeft ? -PW / 4 : PW / 4) + (Math.random() - 0.5) * 3;
    v.y = y !== undefined ? y : -1 + Math.random() * 2.5;
    v.vx = (fromLeft ? 1 : -1) * (0.45 + Math.random() * 0.35);
    v.age = 0;
    v.life = 7 + Math.random() * 3;
    v.R = 2 + Math.random() * 0.8;
    wind.nextVort = 20 + Math.random() * 20;
  }

  function updateWind(dt) {
    const active = options.leaves;               // the weather switch
    wind.nextGust -= dt;
    wind.nextVort -= dt;
    if (active && wind.nextGust <= 0) startGust();
    if (active && wind.nextVort <= 0 && !wind.vort.on) startVortex();
    // Gust envelope: builds in ~0.8 s, fades in ~1.5 s.
    const to = now < wind.gustEnd ? wind.gustTo : 0;
    wind.gust += (to - wind.gust) * (1 - Math.exp(-dt * (to ? 1.3 : 0.7)));
    const flutter = 1 + 0.3 * Math.sin(now * 3.1) + 0.15 * Math.sin(now * 7.3);
    wind.vx = (active ? BREEZE : 0) + wind.gust * flutter;
    wind.off += wind.vx * dt;
    // Whirlwind: strength rises and falls over its life while it travels.
    const v = wind.vort;
    if (v.on) {
      v.age += dt;
      v.x += (v.vx + wind.vx * 0.2) * dt;
      v.s = Math.pow(Math.sin(Math.PI * clamp(v.age / v.life, 0, 1)), 2);   // eases in and out (zero slope at both ends)
      v.omega = 2.6 * v.s;                       // radians per second at the centre
      v.swirl += v.omega * dt;
      if (v.age >= v.life) { v.on = false; v.s = 0; v.omega = 0; }
    }
  }

  // Wind velocity at a point (panel units): the global wind with a little
  // spatial variation, plus the whirlwind (tangential spin and an updraft).
  const windOut = { x: 0, y: 0, spin: 0 };
  function windAt(x, y) {
    const n = WIND_NOISE(x * 0.18 + now * 0.4, y * 0.18 + 3.1);
    windOut.x = wind.vx * (0.75 + 0.5 * n);
    windOut.y = -0.15 * Math.abs(wind.gust) * (n - 0.5);
    windOut.spin = 0;
    const v = wind.vort;
    if (v.on) {
      const dx = x - v.x, dy = y - v.y, f = Math.exp(-(dx * dx + dy * dy) / (v.R * v.R));
      windOut.x += -dy * v.omega * f;
      windOut.y += dx * v.omega * f + 0.9 * v.s * f;
      windOut.spin = v.s * f;
    }
    return windOut;
  }

  // ---- Falling leaves and rose petals ---------------------------------------
  // Now and then a leaf (real scanned maple leaves, CC0, from ambientCG; see
  // tools/leaves.py) or a red rose petal (CC0 photo from StockSnap; see
  // tools/petals.py) drifts down in front of the panel: it sways from side
  // to side, tumbles showing its back, and casts a soft shadow on the clock.
  // The atlases come as data URIs (js/leafatlas.js, js/petalatlas.js) so
  // WebGL can use them from file:// too.
  const leafGroup = new THREE.Group();
  // Shadows are not drawn through the shadow map: with variance shadow maps
  // a thin object far from the surface gets a bright halo around its shadow.
  // Each piece instead lays its own silhouette, blurred and dark, on the panel
  // (or on the wall) along the key light; the further away, the larger.
  const leafShadowGroup = new THREE.Group();
  scene.add(leafShadowGroup);
  const lightDir = new THREE.Vector3();
  scene.add(leafGroup);
  const leaves = [];
  let nextLeaf = 3;                       // seconds until the next piece
  const LEAF_MAX = 14;

  // Normals for the ambient occlusion pass, cut out by the texture alpha
  // (MeshNormalMaterial has no alpha map).
  function cutoutNormalMaterial(tex) {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vN;
        void main() {
          vUv = uv;
          vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        #include <packing>
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec3 vN;
        void main() {
          if (texture2D(map, vUv).a < 0.5) discard;
          vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
          gl_FragColor = vec4(packNormalToRGB(n), 1.0);
        }`,
      side: THREE.DoubleSide,
    });
  }

  // One kind of falling piece: atlas, grid, size and motion.
  function makeKind(atlas, grid, o, normals) {
    if (!atlas || !grid) return null;
    const shadow = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const tex = new THREE.TextureLoader().load(atlas, t => {
      // A blurred copy of the atlas gives the shadows their soft edge.
      const img = t.image, c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.filter = 'blur(' + Math.round(img.width / 220) + 'px)';
      x.drawImage(img, 0, 0);
      shadow.map = new THREE.CanvasTexture(c);
      shadow.needsUpdate = true;
    });
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: o.rough, metalness: 0,
      envMapIntensity: o.env,   // the bright studio would wash out the colours
    });
    // Surface relief: veins and folds (a normal map in the same atlas layout).
    if (normals) {
      const nt = new THREE.TextureLoader().load(normals);
      nt.anisotropy = tex.anisotropy;
      mat.normalMap = nt;
      mat.normalScale.set(o.bump, o.bump);
    }
    return Object.assign({ grid, mat, shadow, normal: cutoutNormalMaterial(tex) }, o);
  }
  const KINDS = {
    // cup: how much the piece is curved across (x) and along (y) its length.
    leaves: makeKind(window.LEAF_ATLAS, window.LEAF_GRID, {
      size: [0.85, 0.5], fall: [0.45, 0.35], sway: [0.5, 0.9], spin: [0.8, 2.2],
      every: [2.5, 6], rough: 0.85, env: 0.15, grip: 1.4,
      bump: 1.5, cup: [0.09, 0.05],
    }, window.LEAF_NORMAL),
    // Petals are smaller and lighter: they fall more slowly, flutter and
    // spin faster, and come more often.
    petals: makeKind(window.PETAL_ATLAS, window.PETAL_GRID, {
      size: [0.38, 0.22], fall: [0.3, 0.22], sway: [0.4, 0.8], spin: [1.6, 3],
      every: [0.8, 2.2], rough: 0.55, env: 0.25, grip: 2.6,
      bump: 0.8, cup: [0.2, 0.12],
    }, window.PETAL_NORMAL),
  };

  function spawnLeaf(kindId) {
    const K = KINDS[kindId];
    if (!K) return;
    const G = K.grid, i = Math.floor(Math.random() * G.count);
    const c = i % G.cols, r = Math.floor(i / G.cols);
    const rnd = Math.random;
    const size = K.size[0] + rnd() * K.size[1];
    const flat = new THREE.PlaneGeometry(size, size, 8, 8);
    const uv = flat.attributes.uv;
    for (let j = 0; j < uv.count; j++) {
      uv.setXY(j, (c + uv.getX(j)) / G.cols, 1 - (r + 1 - uv.getY(j)) / G.rows);
    }
    // The piece itself is curved: cupped across, bent along its length, with
    // a little random twist, so the light slides over it as it turns. Its
    // shadow keeps the flat copy.
    const geo = flat.clone();
    const pos = geo.attributes.position;
    const cx = K.cup[0] * (0.6 + 0.8 * rnd()), cy = K.cup[1] * (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd());
    const tw = (rnd() - 0.5) * K.cup[0];
    for (let j = 0; j < pos.count; j++) {
      const u = pos.getX(j) / size * 2, v = pos.getY(j) / size * 2;   // -1 .. 1
      pos.setZ(j, size * (cx * u * u + cy * v * v + tw * u * v));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, K.mat);
    m.userData.kind = K;
    m.castShadow = false;           // see leafShadowGroup
    // Each shadow has its own material (sharing the texture) to fade on its own.
    const sh = new THREE.Mesh(flat, K.shadow.clone());
    sh.visible = false;
    leafShadowGroup.add(sh);
    m.rotation.order = 'ZYX';
    const L = {
      mesh: m, shadow: sh, kind: K, t: 0,
      ox: 0, vx: 0, vy: 0, rot: 0, lean: 0,   // wind: offset, velocity, spin and lean
      x0: (rnd() * 2 - 1) * (PW / 2 + 0.5),
      y: 0,
      z: 0.7 + rnd() * 3,
      fall: K.fall[0] + rnd() * K.fall[1],   // units per second
      drift: 0.1 + rnd() * 0.25,             // a light breeze to the right
      swayA: K.sway[0] + rnd() * K.sway[1], swayW: 0.9 + rnd() * 0.8, phase: rnd() * 6.28,
      spin: (rnd() < 0.5 ? -1 : 1) * (K.spin[0] + rnd() * K.spin[1]),
      tilt: 0.3 + rnd() * 0.5,
      size, mode: 'fall', target: null, blend: 0, shK: 1,
      rest: { rx: 0, ry: 0, rz: 0 }, restY: 0, restZ: 0, restKind: null,
    };
    L.zFall = L.z;
    const pick = rnd();
    if (pick < 0.22 && Math.abs(L.x0) < PW / 2 - 1) {
      L.target = 'top';
      L.rest = { rx: -(0.3 + rnd() * 0.35), ry: (rnd() - 0.5) * 0.6, rz: (rnd() - 0.5) * 1.2 };
    } else if (pick < 0.38) {
      L.target = 'floor';
      L.rest = { rx: -(1.0 + rnd() * 0.25), ry: (rnd() - 0.5) * 1.6, rz: (rnd() - 0.5) * 0.8 };
    }
    // Start high enough that the shadow, cast down along the light, also
    // starts above the top of the view (otherwise it pops in on the panel).
    lightDir.copy(key.position).normalize();
    const drop = Math.max(0, lightDir.y) * (L.z - SHADOW_Z) / Math.max(0.2, lightDir.z);
    L.y = L.y0 = Math.max(PH / 2 + 2.2, viewTop + 1.2 + size + drop);
    leafGroup.add(m);
    leaves.push(L);
  }
  const SHADOW_Z = RECESS + 0.004;

  // Projects a piece along the key light onto the plane of the panel face.
  // Outside the panel the shadow stays on that same plane (just in front of
  // the wall, which the near-frontal camera cannot tell apart): switching to
  // the wall plane at the panel edge made the shadow jump.
  function placeLeafShadow(L) {
    const m = L.mesh, sh = L.shadow;
    lightDir.copy(key.position).normalize();
    const zp = SHADOW_Z;
    const t = (m.position.z - zp) / Math.max(0.2, lightDir.z);
    const sx = m.position.x - lightDir.x * t, sy = m.position.y - lightDir.y * t;
    const h = m.position.z - zp;                       // height above the surface
    sh.position.set(sx, sy, zp);
    sh.rotation.set(0, 0, m.rotation.z);
    // A tumbling piece casts a narrower shadow; a far one a larger one.
    const grow = 1 + 0.06 * h;
    sh.scale.set(Math.max(0.15, Math.abs(Math.cos(m.rotation.y))) * grow,
      Math.max(0.2, Math.abs(Math.cos(m.rotation.x))) * grow, 1);
    // Fades in over the first second, like the leaf coming into the light.
    sh.material.map = L.kind.shadow.map;
    sh.material.opacity = L.kind.shadow.opacity * smoothstep(0, 1.2, L.t) * L.shK;
    sh.visible = !!sh.material.map;
  }

  function updateLeaves(dt) {
    nextLeaf -= dt;
    const id = weatherId(), K = KINDS[id];
    if (nextLeaf <= 0) {
      if (K && leaves.length < LEAF_MAX * (id === 'petals' ? 2 : 1)) {
        const n = Math.random() < 0.2 ? 2 + Math.floor(Math.random() * 2) : 1;   // sometimes a small gust
        for (let i = 0; i < n; i++) spawnLeaf(id);
      }
      nextLeaf = K ? K.every[0] + Math.random() * K.every[1] : 1;
    }
    for (const k in KINDS) {
      if (KINDS[k]) KINDS[k].shadow.opacity = clamp(0.5 * key.intensity / 1.1, 0, 0.6);
    }
    for (let i = leaves.length - 1; i >= 0; i--) {
      const L = leaves[i], m = L.mesh;
      L.t += dt;
      const g = 1 - Math.exp(-dt * L.kind.grip);
      const s = Math.sin(L.t * L.swayW + L.phase);
      let x = m.position.x;
      if (L.mode === 'fall') {
        // Near its resting place a piece that means to settle slows its sway
        // and moves to the depth of the ledge (or of the ground).
        let near = 0;
        if (L.target) {
          restPose(L);
          near = smoothstep(L.restY + 2.6, L.restY + 0.6, L.y);
        }
        // Falls faster when flat to the motion, slower at the top of a swing.
        L.y -= L.fall * (0.75 + 0.25 * Math.abs(s)) * (1 - 0.4 * near) * dt;
        // The wind pulls the piece along (lighter pieces follow it faster).
        x = L.x0 + L.t * L.drift + L.swayA * s * (1 - 0.7 * near) + L.ox;
        const w = windAt(x, L.y);
        L.vx += (w.x - L.vx) * g;
        L.vy += (w.y - L.vy) * g;
        L.ox += L.vx * dt;
        L.y += L.vy * dt;
        const zGoal = L.target ? L.zFall + (L.restZ - L.zFall) * near : L.zFall;
        L.z += (zGoal - L.z) * (1 - Math.exp(-dt * (L.blend > 0 ? 5 : 3)));
        m.position.set(x, L.y, L.z);
        // Gusts lean it over; it tumbles faster in strong wind and whirlwinds.
        L.lean += (clamp(-L.vx * 0.35, -0.9, 0.9) - L.lean) * g;
        L.rot += L.spin * (1 + 1.2 * Math.abs(L.vx) + 3 * w.spin) * (1 - 0.8 * near) * dt;
        let rz = 0.7 * Math.cos(L.t * L.swayW + L.phase) + L.lean;   // rocks with the swing
        let ry = L.rot;                                               // tumbles, showing its back
        let rx = L.tilt * Math.sin(L.t * 1.3 + L.phase);
        // Just lifted off: blend from the resting pose into the tumble.
        if (L.blend > 0) {
          L.blend = Math.max(0, L.blend - dt * 1.6);
          const b = smooth(L.blend);
          rx += (L.rest.rx - rx) * b; ry += (L.rest.ry - ry) * b; rz += (L.rest.rz - rz) * b;
        }
        m.rotation.set(rx, ry, rz);
        // Touchdown: on the ledge only over the panel, on the ground only
        // away from the credit line.
        if (L.target && L.y <= L.restY) {
          const ok = L.target === 'top' ? Math.abs(x) < PW / 2 - 0.35
            : Math.abs(x) > 3.2 && Math.abs(x) < viewHalfW - 0.6;
          if (ok) {
            L.mode = 'land';
            L.lt = 0;
            const wrap = (a, to) => to + mod(a - to + Math.PI, Math.PI * 2) - Math.PI;
            L.from = { y: L.y, z: L.z, rx: wrap(rx, L.rest.rx), ry: wrap(ry, L.rest.ry), rz: wrap(rz, L.rest.rz) };
          } else {
            L.target = null;
          }
        }
      } else if (L.mode === 'land') {
        // Settles into its resting pose.
        restPose(L);
        L.lt += dt;
        const p = easeInOut(clamp(L.lt / 0.7, 0, 1)), F = L.from, R = L.rest;
        L.y = F.y + (L.restY - F.y) * p;
        L.z = F.z + (L.restZ - F.z) * p;
        m.position.set(x, L.y, L.z);
        m.rotation.set(F.rx + (R.rx - F.rx) * p, F.ry + (R.ry - F.ry) * p, F.rz + (R.rz - F.rz) * p);
        if (p >= 1) { L.mode = 'rest'; L.rt = 0; L.restMax = 6 + Math.random() * 10; }
      } else {
        // Resting: trembles in the wind; a gust (or, after a while, any
        // breath of wind) lifts it off again with a small hop.
        restPose(L);
        L.rt += dt;
        L.y = L.restY;                         // follows the snow as it builds or melts
        const w = windAt(x, L.y), ws = Math.abs(w.x) + 2 * w.spin;
        const tr = Math.min(1, ws) * 0.08;
        m.position.set(x, L.y, L.restZ);
        m.rotation.set(L.rest.rx + tr * Math.sin(L.t * 13 + L.phase),
          L.rest.ry, L.rest.rz + tr * Math.sin(L.t * 17 + L.phase * 2));
        const gust = L.rt > 1.5 && ws > 0.8 && Math.random() < dt * 3;
        if (gust || L.rt > L.restMax) {
          L.mode = 'fall';
          L.target = null;
          L.blend = 1;
          L.rot = L.rest.ry;
          L.vx = w.x * 0.8;
          L.vy = 0.9 + Math.random() * 0.5;
          // Keep the position continuous with the falling motion.
          L.ox = x - (L.x0 + L.t * L.drift + L.swayA * s);
        }
      }
      // The flying shadow fades out on the ledge and on the ground.
      const shTo = L.mode === 'fall' && !(L.target && L.y < L.restY + 1.5) ? 1 : 0;
      L.shK += (shTo - L.shK) * (1 - Math.exp(-dt * 4));
      placeLeafShadow(L);
      if (L.y < -PH / 2 - 2.5 && L.mode === 'fall' && !L.target || Math.abs(x) > Math.max(PW / 2, viewHalfW) + 7 || L.y > L.y0 + 2) {
        leafGroup.remove(m);
        leafShadowGroup.remove(L.shadow);
        L.shadow.material.dispose();
        m.geometry.dispose();
        L.shadow.geometry.dispose();
        leaves.splice(i, 1);
      }
    }
  }

  // Where a settling piece comes to rest. On the top ledge it leans back
  // against the wall (lying flat it would be invisible: the camera sees the
  // ledge almost edge-on); on the ground it lies tilted towards the camera.
  function restPose(L) {
    if (L.target === 'top' || (L.mode !== 'fall' && L.restKind === 'top')) {
      L.restKind = 'top';
      L.restY = PH / 2 + snowCap.scale.y * 0.75 + L.size * 0.3;
      L.restZ = (RECESS - BACK) / 2 + 0.03;
    } else {
      L.restKind = 'floor';
      L.restY = snowBank.position.y + (snowBank.visible ? snowBank.scale.y * 0.7 : 0) + 0.85 + L.size * 0.2;
      L.restZ = L.zFall;
    }
  }

  // ---- Weather: autumn leaves, snow, rain, rose petals -----------------------------------
  // The seasons take turns: leaves fall for a while, then it snows (snow
  // builds up on top of the clock and in a drift along the bottom of the
  // view), then it rains: drops hit the camera lens and slide down, and once
  // the rain stops the lens slowly dries. Snow melts during the next phase.
  const WEATHER = [
    { id: 'leaves', dur: 60 },
    { id: 'snow', dur: 60 },
    { id: 'rain', dur: 60 },
    { id: 'petals', dur: 60 },
  ];
  const weatherId = () => (options.leaves ? WEATHER[wx.idx].id : 'off');
  const wxGroup = new THREE.Group();      // falling snow and rain (left out of the SSAO pass)
  scene.add(wxGroup);
  const PRECIP_H = 16;                    // height of the box the particles loop in

  // Snowflakes: points animated in the vertex shader; uAmount thins them out.
  const SNOW_N = 900;
  const snowFall = (() => {
    const pos = new Float32Array(SNOW_N * 3), seed = new Float32Array(SNOW_N);
    for (let i = 0; i < SNOW_N; i++) {
      pos[i * 3] = (Math.random() * 2 - 1) * 12;
      pos[i * 3 + 1] = Math.random() * PRECIP_H;
      pos[i * 3 + 2] = 0.35 + Math.random() * 6;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uAmount: { value: 0 }, uPix: { value: 2 }, uCenterY: { value: 0 },
        uWindOff: { value: 0 }, uVort: { value: new THREE.Vector3(0, 0, 1) }, uSwirl: { value: 0 }, uOrbit: { value: 0 },
      },
      vertexShader: `
        uniform float uTime, uAmount, uPix, uCenterY, uWindOff, uSwirl, uOrbit;
        uniform vec3 uVort;   // whirlwind centre (x, y) and radius
        attribute float aSeed;
        varying float vA;
        void main() {
          float t = uTime, s = aSeed;
          vec3 p = position;
          p.y = mod(p.y - t * (0.45 + 0.45 * s), ${PRECIP_H.toFixed(1)}) - ${(PRECIP_H / 2).toFixed(1)} + uCenterY;
          p.x = mod(p.x + t * 0.06 + uWindOff * (0.7 + 0.6 * s) + 0.35 * sin(t * (0.6 + s) + s * 40.0) + 12.0, 24.0) - 12.0;
          // Whirlwind: a gentle turn around the centre (kept small so that
          // nearby flakes never fold over each other), plus each flake
          // circling on its own; both grow and fade with the whirlwind.
          vec2 dv = p.xy - uVort.xy;
          float f = exp(-dot(dv, dv) / (uVort.z * uVort.z));
          float ang = uSwirl * f * (0.8 + 0.4 * s);
          p.xy = uVort.xy + mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * dv;
          float ph = t * (2.0 + 1.6 * s) + s * 40.0;
          p.xy += uOrbit * f * (0.6 + 0.4 * s) * vec2(cos(ph), sin(ph));
          p.z += 0.15 * sin(t * 0.8 + s * 17.0);
          vA = step(s, uAmount) * smoothstep(12.0, 10.5, abs(p.x));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uPix * (1.4 + 2.2 * fract(s * 7.31)) * (40.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0 || vA < 0.01) discard;
          // A faint grey rim keeps the flakes readable against white walls.
          vec3 col = mix(vec3(1.0), vec3(0.66, 0.7, 0.78), smoothstep(0.3, 1.0, r));
          gl_FragColor = vec4(col, vA * smoothstep(1.0, 0.6, r) * 0.95);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 11;
    return pts;
  })();
  wxGroup.add(snowFall);

  // Rain: thin slanted streaks (line segments, two vertices per drop).
  const RAIN_N = 700;
  const rainFall = (() => {
    const pos = new Float32Array(RAIN_N * 6), seed = new Float32Array(RAIN_N * 2), end = new Float32Array(RAIN_N * 2);
    for (let i = 0; i < RAIN_N; i++) {
      const x = (Math.random() * 2 - 1) * 12, y = Math.random() * PRECIP_H, z = 0.35 + Math.random() * 6, s = Math.random();
      for (let k = 0; k < 2; k++) {
        pos.set([x, y, z], (i * 2 + k) * 3);
        seed[i * 2 + k] = s;
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uCenterY: { value: 0 }, uWindOff: { value: 0 }, uWindVx: { value: 0 } },
      vertexShader: `
        uniform float uTime, uAmount, uCenterY, uWindOff, uWindVx;
        attribute float aSeed, aEnd;
        varying float vA;
        void main() {
          float t = uTime, s = aSeed;
          vec3 p = position;
          p.y = mod(p.y - t * (9.0 + 5.0 * s), ${PRECIP_H.toFixed(1)}) - ${(PRECIP_H / 2).toFixed(1)} + uCenterY;
          p.x = mod(p.x + t * 0.8 + uWindOff * 1.6 + 12.0, 24.0) - 12.0;
          p += aEnd * vec3(0.04 - uWindVx * 0.09, 0.42 + 0.25 * s, 0.0);   // the tail, up and back against the wind
          vA = step(s, uAmount) * (1.0 - 0.85 * aEnd);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.5, 0.56, 0.66), 0.4 * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(g, m);
    lines.frustumCulled = false;
    lines.renderOrder = 11;
    return lines;
  })();
  wxGroup.add(rainFall);

  // Snow that settles: a lumpy, rounded drift. u runs along x, the cross
  // section goes from the front (z1) over the top to the back (z0); the
  // height is 1 and the mesh is scaled in y as the snow builds up.
  function driftGeometry(width, segX, z0, z1, seed, lump, taperW) {
    const noise = makeNoise(seed), segV = 12;
    const pos = [], idx = [];
    for (let i = 0; i <= segX; i++) {
      const u = i / segX;
      const taper = smoothstep(0, taperW, u) * smoothstep(1, 1 - taperW, u);
      const h = Math.max(0.05, 0.8 + lump * (noise(u * 9, 0.5) - 0.5) * 1.2 + 0.25 * (noise(u * 37, 2.5) - 0.5)) * taper;
      for (let j = 0; j <= segV; j++) {
        const a = j / segV * Math.PI;
        const z = z1 + (z0 - z1) * (1 - Math.cos(a)) / 2;
        pos.push((u - 0.5) * width, h * Math.pow(Math.sin(a), 0.55), z);
      }
    }
    for (let i = 0; i < segX; i++) {
      for (let j = 0; j < segV; j++) {
        const a = i * (segV + 1) + j, b = a + segV + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const snowMat = new THREE.MeshStandardMaterial({
    color: 0xf5f8fd, roughness: 0.93, metalness: 0, envMapIntensity: 0.35,
    emissive: new THREE.Color(0.05, 0.06, 0.08), side: THREE.DoubleSide,
  });
  const SNOW_CAP_H = 0.3, SNOW_BANK_H = 1.0;
  const snowCap = new THREE.Mesh(driftGeometry(PW + 0.1, 240, -BACK - 0.004, RECESS + 0.035, 5, 1, 0.012), snowMat);
  snowCap.position.y = PH / 2;
  const snowBank = new THREE.Mesh(driftGeometry(48, 320, -BACK - 0.004, 3.2, 9, 1.5, 0.01), snowMat);
  for (const m of [snowCap, snowBank]) {
    m.receiveShadow = true;
    m.visible = false;
    scene.add(m);
  }

  // Snow blown off by the wind: during gusts and whirlwinds, puffs of snow
  // lift from the cap on the clock and from the drift at the bottom, ride
  // the wind and sink again. A small pool of points updated on the CPU.
  const PUFF_N = 700;
  const puff = (() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(PUFF_N * 3), alpha = new Float32Array(PUFF_N), size = new Float32Array(PUFF_N);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uPix: { value: 2 * renderer.getPixelRatio() }, uLight: { value: 1 } },
      vertexShader: `
        uniform float uPix;
        attribute float aAlpha, aSize;
        varying float vA, vMist;
        void main() {
          vA = aAlpha;
          vMist = smoothstep(2.6, 4.0, aSize);      // big grains are soft powder clouds
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uPix * aSize * (40.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uLight;      // 1 on light walls, 0 on dark ones
        varying float vA, vMist;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          if (r > 1.0 || vA < 0.01) discard;
          // Grains: white with a grey rim. Clouds: pale blue-grey, very soft,
          // so they read on white walls too.
          // (Linear colours, before tone mapping: 0.7 would already look white.)
          vec3 grain = mix(vec3(1.0), mix(vec3(0.7, 0.74, 0.8), vec3(0.4, 0.44, 0.52), uLight), smoothstep(0.3, 1.0, r));
          vec3 cloud = mix(vec3(0.95, 0.97, 1.0), vec3(0.42, 0.46, 0.56), uLight);
          vec3 col = mix(grain, cloud, vMist);
          float edge = smoothstep(1.0, mix(0.5, 0.0, vMist), r);
          gl_FragColor = vec4(col, vA * edge * mix(1.0, mix(0.4, 0.55, uLight), vMist));
        }`,
      transparent: true,
      depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 12;
    return {
      pts, pos, alpha, size,
      vel: new Float32Array(PUFF_N * 3), age: new Float32Array(PUFF_N), life: new Float32Array(PUFF_N),
      next: 0, live: 0,
    };
  })();
  wxGroup.add(puff.pts);

  // One puff: n grains around (x, y, z), thrown along the wind and upwards.
  function emitPuff(x, y, z, n, dz) {
    const P = puff;
    for (let k = 0; k < n; k++) {
      const i = P.next;
      P.next = (P.next + 1) % PUFF_N;
      const r = Math.random;
      P.pos[i * 3] = x + (r() - 0.5) * 0.6;
      P.pos[i * 3 + 1] = y + r() * 0.12;
      P.pos[i * 3 + 2] = z + (r() - 0.5) * dz;
      const w = windAt(x, y);
      P.vel[i * 3] = w.x * (0.5 + 0.7 * r());
      P.vel[i * 3 + 1] = 0.35 + 0.9 * r() + 1.2 * w.spin;
      P.vel[i * 3 + 2] = (r() - 0.3) * 0.25;
      P.age[i] = 0;
      P.life[i] = 1.2 + 1.6 * r();
      // Mostly fine grains, some soft clouds of powder.
      P.size[i] = r() < 0.3 ? 4.5 + 5 * r() : 0.8 + 1.6 * r() * r();
    }
    P.pts.geometry.attributes.aSize.needsUpdate = true;
  }

  let puffDebt = 0;
  function updatePuffs(dt) {
    const P = puff, a = wx.acc;
    if (a > 0.06 && options.leaves) {
      // Puffs per second grow with the gust and with a whirlwind close to the snow.
      const gust = Math.max(0, Math.abs(wind.vx) - 0.45);
      const v = wind.vort;
      const nearCap = v.on ? v.s * Math.exp(-Math.pow((v.y - PH / 2) / v.R, 2)) : 0;
      const nearBank = v.on ? v.s * Math.exp(-Math.pow((v.y - snowBank.position.y) / (v.R * 1.5), 2)) : 0;
      puffDebt += dt * a * (gust * 9 + (nearCap + nearBank) * 9);
      while (puffDebt >= 1) {
        puffDebt -= 1;
        const fromCap = Math.random() < 0.55 || !snowBank.visible;
        // A whirlwind blows the snow where it is; a gust anywhere.
        const vx = v.on && (fromCap ? nearCap : nearBank) > 0.3 && Math.random() < 0.7
          ? v.x + (Math.random() - 0.5) * v.R * 1.5 : null;
        if (fromCap) {
          const x = vx !== null ? clamp(vx, -PW / 2, PW / 2) : (Math.random() - 0.5) * PW;
          emitPuff(x, PH / 2 + snowCap.scale.y * 0.6, (RECESS - BACK) / 2, 10 + Math.floor(Math.random() * 14), 0.3);
        } else {
          const x = vx !== null ? vx : (Math.random() - 0.5) * 2 * viewHalfW;
          emitPuff(x, snowBank.position.y + snowBank.scale.y * 0.7, 0.4 + Math.random() * 2.6, 14 + Math.floor(Math.random() * 16), 0.8);
        }
      }
    } else {
      puffDebt = 0;
    }
    // Move the grains: they chase the wind, sink, and fade in and out.
    let live = 0;
    for (let i = 0; i < PUFF_N; i++) {
      if (P.life[i] <= 0) { P.alpha[i] = 0; continue; }
      P.age[i] += dt;
      const u = P.age[i] / P.life[i];
      if (u >= 1) { P.life[i] = 0; P.alpha[i] = 0; continue; }
      live++;
      const j = i * 3, w = windAt(P.pos[j], P.pos[j + 1]), g = 1 - Math.exp(-dt * 2.5);
      P.vel[j] += (w.x - P.vel[j]) * g;
      P.vel[j + 1] += (w.y * 0.6 - 0.55) * dt;           // a little lift, mostly sinking
      P.pos[j] += P.vel[j] * dt;
      P.pos[j + 1] += P.vel[j + 1] * dt;
      P.pos[j + 2] += P.vel[j + 2] * dt;
      P.alpha[i] = 0.85 * smoothstep(0, 0.12, u) * (1 - smoothstep(0.55, 1, u));
    }
    P.live = live;
    // Darker powder clouds on light walls, white ones on dark walls.
    const lum = 0.2126 * look.wall.r + 0.7152 * look.wall.g + 0.0722 * look.wall.b;   // linear
    P.pts.material.uniforms.uLight.value = smoothstep(0.08, 0.35, lum);
    P.pts.visible = live > 0;
    P.pts.geometry.attributes.position.needsUpdate = true;
    P.pts.geometry.attributes.aAlpha.needsUpdate = true;
  }

  // Weather state. snow/rain: how much is falling (0..1); acc: settled snow;
  // wet: drops on the lens.
  wx.idx = 0; wx.t = 0; wx.snow = 0; wx.rain = 0; wx.acc = 0; wx.wet = 0;
  const approach = (v, to, step) => v + clamp(to - v, -step, step);

  function updateWeather(dt) {
    if (options.leaves) {
      wx.t += dt;
      if (wx.t >= WEATHER[wx.idx].dur) { wx.idx = (wx.idx + 1) % WEATHER.length; wx.t = 0; }
    }
    const id = weatherId();
    wx.snow = approach(wx.snow, id === 'snow' ? 1 : 0, dt / 6);
    wx.rain = approach(wx.rain, id === 'rain' ? 1 : 0, dt / 5);
    if (wx.snow > 0.2) wx.acc = Math.min(1, wx.acc + dt * wx.snow / 40);          // ~40 s to a full layer
    else wx.acc = Math.max(0, wx.acc - dt / (wx.rain > 0.1 ? 22 : 45));            // rain melts it faster
    if (wx.rain > 0.3) wx.wet = Math.min(1, wx.wet + dt * wx.rain / 18);           // drops gather on the lens
    else wx.wet = Math.max(0, wx.wet - dt / 28);                                   // and slowly dry
    applyWeather();
    updatePuffs(dt);
  }

  function applyWeather() {
    const su = snowFall.material.uniforms, ru = rainFall.material.uniforms;
    su.uTime.value = ru.uTime.value = now;
    su.uAmount.value = wx.snow;
    ru.uAmount.value = wx.rain;
    su.uCenterY.value = ru.uCenterY.value = -camLift;
    su.uWindOff.value = ru.uWindOff.value = wind.off;
    ru.uWindVx.value = wind.vx;
    // Snow: a travelling warp whose angle rises and falls with the whirlwind,
    // so nothing jumps when it dies out.
    su.uVort.value.set(wind.vort.x, wind.vort.y, wind.vort.R * 1.3);
    su.uSwirl.value = 1.1 * wind.vort.s;
    su.uOrbit.value = 0.55 * wind.vort.s;
    snowFall.visible = wx.snow > 0.002;
    rainFall.visible = wx.rain > 0.002;
    // Settled snow: rises with an ease, so the first flakes make a thin crust.
    const a = Math.sqrt(wx.acc);
    snowCap.visible = snowBank.visible = wx.acc > 0.002;
    snowCap.scale.y = Math.max(0.001, a * SNOW_CAP_H);
    snowBank.scale.y = Math.max(0.001, a * SNOW_BANK_H);
    post.uniforms.uRain.value = wx.wet;
    post.uniforms.uTime.value = now;
  }

  // ---- Wall behind the panel ---------------------------------------------
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), wallMat);
  wall.position.z = -BACK - 0.005;
  wall.receiveShadow = true;
  scene.add(wall);

  // ---- Panel: back plate (the dial floors) + front plate with round holes --
  const back = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, BACK), dialMat);
  back.position.z = -BACK / 2;
  back.castShadow = true;
  back.receiveShadow = true;
  scene.add(back);

  const cellX = c => c - (COLS - 1) / 2;
  const cellY = r => (ROWS - 1) / 2 - r;

  const plate = new THREE.Shape();
  plate.moveTo(-PW / 2, -PH / 2);
  plate.lineTo(PW / 2, -PH / 2);
  plate.lineTo(PW / 2, PH / 2);
  plate.lineTo(-PW / 2, PH / 2);
  plate.lineTo(-PW / 2, -PH / 2);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const hole = new THREE.Path();
      hole.absarc(cellX(c), cellY(r), HOLE_R, 0, Math.PI * 2, true);
      plate.holes.push(hole);
    }
  }
  // A small rounded bevel on every edge catches the light like a routed edge.
  const BEVEL = 0.014;
  const frontGeo = new THREE.ExtrudeGeometry(plate, {
    depth: RECESS - 2 * BEVEL, curveSegments: 56,
    bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelSegments: 3,
  });
  frontGeo.translate(0, 0, BEVEL);
  // Extrude UVs are world x/y: normalise them so the texture spans the panel,
  // like the box below (whose front face is 0..1 across the panel).
  const uv = frontGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / PW + 0.5, uv.getY(i) / PH + 0.5);
  const front = new THREE.Mesh(frontGeo, bodyMat);
  front.castShadow = true;
  front.receiveShadow = true;
  scene.add(front);

  // ---- Hands --------------------------------------------------------------
  // A bar with rounded ends, pointing up (+y) from the pivot. A deep, many-step
  // bevel (kept inside the outline by bevelOffset) gives it a domed profile,
  // so the edges catch moving highlights as the hand turns.
  function handGeometry() {
    const r = HAND_W / 2, s = new THREE.Shape();
    s.moveTo(-r, -HAND_TAIL + r);
    s.lineTo(-r, HAND_LEN - r);
    s.absarc(0, HAND_LEN - r, r, Math.PI, 0, true);
    s.lineTo(r, -HAND_TAIL + r);
    s.absarc(0, -HAND_TAIL + r, r, 0, Math.PI, true);
    return new THREE.ExtrudeGeometry(s, {
      depth: 0.006, curveSegments: 12,
      bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.015, bevelOffset: -0.015, bevelSegments: 5,
    });
  }
  const handGeo = handGeometry();
  // Hub: a small dome over the pivot.
  const hubGeo = new THREE.SphereGeometry(0.032, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    .rotateX(Math.PI / 2).scale(1, 1, 0.6);

  // Each small clock keeps its two hands: [0] = hour, [1] = minute.
  const clocks = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = cellX(c), y = cellY(r);
      const k = {
        c, r, x, y,
        dist: Math.hypot(x, y),
        th: Math.atan2(x, y) / DEG,      // clock angle pointing away from the grid centre
        hands: [],
      };
      for (let h = 0; h < 2; h++) {
        const pivot = new THREE.Group();
        pivot.position.set(x, y, 0.07 + h * 0.035);
        const mesh = new THREE.Mesh(handGeo, handMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        pivot.add(mesh);
        scene.add(pivot);
        k.hands.push({ pivot, angle: N, from: N, off: 0, delay: 0, dur: 1, len: 1, fromLen: 1, toLen: 1, vel: 0, vel0: 0 });
      }
      const hub = new THREE.Mesh(hubGeo, handMat);
      hub.position.set(x, y, 0.135);
      hub.castShadow = true;
      scene.add(hub);
      clocks.push(k);
    }
  }

  // ---- Choreographies -----------------------------------------------------
  // f(clock, hand, t) returns the angle of a hand t seconds into the scene;
  // stagger(clock) delays each clock when the scene begins.
  const CORNERS = [[R, D], [L, D], [U, R], [U, L]];   // ┌ ┐ └ ┘ tiled in 2x2 blocks
  const SCENES = [
    { // Parallel lines sweeping across the panel like wind on grass.
      stagger: k => k.c * 0.08,
      f: (k, h, t) => 135 + t * 28 + k.c * 15 - k.r * 5 + h * 180,
    },
    { // Lines aiming at the centre, swaying in rings.
      stagger: k => k.dist * 0.12,
      f: (k, h, t) => k.th + h * 180 + 38 * Math.sin(t * 0.9 - k.dist * 0.75),
    },
    { // Chevrons opening away from the centre, breathing slowly.
      stagger: k => k.dist * 0.12,
      f: (k, h, t) => k.th + (h ? 1 : -1) * (58 + 34 * Math.sin(t * 0.8 - k.dist * 0.55)),
    },
    { // Interlocking squares turning like gears.
      stagger: k => (k.c + k.r) * 0.05,
      f: (k, h, t) => {
        const base = CORNERS[(k.r & 1) * 2 + (k.c & 1)][h];
        const dir = ((k.c + k.r) & 1) ? -1 : 1;
        return base + dir * 90 * steps(t / 2.6);
      },
    },
    { // Horizontal lines flipping to vertical in a ripple from the centre.
      stagger: k => k.dist * 0.1,
      f: (k, h, t) => 90 + h * 180 + 90 * steps(t / 2.8 - k.dist * 0.16),
    },
    { // A slow spiral: hands turn together with a phase that grows with distance.
      stagger: k => k.dist * 0.1,
      f: (k, h, t) => {
        const a = t * 36 - k.dist * 42;
        return h ? a + 90 + 70 * Math.sin(t * 0.6) : a;
      },
    },
    { // Every small clock becomes a real clock showing the current time: the
      // hands make a full turn in a ripple from the centre, the hour hand
      // shortens so the two can be told apart, and the minute hand runs live.
      stagger: k => k.dist * 0.12,
      dur: 3.4, hold: 10, spins: 1, dir: () => 1, hourLen: 0.62,
      f: (k, h) => {
        const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60;
        return h ? m * 6 : (d.getHours() % 12) * 30 + m * 0.5;
      },
    },
    { // Fibonacci spiral: every pair of hands follows a golden logarithmic
      // spiral around the centre; two arms sweep round, folding the hands.
      stagger: k => k.dist * 0.1,
      hold: 14,
      f: (k, h, t) => {
        const s = k.th - Math.log(k.dist) / SPIRAL_B / DEG;     // position along the spiral
        const arm = Math.pow(0.5 + 0.5 * Math.cos((2 * s - t * 55) * DEG), 4);
        const tangent = k.th + SPIRAL_PSI + t * 9;               // slow overall turn
        const spread = 180 - 75 * arm;                           // a line that folds a little
        return tangent + 90 + (h ? spread / 2 : -spread / 2);
      },
    },
    { // Wind field: the hands are blades of grass in a drifting flow of noise,
      // gusts bending the minute hand away from the hour hand.
      stagger: k => k.c * 0.06,
      hold: 14,
      f: (k, h, t) => {
        const a = 70 + (WIND_A(k.x * 0.21 + t * 0.32, k.y * 0.21 + t * 0.09) - 0.5) * 230
          + (WIND_B(k.x * 0.5 - t * 0.6, k.y * 0.5) - 0.5) * 50;
        const gust = (WIND_B(k.x * 0.12 + t * 0.5, 7.3) - 0.5) * 70;
        return h ? a : a + 180 + gust;
      },
    },
  ];
  // Golden spiral: r = e^(b*theta) with growth phi every quarter turn;
  // its tangent makes a constant angle PSI with the radius.
  const SPIRAL_B = Math.log((1 + Math.sqrt(5)) / 2) / (Math.PI / 2);
  const SPIRAL_PSI = Math.atan(1 / SPIRAL_B) / DEG;
  const WIND_A = makeNoise(101), WIND_B = makeNoise(202);

  // Wave from a point (ox, oy in panel units, e.g. where the user clicked):
  // the hands draw concentric rings around it, and pulses run outwards like
  // ripples on water, turning the hands they cross by a quarter turn.
  const WAVE_SPEED = 4.5, WAVE_GAP = 7, WAVE_WIDTH = 2.4;   // cells/s, cells, cells
  function makeWave(ox, oy) {
    const cache = new Map();
    const geo = k => {
      let g = cache.get(k);
      if (!g) {
        const dx = k.x - ox, dy = k.y - oy;
        g = { d: Math.hypot(dx, dy), th: Math.atan2(dx, dy) / DEG };
        cache.set(k, g);
      }
      return g;
    };
    return {
      dur: 1.6, hold: 11, dir: () => 1,
      stagger: k => geo(k).d * 0.09,
      f: (k, h, t) => {
        const g = geo(k);
        const u = t * WAVE_SPEED - g.d;                          // > 0 once the first pulse arrived
        const w = mod(u, WAVE_GAP);
        const pulse = u > 0 && w < WAVE_WIDTH ? Math.pow(Math.sin(w / WAVE_WIDTH * Math.PI), 2) : 0;
        return g.th + 90 + 90 * pulse * Math.exp(-g.d * 0.05) + h * 180;
      },
    };
  }

  // ---- Motion engine ------------------------------------------------------
  let now = 0;                    // seconds since start
  let active = null;              // { f, t0 }

  // Hands keep their momentum: when a transition starts, a moving hand does
  // not freeze but coasts on, slowing down with this time constant (s), and
  // the move to the new target is blended on top of that coasting motion.
  const COAST = 1.1;
  const coast = (hd, tau) => hd.from + hd.vel0 * COAST * (1 - Math.exp(-Math.max(0, tau) / COAST));

  // Start moving every hand from where it is now towards target f.
  // dir(k, h): +1 clockwise, -1 counter-clockwise (a hand that is already
  // turning keeps its own direction). spins: extra full turns.
  // hourLen: length of the hour hand (1 = full; the minute hand stays full).
  function transition(f, opts) {
    for (const k of clocks) {
      for (let h = 0; h < 2; h++) {
        const hd = k.hands[h];
        hd.from = hd.angle;
        hd.vel0 = hd.vel;
        hd.fromLen = hd.len;
        hd.toLen = h === 0 ? (opts.hourLen || 1) : 1;
        hd.delay = opts.stagger(k);
        hd.dur = opts.dur;
        const dir = hd.vel > 8 ? 1 : hd.vel < -8 ? -1 : opts.dir(k, h);
        const goal = f(k, h, hd.delay + hd.dur);
        const rest = hd.from + hd.vel0 * COAST;   // where coasting alone would stop
        let d = mod(goal - rest, 360);
        if (dir < 0 && d > 0) d -= 360;
        d += dir * 360 * (opts.spins || 0);
        hd.off = rest + d - goal;        // keeps the target unwrapped near the hand
      }
    }
    active = { f, t0: now };
  }

  // Near a whirlwind the small clocks turn a little with it (anticlockwise,
  // like the vortex), smoothly, without trembling.
  function windWobble(k) {
    const v = wind.vort;
    if (!v.on || v.s < 0.001) return 0;
    const dx = k.x - v.x, dy = k.y - v.y;
    return -9 * v.s * Math.exp(-(dx * dx + dy * dy) / (v.R * v.R * 1.4));
  }

  function updateHands(dt) {
    const t = now - active.t0;
    for (const k of clocks) {
      for (let h = 0; h < 2; h++) {
        const hd = k.hands[h];
        const p = easeInOut(clamp((t - hd.delay) / hd.dur, 0, 1));
        const goal = active.f(k, h, t) + hd.off;
        const base = coast(hd, t);
        const prev = hd.angle;
        hd.angle = base + (goal - base) * p;
        // Angular velocity (deg/s), smoothed, for the next transition.
        if (dt > 0 && dt < 0.2) hd.vel += ((hd.angle - prev) / dt - hd.vel) * Math.min(1, dt * 12);
        hd.len = hd.fromLen + (hd.toLen - hd.fromLen) * p;
        hd.pivot.rotation.z = -(hd.angle + windWobble(k)) * DEG;
        hd.pivot.scale.y = hd.len;
      }
    }
  }

  // ---- Time display -------------------------------------------------------
  function timeKey() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  function timeTarget(key) {
    const cells = clocks.map(k => {
      const glyph = DIGITS[+key[Math.floor(k.c / DIGIT_W)]];
      return SYM[glyph[k.r][k.c % DIGIT_W]];
    });
    return (k, h) => cells[k.r * COLS + k.c][h];
  }

  let phase = 'rest', phaseEnd = 1.2, shownKey = '', lastScene = -1;

  // `key` (four digits) overrides the current time, for tests.
  let forcedKey = '';
  function showTime(quick, key) {
    if (key !== undefined) forcedKey = key;
    shownKey = forcedKey || timeKey();
    transition(timeTarget(shownKey), {
      dur: quick ? 2.0 : TO_TIME,
      stagger: quick ? (k => k.c * 0.04) : (k => k.c * 0.07 + k.r * 0.03),
      dir: (k, h) => h ? 1 : -1,
    });
    phase = 'time';
    if (!quick) phaseEnd = now + TIME_HOLD;
  }

  function showScene(forced) {
    let i = forced;
    if (i === undefined) {
      do { i = Math.floor(Math.random() * SCENES.length); } while (i === lastScene);
    }
    lastScene = i;
    const s = SCENES[i];
    transition(s.f, {
      dur: s.dur || TO_SCENE, stagger: s.stagger, dir: s.dir || ((k, h) => h ? 1 : -1),
      spins: s.spins || 0, hourLen: s.hourLen || 1,
    });
    phase = 'scene';
    phaseEnd = now + (s.hold || SCENE_HOLD);
  }

  function sequence() {
    if (phase === 'rest' && now >= phaseEnd) showTime(false);
    else if (phase === 'time') {
      if (now >= phaseEnd) showScene();
      else if ((forcedKey || timeKey()) !== shownKey) showTime(true);
    } else if (phase === 'scene' && now >= phaseEnd) showTime(false);
  }

  // Start with every hand at rest.
  active = { f: () => N, t0: 0 };

  // ---- Camera framing and calm drift --------------------------------------
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX / window.innerWidth * 2 - 1;
    mouse.y = e.clientY / window.innerHeight * 2 - 1;
  });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    const dpr = renderer.getPixelRatio();
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    sceneRT.setSize(W, H);
    post.uniforms.uRes.value.set(W, H);
    // Ambient occlusion at half resolution.
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    normalRT.setSize(hw, hh);
    aoRT.setSize(hw, hh);
    aoBlurRT.setSize(hw, hh);
    ssaoMat.uniforms.uRes.value.set(hw, hh);
    aoBlurMat.uniforms.uRes.value.set(hw, hh);
    post.uniforms.uBlur.value = 3.2 * dpr;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Fit the panel with some air around it, keeping a free band at the
    // bottom (BOTTOM_PX) for the credit and the two round buttons, and a
    // small one at the top. The panel is centred in the space that is left.
    const BOTTOM_PX = 66, TOP_PX = 40;
    const tan = Math.tan(camera.fov * DEG / 2);
    const free = 1 - (BOTTOM_PX + TOP_PX) / h;       // share of the height for the panel
    const visH = Math.max((PW * 1.05) / camera.aspect, (PH * 1.06) / Math.max(0.3, free));
    camDist = visH / (2 * tan);
    // Shift (world units) that moves the panel up into the free area.
    camLift = visH * (BOTTOM_PX - TOP_PX) / (2 * h);
    viewTop = visH / 2 - camLift;                    // top edge of the view, panel units
    viewHalfW = visH * camera.aspect / 2;
    snowBank.position.y = -camLift - visH / 2 - 0.3;
  }
  let camLift = 0, viewTop = 8, viewHalfW = 12;
  window.addEventListener('resize', resize);
  resize();

  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 1.5);
    mouse.sx += (mouse.x - mouse.sx) * k;
    mouse.sy += (mouse.y - mouse.sy) * k;
    const ax = Math.sin(now * 0.05) * 0.07 + mouse.sx * 0.05;
    const ay = Math.sin(now * 0.037 + 1) * 0.04 - mouse.sy * 0.035;
    camera.position.set(Math.sin(ax) * camDist, Math.sin(ay) * camDist - camLift, Math.cos(ax) * Math.cos(ay) * camDist);
    camera.lookAt(0, -camLift, 0);
  }

  // ---- Main loop ----------------------------------------------------------
  let last = performance.now();
  function frame(ms) {
    const dt = Math.min(0.1, (ms - last) / 1000);
    last = ms;
    now += dt;
    sequence();
    updateHands(dt);
    updateLook(dt);
    updateEffects(dt);
    updateWind(dt);
    updateLeaves(dt);
    updateWeather(dt);
    updateCamera(dt);
    renderFrame();
    requestAnimationFrame(frame);
  }

  // The effects fade in and out when they are switched.
  function updateEffects(dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt * 3) : 1;
    const ease = (u, on) => { u.value += ((on ? 1 : 0) - u.value) * k; };
    ease(post.uniforms.uLens, options.lens);
    ease(post.uniforms.uAO, options.ao);
    ease(post.uniforms.uFilm, options.film);
  }

  // ---- Click: a wave starting where the panel was clicked ------------------
  const raycaster = new THREE.Raycaster();
  const facePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -RECESS);
  const hit = new THREE.Vector3();
  renderer.domElement.addEventListener('click', e => {
    const ndc = new THREE.Vector2(e.clientX / window.innerWidth * 2 - 1, -(e.clientY / window.innerHeight * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(facePlane, hit)) return;
    if (Math.abs(hit.x) > PW / 2 || Math.abs(hit.y) > PH / 2) return;   // only clicks on the panel
    showWave(hit.x, hit.y);
  });

  function showWave(ox, oy) {
    const s = makeWave(ox, oy);
    transition(s.f, { dur: s.dur, stagger: s.stagger, dir: s.dir, hourLen: 1 });
    phase = 'scene';
    phaseEnd = now + s.hold;
  }

  requestAnimationFrame(frame);

  // Public hooks: options for the palette, and helpers for headless tests.
  window.CLOCK = {
    get now() { return now; }, set now(v) { now = v; },
    showTime, showScene, showWave, SCENES, clocks, setLook,
    scene: i => showScene(i),
    // sun: light follows the time of day; lens: lens blur at the edges;
    // ao: ambient occlusion; film: vignette + grain;
    // leaves: the weather cycle (autumn leaves, snow, rain, rose petals).
    setOptions(o) { Object.assign(options, o); },
    // Fixed hour (0-24) for the sun, or null for the real time.
    setHour(h) { hourOverride = h; },
    // Jump to a weather phase ('leaves', 'snow', 'rain', 'petals'); full: at its peak
    // straight away (falling, settled snow, wet lens), for tests.
    setWeather(id, full) {
      const i = WEATHER.findIndex(w => w.id === id);
      if (i < 0) return;
      wx.idx = i; wx.t = 0;
      if (full) {
        wx.snow = id === 'snow' ? 1 : 0; wx.rain = id === 'rain' ? 1 : 0;
        wx.acc = id === 'snow' ? 1 : wx.acc; wx.wet = id === 'rain' ? 1 : wx.wet;
        applyWeather();
      }
    },
    // Start a gust (dir: 1 right, -1 left) or a whirlwind (at x, y) now.
    gust(dir) { startGust(dir); },
    // Drop a piece that settles on the ledge ('top') or the ground ('floor').
    settle(where, kind, x) {
      spawnLeaf(kind || 'leaves');
      const L = leaves[leaves.length - 1];
      if (!L) return;
      L.target = where;
      L.rest = where === 'top' ? { rx: -0.45, ry: 0.2, rz: 0.4 } : { rx: -1.1, ry: 0.5, rz: 0.2 };
      if (x !== undefined) { L.x0 = x; L.swayA = 0.05; L.drift = 0; }
    },
    get puffs() {
      const r = { live: puff.live, cap: 0, bank: 0, maxA: 0, y: [] };
      for (let i = 0; i < PUFF_N; i++) if (puff.life[i] > 0) {
        const y = puff.pos[i * 3 + 1];
        if (y > 0) r.cap++; else r.bank++;
        r.maxA = Math.max(r.maxA, puff.alpha[i]);
      }
      return r;
    },
    get pieces() { return leaves.map(L => ({ mode: L.mode, target: L.target, x: L.mesh.position.x, y: L.mesh.position.y, vx: L.vx, vy: L.vy, sx: L.shadow.position.x, sy: L.shadow.position.y, so: L.shadow.material.opacity, t: L.t })); },
    get viewTop() { return viewTop; },
    whirl(x, y) { startVortex(x, y); },
    get wind() { return { vx: wind.vx, gust: wind.gust, vortex: Object.assign({}, wind.vort) }; },
    get weather() { return Object.assign({ id: weatherId() }, wx); },
    // Drop a leaf now; with x, y it starts there (panel units), for tests.
    dropLeaf(x, y, kind) {
      spawnLeaf(kind || 'leaves');
      if (leaves.length === 0) return;
      const L = leaves[leaves.length - 1];
      if (x !== undefined) { L.x0 = x; L.y = y; L.swayA = 0; L.drift = 0; L.fall = 0.01; L.spin = 0.15; }
    },
    // Advance the simulation synchronously by s seconds, in 60 Hz steps (so hand velocities are tracked).
    advance(s) {
      for (let i = 0, n = Math.round(s * 60); i < n; i++) { now += 1 / 60; sequence(); updateHands(1 / 60); updateWind(1 / 60); updateLeaves(1 / 60); updateWeather(1 / 60); }
      updateLook(0, true); updateEffects(0); updateCamera(0); renderFrame();
    },
  };
})();
