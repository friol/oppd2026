// Synthesis engines: each one turns the per-frame parameter tracks into samples at Klatt.SR.
// render(frames, voice) -> Float32Array (not normalized)
// Optional: prepare(settings, text) (Promise: external data to load first), voice (settings
// merged into the voice), shape(frames, built, voice, segs) to edit the frames before rendering.

const ENGINES = {
  klatt: { label: 'Klatt', render: (fr, voice) => Klatt.render(fr, voice) },
  // Recorded diphones (MBROLA program in WebAssembly); our durations and F0, with microprosody,
  // flutter and the singing details of voice.natural
  mbrola: {
    label: 'MBROLA',
    voice: { natural: true },
    prepare: (settings, text) => Mbrola.prepare(settings, text),
    shape: (fr, built, voice) => { Microprosody.apply(fr, built, voice); fr.built = built; },
    render: (fr, voice) => Mbrola.render(fr, voice)
  }
};
