import { create } from 'zustand'

const useStore = create((set, get) => ({
  // ── Accounts ──────────────────────────
  accounts: [],
  activeAccountId: null,

  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (id) => set({ activeAccountId: id }),

  loadAccounts: async () => {
    const accounts = await window.linkedinAPI.accounts.getAll()
    set({ accounts, activeAccountId: accounts[0]?.id || null })
  },

  // ── Search state ──────────────────────
  isSearching: false,
  isPaused: false,
  searchProgress: [],
  lastSearchResults: null,

  setSearching: (v) => set({ isSearching: v, isPaused: v ? get().isPaused : false }),
  setPaused: (v) => set({ isPaused: v }),
  addProgress: (msg) => set(s => ({ searchProgress: [...s.searchProgress.slice(-200), msg] })),
  clearProgress: () => set({ searchProgress: [] }),
  setLastResults: (r) => set({ lastSearchResults: r }),

  stopSearch: async () => {
    await window.linkedinAPI.search.stop()
    set(s => ({ searchProgress: [...s.searchProgress, '⏹ Stop requested...'] }))
  },
  pauseSearch: async () => {
    await window.linkedinAPI.search.pause()
    set(s => ({ isPaused: true, searchProgress: [...s.searchProgress, '⏸ Paused — will resume on click'] }))
  },
  resumeSearch: async () => {
    await window.linkedinAPI.search.resume()
    set(s => ({ isPaused: false, searchProgress: [...s.searchProgress, '▶ Resumed'] }))
  },

  // ── Jobs & Posts ──────────────────────
  jobs: [],
  posts: [],
  savedJobs: [],
  savedPosts: [],

  setJobs: (jobs) => set({ jobs }),
  setPosts: (posts) => set({ posts }),

  loadJobs: async (filters) => {
    const jobs = await window.linkedinAPI.jobs.getAll(filters || { accountId: get().activeAccountId })
    set({ jobs })
  },

  loadPosts: async (filters) => {
    const posts = await window.linkedinAPI.posts.getAll(filters || { accountId: get().activeAccountId })
    set({ posts })
  },

  loadSaved: async () => {
    const accountId = get().activeAccountId
    const savedJobs = await window.linkedinAPI.jobs.getAll({ accountId, isSaved: true })
    const savedPosts = await window.linkedinAPI.posts.getAll({ accountId, isSaved: true })
    set({ savedJobs, savedPosts })
  },

  updateJobStatus: async (id, status) => {
    await window.linkedinAPI.jobs.updateStatus(id, status)
    set(s => ({
      jobs: s.jobs.map(j => j.id === id ? { ...j, status } : j),
      savedJobs: s.savedJobs.map(j => j.id === id ? { ...j, status } : j),
    }))
  },

  updateJobNotes: async (id, notes) => {
    await window.linkedinAPI.jobs.updateNotes(id, notes)
    set(s => ({
      jobs: s.jobs.map(j => j.id === id ? { ...j, notes } : j),
    }))
  },

  toggleSaveJob: async (id) => {
    const { isSaved } = await window.linkedinAPI.jobs.toggleSave(id)
    set(s => ({
      jobs: s.jobs.map(j => j.id === id ? { ...j, is_saved: isSaved ? 1 : 0 } : j),
    }))
  },

  toggleSavePost: async (id) => {
    const { isSaved } = await window.linkedinAPI.posts.toggleSave(id)
    set(s => ({
      posts: s.posts.map(p => p.id === id ? { ...p, is_saved: isSaved ? 1 : 0 } : p),
    }))
  },

  // ── Dashboard stats ───────────────────
  dashboardStats: null,
  loadDashboard: async () => {
    const accountId = get().activeAccountId
    const stats = await window.linkedinAPI.stats.getDashboard(accountId)
    set({ dashboardStats: stats })
  },

  // ── Search history ────────────────────
  searchHistory: [],
  loadHistory: async () => {
    const h = await window.linkedinAPI.searches.getHistory()
    set({ searchHistory: h })
  },

  // ── Settings ──────────────────────────
  settings: {},
  loadSettings: async () => {
    const s = await window.linkedinAPI.settings.get()
    set({ settings: s })
  },
  saveSettings: async (s) => {
    await window.linkedinAPI.settings.save(s)
    set({ settings: s })
  },

  // ── UI state ──────────────────────────
  selectedJob: null,
  setSelectedJob: (job) => set({ selectedJob: job }),

  notification: null,
  showNotification: (msg, type = 'info') => {
    set({ notification: { msg, type, id: Date.now() } })
    setTimeout(() => set({ notification: null }), 4000)
  },
}))

export default useStore
