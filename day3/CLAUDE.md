# CLAUDE.md — day3

Questa cartella contiene il programma day3 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, `day3`, ...) e deve restare autonomo.

## Obiettivo del programma

Costruisci una webapp, con l'utilizzo della libreria three.js. La webapp deve mostrare il classico effetto matrix dei caratteri verdi che scendono su sfondo nero su un singolo piano, ma poi la camera deve ruotare sull'asse verticale, rivelando tanti piani con lo stesso effetto sopra, e avanzare tra questi piani all'infinito. Usa come font per i caratteri dell'effetto matrix `fonts/MatrixCodeNfi-YPPj.otf`.
Prima di tutto c'è un breve prologo: su fondo nero un cursore scrive "The matrix has you, Neo." e dopo qualche secondo parte l'effetto. Lo schermo inizialmente è nero e si riempie piano piano dei caratteri che scendono. Quando la camera ruota compaiono dei rettangoli semitrasparenti e luminosi, paralleli ai piani, sparsi per lo spazio (verdi, luminescenti, con una pulsazione lenta) e dentro testo che scorre come in una console di computer, con un font a passo fisso e retro. Dopo la rotazione l'inquadratura ruota lentamente di 360° attorno all'asse di vista, e durante il volo compaiono da lontano, sempre più vicini, modelli 3D in wireframe (computer, telefono cellulare, cornetta, occhiali da sole), disegnati linea per linea da un cursore luminoso, come nel film Matrix. Come sottofondo suona in loop `music/Deep Sub Pulses.mp3`, e i rettangoli verdi e i modelli wireframe pulsano lentamente al ritmo della musica.

## Stack e struttura

HTML, javascript e CSS.
Non usare mai la rete o motori LLM o AI remoti per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente.

## Struttura

- `lib/three.min.js`: three.js r159 (MIT, `lib/three-LICENSE`), l'ultima versione con la build classica non-modulo, così la pagina funziona anche da `file://` senza ES module. Il warning di deprecazione in console è atteso.
- `fonts/MatrixCodeNfi-YPPj.otf`: font Matrix Code NFI (Norfok), caricato con `FontFace`; se fallisce si usa `monospace`.
- `index.html` + `style.css`: pagina a tutto schermo con il canvas WebGL, il testo del prologo (`#prologue`, Courier New verde con bagliore e cursore a blocco), una riga di aiuto (mostrata per 5 s quando parte l'effetto) e l'elemento `<audio>` della musica.
- `js/prologue.js`: prologo in un overlay HTML: cursore a blocco che lampeggia per `WAIT_BEFORE` s, scrive la riga con ritmo irregolare (pausa dopo la punteggiatura, cursore fisso mentre scrive), la lascia per `WAIT_AFTER` s, poi `BLACK` s di nero e callback di fine.
- `music/Deep Sub Pulses.mp3`: musica di sottofondo in loop, parte con l'effetto dopo il prologo; se il browser blocca l'autoplay parte al primo tasto o clic.
- `js/beat.js`: pulsazione da 0 a 1 che segue i bassi della musica (Web Audio `AnalyserNode` sull'elemento `<audio>`, energia nella banda 30-160 Hz, normalizzata con minimo e massimo che si adattano lentamente, salita rapida e discesa lenta). Il grafo audio viene collegato solo quando l'`AudioContext` è attivo; il mute (`M`) agisce su un `GainNode` dopo l'analyser, così la pulsazione continua. Da `file://` il browser considera l'mp3 cross-origin e l'analyser sentirebbe solo silenzio (e silenzierebbe la musica), quindi lì `update` restituisce `null` e rettangoli e modelli tornano alla loro pulsazione lenta.
- `favicon.svg`: favicon vettoriale (colonne di pioggia verde con testa chiara e un pannello luminoso in prospettiva su fondo nero).
- `js/atlas.js`: disegna 64 caratteri del font in un atlas 8x8 su canvas (centrati con le bounding box misurate), texture con mipmap e anisotropia.
- `js/rain.js`: `ShaderMaterial` della pioggia, interamente procedurale dalle coordinate mondo (colonne con velocità/periodo/scia da hash, 40% di colonne vuote, riempimento iniziale: ogni colonna parte a un istante casuale entro `uFillTime` con la prima goccia che entra a `uFillTop` e le celle non ancora raggiunte restano nere, testa bianca, caratteri che cambiano nel tempo, alone da un campione più sfocato, dissolvenza al valore medio quando le celle scendono sotto il pixel, nebbia). Blending additivo, niente depth.
- `js/panels.js`: 70 rettangoli luminosi semitrasparenti nel piano YZ (verdi, lati da 1,5-7 × 1-4,5; aspetto luminescente con distanza con segno dal bordo: bordo con nucleo chiaro, bagliore interno e alone esterno di `HALO` unità, per cui il quad è ingrandito; pulsazione lenta al ritmo della musica (da `Beat`, con un piccolo respiro proprio ogni 7-16 s; senza analisi solo il respiro); testo della console disegnato nello shader: ogni rettangolo parte da una riga casuale del buffer e scrive `rate` righe al secondo (carattere per carattere, cursore lampeggiante, scorrimento quando è pieno), dimensione dei caratteri casuale; i rettangoli guardano sempre verso il percorso della camera, così il testo non è mai specchiato; la pulsazione riguarda il bagliore, non il testo; nebbia e dissolvenza vicino alla camera), fuori dal percorso della camera; compaiono con ritardi casuali durante la rotazione e quando restano dietro la camera vengono riposizionati davanti con nuove dimensioni.
- `js/console.js`: testo da console per i rettangoli. Font bitmap 5x7 a passo fisso (lo stesso del day1, copiato e ampliato con `[ ] # $ % * " \ @ & ; ^`) disegnato a punti in un atlas 8x8 (ASCII 32..95, solo maiuscole); buffer di 512 righe × 64 colonne di finto output da terminale (log di boot, hex dump, ping, DIR, decrittazione, connessioni, trace, comandi, qualche citazione) in una `DataTexture` a un canale, con la lunghezza della riga nell'ultima colonna.
- `js/models.js`: 6 modelli wireframe verdi costruiti proceduralmente a segmenti (`EdgesGeometry` di box/cilindri più linee: computer CRT con tastiera e case, cellulare con antenna e tastierino, cornetta con cavo a spirale, occhiali da sole), normalizzati a dimensione 1, con punti luminosi sui vertici. Compaiono a turno dopo la rotazione 36-42 unità davanti alla camera, vengono tracciati linea per linea da un cursore luminoso (un punto chiaro e tremolante sulla punta del segmento in corso, seguito da una breve scia chiara) a velocità costante nell'ordine in cui i segmenti sono costruiti, in `BUILD_TIME` s (ogni vertice ha la lunghezza già tracciata `aDraw`; i punti sui vertici compaiono quando il cursore li raggiunge), hanno una banda di scansione che sale, si illuminano e si gonfiano leggermente al ritmo della musica, girano lentamente e vanno incontro alla camera; ogni nuovo modello passa più vicino al percorso (da `R_FAR` a `R_NEAR` in `CLOSE_TIME` s). Nebbia e dissolvenza vicino alla camera come i rettangoli; quando restano dietro la camera ricompaiono lontano con un modello a caso.
- `js/main.js`: scena e timeline della camera. Durante il prologo (`started` falso) il canvas resta nero e il tempo è fermo; `begin()` azzera tutto e riparte dal prologo. Piani paralleli nel piano YZ a `x = ±(k+0.5)·GAP`; si parte guardando il primo piano a sinistra (yaw 90°, gli altri invisibili), dopo `HOLD` s la camera ruota di 90° in `TURN` s mentre gli altri piani compaiono, poi avanza lungo -Z all'infinito e, finita la rotazione, l'inquadratura ruota lentamente e senza fine attorno all'asse di vista (360° ogni `ROLL_PERIOD` s); per questo i piani sono alti `HEIGHT` 100 e i rettangoli sono sparsi anche in altezza. I piani seguono la camera in z (la pioggia resta ferma perché dipende dalle coordinate mondo); le colonne si ripetono ogni `Rain.WRAP` celle e la camera viene riportata indietro della stessa lunghezza, per non perdere precisione.

## Comandi

- Avvio: aprire `index.html` nel browser (anche da `file://`, ma senza pulsazione a ritmo di musica) oppure `http://localhost/oppd2026/day3/` con XAMPP.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- Tasti: `Space` pausa (anche la musica), `R` riparte dall'inizio (dal prologo, anche la musica), `M` musica on/off, `F` schermo intero, `H` mostra/nasconde l'aiuto.
- Verifica visiva con Chrome headless (puppeteer-core, fuori dal repo) su `http://localhost/oppd2026/day3/`: screenshot a ~3 s (prologo), poi, contando dall'inizio dell'effetto (circa 9 s dopo il caricamento), a ~2 s (riempimento), ~9 s (piano singolo pieno), ~13 s (rotazione), ~20 s (volo tra i piani), ~30 s (modelli wireframe); in console deve esserci solo il warning di deprecazione di three.js. Per la musica serve `--autoplay-policy=no-user-gesture-required`.
