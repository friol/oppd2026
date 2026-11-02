# Piper for the day2 web app

Third-party material used by the Piper engine of the app (`js/piper.js`). It runs entirely in
the browser, without network; the page must be served over http (XAMPP), because onnxruntime
loads its WebAssembly with `fetch` and a dynamic `import`, which browsers block on `file://`.

## `ort/`: onnxruntime-web 1.27.0

From the npm package `onnxruntime-web@1.27.0` (`dist/`): `ort.wasm.min.js` (the WebAssembly-only
build, global `ort`), `ort-wasm-simd-threaded.mjs` and `.wasm`. License: MIT (`ort/LICENSE`,
Microsoft). `ort/.htaccess` gives Apache the MIME types of `.mjs` and `.wasm`.

## `models/`: Piper voices

From https://huggingface.co/rhasspy/piper-voices (MIT), one per language, each with its model
card and config:

| Model | Voice | Training data | Data license |
| --- | --- | --- | --- |
| `it_IT-paola-medium` | Italian, female | paolapersico1/Voice-Dataset-Italian (fine-tuned from the US English lessac voice) | CC0 (lessac: Blizzard 2013, non-commercial research) |
| `en_US-ljspeech-medium` | American English, female | LJ Speech | public domain |

This app is free and non-commercial.
