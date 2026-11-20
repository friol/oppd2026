// water.js - sea and lakes at y = 0: planar reflection (mirror camera), procedural
// non-repeating waves (rotated gradient noise octaves + domain warp), depth based
// colour and transparency from the heightmap, shore foam, sun glitter.
(function () {
  'use strict';
  const U = GLSL.U;
  const Wt = { mesh: null, reflCamera: new THREE.PerspectiveCamera(), textureMatrix: new THREE.Matrix4() };

  const vert = /* glsl */`
    uniform mat4 uReflMatrix;
    varying vec3 vWorld;
    varying vec4 vReflUv;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vReflUv = uReflMatrix * wp;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const frag = /* glsl */`
    precision highp float;
    uniform sampler2D tRefl;
    uniform float uTime;
    uniform vec3 uLightColor;
    uniform vec3 uSunDir;
    uniform float uPixelAngle;
    uniform vec3 uAmbient;
    uniform mat4 uProj;
    varying vec3 vWorld;
    varying vec4 vReflUv;
    ${GLSL.common}
    ${GLSL.terrain}
    ${GLSL.weather}
    ${GLSL.cloudShadow}

    // Sum of rotated, drifting gradient-noise octaves. Returns the slope (dh/dx, dh/dz).
    vec2 waveSlope(vec2 p, float footprint, float calm) {
      // large scale domain warp breaks any visible regularity
      vec2 w = vec2(vnoise2(p / 520.0 + uTime * 0.004), vnoise2(p / 520.0 + vec2(7.3, 2.1) - uTime * 0.005));
      p += (w - 0.5) * 140.0;
      vec2 slope = vec2(0.0);
      float amp = mix(1.6, 0.6, calm), wl = 40.0;
      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float a = fi * 2.399 + 0.4;            // golden angle between octaves
        float c = cos(a), s = sin(a);
        vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        float speed = sqrt(9.81 * wl / 6.2832); // deep water dispersion
        vec4 n = noised3(vec3(q / wl + vec2(uTime * speed / wl, 0.0), uTime * 0.07 + fi * 3.7));
        vec2 g = n.yz / wl;                    // derivative w.r.t. q
        g = vec2(c * g.x + s * g.y, -s * g.x + c * g.y); // back to world axes
        float fade = smoothstep(footprint * 2.0, footprint * 6.0, wl);
        slope += g * amp * fade;
        amp *= 0.56; wl *= 0.52;
      }
      return slope;
    }

    void main() {
      vec3 P = vWorld;
      vec3 V = cameraPosition - P;
      float dist = length(V);
      V /= dist;
      float ground = terrainHeight(P.xz);
      float depth = max(0.0, -ground);
      if (depth < 0.02) discard;
      // lakes (enclosed, shallow) are calmer than the open sea
      float calm = smoothstep(12.0, 2.0, depth) * 0.5;
      float footprint = dist * uPixelAngle / max(0.15, V.y);
      vec2 sl = waveSlope(P.xz, footprint, calm);
      vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));

      // reflection (planar, distorted by the wave normal)
      vec2 ruv = vReflUv.xy / vReflUv.w;
      ruv += N.xz * 0.16 / (1.0 + dist * 0.0025);
      vec3 refl = texture2D(tRefl, ruv).rgb;

      float cosV = max(dot(N, V), 0.0);
      float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);

      // water body: absorption from depth, lit by sky + sun
      float sh = cloudShadowAt(P);
      vec3 L = uLightDir;
      vec3 deep = vec3(0.004, 0.018, 0.028), shallow = vec3(0.03, 0.10, 0.09);
      vec3 body = mix(shallow, deep, 1.0 - exp(-depth / 7.0));
      vec3 lit = uAmbient * 0.9 + uLightColor * max(L.y, 0.0) * 0.12 * sh;
      vec3 col = body * lit;

      // sun glitter (GGX-like lobe on the wave normal)
      vec3 H = normalize(L + V);
      float nh = max(dot(N, H), 0.0);
      float r2 = 0.012 + footprint * 0.0004;
      float D = r2 / (3.14159 * pow(nh * nh * (r2 - 1.0) + 1.0, 2.0));
      vec3 spec = uLightColor * D * fres * 0.25 * sh * smoothstep(-0.02, 0.05, L.y);

      col = mix(col, refl, fres) + spec;

      // foam along the shores
      float foamN = vnoise2(P.xz / 3.0 + uTime * 0.3) * vnoise2(P.xz / 11.0 - uTime * 0.1);
      float foam = smoothstep(0.9, 0.0, depth) * smoothstep(0.15, 0.4, foamN + 0.5 * (0.9 - depth));
      col = mix(col, (uAmbient + uLightColor * max(L.y, 0.0) * 0.3 * sh) * 0.45, foam * 0.7);

      // shallow water lets the sea bed through
      float alpha = mix(1.0 - exp(-depth * 1.1), 1.0, fres);
      alpha = max(alpha, foam * 0.7);
      // fade out right at the waterline, where the water plane meets the ground (no z-fighting)
      alpha *= smoothstep(0.0, 0.45, depth);
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      // The shoreline is decided by the exact heightmap depth above (discard + fade), not by the
      // depth test against the LOD terrain mesh, whose shape near the waterline changes as it
      // morphs. Write a depth pulled slightly toward the camera so the water wins over
      // nearly coplanar ground.
      vec3 Pp = P + V * (2.5 + dist * 0.004);
      vec4 clip = uProj * viewMatrix * vec4(Pp, 1.0);
      gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);
    }
  `;

  Wt.init = function (scene) {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    Wt.uniforms = {
      tRefl: { value: null },
      uReflMatrix: { value: Wt.textureMatrix },
      uTime: U.uTime,
      uLightColor: U.uLightColor,
      uLightDir: U.uLightDir,
      uSunDir: U.uSunDir,
      uWind: U.uWind,
      uCoverage: U.uCoverage,
      tHeight: U.tHeight,
      tNormal: U.tNormal,
      uPixelAngle: { value: 0.001 },
      uProj: { value: new THREE.Matrix4() },
      uAmbient: { value: new THREE.Color(0.5, 0.6, 0.8) }
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: Wt.uniforms, transparent: true, depthWrite: true });
    Wt.mesh = new THREE.Mesh(geo, mat);
    Wt.mesh.scale.set(400000, 1, 400000);
    Wt.mesh.frustumCulled = false;
    Wt.mesh.renderOrder = 10;
    scene.add(Wt.mesh);
  };

  // Mirror camera for the planar reflection (plane y = 0)
  const tmp = new THREE.Vector3(), look = new THREE.Vector3();
  Wt.updateReflection = function (camera) {
    const rc = Wt.reflCamera;
    camera.updateMatrixWorld();
    rc.position.set(camera.position.x, -camera.position.y, camera.position.z);
    camera.getWorldDirection(tmp);
    look.copy(camera.position).add(tmp);
    look.y = -look.y;
    tmp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    rc.up.set(tmp.x, -tmp.y, tmp.z);
    rc.lookAt(look);
    rc.near = camera.near; rc.far = camera.far; rc.fov = camera.fov; rc.aspect = camera.aspect;
    rc.updateProjectionMatrix();
    rc.updateMatrixWorld();
    rc.matrixWorldInverse.copy(rc.matrixWorld).invert();
    Wt.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    Wt.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    Wt.mesh.position.set(camera.position.x, 0, camera.position.z);
    Wt.uniforms.uProj.value.copy(camera.projectionMatrix);
    Wt.uniforms.uPixelAngle.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, window.innerHeight);
  };

  window.WATER = Wt;
})();
