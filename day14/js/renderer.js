'use strict';
// WebGL2 renderer: the scene is drawn into a low-resolution framebuffer
// (texture-array world geometry, baked lightmap + dynamic point lights, fog,
// billboard sprites, night sky, ordered-dither colour quantisation), plus a
// mirrored pass for water/lava reflections. Surfaces get relief from their own
// texture (bump from luminance, lit by dynamic lights and by the lightmap
// gradient). Screen-space ambient occlusion and a bloom of bright pixels are
// computed from the scene's depth and colour. A final full-screen pass at
// display resolution upscales without smoothing, applies AO and bloom,
// composites the 2D overlay (weapon, HUD flashes, map) and applies screen
// effects (CRT, aberration, heat haze).
const Renderer = (() => {
  const MAXL = 16;
  let gl, canvas, progWorld, progSprite, progSky, progPost, progDust, progAO, progBright, progBlur, dustBuf, vaoDust;
  let aoT = null, bloomA = null, bloomB = null;
  const NEAR = 0.04, FAR = 80;
  let texArray, texAtlas, texLight, texSky, texOver, texDummy;
  let scene = null, refl = null, sw = 1, sh = 1;
  let staticBuf, staticCount = 0, dynBuf, spriteBuf, spriteIdx, vaoWorld, vaoDyn, vaoSprite, vaoSky;
  let mapW = 1, mapH = 1;
  const MAX_SPRITES = 4096;

  const COMMON = `
    uniform vec3 uFogCol; uniform float uFogDen, uLowFog; uniform vec3 uCam;
    float bayer(vec2 p){
      int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
      int i = x + y * 4;
      float b[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
      return b[i] / 16.0;
    }
    vec3 retro(vec3 c){
      float d = bayer(gl_FragCoord.xy) - 0.5;
      return floor(c * 20.0 + d + 0.5) / 20.0;
    }
    // Distance fog, plus a low mist that pools near the floor (uLowFog per level).
    vec3 fog(vec3 c, vec3 p){
      float d = length(p - uCam);
      vec3 r = mix(uFogCol, c, exp(-d * uFogDen));
      float h = clamp((0.5 - p.y) / 0.8, 0.0, 1.0);
      float lf = uLowFog * h * h * (1.0 - exp(-d * 0.3));
      return mix(r, uFogCol * 1.8 + vec3(0.035, 0.04, 0.045), lf);
    }
    // Water surface: a few travelling waves plus rings from footsteps (uRip: x, z, age, strength).
    uniform vec4 uRip[4];
    float waveH(vec2 p, float t){
      float h = 0.012 * sin(p.x * 3.1 + t * 1.6) + 0.01 * sin(p.y * 3.7 - t * 1.3) + 0.006 * sin((p.x + p.y) * 6.3 + t * 2.4);
      for (int i = 0; i < 4; i++) {
        float age = uRip[i].z, r = length(p - uRip[i].xy);
        if (uRip[i].w <= 0.0 || r > age * 1.1 + 0.2) continue;
        h += uRip[i].w * 0.02 * sin(r * 22.0 - age * 9.0) * exp(-age * 1.4) * exp(-r * 1.2);
      }
      return h;
    }
  `;

  const WORLD_VS = `#version 300 es
    layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv; layout(location=2) in float aLayer;
    layout(location=3) in float aShade; layout(location=4) in vec3 aNrm;
    uniform mat4 uVP;
    out vec3 vPos; out vec2 vUv; flat out float vLayer; out float vShade; out vec3 vNrm;
    uniform float uTime;
    uniform vec4 uRip[4];
    float waveH(vec2 p, float t);
    void main(){
      vec3 p = aPos;
      if (floor(aLayer / 256.0 + 0.001) == 2.0 && aNrm.y > 0.5) p.y += waveH(p.xz, uTime);
      vPos=p; vUv=aUv; vLayer=aLayer; vShade=aShade; vNrm=aNrm; gl_Position=uVP*vec4(p,1.0);
    }
    float waveH(vec2 p, float t){
      float h = 0.012 * sin(p.x * 3.1 + t * 1.6) + 0.01 * sin(p.y * 3.7 - t * 1.3) + 0.006 * sin((p.x + p.y) * 6.3 + t * 2.4);
      for (int i = 0; i < 4; i++) {
        float age = uRip[i].z, r = length(p - uRip[i].xy);
        if (uRip[i].w <= 0.0 || r > age * 1.1 + 0.2) continue;
        h += uRip[i].w * 0.02 * sin(r * 22.0 - age * 9.0) * exp(-age * 1.4) * exp(-r * 1.2);
      }
      return h;
    }`;
  const WORLD_FS = `#version 300 es
    precision highp float; precision highp sampler2DArray;
    in vec3 vPos; in vec2 vUv; flat in float vLayer; in float vShade; in vec3 vNrm;
    uniform sampler2DArray uTex; uniform sampler2D uLM; uniform vec2 uMapSize;
    uniform float uTime, uAmbient, uFlicker, uClip, uReflOn;
    uniform sampler2D uRefl; uniform vec2 uRes;
    uniform int uNL; uniform vec4 uLP[${MAXL}]; uniform vec3 uLC[${MAXL}];
    out vec4 oCol;
    ${COMMON}
    float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
    }
    float lum(vec2 uv, float layer){ return dot(texture(uTex, vec3(uv, layer)).rgb, vec3(0.3, 0.59, 0.11)); }
    float lmLum(vec2 p){ return dot(texture(uLM, p / uMapSize).rgb, vec3(0.333)); }
    void main(){
      vec3 dpx = dFdx(vPos), dpy = dFdy(vPos);
      vec2 dux = dFdx(vUv), duy = dFdy(vUv);
      if (vPos.y < uClip) discard;
      float flag = floor(vLayer / 256.0 + 0.001), layer = vLayer - flag * 256.0;
      vec2 uv = vUv;
      if (flag == 1.0) uv += vec2(sin(uTime*0.7 + uv.y*4.0)*0.06, uTime*0.04 + cos(uTime*0.5 + uv.x*3.0)*0.04);
      else if (flag == 2.0) uv += vec2(uTime*0.05, sin(uTime*1.3 + uv.x*5.0)*0.04);
      else if (flag == 3.0) uv.y -= uTime * 0.9;
      // Banners sway more towards their hem, with moving folds; ivy and vines tremble in a draught.
      float cloth = 1.0;
      if (flag == 9.0) {
        vec2 f = fract(uv);
        float ph = f.y * 5.0 - uTime * 2.2 + (vPos.x + vPos.z) * 1.3, sway = f.y * f.y;
        uv.x += sin(ph) * 0.022 * sway;
        cloth = 1.0 + 0.16 * cos(ph) * sway;
      } else if (flag == 10.0) {
        uv.x += sin(uv.y * 18.0 + uTime * 3.1 + vPos.x * 2.0) * 0.004 + sin(uTime * 0.9 + vPos.z + vPos.x) * 0.003;
      }
      vec4 t = texture(uTex, vec3(uv, layer));
      // Torch: the flame (upper middle of the tile) ripples upwards and flickers.
      float flame = 0.0;
      if (flag == 5.0) {
        vec2 f = fract(uv);
        if (f.x > 0.27 && f.x < 0.75 && f.y < 0.53) {
          float ph = (vPos.x + vPos.z) * 3.7;
          float k = 1.0 - f.y / 0.53;
          vec2 d = vec2(
            sin(f.y * 23.0 - uTime * 9.0 + ph) * 0.022 + sin(f.y * 9.0 - uTime * 4.3 + ph) * 0.012,
            (0.5 + 0.5 * sin(uTime * 6.5 + f.x * 17.0 + ph)) * 0.035) * k;
          vec4 s2 = texture(uTex, vec3(uv + d, layer));
          bool fireT = t.r > 0.45 && t.r > t.b * 1.6;
          bool fireS = s2.r > 0.45 && s2.r > s2.b * 1.6;
          if (fireT || fireS) t = s2;
          if (fireS) flame = 1.0;
        }
      }
      if (t.a < 0.5) discard;
      // Relief: the texture's luminance as a height field, along the surface's
      // texture axes (cotangent frame from screen derivatives).
      vec3 N = normalize(vNrm), nb = N;
      if (flag != 1.0 && flag != 2.0 && flag != 3.0 && flame == 0.0) {
        vec3 p2 = cross(dpy, N), p1 = cross(N, dpx);
        vec3 T = p2 * dux.x + p1 * duy.x, Bt = p2 * dux.y + p1 * duy.y;
        float im = inversesqrt(max(max(dot(T, T), dot(Bt, Bt)), 1e-12));
        const float e = 1.0 / 128.0;
        float hx = lum(uv + vec2(e, 0.0), layer) - lum(uv - vec2(e, 0.0), layer);
        float hy = lum(uv + vec2(0.0, e), layer) - lum(uv - vec2(0.0, e), layer);
        nb = normalize(N - (T * hx + Bt * hy) * im * 2.6);
      }
      if (flag == 2.0 && N.y > 0.5) {
        const float e2 = 0.03;
        float hx = waveH(vPos.xz + vec2(e2, 0.0), uTime) - waveH(vPos.xz - vec2(e2, 0.0), uTime);
        float hz = waveH(vPos.xz + vec2(0.0, e2), uTime) - waveH(vPos.xz - vec2(0.0, e2), uTime);
        nb = normalize(vec3(-hx / (2.0 * e2), 1.0, -hz / (2.0 * e2)));
      }
      vec2 lp = vPos.xz + vNrm.xz * (flag == 6.0 ? 0.3 : 0.04);
      vec3 lm = texture(uLM, lp / uMapSize).rgb * 2.0;
      // Baked light has no direction: take it from the lightmap gradient.
      float gx = lmLum(lp + vec2(0.2, 0.0)) - lmLum(lp - vec2(0.2, 0.0));
      float gz = lmLum(lp + vec2(0.0, 0.2)) - lmLum(lp - vec2(0.0, 0.2));
      vec3 Ld = normalize(vec3(gx * 5.0, 0.45, gz * 5.0));
      float relief = clamp(1.0 + 1.5 * (dot(nb, Ld) - dot(N, Ld)), 0.4, 1.7);
      vec3 dyn = vec3(0.0), spec = vec3(0.0);
      vec3 V = normalize(uCam - vPos);
      float shin = flag == 7.0 ? 28.0 : 70.0, specOn = (flag == 7.0 || flag == 8.0) ? 1.0 : 0.0;
      for (int i = 0; i < ${MAXL}; i++) {
        if (i >= uNL) break;
        vec3 d = uLP[i].xyz - vPos; float dist = length(d);
        float a = clamp(1.0 - dist / uLP[i].w, 0.0, 1.0); a *= a;
        vec3 l = d / max(dist, 1e-3);
        float ndl = max(dot(nb, l), 0.0) * 0.85 + 0.15;
        dyn += uLC[i] * a * ndl;
        if (specOn > 0.0) spec += uLC[i] * a * pow(max(dot(nb, normalize(l + V)), 0.0), shin);
      }
      // Baked light: highlight along the lightmap's light direction.
      if (specOn > 0.0) spec += lm * uFlicker * pow(max(dot(nb, normalize(Ld + V)), 0.0), shin) * 0.8;
      vec3 light = vec3(uAmbient) * (0.85 + 0.15 * relief) + lm * uFlicker * relief + dyn;
      vec3 c = t.rgb * light * vShade * cloth;
      if (flag == 7.0) c += spec * (t.rgb * 1.6 + 0.15) * 1.4;
      if (flag == 8.0) c += spec * vec3(0.75, 0.78, 0.8) * 0.9;
      if (flag == 1.0) {
        // Lava: drifting dark crust over the molten flow, slowly pulsing.
        vec2 q = vPos.xz * 1.3 + vec2(uTime * 0.05, -uTime * 0.035);
        float n = vnoise(q * 1.7) * 0.6 + vnoise(q * 4.1 + 7.0) * 0.4;
        float crust = smoothstep(0.52, 0.66, n);
        float pulse = 1.12 + 0.18 * sin(uTime * 1.7 + vPos.x * 0.8 + vPos.z * 0.6);
        c = mix(t.rgb * pulse, t.rgb * vec3(0.16, 0.08, 0.06), crust * 0.85);
        c += vec3(1.0, 0.45, 0.1) * smoothstep(0.5, 0.52, n) * (1.0 - smoothstep(0.52, 0.56, n)) * 0.5;
      }
      if (flag == 4.0) c = max(c, t.rgb * 0.9);
      // Water and lava mirror the room (rippled), stronger at grazing angles.
      if ((flag == 1.0 || flag == 2.0) && uReflOn > 0.5) {
        vec2 sc = gl_FragCoord.xy / uRes;
        vec2 rip = flag == 2.0 ? nb.xz * 0.06 : vec2(sin(uTime * 1.7 + vPos.z * 7.0 + vPos.x * 2.0), cos(uTime * 1.3 + vPos.x * 6.0 - vPos.z)) * 0.007;
        vec3 rc = texture(uRefl, vec2(sc.x, 1.0 - sc.y) + rip).rgb;
        vec3 v = normalize(uCam - vPos);
        float fres = 0.25 + 0.75 * pow(1.0 - max(v.y, 0.0), 3.0);
        if (flag == 2.0) {
          c = mix(c, rc, 0.75 * fres);
          float glint = pow(max(0.0, sin(vPos.x * 13.0 + uTime * 2.1) * sin(vPos.z * 11.0 - uTime * 1.7)), 30.0);
          c += glint * vec3(0.6, 0.8, 1.0) * (0.25 + length(lm) * 0.5);
        } else {
          c += rc * 0.35 * fres;
        }
      }
      if (flame > 0.0) {
        float ph2 = (vPos.x + vPos.z) * 5.1;
        float fl = 1.2 + 0.18 * sin(uTime * 13.0 + ph2) + 0.1 * sin(uTime * 29.0 + ph2 * 1.7);
        c = t.rgb * fl;
      }
      oCol = vec4(retro(fog(c, vPos)), 1.0);
    }`;

  // Sprite vertex: x y z  u v  r g b a  (9 floats). Tint > 1 brightens.
  const SPRITE_VS = `#version 300 es
    layout(location=0) in vec3 aPos; layout(location=1) in vec2 aUv; layout(location=2) in vec4 aCol;
    uniform mat4 uVP;
    out vec3 vPos; out vec2 vUv; out vec4 vCol;
    void main(){ vPos=aPos; vUv=aUv; vCol=aCol; gl_Position=uVP*vec4(aPos,1.0); }`;
  const SPRITE_FS = `#version 300 es
    precision highp float;
    in vec3 vPos; in vec2 vUv; in vec4 vCol;
    uniform sampler2D uAtlas; uniform float uClip, uSoft;
    out vec4 oCol;
    ${COMMON}
    void main(){
      if (vPos.y < uClip) discard;
      // Two passes: alpha-tested sprites first, soft blended ones (no depth write) after.
      if ((vCol.a < 0.0) != (uSoft > 0.5)) discard;
      vec4 t = texture(uAtlas, vUv);
      // Negative alpha = soft blended sprite (shadows, decals, mist): no alpha test.
      if (vCol.a < 0.0) {
        float a = t.a * -vCol.a;
        if (a < 0.004) discard;
        oCol = vec4(fog(t.rgb * vCol.rgb, vPos), a);
        return;
      }
      if (t.a < 0.5) discard;
      oCol = vec4(retro(fog(t.rgb * vCol.rgb, vPos)), vCol.a);
    }`;

  const SKY_VS = `#version 300 es
    const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
    out vec2 vNdc;
    void main(){ vNdc = P[gl_VertexID]; gl_Position = vec4(P[gl_VertexID], 0.999, 1.0); }`;
  const SKY_FS = `#version 300 es
    precision highp float;
    in vec2 vNdc;
    uniform vec3 uFwd, uRight, uUp; uniform vec2 uTan; uniform sampler2D uSky;
    out vec4 oCol;
    float bayer(vec2 p){
      int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
      float b[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
      return b[x + y * 4] / 16.0;
    }
    void main(){
      vec3 d = normalize(uFwd + vNdc.x * uTan.x * uRight + vNdc.y * uTan.y * uUp);
      float u = atan(d.z, d.x) / 6.2831853;
      float el = asin(clamp(d.y, -1.0, 1.0));
      float v = clamp(1.0 - (el + 0.25) / 1.35, 0.0, 1.0);
      vec3 c = texture(uSky, vec2(u, v)).rgb;
      c = floor(c * 20.0 + bayer(gl_FragCoord.xy) - 0.5 + 0.5) / 20.0;
      oCol = vec4(c, 1.0);
    }`;

  const POST_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uScene, uOver, uAO, uBloom; uniform vec2 uOut, uSceneRes;
    uniform float uCrt, uAberr, uHeat, uTime, uBloomK; uniform vec3 uGrade;
    out vec4 oCol;
    vec3 sceneAt(vec2 p){
      vec2 tp = 1.0 / uSceneRes;
      float ao = 0.0;
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) ao += texture(uAO, p + vec2(i, j) * tp).r;
      return (texture(uScene, p).rgb * (ao / 9.0) + texture(uBloom, p).rgb * uBloomK) * uGrade;
    }
    vec3 pick(vec2 p){ vec4 o = texture(uOver, p); return mix(sceneAt(p), o.rgb, o.a); }
    void main(){
      vec2 uv = gl_FragCoord.xy / uOut;
      vec2 c = uv * 2.0 - 1.0;
      if (uHeat > 0.0) {
        float k = uHeat * (1.0 - uv.y * 0.6);
        uv += vec2(sin(uv.y * 70.0 + uTime * 6.0), sin(uv.x * 50.0 + uTime * 4.7)) * 0.0028 * k;
      }
      vec3 col;
      if (uAberr > 0.001) {
        vec2 d = (uv - 0.5) * uAberr * 0.02;
        col = vec3(pick(uv + d).r, pick(uv).g, pick(uv - d).b);
      } else col = pick(uv);
      if (uCrt > 0.5) {
        float line = 0.5 + 0.5 * cos(gl_FragCoord.y * 2.0944);
        col *= 1.12 - 0.22 * line;
        float m = mod(gl_FragCoord.x, 3.0);
        col *= vec3(m < 1.0 ? 1.06 : 0.97, (m >= 1.0 && m < 2.0) ? 1.06 : 0.97, m >= 2.0 ? 1.06 : 0.97);
        col *= 1.0 - 0.28 * pow(dot(c, c) * 0.5, 1.5);
      }
      oCol = vec4(col, 1.0);
    }`;

  // Screen-space ambient occlusion from the scene depth (view-space positions
  // rebuilt from depth; normals from the nearest neighbours; 12 spiral samples).
  const AO_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uDepth; uniform vec2 uRes, uTan; uniform float uNear, uFar;
    out vec4 oCol;
    float linZ(vec2 uv){ float z = texture(uDepth, uv).r * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    vec3 posAt(vec2 uv){ float z = linZ(uv); return vec3((uv * 2.0 - 1.0) * uTan * z, z); }
    void main(){
      vec2 px = 1.0 / uRes, uv = gl_FragCoord.xy * px;
      if (texture(uDepth, uv).r >= 0.99999) { oCol = vec4(1.0); return; }
      vec3 P = posAt(uv);
      vec3 r = posAt(uv + vec2(px.x, 0.0)) - P, l = P - posAt(uv - vec2(px.x, 0.0));
      vec3 u = posAt(uv + vec2(0.0, px.y)) - P, d = P - posAt(uv - vec2(0.0, px.y));
      vec3 N = normalize(cross(abs(r.z) < abs(l.z) ? r : l, abs(u.z) < abs(d.z) ? u : d));
      if (dot(N, P) > 0.0) N = -N;
      const float R = 0.45;
      float rpx = min(R / P.z * uRes.y / (2.0 * uTan.y), 40.0);
      if (rpx < 1.0) { oCol = vec4(1.0); return; }
      float ang = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
      float occ = 0.0;
      for (int i = 0; i < 12; i++) {
        float f = (float(i) + 0.5) / 12.0, a = ang + float(i) * 2.39996;
        vec3 v = posAt(uv + vec2(cos(a), sin(a)) * f * rpx * px) - P;
        float vv = dot(v, v);
        occ += max(0.0, dot(v, N) - 0.015 * P.z) / (vv + 0.03) * step(vv, R * R * 4.0);
      }
      float ao = clamp(1.0 - occ * 0.045, 0.0, 1.0);
      oCol = vec4(vec3(mix(1.0, ao * ao, 0.85)), 1.0);
    }`;
  // Bloom: keep the bright parts at half resolution, then blur them.
  const BRIGHT_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uScene; uniform vec2 uRes, uSrc;
    out vec4 oCol;
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes, h = 0.5 / uSrc;
      vec3 c = 0.25 * (texture(uScene, uv + vec2(-h.x, -h.y)).rgb + texture(uScene, uv + vec2(h.x, -h.y)).rgb
        + texture(uScene, uv + vec2(-h.x, h.y)).rgb + texture(uScene, uv + vec2(h.x, h.y)).rgb);
      float l = max(c.r, max(c.g, c.b));
      float w = smoothstep(0.62, 1.0, l);
      oCol = vec4(c * w * w, 1.0);
    }`;
  const BLUR_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uSrc; uniform vec2 uRes, uDir;
    out vec4 oCol;
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes, d = uDir / uRes;
      float w[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
      vec3 c = texture(uSrc, uv).rgb * w[0];
      for (int i = 1; i < 5; i++) c += (texture(uSrc, uv + d * float(i)).rgb + texture(uSrc, uv - d * float(i)).rgb) * w[i];
      oCol = vec4(c, 1.0);
    }`;

  // Dust motes: tiny translucent points drawn at display resolution after the
  // final pass, hidden behind the weapon overlay. Vertex: x y z r g b a size.
  const DUST_VS = `#version 300 es
    layout(location=0) in vec3 aPos; layout(location=1) in vec4 aCol; layout(location=2) in float aSize;
    uniform mat4 uVP; out vec4 vCol;
    void main(){ vCol = aCol; gl_Position = uVP * vec4(aPos, 1.0); gl_PointSize = aSize; }`;
  const DUST_FS = `#version 300 es
    precision highp float;
    in vec4 vCol; uniform sampler2D uOver, uDepth; uniform vec2 uOut;
    out vec4 oCol;
    void main(){
      if (gl_FragCoord.z > texture(uDepth, gl_FragCoord.xy / uOut).r + 1e-5) discard;
      vec2 d = gl_PointCoord - 0.5;
      float soft = clamp(1.0 - dot(d, d) * 3.0, 0.0, 1.0);
      float hide = texture(uOver, gl_FragCoord.xy / uOut).a;
      oCol = vec4(vCol.rgb, vCol.a * soft * (1.0 - hide));
    }`;

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  function worldVao(buf) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const S = 40;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 20);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, S, 28);
    gl.bindVertexArray(null);
    return vao;
  }

  function makeSkyCanvas() {
    const W = 2048, H = 512, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#02030c'); gr.addColorStop(0.45, '#0b1640'); gr.addColorStop(0.75, '#1d2f78'); gr.addColorStop(1, '#2a2050');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 900; i++) {
      const x = rnd() * W, y = rnd() * H * 0.7, b = rnd();
      g.fillStyle = `rgba(255,255,${200 + b * 55},${0.3 + b * 0.7})`;
      g.fillRect(x | 0, y | 0, b > 0.93 ? 2 : 1, b > 0.93 ? 2 : 1);
    }
    // Wispy clouds.
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W, y = H * (0.2 + rnd() * 0.45), w = 80 + rnd() * 260, h = 8 + rnd() * 18;
      g.fillStyle = `rgba(70,90,170,${0.08 + rnd() * 0.12})`;
      g.beginPath(); g.ellipse(x, y, w, h, 0, 0, Math.PI * 2); g.fill();
    }
    // Moon.
    const mx = W * 0.62, my = H * 0.28;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 120);
    halo.addColorStop(0, 'rgba(255,240,190,0.45)'); halo.addColorStop(1, 'rgba(255,240,190,0)');
    g.fillStyle = halo; g.fillRect(mx - 130, my - 130, 260, 260);
    g.fillStyle = '#fff2c4'; g.beginPath(); g.arc(mx, my, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0b1640'; g.beginPath(); g.arc(mx + 13, my - 8, 26, 0, Math.PI * 2); g.fill();
    // Mountain ranges (two layers), wrapping horizontally.
    const ridge = (base, amp, col, freq) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) {
        const t = x / W * Math.PI * 2;
        const y = base - amp * (0.5 + 0.3 * Math.sin(t * freq) + 0.15 * Math.sin(t * freq * 2.7 + 1) + 0.08 * Math.sin(t * freq * 7.3 + 2));
        g.lineTo(x, y);
      }
      g.lineTo(W, H); g.fill();
    };
    ridge(H * 0.86, 140, '#141c45', 3);
    ridge(H * 0.93, 90, '#0a0f2a', 5);
    // A distant castle silhouette with lit windows.
    const cx = W * 0.2, cy = H * 0.8;
    g.fillStyle = '#070a1e';
    g.fillRect(cx, cy - 60, 120, 60); g.fillRect(cx - 18, cy - 95, 26, 95); g.fillRect(cx + 110, cy - 110, 28, 110); g.fillRect(cx + 45, cy - 80, 30, 30);
    for (let i = 0; i < 7; i++) g.fillRect(cx - 18 + i * 9 - (i > 2 ? 0 : 0), cy - 101, 5, 6);
    g.fillStyle = '#ffcc55';
    for (const [x, y] of [[cx + 15, cy - 40], [cx + 60, cy - 30], [cx + 95, cy - 45], [cx - 8, cy - 70], [cx + 120, cy - 85]]) g.fillRect(x, y, 3, 5);
    return c;
  }

  function init(cv, assets) {
    canvas = cv;
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    progWorld = compile(WORLD_VS, WORLD_FS);
    progSprite = compile(SPRITE_VS, SPRITE_FS);
    progSky = compile(SKY_VS, SKY_FS);
    progPost = compile(SKY_VS, POST_FS);
    progDust = compile(DUST_VS, DUST_FS);
    progAO = compile(SKY_VS, AO_FS);
    progBright = compile(SKY_VS, BRIGHT_FS);
    progBlur = compile(SKY_VS, BLUR_FS);

    const T = assets.textures;
    texArray = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, T.size, T.size, T.count, 0, gl.RGBA, gl.UNSIGNED_BYTE, T.data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);

    texAtlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, assets.atlas.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    texSky = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texSky);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, makeSkyCanvas());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    texLight = gl.createTexture();
    texOver = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texOver);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    texDummy = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texDummy);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    staticBuf = gl.createBuffer(); dynBuf = gl.createBuffer(); spriteBuf = gl.createBuffer();
    vaoWorld = worldVao(staticBuf); vaoDyn = worldVao(dynBuf);

    vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_SPRITES * 4 * 36, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
    const idx = new Uint16Array(MAX_SPRITES * 6);
    for (let i = 0; i < MAX_SPRITES; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    spriteIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, spriteIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    vaoSky = gl.createVertexArray();
    dustBuf = gl.createBuffer();
    vaoDust = gl.createVertexArray();
    gl.bindVertexArray(vaoDust);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
    gl.bindVertexArray(null);
  }

  function setLevel(world) {
    mapW = world.W; mapH = world.H;
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, world.mesh, gl.STATIC_DRAW);
    staticCount = world.mesh.length / 10;
    const lm = world.lightmap;
    gl.bindTexture(gl.TEXTURE_2D, texLight);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lm.w, lm.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, lm.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Colour texture (+ optional depth texture). Nearest sampling unless `linear`.
  function makeTarget(w, h, depth, linear) {
    const params = (filter) => {
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    };
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    params(linear ? gl.LINEAR : gl.NEAREST);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let dtex = null;
    if (depth) {
      dtex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, dtex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      params(gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dtex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, dtex, w, h };
  }
  function freeTarget(t) {
    if (!t) return;
    gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex);
    if (t.dtex) gl.deleteTexture(t.dtex);
  }
  // w,h: internal (retro) resolution; dw,dh: display canvas size.
  function resize(w, h, dw, dh) {
    sw = w; sh = h;
    canvas.width = dw; canvas.height = dh;
    for (const t of [scene, refl, aoT, bloomA, bloomB]) freeTarget(t);
    scene = makeTarget(w, h, true, false);
    refl = makeTarget(w, h, true, false);
    aoT = makeTarget(w, h, false, true);
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    bloomA = makeTarget(bw, bh, false, true);
    bloomB = makeTarget(bw, bh, false, true);
  }

  // Column-major matrices.
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }

  function basis(cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const f = [cp * cy, sp, cp * sy], r = [-sy, 0, cy];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const e = [cam.x, cam.y, cam.z];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const view = [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, e), -dot(u, e), dot(f, e), 1];
    return { f, r, u, e, fov: cam.fov, vp: mul(perspective(cam.fov, sw / sh, 0.04, 80), view) };
  }

  function drawScene(B, env, lights, dynMesh, spriteCount, clipY, reflTex) {
    gl.viewport(0, 0, sw, sh);
    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    if (env.sky) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(progSky.p);
      const tanY = Math.tan(B.fov / 2);
      gl.uniform3fv(progSky.u.uFwd, B.f); gl.uniform3fv(progSky.u.uRight, B.r); gl.uniform3fv(progSky.u.uUp, B.u);
      gl.uniform2f(progSky.u.uTan, tanY * sw / sh, tanY);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texSky);
      gl.uniform1i(progSky.u.uSky, 0);
      gl.bindVertexArray(vaoSky);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    // World.
    const P = progWorld;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, B.vp);
    gl.uniform3fv(P.u.uCam, B.e);
    gl.uniform3fv(P.u.uFogCol, env.fog);
    gl.uniform1f(P.u.uFogDen, env.fogDensity);
    gl.uniform1f(P.u.uLowFog, env.lowFog || 0);
    gl.uniform4fv(P.u.uRip, env.ripples || new Float32Array(16));
    gl.uniform1f(P.u.uTime, env.time);
    gl.uniform1f(P.u.uAmbient, env.ambient);
    gl.uniform1f(P.u.uFlicker, env.flicker);
    gl.uniform1f(P.u.uClip, clipY);
    gl.uniform1f(P.u.uReflOn, reflTex ? 1 : 0);
    gl.uniform2f(P.u.uRes, sw, sh);
    gl.uniform2f(P.u.uMapSize, mapW, mapH);
    const n = Math.min(MAXL, lights.length);
    const lp = new Float32Array(MAXL * 4), lc = new Float32Array(MAXL * 3);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      lp.set([L.x, L.y, L.z, L.r], i * 4);
      lc.set([L.col[0] * L.i, L.col[1] * L.i, L.col[2] * L.i], i * 3);
    }
    gl.uniform1i(P.u.uNL, n);
    gl.uniform4fv(P.u.uLP, lp);
    gl.uniform3fv(P.u.uLC, lc);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texArray);
    gl.uniform1i(P.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texLight);
    gl.uniform1i(P.u.uLM, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, reflTex || texDummy);
    gl.uniform1i(P.u.uRefl, 2);
    gl.bindVertexArray(vaoWorld);
    gl.drawArrays(gl.TRIANGLES, 0, staticCount);
    if (dynMesh.length) {
      gl.bindVertexArray(vaoDyn);
      gl.drawArrays(gl.TRIANGLES, 0, dynMesh.length / 10);
    }

    // Sprites (pre-sorted back to front by the caller).
    if (spriteCount > 0) {
      const S = progSprite;
      gl.useProgram(S.p);
      gl.uniformMatrix4fv(S.u.uVP, false, B.vp);
      gl.uniform3fv(S.u.uCam, B.e);
      gl.uniform3fv(S.u.uFogCol, env.fog);
      gl.uniform1f(S.u.uFogDen, env.fogDensity);
      gl.uniform1f(S.u.uLowFog, env.lowFog || 0);
      gl.uniform1f(S.u.uClip, clipY);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texAtlas);
      gl.uniform1i(S.u.uAtlas, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vaoSprite);
      gl.uniform1f(S.u.uSoft, 0);
      gl.drawElements(gl.TRIANGLES, spriteCount * 6, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(false);
      gl.uniform1f(S.u.uSoft, 1);
      gl.drawElements(gl.TRIANGLES, spriteCount * 6, gl.UNSIGNED_SHORT, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  // cam: {x,y,z,yaw,pitch,fov}
  // env: {ambient, fog, fogDensity, lowFog, flicker, time, sky, reflectY (optional), ripples (Float32Array(16))}
  // post: {overlay (canvas), crt, aberration, heat, time, grade ([r,g,b]), dust (Float32Array), dustCount}
  function draw(cam, env, lights, dynMesh, sprites, spriteCount, post) {
    if (!scene) return;
    if (dynMesh.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
      gl.bufferData(gl.ARRAY_BUFFER, dynMesh, gl.DYNAMIC_DRAW);
    }
    const count = Math.min(spriteCount, MAX_SPRITES);
    if (count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprites, 0, count * 36);
    }
    // Reflection: the scene seen from the mirrored eye, clipped above the water plane.
    const reflect = env.reflectY !== undefined;
    if (reflect) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, refl.fb);
      const rc = { ...cam, y: 2 * env.reflectY - cam.y, pitch: -cam.pitch };
      drawScene(basis(rc), env, lights, dynMesh, count, env.reflectY + 0.1, null);
    }
    const B = basis(cam);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
    drawScene(B, env, lights, dynMesh, count, -1e9, reflect ? refl.tex : null);

    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(vaoSky);
    const full = (target, prog) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
      gl.useProgram(prog.p);
      gl.uniform2f(prog.u.uRes, target.w, target.h);
    };
    // Ambient occlusion.
    full(aoT, progAO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.dtex);
    gl.uniform1i(progAO.u.uDepth, 0);
    const tanY = Math.tan(cam.fov / 2);
    gl.uniform2f(progAO.u.uTan, tanY * sw / sh, tanY);
    gl.uniform1f(progAO.u.uNear, NEAR); gl.uniform1f(progAO.u.uFar, FAR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Bloom: bright pass, then two separable blurs (the second one wider).
    full(bloomA, progBright);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(progBright.u.uScene, 0);
    gl.uniform2f(progBright.u.uSrc, sw, sh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (const [src, dst, dir] of [[bloomA, bloomB, [1, 0]], [bloomB, bloomA, [0, 1]], [bloomA, bloomB, [2.5, 0]], [bloomB, bloomA, [0, 2.5]]]) {
      full(dst, progBlur);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(progBlur.u.uSrc, 0);
      gl.uniform2f(progBlur.u.uDir, dir[0], dir[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Final pass to the display canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texOver);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, post.overlay);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, aoT.tex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, scene.dtex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    const Q = progPost;
    gl.useProgram(Q.p);
    gl.uniform1i(Q.u.uScene, 0);
    gl.uniform1i(Q.u.uOver, 1);
    gl.uniform1i(Q.u.uAO, 2);
    gl.uniform1i(Q.u.uBloom, 3);
    gl.uniform2f(Q.u.uSceneRes, sw, sh);
    gl.uniform1f(Q.u.uBloomK, 0.9);
    const gr = post.grade || [1, 1, 1];
    gl.uniform3f(Q.u.uGrade, gr[0], gr[1], gr[2]);
    gl.uniform2f(Q.u.uOut, canvas.width, canvas.height);
    gl.uniform1f(Q.u.uCrt, post.crt ? 1 : 0);
    gl.uniform1f(Q.u.uAberr, post.aberration || 0);
    gl.uniform1f(Q.u.uHeat, post.heat || 0);
    gl.uniform1f(Q.u.uTime, post.time || 0);
    gl.bindVertexArray(vaoSky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (post.dust && post.dustCount > 0) {
      const D = progDust;
      gl.useProgram(D.p);
      gl.uniformMatrix4fv(D.u.uVP, false, B.vp);
      gl.uniform1i(D.u.uOver, 1);
      gl.uniform1i(D.u.uDepth, 4);
      gl.uniform2f(D.u.uOut, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
      gl.bufferData(gl.ARRAY_BUFFER, post.dust.subarray(0, post.dustCount * 8), gl.STREAM_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(vaoDust);
      gl.drawArrays(gl.POINTS, 0, post.dustCount);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  return { init, setLevel, resize, draw, MAX_SPRITES };
})();
