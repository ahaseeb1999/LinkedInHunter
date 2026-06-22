import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore'

const PLACEHOLDER_KEYWORDS = [
  'e.g. React Native Developer',
  'e.g. Remote iOS Engineer',
  'e.g. Mobile App Freelancer',
]

const EXPERIENCE_OPTIONS = ['Any', 'Entry', 'Mid', 'Senior', 'Lead']
const JOB_TYPE_OPTIONS   = ['Any', 'Full-time', 'Contract', 'Freelance', 'Part-time']
const DATE_RANGE_OPTIONS = [
  { label: 'Any time',    value: 'any' },
  { label: 'Past 24 hrs', value: '24h' },
  { label: 'Past week',   value: 'week' },
  { label: 'Past month',  value: 'month' },
]
const MAX_RESULTS_OPTIONS = ['25', '50', '100', '200']

export default function Search() {
  const navigate = useNavigate()
  const { accounts, activeAccountId, isSearching, isPaused, searchProgress,
          setSearching, addProgress, clearProgress, setLastResults,
          loadJobs, loadPosts, showNotification, loadDashboard,
          stopSearch, pauseSearch, resumeSearch } = useStore()

  const [keywords, setKeywords]           = useState(['', '', ''])
  const [source, setSource]               = useState('both')
  const [includeSimilar, setIncludeSimilar] = useState(false)
  const [showAdvanced, setShowAdvanced]   = useState(false)
  const [dupModal, setDupModal]           = useState(false)
  const [dupCount, setDupCount]           = useState(0)

  // Profile analyzer state
  const [analyzing, setAnalyzing]         = useState(false)
  const [profileResult, setProfileResult] = useState(null)  // { profile, suggestions }
  const [profileModal, setProfileModal]   = useState(false)
  const [customProfileUrl, setCustomProfileUrl] = useState('')

  const [filters, setFilters] = useState({
    experienceLevel: 'Any',
    jobType: 'Any',
    dateRange: 'any',
    workMode: 'Remote',           // Remote | Hybrid | On-site | Remote+Hybrid | Any
    strictHiringFilter: false,    // false = trust LinkedIn search, true = narrow filter
    location: '',
    companySize: 'Any',
    salaryMin: '',
    salaryMax: '',
    easyApplyOnly: false,
  })
  const [options, setOptions] = useState({
    maxResults: '50',
    dateFrom: '',
    dateTo: '',
    includeSimilar: false,
    // New post-source toggles (defaults: smart hunt enabled)
    useVoyager: true,            // Voyager API — primary, fast
    useHtmlFallback: true,       // fall back to DOM if Voyager fails
    useHashtags: false,          // /feed/hashtag/<tag> source
    useFeed: false,              // personal feed filtered by keyword
    expandKeywords: true,        // auto-expand keyword to variants
  })

  const progressRef = useRef(null)
  const cleanupRef  = useRef(null)

  useEffect(() => {
    if (progressRef.current)
      progressRef.current.scrollTop = progressRef.current.scrollHeight
  }, [searchProgress])

  useEffect(() => {
    if (!isSearching) return
    cleanupRef.current = window.linkedinAPI.search.onProgress((msg) => addProgress(msg))
    return () => cleanupRef.current?.()
  }, [isSearching])

  const handleSearch = async () => {
    if (!activeAccountId) {
      showNotification('Please add a LinkedIn account first', 'warning')
      return
    }
    const kws = keywords.filter(k => k.trim())
    if (kws.length === 0) {
      showNotification('Enter at least one keyword', 'warning')
      return
    }

    clearProgress()
    setSearching(true)

    try {
      const res = await window.linkedinAPI.search.run({
        accountId: activeAccountId,
        keywords: kws,
        source,
        filters,
        options: { ...options, includeSimilar },
      })

      if (res.success) {
        setLastResults(res.results)
        await loadJobs({ accountId: activeAccountId })
        await loadPosts({ accountId: activeAccountId })
        await loadDashboard()

        const jc = res.results.jobs?.length || 0
        const pc = res.results.posts?.length || 0
        const prefix = res.stopped ? '⏹ Stopped — saved ' : '✅ Found '

        if (res.results.duplicates > 0) {
          setDupCount(res.results.duplicates)
          setDupModal(true)
        } else if (jc === 0 && pc === 0) {
          showNotification(
            res.stopped
              ? '⏹ Stopped — nothing collected yet'
              : '⚠ Found 0 results. LinkedIn may have changed its layout, or session expired. Check the progress log for details.',
            res.stopped ? 'info' : 'warning'
          )
        } else {
          showNotification(`${prefix}${jc} jobs + ${pc} posts`, 'success')
          navigate('/results')
        }
      } else {
        showNotification(`Search failed: ${res.error}`, 'error')
      }
    } catch (err) {
      showNotification(`Error: ${err.message}`, 'error')
    } finally {
      setSearching(false)
    }
  }

  const updateFilter = (key, val) => setFilters(f => ({ ...f, [key]: val }))
  const updateOption = (key, val) => setOptions(o => ({ ...o, [key]: val }))

  // Escalating account-safety guidance for the (now custom) Max Results value.
  const maxN = Number(options.maxResults) || 0
  const maxWarn = maxN > 500
    ? { c: 'var(--danger)',  bg: 'rgba(255,59,48,0.10)',  b: 'rgba(255,59,48,0.30)',  t: '⚠ Very high. Pulling this many in a single hunt sharply raises the chance LinkedIn throttles or restricts your account. Strongly increase the delay between requests (Settings → Scraper Behaviour) and consider splitting across multiple accounts.' }
    : maxN > 200
    ? { c: 'var(--warning)', bg: 'rgba(255,149,0,0.10)', b: 'rgba(255,149,0,0.30)', t: '⚠ Above 200 increases account risk. Raise your request delay (Settings → Scraper Behaviour) to stay on the safe side.' }
    : { c: 'var(--text-muted)', bg: 'var(--bg-input)', b: 'var(--border)', t: '✓ Safe range. You can go higher (up to 1000), but more results = more requests = more account risk.' }

  const handleAnalyzeProfile = async () => {
    if (!activeAccountId) {
      showNotification('Add a LinkedIn account first', 'warning')
      return
    }
    setAnalyzing(true)
    setProfileResult(null)
    clearProgress()
    const cleanup = window.linkedinAPI.profile.onProgress((msg) => addProgress(msg))
    try {
      const res = await window.linkedinAPI.profile.analyze({
        accountId: activeAccountId,
        profileUrl: customProfileUrl?.trim() || undefined,
      })
      if (res.success) {
        setProfileResult({ profile: res.profile, suggestions: res.suggestions })
        setProfileModal(true)
        showNotification(`✅ Analyzed — ${res.suggestions.length} suggestions ready`, 'success')
      } else {
        showNotification(`Analyze failed: ${res.error}`, 'error')
      }
    } catch (e) {
      showNotification(`Error: ${e.message}`, 'error')
    } finally {
      cleanup?.()
      setAnalyzing(false)
    }
  }

  const applySuggestions = (picked) => {
    const filled = [...picked, '', '', ''].slice(0, 3)
    setKeywords(filled)
    setProfileModal(false)
    showNotification('🎯 Keywords loaded from profile', 'info')
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🔍 New Hunt</h1>
        <p className="page-subtitle">Configure your search and let LinkedIn Hunter find the opportunities</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>

        {/* ── Left: Search Config ── */}
        <div className="card card-glow">

          {/* Profile-based keyword suggestion */}
          <div className="form-group" style={{
            marginBottom: 20,
            padding: 14,
            background: 'linear-gradient(135deg, rgba(0,119,181,0.08), rgba(168,85,247,0.06))',
            border: '1px solid rgba(0,119,181,0.18)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  ✨ Smart Hunt — analyze your profile
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Pull keywords from your headline, skills & experience automatically
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAnalyzeProfile}
                disabled={analyzing}
                style={{ flexShrink: 0, fontWeight: 600 }}
              >
                {analyzing ? <><span className="spin">⟳</span> Analyzing…</> : '🔮 Analyze My Profile'}
              </button>
            </div>
            <input
              className="input"
              style={{ fontSize: 12 }}
              placeholder="Or paste a different profile URL (optional, e.g. https://linkedin.com/in/someone)"
              value={customProfileUrl}
              onChange={e => setCustomProfileUrl(e.target.value)}
              disabled={analyzing}
            />
          </div>

          {/* Keywords */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">🎯 Search Keywords</label>
            <div className="keyword-rows">
              {keywords.map((kw, i) => (
                <div className="keyword-row" key={i}>
                  <div className="keyword-row-num">{i + 1}</div>
                  <input
                    id={`keyword-${i}`}
                    className="input"
                    value={kw}
                    placeholder={PLACEHOLDER_KEYWORDS[i]}
                    onChange={e => {
                      const next = [...keywords]
                      next[i] = e.target.value
                      setKeywords(next)
                    }}
                  />
                </div>
              ))}
            </div>

            <label className="checkbox-row" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={includeSimilar}
                onChange={e => setIncludeSimilar(e.target.checked)}
              />
              <span className="custom-checkbox" />
              <span className="checkbox-label">Include similar jobs & searches found for hire</span>
            </label>
          </div>

          {/* Source selection */}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">📡 Search Source</label>
            <div className="source-toggle">
              {[
                { val: 'jobs',  icon: '💼', label: 'Jobs Only' },
                { val: 'posts', icon: '📣', label: 'Posts Only' },
                { val: 'both',  icon: '⚡', label: 'Both' },
              ].map(s => (
                <button
                  key={s.val}
                  id={`source-${s.val}`}
                  className={`source-pill${source === s.val ? ' active' : ''}`}
                  onClick={() => setSource(s.val)}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Work mode for jobs */}
          {(source === 'jobs' || source === 'both') && (
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">🏠 Work Mode</label>
              <div className="source-toggle">
                {[
                  { val: 'Remote',        icon: '🌐', label: 'Remote Only' },
                  { val: 'Remote+Hybrid', icon: '🔀', label: 'Remote + Hybrid' },
                  { val: 'Any',           icon: '🌍', label: 'Any (incl. On-site)' },
                ].map(m => (
                  <button
                    key={m.val}
                    className={`source-pill${filters.workMode === m.val ? ' active' : ''}`}
                    onClick={() => updateFilter('workMode', m.val)}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Strict filter for posts */}
          {(source === 'posts' || source === 'both') && (
            <label className="checkbox-row" style={{ marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={filters.strictHiringFilter}
                onChange={e => updateFilter('strictHiringFilter', e.target.checked)}
              />
              <span className="custom-checkbox" />
              <span className="checkbox-label">
                Strict hiring filter for posts
                <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2 }}>
                  When OFF (recommended): keep all posts LinkedIn's search returned. When ON: only keep posts with clear hiring language.
                </span>
              </span>
            </label>
          )}

          {/* Post sources panel */}
          {(source === 'posts' || source === 'both') && (
            <div style={{
              marginBottom: 16,
              padding: 12,
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                🔬 Post sources & strategy
              </div>

              <label className="checkbox-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={options.useVoyager}
                       onChange={e => updateOption('useVoyager', e.target.checked)} />
                <span className="custom-checkbox" />
                <span className="checkbox-label">
                  Voyager API <span style={{ color: 'var(--success)', fontSize: 11 }}>(recommended — fastest)</span>
                </span>
              </label>

              <label className="checkbox-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={options.useHtmlFallback}
                       onChange={e => updateOption('useHtmlFallback', e.target.checked)} />
                <span className="custom-checkbox" />
                <span className="checkbox-label">HTML fallback (when Voyager returns few results)</span>
              </label>

              <label className="checkbox-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={options.useHashtags}
                       onChange={e => updateOption('useHashtags', e.target.checked)} />
                <span className="custom-checkbox" />
                <span className="checkbox-label">
                  Hashtag pages <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(slower — visits /feed/hashtag/)</span>
                </span>
              </label>

              <label className="checkbox-row" style={{ marginBottom: 8 }}>
                <input type="checkbox" checked={options.useFeed}
                       onChange={e => updateOption('useFeed', e.target.checked)} />
                <span className="custom-checkbox" />
                <span className="checkbox-label">
                  Personal feed <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(scans your feed for matching posts)</span>
                </span>
              </label>

              <label className="checkbox-row">
                <input type="checkbox" checked={options.expandKeywords}
                       onChange={e => updateOption('expandKeywords', e.target.checked)} />
                <span className="custom-checkbox" />
                <span className="checkbox-label">
                  Auto-expand keywords to variants <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>(e.g. "React Native" → also "RN developer")</span>
                </span>
              </label>
            </div>
          )}

          {/* Max results (custom) & date range */}
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div className="form-group">
              <label className="form-label">Max Results <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>(custom, up to 1000)</span></label>
              <input
                type="number"
                className="input"
                min={1}
                max={1000}
                value={options.maxResults}
                placeholder="e.g. 50"
                onChange={e => updateOption('maxResults', e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={e => {
                  let n = parseInt(e.target.value, 10)
                  if (!Number.isFinite(n) || n < 1) n = 25
                  if (n > 1000) n = 1000
                  updateOption('maxResults', String(n))
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {MAX_RESULTS_OPTIONS.map(o => (
                  <button
                    key={o}
                    type="button"
                    className={`source-pill${String(options.maxResults) === o ? ' active' : ''}`}
                    style={{ padding: '4px 12px', fontSize: 12 }}
                    onClick={() => updateOption('maxResults', o)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Date Posted</label>
              <select
                className="select"
                value={filters.dateRange}
                onChange={e => updateFilter('dateRange', e.target.value)}
              >
                {DATE_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Escalating account-safety note for Max Results */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            marginBottom: 16, padding: '9px 12px',
            background: maxWarn.bg, border: `1px solid ${maxWarn.b}`,
            borderRadius: 'var(--radius-md)', fontSize: 11.5, lineHeight: 1.5, color: maxWarn.c,
          }}>
            <span>{maxWarn.t}</span>
          </div>

          {/* Date from/to */}
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">From Date (optional)</label>
              <input
                type="date"
                className="input"
                value={options.dateFrom}
                onChange={e => updateOption('dateFrom', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">To Date (optional)</label>
              <input
                type="date"
                className="input"
                value={options.dateTo}
                onChange={e => updateOption('dateTo', e.target.value)}
              />
            </div>
          </div>

          {/* Advanced filters collapsible */}
          <div>
            <div
              className="collapsible-header"
              onClick={() => setShowAdvanced(v => !v)}
              id="advanced-filters-toggle"
            >
              <span className="collapsible-title">⚙️ Advanced Filters <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(optional)</span></span>
              <span className={`collapsible-arrow${showAdvanced ? ' open' : ''}`}>▼</span>
            </div>

            {showAdvanced && (
              <div style={{ paddingBottom: 16 }}>
                <div className="grid-2" style={{ marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Experience Level</label>
                    <select className="select" value={filters.experienceLevel}
                      onChange={e => updateFilter('experienceLevel', e.target.value)}>
                      {EXPERIENCE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Job Type</label>
                    <select className="select" value={filters.jobType}
                      onChange={e => updateFilter('jobType', e.target.value)}>
                      {JOB_TYPE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid-2" style={{ marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Location (optional)</label>
                    <input className="input" placeholder="e.g. United States" value={filters.location}
                      onChange={e => updateFilter('location', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Company Size</label>
                    <select className="select" value={filters.companySize}
                      onChange={e => updateFilter('companySize', e.target.value)}>
                      {['Any', 'Startup (1–50)', 'Mid (51–500)', 'Enterprise (500+)'].map(o => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid-2" style={{ marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Min Salary (optional)</label>
                    <input className="input" placeholder="e.g. 50000" value={filters.salaryMin}
                      onChange={e => updateFilter('salaryMin', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Salary (optional)</label>
                    <input className="input" placeholder="e.g. 120000" value={filters.salaryMax}
                      onChange={e => updateFilter('salaryMax', e.target.value)} />
                  </div>
                </div>

                <label className="checkbox-row">
                  <input type="checkbox" checked={filters.easyApplyOnly}
                    onChange={e => updateFilter('easyApplyOnly', e.target.checked)} />
                  <span className="custom-checkbox" />
                  <span className="checkbox-label">Easy Apply only</span>
                </label>
              </div>
            )}
          </div>

          {/* Hunt button + controls */}
          {!isSearching ? (
            <button
              id="start-hunt-btn"
              className="hunt-btn"
              onClick={handleSearch}
            >
              <span>🚀</span> Start Hunt
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button
                className="hunt-btn running"
                disabled
                style={{ flex: 2, cursor: 'default' }}
              >
                <span className="spin">⟳</span> {isPaused ? 'Paused' : 'Hunting...'}
              </button>
              {!isPaused ? (
                <button
                  className="btn btn-secondary"
                  onClick={pauseSearch}
                  style={{ flex: 1, fontWeight: 600 }}
                  title="Pause between steps — currently running detail page will finish"
                >
                  ⏸ Pause
                </button>
              ) : (
                <button
                  className="btn btn-success"
                  onClick={resumeSearch}
                  style={{ flex: 1, fontWeight: 600 }}
                >
                  ▶ Resume
                </button>
              )}
              <button
                className="btn btn-danger"
                onClick={stopSearch}
                style={{ flex: 1, fontWeight: 600 }}
                title="Stop the hunt and save what was collected"
              >
                ⏹ Stop
              </button>
            </div>
          )}
        </div>

        {/* ── Right: Progress + Account ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Active account */}
          <div className="card" style={{ padding: 16 }}>
            <div className="form-label" style={{ marginBottom: 10 }}>Active Account</div>
            {accounts.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                No accounts — go to Accounts page to add one
              </p>
            ) : (
              <select
                className="select"
                value={activeAccountId || ''}
                onChange={e => useStore.getState().setActiveAccount(Number(e.target.value))}
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name || a.email}</option>
                ))}
              </select>
            )}
          </div>

          {/* Progress log */}
          {(isSearching || searchProgress.length > 0) && (
            <div className="card" style={{ padding: 16 }}>
              <div className="form-label" style={{ marginBottom: 10 }}>
                {isSearching ? '⚡ Live Progress' : '📄 Last Run Log'}
              </div>

              {isSearching && (
                <div style={{ marginBottom: 10 }}>
                  <div className="progress-bar-wrap">
                    <div className="progress-bar-fill" style={{ width: '100%' }} />
                  </div>
                </div>
              )}

              <div className="progress-log" ref={progressRef}>
                {searchProgress.length === 0 && (
                  <div className="progress-log-line">Initializing scraper…</div>
                )}
                {searchProgress.map((line, i) => {
                  const cls = line.startsWith('✅') ? 'success'
                    : line.startsWith('❌') ? 'error'
                    : line.startsWith('🔍') || line.startsWith('📣') ? 'info'
                    : ''
                  return <div key={i} className={`progress-log-line ${cls}`}>{line}</div>
                })}
              </div>
            </div>
          )}

          {/* Tips card */}
          <div className="card" style={{ padding: 16 }}>
            <div className="form-label" style={{ marginBottom: 10 }}>💡 Pro Tips</div>
            <ul style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 2, paddingLeft: 14 }}>
              <li>Use specific role names for better results</li>
              <li>Run searches weekly for fresh postings</li>
              <li>Posts mode finds hidden freelance gigs</li>
              <li>Keep max results ≤ 100 to avoid rate limits</li>
              <li>Switch accounts if one gets throttled</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Profile suggestions modal */}
      {profileModal && profileResult && (
        <ProfileSuggestionsModal
          profile={profileResult.profile}
          suggestions={profileResult.suggestions}
          onPick={applySuggestions}
          onClose={() => setProfileModal(false)}
        />
      )}

      {/* Duplicate Modal */}
      {dupModal && (
        <div className="modal-overlay" onClick={() => setDupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">⚠️ Duplicates Detected</div>
            <div className="modal-desc">
              Found <strong style={{ color: 'var(--warning)' }}>{dupCount} duplicate entries</strong> from previous searches.<br /><br />
              Duplicates are kept in the database and <strong>highlighted in orange</strong> so you can easily identify them. They are also marked in Excel exports.
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setDupModal(false); navigate('/results') }}>
                View Results
              </button>
              <button className="btn btn-primary" id="dup-ok-btn" onClick={() => { setDupModal(false); navigate('/results') }}>
                Got it ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
//  Profile Suggestions Modal
// ─────────────────────────────────────────────
function ProfileSuggestionsModal({ profile, suggestions, onPick, onClose }) {
  const [picked, setPicked] = useState(suggestions.slice(0, 3))

  const toggle = (s) => {
    if (picked.includes(s)) setPicked(picked.filter(x => x !== s))
    else if (picked.length < 3) setPicked([...picked, s])
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
        <div className="modal-title">✨ Profile Insights</div>

        {profile.name && (
          <div style={{ marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{profile.name}</div>
            {profile.headline && (
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{profile.headline}</div>
            )}
            {profile.location && (
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>📍 {profile.location}</div>
            )}
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Pick up to 3 keywords to use for your hunt ({picked.length}/3 selected):
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {suggestions.map((s, i) => {
            const isPicked = picked.includes(s)
            const disabled = !isPicked && picked.length >= 3
            return (
              <button
                key={i}
                onClick={() => toggle(s)}
                disabled={disabled}
                style={{
                  padding: '8px 14px',
                  borderRadius: 99,
                  border: `1px solid ${isPicked ? 'var(--accent)' : 'var(--border)'}`,
                  background: isPicked ? 'var(--accent-soft)' : 'var(--bg-input)',
                  color: isPicked ? 'var(--accent-hover)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: isPicked ? 600 : 500,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {isPicked ? '✓ ' : ''}{s}
              </button>
            )
          })}
        </div>

        {profile.skills?.length > 0 && (
          <details style={{ marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer', userSelect: 'none' }}>
              View all {profile.skills.length} skills found
            </summary>
            <div style={{ marginTop: 8, lineHeight: 1.8 }}>
              {profile.skills.join(' · ')}
            </div>
          </details>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => onPick(picked)}
            disabled={picked.length === 0}
          >
            🎯 Use {picked.length} keyword{picked.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
