-- Riemann's Rollercoaster online leaderboard: run once on the MySQL database (phpMyAdmin or the mysql client).
-- MySQL 5.7+ / MariaDB 10.2+.

CREATE TABLE IF NOT EXISTS riemann_scores (
  id          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name        VARCHAR(16)      NOT NULL,                       -- player name (validated by the API)
  time_ms     INT UNSIGNED     NOT NULL,                       -- final time: driving time + penalties
  drive_ms    INT UNSIGNED     NOT NULL,                       -- driving time without penalties
  derails     TINYINT UNSIGNED NOT NULL,                       -- derailments (5 s each)
  ip_hash     CHAR(64)         NOT NULL,                       -- salted SHA-256 of the IP (rate limiting only)
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_board (time_ms),
  KEY idx_name (name, time_ms),
  KEY idx_ip (ip_hash, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
