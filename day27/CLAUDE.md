# CLAUDE.md — day27

Questa cartella contiene il programma day27 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day26`, `day27`, ...) e deve restare autonomo.

## Obiettivo del programma

**Artist and Computer** (titolo della pagina, senza sottotitolo): webapp che genera all'infinito "stampe" animate, sempre diverse, ispirate alle immagini di computer art fornite dall'utente (dal libro *Artist and Computer* di Ruth Leavitt). In fondo alla pagina la dicitura "Inspired by ‘Artist and Computer’ by Ruth Leavitt" con il link a https://www.atariarchives.org/artist/.

- **Ventidue studi** (`STYLES`: 1-12 in `js/styles.js`, 13-16 in `js/styles2.js`, 17-20 in `js/styles3.js`, 21-22 in `js/styles4.js`), ognuno con più palette e parametri casuali da un seme:
  1. *Diamond Variation* (`diamond`): diamante di tessere rombiche estruse, deformato da uno "schizzo" che si sposta e pulsa.
  2. *Computer Ribbon* (`ribbon`): nastro di centinaia di linee lungo una spirale poligonale, in un campo con cornice a due bande e un angolo arrotondato.
  3. *Exploded City* (`boxes`): griglia di scatole in prospettiva verso un punto di fuga che vaga, con finestre e scatoline interne.
  4. *In the Wild* (`peaks`): picchi frastagliati disegnati con contorni annidati che convergono; tutte le montagne si tracciano contemporaneamente (in 3 s), dal profilo verso l'interno.
  5. *Square Field* (`squares`): griglia di quadrati concentrici, colori da un gradiente più rumore che si muove.
  6. *Raster Weather* (`pixels`): raster di pochi colori piatti che evolve (modello del votante con mutazioni).
  7. *Wire Form* (`mesh`): forma 3D che ruota, fatta di anelli sottili sovrapposti.
  8. *Twisted Leaf* (`twist`): tubo appiattito che si avvita lungo una spina a S, disegnato a sezioni ellittiche.
  9. *Disorder Squares* (`disorder`): griglia di quadrati concentrici i cui vertici si spostano (rumore nel tempo) sempre di più verso un angolo, un lato o il centro; qualche quadrato in un colore d'accento.
  10. *Harmonograph* (`harmono`): traccia di due pendoli smorzati (rapporti di frequenza quasi interi), disegnata in 5 s, poi le fasi derivano lentamente.
  11. *Truchet Weave* (`truchet`): tessere a quarti di cerchio (o diagonali) con 1-3 bande, che ogni tanto ruotano di 90° (0,7 s) e cambiano i percorsi; ogni tessera è ritagliata nella sua cella.
  12. *Moiré Rings* (`moire`): due famiglie di anelli sottili (a volte anelli + linee parallele che ruotano) che scorrono una sull'altra, in un cerchio o nel quadrato.
  13. *Broken Cubes* (`cubes`): griglia di cubi in fil di ferro che ruotano, ognuno con alcuni dei 12 spigoli mancanti; gli spigoli compaiono e spariscono con una dissolvenza.
  14. *Gravel* (`gravel`): colonna 12×21 di quadrati ordinati in alto che si spostano e ruotano sempre di più scendendo (a volte al contrario); il confine del disordine scivola su e giù.
  15. *Flow Field* (`flow`): 900-1600 tratti brevi che seguono un campo di rumore che cambia lentamente, in 1-3 inchiostri; compaiono in 4 s; ritagliati all'area interna.
  16. *Line Terrain* (`terrain`): paesaggio di profili paralleli in prospettiva che scorre verso chi guarda; righe disegnate dalla più lontana, ciascuna riempita col colore della carta sotto la linea per nascondere quelle dietro; a volte creste aguzze o una valle al centro.
  17. *Drifting Circles* (`rings`): 1-3 gruppi di cerchi concentrici il cui centro si sposta un poco a ogni anello (direzione dal rumore, che cambia nel tempo), così le linee si addensano da un lato.
  18. *Polygon Whirls* (`whirl`): un poligono (triangolo, quadrato, esagono) ripetuto 40-90 volte, ruotato e rimpicciolito in modo che i vertici tocchino i lati del precedente (fattore `cos(π/n)/cos(π/n − α)`), in 1-4×1-4 tessere che girano in versi opposti; a volte a fasce colorate alternate; disegnato in 3 s, poi l'angolo oscilla.
  19. *Growing Maze* (`maze`): linee che crescono cella per cella su una griglia, girando e ramificandosi fino a riempire il foglio (quando tutte sono bloccate ripartono da una cella libera); stato mutabile nel generatore (come `pixels` e `truchet`).
  20. *Circle Packing* (`packing`): fino a 420 cerchi impacchettati senza toccarsi (calcolati in `make`), in 4 colori piatti: dischi, anelli concentrici, mezzi dischi che ruotano, dischi con punto; compaiono uno dopo l'altro in 4 s.
  21. *Op Waves* (`opwaves`): 28-48 fasce piatte di 2-4 colori i cui bordi ondeggiano, con l'onda che si gonfia attorno a un punto e svanisce ai lati (Op Art); a volte verticali; bande extra oltre i bordi per non lasciare buchi.
  22. *Unknown Script* (`glyphs`): pagina di una scrittura inventata; ogni pezzo crea un suo alfabeto (18-30 glifi da 3-5 tratti, a volte curvi, su una griglia 3×3, a volte con un punto) e scrive parole e paragrafi in 6 s, con l'iniziale di paragrafo in rosso; poi ogni tanto una lettera si riscrive con una dissolvenza.
- Gli stili "plotter" si disegnano progressivamente (In the Wild 3 s; Computer Ribbon, Wire Form e Twisted Leaf 5 s), poi continuano a muoversi.
- **Avanzamento automatico** ogni 30 s (barretta sotto la stampa, `day27.auto`) con dissolvenza; cronologia con Prev/Next; filtro per studio (`day27.filter`); "Save PNG". Il pezzo corrente è nell'hash (`#stile/seme`), quindi si può condividere o ricaricare.
- **Colonna sonora** (`js/music.js`, `MUSIC`): i tre mp3 di `muzik/` ("Generative Drift", "Liminal Bloom", "Endless Side-scrolling") a rotazione con un elemento `<audio>`, partendo da uno a caso; parte al primo click/tasto (regola dei browser) con dissolvenza in entrata; **continua a suonare** anche con la scheda nascosta o il browser in secondo piano; on/off col pulsante "♫ Music" o il tasto M (`day27.music`).
- **Remix** (`remixColours` / `remixShape` in `app.js`): "◐ Colours" (tasto C) tiene la composizione e cambia palette; "◇ Shape" (tasto R) tiene i colori e cambia composizione. Funziona perché ogni studio sceglie la palette col **primo** numero casuale: un pezzo è `{ style, seed, pal? }` e `U.rng(seed, pal)` sostituisce solo quel primo numero con uno generato da `pal` (la sequenza principale avanza comunque, quindi il resto non cambia). Regola per i nuovi studi: la prima chiamata a `r` in `make` deve essere `r.pick(this.palettes)` e lo stile deve avere `palettes`. Hash `#stile/seme/pal`; titolo "No. seme·pal"; i preferiti salvano anche `pal`.
- **SVG** (`js/svg.js`, `SVGX.render`; pulsante "SVG ↓", tasto V): un finto `CanvasRenderingContext2D` registra ciò che lo studio disegna e lo scrive come `<path>` SVG (tratti, riempimenti, archi appiattiti in segmenti, curve quadratiche, trasformazioni, `save/restore`, un livello di `clip`, `globalAlpha`); durante l'esportazione `window.Path2D` è sostituito dal registratore. Il pezzo viene ricreato e disegnato al tempo corrente: gli studi che evolvono a caso (Raster Weather, Truchet Weave, Broken Cubes, Growing Maze, Unknown Script) vengono rigenerati, quindi i dettagli possono differire dallo schermo. Pulsante PNG rinominato "PNG ↓".
- **Schermo intero** (`setKiosk`; pulsante "⛶ Full", tasto F o doppio click sulla stampa): classe `kiosk` sul body, resta solo la stampa sulla parete, grande quanto lo schermo; il cursore sparisce dopo 2,5 s fermo (`idle`); breve avviso "Esc to leave full screen". Esc (o l'uscita dal fullscreen del browser) torna alla vista normale. Se il browser rifiuta il fullscreen, la vista "kiosk" resta comunque nella finestra.
- **Preferiti e galleria**: "♡ Keep" / tasto K salva o toglie studio + seme della stampa corrente in `day27.favs` (il più recente per primo; il pulsante diventa "♥ Kept"); "Gallery N" / tasto G apre un pannello con le miniature (disegnate al tempo `THUMB_T` = 12 s con la stessa `paint()` della stampa), click per riaprire quella stampa, ✕ per toglierla; Esc, G, "Close" o click fuori per chiudere. Mentre la galleria è aperta il tempo della stampa si ferma.
- **Menu degli studi** in verticale a sinistra, dall'alto (`.mid` = menu + `.stage`); sotto i 640 px torna una riga orizzontale scorrevole sopra la stampa.
- Etichetta da museo (titolo, numero = seme, tecnica) **a destra della stampa**, centrata in verticale; stampa ed etichetta sono centrate insieme nello stage (il menu a sinistra fa da contrappeso) e la stampa usa tutta l'altezza; va sotto la stampa solo quando così la stampa viene molto più grande (schermi stretti/verticali; `layout()` in `app.js` confronta le due disposizioni). Dicitura "Inspired by..." piccola (10 px), senza riga sopra.

## Stack e struttura

HTML, JavaScript e CSS puri, script classici (non moduli): deve funzionare anche da `file://`. Nessuna risorsa esterna.
Per tutti i file, usare sempre la sottocartella relativa al giorno corrente.

- `index.html`, `style.css`, `favicon.svg`, `muzik/*.mp3`
- `js/music.js`: `MUSIC` (`toggle()`, `enabled`, `state` per i test).
- `js/svg.js`: `SVGX` (esportazione SVG).
- `js/util.js`: `TAU`, `U` (generatore casuale con seme `U.rng(seed, pal)`, rumore 3D `U.noise`, `lerp`, `clamp`, `ease`, `poly`).
- `js/styles.js` (studi 1-12), `js/styles2.js` (13-16), `js/styles3.js` (17-20) e `js/styles4.js` (21-22): `STYLES`; ogni stile ha `id`, `name`, `medium`, `aspect` (larghezza/altezza) e `make(rand, noise)` che restituisce `{ paper, draw(ctx, w, h, t) }` (`t` = secondi dalla comparsa; i margini della carta li gestisce l'app).
- `js/app.js`: impaginazione, ciclo di animazione, cronologia, controlli; `window.APP` per i test (`S`, `next`, `prev`, `show(stile, seme)`, `setPaused`, `setKiosk`, `setGallery`, `toggleFav`, `remixColours`, `remixShape`, `svg()` = stringa SVG del pezzo corrente).
- Ordine degli script: music, util, svg, styles, styles2, styles3, styles4, app. Il ciclo di animazione richiede il frame successivo prima di disegnare e intercetta gli errori, così un errore in uno studio non blocca la pagina.
- `tools/shot.js`: screenshot con Chrome headless.

## Comandi

- Avvio: aprire `index.html` nel browser (o `http://localhost/oppd2026/day27/` con XAMPP); `index.html#peaks/777` apre uno studio e un seme precisi.
- Tasti: → / N = successivo, ← / P = precedente, Spazio = pausa, A = avanzamento automatico, S = salva PNG, V = salva SVG, C = remix colori, R = remix composizione, M = musica, F = schermo intero (Esc per uscire), K = tieni nella galleria, G = galleria, 0 = tutti gli studi, 1-9 = solo quello studio (dal 10° in poi solo col menu).

## Testing

- `node tools/shot.js out.png [secondi] [js da valutare] [w] [h]` (con `SHOT_MOBILE=1` emula un telefono; `@file.js` legge il codice da un file): stampa console ed errori e salva uno screenshot. Per uno studio preciso: `SHOT_URL="file:///D:/xampp/htdocs/oppd2026/day27/index.html#ribbon/1234"`.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Le animazioni principali non vanno disattivate con `prefers-reduced-motion`: sul PC dell'utente le animazioni di Windows sono spente e il browser segnala "reduce".
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
