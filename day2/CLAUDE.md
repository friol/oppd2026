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

Pipeline: testo → `parser` → G2P → `prosody` (durate, F0, segmenti, tracce per frame) → motore (`klatt`, `natural` o `articulatory`: campioni) → Web Audio.

- `index.html` + `style.css`: UI (input, preset, controlli voce, spettrogramma, guida agli escape).
- `js/phonemes.js`: inventario fonemi (target F1-F3/banda, durate inerenti/minime di Klatt, ampiezze del ramo parallelo per fricative e burst). Vocali italiane in minuscolo (`a e E i o O u`, `r` = vibrante), inglesi in ARPAbet.
- `js/g2p-it.js`: regole italiane (c/g dolci, gn, gli, sc, geminate, s sonora, glide i/u, accento) + eccezioni.
- `js/g2p-en.js`: regole NRL (Elovitz 1976) + dizionario parole irregolari con accento stile CMU.
- `js/parser.js`: tokenizzazione ed escape (`\note`, `\time`, `\rest`, `\tempo`, `\lang`). `\note` e `\time` valgono per la parola successiva; una parola cantata senza `\time` riusa l'ultima durata.
- `js/prosody.js`: durate (regole di Klatt, `SPEECH_SPEED`), sillabazione e allineamento al beat nel canto (le consonanti d'attacco anticipano la battuta), intonazione (declinazione, accenti, fine frase), espansione in segmenti (occlusione/burst/aspirazione, `r` vibrante a uno o tre colpi), interpolazione dei parametri a frame di 32 campioni.
- `js/klatt.js`: sintetizzatore a 22050 Hz: sorgente KLGLOTT88 con tilt/jitter/shimmer, aspirazione, coppia polo-zero nasale, cascata R5..R1, ramo parallelo A2..A6+AB per il rumore, radiazione.
- `js/natural.js`: modalità Natural = Klatt + sorgente LF (tabelle per Rd, Fant 1995; `voice.source = 'lf'` e traccia `rd`), microprosodia, undershoot/riduzione vocalica, flutter KLSYN88, fine frase più soffiata, attacchi soffiati e formante del cantante nel canto. Overshoot di nota e vibrato irregolare sono in `prosody.js` sotto `voice.natural`.
- `js/articulatory.js`: modalità Articulatory (pulsante ARTIC.) = F1-F3 da un tratto vocale simulato, poi Natural. Strato vocalico Stevens-House (luogo e area della costrizione, area e lunghezza delle labbra) guidato verso la vocale successiva da una dinamica critica (ω = 45); gesti consonantici (labbra, denti, alveoli, postalveolare, palato, velo a 11 cm) con rampe di attivazione, le coronali trascinano avanti il corpo della lingua. Formanti = zeri dell'elemento D della matrice di catena (tubo senza perdite, sezioni da 0,5 cm). I bersagli vocalici sono fittati a runtime (codebook + pattern search) sui target di `phonemes.js`; il residuo resta come rapporto che segue la dinamica. Nasali, laterali, R inglese, vibrante e frizione usano i formanti delle regole.
- `js/engines.js`: registro `ENGINES` (`klatt`, `natural`, `articulatory`) con `render(frames, voice)` e hook facoltativi `voice` (unito alla voce), `segments(segs, phones, voice)`, `shape(frames, built, voice, segs)`.
- `js/tts.js`: voci (male/female/child/robot), pipeline completa, trascrizione, export WAV.
- `js/presets.js`: testi di esempio (parlato IT/EN e brevi estratti di canzoni).
- `js/transcribe.js`: audio → escape. Lettore WAV proprio (MP3 via `decodeAudioData`), ricampionamento a 11025 Hz, pitch tracking YIN, segmentazione in note (salti di altezza, pause, riattacchi di energia), stima del BPM, quantizzazione in sedicesimi e generazione del testo. Le parole non vengono riconosciute: si canta su "la", oppure sulle sillabe del testo facoltativo inserito dall'utente.
- `js/app.js`: UI, riproduzione (SPEAK/PAUSE/RESUME + STOP), spettrogramma (FFT propria), piano roll dell'audio trascritto, impostazioni salvate in localStorage.

## Comandi

- Avvio: aprire `index.html` nel browser (anche da `file://`) oppure `http://localhost/oppd2026/day2/` con XAMPP.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- I file JS sono script globali (niente moduli ES): per testare in Node si concatenano in un contesto `vm` e si chiama `TTS.synthesize(text, { lang, voice, engine, rate, pitch, tempo, vibrato, transpose })` (tutti i campi numerici sono obbligatori). Scrivere i test con gli escape in un file (es. `String.raw`), non in un heredoc di Git Bash, che trasforma `\\` in `\`.
- Verifiche utili: nessun NaN nei campioni, livelli RMS per fonema (vocali circa 10 dB sopra /s/), picchi FFT delle vocali vicini ai target di `phonemes.js`.
- Per misurare l'altezza con l'autocorrelazione prendere il primo picco vicino al massimo, non il massimo assoluto (su segnali periodici r(T) ≈ r(2T) e si ottengono falsi raddoppi di periodo).

