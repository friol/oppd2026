# CLAUDE.md — day2

Questa cartella contiene il programma day2 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ...) e deve restare autonomo.

## Obiettivo del programma

Costruisci una webapp con sintesi Klatt (sorgente glottale, cascata di formanti, ramo del rumore, regole italiane/inglesi testo→fonemi) che gira nel browser con Web Audio. La webapp accetterà delle frasi in italiano o inglese, e le riprodurrà con la sintesi vocale. Inserendo delle particolari sequenze di escape, sarà possibile far cantare la app (ad esempio \note:B4 indica l’intonazione SI da dare alla parola, oppure \time:4 per durata della parola 1/4).

## Stack e struttura

HTML, javascript e CSS.
Non usare mai la rete, API del browser particolari (es. Speech API) o motori LLM o AI per le azioni del computer.
Canvas, Web Audio e localStorage sono consentiti.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente.

## Struttura

Pipeline: testo → `parser` → G2P → `prosody` (durate, F0, segmenti, tracce per frame) → motore (`klatt`, `mbrola` o `piper`: campioni) → Web Audio.

- `mbrola/`: materiale di terzi per il motore MBROLA (programma in WebAssembly, licenza AGPL, script di build, voci con le loro licenze); vedi `mbrola/README.md`.
- `piper/`: materiale di terzi per il motore Piper (onnxruntime-web 1.27.0 MIT in `piper/ort/` con `.htaccess` per i tipi MIME di `.mjs`/`.wasm`, modelli `it_IT-paola-medium` e `en_US-ljspeech-medium` con model card); vedi `piper/README.md`. ~135 MB.
- `.htaccess`: intestazioni COOP/COEP (isolamento cross-origin) per i thread di onnxruntime quando la pagina è servita da Apache.
- `index.html` + `style.css`: UI (input, preset, controlli voce, spettrogramma, guida agli escape).
- `js/phonemes.js`: inventario fonemi (target F1-F3/banda, durate inerenti/minime di Klatt, ampiezze del ramo parallelo per fricative e burst). Vocali italiane in minuscolo (`a e E i o O u`, `r` = vibrante), inglesi in ARPAbet.
- `js/g2p-it.js`: regole italiane (c/g dolci, gn, gli, sc, geminate, s sonora, glide i/u, accento) + eccezioni.
- `js/g2p-en.js`: regole NRL (Elovitz 1976) + dizionario parole irregolari con accento stile CMU.
- `js/parser.js`: tokenizzazione ed escape (`\note`, `\time`, `\rest`, `\tempo`, `\lang`). `\note` e `\time` valgono per la parola successiva; una parola cantata senza `\time` riusa l'ultima durata.
- `js/prosody.js`: durate (regole di Klatt, `SPEECH_SPEED`), sillabazione e allineamento al beat nel canto (le consonanti d'attacco anticipano la battuta), intonazione (declinazione, accenti, fine frase), espansione in segmenti (occlusione/burst/aspirazione, `r` vibrante a uno o tre colpi), interpolazione dei parametri a frame di 32 campioni.
- `js/klatt.js`: sintetizzatore a 22050 Hz: sorgente KLGLOTT88 con tilt/jitter/shimmer, aspirazione, coppia polo-zero nasale, cascata R5..R1, ramo parallelo A2..A6+AB per il rumore, radiazione.
- `js/microprosody.js`: rifiniture della traccia F0 usate dal motore MBROLA: microprosodia (F0 più alto dopo ostruenti sorde, più basso dopo sonore, F0 intrinseco delle vocali, calo sulle consonanti sonore) e flutter KLSYN88. Overshoot di nota e vibrato irregolare sono in `prosody.js` sotto `voice.natural`.
- `js/mbrola.js`: modalità MBROLA = difoni registrati. Il programma MBROLA originale (AGPL) compilato in WebAssembly (`mbrola/mbrola.js`, ricostruibile con `mbrola/build.sh`) gira sul filesystem in memoria di Emscripten: voce + file `.pho` (fonema, durata in ms, punti di F0 ogni ~20 ms) → campioni a 16 kHz, ricampionati a 22050 Hz. Voci in `mbrola/voices/` (solo it3 italiana maschile e us1 americana femminile, per il peso), in base64 dentro uno script per funzionare da `file://`, caricate al primo uso da `Mbrola.prepare`; ognuna ha la sua licenza (uso solo con il programma MBROLA, distribuzione gratuita con la nota). Fonemi mappati in SAMPA (vocali accentate italiane con `1`, `nf`/`ng`, occlusive inglesi aspirate `p_h`); se un difono manca nella voce (indice letto dal file) si sceglie con Viterbi la sostituzione più vicina. Le altre voci dell'app si ottengono scalando il tratto vocale: k = fscale della voce dell'app / fscale del parlante registrato (it3 1, us1 1.16), durate ×k e F0 /k verso MBROLA, poi uscita ricampionata di k (es. italiano femminile = it3 con k 1.16, inglese maschile = us1 con k 0.86). Con `\lang` ogni tratto di testo usa la voce della sua lingua. MBROLA tronca il periodo a campioni interi: si chiede l'altezza che dà il periodo più vicino.
- `js/piper.js`: modalità Piper = parlato neurale (VITS) eseguito in locale con onnxruntime-web, un modello per lingua. I fonemi del nostro G2P sono scritti nell'IPA di espeak-ng (accento `ˈ` prima della vocale, monosillabi funzionali atoni, geminate raddoppiate e vocali accentate lunghe in sillaba aperta per l'italiano, flap `ɾ` per l'inglese) e convertiti in id con il `phoneme_id_map` del modello; inferenza per frase, 0,2 s tra le frasi. Il modello sceglie durate e intonazione: SPEED → `length_scale`, pitch e voce ignorati. L'inferenza è asincrona: `prepare()` sintetizza le parti parlate, `render()` le concatena con le parti cantate, rese da MBROLA (`Mbrola.renderRange`) seguendo note e tempi. Funziona solo da http (XAMPP): da `file://` il browser blocca il caricamento del WebAssembly di onnxruntime. onnxruntime gira in un Web Worker (`ort.env.wasm.proxy`) per non bloccare la pagina, con più thread quando la pagina è isolata cross-origin (intestazioni COOP/COEP in `.htaccess`, ~2× più veloce). Il modello della lingua corrente si precarica alla scelta del motore o della lingua (`preload`). I due modelli sono femminili: con Piper l'app consente solo la voce female (`voices` nel registro, applicato da `App.engineChanged`).
- `js/engines.js`: registro `ENGINES` (`klatt`, `mbrola`, `piper`) con `render(frames, voice)` e hook facoltativi `prepare(settings, text)` (Promise per caricare dati esterni, attesa da `App.speak` e dal download WAV), `voice` (unito alla voce), `shape(frames, built, voice, segs)`.
- `js/tts.js`: voci (male/female/child/robot), pipeline completa, trascrizione, export WAV.
- `js/presets.js`: testi di esempio (parlato IT/EN e brevi estratti di canzoni).
- `js/transcribe.js`: audio → escape. Lettore WAV proprio (MP3 via `decodeAudioData`), ricampionamento a 11025 Hz, pitch tracking YIN, segmentazione in note (salti di altezza, pause, riattacchi di energia), stima del BPM, quantizzazione in sedicesimi e generazione del testo. Le parole non vengono riconosciute: si canta su "la", oppure sulle sillabe del testo facoltativo inserito dall'utente.
- `js/app.js`: UI, riproduzione (SPEAK/PAUSE/RESUME + STOP), spettrogramma (FFT propria), piano roll dell'audio trascritto, impostazioni salvate in localStorage.

## Comandi

- Avvio: aprire `index.html` nel browser (anche da `file://`, tranne il motore Piper) oppure `http://localhost/oppd2026/day2/` con XAMPP.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- I file JS sono script globali (niente moduli ES): per testare in Node si concatenano in un contesto `vm` e si chiama `TTS.synthesize(text, { lang, voice, engine, rate, pitch, tempo, vibrato, transpose })` (tutti i campi numerici sono obbligatori). Scrivere i test con gli escape in un file (es. `String.raw`), non in un heredoc di Git Bash, che trasforma `\\` in `\`.
- Verifiche utili: nessun NaN nei campioni, livelli RMS per fonema (vocali circa 10 dB sopra /s/), picchi FFT delle vocali vicini ai target di `phonemes.js`.
- Per misurare l'altezza con l'autocorrelazione prendere il primo picco vicino al massimo, non il massimo assoluto (su segnali periodici r(T) ≈ r(2T) e si ottengono falsi raddoppi di periodo).

