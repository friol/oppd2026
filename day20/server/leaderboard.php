<?php
// Skyward online leaderboard API (PHP 7.4+, MySQL/MariaDB through PDO).
//
//   GET  leaderboard.php?difficulty=normal[&limit=10]
//        -> { ok, difficulty, entries: [ { rank, name, score, rings, total, time_ms, finished, date } ] }
//        One entry per player name: their best score.
//
//   POST leaderboard.php   (JSON body)
//        { name, difficulty, score, rings, totalRings, timeMs, finished }
//        -> { ok, rank, best, entries }   rank = position of the player's best score
//
// Every error answers { ok: false, error: "..." } with a 4xx / 5xx status.

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

// Course rules, mirrored from js/game.js (DIFF). Keep them in sync if the game changes.
const RULES = [
    'easy'   => ['rings' => 15, 'mult' => 1.0, 'orbs' => 0],
    'normal' => ['rings' => 20, 'mult' => 1.5, 'orbs' => 4],
    'hard'   => ['rings' => 25, 'mult' => 2.2, 'orbs' => 6],
];

function reply(int $status, array $data): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $error): void
{
    reply($status, ['ok' => false, 'error' => $error]);
}

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) fail(500, 'Leaderboard not configured');
$cfg = require $configFile;

// Minimal database layer: PDO (pdo_mysql) when available, otherwise mysqli, so the API runs on
// hosts that only enable one of the two. Queries use "?" placeholders; with mysqli the values are
// inlined safely (integers cast, strings escaped with the connection charset set to utf8mb4).
final class Db
{
    private $pdo = null;
    private $my = null;

    public function __construct(array $cfg)
    {
        $driver = $cfg['driver'] ?? 'auto';   // 'auto' | 'pdo' | 'mysqli'
        if ($driver !== 'mysqli' && extension_loaded('pdo_mysql')) {
            $this->pdo = new PDO(
                'mysql:host=' . $cfg['db_host'] . ';dbname=' . $cfg['db_name'] . ';charset=utf8mb4',
                $cfg['db_user'], $cfg['db_pass'],
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false,
                 PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
            );
        } elseif ($driver !== 'pdo' && extension_loaded('mysqli')) {
            mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
            $this->my = new mysqli($cfg['db_host'], $cfg['db_user'], $cfg['db_pass'], $cfg['db_name']);
            $this->my->set_charset('utf8mb4');
        } else {
            throw new RuntimeException('no usable MySQL extension (pdo_mysql / mysqli) for driver "' . $driver . '"');
        }
    }

    private function inline(string $sql, array $params): string
    {
        $parts = explode('?', $sql);
        if (count($parts) !== count($params) + 1) throw new RuntimeException('Placeholder count mismatch');
        $out = $parts[0];
        foreach ($params as $i => $v) {
            $lit = is_int($v) ? (string)$v : "'" . $this->my->real_escape_string((string)$v) . "'";
            $out .= $lit . $parts[$i + 1];
        }
        return $out;
    }

    // all rows as associative arrays
    public function all(string $sql, array $params = []): array
    {
        if ($this->pdo) {
            $st = $this->pdo->prepare($sql);
            $st->execute($params);
            return $st->fetchAll();
        }
        $res = $this->my->query($this->inline($sql, $params));
        $rows = [];
        while ($row = $res->fetch_assoc()) $rows[] = $row;
        $res->free();
        return $rows;
    }

    public function row(string $sql, array $params = []): array
    {
        $rows = $this->all($sql, $params);
        return $rows ? $rows[0] : [];
    }

    public function value(string $sql, array $params = [])
    {
        $r = $this->row($sql, $params);
        return $r ? reset($r) : null;
    }

    public function run(string $sql, array $params = []): void
    {
        if ($this->pdo) {
            $this->pdo->prepare($sql)->execute($params);
            return;
        }
        $this->my->query($this->inline($sql, $params));
    }
}

// The database is opened lazily: invalid requests are rejected without touching it.
function db(array $cfg): Db
{
    static $db = null;
    if ($db) return $db;
    try {
        $db = new Db($cfg);
    } catch (Throwable $e) {
        // with 'debug' => true in config.php the real cause is shown (turn it off afterwards)
        fail(503, 'Database unavailable' . (!empty($cfg['debug']) ? ': ' . $e->getMessage() : ''));
    }
    return $db;
}
$table = preg_replace('/[^a-z0-9_]/i', '', (string)$cfg['table']);

// Best score per player for one difficulty
function topEntries(Db $db, string $table, string $difficulty, int $limit): array
{
    $sql = "SELECT s.name, s.score, s.rings, s.total_rings, s.time_ms, s.finished, s.created_at
            FROM $table s
            JOIN (SELECT name, MAX(score) AS best FROM $table WHERE difficulty = ? GROUP BY name) b
              ON b.name = s.name AND b.best = s.score
            WHERE s.difficulty = ?
            ORDER BY s.score DESC, s.time_ms ASC, s.created_at ASC
            LIMIT 200";
    $out = [];
    $seen = [];
    foreach ($db->all($sql, [$difficulty, $difficulty]) as $row) {
        $key = function_exists('mb_strtolower') ? mb_strtolower($row['name'], 'UTF-8') : strtolower($row['name']);
        if (isset($seen[$key])) continue; // ties of the same player: keep the first
        $seen[$key] = true;
        $out[] = [
            'rank'     => count($out) + 1,
            'name'     => $row['name'],
            'score'    => (int)$row['score'],
            'rings'    => (int)$row['rings'],
            'total'    => (int)$row['total_rings'],
            'time_ms'  => (int)$row['time_ms'],
            'finished' => (bool)$row['finished'],
            'date'     => substr((string)$row['created_at'], 0, 10),
        ];
        if (count($out) >= $limit) break;
    }
    return $out;
}

set_exception_handler(function () { fail(500, 'Server error'); });

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $difficulty = (string)($_GET['difficulty'] ?? '');
    if (!isset(RULES[$difficulty])) fail(400, 'Unknown difficulty');
    $limit = max(1, min(50, (int)($_GET['limit'] ?? 10)));
    reply(200, ['ok' => true, 'difficulty' => $difficulty, 'entries' => topEntries(db($cfg), $table, $difficulty, $limit)]);
}

if ($method !== 'POST') fail(405, 'Method not allowed');

// --- origin check (blocks casual cross-site posting; not a substitute for the checks below)
$origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin === '' && !empty($_SERVER['HTTP_REFERER'])) {
    $p = parse_url((string)$_SERVER['HTTP_REFERER']);
    $origin = ($p['scheme'] ?? '') . '://' . ($p['host'] ?? '');
}
if (!in_array($origin, $cfg['origins'], true)) fail(403, 'Origin not allowed');

// --- input
$raw = file_get_contents('php://input', false, null, 0, 4096);
$in = json_decode((string)$raw, true);
if (!is_array($in)) fail(400, 'Invalid JSON');

$difficulty = (string)($in['difficulty'] ?? '');
if (!isset(RULES[$difficulty])) fail(400, 'Unknown difficulty');
$rule = RULES[$difficulty];

$name = trim(preg_replace('/\s+/u', ' ', (string)($in['name'] ?? '')) ?? '');
if (!preg_match('/^[\p{L}\p{N} _.\-]{2,16}$/u', $name)) fail(400, 'Name: 2-16 letters, digits, spaces, _ . -');

$score    = filter_var($in['score'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 10000000]]);
$rings    = filter_var($in['rings'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 255]]);
$total    = filter_var($in['totalRings'] ?? null, FILTER_VALIDATE_INT);
$timeMs   = filter_var($in['timeMs'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1000, 'max_range' => 3600000]]);
$finished = !empty($in['finished']) ? 1 : 0;
if ($score === false || $rings === false || $timeMs === false) fail(400, 'Invalid numbers');
if ($total !== $rule['rings'] || $rings > $total) fail(400, 'Invalid ring count');

// --- plausibility: an upper bound of what the scoring rules allow (generous on purpose)
$t = $timeMs / 1000;
$n = $rings;
$m = $rule['mult'];
$maxScore = $m * (
      $n * 100                                  // rings
    + 80 * ($n + 0.25 * $n * max(0, $n - 1))    // bullseye combos
    + $n * 770                                  // style passes (close shave, inverted, low, fast)
    + 120 * $t                                  // stunts (barrel rolls / loops) per second of flight
    + $rule['orbs'] * 150                       // time orbs
    + 20 * 300                                  // time left bonus
    + 1000                                      // clean run
);
if ($score > $maxScore * 1.05 + 50) fail(422, 'Score not plausible');
if ($t < $n * 0.8) fail(422, 'Time not plausible');
if ($finished && $n < 1) fail(422, 'Finished without rings');

// --- rate limiting by hashed IP
$db = db($cfg);
$ipHash = hash('sha256', $cfg['ip_salt'] . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
$lim = $db->row("SELECT
        SUM(created_at > NOW() - INTERVAL ? SECOND) AS recent,
        COUNT(*) AS hour
    FROM $table WHERE ip_hash = ? AND created_at > NOW() - INTERVAL 1 HOUR", [(int)$cfg['min_gap_s'], $ipHash]);
if ((int)$lim['recent'] > 0) fail(429, 'Too many submissions, wait a few seconds');
if ((int)$lim['hour'] >= (int)$cfg['max_hour']) fail(429, 'Too many submissions this hour');

// --- store
$db->run("INSERT INTO $table (name, difficulty, score, rings, total_rings, time_ms, finished, ip_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [$name, $difficulty, $score, $rings, $total, $timeMs, $finished, $ipHash]);

// --- rank of this player's best score
$best = (int)$db->value("SELECT MAX(score) FROM $table WHERE difficulty = ? AND name = ?", [$difficulty, $name]);
$rank = (int)$db->value("SELECT COUNT(*) FROM (SELECT name, MAX(score) AS b FROM $table WHERE difficulty = ? GROUP BY name) t WHERE t.b > ?", [$difficulty, $best]) + 1;

reply(200, ['ok' => true, 'rank' => $rank, 'best' => $best, 'entries' => topEntries($db, $table, $difficulty, 10)]);
