# CLAUDE.md — day19

Questa cartella contiene il programma day19 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day18`, `day19`, ...) e deve restare autonomo.

## Obiettivo del programma

**WinterTracker**: tracker musicale nel browser in stile FastTracker / Impulse Tracker, con interfaccia in pixel art ghiacciata (palette e logo da `img/logo.jpg`, mostrato come splash iniziale; click o tasto per avviare l'audio).

- Interfaccia a **tab** (`state.tab`, F2 / F3 / F4 / F7): header sempre visibile (transport, tempo, ordini, titolo, master scope); tab FILE (OPEN, SAVE, EXPORT WAV e ZAP, che svuota tutta la song dopo una conferma con secondo click); tab PATTERN (meter delle tracce + griglia, a tutta altezza) e tab ORDERS (lista degli ordini: una colonna di numeri di pattern, selezione con frecce/click, cifre hex per cambiare il numero, Ins/Del per inserire/cancellare slot, pulsanti per nuovo/clone pattern e spostamento) e tab SAMPLES (pannello sample a tutta altezza; in questo tab la tastiera suona l'anteprima del sample, frecce/`[` `]` cambiano sample).
- Durante la riproduzione la vista segue la riga suonata (riga evidenziata) ma il cursore di editing resta visibile e indipendente: si sposta e si edita normalmente, la vista resta sul cursore per ~1,5 s dopo ogni movimento.
- Pattern editor con numero di tracce dinamico: le colonne visibili (fino a 32) dipendono dalla larghezza della finestra (`state.fit`); `song.channels` è almeno 16 (di più se la finestra le mostra tutte, fino a 32); le tracce in eccesso scorrono con la barra orizzontale sotto la griglia, Shift+rotella o il cursore.
- Replay: per ogni traccia analizzatore a 8 bande (Goertzel), VU meter e oscilloscopio; oscilloscopio + VU master nell'header. Click sull'intestazione = mute, tasto destro = solo.
- Sezione sample (64 slot): forma d'onda, loop (off/fwd/ping-pong, marker trascinabili), volume, finetune, nota base, rate, reverse/normalize/clear. Tasto LOAD apre un **file browser integrato** (File System Access API: si concede una volta una cartella, ricordata in IndexedDB; navigazione cartelle e doppio click per caricare; fallback al dialogo del sistema dove l'API manca) oppure drag&drop di un file: `.xm`, `.s3m`, `.it`, `.mod` aprono il **browser del modulo** (elenco sample con anteprima, IMPORT / IMPORT ALL nello slot corrente); `.wav/.mp3/.ogg/.flac` (decodeAudioData) si importano direttamente.
- Colonne per cella: nota, strumento (sample), volume (00-40), effetto (lettera + 2 cifre hex). Effetti classici: `0` arpeggio, `1/2` sweep, `3` tone portamento, `4` vibrato, `7` tremolo, `8` panning, `9` sample offset, `A` volume slide, `B/D` jump/break, `C` volume, `E` note cut, `F` speed/BPM, `G` note delay, `R` retrigger. Moderni (per traccia, restano attivi finché cambiati o `Z00`): `H` echo, `I/J/K` filtro risonante (cutoff/risonanza/modo LP-HP-BP), `L` chorus, `M` flanger, `N` distorsione, `O` bitcrusher. Elenco completo in `FX_LIST` (`js/song.js`) e nella schermata HELP (F1).
- Salvataggio/apertura song in JSON (`.wtk.json`, sample inclusi in base64) ed export WAV (render offline). L'ultimo salvataggio (pulsante SAVE) viene memorizzato anche in IndexedDB (`Store` in app.js) e ricaricato automaticamente all'apertura/F5; se non esiste, all'avvio c'è una song vuota (un solo pattern vuoto) con alcuni sample generati proceduralmente già caricati; `makeDemoSong()` (song.js) costruisce la song demo completa ma non è usata all'avvio.

## Stack e struttura

HTML, javascript e CSS. Nessuna rete, nessuna libreria esterna. Un solo `<canvas>` a bassa risoluzione logica scalato con interi (zoom automatico in base alla finestra, `state.zoom`) e `image-rendering: pixelated`; tutta la GUI è disegnata a mano (font bitmap 5x7).

- `index.html` + `style.css`: pagina con il canvas; `favicon.svg` / `favicon.png`: favicon pixel art (nota ghiacciata 16x16).
- `js/font.js`: font bitmap 5x7 (solo maiuscole).
- `js/song.js`: modello dati (sample, pattern a array tipizzati per 32 canali, ordini), `FX_LIST`, JSON save/load, song demo.
- `js/engine.js`: `Engine` (sequencer a tick, mixer a segmenti, voci con rampe anti-click, catena effetti per canale: bitcrush → distorsione → filtro biquad → chorus → flanger → echo), `renderSongToWav`. Audio via `ScriptProcessorNode` sul thread principale (funziona anche da `file://`).
- `js/modules.js`: `ModLoader` con parser XM / S3M / IT (incluso IT214/215 compresso) / MOD e audio generico.
- `js/ui.js`: GUI immediate-mode (hit region ricostruite ogni frame, spinner con auto-repeat, campi di testo).
- `js/app.js`: stato, editing, tastiera, file, avvio; `js/views.js`: disegno di splash, header, tracce, griglia, sample, browser modulo, help.

## Comandi

- Avvio: aprire `index.html` nel browser oppure `http://localhost/oppd2026/day19/` con XAMPP.
- Tastiera: Z-M / Q-P tasti piano, `1` note off, frecce, Tab, PgUp/PgDn, Space play song, Enter play pattern, Esc/F8 stop, F6 play pattern (F5 resta il ricaricamento della pagina), Del cancella campo (Shift: cella), Ins/Backspace inserisci/elimina cella, Ctrl+←/→ ordine, Ctrl+↑/↓ sample precedente/successivo (mostrato nella barra dei tab), tastierino numerico `/` e `*` ottava giù/su (anche Ctrl+Shift+↑/↓), `[` `]` sample, F1 help. Selezione a blocchi di celle con Shift+frecce, Ctrl+S salva la song, Ctrl+C / Ctrl+X / Ctrl+V copia, taglia, incolla (Del cancella la selezione).

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- I parser dei moduli sono stati verificati con file sintetici (XM, S3M, IT raw e compresso, MOD) e il motore con la song demo in Node (`vm.runInThisContext` su `song.js` + `engine.js`); la GUI con Chrome headless (`--screenshot`).
