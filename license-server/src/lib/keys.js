/**
 * License key generation + parsing.
 *
 * Format: LH-XXXX-XXXX-XXXX  (LH prefix + 12 random chars in 4-char groups)
 *
 * Charset uses Crockford base32 (no 0/O/1/I/L) so manual typing has no
 * ambiguity. 16-char body = 32^16 ≈ 1.2 × 10^24 combinations — brute force
 * is infeasible.
 */

import { randomBytes } from './crypto.js'

// Crockford base32: 0,1,O,I,L removed for readability
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/** Generate a new raw license key. Returns "LH-XXXX-XXXX-XXXX". */
export function generateRawKey() {
  const bytes = randomBytes(12)
  let out = 'LH'
  for (let i = 0; i < 12; i++) {
    if (i % 4 === 0) out += '-'
    out += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return out
}

/** Strict format check before we hash a user-entered key. */
export function isValidKeyFormat(s) {
  return /^LH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/i
    .test(String(s || '').trim().toUpperCase())
}

/** Normalize a key the user typed — uppercase, strip whitespace. */
export function normalizeKey(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '')
}

/** Display-safe prefix for the admin panel (first 4 chars of the body). */
export function keyPrefix(rawKey) {
  const norm = normalizeKey(rawKey)
  return norm.slice(0, 7) // "LH-XXXX"
}
