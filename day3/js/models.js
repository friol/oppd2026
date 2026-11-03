// Glowing green wireframe models (a computer, a mobile phone, a telephone handset,
// sunglasses) that show up far ahead once the flight starts, are traced line by line
// by a bright cursor and drift towards the camera, passing closer and closer to the
// flight path.
const Models = (() => {
  const R_FAR = 7, R_NEAR = 1.3; // distance from the flight path of the first and the latest models
  const CLOSE_TIME = 90;         // seconds to go from R_FAR to R_NEAR
  const BUILD_TIME = 6;          // seconds for the cursor to trace a whole model

  const vertexShader = `
    attribute float aHeight, aDraw;
    uniform float uPointScale;
    varying float vHeight, vDraw;
    varying vec3 vWorld;
    void main() {
      vHeight = aHeight;
      vDraw = aDraw;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vec4 mv = viewMatrix * w;
      gl_Position = projectionMatrix * mv;
      #ifdef POINTS
        gl_PointSize = clamp(uPointScale * 0.04 / -mv.z, 1.0, 10.0);
      #endif
    }
  `;

  const fragmentShader = `
    uniform vec3 uColor;
    uniform float uAlpha, uBuild, uTime, uPulse, uFogNear, uFogFar;
    varying float vHeight, vDraw;
    varying vec3 vWorld;
    void main() {
      // vDraw is the length traced before this point: only what the cursor has already
      // drawn is visible, with a bright trail fading behind it
      if (vDraw > uBuild) discard;
      float edge = exp(-(uBuild - vDraw) * 12.0);
      // A slow scan band sweeps up the model
      float scan = exp(-pow((fract(uTime * 0.2) * 1.4 - 0.2 - vHeight) * 10.0, 2.0));
      vec3 color = uColor * (0.55 + 0.9 * scan) * uPulse + vec3(0.7, 1.0, 0.8) * edge;
      #ifdef POINTS
        float r = length(gl_PointCoord - 0.5) * 2.0;
        color *= (1.0 - smoothstep(0.0, 1.0, r)) * 1.5;
      #endif
      float dist = length(vWorld - cameraPosition);
      float fog = (1.0 - smoothstep(uFogNear, uFogFar, dist)) * smoothstep(0.5, 2.5, dist);
      gl_FragColor = vec4(color * fog * uAlpha, 1.0);
    }
  `;

  // The drawing cursor: a single bright, flickering dot at the tip of the line being traced
  const cursorVertex = `
    uniform float uPointScale;
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vec4 mv = viewMatrix * w;
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(uPointScale * 0.12 / -mv.z, 2.0, 32.0);
    }
  `;

  const cursorFragment = `
    uniform float uAlpha, uCursor, uTime, uFogNear, uFogFar;
    varying vec3 vWorld;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float glow = exp(-r * r * 14.0) * 1.6 + exp(-r * r * 3.5) * 0.35;
      glow *= (1.0 - smoothstep(0.8, 1.0, r)) * (0.85 + 0.15 * sin(uTime * 47.0));
      float dist = length(vWorld - cameraPosition);
      float fog = (1.0 - smoothstep(uFogNear, uFogFar, dist)) * smoothstep(0.5, 2.5, dist);
      gl_FragColor = vec4(vec3(0.75, 1.0, 0.82) * glow * fog * uAlpha * uCursor, 1.0);
    }
  `;

  // Collects line segments (pairs of points) for one model
  function builder() {
    const pos = [];
    const seg = (a, b) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    const loop = pts => pts.forEach((p, i) => seg(p, pts[(i + 1) % pts.length]));
    return {
      pos, seg, loop,
      // Feature edges of a three.js geometry
      edges(geom) {
        const a = new THREE.EdgesGeometry(geom, 20).attributes.position.array;
        for (let i = 0; i < a.length; i++) pos.push(a[i]);
      },
      box(w, h, d, x, y, z) {
        this.edges(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
      },
      // Rectangle in an XY plane
      rect(w, h, x, y, z) {
        loop([[x - w / 2, y - h / 2, z], [x + w / 2, y - h / 2, z],
              [x + w / 2, y + h / 2, z], [x - w / 2, y + h / 2, z]]);
      },
      ellipse(rx, ry, x, y, z, n = 20) {
        const pts = [];
        for (let i = 0; i < n; i++) {
          const t = i / n * Math.PI * 2;
          pts.push([x + Math.cos(t) * rx, y + Math.sin(t) * ry, z]);
        }
        loop(pts);
      },
      // Box with rounded corners in XY: front and back outlines joined at the corners
      roundedBox(w, h, d, r, x = 0, y = 0, z = 0) {
        const outline = [];
        const corners = [[w / 2 - r, h / 2 - r], [-w / 2 + r, h / 2 - r], [-w / 2 + r, -h / 2 + r], [w / 2 - r, -h / 2 + r]];
        corners.forEach((c, k) => {
          for (let i = 0; i <= 4; i++) {
            const t = (k + i / 4) * Math.PI / 2;
            outline.push([x + c[0] + Math.cos(t) * r, y + c[1] + Math.sin(t) * r]);
          }
        });
        loop(outline.map(p => [p[0], p[1], z + d / 2]));
        loop(outline.map(p => [p[0], p[1], z - d / 2]));
        outline.forEach((p, i) => { if (i % 5 === 0 || i % 5 === 4) seg([p[0], p[1], z + d / 2], [p[0], p[1], z - d / 2]); });
      }
    };
  }

  function computer() {
    const b = builder();
    // CRT monitor: bezel, screen with a few lines of text, tapered tube, stand
    b.box(1.0, 0.8, 0.12, 0, 0.25, 0);
    b.rect(0.82, 0.62, 0, 0.25, 0.061);
    for (let i = 0; i < 7; i++) {
      const y = 0.5 - i * 0.075, len = 0.15 + Math.random() * 0.5;
      b.seg([-0.37, y, 0.062], [-0.37 + len, y, 0.062]);
    }
    const tube = new THREE.CylinderGeometry(0.35, 0.6, 0.55, 4, 1, true).rotateY(Math.PI / 4).rotateX(-Math.PI / 2);
    b.edges(tube.scale(1.18, 0.94, 1).translate(0, 0.25, -0.335));
    b.box(0.3, 0.1, 0.3, 0, -0.2, -0.2);
    b.box(0.6, 0.03, 0.45, 0, -0.265, -0.2);
    // Keyboard with a grid of keys
    b.box(1.1, 0.05, 0.38, 0, -0.255, 0.42);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 13; c++) {
        const x = -0.48 + c * 0.08, z = 0.3 + r * 0.08;
        b.loop([[x - 0.03, -0.229, z - 0.03], [x + 0.03, -0.229, z - 0.03], [x + 0.03, -0.229, z + 0.03], [x - 0.03, -0.229, z + 0.03]]);
      }
    }
    // Tower case with drive bays and a power button
    b.box(0.32, 0.85, 0.8, 0.85, 0.14, -0.15);
    b.rect(0.24, 0.05, 0.85, 0.45, 0.251);
    b.rect(0.24, 0.05, 0.85, 0.36, 0.251);
    b.ellipse(0.03, 0.03, 0.85, -0.15, 0.251, 10);
    return b.pos;
  }

  function phone() {
    const b = builder();
    b.roundedBox(0.42, 1.1, 0.14, 0.08);
    b.rect(0.3, 0.26, 0, 0.24, 0.071);
    for (let i = 0; i < 3; i++) b.seg([-0.06, 0.47 - i * 0.02, 0.071], [0.06, 0.47 - i * 0.02, 0.071]);
    b.rect(0.3, 0.06, 0, 0.04, 0.071);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) b.rect(0.08, 0.06, -0.1 + c * 0.1, -0.08 - r * 0.1, 0.071);
    }
    b.edges(new THREE.CylinderGeometry(0.03, 0.035, 0.25, 6).translate(0.13, 0.675, 0));
    b.ellipse(0.04, 0.04, 0.13, 0.8, 0, 8);
    return b.pos;
  }

  function handset() {
    const b = builder();
    b.roundedBox(0.22, 1.0, 0.16, 0.08);
    // Ear and mouth cups facing the viewer, with holes
    for (const y of [0.5, -0.5]) {
      b.edges(new THREE.CylinderGeometry(0.2, 0.16, 0.16, 16, 1, true).rotateX(Math.PI / 2).translate(0, y, 0.12));
      b.ellipse(0.2, 0.2, 0, y, 0.2, 20);
      b.ellipse(0.16, 0.16, 0, y, 0.04, 20);
      for (let i = 0; i < 6; i++) {
        const t = i / 6 * Math.PI * 2;
        b.ellipse(0.025, 0.025, Math.cos(t) * 0.09, y + Math.sin(t) * 0.09, 0.2, 6);
      }
    }
    // Coiled cord hanging below
    let prev = null;
    for (let i = 0; i <= 240; i++) {
      const t = i / 240, a = t * Math.PI * 2 * 18;
      const p = [Math.cos(a) * 0.05 + t * t * 0.3, -0.62 - t * 0.9, Math.sin(a) * 0.05];
      if (prev) b.seg(prev, p);
      prev = p;
    }
    return b.pos;
  }

  function sunglasses() {
    const b = builder();
    for (const s of [-1, 1]) {
      const cx = s * 0.24;
      for (const k of [1, 0.85]) {
        const pts = [];
        for (let i = 0; i < 24; i++) {
          const t = i / 24 * Math.PI * 2, sy = Math.sin(t);
          pts.push([cx + Math.cos(t) * 0.2 * k, (sy > 0 ? sy * 0.7 : sy) * 0.14 * k, 0]);
        }
        b.loop(pts);
      }
      // Temple arm going back and bending down
      b.seg([s * 0.44, 0.06, 0], [s * 0.46, 0.06, -0.7]);
      b.seg([s * 0.46, 0.06, -0.7], [s * 0.45, -0.06, -0.82]);
    }
    b.seg([-0.06, 0.07, 0], [0, 0.09, 0]);
    b.seg([0, 0.09, 0], [0.06, 0.07, 0]);
    return b.pos;
  }

  // Centered and scaled to a unit size, with the normalized height of each vertex and
  // the length traced before reaching it (segments are drawn in the order they were built)
  function geometries(pos) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeBoundingBox();
    const box = g.boundingBox, size = new THREE.Vector3(), center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    g.translate(-center.x, -center.y, -center.z);
    const unit = 1 / Math.max(size.x, size.y, size.z);
    g.scale(unit, unit, unit);
    const a = g.attributes.position.array, height = new Float32Array(a.length / 3);
    for (let i = 0; i < height.length; i++) height[i] = (pos[i * 3 + 1] - box.min.y) / size.y;
    g.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
    const n = a.length / 6, cum = new Float32Array(n + 1), draw = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const i = k * 6;
      const len = Math.hypot(a[i + 3] - a[i], a[i + 4] - a[i + 1], a[i + 5] - a[i + 2]);
      draw[k * 2] = cum[k];
      cum[k + 1] = cum[k] + len;
      draw[k * 2 + 1] = cum[k + 1];
    }
    g.setAttribute('aDraw', new THREE.BufferAttribute(draw, 1));

    // Glowing dots on the distinct vertices
    const seen = new Set(), dots = [], dotHeight = [], dotDraw = [];
    for (let i = 0; i < height.length; i++) {
      const key = a[i * 3].toFixed(3) + ',' + a[i * 3 + 1].toFixed(3) + ',' + a[i * 3 + 2].toFixed(3);
      if (seen.has(key)) continue;
      seen.add(key);
      dots.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
      dotHeight.push(height[i]);
      dotDraw.push(draw[i]); // first time the cursor reaches this vertex
    }
    const p = new THREE.BufferGeometry();
    p.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    p.setAttribute('aHeight', new THREE.Float32BufferAttribute(dotHeight, 1));
    p.setAttribute('aDraw', new THREE.Float32BufferAttribute(dotDraw, 1));
    return { lines: g, points: p, segs: a, cum, total: cum[n] };
  }

  function create(scene, opts) {
    const kinds = [computer, phone, handset, sunglasses].map(f => geometries(f()));
    const rand = (a, b) => a + Math.random() * (b - a);
    const pointScale = { value: opts.pointScale };
    const models = [];

    function material(uniforms, points) {
      return new THREE.ShaderMaterial({
        uniforms, vertexShader, fragmentShader,
        defines: points ? { POINTS: '' } : {},
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });
    }

    // Place a model far ahead of z; later models get closer to the flight path
    function spawn(m, camZ, appear) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      m.lines.geometry = kind.lines;
      m.points.geometry = kind.points;
      m.kind = kind;
      m.seg = 0;
      const k = Math.min(Math.max(appear / CLOSE_TIME, 0), 1);
      const r = R_FAR + (R_NEAR - R_FAR) * k * k * (3 - 2 * k);
      m.group.position.set(rand(-1.4, 1.4), (Math.random() < 0.5 ? -1 : 1) * r * rand(0.7, 1), camZ - rand(36, 42));
      m.group.rotation.set(rand(-0.3, 0.3), rand(-0.5, 0.5), rand(-0.2, 0.2));
      m.size = rand(1.2, 2);
      m.group.scale.setScalar(m.size);
      m.group.visible = true;
      m.speed = rand(0.3, 1);     // drift towards the camera
      m.spin = rand(-0.4, 0.4);
      m.age = 0;
      m.active = true;
    }

    for (let i = 0; i < opts.count; i++) {
      const uniforms = {
        uColor: { value: new THREE.Color(0.25, 1, 0.45) },
        uAlpha: { value: 0 },
        uBuild: { value: 0 },
        uPulse: { value: 1 },
        uCursor: { value: 0 },
        uTime: { value: 0 },
        uPointScale: pointScale,
        uFogNear: { value: opts.fogNear },
        uFogFar: { value: opts.fogFar }
      };
      const lines = new THREE.LineSegments(kinds[0].lines, material(uniforms, false));
      const points = new THREE.Points(kinds[0].points, material(uniforms, true));
      const cursorGeometry = new THREE.BufferGeometry();
      cursorGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      const cursor = new THREE.Points(cursorGeometry, new THREE.ShaderMaterial({
        uniforms, vertexShader: cursorVertex, fragmentShader: cursorFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      }));
      lines.frustumCulled = points.frustumCulled = cursor.frustumCulled = false;
      const group = new THREE.Group();
      group.add(lines, points, cursor);
      scene.add(group);
      models.push({ group, lines, points, cursor, uniforms });
    }

    // appear: seconds since models started appearing (negative = hidden)
    // beat: music pulse from 0 to 1, or null for a steady glow
    function update(time, dt, appear, camZ, shift, beat) {
      for (const m of models) {
        if (!m.active) {
          if (appear >= m.delay) spawn(m, camZ, appear);
          else continue;
        }
        const g = m.group;
        g.position.z += shift + m.speed * dt;
        g.rotation.y += m.spin * dt;
        if (g.position.z > camZ + 3) spawn(m, camZ, appear);
        m.age += dt;
        const u = m.uniforms;
        u.uAlpha.value = Math.min(m.age / 1.5, 1);
        // Traced length grows at a constant rate; past the end the trail simply fades
        const kind = m.kind, traced = m.age / BUILD_TIME * kind.total;
        u.uBuild.value = traced;
        u.uCursor.value = Math.min(Math.max((BUILD_TIME + 0.3 - m.age) / 0.3, 0), 1);
        if (traced < kind.total) {
          while (kind.cum[m.seg + 1] < traced) m.seg++;
          const i = m.seg * 6, a = kind.segs;
          const t = (traced - kind.cum[m.seg]) / Math.max(kind.cum[m.seg + 1] - kind.cum[m.seg], 1e-6);
          m.cursor.geometry.attributes.position.setXYZ(0,
            a[i] + (a[i + 3] - a[i]) * t, a[i + 1] + (a[i + 4] - a[i + 1]) * t, a[i + 2] + (a[i + 5] - a[i + 2]) * t);
          m.cursor.geometry.attributes.position.needsUpdate = true;
        }
        u.uTime.value = time;
        // Glow and size swell with the music
        u.uPulse.value = beat === null ? 1 : 0.6 + 0.8 * beat;
        g.scale.setScalar(m.size * (1 + 0.05 * (beat || 0)));
      }
    }

    function reset() {
      models.forEach((m, i) => {
        m.active = false;
        m.group.visible = false;
        m.delay = i * 2.5 + rand(0, 1.5);
      });
    }
    reset();

    return { update, reset, resize: s => { pointScale.value = s; } };
  }

  return { create };
})();
