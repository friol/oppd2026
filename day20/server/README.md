# Classifica online di Skyward — installazione

Servono PHP 7.4 o superiore, con l'estensione `pdo_mysql` **oppure** `mysqli` (l'API usa quella disponibile; si può forzare con `'driver'` in `config.php`), e un database MySQL/MariaDB, come quelli di dantonag.it.

## 1. Database

Crea la tabella eseguendo `schema.sql` (da phpMyAdmin: *Importa*, oppure incolla il contenuto in *SQL*).

## 2. Configurazione

1. Copia `config.sample.php` in `config.php`, nella stessa cartella `server/`.
2. Inserisci host, nome del database, utente e password.
3. Imposta `ip_salt` a una stringa casuale lunga, per esempio generata con `openssl rand -hex 32`.
4. Controlla `origins`: deve contenere l'indirizzo esatto da cui viene servito il gioco (schema + host, senza percorso). Per esempio `https://dantonag.it` e, se esiste, `https://www.dantonag.it`.

`config.php` è escluso da git (`.gitignore`). Sul web è bloccato da `.htaccess` (Apache); su un server diverso da Apache va protetto con la regola equivalente.

## 3. Pubblicazione

Carica tutta la cartella `day20/` sul sito, compresa `server/`. Il gioco chiama `server/leaderboard.php` con un percorso relativo, quindi funziona in qualunque sottocartella (per esempio `https://dantonag.it/oppd2026/day20/`).

Verifica rapida dal browser:

- `…/day20/server/leaderboard.php?difficulty=normal` deve rispondere `{"ok":true,"difficulty":"normal","entries":[]}`;
- `…/day20/server/config.php` deve rispondere **403**.

## Se risponde "Database unavailable"

PHP non riesce a collegarsi a MySQL. Per vedere il motivo, aggiungi temporaneamente `'debug' => true,` in `config.php` e ricarica `leaderboard.php?difficulty=normal`: il messaggio conterrà l'errore di MySQL. Toglilo (o rimettilo a `false`) appena risolto.

| Errore | Causa tipica |
|---|---|
| `[1045] Access denied for user …` | Password sbagliata, oppure su cPanel l'utente non è stato **associato al database** (*MySQL Databases → Add User To Database*, con tutti i privilegi). |
| `[1044] Access denied … to database` | Utente valido ma senza permessi su quel database (stessa soluzione). |
| `[1049] Unknown database` | Nome del database sbagliato: su cPanel ha il prefisso dell'account, per esempio `account_nome`. |
| `[2002] …` / `Connection refused` / `No such file or directory` | Host sbagliato. Su cPanel di solito è `localhost`; se non va, prova `127.0.0.1` oppure l'host indicato dal provider. |
| `[1146] Table … doesn't exist` | Non hai eseguito `schema.sql` su quel database. |
| `no usable MySQL extension (pdo_mysql / mysqli)` | Nessuna delle due estensioni è attiva: abilitane una nel pannello PHP dell'hosting (*Select PHP Version → Extensions*). |

## Come funziona

- Il gioco abilita la classifica **solo** se la pagina è servita via http(s) da un host pubblico. Da `file://`, `localhost`, `127.x`, `::1`, `*.local` o indirizzi di rete privata (`10.x`, `192.168.x`, `172.16–31.x`) è spenta: nessuna richiesta e nessuna voce di menu.
- Menu → **Leaderboard** (◀ ▶ per la difficoltà): top 10, con il miglior punteggio di ogni pilota.
- Fine di un Ring Run: nella scheda dei risultati si inserisce il nome (ricordato nel browser) e si invia. La risposta mostra la propria posizione e la top 10.

### API (`leaderboard.php`)

| Richiesta | Risposta |
|---|---|
| `GET ?difficulty=easy\|normal\|hard[&limit=10]` | `{ ok, difficulty, entries: [{ rank, name, score, rings, total, time_ms, finished, date }] }` |
| `POST` JSON `{ name, difficulty, score, rings, totalRings, timeMs, finished }` | `{ ok, rank, best, entries }` |

Gli errori rispondono `{ ok: false, error }` con codice 4xx/5xx.

### Protezioni

- Query preparate (PDO); nessun dettaglio d'errore restituito al client.
- Validazione:
  - nome di 2–16 caratteri (lettere, cifre, spazio, `_ . -`);
  - difficoltà nota;
  - numero di anelli pari a quello del percorso;
  - interi entro limiti sensati.
- POST accettati solo dalle origini in `origins` (header Origin/Referer).
- Controllo di plausibilità: il punteggio non può superare il massimo teorico consentito dalle regole del gioco per quel numero di anelli e quella durata, e la durata minima è 0,8 s per anello.
  - Le regole sono copiate in `RULES` (`leaderboard.php`) da `DIFF` in `js/game.js`: se cambiano anelli, moltiplicatori o sfere bonus, vanno aggiornate anche lì.
- Limite antispam per IP: un invio ogni 15 s e al massimo 40 all'ora. L'IP non è mai salvato in chiaro, ma come SHA-256 con sale (`ip_hash`).

Il punteggio è calcolato dal client, quindi un utente determinato può comunque inviare risultati falsi entro i limiti di plausibilità. È il compromesso normale per un gioco senza server autoritativo. In caso di abusi si possono cancellare le righe dalla tabella (`DELETE FROM skyward_scores WHERE name = '…'`).
