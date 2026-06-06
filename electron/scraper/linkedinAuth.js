const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const { humanDelay } = require('./humanizer')

// Resolve the bundled Chromium executable that ships inside the installer at
// resources/pw-browsers (electron-builder extraResources). We pass this path
// straight to chromium.launch() so we never depend on PLAYWRIGHT_BROWSERS_PATH
// resolution timing — the #1 cause of "Executable doesn't exist …ms-playwright…"
// on packaged builds. In dev, returns undefined so Playwright uses the browser
// installed by `npx playwright install`.
function resolveChromeExecutable() {
  if (process.env.NODE_ENV === 'development') return undefined
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.resourcesPath ? path.join(process.resourcesPath, 'pw-browsers') : null)
  if (!base) return undefined
  try {
    const dirs = fs.readdirSync(base)
    // Prefer the headed Chromium build (not the headless shell).
    const chromiumDir = dirs.find(d => /^chromium-\d+$/.test(d))
      || dirs.find(d => d.startsWith('chromium-') && !d.includes('headless'))
    if (chromiumDir) {
      const exe = path.join(base, chromiumDir, 'chrome-win64', 'chrome.exe')
      if (fs.existsSync(exe)) return exe
    }
    // Fallback: search a few levels deep for chrome.exe.
    const found = findFileShallow(base, 'chrome.exe', 4)
    if (found) return found
    console.warn('[login] bundled Chromium not found under', base)
  } catch (e) {
    console.warn('[login] could not resolve bundled Chromium:', e.message)
  }
  return undefined
}

function findFileShallow(dir, name, depth) {
  if (depth < 0) return null
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return null }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const r = findFileShallow(path.join(dir, e.name), name, depth - 1)
      if (r) return r
    }
  }
  return null
}

const LINKEDIN_FEED = 'https://www.linkedin.com/feed/'

// LinkedIn's session-bearing cookie. If we have this set on the .linkedin.com
// domain, we are logged in — regardless of which page LinkedIn happens to
// land us on after sign-in (feed / in/me / checkpoint redirect / etc.)
const SESSION_COOKIE = 'li_at'

/**
 * Open a visible Chromium window for the user to log into LinkedIn manually.
 * Detects success by watching for the `li_at` session cookie, NOT by matching
 * the URL pattern — LinkedIn redirects to many different paths after sign-in
 * (feed, in/me/, checkpoint, "save login info" interstitial, etc.) and any
 * URL-based check is fragile.
 */
async function loginAccount(accountName, onProgress) {
  const log = (m) => { try { onProgress?.(m) } catch (_) {}; console.log('[login]', m) }
  let browser
  try {
    log('Launching browser window...')
    browser = await chromium.launch({
      headless: false,
      executablePath: resolveChromeExecutable(),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
    })

    // Stealth tweaks BEFORE any navigation
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] })
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      window.chrome = { runtime: {} }
    })

    const page = await context.newPage()

    log('Loading LinkedIn login page...')
    // Use 'load' instead of 'networkidle' — LinkedIn login page never goes
    // fully idle (constant tracking pings) so networkidle would hang forever.
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'load', timeout: 30000 })

    log('Waiting for you to sign in (up to 5 minutes)...')
    log('TIP: Even if LinkedIn shows "Save login info" or a security check, just keep going.')

    // Poll for the li_at cookie every 1.5s. Once we have it on .linkedin.com,
    // the user is signed in — regardless of what page they're currently on.
    const TIMEOUT_MS = 5 * 60 * 1000
    const start = Date.now()
    let lastUrl = ''
    let liAt = null

    while (Date.now() - start < TIMEOUT_MS) {
      const cookies = await context.cookies('https://www.linkedin.com').catch(() => [])
      liAt = cookies.find(c => c.name === SESSION_COOKIE && c.value && c.value.length > 10)
      if (liAt) break

      const url = page.url()
      if (url !== lastUrl) {
        lastUrl = url
        log(`Currently on: ${url}`)
      }

      // Also detect if the user closed the browser window — Playwright fires
      // a 'close' event on context but we check defensively
      if (page.isClosed()) {
        return { success: false, error: 'You closed the login window before signing in.' }
      }

      await humanDelay(1500, 1500)
    }

    if (!liAt) {
      await browser.close().catch(() => {})
      return { success: false, error: 'Login timed out after 5 minutes. Try again.' }
    }

    log('Session cookie detected — capturing all cookies...')
    await humanDelay(1500, 2500)

    // Capture ALL cookies (li_at alone isn't enough — LinkedIn checks
    // JSESSIONID, bcookie, etc. for some endpoints)
    const cookies = await context.cookies()

    // Try to pull the email from the profile API (best-effort, may fail)
    let email = accountName
    try {
      log('Resolving account email...')
      const profileResp = await page.evaluate(async () => {
        const r = await fetch('/voyager/api/me', { credentials: 'include', headers: { 'csrf-token': 'ajax:' } })
        if (!r.ok) return null
        return r.json()
      })
      if (profileResp) {
        // Voyager response has miniProfile with publicIdentifier
        const m = profileResp.miniProfile || profileResp.elements?.[0] || profileResp
        if (m?.publicIdentifier) email = m.publicIdentifier
        if (m?.emailAddress) email = m.emailAddress
        if (profileResp.emailAddress) email = profileResp.emailAddress
      }
    } catch (_) {}

    log(`Captured ${cookies.length} cookies, session valid`)
    await browser.close().catch(() => {})
    return { success: true, cookies, email }

  } catch (err) {
    console.error('[login] error:', err)
    if (browser) await browser.close().catch(() => {})
    return { success: false, error: err.message }
  }
}

/**
 * Creates a Playwright browser context with saved cookies injected.
 * `headless` defaults to false (visible) for scraping so users can see and
 * intervene if LinkedIn shows a captcha mid-scrape.
 */
async function createAuthenticatedContext(cookies, { headless = false } = {}) {
  const browser = await chromium.launch({
    headless,
    executablePath: resolveChromeExecutable(),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 850 },
    locale: 'en-US',
  })

  await context.addCookies(cookies)

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    window.chrome = { runtime: {} }
  })

  return { browser, context }
}

/**
 * Checks if a saved session is still valid by checking for li_at cookie + a
 * quick feed visit. Uses headless mode (background check, no UI flicker).
 */
async function checkSession(cookiesStr) {
  let browser
  try {
    const cookies = typeof cookiesStr === 'string' ? JSON.parse(cookiesStr) : cookiesStr
    // Quick local check: do we even have li_at?
    const li_at = cookies.find(c => c.name === SESSION_COOKIE && c.value && c.value.length > 10)
    if (!li_at) return false

    // Live check: hit /feed/ in headless mode and see if we get redirected
    const { browser: b, context } = await createAuthenticatedContext(cookies, { headless: true })
    browser = b
    const page = await context.newPage()
    await page.goto(LINKEDIN_FEED, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const url = page.url()
    await browser.close()
    return !/\/login|\/authwall|\/checkpoint/.test(url)
  } catch (err) {
    if (browser) await browser.close().catch(() => {})
    return false
  }
}

module.exports = { loginAccount, createAuthenticatedContext, checkSession, SESSION_COOKIE }
