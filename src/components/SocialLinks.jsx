/**
 * SocialLinks — quick ways for users to reach support / the author.
 *
 * Used in Settings (footer) and LicenseGate (under the login card).
 * Links open in the user's default browser via shell.openExternal.
 */

const LINKS = [
  {
    label: 'Email',
    href: 'mailto:abdulhaseebshykh1999@gmail.com?subject=LinkedIn%20Hunter%20support',
    icon: '✉',
    bg: '#0077B5',
  },
  {
    label: 'LinkedIn',
    href: 'https://www.linkedin.com/in/ahaseeb1999/',
    icon: 'in',
    bg: '#0a66c2',
  },
  {
    label: 'GitHub',
    href: 'https://github.com/ahaseeb1999/',
    icon: '⌥',
    bg: '#24292e',
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/ahaseeb1999',
    icon: '◧',
    bg: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',
  },
]

const openLink = (href) => {
  if (window.linkedinAPI?.shell?.openExternal) {
    window.linkedinAPI.shell.openExternal(href)
  } else {
    window.open(href, '_blank', 'noreferrer')
  }
}

/**
 * @param {object} props
 * @param {'card'|'minimal'} props.variant
 */
export default function SocialLinks({ variant = 'card' }) {
  if (variant === 'minimal') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 14, marginTop: 18,
        fontSize: 11, color: 'var(--text-muted, #888)',
      }}>
        <span style={{ marginRight: 2 }}>Help / Support:</span>
        {LINKS.map(link => (
          <button
            key={link.href}
            onClick={() => openLink(link.href)}
            title={link.label}
            aria-label={link.label}
            style={{
              width: 26, height: 26, borderRadius: '50%',
              background: link.bg, color: '#fff', fontWeight: 700,
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12,
              transition: 'transform 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {link.icon}
          </button>
        ))}
      </div>
    )
  }

  // Card variant — bigger, with labels
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--bg-input, #1a1a2e)',
      border: '1px solid var(--border, #2a2a3e)',
      borderRadius: 'var(--radius-md, 10px)',
    }}>
      <div style={{
        fontSize: 11, color: 'var(--text-muted, #888)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        marginBottom: 10,
      }}>
        Help / Support — reach out
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {LINKS.map(link => (
          <button
            key={link.href}
            onClick={() => openLink(link.href)}
            title={link.href}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 14px',
              background: link.bg, color: '#fff',
              border: 'none', borderRadius: 'var(--radius, 8px)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              transition: 'transform 0.15s, opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.opacity = '0.9' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none';            e.currentTarget.style.opacity = '1' }}
          >
            <span style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 800,
            }}>{link.icon}</span>
            {link.label}
          </button>
        ))}
      </div>
    </div>
  )
}
