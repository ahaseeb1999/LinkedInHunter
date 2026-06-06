#!/usr/bin/env node
/**
 * Bakes the real API HMAC secret into electron/license/constants.js before
 * packaging.
 *
 * Why this exists:
 *   constants.js ships with a PLACEHOLDER fallback secret. It reads
 *   process.env.LH_API_HMAC_SECRET, but that env var only exists during the
 *   CI build — NOT on a user's machine at runtime. So without this step the
 *   packaged app falls back to the placeholder and the license server rejects
 *   every request with "bad signature" (trial AND license activation fail).
 *
 *   This script replaces the placeholder with the real secret value at build
 *   time, so the literal is compiled into the app. It runs AFTER `vite build`
 *   and BEFORE `npm run obfuscate`, so the baked secret then gets string-array
 *   obfuscated along with the rest of the file (light protection).
 *
 * Env:
 *   LH_API_HMAC_SECRET  (required in CI) — must equal the Cloudflare Worker
 *                       secret API_HMAC_SECRET, or signatures won't match.
 *   LH_API_BASE         (optional) — overrides the default API base URL.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PLACEHOLDER = 'NOT_CONFIGURED_set_LH_API_HMAC_SECRET_env_var_or_GitHub_Secret'
const CONSTANTS = path.join(__dirname, '..', 'electron', 'license', 'constants.js')

const secret = process.env.LH_API_HMAC_SECRET

if (!secret || secret.trim() === '') {
  if (process.env.CI) {
    console.error('\n✗ inject-secret: LH_API_HMAC_SECRET is not set in CI.')
    console.error('  Refusing to build — the app would ship with a placeholder secret')
    console.error('  and every license/trial request would fail with "bad signature".')
    console.error('  Set the LH_API_HMAC_SECRET GitHub repo secret (it MUST equal the')
    console.error('  Cloudflare Worker API_HMAC_SECRET), then re-run the release.\n')
    process.exit(1)
  }
  console.log('inject-secret: LH_API_HMAC_SECRET not set — leaving placeholder (local build).')
  process.exit(0)
}

let src = fs.readFileSync(CONSTANTS, 'utf8')

if (!src.includes(PLACEHOLDER)) {
  console.warn('inject-secret: placeholder not found in constants.js (already injected?). Skipping.')
  process.exit(0)
}

src = src.split(PLACEHOLDER).join(secret)
fs.writeFileSync(CONSTANTS, src)

// Print a NON-secret fingerprint so the build log can be verified against the
// expected value without ever exposing the secret. (A sha256 prefix + length
// can't be reversed.) Compare these in the Actions log to confirm the right
// secret was baked.
const fp = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 16)
console.log(`✓ inject-secret: baked API_HMAC_SECRET (length=${secret.length}, sha256=${fp})`)
