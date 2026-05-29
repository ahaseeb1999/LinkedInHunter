/**
 * Personal-feed source — scrape the logged-in user's own feed.
 *
 * URL: https://www.linkedin.com/feed/
 *
 * LinkedIn's home feed surfaces posts from the user's network including
 * hiring posts from connections. We scrape it and filter for matches to
 * the user's keywords, so we catch hiring opportunities the user's network
 * is sharing but might not surface in keyword search.
 */

const { humanDelay } = require('./humanizer')
const { wanderRandomly } = require('./mouseHuman')

const FEED_URL = 'https://www.linkedin.com/feed/'

/**
 * Scrape the user's feed. Filter to posts whose content/headline matches
 * any of the user's keywords (case-insensitive substring).
 */
async function scrapeFeed(page, { keywords = [], maxResults = 25, control, onProgress, extractPostCards }) {
  const log = (m) => onProgress?.(m)
  const stopped = () => control?.isStopped()

  log(`📰 Feed source: ${FEED_URL}`)

  try {
    await page.goto(FEED_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (e) {
    log(`   ⚠ Slow load: ${e.message}`)
  }

  if (/\/login|\/authwall|\/checkpoint/.test(page.url())) {
    log('   ❌ Feed rejected (session invalid)')
    return []
  }

  await page.waitForSelector('.feed-shared-update-v2, [data-urn], a[href*="/in/"]', { timeout: 15000 }).catch(() => null)
  await humanDelay(2000, 3500)

  // Normalize keywords for matching
  const kwLower = keywords.map(k => (k || '').toLowerCase()).filter(Boolean)
  const matchesAnyKeyword = (text) => {
    const t = (text || '').toLowerCase()
    return kwLower.some(k => t.includes(k))
  }

  const seen = new Set()
  const out = []
  let scrolls = 0
  const maxScrolls = 12

  while (out.length < maxResults && scrolls < maxScrolls && !stopped()) {
    await control?.checkpoint()

    const cards = await extractPostCards(page)
    for (const post of cards) {
      if (out.length >= maxResults) break
      const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)

      // Feed has many irrelevant posts — keyword-filter aggressively here.
      // We're already in the "additional source" lane, so being strict is OK.
      if (kwLower.length > 0 && !matchesAnyKeyword(post.content) && !matchesAnyKeyword(post.author_headline)) {
        continue
      }
      out.push({ ...post, _source: 'feed' })
    }
    log(`   ↳ ${out.length}/${maxResults} from feed (round ${scrolls + 1})`)

    if (out.length >= maxResults) break

    await wanderRandomly(page).catch(() => {})
    await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {})
    await humanDelay(1200, 2000)
    scrolls++
  }

  return out
}

module.exports = { scrapeFeed, FEED_URL }
