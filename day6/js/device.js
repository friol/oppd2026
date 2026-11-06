// The device in WebGL, in two variants with a round dot-matrix hub in the middle:
// Tetraphon = graphite diamond with four square pads, Octaphon = rounded octagon with eight round pads in a ring.
const Device = (() => {
  // Tetraphon pads clockwise from the top; grid = centre in the unrotated pad grid
  const TETRA_PADS = [
    { name: 'Magenta', color: '#f0459a', grid: [-1, -1] },
    { name: 'Orange', color: '#ff8a1f', grid: [1, -1] },
    { name: 'Cyan', color: '#1fc8e6', grid: [1, 1] },
    { name: 'Lime', color: '#9bdc28', grid: [-1, 1] }
  ];
  // Octaphon pads clockwise from the top: the colour wheel, one note of the octave each
  const OCTA_PADS = [
    { name: 'Red', color: '#ff4b4b' }, { name: 'Orange', color: '#ff8a1f' }, { name: 'Yellow', color: '#ffd23f' },
    { name: 'Lime', color: '#9bdc28' }, { name: 'Cyan', color: '#1fc8e6' }, { name: 'Blue', color: '#4f7dff' },
    { name: 'Violet', color: '#a35cff' }, { name: 'Magenta', color: '#f0459a' }
  ];
  const ANGLE = Math.PI / 4;   // the Tetraphon is a square turned into a diamond
  const BODY = { hw: 1.3, r: 0.5 };
  const WELL = { hw: 1.12, r: 0.36 };
  const PAD = { half: 0.47, gap: 0.04, r: 0.14 };
  const OCTA_BODY = { hw: 1.6, r: 0.4 };    // octagon: hw = apothem, centre to the middle of a side
  const OCTA_WELL = { hw: 1.44, r: 0.3 };
  const OCTA_PAD = { ring: 0.98, r: 0.34 }; // round pads on a circle around the hub
  const MAX_PADS = 8;
  const BODY_TOP = 0.35;
  const PAD_TOP = 0.445;
  const PRESS_DEPTH = 0.03;
  const HUB_R = 0.52;
  const HUB_TOP = 0.56;
  const LCD_R = HUB_R - 0.05;
  const FLOOR_TILE = 0.9;      // tile size, the device is about three tiles wide
  const TARGET = [0, 0.22, 0];
  const FOV = 32 * Math.PI / 180;
  // Colours of the model and the floor per page theme; the dot-matrix screen stays dark in both
  const THEMES = {
    dark: {
      body: [0.17, 0.175, 0.2], well: [0.06, 0.062, 0.075], ring: [0.55, 0.56, 0.6], padOff: 0.42,
      floor: [0.068, 0.07, 0.09], groove: 0.45, sheen: 0.05, shadow: 0.6
    },
    light: {
      body: [0.84, 0.84, 0.86], well: [0.6, 0.61, 0.65], ring: [0.78, 0.79, 0.82], padOff: 0.5,
      floor: [0.86, 0.86, 0.89], groove: 0.09, sheen: 0.06, shadow: 0.32
    }
  };

  const VS = `
attribute vec3 aPos; attribute vec3 aNor; attribute vec2 aUv;
uniform mat4 uVP; uniform vec3 uOffset;
varying vec3 vPos; varying vec3 vNor; varying vec2 vUv;
void main() { vec3 p = aPos + uOffset; vPos = p; vNor = aNor; vUv = aUv; gl_Position = uVP * vec4(p, 1.0); }`;

  const fs = derivatives => `${derivatives ? '#extension GL_OES_standard_derivatives : enable' : ''}
precision mediump float;
varying vec3 vPos; varying vec3 vNor; varying vec2 vUv;
uniform vec3 uEye; uniform vec3 uColor; uniform vec3 uEmissive;
uniform float uShine; uniform float uSpec; uniform float uUseTex; uniform sampler2D uTex;
uniform float uDots; uniform vec3 uLcdOn;
uniform vec3 uGlowPos[${MAX_PADS}]; uniform vec3 uGlowCol[${MAX_PADS}];
void main() {
  vec3 n = normalize(vNor), v = normalize(uEye - vPos);
  vec3 L = normalize(vec3(-0.45, 1.0, 0.35)), F = normalize(vec3(0.7, 0.35, 0.6));
  float diff = max(dot(n, L), 0.0), fill = max(dot(n, F), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), uShine) * uSpec;
  float hemi = 0.5 + 0.5 * n.y;
  vec3 amb = mix(vec3(0.07, 0.06, 0.09), vec3(0.26, 0.27, 0.33), hemi);
  vec3 col = uColor * (amb + diff * vec3(1.0, 0.96, 0.9) * 0.85 + fill * vec3(0.35, 0.45, 0.6) * 0.35);
  col += spec * vec3(1.0, 0.97, 0.92);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  col += fres * vec3(0.12, 0.16, 0.24);
  for (int i = 0; i < ${MAX_PADS}; i++) {
    vec3 d = uGlowPos[i] - vPos;
    float dist = length(d);
    float k = (0.35 + 0.65 * max(dot(n, d / dist), 0.0)) / (1.0 + dist * dist * 9.0);
    col += uGlowCol[i] * k * (uColor * 1.6 + 0.12);
  }
  if (uUseTex > 0.5) {
    // Round dot-matrix LCD: one dot per texel of the brightness map, unlit dots faintly visible
    vec2 g = vUv * uDots, cell = floor(g), f = fract(g) - 0.5;
    float b = texture2D(uTex, (cell + 0.5) / uDots).r;
    float d = length(f);
    float aa = ${derivatives ? 'max(fwidth(g.x), 0.02)' : '0.12'};
    float dotm = 1.0 - smoothstep(0.36 - aa, 0.36 + aa, d);
    float inside = step(length((cell + 0.5) / uDots - 0.5), 0.5 - 0.4 / uDots);
    vec3 dotCol = mix(uLcdOn * 0.07 + 0.012, uLcdOn * 1.15 + 0.08 * b, b);
    col = vec3(0.012, 0.018, 0.022) + inside * (dotm * dotCol + uLcdOn * b * 0.22 * (1.0 - smoothstep(0.25, 0.8, d)));
    col += spec * 0.35 + fres * 0.06;
  }
  col += uEmissive;
  gl_FragColor = vec4(col, 1.0);
}`;

  // Soft contact shadow under the body, from a rounded box distance
  const SHADOW_VS = `
attribute vec3 aPos; uniform mat4 uVP; varying vec2 vXZ;
void main() { vXZ = aPos.xz; gl_Position = uVP * vec4(aPos, 1.0); }`;
  const SHADOW_FS = `
precision mediump float;
varying vec2 vXZ; uniform vec3 uBox; uniform float uAlpha; uniform float uShape;
void main() {
  vec2 w = vXZ - vec2(0.12, -0.06); // pushed away from the key light
  float d;
  if (uShape < 0.5) {
    // Tetraphon: rounded square turned by 45°
    vec2 p = vec2(w.x + w.y, w.y - w.x) * 0.70710678;
    vec2 q = abs(p) - vec2(uBox.x - uBox.y);
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uBox.y;
  } else {
    // Octaphon: rounded octagon, sides facing the axes
    vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
    float a = uBox.x - uBox.y;
    vec2 p = abs(w);
    p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
    p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
    p -= vec2(clamp(p.x, -k.z * a, k.z * a), a);
    d = length(p) * sign(p.y) - uBox.y;
  }
  float a = uAlpha * (1.0 - smoothstep(-0.35, 0.7, d));
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

  // Floor: dark tiles aligned with the diamond, faint grooves, a light sheen and the glow of the lit pads.
  // It fades into the page background, so the canvas edge never shows.
  const FLOOR_VS = `
attribute vec3 aPos; uniform mat4 uVP; varying vec3 vPos;
void main() { vPos = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;
  const floorFs = derivatives => `${derivatives ? '#extension GL_OES_standard_derivatives : enable' : ''}
precision mediump float;
varying vec3 vPos;
uniform vec3 uEye; uniform vec2 uRes; uniform vec3 uGlowPos[${MAX_PADS}]; uniform vec3 uGlowCol[${MAX_PADS}];
uniform vec3 uFloor; uniform float uGroove; uniform float uSheen;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 g = vec2(vPos.x + vPos.z, vPos.z - vPos.x) * 0.70710678 / ${FLOOR_TILE.toFixed(3)} + 0.5;
  vec2 f = abs(fract(g) - 0.5);
  vec2 fw = ${derivatives ? 'max(fwidth(g), vec2(1e-4))' : 'vec2(0.02)'};
  vec2 e = clamp((0.5 - f - 0.006) / fw, 0.0, 1.0);
  float groove = 1.0 - e.x * e.y;
  vec3 col = uFloor * (0.92 + 0.1 * hash(floor(g)));
  col *= 1.0 - uGroove * groove;
  vec3 v = normalize(uEye - vPos);
  vec3 h = normalize(normalize(vec3(-0.45, 1.0, 0.35)) + v);
  col += vec3(0.75, 0.8, 1.0) * pow(max(h.y, 0.0), 24.0) * uSheen * (1.0 - 0.6 * groove);
  for (int i = 0; i < ${MAX_PADS}; i++) {
    vec3 d = uGlowPos[i] - vPos;
    col += uGlowCol[i] * 0.22 / (1.0 + dot(d.xz, d.xz) * 1.2);
  }
  float a = 1.0 - smoothstep(1.4, 4.6, length(vPos.xz));
  vec2 s = gl_FragCoord.xy / uRes;  // also fade near the canvas edges
  a *= smoothstep(0.0, 0.22, s.y) * smoothstep(1.0, 0.75, s.y) * smoothstep(0.0, 0.12, s.x) * smoothstep(1.0, 0.88, s.x);
  gl_FragColor = vec4(col * a, a);
}`;

  function hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  OCTA_PADS.forEach((p, i) => {
    p.rgb = hex(p.color);
    const a = i * Math.PI / 4; // clockwise from the top (the far side, -z)
    p.cx = OCTA_PAD.ring * Math.sin(a);
    p.cz = -OCTA_PAD.ring * Math.cos(a);
  });
  TETRA_PADS.forEach(p => {
    p.rgb = hex(p.color);
    const g = PAD.gap + PAD.half;
    p.cx = (p.grid[0] - p.grid[1]) * g / Math.SQRT2; // grid → world, turned by ANGLE
    p.cz = (p.grid[0] + p.grid[1]) * g / Math.SQRT2;
  });

  // Rounded box signed distance in the pad grid
  function boxDist(x, z, half, r) {
    const qx = Math.abs(x) - (half - r), qz = Math.abs(z) - (half - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
  }

  // Rounded octagon: distance from its outline (approximate at the corners, enough for picking)
  function octaDist(x, z, a) {
    let d = -Infinity;
    for (let k = 0; k < 8; k++) d = Math.max(d, x * Math.cos(k * Math.PI / 4) + z * Math.sin(k * Math.PI / 4));
    return d - a;
  }

  const PAD_PROFILE = [[0.0, BODY_TOP - 0.02], [0.0, PAD_TOP - 0.04], [0.012, PAD_TOP - 0.012], [0.045, PAD_TOP]];
  const BODY_PROFILE = [[0.07, 0], [0.0, 0.06], [0.0, 0.25], [0.02, 0.31], [0.07, 0.342], [0.11, BODY_TOP]];
  const WELL_PROFILE = [[0.0, BODY_TOP - 0.03], [0.0, BODY_TOP + 0.002]];

  // Both variants: pads, outline of the body and how to hit a pad
  const VARIANTS = {
    tetra: {
      name: 'Tetraphon', pads: TETRA_PADS, scale: 1, shadow: 0, box: [BODY.hw, BODY.r, 0],
      body: { hw: BODY.hw, hd: BODY.hw, r: BODY.r, seg: 10, angle: ANGLE },
      well: { hw: WELL.hw, hd: WELL.hw, r: WELL.r, seg: 10, angle: ANGLE },
      pad: p => ({ hw: PAD.half, hd: PAD.half, r: PAD.r, seg: 8, angle: ANGLE, cx: p.cx, cz: p.cz }),
      hitPad(x, z) {
        const gx = (x + z) / Math.SQRT2, gz = (z - x) / Math.SQRT2, c = PAD.gap + PAD.half;
        return TETRA_PADS.findIndex(p => boxDist(gx - p.grid[0] * c, gz - p.grid[1] * c, PAD.half, PAD.r) <= 0.02);
      },
      inBody: (x, z) => boxDist((x + z) / Math.SQRT2, (z - x) / Math.SQRT2, BODY.hw, BODY.r) <= 0
    },
    octa: {
      name: 'Octaphon', pads: OCTA_PADS, scale: 1.05, shadow: 1, box: [OCTA_BODY.hw, OCTA_BODY.r, 0],
      body: { hw: OCTA_BODY.hw, hd: OCTA_BODY.hw, r: OCTA_BODY.r, seg: 5, sides: 8 },
      well: { hw: OCTA_WELL.hw, hd: OCTA_WELL.hw, r: OCTA_WELL.r, seg: 5, sides: 8 },
      pad: p => ({ hw: OCTA_PAD.r, hd: OCTA_PAD.r, r: OCTA_PAD.r, seg: 7, cx: p.cx, cz: p.cz }),
      hitPad: (x, z) => OCTA_PADS.findIndex(p => Math.hypot(x - p.cx, z - p.cz) <= OCTA_PAD.r + 0.02),
      inBody: (x, z) => octaDist(x, z, OCTA_BODY.hw) <= 0
    }
  };

  function create(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) return null;
    const derivatives = !!gl.getExtension('OES_standard_derivatives');
    const prog = GL3D.program(gl, VS, fs(derivatives));
    const shadowProg = GL3D.program(gl, SHADOW_VS, SHADOW_FS);
    const floorProg = GL3D.program(gl, FLOOR_VS, floorFs(derivatives));

    // Body, well and pads of each variant, built once
    const models = {};
    for (const id in VARIANTS) {
      const v = VARIANTS[id];
      const body = GL3D.prism({ ...v.body, profile: BODY_PROFILE });
      const well = GL3D.prism({ ...v.well, profile: WELL_PROFILE });
      models[id] = {
        body: GL3D.upload(gl, GL3D.merge(body.side, body.cap)),
        well: GL3D.upload(gl, GL3D.merge(well.side, well.cap)),
        pads: v.pads.map(p => {
          const m = GL3D.prism({ ...v.pad(p), profile: PAD_PROFILE });
          return GL3D.upload(gl, GL3D.merge(m.side, m.cap));
        })
      };
    }
    const hub = GL3D.prism({
      hw: HUB_R, hd: HUB_R, r: HUB_R, seg: 16,
      profile: [[-0.03, BODY_TOP - 0.02], [-0.03, BODY_TOP + 0.02], [0.0, HUB_TOP - 0.05], [0.015, HUB_TOP - 0.01],
        [0.045, HUB_TOP], [0.05, HUB_TOP]]
    });
    const lcd = GL3D.prism({ hw: LCD_R, hd: LCD_R, r: LCD_R, seg: 16, profile: [[0, HUB_TOP + 0.001]] });

    const meshes = {
      hub: GL3D.upload(gl, GL3D.merge(hub.side, hub.cap)),
      lcd: GL3D.upload(gl, lcd.cap),
      shadow: GL3D.upload(gl, { pos: [-3, 0.001, -3, 3, 0.001, -3, 3, 0.001, 3, -3, 0.001, 3], nor: [], uv: [], idx: [0, 1, 2, 0, 2, 3] }),
      floor: GL3D.upload(gl, { pos: [-8, 0, -8, 8, 0, -8, 8, 0, 8, -8, 0, 8], nor: [], uv: [], idx: [0, 1, 2, 0, 2, 3] })
    };

    // Dot-matrix brightness map (one byte per dot), uploaded every frame by setMatrix
    const tex = gl.createTexture();
    let dots = 1, lcdOn = [0.5, 0.89, 1];
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(1));

    let vp = null, eye = [0, 0, 0], cssW = 1, cssH = 1, theme = THEMES.dark, variant = VARIANTS.tetra, model = models.tetra;
    const view = { yaw: 0, pitch: 0.95 };

    // bytes: n×n brightness, row 0 = far edge (top of the screen); color: lit dot colour
    function setMatrix(bytes, n, color) {
      dots = n;
      lcdOn = hex(color);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, n, n, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
    }

    function bind(m, loc) {
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
      gl.enableVertexAttribArray(loc.aPos);
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
      if (loc.aNor >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.nor);
        gl.enableVertexAttribArray(loc.aNor);
        gl.vertexAttribPointer(loc.aNor, 3, gl.FLOAT, false, 0, 0);
      }
      if (loc.aUv >= 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.uv);
        gl.enableVertexAttribArray(loc.aUv);
        gl.vertexAttribPointer(loc.aUv, 2, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.idx);
    }

    function drawMesh(m, color, opt = {}) {
      const loc = prog.loc;
      bind(m, loc);
      gl.uniform3fv(loc.uColor, color);
      gl.uniform3fv(loc.uEmissive, opt.emissive || [0, 0, 0]);
      gl.uniform3fv(loc.uOffset, opt.offset || [0, 0, 0]);
      gl.uniform1f(loc.uShine, opt.shine || 40);
      gl.uniform1f(loc.uSpec, opt.spec === undefined ? 0.35 : opt.spec);
      gl.uniform1f(loc.uUseTex, opt.tex ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0);
    }

    // Camera distance that keeps the whole device in view for this aspect ratio
    function camera() {
      const aspect = cssW / cssH;
      const dist = 1.8 * variant.scale / Math.tan(FOV / 2) / Math.min(1, aspect * 0.92);
      const cp = Math.cos(view.pitch);
      eye = [TARGET[0] + dist * cp * Math.sin(view.yaw), TARGET[1] + dist * Math.sin(view.pitch),
        TARGET[2] + dist * cp * Math.cos(view.yaw)];
      vp = GL3D.multiply(GL3D.perspective(FOV, aspect, 0.5, 40), GL3D.lookAt(eye, TARGET, [0, 1, 0]));
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = Math.max(1, canvas.clientWidth);
      cssH = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }

    // lights: 0..1 per pad
    function draw(lights) {
      if (canvas.width !== Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2))) resize();
      camera();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const gp = [], gc = [];
      for (let i = 0; i < MAX_PADS; i++) {
        const p = variant.pads[i];
        gp.push(p ? p.cx : 0, PAD_TOP + 0.12, p ? p.cz : 0);
        gc.push(...(p ? p.rgb.map(c => c * (lights[i] || 0) * 1.4) : [0, 0, 0]));
      }

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(floorProg.p);
      gl.uniformMatrix4fv(floorProg.loc.uVP, false, vp);
      gl.uniform3fv(floorProg.loc.uEye, eye);
      gl.uniform2f(floorProg.loc.uRes, canvas.width, canvas.height);
      gl.uniform3fv(floorProg.loc.uFloor, theme.floor);
      gl.uniform1f(floorProg.loc.uGroove, theme.groove);
      gl.uniform1f(floorProg.loc.uSheen, theme.sheen);
      gl.uniform3fv(floorProg.loc.uGlowPos, gp);
      gl.uniform3fv(floorProg.loc.uGlowCol, gc);
      bind(meshes.floor, floorProg.loc);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

      gl.useProgram(shadowProg.p);
      gl.uniformMatrix4fv(shadowProg.loc.uVP, false, vp);
      gl.uniform3fv(shadowProg.loc.uBox, variant.box);
      gl.uniform1f(shadowProg.loc.uShape, variant.shadow);
      gl.uniform1f(shadowProg.loc.uAlpha, theme.shadow);
      bind(meshes.shadow, shadowProg.loc);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      gl.disableVertexAttribArray(shadowProg.loc.aPos);
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);

      const loc = prog.loc;
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(loc.uVP, false, vp);
      gl.uniform3fv(loc.uEye, eye);
      gl.uniform3fv(loc.uGlowPos, gp);
      gl.uniform3fv(loc.uGlowCol, gc);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc.uTex, 0);
      gl.uniform1f(loc.uDots, dots);
      gl.uniform3fv(loc.uLcdOn, lcdOn);

      drawMesh(model.body, theme.body, { shine: 30, spec: 0.25 });
      drawMesh(model.well, theme.well, { spec: 0.1 });
      variant.pads.forEach((p, i) => {
        const l = lights[i] || 0;
        // Lit pads keep their hue: the brightest channel stays near 1
        const base = p.rgb.map(c => c * (theme.padOff + 0.1 * l));
        const emissive = p.rgb.map(c => c * l * 0.58 + 0.04 * l);
        drawMesh(model.pads[i], base, { emissive, offset: [0, -PRESS_DEPTH * l, 0], shine: 60, spec: 0.55 });
      });
      drawMesh(meshes.hub, theme.ring, { shine: 80, spec: 0.9 });
      drawMesh(meshes.lcd, [0, 0, 0], { tex: true, shine: 120, spec: 0.6 });
    }

    // Point on the plane y under a CSS pixel of the canvas
    function rayPlane(px, py, y) {
      const inv = GL3D.invert(vp);
      const nx = px / cssW * 2 - 1, ny = 1 - py / cssH * 2;
      const a = GL3D.transform(inv, nx, ny, -1, 1), b = GL3D.transform(inv, nx, ny, 1, 1);
      const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], f = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      const dy = f[1] - o[1];
      if (Math.abs(dy) < 1e-6) return null;
      const t = (y - o[1]) / dy;
      return [o[0] + (f[0] - o[0]) * t, o[2] + (f[2] - o[2]) * t];
    }

    // 'hub', a pad index, 'body' or null under a CSS pixel
    function pick(px, py) {
      if (!vp) return null;
      let h = rayPlane(px, py, HUB_TOP);
      if (h && Math.hypot(h[0], h[1]) <= HUB_R) return 'hub';
      h = rayPlane(px, py, PAD_TOP);
      if (!h) return null;
      if (Math.hypot(h[0], h[1]) > HUB_R) {
        const i = variant.hitPad(h[0], h[1]);
        if (i >= 0) return i;
      }
      const b = rayPlane(px, py, BODY_TOP);
      if (b && variant.inBody(b[0], b[1])) return 'body';
      return null;
    }

    function setVariant(id) {
      variant = VARIANTS[id] || VARIANTS.tetra;
      model = models[id] || models.tetra;
    }

    function setTheme(name) {
      theme = THEMES[name] || THEMES.dark;
    }

    resize();
    return { draw, pick, setMatrix, setTheme, setVariant, resize, view };
  }

  return { create, VARIANTS };
})();
