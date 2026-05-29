import { useState, useEffect } from 'react'
import useStore from '../store/useStore'

export default function Settings() {
  const { settings, loadSettings, saveSettings, showNotification } = useStore()
  const [form, setForm] = useState({
    maxRequestsPerSession: '30',
    minDelay: '1500',
    maxDelay: '4000',
    duplicateHandling: 'ask',
    defaultExportPath: '',
    scheduledSearch: 'false',
    scheduleCron: '0 9 * * *',
  })
  const [clearing, setClearing] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  useEffect(() => {
    if (Object.keys(settings).length > 0) {
      setForm(f => ({ ...f, ...settings }))
    }
  }, [settings])

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    await saveSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    showNotification('✅ Settings saved', 'success')
  }

  const handleClearAll = async () => {
    setClearing(true)
    await window.linkedinAPI.data.clearAll()
    setClearConfirm(false)
    setClearing(false)
    showNotification('All job/post data cleared', 'info')
  }

  const RowLabel = ({ icon, label, desc }) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
        {icon} {label}
      </div>
      {desc && <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc}</div>}
    </div>
  )

  const Section = ({ title }) => (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, marginTop: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
      {title}
    </div>
  )

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">⚙️ Settings</h1>
          <p className="page-subtitle">Configure scraper behaviour, export paths, and scheduling</p>
        </div>
        <button
          id="save-settings-btn"
          className={`btn ${saved ? 'btn-success' : 'btn-primary'}`}
          onClick={handleSave}
        >
          {saved ? '✅ Saved!' : '💾 Save Settings'}
        </button>
      </div>

      <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Scraper Behaviour */}
        <div className="card card-glow">
          <Section title="🤖 Scraper Behaviour" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Max requests */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <RowLabel
                icon="🔢"
                label="Max Requests Per Session"
                desc="Stop scraping after this many pages per run. Keep ≤ 50 to be safe."
              />
              <input
                id="max-requests-input"
                type="number"
                className="input"
                style={{ width: 90, textAlign: 'center' }}
                value={form.maxRequestsPerSession}
                min="5" max="200"
                onChange={e => update('maxRequestsPerSession', e.target.value)}
              />
            </div>

            {/* Delay range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <RowLabel
                icon="⏱"
                label="Delay Between Requests"
                desc="Random delay range in milliseconds. Mimics human behaviour."
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                <input
                  type="number"
                  className="input"
                  style={{ width: 80, textAlign: 'center' }}
                  value={form.minDelay}
                  min="500" max="10000" step="100"
                  onChange={e => update('minDelay', e.target.value)}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>–</span>
                <input
                  type="number"
                  className="input"
                  style={{ width: 80, textAlign: 'center' }}
                  value={form.maxDelay}
                  min="1000" max="20000" step="100"
                  onChange={e => update('maxDelay', e.target.value)}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>ms</span>
              </div>
            </div>
          </div>
        </div>

        {/* Duplicate Handling */}
        <div className="card">
          <Section title="⚠️ Duplicate Handling" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { val: 'ask',       label: 'Always Ask',                    desc: 'Show a dialog whenever duplicates are found' },
              { val: 'skip',      label: 'Auto Skip Duplicates',          desc: 'Silently ignore already-seen posts and jobs' },
              { val: 'highlight', label: 'Keep with Highlight',           desc: 'Save duplicates but mark them in orange' },
            ].map(opt => (
              <label
                key={opt.val}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
                  padding: '10px 14px', borderRadius: 'var(--radius-md)',
                  border: `1px solid ${form.duplicateHandling === opt.val ? 'var(--accent)' : 'var(--border)'}`,
                  background: form.duplicateHandling === opt.val ? 'var(--accent-soft)' : 'var(--bg-input)',
                  transition: 'var(--transition)',
                }}
              >
                <input
                  type="radio"
                  name="duplicateHandling"
                  value={opt.val}
                  checked={form.duplicateHandling === opt.val}
                  onChange={() => update('duplicateHandling', opt.val)}
                  style={{ marginTop: 2 }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: form.duplicateHandling === opt.val ? 'var(--accent-hover)' : 'var(--text-primary)' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{opt.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Export */}
        <div className="card">
          <Section title="📊 Export" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <RowLabel
              icon="📁"
              label="Default Export Folder"
              desc="Where Excel files are saved. Leave empty to use Downloads folder."
            />
            <input
              className="input"
              placeholder="C:\Users\YourName\Downloads  (leave blank for default)"
              value={form.defaultExportPath}
              onChange={e => update('defaultExportPath', e.target.value)}
            />
          </div>
        </div>

        {/* Scheduled Search */}
        <div className="card">
          <Section title="⏰ Scheduled Search" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <RowLabel
                icon="🔁"
                label="Enable Scheduled Searches"
                desc="Automatically run the last search on a schedule in the background"
              />
              <label className="toggle-switch" onClick={() => update('scheduledSearch', form.scheduledSearch === 'true' ? 'false' : 'true')}>
                <div className={`toggle-track${form.scheduledSearch === 'true' ? ' on' : ''}`}>
                  <div className="toggle-thumb" />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {form.scheduledSearch === 'true' ? 'On' : 'Off'}
                </span>
              </label>
            </div>

            {form.scheduledSearch === 'true' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="form-label">Cron Schedule</div>
                <input
                  className="input"
                  value={form.scheduleCron}
                  onChange={e => update('scheduleCron', e.target.value)}
                  placeholder="0 9 * * *"
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Common: <code style={{ color: 'var(--accent-hover)' }}>0 9 * * *</code> = daily at 9am &nbsp;·&nbsp;
                  <code style={{ color: 'var(--accent-hover)' }}>0 9 * * 1</code> = every Monday at 9am
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="card" style={{ borderColor: 'rgba(255,59,48,0.2)' }}>
          <Section title="⛔ Danger Zone" />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <RowLabel
              icon="🗑"
              label="Clear All Job & Post Data"
              desc="Permanently deletes all scraped jobs, posts, and search history. Accounts are kept."
            />
            <button
              id="clear-data-btn"
              className="btn btn-danger btn-sm"
              onClick={() => setClearConfirm(true)}
              style={{ flexShrink: 0 }}
            >
              Clear All Data
            </button>
          </div>
        </div>

        {/* About */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10,
              background: 'var(--accent)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#fff',
              boxShadow: '0 0 20px var(--accent-glow)',
            }}>LH</div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>LinkedIn Hunter v1.0.0</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Windows · Electron + React + Playwright + SQLite</div>
            </div>
          </div>
        </div>

      </div>

      {/* Clear Confirm Modal */}
      {clearConfirm && (
        <div className="modal-overlay" onClick={() => setClearConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: 'var(--danger)' }}>⛔ Clear All Data?</div>
            <div className="modal-desc">
              This will <strong>permanently delete</strong> all scraped jobs, posts, and search history.<br /><br />
              Your accounts and settings will be kept. This action <strong>cannot be undone</strong>.
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setClearConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleClearAll} disabled={clearing}>
                {clearing ? '⟳ Clearing…' : '🗑 Yes, Delete Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
