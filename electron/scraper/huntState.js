/**
 * Persist hunt progress so a crash mid-scrape doesn't lose all work.
 *
 * State written to `<userData>/hunt-state.json` after every keyword's posts
 * are saved. On next launch we check for unfinished state — if found, the
 * UI can offer to resume.
 *
 * State shape:
 *   {
 *     id: <random>,
 *     started_at: <iso>,
 *     keywords: [string],
 *     completedKeywords: [string],
 *     accountId: <id>,
 *     source: 'jobs'|'posts'|'both',
 *     filters: {...},
 *     options: {...},
 *     totalCaptured: <number>,
 *   }
 */

const fs = require('fs')
const path = require('path')

function getStatePath() {
  try {
    const electronApp = require('electron').app
    if (electronApp?.getPath) return path.join(electronApp.getPath('userData'), 'hunt-state.json')
  } catch (_) {}
  return path.join(__dirname, '../../data/hunt-state.json')
}

function loadHuntState() {
  const p = getStatePath()
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch (e) {
    console.warn('[huntState] Could not parse:', e.message)
    return null
  }
}

function saveHuntState(state) {
  const p = getStatePath()
  try {
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(p, JSON.stringify(state, null, 2))
    return true
  } catch (e) {
    console.warn('[huntState] Could not save:', e.message)
    return false
  }
}

function clearHuntState() {
  const p = getStatePath()
  try { fs.unlinkSync(p) } catch (_) {}
}

/** Mark a keyword as completed. Returns updated state. */
function markKeywordDone(state, keyword, captured) {
  if (!state) return null
  if (!state.completedKeywords.includes(keyword)) {
    state.completedKeywords.push(keyword)
  }
  state.totalCaptured = (state.totalCaptured || 0) + (captured || 0)
  saveHuntState(state)
  return state
}

/** Remaining keywords = original keywords − completed ones. */
function remainingKeywords(state) {
  if (!state) return []
  return (state.keywords || []).filter(k => !(state.completedKeywords || []).includes(k))
}

module.exports = {
  getStatePath, loadHuntState, saveHuntState, clearHuntState,
  markKeywordDone, remainingKeywords,
}
