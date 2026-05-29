const STATUS_CONFIG = {
  New:          { cls: 'badge-new',          icon: '○' },
  Applied:      { cls: 'badge-applied',      icon: '📤' },
  Interviewing: { cls: 'badge-interviewing', icon: '🎯' },
  Rejected:     { cls: 'badge-rejected',     icon: '✗' },
  Offer:        { cls: 'badge-offer',        icon: '🏆' },
}

export default function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG['New']
  return (
    <span className={`badge ${cfg.cls}`}>
      {cfg.icon} {status || 'New'}
    </span>
  )
}

export function StatusSelect({ value, onChange }) {
  return (
    <select
      className="select"
      value={value || 'New'}
      onChange={e => onChange(e.target.value)}
      style={{ fontSize: 12, padding: '4px 28px 4px 8px', width: 'auto', minWidth: 120 }}
      onClick={e => e.stopPropagation()}
    >
      {Object.keys(STATUS_CONFIG).map(s => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  )
}
