# CLAUDE.md — day11

Questa cartella contiene il programma day11 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, `day3`, `day4`, `day5`, `day6`, `day7`, `day8`, `day9`, `day10`, `day11`, ...) e deve restare autonomo.

## Obiettivo del programma

**OPPD-1**: strumento musicale virtuale (ispirato al genere dei synth portatili tipo OP-1, design proprio dal canvas "OPPD-1 synth"). Pannello 1280x802 scalato alla finestra; display 600x240 (disegno logico 400x160 scalato 1,5x).
- 4 parti: 1 DRUM (step sequencer in basso, 5 righe, pattern A–D da 1 a 32 step) + 3 SYNTH (A, B, C) con motori diversi: PAD, LEAD (mono, glide), BASS (mono, sub, drive), GUITAR (Karplus-Strong pre-renderizzato in buffer, con cache), FOLD (wavefolder West Coast, `js/fold.js`): sinusoide + FM → guadagno di piegatura (base + inviluppo) + offset di simmetria → WaveShaper con curva sinusoidale (fino a 6 pieghe, oversample 4x) → low pass gate (filtro e VCA con lo stesso inviluppo), highpass anti-DC per parte; parametri FOLD, SYMMETRY, FM, RATIO, FOLD ENV, DECAY, SUSTAIN, LPG; la pagina SOUND disegna l'onda piegata. PULSAR (`js/pulsar.js`, AudioWorklet `oppd-pulsar`): treno di pulsaret (3 cicli di SINE/SAW/SQUARE/NOISE sotto una finestra GAUSS/EXPO/RECT/REVERSE) uno per periodo della nota; FORMANT = rapporto rispetto alla nota, DIVIDE (/1../128) rallenta il treno fino al ritmo, MASK = salto casuale dei pulsar, JITTER, F.ENV, SWELL; livello compensato col duty cycle. VECTOR (`js/vector.js`): 4 sorgenti agli angoli (SINE, TRI, SAW, SQUARE, PULSE, SUPERSAW, VOWEL, ORGAN, FIFTHS, NOISE) miscelate a potenza costante da un punto X/Y con ORBIT automatica (`vectorPump`). SCANNED (`js/scanned.js`): anello di 48 masse e molle simulato a 600 passi/s (`scannedPump`), la sua forma diventa (DFT, 24 armoniche, PeriodicWave non normalizzata) l'onda di tutte le voci della parte; ogni nota colpisce l'anello (EXCITE, HIT, POSITION), STIR lo mantiene in moto mentre le note sono tenute; STIFF, DAMP, BRIGHT, SWELL. I motori con callback periodiche le registrano in `PUMPS` (eseguite dal clock del sequencer); quelli con una vista propria nella pagina SOUND definiscono `view`. NOISE (`js/noise.js`): rumore colorato in un banco di 6 passa-banda sulle armoniche della nota (TONE = Q da soffio a drone intonato, HARMONICS = inclinazione, AIR = rumore diretto, MOTION/DEPTH = LFO di parte sul banco, SPREAD stereo; guadagno compensato in base a Q e frequenza). MACRO (`js/macro.js`): 8 modelli (VA, FOLD, CHORD, SWARM, STRING, MODAL, PARTICLE, SPEECH) con gli stessi macro HARMONICS/TIMBRE/MORPH (significato per modello in `MACRO_HELP`) + low pass gate (DECAY, SUSTAIN, LPG, RELEASE); PARTICLE usa il worklet del pulsar, STRING il Karplus-Strong della chitarra, SPEECH i formanti di VOCAL. FOF (`js/fof.js`, AudioWorklet `oppd-fof`): voce cantata a funzioni d'onda formantiche, 5 formanti dalle tabelle classiche per BASS/TENOR/ALTO/SOPRANO interpolate fra le vocali (VOWEL, VOICE, SHIFT, BANDWIDTH, VIBRATO, JITTER, SKIRT = attacco delle onde, SWELL). VOCAL (`js/vocal.js`): due seghe + rumore di respiro in 3 formanti passa-banda, vocale che si muove da sola (MORPH RATE/DEPTH, `vocalPump`); `drawFormantView` e condivisa con FOF. GRAIN (granulare, `js/grain.js`): nuvole di grani con finestra di Hann programmati ~100 ms avanti da `grainPump()` (chiamata dal clock del sequencer); sorgenti CHOIR, BELLS, STRING, GLASS, NOISE generate all'avvio con OfflineAudioContext (radice C4), oppure RESAMPLE = ultimi 4 s dell'uscita catturati da un AudioWorklet (`oppd-tap`, pressione knob 1 nella pagina SOUND), salvati nel progetto come `part.sample` (16 bit, 24 kHz, base64, ~250 KB). Guadagno automatico per grano in base al livello locale della sorgente. Parametri: SOURCE, POSITION, SCAN (0 = freeze, ±), SPRAY, SIZE, DENSITY, SPREAD (stonatura + stereo), SWELL (attacco/rilascio). 8 parametri per motore (pagine SOUND e SHAPE), modificabili in tempo reale anche sulle voci attive.
- Step della batteria: click = acceso/spento (trascinando si dipinge), tenuto premuto ~0,45 s = apre STEP EDIT sul display (knob: STEP, VELOCITY, CHANCE, RATCHET x1-x4; pressione knob 1 = on/off; su/giu = riga; SELECT chiude e torna alla schermata precedente; con l'editor aperto un click su una cella la seleziona). Dati in `pat.vel`, `pat.prob`, `pat.rat` (creati alla prima modifica, `stepMeta`). Sulla griglia: intensita del colore = velocity, puntino = probabilita < 100%, xN = ratchet.
- Batteria: 16 suoni sintetizzati (`DRUM_SOUNDS`), per riga sound/tune/decay/tone/level/pan; hi-hat aperto "chokato".
- 2 slot effetti per parte: OFF, DELAY (sincronizzato al BPM), REVERB (IR generata), CHORUS, FLANGER, PHASER, DISTORT, BITCRUSH (AudioWorklet da URL `data:`, ScriptProcessor di riserva), FILTER (con LFO), TREMOLO.
- Arpeggiatore per i synth: OFF/UP/DOWN/UP-DN/RANDOM/ORDER/CHORD, rate 1/4…1/32 (anche terzine), 1–4 ottave, gate, HOLD (latch). Funziona su note live e su note dei pattern.
- Tempo in chiave (`SIGS` in `js/core.js`, `PRJ.sig`, menu PROJECT > TIME SIGNATURE): 4/4, 3/4, 5/4, 7/4, 5/8, 6/8, 7/8, 9/8, 12/8; la battuta e in sedicesimi raggruppati in movimenti (x/8 = gruppi da 6 o 4). Griglie, linee del piano roll, click e conteggio delle battute del SONG seguono la chiave; cambiando chiave i pattern di battute intere mantengono il numero di battute. Lunghezza pattern libera per parte (knob LENGTH nella pagina MIX, pressione = battuta intera successiva): lunghezze diverse fra le parti = poliritmo. Le vecchie song senza `sig` si aprono in 4/4 e le griglie drum da 16 vengono estese a 32.
- Pattern synth A–D da 1 a 128 step (note `{s, n, l}`), registrazione live quantizzata (REC + PLAY), step recording (REC a trasporto fermo, sul cursore della pagina NOTES), editor piano roll nella pagina NOTES (mostra sempre tutto il pattern in una schermata, anche a 64 step).
- Song: catena di righe `{p:[pattern per parte o -1], rep}`; pulsante LOOP acceso = loop dei pattern correnti, spento = modalità SONG. In SONG le parti seguono il pattern in riproduzione.
- Preset di fabbrica (`SYNTH_PRESETS`, `KITS` in `js/presets.js`), preset utente (pagina PRESET, pressione knob 4) in localStorage `oppd1.user`. Si parte con un progetto vuoto; il progetto demo "SEVEN SKIES" (7/4, 104 BPM, Re minore: kit ELECTRO con velocity/chance/ratchet, basso FOLD, coro GRAIN, campane MACRO MODAL; 7 righe di song da 4 battute) si carica da PROJECT › LOAD DEMO.
- Sistema operativo sul display: HOME (parti, SONG, PROJECT; knob = livelli, pressione = mute), pagine per parte, SONG, PROJECT (BPM, swing, master, click; menu salva song/salva con nome/carica song/azzera pattern/nuovo/demo/MIDI). Su/Giù = voce o pagina, SELECT = azione, SELECT tenuto = home, knob trascinati/rotella, click su knob = pressione.
- Mascotte sul display (`js/bot.js`): robottino nel riquadro di HOME che balla a tempo (evento `beat` del sequencer, 4 passi diversi ogni 8 battiti, intensità dai livelli delle parti), note ♪ colorate per parte, occhi grandi sulla cassa, si addormenta (zZz) dopo 25 s senza input a trasporto fermo, saluta nella schermata di avvio. Animazioni negli effetti: fumo su DISTORT alto, blocchi glitch su BITCRUSH.
- Cancellazione veloce del pattern corrente della parte attiva (quella suonata dalla tastiera): STOP tenuto premuto (~0,5 s) o tasto Canc/Delete; Ctrl+Z ripristina l'ultimo pattern cancellato (`clearPattern`, `undoClear` in `js/core.js`).
- Skin del pannello (`js/skin.js` + `#panel[data-skin]` in `style.css`): ORIGINAL, MIDNIGHT (antracite, bagliori), 1983 (crema, guance in legno, display VFD turchese con glow), MODULAR (alluminio spazzolato, viti, titoli serigrafati, knob neri con scala); si cambiano con lo switch SKIN sotto il logo (click su una tacca o sul cursore = successiva); preferenza del browser in `oppd1.skin`, non salvata nella song. Ogni skin ricolora anche il display (`C`, `KC`, `ROW_COLORS` modificati sul posto, `DISPLAY_FX.glow`).
- Pulsanti di parte DRUM/SYN A/SYN B/SYN C nella barra del sequencer (aprono la parte) ed etichette sotto i knob con il parametro e il valore correnti.
- Salvataggio automatico in localStorage `oppd1.project` ogni 2 s (per riaprire l'ultima sessione).
- Song come file sul computer dell'utente (estensione `.oppd1`, JSON del progetto completo, campioni compresi): PROJECT > SAVE SONG (la prima volta apre la finestra Salva con nome, poi riscrive lo stesso file), SAVE SONG AS... (sempre la finestra), LOAD SONG (finestra Apri). Usa la File System Access API (Chrome/Edge, `APP.file` = handle del file corrente); negli altri browser download del file e scelta con `<input type=file>`. Il nome della song e il nome del file.

## Stack e struttura

Solo HTML/CSS/JavaScript con script classici (niente moduli: funziona da `file://`), Web Audio API, nessuna dipendenza e nessuna rete (font di sistema come ripiego di Space Grotesk / JetBrains Mono).
- `index.html`, `style.css` — pannello dal design.
- `js/audio.js` — AudioContext, bus master (compressore, analyser), inviluppi (`envStart/envStop`), effetti (`FX_DEFS`, `FxSlot`), catena per parte (`PartRT`: engIn → insert motore → input → fx1 → fx2 → pan → level → bus).
- `js/grain.js` — motore granulare.
- `js/fold.js` — motore wavefolder.
- `js/pulsar.js`, `js/vector.js`, `js/scanned.js` — motori pulsar, vettoriale e scanned.
- `js/noise.js`, `js/macro.js`, `js/fof.js`, `js/vocal.js` — motori noise/drone, macro oscillator, FOF e vocal.
- `js/engines.js` — motori (`ENGINES`, parametri normalizzati 0..1 con `fmt`) e batteria (`DRUM`, `DRUM_FN`).
- `js/presets.js` — preset, kit, `demoProject()`.
- `js/core.js` — modello del progetto (`PRJ`), sequencer (clock 24 PPQ con lookahead, swing, song), arpeggiatore, input live e registrazione.
- `js/bot.js` — mascotte animata e animazioni degli effetti.
- `js/skin.js` — skin del pannello.
- `js/os.js` — OS del display: pagine, knob, disegno su canvas.
- `js/main.js` — tastiera, griglia, knob, pulsanti, tasti del computer, MIDI, salvataggi, ciclo di disegno.
- `index.html?debug` espone `window.oppdDebug` per i test.

Non usare mai la rete o motori LLM o AI remoti per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente (`day11`).

## Comandi

Aprire `day11/index.html` nel browser. Tasti: A W S E D F T G Y H U J K O L P ; ' = note, Z/X o / e * del tastierino ottava, Spazio play/stop, R rec, Q loop/song, ↑/↓ navigazione, Invio select (tenuto = home), Esc/Backspace home, Canc cancella il pattern, Ctrl+Z annulla, 1–4 sceglie un knob, ←/→ lo ruota (Shift = fine), 5 lo preme.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- Per le webapp: verifica visiva con Chrome headless pilotato via DevTools Protocol (WebSocket di Node, script fuori dal repo). `--virtual-time-budget` non fa avanzare `requestAnimationFrame`, quindi usare il tempo reale; la larghezza minima della finestra headless è ~500 px, per il formato telefono usare `Emulation.setDeviceMetricsOverride`.
- Usare un `--user-data-dir` nuovo a ogni prova, così i dati in localStorage non restano da una prova all'altra.
- Per l'audio in headless: `--autoplay-policy=no-user-gesture-required`, poi misurare i livelli con `anLevel(RT[i].an)`.
