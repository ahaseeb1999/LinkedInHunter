/**
 * Humanizer — makes Playwright behave like a real human
 * Random delays, scroll simulation, mouse wiggle
 */

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function humanDelay(minMs = 1500, maxMs = 4000) {
  const delay = randomInt(minMs, maxMs)
  return new Promise(resolve => setTimeout(resolve, delay))
}

async function shortDelay() {
  return humanDelay(400, 900)
}

/**
 * Scroll the page using window.scrollBy via evaluate — reliable across
 * Chromium versions, doesn't depend on mouse cursor position (which
 * page.mouse.wheel needs to be set first to actually scroll anything).
 */
async function humanScroll(page, scrolls = 3) {
  for (let i = 0; i < scrolls; i++) {
    const amount = randomInt(400, 900)
    await page.evaluate((px) => window.scrollBy({ top: px, behavior: 'auto' }), amount)
    await humanDelay(600, 1500)
  }
}

async function humanScrollToBottom(page, { maxSteps = 8 } = {}) {
  let lastHeight = 0
  let attempts = 0
  while (attempts < maxSteps) {
    const newHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    // Scroll a big chunk via DOM API — reliable
    await page.evaluate((px) => window.scrollBy({ top: px, behavior: 'auto' }), randomInt(800, 1400))
    await humanDelay(900, 1700)
    if (newHeight === lastHeight && attempts > 1) break
    lastHeight = newHeight
    attempts++
  }
}

/**
 * Scroll an inner container (LinkedIn often nests results in a scrollable div).
 * Returns whether the container was found and scrolled.
 */
async function scrollInnerContainer(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    el.scrollTop = el.scrollHeight
    return true
  }, selector)
}

async function humanClick(page, selector) {
  const el = await page.$(selector)
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false

  // Move to a slightly random position within the element
  const x = box.x + box.width * (0.3 + Math.random() * 0.4)
  const y = box.y + box.height * (0.3 + Math.random() * 0.4)

  await page.mouse.move(x, y, { steps: randomInt(5, 15) })
  await shortDelay()
  await page.mouse.click(x, y)
  return true
}

async function humanType(page, selector, text) {
  await page.click(selector)
  await shortDelay()
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(40, 130) })
  }
}

/**
 * Smooth incremental scroll over multiple steps — looks more like a real
 * person scanning a feed than a single jump-to-bottom call.
 * Returns the new scroll height so callers can detect when no more content loads.
 */
async function humanReadAndScroll(page, { steps = 4 } = {}) {
  let lastHeight = 0
  try { lastHeight = await page.evaluate(() => document.documentElement.scrollHeight) } catch (_) {}

  for (let i = 0; i < steps; i++) {
    // Random step size — like a varied wheel scroll
    const px = randomInt(350, 750)
    try {
      await page.evaluate((p) => window.scrollBy({ top: p, behavior: 'auto' }), px)
    } catch (_) {}
    // Brief "reading" pause
    await humanDelay(600, 1300)
  }
  // Occasionally also scroll up a tiny bit and back — humans re-read
  if (Math.random() < 0.3) {
    try {
      await page.evaluate(() => window.scrollBy({ top: -200, behavior: 'auto' }))
      await new Promise(r => setTimeout(r, randomInt(400, 800)))
      await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'auto' }))
    } catch (_) {}
  }
  let newHeight = lastHeight
  try { newHeight = await page.evaluate(() => document.documentElement.scrollHeight) } catch (_) {}
  return { lastHeight, newHeight, grew: newHeight > lastHeight }
}

/**
 * Move the mouse around the viewport with realistic curved paths — bot
 * detection scoring is heavily weighted on the presence and pattern of
 * mouse movement.
 */
async function humanMouseWander(page) {
  try {
    const vp = page.viewportSize() || { width: 1280, height: 800 }
    const positions = [
      [randomInt(100, vp.width - 100), randomInt(100, vp.height - 100)],
      [randomInt(100, vp.width - 100), randomInt(100, vp.height - 100)],
    ]
    for (const [x, y] of positions) {
      await page.mouse.move(x, y, { steps: randomInt(10, 25) })
      await new Promise(r => setTimeout(r, randomInt(150, 400)))
    }
  } catch (_) {}
}

/** Press "End" then PageDown — triggers lazy-load on many React apps. */
async function humanPageDown(page) {
  try {
    await page.keyboard.press('End')
    await new Promise(r => setTimeout(r, randomInt(400, 800)))
    await page.keyboard.press('PageDown')
    await new Promise(r => setTimeout(r, randomInt(400, 800)))
  } catch (_) {}
}

module.exports = {
  humanDelay, shortDelay, humanScroll, humanScrollToBottom,
  humanClick, humanType, randomInt, scrollInnerContainer,
  humanReadAndScroll, humanMouseWander, humanPageDown,
}
