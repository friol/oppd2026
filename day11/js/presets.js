// OPPD-1 factory presets (synth sounds and drum kits) and the demo project
'use strict';

const W = { SAW: 0, SQUARE: 1 / 3, TRI: 2 / 3, SINE: 1 };
const fx = (type, p1, p2, mix) => ({ type, p1, p2, mix });
const arp = (mode, rate, oct, gate, hold) => ({ mode, rate, oct, gate, hold: !!hold });

const SYNTH_PRESETS = [
  // PAD
  { name: 'GLASS PAD', engine: 'pad', params: { wave: W.SAW, detune: 0.45, cutoff: 0.55, reso: 0.2, attack: 0.55, release: 0.6, lfo: 0.3, lfoamt: 0.25 }, fx: [fx('CHORUS', 0.3, 0.5, 0.5), fx('REVERB', 0.7, 0.4, 0.45)] },
  { name: 'WARM STRINGS', engine: 'pad', params: { wave: W.SAW, detune: 0.6, cutoff: 0.45, reso: 0.05, attack: 0.5, release: 0.5, lfo: 0.5, lfoamt: 0.1 }, fx: [fx('REVERB', 0.6, 0.5, 0.35)] },
  { name: 'DARK DRONE', engine: 'pad', params: { wave: W.SQUARE, detune: 0.3, cutoff: 0.3, reso: 0.5, attack: 0.8, release: 0.8, lfo: 0.15, lfoamt: 0.5 }, fx: [fx('FLANGER', 0.2, 0.6, 0.5), fx('REVERB', 0.9, 0.6, 0.5)] },
  { name: 'SUNRISE', engine: 'pad', params: { wave: W.TRI, detune: 0.5, cutoff: 0.7, reso: 0.1, attack: 0.6, release: 0.7, lfo: 0.4, lfoamt: 0.15 }, fx: [fx('DELAY', 0.75, 0.4, 0.3), fx('REVERB', 0.8, 0.3, 0.4)] },
  // LEAD
  { name: 'SAW LEAD', engine: 'lead', params: { wave: W.SAW, cutoff: 0.65, reso: 0.25, glide: 0.15, envamt: 0.35, decay: 0.35, vibrato: 0.25, detune: 0.3 }, fx: [fx('DELAY', 0.4, 0.35, 0.25), fx('REVERB', 0.5, 0.5, 0.2)] },
  { name: 'SQUARE SOLO', engine: 'lead', params: { wave: W.SQUARE, cutoff: 0.55, reso: 0.1, glide: 0.25, envamt: 0.2, decay: 0.4, vibrato: 0.3, detune: 0 }, fx: [fx('REVERB', 0.5, 0.5, 0.3)] },
  { name: 'SCREAMER', engine: 'lead', params: { wave: W.SAW, cutoff: 0.45, reso: 0.7, glide: 0.1, envamt: 0.7, decay: 0.25, vibrato: 0.2, detune: 0.5 }, fx: [fx('DISTORT', 0.5, 0.6, 0.7), fx('DELAY', 0.4, 0.3, 0.2)] },
  { name: 'SOFT FLUTE', engine: 'lead', params: { wave: W.TRI, cutoff: 0.5, reso: 0, glide: 0.2, envamt: 0.1, decay: 0.5, vibrato: 0.4, detune: 0.1 }, fx: [fx('REVERB', 0.6, 0.3, 0.35)] },
  // BASS
  { name: 'ACID 303', engine: 'bass', params: { wave: W.SAW, cutoff: 0.25, reso: 0.8, envamt: 0.7, decay: 0.25, sub: 0, drive: 0.4, glide: 0.2 }, fx: [fx('DELAY', 0.4, 0.25, 0.15)] },
  { name: 'SUB BASS', engine: 'bass', params: { wave: W.SINE, cutoff: 0.5, reso: 0, envamt: 0, decay: 0.6, sub: 0.8, drive: 0.1, glide: 0 } },
  { name: 'FUNK BASS', engine: 'bass', params: { wave: W.SQUARE, cutoff: 0.3, reso: 0.4, envamt: 0.5, decay: 0.2, sub: 0.5, drive: 0.2, glide: 0 } },
  { name: 'REESE', engine: 'bass', params: { wave: W.SAW, cutoff: 0.35, reso: 0.2, envamt: 0.15, decay: 0.7, sub: 0.6, drive: 0.3, glide: 0.05 }, fx: [fx('CHORUS', 0.2, 0.7, 0.6)] },
  // GUITAR
  { name: 'NYLON', engine: 'guitar', params: { bright: 0.45, damp: 0.55, sustain: 0.45, body: 0.6, pick: 0.3, drive: 0, tone: 0.6, release: 0.35 }, fx: [fx('REVERB', 0.4, 0.5, 0.25)] },
  { name: 'STEEL', engine: 'guitar', params: { bright: 0.8, damp: 0.25, sustain: 0.6, body: 0.4, pick: 0.2, drive: 0, tone: 0.8, release: 0.4 }, fx: [fx('CHORUS', 0.25, 0.3, 0.3), fx('REVERB', 0.5, 0.4, 0.25)] },
  { name: 'MUTED', engine: 'guitar', params: { bright: 0.5, damp: 0.8, sustain: 0.1, body: 0.5, pick: 0.4, drive: 0.1, tone: 0.5, release: 0.1 } },
  { name: 'OVERDRIVE', engine: 'guitar', params: { bright: 0.8, damp: 0.3, sustain: 0.75, body: 0.3, pick: 0.15, drive: 0.75, tone: 0.55, release: 0.5 }, fx: [fx('DELAY', 0.45, 0.3, 0.2), fx('REVERB', 0.5, 0.5, 0.2)] },
  // GRAIN (source index: CHOIR 0, BELLS .2, STRING .4, GLASS .6, NOISE .8, RESAMPLE 1)
  { name: 'FROZEN CHOIR', engine: 'grain', params: { source: 0, position: 0.3, scan: 0.5, spray: 0.15, size: 0.7, density: 0.6, spread: 0.35, swell: 0.7 }, fx: [fx('CHORUS', 0.2, 0.4, 0.3), fx('REVERB', 0.8, 0.4, 0.45)] },
  { name: 'SHIMMER', engine: 'grain', params: { source: 0.6, position: 0.5, scan: 0.56, spray: 0.3, size: 0.55, density: 0.75, spread: 0.55, swell: 0.8 }, fx: [fx('CHORUS', 0.3, 0.5, 0.4), fx('REVERB', 0.9, 0.2, 0.55)] },
  { name: 'BELL SWARM', engine: 'grain', params: { source: 0.2, position: 0.1, scan: 0.6, spray: 0.4, size: 0.25, density: 0.8, spread: 0.7, swell: 0.55 }, fx: [fx('DELAY', 0.55, 0.45, 0.3), fx('REVERB', 0.6, 0.3, 0.3)] },
  { name: 'GLITCH CLOUD', engine: 'grain', params: { source: 0.4, position: 0.2, scan: 0.64, spray: 0.55, size: 0.12, density: 0.45, spread: 0.6, swell: 0.25 }, fx: [fx('BITCRUSH', 0.35, 0.25, 0.35), fx('DELAY', 0.3, 0.4, 0.3)] },
  { name: 'WIND VOICES', engine: 'grain', params: { source: 0.8, position: 0.4, scan: 0.53, spray: 0.6, size: 0.4, density: 0.6, spread: 0.5, swell: 0.85 }, fx: [fx('FILTER', 0.6, 0.15, 1), fx('REVERB', 0.85, 0.5, 0.5)] },
  { name: 'RESAMPLER', engine: 'grain', params: { source: 1, position: 0.3, scan: 0.5, spray: 0.2, size: 0.3, density: 0.6, spread: 0.3, swell: 0.5 }, fx: [fx('REVERB', 0.6, 0.4, 0.3)] },
  { name: 'GHOST VOWELS', engine: 'grain', params: { source: 0, position: 0.05, scan: 0.6, spray: 0.2, size: 0.45, density: 0.55, spread: 0.25, swell: 0.6 }, fx: [fx('PHASER', 0.2, 0.6, 0.5), fx('REVERB', 0.75, 0.5, 0.4)] },
  { name: 'DEEP OCEAN', engine: 'grain', params: { source: 0.8, position: 0.2, scan: 0.5, spray: 0.7, size: 0.85, density: 0.85, spread: 0.8, swell: 0.95 }, fx: [fx('FILTER', 0.35, 0.08, 1), fx('REVERB', 1, 0.6, 0.6)] },
  { name: 'TAPE DUST', engine: 'grain', params: { source: 0.4, position: 0.6, scan: 0.38, spray: 0.45, size: 0.4, density: 0.5, spread: 0.15, swell: 0.4 }, fx: [fx('BITCRUSH', 0.25, 0.45, 0.4), fx('FILTER', 0.55, 0, 1)] },
  { name: 'PARTICLES', engine: 'grain', params: { source: 0.6, position: 0.4, scan: 0.55, spray: 0.9, size: 0.08, density: 0.35, spread: 0.95, swell: 0.3 }, fx: [fx('DELAY', 0.5, 0.55, 0.4), fx('REVERB', 0.7, 0.2, 0.4)] },
  { name: 'CRYSTAL ARP', engine: 'grain', params: { source: 0.2, position: 0.15, scan: 0.5, spray: 0.1, size: 0.3, density: 0.7, spread: 0.4, swell: 0.15 }, fx: [fx('DELAY', 0.45, 0.4, 0.3), fx('REVERB', 0.65, 0.3, 0.35)], arp: arp(3, 3, 2, 0.6) },
  // FOLD (ratio index: 0.5 0, 1 1/7, 1.5 2/7, 2 3/7, 3 4/7, 3.5 5/7, 4 6/7, 7 1)
  { name: 'BUCHLA BONK', engine: 'fold', params: { fold: 0.25, symmetry: 0.5, fm: 0, ratio: 1 / 7, foldenv: 0.6, decay: 0.25, sustain: 0, lpg: 0.9 }, fx: [fx('DELAY', 0.45, 0.35, 0.2), fx('REVERB', 0.5, 0.5, 0.3)] },
  { name: 'WEST COAST LEAD', engine: 'fold', params: { fold: 0.45, symmetry: 0.62, fm: 0.15, ratio: 3 / 7, foldenv: 0.3, decay: 0.5, sustain: 0.7, lpg: 0.4 }, fx: [fx('DELAY', 0.4, 0.3, 0.25), fx('REVERB', 0.5, 0.5, 0.2)] },
  { name: 'FOLDED BASS', engine: 'fold', params: { fold: 0.35, symmetry: 0.58, fm: 0.1, ratio: 0, foldenv: 0.5, decay: 0.3, sustain: 0.5, lpg: 0.6 } },
  { name: 'METAL RAIN', engine: 'fold', params: { fold: 0.6, symmetry: 0.3, fm: 0.5, ratio: 5 / 7, foldenv: 0.7, decay: 0.2, sustain: 0, lpg: 0.8 }, fx: [fx('DELAY', 0.3, 0.5, 0.35), fx('REVERB', 0.7, 0.3, 0.35)] },
  { name: 'LIQUID KEYS', engine: 'fold', params: { fold: 0.3, symmetry: 0.5, fm: 0.05, ratio: 1 / 7, foldenv: 0.25, decay: 0.8, sustain: 0.85, lpg: 0.3 }, fx: [fx('CHORUS', 0.3, 0.5, 0.45), fx('REVERB', 0.7, 0.4, 0.35)] },
  { name: 'ARP FOLD', engine: 'fold', params: { fold: 0.3, symmetry: 0.55, fm: 0.08, ratio: 3 / 7, foldenv: 0.65, decay: 0.18, sustain: 0, lpg: 0.85 }, fx: [fx('DELAY', 0.5, 0.45, 0.3), fx('REVERB', 0.6, 0.4, 0.3)], arp: arp(1, 3, 2, 0.5) },
  // PULSAR (wave/window index: n/3, divide index: n/7 for /1 /2 /4 /8 /16 /32 /64 /128)
  { name: 'PULSE VOICE', engine: 'pulsar', params: { formant: 0.45, wave: 0, window: 0, divide: 0, mask: 0, jitter: 0.05, fenv: 0.2, swell: 0.4 }, fx: [fx('CHORUS', 0.3, 0.5, 0.4), fx('REVERB', 0.6, 0.4, 0.3)] },
  { name: 'CLICK RHYTHM', engine: 'pulsar', params: { formant: 0.7, wave: 0, window: 1 / 3, divide: 6 / 7, mask: 0.25, jitter: 0.2, fenv: 0, swell: 0.1 }, fx: [fx('DELAY', 0.45, 0.45, 0.35), fx('REVERB', 0.5, 0.4, 0.25)] },
  { name: 'GLITCH SWARM', engine: 'pulsar', params: { formant: 0.8, wave: 1, window: 2 / 3, divide: 3 / 7, mask: 0.5, jitter: 0.7, fenv: 0.3, swell: 0.3 }, fx: [fx('BITCRUSH', 0.3, 0.3, 0.3), fx('DELAY', 0.3, 0.4, 0.3)] },
  { name: 'FORMANT BASS', engine: 'pulsar', params: { formant: 0.3, wave: 1 / 3, window: 0, divide: 0, mask: 0, jitter: 0, fenv: 0.6, swell: 0.1 }, fx: [fx('DISTORT', 0.3, 0.5, 0.4)] },
  { name: 'GRANULAR RAIN', engine: 'pulsar', params: { formant: 0.9, wave: 0, window: 1, divide: 4 / 7, mask: 0.6, jitter: 0.9, fenv: 0, swell: 0.6 }, fx: [fx('DELAY', 0.55, 0.5, 0.35), fx('REVERB', 0.9, 0.3, 0.5)] },
  // VECTOR (source index n/9: SINE TRI SAW SQUARE PULSE SUPERSAW VOWEL ORGAN FIFTHS NOISE)
  { name: 'VECTOR PAD', engine: 'vector', params: { srcA: 5 / 9, srcB: 6 / 9, srcC: 7 / 9, srcD: 0, x: 0.5, y: 0.5, orbit: 0.3, swell: 0.75 }, fx: [fx('CHORUS', 0.25, 0.5, 0.4), fx('REVERB', 0.8, 0.4, 0.45)] },
  { name: 'MORPH LEAD', engine: 'vector', params: { srcA: 2 / 9, srcB: 3 / 9, srcC: 4 / 9, srcD: 8 / 9, x: 0.3, y: 0.7, orbit: 0.45, swell: 0.2 }, fx: [fx('DELAY', 0.4, 0.35, 0.25), fx('REVERB', 0.5, 0.5, 0.2)] },
  { name: 'BREATH & BELL', engine: 'vector', params: { srcA: 1, srcB: 0, srcC: 1 / 9, srcD: 6 / 9, x: 0.4, y: 0.4, orbit: 0.2, swell: 0.6 }, fx: [fx('REVERB', 0.8, 0.3, 0.45)] },
  { name: 'WAVE DANCE', engine: 'vector', params: { srcA: 0, srcB: 2 / 9, srcC: 3 / 9, srcD: 5 / 9, x: 0.5, y: 0.5, orbit: 0.7, swell: 0.3 }, fx: [fx('PHASER', 0.3, 0.5, 0.4), fx('DELAY', 0.45, 0.3, 0.2)] },
  { name: 'STRING MACHINE', engine: 'vector', params: { srcA: 5 / 9, srcB: 8 / 9, srcC: 2 / 9, srcD: 7 / 9, x: 0.2, y: 0.8, orbit: 0.1, swell: 0.7 }, fx: [fx('CHORUS', 0.2, 0.7, 0.6), fx('REVERB', 0.7, 0.5, 0.35)] },
  // SCANNED (excite index n/3: GAUSS PLUCK SQUARE NOISE)
  { name: 'LIVING STRING', engine: 'scanned', params: { stiff: 0.5, damp: 0.3, stir: 0.3, excite: 0, hit: 0.6, position: 0.3, bright: 0.6, swell: 0.5 }, fx: [fx('REVERB', 0.7, 0.4, 0.35)] },
  { name: 'SCAN PLUCK', engine: 'scanned', params: { stiff: 0.65, damp: 0.45, stir: 0, excite: 1 / 3, hit: 0.8, position: 0.2, bright: 0.8, swell: 0.15 }, fx: [fx('DELAY', 0.45, 0.35, 0.25), fx('REVERB', 0.5, 0.4, 0.25)] },
  { name: 'WOBBLE PAD', engine: 'scanned', params: { stiff: 0.25, damp: 0.15, stir: 0.5, excite: 0, hit: 0.4, position: 0.5, bright: 0.4, swell: 0.8 }, fx: [fx('CHORUS', 0.3, 0.5, 0.4), fx('REVERB', 0.8, 0.4, 0.45)] },
  { name: 'SLOW MOTION', engine: 'scanned', params: { stiff: 0.1, damp: 0.08, stir: 0.15, excite: 2 / 3, hit: 0.7, position: 0.4, bright: 0.5, swell: 0.7 }, fx: [fx('REVERB', 0.9, 0.3, 0.5)] },
  { name: 'RATTLE', engine: 'scanned', params: { stiff: 0.85, damp: 0.6, stir: 0.8, excite: 1, hit: 0.9, position: 0.6, bright: 0.9, swell: 0.3 }, fx: [fx('FLANGER', 0.4, 0.5, 0.4), fx('DELAY', 0.35, 0.3, 0.2)] },
  // NOISE
  { name: 'NIGHT WIND', engine: 'noise', params: { color: 0.55, tone: 0.12, harmonics: 0.3, air: 0.7, motion: 0.25, depth: 0.55, spread: 0.6, swell: 0.85 }, fx: [fx('REVERB', 0.9, 0.4, 0.45)] },
  { name: 'SINGING BOWL', engine: 'noise', params: { color: 0.7, tone: 0.95, harmonics: 0.35, air: 0, motion: 0.1, depth: 0.08, spread: 0.4, swell: 0.6 }, fx: [fx('REVERB', 0.85, 0.3, 0.45)] },
  { name: 'OCEAN DRONE', engine: 'noise', params: { color: 0.35, tone: 0.5, harmonics: 0.6, air: 0.5, motion: 0.15, depth: 0.6, spread: 0.85, swell: 0.95 }, fx: [fx('CHORUS', 0.15, 0.6, 0.4), fx('REVERB', 1, 0.6, 0.5)] },
  { name: 'DARK HUM', engine: 'noise', params: { color: 0.2, tone: 0.82, harmonics: 0.85, air: 0.08, motion: 0.05, depth: 0.15, spread: 0.3, swell: 0.75 }, fx: [fx('DISTORT', 0.25, 0.3, 0.4), fx('REVERB', 0.7, 0.6, 0.3)] },
  { name: 'STATIC CHOIR', engine: 'noise', params: { color: 0.85, tone: 0.7, harmonics: 0.5, air: 0.3, motion: 0.4, depth: 0.25, spread: 1, swell: 0.7 }, fx: [fx('FLANGER', 0.15, 0.4, 0.3), fx('REVERB', 0.8, 0.3, 0.4)] },
  // MACRO (model index n/7: VA FOLD CHORD SWARM STRING MODAL PARTICLE SPEECH)
  { name: 'VA BRASS', engine: 'macro', params: { model: 0, harmonics: 0.02, timbre: 0.55, morph: 0.2, decay: 0.5, sustain: 0.7, lpg: 0.55, release: 0.3 }, fx: [fx('CHORUS', 0.25, 0.3, 0.3), fx('REVERB', 0.5, 0.5, 0.25)] },
  { name: 'CHORD STAB', engine: 'macro', params: { model: 2 / 7, harmonics: 5 / 8, timbre: 0.35, morph: 0.6, decay: 0.3, sustain: 0, lpg: 0.75, release: 0.2 }, fx: [fx('DELAY', 0.4, 0.4, 0.3), fx('REVERB', 0.6, 0.3, 0.3)] },
  { name: 'SWARM PAD', engine: 'macro', params: { model: 3 / 7, harmonics: 0.45, timbre: 1, morph: 0.45, decay: 0.8, sustain: 0.85, lpg: 0.2, release: 0.7 }, fx: [fx('CHORUS', 0.2, 0.5, 0.4), fx('REVERB', 0.8, 0.4, 0.45)] },
  { name: 'MODAL BELLS', engine: 'macro', params: { model: 5 / 7, harmonics: 0.85, timbre: 0.6, morph: 0.55, decay: 0.75, sustain: 0, lpg: 0, release: 0.6 }, fx: [fx('DELAY', 0.55, 0.4, 0.25), fx('REVERB', 0.75, 0.3, 0.4)] },
  { name: 'PARTICLE DUST', engine: 'macro', params: { model: 6 / 7, harmonics: 0.55, timbre: 0.6, morph: 0.6, decay: 0.6, sustain: 0.8, lpg: 0.1, release: 0.6 }, fx: [fx('DELAY', 0.5, 0.5, 0.35), fx('REVERB', 0.85, 0.3, 0.45)] },
  // FOF (voice index n/3: BASS TENOR ALTO SOPRANO; vowel 0 A .25 E .5 I .75 O 1 U)
  { name: 'CHOIR AAH', engine: 'fof', params: { vowel: 0, voice: 2 / 3, shift: 0.42, bandwidth: 0.5, vibrato: 0.4, jitter: 0.35, skirt: 0.4, swell: 0.6 }, fx: [fx('CHORUS', 0.2, 0.5, 0.45), fx('REVERB', 0.85, 0.4, 0.45)] },
  { name: 'BASS MONK', engine: 'fof', params: { vowel: 0.75, voice: 0, shift: 0.42, bandwidth: 0.35, vibrato: 0.15, jitter: 0.25, skirt: 0.5, swell: 0.6 }, fx: [fx('REVERB', 0.95, 0.4, 0.5)] },
  { name: 'SOPRANO', engine: 'fof', params: { vowel: 0.1, voice: 1, shift: 0.42, bandwidth: 0.5, vibrato: 0.65, jitter: 0.2, skirt: 0.35, swell: 0.45 }, fx: [fx('REVERB', 0.8, 0.3, 0.4)] },
  { name: 'TENOR OOH', engine: 'fof', params: { vowel: 1, voice: 1 / 3, shift: 0.42, bandwidth: 0.45, vibrato: 0.45, jitter: 0.3, skirt: 0.45, swell: 0.5 }, fx: [fx('CHORUS', 0.25, 0.4, 0.3), fx('REVERB', 0.75, 0.4, 0.35)] },
  { name: 'ROBOT CHOIR', engine: 'fof', params: { vowel: 0.25, voice: 1 / 3, shift: 0.25, bandwidth: 0.7, vibrato: 0, jitter: 0, skirt: 0.05, swell: 0.3 }, fx: [fx('BITCRUSH', 0.2, 0.15, 0.3), fx('DELAY', 0.4, 0.35, 0.25)] },
  // VOCAL
  { name: 'TALKBOX', engine: 'vocal', params: { vowel: 0.35, size: 0.4, breath: 0.1, reso: 0.7, vibrato: 0.1, mrate: 0.5, depth: 0.85, swell: 0.15 }, fx: [fx('DISTORT', 0.2, 0.6, 0.3), fx('DELAY', 0.4, 0.3, 0.2)] },
  { name: 'BREATHY VOX', engine: 'vocal', params: { vowel: 0, size: 0.5, breath: 0.6, reso: 0.4, vibrato: 0.35, mrate: 0.15, depth: 0.2, swell: 0.55 }, fx: [fx('CHORUS', 0.25, 0.4, 0.4), fx('REVERB', 0.7, 0.4, 0.4)] },
  { name: 'WAH LEAD', engine: 'vocal', params: { vowel: 0.5, size: 0.45, breath: 0.05, reso: 0.85, vibrato: 0.25, mrate: 0.72, depth: 1, swell: 0.1 }, fx: [fx('DISTORT', 0.35, 0.6, 0.4), fx('DELAY', 0.45, 0.35, 0.25)] },
  { name: 'DEEP VOICE', engine: 'vocal', params: { vowel: 0.75, size: 0.05, breath: 0.2, reso: 0.55, vibrato: 0.2, mrate: 0.1, depth: 0.3, swell: 0.5 }, fx: [fx('REVERB', 0.8, 0.5, 0.4)] },
  { name: 'CHILD CHOIR', engine: 'vocal', params: { vowel: 0.1, size: 0.95, breath: 0.25, reso: 0.5, vibrato: 0.5, mrate: 0.08, depth: 0.25, swell: 0.65 }, fx: [fx('CHORUS', 0.3, 0.5, 0.45), fx('REVERB', 0.85, 0.3, 0.45)] },
  // ARPEGGIATED
  { name: 'ARP PLUCKS', engine: 'guitar', params: { bright: 0.7, damp: 0.4, sustain: 0.3, body: 0.3, pick: 0.25, drive: 0, tone: 0.7, release: 0.3 }, fx: [fx('DELAY', 0.6, 0.4, 0.3), fx('REVERB', 0.6, 0.4, 0.25)], arp: arp(3, 3, 2, 0.7) },
  { name: 'ARP ACID', engine: 'bass', params: { wave: W.SAW, cutoff: 0.3, reso: 0.75, envamt: 0.6, decay: 0.2, sub: 0.2, drive: 0.5, glide: 0 }, fx: [fx('DELAY', 0.45, 0.35, 0.2)], arp: arp(5, 3, 2, 0.6) },
  { name: 'TRANCE STAB', engine: 'pad', params: { wave: W.SAW, detune: 0.6, cutoff: 0.6, reso: 0.25, attack: 0, release: 0.2, lfo: 0.3, lfoamt: 0 }, fx: [fx('DELAY', 0.4, 0.4, 0.3), fx('REVERB', 0.6, 0.3, 0.3)], arp: arp(6, 4, 1, 0.35) }
];

const row = (sound, o) => Object.assign({ sound, tune: 0.5, decay: 0.5, tone: 0.5, level: 0.8, pan: 0.5 }, o || {});
const KITS = [
  { name: '909 HOUSE', rows: [row('BD.909'), row('SN.TIGHT'), row('HH.CLS', { level: 0.65 }), row('CP.ROOM', { level: 0.7 }), row('PERC.07', { pan: 0.7, level: 0.6 })] },
  { name: '808 TRAP', rows: [row('BD.808', { level: 0.9 }), row('SN.FAT'), row('HH.CLS', { level: 0.6, decay: 0.4 }), row('HH.OPN', { level: 0.55 }), row('CP.ROOM', { level: 0.7 })] },
  { name: 'ELECTRO', rows: [row('BD.DEEP'), row('SN.TIGHT', { tone: 0.8, tune: 0.6 }), row('HH.CLS', { level: 0.6 }), row('COWBELL', { level: 0.5, pan: 0.35 }), row('ZAP', { level: 0.6 })], fx: [fx('DELAY', 0.4, 0.2, 0.12)] },
  { name: 'LO-FI', rows: [row('BD.909', { decay: 0.4, tone: 0.2 }), row('RIM', { level: 0.7 }), row('SHAKER', { level: 0.6 }), row('HH.OPN', { level: 0.5, tone: 0.3 }), row('TOM.LO', { level: 0.75 })], fx: [fx('BITCRUSH', 0.55, 0.3, 0.6), fx('FILTER', 0.65, 0, 1)] },
  { name: 'ACOUSTIC', rows: [row('BD.DEEP', { tune: 0.62, decay: 0.35, tone: 0.7 }), row('SN.FAT', { tone: 0.6 }), row('HH.CLS', { tone: 0.3 }), row('TOM.HI'), row('CYMBAL', { level: 0.5, pan: 0.65 })], fx: [fx('REVERB', 0.3, 0.5, 0.2)] }
];

// ---------- demo project ----------
// "SEVEN SKIES": 7/4 (felt as 4+3), D minor, Dm7 - Bbmaj7 - Gm7 - A7sus over 4 bars of 28 steps.
// Granular choir pad, wavefolded bass, modal (MACRO) bells and an electro kit with velocity, chance and ratchets.
function bits(s) {
  const a = s.replace(/\s/g, '').split('').map(c => c === 'x' ? 1 : 0);
  return a.concat(new Array(Math.max(0, DRUM_MAX - a.length)).fill(0));
}
function drumPat(len, rows) { return { len, steps: rows.map(bits) }; }

function demoProject() {
  const prj = newProject();
  prj.name = 'SEVEN SKIES';
  prj.bpm = 104; prj.sig = SIGS.findIndex(x => x.name === '7/4'); prj.swing = 0.12; prj.songMode = true;
  const BAR = 28;

  // DRUM: one bar of 7/4 per pattern
  const dr = prj.parts[0];
  applyKit(dr, 'ELECTRO');
  dr.patterns = [
    // A: main groove
    drumPat(BAR, ['x... ..x. ..x. .... x... ..x. ....', '.... x... .... x... .... x... ..x.', 'x.x. x.x. x.x. x.x. x.x. x.x. x.xx',
      '.... .... ..x. .... .... .... x...', '.... .... .... ...x .... .... ....']),
    // B: intro / outro, kick on the 4 + 3 and ticking hats
    drumPat(BAR, ['x... .... .... .... x... .... ....', '.... .... .... .... .... .... ....', '..x. ..x. ..x. ..x. ..x. ..x. ..x.',
      '.... .... .... .... .... .... ....', '.... .... .... .... .... .... x...']),
    // C: busy
    drumPat(BAR, ['x... ..x. x.x. .... x..x ..x. x...', '.... x... .... x..x .... x... x.xx', 'xxxx x.xx xxxx x.xx xxxx x.xx xxxx',
      'x... ..x. .... x... ..x. .... x...', '.... .... .... .... .... .... ..x.']),
    // D: break, half-time with a snare roll into the next row
    drumPat(BAR, ['x... .... .... .... .... .... ....', '.... .... .... .... x.x. x.xx xxxx', '.... x... .... x... .... .... ....',
      '.... .... x... .... .... .... ....', 'x... .... .... .... .... .... ....'])
  ];
  dr.patterns.forEach(p => stepMeta(p));
  const hatAccents = p => { for (let s = 0; s < BAR; s++) p.vel[2][s] = s % 4 === 0 ? 1 : s % 2 === 0 ? 0.6 : 0.4; };
  hatAccents(dr.patterns[0]); hatAccents(dr.patterns[2]);
  dr.patterns[0].rat[2][27] = 2;                                   // hat flam at the end of the bar
  dr.patterns[0].vel[1][26] = 0.55;                                // ghost snare
  [1, 5, 9, 13, 17, 21, 25].forEach(s => { dr.patterns[2].prob[2][s] = 0.5; });   // hats that come and go
  dr.patterns[2].rat[1][26] = 3; dr.patterns[2].rat[1][27] = 2;
  dr.patterns[2].prob[3][14] = 0.66; dr.patterns[2].prob[3][18] = 0.66;
  [16, 18, 20, 22, 23, 24, 25, 26, 27].forEach((s, i) => { dr.patterns[3].vel[1][s] = 0.35 + i * 0.08; });
  dr.patterns[3].rat[1][26] = 2; dr.patterns[3].rat[1][27] = 4;
  dr.level = 0.78;

  const roots = [38, 34, 31, 33];                                  // D2 Bb1 G1 A1
  const chords = [[57, 60, 62, 65], [57, 58, 62, 65], [55, 58, 62, 65], [55, 57, 62, 64]];
  const notes = (pat, list) => { list.forEach(([s, n, l]) => pat.notes.push({ s, n, l })); };

  // SYNTH A: wavefolded bass, pattern A grouped 4+3, pattern B busier for the busy drums
  setPreset(prj.parts[1], 'FOLDED BASS');
  const ba = prj.parts[1].patterns[0], bb = prj.parts[1].patterns[1];
  ba.len = bb.len = BAR * 4;
  roots.forEach((r, b) => {
    notes(ba, [[0, 0, 3], [6, 0, 2], [8, 12, 2], [12, 0, 2], [16, 0, 3], [22, 7, 2], [24, 10, 3]].map(([s, o, l]) => [b * BAR + s, r + o, l]));
    notes(bb, [[0, 0, 2], [2, 12, 1], [4, 0, 2], [6, 0, 1], [8, 12, 2], [10, 0, 1], [12, 7, 2], [14, 0, 1],
      [16, 0, 2], [18, 12, 1], [20, 0, 2], [22, 10, 2], [24, 12, 2], [26, 7, 2]].map(([s, o, l]) => [b * BAR + s, r + o, l]));
  });
  prj.parts[1].level = 0.72;

  // SYNTH B: granular choir holding the chords
  setPreset(prj.parts[2], 'FROZEN CHOIR');
  const pp = prj.parts[2].patterns[0];
  pp.len = BAR * 4;
  chords.forEach((ch, b) => ch.forEach(n => pp.notes.push({ s: b * BAR, n, l: BAR })));
  prj.parts[2].level = 0.72;

  // SYNTH C: modal bells, pattern A = melody, pattern B = sparse bell calls
  setPreset(prj.parts[3], 'MODAL BELLS');
  const la = prj.parts[3].patterns[0], lb = prj.parts[3].patterns[1];
  la.len = lb.len = BAR * 4;
  const melody = [
    [[0, 81, 4], [4, 77, 2], [6, 74, 2], [8, 76, 4], [12, 77, 4], [16, 81, 3], [19, 84, 3], [22, 81, 6]],
    [[0, 86, 4], [4, 84, 2], [6, 81, 2], [8, 77, 4], [12, 79, 4], [16, 81, 6], [22, 77, 6]],
    [[0, 79, 4], [4, 81, 2], [6, 82, 2], [8, 86, 4], [12, 84, 4], [16, 82, 3], [19, 81, 3], [22, 79, 6]],
    [[0, 76, 4], [4, 79, 4], [8, 81, 8], [16, 76, 3], [19, 74, 3], [22, 73, 6]]
  ];
  melody.forEach((bar, b) => notes(la, bar.map(([s, n, l]) => [b * BAR + s, n, l])));
  roots.forEach((r, b) => notes(lb, [[b * BAR, r + 36, 4], [b * BAR + 16, r + 43, 4]]));
  prj.parts[3].level = 0.42;

  // song: intro, groove, melody, busy, break, busy, outro (each row = 4 bars of 7/4)
  prj.song = [
    { p: [1, -1, 0, -1], rep: 1 },
    { p: [1, 0, 0, 1], rep: 1 },
    { p: [0, 0, 0, 0], rep: 2 },
    { p: [2, 1, 0, 0], rep: 1 },
    { p: [3, -1, 0, 1], rep: 1 },
    { p: [2, 1, 0, 0], rep: 2 },
    { p: [1, 0, 0, 1], rep: 1 }
  ];
  return prj;
}
