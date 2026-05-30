#!/usr/bin/env node
/**
 * Calls the live API's /admin/bootstrap endpoint to create the FIRST admin.
 *
 * Usage:
 *   $env:SERVER_URL = "https://linkedin-hunter-api.<sub>.workers.dev"
 *   $env:BOOTSTRAP_TOKEN = "<paste-from-set-secrets-output>"
 *   node scripts/create-admin.js --email you@example.com --password 'StrongPass!'
 */

import { parseArgs } from 'node:util'

const args = parseArgs({
  options: {
    email:    { type: 'string' },
    password: { type: 'string' },
    url:      { type: 'string' },
  },
})

const email    = args.values.email
const password = args.values.password
const baseUrl  = args.values.url || process.env.SERVER_URL
const token    = process.env.BOOTSTRAP_TOKEN

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js --email you@example.com --password \'StrongPass!\'')
  process.exit(1)
}
if (!baseUrl) {
  console.error('Set SERVER_URL env var (e.g. https://linkedin-hunter-api.<sub>.workers.dev)')
  process.exit(1)
}
if (!token) {
  console.error('Set BOOTSTRAP_TOKEN env var (from set-secrets output)')
  process.exit(1)
}

const res = await fetch(baseUrl.replace(/\/$/, '') + '/admin/bootstrap', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password, token }),
})
const raw = await res.text()
let data = null
try { data = JSON.parse(raw) } catch (_) {}

if (data && data.ok) {
  console.log('✓ Admin created:', email)
  console.log('  You can now log in at the admin panel.')
} else if (data && data.error) {
  console.error('✗ Failed:', data.error)
  process.exit(1)
} else {
  console.error('✗ Server returned non-JSON response (HTTP ' + res.status + ')')
  console.error('Raw response (first 500 chars):')
  console.error(raw.slice(0, 500))
  console.error('\nMost common cause: schema not applied. Run:')
  console.error('  npm run db:schema')
  process.exit(1)
}
