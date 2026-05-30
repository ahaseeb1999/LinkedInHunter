/**
 * License API client — talks to the Cloudflare Worker.
 *
 * Every request is HMAC-signed with API_HMAC_SECRET. The server rejects
 * unsigned or expired requests, so a cracker can't just hit the endpoints
 * without the embedded secret.
 *
 * Built on Node's global fetch (Node 18+, Electron 31+ ships with it).
 */

const crypto = require('crypto')
const { API_BASE, API_HMAC_SECRET } = require('./constants')

function signRequest(bodyText) {
  const ts = Date.now()
  const sig = crypto.createHmac('sha256', API_HMAC_SECRET)
    .update(ts + bodyText)
    .digest('hex')
  return { ts, sig }
}

async function call(path, body, { timeoutMs = 15000 } = {}) {
  const bodyText = JSON.stringify(body || {})
  const { ts, sig } = signRequest(bodyText)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-timestamp': String(ts),
        'x-signature': sig,
      },
      body: bodyText,
      signal: ac.signal,
    })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch (_) {}
    if (!data) return { ok: false, error: 'non_json', status: res.status, raw: text.slice(0, 200) }
    return { ...data, _status: res.status }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: 'timeout' }
    return { ok: false, error: 'network', message: e.message }
  } finally {
    clearTimeout(timer)
  }
}

/* ──────────────────────────────────────────────────────────────────
   High-level helpers — one per endpoint
   ────────────────────────────────────────────────────────────────── */

/** Bind a license key to this device. Returns license token on success. */
async function activate({ key, fingerprint, hostname }) {
  return call('/api/v1/activate', { key, fingerprint, hostname })
}

/** Start the 3-day free trial for this device. */
async function startTrial({ fingerprint, hostname }) {
  return call('/api/v1/trial/start', { fingerprint, hostname })
}

/** Heartbeat — am I still allowed? */
async function check({ token, fingerprint }) {
  return call('/api/v1/check', { token, fingerprint })
}

/** Get a short-lived permission token for a specific sensitive action. */
async function actionToken({ token, action }) {
  return call('/api/v1/action-token', { token, action })
}

module.exports = { activate, startTrial, check, actionToken, call, signRequest }
