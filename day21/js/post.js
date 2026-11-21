// POST: HDR render target (MSAA), bloom, sun flare, speed blur, ACES tone mapping, vignette and grading.
(function () {
  'use strict';
  const P = { exposure: 1.0, bloom: 0.55, speedBlur: 0 };
  let renderer, rtMain, rtBright, levels = [], quad, qScene, qCam;
  let mBright, mBlur, mComp;

  const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  function rt(w, h, samples) {
    const r = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: !!samples });
    if (samples) r.samples = samples;
    return r;
  }

  P.init = function (r) {
    renderer = r;
    qScene = new THREE.Scene();
    qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    quad.frustumCulled = false;
    qScene.add(quad);
    mBright = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main() {
          vec3 c = vec3(0.0);
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
          c += texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
          c *= 0.25;
          c = min(c, vec3(60.0));
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c * smoothstep(1.0, 3.0, l), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    mBlur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VS,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
          c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
          c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
          c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    mComp = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null },
        uExposure: { value: 1 }, uBloom: { value: 0.5 }, uSun: { value: new THREE.Vector3(0.5, 0.5, -1) }, uAspect: { value: 1 },
        uBlur: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uDesat: { value: 0 },
      },
      vertexShader: VS,
      fragmentShader: `
        uniform sampler2D tScene, tB0, tB1, tB2, tB3;
        uniform float uExposure, uBloom, uAspect, uBlur, uTime, uFlash, uDesat;
        uniform vec3 uSun;   // xy = screen uv, z = in front (>0)
        varying vec2 vUv;
        vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
        vec3 aces(vec3 c) {
          const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
          const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
          return clamp(OUT * RRTAndODTFit(IN * c), 0.0, 1.0);
        }
        float h12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          vec3 col = texture2D(tScene, uv).rgb;
          // radial speed blur (stronger at the edges)
          if (uBlur > 0.001) {
            vec2 dir = uv - 0.5;
            float w = uBlur * smoothstep(0.1, 0.7, length(dir * vec2(uAspect, 1.0)));
            vec3 acc = col;
            for (int i = 1; i < 8; i++) acc += texture2D(tScene, uv - dir * w * float(i) * 0.012).rgb;
            col = acc / 8.0;
          }
          vec3 bl = texture2D(tB0, uv).rgb * 0.35 + texture2D(tB1, uv).rgb * 0.3 + texture2D(tB2, uv).rgb * 0.22 + texture2D(tB3, uv).rgb * 0.18;
          col += bl * uBloom;
          // sun flare: visibility from the scene brightness at the sun position
          if (uSun.z > 0.0) {
            vec2 sp = uSun.xy;
            float vis = 0.0;
            for (int i = 0; i < 5; i++) {
              vec2 o = vec2(float(i - 2) * 0.004, float(2 - i) * 0.003);
              vis += smoothstep(8.0, 30.0, dot(texture2D(tScene, sp + o).rgb, vec3(0.33)));
            }
            vis /= 5.0;
            vis *= smoothstep(0.0, 0.08, min(min(sp.x, sp.y), min(1.0 - sp.x, 1.0 - sp.y)) + 0.08);
            vec2 d = (uv - sp) * vec2(uAspect, 1.0);
            float r = length(d);
            col += vec3(1.0, 0.85, 0.65) * vis * (0.25 * exp(-r * 6.0) + 0.06 * exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 2.0));
            vec2 axis = vec2(0.5) - sp;
            const vec3 tints[4] = vec3[4](vec3(0.5, 0.7, 1.0), vec3(1.0, 0.6, 0.3), vec3(0.6, 1.0, 0.6), vec3(0.8, 0.5, 1.0));
            for (int k = 0; k < 4; k++) {
              float f = 0.5 + float(k) * 0.42;
              vec2 gp = sp + axis * f * 2.0;
              float gr = length((uv - gp) * vec2(uAspect, 1.0));
              float size = 0.03 + float(k) * 0.025;
              col += tints[k] * vis * 0.06 * smoothstep(size, size * 0.6, gr);
            }
          }
          col *= uExposure;
          col = aces(col);
          // light grading toward the reference: slightly richer saturation
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, 1.08 - uDesat);
          // vignette
          vec2 q = (uv - 0.5) * vec2(uAspect, 1.0);
          col *= 1.0 - 0.28 * smoothstep(0.35, 1.0, length(q));
          col = mix(col, vec3(1.0), uFlash);
          col = pow(col, vec3(1.0 / 2.2));
          col += (h12(uv * 1024.0 + uTime) - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    P.resize();
  };

  P.resize = function () {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    if (rtMain) { rtMain.dispose(); rtBright.dispose(); levels.forEach(l => { l[0].dispose(); l[1].dispose(); }); }
    rtMain = rt(w, h, 4);
    rtBright = rt(Math.max(1, w >> 1), Math.max(1, h >> 1));
    levels = [];
    let lw = w >> 1, lh = h >> 1;
    for (let i = 0; i < 4; i++) {
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
      levels.push([rt(lw, lh), rt(lw, lh)]);
    }
    mComp.uniforms.uAspect.value = w / h;
  };

  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  }

  const sv = new THREE.Vector3();
  P.render = function (scene, camera, time) {
    renderer.setRenderTarget(rtMain);
    renderer.render(scene, camera);
    // bright pass
    mBright.uniforms.tSrc.value = rtMain.texture;
    mBright.uniforms.uTexel.value.set(1 / rtMain.width, 1 / rtMain.height);
    pass(mBright, rtBright);
    let src = rtBright;
    levels.forEach(([a, b]) => {
      mBright.uniforms.tSrc.value = src.texture;
      mBright.uniforms.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
      // plain downsample (threshold already applied: reuse the box filter with a low threshold)
      mBlur.uniforms.tSrc.value = src.texture;
      mBlur.uniforms.uDir.value.set(1 / a.width, 0);
      pass(mBlur, a);
      mBlur.uniforms.tSrc.value = a.texture;
      mBlur.uniforms.uDir.value.set(0, 1 / a.height);
      pass(mBlur, b);
      src = b;
    });
    // sun position on screen
    sv.copy(SCENERY.sunDir).multiplyScalar(5000).add(camera.position).project(camera);
    const front = SCENERY.sunDir.dot(camera.getWorldDirection(new THREE.Vector3())) > 0 ? 1 : -1;
    const u = mComp.uniforms;
    u.uSun.value.set(sv.x * 0.5 + 0.5, sv.y * 0.5 + 0.5, front);
    u.tScene.value = rtMain.texture;
    u.tB0.value = levels[0][1].texture; u.tB1.value = levels[1][1].texture; u.tB2.value = levels[2][1].texture; u.tB3.value = levels[3][1].texture;
    u.uExposure.value = P.exposure; u.uBloom.value = P.bloom; u.uBlur.value = P.speedBlur; u.uTime.value = time % 100;
    u.uFlash.value = P.flash || 0; u.uDesat.value = P.desat || 0;
    pass(mComp, null);
  };

  window.POST = P;
})();
