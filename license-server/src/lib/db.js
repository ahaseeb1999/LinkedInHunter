/**
 * D1 query helpers — typed wrappers around Cloudflare D1 bindings.
 */

export const db = {
  async get(env, sql, params = []) {
    const stmt = env.DB.prepare(sql).bind(...params)
    return stmt.first()
  },
  async all(env, sql, params = []) {
    const stmt = env.DB.prepare(sql).bind(...params)
    const r = await stmt.all()
    return r.results || []
  },
  async run(env, sql, params = []) {
    const stmt = env.DB.prepare(sql).bind(...params)
    return stmt.run()
  },
  async batch(env, statements) {
    return env.DB.batch(statements)
  },
}

/** Log an activity row. Never throws (logging is best-effort). */
export async function logActivity(env, { action, license_id, device_id, ip, country, details }) {
  try {
    await db.run(
      env,
      `INSERT INTO activity (action, license_id, device_id, ip, country, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        action,
        license_id || null,
        device_id || null,
        ip || null,
        country || null,
        details ? JSON.stringify(details) : null,
      ]
    )
  } catch (e) {
    console.warn('[activity] log failed:', e.message)
  }
}

/** Read the kill-switch row. Returns { active, activated_at, reason } */
export async function getKillSwitch(env) {
  return db.get(env, 'SELECT * FROM kill_switch WHERE id = 1') || { active: 0 }
}
