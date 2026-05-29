import { useEffect, useState } from 'react'
import useStore from '../store/useStore'
import StatusBadge, { StatusSelect } from '../components/StatusBadge'

const KANBAN_COLS = [
  { key: 'New',          label: '○ New',          color: '#8888aa' },
  { key: 'Applied',      label: '📤 Applied',      color: '#0077b5' },
  { key: 'Interviewing', label: '🎯 Interviewing', color: '#00d4aa' },
  { key: 'Offer',        label: '🏆 Offer',        color: '#a855f7' },
  { key: 'Rejected',     label: '✗ Rejected',     color: '#ff3b30' },
]

export default function SavedJobs() {
  const { savedJobs, savedPosts, loadSaved, updateJobStatus, toggleSaveJob,
          toggleSavePost, activeAccountId, showNotification } = useStore()
  const [activeTab, setActiveTab] = useState('board')
  const [exporting, setExporting] = useState(false)

  useEffect(() => { loadSaved() }, [activeAccountId])

  const handleExport = async () => {
    setExporting(true)
    try {
      const jobIds  = savedJobs.map(j => j.id)
      const postIds = savedPosts.map(p => p.id)
      await window.linkedinAPI.export.excel({ jobIds, postIds, accountId: activeAccountId })
      showNotification('✅ Saved items exported to Downloads', 'success')
    } catch (e) {
      showNotification('Export failed: ' + e.message, 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">🔖 Saved Jobs</h1>
          <p className="page-subtitle">{savedJobs.length} saved jobs · {savedPosts.length} saved posts</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-success btn-sm" onClick={handleExport} disabled={exporting}>
            {exporting ? '⟳ Exporting…' : '📊 Export Saved'}
          </button>
        </div>
      </div>

      {/* View toggle */}
      <div className="tabs">
        <button className={`tab${activeTab === 'board' ? ' active' : ''}`} onClick={() => setActiveTab('board')}>
          🗂 Kanban Board
        </button>
        <button className={`tab${activeTab === 'list' ? ' active' : ''}`} onClick={() => setActiveTab('list')}>
          📋 List View <span className="tab-count">{savedJobs.length}</span>
        </button>
        <button className={`tab${activeTab === 'posts' ? ' active' : ''}`} onClick={() => setActiveTab('posts')}>
          📣 Saved Posts <span className="tab-count">{savedPosts.length}</span>
        </button>
      </div>

      {/* Kanban Board */}
      {activeTab === 'board' && (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12 }}>
          {KANBAN_COLS.map(col => {
            const colJobs = savedJobs.filter(j => (j.status || 'New') === col.key)
            return (
              <div key={col.key} style={{
                minWidth: 240, flex: '0 0 240px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
              }}>
                <div style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: `3px solid ${col.color}`,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: col.color }}>{col.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {colJobs.length}
                  </span>
                </div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120, maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
                  {colJobs.map(job => (
                    <div key={job.id} style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.4 }}>
                        {job.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{job.company}</div>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
                        <select
                          className="select"
                          value={job.status || 'New'}
                          onChange={e => updateJobStatus(job.id, e.target.value)}
                          style={{ fontSize: 10, padding: '3px 20px 3px 6px', flex: 1 }}
                        >
                          {KANBAN_COLS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => toggleSaveJob(job.id)}
                          style={{ padding: '3px 6px', color: 'var(--warning)' }}
                        >🔖</button>
                      </div>
                      {job.notes && (
                        <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          {job.notes.slice(0, 80)}{job.notes.length > 80 ? '…' : ''}
                        </div>
                      )}
                    </div>
                  ))}
                  {colJobs.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                      No jobs here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List View */}
      {activeTab === 'list' && (
        savedJobs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔖</div>
            <div className="empty-state-title">No saved jobs</div>
            <div className="empty-state-desc">Bookmark jobs from the Results page using the ☆ button.</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Title</th>
                  <th>Company</th>
                  <th>Date Posted</th>
                  <th>Apply Type</th>
                  <th>Notes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {savedJobs.map(job => (
                  <tr key={job.id} className={job.is_duplicate ? 'duplicate-row' : ''}>
                    <td><StatusSelect value={job.status} onChange={s => updateJobStatus(job.id, s)} /></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{job.title}</div>
                      {job.is_duplicate && <span className="badge badge-duplicate">⚠ DUPLICATE</span>}
                    </td>
                    <td className="td-muted">{job.company}</td>
                    <td className="td-muted">{job.date_posted || '—'}</td>
                    <td>
                      <span className={`badge ${job.apply_type === 'Easy Apply' ? 'badge-easyapply' : 'badge-external'}`}>
                        {job.apply_type || 'External'}
                      </span>
                    </td>
                    <td className="td-muted" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.notes || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {job.apply_url && (
                          <a href={job.apply_url} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Apply →</a>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleSaveJob(job.id)} style={{ color: 'var(--warning)' }}>
                          🗑 Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Saved Posts */}
      {activeTab === 'posts' && (
        savedPosts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📣</div>
            <div className="empty-state-title">No saved posts</div>
            <div className="empty-state-desc">Bookmark posts from Results using the ☆ button.</div>
          </div>
        ) : (
          <div className="post-cards-grid">
            {savedPosts.map(post => {
              let links = []
              try { links = JSON.parse(post.links || '[]') } catch {}
              return (
                <div key={post.id} className="post-card">
                  <div className="post-author">
                    <div className="post-avatar">{(post.author_name || '?')[0].toUpperCase()}</div>
                    <div>
                      <div className="post-author-name">{post.author_name}</div>
                      <div className="post-author-headline">{post.author_headline}</div>
                    </div>
                  </div>
                  <p className="post-content">{post.content}</p>
                  <div className="post-footer">
                    <div className="post-stats">
                      <span>👍 {post.reactions}</span>
                      <span>💬 {post.comments}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {links[0] && <a href={links[0]} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">🔗 Link</a>}
                      {post.author_url && <a href={post.author_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Profile →</a>}
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleSavePost(post.id)} style={{ color: 'var(--danger)' }}>🗑</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
