const { createAuthenticatedContext } = require('./linkedinAuth')
const { humanDelay } = require('./humanizer')

const STOPWORDS = new Set([
  'and','the','of','to','in','for','on','at','with','as','a','an','is','are','be',
  'or','from','by','our','your','that','this','it','we','you','i','me','my','his','her',
  'they','their','them','its','was','were','will','can','have','has','had','do','does',
  'done','over','under','more','most','some','any','all','about','also',
])

/**
 * Visit /in/me/ (auto-redirected to the logged-in user) and pull headline,
 * about, skills, and recent experience titles. Returns suggested keywords.
 */
async function analyzeProfile({ cookies, profileUrl = 'https://www.linkedin.com/in/me/', onProgress, headless = false }) {
  const log = (m) => onProgress?.(m)
  let browser
  try {
    log('🌐 Launching browser to analyze profile...')
    const { browser: b, context } = await createAuthenticatedContext(
      typeof cookies === 'string' ? JSON.parse(cookies) : cookies,
      { headless }
    )
    browser = b
    const page = await context.newPage()

    log(`🔎 Loading: ${profileUrl}`)
    try {
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
    } catch (e) {
      log(`⚠ Page load slow — continuing`)
    }

    const finalUrl = page.url()
    if (/\/login|\/authwall|\/checkpoint/.test(finalUrl)) {
      await browser.close().catch(() => {})
      return { success: false, error: 'Session invalid — re-add the account' }
    }

    log('   ↳ Resolved profile URL: ' + finalUrl)

    // Scroll a bit so lazy-loaded sections render
    await page.evaluate(() => window.scrollBy(0, 800))
    await humanDelay(800, 1500)
    await page.evaluate(() => window.scrollBy(0, 1200))
    await humanDelay(800, 1500)

    const data = await page.evaluate(() => {
      const pickText = (...selectors) => {
        for (const s of selectors) {
          try {
            const el = document.querySelector(s)
            const t = el?.innerText?.trim() || el?.textContent?.trim()
            if (t) return t
          } catch (_) {}
        }
        return ''
      }

      const name = pickText(
        'h1.text-heading-xlarge',
        'main h1',
        '.pv-text-details__left-panel h1',
        'h1',
      )

      const headline = pickText(
        '.text-body-medium.break-words',
        '.pv-text-details__left-panel .text-body-medium',
        '.top-card-layout__headline',
      )

      const location = pickText(
        '.text-body-small.inline.t-black--light.break-words',
        '.pv-text-details__left-panel .text-body-small',
      )

      const about = pickText(
        '#about ~ * .display-flex.full-width span[aria-hidden="true"]',
        'section[data-section="summary"] p',
        '.pv-about__summary-text span[aria-hidden="true"]',
        '#about ~ div span[aria-hidden="true"]',
        'div.inline-show-more-text--is-collapsed span[aria-hidden="true"]',
      )

      // Experience: most recent job titles
      const experience = []
      try {
        const items = document.querySelectorAll(
          'section[data-section="experience"] li, ' +
          '#experience ~ * li, ' +
          'main section li.artdeco-list__item'
        )
        items.forEach(li => {
          const title = li.querySelector('span[aria-hidden="true"]')?.innerText?.trim()
          const sub   = li.querySelectorAll('span[aria-hidden="true"]')[1]?.innerText?.trim()
          if (title && title.length < 120 && !/^Skills?:/.test(title)) {
            experience.push({ title, sub: sub || '' })
          }
        })
      } catch (_) {}

      // Skills section
      const skills = []
      try {
        const skillEls = document.querySelectorAll(
          'section[data-section="skills"] li span[aria-hidden="true"], ' +
          '#skills ~ * li span[aria-hidden="true"]'
        )
        skillEls.forEach(el => {
          const s = el.innerText?.trim()
          if (s && s.length < 60 && !s.includes('endorsement')) skills.push(s)
        })
      } catch (_) {}

      return { name, headline, location, about, experience: experience.slice(0, 8), skills: skills.slice(0, 30) }
    })

    await browser.close().catch(() => {})

    // Derive suggested search keywords from the profile data
    const suggestions = deriveKeywords(data)

    log(`✅ Profile analyzed — ${suggestions.length} suggested keywords`)
    return { success: true, profile: data, suggestions }
  } catch (err) {
    console.error('Profile scraper error:', err)
    if (browser) await browser.close().catch(() => {})
    return { success: false, error: err.message }
  }
}

function deriveKeywords({ headline, about, experience, skills }) {
  const candidates = []

  // 1) Headline is the strongest signal — split on " | " or " - "
  if (headline) {
    headline.split(/\s*[|·•\-–—]\s*/).forEach(part => {
      const p = part.trim()
      if (p && p.length > 3 && p.length < 60) candidates.push({ text: p, weight: 5 })
    })
  }

  // 2) Most recent experience titles
  ;(experience || []).slice(0, 3).forEach((e, i) => {
    if (e.title && e.title.length < 60) candidates.push({ text: e.title, weight: 4 - i })
  })

  // 3) Top skills (each one alone, plus combined with role hints)
  ;(skills || []).slice(0, 12).forEach(s => {
    if (s && s.length < 40) candidates.push({ text: s, weight: 2 })
  })

  // 4) Phrases from "about" — pull noun-ish bigrams
  if (about) {
    const words = about
      .toLowerCase()
      .replace(/[^a-z0-9+#./ -]/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
    // Bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const bg = `${words[i]} ${words[i + 1]}`
      if (bg.length < 35) candidates.push({ text: bg, weight: 0.5 })
    }
  }

  // De-dupe by lowercased text, sum weights, sort by weight, take top 8
  const tally = new Map()
  candidates.forEach(({ text, weight }) => {
    const key = text.toLowerCase().trim()
    if (!key) return
    tally.set(key, (tally.get(key) || 0) + weight)
  })

  return Array.from(tally.entries())
    .map(([k, w]) => ({ text: k.replace(/\b\w/g, c => c.toUpperCase()), weight: w }))
    .filter(s => s.text.length >= 4)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map(s => s.text)
}

module.exports = { analyzeProfile, deriveKeywords }
