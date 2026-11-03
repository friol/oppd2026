// Scene and camera timeline: one plane seen head-on, a 90 degree turn that reveals
// a corridor of parallel planes, then an endless flight between them.
(async () => {
  const CELL = new THREE.Vector2(0.055, 0.07); // world size of a glyph cell
  const GAP = 4;            // distance between parallel planes
  const PLANES = 7;         // planes on each side of the camera
  const LENGTH = 120;       // plane extent along the flight direction
  const HEIGHT = 100;       // tall enough to fill the view while the camera rolls
  const FOG_NEAR = 8, FOG_FAR = 45;

  const FILL_TIME = 4;      // columns start falling within this many seconds
  const FILL_TOP = 1.2;     // world y where the first drops enter (top of the first view)
  const HOLD = 10;          // seconds looking at the single plane
  const TURN = 5;           // seconds for the 90 degree turn
  const MAX_SPEED = 3;      // units per second
  const ROLL_PERIOD = 60;   // seconds for a full 360 degree roll once the turn is done

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.rotation.order = 'YXZ';

  const atlas = await Atlas.create(renderer.capabilities.getMaxAnisotropy());
  const geometry = new THREE.PlaneGeometry(LENGTH, HEIGHT);
  const planes = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < PLANES; k++) {
      const mat = Rain.material(atlas, {
        side, seed: planes.length * 31.7 + 1, cell: CELL, fogNear: FOG_NEAR, fogFar: FOG_FAR,
        fillTop: FILL_TOP, fillTime: FILL_TIME
      });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.rotation.y = Math.PI / 2;
      mesh.position.x = side * (k + 0.5) * GAP;
      mesh.frustumCulled = false;
      scene.add(mesh);
      // The first plane on the left is the one seen head-on at the start
      planes.push({ mesh, mat, first: side < 0 && k === 0 });
    }
  }

  const panels = Panels.create(scene, {
    count: 70, depth: FOG_FAR + 10, spreadX: PLANES * GAP, spreadY: 14,
    fadeSpread: TURN, fogNear: FOG_NEAR, fogFar: FOG_FAR,
    anisotropy: renderer.capabilities.getMaxAnisotropy()
  });

  const smooth = x => {
    x = Math.min(Math.max(x, 0), 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
  };

  let time = 0;
  let z = 0;
  let paused = false;
  let roll = 0;
  const wrapLength = Rain.WRAP * CELL.x;

  function update(dt) {
    time += dt;
    const turn = smooth((time - HOLD) / TURN);
    const reveal = smooth((time - HOLD) / (TURN * 0.6));
    const speed = MAX_SPEED * smooth((time - HOLD - TURN * 0.4) / 4);
    const drift = speed / MAX_SPEED;

    z -= speed * dt;
    let shift = 0;
    if (z < -wrapLength) shift = wrapLength;
    z += shift;
    panels.update(time, dt, time - HOLD, z, shift);

    // Facing -X (the first plane) at the start, facing -Z (down the corridor) at the end
    camera.rotation.y = Math.PI / 2 * (1 - turn) + 0.04 * Math.sin(time * 0.17) * drift;
    // Slow endless roll around the view axis, easing in after the turn
    roll += 2 * Math.PI / ROLL_PERIOD * smooth((time - HOLD - TURN) / 4) * dt;
    camera.rotation.z = roll;
    camera.position.set(0, 0.15 * Math.sin(time * 0.21) * drift, z);

    for (const p of planes) {
      p.mesh.position.z = z;
      p.mat.uniforms.uTime.value = time;
      p.mat.uniforms.uReveal.value = p.first ? 1 : reveal;
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!paused) update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const hint = document.getElementById('hint');
  setTimeout(() => hint.classList.add('hidden'), 5000);
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') paused = !paused;
    else if (e.code === 'KeyR') { time = 0; z = 0; roll = 0; panels.reset(); }
    else if (e.code === 'KeyF') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } else if (e.code === 'KeyH') hint.classList.toggle('hidden');
  });
})();
