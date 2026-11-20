// shaders.js - shared GLSL chunks (noise, terrain lookup, cloud weather) and the
// shared uniform objects that every custom material references.
(function () {
  'use strict';

  // Uniforms shared by reference across all materials (updated once per frame)
  const U = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2() },        // cloud drift offset (m)
    uCoverage: { value: 0.45 },                    // cloud coverage 0..1
    uLightDir: { value: new THREE.Vector3(0, 1, 0) }, // main light (sun by day, moon by night)
    uLightColor: { value: new THREE.Color(1, 1, 1) },
    uCloudLight: { value: new THREE.Color(1, 1, 1) },     // light on the cloud layer
    uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 },                          // 0 = day, 1 = night (window lights)
    tHeight: { value: null },                      // float heightmap
    tNormal: { value: null }                       // normal xz + forest + fields
  };

  const common = /* glsl */`
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
    vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
    float vnoise2(vec2 p) {
      vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
    }
    // value noise with analytic derivatives: (value, d/dx, d/dy)
    vec3 vnoised2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3. - 2. * f), du = 6. * f * (1. - f);
      float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
      return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
                  du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
    }
    // 3D gradient noise with analytic derivatives (after I. Quilez): (value, gradient)
    vec4 noised3(vec3 x) {
      vec3 i = floor(x), f = fract(x);
      vec3 u = f * f * f * (f * (f * 6. - 15.) + 10.);
      vec3 du = 30. * f * f * (f * (f - 2.) + 1.);
      vec3 ga = hash33(i) * 2. - 1.;
      vec3 gb = hash33(i + vec3(1, 0, 0)) * 2. - 1.;
      vec3 gc = hash33(i + vec3(0, 1, 0)) * 2. - 1.;
      vec3 gd = hash33(i + vec3(1, 1, 0)) * 2. - 1.;
      vec3 ge = hash33(i + vec3(0, 0, 1)) * 2. - 1.;
      vec3 gf = hash33(i + vec3(1, 0, 1)) * 2. - 1.;
      vec3 gg = hash33(i + vec3(0, 1, 1)) * 2. - 1.;
      vec3 gh = hash33(i + vec3(1, 1, 1)) * 2. - 1.;
      float va = dot(ga, f);
      float vb = dot(gb, f - vec3(1, 0, 0));
      float vc = dot(gc, f - vec3(0, 1, 0));
      float vd = dot(gd, f - vec3(1, 1, 0));
      float ve = dot(ge, f - vec3(0, 0, 1));
      float vf = dot(gf, f - vec3(1, 0, 1));
      float vg = dot(gg, f - vec3(0, 1, 1));
      float vh = dot(gh, f - vec3(1, 1, 1));
      return vec4(va + u.x * (vb - va) + u.y * (vc - va) + u.z * (ve - va) + u.x * u.y * (va - vb - vc + vd)
                  + u.y * u.z * (va - vc - ve + vg) + u.z * u.x * (va - vb - ve + vf) + (-va + vb + vc - vd + ve - vf - vg + vh) * u.x * u.y * u.z,
                  ga + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga) + u.x * u.y * (ga - gb - gc + gd) + u.y * u.z * (ga - gc - ge + gg)
                  + u.z * u.x * (ga - gb - ge + gf) + (-ga + gb + gc - gd + ge - gf - gg + gh) * u.x * u.y * u.z
                  + du * (vec3(vb, vc, ve) - va + u.yzx * vec3(va - vb - vc + vd, va - vc - ve + vg, va - vb - ve + vf)
                  + u.zxy * vec3(va - vb - ve + vf, va - vb - vc + vd, va - vc - ve + vg) + u.yzx * u.zxy * (-va + vb + vc - vd + ve - vf - vg + vh)));
    }
  `;

  // Terrain lookup (heightmap is a float texture, filtered by hand)
  const terrain = /* glsl */`
    uniform highp sampler2D tHeight;
    uniform sampler2D tNormal;
    const float W_N = ${WORLD.N}.0;
    const float W_CELL = ${WORLD.CELL}.0;
    const float W_HALF = ${WORLD.HALF}.0;
    float terrainHeight(vec2 xz) {
      vec2 f = (xz + W_HALF) / W_CELL;
      if (f.x < 0. || f.y < 0. || f.x >= W_N - 1. || f.y >= W_N - 1.) return -120.;
      vec2 i = floor(f), t = f - i;
      ivec2 c = ivec2(i);
      float a = texelFetch(tHeight, c, 0).r, b = texelFetch(tHeight, c + ivec2(1, 0), 0).r;
      float d = texelFetch(tHeight, c + ivec2(0, 1), 0).r, e = texelFetch(tHeight, c + ivec2(1, 1), 0).r;
      return mix(mix(a, b, t.x), mix(d, e, t.x), t.y);
    }
    vec2 terrainUv(vec2 xz) { return ((xz + W_HALF) / W_CELL + 0.5) / W_N; }
  `;

  // Cloud weather: 2D coverage map used by the volumetric clouds and the cloud shadows
  const weather = /* glsl */`
    uniform vec2 uWind;
    uniform float uCoverage;
    const float CLOUD_BASE = 1500.0;
    const float CLOUD_TOP = 4200.0;
    float cloudCoverage(vec2 xz) {
      vec2 p = (xz + uWind) / 11000.0;
      float n = vnoise2(p) * 0.5 + vnoise2(p * 2.03 + 5.2) * 0.25 + vnoise2(p * 4.07 + 1.7) * 0.125 + vnoise2(p * 8.3 + 9.1) * 0.0625;
      n /= 0.9375;
      return smoothstep(1.0 - uCoverage - 0.1, 1.0 - uCoverage + 0.25, n);
    }
  `;

  const cloudShadow = /* glsl */`
    uniform vec3 uLightDir;
    float cloudShadowAt(vec3 wp) {
      float t = (CLOUD_BASE + 600.0 - wp.y) / max(uLightDir.y, 0.08);
      vec2 p = wp.xz + uLightDir.xz * max(t, 0.0);
      return 1.0 - 0.8 * smoothstep(0.15, 0.7, cloudCoverage(p));
    }
  `;

  // Adds the cloud shadow to the direct light of a built-in (standard) material.
  // Requires the material to expose a world position varying (added here).
  // Pass vertex = false when the caller already writes `vWorldPos` itself.
  function addCloudShadow(shader, vertex) {
    shader.uniforms.uWind = U.uWind;
    shader.uniforms.uCoverage = U.uCoverage;
    shader.uniforms.uLightDir = U.uLightDir;
    if (vertex === false) {
      shader.fragmentShader = 'varying vec3 vWorldPos;\n' + shader.fragmentShader;
    } else {
      shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader.replace('#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 wpCs = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           wpCs = instanceMatrix * wpCs;
         #endif
         vWorldPos = (modelMatrix * wpCs).xyz;`);
      shader.fragmentShader = 'varying vec3 vWorldPos;\n' + shader.fragmentShader;
    }
    const hasCommon = shader.fragmentShader.indexOf('float hash12(') >= 0;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', (hasCommon ? '' : common) + weather + cloudShadow + '\nvoid main() {')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float cShadow = cloudShadowAt(vWorldPos);
        reflectedLight.directDiffuse *= cShadow;
        reflectedLight.directSpecular *= cShadow;`);
  }

  window.GLSL = { U, common, terrain, weather, cloudShadow, addCloudShadow };
})();
