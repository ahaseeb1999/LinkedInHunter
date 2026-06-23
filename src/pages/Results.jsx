import { useState, useEffect, Fragment } from 'react'
import useStore from '../store/useStore'
import StatusBadge, { StatusSelect } from '../components/StatusBadge'

const TABS = ['All', 'Jobs', 'Posts']

export default function Results() {
  const { jobs, posts, loadJobs, loadPosts, activeAccountId,
          updateJobStatus, updateJobNotes, toggleSaveJob, toggleSavePost,
          showNotification } = useStore()

  const [activeTab, setActiveTab]     = useState('All')
  const [selectedJob, setSelectedJob] = useState(null)
  const [keyword, setKeyword]         = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortField, setSortField]     = useState('date_posted')
  const [sortDir, setSortDir]         = useState('desc')
  const [selected, setSelected]       = useState([])
  const [hideDupes, setHideDupes]     = useState(true)
  const [exporting, setExporting]     = useState(false)
  const [editNotes, setEditNotes]     = useState('')
  const [notesJobId, setNotesJobId]   = useState(null)

  useEffect(() => {
    loadJobs({ accountId: activeAccountId })
    loadPosts({ accountId: activeAccountId })
  }, [activeAccountId])

  const filteredJobs = jobs
    .filter(j => {
      if (hideDupes && j.is_duplicate) return false
      if (keyword && !`${j.title} ${j.company} ${j.description}`.toLowerCase().includes(keyword.toLowerCase())) return false
      if (statusFilter !== 'All' && j.status !== statusFilter) return false
      return true
    })
    .sort((a, b) => {
      const av = a[sortField] || '', bv = b[sortField] || ''
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })

  const filteredPosts = posts
    .filter(p => {
      if (hideDupes && p.is_duplicate) return false
      if (keyword && !`${p.author_name} ${p.content}`.toLowerCase().includes(keyword.toLowerCase())) return false
      return true
    })
    .sort((a, b) => (sortDir === 'asc' ? (a.post_date || '').localeCompare(b.post_date || '') : (b.post_date || '').localeCompare(a.post_date || '')))

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortIcon = ({ field }) => sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅'

  const handleExport = async () => {
    setExporting(true)
    try {
      const jobIds = selected.filter(id => jobs.find(j => j.id === id)).map(Number)
      const postIds = selected.filter(id => posts.find(p => p.id === id)).map(Number)
      await window.linkedinAPI.export.excel({ jobIds, postIds, accountId: activeAccountId })
      showNotification('✅ Excel exported to Downloads folder', 'success')
    } catch (e) {
      showNotification('Export failed: ' + e.message, 'error')
    } finally {
      setExporting(false)
    }
  }

  const toggleSelect = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  // Copy any URL to clipboard with confirmation
  const copyToClipboard = async (url, label = 'Link') => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      showNotification(`📋 ${label} copied to clipboard`, 'success')
    } catch (e) {
      // Fallback for older clipboards / permission issues
      try {
        const ta = document.createElement('textarea')
        ta.value = url
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        showNotification(`📋 ${label} copied`, 'success')
      } catch (_) {
        showNotification('Could not copy — select the URL manually', 'error')
      }
    }
  }
  const selectAll = () => {
    const ids = activeTab !== 'Posts' ? filteredJobs.map(j => j.id) : filteredPosts.map(p => p.id)
    setSelected(ids)
  }

  const saveNotes = async () => {
    if (notesJobId !== null) {
      await updateJobNotes(notesJobId, editNotes)
      setNotesJobId(null)
    }
  }

  const totalCount = (activeTab === 'Jobs' ? filteredJobs.length : activeTab === 'Posts' ? filteredPosts.length : filteredJobs.length + filteredPosts.length)

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">📋 Results</h1>
          <p className="page-subtitle">{totalCount} total entries — sorted by newest first</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {selected.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setSelected([])}>
              Clear ({selected.length})
            </button>
          )}
          <button className="btn btn-success btn-sm" onClick={handleExport} disabled={exporting} id="export-excel-btn">
            {exporting ? '⟳ Exporting…' : '📊 Export Excel'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="input"
          style={{ flex: 1, maxWidth: 280 }}
          placeholder="🔎 Filter by keyword…"
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          id="results-filter-input"
        />
        <select className="select" style={{ width: 140 }} value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}>
          {['All', 'New', 'Applied', 'Interviewing', 'Rejected', 'Offer'].map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-sm" onClick={selectAll}>Select All</button>
        <button
          className={`btn btn-sm ${hideDupes ? 'btn-secondary' : 'btn-ghost'}`}
          onClick={() => setHideDupes(v => !v)}
          title="Hide entries already found in earlier hunts"
        >
          {hideDupes ? '✓ Hiding duplicates' : 'Show duplicates'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { loadJobs({ accountId: activeAccountId }); loadPosts({ accountId: activeAccountId }) }}>↻ Reload</button>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {TABS.map(t => {
          const count = t === 'Jobs' ? filteredJobs.length : t === 'Posts' ? filteredPosts.length : filteredJobs.length + filteredPosts.length
          return (
            <button key={t} className={`tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t)}>
              {t} <span className="tab-count">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Jobs table */}
      {activeTab !== 'Posts' && filteredJobs.length > 0 && (
        <div className="table-wrapper" style={{ marginBottom: 24 }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" onChange={e => e.target.checked ? selectAll() : setSelected([])}
                    checked={selected.length === filteredJobs.length && filteredJobs.length > 0}
                    style={{ cursor: 'pointer' }} />
                </th>
                <th onClick={() => handleSort('status')}>Status <SortIcon field="status" /></th>
                <th onClick={() => handleSort('title')}>Title <SortIcon field="title" /></th>
                <th onClick={() => handleSort('company')}>Company <SortIcon field="company" /></th>
                <th onClick={() => handleSort('date_posted')}>Posted <SortIcon field="date_posted" /></th>
                <th>Type</th>
                <th>Apply</th>
                <th>Applicants</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => (
                <Fragment key={job.id}>
                  <tr
                    className={`${job.is_duplicate ? 'duplicate-row' : ''} ${selected.includes(job.id) ? 'selected-row' : ''}`}
                    onClick={() => setSelectedJob(selectedJob?.id === job.id ? null : job)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td onClick={e => { e.stopPropagation(); toggleSelect(job.id) }}>
                      <input type="checkbox" checked={selected.includes(job.id)} onChange={() => {}} style={{ cursor: 'pointer' }} />
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <StatusSelect value={job.status} onChange={s => updateJobStatus(job.id, s)} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{job.title}</div>
                      {job.is_duplicate ? <span className="badge badge-duplicate">⚠ DUPLICATE</span> : null}
                    </td>
                    <td className="td-muted">{job.company}</td>
                    <td className="td-muted" style={{ whiteSpace: 'nowrap' }}>
                      {job.date_posted ? new Date(job.date_posted).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                    </td>
                    <td>
                      {job.job_type ? <span className="badge badge-new">{job.job_type}</span> : '—'}
                    </td>
                    <td>
                      <span className={`badge ${job.apply_type === 'Easy Apply' ? 'badge-easyapply' : 'badge-external'}`}>
                        {job.apply_type || 'External'}
                      </span>
                    </td>
                    <td className="td-muted">{job.applicants_count || '—'}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          data-tooltip={job.is_saved ? 'Unsave' : 'Save'}
                          onClick={() => toggleSaveJob(job.id)}
                          style={{ color: job.is_saved ? 'var(--warning)' : undefined }}
                        >
                          {job.is_saved ? '🔖' : '☆'}
                        </button>
                        {job.apply_url && (
                          <>
                            <a href={job.apply_url} target="_blank" rel="noreferrer"
                              className="btn btn-primary btn-sm" onClick={e => e.stopPropagation()}>
                              Apply →
                            </a>
                            <button
                              className="btn btn-ghost btn-sm"
                              data-tooltip="Copy job link"
                              onClick={() => copyToClipboard(job.apply_url, 'Job link')}
                            >
                              📋
                            </button>
                          </>
                        )}
                        <button className="btn btn-ghost btn-sm"
                          onClick={() => { setNotesJobId(job.id); setEditNotes(job.notes || '') }}>
                          📝
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded row detail */}
                  {selectedJob?.id === job.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: 0 }}>
                        <div style={{ padding: '16px 20px', background: 'rgba(0,119,181,0.04)', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
                            {job.location && <span className="td-muted">📍 {job.location}</span>}
                            {job.salary && <span className="td-muted">💰 {job.salary}</span>}
                            {job.industry && <span className="td-muted">🏭 {job.industry}</span>}
                            {job.company_size && <span className="td-muted">👥 {job.company_size}</span>}
                          </div>
                          {job.description && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, maxHeight: 240, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                              {job.description}
                            </div>
                          )}
                          {job.notes && (
                            <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-secondary)' }}>
                              📝 {job.notes}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Posts grid */}
      {activeTab !== 'Jobs' && filteredPosts.length > 0 && (
        <div className="post-cards-grid">
          {filteredPosts.map(post => {
            let links = []
            try { links = JSON.parse(post.links || '[]') } catch {}
            // Fallback when the exact post permalink couldn't be captured:
            // open the author's recent posts so there's always a post link.
            const recentActivityUrl = (post.author_url && /\/in\//.test(post.author_url))
              ? post.author_url.replace(/\/+$/, '') + '/recent-activity/all/'
              : null
            return (
              <div key={post.id} className={`post-card${post.is_duplicate ? ' duplicate' : ''}`}>
                <div className="post-author">
                  <div className="post-avatar">
                    {(post.author_name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="post-author-name">{post.author_name || 'Unknown'}</div>
                    <div className="post-author-headline">{post.author_headline}</div>
                  </div>
                  {post.is_duplicate && <span className="badge badge-duplicate" style={{ marginLeft: 'auto' }}>⚠ DUPE</span>}
                </div>
                <p className="post-content">{post.content}</p>
                {links.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {links.slice(0, 2).map((link, i) => (
                      <a key={i} href={link} target="_blank" rel="noreferrer"
                        className="btn btn-primary btn-sm">
                        🔗 Link {i + 1}
                      </a>
                    ))}
                  </div>
                )}
                <div className="post-footer">
                  <div className="post-stats">
                    <span>👍 {post.reactions || 0}</span>
                    <span>💬 {post.comments || 0}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="post-date">{post.post_date || '—'}</span>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => toggleSavePost(post.id)}
                      style={{ color: post.is_saved ? 'var(--warning)' : undefined }}>
                      {post.is_saved ? '🔖' : '☆'}
                    </button>
                    {/* Post permalink — exact link if we have it, else the
                        author's recent posts so there's always a post link. */}
                    {post.post_url ? (
                      <>
                        <a href={post.post_url} target="_blank" rel="noreferrer"
                           className="btn btn-primary btn-sm" title={post.post_url}>
                          🔗 Open Post →
                        </a>
                        <button
                          className="btn btn-ghost btn-sm"
                          data-tooltip="Copy post link"
                          onClick={() => copyToClipboard(post.post_url, 'Post link')}
                        >
                          📋
                        </button>
                      </>
                    ) : recentActivityUrl ? (
                      <>
                        <a href={recentActivityUrl} target="_blank" rel="noreferrer"
                           className="btn btn-primary btn-sm"
                           title="Exact post link unavailable — opens this author's recent posts">
                          🔗 Author's posts →
                        </a>
                        <button
                          className="btn btn-ghost btn-sm"
                          data-tooltip="Copy link"
                          onClick={() => copyToClipboard(recentActivityUrl, 'Author posts link')}
                        >
                          📋
                        </button>
                      </>
                    ) : null}
                    {post.author_url && (
                      <>
                        <a href={post.author_url} target="_blank" rel="noreferrer"
                           className="btn btn-secondary btn-sm">
                          👤 Profile
                        </a>
                        <button
                          className="btn btn-ghost btn-sm"
                          data-tooltip="Copy profile link"
                          onClick={() => copyToClipboard(post.author_url, 'Profile link')}
                        >
                          📋
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">No results yet</div>
          <div className="empty-state-desc">Run a hunt from the Search page to populate results here.</div>
        </div>
      )}

      {/* Notes modal */}
      {notesJobId !== null && (
        <div className="modal-overlay" onClick={() => setNotesJobId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">📝 Edit Notes</div>
            <textarea
              className="input"
              style={{ minHeight: 120, marginTop: 10 }}
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder="Your notes about this job…"
              autoFocus
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setNotesJobId(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveNotes}>Save Notes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
