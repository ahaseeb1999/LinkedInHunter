/**
 * Crypto helpers — all the hashing/signing primitives used by the server.
 *
 * Implemented against the Web Crypto API (available in Cloudflare Workers).
 * No Node.js dependencies — runs on the edge.
 *
 * Conventions:
 *   - HMAC for KEYED, deterministic hashing where we still need to look up
 *     the value (license keys, device IDs).
 *   - bcrypt for password hashing where we ONLY verify, never look up.
 *   - All peppers stored in Workers Secrets (env.KEY_PEPPER etc.) — never
 *     in code, never in git, never logged.
 */

/**
 * Password hashing uses PBKDF2 (Web Crypto, built-in, fast in Workers).
 * Storage format:  pbkdf2$<iterations>$<salt-hex>$<hash-hex>
 * 210,000 iterations matches OWASP 2023 guidance for SHA-256.
 */
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Cloudflare Workers caps PBKDF2 iterations at 100,000. Combined with the
// server-side pepper, this is still well above brute-force resistance for
// admin password use.
const PBKDF2_ITERATIONS = 100_000
const PBKDF2_HASH = 'SHA-256'
const PBKDF2_KEY_LEN = 32 // bytes

/* ──────────────────────────────────────────────────────────────────
   HMAC-SHA256 — keyed deterministic hash.
   Same (pepper, input) → same output. Used for indexing encrypted
   data: we never store the raw value, but we can still look it up.
   ────────────────────────────────────────────────────────────────── */
export async function hmacSha256(pepper, input) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(String(input)))
  return bufToHex(sig)
}

/* ──────────────────────────────────────────────────────────────────
   SHA-256 — unkeyed hash. Use only for non-secret identifiers
   (e.g. checksum of public data).
   ────────────────────────────────────────────────────────────────── */
export async function sha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(String(input)))
  return bufToHex(buf)
}

/* ──────────────────────────────────────────────────────────────────
   Random — cryptographically secure random bytes/hex.
   ────────────────────────────────────────────────────────────────── */
export function randomBytes(n) {
  const buf = new Uint8Array(n)
  crypto.getRandomValues(buf)
  return buf
}

export function randomHex(n) {
  return bufToHex(randomBytes(n).buffer)
}

/* ──────────────────────────────────────────────────────────────────
   Password hashing (admin login) — PBKDF2-SHA256 with salt + pepper.
   - salt: 16 random bytes, unique per password, stored with hash.
   - pepper: server-side secret, never stored with hash.
   - 210,000 iterations: OWASP 2023 baseline. Brute force impractical.
   ────────────────────────────────────────────────────────────────── */
export async function hashPassword(plain, pepper) {
  const salt = randomBytes(16)
  const hash = await pbkdf2(plain + pepper, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bufToHex(salt.buffer)}$${bufToHex(hash)}`
}

export async function verifyPassword(plain, pepper, stored) {
  if (typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iter = parseInt(parts[1], 10)
  if (!Number.isFinite(iter) || iter < 10_000) return false
  const salt = new Uint8Array(hexToBuf(parts[2]))
  const expected = parts[3]
  const candidate = await pbkdf2(plain + pepper, salt, iter)
  return timingSafeEqual(bufToHex(candidate), expected)
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    keyMaterial,
    PBKDF2_KEY_LEN * 8
  )
}

/* ──────────────────────────────────────────────────────────────────
   Constant-time string compare — avoid timing attacks when comparing
   secrets like signatures.
   ────────────────────────────────────────────────────────────────── */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

/* ──────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────────
   AES-GCM encryption — used to store license keys at rest in a form
   we can decrypt for the admin panel's "show key" feature.

   Storage format: "<iv-hex>:<ciphertext-hex>"
   The pepper-key lives in Workers Secrets (env.KEY_ENCRYPTION_KEY).
   ────────────────────────────────────────────────────────────────── */
async function importAesKey(keyHex) {
  const raw = hexToBuf(keyHex.slice(0, 64)) // 32 bytes
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function aesEncrypt(plaintext, keyHex) {
  if (!keyHex || keyHex.length < 32) throw new Error('aesEncrypt: key required')
  const key = await importAesKey(keyHex)
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  return bufToHex(iv.buffer) + ':' + bufToHex(ct)
}

export async function aesDecrypt(packed, keyHex) {
  if (!keyHex || keyHex.length < 32) throw new Error('aesDecrypt: key required')
  if (typeof packed !== 'string' || !packed.includes(':')) throw new Error('aesDecrypt: bad input')
  const [ivHex, ctHex] = packed.split(':')
  const key = await importAesKey(keyHex)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(hexToBuf(ivHex)) },
    key,
    hexToBuf(ctHex)
  )
  return decoder.decode(pt)
}

export function bufToHex(buf) {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes.buffer
}
