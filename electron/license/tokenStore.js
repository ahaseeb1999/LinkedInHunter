/**
 * Encrypted persistence of the license token + metadata.
 *
 * Uses Electron's safeStorage API, which on Windows wraps Microsoft DPAPI
 * (Data Protection API). The encryption key is derived from the user's
 * Windows account — so a token copied to a different PC / different
 * Windows user is useless.
 *
 * Storage shape (JSON):
 *   {
 *     token:         "<JWT from server>",
 *     kind:          "trial" | "license",
 *     expires_at:    "<ISO>"   (trial expiry, or null for licenses)
 *     last_check_at: "<ISO>",
 *     activated_at:  "<ISO>",
 *     prefix:        "LH-A3X7"  (display only — never the full key)
 *   }
 */

const fs = require('fs')
const path = require('path')

let safeStorage = null
try {
  ;({ safeStorage } = require('electron'))
} catch (_) {
  // Not running in Electron (e.g. unit test) — caller can use the plain path
}

function getTokenPath() {
  let userData
  try {
    const { app } = require('electron')
    userData = app.getPath('userData')
  } catch (_) {
    userData = path.join(__dirname, '../../data')
  }
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true })
  return path.join(userData, 'license.dat')
}

function isEncryptionAvailable() {
  try { return safeStorage?.isEncryptionAvailable?.() === true }
  catch (_) { return false }
}

/** Persist the license payload, encrypted if possible. */
function saveToken(payload) {
  const json = JSON.stringify(payload)
  const target = getTokenPath()
  if (isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(json)
    fs.writeFileSync(target, buf)
  } else {
    // Fallback: plain JSON. Mark with a header so we can tell on load.
    fs.writeFileSync(target, 'PLAIN:' + json)
  }
}

/** Load the saved license payload (or null if absent / unreadable). */
function loadToken() {
  const target = getTokenPath()
  if (!fs.existsSync(target)) return null
  try {
    const buf = fs.readFileSync(target)
    // Plain-JSON fallback
    if (buf.length > 6 && buf.slice(0, 6).toString() === 'PLAIN:') {
      return JSON.parse(buf.slice(6).toString())
    }
    if (!isEncryptionAvailable()) return null  // can't decrypt — pretend missing
    const json = safeStorage.decryptString(buf)
    return JSON.parse(json)
  } catch (e) {
    console.warn('[tokenStore] read failed:', e.message)
    return null
  }
}

function clearToken() {
  const target = getTokenPath()
  try { fs.unlinkSync(target) } catch (_) {}
}

module.exports = {
  saveToken, loadToken, clearToken,
  isEncryptionAvailable, getTokenPath,
}
