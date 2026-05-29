import { NavLink, useNavigate } from 'react-router-dom'
import useStore from '../store/useStore'

const NAV_ITEMS = [
  { path: '/dashboard', icon: '📊', label: 'Dashboard' },
  { path: '/search',    icon: '🔍', label: 'New Hunt' },
  { path: '/results',   icon: '📋', label: 'Results' },
  { path: '/saved',     icon: '🔖', label: 'Saved Jobs' },
]

const BOTTOM_ITEMS = [
  { path: '/accounts', icon: '👤', label: 'Accounts' },
  { path: '/settings', icon: '⚙️', label: 'Settings' },
]

export default function Sidebar() {
  const { accounts, activeAccountId, setActiveAccount } = useStore()
  const navigate = useNavigate()
  const active = accounts.find(a => a.id === activeAccountId)

  return (
    <nav className="sidebar">
      <div className="sidebar-section-label">Navigation</div>

      {NAV_ITEMS.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}

      <div className="sidebar-section-label" style={{ marginTop: 8 }}>Manage</div>

      {BOTTOM_ITEMS.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}

      {/* Account Switcher */}
      <div className="sidebar-account-switcher">
        {accounts.length > 0 ? (
          <div>
            {accounts.map(acc => (
              <div
                key={acc.id}
                className="account-badge"
                onClick={() => setActiveAccount(acc.id)}
                style={{
                  marginBottom: 6,
                  borderColor: acc.id === activeAccountId ? 'var(--accent)' : undefined,
                  background: acc.id === activeAccountId ? 'var(--accent-soft)' : undefined,
                }}
              >
                <div className="account-avatar">
                  {(acc.name || acc.email || '?')[0].toUpperCase()}
                </div>
                <div className="account-info">
                  <div className="account-name">{acc.name || 'Account'}</div>
                  <div className="account-email">{acc.email || 'No email'}</div>
                </div>
                {acc.id === activeAccountId && (
                  <span style={{ fontSize: 10, color: 'var(--accent-hover)', fontWeight: 700 }}>●</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div
            className="account-badge"
            onClick={() => navigate('/accounts')}
            style={{ cursor: 'pointer' }}
          >
            <div className="account-avatar" style={{ background: 'var(--bg-input)' }}>+</div>
            <div className="account-info">
              <div className="account-name">Add Account</div>
              <div className="account-email">Login with LinkedIn</div>
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
