import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TitleBar from './components/TitleBar'
import Notification from './components/Notification'
import LicenseGate from './components/LicenseGate'
import Dashboard from './pages/Dashboard'
import Search from './pages/Search'
import Results from './pages/Results'
import SavedJobs from './pages/SavedJobs'
import Accounts from './pages/Accounts'
import Settings from './pages/Settings'
import useStore from './store/useStore'

const IS_ELECTRON = typeof window !== 'undefined' && !!window.linkedinAPI

function BrowserWarning() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(circle at center, #1a1a2e, #05050a)',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#e0e0f0', padding: 24,
    }}>
      <div style={{
        maxWidth: 560, padding: 36, borderRadius: 16,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>🚫</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
          Open the LinkedIn Hunter app, not the browser
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: '#a0a0c0', marginBottom: 20 }}>
          You're viewing this page in a regular web browser at{' '}
          <code style={{ background: 'rgba(0,119,181,0.15)', color: '#60aaff', padding: '2px 6px', borderRadius: 4 }}>
            localhost:5173
          </code>.
          LinkedIn login uses Playwright in Electron's main process — a browser tab can't reach it,
          so accounts, scraping, and exports won't work here.
        </p>
        <div style={{
          textAlign: 'left',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, padding: 16, marginBottom: 20,
          fontSize: 13, lineHeight: 1.8, color: '#c0c0dd',
        }}>
          <div style={{ color: '#ffb347', fontWeight: 600, marginBottom: 6 }}>To fix:</div>
          1. Close this browser tab.<br/>
          2. Look for the <strong>Electron window</strong> that opened when you ran <code style={{ color: '#60aaff' }}>npm run dev</code>.<br/>
          3. If you don't see one, the Electron child probably crashed. In the terminal: Ctrl+C, then re-run <code style={{ color: '#60aaff' }}>npm run dev</code>.
        </div>
        <p style={{ fontSize: 11, color: '#666688' }}>
          The UI you see here is the same React frontend — but it only becomes functional when loaded by Electron, which injects the LinkedIn API bridge.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { loadAccounts, loadSettings } = useStore()

  useEffect(() => {
    if (!IS_ELECTRON) return
    loadAccounts()
    loadSettings()
  }, [])

  if (!IS_ELECTRON) return <BrowserWarning />

  return (
    <LicenseGate>
      <div className="app-shell">
        <TitleBar />
        <div className="main-layout">
          <Sidebar />
          <main className="page-content">
            <Routes>
              <Route path="/"          element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/search"    element={<Search />} />
              <Route path="/results"   element={<Results />} />
              <Route path="/saved"     element={<SavedJobs />} />
              <Route path="/accounts"  element={<Accounts />} />
              <Route path="/settings"  element={<Settings />} />
            </Routes>
          </main>
        </div>
        <Notification />
      </div>
    </LicenseGate>
  )
}
