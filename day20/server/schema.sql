-- Skyward online leaderboard: run once on the MySQL database (phpMyAdmin or the mysql client).
-- MySQL 5.7+ / MariaDB 10.2+.

CREATE TABLE IF NOT EXISTS skyward_scores (
  id          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name        VARCHAR(16)      NOT NULL,                       -- player name (validated by the API)
  difficulty  ENUM('easy', 'normal', 'hard') NOT NULL,
  score       INT UNSIGNED     NOT NULL,
  rings       TINYINT UNSIGNED NOT NULL,                       -- rings flown through
  total_rings TINYINT UNSIGNED NOT NULL,                       -- rings in the course
  time_ms     INT UNSIGNED     NOT NULL,                       -- duration of the run
  finished    TINYINT(1)       NOT NULL,                       -- 1 = course completed, 0 = out of time
  ip_hash     CHAR(64)         NOT NULL,                       -- salted SHA-256 of the IP (rate limiting only)
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_board (difficulty, score),
  KEY idx_name (difficulty, name),
  KEY idx_ip (ip_hash, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
