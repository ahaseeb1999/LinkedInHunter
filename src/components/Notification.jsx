import { useEffect, useRef } from 'react'
import useStore from '../store/useStore'

export default function Notification() {
  const { notification } = useStore()
  const ref = useRef()

  const colors = {
    info:    'var(--accent)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    error:   'var(--danger)',
  }

  const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }

  if (!notification) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9999,
      background: 'var(--bg-surface)',
      border: `1px solid ${colors[notification.type] || colors.info}`,
      borderRadius: 'var(--radius-lg)',
      padding: '14px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
      animation: 'slide-up 0.2s ease',
      maxWidth: 360,
    }}>
      <span style={{ fontSize: 18 }}>{icons[notification.type] || icons.info}</span>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', flex: 1 }}>{notification.msg}</span>
    </div>
  )
}
