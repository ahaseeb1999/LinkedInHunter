/**
 * License-system constants for the Electron app.
 *
 * IMPORTANT — API_HMAC_SECRET:
 *   This MUST be the same value that's in Cloudflare Workers Secrets
 *   (env.API_HMAC_SECRET on the server). If you rotated it, set both sides.
 *
 *   In production builds (Phase E), this constant is replaced at build time
 *   by GitHub Actions with the current secret, and the JS is obfuscated.
 *   For now it sits in plain code — fine for local development.
 */

// Override-able via env var so CI can inject without editing this file.
const API_BASE = process.env.LH_API_BASE
  || 'https://linkedin-hunter-api.linkedinhunter.workers.dev'

// ⚠ DO NOT commit the real secret here. The real value comes from the
// LH_API_HMAC_SECRET env var, injected at build time by GitHub Actions
// from a repo Secret. For LOCAL `npm run dev`, create a file called
// `.env.local` (gitignored) with: LH_API_HMAC_SECRET=<your-secret>
// and load it via your shell, or set the env var directly in PowerShell:
//   $env:LH_API_HMAC_SECRET = "your-secret-here"
const API_HMAC_SECRET = process.env.LH_API_HMAC_SECRET
  || 'NOT_CONFIGURED_set_LH_API_HMAC_SECRET_env_var_or_GitHub_Secret'

// How long we treat a cached token as "valid" without re-checking the server
// (for offline tolerance). After this, we require server contact.
const OFFLINE_GRACE_HOURS = 24

// Heartbeat interval — how often we silently re-check with the server while
// the app is running.
const HEARTBEAT_INTERVAL_MINUTES = 60 * 4   // every 4 hours

module.exports = {
  API_BASE,
  API_HMAC_SECRET,
  OFFLINE_GRACE_HOURS,
  HEARTBEAT_INTERVAL_MINUTES,
}
