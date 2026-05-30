/**
 * License manager — single source of truth for the app's licensed state.
 *
 * Responsibilities:
 *   - Load saved token at boot
 *   - Validate with server on demand and on a heartbeat schedule
 *   - Expose current state for the UI to gate on
 *   - Drive trial start, key activation, deactivation
 *   - Issue per-action permission tokens before sensitive operations
 *
 * State values:
 *   needs_activation   — no saved token, show entry screen
 *   trial              — active trial, can use the app
 *   licensed           — active license, can use the app
 *   trial_expired      — trial ran out
 *   revoked            — server says key revoked
 *   kill_switch        — server-wide kill switch on
 *   offline_grace      — can't reach server but cached token still in grace window
 *   offline_dead       — can't reach server AND grace window over
 *   checking           — transient while a call is in flight
 */

const client = require('./client')
const store = require('./tokenStore')
const { getDeviceFingerprint, getDeviceLabel } = require('./fingerprint')
const { OFFLINE_GRACE_HOURS, HEARTBEAT_INTERVAL_MINUTES } = require('./constants')

let _state = { kind: 'checking' }
let _heartbeatTimer = null
const listeners = new Set()

/* ──────────────────────────────────────────────────────────────────
   Pub/sub for the UI
   ────────────────────────────────────────────────────────────────── */
function getState() { return _state }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function setState(next) {
  _state = next
  for (const fn of listeners) { try { fn(_state) } catch (_) {} }
}

/* ──────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────── */
function isWithinGrace(lastIso) {
  if (!lastIso) return false
  const last = new Date(lastIso).getTime()
  return Date.now() - last < OFFLINE_GRACE_HOURS * 3600 * 1000
}

function ms(label) {
  if (label === 'heartbeat') return HEARTBEAT_INTERVAL_MINUTES * 60 * 1000
  return 60_000
}

/* ──────────────────────────────────────────────────────────────────
   Bootstrap on app start
   ────────────────────────────────────────────────────────────────── */
async function init() {
  const saved = store.loadToken()
  if (!saved || !saved.token) {
    setState({ kind: 'needs_activation' })
    return
  }
  setState({ kind: 'checking', _from: 'init', cached: saved })
  await checkOnce()
  scheduleHeartbeat()
}

/* ──────────────────────────────────────────────────────────────────
   Single check with the server
   ────────────────────────────────────────────────────────────────── */
async function checkOnce() {
  const saved = store.loadToken()
  if (!saved) { setState({ kind: 'needs_activation' }); return }

  const fp = getDeviceFingerprint()
  const r = await client.check({ token: saved.token, fingerprint: fp })

  // Network or server error → fall back to grace logic
  if (!r || r.error === 'network' || r.error === 'timeout' || r._status >= 500) {
    if (isWithinGrace(saved.last_check_at || saved.activated_at)) {
      setState({ kind: 'offline_grace', kind_of_token: saved.kind, prefix: saved.prefix })
    } else {
      setState({ kind: 'offline_dead' })
    }
    return
  }

  if (r._status === 503 && r.error === 'kill_switch_active') {
    setState({ kind: 'kill_switch' })
    return
  }
  if (r.error === 'revoked' || r.error === 'device_booted') {
    store.clearToken()
    setState({ kind: 'revoked', reason: r.error })
    return
  }
  if (r.error === 'trial_expired') {
    store.clearToken()
    setState({ kind: 'trial_expired' })
    return
  }
  if (r.error === 'invalid_token' || r.error === 'wrong_token_kind' || r.error === 'device_mismatch') {
    store.clearToken()
    setState({ kind: 'needs_activation', reason: r.error })
    return
  }
  if (r.ok && (r.kind === 'license' || r.kind === 'trial')) {
    // Refresh last_check_at locally
    store.saveToken({ ...saved, last_check_at: new Date().toISOString() })
    setState({
      kind: r.kind === 'trial' ? 'trial' : 'licensed',
      kind_of_token: r.kind,
      prefix: saved.prefix || null,
      expires_at: r.expires_at || saved.expires_at || null,
      seats_max: r.seats_max,
    })
    return
  }
  // Unknown response — treat as offline
  setState({ kind: 'offline_grace', kind_of_token: saved.kind, prefix: saved.prefix })
}

function scheduleHeartbeat() {
  if (_heartbeatTimer) clearInterval(_heartbeatTimer)
  _heartbeatTimer = setInterval(() => { checkOnce().catch(() => {}) }, ms('heartbeat'))
}

function stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null }
}

/* ──────────────────────────────────────────────────────────────────
   User actions
   ────────────────────────────────────────────────────────────────── */

async function activateKey(rawKey) {
  setState({ kind: 'checking', _from: 'activate' })
  const fp = getDeviceFingerprint()
  const r = await client.activate({ key: rawKey, fingerprint: fp, hostname: getDeviceLabel() })

  if (r.ok && r.token) {
    const prefix = String(rawKey).trim().slice(0, 7).toUpperCase()  // e.g. "LH-A3X7"
    store.saveToken({
      token: r.token,
      kind: 'license',
      prefix,
      activated_at: new Date().toISOString(),
      last_check_at: new Date().toISOString(),
      seats_max: r.seats_max,
    })
    setState({ kind: 'licensed', prefix, seats_max: r.seats_max })
    scheduleHeartbeat()
    return { ok: true, seats_used: r.seats_used, seats_max: r.seats_max }
  }
  // Surface error to UI without changing global state
  await checkOnce()  // recompute from whatever we had before
  return { ok: false, error: r.error || 'activate_failed', detail: r.message }
}

async function startTrial() {
  setState({ kind: 'checking', _from: 'trial' })
  const fp = getDeviceFingerprint()
  const r = await client.startTrial({ fingerprint: fp, hostname: getDeviceLabel() })

  if (r.ok && r.token) {
    store.saveToken({
      token: r.token,
      kind: 'trial',
      activated_at: new Date().toISOString(),
      last_check_at: new Date().toISOString(),
      expires_at: r.expires_at,
    })
    setState({ kind: 'trial', expires_at: r.expires_at })
    scheduleHeartbeat()
    return { ok: true, expires_at: r.expires_at }
  }
  await checkOnce()
  return { ok: false, error: r.error || 'trial_failed' }
}

async function deactivate() {
  stopHeartbeat()
  store.clearToken()
  setState({ kind: 'needs_activation' })
  return { ok: true }
}

/**
 * Request a fresh action-token for a sensitive operation (e.g. starting a hunt).
 * UI calls this just before the operation. If it returns null, block the op.
 */
async function getActionToken(action) {
  const saved = store.loadToken()
  if (!saved?.token) return { ok: false, error: 'no_license' }
  const r = await client.actionToken({ token: saved.token, action })
  if (!r.ok) return { ok: false, error: r.error || 'action_token_failed' }
  return { ok: true, action_token: r.action_token, ttl_seconds: r.ttl_seconds }
}

/**
 * Quick local check — is the app currently usable? Used by main.js to gate
 * sensitive IPC handlers (like search:run) without a network round-trip.
 */
function isUsableLocally() {
  return ['trial', 'licensed', 'offline_grace'].includes(_state.kind)
}

module.exports = {
  init, checkOnce, getState, subscribe,
  activateKey, startTrial, deactivate,
  getActionToken, isUsableLocally,
}
