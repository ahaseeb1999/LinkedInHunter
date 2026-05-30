/* LinkedIn Hunter — Admin Panel
   Vanilla JS, hash-routed SPA. */

(() => {
  const API = window.LH_CONFIG.API_BASE
  const TOKEN_KEY = 'lh_admin_token'

  /* ────── Tiny utilities ────── */
  const $ = (sel) => document.querySelector(sel)
  const $$ = (sel) => Array.from(document.querySelectorAll(sel))
  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class')      n.className = v
      else if (k === 'html')  n.innerHTML = v
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v)
      else if (v === true)    n.setAttribute(k, '')
      else if (v !== false && v !== null && v !== undefined) n.setAttribute(k, v)
    }
    for (const c of children) {
      if (c == null) continue
      if (typeof c === 'string') n.appendChild(document.createTextNode(c))
      else n.appendChild(c)
    }
    return n
  }
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]))
  const fmtDate = (s) => s ? new Date(s).toLocaleString() : '—'
  const relTime = (s) => {
    if (!s) return '—'
    const d = new Date(s)
    const sec = Math.floor((Date.now() - d.getTime()) / 1000)
    if (sec < 60) return sec + 's ago'
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago'
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'
    return Math.floor(sec / 86400) + 'd ago'
  }

  const toast = (msg, kind = '') => {
    const t = $('#toast')
    t.textContent = msg
    t.className = 'toast ' + kind
    setTimeout(() => t.classList.add('hidden'), 100)
    setTimeout(() => t.classList.remove('hidden'), 150)
    setTimeout(() => t.classList.add('hidden'), 4000)
  }

  /* ────── Auth state ────── */
  const getToken = () => localStorage.getItem(TOKEN_KEY)
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
  const clearToken = () => localStorage.removeItem(TOKEN_KEY)

  async function api(path, opts = {}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) }
    const tok = getToken()
    if (tok) headers['authorization'] = 'Bearer ' + tok

    const res = await fetch(API + path, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch (_) { data = { ok: false, error: 'non_json', raw: text.slice(0, 200) } }
    if (res.status === 401) {
      clearToken()
      showLogin()
      throw new Error('unauthorized')
    }
    if (!res.ok && !data?.ok) {
      throw new Error(data?.error || 'request_failed')
    }
    return data
  }

  /* ────── Modal ────── */
  function openModal(node) {
    const root = $('#modal-root'); const card = $('#modal-card')
    card.replaceChildren(node)
    root.classList.remove('hidden')
    root.querySelector('[data-close]').onclick = closeModal
  }
  function closeModal() { $('#modal-root').classList.add('hidden') }

  /* ────── Login ────── */
  function showLogin() {
    $('#login-screen').classList.remove('hidden')
    $('#app-shell').classList.add('hidden')
    setTimeout(() => $('#login-email').focus(), 50)
  }
  async function doLogin(email, password) {
    const btn = $('#login-btn')
    const errBox = $('#login-error')
    errBox.classList.add('hidden')
    btn.disabled = true; btn.textContent = 'Signing in…'
    try {
      const res = await api('/admin/login', { method: 'POST', body: { email, password } })
      if (!res.ok || !res.token) throw new Error(res.error || 'login_failed')
      setToken(res.token)
      await afterLogin()
    } catch (e) {
      errBox.textContent = e.message === 'invalid_credentials' ? 'Wrong email or password.' : ('Error: ' + e.message)
      errBox.classList.remove('hidden')
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in'
    }
  }
  async function afterLogin() {
    $('#login-screen').classList.add('hidden')
    $('#app-shell').classList.remove('hidden')
    const me = await api('/admin/api/me').catch(() => null)
    if (me?.ok) $('#admin-email-label').textContent = me.email
    location.hash = '#/dashboard'
    handleRoute()
    refreshKillSwitchPanel()
  }

  /* ────── Kill switch ────── */
  async function refreshKillSwitchPanel() {
    const panel = $('#kill-switch-panel')
    try {
      const s = await api('/admin/api/stats')
      const active = !!s.kill_switch_active
      panel.classList.toggle('active', active)
      panel.replaceChildren()
      if (active) {
        panel.appendChild(el('div', { class: 'mono', style: 'font-weight:700;color:var(--danger);margin-bottom:6px;' }, '⚠ KILL SWITCH ON'))
        panel.appendChild(el('button', { class: 'btn btn-sm btn-secondary', onclick: deactivateKill }, 'Deactivate'))
      } else {
        panel.appendChild(el('div', { class: 'mono', style: 'font-size:11px;color:var(--text-3);margin-bottom:6px;' }, 'Emergency'))
        panel.appendChild(el('button', { class: 'btn btn-sm btn-danger', onclick: confirmKillAll }, '🚨 KILL ALL'))
      }
    } catch (_) {}
  }
  function confirmKillAll() {
    const reasonInput = el('input', { id: 'kill-reason', placeholder: 'Optional reason' })
    const card = el('div', {},
      el('div', { class: 'modal-title' }, '🚨 Activate Kill Switch?'),
      el('p', { class: 'muted', style: 'color:var(--text-2);margin-bottom:14px;' },
        'This will stop EVERY user from using the app within seconds. Use only for emergencies.'),
      el('div', { class: 'form-row' }, el('label', {}, 'Reason'), reasonInput),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-secondary', onclick: closeModal }, 'Cancel'),
        el('button', { class: 'btn btn-danger', onclick: async () => {
          await api('/admin/api/kill-switch', { method: 'POST', body: { reason: reasonInput.value } })
          toast('Kill switch ACTIVE — every user is blocked', 'error')
          closeModal(); refreshKillSwitchPanel()
        }}, 'Yes, kill all')
      )
    )
    openModal(card)
  }
  async function deactivateKill() {
    if (!confirm('Deactivate kill switch and let users resume?')) return
    await api('/admin/api/kill-switch', { method: 'DELETE' })
    toast('Kill switch off — users can resume', 'success')
    refreshKillSwitchPanel()
  }

  /* ────── Routing ────── */
  const routes = {
    'dashboard':       renderDashboard,
    'licenses':        renderLicenseList,
    'activity':        renderActivity,
  }

  async function handleRoute() {
    const hash = location.hash.replace(/^#\//, '') || 'dashboard'
    $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.route === hash.split('/')[0]))
    $$('.route').forEach(r => r.classList.add('hidden'))

    // license detail: #/licenses/:id
    if (/^licenses\/\d+$/.test(hash)) {
      const id = hash.split('/')[1]
      $('#route-license-detail').classList.remove('hidden')
      await renderLicenseDetail(id)
      return
    }
    const target = $('#route-' + hash)
    if (!target) {
      $('#route-dashboard').classList.remove('hidden')
      await renderDashboard()
      return
    }
    target.classList.remove('hidden')
    await (routes[hash] || renderDashboard)()
  }

  /* ────── Dashboard ────── */
  async function renderDashboard() {
    const root = $('#route-dashboard')
    root.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">Loading…</div></div>'
    const stats = await api('/admin/api/stats')

    const card = (label, value, cls = '') =>
      el('div', { class: 'stat-card ' + cls },
        el('div', { class: 'stat-label' }, label),
        el('div', { class: 'stat-value' }, String(value)))

    root.replaceChildren(
      el('div', { class: 'page-header' },
        el('div', {},
          el('div', { class: 'page-title' }, 'Dashboard'),
          el('div', { class: 'page-subtitle' }, 'Overview of all licenses, users, and activity'))),
      el('div', { class: 'stats' },
        card('Total licenses', stats.licenses_total),
        card('Active licenses', stats.licenses_active),
        card('Devices total', stats.devices_total),
        card('Devices active', stats.devices_active),
        card('Active trials', stats.active_trials),
        card('Kill switch', stats.kill_switch_active ? 'ON' : 'OFF', stats.kill_switch_active ? 'danger' : '')),
      el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Recent activity'),
        await activityTable(15))
    )
  }

  /* ────── Activity table ────── */
  async function activityTable(limit = 100) {
    const data = await api('/admin/api/activity?limit=' + limit)
    if (!data.activity?.length) return el('div', { class: 'empty' },
      el('div', { class: 'empty-icon' }, '📜'),
      el('div', { class: 'empty-title' }, 'No activity yet'))

    const t = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'When'), el('th', {}, 'Action'),
        el('th', {}, 'License'), el('th', {}, 'Country'), el('th', {}, 'Details'))),
      el('tbody', {})
    )
    const tbody = t.querySelector('tbody')
    for (const a of data.activity) {
      tbody.appendChild(el('tr', {},
        el('td', { class: 'muted', title: a.ts }, relTime(a.ts)),
        el('td', {}, el('span', { class: 'mono' }, a.action)),
        el('td', { class: 'muted' }, a.license_id ? '#' + a.license_id : '—'),
        el('td', { class: 'muted' }, a.country || '—'),
        el('td', { class: 'mono muted', style: 'max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' }, a.details || '—'),
      ))
    }
    return t
  }

  async function renderActivity() {
    const root = $('#route-activity')
    root.innerHTML = '<div class="empty"><div class="empty-icon">📜</div><div class="empty-title">Loading…</div></div>'
    root.replaceChildren(
      el('div', { class: 'page-header' },
        el('div', {},
          el('div', { class: 'page-title' }, 'Activity log'),
          el('div', { class: 'page-subtitle' }, 'Every API event from your users and admins'))),
      el('div', { class: 'card' }, await activityTable(500))
    )
  }

  /* ────── License list ────── */
  async function renderLicenseList() {
    const root = $('#route-licenses')
    root.innerHTML = '<div class="empty"><div class="empty-icon">🔑</div><div class="empty-title">Loading…</div></div>'
    const data = await api('/admin/api/licenses')

    const header = el('div', { class: 'page-header' },
      el('div', {},
        el('div', { class: 'page-title' }, 'License keys'),
        el('div', { class: 'page-subtitle' }, `${data.licenses.length} key(s)`)),
      el('button', { class: 'btn', onclick: openCreateLicense }, '+ New license')
    )

    if (!data.licenses.length) {
      root.replaceChildren(header,
        el('div', { class: 'empty' },
          el('div', { class: 'empty-icon' }, '🔑'),
          el('div', { class: 'empty-title' }, 'No license keys yet'),
          el('div', { class: 'muted' }, 'Click "+ New license" to create your first one.')))
      return
    }

    const t = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'Key'), el('th', {}, 'Name'),
        el('th', {}, 'Seats used'), el('th', {}, 'Status'),
        el('th', {}, 'Created'))),
      el('tbody', {})
    )
    const tbody = t.querySelector('tbody')
    for (const lic of data.licenses) {
      const row = el('tr', { class: 'row-clickable', onclick: () => { location.hash = '#/licenses/' + lic.id } },
        el('td', { class: 'mono' }, lic.key_prefix + '-…'),
        el('td', {}, lic.name || el('span', { class: 'muted' }, '—')),
        el('td', {}, `${lic.seats_used} / ${lic.max_seats}`),
        el('td', {}, el('span', { class: 'badge badge-' + lic.status }, lic.status)),
        el('td', { class: 'muted' }, fmtDate(lic.created_at)),
      )
      tbody.appendChild(row)
    }
    root.replaceChildren(header, el('div', { class: 'card' }, t))
  }

  function openCreateLicense() {
    const nameInput = el('input', { placeholder: 'e.g. "Friends batch 1"' })
    const seatsInput = el('input', { type: 'number', value: '10', min: '1', max: '10000' })
    const notesInput = el('textarea', { rows: '3', placeholder: 'Optional notes' })
    const card = el('div', {},
      el('div', { class: 'modal-title' }, '+ Create license key'),
      el('div', { class: 'form-row' }, el('label', {}, 'Label (your reference)'), nameInput),
      el('div', { class: 'form-row' }, el('label', {}, 'Max seats'), seatsInput),
      el('div', { class: 'form-row' }, el('label', {}, 'Notes (optional)'), notesInput),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-secondary', onclick: closeModal }, 'Cancel'),
        el('button', { class: 'btn', onclick: async () => {
          try {
            const r = await api('/admin/api/licenses', { method: 'POST', body: {
              name: nameInput.value, max_seats: parseInt(seatsInput.value, 10), notes: notesInput.value,
            }})
            closeModal()
            showRawKey(r.key, r.id)
            renderLicenseList()
          } catch (e) { toast('Failed: ' + e.message, 'error') }
        }}, 'Create')
      )
    )
    openModal(card)
  }

  function showRawKey(rawKey, id) {
    const card = el('div', {},
      el('div', { class: 'modal-title' }, '✓ License key created'),
      el('p', { class: 'text-warn', style: 'margin-bottom:8px;' }, '⚠ Copy this NOW. It will not be shown again.'),
      el('div', { class: 'codeblock' }, rawKey),
      el('p', { class: 'muted mono' }, 'Click the key to select all, then Ctrl+C to copy.'),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-secondary', onclick: () => {
          navigator.clipboard.writeText(rawKey).then(() => toast('Copied to clipboard', 'success'))
        }}, '📋 Copy'),
        el('button', { class: 'btn', onclick: () => { closeModal(); location.hash = '#/licenses/' + id } }, 'Done')
      )
    )
    openModal(card)
  }

  /* ────── License detail ────── */
  async function renderLicenseDetail(id) {
    const root = $('#route-license-detail')
    root.innerHTML = '<div class="empty"><div class="empty-icon">🔑</div><div class="empty-title">Loading…</div></div>'

    const [{ licenses }, { devices }] = await Promise.all([
      api('/admin/api/licenses'),
      api('/admin/api/licenses/' + id + '/devices'),
    ])
    const lic = licenses.find(l => l.id == id)
    if (!lic) { toast('License not found', 'error'); location.hash = '#/licenses'; return }

    const seatsInput = el('input', { type: 'number', value: String(lic.max_seats), min: '1', max: '10000', style: 'width:120px' })
    const nameInput  = el('input', { value: lic.name || '', placeholder: 'No label set', style: 'width:240px' })

    const saveBtn = el('button', { class: 'btn btn-sm', onclick: async () => {
      try {
        await api('/admin/api/licenses/' + id, { method: 'PATCH', body: {
          name: nameInput.value, max_seats: parseInt(seatsInput.value, 10)
        }})
        toast('Saved', 'success')
        renderLicenseDetail(id)
      } catch (e) { toast('Failed: ' + e.message, 'error') }
    }}, 'Save changes')

    const revokeBtn = el('button', { class: 'btn btn-sm btn-danger', onclick: async () => {
      if (!confirm('Revoke this license? All users on it will be blocked.')) return
      await api('/admin/api/licenses/' + id, { method: 'PATCH', body: { status: 'revoked' } })
      toast('License revoked', 'success'); renderLicenseDetail(id)
    }}, lic.status === 'revoked' ? '✓ Revoked' : '⛔ Revoke key')

    const reactivateBtn = el('button', { class: 'btn btn-sm btn-secondary', onclick: async () => {
      await api('/admin/api/licenses/' + id, { method: 'PATCH', body: { status: 'active' } })
      toast('License re-activated', 'success'); renderLicenseDetail(id)
    }}, 'Reactivate')

    const bootAllBtn = el('button', { class: 'btn btn-sm btn-warn', onclick: async () => {
      if (!confirm('Boot ALL devices on this key? They\'ll all have to re-activate.')) return
      const r = await api('/admin/api/licenses/' + id + '/boot-all', { method: 'POST' })
      toast(`Booted ${r.devices_booted} device(s)`, 'success'); renderLicenseDetail(id)
    }}, 'Boot all devices')

    const deleteBtn = el('button', { class: 'btn btn-sm btn-danger', onclick: () => {
      // Two-step confirmation — delete is permanent
      const confirmInput = el('input', { placeholder: 'Type DELETE to confirm', autocomplete: 'off' })
      const card = el('div', {},
        el('div', { class: 'modal-title text-danger' }, '⚠ Permanently delete this key?'),
        el('p', { style: 'color:var(--text-2);margin-bottom:8px;' },
          'This removes the key and all device records linked to it. Users on this key will be blocked.'),
        el('p', { style: 'color:var(--text-2);margin-bottom:14px;' },
          'Difference from Revoke: revoked keys stay in your list (you can re-activate). Deleted keys are gone forever.'),
        el('div', { class: 'form-row' },
          el('label', { class: 'text-danger' }, 'Type "DELETE" to confirm'),
          confirmInput),
        el('div', { class: 'modal-actions' },
          el('button', { class: 'btn btn-secondary', onclick: closeModal }, 'Cancel'),
          el('button', { class: 'btn btn-danger', onclick: async () => {
            if (confirmInput.value !== 'DELETE') { toast('Type DELETE exactly to confirm', 'error'); return }
            try {
              await api('/admin/api/licenses/' + id, { method: 'DELETE' })
              closeModal()
              toast('License deleted permanently', 'success')
              location.hash = '#/licenses'
            } catch (e) { toast('Failed: ' + e.message, 'error') }
          }}, 'Delete permanently'),
        )
      )
      openModal(card)
    }}, '🗑 Delete key')

    const showKeyBtn = el('button', { class: 'btn btn-sm btn-secondary', onclick: async () => {
      try {
        const r = await api('/admin/api/licenses/' + id + '/reveal')
        if (r.ok) showRawKey(r.key, id)
      } catch (e) {
        if (e.message === 'not_available') {
          toast('This key was created before key-reveal was enabled — only newly-created keys can be revealed.', 'error')
        } else {
          toast('Cannot reveal: ' + e.message, 'error')
        }
      }
    }}, '👁 Show full key')

    const settingsCard = el('div', { class: 'card' },
      el('div', { class: 'card-title' }, 'License settings'),
      el('div', { class: 'form-row' },
        el('label', {}, 'Key'),
        el('div', { class: 'flex gap-8', style: 'align-items:center' },
          el('span', { class: 'mono' }, lic.key_prefix + '-…'),
          showKeyBtn)),
      el('div', { class: 'form-row' },
        el('label', {}, 'Status'),
        el('div', {},
          el('span', { class: 'badge badge-' + lic.status }, lic.status),
          ' ',
          lic.status === 'revoked' ? reactivateBtn : revokeBtn)),
      el('div', { class: 'form-row' }, el('label', {}, 'Label'), nameInput),
      el('div', { class: 'form-row' }, el('label', {}, 'Max seats'), seatsInput),
      el('div', { class: 'modal-actions', style: 'border:none;margin-top:0;padding-top:0;justify-content:space-between;' },
        deleteBtn,
        el('div', { class: 'flex gap-8' }, bootAllBtn, saveBtn)),
    )

    // Devices table
    const devTable = el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'Device label'), el('th', {}, 'Country'),
        el('th', {}, 'Status'), el('th', {}, 'Last seen'),
        el('th', {}, 'First seen'), el('th', {}, ''))),
      el('tbody', {})
    )
    const tbody = devTable.querySelector('tbody')
    if (!devices.length) {
      tbody.appendChild(el('tr', {},
        el('td', { class: 'muted', colspan: '6', style: 'text-align:center;padding:20px;' },
          'No devices have activated this key yet.')))
    } else {
      for (const d of devices) {
        tbody.appendChild(el('tr', {},
          el('td', {}, d.label || el('span', { class: 'mono muted' }, d.device_id.slice(0, 12) + '…')),
          el('td', { class: 'muted' }, d.ip_country || '—'),
          el('td', {}, el('span', { class: 'badge badge-' + d.status }, d.status)),
          el('td', { class: 'muted', title: d.last_seen }, relTime(d.last_seen)),
          el('td', { class: 'muted' }, fmtDate(d.first_seen)),
          el('td', {},
            d.status === 'active'
              ? el('button', { class: 'btn btn-sm btn-secondary', onclick: async () => {
                  if (!confirm('Boot this device?')) return
                  await api('/admin/api/licenses/' + id + '/devices/' + d.device_id, { method: 'DELETE' })
                  toast('Device booted', 'success'); renderLicenseDetail(id)
                }}, 'Boot')
              : el('span', { class: 'muted' }, '—')
          )))
      }
    }

    root.replaceChildren(
      el('div', { class: 'page-header' },
        el('div', {},
          el('div', { class: 'page-title' }, lic.name || 'License #' + id),
          el('div', { class: 'page-subtitle' }, `${devices.filter(d => d.status === 'active').length} active of ${lic.max_seats} seats`)),
        el('button', { class: 'btn btn-secondary', onclick: () => { location.hash = '#/licenses' } }, '← Back')),
      settingsCard,
      el('div', { class: 'card' },
        el('div', { class: 'card-title' }, 'Devices using this key'),
        devTable)
    )
  }

  /* ────── Boot ────── */
  $('#login-form').addEventListener('submit', (e) => {
    e.preventDefault()
    doLogin($('#login-email').value, $('#login-password').value)
  })
  $('#logout-btn').addEventListener('click', async () => {
    await api('/admin/logout', { method: 'POST' }).catch(() => {})
    clearToken(); showLogin()
  })
  window.addEventListener('hashchange', handleRoute)

  // Initial render
  if (getToken()) {
    afterLogin().catch(() => showLogin())
  } else {
    showLogin()
  }
})()
