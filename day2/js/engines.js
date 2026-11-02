// Synthesis engines: each one turns the per-frame parameter tracks into samples at Klatt.SR.
// render(frames, voice) -> Float32Array (not normalized)
// Optional: voice (settings merged into the voice), segments(segs, phones, voice) to edit
// segment targets, shape(frames, built, voice, segs) to edit the frame tracks before rendering.

const ENGINES = {
  klatt:   { label: 'Klatt',   render: (fr, voice) => Klatt.render(fr, voice) },
  natural: {
    label: 'Natural',
    voice: Natural.voice,
    segments: (segs, phones) => Natural.undershoot(segs, phones),
    shape: (fr, built, voice) => Natural.shape(fr, built, voice),
    render: (fr, voice) => Klatt.render(fr, voice)
  },
  // Formants from the vocal tract model (undershoot comes from its dynamics), then Natural
  articulatory: {
    label: 'Articulatory',
    voice: Natural.voice,
    shape: (fr, built, voice, segs) => { Articulatory.shape(fr, segs, voice); Natural.shape(fr, built, voice); },
    render: (fr, voice) => Klatt.render(fr, voice)
  }
};
