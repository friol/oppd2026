# CLAUDE.md — day12

Questa cartella contiene il programma day12 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, `day3`, `day4`, `day5`, `day6`, `day7`, `day8`, `day9`, `day10`, `day11`, `day12`, ...) e deve restare autonomo.

## Obiettivo del programma

Mandelbrötchen: webapp che mostra un frattale di Mandelbrot coloratissimo, con zoom (rotella) e pan (trascinamento) praticamente illimitati grazie alla perturbation theory. Oltre al Mandelbrot: z³+c, Burning Ship, Tricorn, Celtic, Buffalo, Multibrot zⁿ+c (n = 4…8) e Lambda c·z(1−z); per ognuno anche il relativo insieme di Julia (seme da input o scelto con Shift+click sulla mappa; i preset del seme valgono solo per z²+c e compaiono solo lì).

## Stack e struttura

Solo HTML/CSS/JavaScript, nessuna dipendenza, nessun build.

- `index.html` — canvas a tutto schermo, pannello controlli, HUD di stato.
- `style.css` — stile.
- `js/worker.js` — codice dei Web Worker, racchiuso in un'unica funzione `fractalWorkerMain` senza riferimenti esterni: `app.js` ne prende il sorgente e avvia i worker da un Blob URL (così funziona anche da `file://`). Contiene l'orbita di riferimento (BigInt a virgola fissa) e il loop per pixel in perturbazione.
- `js/app.js` — stato, vista, pipeline di rendering, colori, input, hash dell'URL, musica.
- `favicon.png` — Mandelbrot 64×64 con palette Rainbow e angoli arrotondati, generato una tantum (canvas in Chrome headless, 4×4 supersampling). Per rifarlo serve uno script esterno al repo.
- `muzic/Weightless Pads.mp3` — musica di sottofondo in loop (elemento `<audio id="bgm">`). Parte al primo clic/rotella/tasto, perché i browser bloccano l'autoplay; si disattiva dal pannello (checkbox + volume) o con il tasto M. On/off e volume sono salvati in localStorage (`day12.music`, `day12.volume`), come la qualità (`day12.quality`, letta in `initUi` prima del primo `resize()`; un valore non disponibile su quello schermo, es. `dpr` senza pixel extra, torna a Normal). Se il file manca, il controllo si disabilita da solo.

Come funziona:

- Il centro della vista è un BigInt a virgola fissa (`view.p` bit frazionari, crescono con lo zoom); `view.scale` (unità per pixel) è un double.
- Un worker dedicato calcola l'orbita di riferimento ad alta precisione; i worker del pool iterano ogni pixel come delta in double rispetto a quell'orbita, con *rebasing* (quando `|z| < |d|` o l'orbita di riferimento finisce si riparte dall'iterata 0): basta un solo riferimento, niente glitch.
- Formule: id numerici in `worker.js` (`MANDEL`…`LAMBDA`), con la stessa posizione nell'array `FORMULAS` di `app.js`. Ogni formula va gestita in quattro punti del worker: `computeOrbit` (BigInt), passo perturbato (inline per le quattro classiche, `stepOther` per le altre), coefficienti BLA di livello 0 in `buildBla`, divisore del conteggio smooth (`lnp`). Note:
  - Multibrot: la potenza (`state.power`, hash `pw`) viaggia nei messaggi `orbit`/`ref`. La perturbazione usa zⁿ−Zⁿ = d·Σ zᵏZⁿ⁻¹⁻ᵏ, che non ha cancellazioni.
  - Lambda: punto critico ½ invece di 0 (il rebasing usa `bx[0], by[0]`, non l'origine); il passo usa anche il c del riferimento, inviato ai worker come `cx, cy` nel messaggio `ref`; nella BLA B = W = Z − Z² invece dell'identità.
  - Celtic/Buffalo: valori assoluti gestiti con `diffabs`, come il Burning Ship; nella BLA il raggio è limitato da quanto x²−y² (e xy) restano lontani dallo zero.
- Per Julia le orbite sono due: A parte dal centro della vista, B dal punto critico 0 (bersaglio del rebasing). Nel piano dei parametri A e B coincidono.
- Il riferimento viene riusato durante il pan finché resta vicino, abbastanza preciso e abbastanza lungo (`refValid`).
- Ogni tile usa il *rectangle checking* (Mariani-Silver) in `renderTile`: si itera solo il bordo dei rettangoli e, se è tutto interno all'insieme, l'interno viene riempito senza calcoli (l'insieme dei punti che non scappano non ha buchi). È ciò che rende veloci le zone nere, che altrimenti costano `maxIter` iterazioni per pixel.
- *Bilinear approximation* (BLA, `buildBla` + `iterate`): finché il delta è minuscolo rispetto all'orbita di riferimento il passo è lineare (`d' = A·d + B·dc`), e più passi si compongono in uno solo. Ogni worker costruisce una tabella di salti di lunghezza 2^k per ogni indice del riferimento, e i pixel saltano blocchi di iterazioni. Punti da non toccare senza rimisurare:
  - due raggi di validità: `r1` (tolleranza 1e-7) solo prima del primo rebase, `r` (2^-53) dopo. Dopo un rebase l'identità del pixel sta nelle ultime cifre del delta, e una tolleranza larga lì produce errori reali;
  - si usano solo salti da 8 passi in su (livello 3): quelli più corti costano più del passo normale;
  - se la tabella non ha salti validi (viste poco profonde) si usa `iteratePlain`, il ciclo senza BLA, sensibilmente più veloce di quello generale;
  - la tabella dipende da `cmax` (massimo |dc| nella vista, arrotondato a potenza di 2 in `app.js`) e viene ricostruita quando cambia. Un messaggio `tile` senza `cmax` disattiva la BLA (utile nei test).
- *Rilievo 3D* (checkbox "3D relief", tasto L, hash `rl`/`la`): con `relief` nel messaggio `tile`, `iterate` tiene anche la jacobiana 2×2 J = dz/dp dell'orbita (p = c, o z0 per Julia), aggiornata nei passi normali (Df(z)·J + df/dc) e nei salti BLA (A·J + B). Alla fuga u = Jᵀz è la direzione di salita del "terreno"; il worker restituisce la normale unitaria (`nrm`, interleaved), il thread principale la illumina in `colorPixel` (Lambert + riflesso), per cui la luce si sposta senza ricalcolo. J è tenuta riscalata (conta solo la direzione) e il termine additivo `jk` va a zero prima dei subnormali. La jacobiana DEVE stare in variabili locali di `iterate`: come variabili di closure o dietro chiamate di funzione il passo era ~20× più lento. Costo attuale del rilievo: ~1,3–1,7×.
- *Autopilota* (pulsante, tasto A): a render finito (`renderDone`) `pickTarget` divide la zona centrale in celle e sceglie quella con media di iterazioni più alta (bonus se tocca l'interno), poi `autoStep` plana verso il punto zoomando ×3 in 2,2 s mostrando l'anteprima stirata, e solo alla fine lancia il render. Puntare ai singoli pixel con più iterazioni porta nella "polvere" caotica: evitarlo. Qualsiasi input sulla vista lo ferma; al limite di zoom riparte dalla vista iniziale.- Rendering progressivo a tile (passata grossolana a blocchi 4×4, poi piena), dal centro verso l'esterno. Durante zoom/pan si mostra subito l'ultima immagine trasformata; il render vero parte dopo 120 ms di quiete.
- I worker restituiscono `sqrt(iterazioni smooth)` (−1 = interno); il colore si applica sul thread principale da una LUT, quindi palette, densità e color cycling non richiedono ricalcolo.
- La posizione completa è salvata nell'hash dell'URL (condivisibile).

Limiti noti:

- Zoom massimo ~1e247× (`MIN_SCALE = 1e-250`): i delta sono double. Per andare oltre servirebbe un'aritmetica "floatexp" nel loop dei pixel.
- Nel loop dei pixel il termine d² viene saltato quando |d| < 1e-150: lì è trascurabile e il suo valore cadrebbe nei subnormali, che rallentano il calcolo anche di 50×. Non rimuovere quel controllo.
- Con la BLA (tolleranza larga iniziale) il punto campionato si sposta di una frazione minima di pixel (~1e-5): nelle zone caotiche il conteggio di alcuni pixel cambia rispetto al calcolo esatto, come cambierebbe spostando il campione della stessa quantità. Nei test, il confronto pixel per pixel con l'esatto va fatto senza `cmax`.
- La BLA rende poco nelle viste poco profonde (dc grande): lì il tempo resta proporzionale alle iterazioni.
- Il Burning Ship è per natura molto sensibile agli arrotondamenti: una piccola quota di pixel differisce dal calcolo esatto, esattamente come con i double semplici. Celtic e Buffalo nel piano dei parametri lo sono ancora di più: nelle zone caotiche anche il calcolo esatto cambia quasi metà dei pixel spostando il campione di 1e-6 pixel. Per giudicare un test su queste formule va confrontato con questa sensibilità, non con zero.
- Multibrot con potenze alte è più lento (n−1 moltiplicazioni complesse per passo).

Non usare mai la rete o motori LLM o AI remoti per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente (`day12`).

## Comandi

Nessun build. Aprire `index.html` nel browser (doppio click) oppure `http://localhost/oppd2026/day12/` con XAMPP.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
- Gli id delle formule (`MANDEL`, `CUBIC`, `SHIP`, `TRICORN` in `worker.js`) devono corrispondere all'ordine di `FORMULAS` in `app.js`.

## Testing

- Matematica: caricare `js/worker.js` in Node con un finto `self` (`postMessage` + setter `onmessage`), mandare i messaggi `orbit`, `ref`, `tile` e confrontare il risultato con l'iterazione diretta in BigInt degli stessi pixel. Per trovare punti di test profondi, zoomare automaticamente su pixel di bordo con conteggio moderato (non il massimo: porta in zone degeneri).
- Per le webapp: verifica visiva con Chrome headless pilotato via DevTools Protocol (WebSocket di Node, script fuori dal repo). `--virtual-time-budget` non fa avanzare `requestAnimationFrame`, quindi usare il tempo reale; la larghezza minima della finestra headless è ~500 px, per il formato telefono usare `Emulation.setDeviceMetricsOverride`.
- Usare un `--user-data-dir` nuovo a ogni prova, così i dati in localStorage non restano da una prova all'altra.
- Rilievo: la normale si verifica contro il gradiente del conteggio smooth calcolato a differenze finite (micro-tile 3×3 con passo scala/1000), scartando i punti dove il gradiente a passo h e 2h non concorda (zone non lisce).- Si può aprire una posizione precisa passando l'hash (`#f=mandelbrot&j=0&re=…&im=…&span=1e-40`); il render è finito quando `#status` inizia con "Rendered".
