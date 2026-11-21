# CLAUDE.md — day21

Questa cartella contiene il programma day21 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ..., `day20`, `day21`, ...) e deve restare autonomo.

## Obiettivo del programma

**Riemann's Rollercoaster**: simulatore di montagne russe 3D nel browser con grafica realistica. C'è un coaster in acciaio con rotaie tubolari, spina dorsale e piloni in metallo, in un parco con prati, alberi, sole, nuvole e montagne. I colori seguono l'immagine di riferimento `img/toasted.jpg`: cielo blu-lavanda, nubi bianche sfilacciate, prato verde acceso, rotaie rosa-corallo.

- **Percorso** (~780 m): stazione, lift hill a catena (30°), prima discesa da 46 m, curva sopraelevata a destra (sopra i 90° di banking), collina di airtime, giro della morte con profilo a clotoide, camelback, elica finale con freni di regolazione e freni finali.
- **Ride** (giro libero): il treno è automatico. Sta in stazione (dwell 7 s, Spazio per partire subito), poi ruote motrici, catena, gravità e freni.
- **Time Trial**: il giocatore guida il treno.
  - W/↑ attivano i motori lineari, S/↓ i freni. La catena del lift resta attiva come velocità minima.
  - Obiettivo: chiudere il giro nel minor tempo possibile.
  - Il treno deraglia se la forza g percepita da una vettura supera i limiti (`TRACK.LIMITS`): verticale > 6 g ("riders blacked out"), < −1 g (ruote sollevate), laterale > 2 g. Le vetture volano via con fisica balistica. Dopo 3,2 s si riparte dall'ultimo checkpoint (6 per giro) con +5 s di penalità.
  - Il tachimetro mostra la **velocità sicura** (`vCap`): considera la distanza di frenata, quindi è il massimo a cui si può andare adesso senza deragliare più avanti. Sopra compare "TOO FAST — BRAKE!".
  - Medaglie calcolate all'avvio da un pilota AI che tiene il 97 % di `vCap`: oro = AI × 1,06, argento × 1,18, bronzo × 1,35. Il record personale è in `localStorage` (`riemann.best`).
- **Camere** (C o 1–6): Front seat, Back seat (POV con mouse look, oscillazione della testa con le g, vibrazione, FOV che cresce con la velocità e radial blur), Chase, Side, Trackside (camere TV fisse lungo il percorso con zoom), Orbit (trascinamento + rotella). Nella schermata del titolo c'è un'orbita cinematica attorno al treno. L'ultima camera scelta è salvata in `riemann.cam`.
- **Schermata del titolo** con `img/logo.png` (fornito dall'utente); menu Ride / Time Trial / Controls con scheda informativa a destra; pausa (Esc/P, o perdita del focus) e schermata dei risultati con tempi ai checkpoint.

## Stack e struttura

HTML, JavaScript e CSS puri, script classici (non moduli), così funziona anche da `file://`. Usa three.js **r147** in locale (`js/three.min.js`, copiato dal day20). Nessuna rete, nessun font esterno (Bahnschrift / Segoe UI di sistema). Niente texture da file nella scena (da `file://` WebGL non può caricarle): tutto è procedurale. Il logo è solo un `<img>` HTML.

- `js/util.js` (`UTIL`): PRNG, value noise/fBm/ridged in JS, helper vec3 e il chunk GLSL `GLSL_NOISE` (noise, fbm, `cloudDensity` dello strato di nubi condiviso da cielo e ombre). Va anche in Node.
- `js/track.js` (`TRACK`): solo matematica, senza three.js, gira anche in Node.
  - `controlPoints()`: punti di controllo con zona per segmento (`station`, `tires`, `lift`, `brake`, `final`, `loop`, `free`). Il loop è generato da `loopPoints()` integrando una curvatura che cresce linearmente dal fondo alla cima (clotoide), con 5 m di spostamento laterale.
  - `build()`: Catmull-Rom chiusa → ricampionamento ad arco uniforme → doppio blur gaussiano delle posizioni (continuità della curvatura) → nuovo ricampionamento (`ds` ≈ 0,25 m). Tangenti e vettori curvatura `K = dT/ds`. Up di riferimento = up del mondo proiettato, tranne nel loop dove è trasportato in parallelo.
  - **Banking heartline**: simula un giro libero (`designSpeeds`) per avere la velocità di progetto, poi inclina il binario perché la forza percepita (`v²K + g·Y`) cada nel piano verticale del sedile. Il banking è sfumato e limitato a ±89°.
  - Per ogni campione salva `kU`, `kR`, `uy`, `ry`, così `gAt(s, v)` dà le g verticali e laterali in O(1). `vSafe` risolve i limiti in v²; `vCap` aggiunge una passata all'indietro con la frenata (gravità inclusa).
  - `step(st, dt, ctl)`: fisica del treno. Pendenza media sulle 5 vetture, attrito di rotolamento + resistenza aerodinamica, comportamento per zona (zone valutate al centro del treno): stazione con arresto preciso su `sStop`, ruote motrici, catena a 5,5 m/s con anti-rollback, freni. In time trial (`auto = false`) solo la catena resta attiva, più i motori (6,5 m/s² che calano fino a 46 m/s) e i freni del giocatore.
- `js/scenery.js` (`SCENERY`):
  - `patch(material, opts)` aggiunge ombre delle nubi in movimento (stessa `cloudDensity` del cielo) a qualunque `MeshStandardMaterial`, con hook per vertex e fragment e `customProgramCacheKey` unica.
  - Cielo: shader su una sfera che segue la camera, con gradiente lavanda→blu, alone e disco del sole, nubi 2D a 2200 m con domain warp e luce verso il sole.
  - Environment map PMREM dal cielo (versione con emisfero inferiore verde), per i riflessi su acciaio e vernice.
  - Terreno: un'unica mesh polare (raggio 9 km, più fitta al centro) con parco piatto entro 230 m, colline, e montagne con roccia e neve oltre i 2 km. Lo shader dà erba a macchie, piazzale in cemento della stazione, sentiero, boschi, roccia e neve per pendenza/quota, normali di dettaglio vicino alla camera.
  - Erba: 110k fili istanziati in una tessera di 56 m che si avvolge attorno alla camera (posizioni stabili nel mondo), con vento, sfumatura con la distanza ed esclusione su piazzale e sentiero.
  - Alberi: conifere e latifoglie istanziate, a gruppi secondo un fBm, lontani dal binario.
  - Stazione: banchine, tettoia curva, cabina, ringhiere, scale.
  - Sole: DirectionalLight con shadow map 4096 su 180 m che segue il treno, agganciata ai texel per evitare lo sfarfallio.
- `js/trackmesh.js` (`TRACKMESH`): tubi spazzati lungo i frame bancati (due rotaie, spina), traversine a V istanziate ogni 1,2 m, lift con canalina della catena, passerella e corrimano. Piloni ogni 7,5 m: colonna singola o ad A con controventi per altezze > 14–18 m, braccio fino alla spina (più lungo sui tratti molto inclinati), plinti in cemento. Un piccolo hash spaziale (`nearTrack`) evita piloni che attraversano altri tratti di binario; serve anche ad alberi e camere trackside.
- `js/train.js` (`TRAIN`): 5 vetture procedurali.
  - Frame locale: -Z avanti, +X destra, +Y su, rotaie a y = 0.
  - Fiancate estruse con profilo curvo, striscia gialla, muso con fari e chevron sulla prima vettura, sedili e poggiatesta arrotondati (`roundBox`), maniglioni, carrelli con ruote portanti, di guida e anti-sollevamento.
  - Passeggeri con braccia animate: alzate su discese, airtime e alte velocità, altrimenti giù sul maniglione.
  - `derail()` / `updateDerail()`: vetture balistiche con rotazione e rimbalzo sul terreno.
  - `hideRider()` nasconde il passeggero al posto della camera POV.
- `js/post.js` (`POST`): scena in HalfFloat con MSAA 4×, bloom a 4 livelli, lens flare del sole (visibilità letta dalla luminanza HDR nel punto del sole, quindi occlusa dal binario), radial blur da velocità nelle camere POV, ACES, saturazione leggera, vignetta, dithering, flash bianco al deragliamento.
- `js/audio.js` (`AUDIO`): colonna sonora `muzik/Weightless Break.mp3` in loop con un `<audio>` (volume basso, abbassato ancora durante fanfara e schianto, segue N), più suoni sintetizzati con Web Audio: rombo delle ruote, vento (più forte in POV), clic della catena, sibilo dei freni, ronzio dei motori lineari, bip del countdown, checkpoint, fanfara, schianto, suoni del menu. Volume attenuato con la distanza camera–treno. N per on/off (`riemann.sound`).
- `js/game.js` (`GAME`, `MENU`): conto alla rovescia e "GO!" con gli sprite `img/cd3.png`, `cd2`, `cd1`, `cdgo` (ritagliati dallo sheet fornito, sfondo trasparente); gli altri messaggi grandi restano testo. modalità `title` | `ride` | `trial`, stati del trial `countdown` | `run` | `derailed` | `done` (dopo il traguardo frenata d'emergenza, poi risultati), checkpoint, penalità, medaglie, HUD su canvas 2D (tachimetro con banda sicura, g-meter con il riquadro dei limiti, minimappa, cronometro, messaggi grandi), menu DOM.
- `js/main.js`: caricamento a step con barra, camere (`CAM`), input (tasti in fase di capture, trascinamento, rotella), loop.
- `js/online.js` (`ONLINE`) e `server/`: classifica online dei tempi del time trial (PHP + MySQL, come il day20). Il client è attivo solo se la pagina è servita via http(s) da un host pubblico: da `file://`, `localhost` e reti private non fa richieste e non mostra la voce **Leaderboard**. Menu → Leaderboard (top 10); a fine giro la schermata dei risultati ha nome + Submit (`riemann.name` nel browser). `server/leaderboard.php` valida e limita gli invii (tempo finale = guida + 5 s × deragliamenti, guida ≥ 28 s: da rivedere se cambia il tracciato), `schema.sql` crea la tabella `riemann_scores`, `config.php` (escluso da git, bloccato da `.htaccess`) ha le credenziali. Installazione in `server/README.md`. Mentre un `<input>` ha il focus `main.js` ignora i tasti.
- `tools/testtrack.js`: test in Node del tracciato. `tools/shot.js`: screenshot in Chrome headless.

## Comandi

- Avvio: aprire `index.html` nel browser (funziona anche da `file://`) oppure `http://localhost/oppd2026/day21/` con XAMPP. Caricamento ~2 s.
- Tastiera: W/↑ accelera, S/↓ frena (time trial); C o 1–6 camere; Spazio fa partire il treno dalla stazione (ride); R ricomincia il time trial; Esc/P pausa; N audio; H aiuto.
- Touch (rilevamento generoso: `pointer`/`any-pointer: coarse`, `ontouchstart`, `maxTouchPoints`, oppure il primo tocco reale, così compaiono anche su iPad con tastiera; classe `body.touch`): pulsanti DOM in `#touch` (GAS e BRAKE nel time trial, premibili insieme; riga di pulsanti rotondi CAM, pausa, restart, GO per far partire il treno, audio, schermo intero). `main.js` imposta `body.dataset.tm` (`menu|title|ride|trial`) a ogni frame e il CSS mostra i pulsanti giusti. Un dito guarda/orbita, due dita fanno pinch-zoom; in verticale compare l'invito a ruotare il telefono. Non è stata ridotta la qualità grafica: su telefoni di fascia media può non reggere i 60 FPS.
- Mouse: trascinare per guardarsi intorno (POV) o orbitare (le altre camere passano a Orbit); doppio click per ricentrare la vista; rotella per lo zoom (orbit e chase).

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.
- Unità: metri e secondi, y in alto. Il parco è centrato attorno a (35, 0, 35); la stazione è lungo +X a z = 0.
- Se si modifica il tracciato, rilanciare `node tools/testtrack.js`: il giro libero deve restare dentro i limiti di g (oggi: massimo 4,8 g verticali, minimo −0,5 g, laterale ≤ 1,4 g) e il giro dell'AI non deve deragliare.
- Il colore dei materiali passa per `SCENERY.patch` (ombre delle nubi). I materiali con un `onBeforeCompile` diverso hanno bisogno di una `customProgramCacheKey` propria, che `patch` assegna già.
- La scena è renderizzata in HDR lineare: il tone mapping è nel composito di `post.js` e `renderer.toneMapping` resta `NoToneMapping`.

## Testing

- `node tools/testtrack.js [passo_m]`: costruisce il tracciato e stampa per ogni passo posizione, zona, velocità, banking, g verticale e laterale alla velocità di progetto, `vSafe` e `vCap`. Poi stampa gli estremi delle g nel giro libero e un giro dell'AI in time trial (tempo e assenza di deragliamenti).
- `node tools/shot.js out.png [secondi] [js da valutare] [w] [h]`: Chrome headless con GPU, stampa console ed errori (righe ripetute filtrate) e salva lo screenshot.
  - Esempi di eval: `MENU.close(); GAME.startRide(true); GAME.st.s = 440; GAME.st.v = 26; CAM.set(4)`. Per simulare un giro intero conviene chiamare `GAME.update(1/60, {throttle, brake})` in un ciclo sincrono dentro l'eval: in headless i frame reali sono lenti.
- Verificati con screenshot: titolo, camere front/back seat, chase, trackside sul loop, orbita ravvicinata del treno, deragliamento, schermata dei risultati. 60 FPS su RTX 5070 a 1280×720.
