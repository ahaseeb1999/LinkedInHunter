/**
 * Voyager API caller — calls LinkedIn's internal JSON API directly via the
 * Playwright session's `fetch`. Much more reliable than DOM scraping because:
 *
 *   - Returns structured JSON, not HTML (no class-name dependency)
 *   - Real cursor-based pagination via &start=N&count=M
 *   - Internal API contract changes far less often than the rendered DOM
 *   - Same endpoint LinkedIn's own web client uses, so we look like a real session
 *
 * Why we use page.evaluate(fetch(...)) instead of building requests in Node:
 *   1. The page context already has all the right cookies + the dynamic
 *      csrf-token in cookie form (JSESSIONID), so we don't have to rebuild
 *      auth headers from scratch.
 *   2. Browser fetches the URL exactly the way LinkedIn expects (origin
 *      header, referer, etc.) — no reverse-engineering needed.
 *   3. If the API call gets rate-limited, the page's existing session takes
 *      the heat, not a separate fetch identity.
 *
 * The endpoint we hit:
 *   GET /voyager/api/search/dash/clusters
 *     ?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-...
 *     &keywords=KEYWORD
 *     &query=(flagshipSearchIntent:CONTENT_HORIZONTAL_TYPE,queryParameters:(sortBy:List(DATE_POSTED)))
 *     &start=0&count=10
 *
 * Response is in LinkedIn's normalized JSON-LD format with an "included"
 * array. We extract Update objects (posts) and their associated actor info.
 */

const VOYAGER_BASE = 'https://www.linkedin.com/voyager/api'

/**
 * Extract the csrf-token value from the page's cookies. LinkedIn stores it
 * in the JSESSIONID cookie as a quoted "ajax:NNNNN" string.
 */
async function getCsrfToken(page) {
  try {
    const cookies = await page.context().cookies('https://www.linkedin.com')
    const js = cookies.find(c => c.name === 'JSESSIONID')
    if (!js) return null
    // Cookie value is wrapped in quotes: "ajax:1234567890"
    return js.value.replace(/^"|"$/g, '')
  } catch (_) { return null }
}

/**
 * Build the Voyager content-search URL. The `query` parameter uses
 * LinkedIn's custom URN-style encoding — DO NOT URLSearchParams-encode the
 * value; it's already in a special format.
 */
function buildContentSearchQuery({ keyword, dateRange, start = 0, count = 10 }) {
  const queryParts = ['sortBy:List(DATE_POSTED)']
  if (dateRange === '24h')   queryParts.push('datePosted:List("past-24h")')
  if (dateRange === 'week')  queryParts.push('datePosted:List("past-week")')
  if (dateRange === 'month') queryParts.push('datePosted:List("past-month")')

  const queryParam =
    `(flagshipSearchIntent:CONTENT_HORIZONTAL_TYPE,queryParameters:(${queryParts.join(',')}))`

  // keywords gets standard encoding; query has LinkedIn-specific syntax that
  // we want preserved (parens, colons, commas, quotes are all meaningful).
  const params = new URLSearchParams({ keywords: keyword }).toString()
  return `${VOYAGER_BASE}/search/dash/clusters?${params}&query=${encodeURIComponent(queryParam)}&start=${start}&count=${count}`
}

/**
 * Call Voyager from inside the Playwright page so cookies + csrf are
 * automatically attached. Returns the parsed JSON or null on failure.
 */
async function callVoyager(page, url) {
  const csrfToken = await getCsrfToken(page)
  if (!csrfToken) return { error: 'no-csrf-token', data: null }

  return page.evaluate(async ({ url, csrfToken }) => {
    try {
      const r = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'accept': 'application/vnd.linkedin.normalized+json+2.1',
          'csrf-token': csrfToken,
          'x-restli-protocol-version': '2.0.0',
          'x-li-lang': 'en_US',
          'x-li-track': '{"clientVersion":"1.13.0","mpVersion":"1.13.0","osName":"web","timezoneOffset":0,"timezone":"UTC","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
        },
      })
      const text = await r.text()
      let data = null
      try { data = JSON.parse(text) } catch (_) {}
      return { status: r.status, ok: r.ok, data, snippet: text.slice(0, 200) }
    } catch (e) {
      return { error: e.message }
    }
  }, { url, csrfToken })
}

/**
 * Parse a Voyager content-search response into normalized post objects.
 *
 * LinkedIn returns a JSON-LD-style document with `included` array of typed
 * objects. We pull out posts and their referenced actors.
 */
function parseVoyagerPosts(json) {
  if (!json || !json.included) return []

  const included = json.included
  const byUrn = new Map()
  for (const obj of included) {
    if (obj.entityUrn) byUrn.set(obj.entityUrn, obj)
  }

  const posts = []

  for (const obj of included) {
    const t = obj.$type || obj.type || ''
    // Different LinkedIn API versions use different $type strings
    const isPostLike = /Update|FeedUpdate|Post/i.test(t) ||
                       obj.commentary || obj.actor ||
                       /urn:li:activity:/.test(obj.urn || obj.entityUrn || '')

    if (!isPostLike) continue

    // Author info — may be embedded or referenced by URN
    let actor = obj.actor || obj.author
    if (typeof actor === 'string') actor = byUrn.get(actor)

    const actorName = actor?.name?.text || actor?.name || ''
    const actorHeadline = actor?.description?.text || actor?.description || actor?.subDescription?.text || ''
    const actorUrl = actor?.navigationContext?.actionTarget || ''

    // Content — try multiple shapes
    let content = ''
    if (obj.commentary?.text?.text) content = obj.commentary.text.text
    else if (obj.commentary?.text) content = typeof obj.commentary.text === 'string' ? obj.commentary.text : ''
    else if (obj.content?.text) content = obj.content.text
    else if (obj.summary?.text) content = obj.summary.text
    else if (typeof obj.commentary === 'string') content = obj.commentary

    // Permalink construction — try every known field, then fall back to
    // regex over the entire object JSON
    let post_url = ''
    const allUrnSources = [
      obj.urn,
      obj.entityUrn,
      obj.dashEntityUrn,
      obj.preDashEntityUrn,
      obj.updateMetadata?.urn,
      obj.updateMetadata?.shareUrn,
      obj.socialDetail?.urn,
    ].filter(Boolean)

    for (const src of allUrnSources) {
      const m = String(src).match(/activity:(\d+)/)
      if (m) { post_url = `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`; break }
    }
    if (!post_url) {
      if (obj.permalink) post_url = obj.permalink
      else if (obj.navigationContext?.actionTarget) post_url = obj.navigationContext.actionTarget
      else if (obj.updateMetadata?.shareUrl) post_url = obj.updateMetadata.shareUrl
    }
    // Final fallback: regex the whole serialized obj for activity URN
    if (!post_url) {
      try {
        const json = JSON.stringify(obj)
        const m = json.match(/urn:li:activity:(\d+)/)
        if (m) post_url = `https://www.linkedin.com/feed/update/urn:li:activity:${m[1]}/`
      } catch (_) {}
    }

    // Harvest external URLs from any 'url' / 'navigationContext.actionTarget'
    // fields in the post — captures "Apply here" links, articles, etc.
    const anchor_links = []
    try {
      const json = JSON.stringify(obj)
      const urlMatches = json.match(/"(https?:\/\/[^"\s]+)"/g) || []
      for (const u of urlMatches) {
        const clean = u.slice(1, -1)  // strip quotes
        if (/linkedin\.com\//.test(clean)) continue   // skip LinkedIn internal
        if (clean.length > 250) continue              // skip giant CDN URLs
        if (!anchor_links.includes(clean)) anchor_links.push(clean)
      }
    } catch (_) {}

    // Social details
    let reactions = '0', comments = '0'
    const social = obj.socialDetail || obj.socialDetails
    if (social) {
      reactions = String(social.totalShares || social.totalSocialActivityCounts?.numLikes || 0)
      comments  = String(social.comments?.paging?.total || social.totalSocialActivityCounts?.numComments || 0)
    }

    // Post date
    const post_date = obj.actionTime || obj.createdAt || obj.timestamp || ''

    if (!content && !actorName) continue

    posts.push({
      author_name: actorName,
      author_url: actorUrl,
      author_headline: actorHeadline,
      content,
      post_date: typeof post_date === 'number' ? new Date(post_date).toISOString() : String(post_date),
      reactions, comments,
      post_url,
      anchor_links,
      _source: 'voyager',
    })
  }

  return posts
}

/**
 * Search posts via Voyager with pagination. Calls /voyager/api repeatedly
 * with increasing `start` until `maxResults` is hit or LinkedIn returns
 * fewer than `count` results (end of feed).
 */
async function searchPostsViaVoyager(page, { keyword, dateRange, maxResults = 50, count = 10, onProgress }) {
  const log = (m) => { try { onProgress?.(m) } catch (_) {} }
  const allPosts = []
  let start = 0
  let consecutiveEmpty = 0

  while (allPosts.length < maxResults) {
    const url = buildContentSearchQuery({ keyword, dateRange, start, count })
    log(`   📡 Voyager call: start=${start} count=${count}`)
    const resp = await callVoyager(page, url)

    if (!resp || resp.error) {
      log(`   ⚠ Voyager error: ${resp?.error || 'unknown'}`)
      return { posts: allPosts, error: resp?.error || 'voyager-error' }
    }

    if (!resp.ok) {
      log(`   ⚠ Voyager HTTP ${resp.status}: ${resp.snippet || ''}`)
      return { posts: allPosts, error: `http-${resp.status}` }
    }

    const batch = parseVoyagerPosts(resp.data)
    log(`   ↳ Parsed ${batch.length} posts from response`)

    if (batch.length === 0) {
      consecutiveEmpty++
      if (consecutiveEmpty >= 2) {
        log(`   🏁 Voyager returned empty twice — end of results`)
        break
      }
    } else {
      consecutiveEmpty = 0
      allPosts.push(...batch)
    }

    if (batch.length < count) {
      // Last partial page
      log(`   🏁 Last page (got ${batch.length} of ${count})`)
      break
    }

    start += count
  }

  return { posts: allPosts.slice(0, maxResults), error: null }
}

module.exports = {
  searchPostsViaVoyager,
  buildContentSearchQuery,
  parseVoyagerPosts,
  getCsrfToken,
  callVoyager,
}
