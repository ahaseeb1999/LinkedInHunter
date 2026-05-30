# LinkedIn Hunter — Admin Panel

A single-page admin UI for managing license keys, devices, trials, and the kill switch.

Deploys to **Cloudflare Pages** (free, no domain needed).

## File structure

```
admin-panel/
├── index.html      # Login screen + main app shell
├── styles.css      # Dark theme
├── app.js          # All UI + API client logic
├── config.js       # API_BASE URL — edit if your Worker URL changes
├── _headers        # Cloudflare Pages security headers
└── README.md
```

## Deploy

### One command (from your PC):

```powershell
cd s:\LinkedInHunter\admin-panel
wrangler pages deploy . --project-name linkedin-hunter-admin
```

First time it'll ask:

```
✔ The project you specified does not exist: "linkedin-hunter-admin". Would you like to create it? · yes
✔ Enter the production branch name: · main
```

After deploy:

```
✨ Deployment complete! Take a peek over at https://linkedin-hunter-admin.pages.dev
```

That URL is your admin panel. Open it in your browser, log in with the admin you created earlier.

### Updating later

Edit any file, then:

```powershell
wrangler pages deploy . --project-name linkedin-hunter-admin
```

Live within seconds.

## Local dev

To preview locally without deploying:

```powershell
# Simple static server (any of these work):
npx serve .
# or
python -m http.server 8000
```

Open http://localhost:8000.

## What it does

- 🔐 Login with email + password (Bearer token in `Authorization` header)
- 📊 Dashboard with stat cards + recent activity
- 🔑 List all license keys (with seats-used counter)
- ➕ Create new key (shows raw key ONCE, copy button)
- 📝 Edit key: rename, change seat count, revoke/reactivate
- 👥 List devices on each key; boot individual or all at once
- 📜 Full activity log
- 🚨 Kill switch panel (super-admin only) — locks every user instantly

## Security

- Bearer token stored in `localStorage` (never in URL, never in cookies that cross sites)
- 24-hour session lifetime
- All API calls go over HTTPS to your Cloudflare Worker
- CSP headers prevent script injection from external sources
