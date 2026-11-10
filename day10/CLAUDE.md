# CLAUDE.md — day10

Questa cartella contiene il programma day10 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, `day3`, `day4`, `day5`, `day6`, `day7`, `day8`, `day9`, `day10`, ...) e deve restare autonomo.

## Obiettivo del programma

**RetroRun**: gioco di corse pixel-art in stile arcade anni '80 (strada pseudo-3D in prospettiva).
- Tempo limitato fino al prossimo checkpoint; ad ogni checkpoint un bivio con 2 strade e scenari diversi.
- Monete = benzina (il serbatoio si svuota col tempo/acceleratore). Chiavi inglesi = riparazione.
- Urtare auto o oggetti aumenta il danno, che riduce la velocità massima (fino a -45%).
- Percorso a piramide: OCEAN DRIVE (Miami, tramonto, spiaggia, mare, surf) → NEON CITY | GATOR BAYOU → KEYS BRIDGE | DESERT RUN → GOAL.
- Cronometro della gara (da GO! al traguardo, pause escluse) nell'HUD e nelle schermate finali; classifica dei 10 migliori punteggi con iniziali (3 lettere), tempo totale per chi arriva al traguardo, stage raggiunto e miglior tempo assoluto, salvata in localStorage (`retrorun.scores`, `retrorun.best`, `retrorun.name`); nel titolo si alterna alla schermata principale ogni 7 s.
- Salti sui dossi (modello arcade: un dosso più netto di `CREST_FROM` spinge l'auto in alto, poi gravità `AIR_G`; poca sterzata in aria, ombra che resta sulla strada, atterraggio con scintille e BIG AIR se > 0,45 s), radio DJ (cartellino con cassetta in alto a destra quando parte una stazione), foto finish (foto della vista 3D poco prima dell'arco GOAL, mostrata come Polaroid con percorso e tempo nella schermata finale), sorpassi in serie (STREAK: bonus ogni 5, +3 s ogni 10, si azzera a ogni urto), una galleria per stage in OCEAN DRIVE, NEON CITY e DESERT RUN (`tunnel` nei temi; pareti come guard-rail, eco sul motore e sugli effetti, musica attenuata, niente pioggia/sabbia dentro).
- Luci notturne: lampioni, insegne neon, cartello Ocean Drive, motel e faro hanno punti luce (`lights` sugli sprite in gfx.js); si accendono uno alla volta col buio (soglia diversa per ognuno, sfarfallio iniziale), i neon ogni tanto ronzano spegnendosi, i lampioni illuminano il terreno, il faro ha il fascio rotante. Le luci (e i fuochi d'artificio) sono disegnate su un canvas separato durante il passaggio dal fondo al primo piano: gli sprite più vicini e le gallerie le "bucano" (occlusione), poi il canvas è sommato dopo il filtro notte.
- Chiave inglese presa senza danni = OVERDRIVE: +15% di velocità massima per 12 s (cumulabile fino a 24 s); boost e overdrive possono superare la velocità di punta normale (limite 130%). KEYS BRIDGE è sempre di giorno (`nightK: 0`; il buio sfuma tra uno stage e l'altro); traffico ridotto in NEON CITY (7) e KEYS BRIDGE (5).
- Scia (slipstream): dopo 0,8 s dietro un'auto nella stessa corsia (1,2..7 segmenti, oltre metà velocità) +8% di velocità massima con righe di vento, mantenuta 1,5 s dopo essere usciti dalla scia. In OVERDRIVE il clacson suona l'inizio di "La Cucaracha" (melodia popolare tradizionale).
- Turbo alla partenza: gas premuto negli ultimi 0,45 s prima del GO! (o entro 0,2 s dopo) = PERFECT START (velocità e boost); tenuto premuto da prima = WHEELSPIN (gomme che pattinano per 0,6 s).
- Eventi nello scenario: delfini che saltano a coppie accanto al KEYS BRIDGE, rotolacampo che attraversano la strada nel DESERT RUN (se colpiscono l'auto: rametti, nessun danno), treno merci sull'orizzonte del deserto (con fischio), fuochi d'artificio sul mare di OCEAN DRIVE quando è buio.
- Messaggi di gioco (CHECKPOINT, EXTENDED PLAY, CRASH...) piccoli nel cielo sotto l'HUD, sull'overlay ad alta risoluzione, con dissolvenza.
- Extra: fumetti piccoli del passeggero (il ragazzo a destra; guida la ragazza) (urti, poca benzina, polizia, meteo), clacson che fa spostare le auto, CLOSE CALL (sorpasso a filo = +1000 e breve boost), gabbiani e aereo con striscione su Miami, ciclo giorno/notte (un ciclo ogni 240 s di gara, con fari e luci posteriori), meteo per stage (`weather` nei temi: pioggia con lampi e meno aderenza in GATOR BAYOU, tempesta di sabbia con raffiche laterali in DESERT RUN), traffico vivo (cambi corsia con freccia, camion lenti, l'auto della polizia urtata insegue a sirene accese per 7 s).

## Stack e struttura

Solo HTML/CSS/JavaScript, nessuna dipendenza a runtime. La musica sono 3 MP3 forniti dall'utente. Strada e sfondi sono generati a runtime; macchina del giocatore, auto del traffico e oggetti (palme, lampioni, alberi, rocce, cartelli, persone, ombrelloni...) vengono da sprite bitmap.
- `index.html`, `style.css` (canvas 640x360 scalato con `image-rendering: pixelated`: la vista 3D (strada, sprite, auto) è disegnata a 640x360, mentre HUD, sfondi, particelle e menu usano coordinate logiche 320x180 con `ctx.scale(R)`, R = 2; canvas `#hud` alla risoluzione reale dello schermo per logo e testi del titolo, countdown, GO! e CHECKPOINT (`hudImg()`), overlay CRT, pulsanti touch).
- `assets/src/` — fogli sprite originali forniti dall'utente (`car_rear.png`, `traffic_sport.png` + `traffic_mix.png` (auto avversarie, griglie 4x4 su sfondo sfumato), `props_synthwave.png` con sfondo sfumato, `props_magenta.jpg` con sfondo magenta (anche pubblico, countdown 3-2-1, GO!, CHECKPOINT), `logo.png` trasparente).
- `tools/build_sprites.py` — script offline (Python + Pillow) che scontorna gli sprite (chroma key magenta / flood fill a gradiente), li ridimensiona e genera `assets/sprites.png` + `js/atlas.js` (`nome: [x, y, w, h, base_x]`) e `assets/logo.png` ridimensionato. Da rilanciare dopo aver cambiato i fogli o i riquadri.
- `js/font.js` — font bitmap 5x7 con cache.
- `js/gfx.js` — ritaglio degli sprite dall'atlas (`bs()` = sprite dimensionato per altezza nel mondo, varianti specchiate/tinte) più sprite procedurali rimasti (hotel, grattacieli, insegne, surf, ponte, monete, chiavi, portali) e sfondi.
- `js/track.js` — temi degli stage (colori, acqua, limiti laterali, decorazioni).
- `muzic/` — i 3 brani MP3 delle "radio" (`sunset.drive.mp3` = SUNSET DRIVE, `neon.pulse.mp3` = NEON PULSE, `palm.breeze.mp3` = PALM BREEZE).
- `js/audio.js` — musica: un elemento `<audio>` in loop con gli MP3 di `muzic/` (funziona anche da `file://`); motore: modello fisico di un V8 (`js/engine_dsp.js`: albero motore, 8 scoppi a intervalli leggermente irregolari con variazioni casuali, collettori, marmitta e terminale simulati come tubi) eseguito in un AudioWorklet caricato da URL `data:` (da `file://` gli URL blob sono rifiutati), con ScriptProcessor di riserva; cambio a 2 marce (LOW/HIGH) che calcola i giri; effetti sintetizzati.
- `js/game.js` — costruzione pista a segmenti, bivi (`fork`, `s1/s2` = separazione dei rami), fisica, traffico, rendering a scanline, HUD; parte solo dopo il caricamento di `assets/sprites.png` (`startGame`).
- `index.html?debug` espone `window.rrDebug` (jump/set/info) per i test automatici.
Non usare mai la rete o motori LLM o AI remoti per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente (`day10`).

## Comandi

Aprire `day10/index.html` nel browser (funziona anche da `file://`). Rigenerare gli sprite: `python tools/build_sprites.py` (dalla cartella day10). Comandi: frecce/WASD, Invio = start, Spazio/H = clacson (in gara; in overdrive suona una melodia), M = musica, R = cambia radio in gara, P/Esc = pausa; nel titolo ←/→ cambiano la radio.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- Per le webapp: verifica visiva con Chrome headless pilotato via DevTools Protocol (WebSocket di Node, script fuori dal repo). `--virtual-time-budget` non fa avanzare `requestAnimationFrame`, quindi usare il tempo reale; la larghezza minima della finestra headless è ~500 px, per il formato telefono usare `Emulation.setDeviceMetricsOverride`.
- Usare un `--user-data-dir` nuovo a ogni prova, così i dati in localStorage non restano da una prova all'altra.
