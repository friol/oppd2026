# CLAUDE.md — day17

Questa cartella contiene il programma day17 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day16`, `day17`, ...) e deve restare autonomo.

## Obiettivo del programma

**Pretty Normal Text Adventure**: avventura testuale in stile retro-terminale (verde fosforo, monospazio, cursore lampeggiante, scanline) con 52 location, ognuna disegnata in ASCII nella parte alta dello schermo. Il protagonista è un uomo qualunque in una città anonima: niente mostri, solo pericoli normali (traffico di Main Avenue, rapinatore col coltellino in Rook Alley di notte, ladro d'appartamento, mattoni che cadono nel cantiere, truffa della champagne/escort nel VIP del Club Velvet).

Trama: la settimana va da lunedì 7:00 a sabato sera. Sabato alle 20:00 è il terzo anniversario con Laura e il protagonista vuole chiederle di sposarlo da Luigi's Trattoria. Obiettivo finale: arrivare a sabato con l'anello ($1.250, comprabile solo dopo lo stipendio di venerdì alle 17), il lavoro (umore del capo > 0), l'affitto pagato ($600 in contanti a Kowalski entro sabato a mezzogiorno, ATM max $500 al giorno) e Laura ancora innamorata (amore >= 60), poi PROPOSE al ristorante.

Il punteggio si fa con le buone azioni (`DEEDS` in `world.js`, 380 punti, compresi 15 per aver vinto Zormak al PC, 10 per aver sbloccato la fotocopiatrice dell'ufficio, 5 al giorno (fino a 5) per il caffè portato al capo, 5 al giorno (fino a 6) per aver dato da mangiare al gatto, 15 per gli auguri alla mamma e 10 per la presentazione del venerdì) più i bonus del finale (proposta accettata 40, abito indossato 10, bollette pagate in tempo 10): massimo 440 (`MAX_SCORE` è calcolato).

NPC che girano per la città (`js/npcs.js`), ognuno con la sua caratteristica:
- **Rocco** il barbone col carrello (piazza/viale/parco, 8-21): colleziona cianfrusaglie e vuole un ombrello; dandogli l'ombrello (+10) regala il "lucky cap", e con quello il rapinatore di Rook Alley (suo nipote) ti lascia andare.
- **Lo sconosciuto del 2C**, il vicino che nessuno conosce (palazzo/centro, 8-20): non parla mai; salutandolo in 3 giorni diversi finalmente dice una frase inquietante (+5).
- **Sandra** la jogger (parco, 6:30-8:30 e 18-20): si può correre con lei solo con fitness >= 1, una volta al giorno, e dà consigli utili.
- **Mrs. Ferretti** la pettegola col chihuahua Pippo (Elm/Maple/Rose, 9-12:30 e 15-19): racconta pettegolezzi che sono indizi; se la tratti bene Laura +3, se la insulti Laura -10.
- **Hans** il turista sperduto (centro, 10-18): HELP TOURIST (+10), poi sparisce.
- **Vince** il borseggiatore (piazza/Commerce/centro commerciale, 11-20): un turno di avviso, poi ruba fino a $50; CATCH/GRAB/SHOUT lo fa arrestare (+10) e restituisce i soldi.
- **Mortimer**, il gatto del protagonista (grasso e grigio), gira per le stanze di casa (camera, bagno, soggiorno, cucina; entry `mortimer` in `NPCS`, compare anche sulla mappa con la lettera M). Va nutrito ogni giorno (FEED CAT, in cucina o dove si trova; `feedCat()` in `npcs.js`) con la scatola di croccantini (`catfood`, 1 kg; quella iniziale in cucina ha 2 porzioni, al supermercato una nuova costa $9 e ne dà 7; porzioni in `S.f.catPortions`, giorni nutriti in `S.f.catfed<giorno>`): +5 punti al giorno. Se è nutrito e la sveglia non suona (spenta o luce tagliata) ti sveglia lui alle 7:30 invece delle 9:40. Se non è nutrito, alle 4 di notte (`catRevenge`) nasconde un tuo oggetto (anello, badge, chiavi, portafoglio, telefono, scontrino, vestiti da palestra, biglietto: tra quelli in casa o addosso se sei in casa) sotto il divano o il letto; al risveglio un messaggio lo segnala, HINT dice dove, EXAMINE/LOOK UNDER SOFA o BED lo ritrova (`catFind`). Un solo oggetto nascosto per volta. `ignore` evita che "cat food" venga preso per il gatto.
- **Dino** il fattorino della pizza in scooter (strade, 11-14 e 18-23): pericolo di colore; la prima volta perde una pizza (utile per Sam).

Peso: 6 kg tra mani e tasche, 20 kg con lo zaino; ogni oggetto ha un peso realistico (scala 9 kg, spesa della signora Pinto 8 kg, borse di Laura 6 kg, manubrio 10 kg...).

Tutti i testi del gioco e i commenti nel codice sono in inglese.

## Stack e struttura

HTML, JavaScript e CSS puri, script classici (no moduli), nessuna dipendenza.
Non usare mai la rete o motori LLM o AI per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente.

- `index.html`, `style.css`: schermata del titolo (`img/title.png`, immagine fornita dall'utente, PNG con trasparenza) e terminale (arte ASCII + barra di stato in alto, output a macchina da scrivere, riga di comando con un `<input>` invisibile e un cursore finto).
- `js/art.js` (`ART`): un disegno ASCII per location, massimo 64x11; `@@:@@` viene sostituito con l'ora di gioco (sveglia in camera).
- `js/world.js`: `DEEDS`, costanti economiche, `P` (orari delle persone), `I` (oggetti: peso, posizione iniziale, `hidden()`, `value` per il banco dei pegni, `wear`, `read`, `eat`) e `L` (location: `desc`, `exits`, `things` per EXAMINE, `people`, `closed()` per gli orari, `shop`, `enter()` e `act(c)` per i comandi specifici; `act` riceve `{v, n, n2, all}` e restituisce true se ha gestito il comando).
- `js/engine.js`: stato `S` (solo dati JSON, salvabile e annullabile), tempo a minuti con eventi (`minuteEvent`: valutazione del lavoro alle 17, stipendio venerdì, tagli di luce/gas, sfratto, SMS di Laura, svenimento all'1:00, ladro mercoledì 22:40, arrivo di Laura e fine sabato), parser (`VERBS`, sinonimi, preposizioni), verbi generici, semaforo del passaggio pedonale (`updateLight`), sonno, ATM, telefono, finale. Nessun accesso al DOM: l'output passa da `OUT(text, cls)` e `RENDER()`.
- Mappa (comando MAP o M, non fa passare il tempo): `MAP` in fondo a `world.js` dà a ogni location una cella `[colonna, riga, etichetta]` di una griglia schematica; `buildMap()` in `engine.js` disegna le location in `S.visited` (aggiornato da `moveTo`), come `[?]` quelle raggiungibili da un luogo visitato ma mai visitate, e i collegamenti fra loro (linee dritte o diagonali, `+` agli incroci; `MAP_SKIP` esclude l'attraversamento fuori dalle strisce), ritagliata al rettangolo che le contiene. Sotto ogni riquadro esplorato compaiono in giallo le lettere degli NPC presenti in quel momento (`letter`/`short` in `NPCS`), con una legenda in fondo. Restituisce `marks` (`here`, `unk`, `npc`) che `SHOWMAP` in `ui.js` colora; la mappa è a tutto schermo (font adattato alla finestra), qualsiasi tasto o tocco la chiude.
- Disegni notturni (`nightArt` in `ui.js`, location all'aperto in `OUTDOOR`, dalle 20 alle 6): ricavati dal disegno diurno con un hash fisso (le stelle non saltano): stelle nel cielo libero (celle vuote senza niente sopra, alcune che brillano), luna nel primo spazio libero 5x3 (o al posto del sole, `NIGHT_FIX` per lo stagno), finestre `[]` accese come `##` ambra (circa 2 su 3, solo nelle prime 7 righe perché sotto ci sono le auto), insegne `OPEN` -> `SHUT`. Se si aggiunge una location o si cambia un'uscita, aggiornare `MAP`: le uscite cardinali devono puntare nella direzione giusta sulla griglia.
- `js/npcs.js` (caricato dopo `world.js`): `NPCS` con `route`, `step` (minuti per tappa), `hours` (fasce attive), `gone()`, testi `here`/`arrive`/`leave`/`desc` e `act(c)`. La posizione è calcolata dall'ora (`npcWhere`: `route[floor(t / step) % length]`), quindi non sta nello stato. In `exec` i comandi rivolti a un NPC presente (`npcAct`, per parole in `words`) hanno la precedenza sulla location; dopo ogni comando `npcTurn` stampa arrivi e partenze e gestisce Vince e Dino; `describe` aggiunge la frase `here` di chi è presente. Attenzione: il parser toglie le preposizioni ("in", "to"...), quindi le `words` non devono contenerle.
- Schermata del titolo: al clic (o a un tasto) il logo "si scioglie" verso il basso (`meltLogo` in `ui.js`): viene copiato a piena risoluzione (pixel dello schermo, `devicePixelRatio`) su un canvas `.melt` sopra l'immagine, quindi resta identico all'originale finché non inizia a cadere; poi è diviso in strisce verticali di circa 4 px (`SW`) che, come il melt di Doom, aspettano un ritardo (0-0,5 s) e cadono con gravità (fisica in secondi e in frazioni dell'altezza del logo, `GRAV` = 90 centesimi d'altezza/s², circa 2 s in tutto); ritardi e velocità variano dolcemente fra strisce vicine (bordo a onda morbida), strisce e gocce sfumano mentre cadono, qualche goccia rotonda cade dal fondo (colore dell'ultimo pixel pieno della striscia; da `file://` `getImageData` è bloccato e le gocce sono verdi). Poi parte la partita (`begin`); un timer di sicurezza a 7 s la avvia comunque se `requestAnimationFrame` non arriva. Il controllo `prefers-reduced-motion` è stato tolto apposta: su questo PC le animazioni di Windows risultano disattivate e l'effetto non si sarebbe mai visto. Per fotografarlo in Chrome headless serve sostituire `requestAnimationFrame` con un passo manuale (il tempo virtuale non genera frame).
- `js/ui.js`: titolo, effetto macchina da scrivere (Invio o Esc mostra tutto subito), cronologia comandi con le frecce, disegno e barra di stato.

## Comandi

- Avvio: aprire `index.html` nel browser (anche da `file://`) oppure `http://localhost/oppd2026/day17/` con XAMPP.
- Nel gioco: HELP (comandi), MAP (mappa delle location esplorate), HINT (suggerimenti), SCORE, SAVE/LOAD (localStorage `pnta17:save`), UNDO (fino a 50 mosse), RESTART. Nel titolo, L carica la partita salvata.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- Computer di casa (`js/minigame.js`): nel soggiorno c'è un vecchio PC (EXAMINE COMPUTER, PLAY / USE COMPUTER; non funziona con la luce tagliata) con l'avventura testuale fantasy "The Curse of Zormak": 7 stanze (`MINI_ROOMS`: piazza col pozzo e il saggio, taverna, bosco, grotta buia, ponte del troll, cancello, sala del trono), moneta nel pozzo -> lanterna in taverna -> spada nella grotta (serve la luce) -> indovinello del troll (PIANO/KEYBOARD) -> FIGHT DRAGON con la spada; punteggio interno su 100, morte e RESTART propri. Stato in `S.mini` (progresso, resta se si spegne e si riaccende) e `S.pc` (computer acceso): mentre è acceso `exec` passa tutto a `miniCommand` tranne SAVE/LOAD/UNDO/MUSIC; QUIT/EXIT/TURN OFF torna al soggiorno. Ogni comando sul PC costa 2 minuti di gioco (ogni 30 minuti un avviso con l'ora), quindi si può fare tardi. Il pannello in alto mostra `miniArt()`: la stanza dentro una cornice di monitor; i testi del PC usano la classe `pc` (azzurro). Vincere imposta `S.f.zormakWon` e dà la buona azione `zormak` (+15 punti nel gioco vero, una sola volta).
- Eventi della settimana ed extra di fine partita (`js/week.js`, caricato prima di `engine.js`; agganci: `weekEvent` in `minuteEvent`, `weekAct` in `exec`, `partyKeepsAwake` in `goToSleep`, `atmCardTrouble` in ATM, `trafficFine` in `crossAvenue` e alla fermata del bus, `meetingAnswer` instradato da `exec` quando `S.enc === 'meeting'`):
  - **Multe**: la prima volta che si attraversa col rosso o fuori dalle strisce un vigile ti salva e ti multa di $50 (`S.f.redWarned`, `S.f.fined`); la seconda volta si muore.
  - **Compleanno della mamma** (giovedì, scritto sul calendario della cucina; SMS del papà alle 8): CALL MOM quel giorno (8-22) dà +15 (`birthday`, più `mom` se mancava); se alle 22 non hai chiamato SMS di rimprovero e Laura -5.
  - **Festa dei vicini in 2B** (martedì 22 - mercoledì 2): alle 23:15 ti sveglia se dormi a casa senza tappi; non si può dormire finché c'è; COMPLAIN la ferma, JOIN (o PARTY) ti fa ballare fino alle 2 (Ferretti lo racconta a Laura, -5), i tappi (`earplugs`, $2 al supermercato) ti fanno dormire.
  - **Il bancomat mangia la carta**: il primo uso dell'ATM da martedì in poi la trattiene (`S.f.cardGone`): niente prelievi né pagamenti con carta (dal gioielliere solo contanti) finché non la si chiede al banco della banca (giorni feriali 8:30-16, 25 minuti).
  - **Presentazione del venerdì** alle 10:30: WORK al mattino si ferma e il capo fa una domanda a scelta A-D (`MEETING_Q`): C (risposta seria con un piano) = capo +10, +10 punti e $150 di bonus sullo stipendio; B = +5; A = niente; D (dare la colpa a Ben) = -10. Se alle 11 non l'hai fatta: e-mail e capo -10.
  - **Diario**: DIARY racconta la giornata in prima persona (`diary()` registra buone azioni ed eventi: multa, rapina, carta, festa, compleanno, presentazione, gatto, ritardi, anello, affitto, escort, Zormak); DIARY WEEK tutta la settimana, mostrata anche a fine partita.
  - **Obiettivi segreti** (`ACHIEVEMENTS`): 13, mostrati solo a fine partita (sbloccati col nome, gli altri come ???): mai in ritardo, Zormak in orario d'ufficio, gatto mai vendicativo, cittadino modello, multato e sopravvissuto, re della festa, figlio modello, carta recuperata, presentazione perfetta, Vince arrestato, palestra 3 volte, tutte le buone azioni, meno di 50 punti.
- Musica: `muzic/searching.in.the.dark.mp3` in loop (`track` in `ui.js`, volume 0,45 con dissolvenza in entrata/uscita), parte quando si inizia la partita dal titolo (serve un gesto dell'utente; se il browser la blocca riprova al primo tasto o tocco) e continua anche quando si cambia scheda o programma. Si spegne/accende col comando MUSIC (MUSIC ON / MUSIC OFF / MUTE / UNMUTE, non fa passare il tempo) o col pulsante a destra nella barra di stato; la scelta resta nel browser (`localStorage` `pnta17:music`).
- Sveglia: in camera TURN OFF ALARM / SET ALARM (`S.f.alarmOff`, resta spenta finché non la si riaccende). Con la sveglia spenta (o con la luce tagliata) `goToSleep` sveglia alle 9:40: nei giorni feriali si arriva tardi e scatta la penalità per il ritardo del capo; il sabato è solo una dormita lunga. HINT lo ricorda.
- Il motore gira anche in Node: concatenare `art.js`, `world.js`, `npcs.js`, `engine.js` in un contesto `vm`, sostituire `OUT` con un log, chiamare `S = newState(); newGame();` e poi `exec(cmd)` per ogni comando. Una partita completa (lunedì-sabato) vinta con 355/440 è stata verificata così; per provare un NPC conviene impostare `S.t`/`S.loc` dove `npcWhere(id)` lo colloca.
- Attenzione negli `act`: i testi con apostrofi vanno tra virgolette doppie o con `\'`.
