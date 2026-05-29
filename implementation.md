# LinkedIn Hunter — Full Implementation Plan

A professional Windows desktop application to hunt remote jobs and hiring opportunities on LinkedIn with multi-account support, smart scraping, rich dashboards, and Excel export.

---

## ⚠️ User Review Required

> [!IMPORTANT]
> **LinkedIn ToS Transparency**: LinkedIn prohibits automated scraping of their platform (per their User Agreement §8.2). This tool uses **browser automation via Playwright** with your own session cookies — it mimics human behavior, adds random delays, and works through a real Chromium browser. This is widely used for personal job hunting tools but carries a small risk of account throttling if overused. The tool will have built-in safeguards (rate limits, human-like delays). **You accept responsibility for usage.**

> [!WARNING]
> **Official LinkedIn API** has very limited public access for job data (most endpoints require Partner Program approval). The tool will primarily use browser automation. An API mode toggle will be available but may return limited data.

---

## Open Questions (All Resolved ✅)

All requirements gathered. No blockers.

---

## Architecture Decision

### Tech Stack: Electron + React + Playwright + SQLite

| Layer | Technology | Why |
|---|---|---|
| **Desktop Shell** | Electron (v31) | Windows .exe, full Node.js access, web UI |
| **Frontend UI** | React 18 + Vite | Component-driven, fast dev, rich ecosystem |
| **Scraping Engine** | Playwright (Chromium) | Real browser, handles LinkedIn's JS, session support |
| **Database** | SQLite via `better-sqlite3` | Local, fast, no server needed, multi-account ready |
| **Excel Export** | ExcelJS | Full Excel formatting, column styling, highlights |
| **Scheduling** | node-cron | Background scheduled searches |
| **State Management** | Zustand | Lightweight, perfect for Electron IPC |
| **Styling** | Vanilla CSS + CSS Variables | Dark mode, glassmorphism, premium feel |
| **Charts/Stats** | Recharts | Dashboard demographics |
| **IPC Bridge** | Electron contextBridge | Secure main ↔ renderer communication |

---

## Project Structure

```
s:/LinkedInHunter/
├── electron/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Secure IPC bridge
│   ├── scraper/
│   │   ├── linkedinAuth.js  # Login, session, cookie management
│   │   ├── jobScraper.js    # Jobs section scraper
│   │   ├── postScraper.js   # Posts/feed scraper
│   │   └── humanizer.js     # Random delays, mouse simulation
│   ├── database/
│   │   ├── db.js            # SQLite setup & migrations
│   │   ├── jobs.js          # Jobs CRUD
│   │   ├── posts.js         # Posts CRUD
│   │   └── accounts.js      # Multi-account management
│   └── export/
│       └── excelExporter.js # Excel generation with formatting
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css            # Global design system
│   ├── pages/
│   │   ├── Dashboard.jsx    # Main analytics view
│   │   ├── Search.jsx       # Search configuration UI
│   │   ├── Results.jsx      # Job/post results table
│   │   ├── SavedJobs.jsx    # Bookmarked jobs
│   │   ├── Accounts.jsx     # Multi-account management
│   │   └── Settings.jsx     # App settings
│   ├── components/
│   │   ├── Sidebar.jsx
│   │   ├── SearchForm.jsx   # Keyword inputs + filters
│   │   ├── JobCard.jsx
│   │   ├── PostCard.jsx
│   │   ├── StatsPanel.jsx
│   │   ├── DuplicateAlert.jsx
│   │   └── StatusBadge.jsx  # Applied/Interviewing/Rejected
│   └── store/
│       └── useStore.js      # Zustand global state
├── package.json
├── vite.config.js
└── electron-builder.config.js  # Windows .exe build config
```

---

## Proposed Changes

### Component 1 — Project Bootstrap

#### [NEW] package.json
- Electron 31, React 18, Playwright, better-sqlite3, ExcelJS, node-cron, Zustand, Recharts
- Scripts: `dev`, `build`, `package` (creates .exe installer)

#### [NEW] vite.config.js
- Configured for Electron renderer
- Path aliases

#### [NEW] electron-builder.config.js
- Windows NSIS installer (.exe)
- App icon, app name "LinkedIn Hunter"
- Single portable executable option

---

### Component 2 — Electron Main Process

#### [NEW] electron/main.js
- App window setup (1400×900, frameless, dark)
- IPC handlers for all scraper operations
- Tray icon with quick-search shortcut
- Auto-updater hooks

#### [NEW] electron/preload.js
- Exposes safe `window.linkedinAPI` bridge:
  - `search(params)` → triggers scraper
  - `getJobs(filters)` → query DB
  - `exportExcel(jobIds)` → export
  - `addAccount(credentials)` / `switchAccount(id)`
  - `scheduleSearch(cronExpr, params)`

---

### Component 3 — Scraping Engine

#### [NEW] electron/scraper/linkedinAuth.js
**Login Flow:**
- Opens a visible Playwright Chromium window (user sees LinkedIn login page)
- User logs in manually (no password stored — only session cookies)
- Cookies saved encrypted per account in SQLite
- Session validity check on each search run

**Multi-account support:**
- Each account has its own cookie store
- Switch accounts without re-login (cookies persisted)

#### [NEW] electron/scraper/jobScraper.js
**What it does:**
- Navigates to `linkedin.com/jobs/search/` with encoded params
- Injects user-chosen filters: keywords (up to 3), experience, job type, date range, location
- Scrolls through results page-by-page (human-like)
- Extracts per job:
  - Title, Company, Location, Date Posted
  - Full Job Description (opens each job)
  - Application type (Easy Apply / External link)
  - Number of applicants
  - Company size, industry
  - Apply URL
- Limits: user-defined count (e.g., "fetch last 50 jobs")
- Date range filter: from-date → to-date

**Similar jobs toggle:**
- If enabled, also scrapes the "Similar jobs" sidebar section

#### [NEW] electron/scraper/postScraper.js
**What it does:**
- Searches LinkedIn feed/posts for hiring-related content
- Keywords: `"we're hiring"`, `"looking for"`, `"need a"`, `"remote opportunity"`, `"DM me"`, combined with user's domain keyword
- Extracts per post:
  - Author name, profile URL, headline
  - Post content (full text)
  - Post date
  - Reactions count, comments count
  - Any URLs/apply links in post
- Filters posts by relevance (hiring/freelance signals)

#### [NEW] electron/scraper/humanizer.js
- Random delay between actions: 1.5s–4s
- Random scroll speed simulation
- Mouse movement randomization
- Max requests per session (configurable, default: 30/session)
- Cool-down period between sessions

---

### Component 4 — Database Layer

#### [NEW] electron/database/db.js
SQLite schema:

**accounts table**: id, name, email, cookies_encrypted, created_at, last_used  
**searches table**: id, account_id, keywords, filters_json, run_at, results_count  
**jobs table**: id, search_id, account_id, title, company, location, date_posted, description, apply_url, apply_type, applicants_count, industry, company_size, is_remote, is_duplicate, status, notes, is_saved, scraped_at  
**posts table**: id, search_id, account_id, author_name, author_url, author_headline, content, post_date, reactions, comments, links_json, is_duplicate, is_saved, scraped_at  

**Duplicate Detection:**
- Hash based on: `title + company + date_posted` (jobs) or `author_url + post_date` (posts)
- On duplicate found: mark `is_duplicate = true`, notify user with dialog
- User chooses: skip duplicates / keep with highlight / always ask

---

### Component 5 — UI Pages

#### [NEW] src/pages/Search.jsx — Search Configuration
**Keyword Inputs (3 rows with examples):**
```
[React Native Developer          ] ← placeholder example
[Remote iOS Engineer             ] ← placeholder example  
[Mobile App Freelancer           ] ← placeholder example
[✓] Include similar jobs/searches found for hire
```

**Source Selection (toggle pills):**
- [ Jobs ] [ Posts ] [ Both ]

**Optional Filters (collapsible panel "Advanced Filters"):**
- Experience Level: Entry / Mid / Senior / Lead / Any
- Job Type: Full-time / Contract / Freelance / Part-time / Any
- Date Range: From [date picker] To [date picker]
- Max Results: [ 25 / 50 / 100 / Custom ]
- Location (even for remote): text input
- Company Size: Startup / Mid / Enterprise / Any
- Salary Range: Min [$____] Max [$____]
- Easy Apply only: toggle

**Active Account Selector** (dropdown, top right)

**[🔍 Start Hunt]** button → animated progress bar

---

#### [NEW] src/pages/Results.jsx — Results Table
- Tabs: **Jobs** | **Posts** | **All**
- Sortable columns: Date Posted (default ↓ newest first), Title, Company, Applicants
- Status column: dropdown per row (Applied / Saved / Interviewing / Rejected / New)
- Notes column: inline editable text
- Duplicate indicator: orange badge "DUPLICATE"
- Bookmark icon per row
- Row click → expandable detail panel (full description)
- Bulk select → Export Selected to Excel

---

#### [NEW] src/pages/Dashboard.jsx — Analytics
- **Stats cards**: Total Jobs Found, Posts Found, Applied, Interviews, Saved
- **Bar chart**: Jobs by Date Posted (last 7/30 days)
- **Pie chart**: Job Types distribution
- **Pie chart**: Experience Levels distribution
- **Top Companies** list
- **Recent Search History** panel
- **Duplicate Summary** (how many dupes found this week)

---

#### [NEW] src/pages/SavedJobs.jsx
- All bookmarked jobs/posts in one place
- Status tracking board (Kanban-lite: New → Applied → Interviewing → Offer/Rejected)
- Notes per job

#### [NEW] src/pages/Accounts.jsx
- Add LinkedIn account (triggers visible login browser)
- Switch active account
- Delete account (clears cookies)
- Show: last used, total jobs scraped per account

#### [NEW] src/pages/Settings.jsx
- Max requests per session (default: 30)
- Delay between requests (default: 1.5s–4s random)
- Duplicate handling preference (Always Ask / Auto-Skip / Keep with Highlight)
- Scheduled search: enable/disable + cron picker
- Default export folder path
- Clear all data option

---

### Component 6 — Excel Export

#### [NEW] electron/export/excelExporter.js
**Excel output format:**
- Sheet 1: **Jobs** — all columns, auto-width, frozen header row, alternating row colors
- Sheet 2: **Posts** — same treatment
- Sheet 3: **Summary Stats** — counts, top companies, date distribution
- Duplicate rows: highlighted in **orange**
- Status color coding: Green (Interview), Red (Rejected), Blue (Applied), Gray (New)
- Hyperlinks in Apply URL column
- File named: `LinkedIn_Hunt_YYYY-MM-DD_HH-mm.xlsx`

---

### Component 7 — Design System

#### [NEW] src/index.css
**Theme: Dark Glassmorphism with LinkedIn blue accent**
- Background: `#0a0a0f` (near-black)
- Surface: `rgba(255,255,255,0.05)` glass cards
- Accent: `#0077B5` (LinkedIn blue) → hover glow
- Success: `#00d4aa`
- Warning: `#ff9500`
- Danger: `#ff3b30`
- Font: **Inter** from Google Fonts
- Animations: fade-in cards, shimmer loading, smooth tab transitions
- Custom scrollbar styling
- Micro-animations on hover for all interactive elements

---

## Verification Plan

### Build Verification
```powershell
cd s:/LinkedInHunter
npm install
npm run dev          # Electron dev mode
npm run package      # Build .exe
```

### Functional Testing
1. Add LinkedIn account → visible browser opens → user logs in → session saved
2. Run search: keyword "React Native Developer", Jobs + Posts, last 7 days, 50 results
3. Verify results appear sorted newest-first
4. Verify duplicate detection fires on second run of same search
5. Export to Excel → verify orange highlights on duplicates
6. Switch account → verify different session used
7. Check dashboard charts populate after search

### Manual Verification
- User verifies LinkedIn login flow works with their account
- User verifies scraper doesn't get blocked (depends on account age/activity)

---

## Build Output
- `dist/LinkedInHunter-Setup-1.0.0.exe` — Windows NSIS installer
- `dist/LinkedInHunter-1.0.0-portable.exe` — Portable single file (no install needed)
