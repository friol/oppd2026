# CLAUDE.md — day13

Questa cartella contiene il programma day13 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, `day3`, `day4`, `day5`, `day6`, `day7`, `day8`, `day9`, `day10`, `day11`, `day12`, `day13`, ...) e deve restare autonomo.

## Obiettivo del programma

Mandelbülben: webapp che mostra 23 frattali 3D in raymarching, divisi in gruppi nel menu (Bulbs, Hypercomplex, Boxes & hybrids, Kaleidoscopic IFS, Other, Explore). Quelli limitati si ruotano (trascinamento) e si zoomano (rotella/pinch) con la camera orbitale; quelli infiniti del gruppo "Explore (fly)" (Pseudo-Kleinian, Kleinian group, Kaliset, Apollonian space) si esplorano con la camera in volo libero. Tutti si "fotografano" con un obiettivo simulato: lunghezza focale (FOV), diaframma, distanza di messa a fuoco (autofocus al centro, clic per mettere a fuoco un punto), più bloom, alone luminoso intorno al frattale, luci di sfondo sfocate e colori ciclici.

## Stack e struttura

Solo HTML/CSS/JavaScript + WebGL2, nessuna dipendenza, nessun build.

- `index.html` — canvas a tutto schermo, pannello controlli, HUD (obiettivo + fps), anello di messa a fuoco. Favicon SVG inline.
- `style.css` — stile (stessa famiglia di day12).
- `muzic/Weightless Mandelbulbs.mp3` — musica di sottofondo in loop (elemento `<audio id="bgm">`). Parte al primo clic/rotella/tasto, perché i browser bloccano l'autoplay; si disattiva dal pannello (checkbox + volume) o con il tasto M (il morph è sul tasto O). On/off e volume sono salvati in localStorage (`day13.music`, `day13.volume`). Se il file manca, il controllo si disabilita da solo.
- `js/shaders.js` — sorgenti GLSL: `SHADERS.scene(id)` (raymarching, compilato una volta per tipo di frattale tramite `#define FRACTAL`), `DOF`, `DOWN`/`UP` (bloom), `COMPOSITE`. Lo shader della scena azzera i pixel NaN/Inf in uscita: un solo NaN si spargerebbe su tutto il frame attraverso il bloom.
- `js/app.js` — catalogo frattali (`FRACTALS` in ordine di menu; `id` è il `FRACTAL` dello shader, e non coincide con la posizione), palette (gradienti ciclici di colori sRGB, caricati in una texture 256×1 `SRGB8_ALPHA8`, così lo shader legge colori lineari e dopo la gamma restano saturi), modello dell'obiettivo, pipeline, camera, input, UI.

Pipeline per frame (tutti target RGBA16F):

1. Scena: colore HDR in rgb, profondità *relativa* (z lungo l'asse camera / distanza d'orbita) in alpha; 1000 = sfondo. La profondità relativa evita i problemi di precisione dei half-float con lo zoom profondo. Lo sfondo contiene l'alone (distanza minima angolare d/t del raymarch, marcia in una sfera 2,5× il raggio del frattale per farlo sfumare) una nebulosa (fbm con domain warping nei colori della palette, slider "Nebula") e un campo di luci bokeh (`bokehField`, slider "Bokeh lights" = densità e intensità). Le luci stanno su tre gusci di direzioni a profondità relative diverse (12, 4 e 2 volte la distanza d'orbita), quindi ogni guscio ha il suo CoC, calcolato con la stessa ottica dell'obiettivo: a f/22 diventano puntini, a f/1.4 dischi grandi. Sono punti in celle 3D jitterate attorno a una sfera di raggio K: ogni pixel visita solo le 27 celle vicine, quindi il costo non dipende dal numero di luci, ma il raggio dei dischi va limitato a 0,85 celle (`0.85 / (K * pixA)`). Cielo e luci ruotano lentamente (`skyDir`, `uTime`). Nei frattali infiniti la nebulosa fa da colore della nebbia e le luci sono spente.
2. DOF a piena risoluzione. Prima `COC_TILE` calcola il CoC massimo per tessere 16×16 e `COC_DILATE` lo estende alle tessere raggiungibili (raggio `ceil(maxCoc/16)`, al massimo 4); poi il gather si ferma a quel raggio, perché nessun campione più lontano può contribuire. È lì che si risparmia: zone a fuoco e sfondo lontano dal frattale costano quasi nulla. Il gather è a spirale con angolo aureo (scatter-as-gather, alla Gustafsson), campioni pesati per luminanza (i riflessi diventano dischi di bokeh, rotondi), rotazione iniziale per pixel per non vedere la trama dei campioni. Lo sfondo ha CoC 0 (è già sfocato).
3. Bloom: catena di 6 downsample con soglia morbida sul primo, poi upsample a tenda con blending additivo.
4. Composite: aberrazione cromatica (fringing), bloom, esposizione, saturazione, ACES, vignettatura, dithering.

Modello dell'obiettivo: sensore full frame (36 mm sul lato lungo); la distanza d'orbita corrisponde a 60 cm (`SUBJECT_MM`), quindi l'effetto di sfocatura non cambia con lo zoom. CoC in pixel = `cocInf · |1 − focus/z|` con `cocInf` dalla formula ottica (f/N · f / (S − f)), limitato a `maxCoc` (~2,2% del lato lungo). Il numero di campioni DOF dipende dalla qualità (`radScale`).

Camera in volo (frattali con `infinite: true`): posizione libera (`cam.fpos`), yaw/pitch = direzione di vista, partenza da `start`. `cam.dist` diventa la scala della scena: ogni 6 frame si legge la profondità al centro (`measureScale`), così velocità, autofocus e mappatura dell'obiettivo si adattano alla scala. La velocità è proporzionale a quella profondità, quindi volando contro una parete si rallenta invece di attraversarla. WASD/frecce muovono, Q/E giù/su, Shift veloce; "rotate" diventa una crociera lenta in avanti. Lo shader non usa la sfera di contorno ma marcia fino a `far` con nebbia; niente alone né luci bokeh di sfondo. Se la partenza cade dentro il solido lo schermo diventa di un colore uniforme: le posizioni di `start` sono state scelte con prove.

Prestazioni: misurato (Chrome con `--disable-gpu-vsync --disable-frame-rate-limit`), il DOF costava più di metà del frame. Con il limite per tessere il frame è 2,8–3,5× più veloce (1568×797: 120 → 340 fps, a f/1.4 91 → 323) a qualità identica. Una DOF a mezza risoluzione era stata provata e scartata: più lenta di questa e con artefatti a blocchi 2×2 visibili. Ogni qualità ha anche un tetto di megapixel (`QUALITY[].mp`: 0,8 / 2,6 / 4,5 / 9) per gli schermi con devicePixelRatio alto. La risoluzione si adatta al tempo di frame (`dynScale`, tra 0,25 e il massimo della qualità scelta; scende sopra 30 ms per frame, sale sotto 20 ms); da fermo si fa un ultimo frame alla risoluzione piena. Se nulla si anima e la camera è ferma non si renderizza.

## Comandi

Nessun build. Aprire `index.html` nel browser (doppio click) oppure `http://localhost/oppd2026/day13/` con XAMPP. Serve WebGL2 con `EXT_color_buffer_float` (o `_half_float`).

Non usare mai la rete o motori LLM o AI remoti per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente (`day13`).

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
- Per aggiungere un frattale: nuovo ramo `#elif FRACTAL == n` in `DE` (deve scrivere l'orbit trap in `gTrap`; l'ultimo ramo è `#else`) e nuova voce in `FRACTALS` con `id: n` e `group` (`dist` = raggio da inquadrare, `bound` = raggio della sfera che lo contiene, `fudge` per DE che sovrastimano; per gli infiniti `infinite`, `start`, `far`). I tasti 1–9 selezionano le prime nove voci del menu, `,` e `.` scorrono tutte.

## Testing

- Per le webapp: verifica visiva con Chrome headless pilotato via DevTools Protocol (WebSocket di Node, script fuori dal repo). `--virtual-time-budget` non fa avanzare `requestAnimationFrame`, quindi usare il tempo reale; la larghezza minima della finestra headless è ~500 px, per il formato telefono usare `Emulation.setDeviceMetricsOverride`.
- Usare un `--user-data-dir` nuovo a ogni prova, così i dati in localStorage non restano da una prova all'altra.
- Chrome headless con GPU vera: `--headless=new --enable-gpu --use-angle=d3d11 --ignore-gpu-blocklist`. I tasti (1–8, `[ ]`, `- +`, H…) si simulano con `window.dispatchEvent(new KeyboardEvent('keydown', {key}))`; clic/doppio clic/rotella con eventi sintetici sul canvas.
- Zoom orbitale: il centro dell'orbita sta dentro il frattale, quindi `zoomBy` legge la profondità al centro dello schermo e non lascia avvicinare la camera oltre il 90% della distanza dalla superficie (per andare più vicino: doppio clic su un punto). Nei benchmark attenzione a non zoomare dentro il solido: lo schermo diventa uniforme e i numeri non significano niente.
