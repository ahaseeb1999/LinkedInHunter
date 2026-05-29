# Backup: Post Feature v1 (HTML-scraping era)

**Created:** 2026-05-24
**Reason:** Snapshot before pivoting to Voyager API + multi-source aggregation architecture.

## What's in here

| File | What it was |
|---|---|
| `postScraper.js` | DOM-walking + scoring-based post extractor. Reads LinkedIn search results page as HTML, walks the DOM looking for cards matching a behavioral scoring rubric. ~500 lines. |
| `jobScraper.js` | Job search scraper. Builds `/jobs/search/` URL with filters (f_WT for work-mode, f_E for experience, etc.), extracts cards with multi-selector fallback, opens each job for detail. |
| `humanizer.js` | Playwright behavior helpers — random delays, scroll via `window.scrollBy`, mouse wander, key presses. |
| `linkedinAuth.js` | Login (visible browser) + cookie capture via `li_at` detection. Session check. |
| `profileScraper.js` | "Analyze My Profile" feature — extracts headline/skills/experience, derives suggested keywords. |
| `control.js` | Stop / Pause / Resume state object passed into scrapers. |

## Architecture being replaced

```
User keyword → buildPostSearchURL → Playwright loads search page →
  Scroll loop:
    extractPostCards (DOM walk with scoring) → filter → dedup → save
  Repeat until no growth or maxResults
```

## Why we replaced it

- LinkedIn's HTML class names change frequently → scoring rubric needs constant updates
- Content search lazy-loads via cursor, not page numbers → pagination unreliable
- Single-keyword search returns limited set → "0 or 1 results" complaint
- No way to differentiate post cards from profile-suggestion cards reliably from HTML alone

## What replaced it (in `electron/scraper/`)

- `voyagerApi.js` — direct calls to LinkedIn's internal `/voyager/api/search/dash/clusters` JSON endpoint via the Playwright session. Stable response schema, real pagination.
- `keywordExpand.js` — auto-generates 3-5 variants of each user keyword.
- `rateLimit.js` — detects shadow-bans, 429s, checkpoint redirects.
- `mouseHuman.js` — bezier-curve mouse paths + hover-and-dwell.
- `sourceHashtag.js` — `/feed/hashtag/...` as supplementary source.
- `sourceFeed.js` — personal feed as supplementary source.
- New `postScraper.js` — orchestrator that runs Voyager + supplementary sources, dedups, falls back to HTML if Voyager fails.

## Restoring this backup

If the new architecture breaks badly, restore with:

```powershell
Copy-Item .\backups\post-feature-v1-2026-05-24\*.js .\electron\scraper\ -Force
```

Then `npm run dev` will use the old HTML-scraping flow.
