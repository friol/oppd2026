// Digital rain shader: everything is procedural from world coordinates,
// so a plane can slide along with the camera and the rain stays in place.
const Rain = (() => {
  // Columns repeat every WRAP cells; the camera is wrapped by the same length
  const WRAP = 4096;

  const vertexShader = `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `;

  const fragmentShader = `
    uniform sampler2D uAtlas;
    uniform float uGrid, uCount, uTime, uSide, uSeed, uReveal, uFogNear, uFogFar, uFillTop, uFillTime;
    uniform vec2 uCell;
    varying vec3 vWorld;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      // Planes lie in YZ; uSide flips z so glyphs read left to right from inside the corridor
      vec2 p = vec2(uSide * vWorld.z, vWorld.y) / uCell;
      vec2 cell = floor(p);
      vec2 f = fract(p);
      float col = mod(cell.x, ${WRAP}.0);

      // Per-column drop: speed, repeat period and trail length
      float c1 = hash12(vec2(col, uSeed));
      float c2 = hash12(vec2(uSeed, col + 17.0));
      float c3 = hash12(vec2(col * 1.7, uSeed + 5.0));
      float speed = mix(6.0, 16.0, c1);
      float period = floor(mix(28.0, 70.0, c2));
      float trail = period * mix(0.35, 0.8, c3);
      // Each column starts at its own time with its first drop entering at uFillTop,
      // so the screen begins black and fills up; cells the first drop hasn't reached stay dark
      float start = hash12(vec2(col + 7.0, uSeed + 3.0)) * uFillTime;
      float head = floor((uTime - start) * speed);
      float row = floor(uFillTop / uCell.y) - cell.y;
      float d = mod(head - row, period);
      float glow = d < trail && row <= head ? pow(1.0 - d / trail, 1.6) : 0.0;
      // Some columns stay empty, so farther planes show through
      if (hash12(vec2(col + 41.0, uSeed * 0.37)) < 0.4) glow = 0.0;

      // Glyph choice: most cells change rarely, a few flicker fast
      vec2 ch = vec2(col, cell.y);
      float rate = hash12(ch + 3.1) < 0.12 ? 10.0 : 0.4;
      float tick = floor(uTime * rate + hash12(ch + 9.7) * 10.0);
      float gi = floor(hash12(ch + tick * vec2(0.137, 0.731) + uSeed) * uCount);
      vec2 g = vec2(mod(gi, uGrid), floor(gi / uGrid));
      vec2 uv = (vec2(g.x, uGrid - 1.0 - g.y) + f) / uGrid;

      // Explicit gradients avoid mip seams at cell borders; a blurrier sample gives a halo
      vec2 dx = dFdx(p) / uGrid;
      vec2 dy = dFdy(p) / uGrid;
      float m = textureGrad(uAtlas, uv, dx, dy).r;
      float halo = textureGrad(uAtlas, uv, dx * 6.0, dy * 6.0).r;

      // Fade to average coverage when cells shrink below a pixel (grazing angles, distance)
      float px = max(length(dFdx(p)), length(dFdy(p)));
      float detail = 1.0 - smoothstep(0.35, 0.9, px);
      m = mix(0.22, m, detail);
      halo = mix(0.22, halo, detail);

      vec3 color = vec3(0.1, 1.0, 0.35) * glow * (m + halo * 0.6);
      if (d < 0.5 && glow > 0.0) color = vec3(0.85, 1.0, 0.9) * (m * 1.4 + halo * 0.8);

      float fog = 1.0 - smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
      gl_FragColor = vec4(color * fog * uReveal, 1.0);
    }
  `;

  function material(atlas, opts) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlas.texture },
        uGrid: { value: atlas.grid },
        uCount: { value: atlas.count },
        uTime: { value: 0 },
        uSide: { value: opts.side },
        uSeed: { value: opts.seed },
        uReveal: { value: 1 },
        uFogNear: { value: opts.fogNear },
        uFogFar: { value: opts.fogFar },
        uFillTop: { value: opts.fillTop },
        uFillTime: { value: opts.fillTime },
        uCell: { value: opts.cell }
      },
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
  }

  return { material, WRAP };
})();
