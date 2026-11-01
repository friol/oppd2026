# CLAUDE.md — day1

Questa cartella contiene il programma day1 per OPPD 2026.

## Contesto

- Repository: `oppd2026` (cartella root `D:\xampp\htdocs\oppd2026`)
- Ogni giorno/programma vive nella propria sottocartella (`day1`, `day2`, ...) e deve restare autonomo.

## Obiettivo del programma

Un gioco in stile arkanoid, ma in cui è presente una racchetta contraria a metà schermo che cerca di rimandare indietro la pallina.

## Stack e struttura

HTML, javascript e CSS.
Non usare mai la rete o motori LLM o AI per le azioni del computer.
Per tutti i file, usa sempre la sottocartella relativa al giorno corrente.

## Struttura

- `index.html` + `style.css`: pagina con un solo canvas (risoluzione logica 640x720, scalata alla finestra).
- `js/game.js`: logica di gioco (stati, fisica, IA della paletta CPU, power-up, high score in localStorage, rendering).
- `js/levels.js`: i 4 livelli (classico, logo Commodore C=, scritta SEGA, Space Invaders senza paletta CPU).
- `js/font.js`: font bitmap 5x7; `js/audio.js`: effetti sonori sintetizzati con Web Audio.
- `assets/sprites.png` (foglio sprite originale), `assets/title.png` (schermata intro), `assets/atlas.png` + `js/atlas.js` (generati).

## Comandi

- Avvio: aprire `index.html` nel browser (anche da `file://`) oppure `http://localhost/oppd2026/day1/` con XAMPP.
- Rigenerare l'atlas dopo modifiche a `assets/sprites.png`: `python tools/make_atlas.py` (dalla cartella `day1`, richiede Pillow).

## Convenzioni

- Tutti i testi ed i commenti nel codice in Inglese
- Mantenere il codice semplice e coerente con lo stile dei file esistenti.
- Non aggiungere dipendenze senza motivo.
- Aggiornare questo file quando cambiano obiettivo, stack o comandi.

## Testing

- Cheat: `Shift+N` durante il gioco (o la schermata "LEVEL n") completa subito il livello corrente.
- Cheat: `Shift+F` durante il gioco fa cadere una capsula "freeze CPU" sopra la paletta del giocatore.
- Cheat: `Shift+G` durante il gioco (livelli con la CPU) fa cadere una capsula "CPU attack" (malus: la CPU spara al giocatore).
- Cheat: `Shift+W` durante il gioco fa cadere una capsula "warp" (apre un varco a destra per passare al livello successivo).
- Cheat: `Shift+S` durante il gioco fa cadere una capsula "steel ball" (la pallina attraversa i mattoni distruggendoli).
