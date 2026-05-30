# Releasing LinkedIn Hunter

How to ship a new version to your users. End-to-end takes ~5 minutes after one-time setup.

## One-time setup (do once)

### 1. Add the HMAC secret to GitHub

The app's `electron/license/constants.js` reads `LH_API_HMAC_SECRET` from environment at build time. GitHub Actions injects it from a Secret so the value never lives in the public repo.

1. Open https://github.com/ahaseeb1999/LinkedInHunter/settings/secrets/actions
2. Click **New repository secret**
3. Name: `LH_API_HMAC_SECRET`
4. Value: the same value you set on Cloudflare via `wrangler secret put API_HMAC_SECRET`
5. Click **Add secret**

Optional second secret (only if your Worker URL changes from the default):
- Name: `LH_API_BASE`
- Value: `https://linkedin-hunter-api.<your-subdomain>.workers.dev`

### 2. (Optional) Make the releases repo public so users can download

If your `LinkedInHunter` repo is currently private, users can't download installers from it. Two options:

**A.** Make the repo public → Settings → General → scroll to "Danger Zone" → "Change visibility".

**B.** Keep repo private, but make releases public via a separate public repo for downloads only. Ask me if you want this.

I recommend **A** — the only secret in the repo is the HMAC key, and we're already serving it via GitHub Secrets, not committed.

---

## Releasing a new version

### Step 1 — Decide on a version number

Follow semver: `MAJOR.MINOR.PATCH`. For most updates use `1.0.X`:
- `1.0.1` → bug fix
- `1.0.2` → another bug fix
- `1.1.0` → new feature
- `2.0.0` → breaking change

### Step 2 — Update the version in package.json

Edit `s:\LinkedInHunter\package.json`, find the line near the top:

```json
"version": "1.0.0",
```

Change it to e.g. `"version": "1.0.1"`.

### Step 3 — Commit and push

```powershell
cd s:\LinkedInHunter
git add package.json
git commit -m "Release v1.0.1"
git push
```

### Step 4 — Create and push the tag

```powershell
git tag v1.0.1
git push --tags
```

That's it. The tag push triggers GitHub Actions automatically.

### Step 5 — Watch the build

Open https://github.com/ahaseeb1999/LinkedInHunter/actions

You'll see a workflow run called "Release" in progress. It takes ~5-10 minutes to:
1. Install dependencies
2. Build the React UI
3. Obfuscate the Electron JS
4. Package via electron-builder
5. Upload installer to a GitHub Release

When it shows green ✓, your release is live.

### Step 6 — Confirm

Open https://github.com/ahaseeb1999/LinkedInHunter/releases/latest

You should see:
- Tag name: `v1.0.1`
- File: `LinkedInHunter-Setup-1.0.1.exe` (~150-200 MB)

Download it and try installing. That's the same file your users will get.

---

## How users get the update

### New users (first install)

Direct them to:
```
https://github.com/ahaseeb1999/LinkedInHunter/releases/latest
```

They download `LinkedInHunter-Setup-X.X.X.exe`, double-click, install, run.

### Existing users (auto-update)

Nothing manual needed. The app silently:
1. Checks GitHub Releases ~30 seconds after launch
2. If a newer version exists, downloads it in the background
3. Installs on next quit

They literally don't notice. Next time they launch, they're on the new version.

---

## Testing without releasing

If you want to make sure a build works WITHOUT shipping it to users:

1. Open https://github.com/ahaseeb1999/LinkedInHunter/actions
2. Click **Build Test** in the left sidebar
3. Click **Run workflow** dropdown → **Run workflow**
4. Wait ~5 minutes
5. When done, click into the run → **Artifacts** at the bottom
6. Download the `LinkedInHunter-installer.zip` — that's the installer

No release is created, no users are affected.

---

## Rollback

If a release is broken:

1. Open the bad release on GitHub
2. Click **Edit** → check **This is a pre-release**
3. Save

The auto-updater ignores pre-releases by default, so users stay on the previous version.

Then push a hotfix as a new patch version (`1.0.2`).

---

## Common questions

**Q: Do users need internet to use the app?**
A: Yes, for license validation. The app has a 24h offline grace period after the last successful check.

**Q: Can a cracker get my HMAC secret from the installer?**
A: A determined attacker can. That's why we rotate the secret every time you push a new release with a different value. As long as you update the GitHub Secret AND `wrangler secret put API_HMAC_SECRET` together before each release, cracked old versions stop being able to call the API.

**Q: What's in the installer?**
A: Compiled JS (obfuscated), bundled Chromium runtime (the Electron part), the Playwright browser for scraping, and your assets. Total ~150-200 MB.

**Q: How long does GitHub Actions free tier last?**
A: 2,000 build minutes per month for private repos. One release ≈ 5-10 minutes. So you can do 200+ releases/month free.
