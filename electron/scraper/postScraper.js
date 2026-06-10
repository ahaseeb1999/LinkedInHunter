/**
 * Post scraper — orchestrator.
 *
 * Architecture (multi-source with Voyager as primary):
 *
 *   For each keyword variant:
 *     1. Try Voyager API (fast, structured JSON, real pagination)
 *        ↳ if it returns posts, great — keep them
 *     2. If Voyager fails or returns nothing AND `useHtmlFallback`,
 *        fall back to HTML scraping the search results page
 *
 *   For each user-enabled supplementary source:
 *     - Hashtag page (/feed/hashtag/?keywords=<tag>)
 *     - Personal feed (/feed/) filtered by keyword
 *
 *   Dedup across everything by (author_url + content prefix).
 *
 *   Persist hunt state after each keyword so a crash can resume.
 */

const path = require('path')
const fs = require('fs')
const { createAuthenticatedContext } = require('./linkedinAuth')
const {
  humanDelay, randomInt,
  humanReadAndScroll, humanMouseWander, humanPageDown,
} = require('./humanizer')
const { wanderRandomly, hoverAndDwell } = require('./mouseHuman')
const { detectRateLimit, createBackoff } = require('./rateLimit')
const { expandKeywords } = require('./keywordExpand')
const { searchPostsViaVoyager } = require('./voyagerApi')
const { scrapeHashtag } = require('./sourceHashtag')
const { scrapeFeed } = require('./sourceFeed')
const huntState = require('./huntState')

const HIRING_SIGNALS = [
  "we're hiring", "we are hiring", "now hiring", "hiring now", "we hire",
  "looking for", "seeking a", "open position", "job opening",
  "join our team", "join us", "we need a", "need a developer",
  "remote opportunity", "remote job", "freelancer needed",
  "freelance opportunity", "dm me", "dm for details",
  "send your cv", "send your resume", "apply now", "apply here",
  "exciting opportunity", "opportunity for", "we have an opening",
  "contract role", "part-time role", "full-time role",
  "urgent requirement", "immediate requirement", "great opportunity",
  "open role", "open roles", "actively hiring",
  "hiring for", "hiring a ", "now recruiting", "recruiting for",
  "remote role", "remote-first", "looking to hire", "join our",
  "we're looking", "we are looking", "team is hiring", "company is hiring",
]

function buildPostSearchURL(keyword, dateRange) {
  const params = new URLSearchParams({
    keywords: keyword,
    sortBy: '"date_posted"',
  })
  if (dateRange === '24h')   params.set('datePosted', '"past-24h"')
  if (dateRange === 'week')  params.set('datePosted', '"past-week"')
  if (dateRange === 'month') params.set('datePosted', '"past-month"')
  return `https://www.linkedin.com/search/results/content/?${params.toString()}`
}

function isHiringPost(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  return HIRING_SIGNALS.some(s => lower.includes(s))
}

function extractLinks(text) {
  if (!text) return []
  const urlRegex = /https?:\/\/[^\s]+/g
  return (text.match(urlRegex) || []).map(l => l.replace(/[.,)>\]]+$/, ''))
}

/* ──────────────────────────────────────────────────────────────────────
   HTML extraction (fallback path) — same algorithm as before but extracted
   into its own function so source modules (hashtag, feed) can reuse it.
   ────────────────────────────────────────────────────────────────────── */
async function extractPostCards(page) {
  return page.evaluate(() => {
    const stats = {
      totalAuthorLinks: 0, candidatesScored: 0,
      rejectedTooShort: 0, rejectedDuplicate: 0, acceptedAsPost: 0,
      rejections: [],
      // Full per-candidate trace — written to debug file when 0 accepted
      allCandidates: [],
    }
    const seen = new Set()
    const posts = []
    const authorLinks = document.querySelectorAll('a[href*="/in/"]')
    stats.totalAuthorLinks = authorLinks.length

    for (const link of authorLinks) {
      let walker = link
      let bestCard = null
      let bestScore = -999
      let bestDiag = null

      // Walk up to 15 levels. We allow up to 3 author links per card
      // (post may mention/quote another user, or show a comment preview),
      // BUT once we have a usable card and crossing further would put us
      // in a multi-post container, stop. Otherwise the walker picks up
      // sibling posts' permalinks and links.
      for (let depth = 0; depth < 15 && walker.parentElement; depth++) {
        walker = walker.parentElement
        const text = (walker.innerText || walker.textContent || '').trim()
        const len = text.length
        const linkCount = walker.querySelectorAll('a[href*="/in/"]').length
        if (linkCount > 3) break

        // If we already have a usable single-author card, don't keep walking
        // into multi-author containers — they're sibling-spanning wrappers.
        if (linkCount > 1 && bestScore >= 4) break

        const hasTime = !!walker.querySelector('time')
        // Also count LinkedIn's custom "relative-time" / "actor__sub-description" elements
        const hasRelativeTime = !!walker.querySelector?.(
          '[class*="relative-time"], [class*="sub-description"], time, ' +
          '[class*="time-stamp"], [class*="post-time"]'
        )
        const urnAttr = (walker.getAttribute?.('data-urn') ||
                         walker.getAttribute?.('data-id') ||
                         walker.getAttribute?.('data-chameleon-result-urn') ||
                         walker.getAttribute?.('data-activity-urn') || '')
        const hasActivityUrn = /activity:\d+/.test(urnAttr)
        const hasPostClass =
          walker.classList?.contains('feed-shared-update-v2') ||
          walker.classList?.contains('update-components-update-v2') ||
          !!walker.querySelector?.('.feed-shared-update-v2, .update-components-update-v2')
        const hasReactionUi = !!walker.querySelector?.(
          'button[aria-label*="reaction"], button[aria-label*="comment"], ' +
          'button[aria-label*="repost"], button[aria-label*="share"], ' +
          '.social-details-social-counts, [class*="social-action"]'
        )
        const hasImage = !!walker.querySelector?.('img, video')

        let score = 0
        // LOWERED thresholds — broader acceptance
        if (len >= 60 && len <= 6000) score += 4
        if (len > 6000) score -= 5
        if (hasTime || hasRelativeTime) score += 4
        if (hasActivityUrn) score += 5
        if (hasPostClass) score += 4
        if (hasReactionUi) score += 3
        if (hasImage) score += 1
        if (linkCount === 1) score += 2

        if (score > bestScore) {
          bestScore = score
          bestCard = walker
          bestDiag = {
            depth, len, linkCount, hasTime, hasRelativeTime, hasActivityUrn,
            hasPostClass, hasReactionUi, hasImage, score,
          }
        }
      }
      stats.candidatesScored++

      // Capture every candidate's outcome for the diagnostic dump
      const authorName = ((link.innerText || link.textContent) || '').trim().slice(0, 60)
      stats.allCandidates.push({ author: authorName, score: bestScore, diag: bestDiag })

      // LOWERED threshold: 4 instead of 6 — many real posts only have
      // (text-in-range + 1-author-link) which scores exactly 6 OR less
      // depending on whether LinkedIn provides a <time> element.
      if (bestScore < 4 || !bestCard) {
        if (stats.rejections.length < 10) {
          stats.rejections.push({ reason: 'low-score', author: authorName, score: bestScore, diag: bestDiag })
        }
        stats.rejectedTooShort++; continue
      }
      if (seen.has(bestCard)) { stats.rejectedDuplicate++; continue }
      seen.add(bestCard)

      const card = bestCard
      const author_name = ((link.innerText || link.textContent) || '').trim().split('\n')[0].slice(0, 80)
      const author_url = link.href

      const timeEl = card.querySelector('time')
      const post_date = timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || ''

      let author_headline = ''
      const subDesc = card.querySelector(
        '.update-components-actor__description, .feed-shared-actor__description, ' +
        '.update-components-actor__sub-description, .entity-result__primary-subtitle'
      )
      if (subDesc) author_headline = (subDesc.innerText || subDesc.textContent || '').trim().slice(0, 200)

      const headlineNorm = (author_headline || '').toLowerCase().replace(/\s+/g, ' ').trim()
      const nameNorm     = (author_name     || '').toLowerCase().trim()
      const isHeadlineText = (t) => {
        if (!t) return true
        const n = t.toLowerCase().replace(/\s+/g, ' ').trim()
        if (headlineNorm && (n === headlineNorm || n.startsWith(headlineNorm.slice(0, 60)))) return true
        if (nameNorm && (n === nameNorm || n.startsWith(nameNorm))) return true
        return false
      }

      let content = ''
      let contentLen = 0
      const bodyCandidates = card.querySelectorAll(
        '.feed-shared-update-v2__description, .feed-shared-update-v2__description-wrapper, ' +
        '.feed-shared-inline-show-more-text, .update-components-text, ' +
        '.update-components-update-v2__commentary, [class*="update-components-text"], [class*="commentary"]'
      )
      for (const c of bodyCandidates) {
        const t = (c.innerText || c.textContent || '').trim()
        if (t.length > contentLen && t.length > 30 && !isHeadlineText(t)) { content = t; contentLen = t.length }
      }
      if (!content) {
        const blocks = card.querySelectorAll('span[dir="ltr"], p, div')
        for (const b of blocks) {
          const t = (b.innerText || b.textContent || '').trim()
          if (t.length > contentLen && t.length > 50 && !isHeadlineText(t)) { content = t; contentLen = t.length }
        }
      }
      content = content.slice(0, 4000)

      // Permalink
      let post_url = ''
      const timeAnchor = timeEl?.closest?.('a')
      if (timeAnchor) {
        const h = timeAnchor.getAttribute('href') || ''
        if (/\/feed\/update\/|\/posts\//.test(h)) post_url = h.startsWith('/') ? 'https://www.linkedin.com' + h : h
      }
      if (!post_url) {
        const a = card.querySelector('a[href*="/feed/update/urn:li:activity:"], a[href*="/posts/"]')
        if (a) { const h = a.getAttribute('href') || ''; post_url = h.startsWith('/') ? 'https://www.linkedin.com' + h : h }
      }
      if (!post_url) {
        let up = card
        for (let i = 0; i < 6 && up; i++) {
          const urn = up.getAttribute?.('data-urn') || up.getAttribute?.('data-id') || up.getAttribute?.('data-chameleon-result-urn') || ''
          const m = urn.match(/urn:li:(activity|ugcPost|share):(\d{4,25})/) || urn.match(/(activity|ugcPost|share)[:_-]?(\d{4,25})/)
          if (m) { post_url = `https://www.linkedin.com/feed/update/urn:li:${m[1]}:${m[2]}/`; break }
          up = up.parentElement
        }
      }
      if (!post_url) {
        const m = (card.outerHTML || '').match(/urn:li:(activity|ugcPost|share):(\d{4,25})/)
        if (m) post_url = `https://www.linkedin.com/feed/update/urn:li:${m[1]}:${m[2]}/`
      }
      // Additional fallback: any anchor href inside the card matching the
      // post-permalink pattern, even if class/structure is unusual
      if (!post_url) {
        const anchors = card.querySelectorAll('a[href]')
        for (const a of anchors) {
          const h = a.getAttribute('href') || ''
          // Match anchor with activity/ugcPost/share URN or LinkedIn post permalink
          const m1 = h.match(/urn:li:(activity|ugcPost|share):(\d{4,25})/)
          if (m1) { post_url = `https://www.linkedin.com/feed/update/urn:li:${m1[1]}:${m1[2]}/`; break }
          if (/^\/posts\/|^https?:\/\/(www\.)?linkedin\.com\/posts\//.test(h)) {
            post_url = h.startsWith('/') ? 'https://www.linkedin.com' + h : h
            break
          }
        }
      }

      // ─── HARVEST EXTERNAL LINKS from the card body ─────────────────
      // Real posts often include URLs as <a href="..."> tags where the
      // visible text is something like "Apply here" — the regex over
      // plain text misses those entirely. Walk every anchor in the card.
      const externalLinks = []
      try {
        const anchors = card.querySelectorAll('a[href^="http"], a[href^="https"]')
        for (const a of anchors) {
          let h = a.getAttribute('href') || ''
          if (!h.startsWith('http')) continue
          // LinkedIn often wraps external URLs in a redirect: /redir/redirect?url=...
          const redirMatch = h.match(/[?&]url=(https?[^&]+)/)
          if (redirMatch) h = decodeURIComponent(redirMatch[1])
          // Skip LinkedIn's own navigation/profile/job/post URLs — those go in
          // other fields. We only want EXTERNAL URLs the author shared.
          if (/^https?:\/\/(www\.)?linkedin\.com\//.test(h)) continue
          // Dedup
          if (!externalLinks.includes(h)) externalLinks.push(h)
        }
      } catch (_) {}

      const reactions = card.querySelector('.social-details-social-counts__reactions-count')?.innerText?.trim() || '0'
      const comments  = card.querySelector('.social-details-social-counts__comments')?.innerText?.trim() || '0'

      stats.acceptedAsPost++
      posts.push({
        author_name, author_url, author_headline,
        content, post_date, reactions, comments, post_url,
        // Anchor-harvested links; orchestrator merges with regex-text links.
        anchor_links: externalLinks,
        _source: 'html', _score: bestScore, _diag: bestDiag,
      })
    }

    window.__LH_STATS = stats
    return posts
  })
}

/* ──────────────────────────────────────────────────────────────────────
   HTML fallback: scroll-and-extract on the search page
   ────────────────────────────────────────────────────────────────────── */
async function scrapeHtmlSearch(page, { keyword, dateRange, maxResults, control, onProgress, debugDir, slug, ts }) {
  const log = (m) => onProgress?.(m)
  const stopped = () => control?.isStopped()

  const url = buildPostSearchURL(keyword, dateRange)
  log(`   📄 HTML fallback: ${url}`)

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (e) { log(`   ⚠ Slow load: ${e.message}`) }

  // Save initial diagnostic snapshot
  if (debugDir) {
    try {
      await page.screenshot({ path: path.join(debugDir, `posts_${slug}_${ts}_html_initial.png`) })
      const html = await page.evaluate(() => {
        const main = document.querySelector('main, [role="main"]') || document.body
        return main.outerHTML.slice(0, 500_000)
      })
      fs.writeFileSync(path.join(debugDir, `posts_${slug}_${ts}_html_initial.html`), html)
    } catch (_) {}
  }

  await page.waitForSelector('a[href*="/in/"], .feed-shared-update-v2, [data-urn]', { timeout: 25000 }).catch(() => null)
  await humanDelay(2000, 3500)

  const seen = new Set()
  const out = []
  let scrolls = 0
  const maxScrolls = 30
  let consecutiveZeroNew = 0
  let consecutiveNoGrowth = 0

  while (out.length < maxResults && scrolls < maxScrolls && !stopped()) {
    await control?.checkpoint()
    const cards = await extractPostCards(page)
    const stats = await page.evaluate(() => window.__LH_STATS || null).catch(() => null)
    log(`   👀 HTML round ${scrolls + 1}: ${stats?.totalAuthorLinks || 0} author links, ${cards.length} accepted, ${stats?.rejectedTooShort || 0} rejected`)

    // First round + 0 accepted = save full candidate list so we can debug
    if (scrolls === 0 && cards.length === 0 && debugDir && stats?.allCandidates) {
      try {
        const dumpPath = path.join(debugDir, `posts_${slug}_${ts}_candidates.json`)
        fs.writeFileSync(dumpPath, JSON.stringify(stats, null, 2))
        log(`   📋 0 accepted — full candidate trace saved to: ${dumpPath}`)
      } catch (_) {}
    }

    let newThisRound = 0
    for (const post of cards) {
      const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(post)
      newThisRound++
      if (out.length >= maxResults) break
    }

    if (out.length >= maxResults || stopped()) break

    if (newThisRound === 0) consecutiveZeroNew++; else consecutiveZeroNew = 0

    // Hover over the last new card if any — looks like reading
    await wanderRandomly(page).catch(() => {})

    const scroll = await humanReadAndScroll(page, { steps: 4 })
    await humanPageDown(page)

    if (!scroll.grew) consecutiveNoGrowth++; else consecutiveNoGrowth = 0
    if (consecutiveNoGrowth >= 3) { log('   🏁 Page stopped growing — end of feed'); break }
    if (consecutiveZeroNew >= 5)  { log('   ↳ No new posts in 5 rounds — stopping'); break }

    scrolls++
  }

  return out
}

/* ──────────────────────────────────────────────────────────────────────
   The orchestrator
   ────────────────────────────────────────────────────────────────────── */
async function scrapePosts({ cookies, keywords, filters = {}, options = {}, control, onProgress }) {
  const maxResults    = parseInt(options.maxResults) || 50
  const headless      = options.headless === true
  const strictFilter  = filters.strictHiringFilter === true
  const useVoyager    = options.useVoyager !== false              // default ON
  const useHtmlFallback = options.useHtmlFallback !== false       // default ON
  const useHashtags   = options.useHashtags === true              // opt-in
  const useFeed       = options.useFeed === true                  // opt-in
  const expand        = options.expandKeywords !== false          // default ON

  const log = (m) => { onProgress?.(m) }
  const stopped = () => control?.isStopped()

  // Debug folder
  let debugDir = null
  try {
    const electronApp = require('electron').app
    if (electronApp?.getPath) debugDir = path.join(electronApp.getPath('userData'), 'debug')
  } catch (_) {}
  if (debugDir && !fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })

  // Keyword expansion
  const inputKeywords = Array.isArray(keywords) ? keywords.filter(k => k?.trim()) : [keywords].filter(Boolean)
  const allKeywords = expand
    ? expandKeywords(inputKeywords, { maxVariants: 4 })
    : inputKeywords
  log(`🎯 Hunt plan: ${inputKeywords.length} keyword(s) → ${allKeywords.length} variant(s) after expansion`)
  allKeywords.forEach((k, i) => log(`   ${i + 1}. "${k}"`))

  // Hunt state for resume
  const state = {
    id: 'hunt-' + Date.now(),
    started_at: new Date().toISOString(),
    keywords: allKeywords,
    completedKeywords: [],
    totalCaptured: 0,
  }
  huntState.saveHuntState(state)

  // Shared dedup across all sources
  const globalSeen = new Set()
  const allPosts = []

  const backoff = createBackoff({ baseMs: 60_000, maxMs: 600_000 })

  let browser
  try {
    log('🌐 Launching browser...')
    const { browser: b, context } = await createAuthenticatedContext(
      typeof cookies === 'string' ? JSON.parse(cookies) : cookies,
      { headless }
    )
    browser = b

    for (const keyword of allKeywords) {
      if (stopped()) break
      if (!keyword?.trim()) continue

      log(`\n📣 ── Keyword: "${keyword}" ─────────────────`)

      // Each keyword gets its own page for clean state
      const page = await context.newPage()
      const slug = keyword.replace(/[^\w]+/g, '_').slice(0, 30)
      const ts = Date.now()
      const beforeCount = allPosts.length

      // Step A: navigate to a baseline URL so cookies + CSRF are available
      try {
        await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 })
      } catch (_) {}

      // Rate-limit check before doing real work
      const rl = await detectRateLimit(page)
      if (rl.limited) {
        const wait = backoff.hit()
        log(`⚠ Rate-limited (${rl.kind}: ${rl.evidence}). Backing off ${Math.round(wait/1000)}s.`)
        await new Promise(r => setTimeout(r, wait))
      } else {
        backoff.reset()
      }

      // Step B: Voyager (primary)
      if (useVoyager && !stopped()) {
        log(`🚀 Voyager: searching "${keyword}"`)
        const result = await searchPostsViaVoyager(page, {
          keyword,
          dateRange: filters.dateRange,
          maxResults: Math.max(10, Math.floor(maxResults * 0.7)),  // ~70% of budget from Voyager
          count: 10,
          onProgress: log,
        }).catch(e => ({ posts: [], error: e.message }))

        if (result.error) log(`   ⚠ Voyager error: ${result.error}`)
        for (const post of result.posts) {
          const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
          if (globalSeen.has(key)) continue
          globalSeen.add(key)
          allPosts.push({ ...post, _via: 'voyager' })
          if (allPosts.length >= maxResults) break
        }
        log(`   ✓ Voyager: +${allPosts.length - beforeCount} posts (total ${allPosts.length})`)
      }

      // Step C: HTML fallback if Voyager didn't get much
      const fromVoyager = allPosts.length - beforeCount
      if (useHtmlFallback && fromVoyager < 5 && allPosts.length < maxResults && !stopped()) {
        log(`🌐 HTML fallback (Voyager only got ${fromVoyager})`)
        const htmlPosts = await scrapeHtmlSearch(page, {
          keyword, dateRange: filters.dateRange,
          maxResults: maxResults - allPosts.length,
          control, onProgress: log, debugDir, slug, ts,
        }).catch(e => { log(`   ⚠ HTML error: ${e.message}`); return [] })

        for (const post of htmlPosts) {
          const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
          if (globalSeen.has(key)) continue
          globalSeen.add(key)
          allPosts.push({ ...post, _via: 'html' })
          if (allPosts.length >= maxResults) break
        }
        log(`   ✓ HTML: ${allPosts.length} total after fallback`)
      }

      // Step D: Hashtag (supplementary)
      if (useHashtags && allPosts.length < maxResults && !stopped()) {
        const hashPage = await context.newPage()
        const htags = await scrapeHashtag(hashPage, {
          keyword,
          maxResults: Math.min(20, maxResults - allPosts.length),
          control, onProgress: log, extractPostCards,
        }).catch(e => { log(`   ⚠ Hashtag error: ${e.message}`); return [] })
        await hashPage.close()

        for (const post of htags) {
          const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
          if (globalSeen.has(key)) continue
          globalSeen.add(key)
          allPosts.push({ ...post, _via: 'hashtag' })
          if (allPosts.length >= maxResults) break
        }
        log(`   ✓ Hashtag added (${allPosts.length}/${maxResults} total)`)
      }

      await page.close()
      huntState.markKeywordDone(state, keyword, allPosts.length - beforeCount)

      // Polite pause between keywords
      if (!stopped() && allPosts.length < maxResults) {
        await humanDelay(2500, 5000)
      }
    }

    // Step E: Feed (run once at end if enabled — keyword filter applies)
    if (useFeed && allPosts.length < maxResults && !stopped()) {
      log(`\n📰 Feed source (final pass)`)
      const feedPage = await context.newPage()
      const feed = await scrapeFeed(feedPage, {
        keywords: allKeywords,
        maxResults: Math.min(25, maxResults - allPosts.length),
        control, onProgress: log, extractPostCards,
      }).catch(e => { log(`   ⚠ Feed error: ${e.message}`); return [] })
      await feedPage.close()

      for (const post of feed) {
        const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
        if (globalSeen.has(key)) continue
        globalSeen.add(key)
        allPosts.push({ ...post, _via: 'feed' })
        if (allPosts.length >= maxResults) break
      }
      log(`   ✓ Feed: ${allPosts.length} total`)
    }

  } catch (err) {
    console.error('Post scraper error:', err)
    log(`❌ Error: ${err.message}`)
  } finally {
    if (browser) await browser.close().catch(() => {})
    huntState.clearHuntState()
  }

  // Apply strict filter if requested
  let result = allPosts
  if (strictFilter) {
    const before = result.length
    result = result.filter(p => {
      const matchesKw = (p.content || '').toLowerCase().includes(
        (allKeywords[0] || '').toLowerCase()
      )
      const hiringSig    = isHiringPost(p.content)
      const recruiterAut = /recruiter|hiring|talent|hr|people/i.test(p.author_headline || '')
      return hiringSig || matchesKw || recruiterAut
    })
    log(`🔬 Strict filter: ${before} → ${result.length}`)
  }

  // Attach links: merge anchor-harvested + regex-text URLs, dedup.
  // Always include post_url and external links from the card. If still empty,
  // fall back to the post_url itself as the single "link" so users always
  // have something clickable in the export.
  result = result.map(p => {
    const fromText   = extractLinks(p.content)
    const fromAnchor = Array.isArray(p.anchor_links) ? p.anchor_links : []
    const merged = []
    for (const u of [...fromAnchor, ...fromText]) {
      if (u && !merged.includes(u)) merged.push(u)
    }
    return { ...p, links: merged }
  })

  log(`\n🏁 Finished — ${result.length} total posts across all sources`)
  // Summary by source
  const bySrc = result.reduce((acc, p) => { acc[p._via || 'unknown'] = (acc[p._via || 'unknown'] || 0) + 1; return acc }, {})
  Object.entries(bySrc).forEach(([k, n]) => log(`   • ${k}: ${n}`))

  return result
}

module.exports = {
  scrapePosts,
  buildPostSearchURL,
  isHiringPost,
  extractPostCards,
  scrapeHtmlSearch,
}
