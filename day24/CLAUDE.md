# CLAUDE.md — day24

Questa cartella contiene il programma day24 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day23`, `day24`, ...) e deve restare autonomo.

## Obiettivo del programma

**Find the Joker**: gioco delle 3 carte (three-card monte).

- All'inizio di ogni round le 3 carte (K♠, Joker, Q♥) sono scoperte con il **Joker al centro** (`regroup`), poi vengono coperte e il computer le mescola (`shuffle`); alla fine il giocatore clicca la carta (o tasti 1/2/3) dove crede sia il Joker. Si scoprono la carta scelta, poi il Joker, poi le altre.
- **Budget**: 100 $ iniziali, puntata con le fiches (5, 10, 25, 50, All in; mai oltre il bank). Vincita = puntata × `payout` del livello (Easy 1:1, Medium 2:1, Hard 3:1), sconfitta = −puntata. Si gioca a oltranza; a 0 $ compare "Busted!" con le statistiche e "Play again". Il bank migliore è salvato in `localStorage` (`day24.best`), come il livello (`day24.level`) e il muto (`day24.mute`).
- **Velocità crescente**: `speedFactor()` = max(0,5; 0,955^round) riduce la durata dei movimenti a ogni round giocato (mostrata nel HUD come "Speed ×"); in ogni round i movimenti accelerano ancora fino al 45% e il numero di movimenti cresce di 1 ogni 2 round fino al massimo del livello.
- **Livelli** (`LEVELS`): numero di movimenti, durata base e minima, pausa tra movimenti, variazione casuale del ritmo (`jitter`) e pesi dei tipi di movimento (`moveSet`). Easy: solo scambi; Medium: + finte, rotazioni, incroci; Hard: tutti, senza pause.
- **Movimenti** (`MOVES`, ognuno anima le carte e aggiorna gli slot): `swapAdj`/`swapFar` (scambio, una carta passa sopra l'altra ad arco), `feint` (le due carte partono per scambiarsi, quasi si toccano e tornano indietro; mai due di fila né come ultimo movimento), `rotate` (tutte e tre ruotano di uno slot, quella che "fa il giro" passa alta sopra o bassa sotto), `cross` (scambio quasi senza arco: si attraversano), `stack` (due vicine si sovrappongono, ondeggiano insieme e si separano, scambiate nel 60% dei casi), `double` (due scambi consecutivi rapidi). I movimenti restano **seguibili**: quando due carte si sovrappongono, una è sempre chiaramente sopra (più alta, più grande, ombra più lunga tramite `--lift`).
- **Il banco** (`js/dealer.js`, `DEALER`): "Lucky Lou", imbonitore da saloon. Due **mani** in SVG (polsino, manica della giacca che esce dal bordo superiore; la destra è la copia specchiata) afferrano le carte mosse (`DEALER.hold([...])`, chiamato da ogni mossa; nella rotazione prendono la carta che fa il giro e una vicina) e le seguono a ogni fotogramma con smorzamento, inclinando il braccio verso la spalla; a riposo spuntano dal bordo alto e "respirano". **Ritratto** (bombetta e baffi) in alto a sinistra con **fumetto** (`DEALER.say(tipo, probabilità)`, battute in `LINES`: saluto, distribuzione, provocazioni durante la mescolata, scelta, vittoria/serie di 3+, sconfitta, puntata grossa, bancarotta, cash out, sblocco, cambio livello), accompagnato da un borbottio sintetizzato (`SOUND.mumble`). **Trucco** (solo Hard, dal 3° round, 30% dei round): una moneta d'oro rotola sul feltro con un tintinnio (`DEALER.distract`) mentre il banco fa uno scambio rapido e silenzioso quasi senza arco; resta visibile a chi non si distrae.
- **Obiettivi e ambientazione** (`js/saloon.js`, `SALOON`): 6 **tavoli** (`THEMES`: feltro, bordo, dorso delle carte tramite variabili CSS `--felt`, `--rail`, `--back-a/b`, `--back-line`) sbloccati dal miglior bank di sempre ($0, 250, 500, 1000, 2500, 5000), con avviso (`toast`), fanfara e battuta del banco al momento dello sblocco; si scelgono nel pannello "Tables & records". **Classifica locale** dei 5 migliori run (picco, finale, round, livello, data) in `localStorage` (`day24.records`); un run finisce alla bancarotta o con **Cash out** (attivo tra un round e l'altro), poi riparte da $100. **Ambiente**: parete di assi di legno, lampada di ottone che oscilla in cima al tavolo (`--lx` sposta la pozza di luce `.table::after`, `--shx` inclina le ombre delle carte), canvas `.dust` con cono di luce e granelli di polvere che brillano dentro il cono. Altre chiavi salvate: `day24.theme`, `day24.unlocked`.
- **Sfondo vivo** (`js/scene.js`, `SCENE`): livello fisso dietro l'app (`.scene`, z-index 0) che vive nei margini ai lati del tavolo; `layout()` misura il tavolo e mostra solo gli avventori che ci stanno (fino a 4 per lato; la scena è nascosta sotto i 1000 px di larghezza o 520 px di altezza). Il bancone (`--bar` = 63vh) sta dietro al tavolo, quindi si vede solo ai lati.
  - **Avventori**: silhouette SVG scure con bordo caldo dalla lampada (cappello da cowboy, bombetta, a testa nuda, a cilindro, con piuma), ognuno con un leggero ondeggiare e un braccio con boccale di birra che si alza (`.up`). `SCENE.react(tipo, forza)` li fa reagire in ordine sparso con una parola sopra la testa: `gasp` ("Ooh!", alla scelta della carta), `cheer` (applauso e boccali alzati se vinci; forza 2 con serie di 3+ o puntata ≥ 50), `laugh` (risate se perdi), `hush` (si abbassano alla bancarotta). Ogni tanto uno sorseggia da solo.
  - **Porte a battente** (`SCENE.swing()`, solo se il margine destro ≥ 120 px): due ante con rotazione 3D smorzata davanti a una striscia di luce calda; oscillano ogni 28-65 s, con cigolio, e quando il giocatore va in bancarotta (esce dal saloon).
  - **Gatto**: ogni 22-50 s (la prima volta dopo 9 s) attraversa il bancone a 95 px/s (zampe e coda animate; dietro il tavolo sparisce e riappare dall'altra parte). Nel primo margine che incontra a volte si ferma 2,6 s e miagola. Un click sul gatto lo fa saltare e miagolare. **Miagolii** con `soundfx/cat.ogg` (~1 s, via `<audio>` come `cheers.wav`, intonazione casuale ±10% con `playbackRate`; `SOUND.meow()`, con ripiego sul miagolio sintetizzato `meowSynth`): uno appena il gatto entra in vista, poi ogni 3,5-7 s finché è visibile nei margini (non mentre è dietro il tavolo), uno quando si ferma e uno al click; `catMeow` in `scene.js` impone almeno 2 s tra due miagolii.
  - **Il banco che aspetta** (`DEALER.fidget(tipo, 'wait'|'idle')`, richiamato da `armFidget` in `game.js` ogni 5,5-9 s mentre il giocatore deve scegliere o prima di una nuova mano): `drum` (la mano destra scende sul feltro e tamburella con 5 tocchi), `beckon` (la sinistra fa cenno di "avanti"), `tip` (si toglie il cappello, sotto si vedono i capelli), con una battuta (`LINES.wait`/`idle`). Il ritratto ammicca (animazione `blink`).
  - Suoni nuovi in `sound.js`: `applause`, `ooh(giù)`, `laugh`, `meow`, `creak`.
  - **Campione registrato**: quando il giocatore trova il Joker (`SCENE.react('cheer')`) suona `soundfx/cheers.wav` (~4,9 s, stereo 44,1 kHz) con `SOUND.cheers()`, tramite un elemento `<audio>` (il decoder di Web Audio non può leggere file locali da `file://`), volume 0,8. Rispetta il muto (tasto M) e, se parte un nuovo round, sfuma in ~0,4 s (`SOUND.stopCheers()` in `deal`). Se il browser non lo riproduce ripiega sull'applauso sintetizzato.
- **Layout a schermata singola**: niente scroll (`overflow: hidden`, `.app` alta `100dvh`); il tavolo prende tutto lo spazio verticale libero (`flex: 1`) e `measure()` dimensiona le carte (`--cw`/`--ch` sul tavolo) in base al tavolo: 3,8 larghezze di carta in orizzontale e 2,5 altezze in verticale, così anche gli archi più alti restano dentro. Su schermi stretti o bassi si nascondono sottotitolo e legenda dei tasti.
- **Rendering**: carte DOM (`.card` > `.inner` con faccia `.front` e `.back`), posizione in unità di slot (x −1..1, y in altezze di carta) convertita in px in `render`; il ribaltamento è una transizione CSS `rotateY` sull'`.inner` (classe `down`). Facce disegnate in HTML/CSS, cappello da giullare del Joker in SVG inline.
- **Suoni** (`js/sound.js`, `SOUND`): tutti sintetizzati con Web Audio (rumore filtrato e oscillatori): carta girata, fruscio dello scivolamento (per ogni movimento, più forte per quelli lunghi), tocco sul feltro, fiches, vittoria (arpeggio), sconfitta, fine partita. Partono dopo il primo gesto dell'utente; tasto M o pulsante "Sound" per il muto.
- **Colonna sonora** (`js/music.js`, `MUSIC`): `muzik/saloon stomp.mp3` in loop con un elemento `<audio>` (funziona da `file://`), volume 0,3 con dissolvenze di 1,2 s (in pausa quando è a zero). Parte al primo click o tasto (autoplay dei browser); si accende e spegne con il pulsante "Music" nel piè di pagina o il tasto N, indipendentemente dagli effetti; la scelta è in `localStorage` (`day24.music`). `MUSIC.audio` per i test.

## Stack e struttura

HTML, JavaScript e CSS puri, script classici (non moduli): deve funzionare anche da `file://`. Nessuna risorsa esterna.
Per tutti i file, usare sempre la sottocartella relativa al giorno corrente.

- `index.html`, `style.css`, `favicon.svg`
- `js/game.js`: stato, carte, movimenti, flusso del round, controlli. `window.GAME` espone agganci per i test (`state`, `cards`, `deal`, `pick`, `cardAt`, `MOVES`, `joker`).
- `js/sound.js`: effetti sonori; `js/music.js`: colonna sonora.
- `js/dealer.js`: il banco (mani, ritratto, fumetto, trucco); `js/saloon.js`: tavoli, record, ambiente. `js/scene.js`: avventori, gatto e porte. Ordine degli script: sound, music, saloon, scene, dealer, game.
- `muzik/`: il brano di sottofondo; `soundfx/`: effetti registrati (`cheers.wav`, `cat.ogg`).
- `tools/shot.js`: screenshot con Chrome headless (copiato dal day23).

## Comandi

- Avvio: aprire `index.html` nel browser (o `http://localhost/oppd2026/day24/` con XAMPP).
- Tasti: Spazio/Invio = distribuisci, 1/2/3 = scegli carta, M = effetti sonori, N = musica.

## Testing

- `node tools/shot.js out.png [secondi] [js da valutare] [w] [h]` (`@file.js` per leggere il codice da un file): Chrome headless, stampa console ed errori e salva uno screenshot. Esempio: `GAME.MOVES.stack(400)` o `GAME.deal()`.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
