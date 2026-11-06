// Minimal WebGL helpers: column-major 4x4 matrices, rounded prism meshes, shader programs.
const GL3D = (() => {
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }

  function lookAt(e, t, u) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz);
    zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz);
    xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1
    ]);
  }

  function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  }

  function invert(m) {
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    return new Float32Array([
      (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d,
      (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
      (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d,
      (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
      (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d,
      (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
      (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d,
      (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d
    ]);
  }

  function transform(m, x, y, z, w) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12] * w, m[1] * x + m[5] * y + m[9] * z + m[13] * w,
      m[2] * x + m[6] * y + m[10] * z + m[14] * w, m[3] * x + m[7] * y + m[11] * z + m[15] * w
    ];
  }

  // Outline of a rounded rectangle in the xz plane with outward normals (same point count for any size)
  function roundRect(hw, hd, r, seg) {
    const pts = [];
    const corners = [[hw - r, hd - r], [-(hw - r), hd - r], [-(hw - r), -(hd - r)], [hw - r, -(hd - r)]];
    corners.forEach(([cx, cz], q) => {
      for (let i = 0; i <= seg; i++) {
        const a = (q + i / seg) * Math.PI / 2;
        pts.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) });
      }
    });
    return pts;
  }

  // Outline of a regular polygon with rounded corners: apothem a (centre to edge), edge normals at k·2π/n
  // (so an octagon has flat sides facing the axes and the diagonals), seg points per corner
  function roundPoly(n, a, r, seg) {
    const pts = [], cd = (a - r) / Math.cos(Math.PI / n);
    for (let k = 0; k < n; k++) {
      const v = (k + 0.5) * 2 * Math.PI / n, cx = cd * Math.cos(v), cz = cd * Math.sin(v);
      for (let i = 0; i <= seg; i++) {
        const t = (k + i / seg) * 2 * Math.PI / n;
        pts.push({ x: cx + r * Math.cos(t), z: cz + r * Math.sin(t), nx: Math.cos(t), nz: Math.sin(t) });
      }
    }
    return pts;
  }

  // Rounded-rectangle solid swept along a profile of [inset, y] rings, bottom to top, plus a flat top cap.
  // o: { hw, hd, r, seg, profile, cx, cz, angle, sides }; with sides the outline is a rounded polygon of apothem hw. Returns { side, cap } meshes; cap uv spans the top face.
  function prism(o) {
    const seg = o.seg || 8, ang = o.angle || 0, cs = Math.cos(ang), sn = Math.sin(ang);
    const cx = o.cx || 0, cz = o.cz || 0, prof = o.profile, P = prof.length;
    const rings = prof.map(([inset]) => o.sides
      ? roundPoly(o.sides, o.hw - inset, Math.max(o.r - inset, 1e-3), seg)
      : roundRect(o.hw - inset, o.hd - inset, Math.max(o.r - inset, 1e-3), seg));
    const N = rings[0].length;
    const rot = (x, z) => [x * cs - z * sn, x * sn + z * cs];
    const side = { pos: [], nor: [], uv: [], idx: [] };
    for (let i = 0; i < P; i++) {
      const a = prof[Math.max(i - 1, 0)], b = prof[Math.min(i + 1, P - 1)];
      const tr = a[0] - b[0], ty = b[1] - a[1]; // tangent in (outward radius, height)
      let nr = ty, ny = -tr;
      const l = Math.hypot(nr, ny) || 1;
      nr /= l; ny /= l;
      for (const p of rings[i]) {
        const [x, z] = rot(p.x, p.z), [nx, nz] = rot(p.nx, p.nz);
        side.pos.push(x + cx, prof[i][1], z + cz);
        side.nor.push(nx * nr, ny, nz * nr);
        side.uv.push(0, 0);
      }
    }
    for (let i = 0; i < P - 1; i++) {
      for (let j = 0; j < N; j++) {
        const a = i * N + j, b = i * N + (j + 1) % N;
        side.idx.push(a, b, b + N, a, b + N, a + N);
      }
    }
    const top = rings[P - 1], y = prof[P - 1][1];
    const hw = o.hw - prof[P - 1][0], hd = o.hd - prof[P - 1][0];
    const cap = { pos: [cx, y, cz], nor: [0, 1, 0], uv: [0.5, 0.5], idx: [] };
    top.forEach((p, j) => {
      const [x, z] = rot(p.x, p.z);
      cap.pos.push(x + cx, y, z + cz);
      cap.nor.push(0, 1, 0);
      cap.uv.push(p.x / (2 * hw) + 0.5, p.z / (2 * hd) + 0.5);
      cap.idx.push(0, 1 + j, 1 + (j + 1) % N);
    });
    return { side, cap };
  }

  function merge(...meshes) {
    const out = { pos: [], nor: [], uv: [], idx: [] };
    for (const m of meshes) {
      const base = out.pos.length / 3;
      out.pos.push(...m.pos);
      out.nor.push(...m.nor);
      out.uv.push(...m.uv);
      for (const i of m.idx) out.idx.push(i + base);
    }
    return out;
  }

  function upload(gl, m) {
    const buf = (target, data) => {
      const b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    };
    return {
      pos: buf(gl.ARRAY_BUFFER, new Float32Array(m.pos)),
      nor: buf(gl.ARRAY_BUFFER, new Float32Array(m.nor)),
      uv: buf(gl.ARRAY_BUFFER, new Float32Array(m.uv)),
      idx: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(m.idx)),
      count: m.idx.length
    };
  }

  function program(gl, vsSrc, fsSrc) {
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      loc[name] = gl.getUniformLocation(p, name);
    }
    for (const a of ['aPos', 'aNor', 'aUv']) loc[a] = gl.getAttribLocation(p, a);
    return { p, loc };
  }

  return { perspective, lookAt, multiply, invert, transform, roundRect, roundPoly, prism, merge, upload, program };
})();
