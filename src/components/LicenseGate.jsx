import { useEffect, useState } from 'react'
import SocialLinks from './SocialLinks'

/**
 * LicenseGate — wraps the entire app. Until the license state is `licensed`
 * or `trial`, it renders an overlay instead of the main UI.
 *
 * States rendered:
 *   - checking         → loading spinner
 *   - needs_activation → entry screen with key + "Start trial"
 *   - trial_expired    → message + key entry
 *   - revoked          → message + key entry
 *   - kill_switch      → service-down message
 *   - offline_dead     → "couldn't reach server" message
 *   - trial / licensed → passthrough (renders children)
 *   - offline_grace    → passthrough but with a banner at top
 */
export default function LicenseGate({ children }) {
  const [state, setState] = useState({ kind: 'checking' })
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [key, setKey]     = useState('')

  useEffect(() => {
    let unsub = () => {}
    ;(async () => {
      const initial = await window.linkedinAPI.license.getState()
      setState(initial)
      unsub = window.linkedinAPI.license.onStateChange(setState)
    })()
    return () => unsub?.()
  }, [])

  const activate = async () => {
    setBusy(true); setError('')
    try {
      const r = await window.linkedinAPI.license.activate(key.trim())
      if (!r.ok) setError(errorMessage(r.error))
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  const startTrial = async () => {
    setBusy(true); setError('')
    try {
      const r = await window.linkedinAPI.license.startTrial()
      if (!r.ok) setError(errorMessage(r.error))
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  // Active states — render the app
  if (state.kind === 'licensed' || state.kind === 'trial') {
    return (
      <>
        {state.kind === 'trial' && <TrialBanner expiresAt={state.expires_at} />}
        {children}
      </>
    )
  }
  if (state.kind === 'offline_grace') {
    return (
      <>
        <OfflineBanner />
        {children}
      </>
    )
  }

  // Otherwise — render the overlay
  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>LH</div>
        <h1 style={titleStyle}>LinkedIn Hunter</h1>

        {state.kind === 'checking' && (
          <div style={subStyle}>Checking license…</div>
        )}

        {(state.kind === 'needs_activation' || state.kind === 'trial_expired' || state.kind === 'revoked') && (
          <>
            <div style={subStyle}>
              {state.kind === 'trial_expired' && '⏰ Your 3-day trial has ended.'}
              {state.kind === 'revoked'       && '🚫 This license was revoked by the admin.'}
              {state.kind === 'needs_activation' && 'Enter your license key to continue.'}
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>License key</label>
              <input
                value={key}
                onChange={e => setKey(e.target.value.toUpperCase())}
                placeholder="LH-XXXX-XXXX-XXXX"
                style={inputStyle}
                autoFocus
                spellCheck={false}
              />
            </div>

            <button onClick={activate} disabled={busy || !key.trim()} style={primaryBtnStyle}>
              {busy ? 'Checking…' : 'Activate'}
            </button>

            {state.kind === 'needs_activation' && (
              <>
                <div style={dividerStyle}>or</div>
                <button onClick={startTrial} disabled={busy} style={secondaryBtnStyle}>
                  {busy ? 'Starting trial…' : '🎁 Start 3-day free trial'}
                </button>
                <div style={{ ...subStyle, marginTop: 12, fontSize: 11 }}>
                  No card required. After 3 days you'll need a license key from the admin.
                </div>
              </>
            )}

            {error && <div style={errorStyle}>{error}</div>}
          </>
        )}

        {state.kind === 'kill_switch' && (
          <>
            <div style={subStyle}>🛑 Service temporarily unavailable.</div>
            <div style={{ ...subStyle, fontSize: 12, color: '#a0a0c0' }}>
              The admin has paused all access. Please try again later.
            </div>
            <button onClick={() => window.linkedinAPI.license.checkNow()} style={secondaryBtnStyle}>
              Retry
            </button>
          </>
        )}

        {state.kind === 'offline_dead' && (
          <>
            <div style={subStyle}>🌐 Couldn't reach the license server.</div>
            <div style={{ ...subStyle, fontSize: 12, color: '#a0a0c0' }}>
              Check your internet connection. The app works offline for 24h after the last
              successful check.
            </div>
            <button onClick={() => window.linkedinAPI.license.checkNow()} disabled={busy} style={primaryBtnStyle}>
              Try again
            </button>
          </>
        )}

        {/* Author credits — always visible on the gate */}
        <SocialLinks variant="minimal" />
      </div>
    </div>
  )
}

/* ──── Subcomponents ──── */
function TrialBanner({ expiresAt }) {
  const exp = expiresAt ? new Date(expiresAt) : null
  const daysLeft = exp ? Math.max(0, Math.ceil((exp - Date.now()) / 86400000)) : '?'
  return (
    <div style={bannerStyle('rgba(255,149,0,0.12)', 'var(--warning)')}>
      🎁 Trial mode — {daysLeft} day{daysLeft === 1 ? '' : 's'} left. Get a license key from the admin to continue after that.
    </div>
  )
}

function OfflineBanner() {
  return (
    <div style={bannerStyle('rgba(255,149,0,0.12)', 'var(--warning)')}>
      ⚠ License server unreachable — running on cached check. App will keep working for 24h after the last successful check.
    </div>
  )
}

function errorMessage(code) {
  return {
    invalid_key:           'Invalid license key. Double-check the spelling.',
    bad_key_format:        'Key format looks wrong. Should be LH-XXXX-XXXX-XXXX.',
    revoked:               'This license was revoked by the admin.',
    expired:               'This license has expired.',
    seat_full:             'This key has reached its maximum number of users. Ask the admin to free a seat or use a different key.',
    trial_expired:         'Your trial has expired. Enter a license key to continue.',
    invalid_token:         'License needs to be re-activated.',
    network:               'Network problem — check your internet connection.',
    timeout:               'Server is slow to respond. Try again.',
    no_license:            'No license active.',
  }[code] || ('Error: ' + (code || 'unknown'))
}

/* ──── Inline styles (kept self-contained so we don't depend on app CSS) ──── */
const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 10000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'radial-gradient(ellipse at top, #1a1a2e, #05050a 70%)',
}
const cardStyle = {
  width: '100%', maxWidth: 420, padding: 36,
  background: '#13131f',
  border: '1px solid #2a2a3e',
  borderRadius: 14,
  boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
  color: '#e0e0f0',
  fontFamily: 'Inter, system-ui, sans-serif',
  textAlign: 'center',
}
const logoStyle = {
  width: 48, height: 48, margin: '0 auto 12px',
  background: '#0077B5', color: '#fff',
  borderRadius: 12,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 800, fontSize: 18,
  boxShadow: '0 0 30px rgba(0,119,181,0.4)',
}
const titleStyle = { fontSize: 18, fontWeight: 700, marginBottom: 4 }
const subStyle = { fontSize: 13, color: '#a0a0c0', marginBottom: 18 }
const fieldStyle = { textAlign: 'left', marginBottom: 12 }
const labelStyle = { display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#a0a0c0', marginBottom: 6 }
const inputStyle = {
  width: '100%', padding: '10px 14px',
  background: '#1a1a2e', border: '1px solid #2a2a3e',
  borderRadius: 10, color: '#e0e0f0', fontSize: 14,
  fontFamily: 'Cascadia Code, Consolas, monospace', letterSpacing: 1,
  boxSizing: 'border-box',
}
const primaryBtnStyle = {
  width: '100%', padding: '11px 16px', marginTop: 4,
  background: '#0077B5', color: '#fff', border: 'none',
  borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
}
const secondaryBtnStyle = {
  ...primaryBtnStyle, background: 'transparent', border: '1px solid #2a2a3e', color: '#e0e0f0',
}
const dividerStyle = { fontSize: 11, color: '#666688', textAlign: 'center', margin: '14px 0 10px' }
const errorStyle = {
  marginTop: 12, padding: '10px 14px',
  background: 'rgba(255, 59, 48, 0.12)',
  border: '1px solid rgba(255, 59, 48, 0.3)',
  borderRadius: 10, color: '#ff6b6b', fontSize: 13, textAlign: 'left',
}
const bannerStyle = (bg, color) => ({
  padding: '8px 14px', fontSize: 12,
  background: bg, color, fontWeight: 600,
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  textAlign: 'center',
})
