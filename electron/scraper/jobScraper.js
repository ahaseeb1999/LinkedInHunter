const { createAuthenticatedContext } = require('./linkedinAuth')
const {
  humanDelay, humanScrollToBottom, randomInt,
  humanReadAndScroll, humanMouseWander, humanPageDown,
} = require('./humanizer')

const EXPERIENCE_MAP = { 'Entry': '1', 'Mid': '2', 'Senior': '3', 'Lead': '4', 'Any': '' }
const JOB_TYPE_MAP   = { 'Full-time': 'F', 'Contract': 'C', 'Freelance': 'T', 'Part-time': 'P', 'Any': '' }
const DATE_MAP       = { '24h': 'r86400', 'week': 'r604800', 'month': 'r2592000', 'any': '' }
// LinkedIn work-type filter: 1=On-site, 2=Remote, 3=Hybrid (comma-separated for combos)
const WORK_MODE_MAP  = {
  'Remote':    '2',
  'Hybrid':    '3',
  'On-site':   '1',
  'Remote+Hybrid': '2,3',
  'Any':       '',
}

function buildJobSearchURL(keyword, filters = {}) {
  const base = 'https://www.linkedin.com/jobs/search/'
  const params = new URLSearchParams()
  params.set('keywords', keyword)
  params.set('sortBy', 'DD')                                   // newest first

  // Work mode: explicit value wins; otherwise default Remote unless location given
  const workMode = filters.workMode
  if (workMode && workMode !== 'Any' && WORK_MODE_MAP[workMode]) {
    params.set('f_WT', WORK_MODE_MAP[workMode])
  } else if (workMode === 'Any') {
    // intentionally no f_WT — LinkedIn returns all work modes
  } else if (!filters.location) {
    params.set('f_WT', '2')                                     // legacy default: remote
  }

  if (filters.experienceLevel && EXPERIENCE_MAP[filters.experienceLevel]) params.set('f_E', EXPERIENCE_MAP[filters.experienceLevel])
  if (filters.jobType        && JOB_TYPE_MAP[filters.jobType])         params.set('f_JT', JOB_TYPE_MAP[filters.jobType])
  if (filters.dateRange      && DATE_MAP[filters.dateRange])           params.set('f_TPR', DATE_MAP[filters.dateRange])
  if (filters.easyApplyOnly) params.set('f_AL', 'true')
  if (filters.location)     params.set('location', filters.location)
  return `${base}?${params.toString()}`
}

/**
 * Extract job cards from the search results page using multiple fallback
 * selectors — LinkedIn DOM classes change often, so we try a wide net.
 */
async function extractJobCards(page) {
  return page.evaluate(() => {
    const selectorGroups = [
      '.scaffold-layout__list-container li',
      '.jobs-search-results-list li',
      '.jobs-search__results-list li',
      'ul.scaffold-layout__list-container > li',
      'div.job-card-container',
      '[data-job-id]',
      'li[data-occludable-job-id]',
    ]
    let cards = []
    for (const sel of selectorGroups) {
      const found = document.querySelectorAll(sel)
      if (found.length > cards.length) cards = Array.from(found)
    }

    return cards.map(card => {
      const link = card.querySelector('a[href*="/jobs/view/"]')
      const apply_url = link?.href || ''
      const job_id =
        apply_url.match(/\/jobs\/view\/(\d+)/)?.[1] ||
        card.getAttribute('data-job-id') ||
        card.getAttribute('data-occludable-job-id') || ''

      const pickText = (selectors) => {
        for (const s of selectors) {
          const el = card.querySelector(s)
          const t  = el?.innerText?.trim() || el?.textContent?.trim()
          if (t) return t
        }
        return ''
      }

      const title = pickText([
        '.job-card-list__title',
        '.job-card-list__title--link',
        '.artdeco-entity-lockup__title a',
        '.artdeco-entity-lockup__title',
        '.base-search-card__title',
        'a[aria-label]',
        'h3',
      ])

      const company = pickText([
        '.job-card-container__primary-description',
        '.artdeco-entity-lockup__subtitle',
        '.job-card-container__company-name',
        '.base-search-card__subtitle',
        'h4',
      ])

      const location = pickText([
        '.job-card-container__metadata-item',
        '.artdeco-entity-lockup__caption',
        '.job-search-card__location',
      ])

      const dateEl = card.querySelector('time')
      const date_posted = dateEl?.getAttribute('datetime') || dateEl?.innerText?.trim() || ''

      return { title, company, location, date_posted, apply_url, job_id }
    }).filter(j => j.title && j.apply_url)
  })
}

/**
 * Open a job detail panel (LinkedIn shows it in the right column without
 * a full navigation) and extract description + criteria.
 */
async function extractJobDetail(page, jobUrl) {
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
    // Wait for the description area or a clear "page loaded" cue
    await page.waitForSelector(
      '#job-details, .jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, .jobs-description-content__text',
      { timeout: 10000 }
    ).catch(() => {})
    await humanDelay(800, 1600)

    // Try to expand truncated description
    for (const sel of [
      'button.jobs-description__footer-button',
      'button.show-more-less-html__button',
      'button[aria-label*="more"]',
    ]) {
      try {
        const btn = await page.$(sel)
        if (btn) { await btn.click({ timeout: 1500 }).catch(() => {}); break }
      } catch (_) {}
    }

    return await page.evaluate(() => {
      const pick = (...selectors) => {
        for (const s of selectors) {
          const el = document.querySelector(s)
          const t  = el?.innerText?.trim() || el?.textContent?.trim()
          if (t) return t
        }
        return ''
      }

      const description = pick(
        '#job-details',
        '.jobs-description-content__text',
        '.jobs-description__content',
        '.jobs-box__html-content',
        '.show-more-less-html__markup',
      )

      // Criteria items (Seniority level, Employment type, Industry, ...)
      const criteria = {}
      document.querySelectorAll(
        '.jobs-unified-top-card__job-insight, ' +
        '.description__job-criteria-item, ' +
        'li.job-details-jobs-unified-top-card__job-insight, ' +
        '.job-details-preferences-and-skills li'
      ).forEach(el => {
        const label = el.querySelector('.description__job-criteria-subheader, h3, .job-details-jobs-unified-top-card__job-insight-view-model-secondary')?.innerText?.trim()
        const value = el.querySelector('.description__job-criteria-text, span:last-child')?.innerText?.trim()
        if (label && value && label !== value) criteria[label] = value
      })

      const applyBtnText = pick('.jobs-apply-button', 'button.jobs-apply-button--top-card')
      const applyType = /Easy Apply/i.test(applyBtnText) ? 'Easy Apply' : 'External'

      const applicants = pick(
        '.jobs-unified-top-card__applicant-count',
        '.num-applicants__caption',
        '.job-details-jobs-unified-top-card__primary-description-container span:last-child',
      )

      return { description, criteria, applyType, applicants }
    })
  } catch (err) {
    return { description: '', criteria: {}, applyType: 'External', applicants: '', error: err.message }
  }
}

async function scrapeJobs({ cookies, keywords, filters = {}, options = {}, control, onProgress }) {
  const maxResults     = parseInt(options.maxResults) || 50
  const headless       = options.headless === true              // default: visible
  const includeSimilar = !!options.includeSimilar
  const allJobs = []
  let browser

  const log = (msg) => { onProgress?.(msg) }
  const stopped = () => control?.isStopped()

  try {
    log('🌐 Launching browser...')
    const { browser: b, context } = await createAuthenticatedContext(
      typeof cookies === 'string' ? JSON.parse(cookies) : cookies,
      { headless }
    )
    browser = b

    const keywordList = Array.isArray(keywords) ? keywords.filter(k => k?.trim()) : [keywords]

    for (const keyword of keywordList) {
      if (stopped()) break
      if (!keyword?.trim()) continue

      log(`🔍 Searching jobs for: "${keyword}"`)
      const searchPage = await context.newPage()
      const url = buildJobSearchURL(keyword, filters)
      log(`   ↳ ${url}`)

      try {
        await searchPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      } catch (e) {
        log(`⚠ Page load slow — continuing anyway`)
      }

      // Verify we're not at the auth wall
      const finalUrl = searchPage.url()
      if (/\/login|\/authwall|\/checkpoint/.test(finalUrl)) {
        log(`❌ Session invalid — LinkedIn redirected to ${finalUrl.split('?')[0]}. Re-add the account.`)
        await searchPage.close()
        continue
      }

      // Wait for *some* job content to appear
      const cardSelector =
        '.scaffold-layout__list-container li, .jobs-search-results-list li, [data-job-id], div.job-card-container'
      const found = await searchPage.waitForSelector(cardSelector, { timeout: 15000 }).catch(() => null)
      if (!found) {
        log(`⚠ No job cards visible after 15s. LinkedIn may have changed its layout for this account/region.`)
        // Diagnostic: capture how much HTML is on the page
        const len = await searchPage.evaluate(() => document.body.innerText.length).catch(() => 0)
        log(`   ↳ page text length: ${len} chars`)
      }

      await humanDelay(1500, 3000)
      if (stopped()) { await searchPage.close(); break }
      await control?.checkpoint()

      let jobCount = 0
      let pageNum = 0
      const perPage = 25

      while (jobCount < maxResults && !stopped()) {
        await control?.checkpoint()
        log(`📄 Loading results page ${pageNum + 1}...`)

        // Human-like: wander mouse, scroll incrementally, key-nudge for lazy load
        await humanMouseWander(searchPage)

        // Scroll the inner list (LinkedIn lazy-loads job cards inside a container)
        await searchPage.evaluate(() => {
          const list = document.querySelector(
            '.scaffold-layout__list-container, .jobs-search-results-list, ul.scaffold-layout__list-container'
          )
          if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })
        }).catch(() => {})

        await humanReadAndScroll(searchPage, { steps: 3 })
        await humanPageDown(searchPage)
        await humanDelay(1500, 2500)

        const cards = await extractJobCards(searchPage)
        log(`   ↳ Found ${cards.length} cards on this page`)

        if (cards.length === 0) {
          log(`⚠ No cards extracted. LinkedIn DOM may have changed. Stopping this keyword.`)
          break
        }

        for (const card of cards) {
          if (stopped() || jobCount >= maxResults) break
          await control?.checkpoint()

          log(`📋 [${jobCount + 1}/${maxResults}] ${card.title} @ ${card.company}`)

          const detailPage = await context.newPage()
          const detail = await extractJobDetail(detailPage, card.apply_url)
          await detailPage.close()

          allJobs.push({
            title:            card.title,
            company:          card.company,
            location:         card.location,
            date_posted:      card.date_posted,
            description:      detail.description || '',
            apply_url:        card.apply_url,
            apply_type:       detail.applyType,
            applicants_count: detail.applicants,
            industry:         detail.criteria['Industries'] || detail.criteria['Industry'] || '',
            company_size:     detail.criteria['Company size'] || '',
            job_type:         detail.criteria['Employment type'] || filters.jobType || 'Full-time',
            salary:           detail.criteria['Base salary'] || detail.criteria['Salary'] || '',
            is_remote:        /remote/i.test(card.location || ''),
          })

          jobCount++
          await humanDelay(1200, 2800)
        }

        if (stopped() || jobCount >= maxResults) break

        pageNum++
        const start = pageNum * perPage
        const nextUrl = url + (url.includes('?') ? '&' : '?') + `start=${start}`
        log(`   ↳ Next page: start=${start}`)
        try {
          await searchPage.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
          await humanDelay(2000, 3500)
        } catch (e) {
          log(`⚠ Could not load next page — ${e.message}`)
          break
        }
      }

      if (includeSimilar && !stopped()) {
        log('🔗 Checking similar jobs section...')
        try {
          const similar = await searchPage.evaluate(() => {
            const list = document.querySelectorAll('.similar-jobs__list li, [class*="similar"] li')
            return Array.from(list).map(card => {
              const link  = card.querySelector('a[href*="/jobs/view/"]')
              const title = card.querySelector('h3, .artdeco-entity-lockup__title')?.innerText?.trim() || ''
              const co    = card.querySelector('h4, .artdeco-entity-lockup__subtitle')?.innerText?.trim() || ''
              return { title, company: co, location: 'Remote', date_posted: '', apply_url: link?.href || '', is_remote: true, apply_type: 'External', job_type: '' }
            }).filter(j => j.title && j.apply_url)
          })
          for (const s of similar.slice(0, 10)) {
            if (allJobs.find(j => j.apply_url === s.apply_url)) continue
            allJobs.push({ ...s, description: '', applicants_count: '', industry: '', company_size: '', salary: '' })
          }
        } catch (_) {}
      }

      await searchPage.close()
      log(`✅ Done with "${keyword}" — ${jobCount} jobs collected`)
      if (!stopped()) await humanDelay(2000, 4000)
    }

  } catch (err) {
    console.error('Job scraper error:', err)
    log(`❌ Error: ${err.message}`)
  } finally {
    if (browser) await browser.close().catch(() => {})
    log(stopped() ? '⏹ Stopped by user' : `🏁 Finished — ${allJobs.length} total jobs`)
  }

  return allJobs
}

module.exports = { scrapeJobs, buildJobSearchURL, WORK_MODE_MAP }
