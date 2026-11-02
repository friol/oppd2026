# MBROLA for the day2 web app

This folder holds third-party material used by the MBROLA engine of the app (`js/mbrola.js`).

## The program: `mbrola.js`

The MBROLA speech synthesizer by the TCTS Lab of the Faculté Polytechnique de Mons, compiled
unmodified to WebAssembly with Emscripten (the `.wasm` is embedded in the `.js`).

- Source: https://github.com/numediart/MBROLA, commit `274dead162f2826dc38c208fba92efeddb724c33`
- License: GNU Affero General Public License v3 (`LICENSE`)
- Build: `build.sh` (Emscripten 6.0.13). `reset.c` is ours: it only resets `getopt` so that
  the program can run more than once in the same WebAssembly instance.

## The voices: `voices/`

Diphone databases from https://github.com/numediart/MBROLA-voices, stored as base64 inside a
script (so that the page can load them from `file://`), each with its own license:

| File | Voice | Owner |
| --- | --- | --- |
| `it3.js` | Italian, male | IFD-CNR Padova (Piero Cosi) |
| `us1.js` | American English, female | Babel Technology |

Only one voice per language, to keep the app small: the other app voices (Italian female and
child, English male and child) are made from these by scaling the vocal tract.

In short (see each `*-license.txt`): the databases may be used to synthesize speech only with
the MBROLA program, may not be sold or included in a product that is sold without the owner's
permission, and may be copied and distributed freely when no charge is made, together with
their license notice. This app is free and non-commercial.
