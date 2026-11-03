// Slow pulse that follows the bass of the background music, from 0 to 1.
// Uses a Web Audio analyser on the <audio> element. On file:// the browser treats the
// mp3 as cross-origin and the analyser would only see silence (and mute the music),
// so there level() returns null and callers fall back to their own pulse.
const Beat = (() => {
  const LOW = 30, HIGH = 160;    // bass band in Hz
  const ATTACK = 0.12, RELEASE = 0.7; // seconds: quick rise, slow fall

  function create(audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const usable = Ctx && location.protocol !== 'file:';
    let ctx = null, analyser = null, gain = null, bins = null;
    let floor = 0, peak = 0.01, level = 0;

    // The context can only run after a user gesture; until it does, the element plays
    // on its own, so it is routed through the graph only once the context is running.
    function connect() {
      if (!usable || analyser) return;
      if (!ctx) ctx = new Ctx();
      if (ctx.state !== 'running') { ctx.resume().catch(() => {}); return; }
      const source = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      gain = ctx.createGain();
      gain.gain.value = audio.muted ? 0 : 1;
      audio.muted = false; // muting is done by the gain, so the analyser still hears the music
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);
      bins = new Uint8Array(analyser.frequencyBinCount);
    }
    window.addEventListener('pointerdown', connect);
    window.addEventListener('keydown', connect);

    // Smoothed bass energy, normalized against a slowly adapting floor and peak
    function update(dt) {
      if (!usable) return null;
      if (!analyser) { if (!audio.paused) connect(); return analyser ? 0 : null; }
      analyser.getByteFrequencyData(bins);
      const hz = ctx.sampleRate / analyser.fftSize;
      const a = Math.max(1, Math.floor(LOW / hz)), b = Math.ceil(HIGH / hz);
      let sum = 0;
      for (let i = a; i <= b; i++) sum += bins[i];
      const e = sum / ((b - a + 1) * 255);

      floor = e < floor ? e : floor + (e - floor) * Math.min(dt * 0.3, 1);
      peak = e > peak ? e : peak + (e - peak) * Math.min(dt * 0.15, 1);
      const target = Math.min(Math.max((e - floor) / Math.max(peak - floor, 0.02), 0), 1);
      const k = 1 - Math.exp(-dt / (target > level ? ATTACK : RELEASE));
      level += (target - level) * k;
      return level;
    }

    function toggleMute() {
      if (gain) gain.gain.value = gain.gain.value > 0 ? 0 : 1;
      else audio.muted = !audio.muted;
    }

    return { update, toggleMute };
  }

  return { create };
})();
