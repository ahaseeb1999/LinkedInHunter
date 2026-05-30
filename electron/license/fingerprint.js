/**
 * Build a stable per-device fingerprint from hardware/OS signals.
 *
 * The fingerprint is sent to the server, which HMACs it with DEVICE_PEPPER
 * before storing. So the server never sees the raw signals — only an
 * unrecoverable hash that's stable per machine.
 *
 * Stable across:
 *   - app restarts
 *   - app reinstalls
 *   - Windows updates
 *
 * Changes only when:
 *   - hostname changes
 *   - CPU swapped
 *   - NIC changes (rare on desktops)
 */

const os = require('os')
const crypto = require('crypto')

function getMacAddress() {
  const ifaces = os.networkInterfaces()
  const macs = []
  for (const list of Object.values(ifaces)) {
    for (const iface of list || []) {
      if (iface.internal) continue
      if (!iface.mac || iface.mac === '00:00:00:00:00:00') continue
      macs.push(iface.mac)
    }
  }
  macs.sort()
  return macs[0] || 'no-mac'
}

function getDeviceFingerprint() {
  const parts = [
    os.hostname(),
    (os.cpus()[0]?.model || 'unknown-cpu').trim(),
    String(os.cpus().length),
    String(os.totalmem()),
    os.arch(),
    os.platform(),
    getMacAddress(),
  ]
  // SHA-256 over the joined parts. Server will HMAC this again with its pepper.
  return crypto.createHash('sha256').update(parts.join('||')).digest('hex')
}

/** Friendly label for the device — shown in the admin panel device list. */
function getDeviceLabel() {
  return os.hostname() || 'Unknown'
}

module.exports = { getDeviceFingerprint, getDeviceLabel }
