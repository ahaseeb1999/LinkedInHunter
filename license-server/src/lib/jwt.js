/**
 * JWT signing/verification for app license tokens.
 *
 * After successful activation, the server issues a signed JWT that proves
 * the device is licensed. The app saves it locally (DPAPI-encrypted) and
 * presents it on every API call.
 *
 * We use `jose` because it has zero Node dependencies and runs in Workers.
 */

import { SignJWT, jwtVerify } from 'jose'

const encoder = new TextEncoder()

/**
 * Sign a license-session JWT.
 *   payload: { license_id, device_id }
 *   ttl: lifetime in seconds (e.g. 24 * 3600)
 */
export async function signLicenseToken(payload, ttlSeconds, secret) {
  const key = encoder.encode(secret)
  return new SignJWT({ ...payload, kind: 'license' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key)
}

/**
 * Short-lived action token. Required for sensitive operations (running a
 * hunt). Even if a cracker bypasses the LOCAL license check, the action
 * token is server-issued and can't be forged.
 */
export async function signActionToken(payload, ttlSeconds, secret) {
  const key = encoder.encode(secret)
  return new SignJWT({ ...payload, kind: 'action' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key)
}

/**
 * Verify a JWT. Throws if invalid/expired/tampered. Returns the payload.
 */
export async function verifyToken(token, secret) {
  const key = encoder.encode(secret)
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
  return payload
}
