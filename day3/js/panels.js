// Glowing translucent rectangles parallel to the rain planes, scattered around the
// flight path and recycled ahead of the camera once they fall behind it.
// Each one is a retro console that keeps typing lines of fake terminal output.
const Panels = (() => {
  // Glow extends this far (world units) outside the rectangle, so the quad is enlarged by it
  const HALO = 0.6;
  const PAD = 0.15;         // margin between the border and the text
  const COLS = ConsoleText.COLS, LINES = ConsoleText.LINES, GRID = ConsoleText.GRID;

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  const fragmentShader = `
    uniform sampler2D uGlyphs, uText;
    uniform vec2 uSize, uChar;
    uniform vec3 uColor;
    uniform float uAlpha, uPulse, uFogNear, uFogFar, uProgress, uLineStart, uTime;
    varying vec2 vUv;
    varying vec3 vWorld;

    // Coverage of the console text at text coordinates tc (in characters, from top-left)
    float consoleText(vec2 tc, vec2 dx, vec2 dy) {
      float cols = min(floor((uSize.x - ${2 * PAD}) / uChar.x), ${COLS}.0);
      float rows = floor((uSize.y - ${2 * PAD}) / uChar.y);
      vec2 cell = floor(tc);
      if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= cols || cell.y >= rows) return 0.0;

      // uProgress counts typed lines; the screen scrolls once it is full
      float cur = floor(uProgress);
      float line = max(cur - rows + 1.0, 0.0) + cell.y;
      if (line > cur) return 0.0;
      float row = mod(uLineStart + line, ${LINES}.0);
      float len = floor(texelFetch(uText, ivec2(${COLS}, int(row)), 0).r * 255.0 + 0.5);
      float typed = line < cur ? len : min(floor(fract(uProgress) * ${COLS}.0), len);

      if (line == cur && cell.x == min(typed, cols - 1.0)) return fract(uTime * 1.5) < 0.5 ? 0.9 : 0.0;
      if (cell.x >= typed) return 0.0;
      float code = floor(texelFetch(uText, ivec2(int(cell.x), int(row)), 0).r * 255.0 + 0.5) - 32.0;
      if (code <= 0.0) return 0.0;

      vec2 g = vec2(mod(code, ${GRID}.0), floor(code / ${GRID}.0));
      vec2 f = fract(tc);
      vec2 uv = vec2(g.x + f.x, ${GRID - 1}.0 - g.y + 1.0 - f.y) / ${GRID}.0;
      float m = textureGrad(uGlyphs, uv, dx / ${GRID}.0, dy / ${GRID}.0).r;
      // Too small to read: fade to average coverage instead of shimmering
      float detail = 1.0 - smoothstep(0.12, 0.35, max(length(dx), length(dy)));
      return mix(0.2, m, detail);
    }

    void main() {
      vec2 pos = (vUv - 0.5) * (uSize + ${2 * HALO});
      // Signed distance to the rectangle border in world units (negative inside)
      vec2 q = abs(pos) - uSize * 0.5;
      float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      float border = exp(-abs(sd) * 30.0);
      float glow = sd < 0.0 ? 0.12 + exp(sd * 3.0) * 0.35 : exp(-sd * 7.0) * 0.45;
      // Luminescent look: bright whitish core on the border, colored glow around it
      vec3 color = (uColor * (glow + border) + vec3(0.6, 1.0, 0.7) * border * border * 0.5) * uPulse;

      // Derivatives are taken here, outside any branch
      vec2 tc = vec2(pos.x + uSize.x * 0.5 - ${PAD}, uSize.y * 0.5 - ${PAD} - pos.y) / uChar;
      float text = consoleText(tc, dFdx(tc), dFdy(tc));
      color += mix(uColor, vec3(0.75, 1.0, 0.8), 0.5) * text * 1.1;

      float dist = length(vWorld - cameraPosition);
      float fog = (1.0 - smoothstep(uFogNear, uFogFar, dist)) * smoothstep(0.5, 2.5, dist);
      gl_FragColor = vec4(color * fog * uAlpha, 1.0);
    }
  `;

  function create(scene, opts) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const consoleText = ConsoleText.create(opts.anisotropy);
    const rand = (a, b) => a + Math.random() * (b - a);
    const panels = [];

    // Place a panel somewhere ahead of z, off the flight path
    function place(p, z) {
      const w = rand(1.5, 7), h = rand(1, 4.5);
      const x = (Math.random() < 0.5 ? -1 : 1) * rand(0.7, opts.spreadX);
      p.mesh.scale.set(w + 2 * HALO, h + 2 * HALO, 1);
      p.mesh.position.set(x, rand(-opts.spreadY, opts.spreadY), z);
      // Face the flight path so the text never reads mirrored
      p.mesh.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      const u = p.mat.uniforms;
      u.uSize.value.set(w, h);
      u.uColor.value.setHSL(rand(0.33, 0.39), 1, rand(0.45, 0.55));
      const ch = rand(0.08, 0.14);
      u.uChar.value.set(ch * 0.75, ch);
      u.uLineStart.value = Math.floor(rand(0, LINES));
      p.progress = rand(0, (h - 2 * PAD) / ch);   // some panels already hold text
      p.rate = rand(1, 3);                         // lines per second
      p.delay = rand(0, opts.fadeSpread);
      p.pulse = rand(0.4, 0.9); // rad/s: one slow breath every 7-16 s
      p.phase = rand(0, Math.PI * 2);
    }

    for (let i = 0; i < opts.count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uGlyphs: { value: consoleText.glyphs },
          uText: { value: consoleText.text },
          uSize: { value: new THREE.Vector2() },
          uChar: { value: new THREE.Vector2() },
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uPulse: { value: 1 },
          uProgress: { value: 0 },
          uLineStart: { value: 0 },
          uTime: { value: 0 },
          uFogNear: { value: opts.fogNear },
          uFogFar: { value: opts.fogFar }
        },
        vertexShader,
        fragmentShader,
        side: THREE.DoubleSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      const p = { mesh, mat };
      place(p, -rand(0, opts.depth));
      panels.push(p);
    }

    // appear: seconds since panels started appearing (negative = hidden)
    function update(time, dt, appear, camZ, shift) {
      for (const p of panels) {
        p.mesh.position.z += shift;
        if (p.mesh.position.z > camZ + 2) place(p, p.mesh.position.z - opts.depth - 2);
        p.progress += p.rate * dt;
        const u = p.mat.uniforms;
        u.uAlpha.value = Math.min(Math.max((appear - p.delay) / 1.5, 0), 1);
        u.uPulse.value = 0.6 + 0.4 * Math.sin(time * p.pulse + p.phase);
        u.uProgress.value = p.progress;
        u.uTime.value = time;
      }
    }

    function reset() {
      for (const p of panels) place(p, -rand(0, opts.depth));
    }

    return { update, reset };
  }

  return { create };
})();
