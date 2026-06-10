// Silence Electron's "insecure CSP" warning. We DO set a CSP via index.html
// for production builds, but in dev mode Vite's HMR needs unsafe-eval, which
// makes Electron throw this warning every renderer init. Setting this env
// var BEFORE 'electron' is required prevents the warning from being attached.
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } = require('electron')
const path = require('path')
const isDev = process.env.NODE_ENV === 'development'

// Point Playwright at the Chromium we bundle inside the installer
// (resources/pw-browsers). Without this, a packaged install has NO browser and
// login/scraping fail with "Executable doesn't exist at ...ms-playwright...".
// Must be set before any scraper module calls chromium.launch(). In dev we
// leave it unset so Playwright uses the browser from `npx playwright install`.
if (!isDev) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'pw-browsers')
}

// ── Single-instance lock ─────────────────────────────────────────────
// Prevents two copies of LinkedIn Hunter from running at once, which is the
// #1 cause of "database is locked" errors (each instance tries to open the
// same SQLite file). If we can't get the lock, another instance is already
// running — focus its window and exit immediately.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  console.log('[app] Another instance is already running — exiting.')
  app.quit()
  // Bail out before any DB / IPC handlers register
  process.exit(0)
}

// Database
const { initDB, getDB, dbDiagnostics } = require('./database/db')
const accountsDB = require('./database/accounts')
const jobsDB = require('./database/jobs')
const postsDB = require('./database/posts')

// Scrapers
const { loginAccount, checkSession } = require('./scraper/linkedinAuth')
const { scrapeJobs } = require('./scraper/jobScraper')
const { scrapePosts } = require('./scraper/postScraper')
const { analyzeProfile } = require('./scraper/profileScraper')
const { createControl } = require('./scraper/control')

let activeControl = null   // shared scraper control for the currently running hunt

// Export
const { exportToExcel } = require('./export/excelExporter')

// License system
const licenseMgr = require('./license/manager')

// Scheduled-search runner (node-cron)
const scheduler = require('./scheduler')

// Auto-updater — checks GitHub Releases on launch, downloads silently,
// installs on quit. Disabled in dev so editing code doesn't trigger a
// download loop.
let autoUpdater = null
if (!isDev) {
  try {
    ;({ autoUpdater } = require('electron-updater'))
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('update-available',  (info) => console.log('[updater] update available:', info?.version))
    autoUpdater.on('update-downloaded', (info) => console.log('[updater] downloaded, will install on quit:', info?.version))
    autoUpdater.on('error',             (e)    => console.warn('[updater] error:', e?.message))
  } catch (e) {
    console.warn('[updater] disabled (electron-updater not loadable):', e.message)
  }
}

let mainWindow
let tray

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../assets/icon.ico'),
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray-icon.png'))
    tray = new Tray(icon.resize({ width: 16, height: 16 }))
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open LinkedIn Hunter', click: () => mainWindow?.show() },
      { label: 'Quick Search', click: () => mainWindow?.webContents.send('quick-search') },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
    tray.setToolTip('LinkedIn Hunter')
    tray.setContextMenu(contextMenu)
    tray.on('double-click', () => mainWindow?.show())
  } catch (e) {
    console.log('Tray icon not available:', e.message)
  }
}

// ─────────────────────────────────────────────
//  APP LIFECYCLE
// ─────────────────────────────────────────────
app.whenReady().then(async () => {
  // Kick off the license check in the background — the renderer subscribes to
  // state changes via IPC and renders the LicenseGate based on the result.
  licenseMgr.init().catch(e => console.error('[license] init error:', e))
  licenseMgr.subscribe((state) => {
    try { mainWindow?.webContents?.send('license:state', state) } catch (_) {}
  })

  try {
    await initDB()
    console.log('✅ Database initialized')
    const diag = dbDiagnostics()
    if (diag.ok) {
      console.log(`[db] STATE: ${diag.accounts.length} account(s), ${diag.jobs} jobs, ${diag.posts} posts, ${diag.searches} searches`)
      if (diag.accounts.length > 0) {
        diag.accounts.forEach(a => console.log(`  • Account #${a.id}: "${a.name}" (last used ${a.last_used || 'never'})`))
      } else {
        console.log('  (no accounts yet — add one from the Accounts page)')
      }
    } else {
      console.error('[db] Diagnostic failed:', diag.error)
    }
  } catch (e) {
    console.error('❌ DB init error:', e)
  }
  createWindow()
  createTray()

  // Scheduled search — re-runs the last hunt on the user's cron schedule while
  // the app is open. Fires only when enabled in Settings and a prior hunt exists.
  scheduler.init({
    getSettings: () => { const { getSettings } = require('./database/db'); return getSettings() },
    runHunt: (params) => runHuntManaged(params, (m) => console.log('[scheduled]', m)),
    log: (m) => console.log(m),
    notify: (title, body) => {
      try { mainWindow?.webContents?.send('search:scheduled', { title, body }) } catch (_) {}
      try { if (Notification.isSupported()) new Notification({ title, body }).show() } catch (_) {}
    },
  })
  scheduler.apply()

  // Check for app updates 30s after launch — non-blocking, fully silent.
  // If a newer version is on GitHub Releases, it downloads in the background
  // and installs on next quit.
  if (autoUpdater) {
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    }, 30_000)
  }
})

// Expose diagnostic to renderer for debug/recovery UI
ipcMain.handle('db:diagnostics', () => dbDiagnostics())

// Open external URLs in the user's default browser / mail client.
// Whitelist: http, https, mailto. Anything else (file://, javascript:, etc.) blocked.
ipcMain.handle('shell:openExternal', async (_e, url) => {
  try {
    if (typeof url !== 'string') return { ok: false, error: 'bad_url' }
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return { ok: false, error: 'unsafe_scheme' }
    await shell.openExternal(url)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─────────────────────────────────────────────
//  LICENSE IPC
// ─────────────────────────────────────────────
ipcMain.handle('license:state', () => licenseMgr.getState())
ipcMain.handle('license:check', async () => { await licenseMgr.checkOnce(); return licenseMgr.getState() })
ipcMain.handle('license:activate', async (_e, { key }) => {
  const res = await licenseMgr.activateKey(key)
  return { ...res, state: licenseMgr.getState() }
})
ipcMain.handle('license:trial', async () => {
  const res = await licenseMgr.startTrial()
  return { ...res, state: licenseMgr.getState() }
})
ipcMain.handle('license:deactivate', async () => {
  await licenseMgr.deactivate()
  return licenseMgr.getState()
})

// Make sure any in-flight scrape is aborted and the DB lock is released cleanly
app.on('before-quit', () => {
  try { scheduler.stop() } catch (_) {}
  try { activeControl?.stop() } catch (_) {}
  try {
    const d = getDB()
    if (d && d.isOpen) d.close()
  } catch (_) {}
})

// If a user double-clicks the app while it's already running, focus the
// existing window instead of starting a second instance.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─────────────────────────────────────────────
//  WINDOW CONTROLS IPC
// ─────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())

// ─────────────────────────────────────────────
//  ACCOUNTS IPC
// ─────────────────────────────────────────────
ipcMain.handle('accounts:getAll', async () => {
  return accountsDB.getAllAccounts()
})

ipcMain.handle('accounts:add', async (event, { name }) => {
  const sendProgress = (msg) => {
    try { event.sender.send('accounts:loginProgress', msg) } catch (_) {}
  }
  const result = await loginAccount(name, sendProgress)
  if (result.success) {
    const id = accountsDB.addAccount({ name, email: result.email, cookies: result.cookies })
    sendProgress('Account saved successfully')
    return { success: true, id, email: result.email }
  }
  return { success: false, error: result.error }
})

ipcMain.handle('accounts:delete', async (event, id) => {
  accountsDB.deleteAccount(id)
  return { success: true }
})

ipcMain.handle('accounts:checkSession', async (event, accountId) => {
  const account = accountsDB.getAccount(accountId)
  if (!account) return { valid: false }
  const valid = await checkSession(account.cookies)
  return { valid }
})

// ─────────────────────────────────────────────
//  SEARCH IPC
// ─────────────────────────────────────────────
/**
 * Core hunt logic — used by both the manual search:run IPC handler and the
 * scheduled-search runner. Performs the license gate, scrapes jobs/posts for
 * the given params, and persists results. The caller owns the `control`.
 */
async function runHunt(params, { onProgress = () => {}, control } = {}) {
  const { accountId, keywords, source, filters, options } = params || {}

  // ─── License gate ────────────────────────────────────────────────
  // Reject the hunt unless the local license state is usable AND the server
  // issues a per-action token. This means a cracker bypassing the local
  // check still can't run hunts — server's action-token call validates them.
  if (!licenseMgr.isUsableLocally()) {
    return { success: false, error: 'license_required', error_detail: 'Activate or start trial to use this feature.' }
  }
  const actionRes = await licenseMgr.getActionToken('hunt_start').catch(() => null)
  if (!actionRes?.ok) {
    return { success: false, error: 'license_check_failed', error_detail: actionRes?.error || 'unknown' }
  }

  const account = accountsDB.getAccount(accountId)
  if (!account) return { success: false, error: 'Account not found' }

  accountsDB.updateLastUsed(accountId)

  const searchId = jobsDB.createSearch({
    accountId, keywords, filters, source,
    runAt: new Date().toISOString(),
  })

  const ctrl = control || createControl()
  const results = { jobs: [], posts: [], duplicates: 0 }

  try {
    if ((source === 'jobs' || source === 'both') && !ctrl.isStopped()) {
      const jobs = await scrapeJobs({
        cookies: JSON.parse(account.cookies),
        keywords, filters, options,
        control: ctrl,
        onProgress,
      })
      for (const job of jobs) {
        const { isDuplicate, id } = jobsDB.insertJob({ ...job, searchId, accountId })
        if (isDuplicate) results.duplicates++
        results.jobs.push({ ...job, id, isDuplicate })
      }
    }

    if ((source === 'posts' || source === 'both') && !ctrl.isStopped()) {
      const posts = await scrapePosts({
        cookies: JSON.parse(account.cookies),
        keywords, filters, options,
        control: ctrl,
        onProgress,
      })
      for (const post of posts) {
        const { isDuplicate, id } = postsDB.insertPost({ ...post, searchId, accountId })
        if (isDuplicate) results.duplicates++
        results.posts.push({ ...post, id, isDuplicate })
      }
    }

    jobsDB.updateSearchCount(searchId, results.jobs.length + results.posts.length)
    return { success: true, stopped: ctrl.isStopped(), results, searchId }
  } catch (err) {
    console.error('Search error:', err)
    return { success: false, error: err.message }
  }
}

/**
 * Run a hunt while owning the shared `activeControl` slot. Returns
 * { success:false, error:'busy' } if another hunt is already in flight, so a
 * scheduled run never collides with a manual one (and vice versa).
 */
async function runHuntManaged(params, onProgress = () => {}) {
  if (activeControl) return { success: false, error: 'busy' }
  activeControl = createControl()
  const control = activeControl
  try {
    return await runHunt(params, { onProgress, control })
  } finally {
    if (activeControl === control) activeControl = null
  }
}

ipcMain.handle('search:run', async (event, params) => {
  // Remember this search so the scheduler can re-run it later.
  try {
    const { saveSettings } = require('./database/db')
    saveSettings({ lastSearch: JSON.stringify({
      accountId: params.accountId, keywords: params.keywords,
      source: params.source, filters: params.filters, options: params.options,
    }) })
  } catch (_) {}

  const sendProgress = (msg) => {
    try { event.sender.send('search:progress', msg) } catch (_) {}
  }
  return runHuntManaged(params, sendProgress)
})

ipcMain.handle('search:stop',   () => { activeControl?.stop();   return { ok: true } })
ipcMain.handle('search:pause',  () => { activeControl?.pause();  return { ok: true } })
ipcMain.handle('search:resume', () => { activeControl?.resume(); return { ok: true } })
ipcMain.handle('search:status', () => ({
  running: !!activeControl,
  paused:  !!activeControl?.isPaused(),
  stopped: !!activeControl?.isStopped(),
}))

// ─────────────────────────────────────────────
//  PROFILE ANALYZER IPC
// ─────────────────────────────────────────────
ipcMain.handle('profile:analyze', async (event, { accountId, profileUrl }) => {
  const account = accountsDB.getAccount(accountId)
  if (!account) return { success: false, error: 'Account not found' }

  const sendProgress = (msg) => {
    try { event.sender.send('profile:progress', msg) } catch (_) {}
  }

  try {
    const result = await analyzeProfile({
      cookies: JSON.parse(account.cookies),
      profileUrl: profileUrl || 'https://www.linkedin.com/in/me/',
      onProgress: sendProgress,
    })
    return result
  } catch (err) {
    console.error('Profile analyze error:', err)
    return { success: false, error: err.message }
  }
})

// ─────────────────────────────────────────────
//  DATA RETRIEVAL IPC
// ─────────────────────────────────────────────
ipcMain.handle('jobs:getAll', async (event, filters) => {
  return jobsDB.getAllJobs(filters)
})

ipcMain.handle('posts:getAll', async (event, filters) => {
  return postsDB.getAllPosts(filters)
})

ipcMain.handle('jobs:updateStatus', async (event, { id, status }) => {
  jobsDB.updateJobStatus(id, status)
  return { success: true }
})

ipcMain.handle('jobs:updateNotes', async (event, { id, notes }) => {
  jobsDB.updateJobNotes(id, notes)
  return { success: true }
})

ipcMain.handle('jobs:toggleSave', async (event, id) => {
  const result = jobsDB.toggleSave(id)
  return { success: true, isSaved: result }
})

ipcMain.handle('posts:toggleSave', async (event, id) => {
  const result = postsDB.toggleSave(id)
  return { success: true, isSaved: result }
})

ipcMain.handle('searches:getHistory', async () => {
  return jobsDB.getSearchHistory()
})

ipcMain.handle('stats:getDashboard', async (event, accountId) => {
  const jobs = jobsDB.getAllJobs({ accountId })
  const posts = postsDB.getAllPosts({ accountId })
  const searches = jobsDB.getSearchHistory()

  const statusCounts = {}
  jobs.forEach(j => { statusCounts[j.status] = (statusCounts[j.status] || 0) + 1 })

  const byDate = {}
  jobs.forEach(j => {
    const d = j.scraped_at ? j.scraped_at.split('T')[0] : 'unknown'
    byDate[d] = (byDate[d] || 0) + 1
  })

  const byCompany = {}
  jobs.forEach(j => {
    if (j.company) byCompany[j.company] = (byCompany[j.company] || 0) + 1
  })

  const topCompanies = Object.entries(byCompany)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }))

  const byJobType = {}
  jobs.forEach(j => {
    if (j.job_type) byJobType[j.job_type] = (byJobType[j.job_type] || 0) + 1
  })

  const duplicates = jobs.filter(j => j.is_duplicate).length + posts.filter(p => p.is_duplicate).length

  return {
    totalJobs: jobs.length,
    totalPosts: posts.length,
    totalSearches: searches.length,
    statusCounts,
    byDate,
    topCompanies,
    byJobType,
    duplicates,
  }
})

// ─────────────────────────────────────────────
//  EXPORT IPC
// ─────────────────────────────────────────────
ipcMain.handle('export:excel', async (event, { jobIds, postIds, accountId }) => {
  const jobs = jobIds?.length
    ? jobIds.map(id => jobsDB.getJob(id)).filter(Boolean)
    : jobsDB.getAllJobs({ accountId })

  const posts = postIds?.length
    ? postIds.map(id => postsDB.getPost(id)).filter(Boolean)
    : postsDB.getAllPosts({ accountId })

  const filePath = await exportToExcel({ jobs, posts })
  shell.showItemInFolder(filePath)
  return { success: true, filePath }
})

// ─────────────────────────────────────────────
//  SETTINGS IPC
// ─────────────────────────────────────────────
ipcMain.handle('settings:get', async () => {
  const { getSettings } = require('./database/db')
  return getSettings()
})

ipcMain.handle('settings:save', async (event, settings) => {
  const { saveSettings } = require('./database/db')
  saveSettings(settings)
  // Re-apply the cron schedule so toggling it (or editing the cron) takes
  // effect immediately without restarting the app.
  try { scheduler.apply() } catch (e) { console.warn('[schedule] reapply failed:', e.message) }
  return { success: true }
})

ipcMain.handle('data:clearAll', async () => {
  const { clearAllData } = require('./database/db')
  clearAllData()
  return { success: true }
})
