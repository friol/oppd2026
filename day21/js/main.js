// Main: renderer, staged loading, cameras, input and the frame loop.
(function () {
  'use strict';
  const T = TRACK, S = SCENERY;
  let renderer, scene, camera, hud, hctx;
  const input = { throttle: false, brake: false };
  const clock = { last: performance.now(), t: 0 };

  // ---------------- Cameras ----------------
  const CAM = {
    names: ['Front seat', 'Back seat', 'Chase', 'Side', 'Trackside', 'Orbit'],
    mode: 0, look: { yaw: 0, pitch: 0 }, orbit: { yaw: 0.8, pitch: 0.35, dist: 28 }, chaseDist: 1,
    pos: new THREE.Vector3(), tgt: new THREE.Vector3(), smoothUp: new THREE.Vector3(0, 1, 0), spot: null,
  };
  window.CAM = CAM;
  CAM.set = function (m) {
    CAM.mode = m; CAM.look.yaw = 0; CAM.look.pitch = 0; CAM.fresh = true; CAM.spot = null;
    TRAIN.hideRider(m === 0 ? TRAIN.seatFront : m === 1 ? TRAIN.seatRear : null);
    try { localStorage.setItem('riemann.cam', String(m)); } catch (e) { }
  };
  CAM.preferred = function () { try { const v = parseInt(localStorage.getItem('riemann.cam')); return v >= 0 && v < 6 ? v : 0; } catch (e) { return 0; } };

  // Trackside camera spots along the track (outside of turns, at eye height above the ground)
  function buildSpots() {
    CAM.spots = [];
    const step = Math.round(45 / T.ds);
    for (let i = 0; i < T.N; i += step) {
      const p = T.P[i], tt = T.T[i];
      let side = [-tt[2], 0, tt[0]];
      const l = Math.hypot(side[0], side[2]) || 1; side = [side[0] / l, 0, side[2] / l];
      for (const sgn of [1, -1]) {
        const d = 14 + (i % 3) * 5;
        const x = p[0] + side[0] * d * sgn, z = p[2] + side[2] * d * sgn;
        if (TRACKMESH.nearTrack(x, z, 7)) continue;
        CAM.spots.push({ s: i * T.ds, pos: new THREE.Vector3(x, S.heightAt(x, z) + 1.7 + (i % 2) * 6, z) });
        break;
      }
    }
  }

  const m4 = new THREE.Matrix4(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), e3 = new THREE.Euler(0, 0, 0, 'YXZ');
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const fr = { pos: [0, 0, 0], t: [0, 0, 0], u: [0, 0, 0], r: [0, 0, 0] };
  function trainCenter(out) {
    if (TRAIN.derailed) return out.setFromMatrixPosition(TRAIN.carMatrix(2));
    T.frameAt(T.centerS(GAME.st.s), fr);
    return out.set(fr.pos[0], fr.pos[1] + 0.8, fr.pos[2]);
  }

  CAM.update = function (dt) {
    const st = GAME.st;
    const title = GAME.mode === 'title';
    let mode = title ? 'cine' : CAM.mode;
    const v = Math.abs(st.v);
    let fov = 60;
    camera.up.set(0, 1, 0);
    if (mode === 0 || mode === 1) {
      const seat = mode === 0 ? TRAIN.seatFront : TRAIN.seatRear;
      const cm = TRAIN.carMatrix(seat.car);
      // head sways with the g-forces
      const g = GAME.gNow;
      tmp.copy(seat.pos);
      tmp.y -= UTIL.clamp((g.vert - 1) * 0.025, -0.08, 0.1);
      tmp.x -= UTIL.clamp(g.lat * 0.05, -0.1, 0.1);
      tmp.applyMatrix4(cm);
      camera.position.copy(tmp);
      qa.setFromRotationMatrix(m4.extractRotation(cm));
      e3.set(CAM.look.pitch - 0.03, CAM.look.yaw, 0);
      qb.setFromEuler(e3);
      camera.quaternion.copy(qa).multiply(qb);
      // rumble
      const sh = Math.min(1, v / 30) * 0.0025;
      camera.rotateX((Math.random() - 0.5) * sh); camera.rotateY((Math.random() - 0.5) * sh);
      fov = 78 + Math.min(10, Math.max(0, v - 15) * 0.4);
      POST.speedBlur = UTIL.smooth(14, 34, v) * 0.9;
    } else {
      POST.speedBlur = 0;
      const c = trainCenter(CAM.tgt);
      if (mode === 2) {
        // chase: behind the last car, following the track frame with a damped spring
        T.frameAt(T.carS(st.s, T.N_CARS - 1) - 6 * CAM.chaseDist, fr);
        const want = tmp.set(fr.pos[0], fr.pos[1], fr.pos[2]).addScaledVector(tmp2.set(fr.u[0], fr.u[1], fr.u[2]), 3.2 * CAM.chaseDist);
        if (TRAIN.derailed) want.copy(c).add(tmp2.set(-10, 6, 10));
        if (CAM.fresh) CAM.pos.copy(want); else CAM.pos.lerp(want, 1 - Math.exp(-dt * 6));
        CAM.smoothUp.lerp(tmp2.set(fr.u[0], fr.u[1], fr.u[2]).multiplyScalar(0.25).add(new THREE.Vector3(0, 0.75, 0)), 1 - Math.exp(-dt * 3)).normalize();
        camera.position.copy(CAM.pos);
        camera.up.copy(CAM.smoothUp);
        T.frameAt(st.s + 6, fr);
        camera.lookAt(TRAIN.derailed ? c : tmp.set(fr.pos[0], fr.pos[1] + 0.8, fr.pos[2]));
        fov = 70;
      } else if (mode === 3) {
        T.frameAt(T.centerS(st.s), fr);
        const want = tmp.set(fr.pos[0], fr.pos[1], fr.pos[2]).addScaledVector(tmp2.set(fr.r[0], fr.r[1], fr.r[2]), 9).addScaledVector(tmp2.set(fr.u[0], fr.u[1], fr.u[2]), 2.2);
        if (TRAIN.derailed) want.copy(CAM.pos);
        if (CAM.fresh) CAM.pos.copy(want); else CAM.pos.lerp(want, 1 - Math.exp(-dt * 10));
        camera.position.copy(CAM.pos);
        CAM.smoothUp.lerp(tmp2.set(fr.u[0], fr.u[1], fr.u[2]).multiplyScalar(0.4).add(new THREE.Vector3(0, 0.6, 0)), 1 - Math.exp(-dt * 4)).normalize();
        camera.up.copy(CAM.smoothUp);
        camera.lookAt(c);
        fov = 62;
      } else if (mode === 4) {
        // trackside: pick the spot ahead of the train, keep it until the train is well past
        const sC = T.centerS(st.s);
        const ahead = (sp) => { let d = sp.s - sC; d = ((d % T.L) + T.L) % T.L; if (d > T.L / 2) d -= T.L; return d; };
        if (!CAM.spot || ahead(CAM.spot) < -35) {
          let best = null, bd = 1e9;
          for (const sp of CAM.spots) { const d = ahead(sp); if (d > 10 && d < bd) { bd = d; best = sp; } }
          CAM.spot = best || CAM.spots[0];
        }
        camera.position.copy(CAM.spot.pos);
        camera.lookAt(c);
        const dist = camera.position.distanceTo(c);
        fov = UTIL.clamp(2 * Math.atan(16 / dist) * 57.3, 12, 65);
      } else {
        // orbit (mode 5) and title cinematic
        if (mode === 'cine') { CAM.orbit.yaw += dt * 0.12; CAM.orbit.pitch = 0.22 + Math.sin(clock.t * 0.07) * 0.12; CAM.orbit.dist = 26; }
        else if (!CAM.dragging) CAM.orbit.yaw += dt * 0.05;
        const o = CAM.orbit;
        tmp.set(Math.cos(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.sin(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(c);
        const gnd = S.heightAt(tmp.x, tmp.z) + 1.2;
        if (tmp.y < gnd) tmp.y = gnd;
        if (CAM.fresh) CAM.pos.copy(tmp); else CAM.pos.lerp(tmp, 1 - Math.exp(-dt * 8));
        camera.position.copy(CAM.pos);
        camera.lookAt(c);
        fov = mode === 'cine' ? 55 : 60;
      }
    }
    CAM.fresh = false;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * (mode === 4 ? 20 : 4));
      camera.near = (mode === 0 || mode === 1) ? 0.05 : 0.2;
      camera.updateProjectionMatrix();
    }
  };

  // ---------------- Input ----------------
  function setupInput() {
    const keyDown = (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;   // typing a name: leave the keys alone
      // Browser shortcuts (F5, F11, F12, Ctrl/Alt/Cmd combinations) must reach the browser untouched.
      if (/^F\d{1,2}$/.test(e.key) || e.ctrlKey || e.altKey || e.metaKey) return;
      AUDIO.start();
      if (document.getElementById('help').classList.contains('show') && e.key !== 'h' && e.key !== 'H') { document.getElementById('help').classList.remove('show'); e.preventDefault(); return; }
      if (MENU.key(e)) { e.preventDefault(); return; }
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') input.throttle = true;
      else if (k === 'ArrowDown' || k === 's' || k === 'S') input.brake = true;
      else if (k === 'c' || k === 'C') { CAM.set((CAM.mode + 1) % 6); GAME.say(CAM.names[CAM.mode], 0.8, '#ffffff'); }
      else if (k >= '1' && k <= '6') { CAM.set(+k - 1); GAME.say(CAM.names[CAM.mode], 0.8, '#ffffff'); }
      else if (k === 'Escape' || k === 'p' || k === 'P') { if (GAME.mode !== 'title') { AUDIO.ui('back'); MENU.show('pause'); } }
      else if (k === 'n' || k === 'N') GAME.say(AUDIO.toggle() ? 'Sound on' : 'Sound off', 0.8);
      else if (k === 'h' || k === 'H') document.getElementById('help').classList.toggle('show');
      else if (k === ' ' && GAME.mode === 'ride') { if (GAME.st.hold > 0) GAME.st.hold = GAME.st.dwell; }
      else if ((k === 'r' || k === 'R') && GAME.mode === 'trial') { GAME.startTrial(); CAM.set(CAM.mode); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') input.throttle = false;
      if (k === 'ArrowDown' || k === 's' || k === 'S') input.brake = false;
    }, true);
    window.addEventListener('blur', () => { input.throttle = input.brake = false; if (GAME.mode !== 'title' && !MENU.open) MENU.show('pause'); });
    const cv = renderer.domElement;
    // Pointers on the canvas: one finger / the mouse looks around, two fingers pinch to zoom.
    const ptrs = new Map();
    let pinch = 0;
    const pdist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const zoom = (f) => {
      CAM.orbit.dist = UTIL.clamp(CAM.orbit.dist * f, 6, 250);
      CAM.chaseDist = UTIL.clamp(CAM.chaseDist * f, 0.5, 3);
    };
    cv.addEventListener('pointerdown', (e) => {
      AUDIO.start();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      CAM.dragging = true; cv.setPointerCapture(e.pointerId);
      if (ptrs.size === 2) pinch = pdist();
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size >= 2) {
        const d = pdist();
        if (pinch > 0 && d > 0) zoom(pinch / d);
        pinch = d;
        return;
      }
      if (CAM.mode <= 1) {
        CAM.look.yaw = UTIL.clamp(CAM.look.yaw - dx * 0.004, -2.4, 2.4);
        CAM.look.pitch = UTIL.clamp(CAM.look.pitch - dy * 0.004, -1.2, 1.2);
      } else {
        CAM.orbit.yaw += dx * 0.006;
        CAM.orbit.pitch = UTIL.clamp(CAM.orbit.pitch + dy * 0.005, -0.1, 1.45);
        if (CAM.mode !== 5) CAM.set(5);
      }
    });
    const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) CAM.dragging = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', () => { CAM.look.yaw = 0; CAM.look.pitch = 0; });
    cv.addEventListener('wheel', (e) => {
      zoom(Math.exp(e.deltaY * 0.001));
      e.preventDefault();
    }, { passive: false });
    setupTouch();
  }

  // On-screen buttons for touch devices (gas / brake and a few shortcuts). They are plain DOM buttons
  // above the canvas; each pointer is independent, so gas and brake can be held with both thumbs.
  function setupTouch() {
    // Detection is deliberately generous (iPads with a keyboard or trackpad report a fine primary pointer, and
    // iPadOS pretends to be a desktop): any touch capability counts, and the first real touch turns it on too.
    const isTouch = (window.matchMedia && (matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches)) ||
      'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) document.body.classList.add('touch');
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') document.body.classList.add('touch'); }, true);
    const hold = (id, key) => {
      const el = document.getElementById(id);
      const set = (v, e) => { input[key] = v; el.classList.toggle('down', v); if (e) e.preventDefault(); };
      el.addEventListener('pointerdown', (e) => { AUDIO.start(); el.setPointerCapture(e.pointerId); set(true, e); });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => el.addEventListener(t, (e) => set(false, e)));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('tGas', 'throttle'); hold('tBrake', 'brake');
    const tap = (id, fn) => document.getElementById(id).addEventListener('click', (e) => { AUDIO.start(); fn(); e.preventDefault(); });
    tap('tCam', () => { CAM.set((CAM.mode + 1) % 6); GAME.say(CAM.names[CAM.mode], 0.8, '#ffffff'); });
    tap('tPause', () => { if (GAME.mode !== 'title' && !MENU.open) { AUDIO.ui('back'); MENU.show('pause'); } });
    tap('tRestart', () => { if (GAME.mode === 'trial') { GAME.startTrial(); CAM.set(CAM.mode); } });
    tap('tSound', () => GAME.say(AUDIO.toggle() ? 'Sound on' : 'Sound off', 0.8));
    tap('tDispatch', () => { if (GAME.mode === 'ride' && GAME.st.hold > 0) GAME.st.hold = GAME.st.dwell; });
    const fsEl = document.documentElement;
    if (fsEl.requestFullscreen) tap('tFull', () => { if (document.fullscreenElement) document.exitFullscreen(); else fsEl.requestFullscreen().catch(() => { }); });
    else document.getElementById('tFull').style.display = 'none';
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(dpr);
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    hud.width = Math.round(window.innerWidth * dpr); hud.height = Math.round(window.innerHeight * dpr);
    POST.resize();
  }

  // ---------------- Loop ----------------
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    let dt = (now - clock.last) / 1000;
    clock.last = now;
    dt = Math.min(dt, 0.05);
    clock.t += dt;
    GAME.update(dt, input);
    document.body.dataset.tm = MENU.open ? 'menu' : GAME.mode;   // lets the CSS show the touch buttons that make sense
    const st = GAME.st;
    const z = T.zoneAt(T.centerS(st.s));
    TRAIN.place(st.s, dt, GAME.gNow.vert, Math.abs(st.v));
    CAM.update(dt);
    S.update(clock.t, camera);
    trainCenter(tmp);
    S.updateSun(tmp);
    const near = UTIL.clamp(1 - (camera.position.distanceTo(tmp) - 12) / 140, 0.12, 1);
    AUDIO.update(dt, { v: TRAIN.derailed || GAME.paused ? 0 : st.v, lift: z === T.Z.lift, brake: st.brakeOn > 0, motor: st.motorOn || 0, pov: CAM.mode <= 1 && GAME.mode !== 'title', near, paused: GAME.paused });
    if (POST.flash) POST.flash = Math.max(0, POST.flash - dt * 1.5);
    POST.render(scene, camera, clock.t);
    GAME.drawHud(hctx, hud.width, hud.height, CAM.names[CAM.mode] || '');
  }

  // ---------------- Staged loading ----------------
  function setStatus(txt, f) {
    document.getElementById('status').textContent = txt;
    document.getElementById('bar').style.width = Math.round(f * 100) + '%';
  }

  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    document.getElementById('app').appendChild(renderer.domElement);
    hud = document.getElementById('hud');
    hctx = hud.getContext('2d');
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(S.fogColor, 0.00021);
    camera = new THREE.PerspectiveCamera(60, 1, 0.2, 20000);
    window._dbg = { scene, camera, renderer };

    const steps = [
      ['Laying out the track…', () => T.build()],
      ['Sky and light…', () => { S.buildSky(scene); S.buildLights(scene); S.buildEnv(renderer, scene); }],
      ['Shaping the valley…', () => S.buildTerrain(scene)],
      ['Welding rails and supports…', () => TRACKMESH.build(scene)],
      ['Growing grass and trees…', () => { S.buildGrass(scene); S.buildTrees(scene, (x, z) => TRACKMESH.nearTrack(x, z, 16) || (x > -70 && x < 5 && Math.abs(z) < 16)); }],
      ['Building the station and the train…', () => { S.buildStation(scene); TRAIN.build(scene); }],
      ['Testing the brakes…', () => { POST.init(renderer); GAME.init(); buildSpots(); setupInput(); resize(); window.addEventListener('resize', resize); }],
      ['Compiling shaders…', () => { TRAIN.place(GAME.st.s, 0.016, 1, 0); CAM.update(0.016); S.update(0, camera); renderer.compile(scene, camera); }],
    ];
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        document.getElementById('loading').classList.add('done');
        setTimeout(() => document.getElementById('loading').remove(), 900);
        CAM.set(CAM.preferred());
        MENU.show('title');
        clock.last = performance.now();
        frame();
        return;
      }
      setStatus(steps[i][0], i / steps.length);
      setTimeout(() => {
        try { steps[i][1](); } catch (err) { console.error(err); setStatus('Error: ' + err.message, 1); throw err; }
        i++;
        next();
      }, 20);
    };
    next();
  }

  window.addEventListener('load', init);
})();
