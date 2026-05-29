const { getDB } = require('./db')
const crypto = require('crypto')

function makePostHash(post) {
  const str = `${(post.author_url || '').trim()}|${(post.post_date || '').trim()}|${(post.content || '').slice(0, 100)}`
  return crypto.createHash('md5').update(str).digest('hex')
}

function insertPost(post) {
  const db = getDB()
  const hash = makePostHash(post)
  const existing = db.prepare('SELECT id FROM posts WHERE hash = ?').get(hash)
  const isDuplicate = !!existing

  if (isDuplicate) {
    db.prepare('UPDATE posts SET is_duplicate = 1 WHERE hash = ?').run(hash)
    return { isDuplicate: true, id: existing.id }
  }

  const result = db.prepare(`
    INSERT INTO posts (
      search_id, account_id, author_name, author_url, author_headline,
      content, post_date, reactions, comments, links, post_url, hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    post.searchId, post.accountId, post.author_name || '', post.author_url || '',
    post.author_headline || '', post.content || '', post.post_date || '',
    String(post.reactions || 0), String(post.comments || 0),
    JSON.stringify(post.links || []), post.post_url || '', hash
  ])

  return { isDuplicate: false, id: result.lastInsertRowid }
}

function getAllPosts(filters = {}) {
  let query = `
    SELECT p.*, a.name as account_name
    FROM posts p
    LEFT JOIN accounts a ON p.account_id = a.id
    WHERE 1=1
  `
  const params = []

  if (filters.accountId) { query += ' AND p.account_id = ?'; params.push(filters.accountId) }
  if (filters.isSaved) { query += ' AND p.is_saved = 1' }
  if (filters.searchId) { query += ' AND p.search_id = ?'; params.push(filters.searchId) }
  if (filters.keyword) {
    query += ' AND (p.content LIKE ? OR p.author_name LIKE ?)'
    const kw = `%${filters.keyword}%`
    params.push(kw, kw)
  }

  query += ' ORDER BY p.post_date DESC, p.scraped_at DESC'
  if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit) }

  return getDB().prepare(query).all(params)
}

function getPost(id) {
  return getDB().prepare('SELECT * FROM posts WHERE id = ?').get(id)
}

function toggleSave(id) {
  const post = getDB().prepare('SELECT is_saved FROM posts WHERE id = ?').get(id)
  if (!post) return false
  const newVal = post.is_saved ? 0 : 1
  getDB().prepare('UPDATE posts SET is_saved = ? WHERE id = ?').run([newVal, id])
  return newVal === 1
}

module.exports = { insertPost, getAllPosts, getPost, toggleSave }
