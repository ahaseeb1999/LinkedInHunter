const { getDB } = require('./db')

function getAllAccounts() {
  return getDB().prepare('SELECT id, name, email, created_at, last_used FROM accounts ORDER BY last_used DESC').all()
}

function getAccount(id) {
  return getDB().prepare('SELECT * FROM accounts WHERE id = ?').get(id)
}

function addAccount({ name, email, cookies }) {
  const result = getDB().prepare(
    "INSERT INTO accounts (name, email, cookies, last_used) VALUES (?, ?, ?, datetime('now'))"
  ).run([name, email || '', JSON.stringify(cookies || [])])
  return result.lastInsertRowid
}

function updateAccountCookies(id, cookies) {
  getDB().prepare("UPDATE accounts SET cookies = ?, last_used = datetime('now') WHERE id = ?")
    .run([JSON.stringify(cookies), id])
}

function updateLastUsed(id) {
  getDB().prepare("UPDATE accounts SET last_used = datetime('now') WHERE id = ?").run(id)
}

function deleteAccount(id) {
  getDB().prepare('DELETE FROM accounts WHERE id = ?').run(id)
}

module.exports = { getAllAccounts, getAccount, addAccount, updateAccountCookies, updateLastUsed, deleteAccount }
