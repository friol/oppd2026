// WebGL post-processing over the 2D game canvas:
// - heat haze and shockwave refraction (distortion field from engines, explosions, boss beam and shock rings)
// - relief lighting: dynamic lights shade solid objects using normals derived from the frame's luminance
// - volumetric light shafts (radial blur of the bright buffer towards strong light sources)
// - bloom, filmic highlight roll-off, colour grading, lens chromatic aberration, vignette, film grain.
// Returns null when WebGL is not available.
self.PostFX = (function () {
  'use strict';
  var NH = 8, NS = 6, NL = 8, NR = 4, NSP = 8;
  var FW = 64, FH = 96;          // fluid grid (screen space)

  var VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';

  var FS_BRIGHT = [
    'precision mediump float; varying vec2 uv; uniform sampler2D t; uniform float th; uniform vec2 px;',
    'void main(){',
    '  vec3 c = texture2D(t, uv + px * vec2(-0.5,-0.5)).rgb + texture2D(t, uv + px * vec2(0.5,-0.5)).rgb',
    '         + texture2D(t, uv + px * vec2(-0.5,0.5)).rgb + texture2D(t, uv + px * vec2(0.5,0.5)).rgb;',
    '  c *= 0.25;',
    '  float l = max(c.r, max(c.g, c.b));',
    '  gl_FragColor = vec4(c * smoothstep(th, th + 0.25, l), 1.0);',
    '}'].join('\n');

  var FS_BLUR = [
    'precision mediump float; varying vec2 uv; uniform sampler2D t; uniform vec2 d;',
    'void main(){',
    '  vec3 c = texture2D(t, uv).rgb * 0.2270270270;',
    '  c += (texture2D(t, uv + d * 1.3846153846).rgb + texture2D(t, uv - d * 1.3846153846).rgb) * 0.3162162162;',
    '  c += (texture2D(t, uv + d * 3.2307692308).rgb + texture2D(t, uv - d * 3.2307692308).rgb) * 0.0702702703;',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'].join('\n');

  // light shafts: march from each pixel towards each light, accumulating the bright buffer with decay
  var FS_RAYS = [
    'precision mediump float; varying vec2 uv; uniform sampler2D t;',
    'uniform vec3 ray[' + NR + ']; uniform vec3 rayc[' + NR + ']; uniform int nRay;',
    'void main(){',
    '  vec3 acc = vec3(0.0);',
    '  for (int k = 0; k < ' + NR + '; k++) {',
    '    if (k >= nRay) break;',
    '    vec2 d = (uv - ray[k].xy) / 32.0 * 0.9; vec2 q = uv; float w = 1.0; vec3 s = vec3(0.0);',
    '    for (int i = 0; i < 32; i++) { q -= d; s += texture2D(t, q).rgb * w; w *= 0.94; }',
    '    float fall = 1.0 - smoothstep(0.0, 0.75, length((uv - ray[k].xy) * vec2(1.0, 1.5)));',
    '    acc += s / 32.0 * rayc[k] * ray[k].z * fall;',
    '  }',
    '  gl_FragColor = vec4(acc, 1.0);',
    '}'].join('\n');

  // anamorphic streak: only the hottest pixels, smeared far to the left and right
  var FS_STREAK = [
    'precision mediump float; varying vec2 uv; uniform sampler2D t, w; uniform vec2 d; uniform float hot, peak;',
    // peak > 0: keep only local peaks (bright minus its wide surroundings), so big bright areas like planets do not streak
    'vec3 h(vec2 q){ vec3 c = texture2D(t, q).rgb - texture2D(w, q).rgb * peak; return max(c - hot, 0.0) * 2.5; }',
    'void main(){',
    '  vec3 c = h(uv); float w = 1.0;',
    '  for (int i = 1; i < 20; i++) { float fi = float(i); float k = exp(-fi * 0.16);',
    '    c += (h(uv + d * fi) + h(uv - d * fi)) * k; w += 2.0 * k; }',
    '  gl_FragColor = vec4(c / w * 3.0, 1.0);',
    '}'].join('\n');

  // lens flare: ghosts mirrored through the centre plus a halo ring, with a rainbow lens tint
  var FS_FLARE = [
    'precision mediump float; varying vec2 uv; uniform sampler2D t; uniform float hot;',
    'vec3 sm(vec2 q, vec2 dir){ return vec3(texture2D(t, q + dir * 0.006).r, texture2D(t, q).g, texture2D(t, q - dir * 0.006).b); }',
    'vec3 tint(float x){ return 0.5 + 0.5 * cos(6.2832 * (x + vec3(0.0, 0.33, 0.67))); }',
    'void main(){',
    '  vec2 f = vec2(1.0) - uv; vec2 gv = (vec2(0.5) - f) * 0.42; vec2 dir = normalize(gv + 1e-5);',
    '  vec3 c = vec3(0.0);',
    '  for (int i = 0; i < 5; i++) { vec2 o = fract(f + gv * float(i));',
    '    float w = pow(max(1.0 - length(vec2(0.5) - o) / 0.707, 0.0), 7.0);',
    '    c += max(sm(o, dir) - hot, 0.0) * w * tint(float(i) * 0.21 + length(vec2(0.5) - o)); }',
    '  vec2 hv = normalize(gv + 1e-5) * 0.42; vec2 ho = fract(f + hv);',
    '  float hw = pow(max(1.0 - length(vec2(0.5) - ho) / 0.707, 0.0), 6.0);',
    '  c += max(sm(ho, dir) - hot, 0.0) * hw * tint(length(vec2(0.5) - ho) * 2.0) * 0.8;',
    '  gl_FragColor = vec4(c * 2.2, 1.0);',
    '}'].join('\n');

  // gas fluid: semi-Lagrangian advection of the velocity field (px/s), damping, impulses from explosions and the ship
  var FS_VEL = [
    'precision highp float; varying vec2 uv; uniform sampler2D v; uniform float dt; uniform vec2 lres, drift;',
    'uniform vec4 sp[' + NSP + ']; uniform vec3 spd[' + NSP + ']; uniform int nSp;',
    'void main(){',
    '  vec2 P = uv * lres;',
    '  vec2 v0 = texture2D(v, uv).xy;',
    '  vec2 vel = texture2D(v, uv - (v0 + drift) * dt / lres).xy;',
    // a little viscosity: average with the neighbours
    '  vec2 tx = 1.0 / vec2(' + FW + '.0, ' + FH + '.0);',
    '  vec2 nb = texture2D(v, uv + vec2(tx.x, 0.0)).xy + texture2D(v, uv - vec2(tx.x, 0.0)).xy + texture2D(v, uv + vec2(0.0, tx.y)).xy + texture2D(v, uv - vec2(0.0, tx.y)).xy;',
    '  vel = mix(vel, nb * 0.25, 0.15);',
    '  vel *= pow(0.25, dt);',
    '  for (int i = 0; i < ' + NSP + '; i++) {',
    '    if (i >= nSp) break;',
    '    vec2 dv = P - sp[i].xy; float d = length(dv) + 0.001;',
    '    float f = exp(-d * d / (sp[i].z * sp[i].z));',
    '    vec2 dir = length(spd[i].xy) > 0.0 ? spd[i].xy : dv / d;',
    '    vec2 tang = vec2(-dv.y, dv.x) / d * spd[i].z;',
    '    vel += (dir + tang) * sp[i].w * f;',
    '  }',
    '  gl_FragColor = vec4(clamp(vel, -900.0, 900.0), 0.0, 1.0);',
    '}'].join('\n');

  // displacement of the gas (px): carried by the flow and the scroll, slowly relaxing back
  var FS_DISP = [
    'precision highp float; varying vec2 uv; uniform sampler2D d, v; uniform float dt; uniform vec2 lres, drift;',
    'void main(){',
    '  vec2 vel = texture2D(v, uv).xy;',
    '  vec2 disp = texture2D(d, uv - (vel + drift) * dt / lres).xy;',
    '  disp += vel * dt;',
    '  disp *= pow(0.45, dt);',
    '  gl_FragColor = vec4(clamp(disp, -45.0, 45.0), 0.0, 1.0);',
    '}'].join('\n');

  var FS_COMP = [
    'precision mediump float; varying vec2 uv;',
    'uniform sampler2D s, b1, b2, rays, mask, bg, bgb, disp, streak, flare;',
    'uniform float tileOff, tileH, dof, hasBg, flareK;',
    'uniform float time, ab, bloom, grain, rayk; uniform vec2 res, lres;',
    'uniform vec4 heat[' + NH + ']; uniform int nHeat;',
    'uniform vec4 shk[' + NS + ']; uniform float shkS[' + NS + ']; uniform int nShk;',
    'uniform vec4 beam;',
    'uniform vec4 lt[' + NL + ']; uniform vec3 ltc[' + NL + ']; uniform int nLt;',
    'float hash(vec2 q){ return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }',
    'vec3 roll(vec3 x){ return mix(x, 0.8 + 0.2 * (1.0 - exp(-(x - 0.8) * 5.0)), step(0.8, x)); }',
    'float lum(vec2 q){ return dot(texture2D(s, q).rgb, vec3(0.299, 0.587, 0.114)); }',
    'void main(){',
    '  vec2 P = uv * lres;                                   // logical pixels, y up',
    '  vec2 off = vec2(0.0);',
    // heat haze: animated wobble inside each source radius
    '  for (int i = 0; i < ' + NH + '; i++) {',
    '    if (i >= nHeat) break;',
    '    float f = 1.0 - smoothstep(0.0, heat[i].z, length(P - heat[i].xy));',
    '    float fi = float(i);',
    '    off += vec2(sin(P.y * 0.32 + time * 9.0 + fi * 1.7), cos(P.x * 0.27 + time * 7.3 + fi * 2.3)) * f * f * heat[i].w;',
    '  }',
    // boss beam: the air around it ripples
    '  if (beam.w > 0.0) {',
    '    float bf = (1.0 - smoothstep(0.0, beam.z, abs(P.x - beam.x))) * step(P.y, beam.y);',
    '    off.x += sin(P.y * 0.11 - time * 28.0) * bf * beam.w;',
    '  }',
    // shockwaves: real refraction along the ring
    '  for (int i = 0; i < ' + NS + '; i++) {',
    '    if (i >= nShk) break;',
    '    vec2 dv = P - shk[i].xy; float dd = length(dv);',
    '    float ring = 1.0 - smoothstep(0.0, shk[i].w, abs(dd - shk[i].z));',
    '    off -= dv / max(dd, 1.0) * ring * shkS[i] * 14.0;',
    '  }',
    '  vec2 q = uv + off / lres;',
    // lens chromatic aberration
    '  vec2 cc = uv - 0.5; float r2 = dot(cc, cc);',
    '  vec2 o = cc * ab * (0.3 + r2 * 4.0);',
    '  vec3 col = vec3(texture2D(s, q + o).r, texture2D(s, q).g, texture2D(s, q - o).b);',
    '  float sa = texture2D(s, q).a;',
    // far background (procedural space tile): pushed around by the gas flow, softly out of focus
    '  if (hasBg > 0.5) {',
    '    vec2 Pq = q * lres - texture2D(disp, q).xy;',
    '    float yTop = lres.y - Pq.y;',
    '    vec2 tuv = vec2(Pq.x / lres.x, 1.0 - fract((yTop - tileOff) / tileH));',
    '    vec3 bgc = mix(texture2D(bg, tuv).rgb, texture2D(bgb, tuv).rgb, dof);',
    '    col = mix(bgc, col, sa);',
    '  }',
    // relief lighting on solid objects: normals from the luminance gradient, Lambert + a little specular
    '  if (nLt > 0) {',
    '    float m = texture2D(mask, q).a;',
    '    if (m > 0.02) {',
    '      vec2 tx = 1.0 / res;',
    '      float hx = lum(q - vec2(tx.x * 1.5, 0.0)) - lum(q + vec2(tx.x * 1.5, 0.0));',
    '      float hy = lum(q - vec2(0.0, tx.y * 1.5)) - lum(q + vec2(0.0, tx.y * 1.5));',
    '      vec3 N = normalize(vec3(hx * 9.0, hy * 9.0, 1.0));',
    '      vec3 add = vec3(0.0);',
    '      for (int i = 0; i < ' + NL + '; i++) {',
    '        if (i >= nLt) break;',
    '        vec2 dl = lt[i].xy - P; float dist = length(dl);',
    '        float att = (1.0 - smoothstep(0.0, lt[i].z, dist)); att *= att * lt[i].w;',
    // light comes from the side at a fixed elevation: slopes facing it get brighter, the others darker
    '        vec3 Ln = normalize(vec3(dl / max(dist, 1.0), 0.75));',
    '        float shade = 0.6 + 1.6 * (dot(N, Ln) - Ln.z * N.z);',
    '        float spe = pow(max(dot(reflect(-Ln, N), vec3(0.0, 0.0, 1.0)), 0.0), 10.0);',
    '        add += ltc[i] * att * ((col * 1.5 + 0.12) * max(shade, 0.0) + spe * 0.8);',
    '      }',
    '      col += add * m;',
    '    }',
    '  }',
    // bloom and light shafts
    '  col += (texture2D(b1, uv).rgb * 0.9 + texture2D(b2, uv).rgb * 0.75) * bloom;',
    '  col += texture2D(rays, uv).rgb * rayk;',
    '  col += (texture2D(streak, uv).rgb * vec3(0.35, 0.6, 1.0) * 0.55 + texture2D(flare, uv).rgb * 0.18) * flareK;',
    '  col = roll(col);',
    '  col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);',
    '  float l = dot(col, vec3(0.299, 0.587, 0.114));',
    '  col = mix(vec3(l), col, 1.12);',
    '  col += vec3(-0.004, 0.006, 0.02) * (1.0 - l) + vec3(0.02, 0.01, -0.01) * l * l;',
    '  col *= 1.0 - 0.32 * smoothstep(0.18, 0.62, length(cc * vec2(1.0, 0.85)));',
    '  col += (hash(uv * res + fract(time * 7.13) * 91.7) - 0.5) * grain;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'].join('\n');

  function init(src) {
    var c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    var gl = c.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) return null;

    function sh(type, s) {
      var o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
      return o;
    }
    function prog(fs) {
      var pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
      var u = {}, n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(pr, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(pr, a.name.replace('[0]', '')); }
      return { p: pr, u: u };
    }
    function tex(w, h, type) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w || 1, h || 1, 0, gl.RGBA, type || gl.UNSIGNED_BYTE, null);
      return t;
    }
    function fbo(w, h, type) {
      var t = tex(w, h, type), f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      return { f: f, t: t, w: w, h: h };
    }

    var P;
    try { P = { bright: prog(FS_BRIGHT), blur: prog(FS_BLUR), rays: prog(FS_RAYS), comp: prog(FS_COMP), streak: prog(FS_STREAK), flare: prog(FS_FLARE), vel: prog(FS_VEL), disp: prog(FS_DISP) }; }
    catch (e) { console.warn('PostFX disabled:', e.message); return null; }
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var W = c.width, H = c.height;
    var srcT = tex(1, 1), maskT = tex(1, 1);
    // gas fluid needs float render targets (half float); without them the background just does not move
    var hf = gl.getExtension('OES_texture_half_float'), fluid = null;
    gl.getExtension('OES_texture_half_float_linear'); gl.getExtension('EXT_color_buffer_half_float');
    if (hf) {
      var V1 = fbo(FW, FH, hf.HALF_FLOAT_OES), V2 = fbo(FW, FH, hf.HALF_FLOAT_OES), D1 = fbo(FW, FH, hf.HALF_FLOAT_OES), D2 = fbo(FW, FH, hf.HALF_FLOAT_OES);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        fluid = { v: V1, v2: V2, d: D1, d2: D2 };
        [V1, V2, D1, D2].forEach(function (b) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.f); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); });
      }
    }
    var zeroT = tex(1, 1);
    var bgT = tex(1, 1), bgTile = null, BG1 = null, BG2 = null, lastT = 0;
    var A = fbo(W >> 2, H >> 2), B = fbo(W >> 2, H >> 2), C = fbo(W >> 3, H >> 3), D = fbo(W >> 3, H >> 3), E = fbo(W >> 2, H >> 2), SK1 = fbo(W >> 2, H >> 2), SK2 = fbo(W >> 2, H >> 2), FL = fbo(W >> 3, H >> 3);
    var fSp = new Float32Array(NSP * 4), fSpd = new Float32Array(NSP * 3);
    var fHeat = new Float32Array(NH * 4), fShk = new Float32Array(NS * 4), fShkS = new Float32Array(NS);
    var fLt = new Float32Array(NL * 4), fLtc = new Float32Array(NL * 3), fRay = new Float32Array(NR * 3), fRayc = new Float32Array(NR * 3);

    function pass(target, pr, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null); gl.viewport(0, 0, w, h); gl.useProgram(pr.p); }
    function bindT(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
    function blur(src, tmp) {
      pass(tmp, P.blur, tmp.w, tmp.h); bindT(0, src.t, P.blur.u.t); gl.uniform2f(P.blur.u.d, 1 / src.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(src, P.blur, src.w, src.h); bindT(0, tmp.t, P.blur.u.t); gl.uniform2f(P.blur.u.d, 0, 1 / src.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function upload(t, canvas) {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    }

    return {
      canvas: c,
      // o: time, threshold, bloom, aberration, grain, lw/lh (logical size, y down in all the lists below),
      //    heat [[x,y,r,strength]], shocks [[x,y,R,T,s]], beam [x,yTop,halfWidth,strength] or null,
      //    lights [[x,y,r,intensity,[r,g,b]]] + mask canvas, rays [[x,y,intensity,[r,g,b]]]
      render: function (o) {
        var lw = o.lw, lh = o.lh, i, n;
        var dtf = Math.min(0.05, Math.max(0.001, o.time - lastT)); lastT = o.time;
        // background tile: upload once per level and prepare a blurred copy (depth of field)
        if (o.tile && o.tile !== bgTile) {
          bgTile = o.tile;
          upload(bgT, bgTile);
          if (!BG1) { BG1 = fbo(bgTile.width >> 1, bgTile.height >> 1); BG2 = fbo(bgTile.width >> 1, bgTile.height >> 1); }
          pass(BG1, P.blur, BG1.w, BG1.h); bindT(0, bgT, P.blur.u.t); gl.uniform2f(P.blur.u.d, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
          blur(BG1, BG2); blur(BG1, BG2); blur(BG1, BG2);
        }
        // gas fluid step
        if (fluid && o.tile) {
          var S = o.splats || [], ns = Math.min(NSP, S.length);
          for (i = 0; i < ns; i++) {
            fSp[i * 4] = S[i][0]; fSp[i * 4 + 1] = lh - S[i][1]; fSp[i * 4 + 2] = S[i][2]; fSp[i * 4 + 3] = S[i][3];
            fSpd[i * 3] = S[i][4]; fSpd[i * 3 + 1] = -S[i][5]; fSpd[i * 3 + 2] = S[i][6];
          }
          pass(fluid.v2, P.vel, FW, FH); bindT(0, fluid.v.t, P.vel.u.v);
          gl.uniform1f(P.vel.u.dt, dtf); gl.uniform2f(P.vel.u.lres, lw, lh); gl.uniform2f(P.vel.u.drift, 0, -(o.scrollV || 0));
          gl.uniform1i(P.vel.u.nSp, ns); if (ns) { gl.uniform4fv(P.vel.u.sp, fSp); gl.uniform3fv(P.vel.u.spd, fSpd); }
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          var tv = fluid.v; fluid.v = fluid.v2; fluid.v2 = tv;
          pass(fluid.d2, P.disp, FW, FH); bindT(0, fluid.d.t, P.disp.u.d); bindT(1, fluid.v.t, P.disp.u.v);
          gl.uniform1f(P.disp.u.dt, dtf); gl.uniform2f(P.disp.u.lres, lw, lh); gl.uniform2f(P.disp.u.drift, 0, -(o.scrollV || 0));
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          var td = fluid.d; fluid.d = fluid.d2; fluid.d2 = td;
        }
        upload(srcT, src);
        // bloom
        pass(A, P.bright, A.w, A.h); bindT(0, srcT, P.bright.u.t);
        gl.uniform1f(P.bright.u.th, o.threshold); gl.uniform2f(P.bright.u.px, 1 / A.w, 1 / A.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        blur(A, B); blur(A, B);
        pass(C, P.blur, C.w, C.h); bindT(0, A.t, P.blur.u.t); gl.uniform2f(P.blur.u.d, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        blur(C, D); blur(C, D);
        // anamorphic streaks (two horizontal smears) and lens flare ghosts
        pass(SK1, P.streak, SK1.w, SK1.h); bindT(0, A.t, P.streak.u.t); bindT(1, C.t, P.streak.u.w); gl.uniform1f(P.streak.u.peak, 1.0); gl.uniform2f(P.streak.u.d, 2.2 / SK1.w, 0); gl.uniform1f(P.streak.u.hot, 0.32);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(SK2, P.streak, SK2.w, SK2.h); bindT(0, SK1.t, P.streak.u.t); bindT(1, SK1.t, P.streak.u.w); gl.uniform1f(P.streak.u.peak, 0.0); gl.uniform2f(P.streak.u.d, 5.5 / SK2.w, 0); gl.uniform1f(P.streak.u.hot, 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(FL, P.flare, FL.w, FL.h); bindT(0, C.t, P.flare.u.t); gl.uniform1f(P.flare.u.hot, 0.4);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // light shafts
        var R = o.rays || [], nr = Math.min(NR, R.length);
        for (i = 0; i < nr; i++) {
          fRay[i * 3] = R[i][0] / lw; fRay[i * 3 + 1] = 1 - R[i][1] / lh; fRay[i * 3 + 2] = R[i][2];
          fRayc[i * 3] = R[i][3][0] / 255; fRayc[i * 3 + 1] = R[i][3][1] / 255; fRayc[i * 3 + 2] = R[i][3][2] / 255;
        }
        pass(E, P.rays, E.w, E.h); bindT(0, A.t, P.rays.u.t);
        gl.uniform1i(P.rays.u.nRay, nr);
        if (nr) { gl.uniform3fv(P.rays.u.ray, fRay); gl.uniform3fv(P.rays.u.rayc, fRayc); }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        // composite
        var Ls = o.lights || [], nl = Math.min(NL, Ls.length);
        if (nl && o.mask) upload(maskT, o.mask); else nl = 0;      // (upload binds to unit 0: do it before binding the inputs)
        pass(null, P.comp, W, H);
        bindT(0, srcT, P.comp.u.s); bindT(1, A.t, P.comp.u.b1); bindT(2, C.t, P.comp.u.b2); bindT(3, E.t, P.comp.u.rays);
        bindT(4, maskT, P.comp.u.mask);
        bindT(5, bgT, P.comp.u.bg); bindT(6, BG1 ? BG1.t : bgT, P.comp.u.bgb);
        bindT(7, fluid ? fluid.d.t : zeroT, P.comp.u.disp);
        bindT(8, SK2.t, P.comp.u.streak); bindT(9, FL.t, P.comp.u.flare);
        gl.uniform1f(P.comp.u.hasBg, o.tile ? 1 : 0); gl.uniform1f(P.comp.u.tileOff, o.tileOff || 0); gl.uniform1f(P.comp.u.tileH, o.tile ? o.tile.height : 1);
        gl.uniform1f(P.comp.u.dof, o.dof || 0); gl.uniform1f(P.comp.u.flareK, o.flare == null ? 1 : o.flare);
        gl.uniform1f(P.comp.u.time, o.time); gl.uniform1f(P.comp.u.ab, o.aberration);
        gl.uniform1f(P.comp.u.bloom, o.bloom); gl.uniform1f(P.comp.u.grain, o.grain); gl.uniform1f(P.comp.u.rayk, nr ? 1.6 : 0);
        gl.uniform2f(P.comp.u.res, W, H); gl.uniform2f(P.comp.u.lres, lw, lh);
        var Hh = o.heat || []; n = Math.min(NH, Hh.length);
        for (i = 0; i < n; i++) { fHeat[i * 4] = Hh[i][0]; fHeat[i * 4 + 1] = lh - Hh[i][1]; fHeat[i * 4 + 2] = Hh[i][2]; fHeat[i * 4 + 3] = Hh[i][3]; }
        gl.uniform1i(P.comp.u.nHeat, n); if (n) gl.uniform4fv(P.comp.u.heat, fHeat);
        var Sk = o.shocks || []; n = Math.min(NS, Sk.length);
        for (i = 0; i < n; i++) { fShk[i * 4] = Sk[i][0]; fShk[i * 4 + 1] = lh - Sk[i][1]; fShk[i * 4 + 2] = Sk[i][2]; fShk[i * 4 + 3] = Sk[i][3]; fShkS[i] = Sk[i][4]; }
        gl.uniform1i(P.comp.u.nShk, n); if (n) { gl.uniform4fv(P.comp.u.shk, fShk); gl.uniform1fv(P.comp.u.shkS, fShkS); }
        var bm = o.beam; gl.uniform4f(P.comp.u.beam, bm ? bm[0] : 0, bm ? lh - bm[1] : 0, bm ? bm[2] : 1, bm ? bm[3] : 0);
        for (i = 0; i < nl; i++) {
          fLt[i * 4] = Ls[i][0]; fLt[i * 4 + 1] = lh - Ls[i][1]; fLt[i * 4 + 2] = Ls[i][2]; fLt[i * 4 + 3] = Ls[i][3];
          fLtc[i * 3] = Ls[i][4][0] / 255; fLtc[i * 3 + 1] = Ls[i][4][1] / 255; fLtc[i * 3 + 2] = Ls[i][4][2] / 255;
        }
        gl.uniform1i(P.comp.u.nLt, nl); if (nl) { gl.uniform4fv(P.comp.u.lt, fLt); gl.uniform3fv(P.comp.u.ltc, fLtc); }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    };
  }
  return { init: init };
})();
