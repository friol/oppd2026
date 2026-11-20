// main.js - boot (time-sliced world generation with a progress bar), input, game loop.
(function () {
  'use strict';
  const U = GLSL.U;
  let renderer, scene, overlay, camera, light;
  let ready = false, help = false, invert = false;
  let simTime = 0, last = performance.now(), flash = 0;
  let fps = 0, fpsAcc = 0, fpsN = 0;
  const keys = {};
  const stick = { x: 0, y: 0 };
  let mouseActive = false, rightDown = false, wheel = 0;
  let coverageIdx = 1;
  const COVERAGE = [0.12, 0.42, 0.62, 0.85];
  const COVER_NAMES = ['Clear skies', 'Scattered clouds', 'Broken clouds', 'Overcast'];
  let ambTimer = 0;

  const $ = (id) => document.getElementById(id);
  function progress(p, label) {
    $('bar').style.width = Math.round(p * 100) + '%';
    $('status').textContent = label;
  }
  const nextFrame = () => new Promise(r => setTimeout(r, 0));

  async function boot() {
    // 1. world generation, sliced so the page stays responsive
    const gen = WORLD.generate();
    let t0 = performance.now();
    for (;;) {
      const r = gen.next();
      if (r.done) break;
      if (performance.now() - t0 > 40) { progress(r.value[0] * 0.8, r.value[1] + '…'); await nextFrame(); t0 = performance.now(); }
    }
    progress(0.82, 'Brewing clouds…'); await nextFrame();
    const shape = NOISE.cloudShapeTexture(64);
    const detail = NOISE.cloudDetailTexture(32);
    progress(0.9, 'Preparing the jet…'); await nextFrame();

    // 2. renderer and scene
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('app').appendChild(renderer.domElement);
    scene = new THREE.Scene();
    overlay = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 90000);

    const W = WORLD;
    const ht = new THREE.DataTexture(W.height, W.N, W.N, THREE.RedFormat, THREE.FloatType);
    ht.minFilter = ht.magFilter = THREE.NearestFilter; ht.needsUpdate = true;
    const nt = new THREE.DataTexture(W.normal, W.N, W.N, THREE.RGBAFormat, THREE.UnsignedByteType);
    nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter; nt.generateMipmaps = true; nt.anisotropy = 8; nt.needsUpdate = true;
    U.tHeight.value = ht; U.tNormal.value = nt;

    light = new THREE.DirectionalLight(0xffffff, 1 / Math.PI);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    const sc = light.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 3000;
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.04;
    scene.add(light, light.target);

    ATMO.init(renderer);
    TERRAIN.init(scene);
    WATER.init(scene);
    VEG.init(scene);
    TOWNS.init(scene);
    await LIFE.init(scene, overlay, camera);
    await SHIP.init(scene, overlay);
    POST.init(renderer, shape, detail);
    HUD.init($('hud'));
    GAME.init(scene, overlay);
    FX.init(overlay);
    MUSIC.init();

    const s = W.spawn;
    SHIP.reset(s.x, s.y, s.z, s.dirx, s.dirz);
    SHIP.updateCamera(camera, 1);
    progress(0.97, 'Compiling shaders…'); await nextFrame();
    // warm up: render one frame so all programs are compiled before the reveal
    frame(1 / 60, true);
    progress(1, 'Ready');
    ready = true;
    $('loading').classList.add('done');
    GAME.showMenu();
    requestAnimationFrame(loop);
  }

  // ---------------- input ----------------
  function bindInput() {
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (!ready) return;
      switch (e.code) {
        case 'KeyC': SHIP.camMode = (SHIP.camMode + 1) % 3; HUD.message(['Chase camera', 'Cockpit view', 'Cinematic camera'][SHIP.camMode], 1.5); break;
        case 'KeyM': GAME.toggleMenu(); break;
        case 'KeyN': HUD.message(MUSIC.toggle() ? 'Music on — “Cruising Altitude”' : 'Music off', 1.5); GAME.refreshMenu(); break;
        case 'KeyH': help = !help; $('help').classList.toggle('show', help); break;
        case 'KeyP': GAME.togglePause(); break;
        case 'KeyT': ATMO.hours = (ATMO.hours + 1) % 24; ATMO.forceEnvUpdate(); POST.resetHistory(); break;
        case 'BracketRight': ATMO.daySpeed = Math.min(3600, ATMO.daySpeed * 2); HUD.message('Time ×' + ATMO.daySpeed, 1.5); break;
        case 'BracketLeft': ATMO.daySpeed = Math.max(1, ATMO.daySpeed / 2); HUD.message('Time ×' + ATMO.daySpeed, 1.5); break;
        case 'KeyG': POST.setQuality((POST.quality + 2) % 3); HUD.message('Graphics: ' + ['low', 'medium', 'high'][POST.quality], 1.5); break;
        case 'KeyI': invert = !invert; HUD.message(invert ? 'Mouse pitch inverted' : 'Mouse pitch normal', 1.5); break;
        case 'KeyL': coverageIdx = (coverageIdx + 1) % COVERAGE.length; HUD.message(COVER_NAMES[coverageIdx], 1.5); POST.resetHistory(); break;
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    window.addEventListener('blur', () => {
      for (const k in keys) keys[k] = false;
      if (ready && !GAME.blocking()) GAME.togglePause(); // auto-pause when the window loses focus
    });

    const app = $('app');
    app.addEventListener('mousedown', (e) => {
      if (!ready) return;
      if (e.button === 2) { rightDown = true; SHIP.look.hold = true; }
      if (e.button === 0 && !mouseActive && !GAME.blocking()) app.requestPointerLock();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) { rightDown = false; SHIP.look.hold = false; } });
    app.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      mouseActive = document.pointerLockElement === app;
      if (!mouseActive) { stick.x = 0; stick.y = 0; }
    });
    window.addEventListener('mousemove', (e) => {
      if (!ready) return;
      if (rightDown) {
        SHIP.look.yaw -= e.movementX * 0.004;
        SHIP.look.pitch = THREE.MathUtils.clamp(SHIP.look.pitch - e.movementY * 0.004, -1.2, 1.2);
      } else if (mouseActive) {
        stick.x = THREE.MathUtils.clamp(stick.x + e.movementX * 0.0035, -1, 1);
        stick.y = THREE.MathUtils.clamp(stick.y - e.movementY * 0.0035 * (invert ? -1 : 1), -1, 1);
      }
    });
    window.addEventListener('wheel', (e) => { wheel += -Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('resize', () => {
      if (!ready) return;
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      POST.resize(); HUD.resize();
    });
  }

  function readInput(dt) {
    const k = (a, b) => (keys[a] || keys[b]) ? 1 : 0;
    // the mouse stick slowly re-centres by itself
    const rc = Math.exp(-dt * 0.8);
    stick.x *= rc; stick.y *= rc;
    const dz = (v) => Math.abs(v) < 0.04 ? 0 : (v - Math.sign(v) * 0.04) / 0.96;
    const pitch = THREE.MathUtils.clamp(dz(stick.y) + k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp'), -1, 1);
    const roll = THREE.MathUtils.clamp(dz(stick.x) + k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), -1, 1);
    const yaw = k('KeyE', 'KeyE') - k('KeyQ', 'KeyQ');
    let th = k('KeyR', 'Equal') - k('KeyF', 'Minus') + wheel * 6;
    wheel = 0;
    return { pitch, roll, yaw, throttleDelta: th, boost: keys.ShiftLeft || keys.ShiftRight || keys.Space };
  }

  // ---------------- frame ----------------
  const camDir = new THREE.Vector3();
  function placeName() {
    let best = null, bd = 1e9;
    for (const t of WORLD.towns) { const d = Math.hypot(t.x - SHIP.pos.x, t.z - SHIP.pos.z); if (d < bd) { bd = d; best = t; } }
    if (!best) return '';
    return bd < best.r * 1.5 ? 'Over ' + best.name : (bd / 1000).toFixed(1) + ' km from ' + best.name;
  }

  function updateAmbient() {
    // read the sky LUT (zenith row) back to estimate the sky ambient colour
    const w = 256, buf = new Uint16Array(w * 4);
    renderer.readRenderTargetPixels(ATMO.skyTarget, 0, 118, w, 1, buf);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < w; i++) { r += THREE.DataUtils.fromHalfFloat(buf[i * 4]); g += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]); b += THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]); }
    WATER.uniforms.uAmbient.value.setRGB(r / w, g / w, b / w);
    LIFE.ambient.value.setRGB(r / w, g / w, b / w);
  }

  function frame(dt, warm) {
    // the game menu and the results screen pause the simulation like P does
    const halted = GAME.blocking(); // main menu or pause screen
    if (!halted) simTime += dt;
    U.uTime.value = simTime;
    const input = readInput(dt);
    let crash = false;
    if (!halted) crash = SHIP.update(dt, input);
    if (crash && SHIP.crashed <= 0 && GAME.onCrash()) {
      flash = 1;
      SHIP.crashed = 1;
      POST.resetHistory();
    } else if (crash && SHIP.crashed <= 0) {
      flash = 1;
      HUD.message('CRASHED! Back in the air…', 3);
      const g = Math.max(WORLD.heightAt(SHIP.pos.x, SHIP.pos.z), 0);
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(SHIP.quat); f.y = 0;
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      SHIP.reset(SHIP.pos.x - f.x * 200, g + 380, SHIP.pos.z - f.z * 200, f.x, f.z);
      SHIP.crashed = 1;
      POST.resetHistory();
    }
    flash = Math.max(0, flash - dt * 0.8);
    SHIP.updateCamera(camera, dt);
    GAME.update(halted ? 0 : dt, camera);
    FX.update(halted ? 0 : dt, camera, halted);

    // weather and time
    if (!halted) {
      const windScale = (1 + ATMO.daySpeed / 60) * 0.5;
      U.uWind.value.x += 14 * dt * windScale; U.uWind.value.y += 5 * dt * windScale;
      ATMO.update(dt, renderer, scene, camera.position.y);
    } else ATMO.update(0, renderer, scene, camera.position.y);
    const target = COVERAGE[coverageIdx] + 0.06 * Math.sin(simTime * 0.01);
    U.uCoverage.value += (target - U.uCoverage.value) * Math.min(1, dt * 0.5);

    ambTimer -= dt;
    if (ambTimer <= 0 || warm) { ambTimer = 0.5; updateAmbient(); }

    // shadow light follows the ship
    light.color.copy(U.uLightColor.value);
    light.position.copy(SHIP.pos).addScaledVector(U.uLightDir.value, 1500);
    light.target.position.copy(SHIP.pos);
    light.target.updateMatrixWorld();
    light.visible = U.uLightDir.value.y > -0.02;

    WATER.updateReflection(camera);
    TERRAIN.update(camera, WATER.reflCamera);
    VEG.update(camera.position);
    camera.getWorldDirection(camDir);
    if (!halted) LIFE.update(dt, simTime, camera.position, camDir);

    POST.render(scene, overlay, camera, { refl: [] }, flash);

    HUD.draw({
      ready: true, ship: SHIP, hours: ATMO.hours, daySpeed: ATMO.daySpeed, paused: GAME.isPaused(), quality: POST.quality, fps,
      place: placeName(), mouseActive, stick, help, menu: GAME.blocking() || GAME.state === 'results'
    });
    if (HUD.msgTime > 0) HUD.msgTime -= dt;
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    frame(dt, false);
    requestAnimationFrame(loop);
  }

  bindInput();
  window.addEventListener('load', () => { boot().catch(err => { console.error(err); progress(1, 'Error: ' + err.message); }); });
  window.SIM = { get camera() { return camera; }, get renderer() { return renderer; } };
})();
