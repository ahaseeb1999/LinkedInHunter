/**
 * Detect LinkedIn rate-limiting / shadow-banning signals.
 *
 * LinkedIn rarely returns a clean 429. Instead it does any of:
 *   1. Redirect to /checkpoint/challenge/... (forced security check)
 *   2. Show an interstitial page with "We've noticed unusual activity"
 *   3. Silently return empty search results despite a valid session
 *   4. Sometimes a real 429 on Voyager API
 *   5. Authwall redirect (session cookie revoked)
 */

const SHADOW_BAN_TEXTS = [
  "we've noticed",
  "unusual activity",
  "please wait",
  "we're sorry",
  "verify it's you",
  "security verification",
  "too many requests",
  "let's do a quick security check",
]

/**
 * Inspect a Playwright page and classify whether we're being rate-limited.
 * Returns { limited: bool, kind: string|null, evidence: string }.
 */
async function detectRateLimit(page) {
  try {
    const url = page.url()

    // Hard redirects
    if (/\/checkpoint\/challenge/.test(url)) {
      return { limited: true, kind: 'checkpoint', evidence: 'redirected to /checkpoint/challenge' }
    }
    if (/\/uas\/login|\/authwall/.test(url)) {
      return { limited: true, kind: 'authwall', evidence: 'redirected to login/authwall' }
    }
    if (/\/checkpoint\//.test(url)) {
      return { limited: true, kind: 'checkpoint', evidence: 'on checkpoint page: ' + url }
    }

    // Body text scans
    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 5000).toLowerCase()).catch(() => '')
    for (const phrase of SHADOW_BAN_TEXTS) {
      if (bodyText.includes(phrase)) {
        return { limited: true, kind: 'interstitial', evidence: `matched "${phrase}"` }
      }
    }

    // Check for empty results despite being on a search page
    if (/\/search\/results\//.test(url)) {
      const noResultsBanner = bodyText.includes('no results') || bodyText.includes('try different keywords')
      if (noResultsBanner) {
        return { limited: false, kind: 'no-results', evidence: 'LinkedIn reports no results for this query (not rate-limited)' }
      }
    }

    return { limited: false, kind: null, evidence: '' }
  } catch (e) {
    return { limited: false, kind: null, evidence: 'check failed: ' + e.message }
  }
}

/**
 * Inspect a fetch Response (from Voyager API call) for rate-limit signals.
 */
function detectRateLimitInResponse(resp) {
  if (!resp) return { limited: false, kind: null, evidence: 'no response' }
  if (resp.status === 429) return { limited: true, kind: '429', evidence: 'HTTP 429 Too Many Requests' }
  if (resp.status === 403) return { limited: true, kind: '403', evidence: 'HTTP 403 Forbidden' }
  if (resp.status === 401) return { limited: true, kind: 'unauthorized', evidence: 'HTTP 401 — session likely invalid' }
  if (resp.status >= 500)  return { limited: false, kind: 'server-error', evidence: 'HTTP ' + resp.status }
  return { limited: false, kind: null, evidence: '' }
}

/**
 * Back-off scheduler. Tracks consecutive rate-limit hits and returns the
 * next delay (exponentially growing). Caller is responsible for awaiting it.
 */
function createBackoff({ baseMs = 60_000, maxMs = 900_000 } = {}) {
  let consecutive = 0
  return {
    /** Called when a rate-limit hit was detected. Returns ms to wait. */
    hit() {
      consecutive++
      // Exponential: 1m → 2m → 4m → 8m → 15m (capped)
      const wait = Math.min(maxMs, baseMs * Math.pow(2, consecutive - 1))
      return wait
    },
    /** Called when a successful request happened. Resets the counter. */
    reset() { consecutive = 0 },
    count() { return consecutive },
  }
}

module.exports = { detectRateLimit, detectRateLimitInResponse, createBackoff, SHADOW_BAN_TEXTS }
