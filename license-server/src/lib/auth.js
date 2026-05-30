/**
 * Admin authentication — session-based with server-side revocation.
 *
 * Why sessions, not JWTs:
 *   - We need instant revocation. Sessions can be deleted from DB
 *     immediately; JWTs are valid until they expire on their own.
 *   - Admin scope is small, so DB lookup per request isn't a bottleneck.
 *
 * Session cookie: `lh_admin_sess`, HttpOnly, Secure, SameSite=Strict.
 */

import { db, logActivity } from './db.js'
import { hashPassword, verifyPassword, randomHex, timingSafeEqual } from './crypto.js'

const SESSION_TTL_HOURS = 24
const COOKIE_NAME = 'lh_admin_sess'

/**
 * Read the session token from either the Authorization header (preferred for
 * cross-origin admin panel) or the session cookie (fallback for same-origin).
 */
export function getSessionCookie(req) {
  // Authorization: Bearer <sessionId>
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.match(/^Bearer\s+([a-f0-9]{64})$/i)
  if (bearer) return bearer[1]
  // Cookie fallback
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))
  return m ? m[1] : null
}

/** Build a session-cookie Set-Cookie header value. */
export function buildSessionCookie(value, ttlSeconds) {
  const expires = new Date(Date.now() + ttlSeconds * 1000).toUTCString()
  return `${COOKIE_NAME}=${value}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Strict`
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

/* ──────────────────────────────────────────────────────────────────
   Sign in / out
   ────────────────────────────────────────────────────────────────── */
export async function authenticateAdmin(env, email, password) {
  if (!email || !password) return null
  const row = await db.get(env, 'SELECT * FROM admins WHERE email = ?', [email.toLowerCase().trim()])
  if (!row) return null

  const ok = await verifyPassword(password, env.ADMIN_PEPPER, row.password_hash)
  if (!ok) return null

  // Update last_login (best-effort)
  await db.run(env, 'UPDATE admins SET last_login = datetime("now") WHERE id = ?', [row.id]).catch(() => {})

  return { id: row.id, email: row.email, role: row.role }
}

export async function createAdminSession(env, adminId, ip, ua) {
  const sessId = randomHex(32)
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString()
  await db.run(
    env,
    `INSERT INTO admin_sessions (id, admin_id, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?)`,
    [sessId, adminId, expiresAt, ip || null, ua || null]
  )
  return { id: sessId, ttlSeconds: SESSION_TTL_HOURS * 3600 }
}

export async function destroyAdminSession(env, sessId) {
  if (!sessId) return
  await db.run(env, 'DELETE FROM admin_sessions WHERE id = ?', [sessId])
}

/* ──────────────────────────────────────────────────────────────────
   requireAdmin — middleware. Returns the admin object or null.
   ────────────────────────────────────────────────────────────────── */
export async function requireAdmin(env, req) {
  const sessId = getSessionCookie(req)
  if (!sessId) return null
  // 64-char hex is the expected format — bail early on weird input
  if (!/^[a-f0-9]{64}$/.test(sessId)) return null

  const row = await db.get(
    env,
    `SELECT s.*, a.email, a.role
     FROM admin_sessions s
     JOIN admins a ON a.id = s.admin_id
     WHERE s.id = ? AND datetime(s.expires_at) > datetime('now')`,
    [sessId]
  )
  if (!row) return null
  return { id: row.admin_id, email: row.email, role: row.role, sessionId: sessId }
}

/* ──────────────────────────────────────────────────────────────────
   Bootstrap: create the FIRST admin if no admins exist yet.
   Triggered automatically on first call to /admin/bootstrap with
   the ADMIN_BOOTSTRAP_TOKEN secret. After that, admins are created
   via the admin panel.
   ────────────────────────────────────────────────────────────────── */
export async function bootstrapFirstAdmin(env, email, password, token) {
  if (!env.ADMIN_BOOTSTRAP_TOKEN || !timingSafeEqual(token || '', env.ADMIN_BOOTSTRAP_TOKEN)) {
    return { ok: false, error: 'invalid bootstrap token' }
  }
  const existing = await db.get(env, 'SELECT COUNT(*) AS n FROM admins')
  if (existing && existing.n > 0) return { ok: false, error: 'admin already exists' }

  const hash = await hashPassword(password, env.ADMIN_PEPPER)
  await db.run(env, 'INSERT INTO admins (email, password_hash, role) VALUES (?, ?, ?)', [
    email.toLowerCase().trim(), hash, 'super',
  ])
  return { ok: true, email }
}
