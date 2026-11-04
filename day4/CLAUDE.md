# CLAUDE.md — day4

Questa cartella contiene il programma day4 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, `day3`, `day4`, ...) e deve restare autonomo.

## Obiettivo del programma

Costruisci una webapp dal titolo “Interstellar’s labyrinth”, che mostri un labirinto fatto di cerchi concentrici e muri, in cui il punto iniziale sia il centro e ci sia una sola uscita sul cerchio più esterno. Il giocatore ha 1 minuto per completare il labirinto; se il tempo termina, il gioco scriverà “You lose, draw another one.”. Fai in modo che ci siano tanti bivi nel labirinto, e che non sia facile da risolvere. La grafica è su sfondo grigio chiaro e deve dare un'impressione di modernità, come un quadro di Escher. Il pallino del giocatore deve essere facile da controllare anche con il mouse. All'inizio si sceglie tra 3 livelli di difficoltà (facile, medio, difficile) che corrispondono a 3 dimensioni del labirinto; il medio è la dimensione di 15 anelli.

## Stack e struttura

HTML, javascript e CSS.
Non usare mai la rete o motori LLM o AI remoti per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente.

## Struttura

- `index.html` + `style.css`: canvas a tutto schermo, in alto titolo, sottotitolo (la citazione “can you draw in one minute a labyrinth that takes more than one minute to solve?”, corsivo serif grigio), timer e sotto il record del livello in corso (“Record (Hard): 42.3 s”, riga vuota se non c'è ancora un record; aggiornato a inizio partita e dopo una vittoria), menu iniziale "Choose your labyrinth" (pulsanti Easy/Medium/Hard), riquadro dei messaggi di vittoria/sconfitta con i pulsanti "Draw another one" e "Change level", riga di aiuto in basso. Tema chiaro (carta grigia, inchiostro quasi nero, un solo accento rosso `#c8402f`), font di sistema, nessuna risorsa esterna.
- `favicon.svg`: favicon vettoriale, un piccolo labirinto circolare (tre anelli con varchi e muri radiali, centro nero, freccia rossa sull'uscita in alto).
- `js/maze.js`: labirinto circolare (theta maze). `rings` anelli (scelti dal livello), il centro è una sola cella, il primo anello ha 6 celle e poi il numero di celle raddoppia quando una cella diventerebbe larga più del doppio dello spessore dell'anello (10 anelli: 223 celle; 15: 463 celle, 48 sull'anello esterno; 20: 895 celle, 96 sull'anello esterno). Ogni cella conosce il vicino interno (`parent`) e quello in senso orario (`cw`); i passaggi aperti sono in `links` (liste di adiacenza) e in `open` (Set di coppie). Labirinto perfetto (albero di copertura) scavato con il growing tree (`NEWEST` 0.65: corridoi lunghi mischiati a molte diramazioni); l'uscita è la cella dell'anello esterno più lontana dal centro (BFS). `generate` scava più labirinti e tiene quello con punteggio più alto (lunghezza della soluzione + 4 × bivi lungo la soluzione): tipicamente soluzione di 47-79 celle con 15-20 bivi (Easy), 60-130 con 20-31 bivi (Medium), 96-148 con 28-39 bivi (Hard). Angoli in senso orario a partire dall'alto.
- `js/audio.js`: effetti sonori sintetizzati con Web Audio (passo, tick negli ultimi 10 s, partenza, vittoria, sconfitta), attivati al primo tasto o clic.
- `js/main.js`: livelli in `LEVELS` (`easy` 10, `medium` 15, `hard` 20 anelli; stesso `TIME_LIMIT` per tutti, il labirinto riempie sempre lo spazio disponibile, quindi a livello più alto corrispondono celle più piccole). Ultimo livello scelto e miglior tempo per livello in localStorage (`oppd2026.day4.level`, `oppd2026.day4.best.<livello>`). Stati (`menu` → `reveal` → `play` → `escaping` → `win`, oppure `lose` a tempo scaduto), rendering e input. Grafica alla Escher su due canvas fuori schermo ridisegnati solo a ogni labirinto/resize: lo sfondo è volutamente quieto per non distrarre: carta grigio chiaro con una grana leggera, pochi cerchi concentrici molto tenui attorno al disco che svaniscono con la distanza e una vignettatura morbida; il labirinto è un disco chiaro con ombra, una scacchiera polare in cui una cella su due è tratteggiata come un'incisione, e muri in rilievo (ombra portata, lato estruso grigio, faccia superiore color inchiostro). Il disco si scopre con un cerchio che si allarga in `REVEAL_TIME`, poi parte il timer di `TIME_LIMIT` 60 s. Partenza disegnata come un piccolo cubo isometrico, uscita come una freccia rossa oltre il varco, giocatore come una sfera riflettente con ombra di contatto, scia rossa. Tastiera: la direzione (frecce/WASD, anche combinate in diagonale) sceglie il passaggio aperto il cui centro sullo schermo è più allineato (prodotto scalare ≥ `MIN_DOT`), con ripetizione dopo `REPEAT_DELAY` ogni `REPEAT_RATE`. Mouse/tocco: si trascina la sfera, che cammina lungo i passaggi verso la cella sotto il puntatore (`cellAt`) un passo ogni `FOLLOW_RATE` e si ferma lì, ma solo se la cella è al massimo `MAX_REACH` celle di percorso (così non attraversa i muri e non risolve il labirinto da sola). Negli ultimi `ALARM_TIME` 10 s (timer rosso, tick ogni secondo) il labirinto pulsa di rosso in modo discreto (`drawAlarm`): velatura rossa in `multiply` sul disco, più forte verso il bordo (così l'inchiostro resta nero), più un alone appena fuori; ogni battito parte con il tick e sfuma entro il secondo, ed è un po' più intenso man mano che il tempo finisce. Dalla cella d'uscita si esce verso l'esterno (pseudo-cella `OUTSIDE`) e si vince. La scia è il percorso dal centro (essendo un albero, tornare indietro toglie l'ultima cella); a tempo scaduto il riquadro mostra “You didn't exit the labyrinth” con sotto “You lose, draw another one.” e la percentuale del percorso corretto coperta (“You covered N% of the right path.”: `progress()` è il prefisso comune fra la scia attuale e la soluzione, cioè quanto del percorso giusto copre la posizione allo scadere del tempo, coerente con quello che si vede (scia rossa sopra la soluzione tratteggiata): un tratto giusto esplorato e poi abbandonato non conta; diviso per i passi totali, centro → cella d'uscita più il passo fuori dal varco), e compare la soluzione tratteggiata. Il riquadro di fine partita non copre mai il labirinto: `placeMessage` lo mette a destra del disco se lo spazio libero è almeno `MSG_SIDE` px, altrimenti sotto; se nemmeno sotto c'è posto (finestre quasi quadrate), `resize` rimpicciolisce il labirinto per fargli spazio, e il labirinto torna a piena dimensione con la partita successiva.

## Comandi

- Avvio: aprire `index.html` nel browser (anche da `file://`) oppure `http://localhost/oppd2026/day4/` con XAMPP.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- Il layout misura l'altezza di intestazione e piè di pagina (`resize`): `#timer` e `#record` hanno `min-height` perché possono essere vuoti (menu, nessun record), altrimenti all'avvio della partita il labirinto finisce sotto il timer. Il raggio lascia 1,3 anelli di margine per la freccia d'uscita.
- Tasti: frecce/WASD per muoversi (oppure trascinare la sfera con il mouse o il dito), `Enter`/`N` nuovo labirinto, `Esc` torna alla scelta del livello, `M` audio on/off. Nel menu: `1`/`2`/`3` scelgono il livello, `Enter` riprende l'ultimo (evidenziato in rosso).
- Per vedere un fotogramma preciso in headless (es. il picco del battito rosso) si può bloccare l'orologio della pagina sovrascrivendo `performance.now` via `Runtime.evaluate`: gli screenshot sono troppo lenti per cogliere animazioni brevi.
- Cheat: `Shift+S` mostra/nasconde la soluzione; `Shift+T` porta il tempo rimasto a 5 s (per vedere la sconfitta).
- Generatore: `js/maze.js` si può caricare in Node con `vm` (`Maze.generate(15, 24)`) e verificare che sia un albero (`total - 1` passaggi, tutte le celle raggiungibili) con l'uscita sull'anello esterno.
- Verifica visiva con Chrome headless pilotato via DevTools Protocol (WebSocket di Node, script fuori dal repo): `--virtual-time-budget` non fa avanzare `requestAnimationFrame`, quindi usare il tempo reale; la larghezza minima della finestra headless è ~500 px, per il formato telefono usare `Emulation.setDeviceMetricsOverride`.
