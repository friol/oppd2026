// post.js - frame pipeline: planar reflection, scene, volumetric clouds (ray marched,
// temporally accumulated), atmosphere composite (sky, sun, moon, stars, aerial
// perspective), bloom, ACES tone mapping and FXAA.
(function () {
  'use strict';
  const U = GLSL.U;
  const P = { scale: 1, quality: 2 };
  let renderer, quad, quadScene, quadCam;
  let mainRT, reflRT, reflOut, cloudA, cloudB, cloudRefl, hdrRT, overRT, ldrRT, bloomA, bloomB, bloomC, bloomD;
  let cloudMat, compMat, brightMat, blurMat, downMat, toneMat, fxaaMat, copyMat;
  let frame = 0;
  const prevViewProj = new THREE.Matrix4();
  let hasHistory = false;

  const fsVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // Exponential height fog (aerial perspective), shared by clouds and composite
  const fogGLSL = /* glsl */`
    uniform float uFogDensity;
    vec3 fogTransmittance(vec3 cam, vec3 p) {
      float dist = distance(cam, p);
      const float H = 1400.0;
      float h0 = abs(cam.y), h1 = max(p.y, 0.0);
      float dh = h1 - h0;
      float e0 = exp(-h0 / H);
      float od = abs(dh) < 1.0 ? e0 : (e0 - exp(-h1 / H)) / (dh / H);
      od *= uFogDensity * dist;
      return exp(-od * vec3(0.8, 0.92, 1.12));
    }
    vec3 fogColor(vec3 dir) {
      return skyLut(normalize(vec3(dir.x, abs(dir.y) * 0.35 + 0.025, dir.z)));
    }
  `;

  const viewGLSL = /* glsl */`
    uniform sampler2D tDepth;
    uniform mat4 uInvProj;
    uniform mat4 uCamWorld;
    uniform vec3 uCamPos;
    // distance along the view ray of the scene (1e9 for sky) and world direction
    float sceneDistance(vec2 uv, out vec3 dir) {
      float d = texture2D(tDepth, uv).r;
      vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vp /= vp.w;
      dir = normalize((uCamWorld * vec4(vp.xyz, 0.0)).xyz);
      return d >= 1.0 ? 1e9 : length(vp.xyz);
    }
  `;

  const cloudFrag = /* glsl */`
    precision highp float;
    precision highp sampler3D;
    varying vec2 vUv;
    uniform highp sampler3D tShape;
    uniform highp sampler3D tDetail;
    uniform sampler2D tHistory;
    uniform mat4 uPrevViewProj;
    uniform float uHistory;
    uniform float uFrame;
    uniform int uSteps;
    uniform vec3 uLightColor;
    uniform float uTime;
    ${GLSL.common}
    ${GLSL.weather}
    ${ATMO.lutGLSL}
    ${fogGLSL}
    ${viewGLSL}
    uniform vec3 uLightDir;
    const float PI = 3.14159265;
    float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
    float HG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

    float cloudDensity(vec3 p, float cov, bool detail) {
      float h = (p.y - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE);
      if (h <= 0.0 || h >= 1.0 || cov <= 0.001) return 0.0;
      float topH = mix(0.3, 1.0, cov);
      float prof = smoothstep(0.0, 0.06, h) * smoothstep(topH, topH * 0.45, h);
      vec3 q = p + vec3(uWind.x, 0.0, uWind.y);
      vec4 s = texture(tShape, q / 7000.0);
      float base = remap(s.r, (1.0 - s.g) * 0.55, 1.0, 0.0, 1.0);
      base = clamp(remap(base * prof, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
      if (base <= 0.0) return 0.0;
      if (detail) {
        float d = texture(tDetail, q / 1300.0 + vec3(0.0, uTime * 0.002, 0.0)).r;
        d = mix(d, 1.0 - d, clamp(h * 3.0, 0.0, 1.0));
        base = clamp(remap(base, d * 0.32, 1.0, 0.0, 1.0), 0.0, 1.0);
      }
      return base;
    }

    void main() {
      vec3 dir;
      float sceneD = sceneDistance(vUv, dir);
      vec3 ro = uCamPos;
      // intersect the cloud slab
      float t0, t1;
      if (abs(dir.y) < 1e-4) { if (ro.y < CLOUD_BASE || ro.y > CLOUD_TOP) { t0 = 1.0; t1 = 0.0; } else { t0 = 0.0; t1 = 60000.0; } }
      else {
        float ta = (CLOUD_BASE - ro.y) / dir.y, tb = (CLOUD_TOP - ro.y) / dir.y;
        t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
      }
      t1 = min(t1, min(sceneD, 60000.0));
      vec3 L = vec3(0.0); float T = 1.0; float wDist = 0.0, wSum = 0.0;
      if (t1 > t0) {
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.61803);
        int steps = uSteps;
        float dt = clamp((t1 - t0) / float(steps), 30.0, 700.0);
        float t = t0 + dt * jitter;
        float cosT = dot(dir, uLightDir);
        // multi-octave phase approximation (multiple scattering)
        float ph0 = mix(HG(cosT, 0.75), HG(cosT, -0.25), 0.35);
        float ph1 = mix(HG(cosT, 0.375), HG(cosT, -0.125), 0.35);
        float ph2 = 1.0 / (4.0 * PI);
        vec3 ambTop = skyLut(vec3(0.0, 1.0, 0.0)) * 1.6;
        vec3 ambBot = (ambTop * 0.35 + uLightColor * max(uLightDir.y, 0.0) * 0.04);
        const float EXT = 0.05;
        for (int i = 0; i < 128; i++) {
          if (i >= steps || t > t1 || T < 0.015) break;
          vec3 p = ro + dir * t;
          float cov = cloudCoverage(p.xz);
          if (cov > 0.01) {
            float den = cloudDensity(p, cov, true);
            if (den > 0.002) {
              // light march toward the sun / moon
              float od = 0.0, ls = 70.0;
              vec3 lp = p;
              for (int j = 0; j < 6; j++) {
                lp += uLightDir * ls;
                od += cloudDensity(lp, cov, false) * ls;
                ls *= 1.6;
              }
              od *= EXT;
              float h = clamp((p.y - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE), 0.0, 1.0);
              vec3 sun = uLightColor * (exp(-od) * ph0 + 0.5 * exp(-od * 0.5) * ph1 + 0.25 * exp(-od * 0.25) * ph2) * 1.6;
              sun *= 1.0 - 0.6 * exp(-den * 12.0); // darker wispy edges (powder-like)
              vec3 amb = mix(ambBot, ambTop, h) * (0.55 + 0.45 * h);
              float sigma = den * EXT;
              vec3 S = (sun + amb) * sigma;
              float Ts = exp(-sigma * dt);
              L += T * (S - S * Ts) / max(sigma, 1e-6);
              wDist += t * T * (1.0 - Ts); wSum += T * (1.0 - Ts);
              T *= Ts;
            }
          }
          t += dt * (cov > 0.01 ? 1.0 : 1.6);
        }
      }
      float meanD = wSum > 0.0 ? wDist / wSum : min(sceneD, 60000.0);
      // aerial perspective on the clouds
      if (wSum > 0.0) {
        vec3 cp = ro + dir * meanD;
        vec3 ft = fogTransmittance(ro, cp);
        L = L * ft + fogColor(dir) * (1.0 - ft) * (1.0 - T);
        float far = smoothstep(42000.0, 60000.0, meanD);
        L = mix(L, fogColor(dir) * (1.0 - T), far);
      }
      vec4 cur = vec4(L, T);
      // temporal accumulation (reproject the mean cloud point)
      // nothing to march (e.g. the ship in front of distant clouds): the result is exact, no history
      if (uHistory > 0.0 && t1 > t0) {
        vec4 pc = uPrevViewProj * vec4(ro + dir * meanD, 1.0);
        vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
        if (pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) {
          vec4 hist = texture2D(tHistory, puv);
          cur = mix(cur, hist, uHistory);
        }
      }
      gl_FragColor = cur;
    }
  `;

  const compFrag = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tScene;
    uniform sampler2D tClouds;
    uniform vec3 uSunDir, uSunColor, uMoonDir, uMoonColor;
    uniform float uStarRot, uNight, uTime;
    ${GLSL.common}
    ${GLSL.weather}
    ${ATMO.lutGLSL}
    ${fogGLSL}
    ${viewGLSL}
    vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
    vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
    void main() {
      vec3 dir;
      float d = sceneDistance(vUv, dir);
      vec3 col;
      if (d > 1e8) {
        col = skyLut(dir);
        // sun disc with limb darkening
        float cs = dot(dir, uSunDir);
        const float SR = 0.0068;
        float r = acos(clamp(cs, -1.0, 1.0)) / SR;
        if (r < 1.0) col += uSunColor * 160.0 * (1.0 - 0.55 * (1.0 - sqrt(1.0 - r * r)));
        col += uSunColor * 0.6 * exp(-r * 0.25) * 0.05; // soft corona
        // moon disc, lit by the sun
        vec3 md = uMoonDir;
        vec3 mt = normalize(cross(md, vec3(0.0, 1.0, 0.0))), mb = cross(mt, md);
        const float MR = 0.0105;
        vec2 o = vec2(dot(dir, mt), dot(dir, mb)) / MR;
        float horizon = smoothstep(-0.02, 0.02, dir.y);
        if (dot(dir, md) > 0.0 && dot(o, o) < 1.0) {
          vec3 n = normalize(mt * o.x + mb * o.y + md * (-sqrt(1.0 - dot(o, o))));
          float lit = max(dot(-n, uSunDir), 0.0);
          float maria = 0.65 + 0.35 * vnoise2(o * 2.3 + 4.0) * vnoise2(o * 5.1);
          col += (vec3(0.9, 0.92, 1.0) * lit * maria * 0.9 + 0.004) * horizon * (0.35 + 0.65 * uNight);
        }
        // stars, rotating around the celestial pole
        vec3 sd = rotY(rotX(dir, -0.77), uStarRot);
        vec3 g = sd * 260.0;
        vec3 cell = floor(g);
        float hs = hash13(cell);
        if (hs > 0.9965) {
          vec3 sp = hash33(cell) * 0.6 + 0.2;
          float b = smoothstep(0.22, 0.0, length(fract(g) - sp)) * (hs - 0.9965) / 0.0035;
          float tw = 0.75 + 0.25 * sin(uTime * 3.0 + hs * 900.0);
          vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash13(cell + 7.0));
          col += tint * b * tw * 0.06 * uNight * horizon;
        }
      } else {
        col = texture2D(tScene, vUv).rgb;
        vec3 p = uCamPos + dir * d;
        vec3 ft = fogTransmittance(uCamPos, p);
        col = col * ft + fogColor(dir) * (1.0 - ft);
      }
      vec4 cl = texture2D(tClouds, vUv);
      // objects nearer than the cloud layer are never covered (avoids half-res bleeding)
      float tIn = 0.0;
      if (uCamPos.y < CLOUD_BASE) tIn = dir.y > 1e-4 ? (CLOUD_BASE - uCamPos.y) / dir.y : 1e9;
      else if (uCamPos.y > CLOUD_TOP) tIn = dir.y < -1e-4 ? (CLOUD_TOP - uCamPos.y) / dir.y : 1e9;
      if (d < tIn) cl = vec4(0.0, 0.0, 0.0, 1.0);
      col = col * cl.a + cl.rgb;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const brightFrag = /* glsl */`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel; uniform float uExposure;
    void main() {
      vec3 c = vec3(0.0);
      c += texture2D(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
      c += texture2D(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb;
      c += texture2D(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
      c += texture2D(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb;
      c *= 0.25 * uExposure;
      c = min(c, vec3(400.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(c * max(l - 1.2, 0.0) / max(l, 1e-4), 1.0);
    }`;
  const blurFrag = /* glsl */`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uDir;
    void main() {
      vec3 c = texture2D(tIn, vUv).rgb * 0.2270270270;
      c += texture2D(tIn, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(tIn, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
      c += texture2D(tIn, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
      c += texture2D(tIn, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`;
  const downFrag = /* glsl */`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel;
    void main() {
      vec3 c = texture2D(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tIn, vUv + uTexel * vec2(1.0, -1.0)).rgb
             + texture2D(tIn, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tIn, vUv + uTexel * vec2(1.0, 1.0)).rgb;
      gl_FragColor = vec4(c * 0.25, 1.0);
    }`;
  const toneFrag = /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tIn, tBloom1, tBloom2;
    uniform float uExposure, uFlash, uNight, uZoom;
    uniform vec2 uRes;
    uniform float uTime;
    vec3 aces(vec3 x) {
      // ACES fitted (S. Hill)
      const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
      const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
      vec3 v = m1 * x;
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return clamp(m2 * (a / b), 0.0, 1.0);
    }
    void main() {
      // radial blur toward the centre: speed sensation when accelerating (0 = off)
      vec3 c;
      if (uZoom > 0.0005) {
        vec2 dv = vUv - 0.5;
        float w = smoothstep(0.05, 0.45, length(dv));
        c = vec3(0.0);
        for (int i = 0; i < 10; i++) c += texture2D(tIn, vUv - dv * (uZoom * w * float(i) / 9.0)).rgb;
        c *= 0.1 * uExposure;
      } else c = texture2D(tIn, vUv).rgb * uExposure;
      c += texture2D(tBloom1, vUv).rgb * 0.10 + texture2D(tBloom2, vUv).rgb * 0.14;
      // night vision: scotopic shift toward desaturated blue
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(c, lum * vec3(0.72, 0.9, 1.3), uNight * 0.65);
      c = aces(c * 1.1);
      // vignette
      vec2 q = vUv - 0.5;
      c *= 1.0 - dot(q, q) * 0.45;
      c = pow(c, vec3(1.0 / 2.2));
      c = mix(c, vec3(1.0), uFlash);
      // film grain dithering (removes banding in the sky)
      float n = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) / 255.0;
      gl_FragColor = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));
    }`;
  const fxaaFrag = /* glsl */`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel;
    void main() {
      // FXAA 3.11-style (luma in alpha)
      float lM = texture2D(tIn, vUv).a;
      float lNW = texture2D(tIn, vUv + vec2(-1.0, -1.0) * uTexel).a;
      float lNE = texture2D(tIn, vUv + vec2(1.0, -1.0) * uTexel).a;
      float lSW = texture2D(tIn, vUv + vec2(-1.0, 1.0) * uTexel).a;
      float lSE = texture2D(tIn, vUv + vec2(1.0, 1.0) * uTexel).a;
      float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
      float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
      vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
      float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
      float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;
      vec3 a = 0.5 * (texture2D(tIn, vUv - dir / 6.0).rgb + texture2D(tIn, vUv + dir / 6.0).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(tIn, vUv - dir * 0.5).rgb + texture2D(tIn, vUv + dir * 0.5).rgb);
      float lB = dot(b, vec3(0.299, 0.587, 0.114));
      gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
    }`;

  function rt(w, h, opts) {
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), Object.assign({ type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }, opts || {}));
  }
  function withDepth(w, h) {
    const dt = new THREE.DepthTexture(w, h);
    dt.type = THREE.FloatType;
    return rt(w, h, { depthBuffer: true, depthTexture: dt });
  }
  function mat(frag, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  }

  function make3D(data, size, channels) {
    const t = new THREE.Data3DTexture(data, size, size, size);
    t.format = channels === 4 ? THREE.RGBAFormat : THREE.RedFormat;
    t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.unpackAlignment = 1;
    t.needsUpdate = true;
    return t;
  }

  P.init = function (r, cloudShape, cloudDetail) {
    renderer = r;
    quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    quadScene = new THREE.Scene();
    quadScene.add(quad);

    const viewU = () => ({ tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() } });
    cloudMat = mat(cloudFrag, Object.assign(viewU(), {
      tShape: { value: make3D(cloudShape, 64, 4) }, tDetail: { value: make3D(cloudDetail, 32, 1) },
      tHistory: { value: null }, uPrevViewProj: { value: new THREE.Matrix4() }, uHistory: { value: 0 }, uFrame: { value: 0 }, uSteps: { value: 64 },
      tSky: { value: ATMO.skyTarget.texture }, uFogDensity: { value: 1 / 26000 },
      uWind: U.uWind, uCoverage: U.uCoverage, uLightDir: U.uCloudLightDir, uLightColor: U.uCloudLight, uTime: U.uTime
    }));
    compMat = mat(compFrag, Object.assign(viewU(), {
      tScene: { value: null }, tClouds: { value: null }, tSky: { value: ATMO.skyTarget.texture }, uFogDensity: { value: 1 / 26000 },
      uSunDir: { value: ATMO.sunDir }, uSunColor: { value: ATMO.sunColor }, uMoonDir: { value: ATMO.moonDir }, uMoonColor: { value: ATMO.moonColor },
      uStarRot: { value: 0 }, uNight: U.uNight, uTime: U.uTime
    }));
    brightMat = mat(brightFrag, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uExposure: { value: 1 } });
    blurMat = mat(blurFrag, { tIn: { value: null }, uDir: { value: new THREE.Vector2() } });
    downMat = mat(downFrag, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
    toneMat = mat(toneFrag, { tIn: { value: null }, tBloom1: { value: null }, tBloom2: { value: null }, uExposure: { value: 1 }, uFlash: { value: 0 }, uNight: U.uNight, uZoom: { value: 0 }, uRes: { value: new THREE.Vector2() }, uTime: U.uTime });
    copyMat = mat('varying vec2 vUv; uniform sampler2D tIn; void main(){ gl_FragColor = texture2D(tIn, vUv); }', { tIn: { value: null } });
    fxaaMat = mat(fxaaFrag, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } });
    P.resize();
  };

  P.setQuality = function (q) {
    P.quality = q;
    P.scale = [0.6, 0.8, 1.0][q];
    P.resize();
  };

  P.resize = function () {
    const w = Math.round(window.innerWidth * P.scale), h = Math.round(window.innerHeight * P.scale);
    const all = [overRT, mainRT, reflRT, reflOut, cloudA, cloudB, cloudRefl, hdrRT, ldrRT, bloomA, bloomB, bloomC, bloomD];
    for (const t of all) if (t) { if (t.depthTexture && t !== overRT) t.depthTexture.dispose(); t.dispose(); }
    mainRT = withDepth(w, h);
    const rw = Math.round(w / 2), rh = Math.round(h / 2);
    reflRT = withDepth(rw, rh);
    reflOut = rt(rw, rh);
    cloudA = rt(Math.round(w / 2), Math.round(h / 2));
    cloudB = rt(Math.round(w / 2), Math.round(h / 2));
    cloudRefl = rt(Math.round(rw / 2), Math.round(rh / 2));
    hdrRT = rt(w, h);
    // overlay target: shares the scene depth so transparent effects (contrails, glows) are depth tested
    overRT = rt(w, h, { depthBuffer: true, depthTexture: mainRT.depthTexture });
    ldrRT = rt(w, h, { type: THREE.UnsignedByteType });
    bloomA = rt(Math.round(w / 4), Math.round(h / 4));
    bloomB = rt(Math.round(w / 4), Math.round(h / 4));
    bloomC = rt(Math.round(w / 8), Math.round(h / 8));
    bloomD = rt(Math.round(w / 8), Math.round(h / 8));
    hasHistory = false;
    P.width = w; P.height = h;
  };

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  function setView(m, cam, depthTex) {
    m.uniforms.tDepth.value = depthTex;
    m.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse);
    m.uniforms.uCamWorld.value.copy(cam.matrixWorld);
    m.uniforms.uCamPos.value.copy(cam.position);
  }

  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.0);
  const curViewProj = new THREE.Matrix4();

  // Renders one complete frame
  P.render = function (scene, overlayScene, camera, hide, flash) {
    frame++;
    const reflCam = WATER.reflCamera;
    const steps = [40, 56, 72][P.quality];

    // shadows: computed once (during the reflection pass), reused for the main pass
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    // 1. reflection
    WATER.mesh.visible = false;
    for (const o of hide.refl) o.visible = false;
    TERRAIN.meshMain.visible = false; TERRAIN.meshRefl.visible = true;
    renderer.clippingPlanes = [clipPlane];
    renderer.setRenderTarget(reflRT);
    renderer.clear();
    renderer.render(scene, reflCam);
    renderer.clippingPlanes = [];
    for (const o of hide.refl) o.visible = true;

    setView(cloudMat, reflCam, reflRT.depthTexture);
    cloudMat.uniforms.uHistory.value = 0;
    cloudMat.uniforms.uSteps.value = Math.round(steps / 2);
    cloudMat.uniforms.uFrame.value = frame % 64;
    pass(cloudMat, cloudRefl);
    setView(compMat, reflCam, reflRT.depthTexture);
    compMat.uniforms.tScene.value = reflRT.texture;
    compMat.uniforms.tClouds.value = cloudRefl.texture;
    compMat.uniforms.uStarRot.value = ATMO.starRot;
    pass(compMat, reflOut);

    // 2. main scene
    WATER.mesh.visible = true;
    WATER.uniforms.tRefl.value = reflOut.texture;
    TERRAIN.meshMain.visible = true; TERRAIN.meshRefl.visible = false;
    renderer.setRenderTarget(mainRT);
    renderer.clear();
    renderer.render(scene, camera);

    // 3. clouds (temporal)
    const cur = frame % 2 ? cloudA : cloudB, prev = frame % 2 ? cloudB : cloudA;
    setView(cloudMat, camera, mainRT.depthTexture);
    cloudMat.uniforms.tHistory.value = prev.texture;
    cloudMat.uniforms.uHistory.value = hasHistory ? 0.85 : 0;
    cloudMat.uniforms.uPrevViewProj.value.copy(prevViewProj);
    cloudMat.uniforms.uSteps.value = steps;
    pass(cloudMat, cur);
    curViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    prevViewProj.copy(curViewProj);
    hasHistory = true;

    // 4. atmosphere composite
    setView(compMat, camera, mainRT.depthTexture);
    compMat.uniforms.tScene.value = mainRT.texture;
    compMat.uniforms.tClouds.value = cur.texture;
    pass(compMat, hdrRT);

    // 4b. overlay (contrails, navigation lights, engine glow) on top of the atmosphere
    copyMat.uniforms.tIn.value = hdrRT.texture;
    pass(copyMat, overRT);
    renderer.autoClear = false;
    renderer.setRenderTarget(overRT);
    renderer.render(overlayScene, camera);
    renderer.autoClear = true;

    // 5. bloom
    brightMat.uniforms.tIn.value = overRT.texture;
    brightMat.uniforms.uTexel.value.set(1 / P.width, 1 / P.height);
    brightMat.uniforms.uExposure.value = ATMO.exposure;
    pass(brightMat, bloomA);
    blurMat.uniforms.tIn.value = bloomA.texture; blurMat.uniforms.uDir.value.set(1 / bloomA.width, 0); pass(blurMat, bloomB);
    blurMat.uniforms.tIn.value = bloomB.texture; blurMat.uniforms.uDir.value.set(0, 1 / bloomA.height); pass(blurMat, bloomA);
    downMat.uniforms.tIn.value = bloomA.texture; downMat.uniforms.uTexel.value.set(1 / bloomA.width, 1 / bloomA.height); pass(downMat, bloomC);
    blurMat.uniforms.tIn.value = bloomC.texture; blurMat.uniforms.uDir.value.set(1 / bloomC.width, 0); pass(blurMat, bloomD);
    blurMat.uniforms.tIn.value = bloomD.texture; blurMat.uniforms.uDir.value.set(0, 1 / bloomC.height); pass(blurMat, bloomC);
    blurMat.uniforms.tIn.value = bloomC.texture; blurMat.uniforms.uDir.value.set(2 / bloomC.width, 0); pass(blurMat, bloomD);
    blurMat.uniforms.tIn.value = bloomD.texture; blurMat.uniforms.uDir.value.set(0, 2 / bloomC.height); pass(blurMat, bloomC);

    // 6. tone mapping + FXAA
    toneMat.uniforms.tIn.value = overRT.texture;
    toneMat.uniforms.tBloom1.value = bloomA.texture;
    toneMat.uniforms.tBloom2.value = bloomC.texture;
    toneMat.uniforms.uExposure.value = ATMO.exposure;
    toneMat.uniforms.uFlash.value = flash || 0;
    toneMat.uniforms.uZoom.value = window.FX ? FX.speedFx * 0.045 : 0;
    pass(toneMat, ldrRT);
    fxaaMat.uniforms.tIn.value = ldrRT.texture;
    fxaaMat.uniforms.uTexel.value.set(1 / P.width, 1 / P.height);
    pass(fxaaMat, null);
  };

  P.resetHistory = function () { hasHistory = false; };
  P.debugTargets = function () { return { cloudA, cloudB, hdrRT, mainRT, reflOut }; };
  window.POST = P;
})();
