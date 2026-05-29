/**
 * Hashtag-based post discovery.
 *
 * URL: https://www.linkedin.com/feed/hashtag/?keywords=<tag>
 *
 * Hashtag pages have a higher density of intent-driven posts (hiring,
 * job-seeking, project announcements) than generic keyword search, because
 * authors use hashtags specifically to broadcast intent.
 *
 * Approach: visit the hashtag page, scroll a few pages, reuse the same
 * behavioral post extractor as the HTML scraper.
 */

const { humanDelay, randomInt } = require('./humanizer')
const { wanderRandomly, hoverAndDwell } = require('./mouseHuman')

function keywordToHashtag(keyword) {
  // "React Native" → "reactnative"
  // "data scientist" → "datascientist"
  return (keyword || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 50)
}

function buildHashtagUrl(keyword) {
  const tag = keywordToHashtag(keyword)
  return `https://www.linkedin.com/feed/hashtag/?keywords=${encodeURIComponent(tag)}`
}

/**
 * The extraction logic is the same as the HTML post scraper's — we hand it
 * the function to call. This avoids duplicating the scoring rubric.
 */
async function scrapeHashtag(page, { keyword, maxResults = 25, control, onProgress, extractPostCards }) {
  const log = (m) => onProgress?.(m)
  const stopped = () => control?.isStopped()

  const url = buildHashtagUrl(keyword)
  log(`🏷  Hashtag source: ${url}`)

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (e) {
    log(`   ⚠ Slow load: ${e.message}`)
  }

  // Auth check
  if (/\/login|\/authwall|\/checkpoint/.test(page.url())) {
    log('   ❌ Hashtag page rejected (session invalid)')
    return []
  }

  // Wait for posts
  await page.waitForSelector('.feed-shared-update-v2, [data-urn], a[href*="/in/"]', { timeout: 15000 }).catch(() => null)
  await humanDelay(1500, 2500)

  const seen = new Set()
  const out = []
  let scrolls = 0
  const maxScrolls = 10

  while (out.length < maxResults && scrolls < maxScrolls && !stopped()) {
    await control?.checkpoint()

    const cards = await extractPostCards(page)
    for (const post of cards) {
      if (out.length >= maxResults) break
      const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...post, _source: 'hashtag' })
    }
    log(`   ↳ ${out.length}/${maxResults} from hashtag (round ${scrolls + 1})`)

    if (out.length >= maxResults) break

    await wanderRandomly(page).catch(() => {})
    await page.evaluate(() => window.scrollBy(0, randomInt ? randomInt(600, 1200) : 800))
      .catch(() => page.evaluate(() => window.scrollBy(0, 900)).catch(() => {}))
    await humanDelay(1200, 2000)
    scrolls++
  }

  return out
}

module.exports = { scrapeHashtag, buildHashtagUrl, keywordToHashtag }
