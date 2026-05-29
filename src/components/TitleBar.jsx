import useStore from '../store/useStore'

export default function TitleBar() {
  const { accounts, activeAccountId } = useStore()
  const active = accounts.find(a => a.id === activeAccountId)

  const minimize = () => window.linkedinAPI?.window.minimize()
  const maximize = () => window.linkedinAPI?.window.maximize()
  const close    = () => window.linkedinAPI?.window.close()

  return (
    <div className="titlebar">
      <div className="titlebar-logo">
        <div className="titlebar-logo-icon">LH</div>
        <span className="titlebar-title">LinkedIn Hunter</span>
        {active && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
            — {active.name || active.email}
          </span>
        )}
      </div>

      <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={minimize} title="Minimize">─</button>
        <button className="titlebar-btn" onClick={maximize} title="Maximize">□</button>
        <button className="titlebar-btn close" onClick={close} title="Close">✕</button>
      </div>
    </div>
  )
}
