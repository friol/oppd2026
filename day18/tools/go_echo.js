// Builds soundfx/go.wav from soundfx/go.ogg ("GO!" with lots of echo). Python cannot decode
// Ogg here, so this runs in the browser: open http://localhost/oppd2026/day18/ and evaluate this
// expression (e.g. via the DevTools Protocol); it returns the WAV file as base64.
(async () => {
  const buf = await (await fetch('soundfx/go.ogg')).arrayBuffer();
  const ac = new OfflineAudioContext(1, 48000, 48000);
  const ab = await ac.decodeAudioData(buf);
  const sr = ab.sampleRate, src = ab.getChannelData(0);
  // 1) cut the word (0.2 .. 0.85 s) out of the background hiss, 10 ms fade in, 80 ms fade out
  const a = Math.floor(0.2 * sr), b = Math.floor(0.85 * sr);
  const dry = new Float32Array(b - a);
  for (let i = 0; i < dry.length; i++) {
    let g = 1;
    if (i < 0.01 * sr) g = i / (0.01 * sr);
    if (i > dry.length - 0.08 * sr) g = (dry.length - i) / (0.08 * sr);
    dry[i] = src[a + i] * g;
  }
  // 2) lots of echo: early reflections + long stereo feedback delays, darker at every repeat
  const total = dry.length + Math.floor(3.6 * sr);
  const L = new Float32Array(total), R = new Float32Array(total);
  for (let i = 0; i < dry.length; i++) { L[i] += dry[i]; R[i] += dry[i]; }
  const early = [[0.023, 0.35, 0.3], [0.041, 0.28, 0.33], [0.059, 0.22, 0.2], [0.079, 0.18, 0.24]]; // delay, gain L, gain R
  for (const [d, gl, gr] of early) {
    const o = Math.floor(d * sr);
    for (let i = 0; i < dry.length; i++) { L[i + o] += dry[i] * gl; R[i + o] += dry[i] * gr; }
  }
  const dL = Math.floor(0.30 * sr), dR = Math.floor(0.37 * sr), fb = 0.58, mix = 0.7;
  const bufL = new Float32Array(total), bufR = new Float32Array(total);
  let lpL = 0, lpR = 0;
  const kLp = 1 - Math.exp(-2 * Math.PI * 2600 / sr);     // lowpass inside the loop
  for (let i = 0; i < total; i++) {
    const inp = i < dry.length ? dry[i] : 0;
    const eL = i >= dL ? bufR[i - dL] : 0;                 // cross feedback: ping-pong
    const eR = i >= dR ? bufL[i - dR] : 0;
    lpL += (eL - lpL) * kLp; lpR += (eR - lpR) * kLp;
    bufL[i] = inp + lpL * fb;
    bufR[i] = inp * 0.6 + lpR * fb;
    L[i] += lpL * mix; R[i] += lpR * mix;
  }
  // 3) normalize to -1 dBFS, write a 16-bit stereo WAV
  let peak = 0;
  for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = Math.pow(10, -1 / 20) / peak;
  const ab2 = new ArrayBuffer(44 + total * 4), v = new DataView(ab2);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + total * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, total * 4, true);
  for (let i = 0; i < total; i++) {
    v.setInt16(44 + i * 4, Math.max(-32767, Math.min(32767, L[i] * k * 32767)), true);
    v.setInt16(46 + i * 4, Math.max(-32767, Math.min(32767, R[i] * k * 32767)), true);
  }
  let bin = '';
  const u8 = new Uint8Array(ab2);
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(bin);
})()
