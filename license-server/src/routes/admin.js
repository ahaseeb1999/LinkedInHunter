/**
 * Admin-facing routes — backing API for the admin panel.
 *
 * Every endpoint (except /admin/login and /admin/bootstrap) requires a
 * valid session cookie. The session is server-side and instantly revokable.
 */

import { db, logActivity, getKillSwitch } from '../lib/db.js'
import { hmacSha256, aesEncrypt, aesDecrypt } from '../lib/crypto.js'
import {
  authenticateAdmin, createAdminSession, destroyAdminSession,
  requireAdmin, buildSessionCookie, clearSessionCookie, getSessionCookie,
  bootstrapFirstAdmin,
} from '../lib/auth.js'
import { generateRawKey, keyPrefix } from '../lib/keys.js'

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  })

/* ──────────────────────────────────────────────────────────────────
   POST /admin/bootstrap — first-admin bootstrap (run ONCE per server)
   Body: { email, password, token }
   Token must match ADMIN_BOOTSTRAP_TOKEN secret.
   ────────────────────────────────────────────────────────────────── */
export async function bootstrap(req, env, body) {
  const result = await bootstrapFirstAdmin(env, body.email, body.password, body.token)
  if (!result.ok) return json(result, 403)
  return json(result)
}

/* ──────────────────────────────────────────────────────────────────
   POST /admin/login
   Body: { email, password }
   ────────────────────────────────────────────────────────────────── */
export async function login(req, env, body, meta) {
  const admin = await authenticateAdmin(env, body.email, body.password)
  if (!admin) {
    await logActivity(env, { action: 'admin_login_failed', ip: meta.ip, country: meta.country, details: { email: body.email } })
    return json({ ok: false, error: 'invalid_credentials' }, 401)
  }
  const sess = await createAdminSession(env, admin.id, meta.ip, req.headers.get('user-agent'))
  await logActivity(env, { action: 'admin_login', ip: meta.ip, country: meta.country, details: { admin_id: admin.id } })
  return json(
    {
      ok: true,
      email: admin.email,
      role: admin.role,
      // Returned for the admin panel to store as Bearer token (cross-origin)
      token: sess.id,
      expires_in: sess.ttlSeconds,
    },
    200,
    { 'set-cookie': buildSessionCookie(sess.id, sess.ttlSeconds) }
  )
}

/* ──────────────────────────────────────────────────────────────────
   POST /admin/logout
   ────────────────────────────────────────────────────────────────── */
export async function logout(req, env) {
  const sessId = getSessionCookie(req)
  await destroyAdminSession(env, sessId)
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() })
}

/* ──────────────────────────────────────────────────────────────────
   GET /admin/api/me
   ────────────────────────────────────────────────────────────────── */
export async function me(req, env) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  return json({ ok: true, email: admin.email, role: admin.role })
}

/* ──────────────────────────────────────────────────────────────────
   GET /admin/api/licenses
   Returns: [{ id, key_prefix, name, max_seats, seats_used, status, created_at }]
   ────────────────────────────────────────────────────────────────── */
export async function listLicenses(req, env) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)

  const rows = await db.all(env, `
    SELECT
      l.id, l.key_prefix, l.name, l.max_seats, l.status, l.expires_at, l.notes,
      l.created_at, l.updated_at,
      (SELECT COUNT(*) FROM devices d WHERE d.license_id = l.id AND d.status = 'active') AS seats_used
    FROM licenses l
    ORDER BY l.created_at DESC
  `)
  return json({ ok: true, licenses: rows })
}

/* ──────────────────────────────────────────────────────────────────
   POST /admin/api/licenses
   Body: { name?, max_seats?, expires_at?, notes? }
   Returns: { ok, key (RAW — shown once), id }
   ────────────────────────────────────────────────────────────────── */
export async function createLicense(req, env, body) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)

  const max_seats = parseInt(body.max_seats || env.DEFAULT_SEATS || '10', 10)
  if (max_seats < 1 || max_seats > 10_000) return json({ ok: false, error: 'bad_max_seats' }, 400)

  const rawKey = generateRawKey()
  const key_hash = await hmacSha256(env.KEY_PEPPER, rawKey)
  const prefix = keyPrefix(rawKey)
  const name = (body.name || '').toString().slice(0, 80) || null
  const notes = (body.notes || '').toString().slice(0, 500) || null
  const expires_at = body.expires_at || null

  // Encrypt the raw key for later reveal. If KEY_ENCRYPTION_KEY isn't set,
  // we skip and the key is hash-only (can't be revealed later).
  let key_encrypted = null
  if (env.KEY_ENCRYPTION_KEY) {
    try { key_encrypted = await aesEncrypt(rawKey, env.KEY_ENCRYPTION_KEY) }
    catch (e) { console.warn('[createLicense] encrypt failed:', e.message) }
  }

  const r = await db.run(env, `
    INSERT INTO licenses (key_hash, key_prefix, key_encrypted, name, max_seats, expires_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [key_hash, prefix, key_encrypted, name, max_seats, expires_at, notes])

  await logActivity(env, { action: 'license_created', license_id: r.meta?.last_row_id, details: { name, max_seats, by: admin.id } })

  return json({
    ok: true,
    id: r.meta?.last_row_id,
    key: rawKey,  // SHOWN ONCE. Admin must copy now — never retrievable again.
    key_prefix: prefix,
    max_seats, name,
  })
}

/* ──────────────────────────────────────────────────────────────────
   DELETE /admin/api/licenses/:id
   Permanently deletes a license + all its devices (ON DELETE CASCADE).
   Activity-log entries referencing this license_id become dangling
   (history records keep the id but the row is gone) — intentional.
   ────────────────────────────────────────────────────────────────── */
export async function deleteLicense(req, env, _body, params) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  const id = parseInt(params.id, 10)

  const existing = await db.get(env, 'SELECT id, key_prefix, name FROM licenses WHERE id = ?', [id])
  if (!existing) return json({ ok: false, error: 'not_found' }, 404)

  await db.run(env, 'DELETE FROM licenses WHERE id = ?', [id])
  await logActivity(env, {
    action: 'license_deleted',
    license_id: id,
    details: { by: admin.id, key_prefix: existing.key_prefix, name: existing.name },
  })
  return json({ ok: true })
}

/* ──────────────────────────────────────────────────────────────────
   GET /admin/api/licenses/:id/reveal
   Decrypts and returns the raw license key — only works if the key was
   created AFTER encryption was enabled. Older keys return { ok: false,
   error: 'not_available' }.
   ────────────────────────────────────────────────────────────────── */
export async function revealLicense(req, env, _body, params) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)

  const id = parseInt(params.id, 10)
  const row = await db.get(env, 'SELECT key_encrypted, key_prefix FROM licenses WHERE id = ?', [id])
  if (!row) return json({ ok: false, error: 'not_found' }, 404)
  if (!row.key_encrypted) {
    return json({ ok: false, error: 'not_available', message: 'This key was created before key-reveal was enabled — only newly-created keys can be revealed.' }, 404)
  }
  if (!env.KEY_ENCRYPTION_KEY) {
    return json({ ok: false, error: 'server_misconfig', message: 'KEY_ENCRYPTION_KEY secret missing' }, 500)
  }

  try {
    const raw = await aesDecrypt(row.key_encrypted, env.KEY_ENCRYPTION_KEY)
    await logActivity(env, { action: 'license_revealed', license_id: id, details: { by: admin.id } })
    return json({ ok: true, key: raw, key_prefix: row.key_prefix })
  } catch (e) {
    console.error('[reveal] decrypt failed:', e.message)
    return json({ ok: false, error: 'decrypt_failed' }, 500)
  }
}

/* ──────────────────────────────────────────────────────────────────
   PATCH /admin/api/licenses/:id
   Body: { name?, max_seats?, status?, expires_at?, notes? }
   ────────────────────────────────────────────────────────────────── */
export async function updateLicense(req, env, body, params) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)

  const id = parseInt(params.id, 10)
  const updates = []
  const values = []

  if (body.name !== undefined)       { updates.push('name = ?'); values.push(body.name.toString().slice(0, 80) || null) }
  if (body.max_seats !== undefined)  {
    const n = parseInt(body.max_seats, 10)
    if (n < 1 || n > 10_000) return json({ ok: false, error: 'bad_max_seats' }, 400)
    updates.push('max_seats = ?'); values.push(n)
  }
  if (body.status !== undefined)     {
    if (!['active', 'revoked'].includes(body.status)) return json({ ok: false, error: 'bad_status' }, 400)
    updates.push('status = ?'); values.push(body.status)
  }
  if (body.expires_at !== undefined) { updates.push('expires_at = ?'); values.push(body.expires_at || null) }
  if (body.notes !== undefined)      { updates.push('notes = ?'); values.push(body.notes.toString().slice(0, 500) || null) }

  if (updates.length === 0) return json({ ok: false, error: 'nothing_to_update' }, 400)
  updates.push("updated_at = datetime('now')")
  values.push(id)

  await db.run(env, `UPDATE licenses SET ${updates.join(', ')} WHERE id = ?`, values)
  await logActivity(env, { action: 'license_updated', license_id: id, details: { by: admin.id, fields: Object.keys(body) } })
  return json({ ok: true })
}

/* ──────────────────────────────────────────────────────────────────
   GET /admin/api/licenses/:id/devices
   ────────────────────────────────────────────────────────────────── */
export async function listDevices(req, env, _body, params) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  const id = parseInt(params.id, 10)
  const rows = await db.all(env,
    `SELECT id, device_id, label, ip_country, first_seen, last_seen, status
     FROM devices WHERE license_id = ? ORDER BY last_seen DESC`,
    [id])
  return json({ ok: true, devices: rows })
}

/* ──────────────────────────────────────────────────────────────────
   DELETE /admin/api/licenses/:id/devices/:device_id
   "Boot" a single device — frees its seat.
   ────────────────────────────────────────────────────────────────── */
export async function bootDevice(req, env, _body, params) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  const id = parseInt(params.id, 10)
  await db.run(env,
    `UPDATE devices SET status = 'booted' WHERE license_id = ? AND device_id = ?`,
    [id, params.device_id])
  await logActivity(env, { action: 'device_booted', license_id: id, device_id: params.device_id, details: { by: admin.id } })
  return json({ ok: true })
}

/* ──────────────────────────────────────────────────────────────────
   POST /admin/api/licenses/:id/boot-all
   Boot every device on the license (key stays active).
   ────────────────────────────────────────────────────────────────── */
export async function bootAllDevices(req, env, _body, params) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  const id = parseInt(params.id, 10)
  const r = await db.run(env,
    `UPDATE devices SET status = 'booted' WHERE license_id = ? AND status = 'active'`,
    [id])
  await logActivity(env, { action: 'license_boot_all', license_id: id, details: { by: admin.id, count: r.meta?.changes } })
  return json({ ok: true, devices_booted: r.meta?.changes || 0 })
}

/* ──────────────────────────────────────────────────────────────────
   POST /admin/api/kill-switch
   Body: { reason? }
   ────────────────────────────────────────────────────────────────── */
export async function activateKillSwitch(req, env, body) {
  const admin = await requireAdmin(env, req)
  if (!admin || admin.role !== 'super') return json({ ok: false, error: 'forbidden' }, 403)
  await db.run(env,
    `UPDATE kill_switch SET active = 1, activated_at = datetime('now'),
     activated_by = ?, reason = ? WHERE id = 1`,
    [admin.id, (body.reason || '').toString().slice(0, 200) || null])
  await logActivity(env, { action: 'kill_switch_on', details: { by: admin.id, reason: body.reason } })
  return json({ ok: true })
}

/* ──────────────────────────────────────────────────────────────────
   DELETE /admin/api/kill-switch
   ────────────────────────────────────────────────────────────────── */
export async function deactivateKillSwitch(req, env) {
  const admin = await requireAdmin(env, req)
  if (!admin || admin.role !== 'super') return json({ ok: false, error: 'forbidden' }, 403)
  await db.run(env, `UPDATE kill_switch SET active = 0, activated_at = NULL, reason = NULL WHERE id = 1`)
  await logActivity(env, { action: 'kill_switch_off', details: { by: admin.id } })
  return json({ ok: true })
}

/* ──────────────────────────────────────────────────────────────────
   GET /admin/api/activity?limit=100
   ────────────────────────────────────────────────────────────────── */
export async function listActivity(req, env) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  const url = new URL(req.url)
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10))
  const rows = await db.all(env,
    `SELECT id, ts, action, license_id, device_id, ip, country, details
     FROM activity ORDER BY id DESC LIMIT ?`, [limit])
  return json({ ok: true, activity: rows })
}

/* ──────────────────────────────────────────────────────────────────
   GET /admin/api/stats — high-level counters for the dashboard header
   ────────────────────────────────────────────────────────────────── */
export async function stats(req, env) {
  const admin = await requireAdmin(env, req)
  if (!admin) return json({ ok: false }, 401)
  const [licenses, activeLicenses, devices, activeDevices, trials, ks] = await Promise.all([
    db.get(env, `SELECT COUNT(*) AS n FROM licenses`),
    db.get(env, `SELECT COUNT(*) AS n FROM licenses WHERE status = 'active'`),
    db.get(env, `SELECT COUNT(*) AS n FROM devices`),
    db.get(env, `SELECT COUNT(*) AS n FROM devices WHERE status = 'active'`),
    db.get(env, `SELECT COUNT(*) AS n FROM trials WHERE datetime(expires_at) > datetime('now')`),
    getKillSwitch(env),
  ])
  return json({
    ok: true,
    licenses_total: licenses.n,
    licenses_active: activeLicenses.n,
    devices_total: devices.n,
    devices_active: activeDevices.n,
    active_trials: trials.n,
    kill_switch_active: !!ks.active,
  })
}
