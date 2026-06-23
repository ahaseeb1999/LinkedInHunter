/**
 * Theme switching — dark (default) / light. Persisted in localStorage and
 * applied as `data-theme` on <html>; index.css defines the token overrides.
 */
const KEY = 'lh-theme'

export function getTheme() {
  const t = localStorage.getItem(KEY)
  return t === 'light' ? 'light' : 'dark'
}

export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark')
}

export function setTheme(t) {
  const v = t === 'light' ? 'light' : 'dark'
  localStorage.setItem(KEY, v)
  applyTheme(v)
  return v
}
