import { useState, useEffect } from 'react'
import useStore from '../store/useStore'

export default function Accounts() {
  const { accounts, loadAccounts, activeAccountId, setActiveAccount, showNotification } = useStore()
  const [adding, setAdding]     = useState(false)
  const [name, setName]         = useState('')
  const [checking, setChecking] = useState({})
  const [deleteId, setDeleteId] = useState(null)
  const [sessionStatus, setSessionStatus] = useState({})
  const [loginProgress, setLoginProgress] = useState([])

  useEffect(() => { loadAccounts() }, [])

  const handleAdd = async () => {
    if (!name.trim()) { showNotification('Enter a name for this account', 'warning'); return }
    setAdding(true)
    setLoginProgress([])
    const cleanup = window.linkedinAPI.accounts.onLoginProgress((msg) => {
      setLoginProgress(p => [...p.slice(-30), msg])
    })
    try {
      const res = await window.linkedinAPI.accounts.add({ name: name.trim() })
      if (res.success) {
        setName('')
        await loadAccounts()
        setActiveAccount(res.id)
        showNotification(`✅ Account "${name}" added — session captured`, 'success')
        setLoginProgress([])
      } else {
        showNotification(`Login failed: ${res.error}`, 'error')
      }
    } catch (e) {
      showNotification('Error: ' + e.message, 'error')
    } finally {
      cleanup?.()
      setAdding(false)
    }
  }

  const handleDelete = async (id) => {
    await window.linkedinAPI.accounts.delete(id)
    await loadAccounts()
    if (activeAccountId === id) setActiveAccount(accounts.find(a => a.id !== id)?.id || null)
    setDeleteId(null)
    showNotification('Account removed', 'info')
  }

  const handleCheckSession = async (id) => {
    setChecking(c => ({ ...c, [id]: true }))
    const { valid } = await window.linkedinAPI.accounts.checkSession(id)
    setSessionStatus(s => ({ ...s, [id]: valid }))
    setChecking(c => ({ ...c, [id]: false }))
    showNotification(valid ? '✅ Session is active' : '⚠️ Session expired — re-login needed', valid ? 'success' : 'warning')
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">👤 Accounts</h1>
        <p className="page-subtitle">Manage your LinkedIn accounts — each stores its own session cookies</p>
      </div>

      {/* Add Account */}
      <div className="card card-glow" style={{ marginBottom: 24, maxWidth: 520 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          ➕ Add LinkedIn Account
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
          A browser window will open for you to log into LinkedIn manually. Your password is <strong style={{ color: 'var(--text-secondary)' }}>never stored</strong> — only session cookies.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            id="account-name-input"
            className="input"
            placeholder="Account label (e.g. My Main Account)"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            disabled={adding}
          />
          <button
            id="add-account-btn"
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={adding || !name.trim()}
            style={{ whiteSpace: 'nowrap' }}
          >
            {adding ? <><span className="spin">⟳</span> Opening…</> : '🔐 Login'}
          </button>
        </div>

        {/* ToS Notice */}
        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          background: 'rgba(255,149,0,0.08)',
          border: '1px solid rgba(255,149,0,0.2)',
          borderRadius: 'var(--radius-md)',
          fontSize: 11,
          color: 'var(--warning)',
          lineHeight: 1.6,
        }}>
          ⚠️ <strong>Note:</strong> Automated scraping is against LinkedIn's ToS. Use responsibly — keep max results low and avoid running searches continuously. This tool is for personal use only.
        </div>

        {/* Live login progress */}
        {(adding || loginProgress.length > 0) && (
          <div style={{
            marginTop: 14,
            padding: '12px 14px',
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
            lineHeight: 1.7,
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            <div style={{ fontWeight: 700, color: 'var(--accent-hover)', marginBottom: 6 }}>
              {adding ? '⟳ Live login status' : '✓ Last login'}
            </div>
            {loginProgress.length === 0
              ? <div style={{ color: 'var(--text-muted)' }}>Opening Chromium window...</div>
              : loginProgress.map((line, i) => <div key={i}>› {line}</div>)
            }
          </div>
        )}
      </div>

      {/* Accounts list */}
      {accounts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👤</div>
          <div className="empty-state-title">No accounts yet</div>
          <div className="empty-state-desc">Add your first LinkedIn account above to start hunting.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
          {accounts.map(acc => (
            <div
              key={acc.id}
              className="card"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                borderColor: acc.id === activeAccountId ? 'var(--accent)' : undefined,
                background: acc.id === activeAccountId ? 'var(--accent-soft)' : undefined,
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 46, height: 46, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent), #a855f7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0,
              }}>
                {(acc.name || acc.email || '?')[0].toUpperCase()}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                    {acc.name}
                  </span>
                  {acc.id === activeAccountId && (
                    <span className="badge badge-applied" style={{ fontSize: 10 }}>● Active</span>
                  )}
                  {sessionStatus[acc.id] === true  && <span className="badge badge-interviewing" style={{ fontSize: 10 }}>✅ Session OK</span>}
                  {sessionStatus[acc.id] === false && <span className="badge badge-rejected"     style={{ fontSize: 10 }}>⚠️ Expired</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {acc.email && <span style={{ marginRight: 12 }}>✉️ {acc.email}</span>}
                  {acc.last_used && <span>Last used: {acc.last_used.split('T')[0]}</span>}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {acc.id !== activeAccountId && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setActiveAccount(acc.id)}
                  >
                    Use This
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleCheckSession(acc.id)}
                  disabled={checking[acc.id]}
                  data-tooltip="Check if session is still valid"
                >
                  {checking[acc.id] ? <span className="spin">⟳</span> : '🔄'}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setDeleteId(acc.id)}
                  data-tooltip="Delete account"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info card */}
      <div className="card" style={{ marginTop: 24, maxWidth: 520, padding: 16 }}>
        <div className="form-label" style={{ marginBottom: 10 }}>ℹ️ How accounts work</div>
        <ul style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2, paddingLeft: 16 }}>
          <li>Each account logs in via a real browser window — no password stored</li>
          <li>Session cookies are saved locally and encrypted</li>
          <li>If a session expires, simply delete and re-add the account</li>
          <li>Switch accounts to distribute search load and avoid rate limiting</li>
          <li>You can add multiple accounts for the same LinkedIn profile</li>
        </ul>
      </div>

      {/* Delete confirm modal */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">🗑 Delete Account</div>
            <div className="modal-desc">
              This will remove the account and its saved session cookies.<br />
              <strong>Job and post data will NOT be deleted.</strong>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>Cancel</button>
              <button className="btn btn-danger" id="confirm-delete-btn" onClick={() => handleDelete(deleteId)}>
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
