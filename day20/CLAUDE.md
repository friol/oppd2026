# CLAUDE.md — day20

Questa cartella contiene il programma day20 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day19`, `day20`, ...) e deve restare autonomo.

## Obiettivo del programma

**Skyward**: simulatore di volo nel browser con grafica "next-gen" realistica. Si pilota un caccia Su-35 sopra un'isola procedurale di 32×32 km con pianure, colline, montagne con cime innevate e praterie verdi sotto, laghi e mare, foreste e piccoli paesi.

- **Acqua**: piano unico a quota 0 (mare e laghi). Riflesso planare (camera specchiata, clipping plane) che riflette montagne, nubi e cielo. Onde procedurali **non ripetitive**: 8 ottave di gradient noise 3D con derivate analitiche, ruotate con l'angolo aureo e con dispersione delle acque profonde, più un domain warp a grande scala. Colore e trasparenza dipendono dalla profondità letta dalla heightmap. Ci sono anche schiuma sulle rive e riflessi del sole (lobo GGX).
- **Cielo**: LUT di scattering atmosferico (Rayleigh + Mie, single scattering, 256×128) ricalcolata ogni frame per la quota della camera. Ciclo giorno-notte con sole (latitudine 44° N) e luna con fasi, stelle che ruotano attorno al polo, esposizione adattiva e visione notturna desaturata.
- **Nubi**: volumetriche ray-marched a mezza risoluzione tra 1500 e 4200 m. Usano rumore 3D Perlin-Worley tileable generato all'avvio, una coverage 2D di tipo "weather map", luce multi-scattering approssimata e accumulo temporale con riproiezione. Proiettano ombre su terreno, acqua e oggetti e catturano la luce del sole ancora per un po' dopo il tramonto al suolo.
- **Vita nel cielo**:
  - stormi di oche in formazione a V, murmuration di storni e rapaci che volteggiano, generati attorno al giocatore;
  - aerei di linea sporadici (Airbus A345) a 5600–8600 m, con luci di navigazione e scie di condensazione.
- **HUD**: tachimetro analogico (km/h, nodi, arco del throttle, zona boost), altimetro MSL/AGL, variometro, nastro della bussola, orologio e nome del paese più vicino.
- **Controlli**: mouse e tastiera (vedi Comandi).
- **Gioco** (menu in stile titolo all'avvio, tasto M): **volo libero** (esplorazione) oppure **Ring Run**, cioè passare negli anelli in ordine contro il tempo, in 3 difficoltà. Ci sono bonus, acrobazie e 24 achievement persistenti (vedi "Gioco").

## Stack e struttura

HTML, JavaScript e CSS puri. Gli script sono classici, non moduli, così la pagina funziona anche da `file://`. Usa three.js **r147** in locale (`js/three.min.js` + `js/GLTFLoader.js`, copiati dal day18: è l'ultima versione con build non-module). Nessuna rete e nessun font esterno (si usano Bahnschrift e Segoe UI di sistema).

- `index.html`, `style.css`, `favicon.svg`: pagina, schermata di caricamento, pannello di aiuto (H).
- `js/modelsdata.js`: GLB in base64 (`window.SHIP_GLB`, `window.A345_GLB`), letti con `GLTFLoader.parse` senza fetch.
- `js/noise.js` (`NOISE`): PRNG, simplex 2D, fBm, ridged; texture 3D delle nubi (shape 64³ RGBA, detail 32³).
- `js/world.js` (`WORLD`): genera l'isola come generator a step, per mostrare la barra di avanzamento:
  1. campi a bassa frequenza su griglia grossolana;
  2. rilievo a mezza risoluzione (32 m). Le catene sono rumore ridged **elevato a 1,6** (creste affilate, fianchi concavi, valli larghe) con lunghezza d'onda di circa 6 km e ampiezza 2900 m, sopra un massiccio di base. È una via di mezzo tra le guglie iniziali (esponente 1,25, 5 km) e una versione troppo massiccia (esponente 2, 8 km);
  3. erosione termica (ghiaioni: pendenza massima 45°, 25 iterazioni), che trasforma le guglie in piramidi e creste;
  4. upsample a 2049² (16 m per campione);
  5. laghi ai piedi dei massicci;
  6. erosione idraulica a gocce (320k gocce, scelte soprattutto sulle zone alte per scavare i canaloni), seguita da un passaggio termico leggero a piena risoluzione (47°, 8 iterazioni) che elimina i pilastri verticali lasciati dalle gocce;
  7. siti dei paesi, normali e maschere (foresta, campi);
  8. punto di partenza, vicino a un lago con vista sulle montagne.

  `heightAt`/`normalAt`/`maskAt` servono anche per le collisioni. Va in Node, vedi Testing.
- `js/shaders.js` (`GLSL`): uniform condivise per riferimento (`GLSL.U`) e chunk GLSL (noise, lookup del terreno con `texelFetch` bilineare, weather delle nubi, ombre delle nubi). `addCloudShadow(shader)` aggiunge l'ombra delle nubi ai materiali standard.
- `js/atmosphere.js` (`ATMO`): ora del giorno, direzioni di sole e luna, trasmittanza su CPU, LUT del cielo, esposizione, luce principale (sole o luna), luce sulle nubi, IBL (PMREM di una cupola che campiona la LUT, rifatta ogni ~1,5 s di gioco).
- `js/terrain.js` (`TERRAIN`): quadtree in stile CDLOD.
  - Una patch 64×64 istanziata (InstancedBufferGeometry, attributo `aPatch`) con morph dei vertici dispari e skirt contro le crepe.
  - Altezze lette dalla heightmap float nel vertex shader; nodi da 256 m a 32 km, con min/max precalcolati.
  - Due mesh (camera principale e camera del riflesso), ciascuna con il proprio frustum culling.
  - Materiale `MeshStandardMaterial` modificato in `onBeforeCompile`: erba (rigogliosa, secca, alpina), chioma della foresta vista da lontano, campi a patchwork, sabbia, roccia stratificata con licheni, neve (dipende da quota, pendenza ed esposizione a nord), normali di dettaglio procedurali.
- `js/water.js` (`WATER`): mesh dell'acqua che segue la camera e camera specchiata del riflesso.
- `js/vegetation.js` (`VEG`): alberi generati per celle da 256 m dalla maschera foresta (cache). Conifere in quota e latifoglie in basso. Due LOD istanziati: dettagliati entro 1 km (proiettano ombre), semplici e diradati fino a 3,4 km; più in là la foresta è solo colore del terreno. Oscillano al vento.
- `js/towns.js` (`TOWNS`): case istanziate lungo una strada principale e strade laterali, chiesa con campanile e guglia, strade drappeggiate sul terreno. Le finestre procedurali sono vetro scuro di giorno e luci calde di notte.
- `js/life.js` (`LIFE`): stormi (mesh istanziata, battito d'ali nel vertex shader, planata) e aerei di linea.
  - Del modello A345 si nascondono carrello e portelli (nodi `GEAR`/`COVER`), si scala a 67 m e si orienta usando la deriva.
  - Le scie partono dai motori e sono ribbon rivolti alla camera, che si allargano e svaniscono.
  - `LIFE.spawnPlane()` è un hook di debug.
- `js/ship.js` (`SHIP`): il caccia Su-35 (21,9 m di lunghezza, come quello reale; muso su -Z) con bagliore dei motori proporzionale al throttle.
  - Il modello (`ship.glb`) è statico e porta tre empty: `Nozzle_1` e `Nozzle_2` (uscite dei due motori; la loro scala è il raggio dell'ugello, che in metri finisce in `SHIP.nozzleR` e dimensiona bagliori e fiamme) ed `Eye` (testa del pilota).
  - Le distanze della camera (inseguimento e cinematica) sono state tarate per 12,5 m e vengono scalate con `CAM_K = LENGTH / 12,5 × 0,8` (lo 0,8 avvicina un po' il caccia).
  - Camera cockpit: 0,18 m sopra `Eye`, per guardare sopra la cornice dell'HUD.
  - I materiali trasparenti (vetro della canopy e dell'HUD) hanno `depthWrite = false`: il passaggio atmosferico disegna il cielo dove la depth è vuota, quindi un vetro che scrive depth renderebbe nero il cielo dietro di sé.
  - Modello di volo arcade-fisico: autorità dei comandi proporzionale alla velocità, virata coordinata, velocità che insegue il throttle, gravità lungo la traiettoria (in picchiata accelera), vettore velocità che si allinea al muso.
  - Collisione con terreno e acqua: lampo bianco e respawn 380 m più in alto.
  - Camere: inseguimento, cockpit, cinematica; free look con il tasto destro.
- `js/hud.js` (`HUD`): overlay su canvas 2D.
- `js/post.js` (`POST`): pipeline del frame.
  1. Riflesso (mezza risoluzione), nubi del riflesso, composito del riflesso.
  2. Scena principale in HDR (HalfFloat + depth texture float).
  3. Nubi (mezza risoluzione, temporali, ping-pong).
  4. Composito atmosferico: cielo dalla LUT, disco solare, luna, stelle, aerial perspective (nebbia esponenziale in quota), nubi.
  5. Overlay: scie, luci di navigazione, bagliori dei motori, in una scena separata `overlay` renderizzata sopra con la depth della scena principale (target che condivide la depth texture).
  6. Bloom a 2 livelli.
  7. Tone mapping ACES con vignetta e dithering, poi FXAA.

  Le ombre sono calcolate una sola volta per frame, durante il passo del riflesso.

  Le nubi a mezza risoluzione hanno due difese contro gli oggetti vicini "coperti" dalle nubi. Primo: lo storico temporale si usa solo se il raggio attraversa davvero lo strato di nubi prima della geometria, e la riproiezione usa la distanza della scena quando non c'è nube. Secondo: nel composito i pixel più vicini dell'ingresso nello strato di nubi ignorano la texture delle nubi.
- `js/game.js` (`GAME`): modalità di gioco, percorso di anelli, punteggio, acrobazie, achievement, menu e schermata dei risultati (HTML `#menu` / `#results`), HUD di gara (disegnato da `HUD.draw` tramite `GAME.drawHud`).
  - Il menu è in stile schermata del titolo, a pagina intera sopra la scena sfumata. A sinistra ci sono logo e voci grandi (Resume se c'è un volo in corso, Free Flight, Ring Run con ◀ difficoltà ▶, Achievements con contatore, Controls); a destra una scheda informativa che segue la selezione.
  - La lista completa degli achievement compare solo nella scheda della voce Achievements.
  - Pausa (tasto P, oppure automatica quando la finestra perde il focus): è lo stesso menu con `MENU.mode = 'pause'`. In alto il titolo PAUSED, con sotto lo stato (gara: difficoltà, anello, tempo residuo, punti; altrimenti volo libero con ora e quota). Voci: Resume, Restart Course (solo in gara), Free Flight ("Quit to Free Flight" in gara), Main Menu (passa al menu principale, da cui Resume riprende comunque), Music, Controls. P o Esc riprendono. Come il menu, ferma la simulazione (`GAME.blocking()`); `GAME.isPaused()` dice se è la schermata di pausa.
  - La schermata dei risultati (`#results`) ha lo stesso stile, con le stesse classi `mv-left` / `items` / `mv-info`. A sinistra: titolo (COURSE COMPLETE, oppure OUT OF TIME in arancio), riepilogo, punteggio grande con record, voci Retry / Free Flight / Menu. A destra: il dettaglio dei punti.
  - La nave continua a volare dietro la schermata dei risultati, quindi questa risponde solo a ↑↓ e Invio: W/S e Spazio restano ai comandi di volo. L'HUD di volo è nascosto.
  - Il DOM del menu si costruisce una sola volta all'apertura (`renderMenu(true)`, con l'animazione d'entrata). Spostandosi si aggiornano solo la classe `sel`, il contenuto delle voci che cambia e quello della scheda: non ricostruire tutto, altrimenti le animazioni ripartono e il menu lampeggia.
  - Si usa con mouse (hover + click) o tastiera (↑↓ / W S, ←→ / A D per la difficoltà, Invio / Spazio, Esc o M per riprendere). I tasti sono intercettati in fase di capture, quindi non arrivano ai comandi di volo.
  - Col menu aperto l'HUD di volo è nascosto e la camera passa alla cinematica, che orbita attorno al caccia. Alla chiusura torna la camera di prima.
- `js/fx.js`:
  - `SFX`: suoni sintetizzati con Web Audio, senza file. Il menu ha `move` (scorrimento e hover), `tick` (difficoltà e musica), `select` (arpeggio), `back` (indietro / riprendi) e `open` (apertura).
  - `FX`: effetti di accelerazione, tutti nella scena `overlay`. La potenza del motore è `max(boost, accelerazione / 25 m/s²)`.
    - Fiamme: coni additivi agli ugelli, più lunghi con la potenza, con flicker.
    - Scia: particelle `Points` additive che si muovono al 97,5 % della velocità della nave, quindi la scia resta corta (pochi metri).
    - Accensione del boost: lampo dei bagliori.
    - Suono dei motori: `soundfx/thruster.wav`, un one-shot di 5,8 s (salita 0–0,6 s, picco a ~0,8 s, decadimento lungo), su due elementi `<audio>` perché Web Audio non decodifica file locali da `file://`.
      - Quando la potenza supera 0,3 parte da 0,35 s, saltando la salita silenziosa, e suona **una sola volta per spinta**: tenendo premuto il boost non si ripete (flag `latched`), e per risentirlo bisogna rilasciare (potenza < 0,12) e ripremere.
      - Il volume segue la potenza.
      - Sotto 0,12 di potenza sfuma in circa 0,4 s; col menu aperto si ferma.
    - `FX.speedFx` (0..1, da boost/accelerazione e velocità) pilota il radial blur nel tone mapping (`uZoom` in `post.js`), le strisce d'aria che scorrono attorno alla camera e il kick del FOV (`SHIP.fovKick`, fino a +9°).
  - `MUSIC`: musica di sottofondo `muzic/Cruising Altitude.mp3`, riprodotta con un elemento `<audio>` in loop (suona anche da `file://`) e con dissolvenze. Parte al primo click o tasto, per la politica di autoplay dei browser. Si attiva e disattiva col tasto N o con la voce Music del menu; la preferenza è salvata in `localStorage` (`skyward.music`).
- `js/online.js` (`ONLINE`): client della classifica online.
  - È abilitato **solo** con http(s) da host pubblico (`ONLINE.enabled`). Da `file://`, localhost, 127.x, ::1, *.local o IP privati (quindi anche da XAMPP) è spento: nessuna richiesta e nessuna voce di menu.
  - `top(diff)` legge la top 10, con cache di 30 s; `submit(run)` invia un punteggio. Timeout di 8 s; il nome del pilota è salvato in `localStorage` (`skyward.name`).
  - In `game.js`:
    - la voce di menu **Leaderboard** ha ◀ difficoltà ▶ (condivisa con Ring Run) e mostra la top 10 nella scheda;
    - nei risultati, se il punteggio è > 0, compaiono il campo nome e il pulsante Submit. I tasti digitati nel campo non arrivano a volo e menu: `onMenuKey` ignora gli input e il campo blocca la propagazione;
    - gli anelli contati sono solo quelli attraversati (`r.missed` esclude i mancati).
- `server/`: lato server della classifica (PHP + MySQL), installazione in `server/README.md`.
  - `schema.sql` è la tabella `skyward_scores`; `leaderboard.php` è l'API (GET top 10, POST invio); `config.sample.php` va copiato in `config.php`, che è escluso da git e bloccato da `.htaccess`.
  - Accesso al database tramite la piccola classe `Db`: usa PDO se c'è `pdo_mysql`, altrimenti `mysqli` (l'hosting di dantonag.it non ha `pdo_mysql`). Con mysqli i parametri `?` vengono inseriti nella query: interi forzati a intero, stringhe escapate con `real_escape_string` e charset `utf8mb4`. `'driver' => 'auto' | 'pdo' | 'mysqli'` in `config.php` forza la scelta; `'debug' => true` mostra l'errore reale di connessione (solo durante l'installazione).
  - Protezioni: query preparate o escape, validazione, controllo dell'origine, limite per IP (hash con sale), plausibilità del punteggio.
  - **Le regole in `RULES` vanno tenute allineate a `DIFF` di `js/game.js`.**
  - Testata in locale con `php -S`:
    - sul MariaDB 10.4 di XAMPP, con entrambi i driver e risultati identici: inserimenti, posizioni, nomi Unicode, un record per pilota senza distinzione di maiuscole, limite antispam;
    - senza database: validazioni e rifiuti;
    - nel browser con un `fetch` finto.
- `muzic/Cruising Altitude.mp3`: traccia musicale; `soundfx/thruster.wav`: suono dei motori; `soundfx/ring.wav`: passaggio riuscito in un anello; `soundfx/missed.wav`: anello mancato (`SFX.missed()` in `missRing`, pool di 2 `<audio>`); `soundfx/applause.wav` / `soundfx/boo.mp3`: gara completata / persa per tempo scaduto (`SFX.applause()` / `SFX.boo()` in `finishRace`; entrambi fermati da `SFX.stopRaceEnd()` quando parte un'altra gara) (forniti dall'utente).
  - `SFX.ring(combo)` usa un pool di 3 `<audio>` per non troncare i passaggi ravvicinati; durante una serie di bullseye il `playbackRate` sale del 6 % per livello di combo (massimo +36 %), con `preservesPitch = false`.
- `js/main.js`: avvio a step con barra di caricamento, input, loop, crash/respawn, lettura della LUT per la luce ambiente dell'acqua e delle scie.
- `tools/`:
  - `testworld.js`: genera il mondo in Node e scrive un PNG della mappa;
  - `shot.js`: test in Chrome headless via DevTools Protocol, stampa la console e salva uno screenshot. Chrome parte con `--autoplay-policy=no-user-gesture-required`, così l'audio si può verificare (per esempio lo stato di `FX.thrust`);
  - `convert_ship.py` / `convert_models.py`: script Blender per la conversione del caccia e dell'aereo di linea.

## Gioco

- Stati di `GAME.state`: `menu` → `free` | `countdown` → `race` → `results`. Solo `menu` mette in pausa la simulazione (`GAME.blocking()`). La nave non si ferma mai: vola durante il countdown (3,5 s) e continua dopo il traguardo, con la schermata dei risultati aperta.
- **Ring Run**: il percorso è casuale a ogni partenza. Nessun teletrasporto: parte dal punto in cui la nave si troverà alla fine del countdown (posizione + velocità × 3,5 s), lungo la sua direzione di volo e alla sua quota (alzata se troppo vicina al terreno).
  - Gli anelli seguono una rotta con svolte limitate. Ogni 4 anelli punta verso un lago o un paese davanti, e si tiene lontana dal mare aperto.
  - La quota è un AGL casuale, alzata quanto basta perché il segmento dritto dall'anello precedente passi sopra il terreno; il dislivello tra anelli è limitato.
  - Il passaggio si rileva intersecando il segmento percorso nel frame col piano dell'anello successivo. Se l'intersezione cade entro 4 raggi ma fuori dall'anello, l'anello è mancato.
- Difficoltà (`DIFF` in `game.js`):

  | | Anelli | Raggio | Distanza tra anelli | AGL | Moltiplicatore punti | Anello mancato |
  |---|---|---|---|---|---|---|
  | Easy | 15 | 42 m | 800–1100 m | 170–320 m | ×1 | saltato |
  | Normal | 20 | 30 m | 650–950 m | 90–230 m | ×1,5 | saltato, −5 s; 4 sfere bonus |
  | Hard | 25 | 20 m | 500–800 m | 35–170 m | ×2,2 | si deve tornare indietro; 6 sfere bonus |

- Tempo a checkpoint: si parte con pochi secondi più il primo segmento. Ogni anello passato aggiunge il tempo del segmento successivo (lunghezza / velocità di riferimento × 1,25). Allo scadere: "Out of time".
- Punti (tutti × moltiplicatore):
  - anello 100;
  - bullseye (entro il 30 % del raggio) 80 × combo crescente;
  - close shave (oltre l'85 % del raggio) 120;
  - capovolto 300, knife edge 250;
  - passaggio basso (< 35 m) 200, veloce (> 1000 km/h) 150;
  - barrel roll 250 e looping 400 (in qualsiasi momento della gara);
  - sfera dorata +5 s e 150;
  - a fine percorso: tempo residuo × 20, più 1000 per una corsa pulita (nessun anello mancato, nessun crash).
- Anelli di fumo: ogni anello è fatto di 64 sbuffi piccoli (44 sul giro principale, 20 su un secondo giro sfalsato; dimensione 16–20 % del raggio, poca dispersione, così l'anello è sottile e continuo), quad sempre rivolti alla camera in un'unica mesh istanziata nella scena `overlay`, quindi sono testati contro la depth della scena ma non entrano nel riflesso. Gli attributi per sbuffo sono `aPos` (centro, dimensione), `aData` (seed, dissoluzione, verso di rotazione) e `aTint` (colore, opacità).
  - Lo shader dà la forma con value noise animato e simula l'illuminazione di sole e cielo con una normale sferica finta.
  - Gli sbuffi ondeggiano piano, svaniscono vicino alla camera (sotto 18 m, così non coprono lo schermo quando li si attraversa) e lontano (oltre 5 km).
  - Colori: prossimo anello dorato, traguardo verde, gli altri bianchi e più tenui dal quinto in poi. Un anello passato o mancato si dissolve in 1,6 s espandendosi e salendo.
- Ultimi secondi: quando il cronometro scende a 5, 4, 3, 2 e 1 s suona `SFX.beep(n)` (sintetizzato: ogni bip un semitono sopra il precedente, Si5 → Do6 → Do♯6 → Re6 → Re♯6, l'ultimo più lungo). Si basa sul passaggio di `Math.ceil(G.time)`, quindi se un anello riporta il tempo sopra i 5 s i bip suonano di nuovo alla scadenza successiva.
- Crash in gara: −5 s e respawn 350 m prima dell'anello successivo (`GAME.onCrash`, che main chiama prima del respawn standard).
- Acrobazie: barrel roll e looping si rilevano integrando `SHIP.rates` (roll/pitch). Un giro completo di 360° senza pause conta come acrobazia.
- 24 achievement (`ACH`): alcuni di gara (finire ogni difficoltà, flawless, sharpshooter, anelli capovolti, knife edge, sopra 1500 km/h), altri di volo valgono anche in volo libero (muro del suono, sopra 6000 m, rasoterra, sull'acqua, 10 paesi, 3 laghi, vicino a uno stormo o a un aereo di linea, primo crash).
- Persistenza: achievement e record per difficoltà sono salvati in `localStorage` (chiave `skyward.v1`), con try/catch: senza storage il gioco funziona lo stesso.

## Modelli

- Caccia: "Sukhoi Su-35 - Fighter Jet - Free" by bohmerang (https://sketchfab.com/bohmerang), licenza **CC-BY-NC-SA-4.0**: solo uso non commerciale, attribuzione obbligatoria, opere derivate con la stessa licenza. Il credito è nell'aiuto (H) e va mantenuto.
  - L'originale (GLB Sketchfab, unità in decimetri, muso su +X) ha mesh separate per scafo, canopy, cockpit, HUD, vetri degli strumenti e carrello (aperto `landingOn` + luce, chiuso `landingOff`).
  - `tools/convert_ship.py` (Blender 5.1) fa la conversione:
    - elimina il carrello abbassato;
    - trova gli ugelli fra i vertici più arretrati dello scafo con 8 < |y| < 17 dm e -7 < z < 5 dm, cioè ai lati del "pungiglione" di coda centrale e all'altezza della fusoliera, e li salva come empty `Nozzle_1/2` con scala = raggio;
    - mette `Eye` dentro la canopy, 2,6 dm sotto il suo punto più alto;
    - ruota il muso verso +Y di Blender (-Z in glTF) e converte le texture in JPEG 1024.
  - Fiamme, scia e bagliori hanno i colori arancio di un postbruciatore.
- Per rigenerare: `blender -b --python tools/convert_ship.py -- <sukhoi_su-35_-_fighter_jet_-_free.glb> <out_dir>` e `blender -b --python tools/convert_models.py -- <a345_dir> <out_dir>`, poi ricostruire `js/modelsdata.js` dai due GLB in base64 (`SHIP_GLB`, `A345_GLB`), mantenendo le righe di commento in testa.

## Comandi

- Avvio: aprire `index.html` nel browser (funziona anche da `file://`) oppure `http://localhost/oppd2026/day20/` con XAMPP. Il caricamento dura circa 10 s: generazione del mondo più texture delle nubi.
- Mouse: click per catturarlo (pointer lock). È uno stick virtuale (destra/sinistra = rollio, su/giù = beccheggio) che si ricentra lentamente. La rotella regola il throttle, il tasto destro trascinato guarda intorno, Esc rilascia il mouse.
- Tastiera:
  - volo: W/S o ↑/↓ muso giù/su; A/D o ←/→ rollio; Q/E imbardata; R/F o +/- throttle; Shift o Space boost;
  - camera e tempo: C camera; N musica on/off; T +1 ora; `[` `]` ciclo giorno più lento/veloce (default ×60, cioè 24 minuti per giorno);
  - gioco: M menu (volo libero, Ring Run Easy/Normal/Hard, achievement); durante la gara la freccia dorata indica il prossimo anello;
  - opzioni: L meteo (sereno, sparso, nuvoloso, coperto); G qualità grafica (scala di render e passi delle nubi); I inverte il pitch del mouse; P pausa (schermata di pausa); H aiuto.

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Non usare la parola "X-wing" in testi, commenti, nomi o documentazione: si dice "starfighter" / "navicella" / "ship".
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
- Rive: niente z-fighting tra il piano dell'acqua e il terreno. In `world.js` il terreno attraversa lo zero con una pendenza netta (abbassamento fino a 1,4 m tra +1,5 e -2 m). L'alpha dell'acqua va a 0 quando la profondità letta dalla heightmap scende sotto 0,45 m. Soprattutto, la linea di riva la decide la heightmap esatta (discard + fade nel fragment dell'acqua) e non il depth test contro la mesh LOD del terreno, che vicino all'acqua cambia forma col morph e ha vertici radi lontano dalla camera. Per questo l'acqua scrive `gl_FragDepth` spostata verso la camera di 2,5 m + 0,4 % della distanza (uniform `uProj` aggiornata in `WATER.updateReflection`). Il near plane è 1 m, tranne nel cockpit dove è 0,15 m.
- Unità: metri e secondi, y in alto, livello del mare a 0, nord = -Z, est = +X.
- Unità di luce "fisiche":
  - sole a 20 fuori atmosfera (`SUN_E`), DirectionalLight con intensità 1/π e colore = illuminanza trasmessa (modalità legacy di r147: radianza = albedo × colore × cosθ);
  - IBL dalla LUT con `envMapIntensity` 1,8 sul terreno, per compensare il single scattering;
  - luna 0,16, volutamente più forte del reale.
- I materiali custom sono `MeshStandardMaterial` + `onBeforeCompile` (così hanno ombre, IBL e clipping) oppure `ShaderMaterial`. Per avere l'ombra delle nubi usare `GLSL.addCloudShadow(shader)`.
- Gli oggetti trasparenti che devono comparire sopra il cielo o le nubi vanno nella scena `overlay`, non in `scene`: il composito atmosferico sovrascrive i pixel con depth = 1.

## Testing

- `node tools/testworld.js out.png`: genera il mondo (circa 10 s) e stampa range delle altezze, laghi, numero di paesi e spawn. Il PNG mostra mappa ombreggiata, paesi in rosso e spawn in giallo.
- `node tools/shot.js out.png [secondi] [js da valutare] [w] [h]`: apre `index.html` in Chrome headless con GPU (ANGLE D3D11), stampa console ed eccezioni, valuta lo script opzionale e salva lo screenshot.
  - Hook utili: `GAME.startRace('hard')`, `GAME.rings`, `GAME.update(dt, camera)` (per simulare passaggi spostando `SHIP.pos`), `ATMO.hours`, `SHIP.reset(x,y,z,dx,dz)`, `SHIP.camMode`, `LIFE.spawnPlane()`, `POST.resetHistory()`, `POST.debugTargets()`.
  - Attenzione: in headless i timer della pagina (`setInterval`) sono rallentati a circa 1 Hz e pochi frame vengono renderizzati dopo un cambiamento brusco. Per posizionare oggetti rispetto alla camera conviene agganciarsi al loop (per esempio facendo il wrap di `LIFE.update`).
- Verificati con screenshot: giorno, tramonto, crepuscolo, notte (paese con finestre accese), sopra le nubi, cockpit, aereo di linea con scia, stormo di oche. 60 FPS su RTX 5070 a 1280×720 in qualità alta.
