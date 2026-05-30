const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('linkedinAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // Accounts
  accounts: {
    getAll: () => ipcRenderer.invoke('accounts:getAll'),
    add: (data) => ipcRenderer.invoke('accounts:add', data),
    delete: (id) => ipcRenderer.invoke('accounts:delete', id),
    checkSession: (id) => ipcRenderer.invoke('accounts:checkSession', id),
    onLoginProgress: (cb) => {
      const handler = (_, msg) => cb(msg)
      ipcRenderer.on('accounts:loginProgress', handler)
      return () => ipcRenderer.removeListener('accounts:loginProgress', handler)
    },
  },

  // Search
  search: {
    run:    (params) => ipcRenderer.invoke('search:run', params),
    stop:   () => ipcRenderer.invoke('search:stop'),
    pause:  () => ipcRenderer.invoke('search:pause'),
    resume: () => ipcRenderer.invoke('search:resume'),
    status: () => ipcRenderer.invoke('search:status'),
    onProgress: (cb) => {
      const handler = (_, msg) => cb(msg)
      ipcRenderer.on('search:progress', handler)
      return () => ipcRenderer.removeListener('search:progress', handler)
    },
    onQuickSearch: (cb) => {
      const handler = () => cb()
      ipcRenderer.on('quick-search', handler)
      return () => ipcRenderer.removeListener('quick-search', handler)
    },
  },

  // Jobs
  jobs: {
    getAll: (filters) => ipcRenderer.invoke('jobs:getAll', filters),
    updateStatus: (id, status) => ipcRenderer.invoke('jobs:updateStatus', { id, status }),
    updateNotes: (id, notes) => ipcRenderer.invoke('jobs:updateNotes', { id, notes }),
    toggleSave: (id) => ipcRenderer.invoke('jobs:toggleSave', id),
  },

  // Posts
  posts: {
    getAll: (filters) => ipcRenderer.invoke('posts:getAll', filters),
    toggleSave: (id) => ipcRenderer.invoke('posts:toggleSave', id),
  },

  // Searches history
  searches: {
    getHistory: () => ipcRenderer.invoke('searches:getHistory'),
  },

  // Stats
  stats: {
    getDashboard: (accountId) => ipcRenderer.invoke('stats:getDashboard', accountId),
  },

  // Export
  export: {
    excel: (params) => ipcRenderer.invoke('export:excel', params),
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (s) => ipcRenderer.invoke('settings:save', s),
  },

  // Data
  data: {
    clearAll: () => ipcRenderer.invoke('data:clearAll'),
    diagnostics: () => ipcRenderer.invoke('db:diagnostics'),
  },

  // Open URL in user's default browser
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // License
  license: {
    getState:    ()           => ipcRenderer.invoke('license:state'),
    checkNow:    ()           => ipcRenderer.invoke('license:check'),
    activate:    (key)        => ipcRenderer.invoke('license:activate', { key }),
    startTrial:  ()           => ipcRenderer.invoke('license:trial'),
    deactivate:  ()           => ipcRenderer.invoke('license:deactivate'),
    onStateChange: (cb) => {
      const handler = (_, state) => cb(state)
      ipcRenderer.on('license:state', handler)
      return () => ipcRenderer.removeListener('license:state', handler)
    },
  },

  // Profile analyzer
  profile: {
    analyze: (params) => ipcRenderer.invoke('profile:analyze', params),
    onProgress: (cb) => {
      const handler = (_, msg) => cb(msg)
      ipcRenderer.on('profile:progress', handler)
      return () => ipcRenderer.removeListener('profile:progress', handler)
    },
  },
})
