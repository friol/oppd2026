// atmosphere.js - day/night cycle (sun + moon), physically based sky LUT
// (single scattering, Rayleigh + Mie), lights and image based lighting.
(function () {
  'use strict';
  const U = GLSL.U;

  const SUN_E = 20.0;          // sun illuminance at the top of the atmosphere (scene units)
  const MOON_E = 0.16;         // moon "illuminance" (artistic, brighter than real so nights stay readable)
  const BR = new THREE.Vector3(5.8e-6, 13.5e-6, 33.1e-6); // Rayleigh scattering
  const BM = 21e-6;                                         // Mie scattering

  const A = {
    hours: 9.5,          // time of day 0..24
    daySpeed: 60,        // game seconds per real second (24 min per day)
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),   // transmitted sun illuminance
    cloudLight: new THREE.Color(), // light reaching the cloud layer (sees the sun a little longer)
    moonColor: new THREE.Color(),
    night: 0,             // 0 day .. 1 full night
    exposure: 1,
    skyTarget: null,
    envTarget: null,
    starRot: 0
  };

  // Sun direction for a given hour (latitude ~44 N, late spring)
  function sunDirection(h, out) {
    const lat = 44 * Math.PI / 180, decl = 16 * Math.PI / 180;
    const ha = (h - 12) / 24 * Math.PI * 2;
    const el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha));
    let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)); // from south, westwards
    // world: -Z = north, +X = east. azimuth measured from south toward west
    const x = -Math.sin(az) * Math.cos(el), z = Math.cos(az) * Math.cos(el), y = Math.sin(el);
    return out.set(x, y, z).normalize();
  }

  // Transmittance through the atmosphere for a direction with elevation sin(el) = mu
  function transmittance(mu, out) {
    const el = Math.asin(Math.max(-1, Math.min(1, mu))) * 180 / Math.PI;
    if (el < -1.5) return out.setRGB(0, 0, 0);
    // relative air mass (Kasten-Young), Mie with a smaller scale height
    const m = 1 / (Math.sin(Math.max(el, -1) * Math.PI / 180 + 1e-4) + 0.50572 * Math.pow(Math.max(el, -1) + 6.07995, -1.6364));
    const mm = Math.min(m, 60);
    const r = Math.exp(-(BR.x * 8000 * mm + BM * 1.1 * 1200 * mm));
    const g = Math.exp(-(BR.y * 8000 * mm + BM * 1.1 * 1200 * mm));
    const b = Math.exp(-(BR.z * 8000 * mm + BM * 1.1 * 1200 * mm));
    const fade = Math.min(1, Math.max(0, (el + 1.5) / 2.5)); // sun disc sinking below the horizon
    return out.setRGB(r * fade, g * fade, b * fade);
  }

  // ---- Sky-view LUT (equirectangular, elevation mapped non-linearly) ----
  const skyLutFrag = /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform vec3 uSun, uMoon;
    uniform float uSunE, uMoonE, uAlt;
    const float R0 = 6360e3, RA = 6420e3;
    const vec3 BR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
    const float BM = 21e-6;
    const float PI = 3.14159265;
    vec2 raySphere(vec3 o, vec3 d, float r) {
      float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c;
      if (h < 0.0) return vec2(1e9, -1e9);
      h = sqrt(h); return vec2(-b - h, -b + h);
    }
    void lightDepth(vec3 p, vec3 l, out float dr, out float dm) {
      vec2 tg = raySphere(p, l, R0);
      if (tg.x > 0.0) { dr = 1e9; dm = 1e9; return; }
      float tl = raySphere(p, l, RA).y;
      float ds = tl / 8.0; dr = 0.0; dm = 0.0;
      for (int j = 0; j < 8; j++) {
        float hh = length(p + l * ds * (float(j) + 0.5)) - R0;
        dr += exp(-hh / 8000.0) * ds; dm += exp(-hh / 1200.0) * ds;
      }
    }
    vec3 scatter(vec3 o, vec3 d, float tmax, vec3 l, float E) {
      float mu = dot(d, l);
      float pr = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
      float g = 0.76;
      float pm = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
      const int STEPS = 32;
      float ds = tmax / float(STEPS);
      float odr = 0.0, odm = 0.0;
      vec3 sr = vec3(0), sm = vec3(0);
      for (int i = 0; i < STEPS; i++) {
        vec3 p = o + d * ds * (float(i) + 0.5);
        float hh = length(p) - R0;
        float hr = exp(-hh / 8000.0) * ds, hm = exp(-hh / 1200.0) * ds;
        odr += hr; odm += hm;
        float lr, lm; lightDepth(p, l, lr, lm);
        if (lr > 1e8) continue;
        vec3 tau = BR * (odr + lr) + BM * 1.1 * (odm + lm);
        vec3 at = exp(-tau);
        sr += hr * at; sm += hm * at;
      }
      return E * (sr * BR * pr + sm * BM * pm);
    }
    void main() {
      float az = (vUv.x - 0.5) * 2.0 * PI;
      float v = vUv.y * 2.0 - 1.0;
      float el = sign(v) * v * v * PI * 0.5;
      vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
      vec3 o = vec3(0.0, R0 + max(uAlt, 1.0), 0.0);
      float tmax = raySphere(o, d, RA).y;
      vec2 tg = raySphere(o, d, R0);
      if (tg.x > 0.0) tmax = min(tmax, tg.x);
      vec3 col = scatter(o, d, tmax, uSun, uSunE);
      if (uMoon.y > -0.1) col += scatter(o, d, tmax, uMoon, uMoonE) * vec3(0.9, 0.95, 1.1);
      col += vec3(0.0012, 0.0018, 0.0034); // airglow / light pollution floor
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // GLSL helper to read the LUT (shared with clouds/composite/sky dome)
  A.lutGLSL = /* glsl */`
    uniform sampler2D tSky;
    vec3 skyLut(vec3 d) {
      float az = atan(d.z, d.x);
      float el = asin(clamp(d.y, -1.0, 1.0));
      float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / 1.5707963);
      return texture2D(tSky, vec2(az / 6.2831853 + 0.5, v)).rgb;
    }
  `;

  let lutScene, lutCam, lutMat, envScene, envMat, pmrem, envTimer = 999;

  A.init = function (renderer) {
    A.skyTarget = new THREE.WebGLRenderTarget(256, 128, { type: THREE.HalfFloatType, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, depthBuffer: false });
    A.skyTarget.texture.wrapS = THREE.RepeatWrapping;
    lutMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: skyLutFrag,
      uniforms: { uSun: { value: A.sunDir }, uMoon: { value: A.moonDir }, uSunE: { value: SUN_E }, uMoonE: { value: MOON_E }, uAlt: { value: 0 } },
      depthTest: false, depthWrite: false
    });
    lutScene = new THREE.Scene();
    lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), lutMat));
    lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Sky dome used only to build the environment map (image based lighting)
    envMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { tSky: { value: A.skyTarget.texture }, uSun: { value: A.sunDir }, uSunColor: { value: A.sunColor } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: A.lutGLSL + `
        varying vec3 vDir; uniform vec3 uSun; uniform vec3 uSunColor;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = skyLut(vec3(d.x, max(d.y, 0.0), d.z));
          // ground hemisphere: dim bounce light tinted by the terrain
          if (d.y < 0.0) c = mix(c, (skyLut(vec3(0.0, 1.0, 0.0)) * 0.6 + uSunColor * max(uSun.y, 0.0) * 0.05) * vec3(0.32, 0.36, 0.25), smoothstep(0.0, -0.15, d.y));
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), envMat));
    pmrem = new THREE.PMREMGenerator(renderer);
  };

  const tmpC = new THREE.Color();
  A.update = function (dt, renderer, scene, camAlt) {
    A.hours = (A.hours + dt * A.daySpeed / 3600) % 24;
    sunDirection(A.hours, A.sunDir);
    // moon: roughly opposite to the sun, offset so it is often visible at dusk and dawn
    sunDirection((A.hours + 11.2) % 24, A.moonDir);
    A.moonDir.y = A.moonDir.y * 0.9 + 0.08; A.moonDir.normalize();
    A.starRot = (A.hours / 24) * Math.PI * 2;

    transmittance(A.sunDir.y, tmpC);
    A.sunColor.setRGB(tmpC.r * SUN_E, tmpC.g * SUN_E, tmpC.b * SUN_E);
    const sunEl = A.sunDir.y;
    // the moon fades in only once the sun is gone (no pop when the main light switches)
    const moonFade = THREE.MathUtils.smoothstep(-sunEl, 0.03, 0.12);
    transmittance(A.moonDir.y, tmpC);
    A.moonColor.setRGB(tmpC.r * MOON_E * 0.85 * moonFade, tmpC.g * MOON_E * 0.95 * moonFade, tmpC.b * MOON_E * 1.15 * moonFade);

    A.night = 1 - THREE.MathUtils.smoothstep(sunEl, -0.16, 0.02);
    const day = THREE.MathUtils.smoothstep(sunEl, -0.14, 0.2);
    // exposure: interpolated in log space, bright day -> twilight -> moonlit night
    A.exposure = Math.exp(Math.log(10) + (Math.log(0.55) - Math.log(10)) * day);

    // main light: the sun, then the moon at night
    const useMoon = sunEl < -0.06;
    U.uLightDir.value.copy(useMoon ? A.moonDir : A.sunDir);
    U.uLightColor.value.copy(useMoon ? A.moonColor : A.sunColor);
    // clouds, 2-4 km up, keep catching the sun after it has set on the ground
    if (useMoon && sunEl < -0.09) A.cloudLight.copy(A.moonColor);
    else {
      transmittance(Math.sin(Math.asin(Math.max(-1, Math.min(1, sunEl))) + 0.045), tmpC);
      A.cloudLight.setRGB(tmpC.r * SUN_E, tmpC.g * SUN_E, tmpC.b * SUN_E);
    }
    U.uCloudLight.value.copy(A.cloudLight);
    U.uCloudLightDir.value.copy(useMoon && sunEl < -0.09 ? A.moonDir : A.sunDir);
    U.uSunDir.value.copy(A.sunDir);
    U.uNight.value = A.night;

    lutMat.uniforms.uAlt.value = Math.max(0, camAlt);
    renderer.setRenderTarget(A.skyTarget);
    renderer.render(lutScene, lutCam);
    renderer.setRenderTarget(null);

    // refresh the IBL every so often (cost: a cube render + filtering)
    envTimer += dt * Math.max(1, A.daySpeed / 60);
    if (envTimer > 1.5) {
      envTimer = 0;
      const old = A.envTarget;
      A.envTarget = pmrem.fromScene(envScene, 0, 0.1, 100);
      scene.environment = A.envTarget.texture;
      if (old) old.dispose();
    }
  };

  A.forceEnvUpdate = function () { envTimer = 999; };
  A.SUN_E = SUN_E;
  window.ATMO = A;
})();
