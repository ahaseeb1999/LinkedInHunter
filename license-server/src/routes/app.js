/**
 * App-facing routes — called by the LinkedIn Hunter Electron app.
 *
 * Every request from the app must be HMAC-signed with API_HMAC_SECRET.
 * That secret lives in both the app (obfuscated) and Cloudflare Secrets.
 *
 * Endpoints:
 *   POST /api/v1/trial/start   — start 3-day trial for a device
 *   POST /api/v1/activate      — bind a license key to a device
 *   POST /api/v1/check         — heartbeat: am I still allowed?
 *   POST /api/v1/action-token  — get short-lived permission for a sensitive op
 */

import { db, logActivity, getKillSwitch } from '../lib/db.js'
import { hmacSha256, timingSafeEqual } from '../lib/crypto.js'
import { signLicenseToken, signActionToken, verifyToken } from '../lib/jwt.js'
import { isValidKeyFormat, normalizeKey, keyPrefix } from '../lib/keys.js'

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' },
})

/* ──────────────────────────────────────────────────────────────────
   Request-signature verification.
   App sends:
     X-Timestamp: <ms since epoch>
     X-Signature: HMAC_SHA256(API_HMAC_SECRET, timestamp + body)
   Server rejects:
     - missing/invalid headers
     - timestamp older than 5 minutes (replay protection)
     - signature mismatch
   ────────────────────────────────────────────────────────────────── */
export async function verifyAppRequest(req, env, bodyText) {
  const ts = req.headers.get('x-timestamp')
  const sig = req.headers.get('x-signature')
  if (!ts || !sig) return { ok: false, error: 'missing signature headers' }

  const tsNum = parseInt(ts, 10)
  if (!Number.isFinite(tsNum)) return { ok: false, error: 'bad timestamp' }
  if (Math.abs(Date.now() - tsNum) > 5 * 60 * 1000) return { ok: false, error: 'stale request' }

  const expected = await hmacSha256(env.API_HMAC_SECRET, ts + bodyText)
  if (!timingSafeEqual(sig.toLowerCase(), expected.toLowerCase())) {
    return { ok: false, error: 'bad signature' }
  }
  return { ok: true }
}

/* ──────────────────────────────────────────────────────────────────
   Common: hash device fingerprint with DEVICE_PEPPER
   ────────────────────────────────────────────────────────────────── */
async function deviceIdFromFingerprint(env, fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8) {
    return null
  }
  return hmacSha256(env.DEVICE_PEPPER, fingerprint)
}

/* ──────────────────────────────────────────────────────────────────
   Reap dead seats: any device on a license that hasn't checked in
   for SEAT_AUTO_FREE_DAYS gets marked 'booted'. Called inline before
   seat-count enforcement.
   ────────────────────────────────────────────────────────────────── */
async function reapInactiveSeats(env, license_id) {
  const days = parseInt(env.SEAT_AUTO_FREE_DAYS || '15', 10)
  await db.run(
    env,
    `UPDATE devices
     SET status = 'booted'
     WHERE license_id = ?
       AND status = 'active'
       AND datetime(last_seen) < datetime('now', '-${days} days')`,
    [license_id]
  )
}

/* ──────────────────────────────────────────────────────────────────
   POST /api/v1/trial/start
   Body: { fingerprint, hostname }
   ────────────────────────────────────────────────────────────────── */
export async function trialStart(req, env, body, meta) {
  const device_id = await deviceIdFromFingerprint(env, body.fingerprint)
  if (!device_id) return json({ ok: false, error: 'bad fingerprint' }, 400)

  // Kill switch overrides everything
  const ks = await getKillSwitch(env)
  if (ks.active) return json({ ok: false, error: 'service unavailable' }, 503)

  // Check existing trial
  const existing = await db.get(env, 'SELECT * FROM trials WHERE device_id = ?', [device_id])
  if (existing) {
    const expired = new Date(existing.expires_at) < new Date()
    if (expired) {
      await logActivity(env, { action: 'trial_expired', device_id, ip: meta.ip, country: meta.country })
      return json({ ok: false, error: 'trial_expired', expired_at: existing.expires_at }, 403)
    }
    // Trial active — issue a token
    const token = await signLicenseToken(
      { device_id, scope: 'trial', trial_expires_at: existing.expires_at },
      Math.min(86400, Math.floor((new Date(existing.expires_at) - new Date()) / 1000)),
      env.JWT_SECRET
    )
    return json({ ok: true, token, kind: 'trial', expires_at: existing.expires_at })
  }

  // New trial
  const trialDays = parseInt(env.TRIAL_DAYS || '3', 10)
  const expiresAt = new Date(Date.now() + trialDays * 86400 * 1000).toISOString()
  await db.run(env, `INSERT INTO trials (device_id, label, ip_country, expires_at)
                     VALUES (?, ?, ?, ?)`,
    [device_id, (body.hostname || '').slice(0, 80), meta.country, expiresAt])

  await logActivity(env, { action: 'trial_start', device_id, ip: meta.ip, country: meta.country })

  const token = await signLicenseToken(
    { device_id, scope: 'trial', trial_expires_at: expiresAt },
    trialDays * 86400,
    env.JWT_SECRET
  )
  return json({ ok: true, token, kind: 'trial', expires_at: expiresAt })
}

/* ──────────────────────────────────────────────────────────────────
   POST /api/v1/activate
   Body: { key, fingerprint, hostname }
   ────────────────────────────────────────────────────────────────── */
export async function activate(req, env, body, meta) {
  const ks = await getKillSwitch(env)
  if (ks.active) return json({ ok: false, error: 'service unavailable' }, 503)

  const rawKey = normalizeKey(body.key)
  if (!isValidKeyFormat(rawKey)) return json({ ok: false, error: 'bad_key_format' }, 400)

  const device_id = await deviceIdFromFingerprint(env, body.fingerprint)
  if (!device_id) return json({ ok: false, error: 'bad fingerprint' }, 400)

  const key_hash = await hmacSha256(env.KEY_PEPPER, rawKey)
  const license = await db.get(env, 'SELECT * FROM licenses WHERE key_hash = ?', [key_hash])

  if (!license) {
    await logActivity(env, { action: 'activate_invalid', device_id, ip: meta.ip, country: meta.country, details: { prefix: keyPrefix(rawKey) } })
    return json({ ok: false, error: 'invalid_key' }, 404)
  }
  if (license.status !== 'active') {
    await logActivity(env, { action: 'activate_revoked', license_id: license.id, device_id, ip: meta.ip })
    return json({ ok: false, error: 'revoked' }, 403)
  }
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return json({ ok: false, error: 'expired' }, 403)
  }

  // Reap inactive seats first
  await reapInactiveSeats(env, license.id)

  // Is this device already on this license?
  const existing = await db.get(env,
    `SELECT * FROM devices WHERE license_id = ? AND device_id = ?`,
    [license.id, device_id])

  if (existing) {
    // Re-activation: just refresh last_seen and possibly re-activate booted device if seats free
    if (existing.status === 'booted') {
      // Need a free seat to reactivate
      const seatsUsed = await db.get(env,
        `SELECT COUNT(*) AS n FROM devices WHERE license_id = ? AND status = 'active'`,
        [license.id])
      if ((seatsUsed?.n || 0) >= license.max_seats) {
        return json({
          ok: false, error: 'seat_full',
          seats_used: seatsUsed.n, seats_max: license.max_seats,
        }, 403)
      }
      await db.run(env,
        `UPDATE devices SET status = 'active', last_seen = datetime('now') WHERE id = ?`,
        [existing.id])
    } else {
      await db.run(env, `UPDATE devices SET last_seen = datetime('now') WHERE id = ?`, [existing.id])
    }
  } else {
    // New device — check seat limit
    const seatsUsed = await db.get(env,
      `SELECT COUNT(*) AS n FROM devices WHERE license_id = ? AND status = 'active'`,
      [license.id])
    if ((seatsUsed?.n || 0) >= license.max_seats) {
      await logActivity(env, { action: 'activate_seat_full', license_id: license.id, device_id, ip: meta.ip })
      return json({
        ok: false, error: 'seat_full',
        seats_used: seatsUsed.n, seats_max: license.max_seats,
      }, 403)
    }
    await db.run(env, `INSERT INTO devices (license_id, device_id, label, ip_country)
                       VALUES (?, ?, ?, ?)`,
      [license.id, device_id, (body.hostname || '').slice(0, 80), meta.country])
  }

  // Issue license token
  const ttlHours = parseInt(env.TOKEN_TTL_HOURS || '24', 10)
  const token = await signLicenseToken(
    { license_id: license.id, device_id, scope: 'license' },
    ttlHours * 3600,
    env.JWT_SECRET
  )
  const seatsUsed = await db.get(env,
    `SELECT COUNT(*) AS n FROM devices WHERE license_id = ? AND status = 'active'`,
    [license.id])

  await logActivity(env, { action: 'activate', license_id: license.id, device_id, ip: meta.ip, country: meta.country })

  return json({
    ok: true, token, kind: 'license',
    seats_used: seatsUsed.n, seats_max: license.max_seats,
  })
}

/* ──────────────────────────────────────────────────────────────────
   POST /api/v1/check
   Body: { token, fingerprint }
   ────────────────────────────────────────────────────────────────── */
export async function check(req, env, body, meta) {
  const ks = await getKillSwitch(env)
  if (ks.active) return json({ ok: false, error: 'kill_switch_active' }, 503)

  let payload
  try {
    payload = await verifyToken(body.token, env.JWT_SECRET)
  } catch (_) {
    return json({ ok: false, error: 'invalid_token' }, 401)
  }
  if (payload.kind !== 'license') return json({ ok: false, error: 'wrong_token_kind' }, 401)

  const device_id = await deviceIdFromFingerprint(env, body.fingerprint)
  if (!device_id || device_id !== payload.device_id) {
    return json({ ok: false, error: 'device_mismatch' }, 401)
  }

  // Trial path
  if (payload.scope === 'trial') {
    const t = await db.get(env, 'SELECT * FROM trials WHERE device_id = ?', [device_id])
    if (!t || t.status !== 'active' || new Date(t.expires_at) < new Date()) {
      return json({ ok: false, error: 'trial_expired' }, 403)
    }
    return json({ ok: true, kind: 'trial', expires_at: t.expires_at })
  }

  // Licensed path
  const license = await db.get(env, 'SELECT * FROM licenses WHERE id = ?', [payload.license_id])
  if (!license || license.status !== 'active') return json({ ok: false, error: 'revoked' }, 403)
  if (license.expires_at && new Date(license.expires_at) < new Date()) {
    return json({ ok: false, error: 'expired' }, 403)
  }

  const dev = await db.get(env,
    `SELECT * FROM devices WHERE license_id = ? AND device_id = ?`,
    [license.id, device_id])
  if (!dev || dev.status !== 'active') return json({ ok: false, error: 'device_booted' }, 403)

  // Refresh last_seen
  await db.run(env, `UPDATE devices SET last_seen = datetime('now') WHERE id = ?`, [dev.id])

  return json({
    ok: true, kind: 'license',
    seats_max: license.max_seats,
  })
}

/* ──────────────────────────────────────────────────────────────────
   POST /api/v1/action-token
   Body: { token, action }
   Issues a short-lived (10 min) token specifically required for
   sensitive operations (e.g. starting a hunt). The app must include
   this token in the hunt-start IPC call.
   ────────────────────────────────────────────────────────────────── */
export async function actionToken(req, env, body, meta) {
  let payload
  try { payload = await verifyToken(body.token, env.JWT_SECRET) }
  catch (_) { return json({ ok: false, error: 'invalid_token' }, 401) }

  const action = String(body.action || '').slice(0, 50)
  if (!/^[a-z_]+$/.test(action)) return json({ ok: false, error: 'bad_action' }, 400)

  const ttlMin = parseInt(env.ACTION_TOKEN_TTL_MINUTES || '10', 10)
  const actionTok = await signActionToken(
    { license_id: payload.license_id, device_id: payload.device_id, action, scope: payload.scope },
    ttlMin * 60,
    env.JWT_SECRET
  )
  return json({ ok: true, action_token: actionTok, ttl_seconds: ttlMin * 60 })
}
