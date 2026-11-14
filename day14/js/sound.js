'use strict';
// Sound effects via Web Audio: positional (distance falloff + stereo pan) one-shots.
const Sound = (() => {
  const FILES = {
    door: { src: 'soundfx/metal-door-handle-opened-joshua-chivers-3-3-00-00.mp3', offset: 0.17, dur: 0.75, vol: 0.9 },
    step: { src: 'soundfx/footstep-on-sand-sneaker-gfx-sounds-1-1-00-01.mp3', offset: 0.03, dur: 0.5, vol: 0.13 },
    slime: { src: 'soundfx/blood-spitting-wet-visceral-gfx-sounds-spitting-blood-4-1-0m02s.mp3', offset: 0.08, dur: 0.75, vol: 1.0 },
    scuttle: { src: 'soundfx/175228__minigunfiend__creatures-scuttle-01.mp3', offset: 0.09, dur: 2.9, vol: 0.6 },
    xbow: { src: 'soundfx/161098__braqoon__arrow_damage.mp3', offset: 0.04, dur: 0.25, vol: 0.7 },
    zombie: { src: 'soundfx/163445__under7dude__zombie-4.mp3', offset: 0.04, dur: 2.0, vol: 0.9 },
    zombieDeath: { src: 'soundfx/796666__frostnox__mummy-zombie-death-1.ogg', offset: 0.06, dur: 2.05, vol: 3.0 },
    fireHit: { src: 'soundfx/683179__neartheatmoshphere__fireball.mp3', offset: 0, dur: 1.35, vol: 0.9 },
    spiderSteps: { src: 'soundfx/408572__miguelab1998__43spider_steps.mp3', offset: 0.23, dur: 0.65, vol: 1.0 },
    spiderBite: { src: 'soundfx/837907__frostnox__spider-eat-1.ogg', offset: 0.01, dur: 0.66, vol: 1.3 },
    iceShatter: { src: 'soundfx/486166__ruben_uitenweerde__glass-breaking.mp3', offset: 0.74, dur: 0.65, vol: 1.2, reverb: 0.8 },
    growl: { src: 'soundfx/706487__elpatino__creature-growl-6.mp3', offset: 0.03, dur: 1.05, vol: 2.6 },
    ice: { src: 'soundfx/519414__iridiuss__energymagic-shot.mp3', offset: 0, dur: 0.85, vol: 0.45 },
    fireball: { src: 'soundfx/442827__qubodup__fireball.mp3', offset: 0, dur: 0.95, vol: 0.7 },
    potion: { src: 'soundfx/41529__jamius__potiondrinklong.mp3', offset: 0, dur: 0.53, vol: 0.9 },
    heal: { src: 'soundfx/853303__tommasomotteran__magic-healing-spell-sfx-fantasy-rpg-restore-effect.mp3', offset: 0.2, dur: 1.75, vol: 1.8 },
    boneStep: { src: 'soundfx/420252__redroxpeterpepper__step-skeleton.mp3', offset: 0.04, dur: 0.5, vol: 0.75 },
    jump: { src: 'soundfx/542082__vinrax__player_jump.mp3', offset: 0.085, dur: 0.18, vol: 2.2 },
    thud: { src: 'soundfx/494932__yummy9987__thud2.mp3', offset: 0.54, dur: 0.6, vol: 0.5 },
    fire: { src: 'soundfx/363092__thewoodlandnomad__fire-crackle-and-flames-002.mp3', loop: [1.0, 20.0], vol: 2.2 },
    glow: { src: 'soundfx/752274__ienba__magic-glow.mp3', loop: [4.5, 38.5], vol: 0.35 },
    water: { src: 'soundfx/56777__arnaud-coutancier__fountain-fontaine-8.mp3', loop: [0.6, 12.6], vol: 0.8 },
    uiMove: { src: 'soundfx/707042__vilkas_sound__vs-button-click-05.mp3', offset: 0.025, dur: 0.18, vol: 0.6 },
    uiClick: { src: 'soundfx/241809__suntemple__magic-sfx-for-games.mp3', offset: 0, dur: 1.4, vol: 1.3 },
    death: { src: 'soundfx/760731__buffsatan__misson-failed.mp3', offset: 0.02, dur: 5.6, vol: 1.0 },
    locked: { src: 'soundfx/327738__distillerystudio__error_01.mp3', offset: 0, dur: 0.66, vol: 0.7 },
    key: { src: 'soundfx/875968__tommasomotteran__magical-ui-selection-stinger-mysterious-fantasy-game-sfx.mp3', offset: 0.03, dur: 1.3, vol: 1.6 },
  };
  const raw = {}, buffers = {};

  let ctx = null, master = null, enabled = true;
  const listener = { x: 0, z: 0, yaw: 0 };

  // Fetch the files early; decoding waits for the audio context (first user gesture).
  for (const [name, f] of Object.entries(FILES)) {
    raw[name] = fetch(f.src).then((r) => r.arrayBuffer()).catch(() => null);
  }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 1 : 0;
      master.connect(ctx.destination);
      for (const name of Object.keys(FILES)) {
        raw[name].then((data) => data && ctx.decodeAudioData(data))
          .then((buf) => { if (buf) buffers[name] = buf; })
          .catch(() => {});
      }
    }
    // Browsers may suspend or interrupt the context (background tab, device change).
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  // Looping ambient sources (e.g. running water): gain, pan and muffling are
  // updated every frame; the loop is created lazily once its buffer is ready.
  const loops = {};
  function ambient(name, level, pan = 0, muffled = false) {
    const f = FILES[name], buf = buffers[name];
    if (!ctx || !buf || ctx.state !== 'running') return;
    let L = loops[name];
    if (!L) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      [src.loopStart, src.loopEnd] = f.loop;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      src.connect(filter).connect(gain);
      if (panner) gain.connect(panner).connect(master); else gain.connect(master);
      src.start(0, f.loop[0] + Math.random() * 5);
      L = loops[name] = { gain, panner, filter };
    }
    const t = ctx.currentTime;
    L.gain.gain.setTargetAtTime(Math.max(0, level) * f.vol, t, 0.12);
    if (L.panner) L.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.12);
    L.filter.frequency.setTargetAtTime(muffled ? 700 : 18000, t, 0.15);
  }
  function silenceAmbient() {
    if (!ctx) return;
    for (const L of Object.values(loops)) L.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
  }

  // Distance falloff and stereo pan for a world position.
  function spatial(x, z, range) {
    const dx = x - listener.x, dz = z - listener.z, d = Math.hypot(dx, dz);
    const level = Math.max(0, 1 - Math.max(0, d - 1) / range) ** 1.6;
    const pan = d > 0.3 ? Math.sin(Math.atan2(dz, dx) - listener.yaw) * Math.min(1, d / 2) * 0.85 : 0;
    return { level, pan, d };
  }

  function setEnabled(on) {
    enabled = on;
    if (master) master.gain.value = on ? 1 : 0;
  }

  function setListener(x, z, yaw) { listener.x = x; listener.z = z; listener.yaw = yaw; }

  // opts: { x, z } for positional sounds, { vol, rate, pan, offset } overrides.
  // FILES entries may set `reverb` (send level to the shared reverb).
  // Shared reverb: a convolver with a synthetic hall impulse (decaying stereo noise).
  let reverb = null;
  function reverbBus() {
    if (reverb) return reverb;
    const len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 40 ? i / 40 : 1);
    }
    reverb = ctx.createConvolver();
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    reverb.connect(wet).connect(master);
    return reverb;
  }

  function play(name, opts = {}) {
    const f = FILES[name], buf = buffers[name];
    if (!ctx || !buf || !enabled || ctx.state !== 'running') return;
    let vol = f.vol * (opts.vol ?? 1), pan = opts.pan ?? 0;
    if (opts.x !== undefined) {
      const sp = spatial(opts.x, opts.z, 18);
      vol *= sp.level;
      if (vol < 0.01) return;
      pan = sp.pan;
    }
    const srcNode = ctx.createBufferSource();
    srcNode.buffer = buf;
    srcNode.playbackRate.value = opts.rate ?? 1;
    const gain = ctx.createGain();
    const offset = opts.offset ?? f.offset ?? 0;
    const dur = f.dur ?? buf.duration - offset;
    const t = ctx.currentTime, end = dur / srcNode.playbackRate.value;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.setValueAtTime(vol, t + end * 0.7);
    gain.gain.linearRampToValueAtTime(0, t + end);
    let node = srcNode.connect(gain);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(master);
    if (f.reverb) {
      const send = ctx.createGain();
      send.gain.value = f.reverb;
      node.connect(send).connect(reverbBus());
    }
    srcNode.start(t, offset, dur);
  }

  return { unlock, play, ambient, silenceAmbient, spatial, setListener, setEnabled };
})();
