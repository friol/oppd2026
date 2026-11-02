// Synthesis engines: each one turns the per-frame parameter tracks into samples at Klatt.SR.
// render(frames, voice) -> Float32Array (not normalized)
// Optional: prepare(settings, text) (Promise: external data to load first), preload(settings)
// (start that loading in the background when the engine is chosen), voices (the app voices it
// allows), voice (settings merged into the voice), shape(frames, built, voice, segs) to edit
// the frames before rendering.

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
  },
  // Neural speech (Piper models, onnxruntime-web); prepare() runs the models, sung words use MBROLA
  piper: {
    label: 'Piper',
    voice: { natural: true },
    voices: ['female'],     // both models are female voices
    preload: settings => Piper.preload(settings),
    prepare: (settings, text) => Piper.prepare(settings, text),
    shape: (fr, built, voice) => { Microprosody.apply(fr, built, voice); fr.built = built; },
    render: (fr, voice) => Piper.render(fr, voice)
  }
};
