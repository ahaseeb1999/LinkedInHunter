import { useState, useEffect } from 'react'
import useStore from '../store/useStore'
import SocialLinks from '../components/SocialLinks'

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

  // License state — lets users activate a key any time (incl. during trial)
  const [licState, setLicState] = useState({ kind: 'checking' })
  const [licKey, setLicKey]     = useState('')
  const [licBusy, setLicBusy]   = useState(false)
  const [licErr, setLicErr]     = useState('')

  useEffect(() => {
    loadSettings()
  }, [])

  useEffect(() => {
    let unsub = () => {}
    ;(async () => {
      try {
        setLicState(await window.linkedinAPI.license.getState())
        unsub = window.linkedinAPI.license.onStateChange(setLicState)
      } catch (_) {}
    })()
    return () => unsub?.()
  }, [])

  const activateLicense = async () => {
    setLicBusy(true); setLicErr('')
    try {
      const r = await window.linkedinAPI.license.activate(licKey.trim())
      if (r.ok) { setLicKey(''); showNotification('✅ License activated', 'success') }
      else setLicErr(licErrorMessage(r.error))
    } catch (e) { setLicErr(e.message) }
    finally { setLicBusy(false) }
  }

  const licDaysLeft = licState.expires_at
    ? Math.max(0, Math.ceil((new Date(licState.expires_at) - Date.now()) / 86400000))
    : null

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

        {/* License */}
        <div className="card card-glow">
          <Section title="🔑 License" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
              {licState.kind === 'licensed' && (
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>✅ Licensed{licDaysLeft != null ? ` · ${licDaysLeft} days left` : ''}</span>
              )}
              {licState.kind === 'trial' && (
                <span style={{ color: 'var(--warning)', fontWeight: 600 }}>🎁 Trial{licDaysLeft != null ? ` · ${licDaysLeft} day${licDaysLeft === 1 ? '' : 's'} left` : ''}</span>
              )}
              {!['licensed', 'trial'].includes(licState.kind) && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{licState.kind === 'checking' ? 'Checking…' : 'Not licensed'}</span>
              )}
            </div>

            {licState.kind !== 'licensed' && (
              <>
                <RowLabel
                  icon="🔑"
                  label={licState.kind === 'trial' ? 'Upgrade now with a license key' : 'Enter your license key'}
                  desc={licState.kind === 'trial' ? "Activate any time during your trial — you won't lose trial days, and you keep access after they end." : 'Paste the key the admin sent you.'}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    style={{ flex: 1, fontFamily: 'Cascadia Code, Consolas, monospace', letterSpacing: 1 }}
                    placeholder="LH-XXXX-XXXX-XXXX"
                    value={licKey}
                    spellCheck={false}
                    onChange={e => setLicKey(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter' && licKey.trim() && !licBusy) activateLicense() }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ flexShrink: 0 }}
                    disabled={licBusy || !licKey.trim()}
                    onClick={activateLicense}
                  >
                    {licBusy ? 'Checking…' : 'Activate'}
                  </button>
                </div>
                {licErr && (
                  <div style={{ fontSize: 12, color: 'var(--danger)', background: 'rgba(255,59,48,0.1)', border: '1px solid rgba(255,59,48,0.25)', borderRadius: 8, padding: '8px 12px' }}>
                    {licErr}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

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

        {/* About + author links */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10,
              background: 'var(--accent)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 18, fontWeight: 800, color: '#fff',
              boxShadow: '0 0 20px var(--accent-glow)',
            }}>LH</div>
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>LinkedIn Hunter v1.0.4</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Windows · Electron + React + Playwright + SQLite</div>
            </div>
          </div>
          <SocialLinks variant="card" />
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

function licErrorMessage(code) {
  return {
    invalid_key:    'Invalid license key. Double-check the spelling.',
    bad_key_format: 'Key format looks wrong. Should be LH-XXXX-XXXX-XXXX.',
    revoked:        'This license was revoked by the admin.',
    expired:        'This license has expired.',
    seat_full:      'This key has reached its maximum number of users. Ask the admin to free a seat or use a different key.',
    invalid_token:  'License needs to be re-activated.',
    network:        'Network problem — check your internet connection.',
    timeout:        'Server is slow to respond. Try again.',
  }[code] || ('Error: ' + (code || 'unknown'))
}
