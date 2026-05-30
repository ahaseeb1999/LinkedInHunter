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

// Placeholder — replace with the API_HMAC_SECRET printed by
// `npm run secrets:set` (kept here for local dev only).
const API_HMAC_SECRET = process.env.LH_API_HMAC_SECRET
  || '3a09dbaf5cdfe70aaf1bdff341127d0efe31f61bbc36b2fdb5fe07c1fcd2c20f5dae4ce75cc0f2da20dd625376c55499'

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
