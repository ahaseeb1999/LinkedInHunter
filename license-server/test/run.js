/**
 * Test runner for the license server library code.
 * (Routes are integration-tested against a deployed instance separately.)
 */

import { webcrypto } from 'node:crypto'
if (!globalThis.crypto) globalThis.crypto = webcrypto

let pass = 0, fail = 0
const test = async (name, fn) => {
  try { await fn(); console.log('  PASS ' + name); pass++ }
  catch (e) { console.log('  FAIL ' + name + ' -- ' + e.message); fail++ }
}
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`) }
const ok = (v, m) => { if (!v) throw new Error(m) }

async function main() {
  console.log('\n[crypto helpers]')
  const cryptoLib = await import('../src/lib/crypto.js')
  await test('hmacSha256 deterministic + 64 hex chars', async () => {
    const h1 = await cryptoLib.hmacSha256('pepper-test', 'LH-XXXX-YYYY-ZZZZ')
    const h2 = await cryptoLib.hmacSha256('pepper-test', 'LH-XXXX-YYYY-ZZZZ')
    eq(h1, h2, 'deterministic')
    eq(h1.length, 64, 'hex length 64')
    ok(/^[a-f0-9]+$/.test(h1), 'hex only')
  })
  await test('hmacSha256 different pepper → different hash', async () => {
    const a = await cryptoLib.hmacSha256('pepperA', 'X')
    const b = await cryptoLib.hmacSha256('pepperB', 'X')
    ok(a !== b, 'different')
  })
  await test('sha256 deterministic', async () => {
    const a = await cryptoLib.sha256('hello')
    const b = await cryptoLib.sha256('hello')
    eq(a, b, 'deterministic')
    eq(a.length, 64, '64 hex')
  })
  await test('randomHex unique', () => {
    const a = cryptoLib.randomHex(16)
    const b = cryptoLib.randomHex(16)
    ok(a !== b, 'different')
    eq(a.length, 32, '32 hex chars from 16 bytes')
  })
  await test('timingSafeEqual same/different', () => {
    eq(cryptoLib.timingSafeEqual('abc', 'abc'), true)
    eq(cryptoLib.timingSafeEqual('abc', 'abd'), false)
    eq(cryptoLib.timingSafeEqual('abc', 'abcd'), false)
  })
  await test('hashPassword + verifyPassword roundtrip', async () => {
    const hash = await cryptoLib.hashPassword('s3cret!', 'admin-pepper')
    ok(await cryptoLib.verifyPassword('s3cret!', 'admin-pepper', hash), 'verifies')
    ok(!(await cryptoLib.verifyPassword('wrong', 'admin-pepper', hash)), 'rejects wrong')
    ok(!(await cryptoLib.verifyPassword('s3cret!', 'wrong-pepper', hash)), 'rejects wrong pepper')
  })

  console.log('\n[keys]')
  const keysLib = await import('../src/lib/keys.js')
  await test('generateRawKey format', () => {
    const k = keysLib.generateRawKey()
    ok(keysLib.isValidKeyFormat(k), 'matches format: ' + k)
    // LH(2) + 3 groups of "-XXXX"(5 each) = 17 chars
    eq(k.length, 17, '17 chars total: LH-XXXX-XXXX-XXXX')
    eq(k.slice(0, 3), 'LH-', 'starts with LH-')
  })
  await test('keys are unique', () => {
    const set = new Set()
    for (let i = 0; i < 100; i++) set.add(keysLib.generateRawKey())
    eq(set.size, 100, '100 unique keys')
  })
  await test('isValidKeyFormat strict', () => {
    eq(keysLib.isValidKeyFormat('LH-A2B3-C4D5-E6F7'), true, 'valid')
    eq(keysLib.isValidKeyFormat('lh-a2b3-c4d5-e6f7'), true, 'lowercase ok')
    eq(keysLib.isValidKeyFormat('LH-OOOO-IIII-LLLL'), false, 'forbidden chars rejected')
    eq(keysLib.isValidKeyFormat('LH-A2B3-C4D5'), false, 'too short')
    eq(keysLib.isValidKeyFormat('XX-A2B3-C4D5-E6F7'), false, 'wrong prefix')
  })
  await test('normalizeKey', () => {
    eq(keysLib.normalizeKey('  lh-a2b3-c4d5-e6f7  '), 'LH-A2B3-C4D5-E6F7', 'trim + upper')
  })
  await test('keyPrefix returns LH-XXXX', () => {
    eq(keysLib.keyPrefix('LH-A2B3-C4D5-E6F7'), 'LH-A2B3', 'prefix')
  })

  console.log('\n[jwt]')
  const jwtLib = await import('../src/lib/jwt.js')
  await test('signLicenseToken + verifyToken roundtrip', async () => {
    const tok = await jwtLib.signLicenseToken({ license_id: 1, device_id: 'dev1' }, 3600, 'super-secret-test')
    const payload = await jwtLib.verifyToken(tok, 'super-secret-test')
    eq(payload.license_id, 1, 'license_id')
    eq(payload.device_id, 'dev1', 'device_id')
    eq(payload.kind, 'license', 'kind=license')
  })
  await test('action token has kind=action', async () => {
    const tok = await jwtLib.signActionToken({ license_id: 1, action: 'hunt_start' }, 600, 'secret')
    const payload = await jwtLib.verifyToken(tok, 'secret')
    eq(payload.kind, 'action', 'kind=action')
    eq(payload.action, 'hunt_start', 'action carried')
  })
  await test('wrong secret rejects token', async () => {
    const tok = await jwtLib.signLicenseToken({ x: 1 }, 3600, 'right')
    let threw = false
    try { await jwtLib.verifyToken(tok, 'wrong') } catch (_) { threw = true }
    ok(threw, 'verification threw')
  })
  await test('expired token rejects', async () => {
    const tok = await jwtLib.signLicenseToken({ x: 1 }, -10, 'secret')
    let threw = false
    try { await jwtLib.verifyToken(tok, 'secret') } catch (_) { threw = true }
    ok(threw, 'expired token rejected')
  })

  console.log('\n──────────────────────────────────────────')
  console.log(`TOTAL PASSED: ${pass}`)
  console.log(`TOTAL FAILED: ${fail}`)
  console.log('──────────────────────────────────────────')
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
