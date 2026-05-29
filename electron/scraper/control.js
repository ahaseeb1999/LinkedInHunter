// Shared scraper control state — used by jobScraper & postScraper to support
// Stop / Pause / Resume from the UI mid-run.

function createControl() {
  const state = {
    stopped: false,
    paused: false,
    _resumeWaiters: [],
  }

  return {
    state,

    stop() {
      state.stopped = true
      state.paused = false
      // Release any pending pause waiters so they observe the stop flag
      state._resumeWaiters.splice(0).forEach(fn => fn())
    },

    pause() { state.paused = true },

    resume() {
      state.paused = false
      state._resumeWaiters.splice(0).forEach(fn => fn())
    },

    isStopped()  { return state.stopped },
    isPaused()   { return state.paused },

    /**
     * Awaits until the scraper is unpaused, or returns immediately if stopped.
     * Call this between scrape steps so pause/stop are responsive.
     */
    async checkpoint() {
      if (state.stopped) return
      while (state.paused && !state.stopped) {
        await new Promise(resolve => state._resumeWaiters.push(resolve))
      }
    },
  }
}

module.exports = { createControl }
