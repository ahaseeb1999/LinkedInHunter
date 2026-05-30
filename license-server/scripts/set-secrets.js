#!/usr/bin/env node
/**
 * Generates strong random values for every Cloudflare Workers secret used
 * by this server, then sets them via the wrangler CLI.
 *
 * Run: npm run secrets:set
 *
 * IMPORTANT: This requires `wrangler login` to be done first.
 */

import { randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'

const SECRETS = [
  'KEY_PEPPER',
  'DEVICE_PEPPER',
  'JWT_SECRET',
  'ADMIN_PEPPER',
  'API_HMAC_SECRET',
  'ADMIN_BOOTSTRAP_TOKEN',
]

const gen = () => randomBytes(48).toString('hex')

console.log('Setting Cloudflare Workers secrets...\n')
const savedValues = {}

for (const name of SECRETS) {
  const value = gen()
  savedValues[name] = value
  try {
    execSync(`wrangler secret put ${name}`, {
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
    })
    console.log('  ✓ ' + name)
  } catch (e) {
    console.error('  ✗ ' + name + ' FAILED:', e.message)
    process.exit(1)
  }
}

console.log('\n──────────────────────────────────────────────')
console.log('✅ All secrets set in Cloudflare.\n')
console.log('IMPORTANT — copy these somewhere safe (you need them later):\n')
console.log('  API_HMAC_SECRET:       ' + savedValues.API_HMAC_SECRET)
console.log('  ADMIN_BOOTSTRAP_TOKEN: ' + savedValues.ADMIN_BOOTSTRAP_TOKEN)
console.log('\n(The peppers and JWT_SECRET don\'t need to leave Cloudflare — only the server uses them.)')
console.log('──────────────────────────────────────────────')
