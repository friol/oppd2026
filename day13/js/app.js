// Mandelbülben — raymarched 3D fractals with a simulated camera lens
// (focal length, aperture, focus distance), bokeh and bloom.

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Fractal catalogue, in menu order. id: FRACTAL define in shaders.js.
  // dist: radius to frame; bound: radius of the enclosing sphere; fudge: DE scale.
  // a/b: sliders bound to uParamA/uParamB; twist: which param feeds uRot.
  // morph: amplitude of the oscillation applied to a/b while "morph" is on.
  // infinite: fills space, explored with the fly camera from `start`.
  // ---------------------------------------------------------------------------
  const P = (label, min, max, step, value) => ({ label, min, max, step, value });
  const FRACTALS = [
    // Bulbs
    { id: 0, group: 'Bulbs', name: 'Mandelbulb', dist: 1.15, bound: 1.25, fudge: 0.9, iter: 8, maxIter: 16,
      a: P('Power', 2, 16, 0.1, 8), morph: { a: 1.2 } },
    { id: 1, group: 'Bulbs', name: 'Juliabulb', dist: 1.3, bound: 1.6, fudge: 0.75, iter: 8, maxIter: 16, julia: 'bulb',
      a: P('Power', 2, 12, 0.1, 8), morph: {} },
    { id: 8, group: 'Bulbs', name: 'Cosine Mandelbulb', dist: 1.2, bound: 1.4, fudge: 0.8, iter: 8, maxIter: 16,
      a: P('Power', 2, 16, 0.1, 8), morph: { a: 1.2 } },
    { id: 10, group: 'Bulbs', name: 'Mandelbar 3D', dist: 1.4, bound: 2.0, fudge: 0.7, iter: 10, maxIter: 20,
      a: P('Power', 2, 12, 0.1, 2), morph: { a: 0.4 } },
    { id: 11, group: 'Bulbs', name: 'Bristorbrot', dist: 1.4, bound: 2.2, fudge: 0.7, iter: 10, maxIter: 24, morph: {} },
    { id: 12, group: 'Bulbs', name: 'Mandeltorus', dist: 1.8, bound: 2.4, fudge: 0.5, iter: 6, maxIter: 14,
      a: P('Power', 2, 10, 0.1, 5), b: P('Ring radius', 0.3, 1.5, 0.01, 1.0), morph: { a: 0.6 } },
    // Hypercomplex
    { id: 3, group: 'Hypercomplex', name: 'Quaternion Julia', dist: 1.3, bound: 1.8, fudge: 1.0, iter: 11, maxIter: 20, julia: 'quat',
      a: P('Slice w', -0.8, 0.8, 0.01, 0), morph: {} },
    { id: 14, group: 'Hypercomplex', name: 'Tetrabrot (bicomplex)', dist: 1.5, bound: 2.4, fudge: 0.8, iter: 24, maxIter: 64,
      a: P('Slice w', -0.8, 0.8, 0.01, 0), morph: { a: 0.15 } },
    { id: 15, group: 'Hypercomplex', name: 'Bicomplex Julia', dist: 1.4, bound: 2.0, fudge: 0.8, iter: 24, maxIter: 64, julia: 'bicomplex',
      a: P('Slice w', -0.8, 0.8, 0.01, 0), morph: {} },
    // Boxes & hybrids
    { id: 2, group: 'Boxes & hybrids', name: 'Mandelbox', dist: 3.4, bound: 3.2, fudge: 1.0, iter: 12, maxIter: 20,
      a: P('Scale', -3, -1.3, 0.01, -1.77), b: P('Inner radius', 0.1, 0.9, 0.01, 0.5), morph: { a: 0.08 } },
    { id: 18, group: 'Boxes & hybrids', name: 'Twisted Mandelbox', dist: 3.4, bound: 3.5, fudge: 0.8, iter: 12, maxIter: 20, twist: 'b',
      a: P('Scale', -3, -1.3, 0.01, -1.77), b: P('Twist', 0, 0.6, 0.005, 0.15), morph: { b: 0.08 } },
    // Kaleidoscopic IFS
    { id: 4, group: 'Kaleidoscopic IFS', name: 'Menger sponge', dist: 1.4, bound: 2.0, fudge: 1.0, iter: 6, maxIter: 9, twist: 'a',
      a: P('Twist', 0, 0.8, 0.005, 0), b: P('Scale', 2.4, 3.5, 0.01, 3), morph: { a: 0.12 } },
    { id: 5, group: 'Kaleidoscopic IFS', name: 'Sierpiński tetrahedron', dist: 1.3, bound: 1.9, fudge: 1.0, iter: 14, maxIter: 20, twist: 'a',
      a: P('Twist', 0, 0.8, 0.005, 0.12), b: P('Scale', 1.8, 2.4, 0.01, 2), morph: { a: 0.12 } },
    { id: 6, group: 'Kaleidoscopic IFS', name: 'Octahedral IFS', dist: 1.5, bound: 2.0, fudge: 1.0, iter: 12, maxIter: 20, twist: 'b',
      a: P('Scale', 1.6, 2.8, 0.01, 2.1), b: P('Twist', 0, 0.8, 0.005, 0.25), morph: { b: 0.15 } },
    { id: 19, group: 'Kaleidoscopic IFS', name: 'Icosahedral IFS', dist: 1.5, bound: 2.2, fudge: 1.0, iter: 10, maxIter: 16, twist: 'b',
      a: P('Scale', 1.8, 3.2, 0.01, 2.0), b: P('Twist', 0, 0.8, 0.005, 0.1), morph: { b: 0.12 } },
    { id: 20, group: 'Kaleidoscopic IFS', name: 'Dodecahedral IFS', dist: 1.5, bound: 2.2, fudge: 1.0, iter: 10, maxIter: 16, twist: 'b',
      a: P('Scale', 1.8, 3.4, 0.01, 2.6), b: P('Twist', 0, 0.8, 0.005, 0.1), morph: { b: 0.12 } },
    { id: 21, group: 'Kaleidoscopic IFS', name: 'Octahedron flake', dist: 1.3, bound: 1.8, fudge: 1.0, iter: 10, maxIter: 16, twist: 'a',
      a: P('Twist', 0, 0.8, 0.005, 0), b: P('Scale', 1.8, 3.0, 0.01, 2), morph: { a: 0.12 } },
    { id: 22, group: 'Kaleidoscopic IFS', name: 'Jerusalem cube', dist: 1.4, bound: 1.9, fudge: 0.9, iter: 4, maxIter: 6, morph: {} },
    // Other bounded sets
    { id: 7, group: 'Other', name: 'Apollonian gasket', dist: 1.3, bound: 1.6, fudge: 1.0, iter: 8, maxIter: 14,
      a: P('Inversion', 1.0, 1.5, 0.005, 1.15), b: P('Cut radius', 0.6, 1.5, 0.01, 1.3), morph: { a: 0.04 } },
    // Infinite: fly camera
    { id: 25, group: 'Explore (fly)', name: 'Pseudo-Kleinian', infinite: true, dist: 0.5, bound: 1.0, fudge: 0.9, iter: 7, maxIter: 12, far: 8,
      start: { pos: [0.6, 0.15, -1.5], yaw: -0.3, pitch: 0.05 },
      a: P('Inversion size', 0.8, 1.3, 0.005, 1.0), b: P('Box size', 0.8, 1.1, 0.005, 1.0), morph: { a: 0.04 } },
    { id: 26, group: 'Explore (fly)', name: 'Kleinian group', infinite: true, dist: 0.6, bound: 1.0, fudge: 0.9, iter: 40, maxIter: 120, far: 10,
      start: { pos: [0.5, 0.3, -1.0], yaw: 0.0, pitch: 0.2 },
      a: P('Klein R', 1.8, 2.0, 0.001, 1.95), b: P('Klein I', -0.1, 0.1, 0.001, 0.03), morph: { b: 0.02 } },
    { id: 27, group: 'Explore (fly)', name: 'Kaliset', infinite: true, dist: 0.5, bound: 1.0, fudge: 0.8, iter: 7, maxIter: 20, far: 10,
      start: { pos: [0.3, 0.2, -1.2], yaw: 0.2, pitch: 0.1 },
      a: P('Scale', 1.2, 2.4, 0.01, 1.7), b: P('Offset', 0.3, 1.5, 0.01, 0.8), morph: { b: 0.05 } },
    { id: 28, group: 'Explore (fly)', name: 'Apollonian space', infinite: true, dist: 0.8, bound: 1.0, fudge: 1.0, iter: 8, maxIter: 14, far: 12,
      start: { pos: [2.8, 0.4, 2.0], yaw: -2.2, pitch: -0.05 },
      a: P('Inversion', 1.0, 1.5, 0.005, 1.15), morph: { a: 0.04 } },
  ];

  // Cyclic gradients (sRGB stops, the last one blends back into the first)
  const PALETTES = [
    { name: 'Jewel',      stops: ['#9b5de5', '#f15bb5', '#fee440', '#00bbf9', '#00f5d4'] },
    { name: 'Aurora',     stops: ['#0b3d91', '#00c2ff', '#00f5a0', '#d4ff3d', '#ff3dbb', '#7b2ff7'] },
    { name: 'Synthwave',  stops: ['#2b1055', '#d300c5', '#ff2a6d', '#ff7b00', '#ffd319', '#7597de'] },
    { name: 'Tropical',   stops: ['#ff4e50', '#fc913a', '#f9d62e', '#4ade80', '#00c9a7', '#0081cf', '#845ec2'] },
    { name: 'Iridescent', stops: ['#e0218a', '#3a2bff', '#00b3c6', '#7ed321', '#ff9f1c'] },
    { name: 'Lava',       stops: ['#2a0008', '#8b0000', '#ff3300', '#ff9900', '#ffee55', '#ff5500', '#6a0020'] },
    { name: 'Deep sea',   stops: ['#001b44', '#003f88', '#00a6fb', '#4cc9f0', '#80ffdb', '#3a0ca3'] },
    { name: 'Fire & ice', stops: ['#ff006e', '#fb5607', '#ffbe0b', '#3a86ff', '#8338ec'] },
  ];

  // Lens rings: real-world focal lengths (mm) and full f-stops (plus halves)
  const FOCALS = [14, 18, 24, 28, 35, 50, 70, 85, 105, 135, 200];
  const FSTOPS = [1.0, 1.2, 1.4, 1.8, 2.0, 2.8, 4.0, 5.6, 8.0, 11, 16, 22];
  const SENSOR = 36;          // full-frame sensor, long side (mm)
  const SUBJECT_MM = 600;     // the orbit distance maps to 60 cm in front of the lens
  const MIN_DIST = 1e-3;

  // Quality: render-scale cap (× device pixels), pixel budget (megapixels),
  // raymarch steps, shadows, DOF samples
  const QUALITY = [
    { scale: 0.5, mp: 0.8, steps: 110, shadows: 0, dof: 110 },
    { scale: 0.75, mp: 2.6, steps: 160, shadows: 1, dof: 180 },
    { scale: 1.0, mp: 4.5, steps: 220, shadows: 1, dof: 260 },
    { scale: 1.0, mp: 9.0, steps: 320, shadows: 1, dof: 400 },
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $('view');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    fractal: 0,
    a: 8, b: 0, iter: 8,
    palette: 0, hue: 0, spread: 1.2, emissive: 0.6, cycle: true,
    rotate: true, morph: false,
    focal: 4, aperture: 5, af: true, boost: 2, orbs: 0.6, nebula: 1, fringe: 0.006,
    glow: 1, bloom: 0.35, threshold: 1.2, exposure: 0.95, quality: 1,
  };

  // Camera: orbit around `target`. *T are the goals, the others follow smoothly.
  const cam = {
    target: [0, 0, 0], targetT: [0, 0, 0],
    yaw: 0.6, yawT: 0.6, pitch: 0.3, pitchT: 0.3, dist: 3, distT: 3,
    focus: 1, focusT: 1,  // focus distance relative to cam.dist
    pos: [0, 0, 0], fwd: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0],
    tanHalf: 0.3,
    // Fly mode (infinite fractals): free position, yaw/pitch is the view direction
    // and dist becomes the scene scale (smoothed depth at the frame center).
    mode: 'orbit', fpos: [0, 0, 0], fposT: [0, 0, 0],
  };
  const flyKeys = new Set();

  let hueTime = 0;      // accumulated color cycling
  let morphTime = 0;    // accumulated morph time (julia seeds, oscillations)
  let orbTime = 0;      // slow drift of the background lights
  let dirty = true;
  let saveRequested = false;

  // ---------------------------------------------------------------------------
  // WebGL setup
  // ---------------------------------------------------------------------------
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: false });
  if (!gl || !(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) {
    fail('This page needs WebGL2 with floating-point render targets.');
    return;
  }

  function fail(msg) {
    const e = $('error');
    e.textContent = msg;
    e.hidden = false;
  }

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(log, src);
      throw new Error(log);
    }
    return s;
  }

  // Program with an automatic uniform table: set(values) picks the right setter
  function makeProgram(fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, SHADERS.VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name] = { loc: gl.getUniformLocation(p, info.name), type: info.type };
    }
    return { p, u };
  }

  function use(prog, values) {
    gl.useProgram(prog.p);
    for (const k in values) {
      const e = prog.u[k];
      if (!e) continue;
      const v = values[k];
      switch (e.type) {
        case gl.FLOAT: gl.uniform1f(e.loc, v); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(e.loc, v); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(e.loc, v); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(e.loc, v); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(e.loc, false, v); break;
        default: gl.uniform1i(e.loc, v);  // int, bool, samplers
      }
    }
  }

  function makeTarget(w, h, filter) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Float framebuffer not supported');
    }
    return { tex, fbo, w, h };
  }

  function freeTarget(t) {
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  }

  let progs;
  const scenePrograms = [];
  try {
    progs = {
      dof: makeProgram(SHADERS.DOF),
      cocTile: makeProgram(SHADERS.COC_TILE),
      cocDilate: makeProgram(SHADERS.COC_DILATE),
      down: makeProgram(SHADERS.DOWN),
      up: makeProgram(SHADERS.UP),
      composite: makeProgram(SHADERS.COMPOSITE),
    };
  } catch (err) {
    fail('Shader error: ' + err.message);
    return;
  }

  // Scene shaders are compiled lazily, one per fractal type (FRACTAL id)
  function sceneProgram(id) {
    if (!scenePrograms[id]) scenePrograms[id] = makeProgram(SHADERS.scene(id));
    return scenePrograms[id];
  }

  gl.bindVertexArray(gl.createVertexArray());

  // Render targets
  let W = 0, H = 0;
  let targets = null;
  const readBuf = new Float32Array(4);

  function ensureTargets(w, h) {
    if (targets && w === W && h === H) return;
    if (targets) {
      freeTarget(targets.scene);
      freeTarget(targets.dof);
      freeTarget(targets.tiles);
      freeTarget(targets.tilesMax);
      targets.bloom.forEach(freeTarget);
    }
    W = w; H = h;
    canvas.width = w;
    canvas.height = h;
    const bloom = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < 6 && bw >= 2 && bh >= 2; i++) {
      bloom.push(makeTarget(bw, bh, gl.LINEAR));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    targets = {
      scene: makeTarget(w, h, gl.LINEAR),
      dof: makeTarget(w, h, gl.LINEAR),
      tiles: makeTarget(Math.ceil(w / 16), Math.ceil(h / 16), gl.NEAREST),
      tilesMax: makeTarget(Math.ceil(w / 16), Math.ceil(h / 16), gl.NEAREST),
      bloom,
    };
  }

  // Palette: 256×1 sRGB texture (hardware converts to linear when sampling)
  const paletteTex = gl.createTexture();
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  function uploadPalette(stops) {
    const n = 256, data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = i / n * stops.length;
      const k = Math.floor(x), f = x - k;
      const a = hexRgb(stops[k % stops.length]), b = hexRgb(stops[(k + 1) % stops.length]);
      const e = f * f * (3 - 2 * f);  // smooth blend between stops
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(a[c] + (b[c] - a[c]) * e);
      data[i * 4 + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function setPalette(i) {
    state.palette = i;
    const stops = PALETTES[i].stops;
    uploadPalette(stops);
    $('palette').value = i;
    const grad = `linear-gradient(90deg, ${[...stops, stops[0]].join(', ')})`;
    $('palSwatch').style.background = grad;
    document.documentElement.style.setProperty('--pal-grad', grad);
    dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Math helpers
  // ---------------------------------------------------------------------------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.sqrt(dot(a, a));
  const norm = (a) => scale(a, 1 / len(a));
  const lerp = (a, b, k) => a + (b - a) * k;

  // Rotation matrix (column-major mat3) around a fixed tilted axis
  function rotation(angle) {
    const [x, y, z] = norm([0.35, 1, 0.55]);
    const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return new Float32Array([
      t * x * x + c, t * x * y + s * z, t * x * z - s * y,
      t * x * y - s * z, t * y * y + c, t * y * z + s * x,
      t * x * z + s * y, t * y * z - s * x, t * z * z + c,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  function updateCameraBasis() {
    const cp = Math.cos(cam.pitch);
    const off = [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
    if (cam.mode === 'fly') {
      cam.pos = cam.fpos.slice();
      cam.fwd = off;
      cam.target = add(cam.pos, scale(off, cam.dist));
    } else {
      cam.pos = add(cam.target, scale(off, cam.dist));
      cam.fwd = scale(off, -1);
    }
    cam.right = norm(cross(cam.fwd, [0, 1, 0]));
    cam.up = cross(cam.right, cam.fwd);
    // The long side of the frame spans the 36 mm sensor
    const tanLong = (SENSOR / 2) / FOCALS[state.focal];
    const aw = canvas.clientWidth || 1, ah = canvas.clientHeight || 1;
    cam.tanHalf = aw >= ah ? tanLong * ah / aw : tanLong;
  }

  function resetView() {
    const f = FRACTALS[state.fractal];
    const mode = f.infinite ? 'fly' : 'orbit';
    const snap = mode !== cam.mode;
    cam.mode = mode;
    flyKeys.clear();
    if (mode === 'fly') {
      cam.fpos = f.start.pos.slice();
      cam.fposT = f.start.pos.slice();
      cam.yaw = cam.yawT = f.start.yaw;
      cam.pitch = cam.pitchT = f.start.pitch;
      cam.dist = cam.distT = f.dist;
      cam.focus = cam.focusT = 1;
      dirty = true;
      return;
    }
    if (snap) cam.target = [0, 0, 0];
    cam.targetT = [0, 0, 0];
    cam.yawT = cam.yaw + wrapAngle(0.6 - cam.yaw);
    cam.pitchT = 0.3;
    // Frame the fractal (radius f.dist) for the current focal length and aspect
    updateCameraBasis();
    const tanMin = Math.min(cam.tanHalf, cam.tanHalf * canvas.clientWidth / Math.max(1, canvas.clientHeight));
    cam.distT = f.dist * 1.25 / tanMin;
    cam.focusT = 1;
    if (snap) {
      cam.yaw = cam.yawT;
      cam.pitch = cam.pitchT;
      cam.dist = cam.distT;
      cam.focus = 1;
    }
    dirty = true;
  }

  function wrapAngle(a) {
    return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
  }

  // Lens model. Distances in "physical" millimetres: z (relative to the orbit
  // distance) * SUBJECT_MM. Returns the circle of confusion, in pixels, of a
  // point at infinity; a point at relative depth z has CoC = cocInf·|1 − focus/z|.
  function lens() {
    const f = FOCALS[state.focal];
    const N = FSTOPS[state.aperture];
    const s1 = Math.max(cam.focus * SUBJECT_MM, f * 1.2);
    const cocMm = (f / N) * f / (s1 - f);
    const longPx = Math.max(W, H);
    const q = QUALITY[state.quality];
    const maxCoc = Math.max(4, Math.min(longPx * 0.022, 56));
    return {
      cocInf: cocMm / SENSOR * longPx,
      maxCoc,
      radScale: Math.max(0.5, maxCoc * maxCoc / (2 * q.dof)),
    };
  }

  // ---------------------------------------------------------------------------
  // Per-frame parameter values (with morphing)
  // ---------------------------------------------------------------------------
  function fractalParams() {
    const f = FRACTALS[state.fractal];
    const t = morphTime;
    let a = state.a, b = state.b;
    if (f.morph.a) a += f.morph.a * Math.sin(t * 0.37);
    if (f.morph.b) b += f.morph.b * Math.sin(t * 0.29);
    let julia = [0, 0, 0, 0];
    if (f.julia === 'bulb') {
      julia = [0.75 * Math.sin(0.23 * t + 0.5), 0.6 * Math.cos(0.19 * t + 1.7), 0.75 * Math.sin(0.29 * t + 2.6), 0];
    } else if (f.julia === 'quat') {
      const s = t * 0.18;
      julia = [-0.291 + 0.12 * Math.sin(1.2 * s), -0.399 + 0.12 * Math.sin(1.7 * s + 1),
               0.339 + 0.12 * Math.sin(1.3 * s + 2), 0.437 + 0.12 * Math.sin(2.5 * s + 3)];
    }
    else if (f.julia === 'bicomplex') {
      const s = t * 0.2;
      julia = [-0.8 + 0.08 * Math.sin(s), 0.156 + 0.08 * Math.sin(1.3 * s + 1),
               -0.4 + 0.08 * Math.sin(0.7 * s + 2), 0.6 + 0.08 * Math.sin(1.1 * s + 3)];
    }
    const twist = f.twist === 'a' ? a : f.twist === 'b' ? b : 0;
    return { a, b, julia, rot: rotation(twist) };
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function drawTo(target) {
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function bindTex(unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  function render() {
    const f = FRACTALS[state.fractal];
    const q = QUALITY[state.quality];
    const fp = fractalParams();
    const L = lens();
    const lensU = {
      uFocusRel: cam.focus, uCocInf: L.cocInf, uMaxCoc: L.maxCoc,
    };

    // 1. Raymarched scene: HDR color + relative depth in alpha
    bindTex(2, paletteTex);
    let prog;
    try {
      prog = sceneProgram(f.id);
    } catch (err) {
      fail('Shader error: ' + err.message);
      throw err;
    }
    use(prog, Object.assign({
      uRes: [W, H], uCamPos: cam.pos, uCamRight: cam.right, uCamUp: cam.up, uCamFwd: cam.fwd,
      uTarget: cam.target, uTanHalf: cam.tanHalf, uCamDist: cam.dist, uTime: orbTime,
      uParamA: fp.a, uParamB: fp.b, uBound: f.bound, uFudge: f.fudge,
      uIter: state.iter, uMaxSteps: q.steps, uShadows: q.shadows,
      uInfinite: f.infinite ? 1 : 0, uFar: f.far || 10,
      uJulia: fp.julia, uRot: fp.rot,
      uPal: 2,
      uHue: state.hue + hueTime, uSpread: state.spread, uGlow: state.glow, uEmissive: state.emissive,
      uOrbs: f.infinite ? 0 : state.orbs, uNebula: state.nebula,
    }, lensU));
    drawTo(targets.scene);

    // 2. Depth of field with bokeh. First the largest CoC per 16×16 tile,
    // spread to the tiles it can reach, so the gather knows where to stop.
    bindTex(0, targets.scene.tex);
    use(progs.cocTile, Object.assign({ uScene: 0 }, lensU));
    drawTo(targets.tiles);
    bindTex(0, targets.tiles.tex);
    use(progs.cocDilate, { uTiles: 0, uR: Math.min(4, Math.ceil(L.maxCoc / 16)) });
    drawTo(targets.tilesMax);
    bindTex(0, targets.scene.tex);
    bindTex(1, targets.tilesMax.tex);
    use(progs.dof, Object.assign({
      uScene: 0, uTile: 1, uTexel: [1 / W, 1 / H], uRadScale: L.radScale, uBoost: state.boost,
    }, lensU));
    drawTo(targets.dof);

    // 3. Bloom: thresholded downsample chain, then additive tent upsample
    const bl = targets.bloom;
    let src = targets.dof;
    for (let i = 0; i < bl.length; i++) {
      bindTex(0, src.tex);
      use(progs.down, { uSrc: 0, uTexel: [1 / src.w, 1 / src.h], uThreshold: state.threshold, uPrefilter: i === 0 ? 1 : 0 });
      drawTo(bl[i]);
      src = bl[i];
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = bl.length - 1; i > 0; i--) {
      bindTex(0, bl[i].tex);
      use(progs.up, { uSrc: 0, uTexel: [1 / bl[i].w, 1 / bl[i].h] });
      drawTo(bl[i - 1]);
    }
    gl.disable(gl.BLEND);

    // 4. Composite to screen
    bindTex(0, targets.dof.tex);
    bindTex(1, bl.length ? bl[0].tex : targets.dof.tex);
    use(progs.composite, {
      uImg: 0, uBloom: 1, uRes: [W, H], uBloomInt: bl.length ? state.bloom : 0,
      uExposure: state.exposure, uFringe: state.fringe, uTime: (performance.now() % 1000) / 10,
    });
    drawTo(null);
  }

  // Relative depth at a pixel of the last rendered scene (bottom-left origin)
  function readDepth(x, y) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene.fbo);
    gl.readPixels(Math.round(x), Math.round(y), 1, 1, gl.RGBA, gl.FLOAT, readBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return readBuf[3];
  }

  // World-space point under a client position, or null for the background
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const px = (clientX - r.left) / r.width * W;
    const py = (1 - (clientY - r.top) / r.height) * H;
    const z = readDepth(px, py);
    if (!(z > 0 && z < 500)) return null;
    const qx = (2 * px - W) / H, qy = (2 * py - H) / H;
    const rd = norm(add(cam.fwd, scale(add(scale(cam.right, qx), scale(cam.up, qy)), cam.tanHalf)));
    const t = z * cam.dist / dot(rd, cam.fwd);
    return { z, point: add(cam.pos, scale(rd, t)) };
  }

  // Autofocus: the nearest surface among a few points around the frame center
  function autofocus() {
    let best = Infinity;
    const pts = [[0, 0], [0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]];
    for (const [dx, dy] of pts) {
      const z = readDepth(W * (0.5 + dx * H / W), H * (0.5 + dy));
      if (z > 0 && z < 500 && z < best) best = z;
    }
    if (best < Infinity) cam.focusT = best;
  }

  // ---------------------------------------------------------------------------
  // Resolution: the render scale adapts to the frame time
  // ---------------------------------------------------------------------------
  let dynScale = 0.6;
  let frameEma = 16;
  let lastEval = 0;
  let refined = false;

  function scaleCap() {
    const q = QUALITY[state.quality];
    const css = Math.max(1, canvas.clientWidth * canvas.clientHeight);
    const budget = Math.sqrt(q.mp * 1e6 / css);  // keeps W×H within the quality's pixel budget
    return Math.min(Math.min(window.devicePixelRatio || 1, 2) * q.scale, budget);
  }

  function sizeFor(s) {
    const w = Math.max(64, Math.round(canvas.clientWidth * s));
    const h = Math.max(64, Math.round(canvas.clientHeight * s));
    return [w, h];
  }

  function adapt(now) {
    if (now - lastEval < 600) return;
    lastEval = now;
    const cap = scaleCap();
    let s = dynScale;
    if (frameEma > 30) s *= 0.9;         // below ~33 fps: lower the resolution
    else if (frameEma < 20) s *= 1.06;   // at (or near) the display rate: raise it
    s = Math.min(cap, Math.max(0.25, Math.round(s * 20) / 20));
    dynScale = s;
  }

  // ---------------------------------------------------------------------------
  // Fly camera (infinite fractals)
  // ---------------------------------------------------------------------------

  // Keyboard movement plus the slow "cruise" of the rotate option. Speed is
  // proportional to the depth at the frame center, so flying toward a wall
  // slows down instead of crashing through it. Returns true while moving.
  function flyStep(dt) {
    const has = (...k) => k.some((x) => flyKeys.has(x));
    let fx = 0, fy = 0, fz = 0;
    if (has('w', 'arrowup')) fz += 1;
    if (has('s', 'arrowdown')) fz -= 1;
    if (has('d', 'arrowright')) fx += 1;
    if (has('a', 'arrowleft')) fx -= 1;
    if (has('e', ' ')) fy += 1;
    if (has('q')) fy -= 1;
    let cruise = false;
    if (state.rotate && !dragging) {
      fz += 0.25;
      cam.yawT += dt * 0.03;
      cruise = true;
    }
    if (!fx && !fy && !fz) return cruise;
    const v = add(add(scale(cam.fwd, fz), scale(cam.right, fx)), scale(cam.up, fy));
    const speed = cam.dist * 0.9 * (flyKeys.has('shift') ? 3 : 1);
    cam.fposT = add(cam.fposT, scale(v, speed * dt));
    return true;
  }

  // Scene scale for the fly camera: the depth at the frame center
  function measureScale() {
    const f = FRACTALS[state.fractal];
    const z = readDepth(W / 2, H / 2);
    const world = z > 0 && z < 500 ? z * cam.dist : f.far * 0.3;
    cam.distT = Math.max(1e-4, Math.min(f.far * 0.4, world));
  }

  function flyForward(amount) {
    cam.fposT = add(cam.fposT, scale(cam.fwd, amount * cam.dist));
    dirty = true;
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let lastNow = performance.now();
  let frameCount = 0;
  let fpsFrames = 0, fpsTime = 0, fps = 0;
  let wasRendering = false;
  let dragging = false;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;

    // Animation clocks
    let animating = false;
    if (cam.mode === 'fly') {
      if (flyStep(dt)) animating = true;
    } else if (state.rotate && !dragging) {
      cam.yawT += dt * 0.12;
      animating = true;
    }
    if (state.cycle) { hueTime = (hueTime + dt * 0.025) % 1000; animating = true; }
    if (state.morph) { morphTime += dt; animating = true; }
    if (state.cycle || state.rotate) orbTime += dt;

    // Smooth camera
    const k = 1 - Math.exp(-dt * 10);
    const before = [cam.yaw, cam.pitch, cam.dist, cam.focus, ...cam.target, ...cam.fpos];
    cam.yaw = lerp(cam.yaw, cam.yawT, k);
    cam.pitch = lerp(cam.pitch, cam.pitchT, k);
    cam.dist = Math.exp(lerp(Math.log(cam.dist), Math.log(cam.distT), k));
    if (cam.mode === 'orbit') cam.target = cam.target.map((v, i) => lerp(v, cam.targetT[i], k));
    else cam.fpos = cam.fpos.map((v, i) => lerp(v, cam.fposT[i], k));
    const kf = 1 - Math.exp(-dt * 6);  // focus pulls a bit slower
    cam.focus = Math.exp(lerp(Math.log(cam.focus), Math.log(cam.focusT), kf));
    const after = [cam.yaw, cam.pitch, cam.dist, cam.focus, ...cam.target, ...cam.fpos];
    const moving = after.some((v, i) => Math.abs(v - before[i]) > 1e-6 * (1 + Math.abs(v)));

    const active = animating || moving || dirty || state.af && frameCount % 6 === 0 && wasRendering;
    let s;
    if (active || saveRequested) {
      if (wasRendering) {
        frameEma = lerp(frameEma, dt * 1000, 0.15);
        adapt(now);
      }
      s = saveRequested ? scaleCap() : dynScale;
      refined = false;
    } else if (!refined) {
      s = scaleCap();  // idle: one sharp frame at full quality
      refined = true;
    } else {
      wasRendering = false;
      return;
    }

    const [w, h] = sizeFor(s);
    try {
      ensureTargets(w, h);
    } catch (err) {
      fail(err.message);
      throw err;
    }
    updateCameraBasis();
    render();
    dirty = false;
    wasRendering = active;
    frameCount++;

    if (frameCount % 6 === 0) {
      if (cam.mode === 'fly') measureScale();
      if (state.af) autofocus();
    }

    if (saveRequested) {
      saveRequested = false;
      const name = FRACTALS[state.fractal].name.toLowerCase().replace(/[^a-z]+/g, '-');
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mandelbulben-${name}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    }

    // HUD
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime > 0.5) {
      fps = Math.round(fpsFrames / fpsTime);
      fpsFrames = 0;
      fpsTime = 0;
    }
    updateHud();
  }

  function formatDistance(rel) {
    const mm = rel * SUBJECT_MM;
    return mm >= 1000 ? (mm / 1000).toFixed(2) + ' m' : (mm / 10).toFixed(mm < 100 ? 1 : 0) + ' cm';
  }

  function updateHud() {
    $('lens').textContent = `${FOCALS[state.focal]} mm  f/${FSTOPS[state.aperture]}  ◎ ${formatDistance(cam.focus)}${state.af ? ' AF' : ' MF'}`;
    $('perf').textContent = `${cam.mode === 'fly' ? 'FLY · ' : ''}${fps} fps · ${W}×${H}`;
    if (state.af) {
      $('focus').value = Math.log(cam.focus).toFixed(2);
      $('outFocus').textContent = formatDistance(cam.focus);
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function bindRange(id, outId, key, fmt, onChange) {
    const el = $(id);
    el.value = state[key];
    const show = () => { $(outId).textContent = fmt(state[key]); };
    el.addEventListener('input', () => {
      state[key] = parseFloat(el.value);
      show();
      if (onChange) onChange();
      dirty = true;
    });
    show();
    return { el, show };
  }

  function bindCheck(id, key) {
    const el = $(id);
    el.checked = state[key];
    el.addEventListener('change', () => { state[key] = el.checked; dirty = true; });
  }

  const fix = (n) => (v) => Number(v).toFixed(n);

  function setupParam(which) {
    const f = FRACTALS[state.fractal];
    const p = f[which];
    const row = $(which === 'a' ? 'rowA' : 'rowB');
    row.hidden = !p;
    if (!p) return;
    const el = $(which === 'a' ? 'paramA' : 'paramB');
    $(which === 'a' ? 'labelA' : 'labelB').textContent = p.label;
    el.min = p.min;
    el.max = p.max;
    el.step = p.step;
    el.value = state[which];
    $(which === 'a' ? 'outA' : 'outB').textContent = state[which].toFixed(p.step < 0.01 ? 3 : 2);
  }

  function selectFractal(i) {
    state.fractal = i;
    const f = FRACTALS[i];
    state.a = f.a ? f.a.value : 0;
    state.b = f.b ? f.b.value : 0;
    state.iter = f.iter;
    $('fractal').value = i;
    setupParam('a');
    setupParam('b');
    const it = $('iter');
    it.max = f.maxIter;
    it.value = state.iter;
    $('outIter').textContent = state.iter;
    resetView();
  }

  function setFocal(i) {
    state.focal = Math.max(0, Math.min(FOCALS.length - 1, i));
    $('focal').value = state.focal;
    $('outFocal').textContent = FOCALS[state.focal] + ' mm';
    dirty = true;
  }

  function setAperture(i) {
    state.aperture = Math.max(0, Math.min(FSTOPS.length - 1, i));
    $('aperture').value = state.aperture;
    $('outAperture').textContent = 'f/' + FSTOPS[state.aperture];
    dirty = true;
  }

  function setAf(on) {
    state.af = on;
    $('af').checked = on;
    $('focus').disabled = on;
    dirty = true;
  }

  function initUi() {
    const fsel = $('fractal');
    const groups = new Map();
    FRACTALS.forEach((f, i) => {
      if (!groups.has(f.group)) {
        const g = document.createElement('optgroup');
        g.label = f.group;
        fsel.appendChild(g);
        groups.set(f.group, g);
      }
      groups.get(f.group).appendChild(new Option(i < 9 ? `${i + 1}. ${f.name}` : f.name, i));
    });
    fsel.addEventListener('change', () => selectFractal(+fsel.value));

    for (const which of ['a', 'b']) {
      const el = $(which === 'a' ? 'paramA' : 'paramB');
      el.addEventListener('input', () => {
        state[which] = parseFloat(el.value);
        const p = FRACTALS[state.fractal][which];
        $(which === 'a' ? 'outA' : 'outB').textContent = state[which].toFixed(p.step < 0.01 ? 3 : 2);
        dirty = true;
      });
    }
    $('iter').addEventListener('input', () => {
      state.iter = +$('iter').value;
      $('outIter').textContent = state.iter;
      dirty = true;
    });
    bindCheck('rotate', 'rotate');
    bindCheck('morph', 'morph');

    const psel = $('palette');
    PALETTES.forEach((p, i) => psel.add(new Option(p.name, i)));
    psel.addEventListener('change', () => setPalette(+psel.value));
    setPalette(state.palette);
    bindRange('hue', 'outHue', 'hue', fix(2));
    bindRange('spread', 'outSpread', 'spread', fix(2));
    bindRange('emissive', 'outEmissive', 'emissive', fix(2));
    bindCheck('cycle', 'cycle');

    $('focal').max = FOCALS.length - 1;
    $('focal').addEventListener('input', () => setFocal(+$('focal').value));
    $('aperture').max = FSTOPS.length - 1;
    $('aperture').addEventListener('input', () => setAperture(+$('aperture').value));
    setFocal(state.focal);
    setAperture(state.aperture);

    $('focus').addEventListener('input', () => {
      cam.focusT = Math.exp(parseFloat($('focus').value));
      $('outFocus').textContent = formatDistance(cam.focusT);
      dirty = true;
    });
    $('af').addEventListener('change', () => setAf($('af').checked));
    setAf(state.af);

    bindRange('boost', 'outBoost', 'boost', fix(1));
    bindRange('orbs', 'outOrbs', 'orbs', fix(2));
    bindRange('nebula', 'outNebula', 'nebula', fix(2));
    bindRange('fringe', 'outFringe', 'fringe', fix(3));
    bindRange('glow', 'outGlow', 'glow', fix(2));
    bindRange('bloom', 'outBloom', 'bloom', fix(2));
    bindRange('threshold', 'outThreshold', 'threshold', fix(2));
    bindRange('exposure', 'outExposure', 'exposure', fix(2));

    $('quality').addEventListener('change', () => {
      state.quality = +$('quality').value;
      dynScale = Math.min(dynScale, scaleCap());
      dirty = true;
    });

    $('reset').addEventListener('click', resetView);
    $('save').addEventListener('click', () => { saveRequested = true; });
    $('toggle').addEventListener('click', () => $('panel').classList.toggle('hidden'));

    if (window.innerWidth < 600) $('panel').classList.add('hidden');  // phones: start with a clear view

    selectFractal(0);
    cam.yaw = cam.yawT;
    cam.pitch = cam.pitchT;
    cam.dist = cam.distT;
  }

  // ---------------------------------------------------------------------------
  // Input: drag to rotate, wheel / pinch to zoom, click to focus, dbl-click to orbit
  // ---------------------------------------------------------------------------
  const pointers = new Map();
  let downPos = null;
  let pinchDist = 0;

  function zoomBy(factor) {
    if (cam.mode === 'fly') { flyForward(-Math.log(factor) * 1.5); return; }
    const f = FRACTALS[state.fractal];
    let d = Math.min(f.dist * 40, Math.max(MIN_DIST, cam.distT * factor));
    // Zooming in heads for the orbit center, which lies inside the fractal:
    // stop just before the surface seen at the frame center (dbl-click goes further)
    if (factor < 1 && targets) {
      const z = readDepth(W / 2, H / 2);
      if (z > 0 && z < 500) {
        const floor = cam.dist - 0.9 * z * cam.dist;
        if (d < floor) d = Math.max(MIN_DIST, Math.min(cam.distT, floor));
      }
    }
    cam.distT = d;
    dirty = true;
  }

  function showFocusRing(x, y) {
    const ring = $('focusRing');
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    ring.classList.add('show');
    clearTimeout(showFocusRing.timer);
    showFocusRing.timer = setTimeout(() => ring.classList.remove('show'), 700);
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downPos = { x: e.clientX, y: e.clientY, moved: false };
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (downPos) downPos.moved = true;
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchDist > 0 && d > 0) zoomBy(pinchDist / d);
      pinchDist = d;
      return;
    }
    if (downPos && !downPos.moved && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) {
      downPos.moved = true;
    }
    if (downPos && downPos.moved) {
      dragging = true;
      canvas.classList.add('dragging');
      if (cam.mode === 'fly') {
        // Look around, "grabbing" the scene
        cam.yawT += dx * 0.004;
        cam.pitchT = Math.max(-1.5, Math.min(1.5, cam.pitchT + dy * 0.004));
      } else {
        cam.yawT -= dx * 0.006;
        cam.pitchT = Math.max(-1.5, Math.min(1.5, cam.pitchT + dy * 0.006));
      }
      dirty = true;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (downPos && !downPos.moved && e.type === 'pointerup') {
        // Tap-to-focus
        const hit = pick(e.clientX, e.clientY);
        if (hit) {
          setAf(false);
          cam.focusT = hit.z;
          $('focus').value = Math.log(hit.z).toFixed(2);
          $('outFocus').textContent = formatDistance(hit.z);
          showFocusRing(e.clientX, e.clientY);
        }
      }
      downPos = null;
      dragging = false;
      canvas.classList.remove('dragging');
    }
    if (pointers.size < 2) pinchDist = 0;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('dblclick', (e) => {
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    if (cam.mode === 'fly') {
      // Fly most of the way toward the picked point
      cam.fposT = add(cam.pos, scale(sub(hit.point, cam.pos), 0.6));
      dirty = true;
      return;
    }
    // Orbit around the picked point, keeping the camera where it is, then move closer
    const v = sub(cam.pos, hit.point);
    const d = len(v);
    cam.targetT = hit.point;
    cam.yawT = cam.yaw + wrapAngle(Math.atan2(v[0], v[2]) - cam.yaw);
    cam.pitchT = Math.asin(Math.max(-1, Math.min(1, v[1] / d)));
    cam.distT = Math.max(MIN_DIST, d * 0.6);
    cam.focusT = 1;
    dirty = true;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomBy(Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0012));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox')) return;
    const key = e.key.toLowerCase();
    if (cam.mode === 'fly' && FLY_KEYS.has(key)) {
      flyKeys.add(key);
      dirty = true;
      e.preventDefault();
      return;
    }
    const toggle = (id, k) => { state[k] = !state[k]; $(id).checked = state[k]; dirty = true; };
    if (key >= '1' && key <= '9') selectFractal(+key - 1);
    else if (key === '.') selectFractal((state.fractal + 1) % FRACTALS.length);
    else if (key === ',') selectFractal((state.fractal + FRACTALS.length - 1) % FRACTALS.length);
    else if (key === 'h') $('panel').classList.toggle('hidden');
    else if (key === 'r') resetView();
    else if (key === 'f') setAf(!state.af);
    else if (key === 'a') toggle('rotate', 'rotate');
    else if (key === 'o') toggle('morph', 'morph');
    else if (key === 'm') setMusic(!$('music').checked);
    else if (key === 'c') toggle('cycle', 'cycle');
    else if (key === 's') saveRequested = true;
    else if (key === '[') setAperture(state.aperture - 1);
    else if (key === ']') setAperture(state.aperture + 1);
    else if (key === '-') setFocal(state.focal - 1);
    else if (key === '+' || key === '=') setFocal(state.focal + 1);
    else return;
    e.preventDefault();
  });

  const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  window.addEventListener('keyup', (e) => flyKeys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => flyKeys.clear());

  // ---------------------------------------------------------------------------
  // Background music
  // ---------------------------------------------------------------------------

  // Browsers block audio until the user interacts with the page, so playback
  // starts on the first click, wheel or key press when music is enabled.
  // On/off and volume are remembered per browser.
  const bgm = $('bgm');

  function loadPref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable: ignore */ }
  }

  function playMusic() {
    if (!$('music').checked || !bgm.paused) return;
    const p = bgm.play();
    if (p) p.catch(() => { /* still blocked: retry on the next interaction */ });
  }

  function setMusic(on) {
    if ($('music').disabled) return;
    $('music').checked = on;
    $('volume').disabled = !on;
    savePref('day13.music', on ? '1' : '0');
    if (on) playMusic(); else bgm.pause();
  }

  function initMusic() {
    const vol = parseFloat(loadPref('day13.volume', '0.5'));
    bgm.volume = isFinite(vol) ? Math.max(0, Math.min(1, vol)) : 0.5;
    $('volume').value = bgm.volume;
    $('music').checked = loadPref('day13.music', '1') === '1';
    $('volume').disabled = !$('music').checked;

    $('music').addEventListener('change', (e) => setMusic(e.target.checked));
    $('volume').addEventListener('input', (e) => { bgm.volume = +e.target.value; });
    $('volume').addEventListener('change', (e) => savePref('day13.volume', e.target.value));
    bgm.addEventListener('error', () => {
      $('music').checked = false;
      $('music').disabled = $('volume').disabled = true;
      $('music').parentElement.title = 'Music file not found';
    });

    const kick = () => {
      playMusic();
      if (!bgm.paused || !$('music').checked) {
        for (const ev of ['pointerdown', 'wheel', 'keydown']) window.removeEventListener(ev, kick, true);
      }
    };
    for (const ev of ['pointerdown', 'wheel', 'keydown']) window.addEventListener(ev, kick, true);
  }

  window.addEventListener('resize', () => { dirty = true; });

  initUi();
  initMusic();
  requestAnimationFrame(frame);
})();
