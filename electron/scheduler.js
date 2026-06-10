/**
 * Scheduled Search — re-runs the user's last hunt on a cron schedule.
 *
 * Important: the schedule only fires while the app is running (including
 * minimized to the tray). It does NOT run when the app is fully closed —
 * there's no OS-level scheduled task. The Settings UI says as much.
 *
 * Dependency-injected (init) so it stays decoupled from main.js and avoids
 * circular requires:
 *   getSettings() -> { scheduledSearch, scheduleCron, lastSearch, ... }
 *   runHunt(params) -> Promise<{ success, results?, error? }>  (manages its own control)
 *   log(msg)
 *   notify(title, body)
 */
const cron = require('node-cron')

let task = null
let deps = null

function init(dependencies) {
  deps = dependencies
}

/**
 * Read settings and (re)create the cron task. Safe to call repeatedly —
 * it tears down any existing task first. Call on startup and whenever
 * settings are saved.
 */
function apply() {
  if (!deps) return
  stop()

  let settings = {}
  try { settings = deps.getSettings() || {} } catch (e) { deps.log('[schedule] getSettings failed: ' + e.message); return }

  if (settings.scheduledSearch !== 'true') {
    deps.log('[schedule] disabled')
    return
  }

  const expr = String(settings.scheduleCron || '').trim()
  if (!cron.validate(expr)) {
    deps.log('[schedule] invalid cron expression, not scheduling: ' + JSON.stringify(expr))
    return
  }

  task = cron.schedule(expr, () => { void fire() })
  deps.log('[schedule] active — will run the last hunt on: ' + expr)
}

async function fire() {
  let settings = {}
  try { settings = deps.getSettings() || {} } catch (_) {}

  let params = null
  try { params = settings.lastSearch ? JSON.parse(settings.lastSearch) : null } catch (_) {}

  if (!params || !params.accountId) {
    deps.log('[schedule] skipped — no previous search saved yet (run one hunt manually first)')
    return
  }

  deps.log('[schedule] running scheduled hunt…')
  try {
    const res = await deps.runHunt(params)
    if (res && res.error === 'busy') {
      deps.log('[schedule] skipped — a hunt is already running')
      return
    }
    const n = res && res.results ? (res.results.jobs.length + res.results.posts.length) : 0
    if (res && res.success) {
      deps.log(`[schedule] done — ${n} result(s)`)
      deps.notify('Scheduled hunt complete', `${n} result(s) found. Open Results to review.`)
    } else {
      deps.log('[schedule] failed: ' + ((res && res.error) || 'unknown'))
      deps.notify('Scheduled hunt failed', (res && (res.error_detail || res.error)) || 'unknown error')
    }
  } catch (e) {
    deps.log('[schedule] error: ' + e.message)
    deps.notify('Scheduled hunt error', e.message)
  }
}

function stop() {
  if (task) {
    try { task.stop() } catch (_) {}
    task = null
  }
}

module.exports = { init, apply, stop }
