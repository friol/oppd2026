# CLAUDE.md — day25

Questa cartella contiene il programma day25 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day24`, `day25`, ...) e deve restare autonomo.

## Obiettivo del programma

**Déjà Vu**: gioco del memory ambientato nel saloon del day24.

- **Partita**: le carte (coppie di simboli) vengono distribuite volando dal punto del banco sopra il tavolo (`.deck` → posizione nella griglia), poi si scoprono tutte con un'onda diagonale e restano scoperte per il tempo di memorizzazione (barra "Memorize! N" in basso, con tic sempre più acuti negli ultimi 3 s); poi si coprono con un'altra onda e il giocatore le gira due alla volta. Coppia giusta: le carte restano scoperte con bordo dorato, bagliore e scintille, "+punti" che sale; coppia sbagliata: bordo rosso, scossone delle carte e del tavolo, poi si ricoprono dopo ~1 s.
- **Errori**: ogni livello ha un numero di errori consentiti (`chances`), mostrati nel HUD come proiettili (pieni = errori ancora disponibili). Si possono fare esattamente `chances` errori: quello successivo fa perdere ("Out of chances!"), e le carte non trovate si scoprono in grigio.
- **Livelli** (`LEVELS` in `game.js`): Easy 4×4 (8 coppie, 3 errori, 5 s), Medium 5×4 (10 coppie, 5 errori, 7 s), Hard 6×5 (15 coppie, 7 errori, 10 s), Pro 6×6 (18 coppie, 9 errori, 13 s). La scelta è in `localStorage` (`day25.level`).
- **Abbandonare una partita** (`quit`, `askQuit` in `game.js`): durante la partita (distribuzione, memorizzazione o gioco) nella colonna destra compare "Quit game" (anche tasto Esc); cliccare un altro tavolo durante la partita fa la stessa cosa e poi passa a quel tavolo. Se le carte sono già coperte chiede conferma ("Leave this game?", Esc o click fuori per restare) e la partita conta come giocata e persa, come un "Redeal"; prima no. Si torna al tavolo scelto con le carte coperte. Il pannello di fine partita ha "Play again", i quattro tavoli (un click distribuisce subito su quel tavolo) e "Back to the saloon".
- **Punteggio**: 100 per coppia + 50 per ogni coppia consecutiva della serie; a fine tavolo bonus di 150 per errore non usato, bonus tempo (`(coppie × 6 − secondi) × 10`, se positivo) e +500 per una partita perfetta. Miglior punteggio per tavolo in `day25.best`, i 5 migliori in `day25.records`, partite vinte/giocate in `day25.stats` (un "Redeal" a partita in corso conta come persa).
- **Simboli** (`js/symbols.js`, `SYMBOLS`): 18 SVG inline con forme e colori distinti (stella, onde, luna, sole, cuore, quadri, picche, fiori, ferro di cavallo, cactus, stella da sceriffo, stivale, cappello, bottiglia, fulmine, ancora, campana, chiave); ogni partita ne pesca a caso quanti servono.
- **Ambientazione** (riusata dal day24): parete di assi, lampada che oscilla con cono di luce e polvere (`DEALER`, canvas `.dust`), banco "Lucky Lou" con ritratto e fumetto (`DEALER.say(tipo, probabilità)`, battute in `LINES`), e nei margini (solo con finestra ≥ 1000×520) avventori che reagiscono (`SCENE.react(tipo, forza, quiet)`: con `quiet` si muovono senza suoni, usato per le singole coppie), pianista che segue il ritmo della musica, gatto che passeggia sul bancone, porte a battente, manifesti "WANTED" con i migliori punteggi e "HALL OF FAME" con i tavoli vinti (`SCENE.hooks.records` / `hooks.stats`). Vittoria: applausi registrati, onda di salti delle carte, pioggia di monete; sconfitta: fischi.
- **Layout a schermata singola**: niente scroll; titolo e HUD in alto, sotto `.mid` a tre colonne: a sinistra la scelta del tavolo (pulsanti in verticale) e la legenda dei tasti, al centro il tavolo (tutta l'altezza libera), a destra Deal e i pulsanti Music/Sound. Sotto i 760 px di larghezza i controlli tornano in righe sotto il tavolo. La scena del saloon usa i margini attorno a `.mid` (`SCENE.init($('mid'))`); `measure()` dimensiona le carte (`--cw`, `--ch`, `--gap` sulla griglia) per farle stare tutte nel tavolo, lasciando spazio in basso per messaggi/barra. Il banco non copre mai le carte: se a sinistra della griglia restano ≥ 150 px di feltro, il fumetto va sotto il ritratto in quella colonna (classe `.dealer.stack`, larghezza `--bw`); altrimenti il fumetto sta accanto al ritratto e la griglia parte sotto una striscia riservata a entrambi.
- **Animazioni delle carte**: `.card` (posizione e volo dalla pila, transizione su `transform`) > `.inner` (rotazione 3D `rotateY`, 0,52 s) con facce `.front` / `.back` (`backface-visibility: hidden`); durante la girata la carta "salta" e si inclina (classe `flipping`, animazione `cardHop` su `scale`/`translate`/`rotate`, proprietà indipendenti dal `transform`), l'ombra si allunga e un riflesso di luce la attraversa (`.face::after`, `glint`). Queste animazioni non vanno disattivate con `prefers-reduced-motion`: sul PC dell'utente le animazioni di Windows sono spente, quindi il browser segnala "reduce" e le carte si girerebbero di colpo. Le animazioni `pairPop`, `wrong`, `hooray` usano anch'esse `scale`/`translate`/`rotate`.
- **Suoni** (`js/sound.js`, dal day24): sintetizzati con Web Audio, più `match(serie)` (rintocco che sale con la serie) e `tock(urgente)` per il conto alla rovescia; registrazioni in `soundfx/` (`cheers.wav`, `boo.wav`, `cat.ogg`). Musica `muzik/western in 2026.mp3` (`js/music.js`, `day25.music`); muto in `day25.mute`.

## Stack e struttura

HTML, JavaScript e CSS puri, script classici (non moduli): deve funzionare anche da `file://`. Nessuna risorsa esterna.
Per tutti i file, usare sempre la sottocartella relativa al giorno corrente.

- `index.html`, `style.css`, `favicon.svg`
- `js/game.js`: stato, griglia, flusso della partita, punteggio, controlli. `window.GAME` espone agganci per i test (`state`, `LEVELS`, `deal`, `turn(card)`, `setLevel(i)`, `cards`).
- `js/symbols.js`: simboli delle carte; `js/dealer.js`: banco, lampada e polvere; `js/scene.js`: sfondo del saloon (adattato dal day24, senza sceriffo); `js/beats.js` (generato) e `tools/beats.py`: griglia dei battiti del brano per il pianista (~109 BPM, 349 battiti; per rigenerarla `python tools/beats.py [file.mp3]`, richiede numpy, scipy, soundfile).
- `js/sound.js`, `js/music.js`. Ordine degli script: sound, music, symbols, beats, scene, dealer, game.
- `tools/shot.js`: screenshot con Chrome headless.

## Comandi

- Avvio: aprire `index.html` nel browser (o `http://localhost/oppd2026/day25/` con XAMPP).
- Tasti: Spazio/Invio = distribuisci (o gira la carta selezionata), frecce = muovi la selezione sulla griglia, M = effetti sonori, N = musica, Esc = abbandona la partita (o chiude i pannelli).

## Testing

- `node tools/shot.js out.png [secondi] [js da valutare] [w] [h]` (`@file.js` per leggere il codice da un file): Chrome headless, stampa console ed errori e salva uno screenshot. Esempio: `GAME.setLevel(3); GAME.deal()`; per giocare: aspettare `GAME.state.phase === 'play'` e chiamare `GAME.turn(GAME.cards[i])`.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
