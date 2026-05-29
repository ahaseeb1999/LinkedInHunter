const { getDB } = require('./db')
const crypto = require('crypto')

function makeJobHash(job) {
  const str = `${(job.title || '').toLowerCase().trim()}|${(job.company || '').toLowerCase().trim()}|${(job.date_posted || '').trim()}`
  return crypto.createHash('md5').update(str).digest('hex')
}

// ── Searches ──────────────────────────────────
function createSearch({ accountId, keywords, filters, source, runAt }) {
  const result = getDB().prepare(
    'INSERT INTO searches (account_id, keywords, filters, source, run_at) VALUES (?, ?, ?, ?, ?)'
  ).run([accountId, JSON.stringify(keywords), JSON.stringify(filters || {}), source || 'both', runAt || new Date().toISOString()])
  return result.lastInsertRowid
}

function updateSearchCount(searchId, count) {
  getDB().prepare('UPDATE searches SET results_count = ? WHERE id = ?').run([count, searchId])
}

function getSearchHistory() {
  return getDB().prepare(`
    SELECT s.*, a.name as account_name
    FROM searches s
    LEFT JOIN accounts a ON s.account_id = a.id
    ORDER BY s.run_at DESC
    LIMIT 50
  `).all()
}

// ── Jobs ──────────────────────────────────────
function insertJob(job) {
  const db = getDB()
  const hash = makeJobHash(job)
  const existing = db.prepare('SELECT id FROM jobs WHERE hash = ?').get(hash)
  const isDuplicate = !!existing

  if (isDuplicate) {
    db.prepare('UPDATE jobs SET is_duplicate = 1 WHERE hash = ?').run(hash)
    return { isDuplicate: true, id: existing.id }
  }

  const result = db.prepare(`
    INSERT INTO jobs (
      search_id, account_id, title, company, location, date_posted,
      description, apply_url, apply_type, applicants_count, industry,
      company_size, job_type, salary, is_remote, hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'New')
  `).run([
    job.searchId, job.accountId, job.title || '', job.company || '', job.location || '',
    job.date_posted || '', job.description || '', job.apply_url || '', job.apply_type || '',
    job.applicants_count || '', job.industry || '', job.company_size || '', job.job_type || '',
    job.salary || '', job.is_remote ? 1 : 0, hash
  ])

  return { isDuplicate: false, id: result.lastInsertRowid }
}

function getAllJobs(filters = {}) {
  let query = `
    SELECT j.*, a.name as account_name
    FROM jobs j
    LEFT JOIN accounts a ON j.account_id = a.id
    WHERE 1=1
  `
  const params = []

  if (filters.accountId) { query += ' AND j.account_id = ?'; params.push(filters.accountId) }
  if (filters.status) { query += ' AND j.status = ?'; params.push(filters.status) }
  if (filters.isSaved) { query += ' AND j.is_saved = 1' }
  if (filters.searchId) { query += ' AND j.search_id = ?'; params.push(filters.searchId) }
  if (filters.keyword) {
    query += ' AND (j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)'
    const kw = `%${filters.keyword}%`
    params.push(kw, kw, kw)
  }

  query += ' ORDER BY j.date_posted DESC, j.scraped_at DESC'

  if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit) }

  return getDB().prepare(query).all(params)
}

function getJob(id) {
  return getDB().prepare('SELECT * FROM jobs WHERE id = ?').get(id)
}

function updateJobStatus(id, status) {
  getDB().prepare('UPDATE jobs SET status = ? WHERE id = ?').run([status, id])
}

function updateJobNotes(id, notes) {
  getDB().prepare('UPDATE jobs SET notes = ? WHERE id = ?').run([notes, id])
}

function toggleSave(id) {
  const job = getDB().prepare('SELECT is_saved FROM jobs WHERE id = ?').get(id)
  if (!job) return false
  const newVal = job.is_saved ? 0 : 1
  getDB().prepare('UPDATE jobs SET is_saved = ? WHERE id = ?').run([newVal, id])
  return newVal === 1
}

module.exports = {
  createSearch, updateSearchCount, getSearchHistory,
  insertJob, getAllJobs, getJob, updateJobStatus, updateJobNotes, toggleSave
}
