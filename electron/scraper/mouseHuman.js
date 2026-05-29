/**
 * Human-like mouse behavior — bezier-curve paths, hover-and-dwell,
 * variable speeds. These are the strongest signals against LinkedIn's
 * automation detection.
 */

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min
}

/**
 * Generate intermediate waypoints along a cubic Bezier curve. Real human
 * mouse movement follows curved arcs, not straight lines — this is one of
 * the easiest bot signals to fix.
 *
 * @param {number} steps - how many waypoints (more = smoother but slower)
 */
function bezierPath(x0, y0, x1, y1, steps = 18) {
  // Control points slightly offset from the straight line — gives a natural arc
  const dx = x1 - x0
  const dy = y1 - y0
  const cx1 = x0 + dx * 0.25 + randomFloat(-40, 40)
  const cy1 = y0 + dy * 0.25 + randomFloat(-40, 40)
  const cx2 = x0 + dx * 0.75 + randomFloat(-40, 40)
  const cy2 = y0 + dy * 0.75 + randomFloat(-40, 40)

  const points = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    // Cubic Bezier: B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
    const x = mt*mt*mt*x0 + 3*mt*mt*t*cx1 + 3*mt*t*t*cx2 + t*t*t*x1
    const y = mt*mt*mt*y0 + 3*mt*mt*t*cy1 + 3*mt*t*t*cy2 + t*t*t*y1
    points.push([x, y])
  }
  return points
}

/**
 * Move the mouse to (x, y) along a bezier curve with realistic timing.
 * Default 18 steps over ~300-700ms total.
 */
async function moveMouseHuman(page, x, y, { steps = 18, totalMs = null } = {}) {
  try {
    // Read current cursor position from Playwright's internal state. There's
    // no public API for this, so we accept a slight estimation error.
    const startX = page._mouseX || randomInt(200, 800)
    const startY = page._mouseY || randomInt(200, 500)

    const path = bezierPath(startX, startY, x, y, steps)
    const stepDelay = (totalMs || randomInt(300, 700)) / steps

    for (const [px, py] of path) {
      await page.mouse.move(px, py, { steps: 1 })
      // Small random per-step jitter — real movement isn't perfectly even
      await new Promise(r => setTimeout(r, stepDelay + randomFloat(-5, 15)))
    }
    // Track final position so next call has a real starting point
    page._mouseX = x
    page._mouseY = y
  } catch (_) {
    // Mouse may not be initialized yet — fall back to straight move
    try { await page.mouse.move(x, y) } catch (__) {}
  }
}

/**
 * Hover over an element for a realistic "reading" duration. Returns the
 * time spent so callers can log it. A real human pauses 800-2200ms when
 * skimming a post before scrolling past.
 */
async function hoverAndDwell(page, selector, { minMs = 700, maxMs = 2200 } = {}) {
  try {
    const el = typeof selector === 'string' ? await page.$(selector) : selector
    if (!el) return 0
    const box = await el.boundingBox()
    if (!box) return 0
    // Move to a slightly random point within the element
    const x = box.x + box.width * randomFloat(0.25, 0.75)
    const y = box.y + box.height * randomFloat(0.25, 0.75)
    await moveMouseHuman(page, x, y)
    const dwell = randomInt(minMs, maxMs)
    await new Promise(r => setTimeout(r, dwell))
    return dwell
  } catch (_) { return 0 }
}

/**
 * Wander the mouse to N random viewport points. Used between major actions
 * to simulate a user idly moving the cursor while reading.
 */
async function wanderRandomly(page, { points = 2 } = {}) {
  try {
    const vp = page.viewportSize() || { width: 1366, height: 768 }
    for (let i = 0; i < points; i++) {
      const x = randomInt(100, vp.width - 100)
      const y = randomInt(100, vp.height - 100)
      await moveMouseHuman(page, x, y, { steps: randomInt(12, 20) })
      await new Promise(r => setTimeout(r, randomInt(150, 500)))
    }
  } catch (_) {}
}

module.exports = { bezierPath, moveMouseHuman, hoverAndDwell, wanderRandomly }
