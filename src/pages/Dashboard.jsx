import { useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { useNavigate } from 'react-router-dom'
import useStore from '../store/useStore'

const PIE_COLORS = ['#0077b5', '#00d4aa', '#a855f7', '#ff9500', '#ff3b30', '#0090d9', '#60aaff']

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'var(--accent-hover)', fontWeight: 700 }}>{payload[0]?.value} jobs</p>
    </div>
  )
}

export default function Dashboard() {
  const { dashboardStats, loadDashboard, searchHistory, loadHistory, activeAccountId } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    loadDashboard()
    loadHistory()
  }, [activeAccountId])

  const s = dashboardStats

  const byDateData = s
    ? Object.entries(s.byDate || {})
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-14)
        .map(([date, count]) => ({ date: date.slice(5), count }))
    : []

  const byTypeData = s
    ? Object.entries(s.byJobType || {}).map(([name, value]) => ({ name, value }))
    : []

  const STAT_CARDS = [
    { label: 'Total Jobs',   value: s?.totalJobs   || 0, icon: '💼', color: '#0077b5', bg: 'rgba(0,119,181,0.12)' },
    { label: 'Posts Found',  value: s?.totalPosts  || 0, icon: '📣', color: '#00d4aa', bg: 'rgba(0,212,170,0.12)' },
    { label: 'Applied',      value: s?.statusCounts?.Applied || 0, icon: '📤', color: '#60aaff', bg: 'rgba(96,170,255,0.12)' },
    { label: 'Interviewing', value: s?.statusCounts?.Interviewing || 0, icon: '🎯', color: '#00d4aa', bg: 'rgba(0,212,170,0.12)' },
    { label: 'Offers',       value: s?.statusCounts?.Offer || 0, icon: '🏆', color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
    { label: 'Saved',        value: s?.statusCounts?.Saved || 0, icon: '🔖', color: '#ff9500', bg: 'rgba(255,149,0,0.12)' },
    { label: 'Searches Run', value: s?.totalSearches || 0, icon: '🔍', color: '#888', bg: 'rgba(136,136,170,0.12)' },
    { label: 'Duplicates',   value: s?.duplicates   || 0, icon: '⚠️', color: '#ff9500', bg: 'rgba(255,149,0,0.12)' },
  ]

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">📊 Dashboard</h1>
          <p className="page-subtitle">Your LinkedIn hunting overview at a glance</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => loadDashboard()}>↻ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/search')}>🚀 New Hunt</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        {STAT_CARDS.map((card) => (
          <div className="stat-card" key={card.label}>
            <div className="stat-icon" style={{ background: card.bg }}>
              {card.icon}
            </div>
            <div className="stat-value" style={{ color: card.color }}>{card.value}</div>
            <div className="stat-label">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {byDateData.length > 0 && (
        <div className="charts-grid" style={{ marginBottom: 24 }}>
          <div className="chart-card">
            <div className="chart-title">📅 Jobs Found by Date</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byDateData} margin={{ top: 0, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card">
            <div className="chart-title">💼 Job Types</div>
            {byTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={byTypeData} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                    dataKey="value" nameKey="name" paddingAngle={3}>
                    {byTypeData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val, name) => [val, name]} contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 11 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state" style={{ padding: 40 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No data yet</div>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Top companies */}
        {s?.topCompanies?.length > 0 && (
          <div className="card">
            <div className="chart-title">🏢 Top Companies</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {s.topCompanies.map((c, i) => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, textAlign: 'right' }}>{i + 1}</span>
                  <div style={{ flex: 1, background: 'var(--bg-input)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${(c.count / s.topCompanies[0].count) * 100}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 120, textAlign: 'right' }}>{c.name}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-hover)', minWidth: 24 }}>{c.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent searches */}
        <div className="card">
          <div className="chart-title">🕐 Recent Searches</div>
          {searchHistory.length === 0 ? (
            <div className="empty-state" style={{ padding: 30 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No searches yet — run your first hunt!</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {searchHistory.slice(0, 8).map(h => {
                let kws = '—'
                try { kws = JSON.parse(h.keywords || '[]').filter(Boolean).join(', ') || '—' } catch {}
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)' }}>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{kws}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {h.source} · {h.results_count} results · {h.run_at?.split('T')[0]}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--accent-hover)', fontWeight: 600 }}>
                      {h.results_count || 0}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Empty state if no data at all */}
      {!s || (s.totalJobs === 0 && s.totalPosts === 0) ? (
        <div className="card" style={{ marginTop: 24, textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🎯</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
            Ready to Hunt
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
            No data yet. Start your first LinkedIn hunt to see analytics, job stats, and post insights here.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/search')}>
            🚀 Start First Hunt
          </button>
        </div>
      ) : null}
    </div>
  )
}
