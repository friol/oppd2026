<?php
// Riemann's Rollercoaster leaderboard configuration.
// Copy this file to config.php (same folder) and fill in your database credentials.
// config.php is excluded from git (.gitignore) and blocked from the web (.htaccess).
return [
    'db_host'    => 'localhost',
    'db_name'    => 'your_database',
    'db_user'    => 'your_user',
    'db_pass'    => 'your_password',
    'table'      => 'riemann_scores',

    // Long random string: used to hash IP addresses (they are never stored in clear).
    'ip_salt'    => 'replace-with-a-long-random-string',

    // Origins allowed to submit scores (checked against the Origin / Referer header).
    'origins'    => ['https://dantonag.it', 'https://www.dantonag.it'],

    // Anti-spam limits per IP.
    'min_gap_s'  => 15,   // at least this many seconds between two submissions
    'max_hour'   => 40,   // at most this many submissions per hour

    // MySQL extension: 'auto' (pdo_mysql if present, otherwise mysqli), 'pdo' or 'mysqli'.
    'driver'     => 'auto',

    // true only while setting up: error messages then include the database error.
    'debug'      => false,
];
