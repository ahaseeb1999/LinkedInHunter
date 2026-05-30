-- LinkedIn Hunter — License Server schema (Cloudflare D1)
-- Run once via:  wrangler d1 execute linkedin-hunter-db --file=schema.sql

-- ───────────────────────────────────────────────────────────────────
-- LICENSES — the keys you issue from the admin panel
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash      TEXT UNIQUE NOT NULL,            -- HMAC-SHA256(KEY_PEPPER, raw_key)
  key_prefix    TEXT NOT NULL,                   -- first 4 chars of raw key, for admin display
  key_encrypted TEXT,                            -- AES-GCM(KEY_ENCRYPTION_KEY, raw_key) for "show key"
  name          TEXT,                            -- your label, e.g. "Friends batch 1"
  max_seats     INTEGER NOT NULL DEFAULT 10,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  expires_at    TEXT,                            -- ISO timestamp, NULL = never
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_key_hash ON licenses(key_hash);
CREATE INDEX IF NOT EXISTS idx_licenses_status  ON licenses(status);

-- ───────────────────────────────────────────────────────────────────
-- DEVICES — one row per machine that activated a key
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id    INTEGER NOT NULL,
  device_id     TEXT NOT NULL,                   -- HMAC(DEVICE_PEPPER, hardware fingerprint)
  label         TEXT,                            -- hostname / friendly name
  ip_country    TEXT,
  first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  status        TEXT NOT NULL DEFAULT 'active',  -- active | booted
  UNIQUE (license_id, device_id),
  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_license   ON devices(license_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_lastseen  ON devices(last_seen);

-- ───────────────────────────────────────────────────────────────────
-- TRIALS — 3-day free trial per device
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id     TEXT UNIQUE NOT NULL,
  label         TEXT,
  ip_country    TEXT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,                   -- started_at + 3 days
  status        TEXT NOT NULL DEFAULT 'active'   -- active | expired | converted
);

CREATE INDEX IF NOT EXISTS idx_trials_device ON trials(device_id);

-- ───────────────────────────────────────────────────────────────────
-- ACTIVITY — append-only audit log (rotated by admin manually)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  action        TEXT NOT NULL,                   -- activate, check, trial_start, blocked, admin_login, etc
  license_id    INTEGER,
  device_id     TEXT,
  ip            TEXT,
  country       TEXT,
  details       TEXT                             -- JSON blob
);

CREATE INDEX IF NOT EXISTS idx_activity_ts      ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_activity_license ON activity(license_id);
CREATE INDEX IF NOT EXISTS idx_activity_action  ON activity(action);

-- ───────────────────────────────────────────────────────────────────
-- ADMINS — login accounts for the admin panel
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                   -- bcrypt(password + ADMIN_PEPPER, cost=12)
  role          TEXT NOT NULL DEFAULT 'admin',   -- admin | super
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

-- ───────────────────────────────────────────────────────────────────
-- ADMIN SESSIONS — server-side sessions with revocation
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id            TEXT PRIMARY KEY,                -- random 32-byte hex
  admin_id      INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  ip            TEXT,
  ua            TEXT,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_exp   ON admin_sessions(expires_at);

-- ───────────────────────────────────────────────────────────────────
-- KILL SWITCH — single row, when 'active' all license checks fail
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kill_switch (
  id            INTEGER PRIMARY KEY,
  active        INTEGER NOT NULL DEFAULT 0,      -- 0 = off, 1 = on
  activated_at  TEXT,
  activated_by  INTEGER,                         -- admin_id
  reason        TEXT
);

INSERT OR IGNORE INTO kill_switch (id, active) VALUES (1, 0);
