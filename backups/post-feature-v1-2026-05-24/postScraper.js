const path = require('path')
const fs = require('fs')
const { createAuthenticatedContext } = require('./linkedinAuth')
const {
  humanDelay, randomInt,
  humanReadAndScroll, humanMouseWander, humanPageDown,
} = require('./humanizer')

const HIRING_SIGNALS = [
  "we're hiring", "we are hiring", "now hiring", "hiring now", "we hire",
  "looking for", "seeking a", "open position", "job opening",
  "join our team", "join us", "we need a", "need a developer", "need a designer",
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

/**
 * Lenient post extraction with rich diagnostics.
 *
 * Strategy: find every reasonable post candidate (don't gate too hard), but
 * score each one and return a stats object so we can see WHY low scores were
 * picked. The consumer decides what threshold to apply.
 */
async function extractPostCards(page) {
  return page.evaluate(() => {
    const stats = {
      totalAuthorLinks: 0,
      candidatesScored: 0,
      rejectedTooShort: 0,
      rejectedDuplicate: 0,
      acceptedAsPost: 0,
      // First N rejected for diagnostic
      rejections: [],
    }

    const seen = new Set()
    const posts = []
    const authorLinks = document.querySelectorAll('a[href*="/in/"]')
    stats.totalAuthorLinks = authorLinks.length

    for (const link of authorLinks) {
      // Walk up to find the BEST card ancestor. We track every candidate
      // ancestor's score and keep the best one. CRUCIAL: we stop walking the
      // moment we enter a container with multiple author links (that's a
      // sibling-spanning wrapper, not our card).
      let walker = link
      let bestCard = null
      let bestScore = -999
      let bestDiag = null

      for (let depth = 0; depth < 12 && walker.parentElement; depth++) {
        walker = walker.parentElement
        const text = (walker.innerText || walker.textContent || '').trim()
        const len = text.length
        const linkCount = walker.querySelectorAll('a[href*="/in/"]').length

        // STOP walking up once we cross from "this author's card" into "container of many posts".
        // Allow up to 2 author links (a post might mention/quote another user).
        if (linkCount > 2) break

        const hasTime = !!walker.querySelector('time')
        const urnAttr = (walker.getAttribute?.('data-urn') ||
                         walker.getAttribute?.('data-id') ||
                         walker.getAttribute?.('data-chameleon-result-urn') || '')
        const hasActivityUrn = /activity:\d+/.test(urnAttr)
        const hasPostClass = walker.classList?.contains('feed-shared-update-v2') ||
                             !!walker.querySelector?.('.feed-shared-update-v2')
        const hasReactionUi = !!walker.querySelector?.('button[aria-label*="reaction"], button[aria-label*="comment"], .social-details-social-counts')

        // Lenient scoring — many soft signals add up
        let score = 0
        if (len >= 80 && len <= 5000) score += 4
        if (len > 5000) score -= 5
        if (hasTime) score += 4
        if (hasActivityUrn) score += 5         // very strong signal
        if (hasPostClass) score += 4
        if (hasReactionUi) score += 3
        if (linkCount === 1) score += 2

        if (score > bestScore) {
          bestScore = score
          bestCard = walker
          bestDiag = { depth, len, linkCount, hasTime, hasActivityUrn, hasPostClass, hasReactionUi, score }
        }
      }

      stats.candidatesScored++

      // Threshold: 6 = (text + time) OR (text + post-class) OR (urn alone).
      // Deliberately lenient — better to capture a possible-suggestion-card
      // than miss real posts.
      if (bestScore < 6 || !bestCard) {
        if (stats.rejections.length < 5) {
          stats.rejections.push({ reason: 'low-score', score: bestScore, diag: bestDiag })
        }
        stats.rejectedTooShort++
        continue
      }
      if (seen.has(bestCard)) { stats.rejectedDuplicate++; continue }
      seen.add(bestCard)

      const card = bestCard
      const textLen = bestDiag?.len || 0

      // Author
      const author_name = ((link.innerText || link.textContent) || '')
        .trim().split('\n')[0].slice(0, 80)
      const author_url = link.href

      const timeEl = card.querySelector('time')
      const post_date = timeEl?.getAttribute('datetime') || timeEl?.innerText?.trim() || ''

      // Headline
      let author_headline = ''
      const subDesc = card.querySelector(
        '.update-components-actor__description, ' +
        '.feed-shared-actor__description, ' +
        '.update-components-actor__sub-description, ' +
        '.entity-result__primary-subtitle'
      )
      if (subDesc) author_headline = (subDesc.innerText || subDesc.textContent || '').trim().slice(0, 200)

      // Content extraction with strict headline rejection
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
        '.feed-shared-update-v2__description, ' +
        '.feed-shared-update-v2__description-wrapper, ' +
        '.feed-shared-inline-show-more-text, ' +
        '.update-components-text, ' +
        '.update-components-update-v2__commentary, ' +
        '[class*="update-components-text"], ' +
        '[class*="commentary"]'
      )
      for (const c of bodyCandidates) {
        const t = (c.innerText || c.textContent || '').trim()
        if (t.length > contentLen && t.length > 30 && !isHeadlineText(t)) {
          content = t
          contentLen = t.length
        }
      }
      // Last-resort fallback: any span/div/p > 50 chars, not headline
      if (!content) {
        const blocks = card.querySelectorAll('span[dir="ltr"], p, div')
        for (const b of blocks) {
          const t = (b.innerText || b.textContent || '').trim()
          if (t.length > contentLen && t.length > 50 && !isHeadlineText(t)) {
            content = t
            contentLen = t.length
          }
        }
      }
      content = content.slice(0, 4000)

      // Permalink: try every known pattern
      let post_url = ''
      // (a) Timestamp wrapping anchor
      const timeAnchor = timeEl?.closest?.('a')
      if (timeAnchor?.href && /\/feed\/update\/|\/posts\//.test(timeAnchor.href)) {
        post_url = timeAnchor.href
      } else if (timeAnchor?.getAttribute) {
        const h = timeAnchor.getAttribute('href') || ''
        if (/\/feed\/update\/|\/posts\//.test(h)) {
          post_url = h.startsWith('/') ? 'https://www.linkedin.com' + h : h
        }
      }
      // (b) Any anchor in the card pointing to the post
      if (!post_url) {
        const a = card.querySelector('a[href*="/feed/update/urn:li:activity:"], a[href*="/posts/"]')
        if (a?.href) post_url = a.href
        else if (a?.getAttribute) {
          const h = a.getAttribute('href') || ''
          if (h) post_url = h.startsWith('/') ? 'https://www.linkedin.com' + h : h
        }
      }
      // (c) data-urn / data-id walking ancestors
      if (!post_url) {
        let up = card
        for (let i = 0; i < 6 && up; i++) {
          const urn = up.getAttribute?.('data-urn') ||
                      up.getAttribute?.('data-id') ||
                      up.getAttribute?.('data-chameleon-result-urn') || ''
          const m = urn.match(/activity[:_-]?(\d{4,25})/)
          if (m) {
            post_url = `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`
            break
          }
          up = up.parentElement
        }
      }
      // (d) Regex over outerHTML
      if (!post_url) {
        const m = (card.outerHTML || '').match(/urn:li:activity:(\d{4,25})/)
        if (m) post_url = `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`
      }

      const reactions = card.querySelector('.social-details-social-counts__reactions-count')?.innerText?.trim() || '0'
      const comments  = card.querySelector('.social-details-social-counts__comments')?.innerText?.trim() || '0'

      stats.acceptedAsPost++
      posts.push({
        author_name, author_url, author_headline,
        content, post_date, reactions, comments, post_url,
        _score: bestScore, _diag: bestDiag,
      })
    }

    window.__LH_STATS = stats
    return posts
  })
}

async function scrapePosts({ cookies, keywords, filters = {}, options = {}, control, onProgress }) {
  const maxResults = parseInt(options.maxResults) || 50
  const headless   = options.headless === true
  const strictFilter = filters.strictHiringFilter === true
  const allPosts   = []
  let browser

  const log = (msg) => { onProgress?.(msg) }
  const stopped = () => control?.isStopped()

  // Debug dump directory in userData
  let debugDir = null
  try {
    const electronApp = require('electron').app
    if (electronApp?.getPath) debugDir = path.join(electronApp.getPath('userData'), 'debug')
  } catch (_) {}
  if (debugDir && !fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true })

  try {
    log('🌐 Launching browser for posts search...')
    const { browser: b, context } = await createAuthenticatedContext(
      typeof cookies === 'string' ? JSON.parse(cookies) : cookies,
      { headless }
    )
    browser = b

    const keywordList = Array.isArray(keywords) ? keywords.filter(k => k?.trim()) : [keywords]

    for (const keyword of keywordList) {
      if (stopped()) break
      if (!keyword?.trim()) continue

      log(`📣 Searching posts for: "${keyword}"`)
      const page = await context.newPage()
      const url = buildPostSearchURL(keyword, filters.dateRange)
      log(`   ↳ URL: ${url}`)

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      } catch (e) {
        log(`⚠ Page load slow — continuing`)
      }

      // Detect auth wall
      const finalUrl = page.url()
      if (/\/login|\/authwall|\/checkpoint/.test(finalUrl)) {
        log(`❌ Session invalid — LinkedIn redirected to ${finalUrl.split('?')[0]}.`)
        await page.close()
        continue
      }
      log(`   ↳ Landed on: ${finalUrl}`)

      // Wait — multiple potential selectors
      log('   ⏳ Waiting for content to render (max 25s)...')
      await page.waitForSelector('a[href*="/in/"], .feed-shared-update-v2, [data-urn]', { timeout: 25000 }).catch(() => null)
      await humanDelay(2500, 4000)

      if (stopped()) { await page.close(); break }
      await control?.checkpoint()

      // DIAGNOSTIC DUMPS — invaluable when things go wrong
      const slug = keyword.replace(/[^\w]+/g, '_').slice(0, 30)
      const ts = Date.now()
      if (debugDir) {
        try {
          await page.screenshot({ path: path.join(debugDir, `posts_${slug}_${ts}_initial.png`), fullPage: false })
          // Save just the main content's HTML — full page is huge
          const mainHtml = await page.evaluate(() => {
            const main = document.querySelector('main, [role="main"]') || document.body
            return main.outerHTML.slice(0, 500000)
          })
          fs.writeFileSync(path.join(debugDir, `posts_${slug}_${ts}_initial.html`), mainHtml)
          log(`   📸 Screenshot + HTML saved to: ${debugDir}`)
        } catch (e) { log(`   ⚠ Could not save debug files: ${e.message}`) }
      }

      let postCount = 0
      let scrollAttempts = 0
      const maxScrolls = 40
      let consecutiveZeroNew = 0
      let consecutiveNoGrowth = 0
      const seenKeys = new Set()

      while (postCount < maxResults && scrollAttempts < maxScrolls && !stopped()) {
        await control?.checkpoint()

        const cards = await extractPostCards(page)
        const stats = await page.evaluate(() => window.__LH_STATS || null).catch(() => null)
        log(`   👀 Extraction round ${scrollAttempts + 1}: ${stats?.totalAuthorLinks || 0} author links on page, ${cards.length} accepted as posts, ${stats?.rejectedTooShort || 0} rejected (low score)`)

        // First round only: show rejection diagnostics (helpful when 0 found)
        if (stats?.rejections?.length && scrollAttempts === 0) {
          stats.rejections.slice(0, 3).forEach(r => {
            log(`      └ rejected score=${r.score} ${JSON.stringify(r.diag)}`)
          })
        }

        let newThisRound = 0
        for (const post of cards) {
          if (stopped() || postCount >= maxResults) break

          const key = `${post.author_url}|${(post.content || '').slice(0, 80)}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)

          if (!post.content && !post.author_name) continue

          if (strictFilter) {
            const matchesKeyword  = (post.content || '').toLowerCase().includes(keyword.toLowerCase())
            const hiringSignal    = isHiringPost(post.content)
            const recruiterAuthor = /recruiter|hiring|talent|hr|people/i.test(post.author_headline || '')
            if (!hiringSignal && !matchesKeyword && !recruiterAuthor) continue
          }

          allPosts.push({
            author_name: post.author_name,
            author_url: post.author_url,
            author_headline: post.author_headline,
            content: post.content,
            post_date: post.post_date,
            reactions: post.reactions,
            comments: post.comments,
            post_url: post.post_url,
            links: extractLinks(post.content),
          })
          postCount++
          newThisRound++
          log(`📌 [${postCount}/${maxResults}] ${post.author_name || 'Unknown'} — ${(post.content || '').slice(0, 60)}...`)
        }

        if (stopped() || postCount >= maxResults) break

        if (newThisRound === 0) consecutiveZeroNew++
        else consecutiveZeroNew = 0

        // ─── HUMAN-LIKE PAGE PROGRESSION ──────────────────────────────
        // Stage 1: wander mouse (bot detection prefers movement)
        await humanMouseWander(page)

        // Stage 2: incremental "reading" scroll — pause between scrolls,
        // sometimes scroll back up. Tracks if the page actually grew.
        log(`   📜 Reading + scrolling (round ${scrollAttempts + 1}/${maxScrolls}, ${postCount}/${maxResults})`)
        const scroll = await humanReadAndScroll(page, { steps: 4 })
        log(`   ↳ Page height: ${scroll.lastHeight} → ${scroll.newHeight}px (${scroll.grew ? '+' + (scroll.newHeight - scroll.lastHeight) : 'NO GROWTH'})`)

        // Stage 3: keyboard nudge (some lazy-loaders only fire on key events)
        await humanPageDown(page)

        // Stage 4: click any "Show more" button
        let clickedShowMore = false
        for (const sel of [
          'button.scaffold-finite-scroll__load-button',
          'button[aria-label*="more results"]',
          'button[aria-label*="Show more"]',
        ]) {
          try {
            const btn = await page.$(sel)
            if (btn) {
              log(`   ▶ Clicked "${sel}"`)
              await btn.click({ timeout: 2000 }).catch(() => {})
              await humanDelay(1500, 2500)
              clickedShowMore = true
              break
            }
          } catch (_) {}
        }

        // Stage 5: if scroll didn't grow page AND no Show More button — end of feed
        if (!scroll.grew && !clickedShowMore) {
          consecutiveNoGrowth++
        } else {
          consecutiveNoGrowth = 0
        }

        // End conditions: page genuinely has no more posts
        if (consecutiveNoGrowth >= 3) {
          log(`   🏁 Page hasn't grown in ${consecutiveNoGrowth} rounds — reached the end`)
          break
        }
        if (consecutiveZeroNew >= 5) {
          log(`   ↳ No new posts captured in ${consecutiveZeroNew} rounds — stopping`)
          break
        }

        // Save diagnostic screenshot when we're stuck
        if (debugDir && newThisRound === 0 && scrollAttempts < 4) {
          try {
            await page.screenshot({
              path: path.join(debugDir, `posts_${slug}_${ts}_scroll${scrollAttempts}.png`),
              fullPage: false,
            })
          } catch (_) {}
        }

        scrollAttempts++
      }

      await page.close()
      log(`✅ Done with "${keyword}" — ${postCount} posts collected`)
      if (!stopped()) await humanDelay(2500, 4500)
    }

  } catch (err) {
    console.error('Post scraper error:', err)
    log(`❌ Error: ${err.message}`)
  } finally {
    if (browser) await browser.close().catch(() => {})
    log(stopped() ? '⏹ Stopped by user' : `🏁 Finished — ${allPosts.length} total posts`)
    if (debugDir) {
      log(`💡 Debug files saved to: ${debugDir}`)
      log(`   Open any posts_*.html in a browser to see exactly what LinkedIn returned`)
    }
  }

  return allPosts
}

module.exports = { scrapePosts, buildPostSearchURL, isHiringPost, extractPostCards }
