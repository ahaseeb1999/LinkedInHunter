const path = require('path')
const fs = require('fs')

let app
try { app = require('electron').app } catch (_) { app = null }

let db

function getDBPath() {
  const userDataPath = app && app.getPath ? app.getPath('userData') : path.join(__dirname, '../../data')
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true })
  return path.join(userDataPath, 'linkedin-hunter.db')
}

/**
 * UNCONDITIONALLY remove the lock file. We do this safely because main.js
 * acquires `app.requestSingleInstanceLock()` BEFORE this function ever runs —
 * if we're here, we are the only LinkedIn Hunter instance, so any .lock file
 * on disk is by definition stale from a prior crashed run.
 *
 * Retries with backoff to handle Windows quirks (antivirus scanning, indexing
 * services briefly holding files open after process death).
 */
function cleanupStaleLock(dbPath) {
  const lockPath = dbPath + '.lock'
  if (!fs.existsSync(lockPath)) return { removed: false, reason: 'no-lock' }

  // node-sqlite3-wasm uses a DIRECTORY lock (not a file). The directory contains
  // per-writer marker files. We must remove it recursively.
  let isDir = false
  try { isDir = fs.statSync(lockPath).isDirectory() } catch (_) {}

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.rmSync(lockPath, {
        force: true,
        recursive: true,         // critical: lock is a directory
        maxRetries: 3,
        retryDelay: 100,
      })
      if (!fs.existsSync(lockPath)) {
        console.log(`[db] ✓ Removed stale lock ${isDir ? 'directory' : 'file'} at ${lockPath} (attempt ${attempt})`)
        return { removed: true, reason: 'stale' }
      }
    } catch (err) {
      console.warn(`[db] ⚠ Lock remove attempt ${attempt} failed:`, err.code, err.message)
    }
    const end = Date.now() + 150 * attempt
    while (Date.now() < end) { /* spin briefly */ }
  }

  console.error('[db] ❌ FAILED to remove lock after 5 attempts.')
  console.error('[db] ❌ Manual recovery: close the app, then run in PowerShell:')
  console.error(`[db] ❌   Remove-Item "${lockPath}" -Recurse -Force`)
  return { removed: false, reason: 'unremovable' }
}

function initDB() {
  const { Database } = require('node-sqlite3-wasm')
  const dbPath = getDBPath()
  console.log('[db] Database path:', dbPath)
  const exists = fs.existsSync(dbPath)
  console.log('[db] File exists on disk:', exists, exists ? `(${fs.statSync(dbPath).size} bytes)` : '')

  // Try cleanup up to 3 times with progressive backoff — Windows sometimes
  // leaves a "delete pending" state on freshly-released files.
  let cleanupResult
  for (let i = 0; i < 3; i++) {
    cleanupResult = cleanupStaleLock(dbPath)
    if (cleanupResult.removed || cleanupResult.reason === 'no-lock') break
    // Brief sync wait via small busy loop
    const wait = 100 + i * 100
    const end = Date.now() + wait
    while (Date.now() < end) { /* spin */ }
  }

  // If a lock still exists after all attempts, we'll likely fail to open.
  // Surface this VERY loudly so it isn't swallowed.
  if (fs.existsSync(dbPath + '.lock')) {
    console.error('[db] ❌ Lock file still present after cleanup attempts.')
    console.error('[db] ❌ This will likely cause "database is locked" errors.')
    console.error('[db] ❌ Manual fix: close the app, then delete:')
    console.error('[db] ❌   ' + dbPath + '.lock')
  }

  try {
    db = new Database(dbPath)
  } catch (e) {
    console.error('[db] ❌ Failed to open DB:', e.message)
    console.error('[db] ❌ If this says "database is locked", run this in PowerShell:')
    console.error('[db] ❌   Get-Process electron | Stop-Process -Force; Remove-Item "' + dbPath + '.lock" -Force')
    throw e
  }

  db.exec('PRAGMA foreign_keys = ON')
  // busy_timeout: when SQLite hits a lock, retry internally for up to 10s
  // instead of throwing "database is locked" immediately. This is the
  // canonical fix for SQLITE_BUSY in apps with concurrent reads + writes.
  db.exec('PRAGMA busy_timeout = 10000')
  // Note: WAL mode isn't supported by node-sqlite3-wasm (no shared-memory FS
  // in WASM). Default journal_mode=delete is used — that's fine here because
  // we're a single-process Electron app guarded by requestSingleInstanceLock.

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      cookies TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_used TEXT
    );

    CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      keywords TEXT,
      filters TEXT,
      source TEXT,
      results_count INTEGER DEFAULT 0,
      run_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER,
      account_id INTEGER,
      title TEXT,
      company TEXT,
      location TEXT,
      date_posted TEXT,
      description TEXT,
      apply_url TEXT,
      apply_type TEXT,
      applicants_count TEXT,
      industry TEXT,
      company_size TEXT,
      job_type TEXT,
      salary TEXT,
      is_remote INTEGER DEFAULT 1,
      is_duplicate INTEGER DEFAULT 0,
      status TEXT DEFAULT 'New',
      notes TEXT DEFAULT '',
      is_saved INTEGER DEFAULT 0,
      hash TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(search_id) REFERENCES searches(id),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER,
      account_id INTEGER,
      author_name TEXT,
      author_url TEXT,
      author_headline TEXT,
      content TEXT,
      post_date TEXT,
      reactions TEXT,
      comments TEXT,
      links TEXT,
      post_url TEXT,
      is_duplicate INTEGER DEFAULT 0,
      is_saved INTEGER DEFAULT 0,
      hash TEXT,
      scraped_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(search_id) REFERENCES searches(id),
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  // Lightweight migrations — add columns to existing DBs without losing data
  const migrate = (table, column, type) => {
    try {
      const cols = db.all(`PRAGMA table_info(${table})`)
      if (!cols.some(c => c.name === column)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
        console.log(`[db] Migrated: ${table}.${column}`)
      }
    } catch (e) { console.log(`[db] Migration skip ${table}.${column}:`, e.message) }
  }
  migrate('posts', 'post_url', 'TEXT')

  // Default settings
  const defaults = {
    maxRequestsPerSession: '30',
    minDelay: '1500',
    maxDelay: '4000',
    duplicateHandling: 'ask',
    defaultExportPath: '',
    scheduledSearch: 'false',
    scheduleCron: '0 9 * * *',
  }

  const insert = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`)
  for (const [key, value] of Object.entries(defaults)) {
    insert.run([key, value])
  }

  return db
}

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.')
  return db
}

/**
 * Promise-based serialization queue for DB operations.
 *
 * Why: node-sqlite3-wasm is sync-on-WASM, but concurrent IPC handlers can
 * arrive while a long DB operation is mid-flight. The WASM binding's
 * internal mutex sometimes surfaces "database is locked" before busy_timeout
 * kicks in. Funnelling every DB op through a single queue eliminates the
 * race entirely.
 *
 * Usage:  const result = await dbQueue(() => getDB().prepare(...).all())
 */
let queueTail = Promise.resolve()
function dbQueue(fn) {
  const run = queueTail.then(async () => {
    try { return fn() }
    catch (err) {
      // Retry once on transient lock error (defensive — should be rare with busy_timeout)
      const msg = (err.message || '').toLowerCase()
      if (/locked|busy/.test(msg)) {
        await new Promise(r => setTimeout(r, 150))
        return fn()
      }
      throw err
    }
  })
  // Keep queue going even if one task throws
  queueTail = run.catch(() => {})
  return run
}

/**
 * Returns the rowid of the last successful INSERT operation.
 * Use this immediately after any insert.
 */
function getLastInsertId() {
  const row = getDB().get('SELECT last_insert_rowid() as id')
  return row ? row.id : null
}

function getSettings() {
  const rows = getDB().prepare('SELECT key, value FROM settings').all()
  const settings = {}
  rows.forEach(r => { settings[r.key] = r.value })
  return settings
}

function saveSettings(settings) {
  const upsert = getDB().prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`)
  for (const [key, value] of Object.entries(settings)) {
    upsert.run([key, String(value)])
  }
}

function clearAllData() {
  const d = getDB()
  d.run('DELETE FROM posts')
  d.run('DELETE FROM jobs')
  d.run('DELETE FROM searches')
}

function dbDiagnostics() {
  if (!db) return { ok: false, error: 'DB not initialized' }
  try {
    const accounts = db.all('SELECT id, name, email, last_used FROM accounts')
    const jobs     = db.all('SELECT COUNT(*) AS n FROM jobs')[0].n
    const posts    = db.all('SELECT COUNT(*) AS n FROM posts')[0].n
    const searches = db.all('SELECT COUNT(*) AS n FROM searches')[0].n
    return { ok: true, dbPath: getDBPath(), accounts, jobs, posts, searches }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

module.exports = { initDB, getDB, getLastInsertId, getSettings, saveSettings, clearAllData, dbDiagnostics, dbQueue }
